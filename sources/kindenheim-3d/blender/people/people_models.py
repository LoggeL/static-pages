#!/usr/bin/env python3
"""
Procedural villagers and a dog for Kindenheim (pure python; see people_geo.py for the coordinate contract).

Every figure is skinned to ONE shared adult skeleton (SKELETON below, ~1.76 m). Body shape, clothing, hair,
hats and carried things differ per model; height and girth vary per instance at runtime (instance scale), colours
per instance through the colour slots. `human(spec, lod)` builds LOD0 (~3k triangles) or LOD1 (~0.8k).
"""

import math

from people_geo import (
    SLOT, Geo, add, clamp, cross, dot, ellipsoid, length, lerp, lerp3, loft, merge, mul, norm, rbox, ring,
    rot_x, rot_y, rot_z, smoothstep, sub, transform, tube, w_limb, w_mix, w_rigid, w_y_chain,
)

# ---------------------------------------------------------------------------------------------------------
# skeleton (glTF model space; +X = left, +Z = forward)
# ---------------------------------------------------------------------------------------------------------

def _mirror(p):
    return (-p[0], p[1], p[2])


_BASE = [
    ("hips", None, (0.0, 0.98, 0.0), (0.0, 1.08, 0.0)),
    ("spine", "hips", (0.0, 1.08, -0.005), (0.0, 1.24, -0.01)),
    ("chest", "spine", (0.0, 1.24, -0.01), (0.0, 1.44, -0.02)),
    ("neck", "chest", (0.0, 1.47, -0.02), (0.0, 1.56, -0.005)),
    ("head", "neck", (0.0, 1.565, 0.0), (0.0, 1.76, 0.0)),
]
_SIDE = [
    ("upperarm", "chest", (0.185, 1.415, -0.03), (0.21, 1.13, -0.045)),
    ("forearm", "upperarm", (0.21, 1.13, -0.045), (0.228, 0.885, -0.02)),
    ("hand", "forearm", (0.228, 0.885, -0.02), (0.232, 0.72, -0.005)),
    ("thigh", "hips", (0.09, 0.93, 0.0), (0.095, 0.505, 0.012)),
    ("shin", "thigh", (0.095, 0.505, 0.012), (0.10, 0.088, -0.025)),
    ("foot", "shin", (0.10, 0.088, -0.025), (0.104, 0.026, 0.115)),
    ("toe", "foot", (0.104, 0.026, 0.115), (0.105, 0.022, 0.185)),
]


def _build_skeleton():
    out = list(_BASE)
    for suffix, mirror in (("_L", False), ("_R", True)):
        for name, parent, head, tail in _SIDE:
            par = parent if parent in ("chest", "hips") else parent + suffix
            h = _mirror(head) if mirror else head
            t = _mirror(tail) if mirror else tail
            out.append((name + suffix, par, h, t))
    return out


SKELETON = _build_skeleton()
J = {name: head for name, _, head, _ in SKELETON}
TAIL = {name: tail for name, _, _, tail in SKELETON}


def side_name(base, s):
    return base + ("_L" if s > 0 else "_R")


# ---------------------------------------------------------------------------------------------------------
# body proportions
# ---------------------------------------------------------------------------------------------------------

# (y, half width, half depth, z centre)
TORSO_M = [
    (0.84, 0.115, 0.095, 0.0),
    (0.90, 0.165, 0.110, -0.010),
    (0.96, 0.175, 0.118, -0.015),
    (1.02, 0.168, 0.110, -0.005),
    (1.08, 0.158, 0.103, 0.0),
    (1.15, 0.160, 0.105, 0.003),
    (1.22, 0.168, 0.112, 0.005),
    (1.29, 0.178, 0.118, 0.006),
    (1.35, 0.186, 0.113, 0.0),
    (1.40, 0.195, 0.100, -0.012),
    (1.44, 0.175, 0.085, -0.018),
    (1.47, 0.120, 0.070, -0.020),
    (1.49, 0.065, 0.058, -0.020),
]
TORSO_F = [
    (0.84, 0.115, 0.095, 0.0),
    (0.90, 0.176, 0.112, -0.012),
    (0.96, 0.186, 0.120, -0.020),
    (1.02, 0.170, 0.108, -0.008),
    (1.08, 0.142, 0.095, 0.0),
    (1.15, 0.145, 0.095, 0.002),
    (1.21, 0.155, 0.104, 0.012),
    (1.27, 0.160, 0.121, 0.022),
    (1.33, 0.165, 0.110, 0.008),
    (1.39, 0.178, 0.095, -0.010),
    (1.43, 0.160, 0.080, -0.016),
    (1.465, 0.110, 0.066, -0.020),
    (1.485, 0.058, 0.052, -0.020),
]


class Body:
    def __init__(self, sex, belly=0.0):
        self.sex = sex
        self.belly = belly
        self.table = TORSO_F if sex == "f" else TORSO_M

    def profile(self, y):
        t = self.table
        if y <= t[0][0]:
            row = t[0]
            hw, hd, zc = row[1], row[2], row[3]
        elif y >= t[-1][0]:
            row = t[-1]
            hw, hd, zc = row[1], row[2], row[3]
        else:
            for a, b in zip(t, t[1:]):
                if a[0] <= y <= b[0]:
                    s = (y - a[0]) / (b[0] - a[0])
                    s = s * s * (3 - 2 * s) * 0.5 + s * 0.5
                    hw, hd, zc = lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)
                    break
        if self.belly > 0:
            bump = math.exp(-((y - 1.10) / 0.09) ** 2)
            hd += 0.075 * self.belly * bump
            zc += 0.055 * self.belly * bump
            hw += 0.022 * self.belly * math.exp(-((y - 1.06) / 0.12) ** 2)
        return hw, hd, zc

    def ring_at(self, y, n, grow=0.0, scale=1.0, power=2.5, flare=0.0):
        hw, hd, zc = self.profile(y)
        hw = hw * scale + grow + flare
        hd = hd * scale + grow + flare
        return ring((0.0, y, zc), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), hw, hd, n, power, phase=math.pi / 2)


def torso_weights(p):
    """Hips -> spine -> chest -> neck by height, crotch partly to the thighs, shoulder caps partly to the arms."""
    base = w_y_chain([(1.09, "hips", "spine", 0.05), (1.25, "spine", "chest", 0.06), (1.485, "chest", "neck", 0.015)])(p)
    x, y, z = p
    out = dict(base)
    # crotch / seat follow the thighs a little
    leg = 0.55 * smoothstep(0.97, 0.86, y) * smoothstep(0.015, 0.08, abs(x))
    if leg > 0:
        out = {k: v * (1 - leg) for k, v in out.items()}
        out[side_name("thigh", 1 if x > 0 else -1)] = leg
    arm = 0.32 * smoothstep(0.14, 0.195, abs(x)) * smoothstep(1.29, 1.37, y)
    if arm > 0:
        out = {k: v * (1 - arm) for k, v in out.items()}
        out[side_name("upperarm", 1 if x > 0 else -1)] = out.get(side_name("upperarm", 1 if x > 0 else -1), 0) + arm
    return out


def skirt_weights(top_y, hem_y, follow=0.6):
    """Skirt / coat tail: hips at the waist, partly following the thigh of its side towards the hem."""

    def fn(p):
        x, y, _ = p
        s = smoothstep(top_y, hem_y, y) * follow
        b = smoothstep(-0.07, 0.07, x)
        w = {"hips": 1.0 - s}
        if s > 0:
            w["thigh_L"] = s * b
            w["thigh_R"] = s * (1.0 - b)
        return w

    return fn


# ---------------------------------------------------------------------------------------------------------
# pieces
# ---------------------------------------------------------------------------------------------------------

