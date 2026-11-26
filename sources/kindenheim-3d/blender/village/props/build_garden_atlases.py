"""Atlases for garden vegetation and near-camera ground cover (system python3, not Blender).

    python3 blender/village/props/build_garden_atlases.py [garden] [groundcover]

veg_garden_atlas (2048x2048): clipped-hedge walls + fluff (thuja, cherry laurel, privet, hornbeam), garden shrubs,
                              conifers (spruce branch + whole-tree card, pine needle tufts, thuja column), bark strip
veg_groundcover_atlas (2048x1024): lawn / meadow tufts, tall grass, weeds, wildflowers, reeds
Sources: CC0 ambientCG LeafSet002/003/014/019/020/022/026, PineNeedles001, Foliage001/002/003/006 + shared library bark.
"""
from __future__ import annotations

import math
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'fields'))
from veg_atlas_lib import Atlas, Canvas, ROOT, Sprite, extract_sprites  # noqa: E402
from build_veg_atlases import branch_card, crown_card, graded_leaves, leaf_px_scale, strip_from_library, tip_angle  # noqa: E402
from build_crop_atlases import blossom, grass_tuft  # noqa: E402

OUT_DIR = os.path.join(ROOT, 'blender', 'village', 'textures', 'props')


def dense_wall(size: int, sprites: list[Sprite], rng: random.Random, sprite_px: float, count: int, base_rgb, anchor=(0.5, 0.6), spread_deg: float = 180.0) -> Canvas:
    """Fully covered, seamless leaf mass (the flat face of a clipped hedge): dark interior first, lit leaves last."""
    c = Canvas(size, size)
    c.fill_opaque(np.full((size, size, 3), np.asarray(base_rgb, np.float32) / 255.0 * 0.45, np.float32))
    for i in range(count):
        sp = rng.choice(sprites)
        if rng.random() < 0.5:
            sp = sp.mirrored()
        t = i / max(1, count - 1)
        c.place(sp, rng.uniform(0, size), rng.uniform(0, size), rng.uniform(-spread_deg, spread_deg), leaf_px_scale(sp, sprite_px * rng.uniform(0.8, 1.2)),
                anchor=anchor, shade=0.5 + 0.56 * t + rng.uniform(-0.05, 0.05), tilt=(rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45)), wrap_x=True, wrap_y=True)
    c.alpha[:] = 1.0
    return c


def fan_card(size: int, sprites: list[Sprite], rng: random.Random, sprite_px: float, count: int, spread: float = 75.0) -> Canvas:
    """Sprays fanning out of the bottom centre (thuja / laurel shoots that stick out of a hedge face)."""
    c = Canvas(size, size)
    items = sorted(((abs(a) + rng.uniform(-12, 12), a) for a in (rng.uniform(-spread, spread) for _ in range(count))), reverse=True)
    for i, (_, a) in enumerate(items):
        sp = rng.choice(sprites)
        if rng.random() < 0.5:
            sp = sp.mirrored()
        c.place(sp, size * 0.5 + rng.uniform(-0.08, 0.08) * size, size - 4, a, leaf_px_scale(sp, sprite_px * rng.uniform(0.75, 1.1)), anchor=(0.5, 1.0),
                shade=0.68 + 0.36 * i / max(1, count - 1), tilt=(-math.sin(math.radians(a)) * 0.5, rng.uniform(-0.2, 0.3)))
    return c


def flower_blob(size: int, leaves: list[Sprite], rng: random.Random, colors, ball_r: float, balls: int) -> Canvas:
    """Rounded shrub with flower heads (hydrangea / spiraea / rose bush in a front garden)."""
    c = crown_card(size, leaves, rng, 36, 1500)
    cx, cy = size * 0.5, size * 0.5
    for _ in range(balls):
        a = rng.uniform(0, math.tau)
        r = size * 0.36 * math.sqrt(rng.random())
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r * 0.9
        col = rng.choice(colors)
        for _k in range(9):
            c.disc(x + rng.uniform(-ball_r, ball_r) * 0.6, y + rng.uniform(-ball_r, ball_r) * 0.5, ball_r * rng.uniform(0.32, 0.5),
                   tuple(min(255, v + rng.uniform(-14, 18)) for v in col), shade=rng.uniform(0.85, 1.0))
    return c


