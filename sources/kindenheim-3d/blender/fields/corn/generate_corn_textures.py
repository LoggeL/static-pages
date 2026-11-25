#!/usr/bin/env python3
"""
Procedural Botanical PBR Texture Generator (v3 - 5-Panel Zero-Crop Atlas)
for July/August Pfalz Maize / Corn (Zea mays).

Paints at 2x supersampled resolution (2048x2048) on 5 isolated zero-crop panel canvases so
ZERO leaves or tassels ever hit a rectangular card border:
  - Panel A  (top-left,  x:   0..450, y:   0..676): 6-stalk longitudinal stand (2.0m wide)
  - Panel B1 (top-mid,   x: 470..736, y:   0..676): 3-stalk cross-baffle cluster var 1 (1.0m wide)
  - Panel B2 (top-right, x: 756..1024, y:  0..676): 3-stalk cross-baffle cluster var 2 (1.0m wide)
  - Panel C  (bot-left,  x:   0..502, y: 696..1024): Flowing overhead crown rosette var 1
  - Panel D  (bot-right, x: 522..1024, y: 696..1024): Flowing overhead crown rosette var 2

Outputs (in blender/fields/corn/textures/):
  - corn_maize_albedo.png  (1024x1024 compact indexed RGBA PNG, edge-dilated, ~240-275 KB)
  - corn_maize_normal.jpg  (512x512 RGB tangent-space normal map JPG, ~52 KB)
"""

import math
import os
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = "/Users/logge/Documents/Projects/kindenheim-3d/blender/fields/corn/textures"
os.makedirs(OUT_DIR, exist_ok=True)

SS = 2
FINAL_W, FINAL_H = 1024, 1024
W, H = FINAL_W * SS, FINAL_H * SS


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_rgb(c0, c1, t):
    t = clamp(t, 0.0, 1.0)
    return (
        int(round(lerp(c0[0], c1[0], t))),
        int(round(lerp(c0[1], c1[1], t))),
        int(round(lerp(c0[2], c1[2], t))),
    )


def scale_rgb(c, f):
    return (
        int(clamp(round(c[0] * f), 0, 255)),
        int(clamp(round(c[1] * f), 0, 255)),
        int(clamp(round(c[2] * f), 0, 255)),
    )


class BotanicalCanvas:
    def __init__(self, width: int, height: int):
        self.w = width
        self.h = height
        self.albedo = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        self.height_img = Image.new("L", (width, height), 0)
        self.draw_c = ImageDraw.Draw(self.albedo, "RGBA")
        self.draw_h = ImageDraw.Draw(self.height_img, "L")

    def draw_polygon(self, pts, color, h_val: int = 128):
        if len(pts) < 3:
            return
        c_rgba = color if len(color) == 4 else (color[0], color[1], color[2], 255)
        self.draw_c.polygon(pts, fill=c_rgba)
        if c_rgba[3] > 100:
            self.draw_h.polygon(pts, fill=int(clamp(h_val, 0, 255)))

    def draw_line(self, pts, color, width: int = 2, h_val: int = 160):
        if len(pts) < 2:
            return
        c_rgba = color if len(color) == 4 else (color[0], color[1], color[2], 255)
        w = max(1, int(round(width)))
        self.draw_c.line(pts, fill=c_rgba, width=w)
        if c_rgba[3] > 100:
            self.draw_h.line(pts, fill=int(clamp(h_val, 0, 255)), width=w)

    def draw_ellipse(self, bbox, color, h_val: int = 140):
        c_rgba = color if len(color) == 4 else (color[0], color[1], color[2], 255)
        self.draw_c.ellipse(bbox, fill=c_rgba)
        if c_rgba[3] > 100:
            self.draw_h.ellipse(bbox, fill=int(clamp(h_val, 0, 255)))


def safe_leaf_length(x0: float, side: float, desired_len: float, pw: int, margin: float) -> float:
    """Shorten leaf gracefully if it points toward a panel edge so tips taper organically instead of clipping!"""
    avail = (pw - margin - x0) if side > 0 else (x0 - margin)
    # Horizontal reach of an arching leaf is roughly 0.85 * length
    max_len = max(18.0 * SS, avail / 0.88)
    return min(desired_len, max_len)


