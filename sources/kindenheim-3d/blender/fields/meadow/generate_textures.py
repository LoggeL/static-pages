#!/usr/bin/env python3
"""
Procedural Botanical PBR Texture Generator for Kindenheim Pfalz Meadows & Blühstreifen.

Generates 2-clump feathered botanical RGBA atlases (1024x512, two distinct 512x512
organic domed tufts side-by-side at u=[0..0.5] and u=[0.5..1.0]) with:
  - Naturally feathered transparent left, top, AND right edges (ZERO straight card-cut edges!)
  - Rooted dark-green turf skirt at the base (v=[0..0.24]) so zero tufts float on steep slopes
  - Full RGB edge-bleed dilation into transparent pixels (zero WebGL mipmap halos)
  - Matched compact tangent-space normal maps (512x256 JPEG) keeping every GLB <250 KB!

Outputs in blender/fields/meadow/textures/:
  - meadow_albedo_alpha.png  + meadow_normal.jpg
  - wildflower_albedo_alpha.png + wildflower_normal.jpg
"""

import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
OUT_DIR = os.path.join(PROJECT_ROOT, "blender/fields/meadow/textures")
os.makedirs(OUT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Color & Clamped Drawing Helpers (Each Clump Drawn Inside Its Own Clean Box)
# ---------------------------------------------------------------------------

def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(round(v))))


def lerp_color(c0, c1, t):
    t = max(0.0, min(1.0, t))
    return (
        clamp(c0[0] + (c1[0] - c0[0]) * t),
        clamp(c0[1] + (c1[1] - c0[1]) * t),
        clamp(c0[2] + (c1[2] - c0[2]) * t),
    )


def jitter_color(col, rng, dr=12, dg=12, db=10):
    return (
        clamp(col[0] + rng.uniform(-dr, dr)),
        clamp(col[1] + rng.uniform(-dg, dg)),
        clamp(col[2] + rng.uniform(-db, db)),
    )


def draw_poly(dr, dh, pts, color_rgba, h_val):
    dr.polygon(pts, fill=color_rgba)
    if dh is not None:
        dh.polygon(pts, fill=h_val)


def draw_ellipse(dr, dh, cx, cy, rx, ry, color_rgba, h_val):
    box = [cx - rx, cy - ry, cx + rx, cy + ry]
    dr.ellipse(box, fill=color_rgba)
    if dh is not None:
        dh.ellipse(box, fill=h_val)


def draw_line(dr, dh, p0, p1, color_rgba, h_val, width):
    dr.line([p0, p1], fill=color_rgba, width=width)
    if dh is not None:
        dh.line([p0, p1], fill=h_val, width=width)


# ---------------------------------------------------------------------------
# Botanical Primitives (Painted at 2x Supersampling on 1024x1024 per Clump!)
# ---------------------------------------------------------------------------

def paint_curved_blade(
    dr, dh, base_x, base_y, length, base_width, lean_x, droop_y,
    col_base, col_mid, col_tip, height_val, segs=9,
):
    """Paint a graceful, organically arching tapered grass blade with sunlit midrib."""
    p0 = (base_x, base_y)
    p1 = (base_x + lean_x * 0.24, base_y - length * 0.54)
    p2 = (base_x + lean_x * 0.72, base_y - length * 0.98)
    p3 = (base_x + lean_x, base_y - length + droop_y)

    spine = []
    for i in range(segs + 1):
        t = i / segs
        u = 1.0 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        spine.append((x, y))

    for i in range(segs):
        t0 = i / segs
        t1 = (i + 1) / segs
        tm = 0.5 * (t0 + t1)

        w0 = base_width * ((1.0 - t0) ** 0.70)
        w1 = base_width * ((1.0 - t1) ** 0.70)
        if i == segs - 1:
            w1 = max(0.8, base_width * 0.09)

        x0, y0 = spine[i]
        x1, y1 = spine[i + 1]
        dx = x1 - x0
        dy = y1 - y0
        d = math.hypot(dx, dy) + 1e-6
        nx, ny = -dy / d, dx / d

        poly = [
            (x0 - nx * w0 * 0.5, y0 - ny * w0 * 0.5),
            (x0 + nx * w0 * 0.5, y0 + ny * w0 * 0.5),
            (x1 + nx * w1 * 0.5, y1 + ny * w1 * 0.5),
            (x1 - nx * w1 * 0.5, y1 - ny * w1 * 0.5),
        ]

        if tm < 0.54:
            c = lerp_color(col_base, col_mid, tm / 0.54)
        else:
            c = lerp_color(col_mid, col_tip, (tm - 0.54) / 0.46)

        hv = clamp(height_val + (tm - 0.5) * 18, 20, 250)
        draw_poly(dr, dh, poly, (*c, 255), hv)

        if base_width >= 8.0 and i < segs - 1:
            hi_c = (clamp(c[0] + 18), clamp(c[1] + 22), clamp(c[2] + 9), 255)
            draw_line(dr, dh, (x0, y0), (x1, y1), hi_c, clamp(hv + 12, 20, 255), max(1, int(w0 * 0.16)))


