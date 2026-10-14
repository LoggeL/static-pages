# Geometrie-Helfer für weapon.py (Blender 5.2, headless). Alle Eingaben in Millimetern.
import bpy, bmesh, math
from mathutils import Vector, Matrix

MM = 0.001
COLL = None


def set_collection(c):
    global COLL
    COLL = c


def _link(ob):
    (COLL or bpy.context.scene.collection).objects.link(ob)
    return ob


def obj_from_bm(name, bm, mat=None):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    _link(ob)
    if mat:
        ob["wmat"] = mat
    return ob


def _v(p):
    return Vector((p[0] * MM, p[1] * MM, p[2] * MM))


# ---------------------------------------------------------------- Prismen
def prism(name, prof, axis, a0, a1, mat=None, xform=None):
    """2D-Profil extrudiert entlang Achse. axis='X': prof=(y,z); 'Y': prof=(x,z); 'Z': prof=(x,y)."""
    bm = bmesh.new()

    def P(u, v, a):
        if axis == 'X':
            p = (a, u, v)
        elif axis == 'Y':
            p = (u, a, v)
        else:
            p = (u, v, a)
        return p

    v0 = [bm.verts.new(_v(P(u, v, a0))) for u, v in prof]
    v1 = [bm.verts.new(_v(P(u, v, a1))) for u, v in prof]
    n = len(prof)
    bm.faces.new(v0)
    bm.faces.new(list(reversed(v1)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((v0[i], v0[j], v1[j], v1[i]))
    if xform is not None:
        bmesh.ops.transform(bm, matrix=xform, verts=bm.verts)
    return obj_from_bm(name, bm, mat)


def box(name, c, s, mat=None, xform=None):
    """Quader: Mittelpunkt c, Größe s (mm)."""
    x0, x1 = c[0] - s[0] / 2, c[0] + s[0] / 2
    y0, y1 = c[1] - s[1] / 2, c[1] + s[1] / 2
    z0, z1 = c[2] - s[2] / 2, c[2] + s[2] / 2
    return prism(name, [(y0, z0), (y1, z0), (y1, z1), (y0, z1)], 'X', x0, x1, mat, xform)


def box2(name, lo, hi, mat=None, xform=None):
    c = [(lo[i] + hi[i]) / 2 for i in range(3)]
    s = [hi[i] - lo[i] for i in range(3)]
    return box(name, c, s, mat, xform)


def rrect(cx, cy, w, h, r, seg=4):
    """Abgerundetes Rechteck als Polygon (CCW)."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    pts = []
    corners = [(cx + w / 2 - r, cy - h / 2 + r, -90), (cx + w / 2 - r, cy + h / 2 - r, 0),
               (cx - w / 2 + r, cy + h / 2 - r, 90), (cx - w / 2 + r, cy - h / 2 + r, 180)]
    for (ox, oy, a0) in corners:
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def stadium(cx, cy, length, width, seg=6, along='u'):
    """Langloch (M-LOK). along='u': Länge entlang der ersten Koordinate."""
    r = width / 2
    L = length / 2 - r
    pts = []
    for k in range(seg + 1):
        a = -math.pi / 2 + math.pi * k / seg
        pts.append((L + r * math.cos(a), r * math.sin(a)))
    for k in range(seg + 1):
        a = math.pi / 2 + math.pi * k / seg
        pts.append((-L + r * math.cos(a), r * math.sin(a)))
    if along == 'u':
        return [(cx + u, cy + v) for u, v in pts]
    return [(cx + v, cy + u) for u, v in pts]


def circle_pts(cx, cy, r, n=24, a0=0.0):
    return [(cx + r * math.cos(a0 + 2 * math.pi * i / n), cy + r * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


# ---------------------------------------------------------------- Drehkörper
def lathe(name, prof, seg=48, axis='Y', center=(0, 0), closed=False, mat=None, xform=None, a0=0.0):
    """prof: Liste (r, t) entlang der Achse. center: Lage der Achse in den anderen beiden Koordinaten.
    axis 'Y': center=(x,z); 'X': center=(y,z); 'Z': center=(x,y)."""
    bm = bmesh.new()
    rings = []
    for (r, t) in prof:
        ring = []
        if r <= 1e-6:
            ring = [bm.verts.new(_v(_lp(axis, center, 0, 0, t)))]
        else:
            for i in range(seg):
                a = a0 + 2 * math.pi * i / seg
                ring.append(bm.verts.new(_v(_lp(axis, center, r * math.cos(a), r * math.sin(a), t))))
        rings.append(ring)
    n = len(rings)
    pairs = [(i, i + 1) for i in range(n - 1)]
    if closed:
        pairs.append((n - 1, 0))
    for i, j in pairs:
        A, B = rings[i], rings[j]
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1:
            for k in range(seg):
                bm.faces.new((A[0], B[k], B[(k + 1) % seg]))
        elif len(B) == 1:
            for k in range(seg):
                bm.faces.new((A[k], A[(k + 1) % seg], B[0]))
        else:
            for k in range(seg):
                bm.faces.new((A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]))
    if not closed:
        if len(rings[0]) > 1:
            bm.faces.new(rings[0])
        if len(rings[-1]) > 1:
            bm.faces.new(list(reversed(rings[-1])))
    if xform is not None:
        bmesh.ops.transform(bm, matrix=xform, verts=bm.verts)
    return obj_from_bm(name, bm, mat)


def _lp(axis, c, u, v, t):
    if axis == 'Y':
        return (c[0] + u, t, c[1] + v)
    if axis == 'X':
        return (t, c[0] + u, c[1] + v)
    return (c[0] + u, c[1] + v, t)


def cyl(name, r, a0, a1, axis='Y', center=(0, 0), seg=32, mat=None, xform=None):
    return lathe(name, [(r, a0), (r, a1)], seg=seg, axis=axis, center=center, mat=mat, xform=xform)


def tube(name, ri, ro, a0, a1, axis='Y', center=(0, 0), seg=48, mat=None):
    return lathe(name, [(ri, a0), (ro, a0), (ro, a1), (ri, a1)], seg=seg, axis=axis, center=center, closed=True, mat=mat)


# ---------------------------------------------------------------- Loft
def loft(name, sections, cap0=True, cap1=True, mat=None, xform=None):
    """sections: Liste von Ringen (gleiche Punktzahl) aus 3D-Punkten in mm."""
    bm = bmesh.new()
    rings = [[bm.verts.new(_v(p)) for p in sec] for sec in sections]
    m = len(rings[0])
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(m):
            bm.faces.new((A[k], A[(k + 1) % m], B[(k + 1) % m], B[k]))
    if cap0:
        bm.faces.new(list(reversed(rings[0])))
    if cap1:
        bm.faces.new(rings[-1])
    if xform is not None:
        bmesh.ops.transform(bm, matrix=xform, verts=bm.verts)
    return obj_from_bm(name, bm, mat)


def superellipse(n_pts, a, b, e=2.5, a_front=None, w_mod=None):
    """Punkte (u,v) einer Superellipse; u in [-a,a] (bzw. a_front vorne), v in [-b,b]."""
    pts = []
    for i in range(n_pts):
        t = 2 * math.pi * i / n_pts
        c, s = math.cos(t), math.sin(t)
        u = math.copysign(abs(c) ** (2 / e), c)
        v = math.copysign(abs(s) ** (2 / e), s)
        au = (a_front if (a_front is not None and u > 0) else a)
        bb = b * (w_mod(u) if w_mod else 1.0)
        pts.append((au * u, bb * v))
    return pts


def sweep(name, path, prof, up=(1, 0, 0), mat=None, cap=True):
    """Profil (u,v) entlang Pfad (3D mm). u entlang 'up'-Vektor (projiziert), v senkrecht dazu."""
    P = [Vector(p) for p in path]
    secs = []
    upv = Vector(up)
    for i, p in enumerate(P):
        if i == 0:
            t = (P[1] - P[0])
        elif i == len(P) - 1:
            t = (P[-1] - P[-2])
        else:
            t = (P[i + 1] - P[i - 1])
        t.normalize()
        u = (upv - t * upv.dot(t))
        if u.length < 1e-6:
            u = Vector((0, 0, 1)) - t * t.z
        u.normalize()
        v = t.cross(u)
        secs.append([tuple(p + u * a + v * b) for a, b in prof])
    return loft(name, secs, cap, cap, mat)


def helix(name, r_coil, r_wire, y0, y1, turns, center=(0, 0), seg_per_turn=16, wire_seg=6, mat=None):
    path = []
    n = int(turns * seg_per_turn)
    for i in range(n + 1):
        a = 2 * math.pi * turns * i / n
        path.append((center[0] + r_coil * math.cos(a), y0 + (y1 - y0) * i / n, center[1] + r_coil * math.sin(a)))
    prof = circle_pts(0, 0, r_wire, wire_seg)
    return sweep(name, path, prof, up=(0, 1, 0), mat=mat)


# ---------------------------------------------------------------- Modifikatoren
def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = ob.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def delete(ob):
    me = ob.data if ob.type == 'MESH' else None
    bpy.data.objects.remove(ob, do_unlink=True)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


def join(objs, name=None):
    """Objekte zu einem Mesh zusammenführen (ohne Operatoren)."""
    objs = [o for o in objs if o is not None]
    base = objs[0]
    final_name = name or base.name
    bm = bmesh.new()
    mats = []
    for o in objs:
        me = o.data
        tmp = bmesh.new()
        tmp.from_mesh(me)
        tmp.transform(o.matrix_world)
        # Material-Index umsetzen
        local = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            local.append(mats.index(m))
        for f in tmp.faces:
            if local:
                f.material_index = local[f.material_index] if f.material_index < len(local) else 0
        tmpme = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(tmpme)
        tmp.free()
        bm.from_mesh(tmpme)
        bpy.data.meshes.remove(tmpme)
    me = bpy.data.meshes.new(name or base.name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name or base.name, me)
    _link(ob)
    for o in objs:
        delete(o)
    # Claim the contract name after deleting its former owner, avoiding .001.
    ob.name = final_name
    ob.data.name = final_name
    return ob


def boolean(target, cutters, op='DIFFERENCE', solver='EXACT', keep=False):
    """Boolean mit mehreren Operanden über eine Collection (robust bei überlappenden Cuttern)."""
    if not isinstance(cutters, (list, tuple)):
        cutters = [cutters]
    cutters = [c for c in cutters if c is not None]
    if not cutters:
        return target
    for c in cutters:
        _fix_normals(c)
    n0 = len(target.data.polygons)
    before = target.data.copy()
    tc = bpy.data.collections.new("_bool_tmp")
    bpy.context.scene.collection.children.link(tc)
    for c in cutters:
        for uc in list(c.users_collection):
            uc.objects.unlink(c)
        tc.objects.link(c)
    m = target.modifiers.new('B', 'BOOLEAN')
    m.operation = op
    m.operand_type = 'COLLECTION'
    m.collection = tc
    m.solver = solver
    if solver == 'EXACT':
        m.use_self = False
        m.use_hole_tolerant = False
    apply_mods(target)
    n1 = len(target.data.polygons)
    if n1 == 0 or (op == 'DIFFERENCE' and n1 < 0.3 * n0):
        print("BOOLWARN", target.name, n0, "->", n1, "(sequentiell wiederholt)")
        old = target.data
        target.data = before
        if old.users == 0:
            bpy.data.meshes.remove(old)
        before = None
        for c in cutters:
            m = target.modifiers.new('B', 'BOOLEAN')
            m.operation = op
            m.object = c
            m.solver = solver
            back = target.data.copy()
            apply_mods(target)
            if len(target.data.polygons) == 0:
                print("BOOLWARN  cutter", c.name, "übersprungen")
                o2 = target.data
                target.data = back
                bpy.data.meshes.remove(o2)
            else:
                bpy.data.meshes.remove(back)
    if before is not None and before.users == 0:
        bpy.data.meshes.remove(before)
    for c in cutters:
        if keep:
            tc.objects.unlink(c)
            (COLL or bpy.context.scene.collection).objects.link(c)
        else:
            delete(c)
    bpy.data.collections.remove(tc)
    return target


def _fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def union(target, others, solver='EXACT'):
    return boolean(target, others, 'UNION', solver)


def finish(ob, bevel=0.4, seg=2, angle=30, wn=True, harden=True, clamp=True, profile=0.5):
    for p in ob.data.polygons:
        p.use_smooth = True
    if bevel and bevel > 0:
        m = ob.modifiers.new('Bevel', 'BEVEL')
        m.width = bevel * MM
        m.segments = seg
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(angle)
        m.harden_normals = harden
        m.use_clamp_overlap = clamp
        m.miter_outer = 'MITER_ARC'
        m.profile = profile
    if wn:
        w = ob.modifiers.new('WN', 'WEIGHTED_NORMAL')
        w.keep_sharp = True
        w.weight = 50
        w.mode = 'FACE_AREA'
    return ob


def smooth_only(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def rot(axis, deg, pivot=(0, 0, 0)):
    """Rotationsmatrix um pivot (mm) für bmesh-Transformation (in Metern)."""
    pv = Vector(pivot) * MM
    return Matrix.Translation(pv) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-pv)


def move(dx, dy, dz):
    return Matrix.Translation(Vector((dx, dy, dz)) * MM)


def xf_obj(ob, M):
    ob.data.transform(M)
    if M.to_3x3().determinant() < 0:
        ob.data.flip_normals()
    ob.data.update()
    return ob


def tri_count(objs):
    n = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        n += sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
    return n
