#!/usr/bin/env python3
"""Stellt Lupo vom Magenta-Hintergrund frei (nur randverbundene Flächen) und färbt das Lupenglas hellblau."""
from PIL import Image, ImageFilter
from collections import deque
import sys
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
w, h = im.size
px = im.load()
def is_bg(p):
    r, g, b, a = p
    return r > 170 and b > 170 and g < 120 and abs(r - b) < 90
seen = bytearray(w * h)
LINSE = (269, 322)  # Mittelpunkt des Lupenglases im Rohbild – dieses Feld bleibt erhalten
starts = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
# eingeschlossene Magenta-Flächen (z. B. zwischen Flügel und Kopf) ebenfalls entfernen
lens = set()
lq = deque([LINSE])
while lq:
    x, y = lq.popleft()
    if (x, y) in lens or not (0 <= x < w and 0 <= y < h) or not is_bg(px[x, y]): continue
    lens.add((x, y))
    lq.extend(((x+1,y),(x-1,y),(x,y+1),(x,y-1)))
starts += [(x, y) for y in range(0, h, 2) for x in range(0, w, 2) if is_bg(px[x, y]) and (x, y) not in lens]
q = deque(starts)
while q:
    x, y = q.popleft()
    i = y * w + x
    if seen[i]: continue
    seen[i] = 1
    if not is_bg(px[x, y]): continue
    px[x, y] = (0, 0, 0, 0)
    for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
        if 0 <= nx < w and 0 <= ny < h and not seen[ny*w+nx]: q.append((nx, ny))
# Restliches Magenta (Lupenglas, Kantensaum) umfärben
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a and r > 150 and b > 150 and g < r - 40:
            l = (r + g + b) / 3
            px[x, y] = (int(min(255, l * .80)), int(min(255, l * .93)), int(min(255, l * 1.05 + 20)), a)
# Saum: halbtransparente Kante
alpha = im.split()[3].filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
im.putalpha(alpha)
im = im.crop(im.getbbox())
im.thumbnail((640, 640), Image.LANCZOS)
im.save(dst, optimize=True)
print(im.size)
