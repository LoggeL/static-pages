#!/usr/bin/env python3
"""
Procedural High-Craft PBR Texture Generator for Kindenheim Wheat, Stubble & Straw Bale Stack.
Generates crisp, botanically realistic July/August Palatinate harvest textures optimized for WebGL GLB budgets:
  - wheat_blade_albedo.png (1024x512 RGBA indexed PNG-8 w/ alpha, full-frame lush golden wheat curtain)
  - wheat_blade_normal.jpg (512x256 RGB tangent-space normal map)
  - stubble_blade_albedo.png (1024x512 RGBA indexed PNG-8 w/ alpha, dense cut stubble + chopped straw wisps)
  - stubble_blade_normal.jpg (512x256 RGB tangent-space normal map)
  - straw_bale_albedo.jpg (768x768 RGB, rich golden wrapped barrel + cinched twine + spiral end-cap + skirt)
  - straw_bale_normal.jpg (384x384 RGB tangent-space normal map)
  - straw_bale_roughness.jpg (256x256 grayscale roughness map)
"""

import math
import os
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
OUT_DIR = os.path.join(PROJECT_ROOT, "blender/fields/wheat/textures")
os.makedirs(OUT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Shared Helpers: Value Noise, Alpha-Safe Dilation, PNG-8 Quantizer & Normals
# ---------------------------------------------------------------------------

def smooth_fbm_noise(h: int, w: int, seed: int, octaves=(16, 32, 64, 128)) -> np.ndarray:
    """Smooth tile-free multi-octave value noise in [0..1] (zero regular grid artifacts)."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), dtype=np.float32)
    amp = 1.0
    tot = 0.0
    for grid in octaves:
        gh = max(2, h // grid)
        gw = max(2, w // grid)
        coarse = rng.random((gh, gw), dtype=np.float32)
        pil = Image.fromarray((coarse * 255.0).astype(np.uint8), mode="L").resize((w, h), Image.Resampling.BICUBIC)
        acc += (np.array(pil, dtype=np.float32) / 255.0) * amp
        tot += amp
        amp *= 0.55
    return np.clip(acc / max(1e-6, tot), 0.0, 1.0)


def dilate_rgb_under_alpha(rgba: np.ndarray, fallback_rgb=(192, 152, 68), iterations=4) -> np.ndarray:
    """
    Bleed opaque stalk/ear RGB 4 pixels outward into transparent margin so mipmaps & bilinear
    filtering never produce dark halos, while keeping deep transparent sky uniform for ultra-clean
    PNG compression!
    """
    rgb = rgba[:, :, :3].astype(np.float32)
    alpha = rgba[:, :, 3]
    valid = alpha > 24

    out = rgb.copy()
    out[~valid] = np.array(fallback_rgb, dtype=np.float32)

    cur_valid = valid.copy()
    for _ in range(iterations):
        if np.all(cur_valid):
            break
        acc = np.zeros_like(out)
        cnt = np.zeros(cur_valid.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            shifted_v = np.roll(np.roll(cur_valid, dy, axis=0), dx, axis=1)
            shifted_c = np.roll(np.roll(out, dy, axis=0), dx, axis=1)
            w = 1.0 if (dy == 0 or dx == 0) else 0.7
            mask_f = shifted_v.astype(np.float32) * w
            acc += shifted_c * mask_f[:, :, None]
            cnt += mask_f
        fill_mask = (~cur_valid) & (cnt > 0.0)
        if not np.any(fill_mask):
            break
        out[fill_mask] = acc[fill_mask] / cnt[fill_mask, None]
        cur_valid[fill_mask] = True

    res = np.empty_like(rgba)
    res[:, :, :3] = np.clip(out, 0, 255).astype(np.uint8)
    res[:, :, 3] = alpha
    return res


def save_crisp_rgba_png(img_rgba: Image.Image, path: str, fallback_rgb, max_colors: int = 256):
    """
    Dilate edge RGB for mipmap safety, snap mask alpha cleanly for glTF MASK (cutoff 0.45),
    and encode as high-craft 256-color indexed RGBA PNG (universally decoded by Blender & WebGL
    while slashing GLB texture size by ~3.5x at full 1024x512 sharpness!).
    """
    arr = np.array(img_rgba)
    # Clean binary-biased alpha so fine awns survive 0.45 alphaCutoff cleanly without hazy fringes
    a = arr[:, :, 3].astype(np.float32)
    a = np.where(a >= 95.0, 255.0, np.where(a >= 42.0, 180.0, 0.0)).astype(np.uint8)
    arr[:, :, 3] = a
    arr = dilate_rgb_under_alpha(arr, fallback_rgb=fallback_rgb, iterations=3)

    img_clean = Image.fromarray(arr, mode="RGBA")
    img_q = img_clean.quantize(colors=max_colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    img_q.save(path, format="PNG", optimize=True)


def height_to_normal(height: np.ndarray, strength: float = 2.6, wrap_x: bool = True, wrap_y: bool = False) -> Image.Image:
    h = height.astype(np.float32)
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 if wrap_x else np.gradient(h, axis=1)
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 if wrap_y else np.gradient(h, axis=0)

    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    rgb = np.stack([
        np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255),
        np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255),
        np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255),
    ], axis=-1).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def lerp_rgb(c0, c1, t):
    t = max(0.0, min(1.0, t))
    return (
        int(c0[0] + (c1[0] - c0[0]) * t),
        int(c0[1] + (c1[1] - c0[1]) * t),
        int(c0[2] + (c1[2] - c0[2]) * t),
    )


def jitter_rgb(c, rng, amt=12):
    return (
        max(0, min(255, c[0] + rng.randint(-amt, amt))),
        max(0, min(255, c[1] + rng.randint(-amt, amt))),
        max(0, min(255, c[2] + rng.randint(-amt, amt))),
    )


def draw_wrapped_line(draw, x0, y0, x1, y1, color, width, W):
    for shift in (0, -W, W):
        if max(x0 + shift, x1 + shift) >= -24 and min(x0 + shift, x1 + shift) <= W + 24:
            draw.line([(x0 + shift, y0), (x1 + shift, y1)], fill=color, width=width)


def draw_wrapped_poly(draw, pts, fill, W):
    xs = [p[0] for p in pts]
    min_x, max_x = min(xs), max(xs)
    for shift in (0, -W, W):
        if max_x + shift >= -24 and min_x + shift <= W + 24:
            draw.polygon([(p[0] + shift, p[1]) for p in pts], fill=fill)


def draw_wrapped_ellipse(draw, cx, cy, rx, ry, angle_rad, fill, W, steps=8):
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)
    pts = []
    for k in range(steps):
        a = (k / steps) * 2.0 * math.pi
        lx = rx * math.cos(a)
        ly = ry * math.sin(a)
        pts.append((cx + lx * ca - ly * sa, cy + lx * sa + ly * ca))
    draw_wrapped_poly(draw, pts, fill, W)


def quad_bezier(p0, p1, p2, t):
    u = 1.0 - t
    x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
    y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    return x, y


# ---------------------------------------------------------------------------
# 1. Full-Frame Lush Palatinate Ripened Wheat Curtain (1024 x 512 RGBA)
#    Dedicated 100% to our gracefully arching nodding wheat curtains!
#    - y = 406..512 (bottom 20.7% -> Z = -0.25..0.00m): solid harvest soil & olive-tan root crown
#    - y = 210..406 (Z = 0.00..0.52m): greenish-tan lower stems, nodes & arching flag leaves
#    - y = 20..240  (Z = 0.50..0.98m): rich golden-amber ripened culms, plump braided ears & fine awns!
# ---------------------------------------------------------------------------

def paint_wheat_ear(draw_c, draw_h, bx, by, ear_len, ear_w, ear_angle, palette_scale, rng, W, h_val):
    """Botanically structured bearded wheat ear (Weizenähre) in warm Palatinate harvest gold."""
    warm = rng.uniform(-0.06, 0.08)
    # Deep rich golden-amber harvest palette (glows authentic wheat gold under bright summer sun!)
    c_shadow = tuple(max(0, min(255, int(v * palette_scale))) for v in (138 + int(warm * 75), 92, 28))
    c_mid = tuple(max(0, min(255, int(v * palette_scale))) for v in (202 + int(warm * 65), 152, 54))
    c_hi = tuple(max(0, min(255, int(v * palette_scale))) for v in (234, 198, 102))
    c_awn = tuple(max(0, min(255, int(v * min(1.06, palette_scale * 1.05)))) for v in (232, 206, 122))

    nod_dir = 1.0 if math.sin(ear_angle) >= 0 else -1.0
    dx_base = math.sin(ear_angle)
    dy_base = -math.cos(ear_angle)

    p0 = (bx, by)
    p1 = (bx + dx_base * ear_len * 0.54, max(28.0, by + dy_base * ear_len * 0.54))
    p2 = (
        bx + dx_base * ear_len + nod_dir * ear_len * 0.22,
        max(22.0, by + dy_base * ear_len + ear_len * 0.10),
    )

    n_pairs = rng.randint(10, 14)

    # Fine golden awns fanning delicately upward from glumes
    for i in range(n_pairs):
        t = (i + 0.55) / n_pairs
        px, py = quad_bezier(p0, p1, p2, t)
        tx, ty = quad_bezier(p0, p1, p2, min(1.0, t + 0.08))
        ang = math.atan2(ty - py, tx - px)
        for side in (-1, 1):
            if rng.random() < 0.80:
                awn_ang = ang + side * rng.uniform(0.14, 0.34)
                awn_len = ear_len * rng.uniform(0.30, 0.52) * (0.75 + 0.32 * t)
                ax1 = px + math.cos(awn_ang) * awn_len
                ay1 = max(4.0, py + math.sin(awn_ang) * awn_len)
                c_a = jitter_rgb(c_awn, rng, 10)
                draw_wrapped_line(draw_c, px, py, ax1, ay1, (*c_a, 240), 1, W)
                draw_wrapped_line(draw_h, px, py, ax1, ay1, int(h_val * 0.85), 1, W)

    # Tip awns crown
    tx0, ty0 = p2
    tprev_x, tprev_y = quad_bezier(p0, p1, p2, 0.85)
    tip_ang = math.atan2(ty0 - tprev_y, tx0 - tprev_x)
    for _ in range(5):
        a = tip_ang + rng.uniform(-0.30, 0.30)
        al = ear_len * rng.uniform(0.32, 0.56)
        ay1 = max(4.0, ty0 + math.sin(a) * al)
        c_a = jitter_rgb(c_awn, rng, 10)
        draw_wrapped_line(draw_c, tx0, ty0, tx0 + math.cos(a) * al, ay1, (*c_a, 245), 1, W)
        draw_wrapped_line(draw_h, tx0, ty0, tx0 + math.cos(a) * al, ay1, int(h_val * 0.90), 1, W)

    # Central rachis
    for seg in range(6):
        sa = quad_bezier(p0, p1, p2, seg / 6.0)
        sb = quad_bezier(p0, p1, p2, (seg + 1) / 6.0)
        draw_wrapped_line(draw_c, sa[0], sa[1], sb[0], sb[1], (*c_shadow, 255), max(2, int(ear_w * 0.46)), W)

    # Braided plump grain spikelets (glumes)
    for i in range(n_pairs):
        t = i / max(1, n_pairs - 1)
        px, py = quad_bezier(p0, p1, p2, t)
        nx_p, ny_p = quad_bezier(p0, p1, p2, min(1.0, t + 0.09))
        ang = math.atan2(ny_p - py, nx_p - px)
        profile = math.sin(math.pi * (0.14 + 0.78 * t))
        sp_w = ear_w * (0.44 + 0.56 * profile)
        sp_l = (ear_len / n_pairs) * 1.50

        for side in (-1, 1):
            perp_x = -math.sin(ang) * side * (sp_w * 0.44)
            perp_y = math.cos(ang) * side * (sp_w * 0.44)
            stagger_t = 0.0 if side < 0 else 0.03
            sx = px + perp_x + math.cos(ang) * stagger_t * ear_len
            sy = py + perp_y + math.sin(ang) * stagger_t * ear_len
            sp_ang = ang + side * 0.34

            c_sh = jitter_rgb(c_shadow, rng, 9)
            draw_wrapped_ellipse(draw_c, sx + 0.8, sy + 1.1, sp_l * 0.56, sp_w * 0.43, sp_ang, (*c_sh, 255), W, steps=7)
            c_m = jitter_rgb(lerp_rgb(c_mid, c_hi, 0.22 + 0.48 * t), rng, 11)
            draw_wrapped_ellipse(draw_c, sx, sy, sp_l * 0.52, sp_w * 0.38, sp_ang, (*c_m, 255), W, steps=7)
            c_h = jitter_rgb(c_hi, rng, 9)
            draw_wrapped_ellipse(
                draw_c, sx - math.sin(ang) * 0.6, sy - 0.9,
                sp_l * 0.34, sp_w * 0.21, sp_ang, (*c_h, 255), W, steps=6,
            )
            draw_wrapped_ellipse(draw_h, sx, sy, sp_l * 0.50, sp_w * 0.36, sp_ang, int(h_val), W, steps=7)


def generate_wheat_atlas():
    W, H = 1024, 512
    rng = random.Random(202607)

    img_c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    img_h = Image.new("L", (W, H), 120)
    dc = ImageDraw.Draw(img_c)
    dh = ImageDraw.Draw(img_h)

    y_soil = 406  # Matches Z = 0.00m for curtain Z in [-0.25 .. +0.96m] (0.25/1.21 = 20.7% from bottom!)

    # Smooth organic harvest-earth & olive-tan root crown skirt (y = 392..512)
    soil_n = smooth_fbm_noise(120, W, seed=101, octaves=(12, 28, 64))
    arr_skirt = np.zeros((120, W, 4), dtype=np.uint8)
    for dy in range(120):
        y = 392 + dy
        t = dy / 119.0
        c0 = np.array([124.0, 122.0, 62.0])  # muted olive-tan straw base
        c1 = np.array([92.0, 76.0, 44.0])    # warm Palatinate dry loam (-0.25m)
        base = c0 * (1.0 - t) + c1 * t
        n_mod = 0.85 + 0.30 * soil_n[dy, :, None]
        arr_skirt[dy, :, :3] = np.clip(base[None, :] * n_mod, 0, 255).astype(np.uint8)
        arr_skirt[dy, :, 3] = 255 if y >= 404 else int(255 * ((y - 392) / 12.0))
    img_c.paste(Image.fromarray(arr_skirt, mode="RGBA"), (0, 392))

    # 3 dense depth layers for lush, full wheat density with zero thin cardboard feel!
    layers = [
        # (num_stalks, palette_scale, height_val, stem_w_range, ear_len_range, top_y_range)
        (106, 0.72, 140, (2, 4), (74, 102), (96, 178)),   # Deep golden-amber shadow backdrop
        (110, 0.92, 188, (3, 4), (80, 112), (62, 146)),   # Lush mid golden wheat
        (82,  1.06, 234, (3, 5), (86, 118), (44, 122)),   # Sunlit foreground nodding ears
    ]

    for layer_idx, (n_stalks, p_scale, h_val, sw_rng, el_rng, ty_rng) in enumerate(layers):
        for i in range(n_stalks):
            bx = ((i + rng.uniform(0.08, 0.92)) / n_stalks) * W
            by = rng.uniform(y_soil + 24, H - 6)

            top_y = rng.uniform(ty_rng[0], ty_rng[1])
            ear_len = rng.uniform(el_rng[0], el_rng[1])
            ear_base_y = top_y + ear_len * 0.85

            lean = rng.uniform(-24.0, 44.0)  # Cohesive summer breeze sway
            mid_bend = rng.uniform(-14.0, 18.0)

            p0 = (bx, by)
            p1 = (bx + lean * 0.44 + mid_bend, (by + ear_base_y) * 0.5)
            p2 = (bx + lean, ear_base_y)
            stem_w = rng.randint(sw_rng[0], sw_rng[1])

            # Authentic botanical gradient: greenish-tan lower stems -> rich golden-amber upper stalks!
            c_lower = tuple(int(v * p_scale) for v in (116, 126, 58))
            c_mid = tuple(int(v * p_scale) for v in (176, 152, 66))
            c_upper = tuple(int(v * p_scale) for v in (212, 174, 74))

            segs = 10
            prev = p0
            for s in range(1, segs + 1):
                t = s / segs
                cur = quad_bezier(p0, p1, p2, t)
                col = lerp_rgb(c_lower, c_mid, t / 0.48) if t < 0.48 else lerp_rgb(c_mid, c_upper, (t - 0.48) / 0.52)
                col = jitter_rgb(col, rng, 8)
                w_cur = max(2, int(round(stem_w * (1.0 - 0.25 * t))))
                draw_wrapped_line(dc, prev[0], prev[1], cur[0], cur[1], (*col, 255), w_cur, W)
                draw_wrapped_line(dh, prev[0], prev[1], cur[0], cur[1], int(h_val * (0.72 + 0.2 * t)), w_cur, W)
                if s in (4, 7):
                    c_node = tuple(int(v * 0.76) for v in col)
                    draw_wrapped_ellipse(dc, cur[0], cur[1], w_cur * 0.9, w_cur * 0.5, 0.0, (*c_node, 255), W, steps=5)
                prev = cur

            # Arching slender greenish-tan to straw-gold flag leaves
            for _lf in range(2 if layer_idx > 0 else 1):
                if rng.random() < 0.88:
                    lt = rng.uniform(0.24, 0.74)
                    lx0, ly0 = quad_bezier(p0, p1, p2, lt)
                    side = rng.choice((-1.0, 1.0))
                    l_len = rng.uniform(48.0, 102.0)
                    lp1 = (lx0 + side * l_len * 0.52, ly0 - rng.uniform(16.0, 36.0))
                    lp2 = (lx0 + side * l_len, ly0 + rng.uniform(8.0, 36.0))
                    lf_base = lerp_rgb((124, 132, 62), (184, 156, 68), lt)
                    c_lf = jitter_rgb(tuple(int(v * p_scale) for v in lf_base), rng, 10)
                    l_prev = (lx0, ly0)
                    for ls in range(1, 7):
                        lt2 = ls / 6.0
                        l_cur = quad_bezier((lx0, ly0), lp1, lp2, lt2)
                        lw = max(1, int(round(4.0 * (1.0 - 0.72 * lt2))))
                        draw_wrapped_line(dc, l_prev[0], l_prev[1], l_cur[0], l_cur[1], (*c_lf, 250), lw, W)
                        draw_wrapped_line(dh, l_prev[0], l_prev[1], l_cur[0], l_cur[1], int(h_val * 0.82), lw, W)
                        l_prev = l_cur

            p_near = quad_bezier(p0, p1, p2, 0.86)
            ear_ang = math.atan2(p2[0] - p_near[0], p_near[1] - p2[1]) + rng.uniform(-0.20, 0.28)
            ear_w = rng.uniform(13.0, 17.5) * (0.88 + 0.14 * layer_idx)
            paint_wheat_ear(dc, dh, p2[0], p2[1], ear_len, ear_w, ear_ang, p_scale, rng, W, h_val)

    # Dense lower greenish-tan / straw undergrowth wisps near soil line
    for _ in range(240):
        x0 = rng.uniform(0, W)
        y0 = rng.uniform(346, 424)
        ang = rng.uniform(-0.92, 0.92)
        ln = rng.uniform(24, 68)
        col = jitter_rgb((128, 126, 62), rng, 14)
        draw_wrapped_line(dc, x0, y0, x0 + math.sin(ang) * ln, y0 - math.cos(ang) * ln, (*col, 250), rng.randint(2, 3), W)

    albedo_path = os.path.join(OUT_DIR, "wheat_blade_albedo.png")
    save_crisp_rgba_png(img_c, albedo_path, fallback_rgb=(196, 156, 68), max_colors=256)

    h_small = img_h.resize((512, 256), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(radius=0.5))
    norm_img = height_to_normal(np.array(h_small, dtype=np.float32) / 255.0, strength=2.9, wrap_x=True, wrap_y=False)
    norm_path = os.path.join(OUT_DIR, "wheat_blade_normal.jpg")
    norm_img.save(norm_path, quality=85)
    print(f"Generated wheat atlas: albedo ({os.path.getsize(albedo_path)/1024:.1f} KB, 1024x512), normal ({os.path.getsize(norm_path)/1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 2. Freshly Harvested Golden Stubble + Chopped Straw Atlas (1024 x 512 RGBA)
#    - Band A (Bottom y=256..512): dense combine-cut golden stalks + splayed base straw + -0.20m skirt
#    - Band B (Top y=8..236): organic scattered chopped straw wisps & swath litter
# ---------------------------------------------------------------------------

def generate_stubble_atlas():
    W, H = 1024, 512
    rng = random.Random(202608)

    img_c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    img_h = Image.new("L", (W, H), 120)
    dc = ImageDraw.Draw(img_c)
    dh = ImageDraw.Draw(img_h)

    y_soil = 414
    soil_n = smooth_fbm_noise(112, W, seed=202, octaves=(12, 28, 64))
    arr_skirt = np.zeros((112, W, 4), dtype=np.uint8)
    for dy in range(112):
        y = 400 + dy
        t = dy / 111.0
        c0 = np.array([154.0, 128.0, 72.0])
        c1 = np.array([98.0, 78.0, 46.0])
        base = c0 * (1.0 - t) + c1 * t
        n_mod = 0.86 + 0.28 * soil_n[dy, :, None]
        arr_skirt[dy, :, :3] = np.clip(base[None, :] * n_mod, 0, 255).astype(np.uint8)
        arr_skirt[dy, :, 3] = 255 if y >= 412 else int(255 * ((y - 400) / 12.0))
    img_c.paste(Image.fromarray(arr_skirt, mode="RGBA"), (0, 400))

    # Rich golden-straw freshly combined stalks (3 depth layers, varied natural heights & splay)
    layers = [
        (132, 0.74, 146, (3, 4), (294, 342)),
        (136, 0.93, 194, (3, 5), (276, 326)),
        (104, 1.06, 236, (4, 6), (266, 316)),
    ]
    for p_idx, (n_stems, p_scale, h_v, sw_rng, cut_y_rng) in enumerate(layers):
        for i in range(n_stems):
            bx = ((i + rng.uniform(0.08, 0.92)) / n_stems) * W
            by = rng.uniform(y_soil + 20, H - 6)
            cut_y = rng.uniform(cut_y_rng[0], cut_y_rng[1])
            splay = rng.uniform(-24.0, 24.0)
            sw = rng.randint(sw_rng[0], sw_rng[1])

            c_bot = tuple(int(v * p_scale) for v in (144, 122, 62))
            c_top = tuple(int(v * p_scale) for v in (212, 180, 96))
            c_hi = tuple(int(v * min(1.06, p_scale * 1.06)) for v in (236, 212, 132))
            c_hole = tuple(int(v * p_scale) for v in (94, 70, 28))

            tx, ty = bx + splay, cut_y
            segs = 5
            for s in range(segs):
                t0, t1 = s / segs, (s + 1) / segs
                x0, y0 = bx + splay * t0, by + (ty - by) * t0
                x1, y1 = bx + splay * t1, by + (ty - by) * t1
                col = jitter_rgb(lerp_rgb(c_bot, c_top, t1), rng, 9)
                draw_wrapped_line(dc, x0, y0, x1, y1, (*col, 255), sw, W)
                draw_wrapped_line(dh, x0, y0, x1, y1, h_v, sw, W)
                if sw >= 4:
                    draw_wrapped_line(dc, x0 - 1, y0, x1 - 1, y1, (*c_hi, 235), 1, W)

            ang_cut = rng.uniform(-0.38, 0.38)
            draw_wrapped_ellipse(dc, tx, ty, sw * 0.65, sw * 0.36, ang_cut, (*c_hi, 255), W, steps=6)
            draw_wrapped_ellipse(dc, tx, ty + 0.5, sw * 0.36, sw * 0.18, ang_cut, (*c_hole, 255), W, steps=5)

    # Splayed/bent broken stalks & loose tangled golden straw across cut base
    for _ in range(210):
        x0 = rng.uniform(0, W)
        y0 = rng.uniform(344, 424)
        ang = rng.uniform(-0.48, 0.48)
        ln = rng.uniform(32, 88)
        col = jitter_rgb((212, 180, 96), rng, 15)
        draw_wrapped_line(dc, x0, y0, x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln, (*col, 250), rng.randint(2, 3), W)
        draw_wrapped_line(dh, x0, y0, x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln, 210, 2, W)

    # BAND B (Top): Scattered loose chopped straw wisps & swath litter (y = 8 .. 234)
    # Natural sparse-edged scatter so overlapping ground cards blend invisibly!
    for pass_idx, (count, col_base, h_v, w_rng) in enumerate([
        (320, (162, 132, 64), 152, (2, 4)),
        (420, (210, 178, 92), 198, (2, 4)),
        (260, (236, 210, 128), 238, (2, 3)),
    ]):
        for _ in range(count):
            # Soft radial falloff so edges feather organically with zero rectangle outline!
            u = 0.5 + rng.gauss(0.0, 0.22)
            v = 0.5 + rng.gauss(0.0, 0.22)
            if u < 0.04 or u > 0.96 or v < 0.07 or v > 0.93:
                continue
            cx = u * W
            cy = 8 + v * 224
            ang = rng.uniform(0.0, math.pi)
            ln = rng.uniform(28, 88)
            dx, dy = math.cos(ang) * ln * 0.5, math.sin(ang) * ln * 0.5
            w = rng.randint(w_rng[0], w_rng[1])
            col = jitter_rgb(col_base, rng, 14)
            if pass_idx > 0:
                dc.line([(cx - dx + 1, cy - dy + 2), (cx + dx + 1, cy + dy + 2)], fill=(112, 86, 38, 220), width=w)
            dc.line([(cx - dx, cy - dy), (cx + dx, cy + dy)], fill=(*col, 255), width=w)
            dh.line([(cx - dx, cy - dy), (cx + dx, cy + dy)], fill=h_v, width=w)

    dc.rectangle([(0, 238), (W, 258)], fill=(0, 0, 0, 0))

    albedo_path = os.path.join(OUT_DIR, "stubble_blade_albedo.png")
    save_crisp_rgba_png(img_c, albedo_path, fallback_rgb=(196, 166, 86), max_colors=256)

    h_small = img_h.resize((384, 192), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(radius=0.5))
    norm_img = height_to_normal(np.array(h_small, dtype=np.float32) / 255.0, strength=2.6, wrap_x=True, wrap_y=False)
    norm_path = os.path.join(OUT_DIR, "stubble_blade_normal.jpg")
    norm_img.save(norm_path, quality=85)
    print(f"Generated stubble atlas: albedo ({os.path.getsize(albedo_path)/1024:.1f} KB, 1024x512), normal ({os.path.getsize(norm_path)/1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 3. Round Straw Bale Stack PBR Atlas (Rich Golden Harvest Palette)
#    768x768 Albedo JPG + 384x384 Normal JPG + 256x256 Roughness JPG
# ---------------------------------------------------------------------------

def generate_straw_bale_atlas():
    S = 1024
    rng = random.Random(202609)

    albedo = np.zeros((S, S, 3), dtype=np.float32)
    height = np.full((S, S), 0.5, dtype=np.float32)
    rough = np.full((S, S), 0.90, dtype=np.float32)
    albedo[:, :] = np.array([194.0, 152.0, 66.0], dtype=np.float32)

    # REGION 1: Cylindrical Barrel Wrap (x in [0..512), y in [0..1024), tileable in Y)
    bw = 512
    yy, xx = np.mgrid[0:S, 0:bw].astype(np.float32)

    twine_xs = [86.0, 198.0, 310.0, 422.0]
    cinch = np.zeros((S, bw), dtype=np.float32)
    for tx in twine_xs:
        d = np.abs(xx - tx)
        cinch += np.exp(-(d * d) / (2.0 * 9.5 * 9.5))
    cinch = np.clip(cinch, 0.0, 1.0)

    ang_y = (yy / S) * 2.0 * math.pi
    base_var = (
        0.5
        + 0.16 * np.sin(xx * 0.065 + np.sin(ang_y * 3.0) * 1.2)
        + 0.14 * np.sin(xx * 0.21 - np.cos(ang_y * 5.0) * 1.4)
        + 0.10 * np.cos(ang_y * 8.0 + xx * 0.04)
    )
    shade = np.clip(0.84 + 0.28 * base_var - 0.25 * cinch, 0.48, 1.15)
    albedo[:, :bw, 0] = np.clip(202.0 * shade, 0, 255)
    albedo[:, :bw, 1] = np.clip(158.0 * shade, 0, 255)
    albedo[:, :bw, 2] = np.clip(68.0 * shade, 0, 255)
    height[:, :bw] = np.clip(0.56 + 0.12 * base_var - 0.30 * cinch, 0.0, 1.0)
    rough[:, :bw] = np.clip(0.88 + 0.08 * cinch - 0.06 * base_var, 0.72, 0.98)

    img_b = Image.fromarray(albedo[:, :bw].astype(np.uint8), mode="RGB")
    img_bh = Image.fromarray((height[:, :bw] * 255).astype(np.uint8), mode="L")
    img_br = Image.fromarray((rough[:, :bw] * 255).astype(np.uint8), mode="L")
    db = ImageDraw.Draw(img_b)
    dbh = ImageDraw.Draw(img_bh)
    dbr = ImageDraw.Draw(img_br)

    # Rich sunlit Palatinate harvest gold straw fiber tones
    straw_tones = [
        ((134, 96, 34), 92, 246),
        ((172, 132, 50), 135, 232),
        ((204, 162, 68), 178, 218),
        ((226, 190, 96), 218, 204),
        ((240, 212, 128), 242, 192),
    ]
    for pass_i, (n_str, tone_idx) in enumerate([(720, 0), (820, 1), (880, 2), (660, 3), (320, 4)]):
        base_c, hv, rv = straw_tones[tone_idx]
        for _ in range(n_str):
            x0 = rng.uniform(0, bw)
            y0 = rng.uniform(0, S)
            ln = rng.uniform(44, 165)
            drift = rng.uniform(-16.0, 16.0)
            w = rng.randint(1, 3) if pass_i < 4 else rng.randint(1, 2)
            col = jitter_rgb(base_c, rng, 13)
            for y_shift in (0, -S, S):
                ya, yb = y0 + y_shift, y0 + ln + y_shift
                if yb >= -10 and ya <= S + 10:
                    db.line([(x0, ya), (x0 + drift, yb)], fill=col, width=w)
                    dbh.line([(x0, ya), (x0 + drift, yb)], fill=hv, width=w)
                    dbr.line([(x0, ya), (x0 + drift, yb)], fill=rv, width=w)

    # 4 crisp cinched natural cream/sisal baler twine straps
    for tx in twine_xs:
        itx = int(tx)
        db.line([(itx + 2, 0), (itx + 2, S)], fill=(96, 70, 26), width=5)
        db.line([(itx - 2, 0), (itx - 2, S)], fill=(110, 82, 32), width=3)
        for off in (-1, 1):
            for y in range(0, S, 6):
                c_tw = jitter_rgb((222, 206, 162), rng, 9)
                db.line([(itx + off, y), (itx + off, y + 5)], fill=c_tw, width=2)
                dbh.line([(itx + off, y), (itx + off, y + 5)], fill=232, width=2)
                dbr.line([(itx + off, y), (itx + off, y + 5)], fill=222, width=2)

    albedo[:, :bw] = np.array(img_b, dtype=np.float32)
    height[:, :bw] = np.array(img_bh, dtype=np.float32) / 255.0
    rough[:, :bw] = np.array(img_br, dtype=np.float32) / 255.0

    # REGION 2: Spiral-Wound Round Bale End-Cap (Right-top: x=512..1024, y=0..512)
    cx, cy = 768.0, 256.0
    ey, ex = np.mgrid[0:512, 512:1024].astype(np.float32)
    dx, dy = ex - cx, ey - cy
    rr = np.sqrt(dx * dx + dy * dy)
    theta = np.arctan2(dy, dx)

    wobble = (
        4.5 * np.sin(theta * 3.0 + rr * 0.03)
        + 3.0 * np.cos(theta * 5.0 - rr * 0.05)
        + 2.2 * np.sin(theta * 9.0 + rr * 0.09)
    )
    r_eff = rr + wobble
    spiral_freq = (2.0 * math.pi) / 36.0
    spiral_arg = r_eff * spiral_freq - theta
    spiral_wave = np.sin(spiral_arg)
    seam = np.power(np.clip(0.5 - 0.5 * spiral_wave, 0.0, 1.0), 2.3)
    fine_rings = 0.5 + 0.5 * np.sin(r_eff * spiral_freq * 3.0 - theta * 3.0 + 1.4 * np.sin(theta * 7.0))

    core_dark = 0.18 * np.exp(-(rr * rr) / (2.0 * 32.0 * 32.0))
    rim_shade = 0.09 * np.clip((rr - 188.0) / 62.0, 0.0, 1.0)
    end_shade = np.clip(0.96 - 0.46 * seam + 0.12 * fine_rings - core_dark - rim_shade, 0.34, 1.15)

    albedo[:512, 512:, 0] = np.clip(208.0 * end_shade, 0, 255)
    albedo[:512, 512:, 1] = np.clip(164.0 * end_shade, 0, 255)
    albedo[:512, 512:, 2] = np.clip(72.0 * end_shade, 0, 255)
    height[:512, 512:] = np.clip(0.62 - 0.46 * seam + 0.10 * fine_rings, 0.0, 1.0)
    rough[:512, 512:] = np.clip(0.86 + 0.11 * seam - 0.04 * fine_rings, 0.74, 0.98)

    img_e = Image.fromarray(albedo[:512, 512:].astype(np.uint8), mode="RGB")
    img_eh = Image.fromarray((height[:512, 512:] * 255).astype(np.uint8), mode="L")
    img_er = Image.fromarray((rough[:512, 512:] * 255).astype(np.uint8), mode="L")
    de = ImageDraw.Draw(img_e)
    deh = ImageDraw.Draw(img_eh)
    der = ImageDraw.Draw(img_er)

    lcx, lcy = 256.0, 256.0
    for pass_i, (n_str, tone_idx) in enumerate([(440, 0), (640, 1), (700, 2), (520, 3), (260, 4)]):
        base_c, hv, rv = straw_tones[tone_idx]
        for _ in range(n_str):
            rad = rng.uniform(5.0, 252.0)
            a0 = rng.uniform(0.0, 2.0 * math.pi)
            arc_len = rng.uniform(16.0, 58.0)
            d_ang = arc_len / max(18.0, rad)
            a1 = a0 + d_ang * rng.choice((-1.0, 1.0))
            rad1 = rad + rng.uniform(-5.5, 5.5)
            am = (a0 + a1) * 0.5
            rm = (rad + rad1) * 0.5 + rng.uniform(-2.0, 2.0)
            pts = [
                (lcx + math.cos(a0) * rad, lcy + math.sin(a0) * rad),
                (lcx + math.cos(am) * rm, lcy + math.sin(am) * rm),
                (lcx + math.cos(a1) * rad1, lcy + math.sin(a1) * rad1),
            ]
            w = rng.randint(1, 3) if pass_i < 4 else 1
            col = jitter_rgb(base_c, rng, 14)
            de.line(pts, fill=col, width=w)
            deh.line(pts, fill=hv, width=w)
            der.line(pts, fill=rv, width=w)

    for _ in range(260):
        rad = rng.uniform(4.0, 238.0)
        a = rng.uniform(0.0, 2.0 * math.pi)
        px = lcx + math.cos(a) * rad
        py = lcy + math.sin(a) * rad
        col = jitter_rgb((132, 96, 38) if rng.random() < 0.50 else (232, 202, 114), rng, 12)
        r_dot = rng.uniform(0.8, 1.5)
        de.ellipse([px - r_dot, py - r_dot, px + r_dot, py + r_dot], fill=col)

    albedo[:512, 512:] = np.array(img_e, dtype=np.float32)
    height[:512, 512:] = np.array(img_eh, dtype=np.float32) / 255.0
    rough[:512, 512:] = np.array(img_er, dtype=np.float32) / 255.0

    # REGION 3: Settled Straw-and-Earth Base Skirt (Right-bottom: x=512..1024, y=512..1024)
    soil_n = smooth_fbm_noise(512, 512, seed=303, octaves=(12, 28, 64, 128))
    t_depth = np.linspace(0.0, 1.0, 512, dtype=np.float32)[:, None]
    top_col = np.array([186.0, 148.0, 66.0])
    bot_col = np.array([94.0, 74.0, 44.0])
    for ch in range(3):
        c_grad = top_col[ch] * (1.0 - t_depth) + bot_col[ch] * t_depth
        albedo[512:, 512:, ch] = np.clip(c_grad * (0.82 + 0.34 * soil_n), 0, 255)
    height[512:, 512:] = np.clip(0.45 + 0.22 * soil_n, 0.0, 1.0)
    rough[512:, 512:] = np.clip(0.91 + 0.07 * t_depth, 0.85, 0.99)

    img_s = Image.fromarray(albedo[512:, 512:].astype(np.uint8), mode="RGB")
    img_sh = Image.fromarray((height[512:, 512:] * 255).astype(np.uint8), mode="L")
    ds = ImageDraw.Draw(img_s)
    dsh = ImageDraw.Draw(img_sh)
    for _ in range(1100):
        px = rng.uniform(0, 512)
        py = rng.uniform(0, 385)
        if rng.random() > (1.0 - (py / 415.0) ** 1.35):
            continue
        ang = rng.uniform(-0.55, 0.55)
        ln = rng.uniform(18, 64)
        col = jitter_rgb((206, 170, 78) if rng.random() < 0.72 else (154, 122, 52), rng, 15)
        ds.line([(px, py), (px + math.cos(ang) * ln, py + math.sin(ang) * ln)], fill=col, width=rng.randint(1, 3))
        dsh.line([(px, py), (px + math.cos(ang) * ln, py + math.sin(ang) * ln)], fill=198, width=2)

    albedo[512:, 512:] = np.array(img_s, dtype=np.float32)
    height[512:, 512:] = np.array(img_sh, dtype=np.float32) / 255.0

    albedo_img = Image.fromarray(np.clip(albedo, 0, 255).astype(np.uint8), mode="RGB").resize((768, 768), Image.Resampling.LANCZOS)
    albedo_path = os.path.join(OUT_DIR, "straw_bale_albedo.jpg")
    albedo_img.save(albedo_path, quality=84)

    h_384 = Image.fromarray(np.clip(height * 255.0, 0, 255).astype(np.uint8), mode="L").resize((384, 384), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(radius=0.5))
    norm_img = height_to_normal(np.array(h_384, dtype=np.float32) / 255.0, strength=3.1, wrap_x=False, wrap_y=False)
    norm_path = os.path.join(OUT_DIR, "straw_bale_normal.jpg")
    norm_img.save(norm_path, quality=86)

    r_256 = Image.fromarray(np.clip(rough * 255.0, 0, 255).astype(np.uint8), mode="L").resize((256, 256), Image.Resampling.BILINEAR)
    rough_path = os.path.join(OUT_DIR, "straw_bale_roughness.jpg")
    r_256.save(rough_path, quality=85)

    print(
        f"Generated straw bale PBR: albedo ({os.path.getsize(albedo_path)/1024:.1f} KB, 768x768), "
        f"normal ({os.path.getsize(norm_path)/1024:.1f} KB, 384x384), "
        f"roughness ({os.path.getsize(rough_path)/1024:.1f} KB, 256x256)"
    )


if __name__ == "__main__":
    generate_wheat_atlas()
    generate_stubble_atlas()
    generate_straw_bale_atlas()
    print("All v2 high-craft wheat/stubble/bale textures generated successfully!")
