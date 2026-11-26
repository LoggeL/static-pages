#!/usr/bin/env python3
"""
Detect trees, hedges, shrubs and rough ground patches in the 0.2 m DOP20 aerial of Kindenheim and write
data/osm/vegetation_layout.json (contract: .gfx/VEGETATION_LAYOUT_SCHEMA.md).

Inputs (all local, nothing is downloaded):
    .gfx/terrain/cache/dop20/dop20_0m2_rgb24_rRR_cCC_1712.png   lossless 0.2 m aerial chunks (scripts/fetch_ortho_hires.py)
                                                               - NOT the shipped WebP tiles: those have their cast
                                                               shadows lifted, and shadows are what gives heights here.
    data/osm/kindenheim_scene.json   buildings, roads, landuse, waterways, OSM trees
    data/osm/fields_layout.json      crop parcels
    data/terrain/landuse_mask.png    1 m landuse classes

Method (details next to each stage):
    1  per-pixel features (colour at three scales, local contrast, structure tensor) -> gradient-boosted
       classifier trained on hand-labelled discs (LABELS below) plus automatic labels from OSM (roofs, vineyards,
       crop parcels) -> classes woody / grass / shadow / other / rowcrop
    2  sun azimuth from building shadows (shifted-footprint correlation), elevation from shadow length vs LoD2
       building height
    3  woody mask -> thick parts (crowns, split by watershed on distance transform + brightness) and thin parts
       (hedges: skeleton -> polylines); small compact blobs -> shrubs
    4  height from cast-shadow length where the shadow lands on open ground, otherwise allometry per kind
    5  exclusions (buildings +1 m, road surfaces, vineyards, crop parcels, pitches, playground), OSM tree merge
    6  rough patches (lawn, tall grass, garden beds, ruderal strips, reed) from the class map

NO FALLBACKS: a missing input aborts with the cause.

Usage:  python3 scripts/detect_vegetation.py [--cache DIR] [--reuse] [--overlays]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DOP_CACHE = os.path.join(ROOT, ".gfx", "terrain", "cache", "dop20")
WORK = os.path.join(ROOT, ".gfx", "detect")
OUT_JSON = os.path.join(ROOT, "data", "osm", "vegetation_layout.json")
GSD = 0.2
HALF = 1024.0
N = 10240
CHUNK_PX = 1712
GUTTER_PX = 16

WOODY, GRASS, SHADOW, OTHER, CROP = 0, 1, 2, 3, 4
CLASS_NAMES = ["woody", "grass", "shadow", "other", "crop"]

# Pitches + playground, copied from src/recreation.ts (RECREATION_EXCLUSION_POLYS).
RECREATION_POLYS = [
    [[3, -327], [89, -365], [110, -301], [25, -271]],
    [[91, -354], [121, -358], [133, -299], [106, -297]],
    [[57, -267], [91, -269], [90, -223], [58, -222]],
]


def log(msg: str) -> None:
    print(f"[detect] {msg}", flush=True)


def ell(k: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def w2p(v):
    """world metres -> fractional pixel coordinate (pixel i covers [i, i+1))."""
    return (np.asarray(v, dtype=np.float64) + HALF) / GSD


def p2w(i):
    """pixel index -> world metres of the pixel centre."""
    return (np.asarray(i, dtype=np.float64) + 0.5) * GSD - HALF


# ----------------------------------------------------------------------------------------------------------
# input
# ----------------------------------------------------------------------------------------------------------
def load_mosaic() -> np.ndarray:
    n = (N + 2 * GUTTER_PX) // CHUNK_PX
    if n * CHUNK_PX != N + 2 * GUTTER_PX:
        raise RuntimeError("mosaic size is not a multiple of the chunk size")
    mosaic = np.empty((n * CHUNK_PX, n * CHUNK_PX, 3), np.uint8)
    for row in range(n):
        for col in range(n):
            path = os.path.join(DOP_CACHE, f"dop20_0m2_rgb24_r{row:02d}_c{col:02d}_{CHUNK_PX}.png")
            if not os.path.exists(path):
                raise RuntimeError(f"Missing lossless DOP20 chunk {path} - run scripts/fetch_ortho_hires.py first")
            im = Image.open(path).convert("RGB")
            if im.size != (CHUNK_PX, CHUNK_PX):
                raise RuntimeError(f"Chunk {path} has size {im.size}, expected {CHUNK_PX}")
            mosaic[row * CHUNK_PX:(row + 1) * CHUNK_PX, col * CHUNK_PX:(col + 1) * CHUNK_PX] = np.asarray(im)
    return np.ascontiguousarray(mosaic[GUTTER_PX:-GUTTER_PX, GUTTER_PX:-GUTTER_PX])


def load_json(rel: str):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        raise RuntimeError(f"Missing input {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def poly_px(pts) -> np.ndarray:
    a = np.array([[p[0], p[-1]] for p in pts], np.float64)
    return np.round(w2p(a) - 0.5).astype(np.int32)


# ----------------------------------------------------------------------------------------------------------
# stage 1: features + classifier
# ----------------------------------------------------------------------------------------------------------
FEATURE_MARGIN = 32


def features(rgb: np.ndarray) -> np.ndarray:
    """rgb uint8 (H, W, 3) -> float32 (H, W, F). Deliberately local (<= ~1.5 m reach): larger kernels made the class
    map bleed across crown / lawn / shadow borders. Row crops are handled by masks and detect_row_crops()."""
    f = rgb.astype(np.float32)
    r, g, b = f[:, :, 0], f[:, :, 1], f[:, :, 2]
    s = np.maximum(r + g + b, 1.0)
    lum = s / 3.0
    exg = (2.0 * g - r - b) / s
    rb = (r - b) / s

    def G(a, sig):
        return cv2.GaussianBlur(a, (0, 0), sig)

    lum1 = G(lum, 1.0)
    mu = cv2.blur(lum, (5, 5))
    sd5 = np.sqrt(np.maximum(cv2.blur(lum * lum, (5, 5)) - mu * mu, 0.0))
    sd_open = cv2.morphologyEx(sd5, cv2.MORPH_OPEN, ell(9))
    l1 = G(lum, 0.8)
    gx = cv2.Sobel(l1, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    gy = cv2.Sobel(l1, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    jxx, jyy, jxy = G(gx * gx, 4.0), G(gy * gy, 4.0), G(gx * gy, 4.0)
    tr = (jxx + jyy) * 0.5
    d = np.sqrt(((jxx - jyy) * 0.5) ** 2 + jxy ** 2)
    out = [lum1, G(lum, 2.5), G(lum, 5.0), G(exg, 1.0), G(exg, 2.5), G(exg, 5.0), G(rb, 1.0), G(rb, 3.0),
           sd5, G(sd5, 3.0), G(sd5, 6.0), G(sd_open, 3.0), np.sqrt(tr + d), np.sqrt(np.maximum(tr - d, 0.0)),
           cv2.erode(lum1, ell(9)), cv2.dilate(lum1, ell(9)), cv2.erode(lum1, ell(17)), cv2.dilate(lum1, ell(17)),
           G((lum1 < 55).astype(np.float32), 5.0)]
    return np.stack(out, axis=2)


# Hand labels: (x, z, radius m, class). Picked on 2x zooms of the aerial with a 10 m grid (.gfx/detect/grid_*.jpg).
LABELS: list[tuple[float, float, float, int]] = [
    # --- window 500..600 / -200..-100 (new-build gardens east)
    (540, -108, 3, WOODY), (551, -178, 2, WOODY), (536.5, -171, 1.3, WOODY), (541.5, -177, 1.3, WOODY),
    (592, -153.5, 0.7, WOODY), (562, -136, 1.8, WOODY), (545, -110, 3.5, WOODY),
    (575, -115, 2.5, WOODY), (554, -126, 1.8, WOODY),
    (522, -173, 3.5, GRASS), (582.5, -185.5, 1.3, GRASS),
    (526, -132, 1.8, SHADOW), (585, -180, 1.2, SHADOW),
    (507, -155.5, 1.8, OTHER), (560, -146, 2, OTHER), (520, -190, 2, OTHER),
    # --- window 550..650 / -150..-50 (creek belt, paddock)
    (617, -115, 4, WOODY), (608, -120, 3, WOODY), (625, -108, 3, WOODY), (565, -100, 4, WOODY), (556, -90, 2.5, WOODY),
    (640, -104, 4, WOODY), (632, -106, 3, WOODY), (634, -70, 3, WOODY), (583, -58, 2.5, WOODY), (596.5, -143.5, 1.8, WOODY),
    (574, -117, 1.3, WOODY),
    (626, -91, 1.8, SHADOW), (624.5, -69, 2.5, SHADOW), (628, -108, 1.3, SHADOW), (593, -144.5, 1.3, SHADOW),
    (570, -80, 4, GRASS), (565, -70, 3, GRASS),
    (600, -85, 6, OTHER), (590, -75, 4, OTHER), (570, -143, 2, OTHER),
    # --- window -50..50 / -150..-50 (village core)
    (-19, -67.5, 4.5, WOODY), (-35, -116, 3.5, WOODY), (-43, -112, 2.2, WOODY),
    (-15, -139, 1.3, WOODY), (-14, -135, 1.3, WOODY), (42, -142, 3.5, WOODY), (24.5, -129, 1.5, WOODY), (-38, -129, 1.2, WOODY),
    (2, -136.5, 1.8, GRASS), (20, -123, 2.2, GRASS), (-45.5, -104.5, 1.8, GRASS), (-47, -128.5, 2.2, GRASS),
    (-4, -141.5, 2, OTHER), (-5, -125, 3, OTHER), (15, -60, 3, OTHER),
    # --- window 500..600 / -90..10 (meadow south of the creek, farmyard)
    (520, -60, 6, GRASS), (540, -65, 6, GRASS), (525, -48, 4, GRASS), (550, -55, 4, GRASS), (572, -75, 4, GRASS), (515, -72, 3, GRASS),
    (533, -43, 2.5, SHADOW), (548, -43, 2, SHADOW), (505.5, -34.5, 2.5, SHADOW), (560.5, -46.5, 2, SHADOW), (540, -12.5, 1.0, SHADOW),
    (563, -23, 2.5, SHADOW),
    (517, -25, 4, WOODY), (520, -2, 4, WOODY), (540, -35, 3, WOODY), (553, -37, 3, WOODY), (580, -35, 4, WOODY), (590, -30, 3, WOODY),
    (578, -15, 4, WOODY), (585, -55, 3, WOODY), (573, -44, 2, WOODY), (505, -75, 3, WOODY), (535, -87, 2.5, WOODY), (502.5, -29, 2, WOODY),
    (545, -22, 4, OTHER), (540, -3, 5, OTHER), (595, -70, 3, OTHER), (590, -10, 3, OTHER),
    # --- window -400..-300 / 0..100 (old village west)
    (-385, 31.5, 3, WOODY), (-337, 18, 4, WOODY), (-355, 24, 2.5, WOODY), (-351, 84, 2.5, WOODY), (-386, 94, 2, WOODY),
    (-376, 73, 0.8, WOODY), (-388, 53, 1.5, WOODY), (-380, 45, 1, WOODY),
    (-383, 87, 1, SHADOW), (-345, 71.5, 2, SHADOW), 
    (-393, 44, 3, GRASS), (-385.5, 19, 1.2, GRASS),
    (-360, 75, 2, OTHER), (-378, 52, 2, OTHER), (-355, 45, 4, OTHER), (-310, 10, 4, OTHER),
    # --- window 150..250 / -350..-250 (1970s housing north-east)
    (165, -338, 3.5, WOODY), (156, -272, 2.5, WOODY), (176, -267, 2.5, WOODY), (232, -297.5, 2, WOODY), (183, -312, 1.8, WOODY),
    (178, -323, 1.5, WOODY), (186, -345, 1.2, WOODY), (192, -346, 1, WOODY), (240, -311, 0.8, WOODY), (241, -307, 0.8, WOODY),
    (191.5, -336, 0.8, WOODY),
    (195, -343, 1.5, GRASS), (204, -321.5, 1.5, GRASS), (199, -285.5, 1.5, GRASS), (187, -275, 1.5, GRASS), (212, -346, 1.5, GRASS),
    (203, -307.5, 2, SHADOW), (155, -336.5, 2.5, SHADOW), (226, -297.5, 2, SHADOW), (167, -296.5, 2, SHADOW),
    (178, -305.5, 1.5, OTHER), (160, -300, 1.5, OTHER), (210, -315, 2, OTHER), (152, -342, 2, OTHER),
    # --- window -700..-540 / 350..510 (creek belt west, farm)
    (-648, 405, 5, WOODY), (-640, 432, 4, WOODY), (-680, 440, 4, WOODY),
    (-660, 400, 2, SHADOW),
    (-595, 430, 4, OTHER), (-590, 385, 5, OTHER),
    # --- window -300..-200 / -100..0 (dense old village)
    (-268, -62, 1.5, SHADOW), (-261.5, -37, 1.2, SHADOW), (-233, -67, 2, SHADOW),
    (-230, -12, 3, WOODY), (-204, -6, 3, WOODY), (-296.5, -35, 2, WOODY), (-206, -82, 1.8, WOODY), (-222.5, -91, 1.5, WOODY),
    (-245.5, -60, 2, CROP),
    (-245.5, -45, 2, GRASS),
    (-285, -65, 2, OTHER),
    # --- window 300..400 / -80..20 (creek meadow behind the eastern gardens, barn)
    (330, -26, 3.5, GRASS), (350, -27, 3.5, GRASS), (385, -27, 3, GRASS), (339, -56.5, 3.5, GRASS), (376, -61, 3, GRASS),
    (315.5, -54.5, 1.3, GRASS), (396, -38, 1.8, GRASS),
    (365, -16, 3.5, SHADOW), (346.5, -52, 1.8, SHADOW), (342.5, 0, 2.2, SHADOW),
    (361, -44, 4, WOODY), (305, -44, 4, WOODY), (324, 3, 5, WOODY), (308, 8, 4, WOODY), (379.5, -14.5, 3, WOODY), (392, -18, 3, WOODY),
    (355, 16, 3, WOODY), (386, -75.5, 2, WOODY),
    (329, -8, 1.5, OTHER), (337, -14.5, 2, OTHER),
    # --- window -150..-50 / 230..330 (field margin south, rough meadow)
    (-105, 284, 5, GRASS), (-122.5, 297, 3, GRASS), (-101, 300, 5, GRASS), (-134, 288, 2.5, GRASS),
    (-88.5, 284.5, 3, SHADOW), (-61.5, 279, 2.5, SHADOW),
    (-80, 285, 2.5, WOODY), (-55, 280.5, 2.5, WOODY), (-135, 304.5, 4, WOODY), (-128, 318, 3.5, WOODY), (-69, 283.5, 1.2, WOODY),
    (-120, 262, 6, OTHER), (-75, 270, 5, OTHER), (-80, 311, 1.5, OTHER), (-70, 295, 4, OTHER),
    (-100, 235, 5, CROP),
    # --- window 40..140 / -300..-200 (playground, hall, sports ground edge)
    (80, -247, 4, GRASS), (69, -224.5, 3, GRASS), (130.5, -259, 2, GRASS),
    (44.5, -277.5, 3, SHADOW), (133, -282, 2.5, SHADOW),
    (56, -270, 5, WOODY), (74.5, -271.5, 3, WOODY), (84, -281.5, 4, WOODY), (96, -268.5, 3.5, WOODY), (106, -286, 4, WOODY),
    (83.5, -231.5, 3.5, WOODY), (133.5, -248, 2.5, WOODY), (126, -266.5, 2.5, WOODY), (136, -235.5, 3, WOODY), (129, -211, 5, WOODY),
    (114, -206.5, 3.5, WOODY), (98, -227, 1.8, WOODY),
    (50, -295, 3, OTHER), (100, -218, 1.5, OTHER), (66, -252, 2, OTHER), (132, -290, 2, OTHER),
]


def disc_pixels(x: float, z: float, r: float) -> tuple[np.ndarray, np.ndarray]:
    cx, cy = w2p(x), w2p(z)
    rp = r / GSD
    ys, xs = np.mgrid[int(cy - rp) - 1:int(cy + rp) + 2, int(cx - rp) - 1:int(cx + rp) + 2]
    keep = (xs + 0.5 - cx) ** 2 + (ys + 0.5 - cy) ** 2 <= rp * rp
    return ys[keep], xs[keep]


def crop_features(rgb: np.ndarray, y0: int, y1: int, x0: int, x1: int) -> np.ndarray:
    m = FEATURE_MARGIN
    ya, yb, xa, xb = max(0, y0 - m), min(N, y1 + m), max(0, x0 - m), min(N, x1 + m)
    F = features(rgb[ya:yb, xa:xb])
    return F[y0 - ya:y0 - ya + (y1 - y0), x0 - xa:x0 - xa + (x1 - x0)]


def auto_label_points(scene, fields, lum8: np.ndarray, rng: np.random.Generator) -> list[tuple[int, int, int]]:
    """(row, col, class) samples from OSM: roof interiors -> other, green-crop parcel interiors -> crop,
    cereal / stubble interiors -> other. Vineyards are NOT a class: at this scale vine foliage is woody canopy,
    they are removed by polygon masks and the stripe detector instead."""
    pts: list[tuple[int, int, int]] = []

    def sample(mask: np.ndarray, cls: int, n: int) -> None:
        ys, xs = np.nonzero(mask)
        if len(ys) == 0:
            raise RuntimeError(f"auto-label mask for class {CLASS_NAMES[cls]} is empty")
        idx = rng.choice(len(ys), size=min(n, len(ys)), replace=False)
        pts.extend((int(ys[i]), int(xs[i]), cls) for i in idx)

    mask = np.zeros((N, N), np.uint8)
    for b in scene["buildings"]:
        cv2.fillPoly(mask, [poly_px(b["footprint"])], 1)
    sample(cv2.erode(mask, ell(21)), OTHER, 25000)                       # >= 2 m inside a roof outline
    green = np.zeros((N, N), np.uint8)
    dry = np.zeros((N, N), np.uint8)
    for fl in fields["fields"]:
        if fl["source"] != "dop20_segmented" and not fl["source"].startswith("landuse_mask"):
            continue
        if fl["crop"] in ("corn", "sugarbeet", "sunflower"):
            cv2.fillPoly(green, [poly_px(fl["points"])], 1)
        elif fl["crop"] in ("wheat", "stubble"):
            cv2.fillPoly(dry, [poly_px(fl["points"])], 1)
    sample(cv2.erode(green, ell(121)), CROP, 15000)                   # >= 12 m inside (parcel outlines are crude)
    sample(cv2.erode(dry, ell(121)), OTHER, 15000)
    # building shadows: dark, untextured ground 1.5..3 m behind a wall, seen from the sun (shadow azimuth ~285 deg
    # by eye; the exact value is measured later from the class map). Shaded shrubs are textured and stay out.
    bld = np.zeros((N, N), np.uint8)
    for b in scene["buildings"]:
        cv2.fillPoly(bld, [poly_px(b["footprint"])], 1)
    ux, uz = math.sin(math.radians(285.0)), -math.cos(math.radians(285.0))
    behind = np.zeros((N, N), np.uint8)
    for d in (1.5, 2.2, 3.0):
        sx, sy = int(round(ux * d / GSD)), int(round(uz * d / GSD))
        behind |= np.roll(np.roll(bld, sy, axis=0), sx, axis=1)
    behind &= cv2.dilate(bld, ell(7)) == 0
    mu = cv2.blur(lum8.astype(np.float32), (5, 5))
    sd = np.sqrt(np.maximum(cv2.blur(lum8.astype(np.float32) ** 2, (5, 5)) - mu * mu, 0.0))
    sample((behind > 0) & (lum8 < 72) & (sd < 4.0), SHADOW, 15000)
    return pts


def build_training_set(rgb: np.ndarray, scene, fields):
    """-> X, y, sample weight, group id (one per hand-labelled disc / per 102 m block of automatic labels)."""
    rng = np.random.default_rng(7)
    X, y, w, grp = [], [], [], []
    for gi, (x, z, r, cls) in enumerate(LABELS):                             # features per disc on a small crop
        ys, xs = disc_pixels(x, z, r)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        F = crop_features(rgb, y0, y1, x0, x1)
        X.append(F[ys - y0, xs - x0])
        y.append(np.full(len(ys), cls))
        w.append(np.full(len(ys), 300.0 / len(ys)))                         # every disc counts the same
        grp.append(np.full(len(ys), gi))
    blocks: dict[tuple[int, int], list[tuple[int, int, int]]] = {}
    lum8 = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    for (py, px, cls) in auto_label_points(scene, fields, lum8, rng):
        blocks.setdefault((py // 512, px // 512), []).append((py, px, cls))
    for bi, ((by, bx), items) in enumerate(blocks.items()):                  # each block's features are computed once
        F = crop_features(rgb, by * 512, by * 512 + 512, bx * 512, bx * 512 + 512)
        arr = np.array(items)
        X.append(F[arr[:, 0] - by * 512, arr[:, 1] - bx * 512])
        y.append(arr[:, 2])
        w.append(np.full(len(arr), 0.5))
        grp.append(np.full(len(arr), 100000 + bi))
    X, y, w, grp = np.concatenate(X), np.concatenate(y), np.concatenate(w), np.concatenate(grp)
    for cls in range(5):                                                     # balance classes
        sel = y == cls
        if not sel.any():
            raise RuntimeError(f"no training samples for class {CLASS_NAMES[cls]}")
        w[sel] *= len(y) / 5.0 / w[sel].sum()
    return X, y, w, grp


def make_classifier():
    from sklearn.ensemble import HistGradientBoostingClassifier

    # deliberately small trees and large leaves: the hand labels are few discs, the model must not memorise them
    return HistGradientBoostingClassifier(max_iter=150, learning_rate=0.08, max_leaf_nodes=12, min_samples_leaf=150,
                                          l2_regularization=2.0, random_state=3)


def train_classifier(rgb: np.ndarray, scene, fields):
    from sklearn.model_selection import GroupKFold

    X, y, w, grp = build_training_set(rgb, scene, fields)
    manual = grp < 100000
    # honest accuracy: leave whole discs out (pixels of one disc are nearly identical, so pixel-wise CV would lie)
    conf = np.zeros((5, 5), np.int64)
    for tr, te in GroupKFold(n_splits=4).split(X, y, grp):
        clf = make_classifier().fit(X[tr], y[tr], sample_weight=w[tr])
        te = te[manual[te]]
        np.add.at(conf, (y[te], clf.predict(X[te])), 1)
    rec = conf.diagonal() / np.maximum(conf.sum(1), 1)
    prec = conf.diagonal() / np.maximum(conf.sum(0), 1)
    log(f"classifier: {len(y)} samples ({int(manual.sum())} px from {len(LABELS)} hand-labelled discs); disc-wise 4-fold CV on the hand labels: "
        + ", ".join(f"{CLASS_NAMES[c]} recall {rec[c]:.2f} precision {prec[c]:.2f}" for c in range(4)))
    return make_classifier().fit(X, y, sample_weight=w)


def classify(rgb: np.ndarray, clf, skip: np.ndarray) -> np.ndarray:
    """-> class probabilities as uint8 (N, N, 5), strip by strip. Pixels in `skip` (deep inside vineyards and crop
    parcels, three quarters of the map, where nothing may be placed anyway) are not evaluated and count as OTHER."""
    prob = np.zeros((N, N, 5), np.uint8)
    prob[:, :, OTHER] = 255
    step = 640
    for y0 in range(0, N, step):
        F = crop_features(rgb, y0, y0 + step, 0, N)
        need = skip[y0:y0 + step] == 0
        if need.any():
            P = clf.predict_proba(F[need])
            prob[y0:y0 + step][need] = np.round(P * 255).astype(np.uint8)
        if y0 % 2560 == 0:
            log(f"classified rows {y0}..")
    return prob


# ----------------------------------------------------------------------------------------------------------
# masks from OSM / parcels
# ----------------------------------------------------------------------------------------------------------
def rect_poly(cx: float, cz: float, rot: float, size_u: float, size_v: float, grow: float) -> list[list[float]]:
    """Rotated rectangle as in src/recreation.ts localToWorld(): u along (cos r, -sin r), v along (sin r, cos r)."""
    hu, hv = size_u / 2 + grow, size_v / 2 + grow
    dx, dz, px, pz = math.cos(rot), -math.sin(rot), math.sin(rot), math.cos(rot)
    return [[cx + u * dx + v * px, cz + u * dz + v * pz] for (u, v) in ((-hu, -hv), (hu, -hv), (hu, hv), (-hu, hv))]


# Pitch surfaces (src/recreation.ts: Sportplatz_Hartplatz 89 x 56 m, Kleinfeld 18.5 x 48 m, both rot 0.376) with
# 2.5 m run-off, and the playground's sand pit / equipment core (rubber + sand surfaces around 65..80 / -256..-232).
PITCH_RECTS = [rect_poly(56.5, -314.5, 0.376, 89.0, 56.0, 2.5), rect_poly(110.5, -326.5, 0.376, 18.5, 48.0, 2.5)]
PLAYGROUND_CORE = [[60, -262], [86, -262], [86, -228], [60, -228]]


def build_masks(scene, fields) -> dict[str, np.ndarray]:
    m: dict[str, np.ndarray] = {}
    bld = np.zeros((N, N), np.uint8)
    for b in scene["buildings"]:
        cv2.fillPoly(bld, [poly_px(b["footprint"])], 1)
    m["bld"] = bld
    m["bld1"] = cv2.dilate(bld, ell(11))                                  # + 1 m
    road = np.zeros((N, N), np.uint8)
    vroad = np.zeros((N, N), np.uint8)                                    # village streets (for the "street" zone)
    for r in scene["roads"]:
        pts = poly_px(r["points"])
        cv2.polylines(road, [pts], False, 1, max(1, int(round(r["widthM"] / GSD))))
        if r["highway"] in ("residential", "secondary", "tertiary", "unclassified", "service"):
            cv2.polylines(vroad, [pts], False, 1, max(1, int(round((r["widthM"] + 7.0) / GSD))))
    m["road"] = road
    m["street_band"] = vroad
    vine = np.zeros((N, N), np.uint8)
    cem = np.zeros((N, N), np.uint8)
    for l in scene["landuse"]:
        if l["type"] == "vineyard":
            cv2.fillPoly(vine, [poly_px(l["points"])], 1)
        elif l["type"] == "cemetery":
            cv2.fillPoly(cem, [poly_px(l["points"])], 1)
    m["vine"] = vine
    m["cemetery"] = cem
    crop = np.zeros((N, N), np.uint8)
    meadow = np.zeros((N, N), np.uint8)
    for fl in fields["fields"]:
        cv2.fillPoly(meadow if fl["crop"] == "meadow" else crop, [poly_px(fl["points"])], 1)
    m["crop"] = crop
    m["meadow"] = meadow
    rec = np.zeros((N, N), np.uint8)
    for poly in PITCH_RECTS + [PLAYGROUND_CORE]:
        cv2.fillPoly(rec, [poly_px(poly)], 1)
    m["rec"] = rec
    sports = np.zeros((N, N), np.uint8)
    for poly in RECREATION_POLYS:
        cv2.fillPoly(sports, [poly_px(poly)], 1)
    m["sports"] = cv2.dilate(sports, ell(101))                            # + 10 m: trees around the grounds
    water = np.zeros((N, N), np.uint8)
    for w in scene["waterways"]:
        cv2.polylines(water, [poly_px(w["points"])], False, 1, 3)
    m["water"] = water
    return m


def dist_m(mask: np.ndarray) -> np.ndarray:
    """distance in metres to the nearest set pixel, computed at 0.8 m and upsampled (zone logic only)."""
    small = cv2.resize(mask, (N // 4, N // 4), interpolation=cv2.INTER_AREA) > 0
    d = cv2.distanceTransform((~small).astype(np.uint8), cv2.DIST_L2, 3) * (GSD * 4)
    return d


def at(dmap: np.ndarray, py: np.ndarray, px: np.ndarray) -> np.ndarray:
    return dmap[np.clip(py // 4, 0, dmap.shape[0] - 1), np.clip(px // 4, 0, dmap.shape[1] - 1)]


# ----------------------------------------------------------------------------------------------------------
# stage 2: sun
# ----------------------------------------------------------------------------------------------------------
def sun_elevation_astro(shadow_az_deg: float, decl_deg: float, lat_deg: float = 49.61) -> float:
    """Sun elevation for the hour angle at which the sun's azimuth is shadow_az + 180 deg."""
    sun_az = math.radians((shadow_az_deg + 180.0) % 360.0)
    lat, dec = math.radians(lat_deg), math.radians(decl_deg)
    best = (1e9, 0.0)
    for i in range(-1800, 1801):
        h = math.radians(i * 0.1)
        el = math.asin(math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(h))
        az = math.atan2(-math.cos(dec) * math.sin(h), math.sin(dec) * math.cos(lat) - math.cos(dec) * math.cos(h) * math.sin(lat))
        err = abs(math.atan2(math.sin(az - sun_az), math.cos(az - sun_az)))
        if el > 0 and err < best[0]:
            best = (err, math.degrees(el))
    return best[1]


