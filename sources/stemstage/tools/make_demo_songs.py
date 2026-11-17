#!/usr/bin/env python3
"""
make_demo_songs.py - synthesizes three ORIGINAL demo songs for StemStage as separate stems.

All music (melodies, chord voicings, grooves) is composed for this project and rendered
offline with numpy only - no samples, no downloads. The songs are placeholders for music
lessons until real songs are separated with Demucs (see tools/prepare_song.py).

    python3 tools/make_demo_songs.py                 # writes app/songs/<id>/<stem>.mp3 + songs.json
    python3 tools/make_demo_songs.py --only funky-freitag
    python3 tools/make_demo_songs.py --mixdown /some/dir   # additionally writes full mixes for listening

Requirements: Python 3.10+, numpy, ffmpeg (libmp3lame) in PATH or /opt/homebrew/bin.

Songs
  neon-nights   "Neon Nights"    Pop-Rock, 118 BPM, A major   - vocals, guitar, bass, drums, piano
  funky-freitag "Funky Freitag"  Funk, 100 BPM, E dorian      - vocals, guitar, bass, drums, piano, other
  mondlicht     "Mondlicht"      Synthwave ballad, 84 BPM, D minor - vocals, bass, drums, piano, other

Mixing rules: every stem of a song has exactly the same sample count and starts at sample 0;
stems are balanced, summed, and the SAME gain is applied to all stems so that the full mix
peaks at about -1 dBFS (so stems never clip when played together).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave
import zlib
from functools import lru_cache
from pathlib import Path

import numpy as np

SR = 44100
CR = 32                     # control-rate divider (envelopes/filters computed every 32 samples)
PEAK_TARGET_DB = -1.0
MP3_BITRATE = "128k"

STEM_META = {
    "vocals": ("Gesang", "#ff3d8b"),
    "guitar": ("Gitarre", "#ffb020"),
    "bass": ("E-Bass", "#3dd6ff"),
    "drums": ("Schlagzeug", "#7cff4d"),
    "piano": ("Keyboard", "#b26bff"),
    "other": ("Sonstiges", "#ff7a45"),
}

# ----------------------------------------------------------------------------------------
# basic DSP helpers
# ----------------------------------------------------------------------------------------


def mhz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def pan_gains(p):
    a = (float(np.clip(p, -1, 1)) + 1.0) * np.pi / 4.0
    return np.cos(a), np.sin(a)


def next_pow2(n):
    return 1 << (int(n) - 1).bit_length()


def fftconv(x, h):
    """Full linear convolution along the last axis."""
    n = x.shape[-1] + h.shape[-1] - 1
    nf = next_pow2(n)
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(h, nf), nf)[..., :n]


@lru_cache(maxsize=None)
def fir(kind, f1, f2=None, taps=None):
    """Windowed-sinc linear-phase FIR (lp / hp / bp)."""
    if taps is None:
        taps = int(min(2047, max(255, 4 * SR / max(f1, 20.0)))) | 1
    n = np.arange(taps) - (taps - 1) / 2.0

    def lp(fc):
        return 2.0 * fc / SR * np.sinc(2.0 * fc / SR * n)

    if kind == "lp":
        h = lp(f1)
    elif kind == "hp":
        h = -lp(f1)
        h[(taps - 1) // 2] += 1.0
    elif kind == "bp":
        h = lp(f2) - lp(f1)
    else:
        raise ValueError(kind)
    h = h * np.blackman(taps)
    h.setflags(write=False)
    return h


def filt(x, kind, f1, f2=None, taps=None):
    h = fir(kind, float(f1), None if f2 is None else float(f2), taps)
    d = (len(h) - 1) // 2
    if x.shape[-1] < 20000 and x.ndim == 1:
        y = np.convolve(x, h)
    else:
        y = fftconv(x, h)
    return y[..., d:d + x.shape[-1]]


def tail_fade(y, ms=5.0):
    k = min(y.shape[-1], int(SR * ms / 1000))
    if k > 1:
        y[..., -k:] *= np.linspace(1.0, 0.0, k)
    return y


def norm_peak(y, peak=1.0):
    m = np.max(np.abs(y))
    return y * (peak / m) if m > 0 else y


def upsample(ac, n):
    """Linear interpolation of a control-rate signal (len >= n//CR + 2) to audio rate."""
    nb = n // CR + 1
    a0 = ac[:nb]
    a1 = ac[1:nb + 1]
    w = np.arange(CR) / CR
    return (a0[:, None] * (1.0 - w) + a1[:, None] * w).reshape(-1)[:n]


def smooth(x, sec):
    """Hann smoothing of a control-rate signal (edge padded)."""
    m = int(sec * SR / CR)
    if m < 2:
        return x
    k = np.hanning(m + 2)[1:-1]
    k /= k.sum()
    xp = np.pad(x, (m, m), mode="edge")
    return np.convolve(xp, k, mode="same")[m:-m]


def lp_resp(f, fc, res=0.0, order=2):
    x = f / fc
    r = 1.0 / np.sqrt(1.0 + x ** (2 * order))
    if res:
        r = r + res * np.exp(-0.5 * ((x - 1.0) / 0.2) ** 2)
    return r


def additive(phase, amp_fn, kmax):
    """sum_k amp_fn(k) * sin(k*phase) with a stable sin/cos recurrence.
    amp_fn returns None (skip), a scalar or a control-rate array."""
    n = phase.shape[0]
    s1 = np.sin(phase)
    c1 = np.cos(phase)
    sk, ck = s1, c1
    out = np.zeros(n)
    for k in range(1, kmax + 1):
        if k > 1:
            sk, ck = sk * c1 + ck * s1, ck * c1 - sk * s1
        a = amp_fn(k)
        if a is None:
            continue
        if np.ndim(a) == 0:
            out += a * sk
        else:
            out += upsample(a, n) * sk
    return out


def env_adsr(n, n_on, a, d, s, r):
    t = np.arange(n) / SR
    a = max(a, 1e-4)
    e = np.where(t < a, t / a, s + (1.0 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    if n_on < n:
        v = e[max(0, min(n_on, n - 1))]
        tr = t[n_on:] - n_on / SR
        e[n_on:] = v * np.exp(-tr / (r / 4.0)) * np.clip(1.0 - tr / r, 0.0, 1.0)
    return e


def soft_clip(x, drive):
    return np.tanh(drive * x) / np.tanh(drive)


def diatonic(m, pcs, steps):
    scale = [k for k in range(128) if k % 12 in pcs]
    idx = max(i for i, k in enumerate(scale) if k <= m)
    return scale[idx + steps]


# ----------------------------------------------------------------------------------------
# song container
# ----------------------------------------------------------------------------------------


class Track:
    def __init__(self, n):
        self.buf = np.zeros((2, n))

    def add(self, sig, t, gain=1.0, pan=0.0):
        n = self.buf.shape[1]
        i0 = int(round(max(t, 0.0) * SR))
        m = sig.shape[-1]
        if i0 >= n:
            return
        m2 = min(m, n - i0)
        gl, gr = pan_gains(pan)
        if sig.ndim == 1:
            seg = sig[:m2] * gain
            self.buf[0, i0:i0 + m2] += gl * seg
            self.buf[1, i0:i0 + m2] += gr * seg
        else:
            k = np.sqrt(2.0) * gain
            self.buf[0, i0:i0 + m2] += k * gl * sig[0, :m2]
            self.buf[1, i0:i0 + m2] += k * gr * sig[1, :m2]


def add_mono(buf, sig, t, gain=1.0):
    i0 = int(round(max(t, 0.0) * SR))
    if i0 >= len(buf):
        return
    m2 = min(len(sig), len(buf) - i0)
    buf[i0:i0 + m2] += gain * sig[:m2]


class Song:
    def __init__(self, sid, title, bpm, bars, tail, fade, seed, rt60):
        self.id, self.title, self.bpm = sid, title, bpm
        self.spb = 60.0 / bpm
        self.bar_s = 4 * self.spb
        self.music_end = bars * self.bar_s
        self.n = int(round((self.music_end + tail) * SR))
        self.fade = fade
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.ir = make_ir(rt60, seed + 99)
        self.stems: dict[str, Track] = {}

    def track(self, name):
        if name not in self.stems:
            self.stems[name] = Track(self.n)
        return self.stems[name]

    def t(self, bar, beat=0.0):
        return (bar * 4 + beat) * self.spb

    def jit(self, s=0.003):
        return float(self.rng.normal(0, s))


# ----------------------------------------------------------------------------------------
# effects
# ----------------------------------------------------------------------------------------


def make_ir(rt60, seed, length=None):
    rng = np.random.default_rng(seed)
    length = length or min(3.5, rt60 * 1.15)
    n = int(length * SR)
    t = np.arange(n) / SR
    env = 10.0 ** (-3.0 * t / rt60)
    ir = np.zeros((2, n))
    for c in range(2):
        bright = rng.standard_normal(n)
        dark = filt(rng.standard_normal(n), "lp", 2500)
        dark *= np.std(bright) / np.std(dark)
        mixc = np.exp(-t / 0.25)
        ir[c] = env * (bright * mixc + dark * (1.0 - mixc))
        # a few early reflections
        for _ in range(6):
            i = int(rng.uniform(0.006, 0.05) * SR)
            ir[c, i] += rng.uniform(-1, 1) * 6.0
    ir = filt(ir, "lp", 7000)
    ir = filt(ir, "hp", 150)
    pre = int(0.018 * SR)
    ir = np.concatenate([np.zeros((2, pre)), ir], axis=1)
    ir /= np.sqrt(np.sum(ir ** 2) / 2.0)
    tail_fade(ir, 50)
    return ir


def reverb(x, ir, wet):
    send = filt(0.5 * (x[0] + x[1]), "hp", 220)
    out = np.empty_like(x)
    for c in range(2):
        out[c] = fftconv(send, ir[c])[: x.shape[1]]
    return x + wet * out


def pingpong(x, delay_s, fb, taps, wet, lp=4000):
    send = filt(0.5 * (x[0] + x[1]), "lp", lp)
    send = filt(send, "hp", 300)
    out = x.copy()
    n = x.shape[1]
    for i in range(1, taps + 1):
        d = int(i * delay_s * SR)
        if d >= n:
            break
        out[i % 2, d:] += wet * fb ** (i - 1) * send[: n - d]
    return out


def amp_sim(x, drive, lp=5000, hp=90, mid=0.25):
    x = filt(x, "hp", hp)
    act = np.abs(x) > 1e-5
    r = np.sqrt(np.mean(x[act] ** 2)) if act.any() else 1.0
    y = np.tanh(drive * x / (4.0 * r))
    y = filt(y, "lp", lp)
    if mid:
        y = y + mid * filt(y, "bp", 500, 1800)
    return y


# ----------------------------------------------------------------------------------------
# drums
# ----------------------------------------------------------------------------------------


def _t(n):
    return np.arange(n) / SR


def make_kick(rng, f_hi=155, f_lo=50, ptau=0.032, atau=0.22, click=0.5, drive=2.0, length=0.6):
    n = int(length * SR)
    t = _t(n)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / ptau)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / atau)
    c = filt(rng.standard_normal(n) * np.exp(-t / 0.0025), "hp", 1800) * click
    y = soft_clip(body + c, drive)
    return tail_fade(norm_peak(y), 30)


def make_snare(rng, tone=188, ttau=0.07, ntau=0.17, lo=1100, hi=9500, tone_amt=0.6, noise_amt=1.0,
               length=0.65, drive=1.5):
    n = int(length * SR)
    t = _t(n)
    f = tone * (1 + 0.35 * np.exp(-t / 0.012))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = (np.sin(ph) + 0.45 * np.sin(1.62 * ph + 0.3)) * np.exp(-t / ttau)
    nz = filt(rng.standard_normal(n), "bp", lo, hi)
    nz /= np.std(nz)
    nz *= np.exp(-t / ntau) * (1 + 1.5 * np.exp(-t / 0.008))
    y = tone_amt * body + noise_amt * 0.35 * nz
    y = soft_clip(y, drive) * np.clip(t / 0.0007, 0, 1)
    return tail_fade(norm_peak(y), 30)


def metallic(n, rng, scale=1.0):
    t = _t(n)
    freqs = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * scale
    y = np.zeros(n)
    for f in freqs:
        y += np.sign(np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)))
    return y / len(freqs)


