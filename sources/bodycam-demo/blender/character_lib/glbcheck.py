"""Read back the delivered GLB bytes. Run with python3 glbcheck.py FILE [REPORT]."""
import json
import struct
import sys
from pathlib import Path
import numpy as np

DTYPE = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def jpeg_dimensions(data):
    assert data[:2] == b'\xff\xd8'
    offset = 2
    while offset + 4 < len(data):
        assert data[offset] == 0xff
        marker = data[offset + 1]
        length = struct.unpack_from('>H', data, offset + 2)[0]
        if marker in (0xc0, 0xc1, 0xc2):
            height, width = struct.unpack_from('>HH', data, offset + 5)
            return width, height
        offset += 2 + length
    raise ValueError('JPEG has no supported size header')


def check(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and length == len(data)
    size, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    doc = json.loads(data[20:20 + size])
    offset = 20 + size
    bsize, kind = struct.unpack_from('<II', data, offset)
    assert kind == 0x004e4942
    binary = data[offset + 8:offset + 8 + bsize]

    def accessor(index):
        a = doc['accessors'][index]
        bv = doc['bufferViews'][a['bufferView']]
        dtype = np.dtype(DTYPE[a['componentType']])
        width = WIDTH[a['type']]
        array = np.ndarray((a['count'], width), dtype=dtype, buffer=binary,
                           offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0),
                           strides=(bv.get('byteStride', width * dtype.itemsize), dtype.itemsize))
        assert np.isfinite(array).all()
        return array

    assert len(data) <= 12_000_000, 'Size budget'
    assert not doc.get('animations'), 'Unexpected animation clips'
    assert not doc.get('extensionsRequired'), 'Unexpected runtime decoder requirement'
    assert all('uri' not in b for b in doc['buffers'])
    assert len(doc['images']) == 3
    dimensions = []
    for im in doc['images']:
        assert 'uri' not in im and im['mimeType'] in ('image/png', 'image/jpeg')
        bv = doc['bufferViews'][im['bufferView']]
        header = binary[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + 24]
        if im['mimeType'] == 'image/png':
            assert header[:8] == b'\x89PNG\r\n\x1a\n'
            dims = struct.unpack_from('>II', header, 16)
        else:
            dims = jpeg_dimensions(binary[bv.get('byteOffset', 0):
                                          bv.get('byteOffset', 0) + bv['byteLength']])
        assert dims == (2048, 2048)
        dimensions.append(list(dims))
    required = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End']
    for side in ('Left', 'Right'):
        required += [side + n for n in ('Shoulder', 'Arm', 'ForeArm', 'ForeArmTwist', 'Hand',
                                        'UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End')]
        required += [f'{side}Hand{f}{i}' for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky') for i in range(1, 5)]
    names = [n.get('name', '') for n in doc['nodes']]
    assert all(names.count(n) == 1 for n in required), 'Bone names changed or duplicated'
    vertices = triangles = skinned_vertices = 0
    max_error = 0.0
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            vertices += len(accessor(attrs['POSITION']))
            triangles += len(accessor(prim['indices'])) // 3
            for idx in attrs.values():
                accessor(idx)
            if 'WEIGHTS_0' in attrs:
                assert 'WEIGHTS_1' not in attrs and 'JOINTS_1' not in attrs
                weights = accessor(attrs['WEIGHTS_0'])
                assert weights.shape[1] == 4 and (weights >= 0).all() and (weights <= 1).all()
                error = float(np.abs(weights.sum(axis=1) - 1).max())
                assert error < 1e-5
                max_error = max(max_error, error)
                skinned_vertices += len(weights)
    assert skinned_vertices > 0
    mats = doc['materials']
    assert len(mats) == 1
    mat = mats[0]
    assert all(k in mat for k in ('normalTexture', 'occlusionTexture'))
    assert all(k in mat['pbrMetallicRoughness'] for k in ('baseColorTexture', 'metallicRoughnessTexture'))
    assert mat['occlusionTexture']['index'] == mat['pbrMetallicRoughness']['metallicRoughnessTexture']['index']
    result = {'passed': True, 'bytes': len(data), 'meshes': len(doc['meshes']),
              'vertices': vertices, 'triangles': triangles, 'skinnedVertices': skinned_vertices,
              'skinCount': len(doc['skins']), 'boneCount': len(required), 'maxWeightSumError': max_error,
              'images': dimensions, 'animationCount': 0, 'requiredExtensions': doc.get('extensionsRequired', [])}
    return result


if __name__ == '__main__':
    report = check(sys.argv[1])
    print(json.dumps(report, indent=2))
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(report, indent=2))
