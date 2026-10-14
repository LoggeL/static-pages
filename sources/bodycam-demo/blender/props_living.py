# UNIT 27 · Bodycam-Tech-Demo — PROPS-WOHNEN ("living")
# Prozedurale, abgenutzte Wohn-/Schlafzimmer-Moebel fuer das verlassene Haus.
#
#   blender -b -P props_living.py -- [--only a,b,c] [--no-export] [--no-blend]
#
# Ergebnis: public/bodycam-demo/models/props/<name>.glb  (je Prop ein Mesh-Objekt <name>)
#           sources/bodycam-demo/blender/props_living.json (Katalogfragment)
#           $WORK/blend/props_living.blend (alle Props, je Collection <name>)
# Konventionen (CONTRACT.md): Meter, Vorderseite Blender -Y, UV in Weltmetern (Box-Projektion) fuer M_<textureId>,
# eingebettete Bilder nur fuer MU_<name>, Emission ME_<name>. COLOR_0 = gebackene AO/Schmutz/Flecken
# (linear, multiplikativ zur Basisfarbe/Textur). Objekt-Properties: surface, anchor.
# anchor: floor   = Ursprung Boden mittig (Standard)
#         wall    = Ursprung an der Wandebene (max Y = 0, Prop haengt nach -Y), unten mittig (min Z = 0)
#         ceiling = Ursprung an der Deckenebene (max Z = 0), mittig; Geometrie haengt nach -Z
import bpy, bmesh, math, random, json, os, sys, time, zlib
from math import pi, sin, cos, radians, sqrt
from mathutils import Vector, Matrix, Euler, noise

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import props_living_lib as L  # noqa: E402

REPO = '/Users/logge/Documents/Projects/static-pages'
WORK = '/Users/logge/Documents/Projects/bodycam-work'
OUT_DIR = REPO + '/public/bodycam-demo/models/props'
CATALOG = REPO + '/sources/bodycam-demo/blender/props_living.json'
IMG_SRC = REPO + '/sources/bodycam-demo/blender/props_living_img'  # verkleinerte Imagegen-Bilder (JPG/PNG)
BLEND_OUT = WORK + '/blend/props_living.blend'

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return default


# ----------------------------------------------------------------------------------------------
# Materialien. key -> (Fallbackfarbe linear, roughness, metallic)
# Keys aus TEXTURE_IDS -> M_<id> (Engine legt Kacheltextur auf). Andere Keys -> M_<key>, reine Faktor-Materialien.
TEXTURE_IDS = {'concrete_floor', 'asphalt_wet', 'grass_dead', 'dirt_mud', 'wood_floor_worn', 'carpet_stained',
               'tile_floor_dirty', 'tile_wall_white', 'wallpaper_peeling', 'plaster_painted_dirty', 'plaster_damaged',
               'ceiling_stained', 'wood_door_painted', 'siding_vinyl_dirty', 'roof_shingles', 'wood_trim_painted',
               'metal_rusty', 'fabric_sofa_dirty', 'mattress_stained', 'cardboard', 'laminate_counter',
               'cabinet_wood', 'brick_red', 'wood_planks_raw'}
