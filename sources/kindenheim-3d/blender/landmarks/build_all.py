#!/usr/bin/env python3
"""
Master orchestrator for Kindenheim Hero Landmarks.
Run via Blender:
  /opt/homebrew/bin/blender --background --python blender/landmarks/build_all.py -- [--prototype] [--no-render]

Modes:
  --prototype : Build & render all 5 landmarks with default Kindenheim architectural dimensions
                (useful before kindenheim_scene.json is available, for visual QA).
  (default)   : Read data/osm/kindenheim_scene.json, match the 5 real Kindenheim OSM landmark
                buildings (and cluster/exclude overlapping sub-footprints cleanly), build all 5
                .blend + .glb models matched to real footprint dimensions & street orientation,
                render 1280x720 Cycles previews, and write public/assets/models/landmarks/manifest.json.
"""

import json
import math
import sys
from pathlib import Path

# Ensure sibling modules import cleanly when invoked via `blender --python`
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import importlib

# Builders are imported lazily (module, function) so that `--only a,b` never imports — and therefore never
# breaks on — a builder script another person is editing at the same moment.
_BUILDERS = {
    "evangelische_kirche": ("build_kirche", "build_kirche"),
    "rathaus": ("build_rathaus", "build_rathaus"),
    "weingut_estate": ("build_weingut", "build_weingut"),
    "winzerhof_barn": ("build_winzerhof", "build_winzerhof"),
    "agri_halle": ("build_agri_halle", "build_agri_halle"),
}


def _lazy_builder(key: str):
    module_name, fn_name = _BUILDERS[key]

    def run(*args, **kwargs):
        return getattr(importlib.import_module(module_name), fn_name)(*args, **kwargs)

    run.__name__ = fn_name
    return run


build_kirche = _lazy_builder("evangelische_kirche")
build_rathaus = _lazy_builder("rathaus")
build_weingut = _lazy_builder("weingut_estate")
build_winzerhof = _lazy_builder("winzerhof_barn")
build_agri_halle = _lazy_builder("agri_halle")

PROJECT_ROOT = SCRIPT_DIR.parent.parent
SCENE_JSON = PROJECT_ROOT / "data" / "osm" / "kindenheim_scene.json"
MANIFEST_OUT = PROJECT_ROOT / "public" / "assets" / "models" / "landmarks" / "manifest.json"
OVERRIDES_JSON = SCRIPT_DIR / "landmark_overrides.json"


def load_overrides() -> dict:
    if OVERRIDES_JSON.exists():
        with open(OVERRIDES_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def compute_obb_from_footprint(footprint: list[list[float]]):
    """
    Compute minimum-area / longest-edge-aligned oriented bounding box in Three.js XZ plane
    (+X = East, -Z = North, +Z = South).
    Returns (center_x, center_z, length_along_local_x, depth_along_local_z, rot_y_rad).
    Under Three.js rotation.y = rot_y_rad:
      local (lx, 0, lz) -> world (cx + lx*cos(ry) + lz*sin(ry), cx_z - lx*sin(ry) + lz*cos(ry))
    """
    pts = [(float(p[0]), float(p[1])) for p in footprint]
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return 0.0, 0.0, 12.0, 8.0, 0.0

    best = None
    n = len(pts)
    for i in range(n):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % n]
        dx, dz = x1 - x0, z1 - z0
        el = math.hypot(dx, dz)
        if el < 1e-4:
            continue
        # Local +X axis along edge (dx, dz): in Three.js rotateY(ry), local (1,0,0) -> (cos ry, 0, -sin ry)
        # So cos(ry) = dx/el, -sin(ry) = dz/el => ry = atan2(-dz, dx)
        ry = math.atan2(-dz, dx)
        cr, sr = math.cos(ry), math.sin(ry)
        # Inverse rotate world (x, z) into local (lx, lz):
        # lx = x*cr - z*sr ; lz = x*sr + z*cr
        lxs = [p[0] * cr - p[1] * sr for p in pts]
        lzs = [p[0] * sr + p[1] * cr for p in pts]
        min_x, max_x = min(lxs), max(lxs)
        min_z, max_z = min(lzs), max(lzs)
        w = max_x - min_x
        d = max_z - min_z
        area = w * d
        if best is None or area < best[0]:
            lcx = (min_x + max_x) * 0.5
            lcz = (min_z + max_z) * 0.5
            # Transform local center back to world XZ
            wcx = lcx * cr + lcz * sr
            wcz = -lcx * sr + lcz * cr
            best = (area, wcx, wcz, w, d, ry)

    _, cx, cz, w, d, ry = best
    # Ensure length (local X) >= depth (local Z) for clean gabled ridge alignment
    if d > w:
        w, d = d, w
        ry += math.pi * 0.5
    # Normalize ry to (-pi, pi]
    ry = (ry + math.pi) % (2.0 * math.pi) - math.pi
    return cx, cz, w, d, ry


