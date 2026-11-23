"""Export the furnished, isolated house (including toggleable water/power services) from Blender.

blender -b Wohnhaus-214.blend -P tools/blender_web.py -- public/blender/haus.glb
The high-resolution Cycles panoramas are rendered by blender_house.py.
Collections `Trinkwasser` and `Strom` are exported with custom properties `level`,
`frontCut`, and `service` (`water` | `power`) so the 3D web viewer can toggle them
cleanly via `blenderHouse.setServices({ water, power })`.
"""

import sys
from collections import defaultdict
from pathlib import Path
from tempfile import TemporaryDirectory

LEVEL_COLLECTIONS = {
    "Sockel": "sockel",
    "Erdgeschoss": "eg",
    "Obergeschoss": "og",
    "Dach": "dach",
    "Decke EG und Boden OG": "deckeEg",
    "Decke OG": "deckeOg",
    "Geschosstreppe": "treppe",
    "Treppenstudie · EG": "eg",
    "Treppenstudie · OG": "og",
}

SERVICE_COLLECTIONS = {
    "Trinkwasser": "water",
    "Strom": "power",
    "Entwurf · Trinkwasser": "water",
    "Entwurf · Strom": "power",
}

# All spans are in metres. Periods of the floor texture contain whole rows and boards.
CROPS = {
    "Dielen": (3.68, 1.32, "xy", 1024),
    "Eiche": (2.2, 0.9, "xy", 512),
    "Haustür Eiche": (1.0, 2.1, "xz", 512),
    "Polsterstoff salbei": (0.63, 0.63, "xy", 512),
    "Leinen natur": (0.57, 0.57, "xy", 512),
    "Schurwolle sand": (0.71, 0.71, "xy", 512),
    "Werkstein": (0.66, 0.66, "xy", 256),
    "Kalkputz warmweiß": (0.46, 0.46, "xy", 256),
    "Innenputz": (0.47, 0.47, "xy", 256),
    "Sockel mineralisch": (0.62, 0.62, "xy", 256),
    "Küchenfront": (0.52, 0.52, "xy", 256),
    "Bodenfliese": (0.90, 0.90, "xy", 256),
    "Unglasierter Tonziegel": (0.34, 0.34, "xy", 256),
}


def resolve_service_tag(obj):
    """Return 'water' or 'power' if obj belongs to a utility installation, else None."""
    getter = getattr(obj, "get", None)
    if callable(getter):
        svc = getter("service") or getter("utility_system")
        if svc in ("water", "power"):
            return svc
    for coll in getattr(obj, "users_collection", ()):
        if coll.name in SERVICE_COLLECTIONS:
            return SERVICE_COLLECTIONS[coll.name]
        c_get = getattr(coll, "get", None)
        if callable(c_get):
            svc = c_get("service") or c_get("utility_system")
            if svc in ("water", "power"):
                return svc
    return None


def resolve_export_meta(obj):
    """Map an exportable object to (level, service) or None if excluded."""
    if getattr(obj, "type", None) not in {"MESH", "CURVE"}:
        return None

    getter = getattr(obj, "get", None)
    service = resolve_service_tag(obj)
    if service in ("water", "power"):
        if callable(getter) and getter("export_web_pbr", True) is False:
            return None
        level = "eg"
        if callable(getter):
            raw_lvl = getter("level") or getter("utility_level")
            if raw_lvl:
                level = str(raw_lvl).strip().lower()
        if level not in ("site", "eg", "og"):
            level = "eg"
        return (level, service)

    if getattr(obj, "hide_render", False):
        return None
    if callable(getter) and getter("export_web_pbr", True) is False:
        return None
    for coll in getattr(obj, "users_collection", ()):
        if getattr(coll, "hide_render", False):
            return None
        c_get = getattr(coll, "get", None)
        if callable(c_get) and c_get("export_web_pbr", True) is False:
            return None

    matched = [
        LEVEL_COLLECTIONS[c.name]
        for c in getattr(obj, "users_collection", ())
        if c.name in LEVEL_COLLECTIONS
    ]
    if not matched:
        return None
    for preferred in ("eg", "og", "deckeEg", "deckeOg", "dach", "sockel", "treppe"):
        if preferred in matched:
            return (preferred, None)
    return (matched[0], None)


# Legacy helper retained for unit-test compatibility.
def resolve_export_level(obj):
    meta = resolve_export_meta(obj)
    return meta[0] if meta else None


# Group source triangles by floor, section-cut flag, service tag, and material.
class Batch:
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.normals = []
        self.uvs = []


def _unhide_service_collections(view_layer, bpy_data):
    """Ensure service collections are evaluated in depsgraph without mutating the .blend on disk."""
    def walk_layer(lc):
        coll = lc.collection
        if coll.name in SERVICE_COLLECTIONS or coll.get("service") in ("water", "power"):
            lc.exclude = False
            lc.hide_viewport = False
            coll.hide_viewport = False
            coll.hide_render = False
        for child in lc.children:
            walk_layer(child)

    walk_layer(view_layer.layer_collection)
    for coll in bpy_data.collections:
        if coll.name in SERVICE_COLLECTIONS or coll.get("service") in ("water", "power"):
            coll.hide_viewport = False
            coll.hide_render = False


