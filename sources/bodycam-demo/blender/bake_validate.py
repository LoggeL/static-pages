"""Offline C6 validation: glTF geometry, level metadata, UV packing and RGBM PNGs.

Run with system Python and numpy, without Blender or a GPU. Meshopt-compressed
delivery files must first be decoded losslessly, or pass the pre-compression GLB.
Texel overlap tests use strict triangle interiors at pixel centres; shared edges
are excluded. Subpixel overlaps can therefore remain below this test's resolution.
"""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import time
import zlib

import numpy as np

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
COMPONENTS = {5120: "i1", 5121: "u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class GLB:
    def __init__(self, path):
        self.path = Path(path)
        data = self.path.read_bytes()
        magic, version, length = struct.unpack_from("<III", data)
        if magic != 0x46546C67 or version != 2 or length != len(data):
            raise ValueError("Invalid GLB header")
        offset, self.binary, self.document = 12, None, None
        while offset < len(data):
            size, kind = struct.unpack_from("<II", data, offset)
            payload = data[offset + 8:offset + 8 + size]
            if kind == 0x4E4F534A:
                self.document = json.loads(payload)
            elif kind == 0x004E4942:
                self.binary = payload
            offset += size + 8
        if self.document is None or self.binary is None:
            raise ValueError("GLB needs JSON and BIN chunks")
        self.sha256 = hashlib.sha256(data).hexdigest()
        self.bytes = len(data)
        self.cache = {}
        self.world = self.world_matrices()

    def accessor(self, index):
        if index in self.cache:
            return self.cache[index]
        accessor = self.document["accessors"][index]
        if "sparse" in accessor:
            raise ValueError("Sparse accessors need an explicit decoder")
        view = self.document["bufferViews"][accessor["bufferView"]]
        if "EXT_meshopt_compression" in view.get("extensions", {}):
            raise ValueError("Pass the uncompressed GLB or losslessly decode EXT_meshopt_compression first")
        dtype = np.dtype(COMPONENTS[accessor["componentType"]])
        columns = COUNTS[accessor["type"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        stride = view.get("byteStride", columns * dtype.itemsize)
        array = np.ndarray((accessor["count"], columns), dtype=dtype, buffer=self.binary,
                           offset=start, strides=(stride, dtype.itemsize))
        if accessor.get("normalized") and dtype.kind != "f":
            info = np.iinfo(dtype)
            array = np.maximum(array.astype(np.float64) / info.max, -1)
        self.cache[index] = array
        return array

    def world_matrices(self):
        nodes = self.document.get("nodes", [])
        parents = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}
        matrices = {}

        def visit(index):
            if index in matrices:
                return matrices[index]
            node = nodes[index]
            if "matrix" in node:
                local = np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4).T
            else:
                x, y, z, w = node.get("rotation", [0, 0, 0, 1])
                local = np.eye(4)
                local[:3, :3] = [[1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w],
                                 [2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w],
                                 [2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y]]
                local[:3, :3] *= np.asarray(node.get("scale", [1, 1, 1]))[None, :]
                local[:3, 3] = node.get("translation", [0, 0, 0])
            matrices[index] = visit(parents[index]) @ local if index in parents else local
            return matrices[index]
        for i in range(len(nodes)):
            visit(i)
        return matrices


def read_png(path):
    """Decode non-interlaced RGB/RGBA8 PNGs, retaining their exact channel bytes."""
    data = Path(path).read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Not a PNG: {path}")
    offset, compressed, kinds = 8, [], []
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind, payload = data[offset+4:offset+8], data[offset+8:offset+8+size]
        crc = struct.unpack_from(">I", data, offset+8+size)[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            raise ValueError(f"PNG CRC mismatch: {path}")
        kinds.append(kind.decode("ascii"))
        if kind == b"IHDR":
            width, height, bits, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if bits != 8 or color not in (2, 6) or compression or filtering or interlace:
                raise ValueError("Expected non-interlaced RGB/RGBA8 PNG")
        elif kind == b"IDAT":
            compressed.append(payload)
        offset += size + 12
    channels = 4 if color == 6 else 3
    stride = width * channels
    packed = np.frombuffer(zlib.decompress(b"".join(compressed)), np.uint8).reshape(height, stride + 1)
    output = np.empty((height, stride), np.uint8)
    previous = np.zeros(stride, np.uint8)
    filters = Counter()
    for y in range(height):
        kind, source = int(packed[y, 0]), packed[y, 1:]
        filters[kind] += 1
        if kind == 0:
            row = source.copy()
        elif kind == 1:
            row = np.cumsum(source.reshape(width, channels), axis=0, dtype=np.uint32).astype(np.uint8).ravel()
        elif kind == 2:
            row = source + previous
        elif kind in (3, 4):
            row = bytearray(stride)
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                up = int(previous[x])
                upper_left = int(previous[x - channels]) if x >= channels else 0
                if kind == 3:
                    prediction = (left + up) // 2
                else:
                    p = left + up - upper_left
                    a, b, c = abs(p-left), abs(p-up), abs(p-upper_left)
                    prediction = left if a <= b and a <= c else up if b <= c else upper_left
                row[x] = (int(source[x]) + prediction) & 255
            row = np.frombuffer(row, np.uint8)
        else:
            raise ValueError(f"Unknown PNG filter {kind}")
        output[y] = row
        previous = row
    return output.reshape(height, width, channels), {
        "chunks": kinds, "rowFilters": dict(filters), "sha256": hashlib.sha256(data).hexdigest()}


def write_png(path, pixels):
    height, width, channels = pixels.shape
    if channels != 4:
        raise ValueError("Diagnostic PNGs use RGBA8")
    def chunk(kind, value):
        return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value) & 0xffffffff)
    rows = b"".join(b"\0" + row.tobytes() for row in pixels.astype(np.uint8))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    Path(path).write_bytes(data + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


def same(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, (float, int)) and isinstance(b, (float, int)):
        return math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-6)
    return a == b


def convert(vector):
    return [vector[0], vector[2], -vector[1]]


