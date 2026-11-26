#!/usr/bin/env python3
"""
Hero vehicle #2: tandem-axle grape-harvest tipping trailer "PALATIN TW 80" (fictional make).
Exports:
  - blender/tractor/trailer.blend
  - public/assets/models/tractor/trailer.glb
  - public/assets/models/tractor/manifest.json  (complete vehicle rig contract for src/tractor.ts)

    /opt/homebrew/bin/blender --background --python blender/tractor/build_trailer.py
    (run build_tractor.py first: the manifest reads the bounds of both GLBs)

STRICT COORDINATE & RIGGING CONTRACT (glTF Y-up):
- Ground contact at Y = 0.000 m, centred on X = 0, drawbar eye towards +Z.
- Towing eye (`trailerHitchOffset`) at [0.0, 0.62, +2.35]; it drops over the tractor's hitch pin at
  `rearHitchOffset` (y = 0.62), so the runtime simply places the trailer by that point.
- Named nodes:
  * TrailerBody   galvanised ribbed steel tub with top-hinged tailgate, headboard guard, painted tandem
                  chassis, drawbar with eye / jack / hoses, light bar, reflectors, plate and the grape load
  * Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR   R = 0.46 m, origin at the hub (runtime rolls rotation.x on every
                  node whose name starts with "Wheel_")
- Materials whose name contains "Taillight" are driven as tail / brake lamps by the runtime.
"""

import json
import math
import struct
import sys
from pathlib import Path

import bmesh
import numpy as np
from mathutils import Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from bake_utils import bake_masks, make_bake_uvs  # noqa: E402
from vehicle_utils import (  # noqa: E402
    GLB_OUT_DIR, TRACTOR_DIR, Node, RX, RY, RZ, SC, T,
    box, box_at, build_wheel, catmull, clamp, clear_scene, cyl, cyl_between, ensure_collection, join, lathe, lerp,
    load_atlas_layout, prism, quad_uv, rrect, save_blend_and_export_glb, smoothstep, sphere, surf, swatch,
    sweep, torus, tube, vehicle_materials, xf,
)
from build_tractor import TRACTOR_SPECS, bake_size  # noqa: E402

TRAILER_SPECS = {
    "trailerHitchOffset": [0.0, 0.62, 2.35],
    "trailerWheelRadius": 0.46,
    "trailerAxleOffsetZ": -0.78,
    "trailerWheelNames": ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"],
    "trailerWheelPositions": {
        "FL": [0.88, 0.46, -0.32],
        "FR": [-0.88, 0.46, -0.32],
        "RL": [0.88, 0.46, -1.24],
        "RR": [-0.88, 0.46, -1.24],
    },
    "trailerTaillightOffsets": [
        [0.80, 0.72, -2.30],
        [-0.80, 0.72, -2.30],
    ],
    # where the two hydraulic hoses and the lighting cable leave the hose rest (same order as the tractor's
    # hoseAnchors); the runtime spans sagging lines between them so they stay connected in turns
    "trailerHoseAnchors": [[-0.30, 1.345, 1.72], [-0.26, 1.345, 1.72], [-0.12, 1.345, 1.72]],
    "grapeBerriesBin": "grape_berries.bin",
}

# tub dimensions
Z_FRONT, Z_REAR = 1.28, -2.18
Y_FLOOR, Y_TOP = 1.02, 2.06
HW_BOT, HW_TOP = 0.93, 1.03
ZC = (Z_FRONT + Z_REAR) * 0.5
TUB_LEN = Z_FRONT - Z_REAR


def tub_hw(y):
    """Half width of the flared tub at height y."""
    return lerp(HW_BOT, HW_TOP, (y - Y_FLOOR) / (Y_TOP - Y_FLOOR))


def trailer_dirt(p, n, mat_name):
    if 'Grape' in mat_name or 'Leaf' in mat_name:
        return 0.0
    d = clamp((1.25 - p.y) / 1.05) ** 1.7
    if n.y < -0.35:
        d = min(1.0, d * 1.2 + 0.12)
    if 'Galvanized' in mat_name:
        d = d * 0.6 + (0.10 if p.y < 1.5 else 0.0)
    if 'Print' in mat_name or 'Decal' in mat_name:
        d *= 0.4
    return d


# ---------------------------------------------------------------------------
# Grape load
# ---------------------------------------------------------------------------

