"""Builds the photo-based vegetation atlases for vines, trees and hedges (system python3, not Blender).

    python3 blender/village/props/build_veg_atlases.py [vine] [tree] [hedge]

Outputs (albedo RGBA png + normal png + tile json) into blender/village/textures/props/:
    veg_vine_atlas   2048x2048  leaf wall, shoots, single leaves, grapes, bark/post strips, lane ground
    veg_tree_atlas   2048x2048  4 species x (2 branch cards, 1 crown card for the far LOD, 1 sprig)
    veg_hedge_atlas  1024x1024  hedge / shrub cards
Sources: CC0 ambientCG LeafSet scans (blender/shared_textures/_extra_vegetation) + shared library ground/bark.
"""
from __future__ import annotations

import math
import os
import random
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veg_atlas_lib import (  # noqa: E402
    Atlas,
    Canvas,
    ROOT,
    Sprite,
    extract_sprites,
    fbm,
    fbm_wrap,
    save_floor,
    tile_library_albedo,
)

OUT_DIR = os.path.join(ROOT, 'blender', 'village', 'textures', 'props')


def tip_angle(dx: float, dy: float) -> float:
    """Sprite rotation (deg, CCW) so a stem-at-bottom leaf points along image direction (dx, dy), y down."""
    return math.degrees(math.atan2(-dx, -dy))


def leaf_px_scale(sp: Sprite, target_px: float) -> float:
    return target_px / max(sp.h, sp.w)


def branch_card(
    size_w: int,
    size_h: int,
    leaves: list[Sprite],
    rng: random.Random,
    leaf_px: float,
    twig_rgb=(74, 58, 42),
    side_twigs: int = 5,
    filler: int = 26,
    droop: float = 0.0,
    spread: float = 1.0,
    fruit: dict | None = None,
) -> Canvas:
    """A twig with alternating leaves, anchored bottom-centre (that is where the 3D card attaches to its branch)."""
    c = Canvas(size_w, size_h)
    w, h = size_w, size_h
    base = (w * 0.5, h - 3.0)
    top = (w * (0.5 + rng.uniform(-0.08, 0.08)), h * 0.16)
    bend = rng.uniform(-0.10, 0.10) * w

    def main_pt(t: float) -> tuple[float, float]:
        x = base[0] + (top[0] - base[0]) * t + math.sin(t * math.pi) * bend
        y = base[1] + (top[1] - base[1]) * t
        return x, y

    twigs: list[list[tuple[float, float]]] = [[main_pt(i / 10) for i in range(11)]]
    for k in range(side_twigs):
        t = 0.14 + 0.70 * (k + rng.uniform(0.1, 0.9)) / side_twigs
        side = -1 if k % 2 == 0 else 1
        x0, y0 = main_pt(t)
        ang = math.radians(rng.uniform(38, 66)) * side * spread
        length = w * rng.uniform(0.30, 0.44) * (1.0 - 0.45 * t)
        pts = []
        for i in range(6):
            s = i / 5
            a = ang + side * s * 0.25
            px = x0 + math.sin(a) * length * s
            py = y0 - math.cos(a) * length * s + droop * length * s * s
            pts.append((px, py))
        twigs.append(pts)

    # 1) dark filler leaves behind everything (gives the card its density)
    for _ in range(filler):
        tw = rng.choice(twigs)
        px, py = tw[rng.randrange(1, len(tw))]
        px += rng.uniform(-0.12, 0.12) * w
        py += rng.uniform(-0.10, 0.10) * h
        dx, dy = px - base[0], py - (base[1] - h * 0.25)
        a = tip_angle(dx, dy) + rng.uniform(-70, 70)
        sp = rng.choice(leaves)
        if rng.random() < 0.5:
            sp = sp.mirrored()
        c.place(sp, px, py, a, leaf_px_scale(sp, leaf_px * rng.uniform(0.8, 1.05)), shade=rng.uniform(0.55, 0.74),
                tilt=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)))

    # 2) twigs
    c.stroke(twigs[0], max(2.5, w * 0.014), 1.2, twig_rgb, shade=0.9)
    for tw in twigs[1:]:
        c.stroke(tw, max(1.8, w * 0.008), 1.0, twig_rgb, shade=0.9)

    # 3) leaves along twigs, tips outward, alternate sides
    placements = []
    for ti, tw in enumerate(twigs):
        seg_len = sum(math.hypot(tw[i + 1][0] - tw[i][0], tw[i + 1][1] - tw[i][1]) for i in range(len(tw) - 1))
        count = max(3, int(seg_len / (leaf_px * 0.42)))
        for j in range(count + 1):
            s = (j + rng.uniform(-0.25, 0.25)) / count
            s = min(max(s, 0.12 if ti == 0 else 0.05), 1.0)
            f = s * (len(tw) - 1)
            i0 = min(int(f), len(tw) - 2)
            fr = f - i0
            px = tw[i0][0] + (tw[i0 + 1][0] - tw[i0][0]) * fr
            py = tw[i0][1] + (tw[i0 + 1][1] - tw[i0][1]) * fr
            tx, ty = tw[i0 + 1][0] - tw[i0][0], tw[i0 + 1][1] - tw[i0][1]
            tl = math.hypot(tx, ty) + 1e-6
            tx, ty = tx / tl, ty / tl
            side = 1 if j % 2 == 0 else -1
            if j == count:
                ddx, ddy = tx, ty
            else:
                out_a = math.radians(rng.uniform(40, 78)) * side
                ddx = tx * math.cos(out_a) - ty * math.sin(out_a)
                ddy = tx * math.sin(out_a) + ty * math.cos(out_a) + droop * 0.5
            placements.append((py + rng.uniform(-20, 20), px, py, tip_angle(ddx, ddy)))
    placements.sort(key=lambda p: -p[0])
    n = len(placements)
    for idx, (_, px, py, a) in enumerate(placements):
        sp = rng.choice(leaves)
        if rng.random() < 0.5:
            sp = sp.mirrored()
        shade = 0.80 + 0.24 * (idx / max(1, n - 1)) + rng.uniform(-0.05, 0.05)
        c.place(sp, px, py, a + rng.uniform(-14, 14), leaf_px_scale(sp, leaf_px * rng.uniform(0.82, 1.12)), shade=shade,
                tilt=(rng.uniform(-0.38, 0.38), rng.uniform(-0.38, 0.38)))
        if fruit and rng.random() < fruit['chance']:
            fr_r = fruit['radius'] * rng.uniform(0.85, 1.15)
            col = fruit['colors'][rng.randrange(len(fruit['colors']))]
            fx, fy = px + rng.uniform(-8, 8), py + fr_r * 1.4
            c.disc(fx, fy, fr_r, col, shade=rng.uniform(0.85, 1.0))
            if fruit.get('rose'):
                # layered petals: lighter inner whorls
                c.disc(fx + fr_r * 0.12, fy - fr_r * 0.1, fr_r * 0.66, tuple(min(255, v + 26) for v in col), shade=1.0)
                c.disc(fx - fr_r * 0.08, fy + fr_r * 0.05, fr_r * 0.34, tuple(min(255, v + 46) for v in col), shade=1.0)
    return c


