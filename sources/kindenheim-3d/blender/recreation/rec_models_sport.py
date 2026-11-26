"""
Sportplatz Andingstrasse assets: club house "Sportheim", standing terrace, goals, floodlight mast,
dugout, scoreboard. All fronts face -Y (towards the pitch); see build_recreation.py for the contract.
"""

from __future__ import annotations

import math

from mathutils import Matrix, Vector

from rec_materials import DECALS
from rec_toolkit import arc_points, fillet, lerp, mat4

V = Vector


# ---------------------------------------------------------------------------
# Shared building helpers
# ---------------------------------------------------------------------------

def wall_with_openings(acc, x0, x1, y_front, thick, z0, z1, openings):
    """Front wall (face at y_front, facing -Y) built from boxes around openings [(cx, w, zb, zt)]."""
    yc = y_front + thick * 0.5
    cur = x0
    for (cx, w, zb, zt) in sorted(openings):
        left, right = cx - w * 0.5, cx + w * 0.5
        if left - cur > 1e-3:
            acc.box(((cur + left) * 0.5, yc, (z0 + z1) * 0.5), (left - cur, thick, z1 - z0))
        if zb - z0 > 1e-3:
            acc.box((cx, yc, (z0 + zb) * 0.5), (w, thick, zb - z0))
        if z1 - zt > 1e-3:
            acc.box((cx, yc, (zt + z1) * 0.5), (w, thick, z1 - zt))
        cur = right
    if x1 - cur > 1e-3:
        acc.box(((cur + x1) * 0.5, yc, (z0 + z1) * 0.5), (x1 - cur, thick, z1 - z0))


def window_unit(m, cx, y_front, zb, w, h, recess=0.16, mullions=1, transom=False):
    """Recessed window: white frame, dark glass, projecting concrete sill."""
    fr, gl, sill = m.a("hdpe_white"), m.a("glass"), m.a("concrete")
    yf = y_front + recess
    fw, fd = 0.065, 0.07
    zc = zb + h * 0.5
    for sx in (-1, 1):
        fr.box((cx + sx * (w * 0.5 - fw * 0.5), yf + fd * 0.5, zc), (fw, fd, h), bevel=0.006)
    for zz in (zb + fw * 0.5, zb + h - fw * 0.5):
        fr.box((cx, yf + fd * 0.5, zz), (w - 2 * fw, fd, fw), bevel=0.006)
    for i in range(mullions):
        mx = cx - w * 0.5 + w * (i + 1) / (mullions + 1)
        fr.box((mx, yf + fd * 0.5, zc), (0.05, fd, h - 2 * fw), bevel=0.005)
    if transom:
        fr.box((cx, yf + fd * 0.5, zb + h * 0.68), (w - 2 * fw, fd, 0.045), bevel=0.005)
    gl.box((cx, yf + fd * 0.5 + 0.012, zc), (w - 2 * fw, 0.012, h - 2 * fw))
    sill.box((cx, y_front + recess * 0.5 - 0.035, zb - 0.03), (w + 0.12, recess + 0.07, 0.055), rot=(math.radians(-5), 0, 0), bevel=0.008)


def door_unit(m, cx, y_front, z0, w, h, leaf_key="paint_green", recess=0.12, glazed=False, double=False):
    fr, leaf, st = m.a("steel_dark"), m.a(leaf_key), m.a("steel_stainless")
    yf = y_front + recess
    fw = 0.06
    for sx in (-1, 1):
        fr.box((cx + sx * (w * 0.5 - fw * 0.5), yf + 0.04, z0 + h * 0.5), (fw, 0.08, h), bevel=0.005)
    fr.box((cx, yf + 0.04, z0 + h - fw * 0.5), (w - 2 * fw, 0.08, fw), bevel=0.005)
    leaves = [(-1, (w - 2 * fw) * 0.5), (1, (w - 2 * fw) * 0.5)] if double else [(0, w - 2 * fw)]
    for side, lw in leaves:
        lx = cx + side * lw * 0.5
        lh = h - fw - 0.01
        leaf.box((lx, yf + 0.045, z0 + lh * 0.5 + 0.005), (lw - 0.008, 0.045, lh), bevel=0.004)
        if glazed:
            m.a("glass").box((lx, yf + 0.02, z0 + lh * 0.66), (lw - 0.26, 0.012, lh * 0.5))
            leaf.box((lx, yf + 0.018, z0 + lh * 0.25), (lw - 0.24, 0.012, lh * 0.26), bevel=0.004)
        else:
            for pz, ph in ((0.3, 0.42), (0.72, 0.36)):
                leaf.box((lx, yf + 0.018, z0 + lh * pz), (lw - 0.24, 0.012, lh * ph), bevel=0.004)
        if side == 0:
            hx, lever = cx + lw * 0.5 - 0.09, -1
        else:
            hx, lever = cx + side * 0.08, side
        st.pipe([(hx, yf + 0.02, z0 + 1.02), (hx, yf - 0.035, z0 + 1.02), (hx + lever * 0.11, yf - 0.035, z0 + 1.02)], 0.009, bend=0.012, segs=6)
        st.box((hx, yf + 0.02, z0 + 1.02), (0.035, 0.008, 0.16), bevel=0.003)
        m.a("alu_plate").box((lx, yf + 0.02, z0 + 0.12), (lw - 0.03, 0.006, 0.2))
    m.a("concrete").box((cx, y_front + recess * 0.5 - 0.02, z0 - 0.015), (w + 0.06, recess + 0.1, 0.03), bevel=0.006)


