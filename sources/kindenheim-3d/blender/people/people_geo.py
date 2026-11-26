#!/usr/bin/env python3
"""
Pure-python geometry kernel for the Kindenheim villagers (no bpy here, so it can be unit-checked anywhere).

COORDINATE CONTRACT (glTF / three.js model space)
- +X = the figure's LEFT, +Y = up (0 = shoe sole on the ground), +Z = forward (the figure faces +Z).
- `build_people.py` converts to Blender with gl_to_bl(x, y, z) = (x, -z, y); the exporter (export_yup) writes
  these coordinates back unchanged.

A `Geo` collects vertices with
- a colour SLOT (0..7 = per-instance palette entries chosen at runtime, 8.. = fixed colours, see SLOT_FIXED),
- a SHADE factor (cavity darkening, 1 = none),
- skin WEIGHTS {bone: weight} (at most 4 bones after normalisation).
Every piece is a closed (or deliberately open) surface; overlaps hide the seams, so no booleans are needed.
"""

import math

# ---------------------------------------------------------------------------------------------------------
# small vector helpers (tuples)
# ---------------------------------------------------------------------------------------------------------

def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a):
    return math.sqrt(dot(a, a))


def norm(a):
    ln = length(a)
    if ln < 1e-12:
        raise ValueError(f"cannot normalise a zero vector {a}")
    return (a[0] / ln, a[1] / ln, a[2] / ln)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp3(a, b, t):
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def smoothstep(e0, e1, x):
    if e0 == e1:
        return 0.0 if x < e0 else 1.0
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)


def rot_x(p, deg, about=(0.0, 0.0, 0.0)):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    x, y, z = sub(p, about)
    return add((x, y * c - z * s, y * s + z * c), about)


def rot_y(p, deg, about=(0.0, 0.0, 0.0)):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    x, y, z = sub(p, about)
    return add((x * c + z * s, y, -x * s + z * c), about)


def rot_z(p, deg, about=(0.0, 0.0, 0.0)):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    x, y, z = sub(p, about)
    return add((x * c - y * s, x * s + y * c, z), about)


def spow(v, e):
    """Signed power (superellipse helper)."""
    return math.copysign(abs(v) ** e, v)


# ---------------------------------------------------------------------------------------------------------
# colour slots
# ---------------------------------------------------------------------------------------------------------

SLOT = {
    "skin": 0,
    "hair": 1,
    "top": 2,
    "bottom": 3,
    "shoes": 4,
    "accA": 5,
    "accB": 6,
    "accC": 7,
    # fixed colours (identical for every instance; the runtime holds the table, see src/pedestriansAnim.ts)
    "dark": 8,  # eyes, soles, glasses frames, belts
    "sole": 9,  # light rubber soles of trainers
    "grapes": 10,
    "bread": 11,
    "metal": 12,
    "lip": 13,
    "nose": 14,  # dog nose / pads
}
SLOT_COUNT_DYNAMIC = 8
SLOT_MAX = 15  # encoded as R = slot / 15 in the colour attribute


# ---------------------------------------------------------------------------------------------------------
# geometry accumulator
# ---------------------------------------------------------------------------------------------------------

class Geo:
    def __init__(self, name):
        self.name = name
        self.v = []
        self.f = []
        self.slot = []
        self.shade = []
        self.w = []

    def add(self, verts, faces, slot, wfn, shade=1.0):
        if isinstance(slot, str):
            if slot not in SLOT:
                raise KeyError(f"{self.name}: unknown colour slot '{slot}'")
            slot = SLOT[slot]
        if not (0 <= slot <= SLOT_MAX):
            raise ValueError(f"{self.name}: slot {slot} out of range")
        base = len(self.v)
        for p in verts:
            self.v.append(p)
            self.slot.append(slot)
            self.shade.append(shade(p) if callable(shade) else shade)
            self.w.append(normalise_weights(wfn(p), self.name, p))
        for face in faces:
            if len(set(face)) != len(face):
                raise ValueError(f"{self.name}: degenerate face {face}")
            self.f.append(tuple(base + i for i in face))

    def tri_count(self):
        return sum(len(f) - 2 for f in self.f)


def normalise_weights(w, name, p):
    items = [(b, x) for b, x in w.items() if x > 1e-4]
    items.sort(key=lambda kv: -kv[1])
    items = items[:4]
    total = sum(x for _, x in items)
    if total <= 1e-6:
        raise ValueError(f"{name}: vertex {p} has no skin weight")
    return {b: x / total for b, x in items}


# ---------------------------------------------------------------------------------------------------------
# primitives: each returns (verts, faces)
# ---------------------------------------------------------------------------------------------------------