def spruce_branch(size: int, sprays: list[Sprite], rng: random.Random) -> Canvas:
    """One conifer bough seen from above/side: central twig with drooping sprays to both sides, anchored at the bottom."""
    c = Canvas(size, size)
    base, top = (size * 0.5, size - 3.0), (size * 0.5, size * 0.06)
    c.stroke([base, top], size * 0.022, 2.0, (70, 52, 36), shade=0.85)
    n = 15
    for layer, shade in ((0, 0.6), (1, 0.82), (2, 1.0)):
        for k in range(n):
            t = (k + rng.uniform(0.2, 0.8)) / n
            y = base[1] + (top[1] - base[1]) * t
            for side in (-1, 1):
                sp = rng.choice(sprays)
                ln = size * (0.50 - 0.34 * t) * rng.uniform(0.8, 1.1)
                c.place(sp, size * 0.5, y, side * rng.uniform(52, 82) + rng.uniform(-8, 8), ln / max(sp.h, sp.w), anchor=(0.5, 1.0), shade=shade * rng.uniform(0.9, 1.06),
                        tilt=(side * rng.uniform(0.1, 0.5), rng.uniform(-0.2, 0.4)))
    sp = rng.choice(sprays)
    c.place(sp, top[0], top[1] + size * 0.12, 0, size * 0.2 / max(sp.h, sp.w), anchor=(0.5, 1.0), shade=1.0)
    return c


def conifer_tree_card(size: int, branch: Sprite, rng: random.Random, twig_rgb=(64, 48, 34)) -> Canvas:
    """Whole spruce in side view (for the far LOD cross cards): tiers of boughs shrinking toward the tip."""
    c = Canvas(size, size)
    cx = size * 0.5
    c.stroke([(cx, size - 2), (cx, size * 0.04)], size * 0.03, 2.0, twig_rgb, shade=0.7)
    tiers = 13
    for layer, shade in ((0, 0.55), (1, 0.8), (2, 1.0)):
        for k in range(tiers):
            t = k / (tiers - 1)
            y = size * (0.93 - 0.86 * t)
            ln = size * (0.46 - 0.38 * t) * rng.uniform(0.9, 1.08)
            for side in (-1, 1):
                ang = side * (rng.uniform(96, 116) - 18 * t)
                c.place(branch, cx + rng.uniform(-4, 4), y + rng.uniform(-6, 6), ang, ln / branch.h, anchor=(0.5, 1.0), shade=shade * rng.uniform(0.9, 1.05),
                        tilt=(side * 0.35, rng.uniform(0.0, 0.4)))
            if layer > 0:
                c.place(branch, cx + rng.uniform(-10, 10), y, rng.uniform(170, 190), ln * 0.55 / branch.h, anchor=(0.5, 1.0), shade=shade * 0.92)
    c.place(branch, cx, size * 0.2, 0, size * 0.2 / branch.h, anchor=(0.5, 1.0), shade=1.0)
    return c