MATS = {
    # Textur-IDs (Fallbackfarben ~ Mittelwert der Textur)
    'fabric_sofa_dirty': ((0.16, 0.105, 0.055), 0.97, 0.0),
    'cabinet_wood': ((0.12, 0.065, 0.032), 0.62, 0.0),
    'wood_trim_painted': ((0.52, 0.48, 0.38), 0.6, 0.0),
    'wood_planks_raw': ((0.30, 0.22, 0.14), 0.85, 0.0),
    'mattress_stained': ((0.52, 0.47, 0.37), 0.95, 0.0),
    'metal_rusty': ((0.20, 0.10, 0.05), 0.8, 0.5),
    'cardboard': ((0.36, 0.24, 0.13), 0.88, 0.0),
    # Faktor-Materialien
    'foam_old': ((0.42, 0.27, 0.07), 0.97, 0.0),
    'fabric_back': ((0.045, 0.04, 0.035), 0.95, 0.0),   # Unterseiten-Gewebe (Cambric)
    'plastic_tv': ((0.03, 0.028, 0.026), 0.42, 0.0),
    'plastic_black': ((0.018, 0.018, 0.018), 0.38, 0.0),
    'plastic_grey': ((0.12, 0.12, 0.115), 0.45, 0.0),
    'plastic_beige': ((0.42, 0.38, 0.30), 0.5, 0.0),
    'rubber_black': ((0.02, 0.02, 0.02), 0.85, 0.0),
    'brass_tarnished': ((0.42, 0.30, 0.13), 0.42, 1.0),
    'steel': ((0.52, 0.52, 0.50), 0.42, 1.0),
    'steel_dark': ((0.16, 0.16, 0.155), 0.55, 1.0),
    'chrome_dirty': ((0.62, 0.62, 0.60), 0.25, 1.0),
    'paint_white_old': ((0.58, 0.56, 0.49), 0.55, 0.0),
    'paint_toybox': ((0.22, 0.36, 0.44), 0.62, 0.0),
    'paper_old': ((0.58, 0.52, 0.38), 0.92, 0.0),
    'book_cover': ((0.10, 0.055, 0.035), 0.75, 0.0),
    'hardboard': ((0.24, 0.15, 0.08), 0.9, 0.0),
    'particleboard': ((0.42, 0.31, 0.18), 0.95, 0.0),
    'plush_brown': ((0.21, 0.12, 0.055), 1.0, 0.0),
    'toy_red': ((0.42, 0.04, 0.025), 0.45, 0.0),
    'toy_yellow': ((0.62, 0.42, 0.04), 0.45, 0.0),
    'toy_blue': ((0.03, 0.10, 0.32), 0.45, 0.0),
    'toy_green': ((0.05, 0.25, 0.06), 0.45, 0.0),
    'cloth_denim': ((0.035, 0.055, 0.10), 0.95, 0.0),
    'cloth_grey': ((0.16, 0.16, 0.155), 0.97, 0.0),
    'cloth_red': ((0.24, 0.035, 0.03), 0.97, 0.0),
    'cloth_white': ((0.55, 0.54, 0.48), 0.95, 0.0),
    'blind_vinyl': ((0.60, 0.57, 0.48), 0.48, 0.0),
    'cord_white': ((0.55, 0.53, 0.46), 0.8, 0.0),
    'cord_black': ((0.02, 0.02, 0.02), 0.6, 0.0),
    'rug_back': ((0.30, 0.26, 0.20), 0.98, 0.0),
    'rug_fringe': ((0.52, 0.47, 0.37), 0.98, 0.0),
    'canvas_back': ((0.45, 0.38, 0.26), 0.95, 0.0),
    'glass_dirty': ((0.75, 0.74, 0.70), 0.3, 0.0),
    'fan_blade': ((0.10, 0.06, 0.03), 0.55, 0.0),
}
# Unikate mit eingebetteter Textur: key -> (Datei in IMG_SRC, Fallbackfarbe, roughness, alpha)
UNIQUE = {
    'crt_screen': ('crt_screen.jpg', (0.03, 0.035, 0.032), 0.18, False),
    'painting': ('painting.jpg', (0.25, 0.20, 0.12), 0.7, False),
    'book_spines': ('book_spines.jpg', (0.20, 0.10, 0.06), 0.8, False),
    'rug_runner': ('rug_runner.jpg', (0.25, 0.10, 0.07), 0.98, False),
    'curtain': ('curtain.jpg', (0.30, 0.25, 0.10), 0.95, False),
    'coffee_rings': ('coffee_rings.png', (0.08, 0.05, 0.03), 0.5, True),
}
# Emissive: key -> (Farbe linear, Staerke)
EMISSIVE = {
    'bulb_warm': ((1.0, 0.62, 0.30), 6.0),
}
DOUBLE_SIDED = {'fabric_sofa_dirty', 'foam_old', 'curtain', 'blind_vinyl', 'rug_fringe', 'cloth_denim', 'cloth_grey',
                'cloth_red', 'cloth_white', 'fabric_back', 'coffee_rings', 'paper_old', 'mattress_stained'}


