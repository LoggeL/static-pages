#!/usr/bin/env python3
"""
Grade a proper road bed into the terrain height field data/terrain/heightmap.bin.

Why: data/terrain/heightmap.bin samples the 1 m LiDAR model every 4 m. A 5-7 m road between banks or plot
walls cannot be represented at that spacing - samples land on the bank, so the rendered street was tilted and
"mounds" spilled over the sidewalks. The LiDAR model itself contains the real, level road surface.

What:  for every paved road (L 450 / Hauptstraße, K 26, village streets, paved service roads and farm tracks)
       1. bed height = median of the 1 m DGM1 across the carriageway at stations every 2 m, smoothed along the road
          (sigma 6 m) -> level cross-section, smooth longitudinal profile, true street level. Where a road meets
          a higher-class road its bed is pinned to that road's bed, so junctions are flush;
       2. all four corner vertices of every 4 m cell that the road surface (carriageway + sidewalk) touches are set
          exactly to the bed height, so the rendered terrain IS the level road and
          the physics, the draped road decals and everything placed on the ground agree; beyond that the height
          blends back to the natural terrain over 6 m (cut / fill shoulders).
       Unpaved tracks and paths are left alone, as is the Kinderbach bridge span. Inside building footprints the
       ground is never raised by more than 0.3 m (houses are baked at their old base height).

Files: data/terrain/heightmap_dgm.bin   the untouched 4 m sample of the DGM1 (created once from heightmap.bin)
       data/terrain/heightmap.bin       graded result = THE height field of the app and of every offline builder
       data/terrain/heightmap_grading.json   what moved under which building (for the owners of baked models)
Format unchanged: Float32 little-endian, 513 x 513, row-major north->south / west->east, metres above minElevationM.

Source of the bed heights: LVermGeo RLP OpenData DGM1 (dl-de/by-2-0), tiles from the existing geodata cache.
NO FALLBACKS: missing inputs abort.

Usage:  python3 scripts/build_terrain_roadbed.py      (idempotent; then re-run scripts/build_terrain_relief.py)
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_terrain_relief import PROJECT_ROOT, load_dgm1_crop  # noqa: E402

SRC_PATH = os.path.join(PROJECT_ROOT, "data", "terrain", "heightmap_dgm.bin")
OUT_PATH = os.path.join(PROJECT_ROOT, "data", "terrain", "heightmap.bin")
REPORT_PATH = os.path.join(PROJECT_ROOT, "data", "terrain", "heightmap_grading.json")
STATION_M = 2.0
PAD_M = 1.5      # where the shoulder blend starts beyond the road surface edge (vertices of touched cells are always level)
PRIORITY = {"service": 0, "village": 1, "lane": 2, "highway": 3}
BLEND_M = 6.0    # shoulder: back to natural terrain
BRIDGE = (-317.3, 210.8, 15.0)  # Kinderbach bridge on Triftstraße: centre x, z, exclusion radius


def classify(road: dict) -> str | None:
    hw = (road.get("highway") or "").lower()
    surf = (road.get("surface") or "").lower()
    if hw in ("primary", "primary_link", "trunk", "secondary", "secondary_link"):
        return "highway"
    if hw in ("tertiary", "tertiary_link", "unclassified", "road"):
        return "lane"
    if hw in ("residential", "living_street"):
        return "village"
    if hw == "service":
        return "service"
    if hw == "track" and surf in ("paved", "asphalt", "concrete"):
        return "service"
    return None  # unpaved tracks / paths / steps: not graded


def inside_urban(x: float, z: float) -> bool:  # same box as src/roads.ts isInsideUrbanVillage
    return -475 <= x <= 515 and -265 <= z <= 185


def surface_half_width(base: str, width: float, x: float, z: float) -> tuple[float, float]:
    """Returns (carriageway half width, full surface half width) like src/roads.ts."""
    if base == "highway":
        if inside_urban(x, z):
            core = min(max(width * 0.5 - 1.05, 2.2), 3.2)
            return core, core + 1.2
        core = min(max(width * 0.5 - 0.45, 2.6), 3.6)
        return core, core + 0.45
    if base == "village":
        w = min(max(width, 3.8), 7.5)
        return w * 0.5, w * 0.5 + 0.06
    if base == "lane":
        core = min(max(width, 4.0), 8.0) * 0.5 - 0.2
        return core, core + 0.45
    core = min(max(width, 2.4), 6.0) * 0.5 - 0.1
    return core, core + 0.4


def resample(pts: np.ndarray, step: float) -> np.ndarray:
    seg = np.hypot(*np.diff(pts, axis=0).T)
    keep = np.concatenate([[True], seg > 0.05])
    pts = pts[keep]
    seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    n = max(2, int(math.ceil(s[-1] / step)) + 1)
    t = np.linspace(0.0, s[-1], n)
    return np.stack([np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])], axis=1)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def main() -> None:
    with open(os.path.join(PROJECT_ROOT, "data", "meta.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    grid = int(meta["gridSize"])
    size_m = float(meta["mapSizeM"])
    half = size_m / 2.0
    if not os.path.exists(SRC_PATH):
        # first run: keep the pristine DGM sample; from now on heightmap.bin is the graded field
        import shutil
        shutil.copyfile(OUT_PATH, SRC_PATH)
        print(f"[roadbed] saved the ungraded height field as {SRC_PATH}")
    hm = np.fromfile(SRC_PATH, dtype="<f4")
    if hm.size != grid * grid:
        raise RuntimeError(f"heightmap_dgm.bin has {hm.size} floats, expected {grid * grid}")
    hm = hm.reshape(grid, grid).astype(np.float64)
    dgm = load_dgm1_crop(meta)  # 2048 x 2048, 1 m, metres above minElevationM, texel centres at +0.5 m
    n1 = dgm.shape[0]

    def dgm_at(x: np.ndarray, z: np.ndarray) -> np.ndarray:
        fx = np.clip(x + half - 0.5, 0, n1 - 1.001)
        fz = np.clip(z + half - 0.5, 0, n1 - 1.001)
        x0 = np.floor(fx).astype(int)
        z0 = np.floor(fz).astype(int)
        tx, tz = fx - x0, fz - z0
        return (dgm[z0, x0] * (1 - tx) * (1 - tz) + dgm[z0, x0 + 1] * tx * (1 - tz)
                + dgm[z0 + 1, x0] * (1 - tx) * tz + dgm[z0 + 1, x0 + 1] * tx * tz)

    with open(os.path.join(PROJECT_ROOT, "data", "osm", "kindenheim_scene.json"), "r", encoding="utf-8") as f:
        scene = json.load(f)

    roads = []
    for ri, road in enumerate(scene["roads"]):
        base = classify(road)
        if base is None or len(road["points"]) < 2:
            continue
        pts = resample(np.array([[p[0], p[-1]] for p in road["points"]], dtype=np.float64), STATION_M)
        if len(pts) < 2:
            continue
        tan = np.gradient(pts, axis=0)
        tan /= np.maximum(np.hypot(tan[:, 0], tan[:, 1]), 1e-6)[:, None]
        right = np.stack([-tan[:, 1], tan[:, 0]], axis=1)
        width = float(road.get("widthM") or 0) or {"highway": 7.2, "lane": 5.8, "village": 5.0, "service": 3.4}[base]
        cores, outers = zip(*[surface_half_width(base, width, x, z) for x, z in pts])
        cores, outers = np.array(cores), np.array(outers)
        # median of the LiDAR surface across the carriageway (robust against kerbs, banks and car-sized noise)
        offs = np.linspace(-1.0, 1.0, 9)
        samples = np.stack([dgm_at(pts[:, 0] + right[:, 0] * o * cores * 0.85, pts[:, 1] + right[:, 1] * o * cores * 0.85) for o in offs])
        raw = np.median(samples, axis=0)
        roads.append({"ri": ri, "prio": PRIORITY[base], "pts": pts, "raw": raw, "level": outers + PAD_M, "outer": outers,
                      "bed": gaussian_filter1d(raw, sigma=6.0 / STATION_M, mode="nearest"),
                      "ok": np.hypot(pts[:, 0] - BRIDGE[0], pts[:, 1] - BRIDGE[1]) > BRIDGE[2]})

    # Junctions: pin the bed of a lower-class road to the higher-class road wherever it runs inside that road's
    # surface, then re-smooth with the pins held (so the side street ramps onto the main road).
    for prio in (2, 1, 0):
        higher = [r for r in roads if r["prio"] > prio]
        if not higher:
            continue
        h_xy = np.concatenate([r["pts"] for r in higher])
        h_bed = np.concatenate([r["bed"] for r in higher])
        h_out = np.concatenate([r["outer"] for r in higher])
        h_tree = cKDTree(h_xy)
        for r in (x for x in roads if x["prio"] == prio):
            dist, idx = h_tree.query(r["pts"])
            pinned = dist < h_out[idx] + r["outer"]
            if not pinned.any():
                continue
            target = h_bed[idx]
            bed = r["raw"].copy()
            for _ in range(12):
                bed[pinned] = target[pinned]
                bed = gaussian_filter1d(bed, sigma=6.0 / STATION_M, mode="nearest")
            bed[pinned] = target[pinned]
            r["bed"] = bed

    # heightmap vertices: lower classes first, higher classes last (they win inside their own level zone)
    coords = np.linspace(-half, half, grid)
    vx, vz = np.meshgrid(coords, coords)
    vxy = np.stack([vx.ravel(), vz.ravel()], axis=1)
    src = hm.ravel()
    out = src.copy()
    weight = np.zeros(out.size)
    for prio in (0, 1, 2, 3):
        group = [r for r in roads if r["prio"] == prio]
        if not group:
            continue
        g_xy = np.concatenate([r["pts"][r["ok"]] for r in group])
        g_bed = np.concatenate([r["bed"][r["ok"]] for r in group])
        g_lvl = np.concatenate([r["level"][r["ok"]] for r in group])
        g_out = np.concatenate([r["outer"][r["ok"]] for r in group])
        g_road = np.concatenate([np.full(int(r["ok"].sum()), r["ri"]) for r in group])
        tree = cKDTree(g_xy)

        # (a) shoulders: blend towards the bed by distance from the centre line
        reach = float(g_lvl.max() + BLEND_M + STATION_M)
        for vi, idxs in enumerate(tree.query_ball_point(vxy, r=reach)):
            if not idxs:
                continue
            idxs = np.asarray(idxs)
            d = np.hypot(g_xy[idxs, 0] - vxy[vi, 0], g_xy[idxs, 1] - vxy[vi, 1])
            best_w, acc_w, acc_h = 0.0, 0.0, 0.0
            for rr in np.unique(g_road[idxs]):
                m = g_road[idxs] == rr
                k = int(np.argmin(d[m]))
                lvl = float(g_lvl[idxs][m][k])
                w = 1.0 - float(smoothstep(lvl, lvl + BLEND_M, np.array(float(d[m][k]))))
                if w <= 0.0:
                    continue
                best_w = max(best_w, w)
                acc_w += w ** 4
                acc_h += w ** 4 * float(g_bed[idxs][m][k])
            if best_w > 0.0:
                out[vi] = out[vi] * (1.0 - best_w) + (acc_h / acc_w) * best_w
                weight[vi] = max(weight[vi], best_w)

        # (b) exact: the corners of every cell the road surface touches take the bed of the nearest station
        cell = size_m / (grid - 1)
        touched = np.zeros((grid, grid), dtype=bool)
        for (sx, sz), so in zip(g_xy, g_out):
            cx0 = int(np.floor((sx - so + half) / cell))
            cx1 = int(np.floor((sx + so + half) / cell))
            cz0 = int(np.floor((sz - so + half) / cell))
            cz1 = int(np.floor((sz + so + half) / cell))
            for cz in range(max(cz0, 0), min(cz1, grid - 2) + 1):
                for cx in range(max(cx0, 0), min(cx1, grid - 2) + 1):
                    nx = min(max(sx, -half + cx * cell), -half + (cx + 1) * cell)
                    nz = min(max(sz, -half + cz * cell), -half + (cz + 1) * cell)
                    if (nx - sx) ** 2 + (nz - sz) ** 2 <= so * so:
                        touched[cz:cz + 2, cx:cx + 2] = True
        tv = np.flatnonzero(touched.ravel())
        if tv.size:
            _, nearest = tree.query(vxy[tv])
            out[tv] = g_bed[nearest]
            weight[tv] = 1.0

    # Never bury a house: inside building footprints fill is limited to 0.3 m.
    # Cuts are fine - the village houses carry a 2 m foundation skirt.
    import cv2
    fp = np.zeros((grid, grid), dtype=np.uint8)
    polys = [np.round(np.array([[(p[0] + half) / size_m * (grid - 1), (p[1] + half) / size_m * (grid - 1)] for p in b["footprint"]])).astype(np.int32)
             for b in scene["buildings"] if len(b["footprint"]) >= 3]
    cv2.fillPoly(fp, polys, 1)
    limit = fp.ravel() > 0
    out[limit] = np.minimum(out[limit], src[limit] + 0.3)
    out = np.maximum(out, 0.0).reshape(grid, grid)
    delta = out - hm
    out.astype("<f4").tofile(OUT_PATH)

    changed = np.abs(delta) > 0.02
    print(f"[roadbed] graded {int((weight > 0).sum())} of {grid * grid} vertices; changed > 2 cm: {int(changed.sum())}; "
          f"cut max {delta.min():.2f} m, fill max {delta.max():.2f} m, mean |delta| where changed {np.abs(delta[changed]).mean():.2f} m")

    def graded_at(x: float, z: float, arr: np.ndarray) -> float:
        gx = min(max((x + half) / size_m * (grid - 1), 0), grid - 1.001)
        gz = min(max((z + half) / size_m * (grid - 1), 0), grid - 1.001)
        x0, z0 = int(gx), int(gz)
        tx, tz = gx - x0, gz - z0
        return float(arr[z0, x0] * (1 - tx) * (1 - tz) + arr[z0, x0 + 1] * tx * (1 - tz) + arr[z0 + 1, x0] * (1 - tx) * tz + arr[z0 + 1, x0 + 1] * tx * tz)

    # What moved under buildings (for the owners of baked models)
    report = {"note": "height change (heightmap.bin - heightmap_dgm.bin) in metres, sampled at footprint vertices; negative = cut",
              "maxCutM": round(float(delta.min()), 2), "maxFillM": round(float(delta.max()), 2), "landmarks": {}, "buildingsOver30cm": []}
    for b in scene["buildings"]:
        ds = [graded_at(p[0], p[1], delta) for p in b["footprint"]] + [graded_at(b["center"][0], b["center"][1], delta)]
        lo, hi = min(ds), max(ds)
        entry = {"id": b["id"], "center": [round(b["center"][0], 1), round(b["center"][1], 1)], "minDeltaM": round(lo, 2), "maxDeltaM": round(hi, 2)}
        if b.get("landmarkKey"):
            report["landmarks"].setdefault(b["landmarkKey"], []).append(entry)
        elif max(abs(lo), abs(hi)) > 0.3:
            report["buildingsOver30cm"].append(entry)
    report["buildingsOver30cm"].sort(key=lambda e: e["minDeltaM"])
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    print(f"[roadbed] {len(report['buildingsOver30cm'])} ordinary buildings have a footprint vertex moved by > 0.3 m")
    for k, v in report["landmarks"].items():
        print(f"[roadbed] landmark {k}: " + ", ".join(f"{e['id']} {e['minDeltaM']:+.2f}..{e['maxDeltaM']:+.2f}" for e in v))
    print(f"[roadbed] wrote {OUT_PATH} and {REPORT_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[roadbed] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
