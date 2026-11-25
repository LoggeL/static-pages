#!/usr/bin/env python3
"""
Procedural Botanical PBR Texture Atlas Generator for Vorderpfalz Sugar Beets
(Zuckerrüben / Beta vulgaris) — Kindenheim 3D.

Renders internally at 1024x1024 (2x supersampled) for razor-crisp botanical leaf
anatomy, then downsamples cleanly to compact web-ready power-of-two textures in
blender/fields/sugarbeet/textures/:
  - sugarbeet_atlas_albedo.png  (512x512 RGBA, crisp alpha mask + edge-dilated green bleed)
  - sugarbeet_atlas_normal.png  (256x256 RGB, crinkled bullate leaves, raised midribs, loam clods)
  - sugarbeet_atlas_orm.png     (128x128 RGB, R=AO, G=Roughness [glossy leaves vs matte soil], B=0)

Atlas UV Layout (internal 1024x1024 coords -> normalized U, V where Blender V=1 is PIL y=0):
  Band 1  [y:   0.. 360] (V: 0.6484..1.0000, U: 0.0000..1.0000 seamless) : Top-down 6-rosette canopy row
  Band 2  [y: 368.. 716] (V: 0.3008..0.6406, U: 0.0000..1.0000 seamless) : Side-profile 6-rosette wall + skirt
  Band 3A [y: 724..1024, x:   0.. 420] (V: 0.0000..0.2930, U: 0.0000..0.4102 seamless) : Dark Palatinate loam
  Band 3B [y: 724..1024, x: 428.. 724] (V: 0.0000..0.2930, U: 0.4180..0.7070) : Standalone rosette clump A
  Band 3C [y: 724..1024, x: 728..1024] (V: 0.0000..0.2930, U: 0.7109..1.0000) : Standalone rosette clump B
"""

import math
import os
import numpy as np
from PIL import Image

OUT_DIR = "/Users/logge/Documents/Projects/kindenheim-3d/blender/fields/sugarbeet/textures"
os.makedirs(OUT_DIR, exist_ok=True)

W, H = 1024, 1024  # 2x supersampled painting canvas


# ---------------------------------------------------------------------------
# Fast Vectorized Noise & Edge-Bleed Helpers
# ---------------------------------------------------------------------------

def tileable_value_noise(h: int, w: int, freq_y: int, freq_x: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    grid = rng.random((freq_y, freq_x), dtype=np.float32)
    yy = np.linspace(0, freq_y, h, endpoint=False, dtype=np.float32)
    xx = np.linspace(0, freq_x, w, endpoint=False, dtype=np.float32)
    y0 = np.floor(yy).astype(np.int32) % freq_y
    x0 = np.floor(xx).astype(np.int32) % freq_x
    y1 = (y0 + 1) % freq_y
    x1 = (x0 + 1) % freq_x
    fy = yy - np.floor(yy)
    fx = xx - np.floor(xx)
    sy = fy * fy * (3.0 - 2.0 * fy)
    sx = fx * fx * (3.0 - 2.0 * fx)
    c00 = grid[y0[:, None], x0[None, :]]
    c10 = grid[y0[:, None], x1[None, :]]
    c01 = grid[y1[:, None], x0[None, :]]
    c11 = grid[y1[:, None], x1[None, :]]
    top = c00 * (1.0 - sx[None, :]) + c10 * sx[None, :]
    bot = c01 * (1.0 - sx[None, :]) + c11 * sx[None, :]
    return top * (1.0 - sy[:, None]) + bot * sy[:, None]


def tileable_fbm(h: int, w: int, octaves, seed: int) -> np.ndarray:
    acc = np.zeros((h, w), dtype=np.float32)
    total = 0.0
    for i, (fy, fx, amp) in enumerate(octaves):
        acc += tileable_value_noise(h, w, fy, fx, seed + i * 97) * amp
        total += amp
    return acc / max(total, 1e-6)


def dilate_rgb_into_transparent(rgba: np.ndarray, iterations: int = 12) -> np.ndarray:
    """Propagate leaf RGB colors into alpha==0 pixels to prevent dark WebGL mipmap fringes."""
    out = rgba.copy().astype(np.float32)
    rgb = out[:, :, :3]
    mask = out[:, :, 3] > 20.0

    for _ in range(iterations):
        if mask.all():
            break
        acc_rgb = np.zeros_like(rgb)
        acc_w = np.zeros((rgb.shape[0], rgb.shape[1]), dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            s_mask = np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
            s_rgb = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            w = s_mask.astype(np.float32) * (1.0 if (dy == 0 or dx == 0) else 0.7)
            acc_rgb += s_rgb * w[:, :, None]
            acc_w += w
        fill = (~mask) & (acc_w > 0.0)
        rgb[fill] = acc_rgb[fill] / acc_w[fill, None]
        mask = mask | fill

    if not mask.all():
        rgb[~mask] = np.array([58.0, 102.0, 38.0], dtype=np.float32)
    out[:, :, :3] = np.clip(rgb, 0.0, 255.0)
    return out.astype(np.uint8)


def height_to_normal(height: np.ndarray, strength: float = 3.2) -> np.ndarray:
    """Convert scalar heightfield [0..1] to OpenGL tangent-space normal map (uint8 RGB)."""
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    gy = np.zeros_like(height)
    gy[1:-1, :] = (height[2:, :] - height[:-2, :]) * 0.5 * strength
    nz = np.ones_like(height, dtype=np.float32)
    nx = -gx
    ny = gy
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len
    out = np.zeros((height.shape[0], height.shape[1], 3), dtype=np.uint8)
    out[:, :, 0] = np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    out[:, :, 1] = np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    out[:, :, 2] = np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    return out


# ---------------------------------------------------------------------------
# Authentic Botanical Sugar Beet Leaf Painter (Broad Rounded Savoyed Blades!)
# ---------------------------------------------------------------------------

def stamp_beet_leaf(
    canvas_rgb: np.ndarray,
    canvas_a: np.ndarray,
    canvas_h: np.ndarray,
    canvas_r: np.ndarray,
    canvas_ao: np.ndarray,
    base_x: float,
    base_y: float,
    length: float,
    width: float,
    angle: float,
    base_col: tuple,
    vein_col: tuple,
    rough_base: float,
    sun_boost: float,
    crinkle_phase: float,
    arch_curve: float = 0.0,
    wrap_width: int = 0,
    y_clip: tuple = (0, H),
    x_clip: tuple = None,
    layer_h_offset: float = 0.35,
):
    """
    Paint a botanically accurate Beta vulgaris (Zuckerrübe) leaf:
      - Stout fleshy winged petiole (Blattstiel) at t in [0.00..0.24]
      - Broad oblong-ovate / spoon-shaped blade with OBTUSE ROUNDED tip (NO spiky tips!)
      - Undulating wavy ruffled margins & pillowy bullate/savoyed surface
      - Bold pale celadon central midrib & graceful arching pinnate lateral veins
      - Glossy waxy sun-dappled specular highlights + deep shadow margin modulation
    """
    H_c, W_c = canvas_a.shape
    pad = int(max(length, width) * 1.45) + 8
    x_min = int(math.floor(base_x - pad))
    x_max = int(math.ceil(base_x + pad))
    y_min = max(y_clip[0], int(math.floor(base_y - pad)))
    y_max = min(y_clip[1], int(math.ceil(base_y + pad)))
    if x_clip is not None:
        x_min = max(x_clip[0], x_min)
        x_max = min(x_clip[1], x_max)
    elif wrap_width == 0:
        x_min = max(0, x_min)
        x_max = min(W_c, x_max)

    if y_max <= y_min or x_max <= x_min:
        return

    ys = np.arange(y_min, y_max, dtype=np.float32)[:, None]
    xs = np.arange(x_min, x_max, dtype=np.float32)[None, :]

    dx = xs - base_x
    dy = ys - base_y
    ca = math.cos(angle)
    sa = math.sin(angle)
    u = dx * ca + dy * sa
    v = -dx * sa + dy * ca

    t = u / max(length, 1e-4)
    # Graceful outward arch of the leaf midrib
    v_bent = v - arch_curve * width * (t * t)

    t_c = np.clip(t, 0.0, 1.0)
    # Fleshy basal petiole
    petiole_w = 0.13 + 0.05 * (1.0 - t_c)

    # Broad spoon/heart-oblong Beta vulgaris silhouette:
    # Expands cleanly out of petiole at t=0.16, stays wide through t=0.45..0.82,
    # then rounds off softly with a broad obtuse semicircle at t=1.0!
    tb = np.clip((t_c - 0.14) / 0.86, 0.0, 1.0)
    # Asymmetric rounded paddle curve: sqrt-like rounding at tip (tb -> 1) prevents sharp spikes!
    base_flare = np.clip(tb / 0.32, 0.0, 1.0) ** 0.65
    tip_round = np.sqrt(np.clip(1.0 - np.maximum(0.0, (tb - 0.56) / 0.44) ** 2.1, 0.0, 1.0))
    blade_env = base_flare * tip_round * (0.90 + 0.16 * np.sin(tb * math.pi))

    # Characteristic undulating/wavy leaf edge ruffles (dampened near very tip so tip stays rounded)
    ruffle_amp = np.maximum(0.0, np.sin(tb * math.pi)) ** 0.7
    ruffle = 1.0 + ruffle_amp * (
        0.105 * np.sin(tb * 18.0 + crinkle_phase)
        + 0.055 * np.sin(tb * 31.0 - crinkle_phase * 1.4)
    )
    half_w = width * 0.5 * np.maximum(petiole_w * (1.0 - np.clip((t_c - 0.85) * 7.0, 0.0, 1.0)), blade_env * ruffle)

    s = v_bent / np.maximum(half_w, 1.0)
    in_leaf = (t >= 0.0) & (t <= 1.005) & (np.abs(s) <= 1.0)
    if not np.any(in_leaf):
        return

    # Crisp smooth anti-aliased silhouette edge
    edge_dist = (1.0 - np.abs(s)) * half_w
    tip_dist = np.minimum(t, 1.005 - t) * length
    aa = np.clip(np.minimum(edge_dist, tip_dist) * 0.70, 0.0, 1.0)
    mask = aa > 0.08
    if not np.any(mask):
        return

    # Botanical venation:
    # 1. Bold pale celadon central midrib (thick at petiole, tapering gracefully to t=0.88)
    midrib_w = np.maximum(0.045, 0.21 * (1.0 - t_c * 0.78))
    midrib = np.exp(-((np.abs(s) / midrib_w) ** 2.2)) * np.clip(1.0 - np.maximum(0.0, t_c - 0.84) * 6.5, 0.0, 1.0)
    petiole_mask = np.clip((0.23 - t_c) / 0.12, 0.0, 1.0)

    # 2. Arching pinnate lateral veins curving toward the wavy rounded margins
    vein_coord = (tb * 6.4 - (np.abs(s) ** 1.15) * 1.25 - (np.abs(s) ** 2.2) * 0.45) * math.pi
    lat_vein = (np.abs(np.cos(vein_coord)) ** 15.0) * np.clip((t_c - 0.17) * 5.5, 0.0, 1.0) * (1.0 - np.abs(s) * 0.50)

    # 3. Savoyed / bullate pillowy leaf texture between lateral veins
    bullate = (np.sin(vein_coord) ** 2) * (1.0 - 0.72 * (s * s)) * np.clip((t_c - 0.16) * 4.5, 0.0, 1.0)
    micro_crinkle = (
        0.55 * np.sin(tb * 26.0 + s * 7.5 + crinkle_phase)
        + 0.45 * np.cos(tb * 19.0 - s * 10.5 + crinkle_phase * 0.7)
    ) * (1.0 - np.abs(s) * 0.35) * np.clip((t_c - 0.16) * 4.5, 0.0, 1.0)

    # 4. Rich 3D cupped leaf shading + waxy sunlit dapple highlights
    cup_shade = 0.85 + 0.19 * (1.0 - (s * s)) + 0.08 * s
    # Natural arched light: brightest along the broad upper arch (t ~ 0.55..0.85), softly rolling down at tip
    arch_sun = (0.74 + 0.38 * np.sin(np.clip(t_c, 0.0, 1.0) * 0.78 * math.pi)) * sun_boost
    crinkle_light = 1.0 + 0.15 * bullate + 0.075 * micro_crinkle
    spec_dapple = np.clip(bullate * (0.45 + 0.55 * micro_crinkle) * np.sin(tb * math.pi), 0.0, 1.0) ** 2.0
    margin_dark = 1.0 - 0.18 * (np.abs(s) ** 3.8)

    light_mult = np.clip(cup_shade * arch_sun * crinkle_light * margin_dark, 0.42, 1.36)

    # Soft realistic vein blend (crisp yet naturally integrated into the glossy blade)
    vein_blend = np.clip(np.maximum(midrib * 0.84, np.maximum(lat_vein * 0.54, petiole_mask * 0.80)), 0.0, 0.90)
    col_r = (base_col[0] * (1.0 - vein_blend) + vein_col[0] * vein_blend) * light_mult + spec_dapple * 22.0
    col_g = (base_col[1] * (1.0 - vein_blend) + vein_col[1] * vein_blend) * light_mult + spec_dapple * 30.0
    col_b = (base_col[2] * (1.0 - vein_blend) + vein_col[2] * vein_blend) * light_mult + spec_dapple * 12.0

    # Height for normal map
    h_leaf = (
        layer_h_offset
        + 0.20 * midrib
        + 0.08 * petiole_mask
        + 0.18 * bullate
        + 0.06 * micro_crinkle
        - 0.065 * lat_vein
        - 0.11 * (s * s)
    )
    # Waxy glossy cuticle on green blade (0.44..0.54 -> lush specular sheen without sky-glare washout), veins ~0.64
    r_leaf = np.clip(rough_base * (1.0 - 0.10 * bullate) + 0.14 * vein_blend, 0.42, 0.72)
    ao_leaf = np.clip(0.55 + 0.45 * (t_c ** 0.6) - 0.12 * (1.0 - np.abs(s)) * (1.0 - t_c), 0.34, 1.0)

    x_idx = (np.arange(x_min, x_max) % wrap_width) if wrap_width > 0 else np.arange(x_min, x_max)
    y_idx = np.arange(y_min, y_max)

    dst_rgb = canvas_rgb[y_idx[:, None], x_idx[None, :]]
    dst_a = canvas_a[y_idx[:, None], x_idx[None, :]]
    dst_h = canvas_h[y_idx[:, None], x_idx[None, :]]
    dst_r = canvas_r[y_idx[:, None], x_idx[None, :]]
    dst_ao = canvas_ao[y_idx[:, None], x_idx[None, :]]

    m = mask
    a_m = aa[m]
    inv_a = 1.0 - a_m
    new_rgb = np.stack([col_r[m], col_g[m], col_b[m]], axis=-1)
    dst_rgb[m] = new_rgb * a_m[:, None] + dst_rgb[m] * inv_a[:, None]
    dst_a[m] = np.maximum(dst_a[m], a_m * 255.0)
    dst_h[m] = h_leaf[m] * a_m + dst_h[m] * inv_a
    dst_r[m] = r_leaf[m] * a_m + dst_r[m] * inv_a
    dst_ao[m] = ao_leaf[m] * a_m + dst_ao[m] * inv_a

    canvas_rgb[y_idx[:, None], x_idx[None, :]] = dst_rgb
    canvas_a[y_idx[:, None], x_idx[None, :]] = dst_a
    canvas_h[y_idx[:, None], x_idx[None, :]] = dst_h
    canvas_r[y_idx[:, None], x_idx[None, :]] = dst_r
    canvas_ao[y_idx[:, None], x_idx[None, :]] = dst_ao


def paint_beet_crown_peek(canvas_rgb, canvas_a, canvas_h, canvas_r, cx, cy, rx, ry, wrap_width=0, y_clip=(0, H), x_clip=None):
    """Paint a subtle creamy-ivory sugar beet crown (Rübenkopf) peeking at the rosette base."""
    H_c, W_c = canvas_a.shape
    x0 = int(cx - rx - 3)
    x1 = int(cx + rx + 4)
    y0 = max(y_clip[0], int(cy - ry - 3))
    y1 = min(y_clip[1], int(cy + ry + 4))
    if x_clip is not None:
        x0 = max(x_clip[0], x0)
        x1 = min(x_clip[1], x1)
    elif wrap_width == 0:
        x0 = max(0, x0)
        x1 = min(W_c, x1)
    if y1 <= y0 or x1 <= x0:
        return

    ys = np.arange(y0, y1, dtype=np.float32)[:, None]
    xs = np.arange(x0, x1, dtype=np.float32)[None, :]
    d2 = ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2
    m = d2 <= 1.0
    if not np.any(m):
        return
    aa = np.clip((1.0 - np.sqrt(np.clip(d2, 0.0, 1.0))) * 3.5, 0.0, 1.0)
    shade = 0.68 + 0.34 * np.clip(1.0 - (ys - (cy - ry)) / (2.0 * ry), 0.0, 1.0) * (1.0 - 0.35 * d2)
    col = np.stack([182.0 * shade, 178.0 * shade, 144.0 * shade], axis=-1)
    x_idx = (np.arange(x0, x1) % wrap_width) if wrap_width > 0 else np.arange(x0, x1)
    y_idx = np.arange(y0, y1)
    a_m = aa[m]
    dst_rgb = canvas_rgb[y_idx[:, None], x_idx[None, :]]
    dst_a = canvas_a[y_idx[:, None], x_idx[None, :]]
    dst_h = canvas_h[y_idx[:, None], x_idx[None, :]]
    dst_r = canvas_r[y_idx[:, None], x_idx[None, :]]
    dst_rgb[m] = col[m] * a_m[:, None] + dst_rgb[m] * (1.0 - a_m[:, None])
    dst_a[m] = np.maximum(dst_a[m], a_m * 255.0)
    dst_h[m] = (0.35 + 0.25 * (1.0 - d2[m])) * a_m + dst_h[m] * (1.0 - a_m)
    dst_r[m] = 0.74 * a_m + dst_r[m] * (1.0 - a_m)
    canvas_rgb[y_idx[:, None], x_idx[None, :]] = dst_rgb
    canvas_a[y_idx[:, None], x_idx[None, :]] = dst_a
    canvas_h[y_idx[:, None], x_idx[None, :]] = dst_h
    canvas_r[y_idx[:, None], x_idx[None, :]] = dst_r


def generate_atlas():
    rng = np.random.default_rng(202608)
    rgb = np.zeros((H, W, 3), dtype=np.float32)
    alpha = np.zeros((H, W), dtype=np.float32)
    height = np.full((H, W), 0.25, dtype=np.float32)
    rough = np.full((H, W), 0.42, dtype=np.float32)
    ao = np.full((H, W), 0.80, dtype=np.float32)

    GOLDEN_ANGLE = 2.39996323  # 137.508 deg authentic spiral phyllotaxis!

    # Calibrated Vorderpfalz sugar beet palette (rich deep glossy spinach/emerald green + crisp pale celadon veins)
    def pick_leaf_palette(tier: str):
        if tier == "outer_dark":
            b = (rng.uniform(28, 44), rng.uniform(66, 92), rng.uniform(20, 32))
            v = (rng.uniform(112, 138), rng.uniform(154, 180), rng.uniform(74, 96))
            return b, v, float(rng.uniform(0.48, 0.56))
        elif tier == "mid_lush":
            b = (rng.uniform(42, 64), rng.uniform(94, 126), rng.uniform(28, 40))
            v = (rng.uniform(140, 168), rng.uniform(184, 210), rng.uniform(92, 116))
            return b, v, float(rng.uniform(0.44, 0.52))
        else:  # inner_heart
            b = (rng.uniform(68, 96), rng.uniform(128, 160), rng.uniform(38, 54))
            v = (rng.uniform(166, 196), rng.uniform(204, 226), rng.uniform(114, 138))
            return b, v, float(rng.uniform(0.42, 0.50))

    # =========================================================================
    # BAND 1 [y: 0..360, U: 0..1 seamless]: TOP-DOWN 6-ROSETTE CANOPY ROW
    # Broad rounded crinkled leaves arranged in natural spiral phyllotaxis!
    # =========================================================================
    b1_clip = (0, 360)
    n_ros = 6
    # Deep shaded leaf/canopy under-layer along row centerline so canopy reads dense & volumetric
    core_noise = tileable_fbm(360, W, ((6, 18, 0.55), (14, 42, 0.45)), seed=110)
    yy1 = np.arange(360, dtype=np.float32)[:, None]
    core_band = np.exp(-((np.abs(yy1 - 180.0) / 96.0) ** 2.6)) * (0.76 + 0.48 * core_noise)
    core_mask = core_band > 0.56
    rgb[:360][core_mask] = np.stack([
        28.0 + core_noise[core_mask] * 16.0,
        52.0 + core_noise[core_mask] * 24.0,
        18.0 + core_noise[core_mask] * 10.0,
    ], axis=-1)
    alpha[:360][core_mask] = 255.0
    height[:360][core_mask] = 0.12 + core_noise[core_mask] * 0.10
    rough[:360][core_mask] = 0.66
    ao[:360][core_mask] = 0.40

    rosette_centers = [
        ((i + 0.5) * (W / n_ros) + float(rng.uniform(-18.0, 18.0)), 180.0 + float(rng.uniform(-18.0, 18.0)))
        for i in range(n_ros)
    ]

    # Paint each rosette in authentic golden-angle spiral from outer mature -> mid -> inner young leaves
    for tier_name, count, len_rng, wid_rng, sun_rng, h_off, orig_jit in [
        ("outer_dark", 10, (118.0, 158.0), (68.0, 96.0), (0.82, 0.98), 0.28, 12.0),
        ("mid_lush",   10, (82.0,  128.0), (54.0, 78.0), (0.95, 1.12), 0.54, 9.0),
        ("inner_heart", 8, (42.0,   78.0), (34.0, 52.0), (1.05, 1.22), 0.78, 3.0),
    ]:
        for rx, ry in rosette_centers:
            ang0 = float(rng.uniform(0, 2 * math.pi))
            for k in range(count):
                a = ang0 + k * GOLDEN_ANGLE + float(rng.uniform(-0.22, 0.22))
                len_l = float(rng.uniform(*len_rng)) * (0.90 + 0.16 * abs(math.sin(a)))
                wid_l = float(rng.uniform(*wid_rng))
                bc, vc, rb = pick_leaf_palette(tier_name)
                # Inner heart leaves start slightly across the center (-3..+3px) to eliminate any central pinhole!
                rad_o = float(rng.uniform(-4.0, orig_jit)) if tier_name == "inner_heart" else float(rng.uniform(2.0, orig_jit))
                ox = rx + math.cos(a) * rad_o
                oy = ry + math.sin(a) * rad_o
                stamp_beet_leaf(
                    rgb, alpha, height, rough, ao,
                    ox, oy, len_l, wid_l, a, bc, vc, rb,
                    sun_boost=float(rng.uniform(*sun_rng)),
                    crinkle_phase=float(rng.uniform(0, 6.28)),
                    arch_curve=float(rng.uniform(-0.18, 0.18)),
                    wrap_width=W, y_clip=b1_clip, layer_h_offset=h_off,
                )
            # Tiny vibrant baby heart bud filling the very rosette core
            if tier_name == "inner_heart":
                for k_bud in range(4):
                    ab = ang0 + k_bud * 1.57 + float(rng.uniform(-0.3, 0.3))
                    bc, vc, rb = pick_leaf_palette("inner_heart")
                    stamp_beet_leaf(
                        rgb, alpha, height, rough, ao,
                        rx - math.cos(ab) * 6.0, ry - math.sin(ab) * 6.0,
                        float(rng.uniform(24.0, 34.0)), float(rng.uniform(20.0, 28.0)),
                        ab, bc, vc, rb, sun_boost=1.18, crinkle_phase=float(rng.uniform(0, 6.28)),
                        arch_curve=0.0, wrap_width=W, y_clip=b1_clip, layer_h_offset=0.88,
                    )

    # =========================================================================
    # BAND 2 [y: 368..716, U: 0..1 seamless]: SIDE-PROFILE 5-ROSETTE WALL + SKIRT
    # Broad, wide-fanning arching beet leaves (rounded paddle tips, NOT tall spears!)
    # Bottom [y: 632..716] dark soil/crown skirt (alpha=255 -> zero floating on slopes!)
    # =========================================================================
    b2_clip = (368, 716)
    soil_sk_n = tileable_fbm(84, W, ((4, 18, 0.55), (12, 48, 0.45)), seed=220)
    for yi in range(632, 716):
        t_sk = (yi - 632) / 84.0
        n_row = soil_sk_n[yi - 632]
        rgb[yi, :, 0] = (58.0 + n_row * 26.0) * (1.0 - 0.24 * t_sk)
        rgb[yi, :, 1] = (48.0 + n_row * 20.0) * (1.0 - 0.24 * t_sk)
        rgb[yi, :, 2] = (34.0 + n_row * 14.0) * (1.0 - 0.24 * t_sk)
        alpha[yi, :] = 255.0
        height[yi, :] = 0.18 + n_row * 0.22
        rough[yi, :] = 0.93
        ao[yi, :] = 0.44

    n_side = 5
    side_xs = [(i + 0.5) * (W / n_side) + float(rng.uniform(-16.0, 16.0)) for i in range(n_side)]

    # Layer 2A: Back dark-shaded broad wide-fanning outer beet leaves
    for sx in side_xs:
        for k in range(8):
            a = math.radians(-168.0 + k * (156.0 / 7.0) + float(rng.uniform(-8.0, 8.0)))
            # Broad arching outer leaves droop slightly lower toward sides, billow plumply upward
            len_l = float(rng.uniform(165.0, 232.0)) * (0.94 + 0.12 * abs(math.sin(a)))
            wid_l = float(rng.uniform(86.0, 118.0))
            bc, vc, rb = pick_leaf_palette("outer_dark")
            arch = 0.34 if math.cos(a) > 0 else -0.34
            stamp_beet_leaf(
                rgb, alpha, height, rough, ao,
                sx + float(rng.uniform(-18, 18)), 654.0 + float(rng.uniform(-6, 8)),
                len_l, wid_l, a, bc, vc, rb,
                sun_boost=float(rng.uniform(0.76, 0.92)),
                crinkle_phase=float(rng.uniform(0, 6.28)),
                arch_curve=arch, wrap_width=W, y_clip=b2_clip, layer_h_offset=0.26,
            )

    # Subtle creamy-ivory beet crown peeks right at ground level
    for idx_s, sx in enumerate(side_xs):
        if idx_s % 2 == 0:
            paint_beet_crown_peek(
                rgb, alpha, height, rough,
                sx + float(rng.uniform(-6, 6)), 650.0,
                rx=float(rng.uniform(19.0, 25.0)), ry=float(rng.uniform(13.0, 17.0)),
                wrap_width=W, y_clip=b2_clip,
            )

    # Layer 2B: Lush front-facing broad rounded glossy crinkled arching beet leaves
    for sx in side_xs:
        for k in range(9):
            a = math.radians(-162.0 + k * (144.0 / 8.0) + float(rng.uniform(-9.0, 9.0)))
            len_l = float(rng.uniform(146.0, 236.0)) * (0.96 + 0.08 * abs(math.sin(a)))
            wid_l = float(rng.uniform(78.0, 112.0))
            bc, vc, rb = pick_leaf_palette("mid_lush")
            arch = 0.36 if math.cos(a) > 0 else -0.36
            stamp_beet_leaf(
                rgb, alpha, height, rough, ao,
                sx + float(rng.uniform(-12, 12)), 650.0 + float(rng.uniform(-8, 6)),
                len_l, wid_l, a, bc, vc, rb,
                sun_boost=float(rng.uniform(0.95, 1.14)),
                crinkle_phase=float(rng.uniform(0, 6.28)),
                arch_curve=arch, wrap_width=W, y_clip=b2_clip, layer_h_offset=0.54,
            )

    # Layer 2C: Bright fresh rounded inner heart leaves (wide & lush, never spiky)
    for sx in side_xs:
        for k in range(5):
            a = math.radians(-128.0 + k * 19.0 + float(rng.uniform(-8.0, 8.0)))
            len_l = float(rng.uniform(110.0, 178.0))
            wid_l = float(rng.uniform(58.0, 82.0))
            bc, vc, rb = pick_leaf_palette("inner_heart")
            stamp_beet_leaf(
                rgb, alpha, height, rough, ao,
                sx + float(rng.uniform(-8, 8)), 646.0,
                len_l, wid_l, a, bc, vc, rb,
                sun_boost=float(rng.uniform(1.06, 1.22)),
                crinkle_phase=float(rng.uniform(0, 6.28)),
                arch_curve=float(rng.uniform(-0.18, 0.18)),
                wrap_width=W, y_clip=b2_clip, layer_h_offset=0.78,
            )

    # =========================================================================
    # BAND 3A [y: 724..1024, x: 0..420]: DARK FERTILE PALATINATE LOAM SOIL RIDGE
    # Seamlessly tileable horizontally across x=0..420, soft crumbly soil clods!
    # =========================================================================
    sh, sw = 300, 420
    s_macro = tileable_fbm(sh, sw, ((4, 8, 0.48), (10, 20, 0.32), (22, 44, 0.20)), seed=330)
    s_clods = tileable_fbm(sh, sw, ((18, 32, 0.55), (40, 72, 0.45)), seed=331)
    s_furrow = tileable_value_noise(sh, sw, 26, 4, seed=332)
    soil_h = 0.44 * s_macro + 0.42 * s_clods + 0.14 * s_furrow

    yy_s = np.linspace(-1.0, 1.0, sh, dtype=np.float32)[:, None]
    ridge_sun = 1.05 - 0.26 * (yy_s * yy_s)

    soil_rgb = np.zeros((sh, sw, 3), dtype=np.float32)
    # Dark fertile Pfalz Lössboden (rich dark chocolate-loam with subtle clod depth)
    soil_rgb[:, :, 0] = (74.0 + (soil_h - 0.5) * 46.0) * ridge_sun
    soil_rgb[:, :, 1] = (61.0 + (soil_h - 0.5) * 38.0) * ridge_sun
    soil_rgb[:, :, 2] = (43.0 + (soil_h - 0.5) * 28.0) * ridge_sun

    # Soft organic rounded calcareous soil crumbs & tiny limestone flecks (NO hard squares!)
    yy_p, xx_p = np.ogrid[:sh, :sw]
    for _ in range(95):
        px = float(rng.uniform(6, sw - 6))
        py = float(rng.uniform(6, sh - 6))
        rx_p = float(rng.uniform(2.0, 5.2))
        ry_p = float(rng.uniform(1.8, 4.4))
        x0p, x1p = max(0, int(px - rx_p - 2)), min(sw, int(px + rx_p + 3))
        y0p, y1p = max(0, int(py - ry_p - 2)), min(sh, int(py + ry_p + 3))
        ys_loc = np.arange(y0p, y1p, dtype=np.float32)[:, None]
        xs_loc = np.arange(x0p, x1p, dtype=np.float32)[None, :]
        d2 = ((xs_loc - px) / rx_p) ** 2 + ((ys_loc - py) / ry_p) ** 2
        w_p = np.clip(1.0 - d2, 0.0, 1.0) ** 1.4
        # Subtle warm limestone-tan pebble or dark earth crumb
        is_pebble = rng.random() < 0.55
        if is_pebble:
            t_col = np.array([rng.uniform(118, 146), rng.uniform(110, 134), rng.uniform(90, 112)], dtype=np.float32)
            dh = 0.18
        else:
            t_col = np.array([rng.uniform(42, 56), rng.uniform(34, 46), rng.uniform(24, 34)], dtype=np.float32)
            dh = 0.12
        sub = soil_rgb[y0p:y1p, x0p:x1p]
        soil_rgb[y0p:y1p, x0p:x1p] = sub * (1.0 - w_p[:, :, None] * 0.72) + t_col[None, None, :] * (w_p[:, :, None] * 0.72)
        soil_h[y0p:y1p, x0p:x1p] += w_p * dh

    rgb[724:1024, 0:420] = np.clip(soil_rgb, 0.0, 255.0)
    alpha[724:1024, 0:420] = 255.0
    height[724:1024, 0:420] = np.clip(soil_h, 0.0, 1.0)
    rough[724:1024, 0:420] = np.clip(0.91 + (0.5 - s_clods) * 0.07, 0.85, 0.98)
    ao[724:1024, 0:420] = np.clip(0.64 + 0.36 * soil_h, 0.45, 1.0)

    # =========================================================================
    # BAND 3B & 3C [y: 724..1024, x: 428..724 & x: 728..1024]:
    # TWO STANDALONE FULL-SILHOUETTE BROAD-LEAVED ROSETTE CLUMPS (cross-cards!)
    # =========================================================================
    for idx_c, (x0, x1) in enumerate([(428, 724), (728, 1024)]):
        cx = 0.5 * (x0 + x1)
        base_y = 956.0
        clip_y = (724, 1024)
        clip_x = (x0, x1)

        # Dark soil/crown base skirt (y=936..1024, tapers softly into the rosette roots)
        ys_c = np.arange(930, 1024, dtype=np.float32)[:, None]
        xs_c = np.arange(x0, x1, dtype=np.float32)[None, :]
        base_ell = ((xs_c - cx) / 128.0) ** 2 + ((ys_c - 1024.0) / 86.0) ** 2
        bm = base_ell <= 1.0
        b_n = tileable_fbm(94, x1 - x0, ((6, 12, 0.6), (14, 28, 0.4)), seed=440 + idx_c)
        sub_rgb = rgb[930:1024, x0:x1]
        sub_a = alpha[930:1024, x0:x1]
        sub_r = rough[930:1024, x0:x1]
        sub_h = height[930:1024, x0:x1]
        sub_rgb[bm, 0] = 56.0 + b_n[bm] * 24.0
        sub_rgb[bm, 1] = 48.0 + b_n[bm] * 20.0
        sub_rgb[bm, 2] = 34.0 + b_n[bm] * 14.0
        sub_a[bm] = 255.0
        sub_r[bm] = 0.93
        sub_h[bm] = 0.18 + b_n[bm] * 0.20
        rgb[930:1024, x0:x1] = sub_rgb
        alpha[930:1024, x0:x1] = sub_a
        rough[930:1024, x0:x1] = sub_r
        height[930:1024, x0:x1] = sub_h

        # Outer dark sweeping broad rounded leaves (wide fountain silhouette!)
        for k in range(8):
            a = math.radians(-172.0 + k * (164.0 / 7.0) + float(rng.uniform(-6.0, 6.0)))
            len_l = float(rng.uniform(118.0, 166.0)) * (1.02 if abs(math.cos(a)) < 0.55 else 0.94)
            wid_l = float(rng.uniform(68.0, 92.0))
            bc, vc, rb = pick_leaf_palette("outer_dark")
            arch = 0.30 if math.cos(a) > 0 else -0.30
            stamp_beet_leaf(
                rgb, alpha, height, rough, ao,
                cx + float(rng.uniform(-16, 16)), base_y + float(rng.uniform(-6, 8)),
                len_l, wid_l, a, bc, vc, rb,
                sun_boost=float(rng.uniform(0.78, 0.94)),
                crinkle_phase=float(rng.uniform(0, 6.28)),
                arch_curve=arch, wrap_width=0, y_clip=clip_y, x_clip=clip_x, layer_h_offset=0.28,
            )

        # Subtle beet crown peek
        paint_beet_crown_peek(
            rgb, alpha, height, rough,
            cx + float(rng.uniform(-6, 6)), base_y - 2.0,
            rx=20.0, ry=14.0, wrap_width=0, y_clip=clip_y, x_clip=clip_x,
        )

        # Mid lush glossy broad crinkled leaves
        for k in range(9):
            a = math.radians(-164.0 + k * (148.0 / 8.0) + float(rng.uniform(-7.0, 7.0)))
            len_l = float(rng.uniform(106.0, 172.0)) * (1.04 if abs(math.cos(a)) < 0.55 else 0.90)
            wid_l = float(rng.uniform(62.0, 86.0))
            bc, vc, rb = pick_leaf_palette("mid_lush")
            arch = 0.28 if math.cos(a) > 0 else -0.28
            stamp_beet_leaf(
                rgb, alpha, height, rough, ao,
                cx + float(rng.uniform(-10, 10)), base_y - 4.0 + float(rng.uniform(-6, 4)),
                len_l, wid_l, a, bc, vc, rb,
                sun_boost=float(rng.uniform(0.95, 1.15)),
                crinkle_phase=float(rng.uniform(0, 6.28)),
                arch_curve=arch, wrap_width=0, y_clip=clip_y, x_clip=clip_x, layer_h_offset=0.55,
            )

        # Bright fresh rounded heart leaves
        for k in range(5):
            a = math.radians(-124.0 + k * 17.0 + float(rng.uniform(-6.0, 6.0)))
            len_l = float(rng.uniform(86.0, 140.0))
            wid_l = float(rng.uniform(50.0, 68.0))
            bc, vc, rb = pick_leaf_palette("inner_heart")
            stamp_beet_leaf(
                rgb, alpha, height, rough, ao,
                cx + float(rng.uniform(-6, 6)), base_y - 6.0,
                len_l, wid_l, a, bc, vc, rb,
                sun_boost=float(rng.uniform(1.06, 1.24)),
                crinkle_phase=float(rng.uniform(0, 6.28)),
                arch_curve=float(rng.uniform(-0.16, 0.16)),
                wrap_width=0, y_clip=clip_y, x_clip=clip_x, layer_h_offset=0.80,
            )

    # =========================================================================
    # Downsample 1024x1024 -> 512x512 RGBA Albedo, 256x256 Normal, 128x128 ORM
    # Dilate RGB into alpha==0 BEFORE downsampling AND AFTER so mip edges stay pure green!
    # =========================================================================
    rgba_hi = np.zeros((H, W, 4), dtype=np.uint8)
    rgba_hi[:, :, :3] = np.clip(rgb, 0.0, 255.0).astype(np.uint8)
    rgba_hi[:, :, 3] = np.clip(alpha, 0.0, 255.0).astype(np.uint8)
    rgba_hi = dilate_rgb_into_transparent(rgba_hi, iterations=14)

    # Separate RGB & Alpha downsample (prevents premultiplication darkening around edges!)
    rgb_512 = np.array(
        Image.fromarray(rgba_hi[:, :, :3], mode="RGB").resize((512, 512), Image.Resampling.LANCZOS),
        dtype=np.uint8,
    )
    a_512 = np.array(
        Image.fromarray(rgba_hi[:, :, 3], mode="L").resize((512, 512), Image.Resampling.LANCZOS),
        dtype=np.float32,
    )
    # Crisp clean alpha edge for MASK cutoff (0.45)
    a_512_sharp = np.clip((a_512 - 52.0) * 1.48, 0.0, 255.0).astype(np.uint8)
    rgba_512 = np.dstack([rgb_512, a_512_sharp])
    rgba_512 = dilate_rgb_into_transparent(rgba_512, iterations=8)

    # Save crisp 512x512 RGBA PNG — quantize smoothly via PIL FASTOCTREE only if > 210 KB
    albedo_path = os.path.join(OUT_DIR, "sugarbeet_atlas_albedo.png")
    albedo_img = Image.fromarray(rgba_512, mode="RGBA")
    albedo_img.save(albedo_path, optimize=True, compress_level=9)
    if os.path.getsize(albedo_path) > 210_000:
        # High-fidelity 256-color RGBA indexed palette without cross-hue dither speckles (clean soil + leaves!)
        albedo_q = albedo_img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        albedo_q.save(albedo_path, optimize=True, compress_level=9)

    # 256x256 Normal map supersampled cleanly from 1024x1024 heightfield
    h_256 = np.array(
        Image.fromarray(np.clip(height * 255.0, 0, 255).astype(np.uint8), mode="L").resize(
            (256, 256), Image.Resampling.LANCZOS
        ),
        dtype=np.float32,
    ) / 255.0
    normal_256 = height_to_normal(h_256, strength=3.4)
    normal_path = os.path.join(OUT_DIR, "sugarbeet_atlas_normal.png")
    Image.fromarray(normal_256, mode="RGB").save(normal_path, optimize=True, compress_level=9)

    # 128x128 ORM map (R=AO, G=Roughness, B=Metallic=0)
    orm_hi = np.zeros((H, W, 3), dtype=np.uint8)
    orm_hi[:, :, 0] = np.clip(ao * 255.0, 0, 255).astype(np.uint8)
    orm_hi[:, :, 1] = np.clip(rough * 255.0, 0, 255).astype(np.uint8)
    orm_hi[:, :, 2] = 0
    orm_path = os.path.join(OUT_DIR, "sugarbeet_atlas_orm.png")
    Image.fromarray(orm_hi, mode="RGB").resize((128, 128), Image.Resampling.LANCZOS).save(
        orm_path, optimize=True, compress_level=9
    )

    total_kb = 0.0
    for p in (albedo_path, normal_path, orm_path):
        sz = os.path.getsize(p) / 1024.0
        total_kb += sz
        print(f"Wrote {os.path.basename(p)}: {sz:.1f} KB")
    print(f"Total atlas textures: {total_kb:.1f} KB")


if __name__ == "__main__":
    generate_atlas()
