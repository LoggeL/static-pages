#!/usr/bin/env python3
"""
Procedural PBR & Alpha-Masked Foliage Texture Generator for Kindenheim Rural Field Props:
  - hedgerow_foliage.png          (512x512 RGBA: Pfalz hawthorn/shrub leaves + twigs + red berries)
  - rose_bush.png                 (512x512 RGBA: Pfalz climbing vineyard rose foliage + pink/crimson roses)
  - timber_weathered_albedo.jpg   (512x512 RGB: weathered spruce/oak poles & cabin planks)
  - timber_weathered_normal.png   (256x256 RGB: woodgrain normal map)
  - roof_felt_albedo.jpg          (256x256 RGB: dark charcoal-green German Bitumen-Dachpappe)
  - sandstone_albedo.jpg          (512x512 RGB: historic Pfälzer Buntsandstein with lichen & weathering)
  - sandstone_normal.png          (256x256 RGB: chiseled stone normal map)

Compact sizes keep all 4 rural prop GLBs combined well under 650 KB!
"""

import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TEX_DIR = "/Users/logge/Documents/Projects/kindenheim-3d/blender/fields/props/textures"
os.makedirs(TEX_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Fast Tileable Value Noise & Height-to-Normal Utilities
# ---------------------------------------------------------------------------

def tileable_noise(size: int, freq: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    grid = rng.random((freq, freq), dtype=np.float32)
    y = np.linspace(0, freq, size, endpoint=False)
    x = np.linspace(0, freq, size, endpoint=False)
    xi = np.floor(x).astype(np.int32)
    yi = np.floor(y).astype(np.int32)
    xf = x - xi
    yf = y - yi
    sx = xf * xf * (3.0 - 2.0 * xf)
    sy = yf * yf * (3.0 - 2.0 * yf)
    x0 = xi % freq
    x1 = (x0 + 1) % freq
    y0 = yi % freq
    y1 = (y0 + 1) % freq
    n00 = grid[y0[:, None], x0[None, :]]
    n10 = grid[y0[:, None], x1[None, :]]
    n01 = grid[y1[:, None], x0[None, :]]
    n11 = grid[y1[:, None], x1[None, :]]
    nx0 = n00 * (1.0 - sx[None, :]) + n10 * sx[None, :]
    nx1 = n01 * (1.0 - sx[None, :]) + n11 * sx[None, :]
    return nx0 * (1.0 - sy[:, None]) + nx1 * sy[:, None]


def fbm(size: int, freqs: list[tuple[int, float]], seed: int) -> np.ndarray:
    acc = np.zeros((size, size), dtype=np.float32)
    wsum = 0.0
    for idx, (f, w) in enumerate(freqs):
        acc += tileable_noise(size, f, seed + idx * 97) * w
        wsum += w
    return acc / max(wsum, 1e-6)


def height_to_normal(height: np.ndarray, strength: float = 2.5) -> Image.Image:
    h = height.astype(np.float32)
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    nx = -dx
    ny = -dy
    nz = np.ones_like(h)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    rgb = np.stack([
        (nx * inv_len * 0.5 + 0.5) * 255.0,
        (ny * inv_len * 0.5 + 0.5) * 255.0,
        (nz * inv_len * 0.5 + 0.5) * 255.0,
    ], axis=-1)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")


def dilate_rgb_into_transparent(img_rgba: Image.Image, passes: int = 8) -> Image.Image:
    """Bleed RGB edge colors outward into alpha=0 pixels to prevent dark halo seams at mipmap edges."""
    arr = np.array(img_rgba, dtype=np.uint8)
    rgb = arr[:, :, :3].copy()
    alpha = arr[:, :, 3].copy()
    filled = alpha > 24
    for _ in range(passes):
        if filled.all():
            break
        new_rgb = rgb.copy()
        new_filled = filled.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sh_f = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            sh_rgb = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            take = (~new_filled) & sh_f
            new_rgb[take] = sh_rgb[take]
            new_filled[take] = True
        rgb = new_rgb
        filled = new_filled
    out = np.dstack([rgb, alpha])
    return Image.fromarray(out, mode="RGBA")


# ---------------------------------------------------------------------------
# 1. Hedgerow Foliage Card (512x512 RGBA) — Hawthorn / Blackthorn / Elderberry
# ---------------------------------------------------------------------------

def generate_hedgerow_foliage():
    S = 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rng = random.Random(4101)

    # Branching woody twigs from bottom-center outward
    def draw_twig(x0, y0, angle, length, width, depth):
        x1 = x0 + math.cos(angle) * length
        y1 = y0 + math.sin(angle) * length
        col = (68 + rng.randint(-8, 8), 52 + rng.randint(-6, 6), 36 + rng.randint(-5, 5), 255)
        draw.line([(x0, y0), (x1, y1)], fill=col, width=max(2, int(width)))
        if depth > 0:
            for sgn in (-1, 1):
                a2 = angle + sgn * rng.uniform(0.32, 0.65)
                draw_twig(
                    x0 + (x1 - x0) * rng.uniform(0.45, 0.85),
                    y0 + (y1 - y0) * rng.uniform(0.45, 0.85),
                    a2,
                    length * rng.uniform(0.58, 0.76),
                    width * 0.68,
                    depth - 1,
                )

    for bx, ang in ((S * 0.5, -math.pi * 0.5), (S * 0.36, -math.pi * 0.62), (S * 0.64, -math.pi * 0.38)):
        draw_twig(bx, S * 0.94, ang + rng.uniform(-0.08, 0.08), S * 0.34, 7, 3)

    # Multi-layered hawthorn / shrub leaves (dark shadow interior -> mid olive -> sunlit tips)
    def draw_leaf(cx, cy, ang, length, width, col_main, col_vein):
        ca, sa = math.cos(ang), math.sin(ang)
        px, py = -sa, ca
        pts = []
        # Lobed hawthorn-like leaf silhouette
        profile = [
            (0.0, 0.0), (0.22, 0.42), (0.42, 0.34), (0.62, 0.54),
            (0.84, 0.30), (1.0, 0.0),
            (0.84, -0.30), (0.62, -0.54), (0.42, -0.34), (0.22, -0.42),
        ]
        for u, v in profile:
            lx = cx + ca * (u * length) + px * (v * width)
            ly = cy + sa * (u * length) + py * (v * width)
            pts.append((lx, ly))
        draw.polygon(pts, fill=col_main)
        draw.line([(cx, cy), (cx + ca * length * 0.86, cy + sa * length * 0.86)], fill=col_vein, width=1)

    # 3 depth layers so foliage cluster feels lush, natural, and volumetric!
    layers = [
        (180, (28, 50, 20), (42, 68, 28), 34, 48),   # deep interior shadow leaves
        (220, (44, 74, 30), (64, 96, 40), 30, 44),   # rich Pfalz summer mid-green
        (140, (66, 98, 38), (92, 124, 52), 24, 38),  # warm sunlit outer leaves
    ]
    for count, c_base, c_vein, lmin, lmax in layers:
        for _ in range(count):
            # Organic oval shrub cluster staying cleanly away from outer 18px border
            rr = math.sqrt(rng.random()) * (S * 0.42)
            th = rng.uniform(0, math.pi * 2.0)
            cx = S * 0.5 + math.cos(th) * rr * 1.04
            cy = S * 0.51 + math.sin(th) * rr * 0.94
            if cx < 24 or cx > S - 24 or cy < 24 or cy > S - 22:
                continue
            ang = math.atan2(cy - S * 0.58, cx - S * 0.5) + rng.uniform(-1.05, 1.05)
            l_len = rng.uniform(lmin, lmax)
            l_wid = l_len * rng.uniform(0.55, 0.78)
            j = rng.randint(-10, 12)
            col = (
                max(15, min(230, c_base[0] + j)),
                max(25, min(235, c_base[1] + int(j * 1.2))),
                max(12, min(210, c_base[2] + int(j * 0.7))),
                255,
            )
            vc = (c_vein[0], c_vein[1], c_vein[2], 255)
            draw_leaf(cx, cy, ang, l_len, l_wid, col, vc)

    # Subtle authentic Pfalz hawthorn berries / wild rosehips (tiny warm red accents!)
    for _ in range(28):
        rr = math.sqrt(rng.random()) * (S * 0.34)
        th = rng.uniform(0, math.pi * 2.0)
        bx = S * 0.5 + math.cos(th) * rr
        by = S * 0.48 + math.sin(th) * rr
        rad = rng.uniform(3.0, 4.8)
        draw.ellipse([bx - rad, by - rad, bx + rad, by + rad], fill=(168, 42, 34, 255))
        draw.ellipse([bx - rad * 0.4, by - rad * 0.5, bx + rad * 0.2, by + rad * 0.1], fill=(220, 96, 78, 255))

    img = dilate_rgb_into_transparent(img, passes=10)
    out = os.path.join(TEX_DIR, "hedgerow_foliage.png")
    img.save(out, "PNG", optimize=True)
    print(f"[TEX] {out} ({os.path.getsize(out)/1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 2. Vineyard Rose Bush Foliage & Blossoms (512x512 RGBA) — Weinberg-Rosenstock
# ---------------------------------------------------------------------------

def generate_rose_bush():
    S = 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rng = random.Random(4202)

    # Arching thorny green rose canes radiating from base
    for i in range(9):
        x0 = S * 0.5 + rng.uniform(-35, 35)
        y0 = S * 0.94
        ang = -math.pi * 0.5 + (i - 4) * 0.18 + rng.uniform(-0.07, 0.07)
        cx, cy = x0, y0
        for step in range(5):
            seg = S * 0.15
            nx = cx + math.cos(ang) * seg
            ny = cy + math.sin(ang) * seg
            draw.line([(cx, cy), (nx, ny)], fill=(58, 92, 38, 255), width=max(2, 6 - step))
            cx, cy = nx, ny
            ang += rng.uniform(-0.18, 0.18)

    # Glossy toothed deep-green rose leaflets
    def draw_rose_leaf(cx, cy, ang, length, width, col):
        ca, sa = math.cos(ang), math.sin(ang)
        px, py = -sa, ca
        pts = [
            (cx, cy),
            (cx + ca * length * 0.35 + px * width * 0.48, cy + sa * length * 0.35 + py * width * 0.48),
            (cx + ca * length * 0.72 + px * width * 0.38, cy + sa * length * 0.72 + py * width * 0.38),
            (cx + ca * length, cy + sa * length),
            (cx + ca * length * 0.72 - px * width * 0.38, cy + sa * length * 0.72 - py * width * 0.38),
            (cx + ca * length * 0.35 - px * width * 0.48, cy + sa * length * 0.35 - py * width * 0.48),
        ]
        draw.polygon(pts, fill=col)
        draw.line([(cx, cy), (cx + ca * length * 0.85, cy + sa * length * 0.85)], fill=(86, 126, 56, 255), width=1)

    for layer_idx, (cnt, base_rgb) in enumerate([
        (160, (32, 66, 26)),
        (170, (48, 88, 36)),
        (100, (70, 114, 48)),
    ]):
        for _ in range(cnt):
            rr = math.sqrt(rng.random()) * (S * 0.40)
            th = rng.uniform(0, math.pi * 2.0)
            cx = S * 0.5 + math.cos(th) * rr * 1.05
            cy = S * 0.56 + math.sin(th) * rr * 0.88
            if cx < 26 or cx > S - 26 or cy < 28 or cy > S - 18:
                continue
            ang = math.atan2(cy - S * 0.78, cx - S * 0.5) + rng.uniform(-0.9, 0.9)
            l_len = rng.uniform(26, 42)
            l_wid = l_len * rng.uniform(0.55, 0.72)
            j = rng.randint(-8, 10)
            col = (base_rgb[0] + j, base_rgb[1] + j, base_rgb[2] + j, 255)
            draw_rose_leaf(cx, cy, ang, l_len, l_wid, col)

    # Vivid Pfalz pink & crimson-red climbing rose blooms (22 rich layered blossoms + buds!)
    def draw_rose_bloom(bx, by, rad, outer_col, mid_col, inner_col):
        # Outer 6 petals
        for p in range(6):
            a = p * (math.pi / 3.0) + rng.uniform(-0.2, 0.2)
            px = bx + math.cos(a) * rad * 0.48
            py = by + math.sin(a) * rad * 0.48
            r_p = rad * 0.58
            draw.ellipse([px - r_p, py - r_p, px + r_p, py + r_p], fill=outer_col)
        # Middle 5 petals
        for p in range(5):
            a = p * (math.pi * 2.0 / 5.0) + 0.35
            px = bx + math.cos(a) * rad * 0.28
            py = by + math.sin(a) * rad * 0.28
            r_p = rad * 0.44
            draw.ellipse([px - r_p, py - r_p, px + r_p, py + r_p], fill=mid_col)
        # Tight center swirl + golden stamen hint
        r_c = rad * 0.30
        draw.ellipse([bx - r_c, by - r_c, bx + r_c, by + r_c], fill=inner_col)
        r_s = rad * 0.11
        draw.ellipse([bx - r_s, by - r_s, bx + r_s, by + r_s], fill=(242, 204, 88, 255))

    palettes = [
        ((186, 36, 68, 255), (222, 62, 96, 255), (145, 20, 44, 255)),   # classic crimson-pink Pfalz rose
        ((210, 58, 92, 255), (242, 108, 138, 255), (176, 36, 68, 255)), # vivid rose-pink
        ((165, 24, 48, 255), (206, 44, 68, 255), (124, 14, 30, 255)),   # deep scarlet rose
    ]
    bloom_pts = []
    for _ in range(24):
        for _try in range(25):
            rr = math.sqrt(rng.random()) * (S * 0.36)
            th = rng.uniform(0, math.pi * 2.0)
            bx = S * 0.5 + math.cos(th) * rr * 1.02
            by = S * 0.48 + math.sin(th) * rr * 0.86
            if bx < 42 or bx > S - 42 or by < 42 or by > S - 52:
                continue
            if all(math.hypot(bx - ox, by - oy) > 34 for ox, oy in bloom_pts):
                bloom_pts.append((bx, by))
                pal = rng.choice(palettes)
                draw_rose_bloom(bx, by, rng.uniform(16.0, 25.0), *pal)
                break

    img = dilate_rgb_into_transparent(img, passes=10)
    out = os.path.join(TEX_DIR, "rose_bush.png")
    img.save(out, "PNG", optimize=True)
    print(f"[TEX] {out} ({os.path.getsize(out)/1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 3. Weathered Timber (Spruce Poles & Rough-Sawn Planks for Hochsitz & Rose Post)
# ---------------------------------------------------------------------------

def generate_weathered_timber():
    S = 512
    # Vertical stretched grain
    n_fine = tileable_noise(S, 64, 5101)
    n_med = tileable_noise(S, 16, 5102)
    n_streak = np.repeat(tileable_noise(S, 32, 5103)[::4, :], 4, axis=0)[:S, :S]
    # Vertical plank seam lines (6 vertical planks across U)
    u = np.linspace(0, 6.0, S, endpoint=False)
    plank_id = np.floor(u).astype(np.int32)
    frac_u = u - plank_id
    seam = ((frac_u < 0.03) | (frac_u > 0.97)).astype(np.float32)

    # Woodgrain rings + plank tonal offset
    rng = np.random.default_rng(5109)
    plank_tone = rng.uniform(-0.07, 0.07, size=6)[plank_id][None, :]
    grain = np.sin((u * 14.0 + n_med * 3.2) * math.pi) * 0.5 + 0.5
    h = np.clip(0.55 + (grain - 0.5) * 0.22 + (n_streak - 0.5) * 0.24 + (n_fine - 0.5) * 0.14 - seam * 0.42, 0.0, 1.0)

    # Rich seasoned weathered brown-silver larch/spruce timber
    r = np.clip((0.36 + plank_tone) * (0.72 + 0.48 * h), 0.06, 0.85)
    g = np.clip((0.27 + plank_tone * 0.85) * (0.70 + 0.46 * h), 0.05, 0.78)
    b = np.clip((0.18 + plank_tone * 0.7) * (0.68 + 0.42 * h), 0.04, 0.68)

    # Subtle weathered moss tint near bottom edge (V near 0 -> bottom rows of image)
    v_grad = np.linspace(0.0, 1.0, S)[:, None]
    moss = np.clip((v_grad - 0.78) * 3.2, 0.0, 1.0) * np.clip(n_med * 1.4 - 0.35, 0.0, 1.0)
    r = r * (1.0 - moss * 0.42) + 0.22 * moss * 0.42
    g = g * (1.0 - moss * 0.30) + 0.34 * moss * 0.30
    b = b * (1.0 - moss * 0.42) + 0.15 * moss * 0.42

    rgb = np.stack([r * 255, g * 255, b * 255], axis=-1).astype(np.uint8)
    albedo_path = os.path.join(TEX_DIR, "timber_weathered_albedo.jpg")
    Image.fromarray(rgb, mode="RGB").save(albedo_path, "JPEG", quality=84, optimize=True)

    h_small = np.array(Image.fromarray((h * 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS)) / 255.0
    norm_path = os.path.join(TEX_DIR, "timber_weathered_normal.png")
    height_to_normal(h_small, strength=3.2).save(norm_path, "PNG", optimize=True)
    print(f"[TEX] {albedo_path} ({os.path.getsize(albedo_path)/1024:.1f} KB), normal ({os.path.getsize(norm_path)/1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 4. Dark Bitumen Roofing Felt (Hochsitz Roof)
# ---------------------------------------------------------------------------

def generate_roof_felt():
    S = 256
    n = fbm(S, [(8, 0.35), (24, 0.35), (64, 0.30)], seed=6101)
    # Horizontal overlapping felt strips
    v = np.linspace(0, 4.0, S, endpoint=False)[:, None]
    lap = ((v - np.floor(v)) < 0.05).astype(np.float32)
    base = 0.22 + (n - 0.5) * 0.10 - lap * 0.06
    # Classic dark weathered green-charcoal German Dachpappe
    rgb = np.stack([
        np.clip((base * 0.92) * 255, 18, 120),
        np.clip((base * 1.04) * 255, 22, 130),
        np.clip((base * 0.94) * 255, 18, 120),
    ], axis=-1).astype(np.uint8)
    out = os.path.join(TEX_DIR, "roof_felt_albedo.jpg")
    Image.fromarray(rgb, mode="RGB").save(out, "JPEG", quality=82, optimize=True)
    print(f"[TEX] {out} ({os.path.getsize(out)/1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 5. Historic Pfälzer Buntsandstein (Wegekreuz Sandstone)
# ---------------------------------------------------------------------------

def generate_pfalz_sandstone():
    S = 512
    n_macro = fbm(S, [(4, 0.45), (12, 0.35), (32, 0.20)], seed=7101)
    n_grain = fbm(S, [(32, 0.45), (64, 0.35), (128, 0.20)], seed=7102)
    # Subtle horizontal sedimentary bedding lines
    y = np.linspace(0, 1.0, S)[:, None]
    strata = np.sin((y * 18.0 + n_macro * 1.4) * math.pi) * 0.5 + 0.5
    h = np.clip(0.5 + (n_macro - 0.5) * 0.35 + (n_grain - 0.5) * 0.30 + (strata - 0.5) * 0.14, 0.0, 1.0)

    # Warm pinkish-ochre Pfälzer Buntsandstein (iconic Palatinate sandstone!)
    r = np.clip(0.62 + (h - 0.5) * 0.28 + (strata - 0.5) * 0.07, 0.22, 0.88)
    g = np.clip(0.47 + (h - 0.5) * 0.24, 0.17, 0.80)
    b = np.clip(0.36 + (h - 0.5) * 0.20, 0.13, 0.72)

    # Pale gray-green weathered stone lichen flecks + subtle dark rain streaks
    lichen = np.clip(tileable_noise(S, 24, 7105) * tileable_noise(S, 48, 7106) - 0.46, 0.0, 1.0) * 2.2
    lichen = np.clip(lichen, 0.0, 0.65)
    r = r * (1.0 - lichen) + 0.62 * lichen
    g = g * (1.0 - lichen) + 0.66 * lichen
    b = b * (1.0 - lichen) + 0.55 * lichen

    # Subtle weathered darker base near ground
    base_dark = np.clip((y - 0.80) * 3.0, 0.0, 0.38)
    r *= (1.0 - base_dark * 0.65)
    g *= (1.0 - base_dark * 0.55)
    b *= (1.0 - base_dark * 0.68)

    rgb = np.stack([r * 255, g * 255, b * 255], axis=-1).astype(np.uint8)
    albedo_path = os.path.join(TEX_DIR, "sandstone_albedo.jpg")
    Image.fromarray(rgb, mode="RGB").save(albedo_path, "JPEG", quality=84, optimize=True)

    h_small = np.array(Image.fromarray((h * 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS)) / 255.0
    norm_path = os.path.join(TEX_DIR, "sandstone_normal.png")
    height_to_normal(h_small, strength=3.4).save(norm_path, "PNG", optimize=True)
    print(f"[TEX] {albedo_path} ({os.path.getsize(albedo_path)/1024:.1f} KB), normal ({os.path.getsize(norm_path)/1024:.1f} KB)")


def main():
    generate_hedgerow_foliage()
    generate_rose_bush()
    generate_weathered_timber()
    generate_roof_felt()
    generate_pfalz_sandstone()
    print("[TEX] All rural prop textures generated successfully.")


if __name__ == "__main__":
    main()
