# Cycles-Vorschau fuer props_living: Kontaktbogen (jedes Prop einzeln, Schummerlicht + Taschenlampe) und
# Szenenrenderings (Wohnzimmer/Schlafzimmer bei Nacht mit Waffenlicht).
#   blender -b <scratch>/bodycam/blend/props_living.blend -P props_living_preview.py -- [--sheet] [--scene living|bedroom]
#       [--only a,b] [--samples 64] [--res 520] [--tag x]
# Nur Vorschau: verdrahtet die Kacheltexturen aus public/bodycam-demo/textures (falls vorhanden) und COLOR_0.
import bpy, math, os, sys, json
from math import radians
from mathutils import Vector, Matrix, Euler

REPO = '/Users/logge/Documents/Projects/static-pages'
WORK = '/Users/logge/Documents/Projects/bodycam-work'
TEX = REPO + '/public/bodycam-demo/textures'
PREV = WORK + '/previews'
TMP = WORK + '/props_living/tmp'
os.makedirs(PREV, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return default


SAMPLES = int(arg('--samples', 64))
RES = int(arg('--res', 520))
TAG = arg('--tag', '')
try:
    TEXIDX = json.load(open(TEX + '/index.json'))
except Exception:
    TEXIDX = {}

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
    print('GPU setup failed', e)
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.film_transparent = False

PROPS = [c.name for c in sc.collection.children if c.name in bpy.data.objects]


# ---------------------------------------------------------------- Vorschau-Materialien
def tex_node(nt, path, noncolor=False):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        n.image.colorspace_settings.name = 'Non-Color'
    return n


def wire_material(m):
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if bsdf is None or m.get('_prev'):
        return
    m['_prev'] = 1
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    key = m.get('key') if m.name.startswith(('M_', 'ENV_')) else None
    A, B, R = mul.inputs[6], mul.inputs[7], mul.outputs[2]   # RGBA-Sockets des Mix-Knotens
    base_link = None
    for l in nt.links:
        if l.to_socket == bsdf.inputs['Base Color']:
            base_link = l
    if key and os.path.exists(f'{TEX}/{key}/albedo.jpg'):
        tile = TEXIDX.get(key, {}).get('tileMeters', 1.0)
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
        a = tex_node(nt, f'{TEX}/{key}/albedo.jpg')
        nt.links.new(mp.outputs['Vector'], a.inputs['Vector'])
        nt.links.new(a.outputs['Color'], A)
        if os.path.exists(f'{TEX}/{key}/normal.jpg'):
            n = tex_node(nt, f'{TEX}/{key}/normal.jpg', True)
            nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = 1.0
            nt.links.new(n.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        if os.path.exists(f'{TEX}/{key}/orm.jpg'):
            o = tex_node(nt, f'{TEX}/{key}/orm.jpg', True)
            nt.links.new(mp.outputs['Vector'], o.inputs['Vector'])
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(o.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
            nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    elif base_link is not None:
        nt.links.new(base_link.from_socket, A)
    else:
        A.default_value = bsdf.inputs['Base Color'].default_value
    nt.links.new(vc.outputs['Color'], B)
    nt.links.new(R, bsdf.inputs['Base Color'])


for m in bpy.data.materials:
    if m.node_tree:
        wire_material(m)


def mat_env(name, key, fallback):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    m['key'] = key
    nt = m.node_tree
    nt.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*fallback, 1)
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    # Vertexfarbe fehlt bei Umgebungsflaechen -> weiss
    wire_material(m)
    return m


def env_plane(name, size, loc, rot, key, fallback, tile=1.0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(scale=True)
    me = ob.data
    ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for d in ca.data:
        d.color = (1, 1, 1, 1)
    uv = me.uv_layers[0]
    for li, l in enumerate(me.loops):
        co = me.vertices[l.vertex_index].co
        uv.data[li].uv = (co.x, co.y)
    ob.data.materials.append(mat_env('ENV_' + name, key, fallback))
    return ob


def clear_env():
    for ob in list(bpy.data.objects):
        if ob.name.startswith(('ENV_', 'CAM', 'LGT_', 'INST_')):
            bpy.data.objects.remove(ob, do_unlink=True)


def world(strength=0.02, col=(0.25, 0.3, 0.45)):
    w = sc.world or bpy.data.worlds.new('W')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*col, 1)
    bg.inputs['Strength'].default_value = strength


def light(name, kind, loc, rot=(0, 0, 0), energy=10, color=(1, 1, 1), size=0.1, spot=None, blend=0.3):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.size = size
    elif kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    if kind == 'SPOT':
        ld.spot_size = spot or radians(40)
        ld.spot_blend = blend
    ob = bpy.data.objects.new('LGT_' + name, ld)
    sc.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(loc, target, lens=28):
    cd = bpy.data.cameras.new('CAM')
    cd.lens = lens
    cd.clip_start = 0.02
    ob = bpy.data.objects.new('CAM', cd)
    sc.collection.objects.link(ob)
    ob.location = loc
    look_at(ob, target)
    sc.camera = ob
    return ob


def show_only(names):
    for c in sc.collection.children:
        c.hide_render = c.name not in names
        c.hide_viewport = c.name not in names


def bbox(name):
    ob = bpy.data.objects[name]
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


# ---------------------------------------------------------------- Kontaktbogen
def render_sheet(names):
    out = []
    for name in names:
        clear_env()
        show_only({name})
        ob = bpy.data.objects[name]
        anchor = ob.get('anchor', 'floor')
        ob.matrix_world = Matrix.Identity(4)
        mn, mx = bbox(name)
        if anchor == 'ceiling':
            ob.location.z = 2.6
        elif anchor == 'wall':
            ob.location.z = 0.9 if (mx.z - mn.z) < 1.0 else 0.4
        mn, mx = bbox(name)
        c = (mn + mx) / 2
        size = (mx - mn).length
        wall_y = mx.y if anchor == 'wall' else max(mx.y + 0.35, 0.6)
        env_plane('ENV_floor', (12, 12), (0, 0, 0), (0, 0, 0), 'wood_floor_worn', (0.2, 0.14, 0.09))
        env_plane('ENV_wall', (12, 5), (0, wall_y + 0.001, 2.5), (radians(90), 0, 0), 'plaster_painted_dirty', (0.5, 0.48, 0.42))
        if anchor == 'ceiling':
            env_plane('ENV_ceil', (12, 12), (0, 0, 2.601), (radians(180), 0, 0), 'ceiling_stained', (0.5, 0.48, 0.42))
        world(0.03)
        d = Vector((0.55, -1.0, 0.42)).normalized()
        if anchor == 'ceiling':
            d = Vector((0.45, -1.0, -0.25)).normalized()
        if anchor == 'wall':
            d = Vector((0.35, -1.0, 0.1)).normalized()
        dist = max(0.9, size * 1.05)
        cam = camera(c + d * dist, c, lens=32)
        # Schummerlicht: warmes Restlicht von oben, kuehles Fensterlicht, Taschenlampe von der Kamera
        light('key', 'AREA', c + Vector((-1.2, -1.0, 2.2)), energy=55, color=(1.0, 0.82, 0.62), size=1.2)
        lt = light('moon', 'AREA', c + Vector((2.4, -0.6, 1.4)), energy=40, color=(0.55, 0.65, 1.0), size=1.0)
        look_at(lt, c)
        lk = bpy.data.objects['LGT_key']
        look_at(lk, c)
        fl = light('flash', 'SPOT', cam.location + Vector((0.12, 0, -0.15)), energy=60 * max(1, dist) ** 2 / 2,
                   color=(1.0, 0.97, 0.92), size=0.02, spot=radians(50), blend=0.6)
        look_at(fl, c)
        sc.render.resolution_x = RES
        sc.render.resolution_y = RES
        p = f'{TMP}/sheet_{name}.png'
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
        ob.matrix_world = Matrix.Identity(4)
    return out


# ---------------------------------------------------------------- Szenen
def inst(name, loc, rz=0.0, rx=0.0, ry=0.0):
    src = bpy.data.objects[name]
    ob = bpy.data.objects.new('INST_' + name, src.data)
    sc.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (rx, ry, rz)
    return ob


def room(w, d, h=2.6, wall_key='wallpaper_peeling', floor_key='wood_floor_worn'):
    env_plane('ENV_floor', (w, d), (0, 0, 0), (0, 0, 0), floor_key, (0.2, 0.14, 0.09))
    env_plane('ENV_ceil', (w, d), (0, 0, h), (radians(180), 0, 0), 'ceiling_stained', (0.5, 0.48, 0.42))
    env_plane('ENV_wn', (w, h), (0, d / 2, h / 2), (radians(90), 0, 0), wall_key, (0.5, 0.48, 0.42))
    env_plane('ENV_ww', (d, h), (-w / 2, 0, h / 2), (radians(90), 0, radians(-90)), wall_key, (0.5, 0.48, 0.42))
    env_plane('ENV_we', (d, h), (w / 2, 0, h / 2), (radians(90), 0, radians(90)), wall_key, (0.5, 0.48, 0.42))


def render_scene(kind):
    clear_env()
    show_only(set())
    world(0.004)
    if kind == 'living':
        W, D = 5.2, 4.6
        room(W, D)
        inst('rug_runner', (0.2, -0.3, 0), rz=radians(90))
        inst('sofa_torn', (0.0, D / 2 - 0.47, 0))
        inst('coffee_table', (0.05, 0.75, 0), rz=radians(3))
        inst('armchair_worn', (-1.85, 0.5, 0), rz=radians(-70))
        inst('tv_stand', (W / 2 - 0.25, 0.3, 0), rz=radians(90))
        inst('tv_crt', (W / 2 - 0.25, 0.3, 0.52), rz=radians(84))
        inst('floor_lamp_bare', (-1.25, D / 2 - 0.3, 0))
        inst('bookshelf', (-W / 2 + 0.16, -0.9, 0), rz=radians(-90))
        inst('bookshelf_toppled', (1.2, -1.2, 0), rz=radians(20))
        inst('wall_picture_crooked', (0.0, D / 2, 1.25), rz=0)
        inst('ceiling_fan', (0, 0.2, 2.6))
        inst('curtain_torn', (-W / 2, 1.35, 1.0), rz=radians(-90))
        inst('blinds_bent', (-W / 2, 1.35, 1.0), rz=radians(-90))
        inst('toy_box', (1.7, D / 2 - 0.22, 0), rz=radians(-8))
        cam = camera((0.5, -2.1, 1.38), (-0.2, 1.0, 0.65), lens=18)
    else:
        W, D = 4.0, 3.8
        room(W, D, floor_key='carpet_stained')
        inst('bed_frame', (-0.6, D / 2 - 1.07, 0))
        inst('mattress_floor', (1.0, 0.0, 0), rz=radians(78))
        inst('nightstand', (-1.65, D / 2 - 0.22, 0))
        inst('dresser_open', (W / 2 - 0.26, -0.9, 0), rz=radians(90))
        inst('wardrobe_open', (-W / 2 + 0.31, -0.6, 0), rz=radians(-90))
        inst('dining_chair_tipped', (0.4, -0.9, 0), rz=radians(30))
        inst('ceiling_lamp_bulb', (0, 0, 2.6))
        inst('dining_table', (-6, -6, 0))
        cam = camera((0.6, -1.75, 1.38), (-0.4, 0.8, 0.6), lens=18)
    # Waffenlicht (leicht rechts unterhalb der Kamera)
    fl = light('flash', 'SPOT', cam.location + Vector((0.15, 0.1, -0.2)), energy=300, color=(1.0, 0.97, 0.92),
               size=0.015, spot=radians(38), blend=0.75)
    look_at(fl, cam.location + (cam.matrix_world.to_3x3() @ Vector((0, 0, -1))) * 3)
    # Blaulicht durchs Fenster + warme Gluehbirne
    light('police', 'AREA', (-W / 2 - 0.5, 1.3, 1.6), rot=(0, radians(90), 0), energy=180, color=(0.2, 0.35, 1.0), size=1.0)
    if kind == 'bedroom':
        light('bulb', 'POINT', (0, 0, 2.6 - 0.62), energy=25, color=(1.0, 0.62, 0.3), size=0.03)
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 720
    p = f'{PREV}/props_living_scene_{kind}{TAG}.png'
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    print('WROTE', p)


if arg('--sheet'):
    only = arg('--only')
    names = [n for n in (only.split(',') if only and only is not True else PROPS) if n in PROPS]
    paths = render_sheet(names)
    with open(f'{TMP}/sheet_list.txt', 'w') as f:
        f.write('\n'.join(paths))
    print('SHEET', len(paths))
scn = arg('--scene')
if scn:
    for k in scn.split(','):
        render_scene(k)
