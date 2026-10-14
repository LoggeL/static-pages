#!/usr/bin/env python3
"""Rohbilder (Codex-Imagegen) -> nahtlose PBR-Sets (albedo/normal/orm) fuer die Bodycam-Demo.

Usage: python3 -I process.py <rawdir> <outdir> [id ...] [--preview <dir>]
  rawdir:  <id>_v1.png (siehe gen.py)
  outdir:  public/bodycam-demo/textures  ->  <id>/albedo.jpg, normal.jpg, orm.jpg + index.json (merge)

Pipeline je Material:
  1. De-Lighting: grossskalige Helligkeitsgradienten (linearer Raum) herausdividieren.
  2. Nahtlos: Quilting-Ueberlappung mit Min-Cut (zyklischer DP-Pfad, keine Geisterbilder).
     grid  = Fliesen/Ziegel: Perioden per Autokorrelation, Ueberlappung phasengleich (ganze Perioden).
     cols  = Dielen/Bretter: x exakt an Fugen beschnitten, y je Brett gerader Schnitt (= Stoss).
     rows  = Siding/Schindeln: y an Ueberlappungslinien beschnitten, x je Reihe gerader Schnitt.
     stoch = freier Min-Cut in x und y.
  3. Upscale (Lanczos, periodisch) + leichtes Nachschaerfen.
  4. Hoehe aus Luminanz-Hochpass (+ Materialmasken) -> Normal (OpenGL, +Y), AO aus Kavitaet,
     Roughness/Metalness je Material, ORM = (AO, Rough, Metal).
"""
import argparse, json, math, os, sys
import numpy as np
import cv2
from PIL import Image, ImageFile

NQ = 80  # JPEG-Qualitaet Normal Maps
ImageFile.MAXBLOCK = 1 << 25  # sonst 'Suspension not allowed here' bei optimize=True