def paint_oat_seed_plume(dr, dh, rng, base_x, base_y, length, lean_x, golden_col, stem_col, h_val):
    """Paint a delicate Palatinate summer oat-grass seed panicle (Glatthafer)."""
    segs = 8
    p0 = (base_x, base_y)
    p1 = (base_x + lean_x * 0.35, base_y - length * 0.58)
    p2 = (base_x + lean_x, base_y - length + abs(lean_x) * 0.14)

    pts = []
    for i in range(segs + 1):
        t = i / segs
        u = 1.0 - t
        pts.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))

    for i in range(segs):
        c = lerp_color(stem_col, golden_col, (i / segs) ** 0.72)
        draw_line(dr, dh, pts[i], pts[i + 1], (*c, 255), h_val, max(2, int(4.6 - i * 0.34)))

    for k in range(11):
        t = 0.56 + (k / 10.0) * 0.43
        u = 1.0 - t
        sx = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        sy = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        side = -1 if (k % 2 == 0) else 1
        spread = (1.0 - (t - 0.56) / 0.46) * 20.0 + 5.0
        for branch in (-1, 1) if k < 6 else (side,):
            bx = sx + branch * rng.uniform(0.55, 1.15) * spread
            by = sy - rng.uniform(4.0, 13.0)
            c_grain = jitter_color(golden_col, rng, 14, 12, 8)
            draw_line(dr, dh, (sx, sy), (bx, by), (*c_grain, 255), h_val, 2)
            ang = math.atan2(by - sy, bx - sx)
            tip_x = bx + math.cos(ang) * 10.0
            tip_y = by + math.sin(ang) * 10.0
            nx, ny = -math.sin(ang) * 3.3, math.cos(ang) * 3.3
            grain_poly = [
                (bx - math.cos(ang) * 2.0, by - math.sin(ang) * 2.0),
                (bx + math.cos(ang) * 3.4 + nx, by + math.sin(ang) * 3.4 + ny),
                (tip_x, tip_y),
                (bx + math.cos(ang) * 3.4 - nx, by + math.sin(ang) * 3.4 - ny),
            ]
            c_hi = lerp_color(c_grain, (238, 218, 152), 0.34)
            draw_poly(dr, dh, grain_poly, (*c_hi, 255), clamp(h_val + 14))


def paint_clover_cluster(dr, dh, rng, cx, cy, scale, h_val, with_blossom=False):
    """Paint authentic Palatinate meadow clover (Wiesenklee / Weißklee) trefoils + blossom."""
    stem_c = jitter_color((58, 96, 38), rng, 8, 10, 6)
    draw_line(dr, dh, (cx + rng.uniform(-12, 12), cy + 68 * scale), (cx, cy), (*stem_c, 255), h_val - 10, max(2, int(3.4 * scale)))

    base_ang = rng.uniform(0, math.tau)
    leaf_c = jitter_color((68, 118, 42), rng, 10, 12, 8)
    leaf_edge = lerp_color(leaf_c, (48, 88, 30), 0.35)
    leaf_hi = lerp_color(leaf_c, (170, 202, 126), 0.45)
    for k in range(3):
        a = base_ang + k * (math.tau / 3.0) + rng.uniform(-0.18, 0.18)
        dist = 13.5 * scale
        lx = cx + math.cos(a) * dist
        ly = cy + math.sin(a) * dist
        rx = 12.5 * scale
        ry = 9.5 * scale
        pts = []
        for s in range(10):
            sa = (s / 10.0) * math.tau
            px = math.cos(sa) * rx
            py = math.sin(sa) * ry
            pts.append((lx + px * math.cos(a) - py * math.sin(a), ly + px * math.sin(a) + py * math.cos(a)))
        draw_poly(dr, dh, pts, (*leaf_edge, 255), h_val)
        inner_pts = [(lx + (p[0] - lx) * 0.84, ly + (p[1] - ly) * 0.84) for p in pts]
        draw_poly(dr, dh, inner_pts, (*leaf_c, 255), h_val + 4)
        mx = cx + math.cos(a) * (dist * 0.86)
        my = cy + math.sin(a) * (dist * 0.86)
        draw_ellipse(dr, dh, mx, my, 5.0 * scale, 3.5 * scale, (*leaf_hi, 255), h_val + 8)

    if with_blossom:
        bx = cx + rng.uniform(-18, 18) * scale
        by = cy - rng.uniform(22, 40) * scale
        draw_line(dr, dh, (cx, cy), (bx, by), (*stem_c, 255), h_val - 4, max(2, int(2.8 * scale)))
        is_pink = rng.random() < 0.48
        base_f = (204, 114, 152) if is_pink else (234, 232, 218)
        hi_f = (238, 170, 196) if is_pink else (250, 248, 238)
        for j in range(12):
            ja = rng.uniform(0, math.tau)
            jr = rng.uniform(0, 8.8 * scale)
            fx = bx + math.cos(ja) * jr
            fy = by + math.sin(ja) * jr * 0.80
            fc = lerp_color(base_f, hi_f, rng.random())
            draw_ellipse(dr, dh, fx, fy, 4.6 * scale, 3.6 * scale, (*fc, 255), clamp(h_val + 20))