def M(key):
    if key in UNIQUE:
        nm = 'MU_' + key
    elif key in EMISSIVE:
        nm = 'ME_' + key
    else:
        nm = 'M_' + key
    m = bpy.data.materials.get(nm)
    if m:
        return m
    m = bpy.data.materials.new(nm)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if key in UNIQUE:
        fn, col, rough, alpha = UNIQUE[key]
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Roughness'].default_value = rough
        p = os.path.join(IMG_SRC, fn)
        if os.path.exists(p):
            img = bpy.data.images.load(p, check_existing=True)
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.extension = 'REPEAT' if key in ('curtain',) else 'EXTEND'
            tex.location = (-420, 260)
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            if alpha:
                nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
                try:
                    m.surface_render_method = 'BLENDED'
                except Exception:
                    pass
        else:
            print('WARN missing unique image', p)
        m.diffuse_color = (*col, 1)
    elif key in EMISSIVE:
        col, strength = EMISSIVE[key]
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Roughness'].default_value = 0.3
        bsdf.inputs['Emission Color'].default_value = (*col, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
        m.diffuse_color = (*col, 1)
    else:
        col, rough, metal = MATS[key]
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        m.diffuse_color = (*col, 1)
        if key.startswith('glass'):
            bsdf.inputs['Transmission Weight'].default_value = 1.0
            bsdf.inputs['IOR'].default_value = 1.5
            bsdf.inputs['Alpha'].default_value = 0.45
            try:
                m.surface_render_method = 'BLENDED'
            except Exception:
                pass
    m.use_backface_culling = key not in DOUBLE_SIDED
    m['key'] = key
    return m


# ----------------------------------------------------------------------------------------------
# Bausteine
WOODY = {'cabinet_wood', 'wood_trim_painted', 'wood_planks_raw', 'fan_blade'}


def _uv(bm, mat, grain=None, rot90=None):
    """Weltmeter-Box-UV. Holz: Maserung (Textur vertikal) entlang der laengsten Achse."""
    if mat in UNIQUE:
        return
    if mat in WOODY and grain is None:
        xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
        ext = [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)]
        grain = 'xyz'[max(range(3), key=lambda i: ext[i])]
    if rot90 is None:
        rot90 = mat in WOODY
    L.uv_box(bm, grain=grain, rot90=rot90)


def mk(bm, mat, loc=(0, 0, 0), rot=(0, 0, 0), grain=None, rot90=None, name='p', uv=True):
    if uv:
        _uv(bm, mat, grain, rot90)
    else:
        bm.loops.layers.uv.verify()
    return L.part(bm, M(mat), loc=loc, rot=rot, name=name, uv=None)


def _rows(h, r, step):
    """Sparsame Reihen: Kante, Fasenende, Unterteilung im Flachbereich (fuer Verformung/Vertex-AO)."""
    r = min(r, h * 0.45)
    a, b = -h + r, h - r
    n = max(1, int(math.ceil((b - a) / step))) if b > a else 0
    rows = [-h] + ([a + (b - a) * i / n for i in range(n + 1)] if n else [0.0]) + [h]
    out = []
    for x in rows:
        if not out or x - out[-1] > 1e-5:
            out.append(x)
    return out


def rb(sx, sy, sz, r=0.004, step=0.3):
    """Abgerundete Box mit wenigen Reihen (Fase in 2 Segmenten). Weighted Normals im finish() halten Flaechen plan."""
    r = min(r, min(sx, sy, sz) * 0.45)
    return L.rbox(sx, sy, sz, r=r, rows=[_rows(sx / 2, r, step), _rows(sy / 2, r, step), _rows(sz / 2, r, step)])


def box(sx, sy, sz, mat, loc=(0, 0, 0), rot=(0, 0, 0), r=0.004, step=0.3, grain=None, fn=None, noise_amp=0.0,
        seed=0.0):
    bm = rb(sx, sy, sz, r=r, step=step)
    if fn:
        L.deform(bm, fn)
    if noise_amp:
        L.noise_disp(bm, noise_amp, 6.0, seed=seed)
    return mk(bm, mat, loc, rot, grain=grain)


def board(x0, x1, y0, y1, z0, z1, mat, r=0.003, step=0.3, grain=None, fn=None, rot=(0, 0, 0), pivot=None):
    """Box ueber Grenzen (Welt), optional um pivot gedreht."""
    ob = box(x1 - x0, y1 - y0, z1 - z0, mat, loc=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), r=r, step=step,
             grain=grain, fn=fn)
    if pivot is not None and any(rot):
        L.transform_obj(ob, rot=rot, pivot=pivot)
    return ob