def crown_card(size: int, leaves: list[Sprite], rng: random.Random, leaf_px: float, count: int, twig_rgb=(70, 56, 42)) -> Canvas:
    """Dense blob of small leaves with an irregular outline: one card stands for a whole crown lobe in the far LOD."""
    c = Canvas(size, size)
    cx, cy = size * 0.5, size * 0.52
    lobes = [(cx + rng.uniform(-0.19, 0.19) * size, cy + rng.uniform(-0.19, 0.19) * size, rng.uniform(0.20, 0.28) * size) for _ in range(9)]
    lobes.append((cx, cy, 0.36 * size))
    lobes.append((cx, cy, 0.36 * size))
    # a few branch strokes radiating from the lower centre so gaps show wood, not nothing
    for _ in range(5):
        a = rng.uniform(-1.2, 1.2)
        ln = rng.uniform(0.25, 0.42) * size
        pts = [(cx + math.sin(a) * ln * s, size * 0.86 - math.cos(a) * ln * s * 1.5) for s in (0, 0.35, 0.7, 1.0)]
        c.stroke(pts, size * 0.012, 1.2, twig_rgb, shade=0.7)
    items = []
    for _ in range(count):
        lx, ly, lr = rng.choice(lobes)
        ang = rng.uniform(0, math.tau)
        rad = lr * math.sqrt(rng.random())
        px, py = lx + math.cos(ang) * rad, ly + math.sin(ang) * rad * 0.92
        depth = 1.0 - min(1.0, math.hypot(px - cx, py - cy) / (0.46 * size))
        items.append((rng.random() + depth * 0.25, px, py))
    items.sort(key=lambda t: t[0])
    for i, (_, px, py) in enumerate(items):
        sp = rng.choice(leaves)
        if rng.random() < 0.5:
            sp = sp.mirrored()
        dx, dy = px - cx, py - (cy + size * 0.1)
        shade = 0.60 + 0.46 * (i / max(1, len(items) - 1))
        c.place(sp, px, py, tip_angle(dx, dy) + rng.uniform(-80, 80), leaf_px_scale(sp, leaf_px * rng.uniform(0.8, 1.15)),
                anchor=(0.5, 0.6), shade=shade + rng.uniform(-0.06, 0.06), tilt=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)))
    return c


