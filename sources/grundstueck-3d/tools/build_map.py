#!/usr/bin/env python3
"""Erzeugt die 2D-Kartengrundlagen (Kachelpyramide des Orthofotos, Bodenraster) und den `map`-Block in scene.json.

Aufruf (aus dem Ordner sources/grundstueck-3d):
  python3 tools/build_map.py --ortho <ortho_top_plain.png> --npz <ortho.npz> \
    --scene public/scene/scene.json --out-dir public/scene \
    [--quality 75] [--tile 512] [--margin 4] [--start-margin 3] [--max-p90 0.5]

Bereich und Auflösung kommen aus dem npz (x0,x1,z0,z1,res,cell). Bildachse x = Welt-x nach rechts,
Bildachse y = Welt-z nach unten. Reines Schwarz im Orthofoto gilt als „keine Daten“.
Jede Unstimmigkeit bricht mit Exit-Code != 0 und konkreter Meldung ab.
"""
import argparse
import gzip
import hashlib
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

LIFT = {'boundary': 0.04, 'building': 0.04, 'pipe': 0.04, 'manhole': 0.06}
IDW_MAX_DIST = 15.0
GRID_M = 5
MIN_MPP = 0.004


def die(msg):
    print(f'FEHLER: {msg}', file=sys.stderr)
    sys.exit(1)


def is_pt(p):
    return isinstance(p, list) and len(p) == 3 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)


def plan_points(cfg):
    """Alle Planpunkte nach Klasse; nicht endliche Punkte → Abbruch mit Pfad."""
    out = {'boundary': [], 'building': [], 'pipe': [], 'manhole': [], 'connection': [], 'corner': []}

    def add(cls, p, path):
        if not is_pt(p):
            die(f'scene.json {path}: kein endlicher Punkt [x,y,z]: {p!r}')
        out[cls].append(p)

    for i, b in enumerate(cfg.get('boundaries', [])):
        for j, p in enumerate(b.get('points', [])):
            add('boundary', p, f'boundaries[{i}].points[{j}]')
        for k, ln in enumerate(b.get('lines', [])):
            for j, p in enumerate(ln):
                add('boundary', p, f'boundaries[{i}].lines[{k}][{j}]')
        for j, p in enumerate(b.get('corners', [])):
            add('corner', p, f'boundaries[{i}].corners[{j}]')
    for i, b in enumerate(cfg.get('buildings', [])):
        for j, p in enumerate(b.get('points', [])):
            add('building', p, f'buildings[{i}].points[{j}]')
    sw = cfg.get('sewer') or {}
    for i, pp in enumerate(sw.get('pipes', [])):
        for j, p in enumerate(pp.get('points', [])):
            add('pipe', p, f'sewer.pipes[{i}].points[{j}]')
    for i, m in enumerate(sw.get('manholes', [])):
        add('manhole', m.get('at'), f'sewer.manholes[{i}].at')
    for i, c in enumerate(sw.get('connections', [])):
        for j, p in enumerate(c):
            add('connection', p, f'sewer.connections[{i}][{j}]')
    return {k: np.array(v, dtype=np.float64).reshape(-1, 3) for k, v in out.items()}


def sample(G, x, z):
    """Wie src/ground.js: bilinear, wenn alle vier Nachbarzellen eine Höhe haben (q = kleinstes q);
    sonst die nächste Zelle, sofern sie eine Höhe hat; sonst keine Höhe (None)."""
    fx = (x - G['x0']) / G['cell'] - 0.5
    fz = (z - G['z0']) / G['cell'] - 0.5
    j = math.floor(fx); i = math.floor(fz)
    tx = fx - j; tz = fz - i
    H, Q = G['H'], G['Q']
    rows, cols = Q.shape
    if 0 <= i < rows - 1 and 0 <= j < cols - 1:
        q4 = Q[i:i + 2, j:j + 2]
        if q4.min() > 0:
            c = H[i:i + 2, j:j + 2]
            y = (c[0, 0] * (1 - tx) + c[0, 1] * tx) * (1 - tz) + (c[1, 0] * (1 - tx) + c[1, 1] * tx) * tz
            return y, int(q4.min())
    ni = int(math.floor(fz + 0.5)); nj = int(math.floor(fx + 0.5))
    if 0 <= ni < rows and 0 <= nj < cols and Q[ni, nj] > 0:
        return H[ni, nj], int(Q[ni, nj])
    return None, 0