def build_grape_load(B: Node, M, A):
    rng = np.random.default_rng(11)
    x0, x1 = -1.012, 1.012
    z0, z1 = Z_REAR + 0.014, Z_FRONT - 0.014
    nx, nz = 88, 150
    xs = np.linspace(x0, x1, nx + 1)
    zs = np.linspace(z0, z1, nz + 1)
    X, Z = np.meshgrid(xs, zs, indexing='ij')

    # heaped base: crowned across the width, three loading humps along the length
    u = X / 1.012
    w = (Z - ZC) / (TUB_LEN * 0.5)
    dome = np.clip(1 - u ** 2, 0, 1) ** 0.8 * np.clip(1 - w ** 2, 0, 1) ** 0.6
    humps = 0.5 + 0.5 * np.cos((Z - ZC) * 2 * math.pi / 1.25 + 0.6)
    base = 1.915 + (0.28 + 0.10 * humps) * dome + 0.03 * np.sin(X * 3.1 + Z * 1.7) * dome

    # cluster relief: union (max) of ~1500 ellipsoidal bunches lying in random directions
    relief = np.full_like(X, -0.032)
    dx = xs[1] - xs[0]
    dz = zs[1] - zs[0]
    n_cl = 2800
    tops = []
    for _ in range(n_cl):
        cx = rng.uniform(x0, x1)
        cz = rng.uniform(z0, z1)
        a = rng.uniform(0.050, 0.080)       # half width of a bunch
        b = rng.uniform(0.080, 0.130)       # half length
        ang = rng.uniform(0, math.pi)
        off = rng.uniform(-0.030, 0.026)
        hgt = rng.uniform(0.045, 0.075)
        r = max(a, b)
        i0, i1 = max(0, int((cx - r - x0) / dx)), min(nx, int((cx + r - x0) / dx) + 1)
        k0, k1 = max(0, int((cz - r - z0) / dz)), min(nz, int((cz + r - z0) / dz) + 1)
        if i1 <= i0 or k1 <= k0:
            continue
        lx = X[i0:i1 + 1, k0:k1 + 1] - cx
        lz = Z[i0:i1 + 1, k0:k1 + 1] - cz
        ca, sa = math.cos(ang), math.sin(ang)
        d2 = ((lx * ca + lz * sa) / a) ** 2 + ((-lx * sa + lz * ca) / b) ** 2
        bump = off + hgt * np.sqrt(np.clip(1 - d2, 0, None))
        bump = np.where(d2 < 1, bump, -1.0)
        relief[i0:i1 + 1, k0:k1 + 1] = np.maximum(relief[i0:i1 + 1, k0:k1 + 1], bump)
        tops.append((off + hgt, cx, cz, a, b, ang))
    # soften the cliffs between neighbouring bunches (two passes of a small binomial filter)
    for _ in range(3):
        relief[1:-1, :] = 0.25 * relief[:-2, :] + 0.5 * relief[1:-1, :] + 0.25 * relief[2:, :]
        relief[:, 1:-1] = 0.25 * relief[:, :-2] + 0.5 * relief[:, 1:-1] + 0.25 * relief[:, 2:]
    H = base + relief
    # keep the load below the tub rim next to the walls
    hw = lerp(HW_BOT, HW_TOP, 0.9) - 0.012
    wall_dist = np.minimum(np.minimum(hw - np.abs(X), Z - z0), z1 - Z)
    H = np.minimum(H, (Y_TOP - 0.045) + np.clip(wall_dist, 0, None) * 1.3)

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    vs = [[bm.verts.new((float(X[i, k]), float(H[i, k]), float(Z[i, k]))) for k in range(nz + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for k in range(nz):
            f = bm.faces.new([vs[i][k], vs[i][k + 1], vs[i + 1][k + 1], vs[i + 1][k]])      # normal +Y
            for lp in f.loops:
                c = lp.vert.co
                lp[uvl].uv = (c.x * 0.85 + 0.37, c.z * 0.85 + 0.11)
    # skirt down to the tub floor: the load is a closed volume, not a floating sheet
    yb = Y_FLOOR + 0.012
    border = ([(i, 0) for i in range(nx + 1)] + [(nx, k) for k in range(1, nz + 1)]
              + [(i, nz) for i in range(nx - 1, -1, -1)] + [(0, k) for k in range(nz - 1, 0, -1)])
    low = [bm.verts.new((float(X[i, k]) * (HW_BOT - 0.025) / 1.012, yb, float(Z[i, k]))) for i, k in border]   # follow the flared walls
    for j in range(len(border)):
        j2 = (j + 1) % len(border)
        a_, b_ = vs[border[j][0]][border[j][1]], vs[border[j2][0]][border[j2][1]]
        f = bm.faces.new([a_, low[j], low[j2], b_])
        for lp in f.loops:
            c = lp.vert.co
            lp[uvl].uv = ((c.x + c.z) * 0.85, c.y * 0.85)
    bm.faces.new(list(reversed(low)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    B.add(bm, M['grapes'], uv='keep', sharp=60)

    def surface_h(x, z):
        i = int(clamp((x - x0) / dx, 0, nx))
        k = int(clamp((z - z0) / dz, 0, nz))
        return float(H[i, k])

    # Loose bunches of individual berries lying on the load: exported as instance data (x, y, z, radius, tint)
    # for an InstancedMesh in src/tractor.ts -- thousands of round berries for the chase camera without
    # shipping 250 k triangles in the GLB.
    berry_rows = []
    centres = []
    tries = 0
    while len(centres) < 270 and tries < 20000:
        tries += 1
        cx = rng.uniform(x0 + 0.07, x1 - 0.07)
        cz = rng.uniform(z0 + 0.07, z1 - 0.07)
        if all((cx - c[0]) ** 2 + (cz - c[1]) ** 2 > 0.105 ** 2 for c in centres):
            centres.append((cx, cz))
    stems = bmesh.new()
    for (cx, cz) in centres:
        ang = rng.uniform(0, 2 * math.pi)
        ca, sa = math.cos(ang), math.sin(ang)
        length = rng.uniform(0.13, 0.20)
        n_b = int(rng.integers(22, 34))
        tint_bunch = rng.uniform(0.0, 1.0)
        sink = rng.uniform(0.010, 0.028)                     # bunches are half buried in their neighbours
        for j in range(n_b):
            t = (j + 0.5) / n_b                               # shoulder -> tip
            rad = 0.052 * (1.0 - t) ** 0.65 + 0.006
            phi = j * 2.39996 + rng.uniform(-0.3, 0.3)
            lu = (t - 0.45) * length
            lv = rad * math.cos(phi)
            lh = rad * math.sin(phi) * 0.75
            px = cx + lu * ca - lv * sa
            pz = cz + lu * sa + lv * ca
            if not (x0 + 0.02 < px < x1 - 0.02 and z0 + 0.02 < pz < z1 - 0.02):
                continue
            r = rng.uniform(0.0105, 0.0140)
            py = surface_h(px, pz) + rad * 0.55 + lh - sink + r * 0.4
            py = min(py, Y_TOP + 0.33)
            u_ = rng.random()
            tint = 2.0 if u_ < 0.012 else (3.0 if u_ < 0.03 else float(np.clip(tint_bunch + rng.normal(0, 0.18), 0, 1)))
            berry_rows.append((px, py, pz, r, tint))
        # rachis sticking out at the shoulder end of the bunch
        sx, sz_ = cx - 0.45 * length * ca, cz - 0.45 * length * sa
        sy = surface_h(sx, sz_) + 0.045 - sink
        stem = tube([(sx, sy, sz_), (sx - 0.03 * ca, sy + 0.012, sz_ - 0.03 * sa),
                     (sx - 0.055 * ca + 0.012 * sa, sy + 0.03, sz_ - 0.055 * sa - 0.012 * ca)], 0.0035, seg=4)
        join(stems, stem)
    B.add(stems, M['print'], uv=swatch(A, 'stem'), sharp=80)
    order = rng.permutation(len(berry_rows))                  # shuffled: the runtime thins by drawing a prefix
    data = np.asarray([berry_rows[i] for i in order], dtype='<f4')
    out_bin = GLB_OUT_DIR / TRAILER_SPECS["grapeBerriesBin"]
    out_bin.write_bytes(data.tobytes())
    print(f"Wrote {out_bin.name}: {len(berry_rows)} berries, {out_bin.stat().st_size / 1024:.0f} KB")

    # vine leaves that came along with the harvest
    for k in range(34):
        lx = rng.uniform(x0 + 0.12, x1 - 0.12)
        lz = rng.uniform(z0 + 0.12, z1 - 0.12)
        ly = surface_h(lx, lz) + 0.022
        size = rng.uniform(0.10, 0.15)
        rect = A[f"leaf{1 + k % 3}"]
        bend = rng.uniform(-0.02, 0.03)

        def leaf_fn(u, v, size=size, bend=bend):
            return ((u - 0.5) * size, bend * (1 - (2 * u - 1) ** 2) + 0.012 * math.sin(v * 3.0), (v - 0.5) * size)
        leaf = surf(leaf_fn, 2, 2, uv_rect=rect, flip=True)
        m = T(lx, ly, lz) @ RY(float(rng.uniform(0, 360))) @ RX(float(rng.uniform(-22, 22))) @ RZ(float(rng.uniform(-22, 22)))
        B.add(leaf, M['leaf'], m=m, uv='keep', sharp=180)


# ---------------------------------------------------------------------------
# Trailer
# ---------------------------------------------------------------------------

def build_trailer_nodes(col):
    M = vehicle_materials()
    A = load_atlas_layout()
    B = Node("TrailerBody", dirt_fn=trailer_dirt)
    galv, fr, dk, pl = M['galv'], M['frame_green'], M['chassis'], M['plastic']

    def pal(name):
        return swatch(A, name)

    # ======================================================================
    # 1. Painted tandem chassis
    # ======================================================================
    B.add_sym(box_at(0.42, 0.83, -0.40, 0.10, 0.18, 3.40, bevel=0.012), fr)
    for cz in (-2.06, -1.24, -0.32, 0.50, 1.26):
        B.add(box_at(0, 0.83, cz, 0.76, 0.12, 0.08, bevel=0.01), fr)
    # tub sub-frame + tipping hinge at the rear
    B.add_sym(box_at(0.42, 0.965, -0.45, 0.08, 0.07, 3.36, bevel=0.01), galv)
    for cz in (-1.9, -1.1, -0.3, 0.5, 1.2):
        B.add(box_at(0, 0.975, cz, 1.84, 0.06, 0.06, bevel=0.008), galv)
    B.add_sym(box_at(0.42, 0.93, -2.05, 0.14, 0.14, 0.12, bevel=0.015), fr)
    B.add_sym(cyl(0.022, 0.20, seg=10, axis='x'), M['steel'], m=T(0.42, 0.945, -2.05), sharp=60)
    # telescopic tipping ram
    B.add(cyl_between((0, 0.78, 0.50), (0, 0.90, 0.80), 0.075, seg=16, bevel=0.008), fr)
    B.add(cyl_between((0, 0.90, 0.80), (0, 0.985, 1.01), 0.052, seg=14), M['chrome'])
    B.add(box_at(0, 0.99, 1.03, 0.20, 0.05, 0.12, bevel=0.01), galv)

    # tandem bogie: rocker beams with leaf packs, square axles, U-bolts
    for az in (-0.32, -1.24):
        B.add(box_at(0, 0.46, az, 1.46, 0.09, 0.09, bevel=0.012), dk)
    for side in (1, -1):
        x = side * 0.57
        B.add(box_at(x, 0.585, -0.78, 0.075, 0.07, 1.10, bevel=0.012), dk)
        for k in range(4):
            ln = 1.02 - k * 0.20
            B.add(box_at(x, 0.628 + k * 0.016, -0.78, 0.07, 0.014, ln, bevel=0.003), dk)
        B.add(prism([(-0.90, 0.92), (-0.66, 0.92), (-0.72, 0.60), (-0.84, 0.60)], 0.09, bevel=0.01, axis='x'), fr, m=T(side * 0.52, 0, 0))
        B.add(cyl(0.028, 0.14, seg=10, axis='x'), M['steel'], m=T(side * 0.53, 0.64, -0.78), sharp=60)
        for az in (-0.32, -1.24):
            B.add(box_at(x, 0.52, az, 0.10, 0.10, 0.13, bevel=0.012), dk)
            for dz in (-0.045, 0.045):
                B.add(cyl(0.008, 0.20, seg=6), M['bolt'], m=T(x - 0.03, 0.52, az + dz), sharp=60)
                B.add(cyl(0.008, 0.20, seg=6), M['bolt'], m=T(x + 0.03, 0.52, az + dz), sharp=60)

    # plastic mudguards over the tandem wheels
    for side in (1, -1):
        prof = [(0.30, 0.52), (0.34, 0.80), (0.24, 0.955), (0.10, 0.99), (-1.66, 0.99), (-1.80, 0.955), (-1.90, 0.80), (-1.86, 0.52)]
        prof = catmull(prof, sub=3)

        def guard(u, v, side=side, prof=prof):
            k = v * (len(prof) - 1)
            i = min(int(k), len(prof) - 2)
            t = k - i
            z = lerp(prof[i][0], prof[i + 1][0], t)
            y = lerp(prof[i][1], prof[i + 1][1], t)
            return (side * lerp(0.70, 1.09, u), y - 0.03 * (2 * u - 1) ** 4, z)
        B.add(surf(guard, 4, len(prof) - 1, thickness=0.012, flip=(side > 0)), pl, sharp=50)
        # mud flap
        B.add(box_at(side * 0.895, 0.36, -1.875, 0.36, 0.34, 0.01, bevel=0.003, rot=RX(-5)), M['rubber'])

    # ======================================================================
    # 2. Drawbar: V-beams, coupling head + eye, jack, hose post, hoses
    # ======================================================================
    hx, hy, hz = TRAILER_SPECS["trailerHitchOffset"]
    for side in (1, -1):
        B.add(sweep([(side * 0.42, 0.80, 1.30), (side * 0.055, 0.645, 2.10)], rrect(0.12, 0.09, 0.012, 1), up_hint=(0, 1, 0)), fr, sharp=50)
    B.add(box_at(0, 0.735, 1.72, 0.52, 0.10, 0.08, bevel=0.012), fr)
    B.add(box_at(0, 0.635, 2.14, 0.17, 0.115, 0.20, bevel=0.02, seg=2), fr)
    B.add(cyl_between((0, hy, 2.22), (0, hy, hz - 0.055), 0.03, seg=12), dk)
    B.add(torus(0.058, 0.022, 24, 10, axis='y'), dk, m=T(hx, hy, hz), sharp=80)
    # parking jack (retracted) with crank
    B.add(cyl(0.036, 0.52, seg=14, bevel=0.005), galv, m=T(0.33, 0.82, 1.66))
    B.add(cyl(0.027, 0.30, seg=12), M['steel'], m=T(0.33, 0.50, 1.66), sharp=60)
    B.add(box_at(0.33, 0.345, 1.66, 0.14, 0.012, 0.14, bevel=0.004), galv)
    B.add(box_at(0.33, 1.09, 1.66, 0.07, 0.05, 0.07, bevel=0.01), dk)
    B.add(tube([(0.33, 1.09, 1.70), (0.33, 1.09, 1.78), (0.33, 1.19, 1.78), (0.33, 1.19, 1.84)], 0.009, seg=6, fillet=0.02), M['bolt'], sharp=80)
    B.add(cyl(0.016, 0.07, seg=8, axis='z'), M['rubber'], m=T(0.33, 1.19, 1.875), sharp=60)
    B.add(box_at(0.36, 0.76, 1.66, 0.06, 0.10, 0.06, bevel=0.01), fr)
    # hose / cable post
    B.add(tube([(-0.22, 0.76, 1.62), (-0.22, 1.30, 1.62), (-0.22, 1.33, 1.70)], 0.014, seg=8, fillet=0.03), galv, sharp=80)
    B.add(box_at(-0.22, 1.335, 1.72, 0.30, 0.012, 0.05, bevel=0.004), galv)
    # hydraulic hoses + lighting cable from the frame up to the hose rest (the sagging span to the tractor's
    # remotes / socket is generated by src/tractor.ts between trailerHoseAnchors and the tractor's hoseAnchors)
    for k, anchor in enumerate(TRAILER_SPECS["trailerHoseAnchors"]):
        x_a = anchor[0]
        path = catmull([(x_a * 1.1, 0.90, 1.24), (x_a * 1.05, 1.06, 1.40), (x_a, 1.30, 1.60), tuple(anchor)], sub=4)
        B.add(tube(path, 0.011 if k < 2 else 0.008, seg=6), M['rubber'], sharp=80)
        B.add(box_at(x_a, 1.338, 1.72, 0.03, 0.02, 0.03, bevel=0.004), M['bolt'])              # hose clip
    # wheel chocks in a holder on the drawbar
    for k in range(2):
        B.add(prism([(0.0, 0.0), (0.20, 0.0), (0.0, 0.14)], 0.10, bevel=0.008, axis='x'), M['print'],
              m=T(-0.33 + k * 0.012, 0.86 + k * 0.0, 1.36 + k * 0.22), uv=pal('yellow'))
    B.add(box_at(-0.33, 0.855, 1.56, 0.12, 0.012, 0.50, bevel=0.003), galv)
    # type plate + warning sticker on the drawbar cross beam / front wall
    B.add(quad_uv((0.21, 0.70, 1.761), (0.05, 0.70, 1.761), (0.05, 0.775, 1.761), (0.21, 0.775, 1.761), A['typeplate']), M['print'], uv='keep')

    # ======================================================================
    # 3. Galvanised steel tub: flared walls, floor, ribs, rails, headboard guard
    # ======================================================================
    wall = [(HW_BOT, Y_FLOOR), (HW_BOT + 0.012, Y_FLOOR), (HW_TOP + 0.012, Y_TOP), (HW_TOP, Y_TOP)]
    B.add_sym(prism(wall, TUB_LEN, axis='z'), galv, m=T(0, 0, ZC))
    B.add(box_at(0, Y_FLOOR, ZC, HW_BOT * 2 + 0.02, 0.016, TUB_LEN), galv)
    front = [(-HW_BOT, Y_FLOOR), (HW_BOT, Y_FLOOR), (HW_TOP, Y_TOP), (-HW_TOP, Y_TOP)]
    B.add(prism(front, 0.012, axis='z'), galv, m=T(0, 0, Z_FRONT - 0.006))
    # vertical stakes on the sides (U-profiles following the flare) + mid rail + sills
    rib_z = [Z_FRONT - 0.035, 0.66, 0.085, -0.49, -1.065, -1.64, Z_REAR + 0.035]
    for side in (1, -1):
        for rz in rib_z:
            corner = rz in (rib_z[0], rib_z[-1])
            B.add(sweep([(side * (HW_BOT + 0.030), Y_FLOOR - 0.06, rz), (side * (HW_TOP + 0.030), Y_TOP + 0.005, rz)],
                        rrect(0.075 if corner else 0.06, 0.04, 0.008, 1), up_hint=(0, 0, 1)), galv, sharp=50)
        y_mid = 1.53
        B.add(sweep([(side * (tub_hw(y_mid) + 0.027), y_mid, Z_REAR + 0.03), (side * (tub_hw(y_mid) + 0.027), y_mid, Z_FRONT - 0.03)],
                    rrect(0.05, 0.03, 0.006, 1), up_hint=(0, 1, 0)), galv, sharp=50)
        B.add(box_at(side * (HW_BOT + 0.01), Y_FLOOR - 0.035, ZC, 0.06, 0.07, TUB_LEN, bevel=0.008), galv)
        # stake pocket bolts
        for rz in rib_z[1:-1]:
            for y in (1.12, 1.53, 1.94):
                B.add(cyl(0.011, 0.012, seg=6, axis='x'), M['bolt'], m=T(side * (tub_hw(y) + 0.052), y, rz), sharp=30)
    # top rail around sides + front
    top_path = [(HW_TOP + 0.012, Y_TOP + 0.03, Z_REAR + 0.02), (HW_TOP + 0.012, Y_TOP + 0.03, Z_FRONT), (-HW_TOP - 0.012, Y_TOP + 0.03, Z_FRONT),
                (-HW_TOP - 0.012, Y_TOP + 0.03, Z_REAR + 0.02)]
    for a, b in zip(top_path, top_path[1:]):
        B.add(sweep([a, b], rrect(0.07, 0.07, 0.014, 2), up_hint=(0, 1, 0)), galv, sharp=50)
    # front wall ribs + headboard guard (protects the tractor's rear window)
    for x in (-0.52, 0.0, 0.52):
        B.add(sweep([(x, Y_FLOOR - 0.04, Z_FRONT + 0.022), (x, Y_TOP, Z_FRONT + 0.022)], rrect(0.04, 0.06, 0.008, 1), up_hint=(0, 0, 1)), galv, sharp=50)
    B.add(sweep([(-tub_hw(1.53), 1.53, Z_FRONT + 0.018), (tub_hw(1.53), 1.53, Z_FRONT + 0.018)], rrect(0.05, 0.03, 0.006, 1), up_hint=(0, 1, 0)), galv, sharp=50)
    gy = Y_TOP + 0.36
    B.add(tube([(HW_TOP - 0.02, Y_TOP + 0.06, Z_FRONT), (HW_TOP - 0.06, gy, Z_FRONT), (-HW_TOP + 0.06, gy, Z_FRONT), (-HW_TOP + 0.02, Y_TOP + 0.06, Z_FRONT)],
               0.022, seg=8, fillet=0.08), galv, sharp=80)
    for x in (-0.60, -0.20, 0.20, 0.60):
        B.add(cyl_between((x, Y_TOP + 0.06, Z_FRONT), (x, gy, Z_FRONT), 0.012, seg=6), galv, sharp=80)
    B.add(box_at(0, Y_TOP + 0.21, Z_FRONT, 1.86, 0.26, 0.004), M['mesh'], uv=0.08)
    # ladder on the front left + step
    for x in (0.60, 0.92):
        B.add(cyl_between((x, 0.98, Z_FRONT + 0.10), (x, Y_TOP + 0.02, Z_FRONT + 0.075), 0.014, seg=8), galv, sharp=80)
    for y in (1.10, 1.38, 1.66, 1.94):
        zz = lerp(Z_FRONT + 0.10, Z_FRONT + 0.075, (y - 0.98) / 1.1)
        B.add(cyl_between((0.60, y, zz), (0.92, y, zz), 0.011, seg=6), galv, sharp=80)
    # wordmark split over two panels (dark print on zinc), both sides
    u0, v0, u1, v1 = A['trailer_mark']
    u_split = lerp(u0, u1, 0.60)
    m_per_u = 0.4535 / (u_split - u0)                    # both words at the same letter height (0.13 m)
    w1, w2 = 0.4535, (u1 - u_split) * m_per_u
    for side in (1, -1):
        y_a, y_b = 1.72, 1.85
        if side > 0:      # read front -> rear
            spans = ((0.600, 0.600 - w1, u0, u_split), (0.025, 0.025 - w2, u_split, u1))
        else:             # read rear -> front
            spans = ((-0.430, -0.430 + w1, u0, u_split), (0.145, 0.145 + w2, u_split, u1))
        for (za, zb, ua, ub) in spans:
            pts = [(side * (tub_hw(y_a) + 0.014), y_a, za), (side * (tub_hw(y_a) + 0.014), y_a, zb),
                   (side * (tub_hw(y_b) + 0.014), y_b, zb), (side * (tub_hw(y_b) + 0.014), y_b, za)]
            B.add(quad_uv(*pts, (ua, v0, ub, v1)), M['decal'], uv='keep')
        # amber side marker reflectors on the sill + white front marker
        for rz in (0.95, -0.45, -1.85):
            r_ = 0.045
            c = (side * (HW_BOT + 0.042), Y_FLOOR - 0.035, rz)
            pts = [(c[0], c[1] - r_ * 0.6, c[2] + side * r_), (c[0], c[1] - r_ * 0.6, c[2] - side * r_),
                   (c[0], c[1] + r_ * 0.6, c[2] - side * r_), (c[0], c[1] + r_ * 0.6, c[2] + side * r_)]
            B.add(quad_uv(*pts, A['refl_amber']), M['print'], uv='keep')
        r_ = 0.04
        cx = side * 0.86
        B.add(quad_uv((cx - r_, 1.12 - r_, Z_FRONT + 0.008), (cx + r_, 1.12 - r_, Z_FRONT + 0.008), (cx + r_, 1.12 + r_, Z_FRONT + 0.008),
                      (cx - r_, 1.12 + r_, Z_FRONT + 0.008), A['refl_white']), M['print'], uv='keep')
    B.add(quad_uv((-0.44, 1.16, Z_FRONT + 0.008), (-0.20, 1.16, Z_FRONT + 0.008), (-0.20, 1.304, Z_FRONT + 0.008), (-0.44, 1.304, Z_FRONT + 0.008),
                  A['warnsticker']), M['print'], uv='keep')

    # ======================================================================
    # 4. Top-hinged tailgate with ribs, locks, grape chute + slide
    # ======================================================================
    zt = Z_REAR - 0.012
    gate = [(-HW_BOT - 0.005, Y_FLOOR - 0.02), (HW_BOT + 0.005, Y_FLOOR - 0.02), (HW_TOP + 0.005, Y_TOP), (-HW_TOP - 0.005, Y_TOP)]
    B.add(prism(gate, 0.012, axis='z'), galv, m=T(0, 0, zt))
    zr = zt - 0.028
    frame_pts = [(HW_BOT - 0.02, Y_FLOOR + 0.01, zr), (HW_TOP - 0.02, Y_TOP + 0.01, zr), (-HW_TOP + 0.02, Y_TOP + 0.01, zr), (-HW_BOT + 0.02, Y_FLOOR + 0.01, zr)]
    B.add(sweep(frame_pts, rrect(0.045, 0.06, 0.008, 1), closed=True, up_hint=(0, 0, 1)), galv, sharp=50)
    for x in (-0.36, 0.36):
        B.add(sweep([(x, Y_FLOOR + 0.03, zr), (x, Y_TOP - 0.01, zr)], rrect(0.045, 0.05, 0.008, 1), up_hint=(0, 0, 1)), galv, sharp=50)
    B.add(sweep([(-tub_hw(1.60) + 0.03, 1.60, zr), (tub_hw(1.60) - 0.03, 1.60, zr)], rrect(0.045, 0.045, 0.008, 1), up_hint=(0, 1, 0)), galv, sharp=50)
    for side in (1, -1):
        # hinge arms + pins at the top corners
        B.add(box_at(side * (HW_TOP + 0.03), Y_TOP + 0.03, Z_REAR - 0.02, 0.05, 0.11, 0.16, bevel=0.012), fr)
        B.add(cyl(0.018, 0.12, seg=10, axis='x'), M['steel'], m=T(side * (HW_TOP + 0.03), Y_TOP + 0.045, Z_REAR - 0.045), sharp=60)
        # bottom lock hooks
        B.add(box_at(side * 0.70, Y_FLOOR - 0.03, Z_REAR - 0.045, 0.06, 0.12, 0.07, bevel=0.012), fr)
        B.add(cyl(0.014, 0.10, seg=8, axis='x'), M['steel'], m=T(side * 0.70, Y_FLOOR + 0.0, Z_REAR - 0.07), sharp=60)
        # warning boards
        cx, s_ = side * 0.66, 0.14
        B.add(box_at(cx, 1.30, zr - 0.012, 2 * s_ + 0.012, 2 * s_ + 0.012, 0.008, bevel=0.002), galv)
        if side > 0:
            pts = [(cx + s_, 1.30 - s_, zr - 0.017), (cx - s_, 1.30 - s_, zr - 0.017), (cx - s_, 1.30 + s_, zr - 0.017), (cx + s_, 1.30 + s_, zr - 0.017)]
            B.add(quad_uv(*pts, A['chevron']), M['print'], uv='keep')
        else:
            u0c, v0c, u1c, v1c = A['chevron']
            pts = [(cx + s_, 1.30 - s_, zr - 0.017), (cx - s_, 1.30 - s_, zr - 0.017), (cx - s_, 1.30 + s_, zr - 0.017), (cx + s_, 1.30 + s_, zr - 0.017)]
            B.add(quad_uv(*pts, (u1c, v0c, u0c, v1c)), M['print'], uv='keep')       # mirrored stripes point outwards
    # central chute with slide gate and lever
    B.add(box_at(0, 1.22, zr - 0.02, 0.36, 0.30, 0.05, bevel=0.01), galv)
    B.add(prism([(-0.16, 1.07), (0.16, 1.07), (0.13, 0.98), (-0.13, 0.98)], 0.10, bevel=0.006, axis='z'), galv, m=T(0, 0, zr - 0.05) @ RX(0))
    B.add(box_at(0, 1.25, zr - 0.05, 0.30, 0.22, 0.008), M['steel'])
    B.add(tube([(0.0, 1.36, zr - 0.055), (0.0, 1.50, zr - 0.075), (0.10, 1.50, zr - 0.075)], 0.011, seg=6, fillet=0.02), M['bolt'], sharp=80)
    B.add(sphere(0.02, 10, 6), M['print'], m=T(0.11, 1.50, zr - 0.075), uv=pal('red'))
    # speed sign + wordmark on the upper tailgate panels
    s_ = 0.085
    B.add(quad_uv((-0.57 + s_, 1.82 - s_, zt - 0.008), (-0.57 - s_, 1.82 - s_, zt - 0.008), (-0.57 - s_, 1.82 + s_, zt - 0.008), (-0.57 + s_, 1.82 + s_, zt - 0.008),
                  A['sign25']), M['decal'], uv='keep')
    B.add(quad_uv((0.28, 1.74, zt - 0.008), (-0.28, 1.74, zt - 0.008), (-0.28, 1.90, zt - 0.008), (0.28, 1.90, zt - 0.008),
                  (u0, v0, lerp(u0, u1, 0.60), v1)), M['decal'], uv='keep')

    # ======================================================================
    # 5. Light bar: lamps, triangular reflectors, plate
    # ======================================================================
    zb = -2.27
    B.add(box_at(0, 0.72, zb, 1.96, 0.12, 0.06, bevel=0.012), fr)
    B.add_sym(sweep([(0.42, 0.80, -2.08), (0.42, 0.74, zb + 0.02)], rrect(0.08, 0.06, 0.01, 1), up_hint=(0, 1, 0)), fr, sharp=50)
    zl = zb - 0.032
    for side in (1, -1):
        B.add(box_at(side * 0.76, 0.72, zl - 0.006, 0.34, 0.105, 0.03, bevel=0.01), pl)
        B.add(box_at(side * 0.80, 0.72, zl - 0.024, 0.14, 0.082, 0.012, bevel=0.004), M['trailer_taillight'], uv=0.06)
        B.add(box_at(side * 0.665, 0.72, zl - 0.024, 0.085, 0.082, 0.012, bevel=0.004), M['indicator'], uv=0.06)
        B.add(box_at(side * 0.895, 0.72, zl - 0.024, 0.04, 0.082, 0.012, bevel=0.004), M['lens_clear'])
        # triangular trailer reflector
        cx = side * 0.50
        tri = [(cx - 0.075, 0.665), (cx + 0.075, 0.665), (cx, 0.795)]
        B.add(prism(tri, 0.008, axis='z'), M['print'], m=T(0, 0, zl - 0.004), uv=('flat', ((A['refl_red'][0] + A['refl_red'][2]) / 2, (A['refl_red'][1] + A['refl_red'][3]) / 2)))
    B.add(quad_uv((0.26, 0.665, zl - 0.004), (-0.26, 0.665, zl - 0.004), (-0.26, 0.775, zl - 0.004), (0.26, 0.775, zl - 0.004), A['plate_trailer']),
          M['print'], uv='keep')
    B.add(box_at(0, 0.72, zl + 0.004, 0.54, 0.125, 0.012, bevel=0.003), pl)
    B.add(box_at(0, 0.80, zl - 0.004, 0.14, 0.022, 0.03, bevel=0.006), pl)

    # grape juice runs below the rim and at the tailgate, leaves caught on the top rail
    jr = np.random.default_rng(5)
    for side in (1, -1):
        for k, zc in enumerate((0.95, 0.32, -0.80, -1.38, -1.95)):
            if k % 2 == (0 if side > 0 else 1) and k != 4:
                continue
            wj, hj = 0.36, float(jr.uniform(0.30, 0.52))
            y1, y0 = Y_TOP - 0.02, Y_TOP - 0.02 - hj
            za, zb = (zc + wj / 2, zc - wj / 2) if side > 0 else (zc - wj / 2, zc + wj / 2)
            pts = [(side * (tub_hw(y0) + 0.0135), y0, za), (side * (tub_hw(y0) + 0.0135), y0, zb),
                   (side * (tub_hw(y1) + 0.0135), y1, zb), (side * (tub_hw(y1) + 0.0135), y1, za)]
            B.add(quad_uv(*pts, A[f"juice{1 + (k + (side > 0)) % 3}"]), M['decal'], uv='keep')
    for xc, rect in ((-0.62, 'juice2'), (0.10, 'juice3')):
        B.add(quad_uv((xc + 0.2, 1.64, zt - 0.0075), (xc - 0.2, 1.64, zt - 0.0075), (xc - 0.2, Y_TOP - 0.02, zt - 0.0075),
                      (xc + 0.2, Y_TOP - 0.02, zt - 0.0075), A[rect]), M['decal'], uv='keep')
    B.add(quad_uv((0.14, 0.99, zr - 0.101), (-0.14, 0.99, zr - 0.101), (-0.14, 1.07, zr - 0.101), (0.14, 1.07, zr - 0.101),
                  (A['juice1'][0], A['juice1'][1] + 0.08, A['juice1'][2], A['juice1'][3])), M['decal'], uv='keep')
    for (lx, lz, yaw) in ((1.045, 0.42, 20), (1.04, -1.22, 140), (-1.045, -0.30, 75), (-1.04, 0.86, 250), (0.3, Z_FRONT, 10)):
        size = 0.12

        def rim_leaf(u, v, size=size):
            return ((u - 0.5) * size, 0.012 * (1 - (2 * u - 1) ** 2) - 0.02 * max(0.0, abs(u - 0.5) * 2 - 0.55), (v - 0.5) * size)
        B.add(surf(rim_leaf, 2, 2, uv_rect=A[f"leaf{1 + int(abs(yaw)) % 3}"], flip=True), M['leaf'],
              m=T(lx, Y_TOP + 0.068, lz) @ RY(yaw), uv='keep', sharp=180)

    # ======================================================================
    # 6. Grape load
    # ======================================================================
    build_grape_load(B, M, A)

    body_obj = B.build(col)

    # ======================================================================
    # 7. Wheels
    # ======================================================================
    wm = {'tyre': M['tyre'], 'rim': M['rim'], 'hub': M['chassis'], 'bolt': M['rim']}      # nuts painted with the rim
    twp = TRAILER_SPECS["trailerWheelPositions"]
    tr = TRAILER_SPECS["trailerWheelRadius"]
    wheels = []
    for key, is_left in (("FL", True), ("FR", False), ("RL", True), ("RR", False)):
        wheels.append(build_wheel(f"Wheel_{key}", col, twp[key], tr, 0.34, is_left, wm, style='trailer'))
    return [body_obj] + wheels


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def glb_bounds(path: Path):
    data = path.read_bytes()
    jlen, _ = struct.unpack('<I4s', data[12:20])
    gltf = json.loads(data[20:20 + jlen].decode('utf-8'))
    nodes, meshes, accs = gltf.get("nodes", []), gltf.get("meshes", []), gltf.get("accessors", [])
    parents = {}
    for p_idx, nd in enumerate(nodes):
        for c_idx in nd.get("children", []):
            parents[c_idx] = p_idx

    def world_trans(idx):
        t = list(nodes[idx].get("translation", [0.0, 0.0, 0.0]))
        cur = idx
        while cur in parents:
            cur = parents[cur]
            pt = nodes[cur].get("translation", [0.0, 0.0, 0.0])
            t = [t[i] + pt[i] for i in range(3)]
        return t

    mins, maxs = [1e9] * 3, [-1e9] * 3
    for idx, nd in enumerate(nodes):
        if "mesh" not in nd:
            continue
        tr = world_trans(idx)
        for prim in meshes[nd["mesh"]].get("primitives", []):
            a = accs[prim["attributes"]["POSITION"]]
            for i in range(3):
                mins[i] = min(mins[i], a["min"][i] + tr[i])
                maxs[i] = max(maxs[i], a["max"][i] + tr[i])
    return {"min": [round(v, 3) for v in mins], "max": [round(v, 3) for v in maxs],
            "size": [round(maxs[i] - mins[i], 3) for i in range(3)]}


def write_manifest(tractor_glb: Path, trailer_glb: Path):
    for p in (tractor_glb, trailer_glb):
        if not p.exists():
            raise FileNotFoundError(f"{p} missing: run build_tractor.py before build_trailer.py")
    manifest = {
        "coordinateSystem": "Three.js Y-up, ground contact Y=0.0, vehicle centered X=0, forward +Z, left +X, right -X",
        "forwardAxis": "+Z",
        "tractorGlbPath": "/assets/models/tractor/tractor.glb",
        "trailerGlbPath": "/assets/models/tractor/trailer.glb",
        "tractorBlendSource": "blender/tractor/tractor.blend",
        "trailerBlendSource": "blender/tractor/trailer.blend",
        "tractorBounds": glb_bounds(tractor_glb),
        "trailerBounds": glb_bounds(trailer_glb),
        "frontWheelRadius": TRACTOR_SPECS["frontWheelRadius"],
        "rearWheelRadius": TRACTOR_SPECS["rearWheelRadius"],
        "wheelPositions": TRACTOR_SPECS["wheelPositions"],
        "cabCameraOffset": TRACTOR_SPECS["cabCameraOffset"],
        "steeringWheelOrigin": TRACTOR_SPECS["steeringWheelOrigin"],
        "steeringWheelSpinAxis": TRACTOR_SPECS["steeringWheelSpinAxis"],
        "exhaustTipOffset": TRACTOR_SPECS["exhaustTipOffset"],
        "beaconOffset": TRACTOR_SPECS["beaconOffset"],
        "headlightOffsets": TRACTOR_SPECS["headlightOffsets"],
        "taillightOffsets": TRACTOR_SPECS["taillightOffsets"],
        "workLightRearOffset": TRACTOR_SPECS["workLightRearOffset"],
        "rearHitchOffset": TRACTOR_SPECS["rearHitchOffset"],
        "trailerHitchOffset": TRAILER_SPECS["trailerHitchOffset"],
        "trailerWheelRadius": TRAILER_SPECS["trailerWheelRadius"],
        "trailerAxleOffsetZ": TRAILER_SPECS["trailerAxleOffsetZ"],
        "trailerWheelNames": TRAILER_SPECS["trailerWheelNames"],
        "trailerWheelPositions": TRAILER_SPECS["trailerWheelPositions"],
        "trailerTaillightOffsets": TRAILER_SPECS["trailerTaillightOffsets"],
    }
    for key in ("frontAxlePivot", "steerArmEnds", "driver", "hoseAnchors", "mirrors"):
        manifest[key] = TRACTOR_SPECS[key]
    for key in ("trailerHoseAnchors", "grapeBerriesBin"):
        if key in TRAILER_SPECS:
            manifest[key] = TRAILER_SPECS[key]
    for key, name in (("tractorBakeMap", "tractor_bake.webp"), ("trailerBakeMap", "trailer_bake.webp")):
        if (GLB_OUT_DIR / name).exists():
            manifest[key] = name
    out = GLB_OUT_DIR / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote vehicle manifest: {out}")


def bake_trailer(objs, size=4096):
    by = {o.name: o for o in objs if o.type == 'MESH' and not o.name.endswith("_Overlay")}
    make_bake_uvs([by["TrailerBody"], by["Wheel_FL"]],
                  copies=[(by["Wheel_FL"], by[n]) for n in ("Wheel_FR", "Wheel_RL", "Wheel_RR")])
    if "--no-bake" in sys.argv:
        print("Skipping the Cycles bake (--no-bake): the previous trailer_bake.webp stays in place")
        return
    bake_masks([([by["TrailerBody"]], False), ([by["Wheel_FL"]], True)], GLB_OUT_DIR / "trailer_bake.webp", size=size)


def main():
    if "--manifest-only" in sys.argv:
        write_manifest(GLB_OUT_DIR / "tractor.glb", GLB_OUT_DIR / "trailer.glb")
        return
    clear_scene()
    col = ensure_collection("Kindenheim_Weinlese_Trailer")
    objs = build_trailer_nodes(col)
    bake_trailer(objs, bake_size())
    save_blend_and_export_glb(TRACTOR_DIR / "trailer.blend", GLB_OUT_DIR / "trailer.glb", objs)
    write_manifest(GLB_OUT_DIR / "tractor.glb", GLB_OUT_DIR / "trailer.glb")


if __name__ == "__main__":
    main()
