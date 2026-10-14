"""house_shell_preview.py - Vorschau-Renderings des Rohbaus (nur Pruefzwecke, speichert nichts zurueck).

  blender -b BLEND -P house_shell_preview.py -- --views plan,hall,liv,ext_night [--out DIR] [--res 960x540] [--samples 48]

Haengt die Kacheltexturen aus public/bodycam-demo/textures fuer die Vorschau an die M_*-Materialien
(UV in Metern -> Mapping-Skalierung 1/tileMeters) und rendert mit Cycles (Metal).
"""
import bpy, sys, os, json, math
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(n, d=None):
    return ARGS[ARGS.index(n) + 1] if n in ARGS else d


HERE = os.path.dirname(os.path.abspath(__file__))
TEXROOT = os.path.abspath(os.path.join(HERE, '../../../public/bodycam-demo/textures'))
SCRATCH = '/Users/logge/Documents/Projects/bodycam-work'
OUT = arg('--out', SCRATCH + '/previews')
VIEWS = arg('--views', 'plan,hall,liv,ext_night').split(',')
RES = [int(v) for v in arg('--res', '960x540').split('x')]
SAMPLES = int(arg('--samples', '48'))
FFL, CEIL = 0.60, 3.20
idx = json.load(open(os.path.join(TEXROOT, 'index.json')))


def texturize():
    for m in bpy.data.materials:
        tid = m.get('textureId')
        if not tid or tid not in idx or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        tile = idx[tid]['tileMeters']
        uv = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])

        def img(name, color):
            p = os.path.join(TEXROOT, tid, name + '.jpg')
            im = bpy.data.images.load(p, check_existing=True)
            if not color:
                im.colorspace_settings.name = 'Non-Color'
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = im
            nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
            return n
        a = img('albedo', True)
        nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
        o = img('orm', False)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(o.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        nn = img('normal', False)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])


def setup_render():
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
        print('GPU?', e)
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'


def world(color, strength):
    w = bpy.data.worlds.new('W') if not bpy.context.scene.world else bpy.context.scene.world
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength


def cam(name, loc, look, lens_fov=100, ortho=None):
    c = bpy.data.cameras.new(name)
    ob = bpy.data.objects.new(name, c)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(look) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        c.type = 'ORTHO'
        c.ortho_scale = ortho
    else:
        c.sensor_fit = 'HORIZONTAL'
        c.angle = math.radians(lens_fov)
    c.clip_start = 0.03
    c.clip_end = 300
    bpy.context.scene.camera = ob
    return ob


TEMP = []


def light(kind, loc, energy, color=(1, 1, 1), size=0.1, rot=None, spot=None):
    l = bpy.data.lights.new('L', kind)
    l.energy = energy
    l.color = color
    if kind in ('POINT', 'SPOT'):
        l.shadow_soft_size = size
    if kind == 'AREA':
        l.size = size
    if kind == 'SPOT' and spot:
        l.spot_size = math.radians(spot)
        l.spot_blend = 0.6
    ob = bpy.data.objects.new('L', l)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    TEMP.append(ob)
    return ob


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def clear_temp():
    for ob in TEMP:
        bpy.data.objects.remove(ob)
    TEMP.clear()


def hide(pred, state=True):
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and pred(ob.name):
            ob.hide_render = state


def room_fill(strength=1.0):
    """Schwache Raumleuchten an der Decke (nur zur Geometriebeurteilung)."""
    lay = json.load(open(os.path.join(HERE, 'layout.json')))
    for r in lay['rooms']:
        if r.get('outdoor'):
            continue
        for (x0, y0, x1, y1) in r['rects']:
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            area = (x1 - x0) * (y1 - y0)
            ob = light('POINT', (cx, cy, CEIL - 0.35), 25 * area * strength, (1.0, 0.85, 0.7), size=0.3)


def flashlight(c, energy=60, spot=40):
    l = light('SPOT', c.location.copy(), energy, (0.95, 0.97, 1.0), size=0.02, spot=spot)
    l.rotation_euler = c.rotation_euler.copy()


def render(name):
    p = os.path.join(OUT, f'shell_{name}.png')
    bpy.context.scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    print('->', p)


texturize()
setup_render()
INT_EYE = FFL + 1.38   # Bodycam-Hoehe