def ceil05(v):
    return math.ceil(v / 0.05 - 1e-9) * 0.05


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ortho', required=True)
    ap.add_argument('--npz', required=True)
    ap.add_argument('--scene', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--quality', type=int, default=75)
    ap.add_argument('--tile', type=int, default=512)
    ap.add_argument('--margin', type=float, default=4.0)
    ap.add_argument('--start-margin', type=float, default=3.0)
    ap.add_argument('--max-p90', type=float, default=0.5)
    a = ap.parse_args()

    scene_path = Path(a.scene)
    cfg = json.loads(scene_path.read_text(encoding='utf-8'))
    out_dir = Path(a.out_dir)
    map_dir = out_dir / 'map'
    map_dir.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- 1. npz
    d = np.load(a.npz)
    for k in ('ground', 'valid', 'cell', 'x0', 'x1', 'z0', 'z1', 'res'):
        if k not in d.files:
            die(f'{a.npz}: Schlüssel {k!r} fehlt (vorhanden: {d.files})')
    x0, x1, z0, z1, res, cell = (float(d[k]) for k in ('x0', 'x1', 'z0', 'z1', 'res', 'cell'))
    g = d['ground'].astype(np.float64)
    valid = d['valid'].astype(bool)
    exp_shape = (math.ceil((z1 - z0) / cell - 1e-9), math.ceil((x1 - x0) / cell - 1e-9))
    if g.shape != exp_shape or valid.shape != exp_shape:
        die(f'{a.npz}: ground/valid haben Form {g.shape}/{valid.shape}, erwartet {exp_shape}')
    for name, v in (('x0', x0), ('z0', z0)):
        if abs(v / cell - round(v / cell)) > 1e-9:
            die(f'{a.npz}: {name}={v} liegt nicht auf dem Zellraster {cell}')

    # ---------------------------------------------------------------- 2. Orthofoto
    img = Image.open(a.ortho)
    W, H = round((x1 - x0) / res), round((z1 - z0) / res)
    if img.size != (W, H):
        die(f'{a.ortho}: Größe {img.size}, erwartet {(W, H)} aus npz-Bereich und res={res}')
    rgb = np.array(img.convert('RGB'))
    alpha = (rgb.astype(np.uint16).sum(2) > 0).astype(np.uint8) * 255
    cover = alpha.mean() / 255
    if cover < 0.01:
        die(f'{a.ortho}: nur {cover:.2%} gedeckte Pixel – falsches Bild?')
    rgba = Image.fromarray(np.dstack([rgb, alpha]), 'RGBA')

    # ---------------------------------------------------------------- 3. Pyramide
    old = sorted(map_dir.glob('t*_*_*.webp'))
    for p in old:
        p.unlink()
    print(f'{len(old)} alte Kacheln in {map_dir} gelöscht')
    T = a.tile
    levels = []
    tile_hash = hashlib.sha256()
    tile_bytes = 0
    f = 1
    while True:
        # Bild transparent auf ein Vielfaches von f auffüllen, dann exakt um f verkleinern:
        # so ist jeder Pixel der Stufe genau f × res Meter groß.
        Wf, Hf = math.ceil(W / f), math.ceil(H / f)
        if f == 1:
            im = rgba
        else:
            pad = Image.new('RGBA', (Wf * f, Hf * f), (0, 0, 0, 0))
            pad.paste(rgba, (0, 0))
            # vormultipliziert verkleinern, sonst bluten die schwarzen transparenten Pixel ein
            im = pad.convert('RGBa').resize((Wf, Hf), Image.LANCZOS).convert('RGBA')
        A = np.array(im)[:, :, 3]
        tiles = []
        lvl_bytes = 0
        for ty in range(math.ceil(Hf / T)):
            for tx in range(math.ceil(Wf / T)):
                xa, ya = tx * T, ty * T
                xb = min(Wf, (tx + 1) * T + 1)   # 1 px Überlappung nach rechts/unten, sofern im Bild
                yb = min(Hf, (ty + 1) * T + 1)
                if not A[ya:yb, xa:xb].any():
                    continue
                buf = io.BytesIO()
                im.crop((xa, ya, xb, yb)).save(buf, 'WEBP', quality=a.quality, method=6)
                data = buf.getvalue()
                (map_dir / f't{f}_{tx}_{ty}.webp').write_bytes(data)
                tile_hash.update(f't{f}_{tx}_{ty}'.encode()); tile_hash.update(data)
                tile_bytes += len(data); lvl_bytes += len(data)
                tiles.append([tx, ty])
        if not tiles:
            die(f'Stufe f={f}: keine einzige gedeckte Kachel')
        levels.append({'f': f, 'size': [Wf, Hf], 'tiles': tiles, '_bytes': lvl_bytes})
        if Wf <= T and Hf <= T:
            break
        f *= 2

    # ---------------------------------------------------------------- 4. Bodenraster
    P = plan_points(cfg)
    allp = np.concatenate([P[k] for k in P if len(P[k])])
    if not len(allp):
        die('scene.json enthält keine Planpunkte')
    M = a.margin
    X0 = math.floor((min(allp[:, 0].min(), x0) - M) / cell) * cell
    X1 = math.ceil((max(allp[:, 0].max(), x1) + M) / cell) * cell
    Z0 = math.floor((min(allp[:, 2].min(), z0) - M) / cell) * cell
    Z1 = math.ceil((max(allp[:, 2].max(), z1) + M) / cell) * cell
    cols, rows = round((X1 - X0) / cell), round((Z1 - Z0) / cell)

    mimg = Image.new('L', (g.shape[1], g.shape[0]), 0)
    dr = ImageDraw.Draw(mimg)
    for b in cfg.get('buildings', []):
        dr.polygon([((p[0] - x0) / cell, (p[2] - z0) / cell) for p in b['points']], fill=1)
    free = valid & (np.array(mimg) == 0)

    Hm = np.full((rows, cols), np.nan)
    Q = np.zeros((rows, cols), np.uint8)
    cx = X0 + (np.arange(cols) + 0.5) * cell
    cz = Z0 + (np.arange(rows) + 0.5) * cell
    oi = round((z0 - Z0) / cell); oj = round((x0 - X0) / cell)
    gr, gc = g.shape
    for gi in range(gr):
        for gj in range(gc):
            sl = (slice(max(0, gi - 2), gi + 3), slice(max(0, gj - 2), gj + 3))
            fr = free[sl]
            if fr.mean() > 0.5:
                Hm[oi + gi, oj + gj] = np.percentile(g[sl][fr], 15)
                Q[oi + gi, oj + gj] = 2
    # geschätzt: inverse Distanz der Planhöhen (Planpunkte liegen 4–6 cm über dem Gelände)
    idw = np.concatenate([
        P['boundary'] - [0, LIFT['boundary'], 0], P['building'] - [0, LIFT['building'], 0],
        P['pipe'] - [0, LIFT['pipe'], 0], P['manhole'] - [0, LIFT['manhole'], 0]])
    est = np.argwhere(Q == 0)
    for s in range(0, len(est), 2000):
        blk = est[s:s + 2000]
        ex = cx[blk[:, 1]][:, None]; ez = cz[blk[:, 0]][:, None]
        dd = np.hypot(idw[:, 0][None, :] - ex, idw[:, 2][None, :] - ez)
        w = 1 / np.maximum(dd, 0.5) ** 2
        h = (w @ idw[:, 1]) / w.sum(1)
        ok = dd.min(1) < IDW_MAX_DIST
        Hm[blk[ok, 0], blk[ok, 1]] = h[ok]
        Q[blk[ok, 0], blk[ok, 1]] = 1
    n2, n1, n0 = int((Q == 2).sum()), int((Q == 1).sum()), int((Q == 0).sum())
    if n2 == 0:
        die('Bodenraster: keine einzige gemessene Zelle (q2)')
    hv = Hm[Q > 0]
    if hv.min() < -50 or hv.max() > 50:
        die(f'Bodenraster: Höhen {hv.min():.2f}…{hv.max():.2f} m außerhalb von −50…+50 m')
    cm = [None if q == 0 else int(round(h * 100)) for h, q in zip(Hm.ravel(), Q.ravel())]
    rle = []
    for q in Q.ravel().tolist():
        if rle and rle[-1][0] == q:
            rle[-1][1] += 1
        else:
            rle.append([q, 1])
    assert sum(n for _, n in rle) == rows * cols
    gj_data = json.dumps({'format': 'grundstueck-ground-v1', 'x0': X0, 'z0': Z0, 'cell': cell, 'cols': cols,
                          'rows': rows, 'unit': 0.01, 'h': cm, 'q': rle}, separators=(',', ':')).encode()
    (map_dir / 'ground.json').write_bytes(gj_data)
    G = {'x0': X0, 'z0': Z0, 'cell': cell, 'H': np.round(Hm * 100) / 100, 'Q': Q}

    # ---------------------------------------------------------------- 5. Gegenprobe
    print('\nGegenprobe Bodenraster gegen Planhöhen (Plan − Lift − Raster, m):')
    p90s = {1: [], 2: []}
    p90_bound_q2 = None
    for cls, pts in (('Grenzen', P['boundary']), ('Gebäude', P['building']), ('Schächte', P['manhole'])):
        lift = LIFT['manhole'] if cls == 'Schächte' else 0.04
        r = []
        for p in pts:
            y, q = sample(G, p[0], p[2])
            if y is not None:
                r.append((p[1] - lift - y, q))
        for q in (2, 1):
            arr = np.array([v for v, qq in r if qq == q])
            if len(arr):
                p90 = float(np.percentile(np.abs(arr), 90))
                p90s[q].append(p90)
                if cls == 'Grenzen' and q == 2:
                    p90_bound_q2 = p90
                print(f'  {cls:9s} q{q}: n={len(arr):4d}  Median {np.median(arr):+.2f}  p90 |d| {p90:.2f}')
        miss = len(pts) - len(r)
        if miss:
            print(f'  {cls:9s}: {miss} Punkte ohne Bodenhöhe (q0)')
    if p90_bound_q2 is not None and p90_bound_q2 > a.max_p90:
        die(f'Gegenprobe: p90 der Grenzpunkte in q2 ist {p90_bound_q2:.2f} m > --max-p90 {a.max_p90}')
    if not p90s[2]:
        die('Gegenprobe: kein Planpunkt liegt in einer gemessenen Zelle – Genauigkeit nicht bestimmbar')
    if not p90s[1]:
        die('Gegenprobe: kein Planpunkt liegt in einer geschätzten Zelle – Genauigkeit nicht bestimmbar')
    acc = {'measured': round(ceil05(max(p90s[2])), 2), 'estimated': round(ceil05(max(p90s[1])), 2)}

    # ---------------------------------------------------------------- 6. scene.json
    prim = [p for b in cfg.get('boundaries', []) if b.get('style') == 'primary' for p in b.get('points', [])]
    if not prim:
        die('scene.json: keine Grenze mit style "primary" und points – Startausschnitt nicht bestimmbar')
    prim = np.array(prim)
    sm = a.start_margin
    start = [round(float(prim[:, 0].min()) - sm, 2), round(float(prim[:, 0].max()) + sm, 2),
             round(float(prim[:, 2].min()) - sm, 2), round(float(prim[:, 2].max()) + sm, 2)]
    extent = [X0, X1, Z0, Z1]
    cfg['map'] = {
        'extent': extent, 'start': start, 'grid_m': GRID_M, 'min_mpp': MIN_MPP,
        'image': {
            'dir': 'map/', 'format': 'webp', 'version': tile_hash.hexdigest()[:12],
            'bounds': [x0, x1, z0, z1], 'res': res, 'size': [W, H], 'tile': T, 'overlap': 1,
            'levels': [{k: v for k, v in L.items() if not k.startswith('_')} for L in levels],
            'bytes': tile_bytes,
        },
        'ground': {
            'file': 'map/ground.json', 'version': hashlib.sha256(gj_data).hexdigest()[:12],
            'bounds': extent, 'cell': cell, 'cols': cols, 'rows': rows, 'bytes': len(gj_data),
            'accuracy_m': acc,
        },
    }
    scene_path.write_text(json.dumps(cfg, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')

    # ---------------------------------------------------------------- 7. Übersicht
    print('\nKacheln:')
    for L in levels:
        print(f'  f={L["f"]:<2d} {L["size"][0]:>5d}×{L["size"][1]:<5d} {len(L["tiles"]):3d} Kacheln {L["_bytes"] / 1024:8.1f} KiB')
    print(f'  gesamt {sum(len(L["tiles"]) for L in levels)} Kacheln, {tile_bytes / 1024:.1f} KiB')
    print(f'ground.json {cols}×{rows} Zellen: {len(gj_data) / 1024:.1f} KiB roh, {len(gzip.compress(gj_data, 9)) / 1024:.1f} KiB gzip')
    tot = rows * cols
    print(f'  q2 gemessen {n2} ({n2 / tot:.1%}), q1 geschätzt {n1} ({n1 / tot:.1%}), q0 keine {n0} ({n0 / tot:.1%})')
    print(f'Bereich x {X0}…{X1}, z {Z0}…{Z1}; Start {start}; Genauigkeit {acc}')
    print(f'{scene_path}: Block "map" geschrieben.')


if __name__ == '__main__':
    main()