def needle_tuft(size: int, needles: list[Sprite], rng: random.Random) -> Canvas:
    """Pine twig: brown shoot with radiating fascicles of long green needles."""
    c = Canvas(size, size)
    pts = [(size * 0.5, size - 3.0), (size * 0.46, size * 0.66), (size * 0.54, size * 0.4)]
    c.stroke(pts, size * 0.03, size * 0.014, (92, 66, 44), shade=0.9)
    nodes = [(pts[1][0], pts[1][1]), (pts[2][0], pts[2][1]), ((pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2), (size * 0.36, size * 0.52), (size * 0.66, size * 0.56)]
    c.stroke([pts[1], nodes[3]], size * 0.016, size * 0.01, (92, 66, 44), shade=0.9)
    c.stroke([pts[1], nodes[4]], size * 0.016, size * 0.01, (92, 66, 44), shade=0.9)
    order = []
    for nx, ny in nodes:
        for k in range(46):
            order.append((rng.random(), nx, ny, rng.uniform(-165, 165)))
    order.sort()
    for i, (_, nx, ny, a) in enumerate(order):
        sp = rng.choice(needles)
        c.place(sp, nx + rng.uniform(-5, 5), ny + rng.uniform(-5, 5), a, size * rng.uniform(0.24, 0.36) / max(sp.h, sp.w), anchor=(0.5, 1.0),
                shade=0.62 + 0.42 * i / len(order), tilt=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)))
    return c