def ring(center, u, v, ru, rv, n, power=2.0, phase=0.0):
    """Superellipse ring in the plane spanned by u and v (unit vectors)."""
    e = 2.0 / power
    pts = []
    for k in range(n):
        a = phase + 2.0 * math.pi * k / n
        cu = spow(math.cos(a), e) * ru
        cv = spow(math.sin(a), e) * rv
        pts.append(add(center, add(mul(u, cu), mul(v, cv))))
    return pts


def loft(rings, closed=True, cap0=False, cap1=False):
    n = len(rings[0])
    for r in rings:
        if len(r) != n:
            raise ValueError("loft: rings differ in vertex count")
    verts = [p for r in rings for p in r]
    faces = []
    m = n if closed else n - 1
    for i in range(len(rings) - 1):
        for j in range(m):
            j2 = (j + 1) % n
            faces.append((i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j))
    if cap0:
        c = mul(tuple(map(sum, zip(*rings[0]))), 1.0 / n)
        ci = len(verts)
        verts.append(c)
        for j in range(n):
            faces.append((ci, (j + 1) % n, j))
    if cap1:
        last = len(rings) - 1
        c = mul(tuple(map(sum, zip(*rings[-1]))), 1.0 / n)
        ci = len(verts)
        verts.append(c)
        for j in range(n):
            faces.append((ci, last * n + j, last * n + (j + 1) % n))
    return verts, faces


def ellipsoid(c, r, nu=16, nv=10, fn=None, power_u=2.0, power_v=2.0, y_range=(-1.0, 1.0)):
    """
    Ellipsoid (poles on Y) with optional per-vertex deform fn(p, d) where d is the unit-sphere direction.
    power_* > 2 makes it boxier (superellipsoid). y_range clips the latitude span (open ends get a pole fan).
    """
    eu = 2.0 / power_u
    ev = 2.0 / power_v
    lat0 = math.asin(clamp(y_range[0], -1.0, 1.0))
    lat1 = math.asin(clamp(y_range[1], -1.0, 1.0))
    rings = []
    dirs = []
    for i in range(1, nv):
        lat = lerp(lat0, lat1, i / nv)
        cl = spow(math.cos(lat), ev)
        sl = spow(math.sin(lat), ev)
        rr = []
        dd = []
        for k in range(nu):
            a = 2.0 * math.pi * k / nu
            d = (spow(math.sin(a), eu) * cl, sl, spow(math.cos(a), eu) * cl)
            dd.append(d)
            rr.append((c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]))
        rings.append(rr)
        dirs.append(dd)
    verts, faces = loft(rings, closed=True)
    n = nu
    bottom = (c[0], c[1] + math.sin(lat0) * r[1], c[2])
    top = (c[0], c[1] + math.sin(lat1) * r[1], c[2])
    bi = len(verts)
    verts.append(bottom)
    ti = len(verts)
    verts.append(top)
    last = len(rings) - 1
    for j in range(n):
        faces.append((bi, (j + 1) % n, j))
        faces.append((ti, last * n + j, last * n + (j + 1) % n))
    if fn is not None:
        flat_dirs = [d for dd in dirs for d in dd] + [(0.0, math.sin(lat0), 0.0), (0.0, math.sin(lat1), 0.0)]
        verts = [fn(p, d) for p, d in zip(verts, flat_dirs)]
    return verts, faces


def frame_for(t, fwd_hint=(0.0, 0.0, 1.0)):
    """Side / forward axes perpendicular to tangent t."""
    side = cross(t, fwd_hint)
    if length(side) < 1e-6:
        side = cross(t, (1.0, 0.0, 0.0))
    side = norm(side)
    fwd = norm(cross(side, t))
    return side, fwd


