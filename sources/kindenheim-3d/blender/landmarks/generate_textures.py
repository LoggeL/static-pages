#!/usr/bin/env python3
"""
Procedural PBR Texture Library for Kindenheim (Pfalz) Hero Landmarks.
Generates seamless high-resolution Albedo (RGB), Roughness (L), and Tangent-Space Normal (RGB)
maps using vectorized NumPy + Pillow. All textures are calibrated for Blender Principled BSDF
and glTF 2.0 PBR export (and reusable for Farming Simulator GIANTS .i3d export).
"""

import math
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_DIR = Path(__file__).resolve().parent / "textures"


# ---------------------------------------------------------------------------
# Fast tileable procedural noise helpers (vectorized numpy)
# ---------------------------------------------------------------------------

def tileable_value_noise(size: int, grid: int, seed: int = 0) -> np.ndarray:
    """Smooth tileable 2D value noise in [0, 1] of shape (size, size)."""
    rng = np.random.default_rng(seed)
    base = rng.random((grid, grid), dtype=np.float32)
    coords = np.linspace(0, grid, size, endpoint=False, dtype=np.float32)
    ix = np.floor(coords).astype(np.int32) % grid
    fx = coords - np.floor(coords)
    # Quintic smoothstep
    u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0)
    ix1 = (ix + 1) % grid

    # Broadcast 2D bilinear interpolation
    v00 = base[np.ix_(ix, ix)]
    v10 = base[np.ix_(ix, ix1)]
    v01 = base[np.ix_(ix1, ix)]
    v11 = base[np.ix_(ix1, ix1)]

    ux = u[None, :]
    uy = u[:, None]
    nx0 = v00 * (1.0 - ux) + v10 * ux
    nx1 = v01 * (1.0 - ux) + v11 * ux
    return nx0 * (1.0 - uy) + nx1 * uy


def fbm(size: int, octaves=(4, 8, 16, 32, 64), weights=None, seed: int = 42) -> np.ndarray:
    """Multi-octave tileable fractional Brownian motion normalized to [0, 1]."""
    if weights is None:
        weights = [0.5 ** i for i in range(len(octaves))]
    acc = np.zeros((size, size), dtype=np.float32)
    wsum = 0.0
    for i, (g, w) in enumerate(zip(octaves, weights)):
        acc += w * tileable_value_noise(size, g, seed + i * 137)
        wsum += w
    acc /= max(wsum, 1e-6)
    return acc


def height_to_normal(height: np.ndarray, strength: float = 2.0) -> np.ndarray:
    """Convert tileable heightfield [0..1] to OpenGL tangent-space normal RGB uint8 [0..255]."""
    # Sobel / central finite differences with periodic wrap
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    # OpenGL/glTF normal convention: +X right, +Y up (so image row down = -Y)
    nx = -dx
    ny = dy
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    nx /= length
    ny /= length
    nz /= length
    rgb = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5)], axis=-1)
    return np.clip(rgb * 255.0, 0, 255).astype(np.uint8)


