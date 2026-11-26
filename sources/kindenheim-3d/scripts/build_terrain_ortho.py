#!/usr/bin/env python3
"""
Build the runtime aerial imagery from the cached 0.2 m DOP20 chunks (see scripts/fetch_ortho_hires.py).

Outputs (data/terrain/ortho/):
    hi_<row>_<col>.webp   8 x 8 streaming tiles, each 256 m x 256 m at 0.2 m/px = 1280 px plus a
                          16 px seamless gutter on every side (1312 x 1312 px). row 0 = north, col 0 = west.
    base.webp             whole map, 4096 x 4096 (0.5 m/px), area-averaged from the same processed mosaic
                          so the far layer and the streamed tiles match exactly in colour.
    minimap.jpg           2048 px copy for the 2D minimap (shipped under the name terrain/orthophoto.jpg)
    manifest.json         layout + attribution (c) GeoBasis-DE / LVermGeoRP, dl-de/by-2-0

Processing ("Daten bearbeitet"): baked cast shadows are lifted to the surrounding sunlit level and de-blued,
because the app renders its own real-time shadows and the baked ones would double up (wrong direction, dark
stains at street level). Shadows are found by colour (dark + bluish hard ground) and by geometry: the photo's
sun position is estimated from the building shadows, then every building footprint (scene JSON) and detected
tree (vegetation layout) casts its expected shadow, which is lifted on lawns as well.

Also writes two lossless helper rasters into the cache for scripts/build_terrain_splat.py:
    <cache>/work/ortho_raw_4096.png, <cache>/work/shadow_4096.png

NO FALLBACKS: a missing chunk aborts.

Usage:  python3 scripts/build_terrain_ortho.py [--cache DIR] [--quality 80] [--preview]
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
from fetch_ortho_hires import (  # noqa: E402
    CHUNK_PX, DEFAULT_CACHE, GSD_M, GUTTER_PX, PROJECT_ROOT, WMS_LAYER, WMS_URL, chunk_path, mosaic_layout,
)

Image.MAX_IMAGE_PIXELS = None
OUT_DIR = os.path.join(PROJECT_ROOT, "data", "terrain", "ortho")
TILES_PER_SIDE = 8
BASE_SIZE = 4096
ATTRIBUTION = "© GeoBasis-DE / LVermGeoRP (2026), dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]"


def load_mosaic(cache: str, layout: dict) -> np.ndarray:
    n = layout["chunksPerSide"]
    total = layout["totalPx"]
    mosaic = np.empty((total, total, 3), dtype=np.uint8)
    for row in range(n):
        for col in range(n):
            path = chunk_path(cache, row, col)
            if not os.path.exists(path):
                raise RuntimeError(f"Missing DOP20 chunk {path} - run scripts/fetch_ortho_hires.py first")
            im = Image.open(path).convert("RGB")
            if im.size != (CHUNK_PX, CHUNK_PX):
                raise RuntimeError(f"Chunk {path} has size {im.size}")
            mosaic[row * CHUNK_PX:(row + 1) * CHUNK_PX, col * CHUNK_PX:(col + 1) * CHUNK_PX] = np.asarray(im)
    return mosaic


def srgb_to_linear_lut() -> np.ndarray:
    c = np.arange(256, dtype=np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb8(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(s * 255.0), 0, 255).astype(np.uint8)


def colour_shadow(lin: np.ndarray, gsd: float, roof: np.ndarray) -> dict:
    """Colour-only shadow evidence at resolution gsd (m/px): dark + bluish, relative to the sunlit surroundings."""
    r, g, b = lin[:, :, 0], lin[:, :, 1], lin[:, :, 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx = np.maximum(np.maximum(r, g), b)
    exg = (2.0 * g - r - b) / np.maximum(r + g + b, 1e-4)
    veg = np.clip((exg - 0.03) / 0.07, 0.0, 1.0)
    sigma = 12.0 / gsd

    # Sunlit reference brightness of hard / bare ground in a ~24 m neighbourhood.
    lit = ((lum > 0.085) & (lum < 0.75)).astype(np.float32) * (1.0 - veg)
    num = cv2.GaussianBlur(lum * lit, (0, 0), sigma)
    den = cv2.GaussianBlur(lit, (0, 0), sigma)
    lum_all = cv2.GaussianBlur(lum, (0, 0), sigma * 2.0)
    ref_hard = np.clip(np.where(den > 0.04, num / np.maximum(den, 1e-4), np.maximum(lum_all * 1.6, 0.12)), 0.10, 0.42)

    # Sunlit reference of vegetation: the brighter part of the local green (shadowed lawn and dark crowns excluded).
    veg_mean = cv2.GaussianBlur(lum * veg, (0, 0), sigma) / np.maximum(cv2.GaussianBlur(veg, (0, 0), sigma), 1e-3)
    lit_veg = veg * (lum > 0.8 * veg_mean)
    num_v = cv2.GaussianBlur(lum * lit_veg, (0, 0), sigma)
    den_v = cv2.GaussianBlur(lit_veg, (0, 0), sigma)
    ref_veg = np.clip(np.where(den_v > 0.03, num_v / np.maximum(den_v, 1e-4), veg_mean * 1.15), 0.04, 0.30)

    # Sunlit reference COLOUR per class (roofs excluded): what lifted shadows are repainted with.
    ground_lit = lit * (1.0 - roof)
    den_g = cv2.GaussianBlur(ground_lit, (0, 0), sigma)
    ref_hard_rgb = cv2.GaussianBlur(lin * ground_lit[:, :, None], (0, 0), sigma) / np.maximum(den_g, 1e-3)[:, :, None]
    fallback = cv2.GaussianBlur(lin * lit[:, :, None], (0, 0), sigma * 3) / np.maximum(cv2.GaussianBlur(lit, (0, 0), sigma * 3), 1e-3)[:, :, None]
    ref_hard_rgb = np.where((den_g > 0.03)[:, :, None], ref_hard_rgb, fallback)
    ref_veg_rgb = cv2.GaussianBlur(lin * lit_veg[:, :, None], (0, 0), sigma) / np.maximum(den_v, 1e-3)[:, :, None]
    veg_fallback = cv2.GaussianBlur(lin * veg[:, :, None], (0, 0), sigma * 3) / np.maximum(cv2.GaussianBlur(veg, (0, 0), sigma * 3), 1e-3)[:, :, None] * 1.15
    ref_veg_rgb = np.where((den_v > 0.03)[:, :, None], ref_veg_rgb, veg_fallback)

    ratio_hard = lum / ref_hard
    dark = np.clip((0.46 - ratio_hard) / 0.16, 0.0, 1.0)
    blue = np.clip(((b / np.maximum(mx, 1e-4)) - 0.86) / 0.10, 0.0, 1.0)
    return {"lum": lum, "veg": veg, "ref_hard": ref_hard, "ref_veg": ref_veg, "blue": blue,
            "ref_rgb": (veg[:, :, None] * ref_veg_rgb + (1.0 - veg)[:, :, None] * ref_hard_rgb).astype(np.float32),
            "colour": dark * (0.35 + 0.65 * blue) * (1.0 - veg)}


def load_casters() -> tuple[list, list]:
    """Shadow casters with known height: building footprints (scene JSON) and detected trees (vegetation layout)."""
    with open(os.path.join(PROJECT_ROOT, "data", "osm", "kindenheim_scene.json"), "r", encoding="utf-8") as f:
        scene = json.load(f)
    buildings = []
    for b in scene["buildings"]:
        if len(b["footprint"]) >= 3:
            buildings.append((np.array(b["footprint"], dtype=np.float32), float(b.get("wallHeightM") or 6.0) + 0.6 * float(b.get("roofHeightM") or 2.0)))
        tower = b.get("tower")
        if tower and tower.get("footprint"):
            buildings.append((np.array(tower["footprint"], dtype=np.float32), float(tower.get("totalHeightM") or 30.0)))
    veg_path = os.path.join(PROJECT_ROOT, "data", "osm", "vegetation_layout.json")
    if not os.path.exists(veg_path):
        raise RuntimeError(f"{veg_path} missing (tree shadows need the detected trees)")
    with open(veg_path, "r", encoding="utf-8") as f:
        veg = json.load(f)
    ang = np.linspace(0, 2 * np.pi, 10, endpoint=False)
    trees = []
    for t in veg["trees"]:
        rad = float(t["crownRadiusM"]) * 0.9
        ring = np.stack([t["x"] + np.cos(ang) * rad, t["z"] + np.sin(ang) * rad], axis=1).astype(np.float32)
        trees.append((ring, float(t["heightM"]) * 0.8))
    return buildings, trees


def cast_mask(casters: list, direction: tuple[float, float], k: float, to_px, shape: tuple[int, int], include_self: bool) -> np.ndarray:
    """Rasterises the ground shadow of every caster: convex hull of the outline and the outline shifted by height * k."""
    mask = np.zeros(shape, dtype=np.uint8)
    own = np.zeros(shape, dtype=np.uint8)
    for outline, height in casters:
        shift = np.array(direction, dtype=np.float32) * height * k
        hull = cv2.convexHull(np.concatenate([outline, outline + shift]))[:, 0, :]
        cv2.fillConvexPoly(mask, np.round(to_px(hull)).astype(np.int32), 1)
        if not include_self:
            cv2.fillPoly(own, [np.round(to_px(outline)).astype(np.int32)], 1)
    if not include_self:
        mask[own > 0] = 0
    return mask


def estimate_sun(colour_1m: np.ndarray, buildings: list, map_half: float) -> tuple[tuple[float, float], float]:
    """Finds the shadow direction and length factor (= cot of the sun elevation) of the photo from the buildings."""
    n = colour_1m.shape[0]
    to_px = lambda pts: (pts + map_half) / (2 * map_half) * n  # noqa: E731
    best = (-1e9, 0.0, 0.0)
    ring_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))

    def score(az_deg: float, k: float) -> float:
        az = np.radians(az_deg)
        d = (float(np.sin(az)), float(-np.cos(az)))  # azimuth clockwise from north; north = -z
        m = cast_mask(buildings, d, k, to_px, (n, n), include_self=False) > 0
        foot = cast_mask(buildings, d, 0.0, to_px, (n, n), include_self=True) > 0
        ring = (cv2.dilate(m.astype(np.uint8), ring_k) > 0) & ~m & ~foot
        if m.sum() < 1000 or ring.sum() < 1000:
            return -1e9
        return float(colour_1m[m].mean() - colour_1m[ring].mean())

    for az in range(0, 360, 15):
        for k in (0.4, 0.7, 1.0, 1.4):
            sc = score(az, k)
            if sc > best[0]:
                best = (sc, az, k)
    _, az0, k0 = best
    for az in np.arange(az0 - 12, az0 + 12.1, 4):
        for k in np.arange(max(0.2, k0 - 0.3), k0 + 0.31, 0.1):
            sc = score(float(az), float(k))
            if sc > best[0]:
                best = (sc, float(az), float(k))
    sc, az, k = best
    if sc < 0.05:
        raise RuntimeError(f"Could not find the photo's sun direction from the building shadows (best score {sc:.3f})")
    print(f"[ortho] photo sun: shadows fall towards azimuth {az:.0f} deg, length = {k:.2f} x height (sun elevation {np.degrees(np.arctan(1 / k)):.0f} deg), score {sc:.3f}")
    a = np.radians(az)
    return (float(np.sin(a)), float(-np.cos(a))), float(k)


def compute_shadow_mask(lin_half: np.ndarray, gsd: float, layout: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    lin_half: linear RGB float32 at reduced resolution (gsd metres per pixel), whole mosaic incl. gutter.
    Returns (shadow weight 0..1 incl. penumbra, sunlit reference COLOUR of the pixel's own class, shadow core).

    Two kinds of evidence: (1) colour - much darker than the sunlit surroundings and bluish (hard ground only);
    (2) geometry - the pixel lies where a building or detected tree of known height must throw its shadow for the
    photo's sun position, and is darker than sunlit ground of its own class. (2) is what catches house and tree
    shadows on lawns, which colour alone cannot tell from a dark hedge.
    """
    h, w = lin_half.shape[:2]
    map_half = layout["mapPx"] * GSD_M / 2.0
    gutter_m = GUTTER_PX * GSD_M
    buildings, trees = load_casters()
    to_px0 = lambda pts: (pts + map_half + gutter_m) / gsd  # noqa: E731
    roof = cv2.dilate(cast_mask(buildings, (0.0, 0.0), 0.0, to_px0, (h, w), include_self=True), np.ones((5, 5), np.uint8)).astype(np.float32)
    c = colour_shadow(lin_half, gsd, roof)
    lum, veg = c["lum"], c["veg"]

    inner = c["colour"][int(gutter_m / gsd):h - int(gutter_m / gsd), int(gutter_m / gsd):w - int(gutter_m / gsd)]
    direction, k = estimate_sun(cv2.resize(inner, (int(2 * map_half), int(2 * map_half)), interpolation=cv2.INTER_AREA), buildings, map_half)

    to_px = lambda pts: (pts + map_half + gutter_m) / gsd  # noqa: E731
    geo = np.maximum(cast_mask(buildings, direction, k * 1.1, to_px, (h, w), include_self=True),
                     cast_mask(trees, direction, k, to_px, (h, w), include_self=True)).astype(np.float32)
    kg = max(3, int(round(1.6 / gsd)) | 1)
    geo = cv2.GaussianBlur(cv2.dilate(geo, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kg, kg))), (0, 0), 0.8 / gsd)

    ref = veg * c["ref_veg"] + (1.0 - veg) * c["ref_hard"]
    ratio = lum / np.maximum(ref, 1e-3)
    geometric = geo * np.clip((0.8 - ratio) / 0.18, 0.0, 1.0)
    shadow = np.maximum(c["colour"], geometric)

    # Remove speckle (window panes, cars), then grow the mask over the penumbra: the per-pixel gain in
    # deshadow() is adaptive (already-lit pixels get gain 1), so a generous mask leaves no dark rim.
    k_open = max(3, int(round(1.2 / gsd)) | 1)
    core = cv2.morphologyEx(shadow, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_open, k_open)))
    kd = max(3, int(round(2.4 / gsd)) | 1)
    grown = cv2.dilate((core > 0.3).astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kd, kd)))
    # Vegetation is only touched where the geometry says a shadow falls.
    shadow = cv2.GaussianBlur(grown, (0, 0), 0.5 / gsd) * np.maximum(1.0 - veg, np.clip(geo * 1.5, 0.0, 1.0))
    return np.clip(shadow, 0.0, 1.0).astype(np.float32), c["ref_rgb"], (core > 0.85) & (c["blue"] > 0.5) & (veg < 0.2)


