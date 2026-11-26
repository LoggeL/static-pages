#!/usr/bin/env python3
"""
Fetch coarse aerial imagery of the countryside AROUND the 2048 m Kindenheim map for the far terrain ring.

Source : LVermGeo RLP OpenData DOP20 WMS  https://geo4.service24.rlp.de/wms/rp_dop20.fcgi  (layer rp_dop20)
Licence: dl-de/by-2-0, (c) GeoBasis-DE / LVermGeoRP (2026) [Daten bearbeitet]

Two requests only (polite client, generic User-Agent, no personal data), both centred on the map centre:
    inner   6144 m square at 1.5 m/px  (4096 px)  -> shipped at 3 m/px
    outer  16384 m square at 4.0 m/px  (4096 px)  -> shipped at 8 m/px
The server resamples its 0.2 m mosaic itself. Cached as true-colour PNG; re-running fetches only what is missing.
NO FALLBACKS: an HTTP error, a palettised/blank image or a wrong size aborts with the cause.

Usage:  python3 scripts/fetch_ortho_far.py [--cache DIR]     then  python3 scripts/build_terrain_far.py
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
DEFAULT_CACHE = os.path.join(PROJECT_ROOT, ".gfx", "terrain", "cache", "dop20_far")
WMS_URL = "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi"
USER_AGENT = "kindenheim3d-geodata/1.1"
REQUEST_PX = 4096
RINGS = {"inner": 6144.0, "outer": 16384.0}  # square side in metres


def ring_path(cache: str, name: str) -> str:
    return os.path.join(cache, f"dop20_far_{name}_{int(RINGS[name])}m_{REQUEST_PX}.png")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    with open(os.path.join(PROJECT_ROOT, "data", "meta.json"), "r", encoding="utf-8") as f:
        proj = json.load(f)["projection"]
    if proj["crs"] != "EPSG:25832":
        raise RuntimeError(f"Unexpected CRS {proj['crs']}")
    ce, cn = float(proj["centerUtmE"]), float(proj["centerUtmN"])

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    for name, side in RINGS.items():
        path = ring_path(args.cache, name)
        if os.path.exists(path) and os.path.getsize(path) > 100_000:
            print(f"[far] {name}: cached")
            continue
        h = side / 2.0
        params = {
            "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": "rp_dop20", "STYLES": "",
            "CRS": "EPSG:25832", "BBOX": f"{ce - h:.1f},{cn - h:.1f},{ce + h:.1f},{cn + h:.1f}",
            "WIDTH": str(REQUEST_PX), "HEIGHT": str(REQUEST_PX), "FORMAT": "image/png; mode=24bit",
        }
        t0 = time.time()
        r = session.get(WMS_URL, params=params, timeout=180)
        if r.status_code != 200 or not r.headers.get("Content-Type", "").startswith("image/png"):
            raise RuntimeError(f"DOP20 WMS answered HTTP {r.status_code} / {r.headers.get('Content-Type')} for ring '{name}': {r.text[:300]}")
        im = Image.open(io.BytesIO(r.content))
        if im.mode not in ("RGB", "RGBA") or im.size != (REQUEST_PX, REQUEST_PX):
            raise RuntimeError(f"Ring '{name}': unexpected image mode {im.mode} / size {im.size}")
        arr = np.asarray(im.convert("RGB"))
        if float(arr.std()) < 4.0:
            raise RuntimeError(f"Ring '{name}' looks blank (std {float(arr.std()):.2f})")
        white = float((arr.min(axis=2) > 250).mean())
        if white > 0.02:
            raise RuntimeError(f"Ring '{name}': {white * 100:.1f}% pure white pixels - outside the DOP20 coverage?")
        with open(path + ".part", "wb") as f:
            f.write(r.content)
        os.replace(path + ".part", path)
        print(f"[far] {name}: {len(r.content) / 1e6:.1f} MB in {time.time() - t0:.1f}s", flush=True)
        time.sleep(2.0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[far] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
