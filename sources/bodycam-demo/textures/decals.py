#!/usr/bin/env python3
"""Decal-Rohbilder (Codex-Imagegen, d_<id>_v1.png) -> RGBA-PNG mit sauberer Alpha fuer die Bodycam-Demo.

Usage: python3 -I decals.py <rawdir> <outdir> [id ...] [--preview <dir>]
  outdir = public/bodycam-demo/textures  ->  decals/<id>.png (+ decals/<id>_normal.png bei Einschuessen),
  Eintrag in index.json unter "decals".

Modi:
  white : Motiv auf weissem Grund. Hintergrund = Ebene aus dem Randstreifen, Alpha = kleinstmoegliche Deckung,
          bei der die Vordergrundfarbe nicht negativ wird (Entmischen, wirkt wie Multiplizieren auf hellem Grund).
  green : Chroma-Key (Papier auf Gruen) inkl. Despill.
  hole  : Einschuss auf Materialgrund. Alpha = Abweichung vom Materialgrund (rauschnormiert) * radialer Ausblendung
          + voll deckender Kern; dazu Normal Map (Hoehe aus Luminanz + Kraterschale).
Ausgabe: Motiv-Bounding-Box quadratisch gepolstert, Farbe in transparente Bereiche ausgeblutet (keine dunklen Saeume).
"""
import argparse, json, math, os
import numpy as np
import cv2
from PIL import Image

# frameW: Breite des Rohbildes in Metern (Massstab aus dem Prompt bzw. Motivgroesse geschaetzt)
D = {
    'bullet_hole_plaster':  dict(mode='hole', frameW=0.15, out=512, depth=1.0, rough=0.9, metal=0.0, surface='plaster'),
    'bullet_hole_wood':     dict(mode='hole', frameW=0.15, out=512, depth=1.0, rough=0.8, metal=0.0, surface='wood'),
    'bullet_hole_concrete': dict(mode='hole', frameW=0.15, out=512, depth=1.2, rough=0.9, metal=0.0, surface='concrete'),
    'bullet_hole_metal':    dict(mode='hole', frameW=0.12, out=512, depth=0.8, rough=0.45, metal=0.6, surface='metal'),
    'blood_splatter':       dict(mode='white', frameW=1.0, out=1024, rough=0.35, metal=0.0, tint=(0.8, 0.55, 0.6)),
    'water_stain':          dict(mode='white', frameW=1.6, out=1024, rough=0.9, metal=0.0, desat=0.45, tint=(0.85, 0.74, 0.6), alphaMul=1.0, agamma=1.7, afeather=1.5),
    'grime_corner':         dict(mode='white', frameW=0.8, out=1024, rough=0.9, metal=0.0, edge='bl', desat=0.3),
    'mold_patch':           dict(mode='white', frameW=0.8, out=1024, rough=0.95, metal=0.0, desat=0.5, tint=(0.75, 0.75, 0.7)),
    'graffiti_1':           dict(mode='white', frameW=1.8, out=1024, rough=0.6, metal=0.0),
    'graffiti_2':           dict(mode='white', frameW=1.8, out=1024, rough=0.6, metal=0.0),
    'footprints_mud':       dict(mode='white', frameW=0.67, out=1024, rough=0.7, metal=0.0, desat=0.25, tint=(0.8, 0.8, 0.8)),
    'papers_scattered':     dict(mode='green', frameW=1.04, out=1024, rough=0.85, metal=0.0),
}


