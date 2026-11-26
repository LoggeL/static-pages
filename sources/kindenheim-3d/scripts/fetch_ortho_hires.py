#!/usr/bin/env python3
"""
Fetch the official RLP DOP20 aerial imagery at its native 0.2 m/px for the whole 2048 m Kindenheim map.

Source : LVermGeo RLP OpenData DOP20 WMS  https://geo4.service24.rlp.de/wms/rp_dop20.fcgi  (layer rp_dop20)
Licence: Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0)
         Attribution: (c) GeoBasis-DE / LVermGeoRP (2026), dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]

The map bounds come from data/meta.json (EPSG:25832). The request grid is pixel-exact at 0.2 m and
extends GUTTER_PX beyond the map on every side so the runtime tiles can carry a seamless border.

Polite client: moderate request size (1712 px squares), a pause between requests, generic User-Agent,
no personal data. Every chunk is cached as lossless PNG; re-running only fetches what is missing.

NO FALLBACKS: any HTTP error, wrong image size or blank image aborts with the exact cause.

Usage:
    python3 scripts/fetch_ortho_hires.py [--cache DIR]
Then:
    python3 scripts/build_terrain_ortho.py [--cache DIR]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time

import numpy as np
import requests
from PIL import Image

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_CACHE = os.path.join(PROJECT_ROOT, ".gfx", "terrain", "cache", "dop20")

WMS_URL = "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi"
WMS_LAYER = "rp_dop20"
GSD_M = 0.2            # native DOP20 ground sample distance
GUTTER_PX = 16         # extra pixels fetched beyond the map on each side (3.2 m)
CHUNK_PX = 1712        # (10240 + 2*16) / 6 -> 6 x 6 requests of 342.4 m
PAUSE_S = 1.2
USER_AGENT = "kindenheim3d-geodata/1.1"
WMS_FORMAT = "image/png; mode=24bit"


def load_bounds() -> tuple[float, float, float, float]:
    with open(os.path.join(PROJECT_ROOT, "data", "meta.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    b = meta["projection"]["boundsUtm"]
    if meta["projection"]["crs"] != "EPSG:25832":
        raise RuntimeError(f"Unexpected CRS in data/meta.json: {meta['projection']['crs']}")
    return float(b["minE"]), float(b["minN"]), float(b["maxE"]), float(b["maxN"])


def mosaic_layout() -> dict:
    minE, minN, maxE, maxN = load_bounds()
    map_px = int(round((maxE - minE) / GSD_M))
    if abs(map_px * GSD_M - (maxE - minE)) > 1e-6 or abs(map_px * GSD_M - (maxN - minN)) > 1e-6:
        raise RuntimeError("Map bounds are not a square multiple of the 0.2 m DOP20 grid")
    total_px = map_px + 2 * GUTTER_PX
    if total_px % CHUNK_PX != 0:
        raise RuntimeError(f"Mosaic size {total_px} px is not a multiple of CHUNK_PX={CHUNK_PX}")
    return {
        "originE": minE - GUTTER_PX * GSD_M,          # west edge of mosaic pixel column 0
        "originN": maxN + GUTTER_PX * GSD_M,          # north edge of mosaic pixel row 0
        "mapPx": map_px,
        "totalPx": total_px,
        "chunksPerSide": total_px // CHUNK_PX,
    }


def chunk_path(cache_dir: str, row: int, col: int) -> str:
    return os.path.join(cache_dir, f"dop20_0m2_rgb24_r{row:02d}_c{col:02d}_{CHUNK_PX}.png")


def fetch_chunk(session: requests.Session, layout: dict, row: int, col: int) -> bytes:
    span = CHUNK_PX * GSD_M
    b_minE = layout["originE"] + col * span
    b_maxE = b_minE + span
    b_maxN = layout["originN"] - row * span
    b_minN = b_maxN - span
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": WMS_LAYER,
        "STYLES": "",
        "CRS": "EPSG:25832",
        "BBOX": f"{b_minE:.1f},{b_minN:.1f},{b_maxE:.1f},{b_maxN:.1f}",
        "WIDTH": str(CHUNK_PX),
        "HEIGHT": str(CHUNK_PX),
        # Plain "image/png" is delivered as an 8-bit PALETTE image by this server; request true colour.
        "FORMAT": WMS_FORMAT,
    }
    r = session.get(WMS_URL, params=params, timeout=90)
    if r.status_code != 200:
        raise RuntimeError(f"DOP20 WMS HTTP {r.status_code} for chunk r{row} c{col} (BBOX {params['BBOX']}): {r.text[:300]}")
    ctype = r.headers.get("Content-Type", "")
    if not ctype.startswith("image/png"):
        raise RuntimeError(f"DOP20 WMS returned '{ctype}' instead of image/png for chunk r{row} c{col}: {r.text[:400]}")
    im = Image.open(io.BytesIO(r.content))
    if im.mode not in ("RGB", "RGBA"):
        raise RuntimeError(f"DOP20 chunk r{row} c{col} is not true colour (PIL mode {im.mode}); refusing a palettised image")
    if im.size != (CHUNK_PX, CHUNK_PX):
        raise RuntimeError(f"DOP20 chunk r{row} c{col} has size {im.size}, expected {CHUNK_PX}x{CHUNK_PX}")
    arr = np.asarray(im.convert("RGB"))
    if float(arr.std()) < 4.0:
        raise RuntimeError(f"DOP20 chunk r{row} c{col} looks blank (std={float(arr.std()):.2f})")
    return r.content


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.environ.get("KINDENHEIM_DOP20_CACHE", DEFAULT_CACHE))
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    layout = mosaic_layout()
    n = layout["chunksPerSide"]
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    fetched = 0
    total_bytes = 0
    for row in range(n):
        for col in range(n):
            path = chunk_path(args.cache, row, col)
            if os.path.exists(path) and os.path.getsize(path) > 10_000:
                total_bytes += os.path.getsize(path)
                continue
            t0 = time.time()
            data = fetch_chunk(session, layout, row, col)
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            fetched += 1
            total_bytes += len(data)
            print(f"[dop20] r{row} c{col}: {len(data) / 1e6:.2f} MB in {time.time() - t0:.1f}s", flush=True)
            time.sleep(PAUSE_S)

    print(f"[dop20] done: {n * n} chunks ({fetched} newly fetched), {total_bytes / 1e6:.1f} MB in {args.cache}")
    print(f"[dop20] mosaic {layout['totalPx']}x{layout['totalPx']} px at {GSD_M} m/px, gutter {GUTTER_PX} px")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # fail loud with the exact cause
        print(f"[dop20] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
