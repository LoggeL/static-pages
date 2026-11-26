"""
Kinderspielplatz Neugasse assets: tower with slide, swings, rope pyramid, carousel, seesaw, spring
riders, sandpit toys, pavilion, table-tennis table, park bench, bin, sign.
Fronts face -Y; pivoted children keep the node names src/recreation.ts animates
(`Swing_Left`, `Swing_Right`, `Swing_Nest`, `Carousel_Rotor`).
"""

from __future__ import annotations

import math

from mathutils import Vector

from rec_toolkit import fillet, lerp, mat4, smooth_closed

V = Vector
HALF_PI = math.pi * 0.5
PANEL_COLOURS = ["hdpe_red", "hdpe_blue", "hdpe_yellow", "hdpe_green", "hdpe_orange"]


def panel(m, key, center, size, rot=(0.0, 0.0, 0.0), bolts=True):
    """19 mm HDPE play panel with rounded edge and four stainless bolt heads."""
    m.a(key).box(center, size, rot=rot, bevel=0.007)
    if not bolts:
        return
    cx, cy, cz = center
    thin = min(range(3), key=lambda i: size[i])
    if rot != (0.0, 0.0, 0.0) or thin == 2:
        return
    st = m.a("steel_stainless")
    a, b = [i for i in range(3) if i != thin]
    for sa in (-1, 1):
        for sb in (-1, 1):
            p = [cx, cy, cz]
            p[a] += sa * (size[a] * 0.5 - 0.06)
            p[b] += sb * (size[b] * 0.5 - 0.06)
            for sgn in (-1, 1):
                q = list(p)
                q[thin] += sgn * size[thin] * 0.5
                axis = [0.0, 0.0, 0.0]
                axis[thin] = float(sgn)
                st.bolt(q, axis=axis, radius=0.011, height=0.006)


def rope_net(m, key, p00, p10, p01, p11, nu, nv, radius=0.009, knots="hdpe_black"):
    """Rectangular rope net between four corners (bilinear), with clamps at the crossings."""
    rope = m.a(key)
    p00, p10, p01, p11 = V(p00), V(p10), V(p01), V(p11)

    def pt(s, t):
        return p00.lerp(p10, s).lerp(p01.lerp(p11, s), t)

    for i in range(nu + 1):
        rope.tube([pt(i / nu, j / nv) for j in range(nv + 1)], radius, segs=5)
    for j in range(nv + 1):
        rope.tube([pt(i / nu, j / nv) for i in range(nu + 1)], radius, segs=5)
    if knots:
        kn = m.a(knots)
        for i in range(nu + 1):
            for j in range(nv + 1):
                kn.sphere(pt(i / nu, j / nv), radius * 2.0, segs=6, rings=4)


# ---------------------------------------------------------------------------
# Play tower with slide
# ---------------------------------------------------------------------------

