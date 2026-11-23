"""Build the photorealistic Blender architectural house scene and render walkthrough views.

Usage:
  blender -b -P tools/blender_house.py -- \
    --model public/Hausentwurf-214.glb \
    --house-json /path/to/house-export.json \
    --out public/blender

Optional arguments:
  --house-json       Unified export JSON ({spec, services, terrainAtDoors, plinthDepth, terrain, access}).
  --spec             Legacy standalone house spec JSON (fallback if --house-json omitted).
  --utilities        Legacy standalone utility JSON (fallback if --house-json omitted).
  --terrain          Legacy standalone terrain grid JSON (fallback if --house-json omitted).
  --preview          Faster Cycles sampling and lower output resolutions.
  --render-utilities Optional directory to render diagnostic shots with Trinkwasser & Strom visible.
"""

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

PLAN_LENGTH = 11.0
PLAN_WIDTH = 7.15

UTILITY_COLLECTIONS = {
    "water": "Trinkwasser",
    "power": "Strom",
}

UTILITY_COLOR_TAGS = {
    "water": "COLOR_05",
    "power": "COLOR_02",
}

UTILITY_RADII = {
    "water": {"supply": 0.022, "riser": 0.020, "junction": 0.015, "outlet": 0.012, "default": 0.014},
    "power": {"supply": 0.019, "riser": 0.018, "junction": 0.013, "outlet": 0.010, "default": 0.012},
}

STAIR_STUDY_COLLECTIONS = {
    "eg": "Treppenstudie · EG",
    "og": "Treppenstudie · OG",
}

LEGACY_EG_FURNITURE_GROUPS = frozenset(
    {"Tisch", "Sideboard", "Arbeiten", "eg_table", "eg_sideb", "eg_bench"}
)

RAW_GLB_SERVICE_GROUPS = frozenset({"water", "power", "services", "trinkwasser", "strom"})


def plan_to_blender(u, v, z, length=PLAN_LENGTH, width=PLAN_WIDTH):
    return (float(u) - length / 2.0, width / 2.0 - float(v), float(z))


def blender_to_plan(x, y, z, length=PLAN_LENGTH, width=PLAN_WIDTH):
    return (float(x) + length / 2.0, width / 2.0 - float(y), float(z))


def build_arg_parser():
    parser = argparse.ArgumentParser(
        description="Build the native Blender house scene and render walkthrough views."
    )
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--house-json", type=Path, default=None)
    parser.add_argument("--terrain", type=Path, default=None)
    parser.add_argument("--utilities", type=Path, default=None)
    parser.add_argument("--spec", type=Path, default=None)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--save-blend", action="store_true")
    parser.add_argument("--render-utilities", type=Path, default=None)
    return parser


def parse_cli_args(argv=None):
    raw = sys.argv if argv is None else list(argv)
    if "--" in raw:
        raw = raw[raw.index("--") + 1 :]
    elif argv is None:
        raw = raw[1:]
    return build_arg_parser().parse_args(raw)


def _clean_polyline(points):
    cleaned = []
    for item in points or ():
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        xyz = (float(item[0]), float(item[1]), float(item[2]))
        if not cleaned or any(abs(a - b) > 1e-5 for a, b in zip(xyz, cleaned[-1])):
            cleaned.append(xyz)
    return cleaned


def load_utilities_data(source, length=PLAN_LENGTH, width=PLAN_WIDTH):
    """Parse and normalize services/utilities JSON into water and power groups."""
    if source is None:
        return None
    payload = (
        json.loads(Path(source).read_text(encoding="utf-8"))
        if isinstance(source, (str, Path))
        else source
    )
    if not isinstance(payload, dict):
        raise ValueError("Utilities/services JSON must be an object with a 'routes' list.")

    grouped = {
        "water": {"collection": UTILITY_COLLECTIONS["water"], "routes": [], "stations": []},
        "power": {"collection": UTILITY_COLLECTIONS["power"], "routes": [], "stations": []},
    }

    for idx, route in enumerate(payload.get("routes") or ()):
        if not isinstance(route, dict):
            continue
        system = str(route.get("system") or "").strip().lower()
        if system not in grouped:
            continue
        pts = _clean_polyline(route.get("points"))
        if len(pts) < 2:
            continue
        level = str(route.get("level") or "eg").strip().lower()
        if level not in ("site", "eg", "og"):
            level = "eg"
        route_id = str(route.get("id") or f"{system}-{idx + 1}")
        label = str(route.get("label") or route_id)
        mark = str(route.get("mark") or "").strip().lower()
        radii = UTILITY_RADII[system]
        radius = radii.get(mark, radii["default"])
        grouped[system]["routes"].append(
            {
                "id": route_id,
                "system": system,
                "level": level,
                "label": label,
                "mark": mark,
                "radius": radius,
                "points_plan": pts,
                "points_blender": [plan_to_blender(*p, length=length, width=width) for p in pts],
            }
        )

    for idx, station in enumerate(payload.get("stations") or ()):
        if not isinstance(station, dict):
            continue
        system = str(station.get("system") or "").strip().lower()
        point = station.get("point")
        if system not in grouped or not isinstance(point, (list, tuple)) or len(point) < 3:
            continue
        xyz = (float(point[0]), float(point[1]), float(point[2]))
        lvl = str(station.get("level") or "eg").strip().lower()
        if lvl not in ("site", "eg", "og"):
            lvl = "eg"
        grouped[system]["stations"].append(
            {
                "id": str(station.get("id") or f"{system}-station-{idx + 1}"),
                "system": system,
                "level": lvl,
                "label": str(station.get("label") or station.get("id") or "Station"),
                "point_plan": xyz,
                "point_blender": plan_to_blender(*xyz, length=length, width=width),
            }
        )

    return grouped


def extract_plan_stairs(spec):
    """Extract per-level data-driven planStairs if present in spec."""
    result = {"eg": [], "og": [], "legacy_fallback": False}
    if not isinstance(spec, dict):
        return result
    levels = spec.get("levels") or {}
    for lvl in ("eg", "og"):
        level_data = levels.get(lvl) or {}
        if "planStairs" in level_data and isinstance(level_data["planStairs"], list):
            for idx, stair in enumerate(level_data["planStairs"]):
                if not isinstance(stair, dict):
                    continue
                normalized = dict(stair)
                normalized.setdefault("id", f"{lvl}_stair_{idx + 1}")
                normalized.setdefault("level", lvl)
                normalized.setdefault("label", f"Treppe {lvl.upper()} {idx + 1}")
                normalized.setdefault("study", True)
                normalized.setdefault("status", "study")
                result[lvl].append(normalized)
    return result


def point_to_box_distance_3d(point, box):
    """Compute exact Euclidean distance from 3D point (u, v, z) to AABB (u0, v0, z0, u1, v1, z1)."""
    u, v, z = point
    u0, v0, z0, u1, v1, z1 = box
    du = max(u0 - u, 0.0, u - u1)
    dv = max(v0 - v, 0.0, v - v1)
    dz = max(z0 - z, 0.0, z - z1)
    return math.sqrt(du * du + dv * dv + dz * dz)


def check_camera_clearances(cameras, obstacles, min_clearance=0.30):
    """Check that no interior camera collides with walls, furniture, or stairs."""
    report = []
    all_ok = True
    for cam in cameras:
        if not cam.get("interior", True):
            continue
        loc = cam["plan_loc"]
        nearest_dist = float("inf")
        nearest_label = None
        violations = []
        for obs in obstacles:
            dist = point_to_box_distance_3d(loc, obs["box"])
            if dist < nearest_dist:
                nearest_dist = dist
                nearest_label = obs["label"]
            if dist < min_clearance:
                violations.append({"obstacle": obs["label"], "distance_m": round(dist, 4)})
        if violations:
            all_ok = False
        report.append(
            {
                "key": cam["key"],
                "label": cam["label"],
                "plan_loc": tuple(round(c, 3) for c in loc),
                "nearest_obstacle": nearest_label,
                "min_distance_m": round(nearest_dist, 4) if math.isfinite(nearest_dist) else None,
                "ok": not violations,
                "violations": violations,
            }
        )
    return all_ok, report


def _find_safe_camera_pos(preferred, obstacles, bounds, min_clearance=0.38):
    """Return preferred position if clear of obstacles, else search nearby open floor points."""
    u_min, u_max, v_min, v_max = bounds
    pu, pv, pz = preferred

    def clearance(pt_uvz):
        best = float("inf")
        for obs in obstacles:
            d = point_to_box_distance_3d(pt_uvz, obs["box"])
            if d < best:
                best = d
        return best

    if u_min <= pu <= u_max and v_min <= pv <= v_max and clearance(preferred) >= min_clearance:
        return preferred

    best_pt = preferred
    best_score = -1e9
    for r in (0.15, 0.30, 0.48, 0.70, 0.95, 1.25):
        for k in range(16):
            ang = k * math.tau / 16.0
            cu = max(u_min, min(u_max, pu + r * math.cos(ang)))
            cv = max(v_min, min(v_max, pv + r * math.sin(ang)))
            cand = (round(cu, 3), round(cv, 3), pz)
            c = clearance(cand)
            if c >= min_clearance:
                return cand
            score = c - 0.15 * math.hypot(cu - pu, cv - pv)
            if score > best_score:
                best_score = score
                best_pt = cand
    return best_pt


def _classify_stair_level(obj, stair_spec_ids=None):
    """Determine whether an imported stair mesh belongs to EG study, OG study, or shared treppe."""
    stair_spec_ids = stair_spec_ids or {}
    names = []
    cur = obj
    while cur is not None:
        names.append(getattr(cur, "name", ""))
        getter = getattr(cur, "get", None)
        if callable(getter):
            lvl = getter("stair_level") or getter("level")
            if lvl in ("eg", "og"):
                return lvl
            sid = getter("stair_id") or getter("stairId")
            if sid and sid in stair_spec_ids:
                return stair_spec_ids[sid]
        cur = getattr(cur, "parent", None)

    joined = " ".join(names).lower()
    if any(tok in joined for tok in ("eg_stair", "eg_treppe", "treppe_eg", "südtreppe", "suedtreppe", "gerade treppe")):
        return "eg"
    if any(tok in joined for tok in ("og_stair", "og_treppe", "treppe_og", "wendel")):
        return "og"
    return None


