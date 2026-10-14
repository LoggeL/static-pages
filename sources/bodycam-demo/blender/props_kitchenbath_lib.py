# UNIT 27 · PROPS-KÜCHE-BAD — Hilfsbibliothek (wird von props_kitchenbath.py per exec geladen)
# Geometrie-Bausteine, UV in Weltmetern, Vertex-AO (COLOR_0) und ein numpy-Texturbacker für
# Unikat-Schmutztexturen (MU_<prop>): Dreiecke werden im UV-Raum gerastert, je Texel Weltposition/Normale/AO
# interpoliert und daraus prozeduraler Dreck (Schlieren, Rost, Vergilbung, Kantenabplatzer) berechnet.
import bpy, bmesh, math, random, json, os, sys, time
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion, noise
from mathutils.bvhtree import BVHTree
from math import pi, sin, cos, radians, sqrt

# ----------------------------------------------------------------------------------------------
# Materialien. key -> (Basisfarbe linear, roughness, metallic)
TEXTURE_IDS = {'concrete_floor', 'asphalt_wet', 'grass_dead', 'dirt_mud', 'wood_floor_worn', 'carpet_stained',
               'tile_floor_dirty', 'tile_wall_white', 'wallpaper_peeling', 'plaster_painted_dirty', 'plaster_damaged',
               'ceiling_stained', 'wood_door_painted', 'siding_vinyl_dirty', 'roof_shingles', 'wood_trim_painted',
               'metal_rusty', 'fabric_sofa_dirty', 'mattress_stained', 'cardboard', 'laminate_counter',
               'cabinet_wood', 'brick_red', 'wood_planks_raw'}
MATS = {
    # TEXTURES-IDs (Fallbackfarben)
    'laminate_counter': ((0.52, 0.47, 0.38), 0.45, 0.0),
    'cabinet_wood': ((0.30, 0.17, 0.08), 0.6, 0.0),
    'metal_rusty': ((0.22, 0.11, 0.06), 0.82, 0.55),
    'wood_planks_raw': ((0.30, 0.24, 0.17), 0.85, 0.0),
    'plaster_painted_dirty': ((0.55, 0.52, 0.46), 0.85, 0.0),
    'cardboard': ((0.36, 0.24, 0.13), 0.88, 0.0),
    # Faktor-Materialien
    'particleboard': ((0.36, 0.27, 0.16), 0.95, 0.0),
    'particleboard_wet': ((0.17, 0.12, 0.07), 0.9, 0.0),
    'cabinet_interior': ((0.42, 0.34, 0.24), 0.8, 0.0),
    'chrome': ((0.62, 0.62, 0.62), 0.16, 1.0),
    'chrome_dull': ((0.50, 0.49, 0.47), 0.38, 1.0),
    'stainless': ((0.55, 0.55, 0.54), 0.34, 1.0),
    'stainless_dark': ((0.30, 0.30, 0.29), 0.5, 1.0),
    'aluminium': ((0.75, 0.75, 0.74), 0.38, 1.0),
    'aluminium_dark': ((0.30, 0.29, 0.28), 0.55, 1.0),
    'steel_dark': ((0.10, 0.10, 0.10), 0.55, 1.0),
    'cast_iron': ((0.05, 0.05, 0.05), 0.7, 0.8),
    'brass_old': ((0.35, 0.24, 0.10), 0.45, 1.0),
    'copper_old': ((0.40, 0.18, 0.09), 0.5, 1.0),
    'galvanized': ((0.45, 0.45, 0.43), 0.6, 1.0),
    'plastic_black': ((0.018, 0.018, 0.018), 0.45, 0.0),
    'plastic_grey': ((0.20, 0.20, 0.19), 0.5, 0.0),
    'plastic_white': ((0.62, 0.61, 0.56), 0.4, 0.0),
    'plastic_almond': ((0.56, 0.50, 0.38), 0.45, 0.0),
    'plastic_red': ((0.40, 0.03, 0.02), 0.4, 0.0),
    'plastic_clear': ((0.75, 0.78, 0.77), 0.12, 0.0),
    'pvc_white': ((0.62, 0.62, 0.58), 0.45, 0.0),
    'rubber_black': ((0.025, 0.025, 0.025), 0.8, 0.0),
    'rubber_grey': ((0.12, 0.12, 0.115), 0.8, 0.0),
    'fridge_liner': ((0.62, 0.62, 0.58), 0.35, 0.0),
    'glass': ((0.80, 0.84, 0.82), 0.05, 0.0),
    'glass_dirty': ((0.66, 0.68, 0.64), 0.3, 0.0),
    'glass_dark': ((0.012, 0.012, 0.013), 0.12, 0.0),
    'glass_edge': ((0.30, 0.45, 0.38), 0.1, 0.0),
    'mirror': ((0.85, 0.86, 0.85), 0.035, 1.0),
    'mirror_back': ((0.08, 0.08, 0.075), 0.9, 0.0),
    'porcelain': ((0.68, 0.67, 0.63), 0.12, 0.0),
    'enamel_white': ((0.66, 0.65, 0.60), 0.22, 0.0),
    'water_dirty': ((0.035, 0.028, 0.015), 0.04, 0.0),
    'grease': ((0.10, 0.06, 0.02), 0.35, 0.0),
    'spill_dark': ((0.03, 0.02, 0.01), 0.25, 0.0),
    'mold_green': ((0.06, 0.08, 0.03), 0.9, 0.0),
    'food_crust': ((0.25, 0.12, 0.04), 0.75, 0.0),
    'ceramic_plate': ((0.62, 0.60, 0.54), 0.18, 0.0),
    'nonstick': ((0.03, 0.03, 0.03), 0.42, 0.3),
    'bakelite': ((0.02, 0.018, 0.016), 0.5, 0.0),
    'curtain_vinyl': ((0.55, 0.56, 0.52), 0.55, 0.0),
    'towel': ((0.36, 0.40, 0.42), 1.0, 0.0),
    'foil_duct': ((0.62, 0.62, 0.60), 0.35, 1.0),
    'fiberglass': ((0.60, 0.50, 0.25), 1.0, 0.0),
    'cultured_marble': ((0.58, 0.53, 0.44), 0.2, 0.0),
    'paint_white': ((0.66, 0.65, 0.60), 0.4, 0.0),
    'gasket': ((0.10, 0.10, 0.095), 0.7, 0.0),
    'coil': ((0.04, 0.04, 0.04), 0.6, 0.7),
    'burner_pan': ((0.45, 0.44, 0.42), 0.35, 1.0),
}
# Unikate mit Bild aus Imagegen: key -> (Bilddatei in IMG_SRC, Fallbackfarbe, roughness, metallic)
UNIQUE_IMG = {
    'fridge_note': ('fridge_note.jpg', (0.62, 0.60, 0.52), 0.85, 0.0),
    'wh_label': ('wh_label.jpg', (0.55, 0.52, 0.45), 0.6, 0.0),
    'stove_panel': ('stove_panel.jpg', (0.52, 0.47, 0.36), 0.35, 0.0),
    'washer_panel': ('washer_panel.jpg', (0.60, 0.60, 0.56), 0.35, 0.0),
    'dryer_panel': ('dryer_panel.jpg', (0.60, 0.60, 0.56), 0.35, 0.0),
    'microwave_panel': ('microwave_panel.jpg', (0.10, 0.10, 0.10), 0.3, 0.0),
}
# Gebackene Unikate (Schmutztextur je Prop): key -> dict(res, recipe)
UNIQUE_BAKE = {}