def srgb2lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin2srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def blur(a, s):
    return cv2.GaussianBlur(a.astype(np.float32), (0, 0), s, borderType=cv2.BORDER_REFLECT)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def border_plane(img, band=0.05, skip=None):
    """Hintergrund als lineare Ebene je Kanal aus dem Randstreifen (robust: Ausreisser verworfen)."""
    H, W = img.shape[:2]
    b = max(4, int(min(H, W) * band))
    m = np.zeros((H, W), bool)
    m[:b] = m[-b:] = True
    m[:, :b] = m[:, -b:] = True
    if skip == 'bl':  # Schmutzkante unten/links ist Motiv, nicht Grund
        m[-b:] = False
        m[:, :b] = False
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    A = np.stack([np.ones(m.sum()), xx[m] / W, yy[m] / H], 1)
    out = np.zeros_like(img)
    for c in range(img.shape[2]):
        v = img[..., c][m]
        keep = np.abs(v - np.median(v)) < 3 * (np.median(np.abs(v - np.median(v))) * 1.4826 + 1e-3)
        coef, *_ = np.linalg.lstsq(A[keep], v[keep], rcond=None)
        out[..., c] = coef[0] + coef[1] * xx / W + coef[2] * yy / H
    resid = img[m] - out[m]
    sigma = float(np.median(np.abs(resid - np.median(resid, 0))) * 1.4826)
    return out, sigma


def bleed(rgb, a, iters=6):
    """Farbe in transparente Bereiche ausbluten (gegen dunkle Saeume beim Mipmapping)."""
    num = rgb * a[..., None]
    den = a.copy()
    out = rgb.copy()
    s = 2.0
    filled = a > 0.05
    for _ in range(iters):
        n2, d2 = blur(num, s), blur(den, s)
        fill = (~filled) & (d2 > 1e-4)
        out[fill] = n2[fill] / d2[fill][:, None]
        filled |= fill
        s *= 2
    rest = ~filled
    if rest.any():
        out[rest] = (num.reshape(-1, 3).sum(0) / max(den.sum(), 1e-6))
    return out


def unmix_white(img, cfg):
    lin = srgb2lin(img)
    bg, sig = border_plane(lin, skip=cfg.get('edge'))
    bg = np.clip(bg, 0.05, 1)
    a_raw = np.clip(((bg - lin) / bg).max(-1), 0, 1)
    t0 = max(0.025, sig * 4)
    a = smoothstep(t0, t0 + 0.06, a_raw) * a_raw
    F = (lin - (1 - a_raw[..., None]) * bg) / np.maximum(a_raw[..., None], 1e-3)
    F = np.clip(F, 0, 1)
    # bei geringer Deckung ist F verrauscht -> zur lokalen (alpha-gewichteten) Mittelfarbe ziehen
    Fm = blur(F * a_raw[..., None], 6) / np.maximum(blur(a_raw, 6), 1e-4)[..., None]
    w = smoothstep(0.05, 0.25, a_raw)[..., None]
    F = F * w + Fm * (1 - w)
    return lin2srgb(F), a


def key_green(img):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    spill = g - np.maximum(r, b)
    a = 1 - smoothstep(0.08, 0.30, spill)
    a = blur(a, 0.8)
    out = img.copy()
    out[..., 1] = np.minimum(g, np.maximum(r, b) * 1.02)  # Despill
    # Rand leicht erodieren (Gruensaum)
    a = np.clip((a - 0.15) / 0.85, 0, 1)
    return out, a


