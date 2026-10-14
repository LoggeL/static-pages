# Geometrie-Bausteine für Ausrüstung: abgerundete Boxen, Röhren entlang Pfaden, Kissen-Paneele (Cordura-Optik).
# Alles numpy/bmesh, ohne bpy.ops (headless-fest).
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix
from .common import *


def mesh_from(name, verts, faces, smooth=True, coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def bm_obj(name, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def transform(o, M):
    """M: mathutils.Matrix 4x4 auf Mesh-Daten anwenden."""
    o.data.transform(M)
    o.data.update()


def mat_frame(origin, xaxis, zaxis):
    """Lokaler Rahmen: X = xaxis, Z ~ zaxis (orthogonalisiert), Y = Z x X."""
    x = Vector(xaxis).normalized()
    z = Vector(zaxis); z = (z - x * z.dot(x)).normalized()
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = Vector(origin)
    return M


def grid_faces(nu, nv, closed_u=False, off=0, flip=False):
    F = []
    for j in range(nv - 1):
        for i in range(nu - (0 if closed_u else 1)):
            a = off + j * nu + i
            b = off + j * nu + (i + 1) % nu
            c, d = b + nu, a + nu
            F.append((a, d, c, b) if flip else (a, b, c, d))
    return F


def rbox(name, sx, sy, sz, bevel=0.004, segs=3, open_top=False, wall=0.0025, subdiv=0, center=(0, 0, 0)):
    """Abgerundete Box (Maße = Gesamtgröße). open_top: Deckel entfernt und Wandstärke."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz)) + Vector(center)
    if subdiv:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=subdiv, use_grid_fill=True)
    if open_top:
        top = [f for f in bm.faces if f.normal.z > 0.9 and min(v.co.z for v in f.verts) > center[2] + sz * 0.49]
        bmesh.ops.delete(bm, geom=top, context='FACES')
        # Wandstärke nach innen
        ret = bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=wall)
    if bevel > 0:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm_obj(name, bm)


def cyl(name, r1, r2, depth, segs=24, center=(0, 0, 0), axis='Z', bevel=0.0, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    if bevel > 0:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    R = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(-math.pi / 2, 4, 'X')}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ R, verts=bm.verts[:])
    return bm_obj(name, bm)


def frames_along(P):
    """Paralleltransport-Rahmen entlang Polyline P (N,3) -> T, N, B."""
    P = np.asarray(P, float)
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1)[:, None]
    ref = np.array([0, 0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0, 0])
    N = np.zeros_like(P); B = np.zeros_like(P)
    n = np.cross(T[0], ref); n /= np.linalg.norm(n)
    for i in range(len(P)):
        if i > 0:
            n = n - T[i] * (n @ T[i]); n /= np.linalg.norm(n)
        N[i] = n
        B[i] = np.cross(T[i], n)
    return T, N, B


def tube(name, P, radius, segs=10, caps=True):
    """Röhre entlang Polyline. radius: Skalar oder Array (N,)."""
    P = np.asarray(P, float)
    r = np.broadcast_to(np.asarray(radius, float), (len(P),))
    T, N, B = frames_along(P)
    a = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    V = []
    for i in range(len(P)):
        for t in a:
            V.append(P[i] + r[i] * (np.cos(t) * N[i] + np.sin(t) * B[i]))
    F = grid_faces(segs, len(P), closed_u=True)
    V = list(V)
    if caps:
        c0 = len(V); V.append(P[0])
        c1 = len(V); V.append(P[-1])
        for i in range(segs):
            F.append((c0, (i + 1) % segs, i))
            base = (len(P) - 1) * segs
            F.append((c1, base + i, base + (i + 1) % segs))
    return mesh_from(name, V, F)


def coil_path(P, coil_r, pitch, samples_per_turn=14):
    """Spiralkabel um Mittellinie P (N,3)."""
    P = np.asarray(P, float)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    L = seg.sum()
    acc = np.concatenate([[0], np.cumsum(seg)])
    turns = L / pitch
    n = int(turns * samples_per_turn) + 2
    s = np.linspace(0, L, n)
    C = np.column_stack([np.interp(s, acc, P[:, k]) for k in range(3)])
    T, N, B = frames_along(C)
    ang = 2 * np.pi * s / pitch
    return C + coil_r * (np.cos(ang)[:, None] * N + np.sin(ang)[:, None] * B)


def bezier(pts, n=40):
    """kubische Catmull-Rom-ähnliche Glättung durch Kontrollpunkte."""
    pts = np.asarray(pts, float)
    out = []
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(i + 2, len(pts) - 1)]
        for t in np.linspace(0, 1, n, endpoint=(i == len(pts) - 2)):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.array(out)


def cosgrid(n, ease=1.0):
    """0..1 mit Verdichtung an den Rändern."""
    t = np.linspace(0, 1, n)
    return (1 - np.cos(np.pi * t)) / 2 * ease + t * (1 - ease)


def pillow(name, S, half_t, edge_r, du, dv, flip=False):
    """Kissen aus Mittelfläche S (nu,nv,3) mit Normalen.
    half_t: halbe Dicke; edge_r: Rundungsradius in Metern; du/dv: Kantenabstand je Gitterpunkt (nu,nv).
    Vorder- und Rückseite treffen sich am Rand (Naht/Einfassung)."""
    nu, nv, _ = S.shape
    # Normalen numerisch
    Su = np.gradient(S, axis=0); Sv = np.gradient(S, axis=1)
    Nn = np.cross(Su, Sv)
    Nn /= np.linalg.norm(Nn, axis=2)[:, :, None]
    if flip:
        Nn = -Nn
    d = np.minimum(du, dv)
    s = np.clip(d / edge_r, 0, 1)
    prof = np.sqrt(np.clip(1 - (1 - s) ** 2, 0, 1))
    h = half_t * (0.08 + 0.92 * prof)
    # Rand: Naht-Wulst minimal
    front = S + Nn * h[:, :, None]
    back = S - Nn * h[:, :, None]
    V = np.concatenate([front.transpose(1, 0, 2).reshape(-1, 3), back.transpose(1, 0, 2).reshape(-1, 3)])
    F = grid_faces(nu, nv, off=0) + grid_faces(nu, nv, off=nu * nv, flip=True)
    # Rand schließen
    def idx(i, j, side):
        return side * nu * nv + j * nu + i
    ring = [(i, 0) for i in range(nu)] + [(nu - 1, j) for j in range(1, nv)] + \
           [(i, nv - 1) for i in range(nu - 2, -1, -1)] + [(0, j) for j in range(nv - 2, 0, -1)]
    for k in range(len(ring)):
        a = ring[k]; b = ring[(k + 1) % len(ring)]
        F.append((idx(*a, 0), idx(*a, 1), idx(*b, 1), idx(*b, 0)))
    o = mesh_from(name, V, F)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data); bm.free()
    if flip:
        pass
    return o


def bm_bevel_obj(o, offset, segs=2, angle=0.6):
    bm = bmesh.new(); bm.from_mesh(o.data)
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > angle]
    bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons:
        p.use_smooth = True


def join(objs, name):
    objs = [o for o in objs if o is not None]
    set_active(objs[0])
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name; o.data.name = name
    return o


def assign_mat(o, name, rgba, rough=0.7, metal=0.0):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = rgba
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        m.diffuse_color = rgba
    o.data.materials.clear()
    o.data.materials.append(m)
    return m


def rigid_bind(o, weights):
    """Gleichmäßige Gewichte (starr): {bone: w}."""
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
    idx = list(range(len(o.data.vertices)))
    for b, w in weights.items():
        g = o.vertex_groups.new(name=b)
        g.add(idx, w, 'REPLACE')