def wall_lamp(m, cx, y_front, z):
    m.a("steel_dark").box((cx, y_front - 0.03, z + 0.05), (0.16, 0.07, 0.05), bevel=0.008)
    m.a("steel_dark").box((cx, y_front - 0.012, z - 0.03), (0.13, 0.024, 0.14), bevel=0.006)
    m.a("lamp_wall").sphere((cx, y_front - 0.05, z - 0.035), 0.055, scale=(1.15, 0.8, 1.1), segs=10, rings=6)


def beer_table_set(m, cx, cy, z0):
    """Bierzeltgarnitur: 2.2 m table + two benches on folding steel legs."""
    wood, st = m.a("wood_plank"), m.a("steel_dark")
    for off in (-0.125, 0.125):
        wood.box((cx, cy + off, z0 + 0.765), (2.2, 0.245, 0.028), bevel=0.004)
    for sx in (-0.8, 0.8):
        st.pipe([(cx + sx, cy - 0.21, z0 + 0.75), (cx + sx, cy - 0.21, z0 + 0.012), (cx + sx, cy + 0.21, z0 + 0.012), (cx + sx, cy + 0.21, z0 + 0.75)], 0.011, bend=0.04, segs=6)
        st.cyl((cx + sx, cy, z0 + 0.74), (cx + sx - 0.28 * (1 if sx > 0 else -1), cy, z0 + 0.4), 0.006, segs=5)
    wood.box((cx, cy, z0 + 0.745), (0.06, 0.4, 0.02), bevel=0.003)
    for side in (-0.58, 0.58):
        wood.box((cx, cy + side, z0 + 0.455), (2.2, 0.25, 0.028), bevel=0.004)
        for sx in (-0.8, 0.8):
            st.pipe([(cx + sx, cy + side - 0.1, z0 + 0.44), (cx + sx, cy + side - 0.1, z0 + 0.012), (cx + sx, cy + side + 0.1, z0 + 0.012), (cx + sx, cy + side + 0.1, z0 + 0.44)], 0.01, bend=0.03, segs=6)


# ---------------------------------------------------------------------------
# Sportheim
# ---------------------------------------------------------------------------