def leg_path(s, kind, lod):
    """Leg tube for one side. kind: trousers | work | jeans | bare."""
    H, K, A = J[side_name("thigh", s)], J[side_name("shin", s)], J[side_name("foot", s)]
    hem_y = 0.105 if kind != "bare" else 0.07
    t_hem = (K[1] - hem_y) / (K[1] - A[1])
    loose = {"trousers": 1.0, "work": 1.12, "jeans": 0.94, "bare": 0.8}[kind]
    rows = [
        (add(H, (0.0, 0.04, 0.0)), 0.094, 0.100),
        (lerp3(H, K, 0.12), 0.090, 0.094),
        (lerp3(H, K, 0.40), 0.080, 0.084),
        (lerp3(H, K, 0.75), 0.066, 0.068),
        (K, 0.058, 0.061),
        (lerp3(K, A, 0.22), 0.057, 0.061),
        (lerp3(K, A, 0.50), 0.053, 0.055),
        (lerp3(K, A, 0.78), 0.050, 0.050),
        (lerp3(K, A, t_hem), 0.052, 0.054),
    ]
    if lod == 1:
        rows = [rows[i] for i in (0, 2, 4, 6, 8)]
    path, radii = [], []
    for i, (p, rs, rf) in enumerate(rows):
        f = loose
        if kind == "bare":
            # natural leg: calf shape, slim ankle
            f = [0.84, 0.82, 0.8, 0.78, 0.74, 0.78, 0.72, 0.6, 0.56][i if lod == 0 else (0, 2, 4, 6, 8)[i]]
        elif kind == "jeans" and p[1] < 0.45:
            f = 0.9
        elif kind in ("trousers", "work") and p[1] < 0.45:
            f = loose * 1.04  # straight trouser leg below the knee
        path.append(p)
        radii.append((rs * f, rf * f))
    return path, radii


def leg_weights(s):
    H, K, A = J[side_name("thigh", s)], J[side_name("shin", s)], J[side_name("foot", s)]
    B = J[side_name("toe", s)]
    return w_limb([H, K, A, B], ["hips", side_name("thigh", s), side_name("shin", s), side_name("foot", s)], [0.05, 0.05, 0.03])


def arm_joints(s):
    return J[side_name("upperarm", s)], J[side_name("forearm", s)], J[side_name("hand", s)]


def arm_weights(s):
    S, E, W = arm_joints(s)
    tip = TAIL[side_name("hand", s)]
    return w_limb([S, E, W, tip], ["chest", side_name("upperarm", s), side_name("forearm", s), side_name("hand", s)], [0.05, 0.035, 0.02])


def arm_tube(s, grow, y_end, lod, female=False, dome=True):
    S, E, W = arm_joints(s)
    f = 0.9 if female else 1.0
    # the tube starts a little below and inside the shoulder joint, so its dome stays under the torso's
    # shoulder slope (no padded-shoulder bump)
    S0 = add(S, (-s * 0.022, -0.042, 0.0))
    rows = [
        (S0, 0.046, 0.050),
        (lerp3(S, E, 0.35), 0.047, 0.049),
        (lerp3(S, E, 0.75), 0.042, 0.043),
        (E, 0.040, 0.041),
        (lerp3(E, W, 0.3), 0.040, 0.037),
        (lerp3(E, W, 0.7), 0.034, 0.030),
        (W, 0.030, 0.025),
    ]
    if lod == 1:
        rows = [rows[i] for i in (0, 3, 6)]
    # cut at y_end (sleeve end / wrist)
    path, radii = [], []
    for i, (p, rs, rf) in enumerate(rows):
        if p[1] < y_end - 1e-6:
            prev = rows[i - 1][0]
            t = (prev[1] - y_end) / (prev[1] - p[1])
            q = lerp3(prev, p, t)
            pr = rows[i - 1]
            path.append(q)
            radii.append((lerp(pr[1], rs, t) * f + grow, lerp(pr[2], rf, t) * f + grow))
            break
        path.append(p)
        radii.append((rs * f + grow, rf * f + grow))
    n = 12 if lod == 0 else 7
    return tube(path, radii, n=n, dome0=(2 if lod == 0 else 1) if dome else 0, cap1=True, fwd_hint=(0.0, 0.0, 1.0))


def hand_piece(g, s, lod):
    W = J[side_name("hand", s)]
    wfn = w_rigid(side_name("hand", s))
    if lod == 1:
        g.add(*rbox(add(W, (0.0, -0.08, 0.008)), (0.018, 0.085, 0.04), nu=6, nv=4, power=3.0), "skin", wfn)
        return
    palm = rbox(add(W, (-s * 0.002, -0.052, 0.006)), (0.017, 0.05, 0.041), nu=10, nv=6, power=3.0)
    g.add(*palm, "skin", wfn)
    y0 = W[1] - 0.09

    def curl(p):
        d = clamp((y0 - p[1]) / 0.07)
        return (p[0] - s * 0.016 * d * d, p[1] + 0.004 * d, p[2])

    fingers = transform(rbox(add(W, (-s * 0.004, -0.125, 0.009)), (0.014, 0.04, 0.038), nu=10, nv=6, power=3.0), curl)
    g.add(*fingers, "skin", wfn)
    thumb = tube([add(W, (-s * 0.008, -0.03, 0.034)), add(W, (-s * 0.016, -0.065, 0.046)), add(W, (-s * 0.022, -0.09, 0.044))],
                 [(0.011, 0.011), (0.010, 0.010), (0.009, 0.009)], n=6, dome0=0, dome1=1, cap0=True)
    g.add(*thumb, "skin", wfn)


def shoe_piece(g, s, kind, lod):
    A = J[side_name("foot", s)]
    x0 = A[0]
    foot_w = side_name("foot", s)
    toe_w = side_name("toe", s)

    def wfn(p):
        t = smoothstep(0.085, 0.14, p[2])
        return {foot_w: 1.0 - t, toe_w: t}

    # (z, half width, y bottom, y top)
    if kind in ("sneaker", "hiking"):
        rows = [(-0.088, 0.034, 0.02, 0.085), (-0.07, 0.042, 0.02, 0.11), (-0.02, 0.046, 0.02, 0.105), (0.05, 0.05, 0.02, 0.085),
                (0.11, 0.051, 0.02, 0.068), (0.16, 0.044, 0.02, 0.055), (0.19, 0.03, 0.022, 0.045), (0.2, 0.014, 0.026, 0.04)]
    elif kind == "leather":
        rows = [(-0.085, 0.032, 0.018, 0.075), (-0.07, 0.039, 0.018, 0.095), (-0.02, 0.043, 0.018, 0.092), (0.05, 0.047, 0.018, 0.078),
                (0.11, 0.048, 0.018, 0.06), (0.16, 0.04, 0.018, 0.045), (0.195, 0.026, 0.02, 0.036), (0.205, 0.012, 0.024, 0.032)]
    else:  # boots
        rows = [(-0.088, 0.036, 0.02, 0.10), (-0.07, 0.044, 0.02, 0.13), (-0.02, 0.048, 0.02, 0.13), (0.05, 0.051, 0.02, 0.095),
                (0.11, 0.052, 0.02, 0.075), (0.16, 0.046, 0.02, 0.06), (0.19, 0.032, 0.022, 0.05), (0.203, 0.015, 0.027, 0.044)]
    if lod == 1:
        rows = [rows[i] for i in (0, 2, 4, 6, 7)]
    n = 10 if lod == 0 else 6
    rings = []
    for z, hw, yb, yt in rows:
        xc = x0 + s * 0.004 * smoothstep(0.0, 0.18, z)
        rings.append(ring((xc, (yb + yt) * 0.5, z), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), hw, (yt - yb) * 0.5, n, power=2.6))
    g.add(*loft(rings, cap0=True, cap1=True), "shoes", wfn)
    # sole
    sole_slot = "sole" if kind == "sneaker" else "dark"
    srows = [(r[0], r[1] + 0.004) for r in rows]
    srings = []
    for z, hw in srows:
        xc = x0 + s * 0.004 * smoothstep(0.0, 0.18, z)
        srings.append(ring((xc, 0.014, z), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), hw, 0.0145, n, power=4.0))
    g.add(*loft(srings, cap0=True, cap1=True), sole_slot, wfn)
    if kind in ("rubber_boot", "ankle_boot", "hiking"):
        top = {"rubber_boot": 0.36, "ankle_boot": 0.2, "hiking": 0.15}[kind]
        r0 = 0.058 if kind == "rubber_boot" else 0.05
        K = J[side_name("shin", s)]
        pts = []
        rad = []
        steps = [0.06, 0.1, top - 0.03, top] if lod == 0 else [0.06, top]
        for y in steps:
            t = (K[1] - y) / (K[1] - A[1])
            pts.append(lerp3(K, A, t))
            rr = r0 + (0.004 if y > top - 0.04 else 0.0)
            rad.append((rr, rr * 1.04))
        shin_w = side_name("shin", s)

        def wshaft(p):
            t = smoothstep(0.1, 0.17, p[1])
            return {foot_w: 1.0 - t, shin_w: t}

        g.add(*tube(pts, rad, n=n + 2 if lod == 0 else n, cap0=True, cap1=True), "shoes", wshaft)