def paint_oxeye_daisy(dr, dh, rng, cx, cy, radius, tilt_y, stem_bottom_y, h_val, is_chamomile=False):
    """Paint a crisp white oxeye daisy (Margerite) or wild chamomile (Kamille) with golden center."""
    stem_c = jitter_color((70, 110, 44), rng, 8, 10, 6)
    stem_top_c = jitter_color((88, 130, 54), rng, 8, 10, 6)
    lean = rng.uniform(-28, 28)
    p0 = (cx + lean, stem_bottom_y)
    p1 = (cx + lean * 0.35, 0.5 * (cy + stem_bottom_y))
    p2 = (cx, cy + radius * 0.25)
    for i in range(6):
        t0, t1 = i / 6.0, (i + 1) / 6.0
        a = ((1 - t0) ** 2 * p0[0] + 2 * (1 - t0) * t0 * p1[0] + t0 ** 2 * p2[0],
             (1 - t0) ** 2 * p0[1] + 2 * (1 - t0) * t0 * p1[1] + t0 ** 2 * p2[1])
        b = ((1 - t1) ** 2 * p0[0] + 2 * (1 - t1) * t1 * p1[0] + t1 ** 2 * p2[0],
             (1 - t1) ** 2 * p0[1] + 2 * (1 - t1) * t1 * p1[1] + t1 ** 2 * p2[1])
        sc = lerp_color(stem_c, stem_top_c, t0)
        draw_line(dr, dh, a, b, (*sc, 255), h_val - 12, max(2, int(radius * 0.14)))

    if tilt_y < 0.75:
        draw_ellipse(dr, dh, cx, cy + radius * 0.26, radius * 0.38, radius * 0.24, (74, 114, 44, 255), h_val - 4)

    n_petals = rng.randint(11, 14) if is_chamomile else rng.randint(13, 17)
    base_ang = rng.uniform(0, math.tau)
    for i in range(n_petals):
        a = base_ang + (i / n_petals) * math.tau + rng.uniform(-0.07, 0.07)
        plen = radius * rng.uniform(0.88, 1.08)
        pwid = radius * (0.21 if is_chamomile else 0.19)
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        local = [
            (radius * 0.18, 0.0),
            (plen * 0.55, -pwid),
            (plen, -pwid * 0.32),
            (plen, pwid * 0.32),
            (plen * 0.55, pwid),
        ]
        for lx, ly in local:
            rx = lx * ca - ly * sa
            ry = (lx * sa + ly * ca) * tilt_y
            droop = (lx / plen) ** 2 * radius * (0.24 if is_chamomile else 0.06)
            pts.append((cx + rx, cy + ry + droop))

        shade = 0.87 + 0.13 * (-math.sin(a) * 0.5 + 0.5)
        pc = (
            clamp(244 * shade + rng.uniform(-4, 4)),
            clamp(243 * shade + rng.uniform(-4, 4)),
            clamp(232 * shade + rng.uniform(-4, 4)),
        )
        draw_poly(dr, dh, pts, (*pc, 255), clamp(h_val + 14))

    disc_rx = radius * (0.36 if is_chamomile else 0.34)
    disc_ry = disc_rx * (max(0.68, tilt_y) if is_chamomile else max(0.50, tilt_y))
    disc_cy = cy - (radius * 0.08 if is_chamomile else 0.0)
    draw_ellipse(dr, dh, cx, disc_cy + 1.5, disc_rx, disc_ry, (190, 130, 20, 255), clamp(h_val + 22))
    draw_ellipse(dr, dh, cx, disc_cy, disc_rx * 0.88, disc_ry * 0.85, (236, 186, 32, 255), clamp(h_val + 28))
    draw_ellipse(dr, dh, cx - disc_rx * 0.22, disc_cy - disc_ry * 0.22, disc_rx * 0.42, disc_ry * 0.38, (252, 222, 88, 255), clamp(h_val + 34))


def paint_buttercup(dr, dh, rng, cx, cy, radius, stem_bottom_y, h_val):
    """Paint a glossy golden-yellow meadow buttercup (Hahnenfuß)."""
    stem_c = jitter_color((70, 112, 42), rng, 8, 10, 6)
    draw_line(dr, dh, (cx + rng.uniform(-20, 20), stem_bottom_y), (cx, cy + radius * 0.2), (*stem_c, 255), h_val - 12, max(2, int(radius * 0.14)))

    base_ang = rng.uniform(0, math.tau)
    for k in range(5):
        a = base_ang + k * (math.tau / 5.0) + rng.uniform(-0.1, 0.1)
        px = cx + math.cos(a) * radius * 0.48
        py = cy + math.sin(a) * radius * 0.40
        pr = radius * 0.50
        c_edge = jitter_color((242, 194, 22), rng, 10, 12, 8)
        c_hi = jitter_color((254, 224, 68), rng, 6, 8, 8)
        draw_ellipse(dr, dh, px, py, pr, pr * 0.84, (*c_edge, 255), clamp(h_val + 16))
        draw_ellipse(dr, dh, px - pr * 0.18, py - pr * 0.2, pr * 0.52, pr * 0.42, (*c_hi, 255), clamp(h_val + 22))

    draw_ellipse(dr, dh, cx, cy, radius * 0.26, radius * 0.22, (164, 124, 20, 255), clamp(h_val + 26))
    draw_ellipse(dr, dh, cx - 1, cy - 1, radius * 0.14, radius * 0.12, (234, 194, 46, 255), clamp(h_val + 30))