def main(argv=None):
    import bpy
    from mathutils import Vector

    raw = sys.argv if argv is None else argv
    target = Path(raw[raw.index("--") + 1] if "--" in raw else raw[0]).resolve()
    house = bpy.context.scene
    bpy.context.window.view_layer = house.view_layers["Haus komplett"]
    _unhide_service_collections(bpy.context.window.view_layer, bpy.data)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()

    plan_length = float(house.get("plan_length", 11.0))
    plan_width = float(house.get("plan_width", 7.15))
    cut_x_thresh = -plan_length / 2.0 + 0.30
    cut_y_thresh = -plan_width / 2.0 + 0.26

    geometry = defaultdict(Batch)
    for obj in house.objects:
        meta = resolve_export_meta(obj)
        if not meta:
            continue
        level, service = meta

        if service is not None:
            cut = False
        elif obj.get("frontCut") is not None:
            cut = bool(obj.get("frontCut"))
        else:
            ancestor = obj
            cut = False
            while ancestor:
                if ancestor.name in {"eg_ext_east", "eg_ext_south", "og_ext_east", "og_ext_south"}:
                    cut = True
                    break
                ancestor = ancestor.parent
            # Door hardware uses separate geometry; only handles on cut facades belong to section mask.
            if not cut and obj.name.startswith(("Türklinke", "Drückerrosette")):
                bbox = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
                cut = (
                    sum(v.x for v in bbox) / 8.0 < cut_x_thresh
                    or sum(v.y for v in bbox) / 8.0 < cut_y_thresh
                )

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
                batch = geometry[(level, cut, service, mat.name)]
                used = per_material.setdefault(mat.name, {})
                projection = normals @ tri.normal
                axis = max(range(3), key=lambda a: abs(projection[a]))
                order = [2, 1, 0] if flip else [0, 1, 2]
                face = []
                w, h, _, _ = CROPS.get(mat.name, (1.0, 1.0, "xy", 0))
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

    def make_scene(name):
        s = bpy.data.scenes.new(name)
        bpy.context.window.scene = s
        return s

    bakes = make_scene("Materialproben")
    bakes.render.engine = "CYCLES"
    bakes.cycles.samples = 1
    bakes.cycles.device = "CPU"
    bakes.render.bake.margin = 0
    # Reference used by the texture-coordinate nodes in the native architectural materials.
    if "Materialmaßstab · Meter" in bpy.data.objects:
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
        images = {
            name: baked_color(name, settings, directory)
            for name, settings in CROPS.items()
            if name in bpy.data.materials
        }
        web = make_scene("Hausmodell für den Viewer")
        webm = {}
        for _, _, _, name in geometry:
            if name in webm:
                continue
            native = bpy.data.materials[name]
            shader = next(n for n in native.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            mat = bpy.data.materials.new(name + " · Modell")
            if mat.node_tree is None:
                mat.use_nodes = True
            p = mat.node_tree.nodes.get("Principled BSDF")
            p.inputs["Base Color"].default_value = native.diffuse_color
            for channel in ("Roughness", "Metallic"):
                p.inputs[channel].default_value = shader.inputs[channel].default_value
            if "Emission Strength" in shader.inputs and shader.inputs["Emission Strength"].default_value > 0:
                p.inputs["Emission Color"].default_value = shader.inputs["Emission Color"].default_value
                p.inputs["Emission Strength"].default_value = shader.inputs["Emission Strength"].default_value
            if name in images:
                tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
                tex.image = images[name]
                mat.node_tree.links.new(tex.outputs[0], p.inputs["Base Color"])
            if name in ("Fensterglas", "Duschglas", "Zählerglas"):
                p.inputs["Base Color"].default_value = (0.52, 0.67, 0.68, 1)
                p.inputs["Alpha"].default_value = 0.22 if name != "Zählerglas" else 0.35
                mat.surface_render_method = "BLENDED"
            webm[name] = mat

        arch_tris = 0
        water_tris = 0
        power_tris = 0
        for (level, cut, service, name), batch in geometry.items():
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
            suffix = (" · Schnitt" if cut else "") + (f" · {service}" if service else "")
            o = bpy.data.objects.new(f"{level} · {name}{suffix}", m)
            web.collection.objects.link(o)
            o["level"] = level
            o["frontCut"] = bool(cut)
            if service:
                o["service"] = service
                if service == "water":
                    water_tris += len(batch.faces)
                elif service == "power":
                    power_tris += len(batch.faces)
            else:
                arch_tris += len(batch.faces)

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

    total_tris = arch_tris + water_tris + power_tris
    print(
        "WEB_HOUSE",
        len(geometry),
        "batches",
        total_tris,
        f"triangles (arch={arch_tris}, water={water_tris}, power={power_tris})",
        target.stat().st_size,
        "bytes",
        flush=True,
    )


if __name__ == "__main__":
    main()
