#!/usr/bin/env python3
"""Erzeugt die Splat-Qualitätsstufen aus scene.json `splats.tiers` und trägt count/bytes/hash/sh ein.

Aufruf (aus dem Ordner sources/grundstueck-3d):
  python3 tools/build_splat_tiers.py --scene public/scene/scene.json --scene-dir public/scene \
    --work-dir /private/tmp/claude-501/<eigener-ordner>/tiers [--only niedrig,mittel] [--gpu <n|cpu>]

Quelle ist `<scene-dir>/<splats.source>` (.sog oder .ply). Werkzeug ist splat-transform in genau der
Version SPLAT_TRANSFORM (Node >= 22). Jede Unstimmigkeit bricht mit Exit-Code != 0 und konkreter
Meldung ab. Ausgabe ist immer SOG v2, weil Spark 2.4.0 nur dieses Schema lädt.
"""
import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np

SPLAT_TRANSFORM = '@playcanvas/splat-transform@3.12.0'
TOOLS = Path(__file__).resolve().parent


def die(msg):
    print(f'FEHLER: {msg}', file=sys.stderr)
    sys.exit(1)


def run(cmd):
    print('$ ' + ' '.join(str(c) for c in cmd), flush=True)
    p = subprocess.run([str(c) for c in cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.stdout.strip():
        print('\n'.join(p.stdout.strip().splitlines()[-6:]))
    if p.returncode != 0:
        die(f'Befehl fehlgeschlagen (Exit {p.returncode}): {" ".join(str(c) for c in cmd)}\n{p.stderr.strip()}')


def st(args_gpu, *rest):
    cmd = ['npx', '-y', SPLAT_TRANSFORM]
    if args_gpu is not None:
        cmd += ['--gpu', args_gpu]
    return cmd + list(rest)


def sha12(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:12]


def read_meta(path):
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if 'meta.json' not in names:
                die(f'{path}: kein meta.json im SOG-Archiv (Inhalt: {names})')
            return json.loads(z.read('meta.json'))
    except zipfile.BadZipFile as e:
        die(f'{path}: kein gültiges SOG-ZIP ({e})')


def sh_bands(meta, path):
    if 'shN' not in meta:
        return 0
    b = meta['shN'].get('bands')
    if b not in (1, 2, 3):
        die(f'{path}: meta.json shN.bands ist {b!r}, erwartet 1..3')
    return b


def quant_mm(meta, scale, path):
    """Größte Rundung der Splat-Mittelpunkte als float16 (PackedSplats) in mm Weltmaß.

    SOG speichert die Mittelpunkte logarithmisch: v = sign(x)*log(|x|+1); means.mins/maxs liegen
    in diesem Raum. Rückgerechnet x = sign(v)*(exp(|v|)-1)."""
    m = meta.get('means') or {}
    if 'mins' not in m or 'maxs' not in m:
        die(f'{path}: meta.json means.mins/maxs fehlen')
    v = np.abs(np.array(m['mins'] + m['maxs'], dtype=np.float64))
    xmax = float(np.max(np.expm1(v)))
    ulp = float(np.spacing(np.float16(xmax)))
    return ulp / 2 * scale * 1000, xmax


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scene', required=True)
    ap.add_argument('--scene-dir', required=True)
    ap.add_argument('--work-dir', required=True)
    ap.add_argument('--only', default=None, help='nur diese Stufen-ids bauen (Komma-Liste); geprüft und eingetragen werden alle')
    ap.add_argument('--gpu', default=None, help='an splat-transform weiterreichen (Index oder cpu)')
    ap.add_argument('--skip-build', action='store_true',
                    help='nichts bauen, nur vorhandene Dateien prüfen und count/bytes/hash/sh/pos_round_mm eintragen')
    ap.add_argument('--new-source', action='store_true',
                    help='die Quelle ist absichtlich eine neue Datei (neue Begehung): Abweichung von bytes/hash/count '
                         'der Quellstufe in scene.json zulassen und die neuen Werte eintragen')
    a = ap.parse_args()

    scene_path = Path(a.scene)
    scene_dir = Path(a.scene_dir)
    work = Path(a.work_dir)
    if not scene_path.is_file():
        die(f'{scene_path} nicht gefunden')
    cfg = json.loads(scene_path.read_text(encoding='utf-8'))
    sp = cfg.get('splats')
    if not isinstance(sp, dict):
        die('scene.json: Block "splats" fehlt')
    tiers = sp.get('tiers')
    if not isinstance(tiers, list) or not tiers:
        die('scene.json: splats.tiers fehlt oder ist leer')
    src_name = sp.get('source')
    if not isinstance(src_name, str) or not src_name:
        die('scene.json: splats.source fehlt')
    src = scene_dir / src_name
    if not src.is_file():
        die(f'Quelle {src} fehlt. Splat zuerst neben scene.json legen, z. B.:\n'
            f'  cp ../../public/grundstueck-3d/scene/{src_name} {scene_dir}/')
    # Die Quelle muss die in scene.json eingetragene sein: Sonst würden alle Stufen still aus einer
    # anderen (z. B. veralteten) Datei gebaut und scene.json auf deren Werte zurückgeschrieben.
    src_tiers = [t for t in tiers if t.get('build') is None]
    if len(src_tiers) != 1:
        die(f'scene.json: genau eine Stufe mit build null (= Quelle {src_name}) erwartet, gefunden {len(src_tiers)}')
    st0 = src_tiers[0]
    if st0.get('file') != src_name:
        die(f'scene.json: Quellstufe {st0.get("id")} nennt file {st0.get("file")!r}, splats.source ist {src_name!r}')
    src_meta = read_meta(src)
    have = {'bytes': src.stat().st_size, 'hash': sha12(src), 'count': src_meta.get('count')}
    want = {k: st0.get(k) for k in have}
    diff = [f'{k} {have[k]} statt {want[k]}' for k in have if want[k] is not None and have[k] != want[k]]
    if diff and not a.new_source:
        die(f'Quelle {src} ist nicht die in scene.json eingetragene ({", ".join(diff)}).\n'
            f'  Veraltete Kopie? Die richtige Datei neben scene.json legen. Ist es absichtlich eine neue\n'
            f'  Begehung, mit --new-source neu eintragen.')
    if diff:
        print(f'Neue Quelle (--new-source): {", ".join(diff)}')
    scale = cfg.get('transform', {}).get('scale')
    if not (isinstance(scale, (int, float)) and scale > 0):
        die('scene.json: transform.scale fehlt oder ist nicht > 0')
    only = set(a.only.split(',')) if a.only else None
    ids = [t.get('id') for t in tiers]
    if len(set(ids)) != len(ids):
        die(f'scene.json: Stufen-ids nicht eindeutig: {ids}')
    if only and not only <= set(ids):
        die(f'--only nennt unbekannte Stufen: {sorted(only - set(ids))}')
    if not a.skip_build:
        if shutil.which('npx') is None:
            die('npx nicht gefunden (Node >= 22 nötig)')
        work.mkdir(parents=True, exist_ok=True)

    for i, t in enumerate(tiers):
        if a.skip_build:
            break
        tid = t['id']
        b = t.get('build')
        out = scene_dir / t['file']
        if b is None:
            if t['file'] != src_name:
                die(f'splats.tiers[{i}] ({tid}): build ist null, aber file {t["file"]} ist nicht die Quelle {src_name}')
            continue
        if only and tid not in only:
            continue
        method = b.get('method')
        target = b.get('target')
        sh = b.get('sh')
        if not (isinstance(target, int) and target > 0):
            die(f'splats.tiers[{i}].build.target ungültig: {target!r}')
        if sh not in (0, 1, 2, 3):
            die(f'splats.tiers[{i}].build.sh ungültig: {sh!r}')
        if t['file'] == src_name:
            die(f'splats.tiers[{i}] ({tid}): würde die Quelle {src_name} überschreiben')
        ply = work / f'{tid}.ply'
        if method == 'adaptive':
            # --decimate-adaptive muss die letzte Aktion sein und nach .ply schreiben (splat-transform 3.12.0)
            run(st(a.gpu, '-w', src, '-N', '-H', sh, '--decimate-adaptive', target, ply))
        elif method == 'importance':
            full = work / f'{tid}-full.ply'
            run(st(a.gpu, '-w', src, '-N', '-H', sh, full))
            run([sys.executable, TOOLS / 'prune_importance.py', full, target, ply])
        else:
            die(f'splats.tiers[{i}].build.method unbekannt: {method!r} (adaptive|importance)')
        # SOG v2 ist Pflicht: Spark 2.4.0 erkennt v3 nicht. -m (Morton) verbessert die Kompression.
        run(st(a.gpu, '-w', ply, '-m', '--sog-version', '2', out))

    rows = []
    hashes = {}
    for i, t in enumerate(tiers):
        tid = t['id']
        path = scene_dir / t['file']
        if not path.is_file():
            die(f'splats.tiers[{i}] ({tid}): Datei {path} fehlt – ohne --only neu bauen')
        meta = read_meta(path)
        if meta.get('version') != 2:
            die(f'{path}: SOG-Version {meta.get("version")!r}, Spark 2.4.0 braucht 2')
        count = meta.get('count')
        if not (isinstance(count, int) and count > 0):
            die(f'{path}: meta.json count ungültig: {count!r}')
        bands = sh_bands(meta, path)
        b = t.get('build')
        if b is not None:
            if abs(count - b['target']) > 0.01 * b['target']:
                die(f'{path}: {count} Splats, Ziel {b["target"]} (Abweichung über 1 %)')
            if bands != b['sh']:
                die(f'{path}: SH-Bänder {bands}, build.sh verlangt {b["sh"]}')
        if t.get('render', {}).get('maxSh', 0) > bands:
            die(f'splats.tiers[{i}].render.maxSh {t["render"]["maxSh"]} > SH-Bänder der Datei ({bands})')
        if path not in hashes:
            hashes[path] = sha12(path)
        t['count'] = count
        t['bytes'] = path.stat().st_size
        t['hash'] = hashes[path]
        t['sh'] = bands
        mm, xmax = quant_mm(meta, scale, path)
        note = ''
        if not t.get('ext'):
            # Größte Rundung der 16-Bit-Mittelpunkte in mm Weltmaß; das Qualitätsmenü zeigt diesen Wert
            t['pos_round_mm'] = round(mm, 1)
            note = f'float16-Rundung bis ±{mm:.1f} mm (|x| ≤ {xmax:.2f} Einheiten)'
            if mm > 5:
                note += '  WARNUNG: über 5 mm – im hint der Stufe nennen'
        else:
            t.pop('pos_round_mm', None)
        rows.append((tid, t['file'], count, bands, t['bytes'], t['hash'], note))

    scene_path.write_text(json.dumps(cfg, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')

    print('\nStufen:')
    for tid, f, c, sh, by, h, note in rows:
        print(f'  {tid:8s} {f:20s} {c:>9,d} Splats  SH {sh}  {by / 1e6:7.2f} MB  {h}  {note}')
    print(f'\n{scene_path} aktualisiert (count, bytes, hash, sh, pos_round_mm).')
    print('Abschlussprüfung im Browser: node tools/perf.mjs --scenario check-tiers … (siehe README)')


if __name__ == '__main__':
    main()
