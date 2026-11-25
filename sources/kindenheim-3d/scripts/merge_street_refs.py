#!/usr/bin/env python3
"""
Merge per-street captured references from data/streets/*/manifest_part.json
and data/streets/*/refs/*.png into data/references/brave/manifest.json cleanly.

- Preserves ALL existing Wave 1 + Wave 2 entries (first 29 shots) untouched.
- Copies verified PNGs into data/references/brave/ with collision-free names.
- Validates every image exists and loads cleanly via PIL (>15 KB).
- 100% idempotent across repeated runs (updates/deduplicates by shot id).
"""

import glob
import json
import os
import shutil
from PIL import Image

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
BRAVE_DIR = os.path.join(PROJECT_ROOT, "data/references/brave")
MANIFEST_PATH = os.path.join(BRAVE_DIR, "manifest.json")
STREETS_DIR = os.path.join(PROJECT_ROOT, "data/streets")


def normalize_filename(slug: str, raw_name: str, is_aerial: bool = False) -> str:
    base = os.path.basename(raw_name)
    if not base.lower().endswith(".png"):
        base += ".png"
    prefix = "aerial_" if is_aerial else "sv_"
    if slug in base:
        return base
    if base.startswith("sv_") or base.startswith("aerial_"):
        rest = base.split("_", 1)[1]
        return f"{prefix}{slug}_{rest}"
    return f"{prefix}{slug}_{base}"


def find_source_png(street_dir: str, entry: dict) -> str:
    refs_dir = os.path.join(street_dir, "refs")
    candidates = []
    for k in ("sourceFile", "localFile", "file", "filename"):
        v = entry.get(k)
        if not v:
            continue
        b = os.path.basename(v)
        candidates.append(os.path.join(refs_dir, b))
        candidates.append(os.path.join(street_dir, v.lstrip("/")))
        if os.path.isabs(v):
            candidates.append(v)
        candidates.append(os.path.join(BRAVE_DIR, b))
    sid = entry.get("id", "")
    if sid:
        candidates.append(os.path.join(refs_dir, f"{sid}.png"))
    for c in candidates:
        if os.path.isfile(c):
            return c
    return ""


def main():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    existing_refs = manifest.get("references", [])
    by_id = {}
    ordered_ids = []
    for r in existing_refs:
        rid = r.get("id")
        if rid and rid not in by_id:
            by_id[rid] = r
            ordered_ids.append(rid)

    part_files = sorted(glob.glob(os.path.join(STREETS_DIR, "*", "manifest_part.json")))
    added = 0
    updated = 0
    skipped = 0
    streets_seen = 0

    for pf in part_files:
        street_dir = os.path.dirname(pf)
        slug = os.path.basename(street_dir)
        try:
            with open(pf, "r", encoding="utf-8") as f:
                part = json.load(f)
        except Exception as e:
            print(f"[WARN] Failed reading {pf}: {e}")
            continue

        entries = part.get("references", []) if isinstance(part, dict) else (part if isinstance(part, list) else [])
        if not entries:
            continue
        streets_seen += 1

        for raw in entries:
            if not isinstance(raw, dict):
                continue
            rid = str(raw.get("id") or "").strip()
            if not rid:
                skipped += 1
                continue
            src_png = find_source_png(street_dir, raw)
            if not src_png:
                print(f"[WARN] {slug}/{rid}: source PNG not found, skipping")
                skipped += 1
                continue
            if os.path.getsize(src_png) < 15_000:
                print(f"[WARN] {slug}/{rid}: PNG too small ({os.path.getsize(src_png)} B), skipping")
                skipped += 1
                continue
            try:
                with Image.open(src_png) as im:
                    w, h = im.size
                    if w < 320 or h < 200:
                        print(f"[WARN] {slug}/{rid}: invalid image dims {w}x{h}, skipping")
                        skipped += 1
                        continue
            except Exception as e:
                print(f"[WARN] {slug}/{rid}: corrupt PNG ({e}), skipping")
                skipped += 1
                continue

            is_aerial = ("satellite" in str(raw.get("source", "")).lower()) or rid.startswith("aerial_") or float(raw.get("pitchDeg", 0)) <= -45
            dest_name = normalize_filename(slug, raw.get("file") or os.path.basename(src_png), is_aerial=is_aerial)
            dest_png = os.path.join(BRAVE_DIR, dest_name)
            if os.path.abspath(src_png) != os.path.abspath(dest_png):
                shutil.copy2(src_png, dest_png)

            clean_entry = dict(raw)
            clean_entry["id"] = rid
            clean_entry["file"] = f"/data/references/brave/{dest_name}"
            clean_entry.setdefault("source", "Google Street View" if not is_aerial else "Google Maps Satellite")
            clean_entry.setdefault("cameraHeightM", 2.5 if not is_aerial else 350.0)
            clean_entry.setdefault("fovDeg", 85 if not is_aerial else 55)
            clean_entry.setdefault("pitchDeg", 3 if not is_aerial else -90)
            clean_entry.setdefault("headingDeg", 0)
            clean_entry.setdefault("landmarkKeys", [])
            clean_entry["streetSlug"] = slug
            # Remove helper local paths if present
            clean_entry.pop("sourceFile", None)
            clean_entry.pop("localFile", None)

            if rid in by_id:
                # Never clobber original Wave 1+2 entries (first 29 without streetSlug)
                if "streetSlug" not in by_id[rid]:
                    print(f"[INFO] Preserving Wave 1/2 entry {rid} (skipping duplicate from {slug})")
                    continue
                by_id[rid] = clean_entry
                updated += 1
            else:
                by_id[rid] = clean_entry
                ordered_ids.append(rid)
                added += 1

    manifest["version"] = "1.2-all-streets"
    manifest["references"] = [by_id[k] for k in ordered_ids]

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(
        f"Merged {streets_seen} street manifests -> {MANIFEST_PATH}: "
        f"total={len(manifest['references'])} (added={added}, updated={updated}, skipped={skipped})"
    )


if __name__ == "__main__":
    main()
