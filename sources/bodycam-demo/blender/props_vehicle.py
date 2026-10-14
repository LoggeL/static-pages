# UNIT 27 · Bodycam-Tech-Demo — PROPS-STREIFENWAGEN ("vehicle")
# Prozeduraler US-Polizei-SUV (generisch, ohne Marken) + rostige Zivil-Limousine.
#
#   blender -b -P props_vehicle.py -- [--only police_suv,sedan_rusty] [--no-export] [--no-blend] [--tex 4096]
#
# Ergebnis: public/bodycam-demo/models/props/<name>.glb  (Wurzel-Empty <name> mit Kind-Objekten)
#           sources/bodycam-demo/blender/props_vehicle.json (Katalogfragment)
#           $WORK/blend/props_vehicle.blend (alle Props, je Collection <name>)
# Konventionen (CONTRACT.md): Meter, Ursprung Boden mittig, Vorderseite Blender -Y, Fahrerseite = +X.
# Karosserie: Loft aus Querschnitten (Superellipsen-Kappen vorn/hinten), Fenster/Leuchten/Grill per
# Topologie + bisect, Radhäuser per Boolean. Lack = Unikat MU_<car>_body mit Atlas-UV; Textur (Lackierung,
# Fugen, Schmutz, Regentropfen) malt props_vehicle_paint.py (System-python3 mit PIL) aus einer
# Positions-Rasterung des Atlas. Alle anderen Materialien M_<id> (UV Weltmeter) bzw. ME_<name> (emissiv).
# COLOR_0 = gebackene AO (linear, multiplikativ). Objekt-Property "surface".
import bpy, bmesh, math, random, json, os, sys, time, subprocess
from mathutils import Vector, Matrix, Euler, noise
from mathutils.bvhtree import BVHTree
from math import pi, sin, cos, radians, sqrt
import numpy as np

REPO = '/Users/logge/Documents/Projects/static-pages'
WORK = '/Users/logge/Documents/Projects/bodycam-work'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = REPO + '/public/bodycam-demo/models/props'
CATALOG = HERE + '/props_vehicle.json'
IMG_SRC = HERE + '/props_vehicle_img'
PAINTER = HERE + '/props_vehicle_paint.py'
WORKDIR = WORK + '/props_vehicle/tex'
BLEND_OUT = WORK + '/blend/props_vehicle.blend'

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return default


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def lerp(a, b, t):
    return a + (b - a) * t


