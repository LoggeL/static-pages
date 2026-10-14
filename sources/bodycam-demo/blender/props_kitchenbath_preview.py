# Vorschau-Renderings für props_kitchenbath (Cycles, Metal):
#   blender -b $SCRATCH/bodycam/blend/props_kitchenbath.blend -P props_kitchenbath_preview.py -- --mode sheet [--only a,b] [--out x.png]
#   ... --mode scene --set kitchen|bath|laundry  (Raumecke mit Schummerlicht)
#   ... --mode close --only name --az -30 --el 15 --dist 1.2 (Einzelansicht)
import bpy, os, sys, math, json
from mathutils import Vector, Matrix, Euler
from math import radians

REPO = '/Users/logge/Documents/Projects/static-pages'
SCR = '/Users/logge/Documents/Projects/bodycam-work'
TEX = REPO + '/public/bodycam-demo/textures'
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(n, d=None):
    if n in argv:
        i = argv.index(n)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return d


try:
    TINDEX = json.load(open(TEX + '/index.json'))
except Exception:
    TINDEX = {}


def tex_img(tid, m):
    p = f'{TEX}/{tid}/{m}.jpg'
    if os.path.exists(p):
        im = bpy.data.images.load(p, check_existing=True)
        if m != 'albedo':
            im.colorspace_settings.name = 'Non-Color'
        return im
    return None


def prep_materials():
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.get('_pv'):
            continue
        mat['_pv'] = 1
        nt = mat.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        if not bsdf:
            continue
        base_in = bsdf.inputs['Base Color']
        src = base_in.links[0].from_socket if base_in.links else None
        tid = mat.name[2:] if mat.name.startswith('M_') else None
        if tid and tid in TINDEX and tex_img(tid, 'albedo'):
            tile = TINDEX[tid].get('tileMeters', 2.0)
            uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
            nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
            ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = tex_img(tid, 'albedo')
            nt.links.new(mp.outputs['Vector'], ta.inputs['Vector'])
            src = ta.outputs['Color']
            orm = tex_img(tid, 'orm')
            if orm:
                to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm
                nt.links.new(mp.outputs['Vector'], to.inputs['Vector'])
                sp = nt.nodes.new('ShaderNodeSeparateColor')
                nt.links.new(to.outputs['Color'], sp.inputs['Color'])
                nt.links.new(sp.outputs['Green'], bsdf.inputs['Roughness'])
            nm = tex_img(tid, 'normal')
            if nm:
                tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nm
                nt.links.new(mp.outputs['Vector'], tn.inputs['Vector'])
                nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.uv_map = 'UVMap'
                nt.links.new(tn.outputs['Color'], nmap.inputs['Color'])
                nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Color'
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
        mx.inputs['Factor'].default_value = 1.0
        if src is not None:
            nt.links.new(src, mx.inputs['A'])
        else:
            mx.inputs['A'].default_value = base_in.default_value
        nt.links.new(ca.outputs['Color'], mx.inputs['B'])
        nt.links.new(mx.outputs['Result'], base_in)


def setup_render(res=(640, 640), samples=96):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU fail', e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'


def world(strength=0.15, col=(0.5, 0.55, 0.65)):
    w = bpy.data.worlds.get('pv') or bpy.data.worlds.new('pv')
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*col, 1)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w


def add_light(name, kind, loc, rot=(0, 0, 0), energy=100, color=(1, 1, 1), size=0.5, spot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.size = size
    if kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    if kind == 'SPOT' and spot:
        ld.spot_size = radians(spot)
        ld.spot_blend = 0.5
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = Euler([radians(a) for a in rot])
    return ob


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(loc, target, lens=40):
    cd = bpy.data.cameras.new('cam'); cd.lens = lens
    cd.clip_start = 0.02
    cam = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    look_at(cam, target)
    bpy.context.scene.camera = cam
    return cam


def bbox(ob):
    co = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
    mx = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
    return mn, mx


def floor_plane(tid='tile_floor_dirty', size=8):
    bpy.ops.mesh.primitive_plane_add(size=size)
    p = bpy.context.active_object
    me = p.data
    uv = me.uv_layers[0]
    for l in me.loops:
        v = me.vertices[l.vertex_index].co
        uv.data[l.index].uv = (v.x, v.y)
    m = bpy.data.materials.get('M_' + tid) or bpy.data.materials.new('M_' + tid)
    m.use_nodes = True
    me.materials.append(m)
    return p


def wall(tid, loc, rot, w, h):
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = bpy.context.active_object
    p.scale = (w, h, 1)
    bpy.ops.object.transform_apply(scale=True)
    me = p.data
    for l in me.loops:
        v = me.vertices[l.vertex_index].co
        me.uv_layers[0].data[l.index].uv = (v.x + 5, v.y + 5)
    p.location = loc
    p.rotation_euler = Euler([radians(a) for a in rot])
    m = bpy.data.materials.get('M_' + tid) or bpy.data.materials.new('M_' + tid)
    m.use_nodes = True
    me.materials.append(m)
    return p


def props_list():
    out = []
    for c in bpy.data.collections:
        if c.name.startswith('_'):
            continue
        obs = [o for o in c.objects if o.type == 'MESH']
        if obs:
            out.append((c.name, obs[0]))
    return out


def label_sheet(paths, names, out, cols=4, cell=420):
    import subprocess
    args = ['python3', '-I', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'props_kitchenbath_sheet.py'), out, str(cols), str(cell)]
    for p, n in zip(paths, names):
        args += [p, n]
    subprocess.run(args, check=True)


