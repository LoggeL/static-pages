#!/usr/bin/env python3
"""
Procedural Botanical PBR Texture Atlas Generator for Kindenheim Sunflower Field (Sonnenblumenfeld).

Generates a crisp 2x-supersampled botanical atlas tailored for GPU-instanced alpha-masked
sunflower field patches (Helianthus annuus in July/August Pfalz peak bloom):
  - blender/fields/sunflower/textures/sunflower_atlas_albedo.png     (1024x1024 RGBA, color-dilated)
  - blender/fields/sunflower/textures/sunflower_atlas_normal.png     (512x512 RGB OpenGL tangent normal)
  - blender/fields/sunflower/textures/sunflower_atlas_roughness.png  (512x512 grayscale roughness)

Atlas layout (PIL top-down coords; Blender UV v = 1 - y/H):
  - Bottom half (y = 448..1023, UV v in [0.00, 0.5625]):
      Multi-stalk sunflower row curtain (sturdy ridged stems, broad serrated cordate leaves,
      underground root-skirt anchor zone, recessed secondary buds/leaves).
  - Top-left   (x = 0..336,   y = 0..436, UV u in [0.00, 0.328], v in [0.574, 1.00]):
      Hero Sunflower Bloom Variant A (large single golden bloom, dark chocolate Fibonacci seed disc,
      outer pollen ring, green sepal collar, curving stem neck & upper leaves).
  - Top-middle (x = 344..680, y = 0..436, UV u in [0.336, 0.664], v in [0.574, 1.00]):
      Hero Sunflower Bloom Variant B (lush twin-bloom cluster: radiant primary head + smaller
      angled companion bloom + green sepal/leaf collar for double aerial & close-up density).
  - Top-right  (x = 688..1023, y = 0..436, UV u in [0.672, 1.00], v in [0.574, 1.00]):
      Aerial Canopy Broad-Leaf Rosette (splayed serrated heart-shaped leaves + peeking golden bloom
      for lush top-down drone/satellite readability).
"""

import math
import os
import random
import numpy as np
from PIL import Image

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
OUT_DIR = os.path.join(PROJECT_ROOT, "blender/fields/sunflower/textures")
os.makedirs(OUT_DIR, exist_ok=True)

# Supersampled working canvas (2048x2048 -> clean downsample to 1024x1024 albedo, 512x512 normal/rough)
S = 2048


