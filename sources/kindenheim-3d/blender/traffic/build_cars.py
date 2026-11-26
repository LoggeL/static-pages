#!/usr/bin/env python3
"""
NPC traffic: procedural German village car fleet (Blender 5.2, headless, no rendering).

    /opt/homebrew/bin/blender --background --factory-startup --python blender/traffic/build_cars.py

Run `python3 blender/traffic/generate_car_atlas.py` first (texture atlas + atlas_layout.json).

Output: public/assets/models/traffic/cars.glb (Draco) + manifest.json.
Every mesh uses ONE material ("Traffic_Car_Atlas") whose maps are loaded by src/traffic.ts from the atlas WebPs, so
the runtime can draw the whole fleet with one BatchedMesh. Paint colour, lamps and number plate are per instance.

COORDINATES (glTF vehicle space, as in blender/tractor): +X = vehicle LEFT, +Y = up (0 = tyre contact),
+Z = forward. Body origin = ground level, midway between the axles. Wheels are separate meshes centred on their
hub with the axle along X and the rim face towards +X (the runtime turns the right-hand wheels by 180 degrees).

Meshes per type T:  T_LOD0, T_LOD1 (bodies without wheels), T_LOD2 (body incl. simple wheels),
                    T_wheelF_LOD0 / _LOD1, T_wheelR_LOD0 / _LOD1 (front / rear wheel; identical for most cars).
"""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
OUT_DIR = PROJECT / "public" / "assets" / "models" / "traffic"
ATLAS = json.loads((HERE / "textures" / "atlas_layout.json").read_text())
LAYOUT = {k: tuple(v) for k, v in ATLAS["layout"].items()}

FLAT = {"glass", "seam", "chrome", "under", "rubber", "interior", "paint_black", "seal", "light_grey", "brake"}


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def sw_uv(name, lu, lv, inset=0.004):
    """Local swatch coords (0..1, v down) -> atlas image-space uv."""
    u0, v0, u1, v1 = LAYOUT[name]
    du = (u1 - u0) * inset * 4 if name not in FLAT else (u1 - u0) * 0.45
    dv = (v1 - v0) * inset * 4 if name not in FLAT else (v1 - v0) * 0.45
    return (lerp(u0 + du, u1 - du, clamp(lu)), lerp(v0 + dv, v1 - dv, clamp(lv)))


def paint_uv(y, z, length):
    """Paint swatch: u along the car, v by height (dust gradient on the sills)."""
    u0, v0, u1, v1 = LAYOUT["paint"]
    return (lerp(u0 + 0.003, u1 - 0.003, clamp(z / max(length, 1.0) + 0.5)),
            lerp(v0 + 0.002, v1 - 0.002, clamp(1.0 - y / 1.65)))


# ------------------------------------------------------------------------------------------------ mesh accumulator
class MB:
    def __init__(self):
        self.v = []
        self.f = []
        self.uv = []
        self.smooth = []

    def vert(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def face(self, idx, uvs, smooth=True):
        if len(set(idx)) < 3:
            return
        self.f.append(list(idx))
        self.uv.append(list(uvs))
        self.smooth.append(smooth)

    def poly(self, pts, uvs, out_dir=None, smooth=False):
        """Flat polygon with its own vertices; winding flipped so the normal points along out_dir."""
        if out_dir is not None and len(pts) >= 3:
            n = Vector((0, 0, 0))
            for i in range(len(pts)):
                a = Vector(pts[i])
                b = Vector(pts[(i + 1) % len(pts)])
                n += a.cross(b)
            if n.dot(Vector(out_dir)) < 0:
                pts = list(reversed(pts))
                uvs = list(reversed(uvs))
        idx = [self.vert(p) for p in pts]
        self.face(idx, uvs, smooth)

    def tri_count(self):
        return sum(len(f) - 2 for f in self.f)

    def extend(self, other):
        off = len(self.v)
        self.v.extend(other.v)
        for f, uv, s in zip(other.f, other.uv, other.smooth):
            self.f.append([i + off for i in f])
            self.uv.append(uv)
            self.smooth.append(s)


def box(mb, c, size, swatch, rot_y=0.0, uv_fn=None, skip=()):
    """Axis-aligned (optionally yawed) box, flat shaded. size = full extents (x, y, z)."""
    cx, cy, cz = c
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    cs, sn = math.cos(rot_y), math.sin(rot_y)

    def P(x, y, z):
        return (cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs)

    def D(x, y, z):
        return (x * cs + z * sn, y, -x * sn + z * cs)

    faces = {
        "+x": ([(hx, -hy, -hz), (hx, -hy, hz), (hx, hy, hz), (hx, hy, -hz)], (1, 0, 0)),
        "-x": ([(-hx, -hy, hz), (-hx, -hy, -hz), (-hx, hy, -hz), (-hx, hy, hz)], (-1, 0, 0)),
        "+y": ([(-hx, hy, -hz), (hx, hy, -hz), (hx, hy, hz), (-hx, hy, hz)], (0, 1, 0)),
        "-y": ([(-hx, -hy, hz), (hx, -hy, hz), (hx, -hy, -hz), (-hx, -hy, -hz)], (0, -1, 0)),
        "+z": ([(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)], (0, 0, 1)),
        "-z": ([(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)], (0, 0, -1)),
    }
    for key, (corners, n) in faces.items():
        if key in skip:
            continue
        pts = [P(*q) for q in corners]
        if uv_fn is not None:
            uvs = [uv_fn(p) for p in pts]
        else:
            uvs = [sw_uv(swatch, lu, lv) for lu, lv in ((0, 1), (1, 1), (1, 0), (0, 0))]
        mb.poly(pts, uvs, D(*n))


def cylinder_x(mb, c, r, length, seg, swatch, caps=True, cap_swatch=None, polar=False):
    """Cylinder along X centred at c."""
    cx, cy, cz = c
    h = length / 2
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        p = [(cx - h, cy + r * math.sin(a0), cz + r * math.cos(a0)), (cx + h, cy + r * math.sin(a0), cz + r * math.cos(a0)),
             (cx + h, cy + r * math.sin(a1), cz + r * math.cos(a1)), (cx - h, cy + r * math.sin(a1), cz + r * math.cos(a1))]
        n = (0, math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2))
        uvs = [sw_uv(swatch, i / seg, 0), sw_uv(swatch, i / seg, 1), sw_uv(swatch, (i + 1) / seg, 1), sw_uv(swatch, (i + 1) / seg, 0)]
        mb.poly(p, uvs, n)
    if caps:
        cs = cap_swatch or swatch
        for side in (-1, 1):
            pts = [(cx + side * h, cy + r * math.sin(2 * math.pi * i / seg), cz + r * math.cos(2 * math.pi * i / seg)) for i in range(seg)]
            if polar:
                uvs = [sw_uv(cs, 0.5 + 0.5 * math.cos(2 * math.pi * i / seg) * 0.98, 0.5 + 0.5 * math.sin(2 * math.pi * i / seg) * 0.98) for i in range(seg)]
            else:
                uvs = [sw_uv(cs, 0.5, 0.5)] * seg
            mb.poly(pts, uvs, (side, 0, 0))


def cylinder_y(mb, c, r, height, seg, swatch, caps=True):
    cx, cy, cz = c
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        p = [(cx + r * math.cos(a0), cy, cz + r * math.sin(a0)), (cx + r * math.cos(a1), cy, cz + r * math.sin(a1)),
             (cx + r * math.cos(a1), cy + height, cz + r * math.sin(a1)), (cx + r * math.cos(a0), cy + height, cz + r * math.sin(a0))]
        mb.poly(p, [sw_uv(swatch, 0.5, 0.5)] * 4, (math.cos((a0 + a1) / 2), 0, math.sin((a0 + a1) / 2)))
    if caps:
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + height, cz + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        mb.poly(pts, [sw_uv(swatch, 0.5, 0.5)] * seg, (0, 1, 0))


