#!/usr/bin/env python3
"""Hybrid Demucs (htdemucs_ft + htdemucs_6s) stem separator with STFT Wiener soft-masking and bleed gate."""

from __future__ import annotations

import argparse
import gc
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import scipy.signal
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

TARGET_SR = 44100
TARGET_CHANNELS = 2
PEAK_BUCKETS = 240

CANONICAL_STEM_ORDER = ["vocals", "guitar", "bass", "drums", "keys"]
STEM_META: dict[str, dict[str, str]] = {
    "vocals": {"label": "Gesang", "shortLabel": "Gesang", "color": "#f43f5e"},
    "guitar": {"label": "E-Gitarre", "shortLabel": "Gitarre", "color": "#f97316"},
    "bass": {"label": "E-Bass", "shortLabel": "Bass", "color": "#10b981"},
    "drums": {"label": "Schlagzeug", "shortLabel": "Drums", "color": "#38bdf8"},
    "keys": {"label": "Keyboard / Synth", "shortLabel": "Keys", "color": "#a855f7"},
}


def find_ffmpeg() -> str:
    """Locate the ffmpeg executable across PATH and common macOS/Windows/Linux install paths."""
    found = shutil.which("ffmpeg")
    if found:
        return found

    candidates: list[Path] = []
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.append(Path(local_app_data) / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe")
        candidates.extend(
            [
                Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe",
                Path.home() / "scoop" / "shims" / "ffmpeg.exe",
                Path("C:/Program Files/ShareX/ffmpeg.exe"),
            ]
        )
    else:
        candidates.extend(
            [
                Path("/opt/homebrew/bin/ffmpeg"),
                Path("/usr/local/bin/ffmpeg"),
                Path("/usr/bin/ffmpeg"),
            ]
        )

    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    raise FileNotFoundError(
        "ffmpeg executable not found in PATH or standard installation directories."
    )


def load_audio_stereo_44k(input_path: Path, ffmpeg_bin: str) -> np.ndarray:
    """Decode input audio into a float32 stereo numpy array shaped (2, N) at 44100 Hz."""
    if not input_path.is_file():
        raise FileNotFoundError(f"Input audio file does not exist: {input_path}")

    try:
        data, sr = sf.read(str(input_path), dtype="float32", always_2d=True)
        if sr == TARGET_SR and data.shape[0] > 0:
            if data.shape[1] == 1:
                data = np.repeat(data, 2, axis=1)
            elif data.shape[1] > 2:
                data = data[:, :2]
            return np.ascontiguousarray(data.T, dtype=np.float32)
    except Exception:
        pass

    cmd = [
        ffmpeg_bin,
        "-nostdin",
        "-v",
        "error",
        "-i",
        str(input_path),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ar",
        str(TARGET_SR),
        "-ac",
        str(TARGET_CHANNELS),
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg failed decoding {input_path}: {stderr}")

    raw = np.frombuffer(proc.stdout, dtype="<f4")
    if raw.size == 0 or raw.size % TARGET_CHANNELS != 0:
        raise RuntimeError(f"Decoded audio from {input_path} is empty or malformed.")

    audio = raw.reshape(-1, TARGET_CHANNELS).T.copy()
    return np.ascontiguousarray(audio, dtype=np.float32)


def _test_mps_model(model: torch.nn.Module) -> tuple[bool, str]:
    """Run a tiny dummy tensor through Demucs on MPS to verify spectral ops work."""
    try:
        dummy = torch.zeros((1, TARGET_CHANNELS, int(TARGET_SR * 1.5)), dtype=torch.float32)
        with torch.no_grad():
            _ = apply_model(model, dummy, shifts=0, split=False, progress=False, device="mps")
        if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
            torch.mps.empty_cache()
        return True, ""
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def resolve_device(requested: str, probe_model: torch.nn.Module) -> torch.device:
    """Resolve torch compute device with safe CUDA/MPS probing and CPU fallback."""
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("Requested --device cuda, but torch.cuda.is_available() is False.")
        return torch.device("cuda")

    if requested == "cpu":
        return torch.device("cpu")

    if requested == "mps":
        if not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
            raise RuntimeError("Requested --device mps, but MPS backend is unavailable.")
        ok, err = _test_mps_model(probe_model)
        if not ok:
            raise RuntimeError(f"Requested --device mps, but dummy Demucs pass failed: {err}")
        return torch.device("mps")

    # auto
    if torch.cuda.is_available():
        return torch.device("cuda")

    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        ok, err = _test_mps_model(probe_model)
        if ok:
            return torch.device("mps")
        print(f"[device] MPS dummy pass failed ({err}); falling back to CPU.", file=sys.stderr)

    return torch.device("cpu")


def release_device_memory(device: torch.device) -> None:
    """Release cached device allocations between sequential model passes."""
    gc.collect()
    if device.type == "cuda" and torch.cuda.is_available():
        torch.cuda.empty_cache()
    elif device.type == "mps" and hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
        torch.mps.empty_cache()


def run_demucs_pass(
    model: torch.nn.Module,
    audio: np.ndarray,
    device: torch.device,
    shifts: int,
    overlap: float,
    segment: float | None = None,
) -> dict[str, np.ndarray]:
    """Run normalized Demucs separation and return {source_name: (2, N) float32 ndarray}."""
    wav = torch.from_numpy(audio)  # keep master tensor on CPU; Demucs streams chunks to device
    ref = wav.mean(0)
    mean = ref.mean()
    std = ref.std() + 1e-8
    norm_mix = ((wav - mean) / std)[None]

    candidate_segments: list[float | None] = [segment]
    if device.type == "cuda" and segment is None:
        candidate_segments.extend([5.5, 4.0, 2.5])

    out: torch.Tensor | None = None
    last_exc: Exception | None = None
    for idx, seg in enumerate(candidate_segments):
        try:
            if idx > 0:
                print(
                    f"[cuda] Retrying separation with reduced --segment {seg}s due to VRAM pressure...",
                    file=sys.stderr,
                )
                release_device_memory(device)
            with torch.no_grad():
                out = apply_model(
                    model,
                    norm_mix,
                    shifts=shifts,
                    overlap=overlap,
                    split=True,
                    segment=seg,
                    progress=True,
                    device=device,
                )
            break
        except RuntimeError as exc:
            msg = str(exc).lower()
            if device.type == "cuda" and "out of memory" in msg and idx + 1 < len(candidate_segments):
                last_exc = exc
                continue
            raise

    if out is None:
        assert last_exc is not None
        raise last_exc

    out = out[0].cpu() * std + mean
    return {
        src: np.ascontiguousarray(out[i].numpy(), dtype=np.float32)
        for i, src in enumerate(model.sources)
    }


def wiener_split_other(
    other_ft: np.ndarray,
    guitar_6s: np.ndarray,
    piano_6s: np.ndarray,
    other_6s: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Split htdemucs_ft 'other' into (guitar, keys) via STFT Wiener soft-masking.

    Guarantees guitar + keys == other_ft identically at every sample.
    """
    n_samples = other_ft.shape[1]
    stft_kw: dict[str, Any] = {
        "fs": TARGET_SR,
        "window": "hann",
        "nperseg": 4096,
        "noverlap": 3072,
        "axis": -1,
        "boundary": "zeros",
        "padded": True,
    }
    _, _, z_other = scipy.signal.stft(other_ft, **stft_kw)
    _, _, z_guitar = scipy.signal.stft(guitar_6s, **stft_kw)
    _, _, z_piano = scipy.signal.stft(piano_6s, **stft_kw)
    _, _, z_o6 = scipy.signal.stft(other_6s, **stft_kw)

    mag_g = np.abs(z_guitar)
    mag_rest = np.abs(z_piano) + np.abs(z_o6)
    mag_g_sq = mag_g * mag_g
    mag_rest_sq = mag_rest * mag_rest
    mask_guitar = mag_g_sq / (mag_g_sq + mag_rest_sq + 1e-10)

    _, guitar_rec = scipy.signal.istft(
        z_other * mask_guitar,
        fs=TARGET_SR,
        window="hann",
        nperseg=4096,
        noverlap=3072,
        time_axis=-1,
        freq_axis=-2,
        boundary=True,
    )

    if guitar_rec.shape[1] >= n_samples:
        guitar = np.ascontiguousarray(guitar_rec[:, :n_samples], dtype=np.float32)
    else:
        pad = n_samples - guitar_rec.shape[1]
        guitar = np.pad(guitar_rec, ((0, 0), (0, pad)), mode="constant").astype(np.float32)

    keys = np.ascontiguousarray(other_ft - guitar, dtype=np.float32)
    return guitar, keys


def estimate_bpm_from_drums(drums: np.ndarray, sr: int = TARGET_SR) -> int:
    """Deterministically estimate integer BPM in [60, 200] from drums onset envelope."""
    mono = drums.mean(axis=0).astype(np.float64)
    if mono.size < sr // 2 or float(np.max(np.abs(mono))) < 1e-6:
        return 120

    nperseg = 2048
    hop = 256
    freqs, _, zxx = scipy.signal.stft(
        mono,
        fs=sr,
        window="hann",
        nperseg=nperseg,
        noverlap=nperseg - hop,
        boundary=None,
        padded=False,
    )
    power = np.abs(zxx) ** 2
    if power.shape[1] < 32:
        return 120

    # Multi-band log-compressed onset flux balances kick/snare weight vs. quiet hi-hats.
    band_specs = (
        (30.0, 140.0, 1.2),
        (140.0, 350.0, 1.1),
        (350.0, 900.0, 1.0),
        (900.0, 2500.0, 1.0),
        (2500.0, 6500.0, 0.7),
        (6500.0, 14000.0, 0.4),
    )
    band_fluxes: list[np.ndarray] = []
    for lo_hz, hi_hz, weight in band_specs:
        mask = (freqs >= lo_hz) & (freqs < hi_hz)
        if not np.any(mask):
            continue
        band_amp = np.sqrt(np.mean(power[mask], axis=0))
        scale = float(np.percentile(band_amp, 95)) + 1e-9
        compressed = np.log1p(8.0 * band_amp / scale)
        band_fluxes.append(weight * np.maximum(0.0, np.diff(compressed)))

    if not band_fluxes:
        return 120
    flux = np.convolve(np.sum(band_fluxes, axis=0), np.array([0.25, 0.5, 0.25]), mode="same")

    # Subtract local moving average (~0.35s) to isolate percussive transients.
    env_sr = sr / float(hop)
    win = max(3, int(round(0.35 * env_sr)) | 1)
    kernel = np.ones(win, dtype=np.float64) / win
    local_mean = np.convolve(flux, kernel, mode="same")
    onset = np.maximum(0.0, flux - local_mean)

    energy = float(np.sum(onset * onset))
    if energy <= 1e-12:
        return 120

    onset = onset - float(np.mean(onset))
    n_fft = 1 << int(math.ceil(math.log2(2 * onset.size)))
    acf = np.fft.irfft(np.abs(np.fft.rfft(onset, n=n_fft)) ** 2, n=n_fft)[: onset.size]
    if acf[0] <= 1e-12:
        return 120
    acf = acf / acf[0]

    min_bpm = 60
    max_bpm = 200
    bpms = np.arange(float(min_bpm), float(max_bpm) + 0.5, 0.5)
    lags = 60.0 * env_sr / bpms
    if np.max(lags) >= acf.size - 1:
        valid = lags < (acf.size - 1)
        if not np.any(valid):
            return 120
        bpms = bpms[valid]
        lags = lags[valid]

    lag_axis = np.arange(acf.size, dtype=np.float64)
    a1 = np.interp(lags, lag_axis, acf)
    a2 = np.interp(2.0 * lags, lag_axis, acf, left=0.0, right=0.0)
    prior = np.exp(-0.5 * (np.log2(bpms / 125.0) / 0.75) ** 2)
    scores = (a1 + 0.35 * a2) * (0.90 + 0.10 * prior)

    best_idx = int(np.argmax(scores))
    best_bpm = float(bpms[best_idx])

    # If the 2x tempo has nearly identical autocorrelation strength (>= 88%),
    # best_bpm was a 2x subharmonic (e.g. 70 vs 140 BPM or 93 vs 186 BPM).
    if best_bpm * 2.0 <= float(max_bpm):
        dbl_bpm = best_bpm * 2.0
        dbl_a = float(np.interp(60.0 * env_sr / dbl_bpm, lag_axis, acf))
        if dbl_a >= 0.88 * float(a1[best_idx]):
            best_bpm = dbl_bpm

    return int(max(min_bpm, min(max_bpm, round(best_bpm))))


def compute_rms_db(stem: np.ndarray) -> float:
    """Compute overall RMS level in dBFS rounded to 1 decimal place."""
    rms = float(np.sqrt(np.mean(np.square(stem, dtype=np.float64))))
    db = 20.0 * math.log10(max(rms, 1e-6))
    return round(max(-120.0, db), 1)


def compute_raw_peaks(stem: np.ndarray, buckets: int = PEAK_BUCKETS) -> list[float]:
    """Compute 240 unnormalized 98th-percentile amplitude buckets from mono signal."""
    mono = np.abs(stem.mean(axis=0))
    chunks = np.array_split(mono, buckets)
    return [float(np.percentile(chunk, 98)) if chunk.size > 0 else 0.0 for chunk in chunks]


def encode_stem_mp3(
    stem: np.ndarray,
    mp3_path: Path,
    tmp_wav_path: Path,
    ffmpeg_bin: str,
) -> None:
    """Write temporary 44.1 kHz stereo WAV and encode 160 kbps MP3 via ffmpeg."""
    safe = np.clip(stem, -1.0, 1.0).T
    sf.write(str(tmp_wav_path), safe, TARGET_SR, subtype="FLOAT")

    cmd = [
        ffmpeg_bin,
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-i",
        str(tmp_wav_path),
        "-ar",
        str(TARGET_SR),
        "-ac",
        str(TARGET_CHANNELS),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "160k",
        str(mp3_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg failed encoding {mp3_path}: {stderr}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Separate a song into 4 or 5 stems using htdemucs_ft + htdemucs_6s with STFT Wiener split and bleed gate."
    )
    parser.add_argument("--input", required=True, type=Path, help="Path to input audio file (WAV/FLAC/MP3/etc.)")
    parser.add_argument("--slug", required=True, help="Song slug/id (e.g. american-idiot)")
    parser.add_argument("--title", required=True, help="Song display title")
    parser.add_argument("--artist", required=True, help="Song artist")
    parser.add_argument("--youtube-id", default="", help="Source YouTube video ID")
    parser.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help="Output directory for stem MP3s and song.json (e.g. site/songs/<slug>)",
    )
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "mps", "cpu"],
        default="auto",
        help="Compute device (default: auto)",
    )
    parser.add_argument("--shifts", type=int, default=4, help="Demucs random shift count (default: 4)")
    parser.add_argument("--overlap", type=float, default=0.25, help="Demucs chunk overlap (default: 0.25)")
    parser.add_argument(
        "--segment",
        type=float,
        default=None,
        help="Optional Demucs chunk length in seconds (auto-reduced on CUDA OOM if omitted)",
    )
    stem_mode = parser.add_mutually_exclusive_group()
    stem_mode.add_argument(
        "--auto-stems",
        action="store_true",
        default=True,
        help="Enable bleed gate to keep 4 stems when keys energy is negligible (default)",
    )
    stem_mode.add_argument(
        "--force-5-stems",
        action="store_true",
        default=False,
        help="Always emit all 5 stems including keys, bypassing the bleed gate",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ffmpeg_bin = find_ffmpeg()

    print(f"[load] Decoding audio: {args.input}")
    audio = load_audio_stereo_44k(args.input, ffmpeg_bin)
    duration = round(audio.shape[1] / float(TARGET_SR), 2)
    print(f"[load] Stereo 44100 Hz float32: {audio.shape[1]} samples ({duration:.2f}s)")

    print("[model] Loading htdemucs_ft...")
    model_ft = get_model("htdemucs_ft")
    device = resolve_device(args.device, model_ft)
    print(f"[device] Using {device}")

    print(f"[separate] Running htdemucs_ft (shifts={args.shifts}, overlap={args.overlap})...")
    stems_ft = run_demucs_pass(
        model_ft,
        audio,
        device=device,
        shifts=args.shifts,
        overlap=args.overlap,
        segment=args.segment,
    )
    model_ft.cpu()
    del model_ft
    release_device_memory(device)

    print("[model] Loading htdemucs_6s...")
    model_6s = get_model("htdemucs_6s")
    if device.type == "mps":
        ok_6s, err_6s = _test_mps_model(model_6s)
        if not ok_6s:
            print(f"[device] htdemucs_6s MPS check failed ({err_6s}); running 6s pass on CPU.", file=sys.stderr)
            device_6s = torch.device("cpu")
        else:
            device_6s = device
    else:
        device_6s = device

    print(f"[separate] Running htdemucs_6s on {device_6s} (shifts={args.shifts}, overlap={args.overlap})...")
    stems_6s = run_demucs_pass(
        model_6s,
        audio,
        device=device_6s,
        shifts=args.shifts,
        overlap=args.overlap,
        segment=args.segment,
    )
    model_6s.cpu()
    del model_6s
    release_device_memory(device_6s)

    vocals = stems_ft["vocals"]
    drums = stems_ft["drums"]
    bass = stems_ft["bass"]
    other_ft = stems_ft["other"]

    guitar_6s = stems_6s["guitar"]
    piano_6s = stems_6s["piano"]
    other_6s = stems_6s["other"]

    print("[post] Splitting htdemucs_ft 'other' via STFT Wiener soft-masking (nperseg=4096, noverlap=3072)...")
    guitar_split, keys_split = wiener_split_other(other_ft, guitar_6s, piano_6s, other_6s)

    piano_rms = float(np.sqrt(np.mean(np.square(piano_6s, dtype=np.float64))))
    piano_rms_db = float(20.0 * math.log10(piano_rms + 1e-9))
    keys_energy = float(np.sum(np.square(keys_split, dtype=np.float64)))
    other_energy = float(np.sum(np.square(other_ft, dtype=np.float64)))
    keys_energy_ratio = keys_energy / (other_energy + 1e-9)

    gate_triggered = (not args.force_5_stems) and (
        piano_rms_db < -30.0 and keys_energy_ratio < 0.12
    )
    decision = "4 stems (merged keys -> guitar)" if gate_triggered else "5 stems (vocals, guitar, bass, drums, keys)"
    print(
        f"[bleed-gate] piano_6s_rms={piano_rms_db:.2f} dBFS (< -30.0), "
        f"keys_energy_ratio={keys_energy_ratio:.4f} (< 0.12), "
        f"force_5_stems={args.force_5_stems} -> {decision}"
    )

    final_stems: dict[str, np.ndarray] = {
        "vocals": vocals,
        "guitar": other_ft if gate_triggered else guitar_split,
        "bass": bass,
        "drums": drums,
    }
    if not gate_triggered:
        final_stems["keys"] = keys_split

    bpm = estimate_bpm_from_drums(drums, TARGET_SR)
    print(f"[tempo] Estimated BPM from drums: {bpm}")

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    if gate_triggered:
        stale_keys = out_dir / "keys.mp3"
        if stale_keys.exists():
            stale_keys.unlink()

    raw_peaks_by_stem = {
        stem_id: compute_raw_peaks(stem_audio, PEAK_BUCKETS)
        for stem_id, stem_audio in final_stems.items()
    }
    global_peak_max = max(
        max((max(vals) for vals in raw_peaks_by_stem.values()), default=0.0),
        0.02,
    )

    stem_entries: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix=f"stem-stage-{args.slug}-") as tmp_dir:
        tmp_root = Path(tmp_dir)
        for stem_id in CANONICAL_STEM_ORDER:
            if stem_id not in final_stems:
                continue
            stem_audio = final_stems[stem_id]
            mp3_path = out_dir / f"{stem_id}.mp3"
            tmp_wav_path = tmp_root / f"{stem_id}.wav"

            print(f"[encode] Writing {mp3_path.name} (160 kbps MP3)...")
            encode_stem_mp3(stem_audio, mp3_path, tmp_wav_path, ffmpeg_bin)

            peaks = [
                round(max(0.0, min(1.0, val / global_peak_max)), 4)
                for val in raw_peaks_by_stem[stem_id]
            ]
            meta = STEM_META[stem_id]
            stem_entries.append(
                {
                    "id": stem_id,
                    "label": meta["label"],
                    "shortLabel": meta["shortLabel"],
                    "color": meta["color"],
                    "url": f"./songs/{args.slug}/{stem_id}.mp3",
                    "rmsDb": compute_rms_db(stem_audio),
                    "peaks": peaks,
                }
            )

    manifest = {
        "id": args.slug,
        "title": args.title,
        "artist": args.artist,
        "duration": duration,
        "bpm": bpm,
        "source": {
            "youtubeId": args.youtube_id,
            "model": "htdemucs_ft+htdemucs_6s",
        },
        "stems": stem_entries,
    }

    manifest_path = out_dir / "song.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[done] Wrote {manifest_path} with {len(stem_entries)} stems.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
