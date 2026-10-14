#!/usr/bin/env python3
"""Immutable source snapshots and conflict-safe C14 asset installation."""
import argparse
import hashlib
import json
import os
import shutil
import struct
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse
from image_paths import IMAGE_SUFFIXES, encoded_path, image_format

EXCLUDED = {'audio', '_dev'}
PROTECTED_MODELS = {'models/house.glb', 'models/house_collision.glb'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest(root):
    return {str(p.relative_to(root)): sha(p) for p in sorted(root.rglob('*')) if p.is_file()}


def owned(relative):
    return relative.startswith(('models/', 'textures/')) and relative not in PROTECTED_MODELS


def total(root):
    return sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and p.relative_to(root).parts[0] not in EXCLUDED)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n')


def normal_files(root):
    paths = sorted(p for p in root.glob('*/normal.*') if p.suffix.lower() in IMAGE_SUFFIXES)
    identifiers = [p.parent.name for p in paths]
    if len(set(identifiers)) != len(identifiers):
        raise RuntimeError('Multiple normal reference encodings for one texture ID')
    return paths


def image_aliases(relative):
    path = Path(relative)
    return {str(path.with_suffix(suffix)) for suffix in IMAGE_SUFFIXES} | {relative}


def output_paths(originals, stage, source_manifest):
    """Allow only content-correct extension changes, never arbitrary new assets."""
    mapping = {}
    for relative in source_manifest:
        if not owned(relative):
            continue
        source = Path(relative)
        if relative.startswith('textures/') and source.suffix.lower() in IMAGE_SUFFIXES:
            choices = sorted(name for name in image_aliases(relative) if (stage / name).is_file())
            if len(choices) != 1:
                raise RuntimeError(f'Staged asset paths differ from originals: {relative}: {choices}')
            candidate = choices[0]
            if str(encoded_path(source, image_format((stage / candidate).read_bytes()))) != candidate:
                raise RuntimeError(f'Staged image extension disagrees with content: {candidate}')
            mapping[relative] = candidate
        else:
            mapping[relative] = relative
    if len(set(mapping.values())) != len(mapping):
        raise RuntimeError('Staged image paths collide')
    return mapping


def check_model_image_references(stage):
    # Protected house images can point to renamed external decals. Never publish
    # new filenames while silently leaving those bake-owned references dangling.
    for path in sorted((stage / 'models').rglob('*.glb')):
        data = path.read_bytes()
        if len(data) < 20 or data[:4] != b'glTF':
            raise RuntimeError(f'Invalid staged GLB: {path}')
        size, kind = struct.unpack_from('<II', data, 12)
        if kind != 0x4E4F534A or 20 + size > len(data):
            raise RuntimeError(f'Invalid staged GLB JSON: {path}')
        document = json.loads(data[20:20 + size])
        for image in document.get('images', []):
            uri = image.get('uri')
            if not uri or uri.startswith('data:') or urlparse(uri).scheme:
                continue
            target = (path.parent / unquote(urlparse(uri).path)).resolve()
            if not target.is_relative_to(stage.resolve()) or not target.is_file():
                raise RuntimeError(f'Staged model image reference missing: {path.name}: {uri}; migrate/reexport the protected bake first')


def snapshot(args):
    original = args.work / 'originals'
    marker = args.work / 'input-manifest.json'
    if marker.exists():
        expected = json.loads(marker.read_text())['files']
        if manifest(original) != expected:
            raise RuntimeError('Original backup changed; use a new work directory for a new input revision')
    else:
        if original.exists() and any(original.iterdir()):
            raise RuntimeError('Unverified existing originals; refusing to adopt already optimized input')
        original.mkdir(parents=True, exist_ok=True)
        for name in ('models', 'textures', 'lightmaps', 'data'):
            shutil.copytree(args.public / name, original / name)
        inputs = manifest(original)
        if any(sha(args.public / name) != value for name, value in inputs.items()):
            raise RuntimeError('Inputs changed during snapshot')
        write_json(marker, {'files': inputs})
    reference = getattr(args, 'reference_textures', None)
    ref_root, ref_marker = args.work / 'normal-originals', args.work / 'normal-manifest.json'
    if ref_marker.exists():
        expected = json.loads(ref_marker.read_text())['files']
        if manifest(ref_root) != expected:
            raise RuntimeError('Normal reference backup changed')
        if reference and {str(p.relative_to(reference)): sha(p) for p in normal_files(reference)} != expected:
            raise RuntimeError('Normal reference source changed; use a fresh work directory')
    elif reference:
        paths = normal_files(reference)
        expected_ids = {p.parent.name for p in normal_files(original / 'textures')}
        if {p.parent.name for p in paths} != expected_ids:
            raise RuntimeError('Normal reference set differs from public texture IDs')
        for source in paths:
            target = ref_root / source.relative_to(reference)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        write_json(ref_marker, {'source': str(reference), 'files': manifest(ref_root)})


def protected_readback(args, stage):
    # Assembly belongs to the bake pipeline. Include the latest completed output
    # in the candidate/inventory, without writing it back over a concurrent bake.
    files = {}
    for name in ('data', 'lightmaps'):
        for source in sorted((args.public / name).rglob('*')):
            if source.is_file():
                relative = str(source.relative_to(args.public))
                target = stage / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                if sha(source) != sha(target):
                    raise RuntimeError(f'Protected asset changed while copying: {relative}')
                files[relative] = {'bytes': source.stat().st_size, 'sha256': sha(source)}
    for relative in sorted(PROTECTED_MODELS):
        source = args.public / relative
        if source.is_file():
            (stage / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, stage / relative)
            if sha(source) != sha(stage / relative):
                raise RuntimeError(f'Assembly changed while copying: {relative}')
            files[relative] = {'bytes': source.stat().st_size, 'sha256': sha(source)}
    return files


