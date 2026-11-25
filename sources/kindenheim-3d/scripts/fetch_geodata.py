#!/usr/bin/env python3
"""
Kindenheim 3D Geodata Pipeline
Fetches and processes official open geodata for Kindenheim (Rheinland-Pfalz, Germany):
  - Elevation (DEM): LVermGeo RLP OpenData DGM1 (1m LiDAR GeoTIFFs, 2026) -> fallback AWS Terrarium
  - Aerial Imagery:  LVermGeo RLP OpenData DOP20 WMS (20cm RGB, EPSG:25832) -> fallback Esri World Imagery
  - 3D Buildings:    LVermGeo RLP OpenData LoD2 CityGML (2026 surveyor-measured footprints/heights/roofs)
                     merged with OpenStreetMap API v0.6 tags, names, addresses & wineries
  - Roads/Landuse:   OpenStreetMap API v0.6 (L450/Hauptstrasse, village streets, Feldwege, 200+ vineyards,
                     farmland, woods, streams, trees, POIs)

Coordinate Contract (shared across Blender & Three.js):
  - Projection: ETRS89 / UTM Zone 32N (EPSG:25832)
  - Center: E = 439450.0, N = 5495600.0 (~49.60991 N, 8.16188 E — Kindenheim village core)
  - Map size: 2048m x 2048m -> local x in [-1024, +1024], z in [-1024, +1024]
  - Axes: +X = East, -Z = North (+Z = South), +Y = Up (meters above minElevationM)

Data Licenses:
  - LVermGeo RLP OpenData (DGM1, DOP20, LoD2): dl-de/by-2-0 (© GeoBasis-DE / LVermGeoRP)
  - OpenStreetMap: ODbL (© OpenStreetMap contributors)
"""

import io
import json
import math
import os
import random
import re
import struct
import sys
import time
from collections import Counter

import cv2
import lxml.etree as ET
import numpy as np
import requests
from PIL import Image

# ---------------------------------------------------------------------------
# Configuration & Constants
# ---------------------------------------------------------------------------
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
TERRAIN_DIR = os.path.join(DATA_DIR, "terrain")
OSM_DIR = os.path.join(DATA_DIR, "osm")
REF_DIR = os.path.join(DATA_DIR, "references")

CACHE_DIR = os.environ.get(
    "KINDENHEIM_CACHE_DIR",
    "/Users/logge/.gemini/antigravity-cli/brain/df78c4bb-9c8e-4455-93be-01f76267abd7/scratch/cache",
)

# Exact UTM Zone 32N (EPSG:25832) center on Kindenheim village core (near Martinskirche & Rathaus)
CENTER_UTM_E = 439450.0
CENTER_UTM_N = 5495600.0
MAP_SIZE_M = 2048.0
HALF_MAP_M = MAP_SIZE_M / 2.0  # 1024.0
HEIGHTMAP_GRID_SIZE = 513  # 4.0m vertex spacing, row-major N->S, W->E
ORTHO_SIZE = 4096          # 0.5m/px from 20cm DOP20 WMS
MASK_SIZE = 2048           # 1.0m/px landuse splat mask

USER_AGENT = "Kindenheim3D-Geodata/1.0 (+https://github.com/kindenheim-3d)"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})

# Landuse mask RGB legend (every class has a distinct R value spaced >= 16 AND readable RGB color)
LANDUSE_LEGEND = {
    "water":       {"classId": 8, "r": 16,  "rgb": [16, 120, 210]},
    "forest":      {"classId": 4, "r": 32,  "rgb": [32, 105, 48]},
    "road_asphalt":{"classId": 6, "r": 64,  "rgb": [64, 68, 76]},
    "vineyard":    {"classId": 2, "r": 96,  "rgb": [96, 175, 72]},
    "meadow":      {"classId": 3, "r": 144, "rgb": [144, 210, 110]},
    "road_track":  {"classId": 7, "r": 168, "rgb": [168, 148, 116]},
    "residential": {"classId": 5, "r": 192, "rgb": [192, 140, 120]},
    "farmland":    {"classId": 1, "r": 224, "rgb": [224, 198, 130]},
}

# AdV CityGML LoD2 roofType code -> normalized roofShape
LOD2_ROOF_MAP = {
    "1000": "flat",
    "2100": "skillion",
    "2200": "skillion",
    "3100": "gabled",
    "3200": "hipped",
    "3300": "half-hipped",
    "3400": "mansard",
    "3500": "pyramidal",
    "3600": "conical",
    "3700": "gabled",
    "3800": "gabled",
    "3900": "gabled",
    "4000": "gabled",
    "5000": "gabled",  # Mischform (complex Palatinate pitched roof)
    "9999": "gabled",
}

# ALKIS building function -> semantic category
ALKIS_FUNC_MAP = {
    "31001_1000": "residential",
    "31001_1010": "residential",
    "31001_1100": "residential",
    "31001_2000": "barn",         # Wirtschaft/Gewerbe/Landwirtschaft in Palatinate village
    "31001_2463": "garage",
    "31001_2513": "agricultural",
    "31001_2523": "agricultural",
    "31001_3040": "church",
    "31001_3041": "church",
    "31001_3060": "civic",
    "31001_3065": "civic",
    "31001_3081": "civic",
    "31001_3211": "civic",
    "51009_1610": "shed",
}

# ---------------------------------------------------------------------------
# Exact WGS84 <-> ETRS89 / UTM Zone 32N (EPSG:25832) Projection
# ---------------------------------------------------------------------------
WGS84_A = 6378137.0
WGS84_F = 1.0 / 298.257223563
WGS84_E2 = WGS84_F * (2.0 - WGS84_F)
WGS84_EP2 = WGS84_E2 / (1.0 - WGS84_E2)
UTM_K0 = 0.9996
UTM32_LON0 = math.radians(9.0)


def latlon_to_utm32(lat: float, lon: float) -> tuple[float, float]:
    phi = math.radians(lat)
    lam = math.radians(lon)
    sin_p = math.sin(phi)
    cos_p = math.cos(phi)
    tan_p = math.tan(phi)
    N = WGS84_A / math.sqrt(1.0 - WGS84_E2 * sin_p * sin_p)
    T = tan_p * tan_p
    C = WGS84_EP2 * cos_p * cos_p
    A = cos_p * (lam - UTM32_LON0)
    e2 = WGS84_E2
    M = WGS84_A * (
        (1.0 - e2 / 4.0 - 3.0 * e2**2 / 64.0 - 5.0 * e2**3 / 256.0) * phi
        - (3.0 * e2 / 8.0 + 3.0 * e2**2 / 32.0 + 45.0 * e2**3 / 1024.0) * math.sin(2.0 * phi)
        + (15.0 * e2**2 / 256.0 + 45.0 * e2**3 / 1024.0) * math.sin(4.0 * phi)
        - (35.0 * e2**3 / 3072.0) * math.sin(6.0 * phi)
    )
    E = 500000.0 + UTM_K0 * N * (
        A
        + (1.0 - T + C) * A**3 / 6.0
        + (5.0 - 18.0 * T + T * T + 72.0 * C - 58.0 * WGS84_EP2) * A**5 / 120.0
    )
    Nc = UTM_K0 * (
        M
        + N * tan_p * (
            A**2 / 2.0
            + (5.0 - T + 9.0 * C + 4.0 * C * C) * A**4 / 24.0
            + (61.0 - 58.0 * T + T * T + 600.0 * C - 330.0 * WGS84_EP2) * A**6 / 720.0
        )
    )
    return E, Nc


def utm32_to_latlon(E: float, Nc: float) -> tuple[float, float]:
    e2 = WGS84_E2
    e1 = (1.0 - math.sqrt(1.0 - e2)) / (1.0 + math.sqrt(1.0 - e2))
    x = E - 500000.0
    M = Nc / UTM_K0
    mu = M / (WGS84_A * (1.0 - e2 / 4.0 - 3.0 * e2**2 / 64.0 - 5.0 * e2**3 / 256.0))
    phi1 = (
        mu
        + (3.0 * e1 / 2.0 - 27.0 * e1**3 / 32.0) * math.sin(2.0 * mu)
        + (21.0 * e1**2 / 16.0 - 55.0 * e1**4 / 32.0) * math.sin(4.0 * mu)
        + (151.0 * e1**3 / 96.0) * math.sin(6.0 * mu)
        + (1097.0 * e1**4 / 512.0) * math.sin(8.0 * mu)
    )
    sin_p = math.sin(phi1)
    cos_p = math.cos(phi1)
    tan_p = math.tan(phi1)
    N1 = WGS84_A / math.sqrt(1.0 - e2 * sin_p * sin_p)
    T1 = tan_p * tan_p
    C1 = WGS84_EP2 * cos_p * cos_p
    R1 = WGS84_A * (1.0 - e2) / ((1.0 - e2 * sin_p * sin_p) ** 1.5)
    D = x / (N1 * UTM_K0)
    lat = phi1 - (N1 * tan_p / R1) * (
        D**2 / 2.0
        - (5.0 + 3.0 * T1 + 10.0 * C1 - 4.0 * C1**2 - 9.0 * WGS84_EP2) * D**4 / 24.0
        + (61.0 + 90.0 * T1 + 298.0 * C1 + 45.0 * T1**2 - 252.0 * WGS84_EP2 - 3.0 * C1**2) * D**6 / 720.0
    )
    lon = UTM32_LON0 + (
        D
        - (1.0 + 2.0 * T1 + C1) * D**3 / 6.0
        + (5.0 - 2.0 * C1 + 28.0 * T1 - 3.0 * C1**2 + 8.0 * WGS84_EP2 + 24.0 * T1**2) * D**5 / 120.0
    ) / cos_p
    return math.degrees(lat), math.degrees(lon)


def utm_to_local(E: float, N: float) -> tuple[float, float]:
    return E - CENTER_UTM_E, -(N - CENTER_UTM_N)


def latlon_to_local(lat: float, lon: float) -> tuple[float, float]:
    E, N = latlon_to_utm32(lat, lon)
    return utm_to_local(E, N)