def select_landmarks_from_scene(scene_data: dict, overrides: dict) -> list[dict]:
    """
    Match the 5 Kindenheim hero landmarks against real buildings in data/osm/kindenheim_scene.json.
    Supports explicit OSM ID pinning in landmark_overrides.json for 100% precision.
    """
    buildings = scene_data.get("buildings", [])
    by_id = {str(b.get("id")): b for b in buildings}
    used_ids: set[str] = set()
    selected = []

    def dist2(b, tx, tz):
        c = b.get("center", [0, 0])
        return (c[0] - tx) ** 2 + (c[1] - tz) ** 2

    def addr_str(b):
        addr = b.get("addr") or ""
        if isinstance(addr, dict):
            return f"{addr.get('street', '')} {addr.get('housenumber', '')}".lower()
        return str(addr).lower()

    def pick(slot_key, label, glb_file, builder_fn, matcher_fn, fallback_sort_fn):
        ov = overrides.get(slot_key, {})
        pinned_id = ov.get("osmId")
        extra_exclude = [str(x) for x in ov.get("extraOsmIds", [])]
        chosen = None
        if pinned_id and str(pinned_id) in by_id:
            chosen = by_id[str(pinned_id)]
        else:
            candidates = [b for b in buildings if str(b.get("id")) not in used_ids and matcher_fn(b)]
            if not candidates:
                candidates = [b for b in buildings if str(b.get("id")) not in used_ids]
            candidates.sort(key=fallback_sort_fn)
            if candidates:
                chosen = candidates[0]

        if chosen is None:
            raise RuntimeError(f"Could not match building for landmark slot {slot_key}")

        cid = str(chosen["id"])
        osm_ids = [cid] + [x for x in extra_exclude if x != cid]
        for x in osm_ids:
            used_ids.add(x)

        # Use @geodata's exact pre-computed OBB center, dimensions, and rotationRad directly
        # (guaranteed consistent with tower.offsetFromNaveCenter and terrain baseElevationM!)
        if chosen.get("center") and chosen.get("widthM") and chosen.get("depthM") and ("rotationRad" in chosen):
            cx, cz = float(chosen["center"][0]), float(chosen["center"][1])
            obb_w = float(chosen["widthM"])
            obb_d = float(chosen["depthM"])
            ry = float(chosen["rotationRad"])
        else:
            fp = chosen.get("footprint")
            if fp and len(fp) >= 3:
                cx, cz, obb_w, obb_d, ry = compute_obb_from_footprint(fp)
            else:
                cx, cz, obb_w, obb_d, ry = 0.0, 0.0, 15.0, 10.0, 0.0

        # Apply optional rotation flip (+pi) or fine rotation offset from overrides (to face street!)
        ry += float(ov.get("rotationOffsetRad", 0.0))
        ry = (ry + math.pi) % (2.0 * math.pi) - math.pi

        selected.append({
            "key": slot_key,
            "name": ov.get("name") or chosen.get("name") or label,
            "glbFile": glb_file,
            "glbPath": f"/assets/models/landmarks/{glb_file}",
            "builder": builder_fn,
            "osmIds": osm_ids,
            "primaryOsmId": cid,
            "center": [round(cx, 3), round(cz, 3)],
            "baseElevationM": round(float(chosen.get("baseElevationM", 0.0)), 3),
            "rotationRad": round(ry, 5),
            "footprintWidthM": round(obb_w, 2),
            "footprintDepthM": round(obb_d, 2),
            "rawBuilding": chosen,
            "paramsOverride": ov.get("params", {}),
        })

    # 1. Evangelische Kirche (Martinskirche, Hauptstraße 56)
    pick(
        "evangelische_kirche", "Evangelische Kirche Kindenheim (Martinskirche)", "evangelische_kirche.glb",
        build_kirche,
        lambda b: (
            b.get("landmarkKey") == "evangelische_kirche"
            or "kirche" in str(b.get("name", "")).lower()
            or b.get("category") in ("church", "religious")
            or "hauptstraße 56" in addr_str(b) or "hauptstrasse 56" in addr_str(b)
        ),
        lambda b: (0 if "kirche" in str(b.get("name", "")).lower() else 1, -float(b.get("widthM", 0)) * float(b.get("depthM", 0)))
    )

    # 2. Rathaus / Gemeindehaus (Hauptstraße 77)
    pick(
        "rathaus", "Rathaus / Gemeindehaus Kindenheim", "rathaus.glb",
        build_rathaus,
        lambda b: (
            b.get("landmarkKey") == "rathaus"
            or "rathaus" in str(b.get("name", "")).lower()
            or "gemeindehaus" in str(b.get("name", "")).lower()
            or b.get("category") in ("civic", "public", "townhall")
            or "hauptstraße 77" in addr_str(b) or "hauptstrasse 77" in addr_str(b)
        ),
        lambda b: (0 if "77" in addr_str(b) else 1, dist2(b, 0, 0))
    )

    # 3. Historic Pfalz Weingut (Winery courtyard ensemble along Hauptstraße)
    pick(
        "weingut_estate", "Historisches Weingut Kindenheim", "weingut_estate.glb",
        build_weingut,
        lambda b: (
            str(b.get("landmarkKey", "")).startswith("weingut")
            or "weingut" in str(b.get("name", "")).lower()
            or ("haupt" in addr_str(b) and float(b.get("widthM", 0)) * float(b.get("depthM", 0)) >= 140)
        ),
        lambda b: (0 if "weingut" in str(b.get("name", "")).lower() else 1, abs(float(b.get("widthM", 18)) * float(b.get("depthM", 12)) - 260))
    )

    # 4. Traditional Pfalz Winzerhof / Bauernhof with large Scheune
    pick(
        "winzerhof_barn", "Pfälzer Winzerhof & Fachwerkscheune", "winzerhof_barn.glb",
        build_winzerhof,
        lambda b: (
            str(b.get("landmarkKey", "")).startswith("bauernhof")
            or str(b.get("landmarkKey", "")).startswith("winzerhof")
            or b.get("category") in ("barn", "farm", "farm_auxiliary", "agricultural")
            or float(b.get("widthM", 0)) * float(b.get("depthM", 0)) >= 160
        ),
        lambda b: (0 if b.get("category") in ("barn", "farm", "farm_auxiliary") else 1, abs(float(b.get("widthM", 18)) * float(b.get("depthM", 12)) - 230))
    )

    # 5. Modern Rheinland-Pfalz Agricultural Machinery Hall (edge of village)
    pick(
        "agri_halle", "Landwirtschaftliche Maschinenhalle & Silos", "agri_halle.glb",
        build_agri_halle,
        lambda b: (
            str(b.get("landmarkKey", "")).startswith("halle")
            or b.get("category") in ("industrial", "warehouse", "agricultural", "shed", "barn")
            or float(b.get("widthM", 0)) * float(b.get("depthM", 0)) >= 250
        ),
        lambda b: (
            0 if b.get("category") in ("industrial", "warehouse", "agricultural") else 1,
            -math.hypot(b.get("center", [0, 0])[0], b.get("center", [0, 0])[1]) * 0.4 - float(b.get("widthM", 0)) * float(b.get("depthM", 0)) * 0.05
        )
    )

    return selected


