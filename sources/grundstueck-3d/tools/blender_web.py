"""Export the furnished, isolated house from the native Blender scene.

blender -b Wohnhaus-214.blend -P tools/blender_web.py -- public/blender/haus.glb
The high-resolution Cycles panoramas are rendered by blender_house.py.
"""

import sys
from collections import defaultdict
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
from mathutils import Vector

target = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
house = bpy.context.scene
bpy.context.window.view_layer = house.view_layers["Haus komplett"]
deps = bpy.context.evaluated_depsgraph_get()
levels = {
    "Sockel": "sockel",
    "Erdgeschoss": "eg",
    "Obergeschoss": "og",
    "Dach": "dach",
    "Decke EG und Boden OG": "deckeEg",
    "Decke OG": "deckeOg",
    "Geschosstreppe": "treppe",
}
# All spans are in metres. Periods of the floor texture contain whole rows and boards.
crops = {
    "Dielen": (3.68, 1.32, "xy", 1024),
    "Eiche": (2.2, 0.9, "xy", 512),
    "Haustür Eiche": (1, 2.1, "xz", 512),
    "Polsterstoff salbei": (0.63, 0.63, "xy", 512),
    "Leinen natur": (0.57, 0.57, "xy", 512),
    "Schurwolle sand": (0.71, 0.71, "xy", 512),
    "Werkstein": (0.66, 0.66, "xy", 256),
    "Kalkputz warmweiß": (0.46, 0.46, "xy", 256),
    "Innenputz": (0.47, 0.47, "xy", 256),
    "Unglasierter Tonziegel": (0.34, 0.34, "xy", 256),
}


# Group source triangles by floor and the facade removed by the section button. The resulting
# primitives are small in number, including for the individually profiled roof tiles.
class Batch:
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.normals = []
        self.uvs = []


geometry = defaultdict(Batch)
for obj in house.objects:
    level = next((levels[c.name] for c in obj.users_collection if c.name in levels), None)
    if not level or obj.type not in {"MESH", "CURVE"} or obj.hide_render:
        continue
    ancestor = obj
    cut = False
    while ancestor:
        if ancestor.name in {"eg_ext_east", "eg_ext_south", "og_ext_east", "og_ext_south"}:
            cut = True
            break
        ancestor = ancestor.parent
    # The door handles use separate geometry; only those on the cut face belong to the section mask.
    if obj.name.startswith(("Türklinke", "Drückerrosette")):
        bbox = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
        cut = sum(v.x for v in bbox) / 8 < -5.2 or sum(v.y for v in bbox) / 8 < -3.32
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    if not mesh:
        continue
    try:
        mesh.calc_loop_triangles()
        matrix = evaluated.matrix_world
        normals = matrix.to_3x3().inverted_safe().transposed()
        flip = matrix.to_3x3().determinant() < 0
        points = [matrix @ v.co for v in mesh.vertices]
        per_material = {}
        for tri in mesh.loop_triangles:
            if not len(mesh.materials):
                continue
            mat = mesh.materials[tri.material_index]
            if not mat:
                continue
            batch = geometry[(level, cut, mat.name)]
            used = per_material.setdefault(mat.name, {})
            projection = normals @ tri.normal
            axis = max(range(3), key=lambda a: abs(projection[a]))
            order = [2, 1, 0] if flip else [0, 1, 2]
            face = []
            w, h, _, _ = crops.get(mat.name, (1.0, 1.0, "xy", 0))
            for k in order:
                index = tri.vertices[k]
                if index not in used:
                    used[index] = len(batch.vertices)
                    batch.vertices.append(tuple(points[index]))
                face.append(used[index])
                norm = (normals @ mesh.corner_normals[tri.loops[k]].vector).normalized()
                batch.normals.append(tuple(norm))
                x, y, z = points[index]
                u, v = (x, y) if axis == 2 else (x, z) if axis == 1 else (y, z)
                batch.uvs.append((u / w, v / h))
            batch.faces.append(face)
    finally:
        evaluated.to_mesh_clear()