def paint_red_poppy(dr, dh, rng, cx, cy, radius, tilt_y, stem_bottom_y, h_val, side_cup=False):
    """Paint an unmistakable German Klatschmohn (Papaver rhoeas) scarlet poppy."""
    stem_c = jitter_color((68, 106, 42), rng, 8, 10, 6)
    lean = rng.uniform(-30, 30)
    p0 = (cx + lean, stem_bottom_y)
    p1 = (cx + lean * 0.35, 0.5 * (cy + stem_bottom_y))
    p2 = (cx, cy + radius * (0.42 if side_cup else 0.28))
    for i in range(7):
        t0, t1 = i / 7.0, (i + 1) / 7.0
        a = ((1 - t0) ** 2 * p0[0] + 2 * (1 - t0) * t0 * p1[0] + t0 ** 2 * p2[0],
             (1 - t0) ** 2 * p0[1] + 2 * (1 - t0) * t0 * p1[1] + t0 ** 2 * p2[1])
        b = ((1 - t1) ** 2 * p0[0] + 2 * (1 - t1) * t1 * p1[0] + t1 ** 2 * p2[0],
             (1 - t1) ** 2 * p0[1] + 2 * (1 - t1) * t1 * p1[1] + t1 ** 2 * p2[1])
        draw_line(dr, dh, a, b, (*stem_c, 255), h_val - 12, max(3, int(radius * 0.13)))

    if side_cup:
        back_c = jitter_color((184, 22, 20), rng, 8, 6, 6)
        mid_c = jitter_color((224, 38, 26), rng, 10, 8, 6)
        front_c = jitter_color((240, 56, 36), rng, 8, 8, 6)
        draw_ellipse(dr, dh, cx, cy - radius * 0.08, radius * 0.88, radius * 0.62, (*back_c, 255), clamp(h_val + 14))
        draw_ellipse(dr, dh, cx, cy - radius * 0.02, radius * 0.34, radius * 0.22, (36, 18, 22, 255), clamp(h_val + 20))
        draw_ellipse(dr, dh, cx, cy - radius * 0.04, radius * 0.14, radius * 0.14, (124, 150, 66, 255), clamp(h_val + 24))
        draw_ellipse(dr, dh, cx - radius * 0.38, cy + radius * 0.04, radius * 0.56, radius * 0.44, (*mid_c, 255), clamp(h_val + 22))
        draw_ellipse(dr, dh, cx + radius * 0.38, cy + radius * 0.04, radius * 0.56, radius * 0.44, (*mid_c, 255), clamp(h_val + 22))
        draw_ellipse(dr, dh, cx, cy + radius * 0.14, radius * 0.66, radius * 0.38, (*front_c, 255), clamp(h_val + 28))
        draw_ellipse(dr, dh, cx - radius * 0.10, cy + radius * 0.06, radius * 0.42, radius * 0.16, (254, 96, 58, 255), clamp(h_val + 30))
        return

    base_ang = rng.uniform(0, math.tau)
    petal_palette = [
        (188, 22, 20),
        (214, 30, 22),
        (232, 46, 30),
        (244, 64, 38),
    ]
    for k in range(4):
        a = base_ang + k * (math.tau / 4.0) + rng.uniform(-0.14, 0.14)
        ca, sa = math.cos(a), math.sin(a)
        px = cx + ca * radius * 0.44
        py = cy + sa * radius * 0.44 * tilt_y
        rx = radius * rng.uniform(0.58, 0.68)
        ry = radius * rng.uniform(0.56, 0.66)

        pts = []
        for s in range(14):
            sa_p = (s / 14.0) * math.tau
            crinkle = 1.0 + 0.07 * math.sin(sa_p * 5.0 + k * 1.9)
            lx = math.cos(sa_p) * rx * crinkle
            ly = math.sin(sa_p) * ry * crinkle
            wx = px + lx * ca - ly * sa
            wy = py + (lx * sa + ly * ca) * tilt_y
            pts.append((wx, wy))

        c_main = jitter_color(petal_palette[k % len(petal_palette)], rng, 10, 8, 6)
        draw_poly(dr, dh, pts, (*c_main, 255), clamp(h_val + 16 + k * 3))

        hx = cx + ca * radius * 0.66
        hy = cy + sa * radius * 0.66 * tilt_y
        c_sheen = lerp_color(c_main, (255, 98, 56), 0.44)
        draw_ellipse(dr, dh, hx, hy, radius * 0.34, radius * 0.24 * max(0.65, tilt_y), (*c_sheen, 255), clamp(h_val + 24))

        bx = cx + ca * radius * 0.20
        by = cy + sa * radius * 0.20 * tilt_y
        draw_ellipse(dr, dh, bx, by, radius * 0.18, radius * 0.15 * max(0.58, tilt_y), (42, 12, 16, 255), clamp(h_val + 22))

    draw_ellipse(dr, dh, cx, cy, radius * 0.24, radius * 0.20 * max(0.62, tilt_y), (30, 20, 24, 255), clamp(h_val + 28))
    for s in range(9):
        sa = (s / 9.0) * math.tau + rng.uniform(-0.2, 0.2)
        sx = cx + math.cos(sa) * radius * 0.22
        sy = cy + math.sin(sa) * radius * 0.18 * max(0.62, tilt_y)
        draw_ellipse(dr, dh, sx, sy, radius * 0.052, radius * 0.052, (196, 170, 74, 255), clamp(h_val + 30))
    draw_ellipse(dr, dh, cx, cy, radius * 0.12, radius * 0.11 * max(0.65, tilt_y), (124, 150, 68, 255), clamp(h_val + 34))