def make_hat(rng, open_=False, cutoff=7000):
    n = int((0.9 if open_ else 0.2) * SR)
    t = _t(n)
    x = 0.55 * metallic(n, rng, 1.0 + rng.uniform(-0.02, 0.02)) + 0.45 * rng.standard_normal(n)
    x = filt(x, "hp", cutoff)
    tau = 0.26 if open_ else 0.026
    y = x * np.exp(-t / tau) * np.clip(t / 0.0005, 0, 1)
    return tail_fade(norm_peak(y), 20)


def make_crash(rng, length=3.2):
    n = int(length * SR)
    t = _t(n)
    x = 0.4 * metallic(n, rng, 1.7) + 0.6 * rng.standard_normal(n)
    x = filt(x, "hp", 3500)
    x = x + 0.5 * filt(x, "bp", 5000, 9000)
    env = (np.exp(-t / 1.0) + 0.6 * np.exp(-t / 0.06)) * np.clip(t / 0.002, 0, 1)
    return tail_fade(norm_peak(x * env), 300)


def make_ride(rng, length=1.6):
    n = int(length * SR)
    t = _t(n)
    bell = filt(metallic(n, rng, 2.3), "bp", 2500, 9000) * np.exp(-t / 0.35)
    wash = filt(rng.standard_normal(n), "hp", 6000) * np.exp(-t / 0.45) * 0.35
    ping = np.sin(2 * np.pi * 3150 * t) * np.exp(-t / 0.3) * 0.12
    y = (bell / (np.max(np.abs(bell)) + 1e-9) + wash + ping) * np.clip(t / 0.001, 0, 1)
    return tail_fade(norm_peak(y), 200)


def make_tom(rng, base, atau=0.3, length=0.9, drive=1.5):
    n = int(length * SR)
    t = _t(n)
    f = base * (1 + 0.6 * np.exp(-t / 0.05))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / atau)
    nz = filt(rng.standard_normal(n), "bp", 200, 3000) * np.exp(-t / 0.02) * 0.3
    y = soft_clip(body + nz, drive)
    return tail_fade(norm_peak(y), 40)


def make_clap(rng, length=0.5):
    n = int(length * SR)
    t = _t(n)
    nz = filt(rng.standard_normal(n), "bp", 900, 5000)
    env = np.zeros(n)
    for o in (0.0, 0.009, 0.019, 0.028):
        env += np.where(t >= o, np.exp(-(t - o) / 0.004), 0.0)
    env += 0.6 * np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.13), 0.0)
    return tail_fade(norm_peak(nz * env), 30)


def build_kit(style, seed):
    rng = np.random.default_rng(seed)
    k = {}
    if style == "rock":
        k["kick"] = [make_kick(rng, 150, 56, 0.03, 0.2, 0.55, 2.2) for _ in range(2)]
        k["snare"] = [make_snare(rng, 192, 0.07, 0.18, 1200, 9500) for _ in range(4)]
        k["hat"] = [make_hat(rng) for _ in range(4)]
        k["ohat"] = [make_hat(rng, True) for _ in range(2)]
        k["crash"] = [make_crash(rng)]
        k["ride"] = [make_ride(rng) for _ in range(3)]
        k["tom_h"] = [make_tom(rng, 205)]
        k["tom_m"] = [make_tom(rng, 150)]
        k["tom_l"] = [make_tom(rng, 105, 0.4)]
    elif style == "funk":
        k["kick"] = [make_kick(rng, 170, 58, 0.025, 0.15, 0.75, 2.0, 0.45) for _ in range(2)]
        k["snare"] = [make_snare(rng, 215, 0.05, 0.12, 1500, 11000, 0.5, 1.0, 0.45, 1.8) for _ in range(4)]
        k["hat"] = [make_hat(rng, cutoff=8000) for _ in range(5)]
        k["ohat"] = [make_hat(rng, True, 7500) for _ in range(2)]
        k["crash"] = [make_crash(rng)]
        k["clap"] = [make_clap(rng) for _ in range(2)]
        k["tom_h"] = [make_tom(rng, 230, 0.2)]
        k["tom_m"] = [make_tom(rng, 170, 0.22)]
        k["tom_l"] = [make_tom(rng, 120, 0.3)]
    elif style == "synth":
        k["kick"] = [make_kick(rng, 125, 50, 0.045, 0.38, 0.3, 2.4, 1.0) for _ in range(2)]
        k["snare"] = [make_snare(rng, 180, 0.09, 0.26, 900, 8000, 0.55, 1.0, 0.8, 1.4) for _ in range(3)]
        k["clap"] = [make_clap(rng) for _ in range(2)]
        k["hat"] = [make_hat(rng, cutoff=8500) for _ in range(4)]
        k["ohat"] = [make_hat(rng, True, 8000) for _ in range(2)]
        k["crash"] = [make_crash(rng, 3.5)]
        k["tom_h"] = [make_tom(rng, 170, 0.45, 1.2, 1.2)]
        k["tom_m"] = [make_tom(rng, 125, 0.5, 1.3, 1.2)]
        k["tom_l"] = [make_tom(rng, 90, 0.55, 1.4, 1.2)]
    return k


VEL = {"X": 1.0, "x": 0.85, "o": 0.6, "g": 0.26, "O": 0.75}

DRUM_PAN = {"kick": 0.0, "snare": 0.0, "clap": 0.05, "hat": 0.3, "ohat": 0.3, "ride": -0.35,
            "crash": -0.4, "tom_h": 0.35, "tom_m": 0.0, "tom_l": -0.35}


def hit(song, tr, kit, name, t, vel, gains):
    smp = kit[name][int(song.rng.integers(len(kit[name])))]
    v = vel * (1.0 + song.rng.normal(0, 0.05))
    tr.add(smp, t + song.jit(0.0025), gains.get(name, 1.0) * v, DRUM_PAN.get(name, 0.0))


def play_bar(song, tr, kit, bar, pats, gains, swing=0.0, upto=4.0, start=0.0):
    """pats: {instrument: 16-char (or 8-char) pattern}. 'O' in hat pattern = open hat."""
    for name, pat in pats.items():
        steps = len(pat)
        sb = 4.0 / steps
        for i, ch in enumerate(pat):
            if ch == ".":
                continue
            beat = i * sb
            if beat >= upto or beat < start:
                continue
            if swing and steps == 16 and i % 2 == 1:
                beat += swing * sb
            nm = "ohat" if (name == "hat" and ch == "O") else name
            hit(song, tr, kit, nm, song.t(bar, beat), VEL[ch], gains)


def play_events(song, tr, kit, bar, events, gains):
    for beat, name, vel in events:
        hit(song, tr, kit, name, song.t(bar, beat), vel, gains)


FILL_SNARE = [(3.0, "snare", 0.55), (3.25, "snare", 0.65), (3.5, "snare", 0.8), (3.75, "snare", 1.0)]
FILL_TOMS = [(2.0, "snare", 0.9), (2.5, "tom_h", 0.9), (2.75, "tom_h", 0.8), (3.0, "tom_m", 0.95),
             (3.25, "tom_m", 0.85), (3.5, "tom_l", 1.0), (3.75, "tom_l", 0.9), (3.5, "kick", 0.8)]
FILL_BIG = ([(1.0 + 0.25 * i, "snare", 0.5 + 0.08 * i) for i in range(4)]
            + [(2.0 + 0.25 * i, "tom_h", 0.85) for i in range(4)]
            + [(3.0 + 0.25 * i, "tom_m" if i < 2 else "tom_l", 0.95) for i in range(4)]
            + [(2.0, "kick", 0.8), (3.0, "kick", 0.8)])


# ----------------------------------------------------------------------------------------
# pitched instruments (all cached: identical notes are rendered once)
# ----------------------------------------------------------------------------------------


def _rng_for(*key):
    return np.random.default_rng(zlib.crc32(repr(key).encode()))


