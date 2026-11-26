#!/usr/bin/env python3
"""
Shared Blender 5.2 modelling toolkit for the Kindenheim hero vehicle (tractor + grape trailer).

COORDINATE CONTRACT
- All geometry is authored in Three.js / glTF vehicle coordinates:
      +X = left side of vehicle, +Y = up (0.0 = tyre contact with the ground), +Z = forward.
- A piece is a bmesh in those coordinates. `Node.add()` merges pieces per material; `Node.build()` converts
  to Blender Z-up via gl_to_bl(x, y, z) = (x, -z, y) so the glTF exporter (`export_yup=True`) writes the
  original vehicle coordinates again.

SHADING
- Hard edges are physically split (`sharp` angle per piece); every vertex then gets a face-area weighted
  custom normal. Together with 1-2 segment bevels this gives clean flat panels with a real highlight
  on every edge instead of pillow shading.
- Every vertex carries a float `_DIRT` attribute (0..1) that the runtime shader in `src/tractor.ts`
  turns into dust / dried mud (lighter, rougher, no clearcoat) with procedural break-up.
"""

import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

TRACTOR_DIR = Path(__file__).resolve().parent
TEX_DIR = TRACTOR_DIR / "textures"
PROJECT_DIR = TRACTOR_DIR.parent.parent
GLB_OUT_DIR = PROJECT_DIR / "public" / "assets" / "models" / "tractor"
SHARED_TEX_DIR = PROJECT_DIR / "blender" / "shared_textures"

GL2BL = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def gl_to_bl(gx: float, gy: float, gz: float) -> Vector:
    return Vector((gx, -gz, gy))


def V(x=0.0, y=0.0, z=0.0) -> Vector:
    return Vector((x, y, z))


def T(x=0.0, y=0.0, z=0.0) -> Matrix:
    return Matrix.Translation((x, y, z))


def RX(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, 'X')


def RY(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, 'Y')


def RZ(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, 'Z')


def SC(x: float, y: float | None = None, z: float | None = None) -> Matrix:
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    return scene


def ensure_collection(name: str):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


# ---------------------------------------------------------------------------
# Curves / profiles
# ---------------------------------------------------------------------------

def catmull(points, sub=4, closed=False):
    """Catmull-Rom resample of 2D/3D tuples/Vectors."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    out = []
    last = n if closed else n - 1
    for i in range(last):
        p0 = pts[(i - 1) % n] if (closed or i > 0) else pts[0] * 2 - pts[1]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if (closed or i + 2 < n) else pts[-1] * 2 - pts[-2]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(pts[-1].copy())
    return out


def fillet_path(points, radius=0.05, n=4):
    """Round the inner corners of a 3D polyline with quadratic Bezier arcs."""
    pts = [Vector(p) for p in points]
    if len(pts) < 3 or radius <= 0:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d0, d1 = (a - b), (c - b)
        r = min(radius, d0.length * 0.45, d1.length * 0.45)
        p0 = b + d0.normalized() * r
        p1 = b + d1.normalized() * r
        for k in range(n + 1):
            t = k / n
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p1)
    out.append(pts[-1])
    return out


def rrect(w, h, r, n=3):
    """Closed CCW rounded-rectangle profile centred on the origin."""
    r = min(r, w * 0.499, h * 0.499)
    out = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                       (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90.0 * k / n)
            out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def circle(r, n=12):
    return [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)) for k in range(n)]


# ---------------------------------------------------------------------------
# Piece generators (return a bmesh in glTF vehicle coordinates)
# ---------------------------------------------------------------------------

def bevel_bm(bm, width, seg=1, angle=25.0):
    bm.normal_update()
    lim = math.radians(angle)
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim]
    if edges and width > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET', segments=seg,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def recalc(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def xf(bm, m: Matrix):
    bm.transform(m)
    if m.to_3x3().determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return bm


def deform(bm, fn):
    for v in bm.verts:
        v.co = Vector(fn(v.co))
    return bm


def box(sx, sy, sz, bevel=0.0, seg=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((sx, sy, sz, 1.0)))
    if bevel > 0:
        bevel_bm(bm, min(bevel, 0.45 * min(sx, sy, sz)), seg)
    return bm


def box_at(cx, cy, cz, sx, sy, sz, bevel=0.0, seg=1, rot: Matrix | None = None):
    bm = box(sx, sy, sz, bevel, seg)
    m = T(cx, cy, cz)
    if rot is not None:
        m = m @ rot
    return xf(bm, m)


_AXIS_FROM_Z = {
    'z': Matrix.Identity(4),
    'y': Matrix.Rotation(-math.pi / 2, 4, 'X'),   # +Z -> +Y
    'x': Matrix.Rotation(math.pi / 2, 4, 'Y'),    # +Z -> +X
}


def cyl(r, h, seg=20, r2=None, axis='y', bevel=0.0, bseg=1, caps=True):
    """Cylinder / cone centred on the origin along `axis` (r at the negative end, r2 at the positive end)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg,
                          radius1=r, radius2=(r if r2 is None else r2), depth=h)
    if bevel > 0:
        bevel_bm(bm, bevel, bseg, angle=50.0)
    bm.transform(_AXIS_FROM_Z[axis])
    return bm


def cyl_between(p0, p1, r, seg=12, r2=None, caps=True, bevel=0.0):
    a, b = Vector(p0), Vector(p1)
    d = b - a
    bm = cyl(r, d.length, seg=seg, r2=r2, axis='z', caps=caps, bevel=bevel)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bm.transform(Matrix.Translation((a + b) * 0.5) @ q.to_matrix().to_4x4())
    return bm