def paint_poppy_bud(dr, dh, rng, cx, cy, radius, stem_bottom_y, h_val):
    stem_c = jitter_color((70, 108, 44), rng, 8, 8, 6)
    draw_line(dr, dh, (cx + rng.uniform(-16, 16), stem_bottom_y), (cx, cy + radius), (*stem_c, 255), h_val - 12, 3)
    draw_ellipse(dr, dh, cx, cy, radius * 0.72, radius * 1.05, (90, 126, 54, 255), clamp(h_val + 14))
    draw_ellipse(dr, dh, cx, cy - radius * 0.35, radius * 0.26, radius * 0.52, (218, 38, 28, 255), clamp(h_val + 18))


def paint_cornflower(dr, dh, rng, cx, cy, radius, stem_bottom_y, h_val):
    """Paint an iconic vibrant cobalt-blue Kornblume (Centaurea cyanus)."""
    stem_c = jitter_color((80, 114, 66), rng, 8, 10, 8)
    draw_line(dr, dh, (cx + rng.uniform(-24, 24), stem_bottom_y), (cx, cy + radius * 0.4), (*stem_c, 255), h_val - 12, max(2, int(radius * 0.13)))
    draw_ellipse(dr, dh, cx, cy + radius * 0.35, radius * 0.32, radius * 0.36, (90, 120, 58, 255), h_val)

    n_florets = rng.randint(9, 12)
    base_ang = rng.uniform(0, math.tau)
    for k in range(n_florets):
        a = base_ang + (k / n_florets) * math.tau + rng.uniform(-0.08, 0.08)
        ca, sa = math.cos(a), math.sin(a)
        flen = radius * rng.uniform(0.90, 1.16)
        local = [
            (radius * 0.14, 0.0),
            (flen * 0.72, -radius * 0.26),
            (flen * 1.02, -radius * 0.22),
            (flen * 0.84, -radius * 0.06),
            (flen * 1.06, 0.0),
            (flen * 0.84, radius * 0.06),
            (flen * 1.02, radius * 0.22),
            (flen * 0.72, radius * 0.26),
        ]
        pts = [(cx + lx * ca - ly * sa, cy + (lx * sa + ly * ca) * 0.84) for lx, ly in local]
        c_blue = jitter_color((42, 94, 226), rng, 14, 18, 16)
        if k % 3 == 0:
            c_blue = lerp_color(c_blue, (112, 158, 254), 0.38)
        elif k % 3 == 1:
            c_blue = lerp_color(c_blue, (28, 64, 190), 0.25)
        draw_poly(dr, dh, pts, (*c_blue, 255), clamp(h_val + 16))

    draw_ellipse(dr, dh, cx, cy, radius * 0.36, radius * 0.30, (34, 44, 140, 255), clamp(h_val + 24))
    for j in range(7):
        ja = (j / 7.0) * math.tau + rng.uniform(-0.2, 0.2)
        jr = radius * rng.uniform(0.06, 0.24)
        fx = cx + math.cos(ja) * jr
        fy = cy + math.sin(ja) * jr * 0.8
        fc = (132, 158, 248) if (j % 2 == 0) else (62, 84, 200)
        draw_ellipse(dr, dh, fx, fy, radius * 0.08, radius * 0.07, (*fc, 255), clamp(h_val + 28))


# ---------------------------------------------------------------------------
# Organic Feathered Clump Painter (1024x1024 Supersampled Panel)
# Roots clustered cleanly inside [12%..88%], blades fanning outward organically
# with ZERO hard vertical left/right scissor edges!
# ---------------------------------------------------------------------------