@lru_cache(maxsize=None)
def bass_note(midi, dur, vel, style):
    f0 = float(mhz(midi))
    rel = {"ghost": 0.02, "slap": 0.05, "pop": 0.05, "rock": 0.06, "synth": 0.12, "sub": 0.3}[style]
    if style == "ghost":
        dur = min(dur, 0.045)
    n = int((dur + rel) * SR)
    nc = n // CR + 2
    tc = np.arange(nc) * CR / SR
    t = _t(n)
    phase = 2 * np.pi * f0 * t
    rng = _rng_for("bass", midi, style)
    sub = 0.0
    square = 0.0
    if style == "rock":
        fc = 230 + 2300 * vel * np.exp(-tc / 0.07) + 300 * np.exp(-tc / 0.5)
        res, adsr, sub = 0.35, (0.004, 0.35, 0.55), 0.55
    elif style == "slap":
        fc = 380 + 5200 * vel * np.exp(-tc / 0.03)
        res, adsr, sub = 0.3, (0.002, 0.25, 0.35), 0.45
    elif style == "pop":
        fc = 900 + 8500 * vel * np.exp(-tc / 0.035)
        res, adsr = 0.3, (0.001, 0.18, 0.28)
    elif style == "ghost":
        fc = 500 + 0 * tc
        res, adsr = 0.0, (0.001, 0.015, 0.0)
    elif style == "synth":
        fc = 260 + 1400 * vel * np.exp(-tc / 0.12)
        res, adsr, sub, square = 0.45, (0.003, 0.3, 0.6), 0.6, 0.35
    else:  # sub
        fc = 300 + 250 * np.exp(-tc / 0.3)
        res, adsr, sub = 0.1, (0.02, 1.0, 0.8), 0.9
    fcmax = float(np.max(fc))
    kmax = int(min(14000 / f0, fcmax * 6 / f0 + 2, 120))

    def amp(k):
        w = 1.0 / k
        if square and k % 2 == 1:
            w *= 1.0 + square
        return w * lp_resp(k * f0, fc, res, 2)

    y = additive(phase, amp, kmax)
    y += sub * np.sin(phase)
    y *= env_adsr(n, int(dur * SR), adsr[0], adsr[1], adsr[2], rel)
    if style in ("slap", "pop", "ghost"):
        hp = {"slap": 1500, "pop": 3000, "ghost": 300}[style]
        tau = {"slap": 0.004, "pop": 0.003, "ghost": 0.012}[style]
        amt = {"slap": 0.35, "pop": 0.45, "ghost": 0.9}[style]
        nz = filt(rng.standard_normal(n), "hp", hp) * np.exp(-t / tau)
        y = y / (np.max(np.abs(y)) + 1e-9) + amt * nz / (np.max(np.abs(nz)) + 1e-9)
    y = soft_clip(norm_peak(y), 1.6)
    y = tail_fade(y, 4)
    y.setflags(write=False)
    return y


@lru_cache(maxsize=None)
def piano_note(midi, dur, vel):
    f0 = float(mhz(midi))
    rel = 0.25
    n = int((dur + rel) * SR)
    t = _t(n)
    rng = _rng_for("piano", midi)
    B = 0.0001 * 2 ** ((midi - 48) / 24)
    tau_base = 2.8 * (261.6 / f0) ** 0.55
    nh = int(min(7000 / f0, 18))
    y = np.zeros(n)
    for k in range(1, nh + 1):
        fk = k * f0 * np.sqrt(1 + B * k * k)
        a = (1.0 / k ** (1.55 - 0.6 * vel)) * (0.25 + abs(np.sin(np.pi * k * 0.13)))
        tau1 = tau_base / (1 + 0.35 * (k - 1))
        env = 0.6 * np.exp(-t / (tau1 * 0.12)) + 0.4 * np.exp(-t / tau1)
        ph = rng.uniform(0, 2 * np.pi)
        if k <= 6:
            p = 0.5 * (np.sin(2 * np.pi * fk * 1.0004 * t + ph) + np.sin(2 * np.pi * fk * 0.9996 * t))
        else:
            p = np.sin(2 * np.pi * fk * t + ph)
        y += a * env * p
    y *= 1.0 - np.exp(-t / 0.0015)
    hammer = filt(rng.standard_normal(n), "lp", 2500) * np.exp(-t / 0.005) * 0.08 * vel
    y += hammer
    n_on = int(dur * SR)
    damper = np.ones(n)
    damper[n_on:] = np.exp(-(t[n_on:] - dur) / 0.07)
    y *= damper
    y = tail_fade(y, 10)
    y /= 1.6
    y.setflags(write=False)
    return y


@lru_cache(maxsize=None)
def rhodes_note(midi, dur, vel):
    f0 = float(mhz(midi))
    rel = 0.15
    n = int((dur + rel) * SR)
    t = _t(n)
    idx = (0.6 + 2.0 * vel) * np.exp(-t / 0.35) + 0.25
    car = np.sin(2 * np.pi * f0 * t + idx * np.sin(2 * np.pi * f0 * t))
    tine = np.sin(2 * np.pi * f0 * 14.0 * t) * np.exp(-t / 0.03) * 0.2 * vel
    env = np.exp(-t / (3.0 * (261.6 / f0) ** 0.5)) * np.clip(t / 0.002, 0, 1)
    n_on = int(dur * SR)
    env[n_on:] *= np.exp(-(t[n_on:] - dur) / 0.04)
    y = tail_fade((car + tine) * env, 10)
    y.setflags(write=False)
    return y


@lru_cache(maxsize=None)
def clav_note(midi, dur, vel):
    f0 = float(mhz(midi))
    rel = 0.03
    n = int((dur + rel) * SR)
    nc = n // CR + 2
    tc = np.arange(nc) * CR / SR
    t = _t(n)
    fc = f0 * (1.6 + (5 + 7 * vel) * np.exp(-tc / 0.07))
    kmax = int(min(11000 / f0, 40))

    def amp(k):
        return abs(np.sin(np.pi * k * 0.11)) / k * lp_resp(k * f0, fc, 0.7, 2)

    y = additive(2 * np.pi * f0 * t, amp, kmax)
    y *= np.exp(-t / 0.9) * np.clip(t / 0.001, 0, 1)
    n_on = int(dur * SR)
    y[n_on:] *= np.exp(-(t[n_on:] - dur) / 0.008)
    rng = _rng_for("clav", midi)
    y = norm_peak(y) + 0.12 * filt(rng.standard_normal(n), "hp", 3000) * np.exp(-t / 0.002)
    y = tail_fade(soft_clip(y, 1.3), 4)
    y.setflags(write=False)
    return y


@lru_cache(maxsize=None)
def brass_note(midi, dur, vel, bright, fall):
    rel = 0.08
    n = int((dur + rel) * SR)
    nc = n // CR + 2
    tc = np.arange(nc) * CR / SR
    t = _t(n)
    off = -0.7 * np.exp(-tc / 0.035)
    off += 0.12 * np.sin(2 * np.pi * 5.5 * tc) * np.clip((tc - 0.25) / 0.2, 0, 1)
    if fall:
        off += -5.0 * np.clip((tc - (dur - 0.18)) / 0.3, 0, 1) ** 2
    f0c = mhz(midi + off)
    phase = 2 * np.pi * np.cumsum(upsample(f0c, n)) / SR
    att = 1.0 - np.exp(-tc / 0.02)
    fc = f0c * (1.0 + bright * (2.5 + 5.0 * vel) * att * (0.55 + 0.45 * np.exp(-tc / 0.15)))
    f0min = float(np.min(f0c))
    kmax = int(min(12000 / f0min, 60))

    def amp(k):
        return (1.0 / k) * lp_resp(k * f0c, fc, 0.15, 2) * (k * f0c < 15000)

    y = additive(phase, amp, kmax)
    env = env_adsr(n, int(dur * SR), 0.025, 0.15, 0.75, rel)
    if fall:
        env *= np.clip(1.0 - (t - (dur - 0.1)) / (rel + 0.1), 0, 1) ** 0.7
    rng = _rng_for("brass", midi)
    y = norm_peak(y) * env + 0.03 * filt(rng.standard_normal(n), "bp", 1000, 4000) * env
    y = tail_fade(soft_clip(y, 1.3), 5)
    y.setflags(write=False)
    return y


@lru_cache(maxsize=None)
def pluck_note(midi, vel):
    f0 = float(mhz(midi))
    n = int(0.42 * SR)
    nc = n // CR + 2
    tc = np.arange(nc) * CR / SR
    t = _t(n)
    fc = f0 * (1.3 + 7 * vel * np.exp(-tc / 0.05))
    kmax = int(min(12000 / f0, 40))

    def amp(k):
        return (1.0 if k % 2 else 0.4) / k * lp_resp(k * f0, fc, 0.3, 2)

    y = additive(2 * np.pi * f0 * t, amp, kmax) * np.exp(-t / 0.2) * np.clip(t / 0.001, 0, 1)
    y = tail_fade(norm_peak(y), 30)
    y.setflags(write=False)
    return y


@lru_cache(maxsize=None)
def pad_chord(notes, dur):
    rel = 1.2
    n = int((dur + rel) * SR)
    nc = n // CR + 2
    tc = np.arange(nc) * CR / SR
    t = _t(n)
    rng = _rng_for("pad", notes)
    fc = 1000 + 450 * np.sin(2 * np.pi * 0.17 * tc) + 500 * (1 - np.exp(-tc / 0.8))
    out = np.zeros((2, n))
    for m in notes:
        f0 = float(mhz(m))
        for cents, pan in ((-9, -0.8), (0, 0.0), (9, 0.8)):
            f = f0 * 2 ** (cents / 1200)
            kmax = int(min(5000 / f, 40))

            def amp(k, f=f):
                return (1.0 / k) * lp_resp(k * f, fc, 0.2, 2)

            y = additive(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi), amp, kmax)
            gl, gr = pan_gains(pan)
            out[0] += gl * y
            out[1] += gr * y
    out *= env_adsr(n, int(dur * SR), 0.7, 1.0, 0.85, rel)
    out = tail_fade(out, 20) / (len(notes) * 2.0)
    out.setflags(write=False)
    return out


@lru_cache(maxsize=None)
def ks_note(midi, dur, decay, bright, seed):
    """Karplus-Strong plucked string with fractional-delay tuning, block-vectorised."""
    f0 = float(mhz(midi))
    P = SR / f0
    N = int(P - 0.5)
    d = P - N
    a, b, c = (1.5 - d) * 0.5, 0.5, (d - 0.5) * 0.5
    L = int((dur + 0.08) * SR)
    rng = np.random.default_rng(seed * 7919 + midi)
    exc = rng.uniform(-1, 1, N)
    for _ in range(int(round((1.0 - bright) * 6))):
        exc = 0.5 * (exc + np.roll(exc, 1))
    exc -= exc.mean()
    pp = max(1, int(N * 0.13))
    exc = exc - 0.6 * np.roll(exc, pp)
    exc /= np.max(np.abs(exc)) + 1e-9
    g = 10.0 ** (-3.0 * N / (decay * SR))
    Y = np.zeros(L + 2 + N)
    Y[2:2 + N] = exc
    i = N
    while i < L:
        j = min(i + N, L)
        m = j - i
        Y[i + 2:j + 2] = g * (a * Y[i + 2 - N:i + 2 - N + m] + b * Y[i + 1 - N:i + 1 - N + m]
                              + c * Y[i - N:i - N + m])
        i = j
    y = Y[2:2 + L].copy()
    t = _t(L)
    n_on = int(dur * SR)
    y[n_on:] *= np.exp(-(t[n_on:] - dur) / 0.015)
    y *= np.clip(t / 0.0008, 0, 1)
    y = tail_fade(y, 5)
    y.setflags(write=False)
    return y