# --------------------------------------------------------------------------- Material-Konfiguration
# frame: Kantenlaenge des Roh-Bildes in Metern (laut Prompt) fuer stoch/cols/rows-Faelle
# period: physikalische Periode (m) bei grid/cols/rows, count: erwartete Anzahl Perioden im Rohbild
C = {
    'concrete_floor':      dict(size=2048, mode='stoch', frame=2.0, rough=(0.82, 0.10), nstr=1.4, dl=0.85, flatten=0.45),
    'asphalt_wet':         dict(size=2048, mode='stoch', frame=2.0, rough=(0.38, 0.30), nstr=2.6, dl=0.7, wet=True),
    'grass_dead':          dict(size=2048, mode='stoch', frame=2.0, rough=(0.88, 0.08), nstr=3.0, dl=0.8),
    'dirt_mud':            dict(size=2048, mode='stoch', frame=2.0, rough=(0.62, 0.30), nstr=2.6, dl=0.7, wet=True),
    'wood_floor_worn':     dict(size=2048, mode='cols', frame=1.6, xcount=13.5, period=0.12, rough=(0.55, 0.22), nstr=1.6, dl=0.6),
    'carpet_stained':      dict(size=2048, mode='stoch', frame=1.5, rough=(0.96, 0.03), nstr=2.2, dl=0.7, flatten=0.35),
    'tile_floor_dirty':    dict(size=2048, mode='grid', xcount=4, ycount=4, period=0.30, rough=(0.38, 0.12), nstr=2.0, dl=0.8, grout='dark', groutRough=0.92, rsign=-1),
    'tile_wall_white':     dict(size=2048, mode='grid', xcount=6, ycount=6, period=0.15, rough=(0.18, 0.08), nstr=2.0, dl=0.8, grout='dark', groutRough=0.88, rsign=-1),
    'wallpaper_peeling':   dict(size=2048, nsize=1024, mode='stoch', frame=1.5, rough=(0.80, 0.08), nstr=1.2, dl=0.8),
    'plaster_painted_dirty': dict(size=2048, nsize=1024, mode='stoch', frame=2.5, rough=(0.86, 0.06), nstr=1.0, dl=0.9, despeckle=0.10),
    'plaster_damaged':     dict(size=2048, mode='stoch', frame=2.0, rough=(0.88, 0.07), nstr=2.4, dl=0.75),
    'ceiling_stained':     dict(size=2048, nsize=1024, mode='stoch', frame=2.0, rough=(0.95, 0.04), nstr=2.0, dl=0.85, flatten=0.3, raw='v2'),
    'wood_door_painted':   dict(size=1024, mode='stoch', frame=1.0, rough=(0.45, 0.20), nstr=1.0, dl=0.85),
    'siding_vinyl_dirty':  dict(size=2048, nsize=1024, mode='rows', ycount=10, period=0.20, rough=(0.60, 0.15), nstr=2.0, dl=0.6, saw=1.6, rsign=-1),
    'roof_shingles':       dict(size=2048, nsize=1024, mode='rows', ycount=14.3, period=0.14, rough=(0.90, 0.06), nstr=3.0, dl=0.6, saw=0.8),
    'wood_trim_painted':   dict(size=1024, mode='stoch', frame=1.0, rough=(0.50, 0.25), nstr=1.6, dl=0.8),
    'metal_rusty':         dict(size=1024, mode='stoch', frame=1.0, rough=(0.70, 0.20), nstr=2.0, dl=0.8, metal='rust'),
    'fabric_sofa_dirty':   dict(size=1024, mode='stoch', frame=0.5, rough=(0.95, 0.03), nstr=2.0, dl=0.8),
    'mattress_stained':    dict(size=1024, mode='grid', xcount=6.5, ycount=6.5, period=1 / 6.5, rough=(0.92, 0.04), nstr=1.6, dl=0.8),
    'cardboard':           dict(size=1024, mode='stoch', frame=0.6, rough=(0.88, 0.06), nstr=1.0, dl=0.8),
    'laminate_counter':    dict(size=1024, mode='stoch', frame=1.0, rough=(0.32, 0.12), nstr=0.5, dl=0.9, rsign=-1,
                                patches=[(1003, 331, 34, -90, 60)]),  # Brandfleck (wiederholt sich auffaellig) uebermalen
    'cabinet_wood':        dict(size=1024, mode='stoch', frame=1.0, rough=(0.50, 0.15), nstr=0.8, dl=0.8),
    'brick_red':           dict(size=2048, mode='grid', xcount=5.7, ycount=9, period=0.134, rough=(0.88, 0.06), nstr=2.6, dl=0.6, grout='mortar', groutRough=0.95),
    'wood_planks_raw':     dict(size=2048, mode='cols', frame=1.5, xcount=10, period=0.15, rough=(0.85, 0.08), nstr=2.4, dl=0.6),
}

# --------------------------------------------------------------------------- Hilfen