def sprig_card(size: int, leaves: list[Sprite], rng: random.Random, leaf_px: float) -> Canvas:
    """Three to five large leaves on a short stalk - used for leaves that stick out of the crown silhouette."""
    c = Canvas(size, size)
    base = (size * 0.5, size - 3.0)
    tip = (size * 0.5 + rng.uniform(-0.06, 0.06) * size, size * 0.42)
    c.stroke([base, ((base[0] + tip[0]) / 2 + 6, (base[1] + tip[1]) / 2), tip], 3.0, 1.2, (78, 62, 44), shade=0.9)
    n = 5
    for j in range(n):
        s = 0.25 + 0.75 * j / (n - 1)
        px = base[0] + (tip[0] - base[0]) * s
        py = base[1] + (tip[1] - base[1]) * s
        side = 1 if j % 2 == 0 else -1
        a = 0 if j == n - 1 else side * rng.uniform(42, 72)
        sp = rng.choice(leaves)
        c.place(sp, px, py, a, leaf_px_scale(sp, leaf_px * rng.uniform(0.9, 1.1)), shade=rng.uniform(0.88, 1.04),
                tilt=(rng.uniform(-0.35, 0.35), rng.uniform(-0.3, 0.3)))
    return c


# ---------------------------------------------------------------------------------------------------------
# Vines
# ---------------------------------------------------------------------------------------------------------

def grape_cluster(w: int, h: int, rng: random.Random, berry_r: float, color=(44, 32, 68)) -> Canvas:
    c = Canvas(w, h)
    cx = w * 0.5
    c.stroke([(cx, 2), (cx + rng.uniform(-3, 3), h * 0.16)], 3.0, 2.0, (92, 84, 52))
    berries = []
    rows = int((h * 0.80) / (berry_r * 1.25))
    for r in range(rows):
        t = r / max(1, rows - 1)
        # shoulder-wide at the top, tapering to a point
        half = (w * 0.44) * (math.sin(min(1.0, t * 2.6) * math.pi / 2)) * (1.0 - 0.80 * max(0.0, t - 0.25) / 0.75)
        cnt = max(1, int(half * 2 / (berry_r * 1.35)))
        for k in range(cnt + 1):
            bx = cx - half + (2 * half) * (k + rng.uniform(-0.3, 0.3)) / max(1, cnt)
            by = h * 0.15 + t * h * 0.78 + rng.uniform(-berry_r * 0.4, berry_r * 0.4)
            depth = rng.random()
            berries.append((depth, bx, by))
    berries.sort(key=lambda b: b[0])
    for depth, bx, by in berries:
        shade = 0.55 + 0.5 * depth
        jit = rng.uniform(-10, 10)
        col = (max(0, color[0] + jit), max(0, color[1] + jit * 0.6), min(255, color[2] + jit))
        c.disc(bx, by, berry_r * rng.uniform(0.86, 1.1), col, shade=shade, bloom=0.42 * depth)
    return c