def paint_maize_leaf(
    canvas: BotanicalCanvas,
    x0: float,
    y0: float,
    length: float,
    max_width: float,
    side: float,
    launch_deg: float,
    droop: float,
    base_col: tuple,
    tip_col: tuple,
    midrib_col: tuple,
    shade: float = 1.0,
    wavy_phase: float = 0.0,
    wavy_amp: float = 0.16,
    elbow: float = 0.0,
    height_base: int = 145,
):
    n_seg = 24
    rad = math.radians(launch_deg)
    vx = side * math.cos(rad)
    vy = -math.sin(rad)

    spine = []
    for i in range(n_seg + 1):
        t = i / n_seg
        elbow_drop = max(0.0, t - 0.45) ** 1.6 * elbow * length
        px = x0 + vx * length * t + side * (length * 0.12 * (t ** 1.5))
        py = y0 + vy * length * t + droop * length * (t ** 2.2) + elbow_drop
        spine.append((px, py))

    tangents, widths = [], []
    for i in range(n_seg + 1):
        i0, i1 = max(0, i - 1), min(n_seg, i + 1)
        dx = spine[i1][0] - spine[i0][0]
        dy = spine[i1][1] - spine[i0][1]
        d = math.hypot(dx, dy) + 1e-6
        tangents.append((dx / d, dy / d))

        t = i / n_seg
        profile = math.sin(math.pi * (t ** 0.70))
        base_sheath = 0.40 * math.exp(-t * 7.5)
        ruffle = 1.0 + wavy_amp * math.sin(t * 13.0 + wavy_phase) * math.sin(math.pi * t)
        w = max_width * (profile * 0.94 + base_sheath) * ruffle
        widths.append(max(1.2, w))

    upper_pts, lower_pts = [], []
    for i in range(n_seg + 1):
        px, py = spine[i]
        tx, ty = tangents[i]
        nx, ny = -ty, tx
        if ny > 0:
            nx, ny = -nx, -ny
        hw = widths[i] * 0.5
        t = i / n_seg
        r_u = 1.0 + 0.08 * math.sin(t * 16.0 + wavy_phase)
        r_l = 1.0 + 0.08 * math.cos(t * 15.0 + wavy_phase)
        upper_pts.append((px + nx * hw * r_u, py + ny * hw * r_u))
        lower_pts.append((px - nx * hw * r_l, py - ny * hw * r_l))

    for i in range(n_seg):
        t = (i + 0.5) / n_seg
        crest_gleam = 1.0 + 0.16 * math.exp(-((t - 0.38) / 0.22) ** 2)
        col_mid = scale_rgb(lerp_rgb(base_col, tip_col, t), shade * crest_gleam)
        col_top = scale_rgb(col_mid, 1.08)
        col_bot = scale_rgb(col_mid, 0.80)
        col_edge = scale_rgb(col_mid, 0.68)

        p0, p1 = spine[i], spine[i + 1]
        u0, u1 = upper_pts[i], upper_pts[i + 1]
        l0, l1 = lower_pts[i], lower_pts[i + 1]

        canvas.draw_polygon([p0, p1, u1, u0], col_top, h_val=int(height_base + 18 * (1.0 - t * 0.35)))
        canvas.draw_polygon([p0, l0, l1, p1], col_bot, h_val=int(height_base - 14 + 10 * (1.0 - t * 0.35)))
        canvas.draw_line([u0, u1], col_edge, width=SS, h_val=height_base - 20)
        canvas.draw_line([l0, l1], col_edge, width=SS, h_val=height_base - 22)

    # Parallel monocot veins
    for frac in (-0.65, -0.36, 0.36, 0.65):
        v_pts = []
        for i in range(n_seg + 1):
            px, py = spine[i]
            tx, ty = tangents[i]
            nx, ny = -ty, tx
            if ny > 0:
                nx, ny = -nx, -ny
            hw = widths[i] * 0.5 * frac
            v_pts.append((px + nx * hw, py + ny * hw))
        v_col = scale_rgb(lerp_rgb(base_col, midrib_col, 0.20 if frac > 0 else 0.06), shade * (1.06 if frac > 0 else 0.86))
        canvas.draw_line(v_pts, v_col, width=max(1, int(SS * 0.7)), h_val=height_base + (12 if frac > 0 else 4))

    # Crisp natural pale-lime central midrib
    for i in range(n_seg - 2):
        t = i / n_seg
        mr_w = max(1, int(round(lerp(max_width * 0.12, 1.0, t ** 0.65))))
        mr_col = scale_rgb(lerp_rgb(midrib_col, tip_col, min(1.0, t * 0.70)), shade * 1.03)
        canvas.draw_line([spine[i], spine[i + 1]], mr_col, width=mr_w, h_val=int(clamp(height_base + 50 * (1.0 - t * 0.55), 0, 255)))