def build_sportheim(m):
    """47.5 m club house with covered veranda, kiosk hatch, changing rooms; plinth down to -2.8 m."""
    L, x0, x1 = 47.5, -23.75, 23.75
    floor = 0.72
    y_f, y_b, wt = -0.85, 3.25, 0.30
    y_ridge, z_ridge = 2.2, 5.25
    s_front, s_back = 0.359, 0.70
    y_eave, y_eave_b = -3.70, 3.65
    x_split = 14.3  # weathered roof west of this, newer red tiles east (as in the orthophoto)

    def roof_z(y):
        return z_ridge - s_front * (y_ridge - y) if y <= y_ridge else z_ridge - s_back * (y - y_ridge)

    conc, plaster, grey = m.a("concrete"), m.a("plaster_cream"), m.a("plaster_grey")
    wood, plank, galv = m.a("wood_dark"), m.a("wood_plank"), m.a("steel_galv")

    # --- plinth, veranda slab, steps -------------------------------------------------
    conc.box((0, 0, (-2.8 + floor - 0.05) * 0.5), (L, 6.5, floor - 0.05 + 2.8))
    conc.box((0, -3.3, floor - 0.09), (L + 0.1, 0.12, 0.18), bevel=0.015)  # veranda edge kerb
    m.a("paving").box((0, (-3.25 + y_f) * 0.5, floor - 0.025), (L, y_f + 3.25, 0.05))
    stair_x = (-12.87, 8.58)
    for sx in stair_x:
        for k in range(1, 5):
            conc.box((sx, -3.25 - 0.30 * (k - 0.5), floor - 0.18 * k - 0.6), (3.7, 0.30, 1.2), bevel=0.012)
        for side in (-1.95, 1.95):  # cheek walls
            conc.box((sx + side, -3.85, floor - 0.55), (0.2, 1.3, 1.1), bevel=0.015)

    # --- body walls --------------------------------------------------------------------
    z_wall_f, z_wall_b = 3.98, 4.33
    W, HW = (1.5, floor + 0.95, floor + 2.25), (0.9, floor + 1.85, floor + 2.45)
    windows = [(-21.9, *W), (-19.6, *W), (-17.1, *W), (-9.2, *W), (-6.8, *W), (0.9, *W), (3.3, *W)]
    high = [(11.0, *HW), (13.3, *HW), (18.0, *HW), (22.3, *HW)]
    doors = [(-12.87, 1.8, floor, floor + 2.15), (8.58, 1.05, floor, floor + 2.1), (15.7, 1.05, floor, floor + 2.1), (20.2, 1.05, floor, floor + 2.1)]
    kiosk = (-2.9, 2.3, floor + 1.02, floor + 2.2)
    openings = windows + high + doors + [kiosk]
    plinth_h = 0.42
    wall_with_openings(grey, x0, x1, y_f, wt, floor, floor + plinth_h, [(d[0], d[1], floor, floor + plinth_h) for d in doors])
    wall_with_openings(plaster, x0, x1, y_f + 0.012, wt - 0.012, floor + plinth_h, z_wall_f, [(o[0], o[1], max(o[2], floor + plinth_h), o[3]) for o in openings])
    plaster.box((0, y_b - wt * 0.5, (floor + plinth_h + z_wall_b) * 0.5), (L, wt, z_wall_b - floor - plinth_h))
    grey.box((0, y_b - wt * 0.5 + 0.012, floor - 0.5 + (plinth_h + 0.5) * 0.5), (L + 0.02, wt, plinth_h + 0.5))
    gable = [(y_f, floor), (y_b, floor), (y_b, z_wall_b), (y_ridge, z_ridge - 0.2), (y_f, z_wall_f)]
    for gx in (x0 + wt * 0.5, x1 - wt * 0.5):
        # prism outline is local X/Z, extruded along local Y: rotate so local X -> world Y
        plaster.prism([(y, z) for (y, z) in gable], wt, mat4((gx, 0, 0), (0, 0, math.pi * 0.5)))
    for (cx, w, zb, zt) in windows:
        window_unit(m, cx, y_f, zb, w, zt - zb, mullions=1, transom=True)
    for (cx, w, zb, zt) in high:
        window_unit(m, cx, y_f, zb, w, zt - zb, mullions=0)
    door_unit(m, doors[0][0], y_f, floor, 1.8, 2.15, glazed=True, double=True)
    for (cx, w, _zb, _zt) in doors[1:]:
        door_unit(m, cx, y_f, floor, w, 2.1)
    # Rear (hill side): the embankment rises to sill height here, so the back is a plain rendered
    # retaining wall with a row of high ventilation grilles instead of windows.
    for bx in (-20.0, -11.0, -2.0, 7.0, 16.0):
        m.a("alu_plate").box((bx, y_b + 0.008, z_wall_b - 0.32), (0.5, 0.016, 0.22), bevel=0.004)
        for k in range(4):
            m.a("steel_dark").box((bx, y_b + 0.018, z_wall_b - 0.4 + k * 0.05), (0.44, 0.006, 0.012))

    # --- kiosk hatch -------------------------------------------------------------------
    kx, kw, kzb, kzt = kiosk
    m.a("steel_dark").box((kx, y_f + 0.2, (kzb + kzt) * 0.5), (kw, 0.03, kzt - kzb))  # dark interior
    fr = m.a("hdpe_white")
    for sx in (-1, 1):
        fr.box((kx + sx * (kw * 0.5 - 0.03), y_f + 0.14, (kzb + kzt) * 0.5), (0.06, 0.07, kzt - kzb), bevel=0.006)
    fr.box((kx, y_f + 0.14, kzt - 0.03), (kw - 0.12, 0.07, 0.06), bevel=0.006)
    for i in range(5):  # half-raised roller shutter slats
        m.a("alu_plate").box((kx, y_f + 0.125, kzt - 0.09 - i * 0.075), (kw - 0.13, 0.018, 0.07), bevel=0.004)
    plank.box((kx, y_f - 0.13, kzb - 0.02), (kw + 0.3, 0.42, 0.04), bevel=0.006)
    for sx in (-0.9, 0.9):
        m.a("steel_dark").beam((kx + sx, y_f - 0.01, kzb - 0.36), (kx + sx, y_f - 0.3, kzb - 0.05), 0.03, 0.03, bevel=0.003)
    m.a("decals").face_quad(kx, y_f - 0.022, floor + 2.62, 2.3, 0.575, DECALS["kiosk"])
    wood.box((kx, y_f - 0.005, floor + 2.62), (2.4, 0.02, 0.66), bevel=0.004)

    # --- wall furniture: plates, notice board, lamps, crates, wall benches ---------------------
    dec = m.a("decals")
    for (cx, key) in ((8.58, "door_heim"), (15.7, "door_gast"), (20.2, "door_ref")):
        dec.face_quad(cx, y_f - 0.017, floor + 2.33, 0.6, 0.45, DECALS[key])
        m.a("alu_plate").box((cx, y_f - 0.005, floor + 2.33), (0.64, 0.01, 0.49), bevel=0.003)
    dec.face_quad(7.2, y_f - 0.017, floor + 1.6, 0.8, 0.4, DECALS["rules"])
    m.a("alu_plate").box((7.2, y_f - 0.005, floor + 1.6), (0.84, 0.01, 0.44), bevel=0.003)
    dec.face_quad(-23.0, y_f - 0.017, floor + 2.0, 0.64, 0.32, DECALS["street_no"])
    m.a("alu_plate").box((-23.0, y_f - 0.005, floor + 2.0), (0.66, 0.01, 0.34), bevel=0.003)
    # Schaukasten
    nx = -14.95
    m.a("steel_dark").box((nx, y_f - 0.035, floor + 1.6), (1.5, 0.07, 0.5), bevel=0.008)
    dec.face_quad(nx, y_f - 0.077, floor + 1.6, 1.42, 0.355, DECALS["notice"])
    for lx in [d[0] for d in doors] + [kx - 1.6, kx + 1.6]:
        wall_lamp(m, lx, y_f, floor + 2.95)
    for i, (cxr, key) in enumerate(((-4.9, "hdpe_yellow"), (-4.9, "hdpe_red"), (-4.9, "hdpe_yellow"), (-5.35, "hdpe_green"), (-5.35, "hdpe_green"))):
        level = (0, 1, 2, 0, 1)[i]
        m.a(key).box((cxr, y_f - 0.22, floor + 0.14 + level * 0.275), (0.4, 0.3, 0.265), bevel=0.012, rot=(0, 0, 0.04 * ((i * 7) % 3 - 1)))
        m.a("steel_dark").box((cxr, y_f - 0.22, floor + 0.262 + level * 0.275), (0.34, 0.24, 0.012))
    for bx in (12.15, 17.0):
        plank.box((bx, y_f - 0.2, floor + 0.46), (1.9, 0.34, 0.045), bevel=0.006)
        for sx in (-0.8, 0.8):
            m.a("steel_dark").beam((bx + sx, y_f - 0.01, floor + 0.12), (bx + sx, y_f - 0.3, floor + 0.44), 0.035, 0.035, bevel=0.003)
            m.a("steel_dark").box((bx + sx, y_f - 0.16, floor + 0.425), (0.035, 0.3, 0.03), bevel=0.003)

    # --- veranda timber: posts, header, braces, railing -----------------------------------------
    y_post = -3.10
    n_bays = 11
    post_x = [x0 + 0.15 + i * (L - 0.3) / n_bays for i in range(n_bays + 1)]
    z_head = roof_z(y_post) - 0.20 - 0.11
    wood.box((0, y_post, z_head), (L - 0.1, 0.16, 0.22), bevel=0.012)
    for i, px in enumerate(post_x):
        wood.box((px, y_post, (floor + z_head - 0.11) * 0.5), (0.15, 0.15, z_head - 0.11 - floor), bevel=0.014)
        galv.box((px, y_post, floor + 0.05), (0.19, 0.19, 0.1), bevel=0.006)  # post shoe
        for sx in (-1, 1):
            if (i == 0 and sx < 0) or (i == n_bays and sx > 0):
                continue
            wood.beam((px + sx * 0.08, y_post, z_head - 0.72), (px + sx * 0.66, y_post, z_head - 0.12), 0.09, 0.09, bevel=0.008)
    for i in range(n_bays):
        xa, xb = post_x[i], post_x[i + 1]
        if any(xa < sx < xb for sx in stair_x):
            continue
        wood.box(((xa + xb) * 0.5, y_post, floor + 1.0), (xb - xa - 0.15, 0.11, 0.06), bevel=0.01)
        wood.box(((xa + xb) * 0.5, y_post, floor + 0.14), (xb - xa - 0.15, 0.07, 0.05), bevel=0.006)
        n_bal = int((xb - xa - 0.15) / 0.135)
        for k in range(1, n_bal):
            wood.box((xa + 0.075 + k * (xb - xa - 0.15) / n_bal, y_post, floor + 0.57), (0.04, 0.04, 0.82))

    # --- roof ------------------------------------------------------------------------------
    rx0, rx1 = x0 - 0.55, x1 + 0.55
    lf = math.hypot(y_ridge - y_eave, z_ridge - roof_z(y_eave))
    lb = math.hypot(y_eave_b - y_ridge, z_ridge - roof_z(y_eave_b))
    for (xa, xb, key) in ((rx0, x_split, "roof_old"), (x_split, rx1, "roof_red")):
        r = m.a(key)
        r.quad((xa, y_eave, roof_z(y_eave)), (xb, y_eave, roof_z(y_eave)), (xb, y_ridge, z_ridge), (xa, y_ridge, z_ridge),
               uvs=[(xa, 0), (xb, 0), (xb, lf), (xa, lf)])
        r.quad((xb, y_eave_b, roof_z(y_eave_b)), (xa, y_eave_b, roof_z(y_eave_b)), (xa, y_ridge, z_ridge), (xb, y_ridge, z_ridge),
               uvs=[(xb, 0), (xa, 0), (xa, lb), (xb, lb)])
        r.tube([(xa, y_ridge, z_ridge + 0.02), (xb, y_ridge, z_ridge + 0.02)], 0.11, segs=8)
    # red/old junction: lead flashing strip
    m.a("steel_dark").beam((x_split, y_eave + 0.02, roof_z(y_eave) + 0.012), (x_split, y_ridge, z_ridge + 0.012), 0.16, 0.012, bevel=0.0)
    # soffit deck (underside of the roof wherever it is visible from below), fascias, verge boards
    def soffit(xa, xb, ya, yb):
        wood.quad((xa, ya, roof_z(ya) - 0.05), (xa, yb, roof_z(yb) - 0.05), (xb, yb, roof_z(yb) - 0.05), (xb, ya, roof_z(ya) - 0.05))

    soffit(rx0, rx1, y_eave, y_f + 0.05)
    soffit(rx0, rx1, y_b - 0.05, y_eave_b)
    for (xa, xb) in ((rx0, x0 + 0.05), (x1 - 0.05, rx1)):
        soffit(xa, xb, y_f + 0.05, y_ridge)
        soffit(xa, xb, y_ridge, y_b - 0.05)
    wood.box((0, y_eave - 0.012, roof_z(y_eave) - 0.1), (rx1 - rx0, 0.03, 0.2), bevel=0.004)
    wood.box((0, y_eave_b + 0.012, roof_z(y_eave_b) - 0.1), (rx1 - rx0, 0.03, 0.2), bevel=0.004)
    for gx in (rx0, rx1):
        wood.beam((gx, y_eave, roof_z(y_eave) - 0.09), (gx, y_ridge, z_ridge - 0.09), 0.035, 0.2, bevel=0.004)
        wood.beam((gx, y_eave_b, roof_z(y_eave_b) - 0.09), (gx, y_ridge, z_ridge - 0.09), 0.035, 0.2, bevel=0.004)
    # exposed rafters over the veranda
    n_raft = 52
    for i in range(n_raft + 1):
        rxp = rx0 + 0.12 + i * (rx1 - rx0 - 0.24) / n_raft
        wood.beam((rxp, y_eave + 0.02, roof_z(y_eave + 0.02) - 0.13), (rxp, y_f - 0.01, roof_z(y_f - 0.01) - 0.13), 0.07, 0.15, bevel=0.006)
    # purlin on the wall line
    wood.box((0, y_f - 0.06, roof_z(y_f - 0.06) - 0.3), (L, 0.12, 0.16), bevel=0.01)

    # --- gutter + downpipes ---------------------------------------------------------------
    gy, gz, gr = y_eave - 0.085, roof_z(y_eave) - 0.115, 0.068
    prof = [(math.cos(a) * gr, math.sin(a) * gr) for a in [math.pi + i * math.pi / 8 for i in range(9)]]
    m.a("gutter").sweep([(rx1, gy, gz), (rx0, gy, gz + 0.02)], prof, side=(0, 1, 0))
    for i in range(0, n_raft + 1, 2):
        rxp = rx0 + 0.12 + i * (rx1 - rx0 - 0.24) / n_raft
        galv.box((rxp, gy, gz - gr * 0.7), (0.025, gr * 2.1, 0.012))
    for px in (post_x[0], post_x[4], post_x[8], post_x[11]):
        galv.pipe([(px, gy, gz - gr + 0.01), (px, gy, gz - 0.28), (px, y_post - 0.13, gz - 0.62), (px, y_post - 0.13, floor + 0.2), (px, y_post - 0.3, floor + 0.05)], 0.042, bend=0.09, segs=10)
        for cz in (floor + 0.6, floor + 1.7):
            galv.torus((px, y_post - 0.13, cz), 0.046, 0.007, major_segs=10, minor_segs=4)

    # --- chimney, vents ----------------------------------------------------------------------
    plaster.box((-11.0, 2.85, 5.0), (0.52, 0.52, 1.5))
    conc.box((-11.0, 2.85, 5.79), (0.66, 0.66, 0.07), bevel=0.012)
    m.a("steel_dark").box((-11.0, 2.85, 4.84), (0.6, 0.6, 0.1))
    for vx in (10.2, 18.9):
        galv.cyl((vx, 3.0, roof_z(3.0) - 0.05), (vx, 3.0, roof_z(3.0) + 0.42), 0.055, segs=8)
        galv.lathe([(0.085, 0.0), (0.085, 0.03), (0.0, 0.07)], segs=8, matrix=mat4((vx, 3.0, roof_z(3.0) + 0.43)))

    # --- furniture + sign ---------------------------------------------------------------------
    for bx in (-21.3, -17.7, -8.4, 1.6, 4.6):
        beer_table_set(m, bx, -1.98, floor)
    sx_c, sy, sw, sh = -4.5, -3.28, 7.3, 0.92
    sz = roof_z(sy) + 0.16 + sh * 0.5
    wood.box((sx_c, sy + 0.035, sz), (sw + 0.14, 0.05, sh + 0.14), bevel=0.01)
    m.a("sign_sportheim").face_quad(sx_c, sy + 0.003, sz, sw, sh)
    for bxo in (-3.2, -1.1, 1.1, 3.2):
        m.a("steel_dark").beam((sx_c + bxo, sy + 0.06, sz + 0.25), (sx_c + bxo, sy + 0.95, roof_z(sy + 0.95) + 0.02), 0.03, 0.03, bevel=0.003)
        m.a("steel_dark").beam((sx_c + bxo, sy + 0.06, sz - sh * 0.5 - 0.06), (sx_c + bxo, sy + 0.06, roof_z(sy + 0.06) + 0.01), 0.03, 0.03, bevel=0.003)