def finish(args):
    originals = args.work / 'originals'
    snapshot(args)
    stage = args.work / 'staging'
    for p in (originals / 'models').rglob('*'):
        if p.is_file() and p.suffix.lower() != '.glb':
            target = stage / p.relative_to(originals)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
    preserved = protected_readback(args, stage)
    source_manifest = json.loads((args.work / 'input-manifest.json').read_text())['files']
    prior_file = args.work / 'installed-manifest.json'
    previous = json.loads(prior_file.read_text())['files'] if prior_file.exists() else {}
    files = {p: h for p, h in manifest(stage).items() if owned(p)}
    mapping = output_paths(originals, stage, source_manifest)
    if set(files) != set(mapping.values()):
        raise RuntimeError('Staged asset paths differ from originals')
    current_paths = {str(p.relative_to(args.public)) for name in ('models', 'textures')
                     for p in (args.public / name).rglob('*') if p.is_file() and owned(str(p.relative_to(args.public)))}
    checked = {}
    recognized = set()
    for source, output in mapping.items():
        aliases = image_aliases(source) if source.startswith('textures/') and Path(source).suffix.lower() in IMAGE_SUFFIXES else {source}
        existing = aliases & current_paths
        if not existing:
            raise RuntimeError(f'Missing current input {source}')
        allowed = {source_manifest[source], files[output]} | {previous[p] for p in aliases if p in previous}
        for relative in existing:
            actual = sha(args.public / relative)
            if actual not in allowed:
                raise RuntimeError(f'Concurrent/unrecognized asset modification: {relative}')
            checked[relative] = actual
        recognized.update(existing)
    if current_paths != recognized:
        raise RuntimeError('New or removed public assets detected; create a fresh original snapshot')
    check_model_image_references(stage)
    removed = sorted(current_paths - set(files))
    fixed = total(args.public) - sum((args.public / p).stat().st_size for p in current_paths)
    size = fixed + sum((stage / p).stat().st_size for p in files)
    budget = json.loads(args.config.read_text())['budgetBytes']
    level_file = args.public / 'data/level.json'
    level = json.loads(level_file.read_text()) if level_file.exists() else {}
    shared = level.get('bake', {}).get('compression', {}).get('sharedImageBuffers', [])
    stale = [item['uri'] for item in shared if files.get('models/' + item['uri'], sha(args.public / 'models' / item['uri'])) != item['sha256']]
    report = {'budgetBytes': budget, 'candidateBytes': size, 'budgetPassed': size <= budget,
              'compatibleBytes': size, 'compatibleBudgetPassed': size <= budget,
              'meshoptDecoderRequired': True, 'excludedRoots': sorted(EXCLUDED),
              'preservedAssemblyAndLightmaps': preserved, 'requiresHouseReexport': bool(stale),
              'staleSharedImageBuffers': stale, 'renamedTextures': {p: q for p, q in mapping.items() if p != q},
              'removedLegacyPaths': removed, 'applied': False}
    write_json(args.work / 'reports/budget.json', report)
    if args.stage_only:
        print(json.dumps({k: v for k, v in report.items() if k != 'preservedAssemblyAndLightmaps'})); return
    if size > budget and not args.allow_over_budget:
        raise RuntimeError(f'Candidate needs {size} bytes, budget {budget}. Staged only. Use --allow-over-budget only with the remaining budget boundary documented.')
    # New image paths exist before the index changes. Each file replacement is
    # atomic, not the whole set. Known intermediate old/new pairs are retryable.
    order = sorted(files, key=lambda relative: (relative == 'textures/index.json', relative))
    for relative in order:
        value = files[relative]
        target = args.public / relative
        expected = checked.get(relative)
        if (sha(target) if target.exists() else None) != expected:
            raise RuntimeError(f'Input changed since preflight: {relative}')
        if expected == value:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(prefix='.c21-', dir=target.parent)
        try:
            with os.fdopen(handle, 'wb') as stream:
                stream.write((stage / relative).read_bytes())
            if (sha(target) if target.exists() else None) != expected:
                raise RuntimeError(f'Input changed during installation: {relative}')
            os.chmod(temporary, 0o644)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    for relative in removed:
        target = args.public / relative
        if not target.is_file() or sha(target) != checked[relative]:
            raise RuntimeError(f'Legacy input changed during installation: {relative}')
        target.unlink()
    if any(sha(args.public / p) != h for p, h in files.items()):
        raise RuntimeError('Installed readback mismatch')
    for relative, expected in preserved.items():
        if sha(args.public / relative) != expected['sha256']:
            raise RuntimeError(f'Protected assembly/lightmap changed during installation: {relative}')
    write_json(prior_file, {'files': files})
    report.update(applied=True, readbackBytes=total(args.public))
    write_json(args.work / 'reports/budget.json', report)
    print(json.dumps({k: v for k, v in report.items() if k != 'preservedAssemblyAndLightmaps'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('snapshot', 'finish'))
    parser.add_argument('--public', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--reference-textures', type=Path)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('config.json'))
    parser.add_argument('--stage-only', action='store_true')
    parser.add_argument('--allow-over-budget', action='store_true')
    args = parser.parse_args()
    args.public, args.work = args.public.resolve(), args.work.resolve()
    if args.reference_textures:
        args.reference_textures = args.reference_textures.resolve()
    repo = Path(__file__).resolve().parents[4]
    if args.work.is_relative_to(repo) or args.public.is_relative_to(args.work):
        parser.error('Work must be outside the repository and public directory')
    args.work.mkdir(parents=True, exist_ok=True)
    (snapshot if args.action == 'snapshot' else finish)(args)


if __name__ == '__main__':
    main()