def paint_corn_cob(
    canvas: BotanicalCanvas,
    x0: float,
    y0: float,
    side: float,
    cob_len: float,
    cob_rad: float,
    shade: float = 1.0,
    rng: random.Random = None,
    peek_kernels: bool = False,
):
    if rng is None:
        rng = random.Random(42)

    ang = math.radians(rng.uniform(54.0, 68.0))
    ux = side * math.cos(ang)
    uy = -math.sin(ang)
    nx, ny = -uy, ux
    if nx * side < 0:
        nx, ny = -nx, -ny

    n_seg = 14
    center_pts, left_edge, right_edge = [], [], []
    for i in range(n_seg + 1):
        t = i / n_seg
        cx = x0 + ux * cob_len * t
        cy = y0 + uy * cob_len * t
        r = cob_rad * (math.sin(math.pi * (t ** 0.80)) * (1.08 - 0.14 * t) + 0.24 * (1.0 - t))
        center_pts.append((cx, cy))
        left_edge.append((cx + nx * r, cy + ny * r))
        right_edge.append((cx - nx * r, cy - ny * r))

    c_husk_base = (102, 146, 48)
    c_husk_mid = (138, 176, 66)
    c_husk_tip = (168, 198, 90)

    shadow_pts = [(p[0] - side * 4, p[1] + 4) for p in (left_edge + list(reversed(right_edge)))]
    canvas.draw_polygon(shadow_pts, scale_rgb((28, 54, 18), shade), h_val=150)

    for i in range(n_seg):
        t = (i + 0.5) / n_seg
        col_lit = scale_rgb(lerp_rgb(c_husk_base, c_husk_tip, t), shade * 1.12)
        col_shd = scale_rgb(lerp_rgb(c_husk_base, c_husk_mid, t), shade * 0.84)
        canvas.draw_polygon([center_pts[i], center_pts[i + 1], left_edge[i + 1], left_edge[i]], col_lit, h_val=215)
        canvas.draw_polygon([center_pts[i], right_edge[i], right_edge[i + 1], center_pts[i + 1]], col_shd, h_val=185)

    for rib in (-0.6, -0.28, 0.05, 0.38, 0.68):
        rpts = []
        for i in range(n_seg + 1):
            t = i / n_seg
            r = cob_rad * math.sin(math.pi * (t ** 0.80)) * rib
            rpts.append((center_pts[i][0] + nx * r, center_pts[i][1] + ny * r))
        rcol = scale_rgb((188, 214, 118) if rib > 0 else (68, 108, 34), shade)
        canvas.draw_line(rpts, rcol, width=SS, h_val=224 if rib > 0 else 168)

    for k in (0.26, 0.52, 0.74):
        idx = int(k * n_seg)
        canvas.draw_line(
            [left_edge[max(0, idx - 2)], right_edge[min(n_seg, idx + 2)]],
            scale_rgb((56, 92, 28), shade), width=SS, h_val=162,
        )

    tip_x, tip_y = center_pts[-1]
    if peek_kernels:
        px_k, py_k = center_pts[-2]
        kr = cob_rad * 0.44
        canvas.draw_ellipse([px_k - kr, py_k - kr * 1.15, px_k + kr, py_k + kr * 1.15], scale_rgb((228, 188, 56), shade), h_val=232)
        for ky_o in (-0.5, 0.0, 0.5):
            for kx_o in (-0.4, 0.25):
                kx = px_k + (ux * ky_o + nx * kx_o) * kr * 0.85
                ky = py_k + (uy * ky_o + ny * kx_o) * kr * 0.85
                canvas.draw_ellipse([kx - 3.2, ky - 3.2, kx + 3.2, ky + 3.2], scale_rgb((244, 210, 78), shade), h_val=238)

    for s_wing in (-1.0, 1.0):
        wb = center_pts[-3]
        wx1 = tip_x + (ux * 0.42 + nx * s_wing * 0.72) * cob_len * 0.25
        wy1 = tip_y + (uy * 0.42 + ny * s_wing * 0.72) * cob_len * 0.25
        wx2 = tip_x + (ux * 0.14 + nx * s_wing * 1.18) * cob_len * 0.36
        wy2 = tip_y + (uy * 0.14 + ny * s_wing * 1.18) * cob_len * 0.36 + cob_len * 0.10
        canvas.draw_polygon([wb, (wx1, wy1), (wx2, wy2), (tip_x, tip_y)], scale_rgb((128, 168, 62), shade), h_val=198)

    n_strands = 24
    for s in range(n_strands):
        frac = (s / max(1, n_strands - 1)) - 0.5
        s_len = cob_len * rng.uniform(0.36, 0.68)
        s_pts = []
        wave_p = rng.uniform(0, 6.28)
        for j in range(9):
            jt = j / 8.0
            sx = tip_x + (ux * 0.28 + side * 0.58 + frac * 0.48) * s_len * jt + math.sin(jt * 6.0 + wave_p) * 3.0
            sy = tip_y + uy * 0.22 * s_len * jt + s_len * 0.78 * (jt ** 1.75)
            s_pts.append((sx, sy))
        silk_c = lerp_rgb((240, 224, 152), (186, 128, 68), rng.uniform(0.10, 0.80))
        canvas.draw_line(s_pts, scale_rgb(silk_c, shade), width=max(1, int(SS * 0.9)), h_val=226)