def get_mat(key):
    if key.startswith('MU_'):
        k = key[3:]
        m = bpy.data.materials.get(key)
        if m:
            return m
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if k in UNIQUE_IMG:
            img_name, col, rough, metal = UNIQUE_IMG[k]
            bsdf.inputs['Base Color'].default_value = (*col, 1)
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
            p = os.path.join(IMG_SRC, img_name)
            if os.path.exists(p):
                img = bpy.data.images.load(p, check_existing=True)
                tex = m.node_tree.nodes.new('ShaderNodeTexImage')
                tex.image = img
                tex.extension = 'EXTEND'
                m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            else:
                print('WARN missing unique image', p)
            m.diffuse_color = (*col, 1)
        else:
            bk = UNIQUE_BAKE[k]
            col, rough, metal = bk['base']
            bsdf.inputs['Base Color'].default_value = (*col, 1)
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
            m.diffuse_color = (*col, 1)
            m['kb_bake'] = k
        m.use_backface_culling = True
        return m
    nm = 'M_' + key
    m = bpy.data.materials.get(nm)
    if m:
        return m
    m = bpy.data.materials.new(nm)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    col, rough, metal = MATS[key]
    bsdf.inputs['Base Color'].default_value = (*col, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*col, 1)
    if key.startswith('glass') and key not in ('glass_dark', 'glass_edge'):
        bsdf.inputs['Transmission Weight'].default_value = 1.0
        bsdf.inputs['Alpha'].default_value = 0.35 if key == 'glass' else 0.55
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if key == 'plastic_clear':
        bsdf.inputs['Alpha'].default_value = 0.5
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.use_backface_culling = key not in ('curtain_vinyl', 'towel', 'glass', 'glass_dirty', 'plastic_clear',
                                         'foil_duct', 'water_dirty')
    return m


# ----------------------------------------------------------------------------------------------
# Grundwerkzeuge
WORK = None


def work_coll():
    global WORK
    if WORK is None or WORK.name not in bpy.data.collections:
        WORK = bpy.data.collections.new('_WORK')
        bpy.context.scene.collection.children.link(WORK)
    return WORK


