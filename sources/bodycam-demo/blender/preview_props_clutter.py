# Cycles-Vorschau für props_clutter.blend
#   blender -b <props_clutter.blend> -P preview_props_clutter.py -- --mode sheet|scene [--only a,b] [--out prefix] [--samples N]
# sheet: je Prop ein Einzelbild (3/4-Ansicht, auto-gerahmt) -> <out>_<name>.png, danach Kontaktbogen mit PIL (extern)
# scene: alle (oder --only) Props in einer Raumecke mit Schummerlicht
import bpy, sys, os, math, json
from mathutils import Vector, Matrix
from math import radians

REPO = '/Users/logge/Documents/Projects/static-pages'
TEX = REPO + '/public/bodycam-demo/textures'
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(n, d=None):
    if n in argv:
        i = argv.index(n)
        return argv[i + 1] if i + 1 < len(argv) else True
    return d


MODE = arg('--mode', 'sheet')
OUT = arg('--out', '/tmp/pc')
SAMPLES = int(arg('--samples', 48))
ONLY = arg('--only')
RES = int(arg('--res', 512))

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print('GPU fail', e)
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.film_transparent = False

try:
    index = json.load(open(TEX + '/index.json'))
except Exception:
    index = {}


def tex_path(tid, m):
    p = f'{TEX}/{tid}/{m}.jpg'
    return p if os.path.exists(p) else None


def prep_material(mat):
    """Wie die Engine: Basisfarbe (bzw. Kacheltextur in Weltmetern) × Vertexfarbe COLOR_0."""
    if mat.get('_prev'):
        return
    mat['_prev'] = 1
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if not bsdf:
        return
    nm = mat.name
    col_src = None
    if nm.startswith('M_'):
        tid = nm[2:]
        alb = tex_path(tid, 'albedo')
        if alb:
            tile = index.get(tid, {}).get('tileMeters', 2.0)
            uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
            mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
            nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
            ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(alb, check_existing=True)
            nt.links.new(mp.outputs['Vector'], ti.inputs['Vector'])
            col_src = ti.outputs['Color']
            nrm = tex_path(tid, 'normal')
            if nrm:
                tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(nrm, check_existing=True)
                tn.image.colorspace_settings.name = 'Non-Color'
                nt.links.new(mp.outputs['Vector'], tn.inputs['Vector'])
                nm_ = nt.nodes.new('ShaderNodeNormalMap')
                nt.links.new(tn.outputs['Color'], nm_.inputs['Color'])
                nt.links.new(nm_.outputs['Normal'], bsdf.inputs['Normal'])
            orm = tex_path(tid, 'orm')
            if orm:
                to = nt.nodes.new('ShaderNodeTexImage'); to.image = bpy.data.images.load(orm, check_existing=True)
                to.image.colorspace_settings.name = 'Non-Color'
                nt.links.new(mp.outputs['Vector'], to.inputs['Vector'])
                sp = nt.nodes.new('ShaderNodeSeparateColor')
                nt.links.new(to.outputs['Color'], sp.inputs['Color'])
                nt.links.new(sp.outputs['Green'], bsdf.inputs['Roughness'])
                nt.links.new(sp.outputs['Blue'], bsdf.inputs['Metallic'])
    if col_src is None:
        lk = bsdf.inputs['Base Color'].links
        if lk:
            col_src = lk[0].from_socket
    attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    if col_src is not None:
        nt.links.new(col_src, mix.inputs['A'])
    else:
        mix.inputs['A'].default_value = bsdf.inputs['Base Color'].default_value
    nt.links.new(attr.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])


props = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('_')]
if ONLY:
    want = ONLY.split(',')
    props = [o for o in props if o.name in want]
for o in props:
    for m in o.data.materials:
        if m:
            prep_material(m)

# Boden + Wände
def add_plane(name, size, loc, rot, mat):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    p = bpy.context.active_object
    p.name = name
    p.data.materials.append(mat)
    # Welt-UV
    uv = p.data.uv_layers.active
    for lp in p.data.loops:
        co = p.matrix_world @ p.data.vertices[lp.vertex_index].co
        if abs(rot[0]) < 0.01:
            uv.data[lp.index].uv = (co.x, co.y)
        else:
            uv.data[lp.index].uv = (co.x + co.y, co.z)
    return p


floor_m = bpy.data.materials.new('_floor'); floor_m.use_nodes = True
fb = floor_m.node_tree.nodes['Principled BSDF']
fb.inputs['Base Color'].default_value = (0.2, 0.19, 0.17, 1); fb.inputs['Roughness'].default_value = 0.85
alb = tex_path('concrete_floor', 'albedo')
if alb:
    nt = floor_m.node_tree
    ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(alb)
    uvn = nt.nodes.new('ShaderNodeUVMap'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.5, 0.5, 1)
    nt.links.new(uvn.outputs['UV'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], ti.inputs['Vector'])
    nt.links.new(ti.outputs['Color'], fb.inputs['Base Color'])