def paint_tassel(
    canvas: BotanicalCanvas,
    x0: float,
    y0: float,
    height: float,
    spread: float,
    shade: float = 1.0,
    rng: random.Random = None,
):
    if rng is None:
        rng = random.Random(77)

    c_stem = scale_rgb((138, 154, 78), shade)
    c_gold_dark = scale_rgb((162, 130, 66), shade)
    c_gold_mid = scale_rgb((204, 174, 100), shade)
    c_gold_lit = scale_rgb((232, 210, 140), shade)

    lean = rng.uniform(-0.14, 0.14) * spread
    central_pts = []
    for i in range(13):
        t = i / 12.0
        px = x0 + lean * (t ** 1.3) + math.sin(t * 5.0) * 3.0
        py = y0 - height * t
        central_pts.append((px, py))

    canvas.draw_line(central_pts[:5], c_stem, width=int(2.4 * SS), h_val=158)
    canvas.draw_line(central_pts[4:], c_gold_mid, width=int(1.7 * SS), h_val=182)

    def paint_feathery_spikelets(pts, scale_r=1.0):
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            dx, dy = bx - ax, by - ay
            seg_len = math.hypot(dx, dy) + 1e-6
            tx, ty = dx / seg_len, dy / seg_len
            nx, ny = -ty, tx
            steps = max(2, int(seg_len / (3.8 * SS)))
            for k in range(steps):
                u = (k + 0.5) / steps
                sx = lerp(ax, bx, u)
                sy = lerp(ay, by, u)
                for sp_side in (-1.0, 1.0):
                    sp_len = rng.uniform(4.0, 7.2) * SS * scale_r
                    sp_w = rng.uniform(1.3, 2.1) * SS * scale_r
                    ang_s = 0.55 * sp_side + rng.uniform(-0.2, 0.2)
                    ex = sx + (tx * 0.72 + nx * ang_s) * sp_len
                    ey = sy + (ty * 0.72 + ny * ang_s) * sp_len
                    col = lerp_rgb(c_gold_dark, c_gold_lit, rng.uniform(0.15, 1.0))
                    canvas.draw_line([(sx, sy), (ex, ey)], col, width=max(1, int(round(sp_w))), h_val=198)

    paint_feathery_spikelets(central_pts[3:], scale_r=1.05)

    n_branches = rng.randint(7, 10)
    for b in range(n_branches):
        side = -1.0 if (b % 2 == 0) else 1.0
        tier = (b // 2) / max(1, (n_branches // 2))
        anchor_idx = min(7, 2 + int(tier * 5))
        ax, ay = central_pts[anchor_idx]
        b_len = height * rng.uniform(0.34, 0.56) * (1.06 - 0.34 * tier)
        b_spread = spread * rng.uniform(0.42, 0.98) * (1.10 - 0.25 * tier)
        b_droop = rng.uniform(0.22, 0.48) * b_len

        b_pts = []
        for j in range(10):
            jt = j / 9.0
            px = ax + side * b_spread * (jt ** 0.86)
            py = ay - b_len * (jt ** 0.76) + b_droop * (jt ** 2.25)
            b_pts.append((px, py))

        canvas.draw_line(b_pts, c_gold_dark, width=max(1, int(1.3 * SS)), h_val=170)
        paint_feathery_spikelets(b_pts[1:], scale_r=0.82)


def paint_segmented_stalk(
    canvas: BotanicalCanvas,
    x_base: float,
    y_bot: float,
    y_top: float,
    y_ground: float,
    radius_base: float,
    radius_top: float,
    lean_x: float,
    shade: float = 1.0,
    rng: random.Random = None,
):
    if rng is None:
        rng = random.Random(10)

    n_seg = 18
    pts, rads = [], []
    for i in range(n_seg + 1):
        t = i / n_seg
        px = x_base + lean_x * (t ** 1.35) + math.sin(t * 4.5 + x_base * 0.02) * 3.0
        py = lerp(y_bot, y_top, t)
        r = lerp(radius_base, radius_top, t ** 0.85)
        pts.append((px, py))
        rads.append(r)

    c_soil = (48, 38, 26)
    c_lower = (92, 114, 46)
    c_mid = (66, 110, 36)
    c_upper = (88, 134, 46)
    c_node = (48, 76, 26)
    c_node_ring = (132, 154, 80)

    for i in range(n_seg):
        t = (i + 0.5) / n_seg
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        r0, r1 = rads[i], rads[i + 1]

        if y0 > y_ground:
            g_blend = clamp((y0 - y_ground) / max(1.0, (y_bot - y_ground)), 0.0, 1.0)
            col = lerp_rgb(c_lower, c_soil, 0.45 + 0.55 * g_blend)
        elif t < 0.45:
            col = lerp_rgb(c_lower, c_mid, t / 0.45)
        else:
            col = lerp_rgb(c_mid, c_upper, (t - 0.45) / 0.55)

        col_lit = scale_rgb(col, shade * 1.14)
        col_mid = scale_rgb(col, shade * 0.96)
        col_shd = scale_rgb(col, shade * 0.68)

        canvas.draw_polygon([(x0 - r0, y0), (x0 - r0 * 0.15, y0), (x1 - r1 * 0.15, y1), (x1 - r1, y1)], col_lit, h_val=186)
        canvas.draw_polygon([(x0 - r0 * 0.15, y0), (x0 + r0 * 0.45, y0), (x1 + r1 * 0.45, y1), (x1 - r1 * 0.15, y1)], col_mid, h_val=198)
        canvas.draw_polygon([(x0 + r0 * 0.45, y0), (x0 + r0, y0), (x1 + r1, y1), (x1 + r1 * 0.45, y1)], col_shd, h_val=152)

    for b_side in (-1.0, 1.0):
        for k in range(2):
            ry0 = y_ground - (6 + k * 7) * SS * 0.5
            rx0 = x_base + b_side * radius_base * 0.45
            rxm = x_base + b_side * radius_base * (1.2 + k * 0.3)
            rym = y_ground + (5 + k * 4) * SS * 0.5
            rx1 = x_base + b_side * radius_base * (1.45 + k * 0.4)
            ry1 = y_ground + (18 + k * 9) * SS * 0.5
            br_col = scale_rgb((96, 76, 48), shade * (0.95 - k * 0.1))
            canvas.draw_line([(rx0, ry0), (rxm, rym), (rx1, ry1)], br_col, width=max(2, int(2.0 * SS)), h_val=162)

    nodes_out = []
    for idx in range(3, n_seg - 1, 2):
        nx, ny = pts[idx]
        nr = rads[idx] * 1.18
        canvas.draw_line([(nx - nr, ny + SS), (nx + nr, ny + SS)], scale_rgb(c_node, shade), width=int(1.6 * SS), h_val=206)
        canvas.draw_line([(nx - nr, ny - SS), (nx + nr, ny - SS)], scale_rgb(c_node_ring, shade), width=int(1.5 * SS), h_val=216)
        frac_up = clamp((y_ground - ny) / max(1.0, (y_ground - y_top)), 0.0, 1.0)
        nodes_out.append((nx, ny, frac_up))

    return nodes_out, pts[-1]


def build_stand_panel(pw: int, ph: int, n_back: int, n_front: int, seed: int, px_per_meter: float) -> BotanicalCanvas:
    """
    Paint a maize stand panel at EXACT consistent real-world scale (`px_per_meter`) with
    organic tapered leafy borders on left, right, and top (ZERO hard rectangular edge cuts!).
    """
    canvas = BotanicalCanvas(pw, ph)
    rng = random.Random(seed)
    y_ground = ph * (1.0 - 0.106)
    edge_margin = 10.0 * SS

    # Underground dark soil/stalk base anchoring skirt (organic vertical blades tucked cleanly inside horizontal edges!)
    n_skirt = max(14, int(pw / (26 * SS)))
    for i in range(n_skirt):
        sx = lerp(edge_margin * 2.2, pw - edge_margin * 2.2, i / max(1, n_skirt - 1)) + rng.uniform(-8, 8)
        sw = rng.uniform(14, 28) * (SS * 0.5)
        sh = ph * rng.uniform(0.105, 0.145)
        lean = rng.uniform(-7, 7)
        col = lerp_rgb((42, 34, 22), (62, 74, 32), rng.uniform(0.0, 0.55))
        canvas.draw_polygon(
            [(sx - sw * 0.55, ph), (sx + sw * 0.55, ph), (sx + lean + sw * 0.30, ph - sh), (sx + lean - sw * 0.30, ph - sh)],
            col, h_val=130,
        )

    # Rich, natural, saturated July/August Pfalz maize palette (calibrated for AgX / Three.js PBR!)
    leaf_base_dark = (30, 66, 20)
    leaf_tip_dark = (54, 96, 28)
    leaf_base_mid = (42, 88, 26)
    leaf_tip_mid = (78, 126, 38)
    leaf_base_lit = (58, 112, 32)
    leaf_tip_lit = (104, 148, 46)
    midrib_pale = (168, 194, 110)
    dry_tip = (134, 120, 54)

    # Consistent physical botanical sizes in pixels (independent of whether panel is 2.0m or 1.0m wide!)
    stalk_r_base = px_per_meter * 0.030   # ~3.0 cm radius
    stalk_r_top = px_per_meter * 0.014
    leaf_len_base = px_per_meter * 0.68   # ~68 cm arching maize leaves!
    leaf_w_base = px_per_meter * 0.095    # ~9.5 cm broad blades!
    cob_len_base = ph * 0.138
    cob_rad_base = px_per_meter * 0.058
    tassel_spread_base = px_per_meter * 0.24

    # Keep stalks inset from left/right panel edges so outward leaves have room to arch & taper naturally!
    x_inset = max(px_per_meter * 0.16, 26.0 * SS)

    # ---- PASS 1: Shaded interior depth stalks ----
    back_tassels = []
    for i in range(n_back):
        t_pos = 0.5 if n_back == 1 else i / (n_back - 1)
        sx = lerp(x_inset, pw - x_inset, t_pos) + rng.uniform(-px_per_meter * 0.05, px_per_meter * 0.05)
        sx = clamp(sx, x_inset * 0.85, pw - x_inset * 0.85)
        y_top = ph * rng.uniform(0.18, 0.25)
        lean = rng.uniform(-16.0, 16.0) * (SS * 0.5)
        shade = rng.uniform(0.62, 0.76)

        nodes, top_pt = paint_segmented_stalk(
            canvas, sx, ph, y_top, y_ground,
            radius_base=stalk_r_base * rng.uniform(0.82, 0.98),
            radius_top=stalk_r_top * rng.uniform(0.82, 0.98),
            lean_x=lean, shade=shade, rng=rng,
        )
        back_tassels.append((top_pt[0], top_pt[1], shade))

        start_side = -1.0 if (i % 2 == 0) else 1.0
        for ni, (nx, ny, f_up) in enumerate(nodes):
            side = start_side if (ni % 2 == 0) else -start_side
            want_len = leaf_len_base * rng.uniform(0.75, 1.15) * (0.82 + 0.28 * math.sin(math.pi * max(0.1, f_up)))
            l_len = safe_leaf_length(nx, side, want_len, pw, edge_margin)
            l_w = leaf_w_base * rng.uniform(0.78, 1.04) * clamp(l_len / want_len, 0.65, 1.0)
            launch = rng.uniform(32.0, 68.0) + f_up * 10.0
            droop = rng.uniform(0.48, 1.05) * (1.15 - 0.35 * f_up)
            elbow = rng.uniform(0.0, 0.50) if rng.random() < 0.45 else 0.0
            t_col = dry_tip if (f_up < 0.16 and rng.random() < 0.55) else leaf_tip_dark
            paint_maize_leaf(
                canvas, nx, ny, l_len, l_w, side, launch, droop,
                leaf_base_dark, t_col, midrib_pale,
                shade=shade * rng.uniform(0.90, 1.08),
                wavy_phase=rng.uniform(0, 6.28),
                elbow=elbow, height_base=116,
            )

    for tx, ty, sh in back_tassels:
        max_sp = min(tassel_spread_base * rng.uniform(0.75, 1.08), min(tx - edge_margin, pw - edge_margin - tx) * 0.85)
        paint_tassel(canvas, tx, ty + 7 * SS, height=ph * rng.uniform(0.13, 0.19), spread=max(20.0 * SS, max_sp), shade=sh * 0.96, rng=rng)

    # ---- PASS 2: Sunlit foreground hero stalks ----
    front_cobs = []
    front_tassels = []
    for i in range(n_front):
        t_pos = 0.5 if n_front == 1 else (i + 0.12) / (n_front - 0.76)
        sx = lerp(x_inset * 1.08, pw - x_inset * 1.08, clamp(t_pos, 0.0, 1.0)) + rng.uniform(-px_per_meter * 0.04, px_per_meter * 0.04)
        sx = clamp(sx, x_inset, pw - x_inset)
        y_top = ph * rng.uniform(0.15, 0.22)
        lean = rng.uniform(-14.0, 14.0) * (SS * 0.5)
        shade = rng.uniform(0.92, 1.08)

        nodes, top_pt = paint_segmented_stalk(
            canvas, sx, ph, y_top, y_ground,
            radius_base=stalk_r_base * rng.uniform(0.95, 1.12),
            radius_top=stalk_r_top * rng.uniform(0.95, 1.12),
            lean_x=lean, shade=shade, rng=rng,
        )
        front_tassels.append((top_pt[0], top_pt[1], shade))

        start_side = 1.0 if ((i + seed) % 2 == 0) else -1.0
        cob_placed = False
        for ni, (nx, ny, f_up) in enumerate(nodes):
            side = start_side if (ni % 2 == 0) else -start_side
            b_col = leaf_base_lit if f_up > 0.52 else leaf_base_mid
            t_col = leaf_tip_lit if f_up > 0.52 else leaf_tip_mid
            if f_up < 0.15 and rng.random() < 0.5:
                t_col = dry_tip

            want_len = leaf_len_base * rng.uniform(0.80, 1.18) * (0.82 + 0.28 * math.sin(math.pi * max(0.12, f_up)))
            l_len = safe_leaf_length(nx, side, want_len, pw, edge_margin)
            l_w = leaf_w_base * rng.uniform(0.85, 1.12) * clamp(l_len / want_len, 0.65, 1.0)
            launch = rng.uniform(28.0, 68.0) + f_up * 10.0
            droop = rng.uniform(0.45, 1.02) * (1.16 - 0.38 * f_up)
            elbow = rng.uniform(0.15, 0.62) if rng.random() < 0.5 else 0.0

            paint_maize_leaf(
                canvas, nx, ny, l_len, l_w, side, launch, droop,
                b_col, t_col, midrib_pale,
                shade=shade * rng.uniform(0.94, 1.08),
                wavy_phase=rng.uniform(0, 6.28),
                elbow=elbow, height_base=160,
            )

            if 0.22 < f_up < 0.78 and rng.random() < 0.52:
                want_len2 = want_len * rng.uniform(0.68, 0.86)
                l_len2 = safe_leaf_length(nx, -side, want_len2, pw, edge_margin)
                paint_maize_leaf(
                    canvas, nx, ny - 5 * SS, l_len2, l_w * 0.84, -side,
                    launch + rng.uniform(-10, 12), droop * rng.uniform(0.75, 1.05),
                    leaf_base_mid, leaf_tip_mid, midrib_pale,
                    shade=shade * 0.88, wavy_phase=rng.uniform(0, 6.28),
                    elbow=rng.uniform(0.0, 0.45), height_base=148,
                )

            # Hero mid-stalk corn cobs (ensure clean margin from panel borders!)
            if not cob_placed and 0.34 <= f_up <= 0.58:
                want_cob = (n_front <= 3 and i in (0, 1, 2) and (i % 2 == (seed % 2) or i == 1)) or (n_front > 3 and i in (1, 2, 3, 4))
                if want_cob:
                    cob_side = 1.0 if nx < pw * 0.5 else -1.0  # angle inward away from panel edges!
                    cob_placed = True
                    peek = (i % 2 == 1)
                    front_cobs.append((nx + cob_side * 4.5 * SS, ny + 4.0 * SS, cob_side, shade, peek))

        for fl_side in (-1.0, 1.0):
            fl_len = safe_leaf_length(top_pt[0], fl_side, leaf_len_base * rng.uniform(0.45, 0.65), pw, edge_margin)
            paint_maize_leaf(
                canvas, top_pt[0], top_pt[1] + ph * 0.04,
                fl_len, leaf_w_base * 0.66, fl_side,
                rng.uniform(52.0, 74.0), rng.uniform(0.28, 0.60),
                leaf_base_lit, leaf_tip_lit, midrib_pale,
                shade=shade * 1.06, wavy_phase=rng.uniform(0, 6.28),
                elbow=0.14, height_base=172,
            )

    for cx, cy, cside, csh, peek in front_cobs:
        paint_corn_cob(
            canvas, cx, cy, cside,
            cob_len=cob_len_base * rng.uniform(0.92, 1.12),
            cob_rad=cob_rad_base * rng.uniform(0.92, 1.12),
            shade=csh * 1.04, rng=rng, peek_kernels=peek,
        )

    for tx, ty, sh in front_tassels:
        max_sp = min(tassel_spread_base * rng.uniform(0.82, 1.15), min(tx - edge_margin, pw - edge_margin - tx) * 0.88)
        paint_tassel(canvas, tx, ty + 5 * SS, height=ph * rng.uniform(0.14, 0.20), spread=max(22.0 * SS, max_sp), shade=sh * 1.04, rng=rng)

    return canvas


def build_overhead_rosette_panel(pw: int, ph: int, seed: int) -> BotanicalCanvas:
    """
    Paint a deep-green, lush, zero-crop overhead maize crown strip:
      - Tapered gracefully inside ALL 4 panel margins so domed overhead canopy cards have
        soft organic leaf silhouettes from every camera angle!
    """
    canvas = BotanicalCanvas(pw, ph)
    rng = random.Random(seed)
    cy_mid = ph * 0.5
    mx, my = 14.0 * SS, 10.0 * SS

    whorls = []
    for k in range(5):
        wx = lerp(pw * 0.15, pw * 0.85, k / 4.0) + rng.uniform(-pw * 0.02, pw * 0.02)
        wy = cy_mid + rng.uniform(-ph * 0.05, ph * 0.05)
        whorls.append((wx, wy))

    def paint_flowing_overhead_leaf(cx, cy, angle_rad, want_len, width, c_base, c_tip, c_midrib, shade, h_base):
        ca, sa = math.cos(angle_rad), math.sin(angle_rad)
        # Gracefully cap leaf length so NO leaf tip ever clips a panel edge!
        max_l = want_len
        if ca > 0.05:
            max_l = min(max_l, (pw - mx - cx) / ca)
        elif ca < -0.05:
            max_l = min(max_l, (cx - mx) / (-ca))
        if sa > 0.05:
            max_l = min(max_l, (ph - my - cy) / sa)
        elif sa < -0.05:
            max_l = min(max_l, (cy - my) / (-sa))
        length = max(18.0 * SS, max_l * 0.94)

        n_seg = 16
        nx_dir, ny_dir = -sa, ca
        bend1 = rng.uniform(-0.22, 0.22) * length
        bend2 = rng.uniform(-0.12, 0.12) * length

        spine = []
        for i in range(n_seg + 1):
            t = i / n_seg
            curve = bend1 * (t ** 1.65) + bend2 * math.sin(math.pi * t)
            spine.append((cx + ca * length * t + nx_dir * curve, cy + sa * length * t + ny_dir * curve))

        u_edge, l_edge = [], []
        for i in range(n_seg + 1):
            i0, i1 = max(0, i - 1), min(n_seg, i + 1)
            dx = spine[i1][0] - spine[i0][0]
            dy = spine[i1][1] - spine[i0][1]
            d = math.hypot(dx, dy) + 1e-6
            pnx, pny = -dy / d, dx / d
            t = i / n_seg
            hw = width * 0.5 * (math.sin(math.pi * (t ** 0.65)) * 0.96 + 0.30 * math.exp(-t * 6.5))
            ruff = 1.0 + 0.10 * math.sin(t * 10.0 + angle_rad) * math.sin(math.pi * t)
            u_edge.append((spine[i][0] + pnx * hw * ruff, spine[i][1] + pny * hw * ruff))
            l_edge.append((spine[i][0] - pnx * hw * ruff, spine[i][1] - pny * hw * ruff))

        for i in range(n_seg):
            t = (i + 0.5) / n_seg
            gleam = 1.0 + 0.12 * math.exp(-((t - 0.45) / 0.25) ** 2)
            cm = scale_rgb(lerp_rgb(c_base, c_tip, t), shade * gleam)
            canvas.draw_polygon([spine[i], spine[i + 1], u_edge[i + 1], u_edge[i]], scale_rgb(cm, 1.08), h_val=h_base + 15)
            canvas.draw_polygon([spine[i], l_edge[i], l_edge[i + 1], spine[i + 1]], scale_rgb(cm, 0.84), h_val=h_base - 10)

        for i in range(n_seg - 2):
            t = i / n_seg
            mw = max(1, int(round(lerp(width * 0.12, 1.0, t ** 0.65))))
            canvas.draw_line(
                [spine[i], spine[i + 1]],
                scale_rgb(lerp_rgb(c_midrib, c_tip, min(1.0, t * 0.68)), shade * 1.03),
                width=mw, h_val=min(255, h_base + 45),
            )

    # Rich deep chlorophyll tones matching vertical panels so aerial views look lush and cohesive!
    for wx, wy in whorls:
        rot0 = rng.uniform(0, math.pi * 2)
        for j in range(8):
            ang = rot0 + (j / 8.0) * math.pi * 2 + rng.uniform(-0.26, 0.26)
            paint_flowing_overhead_leaf(
                wx, wy, ang, ph * rng.uniform(0.32, 0.44), ph * rng.uniform(0.10, 0.14),
                (30, 66, 20), (58, 102, 28), (138, 166, 92),
                shade=rng.uniform(0.72, 0.86), h_base=122,
            )

    for wx, wy in whorls:
        rot0 = rng.uniform(0, math.pi * 2)
        for j in range(7):
            ang = rot0 + (j / 7.0) * math.pi * 2 + rng.uniform(-0.26, 0.26)
            paint_flowing_overhead_leaf(
                wx, wy, ang, ph * rng.uniform(0.28, 0.41), ph * rng.uniform(0.09, 0.13),
                (48, 96, 28), (94, 138, 42), (168, 194, 114),
                shade=rng.uniform(0.92, 1.08), h_base=168,
            )

    # Subtle feathery golden tassel core at each whorl (natural, not overpowering the green!)
    for wx, wy in whorls:
        canvas.draw_ellipse([wx - 7 * SS, wy - 7 * SS, wx + 7 * SS, wy + 7 * SS], (36, 66, 20, 255), h_val=145)
        n_sprays = rng.randint(6, 8)
        for r in range(n_sprays):
            ang = (r / n_sprays) * math.pi * 2 + rng.uniform(-0.32, 0.32)
            r_len = ph * rng.uniform(0.07, 0.13)
            curve = rng.uniform(-0.24, 0.24) * r_len
            ca, sa = math.cos(ang), math.sin(ang)
            pts = [(wx + ca * r_len * (s / 5.0) - sa * curve * ((s / 5.0) ** 1.6),
                    wy + sa * r_len * (s / 5.0) + ca * curve * ((s / 5.0) ** 1.6)) for s in range(6)]
            canvas.draw_line(pts, (176, 146, 78, 255), width=max(1, int(1.2 * SS)), h_val=204)
            for s in range(1, len(pts)):
                px, py = pts[s]
                for side_f in (-1.0, 1.0):
                    ex = px + (ca * 0.5 - sa * side_f * 0.7) * 4.5 * SS
                    ey = py + (sa * 0.5 + ca * side_f * 0.7) * 4.5 * SS
                    c = lerp_rgb((176, 144, 76), (228, 206, 136), rng.uniform(0.2, 1.0))
                    canvas.draw_line([(px, py), (ex, ey)], c, width=max(1, int(1.3 * SS)), h_val=222)

    return canvas


def dilate_rgb_into_transparent(rgba_img: Image.Image, iterations: int = 10) -> Image.Image:
    arr = np.array(rgba_img, dtype=np.uint8)
    alpha = arr[:, :, 3].copy()
    mask = alpha >= 96
    rgb = arr[:, :, :3].copy()

    known = mask.copy()
    for _ in range(iterations):
        padded_rgb = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode="edge")
        padded_k = np.pad(known, ((1, 1), (1, 1)), mode="constant", constant_values=False)

        sum_rgb = np.zeros((arr.shape[0], arr.shape[1], 3), dtype=np.int32)
        cnt = np.zeros((arr.shape[0], arr.shape[1]), dtype=np.int32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nk = padded_k[1 + dy : 1 + dy + arr.shape[0], 1 + dx : 1 + dx + arr.shape[1]]
            nrgb = padded_rgb[1 + dy : 1 + dy + arr.shape[0], 1 + dx : 1 + dx + arr.shape[1]]
            sum_rgb += nrgb * nk[:, :, None]
            cnt += nk.astype(np.int32)

        fill = (~known) & (cnt > 0)
        if not np.any(fill):
            break
        rgb[fill] = (sum_rgb[fill] // cnt[fill, None]).astype(np.uint8)
        known[fill] = True

    rgb[~known] = (54, 86, 30)
    alpha = np.where(alpha < 32, 0, np.where(alpha > 224, 255, alpha)).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), mode="RGBA")


