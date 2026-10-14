#!/usr/bin/env python3
"""Kontaktbogen fuer Previews: sheet.py <out.jpg> <cell px> <cols> img... (Beschriftung per PIL)."""
import sys, os
from PIL import Image, ImageDraw
out, cell, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
rows = (len(files) + cols - 1) // cols
sh = Image.new('RGB', (cols * cell, rows * (cell + 18)), (20, 20, 20))
d = ImageDraw.Draw(sh)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB')
    im.thumbnail((cell, cell), Image.LANCZOS)
    x, y = (i % cols) * cell, (i // cols) * (cell + 18)
    sh.paste(im, (x, y + 18))
    d.text((x + 4, y + 3), os.path.basename(f), fill=(255, 255, 0))
sh.save(out, quality=88)