def deshadow(mosaic: np.ndarray, strength: float, layout: dict) -> tuple[np.ndarray, np.ndarray]:
    lut = srgb_to_linear_lut()
    h, w = mosaic.shape[:2]
    half = cv2.resize(mosaic, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    lin_half = lut[half]
    shadow_h, ref_rgb_h, _core = compute_shadow_mask(lin_half, GSD_M * 2.0, layout)

    # A shadowed pixel is repainted with the sunlit colour of its own class nearby (lawn -> sunlit lawn, yard ->
    # sunlit yard), modulated by its own fine brightness pattern so paving joints, gravel and grass texture survive.
    lum_h = lin_half @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lum_smooth = np.maximum(cv2.GaussianBlur(lum_h, (0, 0), 3.0), 0.004)
    w_lum = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    out = np.empty_like(mosaic)
    band = 1024
    for y0 in range(0, h, band):
        y1 = min(h, y0 + band)
        hy0, hy1 = y0 // 2, (y1 + 1) // 2
        size = (w, y1 - y0)
        s = cv2.resize(shadow_h[hy0:hy1], size, interpolation=cv2.INTER_LINEAR)[:, :, None]
        ref = cv2.resize(ref_rgb_h[hy0:hy1], size, interpolation=cv2.INTER_LINEAR)
        sm = cv2.resize(lum_smooth[hy0:hy1], size, interpolation=cv2.INTER_LINEAR)
        lin = lut[mosaic[y0:y1]]
        detail = np.clip((lin @ w_lum) / sm, 0.6, 1.6)[:, :, None]
        lifted = np.maximum(ref * detail * strength, lin)  # never darken
        out[y0:y1] = linear_to_srgb8(lin * (1.0 - s) + lifted * s)
    return out, shadow_h


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.environ.get("KINDENHEIM_DOP20_CACHE", DEFAULT_CACHE))
    ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--shadow-strength", type=float, default=0.92)
    ap.add_argument("--preview", action="store_true", help="only write before/after crops into the cache work dir")
    args = ap.parse_args()

    layout = mosaic_layout()
    work = os.path.join(os.path.dirname(args.cache.rstrip("/")), "work")
    os.makedirs(work, exist_ok=True)

    print("[ortho] assembling mosaic ...", flush=True)
    raw = load_mosaic(args.cache, layout)
    print("[ortho] lifting baked shadows ...", flush=True)
    processed, shadow_h = deshadow(raw, args.shadow_strength, layout)

    g = GUTTER_PX
    map_px = layout["mapPx"]
    if args.preview:
        # Village centre crop (x -200..+210 m, z -260..+150 m)
        cx, cy = g + map_px // 2, g + map_px // 2
        x0, y0 = cx - 1000, cy - 1300
        Image.fromarray(raw[y0:y0 + 2048, x0:x0 + 2048]).save(os.path.join(work, "preview_raw.jpg"), quality=88)
        Image.fromarray(processed[y0:y0 + 2048, x0:x0 + 2048]).save(os.path.join(work, "preview_deshadow.jpg"), quality=88)
        print(f"[ortho] preview crops written to {work}")
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    tile_px = map_px // TILES_PER_SIDE
    if tile_px * TILES_PER_SIDE != map_px:
        raise RuntimeError("Map pixel size is not divisible by the tile count")
    total_bytes = 0
    for row in range(TILES_PER_SIDE):
        for col in range(TILES_PER_SIDE):
            y0 = row * tile_px
            x0 = col * tile_px
            tile = processed[y0:y0 + tile_px + 2 * g, x0:x0 + tile_px + 2 * g]
            path = os.path.join(OUT_DIR, f"hi_{row}_{col}.webp")
            Image.fromarray(tile, "RGB").save(path, "WEBP", quality=args.quality, method=6)
            total_bytes += os.path.getsize(path)
        print(f"[ortho] tile row {row} done ({total_bytes / 1e6:.1f} MB so far)", flush=True)

    inner_p = np.ascontiguousarray(processed[g:g + map_px, g:g + map_px])
    base = cv2.resize(inner_p, (BASE_SIZE, BASE_SIZE), interpolation=cv2.INTER_AREA)
    base_path = os.path.join(OUT_DIR, "base.webp")
    Image.fromarray(base, "RGB").save(base_path, "WEBP", quality=args.quality + 4, method=6)
    base_bytes = os.path.getsize(base_path)
    # 2048 px copy shipped as data/terrain/orthophoto.jpg in the production bundle (minimap + benchmark overlay only;
    # the 4096 px source orthophoto.jpg stays untouched as the offline reference). See vite.config.ts.
    minimap_path = os.path.join(OUT_DIR, "minimap.jpg")
    Image.fromarray(cv2.resize(base, (2048, 2048), interpolation=cv2.INTER_AREA), "RGB").save(
        minimap_path, "JPEG", quality=82, optimize=True, progressive=True)

    inner_r = np.ascontiguousarray(raw[g:g + map_px, g:g + map_px])
    Image.fromarray(cv2.resize(inner_r, (BASE_SIZE, BASE_SIZE), interpolation=cv2.INTER_AREA), "RGB").save(
        os.path.join(work, "ortho_raw_4096.png"))
    Image.fromarray(base, "RGB").save(os.path.join(work, "ortho_processed_4096.png"))
    sh = shadow_h[g // 2:(g + map_px) // 2, g // 2:(g + map_px) // 2]
    Image.fromarray(np.round(cv2.resize(sh, (BASE_SIZE, BASE_SIZE), interpolation=cv2.INTER_AREA) * 255).astype(np.uint8), "L").save(
        os.path.join(work, "shadow_4096.png"))

    manifest = {
        "attribution": ATTRIBUTION,
        "licence": "Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0)",
        "licenceUrl": "https://www.govdata.de/dl-de/by-2-0",
        "source": f"LVermGeo RLP OpenData DOP20 WMS {WMS_URL} (layer {WMS_LAYER}, EPSG:25832, native 0.2 m/px)",
        "processing": "mosaicked, baked cast shadows on non-vegetated ground lifted and de-blued, WebP re-encoded",
        "mapSizeM": map_px * GSD_M,
        "base": {"file": "base.webp", "sizePx": BASE_SIZE, "metresPerPixel": map_px * GSD_M / BASE_SIZE, "bytes": base_bytes},
        "tiles": {
            "perSide": TILES_PER_SIDE,
            "tileSizeM": tile_px * GSD_M,
            "tilePx": tile_px,
            "gutterPx": g,
            "imagePx": tile_px + 2 * g,
            "metresPerPixel": GSD_M,
            "filePattern": "hi_{row}_{col}.webp",
            "rowOrder": "row 0 = north (z = -mapSize/2), col 0 = west (x = -mapSize/2)",
            "bytes": total_bytes,
        },
    }
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"[ortho] {TILES_PER_SIDE ** 2} tiles {total_bytes / 1e6:.2f} MB + base {base_bytes / 1e6:.2f} MB -> {OUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ortho] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