# The flight date is not in the data. Harvest state (about two thirds of the cereal parcels already stubble, the
# rest standing, maize and beet closed, parched lawns) puts it in mid/late July -> solar declination ~ 20.5 deg.
# +-3 deg of declination changes the elevation by ~+-3 deg, i.e. shadow-derived heights by ~+-10 %.
ASSUMED_DECLINATION_DEG = 20.5


def estimate_sun(woody: np.ndarray, cls: np.ndarray, masks, decl_deg: float) -> tuple[float, float]:
    """-> (shadow azimuth in deg clockwise from north = the direction shadows point, sun elevation in deg).

    Azimuth: cross-correlation of the woody mask with the ground-shadow class (shadows next to buildings
    left out: walls have preferred orientations and bias the lobe). Every shadow is its caster shifted along the
    shadow direction, so the correlation peaks at that displacement. Checked by hand against a floodlight mast
    at the sports ground (base 69.7/-281.0, shadow tip 54.0/-284.3 -> 282 deg) and a chimney shadow (282 deg).
    Elevation: not measurable without a known height (LoD2 eave heights vs. shadow widths scatter between 45 and
    70 deg), so it comes from solar geometry for the measured azimuth and the assumed declination."""
    half = N // 2
    w = cv2.resize(woody, (half, half), interpolation=cv2.INTER_AREA).astype(np.float32)
    sh = cv2.resize((cls == SHADOW).astype(np.uint8), (half, half), interpolation=cv2.INTER_AREA).astype(np.float32)
    far = cv2.resize((cv2.dilate(masks["bld"], ell(41)) == 0).astype(np.uint8), (half, half), interpolation=cv2.INTER_NEAREST)
    sh *= far
    if sh.sum() < 20000 or w.sum() < 20000:
        raise RuntimeError(f"too little woody ({w.sum():.0f} px) or free shadow ({sh.sum():.0f} px) area to measure the sun direction")
    fa = np.fft.rfft2(w - w.mean())
    fb = np.fft.rfft2(sh - sh.mean())
    c = np.fft.fftshift(np.fft.irfft2(np.conj(fa) * fb, s=w.shape))
    r = 50                                                                   # +-20 m
    c = c[half // 2 - r:half // 2 + r + 1, half // 2 - r:half // 2 + r + 1]
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    lobe = np.clip(c - 0.7 * c.max(), 0, None)
    mx, mz = float((lobe * xx).sum() / lobe.sum()), float((lobe * yy).sum() / lobe.sum())
    disp = math.hypot(mx, mz) * GSD * 2
    if disp < 2.0:
        raise RuntimeError(f"woody/shadow correlation peaks at {disp:.1f} m displacement - no usable shadow direction")
    az = math.degrees(math.atan2(mx, -mz)) % 360.0
    el = sun_elevation_astro(az, decl_deg)
    log(f"sun: shadows point to azimuth {az:.1f} deg (correlation lobe at {disp:.1f} m); elevation {el:.1f} deg for "
        f"declination {decl_deg:.1f} deg (would be {sun_elevation_astro(az, decl_deg + 3):.1f} / {sun_elevation_astro(az, decl_deg - 3):.1f} at +-3 deg)")
    if not 20.0 < el < 65.0:
        raise RuntimeError(f"implausible sun elevation {el:.1f} deg")
    return az, el


# ----------------------------------------------------------------------------------------------------------
# stage 3: woody mask -> crowns / hedges / shrubs
# ----------------------------------------------------------------------------------------------------------
def detect_row_crops(woody: np.ndarray) -> np.ndarray:
    """Unmapped vineyards / berry rows: many parallel thin woody stripes. Thin = removed by a 2.6 m opening;
    a stripe field has a high density of thin woody pixels over a 12 m window AND one dominant orientation."""
    small = cv2.resize(woody, (N // 2, N // 2), interpolation=cv2.INTER_NEAREST)            # 0.4 m
    thin = (small > 0) & (cv2.morphologyEx(small, cv2.MORPH_OPEN, ell(7)) == 0)
    t = thin.astype(np.float32)
    dens = cv2.blur(t, (31, 31))
    g = cv2.GaussianBlur(t, (0, 0), 1.2)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx, jyy, jxy = (cv2.GaussianBlur(a, (0, 0), 10.0) for a in (gx * gx, gy * gy, gx * gy))
    coh = np.sqrt(((jxx - jyy) * 0.5) ** 2 + jxy ** 2) / ((jxx + jyy) * 0.5 + 1e-6)
    rows = ((dens > 0.16) & (coh > 0.55)).astype(np.uint8)
    rows = cv2.morphologyEx(rows, cv2.MORPH_OPEN, ell(21))                                     # >= 8 m across
    rows = cv2.dilate(rows, ell(21))
    return cv2.resize(rows, (N, N), interpolation=cv2.INTER_NEAREST)


def thin_mask(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning of a small boolean crop."""
    img = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            p2, p3, p4, p5 = img[:-2, 1:-1], img[:-2, 2:], img[1:-1, 2:], img[2:, 2:]
            p6, p7, p8, p9 = img[2:, 1:-1], img[2:, :-2], img[1:-1, :-2], img[:-2, :-2]
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            bsum = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            trans = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            cond = ((p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)) if step == 0 else ((p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0))
            rem = (img[1:-1, 1:-1] == 1) & (bsum >= 2) & (bsum <= 6) & (trans == 1) & cond
            if rem.any():
                img[1:-1, 1:-1][rem] = 0
                changed = True
        if not changed:
            break
    return img[1:-1, 1:-1].astype(bool)


def skeleton_paths(skel: np.ndarray, min_len_px: float) -> list[np.ndarray]:
    """Longest geodesic path of every skeleton component, then (after removing it) of the remaining branches."""
    paths: list[np.ndarray] = []
    work = skel.copy()
    nbrs = [(-1, -1, 1.414), (-1, 0, 1.0), (-1, 1, 1.414), (0, -1, 1.0), (0, 1, 1.0), (1, -1, 1.414), (1, 0, 1.0), (1, 1, 1.414)]

    def far(start, comp_set):
        dist = {start: 0.0}
        prev = {start: None}
        stack = [start]
        while stack:                                                        # skeletons are thin: plain relaxation is fine
            nxt = []
            for (y, x) in stack:
                d0 = dist[(y, x)]
                for dy, dx, wgt in nbrs:
                    q = (y + dy, x + dx)
                    if q in comp_set and (q not in dist or dist[q] > d0 + wgt + 1e-9):
                        dist[q] = d0 + wgt
                        prev[q] = (y, x)
                        nxt.append(q)
            stack = nxt
        end = max(dist, key=dist.get)
        return end, dist[end], prev

    for _ in range(4):
        n, lab = cv2.connectedComponents(work.astype(np.uint8), connectivity=8)
        found = False
        for i in range(1, n):
            ys, xs = np.nonzero(lab == i)
            if len(ys) < min_len_px * 0.7:
                work[ys, xs] = False
                continue
            comp = set(zip(ys.tolist(), xs.tolist()))
            a, _, _ = far(next(iter(comp)), comp)
            b, length, prev = far(a, comp)
            if length < min_len_px:
                work[ys, xs] = False
                continue
            path = []
            q = b
            while q is not None:
                path.append(q)
                q = prev[q]
            arr = np.array(path)
            paths.append(arr)
            found = True
            # remove the path and its 5 px surroundings so that only real side branches remain
            rm = np.zeros(work.shape, np.uint8)
            rm[arr[:, 0], arr[:, 1]] = 1
            work &= cv2.dilate(rm, ell(11)) == 0
        if not found:
            break
    return paths


def nms_variable(cand_y, cand_x, score, radius_px) -> np.ndarray:
    """Greedy non-maximum suppression with a per-candidate exclusion radius. Returns indices of kept candidates."""
    order = np.argsort(-score)
    cell = 16
    grid: dict[tuple[int, int], list[int]] = {}
    kept = []
    for i in order:
        y, x, r = float(cand_y[i]), float(cand_x[i]), float(radius_px[i])
        gy, gx = int(y // cell), int(x // cell)
        reach = int(math.ceil(max(r, 60.0) / cell))
        ok = True
        for yy in range(gy - reach, gy + reach + 1):
            for xx in range(gx - reach, gx + reach + 1):
                for j in grid.get((yy, xx), ()):
                    rr = max(r, radius_px[j]) * 0.85 + min(r, radius_px[j]) * 0.15
                    if (cand_y[j] - y) ** 2 + (cand_x[j] - x) ** 2 < rr * rr:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                break
        if ok:
            kept.append(i)
            grid.setdefault((gy, gx), []).append(i)
    return np.array(kept, dtype=np.int64)


def segment_crowns(woody: np.ndarray, lum8: np.ndarray):
    """woody uint8 mask -> (thick mask, label image of crowns, per-crown table)."""
    thick = cv2.morphologyEx(woody, cv2.MORPH_OPEN, ell(13))                 # >= 2.6 m across
    dist = cv2.distanceTransform(woody, cv2.DIST_L2, 5) * GSD                # metres to the canopy edge
    # local canopy thickness -> expected crown scale (m)
    dsmall = cv2.resize(dist, (N // 2, N // 2), interpolation=cv2.INTER_AREA)
    rloc = cv2.dilate(dsmall, ell(21))                                       # max within 4 m
    rloc = cv2.resize(np.clip(rloc, 1.3, 7.0), (N, N), interpolation=cv2.INTER_LINEAR)
    lum = lum8.astype(np.float32)
    b1, b2, b3 = (cv2.GaussianBlur(lum, (0, 0), s) for s in (2.5, 5.0, 9.0))
    bg = cv2.GaussianBlur(lum, (0, 0), 20.0)
    t = np.clip((rloc - 1.5) / 2.0, 0, 1)
    u = np.clip((rloc - 3.5) / 2.5, 0, 1)
    bright = (b1 * (1 - t) + b2 * t) * (1 - u) + b3 * u
    score = np.minimum(dist / rloc, 1.0) + 0.5 * np.clip((bright - bg) / 25.0, -1.0, 1.0)
    del b1, b2, b3, bg, bright
    score[thick == 0] = -10.0
    mx = cv2.dilate(score, ell(7))
    cy, cx = np.nonzero((score >= mx) & (thick > 0))
    keep = nms_variable(cy, cx, score[cy, cx], 1.3 * rloc[cy, cx] / GSD)
    cy, cx = cy[keep], cx[keep]
    log(f"crown markers: {len(cy)}")
    # Voronoi partition of the thick canopy by nearest marker
    seeds = np.ones((N, N), np.uint8)
    seeds[cy, cx] = 0
    _, lab = cv2.distanceTransformWithLabels(seeds, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    marker_lab = lab[cy, cx]
    remap = np.zeros(int(lab.max()) + 1, np.int32)
    remap[marker_lab] = np.arange(1, len(cy) + 1)
    crowns = remap[lab]
    crowns[thick == 0] = 0
    return thick, dist, crowns, cy, cx


# ----------------------------------------------------------------------------------------------------------
# stage 4: cast shadows -> heights
# ----------------------------------------------------------------------------------------------------------
MEASURED, BLOCKED, NOSHADOW, INSIDE = 0, 1, 2, 3


class ShadowProbe:
    """March from a caster along the shadow direction and report how far its cast shadow reaches.

    dark   : smoothed shadow evidence (classifier shadow probability or simply very dark pixels) - this covers the
             caster's own shaded flank AND the shadow on the ground, which is all that matters for the tip position
    canopy : sunlit woody pixels (another crown that would hide the shadow tip)
    """

    def __init__(self, dark: np.ndarray, canopy: np.ndarray, bld: np.ndarray, shadow_az_deg: float):
        self.dark, self.canopy, self.bld = dark, canopy, bld
        self.ux = math.sin(math.radians(shadow_az_deg))
        self.uz = -math.cos(math.radians(shadow_az_deg))

    def run(self, x_px: float, y_px: float, start_m: float, search_m: float, own_m: float, max_m: float = 48.0) -> tuple[int, float, float]:
        """-> (state, t_end, t_start) in metres from (x, y). A dark run has to begin between start_m and search_m;
        dark runs that end on sunlit canopy closer than own_m are gaps inside the caster's own crown and are skipped."""
        n = int(max_m / GSD)
        t = np.arange(n)
        qx = np.round(x_px + self.ux * t).astype(np.int64)
        qy = np.round(y_px + self.uz * t).astype(np.int64)
        ok = (qx >= 0) & (qx < N) & (qy >= 0) & (qy < N)
        qx, qy = np.clip(qx, 0, N - 1), np.clip(qy, 0, N - 1)
        drk = (self.dark[qy, qx] > 0) & ok
        can = (self.canopy[qy, qx] > 0) & ok
        bld = (self.bld[qy, qx] > 0) | ~ok
        i = int(start_m / GSD)
        lim = min(n - 6, int(search_m / GSD))
        while True:
            i_from = i
            while i <= lim and not (drk[i] and drk[i + 1] and drk[i + 2]):
                if bld[i]:
                    return BLOCKED, i * GSD, i * GSD
                i += 1
            if i > lim:
                tail = can[max(i_from, lim - int(1.5 / GSD)):lim + 1]
                return (INSIDE if len(tail) and tail.mean() > 0.7 else NOSHADOW), 0.0, 0.0
            j = i
            while j < n - 6 and not (not drk[j] and not drk[j + 1] and not drk[j + 2]):
                if bld[j]:
                    return BLOCKED, j * GSD, i * GSD
                j += 1
            if j >= n - 6:
                return BLOCKED, j * GSD, i * GSD
            if can[j:j + 5].sum() >= 3:
                if j * GSD < own_m:                                         # sun fleck / gap inside the own crown
                    i = j + 3
                    continue
                return BLOCKED, j * GSD, i * GSD
            return MEASURED, j * GSD, i * GSD


def probe_tree(probe: ShadowProbe, x_px: float, y_px: float, r_m: float) -> tuple[int, float]:
    """Three parallel rays through the crown; -> (state, shadow tip distance from the trunk in m)."""
    px, pz = -probe.uz, probe.ux                                            # perpendicular to the shadow direction
    res = []
    for off in (0.0, 0.3, -0.3):
        ox, oy = x_px + px * off * r_m / GSD, y_px + pz * off * r_m / GSD
        res.append(probe.run(ox, oy, 0.3 * r_m, 1.3 * r_m + 1.5, 0.95 * r_m))
    meas = [t for (st, t, _) in res if st == MEASURED]
    if meas:
        return MEASURED, max(meas)
    blk = [t for (st, t, _) in res if st == BLOCKED]
    if blk:
        return BLOCKED, max(blk)
    if any(st == NOSHADOW for (st, _, _) in res):
        return NOSHADOW, 0.0
    return INSIDE, 0.0


# ----------------------------------------------------------------------------------------------------------
# hedges and shrubs from the thin part of the woody mask
# ----------------------------------------------------------------------------------------------------------
def extract_thin(woody: np.ndarray, thick: np.ndarray):
    """-> (hedges [dict(points px (n,2) x/y, width m, length m)], shrubs [dict(x px, y px, r m)])."""
    thin = ((woody > 0) & (thick == 0)).astype(np.uint8)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(thin, connectivity=8)
    thick_d = cv2.dilate(thick, ell(3))
    hedges, shrubs = [], []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        area = a * GSD * GSD
        if area < 0.5:
            continue
        own = lab[y:y + h, x:x + w] == i
        touches_thick = bool((thick_d[y:y + h, x:x + w][own] > 0).any())
        long_side = max(w, h) * GSD
        made_hedge = False
        if long_side >= 3.0:
            pad = np.pad(own, 1)
            dt = cv2.distanceTransform(pad.astype(np.uint8), cv2.DIST_L2, 3)
            skel = thin_mask(pad)
            for path in skeleton_paths(skel, 3.5 / GSD):
                seg = np.hypot(np.diff(path[:, 0]), np.diff(path[:, 1])).sum() * GSD
                width = float(np.median(dt[path[:, 0], path[:, 1]])) * 2.0 * GSD
                width = max(width, 0.5)
                if seg < 3.5 or seg / width < 2.5:
                    continue
                pts = np.stack([path[:, 1] - 1 + x, path[:, 0] - 1 + y], axis=1).astype(np.float32)
                simp = cv2.approxPolyDP(pts.reshape(-1, 1, 2), 1.75, False).reshape(-1, 2)
                if len(simp) < 2:
                    continue
                hedges.append({"pts": simp.astype(np.float64), "width": width, "length": float(seg)})
                made_hedge = True
        if not made_hedge and not touches_thick and 0.6 <= area <= 7.0 and max(w, h) / max(1, min(w, h)) < 2.5:
            shrubs.append({"x": float(cent[i][0]), "y": float(cent[i][1]), "r": math.sqrt(area / math.pi)})
    return hedges, shrubs


def resample_polyline(pts: np.ndarray, step_px: float) -> tuple[np.ndarray, np.ndarray]:
    """-> (points every step_px, unit tangents)."""
    seg = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1]
    n = max(2, int(total / step_px) + 1)
    t = np.linspace(0, total, n)
    xs, ys = np.interp(t, cum, pts[:, 0]), np.interp(t, cum, pts[:, 1])
    out = np.stack([xs, ys], axis=1)
    tan = np.gradient(out, axis=0)
    tan /= np.maximum(np.hypot(tan[:, 0], tan[:, 1])[:, None], 1e-6)
    return out, tan


# ----------------------------------------------------------------------------------------------------------
# rough ground patches
# ----------------------------------------------------------------------------------------------------------
def mask_to_polygons(mask: np.ndarray, forbid: np.ndarray, min_area: float, px_m: float) -> list[list[list[float]]]:
    """Outer contours of a boolean raster (px_m metres per pixel, whole map) as simplified world polygons.
    A patch whose outline would enclose much more than its own area (big holes) or forbidden ground is split on
    a 12 m grid; pieces that still fail are dropped (the consumer may fill the polygon blindly)."""
    polys: list[list[list[float]]] = []
    cell = int(round(12.0 / px_m))

    def emit(region: np.ndarray, ox: int, oy: int, allow_split: bool) -> None:
        n, lab, stats, _ = cv2.connectedComponentsWithStats(region, connectivity=4)
        for i in range(1, n):
            x, y, w, h, a = stats[i]
            if a * px_m * px_m < (min_area if allow_split else min_area * 0.5):
                continue
            own = (lab[y:y + h, x:x + w] == i).astype(np.uint8)
            cs, _ = cv2.findContours(own, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            simp = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 0.7 / px_m, True).reshape(-1, 2)
            if len(simp) < 3:
                continue
            fill = np.zeros_like(own)
            cv2.fillPoly(fill, [simp.astype(np.int32)], 1)
            filled = int(fill.sum())
            bad = int((fill & forbid[oy + y:oy + y + h, ox + x:ox + x + w]).sum())
            if filled > 1.3 * a + 4 or bad > 0.03 * filled:
                if allow_split:
                    for gy in range(0, h, cell):
                        for gx in range(0, w, cell):
                            piece = np.ascontiguousarray(own[gy:gy + cell, gx:gx + cell])
                            if piece.any():
                                emit(piece, ox + x + gx, oy + y + gy, False)
                continue
            polys.append([[round((float(px) + 0.5 + ox + x) * px_m - HALF, 1), round((float(pz) + 0.5 + oy + y) * px_m - HALF, 1)]
                          for (px, pz) in simp])

    emit(np.ascontiguousarray(mask.astype(np.uint8)), 0, 0, True)
    return polys


def rough_patches(cls: np.ndarray, rgb: np.ndarray, woody: np.ndarray, masks, d_bld: np.ndarray, noshadow_woody: np.ndarray):
    """1 m rasters of the class map -> lawn / tall_grass / garden_bed / ruderal / reed polygons."""
    n1 = N // 5

    def frac(m: np.ndarray) -> np.ndarray:
        return cv2.resize(m.astype(np.float32), (n1, n1), interpolation=cv2.INTER_AREA)

    f_grass, f_crop, f_other, f_woody = frac(cls == GRASS), frac(cls == CROP), frac(cls == OTHER), frac(woody > 0)
    hard = frac((masks["bld1"] | masks["road"] | masks["vine"] | masks["crop"] | masks["rec"]) > 0) > 0.02
    meadow = frac(masks["meadow"]) > 0.02
    village = cv2.resize(d_bld, (n1, n1), interpolation=cv2.INTER_LINEAR) < 28.0
    near_b = cv2.resize(d_bld, (n1, n1), interpolation=cv2.INTER_LINEAR) < 12.0
    small = cv2.resize(rgb, (n1, n1), interpolation=cv2.INTER_AREA).astype(np.float32)
    ssum = np.maximum(small.sum(2), 1.0)
    rb = (small[:, :, 0] - small[:, :, 2]) / ssum
    exg = (2 * small[:, :, 1] - small[:, :, 0] - small[:, :, 2]) / ssum
    lum = ssum / 3.0
    wat = cv2.resize(masks["water"], (n1, n1), interpolation=cv2.INTER_AREA) > 0
    d_wat = cv2.distanceTransform((~wat).astype(np.uint8), cv2.DIST_L2, 3)
    d_road = cv2.distanceTransform((frac(masks["road"]) < 0.02).astype(np.uint8), cv2.DIST_L2, 3)
    forbid = (hard | (frac(masks["bld"]) > 0.02)).astype(np.uint8)
    free = ~hard & (f_woody < 0.3)
    k3 = ell(3)

    def clean(m: np.ndarray, close: int = 3) -> np.ndarray:
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, ell(close))
        return cv2.morphologyEx(m, cv2.MORPH_OPEN, k3)

    out: dict[str, list] = {}
    reed = free & ~village & (d_wat <= 4.0) & ((f_grass + f_crop) > 0.4)
    out["reed"] = mask_to_polygons(clean(reed, 5), forbid, 15.0, 1.0)
    lawn = free & village & (f_grass > 0.6)
    out["lawn"] = mask_to_polygons(clean(lawn), forbid, 20.0, 1.0)
    bed = free & village & (f_crop > 0.5) & (f_grass < 0.4)
    out["garden_bed"] = mask_to_polygons(clean(bed), forbid, 6.0, 1.0)
    tall = free & ~village & ~meadow & ((f_grass + f_crop) > 0.6) & ~reed
    out["tall_grass"] = mask_to_polygons(clean(tall), forbid, 60.0, 1.0)
    # ruderal: dry, weedy verges and field margins - beige/yellowish, not green, not asphalt-grey, never wider than ~12 m,
    # close to a track or the creek; plus thickets that are "woody" by texture but cast no shadow (brambles, tall weeds)
    dry = free & ~near_b & ~meadow & (f_other > 0.6) & (rb > 0.035) & (rb < 0.12) & (exg > -0.01) & (exg < 0.07) & (lum > 105) & (lum < 205)
    dry = clean(dry)
    wide = cv2.morphologyEx(dry, cv2.MORPH_OPEN, ell(13))
    dry = (dry > 0) & (cv2.dilate(wide, ell(5)) == 0) & ((d_road < 9.0) | (d_wat < 14.0))
    thicket = (frac(noshadow_woody) > 0.5) & ~hard & ~near_b
    out["ruderal"] = mask_to_polygons(clean(dry | thicket), forbid, 30.0, 1.0)
    return out


# ----------------------------------------------------------------------------------------------------------
# pipeline
# ----------------------------------------------------------------------------------------------------------
PATCH_LIMITS = {"lawn": 900, "tall_grass": 500, "garden_bed": 400, "ruderal": 500, "reed": 120}


def cell_free(hard: np.ndarray, x: float, z: float) -> bool:
    """THE placement test (cutting and the final audit both use it): world point -> its pixel, not excluded."""
    ix, iy = int(w2p(x)), int(w2p(z))
    return 0 <= ix < N and 0 <= iy < N and not hard[iy, ix]


def segment_free(hard: np.ndarray, a, b) -> bool:
    """Every 0.1 m along the segment a-b (world metres, both ends included) passes cell_free."""
    n = max(1, int(math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / (GSD / 2))))
    return all(cell_free(hard, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1))


def cut_polyline(hard: np.ndarray, wpts: list[list[float]], eps_m: float, min_len_m: float) -> list[list[list[float]]]:
    """Dense world polyline -> simplified pieces whose vertices AND segments all lie outside `hard`.
    Simplification never cuts a corner across an exclusion: a simplified segment that would is replaced by the
    dense points it stood for, and a dense segment that crosses an exclusion splits the line there."""
    pieces: list[list[list[float]]] = []
    run: list[list[float]] = []
    for p in wpts + [None]:
        if p is not None and cell_free(hard, p[0], p[1]) and (not run or segment_free(hard, run[-1], p)):
            run.append(p)
            continue
        if len(run) >= 2:
            arr = np.array(run, np.float64)
            simp = cv2.approxPolyDP(arr.astype(np.float32).reshape(-1, 1, 2), eps_m, False).reshape(-1, 2)
            idx, j = [], 0                                                  # approxPolyDP keeps a subsequence
            for q in simp:
                while j < len(arr) and not np.allclose(arr[j], q, atol=1e-3):
                    j += 1
                if j == len(arr):
                    raise RuntimeError("cut_polyline: simplified vertex not found in the dense run")
                idx.append(j)
            out = [run[idx[0]]]
            for i0, i1 in zip(idx[:-1], idx[1:]):
                if segment_free(hard, run[i0], run[i1]):
                    out.append(run[i1])
                else:
                    out.extend(run[i0 + 1:i1 + 1])                         # keep the detour around the exclusion
            if float(np.hypot(*np.diff(np.array(out), axis=0).T).sum()) >= min_len_m:
                pieces.append(out)
        run = [p] if p is not None and cell_free(hard, p[0], p[1]) else []
    return pieces


def poly_area(poly) -> float:
    a = np.asarray(poly)
    return 0.5 * abs(float(np.dot(a[:, 0], np.roll(a[:, 1], 1)) - np.dot(a[:, 1], np.roll(a[:, 0], 1))))


def run(args) -> dict:
    t0 = time.time()
    os.makedirs(os.path.join(WORK, "cache"), exist_ok=True)
    scene = load_json("data/osm/kindenheim_scene.json")
    fields = load_json("data/osm/fields_layout.json")
    log("loading mosaic ...")
    rgb = load_mosaic()
    cls_path = os.path.join(WORK, "cache", "classmap.npz")
    meta_path = os.path.join(WORK, "cache", "classmap.meta.json")
    parcels = np.zeros((N, N), np.uint8)
    for l in scene["landuse"]:
        if l["type"] == "vineyard":
            cv2.fillPoly(parcels, [poly_px(l["points"])], 1)
    for fl in fields["fields"]:
        if fl["crop"] != "meadow":
            cv2.fillPoly(parcels, [poly_px(fl["points"])], 1)
    skip = cv2.erode(parcels, ell(101))                                     # keep a 10 m rim (shadows of margin trees)
    del parcels
    import hashlib
    skip_digest = hashlib.sha256(np.packbits(skip).tobytes()).hexdigest()
    if args.reuse:
        if not os.path.exists(cls_path) or not os.path.exists(meta_path):
            raise RuntimeError(f"--reuse given but {cls_path} or {meta_path} does not exist - run without --reuse")
        with open(meta_path, "r", encoding="utf-8") as f:
            cached = json.load(f)["skipDigest"]
        if cached != skip_digest:
            raise RuntimeError("--reuse: the cached class map was computed for other vineyard / crop parcels (pixels deep "
                               "inside parcels are not classified) - the parcels changed, run without --reuse")
        prob = np.load(cls_path)["prob"]
    else:
        clf = train_classifier(rgb, scene, fields)
        prob = classify(rgb, clf, skip)
        np.savez(cls_path, prob=prob)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"skipDigest": skip_digest}, f)
    del skip
    cls = np.argmax(prob, axis=2).astype(np.uint8)
    pw = np.ascontiguousarray(prob[:, :, WOODY])
    psh = np.ascontiguousarray(prob[:, :, SHADOW])
    del prob
    log(f"class shares: { {CLASS_NAMES[c]: round(float((cls == c).mean()), 3) for c in range(5)} }  ({time.time() - t0:.0f} s)")

    f32 = rgb.astype(np.float32)
    lum8 = np.round(cv2.GaussianBlur(f32.mean(2), (0, 0), 1.0)).astype(np.uint8)
    masks = build_masks(scene, fields)
    d_bld = dist_m(masks["bld"])
    d_wat = dist_m(masks["water"])

    canopy_all = (pw > 128).astype(np.uint8)                                # every woody pixel, also inside masks
    woody = canopy_all & (masks["bld"] == 0) & (masks["vine"] == 0) & (masks["crop"] == 0) & (masks["rec"] == 0)
    az, el = estimate_sun(woody, cls, masks, args.declination)
    tan_e = math.tan(math.radians(el))
    rows = detect_row_crops(woody)
    log(f"unmapped row crops: {rows.mean() * N * N * GSD * GSD / 1e4:.2f} ha")
    woody &= rows == 0
    woody = cv2.morphologyEx(woody, cv2.MORPH_OPEN, ell(3))
    woody = cv2.morphologyEx(woody, cv2.MORPH_CLOSE, ell(5))
    woody &= masks["bld"] == 0

    thick, dist, crowns, mk_y, mk_x = segment_crowns(woody, lum8)
    nlab = len(mk_y)
    flat = crowns.ravel()

    def per_crown(values: np.ndarray) -> np.ndarray:
        return np.bincount(flat, weights=values.ravel(), minlength=nlab + 1)[1:]

    cnt = np.bincount(flat, minlength=nlab + 1)[1:].astype(np.float64)
    cnt_safe = np.maximum(cnt, 1)
    ramp_px = np.arange(N, dtype=np.float32)
    cen_x = per_crown(np.broadcast_to(ramp_px[None, :], (N, N))) / cnt_safe
    cen_y = per_crown(np.broadcast_to(ramp_px[:, None], (N, N))) / cnt_safe
    dmax = ndi.maximum(dist, crowns, index=np.arange(1, nlab + 1))
    mean_pw = per_crown(pw) / cnt_safe / 255.0
    lit = (lum8 > 62).astype(np.float32)
    nlit = np.maximum(per_crown(lit), 1)
    mR, mG, mB = (per_crown(f32[:, :, c] * lit) / nlit for c in range(3))
    mu5 = cv2.blur(f32.mean(2), (5, 5))
    sd5 = np.sqrt(np.maximum(cv2.blur(f32.mean(2) ** 2, (5, 5)) - mu5 * mu5, 0))
    m_sd = per_crown(sd5) / cnt_safe
    blue_s = cv2.GaussianBlur(f32[:, :, 2], (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(f32[:, :, 0], (0, 0), 2.0), 1.0)
    del mu5, sd5, lit, f32

    # shadow evidence: very dark, or dark and bluish (skylight on bright ground), or the classifier's shadow class.
    # Hand-labelled shadow discs: luminance 47..82, B/R 1.0..1.4; sunlit ground and crowns stay above ~85.
    lum_s = cv2.GaussianBlur(lum8, (0, 0), 2.0)
    dark = (lum_s < 72) | ((lum_s < 100) & (blue_s > 1.18)) | ((cv2.GaussianBlur(psh, (0, 0), 2.0) > 128) & (lum_s < 110))
    dark = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_CLOSE, ell(3))
    del lum_s, blue_s
    lit_canopy = canopy_all & (dark == 0)
    probe = ShadowProbe(dark, lit_canopy, masks["bld"], az)
    hard = (masks["bld1"] | masks["road"] | masks["vine"] | masks["crop"] | masks["rec"]) > 0
    objs = ndi.find_objects(crowns, max_label=nlab)

    # ---- crown candidates --------------------------------------------------------------------------------
    cands = []
    for k in range(nlab):
        area = cnt[k] * GSD * GSD
        if area < 2.0 or objs[k] is None:
            continue
        r = min(math.sqrt(area / math.pi), 1.35 * float(dmax[k]) + 0.3)
        cx, cy = float(cen_x[k]), float(cen_y[k])
        ix, iy = int(round(cx)), int(round(cy))
        if crowns[iy, ix] != k + 1:                                         # centroid fell outside its own cell
            cx, cy = float(mk_x[k]), float(mk_y[k])
            ix, iy = int(cx), int(cy)
        if hard[iy, ix]:                                                    # move the trunk off roads / building buffer
            sl = objs[k]
            own = (crowns[sl] == k + 1) & ~hard[sl]
            if not own.any():
                continue
            dd = np.where(own, dist[sl], -1.0)
            j = np.unravel_index(int(np.argmax(dd)), dd.shape)
            cy, cx = float(sl[0].start + j[0]), float(sl[1].start + j[1])
        cx, cy = float(round(cx)), float(round(cy))
        state, tip = probe_tree(probe, cx, cy, r)
        s3 = mR[k] + mG[k] + mB[k]
        cands.append({"k": k, "x": cx, "y": cy, "r": r, "area": area, "state": state, "tip": tip, "pw": float(mean_pw[k]),
                      "lum": s3 / 3.0, "exg": (2 * mG[k] - mR[k] - mB[k]) / max(s3, 1.0), "rb": (mR[k] - mB[k]) / max(s3, 1.0),
                      "sd": float(m_sd[k])})
    if len(cands) < 500:
        raise RuntimeError(f"only {len(cands)} crown candidates - the woody mask is broken")
    log(f"crown candidates: {len(cands)}  shadow measured/blocked/none/inside: "
        f"{[sum(1 for c in cands if c['state'] == st) for st in (MEASURED, BLOCKED, NOSHADOW, INSIDE)]}")

    # ---- kind, zone, height ------------------------------------------------------------------------------
    k_sphere = 1.0 / math.cos(math.radians(el)) - 1.0                        # shadow tip of a round crown, see probe notes
    med = {key: float(np.median([c[key] for c in cands])) for key in ("lum", "exg", "rb")}
    mad = {key: float(np.median(np.abs(np.array([c[key] for c in cands]) - med[key])) * 1.4826 + 1e-6) for key in ("lum", "exg", "rb")}
    church = [b for b in scene["buildings"] if b.get("category") == "church"]
    osm_orch = np.array([[t["x"], t["z"]] for t in scene["trees"] if t["type"] == "orchard"])
    for c in cands:
        ix, iy = int(c["x"]), int(c["y"])
        wx, wz = float(p2w(c["x"])), float(p2w(c["y"]))
        c["wx"], c["wz"] = wx, wz
        c["h_shadow"] = c["tip"] * tan_e - k_sphere * c["r"] if c["state"] in (MEASURED, BLOCKED) else None
        zx = (c["exg"] - med["exg"]) / mad["exg"]
        zb = (c["rb"] - med["rb"]) / mad["rb"]
        c["conifer_score"] = -(zx + zb) / 2.0                                 # less green AND bluer than the typical crown
        c["hue"] = float(np.clip(((c["lum"] - med["lum"]) / mad["lum"] + zb) / 4.0, -1.0, 1.0))
        dbl, dwt = float(at(d_bld, np.array(iy), np.array(ix))), float(at(d_wat, np.array(iy), np.array(ix)))
        c["d_bld"] = dbl
        near_church = any(math.hypot(wx - b["center"][0], wz - b["center"][1]) < 32.0 for b in church)
        if masks["sports"][iy, ix]:
            zone = "sports"
        elif masks["cemetery"][iy, ix] or near_church:
            zone = "churchyard"
        elif dwt < 22.0:
            zone = "creek"
        elif masks["street_band"][iy, ix] and dbl < 40.0:
            zone = "street"
        elif len(osm_orch) and float(np.min(np.hypot(osm_orch[:, 0] - wx, osm_orch[:, 1] - wz))) < 8.0:
            zone = "orchard"
        elif dbl < 30.0:
            zone = "garden"
        else:
            zone = "field"
        c["zone"] = zone
    for c in cands:
        hs, r = c["h_shadow"], c["r"]
        meas = c["state"] == MEASURED
        if c["conifer_score"] > 1.6 and c["zone"] != "creek":
            kind = "conifer"
        elif meas and hs >= 15.0 and r <= 0.22 * hs and r <= 4.0:
            kind = "poplar"
        elif r <= 2.6 and c["zone"] in ("garden", "orchard", "field", "street") and (not meas or hs <= 6.5):
            kind = "fruit"
        else:
            kind = "broadleaf"
        c["kind"] = kind
    # Height prior from crown radius (used where no shadow tip is visible). The measured shadows cannot calibrate it:
    # a tip is only visible for free-standing, mostly small trees, and the fit below is printed for the record only.
    ALLO = {"broadleaf": (3.5, 1.9), "fruit": (2.2, 1.1), "conifer": (2.5, 2.8), "poplar": (8.0, 4.0)}
    RANGE = {"fruit": (3.0, 6.0), "broadleaf": (5.0, 22.0), "conifer": (3.0, 24.0), "poplar": (14.0, 28.0)}
    pts = np.array([[c["r"], c["h_shadow"]] for c in cands if c["state"] == MEASURED and c["h_shadow"] > 1.5])
    if len(pts) < 100:
        raise RuntimeError(f"only {len(pts)} crowns with a measurable shadow tip - shadow probing is broken")
    b_, a_ = np.polyfit(pts[:, 0], pts[:, 1], 1)
    log(f"shadow-tip heights of {len(pts)} free-standing crowns: median {np.median(pts[:, 1]):.1f} m, "
        f"least-squares H = {a_:.2f} + {b_:.2f} * r (prior for hidden tips: broadleaf H = 3.5 + 1.9 r)")

    # Crowns inside closed canopy (woods, dense tree belts) often show no own shadow: it falls onto the neighbouring
    # crowns, which are lit. Such a crown is a tree when the canopy ring around it is closed and the neighbours are
    # tall; then it takes its height from them instead of being dropped as a low thicket.
    cand_xy = np.array([[c["wx"], c["wz"]] for c in cands])
    tall_ref = np.array([c["state"] in (MEASURED, BLOCKED) and c["h_shadow"] is not None and c["h_shadow"] >= 4.0 for c in cands])
    tall_h = np.array([c["h_shadow"] if t else 0.0 for c, t in zip(cands, tall_ref)])
    for i, c in enumerate(cands):
        c["wood_h"] = None
        if c["state"] != NOSHADOW or c["r"] < 1.6:
            continue
        ix, iy, r_px = int(c["x"]), int(c["y"]), c["r"] / GSD
        ro = r_px + 4.0 / GSD
        y0, y1, x0, x1 = max(0, int(iy - ro)), min(N, int(iy + ro) + 1), max(0, int(ix - ro)), min(N, int(ix + ro) + 1)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d2 = (yy - iy) ** 2 + (xx - ix) ** 2
        ring = (d2 >= (r_px + 0.5 / GSD) ** 2) & (d2 <= ro * ro)
        if canopy_all[y0:y1, x0:x1][ring].mean() < 0.6:
            continue
        dn = np.hypot(cand_xy[:, 0] - c["wx"], cand_xy[:, 1] - c["wz"])
        near = tall_ref & (dn < 15.0)
        if near.sum() >= 2:
            c["wood_h"] = float(np.median(tall_h[near]))

    trees, shrubs_out = [], []
    thicket = np.zeros((N, N), np.uint8)
    n_drop_noshadow = n_wood_kept = 0
    for c in cands:
        a_, b_ = ALLO[c["kind"]]
        h_allo = a_ + b_ * c["r"]
        hs, st, r = c["h_shadow"], c["state"], c["r"]
        if st == NOSHADOW and c["wood_h"] is not None:
            n_wood_kept += 1
            if c["kind"] == "fruit":
                c["kind"] = "broadleaf"                                     # a crown inside a wood is not an orchard tree
            a_, b_ = ALLO[c["kind"]]
            h_allo = a_ + b_ * r
        elif st == NOSHADOW and c["zone"] not in ("creek",) :
            # no cast shadow at all: something low. Small -> shrub, large -> weedy thicket (rough patch), not a tree.
            if r < 1.6:
                shrubs_out.append({"x": c["wx"], "z": c["wz"], "radiusM": r, "heightM": float(np.clip(0.7 + 0.5 * r, 0.6, 1.6)), "conf": 0.3})
            else:
                sl = objs[c["k"]]
                thicket[sl][crowns[sl] == c["k"] + 1] = 1
                n_drop_noshadow += 1
            continue
        if st == MEASURED and hs < 2.6 and r < 1.7:
            shrubs_out.append({"x": c["wx"], "z": c["wz"], "radiusM": r, "heightM": float(np.clip(hs, 0.6, 2.6)), "conf": 0.6})
            continue
        if st == MEASURED:
            h = 0.7 * hs + 0.3 * h_allo                                     # shrink towards the prior: tips get cut by sun flecks
        elif st == BLOCKED:
            h = max(hs, h_allo)                                             # shadow tip hidden: lower bound
        elif st == NOSHADOW and c["wood_h"] is not None:
            h = 0.5 * c["wood_h"] + 0.5 * h_allo                            # inside a wood: as tall as its neighbours
        else:
            h = h_allo
        lo, hi = RANGE[c["kind"]]
        h = float(np.clip(h, lo, hi))
        conf = 0.40 + 0.30 * max(0.0, (c["pw"] - 0.5) / 0.5)
        conf += {MEASURED: 0.22, BLOCKED: 0.15, INSIDE: 0.10, NOSHADOW: -0.15}[st]
        if st == NOSHADOW and c["wood_h"] is not None:
            conf += 0.10
        if r < 1.6:
            conf -= 0.08
        if masks["meadow"][int(c["y"]), int(c["x"])] and c["zone"] != "creek":
            conf -= 0.05
        trees.append({"x": round(c["wx"], 2), "z": round(c["wz"], 2), "crownRadiusM": round(float(np.clip(r, 1.0, 9.0)), 2),
                      "heightM": round(h, 1), "kind": c["kind"], "zone": c["zone"], "conf": round(float(np.clip(conf, 0.1, 0.95)), 2),
                      "hue": round(c["hue"], 2), "_state": st})
    if args.debug:
        import pickle
        with open(os.path.join(WORK, "cache", "cands.pkl"), "wb") as f:
            pickle.dump({"cands": cands, "az": az, "el": el}, f)
        np.savez(os.path.join(WORK, "cache", "debug_masks.npz"), woody=woody, thick=thick, dark=dark)
    log(f"trees from crowns: {len(trees)} (of which {n_wood_kept} shadowless crowns inside closed canopy); "
        f"crowns turned into shrubs: {len(shrubs_out)}; shadowless thickets dropped: {n_drop_noshadow}")

    # ---- hedges + shrubs from the thin part ----------------------------------------------------------------
    raw_hedges, raw_shrubs = extract_thin(woody, thick)
    hedges = []
    for hd in raw_hedges:
        pts, tan = resample_polyline(hd["pts"], 1.0 / GSD)
        ipx, ipy = np.clip(np.round(pts[:, 0]).astype(int), 0, N - 1), np.clip(np.round(pts[:, 1]).astype(int), 0, N - 1)
        free = ~hard[ipy, ipx]
        hs_list, n_probe, n_shadow = [], 0, 0
        for (x, y), (tx, ty), fr in zip(pts, tan, free):
            sin_a = abs(tx * probe.uz - ty * probe.ux)
            if not fr or sin_a < 0.35:
                continue
            half = hd["width"] / 2.0 / sin_a
            st, t_end, _ = probe.run(float(x), float(y), 0.0, half + 1.0, half, 16.0)
            n_probe += 1
            if st in (MEASURED, BLOCKED):
                n_shadow += 1
            if st == MEASURED:
                hs_list.append((t_end - half) * tan_e)
        village = float(np.median(at(d_bld, ipy, ipx))) < 25.0
        clipped = village and hd["width"] <= 2.2
        shadow_frac = n_shadow / n_probe if n_probe else None
        if hs_list:
            h = float(np.median(hs_list))
        else:
            h = (1.3 + 0.5 * hd["width"]) if clipped else (2.0 + 0.8 * hd["width"])
        h = float(np.clip(h, 0.8, 3.2) if clipped else np.clip(h, 1.5, 6.0))
        if shadow_frac is not None and shadow_frac < 0.25 and len(hs_list) == 0:
            continue                                                        # probed, but nothing casts a shadow: border / tall grass edge
        conf = 0.35 + (0.35 * shadow_frac if shadow_frac is not None else 0.1) + (0.12 if hd["length"] >= 8.0 else 0.0) + (0.08 if hs_list else 0.0)
        # cut at roads / building buffer / parcels on the exact coordinates that get written; keep pieces >= 3 m
        wpts = [[round(float(p2w(px)), 2), round(float(p2w(py)), 2)] for px, py in pts]
        for piece in cut_polyline(hard, wpts, 1.5 * GSD, 3.0):
            hedges.append({"points": piece, "widthM": round(float(np.clip(hd["width"], 0.6, 3.0)), 2), "heightM": round(h, 1),
                           "kind": "clipped" if clipped else "wild", "conf": round(float(np.clip(conf, 0.1, 0.95)), 2)})
    for sh in raw_shrubs:
        ix, iy = int(round(sh["x"])), int(round(sh["y"]))
        if hard[iy, ix]:
            continue
        sh["x"], sh["y"] = float(ix), float(iy)
        st, tip = probe_tree(probe, sh["x"], sh["y"], sh["r"])
        if st == NOSHADOW:
            continue                                                        # flat: a tuft, not a bush
        h = tip * tan_e - k_sphere * sh["r"] if st == MEASURED else 0.8 + 0.8 * sh["r"]
        shrubs_out.append({"x": float(p2w(sh["x"])), "z": float(p2w(sh["y"])), "radiusM": sh["r"],
                           "heightM": float(np.clip(h, 0.5, 3.0)), "conf": 0.6 if st == MEASURED else 0.4})
    shrubs = [{"x": round(sh["x"], 2), "z": round(sh["z"], 2), "radiusM": round(float(np.clip(sh["radiusM"], 0.4, 1.7)), 2),
               "heightM": round(sh["heightM"], 1), "conf": sh["conf"]} for sh in shrubs_out]
    log(f"hedges: {len(hedges)} (from {len(raw_hedges)} strips), shrubs: {len(shrubs)}")

    # ---- merge OSM trees (one per ~4 m) ---------------------------------------------------------------------
    det = np.array([[t["x"], t["z"]] for t in trees])
    n_osm_dup = n_osm_excl = n_osm_added = 0
    for t in scene["trees"]:
        if np.min(np.hypot(det[:, 0] - t["x"], det[:, 1] - t["z"])) < 4.0:
            n_osm_dup += 1
            continue
        ix, iy = int(w2p(t["x"])), int(w2p(t["z"]))
        if not (0 <= ix < N and 0 <= iy < N) or hard[iy, ix] or masks["bld"][iy, ix]:
            n_osm_excl += 1
            continue
        y0, y1, x0, x1 = max(0, iy - 12), min(N, iy + 13), max(0, ix - 12), min(N, ix + 13)
        seen = bool(canopy_all[y0:y1, x0:x1].mean() > 0.25)                 # is there any canopy in the aerial at all?
        orch = t["type"] == "orchard"
        dbl = float(at(d_bld, np.array(iy), np.array(ix)))
        zone = "orchard" if orch else ("creek" if float(at(d_wat, np.array(iy), np.array(ix))) < 22.0 else ("garden" if dbl < 30.0 else "field"))
        trees.append({"x": round(t["x"], 2), "z": round(t["z"], 2), "crownRadiusM": 2.0 if orch else 3.0, "heightM": 4.5 if orch else 9.0,
                      "kind": "fruit" if orch else "broadleaf", "zone": zone, "conf": 0.4 if seen else 0.2, "hue": 0.0, "_state": -1})
        n_osm_added += 1
    log(f"OSM trees: {n_osm_dup} already detected within 4 m, {n_osm_added} added (conf 0.4 with canopy in the aerial, else 0.2), "
        f"{n_osm_excl} inside exclusion areas")

    # ---- rough patches ------------------------------------------------------------------------------------
    patches_by_kind = rough_patches(cls, rgb, woody, masks, d_bld, thicket)
    patches = []
    for kind, polys in patches_by_kind.items():
        polys = sorted(polys, key=poly_area, reverse=True)
        log(f"rough patches {kind}: {len(polys)} polygons, {sum(poly_area(p_) for p_ in polys) / 1e4:.2f} ha"
            + (f" (keeping the {PATCH_LIMITS[kind]} largest)" if len(polys) > PATCH_LIMITS[kind] else ""))
        patches += [{"polygon": p_, "kind": kind} for p_ in polys[:PATCH_LIMITS[kind]]]

    # ---- final exclusion audit: nothing may sit in a forbidden place ---------------------------------------
    bad = [t for t in trees if not cell_free(hard, t["x"], t["z"])] + [s_ for s_ in shrubs if not cell_free(hard, s_["x"], s_["z"])]
    bad_h = [h_ for h_ in hedges if not all(segment_free(hard, a, b) for a, b in zip(h_["points"][:-1], h_["points"][1:]))]
    if bad or bad_h:
        raise RuntimeError(f"{len(bad)} trees/shrubs and {len(bad_h)} hedges (vertices or segments) ended up inside exclusion "
                           f"areas - bug; first: {(bad + bad_h)[0]}")

    states = [t.pop("_state") for t in trees]
    layout = {
        "version": 1,
        "generatedBy": "scripts/detect_vegetation.py",
        "sources": ["DOP20 0.2 m aerial (data/terrain/ortho, lossless chunks .gfx/terrain/cache/dop20; (c) GeoBasis-DE / LVermGeoRP, dl-de/by-2-0)",
                    "OSM (data/osm/kindenheim_scene.json)", "crop parcels (data/osm/fields_layout.json)"],
        "stats": {"trees": len(trees), "hedges": len(hedges), "shrubs": len(shrubs), "roughPatches": len(patches)},
        "trees": trees, "hedges": hedges, "shrubs": shrubs, "roughPatches": patches,
    }
    validate_layout(layout)
    tmp = OUT_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(layout, f, separators=(",", ":"))
    os.replace(tmp, OUT_JSON)
    log(f"wrote {OUT_JSON} ({os.path.getsize(OUT_JSON) / 1e6:.2f} MB)")

    from collections import Counter
    log(f"trees by kind: {dict(Counter(t['kind'] for t in trees))}")
    log(f"trees by zone: {dict(Counter(t['zone'] for t in trees))}")
    log(f"tree height source: shadow tip {states.count(MEASURED)}, shadow lower bound/allometry {states.count(BLOCKED)}, "
        f"allometry only {states.count(INSIDE) + states.count(NOSHADOW)}, OSM default {states.count(-1)}")
    log(f"hedges by kind: {dict(Counter(h_['kind'] for h_ in hedges))}, total length "
        f"{sum(float(np.hypot(*np.diff(np.array(h_['points']), axis=0).T).sum()) for h_ in hedges):.0f} m")
    log(f"patches by kind: {dict(Counter(p_['kind'] for p_ in patches))}")
    if args.overlays:
        render_overlays(rgb, layout, scene, states)
    log(f"done in {time.time() - t0:.0f} s")
    return layout


