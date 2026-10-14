"""Compact Blender GLBs without a runtime decoder or lossy position changes.

Normals/tangents use signed normalized bytes. UVs use normalized uint16 only
when triangle area/sign survives rounding. Three.js GLTFLoader supports
KHR_mesh_quantization natively. Positions, hierarchy, pivots and image bytes
are preserved; zero-area faces are removed from index buffers.
"""
import json
import struct
import copy
from pathlib import Path

import numpy as np


def pack_glb(path):
    path = Path(path)
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    if magic != b'glTF' or version != 2 or length != len(raw):
        raise ValueError('Invalid GLB')
    json_size = struct.unpack_from('<I', raw, 12)[0]
    gltf = json.loads(raw[20:20 + json_size])
    if '; C9 normal/UV quantization' in gltf['asset'].get('generator', ''):
        return len(raw), len(raw)
    bin_offset = 20 + json_size
    bin_size, bin_type = struct.unpack_from('<I4s', raw, bin_offset)
    if bin_type != b'BIN\x00':
        raise ValueError('Missing GLB binary chunk')
    source = raw[bin_offset + 8:bin_offset + 8 + bin_size]
    old_views = gltf['bufferViews']
    accessors = gltf['accessors']
    originals = copy.deepcopy(accessors)
    semantic = {}
    tangent_normals = {}
    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            for name, index in prim['attributes'].items():
                semantic[index] = name
            if 'TANGENT' in prim['attributes']:
                tangent_normals[prim['attributes']['TANGENT']] = prim['attributes']['NORMAL']
    output = bytearray()
    views = []

    def view(data, target=None, stride=None):
        output.extend(b'\x00' * (-len(output) % 4))
        v = dict(buffer=0, byteOffset=len(output), byteLength=len(data))
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        views.append(v)
        output.extend(data)
        return len(views) - 1

    dtypes = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
    widths = dict(SCALAR=1, VEC2=2, VEC3=3, VEC4=4, MAT4=16)

    def read(index):
        acc = originals[index]
        old = old_views[acc['bufferView']]
        dtype = np.dtype(dtypes[acc['componentType']])
        width = widths[acc['type']]
        stride = old.get('byteStride', dtype.itemsize * width)
        offset = old.get('byteOffset', 0) + acc.get('byteOffset', 0)
        return np.ndarray((acc['count'], width), dtype=dtype, buffer=source,
                          offset=offset, strides=(stride, dtype.itemsize)).copy()

    quantized = False
    repaired_tangents = 0
    keep_float_uv = set()
    index_overrides = {}
    removed_zero_area = 0
    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            if prim.get('mode', 4) != 4 or 'indices' not in prim:
                continue
            attrs = prim['attributes']
            ids = read(prim['indices']).reshape(-1, 3)
            points = read(attrs['POSITION'])[ids].astype(np.float64)
            twice_area = np.linalg.norm(np.cross(points[:, 1]-points[:, 0], points[:, 2]-points[:, 0]), axis=1)
            valid = twice_area >= 2e-14
            removed_zero_area += int((~valid).sum())
            ids = ids[valid]
            index_overrides[prim['indices']] = ids.reshape(-1, 1)
            if 'TEXCOORD_0' in attrs:
                uv_index = attrs['TEXCOORD_0']
                uv = read(uv_index)
                before = uv[ids].astype(np.float64)
                after = np.rint(uv * 65535)[ids].astype(np.float64) / 65535
                def area2(p):
                    a, b = p[:, 1]-p[:, 0], p[:, 2]-p[:, 0]
                    return a[:, 0]*b[:, 1] - a[:, 1]*b[:, 0]
                a, b = area2(before), area2(after)
                if np.any((np.abs(a) >= 2e-14) & ((np.abs(b) < 2e-14) | (a*b < 0))):
                    keep_float_uv.add(uv_index)
    for i, acc in enumerate(accessors):
        if 'sparse' in acc:
            raise ValueError('Sparse accessors are outside this exporter contract')
        old = old_views[acc['bufferView']]
        dtype = np.dtype(dtypes[acc['componentType']])
        width = widths[acc['type']]
        stride = old.get('byteStride', dtype.itemsize * width)
        offset = old.get('byteOffset', 0) + acc.get('byteOffset', 0)
        values = index_overrides.get(i, read(i))
        acc['count'] = len(values)
        name = semantic.get(i, '')
        new_stride = None
        if name in ('NORMAL', 'TANGENT') and acc['componentType'] == 5126:
            if name == 'TANGENT':
                # MikkTSpace has no basis on zero-area UV slivers. Supply a
                # deterministic orthogonal basis instead of exporting (0,0,0).
                bad = np.linalg.norm(values[:, :3], axis=1) < 1e-6
                repaired_tangents += int(bad.sum())
                if bad.any():
                    normals = read(tangent_normals[i])[bad, :3]
                    basis = np.eye(3, dtype=np.float32)[np.argmin(np.abs(normals), axis=1)]
                    values[bad, :3] = np.cross(normals, basis)
                values[:, :3] /= np.maximum(np.linalg.norm(values[:, :3], axis=1)[:, None], 1e-12)
                values[:, 3] = np.where(values[:, 3] < 0, -1, 1)
            values = np.rint(np.clip(values, -1, 1) * 127).astype('i1')
            acc.update(componentType=5120, normalized=True)
            # VEC3 byte attributes still start on 4-byte boundaries.
            if width == 3:
                padded = np.zeros((len(values), 4), dtype='i1')
                padded[:, :3] = values
                data = padded.tobytes()
            else:
                data = values.tobytes()
            new_stride = 4
            quantized = True
        elif name.startswith('TEXCOORD_') and i not in keep_float_uv and acc['componentType'] == 5126 and values.min() >= 0 and values.max() <= 1:
            values = np.rint(values * 65535).astype('<u2')
            acc.update(componentType=5123, normalized=True)
            data = values.tobytes()
        else:
            data = values.tobytes()
        for bound, func in (('min', np.min), ('max', np.max)):
            if bound in acc:
                acc[bound] = func(values, axis=0).tolist()
        acc['bufferView'] = view(data, old.get('target'), new_stride)
        acc.pop('byteOffset', None)

    for image in gltf.get('images', []):
        old = old_views[image['bufferView']]
        start = old.get('byteOffset', 0)
        image['bufferView'] = view(source[start:start + old['byteLength']])
    if quantized:
        for field in ('extensionsUsed', 'extensionsRequired'):
            gltf[field] = sorted(set(gltf.get(field, []) + ['KHR_mesh_quantization']))
    gltf['bufferViews'] = views
    gltf['buffers'] = [dict(byteLength=len(output))]
    gltf['asset']['generator'] += '; C9 normal/UV quantization'
    gltf['asset'].setdefault('extras', {})['repairedDegenerateTangents'] = repaired_tangents
    gltf['asset']['extras']['removedZeroAreaTriangles'] = removed_zero_area
    gltf['asset']['extras']['preservedFloatUVAccessors'] = sorted(keep_float_uv)
    header = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode('utf8')
    header += b' ' * (-len(header) % 4)
    output.extend(b'\x00' * (-len(output) % 4))
    result = struct.pack('<4sII', b'glTF', 2, 28 + len(header) + len(output))
    result += struct.pack('<I4s', len(header), b'JSON') + header
    result += struct.pack('<I4s', len(output), b'BIN\x00') + output
    path.write_bytes(result)
    return len(raw), len(result)


if __name__ == '__main__':
    import sys
    for filename in sys.argv[1:]:
        print(filename, pack_glb(filename))