def coordinates(level, layout, glb, issue):
    result = {"rooms": len(level.get("rooms", [])), "npcs": len(level.get("npcs", [])), "doors": []}
    if "Y-up" not in level.get("coords", ""):
        issue("coordinates", "level.coords must declare Y-up")
    if not same(level.get("playerSpawn", {}).get("position"), convert(layout["playerSpawn"]["pos"])):
        issue("coordinates", "Player spawn does not match Blender-to-Three conversion")
    actual_npcs = {item["id"]: item for item in level.get("npcs", [])}
    if set(actual_npcs) != {item["id"] for item in layout["suspects"]}:
        issue("coordinates", "NPC ids differ from layout.suspects")
    actual_rooms = {item["id"]: item for item in level.get("rooms", [])}
    if set(actual_rooms) != {item["id"] for item in layout["rooms"]}:
        issue("coordinates", "Room ids differ from layout")
    for source in layout["rooms"]:
        actual = actual_rooms.get(source["id"], {})
        expected = {"polygonPlane": "XZ"}
        if "aabb" in source:
            a, b, c, d, e, f = source["aabb"]
            expected["aabb"] = [a, c, -e, d, f, -b]
        if "polygon" in source:
            expected["polygon"] = [[x, -y] for x, y in source["polygon"]]
        if "rects" in source:
            expected["rects"] = [[x0, -y1, x1, -y0] for x0, y0, x1, y1 in source["rects"]]
        for old, new in [("floorZ", "floorY"), ("ceilingZ", "ceilingY")]:
            if old in source:
                expected[new] = source[old]
        for key, value in expected.items():
            if not same(actual.get(key), value):
                issue("coordinates", f"{source['id']}.{key} conversion mismatch")
    for source in layout["suspects"]:
        actual = actual_npcs.get(source["id"], {})
        position = actual.get("position")
        if not same(position, convert(source["pos"])):
            issue("coordinates", f"NPC {source['id']} conversion mismatch")
        if not same(actual.get("yawDeg"), source.get("yawDeg", 0)):
            issue("coordinates", f"NPC {source['id']} yaw mismatch")
        room = actual_rooms.get(actual.get("room"), {})
        if position is not None and "aabb" in room:
            bounds = room["aabb"]
            if any(position[k] < bounds[k]-1e-5 or position[k] > bounds[k+3]+1e-5 for k in range(3)):
                issue("coordinates", f"NPC {source['id']} is outside its room")
    instances = level.get("propInstances", [])
    actual_props = {(item["room"], item["name"]): item for item in instances}
    missing = {(item["room"], item["name"]) for item in level.get("missingProps", [])}
    expected_props = {(room, item["name"]): item for room, items in layout["furniture"].items()
                      for item in items if (room, item["name"]) not in missing}
    if len(actual_props) != len(instances) or set(actual_props) != set(expected_props):
        issue("props", "Static prop instances differ from the layout or contain duplicates")
    rotations = level.get("placementConfig", {}).get("rotationsByPropDegrees", {})
    for key, source in expected_props.items():
        actual = actual_props.get(key, {})
        rotation = (source.get("rotZ", 0) + rotations.get(source["prop"], 0)) % 360
        if (actual.get("prop") != source["prop"] or not same(actual.get("position"), convert(source["pos"]))
                or not same(actual.get("rotationYDegrees"), rotation) or not same(actual.get("scale"), [1, 1, 1])
                or actual.get("anchor") != source.get("anchor", "source asset origin")):
            issue("props", f"Prop placement differs from source and explicit corrections: {key}")
    result["propInstances"] = len(instances)
    result["missingProps"] = len(missing)
    if level.get("staticDecalInstances") != len(layout.get("decals", [])):
        issue("props", "Static decal instance count differs from layout")
    nodes = {node.get("name"): (i, node) for i, node in enumerate(glb.document["nodes"])}
    source_doors = {door["id"]: door for door in layout["doors"]}
    if len(nodes) != len(glb.document["nodes"]):
        issue("metadata", "Duplicate GLB node names")
    wanted = {"DOOR_" + item["id"] for item in level["doors"] if item["kind"] == "door"}
    actual = {name for name in nodes if name and name.startswith("DOOR_")}
    if actual != wanted:
        issue("doors", f"Door set mismatch: wanted {sorted(wanted)}, got {sorted(actual)}")
    for door in level["doors"]:
        source = source_doors.get(door["id"])
        if source is None or not same(door.get("position"), convert(source["center"])):
            issue("coordinates", f"Door {door['id']} position conversion mismatch")
        if source and "hinge" in source and not same(door.get("hinge"), convert(source["hinge"])):
            issue("coordinates", f"Door {door['id']} hinge conversion mismatch")
        if door["kind"] != "door" or door["object"] not in nodes:
            continue
        index, node = nodes[door["object"]]
        extras = node.get("extras", {})
        if "lightmap" in extras or "lightmapEncoding" in extras:
            issue("doors", f"Door is part of a static atlas: {door['object']}")
        if not same(extras.get("hinge"), door["hinge"]):
            issue("doors", f"Door hinge extras mismatch: {door['object']}")
        angle = math.radians(door["closedRotZ"] + door["openDir"] * door["openAngle"])
        expected = np.eye(4)
        c, s = math.cos(angle), math.sin(angle)
        expected[:3, :3] = [[c, 0, s], [0, 1, 0], [-s, 0, c]]
        expected[:3, 3] = door["hinge"]
        error = float(np.max(np.abs(glb.world[index] - expected)))
        if error > 5e-5:
            issue("doors", f"Door hinge/rotation matrix mismatch: {door['object']} ({error:g})")
        result["doors"].append({"name": door["object"], "matrixMaxError": error})
    return result