def cyl(r, h, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, bevel=0.002, r_top=None, rings=1):
    rt = r if r_top is None else r_top
    b = min(bevel, r * 0.4, h * 0.3)
    prof = [(0.0, 0.0), (r - b, 0.0), (r - b * 0.3, b * 0.3), (r, b)]
    for k in range(1, rings):
        t = k / rings
        prof.append((r + (rt - r) * t, b + (h - 2 * b) * t))
    prof += [(rt, h - b), (rt - b * 0.3, h - b * 0.3), (rt - b, h), (0.0, h)]
    bm = L.lathe(prof, segs=segs, cap_bottom=False, cap_top=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return mk(bm, mat, loc, rot)


def lathe_part(profile, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=16):
    bm = L.lathe(profile, segs=segs, cap_bottom=True, cap_top=True)
    return mk(bm, mat, loc, rot)


def tube(pts, radius, mat, sides=8, radii=None, caps=True):
    bm = L.tube(pts, radius, sides=sides, caps=caps, radii=radii)
    return mk(bm, mat)


def catmull(pts, n=6):
    P = [Vector(p) for p in pts]
    P = [P[0]] + P + [P[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return out


def blob(radius, mat, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), amp=0.25, freq=2.0, seed=0.0, subdiv=2):
    bm = L.icoblob(radius, subdiv)
    L.noise_disp(bm, radius * amp, freq / radius, seed=seed)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    bm.normal_update()
    return mk(bm, mat, loc, rot)


def puff(bm, s, bx, by, bz):
    """Kissen-Bauch: jede Seite waelbt sich zur Mitte hin nach aussen."""
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    for v in bm.verts:
        x, y, z = v.co
        fx = max(0.0, 1 - (x / hx) ** 2)
        fy = max(0.0, 1 - (y / hy) ** 2)
        fz = max(0.0, 1 - (z / hz) ** 2)
        v.co.x += math.copysign(bx * fy * fz, x) * min(1, abs(x) / hx * 1.5)
        v.co.y += math.copysign(by * fx * fz, y) * min(1, abs(y) / hy * 1.5)
        v.co.z += math.copysign(bz * fx * fy, z) * min(1, abs(z) / hz * 1.5)
    bm.normal_update()


def wrinkle(bm, amp, freq, seed, mask=None):
    off = Vector((seed * 3.1, seed * 1.3, seed * 2.7))
    bm.normal_update()
    for v in bm.verts:
        w = 1.0 if mask is None else mask(v.co)
        if w <= 0:
            continue
        p = v.co * freq + off
        # gerichtete Falten (gestreckt) + Rauschen
        n1 = noise.noise(Vector((p.x * 0.35, p.y * 1.6, p.z * 0.6)))
        n2 = noise.fractal(p, 0.5, 2.0, 3)
        v.co += v.normal * (n1 * 0.6 + n2 * 0.4) * amp * w
    bm.normal_update()


def tear(bm, center, radius, seed=0, face_dir=(0, 0, 1), lift=0.012, jag=0.45):
    """Reisst ein unregelmaessiges Loch in die Flaechen mit Normale ~face_dir; Raender wellen sich auf."""
    c = Vector(center)
    fd = Vector(face_dir).normalized()
    bm.normal_update()
    off = Vector((seed * 5.3, seed * 2.9, seed * 1.1))
    kill = []
    for f in bm.faces:
        if f.normal.dot(fd) < 0.5:
            continue
        p = f.calc_center_median()
        d = p - c
        d -= fd * d.dot(fd)
        ang = math.atan2(d.y, d.x) if abs(fd.z) > 0.5 else math.atan2(d.z, d.x)
        rr = radius * (1 + jag * noise.noise(Vector((cos(ang) * 1.7, sin(ang) * 1.7, seed)) + off * 0.1)
                       + 0.25 * sin(ang * 3 + seed))
        if d.length < rr:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bnd = [v for v in bm.verts if v.is_boundary]
    for v in bnd:
        d = v.co - c
        d -= fd * d.dot(fd)
        k = 0.5 + 0.5 * noise.noise(v.co * 40 + off)
        v.co += fd * lift * k + d.normalized() * lift * 0.4 * k
    bm.normal_update()
    return bnd


# ----------------------------------------------------------------------------------------------
# Registry + Finalisierung
PROPS = {}


def prop(name, surface, room, notes, anchor='floor', **kw):
    def deco(fn):
        PROPS[name] = dict(fn=fn, surface=surface, room=room, notes=notes, anchor=anchor, **kw)
        return fn
    return deco


def finish(name, parts, anchor='floor', grime=None, center_xy=False):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    parts = [p for p in parts if p is not None]
    ob = L.join(name, parts, col)
    me = ob.data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    if anchor == 'floor':
        off = Vector(((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2) if center_xy else (0, 0)) + (-min(zs),))
    elif anchor == 'wall':
        off = Vector((-(min(xs) + max(xs)) / 2, -max(ys), -min(zs)))
    elif anchor == 'ceiling':
        off = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -max(zs)))
    me.transform(Matrix.Translation(off))
    me.update()
    # UV-Layer vereinheitlichen
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'
        me.uv_layers[0].active_render = True
        me.uv_layers.active_index = 0
    # leere Materialslots (vom leeren Join-Ziel) entfernen
    for i in reversed(range(len(me.materials))):
        if me.materials[i] is None and not any(p.material_index == i for p in me.polygons):
            idx = [p.material_index for p in me.polygons]
            me.materials.pop(index=i)
            for p, k in zip(me.polygons, idx):
                p.material_index = k - 1 if k > i else k
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=radians(52))
    except Exception:
        pass
    # Flaechengewichtete Normalen: grosse plane Flaechen bleiben plan, Fasen weich (exportiert als Custom Normals)
    wn = ob.modifiers.new('WN', 'WEIGHTED_NORMAL')
    wn.mode = 'FACE_AREA'
    wn.weight = 50
    wn.keep_sharp = True
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=wn.name)
    g = dict(floor=(anchor == 'floor'), ao_dist=0.2, ao_strength=0.6, dirt=0.22, dirt_freq=3.0, floor_dirt=0.18,
             rays=24, seed=zlib.crc32(name.encode()) % 997)
    if anchor == 'ceiling':
        g.update(floor=False, ceiling=0.0, floor_dirt=0.0)
    if grime:
        g.update(grime)
    L.bake_grime([ob], **g)
    ob['surface'] = PROPS[name]['surface'] if name in PROPS else 'wood'
    ob['anchor'] = anchor
    me.name = name
    return ob