def validate_layout(layout: dict) -> None:
    """Schema check (.gfx/VEGETATION_LAYOUT_SCHEMA.md) - raises on the first violation."""
    def num(v, lo, hi, what):
        if not isinstance(v, (int, float)) or not math.isfinite(v) or not (lo <= v <= hi):
            raise RuntimeError(f"vegetation layout: {what} = {v!r} outside [{lo}, {hi}]")

    for key in ("version", "generatedBy", "sources", "stats", "trees", "hedges", "shrubs", "roughPatches"):
        if key not in layout:
            raise RuntimeError(f"vegetation layout: missing key {key}")
    for t in layout["trees"]:
        num(t["x"], -HALF, HALF, "tree x"); num(t["z"], -HALF, HALF, "tree z")
        num(t["crownRadiusM"], 0.8, 10, "tree crownRadiusM"); num(t["heightM"], 2, 30, "tree heightM")
        num(t["conf"], 0, 1, "tree conf"); num(t["hue"], -1, 1, "tree hue")
        if t["kind"] not in ("broadleaf", "conifer", "fruit", "poplar"):
            raise RuntimeError(f"vegetation layout: tree kind {t['kind']!r}")
        if t["zone"] not in ("garden", "street", "creek", "field", "orchard", "churchyard", "sports"):
            raise RuntimeError(f"vegetation layout: tree zone {t['zone']!r}")
    for h in layout["hedges"]:
        if len(h["points"]) < 2:
            raise RuntimeError("vegetation layout: hedge with fewer than 2 points")
        for px, pz in h["points"]:
            num(px, -HALF, HALF, "hedge x"); num(pz, -HALF, HALF, "hedge z")
        num(h["widthM"], 0.4, 4, "hedge widthM"); num(h["heightM"], 0.5, 7, "hedge heightM"); num(h["conf"], 0, 1, "hedge conf")
        if h["kind"] not in ("clipped", "wild"):
            raise RuntimeError(f"vegetation layout: hedge kind {h['kind']!r}")
    for sh in layout["shrubs"]:
        num(sh["x"], -HALF, HALF, "shrub x"); num(sh["z"], -HALF, HALF, "shrub z")
        num(sh["radiusM"], 0.3, 2, "shrub radiusM"); num(sh["heightM"], 0.4, 3.5, "shrub heightM"); num(sh["conf"], 0, 1, "shrub conf")
    for p_ in layout["roughPatches"]:
        if len(p_["polygon"]) < 3:
            raise RuntimeError("vegetation layout: patch polygon with fewer than 3 points")
        for px, pz in p_["polygon"]:
            num(px, -HALF, HALF, "patch x"); num(pz, -HALF, HALF, "patch z")
        if p_["kind"] not in ("tall_grass", "garden_bed", "ruderal", "reed", "lawn"):
            raise RuntimeError(f"vegetation layout: patch kind {p_['kind']!r}")
    st = layout["stats"]
    if (st["trees"], st["hedges"], st["shrubs"], st["roughPatches"]) != (len(layout["trees"]), len(layout["hedges"]), len(layout["shrubs"]), len(layout["roughPatches"])):
        raise RuntimeError("vegetation layout: stats do not match the lists")