def texture_refs(value, path=""):
    if isinstance(value, dict):
        for key, child in value.items():
            location = f"{path}.{key}" if path else key
            if key.lower().endswith("texture") and isinstance(child, dict) and "index" in child:
                yield location
            yield from texture_refs(child, location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from texture_refs(child, f"{path}[{index}]")


def geometry(glb, level, issue, allow_sampled_uv_degenerate=False):
    atlas_records = defaultdict(list)
    report = []
    expected = {item["name"]: item for item in level["meshes"]}
    if len(expected) != len(level["meshes"]):
        issue("metadata", "Duplicate mesh names in level.json")
    found = set()
    for node_index, node in enumerate(glb.document["nodes"]):
        if "mesh" not in node:
            continue
        name = node.get("name", "")
        extras = node.get("extras", {})
        if extras.get("surface") not in {"concrete", "wood", "carpet", "tile", "metal", "plaster", "glass",
                                          "dirt", "grass", "asphalt", "fabric", "cardboard", "flesh"}:
            issue("surface", f"Invalid surface tag on {name}: {extras.get('surface')}")
        dynamic = name.startswith("DOOR_")
        if not dynamic:
            found.add(name)
            if name not in expected:
                issue("metadata", f"Mesh missing from level.json: {name}")
            else:
                if set(extras) != set(expected[name]) - {"name"}:
                    issue("metadata", f"{name}: GLB extras and level.json have different metadata keys")
                for key, value in expected[name].items():
                    if key != "name" and not same(extras.get(key), value):
                        issue("metadata", f"{name}.{key}: GLB extras differ from level.json")
        mesh = glb.document["meshes"][node["mesh"]]
        for primitive_index, primitive in enumerate(mesh["primitives"]):
            if primitive.get("mode", 4) != 4:
                issue("geometry", f"Non-triangle primitive: {name}")
                continue
            attributes = primitive["attributes"]
            positions = glb.accessor(attributes["POSITION"]).astype(np.float64)
            indices = (glb.accessor(primitive["indices"]).ravel() if "indices" in primitive
                       else np.arange(len(positions)))
            if len(indices) % 3 or indices.max(initial=0) >= len(positions):
                issue("geometry", f"Invalid indices: {name}")
                continue
            indices = indices.reshape(-1, 3)
            positions = positions @ glb.world[node_index][:3, :3].T + glb.world[node_index][:3, 3]
            triangles = positions[indices]
            areas = np.linalg.norm(np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0]), axis=1) / 2
            normals = glb.accessor(attributes["NORMAL"]) if "NORMAL" in attributes else np.zeros((len(positions), 3))
            normal_lengths = np.linalg.norm(normals, axis=1)
            item = {"name": name, "primitive": primitive_index, "triangles": len(indices),
                    "geometricDegenerate": int(np.count_nonzero(areas < 1e-12)),
                    "geometryMinimumArea": float(areas.min(initial=np.inf)),
                    "nonFinitePositions": int(np.count_nonzero(~np.isfinite(positions))),
                    "nonFiniteNormals": int(np.count_nonzero(~np.isfinite(normals))),
                    "zeroNormals": int(np.count_nonzero(normal_lengths < 1e-8))}
            if item["geometricDegenerate"]:
                issue("geometry", f"{name}: {item['geometricDegenerate']} zero-area triangles")
            if item["nonFinitePositions"] or item["nonFiniteNormals"] or item["zeroNormals"]:
                issue("geometry", f"{name}: invalid positions or normals")
            if "COLOR_0" not in attributes:
                issue("vertex_colors", f"{name}: missing authored colors or explicit white defaults")
                item["vertexColorCount"] = 0
            else:
                colors = glb.accessor(attributes["COLOR_0"])
                item["vertexColorCount"] = len(colors)
                item["vertexColorMin"] = colors.min(axis=0).tolist()
                item["vertexColorMax"] = colors.max(axis=0).tolist()
                if (len(colors) != len(positions) or colors.shape[1] not in (3, 4)
                        or not np.isfinite(colors).all() or colors.min() < 0 or colors.max() > 1):
                    issue("vertex_colors", f"{name}: invalid COLOR_0 values")
            if not dynamic:
                if "TEXCOORD_1" not in attributes:
                    issue("uv", f"{name}: missing TEXCOORD_1")
                    report.append(item)
                    continue
                uv = glb.accessor(attributes["TEXCOORD_1"]).astype(np.float64)
                uv_triangles = uv[indices]
                a, b = uv_triangles[:, 1]-uv_triangles[:, 0], uv_triangles[:, 2]-uv_triangles[:, 0]
                uv_areas = np.abs(a[:, 0]*b[:, 1]-a[:, 1]*b[:, 0]) / 2
                item.update(uvMin=float(uv.min()), uvMax=float(uv.max()),
                            uvDegenerate=int(np.count_nonzero(uv_areas < 5e-17)),
                            uvDegenerateWorldAreaM2=float(areas[uv_areas < 5e-17].sum()),
                            uvDegenerateLargestWorldAreaM2=float(areas[uv_areas < 5e-17].max(initial=0)),
                            uvSubTenthTexel=int(np.count_nonzero(uv_areas*2048*2048 < 0.1)))
                if not np.isfinite(uv).all() or uv.min() < -1e-7 or uv.max() > 1+1e-7:
                    issue("uv", f"{name}: UV1 outside [0,1] or nonfinite")
                if item["uvDegenerate"] and not allow_sampled_uv_degenerate:
                    issue("uv", f"{name}: {item['uvDegenerate']} UV-zero-area triangles")
                atlas_records[extras.get("lightmap", "")].append({"name": name, "primitive": primitive_index,
                    "uv": uv_triangles, "world": triangles, "areas": areas,
                    "material": glb.document.get("materials", [])[primitive["material"]].get("name", "")
                    if "material" in primitive else ""})
            report.append(item)
    if set(expected) != found:
        issue("metadata", f"Mesh set mismatch: missing {sorted(set(expected)-found)}, additional {sorted(found-set(expected))}")
    for material in glb.document.get("materials", []):
        if material.get("name", "").startswith("M_"):
            refs = list(texture_refs(material))
            if refs:
                issue("textures", f"Tile material {material['name']} has embedded/runtime texture references: {refs}")
    return report, atlas_records