# ---------------------------------------------------------------------------
# Standing terrace
# ---------------------------------------------------------------------------

def build_terrace(m):
    """28 m x 3.4 m concrete standing terrace: 4 tiers, two stairways, crush barriers, rear wall + rail."""
    L, D = 28.0, 3.4
    conc, white, galv = m.a("concrete_old"), m.a("concrete_white"), m.a("steel_galv")
    yellow = m.a("paint_yellow")
    tiers = [(-1.275, 0.28), (-0.425, 0.64), (0.425, 1.02), (1.275, 1.42)]
    for cy, top in tiers:
        conc.box((0, cy, (-2.4 + top - 0.04) * 0.5), (L, 0.85, top - 0.04 + 2.4))
        white.box((0, cy, top - 0.02), (L, 0.85, 0.04))                       # whitewashed tread
        white.box((0, cy - 0.425 + 0.03, top - 0.045), (L, 0.07, 0.09), bevel=0.012)  # nosing
    white.box((0, 1.62, (-2.4 + 2.15) * 0.5), (L, 0.24, 4.55))
    white.box((0, 1.62, 2.19), (L + 0.1, 0.34, 0.08), bevel=0.015)            # coping
    for ex in (-L * 0.5 + 0.14, L * 0.5 - 0.14):
        outline = [(-1.7, -2.4), (1.5, -2.4), (1.5, 2.15), (0.85, 2.15), (-1.7, 0.75)]
        white.prism(outline, 0.28, mat4((ex, 0, 0), (0, 0, math.pi * 0.5)), bevel=0.012)
    for sx in (-6.5, 6.5):
        for i in range(8):
            sy = -1.56 + i * 0.4
            top = 0.14 + i * 0.172
            conc.box((sx, sy, top - 0.3), (1.5, 0.42, 0.6), bevel=0.008)
            yellow.box((sx, sy - 0.18, top + 0.002), (1.5, 0.05, 0.006))
        for side in (-0.78, 0.78):
            pts = [(sx + side, -1.6, 0.14 + 0.9), (sx + side, 1.3, 0.14 + 7 * 0.172 + 0.9)]
            galv.pipe([(sx + side, -1.6, 0.1)] + pts + [(sx + side, 1.3, 1.3)], 0.021, bend=0.07, segs=7)
            galv.cyl((sx + side, -0.2, 0.6), (sx + side, -0.2, 1.62), 0.019, segs=6)
    # crush barriers (Wellenbrecher) on tiers 2 and 4
    for (cy, top), xs in ((tiers[1], (-11.2, -2.2, 2.2, 11.2)), (tiers[3], (-10.4, -3.4, 0.0, 3.4, 10.4))):
        for bx in xs:
            w = 2.3
            galv.pipe([(bx - w * 0.5, cy + 0.2, top - 0.02), (bx - w * 0.5, cy + 0.2, top + 1.08), (bx + w * 0.5, cy + 0.2, top + 1.08), (bx + w * 0.5, cy + 0.2, top - 0.02)], 0.024, bend=0.09, segs=8)
            galv.cyl((bx - w * 0.5, cy + 0.2, top + 0.55), (bx + w * 0.5, cy + 0.2, top + 0.55), 0.017, segs=6)
            for sxx in (-w * 0.5, w * 0.5):
                galv.box((bx + sxx, cy + 0.2, top + 0.006), (0.12, 0.12, 0.012))
    # rear safety railing on the wall coping
    rz = 2.23
    galv.cyl((-L * 0.5 + 0.2, 1.62, rz + 0.95), (L * 0.5 - 0.2, 1.62, rz + 0.95), 0.024, segs=8)
    galv.cyl((-L * 0.5 + 0.2, 1.62, rz + 0.5), (L * 0.5 - 0.2, 1.62, rz + 0.5), 0.017, segs=6)
    for i in range(15):
        px = -L * 0.5 + 0.25 + i * (L - 0.5) / 14
        galv.cyl((px, 1.62, rz - 0.02), (px, 1.62, rz + 0.95), 0.021, segs=7)
        galv.box((px, 1.62, rz + 0.006), (0.11, 0.11, 0.012))
    # drain channel + a little kerb in front
    conc.box((0, -1.78, 0.05), (L, 0.16, 0.1), bevel=0.012)


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

