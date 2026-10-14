#!/usr/bin/env python3
"""Bake a capsule-clearance grid from the deployed collision GLB (Python + numpy)."""

import argparse
from collections import Counter, deque
import hashlib
import json
import math
from pathlib import Path
import struct
import time

import numpy as np

REPO = Path(__file__).resolve().parents[4]
ROOT = REPO / "public/bodycam-demo"
DIRECTIONS = [(1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (-1, -1), (1, -1)]
GROUND_SURFACES = {"wood", "carpet", "tile", "concrete", "dirt", "grass", "asphalt"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def matrix_of(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    matrix = np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w), 0],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w), 0],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y), 0],
        [0, 0, 0, 1],
    ], dtype=float)
    matrix[:3, :3] *= np.array(node.get("scale", [1, 1, 1]))[None, :]
    matrix[:3, 3] = node.get("translation", [0, 0, 0])
    return matrix


def read_collision(path):
    raw = path.read_bytes()
    if raw[:4] != b"glTF" or struct.unpack_from("<I", raw, 4)[0] != 2:
        raise ValueError("Expected a glTF 2 GLB")
    cursor, gltf, binary = 12, None, None
    while cursor < len(raw):
        length, kind = struct.unpack_from("<II", raw, cursor)
        chunk = raw[cursor+8:cursor+8+length]
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        cursor += length+8
    if gltf is None or binary is None:
        raise ValueError("GLB requires JSON and BIN chunks")
    if gltf.get("extensionsRequired"):
        raise ValueError("Bake an uncompressed collision GLB; unsupported required extensions")

    def accessor(index):
        source = gltf["accessors"][index]
        if source.get("sparse"):
            raise ValueError("Sparse collision accessors are unsupported")
        view = gltf["bufferViews"][source["bufferView"]]
        dtype = {5120: "i1", 5121: "u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[source["componentType"]]
        components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[source["type"]]
        size = np.dtype(dtype).itemsize
        return np.ndarray((source["count"], components), dtype=dtype, buffer=binary,
                          offset=view.get("byteOffset", 0)+source.get("byteOffset", 0),
                          strides=(view.get("byteStride", size*components), size)).copy()

    triangles, surfaces, evidence, door_evidence = [], [], [], []

    def visit(index, parent, excluded=False):
        node = gltf["nodes"][index]
        matrix = parent @ matrix_of(node)
        extra = node.get("extras", {})
        excluded = excluded or node.get("name", "").startswith("DOOR_") or extra.get("collisionKind") == "door"
        if "mesh" in node:
            count = 0
            for primitive in gltf["meshes"][node["mesh"]]["primitives"]:
                if primitive.get("mode", 4) != 4 or primitive.get("extensions"):
                    raise ValueError("Expected plain triangle collision primitives")
                positions = accessor(primitive["attributes"]["POSITION"])
                positions = positions @ matrix[:3, :3].T + matrix[:3, 3]
                indices = accessor(primitive["indices"]).reshape(-1) if "indices" in primitive else np.arange(len(positions))
                tri = positions[indices.reshape(-1, 3)]
                count += len(tri)
                if not excluded and extra.get("collision", True) is not False:
                    triangles.append(tri)
                    surfaces.extend([extra.get("surface", "concrete")]*len(tri))
            (door_evidence if excluded else evidence).append({"name": node.get("name", str(index)), "triangles": count})
        for child in node.get("children", []):
            visit(child, matrix, excluded)

    for index in gltf["scenes"][gltf.get("scene", 0)]["nodes"]:
        visit(index, np.eye(4))
    return np.concatenate(triangles), np.array(surfaces), evidence, door_evidence


def point_segment_d2(point, a, b):
    edge = b-a
    den = np.sum(edge*edge, axis=1)
    fraction = np.clip(np.sum((point-a)*edge, axis=1)/np.maximum(den, 1e-24), 0, 1)
    delta = point-(a+fraction[:, None]*edge)
    return np.sum(delta*delta, axis=1)


def barycentric(point, a, b, c):
    ab, ac, ap = b-a, c-a, point-a
    d00, d01, d11 = np.sum(ab*ab, axis=1), np.sum(ab*ac, axis=1), np.sum(ac*ac, axis=1)
    d20, d21 = np.sum(ap*ab, axis=1), np.sum(ap*ac, axis=1)
    den = d00*d11-d01*d01
    good = np.abs(den) > 1e-20
    den = np.where(good, den, 1)
    v, w = (d11*d20-d01*d21)/den, (d00*d21-d01*d20)/den
    return good & (v >= -1e-9) & (w >= -1e-9) & (v+w <= 1+1e-9)


def point_triangle_d2(point, a, b, c):
    normal = np.cross(b-a, c-a)
    norm2 = np.sum(normal*normal, axis=1)
    signed = np.sum((point-a)*normal, axis=1)
    projected = point-normal*(signed/np.maximum(norm2, 1e-24))[:, None]
    plane = signed*signed/np.maximum(norm2, 1e-24)
    edge = np.minimum(np.minimum(point_segment_d2(point, a, b), point_segment_d2(point, b, c)), point_segment_d2(point, c, a))
    return np.where(barycentric(projected, a, b, c), plane, edge)


def segment_segment_d2(start, end, a, b):
    u, v, w = end-start, b-a, start-a
    aa = np.dot(u, u)
    bb, cc = v @ u, np.sum(v*v, axis=1)
    dd, ee = w @ u, np.sum(v*w, axis=1)
    den = aa*cc-bb*bb
    fraction = np.where(den > 1e-20, (bb*ee-cc*dd)/np.maximum(den, 1e-24), 0)
    fraction = np.clip(fraction, 0, 1)
    other = (bb*fraction+ee)/np.maximum(cc, 1e-24)
    low, high = other < 0, other > 1
    fraction = np.where(low, np.clip(-dd/aa, 0, 1), fraction)
    fraction = np.where(high, np.clip((bb-dd)/aa, 0, 1), fraction)
    other = np.clip(other, 0, 1)
    delta = w+fraction[:, None]*u-other[:, None]*v
    return np.sum(delta*delta, axis=1)


def capsule_distances(x, floor, z, triangles, radius, height, skin):
    start, end = np.array([x, floor+radius+skin, z]), np.array([x, floor+height-radius+skin, z])
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    distance2 = np.minimum(point_triangle_d2(start, a, b, c), point_triangle_d2(end, a, b, c))
    for one, two in [(a, b), (b, c), (c, a)]:
        distance2 = np.minimum(distance2, segment_segment_d2(start, end, one, two))
    normal = np.cross(b-a, c-a)
    den = normal @ (end-start)
    fraction = np.sum((a-start)*normal, axis=1)/np.where(np.abs(den) > 1e-20, den, 1)
    intersection = start+fraction[:, None]*(end-start)
    inside = (np.abs(den) > 1e-20) & (fraction >= 0) & (fraction <= 1) & barycentric(intersection, a, b, c)
    distance2[inside] = 0
    return np.sqrt(np.maximum(0, distance2))


def room_at(x, z, rooms):
    for index, room in enumerate(rooms):
        for x0, z0, x1, z1 in room.get("rects", []):
            if x0 <= x <= x1 and z0 <= z <= z1:
                return index
        if not room.get("rects") and room.get("aabb"):
            x0, _, z0, x1, _, z1 = room["aabb"]
            if x0 <= x <= x1 and z0 <= z <= z1:
                return index
    return next((i for i, room in enumerate(rooms) if room["id"] == "OUT"), -1)


class CollisionGrid:
    def __init__(self, triangles, surfaces, bounds, rooms, radius, height, step, skin):
        self.triangles, self.surfaces = triangles, surfaces
        self.low, self.high = triangles.min(axis=1), triangles.max(axis=1)
        normal = np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0])
        norm = np.linalg.norm(normal, axis=1)
        self.normals = normal/np.maximum(norm[:, None], 1e-24)
        self.walkable = (self.normals[:, 1] >= math.cos(math.radians(48))) & np.isin(surfaces, list(GROUND_SURFACES))
        self.rooms, self.radius, self.height, self.step, self.skin = rooms, radius, height, step, skin
        self.bin_size = .5
        self.bins = {}
        for i in range(len(triangles)):
            if self.high[i, 0] < bounds[0]-radius or self.low[i, 0] > bounds[2]+radius or self.high[i, 2] < bounds[1]-radius or self.low[i, 2] > bounds[3]+radius:
                continue
            x0, x1 = max(bounds[0]-radius, self.low[i, 0]), min(bounds[2]+radius, self.high[i, 0])
            z0, z1 = max(bounds[1]-radius, self.low[i, 2]), min(bounds[3]+radius, self.high[i, 2])
            for ix in range(math.floor(x0/self.bin_size), math.floor(x1/self.bin_size)+1):
                for iz in range(math.floor(z0/self.bin_size), math.floor(z1/self.bin_size)+1):
                    self.bins.setdefault((ix, iz), []).append(i)
        self.bins = {key: np.array(value, dtype=np.int32) for key, value in self.bins.items()}
        self.query_cache = {}

    def nearby(self, x, z, radius):
        key = (round(x, 5), round(z, 5), round(radius, 4))
        if key in self.query_cache:
            return self.query_cache[key]
        chunks = [self.bins.get((ix, iz), [])
                  for ix in range(math.floor((x-radius)/self.bin_size), math.floor((x+radius)/self.bin_size)+1)
                  for iz in range(math.floor((z-radius)/self.bin_size), math.floor((z+radius)/self.bin_size)+1)]
        chunks = [q for q in chunks if len(q)]
        ids = np.unique(np.concatenate(chunks)) if chunks else np.array([], dtype=np.int32)
        mask = (self.low[ids, 0] <= x+radius) & (self.high[ids, 0] >= x-radius) & (self.low[ids, 2] <= z+radius) & (self.high[ids, 2] >= z-radius)
        ids = ids[mask]
        self.query_cache[key] = ids
        return ids

    def floor(self, x, z, with_normal=False):
        ids = self.nearby(x, z, .00001)
        ids = ids[self.walkable[ids]]
        if not len(ids):
            return None
        tri = self.triangles[ids]
        a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
        normal = self.normals[ids]
        y = a[:, 1]-(normal[:, 0]*(x-a[:, 0])+normal[:, 2]*(z-a[:, 2]))/normal[:, 1]
        points = np.column_stack((np.full(len(y), x), y, np.full(len(y), z)))
        valid = barycentric(points, a, b, c)
        room = self.rooms[room_at(x, z, self.rooms)]
        expected = room.get("floorY")
        if expected is not None and not room.get("outdoor"):
            # Room floors, not furniture tops or the ground below the raised house.
            valid &= (y >= expected-.08) & (y <= expected+.035)
        elif expected is not None:
            valid &= (y >= expected-.08) & (y <= expected+.035)
        else:
            valid &= (y >= -.6) & (y <= .65)
        if not np.any(valid):
            return None
        selected = np.flatnonzero(valid)[np.argmax(y[valid])]
        result = float(y[selected])
        return (result, float(normal[selected, 1])) if with_normal else result

    def support(self, x, z):
        center = self.floor(x, z, True)
        if center is None:
            return None
        floor, normal_y = center
        samples = [floor]
        for angle in range(0, 360, 45):
            radians = math.radians(angle)
            sample = self.floor(x+math.cos(radians)*self.radius*.92, z+math.sin(radians)*self.radius*.92)
            if sample is None:
                return None
            samples.append(sample)
        limit = self.step+.002
        if normal_y < .999:
            # A continuous walkable ramp is not a discontinuous step. The capsule
            # sits above its plane by r / normalY rather than on the plane itself.
            limit = max(limit, 2*self.radius*.92*math.tan(math.radians(48))+.002)
        if max(samples)-min(samples) > limit:
            return None
        if normal_y < .999:
            return floor+self.radius*(1/normal_y-1)
        # The highest support under the footprint matches the player's step helper.
        return max(samples)

    def clear(self, x, y, z, want_clearance=False):
        radius = self.radius
        ids = self.nearby(x, z, radius+.085 if want_clearance else radius+.003)
        mask = (self.low[ids, 1] <= y+self.height+self.skin) & (self.high[ids, 1] >= y-.005)
        ids = ids[mask]
        if not len(ids):
            return (True, 10.0) if want_clearance else True
        distances = capsule_distances(x, y, z, self.triangles[ids], radius, self.height, self.skin)
        clear = bool(np.all(distances >= radius-1e-5))
        if want_clearance:
            floor = self.walkable[ids] & (self.high[ids, 1] <= y+self.skin+.001)
            obstacle = distances[~floor]
            return clear, float(obstacle.min()) if len(obstacle) else 10.0
        return clear

    def edge_clear(self, one, two, one_clearance, two_clearance, cell):
        delta = two-one
        if abs(delta[1]) > self.step+.002:
            return False
        flat = math.hypot(delta[0], delta[2])
        middle = (one+two)/2
        raised = max(one[1], two[1])
        if not self.clear(middle[0], raised, middle[2]):
            return False
        if abs(delta[1]) < .002 and min(one_clearance, two_clearance) > self.radius+flat/2+.004:
            return True
        count = max(2, math.ceil(flat/.035))
        # Raise across a step, then descend at the destination; never sweep through a riser.
        for i in range(1, count):
            point = one+delta*(i/count)
            support = self.support(point[0], point[2])
            if support is None or abs(support-raised) > self.step+.002:
                return False
            if not self.clear(point[0], max(raised, support), point[2]):
                return False
        return True