def uv_island_labels(records):
    """Return a chart id per triangle, joining equal world/UV edges.

    World endpoints use a 1 micrometre grid; UV endpoints retain float32 values.
    Full edges, rather than coincident UV corners, connect triangles. Call this
    on the original bake mesh when independently quantized material primitives
    no longer have identical world coordinates along their shared edges.
    """
    if not records:
        return np.empty(0, np.int64)
    world = np.concatenate([record["world"] for record in records])
    uv = np.concatenate([record["uv"] for record in records])
    count = len(uv)
    endpoints = np.empty((count * 3, 5), np.int64)
    endpoints[:, :3] = np.rint(world.reshape(-1, 3) * 1e6).astype(np.int64)
    float_uv = np.ascontiguousarray(uv.reshape(-1, 2), dtype=np.float32)
    float_uv[float_uv == 0] = 0  # Canonicalise negative zero before byte equality.
    endpoints[:, 3:] = float_uv.view(np.uint32)
    _, vertex_ids = np.unique(endpoints, axis=0, return_inverse=True)
    vertex_ids = vertex_ids.reshape(-1, 3)
    pairs = vertex_ids[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2)
    pairs.sort(axis=1)
    edge_keys = (pairs[:, 0].astype(np.uint64) << np.uint64(32)) | pairs[:, 1].astype(np.uint64)
    _, first, inverse = np.unique(edge_keys, return_index=True, return_inverse=True)
    edge_triangles = np.repeat(np.arange(count), 3)
    predecessors = edge_triangles[first[inverse]]
    parents = np.arange(count)
    sizes = np.ones(count, np.int32)

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for left, right in zip(edge_triangles, predecessors):
        if left != right:
            a, b = root(left), root(right)
            if a != b:
                if sizes[a] < sizes[b]:
                    a, b = b, a
                parents[b] = a
                sizes[a] += sizes[b]
    _, island = np.unique(np.fromiter((root(i) for i in range(count)), np.int64, count),
                          return_inverse=True)
    return island


def reference_island_labels(reference, records):
    """Keep bake-chart identity through primitive quantization and reordering.

    Each primitive must retain all UV triangles, either as exact float32 values
    or rounded to the uint16 grid. A rounded triangle shared by distinct source
    charts is rejected as ambiguous. This deliberately does not weld nearby
    unrelated triangles or waive the delivery mesh's raster overlap test.
    """
    original_labels = uv_island_labels(reference)
    original = {}
    offset = 0
    for record in reference:
        key = (record["name"], record["primitive"])
        original[key] = (record, original_labels[offset:offset + len(record["uv"])])
        offset += len(record["uv"])
    if set(original) != {(r["name"], r["primitive"]) for r in records}:
        raise ValueError("Bake reference and delivery primitive sets differ")

    def triangle_keys(uv, quantized):
        values = np.rint(uv * 65535).astype(np.int32) if quantized else uv.astype(np.float32)
        values[values == 0] = 0
        order = np.lexsort((values[:, :, 1], values[:, :, 0]), axis=1)
        values = np.ascontiguousarray(np.take_along_axis(values, order[:, :, None], axis=1))
        return values.reshape(len(values), 6).view(np.dtype((np.void, 6 * values.dtype.itemsize))).ravel()

    labels, max_error, quantized_primitives, unchanged_primitives = [], 0.0, 0, 0
    for record in records:
        key = (record["name"], record["primitive"])
        source, source_labels = original[key]
        if len(source["uv"]) != len(record["uv"]):
            raise ValueError(f"Bake reference triangle count differs: {key}")
        sk, tk = triangle_keys(source["uv"], False), triangle_keys(record["uv"], False)
        si, ti = np.argsort(sk, kind="stable"), np.argsort(tk, kind="stable")
        if np.array_equal(sk[si], tk[ti]):
            unchanged_primitives += 1
        else:
            rounded = np.rint(record["uv"] * 65535) / 65535
            if not np.allclose(record["uv"], rounded, rtol=0, atol=1e-12):
                raise ValueError(f"Delivery UVs are neither unchanged nor uint16-normalized: {key}")
            sk, tk = triangle_keys(source["uv"], True), triangle_keys(record["uv"], True)
            si, ti = np.argsort(sk, kind="stable"), np.argsort(tk, kind="stable")
            if not np.array_equal(sk[si], tk[ti]):
                raise ValueError(f"Delivery UV triangles differ from bounded uint16 bake-reference rounding: {key}")
            max_error = max(max_error, float(np.max(np.abs(
                source["uv"] - np.rint(source["uv"] * 65535) / 65535), initial=0)))
            quantized_primitives += 1
        ordered_labels = source_labels[si]
        equal_neighbors = sk[si][1:] == sk[si][:-1]
        if np.any(equal_neighbors & (ordered_labels[1:] != ordered_labels[:-1])):
            raise ValueError(f"UV triangle matching is ambiguous across separate source charts: {key}")
        mapped = np.empty(len(ti), np.int64)
        mapped[ti] = ordered_labels
        labels.append(mapped)
    return np.concatenate(labels), {
        "sourceCharts": int(original_labels.max(initial=-1)) + 1,
        "unchangedUVPrimitives": unchanged_primitives,
        "uint16UVPrimitives": quantized_primitives,
        "maximumUVComponentError": max_error,
        "maximum2048TexelComponentError": max_error * 2048,
        "matching": "same primitive, complete triangle multiset, exact float32 or bounded uint16 UV rounding"}


