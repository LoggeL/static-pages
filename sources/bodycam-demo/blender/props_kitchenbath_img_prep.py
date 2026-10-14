# Verkleinert die Imagegen-Rohbilder (Scratch) zu JPGs für props_kitchenbath (python3 -I props_kitchenbath_img_prep.py)
import os, sys
from PIL import Image
SRC = '/Users/logge/Documents/Projects/bodycam-work/props_kitchenbath/ig'
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'props_kitchenbath_img')
os.makedirs(DST, exist_ok=True)
MAXS = {'fridge_note': 768, 'wh_label': 1024, 'stove_panel': 1536, 'washer_panel': 1536, 'dryer_panel': 1536,
        'microwave_panel': 768}
for k, m in MAXS.items():
    p = os.path.join(SRC, k + '.png')
    if not os.path.exists(p):
        print('fehlt', p); continue
    im = Image.open(p).convert('RGB')
    s = m / max(im.size)
    if s < 1:
        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
    im.save(os.path.join(DST, k + '.jpg'), quality=88)
    print(k, im.size)
