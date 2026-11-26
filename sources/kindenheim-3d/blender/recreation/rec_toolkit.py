"""
Modelling toolkit for the Kindenheim recreation assets (Blender 5.2, background mode).

Self-contained on purpose (no import from blender/landmarks): other agents edit those files.

Concepts
--------
* `Acc`    raw geometry accumulator for ONE material: vertices, polygons, per-corner UVs (in METRES,
           U along the member / grain, V across) and a per-corner tint.
* `Model`  a set of accumulators (plus optional child objects with their own pivot) that is turned
           into Blender objects and exported as one .glb.
* Normals  every mesh gets area-weighted custom split normals with a 50 degree smoothing limit, so a
           one-segment chamfer reads as a rounded edge while the big faces stay flat.
* Colour   COLOR_0 carries a per-primitive tint jitter and a ground-contact grime gradient. It
           multiplies the library albedo at runtime, which breaks up identical planks/posts.
* Materials reference the shared PBR library by id (`lib` custom property -> glTF extras ->
           three `material.userData.lib`). The textures themselves live once in
           `recreation_materials.glb`; `src/recreation.ts` binds them after loading.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

V = Vector
UP = Vector((0.0, 0.0, 1.0))


def mat4(loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)) -> Matrix:
    m = Matrix.Translation(Vector(loc)) @ Euler(rot, "XYZ").to_matrix().to_4x4()
    if scale != (1.0, 1.0, 1.0):
        m = m @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return m


def lerp(a, b, t):
    return a + (b - a) * t


def fillet(points, radius: float, n: int = 5):
    """Round every interior corner of a polyline with an arc of `radius` (n segments)."""
    pts = [Vector(p) for p in points]
    if len(pts) < 3 or radius <= 0.0:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
        d0, d1 = (p0 - p1), (p2 - p1)
        l0, l1 = d0.length, d1.length
        if l0 < 1e-6 or l1 < 1e-6:
            out.append(p1)
            continue
        d0n, d1n = d0 / l0, d1 / l1
        ang = d0n.angle(d1n)
        if ang > math.pi - 1e-3:
            out.append(p1)
            continue
        t = min(radius / math.tan(ang * 0.5), l0 * 0.48, l1 * 0.48)
        a, b = p1 + d0n * t, p1 + d1n * t
        for k in range(n + 1):
            s = k / n
            # quadratic Bezier through the corner: close enough to an arc for pipe bends
            out.append((1 - s) * (1 - s) * a + 2 * (1 - s) * s * p1 + s * s * b)
    out.append(pts[-1])
    return out


def smooth_closed(points, sub: int = 4):
    """Closed Catmull-Rom spline through 2D control points -> smooth outline for HDPE panel cut-outs."""
    n = len(points)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = points[i - 1], points[i], points[(i + 1) % n], points[(i + 2) % n]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(tuple(
                0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)
                for c in range(2)
            ))
    return out


def arc_points(center, radius: float, a0: float, a1: float, n: int, plane: str = "XZ"):
    c = Vector(center)
    pts = []
    for i in range(n + 1):
        a = lerp(a0, a1, i / n)
        ca, sa = math.cos(a) * radius, math.sin(a) * radius
        if plane == "XZ":
            pts.append(c + Vector((ca, 0.0, sa)))
        elif plane == "YZ":
            pts.append(c + Vector((0.0, ca, sa)))
        else:
            pts.append(c + Vector((ca, sa, 0.0)))
    return pts


class Acc:
    def __init__(self, key: str, spec: dict, seed: int):
        self.key = key
        self.spec = spec
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.uvs: list[tuple[float, float]] = []
        self.cols: list[float] = []
        self.fixed: list[bool] = []  # True = winding given explicitly (open surface), never auto-flipped
        self.rng = random.Random(seed)
        self.jitter = spec.get("jitter", 0.04)

    # -- low level -----------------------------------------------------------------------
    def emit(self, verts, faces, face_uvs, tint: float = 1.0, uv_offset: bool = True, fixed: bool = False):
        base = len(self.verts)
        t = tint * (1.0 + self.rng.uniform(-self.jitter, self.jitter))
        ou, ov = (self.rng.uniform(0.0, 9.0), self.rng.uniform(0.0, 9.0)) if uv_offset else (0.0, 0.0)
        for v in verts:
            self.verts.append((v[0], v[1], v[2]))
        for f, fuv in zip(faces, face_uvs):
            if len(f) != len(fuv):
                raise ValueError(f"UV count mismatch in '{self.key}': face {len(f)} vs uv {len(fuv)}")
            self.faces.append(tuple(base + i for i in f))
            self.fixed.append(fixed)
            for (u, v) in fuv:
                self.uvs.append((u + ou, v + ov))
                self.cols.append(t)

    def emit_bm(self, bm, matrix: Matrix, tint: float = 1.0, grain_axis: int | None = None):
        """Emit a temp bmesh (built around its local origin) with local box-projected metric UVs."""
        bm.verts.ensure_lookup_table()
        bm.verts.index_update()
        bm.normal_update()
        co = [v.co.copy() for v in bm.verts]
        if grain_axis is None:
            mins = [min(c[i] for c in co) for i in range(3)]
            maxs = [max(c[i] for c in co) for i in range(3)]
            ext = [maxs[i] - mins[i] for i in range(3)]
            grain_axis = ext.index(max(ext))
        if self.spec.get("world_uv"):
            # continuous model-space box projection (plaster, concrete, paving): U horizontal, V up
            rot = matrix.to_3x3()
            wco = [matrix @ c for c in co]
            faces, fuvs = [], []
            for f in bm.faces:
                n = rot @ f.normal
                ax = max(range(3), key=lambda i: abs(n[i]))
                ua, va = ((1, 2), (0, 2), (0, 1))[ax]
                faces.append([v.index for v in f.verts])
                fuvs.append([(wco[v.index][ua], wco[v.index][va]) for v in f.verts])
            self.emit(wco, faces, fuvs, tint, uv_offset=False)
            bm.free()
            return
        faces, fuvs = [], []
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            others = [i for i in range(3) if i != ax]
            if grain_axis in others:
                ua = grain_axis
                va = others[0] if others[1] == grain_axis else others[1]
            else:
                ua, va = others
            faces.append([v.index for v in f.verts])
            fuvs.append([(v.co[ua], v.co[va]) for v in f.verts])
        self.emit([matrix @ c for c in co], faces, fuvs, tint)
        bm.free()

    # -- primitives ----------------------------------------------------------------------
    def box(self, center, size, rot=(0.0, 0.0, 0.0), bevel: float = 0.0, tint: float = 1.0, matrix: Matrix | None = None):
        """Box with optional one-segment chamfer (reads as a rounded edge thanks to weighted normals)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((size[0], size[1], size[2], 1.0)))
        b = min(bevel, min(size) * 0.45)
        if b > 1e-5:
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=b, segments=1, affect="EDGES", profile=0.5)
        m = mat4(center, rot)
        if matrix is not None:
            m = matrix @ m
        self.emit_bm(bm, m, tint)

    def beam(self, p0, p1, w: float, h: float, bevel: float = 0.006, tint: float = 1.0, up=None):
        """Rectangular member from p0 to p1: `w` across (horizontal), `h` along the (near-)vertical."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        ln = d.length
        if ln < 1e-6:
            raise ValueError("beam needs two distinct points")
        x = d / ln
        upv = Vector(up) if up is not None else UP
        y = upv.cross(x)
        if y.length < 1e-5:
            y = Vector((0.0, 1.0, 0.0)).cross(x)
        y.normalize()
        z = x.cross(y)
        m = Matrix((x, y, z)).transposed().to_4x4()
        m.translation = (p0 + p1) * 0.5
        self.box((0.0, 0.0, 0.0), (ln, w, h), bevel=bevel, tint=tint, matrix=m)

    def face_quad(self, cx: float, y: float, cz: float, w: float, h: float, rect=(0.0, 0.0, 1.0, 1.0), facing: int = -1):
        """Textured quad in the XZ plane facing -Y (facing=-1) or +Y (facing=+1); rect = atlas (u0, v0, u1, v1)."""
        u0, v0, u1, v1 = rect
        hw, hh = w * 0.5, h * 0.5
        if facing < 0:
            pts = [(cx - hw, y, cz - hh), (cx + hw, y, cz - hh), (cx + hw, y, cz + hh), (cx - hw, y, cz + hh)]
        else:
            pts = [(cx + hw, y, cz - hh), (cx - hw, y, cz - hh), (cx - hw, y, cz + hh), (cx + hw, y, cz + hh)]
        self.quad(*pts, uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    def tube(self, pts, radius, segs: int = 8, caps: bool = True, closed: bool = False, tint: float = 1.0):
        """Sweep a circle along a polyline. `radius` may be a float or one value per point."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        if n < 2:
            raise ValueError("tube needs at least two points")
        radii = [radius] * n if isinstance(radius, (int, float)) else list(radius)
        tans = []
        for i in range(n):
            if closed:
                t = (pts[(i + 1) % n] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            elif i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            if t.length < 1e-9:
                t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tans.append(t.normalized())
        ref = UP if abs(tans[0].z) < 0.92 else Vector((1.0, 0.0, 0.0))
        nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
        verts, lens = [], [0.0]
        for i in range(n):
            t = tans[i]
            nrm = nrm - t * nrm.dot(t)
            if nrm.length < 1e-6:
                ref = UP if abs(t.z) < 0.92 else Vector((1.0, 0.0, 0.0))
                nrm = ref - t * ref.dot(t)
            nrm.normalize()
            bn = t.cross(nrm)
            for j in range(segs):
                a = 2.0 * math.pi * j / segs
                verts.append(pts[i] + (nrm * math.cos(a) + bn * math.sin(a)) * radii[i])
            if i > 0:
                lens.append(lens[-1] + (pts[i] - pts[i - 1]).length)
        if closed:
            lens.append(lens[-1] + (pts[0] - pts[-1]).length)
        circ = 2.0 * math.pi * max(radii)
        faces, fuvs = [], []
        rings = n if closed else n - 1
        for i in range(rings):
            i1 = (i + 1) % n
            for j in range(segs):
                j1 = (j + 1) % segs
                faces.append((i * segs + j, i * segs + j1, i1 * segs + j1, i1 * segs + j))
                v0, v1 = circ * j / segs, circ * (j + 1) / segs
                fuvs.append([(lens[i], v0), (lens[i], v1), (lens[i + 1], v1), (lens[i + 1], v0)])
        if caps and not closed:
            faces.append(tuple(range(segs - 1, -1, -1)))
            fuvs.append([(math.cos(2 * math.pi * j / segs) * radii[0], math.sin(2 * math.pi * j / segs) * radii[0]) for j in range(segs - 1, -1, -1)])
            base = (n - 1) * segs
            faces.append(tuple(base + j for j in range(segs)))
            fuvs.append([(math.cos(2 * math.pi * j / segs) * radii[-1], math.sin(2 * math.pi * j / segs) * radii[-1]) for j in range(segs)])
        self.emit(verts, faces, fuvs, tint)

    def cyl(self, p0, p1, r0: float, r1: float | None = None, segs: int = 12, caps: bool = True, tint: float = 1.0):
        self.tube([p0, p1], [r0, r0 if r1 is None else r1], segs=segs, caps=caps, tint=tint)

    def post(self, p0, p1, radius: float, chamfer: float = 0.012, segs: int = 12, tint: float = 1.0, taper: float = 0.0):
        """Round timber / steel member with chamfered ends."""
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0)
        ln = d.length
        dn = d / ln
        c = min(chamfer, ln * 0.2, radius * 0.5)
        r1 = radius * (1.0 - taper)
        self.tube(
            [p0, p0 + dn * c, p1 - dn * c, p1],
            [radius - c, radius, r1, r1 - c],
            segs=segs,
            tint=tint,
        )

    def pipe(self, pts, radius: float, bend: float = 0.0, segs: int = 8, caps: bool = True, tint: float = 1.0, bend_n: int = 5, closed: bool = False):
        """Bent tube: polyline with filleted corners."""
        self.tube(fillet(pts, bend, bend_n) if bend > 0 else pts, radius, segs=segs, caps=caps, tint=tint, closed=closed)

    def lathe(self, profile, segs: int = 16, matrix: Matrix | None = None, tint: float = 1.0):
        """Revolve an (r, z) profile around local Z. r == 0 endpoints collapse to a pole."""
        m = matrix or Matrix.Identity(4)
        verts, ring_start, ring_len = [], [], []
        for (r, z) in profile:
            ring_start.append(len(verts))
            if r <= 1e-7:
                verts.append(m @ Vector((0.0, 0.0, z)))
                ring_len.append(1)
            else:
                for j in range(segs):
                    a = 2.0 * math.pi * j / segs
                    verts.append(m @ Vector((math.cos(a) * r, math.sin(a) * r, z)))
                ring_len.append(segs)
        rmax = max(r for r, _ in profile)
        circ = 2.0 * math.pi * rmax
        faces, fuvs = [], []
        s = 0.0
        for i in range(len(profile) - 1):
            (r0, z0), (r1, z1) = profile[i], profile[i + 1]
            s1 = s + math.hypot(r1 - r0, z1 - z0)
            a0, a1 = ring_start[i], ring_start[i + 1]
            for j in range(segs):
                j1 = (j + 1) % segs
                v0, v1 = circ * j / segs, circ * (j + 1) / segs
                if ring_len[i] == 1 and ring_len[i + 1] == 1:
                    continue
                if ring_len[i] == 1:
                    faces.append((a0, a1 + j1, a1 + j))
                    fuvs.append([(s, (v0 + v1) * 0.5), (s1, v1), (s1, v0)])
                elif ring_len[i + 1] == 1:
                    faces.append((a0 + j, a0 + j1, a1))
                    fuvs.append([(s, v0), (s, v1), (s1, (v0 + v1) * 0.5)])
                else:
                    faces.append((a0 + j, a0 + j1, a1 + j1, a1 + j))
                    fuvs.append([(s, v0), (s, v1), (s1, v1), (s1, v0)])
            s = s1
        # profile given bottom->top with increasing z yields outward faces; flip if it runs downwards
        if profile[0][1] > profile[-1][1]:
            faces = [tuple(reversed(f)) for f in faces]
            fuvs = [list(reversed(u)) for u in fuvs]
        self.emit(verts, faces, fuvs, tint)

    def sphere(self, center, radius: float, scale=(1.0, 1.0, 1.0), segs: int = 12, rings: int = 7, tint: float = 1.0, rot=(0.0, 0.0, 0.0)):
        prof = [(math.sin(math.pi * i / rings) * radius, -math.cos(math.pi * i / rings) * radius) for i in range(rings + 1)]
        prof[0] = (0.0, -radius)
        prof[-1] = (0.0, radius)
        self.lathe(prof, segs=segs, matrix=mat4(center, rot, scale), tint=tint)

    def torus(self, center, major: float, minor: float, major_segs: int = 20, minor_segs: int = 8, matrix: Matrix | None = None, tint: float = 1.0):
        m = (matrix or Matrix.Identity(4))
        c = Vector(center)
        pts = [m @ (c + Vector((math.cos(2 * math.pi * i / major_segs) * major, math.sin(2 * math.pi * i / major_segs) * major, 0.0))) for i in range(major_segs)]
        self.tube(pts, minor, segs=minor_segs, closed=True, tint=tint)

    def helix(self, base, radius: float, wire: float, turns: float, height: float, per_turn: int = 16, wire_segs: int = 7, tint: float = 1.0, radius_top: float | None = None):
        b = Vector(base)
        n = max(2, int(turns * per_turn))
        rt = radius if radius_top is None else radius_top
        pts = []
        for i in range(n + 1):
            s = i / n
            a = 2.0 * math.pi * turns * s
            r = lerp(radius, rt, s)
            pts.append(b + Vector((math.cos(a) * r, math.sin(a) * r, height * s)))
        self.tube(pts, wire, segs=wire_segs, tint=tint)

    def prism(self, outline, depth: float, matrix: Matrix, bevel: float = 0.0, tint: float = 1.0):
        """Extrude a 2D outline (local X/Z) along local Y by `depth` (centred on Y = 0)."""
        bm = bmesh.new()
        lo = [bm.verts.new((x, -depth * 0.5, z)) for (x, z) in outline]
        hi = [bm.verts.new((x, depth * 0.5, z)) for (x, z) in outline]
        n = len(outline)
        bm.faces.new(lo)
        bm.faces.new(list(reversed(hi)))
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([lo[j], lo[i], hi[i], hi[j]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bevel > 1e-5:
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES", profile=0.5)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
        self.emit_bm(bm, matrix, tint, grain_axis=0)

    def quad(self, p0, p1, p2, p3, uvs=None, tint: float = 1.0, uv_offset: bool = False):
        """Single quad, counter-clockwise seen from its front. Default UV: metric (u along p0->p1)."""
        p0, p1, p2, p3 = Vector(p0), Vector(p1), Vector(p2), Vector(p3)
        if uvs is None:
            w, h = (p1 - p0).length, (p3 - p0).length
            uvs = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
        self.emit([p0, p1, p2, p3], [(0, 1, 2, 3)], [list(uvs)], tint, uv_offset=uv_offset, fixed=True)

    def grid(self, fn, nu: int, nv: int, uv_fn=None, tint: float = 1.0, flip: bool = False):
        """Parametric surface fn(s, t) -> point for s, t in [0, 1]. uv_fn(s, t) -> metric uv."""
        verts, uv = [], []
        for j in range(nv + 1):
            for i in range(nu + 1):
                s, t = i / nu, j / nv
                verts.append(Vector(fn(s, t)))
                uv.append(uv_fn(s, t) if uv_fn else None)
        if uv_fn is None:
            # arc-length parametrisation along both directions (good enough for nets / sheets)
            for j in range(nv + 1):
                for i in range(nu + 1):
                    idx = j * (nu + 1) + i
                    du = (verts[idx] - verts[j * (nu + 1)]).length if i else 0.0
                    dv = (verts[idx] - verts[i]).length if j else 0.0
                    uv[idx] = (du, dv)
        faces, fuvs = [], []
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                b, c, d = a + 1, a + nu + 2, a + nu + 1
                f = (a, b, c, d) if not flip else (a, d, c, b)
                faces.append(f)
                fuvs.append([uv[k] for k in f])
        self.emit(verts, faces, fuvs, tint, uv_offset=False, fixed=True)

    def sweep(self, path, profile, side=(1.0, 0.0, 0.0), closed_profile: bool = False, tint: float = 1.0, flip: bool = False):
        """Sweep an open/closed 2D profile [(s, h)] along `path`; s runs along `side`, h along the path normal."""
        path = [Vector(p) for p in path]
        sv = Vector(side).normalized()
        n = len(path)
        verts, lens = [], [0.0]
        for i in range(n):
            if i == 0:
                t = path[1] - path[0]
            elif i == n - 1:
                t = path[-1] - path[-2]
            else:
                t = (path[i + 1] - path[i]).normalized() + (path[i] - path[i - 1]).normalized()
            t.normalize()
            up = sv.cross(t).normalized()
            if i > 0:
                lens.append(lens[-1] + (path[i] - path[i - 1]).length)
            for (s, h) in profile:
                verts.append(path[i] + sv * s + up * h)
        m = len(profile)
        plen = [0.0]
        for k in range(1, m):
            plen.append(plen[-1] + math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]))
        if closed_profile:
            plen.append(plen[-1] + math.hypot(profile[0][0] - profile[-1][0], profile[0][1] - profile[-1][1]))
        faces, fuvs = [], []
        segs = m if closed_profile else m - 1
        for i in range(n - 1):
            for k in range(segs):
                k1 = (k + 1) % m
                f = (i * m + k, i * m + k1, (i + 1) * m + k1, (i + 1) * m + k)
                uvq = [(lens[i], plen[k]), (lens[i], plen[k + 1]), (lens[i + 1], plen[k + 1]), (lens[i + 1], plen[k])]
                if flip:
                    f = tuple(reversed(f))
                    uvq = list(reversed(uvq))
                faces.append(f)
                fuvs.append(uvq)
        self.emit(verts, faces, fuvs, tint, fixed=not closed_profile)

    def strip_cross(self, p0, p1, width: float, tile_len: float, tint: float = 1.0):
        """Two crossed alpha-textured strips between p0 and p1 (chains). UV: u 0..1 across, v repeats."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        ln = d.length
        t = d / ln
        ref = UP if abs(t.z) < 0.92 else Vector((1.0, 0.0, 0.0))
        a = t.cross(ref).normalized()
        b = t.cross(a).normalized()
        vr = ln / tile_len
        for side in (a, b):
            h = side * (width * 0.5)
            self.emit(
                [p0 - h, p0 + h, p1 + h, p1 - h],
                [(0, 1, 2, 3)],
                [[(0.0, 0.0), (1.0, 0.0), (1.0, vr), (0.0, vr)]],
                tint,
                uv_offset=False,
                fixed=True,
            )

    def bolt(self, pos, axis=(0.0, 0.0, 1.0), radius: float = 0.012, height: float = 0.008):
        """Hex/dome bolt head sitting on a surface at `pos`, pointing along `axis`."""
        ax = Vector(axis).normalized()
        q = UP.rotation_difference(ax).to_matrix().to_4x4()
        self.lathe([(radius, 0.0), (radius, height * 0.6), (radius * 0.55, height), (0.0, height)], segs=6, matrix=Matrix.Translation(Vector(pos)) @ q)


# ---------------------------------------------------------------------------
# Mesh finalisation
# ---------------------------------------------------------------------------

SMOOTH_LIMIT_COS = math.cos(math.radians(50.0))


def _weighted_normals(mesh) -> None:
    """Area-weighted custom split normals with a smoothing-angle limit (see module docstring)."""
    mesh.update()
    polys = mesh.polygons
    pn = [p.normal.copy() for p in polys]
    pa = [p.area for p in polys]
    vert_faces: dict[int, list[int]] = {}
    for p in polys:
        for vi in p.vertices:
            vert_faces.setdefault(vi, []).append(p.index)
    loop_normals = [None] * len(mesh.loops)
    for p in polys:
        n0 = pn[p.index]
        for li in p.loop_indices:
            vi = mesh.loops[li].vertex_index
            acc = Vector((0.0, 0.0, 0.0))
            for fi in vert_faces[vi]:
                if pn[fi].dot(n0) >= SMOOTH_LIMIT_COS:
                    acc += pn[fi] * pa[fi]
            loop_normals[li] = acc.normalized() if acc.length > 1e-12 else n0
    mesh.polygons.foreach_set("use_smooth", [True] * len(polys))
    mesh.normals_split_custom_set([tuple(n) for n in loop_normals])


def grime_factor(z: float, height: float, strength: float) -> float:
    if strength <= 0.0 or height <= 0.0:
        return 1.0
    t = max(0.0, min(1.0, z / height))
    t = t * t * (3.0 - 2.0 * t)
    return 1.0 - strength * (1.0 - t)


def build_mesh(name: str, parts: list[tuple[Acc, object]], origin=(0.0, 0.0, 0.0), ground_z: float = 0.0):
    """parts: list of (Acc, bpy material). Returns a Blender mesh object (one slot per part)."""
    o = Vector(origin)
    verts, faces, uvs, cols, mat_idx, fixed = [], [], [], [], [], []
    for slot, (acc, _mat) in enumerate(parts):
        spec = acc.spec
        tw, th = spec.get("tile", (1.0, 1.0))
        swap = spec.get("swap", False)
        gh, gs = spec.get("grime_h", 0.35), spec.get("grime", 0.0)
        base = len(verts)
        verts.extend(acc.verts)
        loop = 0
        fixed.extend(acc.fixed)
        for f in acc.faces:
            faces.append(tuple(base + i for i in f))
            mat_idx.append(slot)
            for vi in f:
                u, v = acc.uvs[loop]
                uvs.append((v / tw, u / th) if swap else (u / tw, v / th))
                g = grime_factor(acc.verts[vi][2] - ground_z, gh, gs)
                t = acc.cols[loop] * g
                # grime is slightly warm/brown, not neutral grey
                cols.append((min(t, 1.0), min(t * (0.985 + 0.015 * g), 1.0), min(t * (0.96 + 0.04 * g), 1.0), 1.0))
                loop += 1
    if not faces:
        raise ValueError(f"Mesh '{name}' has no geometry")
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(v[0] - o.x, v[1] - o.y, v[2] - o.z) for v in verts], [], faces)
    mesh.update()
    if len(mesh.loops) != len(uvs):
        raise RuntimeError(f"Mesh '{name}': Blender dropped degenerate faces ({len(mesh.loops)} loops vs {len(uvs)} uvs)")
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uv_layer.data.foreach_set("uv", [c for uv in uvs for c in uv])
    # COLOR_0 only where it carries information (saves 8 bytes per vertex on roofs, glass, nets ...)
    if any(abs(c[0] - 1.0) > 1e-4 or abs(c[2] - 1.0) > 1e-4 for c in cols):
        col_attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
        col_attr.data.foreach_set("color", [c for col in cols for c in col])
        mesh.color_attributes.active_color = col_attr
        mesh.color_attributes.render_color_index = 0
    mesh.polygons.foreach_set("material_index", mat_idx)
    for _acc, mat in parts:
        mesh.materials.append(mat)
    # Closed primitives: make every island face outwards (UV / colour corners follow the flip).
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    free = [bm.faces[i] for i, fx in enumerate(fixed) if not fx]
    if free:
        bmesh.ops.recalc_face_normals(bm, faces=free)
    bm.to_mesh(mesh)
    bm.free()
    _weighted_normals(mesh)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = o
    return obj


def count_tris(obj) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def ensure_collection(name: str):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def load_image(path: Path, name: str, colorspace: str):
    if not path.exists():
        raise FileNotFoundError(f"Texture file missing: {path}")
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.load(str(path), check_existing=False)
        img.name = name
    img.colorspace_settings.name = colorspace
    return img