wall_m = bpy.data.materials.new('_wall'); wall_m.use_nodes = True
wb = wall_m.node_tree.nodes['Principled BSDF']
wb.inputs['Base Color'].default_value = (0.42, 0.38, 0.30, 1); wb.inputs['Roughness'].default_value = 0.9

for o in bpy.data.objects:
    if o.type == 'MESH' and o not in props:
        o.hide_render = True

world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.005, 0.007, 1)


def light(kind, loc, energy, color, size=0.5, rot=(0, 0, 0), spot=None):
    ld = bpy.data.lights.new('L', kind)
    ld.energy = energy; ld.color = color
    if kind == 'AREA':
        ld.size = size
    if kind == 'POINT':
        ld.shadow_soft_size = size
    if kind == 'SPOT':
        ld.spot_size = radians(spot or 40); ld.spot_blend = 0.6; ld.shadow_soft_size = 0.02
    lo = bpy.data.objects.new('L', ld); sc.collection.objects.link(lo)
    lo.location = loc; lo.rotation_euler = rot
    return lo


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


cam_d = bpy.data.cameras.new('C'); cam = bpy.data.objects.new('C', cam_d); sc.collection.objects.link(cam); sc.camera = cam


def bbox(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
    mx = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
    return mn, mx


if MODE == 'sheet':
    add_plane('_floor', 30, (0, 0, 0), (0, 0, 0), floor_m)
    add_plane('_wall', 30, (0, 6, 0), (radians(90), 0, 0), wall_m)
    sc.render.resolution_x = RES; sc.render.resolution_y = RES
    cam_d.lens = 40
    for o in props:
        o.hide_render = True
    for o in props:
        o.hide_render = False
        o.location = (0, 0, 0)
        mn, mx = bbox(o)
        size = (mx - mn).length
        c = (mn + mx) / 2
        # Lichter relativ zur Größe: Deckenlampe warm, kühles Fensterlicht, schwache Taschenlampe von vorne
        for l in [x for x in bpy.data.objects if x.name.startswith('L')]:
            bpy.data.objects.remove(l, do_unlink=True)
        s = max(size, 0.3)
        light('AREA', (s * 0.8, -s * 0.3, s * 1.6 + 0.6), 60 * s * s, (1.0, 0.8, 0.55), size=s * 0.6, rot=(0, radians(25), 0))
        light('AREA', (-s * 1.5, -s * 0.8, s * 0.8), 25 * s * s, (0.55, 0.65, 1.0), size=s * 1.2, rot=(radians(60), 0, radians(-60)))
        light('AREA', (0.3 * s, -s * 2.5, s * 0.6), 6 * s * s, (1, 1, 1), size=s * 0.4, rot=(radians(80), 0, 0))
        dist = size * 1.25 + 0.15
        cam.location = c + Vector((dist * 0.55, -dist * 0.85, dist * 0.55))
        look_at(cam, c)
        sc.render.filepath = f'{OUT}_{o.name}.png'
        bpy.ops.render.render(write_still=True)
        o.hide_render = True
elif MODE == 'scene':
    # Raumecke 4×4 m, Wände an +Y und −X; Props in losen Reihen verteilt
    add_plane('_floor', 12, (0, 0, 0), (0, 0, 0), floor_m)
    add_plane('_wallb', 12, (0, 2.0, 0), (radians(90), 0, 0), wall_m)
    w2 = add_plane('_walll', 12, (-2.6, 0, 0), (radians(90), 0, radians(90)), wall_m)
    sc.render.resolution_x = int(arg('--w', 1600)); sc.render.resolution_y = int(arg('--h', 900))
    layout = json.loads(arg('--layout', '{}')) if arg('--layout') else {}
    x, y, rowh = -2.4, 1.8, 0
    for o in sorted(props, key=lambda o: -o.dimensions.y):
        if o.name in layout:
            L = layout[o.name]
            o.location = L[:3]; o.rotation_euler = (0, 0, radians(L[3] if len(L) > 3 else 0))
            continue
        w = o.dimensions.x
        if x + w > 2.6:
            x = -2.4; y -= rowh + 0.15; rowh = 0
        o.location = (x + w / 2, y - o.dimensions.y / 2, 0)
        x += w + 0.12
        rowh = max(rowh, o.dimensions.y)
    cam_d.lens = 16
    cam.location = Vector((1.9, -3.6, 1.38))
    look_at(cam, (-0.4, 0.3, 0.25))
    # Schummerlicht: schwache Glühbirne, Blaulicht-Schimmer durchs Fenster, Taschenlampe der Bodycam
    light('POINT', (-1.2, 0.8, 2.4), 25, (1.0, 0.7, 0.42), size=0.05)
    light('AREA', (2.5, 1.5, 1.6), 30, (0.35, 0.45, 1.0), size=1.2, rot=(radians(70), 0, radians(110)))
    fl = light('SPOT', (1.75, -3.4, 1.3), 220, (1.0, 0.97, 0.9), spot=36)
    look_at(fl, (-0.6, 0.2, 0.1))
    sc.render.filepath = f'{OUT}.png'
    bpy.ops.render.render(write_still=True)
