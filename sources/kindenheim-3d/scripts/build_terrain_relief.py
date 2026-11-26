#!/usr/bin/env python3
"""
Build data/terrain/relief.jpg: 1 m micro-relief for terrain shading, from the official DGM1 LiDAR tiles.

The rendered terrain mesh (and the physics) use the 513 x 513 road-graded heightmap
(data/terrain/heightmap.bin, 4 m cells; see scripts/build_terrain_roadbed.py). The DGM1 source has
1 m cells; the difference between both carries terraces, embankments, ditches, the creek bed and field
edges. This script stores that RESIDUAL as a slope map so the shader can light the 4 m mesh with 1 m
detail without moving a single vertex:

    R, G : residual slope d(h1m - h4m)/dx and /dz, encoded  0.5 + 0.5 * sign(s) * sqrt(min(|s|, 1))
    B    : cavity / ambient term, 1 = open ground, lower in ditches and at the foot of banks

Source: LVermGeo RLP OpenData DGM1 (1 m LiDAR GeoTIFF), dl-de/by-2-0, (c) GeoBasis-DE / LVermGeoRP.
Tiles are read from the geodata cache used by scripts/fetch_geodata.py (KINDENHEIM_CACHE_DIR); missing
tiles are downloaded from the official index. NO FALLBACKS: anything missing or malformed aborts.

Usage:  python3 scripts/build_terrain_relief.py
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import sys
import time

import cv2
import numpy as np
import requests
from PIL import Image

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CACHE_DIR = os.environ.get(
    "KINDENHEIM_CACHE_DIR",
    "/Users/logge/.gemini/antigravity-cli/brain/df78c4bb-9c8e-4455-93be-01f76267abd7/scratch/cache",
)
META4_URL = "https://geobasis-rlp.de/data/dgm1/current/meta4/dgm1_tif_07332.meta4"
OUT_PATH = os.path.join(PROJECT_ROOT, "data", "terrain", "relief.jpg")
USER_AGENT = "kindenheim3d-geodata/1.1"


def cached(url: str, name: str) -> bytes:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, name)
    if os.path.exists(path) and os.path.getsize(path) > 100:
        with open(path, "rb") as f:
            return f.read()
    r = requests.get(url, timeout=60, headers={"User-Agent": USER_AGENT})
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code} for {url}")
    with open(path, "wb") as f:
        f.write(r.content)
    time.sleep(1.0)
    return r.content


def load_dgm1_crop(meta: dict) -> np.ndarray:
    """1 m DGM1 heights over the map (row 0 = north), metres above meta.minElevationM. Texel centres sit on x.5 m."""
    b = meta["projection"]["boundsUtm"]
    min_e, max_e, min_n, max_n = b["minE"], b["maxE"], b["minN"], b["maxN"]
    size_m = int(round(max_e - min_e))
    min_elev = float(meta["minElevationM"])
    e0, e1 = int(math.floor(min_e / 1000)), int(math.floor((max_e - 1e-6) / 1000))
    n0, n1 = int(math.floor(min_n / 1000)), int(math.floor((max_n - 1e-6) / 1000))
    index = cached(META4_URL, "dgm1_tif_07332.meta4").decode("utf-8", errors="ignore")
    urls: dict[tuple[int, int], tuple[int, str]] = {}
    for u in re.findall(r"<url[^>]*>(.*?\.tif)</url>", index):
        m = re.search(r"dgm1_32_(\d{3})_(\d{4})_1_rp_(\d{4})\.tif", u)
        if m:
            key = (int(m.group(1)), int(m.group(2)))
            if key not in urls or int(m.group(3)) > urls[key][0]:
                urls[key] = (int(m.group(3)), u)

    mosaic = np.full(((n1 - n0 + 1) * 1000, (e1 - e0 + 1) * 1000), np.nan, dtype=np.float32)
    for ek in range(e0, e1 + 1):
        for nk in range(n0, n1 + 1):
            if (ek, nk) not in urls:
                raise RuntimeError(f"DGM1 index has no tile for ({ek}, {nk})")
            url = urls[(ek, nk)][1]
            arr = np.array(Image.open(io.BytesIO(cached(url, os.path.basename(url)))), dtype=np.float32)
            if arr.shape != (1000, 1000):
                raise RuntimeError(f"Unexpected DGM1 tile shape {arr.shape} for {url}")
            mosaic[(n1 - nk) * 1000:(n1 - nk + 1) * 1000, (ek - e0) * 1000:(ek - e0 + 1) * 1000] = arr
    if np.isnan(mosaic).any():
        raise RuntimeError("NaNs in the DGM1 mosaic")

    # DGM1 pixel centres sit on x.5 m; the map bounds are integer metres -> exact 1 m texel alignment.
    col0 = int(round(min_e - e0 * 1000))
    row0 = int(round((n1 + 1) * 1000 - max_n))
    h1 = mosaic[row0:row0 + size_m, col0:col0 + size_m] - min_elev
    if h1.shape != (size_m, size_m):
        raise RuntimeError(f"DGM1 crop has shape {h1.shape}, expected {size_m}x{size_m}")
    return h1


def main() -> None:
    with open(os.path.join(PROJECT_ROOT, "data", "meta.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    size_m = int(round(float(meta["mapSizeM"])))
    grid = int(meta["gridSize"])
    h1 = load_dgm1_crop(meta)


    hm_path = os.path.join(PROJECT_ROOT, "data", "terrain", "heightmap.bin")
    hm = np.fromfile(hm_path, dtype="<f4")
    if hm.size != grid * grid:
        raise RuntimeError(f"heightmap.bin has {hm.size} floats, expected {grid * grid}")
    hm = hm.reshape(grid, grid)
    # Bilinear sample of the 4 m heightmap at the 1 m texel centres (same maths as TerrainSystem.getTerrainHeight).
    t = (np.arange(size_m, dtype=np.float64) + 0.5) / size_m * (grid - 1)
    i0 = np.clip(np.floor(t).astype(np.int32), 0, grid - 2)
    f = (t - i0).astype(np.float32)
    h4 = (hm[np.ix_(i0, i0)] * (1 - f)[:, None] * (1 - f)[None, :] + hm[np.ix_(i0, i0 + 1)] * (1 - f)[:, None] * f[None, :]
          + hm[np.ix_(i0 + 1, i0)] * f[:, None] * (1 - f)[None, :] + hm[np.ix_(i0 + 1, i0 + 1)] * f[:, None] * f[None, :])
    print(f"[relief] DGM1 vs heightmap: mean abs diff {np.abs(h1 - h4).mean():.3f} m, p99 {np.percentile(np.abs(h1 - h4), 99):.3f} m")

    res = cv2.GaussianBlur((h1 - h4).astype(np.float32), (0, 0), 0.7)
    sx = cv2.Sobel(res, cv2.CV_32F, 1, 0, ksize=3) / 8.0   # per metre, +x = east
    sz = cv2.Sobel(res, cv2.CV_32F, 0, 1, ksize=3) / 8.0   # per metre, +z = south (row direction)

    def enc(s: np.ndarray) -> np.ndarray:
        return np.clip(np.round((0.5 + 0.5 * np.sign(s) * np.sqrt(np.minimum(np.abs(s), 1.0))) * 255.0), 0, 255).astype(np.uint8)

    depth = cv2.GaussianBlur(h1, (0, 0), 3.5) - cv2.GaussianBlur(h1, (0, 0), 0.8)
    cavity = 1.0 - 0.55 * np.clip(depth / 0.5, 0.0, 1.0)
    out = np.dstack([enc(sx), enc(sz), np.round(cavity * 255.0).astype(np.uint8)])
    Image.fromarray(out, "RGB").save(OUT_PATH, "JPEG", quality=90, subsampling=0, optimize=True)
    print(f"[relief] wrote {OUT_PATH} {out.shape[1]}x{out.shape[0]} ({os.path.getsize(OUT_PATH) / 1e6:.2f} MB), "
          f"slope p99 {np.percentile(np.hypot(sx, sz), 99):.3f}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[relief] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