def mode_sheet():
    only = arg('--only')
    items = props_list()
    if only and only is not True:
        want = only.split(',')
        items = [i for i in items if i[0] in want]
    setup_render((int(arg('--res', 640)),) * 2, int(arg('--samples', 64)))
    prep_materials()
    world(0.25, (0.55, 0.58, 0.65))
    fl = floor_plane('concrete_floor')
    key = add_light('key', 'AREA', (2.0, -3.0, 3.0), energy=500, color=(1.0, 0.85, 0.7), size=2.0)
    look_at(key, (0, 0, 0.5))
    rim = add_light('rim', 'AREA', (-2.5, 2.0, 2.5), energy=200, color=(0.6, 0.7, 1.0), size=2.0)
    look_at(rim, (0, 0, 0.5))
    az = radians(float(arg('--az', -32)))
    el = radians(float(arg('--el', 18)))
    paths, names = [], []
    for n, ob in items:
        for o2 in bpy.data.objects:
            if o2.type == 'MESH' and o2 is not fl:
                o2.hide_render = (o2 is not ob)
        ob.location = (0, 0, 0)
        mn, mx = bbox(ob)
        c = (mn + mx) / 2
        rad = (mx - mn).length / 2
        dist = rad / math.tan(radians(18)) * float(arg('--zoom', 1.0))
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        if bpy.context.scene.camera:
            bpy.data.objects.remove(bpy.context.scene.camera)
        camera(c + d * dist, c, lens=50)
        p = f'{SCR}/previews/_tmp_{n}.png'
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p); names.append(n)
    out = arg('--out', f'{SCR}/previews/props_kitchenbath_sheet.png')
    label_sheet(paths, names, out, cols=int(arg('--cols', 4)))
    for p in paths:
        if not arg('--keep'):
            os.remove(p)
    print('SHEET', out)


def place_prop(name, loc, rotz=0):
    ob = bpy.data.objects.get(name)
    if not ob:
        print('fehlt', name)
        return None
    ob.location = loc
    ob.rotation_euler = (0, 0, radians(rotz))
    ob.hide_render = False
    return ob


