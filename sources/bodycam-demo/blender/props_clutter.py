# UNIT 27 · Bodycam-Tech-Demo — PROPS-KRAM ("clutter")
# Prozedurale, abgenutzte Kleinkram-/Müll-Props für das verlassene Haus.
#
#   blender -b -P props_clutter.py -- [--only a,b,c] [--no-export] [--no-blend]
#
# Ergebnis: public/bodycam-demo/models/props/<name>.glb  (je Prop ein Mesh-Objekt <name>)
#           sources/bodycam-demo/blender/props_clutter.json (Katalogfragment)
#           $WORK/blend/props_clutter.blend (alle Props, je Collection <name>)
# Konventionen (CONTRACT.md): Meter, Ursprung Boden mittig, Vorderseite Blender -Y, UV in Weltmetern
# (Box-Projektion) für M_<textureId>, eingebettete Bilder nur für MU_<name>. COLOR_0 = gebackene AO/Schmutz
# (linear, multiplikativ). Objekt-Property "surface".
import bpy, bmesh, math, random, json, os, sys, time
from mathutils import Vector, Matrix, Euler, Quaternion, noise
from mathutils.bvhtree import BVHTree
from math import pi, sin, cos, radians, sqrt

REPO = '/Users/logge/Documents/Projects/static-pages'
WORK = '/Users/logge/Documents/Projects/bodycam-work'
OUT_DIR = REPO + '/public/bodycam-demo/models/props'
CATALOG = REPO + '/sources/bodycam-demo/blender/props_clutter.json'
IMG_SRC = REPO + '/sources/bodycam-demo/blender/props_clutter_img'   # Imagegen-Quellbilder (klein, JPG)
BLEND_OUT = WORK + '/blend/props_clutter.blend'

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return default

# ----------------------------------------------------------------------------------------------
# Materialien. key -> (Fallbackfarbe linear, roughness, metallic, extra)
# Keys, die eine TEXTURES-ID sind, werden zu M_<id>. Alle anderen sind reine Faktor-Materialien
# (ebenfalls M_<key>, Engine findet keine Textur -> behält glTF-Werte).
TEXTURE_IDS = {'concrete_floor', 'asphalt_wet', 'grass_dead', 'dirt_mud', 'wood_floor_worn', 'carpet_stained',
               'tile_floor_dirty', 'tile_wall_white', 'wallpaper_peeling', 'plaster_painted_dirty', 'plaster_damaged',
               'ceiling_stained', 'wood_door_painted', 'siding_vinyl_dirty', 'roof_shingles', 'wood_trim_painted',
               'metal_rusty', 'fabric_sofa_dirty', 'mattress_stained', 'cardboard', 'laminate_counter',
               'cabinet_wood', 'brick_red', 'wood_planks_raw'}