HEAD_C = (0.0, 1.645, 0.008)


def head_radii(sex):
    return (0.072, 0.099, 0.09) if sex == "f" else (0.076, 0.104, 0.094)


def head_piece(g, sex, lod):
    r = head_radii(sex)
    c = HEAD_C
    wfn = w_y_chain([(1.565, "neck", "head", 0.012)])

    def jaw(p, d):
        x, y, z = p
        s = smoothstep(c[1] - 0.015, c[1] - 0.095, y)
        x = c[0] + (x - c[0]) * (1.0 - 0.24 * s)
        z = z + 0.012 * s * max(d[2], 0.0)
        if d[2] > 0.4:
            z = c[2] + (z - c[2]) * (1.0 - 0.04 * (d[2] - 0.4))
        return (x, y, z)

    nu, nv = (16, 12) if lod == 0 else (9, 6)
    g.add(*ellipsoid(c, r, nu, nv, fn=jaw), "skin", wfn)
    # neck
    neck = tube([(0.0, 1.46, -0.02), (0.0, 1.53, -0.012), (0.0, 1.585, -0.002)],
                [(0.052, 0.05), (0.047, 0.046), (0.046, 0.045)] if sex == "m" else [(0.046, 0.045), (0.041, 0.041), (0.04, 0.04)],
                n=10 if lod == 0 else 6, cap0=True, cap1=True)
    g.add(*neck, "skin", w_y_chain([(1.485, "chest", "neck", 0.02), (1.565, "neck", "head", 0.02)]))
    if lod == 1:
        return
    hw = w_rigid("head")
    fz = c[2] + r[2]
    nose = transform(rbox((0.0, c[1] - 0.012, fz + 0.004), (0.011, 0.021, 0.014), nu=8, nv=5, power=2.6),
                     lambda p: (p[0], p[1], p[2] + 0.007 * clamp((c[1] - p[1]) / 0.03)))
    g.add(*nose, "skin", hw)
    for s in (1, -1):
        g.add(*ellipsoid((s * (r[0] + 0.001), c[1] - 0.004, c[2] - 0.012), (0.011, 0.028, 0.017), 8, 5), "skin", hw)
        g.add(*ellipsoid((s * 0.03, c[1] + 0.016, fz - 0.012), (0.0095, 0.0075, 0.006), 6, 4), "dark", hw)
        g.add(*rbox((s * 0.031, c[1] + 0.034, fz - 0.006), (0.017, 0.0042, 0.006), nu=6, nv=4, power=3.0), "hair", hw)
    g.add(*rbox((0.0, c[1] - 0.052, fz - 0.009), (0.017, 0.005, 0.006), nu=6, nv=4, power=3.0), "lip", hw)


def hairline_threshold(d, front=0.42, side=0.06, back=-0.62):
    f = d[2]
    if f >= 0:
        return lerp(side, front, f ** 0.8)
    return lerp(side, back, (-f) ** 1.2)


def hair_piece(g, style, sex, lod):
    r = head_radii(sex)
    c = HEAD_C
    hw = w_rigid("head")
    nu, nv = (18, 12) if lod == 0 else (9, 6)
    if style == "none":
        return

    def shell(k=(1.07, 1.06, 1.08), front=0.42, side=0.06, back=-0.62, top_vol=0.012, bumps=0.0, bald_top=None,
              drape=0.0):
        def fn(p, d):
            thr = hairline_threshold(d, front, side, back)
            cov = smoothstep(thr - 0.015, thr + 0.025, d[1])
            if bald_top is not None:
                cov *= 1.0 - smoothstep(bald_top - 0.04, bald_top + 0.04, d[1])
                cov *= 1.0 - smoothstep(0.3, 0.55, d[2])
            # uncovered skin: the shell tucks well inside the head (cheek / temple deformations never poke out)
            kk = [lerp(0.8, k[i], cov) for i in range(3)]
            bump = 1.0 + bumps * math.sin(11.0 * math.atan2(d[0], d[2])) * math.sin(9.0 * d[1]) * cov
            x = c[0] + d[0] * r[0] * kk[0] * bump
            y = c[1] + d[1] * r[1] * kk[1] * bump + top_vol * max(d[1], 0.0) * cov
            z = c[2] + d[2] * r[2] * kk[2] * bump
            if drape > 0 and d[2] < 0.35 and d[1] < 0.25:
                fall = (0.25 - d[1]) * cov * (1.0 - smoothstep(0.0, 0.35, d[2]))
                y -= drape * fall
                x = c[0] + (x - c[0]) * (1.0 + 0.18 * fall)
                z = c[2] + (z - c[2]) * (1.0 + 0.12 * fall) - 0.01 * fall
            return (x, y, z)

        return ellipsoid(c, (1.0, 1.0, 1.0), nu, nv, fn=lambda p, d: fn(p, d))

    if style == "short":
        g.add(*shell(), "hair", hw)
    elif style == "short_under_hat":
        g.add(*shell(k=(1.05, 1.03, 1.06), top_vol=0.0), "hair", hw)
    elif style == "curly":
        g.add(*shell(k=(1.14, 1.12, 1.14), front=0.36, back=-0.45, top_vol=0.02, bumps=0.05 if lod == 0 else 0.0), "hair", hw)
    elif style == "fringe":
        g.add(*shell(k=(1.05, 1.04, 1.06), front=0.2, side=-0.05, back=-0.55, top_vol=0.0, bald_top=0.35), "hair", hw)
    elif style == "bob":
        g.add(*shell(k=(1.1, 1.08, 1.1), front=0.4, side=-0.75, back=-1.1, top_vol=0.015, drape=0.09), "hair", hw)
    elif style == "ponytail":
        g.add(*shell(k=(1.06, 1.05, 1.07), front=0.42, side=0.02, back=-0.6, top_vol=0.01), "hair", hw)
        bz = c[2] - r[2] * 1.02
        pts = [(0.0, c[1] + 0.02, bz), (0.0, c[1] - 0.02, bz - 0.035), (0.0, c[1] - 0.09, bz - 0.04), (0.0, c[1] - 0.16, bz - 0.025)]
        rad = [(0.026, 0.024), (0.03, 0.028), (0.024, 0.022), (0.012, 0.012)]
        if lod == 1:
            pts, rad = pts[::3], rad[::3]

        def ptw(p):
            t = smoothstep(c[1] - 0.01, c[1] - 0.12, p[1])
            return {"head": 1.0 - 0.5 * t, "neck": 0.5 * t}

        g.add(*tube(pts, rad, n=8 if lod == 0 else 5, cap0=True, dome1=1 if lod == 0 else 0, cap1=lod == 1), "hair", ptw)
        if lod == 0:
            g.add(*tube([(0.0, c[1] + 0.012, bz - 0.012), (0.0, c[1] - 0.006, bz - 0.03)], [(0.03, 0.03), (0.03, 0.03)], n=8,
                        cap0=True, cap1=True), "dark", hw)
    else:
        raise ValueError(f"unknown hair style {style}")


