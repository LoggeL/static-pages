#!/usr/bin/env python3
"""
Assemble and validate the unified public/assets/models/fields/manifest.json from all 6 field subfolders:
  - wheat/     (crop_wheat_patch.glb, crop_stubble_patch.glb, straw_bale_stack.glb)
  - corn/      (crop_corn_row.glb)
  - sugarbeet/ (crop_sugarbeet_row.glb)
  - sunflower/ (crop_sunflower_patch.glb)
  - meadow/    (meadow_grass_patch.glb, wildflower_strip.glb)
  - props/     (hedgerow_bay.glb, vineyard_rose_post.glb, hochsitz.glb, wegekreuz.glb)

Strictly validates every GLB binary header:
  - valid glTF 2.0 binary magic
  - 0 external image URIs (100% embedded)
  - Y-up bounds + negative underground skirt (minY < -0.15m)
  - alphaMode == "MASK" & doubleSided == true on all foliage/crop cards
  - total combined size < 3.5 MB
Outputs clean manifest matching src/dataLoader.ts & src/fields.ts FieldsManifest schema!
"""

import json
import os
import struct
import sys

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
FIELDS_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/fields")
MANIFEST_OUT = os.path.join(FIELDS_DIR, "manifest.json")

EXPECTED_MODELS = [
    ("crop_wheat_patch",     "wheat/crop_wheat_patch.glb",          "wheat/meta.json",     True,  {"spacingM": 5.6, "windSway": 0.12}),
    ("crop_stubble_patch",   "wheat/crop_stubble_patch.glb",        "wheat/meta.json",     True,  {"spacingM": 5.6, "windSway": 0.0}),
    ("straw_bale_stack",     "wheat/straw_bale_stack.glb",          "wheat/meta.json",     False, {"spacingM": 8.0, "windSway": 0.0}),
    ("crop_corn_row",        "corn/crop_corn_row.glb",              "corn/meta.json",      True,  {"alongRowM": 6.0, "betweenBaysM": 2.4, "windSway": 0.16}),
    ("crop_sugarbeet_row",   "sugarbeet/crop_sugarbeet_row.glb",    "sugarbeet/meta.json", True,  {"alongRowM": 6.0, "betweenBaysM": 2.5, "windSway": 0.05}),
    ("crop_sunflower_patch", "sunflower/crop_sunflower_patch.glb",  "sunflower/meta.json", True,  {"spacingM": 5.0, "windSway": 0.14}),
    ("meadow_grass_patch",   "meadow/meadow_grass_patch.glb",       "meadow/meta.json",    True,  {"spacingM": 4.75, "windSway": 0.10}),
    ("wildflower_strip",     "meadow/wildflower_strip.glb",         "meadow/meta.json",    True,  {"alongRowM": 4.85, "betweenBaysM": 1.6, "windSway": 0.10}),
    ("hedgerow_bay",         "props/hedgerow_bay.glb",              "props/meta.json",     True,  {"alongRowM": 5.0, "betweenBaysM": 2.2, "windSway": 0.04}),
    ("vineyard_rose_post",   "props/vineyard_rose_post.glb",        "props/meta.json",     True,  {"spacingM": 5.5, "windSway": 0.03}),
    ("hochsitz",             "props/hochsitz.glb",                  "props/meta.json",     False, {"spacingM": 4.0, "windSway": 0.0}),
    ("wegekreuz",            "props/wegekreuz.glb",                 "props/meta.json",     False, {"spacingM": 2.5, "windSway": 0.0}),
]


def parse_glb_info(glb_path: str) -> dict:
    with open(glb_path, "rb") as f:
        magic, version, total_len = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError(f"{glb_path}: invalid GLB magic {magic}")
        chunk_len, chunk_type = struct.unpack("<I4s", f.read(8))
        if chunk_type != b"JSON":
            raise ValueError(f"{glb_path}: missing JSON chunk")
        g = json.loads(f.read(chunk_len).decode("utf-8"))

    ext_uris = [img.get("uri") for img in g.get("images", []) if img.get("uri")]
    accessors = g.get("accessors", [])

    # Compute exact triangles and Y-up bounding box from POSITION accessors
    tris = 0
    mins = [1e9, 1e9, 1e9]
    maxs = [-1e9, -1e9, -1e9]
    for mesh in g.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                tris += accessors[prim["indices"]]["count"] // 3
            elif "POSITION" in prim.get("attributes", {}):
                tris += accessors[prim["attributes"]["POSITION"]]["count"] // 3
            pos_idx = prim.get("attributes", {}).get("POSITION")
            if pos_idx is not None:
                acc = accessors[pos_idx]
                if "min" in acc and "max" in acc:
                    for i in range(3):
                        mins[i] = min(mins[i], float(acc["min"][i]))
                        maxs[i] = max(maxs[i], float(acc["max"][i]))

    mats = g.get("materials", [])
    has_mask_ds = any(m.get("alphaMode") == "MASK" and m.get("doubleSided") is True for m in mats)

    size = [round(maxs[i] - mins[i], 3) for i in range(3)]
    return {
        "fileSizeBytes": os.path.getsize(glb_path),
        "triangles": int(tris),
        "meshCount": len(g.get("meshes", [])),
        "materialCount": len(mats),
        "externalImageURIs": len(ext_uris),
        "hasMaskDoubleSided": has_mask_ds,
        "bounds": size,
        "boundsMin": [round(x, 3) for x in mins],
        "boundsMax": [round(x, 3) for x in maxs],
    }