MATS = {
    # Textur-IDs
    'cardboard': ((0.36, 0.24, 0.13), 0.88, 0.0),
    'metal_rusty': ((0.22, 0.11, 0.06), 0.82, 0.55),
    'wood_planks_raw': ((0.30, 0.24, 0.17), 0.85, 0.0),
    'brick_red': ((0.30, 0.10, 0.06), 0.9, 0.0),
    'concrete_floor': ((0.33, 0.32, 0.30), 0.92, 0.0),
    'plaster_damaged': ((0.62, 0.60, 0.56), 0.95, 0.0),
    'plaster_painted_dirty': ((0.55, 0.52, 0.46), 0.85, 0.0),
    'fabric_sofa_dirty': ((0.16, 0.14, 0.12), 0.95, 0.0),
    'mattress_stained': ((0.55, 0.52, 0.44), 0.95, 0.0),
    'dirt_mud': ((0.10, 0.075, 0.05), 0.9, 0.0),
    'grass_dead': ((0.26, 0.20, 0.11), 0.95, 0.0),
    # Faktor-Materialien (keine Kacheltextur)
    'plastic_bag_black': ((0.010, 0.010, 0.011), 0.32, 0.0),
    'plastic_bag_grey': ((0.045, 0.048, 0.05), 0.38, 0.0),
    'plastic_bag_white': ((0.42, 0.43, 0.42), 0.30, 0.0),
    'plastic_tie_red': ((0.30, 0.03, 0.03), 0.4, 0.0),
    'plastic_bag_blue': ((0.06, 0.12, 0.30), 0.40, 0.0),
    'plastic_knot': ((0.012, 0.012, 0.013), 0.4, 0.0),
    'tape_packing': ((0.28, 0.18, 0.08), 0.42, 0.0),
    'glass': ((0.80, 0.84, 0.82), 0.06, 0.0, 0.30),
    'glass_dirty': ((0.62, 0.64, 0.60), 0.30, 0.0, 0.50),
    'glass_brown': ((0.16, 0.055, 0.012), 0.10, 0.0, 0.80),
    'glass_green': ((0.035, 0.13, 0.05), 0.10, 0.0, 0.75),
    'aluminium': ((0.80, 0.80, 0.80), 0.32, 1.0),
    'metal_cap': ((0.55, 0.52, 0.45), 0.4, 1.0),
    'paper_white': ((0.52, 0.50, 0.44), 0.9, 0.0),
    'paper_news': ((0.56, 0.52, 0.42), 0.9, 0.0),
    'rubber_black': ((0.025, 0.025, 0.025), 0.82, 0.0),
    'rubber_sole': ((0.55, 0.53, 0.49), 0.8, 0.0),
    'plastic_white_dirty': ((0.62, 0.62, 0.57), 0.55, 0.0),
    'plastic_bin_grey': ((0.055, 0.06, 0.06), 0.6, 0.0),
    'plastic_bucket_orange': ((0.55, 0.16, 0.02), 0.5, 0.0),
    'plastic_bucket_white': ((0.60, 0.60, 0.56), 0.5, 0.0),
    'plastic_black': ((0.02, 0.02, 0.02), 0.5, 0.0),
    'plastic_orange': ((0.65, 0.20, 0.02), 0.45, 0.0),
    'plastic_clear': ((0.80, 0.82, 0.82), 0.15, 0.0, 0.40),
    'paint_white': ((0.72, 0.71, 0.66), 0.35, 0.0),
    'paint_blue': ((0.10, 0.20, 0.32), 0.35, 0.0),
    'steel': ((0.55, 0.55, 0.55), 0.45, 1.0),
    'steel_dark': ((0.18, 0.18, 0.18), 0.55, 1.0),
    'steel_painted_red': ((0.38, 0.025, 0.02), 0.42, 0.0),
    'steel_painted_black': ((0.025, 0.025, 0.025), 0.55, 0.0),
    'steel_painted_green': ((0.05, 0.13, 0.06), 0.5, 0.0),
    'steel_painted_red_dark': ((0.22, 0.02, 0.015), 0.5, 0.0),
    'brass': ((0.60, 0.45, 0.20), 0.35, 1.0),
    'copper': ((0.70, 0.35, 0.18), 0.35, 1.0),
    'anodized_black': ((0.03, 0.03, 0.032), 0.38, 0.6),
    'cable_orange': ((0.60, 0.18, 0.02), 0.5, 0.0),
    'cable_white': ((0.62, 0.60, 0.55), 0.55, 0.0),
    'cable_black': ((0.02, 0.02, 0.02), 0.5, 0.0),
    'fabric_denim': ((0.05, 0.08, 0.14), 0.95, 0.0),
    'fabric_grey': ((0.16, 0.16, 0.16), 0.97, 0.0),
    'fabric_red': ((0.22, 0.03, 0.03), 0.97, 0.0),
    'fabric_olive': ((0.09, 0.10, 0.05), 0.97, 0.0),
    'fabric_white': ((0.55, 0.53, 0.48), 0.97, 0.0),
    'fabric_black': ((0.025, 0.025, 0.028), 0.97, 0.0),
    'nylon_navy': ((0.025, 0.04, 0.085), 0.55, 0.0),
    'nylon_green': ((0.04, 0.07, 0.04), 0.55, 0.0),
    'flannel_red': ((0.20, 0.04, 0.03), 0.97, 0.0),
    'leather_brown': ((0.12, 0.06, 0.03), 0.6, 0.0),
    'sneaker_upper': ((0.40, 0.40, 0.40), 0.75, 0.0),
    'insulation_pink': ((0.65, 0.28, 0.27), 1.0, 0.0),
    'insulation_yellow': ((0.62, 0.46, 0.18), 1.0, 0.0),
    'gypsum_core': ((0.66, 0.65, 0.61), 0.98, 0.0),
    'bark_dead': ((0.085, 0.07, 0.055), 0.9, 0.0),
    'wood_split': ((0.38, 0.30, 0.20), 0.85, 0.0),
    'leaf_brown': ((0.13, 0.065, 0.025), 0.75, 0.0),
    'leaf_orange': ((0.26, 0.09, 0.02), 0.72, 0.0),
    'leaf_dark': ((0.05, 0.035, 0.02), 0.6, 0.0),
    'leaf_yellow': ((0.30, 0.20, 0.05), 0.75, 0.0),
    'food_crust': ((0.28, 0.15, 0.06), 0.8, 0.0),
    'grease': ((0.12, 0.07, 0.02), 0.35, 0.0),
    'ash': ((0.10, 0.10, 0.10), 0.98, 0.0),
    'needle': ((0.70, 0.70, 0.70), 0.2, 1.0),
    'rope_twine': ((0.30, 0.24, 0.15), 0.95, 0.0),
}
SURF = {}  # optional per key