COLLIDERS_OUT = PROJECT_ROOT / "public" / "assets" / "models" / "landmarks" / "colliders.json"


def write_colliders(entry: dict):
    """
    Read-modify-write this landmark's key in colliders.json (contract: .gfx/review/FIXROUND.md):
        { "<key>": { "replaceFootprint": bool, "solids": [ [[x, z], ...], ... ] } }   world space, metres.
    The builder module publishes its solids in its own Blender frame as COLLIDER_SOLIDS (x east, y north of
    the GLB origin). Builders without that attribute (other owners write their keys themselves) are skipped.
    """
    module_name, _fn = _BUILDERS[entry["key"]]
    solids_local = getattr(importlib.import_module(module_name), "COLLIDER_SOLIDS", None)
    if solids_local is None:
        return
    if not solids_local:
        raise RuntimeError(f"{module_name}.COLLIDER_SOLIDS is empty after building {entry['key']}")
    cx, cz = entry["center"]
    ry = entry["rotationRad"]
    c, s_ = math.cos(ry), math.sin(ry)
    solids = []
    for poly in solids_local:
        if len(poly) < 3:
            raise RuntimeError(f"{entry['key']}: collider polygon with fewer than 3 points: {poly}")
        # Blender (bx, by) -> three local (bx, -by) -> world: x = cx + lx cos + lz sin ; z = cz - lx sin + lz cos
        solids.append([[round(cx + bx * c + (-by) * s_, 3), round(cz - bx * s_ + (-by) * c, 3)] for bx, by in poly])
    data = {}
    if COLLIDERS_OUT.exists():
        with open(COLLIDERS_OUT, "r", encoding="utf-8") as f:
            data = json.load(f)
    data[entry["key"]] = {"replaceFootprint": True, "solids": solids}
    tmp = COLLIDERS_OUT.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    tmp.replace(COLLIDERS_OUT)
    print(f"Wrote {len(solids)} collider solids for {entry['key']} -> {COLLIDERS_OUT.name}")


