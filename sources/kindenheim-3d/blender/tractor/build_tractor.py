#!/usr/bin/env python3
"""
Hero vehicle #1: fictional modern German vineyard / field tractor "PALATIN 110 V"
(generic design, no real make; ~4.9 m x 2.4 m x 3.2 m).
Exports blender/tractor/tractor.blend + public/assets/models/tractor/tractor.glb.

    python3 blender/tractor/generate_tractor_textures.py
    /opt/homebrew/bin/blender --background --python blender/tractor/build_tractor.py -- [--bake-size=2048] [--no-bake]
    /opt/homebrew/bin/blender --background --python blender/tractor/build_trailer.py -- [--bake-size=2048] [--manifest-only]
    (the trailer script writes manifest.json for both vehicles; --no-bake leaves a stale bake atlas behind)

STRICT RIGGING & COORDINATE CONTRACT (glTF Y-up) -- consumed by src/tractor.ts and src/camera.ts:
- Ground contact at Y = 0.000 m, centred on X = 0, FRONT facing +Z, LEFT = +X, RIGHT = -X.
- Named nodes:
  * Chassis        everything rigid: frame, engine, hood, cab, glass, interior, fenders, hitch, weights
  * Wheel_FL       origin [+0.88, 0.58, +1.42], R = 0.58 m  (runtime: steer pivot rotation.y + roll rotation.x)
  * Wheel_FR       origin [-0.88, 0.58, +1.42], R = 0.58 m
  * Wheel_RL       origin [+0.88, 0.88, -1.26], R = 0.88 m  (roll rotation.x)
  * Wheel_RR       origin [-0.88, 0.88, -1.26], R = 0.88 m
  * SteeringPivot -> SteeringWheel   pivot at [0, 1.88, -0.02] tilted 32 deg; runtime spins SteeringWheel.rotation.z
  * Beacon         origin [+0.56, 3.06, +0.24]; runtime spins rotation.y; materials named *Amber* pulse
  * Headlights     ONLY the light-emitting LED faces (nose lamps, cab work lights) -> runtime drives emissive
  * Taillights     ONLY the red tail / brake lenses -> runtime drives emissive
  * FrontFender_L / FrontFender_R: origin = front wheel hub; the runtime parents them to the steering pivots so
                   mudguards, hub carriers and steering arms turn with the wheels (they do not roll).
  * FrontAxle      swinging front axle, origin at the centre pivot [0, 0.70, 1.42]; the runtime hangs the steer
                   pivots on it and rolls it (rotation.z) over uneven ground (visual only).
  * TieRod         unit along local X between the two steering arm ends; the runtime fits it every frame.
  * Driver, DriverArm_{L,R}_{Upper,Fore}: seated figure; arm nodes point down local -Y from shoulder / elbow and
                   are posed by a two-bone solve so the hands stay on the wheel; hidden near the cab eye point.
  * ClusterLive / TerminalLive: overlay quads (UV 0..1) that receive canvas textures with the live telemetry.
  * <Node>_Overlay child nodes hold glass / decals (kept out of the AO bake).
- Every mesh has a float vertex attribute `_DIRT` (0..1) used by the runtime dust shader and a second UV set
  (TEXCOORD_1) for the baked AO / cavity / edge atlas `tractor_bake.webp` (see bake_utils.py).
- Cab camera eye: cabCameraOffset [0, 2.24, -0.58] looking +Z; nothing may sit closer than 0.25 m to it.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from bake_utils import bake_masks, make_bake_uvs  # noqa: E402
from vehicle_utils import (  # noqa: E402
    GLB_OUT_DIR, TRACTOR_DIR, Node, RX, RY, RZ, SC, T,
    box, box_at, build_wheel, capsule, catmull, circle, clamp, clear_scene, cyl, cyl_between, deform, helix,
    ensure_collection, gl_to_bl, lathe, lerp, load_atlas_layout, loft, ngon, prism, quad_uv, rrect,
    make_mat, save_blend_and_export_glb, smoothstep, sphere, surf, swatch, sweep, torus, tube, vehicle_materials, xf,
)

TRACTOR_SPECS = {
    "forwardAxis": "+Z",
    "frontWheelRadius": 0.58,
    "rearWheelRadius": 0.88,
    "wheelPositions": {
        "FL": [0.88, 0.58, 1.42],
        "FR": [-0.88, 0.58, 1.42],
        "RL": [0.88, 0.88, -1.26],
        "RR": [-0.88, 0.88, -1.26],
    },
    "cabCameraOffset": [0.0, 2.24, -0.58],
    "steeringWheelOrigin": [0.0, 1.88, -0.02],
    "steeringWheelSpinAxis": "z",
    "exhaustTipOffset": [-0.76, 2.80, 0.59],
    "beaconOffset": [0.56, 3.06, 0.24],
    "headlightOffsets": [
        [0.26, 1.47, 2.31],
        [-0.26, 1.47, 2.31],
    ],
    "taillightOffsets": [
        [0.94, 1.615, -2.07],
        [-0.94, 1.615, -2.07],
    ],
    "workLightRearOffset": [0.0, 2.84, -1.47],
    # --- visual rig helpers used by src/tractor.ts (all tractor-local) ---
    "frontAxlePivot": [0.0, 0.70, 1.42],
    "steerArmEnds": [[0.72, 0.60, 1.215], [-0.72, 0.60, 1.215]],
    "driver": {
        "shoulders": [[0.215, 2.13, -0.66], [-0.215, 2.13, -0.66]],
        "upperArm": 0.33,
        "foreArm": 0.42,
        "handRadius": 0.205,
        "handAnglesDeg": [20.0, 160.0],
        "hideRadius": 1.3,
    },
    "hoseAnchors": [[-0.47, 1.12, -1.80], [-0.398, 1.12, -1.80], [0.36, 1.12, -1.74]],
    # mirror glass planes (centre, yaw of the reflecting side, width x height) for the optional planar reflections
    "mirrors": [{"position": [0.9753, 2.29, 0.3462], "yawDeg": 194, "size": [0.17, 0.34]}, {"position": [-0.9753, 2.29, 0.3462], "yawDeg": 166, "size": [0.17, 0.34]}],
    "rearHitchOffset": [0.0, 0.62, -2.02],
}

RW_Y, RW_Z, FENDER_R = 0.88, -1.26, 1.00       # rear wheel centre + rear mudguard radius
FW_Y, FW_Z = 0.58, 1.42
CAB_FLOOR = 1.27


def fender_y(z):
    dz = z - RW_Z
    return RW_Y + math.sqrt(max(FENDER_R * FENDER_R - dz * dz, 0.0))


def glass_z(y):
    """Windscreen plane (leans back towards the roof)."""
    return 0.47 - 0.146 * (y - 1.30)


# ---------------------------------------------------------------------------
# Hood surface
# ---------------------------------------------------------------------------

# z, half width at shoulder, half width at bottom, top y, bottom y, shoulder radius, crown
_HOOD_CTRL = [
    (0.47, 0.520, 0.535, 1.905, 1.16, 0.110, 0.035),
    (0.85, 0.516, 0.530, 1.885, 1.14, 0.110, 0.035),
    (1.30, 0.502, 0.516, 1.835, 1.10, 0.105, 0.035),
    (1.75, 0.482, 0.496, 1.765, 1.07, 0.100, 0.032),
    (2.08, 0.466, 0.480, 1.705, 1.06, 0.095, 0.030),
    (2.22, 0.456, 0.470, 1.668, 1.06, 0.090, 0.030),
]
HOOD_ST = [tuple(v) for v in catmull(_HOOD_CTRL, sub=6)]
HOOD_SPLIT_H = 0.27          # black vented engine side panel height above the hood bottom edge
HOOD_SPLIT_IDX = 21          # index into the half profile where paint ends


def hood_params(z):
    st = HOOD_ST
    if z <= st[0][0]:
        return st[0]
    for a, b in zip(st, st[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(lerp(a[k], b[k], t) for k in range(7))
    return st[-1]


def hood_half_profile(p):
    """Half profile (x >= 0) from the top centre down to the bottom edge: 25 points."""
    _z, ws, wb, yt, yb, rs, crown = p
    pts = []
    for k in range(9):
        t = k / 8
        pts.append((t * (ws - rs), yt - crown * t * t))
    cx, cy = ws - rs, yt - crown - rs
    for k in range(1, 11):
        a = math.radians(90 - 9 * k)
        pts.append((cx + rs * math.cos(a), cy + rs * math.sin(a)))
    y_split = yb + HOOD_SPLIT_H

    def side_x(y):
        return lerp(ws, wb, (cy - y) / (cy - yb))
    for k in range(1, 4):
        y = lerp(cy, y_split, k / 3)
        pts.append((side_x(y), y))
    # vented engine side panel: top frame, louvre opening, bottom frame
    for y in (y_split - 0.040, yb + 0.045, yb):
        pts.append((side_x(y), y))
    return pts


def hood_ring(p, inset=0.0, z=None):
    half = hood_half_profile(p)
    _z, ws, _wb, yt, yb, _rs, _crown = p
    z = _z if z is None else z
    sx = 1.0 - inset / ws
    sy = 1.0 - inset / (yt - yb)
    ring = [(x * sx, yb + (y - yb) * sy, z) for x, y in reversed(half)]
    ring += [(-x * sx, yb + (y - yb) * sy, z) for x, y in half[1:]]
    return ring


def hood_side_point(z, y, side, off=0.0):
    p = hood_params(z)
    _z, ws, wb, yt, yb, rs, crown = p
    cy = yt - crown - rs
    x = lerp(ws, wb, clamp((cy - y) / (cy - yb)))
    return (side * (x + off), y, z)


def hood_split_y(z):
    return hood_params(z)[4] + HOOD_SPLIT_H


# ---------------------------------------------------------------------------
# Dirt masks
# ---------------------------------------------------------------------------

def chassis_dirt(p, n, mat_name):
    d = clamp((1.40 - p.y) / 1.25) ** 1.8
    if n.y < -0.35:
        d = min(1.0, d * 1.2 + 0.12)
    # road spray behind the wheels
    if p.z < -1.5 and p.y < 1.7:
        d = min(1.0, d + 0.18)
    inside_cab = abs(p.x) < 0.60 and CAB_FLOOR - 0.02 < p.y < 2.74 and -1.28 < p.z < 0.40
    if inside_cab:
        d = 0.42 if 'Floor_Mat' in mat_name else 0.0
    if 'Glass' in mat_name or 'Display' in mat_name or 'Decal' in mat_name or 'Print' in mat_name:
        d *= 0.25
    if 'Roof' in mat_name:
        d = max(d, 0.10 if n.y > 0.6 else 0.0)
    return d


def front_fender_dirt(p, n, mat_name):
    # node-local coordinates (origin = wheel hub); underside catches everything
    return 0.85 if n.y < -0.1 else 0.30


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build_tractor_nodes(col):
    M = vehicle_materials()
    A = load_atlas_layout()
    C = Node("Chassis", dirt_fn=chassis_dirt)

    def pal(name):
        return swatch(A, name)

    # ======================================================================
    # 1. Drivetrain / frame (painted castings)
    # ======================================================================
    ch = M['chassis']
    C.add(box_at(0, 0.87, 1.85, 0.50, 0.42, 0.76, bevel=0.045, seg=2), ch)            # front axle support casting
    C.add(box_at(0, 0.98, 1.10, 0.46, 0.52, 0.80, bevel=0.03), ch)                    # engine block
    C.add(box_at(0, 0.66, 1.10, 0.34, 0.16, 0.66, bevel=0.035, seg=2), ch)            # oil sump
    C.add(cyl(0.30, 0.26, seg=28, axis='z', bevel=0.02), ch, m=T(0, 0.96, 0.52))       # flywheel / bell housing
    C.add(box_at(0, 0.92, -0.42, 0.50, 0.56, 1.66, bevel=0.05, seg=2), ch)            # transmission
    C.add(box_at(0, 0.92, -1.30, 0.62, 0.68, 0.66, bevel=0.06, seg=2), ch)            # rear axle centre housing
    for k in range(10):                                                               # bell housing flange bolts
        a = 2 * math.pi * k / 10
        C.add(cyl(0.014, 0.03, seg=6, axis='z'), M['bolt'], m=T(0.275 * math.cos(a), 0.96 + 0.275 * math.sin(a), 0.655), sharp=30)
    # rear axle trumpets + flanges
    trumpet = lathe([(0.215, 0.30), (0.215, 0.36), (0.18, 0.40), (0.155, 0.56), (0.20, 0.57), (0.20, 0.60), (0.0, 0.60)],
                    seg=28, axis='x', do_recalc=True)
    C.add_sym(trumpet, ch, m=T(0, RW_Y, RW_Z))
    for k in range(8):
        a = 2 * math.pi * k / 8
        C.add_sym(cyl(0.013, 0.03, seg=6, axis='x'), M['bolt'],
                  m=T(0.365, RW_Y + 0.192 * math.cos(a), RW_Z + 0.192 * math.sin(a)), sharp=30)
    # frame rails along the engine
    C.add_sym(box_at(0.26, 0.90, 1.25, 0.05, 0.16, 1.9, bevel=0.012), ch)
    # 4WD drive shaft to the front axle + guard
    C.add(cyl_between((0.0, 0.60, 0.1), (0.0, 0.60, 1.30), 0.034, seg=12), M['steel'])
    C.add(box_at(0.0, 0.565, 0.72, 0.13, 0.03, 1.0, bevel=0.01), ch)
    # engine dress: oil filter, starter, alternator, fuel filter, hydraulic lines
    C.add(cyl(0.048, 0.15, seg=16, axis='y', bevel=0.008), M['print'], m=T(0.275, 0.83, 0.86), uv=pal('white'))
    C.add(cyl(0.062, 0.20, seg=16, axis='z', bevel=0.01), ch, m=T(-0.285, 0.84, 0.74))
    C.add(cyl(0.040, 0.10, seg=12, axis='z', bevel=0.006), M['steel'], m=T(-0.285, 0.84, 0.89))
    C.add(cyl(0.070, 0.12, seg=18, axis='z', bevel=0.012), M['steel'], m=T(0.27, 1.10, 1.44))
    C.add(cyl(0.040, 0.13, seg=14, axis='y', bevel=0.006), M['plastic'], m=T(-0.27, 1.06, 1.30))
    for k, (x, y) in enumerate(((0.30, 1.00), (0.30, 1.035), (-0.30, 1.00))):
        C.add(tube([(x, y, 1.9), (x, y, 0.45), (x * 0.9, y - 0.12, 0.25), (x * 0.9, y - 0.12, -1.0)], 0.011, seg=6, fillet=0.06),
              M['steel'] if k != 1 else M['rubber'], sharp=80)

    # front axle carrier on the chassis (the swinging axle itself is the FrontAxle node, see section 12)
    C.add(box_at(0, 0.71, FW_Z, 0.24, 0.20, 0.30, bevel=0.03), ch)
    C.add(cyl(0.035, 0.36, seg=12, axis='z'), M['steel'], m=T(0, 0.70, FW_Z))

    # ======================================================================
    # 2. Front ballast: carrier + ten suitcase weights
    # ======================================================================
    C.add(box_at(0, 0.90, 2.29, 0.62, 0.17, 0.20, bevel=0.02), ch)
    C.add(box_at(0, 0.985, 2.37, 0.86, 0.03, 0.08, bevel=0.008), ch)               # weight rail
    w_poly = [(2.34, 0.63), (2.60, 0.60), (2.68, 0.68), (2.69, 0.98), (2.64, 1.05), (2.585, 1.06),
              (2.565, 1.115), (2.47, 1.115), (2.45, 1.06), (2.34, 1.04)]
    for k in range(10):
        x = -0.369 + k * 0.082
        C.add(prism(w_poly, 0.073, bevel=0.009, axis='x'), ch, m=T(x, 0, 0), uv=0.6)
    C.add(cyl(0.013, 0.90, seg=8, axis='x'), M['bolt'], m=T(0, 0.74, 2.52), sharp=60)
    C.add_sym(cyl(0.026, 0.02, seg=6, axis='x'), M['bolt'], m=T(0.447, 0.74, 2.52), sharp=30)
    C.add(cyl(0.022, 0.18, seg=10, axis='y'), M['print'], m=T(0, 1.14, 2.52), uv=pal('red'), sharp=60)   # locking pin
    C.add(torus(0.03, 0.006, 14, 6, axis='x'), M['bolt'], m=T(0, 1.25, 2.52), sharp=80)

    # ======================================================================
    # 3. Hood: lofted painted shell, vented black side panels, nose, grille, lamps
    # ======================================================================
    rings = [hood_ring(p) for p in HOOD_ST]
    nose_r = 0.065
    last = HOOD_ST[-1]
    for k in range(1, 6):
        a = math.radians(90 * k / 5)
        rings.append(hood_ring(last, inset=nose_r * (1 - math.cos(a)), z=last[0] + nose_r * math.sin(a)))
    n_ring = len(rings[0])                      # 49
    s0 = (n_ring - 1) // 2 - HOOD_SPLIT_IDX     # index of the paint/black split on the +X side (3)
    s1 = n_ring - 1 - s0
    C.add(loft([r[s0:s1 + 1] for r in rings], closed=False, do_recalc=False), M['paint'], sharp=45)

    def side_panel(idx):
        """Black engine side panel strip; the middle row is left open between z = 1.0 and 1.68 (louvres)."""
        bm = bmesh.new()
        vr = [[bm.verts.new(Vector(r[i])) for i in idx] for r in rings]
        for i in range(len(vr) - 1):
            z0, z1 = rings[i][0][2], rings[i + 1][0][2]
            for j in range(len(idx) - 1):
                if j == 1 and z0 >= 0.955 and z1 <= 1.735:
                    continue
                bm.faces.new([vr[i][j], vr[i][j + 1], vr[i + 1][j + 1], vr[i + 1][j]])
        return bm
    C.add(side_panel(list(range(0, s0 + 1))), M['plastic'], sharp=45)
    C.add(side_panel(list(range(s1, n_ring))), M['plastic'], sharp=45)

    # --- engine bay glimpsed through the louvres and under the side panels ---
    en, al = M['engine'], M['alu']
    C.add(box_at(0, 1.30, 1.12, 0.36, 0.36, 0.88, bevel=0.02), en)                         # block / head
    C.add(box_at(0, 1.535, 1.12, 0.30, 0.12, 0.86, bevel=0.035, seg=2), al)                # rocker cover
    C.add(cyl(0.03, 0.03, seg=12), M['print'], m=T(-0.08, 1.61, 1.40), uv=pal('yellow'))   # oil filler cap
    C.add(tube([(0.22, 1.43, 0.74), (0.22, 1.43, 1.52)], 0.042, seg=10), al, sharp=70)     # intake manifold
    C.add(box_at(0.26, 1.21, 1.26, 0.13, 0.15, 0.32, bevel=0.02), al)                      # injection pump
    for k in range(4):
        zc = 0.82 + k * 0.20
        C.add(cyl_between((0.21, 1.43, zc), (0.15, 1.37, zc), 0.028, seg=8), al, sharp=70)
        C.add(cyl(0.012, 0.07, seg=6), M['steel'], m=T(0.07, 1.61, zc), sharp=60)          # injectors
        C.add(tube([(0.26, 1.29, 1.15 + k * 0.07), (0.30, 1.50, 1.0 + k * 0.12), (0.12, 1.63, zc), (0.07, 1.64, zc)], 0.005, seg=5, fillet=0.03),
              M['steel'], sharp=80)
    for zc in (0.84, 0.97):
        C.add(cyl(0.046, 0.15, seg=14, bevel=0.008), M['print'], m=T(0.33, 1.24, zc), uv=pal('white'))   # fuel filters
        C.add(cyl(0.05, 0.03, seg=14), al, m=T(0.33, 1.33, zc), sharp=50)
    C.add(tube([(0.19, 1.26, 1.47), (0.19, 1.56, 1.47)], 0.004, seg=5), M['steel'], sharp=80)           # dipstick
    C.add(torus(0.012, 0.004, 10, 5, axis='x'), M['print'], m=T(0.19, 1.57, 1.47), uv=pal('yellow'), sharp=80)
    # exhaust side: manifold, turbocharger, alternator
    C.add(tube([(-0.21, 1.41, 1.50), (-0.22, 1.41, 0.80), (-0.30, 1.30, 0.74), (-0.40, 1.22, 0.74)], 0.04, seg=10, fillet=0.05),
          M['exhaust'], uv=('flat', (0.5, 0.10)), sharp=70)
    for k in range(4):
        zc = 0.82 + k * 0.20
        C.add(cyl_between((-0.20, 1.41, zc), (-0.15, 1.36, zc), 0.03, seg=8), M['exhaust'], uv=('flat', (0.5, 0.12)), sharp=70)
    C.add(cyl(0.085, 0.07, seg=18, axis='x', bevel=0.012), al, m=T(-0.30, 1.50, 0.98))
    C.add(cyl(0.07, 0.07, seg=18, axis='x', bevel=0.012), M['exhaust'], m=T(-0.22, 1.50, 0.98), uv=('flat', (0.5, 0.10)))
    C.add(tube([(-0.36, 1.50, 0.98), (-0.40, 1.50, 1.20), (-0.30, 1.52, 1.60), (-0.05, 1.50, 1.82)], 0.035, seg=8, fillet=0.08), M['rubber'], sharp=70)
    C.add(cyl(0.062, 0.12, seg=14, axis='z', bevel=0.01), al, m=T(-0.27, 1.22, 1.52))                    # alternator
    # belt drive, fan, radiator with coolant hoses, air cleaner
    for (px, py, pr) in ((0.0, 1.02, 0.085), (-0.27, 1.22, 0.035), (0.0, 1.40, 0.06)):
        C.add(cyl(pr, 0.03, seg=18, axis='z', bevel=0.004), M['steel'], m=T(px, py, 1.60))
    belt = [(0.085, 1.00, 1.60), (0.062, 1.42, 1.60), (0.0, 1.46, 1.60), (-0.285, 1.255, 1.60), (-0.29, 1.19, 1.60), (-0.02, 0.935, 1.60), (0.07, 0.96, 1.60)]
    C.add(sweep(belt, rrect(0.006, 0.02, 0.002, 1), closed=True, up_hint=(1, 0, 0)), M['rubber'], sharp=60)
    C.add(cyl(0.05, 0.05, seg=12, axis='z'), M['steel'], m=T(0, 1.40, 1.68), sharp=50)
    for k in range(7):
        C.add(box(0.07, 0.19, 0.012, bevel=0.003), M['plastic'], m=T(0, 1.40, 1.71) @ RZ(k * 360 / 7) @ T(0, 0.14, 0) @ RY(28), sharp=30)
    C.add(box_at(0, 1.38, 1.93, 0.74, 0.60, 0.10, bevel=0.012), al)                                    # radiator
    C.add(box_at(0, 1.38, 1.875, 0.70, 0.56, 0.012), M['mesh'], uv=0.03)
    C.add(tube([(0.20, 1.62, 1.90), (0.22, 1.66, 1.70), (0.16, 1.60, 1.52)], 0.026, seg=8, fillet=0.06), M['rubber'], sharp=70)
    C.add(box_at(-0.30, 1.60, 1.76, 0.12, 0.16, 0.16, bevel=0.03, seg=2), M['print'], uv=pal('white'))  # coolant tank
    C.add(cyl(0.03, 0.02, seg=10), M['print'], m=T(-0.30, 1.69, 1.76), uv=pal('black'), sharp=50)
    C.add(capsule((0.13, 1.70, 0.98), (0.13, 1.70, 1.42), 0.085, seg=14, cap_rings=2), M['plastic'], sharp=60)   # air cleaner
    C.add(tube([(0.13, 1.70, 0.95), (0.30, 1.60, 0.84), (0.45, 1.38, 0.80)], 0.04, seg=8, fillet=0.08), M['rubber'], sharp=70)
    C.add(tube([(0.13, 1.66, 1.44), (0.22, 1.52, 1.50), (0.22, 1.43, 1.50)], 0.035, seg=8, fillet=0.05), M['rubber'], sharp=70)

    # hood hinges at the cowl, belt-line fasteners
    C.add_sym(box_at(0.30, hood_params(0.50)[3] - 0.012, 0.50, 0.09, 0.018, 0.05, bevel=0.005), M['bolt'])
    for side in (1, -1):
        for i in range(10):
            z = 0.58 + i * 0.17
            px, py, pz = hood_side_point(z, hood_split_y(z) - 0.020, side, 0.003)
            C.add(cyl(0.008, 0.008, seg=6, axis='x'), M['bolt'], m=T(px, py, pz), sharp=30)
    C.add(ngon(rings[-1]), M['plastic'], sharp=45)
    nose_z = last[0] + nose_r                   # front face plane (2.285)

    # silver belt line trim between paint and the vented panels + louvres
    for side in (1, -1):
        path = [hood_side_point(z, hood_split_y(z), side, 0.004) for z in [0.50 + 0.1 * i for i in range(18)]]
        C.add(sweep(path, rrect(0.016, 0.010, 0.003, 1), up_hint=(0, 1, 0)), M['chrome'], sharp=50)
        for i in range(9):
            z = 1.00 + i * 0.085
            y = hood_params(z)[4] + 0.13
            px, py, pz = hood_side_point(z, y, side, 0.006)
            C.add(box(0.016, 0.17, 0.05, bevel=0.004), M['plastic'], m=T(px, py, pz) @ RY(side * 32), sharp=30)
        # service latch + panel seam
        px, py, pz = hood_side_point(0.72, hood_params(0.72)[4] + 0.13, side, 0.008)
        C.add(box(0.014, 0.05, 0.11, bevel=0.005), M['bolt'], m=T(px, py, pz))
    # hood seams: a dark gap ring behind the nose cone and at the cowl
    for z_seam in (1.93, 0.52):
        p = hood_params(z_seam)
        ring = [(x * 1.002, y + 0.001, z_seam) for x, y, _z in hood_ring(p)][s0:s1 + 1]
        C.add(sweep(ring, rrect(0.004, 0.012, 0.001, 1), caps=True), M['rubber'], sharp=60)

    # grille panel on the nose face
    C.add(box_at(0, 1.335, nose_z + 0.004, 0.74, 0.50, 0.03, bevel=0.012, seg=2), M['plastic'])
    C.add(box_at(0, 1.25, nose_z + 0.021, 0.60, 0.28, 0.006), M['mesh'], uv=0.08)                 # mesh backing
    for k in range(8):                                                                           # slats
        y = 1.125 + k * 0.036
        C.add(box_at(0, y, nose_z + 0.03, 0.62, 0.012, 0.024, bevel=0.004, rot=RX(-22)), M['plastic'], sharp=30)
    C.add(sweep([(0.315, 1.105, nose_z + 0.03), (0.315, 1.395, nose_z + 0.03), (-0.315, 1.395, nose_z + 0.03),
                 (-0.315, 1.105, nose_z + 0.03)], rrect(0.014, 0.022, 0.004, 1), closed=True, up_hint=(0, 0, 1)),
          M['chrome'], sharp=50)
    C.add_sym(box_at(0.105, 1.25, nose_z + 0.031, 0.014, 0.28, 0.02, bevel=0.004), M['plastic'])
    # emblem between the headlamps
    C.add(cyl(0.062, 0.016, seg=28, axis='z', bevel=0.004), M['chrome'], m=T(0, 1.49, nose_z + 0.022))
    e = 0.055
    C.add(quad_uv((-e, 1.49 - e, nose_z + 0.0315), (e, 1.49 - e, nose_z + 0.0315), (e, 1.49 + e, nose_z + 0.0315),
                  (-e, 1.49 + e, nose_z + 0.0315), A['emblem']), M['decal'], uv='keep')
    # headlamp units: recessed bucket, chrome reflector, clear cover (LED emitters live in the Headlights node)
    for side in (1, -1):
        cx = side * 0.26
        C.add(box_at(cx, 1.47, nose_z + 0.012, 0.22, 0.115, 0.02, bevel=0.006), M['rubber'])
        C.add(box_at(cx, 1.47, nose_z + 0.016, 0.20, 0.095, 0.02, bevel=0.012, seg=2), M['chrome'])
        C.add(surf(lambda u, v, cx=cx: (cx + (u - 0.5) * 0.205, 1.47 + (v - 0.5) * 0.10,
                                        nose_z + 0.034 + 0.006 * math.sin(math.pi * u) * math.sin(math.pi * v)), 6, 4),
              M['lens_clear'], sharp=60)
    # lower air dam under the grille
    C.add(box_at(0, 1.07, nose_z + 0.01, 0.30, 0.05, 0.05, bevel=0.012), M['plastic'])

    # wordmark + model badge on both hood flanks
    for side in (1, -1):
        z_a, z_b = (1.72, 0.92) if side > 0 else (0.92, 1.72)        # reading direction front->rear on the left
        yc = 1.545
        hgt = 0.15

        def decal_fn(u, v, side=side, z_a=z_a, z_b=z_b):
            z = lerp(z_a, z_b, u)
            # follow the falling hood line a little
            y = yc - hgt / 2 + hgt * v + (hood_params(z)[3] - hood_params(1.30)[3]) * 0.55
            return hood_side_point(z, y, side, 0.0035)
        C.add(surf(decal_fn, 8, 1, uv_rect=A['wordmark']), M['decal'], uv='keep', sharp=80)
        zb0, zb1 = (0.86, 0.60) if side > 0 else (0.60, 0.86)

        def badge_fn(u, v, side=side, zb0=zb0, zb1=zb1):
            z = lerp(zb0, zb1, u)
            return hood_side_point(z, 1.56 + 0.11 * v, side, 0.0035)
        C.add(surf(badge_fn, 3, 1, uv_rect=A['badge']), M['decal'], uv='keep', sharp=80)

    # air intake louvre panel on the hood top in front of the cowl
    hz_v = 0.70
    hv = T(0, hood_params(hz_v)[3] - 0.005, hz_v) @ RX(3.0)
    C.add(box(0.46, 0.012, 0.24, bevel=0.005), M['plastic'], m=hv)
    for k in range(6):
        C.add(box(0.40, 0.008, 0.016, bevel=0.002), M['rubber'], m=hv @ T(0, 0.008, -0.09 + k * 0.036) @ RX(-25), sharp=30)

    # cowl / scuttle wedge between the hood and the windscreen (wiper pivot sits here)
    C.add(prism([(0.478, 1.20), (0.478, 1.897), (0.392, 1.902), (0.47, 1.30)], 1.05, bevel=0.006, axis='x'), M['plastic'])
    for k in range(7):
        C.add(box_at(-0.36 + k * 0.12, 1.902, 0.435, 0.09, 0.006, 0.05, bevel=0.002), M['rubber'], sharp=30)

    # ======================================================================
    # 4. Cab structure: floor, pillars, roof, glazing
    # ======================================================================
    pl = M['plastic']
    C.add(box_at(0, CAB_FLOOR - 0.04, -0.44, 1.30, 0.07, 1.74, bevel=0.015), ch)                  # floor pan
    C.add(box_at(0, CAB_FLOOR + 0.004, -0.40, 1.14, 0.014, 1.50, bevel=0.004), M['mat'])           # rubber mat
    C.add_sym(box_at(0.655, CAB_FLOOR + 0.0, 0.07, 0.05, 0.10, 0.82, bevel=0.015), pl)             # door sill

    pillar = rrect(0.085, 0.065, 0.02, 2)
    Ab, At = (0.635, 1.27, 0.47), (0.575, 2.75, 0.255)
    Bb, Bt = (0.652, fender_y(-0.45) - 0.02, -0.45), (0.588, 2.75, -0.45)
    Cb, Ct = (0.648, fender_y(-1.27) - 0.03, -1.27), (0.600, 2.75, -1.22)
    for a, b, hint in ((Ab, At, (0, 0, 1)), (Bb, Bt, (0, 0, 1)), (Cb, Ct, (0, 0, 1))):
        C.add_sym(sweep([a, b], pillar, up_hint=hint), pl, sharp=45)
    C.add_sym(sweep([At, Bt, Ct], rrect(0.06, 0.07, 0.018, 2), up_hint=(0, 1, 0)), pl, sharp=45)   # cant rails
    C.add(sweep([At, (-At[0], At[1], At[2])], rrect(0.06, 0.07, 0.018, 2), up_hint=(0, 1, 0)), pl, sharp=45)
    C.add(sweep([Ct, (-Ct[0], Ct[1], Ct[2])], rrect(0.06, 0.07, 0.018, 2), up_hint=(0, 1, 0)), pl, sharp=45)
    # rear bulkhead under the rear window + number plate
    C.add(box_at(0, 1.55, -1.30, 1.22, 0.56, 0.05, bevel=0.012), pl)
    C.add(sweep([(0.63, 1.83, -1.275), (-0.63, 1.83, -1.275)], rrect(0.05, 0.05, 0.012, 1), up_hint=(0, 1, 0)), pl, sharp=45)
    C.add(quad_uv((0.26, 1.545, -1.3265), (-0.26, 1.545, -1.3265), (-0.26, 1.655, -1.3265), (0.26, 1.655, -1.3265),
                  A['plate_tractor']), M['print'], uv='keep')
    C.add(box_at(0, 1.60, -1.322, 0.54, 0.125, 0.008, bevel=0.003), pl)
    C.add(box_at(0, 1.685, -1.335, 0.16, 0.025, 0.03, bevel=0.006), pl)                             # plate lamp
    s40 = 0.055
    C.add(quad_uv((0.50, 1.50 - s40, -1.326), (0.50 - 2 * s40, 1.50 - s40, -1.326), (0.50 - 2 * s40, 1.50 + s40, -1.326),
                  (0.50, 1.50 + s40, -1.326), A['sign40']), M['decal'], uv='keep')
    C.add(quad_uv((-0.30, 1.42, -1.326), (-0.52, 1.42, -1.326), (-0.52, 1.50, -1.326), (-0.30, 1.50, -1.326),
                  A['tape_redwhite'][:2] + (A['tape_redwhite'][0] + 0.11, A['tape_redwhite'][3])), M['print'], uv='keep')

    # roof: rounded shell with a drooping front visor, drip rail, hatch, antenna
    roof = box(1.46, 0.21, 2.00, bevel=0.075, seg=5)
    xf(roof, T(0, 2.86, -0.46))

    def roof_shape(c):
        x, y, z = c
        if z > 0.15:
            y -= (z - 0.15) * 0.16                      # visor droop
        if y > 2.90:
            # compound-curved roof skin: crowned in both directions
            y += 0.028 * max(0.0, 1.0 - (x / 0.73) ** 2) * max(0.0, 1.0 - ((z + 0.46) / 1.02) ** 2)
            x *= 0.965
        return (x, y, z)
    deform(roof, roof_shape)
    C.add(roof, M['roof'], sharp=50)
    C.add(box_at(0, 2.762, -0.48, 1.38, 0.035, 1.80, bevel=0.012), pl)                             # roof frame / seal
    C.add(box_at(0, 2.990, -0.62, 0.62, 0.02, 0.70, bevel=0.01, seg=2), M['roof'])                 # roof hatch
    C.add(box_at(0, 2.997, -0.28, 0.10, 0.025, 0.04, bevel=0.006), pl)
    # roof furniture (the chase camera looks down on it): GPS receiver, A/C condenser cover with louvres, ribs
    C.add(lathe([(0.0, 0.0), (0.105, 0.0), (0.105, 0.018), (0.092, 0.045), (0.05, 0.066), (0.0, 0.07)], seg=24, do_recalc=True),
          M['roof'], m=T(0, 2.978, 0.02), sharp=45)
    C.add(cyl(0.11, 0.012, seg=24), pl, m=T(0, 2.981, 0.02), sharp=50)
    C.add(box_at(0, 2.996, -1.10, 0.86, 0.06, 0.46, bevel=0.022, seg=2), M['roof'])
    for k in range(7):
        C.add(box_at(0, 3.027, -1.25 + k * 0.05, 0.66, 0.006, 0.026, bevel=0.002), pl, sharp=30)
    C.add_sym(box_at(0.50, 2.978, -0.52, 0.035, 0.014, 0.74, bevel=0.006), M['roof'])
    C.add(cyl_between((-0.55, 2.95, -1.25), (-0.57, 3.42, -1.36), 0.004, seg=5), M['rubber'], sharp=80)   # antenna
    C.add(cyl(0.02, 0.03, seg=10), M['rubber'], m=T(-0.55, 2.965, -1.25), sharp=50)
    # front work lamps in the visor (bezel here, LED faces in Headlights) and rear work lamps
    visor_y = 2.86 - (0.54 - 0.15) * 0.16
    for x in (-0.50, -0.26, 0.26, 0.50):
        C.add(box_at(x, visor_y - 0.005, 0.535, 0.17, 0.085, 0.03, bevel=0.008), pl)
    for x in (-0.46, 0.46):
        C.add(box_at(x, 2.84, -1.455, 0.17, 0.085, 0.03, bevel=0.008), pl)

    # glazing (single sided, facing outwards: invisible from the driver's seat, reflective from outside)
    gl = M['glass']

    def side_x(y, bulge_v=0.0):
        return lerp(0.640, 0.580, (y - 1.27) / 1.48) + 0.012 * math.sin(math.pi * bulge_v)

    def windscreen(u, v):
        y = lerp(1.30, 2.735, v)
        half = lerp(0.60, 0.545, v)
        x = lerp(half, -half, u)
        return (x, y, glass_z(y) + 0.02 * math.sin(math.pi * u))       # slight wrap-around curvature
    def pane_seal(fn, nu, nv):
        """Rubber seal bead around a pane (follows the same parametric surface)."""
        pts = ([fn(i / nu, 0.0) for i in range(nu)] + [fn(1.0, j / nv) for j in range(nv)]
               + [fn(1.0 - i / nu, 1.0) for i in range(nu)] + [fn(0.0, 1.0 - j / nv) for j in range(nv)])
        C.add(sweep(pts, circle(0.010, 6), closed=True), M['rubber'], sharp=80)

    WS_UV, SIDE_UV = (0.004, 0.004, 0.496, 0.996), (0.504, 0.004, 0.996, 0.996)     # halves of glass_dirt.png
    C.add(surf(windscreen, 10, 6, flip=True, uv_rect=WS_UV), gl, uv='keep', sharp=80)
    pane_seal(windscreen, 10, 6)

    def rear_window(u, v):
        y = lerp(1.85, 2.735, v)
        half = lerp(0.612, 0.57, v)
        return (lerp(-half, half, u), y, lerp(-1.285, -1.235, v) - 0.015 * math.sin(math.pi * u))
    C.add(surf(rear_window, 8, 4, flip=True, uv_rect=SIDE_UV), gl, uv='keep', sharp=80)
    pane_seal(rear_window, 8, 4)

    for side in (1, -1):
        def door(u, v, side=side):
            z = lerp(0.435, -0.435, u) if side > 0 else lerp(-0.435, 0.435, u)
            yb = max(1.32, fender_y(z) + 0.035) if z < -0.30 else 1.32
            y = lerp(yb, 2.735, v)
            return (side * side_x(y, v), y, z)
        C.add(surf(door, 10, 6, uv_rect=SIDE_UV), gl, uv='keep', sharp=80)
        pane_seal(door, 10, 6)

        def quarter(u, v, side=side):
            z = lerp(-0.47, -1.245, u) if side > 0 else lerp(-1.245, -0.47, u)
            y = lerp(fender_y(z) + 0.035, 2.735, v)
            return (side * side_x(y, v), y, z)
        C.add(surf(quarter, 10, 5, uv_rect=SIDE_UV), gl, uv='keep', sharp=80)
        pane_seal(quarter, 10, 5)
        # lower front quarter glass beside the hood is part of the windscreen; add door seal + handle + hinges
        C.add(sweep([(side * 0.668, 1.36, -0.40), (side * 0.668, 1.62, -0.40)], rrect(0.022, 0.03, 0.008, 1),
                    up_hint=(1, 0, 0)), pl, sharp=50)
        C.add(tube([(side * 0.652, 1.50, -0.37), (side * 0.70, 1.50, -0.37), (side * 0.70, 1.78, -0.37), (side * 0.650, 1.78, -0.37)],
                   0.011, seg=8, fillet=0.03), M['bolt'], sharp=80)                                  # door grab handle
        for hy in (1.55, 2.45):
            C.add(box_at(side * 0.665, hy, -0.455, 0.03, 0.07, 0.05, bevel=0.008), pl)

    # ======================================================================
    # 5. Rear mudguards (painted, wrap the 0.88 m tyres), mud flaps, lamp pods
    # ======================================================================
    f_sec = [(0.585, 0.0), (0.80, 0.0), (1.04, 0.0), (1.12, -0.004), (1.165, -0.022), (1.19, -0.055), (1.198, -0.105)]
    th0, th1 = math.radians(74), math.radians(-60)

    def fender_fn(side):
        def fn(u, v):
            k = u * (len(f_sec) - 1)
            i = min(int(k), len(f_sec) - 2)
            t = k - i
            x = lerp(f_sec[i][0], f_sec[i + 1][0], t)
            dr = lerp(f_sec[i][1], f_sec[i + 1][1], t)
            th = lerp(th0, th1, v)
            r = FENDER_R + dr
            return (side * x, RW_Y + r * math.cos(th), RW_Z + r * math.sin(th))
        return fn
    C.add(surf(fender_fn(1), len(f_sec) - 1, 44, thickness=0.02), M['paint'], sharp=50)
    C.add(surf(fender_fn(-1), len(f_sec) - 1, 44, thickness=0.02, flip=True), M['paint'], sharp=50)
    for side in (1, -1):
        edge = [(side * 1.20, RW_Y + (FENDER_R - 0.115) * math.cos(lerp(th0, th1, k / 44)),
                 RW_Z + (FENDER_R - 0.115) * math.sin(lerp(th0, th1, k / 44))) for k in range(45)]
        # bolted flange where the mudguard meets the cab side
        for k in range(1, 9):
            th = lerp(th0, th1, k / 9.5)
            C.add(cyl(0.009, 0.008, seg=6), M['bolt'], m=T(side * 0.625, RW_Y + (FENDER_R + 0.003) * math.cos(th), RW_Z + (FENDER_R + 0.003) * math.sin(th))
                  @ RX(math.degrees(th)), sharp=30)
        C.add(sweep(edge, rrect(0.03, 0.022, 0.008, 1), up_hint=(0, 0, -1)), M['rubber'], sharp=60)   # rubber lip
        # inner filler between the mudguard and the cab side
        fill = [(RW_Y + (FENDER_R - 0.01) * math.cos(lerp(th0, th1, k / 32)), RW_Z + (FENDER_R - 0.01) * math.sin(lerp(th0, th1, k / 32)))
                for k in range(33)]
        fill = [(z, y) for y, z in fill] + [(RW_Z - 0.50, 1.05), (RW_Z + 0.60, 1.05)]
        C.add(prism(fill, 0.03, axis='x'), pl, m=T(side * 0.60, 0, 0))
        # mud flap
        y_end, z_end = RW_Y + FENDER_R * math.cos(th1), RW_Z + FENDER_R * math.sin(th1)
        C.add(box_at(side * 0.89, y_end - 0.19, z_end - 0.012, 0.56, 0.38, 0.012, bevel=0.003, rot=RX(6)), M['rubber'])
        # tail lamp pod on the mudguard (red lens lives in the Taillights node)
        C.add(box_at(side * 0.92, 1.615, -2.03, 0.27, 0.115, 0.075, bevel=0.016, seg=2), pl)
        C.add(box_at(side * 0.92, 1.555, -2.01, 0.06, 0.05, 0.05, bevel=0.01), pl)
        C.add(box_at(side * 0.845, 1.615, -2.066, 0.075, 0.082, 0.012, bevel=0.004), M['indicator'], uv=0.06)
        r_ = 0.035                                                                                # round red reflector
        C.add(quad_uv((side * 1.10 + r_, 1.48 - r_, -2.085), (side * 1.10 - r_, 1.48 - r_, -2.085),
                      (side * 1.10 - r_, 1.48 + r_, -2.085), (side * 1.10 + r_, 1.48 + r_, -2.085), A['refl_red']),
              M['print'], uv='keep')
        C.add(box_at(side * 1.10, 1.48, -2.078, 0.085, 0.085, 0.012, bevel=0.004), pl)
        # grab rail on the mudguard top
        C.add(tube([(side * 1.02, fender_y(-0.95) - 0.01, -0.95), (side * 1.02, fender_y(-0.95) + 0.13, -0.98),
                    (side * 1.02, fender_y(-1.45) + 0.13, -1.42), (side * 1.02, fender_y(-1.45) - 0.01, -1.45)],
                   0.012, seg=8, fillet=0.04), M['bolt'], sharp=80)

    # ======================================================================
    # 6. Steps, fuel tank, battery box, air tanks, handrails
    # ======================================================================
    tank = box(0.30, 0.44, 0.84, bevel=0.07, seg=3)
    C.add(tank, pl, m=T(0.50, 0.90, 0.02))
    C.add(cyl(0.045, 0.04, seg=16, bevel=0.008), M['print'], m=T(0.56, 1.14, 0.30), uv=pal('black'))
    C.add(cyl(0.05, 0.012, seg=16), M['chrome'], m=T(0.56, 1.122, 0.30))
    C.add(quad_uv((0.652, 0.93, 0.23), (0.652, 0.93, 0.07), (0.652, 1.01, 0.07), (0.652, 1.01, 0.23), A['diesel']),
          M['decal'], uv='keep')
    C.add_sym(box_at(0.50, 0.70, 0.02, 0.05, 0.03, 0.80, bevel=0.008), M['bolt'])                   # tank strap base
    C.add(box_at(-0.50, 0.90, 0.10, 0.28, 0.40, 0.56, bevel=0.03, seg=2), ch)                       # battery / tool box
    C.add(box_at(-0.645, 0.98, 0.10, 0.012, 0.05, 0.10, bevel=0.004), M['bolt'])
    C.add(cyl(0.085, 0.50, seg=18, axis='z', bevel=0.03, bseg=2), ch, m=T(-0.47, 0.80, -0.50))      # air reservoir
    C.add_sym(box_at(0.47, 0.80, -0.52, 0.19, 0.03, 0.04, bevel=0.006), M['bolt'])
    for side in (1, -1):
        for a_z in (-0.21, 0.25):
            C.add(sweep([(side * 0.685, 1.24, a_z), (side * 0.73, 1.06, a_z), (side * 0.80, 0.44, a_z)],
                        rrect(0.045, 0.012, 0.003, 1), up_hint=(0, 0, 1)), ch, sharp=50)
        for k, (y, x) in enumerate(((0.46, 0.905), (0.74, 0.865), (1.02, 0.83))):
            C.add(box_at(side * x, y, 0.02, 0.23, 0.028, 0.46, bevel=0.006), M['checker'])
            C.add(box_at(side * (x + 0.118), y + 0.008, 0.02, 0.012, 0.05, 0.47, bevel=0.004), ch)
        # A-pillar grab rail
        C.add(tube([(side * 0.672, 1.50, 0.45), (side * 0.72, 1.52, 0.47), (side * 0.685, 2.28, 0.355), (side * 0.632, 2.30, 0.345)],
                   0.012, seg=8, fillet=0.04), M['bolt'], sharp=80)

    # ======================================================================
    # 7. Exhaust (right A-pillar) and air intake with pre-cleaner (left A-pillar)
    # ======================================================================
    ex, ez = -0.76, 0.62
    C.add(tube([(-0.40, 1.22, 0.74), (-0.60, 1.22, 0.70), (ex, 1.26, ez), (ex, 1.40, ez)], 0.045, seg=12, fillet=0.07),
          M['exhaust'], uv=('flat', (0.5, 0.03)), sharp=70)
    C.add(lathe([(0.0, 1.36), (0.06, 1.36), (0.088, 1.40), (0.088, 2.02), (0.06, 2.07), (0.043, 2.08), (0.043, 2.66)],
                seg=24, do_recalc=True, uv_reps=1), M['exhaust'], m=T(ex, 0, ez), uv='keep')
    for y in (1.44, 2.00):                                                                             # silencer clamp bands
        C.add(lathe([(0.091, y - 0.012), (0.091, y + 0.012)], seg=24, do_recalc=False), M['bolt'], m=T(ex, 0, ez), sharp=60)
    C.add(tube([(ex, 2.64, ez), (ex, 2.72, ez), (ex - 0.005, 2.79, ez - 0.035)], 0.043, seg=14, fillet=0.05, caps=False),
          M['exhaust'], uv=('flat', (0.5, 0.97)), sharp=70)
    C.add(tube([(ex, 2.70, ez), (ex - 0.005, 2.785, ez - 0.032)], 0.036, seg=12, caps=True), M['rubber'], sharp=70)   # dark bore
    C.add(lathe([(0.108, 1.46), (0.108, 1.98)], seg=16, do_recalc=False, sweep_deg=250, start_deg=55), M['mesh'],
          m=T(ex, 0, ez), uv=0.08, sharp=60)                                                          # heat shield
    for y in (1.46, 1.72, 1.98):
        C.add(lathe([(0.112, y - 0.012), (0.112, y + 0.012)], seg=16, do_recalc=False, sweep_deg=250, start_deg=55),
              M['bolt'], m=T(ex, 0, ez), sharp=60)
    C.add(box_at(-0.64, 1.60, 0.60, 0.16, 0.03, 0.05, bevel=0.008), M['bolt'])
    C.add(box_at(-0.655, 2.30, 0.50, 0.12, 0.03, 0.04, bevel=0.008), M['bolt'])
    ix, iz = 0.74, 0.62
    C.add(tube([(0.45, 1.36, 0.80), (0.62, 1.38, 0.72), (ix, 1.46, iz), (ix, 2.26, iz)], 0.042, seg=12, fillet=0.07), pl, sharp=70)
    C.add(lathe([(0.0, 2.24), (0.05, 2.24), (0.09, 2.265), (0.092, 2.36), (0.078, 2.40), (0.045, 2.425), (0.0, 2.43)], seg=20, do_recalc=True),
          pl, m=T(ix, 0, iz))                                                                           # pre-cleaner cap
    for k in range(10):
        a = 2 * math.pi * k / 10
        C.add(box_at(ix + 0.093 * math.cos(a), 2.31, iz + 0.093 * math.sin(a), 0.006, 0.07, 0.022, rot=RY(-math.degrees(a))), M['rubber'], sharp=30)
    C.add(box_at(0.655, 2.10, 0.50, 0.12, 0.03, 0.04, bevel=0.008), M['bolt'])

    # ======================================================================
    # 8. Mirrors, wipers, position lamps
    # ======================================================================
    for side in (1, -1):
        C.add(tube([(side * 0.60, 2.52, 0.30), (side * 0.93, 2.52, 0.37), (side * 0.93, 2.02, 0.37), (side * 0.62, 1.98, 0.40)],
                   0.013, seg=8, fillet=0.05), pl, sharp=80)
        head = box(0.20, 0.38, 0.075, bevel=0.03, seg=3)
        mm = T(side * 0.985, 2.29, 0.385) @ RY(side * 14)
        C.add(head, pl, m=mm)
        C.add(quad_uv((0.085, -0.17, -0.0385), (-0.085, -0.17, -0.0385), (-0.085, 0.17, -0.0385), (0.085, 0.17, -0.0385)),
              M['mirror'], m=mm, uv='keep')
        C.add(box_at(side * 0.93, 2.29, 0.378, 0.03, 0.10, 0.03, bevel=0.008), pl)
        # front position lamp + indicator pod under the mirror arm
        C.add(box_at(side * 0.93, 1.95, 0.385, 0.15, 0.085, 0.06, bevel=0.014, seg=2), pl)
        C.add(box_at(side * 0.955, 1.95, 0.418, 0.075, 0.062, 0.01, bevel=0.003), M['indicator'], uv=0.06)
        C.add(box_at(side * 0.895, 1.95, 0.418, 0.04, 0.062, 0.01, bevel=0.003), M['lens_clear'])
    # front wiper parked low, rear wiper
    C.add(cyl(0.018, 0.03, seg=10, axis='z'), pl, m=T(0.02, 1.925, 0.405), sharp=50)
    C.add(tube([(0.02, 1.925, 0.415), (0.20, 1.955, glass_z(1.955) + 0.03), (0.42, 1.985, glass_z(1.985) + 0.022)], 0.006, seg=6),
          pl, sharp=80)
    C.add(box_at(0.26, 1.972, glass_z(1.972) + 0.016, 0.52, 0.016, 0.014, bevel=0.003, rot=RZ(4)), M['rubber'], sharp=30)
    C.add(cyl(0.016, 0.03, seg=10, axis='z'), pl, m=T(0.0, 1.90, -1.30), sharp=50)
    C.add(tube([(0.0, 1.90, -1.315), (0.30, 1.93, -1.30)], 0.005, seg=6), pl, sharp=80)
    C.add(box_at(0.16, 1.915, -1.302, 0.34, 0.014, 0.012, bevel=0.003, rot=RZ(5.5)), M['rubber'], sharp=30)

    # ======================================================================
    # 9. Rear: three-point hitch, PTO, hitch frame with clevis + pin, remotes
    # ======================================================================
    C.add(cyl(0.042, 0.74, seg=14, axis='x', bevel=0.008), ch, m=T(0, 1.24, -1.62))                 # rock shaft
    for side in (1, -1):
        C.add(sweep([(side * 0.31, 1.24, -1.62), (side * 0.345, 1.205, -1.90)], rrect(0.07, 0.035, 0.01, 1), up_hint=(0, 1, 0)), ch, sharp=50)
        C.add(sweep([(side * 0.27, 0.56, -1.58), (side * 0.33, 0.66, -1.90), (side * 0.40, 0.80, -2.19)],
                    rrect(0.075, 0.03, 0.008, 1), up_hint=(0, 1, 0)), ch, sharp=50)                  # lower link (raised)
        C.add(sphere(0.05, 12, 8), M['steel'], m=T(side * 0.405, 0.81, -2.21))
        C.add(torus(0.05, 0.016, 14, 6, axis='x'), ch, m=T(side * 0.405, 0.81, -2.21), sharp=80)
        C.add(cyl_between((side * 0.345, 1.20, -1.89), (side * 0.345, 0.70, -1.97), 0.016, seg=8), M['bolt'])   # lift rod
        C.add(cyl_between((side * 0.345, 1.02, -1.918), (side * 0.345, 0.86, -1.944), 0.028, seg=8), ch)         # turnbuckle
        C.add(cyl_between((side * 0.25, 0.74, -1.64), (side * 0.30, 0.98, -1.72), 0.04, seg=12, bevel=0.006), ch)   # lift cylinder
        C.add(cyl_between((side * 0.30, 0.98, -1.72), (side * 0.33, 1.20, -1.79), 0.02, seg=10), M['chrome'])
        C.add(cyl(0.02, 0.10, seg=8, axis='x'), M['bolt'], m=T(side * 0.27, 0.56, -1.58), sharp=60)
        # telescopic stabiliser from the lower link to the hitch frame
        C.add(cyl_between((side * 0.325, 0.655, -1.88), (side * 0.19, 0.60, -1.70), 0.013, seg=8), M['steel'])
        C.add(cyl_between((side * 0.29, 0.641, -1.833), (side * 0.215, 0.61, -1.733), 0.022, seg=8, bevel=0.004), ch)
    # cab suspension: rubber mounts in front, coil-over struts at the rear
    for side in (1, -1):
        C.add(cyl(0.05, 0.07, seg=14, bevel=0.01), M['rubber'], m=T(side * 0.52, 1.165, 0.30))
        C.add(box_at(side * 0.46, 1.11, 0.30, 0.22, 0.05, 0.14, bevel=0.012), ch)
        C.add(helix((side * 0.47, 0.99, -1.05), (side * 0.47, 1.20, -1.05), 0.042, 5.5, 0.008), M['print'], uv=pal('red'), sharp=80)
        C.add(cyl_between((side * 0.47, 0.96, -1.05), (side * 0.47, 1.22, -1.05), 0.018, seg=8), M['steel'])
        C.add(box_at(side * 0.42, 0.95, -1.05, 0.16, 0.04, 0.10, bevel=0.01), ch)
    # safety / service labels (fictional make)
    C.add(quad_uv((0.085, 0.905, -1.8102), (-0.085, 0.905, -1.8102), (-0.085, 1.02, -1.8102), (0.085, 1.02, -1.8102), A['label_pto']), M['print'], uv='keep')
    C.add(box_at(0, 0.96, -1.80, 0.19, 0.13, 0.016, bevel=0.003), ch)
    for side in (1, -1):
        z_a, z_b = (-0.56, -0.70) if side > 0 else (-0.70, -0.56)
        yy0 = fender_y(-0.63) + 0.022
        C.add(quad_uv((side * 1.06, yy0, z_a), (side * 1.06, yy0 - 0.012, z_b), (side * 0.94, yy0 - 0.012, z_b), (side * 0.94, yy0, z_a), A['label_tyre']),
              M['print'], uv='keep')
    px_, py_, pz_ = hood_side_point(0.86, hood_split_y(0.86) - 0.13, -1, 0.004)
    C.add(quad_uv((px_, py_ - 0.045, pz_ - 0.065), (px_, py_ - 0.045, pz_ + 0.065), (px_, py_ + 0.045, pz_ + 0.065), (px_, py_ + 0.045, pz_ - 0.065), A['label_hot']),
          M['print'], uv='keep')
    # top link stowed upright in its holder
    C.add(cyl_between((0.0, 1.10, -1.675), (0.0, 1.30, -1.70), 0.032, seg=12, bevel=0.006), ch)
    C.add(cyl_between((0.0, 1.30, -1.70), (0.0, 1.43, -1.716), 0.016, seg=8), M['bolt'])
    C.add(torus(0.028, 0.012, 12, 6, axis='x'), M['bolt'], m=T(0, 1.445, -1.718), sharp=80)
    C.add(box_at(0, 1.10, -1.655, 0.10, 0.10, 0.07, bevel=0.012), ch)
    # PTO stub + guard
    C.add(cyl(0.032, 0.14, seg=12, axis='z'), M['steel'], m=T(0, 0.80, -1.69), sharp=60)
    C.add(lathe([(0.105, 0.0), (0.105, 0.17), (0.095, 0.17), (0.095, 0.0)], seg=14, axis='z', do_recalc=True, sweep_deg=200, start_deg=170),
          M['print'], m=T(0, 0.80, -1.80), uv=pal('black'), sharp=60)
    # hitch frame, clevis coupling and pin at rearHitchOffset [0, 0.62, -2.02]
    C.add_sym(box_at(0.15, 0.80, -1.675, 0.05, 0.62, 0.07, bevel=0.012), ch)
    C.add(box_at(0, 0.62, -1.80, 0.24, 0.20, 0.22, bevel=0.03, seg=2), ch)
    for y in (0.555, 0.685):
        C.add(prism([(-0.075, -1.86), (0.075, -1.86), (0.075, -2.03), (0.045, -2.085), (-0.045, -2.085), (-0.075, -2.03)],
                    0.032, bevel=0.006, axis='y'), ch, m=T(0, y, 0))
    C.add(cyl(0.019, 0.26, seg=10), M['steel'], m=T(0, 0.64, -2.02), sharp=60)
    C.add(cyl(0.032, 0.02, seg=10), M['print'], m=T(0, 0.775, -2.02), uv=pal('red'), sharp=50)
    C.add(torus(0.026, 0.006, 12, 6, axis='z'), M['bolt'], m=T(0, 0.81, -2.02), sharp=80)
    # hydraulic remote block with four colour-coded couplers, trailer socket
    C.add(box_at(-0.36, 1.12, -1.655, 0.30, 0.13, 0.10, bevel=0.015), ch)
    for k, cname in enumerate(('blue', 'red', 'yellow', 'green')):
        x = -0.47 + k * 0.072
        C.add(cyl(0.021, 0.07, seg=10, axis='z'), M['steel'], m=T(x, 1.12, -1.73), sharp=60)
        C.add(cyl(0.026, 0.022, seg=10, axis='z', bevel=0.004), M['print'], m=T(x, 1.12, -1.772), uv=pal(cname), sharp=50)
    C.add(cyl(0.034, 0.06, seg=12, axis='z', bevel=0.006), pl, m=T(0.36, 1.12, -1.70))               # 7-pin socket
    C.add(box_at(0.36, 1.12, -1.655, 0.11, 0.10, 0.05, bevel=0.01), ch)
    C.add_sym(box_at(0.22, 0.95, -1.66, 0.04, 0.34, 0.04, bevel=0.008), ch)
    # hydraulic hoses from the valve block down to the lift cylinders
    for k, (x0, x1) in enumerate(((-0.42, -0.25), (-0.30, 0.25))):
        C.add(tube(catmull([(x0, 1.06, -1.66), (x0 * 0.9, 0.95, -1.74), (x1 * 1.05, 0.82, -1.72), (x1, 0.76, -1.655)], sub=4), 0.011, seg=6),
              M['rubber'], sharp=80)

    # ======================================================================
    # 10. Cab interior (foreground of the cabin camera)
    # ======================================================================
    tr = M['trim']
    # fixed dashboard: tall centre section + lower wings so the front wheels stay visible
    dash_c = [(0.412, 1.27), (0.412, 1.60), (0.372, 1.892), (0.30, 1.898), (0.225, 1.85), (0.205, 1.60), (0.25, 1.27)]
    C.add(prism(dash_c, 0.60, bevel=0.012, seg=2, axis='x'), tr)
    dash_w = [(0.43, 1.27), (0.428, 1.56), (0.36, 1.60), (0.27, 1.585), (0.25, 1.50), (0.27, 1.27)]
    C.add(prism(dash_w, 1.20, bevel=0.012, seg=2, axis='x'), tr)
    # air vents + switch row
    for x in (-0.47, 0.47, -0.21, 0.21):
        C.add(box_at(x, 1.555, 0.262, 0.11, 0.045, 0.012, bevel=0.004, rot=RX(-18)), M['rubber'])
        for k in range(3):
            C.add(box_at(x, 1.543 + k * 0.012, 0.257, 0.10, 0.003, 0.012, rot=RX(-18)), M['bolt'], sharp=30)
    C.add(quad_uv((0.50, 1.40, 0.2565), (0.20, 1.40, 0.2565), (0.20, 1.505, 0.2485), (0.50, 1.505, 0.2485), A['switches']),
          M['display'], uv='keep')
    C.add(cyl(0.016, 0.02, seg=10, axis='z'), M['chrome'], m=T(-0.23, 1.45, 0.25), sharp=50)         # ignition key
    C.add(box_at(-0.23, 1.45, 0.232, 0.01, 0.03, 0.02, bevel=0.003), M['rubber'])

    # steering column frame: origin = steeringWheelOrigin, local +Z runs DOWN the column (away from the driver)
    COL = T(0.0, 1.88, -0.02) @ RX(32)
    C.add(sweep([(0, 0, 0.035), (0, 0, 0.46)], rrect(0.105, 0.115, 0.03, 2), up_hint=(0, 1, 0)), tr, m=COL, sharp=45)
    C.add(cyl(0.03, 0.05, seg=12, axis='z'), M['bolt'], m=COL @ T(0, 0, 0.02), sharp=50)
    # instrument pod riding on the column, read through the upper half of the steering wheel
    pod = box(0.42, 0.20, 0.065, bevel=0.03, seg=3)
    C.add(pod, tr, m=COL @ T(0, 0.082, 0.135))
    C.add(prism([(-0.21, 0.165), (0.21, 0.165), (0.20, 0.185), (-0.20, 0.185)], 0.07, bevel=0.006, axis='z'), tr,
          m=COL @ T(0, 0, 0.085))                                                                    # glare hood
    cz = 0.135 - 0.0335
    C.add(quad_uv((0.185, 0.001, cz), (-0.185, 0.001, cz), (-0.185, 0.163, cz), (0.185, 0.163, cz), A['cluster']),
          M['display'], m=COL, uv='keep')
    # column stalks: shuttle lever (left), indicator stalk (right)
    for side, cname in ((1, 'orange'), (-1, 'black')):
        C.add(tube([(side * 0.05, 0.0, 0.09), (side * 0.17, 0.02, 0.06)], 0.007, seg=6), M['rubber'], m=COL, sharp=80)
        C.add(box(0.03, 0.02, 0.045, bevel=0.007), M['print'], m=COL @ T(side * 0.185, 0.022, 0.056), uv=pal(cname))

    # pedals
    for x, w, cname in ((0.20, 0.075, None), (-0.11, 0.06, None), (-0.185, 0.06, None), (-0.30, 0.055, 'orange')):
        C.add(box(w, 0.012, 0.10, bevel=0.004), M['rubber'], m=T(x, 1.385, 0.215) @ RX(-38))
        C.add(cyl_between((x, 1.39, 0.225), (x, 1.56, 0.33), 0.008, seg=6), M['bolt'], sharp=80)
    C.add(box_at(-0.145, 1.395, 0.212, 0.03, 0.006, 0.03, rot=RX(-38)), M['bolt'])                   # brake pedal latch

    # terminal on the right A-pillar, angled at the driver
    TM = T(-0.43, 1.99, 0.10) @ RY(-32) @ RX(17)
    C.add(box(0.245, 0.185, 0.035, bevel=0.012, seg=2), tr, m=TM)
    C.add(quad_uv((0.108, -0.076, -0.0185), (-0.108, -0.076, -0.0185), (-0.108, 0.076, -0.0185), (0.108, 0.076, -0.0185),
                  A['terminal']), M['display'], m=TM, uv='keep')
    C.add(tube([(-0.43, 1.99, 0.12), (-0.50, 1.96, 0.26), (-0.585, 1.93, 0.36)], 0.012, seg=8, fillet=0.04), M['rubber'], sharp=80)

    # right-hand console: armrest, button panel, joystick, hydraulic levers, small screen
    C.add(box_at(-0.455, 1.50, -0.66, 0.23, 0.44, 0.84, bevel=0.035, seg=2), tr)
    C.add(box_at(-0.44, 1.745, -0.82, 0.13, 0.05, 0.40, bevel=0.022, seg=2), M['seat'], uv=0.3)       # armrest pad
    C.add(quad_uv((-0.365, 1.722, -0.585), (-0.545, 1.722, -0.585), (-0.545, 1.722, -0.375), (-0.365, 1.722, -0.375),
                  A['console']), M['display'], uv='keep')
    C.add(cyl_between((-0.40, 1.72, -0.31), (-0.40, 1.80, -0.295), 0.012, seg=8), M['rubber'], sharp=80)
    C.add(box(0.045, 0.085, 0.05, bevel=0.016, seg=2), tr, m=T(-0.40, 1.84, -0.29) @ RX(12))          # joystick grip
    C.add(box(0.03, 0.012, 0.02, bevel=0.004), M['print'], m=T(-0.40, 1.868, -0.312) @ RX(12), uv=pal('orange'))
    for k, cname in enumerate(('blue', 'red', 'yellow', 'green')):
        x = -0.475 - k * 0.028
        C.add(cyl_between((x, 1.72, -0.30), (x, 1.79, -0.285), 0.006, seg=6), M['bolt'], sharp=80)
        C.add(sphere(0.015, 10, 6), M['print'], m=T(x, 1.80, -0.283), uv=pal(cname))
    SM = T(-0.455, 1.775, -0.225) @ RX(48)
    C.add(box(0.19, 0.095, 0.03, bevel=0.01), tr, m=SM)
    C.add(quad_uv((0.085, -0.037, -0.0155), (-0.085, -0.037, -0.0155), (-0.085, 0.037, -0.0155), (0.085, 0.037, -0.0155),
                  A['screen_small']), M['display'], m=SM, uv='keep')
    C.add(cyl_between((-0.455, 1.70, -0.25), (-0.455, 1.765, -0.235), 0.014, seg=8), M['rubber'], sharp=80)
    # left side: storage shelf, fire extinguisher, hand brake lever
    C.add(box_at(0.47, 1.42, -0.80, 0.20, 0.28, 0.56, bevel=0.03, seg=2), tr)
    C.add(cyl(0.05, 0.30, seg=14, bevel=0.012), M['print'], m=T(0.47, 1.72, -0.98), uv=pal('red'))
    C.add(cyl(0.022, 0.07, seg=10), M['rubber'], m=T(0.47, 1.90, -0.98), sharp=50)
    C.add(cyl_between((0.40, 1.55, -0.56), (0.40, 1.78, -0.44), 0.011, seg=8), M['bolt'], sharp=80)
    C.add(cyl_between((0.40, 1.74, -0.46), (0.40, 1.83, -0.415), 0.018, seg=10, bevel=0.004), M['rubber'], sharp=60)

    # driver seat (air suspended) behind the camera eye
    sz = -0.64
    C.add(box_at(0, CAB_FLOOR + 0.035, sz, 0.44, 0.05, 0.44, bevel=0.012), M['bolt'])
    bellows = lathe([(0.15, 0.0), (0.17, 0.02), (0.15, 0.04), (0.17, 0.06), (0.15, 0.08), (0.17, 0.10), (0.15, 0.12), (0.17, 0.14), (0.15, 0.16)],
                    seg=4, do_recalc=False)
    xf(bellows, RY(45))
    C.add(bellows, M['rubber'], m=T(0, CAB_FLOOR + 0.06, sz), sharp=80)
    C.add(box_at(0, CAB_FLOOR + 0.24, sz, 0.50, 0.04, 0.48, bevel=0.014), tr)
    cushion = box(0.50, 0.115, 0.48, bevel=0.045, seg=3)
    deform(cushion, lambda c: (c.x, c.y + 0.03 * smoothstep(0.08, 0.24, c.z) + 0.018 * smoothstep(0.14, 0.25, abs(c.x)), c.z))
    C.add(cushion, M['seat'], m=T(0, CAB_FLOOR + 0.315, sz + 0.02), sharp=60)
    C.add(box_at(0, CAB_FLOOR + 0.372, sz + 0.0, 0.30, 0.012, 0.34, bevel=0.005), M['seat_accent'])
    BK = T(0, 1.93, sz - 0.245) @ RX(-11)
    back = box(0.48, 0.60, 0.11, bevel=0.048, seg=3)
    deform(back, lambda c: (c.x * (1.0 - 0.12 * smoothstep(0.05, 0.30, c.y)), c.y, c.z + 0.03 * smoothstep(0.13, 0.24, abs(c.x))))
    C.add(back, M['seat'], m=BK, sharp=60)
    C.add(box(0.28, 0.44, 0.012, bevel=0.005), M['seat_accent'], m=BK @ T(0, -0.02, 0.058))
    C.add(box(0.27, 0.17, 0.09, bevel=0.04, seg=3), M['seat'], m=T(0, 2.325, sz - 0.325) @ RX(-8), sharp=60)
    C.add_sym(cyl_between((0.07, 2.18, sz - 0.30), (0.07, 2.27, sz - 0.315), 0.008, seg=6), M['chrome'], sharp=80)
    C.add_sym(box(0.065, 0.05, 0.33, bevel=0.02, seg=2), M['seat'], m=T(0.285, 1.83, sz - 0.03))       # armrests
    C.add_sym(cyl_between((0.285, 1.81, sz - 0.18), (0.27, 1.70, sz - 0.21), 0.012, seg=6), M['bolt'], sharp=80)
    # seat belt buckle + reel
    C.add(box_at(-0.27, 1.66, sz - 0.10, 0.03, 0.07, 0.045, bevel=0.008), M['print'], uv=pal('red'))
    C.add(box_at(0.285, 1.50, sz - 0.22, 0.05, 0.10, 0.10, bevel=0.012), tr)
    # piping along the seat panels
    y_c = CAB_FLOOR + 0.378
    C.add(sweep([(px, y_c + 0.018 * smoothstep(0.14, 0.25, abs(px)), sz + 0.02 + pz) for px, pz in rrect(0.43, 0.41, 0.07, 3)],
                circle(0.006, 5), closed=True), M['seat_accent'], sharp=80)
    C.add(sweep([(px, py, 0.060) for px, py in rrect(0.40, 0.52, 0.07, 3)], circle(0.006, 5), closed=True), M['seat_accent'], m=BK, sharp=80)
    # console switchgear: rotary knobs, hand throttle in its slot, raised keys
    for kx in (-0.40, -0.50):
        C.add(lathe([(0.0, 0.022), (0.016, 0.022), (0.021, 0.016), (0.022, 0.0)], seg=14, do_recalc=False), tr, m=T(kx, 1.722, -0.63), sharp=50)
        C.add(box_at(kx, 1.745, -0.622, 0.004, 0.003, 0.014), M['print'], uv=pal('white'))
    C.add(box_at(-0.545, 1.722, -0.50, 0.012, 0.004, 0.16), M['rubber'])
    C.add(cyl_between((-0.545, 1.72, -0.47), (-0.545, 1.775, -0.455), 0.006, seg=6), M['bolt'], sharp=80)
    C.add(box(0.03, 0.024, 0.02, bevel=0.007), M['print'], m=T(-0.545, 1.785, -0.452), uv=pal('orange'))
    for k in range(6):
        C.add(box_at(-0.385 - (k % 3) * 0.036, 1.726, -0.69 - (k // 3) * 0.036, 0.026, 0.008, 0.026, bevel=0.004), M['print'],
              uv=pal(('grey', 'grey', 'yellow', 'grey', 'red', 'grey')[k]))
    # left side: drinks bottle in a holder, first-aid box on the rear bulkhead, service card
    C.add(torus(0.042, 0.006, 16, 6), tr, m=T(0.47, 1.575, -0.62), sharp=80)
    C.add(cyl(0.036, 0.20, seg=14, bevel=0.008), M['print'], m=T(0.47, 1.66, -0.62), uv=pal('blue'))
    C.add(cyl(0.016, 0.03, seg=10), M['print'], m=T(0.47, 1.775, -0.62), uv=pal('white'), sharp=50)
    C.add(box_at(0.30, 1.58, -1.255, 0.24, 0.165, 0.06, bevel=0.012), M['print'], uv=pal('green'))
    C.add(quad_uv((0.19, 1.505, -1.2245), (0.41, 1.505, -1.2245), (0.41, 1.655, -1.2245), (0.19, 1.655, -1.2245), A['firstaid']),
          M['print'], uv='keep')
    C.add(quad_uv((0.368, 1.33, -0.60), (0.368, 1.33, -0.96), (0.368, 1.54, -0.96), (0.368, 1.54, -0.60), A['label_service']), M['print'], uv='keep')

    # headliner, overhead console (radio + climate), sun visor, courtesy lamp, grab handle
    C.add(box_at(0, 2.725, -0.48, 1.16, 0.035, 1.56, bevel=0.012), M['headliner'])
    OH = T(0, 2.665, 0.075) @ RX(-52)
    C.add(box(0.86, 0.15, 0.10, bevel=0.025, seg=2), tr, m=OH)
    C.add(quad_uv((0.28, -0.062, -0.0505), (-0.28, -0.062, -0.0505), (-0.28, 0.062, -0.0505), (0.28, 0.062, -0.0505),
                  A['headliner']), M['display'], m=OH, uv='keep')
    for vx in (-0.37, 0.37):
        C.add(lathe([(0.040, 0.0), (0.040, 0.012), (0.030, 0.012), (0.030, 0.0)], seg=16, axis='z', do_recalc=True), M['rubber'],
              m=OH @ T(vx, 0.0, -0.058), sharp=50)
        for k in range(3):
            C.add(box(0.056, 0.004, 0.012), M['bolt'], m=OH @ T(vx, -0.016 + k * 0.016, -0.054) @ RX(25), sharp=30)
    C.add(cyl(0.022, 0.92, seg=10, axis='x'), M['headliner'], m=T(0, 2.688, 0.215), sharp=50)         # roller sun blind
    C.add(box_at(0, 2.704, -0.55, 0.16, 0.012, 0.09, bevel=0.005), M['lens_clear'])
    C.add_sym(tube([(0.52, 2.705, -0.20), (0.52, 2.66, -0.22), (0.52, 2.66, -0.36), (0.52, 2.705, -0.38)], 0.009, seg=6, fillet=0.02),
              M['rubber'], sharp=80)
    # interior pillar / B-post trims carrying the seat belt and a coat hook
    C.add_sym(box_at(0.60, 2.05, -0.45, 0.03, 0.9, 0.07, bevel=0.01), tr)

    chassis_obj = C.build(col)

    # ======================================================================
    # 11. Wheels
    # ======================================================================
    wm = {'tyre': M['tyre'], 'rim': M['rim'], 'hub': M['chassis'], 'bolt': M['rim']}      # nuts painted with the rim
    wp = TRACTOR_SPECS["wheelPositions"]
    rf, rr = TRACTOR_SPECS["frontWheelRadius"], TRACTOR_SPECS["rearWheelRadius"]
    wheel_fl = build_wheel("Wheel_FL", col, wp["FL"], rf, 0.42, True, wm, style='front')
    wheel_fr = build_wheel("Wheel_FR", col, wp["FR"], rf, 0.42, False, wm, style='front')
    wheel_rl = build_wheel("Wheel_RL", col, wp["RL"], rr, 0.58, True, wm, style='rear')
    wheel_rr = build_wheel("Wheel_RR", col, wp["RR"], rr, 0.58, False, wm, style='rear')

    # ======================================================================
    # 12. Front mudguards (follow the steering; runtime parents them to the steer pivots)
    # ======================================================================
    fenders = []
    for side, nm in ((1, "FrontFender_L"), (-1, "FrontFender_R")):
        F = Node(nm, location=wp["FL"] if side > 0 else wp["FR"], dirt_fn=front_fender_dirt)
        sec = [(0.655, -0.06), (0.675, -0.012), (0.72, 0.0), (1.05, 0.0), (1.095, -0.012), (1.115, -0.06)]
        a0, a1 = math.radians(52), math.radians(-66)

        def ffn(u, v, side=side, sec=sec, a0=a0, a1=a1):
            k = u * (len(sec) - 1)
            i = min(int(k), len(sec) - 2)
            t = k - i
            x = lerp(sec[i][0], sec[i + 1][0], t)
            r = 0.665 + lerp(sec[i][1], sec[i + 1][1], t)
            th = lerp(a0, a1, v)
            return (side * x, FW_Y + r * math.cos(th), FW_Z + r * math.sin(th))
        F.add(surf(ffn, len(sec) - 1, 18, thickness=0.014, flip=(side < 0)), M['plastic'], sharp=50)
        F.add(tube([(side * 0.675, FW_Y + 0.02, FW_Z), (side * 0.66, FW_Y + 0.40, FW_Z - 0.02), (side * 0.72, FW_Y + 0.655, FW_Z - 0.02),
                    (side * 1.0, FW_Y + 0.655, FW_Z - 0.02)], 0.016, seg=8, fillet=0.05), M['chassis'], sharp=80)
        y_e, z_e = FW_Y + 0.665 * math.cos(a1), FW_Z + 0.665 * math.sin(a1)
        F.add(box_at(side * 0.885, y_e - 0.10, z_e - 0.008, 0.40, 0.20, 0.01, bevel=0.003, rot=RX(10)), M['plastic'])
        # steering knuckle parts that turn with the wheel: hub carrier, steering arm with ball joint, brake hose
        F.add(cyl(0.12, 0.10, seg=20, axis='x', bevel=0.015), M['chassis'], m=T(side * 0.71, FW_Y, FW_Z))
        ax_, ay_, az_ = TRACTOR_SPECS["steerArmEnds"][0]
        F.add(sweep([(side * 0.70, ay_, FW_Z - 0.05), (side * ax_, ay_, az_)], rrect(0.045, 0.06, 0.012, 1), up_hint=(0, 1, 0)), M['chassis'], sharp=50)
        F.add(cyl(0.022, 0.07, seg=10), M['chassis'], m=T(side * ax_, ay_, az_), sharp=60)
        F.add(tube([(side * 0.70, FW_Y + 0.10, FW_Z + 0.06), (side * 0.66, FW_Y + 0.24, FW_Z + 0.10), (side * 0.62, FW_Y + 0.30, FW_Z + 0.02)], 0.008, seg=5, fillet=0.04),
              M['plastic'], sharp=80)
        fenders.append(F.build(col))

    # ======================================================================
    # 12b. Swinging front axle (FrontAxle node: runtime rolls it around the centre pivot and hangs the steer
    #      pivots on it) and the tie rod / steering cylinder rod (TieRod node: runtime fits it between the arms)
    # ======================================================================
    ax_loc = Vector(TRACTOR_SPECS["frontAxlePivot"])
    AX = Node("FrontAxle", location=ax_loc, dirt_fn=lambda p_, n_, m_: chassis_dirt(p_ + ax_loc, n_, m_))
    chm = M['chassis']
    AX.add(box_at(0, FW_Y, FW_Z, 1.30, 0.15, 0.17, bevel=0.035, seg=2), chm)
    AX.add(lathe([(0.0, -0.20), (0.12, -0.20), (0.20, -0.10), (0.215, 0.0), (0.20, 0.10), (0.12, 0.17), (0.0, 0.17)],
                 seg=28, axis='z', do_recalc=True), chm, m=T(0, FW_Y, FW_Z))
    for k in range(10):
        a = 2 * math.pi * k / 10
        AX.add(cyl(0.011, 0.02, seg=6, axis='z'), M['bolt'], m=T(0.16 * math.cos(a), FW_Y + 0.16 * math.sin(a), FW_Z + 0.15), sharp=30)
    AX.add(box_at(0, 0.685, FW_Z, 0.20, 0.10, 0.22, bevel=0.02), chm)                        # pivot boss
    for side in (1, -1):
        AX.add(cyl(0.105, 0.34, seg=24, axis='y', bevel=0.02), chm, m=T(side * 0.665, FW_Y, FW_Z))         # swivel housing
        for yy_ in (FW_Y + 0.178, FW_Y - 0.178):                                                           # king pin caps
            AX.add(cyl(0.05, 0.02, seg=14, bevel=0.005), M['steel'], m=T(side * 0.665, yy_, FW_Z))
            for k in range(4):
                a = 2 * math.pi * (k + 0.5) / 4
                AX.add(cyl(0.008, 0.012, seg=6), M['bolt'], m=T(side * 0.665 + 0.036 * math.cos(a), yy_ + (0.012 if yy_ > FW_Y else -0.012), FW_Z + 0.036 * math.sin(a)), sharp=30)
        AX.add(box_at(side * 0.44, FW_Y + 0.085, FW_Z, 0.26, 0.03, 0.10, bevel=0.008), chm)                  # reinforcing rib
        AX.add(tube([(side * 0.10, 0.66, FW_Z - 0.10), (side * 0.30, 0.665, FW_Z - 0.09), (side * 0.60, 0.70, FW_Z - 0.06)], 0.007, seg=5, fillet=0.05),
               M['steel'], sharp=80)                                                                       # brake / diff-lock line
    # steering cylinder body (double rod) bolted behind the beam
    AX.add(cyl(0.04, 0.50, seg=16, axis='x', bevel=0.006), chm, m=T(0, 0.60, 1.215))
    AX.add_sym(cyl(0.046, 0.03, seg=16, axis='x', bevel=0.004), M['bolt'], m=T(0.25, 0.60, 1.215))
    AX.add_sym(box_at(0.16, 0.60, 1.28, 0.05, 0.07, 0.12, bevel=0.01), chm)
    AX.add_sym(tube([(0.12, 0.64, 1.215), (0.12, 0.70, 1.26), (0.04, 0.74, 1.34)], 0.007, seg=5, fillet=0.03), M['bolt'], sharp=80)
    axle_obj = AX.build(col)

    tr_len = 2.0 * TRACTOR_SPECS["steerArmEnds"][0][0]
    TRN = Node("TieRod", location=(0.0, 0.60, 1.215), local=True, dirt_fn=lambda p_, n_, m_: 0.45)
    TRN.add(cyl(0.017, tr_len - 0.10, seg=12, axis='x'), M['bolt'], sharp=60)
    for side in (1, -1):
        TRN.add(sphere(0.03, 12, 8), M['steel'], m=T(side * tr_len * 0.5, 0, 0))
        TRN.add(lathe([(0.020, 0.0), (0.034, 0.02), (0.022, 0.04), (0.034, 0.06), (0.020, 0.08)], seg=12, axis='x', do_recalc=False), M['plastic'],
                m=T(side * (tr_len * 0.5 - 0.11), 0, 0) if side > 0 else T(side * (tr_len * 0.5 - 0.03), 0, 0), sharp=80)
        TRN.add(cyl(0.024, 0.05, seg=6, axis='x', bevel=0.004), M['bolt'], m=T(side * (tr_len * 0.5 - 0.15), 0, 0), sharp=30)
    tierod_obj = TRN.build(col)

    # ======================================================================
    # 13. Steering wheel (child of the tilted SteeringPivot, spins around local Z)
    # ======================================================================
    sw_pivot = bpy.data.objects.new("SteeringPivot", None)
    sw_pivot.location = gl_to_bl(*TRACTOR_SPECS["steeringWheelOrigin"])
    sw_pivot.rotation_euler = (math.radians(32.0), 0.0, 0.0)
    col.objects.link(sw_pivot)
    SW = Node("SteeringWheel", local=True)
    rim_r = 0.205
    SW.add(torus(rim_r, 0.017, 40, 10, axis='z'), M['seat'], uv=0.3, sharp=80)
    for a_deg in (198, 342, 270):
        a = math.radians(a_deg)
        tip = (rim_r * math.cos(a), rim_r * math.sin(a), 0.0)
        root = (0.045 * math.cos(a), 0.045 * math.sin(a), 0.045)
        SW.add(sweep([root, tuple(lerp(root[i], tip[i], 0.55) + (0.01 if i == 2 else 0) for i in range(3)), tip],
                     rrect(0.034, 0.016, 0.006, 1), up_hint=(0, 0, 1)), M['trim'], sharp=60)
    SW.add(lathe([(0.0, -0.012), (0.045, -0.012), (0.066, 0.0), (0.07, 0.03), (0.05, 0.06), (0.0, 0.06)], seg=24, axis='z',
                 do_recalc=True), M['trim'], sharp=45)
    e = 0.038
    SW.add(quad_uv((e, -e, -0.0128), (-e, -e, -0.0128), (-e, e, -0.0128), (e, e, -0.0128), A['emblem']), M['decal'], uv='keep')
    # spinner knob
    ka = math.radians(118)
    SW.add(cyl(0.012, 0.03, seg=8, axis='z'), M['bolt'], m=T(rim_r * math.cos(ka), rim_r * math.sin(ka), -0.028), sharp=50)
    SW.add(sphere(0.024, 12, 8), M['trim'], m=T(rim_r * math.cos(ka), rim_r * math.sin(ka), -0.055))
    sw_obj = SW.build(col, parent=sw_pivot)

    # ======================================================================
    # 14. Beacon (whole node spins; amber dome + bulb pulse at runtime)
    # ======================================================================
    B = Node("Beacon", location=TRACTOR_SPECS["beaconOffset"], local=True)
    B.add(lathe([(0.0, -0.105), (0.05, -0.105), (0.05, -0.088), (0.074, -0.082), (0.074, -0.045), (0.066, -0.035), (0.0, -0.035)],
                seg=24, do_recalc=True), M['plastic'], sharp=45)
    B.add(lathe([(0.066, -0.036), (0.067, 0.05), (0.062, 0.078), (0.045, 0.098), (0.02, 0.108), (0.0, 0.11)], seg=28, do_recalc=False,
                uv_reps=6), M['beacon'], uv='keep', sharp=70)
    B.add(surf(lambda u, v: (0.045 * math.sin((u - 0.5) * 2.2), -0.02 + 0.085 * v,
                             -0.018 - 0.03 * math.cos((u - 0.5) * 2.2) + 0.03 * (v - 0.5) ** 2), 6, 4, thickness=0.004),
          M['chrome'], sharp=60)
    B.add(sphere(0.016, 10, 6), M['beacon_bulb'], m=T(0, 0.022, 0.006))
    B.add(cyl(0.012, 0.03, seg=8), M['bolt'], m=T(0, -0.012, 0.006), sharp=50)
    beacon_obj = B.build(col)

    # ======================================================================
    # 15. Light emitting faces
    # ======================================================================
    H = Node("Headlights")
    hm = M['headlight']
    for side in (1, -1):
        cx = side * 0.26
        for dx in (-0.048, 0.048):                                    # twin LED projectors per nose lamp
            H.add(lathe([(0.0, 0.012), (0.022, 0.010), (0.034, 0.0)], seg=16, axis='z', do_recalc=False), hm,
                  m=T(cx + dx, 1.478, nose_z + 0.022), sharp=60)
        H.add(box_at(cx, 1.428, nose_z + 0.028, 0.17, 0.008, 0.006), hm)      # daytime running strip
    for x in (-0.50, -0.26, 0.26, 0.50):
        H.add(box_at(x, visor_y - 0.005, 0.552, 0.145, 0.062, 0.006, bevel=0.002), hm)
    for x in (-0.46, 0.46):
        H.add(box_at(x, 2.84, -1.472, 0.145, 0.062, 0.006, bevel=0.002), hm)
    headlights_obj = H.build(col)

    TL = Node("Taillights")
    for side in (1, -1):
        TL.add(box_at(side * 0.965, 1.615, -2.066, 0.13, 0.082, 0.012, bevel=0.004), M['taillight'], uv=0.06)
    taillights_obj = TL.build(col)

    # ======================================================================
    # 16. Live instrument overlays (runtime swaps the material for canvas textures showing the telemetry)
    # ======================================================================
    live = make_mat("Tractor_Live_Overlay", (0.0, 0.0, 0.0), rough=0.3, alpha=0.0)
    CL = Node("ClusterLive")
    CL.add(quad_uv((0.185, 0.001, cz - 0.0015), (-0.185, 0.001, cz - 0.0015), (-0.185, 0.163, cz - 0.0015), (0.185, 0.163, cz - 0.0015)),
           live, m=COL, uv='keep')
    TLV = Node("TerminalLive")
    TLV.add(quad_uv((0.108, -0.076, -0.0200), (-0.108, -0.076, -0.0200), (-0.108, 0.076, -0.0200), (0.108, 0.076, -0.0200)),
            live, m=TM, uv='keep')
    live_objs = [CL.build(col), TLV.build(col)]

    # ======================================================================
    # 17. Driver (work clothes, cap). Body is rigid; the arms are two-bone chains the runtime poses so the
    #     hands stay on the steering wheel. Hidden by the runtime when the camera sits at the cab eye point.
    # ======================================================================
    D = Node("Driver")
    dm = M['driver']
    blue, skin, capc, boot, hair = pal('workblue'), pal('skin'), pal('cap'), pal('boot'), pal('hair')
    spine = [  # (y, z, half width x, half depth z)
        (1.655, -0.735, 0.185, 0.130), (1.76, -0.750, 0.180, 0.125), (1.90, -0.745, 0.170, 0.115), (2.03, -0.715, 0.195, 0.120),
        (2.12, -0.690, 0.205, 0.105), (2.175, -0.675, 0.150, 0.085), (2.205, -0.668, 0.062, 0.060),
    ]
    rings_t = []
    for (y_, z_, hx, hz_) in spine:
        rings_t.append([(hx * math.cos(2 * math.pi * k / 16), y_, z_ + hz_ * math.sin(2 * math.pi * k / 16)) for k in range(16)])
    D.add(loft(rings_t, closed=True, cap0=True, cap1=True), dm, uv=blue, sharp=80)
    D.add(box_at(0, 2.035, -0.612, 0.012, 0.26, 0.012, bevel=0.003), dm, uv=pal('belt'))                     # jacket zip
    D.add(capsule((0, 2.19, -0.668), (0, 2.25, -0.662), 0.05, seg=10, cap_rings=2), dm, uv=skin, sharp=80)   # neck
    head = sphere(0.1, 16, 12)
    xf(head, T(0, 2.325, -0.655) @ SC(0.86, 1.10, 0.98))
    deform(head, lambda c: (c.x * (1.0 - 0.18 * clamp((2.30 - c.y) / 0.10)), c.y, c.z + 0.012 * clamp((2.30 - c.y) / 0.10)))   # jaw
    D.add(head, dm, uv=skin, sharp=80)
    D.add(box(0.026, 0.045, 0.032, bevel=0.011, seg=2), dm, m=T(0, 2.315, -0.560) @ RX(-12), uv=skin, sharp=80)   # nose
    D.add_sym(sphere(0.022, 8, 6, m=T(0.086, 2.325, -0.66) @ SC(0.45, 1.0, 0.75)), dm, uv=skin, sharp=80)        # ears
    D.add(sphere(0.092, 14, 10, m=T(0, 2.335, -0.672) @ SC(0.93, 1.0, 1.0)), dm, uv=hair, sharp=80)             # hair under the cap
    D.add(lathe([(0.0, 0.085), (0.05, 0.078), (0.082, 0.048), (0.093, 0.012), (0.094, 0.0)], seg=18, do_recalc=False), dm,
          m=T(0, 2.365, -0.66) @ SC(0.93, 1.0, 1.02), uv=capc, sharp=70)                                         # cap crown
    D.add(prism([(-0.075, 0.0), (0.075, 0.0), (0.060, 0.085), (0.0, 0.105), (-0.060, 0.085)], 0.008, bevel=0.003, axis='y'), dm,
          m=T(0, 2.368, -0.575) @ RX(8), uv=capc)                                                                # peak
    # work-jacket details that read through the rear window: collar, reflective piping, belt; face features
    trouser, yoke = pal('trouser'), pal('yoke')

    def torso_band(y_, grow, h_):
        """Ring band hugging the torso loft at height y_ (interpolated half axes, pushed out by `grow`)."""
        for (ya, za, hxa, hza), (yb_, zb_, hxb, hzb) in zip(spine, spine[1:]):
            if ya <= y_ <= yb_:
                t_ = (y_ - ya) / (yb_ - ya)
                zc_, hx_, hz_ = lerp(za, zb_, t_), lerp(hxa, hxb, t_) + grow, lerp(hza, hzb, t_) + grow
                break
        else:
            raise ValueError(f"torso band at y={y_} lies outside the driver's spine")
        rr = [[(hx_ * math.cos(2 * math.pi * k / 20), yy, zc_ + hz_ * math.sin(2 * math.pi * k / 20)) for k in range(20)]
              for yy in (y_ - h_ / 2, y_ + h_ / 2)]
        return loft(rr, closed=True)
    D.add(torso_band(1.965, 0.005, 0.022), dm, uv=pal('reflect'), sharp=80)          # reflective piping
    D.add(torso_band(1.712, 0.006, 0.040), dm, uv=pal('belt'), sharp=80)             # belt / jacket hem
    D.add(torus(0.066, 0.02, 18, 6), dm, m=T(0, 2.198, -0.672) @ SC(1.0, 1.0, 0.92), uv=yoke, sharp=80)   # collar
    D.add(prism([(-0.045, 0.0), (0.045, 0.0), (0.0, -0.07)], 0.006, axis='z'), dm, m=T(0, 2.19, -0.592) @ RX(-14),
          uv=pal('shirt'))                                                                                  # shirt V
    for side in (1, -1):
        D.add(sphere(0.0105, 8, 6, m=T(side * 0.031, 2.338, -0.567) @ SC(1.0, 0.8, 0.6)), dm, uv=pal('eye'), sharp=80)
        D.add(box(0.034, 0.008, 0.012, bevel=0.003), dm, m=T(side * 0.032, 2.357, -0.566) @ RZ(side * -8), uv=hair, sharp=80)
    D.add(box(0.036, 0.007, 0.010, bevel=0.003), dm, m=T(0, 2.272, -0.566), uv=pal('lip'), sharp=80)        # mouth
    D.add(sphere(0.011, 8, 6), dm, m=T(0, 2.452, -0.66), uv=capc, sharp=80)                                   # cap button
    for side in (1, -1):
        hip, knee, ankle = (side * 0.10, 1.70, -0.70), (side * 0.175, 1.765, -0.30), (side * 0.185, 1.40, -0.13)
        D.add(capsule(hip, knee, 0.088, 0.066, seg=12), dm, uv=trouser, sharp=80)
        D.add(capsule(knee, ankle, 0.062, 0.048, seg=12), dm, uv=trouser, sharp=80)
        D.add(sphere(0.07, 12, 8, m=T(side * 0.176, 1.762, -0.30) @ SC(1.0, 0.85, 1.0)), dm, uv=trouser, sharp=80)   # knee
        boot_bm = box(0.10, 0.105, 0.27, bevel=0.035, seg=2)
        deform(boot_bm, lambda c: (c.x, c.y - 0.02 * smoothstep(0.0, 0.13, c.z), c.z))
        D.add(boot_bm, dm, m=T(side * 0.185, CAB_FLOOR + 0.066, -0.055), uv=boot, sharp=60)
        D.add(capsule((side * 0.175, 2.12, -0.685), (side * 0.215, 2.13, -0.66), 0.06, 0.055, seg=10, cap_rings=2), dm, uv=blue, sharp=80)   # shoulder
    driver_objs = [D.build(col)]
    dspec = TRACTOR_SPECS["driver"]
    for side, tag in ((1, "L"), (-1, "R")):
        sh = dspec["shoulders"][0 if side > 0 else 1]
        UA = Node(f"DriverArm_{tag}_Upper", location=sh, local=True)
        UA.add(capsule((0, 0, 0), (0, -dspec["upperArm"], 0), 0.052, 0.043, seg=10), dm, uv=blue, sharp=80)
        FA = Node(f"DriverArm_{tag}_Fore", location=(sh[0], sh[1] - dspec["upperArm"], sh[2]), local=True)
        fl = dspec["foreArm"]
        FA.add(capsule((0, 0, 0), (0, -(fl - 0.085), 0), 0.043, 0.034, seg=10), dm, uv=blue, sharp=80)
        FA.add(cyl(0.040, 0.03, seg=10), dm, m=T(0, -(fl - 0.09), 0), uv=yoke, sharp=60)                         # cuff
        FA.add(box(0.085, 0.075, 0.062, bevel=0.024, seg=2), dm, m=T(0, -(fl - 0.02), 0), uv=skin, sharp=80)      # fist on the rim
        FA.add(capsule((0.03, -(fl - 0.045), 0.025), (-0.03, -(fl - 0.045), 0.03), 0.014, seg=6, cap_rings=1), dm, uv=skin, sharp=80)   # thumb
        driver_objs += [UA.build(col), FA.build(col)]

    return [chassis_obj, wheel_fl, wheel_fr, wheel_rl, wheel_rr, sw_pivot, sw_obj, beacon_obj,
            headlights_obj, taillights_obj, axle_obj, tierod_obj] + fenders + live_objs + driver_objs


def bake_size(default=4096):
    for a in sys.argv:
        if a.startswith("--bake-size="):
            return int(a.split("=")[1])
    return default


def bake_tractor(objs, size=4096):
    """Unique UV2 for every mesh + baked AO / cavity / edge atlas (see bake_utils.py)."""
    by = {o.name: o for o in objs if o.type == 'MESH' and not o.name.endswith("_Overlay")}
    unwrap = [o for n, o in by.items() if n not in ("Wheel_FR", "Wheel_RR", "ClusterLive", "TerminalLive")]
    make_bake_uvs(unwrap, copies=[(by["Wheel_FL"], by["Wheel_FR"]), (by["Wheel_RL"], by["Wheel_RR"])])
    if "--no-bake" in sys.argv:
        print("Skipping the Cycles bake (--no-bake): the previous tractor_bake.webp stays in place")
        return
    static = [o for n, o in by.items() if not n.startswith("Wheel_") and n not in ("ClusterLive", "TerminalLive")]
    bake_masks([(static, False), ([by["Wheel_FL"]], True), ([by["Wheel_RL"]], True)],
               GLB_OUT_DIR / "tractor_bake.webp", size=size)


def main():
    clear_scene()
    col = ensure_collection("Kindenheim_Tractor")
    objs = build_tractor_nodes(col)
    bake_tractor(objs, bake_size())
    save_blend_and_export_glb(TRACTOR_DIR / "tractor.blend", GLB_OUT_DIR / "tractor.glb", objs)


if __name__ == "__main__":
    main()
