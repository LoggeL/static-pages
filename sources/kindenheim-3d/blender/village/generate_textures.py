#!/usr/bin/env python3
"""
Procedural PBR Texture Generator for Kindenheim (Rheinland-Pfalz) Village & Rural Props.

Generates crisp, high-craft albedo, normal, and roughness maps using PIL + NumPy:
- 6 warm Palatinate (Pfalz) stucco facade variations (6.0m x 3.0m = 2 window bays x 1 story)
  with shared high-detail facade normal & roughness maps (recessed windows, muntins,
  wooden shutters, Pfälzer Sandstein lintels/sills, subtle geranium boxes & plaster grain).
- 3 realistic pitched roof tile textures (classic terracotta, weathered dark red, anthracite slate)
  with shared curved-tile normal & roughness maps.
- Barn / Scheune half-timbered lime-plaster wall + weathered oak barn gate + German front door.
- Dressed red/buff Pfälzer Sandstein plinth/foundation + utility plaster + corrugated agricultural metal.
- Rural prop textures: grapevine bark, alpha-cutout vine leaves with grape clusters,
  deciduous & orchard tree bark + alpha-cutout foliage cards, authentic DIN-font German
  Ortsschild ("Kindenheim / Landkreis Bad Dürkheim" + Zeichen 311 exit back),
  golden spiral round hay bale, oak wine barrel staves & hoops.
"""

import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_DIR = "/Users/logge/Documents/Projects/kindenheim-3d/blender/village/textures"
PROPS_DIR = os.path.join(OUT_DIR, "props")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(PROPS_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Noise & Normal Map Utilities (seamless tileable fBm + Sobel normal baker)
# ---------------------------------------------------------------------------

def tileable_noise(h: int, w: int, grid_y: int, grid_x: int, seed: int) -> np.ndarray:
    """Smooth bilinear/bicubic-interpolated tileable value noise in [0, 1]."""
    rng = np.random.default_rng(seed)
    base = rng.random((grid_y, grid_x), dtype=np.float32)

    ys = np.linspace(0, grid_y, h, endpoint=False, dtype=np.float32)
    xs = np.linspace(0, grid_x, w, endpoint=False, dtype=np.float32)
    y0 = np.floor(ys).astype(np.int32) % grid_y
    x0 = np.floor(xs).astype(np.int32) % grid_x
    y1 = (y0 + 1) % grid_y
    x1 = (x0 + 1) % grid_x

    fy = ys - np.floor(ys)
    fx = xs - np.floor(xs)
    # Smoothstep
    sy = fy * fy * (3.0 - 2.0 * fy)
    sx = fx * fx * (3.0 - 2.0 * fx)

    v00 = base[y0[:, None], x0[None, :]]
    v10 = base[y0[:, None], x1[None, :]]
    v01 = base[y1[:, None], x0[None, :]]
    v11 = base[y1[:, None], x1[None, :]]

    top = v00 * (1.0 - sx[None, :]) + v10 * sx[None, :]
    bot = v01 * (1.0 - sx[None, :]) + v11 * sx[None, :]
    return top * (1.0 - sy[:, None]) + bot * sy[:, None]


def tileable_fbm(h: int, w: int, octaves=((8, 8, 0.5), (16, 16, 0.25), (32, 32, 0.15), (64, 64, 0.1)), seed=42) -> np.ndarray:
    acc = np.zeros((h, w), dtype=np.float32)
    total_w = 0.0
    for idx, (gy, gx, weight) in enumerate(octaves):
        acc += tileable_noise(h, w, gy, gx, seed + idx * 131) * weight
        total_w += weight
    return acc / max(total_w, 1e-6)


def height_to_normal(height: np.ndarray, strength: float = 3.0) -> Image.Image:
    """Convert a float32 heightmap (0..1) into an OpenGL tangent-space normal map (RGB)."""
    # Tileable Sobel gradient
    dx = (
        np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
        + 0.5 * (np.roll(np.roll(height, -1, axis=1), -1, axis=0) - np.roll(np.roll(height, 1, axis=1), -1, axis=0))
        + 0.5 * (np.roll(np.roll(height, -1, axis=1), 1, axis=0) - np.roll(np.roll(height, 1, axis=1), 1, axis=0))
    ) * 0.5
    dy = (
        np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
        + 0.5 * (np.roll(np.roll(height, -1, axis=0), -1, axis=1) - np.roll(np.roll(height, 1, axis=0), -1, axis=1))
        + 0.5 * (np.roll(np.roll(height, -1, axis=0), 1, axis=1) - np.roll(np.roll(height, 1, axis=0), 1, axis=1))
    ) * 0.5

    # OpenGL/glTF normal convention: +X right, +Y up (so invert image-down dy), +Z out
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(height, dtype=np.float32)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    rgb = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5)], axis=-1)
    return Image.fromarray(np.clip(rgb * 255.0, 0, 255).astype(np.uint8), mode="RGB")


def save_jpg(img: Image.Image, path: str, quality: int = 90):
    img.convert("RGB").save(path, format="JPEG", quality=quality, optimize=True)


def save_png(img: Image.Image, path: str):
    img.save(path, format="PNG", optimize=True)