def srgb2lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin2srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def lum(lin):
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def gblur_wrap(a, sigma):
    """Gauss-Blur mit periodischem Rand via FFT (2D oder 3D mit Kanaelen)."""
    if sigma <= 0:
        return a
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2 * (math.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    if a.ndim == 2:
        return np.fft.irfft2(np.fft.rfft2(a) * g, s=(h, w))
    return np.stack([np.fft.irfft2(np.fft.rfft2(a[..., c]) * g, s=(h, w)) for c in range(a.shape[2])], -1)


def gblur(a, sigma):
    k = int(sigma * 3) * 2 + 1
    return cv2.GaussianBlur(a.astype(np.float32), (k, k), sigma, borderType=cv2.BORDER_REFLECT)


def resize_wrap(a, size):
    h, w = a.shape[:2]
    p = 8
    pad = np.pad(a, ((p, p), (p, p), (0, 0)) if a.ndim == 3 else ((p, p), (p, p)), mode='wrap')
    sx, sy = size / w, size / h
    r = cv2.resize(pad.astype(np.float32), (round((w + 2 * p) * sx), round((h + 2 * p) * sy)), interpolation=cv2.INTER_LANCZOS4)
    ox, oy = round(p * sx), round(p * sy)
    r = r[oy:oy + size, ox:ox + size]
    if r.shape[0] != size or r.shape[1] != size:
        r = cv2.resize(r, (size, size), interpolation=cv2.INTER_LINEAR)
    return r


# --------------------------------------------------------------------------- Perioden / Linien

def find_period(L, axis, count, lo=0.75, hi=1.3):
    """Periode (px) entlang axis per normierter Korrelation der Hochpass-Luminanz mit verschobener Kopie."""
    hp = L - gblur(L, 25)
    n = L.shape[axis]
    p0 = n / count
    best, bp = -2, None
    for p in range(max(4, int(p0 * lo)), min(n // 2, int(p0 * hi)) + 1):
        if axis == 1:
            a, b = hp[:, :-p], hp[:, p:]
        else:
            a, b = hp[:-p], hp[p:]
        c = float(np.mean((a - a.mean()) * (b - b.mean())) / (a.std() * b.std() + 1e-9))
        if c > best:
            best, bp = c, p
    # Subpixel-Verfeinerung lohnt nicht; Rueckgabe in px
    return bp, best


def line_positions(L, axis, period):
    """Positionen dunkler Linien (Fugen) senkrecht zu axis. axis=1 -> Spaltenpositionen."""
    hp = L - gblur(L, max(3, period * 0.5))
    prof = hp.mean(axis=0 if axis == 1 else 1)
    prof = np.convolve(prof, np.ones(3) / 3, mode='same')
    n = len(prof)
    pos = []
    # lokale Minima mit Mindestabstand 0.6*Periode, gierig vom tiefsten Wert an
    order = np.argsort(prof)
    taken = np.zeros(n, bool)
    md = int(period * 0.6)
    for i in order:
        if prof[i] > np.percentile(prof, 35):
            break
        if taken[max(0, i - md):i + md + 1].any():
            continue
        pos.append(int(i))
        taken[i] = True
    return sorted(pos)


# --------------------------------------------------------------------------- Min-Cut-Quilting

def _dp_path(E, cyclic_len=None):
    """E: (L, w) Kosten. Pfad c[0..L-1] mit |dc|<=1. cyclic_len: c[0]==c[cyclic_len-1]."""
    L, w = E.shape
    inf = 1e18
    if cyclic_len is None:
        cost = E[0].copy()
        back = np.zeros((L, w), np.int8)
        for i in range(1, L):
            l = np.concatenate([[inf], cost[:-1]])
            r = np.concatenate([cost[1:], [inf]])
            st = np.stack([l, cost, r])
            k = np.argmin(st, 0)
            back[i] = k - 1
            cost = st[k, np.arange(w)] + E[i]
        c = np.zeros(L, int)
        c[-1] = int(np.argmin(cost))
        for i in range(L - 1, 0, -1):
            c[i - 1] = c[i] + back[i, c[i]]
        return c
    # zyklisch: alle Startpunkte parallel (Zustand [start, pos])
    Lc = cyclic_len
    cost = np.full((w, w), inf)
    cost[np.arange(w), np.arange(w)] = E[0]
    back = np.zeros((Lc, w, w), np.int8)
    for i in range(1, Lc):
        l = np.concatenate([np.full((w, 1), inf), cost[:, :-1]], 1)
        r = np.concatenate([cost[:, 1:], np.full((w, 1), inf)], 1)
        st = np.stack([l, cost, r])
        k = np.argmin(st, 0)
        back[i] = k - 1
        cost = np.take_along_axis(st, k[None], 0)[0] + E[i][None, :]
    # Ende muss neben dem Start liegen (Nachbar ueber den Umbruch)
    endc = np.full(w, inf)
    for d in (-1, 0, 1):
        idx = np.clip(np.arange(w) + d, 0, w - 1)
        endc = np.minimum(endc, cost[np.arange(w), idx] + (0 if d == 0 else 1e-6))
    s = int(np.argmin(endc))
    # bestes Ende zu diesem Start
    cands = [(cost[s, min(max(s + d, 0), w - 1)], min(max(s + d, 0), w - 1)) for d in (-1, 0, 1)]
    e = min(cands)[1]
    c = np.zeros(L, int)
    c[Lc - 1] = e
    for i in range(Lc - 1, 0, -1):
        c[i - 1] = c[i] + back[i, s, c[i]]
    # Rest (L > Lc) ungezwungen fortsetzen
    if L > Lc:
        cur = c[Lc - 1]
        for i in range(Lc, L):
            opts = [x for x in (cur - 1, cur, cur + 1) if 0 <= x < w]
            cur = min(opts, key=lambda x: E[i, x])
            c[i] = cur
    return c


def quilt_axis1(img, w, keep_len, margin=6, feather=2.0, err_src=None, segments=None, groove=None):
    """Macht img periodisch in x mit neuer Breite W=img.shape[1]-w.
    keep_len: Laenge (Zeilen), ueber die der Pfad zyklisch sein muss (endgueltige Hoehe), sonst None.
    segments: Liste (y0,y1) -> je Segment gerader Schnitt (statt Min-Cut-Pfad).
    groove: optionales Array (H,W) zum Markieren gerader Schnitte (Stoss-Fuge)."""
    H, N = img.shape[:2]
    W = N - w
    A = img[:, W:]
    B = img[:, :w]
    src = err_src if err_src is not None else img
    Ae, Be = gblur(src[:, W:], 1.5), gblur(src[:, :w], 1.5)
    E = ((Ae - Be) ** 2).sum(-1) if Ae.ndim == 3 else (Ae - Be) ** 2
    E = E.astype(np.float64)
    E[:, :margin] = 1e9
    E[:, w - margin:] = 1e9
    if segments is None:
        c = _dp_path(E, keep_len)
    else:
        c = np.zeros(H, int)
        Es = gblur(E.astype(np.float32), 3).astype(np.float64)
        for (y0, y1) in segments:
            colcost = Es[y0:y1].mean(0)
            c[y0:y1] = int(np.argmin(colcost))
    xs = np.arange(w)[None, :]
    m = (xs < c[:, None]).astype(np.float32)  # 1 -> A
    if feather > 0:
        m = cv2.GaussianBlur(m, (0, 0), sigmaX=feather, sigmaY=0.01 if segments is not None else feather)
        m[:, :2] = 1.0
        m[:, -2:] = 0.0
    out = img[:, :W].copy()
    mm = m[..., None] if img.ndim == 3 else m
    out[:, :w] = mm * A + (1 - mm) * B
    if groove is not None and segments is not None:
        g = groove[:, :W].copy()
        for (y0, y1) in segments:
            cc = c[y0]
            g[y0 + 2:y1 - 2, max(0, cc - 1):cc + 1] = 1.0
        return out, g
    return out, (groove[:, :W] if groove is not None else None)


def seamless(img, cfg, L, log):
    """img: float32 sRGB [0..1] HxWx3. Rueckgabe: nahtloses Bild, groove-Maske, tileMeters."""
    H, N = img.shape[:2]
    mode = cfg['mode']
    groove = np.zeros((H, N), np.float32)
    if mode == 'stoch':
        w = int(N * 0.13)
        Wt = N - w
        Ht = H - int(H * 0.13)
        side = min(Wt, Ht)
        wx, wy = N - side, H - side
        out, groove = quilt_axis1(img, wx, side, groove=groove)
        outT, gT = quilt_axis1(out.transpose(1, 0, 2), wy, side, groove=groove.T)
        tile = cfg['frame'] * side / N
        return outT.transpose(1, 0, 2), gT.T, tile
    if mode == 'grid':
        px, cx = find_period(L, 1, cfg['xcount'])
        py, cy = find_period(L, 0, cfg['ycount'])
        log(f'  period x={px}px (r={cx:.2f}) y={py}px (r={cy:.2f})')
        wmin = int(N * 0.08)
        kx = int((N - wmin) // px)
        ky = int((H - wmin) // py)
        # moeglichst quadratisch in Metern: gleiche phys. Groesse waehlen
        if cfg.get('xcount') != cfg.get('ycount'):
            # Ziegel: x-Periode = Ziegellaenge+Fuge, y-Periode = 2 Lagen; phys. Laenge je Periode aus Pixelverhaeltnis
            pass
        Wt, Ht = kx * px, ky * py
        out, groove = quilt_axis1(img, N - Wt, Ht, groove=groove)
        outT, gT = quilt_axis1(out.transpose(1, 0, 2), H - Ht, Wt, groove=groove.T)
        out = outT.transpose(1, 0, 2)
        # Meter: y-Periode ist bekannt (cfg.period), x skaliert mit
        tile_y = ky * cfg['period']
        tile_x = tile_y * Wt / Ht
        log(f'  grid {kx}x{ky} -> {Wt}x{Ht}px, tile {tile_x:.3f} x {tile_y:.3f} m')
        return out, gT.T, (tile_x + tile_y) / 2
    if mode == 'cols':
        px, cx = find_period(L, 1, cfg['xcount'])
        pos = line_positions(L, 1, px)
        log(f'  board period {px}px (r={cx:.2f}), gaps {pos}')
        # groesster Abschnitt Fuge..Fuge, moeglichst breit
        best = None
        for i in range(len(pos)):
            for j in range(i + 1, len(pos)):
                span = pos[j] - pos[i]
                if span <= H - int(H * 0.08) and (best is None or span > best[1] - best[0]):
                    best = (pos[i], pos[j])
        x0, x1 = best
        img = img[:, x0:x1]
        groove = groove[:, x0:x1]
        W = x1 - x0
        inner = [p - x0 for p in pos if x0 < p < x1]
        edges = [0] + inner + [W]
        segs = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
        outT, gT = quilt_axis1(img.transpose(1, 0, 2), H - W, None, segments=segs, groove=groove.T, feather=0.8)
        nb = len(segs)
        tile = nb * cfg['period']
        log(f'  {nb} boards, crop {W}px -> tile {tile:.3f} m')
        return outT.transpose(1, 0, 2), gT.T, tile
    if mode == 'rows':
        py, cy = find_period(L, 0, cfg['ycount'])
        pos = line_positions(L, 0, py)
        log(f'  row period {py}px (r={cy:.2f}), lines {pos}')
        best = None
        for i in range(len(pos)):
            for j in range(i + 1, len(pos)):
                span = pos[j] - pos[i]
                if span <= N - int(N * 0.08) and (best is None or span > best[1] - best[0]):
                    best = (pos[i], pos[j])
        y0, y1 = best
        img = img[y0:y1]
        groove = groove[y0:y1]
        Hh = y1 - y0
        inner = [p - y0 for p in pos if y0 < p < y1]
        edges = [0] + inner + [Hh]
        segs = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
        out, g = quilt_axis1(img, N - Hh, None, segments=segs, groove=groove, feather=0.8)
        saw = np.zeros(out.shape[:2], np.float32)
        for (a0, a1) in segs:  # Ueberlappung: Unterkante jeder Reihe steht vor (Lap-Siding/Schindeln)
            saw[a0:a1] = np.linspace(0, 1, a1 - a0, dtype=np.float32)[:, None]
        cfg['_saw'] = saw
        nr = len(segs)
        cfg['_nrows'] = nr
        tile = nr * cfg['period']
        log(f'  {nr} rows, crop {Hh}px -> tile {tile:.3f} m')
        return out, g, tile
    raise ValueError(mode)


# --------------------------------------------------------------------------- PBR-Ableitung

def delight(img, strength, sigma_frac=0.10):
    lin = srgb2lin(img)
    L = lum(lin)
    low = gblur(L, img.shape[0] * sigma_frac)
    gain = np.clip((low.mean() / np.maximum(low, 1e-4)) ** strength, 0.55, 1.8)
    return lin2srgb(lin * gain[..., None]).astype(np.float32)


def normalize01(a, lo=1, hi=99):
    a0, a1 = np.percentile(a, lo), np.percentile(a, hi)
    return np.clip((a - a0) / (a1 - a0 + 1e-9), 0, 1)


def build_maps(alb, cfg, groove, tid):
    S = alb.shape[0]
    lin = srgb2lin(alb)
    L = lum(lin)
    Ls = np.sqrt(np.maximum(L, 0))  # perzeptueller
    sc = S / 2048.0
    # Hoehe: Bandpass (fein + mittel)
    fine = Ls - gblur_wrap(Ls, 2.0 * sc)
    mid = gblur_wrap(Ls, 1.0 * sc) - gblur_wrap(Ls, 24 * sc)
    h = 0.45 * fine / (fine.std() + 1e-6) + 1.0 * mid / (mid.std() + 1e-6)
    hsv = cv2.cvtColor((alb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    sat = hsv[..., 1] / 255.0
    grout = None
    if cfg.get('grout') == 'mortar':
        # Moertel: unbunt + relativ hell gegen roten Ziegel
        m = normalize01(gblur_wrap(-sat, 1.5 * sc), 5, 95)
        grout = np.clip((m - 0.55) * 3.0, 0, 1)
        h = h * 0.6 - grout * 2.2
    elif cfg.get('grout') == 'dark':
        d = gblur_wrap(Ls, 30 * sc) - gblur_wrap(Ls, 1.5 * sc)
        grout = np.clip((d / (d.std() + 1e-6) - 0.8) * 0.8, 0, 1)
        h = h * 0.5 - grout * 2.5
    if groove is not None and groove.max() > 0:
        h = h - gblur_wrap(groove, 1.2 * sc) * 2.5
    if '_sawS' in cfg:
        h = h + cfg.pop('_sawS') * cfg['saw'] * cfg.pop('_rowpx') * 0.03
    h = gblur_wrap(h, 0.6 * sc)
    # Normal (OpenGL): n = (-dh/dx, +dh/drow, 1/strength)
    k = cfg['nstr'] * 0.25 * (2048 / S) ** 0.0
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-dx * k, dy * k, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # AO aus Kavitaet
    cav = gblur_wrap(h, 6 * sc) - h
    cav2 = gblur_wrap(h, 30 * sc) - h
    ao = 1 - np.clip(cav, 0, None) * 0.10 - np.clip(cav2, 0, None) * 0.06
    ao = np.clip(ao, 0.45, 1.0)
    # Roughness
    r0, rv = cfg['rough']
    ln = normalize01(Ls, 2, 98)
    rough = r0 + cfg.get('rsign', 1) * rv * (ln - 0.5) * 1.2 + 0.03 * np.clip(cav, 0, 2)
    if cfg.get('wet'):
        # dunklere (nassere) Bereiche glatter, Kanten/Steine rauer
        wet = normalize01(-gblur_wrap(Ls, 8 * sc), 5, 95)
        rough = r0 + rv * (0.5 - wet) * 1.4 + 0.10 * np.clip(fine / (fine.std() + 1e-6), 0, 2)
    if grout is not None:
        rough = rough * (1 - grout) + cfg.get('groutRough', 0.9) * grout
    if tid == 'wood_floor_worn':
        # helle abgelaufene Stellen = Lack weg -> rauer
        worn = normalize01(gblur_wrap(Ls, 6 * sc), 40, 99)
        rough = 0.42 + 0.35 * worn + 0.05 * (ln - 0.5)
    if tid in ('wood_door_painted', 'wood_trim_painted'):
        chips = normalize01(-Ls, 70, 99.5)  # dunkle Abplatzungen/Schmutz -> rau
        rough = r0 + 0.4 * chips + 0.05 * (ln - 0.5)
    metal = np.zeros_like(h)
    if cfg.get('metal') == 'rust':
        hue = hsv[..., 0] * 2  # Grad
        rusty = ((hue > 5) & (hue < 40)).astype(np.float32) * np.clip((sat - 0.25) * 4, 0, 1)
        rusty = np.clip(gblur_wrap(rusty, 2 * sc), 0, 1)
        bare = np.clip(1 - sat * 4, 0, 1) * np.clip((Ls - 0.35) * 4, 0, 1) * (1 - rusty)
        metal = 0.3 * rusty + 0.85 * bare  # Lackreste: dielektrisch
        rough = 0.88 * rusty + 0.45 * bare + 0.7 * (1 - rusty - bare).clip(0, 1) + 0.05 * (ln - 0.5)
    rough = np.clip(rough, 0.04, 1.0)
    orm = np.stack([ao, rough, metal], -1)
    return n * 0.5 + 0.5, orm


def save_jpg(path, a, q=88, sub=2):
    Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)).save(path, quality=q, subsampling=sub, optimize=True)


def process(tid, rawdir, outdir, prevdir, log):
    cfg = dict(C[tid])
    raw = Image.open(os.path.join(rawdir, f"{tid}_{cfg.get('raw', 'v1')}.png")).convert('RGB')
    img = np.asarray(raw).astype(np.float32) / 255.0
    for (px, py, r, dx, dy) in cfg.get('patches', []):
        # auffaellige Einzelmerkmale durch weich maskierte Kopie aus der Nachbarschaft ersetzen
        yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]]
        m = np.clip((r * 1.6 - np.hypot(xx - px, yy - py)) / (r * 0.6), 0, 1)[..., None]
        img = img * (1 - m) + np.roll(img, (-dy, -dx), (0, 1)) * m
    # quadratisch zuschneiden
    s = min(img.shape[:2])
    oy, ox = (img.shape[0] - s) // 2, (img.shape[1] - s) // 2
    img = img[oy:oy + s, ox:ox + s]
    if cfg.get('despeckle'):
        # kleine dunkle Einzelpunkte (Naegel-/Duebelloecher) entfernen: wuerden sich beim Kacheln als Raster wiederholen
        u8 = (img * 255).astype(np.uint8)
        med = np.stack([cv2.medianBlur(u8[..., c], 31) for c in range(3)], -1).astype(np.float32) / 255
        dark = (med.mean(-1) - img.mean(-1)) > cfg['despeckle']
        n, lab, st, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8))
        small = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] < 400])
        m = cv2.GaussianBlur(cv2.dilate(small.astype(np.float32), np.ones((7, 7), np.uint8)), (0, 0), 2)[..., None]
        img = img * (1 - m) + med * m
        log(f'  despeckle: {int(small.sum())} px')
    img = delight(img, cfg['dl'])
    L = lum(srgb2lin(img)).astype(np.float32)
    tile_img, groove, tile = seamless(img, cfg, L, log)
    size = cfg['size']
    alb = resize_wrap(tile_img, size)
    gr = resize_wrap(groove, size) if groove is not None else None
    if cfg.get('flatten'):
        # grosse Flecken abschwaechen -> weniger auffaellige Wiederholung
        lin = srgb2lin(alb)
        low = gblur_wrap(lin, size * 0.03)
        gain = np.clip((lin.reshape(-1, 3).mean(0) / np.maximum(low, 1e-4)) ** cfg['flatten'], 0.5, 2.0)
        alb = lin2srgb(lin * gain).astype(np.float32)
    if '_saw' in cfg:
        sw = cfg.pop('_saw')
        cfg['_sawS'] = cv2.resize(sw, (size, size), interpolation=cv2.INTER_NEAREST)
        cfg['_rowpx'] = size / max(1, cfg.get('_nrows', 8))
    # Nachschaerfen (Upscale kompensieren), periodisch
    sharp = 0.35 if size > tile_img.shape[0] else 0.15
    alb = np.clip(alb + sharp * (alb - gblur_wrap(alb, 1.2)), 0, 1)
    if gr is not None and gr.max() > 0:
        # kuenstliche Stoesse leicht abdunkeln
        g = np.clip(gblur_wrap(gr, 0.8), 0, 1)[..., None]
        alb = alb * (1 - 0.35 * g)
    nrm, orm = build_maps(alb.astype(np.float32), cfg, gr, tid)
    d = os.path.join(outdir, tid)
    os.makedirs(d, exist_ok=True)
    # Groessenbudget: Albedo voll, Normal voll (4:2:0), ORM halbe Aufloesung (Rauheit/AO sind niederfrequent)
    save_jpg(os.path.join(d, 'albedo.jpg'), alb, 86, 2)
    nsz = cfg.get('nsize', size)
    nrm_s = nrm if nsz == size else cv2.resize(nrm.astype(np.float32), (nsz, nsz), interpolation=cv2.INTER_AREA)
    save_jpg(os.path.join(d, 'normal.jpg'), nrm_s, NQ, 2)
    osz = max(512, size // 2)
    orm_s = cv2.resize(orm.astype(np.float32), (osz, osz), interpolation=cv2.INTER_AREA)
    save_jpg(os.path.join(d, 'orm.jpg'), orm_s, 86, 0)
    if prevdir:
        os.makedirs(prevdir, exist_ok=True)
        small = cv2.resize(alb.astype(np.float32), (512, 512), interpolation=cv2.INTER_AREA)
        t = np.tile(small, (2, 2, 1))
        Image.fromarray((t * 255).astype(np.uint8)).save(os.path.join(prevdir, f'{tid}_2x2.jpg'), quality=85)
        ns = cv2.resize(nrm.astype(np.float32), (512, 512), interpolation=cv2.INTER_AREA)
        os_ = cv2.resize(orm.astype(np.float32), (512, 512), interpolation=cv2.INTER_AREA)
        strip = np.concatenate([small, ns, os_[..., [1, 1, 1]], os_[..., [0, 0, 0]]], 1)
        Image.fromarray((np.clip(strip, 0, 1) * 255).astype(np.uint8)).save(os.path.join(prevdir, f'{tid}_maps.jpg'), quality=85)
    return dict(tileMeters=round(float(tile), 3), size=size, maps=['albedo', 'normal', 'orm'],
                sizes=dict(albedo=size, normal=nsz, orm=osz))


def dump_index(index):
    def block(d, ind):
        return '{\n' + ',\n'.join(f'{ind}{json.dumps(k)}: {json.dumps(v, separators=(", ", ": "))}' for k, v in d.items()) + '\n' + ind[:-2] + '}'
    body = [f'  {json.dumps(k)}: {json.dumps(v, separators=(", ", ": "))}' for k, v in index.items() if k != 'decals']
    if 'decals' in index:
        body.append('  "decals": ' + block(index['decals'], '    '))
    return '{\n' + ',\n'.join(body) + '\n}\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('rawdir')
    ap.add_argument('outdir')
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--preview')
    a = ap.parse_args()
    ids = a.ids or [k for k in C if os.path.exists(os.path.join(a.rawdir, f"{k}_{C[k].get('raw', 'v1')}.png"))]
    ip = os.path.join(a.outdir, 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    for tid in ids:
        print(tid, flush=True)
        index[tid] = process(tid, a.rawdir, a.outdir, a.preview, lambda s: print(s, flush=True))
        print('  ->', index[tid], flush=True)
    os.makedirs(a.outdir, exist_ok=True)
    order = {k: i for i, k in enumerate(C)}
    out = {k: index[k] for k in sorted((k for k in index if k != 'decals'), key=lambda k: order.get(k, 999))}
    if 'decals' in index:
        out['decals'] = index['decals']
    # kompakt: ein Eintrag pro Zeile
    with open(ip, 'w') as f:
        f.write(dump_index(out))


if __name__ == '__main__':
    main()