def vine_leaf_wall(w: int, h: int, leaves: list[Sprite], grapes: list[Canvas], rng: random.Random, leaf_px: float) -> Canvas:
    """Side view of a trellised leaf wall, periodic in x. Top = shoot tips, bottom = fruit zone with gaps."""
    c = Canvas(w, h)
    dens = fbm(w, 8, rng, octaves=3, base=6, wrap_x=True)[4]
    top_noise = fbm(w, 8, rng, octaves=3, base=10, wrap_x=True)[2]
    bot_noise = fbm(w, 8, rng, octaves=3, base=12, wrap_x=True)[6]
    layers = [(0.50, 0.66, 520), (0.72, 0.88, 420), (0.92, 1.06, 300)]
    for li, (s0, s1, count) in enumerate(layers):
        for _ in range(count):
            px = rng.uniform(0, w)
            ix = int(px) % w
            top = h * (0.10 + 0.10 * top_noise[ix])
            bot = h * (0.80 + 0.12 * bot_noise[ix])
            u = rng.random()
            # more leaves in the upper / middle part, thinner toward the fruit zone
            py = top + (bot - top) * (u ** 1.25)
            if li == 2 and rng.random() > 0.45 + 0.55 * dens[ix]:
                continue
            sp = rng.choice(leaves)
            if rng.random() < 0.5:
                sp = sp.mirrored()
            # vine leaves hang: tip mostly downward / sideways
            a = 180 + rng.gauss(0, 55)
            c.place(sp, px, py, a, leaf_px_scale(sp, leaf_px * rng.uniform(0.75, 1.2)), anchor=(0.5, 0.75),
                    shade=rng.uniform(s0, s1), tilt=(rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45)), wrap_x=True)
        if li == 0:
            # canes: a few brown shoots visible between the leaves
            for _ in range(46):
                px = rng.uniform(0, w)
                y0 = h * rng.uniform(0.70, 0.86)
                y1 = h * rng.uniform(0.06, 0.25)
                lean = rng.uniform(-0.05, 0.05) * w
                pts = [(px + lean * s + math.sin(s * 5 + px) * 3, y0 + (y1 - y0) * s) for s in (0, 0.25, 0.5, 0.75, 1.0)]
                for off in (-w, 0, w):
                    c.stroke([(x + off, y) for x, y in pts], 5.0, 2.0, (112, 86, 52), (96, 118, 58), shade=0.8)
        if li == 1:
            # grapes hang in the fruit zone, partly covered by the front leaf layer
            for _ in range(15):
                g = rng.choice(grapes).to_sprite()
                px = rng.uniform(0, w)
                py = h * rng.uniform(0.66, 0.78)
                c.place(g, px, py, rng.uniform(-8, 8), rng.uniform(0.62, 0.8), anchor=(0.5, 0.0), shade=rng.uniform(0.8, 1.0), wrap_x=True)
    # young shoot tips poking out above the top wire
    for _ in range(26):
        px = rng.uniform(0, w)
        y0 = h * 0.2
        y1 = h * rng.uniform(0.015, 0.08)
        lean = rng.uniform(-30, 30)
        for off in (-w, 0, w):
            c.stroke([(px + off, y0), (px + off + lean * 0.5, (y0 + y1) / 2), (px + off + lean, y1)], 3.0, 1.2, (112, 132, 60), shade=0.9)
        for s in (0.45, 0.75, 1.0):
            sp = rng.choice(leaves)
            c.place(sp, px + lean * s, y0 + (y1 - y0) * s, rng.uniform(-150, 150), leaf_px_scale(sp, leaf_px * rng.uniform(0.45, 0.7)),
                    shade=rng.uniform(0.95, 1.1), tilt=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)), wrap_x=True)
    return c


def vine_shoot(w: int, h: int, leaves: list[Sprite], rng: random.Random, leaf_px: float, hanging: bool, grapes: list[Canvas] | None = None) -> Canvas:
    c = Canvas(w, h)
    if hanging:
        pts = [(w * 0.5, 4), (w * 0.56, h * 0.25), (w * 0.47, h * 0.55), (w * 0.52, h * 0.92)]
    else:
        pts = [(w * 0.5, h - 4), (w * 0.44, h * 0.68), (w * 0.55, h * 0.38), (w * 0.49, h * 0.07)]
    c.stroke(pts, 5.0, 2.0, (118, 92, 56), (104, 128, 62), shade=0.85)
    n = 11
    order = []
    for j in range(n):
        s = (j + 0.6) / n
        f = s * (len(pts) - 1)
        i0 = min(int(f), len(pts) - 2)
        fr = f - i0
        px = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * fr
        py = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * fr
        side = 1 if j % 2 == 0 else -1
        order.append((rng.random(), px, py, side, s))
    order.sort()
    for _, px, py, side, s in order:
        sp = rng.choice(leaves)
        if rng.random() < 0.5:
            sp = sp.mirrored()
        # petiole then a leaf whose blade hangs down / sideways
        ex = px + side * leaf_px * rng.uniform(0.25, 0.5)
        ey = py + rng.uniform(-0.1, 0.25) * leaf_px
        c.stroke([(px, py), (ex, ey)], 2.2, 1.4, (128, 146, 70), shade=0.9)
        a = 180 - side * rng.uniform(15, 80)
        size = leaf_px * rng.uniform(0.85, 1.15) * (1.0 - (0.35 * s if not hanging else 0.0))
        c.place(sp, ex, ey, a, leaf_px_scale(sp, size), anchor=(0.5, 0.78), shade=rng.uniform(0.86, 1.06),
                tilt=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)))
    if grapes and not hanging:
        g = rng.choice(grapes).to_sprite()
        c.place(g, w * 0.5 + rng.uniform(-30, 30), h * 0.62, 0, 0.8, anchor=(0.5, 0.0), shade=0.95)
    return c