def lathe(profile, seg=32, axis='y', do_recalc=True, uv_reps=None, sweep_deg=360.0, start_deg=0.0):
    """
    Revolve profile [(radius, height), ...] around the axis.  Points with radius 0 collapse to one vertex.
    Open profiles: the surface normal is the profile direction rotated clockwise in the (r, h) plane
    (a profile running upwards produces an outward facing wall) unless `do_recalc` is set.
    uv_reps: if given, writes UVs (u = turn fraction * uv_reps, v = normalised profile length).
    """
    bm = bmesh.new()
    full = sweep_deg >= 359.999
    n_ang = seg if full else seg + 1
    lens = [0.0]
    for j in range(1, len(profile)):
        lens.append(lens[-1] + math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]))
    total = max(lens[-1], 1e-9)
    pole = {}
    rings = []
    for i in range(n_ang):
        a = math.radians(start_deg + sweep_deg * i / seg)
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for j, (r, h) in enumerate(profile):
            if abs(r) < 1e-7:
                if j not in pole:
                    pole[j] = bm.verts.new((0.0, h, 0.0))
                ring.append(pole[j])
            else:
                ring.append(bm.verts.new((r * ca, h, r * sa)))
        rings.append(ring)
    uv = bm.loops.layers.uv.verify() if uv_reps else None
    n_faces_ang = seg
    for i in range(n_faces_ang):
        i2 = (i + 1) % n_ang if full else i + 1
        for j in range(len(profile) - 1):
            quad = [rings[i][j], rings[i][j + 1], rings[i2][j + 1], rings[i2][j]]
            uvs = [(i / seg, lens[j] / total), (i / seg, lens[j + 1] / total),
                   ((i + 1) / seg, lens[j + 1] / total), ((i + 1) / seg, lens[j] / total)]
            vs, us = [], []
            for v, u in zip(quad, uvs):
                if v not in vs:
                    vs.append(v)
                    us.append(u)
            if len(vs) < 3:
                continue
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            if uv is not None:
                for lp, u in zip(f.loops, us):
                    lp[uv].uv = (u[0] * uv_reps, u[1])
    if do_recalc:
        recalc(bm)
    if axis == 'x':
        bm.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))   # +Y -> +X
    elif axis == 'z':
        bm.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))    # +Y -> +Z
    return bm


def _frames(path, up_hint=None, closed=False):
    pts = [Vector(p) for p in path]
    n = len(pts)
    tans = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[(i - 1) % n]
        elif i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        tans.append(t.normalized())
    up = Vector(up_hint) if up_hint is not None else Vector((0, 1, 0))
    nrm = up - tans[0] * up.dot(tans[0])
    if nrm.length < 1e-4:
        up = Vector((1, 0, 0))
        nrm = up - tans[0] * up.dot(tans[0])
    nrm.normalize()
    frames = []
    for i in range(n):
        if i > 0:
            q = tans[i - 1].rotation_difference(tans[i])
            nrm = (q @ nrm)
            nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
        frames.append((pts[i], nrm.copy(), tans[i].cross(nrm).normalized()))
    return frames


def sweep(path, profile, caps=True, up_hint=None, closed=False, scales=None):
    """Sweep a closed 2D profile [(a, b)] along a 3D polyline. a runs along the frame normal (up_hint)."""
    bm = bmesh.new()
    frames = _frames(path, up_hint, closed)
    rings = []
    for k, (p, nrm, bn) in enumerate(frames):
        s = scales[k] if scales else 1.0
        rings.append([bm.verts.new(p + nrm * (a * s) + bn * (b * s)) for a, b in profile])
    m = len(profile)
    n = len(rings)
    for i in range(n if closed else n - 1):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(m):
            j2 = (j + 1) % m
            bm.faces.new([r0[j], r0[j2], r1[j2], r1[j]])
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return recalc(bm)


def tube(path, r, seg=10, caps=True, fillet=0.0, fillet_n=4, closed=False, scales=None):
    pts = fillet_path(path, fillet, fillet_n) if fillet > 0 else path
    return sweep(pts, circle(r, seg), caps=caps, closed=closed, scales=scales)


def torus(R, r, seg_major=32, seg_minor=10, axis='y'):
    path = [(R * math.cos(2 * math.pi * i / seg_major), 0.0, R * math.sin(2 * math.pi * i / seg_major))
            for i in range(seg_major)]
    bm = sweep(path, circle(r, seg_minor), closed=True, up_hint=(0, 1, 0))
    if axis == 'x':
        bm.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    elif axis == 'z':
        bm.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    return bm


def loft(rings, closed=True, cap0=False, cap1=False, do_recalc=True):
    """Skin a list of rings (same vertex count). `closed` closes each ring."""
    bm = bmesh.new()
    vr = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    m = len(vr[0])
    for i in range(len(vr) - 1):
        for j in range(m if closed else m - 1):
            j2 = (j + 1) % m
            bm.faces.new([vr[i][j], vr[i][j2], vr[i + 1][j2], vr[i + 1][j]])
    if cap0:
        bm.faces.new(list(reversed(vr[0])))
    if cap1:
        bm.faces.new(vr[-1])
    if do_recalc:
        recalc(bm)
    return bm


def surf(fn, nu, nv, thickness=0.0, flip=False, uv_rect=None):
    """Parametric patch fn(u, v) -> point. Normal = d/du x d/dv (or flipped). Optional solidify + fitted UVs."""
    bm = bmesh.new()
    grid = [[bm.verts.new(Vector(fn(i / nu, j / nv))) for j in range(nv + 1)] for i in range(nu + 1)]
    uv = bm.loops.layers.uv.verify() if uv_rect else None
    for i in range(nu):
        for j in range(nv):
            idx = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if flip:
                idx.reverse()
            f = bm.faces.new([grid[a][b] for a, b in idx])
            if uv is not None:
                u0, v0, u1, v1 = uv_rect
                for lp, (a, b) in zip(f.loops, idx):
                    lp[uv].uv = (lerp(u0, u1, a / nu), lerp(v0, v1, b / nv))
    if thickness > 0:
        bm.normal_update()
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
        recalc(bm)
    return bm


def prism(poly, depth, bevel=0.0, seg=1, axis='z', bevel_angle=25.0):
    """
    Extrude a 2D polygon (p0, p1) by `depth`, centred on the extrusion axis.
      axis 'z': (p0, p1) -> (x, y);  axis 'x': (p0, p1) -> (z, y);  axis 'y': (p0, p1) -> (x, z)
    """
    bm = bmesh.new()
    vs = [bm.verts.new((p[0], p[1], -depth / 2)) for p in poly]
    f = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    new_verts = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=new_verts, vec=(0, 0, depth))
    recalc(bm)
    if bevel > 0:
        bevel_bm(bm, bevel, seg, angle=bevel_angle)
    if axis == 'x':
        bm.transform(Matrix.Rotation(-math.pi / 2, 4, 'Y'))
    elif axis == 'y':
        bm.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    return bm