def hat_piece(g, kind, sex, lod):
    if kind is None:
        return
    r = head_radii(sex)
    c = HEAD_C
    hw = w_rigid("head")
    nu, nv = (16, 8) if lod == 0 else (8, 4)
    if kind == "cap":
        crown = ellipsoid(add(c, (0.0, 0.03, -0.004)), (r[0] * 1.12, r[1] * 0.78, r[2] * 1.1), nu, nv, y_range=(-0.05, 1.0))
        g.add(*crown, "accA", hw)
        peak = transform(rbox((0.0, 0.0, 0.0), (0.07, 0.005, 0.05), nu=10 if lod == 0 else 6, nv=3, power=3.0),
                         lambda p: add(rot_x(p, 10.0), (0.0, c[1] + 0.03, c[2] + r[2] + 0.04)))
        g.add(*peak, "accA", hw)
    elif kind == "flatcap":
        crown = transform(ellipsoid((0.0, 0.0, 0.0), (r[0] * 1.17, 0.045, r[2] * 1.18), nu, nv, y_range=(-0.6, 1.0)),
                          lambda p: add(rot_x(p, 9.0), (0.0, c[1] + 0.058, c[2] + 0.012)))
        g.add(*crown, "accA", hw)
        peak = transform(rbox((0.0, 0.0, 0.0), (0.072, 0.005, 0.03), nu=10 if lod == 0 else 6, nv=3, power=3.0),
                         lambda p: add(rot_x(p, 14.0), (0.0, c[1] + 0.038, c[2] + r[2] + 0.02)))
        g.add(*peak, "accA", hw)
    elif kind == "beanie":
        crown = ellipsoid(add(c, (0.0, 0.025, -0.004)), (r[0] * 1.12, r[1] * 0.86, r[2] * 1.1), nu, nv, y_range=(-0.12, 1.0),
                          fn=lambda p, d: (p[0], p[1] + 0.012 * max(d[1], 0.0) ** 2, p[2]))
        g.add(*crown, "accA", hw)
        yb = c[1] + 0.025 - r[1] * 0.86 * 0.12
        band = loft([
            ring((0.0, yb - 0.004, c[2] - 0.004), (1, 0, 0), (0, 0, 1), r[0] * 1.17, r[2] * 1.15, nu, 2.0, math.pi / 2),
            ring((0.0, yb + 0.035, c[2] - 0.004), (1, 0, 0), (0, 0, 1), r[0] * 1.16, r[2] * 1.14, nu, 2.0, math.pi / 2),
        ], cap0=True, cap1=True)
        g.add(*band, "accA", hw)
    else:
        raise ValueError(f"unknown hat {kind}")


def glasses_piece(g, sex):
    r = head_radii(sex)
    c = HEAD_C
    fz = c[2] + r[2] + 0.002
    hw = w_rigid("head")
    for s in (1, -1):
        g.add(*rbox((s * 0.031, c[1] + 0.016, fz), (0.02, 0.014, 0.0025), nu=8, nv=4, power=3.0), "dark", hw)
        g.add(*rbox((s * (r[0] + 0.002), c[1] + 0.02, c[2] + 0.035), (0.0025, 0.0025, 0.05), nu=4, nv=3, power=3.0), "dark", hw)
    g.add(*rbox((0.0, c[1] + 0.02, fz + 0.001), (0.008, 0.002, 0.002), nu=4, nv=3), "dark", hw)


def collar_piece(g, kind, slot, sex, lod):
    nu = 14 if lod == 0 else 8
    cw = torso_weights
    if kind == "none":
        return
    if kind == "shirt":
        g.add(*loft([
            ring((0.0, 1.47, -0.016), (1, 0, 0), (0, 0, 1), 0.07, 0.066, nu, 2.0, math.pi / 2),
            ring((0.0, 1.505, -0.012), (1, 0, 0), (0, 0, 1), 0.062, 0.06, nu, 2.0, math.pi / 2),
        ], cap0=True, cap1=True), slot, cw)
    elif kind == "stand":
        g.add(*loft([
            ring((0.0, 1.465, -0.018), (1, 0, 0), (0, 0, 1), 0.08, 0.075, nu, 2.0, math.pi / 2),
            ring((0.0, 1.535, -0.012), (1, 0, 0), (0, 0, 1), 0.068, 0.066, nu, 2.0, math.pi / 2),
        ], cap0=True, cap1=True), slot, lambda p: w_y_chain([(1.5, "chest", "neck", 0.03)])(p))
    elif kind == "hood":
        g.add(*ellipsoid((0.0, 1.475, -0.085), (0.12, 0.06, 0.065), nu, 6 if lod == 0 else 4), slot, cw)
    elif kind == "scarf":
        g.add(*loft([
            ring((0.0, 1.455, -0.012), (1, 0, 0), (0, 0, 1), 0.082, 0.08, nu, 2.0, math.pi / 2),
            ring((0.0, 1.495, -0.008), (1, 0, 0), (0, 0, 1), 0.078, 0.076, nu, 2.0, math.pi / 2),
            ring((0.0, 1.53, -0.008), (1, 0, 0), (0, 0, 1), 0.068, 0.066, nu, 2.0, math.pi / 2),
        ], cap0=True, cap1=True), slot, lambda p: w_y_chain([(1.5, "chest", "neck", 0.03)])(p))
        if lod == 0:
            g.add(*rbox((0.045, 1.37, 0.115 if sex == "m" else 0.125), (0.032, 0.085, 0.012), nu=6, nv=4, power=4.0), slot, cw)
    else:
        raise ValueError(f"unknown collar {kind}")


def front_strip(g, body, y0, y1, grow, slot, lod):
    """Zip / button placket down the front of a top."""
    if lod == 1:
        return
    pts = []
    rad = []
    steps = 6
    for i in range(steps + 1):
        y = lerp(y0, y1, i / steps)
        hw, hd, zc = body.profile(y)
        pts.append((0.0, y, zc + hd + grow + 0.002))
        rad.append((0.006, 0.003))
    g.add(*tube(pts, rad, n=6, cap0=True, cap1=True, fwd_hint=(0.0, 0.0, 1.0), power=6.0), slot, torso_weights)


# ---------------------------------------------------------------------------------------------------------
# carried things
# ---------------------------------------------------------------------------------------------------------

def grip_point(s):
    W = J[side_name("hand", s)]
    return add(W, (-s * 0.004, -0.09, 0.012))


def bucket_piece(g, s, lod):
    G = grip_point(s)
    hw = w_rigid(side_name("hand", s))
    n = 14 if lod == 0 else 8
    top_y = G[1] - 0.13
    bot_y = top_y - 0.25
    rings = [
        ring((G[0], bot_y, G[2]), (1, 0, 0), (0, 0, 1), 0.098, 0.098, n),
        ring((G[0], top_y - 0.02, G[2]), (1, 0, 0), (0, 0, 1), 0.118, 0.118, n),
        ring((G[0], top_y, G[2]), (1, 0, 0), (0, 0, 1), 0.126, 0.126, n),
        ring((G[0], top_y - 0.012, G[2]), (1, 0, 0), (0, 0, 1), 0.116, 0.116, n),
    ]
    g.add(*loft(rings, cap0=True, cap1=False), "accC", hw)
    # grapes heaped in the bucket
    heap = ellipsoid((G[0], top_y - 0.01, G[2]), (0.112, 0.05, 0.112), n, 5 if lod == 0 else 3, y_range=(-0.3, 1.0),
                     fn=(lambda p, d: (p[0], p[1] + 0.008 * math.sin(13 * d[0]) * math.sin(11 * d[2]), p[2])) if lod == 0 else None)
    g.add(*heap, "grapes", hw)
    if lod == 0:
        arc = [add(G, (0.0, 0.0, 0.0))]
        pts = []
        for k in range(9):
            a = math.pi * k / 8
            pts.append((G[0], top_y + 0.005 + 0.12 * math.sin(a), G[2] + 0.125 * math.cos(a)))
        g.add(*tube(pts, [(0.006, 0.006)] * len(pts), n=5, cap0=True, cap1=True, fwd_hint=(1.0, 0.0, 0.0)), "dark", hw)