def hole(img, cfg):
    lin = srgb2lin(img)
    H, W = img.shape[:2]
    bg, sig = border_plane(lin, band=0.08)
    d = np.sqrt(((lin - bg) ** 2).sum(-1))
    db = blur(d, 3.0)
    ad = smoothstep(sig * 2.5, sig * 7 + 0.02, db)
    # Zentrum = dunkelster Bereich nahe der Bildmitte
    L = lin.mean(-1)
    Lb = blur(L, 8)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cen = np.hypot(xx - W / 2, yy - H / 2)
    score = Lb + (cen / (0.25 * W)) ** 2
    cy, cx = np.unravel_index(np.argmin(score), score.shape)
    r = np.hypot(xx - cx, yy - cy)
    # Ausdehnung des Einschlags: Radius, innerhalb dessen 90 % der Abweichung liegt
    wts = ad.ravel()
    order = np.argsort(r.ravel())
    cum = np.cumsum(wts[order])
    r90 = float(r.ravel()[order][np.searchsorted(cum, cum[-1] * 0.9)])
    r90 = min(max(r90, 0.06 * W), 0.42 * W)
    core = 1 - smoothstep(r90 * 0.35, r90 * 0.6, r)
    fade = 1 - smoothstep(r90 * 0.9, r90 * 1.35, r)
    a = np.clip(np.maximum(ad * fade * 0.85, core), 0, 1)
    F = np.clip(bg + (lin - bg) / np.maximum(a[..., None], 0.05), 0, 1)
    F = np.where(a[..., None] > 0.05, F, lin)
    # Hoehe: dunkel = tief (Loch), dazu Kraterschale
    hl = (L - bg.mean(-1)) / (bg.mean(-1) + 1e-3)
    h = blur(hl, 1.2) * 0.6
    # echter Lochradius: sehr dunkle Flaeche um das Zentrum (aequivalenter Kreisradius)
    dark = (Lb < bg.mean(-1) * 0.18) & (r < r90 * 0.6)
    hole_r = float(np.clip(math.sqrt(dark.sum() / math.pi), r90 * 0.06, r90 * 0.45))
    h -= cfg['depth'] * (1 - smoothstep(0, r90 * 0.7, r)) ** 2 * 1.5
    h -= cfg['depth'] * (1 - smoothstep(hole_r * 0.6, hole_r * 1.3, r)) * 3.0
    h = blur(h, 1.0)
    return lin2srgb(F), a, h, (cx, cy, r90)


def normal_from_h(h, k):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-dx * k, dy * k, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def bbox_square(a, margin, edge=None):
    H, W = a.shape
    ab = blur(a, 4)
    if ab.max() < 0.05:
        return 0, 0, min(H, W)
    # robuste Box: 0,3/99,7-Perzentil der Deckung (einzelne Fernspritzer duerfen abgeschnitten werden)
    px, py = ab.sum(0), ab.sum(1)
    cx_, cy_ = np.cumsum(px) / px.sum(), np.cumsum(py) / py.sum()
    x0, x1 = np.searchsorted(cx_, 0.003), np.searchsorted(cx_, 0.997)
    y0, y1 = np.searchsorted(cy_, 0.003), np.searchsorted(cy_, 0.997)
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * margin))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if edge == 'bl':  # Ecke unten links bleibt am Rand
        return 0, H - min(H, W), min(H, W)
    return int(cx - side / 2), int(cy - side / 2), side


def crop_pad(arr, x0, y0, side, fill):
    H, W = arr.shape[:2]
    shp = (side, side) + arr.shape[2:]
    out = np.full(shp, fill, np.float32)
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(W, x0 + side), min(H, y0 + side)
    out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = arr[sy0:sy1, sx0:sx1]
    return out


def edge_fade(a, edge=None, frac=0.04):
    n = a.shape[0]
    t = np.linspace(0, 1, n)
    ramp = smoothstep(0, frac, np.minimum(t, 1 - t))
    if edge == 'bl':
        rx = smoothstep(0, frac, 1 - t)  # nur rechts ausblenden
        ry = smoothstep(0, frac, t)      # nur oben ausblenden
        return a * rx[None, :] * ry[:, None]
    return a * ramp[None, :] * ramp[:, None]