def strum(song, bus, notes, t, dur, down=True, spread=0.012, vel=1.0, decay=2.0, bright=0.8,
          variants=3):
    order = list(notes) if down else list(reversed(notes))
    for j, m in enumerate(order):
        tj = t + j * spread * (1.0 + 0.25 * song.rng.normal())
        seed = int(song.rng.integers(variants))
        d = round(max(0.03, dur - j * spread), 3)
        v = vel * (1.0 - 0.06 * j) * (1.0 + 0.05 * song.rng.normal())
        add_mono(bus, ks_note(int(m), d, decay, bright, seed), tj, v)


# ----------------------------------------------------------------------------------------
# singing voice (formant synthesis) and lead synth - phrase based
# ----------------------------------------------------------------------------------------

VOWELS = {  # formant centre frequencies / bandwidths (alto-like voice)
    "a": ((800, 1150, 2800, 3500), (95, 105, 140, 150)),
    "e": ((420, 1650, 2700, 3300), (75, 100, 140, 170)),
    "i": ((350, 1750, 2700, 3700), (65, 110, 140, 170)),
    "o": ((470, 820, 2830, 3500), (85, 95, 120, 150)),
    "u": ((340, 720, 2530, 3500), (65, 75, 180, 190)),
}


def group_phrases(notes, gap=0.13):
    notes = sorted(notes, key=lambda x: x[0])
    groups = []
    for nt in notes:
        if groups:
            last = groups[-1][-1]
            if nt[0] - (last[0] + last[1]) <= gap:
                groups[-1][-1] = (last[0], nt[0] - last[0]) + tuple(last[2:])
                groups[-1].append(nt)
                continue
        groups.append([nt])
    return groups


def sing_phrase(notes, kind="voice", vib_rate=5.3, vib_depth=0.25, porta=0.055, scoop=0.45,
                detune=0.0, seed=0, tilt=0.9, breath=0.04, fc_base=1300.0):
    """notes: [(t_start_s, dur_s, midi, vowel, vel)] (one legato phrase). Returns (t0, mono)."""
    rng = np.random.default_rng(seed)
    t0 = notes[0][0] - 0.08
    t_end = notes[-1][0] + notes[-1][1]
    rel = 0.22
    n = int((t_end + rel - t0) * SR)
    nc = n // CR + 2
    tc = t0 + np.arange(nc) * CR / SR

    semi = np.full(nc, float(notes[0][2]))
    since = tc - notes[0][0]
    vel = np.full(nc, float(notes[0][4]))
    F = np.zeros((4, nc))
    Bw = np.zeros((4, nc))
    Fv, Bv = VOWELS[notes[0][3]]
    F[:] = np.array(Fv)[:, None]
    Bw[:] = np.array(Bv)[:, None]
    sc = np.zeros(nc)
    amp = np.ones(nc)
    prev = None
    for (ts, d, m, vw, v) in notes:
        mask = tc >= ts
        semi[mask] = m
        since[mask] = tc[mask] - ts
        vel[mask] = v
        Fv, Bv = VOWELS[vw]
        fm = tc >= ts - 0.03
        F[:, fm] = np.array(Fv)[:, None]
        Bw[:, fm] = np.array(Bv)[:, None]
        if prev is None:
            s_amt = scoop
        else:
            s_amt = scoop * 0.4 if m > prev else 0.0
            dip = 0.75 if m == prev else 0.45
            amp *= 1.0 - dip * np.exp(-((tc - ts) / 0.028) ** 2)
        sc += np.where(mask, -s_amt * np.exp(-np.maximum(tc - ts, 0) / 0.05), 0.0)
        prev = m

    semi_s = smooth(semi, porta) + sc
    vib_env = np.clip((since - 0.16) / 0.3, 0, 1)
    vib = np.sin(2 * np.pi * vib_rate * (tc - t0) + rng.uniform(0, 6.28)
                 + 0.4 * np.sin(2 * np.pi * 0.7 * tc))
    drift = smooth(rng.standard_normal(nc), 0.3)
    drift *= 0.06 / (np.std(drift) + 1e-9)
    f0c = mhz(semi_s + vib_depth * vib_env * vib + drift + detune / 100.0)

    first = notes[0][0]
    amp *= np.clip((tc - (first - 0.04)) / 0.07, 0, 1) ** 2
    amp *= np.clip(1.0 - (tc - t_end) / rel, 0, 1) ** 2
    amp *= smooth(vel, 0.03)
    amp *= 1.0 + 0.05 * vib_env * vib
    F = np.array([smooth(F[i], 0.07) for i in range(4)])
    Bw = np.array([smooth(Bw[i], 0.07) for i in range(4)])

    phase = 2 * np.pi * np.cumsum(upsample(f0c, n)) / SR
    f0min = float(np.min(f0c))

    if kind == "voice":
        kmax = int(min(9000 / f0min, 48))

        def amp_fn(k):
            f = k * f0c
            H = np.ones(nc)
            for i in range(4):
                Fi2 = F[i] ** 2
                H *= Fi2 / np.sqrt((Fi2 - f * f) ** 2 + (Bw[i] * f) ** 2)
            emph = (1.0 + (f / 1200.0) ** 2) ** 1.1     # presence / "singer's formant" lift
            return H * emph * k ** (-tilt) * amp * (f < 10000)

        y = additive(phase, amp_fn, kmax)
        lvl = np.sqrt(np.mean(y ** 2)) + 1e-9
        nz = filt(rng.standard_normal(n), "bp", 1800, 7000)
        nz /= np.std(nz) + 1e-9
        y += breath * lvl * upsample(amp, n) * nz
    else:  # lead synth: two detuned saws, envelope-controlled low-pass
        fc = fc_base + 2400 * amp
        kmax = int(min(12000 / f0min, 70))

        def amp_fn(k):
            return (1.0 / k) * lp_resp(k * f0c, fc, 0.35, 2) * amp * (k * f0c < 15000)

        y = additive(phase, amp_fn, kmax) + additive(phase * 1.0047 + 1.3, amp_fn, kmax)
    y = tail_fade(y, 10)
    return t0, y


def melody_notes(song, mel, bar_off=0, vowels="aoeau", long_vowels="ao", transpose=0, delay=0.0,
                 vel_scale=1.0, harmony=None):
    out = []
    li = 0
    for i, (bar, beat, dur, m) in enumerate(mel):
        if dur >= 1.5:
            vw = long_vowels[li % len(long_vowels)]
            li += 1
        else:
            vw = vowels[i % len(vowels)]
        v = (1.0 if abs(beat - round(beat)) < 1e-6 else 0.86) * vel_scale
        mm = m + transpose
        if harmony is not None:
            mm = diatonic(mm, harmony[0], harmony[1])
        out.append((song.t(bar + bar_off, beat) + delay, dur * song.spb, mm, vw, v))
    return out


def render_line(song, tr, notes, gain=1.0, pan=0.0, **kw):
    for gi, grp in enumerate(group_phrases(notes)):
        kw2 = dict(kw)
        kw2["seed"] = kw.get("seed", 0) * 1000 + gi
        t0, y = sing_phrase(grp, **kw2)
        tr.add(y, t0, gain, pan)


# ----------------------------------------------------------------------------------------
# song 1: Neon Nights - pop rock, 118 BPM, A major
# ----------------------------------------------------------------------------------------

NEON_CH = {
    #        bass  power chord      open power + 3rd        piano verse     piano chorus  LH
    "F#m": (42, (42, 49, 54), (42, 49, 54, 57), (57, 61, 66), (66, 69, 73), 54),
    "D":   (38, (50, 57, 62), (50, 57, 62, 66), (57, 62, 66), (66, 69, 74), 50),
    "A":   (45, (45, 52, 57), (45, 52, 57, 61), (57, 61, 64), (64, 69, 73), 45),
    "E":   (40, (40, 47, 52), (40, 47, 52, 56), (56, 59, 64), (64, 68, 71), 52),
}

NEON_VERSE = [
    (4, 0.5, 0.5, 61), (4, 1.0, 0.5, 64), (4, 1.5, 1.0, 66), (4, 2.5, 0.5, 64), (4, 3.0, 1.0, 61),
    (5, 0.5, 0.5, 57), (5, 1.0, 0.5, 59), (5, 1.5, 0.5, 61), (5, 2.0, 1.5, 62),
    (6, 0.5, 0.5, 64), (6, 1.0, 0.5, 64), (6, 1.5, 0.5, 66), (6, 2.0, 1.0, 69), (6, 3.0, 0.5, 68),
    (6, 3.5, 0.5, 66),
    (7, 0.0, 2.5, 64),
    (8, 0.5, 0.5, 61), (8, 1.0, 0.5, 64), (8, 1.5, 1.0, 66), (8, 2.5, 0.5, 64), (8, 3.0, 1.0, 61),
    (9, 0.5, 0.5, 57), (9, 1.0, 0.5, 59), (9, 1.5, 0.5, 61), (9, 2.0, 1.0, 62), (9, 3.0, 1.0, 66),
    (10, 0.5, 0.5, 64), (10, 1.0, 0.5, 66), (10, 1.5, 1.0, 69), (10, 2.5, 0.5, 71), (10, 3.0, 1.0, 73),
    (11, 0.0, 2.0, 71), (11, 2.5, 0.5, 68), (11, 3.0, 0.9, 71),
]

NEON_CHORUS = [
    (0, 0.0, 1.5, 73), (0, 1.5, 0.5, 71), (0, 2.0, 1.0, 69), (0, 3.0, 1.0, 71),
    (1, 0.0, 1.5, 71), (1, 1.5, 0.5, 68), (1, 2.0, 1.6, 64),
    (2, 0.0, 1.0, 69), (2, 1.0, 1.0, 73), (2, 2.0, 1.5, 76), (2, 3.5, 0.5, 73),
    (3, 0.0, 1.0, 74), (3, 1.0, 1.0, 73), (3, 2.0, 1.5, 71),
    (4, 0.0, 1.5, 73), (4, 1.5, 0.5, 71), (4, 2.0, 1.0, 69), (4, 3.0, 1.0, 71),
    (5, 0.0, 1.5, 71), (5, 1.5, 0.5, 68), (5, 2.0, 1.6, 64),
    (6, 0.0, 1.0, 69), (6, 1.0, 1.0, 73), (6, 2.0, 1.0, 76), (6, 3.0, 0.5, 74), (6, 3.5, 0.5, 73),
    (7, 0.0, 1.0, 71), (7, 1.0, 3.0, 69),
]