# ----------------------------------------------------------------------------------------------------------
# debug overlays
# ----------------------------------------------------------------------------------------------------------
OVERLAY_WINDOWS = [  # (name, centre x, centre z) - 200 m windows
    ("core_church", -20, -70), ("core_east", 180, -120), ("core_west", -250, 60), ("newbuild_east", 520, -160),
    ("newbuild_north", 200, -300), ("newbuild_west", -420, 130), ("sports", 70, -290), ("creek_east", 600, -80),
    ("creek_mid", 80, 60), ("creek_west", -640, 430), ("farm_south", -150, 330), ("field_margin_nw", -500, -250),
    ("field_margin_ne", 700, -700), ("vineyard_se", 500, 500), ("edge_sw", -900, 850), ("edge_ne_wood", 760, -880),
]
KIND_BGR = {"broadleaf": (60, 255, 60), "conifer": (255, 160, 0), "fruit": (0, 200, 255), "poplar": (255, 0, 255)}
PATCH_BGR = {"lawn": (160, 255, 160), "tall_grass": (0, 255, 255), "garden_bed": (0, 128, 255), "ruderal": (60, 60, 255), "reed": (255, 255, 0)}


def render_overlays(rgb: np.ndarray, layout: dict, scene, states=None) -> None:
    half_m = 100.0
    for name, cx, cz in OVERLAY_WINDOWS:
        x0, z0 = cx - half_m, cz - half_m
        px0, py0 = int(round(w2p(x0))), int(round(w2p(z0)))
        n = int(2 * half_m / GSD)
        px0, py0 = int(np.clip(px0, 0, N - n)), int(np.clip(py0, 0, N - n))
        x0, z0 = px0 * GSD - HALF, py0 * GSD - HALF
        im = np.ascontiguousarray(rgb[py0:py0 + n, px0:px0 + n][:, :, ::-1])

        def P(x, z):
            return int(round((x - x0) / GSD)), int(round((z - z0) / GSD))

        def inside(x, z, m=12.0):
            return x0 - m < x < x0 + 2 * half_m + m and z0 - m < z < z0 + 2 * half_m + m

        for p_ in layout["roughPatches"]:
            if any(inside(x, z, 0) for x, z in p_["polygon"]):
                cv2.polylines(im, [np.array([P(x, z) for x, z in p_["polygon"]], np.int32)], True, PATCH_BGR[p_["kind"]], 1)
        for b in scene["buildings"]:
            if inside(b["center"][0], b["center"][1], 30):
                cv2.polylines(im, [np.array([P(x, z) for x, z in b["footprint"]], np.int32)], True, (255, 255, 255), 1)
        for h in layout["hedges"]:
            if any(inside(x, z, 0) for x, z in h["points"]):
                col = (0, 0, 255) if h["kind"] == "clipped" else (0, 100, 255)
                cv2.polylines(im, [np.array([P(x, z) for x, z in h["points"]], np.int32)], False, col, max(2, int(round(h["widthM"] / GSD * 0.5))))
        for i, t in enumerate(layout["trees"]):
            if inside(t["x"], t["z"]):
                c = P(t["x"], t["z"])
                cv2.circle(im, c, int(round(t["crownRadiusM"] / GSD)), KIND_BGR[t["kind"]], 2 if t["conf"] >= 0.5 else 1)
                cv2.putText(im, f"{t['heightM']:.0f}", (c[0] - 6, c[1] + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)
        for sh in layout["shrubs"]:
            if inside(sh["x"], sh["z"]):
                cv2.circle(im, P(sh["x"], sh["z"]), max(2, int(round(sh["radiusM"] / GSD))), (255, 255, 0), -1 if sh["radiusM"] < 0.6 else 1)
                cv2.circle(im, P(sh["x"], sh["z"]), 2, (255, 255, 0), -1)
        cv2.putText(im, f"{name}  x {x0:.0f}..{x0 + 200:.0f}  z {z0:.0f}..{z0 + 200:.0f}  trees: green broadleaf / orange-blue conifer / yellow fruit / magenta poplar (number = height m); "
                    , (6, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1)
        cv2.imwrite(os.path.join(WORK, f"overlay_{name}.jpg"), im, [cv2.IMWRITE_JPEG_QUALITY, 88])
    log(f"wrote {len(OVERLAY_WINDOWS)} overlays to {WORK}/overlay_*.jpg")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse", action="store_true", help="reuse the cached class map in .gfx/detect/cache (skips training + classification)")
    ap.add_argument("--declination", type=float, default=ASSUMED_DECLINATION_DEG, help="solar declination of the flight day in degrees")
    ap.add_argument("--overlays", action="store_true", help="also render the debug overlays into .gfx/detect/overlay_*.jpg")
    ap.add_argument("--debug", action="store_true", help="dump crown candidates and masks into .gfx/detect/cache")
    args = ap.parse_args()
    run(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[detect] FAILED: {exc}", file=sys.stderr)
        raise
