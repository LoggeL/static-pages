"""Photo-based crop / meadow atlases for the agricultural fields (system python3, not Blender).

    python3 blender/fields/build_crop_atlases.py [wheat] [stubble] [corn] [beet] [sunflower] [meadow]

Each atlas (blender/fields/textures/crop_<name>_atlas_{albedo,normal}.png + .json) holds
    floor      opaque top-down tile that carpets one field tile (kept visible under every LOD)
    wall / …   alpha-masked side views for cards
Leaves and blades are CC0 scans (ambientCG LeafSet / Foliage, see blender/shared_textures/_extra_vegetation),
ground comes from the shared library; ears, tassels and blossoms are drawn procedurally with real normals.
"""
from __future__ import annotations

import math
import os
import random
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'village', 'props'))
from veg_atlas_lib import (  # noqa: E402
    Atlas,
    Canvas,
    EXTRA,
    ROOT,
    Sprite,
    extract_sprites,
    fbm,
    fbm_wrap,
    luminance_normal,
    seamless_resample,
    save_floor,
    tile_library_albedo,
)

OUT_DIR = os.path.join(ROOT, 'blender', 'fields', 'textures')


def tip_angle(dx: float, dy: float) -> float:
    return math.degrees(math.atan2(-dx, -dy))


def px_scale(sp: Sprite, target_px: float) -> float:
    return target_px / max(sp.h, sp.w)


def loess(w: int, h: int, width_m: float, rng: random.Random, gain: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Palatinate loess-loam floor: the library's ploughed soil, lighter and greyer."""
    soil, n = tile_library_albedo('soil_ploughed', w, h, width_m, rng, seamless=True)
    lum = soil @ np.asarray([0.3, 0.59, 0.11], np.float32)
    out = (lum[..., None] + (soil - lum[..., None]) * 0.12) * (np.asarray([0.58, 0.52, 0.435], np.float32) / max(float(lum.mean()), 1e-3)) * gain
    return np.clip(out, 0, 1).astype(np.float32), n


def extra_albedo(folder: str, w: int, h: int, tile_m: float, width_m: float, rng: random.Random) -> tuple[np.ndarray, np.ndarray]:
    """Seamless crop of a CC0 extra material (albedo + normal) at real-world scale."""
    a_path = os.path.join(EXTRA, folder, f'{folder}_albedo.jpg')
    n_path = os.path.join(EXTRA, folder, f'{folder}_normal.jpg')
    alb = cv2.imread(a_path)
    nrm = cv2.imread(n_path)
    if alb is None or nrm is None:
        raise FileNotFoundError(f'extra vegetation material missing: {a_path}')
    alb = alb.astype(np.float32)[..., ::-1] / 255.0
    nrm = nrm.astype(np.float32)[..., ::-1] / 255.0 * 2.0 - 1.0
    return seamless_resample(alb, nrm, tile_m, w, h, width_m, rng)


def tone(rgb: np.ndarray, target255, amount: float = 1.0, sat: float = 1.0) -> np.ndarray:
    mean = np.maximum(rgb.reshape(-1, 3).mean(axis=0), 1e-3)
    gain = 1.0 + (np.asarray(target255, np.float32) / 255.0 / mean - 1.0) * amount
    out = rgb * gain[None, None, :]
    if sat != 1.0:
        lum = out @ np.asarray([0.3, 0.59, 0.11], np.float32)
        out = lum[..., None] + (out - lum[..., None]) * sat
    return np.clip(out, 0, 1).astype(np.float32)


def opaque_canvas(rgb: np.ndarray, nrm: np.ndarray | None = None) -> Canvas:
    c = Canvas(rgb.shape[1], rgb.shape[0])
    c.fill_opaque(rgb, nrm)
    return c


def image_tile(path: str, normal_path: str | None, w: int, h: int) -> Canvas:
    """Existing RGBA card texture (from the first asset pass) resampled into a tile."""
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f'card texture missing: {path}')
    if img.ndim != 3 or img.shape[2] != 4:
        from PIL import Image
        img = cv2.cvtColor(np.asarray(Image.open(path).convert('RGBA')), cv2.COLOR_RGBA2BGRA)
    img = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    c = Canvas(w, h)
    c.rgb[:] = img[..., 2::-1]
    c.alpha[:] = img[..., 3]
    if normal_path:
        n = cv2.imread(normal_path)
        if n is None:
            raise FileNotFoundError(f'card normal missing: {normal_path}')
        n = cv2.resize(n, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)[..., ::-1] / 255.0 * 2.0 - 1.0
        c.normal[:] = n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6)
    else:
        c.normal[:] = luminance_normal(c.rgb, c.alpha)
    return c