def save_pbr(name: str, albedo: np.ndarray, roughness: np.ndarray, normal: np.ndarray,
             metallic: np.ndarray | None = None, normal_size: int = 512, rough_size: int = 512):
    """Save PBR texture set into OUT_DIR with web-optimized map resolutions (crisp albedo + clean normal/roughness)."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(albedo, 0, 255).astype(np.uint8), mode="RGB").save(
        OUT_DIR / f"{name}_albedo.jpg", quality=88, optimize=True
    )
    r_img = Image.fromarray(np.clip(roughness * 255.0, 0, 255).astype(np.uint8), mode="L")
    if r_img.width > rough_size:
        r_img = r_img.resize((rough_size, rough_size), Image.Resampling.BILINEAR)
    r_img.save(OUT_DIR / f"{name}_roughness.jpg", quality=84, optimize=True)

    n_img = Image.fromarray(np.clip(normal, 0, 255).astype(np.uint8), mode="RGB")
    if n_img.width > normal_size:
        n_img = n_img.resize((normal_size, normal_size), Image.Resampling.BILINEAR)
    n_img.save(OUT_DIR / f"{name}_normal.png", optimize=True)

    if metallic is not None:
        m_img = Image.fromarray(np.clip(metallic * 255.0, 0, 255).astype(np.uint8), mode="L")
        if m_img.width > rough_size:
            m_img = m_img.resize((rough_size, rough_size), Image.Resampling.BILINEAR)
        m_img.save(OUT_DIR / f"{name}_metallic.jpg", quality=84, optimize=True)


def lerp_color(c0, c1, t):
    """Linearly interpolate two RGB colors using array t in [0, 1]."""
    t = np.clip(t, 0.0, 1.0)[..., None]
    return np.array(c0, dtype=np.float32) * (1.0 - t) + np.array(c1, dtype=np.float32) * t


# ---------------------------------------------------------------------------
# 1. Warm Pfalz Lime Stucco Plaster (3 authentic Palatinate colorways)
# ---------------------------------------------------------------------------

def gen_stucco(name: str, base_rgb, dark_rgb, warm_rgb, seed: int, size: int = 1024):
    macro = fbm(size, (4, 8, 16), [0.55, 0.3, 0.15], seed=seed)
    mid = fbm(size, (16, 32, 64), [0.5, 0.35, 0.15], seed=seed + 19)
    fine = fbm(size, (64, 128, 256), [0.45, 0.35, 0.2], seed=seed + 53)

    # Trowel sweep streaks (slight diagonal directional wave)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    trowel = 0.5 + 0.5 * np.sin(2.0 * math.pi * (xx * 6.0 + yy * 3.0 + macro * 1.8))

    # Color blending: rich mineral lime plaster variation
    col = lerp_color(dark_rgb, base_rgb, np.clip(macro * 0.7 + mid * 0.3, 0, 1))
    col = lerp_color(col, warm_rgb, np.clip((trowel * 0.3 + fine * 0.7 - 0.45) * 0.6, 0, 0.45))

    # Subtle weathered mineral speckles & hairline micro-pits
    pits = (fine < 0.24).astype(np.float32)
    col *= (1.0 - pits[..., None] * 0.08)

    height = 0.45 * mid + 0.40 * fine + 0.15 * trowel - pits * 0.20
    normal = height_to_normal(height, strength=2.6)
    roughness = np.clip(0.84 + (1.0 - fine) * 0.12 - trowel * 0.04, 0.72, 0.97)
    save_pbr(name, col, roughness, normal)


# ---------------------------------------------------------------------------
# 2. Pfälzer Sandstein (Red Buntsandstein & Yellow Leiningerland Sandstone)
# ---------------------------------------------------------------------------

def gen_sandstone(name: str, palette, mortar_rgb, rows: int, cols: int, seed: int, size: int = 1024, jitter_amp: float = 9.0):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size

    row_f = yy * rows
    row_i = np.floor(row_f).astype(np.int32) % rows
    row_frac = row_f - np.floor(row_f)

    # Running bond half-brick stagger on alternating rows
    stagger = (row_i % 2) * 0.5
    col_f = (xx * cols + stagger) % cols
    col_i = np.floor(col_f).astype(np.int32) % cols
    col_frac = col_f - np.floor(col_f)

    # Per-block random color & shade variation
    block_colors = np.zeros((rows, cols, 3), dtype=np.float32)
    block_height_off = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            base_c = np.array(palette[rng.integers(0, len(palette))], dtype=np.float32)
            jitter = rng.uniform(-jitter_amp, jitter_amp, size=3)
            block_colors[r, c] = np.clip(base_c + jitter, 20, 245)
            block_height_off[r, c] = rng.uniform(0.76, 0.94)

    stone_col = block_colors[row_i, col_i]
    stone_h = block_height_off[row_i, col_i]

    # Natural stone grain & chiseled dressing
    grain_macro = fbm(size, (8, 16, 32), [0.5, 0.3, 0.2], seed=seed + 7)
    grain_fine = fbm(size, (64, 128, 256), [0.5, 0.3, 0.2], seed=seed + 31)
    # Slight horizontal sedimentary bedding lines
    bedding = 0.5 + 0.5 * np.sin(2.0 * math.pi * (yy * rows * 4.0 + grain_macro * 1.4))

    # Mortar joints with slightly organic hand-hewn edges
    edge_wobble = (grain_macro - 0.5) * 0.03
    mh = 0.055  # horizontal mortar fraction of row height
    mv = 0.024  # vertical mortar fraction of col width
    dist_h = np.minimum(row_frac, 1.0 - row_frac) + edge_wobble
    dist_v = np.minimum(col_frac, 1.0 - col_frac) + edge_wobble * 0.5

    bevel_h = np.clip((dist_h - mh) / 0.07, 0.0, 1.0)
    bevel_v = np.clip((dist_v - mv) / 0.04, 0.0, 1.0)
    stone_mask = np.minimum(bevel_h, bevel_v)
    mortar_mask = 1.0 - np.clip(stone_mask * 2.2, 0.0, 1.0)

    # Apply natural texture to stone faces
    stone_textured = stone_col * (0.86 + 0.20 * grain_macro[..., None] + 0.08 * bedding[..., None]) - (1.0 - grain_fine[..., None]) * 14.0
    mortar_col = np.array(mortar_rgb, dtype=np.float32)[None, None, :] * (0.88 + 0.24 * grain_fine[..., None])

    albedo = stone_textured * (1.0 - mortar_mask[..., None]) + mortar_col * mortar_mask[..., None]
    # Darken crevices right next to mortar for crisp ambient occlusion
    ao = 0.80 + 0.20 * np.clip(stone_mask, 0.0, 1.0)
    albedo *= ao[..., None]

    height = (stone_h * (0.78 + 0.14 * grain_macro + 0.08 * grain_fine)) * np.power(stone_mask, 0.55) + 0.12 * grain_fine * mortar_mask
    normal = height_to_normal(height, strength=5.5)
    roughness = np.clip(0.76 + (1.0 - grain_fine) * 0.14 + mortar_mask * 0.12, 0.65, 0.98)
    save_pbr(name, albedo, roughness, normal)


# ---------------------------------------------------------------------------
# 3. Palatinate Clay Roof Tiles (Frankfurter Pfanne / Biberschwanz)
# ---------------------------------------------------------------------------

def gen_clay_roof_tiles(name: str, seed: int = 101, size: int = 1024):
    rng = np.random.default_rng(seed)
    rows = 14
    cols = 20
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size

    row_f = yy * rows
    row_i = np.floor(row_f).astype(np.int32) % rows
    row_frac = row_f - np.floor(row_f)  # 0 at top of tile, 1 at bottom lip

    col_f = xx * cols
    col_i = np.floor(col_f).astype(np.int32) % cols
    col_frac = col_f - np.floor(col_f)

    # Classic Pfalz terracotta palette (rich burnt clay with subtle aged darker tiles)
    palette = [
        (168, 72, 46),
        (154, 62, 40),
        (178, 82, 52),
        (138, 55, 38),
        (162, 68, 44),
        (124, 52, 36),
    ]
    tile_rgb = np.zeros((rows, cols, 3), dtype=np.float32)
    tile_moss = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            base = np.array(palette[rng.integers(0, len(palette))], dtype=np.float32)
            tile_rgb[r, c] = np.clip(base + rng.uniform(-10, 10, 3), 30, 220)
            tile_moss[r, c] = rng.uniform(0.0, 1.0)

    col = tile_rgb[row_i, col_i]
    moss_seed = tile_moss[row_i, col_i]

    # S-profile pantile / Frankfurter Pfanne wave across each tile width
    wave = 0.5 + 0.5 * np.sin(2.0 * math.pi * (col_frac - 0.25))
    # Steep shadow lip at bottom overlap (row_frac near 1.0 -> drops sharply to next tile)
    ramp = 0.25 + 0.75 * row_frac
    lip_shadow = 1.0 - 0.45 * np.exp(-((row_frac) / 0.11) ** 2)
    valley_ao = 0.80 + 0.20 * wave

    # Interlocking side seam line
    side_seam = np.exp(-((np.minimum(col_frac, 1.0 - col_frac)) / 0.045) ** 2)

    weather = fbm(size, (4, 8, 16, 32), [0.45, 0.3, 0.15, 0.1], seed=seed + 11)
    fine = fbm(size, (64, 128), [0.6, 0.4], seed=seed + 29)

    # Dark soot/lichen weathering mostly in valleys and upper crevices
    grime = np.clip((weather - 0.42) * 1.4, 0, 1) * (1.0 - 0.5 * wave) * (1.0 - 0.4 * row_frac)
    moss_mask = np.clip((weather - 0.58) * 2.5 * moss_seed * (1.0 - wave * 0.6), 0, 0.45)

    albedo = col * (0.85 + 0.22 * fine[..., None]) * lip_shadow[..., None] * valley_ao[..., None]
    albedo *= (1.0 - 0.22 * side_seam[..., None])
    albedo = lerp_color(albedo, (58, 42, 34), grime * 0.55)
    albedo = lerp_color(albedo, (76, 86, 52), moss_mask)

    height = (0.48 * ramp + 0.42 * wave - 0.25 * side_seam + 0.08 * fine)
    normal = height_to_normal(height, strength=6.5)
    roughness = np.clip(0.68 + grime * 0.18 + moss_mask * 0.20 + (1.0 - fine) * 0.10, 0.55, 0.96)
    save_pbr(name, albedo, roughness, normal)


# ---------------------------------------------------------------------------
# 4. Dark Hunsrück / Pfalz Slate Shingles (for Church Spire & Rathaus Belfry)
# ---------------------------------------------------------------------------

def gen_slate_roof(name: str, seed: int = 202, size: int = 1024):
    rng = np.random.default_rng(seed)
    rows = 22
    cols = 18
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size

    row_f = yy * rows
    row_i = np.floor(row_f).astype(np.int32) % rows
    row_frac = row_f - np.floor(row_f)

    stagger = (row_i % 2) * 0.5
    col_f = (xx * cols + stagger) % cols
    col_i = np.floor(col_f).astype(np.int32) % cols
    col_frac = col_f - np.floor(col_f)

    # Scalloped / rounded bottom edge per shingle
    dx = (col_frac - 0.5) * 2.0
    scallop = 0.82 + 0.18 * np.sqrt(np.clip(1.0 - dx * dx, 0, 1))
    in_lip = (row_frac > scallop).astype(np.float32)

    palette = [
        (56, 62, 70),
        (48, 54, 62),
        (66, 72, 80),
        (44, 49, 58),
        (60, 64, 72),
    ]
    shingle_rgb = np.zeros((rows, cols, 3), dtype=np.float32)
    shingle_rough = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            shingle_rgb[r, c] = np.clip(np.array(palette[rng.integers(0, len(palette))]) + rng.uniform(-5, 5, 3), 25, 110)
            shingle_rough[r, c] = rng.uniform(0.38, 0.56)

    # Where row_frac > scallop, we see the shingle beneath (next row down, shifted)
    col = shingle_rgb[row_i, col_i]
    rough_base = shingle_rough[row_i, col_i]

    grain = fbm(size, (16, 32, 64, 128), [0.4, 0.3, 0.2, 0.1], seed=seed + 13)
    # Subtle slate cleavage sheen
    seam_v = np.exp(-((np.minimum(col_frac, 1.0 - col_frac)) / 0.04) ** 2)
    lip_ao = 1.0 - 0.38 * np.exp(-((row_frac - scallop) / 0.08) ** 2)

    albedo = col * (0.85 + 0.28 * grain[..., None]) * lip_ao[..., None] * (1.0 - 0.25 * seam_v[..., None])
    # Faint pale silver-green lichen spots
    lichen = np.clip((fbm(size, (8, 16, 32), seed=seed + 77) - 0.68) * 3.0, 0, 0.25)
    albedo = lerp_color(albedo, (118, 126, 108), lichen)

    height = (0.3 + 0.65 * row_frac) * (1.0 - 0.5 * in_lip) - 0.22 * seam_v + 0.10 * grain
    normal = height_to_normal(height, strength=4.8)
    roughness = np.clip(rough_base + (1.0 - grain) * 0.14 + lichen * 0.35, 0.32, 0.85)
    save_pbr(name, albedo, roughness, normal)


# ---------------------------------------------------------------------------
# 5. Wood Textures (Timber beams, Barn planks, Barrel oak, Louvered shutters)
# ---------------------------------------------------------------------------

def gen_wood_planks(name: str, base_rgb, dark_rgb, plank_count: int, seed: int, size: int = 1024):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size

    col_f = xx * plank_count
    col_i = np.floor(col_f).astype(np.int32) % plank_count
    col_frac = col_f - np.floor(col_f)

    # Anisotropic vertical wood grain
    n_low = fbm(size, (4, 8, 16), seed=seed + 3)
    # Stretch noise vertically by sampling fine noise
    grain_x = tileable_value_noise(size, 64, seed=seed + 17)
    grain_y = tileable_value_noise(size, 8, seed=seed + 23)
    rings = 0.5 + 0.5 * np.sin(2.0 * math.pi * (xx * plank_count * 3.5 + n_low * 2.2 + grain_y * 0.8))
    fibers = 0.5 * grain_x + 0.5 * fbm(size, (32, 64, 128), seed=seed + 41)

    plank_tint = rng.uniform(0.84, 1.14, size=plank_count).astype(np.float32)
    plank_shift = rng.uniform(-0.08, 0.08, size=plank_count).astype(np.float32)

    t = np.clip(rings * 0.55 + fibers * 0.45 + plank_shift[col_i], 0.0, 1.0)
    albedo = lerp_color(dark_rgb, base_rgb, t) * plank_tint[col_i][..., None]

    # Deep V-grooves between vertical planks
    seam = np.exp(-((np.minimum(col_frac, 1.0 - col_frac)) / 0.035) ** 2)
    albedo *= (1.0 - 0.58 * seam[..., None])

    height = 0.65 + 0.15 * rings + 0.12 * fibers - 0.55 * seam
    normal = height_to_normal(height, strength=4.2)
    roughness = np.clip(0.68 + (1.0 - fibers) * 0.18 + seam * 0.15, 0.50, 0.96)
    save_pbr(name, albedo, roughness, normal)


def gen_louver_texture(name: str, slat_rgb, dark_rgb, slats: int, seed: int, size: int = 512):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    slat_f = yy * slats
    slat_frac = slat_f - np.floor(slat_f)

    grain = fbm(size, (8, 32, 64), seed=seed)
    # Angled louvre profile: bright sloped top, sharp dark shadow gap at bottom
    ramp = np.clip(slat_frac / 0.78, 0.0, 1.0)
    gap = (slat_frac > 0.78).astype(np.float32)

    albedo = lerp_color(dark_rgb, slat_rgb, (0.35 + 0.65 * ramp) * (1.0 - 0.78 * gap))
    albedo *= (0.90 + 0.18 * grain[..., None])

    height = ramp * (1.0 - gap) + 0.05 * grain
    normal = height_to_normal(height, strength=6.0)
    roughness = np.clip(0.56 + gap * 0.35 + (1.0 - grain) * 0.12, 0.42, 0.95)
    save_pbr(name, albedo, roughness, normal)


# ---------------------------------------------------------------------------
# 6. Windows (Warm reflective residential + Church leaded diamond glass)
# ---------------------------------------------------------------------------

def gen_window_glass_warm(name: str, size: int = 512):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    # Subtle warm interior glow / curtain suggestion behind dark reflective glass
    noise = fbm(size, (4, 8, 16), seed=303)
    curtain = 0.5 + 0.5 * np.sin(2.0 * math.pi * (xx * 5.0 + noise * 0.3))
    interior = lerp_color((24, 34, 46), (56, 62, 68), 0.35 + 0.35 * (1.0 - yy) + 0.25 * curtain * (1.0 - abs(xx - 0.5) * 1.4))
    # Subtle warm amber highlight in lower middle
    warmth = np.exp(-(((xx - 0.5) / 0.38) ** 2 + ((yy - 0.62) / 0.35) ** 2))
    albedo = lerp_color(interior, (98, 86, 68), warmth * 0.35)

    # Very subtle historic glass waviness
    height = 0.5 + 0.08 * noise
    normal = height_to_normal(height, strength=0.6)
    roughness = np.clip(0.06 + 0.06 * noise, 0.04, 0.16)
    save_pbr(name, albedo, roughness, normal)


def gen_window_glass_church(name: str, size: int = 512):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    # Classic German Protestant village church leaded diamond quarry glass
    freq = 9.0
    d1 = np.abs(((xx + yy) * freq) % 1.0 - 0.5)
    d2 = np.abs(((xx - yy) * freq) % 1.0 - 0.5)
    lead = ((d1 < 0.055) | (d2 < 0.055)).astype(np.float32)

    # Subtle stained glass palette per diamond cell
    c1 = np.floor((xx + yy) * freq).astype(np.int32)
    c2 = np.floor((xx - yy) * freq).astype(np.int32)
    cell_hash = ((c1 * 73856093) ^ (c2 * 19349663)) & 255
    hue_var = (cell_hash.astype(np.float32) / 255.0)

    noise = fbm(size, (8, 16, 32), seed=404)
    glass_col = lerp_color((42, 58, 72), (108, 114, 96), hue_var * 0.65 + noise * 0.35)
    # Subtle amber border band near outer edges
    border = ((xx < 0.10) | (xx > 0.90) | (yy < 0.08) | (yy > 0.92)).astype(np.float32)
    glass_col = lerp_color(glass_col, (148, 116, 62), border * 0.55)

    lead_col = np.array([32, 35, 38], dtype=np.float32)
    albedo = glass_col * (1.0 - lead[..., None]) + lead_col * lead[..., None]

    height = 0.25 * noise + 0.75 * lead
    normal = height_to_normal(height, strength=2.5)
    roughness = np.clip(0.12 * (1.0 - lead) + 0.52 * lead + 0.06 * noise, 0.08, 0.70)
    metallic = lead * 0.72
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


# ---------------------------------------------------------------------------
# 7. Historic Church Tower Clock Dial (1024x1024 crisp Roman numerals + gold hands)
# ---------------------------------------------------------------------------

def gen_clock_dial(name: str, size: int = 1024):
    img = Image.new("RGB", (size, size), (28, 33, 40))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    r_outer = int(size * 0.47)

    # Metallic & roughness canvases
    rough_img = Image.new("L", (size, size), 150)
    rdraw = ImageDraw.Draw(rough_img)
    metal_img = Image.new("L", (size, size), 30)
    mdraw = ImageDraw.Draw(metal_img)
    h_img = Image.new("L", (size, size), 100)
    hdraw = ImageDraw.Draw(h_img)

    gold = (218, 178, 78)
    gold_hi = (238, 204, 108)
    rim = (42, 47, 56)

    # Outer bezel rings
    draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=(24, 29, 36), outline=gold, width=18)
    mdraw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=20, outline=235, width=18)
    rdraw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=135, outline=55, width=18)
    hdraw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=95, outline=220, width=18)

    r_ring = int(size * 0.42)
    draw.ellipse([cx - r_ring, cy - r_ring, cx + r_ring, cy + r_ring], outline=gold, width=6)
    mdraw.ellipse([cx - r_ring, cy - r_ring, cx + r_ring, cy + r_ring], outline=230, width=6)
    rdraw.ellipse([cx - r_ring, cy - r_ring, cx + r_ring, cy + r_ring], outline=55, width=6)
    hdraw.ellipse([cx - r_ring, cy - r_ring, cx + r_ring, cy + r_ring], outline=190, width=6)

    r_inner = int(size * 0.27)
    draw.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], outline=(185, 148, 64), width=4)
    mdraw.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], outline=210, width=4)

    # 60 minute ticks
    for m in range(60):
        ang = math.radians(m * 6 - 90)
        r0 = int(size * (0.395 if m % 5 == 0 else 0.405))
        r1 = int(size * 0.42)
        w = 7 if m % 5 == 0 else 3
        x0, y0 = cx + int(math.cos(ang) * r0), cy + int(math.sin(ang) * r0)
        x1, y1 = cx + int(math.cos(ang) * r1), cy + int(math.sin(ang) * r1)
        draw.line([x0, y0, x1, y1], fill=gold, width=w)
        mdraw.line([x0, y0, x1, y1], fill=235, width=w)
        rdraw.line([x0, y0, x1, y1], fill=55, width=w)
        hdraw.line([x0, y0, x1, y1], fill=200, width=w)

    # Bold geometric Roman numerals (drawn via vector strokes for crisp independence of system fonts)
    # Use DejaVuSerif/Times if available, else default bold fallback
    font = None
    for fpath in [
        "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
        "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
        "/System/Library/Fonts/Times.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        if os.path.exists(fpath):
            try:
                font = ImageFont.truetype(fpath, int(size * 0.072))
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    numerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
    r_num = int(size * 0.34)
    for i, num in enumerate(numerals):
        ang = math.radians(i * 30 - 90)
        nx = cx + int(math.cos(ang) * r_num)
        ny = cy + int(math.sin(ang) * r_num)
        bbox = draw.textbbox((0, 0), num, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pos = (nx - tw // 2, ny - th // 2 - bbox[1])
        draw.text(pos, num, fill=gold_hi, font=font)
        mdraw.text(pos, num, fill=240, font=font)
        rdraw.text(pos, num, fill=50, font=font)
        hdraw.text(pos, num, fill=230, font=font)

    # Ornate hands: ~15:10 (afternoon golden hour!)
    def draw_hand(angle_deg, length_frac, width_px, tail_frac=0.10):
        ang = math.radians(angle_deg - 90)
        ca, sa = math.cos(ang), math.sin(ang)
        px, py = -sa, ca
        tip = (cx + ca * size * length_frac, cy + sa * size * length_frac)
        tail = (cx - ca * size * tail_frac, cy - sa * size * tail_frac)
        side1 = (cx + px * width_px, cy + py * width_px)
        side2 = (cx - px * width_px, cy - py * width_px)
        poly = [tail, side1, tip, side2]
        draw.polygon(poly, fill=gold_hi, outline=(140, 108, 40))
        mdraw.polygon(poly, fill=245)
        rdraw.polygon(poly, fill=45)
        hdraw.polygon(poly, fill=250)

    draw_hand(95, 0.25, 16)   # Hour hand (~3:10)
    draw_hand(60, 0.36, 11)   # Minute hand (:10)

    # Center gilded boss
    rb = int(size * 0.036)
    draw.ellipse([cx - rb, cy - rb, cx + rb, cy + rb], fill=gold_hi, outline=(130, 95, 35), width=4)
    mdraw.ellipse([cx - rb, cy - rb, cx + rb, cy + rb], fill=250)
    rdraw.ellipse([cx - rb, cy - rb, cx + rb, cy + rb], fill=40)
    hdraw.ellipse([cx - rb, cy - rb, cx + rb, cy + rb], fill=255)

    # Subtle weathered stone/iron texture across dial
    noise = fbm(size, (8, 32, 64), seed=505)
    albedo = np.array(img, dtype=np.float32) * (0.93 + 0.14 * noise[..., None])
    roughness = np.clip(np.array(rough_img, dtype=np.float32) / 255.0 + (noise - 0.5) * 0.08, 0.15, 0.90)
    metallic = np.array(metal_img, dtype=np.float32) / 255.0
    h_arr = np.array(h_img.filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32) / 255.0
    normal = height_to_normal(h_arr, strength=4.5)
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


# ---------------------------------------------------------------------------
# 8. Agricultural Hall Materials (Corrugated Steel, Metal Roof, Silo, Concrete)
# ---------------------------------------------------------------------------

def gen_corrugated_metal(name: str, base_rgb, ribs: int, horizontal: bool,
                         metal_val: float, rough_base: float, seed: int, size: int = 1024):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    coord = yy if horizontal else xx

    # Trapezoidal profile for modern RLP Maschinenhalle siding / sinusoidal for silo
    phase = (coord * ribs) % 1.0
    if horizontal:
        # Sinusoidal corrugated galvanized silo
        profile = 0.5 + 0.5 * np.sin(2.0 * math.pi * coord * ribs)
        # Vertical bolted panel seam lines
        seam = np.exp(-(((xx * 4.0) % 1.0) / 0.012) ** 2)
    else:
        # Trapezoidal steel cladding profile (flat crown, sloped flanks, flat trough)
        profile = np.where(
            phase < 0.25, 1.0,
            np.where(phase < 0.40, 1.0 - (phase - 0.25) / 0.15,
                     np.where(phase < 0.75, 0.0, (phase - 0.75) / 0.25))
        )
        seam = np.exp(-(((yy * 2.0) % 1.0) / 0.008) ** 2)

    weather = fbm(size, (4, 8, 16, 32), seed=seed)
    fine = fbm(size, (32, 64, 128), seed=seed + 21)

    shade = 0.84 + 0.20 * profile - 0.15 * seam
    albedo = np.array(base_rgb, dtype=np.float32)[None, None, :] * shade[..., None] * (0.90 + 0.18 * weather[..., None])
    # Subtle dust/weathering near panel joints
    albedo = lerp_color(albedo, (108, 100, 88), np.clip((weather - 0.58) * 1.1, 0, 0.22))

    height = 0.85 * profile - 0.18 * seam + 0.05 * fine
    normal = height_to_normal(height, strength=5.5)
    roughness = np.clip(rough_base + (1.0 - profile) * 0.08 + (weather - 0.5) * 0.14, 0.18, 0.82)
    metallic = np.clip(np.full((size, size), metal_val, dtype=np.float32) - (weather - 0.5) * 0.12, 0.0, 0.96)
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


def gen_concrete(name: str, seed: int = 606, size: int = 1024):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    macro = fbm(size, (4, 8, 16), seed=seed)
    mid = fbm(size, (16, 32, 64), seed=seed + 13)
    fine = fbm(size, (64, 128, 256), seed=seed + 37)

    # Subtle formwork panel grid + tie holes
    seam_x = np.exp(-(((xx * 4.0) % 1.0) / 0.009) ** 2)
    seam_y = np.exp(-(((yy * 2.0) % 1.0) / 0.012) ** 2)
    seams = np.maximum(seam_x, seam_y)

    albedo = lerp_color((128, 126, 120), (168, 165, 158), macro * 0.55 + mid * 0.30 + fine * 0.15)
    albedo *= (1.0 - 0.20 * seams[..., None])

    height = 0.4 * mid + 0.45 * fine - 0.25 * seams
    normal = height_to_normal(height, strength=3.0)
    roughness = np.clip(0.82 + (1.0 - fine) * 0.14, 0.70, 0.97)
    save_pbr(name, albedo, roughness, normal)


# ---------------------------------------------------------------------------
# 9. Metals (Wrought iron & Aged Copper/Patina) + Courtyard Cobbles
# ---------------------------------------------------------------------------

def gen_metal(name: str, c0, c1, metal_val: float, r0: float, r1: float, seed: int, size: int = 512):
    macro = fbm(size, (4, 8, 16, 32), seed=seed)
    fine = fbm(size, (32, 64, 128), seed=seed + 19)
    albedo = lerp_color(c0, c1, macro * 0.65 + fine * 0.35)
    normal = height_to_normal(0.5 * macro + 0.5 * fine, strength=1.8)
    roughness = np.clip(r0 + (r1 - r0) * (1.0 - macro * 0.6 - fine * 0.4), 0.15, 0.90)
    metallic = np.clip(np.full((size, size), metal_val, dtype=np.float32) * (0.85 + 0.20 * fine), 0.0, 0.98)
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


def gen_cobble(name: str, seed: int = 707, size: int = 1024):
    rng = np.random.default_rng(seed)
    rows, cols = 16, 16
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    row_f = yy * rows
    row_i = np.floor(row_f).astype(np.int32) % rows
    row_frac = row_f - np.floor(row_f)
    stagger = (row_i % 2) * 0.5
    col_f = (xx * cols + stagger) % cols
    col_i = np.floor(col_f).astype(np.int32) % cols
    col_frac = col_f - np.floor(col_f)

    pal = [(126, 118, 108), (110, 105, 98), (140, 128, 114), (98, 94, 90), (132, 116, 100)]
    stone_rgb = np.zeros((rows, cols, 3), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            stone_rgb[r, c] = np.clip(np.array(pal[rng.integers(0, len(pal))]) + rng.uniform(-9, 9, 3), 40, 210)

    n = fbm(size, (16, 32, 64), seed=seed)
    dx = np.abs(col_frac - 0.5) * 2.0
    dy = np.abs(row_frac - 0.5) * 2.0
    # Rounded cobble pillow shape
    dist = np.maximum(dx, dy) + 0.12 * (n - 0.5)
    cobble_h = np.clip(1.0 - np.power(np.clip(dist / 0.88, 0, 1), 3.0), 0, 1)
    grout = (cobble_h < 0.12).astype(np.float32)

    albedo = stone_rgb[row_i, col_i] * (0.82 + 0.26 * n[..., None]) * (0.72 + 0.28 * cobble_h[..., None])
    albedo = lerp_color(albedo, (86, 82, 72), grout * 0.85)
    normal = height_to_normal(cobble_h * 0.85 + 0.15 * n, strength=5.0)
    roughness = np.clip(0.68 + grout * 0.24 + (1.0 - n) * 0.12, 0.52, 0.96)
    save_pbr(name, albedo, roughness, normal)


def gen_dark_roof_tiles(name: str, seed: int = 212, size: int = 1024):
    """Weathered dark charcoal-brown Palatinate interlocking roof tiles (matched to real Rathaus Kindenheim)."""
    rng = np.random.default_rng(seed)
    rows, cols = 16, 22
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    row_f = yy * rows
    row_i = np.floor(row_f).astype(np.int32) % rows
    row_frac = row_f - np.floor(row_f)
    col_f = xx * cols
    col_i = np.floor(col_f).astype(np.int32) % cols
    col_frac = col_f - np.floor(col_f)

    palette = [(68, 63, 60), (58, 54, 52), (76, 70, 65), (52, 50, 50), (64, 60, 58)]
    tile_rgb = np.zeros((rows, cols, 3), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            tile_rgb[r, c] = np.clip(np.array(palette[rng.integers(0, len(palette))]) + rng.uniform(-5, 5, 3), 25, 120)

    wave = 0.5 + 0.5 * np.sin(2.0 * math.pi * (col_frac - 0.25))
    ramp = 0.28 + 0.72 * row_frac
    lip_shadow = 1.0 - 0.42 * np.exp(-((row_frac) / 0.11) ** 2)
    side_seam = np.exp(-((np.minimum(col_frac, 1.0 - col_frac)) / 0.045) ** 2)
    fine = fbm(size, (32, 64, 128), [0.5, 0.3, 0.2], seed=seed + 9)

    albedo = tile_rgb[row_i, col_i] * (0.86 + 0.24 * fine[..., None]) * lip_shadow[..., None] * (0.82 + 0.18 * wave[..., None])
    albedo *= (1.0 - 0.20 * side_seam[..., None])
    height = 0.48 * ramp + 0.42 * wave - 0.24 * side_seam + 0.08 * fine
    normal = height_to_normal(height, strength=5.5)
    roughness = np.clip(0.54 + (1.0 - fine) * 0.16, 0.42, 0.84)
    save_pbr(name, albedo, roughness, normal)


def gen_burgundy_panel_door(name: str, size: int = 512):
    """Authentic Palatinate wine-burgundy paneled oak door (seen on Martinskirche #58 & Rathaus #77)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    grain = fbm(size, (8, 32, 64), seed=901)
    # 2x3 recessed classical wooden door panels
    panel = np.zeros((size, size), dtype=np.float32)
    bevel = np.zeros((size, size), dtype=np.float32)
    for x0, x1 in [(0.12, 0.45), (0.55, 0.88)]:
        for y0, y1 in [(0.08, 0.33), (0.38, 0.63), (0.68, 0.91)]:
            in_p = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
            dx = np.minimum(xx - x0, x1 - xx)
            dy = np.minimum(yy - y0, y1 - yy)
            d = np.minimum(dx, dy)
            panel = np.where(in_p, 1.0, panel)
            bevel = np.where(in_p, np.clip(d / 0.035, 0.0, 1.0), bevel)

    albedo = lerp_color((96, 36, 40), (130, 50, 54), 0.4 + 0.45 * grain + 0.15 * bevel)
    # Darken recessed molding border
    groove = panel * (1.0 - bevel)
    albedo *= (1.0 - 0.35 * groove[..., None])
    height = 0.72 - 0.28 * panel + 0.22 * bevel * panel + 0.08 * grain
    normal = height_to_normal(height, strength=4.5)
    roughness = np.clip(0.42 + (1.0 - grain) * 0.18 + groove * 0.2, 0.30, 0.80)
    save_pbr(name, albedo, roughness, normal)


def gen_rathaus_wappen(name: str, size: int = 512):
    """Heraldic Gemeindewappen Kindenheim stone crest plaque + 'GEMEINDE KINDENHEIM' text (Hauptstraße 77)."""
    img = Image.new("RGB", (size, size), (218, 212, 200))
    draw = ImageDraw.Draw(img)
    # Heraldic shield silhouette (upper 84% of plaque, leaving room for crisp caption beneath)
    shield = [
        (int(size * 0.16), int(size * 0.06)),
        (int(size * 0.84), int(size * 0.06)),
        (int(size * 0.82), int(size * 0.50)),
        (int(size * 0.68), int(size * 0.72)),
        (int(size * 0.50), int(size * 0.82)),
        (int(size * 0.32), int(size * 0.72)),
        (int(size * 0.18), int(size * 0.50)),
    ]
    draw.polygon(shield, fill=(76, 114, 158), outline=(92, 66, 48))
    draw.polygon([
        (int(size * 0.22), int(size * 0.58)),
        (int(size * 0.78), int(size * 0.58)),
        (int(size * 0.66), int(size * 0.73)),
        (int(size * 0.50), int(size * 0.80)),
        (int(size * 0.34), int(size * 0.73)),
    ], fill=(86, 122, 74))
    for cx_f in (0.35, 0.65):
        cx = int(size * cx_f)
        draw.ellipse([cx - 24, int(size * 0.14), cx + 24, int(size * 0.24)], fill=(224, 184, 152), outline=(110, 74, 52), width=3)
        draw.rounded_rectangle([cx - 26, int(size * 0.24), cx + 26, int(size * 0.51)], radius=13, fill=(214, 174, 142), outline=(110, 74, 52), width=3)
        draw.rectangle([cx - 20, int(size * 0.49), cx + 20, int(size * 0.66)], fill=(208, 168, 138), outline=(110, 74, 52), width=2)
    for gy, cnt in [(0.36, 3), (0.42, 3), (0.48, 2), (0.53, 1)]:
        for k in range(cnt):
            gx = int(size * (0.50 + (k - (cnt - 1) * 0.5) * 0.052))
            draw.ellipse([gx - 11, int(size * gy) - 11, gx + 11, int(size * gy) + 11], fill=(48, 56, 114), outline=(28, 32, 64), width=2)
    draw.ellipse([int(size * 0.44), int(size * 0.26), int(size * 0.56), int(size * 0.36)], fill=(76, 128, 62))
    draw.line(shield + [shield[0]], fill=(164, 118, 86), width=9)

    # Crisp 'GEMEINDE KINDENHEIM' lettering below shield (matching sv_rathaus_ortsmitte.png!)
    fnt = None
    for fp in ["/System/Library/Fonts/Supplemental/Georgia Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        if os.path.exists(fp):
            try:
                fnt = ImageFont.truetype(fp, 30)
                break
            except Exception:
                pass
    if fnt is None:
        fnt = ImageFont.load_default()
    txt = "GEMEINDE KINDENHEIM"
    bb = draw.textbbox((0, 0), txt, font=fnt)
    tw = bb[2] - bb[0]
    draw.text(((size - tw) // 2, int(size * 0.87)), txt, fill=(68, 54, 48), font=fnt)

    noise = fbm(size, (8, 32, 64), seed=950)
    albedo = np.array(img, dtype=np.float32) * (0.91 + 0.16 * noise[..., None])
    normal = height_to_normal(0.5 + 0.2 * noise, strength=2.2)
    roughness = np.clip(0.76 + (1.0 - noise) * 0.14, 0.58, 0.92)
    save_pbr(name, albedo, roughness, normal)


def gen_rolladen_window(name: str, closed_frac: float = 0.28, seed: int = 960, size: int = 512):
    """
    Authentic German Rathaus window with light-gray ribbed roller shutters (Rolläden)
    either partially lowered (closed_frac ~ 0.25) or fully closed (closed_frac = 0.96),
    matched directly to sv_rathaus_ortsmitte.png!
    """
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    noise = fbm(size, (8, 16, 32), seed=seed)

    # Lower sky-reflective interior glazing (matches bright daytime reflection in sv_rathaus_ortsmitte!)
    curtain = 0.5 + 0.5 * np.sin(2.0 * math.pi * (xx * 6.0 + noise * 0.25))
    glass_col = lerp_color((42, 56, 72), (108, 134, 162), np.clip(0.25 + 0.55 * (1.0 - yy) + 0.16 * curtain, 0, 1))
    # Subtle warm interior reflection near bottom of pane
    glass_col = lerp_color(glass_col, (118, 114, 106), np.clip((yy - 0.55) * 1.4, 0, 0.45))

    # Light-gray horizontal ribbed Rolladen slats (slat spacing ~ 26 slats full height)
    slats = 28.0
    sf = (yy * slats) % 1.0
    slat_shade = 0.78 + 0.22 * np.sin(sf * math.pi)
    groove = (sf > 0.84).astype(np.float32)
    roll_col = np.array([186.0, 190.0, 195.0], dtype=np.float32)[None, None, :] * slat_shade[..., None]
    roll_col *= (1.0 - 0.28 * groove[..., None]) * (0.94 + 0.10 * noise[..., None])

    is_roll = (yy < closed_frac).astype(np.float32)
    # Bottom metallic lip bar of the Rolladen
    lip = ((yy >= closed_frac - 0.03) & (yy < closed_frac + 0.01)).astype(np.float32)
    albedo = glass_col * (1.0 - is_roll[..., None]) + roll_col * is_roll[..., None]
    albedo = lerp_color(albedo, (132, 136, 140), lip * 0.7)

    height = (0.35 + 0.55 * np.sin(sf * math.pi) - 0.35 * groove) * is_roll + (0.2 + 0.06 * noise) * (1.0 - is_roll)
    normal = height_to_normal(height, strength=4.2)
    roughness = np.clip(0.56 * is_roll + 0.09 * (1.0 - is_roll) + 0.06 * noise, 0.06, 0.85)
    save_pbr(name, albedo, roughness, normal)


def gen_bogenpflaster(name: str, seed: int = 970, size: int = 1024):
    """Authentic German fanned gray granite cobblestone forecourt (Bogenpflaster, sv_kirche_front_detail.png)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    # Overlapping circular fan arcs (4 fan columns across tile)
    cols = 4.0
    fx = (xx * cols) % 1.0 - 0.5
    fy = (yy * cols) % 1.0
    # Compute polar coords from fan center at bottom of each cell
    rad = np.sqrt(fx * fx + (fy + 0.18) ** 2)
    ang = np.arctan2(fx, fy + 0.18)
    r_idx = np.floor(rad * 14.0).astype(np.int32)
    a_idx = np.floor((ang + 1.5) * (6.0 + r_idx * 1.4)).astype(np.int32)
    r_frac = (rad * 14.0) % 1.0
    a_frac = ((ang + 1.5) * (6.0 + r_idx * 1.4)) % 1.0

    # Per-cobble granite tone hash (neutral warm-gray #7D7B73..#9A978E)
    hval = (((r_idx * 73856093) ^ (a_idx * 19349663) ^ (np.floor(xx * cols).astype(np.int32) * 83492791)) & 255) / 255.0
    n = fbm(size, (16, 32, 64), seed=seed)
    cob_col = lerp_color((114, 113, 105), (154, 151, 141), hval * 0.65 + n * 0.35)

    edge_r = np.minimum(r_frac, 1.0 - r_frac)
    edge_a = np.minimum(a_frac, 1.0 - a_frac)
    pillow = np.clip(np.minimum(edge_r / 0.16, edge_a / 0.16), 0.0, 1.0)
    grout = (pillow < 0.22).astype(np.float32)

    albedo = cob_col * (0.76 + 0.24 * pillow[..., None])
    albedo = lerp_color(albedo, (86, 84, 78), grout * 0.85)
    normal = height_to_normal(pillow * 0.80 + 0.20 * n, strength=4.6)
    roughness = np.clip(0.68 + grout * 0.22 + (1.0 - n) * 0.10, 0.54, 0.96)
    save_pbr(name, albedo, roughness, normal)


def gen_kirchhof_grass(name: str, seed: int = 980, size: int = 512):
    """Lush natural Pfalz churchyard lawn turf (sv_kirche_front_detail.png green forecourt grass)."""
    macro = fbm(size, (4, 8, 16), seed=seed)
    mid = fbm(size, (16, 32, 64), seed=seed + 11)
    fine = fbm(size, (64, 128), seed=seed + 29)
    albedo = lerp_color((74, 102, 46), (118, 146, 68), macro * 0.5 + mid * 0.35 + fine * 0.15)
    normal = height_to_normal(0.35 * mid + 0.65 * fine, strength=3.0)
    roughness = np.clip(0.84 + (1.0 - fine) * 0.12, 0.72, 0.97)
    save_pbr(name, albedo, roughness, normal)


def gen_schaukasten(name: str, size: int = 512):
    """Evangelische Kirchengemeinde Kindenheim glass churchyard notice board (sv_kirche_front_detail.png)."""
    img = Image.new("RGB", (size, size), (226, 224, 218))
    draw = ImageDraw.Draw(img)
    # Top green church header banner
    draw.rectangle([16, 16, size - 16, 92], fill=(56, 92, 68))
    f_hdr = ImageFont.load_default()
    for fp in ["/System/Library/Fonts/Helvetica.ttc"]:
        if os.path.exists(fp):
            try:
                f_hdr = ImageFont.truetype(fp, 24)
                break
            except Exception:
                pass
    draw.text((42, 40), "Ev. Kirchengemeinde Kindenheim", fill=(242, 240, 232), font=f_hdr)
    # 6 colorful pinned community flyers/posters on white corkboard
    posters = [
        (34, 114, 178, 290, (242, 232, 186)),
        (196, 114, 336, 270, (216, 232, 246)),
        (354, 114, 478, 300, (246, 220, 212)),
        (34, 308, 198, 476, (238, 244, 224)),
        (216, 290, 356, 476, (248, 242, 228)),
        (372, 318, 478, 476, (226, 222, 242)),
    ]
    for x0, y0, x1, y1, col in posters:
        draw.rectangle([x0, y0, x1, y1], fill=col, outline=(160, 158, 152), width=3)
        for ly in range(y0 + 18, y1 - 14, 16):
            draw.line([x0 + 12, ly, x1 - 16, ly], fill=(92, 92, 96), width=3)
    albedo = np.array(img, dtype=np.float32)
    normal = np.full((size, size, 3), [128, 128, 255], dtype=np.uint8)
    rough = np.full((size, size), 0.14, dtype=np.float32)
    save_pbr(name, albedo, rough, normal, normal_size=256, rough_size=256)


def gen_kirche_biberschwanz(name: str, seed: int = 115, size: int = 1024):
    """Weathered muted dusty red-brown Palatinate Biberschwanz clay roof tiles matched to Martinskirche nave (#8B5847)."""
    rng = np.random.default_rng(seed)
    rows, cols = 20, 22
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    row_f = yy * rows
    row_i = np.floor(row_f).astype(np.int32) % rows
    row_frac = row_f - np.floor(row_f)
    stagger = (row_i % 2) * 0.5
    col_f = (xx * cols + stagger) % cols
    col_i = np.floor(col_f).astype(np.int32) % cols
    col_frac = col_f - np.floor(col_f)

    # Calibrated directly to sv_kirche_front_detail.png Nave clay roof (#8B5847..#9E6E5D)
    palette = [
        (148, 102, 86),
        (138, 94, 80),
        (156, 110, 92),
        (128, 88, 76),
        (144, 100, 86),
    ]
    tile_rgb = np.zeros((rows, cols, 3), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            tile_rgb[r, c] = np.clip(np.array(palette[rng.integers(0, len(palette))]) + rng.uniform(-7, 7, 3), 50, 200)

    dx = (col_frac - 0.5) * 2.0
    scallop = 0.80 + 0.20 * np.sqrt(np.clip(1.0 - dx * dx, 0, 1))
    in_lip = (row_frac > scallop).astype(np.float32)
    seam_v = np.exp(-((np.minimum(col_frac, 1.0 - col_frac)) / 0.045) ** 2)
    lip_ao = 1.0 - 0.36 * np.exp(-((row_frac - scallop) / 0.08) ** 2)
    weather = fbm(size, (4, 8, 16, 32), seed=seed + 13)
    fine = fbm(size, (64, 128), seed=seed + 29)

    albedo = tile_rgb[row_i, col_i] * (0.88 + 0.20 * fine[..., None]) * lip_ao[..., None] * (1.0 - 0.18 * seam_v[..., None])
    albedo = lerp_color(albedo, (96, 86, 78), np.clip((weather - 0.52) * 0.9, 0, 0.28))
    height = (0.3 + 0.65 * row_frac) * (1.0 - 0.45 * in_lip) - 0.22 * seam_v + 0.10 * fine
    normal = height_to_normal(height, strength=5.0)
    roughness = np.clip(0.74 + (1.0 - fine) * 0.14 + weather * 0.08, 0.60, 0.96)
    save_pbr(name, albedo, roughness, normal)


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def main():
    print(f"Generating Pfalz Hero Landmark PBR textures in {OUT_DIR} ...")

    # Stuccos calibrated directly to Aug-2023 Street View samples!
    gen_stucco("stucco_warm_cream", (236, 232, 222), (214, 209, 199), (244, 240, 232), seed=11)
    gen_stucco("stucco_rathaus_greycream", (221, 214, 200), (196, 189, 176), (230, 224, 212), seed=15)
    gen_stucco("stucco_ochre", (218, 182, 122), (186, 148, 92), (232, 198, 140), seed=22)
    gen_stucco("stucco_terracotta", (204, 150, 122), (172, 118, 94), (218, 168, 138), seed=33)
    gen_stucco("stucco_sage", (198, 204, 184), (168, 174, 156), (212, 218, 200), seed=44)
    gen_stucco("window_frame_white", (236, 235, 231), (218, 217, 212), (244, 243, 240), seed=48, size=512)

    # Authentic Pfälzer Sandstein calibrated directly to sv_kirche_front_detail.png & sv_rathaus_ortsmitte.png!
    # Lighter dusty rose-pink Buntsandstein (#B37B6C..#C08A79) with visible pale lime mortar!
    gen_sandstone(
        "sandstone_red",
        palette=[(184, 134, 115), (176, 126, 108), (192, 142, 122), (170, 122, 105), (180, 131, 113)],
        mortar_rgb=(204, 194, 184),
        rows=10, cols=5, seed=55, jitter_amp=4.2
    )
    # Soft dusty-rose Pfälzer Sandstein trim specifically matched to Rathaus Hauptstraße 77 (#A76F64)
    gen_sandstone(
        "sandstone_rathaus_rose",
        palette=[(170, 116, 104), (162, 108, 98), (176, 122, 110), (156, 104, 94), (166, 112, 101)],
        mortar_rgb=(190, 178, 168),
        rows=10, cols=5, seed=58, jitter_amp=3.8
    )
    # Warm pale yellow-buff limestone/sandstone ashlar matched to Martinskirche upper tower (#D2C29D)
    gen_sandstone(
        "sandstone_yellow",
        palette=[(212, 197, 164), (204, 189, 156), (218, 204, 172), (198, 183, 152), (208, 193, 160)],
        mortar_rgb=(194, 186, 172),
        rows=10, cols=5, seed=66, jitter_amp=4.8
    )

    # Roofs (terracotta clay, Martinskirche weathered Biberschwanz, dark Rathaus clay, Hunsrück slate)
    gen_clay_roof_tiles("roof_clay_tiles", seed=101)
    gen_kirche_biberschwanz("roof_kirche_biberschwanz", seed=115)
    gen_dark_roof_tiles("roof_dark_tile", seed=212)
    gen_slate_roof("roof_slate", seed=202)

    # Woods, Doors, Heraldry, Rolläden, Forecourt Bogenpflaster & Kirchhof details
    gen_wood_planks("wood_timber_dark", (86, 60, 40), (54, 38, 26), plank_count=4, seed=71)
    gen_wood_planks("wood_barn_planks", (128, 92, 62), (86, 58, 38), plank_count=10, seed=72)
    gen_wood_planks("wood_barrel_oak", (134, 96, 62), (92, 62, 38), plank_count=14, seed=73, size=512)
    gen_louver_texture("wood_shutter_green", (66, 98, 76), (34, 54, 42), slats=18, seed=74, size=512)
    gen_louver_texture("wood_shutter_red", (126, 56, 46), (68, 28, 24), slats=18, seed=75, size=512)
    gen_louver_texture("belfry_louvers", (58, 52, 48), (18, 16, 15), slats=14, seed=76, size=512)
    gen_burgundy_panel_door("door_burgundy_panel", size=512)
    gen_rathaus_wappen("rathaus_wappen", size=512)
    gen_rolladen_window("window_rolladen_partial", closed_frac=0.24, seed=961, size=512)
    gen_rolladen_window("window_rolladen_closed", closed_frac=0.96, seed=962, size=512)
    gen_bogenpflaster("bogenpflaster_cobble", seed=970, size=1024)
    gen_kirchhof_grass("kirchhof_grass", seed=980, size=512)
    gen_schaukasten("kirche_schaukasten", size=512)

    # Glass & Clock
    gen_window_glass_warm("window_glass_warm", size=512)
    gen_window_glass_church("window_glass_church", size=512)
    gen_clock_dial("clock_dial", size=1024)

    # Agricultural / Industrial materials
    gen_corrugated_metal("metal_corrugated_sage", (118, 132, 122), ribs=24, horizontal=False,
                         metal_val=0.35, rough_base=0.48, seed=81)
    gen_corrugated_metal("metal_roof_sheet", (68, 74, 82), ribs=20, horizontal=False,
                         metal_val=0.55, rough_base=0.42, seed=82)
    gen_corrugated_metal("metal_silo", (176, 182, 188), ribs=36, horizontal=True,
                         metal_val=0.82, rough_base=0.32, seed=83)
    gen_concrete("concrete_plinth", seed=84)

    # Metals & Courtyard
    gen_metal("iron_dark", (30, 33, 38), (52, 56, 62), metal_val=0.86, r0=0.34, r1=0.55, seed=91)
    gen_metal("copper_patina", (68, 114, 98), (94, 138, 118), metal_val=0.68, r0=0.36, r1=0.62, seed=92)
    gen_metal("gold_gilded", (206, 164, 62), (236, 198, 96), metal_val=0.92, r0=0.18, r1=0.34, seed=93)
    gen_cobble("cobble_courtyard", seed=94)

    files = sorted(OUT_DIR.glob("*"))
    total_mb = sum(f.stat().st_size for f in files) / (1024 * 1024)
    print(f"Done! Generated {len(files)} texture files ({total_mb:.1f} MB).")


# ---------------------------------------------------------------------------
# Graphics overhaul: unique detail atlases for the church and the Rathaus
# (everything tiling now comes from the shared CC0 library in blender/shared_textures/).
# Run only these with:  python3 blender/landmarks/generate_textures.py --atlases
# Each atlas writes <name>.png plus <name>.json with UV rectangles (u0, v0, u1, v1; v up).
# ---------------------------------------------------------------------------

_FONT_DIR = Path("/System/Library/Fonts/Supplemental")


def _font(file_name: str, size: int):
    path = _FONT_DIR / file_name
    if not path.exists():
        raise RuntimeError(f"Font not found: {path}")
    return ImageFont.truetype(str(path), size)


def _stone_field(w: int, h: int, rgb, seed: int, amp: float = 10.0) -> Image.Image:
    """Softly mottled stone / plaster colour field."""
    n = max(w, h)
    size = 1 << (n - 1).bit_length()
    f = fbm(size, octaves=(4, 8, 16, 32, 64, 128), seed=seed)[:h, :w]
    g = fbm(size, octaves=(64, 128, 256), seed=seed + 5)[:h, :w]
    v = (f - 0.5) * 2.0 * amp + (g - 0.5) * amp * 0.8
    arr = np.clip(np.array(rgb, dtype=np.float32)[None, None, :] + v[:, :, None], 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def _write_rects(name: str, size: int, rects_px: dict):
    """rects_px: {key: (x0, y0, x1, y1)} in pixels, y down -> JSON UV rects with v up."""
    out = {}
    for k, (x0, y0, x1, y1) in rects_px.items():
        out[k] = [round(x0 / size, 6), round(1.0 - y1 / size, 6), round(x1 / size, 6), round(1.0 - y0 / size, 6)]
    import json
    with open(OUT_DIR / f"{name}.json", "w", encoding="utf-8") as f:
        json.dump({"image": f"{name}.png", "size": size, "rects": out}, f, indent=1)


def _clock_face(size: int = 1024) -> Image.Image:
    """Black tower-clock dial with gilded Roman numerals, minute track and rim (hands are modelled in 3D)."""
    ss = 2
    S = size * ss
    img = Image.new("RGB", (S, S), (16, 16, 18))
    d = ImageDraw.Draw(img)
    c = S / 2
    gold = (214, 172, 72)
    gold_hi = (238, 204, 112)
    # dial ground with a faint sheen ring
    d.ellipse([c - S * 0.5, c - S * 0.5, c + S * 0.5, c + S * 0.5], fill=(14, 14, 16))
    # gilded rim + inner ring
    for r0, r1, col in [(0.498, 0.468, gold), (0.468, 0.462, gold_hi), (0.330, 0.322, gold), (0.396, 0.392, gold)]:
        d.ellipse([c - S * r0, c - S * r0, c + S * r0, c + S * r0], fill=col)
        d.ellipse([c - S * r1, c - S * r1, c + S * r1, c + S * r1], fill=(14, 14, 16))
    # minute track
    for m in range(60):
        a = math.radians(m * 6.0)
        r_in, r_out, wdt = (0.400, 0.452, 0.011) if m % 5 == 0 else (0.418, 0.446, 0.005)
        dx, dy = math.sin(a), -math.cos(a)
        px, py = -dy, dx
        pts = [(c + S * (dx * r_in + px * wdt), c + S * (dy * r_in + py * wdt)),
               (c + S * (dx * r_out + px * wdt), c + S * (dy * r_out + py * wdt)),
               (c + S * (dx * r_out - px * wdt), c + S * (dy * r_out - py * wdt)),
               (c + S * (dx * r_in - px * wdt), c + S * (dy * r_in - py * wdt))]
        d.polygon(pts, fill=gold)
    # Roman numerals, feet toward the centre
    font = _font("Times New Roman Bold.ttf", int(S * 0.118))
    numerals = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
    for i, txt in enumerate(numerals):
        a_deg = i * 30.0
        box = font.getbbox(txt)
        tw, th = box[2] - box[0], box[3] - box[1]
        tile = Image.new("RGBA", (tw + 24, th + 24), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((12 - box[0], 12 - box[1]), txt, font=font, fill=gold + (255,))
        tile = tile.resize((int(tile.width * 0.78), tile.height), Image.LANCZOS)  # condensed tower-clock numerals
        tile = tile.rotate(-a_deg, expand=True, resample=Image.BICUBIC)
        a = math.radians(a_deg)
        r = S * 0.262
        x = c + r * math.sin(a) - tile.width / 2
        y = c - r * math.cos(a) - tile.height / 2
        img.paste(tile, (int(x), int(y)), tile)
    # centre boss
    d.ellipse([c - S * 0.03, c - S * 0.03, c + S * 0.03, c + S * 0.03], fill=gold)
    return img.resize((size, size), Image.LANCZOS)


def _tympanum(w: int = 768, h: int = 704) -> Image.Image:
    """Pale rose sandstone tympanum with the painted blackletter inscription 'Erbaut 18 71/72.'"""
    img = _stone_field(w, h, (198, 160, 142), seed=411, amp=7.0)
    d = ImageDraw.Draw(img)
    ink = (118, 44, 40)
    f_big = _font("Luminari.ttf", int(w * 0.135))
    f_num = _font("Luminari.ttf", int(w * 0.125))
    f_small = _font("Luminari.ttf", int(w * 0.056))
    txt = "ERBAUT"
    bb = d.textbbox((0, 0), txt, font=f_big)
    d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], h * 0.52 - bb[1]), txt, font=f_big, fill=ink)
    y0 = h * 0.72
    bb18 = d.textbbox((0, 0), "18", font=f_num)
    w18 = bb18[2] - bb18[0]
    bbf = d.textbbox((0, 0), "71", font=f_small)
    wf = bbf[2] - bbf[0]
    total = w18 + 14 + wf + 26
    x0 = (w - total) / 2
    d.text((x0 - bb18[0], y0 - bb18[1]), "18", font=f_num, fill=ink)
    xf = x0 + w18 + 14
    num_h = bb18[3] - bb18[1]
    d.text((xf - bbf[0], y0 - bbf[1] - 4), "71", font=f_small, fill=ink)
    d.line([(xf - 2, y0 + num_h * 0.5), (xf + wf + 2, y0 + num_h * 0.5)], fill=ink, width=4)
    bb72 = d.textbbox((0, 0), "72", font=f_small)
    d.text((xf - bb72[0], y0 + num_h * 0.5 + 8 - bb72[1]), "72", font=f_small, fill=ink)
    d.ellipse([xf + wf + 12, y0 + num_h - 12, xf + wf + 24, y0 + num_h], fill=ink)
    return img.filter(ImageFilter.GaussianBlur(0.6))


def _notice_board(w: int = 768, h: int = 640) -> Image.Image:
    """Glazed parish notice board: header strip + pinned sheets (illegible body text)."""
    rng = np.random.default_rng(73)
    img = Image.new("RGB", (w, h), (214, 216, 212))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, int(h * 0.12)], fill=(226, 228, 224))
    f_head = _font("Arial Bold.ttf", int(h * 0.058))
    head = "Prot. Kirchengemeinde Kindenheim"
    bb = d.textbbox((0, 0), head, font=f_head)
    d.text(((w - (bb[2] - bb[0])) / 2, h * 0.032), head, font=f_head, fill=(40, 44, 52))
    d.line([(0, int(h * 0.12)), (w, int(h * 0.12))], fill=(150, 152, 150), width=3)
    sheets = [
        (0.04, 0.17, 0.30, 0.60, (250, 250, 246)), (0.33, 0.16, 0.62, 0.52, (252, 244, 196)),
        (0.65, 0.17, 0.96, 0.58, (248, 248, 250)), (0.05, 0.64, 0.36, 0.95, (236, 244, 252)),
        (0.39, 0.56, 0.63, 0.95, (252, 232, 214)), (0.66, 0.62, 0.95, 0.94, (236, 250, 232)),
    ]
    for (x0, y0, x1, y1, col) in sheets:
        X0, Y0, X1, Y1 = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
        d.rectangle([X0 + 4, Y0 + 5, X1 + 4, Y1 + 5], fill=(176, 178, 174))
        d.rectangle([X0, Y0, X1, Y1], fill=col)
        hd = (int(rng.integers(30, 150)), int(rng.integers(40, 110)), int(rng.integers(60, 160)))
        d.rectangle([X0 + 12, Y0 + 12, X1 - 12, Y0 + 12 + int((Y1 - Y0) * 0.12)], fill=hd)
        if rng.random() < 0.5:
            pw = int((X1 - X0) * 0.36)
            d.rectangle([X1 - 14 - pw, Y0 + 30 + int((Y1 - Y0) * 0.12), X1 - 14, Y0 + 30 + int((Y1 - Y0) * 0.12) + pw],
                        fill=(int(rng.integers(90, 190)), int(rng.integers(110, 180)), int(rng.integers(90, 170))))
        y = Y0 + 24 + int((Y1 - Y0) * 0.14)
        while y < Y1 - 14:
            ln = X0 + 12 + int((X1 - X0 - 24) * rng.uniform(0.45, 1.0))
            d.line([(X0 + 12, y), (ln, y)], fill=(92, 94, 100), width=2)
            y += 9
        for px, py in [(X0 + 10, Y0 + 8), (X1 - 10, Y0 + 8)]:
            d.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(190, 40, 40))
    return img.filter(ImageFilter.GaussianBlur(0.5))


def gen_kirche_details(size: int = 2048):
    """2K atlas: clock dial | tympanum inscription | notice board."""
    atlas = Image.new("RGB", (size, size), (120, 110, 100))
    rects = {}
    atlas.paste(_clock_face(1024), (0, 0)); rects["clock"] = (0, 0, 1024, 1024)
    atlas.paste(_tympanum(768, 704), (1024, 0)); rects["tympanum"] = (1024, 0, 1792, 704)
    atlas.paste(_notice_board(768, 640), (1024, 720)); rects["notice_board"] = (1024, 720, 1792, 1360)
    atlas.save(OUT_DIR / "kirche_details.png")
    _write_rects("kirche_details", size, rects)
    print(f"  kirche_details.png ({size}px): {sorted(rects)}")


def gen_leaded_glass(name: str = "kirche_leaded_glass", size: int = 512, cols: int = 4, rows: int = 3, seed: int = 97):
    """Tileable rectangular leaded quarries (one tile = cols x rows panes): dark daytime albedo, slightly
    tilted panes in the normal map (uneven old glass), and a warm emissive map for the lit interior at dusk."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cw, rh = size / cols, size / rows
    ci = np.floor(xx / cw).astype(np.int32)
    ri = np.floor(yy / rh).astype(np.int32)
    fx = xx / cw - ci
    fy = yy / rh - ri
    came = 0.055
    edge = np.minimum(np.minimum(fx, 1 - fx) * (cw / rh), np.minimum(fy, 1 - fy))
    lead = (np.minimum(fx, 1 - fx) < came * 0.5 * (rh / cw) * 1.4) | (np.minimum(fy, 1 - fy) < came * 0.5)
    pane_v = rng.uniform(0.78, 1.18, (rows, cols)).astype(np.float32)[ri, ci]
    pane_h = rng.uniform(-1.0, 1.0, (rows, cols)).astype(np.float32)[ri, ci]
    streak = fbm(size, octaves=(8, 16, 32, 64), seed=seed + 3)
    base = np.stack([30 + 4 * pane_h, 36 + 2 * pane_h, 44 - 3 * pane_h], axis=-1) * (pane_v * (0.86 + 0.28 * streak))[:, :, None]
    alb = np.where(lead[:, :, None], np.array([70, 70, 72], dtype=np.float32)[None, None, :], base)
    Image.fromarray(np.clip(alb, 0, 255).astype(np.uint8), "RGB").save(OUT_DIR / f"{name}_albedo.png")
    glow_v = rng.uniform(0.62, 1.0, (rows, cols)).astype(np.float32)[ri, ci]
    glow = np.stack([255 * glow_v, (196 + 14 * pane_h) * glow_v, (118 + 26 * pane_h) * glow_v], axis=-1) * (0.82 + 0.3 * streak)[:, :, None]
    emi = np.where(lead[:, :, None], np.array([6, 5, 4], dtype=np.float32)[None, None, :], glow)
    Image.fromarray(np.clip(emi, 0, 255).astype(np.uint8), "RGB").save(OUT_DIR / f"{name}_emissive.png")
    tilt_x = rng.uniform(-0.085, 0.085, (rows, cols)).astype(np.float32)[ri, ci]
    tilt_y = rng.uniform(-0.085, 0.085, (rows, cols)).astype(np.float32)[ri, ci]
    wav = height_to_normal(fbm(size, octaves=(8, 16, 32), seed=seed + 9), strength=1.2).astype(np.float32) / 255.0 * 2.0 - 1.0
    nx = np.where(lead, 0.0, tilt_x + wav[:, :, 0] * 0.35)
    ny = np.where(lead, 0.0, tilt_y + wav[:, :, 1] * 0.35)
    nz = np.sqrt(np.clip(1.0 - nx * nx - ny * ny, 0.05, 1.0))
    nrm = np.stack([nx, ny, nz], axis=-1) * 0.5 + 0.5
    Image.fromarray(np.clip(nrm * 255, 0, 255).astype(np.uint8), "RGB").save(OUT_DIR / f"{name}_normal.png")
    print(f"  {name}_albedo/_emissive/_normal.png ({size}px, {cols}x{rows} quarries per tile)")


def _wappen(w: int = 512, h: int = 600) -> Image.Image:
    """Painted/mosaic municipal arms as seen above the Rathaus door: two children holding a bunch of grapes."""
    ss = 2
    W, H = w * ss, h * ss
    img = Image.new("RGB", (W, H), (236, 232, 222))
    d = ImageDraw.Draw(img)

    def P(pts):
        return [(x * W, y * H) for x, y in pts]

    # field
    d.rectangle([0, 0, W, H], fill=(232, 229, 218))
    # ground with vine foliage
    d.polygon(P([(0.0, 0.78), (0.22, 0.72), (0.5, 0.76), (0.78, 0.71), (1.0, 0.78), (1.0, 1.0), (0.0, 1.0)]), fill=(92, 132, 78))
    rng = np.random.default_rng(31)
    for _ in range(70):
        x, y = rng.uniform(0.04, 0.96), rng.uniform(0.70, 0.98)
        r = rng.uniform(0.018, 0.04)
        g = int(rng.integers(96, 160))
        d.ellipse([(x - r) * W, (y - r * 0.8) * H, (x + r) * W, (y + r * 0.8) * H], fill=(int(g * 0.55), g, int(g * 0.45)))
    skin, skin_sh = (226, 178, 150), (196, 142, 118)
    for side in (-1.0, 1.0):
        cx = 0.5 + side * 0.215
        # legs
        d.polygon(P([(cx - 0.055, 0.55), (cx - 0.005, 0.55), (cx - 0.012 - side * 0.02, 0.80), (cx - 0.07 - side * 0.02, 0.80)]), fill=skin_sh)
        d.polygon(P([(cx + 0.0, 0.55), (cx + 0.055, 0.55), (cx + 0.07 + side * 0.01, 0.80), (cx + 0.012 + side * 0.01, 0.80)]), fill=skin)
        # torso
        d.ellipse([(cx - 0.075) * W, 0.33 * H, (cx + 0.075) * W, 0.60 * H], fill=skin)
        # arms: inner arm reaches the grapes, outer arm hangs
        d.line(P([(cx - side * 0.045, 0.385), (0.5 + side * 0.035, 0.335)]), fill=skin, width=int(0.036 * W))
        d.line(P([(cx + side * 0.06, 0.39), (cx + side * 0.085, 0.53)]), fill=skin_sh, width=int(0.032 * W))
        # head + hair
        d.ellipse([(cx - 0.062) * W, 0.185 * H, (cx + 0.062) * W, 0.335 * H], fill=skin)
        d.pieslice([(cx - 0.068) * W, 0.170 * H, (cx + 0.068) * W, 0.30 * H], 180, 360, fill=(206, 164, 84))
        # loin cloth
        d.polygon(P([(cx - 0.07, 0.52), (cx + 0.07, 0.52), (cx + 0.055, 0.60), (cx - 0.055, 0.60)]), fill=(222, 224, 228))
    # vine stem + leaves + the shared blue bunch of grapes
    d.line(P([(0.5, 0.12), (0.5, 0.33)]), fill=(96, 72, 44), width=int(0.014 * W))
    for lx, ly in [(0.43, 0.20), (0.57, 0.20), (0.5, 0.13)]:
        d.ellipse([(lx - 0.055) * W, (ly - 0.04) * H, (lx + 0.055) * W, (ly + 0.04) * H], fill=(74, 124, 66))
    row_counts = [4, 4, 3, 3, 2, 1]
    for r_i, cnt in enumerate(row_counts):
        for c_i in range(cnt):
            gx = 0.5 + (c_i - (cnt - 1) / 2) * 0.046
            gy = 0.345 + r_i * 0.045
            d.ellipse([(gx - 0.027) * W, (gy - 0.023) * H, (gx + 0.027) * W, (gy + 0.023) * H], fill=(58, 86, 150), outline=(34, 52, 104), width=2)
            d.ellipse([(gx - 0.014) * W, (gy - 0.015) * H, (gx - 0.002) * W, (gy - 0.004) * H], fill=(120, 150, 206))
    img = img.resize((w, h), Image.LANCZOS)
    # mosaic tesserae grid + slight per-tile value jitter
    arr = np.asarray(img).astype(np.float32)
    t = 7
    yy, xx = np.mgrid[0:h, 0:w]
    jit = np.random.default_rng(5).uniform(0.93, 1.05, (h // t + 2, w // t + 2)).astype(np.float32)[yy // t, xx // t]
    arr *= jit[:, :, None]
    grout = ((yy % t) == 0) | ((xx % t) == 0)
    arr[grout] = arr[grout] * 0.82 + 20
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def _curtain_window(w: int = 256, h: int = 512, style: str = "apart", seed: int = 3) -> Image.Image:
    """Net curtain as it hangs BEHIND the (separately modelled, dark reflective) glass pane.
    style: 'apart' = two drapes drawn to the sides with the dark room visible between,
           'closed' = one full-width net curtain, 'half' = a single drape on one side."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    size = 1 << (max(w, h) - 1).bit_length()
    n_lo = fbm(size, octaves=(4, 8, 16), seed=seed)[:h, :w]
    n_hi = fbm(size, octaves=(32, 64, 128), seed=seed + 7)[:h, :w]
    # irregular soft folds: phase wobbles with height, amplitude fades toward the hem
    phase = u * math.pi * 2 * (7.0 + 2.0 * (seed % 3)) + (n_lo - 0.5) * 5.0 + np.sin(v * 5.0 + seed) * 0.5
    folds = 0.5 + 0.5 * np.sin(phase)
    cloth = 168 + 38 * folds * (0.6 + 0.4 * n_lo) - 22 * (1.0 - v) + (n_hi - 0.5) * 10
    cur = np.stack([cloth * 1.0, cloth * 0.985, cloth * 0.95], axis=-1)
    room = np.stack([26 + 20 * n_lo, 25 + 18 * n_lo, 24 + 16 * n_lo], axis=-1) * (0.7 + 0.5 * v)[:, :, None]
    if style == "closed":
        gap = np.zeros_like(u)
    elif style == "half":
        gap = np.clip((u - 0.46 - 0.10 * np.sin(v * 3.0 + seed)) * 14.0, 0.0, 1.0)
    else:
        half_w = 0.10 + 0.20 * (1.0 - v) ** 1.5 + 0.03 * np.sin(v * 9.0 + seed)
        gap = np.clip((half_w - np.abs(u - 0.5)) * 22.0, 0.0, 1.0)
    arr = cur * (1 - gap[:, :, None]) + room * gap[:, :, None]
    # pelmet shadow at the head
    arr *= (0.72 + 0.28 * np.clip(v * 7.0, 0.0, 1.0))[:, :, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def _small_plates(size: int = 256) -> Image.Image:
    """2x2 grid of small plates: door notice | mailbox collection plate | bell panel | blank enamel sign."""
    img = Image.new("RGB", (size, size), (238, 238, 232))
    d = ImageDraw.Draw(img)
    hs = size // 2
    f = _font("Arial Bold.ttf", 15)
    f2 = _font("Arial.ttf", 10)
    # notice (yellowish paper)
    d.rectangle([0, 0, hs, hs], fill=(244, 236, 190))
    d.text((10, 8), "Sprechzeiten", font=f, fill=(40, 40, 46))
    for i in range(7):
        d.line([(10, 36 + i * 11), (hs - 14 - (i % 3) * 14, 36 + i * 11)], fill=(84, 84, 90), width=2)
    # mailbox plate
    d.rectangle([hs, 0, size, hs], fill=(248, 248, 244))
    d.text((hs + 8, 8), "Leerung", font=f, fill=(20, 20, 24))
    for i, t in enumerate(["Mo-Fr  16:30", "Sa     11:00", "So       -  "]):
        d.text((hs + 10, 34 + i * 16), t, font=f2, fill=(30, 30, 34))
    d.rectangle([hs + 8, 92, size - 10, 118], outline=(30, 30, 34), width=2)
    # bell panel (dark anodised with three name strips + buttons)
    d.rectangle([0, hs, hs, size], fill=(44, 46, 50))
    for i in range(3):
        y = hs + 14 + i * 36
        d.rectangle([12, y, hs - 44, y + 22], fill=(226, 226, 220))
        d.ellipse([hs - 34, y, hs - 12, y + 22], fill=(170, 172, 176), outline=(90, 92, 96), width=2)
    # enamel sign
    d.rectangle([hs, hs, size, size], fill=(240, 240, 236))
    d.rectangle([hs + 6, hs + 6, size - 6, size - 6], outline=(36, 60, 120), width=4)
    d.text((hs + 16, hs + 24), "Orts-", font=f, fill=(36, 60, 120))
    d.text((hs + 16, hs + 46), "gemeinde", font=f, fill=(36, 60, 120))
    d.text((hs + 16, hs + 72), "Kindenheim", font=f, fill=(36, 60, 120))
    return img


def gen_rathaus_details(size: int = 1024):
    """1K atlas: coat of arms | curtained window pane | small plates."""
    atlas = Image.new("RGB", (size, size), (228, 224, 214))
    rects = {}
    atlas.paste(_wappen(512, 600), (0, 0)); rects["wappen"] = (0, 0, 512, 600)
    warm = np.array([1.0, 0.96, 0.88], dtype=np.float32)[None, None, :]

    def lit(img):
        return Image.fromarray(np.clip(np.asarray(img).astype(np.float32) * 1.12 * warm, 0, 255).astype(np.uint8), "RGB")

    c_a = _curtain_window(256, 512, "apart", seed=3)
    c_b = _curtain_window(256, 512, "closed", seed=5)
    c_c = _curtain_window(256, 512, "half", seed=8)
    atlas.paste(c_a, (512, 0)); rects["window_curtain"] = (512 + 2, 2, 768 - 2, 512 - 2)
    atlas.paste(lit(c_a), (512, 512)); rects["window_curtain_lit"] = (512 + 2, 512 + 2, 768 - 2, 1024 - 2)
    atlas.paste(c_b, (768, 256)); rects["curtain_closed"] = (768 + 2, 256 + 2, 1024 - 2, 768 - 2)
    atlas.paste(lit(c_b).resize((212, 424), Image.LANCZOS), (0, 600)); rects["curtain_closed_lit"] = (2, 600 + 2, 212 - 2, 1024 - 2)
    atlas.paste(c_c.resize((212, 424), Image.LANCZOS), (212, 600)); rects["curtain_half"] = (212 + 2, 600 + 2, 424 - 2, 1024 - 2)
    plates = _small_plates(256)
    atlas.paste(plates, (768, 0))
    rects["notice"] = (768 + 2, 2, 896 - 2, 128 - 2)
    rects["mailbox_plate"] = (896 + 2, 2, 1024 - 2, 128 - 2)
    rects["bell_panel"] = (768 + 2, 128 + 2, 896 - 2, 256 - 2)
    rects["sign"] = (896 + 2, 128 + 2, 1024 - 2, 256 - 2)
    atlas.save(OUT_DIR / "rathaus_details.png")
    _write_rects("rathaus_details", size, rects)
    print(f"  rathaus_details.png ({size}px): {sorted(rects)}")


def gen_rolladen_slats(name: str = "rolladen_slats", size: int = 256, slats: int = 8):
    """Tileable light-grey roller-shutter slats (one tile = `slats` slats, i.e. ~0.40 m): albedo + normal."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    f = (yy / size * slats) % 1.0
    profile = np.sin(np.clip(f, 0, 1) * math.pi) ** 0.6           # convex slat
    groove = (f < 0.10).astype(np.float32)
    val = 196 + 26 * profile - 70 * groove + (fbm(size, octaves=(16, 32, 64), seed=12) - 0.5) * 10
    alb = np.stack([val, val * 0.995, val * 0.98], axis=-1)
    Image.fromarray(np.clip(alb, 0, 255).astype(np.uint8), "RGB").save(OUT_DIR / f"{name}_albedo.png")
    height = profile * 0.8 - groove * 0.6
    tiled = np.tile(height, (3, 1))
    Image.fromarray(height_to_normal(tiled, strength=3.0)[size:2 * size], "RGB").save(OUT_DIR / f"{name}_normal.png")
    print(f"  {name}_albedo/_normal.png ({size}px)")


def gen_lamp_glow(name: str = "lamp_glow", size: int = 128):
    """Soft warm light pool (black at the border, so clamp-to-edge sampling is unlit outside the 0..1 square).
    Used as an emissive map through the second UV set on walls / ground around lanterns."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    r = np.hypot((xx + 0.5) / size - 0.5, (yy + 0.5) / size - 0.5) / 0.5
    fall = np.clip(1.0 - r * r, 0.0, 1.0) ** 2 / (1.0 + 7.0 * r * r)
    fall[0, :] = fall[-1, :] = 0.0
    fall[:, 0] = fall[:, -1] = 0.0
    arr = fall[:, :, None] * np.array([255.0, 198.0, 122.0], dtype=np.float32)[None, None, :]
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").save(OUT_DIR / f"{name}.png")
    print(f"  {name}.png ({size}px)")


PLANTING_CELLS = {
    # cell name -> (u0, v0, u1, v1) in the 1024 x 512 RGBA atlas (v from the top of the image)
    "geranium_red": (0, 0, 512, 256),
    "marigold_yellow": (512, 0, 1024, 256),
    "petunia_violet": (0, 256, 512, 512),
    "trailing": (512, 256, 1024, 512),
}


def _planting_cell(w: int, h: int, flowers, seed: int, trailing: bool = False) -> Image.Image:
    """One alpha-cut foliage card cell drawn at 2x and downsampled: an upright clump of scalloped geranium-type
    leaves with flower umbels above (or, with `trailing`, shoots of small leaves hanging from the top edge)."""
    rng = np.random.default_rng(seed)
    S = 2
    W, H = w * S, h * S
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    greens = [(46, 82, 30), (58, 100, 36), (72, 118, 44), (88, 134, 52), (38, 66, 26)]

    def leaf(cx, cy, r, shade):
        g = greens[shade % len(greens)]
        k = rng.uniform(0.85, 1.12)
        col = tuple(int(min(255, c * k)) for c in g) + (255,)
        lobes = 7
        pts = []
        for i in range(lobes * 4):
            a = 2 * math.pi * i / (lobes * 4)
            rr = r * (0.86 + 0.14 * abs(math.cos(a * lobes / 2)))
            pts.append((cx + rr * math.cos(a), cy + rr * 0.82 * math.sin(a)))
        d.polygon(pts, fill=col)
        # darker horseshoe zone + pale veins typical of zonal geranium leaves
        zc = tuple(int(c * 0.72) for c in col[:3]) + (255,)
        d.arc([cx - r * 0.55, cy - r * 0.45, cx + r * 0.55, cy + r * 0.45], 200, 340, fill=zc, width=max(2, int(r * 0.14)))
        vc = tuple(int(min(255, c * 1.25)) for c in col[:3]) + (255,)
        for i in range(5):
            a = math.pi * (0.15 + 0.7 * i / 4) + math.pi
            d.line([cx, cy, cx + r * 0.7 * math.cos(a), cy + r * 0.55 * math.sin(a)], fill=vc, width=max(1, S))

    if trailing:
        # loose, irregular curtain: shoots leave the rim in uneven clumps, most are short, a few hang long,
        # each one curves and wobbles on its own and some fork; leaf size and spacing vary along every shoot
        clumps = sorted(rng.uniform(0.02, 0.98, int(rng.integers(11, 15))))
        shoots = []
        for c in clumps:
            for _ in range(int(rng.integers(2, 6))):
                shoots.append(c + rng.normal(0.0, 0.03))
        stem = (52, 70, 30, 255)

        def shoot(x0, y0, length, sway, wob, phase, lean_leaf=1.0):
            pts = []
            y = 0.0
            while y <= length:
                t = y / max(length, 1.0)
                x = x0 + sway * y * (0.25 + 0.5 * t) + wob * W * math.sin(phase + t * 5.0) * t
                pts.append((x, y0 + y))
                y += 6 * S
            if len(pts) > 1:
                d.line(pts, fill=stem, width=max(1, int(rng.choice((1, 2)))) * S)
            y = 0.0
            while y < length:
                t = y / max(length, 1.0)
                k = min(int(y / (6 * S)), len(pts) - 1)
                px, py = pts[k]
                r = W * rng.uniform(0.009, 0.022) * (1.0 - 0.4 * t) * lean_leaf
                if rng.random() < 0.85:
                    leaf(px + rng.uniform(-1.2, 1.2) * r, py, r, int(rng.integers(0, 5)))
                y += r * rng.uniform(0.8, 2.2)
            return pts

        for xf in shoots:
            x = W * float(np.clip(xf, 0.01, 0.99))
            length = H * float(np.clip(rng.beta(1.7, 1.9) * 1.0 + 0.10, 0.12, 0.97))
            pts = shoot(x, 0.0, length, rng.uniform(-0.45, 0.45), rng.uniform(-0.02, 0.02), rng.uniform(0, 6.3))
            if rng.random() < 0.35 and len(pts) > 6:                 # a side shoot forking off
                k = int(rng.integers(2, len(pts) - 2))
                bx, by = pts[k]
                shoot(bx, by, (length - by) * rng.uniform(0.4, 0.8), rng.uniform(-0.6, 0.6), rng.uniform(-0.015, 0.015),
                      rng.uniform(0, 6.3), lean_leaf=0.85)
            if flowers and rng.random() < 0.4:
                fc = flowers[int(rng.integers(0, len(flowers)))]
                fx, fy = pts[int(rng.integers(len(pts) // 3, len(pts)))] if len(pts) > 3 else pts[-1]
                fr = W * rng.uniform(0.008, 0.012)
                d.ellipse([fx - fr, fy - fr, fx + fr, fy + fr], fill=fc + (255,))
        # a thin, ragged fringe of leaves where the shoots leave the trough (only above the clumps)
        for c in clumps:
            for _ in range(int(rng.integers(3, 8))):
                x = W * float(np.clip(c + rng.normal(0.0, 0.04), 0.0, 1.0))
                leaf(x, rng.uniform(0, H * 0.06), W * rng.uniform(0.012, 0.024), int(rng.integers(0, 5)))
    else:
        # mound of leaves, back (dark) to front (light), denser toward the bottom
        for layer in range(4):
            n = 70 + layer * 25
            for _ in range(n):
                x = rng.uniform(0.03, 0.97) * W
                edge = 1.0 - (abs(x / W - 0.5) * 2.0) ** 3
                top = H * (1.0 - (0.42 + 0.22 * layer / 3.0) * (0.55 + 0.45 * edge))
                y = rng.uniform(top, H * 1.02)
                r = W * rng.uniform(0.020, 0.034) * (1.0 - 0.15 * layer / 3.0)
                leaf(x, y, r, layer + int(rng.integers(0, 2)))
        # flower umbels on short stalks above the leaves
        n_heads = 13
        for hi in range(n_heads):
            x = W * (hi + 0.5) / n_heads + rng.uniform(-W * 0.025, W * 0.025)
            edge = 1.0 - (abs(x / W - 0.5) * 2.0) ** 3
            y = H * (1.0 - (0.62 + rng.uniform(0.0, 0.25)) * (0.6 + 0.4 * edge))
            d.line([x, y, x + rng.uniform(-6, 6) * S, y + H * 0.22], fill=(60, 92, 36, 255), width=2 * S)
            fc = flowers[hi % len(flowers)]
            hr = W * rng.uniform(0.026, 0.036)
            for _ in range(int(hr / S * 1.6)):           # umbel: many small five-petal florets in a dome
                a = rng.uniform(0, 2 * math.pi)
                rr = hr * math.sqrt(rng.uniform(0, 1))
                fx, fy = x + rr * math.cos(a), y + rr * 0.75 * math.sin(a)
                k = rng.uniform(0.78, 1.08)
                col = tuple(int(min(255, c * k)) for c in fc) + (255,)
                pr = W * rng.uniform(0.0055, 0.0085)
                for p in range(5):
                    pa = 2 * math.pi * p / 5 + a
                    px, py = fx + pr * 0.7 * math.cos(pa), fy + pr * 0.7 * math.sin(pa)
                    d.ellipse([px - pr * 0.6, py - pr * 0.6, px + pr * 0.6, py + pr * 0.6], fill=col)
                cc = tuple(int(min(255, c * 1.2)) for c in fc) + (255,)
                d.ellipse([fx - pr * 0.25, fy - pr * 0.25, fx + pr * 0.25, fy + pr * 0.25], fill=cc)
    img = img.resize((w, h), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32)
    # bleed leaf colour into the transparent texels so filtered / mip-mapped card edges do not go black
    rgb, al = a[:, :, :3], a[:, :, 3:4] / 255.0
    blur = np.asarray(Image.fromarray(np.clip(rgb * al, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    wgt = np.asarray(Image.fromarray(np.clip(al[:, :, 0] * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[:, :, None] / 255.0
    fill = blur / np.maximum(wgt, 1e-3)
    out_rgb = rgb * al + np.clip(fill, 0, 255) * (1.0 - al)
    out = np.concatenate([np.clip(out_rgb, 0, 255), a[:, :, 3:4]], axis=-1)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def gen_trough_planting(name: str = "trough_planting"):
    """1024 x 512 RGBA alpha-card atlas for the stone flower troughs (geranium / marigold / petunia clumps and
    trailing foliage). Cell rectangles: PLANTING_CELLS."""
    atlas = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))
    atlas.paste(_planting_cell(512, 256, [(196, 28, 34), (214, 44, 50), (172, 20, 30)], seed=11), (0, 0))
    atlas.paste(_planting_cell(512, 256, [(236, 168, 18), (244, 196, 40), (222, 120, 14)], seed=12), (512, 0))
    atlas.paste(_planting_cell(512, 256, [(118, 60, 150), (150, 92, 178), (226, 222, 214)], seed=13), (0, 256))
    atlas.paste(_planting_cell(512, 256, [(214, 44, 50), (226, 222, 214)], seed=14, trailing=True), (512, 256))
    # binary alpha (the material alpha-tests at 0.5 anyway) + 256-colour palette: the GLB embeds this file's
    # bytes unchanged, so a small indexed PNG keeps the church under its 10 MB budget
    arr = np.asarray(atlas).copy()
    arr[:, :, 3] = np.where(arr[:, :, 3] >= 128, 255, 0)
    q = Image.fromarray(arr, "RGBA").quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    q.save(OUT_DIR / f"{name}.png", optimize=True)
    print(f"  {name}.png (1024x512 indexed RGBA, {(OUT_DIR / f'{name}.png').stat().st_size // 1024} KB)")


def gen_detail_atlases():
    print(f"Generating church / Rathaus detail atlases in {OUT_DIR} ...")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    gen_kirche_details()
    gen_leaded_glass()
    gen_rathaus_details()
    gen_rolladen_slats()
    gen_lamp_glow()
    gen_trough_planting()


if __name__ == "__main__":
    if "--atlases" in sys.argv:
        gen_detail_atlases()
    else:
        main()
        gen_detail_atlases()
