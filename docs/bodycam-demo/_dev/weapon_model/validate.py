#!/usr/bin/env python3
"""Offline C9 GLB acceptance. Never rewrites assets.

python3 public/bodycam-demo/_dev/weapon_model/validate.py \
  public/bodycam-demo/models/carbine.glb --meshopt-decoder /absolute/work/meshopt_decoder.mjs \\
  --json /absolute/work/validation.json

Python standard library; compressed GLBs additionally use Node and the real
MeshoptDecoder module supplied by --meshopt-decoder or MESHOPT_DECODER.
All numeric checks use decoded current source bytes, never historical originals.

Exit 0: required checks pass. Exit 1: contract violation. Exit 2: unreadable GLB.
"""
import argparse
import base64
import collections
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys

MOVING = ('W_Mag', 'W_Bolt', 'W_ChargingHandle', 'W_Trigger', 'W_Selector', 'W_BoltCatch', 'W_DustCover')
EMPTIES = ('W_Muzzle', 'W_Ejection', 'W_SightEye', 'W_LightEmitter', 'W_Grip_R', 'W_Grip_L', 'W_MagWell')
REQUIRED = ('W_Root',) + MOVING + EMPTIES
IDENTITY = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
COMPONENT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def mul(a, b):
    return tuple(sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4)) for col in range(4) for row in range(4))


def matrix(node):
    if 'matrix' in node:
        return tuple(node['matrix'])
    x, y, z, w = node.get('rotation', (0, 0, 0, 1))
    sx, sy, sz = node.get('scale', (1, 1, 1))
    tx, ty, tz = node.get('translation', (0, 0, 0))
    return ((1-2*y*y-2*z*z)*sx, (2*x*y+2*z*w)*sx, (2*x*z-2*y*w)*sx, 0,
            (2*x*y-2*z*w)*sy, (1-2*x*x-2*z*z)*sy, (2*y*z+2*x*w)*sy, 0,
            (2*x*z+2*y*w)*sz, (2*y*z-2*x*w)*sz, (1-2*x*x-2*y*y)*sz, 0,
            tx, ty, tz, 1)


def transform(m, p, point=True):
    return tuple(sum(m[k * 4 + row] * p[k] for k in range(3)) + (m[12 + row] if point else 0) for row in range(3))


def unit(p):
    length = math.sqrt(sum(x*x for x in p))
    return tuple(x / length for x in p) if length else (0, 0, 0)


def bounds(points):
    if not points:
        return None
    low = [min(p[a] for p in points) for a in range(3)]
    high = [max(p[a] for p in points) for a in range(3)]
    return {'min': low, 'max': high, 'size': [b-a for a, b in zip(low, high)]}


def area(a, b, c):
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    cross = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
    return math.sqrt(sum(x*x for x in cross)) / 2