def paint_feathered_clump_panel(seed: int, mode: str, variant: int) -> tuple:
    """
    Paint one 1024x1024 feathered grass/wildflower tuft panel.
    mode: "meadow" or "wildflower"
    variant: 0 or 1
    Returns (rgba_1024, hmap_1024).
    """
    rng = random.Random(seed)
    S = 1024
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hmap = Image.new("L", (S, S), 80)
    dr = ImageDraw.Draw(img)
    dh = ImageDraw.Draw(hmap)

    # Helpers to keep blades organically arched inside [20..S-20] with domed silhouette!
    def edge_dome(norm_x):
        """norm_x in [-1, 1] -> smooth dome height multiplier (tall center, gracefully shorter edges)."""
        return max(0.32, 1.0 - 0.56 * (norm_x ** 2))

    # 1. Rooted underground skirt & lush basal mound (bottom 24%, feathered softly on left/right!)
    # Draw dense dark-olive grass base blades from Y=S+10 fanning gently upward so no hard vertical box forms!
    for _ in range(280):
        nx = rng.triangular(-0.82, 0.82, 0.0)
        bx = S * (0.5 + nx * 0.44)
        by = rng.uniform(S * 0.88, S + 14)
        dome = edge_dome(nx)
        length = rng.uniform(140, 290) * (0.65 + 0.35 * dome)
        # Fan naturally outward from clump center!
        lean = nx * rng.uniform(55, 130) + rng.uniform(-45, 45)
        c0 = jitter_color((42, 64, 24), rng, 8, 10, 6)
        c1 = jitter_color((68, 98, 38), rng, 10, 12, 8)
        paint_curved_blade(
            dr, dh, bx, by, length,
            base_width=rng.uniform(13, 22),
            lean_x=lean, droop_y=abs(lean) * rng.uniform(0.15, 0.30),
            col_base=c0, col_mid=c1, col_tip=c1,
            height_val=106, segs=6,
        )

    # 2. Back shadow grass blades (giving deep lush Palatinate meadow cushion volume!)
    n_back = 310 if mode == "meadow" else 270
    for _ in range(n_back):
        nx = rng.triangular(-0.84, 0.84, 0.0)
        bx = S * (0.5 + nx * 0.44)
        by = rng.uniform(S * 0.82, S + 10)
        dome = edge_dome(nx)
        length = rng.uniform(S * 0.34, S * 0.68) * (0.55 + 0.45 * dome)
        lean = nx * rng.uniform(85, 200) + rng.uniform(-75, 75)
        # Clamp lean so outer tips stay cleanly inside [14..S-14] (ZERO clipping against panel edge!)
        max_lean_r = (S - 18) - bx
        max_lean_l = 18 - bx
        lean = max(max_lean_l, min(max_lean_r, lean))

        c_base = jitter_color((44, 70, 26), rng, 8, 10, 6)
        c_mid = jitter_color((72, 106, 40), rng, 10, 12, 8)
        if rng.random() < 0.28:
            c_tip = jitter_color((168, 150, 72), rng, 14, 12, 8)
        else:
            c_tip = jitter_color((108, 140, 52), rng, 12, 12, 8)

        paint_curved_blade(
            dr, dh, bx, by, length,
            base_width=rng.uniform(10.5, 17.5),
            lean_x=lean, droop_y=abs(lean) * rng.uniform(0.22, 0.44),
            col_base=c_base, col_mid=c_mid, col_tip=c_tip,
            height_val=124, segs=8,
        )

    # 3. Mid sunlit Palatinate summer meadow blades (arching richly outward!)
    n_mid = 320 if mode == "meadow" else 240
    for _ in range(n_mid):
        nx = rng.triangular(-0.80, 0.80, 0.0)
        bx = S * (0.5 + nx * 0.43)
        by = rng.uniform(S * 0.78, S * 0.98)
        dome = edge_dome(nx)
        length = rng.uniform(S * 0.40, S * 0.78) * (0.52 + 0.48 * dome)
        lean = nx * rng.uniform(100, 235) + rng.uniform(-90, 90)
        lean = max(16 - bx, min((S - 16) - bx, lean))

        c_base = jitter_color((52, 82, 30), rng, 8, 10, 6)
        c_mid = jitter_color((88, 128, 48), rng, 12, 14, 8)
        rt = rng.random()
        if rt < 0.34:
            c_tip = jitter_color((190, 170, 84), rng, 14, 12, 10)
        elif rt < 0.72:
            c_tip = jitter_color((128, 162, 62), rng, 12, 14, 8)
        else:
            c_tip = jitter_color((106, 140, 52), rng, 10, 12, 8)

        paint_curved_blade(
            dr, dh, bx, by, length,
            base_width=rng.uniform(8.5, 14.5),
            lean_x=lean, droop_y=abs(lean) * rng.uniform(0.24, 0.48),
            col_base=c_base, col_mid=c_mid, col_tip=c_tip,
            height_val=154, segs=9,
        )

    # 4. Graceful golden oat-grass seed panicles (Glatthafer) crowning the clump
    n_oat = 24 if mode == "meadow" else 20
    for _ in range(n_oat):
        nx = rng.uniform(-0.62, 0.62)
        bx = S * (0.5 + nx * 0.42)
        by = rng.uniform(S * 0.75, S * 0.88)
        dome = edge_dome(nx)
        length = rng.uniform(S * 0.56, S * 0.78) * (0.68 + 0.32 * dome)
        lean = max(36 - bx, min((S - 36) - bx, nx * rng.uniform(70, 150) + rng.uniform(-55, 55)))
        paint_oat_seed_plume(
            dr, dh, rng, bx, by, length, lean,
            golden_col=jitter_color((202, 180, 98), rng, 14, 12, 10),
            stem_col=jitter_color((96, 128, 52), rng, 10, 10, 8),
            h_val=172,
        )

    # 5. Species-specific wildflowers!
    if mode == "meadow":
        # Lush visible clover trefoils (+ occasional white/blush clover globes)
        for _ in range(18):
            nx = rng.uniform(-0.66, 0.66)
            cx = S * (0.5 + nx * 0.44)
            cy = rng.uniform(S * 0.56, S * 0.78)
            paint_clover_cluster(
                dr, dh, rng, cx, cy,
                scale=rng.uniform(0.95, 1.42),
                h_val=180,
                with_blossom=(rng.random() < (0.38 if variant == 0 else 0.28)),
            )
        # Tasteful scattered white oxeye daisies & chamomile (more daisies on variant 0, gentler on variant 1)
        n_daisies = 9 if variant == 0 else 6
        for i in range(n_daisies):
            nx = -0.64 + (i + 0.5) * (1.28 / n_daisies) + rng.uniform(-0.08, 0.08)
            cx = S * (0.5 + nx * 0.45)
            dome = edge_dome(nx)
            cy = rng.uniform(S * (0.30 + (1 - dome) * 0.24), S * 0.58)
            is_cham = rng.random() < 0.45
            paint_oxeye_daisy(
                dr, dh, rng, cx, cy,
                radius=rng.uniform(22, 32) if is_cham else rng.uniform(28, 40),
                tilt_y=rng.uniform(0.60, 0.96),
                stem_bottom_y=rng.uniform(S * 0.80, S * 0.92),
                h_val=192, is_chamomile=is_cham,
            )
        # Subtle golden meadow buttercups (more buttercups on variant 1!)
        n_butter = 6 if variant == 0 else 10
        for i in range(n_butter):
            nx = -0.62 + (i + 0.5) * (1.24 / n_butter) + rng.uniform(-0.09, 0.09)
            cx = S * (0.5 + nx * 0.44)
            cy = rng.uniform(S * 0.40, S * 0.65)
            paint_buttercup(
                dr, dh, rng, cx, cy,
                radius=rng.uniform(18, 27),
                stem_bottom_y=rng.uniform(S * 0.80, S * 0.92),
                h_val=188,
            )
    else:
        # Pfalz Blühstreifen (Wildflower Strip): Klatschmohn + Kornblumen + Kamille + buttercups!
        for _ in range(12):
            nx = rng.uniform(-0.62, 0.62)
            cx = S * (0.5 + nx * 0.44)
            cy = rng.uniform(S * 0.60, S * 0.78)
            paint_clover_cluster(dr, dh, rng, cx, cy, scale=rng.uniform(0.9, 1.3), h_val=166, with_blossom=False)

        # Subtle sunny-yellow buttercups / wild mustard
        for i in range(6):
            nx = -0.60 + (i + 0.5) * (1.20 / 6.0) + rng.uniform(-0.08, 0.08)
            cx = S * (0.5 + nx * 0.44)
            cy = rng.uniform(S * 0.38, S * 0.62)
            paint_buttercup(dr, dh, rng, cx, cy, radius=rng.uniform(18, 26), stem_bottom_y=rng.uniform(S * 0.80, S * 0.92), h_val=174)

        # Crisp white chamomile & oxeye daisies
        n_cham = 11 if variant == 0 else 13
        for i in range(n_cham):
            nx = -0.66 + (i + 0.5) * (1.32 / n_cham) + rng.uniform(-0.07, 0.07)
            cx = S * (0.5 + nx * 0.45)
            dome = edge_dome(nx)
            cy = rng.uniform(S * (0.24 + (1 - dome) * 0.25), S * 0.56)
            is_cham = rng.random() < 0.65
            paint_oxeye_daisy(
                dr, dh, rng, cx, cy,
                radius=rng.uniform(22, 34) if is_cham else rng.uniform(28, 39),
                tilt_y=rng.uniform(0.62, 0.96),
                stem_bottom_y=rng.uniform(S * 0.80, S * 0.92),
                h_val=182, is_chamomile=is_cham,
            )

        # Vibrant cobalt-blue Kornblumen (cornflowers)
        n_corn = 9 if variant == 0 else 12
        for i in range(n_corn):
            nx = -0.64 + (i + 0.5) * (1.28 / n_corn) + rng.uniform(-0.07, 0.07)
            cx = S * (0.5 + nx * 0.44)
            dome = edge_dome(nx)
            cy = rng.uniform(S * (0.18 + (1 - dome) * 0.26), S * 0.50)
            paint_cornflower(
                dr, dh, rng, cx, cy,
                radius=rng.uniform(28, 42),
                stem_bottom_y=rng.uniform(S * 0.80, S * 0.92),
                h_val=192,
            )

        # Nodding green-and-crimson poppy buds
        for i in range(4):
            nx = rng.uniform(-0.56, 0.56)
            cx = S * (0.5 + nx * 0.44)
            cy = rng.uniform(S * 0.26, S * 0.48)
            paint_poppy_bud(dr, dh, rng, cx, cy, radius=rng.uniform(13, 18), stem_bottom_y=rng.uniform(S * 0.78, S * 0.88), h_val=186)

        # Bright crimson Klatschmohn (red poppies) — open ruffled saucers + side-profile cups!
        n_pop = 9 if variant == 0 else 7
        for i in range(n_pop):
            nx = -0.60 + (i + 0.5) * (1.20 / n_pop) + rng.uniform(-0.07, 0.07)
            cx = S * (0.5 + nx * 0.44)
            dome = edge_dome(nx)
            cy = rng.uniform(S * (0.15 + (1 - dome) * 0.26), S * 0.44)
            paint_red_poppy(
                dr, dh, rng, cx, cy,
                radius=rng.uniform(36, 52),
                tilt_y=rng.uniform(0.68, 0.96),
                stem_bottom_y=rng.uniform(S * 0.80, S * 0.92),
                h_val=204, side_cup=(i % 3 == 1),
            )

    # 6. Foreground slender arching grass wisps weaving naturally in front of flower stems!
    for _ in range(110):
        nx = rng.triangular(-0.76, 0.76, 0.0)
        bx = S * (0.5 + nx * 0.42)
        by = rng.uniform(S * 0.82, S + 6)
        dome = edge_dome(nx)
        length = rng.uniform(S * 0.24, S * 0.56) * (0.6 + 0.4 * dome)
        lean = max(18 - bx, min((S - 18) - bx, nx * rng.uniform(80, 180) + rng.uniform(-70, 70)))
        c_base = jitter_color((50, 80, 30), rng, 8, 10, 6)
        c_mid = jitter_color((94, 134, 50), rng, 12, 14, 8)
        c_tip = jitter_color((172, 166, 78) if rng.random() < 0.32 else (132, 164, 62), rng, 12, 12, 8)
        paint_curved_blade(
            dr, dh, bx, by, length,
            base_width=rng.uniform(6.0, 10.5),
            lean_x=lean, droop_y=abs(lean) * rng.uniform(0.24, 0.48),
            col_base=c_base, col_mid=c_mid, col_tip=c_tip,
            height_val=214, segs=8,
        )

    # Guarantee 8px transparent safety gutter on left, right, and top so atlas slices NEVER bleed!
    arr = np.asarray(img).copy()
    arr[:, :8, 3] = 0
    arr[:, -8:, 3] = 0
    arr[:8, :, 3] = 0
    return Image.fromarray(arr, mode="RGBA"), hmap


