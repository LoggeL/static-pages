# Kontaktbogen mit Beschriftung (PIL): python3 -I props_kitchenbath_sheet.py out.png cols cell img1 name1 img2 name2 ...
import sys
from PIL import Image, ImageDraw
out, cols, cell = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
items = list(zip(sys.argv[4::2], sys.argv[5::2]))
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cell, rows * cell), (20, 20, 20))
dr = ImageDraw.Draw(sheet)
for i, (p, n) in enumerate(items):
    im = Image.open(p).convert('RGB').resize((cell, cell), Image.LANCZOS)
    x, y = (i % cols) * cell, (i // cols) * cell
    sheet.paste(im, (x, y))
    dr.rectangle((x, y, x + cell, y + 16), fill=(0, 0, 0))
    dr.text((x + 4, y + 2), n, fill=(255, 255, 120))
sheet.save(out)