NEON_HOOK = [  # piano intro hook (bars 0-3)
    (0, 0.0, 0.75, 73), (0, 0.75, 0.75, 76), (0, 1.5, 1.0, 78), (0, 2.5, 0.5, 76), (0, 3.0, 1.0, 73),
    (1, 0.0, 0.75, 74), (1, 0.75, 0.75, 73), (1, 1.5, 1.0, 69), (1, 2.5, 1.5, 66),
    (2, 0.0, 0.75, 73), (2, 0.75, 0.75, 76), (2, 1.5, 1.0, 81), (2, 2.5, 0.5, 80), (2, 3.0, 1.0, 76),
    (3, 0.0, 1.5, 78), (3, 1.5, 0.5, 76), (3, 2.0, 2.0, 71),
]

NEON_SOLO = [  # guitar solo (interlude bars 20-23)
    (0, 0.0, 0.5, 73), (0, 0.5, 0.5, 76), (0, 1.0, 1.0, 78), (0, 2.0, 0.5, 76), (0, 2.5, 0.5, 73),
    (0, 3.0, 0.5, 71), (0, 3.5, 0.5, 69),
    (1, 0.0, 1.5, 71), (1, 1.5, 0.5, 69), (1, 2.0, 1.0, 66), (1, 3.0, 0.5, 69), (1, 3.5, 0.5, 71),
    (2, 0.0, 0.5, 73), (2, 0.5, 0.5, 73), (2, 1.0, 0.5, 76), (2, 1.5, 0.5, 73), (2, 2.0, 1.0, 81),
    (2, 3.0, 0.5, 80), (2, 3.5, 0.5, 76),
    (3, 0.0, 0.75, 78), (3, 0.75, 0.25, 80), (3, 1.0, 2.6, 83),
]


def build_neon():
    S = Song("neon-nights", "Neon Nights", 118, bars=33, tail=3.6, fade=4.5, seed=11, rt60=1.6)
    pv, pc = ["F#m", "D", "A", "E"], ["A", "E", "F#m", "D"]
    chords = pv * 3 + pc * 2 + pv + pc * 2 + ["A"]
    sec = (["intro"] * 4 + ["verse"] * 8 + ["chorus"] * 8 + ["inter"] * 4 + ["chorus"] * 8 + ["end"])
    rng = S.rng
    beat = S.spb

    # ---- drums
    kit = build_kit("rock", 101)
    dr = S.track("drums")
    g = {"kick": 1.0, "snare": 0.85, "hat": 0.32, "ohat": 0.3, "ride": 0.3, "crash": 0.5,
         "tom_h": 0.75, "tom_m": 0.75, "tom_l": 0.8}
    V_KICK, V_SNARE, V_HAT = "x.....x.x.......", "....X.......X...", "x.o.x.o.x.o.x.o."
    C_KICK, C_RIDE = "x.....x.x.x.....", "x.o.x.o.x.o.x.o."
    for b in range(33):
        s = sec[b]
        if b < 2:
            play_bar(S, dr, kit, b, {"hat": "o.g.o.g.o.g.o.g.", "kick": "x.......x......."}, g)
        elif s in ("intro", "verse", "inter"):
            fill = FILL_TOMS if b in (11, 23) else (FILL_SNARE if b == 3 else None)
            upto = fill[0][0] if fill else 4.0
            hat = "x.o.x.o.x.o.x.O." if s == "inter" else V_HAT
            play_bar(S, dr, kit, b, {"kick": V_KICK, "snare": V_SNARE, "hat": hat}, g, upto=upto)
            if fill:
                play_events(S, dr, kit, b, fill, g)
        elif s == "chorus":
            last = b in (19, 31)
            upto = 2.0 if last else 4.0
            play_bar(S, dr, kit, b, {"kick": C_KICK, "snare": V_SNARE, "ride": C_RIDE}, g, upto=upto)
            if last:
                play_events(S, dr, kit, b, FILL_TOMS, g)
            if b in (12, 16, 24, 28):
                hit(S, dr, kit, "crash", S.t(b), 1.0, g)
        else:  # end
            hit(S, dr, kit, "crash", S.t(b), 1.0, g)
            hit(S, dr, kit, "kick", S.t(b), 1.0, g)
            hit(S, dr, kit, "tom_l", S.t(b), 0.7, g)
    hit(S, dr, kit, "crash", S.t(4), 0.7, g)
    hit(S, dr, kit, "crash", S.t(20), 0.9, g)

    # ---- bass
    bs = S.track("bass")
    for b in range(2, 33):
        ch = chords[b]
        root = NEON_CH[ch][0]
        if sec[b] == "end":
            bs.add(bass_note(root, 3.0, 1.0, "rock"), S.t(b), 1.0)
            continue
        nxt = NEON_CH[chords[b + 1]][0]
        for e in range(8):
            m = root
            if sec[b] == "chorus" and e in (3, 7):
                m = root + 12
            if e == 7 and chords[b + 1] != ch and sec[b + 1] != sec[b]:
                m = nxt - 1 if nxt > root else nxt + 2
            v = 1.0 if e % 2 == 0 else 0.8
            bs.add(bass_note(m, round(0.46 * beat, 3), v, "rock"), S.t(b, e * 0.5) + S.jit(0.002), v)

    # ---- guitars (two rhythm takes hard L/R + solo)
    gt = S.track("guitar")
    for take, pan in ((0, -0.8), (1, 0.8)):
        bus = np.zeros(S.n)
        for b in range(2, 33):
            ch = chords[b]
            s = sec[b]
            if s in ("intro", "verse", "inter"):
                vscale = 0.75 if s == "inter" else 1.0
                for e in range(8):
                    v = (1.0 if e % 2 == 0 else 0.82) * vscale
                    strum(S, bus, NEON_CH[ch][1], S.t(b, e * 0.5) + S.jit(0.004), 0.42 * beat,
                          True, 0.004, v, 0.16, 0.5)
            elif s == "chorus":
                pat = [(0.0, 1.0, True, 1.0), (1.0, 0.5, True, 0.8), (1.5, 1.0, False, 0.85),
                       (2.5, 0.5, True, 0.8), (3.0, 0.5, True, 0.9), (3.5, 0.5, False, 0.75)]
                for bt, du, down, v in pat:
                    strum(S, bus, NEON_CH[ch][2], S.t(b, bt) + S.jit(0.005), du * beat, down,
                          0.011, v, 2.2, 0.8)
            else:
                strum(S, bus, NEON_CH["A"][2], S.t(b), 7.0, True, 0.02, 1.0, 4.0, 0.85)
        gt.add(amp_sim(bus, 5.0, 4800, 100, 0.3), 0.0, 1.0, pan)
    solo = np.zeros(S.n)
    for (bb, bt, du, m) in NEON_SOLO:
        add_mono(solo, ks_note(m, round(du * beat, 3), 2.5, 0.95, 0), S.t(20 + bb, bt) + S.jit(0.004),
                 1.0)
    solo = amp_sim(solo, 9.0, 5500, 200, 0.5)
    solo_st = pingpong(np.stack([solo, solo]) * 0.7, 0.75 * beat, 0.45, 4, 0.35)
    gt.add(solo_st, 0.0, 1.5, 0.1)

    # ---- piano
    pn = S.track("piano")
    for (bb, bt, du, m) in NEON_HOOK:
        for mm, gg in ((m, 0.8), (m - 12, 0.5)):
            pn.add(piano_note(mm, round(du * beat, 3), 0.7), S.t(bb, bt) + S.jit(0.003), gg, -0.2)
    for b in range(0, 33):
        ch = chords[b]
        s = sec[b]
        _, _, _, pv_, pcv, lh = NEON_CH[ch]
        if s == "intro":
            pn.add(piano_note(lh - 12, round(2 * beat, 3), 0.5), S.t(b), 0.5, -0.25)
            pn.add(piano_note(lh - 12, round(2 * beat, 3), 0.45), S.t(b, 2), 0.45, -0.25)
        elif s == "verse":
            for bt in (0.0, 2.0):
                for m in pv_:
                    pn.add(piano_note(m, round(1.9 * beat, 3), 0.4), S.t(b, bt) + S.jit(0.004), 0.42, -0.25)
        elif s == "chorus":
            for q in range(4):
                v = 0.62 if q == 0 else 0.5
                for m in pcv:
                    pn.add(piano_note(m, round(0.85 * beat, 3), v), S.t(b, q) + S.jit(0.003), v, -0.25)
            for bt in (0.0, 2.0):
                pn.add(piano_note(lh, round(1.9 * beat, 3), 0.55), S.t(b, bt), 0.5, -0.25)
        elif s == "inter":
            tones = list(pv_) + [pv_[0] + 12, pv_[1] + 12]
            order = [0, 1, 2, 3, 4, 3, 2, 1]
            for e in range(8):
                m = tones[order[e]] + 12
                pn.add(piano_note(m, round(0.9 * beat, 3), 0.45), S.t(b, e * 0.5) + S.jit(0.003), 0.5,
                       -0.3 + 0.08 * e)
        else:
            for m in (45, 57, 61, 64, 69, 73):
                pn.add(piano_note(m, round(6.5 * beat, 3), 0.75), S.t(b) + 0.006 * (m - 45) / 4, 0.55, -0.2)

    # ---- vocals
    vo = S.track("vocals")
    render_line(S, vo, melody_notes(S, NEON_VERSE, 0, "aoeauo", "ao"), 1.0, 0.0, seed=1)
    for c0, seed in ((12, 2), (24, 3)):
        mel = list(NEON_CHORUS)
        if c0 == 24:
            mel[-1] = (7, 1.0, 5.0, 69)
        notes = melody_notes(S, mel, c0, "aoaeoa", "ao")
        render_line(S, vo, notes, 1.0, 0.0, seed=seed, tilt=0.8)
        for det, dl, pan, sd in ((9, 0.014, -0.55, 10), (-8, 0.022, 0.55, 11)):
            nn = [(a + dl, d, m, w, v) for (a, d, m, w, v) in notes]
            render_line(S, vo, nn, 0.38, pan, seed=seed * 50 + sd, detune=det, tilt=0.9)

    fx = {"vocals": dict(rev=0.28, delay=(0.75 * beat, 0.35, 4, 0.18)),
          "guitar": dict(rev=0.10), "bass": dict(rev=0.0), "drums": dict(rev=0.10, clip=1.4),
          "piano": dict(rev=0.22)}
    targets = {"vocals": -16.0, "guitar": -18.5, "bass": -18.0, "drums": -16.5, "piano": -21.0}
    order = ["vocals", "guitar", "bass", "drums", "piano"]
    return S, order, fx, targets