UNIQUE = {  # MU_<name>: Bild, Fallbackfarbe, roughness
    'newspaper': ('newspaper.jpg', (0.55, 0.50, 0.40), 0.9),
    'pizza_box': ('pizza_box.jpg', (0.36, 0.24, 0.13), 0.85),
    'can_label': ('can_label.jpg', (0.40, 0.03, 0.03), 0.35),
    'beer_label': ('beer_label.jpg', (0.55, 0.50, 0.35), 0.7),
    'extinguisher_label': ('extinguisher_label.jpg', (0.6, 0.6, 0.55), 0.5),
    'paper_letter': ('paper_letter.jpg', (0.68, 0.66, 0.58), 0.9),
}


def lin_to_srgb(c):
    return c


def get_mat(key):
    if key.startswith('MU_'):
        nm = key
        k = key[3:]
    else:
        nm = 'M_' + key
        k = key
    m = bpy.data.materials.get(nm)
    if m:
        return m
    m = bpy.data.materials.new(nm)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if key.startswith('MU_'):
        img_name, col, rough = UNIQUE[k]
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Roughness'].default_value = rough
        p = os.path.join(IMG_SRC, img_name)
        if os.path.exists(p):
            img = bpy.data.images.load(p, check_existing=True)
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.extension = 'EXTEND' if k != 'can_label' else 'REPEAT'
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        else:
            print('WARN missing unique image', p)
        if k == 'can_label':
            bsdf.inputs['Metallic'].default_value = 0.6
        m.diffuse_color = (*col, 1)
        return m
    col, rough, metal = MATS[key][:3]
    bsdf.inputs['Base Color'].default_value = (*col, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*col, 1)
    if key.startswith('glass') or key == 'plastic_clear':
        # bewusst ohne Transmission (teuer in three.js): Alpha-Blend + niedrige Rauheit
        bsdf.inputs['IOR'].default_value = 1.5
        bsdf.inputs['Alpha'].default_value = MATS[key][3] if len(MATS[key]) > 3 else 0.45
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if key.startswith('plastic_bag') or key.startswith('paper') or key.startswith('leaf') or key in ('fabric_white',):
        m.use_backface_culling = False
    else:
        m.use_backface_culling = True
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
        if isinstance(mat, (list, tuple)):
            for k in mat:
                me.materials.append(get_mat(k))
        else:
            me.materials.append(get_mat(mat))
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


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    ob.location = loc
    ob.rotation_euler = Euler([radians(a) for a in rot], 'XYZ')
    if scale:
        ob.scale = scale if hasattr(scale, '__len__') else (scale,) * 3
    return apply_tf(ob)


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


def mod_bevel(ob, w=0.004, seg=2, angle=35, only_vert=False, clamp=True):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = w
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = radians(angle)
    m.use_clamp_overlap = clamp
    m.affect = 'VERTICES' if only_vert else 'EDGES'
    m.miter_outer = 'MITER_ARC'
    return m


def mod_subsurf(ob, lv=1):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = lv
    m.render_levels = lv
    return m