def _round_polyline(points, bend_radius):
    """Replace sharp polyline corners with clean 3-segment rounded fillet arcs."""
    if len(points) <= 2 or bend_radius <= 1e-4:
        return list(points)
    out = [points[0]]
    for i in range(1, len(points) - 1):
        p0 = points[i - 1]
        p1 = points[i]
        p2 = points[i + 1]
        v1 = (p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2])
        v2 = (p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
        l1 = math.sqrt(sum(c * c for c in v1))
        l2 = math.sqrt(sum(c * c for c in v2))
        if l1 < 1e-4 or l2 < 1e-4:
            out.append(p1)
            continue
        u1 = tuple(c / l1 for c in v1)
        u2 = tuple(c / l2 for c in v2)
        dot = max(-1.0, min(1.0, sum(a * b for a, b in zip(u1, u2))))
        if dot < -0.985 or dot > 0.985:
            out.append(p1)
            continue
        d = min(bend_radius, 0.36 * l1, 0.36 * l2)
        if d < 0.006:
            out.append(p1)
            continue
        a = tuple(p1[k] + u1[k] * d for k in range(3))
        b = tuple(p1[k] + u2[k] * d for k in range(3))
        # Quadratic Bezier samples along corner fillet
        for t in (0.0, 0.33, 0.67, 1.0):
            mt = 1.0 - t
            q = tuple(mt * mt * a[k] + 2 * mt * t * p1[k] + t * t * b[k] for k in range(3))
            if any(abs(q[k] - out[-1][k]) > 1e-5 for k in range(3)):
                out.append(q)
    if any(abs(points[-1][k] - out[-1][k]) > 1e-5 for k in range(3)):
        out.append(points[-1])
    return out


def main(argv=None):
    import bpy
    from mathutils import Matrix, Vector

    args = parse_cli_args(argv)
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    house_json = None
    if args.house_json is not None:
        house_json = json.loads(args.house_json.resolve().read_text(encoding="utf-8"))

    spec_data = None
    if args.spec is not None:
        spec_data = json.loads(args.spec.resolve().read_text(encoding="utf-8"))
    elif isinstance(house_json, dict) and isinstance(house_json.get("spec"), dict):
        spec_data = house_json["spec"]

    fp = (spec_data or {}).get("footprint") or {}
    heights = (spec_data or {}).get("heights") or {}
    L = float(fp.get("length", PLAN_LENGTH))
    W = float(fp.get("width", PLAN_WIDTH))
    T_EXT = float(fp.get("wallExt", 0.365))
    T_INT_L = float(fp.get("wallIntLoad", 0.175))
    T_INT_S = float(fp.get("wallIntPart", 0.115))

    okff_eg = float(heights.get("okffEg", 0.0))
    eg_clear = float(heights.get("egClear", 2.70))
    eg_slab = float(heights.get("egSlab", 0.30))
    okff_og = float(heights.get("okffOg", okff_eg + eg_clear + eg_slab))
    og_clear = float(heights.get("ogClear", 2.65))
    og_slab = float(heights.get("ogSlab", 0.25))
    eave_wall_y = float(heights.get("eaveWallY", okff_og + og_clear + og_slab))
    plinth_depth = float(
        (house_json or {}).get("plinthDepth", heights.get("defaultPlinthDepth", 2.1))
    )

    def pt(u, v, z):
        return plan_to_blender(u, v, z, length=L, width=W)

    def inv_pt(x, y, z):
        return blender_to_plan(x, y, z, length=L, width=W)

    services_source = args.utilities
    if services_source is None and isinstance(house_json, dict):
        services_source = house_json.get("services")
    utilities_data = load_utilities_data(services_source, length=L, width=W)

    terrain_data = None
    if args.terrain is not None:
        terrain_data = json.loads(args.terrain.resolve().read_text(encoding="utf-8"))
    elif isinstance(house_json, dict) and isinstance(house_json.get("terrain"), dict):
        terrain_data = house_json["terrain"]

    plan_stairs_data = extract_plan_stairs(spec_data)

    # ------------------------------------------------------------------
    # Blender Scene & Cycles Metal GPU Setup
    # ------------------------------------------------------------------
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene["plan_length"] = L
    scene["plan_width"] = W
    scene["okff_og"] = okff_og

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

    scene.cycles.samples = 16 if args.preview else 84
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = 0.06 if args.preview else 0.020
    scene.cycles.max_bounces = 10
    scene.cycles.diffuse_bounces = 5
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 8
    scene.cycles.transparent_max_bounces = 12
    scene.cycles.sample_clamp_indirect = 8.0
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 93
    scene.render.resolution_percentage = 100

    # ------------------------------------------------------------------
    # Import GLB & Organize Collections
    # ------------------------------------------------------------------
    bpy.ops.import_scene.gltf(filepath=str(args.model.resolve()))
    root = next(o for o in scene.objects if o.name.startswith("Wohnhaus"))
    structure = {o: o.name for o in root.children}
    collections = {}

    def make_collection(name):
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
        ("treppeEg", STAIR_STUDY_COLLECTIONS["eg"]),
        ("treppeOg", STAIR_STUDY_COLLECTIONS["og"]),
    ]:
        collections[key] = make_collection(name)

    studio = make_collection("Studio und Gelände")
    rig = make_collection("Licht und Kameras")

    def move(obj, coll):
        for parent in list(obj.users_collection):
            parent.objects.unlink(obj)
        coll.objects.link(obj)

    # Index spec furniture so we only strip legacy EG furniture if NOT in spec.
    spec_furn_eg = {}
    spec_furn_og = {}
    spec_eg_names = set()
    if isinstance(spec_data, dict):
        levels_spec = spec_data.get("levels") or {}
        for f in (levels_spec.get("eg") or {}).get("furniture") or ():
            spec_furn_eg[f["id"]] = f
            spec_eg_names.add(f["id"])
            if f.get("label"):
                spec_eg_names.add(f["label"])
        for f in (levels_spec.get("og") or {}).get("furniture") or ():
            spec_furn_og[f["id"]] = f

    stair_spec_ids = {}
    for lvl in ("eg", "og"):
        for st in plan_stairs_data[lvl]:
            stair_spec_ids[st["id"]] = lvl

    def is_legacy_eg_furniture(obj, top_key):
        if top_key != "eg":
            return False
        cur = obj
        while cur is not None and cur != root:
            base = cur.name.split(".")[0]
            if base in LEGACY_EG_FURNITURE_GROUPS:
                if spec_data is not None and base in spec_eg_names:
                    return False
                return True
            cur = cur.parent
        return False

    def is_raw_glb_service(obj, top_key):
        if top_key and top_key.lower() in RAW_GLB_SERVICE_GROUPS:
            return True
        if obj.get("service") in ("water", "power"):
            return True
        return False

    original = []
    to_remove = []
    for obj in list(root.children_recursive):
        ancestor = obj
        while ancestor.parent and ancestor not in structure:
            ancestor = ancestor.parent
        top_key = structure.get(ancestor)
        if is_raw_glb_service(obj, top_key) or is_legacy_eg_furniture(obj, top_key):
            to_remove.append(obj)
            continue
        if top_key in collections:
            target_coll = collections[top_key]
            if top_key == "treppe":
                lvl = _classify_stair_level(obj, stair_spec_ids)
                if lvl == "eg":
                    target_coll = collections["treppeEg"]
                    obj["stair_study"] = True
                    obj["stair_level"] = "eg"
                elif lvl == "og":
                    target_coll = collections["treppeOg"]
                    obj["stair_study"] = True
                    obj["stair_level"] = "og"
            move(obj, target_coll)
        elif top_key:
            collections[top_key] = make_collection(top_key)
            move(obj, collections[top_key])
        original.append(obj)

    for obj in to_remove:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    # Remove any emptied service group containers under root
    for child in list(root.children):
        if child.name.lower() in RAW_GLB_SERVICE_GROUPS and child.name in bpy.data.objects:
            bpy.data.objects.remove(child, do_unlink=True)

    reference = bpy.data.objects.new("Materialmaßstab · Meter", None)
    rig.objects.link(reference)
    reference.hide_viewport = False
    reference.empty_display_size = 0.04

    # ------------------------------------------------------------------
    # Photorealistic Cycles PBR Material Suite
    # ------------------------------------------------------------------
    def rgb(hexcode):
        h = hexcode.lstrip("#")

        def linear(k):
            v = int(h[k : k + 2], 16) / 255.0
            return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

        return tuple(linear(i) for i in (0, 2, 4)) + (1.0,)

    def mix_rgba(tree, blend_type="MIX", fac=0.5):
        node = tree.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"
        node.blend_type = blend_type
        node.clamp_factor = True
        fac_in = next(s for s in node.inputs if s.name == "Factor" and s.type == "VALUE")
        a_in = next(s for s in node.inputs if s.name == "A" and s.type == "RGBA")
        b_in = next(s for s in node.inputs if s.name == "B" and s.type == "RGBA")
        res_out = next(s for s in node.outputs if s.name == "Result" and s.type == "RGBA")
        fac_in.default_value = fac
        return node, fac_in, a_in, b_in, res_out

    def material(name, col, rough=0.6, metal=0.0, coat=0.0, sheen=0.0):
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        if mat.node_tree is None:
            mat.use_nodes = True
        n = mat.node_tree.nodes
        n.clear()
        shader = n.new("ShaderNodeBsdfPrincipled")
        outnode = n.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(shader.outputs[0], outnode.inputs["Surface"])
        shader.inputs["Base Color"].default_value = rgb(col)
        shader.inputs["Roughness"].default_value = rough
        shader.inputs["Metallic"].default_value = metal
        if coat > 0 and "Coat Weight" in shader.inputs:
            shader.inputs["Coat Weight"].default_value = coat
            shader.inputs["Coat Roughness"].default_value = 0.06
        if sheen > 0 and "Sheen Weight" in shader.inputs:
            shader.inputs["Sheen Weight"].default_value = sheen
            shader.inputs["Sheen Roughness"].default_value = 0.52
        mat.diffuse_color = rgb(col)
        return mat, shader

    def add_ao(mat, shader, distance=0.38, strength=0.14):
        """Multiply subtle ambient occlusion into Base Color for architectural contact depth."""
        tree = mat.node_tree
        link = tree.links.new
        ao = tree.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 8
        ao.inputs["Distance"].default_value = distance
        _, fac_in, a_in, b_in, res_out = mix_rgba(tree, "MULTIPLY", strength)
        bc = shader.inputs["Base Color"]
        if bc.is_linked:
            src_sock = bc.links[0].from_socket
            link(src_sock, a_in)
            link(src_sock, ao.inputs["Color"])
        else:
            a_in.default_value = bc.default_value
            ao.inputs["Color"].default_value = bc.default_value
        link(ao.outputs["Color"], b_in)
        link(res_out, bc)

    def grain(
        mat,
        shader,
        colors,
        frequency,
        stretch=(1.0, 1.0, 1.0),
        relief=0.0007,
        bump_strength=0.22,
        detail=4.5,
        distortion=0.25,
        rough_range=None,
    ):
        tree = mat.node_tree
        node = tree.nodes.new
        link = tree.links.new
        tc = node("ShaderNodeTexCoord")
        tc.object = reference
        scale = node("ShaderNodeVectorMath")
        scale.operation = "MULTIPLY"
        scale.inputs[1].default_value = stretch
        link(tc.outputs["Object"], scale.inputs[0])
        noise = node("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = frequency
        noise.inputs["Detail"].default_value = detail
        noise.inputs["Distortion"].default_value = distortion
        link(scale.outputs[0], noise.inputs["Vector"])
        ramp = node("ShaderNodeValToRGB")
        for el, col, pos in zip(ramp.color_ramp.elements, colors, (0.20, 0.80)):
            el.position = pos
            el.color = rgb(col)
        link(noise.outputs["Fac"], ramp.inputs[0])
        link(ramp.outputs["Color"], shader.inputs["Base Color"])
        bump = node("ShaderNodeBump")
        bump.inputs["Strength"].default_value = bump_strength
        bump.inputs["Distance"].default_value = relief
        link(noise.outputs["Fac"], bump.inputs["Height"])
        link(bump.outputs[0], shader.inputs["Normal"])
        if rough_range is not None:
            mr = node("ShaderNodeMapRange")
            mr.inputs["From Min"].default_value = 0.25
            mr.inputs["From Max"].default_value = 0.75
            mr.inputs["To Min"].default_value = rough_range[0]
            mr.inputs["To Max"].default_value = rough_range[1]
            link(noise.outputs["Fac"], mr.inputs["Value"])
            link(mr.outputs["Result"], shader.inputs["Roughness"])
        return tc, ramp, bump

    def textured(
        name,
        a,
        b,
        freq,
        stretch=(1, 1, 1),
        rough=0.65,
        relief=0.0007,
        bump_strength=0.22,
        detail=4.5,
        distortion=0.25,
        rough_range=None,
        ao_strength=0.0,
        sheen=0.0,
        coat=0.0,
    ):
        m, sh = material(name, a, rough=rough, sheen=sheen, coat=coat)
        grain(m, sh, (a, b), freq, stretch, relief, bump_strength, detail, distortion, rough_range)
        if ao_strength > 0:
            add_ao(m, sh, distance=0.42, strength=ao_strength)
        return m

    # Exterior & Interior Architectural Surfaces
    putz = textured(
        "Kalkputz warmweiß",
        "d9ceb5",
        "f3ecda",
        215,
        rough=0.88,
        relief=0.0012,
        bump_strength=0.26,
        detail=6.0,
        rough_range=(0.83, 0.93),
        ao_strength=0.16,
    )
    plaster = textured(
        "Innenputz",
        "e4dbc9",
        "f4f0e4",
        220,
        rough=0.90,
        relief=0.0006,
        bump_strength=0.18,
        detail=5.0,
        ao_strength=0.12,
    )
    ceiling, ceil_sh = material("Mineralweiß · Decken", "eee9de", 0.94)
    add_ao(ceiling, ceil_sh, distance=0.35, strength=0.10)

    stone = textured(
        "Werkstein",
        "bcb09d",
        "dfd5c2",
        92,
        rough=0.44,
        relief=0.0011,
        bump_strength=0.20,
        rough_range=(0.38, 0.54),
        ao_strength=0.10,
    )
    counter_stone = textured(
        "Küchenarbeitsplatte",
        "cfc6b5",
        "e5dfd2",
        42,
        stretch=(1.6, 0.7, 1.0),
        rough=0.30,
        relief=0.0004,
        bump_strength=0.10,
        detail=6.0,
        distortion=0.65,
        rough_range=(0.24, 0.36),
        coat=0.15,
    )
    textured(
        "Sockel mineralisch",
        "7a7467",
        "a7a092",
        88,
        rough=0.91,
        relief=0.0026,
        bump_strength=0.34,
        detail=6.5,
        ao_strength=0.18,
    )

    # Timber & Wide-Plank Oiled Oak Flooring
    oak = textured(
        "Eiche",
        "996843",
        "c79b6b",
        3.4,
        (0.65, 22, 13),
        rough=0.38,
        relief=0.0005,
        bump_strength=0.16,
        detail=5.5,
        distortion=0.32,
        rough_range=(0.33, 0.45),
    )
    textured(
        "Haustür Eiche",
        "7d5539",
        "a47a54",
        3.8,
        (13, 15, 0.45),
        rough=0.44,
        relief=0.0008,
        bump_strength=0.20,
        detail=5.5,
        rough_range=(0.38, 0.52),
    )

    floor, sh = material("Dielen", "b68b61", 0.40)
    tc_fl, ramp_fl, wood_bump = grain(
        floor,
        sh,
        ("946b4b", "d2ad81"),
        3.5,
        (0.50, 24.0, 16.0),
        relief=0.0004,
        bump_strength=0.12,
        detail=6.0,
        distortion=0.35,
        rough_range=(0.34, 0.47),
    )
    nt = floor.node_tree
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.42
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Brick Width"].default_value = 1.84
    brick.inputs["Row Height"].default_value = 0.165
    brick.inputs["Mortar Size"].default_value = 0.0018
    brick.inputs["Mortar Smooth"].default_value = 0.48
    brick.inputs["Mortar"].default_value = rgb("644935")
    nt.links.new(tc_fl.outputs["Object"], brick.inputs["Vector"])
    nt.links.new(ramp_fl.outputs["Color"], brick.inputs["Color1"])
    _, _, shade_a, shade_b, shade_out = mix_rgba(nt, "MULTIPLY", 0.34)
    shade_b.default_value = (0.76, 0.68, 0.60, 1.0)
    nt.links.new(ramp_fl.outputs["Color"], shade_a)
    nt.links.new(shade_out, brick.inputs["Color2"])
    nt.links.new(brick.outputs["Color"], sh.inputs["Base Color"])
    # Subtle plank bevel groove into normal chain
    plank_bump = nt.nodes.new("ShaderNodeBump")
    plank_bump.inputs["Strength"].default_value = 0.24
    plank_bump.inputs["Distance"].default_value = 0.0014
    nt.links.new(brick.outputs["Fac"], plank_bump.inputs["Height"])
    nt.links.new(wood_bump.outputs["Normal"], plank_bump.inputs["Normal"])
    nt.links.new(plank_bump.outputs["Normal"], sh.inputs["Normal"])

    # Ceramic Wet-Room Tile Floor (Bad / WC / HWR)
    tile_mat, tile_sh = material("Bodenfliese", "b2afa5", 0.44)
    t_nt = tile_mat.node_tree
    t_tc = t_nt.nodes.new("ShaderNodeTexCoord")
    t_tc.object = reference
    t_brick = t_nt.nodes.new("ShaderNodeTexBrick")
    t_brick.offset = 0.5
    t_brick.inputs["Scale"].default_value = 1.0
    t_brick.inputs["Brick Width"].default_value = 0.60
    t_brick.inputs["Row Height"].default_value = 0.30
    t_brick.inputs["Mortar Size"].default_value = 0.003
    t_brick.inputs["Mortar Smooth"].default_value = 0.35
    t_brick.inputs["Color1"].default_value = rgb("b8b5ab")
    t_brick.inputs["Color2"].default_value = rgb("a7a49a")
    t_brick.inputs["Mortar"].default_value = rgb("807d75")
    t_nt.links.new(t_tc.outputs["Object"], t_brick.inputs["Vector"])
    t_nt.links.new(t_brick.outputs["Color"], tile_sh.inputs["Base Color"])
    t_bump = t_nt.nodes.new("ShaderNodeBump")
    t_bump.inputs["Strength"].default_value = 0.25
    t_bump.inputs["Distance"].default_value = 0.0015
    t_nt.links.new(t_brick.outputs["Fac"], t_bump.inputs["Height"])
    t_nt.links.new(t_bump.outputs["Normal"], tile_sh.inputs["Normal"])

    # Fired Clay Roof Tiles (Natural Pfalz Terracotta with Per-Tile Variation)
    roof_mat, roof_sh = material("Unglasierter Tonziegel", "a35237", rough=0.74)
    _, roof_ramp, _ = grain(
        roof_mat,
        roof_sh,
        ("8f452d", "b86344"),
        76,
        relief=0.0018,
        bump_strength=0.28,
        detail=5.5,
        rough_range=(0.66, 0.82),
    )
    r_nt = roof_mat.node_tree
    obj_info = r_nt.nodes.new("ShaderNodeObjectInfo")
    tile_var_ramp = r_nt.nodes.new("ShaderNodeValToRGB")
    tile_var_ramp.color_ramp.elements[0].position = 0.0
    tile_var_ramp.color_ramp.elements[0].color = rgb("c89d8a")
    tile_var_ramp.color_ramp.elements[1].position = 1.0
    tile_var_ramp.color_ramp.elements[1].color = rgb("fff0e8")
    r_nt.links.new(obj_info.outputs["Random"], tile_var_ramp.inputs["Fac"])
    _, _, rv_a, rv_b, rv_out = mix_rgba(r_nt, "MULTIPLY", 0.55)
    r_nt.links.new(roof_ramp.outputs["Color"], rv_a)
    r_nt.links.new(tile_var_ramp.outputs["Color"], rv_b)
    r_nt.links.new(rv_out, roof_sh.inputs["Base Color"])
    add_ao(roof_mat, roof_sh, distance=0.25, strength=0.22)

    textured("Firstziegel", "86422c", "ae5a3c", 88, rough=0.72, relief=0.0015, ao_strength=0.16)

    # Fabrics, Rug, Kitchen & Sanitary Finishes
    fabric = textured(
        "Polsterstoff salbei",
        "738577",
        "a1ae9a",
        240,
        rough=0.92,
        relief=0.0015,
        bump_strength=0.28,
        detail=6.0,
        sheen=0.68,
        ao_strength=0.14,
    )
    clay = textured("Steinzeug zimt", "ad6850", "be7c60", 145, rough=0.52, relief=0.0008, coat=0.12)
    linen = textured(
        "Leinen natur",
        "c7b8a0",
        "e5d9c0",
        190,
        rough=0.90,
        relief=0.0012,
        bump_strength=0.22,
        sheen=0.50,
    )
    # Translucent curtain/lampshade linen so daylight & bulbs softly glow through
    curtain_linen, cl_sh = material("Leinen · durchscheinend", "ddd0b8", rough=0.88, sheen=0.45)
    grain(curtain_linen, cl_sh, ("c9ba9f", "e8dcc6"), 195, relief=0.0010, bump_strength=0.18)
    cl_nt = curtain_linen.node_tree
    cl_trans = cl_nt.nodes.new("ShaderNodeBsdfTranslucent")
    cl_trans.inputs["Color"].default_value = rgb("f2e7d3")
    cl_mix = cl_nt.nodes.new("ShaderNodeMixShader")
    cl_mix.inputs["Fac"].default_value = 0.24
    cl_nt.links.new(cl_sh.outputs[0], cl_mix.inputs[1])
    cl_nt.links.new(cl_trans.outputs[0], cl_mix.inputs[2])
    cl_nt.links.new(
        cl_mix.outputs[0],
        next(n for n in cl_nt.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"],
    )

    rugmat = textured(
        "Schurwolle sand",
        "ae9c81",
        "d6c7ae",
        150,
        (1.4, 1.0, 1.0),
        rough=0.97,
        relief=0.0026,
        bump_strength=0.35,
        detail=6.5,
        sheen=0.55,
        ao_strength=0.12,
    )
    panel = textured(
        "Küchenfront",
        "b3ac95",
        "beb8a2",
        130,
        rough=0.39,
        relief=0.0003,
        bump_strength=0.06,
        coat=0.08,
        ao_strength=0.10,
    )
    dark = material("Kochfeld", "161a1a", rough=0.06, metal=0.05, coat=0.72)[0]
    steel = material("Rinne und Geländer", "69706d", rough=0.32, metal=0.80)[0]
    chrome = material("Chrom · Armatur", "d2d7da", rough=0.13, metal=0.96)[0]
    black = material("Messing brüniert", "4d3f31", rough=0.30, metal=0.78)[0]
    ivory = material("Porzellan elfenbein", "e6dfd0", rough=0.22, coat=0.25)[0]
    material("Fensterrahmen", "40423a", rough=0.38, metal=0.24)
    ceramic = material("Keramik", "f0ede5", rough=0.10, coat=0.45)[0]
    mirror_mat = material("Spiegel", "e6eceb", rough=0.02, metal=0.98)[0]
    appliance_white = material("Gerät · Weiß", "eae8e1", rough=0.26, coat=0.20)[0]

    def make_arch_glass(name, tint="eef6f4", rough=0.022):
        gmat, gh = material(name, tint, rough=rough)
        gh.inputs["Transmission Weight"].default_value = 0.96
        gh.inputs["IOR"].default_value = 1.52
        gt = gmat.node_tree
        trans = gt.nodes.new("ShaderNodeBsdfTransparent")
        paths = gt.nodes.new("ShaderNodeLightPath")
        mix = gt.nodes.new("ShaderNodeMixShader")
        gt.links.new(paths.outputs["Is Shadow Ray"], mix.inputs[0])
        gt.links.new(gh.outputs[0], mix.inputs[1])
        gt.links.new(trans.outputs[0], mix.inputs[2])
        gt.links.new(
            mix.outputs[0],
            next(n for n in gt.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"],
        )
        return gmat

    make_arch_glass("Fensterglas", "edf6f4", 0.022)
    shower_glass = make_arch_glass("Duschglas", "e8f3f2", 0.03)
    meter_glass = make_arch_glass("Zählerglas", "e6f0f5", 0.04)

    artm = [
        material("Pigment " + n, c, 0.94)[0]
        for n, c in [
            ("Kreide", "e6d9bf"),
            ("Ocker", "ba7d4f"),
            ("Ton", "9c5a40"),
            ("Schiefer", "4f5d58"),
            ("Sand", "cbb591"),
        ]
    ]

    # Utility Installation Materials (clean PBR in both Cycles and WebGL GLB)
    mat_water_pipe = material("Leitung · Trinkwasser", "0c7ab5", rough=0.28, metal=0.30)[0]
    mat_water_muff = material("Isolierung · Trinkwasser", "07507a", rough=0.38, metal=0.20)[0]
    mat_brass = material("Messing · Ventil", "c69c43", rough=0.26, metal=0.88)[0]
    mat_valve_red = material("Absperrventil · Rot", "c42d26", rough=0.34, metal=0.10)[0]
    mat_clamp = material("Wandschelle · Stahl", "484f54", rough=0.36, metal=0.72)[0]
    mat_power_pipe = material("Leitung · Strom", "dc6818", rough=0.30, metal=0.25)[0]
    mat_power_box = material("Kabeldose · Strom", "4a5258", rough=0.44, metal=0.12)[0]
    mat_power_face = material("Abdeckung · Strom", "e7eaec", rough=0.35, metal=0.05)[0]
    mat_cabinet = material("Verteiler · Schrank", "cfd4d7", rough=0.35, metal=0.35)[0]
    mat_cabinet_inner = material("Verteiler · Innen", "2a3034", rough=0.52, metal=0.25)[0]
    mat_breaker = material("Sicherung · Automat", "eceff1", rough=0.32, metal=0.05)[0]
    mat_breaker_blue = material("Sicherung · Blau", "1b74b8", rough=0.32, metal=0.05)[0]

    # ------------------------------------------------------------------
    # Geometry Builders
    # ------------------------------------------------------------------
    def link_mesh(name, vertices, faces, mat, coll):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        coll.objects.link(obj)
        mesh.materials.append(mat)
        return obj

    def soften(obj, w, segments=3):
        if w <= 0:
            return
        mod = obj.modifiers.new("Gerundete Kanten", "BEVEL")
        mod.width = w
        mod.segments = segments
        mod = obj.modifiers.new("Flächennormalen", "WEIGHTED_NORMAL")
        mod.keep_sharp = True

    def block(coll, name, center, size, mat, bev=0, angle=0, bev_segs=3):
        x, y, z = [max(v, 0.0005) / 2.0 for v in size]
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
        faces = [
            (0, 3, 2, 1),
            (4, 5, 6, 7),
            (0, 1, 5, 4),
            (1, 2, 6, 5),
            (2, 3, 7, 6),
            (3, 0, 4, 7),
        ]
        obj = link_mesh(name, coords, faces, mat, coll)
        obj.location = pt(*center)
        obj.rotation_euler.z = angle
        soften(obj, bev, bev_segs)
        return obj

    def cylinder_between(coll, name, p0_plan, p1_plan, radius, mat, segments=10):
        a = Vector(pt(*p0_plan))
        b = Vector(pt(*p1_plan))
        axis = b - a
        length = axis.length
        if length < 1e-5:
            return None
        z_dir = axis.normalized()
        up = Vector((0.0, 0.0, 1.0)) if abs(z_dir.z) < 0.95 else Vector((1.0, 0.0, 0.0))
        x_dir = up.cross(z_dir).normalized()
        y_dir = z_dir.cross(x_dir).normalized()
        verts = []
        faces = []
        for end_pt in (a, b):
            for i in range(segments):
                ang = i * math.tau / segments
                v = end_pt + radius * (math.cos(ang) * x_dir + math.sin(ang) * y_dir)
                verts.append(tuple(v))
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((i, j, segments + j, segments + i))
        faces.append(tuple(range(segments - 1, -1, -1)))
        faces.append(tuple(range(segments, 2 * segments)))
        obj = link_mesh(name, verts, faces, mat, coll)
        for f in obj.data.polygons:
            f.use_smooth = True
        return obj

    def pipe_mesh(coll, name, points_plan, radius, mat, segments=10, bend_radius=None):
        """Build a clean smooth tubular mesh with rounded elbows and closed end caps."""
        if bend_radius is None:
            bend_radius = radius * 2.4
        pts = _round_polyline(points_plan, bend_radius)
        b_pts = [Vector(pt(*p)) for p in pts]
        if len(b_pts) < 2:
            return None

        # Compute parallel-transport frames along polyline to prevent twist artifacts.
        tangents = []
        for i in range(len(b_pts)):
            if i == 0:
                t = (b_pts[1] - b_pts[0]).normalized()
            elif i == len(b_pts) - 1:
                t = (b_pts[-1] - b_pts[-2]).normalized()
            else:
                t1 = (b_pts[i] - b_pts[i - 1]).normalized()
                t2 = (b_pts[i + 1] - b_pts[i]).normalized()
                t = t1 + t2
                t = t.normalized() if t.length > 1e-5 else t1
            tangents.append(t)

        ref_up = Vector((0.0, 0.0, 1.0)) if abs(tangents[0].z) < 0.92 else Vector((1.0, 0.0, 0.0))
        x_dir = ref_up.cross(tangents[0]).normalized()
        y_dir = tangents[0].cross(x_dir).normalized()

        verts = []
        faces = []
        for idx, (center, t_vec) in enumerate(zip(b_pts, tangents)):
            if idx > 0:
                prev_t = tangents[idx - 1]
                rot = prev_t.rotation_difference(t_vec)
                x_dir = (rot @ x_dir).normalized()
                # Re-orthogonalize
                x_dir = (x_dir - t_vec * x_dir.dot(t_vec)).normalized()
                y_dir = t_vec.cross(x_dir).normalized()
            for s in range(segments):
                ang = s * math.tau / segments
                v = center + radius * (math.cos(ang) * x_dir + math.sin(ang) * y_dir)
                verts.append(tuple(v))

        n_rings = len(b_pts)
        for r in range(n_rings - 1):
            base0 = r * segments
            base1 = (r + 1) * segments
            for s in range(segments):
                sn = (s + 1) % segments
                faces.append((base0 + s, base0 + sn, base1 + sn, base1 + s))
        faces.append(tuple(range(segments - 1, -1, -1)))
        last_base = (n_rings - 1) * segments
        faces.append(tuple(range(last_base, last_base + segments)))

        obj = link_mesh(name, verts, faces, mat, coll)
        for f in obj.data.polygons:
            f.use_smooth = True
        return obj

    def prism_poly(coll, name, poly_uv, z0, z1, mat, bev=0.004):
        pts2d = [(float(p[0]), float(p[1])) for p in poly_uv]
        if len(pts2d) < 3 or z1 <= z0:
            return None
        xy = [pt(u, v, 0.0)[:2] for u, v in pts2d]
        signed_area = sum(
            xy[i][0] * xy[(i + 1) % len(xy)][1] - xy[(i + 1) % len(xy)][0] * xy[i][1]
            for i in range(len(xy))
        )
        if signed_area < 0:
            xy.reverse()
        n = len(xy)
        verts = [(x, y, z0) for x, y in xy] + [(x, y, z1) for x, y in xy]
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
        obj = link_mesh(name, verts, faces, mat, coll)
        soften(obj, bev)
        return obj

    def lathe(coll, name, place, profile, mat, segments=48):
        vertices = []
        faces = []
        for r, z in profile:
            for i in range(segments):
                a = i * math.tau / segments
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

    def line(coll, name, coords, radius, mat, resolution=3, fill_caps=True):
        curve = bpy.data.curves.new(name, "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = radius
        curve.bevel_resolution = resolution
        curve.use_fill_caps = fill_caps
        spline = curve.splines.new("POLY")
        spline.points.add(len(coords) - 1)
        for p, xyz in zip(spline.points, coords):
            p.co = (*pt(*xyz), 1.0)
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

    def world_plan_bbox(objs):
        corners = []
        for o in objs:
            if o.type != "MESH" or o.name not in bpy.data.objects:
                continue
            for v in o.bound_box:
                w = o.matrix_world @ Vector(v)
                corners.append(inv_pt(w.x, w.y, w.z))
        if not corners:
            return None
        return (
            min(c[0] for c in corners),
            min(c[1] for c in corners),
            max(c[0] for c in corners),
            max(c[1] for c in corners),
            min(c[2] for c in corners),
            max(c[2] for c in corners),
        )

    def find_group_meshes(coll, group_names):
        targets = set(group_names)
        meshes = []
        for o in list(coll.objects):
            if o.type != "MESH":
                continue
            cur = o
            while cur is not None and cur != root:
                if cur.name.split(".")[0] in targets or cur.name in targets:
                    meshes.append(o)
                    break
                cur = cur.parent
        return meshes

    def group_plan_bbox(coll, group_names):
        return world_plan_bbox(find_group_meshes(coll, group_names))

    def remove_objects(objs):
        for o in list(objs):
            if o.name in bpy.data.objects:
                if o in original:
                    original.remove(o)
                bpy.data.objects.remove(o, do_unlink=True)

    # ------------------------------------------------------------------
    # Refine Imported Architectural Surfaces, Slabs, Stairs & Roof Tiles
    # ------------------------------------------------------------------
    for obj in list(original):
        if obj.type != "MESH":
            continue
        mat = obj.active_material
        if not mat:
            continue
        base_name = obj.name.split(".")[0]

        # Clean slab underside (ceiling) vs exterior fascia (putz) vs interior cutout edges (plaster).
        if obj.name.startswith(("Fußboden Erdgeschoss", "Geschossdecke", "Decke über OG")):
            obj.data = obj.data.copy()
            obj.data.materials.append(ceiling)
            ceil_idx = len(obj.data.materials) - 1
            obj.data.materials.append(putz)
            putz_idx = len(obj.data.materials) - 1
            obj.data.materials.append(plaster)
            plaster_idx = len(obj.data.materials) - 1
            normal = obj.matrix_world.to_3x3().inverted().transposed()
            for face in obj.data.polygons:
                nz = (normal @ face.normal).normalized().z
                if nz < -0.8:
                    face.material_index = ceil_idx
                elif abs(nz) < 0.5:
                    wc = obj.matrix_world @ face.center
                    on_ext = abs(wc.x) > L / 2.0 - 0.06 or abs(wc.y) > W / 2.0 - 0.06
                    face.material_index = putz_idx if on_ext else plaster_idx

        # Apply metre-space bevels on architectural table tops, chairs, sills, steps, bed parts.
        if base_name in (
            "Platte",
            "Bein",
            "Stuhlsitz",
            "Rückenlehne",
            "Stuhlbein",
            "Arbeitsfläche",
            "Matratze",
            "Kissen",
            "Decke",
            "Fenstergesims",
            "Hofpodest oben",
            "Gartenstufe",
            "Türschwelle Straße",
            "Eingangspodest unten",
        ) or obj.name.startswith(("Treppenstufe ", "Innere Eingangsstufe ", "Hofstufe ")):
            obj.data = obj.data.copy()
            sz = obj.scale.copy()
            obj.data.transform(Matrix.Diagonal((*sz, 1.0)))
            obj.scale = (1.0, 1.0, 1.0)
            w_bev = 0.028 if base_name in ("Kissen", "Matratze") else (0.010 if base_name in ("Stuhlsitz", "Rückenlehne") else 0.006)
            soften(obj, w_bev, 2)
            if base_name == "Stuhlsitz":
                obj.data.materials.clear()
                obj.data.materials.append(linen)

        # Clean bevels on kitchen cabinet doors/bodies & storage cabinets.
        if base_name in ("G", "Schrank", "Garderobe", "Stauraum", "Regal", "Technik"):
            obj.data = obj.data.copy()
            sz = obj.scale.copy()
            obj.data.transform(Matrix.Diagonal((*sz, 1.0)))
            obj.scale = (1.0, 1.0, 1.0)
            soften(obj, 0.005, 2)

    # Profiled pressed-clay roof tiles on each slope (preserving measured tile centers & pitches).
    tile_rows = {}
    for obj in list(original):
        if obj.type != "MESH" or not obj.parent or not obj.parent.name.startswith("Unglasierte Tonziegel"):
            continue
        key = obj.data.name
        if key not in tile_rows:
            bounds = [Vector(p) for p in obj.bound_box]
            left, right = min(v.x for v in bounds), max(v.x for v in bounds)
            back, front = min(v.y for v in bounds), max(v.y for v in bounds)
            coords = [v.co for v in obj.data.vertices]
            high0 = max(v.z for v in coords if abs(v.y - back) < 0.0002)
            high1 = max(v.z for v in coords if abs(v.y - front) < 0.0002)
            points = []
            faces = []
            segments = 12
            for j in range(2):
                for i in range(segments + 1):
                    t = i / segments
                    raised = 0.018 * (0.5 + 0.5 * math.cos(math.tau * (t - 0.10))) ** 3
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

    # ------------------------------------------------------------------
    # Wet-Room Ceramic Floor Tiles (HWR, EG WC, OG Bad, OG WC)
    # ------------------------------------------------------------------
    if isinstance(spec_data, dict):
        levels_spec = spec_data.get("levels") or {}
        for lvl_key, coll_lvl, z_lvl in (("eg", eg, okff_eg), ("og", og, okff_og)):
            for rm in (levels_spec.get(lvl_key) or {}).get("rooms") or ():
                rid = rm.get("id", "")
                if rid in ("eg_hwr", "eg_wc", "og_bad", "og_wc"):
                    for ri, rect in enumerate(rm.get("rects") or ()):
                        u0, v0, u1, v1 = [float(x) for x in rect]
                        block(
                            coll_lvl,
                            f"Bodenfliese · {rm.get('name', rid)} {ri + 1}",
                            ((u0 + u1) / 2.0, (v0 + v1) / 2.0, z_lvl + 0.002),
                            (u1 - u0, v1 - v0, 0.004),
                            tile_mat,
                        )

    # ------------------------------------------------------------------
    # Data-Driven planStairs Study Builder (only if present in spec & missing in GLB)
    # ------------------------------------------------------------------
    def build_plan_stair_study(lvl, stair_entry):
        coll = collections["treppeEg"] if lvl == "eg" else collections["treppeOg"]
        sid = stair_entry.get("id", f"{lvl}_stair")
        label = stair_entry.get("label", sid)
        z_floor = okff_eg if lvl == "eg" else okff_og
        existing = [
            o for o in coll.objects if o.get("stair_id") == sid or sid.lower() in o.name.lower()
        ]
        if existing:
            return
        for idx, step in enumerate(stair_entry.get("steps") or ()):
            poly = step.get("poly")
            if not poly or len(poly) < 3:
                continue
            y_top = float(step.get("yTop", z_floor + (idx + 1) * 0.175))
            y_bot = max(z_floor, float(step.get("yBottom", y_top - 0.12)))
            prism_poly(
                coll,
                f"Treppenstudie {lvl.upper()} · {label} · Stufe {step.get('index', idx + 1)}",
                poly,
                y_bot,
                y_top,
                oak,
                bev=0.004,
            )

    if spec_data is not None:
        for lvl in ("eg", "og"):
            for stair_entry in plan_stairs_data[lvl]:
                build_plan_stair_study(lvl, stair_entry)

    # ------------------------------------------------------------------
    # Helper to Get Exact Furniture Box from Spec or Imported GLB
    # ------------------------------------------------------------------
    def get_furn_box(lvl, fid, fallback_labels=()):
        fmap = spec_furn_eg if lvl == "eg" else spec_furn_og
        z_base = okff_eg if lvl == "eg" else okff_og
        if fid in fmap:
            f = fmap[fid]
            return (
                float(f["u0"]),
                float(f["v0"]),
                float(f["u1"]),
                float(f["v1"]),
                z_base,
                z_base + float(f["h"]),
            )
        coll = eg if lvl == "eg" else og
        return group_plan_bbox(coll, {fid, *fallback_labels})

    # ------------------------------------------------------------------
    # Architectural Sanitary & Appliance Upgrades (WC, Washbasins, Shower, HWR)
    # ------------------------------------------------------------------
    def nearest_wall_side(u0, v0, u1, v1, walls_list):
        """Return which edge ('u0'|'u1'|'v0'|'v1') of a fixture sits closest to a wall."""
        uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
        scores = {"u0": 1e9, "u1": 1e9, "v0": 1e9, "v1": 1e9}
        for w in walls_list:
            wu0, wv0, wu1, wv1 = float(w["u0"]), float(w["v0"]), float(w["u1"]), float(w["v1"])
            if wv0 - 0.15 <= vc <= wv1 + 0.15:
                scores["u0"] = min(scores["u0"], abs(u0 - wu1), abs(u0 - wu0))
                scores["u1"] = min(scores["u1"], abs(u1 - wu0), abs(u1 - wu1))
            if wu0 - 0.15 <= uc <= wu1 + 0.15:
                scores["v0"] = min(scores["v0"], abs(v0 - wv1), abs(v0 - wv0))
                scores["v1"] = min(scores["v1"], abs(v1 - wv0), abs(v1 - wv1))
        return min(scores, key=scores.get)

    def upgrade_wc(coll, fid, f, walls_list, z_base):
        u0, v0, u1, v1 = float(f["u0"]), float(f["v0"]), float(f["u1"]), float(f["v1"])
        back = nearest_wall_side(u0, v0, u1, v1, walls_list)
        uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
        du, dv = u1 - u0, v1 - v0
        # Wall-hung porcelain pan + cistern recess plate
        angle = {"u0": 0.0, "u1": math.pi, "v0": -math.pi / 2.0, "v1": math.pi / 2.0}[back]
        # Ceramic body
        block(
            coll,
            f"WC Körper · {fid}",
            (uc, vc, z_base + 0.25),
            (max(du - 0.04, 0.34), max(dv - 0.04, 0.34), 0.32),
            ceramic,
            bev=0.055,
            bev_segs=3,
        )
        # Slim WC seat + lid
        block(
            coll,
            f"WC Sitz · {fid}",
            (uc, vc, z_base + 0.43),
            (max(du - 0.08, 0.32), max(dv - 0.06, 0.32), 0.042),
            ceramic,
            bev=0.016,
            bev_segs=2,
        )
        # Brushed steel dual-flush wall plate (tagged frontCut if mounted on cut facade wall)
        on_cut_wall = False
        if back == "u0":
            fp_loc, fp_sz = (u0 - 0.01, vc, z_base + 1.02), (0.018, 0.22, 0.15)
            on_cut_wall = u0 <= T_EXT + 0.18
        elif back == "u1":
            fp_loc, fp_sz = (u1 + 0.01, vc, z_base + 1.02), (0.018, 0.22, 0.15)
        elif back == "v0":
            fp_loc, fp_sz = (uc, v0 - 0.01, z_base + 1.02), (0.22, 0.018, 0.15)
        else:
            fp_loc, fp_sz = (uc, v1 + 0.01, z_base + 1.02), (0.22, 0.018, 0.15)
            on_cut_wall = v1 >= W - T_EXT - 0.18
        fp_obj = block(coll, f"Drückerplatte · {fid}", fp_loc, fp_sz, chrome, bev=0.004, bev_segs=2)
        if on_cut_wall:
            fp_obj["frontCut"] = True
        _ = angle

    def upgrade_sink(coll, fid, f, walls_list, z_base):
        u0, v0, u1, v1, h_f = float(f["u0"]), float(f["v0"]), float(f["u1"]), float(f["v1"]), float(f["h"])
        back = nearest_wall_side(u0, v0, u1, v1, walls_list)
        uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
        du, dv = u1 - u0, v1 - v0
        # Floating oak vanity cabinet below ceramic basin
        block(
            coll,
            f"Waschtisch Unterschrank · {fid}",
            (uc, vc, z_base + h_f - 0.24),
            (max(du - 0.02, 0.28), max(dv - 0.02, 0.28), 0.34),
            oak,
            bev=0.008,
            bev_segs=2,
        )
        # Architectural rectangular ceramic washbasin
        block(
            coll,
            f"Waschbecken · {fid}",
            (uc, vc, z_base + h_f - 0.02),
            (du, dv, 0.11),
            ceramic,
            bev=0.018,
            bev_segs=3,
        )
        # Recessed dark drain accent
        block(
            coll,
            f"Ablauf · {fid}",
            (uc, vc, z_base + h_f + 0.036),
            (0.055, 0.055, 0.004),
            chrome,
            bev=0.001,
        )
        # Chrome single-lever mixer + mirror on backing wall
        on_cut_wall = False
        if back == "u0":
            tap_u, tap_v, dir_u, dir_v = u0 + 0.07, vc, 1.0, 0.0
            mir_loc, mir_sz = (u0 - 0.005, vc, z_base + 1.52), (0.022, min(dv + 0.16, 0.72), 0.82)
            on_cut_wall = u0 <= T_EXT + 0.18
        elif back == "u1":
            tap_u, tap_v, dir_u, dir_v = u1 - 0.07, vc, -1.0, 0.0
            mir_loc, mir_sz = (u1 + 0.005, vc, z_base + 1.52), (0.022, min(dv + 0.16, 0.72), 0.82)
        elif back == "v0":
            tap_u, tap_v, dir_u, dir_v = uc, v0 + 0.07, 0.0, 1.0
            mir_loc, mir_sz = (uc, v0 - 0.005, z_base + 1.52), (min(du + 0.16, 0.72), 0.022, 0.82)
        else:
            tap_u, tap_v, dir_u, dir_v = uc, v1 - 0.07, 0.0, -1.0
            mir_loc, mir_sz = (uc, v1 + 0.005, z_base + 1.52), (min(du + 0.16, 0.72), 0.022, 0.82)
            on_cut_wall = v1 >= W - T_EXT - 0.18
        tz = z_base + h_f + 0.035
        cylinder_between(coll, f"Waschtischarmatur · {fid}", (tap_u, tap_v, tz), (tap_u, tap_v, tz + 0.14), 0.017, chrome, 12)
        cylinder_between(
            coll,
            f"Auslauf · {fid}",
            (tap_u, tap_v, tz + 0.125),
            (tap_u + dir_u * 0.11, tap_v + dir_v * 0.11, tz + 0.105),
            0.011,
            chrome,
            10,
        )
        mir_obj = block(coll, f"Spiegel · {fid}", mir_loc, mir_sz, mirror_mat, bev=0.003, bev_segs=2)
        if on_cut_wall:
            mir_obj["frontCut"] = True

    def upgrade_shower(coll, fid, f, walls_list, z_base):
        u0, v0, u1, v1, h_f = float(f["u0"]), float(f["v0"]), float(f["u1"]), float(f["v1"]), float(f["h"])
        uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
        du, dv = u1 - u0, v1 - v0
        # Low-profile mineral shower tray + linear stainless drain
        block(coll, f"Duschwanne · {fid}", (uc, vc, z_base + 0.035), (du, dv, 0.07), ceramic, bev=0.008, bev_segs=2)
        block(
            coll,
            f"Duschrinne · {fid}",
            (u1 - 0.14, vc, z_base + 0.072),
            (0.065, max(dv - 0.24, 0.45), 0.004),
            chrome,
        )
        # Frameless walk-in glass partition on the open sides (away from outer/installations walls)
        # Check which sides have no wall nearby
        def has_wall_near(side):
            for w in walls_list:
                wu0, wv0, wu1, wv1 = float(w["u0"]), float(w["v0"]), float(w["u1"]), float(w["v1"])
                if side == "u0" and wv0 - 0.1 <= vc <= wv1 + 0.1 and abs(u0 - wu1) < 0.15:
                    return True
                if side == "u1" and wv0 - 0.1 <= vc <= wv1 + 0.1 and abs(u1 - wu0) < 0.15:
                    return True
                if side == "v0" and wu0 - 0.1 <= uc <= wu1 + 0.1 and abs(v0 - wv1) < 0.15:
                    return True
                if side == "v1" and wu0 - 0.1 <= uc <= wu1 + 0.1 and abs(v1 - wv0) < 0.15:
                    return True
            return False

        gh = h_f - 0.07
        gz = z_base + 0.07 + gh / 2.0
        if not has_wall_near("v1"):
            # Walk-in panel leaving entry gap on u0 side
            glass_u0 = u0 + 0.18
            block(coll, f"Duschglas · {fid}", ((glass_u0 + u1) / 2.0, v1 - 0.015, gz), (u1 - glass_u0, 0.012, gh), shower_glass)
            block(coll, f"Duschprofil · {fid}", (u1 - 0.015, v1 - 0.015, gz), (0.028, 0.028, gh), chrome)
        if not has_wall_near("u0"):
            block(coll, f"Duschglas Seite · {fid}", (u0 + 0.015, vc, gz), (0.012, dv, gh), shower_glass)
            block(coll, f"Duschprofil Seite · {fid}", (u0 + 0.015, v0 + 0.015, gz), (0.028, 0.028, gh), chrome)

        # Rain shower column + thermostat mixer on the Installationswand (u1 side if wall there, else v0)
        wall_u = u1 - 0.03 if has_wall_near("u1") else u0 + 0.03
        inward = -1.0 if has_wall_near("u1") else 1.0
        cylinder_between(coll, f"Duschstange · {fid}", (wall_u, vc, z_base + 1.05), (wall_u, vc, z_base + 2.12), 0.012, chrome, 12)
        cylinder_between(
            coll,
            f"Regenduscharm · {fid}",
            (wall_u, vc, z_base + 2.12),
            (wall_u + inward * 0.34, vc, z_base + 2.12),
            0.011,
            chrome,
            10,
        )
        cylinder_between(
            coll,
            f"Regenduschkopf · {fid}",
            (wall_u + inward * 0.34, vc, z_base + 2.11),
            (wall_u + inward * 0.34, vc, z_base + 2.08),
            0.125,
            chrome,
            24,
        )
        block(
            coll,
            f"Duschthermostat · {fid}",
            (wall_u + inward * 0.04, vc, z_base + 1.08),
            (0.06, 0.26, 0.045),
            chrome,
            bev=0.012,
            bev_segs=2,
        )

    def upgrade_appliance(coll, fid, f, z_base):
        u0, v0, u1, v1, h_f = float(f["u0"]), float(f["v0"]), float(f["u1"]), float(f["v1"]), float(f["h"])
        du, dv = u1 - u0, v1 - v0
        uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
        n_units = 2 if du >= 1.05 else 1
        unit_u = (du - 0.03 * (n_units - 1)) / n_units
        for k in range(n_units):
            au = u0 + k * (unit_u + 0.03) + unit_u / 2.0
            block(coll, f"Gerät {fid} · {k + 1}", (au, vc, z_base + h_f / 2.0), (unit_u, dv, h_f), appliance_white, bev=0.008, bev_segs=2)
            # Dark glass drum door + chrome ring on front (+v face)
            cylinder_between(
                coll,
                f"Bullauge Rahmen · {fid} {k + 1}",
                (au, v1 - 0.005, z_base + h_f * 0.48),
                (au, v1 + 0.022, z_base + h_f * 0.48),
                0.20,
                chrome,
                20,
            )
            cylinder_between(
                coll,
                f"Bullauge Glas · {fid} {k + 1}",
                (au, v1 + 0.012, z_base + h_f * 0.48),
                (au, v1 + 0.028, z_base + h_f * 0.48),
                0.155,
                dark,
                20,
            )
            block(
                coll,
                f"Bedienblende · {fid} {k + 1}",
                (au, v1 + 0.005, z_base + h_f - 0.075),
                (unit_u - 0.04, 0.014, 0.11),
                panel,
                bev=0.003,
            )

    # Replace crude WC, Sink, Shower, and WM/TR meshes imported from model3d.js
    if isinstance(spec_data, dict):
        levels_spec = spec_data.get("levels") or {}
        for lvl_key, coll_lvl, fmap, z_lvl in (
            ("eg", eg, spec_furn_eg, okff_eg),
            ("og", og, spec_furn_og, okff_og),
        ):
            walls_lvl = (levels_spec.get(lvl_key) or {}).get("walls") or []
            # Remove all crude imported sanitary/appliance meshes matching these fixtures by bbox proximity
            for fid, f in fmap.items():
                kind = f.get("kind", "")
                if kind not in ("wc", "sink", "shower", "appliance"):
                    continue
                fc_u = (float(f["u0"]) + float(f["u1"])) / 2.0
                fc_v = (float(f["v0"]) + float(f["v1"])) / 2.0
                # Find matching imported group meshes whose center falls inside this fixture rect
                to_drop = []
                for o in list(coll_lvl.objects):
                    if o.type != "MESH" or o not in original:
                        continue
                    ob = world_plan_bbox([o])
                    if not ob:
                        continue
                    ou = (ob[0] + ob[2]) / 2.0
                    ov = (ob[1] + ob[3]) / 2.0
                    if (
                        float(f["u0"]) - 0.08 <= ou <= float(f["u1"]) + 0.08
                        and float(f["v0"]) - 0.08 <= ov <= float(f["v1"]) + 0.08
                        and z_lvl - 0.05 <= ob[4] <= z_lvl + float(f["h"]) + 0.15
                    ):
                        # Only remove furniture meshes, never walls/windows/slabs
                        p_name = o.parent.name if o.parent else ""
                        if not p_name.startswith((f"{lvl_key}_", "Fußboden", "Geschossdecke", "Zugänge")):
                            to_drop.append(o)
                remove_objects(to_drop)
                if kind == "wc":
                    upgrade_wc(coll_lvl, fid, f, walls_lvl, z_lvl)
                elif kind == "sink":
                    upgrade_sink(coll_lvl, fid, f, walls_lvl, z_lvl)
                elif kind == "shower":
                    upgrade_shower(coll_lvl, fid, f, walls_lvl, z_lvl)
                elif kind == "appliance":
                    upgrade_appliance(coll_lvl, fid, f, z_lvl)

    # ------------------------------------------------------------------
    # OG Kitchen Architectural Upgrade (Data-Driven from spec & GLB)
    # ------------------------------------------------------------------
    kitchen_items = []
    if spec_furn_og:
        for fid, f in spec_furn_og.items():
            if str(f.get("kind", "")).startswith("kitchen"):
                kitchen_items.append(f)
    if not kitchen_items:
        # Fallback if no spec JSON was passed
        fallback_k = [
            ("og_k_spuelm", "kitchen", "Spülmasch.", 3.43, 0.38, 4.10, 1.24, 0.90),
            ("og_k_spuele", "kitchen-sink", "Spüle", 3.43, 1.24, 4.10, 2.12, 0.90),
            ("og_k_arbp", "kitchen", "Arbeitsfl.", 3.43, 2.12, 4.10, 3.02, 0.90),
            ("og_k_kuehl", "kitchen-tall", "Kühlschr.", 3.43, 4.20, 4.10, 5.05, 2.15),
            ("og_k_herd", "kitchen-hob", "Herd", 3.43, 5.05, 4.10, 5.92, 0.90),
            ("og_k_ofen", "kitchen-tall", "Backofen", 3.43, 5.92, 4.10, 6.76, 2.15),
        ]
        for fid, kind, lbl, u0, v0, u1, v1, h_k in fallback_k:
            box = group_plan_bbox(og, {lbl, fid})
            if box:
                kitchen_items.append(
                    {"id": fid, "kind": kind, "label": lbl, "u0": box[0], "v0": box[1], "u1": box[2], "v1": box[3], "h": box[5] - okff_og}
                )
            else:
                kitchen_items.append({"id": fid, "kind": kind, "label": lbl, "u0": u0, "v0": v0, "u1": u1, "v1": v1, "h": h_k})

    # Clean up raw model3d kitchen sub-meshes (floating countertop on tall units, raised sink slab, raw hob)
    kitchen_u0 = min(float(k["u0"]) for k in kitchen_items)
    kitchen_u1 = max(float(k["u1"]) for k in kitchen_items)
    top_run = [k for k in kitchen_items if (float(k["v0"]) + float(k["v1"])) / 2.0 < W / 2.0]
    bot_run = [k for k in kitchen_items if (float(k["v0"]) + float(k["v1"])) / 2.0 >= W / 2.0]
    if not top_run:
        top_run = kitchen_items

    for k in kitchen_items:
        fid = k["id"]
        lbl = k.get("label", fid)
        is_tall = k.get("kind") == "kitchen-tall" or float(k["h"]) > 1.45
        u0, v0, u1, v1, hk = float(k["u0"]), float(k["v0"]), float(k["u1"]), float(k["v1"]), float(k["h"])
        du, dv = u1 - u0, v1 - v0
        uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
        # Remove raw imported kitchen meshes for this unit (handle labels with trailing dots like "Kühlschr.")
        lbl_base = lbl.rstrip(".")
        k_meshes = []
        for o in list(og.objects):
            if o.type != "MESH" or o not in original:
                continue
            p_name = o.parent.name if o.parent else ""
            p_base = p_name.split(".")[0]
            if p_name in (lbl, fid) or p_base in (lbl, lbl_base, fid):
                k_meshes.append(o)
        remove_objects(k_meshes)

        # Recessed dark plinth (Sockelblende)
        plinth_h = 0.11
        block(
            og,
            f"Küchensockel · {fid}",
            (uc - 0.025, vc, okff_og + plinth_h / 2.0),
            (max(du - 0.06, 0.20), dv - 0.004, plinth_h),
            black,
        )

        if not is_tall:
            # Base cabinet carcass
            carcass_h = hk - plinth_h
            block(
                og,
                f"Unterschrank · {fid}",
                (uc - 0.01, vc, okff_og + plinth_h + carcass_h / 2.0),
                (max(du - 0.022, 0.25), dv - 0.004, carcass_h),
                panel,
                bev=0.003,
                bev_segs=2,
            )
            # 3 sleek beveled drawer fronts + burnished bronze handles on the +u room-facing side
            n_drawers = 3
            dh = (carcass_h - 0.016) / n_drawers
            for j in range(n_drawers):
                zc = okff_og + plinth_h + 0.008 + (j + 0.5) * dh
                block(
                    og,
                    f"Küchenauszug · {fid} {j + 1}",
                    (u1 - 0.006, vc, zc),
                    (0.020, max(dv - 0.014, 0.12), dh - 0.008),
                    panel,
                    bev=0.004,
                    bev_segs=2,
                )
                block(
                    og,
                    f"Griffleiste · {fid} {j + 1}",
                    (u1 + 0.014, vc, zc + dh * 0.28),
                    (0.018, min(dv * 0.48, 0.34), 0.012),
                    black,
                    bev=0.003,
                    bev_segs=2,
                )
            # Honed limestone countertop
            ct_h = 0.036
            ct_top = okff_og + hk + ct_h
            block(
                og,
                f"Arbeitsfläche · {fid}",
                (uc + 0.008, vc, okff_og + hk + ct_h / 2.0),
                (du + 0.020, dv + 0.002, ct_h),
                counter_stone,
                bev=0.004,
                bev_segs=2,
            )

            # Specialized sink / induction hob details
            if k.get("kind") == "kitchen-sink" or fid == "og_k_spuele":
                # Flush brushed-steel rim + dark recessed sink bowl + drain + swan-neck tap
                sw, sd = min(du * 0.66, 0.44), min(dv * 0.68, 0.56)
                s_u = uc + 0.04
                block(og, "Spülbecken · Rahmen", (s_u, vc, ct_top + 0.002), (sw + 0.05, sd + 0.05, 0.005), chrome, bev=0.002)
                block(og, "Spülbecken · Mulde", (s_u, vc, ct_top + 0.0045), (sw, sd, 0.003), steel)
                cylinder_between(og, "Spüle Ablauf", (s_u, vc, ct_top + 0.005), (s_u, vc, ct_top + 0.009), 0.038, chrome, 16)
                tap_u = u0 + 0.14
                # Base collar + sculpted swan-neck stainless faucet + side lever
                cylinder_between(og, "Armatur Sockel", (tap_u, vc, ct_top), (tap_u, vc, ct_top + 0.075), 0.024, chrome, 16)
                cylinder_between(og, "Armatur Hebel", (tap_u, vc + 0.02, ct_top + 0.055), (tap_u, vc + 0.09, ct_top + 0.085), 0.008, chrome, 10)
                pipe_mesh(
                    og,
                    "Küchenarmatur",
                    [
                        (tap_u, vc, ct_top + 0.06),
                        (tap_u, vc, ct_top + 0.28),
                        (tap_u + 0.04, vc, ct_top + 0.34),
                        (tap_u + 0.16, vc, ct_top + 0.34),
                        (tap_u + 0.21, vc, ct_top + 0.29),
                        (tap_u + 0.21, vc, ct_top + 0.22),
                    ],
                    0.013,
                    chrome,
                    segments=12,
                    bend_radius=0.045,
                )
            elif k.get("kind") == "kitchen-hob" or fid == "og_k_herd":
                # Sleek flush beveled black ceramic induction glass + subtle zone rings
                hw, hd = min(du * 0.76, 0.52), min(dv * 0.76, 0.64)
                block(og, "Induktionskochfeld", (uc + 0.02, vc, ct_top + 0.004), (hw, hd, 0.008), dark, bev=0.003, bev_segs=2)
                hz = ct_top + 0.009
                for du_r in (-hw * 0.23, hw * 0.23):
                    for dv_r in (-hd * 0.24, hd * 0.24):
                        u_ring, v_ring = uc + 0.02 + du_r, vc + dv_r
                        pts_r = [
                            (u_ring + 0.082 * math.cos(i * math.tau / 36), v_ring + 0.082 * math.sin(i * math.tau / 36), hz)
                            for i in range(37)
                        ]
                        line(og, "Induktionszone", pts_r, 0.0018, steel, resolution=1, fill_caps=False)
        else:
            # Tall kitchen column (Fridge or Built-in Oven) — NO floating top countertop!
            carcass_h = hk - plinth_h
            block(
                og,
                f"Hochschrank Korpus · {fid}",
                (uc - 0.01, vc, okff_og + plinth_h + carcass_h / 2.0),
                (max(du - 0.022, 0.35), dv - 0.004, carcass_h),
                panel,
                bev=0.004,
                bev_segs=2,
            )
            if "ofen" in fid or "backofen" in lbl.lower():
                # Lower drawer/door (0.11 .. 0.78), built-in flush glass oven (0.78 .. 1.38), upper door (1.38 .. hk)
                z_low0, z_low1 = okff_og + plinth_h + 0.006, okff_og + 0.77
                z_ov0, z_ov1 = okff_og + 0.78, okff_og + 1.38
                z_hi0, z_hi1 = okff_og + 1.39, okff_og + hk - 0.004
                block(og, "Backofenschrank unten", (u1 - 0.006, vc, (z_low0 + z_low1) / 2.0), (0.020, dv - 0.014, z_low1 - z_low0), panel, bev=0.004, bev_segs=2)
                block(og, "Backofenschrank oben", (u1 - 0.006, vc, (z_hi0 + z_hi1) / 2.0), (0.020, dv - 0.014, z_hi1 - z_hi0), panel, bev=0.004, bev_segs=2)
                # Flush black glass oven door + stainless control fascia + sleek handle
                ov_w = min(dv - 0.05, 0.60)
                block(og, "Backofen Glasfront", (u1 - 0.002, vc, (z_ov0 + z_ov1) / 2.0), (0.024, ov_w, z_ov1 - z_ov0 - 0.01), dark, bev=0.005, bev_segs=2)
                block(og, "Backofen Blende", (u1 + 0.006, vc, z_ov1 - 0.055), (0.012, ov_w - 0.01, 0.09), steel, bev=0.002)
                block(og, "Backofen Griff", (u1 + 0.036, vc, z_ov1 - 0.13), (0.016, ov_w - 0.06, 0.018), chrome, bev=0.004, bev_segs=2)
                for dy_h in (-ov_w * 0.42, ov_w * 0.42):
                    block(og, "Backofen Griffhalter", (u1 + 0.018, vc + dy_h, z_ov1 - 0.13), (0.030, 0.014, 0.014), chrome)
            else:
                # Tall fridge/freezer with 2-door split seam + slim vertical handle
                z_split = okff_og + 0.84
                z_bot0, z_top1 = okff_og + plinth_h + 0.006, okff_og + hk - 0.004
                block(og, "Gefrierfront", (u1 - 0.006, vc, (z_bot0 + z_split - 0.006) / 2.0), (0.020, dv - 0.014, z_split - 0.006 - z_bot0), panel, bev=0.004, bev_segs=2)
                block(og, "Kühlschrankfront", (u1 - 0.006, vc, (z_split + 0.006 + z_top1) / 2.0), (0.020, dv - 0.014, z_top1 - z_split - 0.006), panel, bev=0.004, bev_segs=2)
                handle_v = v0 + 0.075
                block(og, "Kühlschrankgriff", (u1 + 0.022, handle_v, okff_og + 1.32), (0.016, 0.016, 0.68), black, bev=0.004, bev_segs=2)

    # Upper wall cabinets + limestone backsplash + warm under-cabinet LED glow over top kitchen run
    top_v0 = min(float(k["v0"]) for k in top_run)
    top_v1 = max(float(k["v1"]) for k in top_run)
    base_heights = [float(k["h"]) for k in top_run if float(k["h"]) < 1.45]
    counter_top_z = okff_og + (max(base_heights) if base_heights else 0.90) + 0.036

    upper_depth = min(0.38, max(0.32, (kitchen_u1 - kitchen_u0) * 0.52))
    upper_u = kitchen_u0 + upper_depth / 2.0 + 0.004
    upper_z0 = counter_top_z + 0.54
    upper_h = 0.72
    upper_zc = upper_z0 + upper_h / 2.0
    # Align upper cabinets cleanly to the top run modules
    for idx, k in enumerate(sorted(top_run, key=lambda x: float(x["v0"]))):
        kv0, kv1 = float(k["v0"]), float(k["v1"])
        kvc = (kv0 + kv1) / 2.0
        kdv = kv1 - kv0
        block(og, f"Oberschrank {idx + 1}", (upper_u, kvc, upper_zc), (upper_depth, max(kdv - 0.006, 0.25), upper_h), panel, bev=0.004, bev_segs=2)
        block(
            og,
            f"Oberschrank · Tür {idx + 1}",
            (upper_u + upper_depth / 2.0 + 0.010, kvc, upper_zc),
            (0.019, max(kdv - 0.014, 0.24), upper_h - 0.010),
            panel,
            bev=0.004,
            bev_segs=2,
        )
    # Stone backsplash neatly spanning countertop to underside of upper cabinets
    bs_h = upper_z0 - counter_top_z
    block(
        og,
        "Nischenrückwand",
        (kitchen_u0 + 0.016, (top_v0 + top_v1) / 2.0, counter_top_z + bs_h / 2.0),
        (0.030, max(top_v1 - top_v0 - 0.004, 0.50), bs_h),
        counter_stone,
        bev=0.002,
    )
    # Warm hidden under-cabinet LED strip lighting the backsplash & countertop
    led_strip = light(
        "Küchenlicht · Unterbau",
        pt(upper_u + 0.04, (top_v0 + top_v1) / 2.0, upper_z0 - 0.012),
        pt(upper_u + 0.08, (top_v0 + top_v1) / 2.0, counter_top_z),
        16,
        (1.0, 0.80, 0.58),
        0.10,
    )
    led_strip.data.shape = "RECTANGLE"
    led_strip.data.size = 0.08
    led_strip.data.size_y = max(top_v1 - top_v0 - 0.16, 0.60)
    led_strip.visible_camera = False
    led_strip.visible_glossy = False

    # ------------------------------------------------------------------
    # Tailored Architectural Eckbank & L-Sofa Upgrade (Zero Misaligned Backrests!)
    # ------------------------------------------------------------------
    esstisch_box = get_furn_box("og", "og_ecktisch", ("Esstisch",))
    if not esstisch_box:
        esstisch_box = (5.48, 4.46, 7.05, 5.88, okff_og, okff_og + 0.76)

    sofa_entries = [f for f in spec_furn_og.values() if f.get("kind") == "sofa"]
    bank_entries = []
    lounge_entries = []
    t_uc = (esstisch_box[0] + esstisch_box[2]) / 2.0
    t_vc = (esstisch_box[1] + esstisch_box[3]) / 2.0
    for f in sofa_entries:
        fc_u = (float(f["u0"]) + float(f["u1"])) / 2.0
        fc_v = (float(f["v0"]) + float(f["v1"])) / 2.0
        if "bank" in f["id"] or "eckbank" in str(f.get("label", "")).lower() or math.hypot(fc_u - t_uc, fc_v - t_vc) < 2.2:
            bank_entries.append(f)
        else:
            lounge_entries.append(f)

    def remove_sofa_raw_meshes(entries):
        for f in entries:
            fid, lbl = f["id"], f.get("label", "")
            to_drop = []
            for o in list(og.objects):
                if o.type != "MESH" or o not in original:
                    continue
                p_name = o.parent.name if o.parent else ""
                if p_name.split(".")[0] in (fid, lbl) and o.name.split(".")[0] in ("Sitz", "Rücken"):
                    to_drop.append(o)
                else:
                    ob = world_plan_bbox([o])
                    if ob and o.name.split(".")[0] in ("Sitz", "Rücken"):
                        ou, ov = (ob[0] + ob[2]) / 2.0, (ob[1] + ob[3]) / 2.0
                        if float(f["u0"]) - 0.06 <= ou <= float(f["u1"]) + 0.06 and float(f["v0"]) - 0.06 <= ov <= float(f["v1"]) + 0.06:
                            to_drop.append(o)
            remove_objects(to_drop)

    def build_tailored_eckbank(entries):
        if not entries:
            return
        remove_sofa_raw_meshes(entries)
        # Check whether the Eckbank has both horizontal ('bottom'/'top') and vertical ('right'/'left') legs
        has_right_leg = any(f.get("back") == "right" or (float(f["v1"]) - float(f["v0"]) > float(f["u1"]) - float(f["u0"]) and abs(float(f["u1"]) - t_uc) >= abs(float(f["u0"]) - t_uc)) for f in entries)
        for idx, f in enumerate(entries):
            u0, v0, u1, v1, hf = float(f["u0"]), float(f["v0"]), float(f["u1"]), float(f["v1"]), float(f["h"])
            du, dv = u1 - u0, v1 - v0
            uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
            # Recessed solid oak plinth + legs
            block(og, f"Eckbank Gestell {idx + 1}", (uc, vc, okff_og + 0.14), (max(du - 0.08, 0.25), max(dv - 0.08, 0.25), 0.10), oak, bev=0.006, bev_segs=2)
            for lu in (u0 + 0.08, u1 - 0.08):
                for lv in (v0 + 0.08, v1 - 0.08):
                    block(og, f"Eckbank Fuß {idx + 1}", (lu, lv, okff_og + 0.07), (0.045, 0.045, 0.14), oak, bev=0.005, bev_segs=2)
            # Segmented upholstered seat cushions (0.19 .. 0.45)
            back_side = f.get("back")
            if back_side not in ("left", "right", "top", "bottom"):
                if du >= dv:
                    back_side = "bottom" if abs(v1 - t_vc) >= abs(v0 - t_vc) else "top"
                else:
                    back_side = "right" if abs(u1 - t_uc) >= abs(u0 - t_uc) else "left"
            horizontal = back_side in ("top", "bottom")
            span = du if horizontal else dv
            n_seg = max(2, int(round(span / 0.85)))
            step = span / n_seg
            for s in range(n_seg):
                if horizontal:
                    su0, su1 = u0 + s * step + 0.008, u0 + (s + 1) * step - 0.008
                    block(og, f"Eckbank Sitz {idx + 1}.{s + 1}", ((su0 + su1) / 2.0, vc, okff_og + 0.32), (su1 - su0, dv - 0.02, 0.24), fabric, bev=0.036, bev_segs=3)
                else:
                    sv0, sv1 = v0 + s * step + 0.008, v0 + (s + 1) * step - 0.008
                    block(og, f"Eckbank Sitz {idx + 1}.{s + 1}", (uc, (sv0 + sv1) / 2.0, okff_og + 0.32), (du - 0.02, sv1 - sv0, 0.24), fabric, bev=0.036, bev_segs=3)
            # Backrest strictly following spec f.back (away from dining table) + seamless L-corner return
            back_t = 0.18
            back_h = max(hf - 0.42, 0.36)
            back_zc = okff_og + 0.42 + back_h / 2.0
            if back_side in ("bottom", "top"):
                back_v = v1 - back_t / 2.0 if back_side == "bottom" else v0 + back_t / 2.0
                block(og, f"Eckbank Rücken {idx + 1}", (uc, back_v, back_zc), (du - 0.01, back_t, back_h), fabric, bev=0.035, bev_segs=3)
                if has_right_leg and back_side == "bottom":
                    # Seamless corner wrap along u1 from v0 to back_v
                    corner_v0 = v0 + 0.005
                    corner_v1 = v1 - back_t
                    if corner_v1 > corner_v0 + 0.05:
                        block(
                            og,
                            f"Eckbank Rücken Ecke {idx + 1}",
                            (u1 - back_t / 2.0, (corner_v0 + corner_v1) / 2.0, back_zc),
                            (back_t, corner_v1 - corner_v0, back_h),
                            fabric,
                            bev=0.035,
                            bev_segs=3,
                        )
                inward = -1.0 if back_side == "bottom" else 1.0
                for t_frac, pmat, rot_z in ((0.22, rugmat, 0.08), (0.60, linen, -0.06)):
                    p = block(
                        og,
                        "Lehnenkissen",
                        (u0 + t_frac * du, back_v + inward * 0.14, okff_og + 0.57),
                        (0.40, 0.15, 0.36),
                        pmat,
                        bev=0.055,
                        angle=rot_z,
                        bev_segs=3,
                    )
                    p.rotation_euler.x = -0.18 * inward
            else:
                back_u = u1 - back_t / 2.0 if back_side == "right" else u0 + back_t / 2.0
                block(og, f"Eckbank Rücken {idx + 1}", (back_u, vc, back_zc), (back_t, dv - 0.01, back_h), fabric, bev=0.035, bev_segs=3)
                inward = -1.0 if back_side == "right" else 1.0
                p = block(
                    og,
                    "Lehnenkissen",
                    (back_u + inward * 0.14, vc, okff_og + 0.57),
                    (0.15, 0.40, 0.36),
                    clay,
                    bev=0.055,
                    angle=0.05,
                    bev_segs=3,
                )
                p.rotation_euler.y = 0.18 * inward

    def build_tailored_l_sofa(entries):
        if not entries:
            return
        remove_sofa_raw_meshes(entries)
        entries_sorted = sorted(
            entries,
            key=lambda x: (float(x["u1"]) - float(x["u0"])) * (float(x["v1"]) - float(x["v0"])),
            reverse=True,
        )
        su0 = min(float(x["u0"]) for x in entries)
        sv0 = min(float(x["v0"]) for x in entries)
        su1 = max(float(x["u1"]) for x in entries)
        sv1 = max(float(x["v1"]) for x in entries)
        has_left_leg = any(f.get("back") == "left" for f in entries)
        has_bottom_leg = any(f.get("back") == "bottom" for f in entries)

        for idx, f in enumerate(entries_sorted):
            u0, v0, u1, v1, hf = float(f["u0"]), float(f["v0"]), float(f["u1"]), float(f["v1"]), float(f["h"])
            du, dv = u1 - u0, v1 - v0
            uc, vc = (u0 + u1) / 2.0, (v0 + v1) / 2.0
            # Recessed low oak plinth base
            block(og, f"Sofa Sockel {idx + 1}", (uc, vc, okff_og + 0.055), (max(du - 0.08, 0.30), max(dv - 0.08, 0.30), 0.09), oak, bev=0.006, bev_segs=2)

            back_side = f.get("back")
            if back_side not in ("left", "right", "top", "bottom"):
                back_side = "left" if idx == 0 else "bottom"

            horizontal = back_side in ("top", "bottom")
            span = du if horizontal else dv
            n_seg = max(2, int(round(span / 0.85)))
            step = span / n_seg
            for s in range(n_seg):
                if horizontal:
                    a, b = u0 + s * step + 0.008, u0 + (s + 1) * step - 0.008
                    block(og, f"Sofa Sitz {idx + 1}.{s + 1}", ((a + b) / 2.0, vc, okff_og + 0.265), (b - a, dv - 0.02, 0.31), fabric, bev=0.042, bev_segs=3)
                else:
                    a, b = v0 + s * step + 0.008, v0 + (s + 1) * step - 0.008
                    block(og, f"Sofa Sitz {idx + 1}.{s + 1}", (uc, (a + b) / 2.0, okff_og + 0.265), (du - 0.02, b - a, 0.31), fabric, bev=0.042, bev_segs=3)

            back_t = 0.21
            back_h = max(hf - 0.40, 0.36)
            back_zc = okff_og + 0.40 + back_h / 2.0

            if back_side in ("left", "right"):
                bu = u0 + back_t / 2.0 if back_side == "left" else u1 - back_t / 2.0
                inward_u = 1.0 if back_side == "left" else -1.0
                block(og, f"Sofa Rücken {idx + 1}", (bu, vc, back_zc), (back_t, dv - 0.01, back_h), fabric, bev=0.042, bev_segs=3)
                # Sleek low armrest on the free outer v-end (away from bottom leg)
                arm_v = v0 + 0.095 if abs(v0 - sv1) >= abs(v1 - sv1) else v1 - 0.095
                block(og, f"Sofa Armlehne {idx + 1}", (uc, arm_v, okff_og + 0.50), (du - 0.02, 0.17, 0.24), fabric, bev=0.036, bev_segs=3)
                for frac, pmat, rot_z in ((0.30, linen, 0.08), (0.68, clay, -0.06)):
                    p = block(
                        og,
                        "Sofakissen",
                        (bu + inward_u * 0.17, v0 + frac * dv, okff_og + 0.57),
                        (0.16, 0.44, 0.38),
                        pmat,
                        bev=0.058,
                        angle=rot_z,
                        bev_segs=3,
                    )
                    p.rotation_euler.y = -0.18 * inward_u
            else:
                bv = v1 - back_t / 2.0 if back_side == "bottom" else v0 + back_t / 2.0
                inward_v = -1.0 if back_side == "bottom" else 1.0
                block(og, f"Sofa Rücken {idx + 1}", (uc, bv, back_zc), (du - 0.01, back_t, back_h), fabric, bev=0.042, bev_segs=3)
                # Seamless corner backrest along u0 = su0 connecting left leg into bottom leg!
                if has_left_leg and abs(u0 - su0) < 0.08 and back_side == "bottom":
                    cv0, cv1 = v0 + 0.005, v1 - back_t
                    if cv1 > cv0 + 0.05:
                        block(
                            og,
                            f"Sofa Rücken Ecke {idx + 1}",
                            (u0 + back_t / 2.0, (cv0 + cv1) / 2.0, back_zc),
                            (back_t, cv1 - cv0, back_h),
                            fabric,
                            bev=0.042,
                            bev_segs=3,
                        )
                for frac, pmat, rot_z in ((0.38, rugmat, 0.06), (0.72, linen, -0.05)):
                    p = block(
                        og,
                        "Sofakissen Schenkel",
                        (u0 + frac * du, bv + inward_v * 0.17, okff_og + 0.57),
                        (0.42, 0.16, 0.38),
                        pmat,
                        bev=0.058,
                        angle=rot_z,
                        bev_segs=3,
                    )
                    p.rotation_euler.x = -0.18 * inward_v

        # Woven wool area rug cleanly framing L-Sofa
        rug_u0 = max(su0 - 0.44, kitchen_u1 + 2.40)
        rug_u1 = min(su1 + 0.48, L - T_EXT - 0.16)
        rug_v0 = max(sv0 - 0.22, T_EXT + 0.12)
        rug_v1 = min(sv1 + 0.32, W / 2.0 + 0.30)
        block(
            og,
            "Wollteppich im Wohnbereich",
            ((rug_u0 + rug_u1) / 2.0, (rug_v0 + rug_v1) / 2.0, okff_og + 0.008),
            (rug_u1 - rug_u0, rug_v1 - rug_v0, 0.014),
            rugmat,
            bev=0.006,
            bev_segs=2,
        )

        # Nested solid-oak side tables tucked into the L-Sofa living pocket (open corner facing Garten)
        left_leg = next((e for e in entries_sorted if e.get("back") == "left"), entries_sorted[0])
        bot_leg = next((e for e in entries_sorted if e.get("back") == "bottom"), entries_sorted[-1] if len(entries_sorted) > 1 else None)
        if bot_leg is not None and bot_leg is not left_leg:
            pocket_u0 = float(left_leg["u1"]) + 0.34
            pocket_u1 = min(L - T_EXT - 0.34, float(bot_leg["u1"]) + 0.16)
            pocket_v0 = float(left_leg["v0"]) + 0.38
            pocket_v1 = float(bot_leg["v0"]) - 0.34
            if pocket_u1 >= pocket_u0 and pocket_v1 >= pocket_v0:
                t1_u = min(pocket_u0 + 0.08, (pocket_u0 + pocket_u1) / 2.0)
                t1_v = max(pocket_v0, pocket_v1 - 0.34)
                t2_u = min(t1_u + 0.24, pocket_u1)
                t2_v = min(t1_v + 0.28, pocket_v1)
                for tu, tv, tr, th in ((t1_u, t1_v, 0.28, 0.37), (t2_u, t2_v, 0.21, 0.30)):
                    lathe(
                        og,
                        "Beistelltisch",
                        (tu, tv, okff_og + 0.015),
                        [
                            (0, 0),
                            (0.14, 0),
                            (0.10, 0.03),
                            (0.075, th - 0.037),
                            (tr * 0.97, th - 0.035),
                            (tr, th - 0.018),
                            (tr * 0.97, th),
                            (0, th),
                        ],
                        oak,
                        segments=40,
                    )
                block(og, "Leinenband", (t1_u, t1_v, okff_og + 0.402), (0.30, 0.22, 0.030), artm[3], bev=0.002, angle=0.14)

    build_tailored_eckbank(bank_entries)
    build_tailored_l_sofa(lounge_entries)

    # ------------------------------------------------------------------
    # Architectural Baseboards (100% Data-Driven around Openings & Stairs)
    # ------------------------------------------------------------------
    hwr_east_bbox = group_plan_bbox(eg, {"eg_hwr_east"})
    hwr_right_u = hwr_east_bbox[2] if hwr_east_bbox else 3.425
    stair_box = (spec_data or {}).get("stairs", {}).get("box") or {}
    stair_v0 = float(stair_box.get("v0", 4.40))

    # EG Grenzwand baseboard
    eg_west_u0 = max(hwr_right_u + 0.01, 2.95)
    eg_west_u1 = L - T_EXT - 0.015
    block(
        eg,
        "Sockelleiste EG",
        ((eg_west_u0 + eg_west_u1) / 2.0, T_EXT + 0.014, okff_eg + 0.042),
        (eg_west_u1 - eg_west_u0, 0.024, 0.084),
        plaster,
        0.002,
    )
    # EG Garden baseboard split cleanly around garden door T_terr
    g_door_s0, g_door_s1 = 2.025, 2.975
    if isinstance(spec_data, dict):
        for op in (spec_data.get("levels", {}).get("eg", {}).get("openings") or ()):
            if op.get("gardenEntrance") or op.get("id") == "T_terr":
                g_door_s0, g_door_s1 = float(op["s0"]), float(op["s1"])
                break
    for suffix, bv0, bv1 in [
        ("Nord", T_EXT + 0.015, g_door_s0 - 0.03),
        ("Mitte", g_door_s1 + 0.03, min(stair_v0 - 0.05, W - T_EXT - 0.05)),
    ]:
        if bv1 > bv0 + 0.15:
            block(
                eg,
                f"Sockelleiste Garten EG · {suffix}",
                (L - T_EXT - 0.014, (bv0 + bv1) / 2.0, okff_eg + 0.042),
                (0.024, bv1 - bv0, 0.084),
                plaster,
                0.002,
            )

    # OG Grenzwand & Garden baseboards
    og_west_u0 = min(max(kitchen_u1 + 0.01, 4.10), 4.65)
    og_west_u1 = L - T_EXT - 0.015
    block(
        og,
        "Sockelleiste OG",
        ((og_west_u0 + og_west_u1) / 2.0, T_EXT + 0.014, okff_og + 0.042),
        (og_west_u1 - og_west_u0, 0.024, 0.084),
        plaster,
        0.002,
    )
    og_g_v1 = min(stair_v0 - 0.05, W - T_EXT - 0.05)
    if og_g_v1 > T_EXT + 0.20:
        block(
            og,
            "Sockelleiste Garten OG",
            (L - T_EXT - 0.014, (T_EXT + 0.015 + og_g_v1) / 2.0, okff_og + 0.042),
            (0.024, og_g_v1 - (T_EXT + 0.015), 0.084),
            plaster,
            0.002,
        )

    # ------------------------------------------------------------------
    # OG Pendant Lights, Dining Tableware, Artwork, Curtains & Countertop Props
    # ------------------------------------------------------------------
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
            segments=40,
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
            segments=40,
        )

    # OG pendant lights over dining table and kitchen work zone
    og_ceil_z = okff_og + og_clear
    kitchen_light_u = kitchen_u1 + 0.56
    kitchen_light_v = (top_v0 + top_v1) / 2.0
    for i, (pu, pv, drop_z) in enumerate(
        [(t_uc, t_vc, okff_og + 2.06), (kitchen_light_u, kitchen_light_v, okff_og + 2.18)]
    ):
        line(og, f"Pendelleitung OG {i + 1}", [(pu, pv, og_ceil_z), (pu, pv, drop_z)], 0.006, black, resolution=2)
        lathe(
            og,
            f"Rosette OG {i + 1}",
            (pu, pv, og_ceil_z - 0.022),
            [(0, 0), (0.062, 0), (0.062, 0.022), (0, 0.022)],
            black,
            segments=28,
        )
        lathe(
            og,
            f"Pendelleuchte · gefalteter Schirm OG {i + 1}",
            (pu, pv, drop_z - 0.065),
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
            curtain_linen,
            segments=40,
        )
        light(
            f"Licht über Tisch OG{i + 1}",
            pt(pu, pv, drop_z - 0.035),
            pt(pu, pv, okff_og),
            34,
            (1.0, 0.74, 0.47),
            0.22,
        )

    # Dining table centerpiece & place settings
    table_z = esstisch_box[5]
    bowl(og, t_uc + 0.08, t_vc + 0.03, table_z + 0.002, 0.185, clay)
    vase(og, t_uc - 0.42, t_vc + 0.19, table_z + 0.002, 0.064, 0.155, ivory)
    for pu, pv in [(t_uc + 0.24, t_vc - 0.34), (t_uc - 0.26, t_vc + 0.36)]:
        lathe(
            og,
            "Teller, Steinzeug",
            (pu, pv, table_z + 0.003),
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
            segments=32,
        )
        block(og, "Leinenserviette", (pu + 0.21, pv, table_z + 0.007), (0.086, 0.18, 0.009), linen, 0.004, 0.1)
        line(
            og,
            "Tafelmesser",
            [(pu + 0.216, pv - 0.056, table_z + 0.015), (pu + 0.216, pv + 0.088, table_z + 0.015)],
            0.0045,
            chrome,
            resolution=2,
        )
        lathe(
            og,
            "Trinkbecher",
            (pu + 0.115, pv + 0.175, table_z + 0.003),
            [
                (0.042, 0.002),
                (0.042, 0.007),
                (0.047, 0.090),
                (0.046, 0.093),
                (0.042, 0.094),
                (0.040, 0.013),
                (0.032, 0.009),
                (0, 0.009),
            ],
            ivory,
            segments=28,
        )

    # Countertop ceramic accents & solid oak cutting board
    arbp = next((k for k in top_run if k["id"] == "og_k_arbp" or "arbeits" in str(k.get("label", "")).lower()), None)
    spuelm = next((k for k in top_run if k["id"] == "og_k_spuelm" or "spülmasch" in str(k.get("label", "")).lower()), None)
    if arbp:
        au = (float(arbp["u0"]) + float(arbp["u1"])) / 2.0
        av = (float(arbp["v0"]) + float(arbp["v1"])) / 2.0
        vase(og, au - 0.04, av + 0.14, counter_top_z + 0.002, 0.052, 0.155, clay)
        block(og, "Schneidebrett Eiche", (au + 0.06, av - 0.12, counter_top_z + 0.012), (0.28, 0.38, 0.022), oak, bev=0.005, angle=0.08, bev_segs=2)
    if spuelm:
        su = (float(spuelm["u0"]) + float(spuelm["u1"])) / 2.0
        sv = (float(spuelm["v0"]) + float(spuelm["v1"])) / 2.0
        bowl(og, su + 0.04, sv, counter_top_z + 0.002, 0.12, ivory)

    # Framed minimalist artwork on OG Grenzwand wall between kitchen and L-Sofa
    sofa_u0_min = min((float(f["u0"]) for f in lounge_entries), default=8.08)
    og_art_u = (kitchen_u1 + sofa_u0_min) / 2.0
    art_v = T_EXT + 0.032
    art_z = okff_og + 1.52
    art_w, art_h = 1.18, 0.86
    block(og, "Rahmen in Eiche", (og_art_u, art_v, art_z), (art_w, 0.044, art_h), oak, 0.006, bev_segs=2)
    block(og, "Passepartout", (og_art_u, art_v + 0.022, art_z), (art_w - 0.036, 0.008, art_h - 0.036), ivory)
    block(og, "Fine-Art-Druck · Papier", (og_art_u, art_v + 0.027, art_z), (art_w * 0.84, 0.002, art_h * 0.84), artm[0])
    for row, (ax, ay, aww, ahh, aidx) in enumerate(
        [(-0.14, 0.0, 0.46, 0.66, 4), (0.14, 0.09, 0.34, 0.39, 3), (0.11, -0.13, 0.40, 0.16, 2)]
    ):
        block(
            og,
            "Pigmentdruck",
            (og_art_u + ax * art_w, art_v + 0.029 + row * 0.0005, art_z + ay * art_h),
            (aww * art_w, 0.0004, ahh * art_h),
            artm[aidx],
        )

    # Translucent linen curtains framing the OG garden windows
    def drape(coll, v0, v1, level_z):
        du = L - T_EXT - 0.165
        top = level_z + og_clear - 0.16
        bottom = level_z + 0.06
        verts = []
        faces = []
        segments = 48
        for j in range(5):
            for i in range(segments + 1):
                t = i / segments
                fold = math.sin(t * math.tau * 6.0 + 0.09 * j)
                x = du + 0.030 * fold + 0.005 * math.cos(t * math.tau * 4.0 + j * 0.4)
                v = v0 + (v1 - v0) * t * (1.0 + 0.018 * j)
                verts.append(pt(x, v, top + (bottom - top) * j / 4.0 + (0.005 * fold if j == 4 else 0.0)))
        for j in range(4):
            for i in range(segments):
                a = j * (segments + 1) + i
                faces.append((a, a + 1, a + segments + 2, a + segments + 1))
        curtain = link_mesh("Leinenvorhang", verts, faces, curtain_linen, coll)
        for face in curtain.data.polygons:
            face.use_smooth = True

    curt_v0 = T_EXT + 0.18
    curt_v1 = min(stair_v0 - 0.08, 4.34)
    if curt_v1 > curt_v0 + 1.0:
        rod_u = L - T_EXT - 0.135
        rod_z = okff_og + og_clear - 0.14
        line(og, "Vorhangstange", [(rod_u, curt_v0 - 0.02, rod_z), (rod_u, curt_v1 + 0.02, rod_z)], 0.011, black, resolution=2)
        drape(og, curt_v0, curt_v0 + 0.30, okff_og)
        drape(og, curt_v1 - 0.30, curt_v1, okff_og)

    # ------------------------------------------------------------------
    # Door Hardware on All Imported Doors (Explicitly Tagged frontCut!)
    # ------------------------------------------------------------------
    for obj in list(original):
        if obj.type != "MESH" or not obj.name.startswith(("Tür ", "Nebeneingang (", "Haupteingang (")):
            continue
        corners = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
        lo = [min(v[i] for v in corners) for i in range(3)]
        hi = [max(v[i] for v in corners) for i in range(3)]
        if hi[2] - lo[2] < 1.5 or max(hi[0] - lo[0], hi[1] - lo[1]) < 0.45:
            continue
        coll = og if lo[2] > (okff_og - 0.5) else eg
        parent_name = obj.parent.name if obj.parent else ""
        is_cut = parent_name in {"eg_ext_east", "eg_ext_south", "og_ext_east", "og_ext_south"}

        u_mid = (lo[0] + hi[0]) / 2.0 + L / 2.0
        v_mid = W / 2.0 - (lo[1] + hi[1]) / 2.0
        z_h = lo[2] + 1.03
        created_hw = []
        if hi[0] - lo[0] > hi[1] - lo[1]:
            u_h = hi[0] + L / 2.0 - 0.10
            for sign in (-1, 1):
                vv = v_mid + sign * ((hi[1] - lo[1]) / 2.0 + 0.005)
                created_hw.append(block(coll, "Drückerrosette", (u_h, vv, z_h), (0.052, 0.009, 0.052), black, 0.005, bev_segs=2))
                created_hw.append(
                    line(
                        coll,
                        "Türklinke",
                        [(u_h, vv, z_h), (u_h, vv + sign * 0.048, z_h), (u_h - 0.11, vv + sign * 0.048, z_h)],
                        0.010,
                        chrome,
                        resolution=2,
                    )
                )
        else:
            v_h = W / 2.0 - lo[1] - 0.11
            for sign in (-1, 1):
                uu = u_mid + sign * ((hi[0] - lo[0]) / 2.0 + 0.005)
                created_hw.append(block(coll, "Drückerrosette", (uu, v_h, z_h), (0.009, 0.052, 0.052), black, 0.005, bev_segs=2))
                created_hw.append(
                    line(
                        coll,
                        "Türklinke",
                        [(uu, v_h, z_h), (uu + sign * 0.048, v_h, z_h), (uu + sign * 0.048, v_h - 0.11, z_h)],
                        0.010,
                        chrome,
                        resolution=2,
                    )
                )
        for hw in created_hw:
            hw["frontCut"] = is_cut

    # ------------------------------------------------------------------
    # Detailed Physical 3D Plumbing (Trinkwasser) & Electrical (Strom)
    # ------------------------------------------------------------------
    utility_collections = {}

    def tag_service(obj, system, level, route_id=None, label=None):
        if obj is None:
            return None
        obj["service"] = system
        obj["level"] = level
        obj["frontCut"] = False
        obj["export_web_pbr"] = True
        if route_id:
            obj["utility_id"] = str(route_id)
        if label:
            obj["utility_label"] = str(label)
        return obj

    if utilities_data is not None:
        for system in ("water", "power"):
            coll_name = UTILITY_COLLECTIONS[system]
            u_coll = make_collection(coll_name)
            u_coll.hide_render = True
            u_coll.hide_viewport = False
            if hasattr(u_coll, "color_tag"):
                u_coll.color_tag = UTILITY_COLOR_TAGS[system]
            u_coll["service"] = system
            u_coll["export_web_pbr"] = True
            utility_collections[system] = u_coll

            routes = utilities_data[system]["routes"]
            stations = utilities_data[system]["stations"]

            # Detect shared junction points across routes (within 1 cm) for tees / Abzweigdosen
            point_counts = defaultdict(list)
            for route in routes:
                for p in route["points_plan"]:
                    key = (round(p[0], 2), round(p[1], 2), round(p[2], 2))
                    point_counts[key].append((route["level"], route["radius"]))

            placed_junctions = set()

            for route in routes:
                lvl = route["level"]
                rad = route["radius"]
                pts = route["points_plan"]
                mark = route["mark"]
                rid = route["id"]
                rlbl = route["label"]
                p_mat = mat_water_pipe if system == "water" else mat_power_pipe

                # 1) Main swept pipe/conduit with smooth rounded bends
                p_obj = pipe_mesh(
                    u_coll,
                    f"{lvl.upper()} · {rlbl} ({rid})",
                    pts,
                    rad,
                    p_mat,
                    segments=8,
                    bend_radius=rad * 2.5,
                )
                tag_service(p_obj, system, lvl, rid, rlbl)

                # 2) Pipe couplings (Muffen) at interior bends & wall clamps (Wandschellen) along segments
                for i in range(len(pts) - 1):
                    p0, p1 = pts[i], pts[i + 1]
                    seg_vec = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
                    seg_len = math.sqrt(sum(c * c for c in seg_vec))
                    if seg_len < 0.04:
                        continue
                    u_dir = tuple(c / seg_len for c in seg_vec)

                    # Wall clamps spaced every ~1.20 m on runs >= 0.70 m
                    if seg_len >= 0.70:
                        n_clamps = max(1, int(seg_len // 1.25))
                        for ci in range(n_clamps):
                            t = (ci + 0.5) / n_clamps
                            c_mid = tuple(p0[k] + seg_vec[k] * t for k in range(3))
                            ca = tuple(c_mid[k] - u_dir[k] * 0.011 for k in range(3))
                            cb = tuple(c_mid[k] + u_dir[k] * 0.011 for k in range(3))
                            cl = cylinder_between(
                                u_coll,
                                f"Schelle · {rid} {i}.{ci}",
                                ca,
                                cb,
                                rad * 1.32,
                                mat_clamp,
                                segments=8,
                            )
                            tag_service(cl, system, lvl, rid)

                    # Muff collars near interior bends for water pipes
                    if system == "water" and i > 0 and seg_len > 0.10:
                        m_a = tuple(p0[k] + u_dir[k] * min(0.045, seg_len * 0.25) for k in range(3))
                        m_b = tuple(p0[k] + u_dir[k] * min(0.085, seg_len * 0.45) for k in range(3))
                        mf = cylinder_between(
                            u_coll,
                            f"Muffe · {rid} {i}",
                            m_a,
                            m_b,
                            rad * 1.30,
                            mat_water_muff,
                            segments=8,
                        )
                        tag_service(mf, system, lvl, rid)

                # 3) Fittings at shared T-junctions
                for p in pts:
                    pkey = (round(p[0], 2), round(p[1], 2), round(p[2], 2))
                    if len(point_counts[pkey]) >= 2 and pkey not in placed_junctions:
                        placed_junctions.add(pkey)
                        if system == "water":
                            # Brass T-fitting collar
                            j_obj = block(
                                u_coll,
                                f"T-Stück · {rid}",
                                p,
                                (rad * 3.1, rad * 3.1, rad * 3.1),
                                mat_brass,
                                bev=0.004,
                                bev_segs=1,
                            )
                            tag_service(j_obj, system, lvl, rid)
                        else:
                            # Electrical junction box (Abzweigdose)
                            jb = block(
                                u_coll,
                                f"Abzweigdose · {rid}",
                                p,
                                (0.072, 0.072, 0.044),
                                mat_power_box,
                                bev=0.004,
                                bev_segs=1,
                            )
                            tag_service(jb, system, lvl, rid)

                # 4) Terminal Valves (Trinkwasser) or Outlet/Light/Appliance Boxes (Strom)
                end_pt = pts[-1]
                prev_pt = pts[-2]
                if system == "water":
                    if mark == "outlet":
                        # Chrome angle stop valve (Eckventil) + red/blue shutoff grip
                        ev = cylinder_between(
                            u_coll,
                            f"Eckventil · {rid}",
                            (end_pt[0], end_pt[1], end_pt[2] - 0.028),
                            (end_pt[0], end_pt[1], end_pt[2] + 0.022),
                            0.019,
                            chrome,
                            segments=8,
                        )
                        tag_service(ev, system, lvl, rid, rlbl)
                        cap = block(
                            u_coll,
                            f"Ventilgriff · {rid}",
                            (end_pt[0] + 0.016, end_pt[1], end_pt[2] + 0.026),
                            (0.036, 0.014, 0.012),
                            mat_valve_red if "dusche" in rid or "spuele" in rid or "wb" in rid or "sink" in rid else mat_water_muff,
                        )
                        tag_service(cap, system, lvl, rid)
                    elif mark == "riser":
                        # Brass riser ball valve with red shutoff handle
                        mid_z = (pts[0][2] + end_pt[2]) / 2.0
                        bv = cylinder_between(
                            u_coll,
                            f"Absperrhahn Steigstrang · {rid}",
                            (end_pt[0], end_pt[1], mid_z - 0.038),
                            (end_pt[0], end_pt[1], mid_z + 0.038),
                            rad * 1.48,
                            mat_brass,
                            segments=8,
                        )
                        tag_service(bv, system, lvl, rid)
                        lv_h = block(
                            u_coll,
                            f"Hebel · {rid}",
                            (end_pt[0] + 0.042, end_pt[1], mid_z + 0.010),
                            (0.075, 0.014, 0.014),
                            mat_valve_red,
                        )
                        tag_service(lv_h, system, lvl, rid)
                else:
                    if mark == "outlet":
                        low_id = (rid + " " + rlbl).lower()
                        if "licht" in low_id:
                            # Ceiling light rose / lamp outlet box
                            rose = cylinder_between(
                                u_coll,
                                f"Lichtauslass · {rid}",
                                (end_pt[0], end_pt[1], end_pt[2] - 0.014),
                                (end_pt[0], end_pt[1], end_pt[2] + 0.016),
                                0.044,
                                mat_power_face,
                                segments=10,
                            )
                            tag_service(rose, system, lvl, rid, rlbl)
                        elif "steck" in low_id:
                            # Dual socket outlet box
                            sb = block(u_coll, f"Steckdose · {rid}", end_pt, (0.13, 0.045, 0.082), mat_power_face, bev=0.004, bev_segs=1)
                            tag_service(sb, system, lvl, rid, rlbl)
                            for du_s in (-0.032, 0.032):
                                ins = block(
                                    u_coll,
                                    f"Steckdose Einsatz · {rid}",
                                    (end_pt[0] + du_s, end_pt[1] + 0.018, end_pt[2]),
                                    (0.038, 0.016, 0.038),
                                    mat_power_box,
                                )
                                tag_service(ins, system, lvl, rid)
                        else:
                            # Heavy appliance / 400V junction box
                            ab = block(u_coll, f"Gerätedose · {rid}", end_pt, (0.092, 0.056, 0.092), mat_power_box, bev=0.005, bev_segs=1)
                            tag_service(ab, system, lvl, rid, rlbl)
                            af = block(
                                u_coll,
                                f"Gerätedose Deckel · {rid}",
                                (end_pt[0] + 0.004, end_pt[1], end_pt[2]),
                                (0.096, 0.022, 0.072),
                                mat_power_face,
                            )
                            tag_service(af, system, lvl, rid)
                _ = prev_pt

            # 5) Detailed Main Stations: Water Meter Block 'W' & Electrical Distribution Cabinet 'E'
            for st in stations:
                su, sv, sz = st["point_plan"]
                st_lvl = st["level"]
                st_id = st["id"]
                st_lbl = st["label"]

                if system == "water":
                    # Compact wall-mounted water meter assembly (clears adjacent WM/TR cleanly)
                    tag_service(
                        block(u_coll, f"Wasseranschluss Konsole · {st_id}", (su - 0.042, sv, sz), (0.022, 0.28, 0.26), mat_clamp, bev=0.003, bev_segs=1),
                        system, st_lvl, st_id, st_lbl,
                    )
                    # Horizontal brass water-meter rail + main shutoff valves
                    tag_service(
                        cylinder_between(u_coll, f"Wasserzähler Bügel · {st_id}", (su, sv - 0.125, sz), (su, sv + 0.125, sz), 0.022, mat_brass, segments=10),
                        system, st_lvl, st_id,
                    )
                    # Central cylindrical water meter housing + blue cap + glass dial
                    tag_service(
                        cylinder_between(u_coll, f"Wasserzähler Körper · {st_id}", (su, sv - 0.048, sz), (su, sv + 0.048, sz), 0.044, mat_brass, segments=12),
                        system, st_lvl, st_id, st_lbl,
                    )
                    tag_service(
                        cylinder_between(u_coll, f"Wasserzähler Zählwerk · {st_id}", (su + 0.018, sv, sz + 0.014), (su + 0.074, sv, sz + 0.014), 0.040, mat_water_pipe, segments=12),
                        system, st_lvl, st_id,
                    )
                    tag_service(
                        cylinder_between(u_coll, f"Wasserzähler Glas · {st_id}", (su + 0.072, sv, sz + 0.014), (su + 0.082, sv, sz + 0.014), 0.035, meter_glass, segments=12),
                        system, st_lvl, st_id,
                    )
                    # Two red main shutoff valves flanking the water meter (compact ±0.095 m)
                    for dv_v in (-0.095, 0.095):
                        tag_service(
                            cylinder_between(u_coll, f"Hauptabsperrventil · {st_id}", (su, sv + dv_v, sz), (su + 0.056, sv + dv_v, sz + 0.028), 0.011, mat_brass, segments=8),
                            system, st_lvl, st_id,
                        )
                        tag_service(
                            cylinder_between(u_coll, f"Handrad · {st_id}", (su + 0.052, sv + dv_v, sz + 0.026), (su + 0.065, sv + dv_v, sz + 0.032), 0.028, mat_valve_red, segments=10),
                            system, st_lvl, st_id,
                        )
                    # Distribution manifold bar above water meter with 3 branch valves
                    tag_service(
                        cylinder_between(u_coll, f"Verteilerbalken · {st_id}", (su, sv - 0.115, sz + 0.13), (su, sv + 0.115, sz + 0.13), 0.020, chrome, segments=10),
                        system, st_lvl, st_id,
                    )
                    for dv_b in (-0.075, 0.0, 0.075):
                        tag_service(
                            block(u_coll, f"Abgangsventil · {st_id}", (su + 0.026, sv + dv_b, sz + 0.13), (0.032, 0.018, 0.044), mat_water_muff),
                            system, st_lvl, st_id,
                        )
                else:
                    # Detailed Electrical Distribution Cabinet / Zählerschrank 'E' in HWR
                    # Auto-fit width cleanly between HWR street window (F_eg_s1) and shelf (eg_regal)
                    win_v1 = 2.20
                    if isinstance(spec_data, dict):
                        for op in (spec_data.get("levels", {}).get("eg", {}).get("openings") or ()):
                            if op.get("id") == "F_eg_s1":
                                win_v1 = float(op["s1"])
                                break
                    regal = spec_furn_eg.get("eg_regal")
                    regal_v0 = float(regal["v0"]) if regal else 2.50
                    max_half_v = min(max(sv - win_v1 - 0.01, 0.11), max(regal_v0 - sv - 0.01, 0.11))
                    cab_w = max(0.24, min(0.32, 2.0 * max_half_v))
                    cab_d, cab_h = 0.14, 0.66
                    cab_u = su + 0.015
                    # Outer powder-coated steel enclosure
                    tag_service(
                        block(u_coll, f"Zählerschrank Gehäuse · {st_id}", (cab_u, sv, sz), (cab_d, cab_w, cab_h), mat_cabinet, bev=0.008, bev_segs=2),
                        system, st_lvl, st_id, st_lbl,
                    )
                    # Recessed dark inner mounting panel on room-facing (+u) side
                    front_u = cab_u + cab_d / 2.0
                    tag_service(
                        block(u_coll, f"Zählerschrank Feld · {st_id}", (front_u + 0.002, sv, sz), (0.012, cab_w - 0.045, cab_h - 0.07), mat_cabinet_inner),
                        system, st_lvl, st_id,
                    )
                    # 3 horizontal DIN rails (Hutschienen) + rows of miniature circuit breakers (LS-Schalter / FI)
                    for row_i, dz_r in enumerate((0.17, 0.045, -0.08)):
                        rz = sz + dz_r
                        tag_service(
                            block(u_coll, f"Hutschiene {row_i + 1} · {st_id}", (front_u + 0.010, sv, rz), (0.010, cab_w - 0.065, 0.022), chrome),
                            system, st_lvl, st_id,
                        )
                        n_mods = 5 if cab_w < 0.28 else 6
                        mod_w = (cab_w - 0.072) / n_mods
                        for mi in range(n_mods):
                            mv = sv - (cab_w - 0.072) / 2.0 + (mi + 0.5) * mod_w
                            tag_service(
                                block(u_coll, f"LS-Schalter {row_i + 1}.{mi + 1}", (front_u + 0.022, mv, rz), (0.026, mod_w - 0.004, 0.068), mat_breaker),
                                system, st_lvl, st_id,
                            )
                            tog_mat = mat_valve_red if (row_i == 0 and mi == 0) else (mat_breaker_blue if mi in (0, 1) else mat_power_pipe)
                            tag_service(
                                block(u_coll, f"Schaltknebel {row_i + 1}.{mi + 1}", (front_u + 0.037, mv, rz + 0.006), (0.011, mod_w * 0.55, 0.013), tog_mat),
                                system, st_lvl, st_id,
                            )
                    # Digital electricity meter window in lower section
                    tag_service(
                        block(u_coll, f"Stromzähler · {st_id}", (front_u + 0.020, sv, sz - 0.22), (0.024, 0.17, 0.13), mat_breaker, bev=0.004, bev_segs=1),
                        system, st_lvl, st_id,
                    )
                    tag_service(
                        block(u_coll, f"Zählerdisplay · {st_id}", (front_u + 0.034, sv, sz - 0.20), (0.006, 0.10, 0.042), dark),
                        system, st_lvl, st_id,
                    )
                    # Top & bottom cable entry glands
                    for dz_g in (-cab_h / 2.0 - 0.014, cab_h / 2.0 + 0.014):
                        tag_service(
                            cylinder_between(
                                u_coll,
                                f"Kabelverschraubung · {st_id}",
                                (su, sv, sz + dz_g - 0.014),
                                (su, sv, sz + dz_g + 0.014),
                                0.026,
                                mat_clamp,
                                segments=8,
                            ),
                            system, st_lvl, st_id,
                        )

    # ------------------------------------------------------------------
    # Physically-Based Daylight World (Cycles MULTIPLE_SCATTERING Sky) & Interior Fills
    # ------------------------------------------------------------------
    world = bpy.data.worlds.new("Tageslicht")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    w_nodes = world.node_tree.nodes
    w_links = world.node_tree.links
    w_nodes.clear()
    sky = w_nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = True
    sky.sun_size = math.radians(1.1)
    sky.sun_intensity = 0.65
    # Warm afternoon sun raking diagonally across Garten gable, roof tiles & Hof/Kanal overhang
    sky.sun_elevation = math.radians(33.0)
    sky.sun_rotation = math.radians(205.0)
    sky.air_density = 1.25
    sky.aerosol_density = 1.35
    sky.ozone_density = 1.30
    bg = w_nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.11
    w_out = w_nodes.new("ShaderNodeOutputWorld")
    w_links.new(sky.outputs["Color"], bg.inputs["Color"])
    w_links.new(bg.outputs["Background"], w_out.inputs["Surface"])

    # Gentle invisible window daylight bounce fills (balanced so real sunlight & sky modeling shine!)
    for obj in list(original):
        if obj.type != "MESH" or not obj.active_material or obj.active_material.name != "Fensterglas":
            continue
        parent_name = obj.parent.name if obj.parent else ""
        if parent_name not in ("eg_ext_north", "og_ext_north", "eg_ext_east", "og_ext_east"):
            continue
        box = world_plan_bbox([obj])
        if not box:
            continue
        u0, v0, u1, v1, z0, z1 = box
        zc = (z0 + z1) / 2.0
        zh = max(z1 - z0, 0.65)
        if parent_name.endswith("_north"):
            vc = (v0 + v1) / 2.0
            vw = max(v1 - v0, 0.55)
            fill = light(
                "Tageslicht durch Gartenfenster",
                pt(L - T_EXT - 0.055, vc, zc),
                pt(L * 0.36, vc + 0.15, zc - 0.55),
                32,
                (0.86, 0.93, 1.0),
                vw,
            )
            fill.data.shape = "RECTANGLE"
            fill.data.size = vw
            fill.data.size_y = min(zh, 1.45)
        else:
            uc = (u0 + u1) / 2.0
            uw = max(u1 - u0, 0.55)
            fill = light(
                "Tageslicht durch Hoffenster",
                pt(uc, W - T_EXT - 0.045, zc),
                pt(uc - 0.25, W * 0.22, zc - 0.55),
                28,
                (0.88, 0.94, 1.0),
                uw,
            )
            fill.data.shape = "RECTANGLE"
            fill.data.size = uw
            fill.data.size_y = min(zh, 1.20)
        fill.visible_camera = False
        fill.visible_glossy = False
        fill.visible_transmission = False

    # Subtle indirect ceiling bounce in EG and OG to prevent dark noisy corners without flattening shadows
    for z_fl, code, pwr in [(okff_eg, "EG", 42), (okff_og, "OG", 36)]:
        bounce = light(
            "Indirektes Raumlicht " + code,
            pt(L * 0.60, W * 0.44, z_fl + 1.80),
            pt(L * 0.56, W * 0.46, z_fl + 2.60),
            pwr,
            (0.95, 0.97, 1.0),
            2.6,
        )
        bounce.visible_camera = False
        bounce.visible_glossy = False
        bounce.visible_transmission = False

    # ------------------------------------------------------------------
    # Smooth Architectural Site Ground & Studio Backdrop
    # ------------------------------------------------------------------
    groundmat = textured(
        "Studio · mineralischer Boden",
        "9f9a8c",
        "b9b4a5",
        2.8,
        rough=0.95,
        relief=0.0014,
        bump_strength=0.22,
        detail=5.5,
    )
    if terrain_data is not None:
        cols = int(terrain_data["cols"])
        rows = int(terrain_data["rows"])
        spacing = float(terrain_data["step"])
        x_start = float(terrain_data["xStart"])
        z_start = float(terrain_data["zStart"])
        t_heights = terrain_data["heights"]
        verts = []
        for j in range(rows):
            for i in range(cols):
                bx = x_start + spacing * i
                by = -z_start - spacing * j
                bz = float(t_heights[j * cols + i]) - 0.025
                # Keep interior footprint below floor slab / split-level pit so terrain never clips inside rooms!
                pu, pv, _ = inv_pt(bx, by, bz)
                if 0.18 <= pu <= L - 0.18 and 0.18 <= pv <= W - 0.18:
                    bz = min(bz, -plinth_depth + 0.15)
                verts.append((bx, by, bz))
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
        floor_z = -max(plinth_depth, 2.05) - 0.04
        for idx in ring:
            x, y, _ = verts[idx]
            outer.append(len(verts))
            verts.append((x * 2.4, y * 2.4, floor_z))
        for i, a in enumerate(ring):
            j = (i + 1) % len(ring)
            faces.append((a, ring[j], outer[j], outer[i]))
        terrain_obj = link_mesh("Gelände am Haus", verts, faces, groundmat, studio)
        for f in terrain_obj.data.polygons:
            f.use_smooth = True

    studio_z = -max(plinth_depth, 2.05) - 0.08
    block(studio, "Studioboden", (L / 2.0, W / 2.0, studio_z), (1500, 1500, 0.08), groundmat)

    # ------------------------------------------------------------------
    # Data-Driven Collision-Free Cameras
    # ------------------------------------------------------------------
    def make_camera(name, loc, target, pano=False, lens=32):
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        rig.objects.link(cam)
        cam.location = loc
        aim(cam, target)
        cam.data.lens = lens
        cam.data.clip_start = 0.035
        cam.data.clip_end = 2000
        if pano:
            cam.data.type = "PANO"
            cam.data.panorama_type = "EQUIRECTANGULAR"
        return cam

    solid_obstacles = []
    for coll_key in ("eg", "og", "treppe", "treppeEg", "treppeOg"):
        for obj in collections[coll_key].objects:
            if obj.type != "MESH":
                continue
            if obj.name.startswith(("Fußboden", "Bodenfliese", "Wollteppich", "Sockelleiste", "Leinenvorhang")):
                continue
            box = world_plan_bbox([obj])
            if box:
                solid_obstacles.append(
                    {"label": f"{coll_key}:{obj.name}", "box": (box[0], box[1], box[4], box[2], box[3], box[5])}
                )

    # EG panorama & perspective camera: positioned near HWR/entry looking diagonally across the wide open
    # sunlit oak space toward the glazed garden door, garden windows, Hof sunbeams, and U-staircase!
    eg_pref = (round(max(hwr_right_u + 1.15, 4.55), 3), round(min(2.25, W * 0.32), 3), round(okff_eg + 1.52, 3))
    eg_bounds = (max(hwr_right_u + 0.65, 3.90), L - T_EXT - 0.65, T_EXT + 0.65, min(stair_v0 - 0.55, W - T_EXT - 0.65))
    eg_loc = _find_safe_camera_pos(eg_pref, solid_obstacles, eg_bounds, min_clearance=0.40)
    eg_target = (round(L - 1.10, 3), round(min(3.55, W * 0.50), 3), round(okff_eg + 1.44, 3))

    # OG panorama & perspective camera: open heart of Wohnküche framing BOTH kitchen runs, hall door & dining
    og_pref_u = max(kitchen_u1 + 2.55, min(sofa_u0_min - 0.78, 7.25))
    og_pref_v = max(T_EXT + 1.35, min(esstisch_box[1] - 1.10, 3.15))
    og_pref = (round(og_pref_u, 3), round(og_pref_v, 3), round(okff_og + 1.52, 3))
    og_bounds = (kitchen_u1 + 0.85, max(sofa_u0_min - 0.55, kitchen_u1 + 1.80), T_EXT + 0.70, max(esstisch_box[1] - 0.55, T_EXT + 1.40))
    og_loc = _find_safe_camera_pos(og_pref, solid_obstacles, og_bounds, min_clearance=0.40)
    og_target = (round(kitchen_u1 - 0.15, 3), round(W * 0.50, 3), round(okff_og + 1.44, 3))

    render_cam_defs = [
        {"key": "eg", "label": "Erdgeschoss · Offener Raum", "plan_loc": eg_loc, "plan_target": eg_target, "pano": True, "interior": True},
        {"key": "og", "label": "Obergeschoss · Wohnküche", "plan_loc": og_loc, "plan_target": og_target, "pano": True, "interior": True},
    ]

    cams_ok, clearance_report = check_camera_clearances(render_cam_defs, solid_obstacles, min_clearance=0.28)
    for entry in clearance_report:
        print("CAMERA_CLEARANCE", json.dumps(entry, ensure_ascii=False), flush=True)
    if not cams_ok:
        raise RuntimeError(f"Kamera-Kollision erkannt: {clearance_report}")

    outside = make_camera("Außenansicht", (17.6, -13.0, 7.9), (0.0, 0.0, okff_og + 0.15), pano=False, lens=41)
    cams = {"aussen": outside}
    for spec_cam in render_cam_defs:
        cams[spec_cam["key"]] = make_camera(
            spec_cam["label"],
            pt(*spec_cam["plan_loc"]),
            pt(*spec_cam["plan_target"]),
            pano=spec_cam["pano"],
        )

    # ------------------------------------------------------------------
    # View Layers (Haus komplett, EG, OG, Installationen)
    # ------------------------------------------------------------------
    main_layer = scene.view_layers[0]
    main_layer.name = "Haus komplett"

    for name, hide in [
        ("EG freigelegt", ["og", "deckeOg", "deckeEg", "dach", "treppeOg"]),
        ("OG freigelegt", ["dach", "deckeOg"]),
    ]:
        layer = scene.view_layers.new(name)
        for k in hide:
            layer.layer_collection.children[collections[k].name].exclude = True
        layer.layer_collection.children[studio.name].exclude = True
        layer.use = False

    inst_layer = scene.view_layers.new("Installationen · Wasser & Strom")
    for k in ("dach", "deckeOg"):
        inst_layer.layer_collection.children[collections[k].name].exclude = True
    inst_layer.layer_collection.children[studio.name].exclude = True
    inst_layer.use = False

    # Keep utility collections hidden in standard architectural view layers & renders,
    # visible in the dedicated "Installationen · Wasser & Strom" view layer.
    for u_coll in utility_collections.values():
        for layer in scene.view_layers:
            lc = layer.layer_collection.children.get(u_coll.name)
            if lc is not None:
                lc.exclude = False
                lc.hide_viewport = layer != inst_layer

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
    if not args.preview or args.save_blend:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.context.window.view_layer = scene.view_layers["EG freigelegt"]
        bpy.ops.wm.save_as_mainfile(filepath=str(out / "Wohnhaus-214.blend"), compress=True)
        bpy.context.window.view_layer = main_layer

    # ------------------------------------------------------------------
    # Render Architectural Exterior, 360° Panoramas & Perspective Stills
    # ------------------------------------------------------------------
    for key, cam in cams.items():
        scene.camera = cam
        scene.view_settings.exposure = -0.38 if key == "aussen" else 0.48
        if key == "aussen":
            w_res, h_res = (900, 600) if args.preview else (1800, 1200)
        else:
            w_res, h_res = (1200, 600) if args.preview else (4096, 2048)
        scene.render.resolution_x, scene.render.resolution_y = w_res, h_res
        scene.render.filepath = str(out / (key + ".webp"))
        bpy.ops.render.render(write_still=True, layer=main_layer.name)
        if key != "aussen":
            pano_rot = cam.rotation_euler.to_quaternion()
            ahead = pano_rot @ Vector((0, 0, -1))
            cam.data.type = "PERSP"
            cam.data.lens = 21 if key == "og" else 22
            aim(cam, cam.location + ahead + Vector((0, 0, -0.105)))
            scene.render.resolution_x, scene.render.resolution_y = (
                (900, 560) if args.preview else (1500, 940)
            )
            scene.render.filepath = str(out / (key + "-blick.webp"))
            bpy.ops.render.render(write_still=True, layer=main_layer.name)
        print("RENDERED", key, w_res, h_res, flush=True)

    # ------------------------------------------------------------------
    # Optional Diagnostic Renders with Trinkwasser & Strom Visible
    # ------------------------------------------------------------------
    if args.render_utilities and utility_collections:
        u_out = args.render_utilities.resolve()
        u_out.mkdir(parents=True, exist_ok=True)
        for u_coll in utility_collections.values():
            u_coll.hide_render = False
            u_coll.hide_viewport = False
            lc = inst_layer.layer_collection.children.get(u_coll.name)
            if lc is not None:
                lc.hide_viewport = False
        inst_layer.use = True
        scene.cycles.samples = 32
        scene.view_settings.exposure = -0.38

        # 1) Cutaway 3D overview from above showing OG + EG + site utility routing
        util_cam = make_camera(
            "Leitungen Übersicht",
            pt(-3.6, 11.8, 10.6),
            pt(3.8, 2.8, 2.0),
            pano=False,
            lens=34,
        )
        # Temporarily hide frontCut exterior walls & wall-mounted fixtures for crystal-clear cutaway view
        hidden_cut = []
        for obj in scene.objects:
            should_hide = bool(obj.get("frontCut", False))
            if not should_hide:
                anc = obj
                while anc:
                    if anc.name in {"eg_ext_east", "eg_ext_south", "og_ext_east", "og_ext_south"}:
                        should_hide = True
                        break
                    anc = anc.parent
            if should_hide and not obj.hide_render:
                obj.hide_render = True
                hidden_cut.append(obj)
        scene.camera = util_cam
        scene.render.resolution_x, scene.render.resolution_y = 1400, 920
        scene.render.filepath = str(u_out / "leitungen-uebersicht.webp")
        bpy.ops.render.render(write_still=True, layer=inst_layer.name)
        print("RENDERED_UTILITIES", u_out / "leitungen-uebersicht.webp", flush=True)

        # Restore exterior walls BEFORE HWR interior close-up so W & E sit cleanly on plastered wall!
        for obj in hidden_cut:
            obj.hide_render = False

        # 2) Close-up inside HWR showing Water Meter 'W' & Distribution Cabinet 'E'
        hwr_cam = make_camera(
            "HWR Hausanschluss",
            pt(2.55, 1.85, 1.25),
            pt(0.45, 1.78, 1.05),
            pano=False,
            lens=24,
        )
        hwr_fill = light("HWR Prüflicht", pt(2.0, 1.8, 2.3), pt(0.5, 1.8, 1.0), 42, (0.98, 0.99, 1.0), 1.4)
        hwr_fill.visible_camera = False
        hwr_fill.visible_glossy = False
        hwr_fill.visible_transmission = False
        scene.camera = hwr_cam
        scene.view_settings.exposure = 0.55
        scene.render.resolution_x, scene.render.resolution_y = 1200, 820
        scene.render.filepath = str(u_out / "leitungen-hwr.webp")
        bpy.ops.render.render(write_still=True, layer=inst_layer.name)
        print("RENDERED_UTILITIES", u_out / "leitungen-hwr.webp", flush=True)

        for u_coll in utility_collections.values():
            u_coll.hide_render = True


if __name__ == "__main__":
    main()