def sphere(r, seg=16, rings=10, m: Matrix | None = None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r,
                              matrix=Matrix.Rotation(-math.pi / 2, 4, 'X'))
    if m is not None:
        bm.transform(m)
    return bm


def ico(r, sub=1, m: Matrix | None = None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    if m is not None:
        bm.transform(m)
    return bm


def capsule(p0, p1, r0, r1=None, seg=12, cap_rings=3):
    """Tapered limb / tank with hemispherical ends between two points."""
    a, b = Vector(p0), Vector(p1)
    r1 = r0 if r1 is None else r1
    d = (b - a)
    ln = d.length
    t = d / ln
    prof = []
    for k in range(cap_rings, 0, -1):
        ang = math.pi / 2 * k / cap_rings
        prof.append((r0 * math.cos(ang), -r0 * math.sin(ang)))
    prof.append((r0, 0.0))
    prof.append((r1, ln))
    for k in range(1, cap_rings + 1):
        ang = math.pi / 2 * k / cap_rings
        prof.append((r1 * math.cos(ang), ln + r1 * math.sin(ang)))
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    bm = lathe(prof, seg=seg, axis='y', do_recalc=True)
    q = Vector((0, 1, 0)).rotation_difference(t)
    bm.transform(Matrix.Translation(a) @ q.to_matrix().to_4x4())
    return bm


def helix(p0, p1, radius, turns, wire_r, seg=6, per_turn=12):
    """Coil spring between two points."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    q = Vector((0, 1, 0)).rotation_difference(d.normalized())
    pts = []
    n = int(turns * per_turn)
    for i in range(n + 1):
        ang = 2 * math.pi * i / per_turn
        pts.append(a + q @ Vector((radius * math.cos(ang), d.length * i / n, radius * math.sin(ang))))
    return sweep(pts, circle(wire_r, seg))


def quad_uv(p0, p1, p2, p3, rect=(0.0, 0.0, 1.0, 1.0)):
    """Single quad, CCW as seen from its front: p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left."""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(p)) for p in (p0, p1, p2, p3)]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.verify()
    u0, v0, u1, v1 = rect
    for lp, c in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        lp[uv].uv = c
    return bm


def ngon(points, flip=False):
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(p)) for p in points]
    if flip:
        vs.reverse()
    bm.faces.new(vs)
    return bm


def join(*pieces):
    """Merge several pieces into the first one (frees the others)."""
    base = pieces[0]
    for p in pieces[1:]:
        me = bpy.data.meshes.new("_tmp_join")
        p.to_mesh(me)
        p.free()
        base.from_mesh(me)
        bpy.data.meshes.remove(me)
    return base


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

_MATS: dict[str, bpy.types.Material] = {}
_MAT_UV_SCALE: dict[str, float] = {}


def _image(path: Path, colorspace: str, name: str | None = None):
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Texture missing: {path} (run generate_tractor_textures.py / check shared library)")
    key = name or path.stem
    img = bpy.data.images.get(key)
    if img is None:
        img = bpy.data.images.load(str(path), check_existing=False)
        img.name = key
    img.colorspace_settings.name = colorspace
    return img


def _gltf_output_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out='INPUT', socket_type='NodeSocketFloat')
    return ng


def make_mat(name, color=(0.5, 0.5, 0.5), rough=0.5, metal=0.0, alpha=1.0,
             albedo=None, albedo_alpha=False, normal=None, normal_strength=1.0, orm=None, use_ao=True,
             emission=None, emission_strength=0.0, emission_from_albedo=False,
             coat=0.0, coat_rough=0.05, double_sided=False, uv_scale=1.0, ior=None):
    """
    glTF-friendly Principled material. `albedo` / `normal` / `orm` are image paths (name = file stem).
    `color` multiplies the albedo texture (base colour factor), `rough` / `metal` are plain factors
    (ignored when an ORM map drives them).
    """
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name=name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (240, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if ior is not None:
        bsdf.inputs["IOR"].default_value = ior

    if albedo is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.location = (-520, 300)
        tex.image = _image(albedo, "sRGB")
        if tuple(color) != (1.0, 1.0, 1.0):
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.location = (-140, 300)
            mix.inputs[0].default_value = 1.0
            nt.links.new(tex.outputs["Color"], mix.inputs[6])
            mix.inputs[7].default_value = (*color, 1.0)
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if albedo_alpha:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        if emission_from_albedo:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])

    if orm is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.location = (-520, 0)
        tex.image = _image(orm, "Non-Color")
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-200, 0)
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        if use_ao:
            grp = nt.nodes.new("ShaderNodeGroup")
            grp.node_tree = _gltf_output_group()
            grp.location = (240, -420)
            nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])

    if normal is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.location = (-520, -300)
        tex.image = _image(normal, "Non-Color")
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.location = (-200, -300)
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    if coat > 0.0:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = coat_rough

    if emission_strength > 0.0:
        if emission is not None:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        elif not emission_from_albedo:
            bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    if alpha < 1.0 or albedo_alpha:
        if not albedo_alpha:
            bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = 'BLENDED'
        if hasattr(mat, "blend_method"):
            mat.blend_method = 'BLEND'

    mat.use_backface_culling = not double_sided
    _MATS[name] = mat
    _MAT_UV_SCALE[name] = uv_scale
    return mat


def shared_tex(mat_id: str, kind: str, size_k: int | None = 1) -> Path:
    """
    Path to a texture of the shared CC0 library (blender/shared_textures/<id>/<id>_<kind>[_1k].jpg).
    The library ships full-size (2K) and `_1k` files; the file stem is used as the Blender image name so
    the runtime de-duplication key (image name + pixel size) matches every other GLB embedding the same map.
    """
    suffix = "" if size_k is None else f"_{size_k}k"
    src = SHARED_TEX_DIR / mat_id / f"{mat_id}_{kind}{suffix}.jpg"
    if not src.exists():
        raise FileNotFoundError(f"Shared library texture missing: {src}")
    return src


def srgb(r, g, b):
    """8-bit sRGB -> linear base colour."""
    return tuple((c / 255.0) ** 2.2 for c in (r, g, b))


def load_atlas_layout() -> dict:
    p = TEX_DIR / "vehicle_atlas.json"
    if not p.exists():
        raise FileNotFoundError(f"{p} missing: run `python3 blender/tractor/generate_tractor_textures.py` first")
    return {k: tuple(v) for k, v in json.loads(p.read_text()).items()}


def swatch(atlas: dict, name: str):
    u0, v0, u1, v1 = atlas[f"pal_{name}"]
    return ('flat', ((u0 + u1) * 0.5, (v0 + v1) * 0.5))


PAINT_GREEN = srgb(20, 92, 46)


def vehicle_materials() -> dict:
    """All materials of the tractor + trailer (shared so both GLBs embed identical images)."""
    t = TEX_DIR
    m = {}
    # --- layered vehicle paint (clearcoat) ---
    m['paint'] = make_mat("Vehicle_Paint_Green", PAINT_GREEN, rough=0.42, metal=0.05, coat=1.0, coat_rough=0.06,
                          normal=t / "orange_peel_normal.webp", normal_strength=0.35, uv_scale=0.04)
    m['rim'] = make_mat("Vehicle_Paint_Rim_Grey", srgb(204, 205, 200), rough=0.40, metal=0.05, coat=0.5, coat_rough=0.12)
    m['roof'] = make_mat("Tractor_Roof_White", srgb(218, 219, 214), rough=0.46, coat=0.4, coat_rough=0.15)
    # --- painted castings / frames (shared library: scratches, chips) ---
    m['chassis'] = make_mat("Vehicle_Chassis_Paint", srgb(88, 90, 94), albedo=shared_tex("metal_painted", "albedo"),
                            normal=shared_tex("metal_painted", "normal"), orm=shared_tex("metal_painted", "orm"),
                            normal_strength=0.8, uv_scale=1.0)
    m['frame_green'] = make_mat("Trailer_Frame_Paint", srgb(34, 118, 62), albedo=shared_tex("metal_painted", "albedo"),
                                normal=shared_tex("metal_painted", "normal"), orm=shared_tex("metal_painted", "orm"),
                                normal_strength=0.8, uv_scale=1.0)
    # --- plastics / rubber ---
    m['plastic'] = make_mat("Vehicle_Plastic_Black", srgb(30, 31, 33), rough=0.62, normal=t / "grain_normal.webp",
                            normal_strength=0.7, uv_scale=0.25)
    m['trim'] = make_mat("Tractor_Interior_Trim", srgb(58, 60, 63), rough=0.72, normal=t / "grain_normal.webp",
                         normal_strength=0.9, uv_scale=0.25)
    m['rubber'] = make_mat("Vehicle_Rubber", srgb(24, 24, 25), rough=0.86)
    m['tyre'] = make_mat("Vehicle_Tyre_Rubber", srgb(27, 27, 28), rough=0.78, normal=t / "tyre_normal.webp",
                         normal_strength=1.6)
    m['mat'] = make_mat("Tractor_Floor_Mat", srgb(26, 26, 27), rough=0.9, normal=t / "floor_mat_normal.webp",
                        normal_strength=1.0, uv_scale=0.30)
    m['headliner'] = make_mat("Tractor_Headliner", srgb(176, 176, 168), rough=0.95, normal=t / "grain_normal.webp",
                              normal_strength=1.0, uv_scale=0.12)
    m['seat'] = make_mat("Tractor_Seat_Leather", srgb(34, 35, 37), rough=0.62, normal=shared_tex("leather_seat", "normal"),
                         normal_strength=1.0, uv_scale=0.30)
    m['seat_accent'] = make_mat("Tractor_Seat_Fabric", srgb(36, 78, 50), rough=0.92, normal=t / "grain_normal.webp",
                                normal_strength=1.2, uv_scale=0.10)
    # --- metals ---
    m['chrome'] = make_mat("Vehicle_Chrome", (0.82, 0.82, 0.84), rough=0.14, metal=1.0)
    m['mirror'] = make_mat("Vehicle_Mirror_Glass", (0.42, 0.44, 0.47), rough=0.03, metal=1.0)
    m['bolt'] = make_mat("Vehicle_Steel_Zinc", (0.46, 0.46, 0.48), rough=0.40, metal=1.0)
    m['steel'] = m['bolt']            # one bright-metal material for pins, shafts, fasteners (draw calls)
    m['exhaust'] = make_mat("Tractor_Exhaust_Steel", (1.0, 1.0, 1.0), albedo=t / "exhaust_albedo.webp", orm=t / "exhaust_orm.webp",
                            use_ao=False, normal=t / "grain_normal.webp", normal_strength=1.0, uv_scale=0.2)
    m['checker'] = make_mat("Vehicle_Checker_Plate", (0.50, 0.50, 0.52), rough=0.42, metal=1.0, normal=t / "checker_normal.webp",
                            normal_strength=1.0, uv_scale=0.07)
    m['alu'] = m['bolt']              # engine castings share the bright-metal material
    m['engine'] = m['chassis']        # painted block shares the chassis paint
    m['driver'] = make_mat("Driver_Figure", (1.0, 1.0, 1.0), rough=0.88, albedo=t / "vehicle_atlas.webp")
    m['mesh'] = make_mat("Vehicle_Perforated_Mesh", (1.0, 1.0, 1.0), rough=0.55, metal=0.6,
                         albedo=t / "mesh_albedo.webp", normal=t / "mesh_normal.webp", uv_scale=0.08)
    m['galv'] = make_mat("Trailer_Galvanized_Steel", (1.0, 1.0, 1.0), albedo=shared_tex("metal_galvanized", "albedo"),
                         normal=shared_tex("metal_galvanized", "normal"), orm=shared_tex("metal_galvanized", "orm"),
                         uv_scale=1.12)
    # --- glass / lenses (no transmission: dark alpha-blended, fresnel handled in src/tractor.ts) ---
    m['glass'] = make_mat("Tractor_Glass_Cab", (1.0, 1.0, 1.0), rough=0.05, albedo=t / "glass_dirt.webp", albedo_alpha=True,
                          double_sided=True)
    m['lens_clear'] = make_mat("Vehicle_Glass_Lens", (0.75, 0.80, 0.85), rough=0.06, alpha=0.28)
    m['headlight'] = make_mat("Tractor_Headlight_LED", (0.92, 0.92, 0.88), rough=0.25,
                              emission=(1.0, 0.94, 0.80), emission_strength=1.0)
    m['taillight'] = make_mat("Tractor_Taillight_Lens", srgb(150, 12, 10), rough=0.18, normal=t / "lens_normal.webp",
                              emission=(1.0, 0.07, 0.03), emission_strength=1.0, uv_scale=0.06)
    m['trailer_taillight'] = make_mat("Trailer_Taillight_Lens", srgb(150, 12, 10), rough=0.18, normal=t / "lens_normal.webp",
                                      emission=(1.0, 0.07, 0.03), emission_strength=1.0, uv_scale=0.06)
    m['indicator'] = make_mat("Vehicle_Indicator_Lens", srgb(214, 120, 10), rough=0.18, normal=t / "lens_normal.webp",
                              emission=(1.0, 0.45, 0.02), emission_strength=0.25, uv_scale=0.06)
    m['beacon'] = make_mat("Tractor_Beacon_Amber", srgb(236, 130, 8), rough=0.14, alpha=0.78, normal=t / "lens_normal.webp",
                           emission=(1.0, 0.42, 0.02), emission_strength=1.0, uv_scale=0.05)
    m['beacon_bulb'] = make_mat("Tractor_Beacon_Amber_Bulb", (1.0, 0.75, 0.3), rough=0.3,
                                emission=(1.0, 0.55, 0.08), emission_strength=1.0)
    # --- atlas (prints, decals, displays) ---
    atlas_png = t / "vehicle_atlas.webp"
    m['print'] = make_mat("Vehicle_Print", (1.0, 1.0, 1.0), rough=0.48, albedo=atlas_png)
    m['decal'] = make_mat("Vehicle_Decal", (1.0, 1.0, 1.0), rough=0.35, albedo=atlas_png, albedo_alpha=True)
    m['display'] = make_mat("Tractor_Display_Screen", (1.0, 1.0, 1.0), rough=0.16, albedo=atlas_png,
                            emission_from_albedo=True, emission_strength=1.0)
    # --- grape load ---
    m['grapes'] = make_mat("Trailer_Grapes", (1.0, 1.0, 1.0), albedo=t / "grapes_albedo.webp", normal=t / "grapes_normal.webp",
                           orm=t / "grapes_orm.webp", normal_strength=1.0, uv_scale=1.0)
    m['berry'] = make_mat("Trailer_Grape_Berries", srgb(44, 36, 72), rough=0.42)
    m['leaf'] = make_mat("Trailer_Vine_Leaf", (1.0, 1.0, 1.0), rough=0.6, albedo=atlas_png, albedo_alpha=True, double_sided=True)
    return m


def shared_lib() -> dict:
    p = SHARED_TEX_DIR / "library.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text())
    mats = data.get("materials", data)
    if isinstance(mats, list):
        return {m.get("id"): m for m in mats if isinstance(m, dict)}
    return {k: v for k, v in mats.items() if isinstance(v, dict)}


# ---------------------------------------------------------------------------
# Node builder
# ---------------------------------------------------------------------------

def _box_uv(bm, scale):
    uv = bm.loops.layers.uv.verify()
    bm.normal_update()
    inv = 1.0 / scale
    for f in bm.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for lp in f.loops:
            c = lp.vert.co
            if ay >= ax and ay >= az:
                lp[uv].uv = (c.x * inv, c.z * inv)
            elif ax >= az:
                lp[uv].uv = (c.z * inv, c.y * inv)
            else:
                lp[uv].uv = (c.x * inv, c.y * inv)


class Node:
    """Collects pieces per material and builds ONE named Blender object (= one glTF node)."""

    OVERLAY_WORDS = ("Glass", "Decal", "Leaf")

    def __init__(self, name: str, location=(0.0, 0.0, 0.0), local=False, dirt_fn=None):
        self.name = name
        self.overlay_obj = None     # child object "<name>_Overlay": alpha surfaces (glass, decals) kept out of the AO bake
        self.location = Vector(location)
        self.local = local          # True: pieces are authored relative to the node origin
        self.dirt_fn = dirt_fn      # fn(pos_local: Vector, normal: Vector, mat_name: str) -> 0..1
        self.buckets: dict[str, bmesh.types.BMesh] = {}
        self.mat_order: list = []

    def add(self, piece, mat, m: Matrix | None = None, uv=None, sharp=40.0, sym=False, free=True):
        """
        uv: None -> metric box projection with the material's default tile size; float -> tile size in m;
            'keep' -> the piece already carries UVs.
        sym: additionally add the X-mirrored copy.
        """
        if mat.name not in self.buckets:
            self.buckets[mat.name] = bmesh.new()
            self.buckets[mat.name].loops.layers.uv.verify()
            self.mat_order.append(mat)
        copies = [piece.copy()]
        if sym:
            mir = piece.copy()
            xf(mir, SC(-1, 1, 1))
            copies.append(mir)
        if free:
            piece.free()
        for bm in copies:
            if m is not None:
                xf(bm, m)
            if not self.local:
                bm.transform(Matrix.Translation(-self.location))
            bm.normal_update()
            lim = math.radians(sharp)
            sharp_edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim]
            if sharp_edges:
                bmesh.ops.split_edges(bm, edges=sharp_edges)
            if isinstance(uv, tuple) and uv[0] == 'flat':
                uvl = bm.loops.layers.uv.verify()
                for f in bm.faces:
                    for lp in f.loops:
                        lp[uvl].uv = uv[1]
            elif uv != 'keep':
                _box_uv(bm, float(uv) if uv is not None else _MAT_UV_SCALE.get(mat.name, 1.0))
            me = bpy.data.meshes.new("_tmp_piece")
            bm.to_mesh(me)
            bm.free()
            self.buckets[mat.name].from_mesh(me)
            bpy.data.meshes.remove(me)

    def add_sym(self, piece, mat, **kw):
        self.add(piece, mat, sym=True, **kw)

    def tri_count(self):
        return sum(sum(len(f.verts) - 2 for f in bm.faces) for bm in self.buckets.values())

    def build(self, collection, parent=None, rotation_bl=None):
        over = [m for m in self.mat_order if any(w in m.name for w in self.OVERLAY_WORDS)]
        if over and not self.name.endswith("_Overlay"):
            sub = Node(self.name + "_Overlay", local=True, dirt_fn=self.dirt_fn)
            for m in over:
                sub.buckets[m.name] = self.buckets.pop(m.name)
                sub.mat_order.append(m)
                self.mat_order.remove(m)
            main = self._build(collection, parent, rotation_bl)
            self.overlay_obj = sub._build(collection, main, None)
            return main
        return self._build(collection, parent, rotation_bl)

    def _build(self, collection, parent=None, rotation_bl=None):
        merged = bmesh.new()
        merged.loops.layers.uv.verify()
        face_mat_names = []
        for idx, mat in enumerate(self.mat_order):
            bm = self.buckets[mat.name]
            for f in bm.faces:
                f.material_index = idx
                f.smooth = True
            me = bpy.data.meshes.new("_tmp_bucket")
            bm.to_mesh(me)
            bm.free()
            merged.from_mesh(me)
            bpy.data.meshes.remove(me)
            face_mat_names.append(mat.name)

        merged.verts.ensure_lookup_table()
        merged.normal_update()
        # Face-area weighted vertex normals + dirt mask, still in glTF vehicle coordinates
        normals = []
        dirt = []
        for v in merged.verts:
            n = Vector((0.0, 0.0, 0.0))
            for f in v.link_faces:
                n += f.normal * f.calc_area()
            if n.length < 1e-12:
                n = v.normal.copy()
            n.normalize()
            normals.append(n)
            if self.dirt_fn is not None and v.link_faces:
                mat_name = face_mat_names[v.link_faces[0].material_index]
                dirt.append(clamp(self.dirt_fn(v.co, n, mat_name)))
            else:
                dirt.append(0.0)

        merged.transform(GL2BL)
        mesh = bpy.data.meshes.new(self.name)
        merged.to_mesh(mesh)
        merged.free()
        for mat in self.mat_order:
            mesh.materials.append(mat)
        rot = GL2BL.to_3x3()
        mesh.normals_split_custom_set_from_vertices([tuple(rot @ n) for n in normals])
        attr = mesh.attributes.new("_DIRT", 'FLOAT', 'POINT')
        attr.data.foreach_set("value", dirt)
        mesh.update()

        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = gl_to_bl(*self.location)
        if rotation_bl is not None:
            obj.rotation_euler = rotation_bl
        collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
        print(f"  node {self.name:<16} {tris:>7} tris  {len(mesh.vertices):>7} verts  {len(self.mat_order)} materials")
        return obj


# ---------------------------------------------------------------------------
# Wheels (origin at the hub centre, rolling around local X, bottom at Y = -radius)
# ---------------------------------------------------------------------------

def _wheel_pt(x, r, a):
    """a = 0 is the top of the wheel, positive a towards the front (+Z)."""
    return Vector((x, r * math.cos(a), r * math.sin(a)))


def wheel_dirt(radius, rim_r, lug_h):
    rc = radius - lug_h
    H = rc - rim_r

    def fn(p, n, mat_name):
        r = math.hypot(p.y, p.z)
        if 'Tyre' in mat_name:
            # dry dust film on the sidewalls (heavier towards the outer shoulder, where the lettering sits),
            # mud packed into the tread base between the lugs, lug faces rubbed clean by the road
            d = 0.34 + 0.12 * smoothstep(rim_r + 0.25 * H, rim_r + 0.70 * H, r) + 0.30 * smoothstep(rim_r + 0.74 * H, rc - 0.015, r)
            if lug_h > 0:
                d -= 0.42 * smoothstep(rc + 0.010, radius - 0.006, r)
            else:
                d -= 0.22 * smoothstep(rc - 0.012, rc - 0.002, r)
            return d
        return 0.14 + 0.22 * smoothstep(rim_r * 0.35, rim_r, r)
    return fn


def build_wheel(name, collection, pos_gl, radius, width, is_left, mats, style='rear'):
    """
    style: 'rear' / 'front' (deep chevron lug field tyre) or 'trailer' (ribbed implement tyre).
    mats: dict with tyre, rim, hub, bolt (materials).
    """
    cfg = {
        'rear':    dict(lug_h=0.056, rim_ratio=0.555, pairs=21, sweep=0.36, lug_w=(0.100, 0.050), studs=8,
                        stud_r=0.215, hub_r=0.150, hub_out=0.11, dish=0.085, seg=96, band=0),
        'front':   dict(lug_h=0.043, rim_ratio=0.580, pairs=18, sweep=0.42, lug_w=(0.080, 0.040), studs=8,
                        stud_r=0.150, hub_r=0.105, hub_out=0.085, dish=0.055, seg=84, band=1),
        'trailer': dict(lug_h=0.0,   rim_ratio=0.560, pairs=0,  sweep=0.0,  lug_w=(0.0, 0.0),     studs=6,
                        stud_r=0.085, hub_r=0.060, hub_out=0.055, dish=0.03, seg=64, band=2),
    }[style]
    o = 1.0 if is_left else -1.0
    hw = width * 0.5
    r_rim = radius * cfg['rim_ratio']
    rc = radius - cfg['lug_h']
    H = rc - r_rim
    seg = cfg['seg']
    nd = Node(name, location=pos_gl, local=True, dirt_fn=wheel_dirt(radius, r_rim, cfg['lug_h']))

    # --- carcass (profile across the width, from the inner bead over the tread to the outer bead) ---
    half = [
        (hw * 0.60, r_rim - 0.012), (hw * 0.665, r_rim + 0.012), (hw * 0.80, r_rim + 0.12 * H),
        (hw * 0.95, r_rim + 0.33 * H), (hw * 1.00, r_rim + 0.55 * H), (hw * 0.985, r_rim + 0.76 * H),
        (hw * 0.93, r_rim + 0.90 * H), (hw * 0.82, rc - 0.016), (hw * 0.55, rc - 0.004), (hw * 0.25, rc),
    ]
    if style == 'trailer':
        # ribbed implement tread: three circumferential grooves cut into the crown
        half = half[:7] + [(hw * 0.84, rc - 0.014), (hw * 0.60, rc - 0.003), (hw * 0.50, rc - 0.002),
                           (hw * 0.47, rc - 0.016), (hw * 0.40, rc - 0.016), (hw * 0.37, rc),
                           (hw * 0.07, rc), (hw * 0.04, rc - 0.016)]
        prof_half = [Vector(p) for p in half]
    else:
        prof_half = catmull(half, sub=3)
    left = [(-p[0], p[1]) for p in prof_half]                    # inner side (-x) bead -> crown
    right = [(p[0], p[1]) for p in reversed(prof_half)]          # crown -> outer bead
    prof = left + right
    # lathe profile is (radius, height=x); running from -x to +x over the top gives outward normals
    carcass = lathe([(p[1], p[0]) for p in prof], seg=seg, axis='x', do_recalc=False,
                    uv_reps=(3 if style != 'trailer' else 2))
    # tyre_normal.png stacks three size letterings: V is squeezed into the band of this wheel type.
    # Right wheels turn the map by 180 degrees so the lettering reads correctly on their outer sidewall.
    uvl = carcass.loops.layers.uv.verify()
    for f in carcass.faces:
        for lp in f.loops:
            u_, v_ = lp[uvl].uv
            if o < 0:
                u_, v_ = -u_, 1.0 - v_
            lp[uvl].uv = (u_, (cfg['band'] + min(max(v_, 0.002), 0.998)) / 3.0)
    nd.add(carcass, mats['tyre'], uv='keep', sharp=50)

    # --- chevron lugs: curved bars with flared flanks, a rounded nose at the centre line and a shoulder ear ---
    if cfg['pairs']:
        lugs = bmesh.new()
        wb, wt = cfg['lug_w']
        n_st = 10
        for i in range(cfg['pairs']):
            for side in (-1.0, 1.0):
                a0 = 2.0 * math.pi * (i + (0.5 if side > 0 else 0.0)) / cfg['pairs']
                rows = []
                for k in range(n_st):
                    t = k / (n_st - 1)
                    x = side * lerp(0.02 * width, hw * 0.995, t ** 0.92)
                    a = a0 + cfg['sweep'] * (0.5 - t ** 0.80)
                    xr = abs(x) / hw
                    r_top = radius - 0.032 * xr ** 3
                    r_base = rc - 0.014 - 0.03 * xr ** 4
                    grow = (0.55 + 0.45 * smoothstep(0.0, 0.14, t)) * (1.0 + 0.40 * t)      # rounded nose, wider shoulder
                    if k == n_st - 1:
                        r_top = radius - 0.085
                        r_base = r_rim + 0.78 * H
                    elif k == n_st - 2:
                        r_top = radius - 0.040
                    da_b = (wb * grow * 0.5) / rc
                    da_t = (wt * grow * 0.5) / rc
                    da_m = lerp(da_b, da_t, 0.62)
                    r_mid = lerp(r_base, r_top, 0.60)
                    r_sh = r_top - 0.006                      # small chamfer on the lug face
                    rows.append([
                        lugs.verts.new(_wheel_pt(x, r_base, a - da_b)),
                        lugs.verts.new(_wheel_pt(x, r_mid, a - da_m)),
                        lugs.verts.new(_wheel_pt(x, r_sh, a - da_t * 1.12)),
                        lugs.verts.new(_wheel_pt(x, r_top, a - da_t * 0.80)),
                        lugs.verts.new(_wheel_pt(x, r_top, a + da_t * 0.80)),
                        lugs.verts.new(_wheel_pt(x, r_sh, a + da_t * 1.12)),
                        lugs.verts.new(_wheel_pt(x, r_mid, a + da_m)),
                        lugs.verts.new(_wheel_pt(x, r_base, a + da_b)),
                    ])
                for k in range(n_st - 1):
                    r0, r1 = rows[k], rows[k + 1]
                    for j in range(7):
                        lugs.faces.new([r0[j], r0[j + 1], r1[j + 1], r1[j]])
                lugs.faces.new(list(reversed(rows[0])))
                lugs.faces.new(rows[-1])
        recalc(lugs)
        nd.add(lugs, mats['tyre'], uv=('flat', (0.5, (cfg['band'] + 0.5) / 3.0)), sharp=34)

    # --- rim: barrel with flanges (s = outward coordinate, x = o * s) ---
    fl = hw * 0.63
    rim_prof = [
        (r_rim + 0.030, -fl - 0.012), (r_rim + 0.034, -fl + 0.004), (r_rim + 0.004, -fl + 0.022),
        (r_rim - 0.012, -fl * 0.72), (r_rim - 0.050, -fl * 0.38), (r_rim - 0.050, fl * 0.30),
        (r_rim - 0.012, fl * 0.72), (r_rim + 0.004, fl - 0.022), (r_rim + 0.034, fl - 0.004),
        (r_rim + 0.030, fl + 0.012), (r_rim - 0.004, fl + 0.006), (r_rim - 0.028, fl * 0.72),
        (r_rim - 0.066, fl * 0.30), (r_rim - 0.066, -fl * 0.38), (r_rim - 0.028, -fl * 0.72),
        (r_rim - 0.004, -fl - 0.006), (r_rim + 0.030, -fl - 0.012),
    ]
    barrel = lathe(rim_prof, seg=seg, axis='x', do_recalc=True)
    nd.add(barrel, mats['rim'], m=SC(o, 1, 1), sharp=42)

    # --- dished wheel disc ---
    d = cfg['dish']
    hub_r = cfg['hub_r']
    stud_r = cfg['stud_r']
    s_disc = fl * 0.30                      # where the disc meets the barrel
    disc_prof = [
        (r_rim - 0.058, s_disc - 0.010), (r_rim - 0.075, s_disc + 0.004), (r_rim * 0.80, s_disc + d * 0.42),
        (r_rim * 0.62, s_disc + d * 0.86), (stud_r + 0.045, s_disc + d), (hub_r * 0.86, s_disc + d),
        (hub_r * 0.86, s_disc + d - 0.014), (stud_r + 0.045, s_disc + d - 0.014),
        (r_rim * 0.62, s_disc + d * 0.86 - 0.014), (r_rim * 0.80, s_disc + d * 0.42 - 0.014),
        (r_rim - 0.075, s_disc - 0.012), (r_rim - 0.058, s_disc - 0.026), (r_rim - 0.058, s_disc - 0.010),
    ]
    disc = lathe(disc_prof, seg=seg, axis='x', do_recalc=True)
    nd.add(disc, mats['rim'], m=SC(o, 1, 1), sharp=42)
    s_face = s_disc + d

    # --- hub: axle flange, planetary / bearing cap, studs + nuts ---
    hub_out = cfg['hub_out']
    hub_prof = [
        (0.0, s_face + hub_out), (hub_r * 0.42, s_face + hub_out), (hub_r * 0.50, s_face + hub_out - 0.008),
        (hub_r * 0.74, s_face + hub_out * 0.72), (hub_r * 0.80, s_face + hub_out * 0.30),
        (hub_r * 0.80, s_face + 0.004), (hub_r * 0.96, s_face + 0.004), (hub_r * 0.96, s_face - 0.030),
        (hub_r * 0.70, s_face - 0.030), (hub_r * 0.70, -fl * 0.95), (0.0, -fl * 0.95),
    ]
    nd.add(lathe(hub_prof, seg=28, axis='x', do_recalc=True), mats['hub'], m=SC(o, 1, 1), sharp=40)
    for k in range(6):
        a = 2 * math.pi * (k + 0.5) / 6
        rr = hub_r * 0.62
        nd.add(cyl(hub_r * 0.07, 0.018, seg=6, axis='x'), mats['bolt'],
               m=T(o * (s_face + hub_out * 0.74), rr * math.cos(a), rr * math.sin(a)), sharp=30)
    nd.add(cyl(hub_r * 0.16, 0.014, seg=6, axis='x'), mats['bolt'], m=T(o * (s_face + hub_out + 0.004), 0, 0), sharp=30)
    # inner brake drum / hub carrier towards the axle
    nd.add(cyl(hub_r * 1.15, fl * 0.5, seg=24, axis='x', bevel=0.01), mats['hub'], m=T(-o * fl * 0.60, 0, 0), sharp=40)
    for k in range(cfg['studs']):
        a = 2 * math.pi * k / cfg['studs']
        y, z = stud_r * math.cos(a), stud_r * math.sin(a)
        nut_r = 0.021 if style != 'trailer' else 0.015
        nd.add(cyl(nut_r, 0.024, seg=6, axis='x', bevel=0.003), mats['bolt'], m=T(o * (s_face + 0.012), y, z) @ RX(math.degrees(a)), sharp=30)
        nd.add(cyl(nut_r * 0.48, 0.022, seg=8, axis='x'), mats['bolt'], m=T(o * (s_face + 0.032), y, z), sharp=60)
    # valve stem
    nd.add(cyl_between((o * (fl * 0.52), r_rim - 0.058, 0.0), (o * (fl * 0.80), r_rim - 0.10, 0.0), 0.006, seg=6),
           mats['bolt'], sharp=60)
    # adjustable-track rim: welded lugs on the barrel bolted to the disc (tractor wheels only)
    if style != 'trailer':
        n_lug = 8
        for k in range(n_lug):
            a = 2 * math.pi * (k + 0.5) / n_lug
            rr = r_rim - 0.074
            m_l = RX(math.degrees(a)) @ T(o * (s_disc + 0.022), rr, 0.0)
            nd.add(box(0.062, 0.058, 0.105, bevel=0.01), mats['rim'], m=m_l)
            nd.add(cyl(0.016, 0.03, seg=6, axis='x', bevel=0.003), mats['bolt'], m=m_l @ T(o * 0.036, -0.004, 0.0), sharp=30)
        # raised centre ring + stiffening ribs on the dish
        for k in range(n_lug):
            a = 2 * math.pi * k / n_lug
            m_r = RX(math.degrees(a))
            p0 = (o * (s_disc + d * 0.45), r_rim * 0.80, 0.0)
            p1 = (o * (s_disc + d + 0.002), stud_r + 0.06, 0.0)
            nd.add(sweep([p0, p1], rrect(0.03, 0.02, 0.006, 1), up_hint=(o, 0, 0)), mats['rim'], m=m_r, sharp=50)

    # cast wheel weight bolted inside the dish of the rear wheels
    if style == 'rear':
        wr0, wr1 = stud_r + 0.075, r_rim * 0.70
        nd.add(lathe([(wr0, s_face + 0.002), (wr0 + 0.012, s_face + 0.046), (wr1 - 0.012, s_face + 0.046), (wr1, s_face + 0.002),
                      (wr0, s_face + 0.002)], seg=48, axis='x', do_recalc=True), mats['hub'], m=SC(o, 1, 1), sharp=40)
        for k in range(4):
            a = 2 * math.pi * (k + 0.25) / 4
            rr = (wr0 + wr1) * 0.5
            nd.add(cyl(0.017, 0.02, seg=6, axis='x', bevel=0.003), mats['bolt'],
                   m=T(o * (s_face + 0.052), rr * math.cos(a), rr * math.sin(a)), sharp=30)

    return nd.build(collection)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def save_blend_and_export_glb(blend_path: Path, glb_path: Path, objects: list):
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
        for child in obj.children_recursive:      # "<name>_Overlay" glass / decal children
            child.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format='GLB',
        export_yup=True,
        use_selection=True,
        export_apply=False,          # keep node hierarchy & hub origins
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_attributes=True,      # custom `_DIRT` vertex attribute
        export_vertex_color='NONE',
        export_materials='EXPORT',
        export_image_format='AUTO',      # embed every source file unchanged (library JPEGs, own WebPs)
        export_meshopt_compression_enable=True,   # EXT_meshopt_compression (decoder is set in src/tractor.ts)
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    tris = 0
    for obj in objects:
        if obj.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"Exported {glb_path.name}: {glb_path.stat().st_size / 1e6:.2f} MB, {tris} triangles, {len(objects)} nodes")
    return tris