def lane_ground(w: int, h: int, rng: random.Random) -> Canvas:
    """6 m x 4 m of vineyard floor (u along the rows), seamless in both directions.
    Image rows top->bottom: vine row A (y=0), grassed lane, vine row B (y=h/2), tilled lane - i.e. every second
    lane is green, as is usual in the Palatinate. The runtime maps v = across / 4 m so rows sit at v = 0 and 0.5."""
    c = Canvas(w, h)
    grass, grass_n = tile_library_albedo('grass', w, h, 6.0, rng, seamless=True)
    soil, soil_n = tile_library_albedo('soil_ploughed', w, h, 6.0, rng, seamless=True)
    yy = (np.arange(h, dtype=np.float32) + 0.5) / h * 4.0          # metres across, 0 = row A
    zz = np.repeat(yy[:, None], w, axis=1)
    d_row = np.minimum(np.minimum(zz, np.abs(zz - 2.0)), 4.0 - zz)   # distance to the nearest vine row
    in_green = (zz < 2.0).astype(np.float32)
    edge_noise = (fbm(w, 16, rng, octaves=4, base=16, wrap_x=True)[8] - 0.5) * 0.16
    # under-vine strip is kept bare, 0.2 m to each side
    green = np.clip((d_row - 0.20 + edge_noise[None, :]) / 0.10, 0, 1) * in_green
    blot = fbm_wrap(w, h, rng, octaves=4, base=6)
    lum = grass @ np.asarray([0.3, 0.59, 0.11], np.float32)
    straw = lum[..., None] * np.asarray([1.12, 1.08, 0.66], np.float32)[None, None, :]
    dry = np.clip((blot - 0.42) * 2.2, 0, 1)[..., None] * 0.3
    sward = grass * np.asarray([0.74, 0.88, 0.58], np.float32) * (1 - dry) + straw * dry
    # wheel tracks in the green lane, 0.5 m from each row: thinner grass
    track_n = 0.12 + 0.30 * fbm_wrap(w, h, rng, octaves=3, base=24)
    track = (np.exp(-((zz - 0.50) / 0.11) ** 2) + np.exp(-((zz - 1.50) / 0.11) ** 2)) * track_n
    # Palatinate loess-loam: lighter, greyer ochre than the scanned farm soil
    s_lum = soil @ np.asarray([0.3, 0.59, 0.11], np.float32)
    loess = (s_lum[..., None] + (soil - s_lum[..., None]) * 0.12) * (np.asarray([0.60, 0.535, 0.445], np.float32) / max(float(s_lum.mean()), 1e-3))
    g = np.clip(green * (1 - track), 0, 1)[..., None]
    rgb = loess * (1 - g) + sward * g
    # tilled lane: two compacted wheel bands
    band = (np.exp(-((zz - 2.5) / 0.12) ** 2) + np.exp(-((zz - 3.5) / 0.12) ** 2))[..., None]
    rgb = rgb * (1 - band * 0.14)
    # soft contact darkening right under the leaf walls
    rgb = rgb * (1.0 - 0.22 * np.exp(-(d_row / 0.22) ** 2))[..., None]
    nrm = soil_n * (1 - g) + grass_n * g
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    c.fill_opaque(np.clip(rgb, 0, 1), nrm)
    return c


def strip_from_library(mat_id: str, w: int, h: int, width_m: float, rng: random.Random, gain=(1.0, 1.0, 1.0), cylinder: bool = False) -> Canvas:
    c = Canvas(w, h)
    a, n = tile_library_albedo(mat_id, w, h, width_m, rng)
    a = a * np.asarray(gain, np.float32)[None, None, :]
    if cylinder:
        # round the normals across the strip so a 4-sided trunk reads as round
        xs = (np.arange(w, dtype=np.float32) + 0.5) / w * 2 - 1
        n = n.copy()
        n[..., 0] += xs[None, :] * 0.0
    c.fill_opaque(np.clip(a, 0, 1), n)
    return c


def zinc_strip(w: int, h: int, rng: random.Random) -> Canvas:
    """Hot-dip galvanised steel (vine posts, wires): light grey with soft spangle."""
    c = Canvas(w, h)
    n1 = fbm(w, h, rng, octaves=4, base=8)
    n2 = fbm(w, h, rng, octaves=2, base=3)
    v = 0.56 + 0.16 * (n1 - 0.5) + 0.10 * (n2 - 0.5)
    rgb = np.stack([v * 0.97, v * 0.99, v * 1.02], axis=-1)
    # rust bloom near the foot (bottom of the strip)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    rust = np.clip((yy - 0.86) / 0.14, 0, 1) * (0.4 + 0.6 * n1)
    rgb = rgb * (1 - rust[..., None]) + np.asarray([0.36, 0.22, 0.14], np.float32)[None, None, :] * rust[..., None]
    c.fill_opaque(rgb.astype(np.float32))
    return c


