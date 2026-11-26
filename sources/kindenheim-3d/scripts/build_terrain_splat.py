#!/usr/bin/env python3
"""
Build data/terrain/ground_splat.png: the material map of the close-range ground materials (1 m/px).

Inputs : data/terrain/landuse_mask.png (OSM classes, see data/meta.json landuseMaskLegend)
         <cache>/work/ortho_processed_4096.png (shadow-lifted aerial, written by build_terrain_ortho.py)
         data/osm/kindenheim_scene.json (building footprints, read only)
         data/osm/fields_layout.json (crop parcels, read only)
Output : 4096 x 2048 RGB PNG (lossless) = two 2048 x 2048 maps side by side (row 0 = north):
           left  half  R = grass, G = dry grass / stubble, B = ploughed soil
           right half  R = gravel / dirt, G = concrete pavers, B = asphalt
         Layer order matches public/assets/textures/ground/ground.json.

The OSM class decides what is plausible, the aerial colour decides what is actually there. Outside crop parcels
every pixel gets ONE material (hard classes): lawn or hard ground first, then one hard material per yard-sized
neighbourhood, specks removed by majority filters - so plots read as distinct lawn / paving / gravel areas with
crisp borders instead of soft colour-driven mixtures. Only the class borders are anti-aliased (sigma 0.7 px);
the shader re-sharpens them. Crop parcels keep a deliberate soil / straw mix (the shader breaks it into patches).

Usage:  python3 scripts/build_terrain_splat.py [--work DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_WORK = os.path.join(PROJECT_ROOT, ".gfx", "terrain", "cache", "work")
OUT_PATH = os.path.join(PROJECT_ROOT, "data", "terrain", "ground_splat.png")
N = 2048


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=DEFAULT_WORK)
    args = ap.parse_args()

    ortho_path = os.path.join(args.work, "ortho_processed_4096.png")
    if not os.path.exists(ortho_path):
        raise RuntimeError(f"{ortho_path} missing - run scripts/build_terrain_ortho.py first")
    with open(os.path.join(PROJECT_ROOT, "data", "meta.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    legend = {k: v["r"] for k, v in meta["landuseMaskLegend"].items()}
    half = float(meta["halfMapSizeM"])
    size_m = float(meta["mapSizeM"])

    mask = np.asarray(Image.open(os.path.join(PROJECT_ROOT, "data", "terrain", "landuse_mask.png")).convert("RGB"))[:, :, 0]
    if mask.shape != (N, N):
        raise RuntimeError(f"landuse_mask.png is {mask.shape}, expected {N}x{N}")
    known = np.zeros_like(mask, dtype=bool)
    for r in legend.values():
        known |= mask == r
    if not known.all():
        raise RuntimeError(f"landuse_mask.png has {int((~known).sum())} pixels with an unknown class value")

    ortho = cv2.resize(np.asarray(Image.open(ortho_path).convert("RGB")), (N, N), interpolation=cv2.INTER_AREA)
    ortho = cv2.medianBlur(ortho, 3)
    c = ortho.astype(np.float32) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    r, g, b = lin[:, :, 0], lin[:, :, 1], lin[:, :, 2]
    s = np.maximum(r + g + b, 1e-4)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    veg = smoothstep(0.035, 0.09, (2.0 * g - r - b) / s)
    warm = (r - b) / s
    bare = 1.0 - veg
    bright = smoothstep(0.10, 0.20, lum)
    warmish = smoothstep(0.03, 0.10, warm)

    is_ = {k: (mask == v) for k, v in legend.items()}
    # Unpaved tracks are classified by colour like open land: the road decal paints the two wheel ruts, the grass
    # middle strip and the verges come from the terrain so they match the surrounding field exactly.
    rural = is_["farmland"] | is_["vineyard"] | is_["meadow"] | is_["forest"] | is_["water"] | is_["road_track"]
    village = is_["residential"]

    def box(a: np.ndarray, k: int) -> np.ndarray:
        return cv2.blur(a.astype(np.float32), (k, k))

    def majority(labels: np.ndarray, k: int, classes: list[int]) -> np.ndarray:
        votes = np.stack([box(labels == c, k) for c in classes])
        return np.array(classes, dtype=np.uint8)[np.argmax(votes, axis=0)]

    GRASS, DRY, SOIL, GRAVEL, PAVERS, ASPHALT = range(6)
    labels = np.full((N, N), GRASS, dtype=np.uint8)

    # 1. vegetation or not (majority over 3 m; isolated specks such as cars or a single shrub do not count)
    is_veg = box(veg, 3) > 0.5
    is_veg = cv2.morphologyEx(is_veg.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))) > 0

    # 2. open land, bare: one of soil / stubble / gravel per ~7 m neighbourhood
    bare_scores = np.stack([box(bare * (1.0 - bright), 7), box(bare * bright * warmish, 7), box(bare * bright * (1.0 - warmish), 7)])
    bare_cls = np.array([SOIL, DRY, GRAVEL], dtype=np.uint8)[np.argmax(bare_scores, axis=0)]
    sel = rural & ~is_veg
    labels[sel] = bare_cls[sel]

    # 3. village plots, hard ground: one of pavers (neutral grey) / gravel (beige) / asphalt (dark grey) per ~9 m
    dark_grey = (1.0 - smoothstep(0.07, 0.13, lum)) * (1.0 - warmish)
    hard_scores = np.stack([box(bare * (1.0 - dark_grey * 0.6) * (1.0 - warmish), 9), box(bare * (1.0 - dark_grey * 0.6) * warmish, 9),
                            box(bare * dark_grey * 0.6, 9)])
    hard_cls = np.array([PAVERS, GRAVEL, ASPHALT], dtype=np.uint8)[np.argmax(hard_scores, axis=0)]
    sel = village & ~is_veg
    labels[sel] = hard_cls[sel]

    # 4. remove specks: two majority passes over 3 m
    for _ in range(2):
        labels = majority(labels, 3, [GRASS, DRY, SOIL, GRAVEL, PAVERS, ASPHALT])

    onehot = [(labels == c).astype(np.float32) for c in range(6)]
    grass, dry, soil, gravel, pavers, asphalt = onehot

    # Arable parcels: the ground under the crop models (src/fields.ts, data/osm/fields_layout.json, read only) must
    # match the crop, not the June photo: bare harrowed soil between beet / maize / sunflower rows, straw-littered
    # soil under stubble and ripe wheat. Meadows and orchards keep the colour-based classification.
    layout_path = os.path.join(PROJECT_ROOT, "data", "osm", "fields_layout.json")
    with open(layout_path, "r", encoding="utf-8") as f:
        layout = json.load(f)
    track_zone = cv2.dilate(is_["road_track"].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    crop_mix = {  # crop -> (soil, dry grass, grass * vegetation)
        "sugarbeet": (0.85, 0.0, 0.15),
        "corn": (0.85, 0.0, 0.15),
        "sunflower": (0.85, 0.0, 0.15),
        "stubble": (0.4, 0.6, 0.0),
        "wheat": (0.5, 0.5, 0.0),
    }
    for field in layout["fields"]:
        mix = crop_mix.get(field.get("crop"))
        if mix is None:
            continue
        poly = np.round(np.array([[(p[0] + half) / size_m * N, (p[1] + half) / size_m * N] for p in field["points"]], dtype=np.float32)).astype(np.int32)
        if len(poly) < 3:
            continue
        m = np.zeros((N, N), dtype=np.uint8)
        cv2.fillPoly(m, [poly], 255)
        # Crop instances are clipped per pixel at the parcel outline (src/fields.ts crop clip map), so the soil mix only
        # needs to cover rasterisation slack: grow by 1 m, never onto a track.
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        sel = (m > 0) & rural & ~track_zone
        soil[sel] = mix[0]
        dry[sel] = mix[1]
        grass[sel] = (mix[2] * veg)[sel]
        gravel[sel] = 0.0

    # Mapped paved roads win regardless of colour (tree crowns and shadows hide them in the photo).
    ra = is_["road_asphalt"]
    asphalt[ra] = 1.0
    for a in (grass, dry, soil, gravel, pavers):
        a[ra] = 0.0

    # Building footprints are hidden by the models; give them neutral pavers so roof colours never bleed out.
    with open(os.path.join(PROJECT_ROOT, "data", "osm", "kindenheim_scene.json"), "r", encoding="utf-8") as f:
        scene = json.load(f)
    fp = np.zeros((N, N), dtype=np.uint8)
    polys = []
    for bld in scene["buildings"]:
        pts = np.array([[(p[0] + half) / size_m * N, (p[1] + half) / size_m * N] for p in bld["footprint"]], dtype=np.float32)
        if len(pts) >= 3:
            polys.append(np.round(pts).astype(np.int32))
    cv2.fillPoly(fp, polys, 255)
    fpb = fp > 0
    for a in (grass, dry, soil, gravel, asphalt):
        a[fpb] = 0.0
    pavers[fpb] = 1.0

    stack = np.dstack([grass, dry, soil, gravel, pavers, asphalt])
    stack = cv2.GaussianBlur(stack, (0, 0), 0.7)
    total = stack.sum(axis=2, keepdims=True)
    if float(total.min()) < 0.2:
        raise RuntimeError(f"Splat has pixels with almost no material weight (min sum {float(total.min()):.3f})")
    stack = stack / total
    q = np.round(stack * 255.0).astype(np.int32)
    # Put the rounding remainder on the dominant layer so the six bytes sum to exactly 255.
    dom = np.argmax(q, axis=2)
    np.put_along_axis(q, dom[:, :, None], np.take_along_axis(q, dom[:, :, None], axis=2) + (255 - q.sum(axis=2, keepdims=True)), axis=2)
    q = np.clip(q, 0, 255).astype(np.uint8)

    out = np.concatenate([q[:, :, 0:3], q[:, :, 3:6]], axis=1)
    Image.fromarray(out, "RGB").save(OUT_PATH, "PNG", optimize=True)
    share = stack.reshape(-1, 6).mean(axis=0)
    names = ["grass", "dry_grass", "soil", "gravel", "pavers", "asphalt"]
    print("[splat] area share: " + ", ".join(f"{n} {v * 100:.1f}%" for n, v in zip(names, share)))
    print(f"[splat] wrote {OUT_PATH} ({os.path.getsize(OUT_PATH) / 1e6:.2f} MB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[splat] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
