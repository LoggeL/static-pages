#!/usr/bin/env python3
"""Build the baked phone profile without changing any geometry or layout.

Requires Pillow and NumPy. Embedded images are externalized and resized; all
geometry buffer ranges (including Meshopt payloads), accessors, nodes, rigs,
material assignments and transforms are checked byte-for-byte. Shared images
can reference *absolute file offsets* in another GLB, so their buffers are read
as opaque files rather than treating them as a GLB BIN chunk.
"""

import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import struct

import numpy as np
from PIL import Image


MODELS = ('house', 'house_collision', 'carbine', 'officer_fp', 'officer',
          'casing_556', 'mag_spare')
SEMANTIC_KEYS = ('asset', 'accessors', 'samplers', 'textures', 'materials',
                 'meshes', 'nodes', 'scenes', 'scene', 'skins', 'animations',
                 'extensionsUsed', 'extensionsRequired')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def unpack_glb(path):
    data = path.read_bytes()
    if struct.unpack_from('<III', data) != (0x46546C67, 2, len(data)):
        raise ValueError(f'Invalid GLB: {path}')
    length, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4E4F534A:
        raise ValueError(f'Missing GLB JSON: {path}')
    value = json.loads(data[20:20 + length])
    offset = 20 + length
    binary = b''
    if offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        if kind != 0x004E4942:
            raise ValueError(f'Invalid GLB BIN: {path}')
        binary = data[offset + 8:offset + 8 + size]
    return value, binary


def pack_glb(value, binary):
    payload = json_bytes(value)
    payload += b' ' * (-len(payload) % 4)
    binary += b'\0' * (-len(binary) % 4)
    return (struct.pack('<IIIII', 0x46546C67, 2,
                        28 + len(payload) + len(binary), len(payload), 0x4E4F534A)
            + payload + struct.pack('<II', len(binary), 0x004E4942) + binary)


def fit_size(size, limit):
    scale = min(1, limit / max(size))
    return tuple(max(1, round(value * scale)) for value in size)


def resize_image(image, limit, kind):
    size = fit_size(image.size, limit)
    image = image.convert('RGBA' if 'A' in image.getbands() else 'RGB')
    if size == image.size:
        return image
    if kind == 'normal':
        normal = np.asarray(image.convert('RGB'), dtype=np.float32) / 127.5 - 1
        channels = [np.asarray(Image.fromarray(normal[:, :, i], mode='F')
                    .resize(size, Image.Resampling.BOX)) for i in range(3)]
        normal = np.stack(channels, axis=2)
        normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-8)
        return Image.fromarray(np.rint(np.clip(normal * .5 + .5, 0, 1) * 255).astype(np.uint8))
    return image.resize(size, Image.Resampling.LANCZOS)