def lerp2(p, q, t):
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------------------------
# Materialien: key -> (Farbe linear, roughness, metallic, extra)
MATS = {
    'glass': ((0.035, 0.040, 0.042), 0.04, 0.0, dict(alpha=0.42, transmission=1.0)),
    'glass_dirty': ((0.10, 0.10, 0.09), 0.35, 0.0, dict(alpha=0.55, transmission=0.8)),
    'plastic_black': ((0.018, 0.018, 0.019), 0.62, 0.0, {}),
    'plastic_black_gloss': ((0.012, 0.012, 0.013), 0.22, 0.0, {}),
    'plastic_grey_dark': ((0.035, 0.036, 0.038), 0.6, 0.0, {}),
    'rubber_seal': ((0.012, 0.012, 0.012), 0.55, 0.0, {}),
    'rubber_black': ((0.02, 0.02, 0.02), 0.8, 0.0, {}),
    'tire_rubber': ((0.022, 0.022, 0.022), 0.62, 0.0, {}),
    'underbody': ((0.025, 0.022, 0.02), 0.85, 0.0, {}),
    'wheelwell': ((0.02, 0.018, 0.017), 0.9, 0.0, {}),
    'steel_wheel_black': ((0.02, 0.02, 0.021), 0.4, 0.6, {}),
    'steel_wheel_rusty': ((0.09, 0.05, 0.03), 0.7, 0.4, {}),
    'chrome': ((0.75, 0.75, 0.75), 0.12, 1.0, {}),
    'chrome_dull': ((0.45, 0.45, 0.45), 0.35, 1.0, {}),
    'aluminium': ((0.55, 0.56, 0.57), 0.35, 1.0, {}),
    'lamp_housing': ((0.30, 0.31, 0.32), 0.18, 1.0, {}),
    'lamp_housing_dark': ((0.05, 0.05, 0.055), 0.25, 0.8, {}),
    'mirror': ((0.85, 0.86, 0.87), 0.03, 1.0, {}),
    'lens_amber': ((0.55, 0.20, 0.02), 0.15, 0.0, {}),
    'lens_red': ((0.30, 0.01, 0.01), 0.18, 0.0, {}),
    'lens_yellowed': ((0.55, 0.45, 0.22), 0.45, 0.0, dict(alpha=0.75)),
    'reflector_red': ((0.35, 0.01, 0.01), 0.3, 0.0, {}),
    'metal_powdercoat': ((0.018, 0.018, 0.019), 0.55, 0.3, {}),
    'metal_rusty': ((0.22, 0.11, 0.06), 0.82, 0.55, {}),       # TEXTURES-ID
    'interior_plastic': ((0.028, 0.028, 0.03), 0.7, 0.0, {}),
    'headliner': ((0.10, 0.098, 0.092), 0.95, 0.0, {}),
    'fabric_seat': ((0.022, 0.022, 0.024), 0.92, 0.0, {}),
    'fabric_seat_beige': ((0.22, 0.17, 0.12), 0.95, 0.0, {}),
    'fabric_sofa_dirty': ((0.16, 0.14, 0.12), 0.95, 0.0, {}),  # TEXTURES-ID (Limousinen-Sitze)
    'vinyl_seat_black': ((0.015, 0.015, 0.016), 0.45, 0.0, {}),
    'plastic_clear': ((0.6, 0.62, 0.62), 0.08, 0.0, dict(alpha=0.25, transmission=1.0)),
    'carpet_stained': ((0.05, 0.045, 0.04), 0.95, 0.0, {}),    # TEXTURES-ID
    'cardboard': ((0.36, 0.24, 0.13), 0.88, 0.0, {}),          # TEXTURES-ID
    'paper_white': ((0.6, 0.58, 0.52), 0.9, 0.0, {}),
    'cable_black': ((0.01, 0.01, 0.01), 0.5, 0.0, {}),
}
# Emissive: key -> (Farbe, Stärke, Basisfarbe)
EMIS = {
    'headlight': ((1.0, 0.95, 0.88), 6.0, (0.8, 0.8, 0.8)),
    'taillight': ((1.0, 0.02, 0.01), 2.5, (0.35, 0.01, 0.01)),
    'brakelight': ((1.0, 0.02, 0.01), 4.0, (0.35, 0.01, 0.01)),
    'spotlight': ((1.0, 0.96, 0.9), 1.0, (0.7, 0.7, 0.7)),
    'lightbar_red': ((1.0, 0.03, 0.02), 12.0, (0.25, 0.02, 0.02)),
    'lightbar_blue': ((0.02, 0.12, 1.0), 14.0, (0.02, 0.04, 0.25)),
    'lightbar_white': ((1.0, 1.0, 1.0), 0.0, (0.55, 0.56, 0.58)),
    'screen_mdt': ((1.0, 1.0, 1.0), 1.0, (1.0, 1.0, 1.0)),
}
UNIQUE_TEX = {}  # MU_name -> dict(albedo=path, normal=path, orm=path, rough=..., coat=...)