VIEWS_DEF = {
    'hall': dict(loc=(-0.28, 0.45, INT_EYE), look=(-0.28, 7.0, INT_EYE - 0.2)),
    'liv': dict(loc=(-1.25, 0.6, INT_EYE), look=(-5.5, 4.4, INT_EYE - 0.35)),
    'liv2': dict(loc=(-5.9, 0.6, INT_EYE), look=(-1.5, 4.6, INT_EYE - 0.2)),
    'kit': dict(loc=(-2.0, 5.3, INT_EYE), look=(-5.2, 9.5, INT_EYE - 0.25)),
    'kit2': dict(loc=(-5.8, 5.5, INT_EYE), look=(-1.2, 8.8, INT_EYE - 0.1)),
    'xhall': dict(loc=(0.0, 4.95, INT_EYE), look=(6.3, 4.95, INT_EYE - 0.1)),
    'bed1': dict(loc=(4.3, 4.1, INT_EYE), look=(2.0, 0.3, INT_EYE - 0.3)),
    'bed2': dict(loc=(3.4, 5.75, INT_EYE), look=(5.8, 9.6, INT_EYE - 0.3)),
    'bath': dict(loc=(0.55, 6.75, INT_EYE), look=(2.5, 6.6, INT_EYE - 0.4)),
    'util': dict(loc=(-0.28, 8.2, INT_EYE), look=(1.6, 9.8, INT_EYE - 0.3)),
    'ceil': dict(loc=(-3.3, 2.0, FFL + 1.6), look=(-3.3, 3.6, CEIL + 0.3)),
}

for v in VIEWS:
    clear_temp()
    hide(lambda n: True, False)
    if v == 'plan':
        hide(lambda n: n.startswith(('ROOF_', 'ATTIC_', 'PORCH_roof', 'SITE_poles', 'SITE_wires', 'SITE_streetlight', 'EXT_sheathing')) or '_ceiling' in n)
        world((0.6, 0.65, 0.7), 0.6)
        light('SUN', (0, 0, 20), 3.0, (1, 0.97, 0.9), rot=(math.radians(15), math.radians(10), 0))
        cam('C', (0.0, 2.0, 30), (0.0, 2.0, 0), ortho=16.5)
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 1000, 900
        render(v)
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = RES
    elif v == 'site':
        world((0.6, 0.65, 0.7), 0.6)
        light('SUN', (0, 0, 20), 3.0, (1, 0.97, 0.9), rot=(math.radians(35), math.radians(15), math.radians(30)))
        cam('C', (0.0, -2.0, 70), (0.0, -2.0, 0), ortho=75)
        render(v)
    elif v in ('ext_day', 'ext_aerial'):
        world((0.55, 0.6, 0.66), 1.0)
        light('SUN', (0, 0, 20), 2.5, (1, 0.96, 0.9), rot=(math.radians(50), 0, math.radians(-30)))
        if v == 'ext_day':
            cam('C', (5.5, -12.5, 1.5), (-0.5, 1.0, 2.2), lens_fov=95)
        else:
            cam('C', (-14, -17, 9), (0, 3, 1.5), lens_fov=65)
        render(v)
    elif v in ('ext_night', 'ext_porch'):
        world((0.012, 0.016, 0.03), 1.0)
        lp = (8.6, -12.3, 7.5)
        s = light('SPOT', lp, 2500, (1.0, 0.55, 0.2), size=0.15, spot=120)
        aim(s, (8.6, -12.0, 0))
        light('SUN', (0, 0, 20), 0.03, (0.6, 0.7, 1.0), rot=(math.radians(40), 0, math.radians(60)))
        # Blaulicht/Rotlicht (Streifenwagen-Position)
        light('POINT', (0.4, -11.7, 1.75), 900, (1.0, 0.05, 0.03), size=0.2)
        light('POINT', (1.4, -11.7, 1.75), 900, (0.05, 0.15, 1.0), size=0.2)
        light('POINT', (-0.28, -0.3, FFL + 2.3), 15, (1.0, 0.7, 0.4), size=0.05)
        if v == 'ext_night':
            cam('C', (4.6, -11.0, -0.25 + 1.38), (-0.5, 1.0, 1.8), lens_fov=110)
        else:
            c = cam('C', (-0.28, -3.6, 1.38), (-0.28, 1.0, 1.4), lens_fov=110)
            flashlight(c, 80, 45)
        render(v)
    elif v in VIEWS_DEF:
        d = VIEWS_DEF[v]
        world((0.02, 0.025, 0.035), 1.0)
        room_fill(0.6)
        c = cam('C', d['loc'], d['look'], lens_fov=105)
        flashlight(c, 40, 50)
        # etwas Mondlicht von aussen
        light('SUN', (0, 0, 20), 0.2, (0.6, 0.7, 1.0), rot=(math.radians(55), 0, math.radians(200)))
        render(v)