def link(ob):
    work_coll().objects.link(ob)
    return ob


def mesh_obj(name, bm, mat=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if mat:
        for k in (mat if isinstance(mat, (list, tuple)) else [mat]):
            me.materials.append(get_mat(k))
    return ob


def set_mat(ob, key):
    ob.data.materials.clear()
    ob.data.materials.append(get_mat(key))
    for p in ob.data.polygons:
        p.material_index = 0
    return ob


def apply_tf(ob):
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None, pivot=None):
    """rot in Grad (XYZ). pivot: Drehpunkt in Objektkoordinaten (vor Verschiebung)."""
    if pivot is not None:
        ob.data.transform(Matrix.Translation(-Vector(pivot)))
    ob.location = Vector(loc) + (Vector(pivot) if pivot is not None else Vector())
    ob.rotation_euler = Euler([radians(a) for a in rot], 'XYZ')
    if scale:
        ob.scale = scale if hasattr(scale, '__len__') else (scale,) * 3
    return apply_tf(ob)


def xform(ob, mat):
    ob.data.transform(mat)
    ob.data.update()
    return ob


def rot_about(ob, pivot, axis, deg):
    p = Vector(pivot)
    M = Matrix.Translation(p) @ Matrix.Rotation(radians(deg), 4, axis) @ Matrix.Translation(-p)
    return xform(ob, M)


def apply_mods(ob):
    if not ob.modifiers:
        return ob
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def mod_bevel(ob, w=0.004, seg=2, angle=35, only_vert=False, clamp=True, profile=0.5, harden=False):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = w
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = radians(angle)
    m.use_clamp_overlap = clamp
    m.profile = profile
    m.affect = 'VERTICES' if only_vert else 'EDGES'
    m.miter_outer = 'MITER_ARC'
    m.harden_normals = harden
    return m


def mod_subsurf(ob, lv=1):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = lv
    m.render_levels = lv
    return m


def mod_solidify(ob, t, off=-1.0, even=True, rim=True):
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = t
    m.offset = off
    m.use_even_offset = even
    m.use_rim = rim
    return m


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    for o in objs:
        apply_mods(o)
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    o = objs[0]
    if name:
        o.name = name
        o.data.name = name
    return o


def deform(ob, fn):
    me = ob.data
    for v in me.vertices:
        v.co = fn(Vector(v.co))
    me.update()
    return ob


def remove(ob):
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if me and me.users == 0 and isinstance(me, bpy.types.Mesh):
        bpy.data.meshes.remove(me)


def fbm(p, oct=4):
    return noise.fractal(p, 0.7, 2.0, oct, noise_basis='PERLIN_ORIGINAL')


def nvec(p):
    return noise.noise_vector(p, noise_basis='PERLIN_ORIGINAL')


def jitter(ob, amp, freq, seed=0, normal_only=False, mask=None):
    off = Vector((seed * 13.7, seed * 7.3, seed * 3.1))
    me = ob.data
    for v in me.vertices:
        if mask and not mask(v.co):
            continue
        p = v.co * freq + off
        if normal_only:
            v.co = v.co + v.normal * (noise.noise(p) * amp)
        else:
            v.co = v.co + nvec(p) * amp
    me.update()
    return ob


def dent(ob, center, radius, depth, direction=None):
    """Delle: verschiebt Vertices in Kugelumgebung (cos-Abfall) entlang direction bzw. -Normale."""
    c = Vector(center)
    me = ob.data
    for v in me.vertices:
        d = (v.co - c).length
        if d < radius:
            f = 0.5 + 0.5 * cos(pi * d / radius)
            dirv = Vector(direction) if direction else -v.normal
            v.co = v.co + dirv * depth * f
    me.update()


# ---------- bmesh-Bausteine
def bm_box(sx, sy, sz):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    return bm