def load_font(size: int, condensed: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        [
            "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
            "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]
        if condensed
        else [
            "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    )
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                pass
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# 1. Palatinate (Pfalz) Photorealistic Stucco Facade Atlas
#    Physical tile: 6.0m wide x 3.0m tall (1024 x 512) = 2 window bays x 1 story
#    NOTE: Left margin x in [0..130] is clean plain stucco (used for narrow jogs & gables!)
# ---------------------------------------------------------------------------

FACADE_STYLES = {
    # --- 6 Global Village Styles (calibrated to Aug-2023 sunlit Kindenheim) ---
    "ochre": {
        "stucco": (214, 180, 114),     # Warm sunlit Pfalz ochre (#D6B472)
        "stucco_var": (16, 13, 10),
        "shutter": (56, 84, 58),       # Muted Pfalz forest green
        "stone": (168, 114, 96),       # Warm weathered red Pfälzer Sandstein
        "frame": (240, 236, 228),
        "has_shutters": True,
        "rolladen": (0.20, 0.35),
        "rolladen_col": (196, 194, 186),
    },
    "cream": {
        "stucco": (232, 225, 212),     # Bright warm Kindenheim cream (#E8E1D4)
        "stucco_var": (14, 12, 10),
        "shutter": (78, 58, 44),
        "stone": (166, 110, 94),       # Muted red Pfälzer Sandstein surrounds
        "frame": (244, 241, 236),
        "has_shutters": False,
        "rolladen": (0.26, 0.52),
        "rolladen_col": (200, 198, 192),
    },
    "warmwhite": {
        "stucco": (240, 237, 231),     # Crisp Neugasse off-white (#F0EDE7)
        "stucco_var": (11, 10, 9),
        "shutter": (72, 50, 38),       # Dark walnut wooden shutters (Neugasse #11!)
        "stone": (212, 206, 196),      # Subtle pale reveal (not heavy red blocks!)
        "frame": (244, 242, 238),
        "has_shutters": True,
        "rolladen": (0.18, 0.45),
        "rolladen_col": (206, 202, 192),
        "thin_surround": True,
    },
    "terracotta": {
        "stucco": (204, 166, 156),     # Dusty rose-terracotta (#CCA69C)
        "stucco_var": (15, 12, 11),
        "shutter": (96, 102, 98),
        "stone": (176, 134, 122),
        "frame": (242, 239, 234),
        "has_shutters": False,
        "rolladen": (0.28, 0.42),
        "rolladen_col": (204, 200, 194),
    },
    "sage": {
        "stucco": (154, 170, 174),     # Heritage Kindenheim blue-gray (#9AAAAE, Hauptstr #95!)
        "stucco_var": (13, 13, 12),
        "shutter": (146, 102, 68),     # Warm natural chestnut wood shutters (#95 Hauptstr!)
        "stone": (224, 214, 192),      # Warm cream window surround (#95!)
        "frame": (244, 242, 238),
        "has_shutters": True,
        "rolladen": (0.12, 0.20),
        "rolladen_col": (204, 202, 196),
        "thin_surround": True,
    },
    "sandstone": {
        "stucco": (216, 208, 196),     # Sunlit warm pale beige-gray plaster (#D8D0C4)
        "stucco_var": (15, 14, 12),
        "shutter": (108, 48, 46),
        "stone": (162, 108, 92),
        "frame": (240, 236, 228),
        "has_shutters": False,
        "rolladen": (0.22, 0.48),
        "rolladen_col": (198, 196, 190),
    },
    # --- Street-View-Exact Photographed Corridor Styles ---
    "ochre_rolladen": {
        "stucco": (204, 166, 94),      # Exact Hauptstraße #62 & #60 mustard-ochre (#CCA65E)
        "stucco_var": (20, 16, 11),
        "shutter": (64, 48, 36),
        "stone": (162, 106, 86),       # Red Pfälzer Sandstein frames
        "frame": (182, 144, 108),      # Warm wood inner window frame
        "has_shutters": False,
        "rolladen": (0.78, 0.68),      # Prominently lowered pale-gray Rolläden (#62!)
        "rolladen_col": (198, 202, 194),
        "weather_streaks": 1.35,
    },
    "ochre_arched": {
        "stucco": (202, 172, 98),      # Exact yellow house west of Martinskirche (#C7A85E)
        "stucco_var": (17, 14, 10),
        "shutter": (64, 48, 36),
        "stone": (236, 234, 228),      # Crisp white-trimmed arched window surrounds
        "frame": (244, 242, 238),
        "has_shutters": False,
        "rolladen": (0.0, 0.0),
        "rolladen_col": (210, 210, 206),
        "arched_multipane": True,
        "thin_surround": True,
    },
    "butter_yellow": {
        "stucco": (224, 212, 158),     # Exact Webers-Weinstube & Hauptstraße #59 right (#E0D49E)
        "stucco_var": (14, 12, 9),
        "shutter": (68, 52, 40),
        "stone": (178, 126, 106),      # Muted sandstone sills/frames
        "frame": (238, 235, 228),
        "has_shutters": False,
        "rolladen": (0.34, 0.62),
        "rolladen_col": (208, 206, 200),
        "thin_surround": True,
    },
    "weathered_cream_dark": {
        "stucco": (214, 206, 192),     # Exact Hauptstraße #59 left weathered cream (#D6CEC0)
        "stucco_var": (24, 21, 18),
        "shutter": (52, 36, 28),
        "stone": (118, 70, 58),        # Dark reddish-brown frames (#59 left!)
        "frame": (64, 44, 36),
        "has_shutters": False,
        "rolladen": (0.88, 0.72),      # Dark espresso-brown roller shutters!
        "rolladen_col": (56, 42, 36),
        "weather_streaks": 1.6,
    },
    "bauhaus_white": {
        "stucco": (236, 237, 236),     # Exact 1929 Weingut Kreutzenberger crisp white (#ECEDEC)
        "stucco_var": (8, 8, 8),
        "shutter": (60, 64, 68),
        "stone": (196, 198, 200),      # Flush modernist reveals
        "frame": (72, 76, 80),         # Dark metal Bauhaus horizontal frames
        "has_shutters": False,
        "rolladen": (0.42, 0.18),
        "rolladen_col": (196, 198, 198),
        "bauhaus_ribbon": True,
        "thin_surround": True,
    },
    "white_clean": {
        "stucco": (238, 236, 231),     # Modern crisp white Neugasse / Burgweg / West #107
        "stucco_var": (10, 9, 9),
        "shutter": (70, 52, 42),
        "stone": (214, 212, 206),
        "frame": (242, 240, 236),
        "has_shutters": False,
        "rolladen": (0.32, 0.56),
        "rolladen_col": (208, 206, 200),
        "thin_surround": True,
    },
    "blush_clean": {
        "stucco": (200, 166, 158),     # Exact Hauptstraße #45 right dusty blush pink (#C8A69E)
        "stucco_var": (12, 11, 10),
        "shutter": (80, 76, 74),
        "stone": (222, 218, 214),      # Thin light-gray frames (#45!)
        "frame": (212, 210, 206),
        "has_shutters": False,
        "rolladen": (0.20, 0.55),
        "rolladen_col": (202, 200, 196),
        "thin_surround": True,
    },
    "siding_lower": {
        "stucco": (216, 212, 204),     # Michelsberg corner house horizontal clapboard (#D8D4CC)
        "stucco_var": (10, 10, 9),
        "shutter": (80, 60, 44),
        "stone": (190, 104, 68),       # Warm orange-terracotta window jambs (sv_kirche_east_angle!)
        "frame": (240, 238, 232),
        "has_shutters": False,
        "rolladen": (0.15, 0.25),
        "rolladen_col": (198, 196, 190),
        "clapboard": True,
        "thin_surround": True,
    },
}


def generate_pfalz_facades():
    W, H = 1024, 512
    fbm_macro = tileable_fbm(H, W, ((4, 8, 0.55), (8, 16, 0.30), (16, 32, 0.15)), seed=101)
    fbm_grain = tileable_fbm(H, W, ((32, 64, 0.45), (64, 128, 0.35), (128, 256, 0.20)), seed=202)
    fbm_streak = tileable_fbm(H, W, ((2, 48, 0.5), (4, 96, 0.3), (8, 192, 0.2)), seed=277)
    rng = np.random.default_rng(303)
    fine_grit = rng.normal(0.0, 0.028, (H, W)).astype(np.float32)

    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    # Subtle soft eaves overhang shadow + ground-edge bounce darkening (no sharp black lines!)
    story_ao = 1.0 - 0.065 * np.exp(-yy * 10.0) - 0.045 * np.exp(-(1.0 - yy) * 14.0)

    # Refined realistic Pfalz window proportions (compact, authentic, never cartoonishly oversized)
    win_w, win_h = 160, 216
    win_top = 136
    win_bot = win_top + win_h
    bay_centers = [256, 768]

    # Build BOTH shuttered & clean-framed shared normal/rough maps!
    for variant, with_shutters in [("facade", True), ("facade_clean", False)]:
        height_map = 0.55 + (fbm_grain - 0.5) * 0.08 + (fbm_macro - 0.5) * 0.03 + fine_grit * 0.12
        rough_map = np.full((H, W), 0.88, dtype=np.float32) + (fbm_grain - 0.5) * 0.07

        for cx in bay_centers:
            x0, x1 = cx - win_w // 2, cx + win_w // 2
            y0, y1 = win_top, win_bot
            pad_x, pad_top = 18, 20
            height_map[y0 - pad_top:y1 + 6, x0 - pad_x:x1 + pad_x] = 0.66 + (fbm_grain[y0 - pad_top:y1 + 6, x0 - pad_x:x1 + pad_x] - 0.5) * 0.05
            rough_map[y0 - pad_top:y1 + 6, x0 - pad_x:x1 + pad_x] = 0.89
            sill_x0, sill_x1 = x0 - pad_x - 8, x1 + pad_x + 8
            sill_y0, sill_y1 = y1 + 2, y1 + 22
            height_map[sill_y0:sill_y1, sill_x0:sill_x1] = 0.78 + (fbm_grain[sill_y0:sill_y1, sill_x0:sill_x1] - 0.5) * 0.04
            height_map[sill_y1:sill_y1 + 6, sill_x0 + 4:sill_x1 - 4] = 0.46

            height_map[y0:y1, x0:x1] = 0.18
            rough_map[y0:y1, x0:x1] = 0.14  # Natural glass reflection

            fw = 10
            height_map[y0:y0 + fw, x0:x1] = 0.36
            height_map[y1 - fw:y1, x0:x1] = 0.36
            height_map[y0:y1, x0:x0 + fw] = 0.36
            height_map[y0:y1, x1 - fw:x1] = 0.36
            height_map[y0:y1, cx - 5:cx + 5] = 0.38
            ty = y0 + int(win_h * 0.36)
            height_map[ty - 4:ty + 4, x0:x1] = 0.38
            for sl in [
                (slice(y0, y0 + fw), slice(x0, x1)),
                (slice(y1 - fw, y1), slice(x0, x1)),
                (slice(y0, y1), slice(x0, x0 + fw)),
                (slice(y0, y1), slice(x1 - fw, x1)),
                (slice(y0, y1), slice(cx - 5, cx + 5)),
                (slice(ty - 4, ty + 4), slice(x0, x1)),
            ]:
                rough_map[sl] = 0.52

            if with_shutters:
                sh_w = 70
                sh_y0, sh_y1 = y0 - 2, y1 + 2
                for sx0, sx1 in [(x0 - pad_x - sh_w - 2, x0 - pad_x - 2), (x1 + pad_x + 2, x1 + pad_x + sh_w + 2)]:
                    height_map[sh_y0:sh_y1, sx0:sx1] = 0.72
                    rough_map[sh_y0:sh_y1, sx0:sx1] = 0.62
                    inner_x0, inner_x1 = sx0 + 10, sx1 - 10
                    inner_y0, inner_y1 = sh_y0 + 12, sh_y1 - 12
                    for ly in range(inner_y0, inner_y1, 9):
                        height_map[ly:min(ly + 4, inner_y1), inner_x0:inner_x1] = 0.77
                        height_map[min(ly + 4, inner_y1):min(ly + 9, inner_y1), inner_x0:inner_x1] = 0.63

        normal_img = height_to_normal(height_map, strength=4.2)
        save_png(normal_img.resize((512, 256), Image.Resampling.LANCZOS), os.path.join(OUT_DIR, f"{variant}_normal.png"))
        rough_img = Image.fromarray(np.clip(rough_map * 255.0, 0, 255).astype(np.uint8), mode="L")
        save_png(rough_img.resize((512, 256), Image.Resampling.LANCZOS), os.path.join(OUT_DIR, f"{variant}_rough.png"))

    for name, st in FACADE_STYLES.items():
        base_col = np.array(st["stucco"], dtype=np.float32)
        var_col = np.array(st["stucco_var"], dtype=np.float32)
        has_shutters = st.get("has_shutters", False)
        thin_sur = st.get("thin_surround", False)
        is_bauhaus = st.get("bauhaus_ribbon", False)
        is_arched = st.get("arched_multipane", False)
        is_clap = st.get("clapboard", False)
        w_streak = st.get("weather_streaks", 0.75)

        img_arr = np.zeros((H, W, 3), dtype=np.float32)
        for c in range(3):
            channel = (
                base_col[c]
                + (fbm_macro - 0.5) * var_col[c] * 1.45
                + (fbm_grain - 0.5) * var_col[c] * 0.85
                + (fbm_streak - 0.5) * 9.0 * w_streak
                + fine_grit * 26.0
            ) * story_ao
            img_arr[:, :, c] = channel

        # Horizontal clapboard siding grooves for Michelsberg corner house!
        if is_clap:
            plank_h = 28
            py = np.arange(H, dtype=np.float32) % plank_h
            clap_shade = 0.96 + 0.06 * (py / plank_h) - 0.16 * np.exp(-((py) / 2.2) ** 2)
            img_arr *= clap_shade[:, None, None]

        # Build soft realistic Gaussian ambient-occlusion / cast-shadow mask!
        ao_mask = Image.new("L", (W, H), 255)
        ao_draw = ImageDraw.Draw(ao_mask)

        pad_x = 12 if thin_sur else 18
        pad_top = 12 if thin_sur else 20
        cur_w = 216 if is_bauhaus else win_w
        cur_h = 132 if is_bauhaus else win_h
        cur_top = 176 if is_bauhaus else win_top
        cur_bot = cur_top + cur_h

        for cx in bay_centers:
            x0, x1 = cx - cur_w // 2, cx + cur_w // 2
            y0, y1 = cur_top, cur_bot
            # Soft shadow under projecting sill & around surround
            ao_draw.rectangle([x0 - pad_x - 6, y1 + 14, x1 + pad_x + 6, y1 + 38], fill=175)
            ao_draw.rectangle([x0 - pad_x + 4, y0 - pad_top + 4, x1 + pad_x + 7, y1 + 12], fill=218)
            # Subtle vertical rainwater stain streaks right below sill corners
            ao_draw.rectangle([x0 - pad_x - 4, y1 + 22, x0 - pad_x + 14, min(H - 1, y1 + 110)], fill=236)
            ao_draw.rectangle([x1 + pad_x - 14, y1 + 22, x1 + pad_x + 4, min(H - 1, y1 + 110)], fill=236)
            if has_shutters:
                sh_w = 70
                for sh_sx0, sh_sx1 in [(x0 - pad_x - sh_w - 2, x0 - pad_x - 2), (x1 + pad_x + 2, x1 + pad_x + sh_w + 2)]:
                    ao_draw.rectangle([sh_sx0 + 6, y0 + 5, sh_sx1 + 9, y1 + 12], fill=182)

        ao_blur = np.asarray(ao_mask.filter(ImageFilter.GaussianBlur(radius=6.5)), dtype=np.float32) / 255.0
        img_arr *= ao_blur[:, :, None]

        img = Image.fromarray(np.clip(img_arr, 0, 255).astype(np.uint8), mode="RGB")
        draw = ImageDraw.Draw(img)

        stone_col = st["stone"]
        stone_dark = tuple(max(0, int(c * 0.78)) for c in stone_col)
        stone_light = tuple(min(255, int(c * 1.10)) for c in stone_col)
        sh_col = st["shutter"]
        sh_dark = tuple(max(0, int(c * 0.68)) for c in sh_col)
        sh_light = tuple(min(255, int(c * 1.12)) for c in sh_col)
        fr_col = st["frame"]
        fr_edge = tuple(max(0, int(c * 0.80)) for c in fr_col)
        rl_fracs = st.get("rolladen", (0.25, 0.45))
        rl_col = st.get("rolladen_col", (200, 198, 192))
        rl_groove = tuple(max(0, int(c * 0.72)) for c in rl_col)
        rl_hi = tuple(min(255, int(c * 1.06)) for c in rl_col)

        for b_idx, cx in enumerate(bay_centers):
            x0, x1 = cx - cur_w // 2, cx + cur_w // 2
            y0, y1 = cur_top, cur_bot

            # 1. Sandstone / plaster window surround (NO harsh cartoon 1px black box!)
            if is_arched:
                # Gently segmental-arched white surround matching yellow house west of church!
                draw.rounded_rectangle([x0 - pad_x, y0 - pad_top, x1 + pad_x, y1 + 10], radius=24, fill=stone_col)
                draw.rectangle([x0 - pad_x - 6, y1 + 2, x1 + pad_x + 6, y1 + 18], fill=stone_light)
                draw.line([(x0 - pad_x - 6, y1 + 18), (x1 + pad_x + 6, y1 + 18)], fill=stone_dark, width=2)
            elif is_bauhaus:
                # Sleek thin aluminum sill + crisp recessed reveal
                draw.rectangle([x0 - 6, y0 - 6, x1 + 6, y1 + 4], fill=(176, 178, 180))
                draw.rectangle([x0 - 8, y1 + 2, x1 + 8, y1 + 14], fill=(198, 200, 202))
                draw.line([(x0 - 8, y1 + 14), (x1 + 8, y1 + 14)], fill=(122, 124, 128), width=2)
            else:
                draw.rectangle([x0 - pad_x, y0 - pad_top, x1 + pad_x, y1 + 6], fill=stone_col)
                # Subtle inner bevel shadow instead of flat vector border
                draw.line([(x0 - pad_x, y0 - pad_top), (x1 + pad_x, y0 - pad_top)], fill=stone_light, width=2)
                draw.line([(x0 - pad_x, y0 - pad_top), (x0 - pad_x, y1 + 6)], fill=stone_light, width=2)
                draw.line([(x1 + pad_x, y0 - pad_top), (x1 + pad_x, y1 + 6)], fill=stone_dark, width=2)
                # Projecting sill with soft highlight top & shaded underside
                sill_x0, sill_x1 = x0 - pad_x - 7, x1 + pad_x + 7
                draw.rectangle([sill_x0, y1 + 2, sill_x1, y1 + 20], fill=stone_light)
                draw.line([(sill_x0, y1 + 2), (sill_x1, y1 + 2)], fill=tuple(min(255, int(c * 1.15)) for c in stone_light), width=2)
                draw.line([(sill_x0, y1 + 19), (sill_x1, y1 + 19)], fill=stone_dark, width=3)

            # 2. Photorealistic Recessed Window Glass (soft warm-dark interior + smooth sky reflection gradient!)
            for gy in range(y0, y1):
                t = (gy - y0) / max(1, cur_h)
                # Natural outdoor daytime window: soft sky-blue/warm-cloud reflection fading into deep warm interior
                sky_ref = (1.0 - t) ** 1.35
                if is_arched:
                    # Brighter daylight multi-pane reflection (matches sv_kirche_front_detail!)
                    r = int(86 + 68 * sky_ref)
                    g = int(96 + 72 * sky_ref)
                    b = int(104 + 78 * sky_ref)
                else:
                    r = int(42 + 64 * sky_ref + (8 if b_idx == 1 else 0))
                    g = int(50 + 74 * sky_ref + (8 if b_idx == 1 else 0))
                    b = int(60 + 88 * sky_ref + (6 if b_idx == 1 else 0))
                draw.line([(x0, gy), (x1, gy)], fill=(r, g, b))

            # Soft subtle sheer interior white curtains (Gardinen) on lower panes — zero hard cartoon lines!
            if not is_bauhaus and not is_arched and rl_fracs[b_idx] < 0.65:
                curt_col = (132, 134, 132) if b_idx == 0 else (154, 152, 146)
                draw.rectangle([x0 + 10, y0 + int(cur_h * 0.56), x1 - 10, y1 - 8], fill=curt_col)
                for cx_fold in range(x0 + 16, x1 - 12, 12):
                    draw.line([(cx_fold, y0 + int(cur_h * 0.56)), (cx_fold, y1 - 8)], fill=(116, 118, 116), width=2)

            # 3. Recessed German Rolladen (ribbed roller shutter) drawn authentically inside window niche!
            rl_frac = rl_fracs[b_idx]
            if rl_frac > 0.05:
                rl_bot = y0 + int(cur_h * rl_frac)
                draw.rectangle([x0 + 4, y0 + 4, x1 - 4, rl_bot], fill=rl_col)
                # Fine horizontal ribbed slats (5px pitch)
                for rly in range(y0 + 7, rl_bot, 5):
                    draw.line([(x0 + 5, rly), (x1 - 5, rly)], fill=rl_groove, width=1)
                    if rly + 2 < rl_bot:
                        draw.line([(x0 + 5, rly + 2), (x1 - 5, rly + 2)], fill=rl_hi, width=1)
                # Bottom Rolladen weighted end bar + soft shadow below it
                draw.rectangle([x0 + 4, max(y0 + 6, rl_bot - 5), x1 - 4, rl_bot], fill=rl_groove)
                draw.rectangle([x0 + 4, rl_bot, x1 - 4, min(y1, rl_bot + 7)], fill=(28, 30, 34))

            # Deep recessed top/side shadow inside jamb reveal
            draw.rectangle([x0, y0, x1, y0 + 10], fill=(32, 34, 36))
            draw.rectangle([x0, y0, x0 + 7, y1], fill=(36, 38, 40))

            # 4. Crisp Slender Window Frame & Muntins
            fw = 8 if (is_bauhaus or is_arched) else 9
            draw.rectangle([x0, y0, x1, y0 + fw], fill=fr_col, outline=fr_edge)
            draw.rectangle([x0, y1 - fw, x1, y1], fill=fr_col, outline=fr_edge)
            draw.rectangle([x0, y0, x0 + fw, y1], fill=fr_col, outline=fr_edge)
            draw.rectangle([x1 - fw, y0, x1, y1], fill=fr_col, outline=fr_edge)
            if is_arched:
                # Authentic 3x5 multi-pane white lattice (sv_kirche_front_detail yellow house!)
                for mx in [x0 + cur_w // 3, x0 + (2 * cur_w) // 3]:
                    draw.rectangle([mx - 3, y0, mx + 3, y1], fill=fr_col)
                for my_f in (0.24, 0.48, 0.72):
                    my = y0 + int(cur_h * my_f)
                    draw.rectangle([x0, my - 3, x1, my + 3], fill=fr_col)
            elif is_bauhaus:
                # Horizontal modernist triple division
                for mx in [x0 + cur_w // 3, x0 + (2 * cur_w) // 3]:
                    draw.rectangle([mx - 4, y0, mx + 4, y1], fill=fr_col)
            else:
                # Classic German tilt-turn casement mullion + upper transom
                draw.rectangle([cx - 4, y0, cx + 4, y1], fill=fr_col, outline=fr_edge)
                ty = y0 + int(cur_h * 0.36)
                draw.rectangle([x0, ty - 4, x1, ty + 4], fill=fr_col, outline=fr_edge)

            # 5. Authentic Louvered Wooden Shutters (when style has shutters)
            if has_shutters:
                sh_w = 70
                sh_y0, sh_y1 = y0 - 2, y1 + 2
                for sx0, sx1 in [(x0 - pad_x - sh_w - 2, x0 - pad_x - 2), (x1 + pad_x + 2, x1 + pad_x + sh_w + 2)]:
                    draw.rectangle([sx0, sh_y0, sx1, sh_y1], fill=sh_col, outline=sh_dark, width=2)
                    inner_x0, inner_x1 = sx0 + 9, sx1 - 9
                    inner_y0, inner_y1 = sh_y0 + 12, sh_y1 - 12
                    draw.rectangle([inner_x0, inner_y0, inner_x1, inner_y1], fill=sh_dark)
                    for ly in range(inner_y0, inner_y1, 9):
                        draw.rectangle([inner_x0 + 2, ly, inner_x1 - 2, min(ly + 4, inner_y1)], fill=sh_light)
                    for hy in [sh_y0 + 26, sh_y1 - 32]:
                        draw.rectangle([sx0 + 2, hy, sx0 + 18, hy + 5], fill=(42, 42, 46))

        # Blend fine mineral plaster grain over ENTIRE facade (unifies stone, frames & stucco photographically!)
        arr_final = np.asarray(img, dtype=np.float32)
        arr_final = np.clip(arr_final + (fbm_grain[:, :, None] - 0.5) * 11.0 + fine_grit[:, :, None] * 14.0, 0, 255).astype(np.uint8)
        save_jpg(Image.fromarray(arr_final, mode="RGB"), os.path.join(OUT_DIR, f"wall_{name}_albedo.jpg"), quality=86)


# ---------------------------------------------------------------------------
# 2. Photorealistic Pfalz Pitched Roof Tile PBR Library (4 variations)
#    Physical tile: 4.0m x 4.0m (1024 x 1024) -> 14 courses x 20 pantiles
#    Cohesive natural clay variation (NO Minecraft checkerboard!), crisp wave flutes & rain streaks!
# ---------------------------------------------------------------------------

def generate_roof_tiles():
    W, H = 1024, 1024
    rows = 14
    cols = 20

    yy = np.linspace(0, rows, H, endpoint=False, dtype=np.float32)[:, None]
    xx = np.linspace(0, cols, W, endpoint=False, dtype=np.float32)[None, :]

    row_idx = np.floor(yy).astype(np.int32)
    col_idx = np.floor(xx).astype(np.int32)
    fy = yy - row_idx
    fx = xx - col_idx

    # Authentic Pfalz Frankfurter Pfanne S-wave profile + clean overlap lip
    s_wave = 0.5 + 0.36 * np.sin(fx * 2.0 * math.pi) + 0.11 * np.cos(fx * 4.0 * math.pi)
    groove = np.exp(-((np.minimum(fx, 1.0 - fx)) / 0.055) ** 2)
    lip_height = (1.0 - fy * 0.32) * (1.0 - 0.50 * np.exp(-((1.0 - fy) / 0.05) ** 2))
    lip_edge = np.exp(-((fy - 0.91) / 0.035) ** 2) * 0.15

    # Vertical slope-aligned rain/patina weathering + fine matte clay grain
    fbm_weather = tileable_fbm(H, W, ((2, 10, 0.45), (6, 20, 0.30), (18, 48, 0.15), (48, 64, 0.10)), seed=505)
    fbm_moss = tileable_fbm(H, W, ((6, 8, 0.5), (16, 16, 0.3), (48, 48, 0.2)), seed=606)
    rng = np.random.default_rng(707)
    # Subtle natural per-tile firing variance (NOT harsh blocky checkerboard!)
    tile_var = np.clip(rng.normal(0.0, 0.55, (rows, cols)).astype(np.float32), -1.3, 1.3)
    per_tile = tile_var[row_idx % rows, col_idx % cols]
    fine_grain = rng.normal(0.0, 4.5, (H, W)).astype(np.float32)

    height = 0.35 + 0.38 * s_wave * lip_height - 0.20 * groove + lip_edge + per_tile * 0.015 + (fbm_weather - 0.5) * 0.05
    height = np.clip(height, 0.0, 1.0)

    norm_img = height_to_normal(height, strength=5.5)
    save_png(norm_img.resize((512, 512), Image.Resampling.LANCZOS), os.path.join(OUT_DIR, "roof_tiles_normal.png"))
    rough = np.clip(0.74 + 0.14 * groove + (fbm_weather - 0.5) * 0.14 - 0.10 * s_wave, 0.42, 0.95)
    save_png(Image.fromarray((rough * 255).astype(np.uint8), mode="L").resize((512, 512), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "roof_tiles_rough.png"))

    ao = (1.0 - 0.30 * np.exp(-((fy) / 0.075) ** 2)) * (1.0 - 0.20 * groove) * (0.90 + 0.15 * s_wave)

    # Calibrated directly against Aug-2023 Street View & Google Satellite aerial_center_church_roofs!
    roof_palettes = {
        "terracotta": {
            "base": (176, 102, 74),    # Warm sunlit dusty Pfalz terracotta (#B0664A)
            "tile_jitter": (7, 5, 4),
            "moss_col": (118, 114, 86),
            "moss_strength": 0.14,
        },
        "darkred": {
            "base": (132, 76, 60),     # Weathered warm reddish-brown Biberschwanz (#844C3C)
            "tile_jitter": (6, 4, 4),
            "moss_col": (98, 96, 74),
            "moss_strength": 0.18,
        },
        "darkbrown": {
            "base": (88, 68, 58),      # Warm dark chocolate-brown clay tiles (Webers-Weinstube, West #107!)
            "tile_jitter": (5, 4, 4),
            "moss_col": (82, 80, 68),
            "moss_strength": 0.15,
        },
        "slate": {
            "base": (72, 76, 82),      # Sunlit anthracite charcoal tiles (Neugasse, Burgweg!)
            "tile_jitter": (5, 5, 5),
            "moss_col": (92, 96, 86),
            "moss_strength": 0.12,
        },
    }

    for rname, pal in roof_palettes.items():
        arr = np.zeros((H, W, 3), dtype=np.float32)
        base = pal["base"]
        jit = pal["tile_jitter"]
        for c in range(3):
            arr[:, :, c] = (
                base[c]
                + per_tile * jit[c]
                + (fbm_weather - 0.5) * 20.0
                + fine_grain
            ) * ao

        moss_mask = np.clip((fbm_moss - 0.64) * 3.2, 0.0, 1.0) * (0.35 + 0.65 * np.exp(-(fy / 0.25) ** 2)) * pal["moss_strength"]
        for c in range(3):
            arr[:, :, c] = arr[:, :, c] * (1.0 - moss_mask) + pal["moss_col"][c] * moss_mask

        save_jpg(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB"),
                 os.path.join(OUT_DIR, f"roof_{rname}_albedo.jpg"), quality=86)


# ---------------------------------------------------------------------------
# 3. Photorealistic Plinths, Barn Timber-Plaster, Doors, Utility & Corridor Specials
# ---------------------------------------------------------------------------

def generate_stone_and_barn():
    W, H = 1024, 512

    # A. Dressed Pfälzer Sandstein Plinth (cohesive natural weathered ashlar, narrow dark mortar!)
    courses = 6
    cols = 8
    yy = np.linspace(0, courses, H, endpoint=False, dtype=np.float32)[:, None]
    row_idx = np.floor(yy).astype(np.int32)
    fy = yy - row_idx

    xx_raw = np.linspace(0, cols, W, endpoint=False, dtype=np.float32)[None, :]
    xx = (xx_raw + (row_idx % 2) * 0.5) % cols
    col_idx = np.floor(xx).astype(np.int32)
    fx = xx - col_idx

    mortar_h = (fy < 0.045) | (fy > 0.965)
    mortar_v = (fx < 0.025) | (fx > 0.975)
    mortar = (mortar_h | mortar_v).astype(np.float32)

    fbm = tileable_fbm(H, W, ((6, 12, 0.4), (16, 32, 0.35), (48, 96, 0.25)), seed=808)
    rng = np.random.default_rng(909)
    # Cohesive warm weathered taupe/rose Pfälzer Sandstein (NOT cartoonishly variegated blocks!)
    stone_r = rng.uniform(148, 174, (courses, cols)).astype(np.float32)
    stone_g = stone_r * rng.uniform(0.79, 0.86, (courses, cols)).astype(np.float32)
    stone_b = stone_r * rng.uniform(0.68, 0.76, (courses, cols)).astype(np.float32)

    br = stone_r[row_idx % courses, col_idx % cols]
    bg = stone_g[row_idx % courses, col_idx % cols]
    bb = stone_b[row_idx % courses, col_idx % cols]

    v_damp = np.linspace(1.0, 0.84, H, dtype=np.float32)[:, None]
    mortar_col = (106.0, 100.0, 94.0)
    arr = np.zeros((H, W, 3), dtype=np.float32)
    for c, ch in enumerate([br, bg, bb]):
        block = (ch + (fbm - 0.5) * 28.0) * v_damp
        arr[:, :, c] = block * (1.0 - mortar) + (mortar_col[c] + (fbm - 0.5) * 14.0) * mortar

    height = (1.0 - mortar * 0.65) * (0.65 + (fbm - 0.5) * 0.26)
    h_img = Image.fromarray(np.clip(height * 255, 0, 255).astype(np.uint8), mode="L").filter(ImageFilter.GaussianBlur(radius=1.5))
    h_smooth = np.asarray(h_img, dtype=np.float32) / 255.0

    save_jpg(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "sandstone_plinth_albedo.jpg"), quality=86)
    save_png(height_to_normal(h_smooth, strength=5.0).resize((512, 256), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "sandstone_plinth_normal.png"))
    rough = np.clip(0.84 + 0.12 * mortar + (fbm - 0.5) * 0.10, 0.65, 0.98)
    save_png(Image.fromarray((rough * 255).astype(np.uint8), mode="L").resize((512, 256), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "sandstone_plinth_rough.png"))

    # A2. Authentic Kindenheim Checkered Brown-and-Tan Ceramic Tile Plinth (Hauptstraße #59!)
    CW, CH = 512, 256
    t_rows, t_cols = 8, 16
    cyy = np.linspace(0, t_rows, CH, endpoint=False, dtype=np.float32)[:, None]
    cxx = np.linspace(0, t_cols, CW, endpoint=False, dtype=np.float32)[None, :]
    cr, cc = np.floor(cyy).astype(np.int32), np.floor(cxx).astype(np.int32)
    cfy, cfx = cyy - cr, cxx - cc
    grout = ((cfy < 0.07) | (cfy > 0.95) | (cfx < 0.05) | (cfx > 0.95)).astype(np.float32)
    is_dark = ((cr + cc) % 2 == 0)
    c_fbm = tileable_fbm(CH, CW, ((8, 16, 0.5), (24, 48, 0.5)), seed=822)
    chk = np.zeros((CH, CW, 3), dtype=np.float32)
    dark_t = (114.0, 74.0, 44.0)   # Glazed chestnut brown (#724A2C)
    tan_t = (186.0, 146.0, 98.0)   # Warm tan-ochre (#BA9262)
    for c in range(3):
        tile_c = np.where(is_dark, dark_t[c], tan_t[c]) + (c_fbm - 0.5) * 18.0
        chk[:, :, c] = tile_c * (1.0 - grout) + (96.0 + (c_fbm - 0.5) * 10.0) * grout
    save_jpg(Image.fromarray(np.clip(chk, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "plinth_checkered_albedo.jpg"), quality=86)

    # A3. Pale Gray-Buff Limestone Rubble Plinth (Bruchstein — sv_kirche_front_detail & #36!)
    RW, RH = 512, 256
    r_courses, r_cols = 8, 10
    ryy = np.linspace(0, r_courses, RH, endpoint=False, dtype=np.float32)[:, None]
    r_idx = np.floor(ryy).astype(np.int32)
    rfy = ryy - r_idx
    rxx = (np.linspace(0, r_cols, RW, endpoint=False, dtype=np.float32)[None, :] + (r_idx % 2) * 0.45) % r_cols
    rc_idx = np.floor(rxx).astype(np.int32)
    rfx = rxx - rc_idx
    r_fbm = tileable_fbm(RH, RW, ((8, 16, 0.4), (24, 48, 0.35), (64, 128, 0.25)), seed=833)
    # Organic wavy mortar joints for irregular Bruchstein rubble
    wobble = (r_fbm - 0.5) * 0.14
    r_mort = ((rfy + wobble < 0.10) | (rfy + wobble > 0.92) | (rfx + wobble < 0.06) | (rfx + wobble > 0.94)).astype(np.float32)
    rrng = np.random.default_rng(844)
    rb_base = rrng.uniform(164, 206, (r_courses, r_cols)).astype(np.float32)
    rb_v = rb_base[r_idx % r_courses, rc_idx % r_cols]
    rub = np.zeros((RH, RW, 3), dtype=np.float32)
    for c, mult in enumerate([1.01, 0.98, 0.92]):
        stone_c = rb_v * mult + (r_fbm - 0.5) * 32.0
        rub[:, :, c] = stone_c * (1.0 - r_mort) + (110.0 * mult + (r_fbm - 0.5) * 14.0) * r_mort
    save_jpg(Image.fromarray(np.clip(rub, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "plinth_rubble_albedo.jpg"), quality=86)

    # A4. Smooth Muted Red-Terracotta Plinth (Hauptstraße #62!)
    s_fbm = tileable_fbm(256, 512, ((6, 12, 0.5), (24, 48, 0.3), (64, 128, 0.2)), seed=855)
    sred = np.zeros((256, 512, 3), dtype=np.float32)
    v_s = np.linspace(1.02, 0.86, 256, dtype=np.float32)[:, None]
    for c, bv in enumerate([164.0, 102.0, 78.0]):
        sred[:, :, c] = (bv + (s_fbm - 0.5) * 24.0) * v_s
    save_jpg(Image.fromarray(np.clip(sred, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "plinth_red_smooth_albedo.jpg"), quality=86)

    # B. Barn / Scheune Timber-Plaster Wall (1024x512 = 6.0m x 3.0m)
    fbm_b = tileable_fbm(H, W, ((6, 12, 0.45), (16, 32, 0.35), (48, 96, 0.2)), seed=1111)
    barn = np.zeros((H, W, 3), dtype=np.float32)
    base_plaster = (214.0, 202.0, 178.0)
    for c in range(3):
        barn[:, :, c] = base_plaster[c] + (fbm_b - 0.5) * 28.0
    img = Image.fromarray(np.clip(barn, 0, 255).astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(img)

    h_barn = 0.50 + (fbm_b - 0.5) * 0.08
    r_barn = np.full((H, W), 0.88, dtype=np.float32)

    timber_col = (82, 58, 42)
    timber_dark = (54, 38, 28)
    for (y0, y1) in [(0, 24), (244, 266), (488, 512)]:
        draw.rectangle([0, y0, W, y1], fill=timber_col, outline=timber_dark, width=2)
        h_barn[y0:y1, :] = 0.72
        r_barn[y0:y1, :] = 0.76
    for px in [0, 256, 512, 768, 1002]:
        w_p = 22 if px < 1000 else 22
        draw.rectangle([px, 0, px + w_p, H], fill=timber_col, outline=timber_dark, width=2)
        h_barn[:, px:min(W, px + w_p)] = 0.74
        r_barn[:, px:min(W, px + w_p)] = 0.76
    for (x0, y0, x1, y1) in [(16, 254, 256, 20), (780, 20, 1012, 254), (16, 494, 256, 260), (780, 260, 1012, 494)]:
        draw.line([(x0, y0), (x1, y1)], fill=timber_col, width=18)
    draw.rectangle([572, 54, 708, 216], fill=(96, 70, 48), outline=timber_dark, width=3)
    for plank_x in range(588, 704, 18):
        draw.line([(plank_x, 58), (plank_x, 212)], fill=(58, 42, 28), width=2)
    h_barn[54:216, 572:708] = 0.36
    r_barn[54:216, 572:708] = 0.74

    arr_b = np.asarray(img, dtype=np.float32)
    arr_b = np.clip(arr_b + (fbm_b[:, :, None] - 0.5) * 14.0, 0, 255).astype(np.uint8)
    save_jpg(Image.fromarray(arr_b, mode="RGB"), os.path.join(OUT_DIR, "wall_barn_albedo.jpg"), quality=86)
    save_png(height_to_normal(h_barn, strength=4.2).resize((512, 256), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "wall_barn_normal.png"))
    save_png(Image.fromarray((r_barn * 255).astype(np.uint8), mode="L").resize((512, 256), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "wall_barn_rough.png"))

    # B2. Pale Butter-Yellow Half-Timbered Gable (sv_kirche_full_west right foreground QOQp!)
    fy_arr = np.zeros((H, W, 3), dtype=np.float32)
    for c, bv in enumerate([226.0, 212.0, 158.0]):
        fy_arr[:, :, c] = bv + (fbm_b - 0.5) * 20.0
    fy_img = Image.fromarray(np.clip(fy_arr, 0, 255).astype(np.uint8), mode="RGB")
    fyd = ImageDraw.Draw(fy_img)
    for (y0, y1) in [(0, 22), (246, 266), (490, 512)]:
        fyd.rectangle([0, y0, W, y1], fill=(74, 54, 38))
    for px in [0, 256, 512, 768, 1004]:
        fyd.rectangle([px, 0, px + 20, H], fill=(74, 54, 38))
    for (x0, y0, x1, y1) in [(16, 254, 256, 20), (780, 20, 1012, 254), (16, 494, 256, 260), (780, 260, 1012, 494)]:
        fyd.line([(x0, y0), (x1, y1)], fill=(74, 54, 38), width=16)
    save_jpg(fy_img, os.path.join(OUT_DIR, "wall_fachwerk_yellow_albedo.jpg"), quality=86)

    # C. Wooden Barn Double Gate (512x512)
    GW = 512
    grain_v = tileable_fbm(GW, GW, ((4, 32, 0.5), (8, 64, 0.3), (16, 128, 0.2)), seed=1212)
    gate = np.zeros((GW, GW, 3), dtype=np.float32)
    planks = 14
    pw = GW / planks
    px_idx = np.floor(np.arange(GW) / pw).astype(np.int32)
    rng_g = np.random.default_rng(1313)
    p_tint = rng_g.uniform(-12, 12, planks)
    base_w = (122.0, 90.0, 62.0)
    for c in range(3):
        gate[:, :, c] = base_w[c] + p_tint[px_idx][None, :] + (grain_v - 0.5) * 24.0
    img_g = Image.fromarray(np.clip(gate, 0, 255).astype(np.uint8), mode="RGB")
    dg = ImageDraw.Draw(img_g)
    h_gate = 0.55 + (grain_v - 0.5) * 0.12
    for i in range(1, planks):
        sx = int(i * pw)
        dg.line([(sx, 0), (sx, GW)], fill=(52, 36, 22), width=3)
        h_gate[:, max(0, sx - 2):min(GW, sx + 2)] = 0.25
    dg.rectangle([0, 0, GW - 1, GW - 1], outline=(64, 46, 30), width=16)
    dg.line([(GW // 2, 0), (GW // 2, GW)], fill=(32, 22, 14), width=5)
    for (lx0, lx1) in [(16, GW // 2 - 8), (GW // 2 + 8, GW - 16)]:
        dg.rectangle([lx0, 18, lx1, 42], fill=(96, 70, 46), outline=(52, 36, 22), width=2)
        dg.rectangle([lx0, GW - 42, lx1, GW - 18], fill=(96, 70, 46), outline=(52, 36, 22), width=2)
        dg.rectangle([lx0, GW // 2 - 12, lx1, GW // 2 + 12], fill=(96, 70, 46), outline=(52, 36, 22), width=2)
        dg.line([(lx0 + 8, 38), (lx1 - 8, GW // 2 - 10)], fill=(96, 70, 46), width=16)
        dg.line([(lx0 + 8, GW - 38), (lx1 - 8, GW // 2 + 10)], fill=(96, 70, 46), width=16)
    for hy in [92, GW - 108]:
        dg.rectangle([16, hy, 126, hy + 14], fill=(42, 44, 46))
        dg.rectangle([GW - 126, hy, GW - 16, hy + 14], fill=(42, 44, 46))
    save_jpg(img_g, os.path.join(OUT_DIR, "barn_gate_albedo.jpg"), quality=86)
    save_png(height_to_normal(h_gate, strength=3.8), os.path.join(OUT_DIR, "barn_gate_normal.png"))

    # D. German Village Residential Front Door (512x512)
    door_img = Image.new("RGB", (512, 512), (172, 126, 102))
    dd = ImageDraw.Draw(door_img)
    dd.rectangle([0, 0, 511, 511], fill=(172, 128, 106), outline=(124, 88, 72), width=8)
    dd.rectangle([52, 44, 460, 504], fill=(94, 62, 42), outline=(52, 34, 22), width=6)
    dd.rectangle([76, 68, 436, 152], fill=(64, 78, 92), outline=(232, 226, 214), width=6)
    for mx in [166, 256, 346]:
        dd.line([(mx, 68), (mx, 152)], fill=(232, 226, 214), width=5)
    for py0, py1 in [(182, 318), (344, 476)]:
        dd.rectangle([92, py0, 240, py1], fill=(110, 74, 50), outline=(56, 36, 24), width=5)
        dd.rectangle([272, py0, 420, py1], fill=(110, 74, 50), outline=(56, 36, 24), width=5)
    dd.ellipse([392, 318, 418, 344], fill=(204, 174, 96), outline=(118, 96, 46), width=3)
    save_jpg(door_img, os.path.join(OUT_DIR, "door_wood_albedo.jpg"), quality=86)

    # E. Utility / Garage Plaster + Peach-Cream Plain Plaster + Corrugated Metal Roof
    u_fbm = tileable_fbm(512, 512, ((8, 8, 0.5), (24, 24, 0.3), (64, 64, 0.2)), seed=1414)
    util = np.zeros((512, 512, 3), dtype=np.float32)
    for c, base_v in enumerate([218.0, 214.0, 204.0]):
        util[:, :, c] = base_v + (u_fbm - 0.5) * 22.0
    save_jpg(Image.fromarray(np.clip(util, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "wall_utility_albedo.jpg"), quality=86)

    peach = np.zeros((512, 512, 3), dtype=np.float32)
    for c, base_v in enumerate([226.0, 212.0, 194.0]):  # Warm pale peach-cream (Burgweg right!)
        peach[:, :, c] = base_v + (u_fbm - 0.5) * 18.0
    save_jpg(Image.fromarray(np.clip(peach, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "wall_peach_plain_albedo.jpg"), quality=86)

    cx = np.linspace(0, 24 * 2 * math.pi, 512, endpoint=False)[None, :]
    rib = 0.5 + 0.5 * np.sin(cx)
    metal = np.zeros((512, 512, 3), dtype=np.float32)
    for c, bv in enumerate([102.0, 106.0, 104.0]):
        metal[:, :, c] = bv + (rib - 0.5) * 28.0 + (u_fbm - 0.5) * 16.0
    save_jpg(Image.fromarray(np.clip(metal, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "roof_metal_albedo.jpg"), quality=86)
    save_png(height_to_normal(np.broadcast_to(rib, (512, 512)).astype(np.float32), strength=3.5),
             os.path.join(OUT_DIR, "roof_metal_normal.png"))


def generate_corridor_specials():
    """Generate specialized Street-View-exact textures for Kindenheim's photographed landmarks/corridors."""
    # 1. Photovoltaic Solar PV Array (Hauptstraße #60 QOQr & Burgweg QOSZ!) — 512x512
    SW = 512
    pv = np.zeros((SW, SW, 3), dtype=np.float32)
    yy = np.linspace(0, 1, SW, dtype=np.float32)[:, None]
    # Monocrystalline deep sapphire-slate reflection gradient
    pv[:, :, 0] = 36.0 + 26.0 * (1.0 - yy)
    pv[:, :, 1] = 52.0 + 38.0 * (1.0 - yy)
    pv[:, :, 2] = 82.0 + 54.0 * (1.0 - yy)
    pv_img = Image.fromarray(np.clip(pv, 0, 255).astype(np.uint8), mode="RGB")
    dpv = ImageDraw.Draw(pv_img)
    h_pv = np.full((SW, SW), 0.55, dtype=np.float32)
    # Fine silicon sub-cell lines (6x12 per panel)
    for x in range(0, SW, 32):
        dpv.line([(x, 0), (x, SW)], fill=(86, 104, 134), width=1)
    for y in range(0, SW, 32):
        dpv.line([(0, y), (SW, y)], fill=(86, 104, 134), width=1)
    # Crisp silver aluminum module frames (4 columns x 2 rows per tile)
    for x in range(0, SW, 128):
        dpv.rectangle([x, 0, min(SW - 1, x + 5), SW - 1], fill=(196, 202, 210))
        h_pv[:, x:min(SW, x + 5)] = 0.85
    for y in range(0, SW, 256):
        dpv.rectangle([0, y, SW - 1, min(SW - 1, y + 6)], fill=(196, 202, 210))
        h_pv[y:min(SW, y + 6), :] = 0.85
    save_jpg(pv_img, os.path.join(OUT_DIR, "solar_pv_albedo.jpg"), quality=88)
    save_png(height_to_normal(h_pv, strength=3.5).resize((256, 256), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "solar_pv_normal.png"))

    # 2. Lush Climbing English Ivy Foliage (Hedera helix — #60, #36, Michelsberg QOQB!) — 512x512
    IW = 512
    ivy_bg = tileable_fbm(IW, IW, ((8, 8, 0.5), (24, 24, 0.3), (64, 64, 0.2)), seed=3131)
    ivy_arr = np.zeros((IW, IW, 3), dtype=np.float32)
    ivy_arr[:, :, 0] = 30.0 + ivy_bg * 22.0
    ivy_arr[:, :, 1] = 56.0 + ivy_bg * 34.0
    ivy_arr[:, :, 2] = 20.0 + ivy_bg * 16.0
    ivy_img = Image.fromarray(np.clip(ivy_arr, 0, 255).astype(np.uint8), mode="RGB")
    idraw = ImageDraw.Draw(ivy_img)
    irng = np.random.default_rng(3232)
    h_ivy = 0.35 + ivy_bg * 0.25
    # 950 layered dark & sunlit ivy leaves for genuinely lush climbing greenery!
    for idx in range(950):
        lx = float(irng.uniform(0, IW))
        ly = float(irng.uniform(0, IW))
        rad = float(irng.uniform(9, 20))
        ang = float(irng.uniform(0, 2 * math.pi))
        sun = 0.72 + 0.55 * (idx / 950.0)
        col = (
            int(np.clip(irng.uniform(34, 68) * sun, 22, 108)),
            int(np.clip(irng.uniform(70, 118) * sun, 42, 152)),
            int(np.clip(irng.uniform(22, 42) * sun, 14, 62)),
        )
        edge = (max(0, col[0] - 18), max(0, col[1] - 26), max(0, col[2] - 12))
        # 3-lobed ivy leaf polygon (tiled across boundaries)
        for ox in (-IW, 0, IW):
            for oy in (-IW, 0, IW):
                cx_t, cy_t = lx + ox, ly + oy
                if -rad <= cx_t <= IW + rad and -rad <= cy_t <= IW + rad:
                    pts = []
                    for k in range(8):
                        a = ang + (k / 8.0) * 2.0 * math.pi
                        r = rad * (1.05 if k in (0, 2, 6) else 0.65)
                        pts.append((cx_t + math.cos(a) * r, cy_t + math.sin(a) * r))
                    idraw.polygon(pts, fill=col, outline=edge)
        iy0, iy1 = max(0, int(ly - rad * 0.5)), min(IW, int(ly + rad * 0.5))
        ix0, ix1 = max(0, int(lx - rad * 0.5)), min(IW, int(lx + rad * 0.5))
        h_ivy[iy0:iy1, ix0:ix1] = np.maximum(h_ivy[iy0:iy1, ix0:ix1], 0.55 + 0.40 * (idx / 950.0))
    save_jpg(ivy_img, os.path.join(OUT_DIR, "ivy_foliage_albedo.jpg"), quality=86)
    save_png(height_to_normal(h_ivy, strength=4.5).resize((256, 256), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "ivy_foliage_normal.png"))

    # 3. Vertical Weathered Wood Plank Cladding (Michelsberg corner QOQx upper gable!) — 512x512
    TW = 512
    t_fbm = tileable_fbm(TW, TW, ((4, 36, 0.5), (12, 72, 0.3), (32, 144, 0.2)), seed=3434)
    planks = 22
    pw = TW / planks
    p_idx = np.floor(np.arange(TW) / pw).astype(np.int32)
    trng = np.random.default_rng(3535)
    p_var = trng.uniform(-14, 14, planks)
    timb = np.zeros((TW, TW, 3), dtype=np.float32)
    for c, bv in enumerate([138.0, 112.0, 88.0]):  # Warm weathered cedar/oak (#8A7058)
        timb[:, :, c] = bv + p_var[p_idx][None, :] + (t_fbm - 0.5) * 26.0
    t_img = Image.fromarray(np.clip(timb, 0, 255).astype(np.uint8), mode="RGB")
    td = ImageDraw.Draw(t_img)
    for i in range(1, planks):
        sx = int(i * pw)
        td.line([(sx, 0), (sx, TW)], fill=(64, 50, 38), width=2)
    save_jpg(t_img, os.path.join(OUT_DIR, "wall_timber_vertical_albedo.jpg"), quality=86)

    # 4. Banded Yellow-Orange Sandstone/Brick Barn Masonry (Hauptstraße #95 right barn QP1S!) — 1024x512
    BW, BH = 1024, 512
    b_rows, b_cols = 20, 20
    byy = np.linspace(0, b_rows, BH, endpoint=False, dtype=np.float32)[:, None]
    br_idx = np.floor(byy).astype(np.int32)
    bfy = byy - br_idx
    bxx = (np.linspace(0, b_cols, BW, endpoint=False, dtype=np.float32)[None, :] + (br_idx % 2) * 0.5) % b_cols
    bc_idx = np.floor(bxx).astype(np.int32)
    bfx = bxx - bc_idx
    b_mort = ((bfy < 0.08) | (bfy > 0.94) | (bfx < 0.04) | (bfx > 0.96)).astype(np.float32)
    b_fbm = tileable_fbm(BH, BW, ((8, 16, 0.45), (24, 48, 0.35), (64, 128, 0.20)), seed=3636)
    brng = np.random.default_rng(3737)
    # Mix of warm yellow-ochre (#D4B476) and orange-terracotta (#B6784A) bricks like real #95!
    is_red = brng.random((b_rows, b_cols)) < 0.34
    br_r = np.where(is_red, brng.uniform(168, 198, (b_rows, b_cols)), brng.uniform(194, 218, (b_rows, b_cols))).astype(np.float32)
    br_g = np.where(is_red, brng.uniform(110, 138, (b_rows, b_cols)), brng.uniform(158, 184, (b_rows, b_cols))).astype(np.float32)
    br_b = np.where(is_red, brng.uniform(76, 102, (b_rows, b_cols)), brng.uniform(108, 134, (b_rows, b_cols))).astype(np.float32)
    # Horizontal gray concrete lintel band at row 9 (visible in sv_vineyard_edge_west!)
    br_r[9, :] = 158.0; br_g[9, :] = 154.0; br_b[9, :] = 148.0
    brick = np.zeros((BH, BW, 3), dtype=np.float32)
    for c, ch in enumerate([br_r, br_g, br_b]):
        v_b = ch[br_idx % b_rows, bc_idx % b_cols] + (b_fbm - 0.5) * 26.0
        brick[:, :, c] = v_b * (1.0 - b_mort) + (152.0 + (b_fbm - 0.5) * 14.0) * b_mort
    b_img = Image.fromarray(np.clip(brick, 0, 255).astype(np.uint8), mode="RGB")
    bd = ImageDraw.Draw(b_img)
    # Small horizontal glass-block barn vents
    for vx in [240, 752]:
        bd.rectangle([vx - 32, 118, vx + 32, 154], fill=(112, 122, 128), outline=(74, 72, 68), width=3)
        for gx in range(vx - 16, vx + 24, 16):
            bd.line([(gx, 118), (gx, 154)], fill=(168, 174, 178), width=2)
    save_jpg(b_img, os.path.join(OUT_DIR, "wall_brick_barn_yellow_albedo.jpg"), quality=86)

    # 5. Bauhaus Vertical-Slat Steel-Gray Sliding Carriage Gate (Weingut Kreutzenberger!) — 512x512
    GW = 512
    slats = 36
    sw = GW / slats
    sx_f = (np.arange(GW, dtype=np.float32) % sw) / sw
    groove_s = np.exp(-((np.minimum(sx_f, 1.0 - sx_f)) / 0.14) ** 2)
    g_fbm = tileable_fbm(GW, GW, ((6, 18, 0.5), (16, 48, 0.5)), seed=3838)
    slat_arr = np.zeros((GW, GW, 3), dtype=np.float32)
    for c, bv in enumerate([124.0, 134.0, 146.0]):  # Cool steel-blue-gray (#7C8692)
        slat_arr[:, :, c] = (bv + (g_fbm - 0.5) * 12.0) * (1.0 - 0.24 * groove_s)
    save_jpg(Image.fromarray(np.clip(slat_arr, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(OUT_DIR, "gate_bauhaus_slat_albedo.jpg"), quality=86)
    save_png(height_to_normal(np.broadcast_to((1.0 - 0.65 * groove_s), (GW, GW)).astype(np.float32), strength=3.5).resize((256, 256), Image.Resampling.LANCZOS),
             os.path.join(OUT_DIR, "gate_bauhaus_slat_normal.png"))

    # 6. Ornate Gray Arched Wrought-Iron Courtyard Gate (Hoftor — Hauptstraße #59!) — 512x512 RGBA
    gate_ir = Image.new("RGBA", (512, 512), (96, 100, 104, 0))
    gi = ImageDraw.Draw(gate_ir)
    iron_col = (146, 150, 154, 255)
    iron_dark = (88, 92, 96, 255)
    # Outer vertical posts & bottom rail
    gi.rectangle([8, 96, 28, 511], fill=iron_col, outline=iron_dark, width=2)
    gi.rectangle([484, 96, 504, 511], fill=iron_col, outline=iron_dark, width=2)
    gi.rectangle([248, 44, 264, 511], fill=iron_col, outline=iron_dark, width=2)
    gi.rectangle([8, 470, 504, 504], fill=iron_col, outline=iron_dark, width=2)
    gi.rectangle([8, 360, 504, 376], fill=iron_col, outline=iron_dark, width=2)
    # Arched top rail + double-arch ornamental pickets
    for px in range(36, 480, 22):
        # Parabolic arch peaking at center (x=256)
        dx = (px - 256.0) / 230.0
        top_y = int(42 + 68 * dx * dx)
        gi.rectangle([px - 4, top_y, px + 4, 496], fill=iron_col, outline=iron_dark, width=1)
        # Decorative spear finial
        gi.polygon([(px, top_y - 14), (px - 6, top_y + 2), (px + 6, top_y + 2)], fill=iron_col)
    # Smooth arched upper rails
    arch_pts = [(x, int(46 + 68 * ((x - 256.0) / 230.0) ** 2)) for x in range(12, 502, 8)]
    arch_pts2 = [(x, y + 36) for (x, y) in arch_pts]
    gi.line(arch_pts, fill=iron_col, width=10)
    gi.line(arch_pts2, fill=iron_col, width=7)
    # Dark gray mailbox on left gate leaf (visible in sv_hauptstrasse_west_weingueter!)
    gi.rectangle([154, 210, 224, 302], fill=(64, 68, 72, 255), outline=(36, 38, 40, 255), width=3)
    save_png(gate_ir, os.path.join(OUT_DIR, "gate_wrought_iron.png"))

    # 7. Dark Charcoal Courtyard Gate with Solid Lower Panel (Hauptstraße #45 right!) — 512x512 RGBA
    gate_dk = Image.new("RGBA", (512, 512), (44, 46, 50, 0))
    gd = ImageDraw.Draw(gate_dk)
    dk_col = (52, 54, 58, 255)
    dk_hi = (78, 82, 88, 255)
    # Solid lower half steel panel (y=215..512)
    gd.rectangle([6, 215, 506, 511], fill=(56, 58, 62, 255), outline=dk_hi, width=4)
    gd.line([(256, 215), (256, 511)], fill=(28, 30, 32, 255), width=6)
    # Upper arched spear pickets
    for px in range(28, 490, 28):
        dx = (px - 256.0) / 236.0
        top_y = int(38 + 76 * dx * dx)
        gd.rectangle([px - 4, top_y, px + 4, 220], fill=dk_col)
        gd.polygon([(px, top_y - 16), (px - 6, top_y + 2), (px + 6, top_y + 2)], fill=dk_col)
    arch_d = [(x, int(44 + 76 * ((x - 256.0) / 236.0) ** 2)) for x in range(8, 506, 8)]
    gd.line(arch_d, fill=dk_col, width=10)
    gd.rectangle([6, 118, 20, 511], fill=dk_col)
    gd.rectangle([492, 118, 506, 511], fill=dk_col)
    gd.rectangle([248, 44, 264, 511], fill=dk_col)
    save_png(gate_dk, os.path.join(OUT_DIR, "gate_iron_dark.png"))



# ---------------------------------------------------------------------------
# 4. Rural & Farming Simulator Prop PBR Textures
# ---------------------------------------------------------------------------

def draw_serrated_grape_leaf(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float, angle: float, col: tuple):
    """Draw a 5-lobed grapevine leaf silhouette with veins."""
    pts = []
    n_pts = 30
    for i in range(n_pts):
        a = (i / n_pts) * 2.0 * math.pi
        # 5-lobe grape leaf radial profile + fine serration
        lobe = 0.62 + 0.32 * math.cos(2.5 * a) ** 2 + 0.14 * math.sin(5.0 * a)
        # Stem notch at bottom (a near pi)
        notch = 1.0 - 0.55 * math.exp(-((a - math.pi) / 0.35) ** 2)
        serr = 1.0 + 0.08 * math.sin(18.0 * a)
        r = radius * lobe * notch * serr
        ca = a + angle
        pts.append((cx + math.cos(ca) * r, cy + math.sin(ca) * r))
    dark_edge = tuple(max(0, int(c * 0.72)) for c in col)
    draw.polygon(pts, fill=col + (255,), outline=dark_edge + (255,))
    # Main leaf veins
    vein_col = tuple(min(255, int(c * 1.24)) for c in col) + (235,)
    for va in [-0.95, -0.45, 0.0, 0.45, 0.95]:
        a2 = angle + va
        draw.line([(cx, cy), (cx + math.cos(a2) * radius * 0.75, cy + math.sin(a2) * radius * 0.75)], fill=vein_col, width=2)


def generate_prop_textures():
    # A. Tree Bark & Vine Wood Bark (512x512)
    S = 512
    bark_n = tileable_fbm(S, S, ((4, 24, 0.45), (12, 48, 0.35), (32, 96, 0.20)), seed=2020)
    bark = np.zeros((S, S, 3), dtype=np.float32)
    for c, bv in enumerate([92.0, 74.0, 56.0]):
        bark[:, :, c] = bv + (bark_n - 0.5) * 64.0
    save_jpg(Image.fromarray(np.clip(bark, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(PROPS_DIR, "bark_tree_albedo.jpg"), quality=88)
    save_png(height_to_normal(bark_n, strength=5.0), os.path.join(PROPS_DIR, "bark_tree_normal.png"))

    vine_n = tileable_fbm(S, S, ((4, 18, 0.5), (10, 40, 0.3), (28, 84, 0.2)), seed=2121)
    vbark = np.zeros((S, S, 3), dtype=np.float32)
    for c, bv in enumerate([108.0, 92.0, 74.0]):
        vbark[:, :, c] = bv + (vine_n - 0.5) * 58.0
    save_jpg(Image.fromarray(np.clip(vbark, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(PROPS_DIR, "bark_vine_albedo.jpg"), quality=88)

    # B. Grapevine Foliage + Grape Clusters Card (512x512 RGBA alpha-cutout, lush rich Pfalz summer green matching sv_vineyard_edge_east!)
    vleaf = Image.new("RGBA", (512, 512), (38, 68, 24, 0))
    vd = ImageDraw.Draw(vleaf)
    rng = np.random.default_rng(2222)
    # Subtle woody vine shoots crossing behind leaves
    for _ in range(14):
        x0, y0 = int(rng.integers(24, 488)), int(rng.integers(100, 470))
        x1, y1 = int(rng.integers(24, 488)), int(rng.integers(30, 400))
        vd.line([(x0, y0), (x1, y1)], fill=(86, 66, 44, 255), width=6)
    # 95 lush dense overlapping serrated grapevine leaves matching real Kindenheim Aug 2023 vineyards (#355226-#4F6E33)
    for i in range(96):
        cx = float(rng.uniform(42, 470))
        cy = float(rng.uniform(42, 456))
        rad = float(rng.uniform(36, 64))
        ang = float(rng.uniform(0, 2 * math.pi))
        sun = 1.08 - (cy / 512.0) * 0.42
        r_c = int(np.clip(rng.uniform(42, 74) * sun, 24, 96))
        g_c = int(np.clip(rng.uniform(76, 122) * sun, 44, 146))
        b_c = int(np.clip(rng.uniform(22, 44) * sun, 14, 58))
        draw_serrated_grape_leaf(vd, cx, cy, rad, ang, (r_c, g_c, b_c))
    # Prominent dark-purple Spätburgunder & Riesling grape clusters hanging in lower-mid canopy (matching sv_vineyard_edge_east!)
    for cluster_idx in range(5):
        gx = float(rng.uniform(80, 432))
        gy = float(rng.uniform(255, 395))
        is_red = (cluster_idx != 3)
        for row_i in range(6):
            n_b = max(1, 6 - row_i)
            for bi in range(n_b):
                bx = gx + (bi - (n_b - 1) * 0.5) * 11 + rng.uniform(-2, 2)
                by = gy + row_i * 10 + rng.uniform(-1, 1)
                if is_red:
                    bc = (int(rng.integers(42, 64)), int(rng.integers(26, 42)), int(rng.integers(64, 94)), 255)
                    hi = (108, 92, 134, 255)
                else:
                    bc = (int(rng.integers(116, 148)), int(rng.integers(142, 174)), int(rng.integers(48, 72)), 255)
                    hi = (184, 206, 112, 255)
                vd.ellipse([bx - 7, by - 7, bx + 7, by + 7], fill=bc, outline=(22, 16, 28, 255))
                vd.ellipse([bx - 3, by - 4, bx, by - 1], fill=hi)
    save_png(vleaf, os.path.join(PROPS_DIR, "vine_leaves.png"))

    # C. Deciduous & Orchard Tree Foliage Cluster Cards (rich natural German summer greens, fuller silhouette!)
    for fname, mode in [("tree_foliage_deciduous.png", "deciduous"), ("tree_foliage_orchard.png", "orchard")]:
        timg = Image.new("RGBA", (512, 512), (42, 74, 30, 0))
        td = ImageDraw.Draw(timg)
        trng = np.random.default_rng(3030 if mode == "deciduous" else 4040)
        for _ in range(16):
            a = trng.uniform(-2.6, -0.5)
            dist = trng.uniform(120, 235)
            td.line([(256, 440), (256 + math.cos(a) * dist, 380 + math.sin(a) * dist)], fill=(74, 56, 38, 255), width=5)
        n_leaves = 210 if mode == "deciduous" else 185
        for _ in range(n_leaves):
            rad_c = abs(trng.normal(0.0, 128.0))
            ang_c = trng.uniform(0, 2 * math.pi)
            lx = 256 + math.cos(ang_c) * min(rad_c, 222)
            ly = 250 + math.sin(ang_c) * min(rad_c, 212)
            l_len = trng.uniform(25, 46)
            l_wid = l_len * trng.uniform(0.46, 0.66)
            rot = trng.uniform(0, 2 * math.pi)
            sun = 1.08 - (ly / 512.0) * 0.38
            if mode == "deciduous":
                col = (
                    int(np.clip(trng.uniform(38, 72) * sun, 22, 98)),
                    int(np.clip(trng.uniform(76, 122) * sun, 44, 148)),
                    int(np.clip(trng.uniform(24, 48) * sun, 14, 64)),
                    255,
                )
            else:
                col = (
                    int(np.clip(trng.uniform(48, 86) * sun, 28, 112)),
                    int(np.clip(trng.uniform(88, 134) * sun, 52, 160)),
                    int(np.clip(trng.uniform(28, 52) * sun, 18, 68)),
                    255,
                )
            pts = []
            for px, py in [(-l_len, 0), (-l_len * 0.3, -l_wid), (l_len * 0.35, -l_wid * 0.85), (l_len, 0), (l_len * 0.35, l_wid * 0.85), (-l_len * 0.3, l_wid)]:
                rx = lx + px * math.cos(rot) - py * math.sin(rot)
                ry = ly + px * math.sin(rot) + py * math.cos(rot)
                pts.append((rx, ry))
            outline = (max(0, col[0] - 20), max(0, col[1] - 28), max(0, col[2] - 14), 255)
            td.polygon(pts, fill=col, outline=outline)

        if mode == "orchard":
            for _ in range(16):
                ax = float(trng.uniform(100, 410))
                ay = float(trng.uniform(100, 395))
                ar = float(trng.uniform(6, 9))
                td.ellipse([ax - ar, ay - ar, ax + ar, ay + ar], fill=(182, 46, 38, 255), outline=(108, 22, 18, 255))
                td.ellipse([ax - ar * 0.4, ay - ar * 0.5, ax, ay - ar * 0.1], fill=(228, 136, 110, 255))
        save_png(timg, os.path.join(PROPS_DIR, fname))

    # D. Authentic German Ortsschild ("Kindenheim / Landkreis Bad Dürkheim")
    # Official StVO Zeichen 310 ratio ~ 900mm x 600mm => 1024 x 682
    OW, OH = 1024, 682
    RAL_YELLOW = (245, 198, 12)
    BLACK = (22, 22, 24)
    RED = (196, 30, 34)

    # Front: Zeichen 310 Ortstafel Vorderseite
    front = Image.new("RGB", (OW, OH), RAL_YELLOW)
    df = ImageDraw.Draw(front)
    # Crisp black StVO outer & rounded inner frame
    df.rounded_rectangle([24, 24, OW - 24, OH - 24], radius=38, outline=BLACK, width=22)

    font_big = load_font(154, condensed=False)
    font_sub = load_font(62, condensed=False)
    title = "Kindenheim"
    sub = "Landkreis Bad Dürkheim"

    tb = df.textbbox((0, 0), title, font=font_big)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    df.text(((OW - tw) // 2 - tb[0], 138 - tb[1]), title, fill=BLACK, font=font_big)

    sb = df.textbbox((0, 0), sub, font=font_sub)
    sw, sh = sb[2] - sb[0], sb[3] - sb[1]
    df.text(((OW - sw) // 2 - sb[0], 438 - sb[1]), sub, fill=BLACK, font=font_sub)

    # Subtle realistic enameled aluminum micro-sheen
    save_png(front, os.path.join(PROPS_DIR, "ortsschild_front.png"))

    # Back: Zeichen 311 Ortsausgangsschild (crossed out Kindenheim + Bockenheim 2 km)
    back = Image.new("RGB", (OW, OH), RAL_YELLOW)
    db = ImageDraw.Draw(back)
    db.rounded_rectangle([24, 24, OW - 24, OH - 24], radius=38, outline=BLACK, width=22)

    font_exit_top = load_font(86, condensed=False)
    font_exit_bot = load_font(126, condensed=False)
    top_txt = "Bockenheim 2 km"
    t1 = db.textbbox((0, 0), top_txt, font=font_exit_top)
    db.text(((OW - (t1[2] - t1[0])) // 2 - t1[0], 112 - t1[1]), top_txt, fill=BLACK, font=font_exit_top)
    # Divider line
    db.line([(68, 306), (OW - 68, 306)], fill=BLACK, width=10)
    t2 = db.textbbox((0, 0), title, font=font_exit_bot)
    db.text(((OW - (t2[2] - t2[0])) // 2 - t2[0], 392 - t2[1]), title, fill=BLACK, font=font_exit_bot)
    # Official red diagonal slash across bottom half (Zeichen 311)
    db.line([(106, OH - 52), (OW - 106, 318)], fill=RED, width=38)
    save_png(back, os.path.join(PROPS_DIR, "ortsschild_back.png"))

    # E. Golden Round Hay Bale (512x512 wrap + 512x512 spiral end cap packed side-by-side in 1024x512!)
    HW, HH = 1024, 512
    hay_img = np.zeros((HH, HW, 3), dtype=np.float32)
    h_hay = np.zeros((HH, HW), dtype=np.float32)

    # Left half [0..512]: longitudinal straw fibers + baler twine lines
    straw_n = tileable_fbm(512, 512, ((32, 6, 0.45), (64, 12, 0.35), (128, 24, 0.20)), seed=5050)
    straw_fine = tileable_fbm(512, 512, ((96, 16, 0.6), (192, 32, 0.4)), seed=5151)
    for c, bv in enumerate([196.0, 162.0, 88.0]):
        hay_img[:, :512, c] = bv + (straw_n - 0.5) * 62.0 + (straw_fine - 0.5) * 32.0
    h_hay[:, :512] = 0.5 * straw_n + 0.5 * straw_fine
    # Subtle twine wrap grooves across cylinder
    for ty in [82, 168, 256, 344, 430]:
        hay_img[ty - 2:ty + 3, :512, :] *= 0.72
        h_hay[ty - 2:ty + 3, :512] -= 0.22

    # Right half [512..1024]: spiral wound straw end cap!
    yy_s, xx_s = np.mgrid[0:512, 0:512].astype(np.float32)
    dx_s = (xx_s - 256.0) / 256.0
    dy_s = (yy_s - 256.0) / 256.0
    r_s = np.sqrt(dx_s * dx_s + dy_s * dy_s)
    ang_s = np.arctan2(dy_s, dx_s)
    spiral = 0.5 + 0.5 * np.sin(r_s * 38.0 + ang_s * 2.0)
    fib_end = tileable_fbm(512, 512, ((16, 16, 0.5), (48, 48, 0.3), (96, 96, 0.2)), seed=5252)
    for c, bv in enumerate([186.0, 152.0, 78.0]):
        hay_img[:, 512:, c] = bv + (spiral - 0.5) * 44.0 + (fib_end - 0.5) * 48.0
    h_hay[:, 512:] = 0.45 * spiral + 0.55 * fib_end

    save_jpg(Image.fromarray(np.clip(hay_img, 0, 255).astype(np.uint8), mode="RGB"),
             os.path.join(PROPS_DIR, "hay_bale_albedo.jpg"), quality=88)
    save_png(height_to_normal(h_hay, strength=4.5).resize((512, 256), Image.Resampling.LANCZOS),
             os.path.join(PROPS_DIR, "hay_bale_normal.png"))

    # F. Oak Wine Barrel Staves & Iron Hoops (512x512)
    BW = 512
    oak_n = tileable_fbm(BW, BW, ((4, 32, 0.5), (12, 64, 0.3), (32, 128, 0.2)), seed=6060)
    staves = 20
    sw = BW / staves
    s_idx = np.floor(np.arange(BW) / sw).astype(np.int32)
    srng = np.random.default_rng(6161)
    s_jit = srng.uniform(-16, 16, staves)
    barrel = np.zeros((BW, BW, 3), dtype=np.float32)
    for c, bv in enumerate([128.0, 88.0, 54.0]):
        barrel[:, :, c] = bv + s_jit[s_idx][None, :] + (oak_n - 0.5) * 32.0
    # Wine-stain subtle darkening near center bung & bottom
    yv = np.linspace(0, 1, BW, dtype=np.float32)[:, None]
    barrel *= (0.86 + 0.14 * np.sin(yv * math.pi))
    b_img = Image.fromarray(np.clip(barrel, 0, 255).astype(np.uint8), mode="RGB")
    bd = ImageDraw.Draw(b_img)
    h_bar = 0.52 + (oak_n - 0.5) * 0.14
    for i in range(staves):
        sx = int(i * sw)
        bd.line([(sx, 0), (sx, BW)], fill=(48, 30, 18), width=2)
        h_bar[:, max(0, sx - 1):min(BW, sx + 2)] = 0.25
    save_jpg(b_img, os.path.join(PROPS_DIR, "wine_barrel_albedo.jpg"), quality=90)
    save_png(height_to_normal(h_bar, strength=3.5), os.path.join(PROPS_DIR, "wine_barrel_normal.png"))


def main():
    print("Generating Kindenheim Pfalz PBR textures...")
    generate_pfalz_facades()
    generate_roof_tiles()
    generate_stone_and_barn()
    generate_corridor_specials()
    generate_prop_textures()
    files = sorted(os.listdir(OUT_DIR))
    pfiles = sorted(os.listdir(PROPS_DIR))
    print(f"Done! Generated {len(files) - 1} architectural textures and {len(pfiles)} prop textures.")


if __name__ == "__main__":
    main()