def build_goal(width, height, depth_bot, depth_top, weights=False):
    def fn(m):
        frame, galv, net = m.a("paint_white"), m.a("steel_galv"), m.a("net")
        hy = width * 0.5
        pr = 0.06 if width > 6 else 0.05
        frame.pipe([(0, -hy - pr, -0.35), (0, -hy - pr, height + pr), (0, hy + pr, height + pr), (0, hy + pr, -0.35)], pr, bend=0.035, segs=12, bend_n=3)
        zt = height + pr
        for s in (-1, 1):
            y = s * (hy + pr)
            galv.pipe([(-pr, y, zt), (-depth_top, y, zt), (-depth_bot, y, 0.03), (0, y, 0.03)], 0.021, bend=0.12, segs=8)
            galv.cyl((-pr * 0.5, y, height * 0.5), (-depth_top - (depth_bot - depth_top) * 0.5, y, height * 0.5), 0.012, segs=6)
        galv.cyl((-depth_bot, -hy - pr, 0.03), (-depth_bot, hy + pr, 0.03), 0.021, segs=8)
        galv.cyl((-depth_top, -hy - pr, zt), (-depth_top, hy + pr, zt), 0.016, segs=6)
        if weights:
            for s in (-0.6, 0.6):
                m.a("concrete").box((-depth_bot + 0.02, s * hy, 0.07), (0.3, 0.5, 0.14), bevel=0.02)
        else:
            for s in (-1, 1):  # ground sockets
                m.a("concrete").box((0, s * (hy + pr), -0.02), (0.32, 0.32, 0.06), bevel=0.01)
        sag = 0.07

        def top(s, t):
            return (-depth_top * s, lerp(-hy, hy, t), zt - 0.01 - sag * 0.5 * math.sin(math.pi * s) * math.sin(math.pi * t))

        def back(s, t):
            bulge = sag * math.sin(math.pi * s) * math.sin(math.pi * t)
            return (lerp(-depth_top, -depth_bot, s) - bulge, lerp(-hy, hy, t), lerp(zt - 0.01, 0.04, s))

        ny = max(8, int(width / 0.6))
        net.grid(top, 3, ny, uv_fn=lambda s, t: (depth_top * s, width * t))
        slant = math.hypot(depth_bot - depth_top, zt)
        net.grid(back, 6, ny, uv_fn=lambda s, t: (depth_top + slant * s, width * t))
        for sgn in (-1, 1):
            y = sgn * (hy + pr * 0.5)

            def side(s, t, y=y, sgn=sgn):
                z = lerp(0.04, zt - 0.01, t)
                x_back = -depth_top if t >= 1.0 else lerp(-depth_bot, -depth_top, t)
                return (x_back * s, y + sgn * sag * 0.6 * math.sin(math.pi * s) * math.sin(math.pi * t), z)

            net.grid(side, 5, 6, uv_fn=lambda s, t: (depth_bot * s * (1 - t) + depth_top * s * t, zt * t))

    return fn