def image_size(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24:
        return struct.unpack_from('>II', data, 16)
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP' and len(data) >= 20:
        offset = 12
        while offset + 8 <= len(data):
            kind = data[offset:offset+4]
            size = struct.unpack_from('<I', data, offset+4)[0]
            start = offset+8
            if start + size > len(data):
                return None
            payload = data[start:start+size]
            if kind == b'VP8X' and size >= 10:
                return (1+int.from_bytes(payload[4:7], 'little'), 1+int.from_bytes(payload[7:10], 'little'))
            if kind == b'VP8L' and size >= 5 and payload[0] == 0x2f:
                packed = struct.unpack_from('<I', payload, 1)[0]
                return (1+(packed & 0x3fff), 1+((packed >> 14) & 0x3fff))
            if kind == b'VP8 ' and size >= 10 and payload[3:6] == b'\x9d\x01\x2a':
                width, height = struct.unpack_from('<HH', payload, 6)
                return (width & 0x3fff, height & 0x3fff)
            offset = start+size+(size % 2)
    if data[:2] == b'\xff\xd8':
        offset = 2
        while offset + 4 <= len(data):
            if data[offset] != 255:
                offset += 1
                continue
            marker = data[offset + 1]
            offset += 2
            if marker in (0, 255, 216, 217) or 208 <= marker <= 215:
                continue
            size = struct.unpack_from('>H', data, offset)[0]
            if marker in (192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207):
                height, width = struct.unpack_from('>HH', data, offset + 3)
                return (width, height)
            if size < 2:
                break
            offset += size
    return None


class GLB:
    def __init__(self, path, meshopt_decoder=None):
        self.path = path
        data = path.read_bytes()
        self.bytes = len(data)
        self.sha256 = hashlib.sha256(data).hexdigest()
        if len(data) < 20:
            raise ValueError('GLB header truncated')
        magic, version, size = struct.unpack_from('<III', data)
        if magic != 0x46546c67 or version != 2 or size != len(data):
            raise ValueError('Invalid GLB magic, version or byteLength')
        chunks, offset = {}, 12
        while offset < len(data):
            length, kind = struct.unpack_from('<II', data, offset)
            offset += 8
            if offset + length > len(data) or length % 4:
                raise ValueError('Invalid GLB chunk size')
            if kind in chunks:
                raise ValueError('Duplicate GLB chunk type')
            chunks[kind] = data[offset:offset + length]
            offset += length
        self.doc = json.loads(chunks[0x4e4f534a])
        self.bin = chunks.get(0x004e4942, b'')
        self.cache = {}
        self.decoded_views = {}
        self.decoding = {'codec': 'none', 'views': 0}
        compressed = {i: view['extensions']['EXT_meshopt_compression']
                      for i, view in enumerate(self.doc.get('bufferViews', []))
                      if 'EXT_meshopt_compression' in view.get('extensions', {})}
        if compressed:
            if not meshopt_decoder:
                raise ValueError('Meshopt GLB requires --meshopt-decoder MODULE.mjs (or MESHOPT_DECODER); see README.md')
            decoder = Path(meshopt_decoder).resolve(strict=True)
            bridge = Path(__file__).with_name('decode-meshopt.mjs')
            process = subprocess.run(['node', str(bridge), str(decoder)], input=data,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     timeout=60, check=False)
            if process.returncode:
                raise ValueError('Meshopt decode failed: ' + process.stderr.decode('utf8', errors='replace').strip())
            result = json.loads(process.stdout)
            if result['sourceSha256'] != self.sha256 or result['sourceBytes'] != self.bytes:
                raise ValueError('Meshopt decoder inspected different source bytes')
            for row in result['views']:
                index = row['index']
                if index not in compressed or index in self.decoded_views:
                    raise ValueError('Meshopt decoder returned invalid or duplicate bufferView')
                decoded = base64.b64decode(row['data'], validate=True)
                extension = compressed[index]
                size = extension['count'] * extension['byteStride']
                if len(decoded) != size or size != self.doc['bufferViews'][index]['byteLength']:
                    raise ValueError('Meshopt decoded bufferView length mismatch')
                if hashlib.sha256(decoded).hexdigest() != row['sha256']:
                    raise ValueError('Meshopt decoded bufferView hash mismatch')
                self.decoded_views[index] = decoded
            if set(self.decoded_views) != set(compressed):
                raise ValueError('Meshopt decoder did not decode every compressed bufferView')
            self.decoding = {'codec': 'EXT_meshopt_compression', 'views': len(compressed),
                             'decoder': str(decoder), 'decoderSha256': result['decoderSha256'],
                             'sourceSha256': result['sourceSha256'],
                             'bufferViews': [{k: row[k] for k in ('index', 'bytes', 'sha256')} for row in result['views']]}

    def view(self, index):
        if index in self.decoded_views:
            return self.decoded_views[index]
        view = self.doc['bufferViews'][index]
        if view.get('buffer', 0) != 0:
            raise ValueError('External buffer is not supported by this self-contained GLB check')
        offset, size = view.get('byteOffset', 0), view['byteLength']
        if offset < 0 or offset + size > len(self.bin):
            raise ValueError('bufferView outside binary chunk')
        return self.bin[offset:offset+size]

    def accessor(self, index):
        if index in self.cache:
            return self.cache[index]
        a = self.doc['accessors'][index]
        if 'sparse' in a:
            raise ValueError('Sparse accessors are not expected in the C9 export')
        fmt, component_size = COMPONENT[a['componentType']]
        width = WIDTH[a['type']]
        item = struct.Struct('<' + fmt * width)
        view = self.doc['bufferViews'][a['bufferView']]
        data = self.view(a['bufferView'])
        stride, offset = view.get('byteStride', component_size * width), a.get('byteOffset', 0)
        if stride < item.size or (a['count'] and offset + (a['count']-1)*stride + item.size > len(data)):
            raise ValueError('Accessor outside bufferView')
        values = [item.unpack_from(data, offset + i*stride) for i in range(a['count'])]
        if a.get('normalized') and a['componentType'] != 5126:
            scale = {5120:127, 5121:255, 5122:32767, 5123:65535, 5125:4294967295}[a['componentType']]
            values = [tuple(max(-1, x/scale) for x in row) for row in values]
        self.cache[index] = values
        return values


def inspect(glb):
    doc, checks = glb.doc, []

    def check(id, passed, detail, warning=False):
        checks.append({'id': id, 'passed': bool(passed), 'detail': detail, 'severity': 'warning' if warning else 'error'})

    nodes = doc.get('nodes', [])
    names = collections.defaultdict(list)
    parents = collections.defaultdict(list)
    for index, node in enumerate(nodes):
        names[node.get('name', '')].append(index)
        for child in node.get('children', []):
            if child < 0 or child >= len(nodes):
                raise ValueError('Invalid child node index')
            parents[child].append(index)
    check('single-parent', all(len(p) <= 1 for p in parents.values()), 'Each node has at most one parent')
    for name in REQUIRED:
        check('node:' + name, len(names[name]) == 1, f'{name}: {len(names[name])} nodes')
    root = names['W_Root'][0] if len(names['W_Root']) == 1 else None
    world = {}

    def world_matrix(index, seen=None):
        if index in world:
            return world[index]
        seen = set() if seen is None else set(seen)
        if index in seen:
            raise ValueError('Cyclic scene hierarchy')
        seen.add(index)
        local = matrix(nodes[index])
        world[index] = mul(world_matrix(parents[index][0], seen), local) if parents[index] else local
        return world[index]

    def under(index, ancestor):
        visited = set()
        while index is not None:
            if index == ancestor:
                return True
            if index in visited:
                raise ValueError('Cyclic scene hierarchy')
            visited.add(index)
            index = parents[index][0] if parents[index] else None
        return False

    for index in range(len(nodes)):
        world_matrix(index)
    scene_roots = doc.get('scenes', [{}])[doc.get('scene', 0)].get('nodes', [])
    reachable = {i for i in range(len(nodes)) if any(under(i, r) for r in scene_roots)}
    check('scene-root', root in scene_roots, 'W_Root is a root of the active scene')
    check('root-empty', root is not None and 'mesh' not in nodes[root], 'W_Root is an empty transform')
    check('hierarchy', root is not None and all(under(i, root) for i in range(len(nodes))), 'Every exported node belongs to W_Root')
    check('reachable', len(reachable) == len(nodes), f'{len(reachable)}/{len(nodes)} nodes reachable in active scene')
    check('campin', not any(n == 'CamPin' or n.startswith('CamPin.') for n in names), 'No loose CamPin mesh')
    for name in MOVING:
        own = names[name]
        check('mesh:' + name, len(own) == 1 and 'mesh' in nodes[own[0]], f'{name} has a separate mesh')
    for name in EMPTIES:
        own = names[name]
        check('empty:' + name, len(own) == 1 and 'mesh' not in nodes[own[0]], f'{name} is an empty transform')
    for name in ('W_Muzzle', 'W_LightEmitter'):
        direction = unit(transform(world[names[name][0]], (0, 0, -1), False)) if len(names[name]) == 1 else (0, 0, 0)
        check('axis:' + name, -direction[2] >= .995, f'{name} glTF local -Z in world: {direction}')
    direction = unit(transform(world[names['W_Ejection'][0]], (1, 0, 0), False)) if len(names['W_Ejection']) == 1 else (0, 0, 0)
    check('ejection-axis', direction[0] > .8, f'W_Ejection local +X in world: {direction}')
    points, points_by_node, primitives = [], {}, []
    bad_pos = bad_normal = bad_index = bad_uv = missing_uv = degenerate = degenerate_uv = 0
    triangles = vertices = 0
    density = collections.defaultdict(lambda: [0.0, 0.0])
    for index, node in enumerate(nodes):
        if 'mesh' not in node:
            continue
        node_points = []
        for primitive in doc['meshes'][node['mesh']]['primitives']:
            attrs = primitive['attributes']
            if primitive.get('mode', 4) != 4:
                raise ValueError('Weapon meshes must contain triangles')
            positions = glb.accessor(attrs['POSITION'])
            normals = glb.accessor(attrs['NORMAL']) if 'NORMAL' in attrs else []
            uvs = glb.accessor(attrs['TEXCOORD_0']) if 'TEXCOORD_0' in attrs else []
            world_points = [transform(world[index], p) for p in positions]
            node_points.extend(world_points)
            vertices += len(positions)
            bad_pos += sum(not all(math.isfinite(v) for v in p) for p in world_points)
            bad_normal += abs(len(normals) - len(positions)) + sum(not all(math.isfinite(v) for v in n) or sum(v*v for v in n) < .25 for n in normals)
            bad_uv += sum(not all(math.isfinite(v) and -.001 <= v <= 1.001 for v in uv) for uv in uvs)
            mat = doc.get('materials', [])[primitive['material']] if 'material' in primitive else {}
            pbr = mat.get('pbrMetallicRoughness', {})
            if (pbr.get('baseColorTexture') or pbr.get('metallicRoughnessTexture') or mat.get('normalTexture')) and len(uvs) != len(positions):
                missing_uv += 1
            indices = [i[0] for i in glb.accessor(primitive['indices'])] if 'indices' in primitive else list(range(len(positions)))
            if len(indices) % 3:
                raise ValueError('Triangle index count is not divisible by three')
            bad_index += sum(not isinstance(i, int) or i < 0 or i >= len(positions) for i in indices)
            triangles += len(indices)//3
            primitive_triangles = len(indices)//3
            if not bad_index and not bad_pos:
                surface, uv_surface = 0.0, 0.0
                for start in range(0, len(indices), 3):
                    ids = indices[start:start+3]
                    area3d = area(*(world_points[i] for i in ids))
                    surface += area3d
                    degenerate += area3d < 1e-14
                    if len(uvs) == len(positions):
                        a, b, c = (uvs[i] for i in ids)
                        area2d = abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])) / 2
                        uv_surface += area2d
                        degenerate_uv += area3d >= 1e-14 and area2d < 1e-14
                density[mat.get('name', 'unnamed')][0] += surface
                density[mat.get('name', 'unnamed')][1] += uv_surface
            primitives.append({'node': node.get('name'), 'material': mat.get('name'), 'triangles': primitive_triangles})
        points_by_node[index] = node_points
        points.extend(node_points)
    box = bounds(points)
    check('geometry', bad_pos == bad_normal == bad_index == 0, f'Invalid positions={bad_pos}, normals={bad_normal}, indices={bad_index}')
    check('uv', bad_uv == missing_uv == 0, f'Invalid atlas UVs={bad_uv}, textured primitives without UVs={missing_uv}')
    check('nondegenerate', degenerate == 0, f'{degenerate} triangles with area < 1e-14 m2', True)
    check('uv-area', degenerate_uv == 0, f'{degenerate_uv} nonzero triangles with UV area < 1e-14', True)
    check('size', glb.bytes <= 3_000_000, f'{glb.bytes} / 3000000 bytes')
    check('length', box and .81 <= box['size'][2] <= .87, f'World Z length: {box["size"][2] if box else None}; expected 0.84 +/- 0.03 m')
    check('longitudinal-axis', box and box['size'][2] > max(box['size'][:2]), 'Longest dimension is world Z')
    muzzle = transform(world[names['W_Muzzle'][0]], (0, 0, 0)) if len(names['W_Muzzle']) == 1 else None
    check('muzzle-position', box and muzzle and abs(muzzle[2] - box['min'][2]) < .025, f'Muzzle position: {muzzle}')
    mag = names['W_Mag'][0] if len(names['W_Mag']) == 1 else None
    mag_box = bounds([p for i, ps in points_by_node.items() if mag is not None and under(i, mag) for p in ps])
    check('magazine-body', mag_box and mag_box['size'][0] > .02 and mag_box['size'][1] > .12 and mag_box['size'][2] > .05, f'Magazine bounds: {mag_box}')
    mag_parts = [i for i, node in enumerate(nodes) if node.get('name', '').startswith(('MagBody', 'MagRound', 'MagLip', 'MagFollower', 'MagFloor', 'MagBase', 'MagRib'))]
    check('magazine-hierarchy', mag is not None and all(under(i, mag) for i in mag_parts), 'All named magazine components belong to W_Mag')
    materials, baked = doc.get('materials', []), []
    for material in materials:
        pbr = material.get('pbrMetallicRoughness', {})
        if pbr.get('baseColorTexture') and material.get('alphaMode') != 'BLEND' and not material.get('emissiveTexture') and not any(material.get('emissiveFactor', (0, 0, 0))):
            baked.append(material)
    check('baked-pbr', baked and all(m.get('normalTexture') and m.get('occlusionTexture') and m['pbrMetallicRoughness'].get('metallicRoughnessTexture') for m in baked), f'{len(baked)} baked PBR materials with albedo, ORM and normal')
    image_reports = []
    images = doc.get('images', [])
    check('embedded-images', images and all('bufferView' in i and 'uri' not in i for i in images), f'{len(images)} embedded images')
    for image in images:
        data = glb.view(image['bufferView']) if 'bufferView' in image else b''
        image_reports.append({'name': image.get('name'), 'mimeType': image.get('mimeType'), 'bytes': len(data), 'size': image_size(data)})
    texels_per_meter = {}
    for material in baked:
        name = material.get('name', 'unnamed')
        surface, uv_surface = density[name]
        texture = doc['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
        source = texture.get('extensions', {}).get('EXT_texture_webp', {}).get('source', texture.get('source'))
        size = image_reports[source]['size'] if source is not None else None
        if size and surface:
            texels_per_meter[name] = math.sqrt(uv_surface / surface * size[0] * size[1])
    return {'ok': all(c['passed'] or c['severity'] == 'warning' for c in checks), 'file': str(glb.path), 'bytes': glb.bytes, 'sha256': glb.sha256,
            'decoding': glb.decoding,
            'bounds': box, 'vertices': vertices, 'triangles': triangles, 'nodes': len(nodes), 'meshes': len(points_by_node),
            'materials': len(materials), 'images': image_reports, 'texelsPerMeterByMaterial': texels_per_meter,
            'primitives': primitives, 'checks': checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('glb', nargs='?', type=Path, default=Path(__file__).resolve().parents[2] / 'models' / 'carbine.glb')
    parser.add_argument('--json', type=Path, help='Write machine-readable report outside the repository')
    parser.add_argument('--meshopt-decoder', type=Path, default=os.environ.get('MESHOPT_DECODER'),
                        help='Real MeshoptDecoder ES module; defaults to MESHOPT_DECODER environment variable')
    args = parser.parse_args()
    try:
        report = inspect(GLB(args.glb, args.meshopt_decoder))
    except (ValueError, KeyError, IndexError, OSError, struct.error, TypeError, subprocess.TimeoutExpired) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 2
    for check in report['checks']:
        marker = 'PASS' if check['passed'] else 'WARN' if check['severity'] == 'warning' else 'FAIL'
        print(f'{marker:4} {check["id"]}: {check["detail"]}')
    print(json.dumps({k: report[k] for k in ('ok', 'bytes', 'bounds', 'triangles', 'texelsPerMeterByMaterial')}, indent=2))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2) + '\n')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