# ---------------------------------------------------------------------------
# Geometry Utilities
# ---------------------------------------------------------------------------
def poly_signed_area(pts: list[tuple[float, float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        s += x1 * z2 - x2 * z1
    return 0.5 * s


def poly_area(pts: list[tuple[float, float]]) -> float:
    return abs(poly_signed_area(pts))


def poly_centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    n = len(pts)
    if n == 0:
        return (0.0, 0.0)
    a = poly_signed_area(pts)
    if abs(a) < 1e-6:
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    cx = cz = 0.0
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        cross = x1 * z2 - x2 * z1
        cx += (x1 + x2) * cross
        cz += (z1 + z2) * cross
    return (cx / (6.0 * a), cz / (6.0 * a))


def point_in_poly(x: float, z: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if ((zi > z) != (zj > z)) and (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def clean_polygon(pts: list[tuple[float, float]], min_dist: float = 0.18) -> list[tuple[float, float]]:
    if not pts:
        return []
    out = list(pts)
    if len(out) >= 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < min_dist:
        out = out[:-1]
    # Deduplicate close consecutive vertices
    dedup = []
    for p in out:
        if not dedup or math.hypot(p[0] - dedup[-1][0], p[1] - dedup[-1][1]) >= min_dist:
            dedup.append(p)
    if len(dedup) >= 2 and math.hypot(dedup[0][0] - dedup[-1][0], dedup[0][1] - dedup[-1][1]) < min_dist:
        dedup.pop()
    if len(dedup) < 3:
        return []
    # Remove nearly collinear points (angle < ~1.5 deg)
    cleaned = []
    n = len(dedup)
    for i in range(n):
        prev = dedup[(i - 1) % n]
        curr = dedup[i]
        nxt = dedup[(i + 1) % n]
        v1x, v1z = curr[0] - prev[0], curr[1] - prev[1]
        v2x, v2z = nxt[0] - curr[0], nxt[1] - curr[1]
        l1 = math.hypot(v1x, v1z)
        l2 = math.hypot(v2x, v2z)
        if l1 < 1e-6 or l2 < 1e-6:
            continue
        cross = abs(v1x * v2z - v1z * v2x) / (l1 * l2)
        dot = (v1x * v2x + v1z * v2z) / (l1 * l2)
        if cross > 0.025 or dot < 0.0:
            cleaned.append(curr)
    if len(cleaned) < 3:
        cleaned = dedup
    # Ensure consistent counter-clockwise winding in (x, z) plane (positive signed area in X-right, Z-down?
    # Note: in XZ looking down from +Y, CCW in standard math (x right, z up) is CW on screen;
    # let's standardize positive signed area in (x, z) so Blender/Three.js get uniform winding!)
    if poly_signed_area(cleaned) < 0:
        cleaned.reverse()
    return cleaned


def compute_obb(pts: list[tuple[float, float]]) -> tuple[float, float, float, float, float]:
    """
    Minimum-area oriented bounding box.
    Returns (widthM, depthM, rotationRad, centerX, centerZ) where widthM >= depthM
    and rotationRad is Three.js rotation.y such that local +X aligns to the widthM axis:
      world_dx = cos(rot), world_dz = -sin(rot)
    """
    n = len(pts)
    best = None
    for i in range(n):
        dx = pts[(i + 1) % n][0] - pts[i][0]
        dz = pts[(i + 1) % n][1] - pts[i][1]
        L = math.hypot(dx, dz)
        if L < 1e-6:
            continue
        ux, uz = dx / L, dz / L
        vx, vz = -uz, ux
        us = [p[0] * ux + p[1] * uz for p in pts]
        vs = [p[0] * vx + p[1] * vz for p in pts]
        w_m = max(us) - min(us)
        d_m = max(vs) - min(vs)
        area = w_m * d_m
        if best is None or area < best[0]:
            cu = 0.5 * (max(us) + min(us))
            cv = 0.5 * (max(vs) + min(vs))
            cx = cu * ux + cv * vx
            cz = cu * uz + cv * vz
            if w_m >= d_m:
                rot = math.atan2(-uz, ux)
                best = (area, w_m, d_m, rot, cx, cz)
            else:
                rot = math.atan2(-vz, vx)
                best = (area, d_m, w_m, rot, cx, cz)
    if best is None:
        return (4.0, 4.0, 0.0, pts[0][0], pts[0][1])
    # Normalize rotationRad to [-pi/2, pi/2) so building long axis is canonical
    rot = best[3]
    while rot >= math.pi / 2.0:
        rot -= math.pi
    while rot < -math.pi / 2.0:
        rot += math.pi
    return (best[1], best[2], rot, best[4], best[5])


def clip_polygon_to_box(pts: list[tuple[float, float]], half: float = HALF_MAP_M) -> list[tuple[float, float]]:
    """Sutherland-Hodgman polygon clipping to [-half, +half] x [-half, +half]."""
    def clip_edge(poly, inside_fn, intersect_fn):
        if not poly:
            return []
        res = []
        prev = poly[-1]
        prev_in = inside_fn(prev)
        for curr in poly:
            curr_in = inside_fn(curr)
            if curr_in:
                if not prev_in:
                    res.append(intersect_fn(prev, curr))
                res.append(curr)
            elif prev_in:
                res.append(intersect_fn(prev, curr))
            prev, prev_in = curr, curr_in
        return res

    def ix_x(a, b, x_val):
        t = (x_val - a[0]) / (b[0] - a[0] + 1e-12)
        return (x_val, a[1] + t * (b[1] - a[1]))

    def ix_z(a, b, z_val):
        t = (z_val - a[1]) / (b[1] - a[1] + 1e-12)
        return (a[0] + t * (b[0] - a[0]), z_val)

    out = list(pts)
    out = clip_edge(out, lambda p: p[0] >= -half, lambda a, b: ix_x(a, b, -half))
    out = clip_edge(out, lambda p: p[0] <= half,  lambda a, b: ix_x(a, b, half))
    out = clip_edge(out, lambda p: p[1] >= -half, lambda a, b: ix_z(a, b, -half))
    out = clip_edge(out, lambda p: p[1] <= half,  lambda a, b: ix_z(a, b, half))
    return out


def clip_and_resample_polyline(
    pts: list[tuple[float, float]],
    half: float = HALF_MAP_M,
    max_seg_m: float = 6.5,
) -> list[list[tuple[float, float]]]:
    """Clips a 2D polyline to [-half, +half] (returning 0+ segments) and resamples long segments."""
    def clip_seg(p0, p1):
        # Liang-Barsky
        x0, z0 = p0
        dx, dz = p1[0] - x0, p1[1] - z0
        t0, t1 = 0.0, 1.0
        for p, q in [(-dx, x0 + half), (dx, half - x0), (-dz, z0 + half), (dz, half - z0)]:
            if abs(p) < 1e-12:
                if q < 0:
                    return None
            else:
                r = q / p
                if p < 0:
                    if r > t1:
                        return None
                    if r > t0:
                        t0 = r
                else:
                    if r < t0:
                        return None
                    if r < t1:
                        t1 = r
        return ((x0 + t0 * dx, z0 + t0 * dz), (x0 + t1 * dx, z0 + t1 * dz))

    chains = []
    cur = []
    for i in range(len(pts) - 1):
        seg = clip_seg(pts[i], pts[i + 1])
        if seg is None:
            if len(cur) >= 2:
                chains.append(cur)
            cur = []
            continue
        a, b = seg
        if not cur:
            cur = [a, b]
        else:
            if math.hypot(cur[-1][0] - a[0], cur[-1][1] - a[1]) > 0.05:
                if len(cur) >= 2:
                    chains.append(cur)
                cur = [a, b]
            else:
                cur.append(b)
    if len(cur) >= 2:
        chains.append(cur)

    # Resample each chain so road ribbons drape cleanly over hills
    resampled_chains = []
    for chain in chains:
        out = [chain[0]]
        for i in range(len(chain) - 1):
            a, b = chain[i], chain[i + 1]
            dist = math.hypot(b[0] - a[0], b[1] - a[1])
            if dist < 0.05:
                continue
            steps = max(1, int(math.ceil(dist / max_seg_m)))
            for s in range(1, steps + 1):
                t = s / steps
                out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
        if len(out) >= 2:
            resampled_chains.append(out)
    return resampled_chains


# ---------------------------------------------------------------------------
# Step 1: Elevation DEM (Official LVermGeo RLP DGM1 1m LiDAR -> fallback Terrarium)
# ---------------------------------------------------------------------------
def download_cached(url: str, filename: str, timeout: int = 30) -> bytes:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, filename)
    if os.path.exists(path) and os.path.getsize(path) > 100:
        with open(path, "rb") as f:
            return f.read()
    r = SESSION.get(url, timeout=timeout)
    r.raise_for_status()
    with open(path, "wb") as f:
        f.write(r.content)
    return r.content


def fetch_elevation_grid() -> tuple[np.ndarray, float, float, str]:
    """
    Returns (height_rel_grid [513x513 float32, row 0 = North, col 0 = West],
             min_elev_m, max_elev_m, dem_source_desc).
    """
    # Try Official 2026 LVermGeo RLP DGM1 1m LiDAR GeoTIFFs
    e_km_min = int(math.floor((CENTER_UTM_E - HALF_MAP_M) / 1000.0))  # 438
    e_km_max = int(math.floor((CENTER_UTM_E + HALF_MAP_M) / 1000.0))  # 440
    n_km_min = int(math.floor((CENTER_UTM_N - HALF_MAP_M) / 1000.0))  # 5494
    n_km_max = int(math.floor((CENTER_UTM_N + HALF_MAP_M) / 1000.0))  # 5496

    nx_tiles = e_km_max - e_km_min + 1
    ny_tiles = n_km_max - n_km_min + 1
    mosaic_w = nx_tiles * 1000
    mosaic_h = ny_tiles * 1000
    mosaic = np.full((mosaic_h, mosaic_w), np.nan, dtype=np.float32)

    try:
        # Discover exact available filenames from official meta4 index (handles 2026 / 2022 year suffix)
        meta4_bytes = download_cached(
            "https://geobasis-rlp.de/data/dgm1/current/meta4/dgm1_tif_07332.meta4",
            "dgm1_tif_07332.meta4",
            timeout=25,
        )
        all_urls = re.findall(r"<url[^>]*>(.*?\.tif)</url>", meta4_bytes.decode("utf-8", errors="ignore"))
        tile_url_map = {}
        for u in all_urls:
            m = re.search(r"dgm1_32_(\d{3})_(\d{4})_1_rp_(\d{4})\.tif", u)
            if m:
                key = (int(m.group(1)), int(m.group(2)))
                yr = int(m.group(3))
                if key not in tile_url_map or yr > tile_url_map[key][0]:
                    tile_url_map[key] = (yr, u)

        loaded_tiles = 0
        for ek in range(e_km_min, e_km_max + 1):
            for nk in range(n_km_min, n_km_max + 1):
                if (ek, nk) not in tile_url_map:
                    raise RuntimeError(f"Missing DGM1 tile ({ek}, {nk})")
                yr, url = tile_url_map[(ek, nk)]
                fname = os.path.basename(url)
                tif_bytes = download_cached(url, fname, timeout=30)
                arr = np.array(Image.open(io.BytesIO(tif_bytes)), dtype=np.float32)
                if arr.shape != (1000, 1000):
                    raise RuntimeError(f"Unexpected DGM1 shape {arr.shape}")
                # Row 0 of tile (ek, nk) is North edge (nk+1)*1000 - 0.5
                col0 = (ek - e_km_min) * 1000
                row0 = (n_km_max - nk) * 1000
                mosaic[row0 : row0 + 1000, col0 : col0 + 1000] = arr
                loaded_tiles += 1

        if np.isnan(mosaic).any():
            raise RuntimeError("NaNs present in DGM1 mosaic")

        # Exact mosaic pixel centers:
        #   E(col) = e_km_min * 1000.0 + 0.5 + col
        #   N(row) = (n_km_max + 1) * 1000.0 - 0.5 - row
        origin_e = e_km_min * 1000.0 + 0.5
        origin_n = (n_km_max + 1) * 1000.0 - 0.5

        xs = np.linspace(-HALF_MAP_M, HALF_MAP_M, HEIGHTMAP_GRID_SIZE, dtype=np.float64)
        zs = np.linspace(-HALF_MAP_M, HALF_MAP_M, HEIGHTMAP_GRID_SIZE, dtype=np.float64)
        # Convert local (x, z) -> UTM (E, N) -> mosaic fractional (col, row)
        cols = (CENTER_UTM_E + xs) - origin_e
        rows = origin_n - (CENTER_UTM_N - zs)

        grid_e = np.empty((HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE), dtype=np.float32)
        c0 = np.floor(cols).astype(np.int32)
        c1 = np.clip(c0 + 1, 0, mosaic_w - 1)
        c0 = np.clip(c0, 0, mosaic_w - 1)
        fc = (cols - c0).astype(np.float32)[None, :]

        r0 = np.floor(rows).astype(np.int32)
        r1 = np.clip(r0 + 1, 0, mosaic_h - 1)
        r0 = np.clip(r0, 0, mosaic_h - 1)
        fr = (rows - r0).astype(np.float32)[:, None]

        v00 = mosaic[np.ix_(r0, c0)]
        v01 = mosaic[np.ix_(r0, c1)]
        v10 = mosaic[np.ix_(r1, c0)]
        v11 = mosaic[np.ix_(r1, c1)]
        grid_e = (
            v00 * (1.0 - fr) * (1.0 - fc)
            + v01 * (1.0 - fr) * fc
            + v10 * fr * (1.0 - fc)
            + v11 * fr * fc
        ).astype(np.float32)

        min_elev = float(np.min(grid_e))
        max_elev = float(np.max(grid_e))
        rel_grid = (grid_e - min_elev).astype(np.float32)
        print(f"[DEM] LVermGeo RLP DGM1 1m LiDAR ({loaded_tiles} tiles): {min_elev:.2f}m .. {max_elev:.2f}m (relief {max_elev - min_elev:.2f}m)")
        return rel_grid, min_elev, max_elev, "LVermGeo RLP OpenData DGM1 (1m LiDAR GeoTIFF, 2026, dl-de/by-2-0)"

    except Exception as e:
        print(f"[DEM] RLP DGM1 failed ({e}), falling back to AWS Mapzen Terrarium tiles (z=14)...")
        return fetch_terrarium_fallback()


def fetch_terrarium_fallback() -> tuple[np.ndarray, float, float, str]:
    z_zoom = 14
    def latlon_to_tile_xy(lat, lon, z):
        n = 2.0 ** z
        tx = (lon + 180.0) / 360.0 * n
        lat_rad = math.radians(lat)
        ty = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
        return tx, ty

    corners = [
        utm32_to_latlon(CENTER_UTM_E - HALF_MAP_M, CENTER_UTM_N + HALF_MAP_M),
        utm32_to_latlon(CENTER_UTM_E + HALF_MAP_M, CENTER_UTM_N - HALF_MAP_M),
    ]
    tx0, ty0 = latlon_to_tile_xy(corners[0][0], corners[0][1], z_zoom)
    tx1, ty1 = latlon_to_tile_xy(corners[1][0], corners[1][1], z_zoom)
    ix0, ix1 = int(math.floor(min(tx0, tx1))), int(math.floor(max(tx0, tx1)))
    iy0, iy1 = int(math.floor(min(ty0, ty1))), int(math.floor(max(ty0, ty1)))

    tile_cache = {}
    for ix in range(ix0, ix1 + 1):
        for iy in range(iy0, iy1 + 1):
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z_zoom}/{ix}/{iy}.png"
            raw = download_cached(url, f"terrarium_{z_zoom}_{ix}_{iy}.png", timeout=20)
            rgb = np.array(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32)
            elev = (rgb[:, :, 0] * 256.0 + rgb[:, :, 1] + rgb[:, :, 2] / 256.0) - 32768.0
            tile_cache[(ix, iy)] = elev

    grid = np.empty((HEIGHTMAP_GRID_SIZE, HEIGHTMAP_GRID_SIZE), dtype=np.float32)
    xs = np.linspace(-HALF_MAP_M, HALF_MAP_M, HEIGHTMAP_GRID_SIZE)
    zs = np.linspace(-HALF_MAP_M, HALF_MAP_M, HEIGHTMAP_GRID_SIZE)
    for r_i, z_val in enumerate(zs):
        for c_i, x_val in enumerate(xs):
            lat, lon = utm32_to_latlon(CENTER_UTM_E + x_val, CENTER_UTM_N - z_val)
            tx, ty = latlon_to_tile_xy(lat, lon, z_zoom)
            ix, iy = int(math.floor(tx)), int(math.floor(ty))
            px = min(255, max(0, int((tx - ix) * 256)))
            py = min(255, max(0, int((ty - iy) * 256)))
            grid[r_i, c_i] = tile_cache[(ix, iy)][py, px]
    min_elev = float(np.min(grid))
    max_elev = float(np.max(grid))
    return (grid - min_elev).astype(np.float32), min_elev, max_elev, "AWS Mapzen Terrarium Elevation Tiles (z=14)"


def make_height_sampler(rel_grid: np.ndarray):
    n = rel_grid.shape[0]
    def sample(x: float, z: float) -> float:
        u = ((x + HALF_MAP_M) / MAP_SIZE_M) * (n - 1)
        v = ((z + HALF_MAP_M) / MAP_SIZE_M) * (n - 1)
        u = max(0.0, min(n - 1.00001, u))
        v = max(0.0, min(n - 1.00001, v))
        c0 = int(math.floor(u))
        r0 = int(math.floor(v))
        c1 = min(n - 1, c0 + 1)
        r1 = min(n - 1, r0 + 1)
        fu = u - c0
        fv = v - r0
        return float(
            rel_grid[r0, c0] * (1.0 - fv) * (1.0 - fu)
            + rel_grid[r0, c1] * (1.0 - fv) * fu
            + rel_grid[r1, c0] * fv * (1.0 - fu)
            + rel_grid[r1, c1] * fv * fu
        )
    return sample


# ---------------------------------------------------------------------------
# Step 2: Aerial Orthophoto (LVermGeo RLP DOP20 WMS 4096x4096 -> fallback Esri)
# ---------------------------------------------------------------------------
def fetch_orthophoto(dest_path: str) -> str:
    minE = CENTER_UTM_E - HALF_MAP_M
    maxE = CENTER_UTM_E + HALF_MAP_M
    minN = CENTER_UTM_N - HALF_MAP_M
    maxN = CENTER_UTM_N + HALF_MAP_M

    # Fetch in 2x2 quadrants of 2048x2048 from official DOP20 WMS (fast, crisp, avoids huge single-request timeouts)
    try:
        midE = CENTER_UTM_E
        midN = CENTER_UTM_N
        qsize = ORTHO_SIZE // 2  # 2048
        quads = [
            (0,     0,     minE, midN, midE, maxN, "nw"),
            (qsize, 0,     midE, midN, maxE, maxN, "ne"),
            (0,     qsize, minE, minN, midE, midN, "sw"),
            (qsize, qsize, midE, minN, maxE, midN, "se"),
        ]
        canvas = Image.new("RGB", (ORTHO_SIZE, ORTHO_SIZE))
        for px, py, b_minE, b_minN, b_maxE, b_maxN, tag in quads:
            url = (
                "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi?"
                "SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=rp_dop20&STYLES="
                f"&CRS=EPSG:25832&BBOX={b_minE:.1f},{b_minN:.1f},{b_maxE:.1f},{b_maxN:.1f}"
                f"&WIDTH={qsize}&HEIGHT={qsize}&FORMAT=image/png"
            )
            raw = download_cached(url, f"dop20_{tag}_{qsize}.png", timeout=45)
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            if im.size != (qsize, qsize):
                raise RuntimeError(f"DOP20 quad {tag} wrong size {im.size}")
            # Verify non-blank
            std = float(np.std(np.array(im)))
            if std < 5.0:
                raise RuntimeError(f"DOP20 quad {tag} appears blank (std={std:.2f})")
            canvas.paste(im, (px, py))

        canvas.save(dest_path, "JPEG", quality=92, subsampling=0, optimize=True)
        size_mb = os.path.getsize(dest_path) / (1024 * 1024)
        print(f"[ORTHO] LVermGeo RLP DOP20 WMS saved {ORTHO_SIZE}x{ORTHO_SIZE} ({size_mb:.2f} MB)")
        return "LVermGeo RLP OpenData DOP20 WMS (20cm RGB, EPSG:25832, 4096x4096, dl-de/by-2-0)"
    except Exception as e:
        print(f"[ORTHO] RLP DOP20 WMS failed ({e}), falling back to Esri World Imagery...")
        return fetch_esri_orthophoto_fallback(dest_path)


def fetch_esri_orthophoto_fallback(dest_path: str) -> str:
    z = 17
    def latlon_to_tile_xy(lat, lon, zoom):
        n = 2.0 ** zoom
        tx = (lon + 180.0) / 360.0 * n
        lat_rad = math.radians(lat)
        ty = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
        return tx, ty

    nw = utm32_to_latlon(CENTER_UTM_E - HALF_MAP_M, CENTER_UTM_N + HALF_MAP_M)
    se = utm32_to_latlon(CENTER_UTM_E + HALF_MAP_M, CENTER_UTM_N - HALF_MAP_M)
    tx0, ty0 = latlon_to_tile_xy(nw[0], nw[1], z)
    tx1, ty1 = latlon_to_tile_xy(se[0], se[1], z)
    ix0, ix1 = int(math.floor(min(tx0, tx1))), int(math.floor(max(tx0, tx1)))
    iy0, iy1 = int(math.floor(min(ty0, ty1))), int(math.floor(max(ty0, ty1)))

    stitched = Image.new("RGB", ((ix1 - ix0 + 1) * 256, (iy1 - iy0 + 1) * 256))
    for ix in range(ix0, ix1 + 1):
        for iy in range(iy0, iy1 + 1):
            url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{iy}/{ix}"
            raw = download_cached(url, f"esri_{z}_{ix}_{iy}.jpg", timeout=20)
            stitched.paste(Image.open(io.BytesIO(raw)).convert("RGB"), ((ix - ix0) * 256, (iy - iy0) * 256))

    left = (tx0 - ix0) * 256
    top = (ty0 - iy0) * 256
    right = (tx1 - ix0) * 256
    bottom = (ty1 - iy0) * 256
    cropped = stitched.crop((left, top, right, bottom)).resize((ORTHO_SIZE, ORTHO_SIZE), Image.Resampling.LANCZOS)
    cropped.save(dest_path, "JPEG", quality=92, optimize=True)
    return "Esri World Imagery (z=17 stitched 4096x4096)"


# ---------------------------------------------------------------------------
# Step 3: Fetch OpenStreetMap + Official RLP LoD2 CityGML Buildings
# ---------------------------------------------------------------------------
def fetch_osm_raw() -> dict:
    # Exact WGS84 bbox padded by ~150m around the 2048x2048m square
    sw_lat, sw_lon = utm32_to_latlon(CENTER_UTM_E - HALF_MAP_M - 150, CENTER_UTM_N - HALF_MAP_M - 150)
    ne_lat, ne_lon = utm32_to_latlon(CENTER_UTM_E + HALF_MAP_M + 150, CENTER_UTM_N + HALF_MAP_M + 150)
    bbox_str = f"{sw_lon:.5f},{sw_lat:.5f},{ne_lon:.5f},{ne_lat:.5f}"
    url = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={bbox_str}"
    raw = download_cached(url, "kindenheim_osm_v06.json", timeout=35)
    data = json.loads(raw.decode("utf-8"))
    print(f"[OSM] Loaded {len(data.get('elements', []))} elements from OSM API v0.6 ({bbox_str})")
    return data


def extract_ridge_angle_from_lod2(roof_poslists: list[list[float]], obb_rot: float) -> float:
    """
    Finds the highest ridge edge from LoD2 RoofSurface 3D polygons and returns its canonical
    Three.js rotation.y in [-pi/2, pi/2), falling back to obb_rot if flat/ambiguous.
    """
    all_pts = []
    edges = []
    for vals in roof_poslists:
        pts3 = [(vals[i] - CENTER_UTM_E, -(vals[i + 1] - CENTER_UTM_N), vals[i + 2]) for i in range(0, len(vals), 3)]
        all_pts.extend(pts3)
        for i in range(len(pts3) - 1):
            edges.append((pts3[i], pts3[i + 1]))
    if not all_pts:
        return obb_rot
    z_max = max(p[2] for p in all_pts)
    z_min = min(p[2] for p in all_pts)
    if z_max - z_min < 0.8:
        return obb_rot

    # Longest nearly-horizontal edge within 0.35m of z_max = true roof ridge!
    best_len = 0.0
    best_ang = None
    for a, b in edges:
        if a[2] >= z_max - 0.35 and b[2] >= z_max - 0.35 and abs(a[2] - b[2]) < 0.25:
            dx = b[0] - a[0]
            dz = b[1] - a[1]
            L = math.hypot(dx, dz)
            if L > best_len and L >= 1.5:
                best_len = L
                best_ang = math.atan2(-dz, dx)
    if best_ang is None:
        return obb_rot
    while best_ang >= math.pi / 2.0:
        best_ang -= math.pi
    while best_ang < -math.pi / 2.0:
        best_ang += math.pi
    return best_ang


def parse_lod2_buildings() -> list[dict]:
    tiles = [
        "LoD2_32_438_5494_2_RP.gml",
        "LoD2_32_440_5494_2_RP.gml",
        "LoD2_32_438_5496_2_RP.gml",
        "LoD2_32_440_5496_2_RP.gml",
    ]
    ns = {
        "bldg": "http://www.opengis.net/citygml/building/1.0",
        "gml": "http://www.opengis.net/gml",
    }
    records = []
    for fn in tiles:
        url = f"https://geobasis-rlp.de/data/geb3dlo/current/gml/{fn}"
        raw = download_cached(url, fn, timeout=45)
        root = ET.fromstring(raw)
        for b in root.findall(".//bldg:Building", ns):
            gid = b.get("{http://www.opengis.net/gml}id")
            gs_els = b.findall(".//bldg:GroundSurface//gml:posList", ns)
            if not gs_els:
                continue
            vals = [float(x) for x in gs_els[0].text.split()]
            if len(vals) < 9:
                continue
            pts_raw = [(vals[i] - CENTER_UTM_E, -(vals[i + 1] - CENTER_UTM_N)) for i in range(0, len(vals), 3)]
            pts = clean_polygon(pts_raw, min_dist=0.18)
            if len(pts) < 3:
                continue
            cx, cz = poly_centroid(pts)
            if abs(cx) > HALF_MAP_M - 8.0 or abs(cz) > HALF_MAP_M - 8.0:
                continue
            area = poly_area(pts)
            if area < 12.0:
                continue

            ground_z = min(vals[2::3])
            rs_els = b.findall(".//bldg:RoofSurface//gml:posList", ns)
            roof_poslists = []
            rzs = []
            for pl in rs_els:
                rv = [float(x) for x in pl.text.split()]
                roof_poslists.append(rv)
                rzs.extend(rv[2::3])

            mh_text = b.findtext("bldg:measuredHeight", default=None, namespaces=ns)
            rt_code = b.findtext("bldg:roofType", default="", namespaces=ns) or ""
            fn_code = b.findtext("bldg:function", default="", namespaces=ns) or ""
            st_text = b.findtext("bldg:storeysAboveGround", default=None, namespaces=ns)

            raw_eaves = (min(rzs) - ground_z) if rzs else (float(mh_text) * 0.65 if mh_text else 4.5)
            raw_ridge = (max(rzs) - ground_z) if rzs else (float(mh_text) if mh_text else raw_eaves + 2.5)
            w_m, d_m, obb_rot, obb_cx, obb_cz = compute_obb(pts)
            ridge_rot = extract_ridge_angle_from_lod2(roof_poslists, obb_rot)

            category = ALKIS_FUNC_MAP.get(fn_code, "residential")
            # Refine large non-residential buildings (>250m2) as agricultural halls/barns
            if category == "barn" and area > 350.0:
                category = "agricultural"
            roof_shape = LOD2_ROOF_MAP.get(rt_code, "gabled")

            # Sanity-clamp LiDAR height outliers (protecting churches!)
            if category == "church":
                wall_h = max(4.0, raw_eaves)
                roof_h = max(2.0, raw_ridge - raw_eaves)
            elif category in ("garage", "shed"):
                wall_h = max(2.4, min(4.2, raw_eaves))
                raw_rh = max(0.0, raw_ridge - raw_eaves)
                if roof_shape == "flat" or raw_rh < 0.55:
                    roof_shape = "flat"
                    roof_h = 0.0
                else:
                    roof_h = max(0.8, min(2.8, raw_rh))
            elif category in ("barn", "agricultural"):
                wall_h = max(3.6, min(9.5, raw_eaves))
                raw_rh = max(0.0, raw_ridge - raw_eaves)
                if roof_shape == "flat" and raw_rh < 0.6:
                    roof_h = 0.0
                else:
                    if roof_shape == "flat":
                        roof_shape = "gabled"
                    roof_h = max(1.6, min(5.5, raw_rh if raw_rh >= 1.2 else min(4.5, d_m * 0.28)))
            else:
                # Residential / civic
                wall_h = max(3.8, min(9.8, raw_eaves))
                raw_rh = max(0.0, raw_ridge - raw_eaves)
                if roof_shape == "flat" and raw_rh < 0.6:
                    roof_h = 0.0
                else:
                    if roof_shape == "flat":
                        roof_shape = "gabled"
                    roof_h = max(1.8, min(5.8, raw_rh if raw_rh >= 1.3 else min(4.2, d_m * 0.32)))

            levels = max(1, min(3, int(round(wall_h / 3.0)))) if category != "church" else 2
            records.append({
                "lod2Id": gid,
                "footprint": pts,
                "center": (cx, cz),
                "obbCenter": (obb_cx, obb_cz),
                "widthM": w_m,
                "depthM": d_m,
                "areaM2": area,
                "rotationRad": ridge_rot,
                "obbRotationRad": obb_rot,
                "wallHeightM": round(wall_h, 2),
                "roofHeightM": round(roof_h, 2),
                "rawEavesM": round(raw_eaves, 2),
                "rawRidgeM": round(raw_ridge, 2),
                "roofShape": roof_shape,
                "roofTypeCode": rt_code,
                "alkisFunction": fn_code,
                "levels": levels,
                "category": category,
            })

    print(f"[LoD2] Parsed {len(records)} official 3D buildings (area >= 12m2) inside map bounds")
    return records


# ---------------------------------------------------------------------------
# Step 4: Build Unified Scene (Buildings + Roads + Landuse + Waterways + Trees + POIs)
# ---------------------------------------------------------------------------
def build_scene(osm_data: dict, lod2_records: list[dict], sample_h, min_elev_m: float):
    elements = osm_data.get("elements", [])
    nodes_raw = {e["id"]: e for e in elements if e["type"] == "node"}
    nodes_xz = {
        nid: latlon_to_local(n["lat"], n["lon"])
        for nid, n in nodes_raw.items()
    }
    ways_raw = {e["id"]: e for e in elements if e["type"] == "way"}
    rels_raw = [e for e in elements if e["type"] == "relation"]

    # Collect OSM winery POIs and named buildings for spatial enrichment
    osm_wineries = []
    for e in elements:
        t = e.get("tags", {})
        if t.get("craft") == "winery" or t.get("shop") == "wine":
            if e["type"] == "node" and e["id"] in nodes_xz:
                wx, wz = nodes_xz[e["id"]]
                if abs(wx) <= HALF_MAP_M and abs(wz) <= HALF_MAP_M:
                    osm_wineries.append({"name": t.get("name", "Weingut"), "x": wx, "z": wz, "osmId": f"node/{e['id']}"})

    osm_buildings = {}
    for wid, w in ways_raw.items():
        t = w.get("tags", {})
        if "building" not in t:
            continue
        pts_raw = [nodes_xz[nid] for nid in w.get("nodes", []) if nid in nodes_xz]
        pts = clean_polygon(pts_raw, min_dist=0.18)
        if len(pts) < 3:
            continue
        cx, cz = poly_centroid(pts)
        if abs(cx) > HALF_MAP_M - 5.0 or abs(cz) > HALF_MAP_M - 5.0:
            continue
        w_m, d_m, rot, ocx, ocz = compute_obb(pts)
        osm_buildings[wid] = {
            "wid": wid,
            "footprint": pts,
            "center": (cx, cz),
            "obbCenter": (ocx, ocz),
            "widthM": w_m,
            "depthM": d_m,
            "areaM2": poly_area(pts),
            "rotationRad": rot,
            "tags": t,
        }

    # Helper to compute stable baseElevationM so 1.5m-2.0m foundation skirt NEVER floats on slopes
    def building_base_elev(pts, cx, cz):
        c_h = sample_h(cx, cz)
        corner_hs = [sample_h(p[0], p[1]) for p in pts]
        min_h = min(corner_hs) if corner_hs else c_h
        # Keep base within 0.9m of lowest downhill corner so a 1.5m+ skirt always embeds >= 0.6m into ground!
        return round(min(c_h, min_h + 0.9), 3)

    # ------------------------------------------------------------------
    # Hero Landmarks (aligned to exact OSM ways & LoD2 survey geometry)
    # ------------------------------------------------------------------
    # Find Hauptstraße 87 (Probsthof) if present in OSM, else fallback to Hauptstraße 107 (way 889544811)
    probsthof_wid = None
    for wid, ob in osm_buildings.items():
        t = ob["tags"]
        if t.get("addr:street") == "Hauptstraße" and t.get("addr:housenumber") == "87":
            probsthof_wid = wid
            break

    # Selected 5 Hero Landmarks (guaranteed non-overlapping!)
    # 1. evangelische_kirche: Martinskirche (way 734605159) + LoD2 tower DERPLP110000QOUz (47.2m!)
    # 2. rathaus: Rathaus / Historisches Gemeindehaus Hauptstraße 77 (way 889544793)
    # 3. weingut_1: Weingut Raspfambert, Hauptstraße 44 (way 889544816) — iconic central Hauptstraße Weingut
    # 4. bauernhof_1: Winzerhof Hauptstraße 107 (way 889544811, 693m2 traditional Pfalz courtyard barn)
    # 5. halle_1: Landwirtschaftliche Halle Raiffeisenstraße 16 (way 275286713, 787m2 gabled steel hall)
    landmark_defs = [
        {
            "landmarkKey": "evangelische_kirche",
            "wid": 734605159,
            "extraOsmIds": {889544779},  # Freestanding south bell tower of Martinskirche!
            "name": "Evangelische Martinskirche Kindenheim",
            "category": "church",
            "addr": {"street": "Hauptstraße", "housenumber": "58"},
            "suppressLod2Ids": {"DERPLP110000QOQt", "DERPLP110000QOUz"},
        },
        {
            "landmarkKey": "rathaus",
            "wid": 889544793,
            "name": "Rathaus / Historisches Gemeindehaus Kindenheim",
            "category": "civic",
            "addr": {"street": "Hauptstraße", "housenumber": "77"},
            "suppressLod2Ids": {"DERPLP110000QOQv"},
        },
        {
            "landmarkKey": "weingut_1",
            "wid": 889544816,
            "name": "Weingut Raspfambert (Hauptstraße 44)",
            "category": "winery",
            "addr": {"street": "Hauptstraße", "housenumber": "44"},
            "suppressLod2Ids": set(),
        },
        {
            "landmarkKey": "bauernhof_1",
            "wid": 889544811,
            "name": "Pfälzer Winzerhof Hauptstraße 107",
            "category": "barn",
            "addr": {"street": "Hauptstraße", "housenumber": "107"},
            "suppressLod2Ids": set(),
        },
        {
            "landmarkKey": "halle_1",
            "wid": 275286713,
            "name": "Landwirtschaftliche Halle Raiffeisenstraße 16",
            "category": "agricultural",
            "addr": {"street": "Raiffeisenstraße", "housenumber": "16"},
            "suppressLod2Ids": set(),
        },
    ]

    lod2_by_id = {r["lod2Id"]: r for r in lod2_records}
    suppressed_lod2_ids = set()
    landmark_polys = []
    buildings_out = []

    for ldef in landmark_defs:
        wid = ldef["wid"]
        ob = osm_buildings.get(wid)
        if not ob:
            print(f"[WARN] Landmark way/{wid} ({ldef['landmarkKey']}) missing from OSM!")
            continue
        pts = ob["footprint"]
        cx, cz = ob["obbCenter"]
        w_m, d_m, rot = ob["widthM"], ob["depthM"], ob["rotationRad"]
        base_y = building_base_elev(pts, cx, cz)

        # Find all LoD2 records overlapping this landmark footprint
        overlapping = [
            r for r in lod2_records
            if r["lod2Id"] in ldef["suppressLod2Ids"]
            or point_in_poly(r["center"][0], r["center"][1], pts)
            or math.hypot(r["center"][0] - cx, r["center"][1] - cz) < min(w_m, d_m) * 0.45
        ]
        for r in overlapping:
            suppressed_lod2_ids.add(r["lod2Id"])
        landmark_polys.append((ldef["landmarkKey"], pts))

        entry = {
            "id": f"way/{wid}",
            "osmId": wid,
            "name": ldef["name"],
            "landmarkKey": ldef["landmarkKey"],
            "source": "osm+lod2",
            "footprint": [[round(p[0], 2), round(p[1], 2)] for p in pts],
            "center": [round(cx, 2), round(cz, 2)],
            "widthM": round(w_m, 2),
            "depthM": round(d_m, 2),
            "rotationRad": round(rot, 4),
            "baseElevationM": base_y,
            "levels": 2,
            "category": ldef["category"],
            "addr": ldef["addr"],
        }

        if ldef["landmarkKey"] == "evangelische_kirche":
            nave = lod2_by_id.get("DERPLP110000QOQt")
            tower = lod2_by_id.get("DERPLP110000QOUz")
            entry["wallHeightM"] = round(nave["rawEavesM"], 2) if nave else 7.35
            entry["roofHeightM"] = round((nave["rawRidgeM"] - nave["rawEavesM"]), 2) if nave else 5.71
            entry["roofShape"] = "gabled"
            if tower:
                t_pts = tower["footprint"]
                tcx, tcz = tower["obbCenter"]
                landmark_polys.append(("evangelische_kirche_tower", t_pts))
                entry["tower"] = {
                    "lod2Id": tower["lod2Id"],
                    "osmId": 889544779,
                    "center": [round(tcx, 2), round(tcz, 2)],
                    "offsetFromNaveCenter": [round(tcx - cx, 2), round(tcz - cz, 2)],
                    "widthM": round(tower["widthM"], 2),
                    "depthM": round(tower["depthM"], 2),
                    "wallHeightM": round(tower["rawEavesM"], 2),
                    "spireHeightM": round(tower["rawRidgeM"] - tower["rawEavesM"], 2),
                    "totalHeightM": round(tower["rawRidgeM"], 2),
                    "footprint": [[round(p[0], 2), round(p[1], 2)] for p in t_pts],
                }
        elif ldef["landmarkKey"] == "rathaus":
            # LoD2 DERPLP110000QOQv shows a tall landmark civic building (raw eaves 13.7m / ridge 17.5m, possibly incl. tall hall/attic);
            # provide realistic Palatinate civic Rathaus default (8.2m walls + 4.8m hipped/gabled roof = 13.0m) + raw LoD2 reference.
            raw_r = lod2_by_id.get("DERPLP110000QOQv")
            entry["wallHeightM"] = 8.2
            entry["roofHeightM"] = 4.8
            entry["roofShape"] = "hipped"
            entry["levels"] = 2
            if raw_r:
                entry["lod2RawHeightM"] = {"eavesM": raw_r["rawEavesM"], "ridgeM": raw_r["rawRidgeM"]}
        elif ldef["landmarkKey"] == "weingut_1":
            dom = max(overlapping, key=lambda r: r["areaM2"]) if overlapping else None
            entry["wallHeightM"] = dom["wallHeightM"] if dom else 7.8
            entry["roofHeightM"] = dom["roofHeightM"] if dom else 4.5
            entry["roofShape"] = "gabled"
            entry["levels"] = 2
        elif ldef["landmarkKey"] == "bauernhof_1":
            dom = max(overlapping, key=lambda r: r["areaM2"]) if overlapping else None
            entry["wallHeightM"] = dom["wallHeightM"] if dom else 6.4
            entry["roofHeightM"] = dom["roofHeightM"] if dom else 3.2
            entry["roofShape"] = "gabled"
            entry["levels"] = 2
        elif ldef["landmarkKey"] == "halle_1":
            dom = max(overlapping, key=lambda r: r["areaM2"]) if overlapping else None
            entry["wallHeightM"] = dom["wallHeightM"] if dom else 7.9
            entry["roofHeightM"] = dom["roofHeightM"] if dom else 3.0
            entry["roofShape"] = "gabled"
            entry["levels"] = 1

        buildings_out.append(entry)

    # ------------------------------------------------------------------
    # All Remaining Village Buildings (Official LoD2 enriched with OSM!)
    # ------------------------------------------------------------------
    # Pre-index OSM buildings by bounding box for fast spatial tag join
    osm_spatial = []
    for wid, ob in osm_buildings.items():
        xs = [p[0] for p in ob["footprint"]]
        zs = [p[1] for p in ob["footprint"]]
        osm_spatial.append((min(xs) - 3, max(xs) + 3, min(zs) - 3, max(zs) + 3, ob))

    covered_osm_wids = {ld["wid"] for ld in landmark_defs}
    for ld in landmark_defs:
        covered_osm_wids.update(ld.get("extraOsmIds", set()))

    for rec in lod2_records:
        if rec["lod2Id"] in suppressed_lod2_ids:
            continue
        cx, cz = rec["center"]
        # Double-check not inside any landmark polygon
        if any(point_in_poly(cx, cz, lpoly) for _, lpoly in landmark_polys):
            continue

        # Match OSM building for name, address, amenity, winery
        matched_osm = None
        for x0, x1, z0, z1, ob in osm_spatial:
            if x0 <= cx <= x1 and z0 <= cz <= z1:
                if point_in_poly(cx, cz, ob["footprint"]):
                    matched_osm = ob
                    break
        if matched_osm is None:
            # Nearest OSM building within 5m
            best_d = 5.0
            for x0, x1, z0, z1, ob in osm_spatial:
                if x0 - 5 <= cx <= x1 + 5 and z0 - 5 <= cz <= z1 + 5:
                    d = math.hypot(cx - ob["center"][0], cz - ob["center"][1])
                    if d < best_d:
                        best_d = d
                        matched_osm = ob

        tags = matched_osm["tags"] if matched_osm else {}
        if matched_osm:
            covered_osm_wids.add(matched_osm["wid"])

        name = tags.get("name")
        addr = None
        if "addr:street" in tags or "addr:housenumber" in tags:
            addr = {
                "street": tags.get("addr:street", ""),
                "housenumber": tags.get("addr:housenumber", ""),
            }

        cat = rec["category"]
        if tags.get("building") == "chapel":
            cat = "chapel"
        elif tags.get("building") == "church":
            cat = "church"
        elif tags.get("amenity") in ("community_centre", "kindergarten", "fire_station"):
            cat = "civic"
        elif tags.get("building") == "warehouse":
            cat = "agricultural"

        # Check proximity to OSM winery POI
        for wpoi in osm_wineries:
            if math.hypot(cx - wpoi["x"], cz - wpoi["z"]) < 14.0 and cat in ("residential", "barn"):
                if not name:
                    name = wpoi["name"]
                if cat == "residential":
                    cat = "winery"
                break

        base_y = building_base_elev(rec["footprint"], rec["obbCenter"][0], rec["obbCenter"][1])
        buildings_out.append({
            "id": f"lod2/{rec['lod2Id']}",
            "lod2Id": rec["lod2Id"],
            "osmId": matched_osm["wid"] if matched_osm else None,
            "name": name,
            "landmarkKey": None,
            "source": "lod2+osm" if matched_osm else "lod2",
            "footprint": [[round(p[0], 2), round(p[1], 2)] for p in rec["footprint"]],
            "center": [round(rec["obbCenter"][0], 2), round(rec["obbCenter"][1], 2)],
            "widthM": round(rec["widthM"], 2),
            "depthM": round(rec["depthM"], 2),
            "rotationRad": round(rec["rotationRad"], 4),
            "baseElevationM": base_y,
            "wallHeightM": rec["wallHeightM"],
            "roofHeightM": rec["roofHeightM"],
            "roofShape": rec["roofShape"],
            "levels": rec["levels"],
            "category": cat,
            "addr": addr,
        })

    # Add any remaining OSM building (area >= 15m2) not covered by LoD2 (e.g. brand-new structure)
    extra_osm = 0
    for wid, ob in osm_buildings.items():
        if wid in covered_osm_wids or ob["areaM2"] < 15.0:
            continue
        cx, cz = ob["center"]
        if any(point_in_poly(cx, cz, lpoly) for _, lpoly in landmark_polys):
            continue
        t = ob["tags"]
        cat = "residential"
        wall_h, roof_h, roof_shape, levels = 6.0, 3.2, "gabled", 2
        if t.get("building") == "chapel":
            cat, wall_h, roof_h = "chapel", 4.5, 4.0
        elif t.get("building") in ("warehouse", "barn", "farm_auxiliary"):
            cat, wall_h, roof_h, levels = "barn", 5.5, 2.8, 1
        elif ob["areaM2"] < 42.0:
            cat, wall_h, roof_h, roof_shape, levels = "garage", 2.8, 0.8, "skillion", 1
        addr = None
        if "addr:street" in t or "addr:housenumber" in t:
            addr = {"street": t.get("addr:street", ""), "housenumber": t.get("addr:housenumber", "")}
        base_y = building_base_elev(ob["footprint"], ob["obbCenter"][0], ob["obbCenter"][1])
        buildings_out.append({
            "id": f"way/{wid}",
            "osmId": wid,
            "name": t.get("name"),
            "landmarkKey": None,
            "source": "osm",
            "footprint": [[round(p[0], 2), round(p[1], 2)] for p in ob["footprint"]],
            "center": [round(ob["obbCenter"][0], 2), round(ob["obbCenter"][1], 2)],
            "widthM": round(ob["widthM"], 2),
            "depthM": round(ob["depthM"], 2),
            "rotationRad": round(ob["rotationRad"], 4),
            "baseElevationM": base_y,
            "wallHeightM": wall_h,
            "roofHeightM": roof_h,
            "roofShape": roof_shape,
            "levels": levels,
            "category": cat,
            "addr": addr,
        })
        extra_osm += 1

    print(f"[BUILDINGS] Total={len(buildings_out)} (5 hero landmarks, {len(buildings_out)-5-extra_osm} LoD2 village, {extra_osm} extra OSM)")

    # ------------------------------------------------------------------
    # Roads, Village Streets & Feldwege
    # ------------------------------------------------------------------
    ROAD_SPECS = {
        "primary":      (8.0, "asphalt", "main"),
        "secondary":    (7.2, "asphalt", "main"),      # L 450 / Hauptstraße
        "tertiary":     (6.2, "asphalt", "collector"),
        "unclassified": (5.8, "asphalt", "collector"), # Raiffeisenstraße
        "residential":  (5.0, "asphalt", "village"),
        "living_street":(4.6, "asphalt", "village"),
        "service":      (3.6, "paved",   "service"),
        "track":        (3.2, "track",   "track"),     # Palatinate Feldwege!
        "path":         (1.8, "path",    "path"),
        "footway":      (1.8, "path",    "path"),
        "cycleway":     (2.2, "paved",   "path"),
        "steps":        (1.6, "paved",   "path"),
    }
    roads_out = []
    l450_points = []
    for wid, w in ways_raw.items():
        t = w.get("tags", {})
        hw = t.get("highway")
        if hw not in ROAD_SPECS:
            continue
        pts_2d = [nodes_xz[nid] for nid in w.get("nodes", []) if nid in nodes_xz]
        if len(pts_2d) < 2:
            continue
        width_m, surface, role = ROAD_SPECS[hw]
        # Respect explicit OSM surface tag on tracks (some Feldwege are asphalt/paved!)
        osm_surf = t.get("surface", "")
        if hw == "track" and osm_surf in ("asphalt", "paved", "concrete", "concrete:lanes"):
            surface = "paved"
        chains = clip_and_resample_polyline(pts_2d, half=HALF_MAP_M - 1.0, max_seg_m=6.5)
        for ci, chain in enumerate(chains):
            pts_3d = [[round(x, 2), round(sample_h(x, z), 3), round(z, 2)] for x, z in chain]
            rid = f"way/{wid}" if ci == 0 else f"way/{wid}_{ci}"
            roads_out.append({
                "id": rid,
                "name": t.get("name") or t.get("ref") or None,
                "ref": t.get("ref"),
                "highway": hw,
                "role": role,
                "surface": surface,
                "widthM": width_m,
                "points": pts_3d,
            })
            if t.get("ref") == "L 450" or hw == "secondary":
                l450_points.append(chain)

    print(f"[ROADS] Exported {len(roads_out)} road/track polylines")

    # ------------------------------------------------------------------
    # Waterways (Kinderbach / ditches)
    # ------------------------------------------------------------------
    waterways_out = []
    for wid, w in ways_raw.items():
        t = w.get("tags", {})
        ww = t.get("waterway")
        if not ww:
            continue
        pts_2d = [nodes_xz[nid] for nid in w.get("nodes", []) if nid in nodes_xz]
        if len(pts_2d) < 2:
            continue
        chains = clip_and_resample_polyline(pts_2d, half=HALF_MAP_M - 1.0, max_seg_m=8.0)
        for ci, chain in enumerate(chains):
            pts_3d = [[round(x, 2), round(sample_h(x, z), 3), round(z, 2)] for x, z in chain]
            waterways_out.append({
                "id": f"way/{wid}" if ci == 0 else f"way/{wid}_{ci}",
                "name": t.get("name"),
                "waterway": ww,
                "widthM": 2.4 if ww == "stream" else 1.4,
                "points": pts_3d,
            })

    # ------------------------------------------------------------------
    # Landuse & Natural Polygons (Vineyards with exact rowAngleRad, Farmland, Woods...)
    # ------------------------------------------------------------------
    landuse_out = []
    ALLOWED_LU = {
        "vineyard", "farmland", "meadow", "grass", "orchard",
        "residential", "farmyard", "cemetery", "forest", "industrial", "greenfield",
    }
    ALLOWED_NAT = {"wood": "forest", "scrub": "scrub", "grassland": "meadow", "water": "water"}

    for wid, w in ways_raw.items():
        t = w.get("tags", {})
        lu_type = None
        if t.get("landuse") in ALLOWED_LU:
            lu_type = t["landuse"]
        elif t.get("natural") in ALLOWED_NAT:
            lu_type = ALLOWED_NAT[t["natural"]]
        if not lu_type:
            continue
        nids = w.get("nodes", [])
        if len(nids) < 4 or nids[0] != nids[-1]:
            continue
        pts_raw = [nodes_xz[nid] for nid in nids[:-1] if nid in nodes_xz]
        if len(pts_raw) < 3:
            continue
        clipped = clip_polygon_to_box(pts_raw, half=HALF_MAP_M)
        pts = clean_polygon(clipped, min_dist=0.5)
        if len(pts) < 3:
            continue
        area_m2 = poly_area(pts)
        if area_m2 < 40.0:
            continue
        cx, cz = poly_centroid(pts)
        w_m, d_m, rot, _, _ = compute_obb(pts)
        lu_entry = {
            "id": f"way/{wid}",
            "type": lu_type,
            "name": t.get("name"),
            "areaHa": round(area_m2 / 10000.0, 3),
            "center": [round(cx, 2), round(cz, 2)],
            "points": [[round(p[0], 2), round(p[1], 2)] for p in pts],
        }
        if lu_type == "vineyard":
            # Palatinate vine rows run cleanly along the parcel's longest axis!
            lu_entry["rowAngleRad"] = round(rot, 4)
        landuse_out.append(lu_entry)

    lu_counts = Counter(l["type"] for l in landuse_out)
    print(f"[LANDUSE] Exported {len(landuse_out)} polygons: {dict(lu_counts)}")

    # ------------------------------------------------------------------
    # Trees (Real OSM trees + natural wood/scrub/cemetery/roadside greenery)
    # ------------------------------------------------------------------
    rng = random.Random(67271)  # Kindenheim PLZ deterministic seed!
    trees_out = []

    # Helper to reject trees inside buildings or on asphalt roads
    b_boxes = [
        (b["center"][0] - b["widthM"] * 0.65, b["center"][0] + b["widthM"] * 0.65,
         b["center"][1] - b["depthM"] * 0.65, b["center"][1] + b["depthM"] * 0.65)
        for b in buildings_out
    ]

    def is_clear_of_buildings(x: float, z: float) -> bool:
        for x0, x1, z0, z1 in b_boxes:
            if x0 <= x <= x1 and z0 <= z <= z1:
                return False
        return True

    # 1) Exact OSM tree nodes
    for nid, n in nodes_raw.items():
        t = n.get("tags", {})
        if t.get("natural") == "tree":
            tx, tz = nodes_xz[nid]
            if abs(tx) <= HALF_MAP_M - 5 and abs(tz) <= HALF_MAP_M - 5:
                ttype = "orchard" if t.get("species") or t.get("leaf_type") == "broadleaved" else "deciduous"
                trees_out.append({
                    "id": f"node/{nid}",
                    "x": round(tx, 2),
                    "y": round(sample_h(tx, tz), 3),
                    "z": round(tz, 2),
                    "type": ttype,
                    "scale": round(rng.uniform(0.85, 1.25), 2),
                    "rotationRad": round(rng.uniform(0, 2 * math.pi), 3),
                })

    # 2) OSM tree_row / hedge ways
    for wid, w in ways_raw.items():
        t = w.get("tags", {})
        if t.get("natural") == "tree_row" or t.get("barrier") == "hedge":
            pts_2d = [nodes_xz[nid] for nid in w.get("nodes", []) if nid in nodes_xz]
            chains = clip_and_resample_polyline(pts_2d, half=HALF_MAP_M - 5, max_seg_m=10.0)
            for chain in chains:
                for idx, (tx, tz) in enumerate(chain):
                    if is_clear_of_buildings(tx, tz):
                        trees_out.append({
                            "id": f"row/{wid}_{idx}",
                            "x": round(tx, 2),
                            "y": round(sample_h(tx, tz), 3),
                            "z": round(tz, 2),
                            "type": "deciduous",
                            "scale": round(rng.uniform(0.7, 1.1), 2),
                            "rotationRad": round(rng.uniform(0, 2 * math.pi), 3),
                        })

    # 3) Populate real OSM wood / scrub / cemetery polygons naturally
    for lu in landuse_out:
        if lu["type"] not in ("forest", "scrub", "cemetery", "orchard"):
            continue
        poly = [(p[0], p[1]) for p in lu["points"]]
        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        minx, maxx = min(xs), max(xs)
        minz, maxz = min(zs), max(zs)
        area_m2 = lu["areaHa"] * 10000.0
        spacing = 11.0 if lu["type"] == "forest" else (14.0 if lu["type"] == "scrub" else 16.0)
        target = min(140, max(3, int(area_m2 / (spacing * spacing))))
        placed = 0
        attempts = 0
        while placed < target and attempts < target * 8:
            attempts += 1
            tx = rng.uniform(minx, maxx)
            tz = rng.uniform(minz, maxz)
            if point_in_poly(tx, tz, poly) and is_clear_of_buildings(tx, tz):
                ttype = "orchard" if lu["type"] in ("orchard", "scrub") else "deciduous"
                trees_out.append({
                    "id": f"lu_tree/{lu['id']}_{placed}",
                    "x": round(tx, 2),
                    "y": round(sample_h(tx, tz), 3),
                    "z": round(tz, 2),
                    "type": ttype,
                    "scale": round(rng.uniform(0.75, 1.35), 2),
                    "rotationRad": round(rng.uniform(0, 2 * math.pi), 3),
                })
                placed += 1

    # 4) Scattered trees along Kinderbach waterways
    for ww in waterways_out:
        for idx in range(0, len(ww["points"]), 5):
            px, _, pz = ww["points"][idx]
            tx = px + rng.uniform(-4.5, 4.5)
            tz = pz + rng.uniform(-4.5, 4.5)
            if abs(tx) < HALF_MAP_M - 10 and abs(tz) < HALF_MAP_M - 10 and is_clear_of_buildings(tx, tz):
                trees_out.append({
                    "id": f"stream_tree/{ww['id']}_{idx}",
                    "x": round(tx, 2),
                    "y": round(sample_h(tx, tz), 3),
                    "z": round(tz, 2),
                    "type": "deciduous",
                    "scale": round(rng.uniform(0.7, 1.15), 2),
                    "rotationRad": round(rng.uniform(0, 2 * math.pi), 3),
                })

    print(f"[TREES] Exported {len(trees_out)} natural/OSM trees")

    # ------------------------------------------------------------------
    # POIs & Exact Ortsschild Locations (Kindenheim village entrances on L 450!)
    # ------------------------------------------------------------------
    pois_out = []
    for e in elements:
        t = e.get("tags", {})
        if e["type"] == "node" and e["id"] in nodes_xz:
            if any(k in t for k in ("place", "craft", "historic", "tourism")) or t.get("amenity") in ("shelter", "drinking_water", "biergarten"):
                px, pz = nodes_xz[e["id"]]
                if abs(px) <= HALF_MAP_M - 5 and abs(pz) <= HALF_MAP_M - 5:
                    pois_out.append({
                        "id": f"node/{e['id']}",
                        "name": t.get("name", t.get("historic", t.get("amenity", "POI"))),
                        "type": t.get("craft") or t.get("historic") or t.get("place") or t.get("amenity") or "poi",
                        "x": round(px, 2),
                        "y": round(sample_h(px, pz), 3),
                        "z": round(pz, 2),
                    })

    # Compute real Kindenheim village entrance Ortsschild positions on Hauptstraße / L 450
    # East entrance (towards Bockenheim, around x ~ +560) and West entrance (towards Quirnheim, around x ~ -620)
    def find_l450_point_near_x(target_x: float):
        best = None
        for chain in l450_points:
            for i in range(len(chain) - 1):
                a, b = chain[i], chain[i + 1]
                mx, mz = 0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])
                d = abs(mx - target_x)
                if best is None or d < best[0]:
                    dx, dz = b[0] - a[0], b[1] - a[1]
                    ang = math.atan2(-dz, dx)
                    # Offset 4.5m to roadside shoulder
                    L = math.hypot(dx, dz) + 1e-6
                    nx, nz = -dz / L, dx / L
                    best = (d, mx + nx * 4.5, mz + nz * 4.5, ang)
        return best

    for label, tx in [("Ortsschild Kindenheim Ost (L 450)", 565.0), ("Ortsschild Kindenheim West (L 450)", -595.0)]:
        hit = find_l450_point_near_x(tx)
        if hit:
            _, ox, oz, oang = hit
            pois_out.append({
                "id": f"ortsschild_{'east' if tx > 0 else 'west'}",
                "name": label,
                "type": "ortsschild",
                "x": round(ox, 2),
                "y": round(sample_h(ox, oz), 3),
                "z": round(oz, 2),
                "rotationRad": round(oang, 4),
            })

    return {
        "buildings": buildings_out,
        "roads": roads_out,
        "landuse": landuse_out,
        "waterways": waterways_out,
        "trees": trees_out,
        "pois": pois_out,
    }


# ---------------------------------------------------------------------------
# Step 5: Rasterize Landuse Splat Mask (2048x2048 PNG aligned to [-1024, +1024])
# ---------------------------------------------------------------------------
def generate_landuse_mask(scene: dict, dest_path: str):
    # Base = farmland
    base_rgb = LANDUSE_LEGEND["farmland"]["rgb"]
    img = np.empty((MASK_SIZE, MASK_SIZE, 3), dtype=np.uint8)
    img[:, :, 0] = base_rgb[0]
    img[:, :, 1] = base_rgb[1]
    img[:, :, 2] = base_rgb[2]

    def xz_to_px(x: float, z: float) -> tuple[int, int]:
        px = int(round(((x + HALF_MAP_M) / MAP_SIZE_M) * (MASK_SIZE - 1)))
        py = int(round(((z + HALF_MAP_M) / MAP_SIZE_M) * (MASK_SIZE - 1)))
        return (max(0, min(MASK_SIZE - 1, px)), max(0, min(MASK_SIZE - 1, py)))

    # Draw landuse polygons in clean z-order (farmland -> meadow -> vineyard -> forest -> residential -> water)
    lu_order = [
        ("farmland",    "farmland"),
        ("greenfield",  "meadow"),
        ("meadow",      "meadow"),
        ("grass",       "meadow"),
        ("orchard",     "meadow"),
        ("vineyard",    "vineyard"),
        ("scrub",       "forest"),
        ("forest",      "forest"),
        ("cemetery",    "residential"),
        ("farmyard",    "residential"),
        ("industrial",  "residential"),
        ("residential", "residential"),
        ("water",       "water"),
    ]
    by_type = {}
    for lu in scene["landuse"]:
        by_type.setdefault(lu["type"], []).append(lu)

    for src_t, legend_key in lu_order:
        rgb = tuple(LANDUSE_LEGEND[legend_key]["rgb"])
        for lu in by_type.get(src_t, []):
            pts = np.array([xz_to_px(p[0], p[1]) for p in lu["points"]], dtype=np.int32)
            if len(pts) >= 3:
                cv2.fillPoly(img, [pts], color=rgb)

    # Waterways
    w_rgb = tuple(LANDUSE_LEGEND["water"]["rgb"])
    for ww in scene["waterways"]:
        pts = np.array([xz_to_px(p[0], p[2]) for p in ww["points"]], dtype=np.int32)
        if len(pts) >= 2:
            cv2.polylines(img, [pts], False, color=w_rgb, thickness=max(2, int(round(ww["widthM"]))))

    # Roads: tracks first, then paved/asphalt on top
    for pass_surf, legend_key in [("track", "road_track"), ("path", "road_track"), ("paved", "road_asphalt"), ("asphalt", "road_asphalt")]:
        rgb = tuple(LANDUSE_LEGEND[legend_key]["rgb"])
        for rd in scene["roads"]:
            if rd["surface"] != pass_surf:
                continue
            pts = np.array([xz_to_px(p[0], p[2]) for p in rd["points"]], dtype=np.int32)
            if len(pts) >= 2:
                thick = max(2, int(round(rd["widthM"])))
                cv2.polylines(img, [pts], False, color=rgb, thickness=thick)

    Image.fromarray(img, mode="RGB").save(dest_path, "PNG", optimize=True)
    print(f"[MASK] Saved {MASK_SIZE}x{MASK_SIZE} landuse_mask.png ({os.path.getsize(dest_path)//1024} KB)")


def enrich_building_roof_colors(buildings: list[dict], ortho_path: str):
    """Samples real observed roof RGB & semantic roofTone from the pixel-aligned 20cm DOP20 orthophoto."""
    ortho_rgb = np.array(Image.open(ortho_path).convert("RGB"))
    h, w, _ = ortho_rgb.shape
    tone_counts = Counter()

    for b in buildings:
        pts_px = np.array(
            [
                [
                    int(round(((p[0] + HALF_MAP_M) / MAP_SIZE_M) * (w - 1))),
                    int(round(((p[1] + HALF_MAP_M) / MAP_SIZE_M) * (h - 1))),
                ]
                for p in b["footprint"]
            ],
            dtype=np.int32,
        )
        x0 = max(0, int(pts_px[:, 0].min()))
        x1 = min(w - 1, int(pts_px[:, 0].max()))
        y0 = max(0, int(pts_px[:, 1].min()))
        y1 = min(h - 1, int(pts_px[:, 1].max()))
        if x1 <= x0 or y1 <= y0:
            b["roofColorHex"] = "#8f4e3a"
            b["roofTone"] = "terracotta"
            tone_counts["terracotta"] += 1
            continue

        patch = ortho_rgb[y0 : y1 + 1, x0 : x1 + 1]
        mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=np.uint8)
        local_pts = pts_px - np.array([[x0, y0]], dtype=np.int32)
        cv2.fillPoly(mask, [local_pts], 255)
        # Erode slightly to avoid eaves/gutter/ground bleed on larger footprints
        if min(mask.shape) >= 7:
            mask_inner = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)
            if mask_inner.sum() >= 255 * 6:
                mask = mask_inner
        pixels = patch[mask > 0]
        if len(pixels) == 0:
            r, g, bl = 143, 78, 58
        else:
            lum = pixels.mean(axis=1)
            mid = pixels[(lum >= 35) & (lum <= 235)]
            use = mid if len(mid) >= 5 else pixels
            med = np.median(use, axis=0)
            r, g, bl = int(round(med[0])), int(round(med[1])), int(round(med[2]))

        warmth = r - bl
        redness = r - g
        val = max(r, g, bl)
        if b["category"] == "agricultural" and warmth < 18 and val >= 105:
            tone = "metal_grey"
        elif redness >= 12 and warmth >= 22 and r >= 110:
            tone = "terracotta"
        elif warmth >= 15 and r >= 90 and b["category"] not in ("garage", "shed"):
            tone = "dark_red"
        elif val >= 130 and warmth < 14:
            tone = "metal_grey"
        else:
            tone = "charcoal"

        b["roofColorHex"] = f"#{r:02x}{g:02x}{bl:02x}"
        b["roofTone"] = tone
        tone_counts[tone] += 1

    print(f"[ROOFS] Aerial-sampled roof tones from DOP20: {dict(tone_counts)}")