def mat(key):
    """key: 'paint'-artige MU_ (über UNIQUE_TEX), 'E:<name>' emissiv, sonst M_<key>."""
    if key.startswith('E:'):
        k = key[2:]
        nm = 'ME_' + k
    elif key.startswith('MU_'):
        k = key
        nm = key
    else:
        k = key
        nm = 'M_' + key
    m = bpy.data.materials.get(nm)
    if m:
        return m
    m = bpy.data.materials.new(nm)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if key.startswith('E:'):
        col, strength, base = EMIS[k]
        bsdf.inputs['Base Color'].default_value = (*base, 1)
        bsdf.inputs['Emission Color'].default_value = (*col, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
        bsdf.inputs['Roughness'].default_value = 0.3
        m.diffuse_color = (*col, 1)
        if k == 'screen_mdt':
            p = os.path.join(IMG_SRC, 'mdt.jpg')
            img = bpy.data.images.load(p, check_existing=True)
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.extension = 'EXTEND'
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 0.6
        return m
    if key.startswith('MU_'):
        info = UNIQUE_TEX[k]
        bsdf.inputs['Roughness'].default_value = info.get('rough', 0.3)
        bsdf.inputs['Metallic'].default_value = 0.0
        if info.get('coat'):
            bsdf.inputs['Coat Weight'].default_value = info['coat']
            bsdf.inputs['Coat Roughness'].default_value = info.get('coat_rough', 0.05)
        if info.get('albedo'):
            img = bpy.data.images.load(info['albedo'], check_existing=True)
            tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
            tex.extension = info.get('extension', 'REPEAT')
            tex.location = (-600, 300)
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            if info.get('alpha'):
                nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
                m.surface_render_method = 'DITHERED'
        if info.get('orm'):
            img = bpy.data.images.load(info['orm'], check_existing=True)
            img.colorspace_settings.name = 'Non-Color'
            tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
            tex.location = (-600, 0)
            sep = nt.nodes.new('ShaderNodeSeparateColor'); sep.location = (-300, 0)
            nt.links.new(tex.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
            nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        if info.get('normal'):
            img = bpy.data.images.load(info['normal'], check_existing=True)
            img.colorspace_settings.name = 'Non-Color'
            tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
            tex.location = (-600, -300)
            nm_node = nt.nodes.new('ShaderNodeNormalMap'); nm_node.location = (-300, -300)
            nm_node.inputs['Strength'].default_value = 1.0
            nt.links.new(tex.outputs['Color'], nm_node.inputs['Color'])
            nt.links.new(nm_node.outputs['Normal'], bsdf.inputs['Normal'])
        m.diffuse_color = (*info.get('col', (0.5, 0.5, 0.5)), 1)
        return m
    col, rough, metal, extra = MATS[k]
    bsdf.inputs['Base Color'].default_value = (*col, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*col, 1)
    if 'alpha' in extra:
        bsdf.inputs['Alpha'].default_value = extra['alpha']
        if extra.get('transmission'):
            bsdf.inputs['Transmission Weight'].default_value = extra['transmission']
            bsdf.inputs['IOR'].default_value = 1.5
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
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


def new_obj(name, me):
    ob = bpy.data.objects.new(name, me)
    work_coll().objects.link(ob)
    return ob


def bm_to_obj(bm, name, mats=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = new_obj(name, me)
    if mats:
        for m in mats:
            me.materials.append(m)
    return ob


def set_mat_all(ob, m):
    me = ob.data
    me.materials.clear()
    me.materials.append(m)
    for p in me.polygons:
        p.material_index = 0
    return ob


def mat_index(me, m):
    for i, mm in enumerate(me.materials):
        if mm == m:
            return i
    me.materials.append(m)
    return len(me.materials) - 1


def bm_mat_index(me_mats, m):
    """me_mats: Python-Liste der Materialien (für bmesh-Phasen)."""
    if m in me_mats:
        return me_mats.index(m)
    me_mats.append(m)
    return len(me_mats) - 1


def apply_tf(ob):
    me = ob.data
    me.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def remove(ob):
    me = ob.data if ob.type == 'MESH' else None
    bpy.data.objects.remove(ob, do_unlink=True)
    if me and me.users == 0:
        bpy.data.meshes.remove(me)


def join(obs, name):
    obs = [o for o in obs if o is not None]
    if not obs:
        return None
    for o in obs:
        apply_tf(o)
    base = obs[0]
    if len(obs) > 1:
        bm = bmesh.new()
        mats = []
        for o in obs:
            me = o.data
            tmp = me.copy()
            # Materialindex auf gemeinsame Liste umbiegen
            remap = [bm_mat_index(mats, m) if m else 0 for m in me.materials] or [0]
            for p in tmp.polygons:
                p.material_index = remap[p.material_index] if p.material_index < len(remap) else 0
            bm.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        for o in obs:
            remove(o)
        ob = new_obj(name, me)
    else:
        ob = base
        ob.name = name
        ob.data.name = name
    return ob


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


# ---------- Primitive
def rbox(size, loc=(0, 0, 0), bevel=0.01, segs=2, rot=(0, 0, 0), m=None, name='rbox'):
    """Abgerundeter Quader (Fase/Rundung auf allen Kanten)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    b = min(bevel, min(size) * 0.49)
    if b > 0.0005:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=segs, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    ob = bm_to_obj(bm, name, [m] if m else None)
    ob.rotation_euler = Euler(rot)
    ob.location = Vector(loc)
    apply_tf(ob)
    return ob


def cyl(r, depth, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, m=None, name='cyl', cap=True, r2=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r2 is None else r2, depth=depth)
    if bevel > 0:
        rim = [e for e in bm.edges if len(e.link_faces) == 2 and
               abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
        bmesh.ops.bevel(bm, geom=rim, offset=bevel, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    ob = bm_to_obj(bm, name, [m] if m else None)
    ob.rotation_euler = Euler(rot)
    ob.location = Vector(loc)
    apply_tf(ob)
    return ob


def lathe(profile, segs=48, m=None, name='lathe', closed=False, mats=None, ang0=0.0, ang1=2 * pi):
    """profile: [(x, r)] um die X-Achse gedreht. mats: optionale Materialliste pro Profilsegment-Index."""
    verts, faces = [], []
    n = len(profile)
    full = abs(ang1 - ang0 - 2 * pi) < 1e-6
    rings = segs if full else segs + 1
    for j in range(rings):
        a = ang0 + (ang1 - ang0) * j / segs
        for (x, r) in profile:
            verts.append((x, r * cos(a), r * sin(a)))
    seg_idx = []
    for j in range(segs):
        j2 = (j + 1) % rings
        for i in range(n - 1 + (1 if closed else 0)):
            i2 = (i + 1) % n
            faces.append((j * n + i, j * n + i2, j2 * n + i2, j2 * n + i))
            seg_idx.append(i)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = new_obj(name, me)
    if mats:
        for mm in sorted(set(mats), key=lambda q: mats.index(q)):
            me.materials.append(mm)
        ml = list(me.materials)
        for p, si in zip(me.polygons, seg_idx):
            p.material_index = ml.index(mats[min(si, len(mats) - 1)])
    elif m:
        me.materials.append(m)
    # Normalen nach außen (Profil-Reihenfolge kann variieren)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return ob


def tube_path(pts, r, segs=10, m=None, name='tube', cap=True):
    """Rohr entlang Punktliste (Kreisquerschnitt)."""
    pts = [Vector(p) for p in pts]
    verts, faces = [], []
    n = len(pts)
    prev_side = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == n - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        if prev_side is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            side = t.cross(up).normalized()
        else:
            side = (prev_side - t * prev_side.dot(t)).normalized()
        prev_side = side
        up2 = side.cross(t).normalized()
        for k in range(segs):
            a = 2 * pi * k / segs
            verts.append(tuple(p + (side * cos(a) + up2 * sin(a)) * r))
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append((i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k))
    if cap:
        faces.append(tuple(range(segs - 1, -1, -1)))
        faces.append(tuple((n - 1) * segs + k for k in range(segs)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = new_obj(name, me)
    if m:
        me.materials.append(m)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------- Monotone kubische Interpolation (Fritsch-Carlson)
class Pchip:
    def __init__(self, pts, linear=False):
        pts = sorted(pts)
        self.x = [p[0] for p in pts]
        self.y = [p[1] for p in pts]
        self.linear = linear
        n = len(pts)
        d = [(self.y[i + 1] - self.y[i]) / (self.x[i + 1] - self.x[i]) for i in range(n - 1)]
        m = [0.0] * n
        if n == 2:
            m = [d[0], d[0]]
        else:
            m[0] = d[0]; m[-1] = d[-1]
            for i in range(1, n - 1):
                if d[i - 1] * d[i] <= 0:
                    m[i] = 0.0
                else:
                    m[i] = 2.0 / (1.0 / d[i - 1] + 1.0 / d[i])
        self.m = m

    def __call__(self, x):
        xs = self.x
        if x <= xs[0]:
            return self.y[0]
        if x >= xs[-1]:
            return self.y[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        if self.linear:
            return self.y[i] + (self.y[i + 1] - self.y[i]) * t
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * self.y[i] + (t3 - 2 * t2 + t) * h * self.m[i] +
                (-2 * t3 + 3 * t2) * self.y[i + 1] + (t3 - t2) * h * self.m[i + 1])


def catmull(pts, counts):
    """Zentripetaler Catmull-Rom durch pts; counts[i] Samples im Segment i (ohne Endpunkt). Letzter Punkt angehängt."""
    out = []
    n = len(pts)
    P = [Vector((p[0], p[1])) for p in pts]
    for i in range(n - 1):
        p1, p2 = P[i], P[i + 1]
        p0 = P[i - 1] if i > 0 else p1 * 2 - p2
        p3 = P[i + 2] if i + 2 < n else p2 * 2 - p1
        def tj(ti, a, b):
            return ti + max((b - a).length, 1e-5) ** 0.5
        t0 = 0.0
        t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        for k in range(counts[i]):
            t = t1 + (t2 - t1) * k / counts[i]
            if k == 0:
                out.append((p1.x, p1.y)); continue
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            c = b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1))
            out.append((c.x, c.y))
    out.append((P[-1].x, P[-1].y))
    return out


exec(compile(open(os.path.join(HERE, 'props_vehicle_body.py')).read(), 'props_vehicle_body.py', 'exec'), globals())
exec(compile(open(os.path.join(HERE, 'props_vehicle_parts.py')).read(), 'props_vehicle_parts.py', 'exec'), globals())
exec(compile(open(os.path.join(HERE, 'props_vehicle_cars.py')).read(), 'props_vehicle_cars.py', 'exec'), globals())

if __name__ == '__main__':
    main()
