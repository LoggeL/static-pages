# Vorschau-Renderings (Workbench für Analyse, Cycles für Sichtprüfung)
import bpy, math, os
from mathutils import Vector
from .common import *

PREVIEWS = os.path.join(SCRATCH, 'previews')
os.makedirs(PREVIEWS, exist_ok=True)


def _cam(name='PREV_CAM'):
    sc = bpy.context.scene
    co = bpy.data.objects.get(name)
    if co is None:
        cam = bpy.data.cameras.new(name)
        co = bpy.data.objects.new(name, cam)
        sc.collection.objects.link(co)
    sc.camera = co
    return co


def aim(co, loc, target, lens=50.0, ortho=None, roll_up=(0, 0, 1)):
    co.location = Vector(loc)
    d = Vector(target) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        co.data.type = 'ORTHO'
        co.data.ortho_scale = ortho
    else:
        co.data.type = 'PERSP'
        co.data.lens = lens
    co.data.clip_start = 0.005
    co.data.clip_end = 100


def workbench(out, views, res=(900, 1200), xray=0.0, cavity=True, color='MATERIAL'):
    """views: list of (suffix, loc, target, lens, ortho)"""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = color
    sh.show_cavity = cavity
    sh.show_xray = xray > 0
    if xray > 0:
        sh.xray_alpha = xray
    sh.show_shadows = False
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    co = _cam()
    paths = []
    for suf, loc, tgt, lens, ortho in views:
        aim(co, loc, tgt, lens, ortho)
        p = out.replace('.png', f'_{suf}.png') if suf else out
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


def marker(name, p, r=0.004, color=(1, 0, 0, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=p, segments=12, ring_count=8)
    o = bpy.context.active_object
    o.name = name
    m = bpy.data.materials.get('MK_' + str(color))
    if m is None:
        m = bpy.data.materials.new('MK_' + str(color))
        m.diffuse_color = color
    o.data.materials.append(m)
    return o


def stick(name, a, b, r=0.002, color=(0, 0.7, 0, 1)):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(a + b) / 2, vertices=8)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    m = bpy.data.materials.get('MK_' + str(color))
    if m is None:
        m = bpy.data.materials.new('MK_' + str(color))
        m.diffuse_color = color
    o.data.materials.append(m)
    return o


def setup_cycles(samples=64, res=(1000, 1300), denoise=True):
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
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'


def studio_lights(key=250.0, env=0.25, ground=True):
    """3-Punkt-Licht + dunkle Umgebung + optional Boden."""
    sc = bpy.context.scene
    for o in [o for o in bpy.data.objects if o.name.startswith('PL_')]:
        bpy.data.objects.remove(o, do_unlink=True)
    def area(name, loc, tgt, power, size, col=(1, 1, 1)):
        l = bpy.data.lights.new(name, 'AREA')
        l.energy = power; l.size = size; l.color = col
        o = bpy.data.objects.new(name, l)
        sc.collection.objects.link(o)
        o.location = Vector(loc)
        o.rotation_euler = (Vector(tgt) - o.location).to_track_quat('-Z', 'Y').to_euler()
        return o
    area('PL_key', (1.6, -2.2, 2.6), (0, 0, 1.1), key, 1.5, (1.0, 0.96, 0.9))
    area('PL_fill', (-2.4, -1.5, 1.4), (0, 0, 1.0), key * 0.3, 2.0, (0.85, 0.9, 1.0))
    area('PL_rim', (0.5, 2.5, 2.4), (0, 0, 1.3), key * 0.7, 1.0, (0.9, 0.95, 1.0))
    w = sc.world or bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.5, 0.52, 0.55, 1)
    bg.inputs[1].default_value = env
    if ground and 'PL_ground' not in bpy.data.objects:
        bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
        g = bpy.context.active_object
        g.name = 'PL_ground'
        m = bpy.data.materials.new('PL_ground_mat')
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
        b.inputs['Roughness'].default_value = 0.8
        g.data.materials.append(m)


def cycles(out, views, samples=64, res=(1000, 1300)):
    setup_cycles(samples, res)
    sc = bpy.context.scene
    co = _cam()
    paths = []
    for suf, loc, tgt, lens, ortho in views:
        aim(co, loc, tgt, lens, ortho)
        p = out.replace('.png', f'_{suf}.png') if suf else out
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths
