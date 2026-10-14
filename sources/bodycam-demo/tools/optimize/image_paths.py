"""Image paths follow encoded bytes, including legacy immutable snapshots."""
from pathlib import Path

IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp'}


def image_format(data):
    if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'WEBP'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'PNG'
    if data.startswith(b'\xff\xd8\xff'):
        return 'JPEG'
    raise ValueError('Unsupported or truncated image header')


def encoded_path(path, format):
    path = Path(path)
    if format == 'WEBP':
        return path.with_suffix('.webp')
    if format == 'JPEG':
        return path if path.suffix.lower() in ('.jpg', '.jpeg') else path.with_suffix('.jpg')
    if format == 'PNG':
        return path if path.suffix.lower() == '.png' else path.with_suffix('.png')
    raise ValueError(f'Unsupported image format: {format}')


def resolve_map(root, texture_id, kind, definition):
    """Prefer manifest paths; old snapshots use exactly one matching stem."""
    directory = root / texture_id
    explicit = definition.get('files', {}).get(kind)
    if explicit is not None:
        relative = Path(explicit)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError(f'Unsafe texture map path: {texture_id}/{explicit}')
        path = directory / relative
        if not path.is_file():
            raise ValueError(f'Missing declared map: {path}')
        return path
    choices = sorted(path for path in directory.glob(kind + '.*') if path.suffix.lower() in IMAGE_SUFFIXES)
    if len(choices) != 1:
        raise ValueError(f'Expected one map for {texture_id}/{kind}, got {choices}')
    return choices[0]