def tote_piece(g, s, lod):
    G = grip_point(s)
    hw = w_rigid(side_name("hand", s))
    body_c = (G[0], G[1] - 0.27, G[2] + 0.005)
    g.add(*rbox(body_c, (0.05, 0.17, 0.165), nu=12 if lod == 0 else 6, nv=6 if lod == 0 else 4, power=5.0,
                fn=lambda p, d: (p[0] + 0.012 * (1 - abs(d[1])) * (1 if d[0] > 0 else -1), p[1], p[2])), "accA", hw)
    # baguette and leek sticking out of the bag
    g.add(*tube([(G[0] + 0.012, G[1] - 0.36, G[2] + 0.09), (G[0] + 0.018, G[1] - 0.02, G[2] + 0.12)],
                [(0.024, 0.024), (0.022, 0.022)], n=8 if lod == 0 else 5, dome0=1, dome1=2 if lod == 0 else 1), "bread", hw)
    if lod == 0:
        g.add(*tube([(G[0] - 0.015, G[1] - 0.3, G[2] - 0.08), (G[0] - 0.02, G[1] - 0.06, G[2] - 0.1)],
                    [(0.014, 0.014), (0.02, 0.008)], n=6, cap0=True, cap1=True), "accB", hw)
        for dz in (-0.075, 0.075):
            pts = [(G[0], G[1] - 0.10, G[2] + dz), (G[0], G[1] - 0.02, G[2] + dz * 0.4), (G[0], G[1] + 0.005, G[2])]
            g.add(*tube(pts, [(0.006, 0.006)] * 3, n=4, cap0=True, cap1=True, fwd_hint=(1.0, 0.0, 0.0)), "accA", hw)


def handbag_piece(g, s, lod):
    G = grip_point(s)
    hw = w_rigid(side_name("hand", s))
    g.add(*rbox((G[0], G[1] - 0.15, G[2]), (0.045, 0.09, 0.12), nu=10 if lod == 0 else 6, nv=5 if lod == 0 else 3, power=4.0),
          "accA", hw)
    if lod == 0:
        pts = [(G[0], G[1] - 0.06, G[2] + 0.06), (G[0], G[1] - 0.0, G[2] + 0.03), (G[0], G[1] + 0.01, G[2] - 0.03),
               (G[0], G[1] - 0.06, G[2] - 0.06)]
        g.add(*tube(pts, [(0.007, 0.007)] * 4, n=5, cap0=True, cap1=True, fwd_hint=(1.0, 0.0, 0.0)), "accA", hw)
        g.add(*rbox((G[0] + s * 0.046, G[1] - 0.12, G[2]), (0.003, 0.012, 0.025), nu=4, nv=3), "metal", hw)


def backpack_piece(g, lod):
    cw = torso_weights
    g.add(*rbox((0.0, 1.235, -0.18), (0.13, 0.19, 0.075), nu=12 if lod == 0 else 6, nv=6 if lod == 0 else 4, power=4.0), "accB", cw)
    if lod == 0:
        g.add(*rbox((0.0, 1.14, -0.24), (0.1, 0.07, 0.03), nu=8, nv=4, power=4.0), "accB", cw)
        for s in (1, -1):
            pts = [(s * 0.09, 1.40, -0.15), (s * 0.11, 1.46, -0.07), (s * 0.12, 1.45, 0.03), (s * 0.12, 1.33, 0.12),
                   (s * 0.125, 1.18, 0.105)]
            g.add(*tube(pts, [(0.02, 0.006)] * len(pts), n=6, cap0=True, cap1=True, power=4.0, fwd_hint=(0.0, 1.0, 0.0)), "dark", cw)


def kneepads_piece(g, lod):
    if lod == 1:
        return
    for s in (1, -1):
        K = J[side_name("shin", s)]
        g.add(*rbox(add(K, (0.0, 0.0, 0.066)), (0.052, 0.075, 0.018), nu=8, nv=4, power=4.0), "accB",
              lambda p, s=s: {side_name("thigh", s): 0.5, side_name("shin", s): 0.5})


# ---------------------------------------------------------------------------------------------------------
# a whole villager
# ---------------------------------------------------------------------------------------------------------

