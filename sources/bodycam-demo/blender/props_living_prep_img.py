# Bereitet die Imagegen-Rohbilder fuer props_living.py auf (verkleinern, kachelbar machen) und erzeugt
# prozedurale Unikat-Texturen (Wasserraender). Aufruf: python3 -I props_living_prep_img.py <raw_dir>
# raw_dir enthaelt crt.png, painting.png, books.png, rug.png, curtain.png (Codex-Imagegen, Prompts daneben als .txt).
import os, sys, math
import numpy as np
from PIL import Image, ImageFilter

RAW = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'props_living_img')
os.makedirs(OUT, exist_ok=True)


def save_jpg(im, name, q=86):
    im.convert('RGB').save(os.path.join(OUT, name), quality=q, optimize=True, progressive=False)
    print(name, im.size)


def fit(im, w, h):
    return im.resize((w, h), Image.LANCZOS)


# Bildschirm: 4:3
im = Image.open(os.path.join(RAW, 'crt.png')).convert('RGB')
save_jpg(fit(im, 768, 576), 'crt_screen.jpg')
# Gemaelde 3:2
im = Image.open(os.path.join(RAW, 'painting.png')).convert('RGB')
save_jpg(fit(im, 900, 600), 'painting.jpg')
# Buchruecken-Atlas: 16 Ruecken nebeneinander
im = Image.open(os.path.join(RAW, 'books.png')).convert('RGB')
save_jpg(fit(im, 1024, 683), 'book_spines.jpg')
# Laeufer
im = Image.open(os.path.join(RAW, 'rug.png')).convert('RGB')
save_jpg(fit(im, 512, 1228), 'rug_runner.jpg', q=88)

# Vorhangstoff: quadratisch zuschneiden und per Kreuzblende nahtlos machen
im = Image.open(os.path.join(RAW, 'curtain.png')).convert('RGB')
s = min(im.size)
im = im.crop(((im.size[0] - s) // 2, (im.size[1] - s) // 2, (im.size[0] - s) // 2 + s, (im.size[1] - s) // 2 + s))
im = fit(im, 768, 768)
a = np.asarray(im).astype(np.float32)
n = a.shape[0]
b = np.roll(np.roll(a, n // 2, 0), n // 2, 1)
yy, xx = np.mgrid[0:n, 0:n] / (n - 1)
# Gewicht: 1 in der Mitte, 0 an den Raendern (fuer das Original)
w = np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy))
w = np.clip(w / 0.22, 0, 1)
w = w * w * (3 - 2 * w)
c = a * w[..., None] + b * (1 - w[..., None])
save_jpg(Image.fromarray(np.clip(c, 0, 255).astype(np.uint8)), 'curtain.jpg')

# Wasser-/Kaffeeraender fuer den Couchtisch (RGBA, 1024x560 ~ Tischplatte 1.10 x 0.60)
W, H = 1024, 560
rng = np.random.default_rng(7)
rgb = np.zeros((H, W, 3), np.float32)
alpha = np.zeros((H, W), np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def vnoise(scale, seed):
    """Weiches Rauschen 0..1 (gefiltertes Weissrauschen, normalisiert)."""
    r = np.random.default_rng(seed)
    g = r.random((H, W)).astype(np.float32)
    img = Image.fromarray((g * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(scale))
    a = np.asarray(img).astype(np.float32)
    a = (a - a.mean()) / (a.std() + 1e-6)
    return np.clip(0.5 + a * 0.22, 0, 1)


N1 = vnoise(18, 1)
N2 = vnoise(5, 2)
px_per_m = W / 1.10
rings = [  # (x m, y m, Radius m, Art, Staerke)  Art: w = weisser Wasserrand, c = Kaffeerand
    (0.22, 0.17, 0.040, 'w', 0.9), (0.27, 0.20, 0.041, 'w', 0.6), (0.80, 0.42, 0.043, 'c', 0.9),
    (0.86, 0.40, 0.036, 'c', 0.5), (0.55, 0.30, 0.050, 'w', 0.55), (0.95, 0.15, 0.040, 'w', 0.75),
    (0.40, 0.45, 0.034, 'c', 0.65), (0.15, 0.44, 0.045, 'w', 0.5), (0.66, 0.12, 0.038, 'c', 0.4),
]
for (x, y, r, kind, k) in rings:
    cx, cy, rr = x * px_per_m, y * px_per_m, r * px_per_m
    ang = np.arctan2(yy - cy, xx - cx)
    d = np.hypot(xx - cx, yy - cy)
    wob = 1 + 0.035 * np.sin(ang * 3 + x * 10) + 0.02 * np.sin(ang * 7 + y * 13)
    dd = d / (rr * wob)
    ring = np.exp(-((dd - 1.0) / 0.03) ** 2) * 0.9 + np.exp(-((dd - 0.97) / 0.09) ** 2) * 0.35
    # unvollstaendige Raender (Tasse leicht schraeg abgestellt)
    gap = 0.55 + 0.45 * np.cos(ang - (x * 17 % 6.28))
    inner = np.clip(1 - dd, 0, 1) ** 0.4 * 0.22 * (dd < 1)
    a = (ring * gap * (0.6 + 0.4 * N2) + inner * N1) * k
    if kind == 'w':
        col = np.array([0.80, 0.78, 0.72])
    else:
        col = np.array([0.16, 0.08, 0.03])
    rgb = rgb * (1 - a[..., None]) + col * a[..., None]
    alpha = 1 - (1 - alpha) * (1 - a)
# klebrige Flecken + Staub
for i in range(5):
    cx, cy = rng.uniform(80, W - 80), rng.uniform(60, H - 60)
    rr = rng.uniform(25, 70)
    d = np.hypot((xx - cx) / 1.4, yy - cy) / rr
    a = np.clip(1 - d + 0.35 * (N1 - 0.5), 0, 1) ** 1.5 * 0.45
    col = np.array([0.10, 0.06, 0.03])
    rgb = rgb * (1 - a[..., None]) + col * a[..., None]
    alpha = 1 - (1 - alpha) * (1 - a)
# Staubschicht (hell, ganzflaechig schwach, fleckig)
dust = np.clip((N1 * 0.7 + N2 * 0.3) - 0.45, 0, 1) * 0.42 + vnoise(1.2, 9) * 0.06
rgb = rgb * (1 - dust[..., None]) + np.array([0.55, 0.52, 0.46]) * dust[..., None]
alpha = 1 - (1 - alpha) * (1 - dust)
# Raender ausblenden
edge = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy))
alpha *= np.clip(edge / 12, 0, 1)
out = np.dstack([np.clip(rgb / np.maximum(alpha[..., None], 1e-3), 0, 1), alpha])
Image.fromarray((out * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'coffee_rings.png'), optimize=True)
print('coffee_rings.png', (W, H))