def build_tower(m):
    wood, plank, galv, st = m.a("wood_robinia"), m.a("wood_plank"), m.a("steel_galv"), m.a("steel_stainless")
    mx, my, hw = -0.65, 0.35, 0.92
    deck, eave = 1.70, 3.15

    # main tower: posts, deck, roof
    for sx in (-hw, hw):
        for sy in (-hw, hw):
            wood.post((mx + sx, my + sy, -0.65), (mx + sx, my + sy, eave + 0.18), 0.085, chamfer=0.02, segs=12, taper=0.06)
    for sy in (-0.78, 0.0, 0.78):
        wood.beam((mx - hw - 0.1, my + sy, deck - 0.12), (mx + hw + 0.1, my + sy, deck - 0.12), 0.08, 0.14, bevel=0.01)
    for i in range(10):
        plank.box((mx - 0.828 + i * 0.184, my, deck - 0.02), (0.176, 1.84, 0.04), bevel=0.006)
    for sy in (-hw, hw):
        wood.beam((mx - hw - 0.2, my + sy, eave), (mx + hw + 0.2, my + sy, eave), 0.09, 0.12, bevel=0.01)
    ridge_z, half = eave + 0.86, hw + 0.3
    theta = math.atan2(ridge_z - eave + 0.06, half)
    slope_len = math.hypot(half, ridge_z - eave + 0.06)
    for sgn in (-1, 1):
        for k in range(7):
            d = (k + 0.5) * slope_len / 7
            plank.box((mx, my + sgn * d * math.cos(theta), ridge_z - d * math.sin(theta) + (k % 2) * 0.014),
                      (2.5, slope_len / 7 + 0.03, 0.024), rot=(-sgn * theta, 0, 0), bevel=0.004)
        for sx in (-hw, hw):
            wood.beam((mx + sx, my + sgn * 0.02, ridge_z - 0.07), (mx + sx, my + sgn * half * 0.98, eave - 0.01), 0.07, 0.09, bevel=0.008)
    m.a("hdpe_red").box((mx, my, ridge_z + 0.02), (2.54, 0.12, 0.05), bevel=0.012)
    for sx, key in ((-hw, "hdpe_yellow"), (hw, "hdpe_yellow")):
        m.a(key).prism([(-0.86, eave + 0.07), (0.86, eave + 0.07), (0.0, ridge_z - 0.1)], 0.019, mat4((mx + sx, my, 0), (0, 0, HALF_PI)), bevel=0.005)
    galv.cyl((mx + 1.2, my, ridge_z), (mx + 1.2, my, ridge_z + 0.6), 0.012, segs=6)
    m.a("hdpe_red").prism([(0.0, 0.0), (0.34, 0.09), (0.0, 0.18)], 0.006, mat4((mx + 1.21, my, ridge_z + 0.4), (0, 0, 0.2)))

    # balustrades: coloured HDPE panels + round top rails
    rail_z = deck + 0.92
    wood.post((mx - hw, my + hw, rail_z), (mx + hw, my + hw, rail_z), 0.04, segs=8)
    panel(m, "hdpe_blue", (mx, my + hw, deck + 0.46), (1.6, 0.019, 0.74))
    wood.post((mx - hw, my - hw, rail_z), (mx - hw, my + hw, rail_z), 0.04, segs=8)
    for sy, key in ((-0.62, "hdpe_green"), (0.62, "hdpe_green")):
        panel(m, key, (mx - hw, my + sy, deck + 0.46), (0.019, 0.42, 0.74))
    wood.post((mx + hw, my - hw, rail_z), (mx + hw, my + hw, rail_z), 0.04, segs=8)
    for sy in (-0.64, 0.64):
        panel(m, "hdpe_orange", (mx + hw, my + sy, deck + 0.46), (0.019, 0.4, 0.74))
    for sx in (-0.62, 0.62):
        panel(m, "hdpe_red", (mx + sx, my - hw, deck + 0.46), (0.5, 0.019, 0.74))
    st.pipe([(mx - 0.37, my - hw, deck + 0.3), (mx - 0.37, my - hw - 0.1, deck + 0.88), (mx + 0.37, my - hw - 0.1, deck + 0.88), (mx + 0.37, my - hw, deck + 0.3)], 0.017, bend=0.1, segs=8)

    # stainless slide (swept trough + rolled rims)
    y0 = my - hw + 0.06
    path = fillet([V((mx, y0, deck + 0.012)), V((mx, y0 - 0.42, deck + 0.012)), V((mx, y0 - 0.42 - 1.76, 0.42)), V((mx, y0 - 3.3, 0.31))], 0.75, 9)
    w = 0.25
    prof = [(-w - 0.022, 0.15), (-w, 0.0), (w, 0.0), (w + 0.022, 0.15), (w + 0.03, 0.15), (w + 0.006, -0.008), (-w - 0.006, -0.008), (-w - 0.03, 0.15)]
    st.sweep(path, prof, side=(-1, 0, 0), closed_profile=True)
    for sgn in (-1, 1):
        rim = []
        for i, p in enumerate(path):
            t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            up = V((-1, 0, 0)).cross(t).normalized()
            rim.append(p + V((sgn * (w + 0.026), 0, 0)) + up * 0.152)
        st.tube(rim, 0.012, segs=6)
    st.box((mx, path[0].y + 0.02, deck + 0.005), (0.6, 0.1, 0.012))
    mid = path[len(path) // 2 + 1]
    for sgn in (-1, 1):
        galv.cyl((mx + sgn * 0.2, mid.y, mid.z - 0.02), (mx + sgn * 0.26, mid.y - 0.04, -0.3), 0.022, segs=8)
    galv.cyl((mx - 0.23, mid.y - 0.02, mid.z * 0.45), (mx + 0.23, mid.y - 0.02, mid.z * 0.45), 0.016, segs=6)
    galv.cyl((mx, path[-1].y + 0.25, 0.3), (mx, path[-1].y + 0.25, -0.3), 0.022, segs=8)

    # lower platform
    sx2, sy2, hw2, deck2 = 1.85, 0.35, 0.62, 1.18
    for dx in (-hw2, hw2):
        for dy in (-hw2, hw2):
            wood.post((sx2 + dx, sy2 + dy, -0.65), (sx2 + dx, sy2 + dy, deck2 + 1.05), 0.075, chamfer=0.018, segs=12, taper=0.05)
    for dy in (-0.5, 0.5):
        wood.beam((sx2 - hw2 - 0.08, sy2 + dy, deck2 - 0.11), (sx2 + hw2 + 0.08, sy2 + dy, deck2 - 0.11), 0.07, 0.12, bevel=0.008)
    for i in range(7):
        plank.box((sx2 - 0.552 + i * 0.184, sy2, deck2 - 0.02), (0.176, 1.24, 0.04), bevel=0.006)
    r2 = deck2 + 0.9
    wood.post((sx2 + hw2, sy2 - hw2, r2), (sx2 + hw2, sy2 + hw2, r2), 0.036, segs=8)
    wood.post((sx2 - hw2, sy2 + hw2, r2), (sx2 + hw2, sy2 + hw2, r2), 0.036, segs=8)
    wood.post((sx2 - hw2, sy2 - hw2, r2), (sx2 + hw2, sy2 - hw2, r2), 0.036, segs=8)
    panel(m, "hdpe_blue", (sx2 + hw2, sy2 + 0.2, deck2 + 0.45), (0.019, 0.7, 0.72))
    # ramp bridge with cleats and rope handrails
    xa, xb = mx + hw + 0.02, sx2 - hw2 - 0.02
    for sy in (-0.4, 0.4):
        wood.beam((xa - 0.1, my + sy, deck - 0.1), (xb + 0.1, sy2 + sy, deck2 - 0.1), 0.07, 0.1, bevel=0.008)
    for s in range(6):
        t = (s + 0.5) / 6
        plank.box((lerp(xa, xb, t), my, lerp(deck, deck2, t) - 0.03), (0.2, 1.0, 0.035), rot=(0, math.atan2(deck - deck2, xb - xa), 0), bevel=0.005)
        plank.box((lerp(xa, xb, t), my, lerp(deck, deck2, t) + 0.0), (0.035, 0.9, 0.025), rot=(0, math.atan2(deck - deck2, xb - xa), 0), bevel=0.005)
    for sy in (-0.52, 0.52):
        mid_p = V(((xa + xb) * 0.5, my + sy, (deck + deck2) * 0.5 + 0.72))
        m.a("rope_hemp").tube(fillet([V((mx + hw, my + sy * 1.6, deck + 0.9)), mid_p, V((sx2 - hw2, sy2 + sy * 1.1, deck2 + 0.88))], 0.4, 5), 0.014, segs=6)

    # climbing wall (west)
    foot, top = V((mx - hw - 0.98, my, 0.0)), V((mx - hw - 0.06, my, deck - 0.02))
    for i in range(6):
        y = my - 0.46 + i * 0.184
        plank.beam(foot + V((0, y - my, -0.25)), top + V((0, y - my, 0)), 0.176, 0.036, bevel=0.005)
    for sy in (-0.6, 0.6):
        wood.post(foot + V((0.05, sy, -0.3)), top + V((0.04, sy, 0.02)), 0.05, segs=8)
    d = (top - foot).normalized()
    nrm = V((-d.z, 0, d.x))
    holds = [(0.12, -0.3), (0.2, 0.22), (0.3, -0.05), (0.38, 0.36), (0.46, -0.36), (0.55, 0.1), (0.63, -0.2), (0.72, 0.3), (0.8, -0.34), (0.88, 0.02), (0.94, 0.34)]
    for i, (t, y) in enumerate(holds):
        p = foot.lerp(top, t) + V((0, y, 0)) + nrm * 0.035
        m.a(PANEL_COLOURS[i % 5]).sphere(p, 0.055, scale=(1.0 + 0.3 * (i % 3), 1.0, 0.62 + 0.1 * (i % 2)), segs=8, rings=5, rot=(0, -math.atan2(d.z, d.x) + HALF_PI, i * 1.1))

    # climbing net (north of lower platform)
    ny, nz = sy2 + hw2, deck2 - 0.02
    by = ny + 1.25
    for sx in (-0.56, 0.56):
        wood.post((sx2 + sx, ny + 0.02, nz), (sx2 + sx, by, -0.3), 0.05, segs=8)
    wood.post((sx2 - 0.7, by - 0.04, 0.06), (sx2 + 0.7, by - 0.04, 0.06), 0.055, segs=8)
    rope_net(m, "rope_black", (sx2 - 0.5, ny + 0.03, nz), (sx2 + 0.5, ny + 0.03, nz), (sx2 - 0.5, by - 0.06, 0.12), (sx2 + 0.5, by - 0.06, 0.12), 5, 6)

    # fireman's pole (east) and ladder (south)
    px, py = sx2 + hw2 + 0.5, sy2 - 0.25
    st.pipe([(px, py, -0.4), (px, py, deck2 + 1.18), (sx2 + hw2 - 0.02, py - 0.33, deck2 + 1.0)], 0.021, bend=0.16, segs=10)
    for sx in (-0.3, 0.3):
        wood.beam((sx2 + sx, sy2 - hw2 - 0.04, deck2 - 0.02), (sx2 + sx, sy2 - hw2 - 0.6, -0.25), 0.05, 0.11, bevel=0.008)
    for r in range(5):
        t = (r + 0.7) / 5.6
        wood.post((sx2 - 0.3, sy2 - hw2 - 0.04 - t * 0.56, (deck2 - 0.02) * (1 - t) - 0.25 * t), (sx2 + 0.3, sy2 - hw2 - 0.04 - t * 0.56, (deck2 - 0.02) * (1 - t) - 0.25 * t), 0.02, segs=8)


# ---------------------------------------------------------------------------
# Swings
# ---------------------------------------------------------------------------

def build_swings(m):
    wood, galv = m.a("wood_robinia"), m.a("steel_galv")
    beam_z = 2.66
    for lx in (-3.4, 0.85, 3.4):
        for sy in (-1.25, 1.25):
            wood.post((lx, sy, -0.55), (lx, sy * 0.07, beam_z - 0.06), 0.072, chamfer=0.02, segs=12, taper=0.05)
        galv.box((lx, 0, beam_z - 0.03), (0.2, 0.36, 0.2), bevel=0.02)
        for sy in (-0.12, 0.12):
            for bz in (-0.08, 0.02):
                galv.bolt((lx + 0.1, sy, beam_z + bz), axis=(1, 0, 0), radius=0.014)
                galv.bolt((lx - 0.1, sy, beam_z + bz), axis=(-1, 0, 0), radius=0.014)
    galv.tube([(-3.66, 0, beam_z), (3.66, 0, beam_z)], 0.052, segs=14)

    def hanger(x):
        galv.box((x, 0, beam_z - 0.065), (0.05, 0.11, 0.04), bevel=0.006)
        galv.torus((0, 0, 0), 0.018, 0.006, major_segs=10, minor_segs=5, matrix=mat4((x, 0, beam_z - 0.1), (HALF_PI, 0, 0)))

    def belt_swing(name, px):
        c = m.child(name, (px, 0.0, beam_z))
        zs = beam_z - 2.12
        for sx in (-1, 1):
            hanger(px + sx * 0.25)
            c.a("chain").strip_cross((px + sx * 0.25, 0, beam_z - 0.11), (px + sx * 0.235, 0, zs + 0.2), 0.034, 0.14)
            for sy in (-0.07, 0.07):
                c.a("steel_galv").cyl((px + sx * 0.235, 0, zs + 0.2), (px + sx * 0.225, sy, zs + 0.012), 0.005, segs=5)
        n = 10
        top = [(-0.235 + 0.47 * i / n, zs - 0.055 * math.sin(math.pi * i / n) + 0.008) for i in range(n + 1)]
        outline = top + [(x, z - 0.016) for (x, z) in reversed(top)]
        c.a("rubber").prism(outline, 0.17, mat4((px, 0, 0)), bevel=0.004)
        for sx in (-1, 1):
            c.a("steel_galv").box((px + sx * 0.225, 0, zs + 0.004), (0.03, 0.17, 0.02), bevel=0.004)

    belt_swing("Swing_Left", -2.25)
    belt_swing("Swing_Right", -0.45)

    nx, r_n = 2.15, 0.56
    c = m.child("Swing_Nest", (nx, 0.0, beam_z))
    zc = beam_z - 2.02
    for sx in (-1, 1):
        hanger(nx + sx * 0.45)
        for sy in (-1, 1):
            c.a("rope_blue").tube([(nx + sx * 0.45, 0, beam_z - 0.11), (nx + sx * r_n * 0.71, sy * r_n * 0.71, zc + 0.04)], 0.011, segs=6)
    c.a("rope_blue").torus((nx, 0, zc), r_n, 0.052, major_segs=28, minor_segs=8)
    net = c.a("rope_black")
    dip = 0.09
    for i in range(6):
        a = i * math.pi / 6
        ca, sa = math.cos(a) * r_n * 0.95, math.sin(a) * r_n * 0.95
        net.tube([(nx + ca, sa, zc), (nx + ca * 0.5, sa * 0.5, zc - dip * 0.75), (nx, 0, zc - dip), (nx - ca * 0.5, -sa * 0.5, zc - dip * 0.75), (nx - ca, -sa, zc)], 0.008, segs=5)
    for f in (0.33, 0.66):
        net.torus((nx, 0, zc - dip * (1 - f * f)), r_n * f, 0.008, major_segs=18, minor_segs=5)


# ---------------------------------------------------------------------------
# Rope pyramid
# ---------------------------------------------------------------------------

def build_pyramid(m):
    galv, conc = m.a("steel_galv"), m.a("concrete")
    H, R, tiers = 3.8, 2.55, 7
    galv.lathe([(0.11, 0.0), (0.11, 0.02), (0.07, 0.03), (0.062, H - 0.05), (0.07, H - 0.04), (0.07, H), (0.0, H)], segs=12)
    galv.cyl((0, 0, -0.6), (0, 0, 0.0), 0.07, segs=10)
    conc.box((0, 0, -0.03), (0.6, 0.6, 0.1), bevel=0.02)
    m.a("hdpe_red").sphere((0, 0, H + 0.1), 0.13, segs=12, rings=7)
    apex = V((0, 0, H - 0.1))
    corners = []
    for k in range(4):
        a = k * HALF_PI + math.pi * 0.25
        c = V((math.cos(a) * R, math.sin(a) * R, 0.1))
        corners.append(c)
        conc.box((c.x, c.y, -0.02), (0.42, 0.42, 0.1), rot=(0, 0, a), bevel=0.02)
        galv.cyl((c.x, c.y, 0.0), c, 0.02, segs=6)
        galv.torus((0, 0, 0), 0.03, 0.008, major_segs=8, minor_segs=4, matrix=mat4((c.x, c.y, 0.12), (HALF_PI, 0, a)))
        m.a("rope_blue").tube([apex, c], 0.011, segs=6)
    red, knot = m.a("rope_red"), m.a("steel_galv")

    def node(k, j, c0, c1):
        """j-th node (0..k) on tier k of the face between ridge ropes c0 and c1."""
        t = k / tiers
        a, b = apex.lerp(c0, t), apex.lerp(c1, t)
        return a.lerp(b, j / k) if k else apex

    for f in range(4):
        c0, c1 = corners[f], corners[(f + 1) % 4]
        for k in range(1, tiers + 1):
            red.tube([node(k, j, c0, c1) for j in range(k + 1)], 0.008, segs=5)
            if k < tiers:
                for j in range(k + 1):
                    red.tube([node(k, j, c0, c1), node(k + 1, j + 1, c0, c1)], 0.008, segs=5, caps=False) if j < k else None
                    red.tube([node(k, j, c0, c1), node(k + 1, j, c0, c1)], 0.008, segs=5, caps=False) if j > 0 else None
            for j in range(0 if f == 0 else 1, k + 1):
                if j == k and f == 3:
                    continue
                knot.sphere(node(k, j, c0, c1), 0.019, segs=6, rings=4)
    # inner floor net 0.5 m above ground
    for k in range(4):
        m.a("rope_blue").tube([V((0, 0, 0.62)), apex.lerp(corners[k], 0.84)], 0.009, segs=5)
    galv.lathe([(0.085, 0.58), (0.085, 0.66), (0.0, 0.66)], segs=10)


# ---------------------------------------------------------------------------
# Carousel
# ---------------------------------------------------------------------------

def build_carousel(m):
    m.a("concrete").lathe([(0.0, -0.45), (0.5, -0.45), (0.5, 0.0), (0.46, 0.03), (0.0, 0.03)], segs=18)
    m.a("steel_dark").lathe([(0.0, 0.03), (0.2, 0.03), (0.2, 0.09), (0.14, 0.12), (0.0, 0.12)], segs=14)
    c = m.child("Carousel_Rotor", (0.0, 0.0, 0.0))
    c.a("alu_plate").lathe([(0.0, 0.125), (1.07, 0.125), (1.1, 0.14), (1.1, 0.185), (1.08, 0.195), (0.0, 0.195)], segs=32)
    c.a("rubber").torus((0, 0, 0.16), 1.1, 0.022, major_segs=32, minor_segs=6)
    for k in range(12):  # anti-slip ribs
        a = k * math.pi / 6
        c.a("alu_plate").box((math.cos(a) * 0.62, math.sin(a) * 0.62, 0.197), (0.7, 0.03, 0.006), rot=(0, 0, a))
    c.a("steel_galv").lathe([(0.075, 0.195), (0.075, 0.24), (0.048, 0.26), (0.048, 0.86), (0.0, 0.86)], segs=12)
    yel = c.a("paint_yellow")
    yel.torus((0, 0, 0.87), 0.27, 0.017, major_segs=24, minor_segs=7)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        yel.tube([(0, 0, 0.84), (math.cos(a) * 0.27, math.sin(a) * 0.27, 0.87)], 0.013, segs=6)
    for k in range(3):
        a = k * 2 * math.pi / 3
        ca, sa = math.cos(a), math.sin(a)
        key = ("hdpe_red", "hdpe_blue", "hdpe_green")[k]
        c.a(key).box((ca * 0.74, sa * 0.74, 0.5), (0.34, 0.52, 0.035), rot=(0, 0, a), bevel=0.012)
        c.a(key).box((ca * 0.93, sa * 0.93, 0.66), (0.03, 0.52, 0.24), rot=(0, 0, a), bevel=0.01)
        for dy in (-0.18, 0.18):
            bx, by = ca * 0.86 - sa * dy, sa * 0.86 + ca * dy
            c.a("steel_galv").pipe([(bx, by, 0.19), (bx, by, 0.49), (bx + ca * 0.09, by + sa * 0.09, 0.56), (bx + ca * 0.09, by + sa * 0.09, 0.76)], 0.017, bend=0.04, segs=7)
        a2 = a + math.pi / 3
        pts = []
        for da, z in ((-0.3, 0.19), (-0.3, 0.84), (0.3, 0.84), (0.3, 0.19)):
            pts.append((math.cos(a2 + da) * 0.98, math.sin(a2 + da) * 0.98, z))
        yel.pipe(pts, 0.02, bend=0.12, segs=8)
        yel.tube([(math.cos(a2) * 0.96, math.sin(a2) * 0.96, 0.84), (math.cos(a2) * 0.05, math.sin(a2) * 0.05, 0.7)], 0.015, segs=6)


# ---------------------------------------------------------------------------
# Seesaw
# ---------------------------------------------------------------------------

def build_seesaw(m):
    wood, dark, yel = m.a("wood_robinia"), m.a("steel_dark"), m.a("paint_yellow")
    tilt = math.radians(8.0)
    piv = 0.6
    B = mat4((0, 0, piv), (0, tilt, 0))
    m.a("concrete").box((0, 0, -0.05), (0.5, 0.5, 0.14), bevel=0.02)
    for sy in (-0.115, 0.115):
        dark.box((0, sy, 0.3), (0.09, 0.014, 0.74), bevel=0.004)
        dark.box((0, sy, 0.03), (0.2, 0.05, 0.02))
        m.a("steel_galv").bolt((0, sy + (0.007 if sy > 0 else -0.007), piv), axis=(0, 1 if sy > 0 else -1, 0), radius=0.022, height=0.012)
    m.a("steel_galv").cyl((0, -0.115, piv), (0, 0.115, piv), 0.016, segs=8)
    wood.post(B @ V((-1.78, 0, 0)), B @ V((1.78, 0, 0)), 0.078, chamfer=0.02, segs=12)
    dark.box((0, 0, 0), (0.3, 0.2, 0.17), bevel=0.01, matrix=B)
    for side, key in ((-1, "hdpe_red"), (1, "hdpe_blue")):
        m.a(key).box((side * 1.5, 0, 0.095), (0.4, 0.3, 0.036), bevel=0.014, matrix=B)
        m.a(key).box((side * 1.71, 0, 0.16), (0.03, 0.3, 0.16), bevel=0.012, matrix=B)
        hx = side * 1.14
        yel.tube([B @ V((hx, 0, 0.06)), B @ V((hx, 0, 0.46))], 0.017, segs=7)
        yel.pipe([B @ V((hx, -0.17, 0.4)), B @ V((hx, -0.17, 0.48)), B @ V((hx, 0.17, 0.48)), B @ V((hx, 0.17, 0.4))], 0.015, bend=0.035, segs=7)
        for sy in (-0.17, 0.17):
            m.a("hdpe_black").tube([B @ V((hx, sy, 0.38)), B @ V((hx, sy, 0.45))], 0.02, segs=7)
        m.a("steel_galv").tube([B @ V((side * 1.2, -0.2, -0.1)), B @ V((side * 1.2, 0.2, -0.1))], 0.014, segs=6)
        m.a("rubber").torus((0, 0, 0), 0.25, 0.09, major_segs=20, minor_segs=9, matrix=mat4((side * 1.62, 0, 0.05), (HALF_PI, 0, 0)))


# ---------------------------------------------------------------------------
# Spring riders
# ---------------------------------------------------------------------------

def _spring_base(m, spring_key):
    m.a("concrete").box((0, 0, -0.2), (0.42, 0.42, 0.4), bevel=0.02)
    m.a("steel_galv").box((0, 0, 0.012), (0.26, 0.26, 0.016), bevel=0.004)
    m.a(spring_key).helix((0, 0, 0.03), 0.085, 0.0125, 5.5, 0.34, per_turn=14, wire_segs=7)
    m.a("steel_galv").box((0, 0, 0.385), (0.2, 0.32, 0.016), bevel=0.004)
    for sy in (-0.12, 0.12):
        m.a("steel_galv").box((0, sy, 0.05), (0.2, 0.04, 0.06), bevel=0.006)
        m.a("steel_galv").box((0, sy, 0.36), (0.2, 0.04, 0.05), bevel=0.006)
    return 0.4


def _rider_common(m, z0, grip_x, grip_z, foot_x, foot_z, half_w=0.125):
    st, blk = m.a("steel_stainless"), m.a("hdpe_black")
    for (lx, lz, ln) in ((grip_x, grip_z, 0.2), (foot_x, foot_z, 0.21)):
        st.cyl((-ln, -lx, z0 + lz), (ln, -lx, z0 + lz), 0.012, segs=7)
        for sx in (-1, 1):
            blk.cyl((sx * (ln - 0.07), -lx, z0 + lz), (sx * (ln + 0.005), -lx, z0 + lz), 0.019, segs=8)
    for (lx, lz) in ((-0.2, 0.1), (0.2, 0.1)):
        st.cyl((-half_w, -lx, z0 + lz), (half_w, -lx, z0 + lz), 0.014, segs=6)


def build_spring_tractor(m):
    z0 = _spring_base(m, "paint_yellow")
    outline = [(-0.42, 0.0), (0.42, 0.0), (0.47, 0.05), (0.47, 0.27), (0.12, 0.30), (0.08, 0.34), (-0.30, 0.34), (-0.34, 0.52), (-0.42, 0.52), (-0.46, 0.30), (-0.46, 0.05)]
    for sx in (-0.125, 0.125):
        m.a("hdpe_red").prism(outline, 0.019, mat4((sx, 0, z0), (0, 0, -HALF_PI)), bevel=0.006)
        sgn = 1 if sx > 0 else -1
        for (wx, wz, wr, hub) in ((-0.2, 0.09, 0.2, 0.09), (0.3, 0.02, 0.125, 0.055)):
            m.a("hdpe_black").cyl((sx + sgn * 0.01, -wx, z0 + wz), (sx + sgn * 0.04, -wx, z0 + wz), wr, segs=18)
            m.a("hdpe_yellow").cyl((sx + sgn * 0.04, -wx, z0 + wz), (sx + sgn * 0.05, -wx, z0 + wz), hub, segs=12)
    m.a("hdpe_yellow").box((0, 0.11, z0 + 0.355), (0.232, 0.36, 0.03), bevel=0.01)
    m.a("hdpe_yellow").box((0, 0.3, z0 + 0.44), (0.232, 0.03, 0.18), bevel=0.01)
    m.a("hdpe_red").box((0, -0.3, z0 + 0.275), (0.232, 0.3, 0.02), bevel=0.006)   # hood top
    m.a("hdpe_black").cyl((0.06, -0.36, z0 + 0.28), (0.06, -0.36, z0 + 0.5), 0.016, segs=8)
    m.a("hdpe_black").torus((0, 0, 0), 0.085, 0.012, major_segs=14, minor_segs=6, matrix=mat4((0, -0.06, z0 + 0.5), (math.radians(60), 0, 0)))
    m.a("steel_stainless").cyl((0, -0.12, z0 + 0.34), (0, -0.06, z0 + 0.5), 0.011, segs=6)
    _rider_common(m, z0, 0.04, 0.44, 0.1, -0.02)


def build_spring_horse(m):
    """Pony spring rider: two router-cut HDPE side panels with rounded outline, saddle, mane, tail."""
    z0 = _spring_base(m, "paint_red")
    ctrl = [(-0.46, 0.10), (-0.42, -0.02), (-0.30, -0.07), (0.16, -0.07), (0.28, -0.02), (0.34, 0.10), (0.40, 0.26), (0.47, 0.34),
            (0.58, 0.32), (0.66, 0.36), (0.66, 0.44), (0.57, 0.52), (0.53, 0.64), (0.46, 0.56), (0.36, 0.50), (0.20, 0.36),
            (0.0, 0.30), (-0.22, 0.30), (-0.36, 0.34), (-0.48, 0.30), (-0.54, 0.16)]
    outline = smooth_closed(ctrl, 4)
    mane = smooth_closed([(0.18, 0.33), (0.32, 0.45), (0.44, 0.585), (0.50, 0.60), (0.40, 0.44), (0.26, 0.32)], 3)
    for sx in (-0.11, 0.11):
        sgn = 1 if sx > 0 else -1
        m.a("hdpe_blue").prism(outline, 0.019, mat4((sx, 0, z0), (0, 0, -HALF_PI)), bevel=0.006)
        m.a("hdpe_yellow").prism(mane, 0.01, mat4((sx + sgn * 0.0145, 0, z0), (0, 0, -HALF_PI)), bevel=0.003)
        m.a("hdpe_white").cyl((sx + sgn * 0.009, -0.555, z0 + 0.445), (sx + sgn * 0.0135, -0.555, z0 + 0.445), 0.026, segs=12)
        m.a("hdpe_black").cyl((sx + sgn * 0.0135, -0.56, z0 + 0.445), (sx + sgn * 0.0165, -0.56, z0 + 0.445), 0.013, segs=10)
        m.a("hdpe_black").cyl((sx + sgn * 0.009, -0.635, z0 + 0.385), (sx + sgn * 0.0125, -0.635, z0 + 0.385), 0.009, segs=8)
    # saddle with rounded pommel / cantle between the panels
    m.a("hdpe_red").box((0, 0.1, z0 + 0.312), (0.2, 0.4, 0.034), bevel=0.014)
    m.a("hdpe_red").box((0, 0.285, z0 + 0.365), (0.2, 0.034, 0.13), rot=(-0.25, 0, 0), bevel=0.014)
    m.a("hdpe_red").box((0, -0.1, z0 + 0.345), (0.2, 0.034, 0.09), rot=(0.3, 0, 0), bevel=0.014)
    # rope tail
    m.a("rope_hemp").tube([(0, 0.5, z0 + 0.25), (0, 0.58, z0 + 0.2), (0, 0.63, z0 + 0.06), (0, 0.62, z0 - 0.06)], [0.018, 0.02, 0.024, 0.016], segs=7)
    _rider_common(m, z0, 0.42, 0.44, 0.14, -0.03, half_w=0.11)


# ---------------------------------------------------------------------------
# Sandpit toys
# ---------------------------------------------------------------------------

def _bucket(acc, pos, r=0.1, h=0.19, rot=(0.0, 0.0, 0.0)):
    acc.lathe([(0.0, 0.0), (r * 0.72, 0.0), (r, h), (r + 0.008, h), (r + 0.008, h + 0.008), (r - 0.01, h + 0.008), (r * 0.72 - 0.008, 0.012), (0.0, 0.012)], segs=14, matrix=mat4(pos, rot))


def build_sandpit_toys(m):
    galv, wood, plank, yel = m.a("steel_galv"), m.a("wood_robinia"), m.a("wood_plank"), m.a("paint_yellow")
    # sit-on sand digger
    bx, by = -1.1, 0.0
    galv.cyl((bx, by, -0.4), (bx, by, 0.4), 0.042, segs=10)
    m.a("steel_dark").lathe([(0.0, 0.4), (0.09, 0.4), (0.09, 0.44), (0.0, 0.44)], segs=12, matrix=mat4((bx, by, 0)))
    m.a("hdpe_red").box((bx, by + 0.12, 0.47), (0.3, 0.34, 0.035), bevel=0.014)
    m.a("hdpe_red").box((bx, by + 0.29, 0.56), (0.3, 0.03, 0.18), bevel=0.012)
    yel.pipe([(bx, by - 0.08, 0.45), (bx, by - 0.72, 1.0), (bx, by - 1.12, 0.5)], 0.027, bend=0.1, segs=8)
    yel.cyl((bx, by - 0.3, 0.46), (bx, by - 0.5, 0.82), 0.014, segs=6)
    galv.prism([(-0.02, 0.2), (0.0, 0.0), (0.2, -0.04), (0.26, 0.02), (0.1, 0.06), (0.06, 0.2)], 0.2, mat4((bx, by - 1.08, 0.3), (0, 0, -HALF_PI)), bevel=0.004)
    for sx in (-0.07, 0.0, 0.07):   # digging teeth
        galv.box((bx + sx, by - 1.36, 0.31), (0.035, 0.07, 0.016), rot=(0.2, 0, 0))
    for sx in (-0.1, 0.1):
        galv.pipe([(bx + sx, by - 0.14, 0.47), (bx + sx, by - 0.22, 0.78), (bx + sx * 1.6, by - 0.22, 0.8)], 0.011, bend=0.03, segs=6)
        m.a("hdpe_black").sphere((bx + sx * 1.7, by - 0.22, 0.8), 0.022, segs=8, rings=5)
    # mud table with crane
    mx, my = 1.05, 0.25
    for dx in (-0.54, 0.54):
        wood.post((mx + dx, my + 0.3, -0.45), (mx + dx, my + 0.3, 1.72), 0.05, segs=10)
        wood.post((mx + dx, my - 0.3, -0.45), (mx + dx, my - 0.3, 0.62), 0.05, segs=10)
    wood.post((mx - 0.68, my + 0.3, 1.64), (mx + 0.68, my + 0.3, 1.64), 0.045, segs=10)
    for i in range(5):
        plank.box((mx, my - 0.3 + i * 0.15, 0.6), (1.2, 0.142, 0.035), bevel=0.006)
    for dx in (-0.54, 0.54):
        wood.beam((mx + dx, my - 0.32, 0.54), (mx + dx, my + 0.32, 0.54), 0.05, 0.08, bevel=0.008)
    m.a("steel_stainless").box((mx - 0.2, my, 0.628), (0.52, 0.42, 0.024), bevel=0.008)
    m.a("steel_dark").box((mx - 0.2, my, 0.6405), (0.44, 0.34, 0.002))
    galv.lathe([(0.0, -0.012), (0.06, -0.012), (0.06, 0.012), (0.0, 0.012)], segs=12, matrix=mat4((mx + 0.25, my + 0.3, 1.55), (HALF_PI, 0, 0)))
    m.a("chain").strip_cross((mx + 0.25, my + 0.24, 1.55), (mx + 0.25, my + 0.24, 1.2), 0.028, 0.14)
    _bucket(m.a("hdpe_red"), (mx + 0.25, my + 0.24, 0.98), r=0.1, h=0.18)
    galv.pipe([(mx + 0.15, my + 0.24, 1.16), (mx + 0.25, my + 0.24, 1.22), (mx + 0.35, my + 0.24, 1.16)], 0.004, bend=0.05, segs=4)
    # loose toys
    _bucket(m.a("hdpe_blue"), (0.05, -0.45, 0.01), r=0.1, h=0.19, rot=(0.12, 0.1, 0.0))
    _bucket(m.a("hdpe_yellow"), (-0.35, -0.85, 0.075), r=0.085, h=0.16, rot=(1.5, 0.0, 0.7))
    m.a("hdpe_yellow").cyl((0.3, -0.62, 0.035), (0.48, -0.3, 0.05), 0.011, segs=6)
    m.a("hdpe_yellow").prism([(-0.05, 0.0), (0.05, 0.0), (0.06, 0.13), (0.0, 0.17), (-0.06, 0.13)], 0.008, mat4((0.26, -0.69, 0.03), (-1.45, 0, -0.5)))
    m.a("hdpe_green").torus((0.62, -0.7, 0.03), 0.11, 0.012, major_segs=16, minor_segs=5)
    m.a("mesh_steel").quad((0.5, -0.82, 0.02), (0.74, -0.82, 0.02), (0.74, -0.58, 0.02), (0.5, -0.58, 0.02))
    m.a("hdpe_green").sphere((-0.6, -0.4, 0.02), 0.09, scale=(1.2, 1.0, 0.55), segs=10, rings=6)
    # toy dump truck
    tx, ty = 0.2, 0.9
    m.a("hdpe_orange").box((tx, ty, 0.085), (0.13, 0.3, 0.05), bevel=0.012, rot=(0, 0, 0.5))
    m.a("hdpe_orange").box((tx + 0.045, ty - 0.085, 0.14), (0.12, 0.09, 0.08), bevel=0.014, rot=(0, 0, 0.5))
    m.a("hdpe_yellow").box((tx - 0.03, ty + 0.05, 0.15), (0.14, 0.19, 0.07), bevel=0.012, rot=(0.25, 0, 0.5))
    for (ox, oy) in ((0.11, -0.03), (-0.03, -0.11), (0.0, 0.14), (-0.13, 0.06)):
        m.a("hdpe_black").lathe([(0.0, -0.016), (0.042, -0.016), (0.042, 0.016), (0.0, 0.016)], segs=10, matrix=mat4((tx + ox, ty + oy, 0.045), (0, HALF_PI, 0.5)))
    # sand castle
    sand = m.a("sand")
    sand.lathe([(0.34, -0.02), (0.26, 0.05), (0.0, 0.08)], segs=14, matrix=mat4((-0.2, 0.75, 0.0)))
    for (ox, oy, r) in ((0.0, 0.0, 0.1), (0.17, 0.05, 0.075), (-0.15, 0.08, 0.075), (0.02, -0.17, 0.07)):
        sand.lathe([(r, 0.0), (r * 0.78, 0.17), (r * 0.5, 0.17), (r * 0.3, 0.2), (0.0, 0.21)], segs=10, matrix=mat4((-0.2 + ox, 0.75 + oy, 0.04)))


# ---------------------------------------------------------------------------
# Pavilion
# ---------------------------------------------------------------------------

def build_pavilion(m):
    wood, plank, galv, roof = m.a("wood_dark"), m.a("wood_plank"), m.a("steel_galv"), m.a("roof_dark")
    px, py, eave = 1.78, 1.38, 2.38
    for sx in (-px, px):
        for sy in (-py, py):
            m.a("concrete").box((sx, sy, -0.25), (0.34, 0.34, 0.62), bevel=0.02)
            galv.box((sx, sy, 0.11), (0.17, 0.17, 0.1), bevel=0.006)
            wood.box((sx, sy, (0.12 + eave - 0.09) * 0.5), (0.14, 0.14, eave - 0.21), bevel=0.014)
            for (dx, dy) in ((-sx / px, 0), (0, -sy / py)):
                wood.beam((sx + dx * 0.06, sy + dy * 0.06, eave - 0.72), (sx + dx * 0.66, sy + dy * 0.66, eave - 0.1), 0.08, 0.08, bevel=0.008)
    for sy in (-py, py):
        wood.box((0, sy, eave), (2 * px + 0.5, 0.13, 0.18), bevel=0.012)
    for sx in (-px, px):
        wood.box((sx, 0, eave), (0.13, 2 * py + 0.5, 0.18), bevel=0.012)
    ex, ey, ze, zr, rx = 2.4, 2.0, eave + 0.05, eave + 1.2, 0.75
    ls, lh = math.hypot(ey, zr - ze), math.hypot(ex - rx, zr - ze)
    faces = [
        ([(-ex, -ey, ze), (ex, -ey, ze), (rx, 0, zr), (-rx, 0, zr)], [(-ex, 0), (ex, 0), (rx, ls), (-rx, ls)]),
        ([(ex, ey, ze), (-ex, ey, ze), (-rx, 0, zr), (rx, 0, zr)], [(ex, 0), (-ex, 0), (-rx, ls), (rx, ls)]),
        ([(ex, -ey, ze), (ex, ey, ze), (rx, 0, zr)], [(-ey, 0), (ey, 0), (0, lh)]),
        ([(-ex, ey, ze), (-ex, -ey, ze), (-rx, 0, zr)], [(ey, 0), (-ey, 0), (0, lh)]),
    ]
    for pts, uvs in faces:
        idx = tuple(range(len(pts)))
        roof.emit([V(p) + V((0, 0, 0.012)) for p in pts], [idx], [uvs], uv_offset=False, fixed=True)
        low = [V(p) - V((0, 0, 0.03)) for p in pts]
        plank.emit(low, [tuple(reversed(idx))], [[(p.x, p.y) for p in reversed(low)]], uv_offset=False, fixed=True)
    m.a("steel_dark").tube([(-rx - 0.05, 0, zr + 0.03), (rx + 0.05, 0, zr + 0.03)], 0.06, segs=8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.a("steel_dark").tube([(sx * rx, 0, zr + 0.025), (sx * ex, sy * ey, ze + 0.02)], 0.045, segs=6)
            wood.beam((sx * rx, 0, zr - 0.1), (sx * (ex - 0.05), sy * (ey - 0.05), ze - 0.1), 0.07, 0.13, bevel=0.006)
    for kx in (-1.5, -0.75, 0.0, 0.75, 1.5):
        for sy in (-1, 1):
            t = min(1.0, (ex - abs(kx)) / (ex - rx)) if abs(kx) > rx else 1.0
            wood.beam((kx, sy * ey * (1 - t) , ze + (zr - ze) * t - 0.1), (kx, sy * (ey - 0.03), ze - 0.1), 0.055, 0.11, bevel=0.005)
    for sy in (-ey, ey):
        wood.box((0, sy, ze - 0.06), (2 * ex, 0.028, 0.15), bevel=0.004)
    for sx in (-ex, ex):
        wood.box((sx, 0, ze - 0.06), (0.028, 2 * ey, 0.15), bevel=0.004)
    # picnic table with attached benches
    for i in range(5):
        plank.box((0, -0.3 + i * 0.15, 0.745), (2.0, 0.142, 0.04), bevel=0.006)
    for sy in (-0.7, 0.7):
        for j in (-0.075, 0.075):
            plank.box((0, sy + j, 0.455), (2.0, 0.142, 0.04), bevel=0.006)
    for sx in (-0.75, 0.75):
        plank.box((sx, 0, 0.415), (0.045, 1.66, 0.1), bevel=0.006)
        plank.box((sx, 0, 0.7), (0.045, 0.72, 0.07), bevel=0.006)
        for sy in (-1, 1):
            plank.beam((sx + 0.046, sy * 0.24, 0.72), (sx + 0.046, sy * 0.66, 0.0), 0.045, 0.1, bevel=0.006)
    plank.beam((0.0, 0, 0.7), (0.7, 0, 0.42), 0.04, 0.07, bevel=0.005)
    plank.beam((0.0, 0, 0.7), (-0.7, 0, 0.42), 0.04, 0.07, bevel=0.005)


# ---------------------------------------------------------------------------
# Table tennis, bench, bin, sign
# ---------------------------------------------------------------------------

def build_tischtennis(m):
    conc, top, white, galv = m.a("concrete"), m.a("tt_top"), m.a("paint_white"), m.a("steel_galv")
    L, W, H = 2.74, 1.525, 0.76
    top.box((0, 0, H - 0.035), (L, W, 0.07), bevel=0.012)
    for sy in (-W * 0.5 + 0.012, W * 0.5 - 0.012):
        white.box((0, sy, H + 0.001), (L - 0.02, 0.02, 0.002))
    for sx in (-L * 0.5 + 0.012, L * 0.5 - 0.012):
        white.box((sx, 0, H + 0.001), (0.02, W - 0.02, 0.002))
    white.box((0, 0, H + 0.001), (L - 0.04, 0.006, 0.002))
    for sx in (-0.82, 0.82):
        conc.prism([(-0.5, -0.45), (0.5, -0.45), (0.64, H - 0.07), (-0.64, H - 0.07)], 0.15, mat4((sx, 0, 0), (0, 0, HALF_PI)), bevel=0.015)
    conc.box((0, 0, 0.28), (1.6, 0.14, 0.22), bevel=0.015)
    for sy in (-W * 0.5 - 0.015, W * 0.5 + 0.015):
        galv.box((0, sy, H + 0.06), (0.024, 0.024, 0.2), bevel=0.003)
    galv.box((0, 0, H + 0.153), (0.02, W + 0.03, 0.014), bevel=0.003)
    galv.box((0, 0, H + 0.012), (0.02, W + 0.03, 0.012), bevel=0.003)
    m.a("mesh_steel").quad((0, -W * 0.5, H + 0.018), (0, W * 0.5, H + 0.018), (0, W * 0.5, H + 0.146), (0, -W * 0.5, H + 0.146))


def build_park_bench(m):
    wood, dark, galv = m.a("wood_plank"), m.a("steel_dark"), m.a("steel_galv")
    for sx in (-0.72, 0.72):
        dark.beam((sx, -0.2, -0.3), (sx, -0.17, 0.41), 0.05, 0.014, bevel=0.003)
        dark.beam((sx, 0.24, -0.3), (sx, 0.17, 0.41), 0.05, 0.014, bevel=0.003)
        dark.beam((sx, 0.17, 0.41), (sx, 0.3, 0.86), 0.05, 0.014, bevel=0.003)
        dark.beam((sx, -0.21, 0.405), (sx, 0.19, 0.405), 0.05, 0.014, bevel=0.003)
        dark.pipe([(sx, -0.19, 0.41), (sx, -0.2, 0.63), (sx, 0.22, 0.63)], 0.016, bend=0.06, segs=7)
        for fy in (-0.2, 0.24):
            dark.box((sx, fy, 0.006), (0.09, 0.12, 0.012))
    seat = [(-0.155, 0.435), (-0.052, 0.43), (0.051, 0.427), (0.154, 0.43)]
    for (y, z) in seat:
        wood.box((0, y, z), (1.8, 0.09, 0.036), bevel=0.007)
        for sx in (-0.72, 0.72):
            galv.bolt((sx, y, z + 0.018), radius=0.009, height=0.005)
    lean = math.radians(-16.0)
    for (y, z) in ((0.2, 0.555), (0.232, 0.665), (0.264, 0.775)):
        wood.box((0, y, z), (1.8, 0.036, 0.092), rot=(lean, 0, 0), bevel=0.007)
        for sx in (-0.72, 0.72):
            galv.bolt((sx, y - 0.019, z), axis=(0, -1, 0.28), radius=0.009, height=0.005)


def build_trash_bin(m):
    galv, body, dark = m.a("steel_galv"), m.a("paint_green"), m.a("steel_dark")
    galv.cyl((0, 0, -0.4), (0, 0, 1.08), 0.03, segs=10)
    galv.lathe([(0.034, 1.08), (0.034, 1.1), (0.0, 1.11)], segs=10)
    m.a("concrete").box((0, 0, -0.02), (0.3, 0.3, 0.06), bevel=0.012)
    by = -0.2
    body.lathe([(0.0, 0.42), (0.15, 0.42), (0.165, 0.45), (0.19, 0.93), (0.198, 0.94), (0.198, 0.96), (0.18, 0.96), (0.158, 0.47), (0.0, 0.47)], segs=18, matrix=mat4((0, by, 0)))
    for z, r in ((0.55, 0.172), (0.7, 0.18), (0.85, 0.188)):
        body.torus((0, by, z), r, 0.008, major_segs=18, minor_segs=4)
    dark.lathe([(0.0, 1.03), (0.21, 1.03), (0.21, 1.06), (0.15, 1.12), (0.0, 1.14)], segs=18, matrix=mat4((0, by, 0)))
    for sx in (-0.12, 0.12):
        dark.box((sx, by + 0.12, 0.99), (0.025, 0.006, 0.1))
    for z in (0.6, 0.88):
        galv.box((0, -0.03, z), (0.09, 0.07, 0.035), bevel=0.004)
    dark.box((0, by - 0.195, 0.72), (0.14, 0.004, 0.1))


def build_spielplatz_sign(m):
    galv = m.a("steel_galv")
    galv.cyl((0, 0, -0.45), (0, 0, 2.36), 0.03, segs=10)
    galv.lathe([(0.034, 2.36), (0.034, 2.375), (0.0, 2.39)], segs=10)
    m.a("concrete").box((0, 0, -0.02), (0.28, 0.28, 0.06), bevel=0.012)
    m.a("alu_plate").box((0, -0.04, 1.82), (0.62, 0.006, 0.93), bevel=0.002)
    m.a("sign_spielplatz").face_quad(0, -0.0475, 1.82, 0.6, 0.9)
    for z in (1.55, 2.1):
        galv.box((0, -0.018, z), (0.4, 0.03, 0.035), bevel=0.003)
        galv.box((0, 0.02, z), (0.09, 0.05, 0.035), bevel=0.003)


BUILDERS = [
    ("playground_tower", build_tower),
    ("playground_swings", build_swings),
    ("playground_pyramid", build_pyramid),
    ("playground_carousel", build_carousel),
    ("playground_seesaw", build_seesaw),
    ("spring_rider_tractor", build_spring_tractor),
    ("spring_rider_horse", build_spring_horse),
    ("playground_sandpit_toys", build_sandpit_toys),
    ("playground_pavilion", build_pavilion),
    ("tischtennisplatte", build_tischtennis),
    ("park_bench", build_park_bench),
    ("trash_bin", build_trash_bin),
    ("spielplatz_sign", build_spielplatz_sign),
]