def process(did, rawdir, outdir, prevdir):
    cfg = D[did]
    img = np.asarray(Image.open(os.path.join(rawdir, f'd_{did}_v1.png')).convert('RGB')).astype(np.float32) / 255
    H, W = img.shape[:2]
    mpp = cfg['frameW'] / W
    nrm = None
    if cfg['mode'] == 'white':
        rgb, a = unmix_white(img, cfg)
        if cfg.get('edge') == 'bl':
            # Schmutz soll zur Raumecke hin sicher deckend auslaufen, nach oben/rechts weich verschwinden
            pass
    elif cfg['mode'] == 'green':
        rgb, a = key_green(img)
    else:
        rgb, a, h, (cx, cy, r90) = hole(img, cfg)
    if cfg.get('desat') or cfg.get('tint'):
        lin = srgb2lin(rgb)
        if cfg.get('desat'):
            y = (lin * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
            lin = lin + (y - lin) * cfg['desat']
        lin = lin * np.array(cfg.get('tint', (1, 1, 1)), np.float32)
        rgb = lin2srgb(lin).astype(np.float32)
    if cfg.get('afeather'):
        a = blur(a, cfg['afeather'])
    a = np.power(np.clip(a, 0, 1), cfg.get('agamma', 1.0)) * cfg.get('alphaMul', 1.0)  # agamma>1: Flaeche blasser, Raender (Wasserrand) bleiben
    x0, y0, side = bbox_square(a, 0.06, cfg.get('edge'))
    if cfg['mode'] == 'hole':
        side = int(r90 * 2.9)
        x0, y0 = int(cx - side / 2), int(cy - side / 2)
    rgb = crop_pad(rgb, x0, y0, side, 1.0)
    a = crop_pad(a, x0, y0, side, 0.0)
    a = edge_fade(a, cfg.get('edge'))
    rgb = bleed(rgb, a)
    o = cfg['out']
    rs = lambda x: cv2.resize(x.astype(np.float32), (o, o), interpolation=cv2.INTER_AREA if side > o else cv2.INTER_CUBIC)
    rgb_o, a_o = np.clip(rs(rgb), 0, 1), np.clip(rs(a), 0, 1)
    rgba = np.concatenate([rgb_o, a_o[..., None]], -1)
    d = os.path.join(outdir, 'decals')
    os.makedirs(d, exist_ok=True)
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(d, f'{did}.png'), optimize=True)
    entry = dict(file=f'decals/{did}.png', size=o, sizeMeters=round(side * mpp, 3), roughness=cfg['rough'], metalness=cfg['metal'])
    if cfg['mode'] == 'hole':
        hc = crop_pad(h, x0, y0, side, 0.0)
        hc = rs(hc)
        nrm = normal_from_h(hc, 2.2 * side / o)
        Image.fromarray((nrm * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(d, f'{did}_normal.png'), optimize=True)
        entry['normal'] = f'decals/{did}_normal.png'
        entry['surface'] = cfg['surface']
    if prevdir:
        os.makedirs(prevdir, exist_ok=True)
        tiles = []
        for bgc in ((0.85, 0.85, 0.82), (0.25, 0.22, 0.2)):
            chk = np.ones((o, o, 3), np.float32) * np.array(bgc, np.float32)
            yy, xx = np.mgrid[0:o, 0:o]
            chk *= (0.92 + 0.08 * (((xx // 32) + (yy // 32)) % 2))[..., None]
            tiles.append(rgb_o * a_o[..., None] + chk * (1 - a_o[..., None]))
        tiles.append(np.repeat(a_o[..., None], 3, -1))
        if nrm is not None:
            tiles.append(nrm)
        Image.fromarray((np.concatenate(tiles, 1) * 255).astype(np.uint8)).save(os.path.join(prevdir, f'decal_{did}.jpg'), quality=85)
    return entry


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
    ids = a.ids or [k for k in D if os.path.exists(os.path.join(a.rawdir, f'd_{k}_v1.png'))]
    ip = os.path.join(a.outdir, 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    dec = index.get('decals', {})
    for did in ids:
        dec[did] = process(did, a.rawdir, a.outdir, a.preview)
        print(did, dec[did], flush=True)
    index['decals'] = {k: dec[k] for k in D if k in dec}
    # kompakt: ein Eintrag pro Zeile
    with open(ip, 'w') as f:
        f.write(dump_index(index))


if __name__ == '__main__':
    main()