def bm_grid_box(sx, sy, sz, step):
    """Box mit Raster (Vertexdichte für AO/Dellen)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    for axis, size in ((0, sx), (1, sy), (2, sz)):
        n = max(0, int(round(size / step)) - 1)
        for i in range(1, n + 1):
            t = -size / 2 + size * i / (n + 1)
            co = Vector((0, 0, 0)); co[axis] = t
            no = Vector((0, 0, 0)); no[axis] = 1
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
    return bm


def rbox(name, sx, sy, sz, mat, loc=(0, 0, 0), rot=(0, 0, 0), r=0.003, seg=2, step=None, angle=35):
    """Box mit abgerundeten Kanten. loc = Mittelpunkt."""
    bm = bm_grid_box(sx, sy, sz, step) if step else bm_box(sx, sy, sz)
    ob = mesh_obj(name, bm, mat)
    if r:
        mod_bevel(ob, r, seg, angle=angle)
        apply_mods(ob)
    place(ob, loc, rot)
    return ob


def rbox_z0(name, sx, sy, sz, mat, x=0, y=0, z0=0, **kw):
    """Box mit Unterkante z0."""
    return rbox(name, sx, sy, sz, mat, loc=(x, y, z0 + sz / 2), **kw)


def cyl(name, r, h, mat, seg=16, loc=(0, 0, 0), rot=(0, 0, 0), r2=None, caps=True, bevel=0.0, rings=0, bseg=2):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=h)
    if rings:
        side = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
        bmesh.ops.subdivide_edges(bm, edges=side, cuts=rings)
    ob = mesh_obj(name, bm, mat)
    if bevel:
        mod_bevel(ob, bevel, bseg)
        apply_mods(ob)
    place(ob, loc, rot)
    return ob


def lathe(name, profile, mat, seg=24, loc=(0, 0, 0), rot=(0, 0, 0), close_top=False, close_bot=False, sx=1.0, sy=1.0):
    """profile: Liste (r, z) von unten nach oben; um Z gedreht (optional elliptisch sx/sy)."""
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * pi * i / seg
        rings.append([bm.verts.new((r * cos(a) * sx, r * sin(a) * sy, z)) for (r, z) in profile])
    n = len(profile)
    for i in range(seg):
        r0, r1 = rings[i], rings[(i + 1) % seg]
        for j in range(n - 1):
            try:
                bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    if close_bot:
        bot = list(dict.fromkeys(r[0] for r in rings))
        if len(bot) > 2 and all(v.is_valid for v in bot):
            bm.faces.new(bot[::-1])
    if close_top:
        top = list(dict.fromkeys(r[-1] for r in rings))
        if len(top) > 2 and all(v.is_valid for v in top):
            bm.faces.new(top)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, mat)
    place(ob, loc, rot)
    return ob


def loft(name, loops, mat, closed=True, cap_first=False, cap_last=False, flip=False):
    """Fläche durch Liste von Punkt-Schleifen gleicher Länge."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in L] for L in loops]
    n = len(loops[0])
    for i in range(len(vs) - 1):
        a, b = vs[i], vs[i + 1]
        for k in range(n if closed else n - 1):
            k2 = (k + 1) % n
            f = (a[k], a[k2], b[k2], b[k]) if not flip else (a[k], b[k], b[k2], a[k2])
            try:
                bm.faces.new(f)
            except ValueError:
                pass
    if cap_first:
        bm.faces.new(vs[0][::-1] if not flip else vs[0])
    if cap_last:
        bm.faces.new(vs[-1] if not flip else vs[-1][::-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bm.normal_update()
    return mesh_obj(name, bm, mat)


def rrect(cx, cy, hx, hy, r, z, nc=4, ns=0):
    """Abgerundetes Rechteck (gegen Uhrzeigersinn, Start rechts unten Ecke). nc Punkte je Ecke, ns Zusatzpunkte je Seite."""
    r = min(r, hx - 1e-4, hy - 1e-4)
    pts = []
    corners = [(hx - r, -hy + r, -90), (hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180)]
    for ci, (ox, oy, a0) in enumerate(corners):
        for j in range(nc + 1):
            a = radians(a0 + 90 * j / nc)
            pts.append((cx + ox + r * cos(a), cy + oy + r * sin(a), z))
        # Seite zur nächsten Ecke
        nx_, ny_, na = corners[(ci + 1) % 4]
        a_end = radians(a0 + 90)
        p0 = Vector((cx + ox + r * cos(a_end), cy + oy + r * sin(a_end), z))
        a_next = radians(na)
        p1 = Vector((cx + nx_ + r * cos(a_next), cy + ny_ + r * sin(a_next), z))
        for j in range(1, ns + 1):
            t = j / (ns + 1)
            pts.append(tuple(p0.lerp(p1, t)))
    return pts


def superellipse(cx, cy, a, b, n_exp, z, N=48, back_ext=0.0, back_pow=2.0):
    pts = []
    for i in range(N):
        t = 2 * pi * i / N - pi / 2
        c, s = cos(t), sin(t)
        x = a * math.copysign(abs(c) ** (2 / n_exp), c)
        y = b * math.copysign(abs(s) ** (2 / n_exp), s)
        if back_ext and s > 0:
            y += back_ext * (s ** back_pow)
        pts.append((cx + x, cy + y, z))
    return pts


def tube_path(name, pts, radius, mat, sides=8, radii=None, caps=True):
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        if prev_n is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            nrm = t.cross(up).normalized()
        else:
            nrm = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = nrm
        bi = t.cross(nrm)
        r = radii[i] if radii else radius
        rings.append([bm.verts.new(p + (nrm * cos(2 * pi * k / sides) + bi * sin(2 * pi * k / sides)) * r)
                      for k in range(sides)])
    for i in range(len(rings) - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat)


def catmull(pts, n=6):
    pts = [Vector(p) for p in pts]
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def pipe(name, pts, r, mat, sides=10, bend=0.04, n=4):
    """Rohr mit gerundeten Bögen an den Knickpunkten."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d1 = (b - a); d2 = (c - b)
        rb = min(bend, d1.length * 0.45, d2.length * 0.45)
        p0 = b - d1.normalized() * rb
        p2 = b + d2.normalized() * rb
        for k in range(n + 1):
            t = k / n
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p2)
    out.append(pts[-1])
    return tube_path(name, out, r, mat, sides=sides)


def bm_poly_slab(outline, thick, z0=0.0):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for (x, y) in outline]
    f = bm.faces.new(vs)
    bm.normal_update()
    if f.normal.z > 0:
        f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, thick), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def grid_plane(sx, sy, nx, ny):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    bmesh.ops.scale(bm, vec=(sx, sy, 1), verts=bm.verts)
    return bm


def plane_uv01(name, w, h, mat, nx=1, ny=1):
    """Ebene in XZ (Vorderseite -Y), UV 0..1 (für Etiketten), Mitte im Ursprung."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    verts = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            verts[i, j] = bm.verts.new(((i / nx - 0.5) * w, 0, (j / ny - 0.5) * h))
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
            for l in f.loops:
                co = l.vert.co
                l[uvl].uv = (co.x / w + 0.5, co.z / h + 0.5)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.y > 0:
            f.normal_flip()
    return mesh_obj(name, bm, mat)


def frame_panel(name, w, h, t, mat, border=0.055, recess=0.006, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0025,
                panel=True):
    """Rahmentür (Kassette): Box w x t x h (Front -Y) mit vertiefter Füllung."""
    bm = bm_box(w, t, h)
    if panel:
        front = [f for f in bm.faces if f.normal.y < -0.9][0]
        r = bmesh.ops.inset_individual(bm, faces=[front], thickness=border, depth=0.0)
        r2 = bmesh.ops.inset_individual(bm, faces=[front], thickness=0.012, depth=-recess * 0.6)
        r3 = bmesh.ops.inset_individual(bm, faces=[front], thickness=0.006, depth=-recess * 0.4)
    ob = mesh_obj(name, bm, mat)
    mod_bevel(ob, bevel, 2, angle=30)
    apply_mods(ob)
    place(ob, loc, rot)
    return ob


# ---------- Simulation (Tuch)
def make_collider(ob, thick=0.003, friction=5.0):
    ob.modifiers.new('Collision', 'COLLISION')
    ob.collision.thickness_outer = thick
    ob.collision.cloth_friction = friction
    return ob


def cloth_sim(ob, frames=60, mass=0.3, tension=15, bending=0.5, pin_group=None, self_coll=False, quality=6,
              dist=0.004, air=1.0, shrink=0.0, pin_stiff=1.0):
    m = ob.modifiers.new('Cloth', 'CLOTH')
    s = m.settings
    s.quality = quality
    s.mass = mass
    s.air_damping = air
    s.tension_stiffness = tension
    s.compression_stiffness = tension
    s.shear_stiffness = tension * 0.5
    s.bending_stiffness = bending
    s.shrink_min = shrink
    if pin_group:
        s.vertex_group_mass = pin_group
        s.pin_stiffness = pin_stiff
    c = m.collision_settings
    c.use_collision = True
    c.distance_min = dist
    c.use_self_collision = self_coll
    c.self_distance_min = dist
    c.collision_quality = 3
    sc = bpy.context.scene
    m.point_cache.frame_start = 1
    m.point_cache.frame_end = frames
    sc.frame_start = 1
    sc.frame_end = frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    apply_mods(ob)
    sc.frame_set(1)
    return ob


# ---------- UV (Weltmeter), Glättung
def box_uv(ob, seed=0):
    """Box-Projektion in Weltmetern für alle Flächen außer MU_-Materialien."""
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    rnd = random.Random(seed)
    ox, oy = rnd.uniform(0, 8), rnd.uniform(0, 8)
    mats = me.materials
    for p in me.polygons:
        if p.material_index < len(mats) and mats[p.material_index] and mats[p.material_index].name.startswith('MU_'):
            continue
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y * (1 if n.z > 0 else -1)
            elif ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            uv.data[li].uv = (u + ox, v + oy)
    return ob


def smooth(ob, angle=35):
    me = ob.data
    me.shade_smooth()
    if angle is not None and angle < 180:
        me.set_sharp_from_angle(angle=radians(angle))
    return ob


def fib_dirs(n):
    out = []
    ga = pi * (3 - sqrt(5))
    for i in range(n):
        z = 1 - (i + 0.5) / n
        r = sqrt(max(0, 1 - z * z))
        a = ga * i
        out.append(Vector((r * cos(a), r * sin(a), z)))
    return out


def vertex_ao(ob, rays=24, dist=0.25, ground=True):
    """Umgebungsverdeckung je Vertex (1 = frei)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    dirs = fib_dirs(rays)
    zmin = min(v.co.z for v in me.vertices)
    out = np.ones(len(me.vertices), np.float32)
    for v in me.vertices:
        n = Vector(v.normal)
        if n.length < 0.5:
            n = Vector((0, 0, 1))
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = v.co + n * 0.0012
        occ = 0.0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            hit = bvh.ray_cast(o, w, dist)
            if hit[0] is not None:
                occ += 1.0 - (hit[3] / dist) * 0.7
            elif ground and w.z < -1e-4:
                tt = -(o.z - zmin) / w.z
                if 0 < tt < dist:
                    occ += 1.0 - (tt / dist) * 0.7
        out[v.index] = 1.0 - occ / len(dirs)
    return out


def vertex_convexity(ob):
    """>0 = konvexe Kante (Abnutzung), <0 = Kehle."""
    me = ob.data
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b); nb[b].append(a)
    co = np.array([v.co[:] for v in me.vertices], np.float32)
    nrm = np.array([v.normal[:] for v in me.vertices], np.float32)
    out = np.zeros(len(co), np.float32)
    for i, ns in enumerate(nb):
        if not ns:
            continue
        d = co[ns] - co[i]
        l = np.linalg.norm(d, axis=1) + 1e-9
        out[i] = -np.mean((d @ nrm[i]) / l)
    return out


def write_vcol(ob, cols):
    me = ob.data
    attr = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    flat = np.ones((len(me.vertices), 4), np.float32)
    flat[:, :3] = cols
    attr.data.foreach_set('color', flat.ravel())
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.find('Color')
    except Exception:
        pass


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ==============================================================================================
# numpy-Rauschen
def _hash3(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791) ^ (seed * 2654435761)
    h = h & 0xffffffff
    h = (h ^ (h >> 13)) * 1274126177 & 0xffffffff
    h = h ^ (h >> 16)
    return (h & 0xffffff).astype(np.float32) / float(0xffffff)


def vnoise(p, seed=0):
    """Wertrauschen 3D, p (n,3) -> (n,) in [0,1]."""
    i = np.floor(p)
    f = p - i
    u = f * f * (3 - 2 * f)
    ix, iy, iz = i[:, 0].astype(np.int64), i[:, 1].astype(np.int64), i[:, 2].astype(np.int64)
    res = 0
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                res = res + wx * wy * wz * _hash3(ix + dx, iy + dy, iz + dz, seed)
    return res


def nfbm(p, scale=1.0, oct=4, seed=0, lac=2.0, gain=0.5, aniso=(1, 1, 1)):
    q = p * np.array(aniso, np.float32) * scale
    amp, tot, acc = 1.0, 0.0, 0.0
    for o in range(oct):
        acc = acc + amp * vnoise(q, seed + o * 17)
        tot += amp
        amp *= gain
        q = q * lac + 3.17
    return acc / tot


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(c0, c1, t):
    t = np.asarray(t)[..., None] if np.ndim(t) == 1 else t
    return c0 * (1 - t) + c1 * t


# ---------- Rasterung der UV-Dreiecke
def bake_surface_samples(ob, mat_index_set, res, extra_vattrs):
    """Gibt (pix_idx (n,2), P, N, attrs dict) für alle Texel der Flächen mit Material in mat_index_set."""
    me = ob.data
    me.calc_loop_triangles()
    uv = me.uv_layers['UVMap'].data
    co = np.array([v.co[:] for v in me.vertices], np.float32)
    vn = np.array([v.normal[:] for v in me.vertices], np.float32)
    PIX, PP, NN = [], [], []
    AT = {k: [] for k in extra_vattrs}
    for lt in me.loop_triangles:
        if lt.material_index not in mat_index_set:
            continue
        vi = list(lt.vertices)
        uvs = np.array([uv[l].uv[:] for l in lt.loops], np.float32) * res
        x0, y0 = np.floor(uvs.min(0)).astype(int)
        x1, y1 = np.ceil(uvs.max(0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0)
        x1, y1 = min(x1 + 1, res - 1), min(y1 + 1, res - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        px = np.stack([gx.ravel() + 0.5, gy.ravel() + 0.5], 1)
        a, b, c = uvs
        v0, v1 = b - a, c - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        d = px - a
        w1 = (d[:, 0] * v1[1] - v1[0] * d[:, 1]) / den
        w2 = (v0[0] * d[:, 1] - d[:, 0] * v0[1]) / den
        w0 = 1 - w1 - w2
        eps = -0.02
        m = (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
        if not m.any():
            continue
        W = np.stack([w0[m], w1[m], w2[m]], 1)
        PIX.append(np.stack([gx.ravel()[m], gy.ravel()[m]], 1))
        PP.append(W @ co[vi])
        NN.append(W @ vn[vi])
        for k, arr in extra_vattrs.items():
            AT[k].append(W @ arr[vi])
    if not PIX:
        return None
    PIX = np.concatenate(PIX)
    P = np.concatenate(PP)
    N = np.concatenate(NN)
    N /= (np.linalg.norm(N, axis=1, keepdims=True) + 1e-9)
    A = {k: np.concatenate(v) for k, v in AT.items()}
    # Duplikate (Texel auf Kanten) – letzter gewinnt, ok
    return PIX, P, N, A


def dilate(img, mask, it=6):
    img = img.copy(); mask = mask.copy()
    for _ in range(it):
        acc = np.zeros_like(img); cnt = np.zeros(mask.shape, np.float32)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sm = np.roll(np.roll(mask, dy, 0), dx, 1)
            si = np.roll(np.roll(img, dy, 0), dx, 1)
            acc += si * sm[..., None]
            cnt += sm
        new = (~mask) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        mask = mask | new
    return img, mask


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


# ---------- Standard-Schmutzrezept für Emaille/Porzellan/lackiertes Blech
def grime_recipe(P, N, A, base, rough0, seed=0, yellow=0.35, grime=0.5, crevice=0.8, floor=0.6, drips=0.3,
                 rust_edges=0.25, rust_spots=0.15, dust_top=0.4, zmin=0.0, zmax=1.0, grime_col=(0.20, 0.14, 0.07),
                 rust_col=(0.16, 0.06, 0.02), yellow_col=(0.60, 0.50, 0.30), chip_col=(0.03, 0.03, 0.03),
                 dust_col=(0.36, 0.33, 0.28), metal_base=0.0):
    n = len(P)
    base = np.array(base, np.float32)
    col = np.tile(base, (n, 1))
    rough = np.full(n, rough0, np.float32)
    metal = np.full(n, metal_base, np.float32)
    ao = A.get('ao', np.ones(n, np.float32))
    cx = A.get('cvx', np.zeros(n, np.float32))
    h = (P[:, 2] - zmin) / max(zmax - zmin, 1e-3)
    # Großflächige Vergilbung
    nY = nfbm(P, 2.2, 4, seed + 1)
    tY = smoothstep(0.35, 0.75, nY) * yellow
    col = mix(col, np.array(yellow_col, np.float32), tY)
    # fleckiger Schmutzfilm
    nG = nfbm(P, 5.0, 5, seed + 2)
    nG2 = nfbm(P, 22.0, 3, seed + 3)
    tG = (smoothstep(0.45, 0.8, nG) * 0.6 + smoothstep(0.55, 0.9, nG2) * 0.3) * grime
    # Kehlen/Ecken
    tC = smoothstep(0.92, 0.45, ao) * crevice * (0.6 + 0.4 * nG2)
    # Boden: unten dunkler, ausgefranste Kante
    fb = np.exp(-np.maximum(P[:, 2] - zmin, 0) / 0.07) * floor * (0.55 + 0.45 * nG)
    tot = np.clip(tG + tC + fb, 0, 0.95)
    col = mix(col, np.array(grime_col, np.float32), tot)
    rough = rough + tot * (0.85 - rough0)
    # Schlieren/Tropfspuren (vertikal gestreckt)
    nS = nfbm(P, 1.0, 3, seed + 4, aniso=(28, 28, 1.4))
    vertical = 1 - np.abs(N[:, 2])
    tS = smoothstep(0.62, 0.82, nS) * drips * vertical * (0.4 + 0.6 * nfbm(P, 3.0, 2, seed + 5))
    col = mix(col, np.array(grime_col, np.float32) * 0.8, tS)
    rough = rough + tS * 0.25
    # Staub auf Oberseiten
    up = np.clip(N[:, 2], 0, 1) ** 2
    tD = up * dust_top * (0.5 + 0.5 * nfbm(P, 9.0, 3, seed + 6)) * smoothstep(0.3, 0.9, ao)
    col = mix(col, np.array(dust_col, np.float32), tD)
    rough = rough + tD * (0.95 - rough)
    # Kantenabplatzer + Rost
    nE = nfbm(P, 30.0, 3, seed + 7)
    tE = smoothstep(0.02, 0.10, cx) * smoothstep(0.55, 0.75, nE) * rust_edges * 2.0
    tE = np.clip(tE, 0, 1)
    nR = nfbm(P, 14.0, 4, seed + 8)
    tR = smoothstep(0.72, 0.86, nR) * rust_spots * (0.3 + 1.2 * np.exp(-np.maximum(P[:, 2] - zmin, 0) / 0.15))
    tR = np.clip(tR, 0, 1)
    halo = np.clip(tR * 1.8 + tE * 1.2, 0, 1) * 0.5
    col = mix(col, np.array(rust_col, np.float32) * 1.6, halo * 0.6)
    col = mix(col, np.array(rust_col, np.float32), np.maximum(tR, tE * 0.6))
    col = mix(col, np.array(chip_col, np.float32), smoothstep(0.5, 0.9, tE) * 0.7)
    rough = np.maximum(rough, np.maximum(tR, tE) * 0.9)
    metal = metal * (1 - np.maximum(tR, tE))
    return col, np.clip(rough, 0.03, 1.0), metal


def bake_unique(ob, mat_name, res, recipe_fn, out_dir):
    """Backt Albedo + ORM für alle Flächen des Materials mat_name; setzt Bildknoten. Gibt Pfade zurück."""
    me = ob.data
    idx = [i for i, m in enumerate(me.materials) if m and m.name == mat_name]
    if not idx:
        return None
    attrs = {'ao': KB_CACHE.get(ob.name + ':ao'), 'cvx': KB_CACHE.get(ob.name + ':cvx')}
    attrs = {k: v for k, v in attrs.items() if v is not None}
    for k, v in KB_CACHE.items():
        if k.startswith(ob.name + ':m_'):
            attrs[k.split(':', 1)[1]] = v
    s = bake_surface_samples(ob, set(idx), res, attrs)
    if s is None:
        return None
    PIX, P, N, A = s
    col, rough, metal = recipe_fn(P, N, A)
    img = np.zeros((res, res, 3), np.float32)
    orm = np.zeros((res, res, 3), np.float32)
    mask = np.zeros((res, res), bool)
    img[PIX[:, 1], PIX[:, 0]] = col
    orm[PIX[:, 1], PIX[:, 0]] = np.stack([np.ones_like(rough), rough, metal], 1)
    mask[PIX[:, 1], PIX[:, 0]] = True
    both = np.concatenate([img, orm], 2)
    both, mask2 = dilate(both, mask, 8)
    bg = (~mask2)
    both[bg] = both[mask2].mean(0) if mask2.any() else 0.5
    img, orm = both[..., :3], both[..., 3:]
    os.makedirs(out_dir, exist_ok=True)
    k = mat_name[3:]
    pa = os.path.join(out_dir, k + '_albedo.jpg')
    po = os.path.join(out_dir, k + '_orm.jpg')
    save_jpg(lin2srgb(img), pa, 86)
    save_jpg(np.clip(orm, 0, 1), po, 90)
    # Material verdrahten
    m = me.materials[idx[0]]
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    for nd in list(nt.nodes):
        if nd.type in ('TEX_IMAGE', 'SEPARATE_COLOR'):
            nt.nodes.remove(nd)
    ia = bpy.data.images.load(pa, check_existing=False)
    ia.name = 'T_' + k + '_albedo'
    io = bpy.data.images.load(po, check_existing=False)
    io.name = 'T_' + k + '_orm'
    io.colorspace_settings.name = 'Non-Color'
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = ia
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = io
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    return pa, po


KB_CACHE = {}


def save_jpg(arr, path, quality=86):
    """arr (h,w,3) Werte 0..1 (bereits im Zielfarbraum), Zeile 0 = unten (Blender-Konvention)."""
    h, w = arr.shape[:2]
    im = bpy.data.images.new('_tmp_save', w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = arr
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = path
    im.file_format = 'JPEG'
    try:
        im.save(filepath=path, quality=quality)
    except TypeError:
        bpy.context.scene.render.image_settings.quality = quality
        im.save()
    bpy.data.images.remove(im)


def smart_uv_faces(ob, mat_names, margin=0.003, angle=60):
    """Smart-UV-Projektion nur für Flächen mit den genannten Materialien (gemeinsamer Atlas)."""
    me = ob.data
    idx = {i for i, m in enumerate(me.materials) if m and m.name in mat_names}
    if not idx:
        return
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for p in me.polygons:
        p.select = p.material_index in idx
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.uv.smart_project(angle_limit=radians(angle), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def mark(ob, key, val=1.0):
    """Float-Attribut kbm_<key> je Vertex (wird nach join als Maske m_<key> fürs Backen gelesen; fehlt = 0)."""
    me = ob.data
    a = me.attributes.get('kbm_' + key) or me.attributes.new('kbm_' + key, 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.full(len(me.vertices), val, np.float32))
    return ob


def boolean_diff(ob, cutter, solver='EXACT'):
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.object = cutter
    m.solver = solver
    apply_mods(ob)
    remove(cutter)
    return ob


def mat_swap_region(ob, key, fn):
    """Weist Flächen, deren Mittelpunkt/Normale fn(c, n) erfüllen, Material key zu."""
    me = ob.data
    m = get_mat(key)
    if m.name not in [x.name for x in me.materials if x]:
        me.materials.append(m)
    idx = [x.name if x else '' for x in me.materials].index(m.name)
    for p in me.polygons:
        if fn(p.center, p.normal):
            p.material_index = idx
    return ob
