#!/usr/bin/env python3
"""
Unique (non-library) textures for the Kindenheim hero vehicle. Run with the system Python (NumPy + Pillow):

    python3 blender/tractor/generate_tractor_textures.py

Writes PNG sources into blender/tractor/textures/ (the glTF exporter re-encodes them as WebP):
  vehicle_atlas.png (+ vehicle_atlas.json)  2048 RGBA  instrument cluster, terminal, panels, plates, signs,
                                                        wordmarks, reflectors, vine leaves
  grapes_albedo / grapes_normal (2048), grapes_orm (1024)   packed wine-grape berries, 1 tile = 1.0 m
  tyre_normal (2048 x 1024)        sidewall lettering / ribs + tread base, U = circumference, V = across profile
  grain_normal (512)               fine cast / plastic grain
  floor_mat_normal (512)           ribbed rubber cab mat
  mesh_albedo / mesh_normal (256)  perforated sheet (grille backing, heat shield, step treads)
  lens_normal (256)                prismatic lamp lens / retro-reflector

Everything is a fictional make ("PALATIN"); no real manufacturer names or logos.
"""

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / "textures"
FONT_DIR = Path("/System/Library/Fonts/Supplemental")


def font(name: str, px: int):
    p = FONT_DIR / name
    if not p.exists():
        raise FileNotFoundError(f"Font missing: {p}")
    return ImageFont.truetype(str(p), px)


def tile_noise(size, grid, seed):
    rng = np.random.default_rng(seed)
    base = rng.random((grid, grid), dtype=np.float32)
    c = np.linspace(0, grid, size, endpoint=False, dtype=np.float32)
    i0 = np.floor(c).astype(np.int32) % grid
    f = c - np.floor(c)
    u = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % grid
    ux, uy = u[None, :], u[:, None]
    return ((base[np.ix_(i0, i0)] * (1 - ux) + base[np.ix_(i0, i1)] * ux) * (1 - uy)
            + (base[np.ix_(i1, i0)] * (1 - ux) + base[np.ix_(i1, i1)] * ux) * uy)


def fbm(size, grids, seed):
    acc = np.zeros((size, size), np.float32)
    w, ws = 1.0, 0.0
    for k, g in enumerate(grids):
        acc += w * tile_noise(size, g, seed + 101 * k)
        ws += w
        w *= 0.5
    return acc / ws