def mode_scene():
    setup_render((1280, 720), int(arg('--samples', 128)))
    prep_materials()
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = True
    world(0.01, (0.3, 0.4, 0.6))
    s = arg('--set', 'kitchen')
    H = 2.6
    floor_plane('tile_floor_dirty' if s != 'kitchen' else 'tile_floor_dirty', 12)
    # Raumecke: Rückwand y=+0.0 (Props mit Rücken dran), linke Wand x=-..
    if s == 'kitchen':
        wall('plaster_painted_dirty', (0.8, 0.0, H / 2), (90, 0, 0), 5, H)
        wall('wallpaper_peeling', (-1.6, -1.5, H / 2), (90, 0, 90), 4, H)
        x = -1.6
        seq = [('fridge_open', 0.76, 0), ('kitchen_base_cab_45', 0.45, 0), ('stove_old', 0.762, 0),
               ('kitchen_base_cab_60', 0.60, 0), ('kitchen_sink_cab_90', 0.90, 0), ('kitchen_base_cab_60', 0, 0)]
        placed = {}
        cx = x + 0.02
        for n, w, _ in seq[:-1]:
            ob = bpy.data.objects.get(n)
            if not ob:
                cx += w
                continue
            mn, mx = bbox(ob) if False else (None, None)
            dep = {'fridge_open': 0.35 + 0.0, 'stove_old': 0.33}.get(n, 0.31)
            place_prop(n, (cx + w / 2, -dep - 0.005, 0))
            cx += w + 0.003
        # Oberschränke
        place_prop('kitchen_wall_cab_76', (x + 0.76 + 0.45 + 0.381 - 0.381 + 0.38 + 0.02, -0.16, 1.37))
        place_prop('kitchen_wall_cab_60', (x + 0.76 + 0.45 + 0.762 + 0.3 + 0.03, -0.16, 1.37))
        place_prop('range_hood', (x + 0.76 + 0.45 + 0.381 + 0.02, -0.26, 1.52))
        place_prop('microwave', (x + 0.76 + 0.45 + 0.762 + 0.3, -0.36, 0.914))
        place_prop('kitchen_pot', (x + 0.76 + 0.45 + 0.2, -0.43, 0.92))
        place_prop('kitchen_pan', (x + 0.76 + 0.45 + 0.55, -0.45, 0.92), 30)
        place_prop('kitchen_plate_stack', (x + 0.76 + 0.45 + 0.762 + 0.6 + 0.6, -0.15, 0.914 + 0.0))
        cam_loc, cam_t = Vector((0.9, -3.2, 1.40)), Vector((-0.5, -0.3, 0.9))
        bulb = (-0.2, -1.6, 2.45)
    elif s == 'bath':
        wall('tile_wall_white', (0.0, 0.0, H / 2), (90, 0, 0), 5, H)
        wall('tile_wall_white', (-1.6, -1.5, H / 2), (90, 0, 90), 4, H)
        place_prop('bathtub', (-1.6 + 0.76, -0.38, 0))
        place_prop('toilet_dirty', (0.25, -0.35, 0))
        place_prop('bath_vanity', (0.95, -0.25, 0))
        place_prop('medicine_cabinet', (0.95, -0.065, 1.25))
        place_prop('towel_rack', (1.75, -0.05, 0.85))
        cam_loc, cam_t = Vector((1.3, -3.0, 1.45)), Vector((-0.2, -0.3, 0.8))
        bulb = (0.2, -1.4, 2.45)
    else:
        wall('concrete_floor', (0.0, 0.0, H / 2), (90, 0, 0), 5, H)
        wall('plaster_damaged', (-1.6, -1.5, H / 2), (90, 0, 90), 4, H)
        place_prop('washing_machine', (-1.6 + 0.36, -0.37, 0))
        place_prop('dryer', (-1.6 + 0.36 + 0.72, -0.37, 0))
        place_prop('water_heater', (0.6, -0.33, 0))
        cam_loc, cam_t = Vector((1.0, -3.0, 1.45)), Vector((-0.5, -0.3, 0.8))
        bulb = (-0.3, -1.4, 2.45)
    # Schummerlicht: schwache Glühbirne + blaues Streulicht + Taschenlampe der Bodycam
    add_light('bulb', 'POINT', bulb, energy=float(arg('--bulb', 25)), color=(1.0, 0.72, 0.42), size=0.04)
    add_light('moon', 'AREA', (1.5, -4.0, 2.0), energy=40, color=(0.45, 0.55, 1.0), size=1.0)
    look_at(bpy.data.objects['moon'], (-0.5, 0, 0.8))
    cam = camera(cam_loc, cam_t, lens=float(arg('--lens', 18)))
    if arg('--flash', True) is True or arg('--flash') == '1':
        fl = add_light('flash', 'SPOT', cam_loc + Vector((0.15, 0.1, -0.12)), energy=float(arg('--flashW', 120)),
                       color=(1.0, 0.97, 0.92), size=0.02, spot=34)
        look_at(fl, cam_t + Vector((0.1, 0, -0.05)))
    out = arg('--out', f'{SCR}/previews/props_kitchenbath_scene_{s}.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('SCENE', out)


def mode_close():
    setup_render((int(arg('--w', 900)), int(arg('--h', 900))), int(arg('--samples', 96)))
    prep_materials()
    n = arg('--only')
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o.name != n
    ob = bpy.data.objects[n]
    ob.location = (0, 0, 0)
    world(float(arg('--world', 0.25)), (0.55, 0.58, 0.65))
    floor_plane('concrete_floor')
    key = add_light('key', 'AREA', (2.0, -3.0, 3.0), energy=500, color=(1.0, 0.85, 0.7), size=2.0)
    look_at(key, (0, 0, 0.5))
    rim = add_light('rim', 'AREA', (-2.5, 2.0, 2.5), energy=200, color=(0.6, 0.7, 1.0), size=2.0)
    look_at(rim, (0, 0, 0.5))
    mn, mx = bbox(ob)
    c = Vector((float(arg('--tx', (mn.x + mx.x) / 2)), float(arg('--ty', (mn.y + mx.y) / 2)), float(arg('--tz', (mn.z + mx.z) / 2))))
    az, el, dist = radians(float(arg('--az', -30))), radians(float(arg('--el', 15))), float(arg('--dist', 1.5))
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    camera(c + d * dist, c, lens=float(arg('--lens', 50)))
    out = arg('--out', f'{SCR}/previews/props_kitchenbath_close_{n}.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('CLOSE', out)


m = arg('--mode', 'sheet')
{'sheet': mode_sheet, 'scene': mode_scene, 'close': mode_close}[m]()
