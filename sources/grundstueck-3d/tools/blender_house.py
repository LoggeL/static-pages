"""Build the furnished Blender scene and render its two walk-through viewpoints.

blender -b -P tools/blender_house.py -- --model public/Hausentwurf-214.glb --out /path/to/output
Optional --terrain accepts the sampled site grid (cols, rows, step, xStart, zStart, heights).
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--model", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--terrain", type=Path)
parser.add_argument("--preview", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.render.engine = "CYCLES"
preferences = bpy.context.preferences.addons["cycles"].preferences
for backend in ["METAL", "OPTIX", "CUDA", "HIP"]:
    try:
        preferences.compute_device_type = backend
        preferences.refresh_devices()
        if any(d.type == backend for d in preferences.devices):
            for device in preferences.devices:
                device.use = device.type == backend
            scene.cycles.device = "GPU"
            break
    except (TypeError, RuntimeError):
        continue
scene.cycles.samples = 12 if args.preview else 72
scene.cycles.use_denoising = True
scene.cycles.adaptive_threshold = 0.08 if args.preview else 0.025
scene.cycles.max_bounces = 10
scene.cycles.diffuse_bounces = 5
scene.cycles.transparent_max_bounces = 12
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.quality = 93
scene.render.resolution_percentage = 100
bpy.ops.import_scene.gltf(filepath=str(args.model.resolve()))
root = next(o for o in scene.objects if o.name.startswith("Wohnhaus"))
structure = {o: o.name for o in root.children}
collections = {}


def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


for key, name in [
    ("sockel", "Sockel"),
    ("eg", "Erdgeschoss"),
    ("og", "Obergeschoss"),
    ("dach", "Dach"),
    ("deckeEg", "Decke EG und Boden OG"),
    ("deckeOg", "Decke OG"),
    ("treppe", "Geschosstreppe"),
]:
    collections[key] = collection(name)
studio = collection("Studio und Gelände")
rig = collection("Licht und Kameras")


def move(obj, coll):
    for parent in list(obj.users_collection):
        parent.objects.unlink(obj)
    coll.objects.link(obj)


original = list(root.children_recursive)
for obj in original:
    ancestor = obj
    while ancestor.parent and ancestor not in structure:
        ancestor = ancestor.parent
    if ancestor in structure:
        move(obj, collections[structure[ancestor]])
reference = bpy.data.objects.new("Materialmaßstab · Meter", None)
rig.objects.link(reference)
reference.hide_viewport = False
reference.empty_display_size = 0.04


def rgb(hexcode):
    h = hexcode.lstrip("#")

    def linear(k):
        v = int(h[k : k + 2], 16) / 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return tuple(linear(i) for i in (0, 2, 4)) + (1.0,)


def material(name, col, rough=0.6, metal=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    n = mat.node_tree.nodes
    n.clear()
    shader = n.new("ShaderNodeBsdfPrincipled")
    outnode = n.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(shader.outputs[0], outnode.inputs["Surface"])
    shader.inputs["Base Color"].default_value = rgb(col)
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Metallic"].default_value = metal
    mat.diffuse_color = rgb(col)
    return mat, shader


def grain(mat, shader, colors, frequency, stretch=(1.0, 1.0, 1.0), relief=0.0007):
    tree = mat.node_tree

    def node(kind):
        return tree.nodes.new(kind)

    link = tree.links.new
    tc = node("ShaderNodeTexCoord")
    tc.object = reference
    scale = node("ShaderNodeVectorMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = stretch
    link(tc.outputs["Object"], scale.inputs[0])
    noise = node("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = frequency
    noise.inputs["Detail"].default_value = 3.5
    noise.inputs["Distortion"].default_value = 0.22
    link(scale.outputs[0], noise.inputs["Vector"])
    ramp = node("ShaderNodeValToRGB")
    for el, col, pos in zip(ramp.color_ramp.elements, colors, (0.20, 0.80)):
        el.position = pos
        el.color = rgb(col)
    link(noise.outputs["Fac"], ramp.inputs[0])
    link(ramp.outputs["Color"], shader.inputs["Base Color"])
    bump = node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = relief
    link(noise.outputs["Fac"], bump.inputs["Height"])
    link(bump.outputs[0], shader.inputs["Normal"])
    return tc, ramp


def textured(name, a, b, freq, stretch=(1, 1, 1), rough=0.65, relief=0.0007):
    m, sh = material(name, a, rough)
    grain(m, sh, (a, b), freq, stretch, relief)
    return m


putz = textured("Kalkputz warmweiß", "d2c6ab", "f1e9d4", 165, relief=0.0010, rough=0.88)
plaster = textured("Innenputz", "dfd5c2", "f1eddf", 190, relief=0.0007, rough=0.90)
stone = textured("Werkstein", "b4a695", "ded2bd", 95, relief=0.0012)
textured("Sockel mineralisch", "7e7768", "aca596", 72, relief=0.0023)
oak = textured("Eiche", "97643f", "c59867", 3.1, (0.7, 23, 13), relief=0.0006)
textured("Haustür Eiche", "81583c", "a37b57", 3.7, (13, 15, 0.45))
floor, sh = material("Dielen", "b88e65", 0.49)
tc, ramp = grain(floor, sh, ("946c4e", "d1ad83"), 3.6, (0.58, 22, 16))
nt = floor.node_tree
brick = nt.nodes.new("ShaderNodeTexBrick")
brick.inputs["Scale"].default_value = 1
brick.inputs["Brick Width"].default_value = 1.84
brick.inputs["Row Height"].default_value = 0.165
brick.inputs["Mortar Size"].default_value = 0.0017
brick.inputs["Mortar Smooth"].default_value = 0.55
brick.inputs["Mortar"].default_value = rgb("6e513b")
nt.links.new(tc.outputs["Object"], brick.inputs["Vector"])
nt.links.new(ramp.outputs["Color"], brick.inputs["Color1"])
shade = nt.nodes.new("ShaderNodeMixRGB")
shade.blend_type = "MULTIPLY"
shade.inputs[0].default_value = 0.53
shade.inputs[2].default_value = (0.65, 0.55, 0.45, 1)
nt.links.new(ramp.outputs[0], shade.inputs[1])
nt.links.new(shade.outputs[0], brick.inputs["Color2"])
nt.links.new(brick.outputs["Color"], sh.inputs["Base Color"])
textured("Unglasierter Tonziegel", "984a31", "b46648", 66, relief=0.0015)
textured("Firstziegel", "85432f", "ad593a", 88)
fabric = textured("Polsterstoff salbei", "728275", "a0ac98", 200, rough=0.94, relief=0.0013)
clay = textured("Steinzeug zimt", "aa6750", "b9785d", 135, rough=0.57)
linen = textured("Leinen natur", "c4b49c", "e0d3b8", 170, rough=0.92, relief=0.0012)
rugmat = textured("Schurwolle sand", "aa977b", "d2c1a7", 128, (1.4, 1, 1), 0.98, 0.0019)
panel = textured("Küchenfront", "ada78e", "b4af97", 120, rough=0.48)
dark = material("Kochfeld", "262c2a", 0.19)[0]
steel = material("Rinne und Geländer", "656b68", 0.37, 0.65)[0]
black = material("Messing brüniert", "574736", 0.36, 0.63)[0]
ivory = material("Porzellan elfenbein", "e0dac9", 0.28)[0]
material("Fensterrahmen", "504f45", 0.48, 0.14)
material("Keramik", "e8e4d7", 0.25)
glass, gh = material("Fensterglas", "f6fbf9", 0.045)
gh.inputs["Transmission Weight"].default_value = 1
gh.inputs["IOR"].default_value = 1.45
gt = glass.node_tree
trans = gt.nodes.new("ShaderNodeBsdfTransparent")
paths = gt.nodes.new("ShaderNodeLightPath")
mix = gt.nodes.new("ShaderNodeMixShader")
gt.links.new(paths.outputs["Is Shadow Ray"], mix.inputs[0])
gt.links.new(gh.outputs[0], mix.inputs[1])
gt.links.new(trans.outputs[0], mix.inputs[2])
gt.links.new(mix.outputs[0], next(n for n in gt.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"])
artm = [
    material("Pigment " + n, c, 0.94)[0]
    for n, c in [
        ("Kreide", "e3d5ba"),
        ("Ocker", "b87c50"),
        ("Ton", "985940"),
        ("Schiefer", "525e59"),
        ("Sand", "c8b28e"),
    ]
]
ceiling = material("Mineralweiß · Decken", "e9e4d8", 0.93)[0]


# Room coordinates follow the plan: u from the street, v towards the courtyard.
def pt(u, v, z):
    return (u - 5.5, 3.575 - v, z)


def link_mesh(name, vertices, faces, mat, coll):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    mesh.materials.append(mat)
    return obj


def soften(obj, w):
    if w <= 0:
        return
    mod = obj.modifiers.new("Gerundete Kanten", "BEVEL")
    mod.width = w
    mod.segments = 3
    mod = obj.modifiers.new("Flächennormalen", "WEIGHTED_NORMAL")
    mod.keep_sharp = True


def block(coll, name, center, size, mat, bev=0, angle=0):
    x, y, z = [v / 2 for v in size]
    coords = [
        (-x, -y, -z),
        (x, -y, -z),
        (x, y, -z),
        (-x, y, -z),
        (-x, -y, z),
        (x, -y, z),
        (x, y, z),
        (-x, y, z),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = link_mesh(name, coords, faces, mat, coll)
    obj.location = pt(*center)
    obj.rotation_euler.z = angle
    soften(obj, bev)
    return obj


def lathe(coll, name, place, profile, mat, segments=64):
    vertices = []
    faces = []
    for r, z in profile:
        for i in range(segments):
            a = i * 2 * math.pi / segments
            vertices.append((r * math.cos(a), r * math.sin(a), z))
    for j in range(len(profile) - 1):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    obj = link_mesh(name, vertices, faces, mat, coll)
    obj.location = pt(*place)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def line(coll, name, coords, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(len(coords) - 1)
    for p, xyz in zip(spline.points, coords):
        p.co = (*pt(*xyz), 1)
    obj = bpy.data.objects.new(name, curve)
    coll.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def light(name, loc, target, power, color, size, kind="AREA"):
    data = bpy.data.lights.new(name, kind)
    data.energy = power
    data.color = color
    if kind == "AREA":
        data.shape = "DISK"
        data.size = size
    if kind == "SUN":
        data.angle = size
    obj = bpy.data.objects.new(name, data)
    rig.objects.link(obj)
    obj.location = loc
    aim(obj, target)
    return obj


# GLB boxes can share one unit cube. Give only the touched objects private geometry.
for obj in original:
    if obj.type != "MESH":
        continue
    mat = obj.active_material
    if not mat:
        continue
    if obj.name.startswith(("Fußboden Erdgeschoss", "Geschossdecke mit Treppenloch", "Decke über OG")):
        obj.data = obj.data.copy()
        obj.data.materials.append(ceiling)
        idx = len(obj.data.materials) - 1
        normal = obj.matrix_world.to_3x3().inverted().transposed()
        for face in obj.data.polygons:
            nz = (normal @ face.normal).normalized().z
            if nz < -0.8:
                face.material_index = idx
        obj.data.materials.append(putz)
        for face in obj.data.polygons:
            if abs((normal @ face.normal).normalized().z) < 0.5:
                face.material_index = len(obj.data.materials) - 1
    # Use metre-space bevel widths on built-in furniture, independent of its glTF scale.
    if obj.name.split(".")[0] in (
        "Platte",
        "Sitz",
        "Rücken",
        "Stuhlsitz",
        "Rückenlehne",
        "Stuhlbein",
        "Bein",
        "Arbeitsfläche",
        "Matratze",
        "Kissen",
        "Decke",
    ):
        from mathutils import Matrix

        obj.data = obj.data.copy()
        sz = obj.scale.copy()
        obj.data.transform(Matrix.Diagonal((*sz, 1)))
        obj.scale = (1, 1, 1)
        w = 0.034 if obj.name.split(".")[0] in ("Sitz", "Rücken", "Kissen", "Matratze") else 0.008
        soften(obj, w)

# Keep the tile centres and pitches of the measured roof. Replace the flat tile tops with a
# shared pressed-clay cross-section on each slope, entirely below the original ridge cap.
tile_rows = {}
for obj in original:
    if obj.type != "MESH" or not obj.parent or not obj.parent.name.startswith("Unglasierte Tonziegel"):
        continue
    key = obj.data.name
    if key not in tile_rows:
        bounds = [Vector(p) for p in obj.bound_box]
        left, right = min(v.x for v in bounds), max(v.x for v in bounds)
        back, front = min(v.y for v in bounds), max(v.y for v in bounds)
        # Obtain the actual slope from the four uppermost corners in local mesh coordinates.
        coords = [v.co for v in obj.data.vertices]
        high0 = max(v.z for v in coords if abs(v.y - back) < 0.0001)
        high1 = max(v.z for v in coords if abs(v.y - front) < 0.0001)
        points = []
        faces = []
        segments = 14
        for j in range(2):
            for i in range(segments + 1):
                t = i / segments
                raised = 0.017 * (0.5 + 0.5 * math.cos(math.tau * (t - 0.10))) ** 3
                z = (high0 if j == 0 else high1) - 0.007 + raised
                points.append((left + (right - left) * t, back if j == 0 else front, z))
        for i in range(segments):
            faces.append((i, i + 1, i + segments + 2, i + segments + 1))
        mesh = bpy.data.meshes.new("Profilierter Tonziegel")
        mesh.from_pydata(points, [], faces)
        mesh.update()
        mesh.materials.append(obj.active_material)
        for face in mesh.polygons:
            face.use_smooth = True
        tile_rows[key] = mesh
    obj.data = tile_rows[key]

eg, og = collections["eg"], collections["og"]
for coll, z, code in [(eg, 0, "EG"), (og, 3, "OG")]:
    # One uninterrupted west wall is drawn in the plan. Its baseboard stays below glazing.
    block(coll, "Sockelleiste " + code, (7, 0.382, z + 0.042), (7.15, 0.027, 0.084), plaster, 0.002)
    block(
        coll,
        "Sockelleiste Garten " + code,
        (10.619, 2.26, z + 0.042),
        (0.025, 3.77, 0.084),
        plaster,
        0.002,
    )
    for i, (u, v) in enumerate([(6.3, 2.35)] if not z else [(6.27, 5.13), (4.72, 1.5)]):
        high = z + (2.7 if not z else 2.65)
        drop = high - (z + 2.08)
        line(coll, "Pendelleitung", [(u, v, high), (u, v, high - drop)], 0.0065, black)
        lathe(
            coll,
            "Rosette",
            (u, v, high - 0.023),
            [(0, 0), (0.064, 0), (0.064, 0.023), (0, 0.023)],
            black,
        )
        lathe(
            coll,
            "Pendelleuchte · gefalteter Schirm",
            (u, v, z + 2.015),
            [
                (0.021, 0.18),
                (0.07, 0.166),
                (0.13, 0.134),
                (0.216, 0.083),
                (0.28, 0.038),
                (0.303, 0.006),
                (0.305, 0),
                (0.292, 0.001),
                (0.201, 0.065),
                (0.1, 0.122),
                (0.018, 0.144),
            ],
            linen,
        )
        light(
            "Licht über Tisch " + code + str(i),
            pt(u, v, z + 2.045),
            pt(u, v, z),
            30,
            (1, 0.73, 0.48),
            0.23,
        )
    bounce = light(
        "Indirektes Raumlicht " + code,
        pt(7.0, 3.6, z + 1.75),
        pt(7.4, 3.4, z + 2.65),
        65,
        (0.89, 0.94, 1),
        2.6,
    )
    bounce.visible_camera = False
    bounce.visible_glossy = False
    bounce.visible_transmission = False

for obj in original:
    if obj.type != "MESH" or not obj.name.startswith(("Tür ", "Nebeneingang (", "Haupteingang (")):
        continue
    corners = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
    lo = [min(v[i] for v in corners) for i in range(3)]
    hi = [max(v[i] for v in corners) for i in range(3)]
    if hi[2] - lo[2] < 1.5 or max(hi[0] - lo[0], hi[1] - lo[1]) < 0.45:
        continue
    coll = og if lo[2] > 2 else eg
    u = (lo[0] + hi[0]) / 2 + 5.5
    v = 3.575 - (lo[1] + hi[1]) / 2
    z = lo[2] + 1.03
    if hi[0] - lo[0] > hi[1] - lo[1]:
        u = hi[0] + 5.5 - 0.10
        for sign in (-1, 1):
            vv = v + sign * ((hi[1] - lo[1]) / 2 + 0.005)
            block(coll, "Drückerrosette", (u, vv, z), (0.055, 0.009, 0.055), black, 0.006)
            line(
                coll,
                "Türklinke",
                [(u, vv, z), (u, vv + sign * 0.05, z), (u - 0.11, vv + sign * 0.05, z)],
                0.011,
                steel,
            )
    else:
        v = 3.575 - lo[1] - 0.11
        for sign in (-1, 1):
            uu = u + sign * ((hi[0] - lo[0]) / 2 + 0.005)
            block(coll, "Drückerrosette", (uu, v, z), (0.009, 0.055, 0.055), black, 0.006)
            line(
                coll,
                "Türklinke",
                [(uu, v, z), (uu + sign * 0.05, v, z), (uu + sign * 0.05, v - 0.11, z)],
                0.011,
                steel,
            )


def drape(coll, v0, v1, level):
    u = 10.47
    top = level + 2.48
    bottom = level + 0.095
    verts = []
    faces = []
    segments = 56
    for j in range(5):
        for i in range(segments + 1):
            t = i / segments
            fold = math.sin(t * math.tau * 6 + 0.09 * j)
            x = u + 0.032 * fold + 0.006 * math.cos(t * math.tau * 4 + j * 0.4)
            v = v0 + (v1 - v0) * t * (1 + 0.02 * j)
            verts.append(pt(x, v, top + (bottom - top) * j / 4 + (0.006 * fold if j == 4 else 0)))
    for j in range(4):
        for i in range(segments):
            a = j * (segments + 1) + i
            faces.append((a, a + 1, a + segments + 2, a + segments + 1))
    curtain = link_mesh("Leinenvorhang", verts, faces, linen, coll)
    for face in curtain.data.polygons:
        face.use_smooth = True


for coll, z in [(eg, 0), (og, 3)]:
    line(coll, "Vorhangstange", [(10.50, 0.54, z + 2.50), (10.50, 4.42, z + 2.50)], 0.012, black)
    drape(coll, 0.56, 0.88, z)
    drape(coll, 4.09, 4.39, z)
    # Daylight at the inside of each window reveal avoids lighting the outside plaster artificially.
    positions = [(1.24, 0.74), (2.5, 0.77), (3.75, 0.74)]
    for v, width in positions:
        fill = light(
            "Tageslicht durch Gartenfenster",
            pt(10.60, v, z + 1.56),
            pt(4.0, v + 0.15, z + 0.97),
            60,
            (0.81, 0.91, 1),
            width,
        )
        fill.data.shape = "RECTANGLE"
        fill.data.size = width
        fill.data.size_y = 1.06
        fill.visible_camera = False
        fill.visible_glossy = False
        fill.visible_transmission = False
    for u in [4.90, 6.75] if z == 0 else [4.90]:
        fill = light(
            "Tageslicht durch Hoffenster",
            pt(u, 6.76, z + 1.52),
            pt(u - 0.3, 1.4, z + 0.83),
            53,
            (0.86, 0.92, 1),
            0.70,
        )
        fill.data.shape = "RECTANGLE"
        fill.data.size_y = 1.05
        fill.visible_camera = False
        fill.visible_glossy = False
        fill.visible_transmission = False

# Four dining chairs with shaped oak backs and upholstered seats on the original seating centres.
for obj in original:
    if (
        obj.type == "MESH"
        and obj.parent
        and obj.parent.name == "Tisch"
        and obj.name.startswith(("Stuhlbein", "Stuhlsitz", "Rückenlehne"))
    ):
        bpy.data.objects.remove(obj, do_unlink=True)
for u in [5.72, 6.88]:
    for v, sign in [(1.58, -1), (3.12, 1)]:
        block(eg, "Essstuhl · Sitzpolster", (u, v, 0.457), (0.412, 0.401, 0.073), linen, 0.032)
        for side in [-1, 1]:
            for end in [-1, 1]:
                x = u + side * 0.171
                y = v + end * 0.155
                line(
                    eg,
                    "Essstuhl · Eichenbein",
                    [(x + side * 0.032, y + end * 0.036, 0.012), (x, y, 0.433)],
                    0.021,
                    oak,
                )
            line(
                eg,
                "Essstuhl · Rückenholm",
                [(u + side * 0.173, v + sign * 0.147, 0.42), (u + side * 0.185, v + sign * 0.197, 0.77)],
                0.018,
                oak,
            )
        verts = []
        faces = []
        segments = 16
        for j in range(4):
            for i in range(segments + 1):
                t = 2 * i / segments - 1
                thick = 0.010 if j >= 2 else -0.010
                h = 0.656 if j in (0, 3) else 0.811
                verts.append(
                    pt(u + t * 0.205, v + sign * (0.216 - 0.053 * t * t + thick), h - 0.017 * t * t)
                )
        for j in range(4):
            for i in range(segments):
                a = j * (segments + 1) + i
                b = ((j + 1) % 4) * (segments + 1) + i
                faces.append((a, b, b + 1, a + 1))
        chair = link_mesh("Essstuhl · gebogene Rückenlehne", verts, faces, oak, eg)
        soften(chair, 0.004)


def artwork(coll, u, z, w, h, palette):
    v = 0.401
    block(coll, "Rahmen in Eiche", (u, v, z), (w, 0.047, h), oak, 0.007)
    block(coll, "Passepartout", (u, v + 0.025, z), (w - 0.035, 0.008, h - 0.035), ivory)
    block(coll, "Fine-Art-Druck · Papier", (u, v + 0.031, z), (w * 0.84, 0.002, h * 0.84), artm[0])
    # Cut-paper composition, each print uses its own arrangement in the frame.
    for row, (x, y, ww, hh, idx) in enumerate(palette):
        block(
            coll,
            "Pigmentdruck",
            (u + x * w, v + 0.033 + row * 0.00045, z + y * h),
            (ww * w, 0.0004, hh * h),
            artm[idx],
        )


artwork(
    eg,
    5.18,
    1.63,
    0.76,
    0.92,
    [(-0.11, 0.035, 0.42, 0.53, 1), (0.13, -0.20, 0.33, 0.24, 3), (0.14, 0.22, 0.2, 0.18, 4)],
)
artwork(
    eg,
    6.1,
    1.63,
    0.76,
    0.92,
    [(0.11, 0.04, 0.46, 0.58, 4), (-0.15, 0.15, 0.26, 0.30, 2), (-0.1, -0.22, 0.36, 0.08, 3)],
)
artwork(
    og,
    6.68,
    4.52,
    1.20,
    0.88,
    [(-0.14, 0.0, 0.46, 0.66, 4), (0.14, 0.09, 0.34, 0.39, 3), (0.11, -0.13, 0.4, 0.16, 2)],
)


def bowl(coll, u, v, z, r, mat):
    return lathe(
        coll,
        "Schale aus Steinzeug",
        (u, v, z),
        [
            (0, 0.002),
            (0.28 * r, 0),
            (0.43 * r, 0.07 * r),
            (0.82 * r, 0.23 * r),
            (r, 0.39 * r),
            (r * 0.99, 0.43 * r),
            (0.9 * r, 0.39 * r),
            (0.75 * r, 0.28 * r),
            (0.38 * r, 0.12 * r),
            (0, 0.1 * r),
        ],
        mat,
    )


def vase(coll, u, v, z, r, h, mat):
    return lathe(
        coll,
        "Vase, gedreht",
        (u, v, z),
        [
            (0, 0),
            (0.58 * r, 0),
            (0.79 * r, 0.04 * h),
            (0.98 * r, 0.21 * h),
            (r, 0.49 * h),
            (0.8 * r, 0.71 * h),
            (0.48 * r, 0.86 * h),
            (0.45 * r, h),
            (0.36 * r, h),
            (0.36 * r, 0.90 * h),
            (0.48 * r, 0.81 * h),
        ],
        mat,
    )


def books(coll, u, v, z, n=3):
    for i in range(n):
        w = 0.31 + 0.025 * (i % 2)
        d = 0.22 - 0.012 * i
        block(
            coll,
            "Leinenband",
            (u + 0.014 * i, v, z + 0.016),
            (w, d, 0.032),
            [artm[3], artm[2], linen][i % 3],
            0.002,
            0.026 * i,
        )
        block(
            coll,
            "Buchschnitt",
            (u + 0.014 * i + 0.002, v - 0.003, z + 0.016),
            (w - 0.008, d - 0.005, 0.024),
            ivory,
            0.001,
            0.026 * i,
        )
        z += 0.032


vase(eg, 6.45, 2.38, 0.765, 0.122, 0.24, clay)
bowl(eg, 6.06, 2.35, 0.765, 0.14, ivory)
books(eg, 5.15, 0.68, 0.854)
vase(eg, 6.72, 0.66, 0.851, 0.13, 0.27, ivory)
for i in range(6):
    u = 4.48 + 0.48 * i
    block(eg, "Sideboard · gerahmte Front", (u, 0.911, 0.46), (0.462, 0.018, 0.69), panel, 0.008)
    block(eg, "Eingelassener Griff", (u + 0.15, 0.923, 0.70), (0.085, 0.011, 0.010), black, 0.002)
books(eg, 9.92, 0.83, 0.785, 2)
vase(eg, 9.42, 0.75, 0.784, 0.075, 0.18, ivory)
block(og, "Wollteppich im Wohnbereich", (8.87, 2.03, 3.008), (2.77, 3.03, 0.013), rugmat, 0.006)
for u, v, c in [
    (8.45, 1.21, linen),
    (8.44, 1.8, clay),
    (9.44, 2.76, linen),
    (6.16, 6.29, rugmat),
    (7.27, 6.27, linen),
]:
    o = block(og, "Lehnenkissen", (u, v, 3.55), (0.41, 0.16, 0.38), c, 0.07, 0.07)
    o.rotation_euler.x = -0.17
for u, v in [(9.50, 1.55), (9.68, 1.91)]:
    r = 0.31 if v < 1.6 else 0.24
    h = 0.37 if v < 1.6 else 0.30
    lathe(
        og,
        "Beistelltisch",
        (u, v, 3.015),
        [
            (0, 0),
            (0.16, 0),
            (0.11, 0.03),
            (0.085, h - 0.037),
            (r * 0.97, h - 0.035),
            (r, h - 0.018),
            (r * 0.97, h),
            (0, h),
        ],
        oak,
    )
books(og, 9.5, 1.55, 3.386, 1)
bowl(og, 6.38, 5.17, 3.762, 0.20, clay)
vase(og, 5.82, 5.35, 3.762, 0.066, 0.153, ivory)
for a, b, tall in [
    (0.38, 1.24, False),
    (1.24, 2.12, False),
    (2.12, 3.02, False),
    (4.20, 5.05, True),
    (5.05, 5.92, False),
    (5.92, 6.76, True),
]:
    if not tall:
        for j in range(3):
            z = 3.23 + j * 0.238
            block(
                og, "Küchenauszug", (4.111, (a + b) / 2, z), (0.022, b - a - 0.022, 0.226), panel, 0.004
            )
            block(
                og,
                "Griffleiste",
                (4.125, (a + b) / 2, z + 0.080),
                (0.012, (b - a) * 0.55, 0.012),
                black,
                0.003,
            )
for v in [0.7, 1.35, 2.0, 2.65]:
    block(og, "Oberschrank", (3.69, v, 4.85), (0.46, 0.627, 0.60), panel, 0.008)
    block(og, "Oberschrank · Tür", (3.931, v, 4.85), (0.019, 0.622, 0.576), panel, 0.005)
block(og, "Nischenrückwand", (3.478, 1.7, 4.18), (0.051, 2.61, 0.49), stone, 0.004)
line(
    og,
    "Küchenarmatur",
    [
        (3.64, 1.63, 3.94),
        (3.64, 1.63, 4.19),
        (3.67, 1.63, 4.24),
        (3.81, 1.63, 4.24),
        (3.85, 1.63, 4.20),
        (3.85, 1.63, 4.14),
    ],
    0.017,
    steel,
)
vase(og, 3.74, 2.72, 3.94, 0.055, 0.15, clay)
bowl(og, 3.83, 0.83, 3.94, 0.125, ivory)
for u in [3.65, 3.87]:
    for v in [5.36, 5.63]:
        points = [
            (u + 0.085 * math.cos(i * math.tau / 48), v + 0.085 * math.sin(i * math.tau / 48), 3.9515)
            for i in range(49)
        ]
        line(og, "Induktionszone", points, 0.0023, steel)

for coll, places, z in [
    (eg, [(5.75, 2.12), (6.85, 2.59)], 0.76),
    (og, [(6.54, 4.80), (6.03, 5.57)], 3.76),
]:
    for u, v in places:
        lathe(
            coll,
            "Teller, Steinzeug",
            (u, v, z + 0.004),
            [
                (0, 0),
                (0.067, 0),
                (0.08, 0.004),
                (0.128, 0.014),
                (0.132, 0.019),
                (0.129, 0.024),
                (0.118, 0.017),
                (0.074, 0.008),
                (0, 0.008),
            ],
            ivory,
        )
        block(coll, "Leinenserviette", (u + 0.22, v, z + 0.008), (0.086, 0.18, 0.009), linen, 0.004, 0.1)
        line(
            coll,
            "Tafelmesser",
            [(u + 0.226, v - 0.058, z + 0.016), (u + 0.226, v + 0.089, z + 0.016)],
            0.005,
            steel,
        )
        lathe(
            coll,
            "Trinkbecher",
            (u + 0.12, v + 0.182, z + 0.004),
            [
                (0.042, 0.002),
                (0.042, 0.007),
                (0.048, 0.091),
                (0.047, 0.094),
                (0.043, 0.095),
                (0.041, 0.013),
                (0.033, 0.009),
                (0, 0.009),
            ],
            ivory,
        )
for v in [4.2, 5.92]:
    block(og, "Hochschrank · obere Front", (4.108, v + 0.419, 4.91), (0.025, 0.80, 0.43), panel, 0.005)
block(og, "Backofentür · Sichtfenster", (4.131, 6.32, 3.96), (0.014, 0.61, 0.37), dark, 0.01)
block(og, "Backofen · Griff", (4.168, 6.32, 4.18), (0.057, 0.59, 0.026), steel, 0.005)
world = bpy.data.worlds.new("Tageslicht")
scene.world = world
world.use_nodes = True
nodes = world.node_tree.nodes
links = world.node_tree.links
tex = nodes.new("ShaderNodeTexCoord")
sep = nodes.new("ShaderNodeSeparateXYZ")
links.new(tex.outputs["Normal"], sep.inputs[0])
sky = nodes.new("ShaderNodeValToRGB")
sky.color_ramp.elements[0].color = (0.86, 0.87, 0.82, 1)
sky.color_ramp.elements[1].color = (0.38, 0.58, 0.84, 1)
links.new(sep.outputs["Z"], sky.inputs[0])
bg = nodes.get("Background")
links.new(sky.outputs[0], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.80
light("Sonne", (10, -6, 9), (0, 0, 0.5), 3.1, (1, 0.93, 0.82), math.radians(3), "SUN")
groundmat = textured("Studio · mineralischer Boden", "b9b6a9", "d2cec0", 3.5, rough=0.93, relief=0.0011)
if args.terrain:
    grid = json.loads(args.terrain.read_text())
    cols = grid["cols"]
    rows = grid["rows"]
    spacing = grid["step"]
    verts = [
        (
            grid["xStart"] + spacing * i,
            -grid["zStart"] - spacing * j,
            grid["heights"][j * cols + i] - 0.025,
        )
        for j in range(rows)
        for i in range(cols)
    ]
    faces = [
        (j * cols + i, (j + 1) * cols + i, (j + 1) * cols + i + 1, j * cols + i + 1)
        for j in range(rows - 1)
        for i in range(cols - 1)
    ]
    ring = (
        list(range(cols))
        + [j * cols + cols - 1 for j in range(1, rows)]
        + list(range(rows * cols - 2, (rows - 1) * cols - 1, -1))
        + [j * cols for j in range(rows - 2, 0, -1)]
    )
    outer = []
    for idx in ring:
        x, y, z = verts[idx]
        outer.append(len(verts))
        verts.append((x * 2.3, y * 2.3, -2.055))
    for i, a in enumerate(ring):
        j = (i + 1) % len(ring)
        faces.append((a, ring[j], outer[j], outer[i]))
    link_mesh("Gelände am Haus", verts, faces, groundmat, studio)
block(studio, "Studioboden", (5.5, 3.575, -2.08), (1500, 1500, 0.08), groundmat)


def camera(name, loc, target, pano=False):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    rig.objects.link(cam)
    cam.location = loc
    aim(cam, target)
    cam.data.lens = 32
    cam.data.clip_start = 0.035
    cam.data.clip_end = 2000
    if pano:
        cam.data.type = "PANO"
        cam.data.panorama_type = "EQUIRECTANGULAR"
    return cam


outside = camera("Außenansicht", (17.6, -13.0, 7.9), (0, 0, 3.0))
outside.data.lens = 41
cams = {"aussen": outside}
for key, label, uv, target, z in [
    ("eg", "Erdgeschoss · Esstisch", (4.25, 4.17), (7.55, 2.01), 1.53),
    ("og", "Obergeschoss · Wohnküche", (8.40, 3.72), (5.04, 4.28), 4.53),
]:
    cams[key] = camera(label, pt(*uv, z), pt(*target, z), True)

# Layer exclusion works in the native .blend as well as when rendering the open floors.
main_layer = scene.view_layers[0]
main_layer.name = "Haus komplett"
for name, hide in [
    ("EG freigelegt", ["og", "deckeOg", "deckeEg", "dach"]),
    ("OG freigelegt", ["dach", "deckeOg"]),
]:
    layer = scene.view_layers.new(name)
    for k in hide:
        layer.layer_collection.children[collections[k].name].exclude = True
    layer.layer_collection.children[studio.name].exclude = True
    layer.use = False
scene.camera = outside
for area in bpy.context.screen.areas:
    if area.type == "VIEW_3D":
        sp = area.spaces.active
        sp.overlay.show_overlays = False
        sp.shading.color_type = "MATERIAL"
        sp.shading.light = "STUDIO"
        sp.shading.show_cavity = True
        sp.shading.type = "MATERIAL"
        sp.shading.use_scene_lights = True
        sp.region_3d.view_rotation = Vector((-8, 13, -20)).to_track_quat("-Z", "Y")
        sp.region_3d.view_distance = 16.3
        sp.region_3d.view_location = (0, 0, 0.55)
bpy.ops.object.select_all(action="DESELECT")
scene.render.resolution_x, scene.render.resolution_y = 1680, 1120
scene.render.filepath = "//Hausansicht.webp"
if not args.preview:
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.window.view_layer = scene.view_layers["EG freigelegt"]
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "Wohnhaus-214.blend"), compress=True)
    bpy.context.window.view_layer = main_layer
for key, cam in cams.items():
    scene.camera = cam
    scene.view_settings.exposure = 0.0 if key == "aussen" else 0.30
    if key == "aussen":
        w, h = (800, 530) if args.preview else (1800, 1200)
    else:
        w, h = (1200, 600) if args.preview else (4096, 2048)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = str(out / (key + ".webp"))
    bpy.ops.render.render(write_still=True, layer=main_layer.name)
    if key != "aussen":
        pano_rot = cam.rotation_euler.to_quaternion()
        ahead = pano_rot @ Vector((0, 0, -1))
        cam.data.type = "PERSP"
        cam.data.lens = 22
        aim(cam, cam.location + ahead + Vector((0, 0, -0.105)))
        scene.render.resolution_x, scene.render.resolution_y = (
            (800, 500) if args.preview else (1500, 940)
        )
        scene.render.filepath = str(out / (key + "-blick.webp"))
        bpy.ops.render.render(write_still=True, layer=main_layer.name)
    print("RENDERED", key, w, h, flush=True)