def scene(name):
    s = bpy.data.scenes.new(name)
    bpy.context.window.scene = s
    return s


bakes = scene("Materialproben")
bakes.render.engine = "CYCLES"
bakes.cycles.samples = 1
bakes.cycles.device = "CPU"
bakes.render.bake.margin = 0
# Reference used by the texture-coordinate nodes in the native architectural materials.
bakes.collection.objects.link(bpy.data.objects["Materialmaßstab · Meter"])


def baked_color(name, crop, directory):
    w, h, axis, res = crop
    xy = [(0, 0), (w, 0), (w, h), (0, h)]
    verts = [(u, v, 0) if axis == "xy" else (u, 0, v) for u, v in xy]
    geom = bpy.data.meshes.new("Materialprobe")
    geom.from_pydata(verts, [], [(0, 1, 2, 3)])
    geom.update()
    uv = geom.uv_layers.new()
    for loop, (x, y) in zip(uv.data, xy):
        loop.uv = (x / w, y / h)
    obj = bpy.data.objects.new("Farbprobe", geom)
    bakes.collection.objects.link(obj)
    mat = bpy.data.materials[name].copy()
    geom.materials.append(mat)
    image = bpy.data.images.new(name + " · gebacken", width=res, height=res, alpha=False)
    nodes = mat.node_tree.nodes
    shader = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    output = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    emit = nodes.new("ShaderNodeEmission")
    src = shader.inputs["Base Color"]
    if src.is_linked:
        mat.node_tree.links.new(src.links[0].from_socket, emit.inputs["Color"])
    else:
        emit.inputs["Color"].default_value = src.default_value
    mat.node_tree.links.new(emit.outputs[0], output.inputs["Surface"])
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    nodes.active = tex
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.bake(type="EMIT", use_clear=True)
    image.file_format = "JPEG"
    image.filepath_raw = str(directory / (name + ".jpg"))
    image.save()
    image.pack()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(geom)
    bpy.data.materials.remove(mat)
    return image


with TemporaryDirectory() as tmp:
    directory = Path(tmp)
    images = {name: baked_color(name, settings, directory) for name, settings in crops.items()}
    web = scene("Hausmodell für den Viewer")
    webm = {}
    for level, cut, name in geometry:
        if name in webm:
            continue
        native = bpy.data.materials[name]
        shader = next(n for n in native.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        mat = bpy.data.materials.new(name + " · Modell")
        mat.use_nodes = True
        p = mat.node_tree.nodes.get("Principled BSDF")
        p.inputs["Base Color"].default_value = native.diffuse_color
        for channel in ("Roughness", "Metallic"):
            p.inputs[channel].default_value = shader.inputs[channel].default_value
        if name in images:
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = images[name]
            mat.node_tree.links.new(tex.outputs[0], p.inputs["Base Color"])
        if name == "Fensterglas":
            p.inputs["Base Color"].default_value = (0.52, 0.67, 0.68, 1)
            p.inputs["Alpha"].default_value = 0.21
            mat.surface_render_method = "BLENDED"
        webm[name] = mat
    for (level, cut, name), batch in geometry.items():
        m = bpy.data.meshes.new(name)
        m.from_pydata(batch.vertices, [], batch.faces)
        m.update()
        m.materials.append(webm[name])
        uv = m.uv_layers.new()
        for item, coords in zip(uv.data, batch.uvs):
            item.uv = coords
        for face in m.polygons:
            face.use_smooth = True
        m.normals_split_custom_set(batch.normals)
        o = bpy.data.objects.new(level + " · " + name + (" · Schnitt" if cut else ""), m)
        web.collection.objects.link(o)
        o["level"] = level
        o["frontCut"] = cut
    target.parent.mkdir(exist_ok=True, parents=True)
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        use_active_scene=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_yup=True,
        export_image_format="AUTO",
        export_jpeg_quality=90,
    )
print(
    "WEB_HOUSE",
    len(geometry),
    "batches",
    sum(len(b.faces) for b in geometry.values()),
    "triangles",
    target.stat().st_size,
    "bytes",
    flush=True,
)