def bake(args):
    started = time.monotonic()
    output = Path(args.output).expanduser().resolve() if args.output else ROOT / "data/nav.json"
    if output != ROOT / "data/nav.json" and output.is_relative_to(REPO):
        raise ValueError('Bake variants must be outside the repository; only data/nav.json is a deploy artifact')
    level_path, collision_path = ROOT / args.level, ROOT / args.collision
    level = json.loads(level_path.read_text())
    if "Y-up" not in level.get("coords", ""):
        raise ValueError("level.json must use Three.js Y-up coordinates")
    rooms = level["rooms"]
    triangles, surfaces, meshes, door_meshes = read_collision(collision_path)
    finite = [room["aabb"] for room in rooms if room.get("aabb")]
    anchors = [level["playerSpawn"]["position"], *[q["position"] for q in level.get("npcs", [])]]
    if args.bounds:
        bounds = args.bounds
    else:
        bounds = [min([b[0] for b in finite]+[p[0] for p in anchors])-args.padding,
                  min([b[2] for b in finite]+[p[2] for p in anchors])-args.padding,
                  max([b[3] for b in finite]+[p[0] for p in anchors])+args.padding,
                  max([b[5] for b in finite]+[p[2] for p in anchors])+args.padding]
    cell = args.cell
    origin = [math.floor(bounds[0]/cell)*cell+cell/2, math.floor(bounds[1]/cell)*cell+cell/2]
    width = math.ceil((bounds[2]-origin[0])/cell)+1
    depth = math.ceil((bounds[3]-origin[1])/cell)+1
    queries = CollisionGrid(triangles, surfaces, bounds, rooms, args.radius, args.height, args.step, args.skin)
    nodes, xyz, clearance, lookup = [], [], [], {}
    for iz in range(depth):
        for ix in range(width):
            x, z = origin[0]+ix*cell, origin[1]+iz*cell
            floor = queries.support(x, z)
            if floor is None:
                continue
            clear, margin = queries.clear(x, floor, z, True)
            if not clear:
                continue
            lookup[(ix, iz)] = len(nodes)
            nodes.append([ix, iz, round(floor+args.skin, 5), room_at(x, z, rooms), 0])
            xyz.append([x, floor, z])
            clearance.append(margin)
        if iz % 40 == 0:
            print(f"rows {iz}/{depth}: {len(nodes)} walkable cells", flush=True)
    xyz = np.array(xyz)
    adjacency = [[] for _ in nodes]
    # Cardinal links first. Diagonal links require both cardinal corridors on both sides.
    for direction in range(8):
        dx, dz = DIRECTIONS[direction]
        for i, node in enumerate(nodes):
            ix, iz = node[:2]
            j = lookup.get((ix+dx, iz+dz))
            if j is None or j <= i:
                continue
            if direction >= 4:
                side1, side2 = lookup.get((ix+dx, iz)), lookup.get((ix, iz+dz))
                if side1 is None or side2 is None:
                    continue
                if side1 not in adjacency[i] or side2 not in adjacency[i] or j not in adjacency[side1] or j not in adjacency[side2]:
                    continue
            if queries.edge_clear(xyz[i], xyz[j], clearance[i], clearance[j], cell):
                reverse = DIRECTIONS.index((-dx, -dz))
                node[4] |= 1 << direction
                nodes[j][4] |= 1 << reverse
                adjacency[i].append(j)
                adjacency[j].append(i)
        print(f"links direction {direction}: {sum(len(x) for x in adjacency)//2}", flush=True)
    components, pending = [], set(range(len(nodes)))
    while pending:
        seed = min(pending)
        queue, group = deque([seed]), []
        pending.remove(seed)
        while queue:
            one = queue.popleft()
            group.append(one)
            for other in adjacency[one]:
                if other in pending:
                    pending.remove(other)
                    queue.append(other)
        components.append(group)
    room_indices = {room['id']: index for index, room in enumerate(rooms)}
    # Interior connectivity is the acceptance domain; a large outside lawn must
    # not hide a smaller but fully connected house component.
    def component_key(group):
        room_ids = {nodes[i][3] for i in group if not rooms[nodes[i][3]].get('outdoor')}
        return len(room_ids), len(group)
    main_component = max(range(len(components)), key=lambda k: component_key(components[k])) if components else -1
    largest = set(components[main_component]) if main_component >= 0 else set()
    for component_index, group in enumerate(components):
        for index in group:
            nodes[index].append(component_index)
    room_data = []
    for room_index, room in enumerate(rooms):
        candidates = [i for i, node in enumerate(nodes) if node[3] == room_index and i in largest]
        reachable = bool(candidates)
        if not candidates:
            groups = [[i for i in group if nodes[i][3] == room_index] for group in components]
            candidates = max(groups, key=len, default=[])
        if candidates:
            if room.get("aabb"):
                b = room["aabb"]
                center = np.array([(b[0]+b[3])/2, room.get("floorY", b[1]), (b[2]+b[5])/2])
            else:
                center = np.array(level["playerSpawn"]["position"])
            # Prefer a geometrically clear point near the center. Rejected center points never leak into the API.
            goal = min(candidates, key=lambda i: np.sum((xyz[i]-center)**2))
            position = xyz[goal].copy()
            position[1] = nodes[goal][2]
            room_data.append({"id": room["id"], "name": room.get("name", room["id"]), "goal": np.round(position, 5).tolist(), "node": goal, "cells": len(candidates), "reachable": reachable, "component": nodes[goal][5]})
        else:
            room_data.append({"id": room["id"], "name": room.get("name", room["id"]), "goal": None, "node": None, "cells": 0, "reachable": False})
    doors = [{key: door[key] for key in ["id", "object", "rooms", "position", "axis", "width", "height", "hinge", "closedRotZ", "openDir", "maxAngle", "openAngle"] if key in door}
             for door in level["doors"] if door["kind"] == "door"]
    model = "models/suspect.glb" if (ROOT/"models/suspect.glb").is_file() else "models/officer.glb"
    spawns = []
    for anchor in level.get('npcs', []):
        raw = np.array(anchor['position'])
        room_index = room_indices.get(anchor.get('room'))
        candidates = [i for i in largest if nodes[i][3] == room_index]
        if not candidates:
            candidates = [i for i, node in enumerate(nodes) if node[3] == room_index]
        projected = min(candidates, key=lambda i: np.sum((xyz[i]-raw)**2)) if candidates else None
        raw_clear = queries.clear(*[raw[0], raw[1], raw[2]])
        spawns.append({'id': anchor.get('id'), 'room': anchor.get('room'), 'raw': raw.tolist(),
                       'rawCapsuleClear': raw_clear, 'projected': ([round(float(xyz[projected][0]), 5), nodes[projected][2], round(float(xyz[projected][2]), 5)] if projected is not None else None),
                       'projectionDistance': round(float(np.linalg.norm(xyz[projected]-raw)), 5) if projected is not None else None,
                       'component': nodes[projected][5] if projected is not None else None})
    data = {
        "version": 1, "coords": "Three.js Y-up, meters", "algorithm": "capsule-clearance-grid+A*",
        "assets": {"npcModel": model, "npcFallback": "models/officer.glb"},
        "agent": {"radius": args.radius, "height": args.height, "maxStep": args.step, "skin": args.skin},
        "grid": {"cellSize": cell, "origin": [round(v, 5) for v in origin], "width": width, "depth": depth,
                 "directions": DIRECTIONS, "nodeFormat": ["ix", "iz", "floorY", "roomIndex", "edgeMask", "component"], "diagonals": "both cardinal corridors required", "mainComponent": main_component},
        "rooms": room_data, "doors": doors, "nodes": nodes, "spawns": spawns,
        "bake": {"tool": "sources/bodycam-demo/tools/nav/bake.py", "collision": args.collision, "level": args.level,
                 "collisionSHA256": sha(collision_path), "levelSHA256": sha(level_path),
                 "boundsXZ": [round(q, 5) for q in bounds], "padding": args.padding,
                 "staticTriangles": len(triangles), "staticMeshes": meshes, "excludedDynamicDoorMeshes": door_meshes,
                 "floorFootprintProbes": 9, "floorSupport": "highest footprint support for steps; continuous ramps use radius*(1/normalY-1); support spread <= maxStep except on walkable ramps",
                 "edgeProbeSpacing": .035, "everyEdgeMidpointChecked": True,
                 "edgeMethod": "midpoint on every edge; geometric distance bound on flat clear corridors; <=3.5cm probes near obstacles/steps",
                 "components": sorted([len(group) for group in components], reverse=True),
                 "edges": sum(len(q) for q in adjacency)//2, "reachableRooms": [q["id"] for q in room_data if q["reachable"]]},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"))+"\n")
    print(json.dumps({"output": str(output), "cells": len(nodes), "edges": data["bake"]["edges"], "rooms": data["bake"]["reachableRooms"], "components": data["bake"]["components"], "seconds": round(time.monotonic()-started, 2), "bytes": output.stat().st_size}), flush=True)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--level", default="data/level.json")
    parser.add_argument("--collision", default="models/house_collision.glb")
    parser.add_argument("--output", help="Default: public/bodycam-demo/data/nav.json")
    parser.add_argument("--cell", type=float, default=.10)
    parser.add_argument("--radius", type=float, default=.24)
    parser.add_argument("--height", type=float, default=1.75)
    parser.add_argument("--step", type=float, default=.23)
    parser.add_argument("--skin", type=float, default=.003)
    parser.add_argument("--padding", type=float, default=1.2)
    parser.add_argument("--bounds", type=float, nargs=4, metavar=("X0", "Z0", "X1", "Z1"))
    args = parser.parse_args()
    if not (0 < args.cell <= .25 and 0 < args.radius < args.height/2 and 0 < args.step < .5 and args.skin >= 0):
        parser.error("Invalid capsule/grid dimensions")
    bake(args)


if __name__ == "__main__":
    main()