# ------------------------------------------------------------------------------------------------ profile curves
class Curve:
    """Monotone piecewise cubic (Catmull-Rom on sorted keys, clamped) y(z)."""

    def __init__(self, keys):
        self.k = sorted(keys)

    def __call__(self, z):
        k = self.k
        if z <= k[0][0]:
            return k[0][1]
        if z >= k[-1][0]:
            return k[-1][1]
        for i in range(len(k) - 1):
            z0, y0 = k[i]
            z1, y1 = k[i + 1]
            if z0 <= z <= z1:
                t = (z - z0) / (z1 - z0)
                ym = k[i - 1][1] if i > 0 else y0
                yp = k[i + 2][1] if i + 2 < len(k) else y1
                zm = k[i - 1][0] if i > 0 else z0 - (z1 - z0)
                zp = k[i + 2][0] if i + 2 < len(k) else z1 + (z1 - z0)
                m0 = (y1 - ym) / (z1 - zm) * (z1 - z0)
                m1 = (yp - y0) / (zp - z0) * (z1 - z0)
                # limit tangents to keep the curve monotone between keys (no overshoot on the windscreen)
                d = y1 - y0
                if d == 0:
                    m0 = m1 = 0
                else:
                    m0 = clamp(m0 / d, 0, 3) * d
                    m1 = clamp(m1 / d, 0, 3) * d
                t2, t3 = t * t, t * t * t
                return ((2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1)
        return k[-1][1]


# ------------------------------------------------------------------------------------------------ car body
RING_SEMANTIC = ["floor", "floor", "rocker", "lower", "lower", "upper", "shoulder", "win", "rail", "roof", "roof", "roof"]
# ring index i -> semantic of the band starting at i (bands between consecutive ring points)

LOD_RING = {0: list(range(12)), 1: [0, 2, 3, 4, 6, 7, 8, 9, 11], 2: [0, 3, 6, 7, 8, 11]}


class CarSpec:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Body:
    """Lofted car body: profile curves -> rings -> faces, fascia caps, detail patches."""

    def __init__(self, s: CarSpec):
        self.s = s
        self.top = Curve(s.top)
        self.belt = Curve(s.belt)
        self.zf = s.wb / 2 + s.fo
        self.zr = self.zf - s.L
        self.hw0 = s.W / 2

    # -- profile functions
    def halfwidth(self, z):
        s = self.s
        rc_f, rc_r = s.rc_front, s.rc_rear
        hw = self.hw0
        if z > self.zf - rc_f:
            d = z - (self.zf - rc_f)
            hw = self.hw0 - rc_f + math.sqrt(max(0.0, rc_f * rc_f - d * d))
        elif z < self.zr + rc_r:
            d = (self.zr + rc_r) - z
            hw = self.hw0 - rc_r + math.sqrt(max(0.0, rc_r * rc_r - d * d))
        return hw

    def bottom(self, z):
        s = self.s
        yb = s.sill
        if z > self.zf - 0.35:
            yb = lerp(s.sill, s.nose_bottom, smoothstep(self.zf - 0.35, self.zf, z))
        if z < self.zr + 0.4:
            yb = lerp(s.sill, s.tail_bottom, smoothstep(self.zr + 0.4, self.zr, z))
        for za in (s.wb / 2, -s.wb / 2):
            ra = (s.r_front if za > 0 else s.r_rear) + s.arch_gap
            ay = s.r_front if za > 0 else s.r_rear
            dz = z - za
            if abs(dz) < ra:
                yb = max(yb, ay + math.sqrt(ra * ra - dz * dz))
        return yb

    def shoulder(self, z):
        return min(self.belt(z), self.top(z) - 0.035)

    def roof_halfwidth(self, z):
        return self.halfwidth(z) - self.s.tumble

    def greenhouse(self, z):
        return clamp((self.top(z) - self.shoulder(z) - 0.05) / 0.22)

    def ring(self, z):
        s = self.s
        hw = self.halfwidth(z)
        yb = self.bottom(z)
        ysh = self.shoulder(z)
        yt = self.top(z)
        g = self.greenhouse(z)
        bulge = s.bulge if hw > self.hw0 - 0.05 else s.bulge * clamp((hw - (self.hw0 - 0.4)) / 0.35)
        lo = [
            (0.0, yb),
            (hw * 0.72, yb),
            (hw - 0.05, yb + 0.015),
            (hw - 0.005, yb + 0.09),
            (hw + bulge, lerp(yb + 0.09, ysh, 0.42)),
            (hw + bulge * 0.4, lerp(yb + 0.09, ysh, 0.82)),
            (hw - 0.025, ysh),
        ]
        # greenhouse shape
        wr = max(0.2, self.roof_halfwidth(z))
        crown = s.roof_crown
        gh = [
            (hw - 0.06, ysh + 0.025),
            (wr + 0.025, yt - 0.075),
            (wr - 0.045, yt - 0.012),
            (wr * 0.55, yt + crown * 0.72),
            (0.0, yt + crown),
        ]
        # hood / trunk shape: arc from the shoulder to the centre line
        hc = s.hood_crown
        hd = []
        for k, t in enumerate((0.18, 0.4, 0.62, 0.84, 1.0)):
            x = lerp(hw - 0.025, 0.0, t)
            ang = t * math.pi / 2
            y = yt - 0.035 * (1 - t) + (hc + 0.035) * math.sin(ang)
            x = (hw - 0.025) * math.cos(ang * 0.98) if t < 1 else 0.0
            hd.append((x, min(y, yt + hc)))
        up = [(lerp(a[0], b[0], g), lerp(a[1], b[1], g)) for a, b in zip(hd, gh)]
        return lo + up  # 12 points, bottom centre -> top centre (left half, +X)

    # -- semantic -> swatch for a band at z
    def band_swatch(self, sem, z, yb_mid):
        s = self.s
        if sem == "floor":
            return "under"
        if sem == "rocker":
            return s.rocker_swatch
        if sem in ("lower", "upper"):
            for z0, z1 in s.seams:
                if z0 <= z <= z1:
                    return "seam"
            for z0, z1, y0, y1, swn in s.side_strips:
                if z0 <= z <= z1 and y0 <= yb_mid <= y1:
                    return swn
            return "paint"
        if sem == "shoulder":
            return "paint"
        g = self.greenhouse(z)
        if sem == "win":
            if g < 0.5:
                return "paint"
            for z0, z1, swn in s.side_glass:
                if z0 <= z <= z1:
                    return swn
            return "paint"
        if sem == "rail":
            if g < 0.5:
                return "paint"
            return s.rail_swatch
        if sem == "roof":
            for z0, z1 in s.top_glass:
                if z0 <= z <= z1:
                    return "glass"
            return "paint"
        return "paint"

    def sections(self, lod):
        s = self.s
        step = {0: 0.07, 1: 0.24, 2: 0.55}[lod]
        zs = set()
        n = max(2, int(s.L / step))
        for i in range(n + 1):
            zs.add(self.zr + s.L * i / n)
        # plan-view corner rounding
        nr = {0: 7, 1: 3, 2: 1}[lod]
        for rc, sgn, zend in ((s.rc_front, 1, self.zf), (s.rc_rear, -1, self.zr)):
            for i in range(nr + 1):
                th = (math.pi / 2) * i / nr
                zs.add(zend - sgn * rc * (1 - math.sin(th)))
        # wheel arches: crisp start / end + samples on the circle
        na = {0: 10, 1: 4, 2: 2}[lod]
        for za, r in ((s.wb / 2, s.r_front), (-s.wb / 2, s.r_rear)):
            ra = r + s.arch_gap
            zs.add(za - ra - 0.004)
            zs.add(za + ra + 0.004)
            for i in range(na + 1):
                th = math.pi * i / na
                zs.add(za - ra * math.cos(th) * 0.999)
        # material boundaries
        keys = []
        for z0, z1 in s.top_glass:
            keys += [z0, z1]
        for z0, z1, _ in s.side_glass:
            keys += [z0, z1]
        for k in s.top:
            keys.append(k[0])
        if lod == 0:
            for z0, z1 in s.seams:
                keys += [z0, z1]
            for z0, z1, *_ in s.side_strips:
                keys += [z0, z1]
        for z in keys:
            if self.zr <= z <= self.zf:
                zs.add(z)
        zs = sorted(zs)
        out = [zs[0]]
        for z in zs[1:]:
            if z - out[-1] > (0.003 if lod == 0 else 0.03):
                out.append(z)
        if out[-1] != self.zf:
            out[-1] = self.zf
        out[0] = self.zr
        return out

    def build(self, mb: MB, lod: int):
        s = self.s
        zs = self.sections(lod)
        sel = LOD_RING[lod]
        rings = []
        for z in zs:
            half = self.ring(z)
            half = [half[i] for i in sel]
            left = [(x, y, z) for x, y in half]
            right = [(-x, y, z) for x, y in reversed(half[1:-1])]
            rings.append(left + right)
        m = len(rings[0])
        nhalf = len(sel)
        # semantic per full-ring band index (full index j -> half index: j, or mirrored for the right half)
        def half_of(j):
            j = j % m
            return j if j < nhalf else 2 * nhalf - 2 - j
        band_sem = []
        for j in range(m):
            a, b = sel[half_of(j)], sel[half_of(j + 1)]
            a, b = min(a, b), max(a, b)
            band_sem.append(RING_SEMANTIC[(a + b) // 2] if b > a else "floor")
        idx = [[mb.vert(p) for p in ring] for ring in rings]
        for i in range(len(rings) - 1):
            zmid = (zs[i] + zs[i + 1]) / 2
            for j in range(m):
                j2 = (j + 1) % m
                ymid = (rings[i][j][1] + rings[i][j2][1]) / 2
                swn = self.band_swatch(band_sem[j], zmid, ymid)
                quad = [idx[i][j], idx[i][j2], idx[i + 1][j2], idx[i + 1][j]]
                pts = [rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]]
                if swn == "paint":
                    uvs = [paint_uv(p[1], p[2], s.L) for p in pts]
                else:
                    uvs = [sw_uv(swn, clamp(p[2] / s.L + 0.5), clamp(1 - p[1] / 2.0)) for p in pts]
                mb.face(quad, uvs, True)
        self.rings = rings
        self.zs = zs
        self.build_fascia(mb, rings[-1], self.zf, +1, lod)
        self.build_fascia(mb, rings[0], self.zr, -1, lod)

    # -- front / rear fascia: slightly domed cap + detail patches
    def fascia_z(self, x, end_sign):
        s = self.s
        hw = self.halfwidth(self.zf if end_sign > 0 else self.zr)
        b = s.bulge_front if end_sign > 0 else s.bulge_rear
        t = clamp(abs(x) / max(hw, 0.1))
        zend = self.zf if end_sign > 0 else self.zr
        return zend + end_sign * b * (1 - t * t)

    def build_fascia(self, mb, ring, zend, sgn, lod):
        s = self.s
        cx = 0.0
        cy = sum(p[1] for p in ring) / len(ring)
        rings = [ring]
        steps = (0.66, 0.33) if lod < 2 else (0.5,)
        for k in steps:
            rings.append([(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, 0) for p in ring])
        rings = [[(p[0], p[1], self.fascia_z(p[0], sgn)) for p in r] for r in rings]
        out = (0, 0, sgn)
        for a, b in zip(rings[:-1], rings[1:]):
            m = len(a)
            for j in range(m):
                j2 = (j + 1) % m
                pts = [a[j], a[j2], b[j2], b[j]]
                uvs = [paint_uv(p[1], p[0] * 0.3 + sgn * s.L * 0.48, s.L) for p in pts]
                mb.poly(pts, uvs, out, smooth=True)
        inner = rings[-1]
        cz = self.fascia_z(0, sgn)
        for j in range(len(inner)):
            j2 = (j + 1) % len(inner)
            pts = [inner[j], inner[j2], (cx, cy, cz)]
            mb.poly(pts, [paint_uv(p[1], p[0] * 0.3 + sgn * s.L * 0.48, s.L) for p in pts], out, smooth=True)

    def patch(self, mb, sgn, x0, x1, y0, y1, swatch, off=0.006, nx=3, ny=1, flip_u=False, uv_rect=(0, 0, 1, 1)):
        """Grid patch on the domed fascia (sgn +1 front, -1 rear) in x [x0, x1], y [y0, y1]."""
        grid = []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                x = lerp(x0, x1, i / nx)
                y = lerp(y0, y1, j / ny)
                row.append((x, y, self.fascia_z(x, sgn) + sgn * off))
            grid.append(row)
        ru0, rv0, ru1, rv1 = uv_rect
        for j in range(ny):
            for i in range(nx):
                pts = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                lu = [i / nx, (i + 1) / nx, (i + 1) / nx, i / nx]
                lv = [j / ny, j / ny, (j + 1) / ny, (j + 1) / ny]
                uvs = []
                for a, b in zip(lu, lv):
                    if flip_u:
                        a = 1 - a
                    uvs.append(sw_uv(swatch, lerp(ru0, ru1, a), lerp(rv0, rv1, 1 - b)))
                mb.poly(pts, uvs, (0, 0, sgn))

    def side_point(self, z, ring_t, side=1):
        """Point on the body side at section z, ring parameter ring_t (0..11 on the left half)."""
        half = self.ring(z)
        i = int(clamp(math.floor(ring_t), 0, 10))
        t = ring_t - i
        x = lerp(half[i][0], half[i + 1][0], t)
        y = lerp(half[i][1], half[i + 1][1], t)
        return (x * side, y, z)


# ------------------------------------------------------------------------------------------------ details
def plate(mb, body: Body, sgn, y_center, lod):
    """Number plate 520 x 110 mm on the fascia; UV = cell 0 of the plate block (runtime offsets the cell)."""
    u0, v0, u1, v1 = LAYOUT["plates"]
    cw = (u1 - u0) / ATLAS["plateCols"]
    ch = (v1 - v0) / ATLAS["plateRows"]
    pu0 = u0 + cw * (2 / 256)
    pu1 = u0 + cw * (254 / 256)
    pv0 = v0 + ch * (5 / 64)
    pv1 = v0 + ch * (59 / 64)
    w, h = 0.52, 0.11
    z = body.fascia_z(0, sgn) + sgn * 0.012
    xs = (-w / 2, w / 2) if sgn > 0 else (w / 2, -w / 2)
    pts = [(xs[0], y_center - h / 2, z), (xs[1], y_center - h / 2, z), (xs[1], y_center + h / 2, z), (xs[0], y_center + h / 2, z)]
    uvs = [(pu0, pv1), (pu1, pv1), (pu1, pv0), (pu0, pv0)]
    mb.poly(pts, uvs, (0, 0, sgn))
    if lod == 0:
        # plate holder rim
        box(mb, (0, y_center, z - sgn * 0.008), (w + 0.03, h + 0.03, 0.012), "plastic")


def mirrors(mb, body: Body, z, y, out, size, lod, swatch="paint"):
    s = body.s
    for side in (1, -1):
        hw = body.halfwidth(z)
        cx = side * (hw + out * 0.5)
        sx, sy, sz = size
        if lod == 0:
            # rounded pod: lofted ellipse rings along x
            rings = []
            n = 8
            for k, t in enumerate((0.0, 0.25, 0.6, 0.9, 1.0)):
                x = side * (hw - 0.02 + (out + 0.02) * t)
                sc = 0.55 + 0.45 * math.sin(math.pi * clamp(0.15 + t * 0.85))
                if t == 1.0:
                    sc = 0.5
                ring = []
                for i in range(n):
                    a = 2 * math.pi * i / n
                    ring.append((x, y + math.sin(a) * sy / 2 * sc, z - 0.02 + math.cos(a) * sz / 2 * sc + (0.02 * t)))
                rings.append(ring)
            idx = [[mb.vert(p) for p in r] for r in rings]
            for a in range(len(rings) - 1):
                for i in range(n):
                    i2 = (i + 1) % n
                    q = [idx[a][i], idx[a][i2], idx[a + 1][i2], idx[a + 1][i]]
                    if side < 0:
                        q = list(reversed(q))
                    p = rings[a][i]
                    uv = paint_uv(p[1], p[2], s.L) if swatch == "paint" else sw_uv(swatch, 0.5, 0.5)
                    mb.face(q, [uv] * 4, True)
            cap = rings[-1]
            mb.poly(cap, [sw_uv(swatch if swatch != "paint" else "plastic", 0.5, 0.5)] * n, (side, 0, 0))
            # mirror glass facing backwards
            gx0 = side * (hw + 0.02)
            gx1 = side * (hw + out - 0.015)
            zg = z - 0.02 - sz / 2 * 0.95
            pts = [(gx0, y - sy * 0.38, zg), (gx1, y - sy * 0.38, zg), (gx1, y + sy * 0.38, zg), (gx0, y + sy * 0.38, zg)]
            mb.poly(pts, [sw_uv("chrome", 0.5, 0.5)] * 4, (0, 0, -1))
            # side repeater (indicator) on the outer front
            pts = [(side * (hw + out * 0.55), y - 0.012, z + sz * 0.35), (side * (hw + out * 0.95), y - 0.012, z + sz * 0.2),
                   (side * (hw + out * 0.95), y + 0.008, z + sz * 0.2), (side * (hw + out * 0.55), y + 0.008, z + sz * 0.35)]
            mb.poly(pts, [sw_uv("indicator", 0.5, 0.5)] * 4, (side * 0.4, 0, 1))
            # stalk
            box(mb, (side * (hw + 0.02), y - sy * 0.3, z + 0.01), (0.06, 0.04, 0.05), "plastic")
        else:
            box(mb, (cx, y, z), (out, sy, sz), "plastic" if swatch != "paint" else "paint",
                uv_fn=(lambda p: paint_uv(p[1], p[2], s.L)) if swatch == "paint" else None)


def handles(mb, body: Body, zs, y, swatch="paint"):
    s = body.s
    for side in (1, -1):
        for z in zs:
            hw = body.halfwidth(z) + s.bulge * 0.4
            box(mb, (side * (hw + 0.004), y, z), (0.022, 0.028, 0.17), swatch,
                uv_fn=(lambda p: paint_uv(p[1], p[2], s.L)) if swatch == "paint" else None)


def roof_rails(mb, body: Body, z0, z1, lod):
    s = body.s
    for side in (1, -1):
        n = 6 if lod == 0 else 2
        for i in range(n):
            za = lerp(z0, z1, i / n)
            zb = lerp(z0, z1, (i + 1) / n)
            ya = body.top(za) + 0.035
            yb = body.top(zb) + 0.035
            xa = side * (body.roof_halfwidth(za) - 0.07)
            xb = side * (body.roof_halfwidth(zb) - 0.07)
            for dx, dy, n_ in ((0.012, 0, (side, 0, 0)), (-0.012, 0, (-side, 0, 0))):
                pts = [(xa + dx * side, ya - 0.02, za), (xb + dx * side, yb - 0.02, zb), (xb + dx * side, yb + 0.02, zb), (xa + dx * side, ya + 0.02, za)]
                mb.poly(pts, [sw_uv("alu", 0.5, 0.5)] * 4, n_)
            pts = [(xa - 0.012, ya + 0.02, za), (xa + 0.012, ya + 0.02, za), (xb + 0.012, yb + 0.02, zb), (xb - 0.012, yb + 0.02, zb)]
            mb.poly(pts, [sw_uv("alu", 0.5, 0.5)] * 4, (0, 1, 0))
        # feet
        for zz in (z0, z1):
            box(mb, (side * (body.roof_halfwidth(zz) - 0.07), body.top(zz) + 0.008, zz), (0.03, 0.03, 0.06), "plastic")


def wipers(mb, body: Body, z_base, lod):
    if lod > 0:
        return
    y = body.top(z_base) + 0.03
    for x0 in (0.05, -0.55):
        box(mb, (x0 + 0.25, y, z_base - 0.04), (0.5, 0.012, 0.018), "plastic", rot_y=0.12)


def exhaust(mb, body: Body, x):
    z = body.zr + 0.06
    cylinder_x_axis_z(mb, (x, 0.28, z), 0.035, 0.18, 8, "chrome")


def cylinder_x_axis_z(mb, c, r, length, seg, swatch):
    """Short cylinder along Z (exhaust tip)."""
    cx, cy, cz = c
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        p = [(cx + r * math.cos(a0), cy + r * math.sin(a0), cz - length / 2), (cx + r * math.cos(a1), cy + r * math.sin(a1), cz - length / 2),
             (cx + r * math.cos(a1), cy + r * math.sin(a1), cz + length / 2), (cx + r * math.cos(a0), cy + r * math.sin(a0), cz + length / 2)]
        mb.poly(p, [sw_uv(swatch, 0.5, 0.5)] * 4, (math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0))
    pts = [(cx + r * 0.8 * math.cos(2 * math.pi * i / seg), cy + r * 0.8 * math.sin(2 * math.pi * i / seg), cz - length / 2 + 0.01) for i in range(seg)]
    mb.poly(pts, [sw_uv("seam", 0.5, 0.5)] * seg, (0, 0, -1))


def simple_wheels(mb, spec, body_wheels):
    """LOD2: octagonal tyres + rim faces merged into the body."""
    for (x, y, z, r, w) in body_wheels:
        seg = 8
        for side in (1, -1):
            cx = side * x
            h = w / 2
            for i in range(seg):
                a0 = 2 * math.pi * i / seg
                a1 = 2 * math.pi * (i + 1) / seg
                p = [(cx - h, y + r * math.sin(a0), z + r * math.cos(a0)), (cx + h, y + r * math.sin(a0), z + r * math.cos(a0)),
                     (cx + h, y + r * math.sin(a1), z + r * math.cos(a1)), (cx - h, y + r * math.sin(a1), z + r * math.cos(a1))]
                mb.poly(p, [sw_uv("tread", 0.5, 0.5)] * 4, (0, math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2)))
            pts = [(cx + side * h, y + r * math.sin(2 * math.pi * i / seg), z + r * math.cos(2 * math.pi * i / seg)) for i in range(seg)]
            rim = spec.rim
            uvs = [sw_uv(rim, 0.5 + 0.5 * 0.62 * math.cos(2 * math.pi * i / seg), 0.5 + 0.5 * 0.62 * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
            # rim face uses the inner 62 % of the disc so the octagon edge reads as tyre
            mb.poly(pts, uvs, (side, 0, 0))


# ------------------------------------------------------------------------------------------------ wheels
def wheel(r, width, rim_swatch, lod, tractor=False, rim_frac=0.62):
    """Wheel centred at the origin, axle along X, outer (rim) face towards +X."""
    mb = MB()
    seg = {0: 28, 1: 12}[lod] if not tractor else {0: 32, 1: 14}[lod]
    tread = "tread_tractor" if tractor else "tread"
    side_sw = "sidewall_tractor" if tractor else "sidewall"
    h = width / 2
    rr = r * rim_frac           # rim radius
    # tyre profile in (x, radius) from inner rim edge over the tread to the outer rim edge
    if lod == 0:
        prof = [(-h * 0.92, rr), (-h, r * 0.80), (-h * 0.98, r * 0.93), (-h * 0.85, r * 0.985), (-h * 0.5, r), (0, r),
                (h * 0.5, r), (h * 0.85, r * 0.985), (h * 0.98, r * 0.93), (h, r * 0.80), (h * 0.92, rr)]
        kinds = ["side", "side", "shoulder", "tread", "tread", "tread", "tread", "shoulder", "side", "side"]
    else:
        prof = [(-h * 0.92, rr), (-h, r * 0.88), (-h * 0.8, r), (h * 0.8, r), (h, r * 0.88), (h * 0.92, rr)]
        kinds = ["side", "shoulder", "tread", "shoulder", "side"]
    rings = []
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        rings.append([(x, rad * math.sin(a), rad * math.cos(a)) for x, rad in prof])
    for i in range(seg):
        for j in range(len(prof) - 1):
            p = [rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]]
            k = kinds[j]
            a_mid = 2 * math.pi * (i + 0.5) / seg
            nrm = (0, math.sin(a_mid), math.cos(a_mid))
            if k == "tread" or k == "shoulder":
                x0 = (prof[j][0] + h) / width
                x1 = (prof[j + 1][0] + h) / width
                reps = 4 if not tractor else 2
                per = seg // reps
                f0 = (i % per) / per
                f1 = f0 + 1.0 / per
                uv = [sw_uv(tread, f0, x0), sw_uv(tread, f0, x1), sw_uv(tread, f1, x1), sw_uv(tread, f1, x0)]
                if k == "shoulder":
                    nrm = (math.copysign(0.6, prof[j][0]), math.sin(a_mid) * 0.8, math.cos(a_mid) * 0.8)
            else:
                rad0, rad1 = prof[j][1] / r, prof[j + 1][1] / r
                a0 = 2 * math.pi * i / seg
                a1 = 2 * math.pi * (i + 1) / seg
                uv = [sw_uv(side_sw, 0.5 + 0.5 * rad0 * math.cos(a0) * 0.98, 0.5 + 0.5 * rad0 * math.sin(a0) * 0.98),
                      sw_uv(side_sw, 0.5 + 0.5 * rad1 * math.cos(a0) * 0.98, 0.5 + 0.5 * rad1 * math.sin(a0) * 0.98),
                      sw_uv(side_sw, 0.5 + 0.5 * rad1 * math.cos(a1) * 0.98, 0.5 + 0.5 * rad1 * math.sin(a1) * 0.98),
                      sw_uv(side_sw, 0.5 + 0.5 * rad0 * math.cos(a1) * 0.98, 0.5 + 0.5 * rad0 * math.sin(a1) * 0.98)]
                nrm = (math.copysign(1, prof[j][0] + prof[j + 1][0]), 0, 0)
            mb.poly(p, uv, nrm, smooth=False)
    # rim: outer face recessed into the tyre (+X), dish ring, inner dark face
    rim_seg = seg
    x_out = h * 0.55
    x_lip = h * 0.92
    lip = [(x_lip, rr * math.sin(2 * math.pi * i / rim_seg), rr * math.cos(2 * math.pi * i / rim_seg)) for i in range(rim_seg)]
    face = [(x_out, rr * 0.96 * math.sin(2 * math.pi * i / rim_seg), rr * 0.96 * math.cos(2 * math.pi * i / rim_seg)) for i in range(rim_seg)]
    for i in range(rim_seg):
        i2 = (i + 1) % rim_seg
        p = [lip[i], lip[i2], face[i2], face[i]]
        mb.poly(p, [sw_uv(rim_swatch, 0.5 + 0.49 * math.cos(2 * math.pi * i / rim_seg), 0.5 + 0.49 * math.sin(2 * math.pi * i / rim_seg))] * 4,
                (0.4, -math.sin(2 * math.pi * (i + 0.5) / rim_seg), -math.cos(2 * math.pi * (i + 0.5) / rim_seg)))
    # outer face: polar UV over the rim disc
    centre = (x_out + (0.02 if lod == 0 else 0.0), 0.0, 0.0)
    for i in range(rim_seg):
        i2 = (i + 1) % rim_seg
        a0 = 2 * math.pi * i / rim_seg
        a1 = 2 * math.pi * i2 / rim_seg
        p = [face[i], face[i2], centre]
        uv = [sw_uv(rim_swatch, 0.5 + 0.5 * 0.97 * math.cos(a0), 0.5 + 0.5 * 0.97 * math.sin(a0)),
              sw_uv(rim_swatch, 0.5 + 0.5 * 0.97 * math.cos(a1), 0.5 + 0.5 * 0.97 * math.sin(a1)),
              sw_uv(rim_swatch, 0.5, 0.5)]
        mb.poly(p, uv, (1, 0, 0))
    # inner side: dark disc (brake / hub area)
    inner = [(-h * 0.6, rr * 0.98 * math.sin(2 * math.pi * i / rim_seg), rr * 0.98 * math.cos(2 * math.pi * i / rim_seg)) for i in range(rim_seg)]
    mb.poly(inner, [sw_uv("under", 0.5, 0.5)] * rim_seg, (-1, 0, 0))
    if lod == 0 and not tractor:
        # brake disc visible through the spokes
        disc = [(x_out - 0.04, rr * 0.8 * math.sin(2 * math.pi * i / 16), rr * 0.8 * math.cos(2 * math.pi * i / 16)) for i in range(16)]
        mb.poly(disc, [sw_uv("brake", 0.5, 0.5)] * 16, (1, 0, 0))
    return mb


# ------------------------------------------------------------------------------------------------ car types
def spec_hatch():
    wb, fo, L = 2.63, 0.88, 4.26
    zf = wb / 2 + fo
    zr = zf - L
    return CarSpec(
        name="hatch", label="Kompaktwagen", L=L, W=1.79, H=1.45, wb=wb, fo=fo, track=1.54,
        r_front=0.316, r_rear=0.316, tyre_w=0.205, rim="rim_alloy", arch_gap=0.05,
        sill=0.2, nose_bottom=0.24, tail_bottom=0.3, tumble=0.2, bulge=0.03, roof_crown=0.035, hood_crown=0.03,
        rc_front=0.34, rc_rear=0.26, bulge_front=0.1, bulge_rear=0.05,
        top=[(zf, 0.72), (zf - 0.1, 0.79), (1.6, 0.88), (1.05, 0.95), (0.15, 1.42), (-0.15, 1.45), (-1.4, 1.43),
             (-1.55, 1.4), (zr + 0.12, 1.01), (zr, 0.98)],
        belt=[(zf, 0.68), (zf - 0.1, 0.76), (1.05, 0.93), (0.0, 0.97), (-1.2, 1.0), (zr + 0.1, 1.0), (zr, 0.96)],
        top_glass=[(1.07, 0.13), (zr + 0.14, -1.53)],
        side_glass=[(-0.26, 0.93, "glass"), (-1.13, -0.36, "glass")],
        seams=[(0.9, 0.906), (-0.31, -0.304), (-1.03, -1.024)],
        side_strips=[],
        rocker_swatch="plastic", rail_swatch="seal",
        hl="headlight", tl="taillight", vertical_tail=True, rear_glass=False, plate_y_front=0.38, plate_y_rear=0.62,
        mirror=(0.98, 0.97, (0.2, 0.13, 0.1)), handles=[0.25, -0.75], handle_y=0.86, roof_rails=None,
        grille=True, wiper_z=1.0, exhaust=0.45)


def spec_small():
    wb, fo, L = 2.42, 0.66, 3.62
    zf = wb / 2 + fo
    zr = zf - L
    return CarSpec(
        name="small", label="Kleinwagen", L=L, W=1.66, H=1.48, wb=wb, fo=fo, track=1.43,
        r_front=0.292, r_rear=0.292, tyre_w=0.185, rim="hubcap", arch_gap=0.05,
        sill=0.19, nose_bottom=0.23, tail_bottom=0.3, tumble=0.19, bulge=0.025, roof_crown=0.03, hood_crown=0.03,
        rc_front=0.32, rc_rear=0.24, bulge_front=0.1, bulge_rear=0.05,
        top=[(zf, 0.72), (zf - 0.1, 0.79), (1.3, 0.88), (1.0, 0.93), (0.25, 1.44), (0.0, 1.48), (-1.25, 1.46),
             (-1.42, 1.42), (zr + 0.1, 1.0), (zr, 0.96)],
        belt=[(zf, 0.68), (zf - 0.1, 0.76), (1.0, 0.92), (0.0, 0.96), (zr + 0.1, 1.0), (zr, 0.95)],
        top_glass=[(1.02, 0.23), (zr + 0.12, -1.4)],
        side_glass=[(-0.22, 0.88, "glass"), (-1.0, -0.3, "glass")],
        seams=[(0.86, 0.866), (-0.27, -0.264), (-0.96, -0.954)],
        side_strips=[],
        rocker_swatch="plastic", rail_swatch="seal",
        hl="headlight", tl="taillight", vertical_tail=True, rear_glass=False, plate_y_front=0.36, plate_y_rear=0.6,
        mirror=(0.93, 0.97, (0.18, 0.12, 0.09)), handles=[0.2, -0.62], handle_y=0.86, roof_rails=None,
        grille=True, wiper_z=0.95, exhaust=0.4)


def spec_estate():
    wb, fo, L = 2.79, 0.92, 4.77
    zf = wb / 2 + fo
    zr = zf - L
    return CarSpec(
        name="estate", label="Kombi", L=L, W=1.83, H=1.48, wb=wb, fo=fo, track=1.58,
        r_front=0.33, r_rear=0.33, tyre_w=0.215, rim="rim_alloy2", arch_gap=0.05,
        sill=0.2, nose_bottom=0.24, tail_bottom=0.3, tumble=0.2, bulge=0.03, roof_crown=0.035, hood_crown=0.03,
        rc_front=0.36, rc_rear=0.24, bulge_front=0.1, bulge_rear=0.045,
        top=[(zf, 0.72), (zf - 0.1, 0.8), (1.7, 0.9), (1.12, 0.97), (0.22, 1.44), (-0.1, 1.48), (-2.1, 1.46),
             (zr + 0.25, 1.4), (zr + 0.06, 1.02), (zr, 0.98)],
        belt=[(zf, 0.68), (zf - 0.1, 0.77), (1.12, 0.95), (0.0, 0.98), (-1.6, 1.0), (zr + 0.1, 1.0), (zr, 0.97)],
        top_glass=[(1.14, 0.2), (zr + 0.08, zr + 0.23)],
        side_glass=[(-0.3, 0.96, "glass"), (-1.26, -0.38, "glass"), (-2.12, -1.34, "glass")],
        seams=[(0.96, 0.966), (-0.34, -0.334), (-1.3, -1.294)],
        side_strips=[],
        rocker_swatch="plastic", rail_swatch="seal",
        hl="headlight", tl="taillight", vertical_tail=True, rear_glass=True, plate_y_front=0.38, plate_y_rear=0.62,
        mirror=(1.05, 0.99, (0.21, 0.13, 0.1)), handles=[0.3, -0.85], handle_y=0.88, roof_rails=(0.1, zr + 0.35),
        grille=True, wiper_z=1.07, exhaust=0.5)


def spec_suv():
    wb, fo, L = 2.68, 0.9, 4.5
    zf = wb / 2 + fo
    zr = zf - L
    return CarSpec(
        name="suv", label="Kompakt-SUV", L=L, W=1.84, H=1.66, wb=wb, fo=fo, track=1.58,
        r_front=0.357, r_rear=0.357, tyre_w=0.235, rim="rim_alloy", arch_gap=0.06,
        sill=0.32, nose_bottom=0.34, tail_bottom=0.4, tumble=0.19, bulge=0.03, roof_crown=0.035, hood_crown=0.035,
        rc_front=0.36, rc_rear=0.26, bulge_front=0.1, bulge_rear=0.05,
        top=[(zf, 0.86), (zf - 0.1, 0.96), (1.6, 1.05), (1.08, 1.12), (0.18, 1.62), (-0.12, 1.66), (-1.85, 1.64),
             (zr + 0.26, 1.56), (zr + 0.08, 1.16), (zr, 1.1)],
        belt=[(zf, 0.82), (zf - 0.1, 0.93), (1.08, 1.1), (0.0, 1.14), (-1.5, 1.18), (zr + 0.1, 1.18), (zr, 1.1)],
        top_glass=[(1.1, 0.16), (zr + 0.1, zr + 0.24)],
        side_glass=[(-0.3, 0.93, "glass"), (-1.25, -0.38, "glass"), (-1.82, -1.33, "glass")],
        seams=[(0.92, 0.926), (-0.34, -0.334), (-1.28, -1.274)],
        side_strips=[(-3, 3, 0.0, 0.47, "plastic")],
        rocker_swatch="plastic", rail_swatch="seal",
        hl="headlight", tl="taillight", vertical_tail=True, rear_glass=True, plate_y_front=0.5, plate_y_rear=0.74,
        mirror=(1.02, 1.13, (0.22, 0.14, 0.1)), handles=[0.28, -0.8], handle_y=1.02, roof_rails=(0.05, zr + 0.4),
        grille=True, wiper_z=1.05, exhaust=0.5)


def spec_van():
    wb, fo, L = 3.0, 0.98, 4.9
    zf = wb / 2 + fo
    zr = zf - L
    return CarSpec(
        name="van", label="Transporter", L=L, W=1.9, H=1.97, wb=wb, fo=fo, track=1.63,
        r_front=0.345, r_rear=0.345, tyre_w=0.215, rim="rim_steel", arch_gap=0.06,
        sill=0.3, nose_bottom=0.32, tail_bottom=0.42, tumble=0.1, bulge=0.025, roof_crown=0.04, hood_crown=0.03,
        rc_front=0.32, rc_rear=0.12, bulge_front=0.08, bulge_rear=0.02,
        top=[(zf, 0.86), (zf - 0.1, 0.96), (2.05, 1.08), (1.86, 1.13), (1.05, 1.9), (0.8, 1.96), (zr + 0.1, 1.96), (zr, 1.92)],
        belt=[(zf, 0.82), (zf - 0.1, 0.93), (1.86, 1.11), (0.5, 1.13), (zr, 1.14)],
        top_glass=[(1.88, 1.0)],
        side_glass=[(0.74, 1.84, "glass")],
        seams=[(1.09, 1.096), (0.7, 0.706), (-0.62, -0.614)],
        side_strips=[(-3, 3, 0.3, 0.5, "plastic")],
        rocker_swatch="plastic", rail_swatch="paint",
        hl="headlight", tl="taillight", vertical_tail=True, rear_glass=True, plate_y_front=0.48, plate_y_rear=0.5,
        mirror=(1.72, 1.18, (0.26, 0.28, 0.12)), handles=[0.85, -0.3], handle_y=1.0, roof_rails=None,
        grille=True, wiper_z=1.9, exhaust=0.55, mirror_swatch="plastic")


def spec_sedan_old():
    wb, fo, L = 2.8, 0.9, 4.74
    zf = wb / 2 + fo
    zr = zf - L
    return CarSpec(
        name="sedan_old", label="Limousine (älter)", L=L, W=1.74, H=1.42, wb=wb, fo=fo, track=1.5,
        r_front=0.31, r_rear=0.31, tyre_w=0.195, rim="hubcap", arch_gap=0.04,
        sill=0.22, nose_bottom=0.24, tail_bottom=0.28, tumble=0.17, bulge=0.012, roof_crown=0.025, hood_crown=0.02,
        rc_front=0.14, rc_rear=0.12, bulge_front=0.05, bulge_rear=0.03,
        top=[(zf, 0.72), (zf - 0.06, 0.76), (1.4, 0.82), (1.0, 0.86), (0.18, 1.38), (-0.05, 1.42), (-0.95, 1.41),
             (-1.5, 0.99), (zr + 0.15, 0.96), (zr, 0.92)],
        belt=[(zf, 0.7), (zf - 0.06, 0.74), (1.0, 0.85), (0.0, 0.88), (-1.5, 0.92), (zr, 0.91)],
        top_glass=[(1.02, 0.2), (-1.46, -0.98)],
        side_glass=[(-0.2, 0.92, "glass"), (-0.92, -0.28, "glass")],
        seams=[(0.92, 0.926), (-0.24, -0.234), (-1.0, -0.994)],
        side_strips=[(-3, 3, 0.5, 0.56, "plastic")],
        rocker_swatch="paint", rail_swatch="chrome",
        hl="headlight_old", tl="taillight_old", vertical_tail=False, rear_glass=False, plate_y_front=0.42, plate_y_rear=0.6,
        mirror=(0.92, 0.93, (0.18, 0.11, 0.09)), handles=[0.3, -0.62], handle_y=0.8, roof_rails=None,
        grille=True, wiper_z=0.96, exhaust=0.45, mirror_swatch="plastic", old_bumpers=True)


def spec_pritsche():
    wb, fo, L = 3.4, 0.95, 5.3
    zf = wb / 2 + fo
    cab_back = 0.5
    return CarSpec(
        name="pritsche", label="Pritschenwagen", L=zf - cab_back, W=1.95, H=1.98, wb=wb, fo=fo, track=1.66,
        r_front=0.35, r_rear=0.35, tyre_w=0.215, rim="rim_steel", arch_gap=0.06,
        sill=0.34, nose_bottom=0.34, tail_bottom=0.45, tumble=0.1, bulge=0.02, roof_crown=0.04, hood_crown=0.03,
        rc_front=0.3, rc_rear=0.06, bulge_front=0.08, bulge_rear=0.0,
        top=[(zf, 0.86), (zf - 0.1, 0.96), (2.3, 1.1), (2.12, 1.15), (1.3, 1.92), (1.05, 1.98), (cab_back + 0.05, 1.97), (cab_back, 1.94)],
        belt=[(zf, 0.82), (zf - 0.1, 0.93), (2.12, 1.13), (cab_back, 1.15)],
        top_glass=[(2.14, 1.25)],
        side_glass=[(cab_back + 0.12, 2.1, "glass")],
        seams=[(1.33, 1.336), (cab_back + 0.08, cab_back + 0.086)],
        side_strips=[(-3, 3, 0.34, 0.52, "plastic")],
        rocker_swatch="plastic", rail_swatch="paint",
        hl="headlight", tl="taillight_old", vertical_tail=True, rear_glass=True, plate_y_front=0.5, plate_y_rear=0.58,
        mirror=(2.0, 1.2, (0.26, 0.3, 0.12)), handles=[1.0], handle_y=1.02, roof_rails=None,
        grille=True, wiper_z=2.1, exhaust=None, mirror_swatch="plastic", full_L=L, cab_back=cab_back)


SPECS = [spec_hatch(), spec_small(), spec_estate(), spec_suv(), spec_van(), spec_sedan_old(), spec_pritsche()]


def build_front_details(mb, body: Body, s, lod):
    zf = body.zf
    hwf = body.halfwidth(zf)
    ytop = body.top(zf)
    yb = body.bottom(zf)
    # headlights at the upper outer corners of the fascia
    hl_w = min(0.42, hwf * 0.42)
    hl_y0 = ytop - 0.2 if not getattr(s, "old_bumpers", False) else ytop - 0.21
    hl_y1 = ytop - 0.045
    for side in (1, -1):
        xa, xb = (hwf - hl_w, hwf - 0.015) if side > 0 else (-(hwf - 0.015), -(hwf - hl_w))
        body.patch(mb, 1, xa, xb, hl_y0, hl_y1, s.hl, off=0.008, nx=3 if lod == 0 else 1, flip_u=side < 0)
    # upper grille between the lamps
    gx = hwf - hl_w - 0.04
    if s.grille:
        body.patch(mb, 1, -gx, gx, hl_y0 + 0.02, hl_y1 - 0.02, "grille", off=0.006, nx=4 if lod == 0 else 1)
    # lower intake + plate
    lo_y0 = yb + 0.06
    lo_y1 = min(s.plate_y_front + 0.1, hl_y0 - 0.06)
    body.patch(mb, 1, -hwf * 0.62, hwf * 0.62, lo_y0, lo_y1, "grille", off=0.005, nx=4 if lod == 0 else 1)
    if getattr(s, "old_bumpers", False):
        # dark plastic bumper bar across the full front
        body.patch(mb, 1, -hwf - 0.02, hwf + 0.02, lo_y1 + 0.005, lo_y1 + 0.13, "plastic", off=0.03, nx=4 if lod == 0 else 1)
    if lod < 2:
        plate(mb, body, 1, s.plate_y_front, lod)
        # indicators / fog lamps in the lower corners
        for side in (1, -1):
            x0, x1 = (hwf * 0.68, hwf * 0.86) if side > 0 else (-hwf * 0.86, -hwf * 0.68)
            body.patch(mb, 1, x0, x1, lo_y0 + 0.06, lo_y0 + 0.11, "indicator", off=0.007, nx=1)


def build_rear_details(mb, body: Body, s, lod):
    zr = body.zr
    hwr = body.halfwidth(zr)
    ytop = body.top(zr)
    yb = body.bottom(zr)
    ysh = body.shoulder(zr)
    tl_w = min(0.36, hwr * 0.38)
    if s.vertical_tail:
        tl_y0, tl_y1 = ysh - 0.2, ysh + 0.1
    else:
        tl_y0, tl_y1 = ytop - 0.24, ytop - 0.04
    for side in (1, -1):
        xa, xb = (hwr - tl_w, hwr - 0.01) if side > 0 else (-(hwr - 0.01), -(hwr - tl_w))
        body.patch(mb, -1, xa, xb, tl_y0, tl_y1, s.tl, off=0.008, nx=2 if lod == 0 else 1, flip_u=side > 0)
    # rear window on a vertical tailgate
    g = body.greenhouse(zr)
    if s.vertical_tail and g > 0.5 and s.rear_glass:
        wr = body.roof_halfwidth(zr)
        y0 = ysh + 0.12
        y1 = ytop - 0.09
        body.patch(mb, -1, -(wr - 0.02), wr - 0.02, y0, y1, "glass", off=0.006, nx=2 if lod == 0 else 1)
        # third brake lamp above the glass
        body.patch(mb, -1, -0.18, 0.18, y1 + 0.015, y1 + 0.045, "taillight", off=0.01, nx=1, uv_rect=(0.5, 0.12, 0.95, 0.24))
    elif s.vertical_tail and g > 0.5:
        body.patch(mb, -1, -0.16, 0.16, ytop - 0.08, ytop - 0.05, "taillight", off=0.01, nx=1, uv_rect=(0.5, 0.12, 0.95, 0.24))
    # bumper: dark lower band + plate
    body.patch(mb, -1, -hwr * 0.85, hwr * 0.85, yb + 0.02, yb + 0.12, "plastic", off=0.012, nx=3 if lod == 0 else 1)
    if getattr(s, "old_bumpers", False):
        body.patch(mb, -1, -hwr - 0.02, hwr + 0.02, yb + 0.12, yb + 0.26, "plastic", off=0.03, nx=4 if lod == 0 else 1)
    if lod < 2:
        plate(mb, body, -1, s.plate_y_rear, lod)
        if s.exhaust:
            exhaust(mb, body, s.exhaust)


def build_car(s: CarSpec, lod: int) -> MB:
    mb = MB()
    body = Body(s)
    body.build(mb, lod)
    build_front_details(mb, body, s, lod)
    build_rear_details(mb, body, s, lod)
    if lod < 2:
        mz, my, msize = s.mirror
        mirrors(mb, body, mz, my, msize[0], msize, lod, getattr(s, "mirror_swatch", "paint"))
    if lod == 0:
        handles(mb, body, s.handles, s.handle_y)
        wipers(mb, body, s.wiper_z, lod)
    if s.roof_rails and lod < 2:
        roof_rails(mb, body, s.roof_rails[0], s.roof_rails[1], lod)
    if s.name == "pritsche":
        build_flatbed(mb, s, body, lod)
    if lod == 2:
        wheels = [(s.track / 2, s.r_front, s.wb / 2, s.r_front, s.tyre_w), (s.track / 2, s.r_rear, -s.wb / 2, s.r_rear, s.tyre_w)]
        simple_wheels(mb, s, wheels)
    return mb


def build_flatbed(mb, s, body, lod):
    """Pritsche: ladder frame, wooden floor, aluminium drop sides, headboard and mudguards behind the cab."""
    zf = body.zf
    z_front = s.cab_back - 0.08
    z_rear = zf - s.full_L
    bw = 2.0
    floor_y = 1.0
    # frame rails
    for side in (1, -1):
        box(mb, (side * 0.42, 0.62, (z_front + z_rear) / 2 + 0.3), (0.08, 0.18, z_front - z_rear + 0.6), "paint_black")
    # floor slab
    box(mb, (0, floor_y - 0.05, (z_front + z_rear) / 2), (bw, 0.1, z_front - z_rear), "wood",
        uv_fn=lambda p: sw_uv("wood", p[0] / bw + 0.5, p[2] / 3.2 + 0.5))
    box(mb, (0, floor_y - 0.2, (z_front + z_rear) / 2), (bw - 0.1, 0.18, z_front - z_rear - 0.1), "paint_black", skip=("+y",))
    # drop sides (aluminium boards)
    hs = 0.4
    for side in (1, -1):
        box(mb, (side * (bw / 2 - 0.02), floor_y + hs / 2, (z_front + z_rear) / 2), (0.04, hs, z_front - z_rear), "alu",
            uv_fn=lambda p: sw_uv("alu", p[2] / 3.5 + 0.5, (p[1] - floor_y) / hs))
    box(mb, (0, floor_y + hs / 2, z_rear + 0.02), (bw, hs, 0.04), "alu", uv_fn=lambda p: sw_uv("alu", p[0] / 2 + 0.5, (p[1] - floor_y) / hs))
    box(mb, (0, floor_y + hs / 2, z_front - 0.02), (bw, hs, 0.04), "alu", uv_fn=lambda p: sw_uv("alu", p[0] / 2 + 0.5, (p[1] - floor_y) / hs))
    # headboard / ladder rack above the cab rear
    if lod < 2:
        for side in (1, -1):
            box(mb, (side * 0.93, floor_y + 0.55, z_front - 0.05), (0.05, 1.1, 0.05), "paint_black")
        for k in range(3 if lod == 0 else 1):
            box(mb, (0, floor_y + 0.5 + k * 0.25, z_front - 0.05), (1.9, 0.04, 0.04), "paint_black")
        box(mb, (0, floor_y + 1.1, z_front - 0.05), (1.9, 0.06, 0.06), "paint_black")
    # mudguards over the rear wheels
    zr_ax = -s.wb / 2
    for side in (1, -1):
        x = side * s.track / 2
        n = 6 if lod == 0 else 3
        r = s.r_rear + 0.08
        for i in range(n):
            a0 = math.pi * 0.1 + (math.pi * 0.8) * i / n
            a1 = math.pi * 0.1 + (math.pi * 0.8) * (i + 1) / n
            p0 = (x - 0.14, s.r_rear + r * math.sin(a0), zr_ax + r * math.cos(a0))
            p1 = (x + 0.14, s.r_rear + r * math.sin(a0), zr_ax + r * math.cos(a0))
            p2 = (x + 0.14, s.r_rear + r * math.sin(a1), zr_ax + r * math.cos(a1))
            p3 = (x - 0.14, s.r_rear + r * math.sin(a1), zr_ax + r * math.cos(a1))
            mb.poly([p0, p1, p2, p3], [sw_uv("plastic", 0.5, 0.5)] * 4, (0, math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2)))
    # rear cross member with lamps and plate
    box(mb, (0, 0.72, z_rear + 0.03), (1.8, 0.14, 0.08), "paint_black")
    for side in (1, -1):
        x0, x1 = (0.62, 0.92) if side > 0 else (-0.92, -0.62)
        pts = [(x1 if side > 0 else x0, 0.66, z_rear - 0.015), (x0 if side > 0 else x1, 0.66, z_rear - 0.015),
               (x0 if side > 0 else x1, 0.78, z_rear - 0.015), (x1 if side > 0 else x0, 0.78, z_rear - 0.015)]
        mb.poly(pts, [sw_uv("taillight_old", u, v) for u, v in ((0, 1), (1, 1), (1, 0), (0, 0))], (0, 0, -1))
    if lod < 2:
        u0, v0, u1, v1 = LAYOUT["plates"]
        cw = (u1 - u0) / ATLAS["plateCols"]
        ch = (v1 - v0) / ATLAS["plateRows"]
        pu0, pu1, pv0, pv1 = u0 + cw * 2 / 256, u0 + cw * 254 / 256, v0 + ch * 5 / 64, v0 + ch * 59 / 64
        z = z_rear - 0.02
        pts = [(0.26, 0.47, z), (-0.26, 0.47, z), (-0.26, 0.58, z), (0.26, 0.58, z)]
        mb.poly(pts, [(pu0, pv1), (pu1, pv1), (pu1, pv0), (pu0, pv0)], (0, 0, -1))
        box(mb, (0, 0.6, z_rear + 0.03), (0.3, 0.06, 0.06), "paint_black")


# ------------------------------------------------------------------------------------------------ small tractor
TRACTOR = CarSpec(name="tractor", label="Schmalspurschlepper", L=3.35, W=1.45, H=2.28, wb=1.9, fo=0.85, track=1.16,
                  r_front=0.37, r_rear=0.56, tyre_w_f=0.22, tyre_w_r=0.32, rim="rim_tractor")


def build_tractor(lod: int) -> MB:
    s = TRACTOR
    mb = MB()
    zf = s.wb / 2 + s.fo         # 1.8
    pu = lambda p: paint_uv(p[1] * 0.75, p[2], 4.0)
    # hood: lofted rounded box from the cab front to the grille
    z0, z1 = 0.35, zf - 0.03
    n = 8 if lod == 0 else 3
    rings = []
    for i in range(n + 1):
        z = lerp(z0, z1, i / n)
        t = i / n
        hw = 0.36 - 0.05 * t
        yt = lerp(1.32, 1.18, t ** 1.4)
        yb = 0.62
        rad = 0.09
        ring = []
        for a in range(5 if lod == 0 else 3):
            ang = (math.pi / 2) * a / (4 if lod == 0 else 2)
            ring.append((hw - rad + rad * math.cos(ang), yt - rad + rad * math.sin(ang)))
        pts = [(0.0, yb), (hw, yb)] + ring[:-1] + [(hw - rad, yt), (0.0, yt)]
        full = [(x, y, z) for x, y in pts] + [(-x, y, z) for x, y in reversed(pts[1:-1])]
        rings.append(full)
    idx = [[mb.vert(p) for p in r] for r in rings]
    m = len(rings[0])
    for i in range(n):
        for j in range(m):
            j2 = (j + 1) % m
            q = [idx[i][j], idx[i][j2], idx[i + 1][j2], idx[i + 1][j]]
            pts = [rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]]
            mb.face(q, [pu(p) for p in pts], True)
    front = rings[-1]
    mb.poly(front, [sw_uv("grille", 0.5 + p[0], 1 - (p[1] - 0.62) / 0.6) for p in front], (0, 0, 1))
    # side vents / grille strips on the hood
    for side in (1, -1):
        box(mb, (side * 0.335, 1.02, 1.1), (0.012, 0.12, 0.5), "grille")
    # engine block + front axle housing + front weight
    box(mb, (0, 0.5, 1.0), (0.5, 0.36, 1.4), "paint_black")
    box(mb, (0, 0.38, zf - 0.02), (0.5, 0.36, 0.22), "paint_black")
    box(mb, (0, s.r_front, s.wb / 2), (s.track - 0.15, 0.12, 0.14), "paint_black")
    # cab floor, rear axle housing / transmission
    box(mb, (0, 0.6, -0.4), (0.7, 0.5, 1.0), "paint_black")
    box(mb, (0, s.r_rear, -s.wb / 2), (s.track - 0.25, 0.2, 0.22), "paint_black")
    # rear fenders (paint) over the big wheels
    for side in (1, -1):
        x = side * s.track / 2
        r = s.r_rear + 0.07
        nn = 9 if lod == 0 else 4
        for i in range(nn):
            a0 = math.pi * 0.05 + math.pi * 0.62 * i / nn
            a1 = math.pi * 0.05 + math.pi * 0.62 * (i + 1) / nn
            p0 = (x - side * 0.2, s.r_rear + r * math.sin(a0), -s.wb / 2 + r * math.cos(a0))
            p1 = (x + side * 0.2, s.r_rear + r * math.sin(a0), -s.wb / 2 + r * math.cos(a0))
            p2 = (x + side * 0.2, s.r_rear + r * math.sin(a1), -s.wb / 2 + r * math.cos(a1))
            p3 = (x - side * 0.2, s.r_rear + r * math.sin(a1), -s.wb / 2 + r * math.cos(a1))
            mb.poly([p0, p1, p2, p3], [pu(p0), pu(p1), pu(p2), pu(p3)], (0, math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2)))
            mb.poly([p1, p0, p3, p2], [pu(p0)] * 4, (0, -math.sin((a0 + a1) / 2), -math.cos((a0 + a1) / 2)))
        # fender lamp (round) + rear light
        if lod < 2:
            cz = -s.wb / 2 + r * math.cos(math.pi * 0.2)
            box(mb, (x + side * 0.05, s.r_rear + r + 0.05, cz + 0.15), (0.1, 0.1, 0.06), "paint_black")
            pts = [(x + side * 0.0, s.r_rear + r + 0.01, cz + 0.181), (x + side * 0.1, s.r_rear + r + 0.01, cz + 0.181),
                   (x + side * 0.1, s.r_rear + r + 0.09, cz + 0.181), (x + side * 0.0, s.r_rear + r + 0.09, cz + 0.181)]
            mb.poly(pts, [sw_uv("lamp_round", u, v) for u, v in ((0, 1), (1, 1), (1, 0), (0, 0))], (0, 0, 1))
            pts = [(x + side * 0.04, 0.95, -s.wb / 2 - r * 0.72 - 0.015), (x + side * 0.16, 0.95, -s.wb / 2 - r * 0.72 - 0.015),
                   (x + side * 0.16, 1.03, -s.wb / 2 - r * 0.72 - 0.015), (x + side * 0.04, 1.03, -s.wb / 2 - r * 0.72 - 0.015)]
            mb.poly(pts, [sw_uv("taillight_old", u, v) for u, v in ((0, 1), (1, 1), (1, 0), (0, 0))], (0, 0, -1))
    # cab: four posts, glass panels, roof
    cz0, cz1 = -1.05, 0.38
    cy0, cy1 = 1.02, 2.2
    cw = 0.62
    post = 0.05
    for xs in (1, -1):
        for zz in (cz0, cz1):
            box(mb, (xs * cw, (cy0 + cy1) / 2, zz), (post, cy1 - cy0, post), "paint_black")
    # glass (opaque, dark)
    def glass_panel(p0, p1, p2, p3, nrm):
        mb.poly([p0, p1, p2, p3], [sw_uv("glass", 0.5, 0.5)] * 4, nrm)
    for xs in (1, -1):
        glass_panel((xs * cw, cy0 + 0.05, cz0), (xs * cw, cy0 + 0.05, cz1), (xs * cw, cy1 - 0.05, cz1), (xs * cw, cy1 - 0.05, cz0), (xs, 0, 0))
    glass_panel((-cw, cy0 + 0.25, cz1), (cw, cy0 + 0.25, cz1), (cw, cy1 - 0.05, cz1), (-cw, cy1 - 0.05, cz1), (0, 0, 1))
    glass_panel((-cw, cy0 + 0.1, cz0), (cw, cy0 + 0.1, cz0), (cw, cy1 - 0.05, cz0), (-cw, cy1 - 0.05, cz0), (0, 0, -1))
    # cab lower panel (paint) front, between hood and glass
    box(mb, (0, cy0 + 0.12, cz1), (2 * cw, 0.26, 0.04), "paint", uv_fn=pu)
    # roof (painted, white-ish handled by the paint tint) with overhang
    box(mb, (0, cy1 + 0.05, (cz0 + cz1) / 2), (2 * cw + 0.14, 0.1, cz1 - cz0 + 0.2), "paint", uv_fn=pu)
    # roof lamps + beacon-less work lights
    if lod < 2:
        for xs in (1, -1):
            box(mb, (xs * 0.5, cy1 + 0.02, cz1 + 0.1), (0.12, 0.09, 0.07), "paint_black")
            pts = [(xs * 0.5 - 0.05, cy1 - 0.02, cz1 + 0.136), (xs * 0.5 + 0.05, cy1 - 0.02, cz1 + 0.136),
                   (xs * 0.5 + 0.05, cy1 + 0.06, cz1 + 0.136), (xs * 0.5 - 0.05, cy1 + 0.06, cz1 + 0.136)]
            mb.poly(pts, [sw_uv("lamp_round", u, v) for u, v in ((0, 1), (1, 1), (1, 0), (0, 0))], (0, 0, 1))
    # exhaust stack in front of the cab (right side)
    cylinder_y(mb, (-0.24, 1.25, 0.5), 0.045, 1.05, 8 if lod == 0 else 5, "paint_black")
    # seat back visible through glass? (glass is opaque) -> skip; steps
    for xs in (1, -1):
        box(mb, (xs * 0.45, 0.5, 0.15), (0.2, 0.03, 0.25), "galv")
    # rear three-point hitch + plate
    box(mb, (0, 0.55, -s.wb / 2 - 0.45), (0.7, 0.1, 0.1), "paint_black")
    for xs in (1, -1):
        box(mb, (xs * 0.3, 0.45, -s.wb / 2 - 0.3), (0.05, 0.05, 0.4), "paint_black")
    if lod < 2:
        u0, v0, u1, v1 = LAYOUT["plates"]
        cwp = (u1 - u0) / ATLAS["plateCols"]
        chp = (v1 - v0) / ATLAS["plateRows"]
        pu0, pu1, pv0, pv1 = u0 + cwp * 2 / 256, u0 + cwp * 254 / 256, v0 + chp * 5 / 64, v0 + chp * 59 / 64
        z = -s.wb / 2 - 0.505
        pts = [(0.26, 0.62, z), (-0.26, 0.62, z), (-0.26, 0.73, z), (0.26, 0.73, z)]
        mb.poly(pts, [(pu0, pv1), (pu1, pv1), (pu1, pv0), (pu0, pv0)], (0, 0, -1))
    # front lamps in the grille
    for xs in (1, -1):
        pts = [(xs * 0.2 - 0.06, 1.02, zf + 0.004), (xs * 0.2 + 0.06, 1.02, zf + 0.004), (xs * 0.2 + 0.06, 1.12, zf + 0.004), (xs * 0.2 - 0.06, 1.12, zf + 0.004)]
        mb.poly(pts, [sw_uv("lamp_round", u, v) for u, v in ((0, 1), (1, 1), (1, 0), (0, 0))], (0, 0, 1))
    if lod == 2:
        for (x, r, z, w) in ((s.track / 2, s.r_front, s.wb / 2, s.tyre_w_f), (s.track / 2, s.r_rear, -s.wb / 2, s.tyre_w_r)):
            simple_wheels(mb, s, [(x, r, z, r, w)])
    return mb