def mod_solidify(ob, t, off=-1.0, even=True, rim=True, mat_off=0, mat_off_rim=0):
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = t
    m.offset = off
    m.use_even_offset = even
    m.use_rim = rim
    m.material_offset = mat_off
    m.material_offset_rim = mat_off_rim
    return m


def mod_weld(ob, d=0.0005):
    m = ob.modifiers.new('weld', 'WELD')
    m.merge_threshold = d
    return m


def mod_decimate(ob, ratio):
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.ratio = ratio
    return m


def mod_remesh(ob, voxel):
    m = ob.modifiers.new('rem', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = voxel
    m.adaptivity = 0.0
    return m


def mod_smooth(ob, factor=0.5, rep=5):
    m = ob.modifiers.new('sm', 'SMOOTH')
    m.factor = factor
    m.iterations = rep
    return m


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        o = objs[0]
    else:
        for o in objs:
            apply_mods(o)
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
    """Delle: verschiebt Vertices in Kugelumgebung entlang -Normale bzw. direction."""
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
def bm_box(sx, sy, sz, cuts=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    return bm


def box(name, sx, sy, sz, mat, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, seg=2, cuts=0):
    ob = mesh_obj(name, bm_box(sx, sy, sz, cuts), mat)
    if bevel:
        mod_bevel(ob, bevel, seg)
        apply_mods(ob)
    place(ob, loc, rot)
    return ob


def bm_grid_box(sx, sy, sz, step):
    """Box mit gleichmäßigem Raster (für Deformationen)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    # je Achse separat schneiden
    for axis, size in ((0, sx), (1, sy), (2, sz)):
        n = max(0, int(round(size / step)) - 1)
        if n <= 0:
            continue
        for i in range(1, n + 1):
            t = -size / 2 + size * i / (n + 1)
            co = Vector((0, 0, 0))
            co[axis] = t
            no = Vector((0, 0, 0))
            no[axis] = 1
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
    return bm


def cyl(name, r, h, mat, seg=16, loc=(0, 0, 0), rot=(0, 0, 0), r2=None, caps=True, bevel=0.0, rings=0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=h)
    if rings:
        side = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
        bmesh.ops.subdivide_edges(bm, edges=side, cuts=rings)
    ob = mesh_obj(name, bm, mat)
    if bevel:
        mod_bevel(ob, bevel, 2)
        apply_mods(ob)
    place(ob, loc, rot)
    return ob


def lathe(name, profile, mat, seg=24, loc=(0, 0, 0), rot=(0, 0, 0), close_top=False, close_bot=False):
    """profile: Liste (r, z) von unten nach oben; um Z gedreht."""
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * pi * i / seg
        ring = []
        for (r, z) in profile:
            ring.append(bm.verts.new((r * cos(a), r * sin(a), z)))
        rings.append(ring)
    n = len(profile)
    for i in range(seg):
        r0, r1 = rings[i], rings[(i + 1) % seg]
        for j in range(n - 1):
            vs = (r0[j], r1[j], r1[j + 1], r0[j + 1])
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if close_bot:
        bot = [r[0] for r in rings]
        if len(set(bot)) > 2:
            bm.faces.new(bot[::-1])
    if close_top:
        top = [r[-1] for r in rings]
        if len(set(top)) > 2:
            bm.faces.new(top)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, mat)
    place(ob, loc, rot)
    return ob


def tube_path(name, pts, radius, mat, sides=8, radii=None, caps=True):
    """Rohr entlang Punkten (Liste Vector), radius konstant oder radii-Liste."""
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
        ring = []
        for k in range(sides):
            a = 2 * pi * k / sides
            ring.append(bm.verts.new(p + (nrm * cos(a) + bi * sin(a)) * r))
        rings.append(ring)
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
    """Glatte Kurve durch Kontrollpunkte (Catmull-Rom)."""
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


def bm_poly_slab(outline, thick, z0=0.0):
    """Extrudierte Platte aus 2D-Umriss (Liste (x,y)), Unterkante z0."""
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


# ---------- Simulation (Tuch)
def collider_plane(z=0.0, size=6.0, friction=8.0):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    ob = mesh_obj('_ground', bm)
    ob.location.z = z
    m = ob.modifiers.new('Collision', 'COLLISION')
    ob.collision.thickness_outer = 0.002
    ob.collision.cloth_friction = friction
    return ob


def make_collider(ob, thick=0.003, friction=5.0):
    ob.modifiers.new('Collision', 'COLLISION')
    ob.collision.thickness_outer = thick
    ob.collision.cloth_friction = friction
    return ob


def cloth_sim(ob, frames=60, mass=0.3, tension=15, bending=0.5, pressure=0.0, self_coll=True, quality=6,
              shrink=0.0, dist=0.004, air=1.0, pin_group=None, gravity=None, internal=False):
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
    if pressure:
        s.use_pressure = True
        s.uniform_pressure_force = pressure
    if internal:
        s.use_internal_springs = True
    if gravity is not None:
        s.effector_weights.gravity = gravity
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


# ---------- UV (Weltmeter, Box-Projektion), Glättung, Vertex-AO
def box_uv(ob, rot90=False, seed=0, skip_mu=True, scale=1.0):
    me = ob.data
    uv = me.uv_layers.get('UVMap') or (me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap'))
    uv.name = 'UVMap'
    rnd = random.Random(seed)
    ox, oy = rnd.uniform(0, 8), rnd.uniform(0, 8)
    mats = me.materials
    for p in me.polygons:
        if skip_mu and len(mats) and p.material_index < len(mats) and mats[p.material_index] \
                and mats[p.material_index].name.startswith('MU_'):
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
            if rot90:
                u, v = v, u
            uv.data[li].uv = (u * scale + ox, v * scale + oy)
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
        z = 1 - (i + 0.5) / n  # Hemisphäre
        r = sqrt(max(0, 1 - z * z))
        a = ga * i
        out.append(Vector((r * cos(a), r * sin(a), z)))
    return out


def bake_vcol(ob, rays=20, dist=0.18, strength=0.8, grime=0.18, ground=True, seed=0, floor_dirt=0.25,
              tint=(1.0, 0.93, 0.82), min_val=0.32, wet=None):
    """Gebackene Umgebungsverdeckung + Schmutzflecken + Bodenschmutz als lineare Vertexfarbe (COLOR_0)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    dirs = fib_dirs(rays)
    off = Vector((seed * 3.3, seed * 1.7, seed * 5.1))
    zmin = min(v.co.z for v in me.vertices) if len(me.vertices) else 0
    zmax = max(v.co.z for v in me.vertices) if len(me.vertices) else 1
    hgt = max(zmax - zmin, 1e-3)
    cols = []
    for v in me.vertices:
        n = Vector(v.normal)
        if n.length < 0.5:
            n = Vector((0, 0, 1))
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = v.co + n * 0.0015
        occ = 0.0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            hit = bvh.ray_cast(o, w, dist)
            if hit[0] is not None:
                occ += 1.0 - (hit[3] / dist) * 0.6
            elif ground and w.z < -1e-4:
                tt = -(o.z - zmin) / w.z
                if 0 < tt < dist:
                    occ += 1.0 - (tt / dist) * 0.6
        ao = 1.0 - occ / len(dirs)
        val = 1.0 - strength * (1.0 - ao)
        # Bodenschmutz: unten dunkler/bräunlicher
        hz = (v.co.z - zmin)
        fd = floor_dirt * math.exp(-hz / 0.05) if hgt > 0.08 else 0.0
        g = fbm(v.co * 4.0 + off, 3) * 0.5 + 0.5
        g2 = fbm(v.co * 13.0 + off * 2, 2) * 0.5 + 0.5
        gm = max(0.0, (g - 0.45)) * 2.0 * grime + (g2 - 0.5) * grime * 0.4
        d = min(0.9, max(0.0, gm + fd))
        c = [val * (1 - d * (1 - tint[i]) - d * 0.35) for i in range(3)]
        cols.append([max(min_val * (0.9 + 0.1 * i), min(1.0, ci)) for i, ci in enumerate(c)])
    attr = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(cols):
        attr.data[i].color = (c[0], c[1], c[2], 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.find('Color')
    except Exception:
        pass
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ----------------------------------------------------------------------------------------------
# Registry
PROPS = {}


def prop(name, surface, room, notes, **kw):
    def deco(fn):
        PROPS[name] = dict(fn=fn, surface=surface, room=room, notes=notes, **kw)
        return fn
    return deco


def finalize(ob, name, surface, uv_rot90=False, ao=None, keep_uv=False, smooth_angle=None, seed=0):
    """Ursprung Boden mittig, UV, Glättung, Vertex-AO, Property."""
    apply_mods(ob)
    apply_tf(ob)
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    me.transform(Matrix.Translation(-c))
    if not keep_uv:
        box_uv(ob, rot90=uv_rot90, seed=seed)
    else:
        if not me.uv_layers:
            box_uv(ob, rot90=uv_rot90, seed=seed)
    if smooth_angle is not None:
        smooth(ob, smooth_angle)
    # UV-Layer aufräumen
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    bake_vcol(ob, **(ao or {}), seed=seed)
    ob.name = name
    me.name = name
    ob['surface'] = surface
    return ob


# ==============================================================================================
# Prop-Definitionen liegen in props_clutter_def_*.py (gleiches Verzeichnis), werden in diesen Namespace geladen.
HERE = os.path.dirname(os.path.abspath(__file__))
for _f in sorted(os.listdir(HERE)):
    if _f.startswith('props_clutter_def_') and _f.endswith('.py'):
        exec(compile(open(os.path.join(HERE, _f)).read(), _f, 'exec'), globals())


# ==============================================================================================
def clean_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def export_glb(ob, path):
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        if o is not None and o.name in bpy.context.view_layer.objects:
            o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_extras=True, export_yup=True, export_normals=True, export_tangents=False,
                              export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=82,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_animations=False, export_skins=False, export_morph=False,
                              export_cameras=False, export_lights=False)


def dims_of(ob):
    me = ob.data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    return [round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3), round(max(zs) - min(zs), 3)]


def main():
    only = arg('--only')
    names = list(PROPS.keys()) if not only or only is True else [n for n in only.split(',') if n]
    clean_scene()
    os.makedirs(OUT_DIR, exist_ok=True)
    cat = []
    if os.path.exists(CATALOG):
        try:
            cat = json.load(open(CATALOG))
        except Exception:
            cat = []
    catd = {c['name']: c for c in cat}
    for name in names:
        info = PROPS[name]
        t0 = time.time()
        random.seed(name)
        ob = info['fn']()
        # in eigene Collection
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        col.objects.link(ob)
        # Hilfsobjekte entsorgen
        for o in list(work_coll().objects):
            remove(o)
        mats = sorted({m.name for m in ob.data.materials if m})
        tris = tri_count(ob)
        if not arg('--no-export'):
            export_glb(ob, os.path.join(OUT_DIR, name + '.glb'))
        sz = os.path.getsize(os.path.join(OUT_DIR, name + '.glb')) if os.path.exists(os.path.join(OUT_DIR, name + '.glb')) else 0
        catd[name] = dict(name=name, dims=dims_of(ob), surface=info['surface'], materials=mats,
                          roomHint=info['room'], notes=info['notes'], tris=tris, set='clutter')
        print(f'PROP {name:28s} tris={tris:6d} dims={dims_of(ob)} kb={sz//1024} t={time.time()-t0:.1f}s')
    order = list(PROPS.keys())
    cat = sorted(catd.values(), key=lambda c: order.index(c['name']) if c['name'] in order else 999)
    cat = [c for c in cat if c['name'] in PROPS]
    if not arg('--no-export'):
        json.dump(cat, open(CATALOG, 'w'), indent=1, ensure_ascii=False)
    if not arg('--no-blend'):
        if WORK and WORK.name in bpy.data.collections:
            bpy.data.collections.remove(WORK)
        bp = arg('--blend', BLEND_OUT)
        os.makedirs(os.path.dirname(bp), exist_ok=True)
        if only and only is not True and os.path.exists(bp):
            # Teilbau: in bestehende Arbeitsdatei mergen
            bp_tmp = bp.replace('.blend', '_part.blend')
            bpy.ops.wm.save_as_mainfile(filepath=bp_tmp, compress=True)
            print('SAVED partial', bp_tmp)
        else:
            bpy.ops.wm.save_as_mainfile(filepath=bp, compress=True)
            print('SAVED', bp)


if __name__ == '__main__':
    main()
