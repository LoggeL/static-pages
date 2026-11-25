#!/usr/bin/env python3
"""
Aerial-Matched Agricultural Fields & Rural Scenery Layout Builder for Kindenheim (Rheinland-Pfalz).

Reads:
  - data/osm/kindenheim_scene.json
  - data/meta.json
  - data/terrain/orthophoto.jpg    (4096x4096 DOP20 RGB aligned pixel-exact to [-1024, +1024])
  - data/terrain/landuse_mask.png  (2048x2048 landuse mask aligned pixel-exact to [-1024, +1024])
  - data/terrain/heightmap.bin     (513x513 float32 little-endian, row-major N->S, W->E)

Writes:
  - data/osm/fields_layout.json
  - Optional debug visualization (--debug-img <path>) overlaid on DOP20 orthophoto.

Coordinate conventions (strictly matching data/meta.json, src/terrain.ts & src/fields.ts):
  - x in [-1024, +1024] (+East)
  - z in [-1024, +1024] (+South, -North)
  - y = terrain height in meters above minElevationM (171.708m)
  - Linear props & crop rowAngleRad: Three.js rotation.y where local +X maps to (cos(r), -sin(r)) in world (x, z).
  - Point props (vineyardRoses, hochsitze, waysideCrosses): Three.js rotation.y where local +Z front faces (sin(r), cos(r)) in world (x, z).
"""

import argparse
import json
import math
import os
import random
from collections import Counter

import cv2
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
SCENE_PATH = os.path.join(PROJECT_ROOT, "data/osm/kindenheim_scene.json")
META_PATH = os.path.join(PROJECT_ROOT, "data/meta.json")
ORTHO_PATH = os.path.join(PROJECT_ROOT, "data/terrain/orthophoto.jpg")
MASK_PATH = os.path.join(PROJECT_ROOT, "data/terrain/landuse_mask.png")
HEIGHTMAP_PATH = os.path.join(PROJECT_ROOT, "data/terrain/heightmap.bin")
OUT_PATH = os.path.join(PROJECT_ROOT, "data/osm/fields_layout.json")

MAP_SIZE_M = 2048.0
HALF_MAP_M = 1024.0
MASK_DIM = 2048  # 1.0 m / pixel


# ---------------------------------------------------------------------------
# Coordinate & Terrain Helpers
# ---------------------------------------------------------------------------

def xz_to_px(x: float, z: float, dim: int = MASK_DIM) -> tuple[int, int]:
    px = int(round(((x + HALF_MAP_M) / MAP_SIZE_M) * (dim - 1)))
    py = int(round(((z + HALF_MAP_M) / MAP_SIZE_M) * (dim - 1)))
    return (max(0, min(dim - 1, px)), max(0, min(dim - 1, py)))


def px_to_xz(px: float, py: float, dim: int = MASK_DIM) -> tuple[float, float]:
    x = (px / (dim - 1)) * MAP_SIZE_M - HALF_MAP_M
    z = (py / (dim - 1)) * MAP_SIZE_M - HALF_MAP_M
    return (x, z)


def load_heightmap(path: str, grid_size: int = 513) -> np.ndarray:
    hm = np.fromfile(path, dtype=np.float32)
    assert hm.size == grid_size * grid_size, f"Unexpected heightmap len {hm.size}"
    return hm.reshape((grid_size, grid_size))


def sample_height(hm: np.ndarray, x: float, z: float) -> float:
    n = hm.shape[0]
    u = ((x + HALF_MAP_M) / MAP_SIZE_M) * (n - 1)
    v = ((z + HALF_MAP_M) / MAP_SIZE_M) * (n - 1)
    u = max(0.0, min(n - 1.0001, u))
    v = max(0.0, min(n - 1.0001, v))
    x0, y0 = int(u), int(v)
    x1, y1 = min(n - 1, x0 + 1), min(n - 1, y0 + 1)
    fx, fy = u - x0, v - y0
    h00 = float(hm[y0, x0])
    h10 = float(hm[y0, x1])
    h01 = float(hm[y1, x0])
    h11 = float(hm[y1, x1])
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy


def sample_slope_deg(hm: np.ndarray, x: float, z: float, step: float = 4.0) -> float:
    hx = (sample_height(hm, x + step, z) - sample_height(hm, x - step, z)) / (2.0 * step)
    hz = (sample_height(hm, x, z + step) - sample_height(hm, x, z - step)) / (2.0 * step)
    return math.degrees(math.atan(math.hypot(hx, hz)))


def dir_to_three_rot_y_x(dx: float, dz: float) -> float:
    """Three.js rotation.y where local +X maps to (cos(r), -sin(r)) in world (x, z)."""
    return math.atan2(-dz, dx)


def dir_to_three_rot_y_z(dx: float, dz: float) -> float:
    """Three.js rotation.y where local +Z front maps to (sin(r), cos(r)) in world (x, z)."""
    return math.atan2(dx, dz)


def normalize_row_angle(rad: float) -> float:
    """Wrap 180-degree symmetric row angle into (-pi/2, +pi/2]."""
    while rad <= -math.pi * 0.5:
        rad += math.pi
    while rad > math.pi * 0.5:
        rad -= math.pi
    return rad


def rgb_to_hex(rgb) -> str:
    r = max(0, min(255, int(round(rgb[0]))))
    g = max(0, min(255, int(round(rgb[1]))))
    b = max(0, min(255, int(round(rgb[2]))))
    return f"#{r:02x}{g:02x}{b:02x}"


def rgb_to_lab_exact(rgb_uint8: np.ndarray) -> tuple[float, float, float]:
    """Exact CIE Lab (L in 0..100, a in -128..127, b in -128..127) from single RGB [0..255]."""
    arr = np.array([[[rgb_uint8[0] / 255.0, rgb_uint8[1] / 255.0, rgb_uint8[2] / 255.0]]], dtype=np.float32)
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)[0, 0]
    return (float(lab[0]), float(lab[1]), float(lab[2]))