# ----------------------------------------------------------------------------------------
# song 2: Funky Freitag - funk, 100 BPM, E dorian
# ----------------------------------------------------------------------------------------

FUNK_CH = {
    #          bass  voicing (guitar/clav/rhodes)   horns
    "Em9":   (28, (55, 59, 62, 66), (62, 66, 71)),
    "A9":    (33, (55, 59, 64, 69), (61, 67, 71)),
    "Am7":   (33, (55, 60, 64, 67), (60, 64, 67)),
    "Bm7":   (35, (57, 62, 66, 69), (62, 66, 69)),
    "Cmaj7": (36, (59, 64, 67, 71), (64, 67, 71)),
    "D9":    (38, (57, 60, 64, 66), (60, 64, 66)),
}

FUNK_BASS_VERSE = [  # (step, dur_steps, semitones over low root, type)
    (0, 2, 0, "slap"), (2, 1, 0, "ghost"), (3, 1, 12, "pop"), (5, 1, 0, "ghost"), (6, 1, 0, "slap"),
    (7, 1, 10, "slap"), (8, 1, 12, "pop"), (10, 2, 0, "slap"), (12, 1, 7, "slap"), (13, 1, 12, "pop"),
    (14, 1, 10, "slap"), (15, 1, 12, "pop"),
]
FUNK_BASS_CHORUS = [
    (0, 3, 0, "slap"), (3, 1, 12, "pop"), (4, 1, 0, "ghost"), (6, 2, 7, "slap"), (8, 2, 0, "slap"),
    (10, 1, 12, "pop"), (11, 1, 0, "ghost"), (12, 2, 7, "slap"), (14, 1, 12, "pop"), (15, 1, None, "slap"),
]
FUNK_CLAV = [(0, 1, "A"), (2, 1, "L"), (3, 1, "U"), (5, 1, "L"), (6, 2, "U"), (9, 1, "L"),
             (10, 1, "U"), (12, 1, "A"), (14, 1, "L"), (15, 1, "U")]

FUNK_VERSE = [
    (4, 0.5, 0.5, 71), (4, 1.0, 0.5, 71), (4, 1.5, 0.5, 69), (4, 2.0, 1.0, 67), (4, 3.0, 0.5, 64),
    (4, 3.5, 0.5, 67),
    (5, 0.0, 1.5, 69), (5, 1.5, 0.5, 67), (5, 2.0, 1.5, 64),
    (6, 0.5, 0.5, 73), (6, 1.0, 0.5, 73), (6, 1.5, 0.5, 71), (6, 2.0, 0.5, 69), (6, 2.5, 1.0, 67),
    (6, 3.5, 0.5, 69),
    (7, 0.0, 2.0, 64),
    (8, 0.5, 0.5, 71), (8, 1.0, 0.5, 71), (8, 1.5, 0.5, 74), (8, 2.0, 1.0, 71), (8, 3.0, 0.5, 67),
    (8, 3.5, 0.5, 69),
    (9, 0.0, 1.5, 71), (9, 1.5, 0.5, 69), (9, 2.0, 1.5, 67),
    (10, 0.5, 0.5, 73), (10, 1.0, 0.5, 73), (10, 1.5, 0.5, 71), (10, 2.0, 0.5, 69), (10, 2.5, 1.0, 71),
    (10, 3.5, 0.5, 73),
    (11, 0.0, 1.0, 74), (11, 1.0, 0.5, 73), (11, 1.5, 2.0, 71),
]
FUNK_CHORUS = [
    (0, 0.0, 0.75, 76), (0, 0.75, 0.75, 74), (0, 1.5, 1.0, 72), (0, 2.5, 0.5, 69), (0, 3.0, 1.0, 72),
    (1, 0.0, 0.75, 74), (1, 0.75, 0.75, 71), (1, 1.5, 1.0, 69), (1, 2.5, 0.5, 71), (1, 3.0, 0.75, 74),
    (2, 0.0, 1.5, 76), (2, 1.5, 0.5, 74), (2, 2.0, 1.0, 71), (2, 3.0, 1.0, 67),
    (3, 0.0, 0.75, 69), (3, 0.75, 0.75, 72), (3, 1.5, 2.0, 76),
]
FUNK_HORN_RIFF = [  # (bar_rel, step, dur_steps, midi)
    (0, 0, 2, 64), (0, 2, 1, 67), (0, 3, 1, 69), (0, 4, 2, 71), (0, 6, 1, 69), (0, 7, 1, 67),
    (0, 8, 3, 64), (0, 12, 1, 62), (0, 13, 3, 64),
    (1, 0, 2, 64), (1, 2, 1, 67), (1, 3, 1, 69), (1, 4, 2, 71), (1, 6, 1, 74), (1, 7, 1, 71),
    (1, 8, 3, 69), (1, 12, 2, 67), (1, 14, 2, 69),
    (2, 0, 2, 71), (2, 2, 1, 74), (2, 3, 3, 76), (2, 6, 1, 74), (2, 7, 1, 71), (2, 8, 2, 69),
    (2, 10, 1, 67), (2, 11, 1, 69), (2, 12, 4, 71),
]


def build_funk():
    S = Song("funky-freitag", "Funky Freitag", 100, bars=29, tail=2.6, fade=3.5, seed=22, rt60=1.1)
    vamp, chor = ["Em9", "Em9", "A9", "A9"], ["Am7", "Bm7", "Cmaj7", "D9"]
    chords = vamp * 3 + chor * 2 + vamp + chor + ["Em9"]
    sec = ["intro"] * 4 + ["verse"] * 8 + ["chorus"] * 8 + ["break"] * 4 + ["chorus"] * 4 + ["end"]
    st = S.spb / 4.0  # one 16th in seconds
    SW = 0.12

    def ts(bar, step):
        return S.t(bar, step / 4.0 + (SW / 4.0 if step % 2 == 1 else 0.0))

    # ---- drums
    kit = build_kit("funk", 202)
    dr = S.track("drums")
    g = {"kick": 1.0, "snare": 0.8, "hat": 0.33, "ohat": 0.3, "crash": 0.45, "clap": 0.45,
         "tom_h": 0.7, "tom_m": 0.7, "tom_l": 0.75}
    KICK, KICK_C = "x.....x...x..x..", "x.....x.x.x..x.."
    SNARE, HAT = "....X..g.g..X..g", "xgogxgogxgogxgOg"
    for b in range(29):
        s = sec[b]
        if s == "end":
            for nm in ("kick", "crash", "snare"):
                hit(S, dr, kit, nm, S.t(b), 1.0, g)
            continue
        fill = FILL_SNARE if b in (3, 11, 27) else (FILL_TOMS if b in (19, 23) else None)
        upto = fill[0][0] if fill else 4.0
        pats = {"kick": KICK_C if s == "chorus" else KICK, "snare": SNARE, "hat": HAT}
        if s == "chorus":
            pats["clap"] = "....x.......x..."
        play_bar(S, dr, kit, b, pats, g, swing=SW, upto=upto)
        if fill:
            play_events(S, dr, kit, b, fill, g)
        if b in (4, 12, 16, 20, 24):
            hit(S, dr, kit, "crash", S.t(b), 0.9, g)

    # ---- bass (slap)
    bs = S.track("bass")
    for b in range(2, 29):
        ch = chords[b]
        root = FUNK_CH[ch][0]
        if sec[b] == "end":
            bs.add(bass_note(root, 1.6, 1.0, "slap"), S.t(b), 1.0)
            bs.add(bass_note(root + 12, 1.2, 1.0, "pop"), S.t(b) + 0.004, 0.5)
            continue
        pat = FUNK_BASS_CHORUS if sec[b] == "chorus" else FUNK_BASS_VERSE
        nxt = FUNK_CH[chords[b + 1]][0]
        for step, dsteps, semi, typ in pat:
            if semi is None:
                m = nxt - 1 if nxt != root else root + 10
            else:
                m = root + semi
            v = {"slap": 1.0, "pop": 0.85, "ghost": 0.55}[typ]
            if step % 4 == 0 and typ == "slap":
                v = 1.05
            bs.add(bass_note(m, round(dsteps * st * 0.9, 3), 1.0, typ), ts(b, step) + S.jit(0.002), v)

    # ---- guitar (clean chicken scratch, right)
    gbus = np.zeros(S.n)
    VPAT, CPAT = "m.x.mmx.m.x.mmxm", "m.X.m.X.m.X.mmX."
    for b in list(range(0, 20)) + [22, 23] + list(range(24, 29)):
        ch = chords[b]
        notes = [m + 12 for m in FUNK_CH[ch][1][1:]]
        if sec[b] == "end":
            strum(S, gbus, notes, S.t(b), 2.0, True, 0.01, 1.0, 1.6, 0.9)
            continue
        pat = CPAT if sec[b] == "chorus" else VPAT
        for i, c in enumerate(pat):
            if c == ".":
                continue
            down = i % 2 == 0
            if c == "m":
                strum(S, gbus, notes, ts(b, i), 0.035, down, 0.004, 0.42, 0.05, 0.45)
            else:
                du = st * (1.6 if c == "X" else 1.0)
                strum(S, gbus, notes, ts(b, i), du, down, 0.006, 1.0 if c == "X" else 0.9, 0.9, 0.9)
    gbus = filt(filt(gbus, "hp", 180), "lp", 6000)
    gbus = soft_clip(gbus / (np.max(np.abs(gbus)) + 1e-9), 1.8)
    S.track("guitar").add(gbus, 0.0, 1.0, 0.55)

    # ---- keys: clav (verse/break) + rhodes (chorus)
    pn = S.track("piano")
    for b in range(2, 29):
        ch = chords[b]
        vc = FUNK_CH[ch][1]
        s = sec[b]
        if s in ("intro", "verse", "break"):
            for step, dsteps, which in FUNK_CLAV:
                sel = {"A": vc, "L": vc[:2], "U": vc[2:]}[which]
                for m in sel:
                    pn.add(clav_note(m, round(dsteps * st * 0.8, 3), 0.9 if which == "A" else 0.75),
                           ts(b, step) + S.jit(0.002), 0.5, -0.5)
        elif s == "chorus":
            for bt, du, v in ((0.0, 1.25, 0.65), (1.5, 0.5, 0.45), (2.5, 1.4, 0.55)):
                for m in vc:
                    pn.add(rhodes_note(m, round(du * S.spb, 3), v), S.t(b, bt) + S.jit(0.004), v, -0.35)
                pn.add(rhodes_note(vc[0] - 12, round(du * S.spb, 3), v), S.t(b, bt), v * 0.8, -0.35)
        else:
            for m in (40, 55, 59, 62, 66):
                pn.add(rhodes_note(m, 2.4, 0.8), S.t(b), 0.6, -0.35)

    # ---- horns (other)
    ot = S.track("other")
    pans = (0.35, -0.3, 0.0)

    def stab(bar, step, dsteps, voicing, vel=1.0, fall=False):
        for vi, m in enumerate(voicing):
            bright = 1.2 if vi == len(voicing) - 1 else 0.8
            ot.add(brass_note(m, round(dsteps * st, 3), vel, bright, fall),
                   ts(bar, step) + S.jit(0.004), 0.55 * vel, pans[vi % 3])

    stab(3, 10, 1, FUNK_CH["A9"][2], 0.8)
    stab(3, 12, 3, FUNK_CH["A9"][2], 0.9)
    for b in range(4, 12):
        if b % 4 == 3:
            stab(b, 8, 1, FUNK_CH["A9"][2], 0.8)
            stab(b, 10, 1, FUNK_CH["A9"][2], 0.85)
            stab(b, 12, 3, FUNK_CH["A9"][2], 0.95, fall=(b == 7))
    for b in list(range(12, 20)) + list(range(24, 28)):
        hv = FUNK_CH[chords[b]][2]
        stab(b, 0, 1.5, hv, 1.0)
        stab(b, 6, 1, hv, 0.75)
        if b not in (19, 27):
            stab(b, 14, 2, FUNK_CH[chords[b + 1]][2], 0.8)
    for (bb, step, dsteps, m) in FUNK_HORN_RIFF:
        b = 20 + bb
        ot.add(brass_note(m, round(dsteps * st * 0.95, 3), 0.9, 1.2, dsteps >= 4),
               ts(b, step) + S.jit(0.003), 0.6, 0.25)
        ot.add(brass_note(m - 12, round(dsteps * st * 0.95, 3), 0.9, 0.7, dsteps >= 4),
               ts(b, step) + S.jit(0.003), 0.55, -0.25)
    for step, dsteps in ((0, 2), (3, 1), (6, 2), (10, 1), (12, 3)):
        stab(23, step, dsteps, FUNK_CH["A9"][2], 0.9)
    stab(28, 0, 10, (52, 62, 66, 71), 1.0, fall=True)

    # ---- vocals
    vo = S.track("vocals")
    render_line(S, vo, melody_notes(S, FUNK_VERSE, 0, "aeoaue", "ao"), 1.0, 0.0, seed=5, vib_depth=0.2)
    aeol = {4, 6, 7, 9, 11, 0, 2}
    for c0, nb, seed in ((12, 8, 6), (24, 4, 7)):
        mel = [(bb, bt, du, m) for (bb, bt, du, m) in FUNK_CHORUS]
        if nb == 8:
            mel += [(bb + 4, bt, du, m) for (bb, bt, du, m) in FUNK_CHORUS[:-3]]
            mel += [(7, 0.0, 1.0, 74), (7, 1.0, 1.0, 72), (7, 2.0, 1.75, 71)]
        else:
            mel[-1] = (3, 1.5, 4.5, 76)
        notes = melody_notes(S, mel, c0, "aoeaoa", "ao")
        render_line(S, vo, notes, 1.0, 0.0, seed=seed, tilt=0.8, vib_depth=0.2)
        harm = melody_notes(S, mel, c0, "aoeaoa", "ao", harmony=(aeol, -2), delay=0.01)
        render_line(S, vo, harm, 0.45, 0.35, seed=seed + 40, tilt=0.9, vib_depth=0.18)

    fx = {"vocals": dict(rev=0.18, delay=(0.5 * S.spb, 0.3, 3, 0.12)), "guitar": dict(rev=0.08),
          "bass": dict(rev=0.0), "drums": dict(rev=0.06, clip=1.4), "piano": dict(rev=0.12),
          "other": dict(rev=0.14)}
    targets = {"vocals": -16.5, "guitar": -21.5, "bass": -17.0, "drums": -16.5, "piano": -20.5,
               "other": -19.5}
    order = ["vocals", "guitar", "bass", "drums", "piano", "other"]
    return S, order, fx, targets