# ---------------------------------------------------------------------------
# Post-Processing: RGB Edge-Bleed Dilation + Compact Normal Map + Crisp Save
# ---------------------------------------------------------------------------

def dilate_rgb_into_transparent(rgba: np.ndarray, iterations: int = 20) -> np.ndarray:
    """Propagate RGB colors from opaque pixels outward into transparent pixels (clamped)."""
    out = rgba.copy()
    rgb = out[:, :, :3].astype(np.float32)
    mask = out[:, :, 3] > 64

    for _ in range(iterations):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(mask.shape, dtype=np.float32)
        # Clamped 4-neighbor dilation (no horizontal wrap across atlas panels!)
        # Up
        m = mask[:-1, :].astype(np.float32)
        acc[1:, :] += rgb[:-1, :] * m[:, :, None]
        cnt[1:, :] += m
        # Down
        m = mask[1:, :].astype(np.float32)
        acc[:-1, :] += rgb[1:, :] * m[:, :, None]
        cnt[:-1, :] += m
        # Left
        m = mask[:, :-1].astype(np.float32)
        acc[:, 1:] += rgb[:, :-1] * m[:, :, None]
        cnt[:, 1:] += m
        # Right
        m = mask[:, 1:].astype(np.float32)
        acc[:, :-1] += rgb[:, 1:] * m[:, :, None]
        cnt[:, :-1] += m

        fill = (~mask) & (cnt > 0)
        if not np.any(fill):
            break
        rgb[fill] = acc[fill] / cnt[fill, None]
        mask[fill] = True

    still_empty = ~mask
    if np.any(still_empty):
        rgb[still_empty] = np.array([96.0, 124.0, 54.0], dtype=np.float32)

    out[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


def height_to_normal_map(height_img: Image.Image, target_size: tuple, strength: float = 2.0) -> Image.Image:
    h_small = height_img.resize(target_size, Image.Resampling.LANCZOS)
    h_arr = np.asarray(h_small, dtype=np.float32) / 255.0

    left = np.hstack([h_arr[:, 0:1], h_arr[:, :-1]])
    right = np.hstack([h_arr[:, 1:], h_arr[:, -1:]])
    up = np.vstack([h_arr[0:1, :], h_arr[:-1, :]])
    down = np.vstack([h_arr[1:, :], h_arr[-1:, :]])

    dx = (right - left) * strength
    dy = (down - up) * strength
    dz = np.ones_like(h_arr)

    inv_len = 1.0 / np.sqrt(dx * dx + dy * dy + dz * dz)
    nx = -dx * inv_len
    ny = dy * inv_len
    nz = dz * inv_len

    nmap = np.stack([
        np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255),
        np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255),
        np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255),
    ], axis=-1).astype(np.uint8)
    return Image.fromarray(nmap, mode="RGB")


