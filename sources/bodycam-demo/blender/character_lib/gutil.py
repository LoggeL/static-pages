# Geometrie-Helfer für Kleidung/Ausrüstung (bmesh + numpy)
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix
from .common import *


def dup_object(src, name, coll=None):
    me = src.data.copy()
    me.name = name
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    o.matrix_world = src.matrix_world.copy()
    for g in src.vertex_groups:   # Gewichte stecken im Mesh, Gruppennamen am Objekt
        o.vertex_groups.new(name=g.name)
    return o


def bm_from(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    return bm


def bm_to(o, bm):
    bm.to_mesh(o.data)
    o.data.update()


def bisect_keep(bm, co, no, keep_positive=True, region_mask=None):
    """Schneidet entlang Ebene (co,no) und löscht die andere Seite. region_mask(v.co)->bool begrenzt das Löschen."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    if region_mask is not None:
        faces = [f for f in bm.faces if all(region_mask(v.co) for v in f.verts)]
        edges = list({e for f in faces for e in f.edges})
        verts = list({v for f in faces for v in f.verts})
        geom = verts + edges + faces
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no), clear_inner=False, clear_outer=False, dist=1e-5)
    no = Vector(no)
    kill = []
    for v in bm.verts:
        if region_mask is not None and not region_mask(v.co):
            continue
        d = (v.co - Vector(co)).dot(no)
        if (d < -1e-5 and keep_positive) or (d > 1e-5 and not keep_positive):
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.verts.ensure_lookup_table()


def delete_verts(bm, pred):
    kill = [v for v in bm.verts if pred(v.co)]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.verts.ensure_lookup_table()


def delete_small_islands(bm, keep=1):
    """Behält die größten `keep` zusammenhängenden Teile."""
    seen = set(); islands = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]; isl = []
        seen.add(v.index)
        while stack:
            x = stack.pop(); isl.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index); stack.append(y)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    kill = [v for isl in islands[keep:] for v in isl]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.verts.ensure_lookup_table()


def boundary_loops(bm):
    """Liste geordneter Randschleifen (Listen von BMVerts)."""
    bedges = [e for e in bm.edges if e.is_boundary]
    adj = {}
    for e in bedges:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    seen = set(); loops = []
    for start in adj:
        if start in seen:
            continue
        loop = [start]; seen.add(start)
        prev, cur = None, start
        while True:
            nxt = [n for n in adj[cur] if n is not prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur); seen.add(cur)
        loops.append(loop)
    return loops


def mesh_arrays(o):
    me = o.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    e = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
    return co, e


def vnormals(o):
    me = o.data
    me.update()
    n = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def boundary_mask(o):
    bm = bm_from(o)
    m = np.zeros(len(bm.verts), bool)
    for e in bm.edges:
        if e.is_boundary:
            for v in e.verts:
                m[v.index] = True
    bm.free()
    return m


def ring_distance(o, seeds_mask, max_iter=200):
    """Graph-Abstand (Kantenlänge) von seeds_mask-Vertices (Dijkstra-ähnlich, iterativ relaxiert)."""
    co, e = mesh_arrays(o)
    w = np.linalg.norm(co[e[:, 0]] - co[e[:, 1]], axis=1)
    d = np.where(seeds_mask, 0.0, 1e9)
    for _ in range(max_iter):
        d0 = d.copy()
        np.minimum.at(d, e[:, 0], d[e[:, 1]] + w)
        np.minimum.at(d, e[:, 1], d[e[:, 0]] + w)
        if np.allclose(d0, d):
            break
    return d


def smooth_positions(o, mask, iters=10, lam=0.5, taubin=True, pin_boundary=True):
    co, e = mesh_arrays(o)
    m = mask.astype(float)
    if pin_boundary:
        m[boundary_mask(o)] = 0.0
    if taubin:
        co = taubin_smooth(co, e, m, iters, lam, -lam - 0.03)
    else:
        co = laplacian_smooth(co, e, m, iters, lam)
    set_verts_np(o, co)


def offset_normals(o, amount):
    """amount: Array (N,) Meter entlang Vertexnormalen."""
    co, e = mesh_arrays(o)
    n = vnormals(o)
    co = co + n * np.asarray(amount)[:, None]
    set_verts_np(o, co)


def subdivide(o, levels=1, simple=False):
    m = o.modifiers.new('sub', 'SUBSURF')
    m.levels = levels; m.render_levels = levels
    m.subdivision_type = 'SIMPLE' if simple else 'CATMULL_CLARK'
    m.uv_smooth = 'PRESERVE_BOUNDARIES'
    m.boundary_smooth = 'PRESERVE_CORNERS'
    apply_mods(o)


def seg_param(P, a, b):
    """Projektion von Punkten P auf Segment a->b: t (0..1, nicht geclamped), radialer Vektor."""
    a = np.asarray(a); b = np.asarray(b)
    d = b - a; L = np.linalg.norm(d); dn = d / L
    t = ((P - a) @ dn) / L
    radial = (P - a) - np.outer(t * L, dn)
    return t, radial, dn, L


def frame_angle(radial, axis, ref):
    """Winkel um axis (rad), 0 = Richtung ref (auf Achse orthogonalisiert)."""
    ref = np.asarray(ref, float)
    ref = ref - axis * (ref @ axis); ref /= np.linalg.norm(ref)
    side = np.cross(axis, ref)
    return np.arctan2(radial @ side, radial @ ref)


def transfer_weights(dst, src, mode='POLY_NEAREST'):
    """Vertex-Gruppen von src (Körper) auf dst übertragen."""
    for g in src.vertex_groups:
        if g.name not in dst.vertex_groups:
            dst.vertex_groups.new(name=g.name)
    m = dst.modifiers.new('dt', 'DATA_TRANSFER')
    m.object = src
    m.use_vert_data = True
    m.data_types_verts = {'VGROUP_WEIGHTS'}
    m.vert_mapping = mode
    m.layers_vgroup_select_src = 'ALL'
    m.layers_vgroup_select_dst = 'NAME'
    set_active(dst)
    bpy.ops.object.datalayout_transfer(modifier=m.name)
    apply_mods(dst)


def rigid_weights(o, bone):
    """Alles 1.0 auf einen Knochen."""
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
    g = o.vertex_groups.new(name=bone)
    g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')


def smooth_weights(o, iters=3, factor=0.5, groups=None):
    set_active(o)
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    try:
        bpy.ops.object.vertex_group_smooth(group_select_mode='ALL' if groups is None else 'ACTIVE', factor=factor, repeat=iters)
    finally:
        bpy.ops.object.mode_set(mode='OBJECT')


def normalize_weights(o, limit=4):
    set_active(o)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=limit)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)


def set_attr(o, name, values, domain='POINT'):
    me = o.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    a = me.attributes.new(name, 'FLOAT', domain)
    a.data.foreach_set('value', np.asarray(values, dtype=np.float32))
    return a


def get_attr(o, name):
    a = o.data.attributes[name]
    v = np.empty(len(a.data), dtype=np.float32)
    a.data.foreach_get('value', v)
    return v


def noise3(P, freq, seed=0):
    """Glatte Pseudo-Rauschfunktion aus Sinus-Summen (deterministisch, ohne externe libs)."""
    rng = np.random.default_rng(seed)
    out = np.zeros(len(P))
    for i in range(6):
        d = rng.normal(size=3); d /= np.linalg.norm(d)
        ph = rng.uniform(0, 2 * np.pi)
        f = freq * (1.0 + 0.6 * i)
        out += np.sin((P @ d) * f * 2 * np.pi + ph) / (1.0 + 0.6 * i)
    return out / 2.2