def finish_procedural(c: Canvas, strength: float = 2.0) -> Canvas:
    """Blend a luminance-derived normal into areas that were drawn without one (flat normal)."""
    flat = c.normal[..., 2] > 0.995
    n = luminance_normal(c.rgb, c.alpha, strength)
    c.normal[flat] = n[flat]
    return c


# ---------------------------------------------------------------------------------------------------------
# Wheat & stubble
# ---------------------------------------------------------------------------------------------------------

def ear_speckle(rgb: np.ndarray, rng: random.Random, count: int, color, length=(5, 10), alpha: np.ndarray | None = None) -> None:
    h, w = rgb.shape[:2]
    for _ in range(count):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        a = rng.gauss(0, 0.5)
        ln = rng.uniform(*length)
        x1, y1 = x + math.cos(a) * ln, y + math.sin(a) * ln
        jit = rng.uniform(0.8, 1.15)
        col = tuple(float(min(1.0, c / 255.0 * jit)) for c in color)
        cv2.line(rgb, (int(x), int(y)), (int(x1), int(y1)), col, 2, cv2.LINE_AA)
        if alpha is not None:
            cv2.line(alpha, (int(x), int(y)), (int(x1), int(y1)), 1.0, 3, cv2.LINE_AA)


def build_wheat() -> None:
    rng = random.Random(31)
    atlas = Atlas(2048, 1024)
    base, n = extra_albedo('withered_grass', 1024, 1024, 2.0, 6.0, rng)
    floor = tone(base, (190, 160, 102), 0.95, sat=0.78)
    # drill rows along u, 12.5 cm apart -> soft darker lines
    yy = np.arange(1024, dtype=np.float32)[:, None]
    rows = 0.95 + 0.05 * np.cos(yy / (1024 / 48.0) * math.tau)
    floor = floor * rows[..., None]
    ear_speckle(floor, rng, 9000, (212, 184, 124))
    ear_speckle(floor, rng, 4000, (164, 134, 82))
    save_floor(opaque_canvas(np.clip(floor, 0, 1), n), OUT_DIR, 'crop_wheat_floor', {'tileM': [6.0, 6.0]})
    wall = image_tile(os.path.join(HERE, 'wheat', 'textures', 'wheat_blade_albedo.png'), os.path.join(HERE, 'wheat', 'textures', 'wheat_blade_normal.jpg'), 1008, 496)
    wall.rgb[:] = tone(wall.rgb, (188, 158, 98), 0.6, sat=0.8)
    atlas.blit('wall', wall, 1032, 8, {'widthM': 2.0, 'heightM': 1.0})
    lid = Canvas(1008, 496)
    lid.rgb[:] = tone(cv2.resize(base, (1008, 496)), (190, 160, 102), 0.9, sat=0.78)
    ear_speckle(lid.rgb, rng, 5200, (212, 184, 124), (6, 12), alpha=lid.alpha)
    ear_speckle(lid.rgb, rng, 2600, (168, 138, 86), (6, 12), alpha=lid.alpha)
    atlas.blit('lid', finish_procedural(lid, 3.0), 1032, 520, {'widthM': 3.0, 'heightM': 1.5})
    meta = atlas.save(OUT_DIR, 'crop_wheat_atlas', normal_size=1024, webp_quality=66)
    print('[crop-atlas] wheat', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


def build_stubble() -> None:
    rng = random.Random(32)
    atlas = Atlas(2048, 1024)
    soil, sn = loess(1024, 1024, 6.0, rng, 1.0)
    straw, tn = extra_albedo('withered_grass', 1024, 1024, 2.0, 6.0, rng)
    straw = tone(straw, (192, 168, 118), 0.95, sat=0.7)
    yy = np.arange(1024, dtype=np.float32)[:, None]
    # stubble rows 12.5 cm apart with chaff between; combine swaths every 3 m are brighter
    rowm = np.clip(0.5 + 0.9 * np.cos(yy / (1024 / 48.0) * math.tau), 0, 1)
    swath = 0.5 + 0.5 * np.cos(yy / (1024 / 2.0) * math.tau)
    cover = np.clip(0.46 + 0.36 * rowm + 0.18 * swath + (fbm_wrap(1024, 1024, rng, 4, 8) - 0.5) * 0.5, 0, 1)[..., None]
    floor = soil * (1 - cover) + straw * cover
    nrm = sn * (1 - cover) + tn * cover
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    ear_speckle(floor, rng, 7000, (208, 186, 134), (6, 16))
    save_floor(opaque_canvas(np.clip(floor, 0, 1), nrm), OUT_DIR, 'crop_stubble_floor', {'tileM': [6.0, 6.0]})
    side = image_tile(os.path.join(HERE, 'wheat', 'textures', 'stubble_blade_albedo.png'), os.path.join(HERE, 'wheat', 'textures', 'stubble_blade_normal.jpg'), 1008, 496)
    side.rgb[:] = tone(side.rgb, (192, 168, 118), 0.6, sat=0.75)
    atlas.blit('side', side, 1032, 8, {'widthM': 2.0, 'heightM': 1.0})
    meta = atlas.save(OUT_DIR, 'crop_stubble_atlas', normal_size=1024, webp_quality=66)
    print('[crop-atlas] stubble', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


# ---------------------------------------------------------------------------------------------------------
# Maize
# ---------------------------------------------------------------------------------------------------------

def maize_plant(c: Canvas, x: float, base_y: float, height_px: float, blades: list[Sprite], rng: random.Random, shade: float, wrap: bool) -> None:
    lean = rng.uniform(-0.04, 0.04) * height_px
    top = (x + lean, base_y - height_px * 0.86)
    offs = (-c.w, 0, c.w) if wrap else (0,)
    for off in offs:
        c.stroke([(x + off, base_y), (x + lean * 0.5 + off, base_y - height_px * 0.45), (top[0] + off, top[1])], 9.0, 4.0, (118, 138, 62), (136, 150, 70), shade=shade)
    nodes = 9
    for k in range(nodes):
        t = 0.12 + 0.76 * k / (nodes - 1)
        px = x + lean * t
        py = base_y - height_px * 0.86 * t
        side = 1 if (k + int(x)) % 2 == 0 else -1
        sp = rng.choice(blades)
        if side < 0:
            sp = sp.mirrored()
        length = height_px * rng.uniform(0.30, 0.42) * (1.0 - 0.25 * abs(t - 0.55))
        ang = -side * rng.uniform(30, 68)
        dry = max(0.0, 0.35 - t) / 0.35
        leaf = sp.toward((158, 140, 78), 0.8 * dry + 0.05, sat=1.0 - 0.3 * dry) if dry > 0.05 else sp
        c.place(leaf, px, py, ang, length / max(sp.h, 1), anchor=(0.5, 1.0), shade=shade * rng.uniform(0.86, 1.06),
                tilt=(side * rng.uniform(0.1, 0.5), rng.uniform(0.0, 0.5)), wrap_x=wrap)
    # tassel
    for _ in range(9):
        a = rng.uniform(-0.75, 0.75)
        ln = height_px * rng.uniform(0.09, 0.15)
        for off in offs:
            c.stroke([(top[0] + off, top[1]), (top[0] + off + math.sin(a) * ln * 0.5, top[1] - math.cos(a) * ln * 0.6), (top[0] + off + math.sin(a) * ln, top[1] - math.cos(a) * ln)],
                     3.0, 1.4, (176, 158, 100), (200, 182, 124), shade=shade)
    # cob with husk + silk
    if rng.random() < 0.8:
        side = rng.choice((-1, 1))
        cy = base_y - height_px * rng.uniform(0.40, 0.5)
        cx = x + lean * 0.45 + side * 9
        for off in offs:
            c.stroke([(cx + off, cy), (cx + off + side * 14, cy - height_px * 0.10)], 17.0, 9.0, (150, 160, 78), (176, 172, 96), shade=shade)
            c.stroke([(cx + off + side * 14, cy - height_px * 0.10), (cx + off + side * 22, cy - height_px * 0.135)], 4.0, 1.5, (120, 78, 40), shade=shade)


def build_corn() -> None:
    rng = random.Random(41)
    atlas = Atlas(2048, 2048)
    raw = extract_sprites('Foliage008')
    blades = []
    for sp in raw:
        v = sp.rotated90(1)  # base to the bottom
        # maize leaves are broad (8-10 cm): widen the scanned grass blade
        v = Sprite(cv2.resize(v.rgb, (v.w * 2, v.h)), cv2.resize(v.alpha, (v.w * 2, v.h)), cv2.resize(v.normal, (v.w * 2, v.h)))
        blades.append(v.toward((66, 104, 40), 0.9, sat=0.9))
        blades.append(v.toward((84, 120, 46), 0.9, sat=0.9))
    px_m = 2048 / 6.0
    soil, sn = loess(2048, 816, 6.0, rng, 0.92)
    # shade under the three rows + dry leaf litter
    yy = (np.arange(816, dtype=np.float32) + 0.5) / 816 * 2.4
    occ = 1.0 - 0.30 * np.maximum.reduce([np.exp(-((yy - r) / 0.16) ** 2) for r in (0.4, 1.2, 2.0)])
    floor = soil * occ[:, None, None]
    ear_speckle(floor, rng, 2600, (170, 150, 98), (10, 34))
    save_floor(opaque_canvas(np.clip(floor, 0, 1), sn), OUT_DIR, 'crop_corn_floor', {'tileM': [6.0, 2.4]})
    wall_h = 864
    wall = Canvas(2048, wall_h)
    plant_h = 2.45 * px_m
    for layer, shade in ((0, 0.62), (1, 0.82), (2, 1.0)):
        count = 30 if layer < 2 else 26
        for k in range(count):
            x = (k + rng.uniform(0.2, 0.8)) / count * 2048
            maize_plant(wall, x, wall_h - 2, plant_h * rng.uniform(0.88, 1.0), blades, rng, shade * rng.uniform(0.94, 1.04), True)
    atlas.blit('wall', wall, 0, 832, {'widthM': 6.0, 'heightM': wall_h / px_m})
    # top-down canopy for the far lid: radiating blades + tassel dots
    lid = Canvas(1016, 336)
    for _ in range(170):
        x, y = rng.uniform(0, 1016), rng.uniform(0, 336)
        for b in range(5):
            sp = rng.choice(blades)
            lid.place(sp, x, y, rng.uniform(0, 360), rng.uniform(100, 150) / sp.h, anchor=(0.5, 1.0), shade=rng.uniform(0.7, 1.05),
                      tilt=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)), wrap_x=True, wrap_y=True)
        lid.disc(x, y, 5, (196, 178, 120))
    atlas.blit('lid', lid, 8, 1704, {'widthM': 3.0, 'heightM': 1.0})
    meta = atlas.save(OUT_DIR, 'crop_corn_atlas', normal_size=1024, webp_quality=66)
    print('[crop-atlas] corn', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


# ---------------------------------------------------------------------------------------------------------
# Sugar beet
# ---------------------------------------------------------------------------------------------------------

def beet_rosette(c: Canvas, x: float, y: float, r: float, leaves: list[Sprite], rng: random.Random, wrap: bool = False, shade: float = 1.0) -> None:
    order = [(rng.random(), k) for k in range(13)]
    order.sort()
    for depth, k in order:
        a = k / 13 * 360 + rng.uniform(-14, 14)
        sp = rng.choice(leaves)
        ln = r * rng.uniform(0.75, 1.1) * (0.7 + 0.3 * depth)
        ar = math.radians(a)
        c.place(sp, x, y, a, ln / sp.h, anchor=(0.5, 0.97), shade=shade * (0.72 + 0.32 * depth),
                tilt=(-math.sin(ar) * 0.45, math.cos(ar) * 0.45), wrap_x=wrap, wrap_y=wrap)


def beet_clump(w: int, h: int, leaves: list[Sprite], rng: random.Random) -> Canvas:
    c = Canvas(w, h)
    bx, by = w * 0.5, h - 8.0
    c.disc(bx, by - 6, 30, (150, 132, 104), squash=0.55)  # crown of the beet above the soil
    items = []
    for k in range(15):
        a = rng.uniform(-78, 78)
        items.append((abs(a) + rng.uniform(-10, 10), a))
    items.sort(reverse=True)
    for i, (_, a) in enumerate(items):
        sp = rng.choice(leaves)
        ln = h * rng.uniform(0.62, 0.92) * (1.0 - 0.25 * abs(a) / 78)
        c.place(sp, bx + rng.uniform(-14, 14), by - rng.uniform(0, 14), a, ln / sp.h, anchor=(0.5, 0.98), shade=0.74 + 0.3 * i / len(items),
                tilt=(-math.sin(math.radians(a)) * 0.5, rng.uniform(-0.2, 0.3)))
    return c


def build_beet() -> None:
    rng = random.Random(51)
    atlas = Atlas(2048, 2048)
    raw = extract_sprites('LeafSet018')
    leaves = []
    for sp in raw:
        leaves.append(sp.toward((48, 92, 34), 0.92, sat=0.95))
        leaves.append(sp.toward((62, 106, 40), 0.92, sat=0.95))
    soil, sn = loess(2048, 848, 6.0, rng, 0.88)
    floor = opaque_canvas(soil, sn)
    px_m = 2048 / 6.0
    for row in range(5):
        y = (0.25 + 0.5 * row) * px_m
        n_pl = 24
        for k in range(n_pl):
            x = (k + 0.5 + rng.uniform(-0.2, 0.2)) / n_pl * 2048
            beet_rosette(floor, x, y + rng.uniform(-10, 10), 0.30 * px_m * rng.uniform(0.85, 1.1), leaves, rng, wrap=True, shade=rng.uniform(0.88, 1.0))
    floor.alpha[:] = 1.0
    save_floor(floor, OUT_DIR, 'crop_beet_floor', {'tileM': [6.0, 2.5]})
    for i in range(4):
        atlas.blit(f'clump_{i}', beet_clump(496, 400, leaves, rng), 8 + i * 512, 872, {'widthM': 0.62, 'heightM': 0.5})
    ros = Canvas(496, 496)
    beet_rosette(ros, 248, 248, 236, leaves, rng)
    atlas.blit('rosette', ros, 8, 1288, {'widthM': 0.6, 'heightM': 0.6})
    side = Canvas(1528, 400)
    for layer in range(2):
        for k in range(8):
            cl = beet_clump(496, 400, leaves, rng).to_sprite()
            side.place(cl, (k + rng.uniform(0.3, 0.7)) / 8 * 1528, 398, 0, rng.uniform(0.82, 1.0), anchor=(0.5, 1.0), shade=0.72 + 0.28 * layer, wrap_x=True)
    atlas.blit('row_side', side, 512, 1288, {'widthM': 3.0, 'heightM': 0.5})
    meta = atlas.save(OUT_DIR, 'crop_beet_atlas', normal_size=1024, webp_quality=66)
    print('[crop-atlas] beet', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


# ---------------------------------------------------------------------------------------------------------
# Sunflower
# ---------------------------------------------------------------------------------------------------------

def sunflower_head(size: int, rng: random.Random, back: bool = False) -> Canvas:
    c = Canvas(size, size)
    cx = cy = size / 2
    r_disc = size * 0.25
    petal = Canvas(40, 120)
    yy, xx = np.mgrid[0:120, 0:40].astype(np.float32)
    u = (xx - 20) / 15.0
    v = (yy - 60) / 58.0
    a = np.clip((1 - (u * u + v * v)) * 6, 0, 1)
    grad = np.clip(1 - yy / 120.0, 0, 1)[..., None]
    col = np.asarray([0.93, 0.70, 0.10], np.float32) * (1 - grad * 0.0) + np.asarray([0.05, 0.06, 0.0], np.float32) * grad
    petal.rgb[:] = col * (0.86 + 0.14 * (1 - np.abs(u))[..., None])
    petal.alpha[:] = a
    petal.normal[..., 0] = np.clip(u, -1, 1) * 0.5
    petal.normal[..., 2] = np.sqrt(np.clip(1 - petal.normal[..., 0] ** 2, 0.1, 1))
    psp = petal.to_sprite()
    if back:
        psp = psp.graded(gain=(0.45, 0.72, 0.30))
    for ring, (count, ln, shade) in enumerate(((21, 0.26, 0.82), (21, 0.24, 1.0))):
        for k in range(count):
            ang = (k + 0.5 * ring) / count * 360 + rng.uniform(-5, 5)
            ar = math.radians(ang)
            px = cx - math.sin(ar) * r_disc * 0.86
            py = cy - math.cos(ar) * r_disc * 0.86
            c.place(psp, px, py, ang, (size * ln * rng.uniform(0.85, 1.1)) / 120.0, anchor=(0.5, 1.0), shade=shade * rng.uniform(0.9, 1.05))
    if back:
        c.disc(cx, cy, r_disc * 1.05, (86, 118, 52))
    else:
        c.disc(cx, cy, r_disc, (74, 48, 24))
        for k in range(260):
            rr = r_disc * math.sqrt(k / 260.0) * 0.96
            th = k * 2.39996
            c.disc(cx + math.cos(th) * rr, cy + math.sin(th) * rr, 2.4, (112, 76, 34) if k % 3 else (58, 36, 18))
        c.disc(cx, cy, r_disc * 0.33, (96, 92, 40), shade=0.9)
    return c


def sunflower_plant(c: Canvas, x: float, base_y: float, height_px: float, leaves: list[Sprite], head: Sprite, head_back: Sprite, rng: random.Random,
                    shade: float, wrap: bool) -> None:
    lean = rng.uniform(-0.05, 0.05) * height_px
    top = (x + lean, base_y - height_px * 0.90)
    offs = (-c.w, 0, c.w) if wrap else (0,)
    for off in offs:
        c.stroke([(x + off, base_y), (x + lean * 0.4 + off, base_y - height_px * 0.5), (top[0] + off, top[1])], 11.0, 6.0, (110, 128, 60), (128, 142, 68), shade=shade)
    nodes = 9
    for k in range(nodes):
        t = 0.14 + 0.72 * k / (nodes - 1)
        px = x + lean * t
        py = base_y - height_px * 0.90 * t
        side = 1 if (k + int(x)) % 2 == 0 else -1
        sp = rng.choice(leaves)
        ln = height_px * rng.uniform(0.17, 0.24)
        dry = max(0.0, 0.4 - t) / 0.4
        leaf = sp.toward((150, 130, 66), 0.85 * dry, sat=1.0 - 0.3 * dry) if dry > 0.05 else sp
        ex = px + side * height_px * rng.uniform(0.04, 0.08)
        ey = py + rng.uniform(-6, 8)
        for off in offs:
            c.stroke([(px + off, py), (ex + off, ey)], 3.5, 2.0, (126, 142, 70), shade=shade)
        c.place(leaf, ex, ey, 180 - side * rng.uniform(50, 100), ln / max(sp.h, sp.w), anchor=(0.5, 1.0), shade=shade * rng.uniform(0.84, 1.05),
                tilt=(side * rng.uniform(0.1, 0.45), rng.uniform(-0.1, 0.4)), wrap_x=wrap)
    # late-summer head nods forward: seen slightly squashed, some turned away
    hs = height_px * rng.uniform(0.15, 0.2)
    hd = head_back if rng.random() < 0.22 else head
    c.place(hd, top[0] + rng.uniform(-8, 8), top[1] + hs * 0.28, rng.uniform(-25, 25), hs / hd.w, anchor=(0.5, 0.5), shade=min(1.05, shade * 1.05), wrap_x=wrap)


def build_sunflower() -> None:
    rng = random.Random(61)
    atlas = Atlas(2048, 2048)
    raw = extract_sprites('LeafSet023')
    leaves = []
    for sp in raw:
        v = sp.rotated90(1)  # petiole to the bottom
        leaves.append(v.toward((62, 100, 38), 0.92, sat=0.85))
        leaves.append(v.toward((80, 112, 44), 0.92, sat=0.85))
    head = sunflower_head(248, rng).to_sprite()
    head_back = sunflower_head(248, rng, back=True).to_sprite()
    px_m = 2048 / 6.0
    soil, sn = loess(1024, 1024, 6.0, rng, 0.86)
    yy = (np.arange(1024, dtype=np.float32) + 0.5) / 1024 * 6.0
    occ = 1.0 - 0.3 * np.maximum.reduce([np.exp(-((yy - (0.375 + 0.75 * r)) / 0.16) ** 2) for r in range(8)])
    floor = soil * occ[:, None, None]
    ear_speckle(floor, rng, 2200, (150, 132, 84), (8, 26))
    save_floor(opaque_canvas(np.clip(floor, 0, 1), sn), OUT_DIR, 'crop_sunflower_floor', {'tileM': [6.0, 6.0]})
    # top-down canopy: leaves around each plant + the yellow of nodding heads
    lid = Canvas(1008, 1008)
    for row in range(8):
        for k in range(20):
            x = (k + rng.uniform(0.2, 0.8)) / 20 * 1008
            y = (0.375 + 0.75 * row) / 6.0 * 1008 + rng.uniform(-10, 10)
            for b in range(6):
                sp = rng.choice(leaves)
                ang = b * 60 + rng.uniform(-25, 25)
                ar = math.radians(ang)
                lid.place(sp, x, y, ang, rng.uniform(46, 62) / max(sp.h, sp.w), anchor=(0.5, 1.0), shade=rng.uniform(0.72, 1.02),
                          tilt=(-math.sin(ar) * 0.4, math.cos(ar) * 0.4), wrap_x=True, wrap_y=True)
            lid.place(head, x + rng.uniform(-6, 6), y + 14, rng.uniform(0, 360), 34.0 / head.w, anchor=(0.5, 0.5), wrap_x=True, wrap_y=True)
    atlas.blit('lid', lid, 1032, 8, {'widthM': 6.0, 'heightM': 6.0})
    wall_h = 672
    wall = Canvas(2048, wall_h)
    plant_h = 1.9 * px_m
    for layer, shade in ((0, 0.66), (1, 1.0)):
        count = 22 if layer == 0 else 19
        for k in range(count):
            x = (k + rng.uniform(0.25, 0.75)) / count * 2048
            sunflower_plant(wall, x, wall_h - 2, plant_h * rng.uniform(0.84, 1.0), leaves, head, head_back, rng, shade * rng.uniform(0.94, 1.04), True)
    atlas.blit('wall', wall, 0, 1032, {'widthM': 6.0, 'heightM': wall_h / px_m})
    atlas.blit('head', sunflower_head(248, rng), 8, 1712, {'widthM': 0.3})
    atlas.blit('head_back', sunflower_head(248, rng, back=True), 264, 1712, {'widthM': 0.3})
    meta = atlas.save(OUT_DIR, 'crop_sunflower_atlas', normal_size=1024, webp_quality=66)
    print('[crop-atlas] sunflower', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


# ---------------------------------------------------------------------------------------------------------
# Meadow, wildflowers
# ---------------------------------------------------------------------------------------------------------

def blossom(c: Canvas, x: float, y: float, kind: str, s: float, rng: random.Random, wrap: bool) -> None:
    offs = (-c.w, 0, c.w) if wrap else (0,)
    for off in offs:
        if kind == 'poppy':
            for k in range(4):
                a = k * math.pi / 2 + rng.uniform(-0.3, 0.3)
                c.disc(x + off + math.cos(a) * s * 0.42, y + math.sin(a) * s * 0.36, s * 0.55, (198, 34, 22), shade=rng.uniform(0.85, 1.0), squash=0.85)
            c.disc(x + off, y, s * 0.2, (30, 24, 28))
        elif kind == 'cornflower':
            for k in range(9):
                a = k * math.tau / 9
                c.disc(x + off + math.cos(a) * s * 0.42, y + math.sin(a) * s * 0.42, s * 0.24, (58, 84, 196), shade=rng.uniform(0.85, 1.0))
            c.disc(x + off, y, s * 0.24, (70, 52, 150))
        elif kind == 'daisy':
            for k in range(11):
                a = k * math.tau / 11
                c.disc(x + off + math.cos(a) * s * 0.4, y + math.sin(a) * s * 0.4, s * 0.2, (236, 236, 226))
            c.disc(x + off, y, s * 0.24, (226, 184, 40))
        elif kind == 'yarrow':
            for k in range(14):
                c.disc(x + off + rng.uniform(-s, s) * 0.7, y + rng.uniform(-s, s) * 0.3, s * 0.16, (232, 230, 214), shade=rng.uniform(0.85, 1.0))
        else:  # yellow composite (hawkweed / tansy)
            c.disc(x + off, y, s * 0.42, (228, 186, 36))
            c.disc(x + off, y, s * 0.2, (206, 150, 24))


def grass_tuft(c: Canvas, x: float, base_y: float, height: float, blades: list[Sprite], heads: list[Sprite], rng: random.Random, count: int,
               wrap: bool, flowers: list[str] | None = None, shade0: float = 0.7) -> None:
    items = []
    for _ in range(count):
        items.append((rng.random(), rng.gauss(0, 16)))
    items.sort()
    for i, (_, ang) in enumerate(items):
        sp = rng.choice(blades)
        if rng.random() < 0.5:
            sp = sp.mirrored()
        ln = height * rng.uniform(0.55, 1.0)
        shade = shade0 + (1.05 - shade0) * (i / max(1, len(items) - 1))
        c.place(sp, x + rng.uniform(-0.2, 0.2) * height, base_y, ang, ln / sp.h, anchor=(0.5, 1.0), shade=shade,
                tilt=(-math.sin(math.radians(ang)) * 0.5, rng.uniform(0, 0.3)), wrap_x=wrap)
    for _ in range(max(1, count // 14)):
        sp = rng.choice(heads)
        ang = rng.gauss(0, 9)
        ln = height * rng.uniform(0.95, 1.2)
        c.place(sp, x + rng.uniform(-0.2, 0.2) * height, base_y, ang, ln / sp.h, anchor=(0.5, 1.0), shade=rng.uniform(0.9, 1.05), wrap_x=wrap)
    if flowers:
        for _ in range(rng.randint(2, 5)):
            kind = rng.choice(flowers)
            fx = x + rng.uniform(-0.3, 0.3) * height
            fy = base_y - height * rng.uniform(0.55, 1.15)
            offs = (-c.w, 0, c.w) if wrap else (0,)
            for off in offs:
                c.stroke([(fx + off + rng.uniform(-6, 6), base_y), (fx + off, fy)], 2.4, 1.6, (96, 124, 56), shade=0.9)
            blossom(c, fx, fy, kind, height * rng.uniform(0.045, 0.07), rng, wrap)


def build_meadow() -> None:
    rng = random.Random(71)
    atlas = Atlas(2048, 2048)
    blades = []
    for set_id in ('Foliage001', 'Foliage006'):
        for sp in extract_sprites(set_id, min_area_frac=0.0006):
            if sp.h < sp.w * 2:
                continue
            blades.append(sp.toward((78, 112, 46), 0.9, sat=0.9))
            blades.append(sp.toward((98, 126, 54), 0.9, sat=0.9))
            blades.append(sp.toward((128, 136, 66), 0.9, sat=0.85))
            if len(blades) % 2 == 0:
                blades.append(sp.toward((150, 146, 84), 0.85, sat=0.8))  # some dry late-summer blades
    heads = []
    for set_id in ('Foliage002', 'Foliage003'):
        for sp in extract_sprites(set_id, min_area_frac=0.0004):
            heads.append(sp.toward((132, 130, 80), 0.85, sat=0.8))
    if not blades or not heads:
        raise RuntimeError('meadow atlas: no blade / seed-head sprites extracted')
    grass, gn = tile_library_albedo('grass', 1024, 1024, 6.0, rng, seamless=True)
    lum = grass @ np.asarray([0.3, 0.59, 0.11], np.float32)
    straw = lum[..., None] * np.asarray([1.3, 1.16, 0.66], np.float32)
    dry = np.clip((fbm_wrap(1024, 1024, rng, 4, 5) - 0.36) * 2.4, 0, 1)[..., None] * 0.6
    floor = grass * np.asarray([0.74, 0.86, 0.56], np.float32) * (1 - dry * 0.6) + straw * dry * 0.6
    save_floor(opaque_canvas(np.clip(floor, 0, 1), gn), OUT_DIR, 'crop_meadow_floor', {'tileM': [6.0, 6.0]})
    # tileable grass wall: 3 m x 0.74 m
    wall = Canvas(1008, 496)
    for layer in range(3):
        for k in range(26):
            grass_tuft(wall, (k + rng.random()) / 26 * 1008, 496, rng.uniform(230, 340), blades, heads, rng, 14, True, shade0=0.6 + 0.15 * layer)
    atlas.blit('wall', wall, 1032, 8, {'widthM': 3.0, 'heightM': 1.48})
    for i in range(3):
        t = Canvas(328, 496)
        grass_tuft(t, 164, 494, 330, blades, heads, rng, 22, False)
        atlas.blit(f'tuft_{i}', t, 1032 + i * 336, 520, {'widthM': 0.6, 'heightM': 0.9})
    # flowering strip: 3 m x 1.0 m
    kinds = ['poppy', 'cornflower', 'daisy', 'yarrow', 'yellow']
    fw = Canvas(2048, 672)
    for layer in range(3):
        for k in range(40):
            grass_tuft(fw, (k + rng.random()) / 40 * 2048, 672, rng.uniform(330, 470), blades, heads, rng, 7, True,
                       flowers=kinds if layer > 0 else None, shade0=0.55 + 0.15 * layer)
    atlas.blit('flower_wall', fw, 0, 1032, {'widthM': 3.0, 'heightM': 0.98})
    # top-down blossoms for the strip floor / lid
    lid = Canvas(1008, 320)
    for _ in range(420):
        sp = rng.choice(blades)
        lid.place(sp, rng.uniform(0, 1008), rng.uniform(0, 320), rng.uniform(0, 360), rng.uniform(60, 120) / sp.h, anchor=(0.5, 0.5), shade=rng.uniform(0.6, 1.0),
                  wrap_x=True, wrap_y=True)
    for _ in range(150):
        blossom(lid, rng.uniform(0, 1008), rng.uniform(10, 310), rng.choice(kinds), rng.uniform(9, 15), rng, True)
    atlas.blit('flower_lid', lid, 8, 1712, {'widthM': 3.0, 'heightM': 0.95})
    meta = atlas.save(OUT_DIR, 'crop_meadow_atlas', normal_size=1024, webp_quality=66)
    print('[crop-atlas] meadow', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


BUILDERS = {'wheat': build_wheat, 'stubble': build_stubble, 'corn': build_corn, 'beet': build_beet, 'sunflower': build_sunflower, 'meadow': build_meadow}

if __name__ == '__main__':
    which = sys.argv[1:] or list(BUILDERS)
    for name in which:
        if name not in BUILDERS:
            raise SystemExit(f'unknown atlas "{name}" (choose from {", ".join(BUILDERS)})')
        BUILDERS[name]()