def tube(path, radii, n=12, cap0=False, cap1=False, fwd_hint=(0.0, 0.0, 1.0), power=2.0, offsets=None,
         dome0=0, dome1=0):
    """
    Tube along a polyline. radii[i] = (r_side, r_fwd). Optional per-ring centre offsets along the local forward
    axis. dome0 / dome1 add that many shrinking rings to round the ends (closed with a pole).
    """
    rings = []
    frames = []
    for i, p in enumerate(path):
        if i == 0:
            t = sub(path[1], path[0])
        elif i == len(path) - 1:
            t = sub(path[-1], path[-2])
        else:
            t = add(norm(sub(path[i], path[i - 1])), norm(sub(path[i + 1], path[i])))
        t = norm(t)
        side, fwd = frame_for(t, fwd_hint)
        frames.append((t, side, fwd))
        c = p if offsets is None else add(p, mul(fwd, offsets[i]))
        rs, rf = radii[i]
        rings.append(ring(c, side, fwd, rs, rf, n, power))
    pre = []
    if dome0 > 0:
        t, side, fwd = frames[0]
        rs, rf = radii[0]
        for k in range(dome0, 0, -1):
            a = (math.pi / 2) * k / (dome0 + 1)
            c = sub(path[0], mul(t, math.sin(a) * min(rs, rf)))
            pre.append(ring(c, side, fwd, rs * math.cos(a), rf * math.cos(a), n, power))
    post = []
    if dome1 > 0:
        t, side, fwd = frames[-1]
        rs, rf = radii[-1]
        for k in range(1, dome1 + 1):
            a = (math.pi / 2) * k / (dome1 + 1)
            c = add(path[-1], mul(t, math.sin(a) * min(rs, rf)))
            post.append(ring(c, side, fwd, rs * math.cos(a), rf * math.cos(a), n, power))
    all_rings = pre + rings + post
    return loft(all_rings, closed=True, cap0=cap0 or dome0 > 0, cap1=cap1 or dome1 > 0)


def rbox(c, half, nu=10, nv=6, power=4.0, fn=None):
    """Rounded box (superellipsoid)."""
    return ellipsoid(c, half, nu, nv, fn=fn, power_u=power, power_v=power)


def transform(vf, fn):
    verts, faces = vf
    return [fn(p) for p in verts], faces


def flip(vf):
    verts, faces = vf
    return verts, [tuple(reversed(f)) for f in faces]


def merge(*vfs):
    verts, faces = [], []
    for v, f in vfs:
        base = len(verts)
        verts += v
        faces += [tuple(base + i for i in face) for face in f]
    return verts, faces


# ---------------------------------------------------------------------------------------------------------
# skin weight helpers
# ---------------------------------------------------------------------------------------------------------

def w_rigid(bone):
    return lambda p: {bone: 1.0}


def w_limb(joints, bones, radii):
    """
    Weights along a limb chain. joints = [J0, J1, ..., Jn]; bones = [B_parent, B0, ..., B(n-1)] where B_k spans
    J_k -> J_k+1 and B_parent owns everything before J0. radii[k] = blend half-width at joint J_k.
    """
    n = len(joints) - 1
    if len(bones) != n + 1:
        raise ValueError("w_limb: bones must be [parent, one per segment]")
    if len(radii) < n:
        raise ValueError("w_limb: need a blend radius for every joint but the last")
    seg = [length(sub(joints[k + 1], joints[k])) for k in range(n)]
    cum = [0.0]
    for L in seg:
        cum.append(cum[-1] + L)

    def fn(p):
        best = None
        for k in range(n):
            a, b = joints[k], joints[k + 1]
            ab = sub(b, a)
            t = dot(sub(p, a), ab) / dot(ab, ab)
            tc = clamp(t, 0.0, 1.0)
            d = length(sub(p, add(a, mul(ab, tc))))
            if best is None or d < best[0] - 1e-9:
                best = (d, k, t)
        _, k, t = best
        if 0 < k < n - 1:
            t = clamp(t, 0.0, 1.0)
        elif k == 0 and n > 1:
            t = min(t, 1.0)
        elif k == n - 1 and n > 1:
            t = max(t, 0.0)
        s = cum[k] + t * seg[k]
        a = [smoothstep(cum[j] - radii[j], cum[j] + radii[j], s) for j in range(n)]
        w = {}
        for i in range(n + 1):
            wi = (1.0 if i == 0 else a[i - 1]) * ((1.0 - a[i]) if i < n else 1.0)
            if wi > 0:
                w[bones[i]] = w.get(bones[i], 0.0) + wi
        return w

    return fn


def w_y_chain(levels):
    """Vertical chain by height: levels = [(y_joint, bone_below, bone_above, half_width), ...] ascending."""

    def fn(p):
        y = p[1]
        bone = levels[0][1]
        w = {bone: 1.0}
        for yj, below, above, hw in levels:
            t = smoothstep(yj - hw, yj + hw, y)
            if t <= 0.0:
                break
            w = {k: v * (1.0 - t) for k, v in w.items()}
            w[above] = w.get(above, 0.0) + t
        return w

    return fn


def w_mix(*parts):
    """Weighted sum of weight functions: parts = [(fn, factor_fn_or_const), ...]."""

    def fn(p):
        out = {}
        for wfn, fac in parts:
            f = fac(p) if callable(fac) else fac
            if f <= 0:
                continue
            for b, x in wfn(p).items():
                out[b] = out.get(b, 0.0) + x * f
        return out

    return fn