class Builder:
    def __init__(self, source, output):
        self.source, self.output = source, output
        self.rows, self.models, self.atlases = [], [], []
        self.dependencies = set()
        self.image_cache = {}

    def texture(self, data, relative, limit, kind='color', source_label=None):
        original = Image.open(io.BytesIO(data))
        size = original.size
        result = resize_image(original, limit, kind)
        path = self.output / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        # Lossless data maps retain their channel values after the intentional
        # resize. Alpha remains straight, including the RGBM atlases below.
        result.save(path, 'WEBP', lossless=kind != 'color', quality=90,
                    method=6, exact=True)
        row = {'source': source_label, 'output': relative.as_posix(),
               'sourceSize': list(size), 'size': list(result.size),
               'sourceBytes': len(data), 'bytes': path.stat().st_size,
               'sourceRgbaBytes': size[0] * size[1] * 4,
               'rgbaBytes': result.width * result.height * 4,
               'kind': kind}
        self.rows.append(row)
        return row

    def image_payload(self, model_path, value, binary, image):
        if 'uri' in image:
            path = (model_path.parent / image['uri']).resolve()
            self.dependencies.add(path)
            return path.read_bytes()
        view = value['bufferViews'][image['bufferView']]
        buffer = value['buffers'][view['buffer']]
        if 'uri' in buffer:
            # Shared source buffers contain the complete GLB file. Their views
            # already include its JSON/header offset; do not add it a second time.
            path = (model_path.parent / buffer['uri']).resolve()
            self.dependencies.add(path)
            payload = path.read_bytes()
        elif view['buffer'] == 0:
            payload = binary
        else:
            raise ValueError('An image references a virtual Meshopt fallback buffer')
        offset = view.get('byteOffset', 0)
        return payload[offset:offset + view['byteLength']]

    def geometry_digest(self, value, binary, image_views):
        digest = hashlib.sha256()
        semantics = copy.deepcopy({key: value.get(key) for key in SEMANTIC_KEYS})
        # PNG/JPEG image sources intentionally become WebP. Normalize only that
        # codec routing; texture indices, samplers and every material slot stay
        # identical in the integrity comparison.
        for texture in semantics.get('textures') or []:
            if 'source' in texture:
                texture.setdefault('extensions', {})['EXT_texture_webp'] = {
                    'source': texture.pop('source')}
        for key in ('extensionsUsed', 'extensionsRequired'):
            semantics[key] = sorted(set((semantics.get(key) or []) + ['EXT_texture_webp']))
        digest.update(json_bytes(semantics))
        for index, view in enumerate(value.get('bufferViews', [])):
            if index in image_views:
                continue
            view = copy.deepcopy(view)
            extension = view.get('extensions', {}).get('EXT_meshopt_compression')
            if extension:
                if extension['buffer'] != 0:
                    raise ValueError('Unexpected external geometry compression buffer')
                start = extension.pop('byteOffset', 0)
                data = binary[start:start + extension['byteLength']]
            else:
                if view['buffer'] != 0:
                    raise ValueError('Unexpected external geometry buffer')
                start = view.get('byteOffset', 0)
                data = binary[start:start + view['byteLength']]
            view.pop('byteOffset', None)
            digest.update(json_bytes([index, view]))
            digest.update(data)
        return digest.hexdigest()

    def model(self, name):
        source = self.source / f'models/{name}.glb'
        self.dependencies.add(source.resolve())
        target = self.output / f'models/{name}.glb'
        target.parent.mkdir(parents=True, exist_ok=True)
        if name == 'house_collision':
            shutil.copyfile(source, target)
            self.models.append({'name': name, 'sourceBytes': source.stat().st_size,
                                'bytes': target.stat().st_size, 'byteExact': True,
                                'sha256': sha(target.read_bytes())})
            return
        value, binary = unpack_glb(source)
        result = copy.deepcopy(value)
        image_views = {image['bufferView'] for image in value.get('images', [])
                       if 'bufferView' in image}
        before = self.geometry_digest(value, binary, image_views)
        for index, image in enumerate(value.get('images', [])):
            data = self.image_payload(source, value, binary, image)
            label = image.get('name', f'image-{index}')
            kind = ('normal' if 'normal' in label else 'data' if 'orm' in label
                    else 'color')
            limit = 256 if name == 'house' else 512
            key = sha(data + f'{limit}/{kind}'.encode())
            if key not in self.image_cache:
                relative = Path(f'textures/models/{key[:24]}.webp')
                row = self.texture(data, relative, limit, kind,
                                   f'models/{name}.glb#{index}:{label}')
                self.image_cache[key] = relative, row
            relative, _ = self.image_cache[key]
            result['images'][index].pop('bufferView', None)
            result['images'][index]['uri'] = '../' + relative.as_posix()
            result['images'][index]['mimeType'] = 'image/webp'

        for texture in result.get('textures', []):
            if 'source' in texture:
                texture.setdefault('extensions', {})['EXT_texture_webp'] = {
                    'source': texture.pop('source')}
        for key in ('extensionsUsed', 'extensionsRequired'):
            result[key] = sorted(set(result.get(key, []) + ['EXT_texture_webp']))

        # Retain all bufferView indices so accessors and extension references
        # remain unchanged. Image-only views become harmless one-byte unused
        # views. Copy every geometry/compressed span exactly, never re-encode it.
        packed = bytearray(b'\0\0\0\0')
        ranges = {}

        def copy_range(start, length):
            key = start, length
            if key not in ranges:
                packed.extend(b'\0' * (-len(packed) % 4))
                ranges[key] = len(packed)
                payload = binary[start:start + length]
                if len(payload) != length:
                    raise ValueError(f'Geometry range outside source BIN: {name}')
                packed.extend(payload)
            return ranges[key]

        for index, view in enumerate(result.get('bufferViews', [])):
            if index in image_views:
                result['bufferViews'][index] = {'buffer': 0, 'byteOffset': 0, 'byteLength': 1}
                continue
            extension = view.get('extensions', {}).get('EXT_meshopt_compression')
            if extension:
                if extension['buffer'] != 0:
                    raise ValueError('Unexpected Meshopt geometry source')
                extension['byteOffset'] = copy_range(extension.get('byteOffset', 0),
                                                      extension['byteLength'])
            else:
                if view['buffer'] != 0:
                    raise ValueError('Unexpected external raw geometry')
                view['byteOffset'] = copy_range(view.get('byteOffset', 0), view['byteLength'])
        # External buffers held images only; fail if any live view still needs
        # one. Keep the virtual decoded fallback buffer used by Meshopt.
        used = {view['buffer'] for i, view in enumerate(result['bufferViews'])
                if i not in image_views}
        if used - {0, 1}:
            raise ValueError('External geometry cannot be discarded')
        result['buffers'] = [dict(value['buffers'][0], byteLength=len(packed))]
        if 1 in used:
            result['buffers'].append(copy.deepcopy(value['buffers'][1]))
        result['buffers'][0].pop('uri', None)
        target.write_bytes(pack_glb(result, bytes(packed)))
        reread, check_binary = unpack_glb(target)
        after = self.geometry_digest(reread, check_binary, image_views)
        if before != after:
            raise ValueError(f'Geometry changed: {name}')
        self.models.append({'name': name, 'sourceBytes': source.stat().st_size,
                            'bytes': target.stat().st_size, 'images': len(value.get('images', [])),
                            'geometryByteExact': True, 'geometrySHA256': before,
                            'nodes': len(value.get('nodes', [])),
                            'meshes': len(value.get('meshes', [])),
                            'externalGeometryBuffers': 0})

    def texture_index(self):
        source = self.source / 'textures/index.json'
        self.dependencies.add(source.resolve())
        value = json.loads(source.read_text())
        for name, definition in value.items():
            if name == 'decals':
                for definition in definition.values():
                    for key in ('file', 'normal'):
                        if key not in definition:
                            continue
                        file = definition[key]
                        original = self.source / 'textures' / file
                        self.dependencies.add(original.resolve())
                        relative = Path('textures') / Path(file).with_suffix('.webp')
                        row = self.texture(original.read_bytes(), relative, 256,
                                           'normal' if key == 'normal' else 'color',
                                           original.relative_to(self.source).as_posix())
                        definition[key] = relative.relative_to('textures').as_posix()
                        if key == 'file':
                            definition['size'] = max(row['size'])
                continue
            sizes = {}
            for kind, filename in definition['files'].items():
                original = self.source / 'textures' / name / filename
                self.dependencies.add(original.resolve())
                relative = Path(f'textures/{name}/{kind}.webp')
                row = self.texture(original.read_bytes(), relative, 256,
                                   'normal' if kind == 'normal' else 'data' if kind == 'orm' else 'color',
                                   original.relative_to(self.source).as_posix())
                definition['files'][kind] = relative.name
                sizes[kind] = max(row['size'])
            definition['sizes'] = sizes
            definition['size'] = max(sizes.values())
        write_json(self.output / 'textures/index.json', value)

    def lightmaps(self):
        source = self.source / 'data/level.json'
        self.dependencies.add(source.resolve())
        level = json.loads(source.read_text())
        for atlas in level['lightmaps']:
            original = self.source / atlas['path']
            self.dependencies.add(original.resolve())
            rgba = np.asarray(Image.open(original).convert('RGBA'), dtype=np.float32) / 255
            source_size = (rgba.shape[1], rgba.shape[0])
            size = fit_size(source_size, 512)
            exponent = atlas.get('multiplierExponent',
                                 level.get('lightmapEncoding', {}).get('multiplierExponent', 1))
            if not isinstance(exponent, (int, float)) or exponent <= 0:
                raise ValueError(f'Atlas has no numeric RGBM multiplier exponent: {atlas["id"]}')
            radiance = rgba[:, :, :3] * (rgba[:, :, 3:4] ** exponent) * atlas['range']
            # Area-average decoded LINEAR radiance. Averaging encoded RGBM bytes
            # would darken bright texels and does not preserve the baked energy.
            channels = [np.asarray(Image.fromarray(radiance[:, :, c], mode='F')
                        .resize(size, Image.Resampling.BOX)) for c in range(3)]
            linear = np.stack(channels, axis=2)
            normalized = linear / atlas['range']
            multiplier = np.maximum(1, np.ceil(np.clip(np.max(normalized, axis=2), 0, 1)
                                              ** (1 / exponent) * 255)).astype(np.uint8)
            factor = (multiplier.astype(np.float32) / 255) ** exponent
            rgb = np.rint(np.clip(normalized / factor[:, :, None], 0, 1) * 255).astype(np.uint8)
            encoded = np.dstack((rgb, multiplier))
            decoded = rgb.astype(np.float32) / 255 * factor[:, :, None] * atlas['range']
            destination = self.output / atlas['path']
            destination.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(encoded).save(destination, 'PNG', optimize=True)
            check = np.asarray(Image.open(destination))
            if not np.array_equal(encoded, check):
                raise ValueError('PNG encoder modified RGBM bytes')
            row = {'id': atlas['id'], 'path': atlas['path'],
                   'sourceSize': list(source_size), 'size': list(size),
                   'range': atlas['range'], 'multiplierExponent': exponent,
                   'sourceBytes': original.stat().st_size, 'bytes': destination.stat().st_size,
                   'sourceLinearMean': float(radiance.mean()),
                   'areaLinearMean': float(linear.mean()),
                   'decodedLinearMean': float(decoded.mean()),
                   'quantizationMaxAbs': float(np.abs(decoded - linear).max()),
                   'quantizationMeanAbs': float(np.abs(decoded - linear).mean()),
                   'linearAreaResample': True, 'rgbaReadbackExact': True}
            self.atlases.append(row)
            # Remove source-resolution precision/padding claims, retaining only
            # the atlas path, range, encoding and source scene provenance.
            atlas.update(width=size[0], height=size[1], bytes=row['bytes'],
                         sha256=sha(destination.read_bytes()),
                         mobileResample={'method': 'linear radiance area average, re-encoded RGBM',
                                         'sourceSize': list(source_size),
                                         'sourceSHA256': sha(original.read_bytes()),
                                         'quantizationMaxAbs': row['quantizationMaxAbs'],
                                         'quantizationMeanAbs': row['quantizationMeanAbs']})
            for key in ('chartPadding', 'coverageFraction', 'peakLinear', 'meanLinear',
                        'quantizationMaxAbs', 'quantizationMeanAbs', 'pngBeforeOptimizationBytes',
                        'pngLosslessVerified', 'pngOptimizer', 'pngOptimizationSeconds',
                        'pngOptimized', 'colorPrecisionBits', 'multiplierSteps'):
                atlas.pop(key, None)
            del rgba, radiance, linear, encoded, decoded
        before_layout = {key: value for key, value in json.loads(source.read_text()).items()
                         if key not in ('lightmaps', 'bake')}
        after_layout = {key: value for key, value in level.items() if key not in ('lightmaps', 'bake')}
        if before_layout != after_layout:
            raise ValueError('Level geometry, layout or metadata changed')
        level['bake']['mobileProfile'] = {
            'version': 1, 'geometryUnchanged': True, 'collisionByteExact': True,
            'maxTiledSize': 256, 'maxHouseImageSize': 256,
            'maxActorImageSize': 512, 'maxLightmapSize': 512,
            'resampling': 'decode RGBM to linear, area average, re-encode RGBM',
        }
        compression = level['bake'].get('compression', {})
        level['bake']['compression'] = {
            'codec': compression.get('codec'), 'quantized': compression.get('quantized'),
            'precision': compression.get('precision'),
            'codecLosslessVerified': True, 'geometryUnchanged': True,
            'bytes': (self.output / 'models/house.glb').stat().st_size,
            'geometrySHA256': next(row['geometrySHA256'] for row in self.models if row['name'] == 'house'),
            'sharedImageBuffers': [], 'imageMaxSize': 256,
            'images': 'external WebP; source shared buffer dependencies removed',
        }
        level['bake']['lightmapBytes'] = sum(row['bytes'] for row in self.atlases)
        write_json(self.output / 'data/level.json', level)

    def report(self):
        # RGBA8 images: decoded CPU bitmap + GPU image/mips. Lightmaps:
        # CPU half-float array + GPU half-float image, no mipmaps. These are
        # persistent texture estimates, excluding geometry and temporary decode.
        ordinary_before = sum(row['sourceRgbaBytes'] for row in self.rows)
        ordinary_after = sum(row['rgbaBytes'] for row in self.rows)
        light_before = sum(row['sourceSize'][0] * row['sourceSize'][1] * 16 for row in self.atlases)
        light_after = sum(row['size'][0] * row['size'][1] * 16 for row in self.atlases)
        estimate_before = round(ordinary_before * (1 + 4 / 3) + light_before)
        estimate_after = round(ordinary_after * (1 + 4 / 3) + light_after)
        files = sorted(path for path in self.output.rglob('*') if path.is_file())
        return {'version': 1, 'limits': {'tiled': 256, 'houseImages': 256, 'actors': 512, 'lightmaps': 512},
                'sourceDownloadBytes': sum(path.stat().st_size for path in self.dependencies),
                'mobileDownloadBytes': sum(path.stat().st_size for path in files),
                'mobileFiles': len(files), 'sourceDependencies': len(self.dependencies),
                'sourcePersistentTextureEstimateBytes': estimate_before,
                'mobilePersistentTextureEstimateBytes': estimate_after,
                'textureReductionFraction': 1 - estimate_after / estimate_before,
                'textureEstimatePolicy': 'RGBA8 CPU bitmap plus GPU including mipmaps; RGBA16F CPU+GPU without mipmaps; no geometry or transient decode',
                'levelAndSpawnAndDoorsUnchanged': True, 'collisionByteExact': True,
                'models': self.models, 'lightmaps': self.atlases, 'textures': self.rows,
                'manifest': [{'path': path.relative_to(self.output).as_posix(),
                              'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
                             for path in files]}

    def ancillary(self):
        for name in ('fp_anim.json',):
            source = self.source / 'data' / name
            self.dependencies.add(source.resolve())
            shutil.copyfile(source, self.output / 'data' / name)
        source = self.source / 'data/nav.json'
        self.dependencies.add(source.resolve())
        nav = json.loads(source.read_text())
        nav['bake']['sourceLevelSHA256'] = nav['bake']['levelSHA256']
        nav['bake']['levelSHA256'] = sha((self.output / 'data/level.json').read_bytes())
        if nav['bake']['collisionSHA256'] != sha((self.output / 'models/house_collision.glb').read_bytes()):
            raise ValueError('Navigation collision model changed')
        (self.output / 'data/nav.json').write_bytes(json_bytes(nav) + b'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[3] / 'public/bodycam-demo')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    output = (args.output or source / 'mobile').resolve()
    if output == source:
        raise ValueError('Output must not overwrite the source profile')
    output.mkdir(parents=True, exist_ok=True)
    builder = Builder(source, output)
    builder.texture_index()
    for name in MODELS:
        builder.model(name)
    builder.lightmaps()
    builder.ancillary()
    report = builder.report()
    write_json(args.report, report)
    print(json.dumps({key: value for key, value in report.items()
                      if key not in ('manifest', 'textures', 'models', 'lightmaps')}))


if __name__ == '__main__':
    main()
