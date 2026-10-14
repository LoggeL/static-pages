#!/usr/bin/env python3
"""Format-correct texture filenames, explicit map paths and quality metrics."""
import argparse
import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, features
from image_paths import IMAGE_SUFFIXES, encoded_path, resolve_map


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normal_resize(image, size):
    # Data channels, no gamma conversion. Renormalize filtered tangent-space vectors.
    resized = image.convert('RGB').resize(size, Image.Resampling.LANCZOS)
    values = np.asarray(resized, dtype=np.float32) / 127.5 - 1
    lengths = np.linalg.norm(values, axis=2, keepdims=True)
    values = values / np.maximum(lengths, 1e-8)
    return Image.fromarray(np.clip(np.rint((values + 1) * 127.5), 0, 255).astype('uint8'))


def metrics(reference, result, normal=False):
    a = np.asarray(reference.convert('RGBA'), dtype=float)
    b = np.asarray(result.convert('RGBA'), dtype=float)
    # Hidden RGB of fully transparent pixels does not contribute to visible error.
    weights = a[:, :, 3:4] / 255
    delta = (a[:, :, :3] - b[:, :, :3]) * weights
    rms = float(np.sqrt(np.mean(delta**2)))
    values = {'rgbMAE': float(np.mean(np.abs(delta))),
              'rgbPSNR': None if rms == 0 else 20 * math.log10(255 / rms),
              'alphaExact': bool(np.array_equal(a[:, :, 3], b[:, :, 3]))}
    if normal:
        x, y = a[:, :, :3] / 127.5 - 1, b[:, :, :3] / 127.5 - 1
        cosine = np.sum(x * y, axis=2) / np.maximum(np.linalg.norm(x, axis=2) * np.linalg.norm(y, axis=2), 1e-8)
        angle = np.degrees(np.arccos(np.clip(cosine, -1, 1)))
        values.update(normalMeanDegrees=float(angle.mean()), normalP99Degrees=float(np.quantile(angle, .99)))
    return values