# ----------------------------------------------------------------------------------------
# song 3: Mondlicht - synthwave ballad, 84 BPM, D minor
# ----------------------------------------------------------------------------------------

MOND_CH = {
    #       bass  pad voicing           arpeggio tones
    "Dm": (38, (50, 57, 62, 65), (62, 65, 69, 74)),
    "Bb": (34, (50, 53, 58, 62), (62, 65, 70, 74)),
    "F":  (41, (48, 53, 57, 60), (60, 65, 69, 72)),
    "C":  (36, (48, 52, 55, 60), (60, 64, 67, 72)),
}
MOND_VERSE = [
    (4, 1.0, 0.5, 69), (4, 1.5, 0.5, 69), (4, 2.0, 0.5, 70), (4, 2.5, 1.5, 69),
    (5, 0.0, 1.0, 65), (5, 1.0, 0.5, 67), (5, 1.5, 0.5, 65), (5, 2.0, 1.8, 62),
    (6, 1.0, 0.5, 65), (6, 1.5, 0.5, 67), (6, 2.0, 0.5, 69), (6, 2.5, 1.5, 72),
    (7, 0.0, 1.0, 67), (7, 1.0, 2.5, 64),
    (8, 1.0, 0.5, 69), (8, 1.5, 0.5, 69), (8, 2.0, 0.5, 70), (8, 2.5, 1.0, 72), (8, 3.5, 0.5, 70),
    (9, 0.0, 1.0, 69), (9, 1.0, 0.5, 67), (9, 1.5, 0.5, 65), (9, 2.0, 1.8, 62),
    (10, 1.0, 0.5, 65), (10, 1.5, 0.5, 67), (10, 2.0, 0.5, 69), (10, 2.5, 1.0, 72), (10, 3.5, 0.5, 74),
    (11, 0.0, 2.0, 72), (11, 2.0, 1.0, 70), (11, 3.0, 0.9, 67),
]
MOND_CHORUS = [
    (0, 0.0, 1.5, 74), (0, 1.5, 0.5, 72), (0, 2.0, 1.8, 70),
    (1, 0.0, 1.5, 72), (1, 1.5, 0.5, 69), (1, 2.0, 1.8, 65),
    (2, 0.0, 1.0, 67), (2, 1.0, 1.0, 69), (2, 2.0, 1.5, 72), (2, 3.5, 0.5, 70),
    (3, 0.0, 3.0, 69),
    (4, 0.0, 1.5, 74), (4, 1.5, 0.5, 72), (4, 2.0, 1.8, 70),
    (5, 0.0, 1.5, 72), (5, 1.5, 0.5, 69), (5, 2.0, 1.8, 65),
    (6, 0.0, 1.0, 67), (6, 1.0, 1.0, 69), (6, 2.0, 1.5, 72), (6, 3.5, 0.5, 72),
    (7, 0.0, 0.5, 72), (7, 0.5, 3.5, 74),
]
MOND_LEAD = [
    (0, 0.0, 1.5, 74), (0, 1.5, 0.5, 76), (0, 2.0, 1.0, 77), (0, 3.0, 1.0, 76),
    (1, 0.0, 2.0, 74), (1, 2.0, 1.0, 72), (1, 3.0, 1.0, 70),
    (2, 0.0, 1.5, 72), (2, 1.5, 0.5, 74), (2, 2.0, 1.0, 77), (2, 3.0, 1.0, 79),
    (3, 0.0, 3.5, 76),
]
MOND_LEAD_OUT = MOND_LEAD[:7] + [(2, 0.0, 1.5, 72), (2, 1.5, 0.5, 74), (2, 2.0, 2.0, 76),
                                 (3, 0.0, 5.0, 74)]