def build_two_clump_atlas(mode: str, seed_a: int, seed_b: int, albedo_name: str, normal_name: str):
    print(f"Generating 2-clump feathered botanical atlas for {mode}...")
    rgba_a, h_a = paint_feathered_clump_panel(seed_a, mode, variant=0)
    rgba_b, h_b = paint_feathered_clump_panel(seed_b, mode, variant=1)

    atlas_rgba = Image.new("RGBA", (2048, 1024), (0, 0, 0, 0))
    atlas_rgba.paste(rgba_a, (0, 0))
    atlas_rgba.paste(rgba_b, (1024, 0))

    atlas_h = Image.new("L", (2048, 1024), 80)
    atlas_h.paste(h_a, (0, 0))
    atlas_h.paste(h_b, (1024, 0))

    # Downsample 2x -> 1024x512 crisp antialiased RGBA
    final_rgba = atlas_rgba.resize((1024, 512), Image.Resampling.LANCZOS)
    arr = np.asarray(final_rgba).copy()
    alpha = arr[:, :, 3].astype(np.float32)
    alpha = np.clip((alpha - 108.0) * 1.9 + 128.0, 0, 255).astype(np.uint8)
    arr[:, :, 3] = alpha
    arr = dilate_rgb_into_transparent(arr, iterations=20)

    clean = Image.fromarray(arr, mode="RGBA")
    quant = clean.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    albedo_path = os.path.join(OUT_DIR, albedo_name)
    quant.save(albedo_path, format="PNG", optimize=True)

    normal_img = height_to_normal_map(atlas_h.filter(ImageFilter.GaussianBlur(1.5)), (512, 256), strength=2.0)
    normal_path = os.path.join(OUT_DIR, normal_name)
    normal_img.save(normal_path, format="JPEG", quality=85, optimize=True)

    print(
        f"  -> {albedo_name}: {os.path.getsize(albedo_path)/1024:.1f} KB, "
        f"{normal_name}: {os.path.getsize(normal_path)/1024:.1f} KB"
    )


if __name__ == "__main__":
    build_two_clump_atlas("meadow", 4207, 4299, "meadow_albedo_alpha.png", "meadow_normal.jpg")
    build_two_clump_atlas("wildflower", 8841, 8923, "wildflower_albedo_alpha.png", "wildflower_normal.jpg")
    print("Done generating 2-clump feathered meadow & wildflower PBR textures!")
