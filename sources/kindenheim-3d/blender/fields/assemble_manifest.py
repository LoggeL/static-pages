#!/usr/bin/env python3
"""
Validate the field GLBs written by blender/fields/build_fields.py and assemble
public/assets/models/fields/manifest.json (schema read by src/dataLoader.ts / src/fields.ts).

Checks (any failure exits non-zero and writes nothing):
  - every expected model key exists in build_meta.json and its GLB is a valid, fully embedded glTF 2.0 binary
  - LOD assets contain the nodes <key>_LOD0 [/_LOD1] [/_FAR] they announce
  - crop / foliage materials are alphaMode MASK + doubleSided
  - total shipped size of the unique GLB files stays below MAX_TOTAL_MB
"""
import json
import os
import struct
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
FIELDS_DIR = os.path.join(PROJECT_ROOT, 'public/assets/models/fields')
BUILD_META = os.path.join(FIELDS_DIR, 'build_meta.json')
MANIFEST_OUT = os.path.join(FIELDS_DIR, 'manifest.json')
# vegetation + props + fields share a 16 MB budget (fix round); the village props take about 8.5 MB of it
MAX_TOTAL_MB = 6.5

# key -> needs alpha-masked double-sided foliage material
EXPECTED_MODELS = {
    'crop_wheat_patch': True,
    'crop_stubble_patch': True,
    'straw_bale_stack': False,
    'crop_corn_row': True,
    'crop_sugarbeet_row': True,
    'crop_sunflower_patch': True,
    'meadow_grass_patch': True,
    'wildflower_strip': True,
    'hedgerow_bay': True,
    'vineyard_rose_post': True,
    'hochsitz': False,
    'wegekreuz': False,
}


def parse_glb(glb_path: str) -> dict:
    with open(glb_path, 'rb') as f:
        magic, _version, _total = struct.unpack('<4sII', f.read(12))
        if magic != b'glTF':
            raise ValueError(f'{glb_path}: invalid GLB magic {magic!r}')
        chunk_len, chunk_type = struct.unpack('<I4s', f.read(8))
        if chunk_type != b'JSON':
            raise ValueError(f'{glb_path}: missing JSON chunk')
        return json.loads(f.read(chunk_len).decode('utf-8'))


def node_triangles(g: dict, node_name: str) -> int:
    nodes = g.get('nodes', [])
    by_name = {n.get('name'): i for i, n in enumerate(nodes)}
    if node_name not in by_name:
        raise KeyError(node_name)
    accessors = g['accessors']
    total = 0
    stack = [by_name[node_name]]
    while stack:
        n = nodes[stack.pop()]
        stack.extend(n.get('children', []))
        if 'mesh' in n:
            for prim in g['meshes'][n['mesh']]['primitives']:
                if 'indices' in prim:
                    total += accessors[prim['indices']]['count'] // 3
                else:
                    total += accessors[prim['attributes']['POSITION']]['count'] // 3
    return total


def main() -> None:
    if not os.path.isfile(BUILD_META):
        sys.exit(f'ERROR: {BUILD_META} missing - run blender/fields/build_fields.py first')
    with open(BUILD_META, encoding='utf-8') as fh:
        built = json.load(fh)['models']

    errors: list[str] = []
    models: dict[str, dict] = {}
    files: dict[str, int] = {}
    total_tris = 0
    for key, needs_mask in EXPECTED_MODELS.items():
        src = built.get(key)
        if not src:
            errors.append(f'{key}: missing in build_meta.json')
            continue
        glb_abs = os.path.join(FIELDS_DIR, src['glbFile'])
        if not os.path.isfile(glb_abs):
            errors.append(f'{key}: GLB missing: {glb_abs}')
            continue
        g = parse_glb(glb_abs)
        if any(img.get('uri') for img in g.get('images', [])):
            errors.append(f'{key}: GLB references external image URIs')
        mats = g.get('materials', [])
        has_mask = any(m.get('alphaMode') == 'MASK' and m.get('doubleSided') is True for m in mats)
        if needs_mask and not has_mask:
            errors.append(f'{key}: no alphaMode=MASK + doubleSided material')
        lods = src.get('lods')
        tris = 0
        if lods:
            for lod_name, lod in lods.items():
                try:
                    lod['triangles'] = node_triangles(g, lod['node'])
                except KeyError:
                    errors.append(f"{key}: node {lod['node']} not found in {src['glbFile']}")
            tris = lods.get('LOD0', {}).get('triangles', 0)
        else:
            for mesh in g.get('meshes', []):
                for prim in mesh['primitives']:
                    acc = g['accessors'][prim['indices']] if 'indices' in prim else g['accessors'][prim['attributes']['POSITION']]
                    tris += acc['count'] // 3
        files[src['glbFile']] = os.path.getsize(glb_abs)
        box = src['boundsBox']
        entry = {
            'key': key,
            'name': key,
            'glbPath': f"/assets/models/fields/{src['glbFile']}",
            'bounds': box['size'],
            'boundsMin': box['min'],
            'boundsMax': box['max'],
            'triangles': tris,
            'meshCount': src.get('meshCount', 1),
            'fileSizeBytes': files[src['glbFile']],
            'alphaMaskDoubleSided': has_mask,
        }
        for opt in ('spacingM', 'alongRowM', 'betweenBaysM', 'tileM', 'heightM', 'nodePrefix', 'lods', 'lodDist'):
            if opt in src:
                entry[opt] = src[opt]
        wind = float(src.get('windSway', 0.0))
        entry['windSway'] = wind
        entry['windSwayStrength'] = wind
        models[key] = entry
        total_tris += tris

    total_bytes = sum(files.values())
    total_mb = total_bytes / (1024.0 * 1024.0)
    if total_mb > MAX_TOTAL_MB:
        errors.append(f'total size {total_mb:.2f} MB exceeds {MAX_TOTAL_MB} MB')
    if errors:
        for e in errors:
            print('ERROR:', e)
        sys.exit(1)

    manifest = {
        'version': 2,
        'coordinateSystem': 'glTF 2.0 Y-up metres (+X along rows, +Y up from ground contact Y=0, -Z north); LOD nodes <key>_LOD0/_LOD1/_FAR',
        'modelCount': len(models),
        'uniqueGlbFiles': len(files),
        'totalFileSizeBytes': total_bytes,
        'totalFileSizeMB': round(total_mb, 3),
        'totalTriangles': total_tris,
        'externalImageURIs': 0,
        'models': models,
    }
    tmp = MANIFEST_OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2)
    os.replace(tmp, MANIFEST_OUT)
    print(f'[fields] manifest: {len(models)} models in {len(files)} GLBs, {total_mb:.2f} MB')
    for name, size in sorted(files.items()):
        print(f'   {name}: {size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