def uv_islands(records, triangle_samples, width, height, labels=None):
    """Measure connected charts; PCA is diagnostic, strict samples prove coverage."""
    if not records:
        return {"count": 0, "withoutInteriorTexel": 0, "pcaShortSideUnderTwoTexels": 0,
                "largestSamplelessIslands": []}
    uv = np.concatenate([record["uv"] for record in records])
    island = uv_island_labels(records) if labels is None else labels
    number = int(island.max()) + 1
    point_island = np.repeat(island, 3)
    points = (uv * [width, height]).reshape(-1, 2)
    point_count = np.bincount(point_island, minlength=number)
    sums = np.zeros((number, 2))
    np.add.at(sums, point_island, points)
    means = sums / point_count[:, None]
    centred = points - means[point_island]
    covariance = np.zeros((number, 2, 2))
    np.add.at(covariance, point_island, centred[:, :, None] * centred[:, None, :])
    _, axes = np.linalg.eigh(covariance)
    rotated = np.einsum("ni,nij->nj", centred, axes[point_island])
    low, high = np.full((number, 2), np.inf), np.full((number, 2), -np.inf)
    rotated_low, rotated_high = low.copy(), high.copy()
    np.minimum.at(low, point_island, points)
    np.maximum.at(high, point_island, points)
    np.minimum.at(rotated_low, point_island, rotated)
    np.maximum.at(rotated_high, point_island, rotated)
    dimensions = high - low
    pca_dimensions = rotated_high - rotated_low
    samples = np.bincount(island, weights=triangle_samples, minlength=number).astype(np.int64)
    areas = np.bincount(island, weights=np.concatenate([record["areas"] for record in records]),
                        minlength=number)
    triangle_counts = np.bincount(island, minlength=number)
    missing = np.flatnonzero(samples == 0)
    pca_short = pca_dimensions.min(axis=1)
    labels = [(record["name"], record["primitive"], i)
              for record in records for i in range(len(record["uv"]))]
    interesting = missing[np.argsort(-areas[missing])][:40]
    details = []
    for index in interesting:
        members = np.flatnonzero(island == index)
        details.append({"island": int(index), "triangles": int(triangle_counts[index]),
                        "worldArea": float(areas[index]), "uvBoundsTexels": [low[index].tolist(), high[index].tolist()],
                        "axisDimensionsTexels": dimensions[index].tolist(),
                        "pcaDimensionsTexels": pca_dimensions[index].tolist(),
                        "members": [{"name": labels[i][0], "primitive": labels[i][1], "triangle": labels[i][2]}
                                    for i in members[:20]], "memberListTruncated": len(members) > 20})
    return {"count": number, "withoutInteriorTexel": len(missing),
            "pcaShortSideUnderTwoTexels": int(np.count_nonzero(pca_short < 2-1e-4)),
            "minimumPcaShortSideTexels": float(pca_short.min()),
            "samplelessWorldArea": float(areas[missing].sum()),
            "largestSamplelessIslands": details}


def fragment_bake_coverage(records, fragment_labels, triangle_samples, linear):
    """Inspect the actual bake at export fragments lacking their own texel centre.

    Seven locations per triangle (corners, edge midpoints, centroid) include all
    four bilinear taps. This is a finite sampling diagnostic, not a claim that
    every point on a triangle has been covered. Source chart raster coverage is
    checked independently and never waived by these probes.
    """
    samples = np.bincount(fragment_labels, weights=triangle_samples)
    missing = np.flatnonzero(samples == 0)
    uv = np.concatenate([r["uv"] for r in records])
    areas = np.concatenate([r["areas"] for r in records])
    names = [r["name"] for r in records for _ in r["uv"]]
    weights = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1], [.5, .5, 0],
                        [0, .5, .5], [.5, 0, .5], [1/3, 1/3, 1/3]])
    height, width = linear.shape[:2]
    details = []
    for fragment in missing:
        indices = np.flatnonzero(fragment_labels == fragment)
        points = np.einsum("ij,tjk->tik", weights, uv[indices]).reshape(-1, 2) * [width, height] - .5
        low = np.floor(points).astype(int)
        fraction = points - low
        taps = np.stack([low, low + [1, 0], low + [0, 1], low + [1, 1]], axis=1)
        taps = np.clip(taps, [0, 0], [width - 1, height - 1])
        alpha = linear[taps[:, :, 1], taps[:, :, 0], 3]
        blend = np.array([(1-fraction[:, 0])*(1-fraction[:, 1]), fraction[:, 0]*(1-fraction[:, 1]),
                           (1-fraction[:, 0])*fraction[:, 1], fraction[:, 0]*fraction[:, 1]]).T
        bilinear_alpha = (alpha * blend).sum(axis=1)
        details.append({"fragment": int(fragment), "triangles": len(indices),
            "names": sorted({names[i] for i in indices}), "worldAreaM2": float(areas[indices].sum()),
            "probePoints": len(points), "minimumBilinearAlpha": float(bilinear_alpha.min()),
            "alphaZeroTaps": int(np.count_nonzero(alpha <= 0)),
            "fullyUncoveredPoints": int(np.count_nonzero(bilinear_alpha <= 0))})
    return {"method": "7 UV positions per triangle, all 4 bilinear raw-alpha taps; finite sampling diagnostic",
            "fragments": len(details), "fragmentsWithAllTapsCovered": sum(d["alphaZeroTaps"] == 0 for d in details),
            "probePoints": sum(d["probePoints"] for d in details),
            "fullyUncoveredPoints": sum(d["fullyUncoveredPoints"] for d in details), "details": details}


def bilinear_support_coverage(records, linear, radius=1.0):
    """Check all UV positions, including subpixel triangles, against raw coverage.

    A texture sample can read any pixel centre within a Chebyshev distance of
    one texel. Triangle/square separating axes therefore test the complete
    bilinear support, rather than a finite list of triangle sample positions.
    The decoder uses delivered glTF UVs; raw rows already match glTF orientation.
    """
    height, width = linear.shape[:2]
    missing = linear[:, :, 3] <= 0
    required_missing = np.zeros((height, width), np.bool_)
    details, excluded = [], []
    for record in records:
        if record["material"].startswith("ME_") or record["material"].startswith("MU_decal_"):
            excluded.append(record["name"])
            continue
        count, examples = 0, []
        for index, uv in enumerate(record["uv"]):
            triangle = uv * [width, height]
            low = np.maximum(np.ceil(triangle.min(axis=0) - .5 - radius).astype(int), 0)
            high = np.minimum(np.floor(triangle.max(axis=0) - .5 + radius).astype(int), [width-1, height-1])
            if np.any(high < low):
                continue
            yy, xx = np.nonzero(missing[low[1]:high[1]+1, low[0]:high[0]+1])
            if not len(xx):
                continue
            xx, yy = xx + low[0], yy + low[1]
            points = np.column_stack((xx+.5, yy+.5)) - triangle[0]
            vertices = triangle - triangle[0]
            intersects = np.ones(len(xx), np.bool_)
            for edge in np.roll(triangle, -1, axis=0) - triangle:
                normal = np.array([-edge[1], edge[0]])
                length = np.linalg.norm(normal)
                if length <= 1e-20:
                    continue
                normal /= length
                projection = vertices @ normal
                centres = points @ normal
                reach = radius * np.abs(normal).sum()
                intersects &= ((centres+reach >= projection.min()-1e-10) &
                               (centres-reach <= projection.max()+1e-10))
            if not np.any(intersects):
                continue
            xx, yy = xx[intersects], yy[intersects]
            required_missing[yy, xx] = True
            count += 1
            if len(examples) < 10:
                examples.append({"triangle": index, "missingTapTexels": len(xx),
                                 "worldAreaM2": float(record["areas"][index]),
                                 "worldCentroid": record["world"][index].mean(axis=0).tolist()})
        if count:
            details.append({"name": record["name"], "affectedTriangles": count, "examples": examples})
    return {"method": "conservative triangle-square intersection at every alpha-zero pixel centre",
            "radiusPixels": radius, "requiredAlphaZeroTexels": int(required_missing.sum()),
            "affectedTriangles": sum(d["affectedTriangles"] for d in details),
            "excludedTransparentOrEmissiveMeshes": excluded, "meshes": details}


