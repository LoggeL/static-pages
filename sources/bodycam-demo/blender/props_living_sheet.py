# Setzt die Einzelrenderings (props_living_preview.py --sheet) zu einem beschrifteten Kontaktbogen zusammen.
#   python3 -I props_living_sheet.py <tmp_dir> <out.png> [cols]
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

tmp, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
cat = {c['name']: c for c in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'props_living.json')))}
paths = [p for p in open(os.path.join(tmp, 'sheet_list.txt')).read().split('\n') if p and os.path.exists(p)]
ims = [Image.open(p).convert('RGB') for p in paths]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h), (12, 12, 12))
try:
    font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 15)
except Exception:
    font = ImageFont.load_default()
for i, (p, im) in enumerate(zip(paths, ims)):
    name = os.path.basename(p)[6:-4]
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    d = ImageDraw.Draw(sheet)
    c = cat.get(name, {})
    txt = f"{name}  {c.get('tris', '?')} tris  {c.get('dims', '')}"
    d.rectangle((x, y, x + w, y + 22), fill=(0, 0, 0))
    d.text((x + 6, y + 3), txt, fill=(235, 235, 220), font=font)
sheet.save(out)
print('sheet', out, sheet.size)