# ------------------------------------------------------------------------------------------------ Blender output
def material():
    mat = bpy.data.materials.get("Traffic_Car_Atlas")
    if mat is None:
        mat = bpy.data.materials.new("Traffic_Car_Atlas")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.4
    return mat


def to_object(mb: MB, name: str, col):
    me = bpy.data.meshes.new(name)
    verts = [(x, -z, y) for x, y, z in mb.v]
    me.from_pydata(verts, [], mb.f)
    me.update()
    if len(me.polygons) != len(mb.f):
        raise RuntimeError(f"{name}: Blender dropped faces ({len(me.polygons)} of {len(mb.f)}) - degenerate input")
    uvl = me.uv_layers.new(name="UVMap")
    li = 0
    for pi, poly in enumerate(me.polygons):
        uvs = mb.uv[pi]
        for k, loop_index in enumerate(poly.loop_indices):
            u, v = uvs[k]
            uvl.data[loop_index].uv = (u, 1.0 - v)
        poly.use_smooth = mb.smooth[pi]
    me.materials.append(material())
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    return obj


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    col = bpy.data.collections.new("Traffic")
    bpy.context.scene.collection.children.link(col)
    manifest = {"version": 1, "glb": "assets/models/traffic/cars.glb",
                "textures": {"albedo": "assets/models/traffic/traffic_car_albedo.webp",
                             "albedo1k": "assets/models/traffic/traffic_car_albedo_1k.webp",
                             "normal": "assets/models/traffic/traffic_car_normal.webp",
                             "orm": "assets/models/traffic/traffic_car_orm.webp",
                             "mask": "assets/models/traffic/traffic_car_mask.png"},
                "plates": {"rect": list(LAYOUT["plates"]), "cols": ATLAS["plateCols"], "rows": ATLAS["plateRows"],
                           "count": len(ATLAS["plateTexts"])},
                "types": {}}
    report = []
    objs = []
    for s in SPECS:
        tris = []
        for lod in (0, 1, 2):
            mb = build_car(s, lod)
            objs.append(to_object(mb, f"{s.name}_LOD{lod}", col))
            tris.append(mb.tri_count())
        wt = []
        for lod in (0, 1):
            mb = wheel(s.r_front, s.tyre_w, s.rim, lod)
            objs.append(to_object(mb, f"{s.name}_wheel_LOD{lod}", col))
            wt.append(mb.tri_count())
        full_L = getattr(s, "full_L", s.L)
        zf = s.wb / 2 + s.fo
        body = Body(s)
        manifest["types"][s.name] = {
            "label": s.label, "length": round(full_L, 3), "width": s.W, "height": s.H, "wheelbase": s.wb,
            "track": s.track, "frontZ": round(zf, 3), "rearZ": round(zf - full_L, 3),
            "wheels": [{"lod0": f"{s.name}_wheel_LOD0", "lod1": f"{s.name}_wheel_LOD1", "radius": s.r_front, "x": s.track / 2, "z": s.wb / 2, "steer": True},
                       {"lod0": f"{s.name}_wheel_LOD0", "lod1": f"{s.name}_wheel_LOD1", "radius": s.r_rear, "x": s.track / 2, "z": -s.wb / 2, "steer": False}],
            "lods": [f"{s.name}_LOD0", f"{s.name}_LOD1", f"{s.name}_LOD2"],
            "lamps": {
                "head": [[round(body.halfwidth(zf) - 0.2, 3), round(body.top(zf) - 0.12, 3), round(body.fascia_z(body.halfwidth(zf) - 0.2, 1) + 0.02, 3)]],
                "tail": [[round(body.halfwidth(zf - full_L) - 0.15, 3), round(body.shoulder(zf - full_L) - 0.05 if s.vertical_tail else body.top(zf - full_L) - 0.14, 3), round(zf - full_L - 0.02, 3)]],
            },
            "triangles": {"lod": tris, "wheel": wt},
        }
        report.append(f"{s.name}: body {tris}, wheel {wt}")
    # small vineyard tractor
    tris = []
    for lod in (0, 1, 2):
        mb = build_tractor(lod)
        objs.append(to_object(mb, f"tractor_LOD{lod}", col))
        tris.append(mb.tri_count())
    wt = []
    for lod in (0, 1):
        for key, r, w in (("F", TRACTOR.r_front, TRACTOR.tyre_w_f), ("R", TRACTOR.r_rear, TRACTOR.tyre_w_r)):
            mb = wheel(r, w, "rim_tractor", lod, tractor=True, rim_frac=0.58)
            objs.append(to_object(mb, f"tractor_wheel{key}_LOD{lod}", col))
            wt.append(mb.tri_count())
    zf = TRACTOR.wb / 2 + TRACTOR.fo
    manifest["types"]["tractor"] = {
        "label": TRACTOR.label, "length": TRACTOR.L, "width": TRACTOR.W, "height": TRACTOR.H, "wheelbase": TRACTOR.wb,
        "track": TRACTOR.track, "frontZ": zf, "rearZ": round(-TRACTOR.wb / 2 - 0.55, 3),
        "wheels": [{"lod0": "tractor_wheelF_LOD0", "lod1": "tractor_wheelF_LOD1", "radius": TRACTOR.r_front, "x": TRACTOR.track / 2 - 0.02, "z": TRACTOR.wb / 2, "steer": True},
                   {"lod0": "tractor_wheelR_LOD0", "lod1": "tractor_wheelR_LOD1", "radius": TRACTOR.r_rear, "x": TRACTOR.track / 2, "z": -TRACTOR.wb / 2, "steer": False}],
        "lods": ["tractor_LOD0", "tractor_LOD1", "tractor_LOD2"],
        "lamps": {"head": [[0.2, 1.07, zf + 0.02]], "tail": [[0.68, 0.99, round(-TRACTOR.wb / 2 - 0.45, 3)]]},
        "triangles": {"lod": tris, "wheel": wt},
    }
    report.append(f"tractor: body {tris}, wheels {wt}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    glb = OUT_DIR / "cars.glb"
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(glb), export_format='GLB', export_yup=True, use_selection=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_vertex_color='NONE',
        export_materials='EXPORT', export_image_format='NONE', export_cameras=False, export_lights=False,
        export_animations=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=13, export_draco_generic_quantization=12,
    )
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print("\n".join(report))
    print(f"cars.glb: {glb.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
