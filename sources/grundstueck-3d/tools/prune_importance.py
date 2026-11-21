#!/usr/bin/env python3
"""Behält die `target` wichtigsten Gaussians eines PLY (Wichtigkeit = Deckkraft × Volumen).

Aufruf: python3 tools/prune_importance.py <eingabe.ply> <target> <ausgabe.ply>
Nur binary_little_endian mit Feldern opacity und scale_0..2; sonst Abbruch.
"""
import sys

import numpy as np

TYPES = {'float': 'f4', 'float32': 'f4', 'double': 'f8', 'float64': 'f8', 'uchar': 'u1', 'uint8': 'u1',
         'char': 'i1', 'int8': 'i1', 'short': 'i2', 'int16': 'i2', 'ushort': 'u2', 'uint16': 'u2',
         'int': 'i4', 'int32': 'i4', 'uint': 'u4', 'uint32': 'u4'}


def die(msg):
    print(f'FEHLER: {msg}', file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 4:
        die('Aufruf: prune_importance.py <eingabe.ply> <target> <ausgabe.ply>')
    src, target, dst = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    with open(src, 'rb') as f:
        raw = f.read()
    end = raw.find(b'end_header\n')
    if end < 0:
        die(f'{src}: kein end_header')
    header = raw[:end + len(b'end_header\n')].decode('ascii')
    lines = header.splitlines()
    if 'format binary_little_endian 1.0' not in lines:
        die(f'{src}: nur binary_little_endian wird unterstützt')
    n = None
    fields = []
    in_vertex = False
    for ln in lines:
        p = ln.split()
        if p[:2] == ['element', 'vertex']:
            n = int(p[2]); in_vertex = True
        elif p and p[0] == 'element':
            if in_vertex:
                die(f'{src}: weitere Elemente nach vertex werden nicht unterstützt')
        elif in_vertex and p and p[0] == 'property':
            if p[1] == 'list':
                die(f'{src}: Listen-Eigenschaften werden nicht unterstützt')
            if p[1] not in TYPES:
                die(f'{src}: unbekannter Typ {p[1]}')
            fields.append((p[2], '<' + TYPES[p[1]]))
    if n is None:
        die(f'{src}: kein element vertex')
    names = [f[0] for f in fields]
    for need in ('opacity', 'scale_0', 'scale_1', 'scale_2'):
        if need not in names:
            die(f'{src}: Feld {need} fehlt')
    dt = np.dtype(fields)
    body = raw[len(header):]
    if len(body) != n * dt.itemsize:
        die(f'{src}: Datenlänge {len(body)} passt nicht zu {n} × {dt.itemsize} Byte')
    v = np.frombuffer(body, dtype=dt, count=n)
    if target >= n:
        die(f'target {target} ≥ Anzahl {n}: nichts zu entfernen')
    imp = (1 / (1 + np.exp(-v['opacity'].astype(np.float64)))) * np.exp(
        v['scale_0'].astype(np.float64) + v['scale_1'] + v['scale_2'])
    imp[~np.isfinite(imp)] = -np.inf
    keep = np.sort(np.argpartition(-imp, target - 1)[:target])
    out_header = header.replace(f'element vertex {n}\n', f'element vertex {target}\n')
    if out_header == header:
        die(f'{src}: Zeile "element vertex {n}" nicht gefunden')
    with open(dst, 'wb') as f:
        f.write(out_header.encode('ascii'))
        f.write(v[keep].tobytes())
    print(f'{src}: {n} → {target} Gaussians nach Deckkraft × Volumen → {dst}')


if __name__ == '__main__':
    main()
