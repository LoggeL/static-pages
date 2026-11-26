#!/usr/bin/env python3
"""
Build the two aerial textures of the far terrain ring (mesh "KindenheimTerrainFar" in src/terrain.ts).

Input : cached WMS captures from scripts/fetch_ortho_far.py
Output: data/terrain/far/inner.webp   2048 px,  6144 m square (3 m/px), centred on the map centre
        data/terrain/far/outer.webp   2048 px, 16384 m square (8 m/px)
        data/terrain/far/manifest.json  extents + attribution ((c) GeoBasis-DE / LVermGeoRP, dl-de/by-2-0)

Row 0 = north, column 0 = west, like every other terrain raster. The textures are area-averaged
downsamples (the inner one mildly unsharp-masked, it is seen magnified at the map border); the shader applies the same albedo tone curve as on the main terrain so the seam matches in colour.

Usage:  python3 scripts/build_terrain_far.py [--cache DIR] [--quality 80]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_ortho_far import DEFAULT_CACHE, PROJECT_ROOT, RINGS, WMS_URL, ring_path  # noqa: E402

OUT_DIR = os.path.join(PROJECT_ROOT, "data", "terrain", "far")
OUT_PX = 2048
UNSHARP = {"inner": (1.1, 0.65)}  # layer -> (gaussian sigma px, amount)
ATTRIBUTION = "© GeoBasis-DE / LVermGeoRP (2026), dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--quality", type=int, default=80)
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {
        "attribution": ATTRIBUTION,
        "licence": "Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0)",
        "source": f"LVermGeo RLP OpenData DOP20 WMS {WMS_URL} (layer rp_dop20), resampled by the server",
        "layers": {},
    }
    total = 0
    for name, side in RINGS.items():
        path = ring_path(args.cache, name)
        if not os.path.exists(path):
            raise RuntimeError(f"Missing {path} - run scripts/fetch_ortho_far.py first")
        arr = np.asarray(Image.open(path).convert("RGB"))
        small = cv2.resize(arr, (OUT_PX, OUT_PX), interpolation=cv2.INTER_AREA)
        if name in UNSHARP:
            # The inner ring is seen from close by at the map border, where the texture is magnified: restore
            # the field / hedge / track edges the area average softened (mild unsharp mask, no visible halos).
            sigma, amount = UNSHARP[name]
            f = small.astype(np.float32)
            blur = cv2.GaussianBlur(f, (0, 0), sigma)
            small = np.clip(f + amount * (f - blur), 0, 255).astype(np.uint8)
        out = os.path.join(OUT_DIR, f"{name}.webp")
        Image.fromarray(small, "RGB").save(out, "WEBP", quality=args.quality, method=6)
        size = os.path.getsize(out)
        total += size
        manifest["layers"][name] = {"file": f"{name}.webp", "sizePx": OUT_PX, "sideM": side, "metresPerPixel": side / OUT_PX, "bytes": size}
        print(f"[far] {name}: {size / 1e6:.2f} MB")
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"[far] total {total / 1e6:.2f} MB -> {OUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[far] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
