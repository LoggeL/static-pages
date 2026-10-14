"""Build a lightweight, texture-free collision GLB without changing source objects.

Blender API: build_collision(shell_objects, prop_instances, layout, output_path).
Each prop instance is {'room': str, 'definition': layout_entry, 'objects': meshes};
the supplied meshes must already have their final Blender world transforms.
Static meshes are merged by surface. Door leaves keep their local hinge transform.
The temporary collection, meshes and selection changes are cleaned up after export.
"""

from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import time

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


# Collider detail is independent of the render/lightmap settings.
COLLISION_SETTINGS = {
    "terrain_ratio": 0.30,
    "terrain_min_triangles": 1500,
    "floor_thickness": 0.035,
    "ceiling_thickness": 0.04,
    "small_prop_height": 0.08,
    "small_prop_width": 0.12,
    "tree_trunk_radius": 0.21,
    "tree_trunk_height": 2.20,
    "tree_trunk_sides": 12,
}

SURFACES = {
    "concrete", "wood", "carpet", "tile", "metal", "plaster", "glass",
    "dirt", "grass", "asphalt", "fabric", "cardboard", "flesh",
}
SURFACE_PATTERNS = (
    ("glass", r"glass"), ("asphalt", r"asphalt|road"),
    ("grass", r"grass"), ("dirt", r"dirt|mud"), ("carpet", r"carpet|rug"),
    ("tile", r"tile|porcelain|ceramic"),
    ("metal", r"metal|steel|stainless|aluminium|chrome|brass|copper|wire|chainlink|galv|needle"),
    ("wood", r"wood|cabinet|laminate|hardboard|particleboard|fan_blade"),
    ("fabric", r"fabric|mattress|curtain|cloth|canvas|foam|plush"),
    ("cardboard", r"cardboard|paper|book|pizza"), ("flesh", r"flesh|skin"),
    ("plaster", r"plaster|wallpaper|ceiling|siding"),
    ("concrete", r"concrete|brick|roof"),
)


