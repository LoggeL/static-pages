# Vorschau-Renderings des Karabiners (Cycles, Metal).
# blender -b <carbine.blend> -P weapon_preview.py -- --out <dir> --prefix p_ [--views left,right,q34,top,sight,bolt,light,muzzle,dark,fp]
#                                                     [--w 960 --h 540 --samples 48] [--light studio|dark]
import bpy, sys, os, math, argparse
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--prefix", default="p_")
ap.add_argument("--views", default="left,right,q34,top")
ap.add_argument("--w", type=int, default=960)
ap.add_argument("--h", type=int, default=540)
ap.add_argument("--samples", type=int, default=48)
A = ap.parse_args(argv)

sc = bpy.context.scene
for collection in ('Casing', 'MagSpare'):
    if collection in bpy.data.collections:
        for obj in bpy.data.collections[collection].all_objects:
            obj.hide_render = True
sc.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print("GPU nicht verfügbar", e)
sc.cycles.samples = A.samples
sc.cycles.use_denoising = True
sc.render.resolution_x = A.w
sc.render.resolution_y = A.h
sc.render.film_transparent = False
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
try:
    sc.render.image_settings.color_management = 'FOLLOW_SCENE'
except Exception:
    pass
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'

# Mittelpunkt der Waffe (Bounding Box über alle Meshes)
lo = Vector((1e9, 1e9, 1e9)); hi = -lo
for o in sc.objects:
    if o.type == 'MESH' and not o.hide_render:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
CEN = (lo + hi) / 2
print("BBox mm", [round(v * 1000, 1) for v in lo], [round(v * 1000, 1) for v in hi], "Länge", round((hi.y - lo.y) * 1000, 1))

world = bpy.data.worlds.new("W") if not sc.world else sc.world
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")

LIGHTS = []


def clear_lights():
    for o in list(sc.objects):
        if o.get("_prev"):
            bpy.data.objects.remove(o, do_unlink=True)


def add_light(kind, loc, rot, energy, size=1.0, color=(1, 1, 1), spot=None):
    ld = bpy.data.lights.new("L", kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.size = size
    if kind == 'SPOT':
        ld.spot_size = math.radians(spot or 40)
        ld.spot_blend = 0.6
        ld.shadow_soft_size = 0.01
    o = bpy.data.objects.new("L", ld)
    o["_prev"] = 1
    sc.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    return o


def look_at(o, target):
    d = (Vector(target) - o.location)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def studio():
    clear_lights()
    bg.inputs[0].default_value = (0.18, 0.18, 0.19, 1)
    bg.inputs[1].default_value = 0.35
    k = add_light('AREA', (0.6, -0.9, 1.0) , (0, 0, 0), 180, 1.2)
    look_at(k, CEN)
    f = add_light('AREA', (-1.0, 0.4, 0.4), (0, 0, 0), 70, 1.5)
    look_at(f, CEN)
    r = add_light('AREA', (0.2, 1.2, 0.9), (0, 0, 0), 120, 0.6, (0.9, 0.95, 1.0))
    look_at(r, CEN)
    t = add_light('AREA', (0.0, 0.1, 1.4), (0, 0, 0), 60, 2.0)
    look_at(t, CEN)


def dark(cam):
    clear_lights()
    bg.inputs[0].default_value = (0.02, 0.025, 0.04, 1)
    bg.inputs[1].default_value = 0.05
    s = add_light('SPOT', cam.location + Vector((0.12, -0.05, 0.15)), (0, 0, 0), 25, spot=45, color=(1.0, 0.97, 0.92))
    look_at(s, CEN)
    s2 = add_light('POINT', CEN + Vector((-0.8, 1.6, 0.6)), (0, 0, 0), 8, color=(0.3, 0.4, 1.0))


cam_d = bpy.data.cameras.new("C")
cam = bpy.data.objects.new("C", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam


def view(name):
    cam_d.type = 'PERSP'
    cam_d.lens = 50
    L = (hi.y - lo.y)
    c = CEN.copy()
    if name == "left":
        cam_d.type = 'ORTHO'; cam_d.ortho_scale = L * 1.08
        cam.location = c + Vector((-2.0, 0, 0)); look_at(cam, c)
    elif name == "right":
        cam_d.type = 'ORTHO'; cam_d.ortho_scale = L * 1.08
        cam.location = c + Vector((2.0, 0, 0)); look_at(cam, c)
    elif name == "top":
        cam_d.type = 'ORTHO'; cam_d.ortho_scale = L * 1.08
        cam.location = c + Vector((0, 0, 2.0)); look_at(cam, c)
        cam.rotation_euler = Euler((0, 0, math.radians(90)))
    elif name == "sidebig":
        cam_d.type = 'ORTHO'; cam_d.ortho_scale = L * 1.04
        cam.location = c + Vector((2.0, 0, 0)); look_at(cam, c)
    elif name == "q34":
        cam_d.lens = 45
        cam.location = c + Vector((1.05, -0.95, 0.55)); look_at(cam, c + Vector((0, 0.02, -0.01)))
    elif name == "q34l":
        cam_d.lens = 45
        cam.location = c + Vector((-1.05, 0.85, 0.45)); look_at(cam, c)
    elif name == "sight":
        cam_d.lens = 70
        t = Vector((0, 0.09, 0.12))
        cam.location = t + Vector((0.20, -0.26, 0.13)); look_at(cam, t)
    elif name == "eye":
        e = sc.objects.get("W_SightEye")
        cam_d.lens = 35
        cam.location = e.matrix_world.translation.copy(); cam.rotation_euler = Euler((math.radians(90), 0, 0))
    elif name == "bolt":
        cam_d.lens = 70
        t = Vector((0.0, 0.08, 0.04))
        cam.location = t + Vector((0.30, -0.06, 0.08)); look_at(cam, t)
    elif name == "lower":
        cam_d.lens = 70
        t = Vector((-0.0, 0.06, 0.02))
        cam.location = t + Vector((-0.30, -0.06, 0.06)); look_at(cam, t)
    elif name == "light":
        cam_d.lens = 70
        t = Vector((0.03, 0.40, 0.07))
        cam.location = t + Vector((0.22, 0.22, 0.06)); look_at(cam, t)
    elif name == "muzzle":
        cam_d.lens = 70
        t = Vector((0.0, 0.50, 0.06))
        cam.location = t + Vector((0.16, 0.14, 0.08)); look_at(cam, t)
    elif name == "stock":
        cam_d.lens = 60
        t = Vector((0.0, -0.18, 0.02))
        cam.location = t + Vector((-0.30, -0.18, 0.12)); look_at(cam, t)
    elif name == "fp":
        # grob wie Bodycam-Sicht: Kamera hinten oben, Waffe nach vorn unten rechts
        cam_d.lens = 14
        cam.location = Vector((-0.10, -0.35, 0.30)); look_at(cam, Vector((0.02, 0.6, 0.05)))
    return cam


os.makedirs(A.out, exist_ok=True)
for v in A.views.split(","):
    isdark = v.endswith("_dark")
    vn = v.replace("_dark", "")
    view(vn)
    if isdark:
        dark(cam)
    else:
        studio()
    sc.render.filepath = os.path.join(A.out, A.prefix + v + ".png")
    bpy.ops.render.render(write_still=True)
    print("render", sc.render.filepath)