class Canvas:
    """Floating-point RGBA + Height + Roughness botanical painting canvas."""

    def __init__(self, width: int, height: int):
        self.w = width
        self.h = height
        self.rgb = np.zeros((height, width, 3), dtype=np.float32)
        self.alpha = np.zeros((height, width), dtype=np.float32)
        self.height = np.zeros((height, width), dtype=np.float32)
        self.rough = np.full((height, width), 0.72, dtype=np.float32)

    def composite_patch(
        self,
        x0: int,
        y0: int,
        p_rgb: np.ndarray,
        p_alpha: np.ndarray,
        p_height: np.ndarray,
        p_rough: np.ndarray,
        height_bias: float = 0.0,
    ):
        """Alpha-composite a local numpy patch onto the canvas (clipped cleanly to bounds)."""
        ph, pw = p_alpha.shape
        cx0 = max(0, x0)
        cy0 = max(0, y0)
        cx1 = min(self.w, x0 + pw)
        cy1 = min(self.h, y0 + ph)
        if cx0 >= cx1 or cy0 >= cy1:
            return

        px0, py0 = cx0 - x0, cy0 - y0
        px1, py1 = px0 + (cx1 - cx0), py0 + (cy1 - cy0)

        sa = np.clip(p_alpha[py0:py1, px0:px1], 0.0, 1.0)
        if not np.any(sa > 1e-4):
            return

        da = self.alpha[cy0:cy1, cx0:cx1]
        out_a = sa + da * (1.0 - sa)
        safe_a = np.maximum(out_a, 1e-6)

        src_rgb = p_rgb[py0:py1, px0:px1]
        dst_rgb = self.rgb[cy0:cy1, cx0:cx1]
        self.rgb[cy0:cy1, cx0:cx1] = (
            src_rgb * sa[..., None] + dst_rgb * (da * (1.0 - sa))[..., None]
        ) / safe_a[..., None]

        src_h = p_height[py0:py1, px0:px1] + height_bias
        dst_h = self.height[cy0:cy1, cx0:cx1]
        self.height[cy0:cy1, cx0:cx1] = (
            src_h * sa + dst_h * (da * (1.0 - sa))
        ) / safe_a

        src_r = p_rough[py0:py1, px0:px1]
        dst_r = self.rough[cy0:cy1, cx0:cx1]
        self.rough[cy0:cy1, cx0:cx1] = (
            src_r * sa + dst_r * (da * (1.0 - sa))
        ) / safe_a

        self.alpha[cy0:cy1, cx0:cx1] = out_a


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-8), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def value_noise_2d(h: int, w: int, scale: int, seed: int) -> np.ndarray:
    """Fast smooth tileable-ish value noise for organic botanical micro-texture."""
    rng = np.random.default_rng(seed)
    gh = max(2, h // scale + 2)
    gw = max(2, w // scale + 2)
    grid = rng.random((gh, gw), dtype=np.float32)
    img = Image.fromarray((grid * 255.0).astype(np.uint8), mode="L").resize(
        (w, h), resample=Image.Resampling.BICUBIC
    )
    return np.asarray(img, dtype=np.float32) / 255.0


def draw_stem(
    canvas: Canvas,
    pts: list,
    r_start: float,
    r_end: float,
    base_col=(0.28, 0.45, 0.14),
    lit_col=(0.45, 0.64, 0.22),
    dark_col=(0.15, 0.27, 0.08),
    soil_bottom_px: int = 0,
    seed: int = 1,
    height_bias: float = 0.0,
):
    """Paint a sturdy ribbed herbaceous sunflower stem along a 2D polyline."""
    pts_arr = np.asarray(pts, dtype=np.float32)
    # Sample densely along polyline
    segs = []
    total_len = 0.0
    for i in range(len(pts_arr) - 1):
        d = float(np.linalg.norm(pts_arr[i + 1] - pts_arr[i]))
        segs.append((pts_arr[i], pts_arr[i + 1], total_len, d))
        total_len += d
    if total_len < 1.0:
        return

    pad = int(max(r_start, r_end) + 8)
    x0 = int(math.floor(pts_arr[:, 0].min())) - pad
    y0 = int(math.floor(pts_arr[:, 1].min())) - pad
    x1 = int(math.ceil(pts_arr[:, 0].max())) + pad
    y1 = int(math.ceil(pts_arr[:, 1].max())) + pad
    pw, ph = x1 - x0, y1 - y0
    if pw <= 0 or ph <= 0:
        return

    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    min_dist = np.full((ph, pw), 1e6, dtype=np.float32)
    signed_u = np.zeros((ph, pw), dtype=np.float32)
    along_t = np.zeros((ph, pw), dtype=np.float32)
    rad_map = np.full((ph, pw), 1.0, dtype=np.float32)

    for p0, p1, acc_l, seg_l in segs:
        if seg_l < 1e-4:
            continue
        vx, vy = p1[0] - p0[0], p1[1] - p0[1]
        dx, dy = xx - p0[0], yy - p0[1]
        t_seg = np.clip((dx * vx + dy * vy) / (seg_l * seg_l), 0.0, 1.0)
        proj_x = p0[0] + vx * t_seg
        proj_y = p0[1] + vy * t_seg
        rx, ry = xx - proj_x, yy - proj_y
        dist = np.hypot(rx, ry)
        mask = dist < min_dist
        if np.any(mask):
            # Signed perpendicular coordinate (-1..+1 across stem width)
            nx, ny = -vy / seg_l, vx / seg_l
            s_val = rx * nx + ry * ny
            t_glob = (acc_l + t_seg * seg_l) / total_len
            r_here = r_start + (r_end - r_start) * t_glob
            min_dist[mask] = dist[mask]
            signed_u[mask] = s_val[mask] / np.maximum(r_here[mask], 1.0)
            along_t[mask] = t_glob[mask]
            rad_map[mask] = r_here[mask]

    # Soft AA mask
    alpha = smoothstep(rad_map + 1.4, rad_map - 1.2, min_dist)
    if not np.any(alpha > 1e-3):
        return

    u = np.clip(signed_u, -1.0, 1.0)
    # Cylindrical shading: sunlit on left (-u), shaded on right (+u)
    cyl = np.sqrt(np.clip(1.0 - u * u, 0.0, 1.0))
    sun_side = np.clip(0.55 - 0.55 * u, 0.0, 1.0)
    # Longitudinal fibrous stem ridges typical of Helianthus
    ribs = 0.5 + 0.5 * np.sin(u * 14.0 + along_t * 3.0)
    noise = value_noise_2d(ph, pw, scale=14, seed=seed)

    base = np.asarray(base_col, dtype=np.float32)
    lit = np.asarray(lit_col, dtype=np.float32)
    dark = np.asarray(dark_col, dtype=np.float32)

    col = (
        dark[None, None, :] * (1.0 - sun_side)[..., None] * 0.65
        + base[None, None, :] * (0.45 + 0.35 * cyl)[..., None]
        + lit[None, None, :] * (sun_side * (0.45 + 0.30 * ribs))[..., None]
    )
    # Subtle pale downy stem fuzz near outer rim & organic noise
    fuzz = np.power(np.clip(np.abs(u), 0.0, 1.0), 3.0) * 0.12
    col += fuzz[..., None] * np.array([0.85, 0.92, 0.65], dtype=np.float32)
    col *= 0.88 + 0.24 * noise[..., None]

    # Subtle darkening / warm earthy tint right at ground/root-skirt base
    if soil_bottom_px > 0:
        soil_t = smoothstep(float(canvas.h - soil_bottom_px - 90), float(canvas.h - 20), yy)
        earth = np.array([0.20, 0.23, 0.10], dtype=np.float32)
        col = col * (1.0 - 0.55 * soil_t[..., None]) + earth[None, None, :] * (0.55 * soil_t[..., None])

    col = np.clip(col, 0.0, 1.0)
    h_map = (0.35 + 0.55 * cyl + 0.10 * ribs) * alpha
    r_map = np.clip(0.80 - 0.06 * ribs + 0.08 * (noise - 0.5), 0.65, 0.92)

    canvas.composite_patch(x0, y0, col, alpha, h_map, r_map, height_bias=height_bias)


def draw_sunflower_leaf(
    canvas: Canvas,
    base_xy: tuple,
    length: float,
    width: float,
    angle_rad: float,
    droop: float = 0.22,
    tone: str = "mid",
    seed: int = 10,
    height_bias: float = 0.0,
    petiole_len: float = 0.22,
):
    """
    Paint a botanically authentic broad, serrated, heart-shaped (cordate) sunflower leaf
    (Helianthus annuus) with pale central midrib, lateral branching veins, and textured blade!
    """
    bx, by = base_xy
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)

    # First paint a short sturdy petiole from stem node to leaf heart notch
    pet_px = length * petiole_len
    if pet_px > 4.0:
        p1 = (bx + ca * pet_px, by + sa * pet_px)
        draw_stem(
            canvas,
            [(bx, by), p1],
            r_start=max(3.5, width * 0.045),
            r_end=max(2.5, width * 0.032),
            base_col=(0.32, 0.50, 0.16),
            lit_col=(0.50, 0.68, 0.24),
            dark_col=(0.18, 0.30, 0.09),
            seed=seed + 101,
            height_bias=height_bias - 0.05,
        )
        lx0, ly0 = p1
    else:
        lx0, ly0 = bx, by

    # Bounding box around leaf (generous for heart lobes and droop)
    span = int(math.ceil(max(length, width) * 1.35)) + 16
    x0 = int(lx0 - span)
    y0 = int(ly0 - span)
    x1 = int(lx0 + span)
    y1 = int(ly0 + span)
    pw, ph = x1 - x0, y1 - y0
    if pw <= 0 or ph <= 0:
        return

    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx = xx - lx0
    dy = yy - ly0

    # Local leaf coordinates: u along leaf axis (0 at notch, 1 at tip), v perpendicular
    u_raw = (dx * ca + dy * sa) / length
    v_raw = (-dx * sa + dy * ca) / (width * 0.5)

    # Gentle organic arch / droop perpendicular to axis
    v = v_raw - droop * (u_raw * u_raw)

    # Heart-shaped (cordate) sunflower blade profile:
    # Basal lobes dip back to u ~ -0.16 on either side of the petiole notch!
    av = np.abs(v)
    # Shift u slightly forward at center to form the classic heart cleft at u=0, v=0
    cleft = 0.17 * np.exp(-((av / 0.42) ** 2))
    u_eff = u_raw + 0.14 - cleft

    # Normalized longitudinal coordinate inside [0, 1]
    t = u_eff / 1.14

    # Broad cordate width envelope: wide rounded shoulders near t=0.26, tapering smoothly to acuminate tip
    t_clamped = np.clip(t, 0.0, 1.0)
    # Smooth heart envelope
    shoulder = np.sin(np.power(t_clamped, 0.64) * math.pi)
    taper_tip = np.power(np.clip(1.0 - t_clamped, 0.0, 1.0), 0.35)
    base_w = np.clip(shoulder * (0.72 + 0.48 * taper_tip), 0.0, 1.15)

    # Crisp dentate/serrated leaf teeth along margin (signature of Helianthus leaves!)
    tooth_freq = 13.0
    teeth = 0.055 * (0.5 + 0.5 * np.sin(t_clamped * tooth_freq * 2.0 * math.pi + seed * 0.7))
    teeth *= smoothstep(0.08, 0.22, t_clamped) * smoothstep(0.98, 0.80, t_clamped)
    half_w = base_w + teeth

    # Distance inside leaf boundary (negative inside, positive outside)
    # Include tip & base lobe boundary cleanly
    in_t = (t > -0.02) & (t < 1.03)
    edge_dist = (av - half_w) * (width * 0.5)
    # Softly close basal lobes and tip
    tip_dist = (t - 1.0) * length
    base_dist = (-t) * length
    sdf = np.maximum(edge_dist, np.maximum(tip_dist, base_dist))

    alpha = smoothstep(2.2, -1.6, sdf) * in_t.astype(np.float32)
    if not np.any(alpha > 1e-3):
        return

    # Botanical coloration palette (rich deep Palatinate July sunflower green so vivid gold blooms POP!)
    if tone == "dark":
        c_deep = np.array([0.09, 0.21, 0.055], dtype=np.float32)
        c_mid = np.array([0.16, 0.33, 0.085], dtype=np.float32)
        c_lit = np.array([0.26, 0.45, 0.125], dtype=np.float32)
        c_vein = np.array([0.38, 0.54, 0.19], dtype=np.float32)
    elif tone == "bright":
        c_deep = np.array([0.16, 0.33, 0.08], dtype=np.float32)
        c_mid = np.array([0.27, 0.49, 0.12], dtype=np.float32)
        c_lit = np.array([0.41, 0.63, 0.17], dtype=np.float32)
        c_vein = np.array([0.56, 0.72, 0.27], dtype=np.float32)
    else:  # "mid"
        c_deep = np.array([0.12, 0.27, 0.068], dtype=np.float32)
        c_mid = np.array([0.22, 0.41, 0.105], dtype=np.float32)
        c_lit = np.array([0.34, 0.56, 0.155], dtype=np.float32)
        c_vein = np.array([0.48, 0.65, 0.23], dtype=np.float32)

    # Central midrib + curved palmate-pinnate lateral veins!
    midrib_w = 0.055 * (1.0 - 0.72 * t_clamped) + 0.012
    midrib = np.exp(-((av / np.maximum(midrib_w, 0.01)) ** 2)) * smoothstep(0.98, 0.05, t_clamped)

    # Curved lateral veins sweeping forward toward leaf margin
    vein_phase = (t_clamped * 7.5 - np.power(av, 0.85) * 2.15) * math.pi
    lat_vein = np.power(np.clip(np.cos(vein_phase), 0.0, 1.0), 10.0)
    lat_vein *= smoothstep(0.04, 0.15, av) * smoothstep(0.98, 0.72, av / np.maximum(half_w, 0.05))
    lat_vein *= smoothstep(0.05, 0.18, t_clamped) * smoothstep(0.96, 0.78, t_clamped)

    # Fine secondary reticulate bumpiness between veins
    noise_coarse = value_noise_2d(ph, pw, scale=22, seed=seed)
    noise_fine = value_noise_2d(ph, pw, scale=7, seed=seed + 37)

    # Blade shading: lighter on one side of midrib (sunlit V-fold) + tip highlight + base AO
    v_fold = 0.5 + 0.35 * np.tanh(v * 2.4)
    blade_lit = np.clip(0.32 + 0.45 * v_fold + 0.28 * t_clamped + 0.14 * (noise_coarse - 0.5), 0.0, 1.0)
    base_ao = smoothstep(-0.05, 0.32, t_clamped)

    col = (
        c_deep[None, None, :] * (1.0 - blade_lit)[..., None]
        + c_mid[None, None, :] * (1.0 - np.abs(blade_lit - 0.5) * 2.0)[..., None] * 0.55
        + c_lit[None, None, :] * (blade_lit * blade_lit)[..., None]
    )
    # Normalize blend cleanly
    col = (
        c_deep[None, None, :] * (1.0 - blade_lit)[..., None] * 0.85
        + c_mid[None, None, :] * (0.55 * (1.0 - blade_lit * 0.5))[..., None]
        + c_lit[None, None, :] * (blade_lit * 0.78)[..., None]
    )
    col *= 0.72 + 0.28 * base_ao[..., None]

    # Add crisp pale-green midrib & lateral veins
    vein_mask = np.clip(midrib * 0.85 + lat_vein * 0.45, 0.0, 1.0)
    col = col * (1.0 - vein_mask[..., None]) + c_vein[None, None, :] * vein_mask[..., None]

    # Subtle rough micro-grain and edge rim crispness
    col *= 0.90 + 0.20 * noise_fine[..., None]
    col = np.clip(col, 0.0, 1.0)

    # Height map: smooth cupped blade + crisp midrib/lateral veins + subtle natural surface undulation
    cup = 1.0 - 0.40 * np.clip(av / np.maximum(half_w, 0.1), 0.0, 1.0)
    puff = np.sin(vein_phase) ** 2 * 0.045
    h_map = (0.38 + 0.28 * cup + 0.16 * midrib + 0.08 * lat_vein + puff + 0.05 * noise_coarse) * alpha
    r_map = np.clip(0.66 - 0.08 * vein_mask + 0.08 * (noise_fine - 0.5), 0.54, 0.80)

    canvas.composite_patch(x0, y0, col, alpha, h_map, r_map, height_bias=height_bias)


def draw_sunflower_bloom(
    canvas: Canvas,
    cx: float,
    cy: float,
    radius: float,
    n_petals: int = 24,
    aspect_y: float = 1.0,
    tilt_rot: float = 0.0,
    warmth: float = 0.0,
    seed: int = 42,
    height_bias: float = 0.25,
):
    """
    Paint an unmistakable, botanical Helianthus annuus sunflower bloom:
      1. Pointed dark-green sepal bracts peeking between outer petals
      2. Back ring of golden-amber lanceolate ray petals
      3. Front ring of vivid luminous golden-yellow ray petals with central ridge & tips
      4. Dark chocolate-brown Fibonacci (137.508 deg Vogel spiral) seed center with
         outer golden-ochre pollen ring and individual 3D-bumped florets!
    """
    rng = random.Random(seed)
    span = int(math.ceil(radius * 1.24)) + 16
    x0 = int(cx - span)
    y0 = int(cy - span)
    x1 = int(cx + span)
    y1 = int(cy + span)
    pw, ph = x1 - x0, y1 - y0

    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx0 = xx - cx
    dy0 = yy - cy
    ct, st = math.cos(-tilt_rot), math.sin(-tilt_rot)
    dx = dx0 * ct - dy0 * st
    dy = (dx0 * st + dy0 * ct) / max(aspect_y, 0.45)

    r_norm = np.hypot(dx, dy) / radius
    ang = np.arctan2(dy, dx)  # -pi..pi

    p_rgb = np.zeros((ph, pw, 3), dtype=np.float32)
    p_alpha = np.zeros((ph, pw), dtype=np.float32)
    p_height = np.zeros((ph, pw), dtype=np.float32)
    p_rough = np.full((ph, pw), 0.62, dtype=np.float32)

    def over(rgb_l, a_l, h_l, r_l):
        nonlocal p_rgb, p_alpha, p_height, p_rough
        sa = np.clip(a_l, 0.0, 1.0)
        out_a = sa + p_alpha * (1.0 - sa)
        safe = np.maximum(out_a, 1e-6)
        p_rgb = (rgb_l * sa[..., None] + p_rgb * (p_alpha * (1.0 - sa))[..., None]) / safe[..., None]
        p_height = (h_l * sa + p_height * (p_alpha * (1.0 - sa))) / safe
        p_rough = (r_l * sa + p_rough * (p_alpha * (1.0 - sa))) / safe
        p_alpha = out_a

    disc_r = 0.435  # Iconic broad dark chocolate seed disc (~43.5% of total flower radius!)
    noise_fine = value_noise_2d(ph, pw, scale=8, seed=seed + 5)

    # 1. Pointed green calyx / sepal bracts peeking subtly behind outer petals
    n_bracts = 18
    for i in range(n_bracts):
        ba = (i / n_bracts) * 2.0 * math.pi + rng.uniform(-0.07, 0.07)
        blen = rng.uniform(0.68, 0.78)
        bw = rng.uniform(0.11, 0.14)
        da = ((ang - ba + math.pi) % (2.0 * math.pi)) - math.pi
        t = (r_norm - 0.34) / (blen - 0.34)
        t_c = np.clip(t, 0.0, 1.0)
        w_env = bw * np.sin(np.power(t_c, 0.65) * math.pi)
        sdf = (np.abs(da) - w_env) * (radius * 0.65)
        mask_t = (t > 0.0) & (t < 1.04)
        a_b = smoothstep(2.0, -1.5, np.maximum(sdf, (t - 1.0) * radius * 0.45)) * mask_t
        if np.any(a_b > 1e-3):
            b_col = np.array([0.21, 0.42, 0.12], dtype=np.float32)[None, None, :] * (
                0.78 + 0.35 * t_c[..., None]
            )
            over(b_col, a_b, 0.25 + 0.15 * t_c, np.full_like(a_b, 0.72))

    # 2 & 3. Two staggered lush rings of vivid golden-yellow sunflower ray petals!
    # Back ring (deeper warm amber-gold) then Front ring (bright radiant sunflower yellow)
    rings = [
        {
            "count": n_petals,
            "offset": math.pi / n_petals,
            "len_range": (0.89, 1.01),
            "width_scale": 1.08,
            "c_base": np.array([0.78 + warmth * 0.05, 0.42, 0.02], dtype=np.float32),
            "c_mid": np.array([0.96, 0.69 - warmth * 0.04, 0.04], dtype=np.float32),
            "c_tip": np.array([1.00, 0.82 - warmth * 0.03, 0.14], dtype=np.float32),
            "h_base": 0.42,
        },
        {
            "count": n_petals,
            "offset": 0.0,
            "len_range": (0.86, 0.99),
            "width_scale": 1.00,
            "c_base": np.array([0.88 + warmth * 0.04, 0.52, 0.03], dtype=np.float32),
            "c_mid": np.array([1.00, 0.79 - warmth * 0.03, 0.06], dtype=np.float32),
            "c_tip": np.array([1.00, 0.90 - warmth * 0.02, 0.24], dtype=np.float32),
            "h_base": 0.56,
        },
    ]

    for ring_idx, ring in enumerate(rings):
        cnt = ring["count"]
        base_half_ang = (math.pi / cnt) * 1.18 * ring["width_scale"]
        for i in range(cnt):
            pa = (i / cnt) * 2.0 * math.pi + ring["offset"] + rng.uniform(-0.045, 0.045)
            plen = rng.uniform(*ring["len_range"])
            pw_ang = base_half_ang * rng.uniform(0.88, 1.12)
            curl = rng.uniform(-0.045, 0.045)
            shade_jit = rng.uniform(0.93, 1.07)

            da = ((ang - pa + math.pi) % (2.0 * math.pi)) - math.pi
            t = (r_norm - (disc_r - 0.05)) / (plen - (disc_r - 0.05))
            # Only compute near this petal
            if not np.any((t > -0.02) & (t < 1.04) & (np.abs(da) < pw_ang * 1.6)):
                continue

            t_c = np.clip(t, 0.0, 1.0)
            # Subtle graceful curve along petal length
            da_curved = da - curl * (t_c * t_c)
            # Classic pointed sunflower lanceolate petal shape (full mid-belly, crisp acuminate tip)
            w_profile = pw_ang * np.sin(np.power(t_c, 0.62) * math.pi) * (1.0 - 0.22 * t_c * t_c)
            w_profile = np.maximum(w_profile, 0.002)

            # Edge distance in pixels
            rad_px = np.maximum(r_norm * radius, radius * 0.25)
            d_lat = (np.abs(da_curved) - w_profile) * rad_px
            d_tip = (t - 1.0) * (plen - disc_r) * radius
            d_in = (-t) * radius * 0.3
            sdf = np.maximum(d_lat, np.maximum(d_tip, d_in))
            a_p = smoothstep(2.0, -1.5, sdf) * ((t > -0.02) & (t < 1.04))
            if not np.any(a_p > 1e-3):
                continue

            # Normalized across-petal coordinate (-1..+1)
            u_pet = np.clip(da_curved / np.maximum(w_profile, 0.01), -1.0, 1.0)
            # Twin fine longitudinal creases along each sunflower petal!
            crease = 0.5 + 0.5 * np.cos(u_pet * math.pi * 2.2)
            # Subtle directional petal shading (sun from top-left)
            dir_lit = 0.88 + 0.16 * (-math.sin(pa) * 0.5 - math.cos(pa) * 0.3 + 0.4)

            # Rich golden color gradient from deep saffron base -> vivid gold mid -> sunlit tip
            w1 = smoothstep(0.0, 0.45, t_c)
            w2 = smoothstep(0.45, 0.96, t_c)
            col = (
                ring["c_base"][None, None, :] * (1.0 - w1)[..., None]
                + ring["c_mid"][None, None, :] * (w1 * (1.0 - w2))[..., None]
                + ring["c_tip"][None, None, :] * w2[..., None]
            )
            # Petal longitudinal rib highlight & slight edge darkening
            col *= (0.91 + 0.13 * crease - 0.07 * (u_pet * u_pet))[..., None]
            col *= dir_lit * shade_jit * (0.94 + 0.12 * noise_fine[..., None])
            # Base AO where petal emerges from dark center
            col *= (0.78 + 0.22 * smoothstep(0.0, 0.22, t_c))[..., None]
            col = np.clip(col, 0.0, 1.0)

            h_p = ring["h_base"] + 0.12 * np.sin(t_c * math.pi) + 0.07 * crease - 0.05 * (u_pet * u_pet)
            r_p = np.clip(0.56 - 0.06 * crease + 0.06 * noise_fine, 0.45, 0.68)
            over(col, a_p, h_p, r_p)

    # 4. Crisp Dark Chocolate-Brown Fibonacci Seed Center (Disc Florets!)
    disc_edge_px = (r_norm - disc_r) * radius
    disc_a = smoothstep(2.4, -1.6, disc_edge_px)
    if np.any(disc_a > 1e-3):
        rn = np.clip(r_norm / disc_r, 0.0, 1.0)
        # Base dark espresso-chocolate dome with outer golden-ochre pollen ring
        c_core = np.array([0.13, 0.062, 0.026], dtype=np.float32)   # Deep velvety espresso
        c_mid = np.array([0.23, 0.115, 0.044], dtype=np.float32)    # Rich roasted chocolate
        c_pollen = np.array([0.62, 0.34, 0.055], dtype=np.float32)  # Outer warm pollen ring
        c_gold = np.array([0.88, 0.58, 0.09], dtype=np.float32)     # Bright golden anther tips

        t_mid = smoothstep(0.25, 0.72, rn)
        t_ring = smoothstep(0.70, 0.94, rn)
        disc_col = (
            c_core[None, None, :] * (1.0 - t_mid)[..., None]
            + c_mid[None, None, :] * (t_mid * (1.0 - t_ring))[..., None]
            + c_pollen[None, None, :] * t_ring[..., None]
        )
        # Subtle dome lighting (sunlit upper-left)
        dome_z = np.sqrt(np.clip(1.0 - 0.55 * rn * rn, 0.1, 1.0))
        sun_dome = np.clip(0.75 + 0.30 * (-dx / (radius * disc_r) * 0.4 - dy / (radius * disc_r) * 0.5), 0.55, 1.15)
        disc_col *= sun_dome[..., None]
        disc_h = 0.65 + 0.25 * dome_z
        disc_rough = np.full((ph, pw), 0.88, dtype=np.float32)

        # Paint ~310 individual Vogel Fibonacci phyllotaxis florets (golden angle 137.507764 deg)!
        golden_angle = math.radians(137.507764)
        n_florets = 310
        disc_px = radius * disc_r
        floret_bump = np.zeros((ph, pw), dtype=np.float32)
        floret_tint = np.zeros((ph, pw, 3), dtype=np.float32)
        floret_weight = np.zeros((ph, pw), dtype=np.float32)

        for k in range(1, n_florets + 1):
            frac = math.sqrt(k / n_florets)
            rf = disc_px * 0.965 * frac
            th = k * golden_angle
            fx = rf * math.cos(th)
            fy = rf * math.sin(th)
            # Floret radius grows subtly from tightly packed center outward
            f_rad = disc_px * (0.044 + 0.022 * frac)

            # Local slice in rotated/aspect coords (compute in disc space via approx pixel window)
            fx_rot = fx * math.cos(tilt_rot) - (fy * aspect_y) * math.sin(tilt_rot)
            fy_rot = fx * math.sin(tilt_rot) + (fy * aspect_y) * math.cos(tilt_rot)
            px_c = int(round(cx + fx_rot - x0))
            py_c = int(round(cy + fy_rot - y0))
            win = int(math.ceil(f_rad * 1.45)) + 2
            wy0, wy1 = max(0, py_c - win), min(ph, py_c + win + 1)
            wx0, wx1 = max(0, px_c - win), min(pw, px_c + win + 1)
            if wx0 >= wx1 or wy0 >= wy1:
                continue

            ldx = dx[wy0:wy1, wx0:wx1] - fx
            ldy = dy[wy0:wy1, wx0:wx1] - fy
            ld = np.hypot(ldx, ldy) / f_rad
            dome = np.clip(1.0 - ld * ld, 0.0, 1.0)
            if not np.any(dome > 1e-3):
                continue

            # Sunlit top-left specular/micro-highlight on each seed floret
            micro_lit = np.clip(0.65 - 0.35 * (ldx / f_rad) - 0.40 * (ldy / f_rad), 0.25, 1.30)

            if frac < 0.45:
                fc = c_core * (0.65 + 0.55 * dome_val_scale(frac)) + np.array([0.08, 0.04, 0.015]) * micro_lit.mean()
                fc = np.array([0.16, 0.08, 0.032], dtype=np.float32)
            elif frac < 0.74:
                fc = np.array([0.28, 0.145, 0.052], dtype=np.float32)
            elif frac < 0.88:
                fc = c_pollen * 0.92
            else:
                # Outer ring of bright blooming golden pollen florets!
                fc = c_gold * (0.85 + 0.15 * ((k % 3) / 2.0))

            w_sub = np.sqrt(dome)
            mask_better = w_sub > floret_weight[wy0:wy1, wx0:wx1]
            floret_bump[wy0:wy1, wx0:wx1] = np.maximum(floret_bump[wy0:wy1, wx0:wx1], dome)
            # Apply individual floret color with dark crevice around edge
            floret_c = fc[None, None, :] * (0.48 + 0.65 * micro_lit * np.sqrt(dome))[..., None]
            floret_tint[wy0:wy1, wx0:wx1] = np.where(
                mask_better[..., None], floret_c, floret_tint[wy0:wy1, wx0:wx1]
            )
            floret_weight[wy0:wy1, wx0:wx1] = np.maximum(floret_weight[wy0:wy1, wx0:wx1], w_sub)

        # Blend individual Fibonacci seed florets over dark espresso crevice base
        crevice = np.array([0.07, 0.032, 0.012], dtype=np.float32)
        fw = np.clip(floret_weight, 0.0, 1.0)
        disc_col = (
            (disc_col * 0.35 + crevice * 0.65) * (1.0 - fw[..., None])
            + floret_tint * fw[..., None]
        )
        # Subtle warm golden halo dust at the very rim of the disc
        rim_pollen = np.exp(-(((rn - 0.93) / 0.09) ** 2)) * 0.25
        disc_col += rim_pollen[..., None] * c_gold[None, None, :]
        disc_col = np.clip(disc_col, 0.0, 1.0)
        disc_h = disc_h + 0.36 * floret_bump
        disc_rough = np.clip(0.90 - 0.10 * floret_bump, 0.74, 0.94)

        over(disc_col, disc_a, disc_h, disc_rough)

    canvas.composite_patch(x0, y0, p_rgb, p_alpha, p_height, p_rough, height_bias=height_bias)


def dome_val_scale(x: float) -> float:
    return 0.5 + 0.5 * x


def dilate_rgb_into_transparent(rgb: np.ndarray, alpha: np.ndarray, iterations: int = 24) -> np.ndarray:
    """
    Flood-fill RGB colors from opaque edge pixels into surrounding transparent background
    so bilinear filtering & mipmaps NEVER produce dark halos around glTF MASK edges!
    """
    out = rgb.copy()
    filled = alpha > 0.08
    for _ in range(iterations):
        # 4-connected + diagonal 8-connected neighbor pull
        acc = np.zeros_like(out)
        cnt = np.zeros(alpha.shape, dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                sy = slice(max(0, dy), out.shape[0] + min(0, dy))
                sx = slice(max(0, dx), out.shape[1] + min(0, dx))
                ty = slice(max(0, -dy), out.shape[0] + min(0, -dy))
                tx = slice(max(0, -dx), out.shape[1] + min(0, -dx))
                m = filled[sy, sx].astype(np.float32)
                acc[ty, tx] += out[sy, sx] * m[..., None]
                cnt[ty, tx] += m
        need = (~filled) & (cnt > 0.0)
        if not np.any(need):
            break
        out[need] = acc[need] / cnt[need, None]
        filled[need] = True
    return out


def compute_normal_map(height: np.ndarray, alpha: np.ndarray, strength: float = 2.6) -> np.ndarray:
    """Compute crisp OpenGL (+Y up) tangent-space normal map from height buffer."""
    # Pad edges
    h = np.pad(height, 1, mode="edge")
    # Sobel filter
    gx = (
        (h[:-2, 2:] + 2.0 * h[1:-1, 2:] + h[2:, 2:])
        - (h[:-2, :-2] + 2.0 * h[1:-1, :-2] + h[2:, :-2])
    ) * 0.25
    gy = (
        (h[2:, :-2] + 2.0 * h[2:, 1:-1] + h[2:, 2:])
        - (h[:-2, :-2] + 2.0 * h[:-2, 1:-1] + h[:-2, 2:])
    ) * 0.25

    # OpenGL tangent space: +X right, +Y up (note PIL y increases downward -> invert gy sign)
    nx = -gx * strength
    ny = gy * strength
    nz = np.ones_like(nx)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    # Neutral flat normal outside opaque regions
    m = smoothstep(0.05, 0.35, alpha)
    nx *= m
    ny *= m
    nz = nz * m + (1.0 - m)

    n_rgb = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
    return np.clip(n_rgb, 0.0, 1.0)


def build_sunflower_atlas():
    c = Canvas(S, S)
    rng = random.Random(202607)

    # =========================================================================
    # REGION 1: Bottom Half (y = 896..2047 in 2048px canvas -> UV v in [0.00, 0.5625])
    # Multi-Stalk Sunflower Row Curtain (6 sturdy stalks + broad heart-shaped leaves
    # + underground root skirt anchor zone at bottom + peeking recessed secondary blooms)
    # =========================================================================
    y_top_curtain = 910
    y_ground = 1900  # Bottom ~148 px (~12.8% of curtain height) = -0.25m underground root skirt!
    y_bot = S - 1

    # 7 organically spaced stalks across full 2048px width (cleanly sliceable into thirds for cross-baffles!)
    stalk_xs = [142, 418, 742, 1020, 1348, 1626, 1912]

    # Pass 1A: Background shadowed broad leaves for deep leafy field volume
    for idx, sx in enumerate(stalk_xs):
        top_y = y_top_curtain + rng.randint(55, 225)
        lean = rng.uniform(-52, 52)
        for lvl in range(5):
            frac = 0.14 + lvl * 0.165 + rng.uniform(-0.035, 0.035)
            ly = y_ground - frac * (y_ground - top_y)
            lx = sx + lean * frac
            side = -1 if (idx + lvl) % 2 == 0 else 1
            ang = math.radians(180 + rng.uniform(-28, 28)) if side < 0 else math.radians(rng.uniform(-28, 28))
            ang += side * math.radians(26 - frac * 42)
            llen = rng.uniform(210, 315) * (1.10 - 0.32 * frac)
            lwid = llen * rng.uniform(0.76, 0.92)
            draw_sunflower_leaf(
                c,
                (lx, ly),
                length=llen,
                width=lwid,
                angle_rad=ang,
                droop=side * rng.uniform(0.18, 0.34),
                tone="dark",
                seed=100 + idx * 17 + lvl,
                height_bias=-0.14,
            )

    # Pass 1B: 7 sturdy organically curving foreground sunflower stalks extending into -0.25m root skirt!
    # Taper cleanly to narrow upper shoot tips tucked inside the leafy crown (zero chopped bare sticks!)
    stalk_curves = []
    for idx, sx in enumerate(stalk_xs):
        top_y = y_top_curtain + rng.randint(120, 265)
        mid_lean = rng.uniform(-44, 44)
        top_lean = mid_lean + rng.uniform(-42, 42)
        pts = [
            (sx, y_bot + 10),
            (sx + mid_lean * 0.22, y_ground),
            (sx + mid_lean * 0.78, y_ground - (y_ground - top_y) * 0.42),
            (sx + top_lean * 0.86, y_ground - (y_ground - top_y) * 0.76),
            (sx + top_lean, top_y),
        ]
        stalk_curves.append((pts, top_y))
        draw_stem(
            c,
            pts,
            r_start=23.0 + rng.uniform(-2.0, 3.0),
            r_end=6.5 + rng.uniform(-0.8, 1.2),
            base_col=(0.22, 0.38, 0.11),
            lit_col=(0.38, 0.56, 0.17),
            dark_col=(0.11, 0.21, 0.06),
            soil_bottom_px=175,
            seed=400 + idx,
            height_bias=0.05,
        )

    # Pass 1C: Rich foreground broad serrated heart-shaped leaves alternating along every stalk!
    for idx, (pts, top_y) in enumerate(stalk_curves):
        for lvl in range(6):
            frac = 0.11 + lvl * 0.165 + rng.uniform(-0.025, 0.025)
            frac = min(0.96, max(0.08, frac))
            f_idx = frac * (len(pts) - 1)
            i0 = min(len(pts) - 2, int(f_idx))
            lt = f_idx - i0
            lx = pts[i0][0] * (1.0 - lt) + pts[i0 + 1][0] * lt
            ly = pts[i0][1] * (1.0 - lt) + pts[i0 + 1][1] * lt

            side = 1 if (idx + lvl) % 2 == 0 else -1
            llen = rng.uniform(215, 325) * (1.12 - 0.38 * frac)
            lwid = llen * rng.uniform(0.76, 0.94)
            base_ang = 0.0 if side > 0 else math.pi
            # Lower leaves droop naturally; upper leaves arch out & upward to crown the stalk tip!
            pitch = side * math.radians(30.0 - frac * 62.0 + rng.uniform(-12, 12))
            ang = base_ang + pitch
            tone = "bright" if frac > 0.65 else ("mid" if frac > 0.28 else "dark")
            draw_sunflower_leaf(
                c,
                (lx, ly),
                length=llen,
                width=lwid,
                angle_rad=ang,
                droop=side * rng.uniform(0.16, 0.32),
                tone=tone,
                seed=500 + idx * 23 + lvl,
                height_bias=0.08 + frac * 0.10,
            )

        # Crown every stalk apex with a bright small upper shoot leaf so zero flat stem tips show!
        tip_x, tip_y = pts[-1]
        draw_sunflower_leaf(
            c,
            (tip_x, tip_y + 14),
            length=rng.uniform(135, 175),
            width=rng.uniform(110, 145),
            angle_rad=math.radians(-90 + rng.uniform(-34, 34)),
            droop=rng.uniform(-0.14, 0.14),
            tone="bright",
            seed=660 + idx,
            height_bias=0.18,
            petiole_len=0.05,
        )

        # Dense ground-level skirt foliage so -0.25m underground root skirt anchors seamlessly on slopes
        bx_g = pts[1][0]
        for gside in (-1, 1):
            draw_sunflower_leaf(
                c,
                (bx_g + gside * 22, y_ground + rng.uniform(4, 36)),
                length=rng.uniform(155, 220),
                width=rng.uniform(125, 170),
                angle_rad=(0.0 if gside > 0 else math.pi) + gside * math.radians(rng.uniform(8, 30)),
                droop=gside * 0.20,
                tone="dark",
                seed=700 + idx * 7 + (1 if gside > 0 else 0),
                height_bias=0.02,
                petiole_len=0.10,
            )

    # Pass 1D: 2 natural secondary blooms nestled on stalk tips in upper curtain
    for b_idx, (bx, by, br) in enumerate([(575, 1020, 86), (1490, 1010, 90)]):
        draw_sunflower_bloom(
            c,
            bx,
            by,
            radius=br,
            n_petals=20,
            aspect_y=0.86,
            tilt_rot=rng.uniform(-0.28, 0.28),
            warmth=0.10,
            seed=300 + b_idx,
            height_bias=0.22,
        )

    # =========================================================================
    # REGION 2: Top-Left (x = 0..672, y = 0..872 -> UV u in [0.00, 0.328], v in [0.574, 1.00])
    # Hero Sunflower Bloom Variant A: Large Radiant Single Bloom + Stem Neck & 2 Upper Leaves
    # =========================================================================
    cx_a, cy_a = 338.0, 355.0
    # Short sturdy curving stem neck descending to bottom of quadrant (y=858)
    draw_stem(
        c,
        [(cx_a + 18, 858), (cx_a + 10, 690), (cx_a - 4, 540), (cx_a, cy_a + 40)],
        r_start=26.0,
        r_end=20.0,
        seed=801,
        height_bias=0.05,
    )
    # 2 crisp upper heart-shaped leaves framing the neck below the bloom
    draw_sunflower_leaf(
        c,
        (cx_a + 8, 695),
        length=225,
        width=185,
        angle_rad=math.radians(152),
        droop=-0.20,
        tone="mid",
        seed=802,
        height_bias=0.08,
    )
    draw_sunflower_leaf(
        c,
        (cx_a + 12, 650),
        length=215,
        width=175,
        angle_rad=math.radians(24),
        droop=0.18,
        tone="bright",
        seed=803,
        height_bias=0.10,
    )
    # Hero radiant bloom (diameter ~580px in 2048px canvas = crisp ultra-detailed Fibonacci center!)
    draw_sunflower_bloom(
        c,
        cx_a,
        cy_a,
        radius=295.0,
        n_petals=26,
        aspect_y=0.96,
        tilt_rot=0.05,
        warmth=-0.05,
        seed=804,
        height_bias=0.30,
    )

    # =========================================================================
    # REGION 3: Top-Middle (x = 688..1360, y = 0..872 -> UV u in [0.336, 0.664], v in [0.574, 1.00])
    # Hero Sunflower Bloom Variant B: Twin-Bloom Cluster (Large Primary + Companion Bloom!)
    # =========================================================================
    cx_b1, cy_b1 = 945.0, 325.0
    cx_b2, cy_b2 = 1165.0, 485.0
    # Forking twin stalks descending cleanly to bottom edge (y=858)
    draw_stem(
        c,
        [(1015, 858), (990, 680), (960, 505), (cx_b1, cy_b1 + 30)],
        r_start=25.0,
        r_end=18.0,
        seed=901,
        height_bias=0.04,
    )
    draw_stem(
        c,
        [(1065, 858), (1095, 700), (1135, 585), (cx_b2, cy_b2 + 25)],
        r_start=21.0,
        r_end=15.0,
        seed=902,
        height_bias=0.02,
    )
    # Upper leaves framing the twin blooms
    draw_sunflower_leaf(
        c,
        (985, 690),
        length=215,
        width=175,
        angle_rad=math.radians(158),
        droop=-0.16,
        tone="mid",
        seed=903,
        height_bias=0.07,
    )
    draw_sunflower_leaf(
        c,
        (1085, 710),
        length=195,
        width=160,
        angle_rad=math.radians(20),
        droop=0.16,
        tone="dark",
        seed=904,
        height_bias=0.06,
    )
    # Companion slightly smaller bloom (slightly warmer amber-gold, subtly angled!)
    draw_sunflower_bloom(
        c,
        cx_b2,
        cy_b2,
        radius=178.0,
        n_petals=22,
        aspect_y=0.88,
        tilt_rot=0.22,
        warmth=0.18,
        seed=905,
        height_bias=0.22,
    )
    # Primary bold golden bloom slightly overlapping in front
    draw_sunflower_bloom(
        c,
        cx_b1,
        cy_b1,
        radius=238.0,
        n_petals=25,
        aspect_y=0.95,
        tilt_rot=-0.08,
        warmth=-0.02,
        seed=906,
        height_bias=0.32,
    )

    # =========================================================================
    # REGION 4: Top-Right (x = 1376..2047, y = 0..872 -> UV u in [0.672, 1.00], v in [0.574, 1.00])
    # Aerial Canopy Broad-Leaf Rosette (Organic overlapping serrated heart leaves + radiant bloom)
    # Kept cleanly inside x = 1400..2025, y = 25..850 so ZERO tips ever clip!
    # =========================================================================
    cx_r, cy_r = 1712.0, 442.0
    rosette_specs = [
        (-8, 248, 214, "dark", 0.00),
        (36, 224, 194, "mid", 0.03),
        (88, 252, 218, "dark", 0.02),
        (134, 220, 190, "mid", 0.05),
        (178, 244, 212, "dark", 0.01),
        (228, 232, 202, "bright", 0.07),
        (274, 248, 214, "mid", 0.04),
        (316, 216, 188, "bright", 0.09),
        (60, 182, 160, "bright", 0.11),
        (205, 188, 164, "bright", 0.12),
    ]
    for r_i, (deg, llen, lwid, tone, hb) in enumerate(rosette_specs):
        ar = math.radians(deg + rng.uniform(-8, 8))
        ox = cx_r + math.cos(ar) * rng.uniform(8.0, 18.0)
        oy = cy_r + math.sin(ar) * rng.uniform(8.0, 18.0)
        draw_sunflower_leaf(
            c,
            (ox, oy),
            length=llen,
            width=lwid,
            angle_rad=ar,
            droop=rng.uniform(-0.14, 0.14),
            tone=tone,
            seed=1000 + r_i,
            height_bias=hb,
            petiole_len=0.05,
        )
    # Center sunlit golden bloom peeking up from the lush green leaf rosette (aerial gold-on-green!)
    draw_sunflower_bloom(
        c,
        cx_r + 14,
        cy_r - 10,
        radius=148.0,
        n_petals=22,
        aspect_y=0.96,
        tilt_rot=0.14,
        warmth=0.04,
        seed=1020,
        height_bias=0.35,
    )

    # =========================================================================
    # Post-processing: Clean gutters, tight 6px anti-halo color dilation (keeps empty sky flat
    # for crisp PNG compression!), save lean <310 KB RGBA albedo + <45 KB JPEG normal map!
    # =========================================================================
    c.alpha[872:896, :] = 0.0
    c.alpha[:896, 672:688] = 0.0
    c.alpha[:896, 1360:1376] = 0.0

    print("Dilating 6px anti-halo edge RGB into transparent gutter...")
    dilated_2048 = dilate_rgb_into_transparent(c.rgb, c.alpha, iterations=6)

    # Pick highest resolution that stays comfortably under our <400 KB GLB budget
    albedo_path = os.path.join(OUT_DIR, "sunflower_atlas_albedo.png")
    a_u8 = None
    for target_res, use_quant in [(1024, True), (768, True), (640, False), (512, False)]:
        rgb_img = Image.fromarray(
            (np.clip(dilated_2048, 0.0, 1.0) * 255.0).astype(np.uint8), mode="RGB"
        ).resize((target_res, target_res), resample=Image.Resampling.LANCZOS)

        a_img = Image.fromarray(
            (np.clip(c.alpha, 0.0, 1.0) * 255.0).astype(np.uint8), mode="L"
        ).resize((target_res, target_res), resample=Image.Resampling.LANCZOS)

        a_np = np.asarray(a_img, dtype=np.float32) / 255.0
        a_sharp = np.clip((a_np - 0.18) / 0.68, 0.0, 1.0)
        rgb_np = np.asarray(rgb_img, dtype=np.uint8).copy()
        a_u8 = (a_sharp * 255.0).astype(np.uint8)
        # Keep dilated RGB strictly within 2px of opaque boundary; zero rest for crisp PNG compression
        near_opaque = a_u8 > 0
        for _ in range(2):
            p = np.pad(near_opaque, 1, mode="constant", constant_values=False)
            near_opaque = (
                p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | near_opaque
            )
        rgb_np[~near_opaque] = 0
        rgba_img = Image.fromarray(np.dstack([rgb_np, a_u8]), mode="RGBA")

        if use_quant:
            # High-craft 256-color RGBA palette (FASTOCTREE) preserves full resolution at ~3.5x smaller size!
            out_img = rgba_img.quantize(
                colors=256,
                method=Image.Quantize.FASTOCTREE,
                dither=Image.Dither.FLOYDSTEINBERG,
            )
            out_img.save(albedo_path, format="PNG", optimize=True)
        else:
            rgba_img.save(albedo_path, format="PNG", optimize=True)

        sz_kb = os.path.getsize(albedo_path) / 1024.0
        print(f"  candidate albedo {target_res}x{target_res} (quant={use_quant}): {sz_kb:.1f} KB")
        if sz_kb <= 310.0:
            break

    # Normal map (512x512 RGB JPEG Q86 -> crisp ~35 KB normal relief in GLB!)
    h_512 = np.asarray(
        Image.fromarray(
            (np.clip(c.height, 0.0, 1.0) * 255.0).astype(np.uint8), mode="L"
        ).resize((512, 512), resample=Image.Resampling.BILINEAR),
        dtype=np.float32,
    ) / 255.0
    a_512 = np.asarray(
        Image.fromarray(a_u8, mode="L").resize((512, 512), resample=Image.Resampling.BILINEAR),
        dtype=np.float32,
    ) / 255.0
    normal_rgb = compute_normal_map(h_512, a_512, strength=2.4)
    normal_path = os.path.join(OUT_DIR, "sunflower_atlas_normal.jpg")
    Image.fromarray((normal_rgb * 255.0).astype(np.uint8), mode="RGB").save(
        normal_path, format="JPEG", quality=86, optimize=True
    )

    # Roughness map (512x512 grayscale JPEG for reference)
    r_512 = Image.fromarray(
        (np.clip(c.rough, 0.0, 1.0) * 255.0).astype(np.uint8), mode="L"
    ).resize((512, 512), resample=Image.Resampling.BILINEAR)
    rough_path = os.path.join(OUT_DIR, "sunflower_atlas_roughness.jpg")
    r_512.save(rough_path, format="JPEG", quality=85, optimize=True)

    # Remove old stale PNG normal/roughness if present
    for old_f in ("sunflower_atlas_normal.png", "sunflower_atlas_roughness.png"):
        old_p = os.path.join(OUT_DIR, old_f)
        if os.path.exists(old_p):
            os.remove(old_p)

    print(
        f"Generated sunflower atlas textures in {OUT_DIR}:\n"
        f"  albedo:    {os.path.getsize(albedo_path)/1024:.1f} KB\n"
        f"  normal:    {os.path.getsize(normal_path)/1024:.1f} KB (512x512 RGB JPEG)\n"
        f"  roughness: {os.path.getsize(rough_path)/1024:.1f} KB (512x512 L JPEG)"
    )


if __name__ == "__main__":
    build_sunflower_atlas()