def build_garden_atlas() -> None:
    rng = random.Random(909)
    atlas = Atlas(2048, 2048)
    thuja = []
    for sp in extract_sprites('LeafSet019'):
        v = sp.rotated90(1)  # stem to the bottom
        thuja.append(v.toward((40, 76, 38), 0.9, sat=0.9))
        thuja.append(v.toward((52, 88, 42), 0.9, sat=0.9))
    laurel = graded_leaves('LeafSet022', (34, 74, 30), (48, 90, 36))
    privet = [s.toward((54, 90, 38), 0.85, sat=0.9) for s in extract_sprites('LeafSet002')]
    horn = graded_leaves('LeafSet014', (58, 96, 38), (74, 108, 44))
    apple = graded_leaves('LeafSet003', (58, 94, 38), (74, 108, 44))

    # row 0: opaque hedge faces
    atlas.blit('wall_thuja', dense_wall(496, thuja, rng, 150, 560, (40, 76, 38), anchor=(0.5, 0.5)), 8, 8, {'sizeM': 1.5})
    atlas.blit('wall_laurel', dense_wall(496, laurel, rng, 62, 900, (34, 74, 30)), 520, 8, {'sizeM': 1.5})
    atlas.blit('wall_privet', dense_wall(496, privet, rng, 120, 520, (54, 90, 38)), 1032, 8, {'sizeM': 1.5})
    atlas.blit('wall_hornbeam', dense_wall(496, horn, rng, 44, 1500, (58, 96, 38)), 1544, 8, {'sizeM': 1.5})
    # row 1: fluff that sticks out of the faces
    atlas.blit('tuft_thuja', fan_card(496, thuja, rng, 380, 9), 8, 520, {'sizeM': 0.6})
    atlas.blit('tuft_laurel', branch_card(496, 496, laurel, rng, 150, side_twigs=4, filler=18), 520, 520, {'sizeM': 0.6})
    atlas.blit('tuft_privet', fan_card(496, privet, rng, 330, 8, spread=60), 1032, 520, {'sizeM': 0.6})
    atlas.blit('tuft_hornbeam', branch_card(496, 496, horn, rng, 110, side_twigs=5, filler=30), 1544, 520, {'sizeM': 0.6})
    # row 2: garden shrubs
    atlas.blit('shrub_round', crown_card(496, apple, rng, 40, 1900), 8, 1032, {'sizeM': 2.0})
    atlas.blit('shrub_pink', flower_blob(496, horn, rng, [(206, 96, 140), (222, 132, 168), (190, 70, 110)], 30, 26), 520, 1032, {'sizeM': 2.0})
    atlas.blit('shrub_white', flower_blob(496, apple, rng, [(232, 232, 220), (220, 226, 236), (206, 196, 232)], 26, 30), 1032, 1032, {'sizeM': 2.0})
    atlas.blit('shrub_fine', crown_card(496, [s for s in privet], rng, 110, 420), 1544, 1032, {'sizeM': 2.0})
    # row 3: conifers
    spruce_sprays = [s.toward((30, 62, 40), 0.92, sat=0.85) for s in thuja]
    bough = spruce_branch(496, spruce_sprays, rng)
    atlas.blit('spruce_branch', bough, 8, 1544, {'sizeM': 1.6})
    atlas.blit('spruce_tree', conifer_tree_card(496, bough.to_sprite(), rng), 520, 1544, {'sizeM': 6.0})
    needles = []
    for sp in extract_sprites('PineNeedles001', min_area_frac=0.0004):
        v = sp.rotated90(1) if sp.w > sp.h else sp
        needles.append(v.toward((52, 84, 44), 1.0, sat=0.9))
        needles.append(v.toward((66, 96, 50), 1.0, sat=0.9))
    atlas.blit('pine_tuft', needle_tuft(496, needles, rng), 1032, 1544, {'sizeM': 0.9})
    atlas.blit('thuja_column', dense_wall(368, thuja, rng, 170, 300, (36, 70, 36), anchor=(0.5, 0.5), spread_deg=35.0), 1544, 1544, {'sizeM': 1.4})
    atlas.blit('bark', strip_from_library('bark_deciduous', 112, 496, 0.3, rng, gain=(0.86, 0.78, 0.7)), 1928, 1544, {'widthM': 0.3})
    meta = atlas.save(OUT_DIR, 'veg_garden_atlas', normal_size=1024, webp_quality=78)
    print('[garden-atlas] garden', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


def reed_card(w: int, h: int, blades: list[Sprite], rng: random.Random) -> Canvas:
    c = Canvas(w, h)
    stems = []
    for _ in range(11):
        x = rng.uniform(0.15, 0.85) * w
        lean = rng.uniform(-0.12, 0.12) * w
        top = h * rng.uniform(0.05, 0.3)
        stems.append((rng.random(), x, lean, top))
    stems.sort()
    for i, (_, x, lean, top) in enumerate(stems):
        shade = 0.7 + 0.35 * i / len(stems)
        c.stroke([(x, h - 2), (x + lean * 0.5, (h + top) / 2), (x + lean, top)], 4.0, 2.0, (118, 132, 62), (150, 148, 84), shade=shade)
        for k in range(5):
            t = 0.2 + 0.6 * k / 4
            sp = rng.choice(blades)
            side = 1 if k % 2 == 0 else -1
            c.place(sp, x + lean * t, h - 2 + (top - h) * t, -side * rng.uniform(18, 40), h * rng.uniform(0.28, 0.4) / sp.h, anchor=(0.5, 1.0), shade=shade,
                    tilt=(side * 0.3, 0.2))
        # feathery brown-purple panicle
        for k in range(14):
            a = rng.uniform(-0.5, 0.5)
            ln = h * rng.uniform(0.04, 0.09)
            px, py = x + lean, top + rng.uniform(0, h * 0.07)
            c.stroke([(px, py), (px + math.sin(a) * ln, py - math.cos(a) * ln)], 3.2, 1.2, (126, 98, 84), (156, 130, 108), shade=shade)
    return c


def weed_card(size_w: int, size_h: int, leaves: list[Sprite], rng: random.Random) -> Canvas:
    """Dandelion / dock clump: low rosette leaves, a few yellow heads and one seed clock."""
    c = Canvas(size_w, size_h)
    bx, by = size_w * 0.5, size_h - 4.0
    items = sorted(((abs(a), a) for a in (rng.uniform(-86, 86) for _ in range(22))), reverse=True)
    for i, (_, a) in enumerate(items):
        sp = rng.choice(leaves)
        c.place(sp, bx + rng.uniform(-30, 30), by, a, size_h * rng.uniform(0.3, 0.46) / sp.h, anchor=(0.5, 1.0), shade=0.7 + 0.34 * i / len(items),
                tilt=(-math.sin(math.radians(a)) * 0.5, 0.2))
    for k in range(4):
        fx = bx + rng.uniform(-0.3, 0.3) * size_w
        fy = size_h * rng.uniform(0.3, 0.55)
        c.stroke([(bx + rng.uniform(-8, 8), by), (fx, fy)], 3.0, 2.0, (126, 150, 84), shade=0.95)
        if k == 0:
            c.disc(fx, fy, size_h * 0.055, (226, 226, 216), shade=0.95)
        else:
            blossom(c, fx, fy, 'yellow', size_h * 0.06, rng, False)
    return c


def build_groundcover_atlas() -> None:
    rng = random.Random(404)
    atlas = Atlas(2048, 1024)
    blades = []
    for set_id in ('Foliage001', 'Foliage006'):
        for sp in extract_sprites(set_id, min_area_frac=0.0006):
            if sp.h < sp.w * 2:
                continue
            blades.append(sp.toward((70, 108, 42), 0.9, sat=0.92))
            blades.append(sp.toward((88, 122, 50), 0.9, sat=0.92))
            blades.append(sp.toward((112, 132, 58), 0.9, sat=0.88))
    heads = []
    for set_id in ('Foliage002', 'Foliage003'):
        for sp in extract_sprites(set_id, min_area_frac=0.0004):
            if sp.w > sp.h * 0.16:
                continue  # only slender panicles: wide ones turn into giant ears at tuft scale
            heads.append(sp.toward((140, 134, 84), 0.85, sat=0.8))
    if not heads:
        raise RuntimeError('ground-cover atlas: no slender seed-head sprite found')
    weeds = []
    for set_id in ('LeafSet020', 'LeafSet026'):
        for sp in extract_sprites(set_id):
            v = sp.rotated90(1) if sp.w > sp.h * 1.2 else sp
            weeds.append(v.toward((66, 108, 40), 0.9, sat=0.92))
    no_heads = [blades[0]]  # grass_tuft needs a list; short lawn tufts get (almost) no seed heads

    def tuft(w, h, height, count, with_heads, flowers=None):
        c = Canvas(w, h)
        for x in (0.3, 0.5, 0.7):
            grass_tuft(c, w * x, h - 3, height * rng.uniform(0.8, 1.0), blades, heads if with_heads else no_heads, rng, count, False, flowers=flowers, shade0=0.62)
        return c

    atlas.blit('grass_a', tuft(496, 496, 430, 16, False), 8, 8, {'widthM': 0.55, 'heightM': 0.3})
    atlas.blit('grass_b', tuft(496, 496, 380, 20, False), 520, 8, {'widthM': 0.55, 'heightM': 0.3})
    atlas.blit('tall_a', tuft(496, 496, 400, 12, True), 1032, 8, {'widthM': 0.7, 'heightM': 0.8})
    atlas.blit('tall_b', tuft(496, 496, 370, 14, True), 1544, 8, {'widthM': 0.7, 'heightM': 0.8})
    atlas.blit('weed', weed_card(496, 496, weeds, rng), 8, 520, {'widthM': 0.5, 'heightM': 0.4})
    atlas.blit('flower_a', tuft(496, 496, 330, 9, True, ['poppy', 'cornflower', 'daisy']), 520, 520, {'widthM': 0.7, 'heightM': 0.7})
    atlas.blit('flower_b', tuft(496, 496, 330, 9, True, ['yarrow', 'yellow', 'daisy']), 1032, 520, {'widthM': 0.7, 'heightM': 0.7})
    atlas.blit('reed', reed_card(496, 496, blades, rng), 1544, 520, {'widthM': 1.0, 'heightM': 1.9})
    meta = atlas.save(OUT_DIR, 'veg_groundcover_atlas', normal_size=1024, webp_quality=78)
    print('[garden-atlas] groundcover', {k: round(v['coverage'], 2) for k, v in meta['tiles'].items()})


if __name__ == '__main__':
    which = set(sys.argv[1:]) or {'garden', 'groundcover'}
    if 'garden' in which:
        build_garden_atlas()
    if 'groundcover' in which:
        build_groundcover_atlas()