def human(spec, lod):
    sex = spec["sex"]
    body = Body(sex, spec.get("belly", 0.0))
    g = Geo(spec["name"])
    nt = 18 if lod == 0 else 10
    female = sex == "f"
    top = spec["top"]
    hem = top["hem"]
    top_grow = top.get("grow", 0.012)
    bottom = spec["bottom"]

    # -- pelvis / trousers (or skirt waist) --------------------------------------------------------------
    pel_top = max(hem + 0.05, 0.98) if hem > 0.84 else 1.0
    ys = [0.84, 0.88, 0.92, 0.96, 1.0, 1.04, 1.08, 1.12, 1.16]
    ys = [y for y in ys if y < pel_top - 0.008] + [pel_top]
    if lod == 1:
        ys = [ys[0], ys[len(ys) // 2], ys[-1]]
    bottom_grow = {"trousers": 0.008, "work": 0.012, "jeans": 0.006, "skirt": 0.004}[bottom["kind"]]
    g.add(*loft([body.ring_at(y, nt, grow=bottom_grow) for y in ys], cap0=True, cap1=True), "bottom", torso_weights)

    # -- legs ----------------------------------------------------------------------------------------------
    leg_kind = "bare" if bottom["kind"] == "skirt" else bottom["kind"]
    leg_slot = "accB" if bottom["kind"] == "skirt" else "bottom"  # tights under a skirt
    nl = 14 if lod == 0 else 8
    for s in (1, -1):
        path, radii = leg_path(s, leg_kind, lod)
        g.add(*tube(path, radii, n=nl, cap0=True, cap1=True), leg_slot, leg_weights(s))
    if bottom["kind"] == "skirt":
        hem_y = bottom["hem"]
        sk = []
        steps = [1.02, 0.96, 0.88, 0.78, 0.68, hem_y] if lod == 0 else [1.02, 0.88, hem_y]
        for y in steps:
            t = smoothstep(1.02, hem_y, y)
            hw, hd, zc = body.profile(max(y, 0.9))
            sk.append(ring((0.0, y, zc - 0.01 * t), (1, 0, 0), (0, 0, 1), hw + 0.012 + 0.05 * t, hd + 0.016 + 0.05 * t, nt, 2.2,
                           math.pi / 2))
        g.add(*loft(sk, cap0=True, cap1=False), "bottom", skirt_weights(1.0, hem_y, 0.55))
    if spec.get("belt"):
        g.add(*loft([body.ring_at(y, nt, grow=bottom_grow + 0.005) for y in (1.0, 1.032)], cap0=True, cap1=True), "dark",
              torso_weights)
    if spec.get("kneepads"):
        kneepads_piece(g, lod)

    # -- top (jacket / coat / shirt) -------------------------------------------------------------------------
    top_ys = []
    if hem < 0.84:
        # coat tail below the seat: widens towards the hem and partly follows the legs
        tail = [hem, (hem + 0.84) * 0.5, 0.84] if lod == 0 else [hem, 0.84]
        top_ys += tail
    base = [0.86, 0.9, 0.96, 1.02, 1.08, 1.15, 1.22, 1.29, 1.35, 1.40, 1.44, 1.47, 1.49]
    if lod == 1:
        base = [0.9, 1.02, 1.15, 1.29, 1.40, 1.47, 1.49]
    top_ys += [y for y in base if y > max(hem, 0.84) + 0.015]
    top_rings = []
    # hem flare ring for tops ending above the seat
    if hem >= 0.84:
        top_rings.append(body.ring_at(hem, nt, grow=top_grow + 0.008))
        top_rings.append(body.ring_at(hem + 0.012, nt, grow=top_grow + 0.006))
    for y in top_ys:
        if y < 0.84:
            t = (0.84 - y) / max(0.84 - hem, 1e-3)
            hw, hd, zc = body.profile(0.9)
            top_rings.append(ring((0.0, y, zc - 0.005), (1, 0, 0), (0, 0, 1), hw + top_grow + 0.01 + 0.04 * t,
                                  hd + top_grow + 0.02 + 0.03 * t, nt, 2.3, math.pi / 2))
        else:
            top_rings.append(body.ring_at(y, nt, grow=top_grow * (1.0 if y < 1.45 else 0.5)))
    if hem < 0.84:
        coat_w = lambda p: (skirt_weights(0.88, hem, 0.6)(p) if p[1] < 0.88 else torso_weights(p))
        g.add(*loft(top_rings, cap0=False, cap1=True), "top", coat_w)
    else:
        g.add(*loft(top_rings, cap0=False, cap1=True), "top", torso_weights)
    if top.get("vest"):
        # sleeveless body warmer over a shirt: the sleeves come in the shirt colour (accC)
        pass
    if top.get("zip"):
        front_strip(g, body, max(hem, 0.86) + 0.01, 1.46, top_grow, "dark" if top.get("zip") == "dark" else "accC", lod)
    collar_piece(g, top.get("collar", "none"), top.get("collar_slot", "top"), sex, lod)

    # -- arms ----------------------------------------------------------------------------------------------
    sleeve_slot = "accC" if top.get("vest") else "top"
    for s in (1, -1):
        aw = arm_weights(s)
        if top.get("sleeve", "long") == "short":
            g.add(*arm_tube(s, 0.0, 0.89, lod, female), "skin", aw)
            g.add(*arm_tube(s, 0.016, 1.24, lod, female), sleeve_slot, aw)
        else:
            g.add(*arm_tube(s, top_grow * 0.9, 0.9, lod, female), sleeve_slot, aw)
            if lod == 0:
                # cuff
                S, E, W = arm_joints(s)
                t = (E[1] - 0.915) / (E[1] - W[1])
                cpt = lerp3(E, W, t)
                axis = norm(sub(W, E))
                g.add(*tube([sub(cpt, mul(axis, 0.012)), add(cpt, mul(axis, 0.012))], [(0.046, 0.042), (0.046, 0.042)], n=10,
                            cap0=True, cap1=True), sleeve_slot, aw)
            # wrist skin between cuff and hand
            S, E, W = arm_joints(s)
            g.add(*tube([lerp3(E, W, 0.8), W], [(0.031, 0.027), (0.029, 0.024)], n=8 if lod == 0 else 5, cap0=True, cap1=True),
                  "skin", aw)
        hand_piece(g, s, lod)

    # -- head, hair, hat ----------------------------------------------------------------------------------
    head_piece(g, sex, lod)
    hair_piece(g, spec["hair"], sex, lod)
    hat_piece(g, spec.get("hat"), sex, lod)
    if spec.get("glasses") and lod == 0:
        glasses_piece(g, sex)

    # -- shoes ---------------------------------------------------------------------------------------------
    for s in (1, -1):
        shoe_piece(g, s, spec["shoes"], lod)

    # -- carried things -------------------------------------------------------------------------------------
    for item in spec.get("items", []):
        if item == "bucketR":
            bucket_piece(g, -1, lod)
        elif item == "toteR":
            tote_piece(g, -1, lod)
        elif item == "handbagL":
            handbag_piece(g, 1, lod)
        elif item == "backpack":
            backpack_piece(g, lod)
        else:
            raise ValueError(f"unknown item {item}")
    return g


# ---------------------------------------------------------------------------------------------------------
# the villagers (colour palettes are sRGB hex; slot names see people_geo.SLOT)
# ---------------------------------------------------------------------------------------------------------

SKIN = ["#e8c3a8", "#e0b597", "#d9a98a", "#cf9c7c", "#c08a68", "#a8734f", "#8a5a3c", "#6b4430"]
HAIR_YOUNG = ["#2a211c", "#3b2a20", "#4f3726", "#6a4a30", "#8f6a43", "#b08d57", "#c6a771", "#6e3220", "#1c1a19"]
HAIR_MID = ["#2f2620", "#4a3829", "#5d4a3a", "#7a6e66", "#8f8b86", "#a19c96"]
HAIR_OLD = ["#b9b5ae", "#cfcbc4", "#a6a29c", "#d8d4cd", "#8f8b86"]

MODELS = [
    {
        "name": "vintner_bucket",
        "label": "Winzer mit Lesekübel",
        "sex": "m",
        "top": {"hem": 1.0, "collar": "stand", "zip": "dark", "grow": 0.014},
        "bottom": {"kind": "work"},
        "kneepads": True,
        "shoes": "rubber_boot",
        "hair": "short_under_hat",
        "hat": "cap",
        "items": ["bucketR"],
        "anim": {"style": "carryR", "speed": [1.05, 1.3], "stride": 1.34},
        "scale": [0.97, 1.06],
        "palettes": {
            "skin": SKIN, "hair": HAIR_YOUNG + HAIR_MID,
            "top": ["#3d4a36", "#3b3d40", "#2c3445", "#57583f", "#5a3a2c"],
            "bottom": ["#3a3b3d", "#4a4b38", "#2a3040", "#45403a"],
            "shoes": ["#2a3326", "#1f1f1f", "#2b2b2f"],
            "accA": ["#2c4a2f", "#7a2a22", "#2a2f3a", "#8a7a55", "#c2b8a3"],
            "accB": ["#1e1e1e", "#2c2c2c"],
            "accC": ["#b02a24", "#2f6b34", "#1f2328", "#c9a227"],
        },
    },
    {
        "name": "vintner_overall",
        "label": "Winzer im Arbeitsanzug",
        "sex": "m",
        "belly": 0.35,
        "top": {"hem": 1.02, "collar": "shirt", "collar_slot": "accC", "zip": "dark", "grow": 0.016},
        "bottom": {"kind": "work"},
        "shoes": "ankle_boot",
        "hair": "short_under_hat",
        "hat": "flatcap",
        "anim": {"style": "normal", "speed": [1.0, 1.25], "stride": 1.32},
        "scale": [0.96, 1.04],
        "link": {"bottom": "top"},
        "palettes": {
            "skin": SKIN[:6], "hair": HAIR_MID + HAIR_OLD,
            "top": ["#2d4a7a", "#3a5240", "#4a3f33", "#29405e"],
            "bottom": ["#2d4a7a"],
            "shoes": ["#3a2a1e", "#262422", "#4a3626"],
            "accA": ["#4a4440", "#5a5048", "#3c3f44", "#6b5a45"],
            "accB": ["#2a2a2a"],
            "accC": ["#c9c4b8", "#a9b4c4", "#b8a890"],
        },
    },
    {
        "name": "elder_man",
        "label": "Älterer Herr mit Schiebermütze",
        "sex": "m",
        "belly": 0.2,
        "top": {"hem": 0.92, "collar": "shirt", "collar_slot": "accC", "zip": "accC", "grow": 0.013},
        "bottom": {"kind": "trousers"},
        "shoes": "leather",
        "hair": "fringe",
        "hat": "flatcap",
        "glasses": True,
        "anim": {"style": "elderly", "speed": [0.8, 1.0], "stride": 1.08},
        "scale": [0.94, 1.01],
        "palettes": {
            "skin": SKIN[:6], "hair": HAIR_OLD,
            "top": ["#5b5547", "#4a4f45", "#3f4450", "#6a5c48", "#4d4038"],
            "bottom": ["#5a5852", "#3f3f40", "#6b6456", "#4a4538"],
            "shoes": ["#2b1f18", "#1c1a19", "#4a3324"],
            "accA": ["#5a5246", "#4a4a46", "#665a48", "#3e3a36"],
            "accB": ["#2a2a2a"],
            "accC": ["#d8d3c8", "#b9c3cf", "#cfc0a8"],
        },
    },
    {
        "name": "elder_woman",
        "label": "Ältere Dame mit Handtasche",
        "sex": "f",
        "top": {"hem": 0.78, "collar": "stand", "zip": "accC", "grow": 0.016},
        "bottom": {"kind": "skirt", "hem": 0.55},
        "shoes": "leather",
        "hair": "curly",
        "glasses": True,
        "items": ["handbagL"],
        "anim": {"style": "elderlyCarryL", "speed": [0.75, 0.95], "stride": 1.0},
        "scale": [0.9, 0.97],
        "palettes": {
            "skin": SKIN[:6], "hair": HAIR_OLD + ["#c4bcc8"],
            "top": ["#6b4a52", "#4a5a6a", "#7a6a55", "#3f4a3f", "#8a8378", "#5a4a6a"],
            "bottom": ["#3a3a42", "#4a3f3a", "#5a5a5e", "#2f3444"],
            "shoes": ["#1c1a19", "#3a2a22", "#4a4642"],
            "accA": ["#1f1c1b", "#4a2a22", "#6a2a30", "#5a4636"],
            "accB": ["#a89888", "#5a5652", "#2f3444", "#8a7a6a"],
            "accC": ["#3a3533", "#c9c0b0"],
        },
    },
    {
        "name": "shopper_woman",
        "label": "Frau mit Einkaufstasche (Bäcker)",
        "sex": "f",
        "top": {"hem": 0.97, "collar": "stand", "zip": "accC", "grow": 0.02},
        "bottom": {"kind": "jeans"},
        "shoes": "sneaker",
        "hair": "ponytail",
        "items": ["toteR"],
        "anim": {"style": "carryR", "speed": [1.1, 1.38], "stride": 1.3},
        "scale": [0.92, 0.99],
        "palettes": {
            "skin": SKIN, "hair": HAIR_YOUNG,
            "top": ["#2f3a4a", "#6a2a2c", "#3f4a3a", "#c9b79a", "#1f2226", "#7a6a5a", "#4a5a7a"],
            "bottom": ["#2c3a52", "#3a4458", "#1f2430", "#4a5468"],
            "shoes": ["#d9d6cf", "#c9c4bc", "#3a3a3e", "#8a8f99"],
            "accA": ["#cfc3a5", "#2f3a52", "#3f5a3a", "#8a2a26", "#d8d2c4"],
            "accB": ["#4a7a2a", "#5a8a32"],
            "accC": ["#c9c4bc", "#2a2a2a"],
        },
    },
    {
        "name": "casual_man",
        "label": "Mann im Kapuzenpulli",
        "sex": "m",
        "top": {"hem": 0.99, "collar": "hood", "grow": 0.016},
        "bottom": {"kind": "jeans"},
        "shoes": "sneaker",
        "hair": "short",
        "anim": {"style": "normal", "speed": [1.2, 1.5], "stride": 1.42},
        "scale": [0.97, 1.07],
        "palettes": {
            "skin": SKIN, "hair": HAIR_YOUNG,
            "top": ["#4a4f58", "#2a3a52", "#5a2a2a", "#3f4a3a", "#8a8a86", "#1f2226", "#6a5a4a"],
            "bottom": ["#2c3a52", "#3a4458", "#1f2430", "#4a4a4c"],
            "shoes": ["#d9d6cf", "#2a2a2e", "#5a5a60", "#c9c4bc"],
            "accA": ["#2a2a2a"], "accB": ["#2a2a2a"], "accC": ["#2a2a2a"],
        },
    },
    {
        "name": "coat_woman",
        "label": "Frau im Mantel mit Schal",
        "sex": "f",
        "top": {"hem": 0.72, "collar": "scarf", "collar_slot": "accA", "zip": "accC", "grow": 0.018},
        "bottom": {"kind": "trousers"},
        "shoes": "ankle_boot",
        "hair": "bob",
        "anim": {"style": "normal", "speed": [1.1, 1.35], "stride": 1.3},
        "scale": [0.92, 1.0],
        "palettes": {
            "skin": SKIN, "hair": HAIR_YOUNG + HAIR_MID[:3],
            "top": ["#8a6a48", "#3a3f4a", "#5a2f30", "#6a6a5e", "#2a2c30", "#7a5a3a"],
            "bottom": ["#1f2226", "#2c3444", "#3a3634", "#4a4642"],
            "shoes": ["#2a1f18", "#1c1a19", "#4a3324"],
            "accA": ["#b03a2e", "#c9a45a", "#3a5a7a", "#d8d0c0", "#6a4a7a", "#2f5a4a"],
            "accB": ["#2a2a2a"],
            "accC": ["#2a2522", "#3a302a"],
        },
    },
    {
        "name": "dog_walker",
        "label": "Hundebesitzer mit Regenjacke",
        "sex": "m",
        "top": {"hem": 0.9, "collar": "stand", "zip": "dark", "grow": 0.018},
        "bottom": {"kind": "trousers"},
        "shoes": "hiking",
        "hair": "short_under_hat",
        "hat": "beanie",
        "anim": {"style": "leashL", "speed": [1.05, 1.3], "stride": 1.36},
        "scale": [0.96, 1.05],
        "dog": True,
        "palettes": {
            "skin": SKIN, "hair": HAIR_YOUNG + HAIR_MID,
            "top": ["#a8342a", "#2f5a8a", "#c9a227", "#3a6a3a", "#2a2f3a", "#d0661f"],
            "bottom": ["#3a3b3d", "#4a4b40", "#2a3040", "#5a5248"],
            "shoes": ["#5a4a3a", "#3a3a3e", "#6a5a44"],
            "accA": ["#2a2a2e", "#6a2a26", "#3a4a5a", "#8a8378", "#c9a45a"],
            "accB": ["#2a2a2a"], "accC": ["#2a2a2a"],
        },
    },
    {
        "name": "young_man",
        "label": "Junger Mann mit Rucksack",
        "sex": "m",
        "top": {"hem": 0.98, "collar": "none", "sleeve": "short", "grow": 0.012},
        "bottom": {"kind": "jeans"},
        "shoes": "sneaker",
        "hair": "short",
        "items": ["backpack"],
        "anim": {"style": "normal", "speed": [1.25, 1.55], "stride": 1.46},
        "scale": [0.98, 1.08],
        "palettes": {
            "skin": SKIN, "hair": HAIR_YOUNG,
            "top": ["#e6e2da", "#2a2c30", "#4a5a7a", "#7a2a2c", "#5a6a4a", "#c9a45a", "#8a8f99"],
            "bottom": ["#2c3a52", "#3a4458", "#1f2430", "#4a4a4c", "#6a6456"],
            "shoes": ["#d9d6cf", "#2a2a2e", "#8a2a26", "#c9c4bc"],
            "accA": ["#2a2a2a"],
            "accB": ["#2a2c30", "#3a4a5a", "#5a2a26", "#4a5a3a", "#c9a45a"],
            "accC": ["#2a2a2a"],
        },
    },
    {
        "name": "heavy_man",
        "label": "Kräftiger Mann im Karohemd",
        "sex": "m",
        "belly": 1.0,
        "top": {"hem": 1.035, "collar": "shirt", "zip": "accC", "grow": 0.01},
        "bottom": {"kind": "trousers"},
        "belt": True,
        "shoes": "leather",
        "hair": "fringe",
        "anim": {"style": "normal", "speed": [0.95, 1.2], "stride": 1.3},
        "scale": [0.97, 1.05],
        "palettes": {
            "skin": SKIN[:6], "hair": HAIR_MID + HAIR_OLD,
            "top": ["#7a3a34", "#3a5a7a", "#5a6a4a", "#8a7a5a", "#c9c0ae", "#4a4a6a"],
            "bottom": ["#8a7a62", "#4a4a4c", "#5a5446", "#3a3f4a"],
            "shoes": ["#2b1f18", "#1c1a19", "#4a3324"],
            "accA": ["#2a2a2a"], "accB": ["#2a2a2a"],
            "accC": ["#2a2a2a", "#e0dcd2"],
        },
    },
]


# ---------------------------------------------------------------------------------------------------------
# dog
# ---------------------------------------------------------------------------------------------------------

DOG_SKELETON = [
    ("d_hips", None, (0.0, 0.50, -0.26), (0.0, 0.51, -0.06)),
    ("d_spine", "d_hips", (0.0, 0.51, -0.06), (0.0, 0.52, 0.14)),
    ("d_chest", "d_spine", (0.0, 0.52, 0.14), (0.0, 0.56, 0.26)),
    ("d_neck", "d_chest", (0.0, 0.56, 0.26), (0.0, 0.68, 0.35)),
    ("d_head", "d_neck", (0.0, 0.68, 0.35), (0.0, 0.70, 0.55)),
    ("d_tail1", "d_hips", (0.0, 0.55, -0.37), (0.0, 0.58, -0.5)),
    ("d_tail2", "d_tail1", (0.0, 0.58, -0.5), (0.0, 0.64, -0.62)),
]
for _sfx, _s in (("_L", 1), ("_R", -1)):
    DOG_SKELETON += [
        ("d_fupper" + _sfx, "d_chest", (_s * 0.075, 0.48, 0.2), (_s * 0.08, 0.31, 0.15)),
        ("d_ffore" + _sfx, "d_fupper" + _sfx, (_s * 0.08, 0.31, 0.15), (_s * 0.08, 0.075, 0.165)),
        ("d_fpaw" + _sfx, "d_ffore" + _sfx, (_s * 0.08, 0.075, 0.165), (_s * 0.08, 0.02, 0.215)),
        ("d_hthigh" + _sfx, "d_hips", (_s * 0.075, 0.49, -0.29), (_s * 0.08, 0.33, -0.2)),
        ("d_hshin" + _sfx, "d_hthigh" + _sfx, (_s * 0.08, 0.33, -0.2), (_s * 0.08, 0.16, -0.33)),
        ("d_hmeta" + _sfx, "d_hshin" + _sfx, (_s * 0.08, 0.16, -0.33), (_s * 0.08, 0.02, -0.29)),
    ]
DJ = {name: head for name, _, head, _ in DOG_SKELETON}
DTAIL = {name: tail for name, _, _, tail in DOG_SKELETON}


def dog(lod):
    g = Geo("dog")
    n = 14 if lod == 0 else 8
    # body along the spine
    spine_pts = [(0.0, 0.5, -0.38), (0.0, 0.505, -0.3), (0.0, 0.51, -0.16), (0.0, 0.505, 0.0), (0.0, 0.52, 0.14),
                 (0.0, 0.535, 0.24), (0.0, 0.55, 0.3)]
    spine_r = [(0.085, 0.1), (0.105, 0.125), (0.1, 0.118), (0.098, 0.12), (0.112, 0.15), (0.11, 0.14), (0.085, 0.1)]
    if lod == 1:
        spine_pts, spine_r = spine_pts[::2], spine_r[::2]

    def body_w(p):
        z = p[2]
        a = smoothstep(-0.12, 0.0, z)
        b = smoothstep(0.08, 0.2, z)
        w = {"d_hips": 1.0 - a, "d_spine": a * (1.0 - b), "d_chest": a * b}
        return w

    def belly(p):
        # lighter chest / belly: handled with a separate slot piece below
        return p

    g.add(*tube(spine_pts, spine_r, n=n, dome0=2 if lod == 0 else 1, dome1=1, fwd_hint=(0.0, 1.0, 0.0)), "skin", body_w)
    # chest / belly patch (secondary fur colour)
    if lod == 0:
        g.add(*ellipsoid((0.0, 0.44, 0.17), (0.07, 0.09, 0.09), 10, 6), "hair", body_w)
    # neck
    neck_pts = [(0.0, 0.53, 0.24), (0.0, 0.6, 0.31), (0.0, 0.68, 0.36)]
    g.add(*tube(neck_pts, [(0.085, 0.1), (0.07, 0.075), (0.062, 0.066)], n=n - 2 if lod == 0 else n, cap0=True, cap1=True,
                fwd_hint=(0.0, 1.0, 0.0)),
          "skin", w_limb([DJ["d_chest"], DJ["d_neck"], DJ["d_head"], DTAIL["d_head"]], ["d_spine", "d_chest", "d_neck", "d_head"],
                         [0.04, 0.05, 0.04]))
    # collar
    g.add(*tube([(0.0, 0.6, 0.305), (0.0, 0.625, 0.32)], [(0.074, 0.078), (0.072, 0.076)], n=n, cap0=True, cap1=True,
                fwd_hint=(0.0, 1.0, 0.0)), "accA", w_rigid("d_neck"))
    hw = w_rigid("d_head")
    # skull + muzzle
    g.add(*ellipsoid((0.0, 0.72, 0.4), (0.068, 0.07, 0.085), n, 8 if lod == 0 else 5), "skin", hw)
    g.add(*rbox((0.0, 0.69, 0.5), (0.04, 0.038, 0.065), nu=10 if lod == 0 else 6, nv=6 if lod == 0 else 4, power=2.6,
                fn=lambda p, d: (p[0], p[1] - 0.012 * max(d[2], 0), p[2])), "hair", hw)
    g.add(*ellipsoid((0.0, 0.7, 0.565), (0.018, 0.014, 0.012), 6, 4), "nose", hw)
    if lod == 0:
        for s in (1, -1):
            g.add(*ellipsoid((s * 0.04, 0.735, 0.47), (0.008, 0.008, 0.005), 6, 4), "nose", hw)
            ear = transform(rbox((0.0, 0.0, 0.0), (0.012, 0.06, 0.04), nu=8, nv=5, power=2.6),
                            lambda p, s=s: add(rot_z(p, s * -18.0), (s * 0.068, 0.715, 0.385)))
            g.add(*ear, "skin", hw)
    # tail
    tail_pts = [DJ["d_tail1"], lerp3(DJ["d_tail1"], DJ["d_tail2"], 0.5), DJ["d_tail2"], DTAIL["d_tail2"]]
    g.add(*tube(tail_pts, [(0.03, 0.03), (0.026, 0.026), (0.022, 0.022), (0.012, 0.012)], n=7 if lod == 0 else 5, cap0=True,
                dome1=1, fwd_hint=(0.0, 1.0, 0.0)),
          "skin", w_limb([DJ["d_tail1"], DJ["d_tail2"], DTAIL["d_tail2"]], ["d_hips", "d_tail1", "d_tail2"], [0.03, 0.05]))
    # legs
    nl = 9 if lod == 0 else 6
    for sfx, s in (("_L", 1), ("_R", -1)):
        up, fo, pw = "d_fupper" + sfx, "d_ffore" + sfx, "d_fpaw" + sfx
        pts = [add(DJ[up], (0.0, 0.05, 0.01)), DJ[up], lerp3(DJ[up], DJ[fo], 0.5), DJ[fo], lerp3(DJ[fo], DJ[pw], 0.5), DJ[pw]]
        rad = [(0.05, 0.065), (0.048, 0.06), (0.04, 0.045), (0.032, 0.034), (0.026, 0.026), (0.024, 0.025)]
        if lod == 1:
            pts, rad = [pts[0], pts[3], pts[5]], [rad[0], rad[3], rad[5]]
        g.add(*tube(pts, rad, n=nl, cap0=True, cap1=True),
              "skin", w_limb([DJ[up], DJ[fo], DJ[pw], DTAIL[pw]], ["d_chest", up, fo, pw], [0.04, 0.03, 0.02]))
        g.add(*rbox((DJ[pw][0], 0.022, DJ[pw][2] + 0.025), (0.028, 0.02, 0.04), nu=8 if lod == 0 else 5, nv=4, power=3.0), "hair",
              w_rigid(pw))
        th, sh, mt = "d_hthigh" + sfx, "d_hshin" + sfx, "d_hmeta" + sfx
        pts = [add(DJ[th], (0.0, 0.04, 0.0)), lerp3(DJ[th], DJ[sh], 0.45), DJ[sh], lerp3(DJ[sh], DJ[mt], 0.5), DJ[mt], DTAIL[mt]]
        rad = [(0.06, 0.09), (0.055, 0.08), (0.036, 0.042), (0.028, 0.03), (0.024, 0.026), (0.023, 0.024)]
        if lod == 1:
            pts, rad = [pts[0], pts[2], pts[4], pts[5]], [rad[0], rad[2], rad[4], rad[5]]
        g.add(*tube(pts, rad, n=nl, cap0=True, cap1=True),
              "skin", w_limb([DJ[th], DJ[sh], DJ[mt], DTAIL[mt]], ["d_hips", th, sh, mt], [0.05, 0.03, 0.02]))
        g.add(*rbox((DTAIL[mt][0], 0.022, DTAIL[mt][2] + 0.03), (0.028, 0.02, 0.04), nu=8 if lod == 0 else 5, nv=4, power=3.0), "hair",
              w_rigid(mt))
    return g


DOG = {
    "name": "dog",
    "label": "Hund",
    "anim": {"style": "dog", "stride": 0.95},
    "scale": [0.85, 1.12],
    "palettes": {
        # skin slot = main fur, hair slot = secondary (muzzle, chest, paws), accA = collar
        "skin": ["#2a2420", "#6a4a2c", "#c9a46a", "#d8c29a", "#8a5a34", "#1c1a19", "#b07a44", "#5a5048"],
        "hair": ["#d8cdb8", "#c9b08a", "#3a2e26", "#e6dccb", "#8a6a48"],
        "accA": ["#b02a24", "#2a4a8a", "#2f6b34", "#c9a227", "#1f1f1f"],
    },
}