def raster_atlas(records, pixels, linear, value_range, multiplier_exponent=1, island_labels=None):
    height, width = pixels.shape[:2]
    owner = np.full((height, width), -1, np.int32)
    overlaps = np.zeros((height, width), np.bool_)
    decoded = (pixels[..., :3].astype(np.float32) / 255 *
               (pixels[..., 3:4].astype(np.float32) / 255) ** multiplier_exponent * value_range)
    labels, collisions, black, meshes = [], Counter(), [], []
    triangle_samples = np.zeros(sum(len(record["uv"]) for record in records), np.int32)
    no_samples = 0
    next_id = 0
    for record in records:
        sample_count = raw_black = encoded_black = unbaked = 0
        rgb_sum = np.zeros(3, np.float64)
        raw_rgb_sum = np.zeros(3, np.float64)
        for triangle_index, triangle in enumerate(record["uv"]):
            label = {"name": record["name"], "primitive": record["primitive"], "triangle": triangle_index}
            labels.append(label)
            ident = next_id
            next_id += 1
            uv = triangle * [width, height]
            low = np.maximum(np.ceil(uv.min(axis=0)-0.5).astype(int), 0)
            high = np.minimum(np.floor(uv.max(axis=0)-0.5).astype(int), [width-1, height-1])
            e1, e2 = uv[1]-uv[0], uv[2]-uv[0]
            determinant = e1[0]*e2[1] - e1[1]*e2[0]
            if abs(determinant) < 1e-10 or np.any(high < low):
                no_samples += 1
                continue
            yy, xx = np.mgrid[low[1]:high[1]+1, low[0]:high[0]+1]
            dx, dy = xx + 0.5 - uv[0, 0], yy + 0.5 - uv[0, 1]
            u = (dx*e2[1]-dy*e2[0])/determinant
            v = (e1[0]*dy-e1[1]*dx)/determinant
            interior = (u > 1e-6) & (v > 1e-6) & (u+v < 1-1e-6)
            xx, yy = xx[interior], yy[interior]
            count = len(xx)
            triangle_samples[ident] = count
            if not count:
                no_samples += 1
                continue
            existing = owner[yy, xx]
            overlap = existing >= 0
            if np.any(overlap):
                overlaps[yy[overlap], xx[overlap]] = True
                ids, counts = np.unique(existing[overlap], return_counts=True)
                for previous, hits in zip(ids, counts):
                    collisions[(int(previous), ident)] += int(hits)
            owner[yy, xx] = ident
            color = decoded[yy, xx]
            is_black = color.max(axis=1) <= 1e-6
            sample_count += count
            encoded_black += int(is_black.sum())
            rgb_sum += color.sum(axis=0)
            detail = {**label, "pixels": count, "encodedBlackPixels": int(is_black.sum()),
                      "encodedMean": color.mean(axis=0).tolist(),
                      "worldCentroid": record["world"][triangle_index].mean(axis=0).tolist(),
                      "worldArea": float(record["areas"][triangle_index]),
                      "uv": triangle.tolist()}
            if linear is not None:
                values = linear[yy, xx]
                raw_is_black = values[:, :3].max(axis=1) <= 1e-6
                raw_black += int(raw_is_black.sum())
                raw_rgb_sum += values[:, :3].sum(axis=0)
                unbaked += int((values[:, 3] <= 0).sum())
                detail.update(rawMean=values[:, :3].mean(axis=0).tolist(),
                              rawBlackPixels=int(raw_is_black.sum()),
                              rawUncoveredPixels=int((values[:, 3] <= 0).sum()))
            if count >= 16 and is_black.mean() > 0.90:
                black.append(detail)
        meshes.append({"name": record["name"], "material": record["material"], "texelSamples": sample_count,
                       "encodedBlackPixels": encoded_black, "rawBlackPixels": raw_black,
                       "rawUncoveredPixels": unbaked,
                       "encodedMeanRGB": (rgb_sum/max(1, sample_count)).tolist(),
                       "rawMeanRGB": (raw_rgb_sum/max(1, sample_count)).tolist() if linear is not None else None})
    pairs = [{"a": labels[a], "b": labels[b], "interiorTexels": count}
             for (a, b), count in collisions.most_common()]
    summary = {"triangleCount": next_id, "trianglesWithoutInteriorTexel": no_samples,
            "occupiedTexels": int((owner >= 0).sum()), "overlapTexels": int(overlaps.sum()),
            "overlapPairs": len(collisions), "worstOverlapPairs": pairs[:30], "allOverlapPairs": pairs,
            "blackTriangles": sorted(black, key=lambda item: -item["pixels"])[:40],
            "meshLighting": meshes,
            "islands": uv_islands(records, triangle_samples, width, height, island_labels)}
    if island_labels is not None:
        fragment_labels = uv_island_labels(records)
        summary["independentlyExportedFragments"] = uv_islands(records, triangle_samples, width, height, fragment_labels)
        if linear is not None:
            summary["exportFragmentBakeCoverage"] = fragment_bake_coverage(records, fragment_labels, triangle_samples, linear)
    return summary, owner, overlaps


