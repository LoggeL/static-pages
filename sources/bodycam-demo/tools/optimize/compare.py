#!/usr/bin/env python3
"""Visual comparison sheets. Pixel differences are diagnostic, not an acceptance threshold."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw
from image_paths import resolve_map

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=Path, default=Path('/Users/logge/Documents/Projects/bodycam-work/codex/C7'))
parser.add_argument('--after', default='after-final')
args = parser.parse_args()
out = args.work / 'comparisons'
out.mkdir(parents=True, exist_ok=True)
paths = [('wood_floor_worn', 'albedo'), ('plaster_damaged', 'albedo'), ('asphalt_wet', 'albedo'),
         ('wood_floor_worn', 'normal'), ('grass_dead', 'normal'), ('graffiti_2', 'decal'), ('mold_patch', 'decal')]
sheet = Image.new('RGB', (1040, len(paths) * 300), '#222222')
draw = ImageDraw.Draw(sheet)
for row, (texture_id, kind) in enumerate(paths):
    for column, root in enumerate((args.work / 'originals/textures', args.work / 'staging/textures')):
        index = json.loads((root / 'index.json').read_text())
        file = root / index['decals'][texture_id]['file'] if kind == 'decal' else resolve_map(root, texture_id, kind, index[texture_id])
        name = str(file.relative_to(root))
        with Image.open(file) as source:
            picture = source.convert('RGBA')
            picture.thumbnail((480, 268), Image.Resampling.LANCZOS)
            background = Image.new('RGBA', picture.size, '#888888')
            background.alpha_composite(picture)
            x, y = column * 520, row * 300
            sheet.paste(background.convert('RGB'), (x, y + 25))
            draw.text((x + 8, y + 5), ('Original ' if column == 0 else 'Final ') + name, fill='white')
sheet.save(out / 'textures-overview.jpg', quality=95)
before = args.work / 'browser/before'
after = args.work / 'browser' / args.after
for first in sorted(before.rglob('*.png')):
    second = after / first.relative_to(before)
    if not second.exists():
        continue
    with Image.open(first) as a, Image.open(second) as b:
        if a.size != b.size:
            raise ValueError(f'Incompatible comparison sizes: {first.name}')
        pair = Image.new('RGB', (a.width * 2, a.height + 28), '#222222')
        pair.paste(a.convert('RGB'), (0, 28))
        pair.paste(b.convert('RGB'), (a.width, 28))
        caption = ImageDraw.Draw(pair)
        caption.text((10, 7), 'Original: ' + first.name, fill='white')
        caption.text((a.width + 10, 7), 'Final: ' + second.name, fill='white')
        pair.save(out / (first.stem + '-pair.jpg'), quality=95)
print(out)