def normal_from_height(h, px_x, px_y=None, max_slope=3.0):
    """h in metres, px_* = metres per pixel. Image row 0 is the TOP (v = 1); OpenGL (+Y up) convention."""
    px_y = px_x if px_y is None else px_y
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px_x)
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) / (2 * px_y)     # +v is image-up
    dx = np.clip(dx, -max_slope, max_slope)
    dy = np.clip(dy, -max_slope, max_slope)
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (np.clip(n * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)


def blur(a, sigma):
    """Wrap-around gaussian blur via FFT."""
    n0, n1 = a.shape
    fy = np.fft.fftfreq(n0)[:, None]
    fx = np.fft.fftfreq(n1)[None, :]
    g = np.exp(-2 * (math.pi ** 2) * (sigma ** 2) * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)


def save(name, arr, mode=None):
    """
    Writes <name>.webp (the name is given with a .png suffix for readability). The Blender build embeds these
    files unchanged (glTF export with image format AUTO), so the vehicle's own maps ship as WebP while the
    shared-library JPEGs stay byte-identical to blender/shared_textures/.
    """
    OUT.mkdir(parents=True, exist_ok=True)
    img = arr if isinstance(arr, Image.Image) else Image.fromarray(arr, mode)
    out = OUT / (Path(name).stem + ".webp")
    img.save(out, "WEBP", quality=90, method=6)
    print(f"  wrote {out.name}  {img.size[0]}x{img.size[1]}  {out.stat().st_size / 1024:.0f} KB")


# ---------------------------------------------------------------------------
# 1. Grapes
# ---------------------------------------------------------------------------

def gen_grapes(size=2048, tile_m=1.0, seed=7):
    rng = np.random.default_rng(seed)
    px = tile_m / size
    height = np.full((size, size), -0.060, np.float32)
    ident = np.full((size, size), -1, np.int32)
    berries = []
    r_mean = 0.0105
    layers = [(-0.030, 1.15), (-0.016, 1.05), (-0.004, 0.80)]     # (depth offset, density factor)
    for depth, dens in layers:
        pitch = 2 * r_mean * 0.98
        n_side = int(tile_m / pitch)
        n_rows = int(round(tile_m / (pitch * 0.90)))        # rows are packed tighter: cover the whole tile
        for iy in range(n_rows):
            for ix in range(n_side):
                if rng.random() > dens * 0.82:
                    continue
                cx = (ix + 0.5 * (iy % 2) + rng.normal(0, 0.28)) * pitch
                cy = (iy + rng.normal(0, 0.28)) * tile_m / n_rows
                r = r_mean * rng.uniform(0.80, 1.18)
                berries.append((cx % tile_m, cy % tile_m, r, depth + rng.normal(0, 0.004)))
    order = rng.permutation(len(berries))
    berries = [berries[i] for i in order]
    for bid, (cx, cy, r, z0) in enumerate(berries):
        rp = int(math.ceil(r / px)) + 1
        pcx, pcy = cx / px, cy / px
        xs = np.arange(int(pcx) - rp, int(pcx) + rp + 1)
        ys = np.arange(int(pcy) - rp, int(pcy) + rp + 1)
        dx = (xs - pcx) * px
        dy = (ys - pcy) * px
        d2 = dx[None, :] ** 2 + dy[:, None] ** 2
        inside = d2 < r * r
        z = z0 + np.sqrt(np.maximum(r * r - d2, 0.0)) * 0.92
        ix = np.ix_(ys % size, xs % size)
        cur = height[ix]
        win = inside & (z > cur)
        cur[win] = z[win]
        height[ix] = cur
        idc = ident[ix]
        idc[win] = bid
        ident[ix] = idc

    nb = len(berries)
    # per-berry look: cluster-level tint (low frequency) + individual variation
    cl = fbm(size, (5, 9), seed + 1)
    cl2 = fbm(size, (4, 7), seed + 2)
    bx = np.array([int(b[0] / px) % size for b in berries])
    by = np.array([int(b[1] / px) % size for b in berries])
    c_tint = cl[by, bx]
    c_bloom = cl2[by, bx]
    skins = (np.array([(36, 22, 54), (50, 24, 60), (28, 24, 68), (68, 24, 50)], np.float32) / 255.0) ** 2.2    # sRGB -> linear
    col = np.zeros((nb, 3), np.float32)
    bloom = np.zeros(nb, np.float32)
    for i in range(nb):
        t = c_tint[i] + rng.normal(0, 0.10)
        k = 0 if t < 0.42 else (1 if t < 0.55 else (2 if t < 0.70 else 3))
        c = skins[k] * rng.uniform(0.75, 1.25)
        u = rng.random()
        if u < 0.012:
            c = np.array((0.16, 0.22, 0.04)) * rng.uniform(0.8, 1.1)       # unripe green berry
        elif u < 0.035:
            c = np.array((0.22, 0.04, 0.07)) * rng.uniform(0.8, 1.1)       # half-ripe red berry
        col[i] = c
        bloom[i] = np.clip(0.20 + 0.75 * c_bloom[i] + rng.normal(0, 0.16), 0.02, 0.92)

    valid = ident >= 0
    idx = np.where(valid, ident, 0)
    skin = col[idx]
    bl = bloom[idx]
    # bloom (waxy haze) is strongest on the exposed tops of the berries, rubbed off in streaks
    rub = fbm(size, (24, 48, 96), seed + 3)
    hmax = blur(height, 10.0)
    top = np.clip((height - hmax) / 0.008 + 0.55, 0.0, 1.0)
    bl_px = np.clip(bl * (0.22 + 0.70 * top) * (0.30 + 0.95 * rub), 0.0, 0.50)
    bloom_col = np.array((0.105, 0.125, 0.24), np.float32)
    alb = skin * (1 - bl_px[..., None]) + bloom_col * bl_px[..., None]
    # cavity darkening between berries (real holes) -- modest, the rest is left to lighting + AO map
    cav = np.clip((height - blur(height, 16.0)) / 0.016 + 0.80, 0.0, 1.0)
    cav = np.where(valid, cav, 0.0)
    alb *= (0.30 + 0.70 * cav)[..., None]
    alb = np.where(valid[..., None], alb, np.array((0.010, 0.005, 0.012), np.float32))

    # stems / rachis bits lying between the berries
    stem_img = Image.new("L", (size, size), 0)
    dr = ImageDraw.Draw(stem_img)
    for _ in range(46):
        x, y = rng.uniform(0, size, 2)
        a = rng.uniform(0, 2 * math.pi)
        pts = [(x, y)]
        for _k in range(rng.integers(2, 5)):
            a += rng.normal(0, 0.6)
            ln = rng.uniform(18, 46)
            x, y = x + math.cos(a) * ln, y + math.sin(a) * ln
            pts.append((x, y))
        for ox in (-size, 0, size):
            for oy in (-size, 0, size):
                dr.line([(p[0] + ox, p[1] + oy) for p in pts], fill=255, width=int(rng.integers(4, 7)))
    stem = np.asarray(stem_img.filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255.0
    stem = stem * (np.clip((0.004 - (height - hmax)) / 0.008, 0.0, 1.0) * 0.9 + 0.1)      # mostly visible in the gaps
    stem_col = np.array((0.16, 0.15, 0.04), np.float32) * (0.7 + 0.6 * rub[..., None])
    alb = alb * (1 - stem[..., None]) + stem_col * stem[..., None]
    height = height + stem * 0.003

    rough = np.clip(0.18 + 0.75 * bl_px + 0.25 * stem, 0.14, 0.92)
    rough = np.where(valid, rough, 0.9)
    ao = np.clip(0.25 + 0.75 * cav, 0.0, 1.0)

    srgb = np.clip(alb, 0, 1) ** (1 / 2.2)
    save("grapes_albedo.png", (srgb * 255 + 0.5).astype(np.uint8), "RGB")
    save("grapes_normal.png", normal_from_height(height, px, max_slope=2.2), "RGB")
    orm = np.stack([ao, rough, np.zeros_like(ao)], -1)
    orm_img = Image.fromarray((orm * 255 + 0.5).astype(np.uint8), "RGB").resize((size // 2, size // 2), Image.Resampling.LANCZOS)
    save("grapes_orm.png", orm_img)


# ---------------------------------------------------------------------------
# 2. Tyre normal map
# ---------------------------------------------------------------------------

TYRE_VARIANTS = (          # band 0 (bottom of the image, v 0..1/3) = rear, 1 = front, 2 = trailer
    ("TERRAGRIP", "520/85 R 38", "RADIAL  TUBELESS", "155 A8 / 152 B"),
    ("TERRAGRIP", "420/85 R 24", "RADIAL  TUBELESS", "137 A8 / 134 B"),
    ("FLOTAMAX", "400/60 - 15.5", "IMPLEMENT  14 PR", "145 A8  TL"),
)


def _tyre_band(variant, w=2048, h=1024):
    brand, size, line1, line2 = variant
    hm = np.zeros((h, w), np.float32)                        # metres
    v = (np.arange(h, dtype=np.float32)[::-1] + 0.5) / h     # row 0 = v 1
    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    V = np.repeat(v[:, None], w, 1)
    U = np.repeat(u[None, :], h, 0)

    def band(vv, lo, hi, soft=0.004):
        return np.clip((vv - lo) / soft, 0, 1) * np.clip((hi - vv) / soft, 0, 1)

    f_big = font("Arial Black.ttf", 62)
    f_med = font("Arial Bold.ttf", 44)
    f_small = font("Arial Narrow Bold.ttf", 30)

    def side_text(img_draw, y_mid):
        img_draw.text((90, y_mid), brand, font=f_big, fill=255, anchor="lm")
        img_draw.text((700, y_mid), size, font=f_med, fill=255, anchor="lm")
        img_draw.text((1150, y_mid - 16), line1, font=f_small, fill=200, anchor="lm")
        img_draw.text((1150, y_mid + 18), line2, font=f_small, fill=200, anchor="lm")
        for k in range(3):
            x0 = 1560 + k * 110
            img_draw.polygon([(x0, y_mid - 22), (x0 + 70, y_mid), (x0, y_mid + 22), (x0 + 18, y_mid)], fill=230)
        img_draw.ellipse([1930, y_mid - 28, 1986, y_mid + 28], outline=255, width=6)

    y_low = int((1 - 0.135) * h)
    txt = Image.new("L", (w, h), 0)
    side_text(ImageDraw.Draw(txt), y_low)
    rot = Image.new("L", (w, h), 0)
    side_text(ImageDraw.Draw(rot), y_low)
    rot = rot.rotate(180)
    txt = Image.fromarray(np.maximum(np.asarray(txt), np.asarray(rot)))
    txt = txt.transpose(Image.Transpose.FLIP_LEFT_RIGHT)      # the carcass UVs run against the reading direction
    t = np.asarray(txt.filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255.0
    hm += t * 0.0045

    for sgn in (0, 1):
        vv = V if sgn == 0 else 1.0 - V
        for c in (0.035, 0.050):
            hm += np.exp(-((vv - c) / 0.0035) ** 2) * 0.0020
        hm += band(vv, 0.06, 0.20) * (0.5 + 0.5 * np.sin(vv * 2 * math.pi * 260)) * 0.00025
        bars = (np.sin(U * 2 * math.pi * 96) > 0.25).astype(np.float32)
        hm += band(vv, 0.205, 0.262, 0.006) * bars * 0.0026
        hm += np.exp(-((vv - 0.20) / 0.004) ** 2) * 0.0016
        # weathering cracks / scuffs in the sidewall rubber
        hm -= band(vv, 0.05, 0.25, 0.01) * np.clip(fbm(w, (64, 128, 256), 77 + sgn)[:h, :] - 0.62, 0, 1) * 0.004
    hm += band(V, 0.30, 0.70, 0.02) * (0.5 + 0.5 * np.sin(V * 2 * math.pi * 90)) * 0.0005
    g = fbm(w, (128, 256, 512), 31)[:h, :]
    hm += (g - 0.5) * 0.0007
    # halve the radial resolution (texture memory): 2048 x 512 per size band
    hm = np.asarray(Image.fromarray(hm).resize((w, h // 2), Image.Resampling.LANCZOS), np.float32)
    return normal_from_height(hm, 1.36 / w, 1.30 / (h // 2), max_slope=1.6)


def gen_tyre():
    bands = [_tyre_band(v) for v in TYRE_VARIANTS]
    save("tyre_normal.png", np.concatenate(list(reversed(bands)), axis=0), "RGB")     # band 0 at the bottom (v = 0)


def gen_exhaust(w=128, h=512):
    """Exhaust stack: v = 0 at the silencer inlet, v = 1 at the tip (soot). Heat tint + rust speckle."""
    rng_n = fbm(512, (16, 64, 128), 91)[:h, :w]
    fine = fbm(512, (128, 256), 92)[:h, :w]
    v = (1.0 - (np.arange(h, dtype=np.float32) + 0.5) / h)[:, None] * np.ones((1, w), np.float32)
    steel = np.array((0.16, 0.145, 0.13), np.float32)
    blue = np.array((0.10, 0.12, 0.19), np.float32)
    straw = np.array((0.30, 0.20, 0.09), np.float32)
    rust = np.array((0.22, 0.09, 0.035), np.float32)
    soot = np.array((0.012, 0.012, 0.012), np.float32)
    col = steel[None, None, :] * (0.8 + 0.4 * rng_n[..., None])
    heat = np.exp(-((v - 0.10) / 0.10) ** 2)
    col = col * (1 - 0.7 * heat[..., None]) + blue * 0.7 * heat[..., None]
    heat2 = np.exp(-((v - 0.24) / 0.07) ** 2)
    col = col * (1 - 0.5 * heat2[..., None]) + straw * 0.5 * heat2[..., None]
    r = np.clip((rng_n - 0.50) * 4.0, 0, 1) * np.clip(1.2 - v * 1.3, 0.15, 1)
    col = col * (1 - 0.75 * r[..., None]) + rust * 0.75 * r[..., None]
    s_ = np.clip((v - 0.72) / 0.2, 0, 1) ** 1.3
    col = col * (1 - s_[..., None]) + soot * s_[..., None]
    rough = np.clip(0.42 + 0.35 * r + 0.5 * s_ + 0.1 * fine, 0, 1)
    metal = np.clip(0.9 - 0.8 * r - 0.9 * s_, 0, 1)
    save("exhaust_albedo.png", (np.clip(col, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8), "RGB")
    save("exhaust_orm.png", (np.stack([np.ones_like(rough), rough, metal], -1) * 255).astype(np.uint8), "RGB")


def gen_glass(size=1024):
    """
    RGBA glass map: rgb = tint mixed with dust, alpha = opacity seen from outside (the runtime shader makes the
    inside view much clearer). Left half = windscreen with the wiper-swept arc, right half = side / rear panes.
    """
    hw = size // 2
    yy, xx = np.mgrid[0:size, 0:hw].astype(np.float32)
    u = (xx + 0.5) / hw
    v = 1.0 - (yy + 0.5) / size
    n = fbm(1024, (6, 12, 48), 51)[:size, :hw]
    fine = fbm(1024, (96, 192), 52)[:size, :hw]
    edge = np.minimum(np.minimum(u, 1 - u) * 1.0, np.minimum(v, 1 - v) * 1.4)
    base = 0.07 + 0.36 * np.clip(1 - edge / 0.14, 0, 1) ** 1.6 + 0.20 * np.clip(1 - v / 0.40, 0, 1) ** 1.3 + 0.16 * (n - 0.5)
    spl = np.clip((fbm(1024, (40, 80), 53)[:size, :hw] - 0.68) * 7, 0, 1) * np.clip(1.1 - v * 1.6, 0, 1)   # mud specks low down
    side = np.clip(base + 0.5 * spl + 0.10 * (fine - 0.5), 0, 1)
    # windscreen: wiper pivot bottom centre, blade sweeps a 150 degree sector
    px, py = 0.5, -0.08
    ang = np.degrees(np.arctan2(u - px, (v - py) * 1.15))
    rad = np.hypot((u - px) * 1.0, (v - py) * 1.15) / 1.15
    # The blade edge wanders a little (worn rubber, uneven pressure) and the swept area fades into the dust over
    # a few centimetres. A crisp arc with a dense dirt ridge read as a grey scratch across the sky from the seat.
    wob = 0.018 * (n - 0.5)
    in_arc = (np.clip((72 - np.abs(ang)) / 8.0, 0, 1) * np.clip((rad - 0.20) / 0.05, 0, 1)
              * np.clip((0.88 + wob - rad) / 0.07, 0, 1))
    rim = (np.exp(-((rad - 0.90 - wob) / 0.035) ** 2) * np.clip((74 - np.abs(ang)) / 8.0, 0, 1)
           * 0.10 * (0.6 + 0.8 * fine))                                                              # faint dirt pushed to the arc edge
    streak = (0.5 + 0.5 * np.sin(rad * 420.0)) * 0.03
    ws = np.clip(base * (1 - in_arc) + in_arc * (0.035 + streak + 0.04 * (n - 0.5)) + rim, 0, 1)
    dust = np.concatenate([ws, side], axis=1)
    tint = np.array((46, 62, 60), np.float32)
    dcol = np.array((150, 137, 112), np.float32)
    rgb = tint[None, None, :] * (1 - dust[..., None]) + dcol[None, None, :] * dust[..., None]
    alpha = 0.26 + 0.42 * dust
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    save("glass_dirt.png", Image.fromarray(out, "RGBA"))


# ---------------------------------------------------------------------------
# 3. Small tiling detail maps
# ---------------------------------------------------------------------------

def gen_details():
    s = 512
    g = fbm(s, (64, 128, 256), 5)
    save("grain_normal.png", normal_from_height((g - 0.5) * 0.0010, 0.25 / s, max_slope=1.0), "RGB")

    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32) / s
    ribs = np.clip(np.sin(xx * 2 * math.pi * 12) * 1.6 + 0.3, 0, 1)
    studs = np.clip(np.cos(xx * 2 * math.pi * 12) * np.cos(yy * 2 * math.pi * 6) * 2.0 - 1.1, 0, 1)
    hm = ribs * 0.0030 + studs * 0.002 + (fbm(s, (128, 256), 9) - 0.5) * 0.0005
    save("floor_mat_normal.png", normal_from_height(hm, 0.30 / s, max_slope=1.8), "RGB")

    s = 256
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32) / s
    holes = np.zeros((s, s), np.float32)
    n = 8
    for iy in range(n * 2):
        for ix in range(n):
            cx = (ix + 0.5 + 0.5 * (iy % 2)) / n
            cy = (iy + 0.5) / (n * 2)
            for ox in (-1, 0, 1):
                d = np.hypot(xx - cx - ox, (yy - cy))
                holes = np.maximum(holes, np.clip((0.036 - d) / 0.006, 0, 1))
    alb = np.stack([0.20 - 0.17 * holes] * 3, -1)
    save("mesh_albedo.png", (np.clip(alb, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8), "RGB")
    save("mesh_normal.png", normal_from_height(-holes * 0.0016, 0.08 / s, max_slope=1.6), "RGB")

    # aluminium chequer plate (five-bar style lozenges)
    ck = np.zeros((s, s), np.float32)
    for (cx, cy, ang) in [(0.25, 0.25, 45), (0.75, 0.25, -45), (0.25, 0.75, -45), (0.75, 0.75, 45)]:
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                dx_, dy_ = xx - cx - ox, yy - cy - oy
                ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                a_ = dx_ * ca + dy_ * sa
                b_ = -dx_ * sa + dy_ * ca
                ck = np.maximum(ck, np.clip(1 - (a_ / 0.17) ** 2 - (b_ / 0.045) ** 2, 0, 1) ** 0.5)
    save("checker_normal.png", normal_from_height(ck * 0.0022, 0.07 / s, max_slope=1.5), "RGB")
    peel = fbm(256, (24, 48), 61)
    save("orange_peel_normal.png", normal_from_height((peel - 0.5) * 0.00006, 0.04 / 256, max_slope=0.3), "RGB")

    n = 12
    fx = (xx * n) % 1.0
    fy = (yy * n) % 1.0
    pyr = 1.0 - np.maximum(np.abs(fx - 0.5), np.abs(fy - 0.5)) * 2.0
    save("lens_normal.png", normal_from_height(pyr * 0.0016, 0.06 / s, max_slope=1.4), "RGB")


# ---------------------------------------------------------------------------
# 4. Decal / display atlas
# ---------------------------------------------------------------------------

ATLAS = 2048
REGIONS = {
    "cluster":       (0, 0, 1024, 448),
    "terminal":      (1024, 0, 640, 448),
    "console":       (1664, 0, 384, 448),
    "plate_tractor": (0, 448, 832, 176),
    "plate_trailer": (832, 448, 832, 176),
    "sign25":        (1664, 448, 192, 192),
    "emblem":        (1856, 448, 192, 192),
    "chevron":       (0, 640, 384, 384),
    "wordmark":      (384, 640, 1024, 192),
    "badge":         (1408, 640, 448, 192),
    "sign40":        (1856, 640, 192, 192),
    "wordmark_dark": (384, 832, 1024, 192),
    "typeplate":     (1408, 832, 320, 192),
    "warnsticker":   (1728, 832, 320, 192),
    "leaf1":         (0, 1024, 320, 320),
    "leaf2":         (320, 1024, 320, 320),
    "leaf3":         (640, 1024, 320, 320),
    "refl_red":      (960, 1024, 128, 128),
    "refl_amber":    (1088, 1024, 128, 128),
    "refl_white":    (1216, 1024, 128, 128),
    "tape_redwhite": (1344, 1024, 704, 64),
    "tape_yellow":   (1344, 1088, 704, 64),
    "diesel":        (960, 1152, 256, 128),
    "hydr_dots":     (1216, 1152, 256, 128),
    "headliner":     (0, 1344, 896, 224),
    "switches":      (896, 1344, 640, 224),
    "screen_small":  (1536, 1344, 512, 224),
    "trailer_mark":  (0, 1568, 1024, 176),
    "label_pto":     (1024, 1568, 256, 176),
    "label_tyre":    (1280, 1568, 256, 176),
    "label_hot":     (1536, 1568, 256, 176),
    "firstaid":      (1792, 1568, 256, 176),
    "juice1":        (0, 1744, 512, 304),
    "juice2":        (512, 1744, 512, 304),
    "juice3":        (1024, 1744, 512, 304),
    "label_service": (1536, 1744, 512, 304),
}
# flat colour swatches (small coloured parts sample one texel block instead of needing their own material)
PALETTE = {
    "red": (206, 34, 28), "blue": (40, 96, 214), "yellow": (240, 196, 24), "green": (46, 160, 70),
    "orange": (236, 120, 20), "white": (236, 236, 230), "black": (22, 22, 24), "grey": (120, 124, 128),
    "amber": (246, 150, 14), "paint": (20, 92, 46), "brass": (176, 140, 60), "darkred": (120, 20, 18),
    "workblue": (38, 62, 110), "skin": (196, 148, 118), "cap": (30, 96, 52), "boot": (52, 38, 28),
    "shirt": (150, 60, 44), "hair": (70, 52, 38), "alu": (150, 152, 156), "belt": (18, 18, 19),
    "stem": (112, 108, 52),
    # driver figure: work trousers, darker jacket yoke, eyes, lips, reflective piping
    "trouser": (54, 56, 50), "yoke": (26, 40, 72), "eye": (26, 20, 18), "lip": (150, 92, 82),
    "reflect": (178, 180, 176),
}
for _i, _name in enumerate(PALETTE):
    REGIONS[f"pal_{_name}"] = (960 + _i * 32, 1280, 32, 32)


def _gauge(d, cx, cy, r, label, unit, vmax, step, value, redline=None):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(10, 12, 15, 255), outline=(90, 96, 104, 255), width=4)
    a0, a1 = math.radians(225), math.radians(-45)
    n_major = int(vmax / step)
    f_num = font("DIN Alternate Bold.ttf", int(r * 0.19))
    for i in range(n_major * 5 + 1):
        t = i / (n_major * 5)
        a = a0 + (a1 - a0) * t
        major = i % 5 == 0
        r0 = r * (0.80 if major else 0.86)
        colr = (236, 238, 240, 255)
        if redline is not None and t * vmax >= redline:
            colr = (230, 60, 44, 255)
        d.line([cx + math.cos(a) * r0, cy - math.sin(a) * r0, cx + math.cos(a) * r * 0.93, cy - math.sin(a) * r * 0.93],
               fill=colr, width=5 if major else 2)
        if major:
            val = int(round(t * vmax))
            d.text((cx + math.cos(a) * r * 0.64, cy - math.sin(a) * r * 0.64), str(val), font=f_num, fill=(236, 238, 240, 255), anchor="mm")
    d.text((cx, cy + r * 0.38), label, font=font("Arial Bold.ttf", int(r * 0.15)), fill=(180, 186, 192, 255), anchor="mm")
    d.text((cx, cy + r * 0.58), unit, font=font("Arial.ttf", int(r * 0.12)), fill=(140, 146, 152, 255), anchor="mm")
    if value is not None:
        a = a0 + (a1 - a0) * (value / vmax)
        d.line([cx - math.cos(a) * r * 0.14, cy + math.sin(a) * r * 0.14, cx + math.cos(a) * r * 0.78, cy - math.sin(a) * r * 0.78],
               fill=(255, 96, 40, 255), width=7)
    d.ellipse([cx - r * 0.09, cy - r * 0.09, cx + r * 0.09, cy + r * 0.09], fill=(40, 42, 46, 255), outline=(120, 124, 130, 255), width=2)


def _plate(text_left, text_right):
    w, h = REGIONS["plate_tractor"][2:]
    im = Image.new("RGBA", (w, h), (244, 244, 240, 255))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([3, 3, w - 4, h - 4], radius=14, outline=(16, 16, 18, 255), width=7)
    d.rounded_rectangle([8, 8, 92, h - 9], radius=9, fill=(0, 61, 165, 255))
    d.text((50, h - 42), "D", font=font("Arial Bold.ttf", 46), fill=(255, 255, 255, 255), anchor="mm")
    for k in range(12):
        a = 2 * math.pi * k / 12
        d.ellipse([50 + math.cos(a) * 24 - 3, 46 + math.sin(a) * 24 - 3, 50 + math.cos(a) * 24 + 3, 46 + math.sin(a) * 24 + 3], fill=(255, 204, 0, 255))
    f = font("DIN Condensed Bold.ttf", 178)
    d.text((112, h / 2 + 12), text_left, font=f, fill=(14, 14, 16, 255), anchor="lm")
    lw = d.textlength(text_left, font=f)
    sx = 112 + lw + 34
    d.ellipse([sx - 22, 30, sx + 22, 74], fill=(60, 110, 60, 255), outline=(20, 20, 20, 255), width=2)       # generic inspection disc
    d.ellipse([sx - 24, 92, sx + 24, 140], fill=(228, 228, 222, 255), outline=(20, 20, 20, 255), width=2)     # generic seal
    d.text((sx + 46, h / 2 + 12), text_right, font=f, fill=(14, 14, 16, 255), anchor="lm")
    return im


def _leaf(seed):
    s = 320
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    cx, cy = s * 0.5, s * 0.60
    dx, dy = (xx - cx) / (s * 0.5), (cy - yy) / (s * 0.5)
    ang = np.arctan2(dx, dy)                   # 0 = tip (up)
    rad = np.hypot(dx, dy)
    lobes = 0.62 + 0.30 * np.cos(ang * 5 * 0.5) ** 2 * (1 - 0.35 * np.abs(ang) / math.pi) + 0.20 * np.cos(ang)
    lobes *= 0.86 + 0.14 * np.abs(np.sin(ang * 2.5))
    serr = 0.035 * np.abs(((ang * 14 / math.pi + rng.uniform(0, 1)) % 1.0) - 0.5) * 2
    sinus = np.exp(-((np.abs(ang) - math.pi) / 0.22) ** 2) * 0.55          # petiole notch at the bottom
    edge = lobes * 0.92 - serr - sinus
    alpha = np.clip((edge - rad) / 0.012, 0, 1)
    base = np.array(((70, 110, 34), (104, 132, 40), (150, 140, 46))[seed % 3], np.float32)
    n = fbm(512, (8, 16, 64), 40 + seed)[:s, :s]
    colr = base[None, None, :] * (0.72 + 0.5 * n[..., None]) * (1.08 - 0.25 * rad[..., None])
    vein = np.zeros((s, s), np.float32)
    for a_v in (0.0, 0.62, -0.62, 1.30, -1.30):
        dist = np.abs(np.sin(ang - a_v)) * rad
        along = np.cos(ang - a_v) > 0
        vein = np.maximum(vein, np.where(along, np.clip(1 - dist / 0.018, 0, 1), 0) * np.clip(1.1 - rad, 0, 1))
        for k in range(1, 5):                    # secondary veins
            rk = 0.18 * k
            dsec = np.abs((rad - rk) - np.abs(np.sin(ang - a_v)) * 1.6 * rk)
            near = (np.abs(ang - a_v) < 0.33) & along
            vein = np.maximum(vein, np.where(near, np.clip(1 - dsec / 0.010, 0, 1) * 0.5, 0))
    colr = colr * (1 - 0.35 * vein[..., None]) + np.array((176, 190, 96), np.float32) * 0.35 * vein[..., None]
    spots = np.clip((fbm(512, (24, 48), 60 + seed)[:s, :s] - 0.68) * 6, 0, 1)
    colr = colr * (1 - spots[..., None] * 0.6) + np.array((120, 84, 40), np.float32) * spots[..., None] * 0.6
    out = np.dstack([np.clip(colr, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def _reflector(rgb):
    s = 128
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32) / s
    n = 8
    fx = (xx * n + 0.5 * (np.floor(yy * n * 1.1547) % 2)) % 1.0
    fy = (yy * n * 1.1547) % 1.0
    cell = 1.0 - np.clip(np.hypot(fx - 0.5, fy - 0.5) * 2.0, 0, 1)
    v = 0.55 + 0.45 * cell
    arr = np.dstack([np.array(rgb, np.float32)[None, None, :] * v[..., None], np.full((s, s, 1), 255.0)])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def gen_atlas():
    atlas = Image.new("RGBA", (ATLAS, ATLAS), (0, 0, 0, 0))

    def paste(name, im):
        x, y, w, h = REGIONS[name]
        if im.size != (w, h):
            raise ValueError(f"{name}: image {im.size} != region {(w, h)}")
        atlas.paste(im, (x, y))

    # --- instrument cluster ---
    w, h = REGIONS["cluster"][2:]
    im = Image.new("RGBA", (w, h), (6, 7, 9, 255))
    d = ImageDraw.Draw(im)
    # needles, gear and clock are drawn live by the runtime (src/tractor.ts, cluster overlay canvas)
    _gauge(d, 216, 222, 196, "U/min", "x 100", 30, 5, None, redline=25)
    _gauge(d, w - 216, 222, 196, "km/h", "", 50, 10, None)
    d.rounded_rectangle([432, 60, 592, 388], radius=14, fill=(14, 22, 20, 255), outline=(70, 90, 80, 255), width=3)
    d.text((512, 96), "PALATIN", font=font("Arial Black.ttf", 26), fill=(120, 220, 150, 255), anchor="mm")
    d.text((452, 282), "Diesel", font=font("Arial.ttf", 18), fill=(150, 160, 156, 255), anchor="lm")
    d.rounded_rectangle([452, 296, 572, 314], radius=4, outline=(120, 130, 126, 255), width=2)
    d.rectangle([455, 299, 455 + 84, 311], fill=(110, 210, 120, 255))
    d.text((452, 338), "Temp", font=font("Arial.ttf", 18), fill=(150, 160, 156, 255), anchor="lm")
    d.rounded_rectangle([452, 352, 572, 370], radius=4, outline=(120, 130, 126, 255), width=2)
    d.rectangle([455, 355, 455 + 52, 367], fill=(90, 170, 230, 255))
    icons = [((60, 200, 90), "◄"), ((60, 200, 90), "►"), ((70, 120, 255), "≡"), ((250, 180, 40), "!"), ((230, 50, 40), "■"), ((60, 200, 90), "P")]
    f_i = font("Arial Unicode.ttf", 22)
    for k, (c, sym) in enumerate(icons):
        x = 420 + k * 38
        lit = k in (5,)
        cc = tuple(int(v * (1.0 if lit else 0.28)) for v in c) + (255,)
        d.rounded_rectangle([x - 14, 408, x + 14, 436], radius=5, outline=cc, width=2)
        d.text((x, 422), sym, font=f_i, fill=cc, anchor="mm")
    paste("cluster", im)

    # --- terminal (guidance / tour screen) ---
    w, h = REGIONS["terminal"][2:]
    im = Image.new("RGBA", (w, h), (16, 20, 26, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 44], fill=(28, 38, 50, 255))
    d.text((14, 22), "Weinlese-Tour  ·  Kindenheim", font=font("Arial Bold.ttf", 22), fill=(226, 232, 240, 255), anchor="lm")
    d.text((w - 14, 22), "12:40", font=font("DIN Alternate Bold.ttf", 24), fill=(226, 232, 240, 255), anchor="rm")
    d.rectangle([10, 54, 440, 388], fill=(34, 52, 38, 255))
    rng = np.random.default_rng(3)
    for k in range(9):                                    # vineyard parcels with rows
        x0 = 20 + (k % 3) * 140 + int(rng.integers(-6, 6))
        y0 = 64 + (k // 3) * 106 + int(rng.integers(-4, 4))
        colr = [(58, 104, 54), (74, 120, 58), (92, 128, 60), (120, 132, 70)][int(rng.integers(0, 4))]
        d.polygon([(x0, y0), (x0 + 124, y0 + 6), (x0 + 118, y0 + 92), (x0 + 4, y0 + 88)], fill=colr + (255,), outline=(20, 34, 24, 255))
        for r_ in range(8):
            d.line([(x0 + 8 + r_ * 14, y0 + 6), (x0 + 6 + r_ * 14, y0 + 86)], fill=(40, 70, 40, 255), width=2)
    d.line([(10, 240), (150, 232), (240, 180), (330, 172), (440, 120)], fill=(232, 226, 200, 255), width=9)
    d.line([(10, 240), (150, 232), (240, 180), (330, 172), (440, 120)], fill=(255, 196, 40, 255), width=3)
    d.polygon([(232, 164), (252, 184), (226, 190)], fill=(255, 255, 255, 255), outline=(20, 20, 20, 255))
    for k, (lab, val, colr) in enumerate([("km/h", "", (236, 240, 244)), ("U/min", "", (236, 240, 244)),
                                          ("Diesel", "71 %", (120, 220, 130)), ("Ladung", "4.2 t", (190, 150, 240))]):
        y0 = 54 + k * 84
        d.rounded_rectangle([452, y0, w - 10, y0 + 76], radius=8, fill=(26, 32, 42, 255), outline=(60, 72, 90, 255), width=2)
        d.text((464, y0 + 18), lab, font=font("Arial.ttf", 18), fill=(150, 160, 174, 255), anchor="lm")
        d.text((w - 22, y0 + 50), val, font=font("DIN Alternate Bold.ttf", 36), fill=colr + (255,), anchor="rm")
    for k, lab in enumerate(["Karte", "Hydr.", "Licht", "Zapfw.", "Menü"]):
        x0 = 10 + k * 126
        d.rounded_rectangle([x0, 398, x0 + 116, 438], radius=6, fill=(40, 52, 68, 255) if k else (36, 96, 60, 255))
        d.text((x0 + 58, 418), lab, font=font("Arial Bold.ttf", 18), fill=(226, 232, 240, 255), anchor="mm")
    paste("terminal", im)

    # --- right-hand console button panel ---
    w, h = REGIONS["console"][2:]
    im = Image.new("RGBA", (w, h), (26, 27, 30, 255))
    d = ImageDraw.Draw(im)
    f_b = font("Arial Bold.ttf", 20)
    labels = ["4WD", "DIFF", "PTO", "AUTO", "F/R", "ECO", "LIFT", "LOCK", "1", "2", "3", "4"]
    cols = [(90, 200, 110), (240, 170, 50), (240, 200, 60), (120, 170, 250), (230, 230, 230), (90, 200, 110),
            (230, 230, 230), (230, 80, 60), (70, 130, 240), (230, 70, 60), (240, 200, 60), (80, 190, 100)]
    for k, lab in enumerate(labels):
        x0 = 22 + (k % 3) * 118
        y0 = 22 + (k // 3) * 80
        d.rounded_rectangle([x0, y0, x0 + 100, y0 + 62], radius=9, fill=(44, 46, 50, 255), outline=(84, 88, 94, 255), width=2)
        d.text((x0 + 50, y0 + 26), lab, font=f_b, fill=(226, 228, 230, 255), anchor="mm")
        d.rectangle([x0 + 34, y0 + 46, x0 + 66, y0 + 52], fill=cols[k] + (255,))
    d.ellipse([40, 348, 124, 432], fill=(50, 52, 56, 255), outline=(110, 114, 120, 255), width=4)
    d.line([82, 390, 108, 364], fill=(240, 240, 240, 255), width=5)
    d.rounded_rectangle([160, 356, 362, 424], radius=8, fill=(12, 18, 16, 255), outline=(70, 90, 80, 255), width=2)
    d.text((261, 390), "540 E", font=font("DIN Alternate Bold.ttf", 38), fill=(120, 220, 150, 255), anchor="mm")
    paste("console", im)

    paste("plate_tractor", _plate("DÜW", "KH 26"))
    paste("plate_trailer", _plate("DÜW", "WL 26"))

    for name, num in (("sign25", "25"), ("sign40", "40")):
        im = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.ellipse([4, 4, 188, 188], fill=(246, 246, 242, 255), outline=(14, 14, 16, 255), width=9)
        d.text((96, 92), num, font=font("DIN Alternate Bold.ttf", 108), fill=(14, 14, 16, 255), anchor="mm")
        paste(name, im)

    # --- emblem: stylised grape cluster in a ring (fictional make) ---
    im = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([4, 4, 188, 188], fill=(196, 200, 204, 255), outline=(60, 64, 68, 255), width=4)
    d.ellipse([20, 20, 172, 172], fill=(14, 60, 34, 255))
    for row, n in enumerate((3, 3, 2, 1)):
        for k in range(n):
            cx = 96 + (k - (n - 1) / 2) * 30
            cy = 72 + row * 26
            d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=(206, 210, 214, 255))
    d.polygon([(96, 30), (116, 42), (102, 54), (90, 48)], fill=(206, 210, 214, 255))
    paste("emblem", im)

    # --- DIN 11030 style warning board ---
    s = 384
    yy, xx = np.mgrid[0:s, 0:s]
    stripe = ((xx + yy) // 64) % 2
    arr = np.where(stripe[..., None] == 0, np.array((204, 26, 22, 255)), np.array((240, 240, 236, 255))).astype(np.uint8)
    im = Image.fromarray(arr, "RGBA")
    ImageDraw.Draw(im).rectangle([0, 0, s - 1, s - 1], outline=(150, 20, 18, 255), width=6)
    paste("chevron", im)

    # --- wordmarks ---
    def wordmark(fill, outline):
        im = Image.new("RGBA", (1024, 192), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        f = font("Arial Black.ttf", 132)
        tmp = Image.new("RGBA", (1024, 192), (0, 0, 0, 0))
        dt = ImageDraw.Draw(tmp)
        dt.text((500, 92), "PALATIN", font=f, fill=fill, anchor="mm", stroke_width=5, stroke_fill=outline)
        tmp = tmp.transform(tmp.size, Image.Transform.AFFINE, (1, 0.20, -20, 0, 1, 0), resample=Image.Resampling.BICUBIC)   # italic shear
        im.alpha_composite(tmp)
        d.rectangle([60, 168, 964, 178], fill=fill)
        return im
    paste("wordmark", wordmark((238, 240, 240, 255), (20, 26, 22, 255)))
    paste("wordmark_dark", wordmark((22, 70, 40, 255), (236, 238, 238, 255)))

    im = Image.new("RGBA", (448, 192), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((20, 96), "110", font=font("Arial Black.ttf", 128), fill=(238, 240, 240, 255), anchor="lm", stroke_width=4, stroke_fill=(20, 26, 22, 255))
    d.text((330, 96), "V", font=font("Arial Black.ttf", 128), fill=(214, 40, 34, 255), anchor="lm", stroke_width=4, stroke_fill=(20, 26, 22, 255))
    paste("badge", im)

    im = Image.new("RGBA", (320, 192), (176, 180, 184, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([4, 4, 315, 187], outline=(40, 42, 46, 255), width=3)
    d.text((16, 26), "PALATIN Landtechnik", font=font("Arial Bold.ttf", 22), fill=(20, 22, 24, 255), anchor="lm")
    for k, t in enumerate(["Typ  TW 80 / 110 V", "Zul. Gesamtgew.  8000 kg", "Achslast  2 x 4000 kg", "Baujahr  2026    25 km/h"]):
        d.text((16, 62 + k * 30), t, font=font("Arial.ttf", 19), fill=(26, 28, 30, 255), anchor="lm")
    for cx, cy in ((12, 12), (308, 12), (12, 180), (308, 180)):
        d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(90, 92, 96, 255))
    paste("typeplate", im)

    im = Image.new("RGBA", (320, 192), (250, 204, 20, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([3, 3, 316, 188], outline=(16, 16, 16, 255), width=5)
    d.polygon([(70, 30), (124, 124), (16, 124)], fill=(250, 204, 20, 255), outline=(16, 16, 16, 255), width=7)
    d.text((70, 92), "!", font=font("Arial Black.ttf", 60), fill=(16, 16, 16, 255), anchor="mm")
    for k, t in enumerate(["ACHTUNG", "Kippbereich", "freihalten"]):
        d.text((140, 46 + k * 34), t, font=font("Arial Bold.ttf", 26 if k == 0 else 22), fill=(16, 16, 16, 255), anchor="lm")
    d.text((160, 160), "Bedienungsanleitung beachten", font=font("Arial.ttf", 17), fill=(16, 16, 16, 255), anchor="mm")
    paste("warnsticker", im)

    for k in range(3):
        paste(f"leaf{k + 1}", _leaf(k))
    paste("refl_red", _reflector((214, 24, 20)))
    paste("refl_amber", _reflector((246, 150, 14)))
    paste("refl_white", _reflector((238, 238, 232)))

    for name, c0, c1 in (("tape_redwhite", (200, 28, 24), (240, 240, 236)), ("tape_yellow", (246, 196, 18), (20, 20, 20))):
        w, h = REGIONS[name][2:]
        yy, xx = np.mgrid[0:h, 0:w]
        st = ((xx + yy) // 44) % 2
        arr = np.where(st[..., None] == 0, np.array(c0 + (255,)), np.array(c1 + (255,))).astype(np.uint8)
        paste(name, Image.fromarray(arr, "RGBA"))

    im = Image.new("RGBA", (256, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([4, 20, 252, 108], radius=12, fill=(20, 20, 22, 255), outline=(240, 240, 236, 255), width=4)
    d.text((128, 64), "DIESEL", font=font("Arial Black.ttf", 50), fill=(250, 204, 20, 255), anchor="mm")
    paste("diesel", im)

    im = Image.new("RGBA", (256, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k, c in enumerate(((60, 110, 230), (224, 50, 40), (244, 200, 30), (60, 180, 80))):
        d.ellipse([10 + k * 62, 34, 62 + k * 62, 86], fill=c + (255,), outline=(20, 20, 20, 255), width=3)
        d.text((36 + k * 62, 60), "+-"[k % 2], font=font("Arial Black.ttf", 30), fill=(250, 250, 250, 255), anchor="mm")
    paste("hydr_dots", im)

    # --- headliner panel: radio + climate ---
    w, h = REGIONS["headliner"][2:]
    im = Image.new("RGBA", (w, h), (30, 31, 34, 255))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([20, 30, 420, 194], radius=10, fill=(16, 17, 19, 255), outline=(70, 72, 78, 255), width=3)
    d.rounded_rectangle([110, 56, 330, 124], radius=6, fill=(10, 26, 40, 255))
    d.text((220, 78), "SWR1 RP", font=font("DIN Alternate Bold.ttf", 28), fill=(120, 200, 255, 255), anchor="mm")
    d.text((220, 106), "97.8 MHz", font=font("Arial.ttf", 18), fill=(120, 200, 255, 255), anchor="mm")
    for cx in (64, 376):
        d.ellipse([cx - 30, 60, cx + 30, 120], fill=(48, 50, 54, 255), outline=(110, 112, 118, 255), width=3)
    for k in range(6):
        d.rounded_rectangle([112 + k * 37, 140, 142 + k * 37, 172], radius=4, fill=(48, 50, 54, 255))
        d.text((127 + k * 37, 156), str(k + 1), font=font("Arial Bold.ttf", 16), fill=(200, 202, 206, 255), anchor="mm")
    for k, (lab, c) in enumerate((("TEMP", (230, 80, 60)), ("FAN", (230, 230, 230)), ("A/C", (90, 170, 250)))):
        cx = 520 + k * 130
        d.ellipse([cx - 44, 50, cx + 44, 138], fill=(48, 50, 54, 255), outline=(110, 112, 118, 255), width=3)
        d.line([cx, 94, cx + 26, 66], fill=c + (255,), width=6)
        d.text((cx, 170), lab, font=font("Arial Bold.ttf", 22), fill=(206, 208, 212, 255), anchor="mm")
    paste("headliner", im)

    # --- rocker switch row ---
    w, h = REGIONS["switches"][2:]
    im = Image.new("RGBA", (w, h), (28, 29, 32, 255))
    d = ImageDraw.Draw(im)
    syms = ["☼", "≡", "◐", "▲", "⚠", "❄", "♪", "⌂"]
    f_s = font("Arial Unicode.ttf", 34)
    for k, sym in enumerate(syms):
        x0 = 16 + k * 77
        d.rounded_rectangle([x0, 30, x0 + 64, 194], radius=8, fill=(46, 48, 52, 255), outline=(90, 92, 98, 255), width=2)
        d.line([x0 + 6, 112, x0 + 58, 112], fill=(20, 20, 22, 255), width=3)
        lit = k in (0, 4)
        c = ((250, 190, 40) if k == 4 else (110, 220, 130)) if lit else (170, 172, 178)
        d.text((x0 + 32, 70), sym, font=f_s, fill=c + (255,), anchor="mm")
        d.rectangle([x0 + 20, 160, x0 + 44, 168], fill=(c if lit else (70, 72, 76)) + (255,))
    paste("switches", im)

    # --- trailer wordmark ---
    im = Image.new("RGBA", (1024, 176), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((16, 88), "PALATIN", font=font("Arial Black.ttf", 104), fill=(22, 70, 40, 255), anchor="lm")
    d.text((640, 70), "TW 80", font=font("Arial Black.ttf", 76), fill=(30, 32, 34, 255), anchor="lm")
    d.text((642, 140), "Traubenwagen", font=font("Arial Bold.ttf", 34), fill=(30, 32, 34, 255), anchor="lm")
    paste("trailer_mark", im)

    # --- small secondary screen (armrest) ---
    w, h = REGIONS["screen_small"][2:]
    im = Image.new("RGBA", (w, h), (12, 16, 20, 255))
    d = ImageDraw.Draw(im)
    d.text((16, 26), "Hydraulik", font=font("Arial Bold.ttf", 22), fill=(220, 226, 232, 255), anchor="lm")
    for k, c in enumerate(((60, 110, 230), (224, 50, 40), (244, 200, 30), (60, 180, 80))):
        x0 = 20 + k * 122
        d.rounded_rectangle([x0, 52, x0 + 104, 206], radius=8, outline=(70, 80, 96, 255), width=2)
        lvl = (0.35, 0.7, 0.5, 0.2)[k]
        d.rectangle([x0 + 8, 198 - int(138 * lvl), x0 + 96, 198], fill=c + (255,))
        d.text((x0 + 52, 72), f"{int(lvl * 100)}%", font=font("DIN Alternate Bold.ttf", 24), fill=(236, 240, 244, 255), anchor="mm")
    paste("screen_small", im)

    for name, rgb in PALETTE.items():
        paste(f"pal_{name}", Image.new("RGBA", (32, 32), rgb + (255,)))

    # --- small safety / service labels (generic pictograms, fictional make) ---
    def label(title, lines, bg=(250, 204, 20), fg=(16, 16, 16)):
        im = Image.new("RGBA", (256, 176), bg + (255,))
        d = ImageDraw.Draw(im)
        d.rectangle([3, 3, 252, 172], outline=fg + (255,), width=4)
        d.polygon([(44, 22), (78, 82), (10, 82)], outline=fg + (255,), width=6)
        d.text((44, 62), "!", font=font("Arial Black.ttf", 36), fill=fg + (255,), anchor="mm")
        d.text((92, 44), title, font=font("Arial Black.ttf", 26), fill=fg + (255,), anchor="lm")
        for k, t in enumerate(lines):
            d.text((14, 108 + k * 26), t, font=font("Arial Bold.ttf", 19), fill=fg + (255,), anchor="lm")
        return im
    paste("label_pto", label("GEFAHR", ["Zapfwelle nur mit", "Schutz betreiben"]))
    paste("label_hot", label("HEISS", ["Oberfläche nicht", "berühren"], bg=(214, 40, 34), fg=(250, 250, 250)))
    im = Image.new("RGBA", (256, 176), (236, 236, 230, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([3, 3, 252, 172], outline=(16, 16, 16, 255), width=4)
    d.text((128, 34), "REIFENDRUCK", font=font("Arial Black.ttf", 24), fill=(16, 16, 16, 255), anchor="mm")
    d.text((128, 84), "vorn   1,2 bar", font=font("Arial Bold.ttf", 24), fill=(16, 16, 16, 255), anchor="mm")
    d.text((128, 124), "hinten 1,0 bar", font=font("Arial Bold.ttf", 24), fill=(16, 16, 16, 255), anchor="mm")
    paste("label_tyre", im)
    im = Image.new("RGBA", (256, 176), (30, 140, 70, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([98, 28, 158, 148], fill=(250, 250, 250, 255))
    d.rectangle([68, 58, 188, 118], fill=(250, 250, 250, 255))
    paste("firstaid", im)
    im = Image.new("RGBA", (512, 304), (238, 238, 232, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([4, 4, 507, 299], outline=(20, 70, 40, 255), width=6)
    d.text((24, 44), "PALATIN Service", font=font("Arial Black.ttf", 38), fill=(20, 70, 40, 255), anchor="lm")
    for k, t in enumerate(["Motoröl 15W-40  alle 500 h", "Hydrauliköl HVLP 46", "Kühlmittel -30 °C", "Nächster Dienst:  1250 h"]):
        d.text((24, 110 + k * 46), t, font=font("Arial Bold.ttf", 28), fill=(24, 24, 26, 255), anchor="lm")
    paste("label_service", im)

    # --- grape juice runs on the tub (alpha decals) ---
    for k in range(3):
        rng = np.random.default_rng(300 + k)
        w_, h_ = 512, 304
        yy, xx = np.mgrid[0:h_, 0:w_].astype(np.float32)
        a_ = np.zeros((h_, w_), np.float32)
        for _ in range(int(rng.integers(5, 9))):
            x0 = rng.uniform(40, w_ - 40)
            wid = rng.uniform(6, 20)
            ln = rng.uniform(0.35, 1.0) * h_
            wob = x0 + 6 * np.sin(yy / rng.uniform(18, 40) + rng.uniform(0, 6))
            core = np.clip(1 - np.abs(xx - wob) / (wid * (1.0 - 0.55 * yy / h_)), 0, 1)
            a_ = np.maximum(a_, core * np.clip((ln - yy) / 40.0, 0, 1) * rng.uniform(0.45, 0.9))
        top = np.clip(1 - yy / 26.0, 0, 1) * (0.5 + 0.5 * fbm(512, (8, 32), 310 + k)[:h_, :w_])
        a_ = np.clip(np.maximum(a_, top) * (0.75 + 0.5 * fbm(512, (32, 96), 320 + k)[:h_, :w_]), 0, 0.92)
        colr = np.array((58, 22, 46), np.float32)[None, None, :] * (0.8 + 0.4 * fbm(512, (16, 64), 330 + k)[:h_, :w_, None])
        paste(f"juice{k + 1}", Image.fromarray(np.dstack([colr, a_ * 255]).astype(np.uint8), "RGBA"))

    save("vehicle_atlas.png", atlas)
    layout = {}
    for name, (x, y, w, h) in REGIONS.items():
        inset = 0.75
        layout[name] = [(x + inset) / ATLAS, 1.0 - (y + h - inset) / ATLAS, (x + w - inset) / ATLAS, 1.0 - (y + inset) / ATLAS]
    (OUT / "vehicle_atlas.json").write_text(json.dumps(layout, indent=1))
    print("  wrote vehicle_atlas.json")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("Generating vehicle textures ->", OUT)
    import sys
    only = set(sys.argv[1:])
    for name, fn in (("atlas", gen_atlas), ("details", gen_details), ("tyre", gen_tyre), ("grapes", gen_grapes),
                     ("exhaust", gen_exhaust), ("glass", gen_glass)):
        if not only or name in only:
            fn()


if __name__ == "__main__":
    main()