def build_mond():
    S = Song("mondlicht", "Mondlicht", 84, bars=24, tail=3.0, fade=5.0, seed=33, rt60=2.6)
    chords = ["Dm", "Bb", "F", "C"] * 3 + ["Bb", "F", "C", "Dm"] * 2 + ["Dm", "Bb", "C", "Dm"]
    sec = ["intro"] * 4 + ["verse"] * 8 + ["chorus"] * 8 + ["outro"] * 4
    st = S.spb / 4.0

    # ---- drums
    kit = build_kit("synth", 303)
    dr = S.track("drums")
    g = {"kick": 1.0, "snare": 0.75, "clap": 0.45, "hat": 0.22, "ohat": 0.2, "crash": 0.45,
         "tom_h": 0.8, "tom_m": 0.8, "tom_l": 0.85}
    for b in range(2, 24):
        s = sec[b]
        if b == 23:
            hit(S, dr, kit, "crash", S.t(b), 0.9, g)
            hit(S, dr, kit, "kick", S.t(b), 1.0, g)
            continue
        if s == "intro":
            play_bar(S, dr, kit, b, {"hat": "o.g.o.g.o.g.o.g.", "kick": "x..............."}, g, upto=3.0)
            if b == 3:
                play_events(S, dr, kit, b, [(3 + 0.25 * i, "snare", 0.35 + 0.15 * i) for i in range(4)], g)
            continue
        fill = FILL_BIG if b in (11, 19) else None
        upto = 1.0 if fill else 4.0
        if s == "verse" or b == 22:
            pats = {"kick": "x.....x.........", "snare": "........X.......", "clap": "........x.......",
                    "hat": "x.o.x.o.x.o.x.o."}
        else:
            pats = {"kick": "x.......x.....x.", "snare": "....X.......X...", "clap": "....x.......x...",
                    "hat": "xgogxgogxgogxgog"}
        play_bar(S, dr, kit, b, pats, g, upto=upto)
        if fill:
            play_events(S, dr, kit, b, fill, g)
        if b in (4, 12, 16, 20):
            hit(S, dr, kit, "crash", S.t(b), 0.85, g)

    # ---- bass
    bs = S.track("bass")
    for b in range(2, 24):
        root = MOND_CH[chords[b]][0]
        s = sec[b]
        if s in ("chorus",) or b in (20, 21):
            for e in range(8):
                m = root + (12 if e in (3, 7) else 0)
                v = 1.0 if e % 2 == 0 else 0.85
                bs.add(bass_note(m, round(0.45 * S.spb, 3), v, "synth"), S.t(b, e * 0.5), v)
        elif b == 23:
            bs.add(bass_note(root, 4.5, 1.0, "sub"), S.t(b), 1.0)
        else:
            bs.add(bass_note(root, round(2.4 * S.spb, 3), 1.0, "sub"), S.t(b), 1.0)
            bs.add(bass_note(root, round(1.4 * S.spb, 3), 0.9, "sub"), S.t(b, 2.5), 0.9)

    # ---- keys: pads + arpeggio
    pn = S.track("piano")
    for b in range(0, 24):
        ch = chords[b]
        dur = S.bar_s * (1.6 if b == 23 else 1.0)
        pn.add(pad_chord(MOND_CH[ch][1], round(dur, 3)), S.t(b), 0.8 if b >= 4 else 0.65)
    ARP = [0, 1, 2, 3, 1, 2, 3, 2]
    for b in range(0, 23):
        s = sec[b]
        tones = MOND_CH[chords[b]][2]
        if s == "verse" and b < 8:
            continue
        if b < 2:
            steps = range(0, 16, 2)
            v0 = 0.45
        elif s == "verse":
            steps = range(0, 16, 2)
            v0 = 0.5
        else:
            steps = range(16)
            v0 = 0.6
        for i in steps:
            m = tones[ARP[i % 8]] + (12 if (i // 8) % 2 == 1 else 0)
            v = v0 * (1.0 if i % 4 == 0 else 0.75)
            pn.add(pluck_note(m, 0.8), S.t(b, i * 0.25) + S.jit(0.001), v * 0.8, -0.45 if i % 2 else 0.45)

    # ---- lead synth (other)
    ot = S.track("other")
    lead_kw = dict(kind="lead", vib_rate=5.0, vib_depth=0.16, porta=0.05, scoop=0.2, fc_base=900.0)
    render_line(S, ot, melody_notes(S, MOND_LEAD, 0), 1.0, 0.15, seed=21, **lead_kw)
    counter = [(16, 0.0, 3.8, 77), (17, 0.0, 3.8, 77), (18, 0.0, 3.8, 76), (19, 0.0, 3.8, 74)]
    render_line(S, ot, melody_notes(S, counter, 0), 0.4, 0.3, seed=22, **lead_kw)
    render_line(S, ot, melody_notes(S, MOND_LEAD_OUT, 20), 1.0, 0.15, seed=23, **lead_kw)

    # ---- vocals
    vo = S.track("vocals")
    render_line(S, vo, melody_notes(S, MOND_VERSE, 0, "uoaeoa", "oa"), 1.0, 0.0, seed=8,
                vib_depth=0.28, porta=0.07)
    dmin = {2, 4, 5, 7, 9, 10, 0}
    notes = melody_notes(S, MOND_CHORUS, 12, "aoaoea", "ao")
    render_line(S, vo, notes, 1.0, 0.0, seed=9, tilt=0.8, vib_depth=0.28, porta=0.07)
    harm = melody_notes(S, MOND_CHORUS, 12, "aoaoea", "ao", harmony=(dmin, -2), delay=0.012)
    render_line(S, vo, harm, 0.42, -0.35, seed=49, tilt=0.9, vib_depth=0.22, porta=0.07)

    fx = {"vocals": dict(rev=0.38, delay=(0.75 * S.spb, 0.4, 4, 0.18)), "bass": dict(rev=0.0),
          "drums": dict(rev=0.28, clip=1.3), "piano": dict(rev=0.32, delay=(0.75 * S.spb, 0.4, 3, 0.2)),
          "other": dict(rev=0.35, delay=(0.75 * S.spb, 0.45, 5, 0.3))}
    targets = {"vocals": -16.0, "bass": -18.0, "drums": -18.0, "piano": -19.5, "other": -19.5}
    order = ["vocals", "bass", "drums", "piano", "other"]
    return S, order, fx, targets


# ----------------------------------------------------------------------------------------
# mastering & output
# ----------------------------------------------------------------------------------------


def limit(x, ceiling, block=128, release=0.08):
    """Look-ahead peak limiter (block based, vectorised except for a cheap per-block release loop)."""
    from numpy.lib.stride_tricks import sliding_window_view
    n = x.shape[1]
    nb = -(-n // block)
    a = np.pad(np.abs(x).max(axis=0), (0, nb * block - n))
    g = np.minimum(1.0, ceiling / np.maximum(a.reshape(nb, block).max(axis=1), 1e-12))
    look = 2
    g = sliding_window_view(np.pad(g, (0, look), constant_values=1.0), look + 1).min(axis=1)
    coef = 1.0 - np.exp(-block / (release * SR))
    gs = np.empty_like(g)
    cur = 1.0
    for i in range(nb):
        cur = cur + (1.0 - cur) * coef
        if g[i] < cur:
            cur = g[i]
        gs[i] = cur
    gs = np.minimum(gs, np.convolve(np.pad(gs, 1, mode="edge"), [0.25, 0.5, 0.25], "valid"))
    centers = (np.arange(nb) + 0.5) * block
    gain = np.interp(np.arange(n), centers, gs)
    y = x * gain
    return ceiling * soft_clip(y / ceiling, 1.0) if np.max(np.abs(y)) > ceiling else y


CREST = {"drums": 9.5, "bass": 8.0, "guitar": 10.5, "vocals": 12.0, "piano": 12.0, "other": 11.5}


def active_rms(x, frame=2048):
    m = 0.5 * (x[0] + x[1])
    k = len(m) // frame
    fr = np.sqrt(np.mean(m[: k * frame].reshape(k, frame) ** 2, axis=1))
    act = fr > fr.max() * 10 ** (-35 / 20)
    return float(np.sqrt(np.mean(fr[act] ** 2)))


def finish(S, order, fx, targets):
    n = S.n
    stems = {}
    t = _t(n)
    fade = np.ones(n)
    k_in = int(0.004 * SR)
    fade[:k_in] = np.linspace(0, 1, k_in)
    f0 = n - int(S.fade * SR)
    fade[f0:] = np.cos(np.linspace(0, np.pi / 2, n - f0)) ** 2
    fade[-1] = 0.0
    for name in order:
        x = S.stems[name].buf.copy()
        p = fx.get(name, {})
        if "clip" in p:
            x = soft_clip(x / (np.max(np.abs(x)) + 1e-12), p["clip"])
        if "delay" in p:
            d, fb, taps, wet = p["delay"]
            x = pingpong(x, d, fb, taps, wet)
        if p.get("rev"):
            x = reverb(x, S.ir, p["rev"])
        x = filt(x, "hp", 40, taps=8191)
        x *= fade
        x *= 10 ** (targets[name] / 20) / (active_rms(x) + 1e-12)
        x = limit(x, 10 ** ((targets[name] + CREST[name]) / 20))
        x *= 10 ** (targets[name] / 20) / (active_rms(x) + 1e-12)
        stems[name] = x
    mix = sum(stems.values())
    peak = float(np.max(np.abs(mix)))
    gain = 10 ** (PEAK_TARGET_DB / 20) / peak
    for name in stems:
        stems[name] *= gain
    return stems, mix * gain


def write_wav(path, x):
    pcm = (np.clip(x.T, -1.0, 1.0) * 32767.0).round().astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def ffmpeg_bin():
    for c in (shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if c and os.path.exists(c):
            return c
    sys.exit("ffmpeg not found")


def encode_mp3(wav, mp3):
    subprocess.run([ffmpeg_bin(), "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libmp3lame",
                    "-b:a", MP3_BITRATE, "-ar", str(SR), "-ac", "2", str(mp3)], check=True)


def song_entry(S, order):
    stems = []
    for sid in order:
        label, color = STEM_META[sid]
        stems.append({"id": sid, "label": label, "instrument": sid,
                      "file": f"songs/{S.id}/{sid}.mp3", "color": color})
    return {"id": S.id, "title": S.title, "artist": "StemStage Demo", "bpm": S.bpm,
            "duration": round(S.n / SR, 2), "source": "demo", "stems": stems}


BUILDERS = {"neon-nights": build_neon, "funky-freitag": build_funk, "mondlicht": build_mond}


def main():
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(root / "app" / "songs"), help="output songs directory")
    ap.add_argument("--only", action="append", choices=list(BUILDERS), help="render only this song")
    ap.add_argument("--mixdown", help="directory for full-mix mp3s (for listening checks)")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / "songs.json"
    existing = {"songs": []}
    if json_path.exists():
        try:
            existing = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            print("warning: songs.json unreadable, recreating", file=sys.stderr)
    old_by_id = {s.get("id"): s for s in existing.get("songs", [])}

    todo = args.only or list(BUILDERS)
    new_entries = {}
    with tempfile.TemporaryDirectory() as tmp:
        for sid in todo:
            t0 = time.time()
            S, order, fx, targets = BUILDERS[sid]()
            stems, mix = finish(S, order, fx, targets)
            sdir = out / sid
            sdir.mkdir(parents=True, exist_ok=True)
            for name in order:
                wav = Path(tmp) / f"{sid}-{name}.wav"
                write_wav(wav, stems[name])
                encode_mp3(wav, sdir / f"{name}.mp3")
            for f in sdir.glob("*.mp3"):
                if f.stem not in order:
                    f.unlink()
            if args.mixdown:
                md = Path(args.mixdown)
                md.mkdir(parents=True, exist_ok=True)
                wav = Path(tmp) / f"{sid}-mix.wav"
                write_wav(wav, mix)
                encode_mp3(wav, md / f"{sid}-mix.mp3")
                shutil.copy(wav, md / f"{sid}-mix.wav")
            new_entries[sid] = song_entry(S, order)
            print(f"{sid}: {S.n / SR:.2f}s, {len(order)} stems, mix peak "
                  f"{20 * np.log10(np.max(np.abs(mix))):.2f} dBFS, {time.time() - t0:.1f}s")

    demo = []
    for sid in BUILDERS:
        if sid in new_entries:
            demo.append(new_entries[sid])
        elif sid in old_by_id and old_by_id[sid].get("source") == "demo":
            demo.append(old_by_id[sid])
    keep = [s for s in existing.get("songs", []) if s.get("source") != "demo" and s.get("id") not in BUILDERS]
    data = dict(existing)
    data["songs"] = demo + keep
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {json_path} ({len(demo)} demo + {len(keep)} other songs)")


if __name__ == "__main__":
    main()