class _Mesh:
    def __init__(self):
        self.vertices = []
        self.faces = []

    def add(self, vertices, faces):
        offset = len(self.vertices)
        self.vertices.extend(tuple(p) for p in vertices)
        self.faces.extend(tuple(offset + i for i in face) for face in faces)

    def box(self, lo, hi, transform=None):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        if min(x1 - x0, y1 - y0, z1 - z0) <= 1e-7:
            return
        vertices = [
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
        ]
        if transform is not None:
            vertices = [transform @ Vector(p) for p in vertices]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                 (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        if transform is not None and transform.determinant() < 0:
            faces = [face[::-1] for face in faces]
        self.add(vertices, faces)

    def cylinder(self, radius, bottom, top, sides, transform):
        vertices = [(radius * math.cos(i * math.tau / sides),
                     radius * math.sin(i * math.tau / sides), z)
                    for z in (bottom, top) for i in range(sides)]
        faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
        faces += [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
        self.add([transform @ Vector(point) for point in vertices], faces)


def _surface(obj, material=None, material_first=False):
    own = obj.get("surface")
    if own in SURFACES and not material_first:
        return own
    name = material.name.lower() if material else ""
    for surface, pattern in SURFACE_PATTERNS:
        if re.search(pattern, name):
            return surface
    return own if own in SURFACES else "concrete"


def _room_rects(layout):
    rects = []
    for room in layout["rooms"]:
        if room.get("outdoor"):
            continue
        parts = room.get("rects")
        if not parts:
            raise ValueError(f"Collision needs orthogonal room rects: {room['id']}")
        for rect in parts:
            rects.append(tuple(float(v) for v in rect))
    return rects


def _apertures(layout):
    constants = layout["constants"]
    apertures = []
    for opening in layout.get("doors", []):
        axis = opening["axis"]
        center = opening["center"]
        width = float(opening["width"])
        thick = constants["wallExt"] if "EXT" in opening.get("rooms", []) else constants["wallInt"]
        u = center[0 if axis == "x" else 1]
        normal = center[1 if axis == "x" else 0]
        apertures.append((axis, u - width / 2, u + width / 2,
                          normal - thick / 2 - 1e-5, normal + thick / 2 + 1e-5,
                          center[2] - 1e-5, center[2] + opening["height"]))
    for opening in layout.get("windows", []):
        center, outward = opening["center"], opening["outward"]
        axis = "x" if abs(outward[1]) > abs(outward[0]) else "y"
        u = center[0 if axis == "x" else 1]
        normal = center[1 if axis == "x" else 0]
        width, thick = opening["width"], constants["wallExt"]
        apertures.append((axis, u - width / 2, u + width / 2,
                          normal - thick / 2 - 1e-5, normal + thick / 2 + 1e-5,
                          opening["sill"], opening["head"]))
    return apertures


def _rectangles(cells, nx, ny):
    """Greedily join adjacent occupied grid cells, preserving every empty cell."""
    remaining = set(cells)
    for j in range(ny):
        for i in range(nx):
            if (i, j) not in remaining:
                continue
            end_x = i + 1
            while (end_x, j) in remaining:
                end_x += 1
            end_y = j + 1
            while end_y < ny and all((k, end_y) in remaining for k in range(i, end_x)):
                end_y += 1
            for yy in range(j, end_y):
                for xx in range(i, end_x):
                    remaining.remove((xx, yy))
            yield i, j, end_x, end_y


def _walls(layout, buckets):
    """The spaces between room rectangles are the wall footprint, not room AABBs."""
    constants = layout["constants"]
    x0, y0, x1, y1 = constants["exteriorAABB"]
    bottom, top = constants["floorZ"], constants["ceilingZ"]
    rooms = _room_rects(layout)
    apertures = _apertures(layout)
    xs, ys, zs = {x0, x1}, {y0, y1}, {bottom, top}
    for a, b, c, d in rooms:
        xs.update((a, c))
        ys.update((b, d))
    for axis, a, b, _, _, lo, hi in apertures:
        (xs if axis == "x" else ys).update((a, b))
        zs.update((max(bottom, lo), min(top, hi)))
    xs = sorted(v for v in xs if x0 <= v <= x1)
    ys = sorted(v for v in ys if y0 <= v <= y1)
    zs = sorted(v for v in zs if bottom <= v <= top)
    footprint = []
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            x, y = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if not any(a < x < c and b < y < d for a, b, c, d in rooms):
                footprint.append((i, j, x, y))
    count = 0
    for lower, upper in zip(zs, zs[1:]):
        z = (lower + upper) / 2
        cells = []
        for i, j, x, y in footprint:
            blocked = False
            for axis, a, b, n0, n1, z0, z1 in apertures:
                u, n = (x, y) if axis == "x" else (y, x)
                if a < u < b and n0 < n < n1 and z0 < z < z1:
                    blocked = True
                    break
            if not blocked:
                cells.append((i, j))
        for a, b, c, d in _rectangles(cells, len(xs) - 1, len(ys) - 1):
            buckets["plaster"].box((xs[a], ys[b], lower), (xs[c], ys[d], upper))
            count += 1
    return count


def _slabs(layout, buckets):
    """Continuous coarse slabs avoid tiny damaged-board gaps snagging a capsule."""
    constants = layout["constants"]
    x0, y0, x1, y1 = constants["exteriorAABB"]
    floor = constants["floorZ"]
    buckets["wood"].box((x0, y0, floor - 0.05), (x1, y1, floor - 0.015))
    for room in layout["rooms"]:
        if room.get("outdoor") or not room.get("rects"):
            continue
        surface = room.get("floorSurface", "wood")
        for a, b, c, d in room["rects"]:
            z = room.get("floorZ", floor)
            buckets[surface].box((a, b, z - COLLISION_SETTINGS["floor_thickness"]), (c, d, z))
            ceil = room.get("ceilingZ", constants["ceilingZ"])
            buckets["plaster"].box((a, b, ceil), (c, d, ceil + COLLISION_SETTINGS["ceiling_thickness"]))
    # Passage floor between the room slabs, with the two exterior thresholds.
    for door in layout.get("doors", []):
        x, y, z = door["center"]
        half = door["width"] / 2
        exterior = "EXT" in door.get("rooms", [])
        depth = constants["wallExt" if exterior else "wallInt"] / 2
        if door["axis"] == "x":
            lo, hi = (x - half, y - depth, z - 0.03), (x + half, y + depth, z + (0.012 if exterior else 0))
        else:
            lo, hi = (x - depth, y - half, z - 0.03), (x + depth, y + half, z + (0.012 if exterior else 0))
        buckets["wood"].box(lo, hi)
    porch = layout.get("navHints", {}).get("porchDeck")
    if porch:
        buckets["wood"].box((porch["x0"], porch["y0"], porch["deck"] - 0.20),
                            (porch["x1"], 0.0, porch["deck"]))


def _stairs(layout, buckets, shell_objects):
    stairs = layout.get("navHints", {}).get("stairs")
    if not stairs:
        return None
    x0, x1 = stairs["x"]
    hinted_y0, hinted_y1 = stairs["y"]
    z1 = layout["constants"]["porchDeckZ"]
    z0 = layout["constants"].get("groundZ", z1 - stairs["steps"] * stairs["rise"])
    # Lay the ramp over the actual stair noses. Merely connecting navHint ground
    # and deck endpoints puts the first tread about 18 cm above the collider.
    treads = {}
    y1 = hinted_y1
    for obj in shell_objects:
        if obj.type != "MESH" or obj.name not in {"PORCH_steps", "PORCH_deck"}:
            continue
        for face in obj.data.polygons:
            if face.area < 0.05 or face.normal.z < 0.99:
                continue
            points = [obj.matrix_world @ obj.data.vertices[i].co for i in face.vertices]
            if max(p.z for p in points) - min(p.z for p in points) > 0.001:
                continue
            height = sum(p.z for p in points) / len(points)
            front = min(p.y for p in points)
            if obj.name == "PORCH_deck" and abs(height - z1) < 0.01:
                y1 = min(y1, front)
            elif z0 + 0.05 < height < z1 - 0.05:
                key = round(height, 5)
                treads[key] = min(treads.get(key, front), front)
    if not treads:
        # Generic layout-only fallback: a one-tread approach before the hint.
        tread_run = (hinted_y1 - hinted_y0) / max(1, stairs["steps"] - 1)
        treads[z0 + stairs["rise"]] = hinted_y0
        treads[z1 - stairs["rise"]] = hinted_y1 - tread_run
    slope = min((z1 - height) / (y1 - front) for height, front in treads.items() if y1 > front)
    if slope <= 0:
        raise ValueError("Invalid porch stair profile")
    # The lower endpoint meets the rendered approach paving/terrain, instead of
    # starting at a nominal ground height over the last concrete paving slab.
    floor_vertices, floor_triangles = [], []
    for obj in shell_objects:
        if obj.type != "MESH" or obj.name not in {"SITE_concrete", "SITE_ground", "SITE_ground_dirt"}:
            continue
        offset = len(floor_vertices)
        floor_vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
        obj.data.calc_loop_triangles()
        floor_triangles.extend(tuple(offset + i for i in tri.vertices) for tri in obj.data.loop_triangles)
    ground = BVHTree.FromPolygons(floor_vertices, floor_triangles, all_triangles=True) if floor_triangles else None
    y0 = y1 - (z1 - z0) / slope
    if ground:
        for _ in range(3):
            hit, _, _, _ = ground.ray_cast(Vector(((x0 + x1) / 2, y0, z1 + 1)), Vector((0, 0, -1)), 4)
            if hit is None:
                break
            z0 = hit.z
            y0 = y1 - (z1 - z0) / slope
    # A single solid wedge replaces all risers, plus a short flush top landing.
    bottom = min(z0, z1) - 0.10
    vertices = [(x0, y0, bottom), (x1, y0, bottom), (x1, y1, bottom), (x0, y1, bottom),
                (x0, y0, z0), (x1, y0, z0), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    buckets["wood"].add(vertices, faces)
    if y1 < hinted_y1:
        buckets["wood"].box((x0, y1, z1 - 0.10), (x1, hinted_y1, z1))
    return {"x": [x0, x1], "y": [y0, y1], "z": [z0, z1],
            "slopeDegrees": math.degrees(math.atan(slope)),
            "layoutStairY": [hinted_y0, hinted_y1],
            "treadNoses": [{"y": front, "z": height,
                            "rampZ": z1 - (y1 - front) * slope}
                           for height, front in sorted(treads.items())],
            "triangles": 12 + (12 if y1 < hinted_y1 else 0)}


def _copy_source(obj, buckets, collection, simplify=False, by_material=False):
    """Read evaluated geometry; any modifier belongs only to a temporary copy."""
    temporary = None
    mesh = obj.data
    if simplify:
        temporary = bpy.data.objects.new("C6_terrain_work", obj.data.copy())
        collection.objects.link(temporary)
        temporary.matrix_world = obj.matrix_world.copy()
        modifier = temporary.modifiers.new("C6_terrain_decimate", "DECIMATE")
        modifier.ratio = COLLISION_SETTINGS["terrain_ratio"]
        modifier.use_collapse_triangulate = True
        # Keep open terrain/material boundaries fixed to avoid cracks at roads.
        bm = bmesh.new()
        bm.from_mesh(temporary.data)
        bm.verts.ensure_lookup_table()
        boundary = {v.index for e in bm.edges if e.is_boundary for v in e.verts}
        boundary.update(v.index for e in bm.edges if len(e.link_faces) == 2
                        and e.link_faces[0].material_index != e.link_faces[1].material_index
                        for v in e.verts)
        interior = [v.index for v in bm.verts if v.index not in boundary]
        bm.free()
        group = temporary.vertex_groups.new(name="C6_terrain_interior")
        if interior:
            group.add(interior, 1.0, "REPLACE")
        modifier.vertex_group = group.name
        modifier.vertex_group_factor = 1000.0
        evaluated = temporary.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
    else:
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        vertices = [obj.matrix_world @ v.co for v in mesh.vertices]
        faces = defaultdict(list)
        reverse = obj.matrix_world.determinant() < 0
        for tri in mesh.loop_triangles:
            material = mesh.materials[tri.material_index] if tri.material_index < len(mesh.materials) else None
            surface = _surface(obj, material, material_first=by_material)
            indices = tuple(tri.vertices)
            faces[surface].append(indices[::-1] if reverse else indices)
        for surface, indices in faces.items():
            used = sorted({i for face in indices for i in face})
            remap = {index: i for i, index in enumerate(used)}
            buckets[surface].add([vertices[i] for i in used],
                                 [tuple(remap[i] for i in face) for face in indices])
        return len(mesh.loop_triangles)
    finally:
        evaluated.to_mesh_clear()
        if temporary:
            data = temporary.data
            bpy.data.objects.remove(temporary, do_unlink=True)
            bpy.data.meshes.remove(data)


def _shell(shell_objects, buckets, collection):
    # These objects already contain small boxes, hulls or surface patches. Preserve
    # their gaps. A single bounds box for a frame or an L-shaped fence is incorrect.
    exact = {"SITE_concrete", "SITE_curb", "SITE_fence_wood", "SITE_fence_chain_posts",
             "SITE_fence_chain_mesh", "SITE_mailbox", "SITE_hydrant", "SITE_poles",
             "PORCH_posts", "PORCH_railing", "PORCH_roof", "EXT_foundation"}
    terrain = {"SITE_ground", "SITE_ground_dirt", "SITE_street"}
    copied, skipped = {}, []
    for obj in shell_objects:
        if obj.type != "MESH" or obj.name.startswith("DOOR_"):
            continue
        if obj.name in terrain:
            obj.data.calc_loop_triangles()
            copied[obj.name] = _copy_source(obj, buckets, collection,
                                            simplify=len(obj.data.loop_triangles) > COLLISION_SETTINGS["terrain_min_triangles"],
                                            by_material=True)
        elif obj.name in exact or obj.name.startswith(("WIN_", "GLASS_", "BOARDS_")):
            copied[obj.name] = _copy_source(obj, buckets, collection)
        elif obj.name.startswith("NBR_") and not obj.name.endswith("_windows"):
            points = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
            lo = tuple(min(p[k] for p in points) for k in range(3))
            hi = tuple(max(p[k] for p in points) for k in range(3))
            buckets["wood"].box(lo, hi)
            copied[obj.name] = 12
        else:
            skipped.append(obj.name)
    return copied, skipped


def _props(instances, buckets):
    report = []
    non_solid = ("curtain", "blinds", "ceiling_", "wall_picture", "papers_", "bottle_",
                 "can_", "syringe", "kitchen_plate", "kitchen_pot", "kitchen_pan", "kitchen_saucepan")
    for instance in instances:
        definition = instance["definition"]
        objects = [obj for obj in instance["objects"] if obj.type == "MESH"]
        prop = definition["prop"]
        item = {"room": instance["room"], "name": definition["name"], "prop": prop}
        if not objects or prop.startswith(non_solid):
            item["skipped"] = "missing geometry" if not objects else "non-solid dressing"
            report.append(item)
            continue
        transform = (Matrix.Translation(Vector(definition["pos"])) @
                     Matrix.Rotation(math.radians(definition.get("rotZ", 0)), 4, "Z"))
        inverse = transform.inverted()
        points, areas = [], Counter()
        for obj in objects:
            local = inverse @ obj.matrix_world
            points.extend(local @ vertex.co for vertex in obj.data.vertices)
            for polygon in obj.data.polygons:
                material = obj.data.materials[polygon.material_index] if polygon.material_index < len(obj.data.materials) else None
                areas[_surface(obj, material)] += polygon.area
        if not points:
            item["skipped"] = "empty geometry"
            report.append(item)
            continue
        lo = [min(p[k] for p in points) for k in range(3)]
        hi = [max(p[k] for p in points) for k in range(3)]
        width = max(hi[0] - lo[0], hi[1] - lo[1])
        height = hi[2] - lo[2]
        if prop == "tree_dead":
            radius = COLLISION_SETTINGS["tree_trunk_radius"]
            top = min(hi[2], lo[2] + COLLISION_SETTINGS["tree_trunk_height"])
            sides = COLLISION_SETTINGS["tree_trunk_sides"]
            buckets["wood"].cylinder(radius, lo[2], top, sides, transform)
            item.update(surface="wood", shape="trunkCylinder", radius=radius, height=top-lo[2],
                        localBounds=[[-radius, -radius, lo[2]], [radius, radius, top]],
                        sourceBounds=[lo, hi], triangles=4*sides-4)
        elif prop != "rug_runner" and (height < COLLISION_SETTINGS["small_prop_height"] or
                                     width < COLLISION_SETTINGS["small_prop_width"]):
            item["skipped"] = "small loose prop"
        else:
            surface = "carpet" if prop == "rug_runner" else (areas.most_common(1)[0][0] if areas else "concrete")
            if prop == "rug_runner":
                # A folded rug is decoration; its collider remains a walkable mat.
                hi[2] = min(hi[2], 0.009)
                lo[2] = min(lo[2], hi[2] - 0.004)
            buckets[surface].box(lo, hi, transform)
            item.update(surface=surface, localBounds=[lo, hi], triangles=12)
        report.append(item)
    return report


def _make_object(name, geometry, collection, surface, transform=None, extras=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(geometry.vertices, [], geometry.faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj["surface"] = surface
    obj["collision"] = True
    if extras:
        for key, value in extras.items():
            obj[key] = value
    if transform is not None:
        obj.matrix_world = transform.copy()
    return obj


def _door(source, definition, collection):
    width = float(source.get("width", definition["width"] - 0.006))
    height = float(source.get("height", definition["height"] - 0.017))
    direction = int(source.get("openDir", definition["openDir"]))
    depth = 0.045 if definition.get("exterior") else 0.035
    x0, x1 = (0.0, width) if direction > 0 else (-width, 0.0)
    geometry = _Mesh()
    geometry.box((x0, -depth, 0), (x1, 0, height))
    extras = {key: definition[key] for key in ("hinge", "closedRotZ", "openAngle", "openDir", "maxAngle", "exterior")
              if key in definition}
    extras.update(width=width, height=height, opening=definition["id"],
                  rooms="|".join(definition.get("rooms", [])),
                  collisionKind="door", _collisionName=f"DOOR_{definition['id']}",
                  coordinateSystem="Three.js Y-up")
    if "hinge" in extras:
        x, y, z = extras["hinge"]
        extras["hinge"] = [x, z, -y]
    # The source keeps its exact Blender name. Rewrite only the exported JSON name.
    return _make_object(f"C6_COLLIDER_DOOR_{definition['id']}", geometry, collection,
                        "wood", source.matrix_world, extras)


def _rewrite_glb(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<III", data)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError("Invalid collision GLB header")
    chunks, offset = [], 12
    document = None
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        payload = data[offset + 8:offset + 8 + size]
        offset += 8 + size
        if kind == 0x4E4F534A:
            document = json.loads(payload)
            for node in document.get("nodes", []):
                exported_name = node.get("extras", {}).pop("_collisionName", None)
                if exported_name:
                    node["name"] = exported_name
                    if "mesh" in node:
                        document["meshes"][node["mesh"]]["name"] = exported_name
            for key in ("images", "textures", "materials"):
                if document.get(key):
                    raise ValueError(f"Collision GLB unexpectedly contains {key}")
            payload = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            payload += b" " * (-len(payload) % 4)
        chunks.append(struct.pack("<II", len(payload), kind) + payload)
    body = b"".join(chunks)
    Path(path).write_bytes(struct.pack("<III", magic, version, len(body) + 12) + body)
    return document


def build_collision(shell_objects, prop_instances, layout, output_path):
    """Return JSON-serializable metrics after atomically exporting only colliders."""
    started = time.perf_counter()
    shell_objects = list(shell_objects)
    prop_instances = list(prop_instances)
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_name(output_path.stem + ".collision-tmp.glb")
    collection = bpy.data.collections.new("C6_COLLISION_EXPORT")
    bpy.context.scene.collection.children.link(collection)
    selected = list(bpy.context.selected_objects)
    active = bpy.context.view_layer.objects.active
    buckets = defaultdict(_Mesh)
    try:
        bpy.context.view_layer.update()
        wall_boxes = _walls(layout, buckets)
        _slabs(layout, buckets)
        ramp = _stairs(layout, buckets, shell_objects)
        shell_report, skipped_shell = _shell(shell_objects, buckets, collection)
        prop_report = _props(prop_instances, buckets)
        objects = []
        for surface, geometry in sorted(buckets.items()):
            if geometry.faces:
                objects.append(_make_object(f"COLLISION_{surface}", geometry, collection, surface,
                                             extras={"collisionKind": "static"}))
        source_doors = {obj.name: obj for obj in shell_objects if obj.type == "MESH" and obj.name.startswith("DOOR_")}
        for definition in layout.get("doors", []):
            if definition.get("kind") != "door":
                continue
            name = f"DOOR_{definition['id']}"
            if name not in source_doors:
                raise ValueError(f"Missing source door mesh: {name}")
            objects.append(_door(source_doors[name], definition, collection))
        for obj in bpy.context.selected_objects:
            obj.select_set(False)
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.context.view_layer.update()
        bpy.ops.export_scene.gltf(filepath=str(temp_path), export_format="GLB", use_selection=True,
                                  export_extras=True, export_materials="NONE", export_normals=False,
                                  export_texcoords=False, export_animations=False,
                                  export_cameras=False, export_lights=False, export_apply=False)
        document = _rewrite_glb(temp_path)
        temp_path.replace(output_path)
        accessors = document["accessors"]
        static_nodes, door_nodes, triangles, vertices = [], [], 0, 0
        surfaces = Counter()
        for node in document.get("nodes", []):
            if "mesh" not in node:
                continue
            mesh = document["meshes"][node["mesh"]]
            ntri = sum(accessors[p["indices"]]["count"] // 3 for p in mesh["primitives"])
            nvert = sum(accessors[p["attributes"]["POSITION"]]["count"] for p in mesh["primitives"])
            triangles += ntri
            vertices += nvert
            surface = node.get("extras", {}).get("surface")
            if surface not in SURFACES:
                raise ValueError(f"Invalid collision surface on {node['name']}: {surface}")
            surfaces[surface] += ntri
            (door_nodes if node["name"].startswith("DOOR_") else static_nodes).append(node["name"])
        return {"output": str(output_path), "bytes": output_path.stat().st_size,
                "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
                "seconds": round(time.perf_counter() - started, 3),
                "triangles": triangles, "vertices": vertices, "surfaces": dict(surfaces),
                "staticNodes": static_nodes, "doorNodes": door_nodes,
                "wallBoxes": wall_boxes, "doorOpenings": len(layout.get("doors", [])),
                "windowOpenings": len(layout.get("windows", [])), "ramp": ramp,
                "shellSourceTriangles": shell_report, "omittedOrRebuiltShell": skipped_shell,
                "props": prop_report, "settings": dict(COLLISION_SETTINGS),
                "limitations": ["Small loose objects and soft window dressing do not block the capsule.",
                                "Furniture uses one oriented bounds box per instance; open cupboards are solid.",
                                "Dead-tree collision uses the lower trunk cylinder; thin roots and branches do not block walking.",
                                "Fine floor, ceiling and plaster damage is filled by continuous coarse slabs.",
                                "Terrain retains material/open boundaries; its interior is decimated."]}
    finally:
        for obj in list(collection.objects):
            mesh = obj.data if obj.type == "MESH" else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(collection)
        for obj in selected:
            if obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if active and active.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = active
        if temp_path.exists():
            temp_path.unlink()