def height_to_normal_map(height_img: Image.Image, strength: float = 2.4) -> Image.Image:
    h_small = height_img.resize((512, 512), Image.LANCZOS).filter(ImageFilter.GaussianBlur(radius=0.6))
    h = np.array(h_small, dtype=np.float32) / 255.0

    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength

    nx = -gx
    ny = gy
    nz = np.ones_like(h)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)

    r = np.clip((nx * inv_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    g = np.clip((ny * inv_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    b = np.clip((nz * inv_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([r, g, b]), mode="RGB")


def save_compact_rgba_png(rgba_img: Image.Image, out_path: str):
    q = rgba_img.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    q.save(out_path, format="PNG", optimize=True)


def main():
    # Physical scale consistency: 2.35m vertical height = 676*SS px => ~287.6*SS px/meter!
    px_per_m = (676 * SS) / 2.35

    # Panel A  (2.05m wide longitudinal stand): 450 x 676 final px
    p_a  = build_stand_panel(450 * SS, 676 * SS, n_back=5, n_front=5, seed=2026, px_per_meter=px_per_m)
    # Panel B1 (1.05m wide cross-baffle var 1): 266 x 676 final px (100% zero-crop silhouette!)
    p_b1 = build_stand_panel(266 * SS, 676 * SS, n_back=3, n_front=3, seed=5147, px_per_meter=px_per_m)
    # Panel B2 (1.05m wide cross-baffle var 2): 268 x 676 final px (100% zero-crop silhouette!)
    p_b2 = build_stand_panel(268 * SS, 676 * SS, n_back=3, n_front=3, seed=8931, px_per_meter=px_per_m)

    # Panels C & D (overhead crown rosettes): 502 x 328 final px each
    p_c  = build_overhead_rosette_panel(502 * SS, 328 * SS, seed=4119)
    p_d  = build_overhead_rosette_panel(502 * SS, 328 * SS, seed=8823)

    atlas_c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    atlas_h = Image.new("L", (W, H), 0)

    placements = [
        (p_a,  0,        0),
        (p_b1, 470 * SS, 0),
        (p_b2, 756 * SS, 0),
        (p_c,  0,        696 * SS),
        (p_d,  522 * SS, 696 * SS),
    ]
    for panel, ox, oy in placements:
        atlas_c.paste(panel.albedo, (ox, oy))
        atlas_h.paste(panel.height_img, (ox, oy))

    albedo_1k = atlas_c.resize((FINAL_W, FINAL_H), Image.LANCZOS)

    rng_np = np.random.default_rng(1337)
    arr = np.array(albedo_1k, dtype=np.int16)
    mottle_small = rng_np.normal(0.0, 4.0, (FINAL_H // 8, FINAL_W // 8)).astype(np.float32)
    mottle_img = Image.fromarray(np.clip(mottle_small + 128, 0, 255).astype(np.uint8)).resize((FINAL_W, FINAL_H), Image.BILINEAR)
    mottle = np.array(mottle_img, dtype=np.int16) - 128
    opaque = arr[:, :, 3] > 32
    for ch, wt in ((0, 0.7), (1, 1.0), (2, 0.45)):
        arr[:, :, ch] = np.where(opaque, np.clip(arr[:, :, ch] + (mottle * wt).astype(np.int16), 0, 255), arr[:, :, ch])

    albedo_clean = dilate_rgb_into_transparent(Image.fromarray(arr.astype(np.uint8), mode="RGBA"), iterations=10)

    albedo_path = os.path.join(OUT_DIR, "corn_maize_albedo.png")
    normal_path = os.path.join(OUT_DIR, "corn_maize_normal.jpg")

    save_compact_rgba_png(albedo_clean, albedo_path)

    normal_map = height_to_normal_map(atlas_h, strength=2.2)
    normal_map.save(normal_path, format="JPEG", quality=84, optimize=True)

    bg_dark = Image.new("RGBA", (FINAL_W, FINAL_H), (34, 42, 52, 255))
    preview = Image.alpha_composite(bg_dark, Image.open(albedo_path).convert("RGBA")).convert("RGB")
    preview_path = os.path.join(OUT_DIR, "_debug_atlas_preview.png")
    preview.save(preview_path, format="PNG", optimize=True)

    print(f"Generated {albedo_path}: {os.path.getsize(albedo_path)/1024:.1f} KB")
    print(f"Generated {normal_path}: {os.path.getsize(normal_path)/1024:.1f} KB")
    print(f"Combined texture budget: {(os.path.getsize(albedo_path)+os.path.getsize(normal_path))/1024:.1f} KB")


if __name__ == "__main__":
    main()