def validate(args):
    start = time.perf_counter()
    glb = GLB(args.glb)
    level = json.loads(args.level.read_text())
    layout = json.loads(args.layout.read_text())
    errors = []
    def issue(code, message):
        errors.append({"code": code, "message": message})
    result = {"input": {"glb": str(args.glb.resolve()), "sha256": glb.sha256, "bytes": glb.bytes,
                         "level": str(args.level.resolve())},
              "method": {"geometryAreaThresholdM2": 1e-12, "uvAreaThreshold": 5e-17,
                         "overlap": "strict barycentric interior at full-resolution texel centres, edge epsilon 1e-6",
                         "rawOrientation": "bottom-up NPY flipped to match top-down PNG and glTF UVs"}}
    result["coordinates"] = coordinates(level, layout, glb, issue)
    result["sharedImageBuffers"] = []
    for dependency in level.get("bake", {}).get("compression", {}).get("sharedImageBuffers", []):
        file = (args.base / "models" / dependency["uri"]).resolve()
        if not file.is_relative_to(args.base.resolve()):
            issue("shared_images", f"Shared image buffer leaves the public root: {dependency['uri']}")
            continue
        if not file.is_file():
            issue("shared_images", f"Missing shared image buffer: {dependency['uri']}")
            continue
        data = file.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if len(data) != dependency["bytes"] or digest != dependency["sha256"]:
            issue("shared_images", f"Shared image offsets require a fresh house export: {dependency['uri']}")
        result["sharedImageBuffers"].append({"uri": dependency["uri"], "bytes": len(data), "sha256": digest})
    collision_file = args.base / level["collisionModel"]
    collision = GLB(collision_file)
    collision_doors = {node.get("name"): node for node in collision.document.get("nodes", [])
                       if node.get("name", "").startswith("DOOR_")}
    for door in level["doors"]:
        if door["kind"] != "door": continue
        extras = collision_doors.get(door["object"], {}).get("extras", {})
        if not same(extras.get("hinge"), door["hinge"]) or extras.get("coordinateSystem") != "Three.js Y-up":
            issue("doors", f"Collision door hinge metadata mismatch: {door['object']}")
    result["collision"] = {"sha256": collision.sha256, "bytes": collision.bytes, "doorNodes": len(collision_doors)}
    encoding = level.get("lightmapEncoding", {})
    if encoding.get("type") != "RGBM" or encoding.get("colorSpace") != "linear" or encoding.get("texCoord") != 1:
        issue("metadata", "Expected RGBM linear encoding on TEXCOORD_1")
    result["geometry"], records = geometry(glb, level, issue, args.allow_sampled_uv_degenerate)
    reference_records = None
    if args.reference_glb:
        reference = GLB(args.reference_glb)
        reference_geometry, reference_records = geometry(reference, level, issue, args.allow_sampled_uv_degenerate)
        result["input"]["bakeReference"] = {
            "glb": str(args.reference_glb.resolve()), "sha256": reference.sha256, "bytes": reference.bytes}
        result["method"]["chartIdentity"] = (
            "Bake-reference world/UV edge connectivity; delivery triangles matched per primitive using exact "
            "float32 UVs or the complete bounded uint16-rounded UV triangle multiset. "
            "Delivery interior samples and overlaps are tested on delivered UVs.")
        if set(reference_records) != set(records):
            issue("reference", "Bake reference and delivery atlas sets differ")
    result["totals"] = {"meshNodes": len([n for n in glb.document["nodes"] if "mesh" in n]),
                        "triangles": sum(r["triangles"] for r in result["geometry"]),
                        "primitivesWithVertexColors": sum(r.get("vertexColorCount", 0) > 0 for r in result["geometry"]),
                        "geometricDegenerate": sum(r["geometricDegenerate"] for r in result["geometry"]),
                        "uvDegenerate": sum(r.get("uvDegenerate", 0) for r in result["geometry"]),
                        "uvSubTenthTexel": sum(r.get("uvSubTenthTexel", 0) for r in result["geometry"])}
    expected_maps = {item["path"]: item for item in level["lightmaps"]}
    if set(records) != set(expected_maps):
        issue("metadata", "Atlas references differ between meshes and level.lightmaps")
    png_bytes = 0
    atlas_results = []
    for path, definition in expected_maps.items():
        file = args.base / path
        if not file.exists():
            issue("png", f"Missing lightmap: {file}")
            continue
        png_bytes += file.stat().st_size
        if args.atlas and definition["id"] not in args.atlas.split(","):
            continue
        pixels, png_info = read_png(file)
        height, width, channels = pixels.shape
        if channels != 4 or width != definition["width"] or height != definition["height"]:
            issue("png", f"Wrong PNG dimensions/channels: {path}")
            continue
        if width != 2048 or height != 2048:
            issue("png", f"Atlas is not 2048 square: {path}")
        if any(kind in png_info["chunks"] for kind in ("sRGB", "gAMA", "iCCP")):
            issue("png", f"RGBM data PNG has color-management chunks: {path}")
        if definition.get("bytes") != file.stat().st_size:
            issue("png", f"PNG byte count differs from level.json: {path}")
        if definition.get("sha256") and definition["sha256"] != png_info["sha256"]:
            issue("png", f"PNG SHA256 differs from level.json: {path}")
        value_range = float(definition["range"])
        multiplier_exponent = float(definition.get("multiplierExponent", 1))
        if not math.isfinite(value_range) or value_range <= 0:
            issue("png", f"Invalid RGBM range: {path}")
        if not math.isfinite(multiplier_exponent) or multiplier_exponent <= 0:
            issue("png", f"Invalid RGBM multiplier exponent: {path}")
        for mesh in level["meshes"]:
            if mesh["lightmap"] == path and not same(mesh["lightmapEncoding"].get("range"), value_range):
                issue("metadata", f"{mesh['name']}: RGBM range differs from atlas")
            if mesh["lightmap"] == path and not same(mesh["lightmapEncoding"].get("multiplierExponent", 1), multiplier_exponent):
                issue("metadata", f"{mesh['name']}: RGBM multiplier exponent differs from atlas")
        linear = None
        linear_path = args.raw_dir / (definition["id"] + "-linear.npy") if args.raw_dir else None
        if linear_path and linear_path.exists():
            linear = np.load(linear_path, mmap_mode="r")[::-1]
            if linear.shape != (height, width, 4) or not np.isfinite(linear).all():
                issue("raw", f"Invalid raw lightmap: {linear_path}")
                linear = None
        island_labels, comparison = None, None
        if reference_records is not None:
            island_labels, comparison = reference_island_labels(reference_records[path], records[path])
        summary, owner, overlap = raster_atlas(records[path], pixels, linear, value_range, multiplier_exponent,
                                              island_labels)
        if comparison is not None:
            summary["bakeReferenceMatch"] = comparison
        summary.update(id=definition["id"], path=path, pngBytes=file.stat().st_size,
                       png=png_info, range=value_range, multiplierExponent=multiplier_exponent, rawPresent=linear is not None)
        if linear is not None:
            with linear_path.open('rb') as stream:
                checksum = hashlib.sha256()
                for block in iter(lambda: stream.read(1024*1024), b''):
                    checksum.update(block)
            summary["rawSHA256"] = checksum.hexdigest()
            summary["bilinearBakeCoverage"] = bilinear_support_coverage(records[path], linear)
            if summary["bilinearBakeCoverage"]["requiredAlphaZeroTexels"]:
                issue("bake_coverage", f"{definition['id']}: {summary['bilinearBakeCoverage']['requiredAlphaZeroTexels']} "
                      "uncovered raw texels belong to opaque UV bilinear support")
        if summary["overlapTexels"]:
            issue("overlap", f"{definition['id']}: {summary['overlapTexels']} atlas texels inside multiple triangles")
        if summary["islands"]["withoutInteriorTexel"]:
            issue("coverage", f"{definition['id']}: {summary['islands']['withoutInteriorTexel']} complete UV islands have no interior texel sample")
        atlas_results.append(summary)
        if args.diagnostics:
            args.diagnostics.mkdir(parents=True, exist_ok=True)
            preview = np.zeros((height, width, 4), np.uint8)
            preview[..., 3] = 255
            preview[owner >= 0, :3] = [80, 140, 190]
            preview[overlap, :3] = [255, 40, 20]
            write_png(args.diagnostics / (definition["id"] + "-packing.png"), preview)
        print(f"{definition['id']}: {summary['triangleCount']} triangles, "
              f"{summary['overlapTexels']} overlap texels, {summary['trianglesWithoutInteriorTexel']} subpixel/edge-only", flush=True)
    result["atlases"] = atlas_results
    result["totals"]["lightmapBytes"] = png_bytes
    result["totals"]["overlapTexels"] = sum(item["overlapTexels"] for item in atlas_results)
    result["totals"]["samplelessIslands"] = sum(item["islands"]["withoutInteriorTexel"] for item in atlas_results)
    result["totals"]["uvIslands"] = sum(item["islands"]["count"] for item in atlas_results)
    result["totals"]["uncoveredBilinearTexels"] = sum(
        item.get("bilinearBakeCoverage", {}).get("requiredAlphaZeroTexels", 0) for item in atlas_results)
    result["totals"]["lightmapBudgetBytes"] = args.max_lightmap_bytes
    result["warnings"] = []
    if reference_records is not None:
        result["totals"]["independentlyExportedFragments"] = sum(
            item["independentlyExportedFragments"]["count"] for item in atlas_results)
        result["totals"]["exportFragmentsWithoutInteriorTexel"] = sum(
            item["independentlyExportedFragments"]["withoutInteriorTexel"] for item in atlas_results)
        if result["totals"]["exportFragmentsWithoutInteriorTexel"]:
            result["warnings"].append({"code": "export_fragment_connectivity",
                "message": "Independent primitive quantization splits exact world/UV edge identity. "
                    "Coverage uses matched original bake charts; exact exported fragment counts remain in atlas diagnostics.",
                "fragmentsWithoutInteriorTexel": result["totals"]["exportFragmentsWithoutInteriorTexel"]})
    if args.allow_sampled_uv_degenerate and result["totals"]["uvDegenerate"]:
        result["warnings"].append({"code": "sampled_uv_degenerate",
            "message": "Geometrically valid UV-collinear triangles retained; all islands must still pass interior-texel coverage.",
            "triangles": result["totals"]["uvDegenerate"],
            "worldAreaM2": sum(r.get("uvDegenerateWorldAreaM2", 0) for r in result["geometry"]),
            "largestWorldAreaM2": max(r.get("uvDegenerateLargestWorldAreaM2", 0) for r in result["geometry"])})
    if png_bytes > args.max_lightmap_bytes:
        issue("budget", f"Lightmaps exceed {args.max_lightmap_bytes} bytes: {png_bytes}")
    result["errors"] = errors
    result["passed"] = not errors
    result["seconds"] = round(time.perf_counter() - start, 3)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"passed": result["passed"], "totals": result["totals"],
                      "errors": len(errors), "seconds": result["seconds"], "report": str(args.output)}, indent=2))
    return 0 if result["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    public = REPO / "public/bodycam-demo"
    parser.add_argument("--glb", type=Path, default=public / "models/house.glb")
    parser.add_argument("--level", type=Path, default=public / "data/level.json")
    parser.add_argument("--layout", type=Path, default=HERE / "layout.json")
    parser.add_argument("--base", type=Path, default=public, help="Root used by lightmap paths in level.json")
    parser.add_argument("--raw-dir", type=Path, help="Optional directory of ATLAS-linear.npy bake evidence")
    parser.add_argument("--reference-glb", type=Path,
                        help="Original pre-quantization bake GLB, to preserve chart identity across separately quantized primitives")
    parser.add_argument("--atlas", help="Optional comma-separated atlas ids for investigation; all metadata is still checked")
    parser.add_argument("--diagnostics", type=Path, help="Write packing PNGs here")
    parser.add_argument("--max-lightmap-bytes", type=int, default=40_000_000)
    parser.add_argument("--allow-sampled-uv-degenerate", action="store_true",
                        help="Report UV-collinear micro triangles as warnings, while still requiring complete chart coverage")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        return validate(args)
    except (ValueError, KeyError, OSError, struct.error) as error:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({"passed": False, "fatal": str(error)}, indent=2) + "\n")
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