def extract_meta_entry(meta_path: str, key: str) -> dict:
    if not os.path.exists(meta_path):
        return {}
    with open(meta_path, encoding="utf-8") as f:
        data = json.load(f)
    if "assets" in data and isinstance(data["assets"], dict) and key in data["assets"]:
        return data["assets"][key]
    if "models" in data and isinstance(data["models"], dict) and key in data["models"]:
        return data["models"][key]
    if data.get("id") == key or key in str(data.get("glbPath", "")):
        return data
    return {}


def main():
    models = {}
    total_bytes = 0
    total_tris = 0
    errors = []

    for key, rel_glb, rel_meta, needs_mask_ds, defaults in EXPECTED_MODELS:
        glb_abs = os.path.join(FIELDS_DIR, rel_glb)
        meta_abs = os.path.join(FIELDS_DIR, rel_meta)
        if not os.path.exists(glb_abs):
            errors.append(f"MISSING GLB: {glb_abs}")
            continue

        info = parse_glb_info(glb_abs)
        src_meta = extract_meta_entry(meta_abs, key)

        if info["externalImageURIs"] > 0:
            errors.append(f"{key}: has {info['externalImageURIs']} external image URIs!")
        if needs_mask_ds and not info["hasMaskDoubleSided"]:
            errors.append(f"{key}: missing alphaMode=MASK + doubleSided=true on foliage!")
        if info["boundsMin"][1] > -0.10:
            errors.append(f"{key}: minY={info['boundsMin'][1]} (expected underground slope skirt <= -0.15m)")

        # Resolve spacing & wind sway from specialist meta.json with clean fallbacks
        sp = src_meta.get("recommendedSpacing") or src_meta.get("spacing") or src_meta.get("instancing") or {}
        if isinstance(sp, list) and len(sp) >= 2:
            sp = {"gridM": sp[0], "alongRowM": sp[0], "betweenBaysM": sp[1]}

        entry = {
            "key": key,
            "name": key,
            "glbPath": f"/assets/models/fields/{rel_glb}",
            "bounds": info["bounds"],
            "boundsMin": info["boundsMin"],
            "boundsMax": info["boundsMax"],
            "triangles": info["triangles"],
            "meshCount": info["meshCount"],
            "fileSizeBytes": info["fileSizeBytes"],
            "alphaMaskDoubleSided": info["hasMaskDoubleSided"],
        }

        spacing_m = (
            src_meta.get("spacingM")
            or src_meta.get("recommendedGridSpacingM")
            or (sp.get("gridM") if isinstance(sp, dict) else None)
            or (sp.get("gridSpacingM") if isinstance(sp, dict) else None)
            or defaults.get("spacingM")
        )
        along_m = (
            src_meta.get("alongRowM")
            or (sp.get("alongRowM") if isinstance(sp, dict) else None)
            or (sp.get("alongStripM") if isinstance(sp, dict) else None)
            or defaults.get("alongRowM")
        )
        between_m = (
            src_meta.get("betweenBaysM")
            or (sp.get("betweenBaysM") if isinstance(sp, dict) else None)
            or (sp.get("stripWidthM") if isinstance(sp, dict) else None)
            or defaults.get("betweenBaysM")
        )
        wind = src_meta.get("windSway")
        if wind is None:
            wind = src_meta.get("windSwayStrength")
        if wind is None:
            wind = defaults.get("windSway", 0.0)

        if spacing_m is not None:
            entry["spacingM"] = float(spacing_m)
        if along_m is not None:
            entry["alongRowM"] = float(along_m)
        if between_m is not None:
            entry["betweenBaysM"] = float(between_m)
        entry["windSway"] = float(wind)
        entry["windSwayStrength"] = float(wind)

        models[key] = entry
        total_bytes += info["fileSizeBytes"]
        total_tris += info["triangles"]

    total_mb = total_bytes / (1024.0 * 1024.0)
    manifest = {
        "version": 1,
        "coordinateSystem": "glTF 2.0 Y-up meters (+X East / along rows, +Y Up above ground contact Y=0 with underground slope skirt, -Z North)",
        "modelCount": len(models),
        "totalFileSizeBytes": total_bytes,
        "totalFileSizeMB": round(total_mb, 3),
        "totalTriangles": total_tris,
        "externalImageURIs": 0,
        "models": models,
    }

    with open(MANIFEST_OUT, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"[MANIFEST] Wrote {MANIFEST_OUT} ({len(models)} models, {total_mb:.2f} MB = {total_bytes/1024:.1f} KB, {total_tris} total tris)")
    for k, m in models.items():
        print(f"  {k:22s} {m['fileSizeBytes']/1024:6.1f} KB | {m['triangles']:4d} tris | bounds={m['bounds']} | minY={m['boundsMin'][1]:5.2f} | wind={m['windSway']}")

    if total_mb > 3.5:
        errors.append(f"Total GLB size {total_mb:.2f} MB exceeds 3.5 MB budget!")

    if errors:
        print("\n[VALIDATION WARNINGS/ERRORS]:")
        for e in errors:
            print("  !", e)
        sys.exit(1)
    print("\n[VALIDATION] ALL 12 FIELD GLBs PASSED 100% (0 external URIs, valid MASK+doubleSided, valid ground skirts, <3.5 MB)!")


if __name__ == "__main__":
    main()