# ---------------------------------------------------------------------------
# Floodlight mast
# ---------------------------------------------------------------------------

def build_floodlight_mast(m):
    """16.5 m galvanised mast, cross-arm with three asymmetric floodlights facing -Y (pitch side)."""
    conc, galv, dark, lens = m.a("concrete"), m.a("steel_galv"), m.a("steel_dark"), m.a("lens")
    conc.box((0, 0, -0.5), (0.95, 0.95, 1.3), bevel=0.03)
    galv.box((0, 0, 0.165), (0.5, 0.5, 0.03), bevel=0.004)
    for sx in (-0.19, 0.19):
        for sy in (-0.19, 0.19):
            galv.cyl((sx, sy, 0.15), (sx, sy, 0.26), 0.014, segs=6)
            galv.lathe([(0.026, 0.0), (0.026, 0.022), (0.0, 0.022)], segs=6, matrix=mat4((sx, sy, 0.18)))
    for k in range(4):
        a = k * math.pi * 0.5 + math.pi * 0.25
        galv.prism([(0.0, 0.0), (0.12, 0.0), (0.0, 0.22)], 0.012, mat4((math.cos(a) * 0.15, math.sin(a) * 0.15, 0.18), (0, 0, a)))
    # tapered mast in three slip-jointed sections
    prof = [(0.17, 0.18), (0.168, 0.3), (0.142, 5.9), (0.15, 5.92), (0.15, 6.1), (0.134, 6.12), (0.112, 11.5), (0.12, 11.52), (0.12, 11.7), (0.106, 11.72), (0.078, 16.3), (0.0, 16.3)]
    galv.lathe(prof, segs=16)
    dark.box((0, 0.158, 0.95), (0.14, 0.02, 0.42), bevel=0.006)   # service door (rear side)
    galv.box((0, 0.172, 0.95), (0.03, 0.012, 0.05))
    for i in range(30):                                           # step bolts
        z = 2.8 + i * 0.42
        r = lerp(0.158, 0.085, (z - 0.3) / 16.0)
        sgn = 1 if i % 2 == 0 else -1
        galv.pipe([(sgn * r * 0.7, r * 0.7, z), (sgn * (r * 0.7 + 0.14), r * 0.7 + 0.1, z), (sgn * (r * 0.7 + 0.14), r * 0.7 + 0.1, z + 0.035)], 0.009, bend=0.012, segs=5)
    galv.pipe([(0.1, 0.12, 0.3), (0.1, 0.12, 15.9), (0.0, -0.05, 16.2)], 0.014, bend=0.1, segs=5)  # cable conduit
    galv.box((0.13, 0.16, 1.5), (0.2, 0.1, 0.3), bevel=0.008)     # switch box
    # head frame
    galv.box((0, -0.1, 16.35), (3.3, 0.1, 0.1), bevel=0.006)
    galv.box((0, -0.1, 15.75), (2.2, 0.07, 0.07), bevel=0.005)
    for sx in (-1.0, 1.0):
        galv.beam((sx * 1.55, -0.1, 16.3), (sx * 0.1, -0.02, 15.1), 0.045, 0.045, bevel=0.004)
        galv.box((sx * 1.05, -0.1, 16.05), (0.05, 0.06, 0.6), bevel=0.004)
    galv.cyl((0, 0, 16.3), (0, 0, 17.3), 0.012, segs=5)           # lightning rod
    tilt = math.radians(28.0)
    for lx in (-1.25, 0.0, 1.25):
        base = mat4((lx, -0.3, 16.62), (tilt, 0, 0))
        dark.box((0, 0, 0), (0.64, 0.17, 0.5), bevel=0.02, matrix=base)
        for k in range(9):                                         # cooling fins on the back
            dark.box((-0.28 + k * 0.07, 0.11, 0.0), (0.012, 0.07, 0.42), matrix=base)
        dark.box((0, -0.14, 0.27), (0.68, 0.22, 0.014), bevel=0.003, matrix=base)   # visor
        galv.box((0, 0.2, -0.1), (0.2, 0.12, 0.14), bevel=0.01, matrix=base)        # gear box
        lens.quad(*(base @ V(p) for p in ((-0.29, -0.088, -0.22), (0.29, -0.088, -0.22), (0.29, -0.088, 0.22), (-0.29, -0.088, 0.22))), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        m.a("alu_plate").box((0, -0.082, 0), (0.6, 0.006, 0.46), matrix=base)
        # U-yoke
        galv.pipe([base @ V((-0.36, 0.0, 0.0)), V((lx - 0.36, -0.1, 16.42)), V((lx + 0.36, -0.1, 16.42)), base @ V((0.36, 0.0, 0.0))], 0.014, bend=0.05, segs=6)
        for sx in (-0.36, 0.36):
            galv.lathe([(0.03, -0.012), (0.03, 0.012), (0.0, 0.012)], segs=6, matrix=base @ mat4((sx, 0, 0), (0, math.pi * 0.5, 0)))


# ---------------------------------------------------------------------------
# Dugout
# ---------------------------------------------------------------------------

def build_dugout(m):
    """4.2 m team shelter: curved aluminium ribs, clear polycarbonate shell, six shell seats; opens to -Y."""
    conc, alu, poly, seat, st = m.a("concrete"), m.a("steel_galv"), m.a("polycarb"), m.a("hdpe_blue"), m.a("steel_dark")
    W, D = 4.2, 1.45
    conc.box((0, 0, -0.2), (W + 0.3, D + 0.3, 0.45), bevel=0.02)
    m.a("rubber").box((0, -0.2, 0.031), (W - 0.2, 0.75, 0.012))
    raw = [(0.66, 0.03), (0.66, 1.25), (0.62, 1.7), (0.42, 1.98), (0.05, 2.1), (-0.6, 2.06)]
    path = fillet([V((0, y, z)) for (y, z) in raw], 0.35, 6)
    rib_x = (-W * 0.5 + 0.04, -0.7, 0.7, W * 0.5 - 0.04)
    for rx in rib_x:
        alu.tube([p + V((rx, 0, 0)) for p in path], 0.026, segs=8)
        alu.box((rx, 0.05, 0.045), (0.05, 1.3, 0.03), bevel=0.004)
        alu.box((rx, 0.66, 0.036), (0.14, 0.14, 0.012))
    n = len(path)
    for idx in (2, n // 2, n - 4, n - 1):
        p = path[idx]
        alu.cyl((-W * 0.5 + 0.04, p.y, p.z), (W * 0.5 - 0.04, p.y, p.z), 0.017, segs=6)
    # clear shell (slightly outside the ribs)
    cum = [0.0]
    for i in range(1, n):
        cum.append(cum[-1] + (path[i] - path[i - 1]).length)

    def shell(s, t):
        f = t * (n - 1)
        i = min(int(f), n - 2)
        p = path[i].lerp(path[i + 1], f - i)
        return (lerp(-W * 0.5 + 0.04, W * 0.5 - 0.04, s), p.y + 0.03, p.z + 0.01)

    poly.grid(shell, 6, n - 1)
    side_outline = [(p.y, p.z) for p in path] + [(-0.6, 0.03)]
    for sx in (-W * 0.5 + 0.02, W * 0.5 - 0.02):
        poly.prism(side_outline, 0.006, mat4((sx, 0, 0), (0, 0, math.pi * 0.5)))
    # bench frame + six shell seats
    st.box((0, 0.2, 0.4), (W - 0.3, 0.05, 0.05), bevel=0.005)
    for bx in (-1.8, -0.6, 0.6, 1.8):
        st.box((bx, 0.2, 0.2), (0.05, 0.05, 0.4), bevel=0.005)
        st.box((bx, 0.2, 0.045), (0.06, 0.5, 0.02))
    prof = [(-0.22, 0.45), (-0.18, 0.43), (0.12, 0.42), (0.2, 0.46), (0.25, 0.62), (0.3, 0.86)]
    outline = [(y, z + 0.012) for (y, z) in prof] + [(y + 0.014, z - 0.012) for (y, z) in reversed(prof)]
    for sx in (-1.65, -0.99, -0.33, 0.33, 0.99, 1.65):
        seat.prism(outline, 0.44, mat4((sx, 0.04, 0), (0, 0, math.pi * 0.5)), bevel=0.006)


# ---------------------------------------------------------------------------
# Scoreboard
# ---------------------------------------------------------------------------

def build_scoreboard(m):
    """Manual village scoreboard: green steel case on two posts, hanging number plates, rain hood."""
    galv, case, face = m.a("steel_galv"), m.a("paint_green"), m.a("sign_scoreboard")
    for px in (-1.05, 1.05):
        galv.cyl((px, 0.06, -0.5), (px, 0.06, 2.95), 0.05, segs=10)
        m.a("concrete").box((px, 0.06, -0.02), (0.4, 0.4, 0.08), bevel=0.012)
        for bz in (1.8, 2.8):
            galv.box((px, 0.02, bz), (0.14, 0.05, 0.06), bevel=0.004)
    case.box((0, 0.0, 2.3), (2.66, 0.12, 1.36), bevel=0.012)
    face.face_quad(0, -0.065, 2.3, 2.56, 1.28)
    case.box((0, -0.075, 2.3 + 0.655), (2.7, 0.03, 0.05), bevel=0.004)
    case.box((0, -0.075, 2.3 - 0.655), (2.7, 0.03, 0.05), bevel=0.004)
    for sx in (-1.33, 1.33):
        case.box((sx, -0.075, 2.3), (0.05, 0.03, 1.36), bevel=0.004)
    case.box((0, -0.14, 3.03), (2.84, 0.46, 0.03), rot=(math.radians(10), 0, 0), bevel=0.004)  # hood
    # raised number plates re-using the texels of the painted plates
    for (u0, u1, cx) in ((115 / 1024, 365 / 1024, -0.68), (659 / 1024, 909 / 1024, 0.68)):
        v0, v1 = 1 - 462 / 512, 1 - 214 / 512
        pw, ph = (u1 - u0) * 2.56, (v1 - v0) * 1.28
        cz = 2.3 - 0.64 + (v0 + v1) * 0.5 * 1.28
        m.a("steel_dark").box((cx, -0.074, cz), (pw, 0.012, ph), bevel=0.003)
        face.face_quad(cx, -0.086, cz, pw - 0.006, ph - 0.006, (u0, v0, u1, v1))
        for hx in (-pw * 0.3, pw * 0.3):
            galv.pipe([(cx + hx, -0.063, cz + ph * 0.5 + 0.05), (cx + hx, -0.09, cz + ph * 0.5 + 0.05), (cx + hx, -0.09, cz + ph * 0.5 - 0.03)], 0.005, bend=0.01, segs=5)
    # small shelf for spare plates
    galv.box((0, -0.12, 1.5), (1.2, 0.2, 0.02), bevel=0.003)
    for sx in (-0.5, 0.5):
        galv.beam((sx, 0.0, 1.42), (sx, -0.2, 1.5), 0.02, 0.02, bevel=0.002)
    for i in range(4):
        m.a("steel_dark").box((-0.3 + i * 0.012, -0.12, 1.66), (0.01, 0.17, 0.3), rot=(0, 0.05, 0))


BUILDERS = [
    ("sportheim_kindenheim", build_sportheim),
    ("sportplatz_terrace", build_terrace),
    ("soccer_goal_full", build_goal(7.32, 2.44, 2.0, 0.8)),
    ("soccer_goal_mini", build_goal(5.0, 2.0, 1.45, 0.7, weights=True)),
    ("floodlight_mast", build_floodlight_mast),
    ("dugout_bench", build_dugout),
    ("scoreboard", build_scoreboard),
]