def build_params_for_slot(entry: dict) -> dict:
    """Derive clean, architecturally proportioned build parameters matching the real OSM footprint."""
    key = entry["key"]
    w = max(8.0, entry["footprintWidthM"])
    d = max(6.0, entry["footprintDepthM"])
    raw = entry.get("rawBuilding", {})
    ov = entry.get("paramsOverride", {})

    if key == "evangelische_kirche":
        p = {
            "total_length": min(max(w, 19.0), 32.0),
            "nave_width": min(max(d, 8.8), 14.0),
            "nave_eave_h": max(6.8, float(raw.get("wallHeightM", 7.6))),
            "tower_size": min(max(d * 0.45, 4.4), 6.0),
        }
    elif key == "rathaus":
        p = {
            "length_x": min(max(w, 12.0), 22.0),
            "depth_y": min(max(d, 8.0), 14.5),
            "wall_h": max(6.2, float(raw.get("wallHeightM", 7.1))),
        }
    elif key == "weingut_estate":
        p = {
            "length_x": min(max(w, 15.0), 26.0),
            "depth_y": min(max(d, 11.0), 20.0),
        }
    elif key == "winzerhof_barn":
        p = {
            "length_x": min(max(w, 14.0), 24.0),
            "depth_y": min(max(d, 10.5), 19.0),
        }
    elif key == "agri_halle":
        p = {
            "length_x": min(max(w, 18.0), 34.0),
            "depth_y": min(max(d, 10.5), 20.0),
        }
    else:
        p = {}

    p.update(ov)
    return p


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    prototype = "--prototype" in argv or (not SCENE_JSON.exists())
    do_render = "--no-render" not in argv
    # --only key1,key2 : rebuild just these landmark keys (manifest is still written for all five,
    # so two people can iterate on different landmarks without rebuilding each other's models).
    only = None
    if "--only" in argv:
        only = {k.strip() for k in argv[argv.index("--only") + 1].split(",") if k.strip()}
        known = {"evangelische_kirche", "rathaus", "weingut_estate", "winzerhof_barn", "agri_halle"}
        unknown = only - known
        if unknown:
            raise SystemExit(f"--only: unknown landmark key(s) {sorted(unknown)}; valid: {sorted(known)}")

    if prototype:
        print("=== PROTOTYPE MODE: Building & rendering all 5 Kindenheim Hero Landmarks ===")
        overrides = load_overrides()
        build_kirche(overrides.get("evangelische_kirche", {}).get("params"), do_render=do_render, do_export=True)
        build_rathaus(overrides.get("rathaus", {}).get("params"), do_render=do_render, do_export=True)
        build_weingut(overrides.get("weingut_estate", {}).get("params"), do_render=do_render, do_export=True)
        build_winzerhof(overrides.get("winzerhof_barn", {}).get("params"), do_render=do_render, do_export=True)
        build_agri_halle(overrides.get("agri_halle", {}).get("params"), do_render=do_render, do_export=True)
        print("=== Prototype build complete! ===")
        return

    print(f"=== SCENE-ALIGNED MODE: Reading {SCENE_JSON} ===")
    with open(SCENE_JSON, "r", encoding="utf-8") as f:
        scene_data = json.load(f)

    overrides = load_overrides()
    selected = select_landmarks_from_scene(scene_data, overrides)

    manifest_landmarks = []
    all_excluded_ids = []

    for entry in selected:
        params = build_params_for_slot(entry)
        if only is not None and entry["key"] not in only:
            print(f"Skipping build of {entry['key']} (--only {sorted(only)})")
        else:
            print(f"Building {entry['key']} (OSM IDs={entry['osmIds']}, footprint={entry['footprintWidthM']}x{entry['footprintDepthM']}m, rot={math.degrees(entry['rotationRad']):.1f}deg)")
            entry["builder"](params, do_render=do_render, do_export=True)
            write_colliders(entry)
        all_excluded_ids.extend(entry["osmIds"])
        manifest_landmarks.append({
            "key": entry["key"],
            "name": entry["name"],
            "osmIds": entry["osmIds"],
            "primaryOsmId": entry["primaryOsmId"],
            "center": entry["center"],
            "baseElevationM": entry["baseElevationM"],
            "rotationRad": entry["rotationRad"],
            "footprintWidthM": entry["footprintWidthM"],
            "footprintDepthM": entry["footprintDepthM"],
            "foundationSkirtDepthM": 1.6,
            "glbPath": entry["glbPath"],
            "blendSource": f"blender/landmarks/{entry['key']}.blend",
        })

    MANIFEST_OUT.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "coordinateSystem": "Three.js Y-up (+X=East, -Z=North, +Y=Up), origin at ground contact Y=0 with -1.6m foundation skirt",
        "excludedOsmIds": sorted(set(all_excluded_ids)),
        "landmarks": manifest_landmarks,
    }
    with open(MANIFEST_OUT, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"Wrote landmark manifest: {MANIFEST_OUT} ({len(manifest_landmarks)} landmarks, {len(manifest['excludedOsmIds'])} excluded OSM IDs)")


if __name__ == "__main__":
    main()