def point_in_poly(px: float, pz: float, poly: list[list[float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if ((zi > pz) != (zj > pz)) and (px < (xj - xi) * (pz - zi) / (zj - zi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


# ---------------------------------------------------------------------------
# Color & Structure-Tensor Orientation Analysis on DOP20 Orthophoto
# ---------------------------------------------------------------------------

def measure_row_angle_from_ortho_and_obb(
    poly_px_2k: np.ndarray,
    comp_mask_2k: np.ndarray,
    ortho_gray_4k: np.ndarray,
) -> tuple[float, str]:
    """
    Estimate agricultural row/furrow direction in Three.js rotation.y convention (+X along row).
    Combines minimum-area OBB long-edge direction with DOP20 orthophoto structure-tensor
    furrow detection when strong coherent tramlines/furrows exist inside the field.
    """
    rect = cv2.minAreaRect(poly_px_2k.astype(np.float32))
    box = cv2.boxPoints(rect)
    e0 = box[1] - box[0]
    e1 = box[2] - box[1]
    long_edge = e0 if np.linalg.norm(e0) >= np.linalg.norm(e1) else e1
    obb_rot = normalize_row_angle(dir_to_three_rot_y_x(float(long_edge[0]), float(long_edge[1])))

    ys, xs = np.where(comp_mask_2k > 0)
    if len(xs) < 600:
        return obb_rot, "obb"

    x0, x1 = max(0, int(xs.min())), min(MASK_DIM - 1, int(xs.max()))
    y0, y1 = max(0, int(ys.min())), min(MASK_DIM - 1, int(ys.max()))
    fx0, fx1 = x0 * 2, min(4095, x1 * 2 + 1)
    fy0, fy1 = y0 * 2, min(4095, y1 * 2 + 1)
    if (fx1 - fx0) < 32 or (fy1 - fy0) < 32:
        return obb_rot, "obb"

    sub_mask = comp_mask_2k[y0:y1 + 1, x0:x1 + 1]
    eroded = cv2.erode(sub_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    if int(eroded.sum()) < 400 * 255:
        return obb_rot, "obb"

    eroded_4k = cv2.resize(eroded, (fx1 - fx0 + 1, fy1 - fy0 + 1), interpolation=cv2.INTER_NEAREST)
    patch = ortho_gray_4k[fy0:fy1 + 1, fx0:fx1 + 1].astype(np.float32)
    blur = cv2.GaussianBlur(patch, (5, 5), 1.2)
    gx = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3)

    valid = eroded_4k > 127
    gx_v = gx[valid]
    gy_v = gy[valid]
    if gx_v.size < 800:
        return obb_rot, "obb"

    jxx = float(np.mean(gx_v * gx_v))
    jyy = float(np.mean(gy_v * gy_v))
    jxy = float(np.mean(gx_v * gy_v))
    trace = jxx + jyy
    if trace < 1e-3:
        return obb_rot, "obb"
    diff = jxx - jyy
    coherence = math.hypot(diff, 2.0 * jxy) / (trace + 1e-6)

    if coherence >= 0.24:
        grad_angle = 0.5 * math.atan2(2.0 * jxy, diff)
        row_dx = -math.sin(grad_angle)
        row_dz = math.cos(grad_angle)
        ortho_rot = normalize_row_angle(dir_to_three_rot_y_x(row_dx, row_dz))
        return ortho_rot, f"ortho(coh={coherence:.2f})"

    return obb_rot, "obb"


def sample_parcel_color_stats(comp_mask_2k: np.ndarray, ortho_2k: np.ndarray) -> dict:
    """Sample DOP20 RGB & exact CIE Lab inside an eroded interior of the field polygon."""
    ys, xs = np.where(comp_mask_2k > 0)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    sub_m = comp_mask_2k[y0:y1 + 1, x0:x1 + 1]
    eroded = cv2.erode(sub_m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    use_m = eroded if int((eroded > 0).sum()) >= 120 else sub_m
    sub_rgb = ortho_2k[y0:y1 + 1, x0:x1 + 1][use_m > 0]

    med_rgb = np.median(sub_rgb, axis=0)
    mean_rgb = np.mean(sub_rgb, axis=0)
    std_rgb = np.std(sub_rgb, axis=0)
    L, a, b = rgb_to_lab_exact(med_rgb)
    exg = float(med_rgb[1] - 0.5 * (med_rgb[0] + med_rgb[2]))
    warmth = float(med_rgb[0] - med_rgb[2])
    tex_std = float(np.mean(std_rgb))

    # Gently lifted aerial tint hex for close-up vibrancy while keeping satellite ΔE minimal
    tint_rgb = med_rgb.copy().astype(np.float32)
    lum = 0.299 * tint_rgb[0] + 0.587 * tint_rgb[1] + 0.114 * tint_rgb[2]
    tint_rgb = np.clip(lum + (tint_rgb - lum) * 1.10, 0, 255)

    return {
        "meanRgb": [int(round(c)) for c in mean_rgb],
        "medianRgb": [int(round(c)) for c in med_rgb],
        "lab": [round(L, 2), round(a, 2), round(b, 2)],
        "exg": round(exg, 2),
        "warmth": round(warmth, 2),
        "textureStd": round(tex_std, 2),
        "aerialTintHex": rgb_to_hex(tint_rgb),
    }


def classify_crop_from_aerial(
    stats: dict,
    area_ha: float,
    cx: float,
    cz: float,
    source_type: str,
    near_orchard_trees: int,
    near_waterway: bool,
    idx_seed: int,
) -> tuple[str, float]:
    """
    Classify each real Kindenheim field strictly calibrated to its DOP20 orthophoto Lab color,
    greenness (ExG), warmth (R-B), area, and Pfalz agricultural context.
    Returns (cropType, densityScale).
    """
    L, a, b = stats["lab"]
    exg = stats["exg"]
    warmth = stats["warmth"]

    if source_type in ("meadow", "grass", "scrub"):
        return ("orchard", 0.90) if near_orchard_trees >= 3 else ("meadow", 1.0)

    if near_orchard_trees >= 4 and area_ha <= 3.5:
        return ("orchard", 0.92)

    # Dark brown freshly plowed soil -> keep soil visible, NEVER cover with bright green crops!
    if (L < 49.0 and a > -7.5 and exg < 15.0) or (L < 51.0 and a > -5.5 and b < 14.5):
        return ("plowed", 0.12)

    # Village-fringe / riparian small green meadows (along Kinderbach or cemeteries)
    if near_waterway and area_ha < 2.2 and a <= -7.2:
        return ("meadow", 1.0)

    # Rich/deep green fields (negative Lab a, strong ExG -> sugarbeet or corn!)
    if a <= -8.6 and exg >= 17.5:
        if L <= 53.5 and (a <= -10.2 or stats["textureStd"] >= 15.5):
            if area_ha >= 2.2 and ((idx_seed % 3 == 0) or (a <= -11.0 and L < 51.5)):
                return ("corn", 1.0)
            return ("sugarbeet", 1.0)
        elif area_ha >= 1.8 and L < 58.0:
            return ("corn" if (idx_seed % 2 == 0) else "sugarbeet", 1.0)
        elif area_ha < 1.2 and L < 56.0:
            return ("meadow", 1.0)
        else:
            if L >= 58.5 and b >= 16.5:
                return ("sunflower", 0.95)
            return ("sugarbeet", 1.0)

    # Brightest warm pale-straw / freshly harvested fields -> stubble (with straw bale stacks!)
    if (L >= 61.0 and a >= -6.2) or (a >= -4.8 and L >= 57.5):
        return ("stubble", 0.95)

    # Bright yellow-green / sunny warm olive parcels -> Pfalz summer sunflowers!
    if 54.5 <= L <= 64.0 and -8.6 < a <= -6.2 and b >= 17.2 and area_ha >= 0.9:
        if (idx_seed % 3 == 1) or (L >= 57.5 and b >= 19.0 and a <= -7.0):
            return ("sunflower", 0.95)

    # Warm golden-ochre / olive-gold summer grain -> wheat!
    if b >= 13.0 and warmth >= 21.0:
        return ("wheat", 1.0)

    if area_ha < 1.0 and a <= -6.5:
        return ("meadow", 0.95)

    return ("wheat", 1.0)


# ---------------------------------------------------------------------------
# Sub-Field Segmentation for Giant Multi-Field Arable Blocks
# ---------------------------------------------------------------------------

def segment_large_arable_block(
    comp_mask_2k: np.ndarray,
    ortho_2k: np.ndarray,
    area_ha: float,
    rng_seed: int,
) -> list[np.ndarray]:
    """
    Split huge multi-parcel farmland blocks (> 4.5 ha) ONLY along genuine strong color
    boundaries visible in DOP20 orthophoto (merging any adjacent sub-clusters whose
    median CIE Lab ΔE < 6.8 so a single uniform field never splits into noisy blotches!).
    """
    if area_ha <= 4.8:
        return [comp_mask_2k]

    ys, xs = np.where(comp_mask_2k > 0)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bw = x1 - x0 + 1
    bh = y1 - y0 + 1

    # Work at 4m/px so intra-field soil-moisture streaks vanish and only true parcel borders remain!
    sw = max(12, bw // 4)
    sh = max(12, bh // 4)
    sub_mask = cv2.resize(comp_mask_2k[y0:y1 + 1, x0:x1 + 1], (sw, sh), interpolation=cv2.INTER_NEAREST)
    sub_rgb = cv2.resize(ortho_2k[y0:y1 + 1, x0:x1 + 1], (sw, sh), interpolation=cv2.INTER_AREA)

    smooth_rgb = cv2.bilateralFilter(sub_rgb, d=9, sigmaColor=28, sigmaSpace=16)
    smooth_lab = cv2.cvtColor(smooth_rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)

    valid_pts = np.where(sub_mask > 127)
    if len(valid_pts[0]) < 150:
        return [comp_mask_2k]

    # Check if the whole block has strong color bimodality/multimodality before splitting
    L_v = smooth_lab[valid_pts[0], valid_pts[1], 0]
    a_v = smooth_lab[valid_pts[0], valid_pts[1], 1]
    b_v = smooth_lab[valid_pts[0], valid_pts[1], 2]
    color_spread = math.hypot(float(np.std(L_v)), float(np.std(a_v)) * 2.2, float(np.std(b_v)) * 1.5)
    if color_spread < 5.5 and area_ha < 14.0:
        return [comp_mask_2k]

    k = max(2, min(5, int(round(area_ha / 5.8))))
    diag = math.hypot(sw, sh) + 1e-6
    xn = (valid_pts[1] / diag) * 20.0
    yn = (valid_pts[0] / diag) * 20.0
    feats = np.stack([L_v * 1.15, a_v * 2.6, b_v * 2.0, xn, yn], axis=1).astype(np.float32)

    cv2.setRNGSeed(rng_seed)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 35, 0.25)
    _, labels, _ = cv2.kmeans(feats, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    labels = labels.flatten()

    # Merge cluster pairs whose median Lab ΔE is tiny (< 5.8) so uniform fields stay intact!
    cluster_labs = {}
    for c in range(k):
        m = labels == c
        if m.sum() == 0:
            continue
        cluster_labs[c] = np.array([np.median(L_v[m]), np.median(a_v[m]), np.median(b_v[m])])

    parent = {c: c for c in range(k)}
    def find(u):
        while parent[u] != u:
            parent[u] = parent[parent[u]]
            u = parent[u]
        return u

    for c1 in range(k):
        for c2 in range(c1 + 1, k):
            if c1 in cluster_labs and c2 in cluster_labs:
                de = float(np.linalg.norm(cluster_labs[c1] - cluster_labs[c2]))
                if de < 5.8:
                    parent[find(c2)] = find(c1)

    merged_labels = np.array([find(int(c)) for c in labels], dtype=np.int32)
    unique_c = sorted(set(merged_labels.tolist()))
    if len(unique_c) <= 1:
        return [comp_mask_2k]

    label_img = np.full((sh, sw), -1, dtype=np.int32)
    label_img[valid_pts[0], valid_pts[1]] = merged_labels

    # Smooth cluster boundaries strongly at 4m/px so fields have clean agricultural edges
    sub_masks_out = []
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    for c in unique_c:
        cm = ((label_img == c).astype(np.uint8)) * 255
        cm = cv2.morphologyEx(cm, cv2.MORPH_CLOSE, kern)
        cm = cv2.morphologyEx(cm, cv2.MORPH_OPEN, kern)
        n_cc, cc_lbl, cc_stats, _ = cv2.connectedComponentsWithStats(cm, connectivity=4)
        for ci in range(1, n_cc):
            # At 4m/px, 1 px = 16 m2 -> 420 px = 0.67 ha minimum clean sub-field
            if cc_stats[ci, cv2.CC_STAT_AREA] < 420:
                continue
            part_small = ((cc_lbl == ci).astype(np.uint8)) * 255
            part_full = cv2.resize(part_small, (bw, bh), interpolation=cv2.INTER_NEAREST)
            part_full = cv2.bitwise_and(part_full, comp_mask_2k[y0:y1 + 1, x0:x1 + 1])
            if int((part_full > 0).sum()) < 6000:
                continue
            full_canvas = np.zeros_like(comp_mask_2k)
            full_canvas[y0:y1 + 1, x0:x1 + 1] = part_full
            sub_masks_out.append(full_canvas)

    return sub_masks_out if sub_masks_out else [comp_mask_2k]


def mask_to_clean_polygon(comp_mask_2k: np.ndarray, epsilon_m: float = 3.5) -> list[list[float]] | None:
    """Extract outer contour of binary 1m/px mask and simplify to crisp world-meter polygon."""
    contours, _ = cv2.findContours(comp_mask_2k, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 600:
        return None
    approx = cv2.approxPolyDP(largest, epsilon_m, True)
    if len(approx) < 3:
        approx = cv2.approxPolyDP(largest, 1.5, True)
    if len(approx) < 3:
        return None
    pts = []
    for pt in approx[:, 0, :]:
        wx, wz = px_to_xz(float(pt[0]), float(pt[1]), MASK_DIM)
        pts.append([round(wx, 2), round(wz, 2)])
    return pts


# ---------------------------------------------------------------------------
# Semantic Exclusion Masks (100% aligned with src/fields.ts FieldOccupancyGrid!)
# ---------------------------------------------------------------------------

def build_exclusion_masks(scene: dict, mask_rgb: np.ndarray) -> dict:
    """Build exact 1m/px (2048x2048) semantic masks matching src/fields.ts clearance rules."""
    bldg_strict = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    for b in scene["buildings"]:
        fp = b.get("footprint")
        if fp and len(fp) >= 3:
            pts = np.array([xz_to_px(p[0], p[1]) for p in fp], dtype=np.int32)
            cv2.fillPoly(bldg_strict, [pts], 255)
        elif b.get("center"):
            cx, cz = xz_to_px(b["center"][0], b["center"][1])
            cv2.circle(bldg_strict, (cx, cz), 6, 255, -1)

    # Matching src/fields.ts FLAG_BUILDING pad (3.0m -> 4px radius) + yard buffer (14m) for crops
    bldg_prop_excl = cv2.dilate(bldg_strict, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    bldg_yard = cv2.dilate(bldg_strict, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (29, 29)))

    # Built-up commercial/industrial cluster closure (catches paved yards around Raiffeisenstraße halls!)
    bldg_cluster = cv2.morphologyEx(
        bldg_strict,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (45, 45)),
    )
    bldg_cluster = cv2.dilate(bldg_cluster, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)))

    # Road clearance matching src/fields.ts:
    #   track: w=3.2 + 2*1.4 = 6.0m total -> thickness=7px (radius 3.5m)
    #   secondary: w=7.4 + 2*2.3 = 12.0m total -> thickness=13px (radius 6.5m)
    #   residential: w=5.0 + 2*2.3 = 9.6m total -> thickness=11px
    road_prop_excl = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    road_crop_excl = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    paved_bridge_excl = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    for r in scene["roads"]:
        pts = np.array([xz_to_px(p[0], p[2]) for p in r["points"]], dtype=np.int32)
        if len(pts) < 2:
            continue
        hw = r.get("highway") or ""
        w_base = float(r.get("widthM") or (7.4 if hw in ("primary", "secondary") else 3.2 if hw == "track" else 5.0))
        pad_prop = 1.6 if hw in ("track", "path") else 2.5
        thick_prop = max(6, int(round(w_base + 2.0 * pad_prop)))
        thick_crop = max(7, int(round(w_base + 2.0 * (pad_prop + 0.6))))
        cv2.polylines(road_prop_excl, [pts], False, 255, thickness=thick_prop)
        cv2.polylines(road_crop_excl, [pts], False, 255, thickness=thick_crop)
        if hw not in ("track", "path", "footway", "steps"):
            # Extra wide clearance around paved roads & bridges (e.g. Triftstraße Kinderbach bridge!) so 5m hedgerows never clip railings
            cv2.polylines(paved_bridge_excl, [pts], False, 255, thickness=max(16, int(round(w_base + 11.0))))

    water_excl = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    for ww in scene["waterways"]:
        pts = np.array([xz_to_px(p[0], p[2]) for p in ww["points"]], dtype=np.int32)
        if len(pts) >= 2:
            cv2.polylines(water_excl, [pts], False, 255, thickness=5)

    # Explicit non-arable zones:
    #   1) Sportplatz pitch NW of Sport- & Freizeithalle: x in [-18, 132], z in [-370, -260]
    #   2) Raiffeisenstraße west industrial hall gravel/parking lot: x in [-615, -340], z in [315, 445]
    non_arable = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    cv2.rectangle(non_arable, xz_to_px(-18.0, -370.0), xz_to_px(132.0, -260.0), 255, -1)
    cv2.rectangle(non_arable, xz_to_px(-600.0, 325.0), xz_to_px(-475.0, 425.0), 255, -1)

    cemetery_mask = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    vineyard_mask = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    forest_mask = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    residential_mask = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)

    for lu in scene["landuse"]:
        pts_raw = lu.get("points") or []
        if len(pts_raw) < 3:
            continue
        pts = np.array([xz_to_px(p[0], p[1]) for p in pts_raw], dtype=np.int32)
        t = lu.get("type")
        if t == "cemetery":
            cv2.fillPoly(cemetery_mask, [pts], 255)
        elif t == "vineyard":
            cv2.fillPoly(vineyard_mask, [pts], 255)
        elif t in ("forest", "wood"):
            cv2.fillPoly(forest_mask, [pts], 255)
        elif t == "residential":
            cv2.fillPoly(residential_mask, [pts], 255)

    r_ch = mask_rgb[:, :, 0]
    vineyard_mask = cv2.bitwise_or(vineyard_mask, ((r_ch == 96).astype(np.uint8) * 255))
    forest_mask = cv2.bitwise_or(forest_mask, ((r_ch == 32).astype(np.uint8) * 255))
    residential_mask = cv2.bitwise_or(residential_mask, ((r_ch == 192).astype(np.uint8) * 255))

    non_arable = cv2.bitwise_or(non_arable, cemetery_mask)
    non_arable = cv2.bitwise_or(non_arable, bldg_cluster)

    prop_blocked = cv2.bitwise_or(bldg_prop_excl, road_prop_excl)
    prop_blocked = cv2.bitwise_or(prop_blocked, water_excl)

    return {
        "bldg_strict": bldg_strict,
        "bldg_prop_excl": bldg_prop_excl,
        "bldg_yard": bldg_yard,
        "bldg_cluster": bldg_cluster,
        "road_prop_excl": road_prop_excl,
        "road_crop_excl": road_crop_excl,
        "paved_bridge_excl": paved_bridge_excl,
        "water_excl": water_excl,
        "non_arable": non_arable,
        "cemetery": cemetery_mask,
        "vineyard": vineyard_mask,
        "forest": forest_mask,
        "residential": residential_mask,
        "prop_blocked": prop_blocked,
    }


def is_mask_set(mask_2k: np.ndarray, x: float, z: float, radius_px: int = 0) -> bool:
    if abs(x) > HALF_MAP_M - 12 or abs(z) > HALF_MAP_M - 12:
        return True
    px, py = xz_to_px(x, z)
    if radius_px <= 0:
        return bool(mask_2k[py, px] > 0)
    x0, x1 = max(0, px - radius_px), min(MASK_DIM - 1, px + radius_px)
    y0, y1 = max(0, py - radius_px), min(MASK_DIM - 1, py + radius_px)
    return bool(mask_2k[y0:y1 + 1, x0:x1 + 1].any())


# ---------------------------------------------------------------------------
# Field-Edge Rural Props Placement
# ---------------------------------------------------------------------------

def place_hedgerows(
    scene: dict,
    masks: dict,
    hm: np.ndarray,
    rng: random.Random,
) -> list[dict]:
    """
    Place natural Pfalz Windschutzhecken / Feldgehölze (5.0m bays along local +X):
      1. Kinderbach riparian corridor (dense lush green hedgerow lining both banks!)
      2. Organic windbreak segments along rural Feldwege outside the village
    """
    hedgerows = []
    placed_pts = []

    def too_close(x: float, z: float, min_d: float) -> bool:
        for px, pz in placed_pts:
            if (px - x) * (px - x) + (pz - z) * (pz - z) < min_d * min_d:
                return True
        return False

    # 1. Kinderbach riparian hedgerows (offset 4.2-5.4m from ditch centerline -> clear of water_excl & road bridges!)
    for ww in scene["waterways"]:
        pts = [(p[0], p[2]) for p in ww["points"]]
        if len(pts) < 2:
            continue
        bay_step = 5.0
        acc = 2.0
        for i in range(len(pts) - 1):
            x0, z0 = pts[i]
            x1, z1 = pts[i + 1]
            seg = math.hypot(x1 - x0, z1 - z0)
            if seg < 0.5:
                continue
            tx, tz = (x1 - x0) / seg, (z1 - z0) / seg
            nx, nz = -tz, tx
            t = 0.0
            while t < seg:
                step_rem = bay_step - acc
                if t + step_rem <= seg:
                    t += step_rem
                    acc = 0.0
                    mx = x0 + tx * t
                    mz = z0 + tz * t
                    rot = dir_to_three_rot_y_x(tx, tz)
                    for side in (-1.0, 1.0):
                        if rng.random() < 0.18:
                            continue
                        off = 4.2 + rng.uniform(0.0, 1.3)
                        hx = mx + nx * side * off
                        hz = mz + nz * side * off
                        if is_mask_set(masks["prop_blocked"], hx, hz, radius_px=0):
                            continue
                        if is_mask_set(masks["paved_bridge_excl"], hx, hz, radius_px=0):
                            continue
                        if is_mask_set(masks["bldg_prop_excl"], hx, hz, radius_px=1):
                            continue
                        if too_close(hx, hz, 4.2):
                            continue
                        hy = sample_height(hm, hx, hz)
                        hedgerows.append({
                            "x": round(hx, 2),
                            "y": round(hy, 3),
                            "z": round(hz, 2),
                            "rotationRad": round(rot + rng.uniform(-0.12, 0.12), 4),
                            "scale": round(rng.uniform(0.92, 1.18), 3),
                            "context": "kinderbach_riparian",
                        })
                        placed_pts.append((hx, hz))
                else:
                    acc += seg - t
                    break

    # 2. Rural Feldweg Windschutzhecken (periodic organic 15-40m windbreak clusters along agricultural tracks!)
    track_roads = [r for r in scene["roads"] if r.get("highway") == "track" and len(r.get("points", [])) >= 2]
    for r in track_roads:
        pts = [(p[0], p[2]) for p in r["points"]]
        total_len = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
        if total_len < 55.0:
            continue
        if rng.random() > 0.52:
            continue
        side = 1.0 if rng.random() > 0.5 else -1.0
        bay_step = 5.0
        dist_traveled = 0.0
        in_burst = False
        burst_end = rng.uniform(16.0, 42.0)
        next_burst = burst_end + rng.uniform(35.0, 80.0)
        acc = 0.0

        for i in range(len(pts) - 1):
            x0, z0 = pts[i]
            x1, z1 = pts[i + 1]
            seg = math.hypot(x1 - x0, z1 - z0)
            if seg < 0.5:
                continue
            tx, tz = (x1 - x0) / seg, (z1 - z0) / seg
            nx, nz = -tz, tx
            t = 0.0
            while t < seg:
                step_rem = bay_step - acc
                if t + step_rem <= seg:
                    t += step_rem
                    dist_traveled += step_rem
                    acc = 0.0
                    if dist_traveled > next_burst:
                        in_burst = True
                        burst_end = dist_traveled + rng.uniform(16.0, 38.0)
                        next_burst = burst_end + rng.uniform(45.0, 100.0)
                    elif dist_traveled > burst_end:
                        in_burst = False
                    if not in_burst:
                        continue
                    mx = x0 + tx * t
                    mz = z0 + tz * t
                    if math.hypot(mx, mz) < 250.0:
                        continue
                    # Offset 4.6-5.2m off track centerline -> cleanly outside 3.0m track clearance!
                    off = 4.6 + rng.uniform(0.0, 0.7)
                    hx = mx + nx * side * off
                    hz = mz + nz * side * off
                    if is_mask_set(masks["prop_blocked"], hx, hz, radius_px=0):
                        continue
                    if is_mask_set(masks["residential"], hx, hz, radius_px=1):
                        continue
                    if is_mask_set(masks["vineyard"], hx, hz, radius_px=0):
                        continue
                    if too_close(hx, hz, 4.4):
                        continue
                    if len(hedgerows) >= 750:
                        break
                    hy = sample_height(hm, hx, hz)
                    rot = dir_to_three_rot_y_x(tx, tz)
                    hedgerows.append({
                        "x": round(hx, 2),
                        "y": round(hy, 3),
                        "z": round(hz, 2),
                        "rotationRad": round(rot + rng.uniform(-0.10, 0.10), 4),
                        "scale": round(rng.uniform(0.86, 1.12), 3),
                        "context": "feldweg_windbreak",
                    })
                    placed_pts.append((hx, hz))
                else:
                    acc += seg - t
                    dist_traveled += seg - t
                    break
            if len(hedgerows) >= 750:
                break
        if len(hedgerows) >= 750:
            break

    return hedgerows


def place_wildflower_strips(
    scene: dict,
    fields: list[dict],
    masks: dict,
    hm: np.ndarray,
    hedgerows: list[dict],
    rng: random.Random,
) -> list[dict]:
    """
    Place Pfalz Blühstreifen (5.0m x 1.6m wildflower_strip.glb along local +X) along Feldweg
    borders next to arable fields, strictly outside road occupancy (offset 4.2-4.8m from track centerline!).
    """
    arable_mask = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
    for f in fields:
        if f["cropType"] in ("wheat", "stubble", "sunflower", "corn", "sugarbeet", "meadow", "orchard"):
            pts = np.array([xz_to_px(p[0], p[1]) for p in f["points"]], dtype=np.int32)
            cv2.fillPoly(arable_mask, [pts], 255)
    arable_near = cv2.dilate(arable_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (23, 23)))

    hedge_tree = cKDTree([[h["x"], h["z"]] for h in hedgerows]) if hedgerows else None

    strips = []
    placed = []

    def too_close(x: float, z: float, min_d: float) -> bool:
        for px, pz in placed:
            if (px - x) * (px - x) + (pz - z) * (pz - z) < min_d * min_d:
                return True
        return False

    track_roads = [r for r in scene["roads"] if r.get("highway") in ("track", "unclassified") and len(r.get("points", [])) >= 2]
    for r in track_roads:
        pts = [(p[0], p[2]) for p in r["points"]]
        hw = r.get("highway") or "track"
        base_off = 4.2 if hw == "track" else 5.2
        bay_step = 5.2
        acc = 2.5
        for i in range(len(pts) - 1):
            x0, z0 = pts[i]
            x1, z1 = pts[i + 1]
            seg = math.hypot(x1 - x0, z1 - z0)
            if seg < 0.5:
                continue
            tx, tz = (x1 - x0) / seg, (z1 - z0) / seg
            nx, nz = -tz, tx
            t = 0.0
            while t < seg:
                step_rem = bay_step - acc
                if t + step_rem <= seg:
                    t += step_rem
                    acc = 0.0
                    mx = x0 + tx * t
                    mz = z0 + tz * t
                    rot = dir_to_three_rot_y_x(tx, tz)
                    for side in (-1.0, 1.0):
                        if rng.random() > 0.50:
                            continue
                        off = base_off + rng.uniform(0.0, 0.6)
                        wx = mx + nx * side * off
                        wz = mz + nz * side * off
                        if is_mask_set(masks["prop_blocked"], wx, wz, radius_px=0):
                            continue
                        if not is_mask_set(arable_near, wx, wz, radius_px=0):
                            continue
                        if is_mask_set(masks["residential"], wx, wz, radius_px=1):
                            continue
                        if is_mask_set(masks["vineyard"], wx, wz, radius_px=0):
                            continue
                        if hedge_tree is not None and hedge_tree.query([wx, wz])[0] < 2.8:
                            continue
                        if too_close(wx, wz, 4.6):
                            continue
                        if len(strips) >= 560:
                            break
                        wy = sample_height(hm, wx, wz)
                        strips.append({
                            "x": round(wx, 2),
                            "y": round(wy, 3),
                            "z": round(wz, 2),
                            "rotationRad": round(rot + rng.uniform(-0.08, 0.08), 4),
                            "scale": round(rng.uniform(0.90, 1.12), 3),
                        })
                        placed.append((wx, wz))
                else:
                    acc += seg - t
                    break
            if len(strips) >= 560:
                break
        if len(strips) >= 560:
            break

    return strips


def place_vineyard_roses(
    scene: dict,
    masks: dict,
    hm: np.ndarray,
    rng: random.Random,
) -> list[dict]:
    """
    Place iconic Pfalz Weinberg-Rosenstöcke (vineyard_rose_post.glb, rose bush facing +Z)
    at road-facing vineyard row ends along L 450 (East & West), Burgweg, and prominent Feldwege!
    """
    l450_pts = []
    track_pts = []
    for r in scene["roads"]:
        hw = r.get("highway") or ""
        name = (r.get("name") or "").lower()
        ref = (r.get("ref") or "").lower()
        pts = [(p[0], p[2]) for p in r.get("points", [])]
        if len(pts) < 2:
            continue
        is_l450 = hw in ("primary", "secondary") or "450" in ref or "burgweg" in name
        target = l450_pts if is_l450 else (track_pts if hw in ("track", "unclassified", "tertiary") else None)
        if target is None:
            continue
        for i in range(len(pts) - 1):
            x0, z0 = pts[i]
            x1, z1 = pts[i + 1]
            seg = math.hypot(x1 - x0, z1 - z0)
            steps = max(1, int(math.ceil(seg / 3.0)))
            for s in range(steps + 1):
                f = s / steps
                target.append((x0 + (x1 - x0) * f, z0 + (z1 - z0) * f))

    l450_tree = cKDTree(l450_pts) if l450_pts else None
    track_tree = cKDTree(track_pts) if track_pts else None

    roses = []
    placed = []

    def too_close(x: float, z: float, min_d: float) -> bool:
        for px, pz in placed:
            if (px - x) * (px - x) + (pz - z) * (pz - z) < min_d * min_d:
                return True
        return False

    vineyards = [lu for lu in scene["landuse"] if lu.get("type") == "vineyard" and len(lu.get("points", [])) >= 3]

    def vy_priority(vy):
        cx, cz = vy.get("center", [0.0, 0.0])
        d_l450 = l450_tree.query([cx, cz])[0] if l450_tree else 999.0
        # Give East L450 approach (sv_vineyard_edge_east!) & Burgweg top priority
        east_bonus = -120.0 if (cx > 450 and -400 < cz < -80) else 0.0
        return d_l450 + math.hypot(cx, cz) * 0.22 + east_bonus

    vineyards.sort(key=vy_priority)

    for vy in vineyards:
        pts = vy["points"]
        row_rot = float(vy.get("rowAngleRad", 0.0))
        row_dx = math.cos(row_rot)
        row_dz = -math.sin(row_rot)

        n = len(pts)
        for i in range(n):
            ax, az = pts[i]
            bx, bz = pts[(i + 1) % n]
            edge_len = math.hypot(bx - ax, bz - az)
            if edge_len < 6.0:
                continue
            edx, edz = (bx - ax) / edge_len, (bz - az) / edge_len

            in_x, in_z = -edz, edx
            mid_x, mid_z = (ax + bx) * 0.5, (az + bz) * 0.5
            if not point_in_poly(mid_x + in_x * 2.0, mid_z + in_z * 2.0, pts):
                in_x, in_z = -in_x, -in_z

            d_l450 = l450_tree.query([mid_x, mid_z])[0] if l450_tree else 999.0
            d_track = track_tree.query([mid_x, mid_z])[0] if track_tree else 999.0

            is_hero_l450 = d_l450 < 28.0
            is_track_edge = (not is_hero_l450) and (d_track < 15.0) and (math.hypot(mid_x, mid_z) < 760.0)
            if not is_hero_l450 and not is_track_edge:
                continue

            # For Feldwege, prefer row-head edges; for hero L450 (incl. East L450!), adorn ALL road-facing vineyard flanks!
            dot_row = abs(edx * row_dx + edz * row_dz)
            if (not is_hero_l450) and dot_row > 0.86:
                continue

            spacing = 5.6 if is_hero_l450 else 12.0
            s_cur = 2.5
            while s_cur < edge_len - 2.0:
                px = ax + edx * s_cur + in_x * 1.4
                pz = az + edz * s_cur + in_z * 1.4
                s_cur += spacing

                pt_d_l450 = l450_tree.query([px, pz])[0] if l450_tree else 999.0
                pt_d_track = track_tree.query([px, pz])[0] if track_tree else 999.0
                if is_hero_l450 and (pt_d_l450 > 20.0 or pt_d_l450 < 6.4):
                    continue
                if is_track_edge and (pt_d_track > 12.0 or pt_d_track < 3.6):
                    continue

                if is_mask_set(masks["prop_blocked"], px, pz, radius_px=0):
                    continue
                if too_close(px, pz, 4.8 if is_hero_l450 else 9.5):
                    continue
                if len(roses) >= 260:
                    break

                py = sample_height(hm, px, pz)
                # Point +Z rose blooms outward toward the road!
                out_rot = dir_to_three_rot_y_z(-in_x, -in_z)
                roses.append({
                    "x": round(px, 2),
                    "y": round(py, 3),
                    "z": round(pz, 2),
                    "rotationRad": round(out_rot + rng.uniform(-0.18, 0.18), 4),
                    "scale": round(rng.uniform(0.94, 1.14), 3),
                    "vineyardId": vy["id"],
                    "roadside": "L450" if is_hero_l450 else "feldweg",
                })
                placed.append((px, pz))
            if len(roses) >= 260:
                break
        if len(roses) >= 260:
            break

    return roses


def place_straw_stacks(
    fields: list[dict],
    masks: dict,
    hm: np.ndarray,
    rng: random.Random,
) -> list[dict]:
    """Place pyramid stacks of 6 golden straw bales on harvested stubble & select wheat fields."""
    stacks = []
    placed = []

    def too_close(x: float, z: float, min_d: float) -> bool:
        for px, pz in placed:
            if (px - x) * (px - x) + (pz - z) * (pz - z) < min_d * min_d:
                return True
        return False

    candidates = [f for f in fields if f["cropType"] == "stubble" and f["areaHa"] >= 0.45]
    wheat_cands = [f for f in fields if f["cropType"] == "wheat" and f["areaHa"] >= 2.2]
    candidates.sort(key=lambda f: -f["areaHa"])
    wheat_cands.sort(key=lambda f: -f["areaHa"])

    for field_list, max_per_field, total_cap in [(candidates, 2, 22), (wheat_cands, 1, 28)]:
        for f in field_list:
            if len(stacks) >= total_cap:
                break
            pts = f["points"]
            cx, cz = f["center"]
            placed_here = 0
            verts = list(pts)
            rng.shuffle(verts)
            for vx, vz in verts:
                if placed_here >= max_per_field or len(stacks) >= total_cap:
                    break
                for frac in (0.14, 0.24, 0.36):
                    sx = vx + (cx - vx) * frac
                    sz = vz + (cz - vz) * frac
                    if not point_in_poly(sx, sz, pts):
                        continue
                    if is_mask_set(masks["prop_blocked"], sx, sz, radius_px=4):
                        continue
                    if is_mask_set(masks["residential"], sx, sz, radius_px=4):
                        continue
                    if sample_slope_deg(hm, sx, sz) > 9.0:
                        continue
                    if too_close(sx, sz, 65.0):
                        continue
                    sy = sample_height(hm, sx, sz)
                    stacks.append({
                        "x": round(sx, 2),
                        "y": round(sy, 3),
                        "z": round(sz, 2),
                        "rotationRad": round(f["rowAngleRad"] + rng.uniform(-0.15, 0.15), 4),
                        "scale": round(rng.uniform(0.95, 1.08), 3),
                        "fieldId": f["id"],
                        "cropType": f["cropType"],
                    })
                    placed.append((sx, sz))
                    placed_here += 1
                    break

    return stacks


def place_hochsitze(
    masks: dict,
    hm: np.ndarray,
    rng: random.Random,
) -> list[dict]:
    """
    Place 8 authentic German wooden hunter's high-seats (Hochsitze) at scenic field,
    woodland, and vineyard corners overlooking open Kindenheim arable plains!
    """
    target_zones = [
        ("NE_Waldrand",          785.0, -760.0, (-0.7,  0.7)),
        ("N_Frohnacker_Ebene",  -295.0, -560.0, (-0.6, -0.8)),
        ("NW_Feldgrenze",       -690.0, -680.0, ( 0.8,  0.6)),
        ("W_Weinberg_Acker",    -665.0, -245.0, (-0.8,  0.5)),
        ("SW_Wiesengrund",      -640.0,  560.0, ( 0.7,  0.7)),
        ("S_Kinderbach_Kuppe",  -290.0,  645.0, (-0.5,  0.85)),
        ("SE_Weinberg_Kuppe",    415.0,  620.0, (-0.7, -0.7)),
        ("E_Kinderbach_Wiese",   905.0, -140.0, (-0.8,  0.6)),
    ]

    hochsitze = []
    for name, tx, tz, (look_x, look_z) in target_zones:
        best_pt = None
        best_score = -1e9
        for rad in (0.0, 12.0, 24.0, 42.0, 65.0, 95.0, 130.0):
            steps = 1 if rad == 0 else 18
            for k in range(steps):
                ang = (k / steps) * math.pi * 2.0
                cx = tx + math.cos(ang) * rad
                cz = tz + math.sin(ang) * rad
                if is_mask_set(masks["prop_blocked"], cx, cz, radius_px=3):
                    continue
                if is_mask_set(masks["residential"], cx, cz, radius_px=8):
                    continue
                if is_mask_set(masks["cemetery"], cx, cz, radius_px=6):
                    continue
                if is_mask_set(masks["vineyard"], cx, cz, radius_px=1):
                    continue
                slope = sample_slope_deg(hm, cx, cz)
                if slope > 11.5:
                    continue
                score = -rad * 1.2 - slope * 3.0
                if score > best_score:
                    best_score = score
                    best_pt = (cx, cz)
            if best_pt is not None and rad <= 42.0:
                break

        if best_pt is None:
            continue
        hx, hz = best_pt
        hy = sample_height(hm, hx, hz)
        yaw = dir_to_three_rot_y_z(look_x, look_z)
        hochsitze.append({
            "name": name,
            "x": round(hx, 2),
            "y": round(hy, 3),
            "z": round(hz, 2),
            "rotationRad": round(yaw, 4),
            "scale": round(rng.uniform(0.96, 1.05), 3),
        })

    return hochsitze


def place_wayside_crosses(
    scene: dict,
    masks: dict,
    hm: np.ndarray,
) -> list[dict]:
    """
    Place 4 historic Pfälzer Sandstein Wegekreuze at classic rural Feldweg junctions
    around Kindenheim, set cleanly in the grassy shoulder facing the junction (+Z).
    """
    node_adj = {}
    for r in scene["roads"]:
        if r.get("highway") not in ("track", "unclassified", "secondary", "tertiary"):
            continue
        pts = [(p[0], p[2]) for p in r.get("points", [])]
        if len(pts) < 2:
            continue
        for idx, (x, z) in enumerate(pts):
            key = (int(round(x / 3.0)), int(round(z / 3.0)))
            if key not in node_adj:
                node_adj[key] = {"x": x, "z": z, "dirs": []}
            if idx > 0:
                dx, dz = x - pts[idx - 1][0], z - pts[idx - 1][1]
                d = math.hypot(dx, dz)
                if d > 0.5:
                    node_adj[key]["dirs"].append((-dx / d, -dz / d))
            if idx + 1 < len(pts):
                dx, dz = pts[idx + 1][0] - x, pts[idx + 1][1] - z
                d = math.hypot(dx, dz)
                if d > 0.5:
                    node_adj[key]["dirs"].append((dx / d, dz / d))

    junctions = []
    for info in node_adj.values():
        x, z = info["x"], info["z"]
        dist_center = math.hypot(x, z)
        if dist_center < 280.0 or dist_center > 860.0:
            continue
        if len(info["dirs"]) < 3:
            continue
        angles = sorted(math.atan2(dz, dx) for dx, dz in info["dirs"])
        distinct = [angles[0]]
        for a in angles[1:]:
            if abs(a - distinct[-1]) > 0.55 and abs((a - distinct[0]) - 2 * math.pi) > 0.55:
                distinct.append(a)
        if len(distinct) >= 3:
            junctions.append((x, z, distinct))

    quadrants = [
        ("Wegekreuz_Nordwest", -1, -1),
        ("Wegekreuz_Nordost",   1, -1),
        ("Wegekreuz_Suedwest", -1,  1),
        ("Wegekreuz_Suedost",   1,  1),
    ]

    crosses = []
    for name, qx, qz in quadrants:
        q_cands = [j for j in junctions if j[0] * qx > 50 and j[1] * qz > 50]
        q_cands.sort(key=lambda j: abs(math.hypot(j[0], j[1]) - 500.0))

        placed = None
        for jx, jz, dirs in q_cands:
            for k in range(len(dirs)):
                a0 = dirs[k]
                a1 = dirs[(k + 1) % len(dirs)]
                if a1 < a0:
                    a1 += 2.0 * math.pi
                if (a1 - a0) < 0.7:
                    continue
                bis = 0.5 * (a0 + a1)
                for off in (4.8, 6.0, 7.4):
                    cx = jx + math.cos(bis) * off
                    cz = jz + math.sin(bis) * off
                    if is_mask_set(masks["prop_blocked"], cx, cz, radius_px=1):
                        continue
                    if is_mask_set(masks["residential"], cx, cz, radius_px=4):
                        continue
                    if sample_slope_deg(hm, cx, cz) > 10.0:
                        continue
                    yaw = dir_to_three_rot_y_z(jx - cx, jz - cz)
                    cy = sample_height(hm, cx, cz)
                    placed = {
                        "name": name,
                        "x": round(cx, 2),
                        "y": round(cy, 3),
                        "z": round(cz, 2),
                        "rotationRad": round(yaw, 4),
                        "scale": 1.0,
                    }
                    break
                if placed:
                    break
            if placed:
                break

        if placed:
            crosses.append(placed)

    return crosses


# ---------------------------------------------------------------------------
# Debug Overlay Visualization
# ---------------------------------------------------------------------------

def write_debug_overlay(
    ortho_2k: np.ndarray,
    fields: list[dict],
    hedgerows: list[dict],
    wildflowers: list[dict],
    roses: list[dict],
    straw_stacks: list[dict],
    hochsitze: list[dict],
    crosses: list[dict],
    out_path: str,
):
    crop_colors = {
        "wheat":     (235, 195,  65),
        "stubble":   (245, 222, 145),
        "corn":      ( 42, 148,  52),
        "sugarbeet": ( 85, 200,  70),
        "sunflower": (255, 225,  25),
        "meadow":    (130, 220, 120),
        "orchard":   ( 95, 185, 145),
        "plowed":    (135,  95,  65),
    }

    canvas = ortho_2k.copy()
    overlay = ortho_2k.copy()

    for f in fields:
        pts = np.array([xz_to_px(p[0], p[1]) for p in f["points"]], dtype=np.int32)
        col = crop_colors.get(f["cropType"], (200, 200, 200))
        cv2.fillPoly(overlay, [pts], col)
        cv2.polylines(canvas, [pts], True, col, 2)

    vis = cv2.addWeighted(canvas, 0.64, overlay, 0.36, 0)

    for f in fields:
        cx, cz = xz_to_px(f["center"][0], f["center"][1])
        r = f["rowAngleRad"]
        dx, dz = math.cos(r) * 18.0, -math.sin(r) * 18.0
        cv2.line(vis, (int(cx - dx), int(cz - dz)), (int(cx + dx), int(cz + dz)), (255, 255, 255), 2)
        if f["areaHa"] >= 1.0:
            label = f"{f['cropType'][:4]} {f['areaHa']:.1f}h"
            cv2.putText(vis, label, (cx - 28, cz + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (20, 20, 20), 2, cv2.LINE_AA)
            cv2.putText(vis, label, (cx - 28, cz + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)

    for h in hedgerows:
        px, py = xz_to_px(h["x"], h["z"])
        cv2.circle(vis, (px, py), 3, (10, 95, 28), -1)
    for w in wildflowers:
        px, py = xz_to_px(w["x"], w["z"])
        cv2.circle(vis, (px, py), 2, (255, 95, 210), -1)
    for r in roses:
        px, py = xz_to_px(r["x"], r["z"])
        cv2.circle(vis, (px, py), 4, (235, 30, 80), -1)
    for s in straw_stacks:
        px, py = xz_to_px(s["x"], s["z"])
        cv2.rectangle(vis, (px - 5, py - 5), (px + 5, py + 5), (255, 195, 20), -1)
        cv2.rectangle(vis, (px - 5, py - 5), (px + 5, py + 5), (40, 25, 0), 1)
    for hs in hochsitze:
        px, py = xz_to_px(hs["x"], hs["z"])
        cv2.circle(vis, (px, py), 8, (180, 95, 25), -1)
        cv2.circle(vis, (px, py), 8, (255, 255, 255), 2)
    for cr in crosses:
        px, py = xz_to_px(cr["x"], cr["z"])
        cv2.drawMarker(vis, (px, py), (255, 255, 255), cv2.MARKER_CROSS, 18, 4)
        cv2.drawMarker(vis, (px, py), (40, 140, 255), cv2.MARKER_CROSS, 16, 2)

    ly = 24
    for crop, col in crop_colors.items():
        cv2.rectangle(vis, (16, ly - 12), (34, ly + 4), col, -1)
        cv2.putText(vis, crop, (40, ly + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)
        ly += 22

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(vis).resize((1536, 1536), Image.LANCZOS).save(out_path, quality=88)
    print(f"[DEBUG] Saved layout overlay -> {out_path}")


# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug-img", type=str, default="", help="Optional debug JPG overlay path")
    args = parser.parse_args()

    with open(SCENE_PATH, encoding="utf-8") as f:
        scene = json.load(f)
    with open(META_PATH, encoding="utf-8") as f:
        meta = json.load(f)

    hm = load_heightmap(HEIGHTMAP_PATH, meta.get("gridSize", 513))
    mask_rgb = np.array(Image.open(MASK_PATH).convert("RGB"))
    ortho_4k = np.array(Image.open(ORTHO_PATH).convert("RGB"))
    ortho_2k = cv2.resize(ortho_4k, (MASK_DIM, MASK_DIM), interpolation=cv2.INTER_AREA)
    ortho_gray_4k = cv2.cvtColor(ortho_4k, cv2.COLOR_RGB2GRAY)

    masks = build_exclusion_masks(scene, mask_rgb)

    orch_trees = [(t["x"], t["z"]) for t in scene.get("trees", []) if "orchard" in (t.get("type") or "").lower()]
    orch_tree_kd = cKDTree(orch_trees) if orch_trees else None
    water_dist = cv2.distanceTransform(cv2.bitwise_not(masks["water_excl"]), cv2.DIST_L2, 3)

    rng = random.Random(67271)
    fields = []
    field_idx = 0
    claimed_mask = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)

    # 1. Explicit OSM agricultural polygons (meadow, grass, scrub, orchard)
    for lu in scene["landuse"]:
        lu_type = lu.get("type")
        if lu_type not in ("meadow", "grass", "scrub", "orchard"):
            continue
        pts_raw = lu.get("points") or []
        if len(pts_raw) < 3:
            continue
        poly_px = np.array([xz_to_px(p[0], p[1]) for p in pts_raw], dtype=np.int32)
        m = np.zeros((MASK_DIM, MASK_DIM), dtype=np.uint8)
        cv2.fillPoly(m, [poly_px], 255)
        m = cv2.bitwise_and(m, cv2.bitwise_not(masks["bldg_prop_excl"]))
        m = cv2.bitwise_and(m, cv2.bitwise_not(masks["road_crop_excl"]))
        area_m2 = int((m > 0).sum())
        if area_m2 < 120:
            continue

        pts_clean = mask_to_clean_polygon(m, epsilon_m=2.0) or [[round(p[0], 2), round(p[1], 2)] for p in pts_raw]
        area_ha = round(area_m2 / 10000.0, 3)
        ys, xs = np.where(m > 0)
        cx, cz = px_to_xz(float(xs.mean()), float(ys.mean()))
        stats = sample_parcel_color_stats(m, ortho_2k)
        rot_y, rot_src = measure_row_angle_from_ortho_and_obb(poly_px, m, ortho_gray_4k)

        near_orch = len(orch_tree_kd.query_ball_point([cx, cz], 45.0)) if orch_tree_kd else 0
        cpx, cpy = xz_to_px(cx, cz)
        near_ww = bool(water_dist[cpy, cpx] < 45.0)
        crop, dens = classify_crop_from_aerial(stats, area_ha, cx, cz, lu_type, near_orch, near_ww, field_idx)

        field_idx += 1
        claimed_mask = cv2.bitwise_or(claimed_mask, m)
        fields.append({
            "id": f"field_osm_{field_idx:03d}",
            "osmId": lu.get("id"),
            "source": f"osm:{lu_type}",
            "crop": crop,
            "cropType": crop,
            "density": dens,
            "areaHa": area_ha,
            "center": [round(cx, 2), round(cz, 2)],
            "elevationM": round(sample_height(hm, cx, cz), 2),
            "rowAngleRad": round(rot_y, 4),
            "rowAngleSource": rot_src,
            "aerialTintHex": stats["aerialTintHex"],
            "meanRgb": stats["meanRgb"],
            "aerialStats": {
                "medianRgb": stats["medianRgb"],
                "lab": stats["lab"],
                "exg": stats["exg"],
            },
            "points": pts_clean,
        })

    # 2. All real arable farmland blocks from landuse_mask.png + DOP20 orthophoto
    r_ch = mask_rgb[:, :, 0]
    arable_raw = ((r_ch == 224) | (r_ch == 144)).astype(np.uint8) * 255

    excl_all = masks["road_crop_excl"].copy()
    for key in ("water_excl", "bldg_yard", "non_arable", "vineyard", "forest", "residential"):
        excl_all = cv2.bitwise_or(excl_all, masks[key])
    excl_all = cv2.bitwise_or(excl_all, claimed_mask)

    arable_clean = cv2.bitwise_and(arable_raw, cv2.bitwise_not(excl_all))
    arable_clean = cv2.morphologyEx(
        arable_clean,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
    )

    n_cc, cc_lbl, cc_stats, _ = cv2.connectedComponentsWithStats(arable_clean, connectivity=4)
    comps = []
    for i in range(1, n_cc):
        area_px = int(cc_stats[i, cv2.CC_STAT_AREA])
        if area_px < 1200:
            continue
        comps.append((cc_stats[i, cv2.CC_STAT_TOP], cc_stats[i, cv2.CC_STAT_LEFT], i, area_px))
    comps.sort()

    for _, _, ci, area_px in comps:
        comp_m = ((cc_lbl == ci).astype(np.uint8)) * 255
        area_ha_raw = area_px / 10000.0
        sub_masks = segment_large_arable_block(comp_m, ortho_2k, area_ha_raw, rng_seed=1000 + ci)

        for sm in sub_masks:
            sm_area_m2 = int((sm > 0).sum())
            if sm_area_m2 < 1200:
                continue
            pts_clean = mask_to_clean_polygon(sm, epsilon_m=3.5)
            if not pts_clean or len(pts_clean) < 3:
                continue

            ys, xs = np.where(sm > 0)
            cx, cz = px_to_xz(float(xs.mean()), float(ys.mean()))
            area_ha = round(sm_area_m2 / 10000.0, 3)

            stats = sample_parcel_color_stats(sm, ortho_2k)
            L, a, b = stats["lab"]

            dist_village = math.hypot(cx - 20.0, cz + 60.0)
            if dist_village < 420.0 and area_ha < 1.3 and a > -2.5 and b < 11.5:
                continue

            poly_px = np.array([xz_to_px(p[0], p[1]) for p in pts_clean], dtype=np.int32)
            rot_y, rot_src = measure_row_angle_from_ortho_and_obb(poly_px, sm, ortho_gray_4k)

            near_orch = len(orch_tree_kd.query_ball_point([cx, cz], 55.0)) if orch_tree_kd else 0
            cpx, cpy = xz_to_px(cx, cz)
            near_ww = bool(water_dist[cpy, cpx] < 50.0)

            crop, dens = classify_crop_from_aerial(
                stats, area_ha, cx, cz, "farmland", near_orch, near_ww, field_idx
            )

            field_idx += 1
            fields.append({
                "id": f"field_dop_{field_idx:03d}",
                "osmId": None,
                "source": "dop20_segmented" if len(sub_masks) > 1 else "landuse_mask:farmland",
                "crop": crop,
                "cropType": crop,
                "density": dens,
                "areaHa": area_ha,
                "center": [round(cx, 2), round(cz, 2)],
                "elevationM": round(sample_height(hm, cx, cz), 2),
                "rowAngleRad": round(rot_y, 4),
                "rowAngleSource": rot_src,
                "aerialTintHex": stats["aerialTintHex"],
                "meanRgb": stats["meanRgb"],
                "aerialStats": {
                    "medianRgb": stats["medianRgb"],
                    "lab": stats["lab"],
                    "exg": stats["exg"],
                },
                "points": pts_clean,
            })

    # 3. Field-Edge Rural Props
    hedgerows = place_hedgerows(scene, masks, hm, rng)
    wildflower_strips = place_wildflower_strips(scene, fields, masks, hm, hedgerows, rng)
    vineyard_roses = place_vineyard_roses(scene, masks, hm, rng)
    straw_stacks = place_straw_stacks(fields, masks, hm, rng)
    hochsitze = place_hochsitze(masks, hm, rng)
    wayside_crosses = place_wayside_crosses(scene, masks, hm)

    crop_counts = Counter(f["cropType"] for f in fields)
    crop_area_ha = {}
    for f in fields:
        ct = f["cropType"]
        crop_area_ha[ct] = round(crop_area_ha.get(ct, 0.0) + f["areaHa"], 2)

    out_data = {
        "version": 1,
        "available": True,
        "municipality": "Kindenheim (Rheinland-Pfalz)",
        "season": "July/August Summer Harvest (DOP20 Aerial-Matched)",
        "coordinateSystem": "Three.js Y-up meters (+X East, -Z North, +Y Up above minElevationM=171.708m); rowAngleRad = rotation.y where local +X maps to (cos(r), -sin(r))",
        "summary": {
            "fieldCount": len(fields),
            "totalFieldAreaHa": round(sum(f["areaHa"] for f in fields), 2),
            "cropCounts": dict(sorted(crop_counts.items())),
            "cropAreaHa": dict(sorted(crop_area_ha.items())),
            "hedgerowCount": len(hedgerows),
            "wildflowerStripCount": len(wildflower_strips),
            "vineyardRoseCount": len(vineyard_roses),
            "strawStackCount": len(straw_stacks),
            "hochsitzCount": len(hochsitze),
            "waysideCrossCount": len(wayside_crosses),
        },
        "fields": fields,
        "hedgerows": hedgerows,
        "wildflowerStrips": wildflower_strips,
        "vineyardRoses": vineyard_roses,
        "strawStacks": straw_stacks,
        "hochsitze": hochsitze,
        "waysideCrosses": wayside_crosses,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out_data, f, separators=(",", ":"), ensure_ascii=False)

    fsize_kb = os.path.getsize(OUT_PATH) / 1024.0
    print(f"[LAYOUT] Wrote {OUT_PATH} ({fsize_kb:.1f} KB)")
    print(json.dumps(out_data["summary"], indent=2))

    if args.debug_img:
        write_debug_overlay(
            ortho_2k,
            fields,
            hedgerows,
            wildflower_strips,
            vineyard_roses,
            straw_stacks,
            hochsitze,
            wayside_crosses,
            args.debug_img,
        )


if __name__ == "__main__":
    main()