def build_vine_atlas() -> None:
    rng = random.Random(4711)
    raw = extract_sprites('LeafSet010')
    # grape leaves are rounder and darker than the scanned maple: squash a little, grade to a deep vine green
    leaves = []
    for i, sp in enumerate(raw):
        hh = int(sp.h * 0.84)
        rgb = cv2.resize(sp.rgb, (sp.w, hh), interpolation=cv2.INTER_AREA)
        al = cv2.resize(sp.alpha, (sp.w, hh), interpolation=cv2.INTER_AREA)
        nn = cv2.resize(sp.normal, (sp.w, hh), interpolation=cv2.INTER_AREA)
        base = Sprite(rgb, al, nn)
        leaves.append(base.toward((70, 106, 40), 0.85, sat=0.9))
        leaves.append(base.toward((86, 118, 44), 0.85, sat=0.9))
        if i % 2 == 0:
            leaves.append(base.toward((112, 128, 50), 0.8, sat=0.85))  # a few yellowing late-summer leaves
    atlas = Atlas(2048, 2048)
    grapes = [grape_cluster(160, 320, rng, 13.0) for _ in range(3)]

    save_floor(lane_ground(2048, 1024, rng), OUT_DIR, 'veg_vine_floor', {'tileM': [6.0, 4.0]})
    atlas.blit('leaf_wall', vine_leaf_wall(2048, 624, leaves, grapes, rng, 100.0), 0, 520, {'widthM': 3.0, 'heightM': 0.914})
    x = 8
    for i in range(4):
        tile = vine_shoot(368, 496, leaves, rng, 150.0, hanging=(i == 2), grapes=grapes)
        atlas.blit(f'shoot_{i}', tile, x, 1160, {'widthM': 0.52, 'heightM': 0.70})
        x += 384
    for i, g in enumerate(grapes):
        atlas.blit(f'grape_{i}', g, 1544 + i * 168, 1160, {'widthM': 0.10, 'heightM': 0.19})
    # single leaves
    x = 8
    picks = [leaves[0], leaves[4], leaves[7], leaves[2], leaves[9 % len(leaves)]]
    for i, sp in enumerate(picks):
        tile = Canvas(240, 240)
        tile.place(sp, 120, 236, 0, leaf_px_scale(sp, 226), shade=1.0)
        atlas.blit(f'leaf_{i}', tile, x, 1672, {'widthM': 0.15, 'heightM': 0.15})
        x += 256
    atlas.blit('bark', strip_from_library('bark_deciduous', 240, 368, 0.22, rng, gain=(0.9, 0.82, 0.72)), 1288, 1672, {'widthM': 0.22})
    atlas.blit('post_wood', strip_from_library('wood_planks_weathered', 112, 368, 0.12, rng, gain=(0.92, 0.88, 0.8)), 1544, 1672, {'widthM': 0.12})
    atlas.blit('post_steel', zinc_strip(112, 368, rng), 1672, 1672, {'widthM': 0.06})
    atlas.blit('wire', zinc_strip(112, 112, rng), 1800, 1672)
    atlas.blit('soil', strip_from_library('soil_ploughed', 112, 112, 0.5, rng, gain=(1.5, 1.45, 1.35)), 1800, 1800)
    meta = atlas.save(OUT_DIR, 'veg_vine_atlas', normal_size=1024, webp_quality=78)
    print('[veg-atlas] vine', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


# ---------------------------------------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------------------------------------

TREE_SPECIES = {
    # name: (LeafSet id, target mean sRGB, branch leaf px, crown leaf px, fruit)
    'linden': dict(set='LeafSet004', tone=(52, 92, 34), tone2=(66, 106, 38), leaf_px=104, crown_px=30, droop=0.10),
    'orchard': dict(set='LeafSet003', tone=(64, 96, 40), tone2=(80, 112, 46), leaf_px=98, crown_px=28, droop=0.18,
                    fruit=dict(chance=0.16, radius=15.0, colors=[(168, 44, 34), (188, 66, 40), (196, 150, 52)])),
    'alder': dict(set='LeafSet024', tone=(58, 96, 40), tone2=(74, 112, 46), leaf_px=92, crown_px=27, droop=0.22),
    'poplar': dict(set='LeafSet009', tone=(72, 108, 42), tone2=(92, 124, 48), leaf_px=86, crown_px=26, droop=0.05),
}


def graded_leaves(set_id: str, tone, tone2) -> list[Sprite]:
    raw = extract_sprites(set_id)
    out = []
    for sp in raw:
        out.append(sp.toward(tone, 0.9, sat=0.92))
        out.append(sp.toward(tone2, 0.9, sat=0.92))
    return out


def build_tree_atlas() -> None:
    rng = random.Random(1203)
    atlas = Atlas(2048, 2048)
    for row, (name, cfg) in enumerate(TREE_SPECIES.items()):
        leaves = graded_leaves(cfg['set'], cfg['tone'], cfg['tone2'])
        y = row * 512 + 8
        fruit = cfg.get('fruit')
        a = branch_card(496, 496, leaves, rng, cfg['leaf_px'], filler=44, droop=cfg['droop'], fruit=fruit)
        b = branch_card(496, 496, leaves, rng, cfg['leaf_px'] * 0.92, side_twigs=6, filler=52, droop=cfg['droop'] * 1.4, spread=1.15, fruit=fruit)
        crown = crown_card(496, leaves, rng, cfg['crown_px'], 2600)
        sprig = sprig_card(496, leaves, rng, cfg['leaf_px'] * 1.9)
        atlas.blit(f'{name}_branch_a', a, 8, y, {'sizeM': 1.35})
        atlas.blit(f'{name}_branch_b', b, 520, y, {'sizeM': 1.35})
        atlas.blit(f'{name}_crown', crown, 1032, y, {'sizeM': 3.6})
        atlas.blit(f'{name}_sprig', sprig, 1544, y, {'sizeM': 0.55})
    meta = atlas.save(OUT_DIR, 'veg_tree_atlas', normal_size=1024, webp_quality=78)
    print('[veg-atlas] tree', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


def build_hedge_atlas() -> None:
    rng = random.Random(77)
    atlas = Atlas(2048, 1024)
    twigs = [s.toward((60, 92, 40), 0.85, sat=0.9) for s in extract_sprites('LeafSet002')]
    horn = graded_leaves('LeafSet014', (58, 94, 38), (78, 110, 44))
    # dense privet/hawthorn-like wall cards: twig scans layered
    for i in range(2):
        c = Canvas(496, 496)
        items = []
        for _ in range(60):
            items.append((rng.random(), rng.uniform(20, 476), rng.uniform(60, 500)))
        items.sort()
        for k, (_, px, py) in enumerate(items):
            sp = rng.choice(twigs)
            if rng.random() < 0.5:
                sp = sp.mirrored()
            c.place(sp, px, py, rng.gauss(0, 32), leaf_px_scale(sp, rng.uniform(150, 215)), shade=0.55 + 0.5 * k / len(items),
                    tilt=(rng.uniform(-0.4, 0.4), rng.uniform(-0.3, 0.3)))
        atlas.blit(f'hedge_twigs_{i}', c, 8 + i * 512, 8, {'sizeM': 1.3})
    fruit = dict(chance=0.10, radius=6.0, colors=[(170, 30, 30), (150, 24, 40)])  # rose hips / hawthorn berries
    atlas.blit('hedge_branch', branch_card(496, 496, horn, rng, 84, side_twigs=6, filler=40, fruit=fruit), 8, 520, {'sizeM': 1.1})
    atlas.blit('hedge_crown', crown_card(496, horn, rng, 34, 2000), 520, 520, {'sizeM': 2.4})
    # Weinberg-Rosenstock: rose bush at the row ends + its post, hedge stems
    roses = dict(chance=0.34, radius=15.0, rose=True, colors=[(196, 40, 62), (212, 72, 98), (178, 26, 44), (224, 96, 120)])
    small = graded_leaves('LeafSet014', (50, 88, 36), (66, 104, 42))
    atlas.blit('rose_a', branch_card(496, 496, small, rng, 62, side_twigs=7, filler=60, droop=0.15, fruit=roses), 1032, 8, {'sizeM': 0.9})
    atlas.blit('rose_b', branch_card(496, 496, small, rng, 58, side_twigs=8, filler=70, droop=0.25, spread=1.2, fruit=roses), 1544, 8, {'sizeM': 0.9})
    atlas.blit('post_wood', strip_from_library('wood_planks_weathered', 112, 496, 0.12, rng, gain=(0.92, 0.88, 0.8)), 1032, 520, {'widthM': 0.12})
    atlas.blit('bark', strip_from_library('bark_deciduous', 240, 496, 0.25, rng, gain=(0.9, 0.84, 0.76)), 1160, 520, {'widthM': 0.25})
    meta = atlas.save(OUT_DIR, 'veg_hedge_atlas', normal_size=1024, webp_quality=78)
    print('[veg-atlas] hedge', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


if __name__ == '__main__':
    which = set(sys.argv[1:]) or {'vine', 'tree', 'hedge'}
    if 'tree' in which:
        build_tree_atlas()
    if 'hedge' in which:
        build_hedge_atlas()
    if 'vine' in which:
        build_vine_atlas()


def build_straw_maps() -> None:
    """1K albedo / normal / ORM of the CC0 straw scan (ambientCG ThatchedRoof001A) for hay and straw bales."""
    src = os.path.join(ROOT, 'blender', 'shared_textures', '_extra_vegetation', 'straw_thatch')
    alb = cv2.imread(os.path.join(src, 'straw_thatch_albedo.jpg'))
    nrm = cv2.imread(os.path.join(src, 'straw_thatch_normal.jpg'))
    rgh = cv2.imread(os.path.join(src, 'straw_thatch_roughness.jpg'), cv2.IMREAD_GRAYSCALE)
    ao = cv2.imread(os.path.join(src, 'straw_thatch_ao.jpg'), cv2.IMREAD_GRAYSCALE)
    if alb is None or nrm is None or rgh is None or ao is None:
        raise FileNotFoundError(f'straw source maps missing in {src}')
    size = (1024, 1024)
    alb = cv2.resize(alb, size, interpolation=cv2.INTER_AREA)
    # the scan is weathered roof thatch; this year's straw is golden: re-grade (keeps the strand detail)
    af = alb.astype(np.float32) / 255.0
    lum = af @ np.asarray([0.11, 0.59, 0.3], np.float32)
    af = (lum[..., None] + (af - lum[..., None]) * 0.6) * (np.asarray([0.40, 0.62, 0.74], np.float32) / max(float(lum.mean()), 1e-3))
    alb = (np.clip(af, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    nrm = cv2.resize(nrm, size, interpolation=cv2.INTER_AREA)
    rgh = cv2.resize(rgh, size, interpolation=cv2.INTER_AREA)
    ao = cv2.resize(ao, size, interpolation=cv2.INTER_AREA)
    orm = np.dstack([np.zeros_like(rgh), rgh, ao])  # BGR order: B = metal (0), G = roughness, R = AO
    cv2.imwrite(os.path.join(OUT_DIR, 'straw_thatch_albedo_1k.jpg'), alb, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite(os.path.join(OUT_DIR, 'straw_thatch_normal_1k.jpg'), nrm, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite(os.path.join(OUT_DIR, 'straw_thatch_orm_1k.jpg'), orm, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print('[veg-atlas] straw maps written')


LIB512_IDS = ['metal_galvanized', 'metal_painted', 'wood_beam_oak', 'metal_rusty', 'wood_planks_weathered', 'sandstone_red_ashlar']


def build_lib512() -> None:
    """512 px copies of library maps for small props (image name = file name = <id>_<map>_512, as BRIEF.md asks)."""
    from veg_atlas_lib import library_map
    out = os.path.join(OUT_DIR, 'lib512')
    os.makedirs(out, exist_ok=True)
    for mat_id in LIB512_IDS:
        for which in ('albedo', 'normal', 'orm'):
            src = cv2.imread(library_map(mat_id, which, '_1k'))
            if src is None:
                raise FileNotFoundError(f'library map missing: {mat_id} {which}')
            cv2.imwrite(os.path.join(out, f'{mat_id}_{which}_512.jpg'), cv2.resize(src, (512, 512), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 92])
    for which in ('albedo', 'normal', 'orm'):
        src = cv2.imread(os.path.join(OUT_DIR, f'straw_thatch_{which}_1k.jpg'))
        if src is None:
            raise FileNotFoundError(f'straw map missing: straw_thatch_{which}_1k.jpg (run the "straw" step first)')
        cv2.imwrite(os.path.join(out, f'straw_thatch_{which}_512.jpg'), cv2.resize(src, (512, 512), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 92])
    print('[veg-atlas] lib512 written')


if __name__ == '__main__':
    _which = set(sys.argv[1:]) or {'straw', 'lib512'}
    if 'straw' in _which:
        build_straw_maps()
    if 'lib512' in _which:
        build_lib512()