def optimize_file(source, target, config):
    raw = source.read_bytes()
    with Image.open(BytesIO(raw)) as decoded:
        image = decoded.convert('RGBA' if 'A' in decoded.getbands() else 'RGB')
        source_format = decoded.format
    kind = source.stem if source.stem in ('albedo', 'normal', 'orm') and source.parent.name != 'decals' else 'decal'
    size = image.size
    if kind == 'normal' and max(size) < config.get('minimumNormalSize', 1):
        raise ValueError(f'Normal source lacks required detail: {source}; provide --normal-originals')
    if kind in config.get('preserveKinds', []):
        target = encoded_path(target, source_format)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        exact = {'rgbMAE': 0, 'rgbPSNR': None, 'alphaExact': True}
        if kind == 'normal':
            exact.update(normalMeanDegrees=0, normalP99Degrees=0)
        return {'path': str(target), 'kind': kind, 'beforeBytes': len(raw), 'afterBytes': len(raw),
                'beforeSize': image.size, 'afterSize': image.size, 'beforeFormat': source_format,
                'afterFormat': source_format, 'beforeSha256': digest(raw), 'afterSha256': digest(raw),
                'byteExact': True, 'codecErrorAtOutputResolution': exact, 'totalErrorUpsampledToOriginal': exact}
    cap = config.get(kind + 'MaxSize', config['tileMaxSize']) if kind != 'decal' else max(size)
    if max(size) > cap:
        size = tuple(max(1, round(value * cap / max(size))) for value in size)
        reference = normal_resize(image, size) if kind == 'normal' else image.resize(size, Image.Resampling.LANCZOS)
    else:
        reference = image.copy()
    encoded_reference = reference
    if kind in config.get('losslessKinds', []) and config.get('dataBits', 8) < 8:
        levels = (1 << config['dataBits']) - 1
        values = np.asarray(reference, dtype=np.float32)
        encoded_reference = Image.fromarray(np.rint(np.rint(values / 255 * levels) * 255 / levels).astype('uint8'))
    blob = BytesIO()
    encoded_reference.save(blob, format='WEBP', quality=config[kind + 'Quality'], method=config['method'], exact=True,
                   lossless=kind in config.get('losslessKinds', []))
    encoded = blob.getvalue()
    if config['retainSmallerOriginal'] and size == image.size and len(raw) <= len(encoded):
        encoded = raw
    result = Image.open(BytesIO(encoded))
    if image.mode == 'RGBA' and not metrics(reference, result)['alphaExact']:
        raise ValueError(f'Alpha changed: {source}')
    target = encoded_path(target, result.format)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encoded)
    row = {'path': str(target), 'kind': kind, 'beforeBytes': len(raw), 'afterBytes': len(encoded),
           'beforeSize': image.size, 'afterSize': result.size, 'beforeFormat': source_format,
           'afterFormat': result.format, 'beforeSha256': digest(raw), 'afterSha256': digest(encoded),
           'codecErrorAtOutputResolution': metrics(reference, result, kind == 'normal'),
           'totalErrorUpsampledToOriginal': metrics(image, result.resize(image.size, Image.Resampling.LANCZOS), kind == 'normal')}
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--originals', type=Path, required=True, help='Original textures directory')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--normal-originals', type=Path, help='Verified full-detail normal sources; other maps use originals unchanged')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('config.json'))
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    if args.originals.resolve() == args.output.resolve():
        parser.error('Originals and output must differ')
    config = json.loads(args.config.read_text())['textures']
    if not 4 <= config.get('dataBits', 8) <= 8:
        parser.error('dataBits must be between 4 and 8')
    if any(not 0 < config.get(kind + 'MaxSize', config['tileMaxSize']) <= 4096 for kind in ('albedo', 'normal', 'orm')):
        parser.error('Texture dimensions must be between 1 and 4096')
    paths = sorted(p for p in args.originals.rglob('*') if p.is_file())
    images = [p for p in paths if p.suffix.lower() in IMAGE_SUFFIXES]
    index = json.loads((args.originals / 'index.json').read_text())
    # Preflight names before workers write, so two sources cannot claim one output.
    stems = [(str(p.parent.relative_to(args.originals)), p.stem) for p in images]
    if len(set(stems)) != len(stems):
        parser.error('Multiple image encodings share a texture filename stem')
    for key, definition in index.items():
        if key != 'decals':
            for kind in definition['maps']:
                resolve_map(args.originals, key, kind, definition)
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        def process(source):
            relative = source.relative_to(args.originals)
            reference = source
            if args.normal_originals and source.stem == 'normal' and source.parent.name != 'decals':
                # A verified reference can use JPEG while the input snapshot is WebP.
                reference = resolve_map(args.normal_originals, relative.parent, 'normal', {})
            row = optimize_file(reference, args.output / relative, config)
            row['sourcePath'] = str(relative)
            row['path'] = str(Path(row['path']).relative_to(args.output))
            return row
        rows = list(pool.map(process, images))
    for source in paths:
        if source in images:
            continue
        target = args.output / source.relative_to(args.originals)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
    outputs = {row['sourcePath']: row['path'] for row in rows}
    # Remove only obsolete encodings of these same sources in reusable staging.
    # Originals are immutable; cleanup never runs in the public directory.
    current_outputs = set(outputs.values())
    for source in images:
        directory = args.output / source.parent.relative_to(args.originals)
        for stale in directory.glob(source.stem + '.*'):
            if stale.suffix.lower() in IMAGE_SUFFIXES and str(stale.relative_to(args.output)) not in current_outputs:
                stale.unlink()
    index_file = args.output / 'index.json'
    for key, definition in index.items():
        if key == 'decals':
            for decal in definition.values():
                for field in ('file', 'normal'):
                    if field in decal:
                        if decal[field] not in outputs:
                            raise ValueError(f'Missing decal {field}: {decal[field]}')
                        decal[field] = outputs[decal[field]]
            continue
        files = {}
        dimensions = {}
        for kind in definition['maps']:
            source = resolve_map(args.originals, key, kind, definition)
            output = Path(outputs[str(source.relative_to(args.originals))])
            files[kind] = str(output.relative_to(key))
            with Image.open(args.output / output) as image:
                dimensions[kind] = max(image.size)
        definition['size'] = max(dimensions.values())
        definition['sizes'] = dimensions
        definition['files'] = files
    index_file.write_text(json.dumps(index, indent=2, ensure_ascii=False) + '\n')
    report = {'config': config, 'pillow': Image.__version__, 'libwebp': features.version('webp'),
              'beforeBytes': sum(row['beforeBytes'] for row in rows),
              'afterBytes': sum(row['afterBytes'] for row in rows), 'images': rows}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'images'}))


if __name__ == '__main__':
    main()