# ---------------------------------------------------------------------------
# Main Entrypoint
# ---------------------------------------------------------------------------
def main():
    t0 = time.time()
    os.makedirs(TERRAIN_DIR, exist_ok=True)
    os.makedirs(OSM_DIR, exist_ok=True)
    os.makedirs(REF_DIR, exist_ok=True)

    # 1. Elevation DEM
    rel_grid, min_elev_m, max_elev_m, dem_source = fetch_elevation_grid()
    hm_path = os.path.join(TERRAIN_DIR, "heightmap.bin")
    rel_grid.astype("<f4").tofile(hm_path)
    print(f"[DEM] Wrote {hm_path} ({os.path.getsize(hm_path)} bytes, shape={rel_grid.shape})")
    sample_h = make_height_sampler(rel_grid)

    # 2. Aerial Orthophoto
    ortho_path = os.path.join(TERRAIN_DIR, "orthophoto.jpg")
    imagery_source = fetch_orthophoto(ortho_path)

    # 3. OSM + Official LoD2 3D Buildings + Aerial Roof Color Sampling
    osm_data = fetch_osm_raw()
    lod2_records = parse_lod2_buildings()
    scene = build_scene(osm_data, lod2_records, sample_h, min_elev_m)
    enrich_building_roof_colors(scene["buildings"], ortho_path)

    # 4. Write data/osm/kindenheim_scene.json
    scene_path = os.path.join(OSM_DIR, "kindenheim_scene.json")
    with open(scene_path, "w", encoding="utf-8") as f:
        json.dump(scene, f, separators=(",", ":"), ensure_ascii=False)
    print(f"[SCENE] Wrote {scene_path} ({os.path.getsize(scene_path)/1024:.1f} KB)")

    # 5. Rasterize data/terrain/landuse_mask.png
    mask_path = os.path.join(TERRAIN_DIR, "landuse_mask.png")
    generate_landuse_mask(scene, mask_path)

    # 6. Exact projection metadata & data/meta.json
    center_lat, center_lon = utm32_to_latlon(CENTER_UTM_E, CENTER_UTM_N)
    nw_lat, nw_lon = utm32_to_latlon(CENTER_UTM_E - HALF_MAP_M, CENTER_UTM_N + HALF_MAP_M)
    ne_lat, ne_lon = utm32_to_latlon(CENTER_UTM_E + HALF_MAP_M, CENTER_UTM_N + HALF_MAP_M)
    sw_lat, sw_lon = utm32_to_latlon(CENTER_UTM_E - HALF_MAP_M, CENTER_UTM_N - HALF_MAP_M)
    se_lat, se_lon = utm32_to_latlon(CENTER_UTM_E + HALF_MAP_M, CENTER_UTM_N - HALF_MAP_M)

    # Exact linear tangent-plane Jacobian around (center_lat, center_lon) for sub-decimeter JS conversion
    eps = 1e-4
    x_dlon, z_dlon = latlon_to_local(center_lat, center_lon + eps)
    x_dlat, z_dlat = latlon_to_local(center_lat + eps, center_lon)
    dX_dLon, dZ_dLon = x_dlon / eps, z_dlon / eps
    dX_dLat, dZ_dLat = x_dlat / eps, z_dlat / eps

    # Self-check Jacobian error at all 4 map corners
    max_jac_err = 0.0
    for (clat, clon), (tx, tz) in [
        ((nw_lat, nw_lon), (-HALF_MAP_M, -HALF_MAP_M)),
        ((ne_lat, ne_lon), (HALF_MAP_M, -HALF_MAP_M)),
        ((sw_lat, sw_lon), (-HALF_MAP_M, HALF_MAP_M)),
        ((se_lat, se_lon), (HALF_MAP_M, HALF_MAP_M)),
    ]:
        px = (clon - center_lon) * dX_dLon + (clat - center_lat) * dX_dLat
        pz = (clon - center_lon) * dZ_dLon + (clat - center_lat) * dZ_dLat
        max_jac_err = max(max_jac_err, math.hypot(px - tx, pz - tz))

    vineyard_count = sum(1 for l in scene["landuse"] if l["type"] == "vineyard")
    field_count = sum(1 for l in scene["landuse"] if l["type"] in ("farmland", "meadow", "orchard"))
    landmarks_summary = [
        {
            "landmarkKey": b["landmarkKey"],
            "id": b["id"],
            "name": b["name"],
            "center": b["center"],
            "widthM": b["widthM"],
            "depthM": b["depthM"],
            "rotationRad": b["rotationRad"],
            "baseElevationM": b["baseElevationM"],
            "wallHeightM": b["wallHeightM"],
            "roofHeightM": b["roofHeightM"],
            "roofShape": b["roofShape"],
            **({"tower": b["tower"]} if "tower" in b else {}),
        }
        for b in scene["buildings"]
        if b.get("landmarkKey")
    ]

    meta = {
        "name": "Kindenheim 3D Visual Fidelity Benchmark",
        "municipality": "Kindenheim",
        "district": "Landkreis Bad Dürkheim",
        "state": "Rheinland-Pfalz",
        "country": "Germany",
        "postalCode": "67271",
        "ags": "07332029",
        "centerLat": round(center_lat, 7),
        "centerLon": round(center_lon, 7),
        "mapSizeM": int(MAP_SIZE_M),
        "halfMapSizeM": int(HALF_MAP_M),
        "axes": {
            "x": "+East (meters in [-1024, +1024])",
            "y": "+Up (meters above minElevationM)",
            "z": "+South / -North (meters in [-1024, +1024])",
            "rotationRad": "Three.js rotation.y in radians; local +X maps to (cos(r), -sin(r)) in world (x, z)",
        },
        "projection": {
            "crs": "EPSG:25832",
            "name": "ETRS89 / UTM zone 32N",
            "centerUtmE": CENTER_UTM_E,
            "centerUtmN": CENTER_UTM_N,
            "boundsUtm": {
                "minE": CENTER_UTM_E - HALF_MAP_M,
                "maxE": CENTER_UTM_E + HALF_MAP_M,
                "minN": CENTER_UTM_N - HALF_MAP_M,
                "maxN": CENTER_UTM_N + HALF_MAP_M,
            },
            "latLonToLocalAffine": {
                "formula": "x = (lon - centerLon)*dX_dLon + (lat - centerLat)*dX_dLat; z = (lon - centerLon)*dZ_dLon + (lat - centerLat)*dZ_dLat",
                "dX_dLon": round(dX_dLon, 4),
                "dX_dLat": round(dX_dLat, 4),
                "dZ_dLon": round(dZ_dLon, 4),
                "dZ_dLat": round(dZ_dLat, 4),
                "maxCornerErrorM": round(max_jac_err, 4),
            },
        },
        "boundsWGS84": {
            "minLat": round(min(sw_lat, se_lat), 7),
            "maxLat": round(max(nw_lat, ne_lat), 7),
            "minLon": round(min(nw_lon, sw_lon), 7),
            "maxLon": round(max(ne_lon, se_lon), 7),
        },
        "minElevationM": round(min_elev_m, 3),
        "maxElevationM": round(max_elev_m, 3),
        "elevationRangeM": round(max_elev_m - min_elev_m, 3),
        "gridSize": HEIGHTMAP_GRID_SIZE,
        "heightmapFormat": "Float32Array little-endian, row-major North-to-South (z=-1024..+1024), West-to-East (x=-1024..+1024), meters above minElevationM",
        "orthophotoSize": ORTHO_SIZE,
        "landuseMaskSize": MASK_SIZE,
        "landuseMaskLegend": LANDUSE_LEGEND,
        "imagerySource": imagery_source,
        "demSource": dem_source,
        "buildingsSource": "LVermGeo RLP OpenData LoD2 CityGML (2026) + OpenStreetMap API v0.6",
        "buildingCount": len(scene["buildings"]),
        "roadCount": len(scene["roads"]),
        "vineyardCount": vineyard_count,
        "fieldCount": field_count,
        "treeCount": len(scene["trees"]),
        "poiCount": len(scene["pois"]),
        "landmarks": landmarks_summary,
    }

    meta_path = os.path.join(DATA_DIR, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"[META] Wrote {meta_path} (affine corner error={max_jac_err:.4f}m, elapsed={time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