def stain(c, r, mul, ring=False):
    return (tuple(c), r, tuple(mul), 'ring') if ring else (tuple(c), r, tuple(mul))


STAIN_DARK = (0.55, 0.45, 0.33)
STAIN_YEL = (0.85, 0.70, 0.45)
STAIN_WATER = (0.72, 0.64, 0.52)

# ==============================================================================================
# Prop-Definitionen
exec(compile(open(os.path.join(HERE, 'props_living_defs.py')).read(), 'props_living_defs.py', 'exec'), globals())


# ==============================================================================================
def clean_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def export_glb(ob, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_extras=True, export_yup=True, export_normals=True, export_tangents=False,
                              export_materials='EXPORT', export_image_format='AUTO',
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
        L._PARTS.clear()
        ob = info['fn']()
        # nicht verwendete Hilfsteile entsorgen
        for o in L._PARTS:
            try:
                if o.name in bpy.data.objects and o != ob:
                    bpy.data.objects.remove(o, do_unlink=True)
            except ReferenceError:
                pass
        L._PARTS.clear()
        mats = sorted({m.name for m in ob.data.materials if m})
        ob.data.calc_loop_triangles()
        tris = len(ob.data.loop_triangles)
        path = os.path.join(OUT_DIR, name + '.glb')
        if not arg('--no-export'):
            export_glb(ob, path)
        sz = os.path.getsize(path) if os.path.exists(path) else 0
        e = dict(name=name, dims=dims_of(ob), surface=info['surface'], materials=mats, roomHint=info['room'],
                 notes=info['notes'], anchor=info['anchor'], tris=tris, set='living')
        for k in ('lightOffset', 'lightColor', 'variantOf'):
            if k in info:
                e[k] = info[k]
        catd[name] = e
        print(f'PROP {name:24s} tris={tris:6d} dims={e["dims"]} kb={sz // 1024} t={time.time() - t0:.1f}s')
    order = list(PROPS.keys())
    cat = sorted([c for c in catd.values() if c['name'] in PROPS], key=lambda c: order.index(c['name']))
    if not arg('--no-export'):
        json.dump(cat, open(CATALOG, 'w'), indent=1, ensure_ascii=False)
    if not arg('--no-blend'):
        bp = arg('--blend', BLEND_OUT)
        os.makedirs(os.path.dirname(bp), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=bp, compress=True)
        print('SAVED', bp)


main()
