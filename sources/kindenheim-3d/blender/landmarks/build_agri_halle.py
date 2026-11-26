#!/usr/bin/env python3
"""
Hero landmark: agricultural machinery hall Raiffeisenstraße 16 (agri_halle).

Layout follows the DOP20 aerial + LoD2: one gabled hall filling the whole 31.8 x 24.7 m footprint
(red-brown sheet roof, ridge along the long axis), yard on the WEST gable, paved strip along the
SOUTH side, and two round grain silos standing lower on the slope behind the NORTH-WEST corner
(outside the collision footprint). The hall floor sits at `floor_z` above the model origin because
the real terrain south/west of the hall is ~2 m higher than the manifest base elevation.

Run on its own:  blender --background --python blender/landmarks/build_agri_halle.py
"""

import math
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import estates_utils as eu  # noqa: E402
from estates_utils import Builder, Facade, MatSpec, PI  # noqa: E402

KEY = "agri_halle"

DEFAULT_PARAMS = {
    "length_x": 31.84,
    "depth_y": 24.73,
    "floor_z": 1.95,        # hall floor / yard level above the model origin (terrain is ~+2 m S and W)
    "eave_h": 5.85,         # eaves above the hall floor
    "pitch_deg": 13.5,
    "plinth_h": 1.25,       # concrete base wall above the floor
    "foundation_depth": 1.6,
    "silo_centres": [[-17.0, 15.9], [-9.1, 15.9]],
    "silo_radius": 3.0,
    "silo_wall_h": 7.3,
}

SIGNS = eu.OWN_TEX_DIR / "estates_signs_albedo.webp"
GLASS_ORM = eu.OWN_TEX_DIR / "estates_glass_orm.png"
GLOW = eu.OWN_TEX_DIR / "estates_glow.webp"

# sign atlas rectangles (u0, v0, u1, v1) – must match estates_textures.py
SIGN_HALLE = (0.0, 0.25, 0.5, 0.5)
SIGN_HAUSNR_16 = (0.5, 0.375, 0.625, 0.5)
SIGN_WARN = (0.625, 0.375, 0.75, 0.5)


def materials() -> dict:
    return {
        # untinted bases (one mesh / draw call each); the tinted variants below merge into them
        "steel": MatSpec("Halle_Painted_Steel", "metal_painted"),
        "galv": MatSpec("Halle_Galvanized", "metal_galvanized", grime="metal"),
        # plinth: plain cast concrete (no repeating stain stamps), only faint large-scale mottling
        "concrete": MatSpec("Halle_Concrete_Plinth", "concrete", tint=(0.84, 0.87, 0.92), grime="concrete"),  # library scan is warm tan: cool it to grey
        # apron: the same plain brushed concrete (the old dirty_concrete repeated a mud stamp every 3 m),
        # cooled to grey and a little darker than the plinth, with vertex-colour ground grime for large-scale variation
        # backfilled, grassed embankment against the downhill (north) side. Seen only from the meadow, so it
        # carries just the unchanged library grass albedo (2 m tile, UVs scaled in the builder) - no normal/ORM,
        # which would add 2 MB to the download for a surface the tractor never gets close to.
        "bank": MatSpec("Halle_Grass_Bank", own_albedo=eu.lib_file("grass", "albedo", "1k"), rough=0.95,
                        tint=(0.74, 0.90, 0.56),         # greener, to sit in the surrounding meadow
                        grime="ground"),
        "apron": MatSpec("Halle_Concrete_Apron", "concrete", tint=(0.72, 0.75, 0.80), grime="ground"),
        "clad": MatSpec("-", "metal_painted", tint=(0.36, 0.46, 0.33), grime="metal", into="steel"),
        "roof": MatSpec("-", "metal_painted", tint=(0.27, 0.115, 0.08), grime="roof", into="steel"),
        "trim": MatSpec("-", "metal_painted", tint=(0.10, 0.12, 0.11), into="steel"),
        "door": MatSpec("-", "metal_painted", tint=(0.72, 0.72, 0.68), grime="metal", into="steel"),
        "silo": MatSpec("-", "metal_galvanized", grime="metal", into="galv"),
        "rooflight": MatSpec("-", "metal_painted", tint=(0.74, 0.80, 0.68), into="steel"),
        "rubber": MatSpec("-", "metal_painted", tint=(0.03, 0.03, 0.033), into="steel"),
        "interior": MatSpec("-", "metal_painted", tint=(0.035, 0.04, 0.038), into="steel"),
        "bin": MatSpec("-", "metal_painted", tint=(0.08, 0.26, 0.14), into="steel"),
        "wood": MatSpec("-", "metal_painted", tint=(0.50, 0.36, 0.22), into="steel"),
        "tank": MatSpec("-", "metal_painted", tint=(0.55, 0.08, 0.06), into="steel"),
        "glass": MatSpec("Halle_Glass_Window", color=(0.022, 0.03, 0.036), rough=0.08, orm_tiny=GLASS_ORM),
        "lamp": MatSpec("Halle_Lamp_Emissive", color=eu.LAMP_GLASS, rough=0.4, emissive=(1.0, 0.90, 0.72, 0.5)),
        "glow": MatSpec("Halle_LampGlow_Emissive", own_albedo=GLOW, rough=1.0, alpha_blend=True, emissive=(1.0, 0.90, 0.72, 0.12)),
        "sign": MatSpec("Halle_Signs", own_albedo=SIGNS, rough=0.55),
    }


# ---------------------------------------------------------------------------
# Trapezoidal sheet (real profile geometry)
# ---------------------------------------------------------------------------

def trapezoid_profile(u0, u1, pitch=0.25, depth=0.04, phase=0.0):
    """(u, y) break points of a trapezoidal sheet between u0 and u1; y = 0 valley, -depth crown."""
    brk = [(0.0, 0.0), (0.105, 0.0), (0.14, -depth), (0.215, -depth)]

    def y_at(u):
        t = (u - phase) % pitch
        if t <= 0.105:
            return 0.0
        if t <= 0.14:
            return -depth * (t - 0.105) / 0.035
        if t <= 0.215:
            return -depth
        return -depth * (1.0 - (t - 0.215) / 0.035)

    pts = [(u0, y_at(u0))]
    k = math.floor((u0 - phase) / pitch)
    while True:
        base = phase + k * pitch
        if base > u1:
            break
        for off, yy in brk:
            u = base + off
            if u0 + 1e-4 < u < u1 - 1e-4:
                pts.append((u, yy))
        k += 1
    pts.append((u1, y_at(u1)))
    return pts


def trapezoid_sheet(b: Builder, key, u0, u1, v0, v1, pitch=0.25, depth=0.04, vseg=3.6, y0=0.0):
    """Profiled sheet in the current facade frame (-Y outward). key and v0/v1 may be callables of u."""
    if u1 - u0 < 1e-3:
        return
    prof = trapezoid_profile(u0, u1, pitch, depth)
    f0 = v0 if callable(v0) else (lambda u: v0)
    f1 = v1 if callable(v1) else (lambda u: v1)
    kf = key if callable(key) else (lambda u: key)
    dist = 0.0
    for i in range(len(prof) - 1):
        (ua, ya), (ub, yb) = prof[i], prof[i + 1]
        seg = math.hypot(ub - ua, yb - ya)
        za0, za1, zb0, zb1 = f0(ua), f1(ua), f0(ub), f1(ub)
        if max(za1 - za0, zb1 - zb0) < 1e-4:
            dist += seg
            continue
        n = max(1, int(math.ceil(max(za1 - za0, zb1 - zb0) / vseg)))
        k = kf((ua + ub) * 0.5)
        # one flat strip with shared vertices (keeps the GLB small: 2(n+1) vertices per profile facet)
        verts, faces, uvs = [], [], []
        for j in range(n + 1):
            t = j / n
            verts.append((ua, y0 + ya, za0 + (za1 - za0) * t))
            verts.append((ub, y0 + yb, zb0 + (zb1 - zb0) * t))
        for j in range(n):
            a, c, d, e = 2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2
            faces.append([a, c, d, e])
            uvs.append([(dist, verts[a][2]), (dist + seg, verts[c][2]), (dist + seg, verts[d][2]), (dist, verts[e][2])])
        b.mesh(k, verts, faces, uvs)
        dist += seg


def clad_wall(b: Builder, key, length, z0, top, rects):
    """Cladding over [0, length] x [z0, top(u)] with rectangular cut-outs rects = [(u0, u1, v0, v1)]."""
    topf = top if callable(top) else (lambda u: top)
    cuts = sorted(rects, key=lambda r: r[0])
    edges = sorted({0.0, length, *[r[0] for r in cuts], *[r[1] for r in cuts]})
    for a, c in zip(edges[:-1], edges[1:]):
        mid = (a + c) * 0.5
        spans = sorted([(r[2], r[3]) for r in cuts if r[0] - 1e-6 <= mid <= r[1] + 1e-6])
        lo = z0
        for (h0, h1) in spans:
            if h0 > lo + 1e-3:
                trapezoid_sheet(b, key, a, c, lo, h0)
            lo = max(lo, h1)
        trapezoid_sheet(b, key, a, c, lo, topf)


# ---------------------------------------------------------------------------
# Sectional door
# ---------------------------------------------------------------------------

def sectional_door(b: Builder, uc, v0, w, h, open_frac=0.0, windows=True, depth=0.16, interior=None):
    """Overhead sectional door in a steel-framed opening (current frame = wall frame).
    open_frac 0 = closed, 1 = fully raised."""
    if True:
        x0, x1 = uc - w / 2, uc + w / 2
        # steel portal frame / flashing around the opening
        b.box("trim", x0 - 0.14, x0, -0.07, depth, v0, v0 + h + 0.14)
        b.box("trim", x1, x1 + 0.14, -0.07, depth, v0, v0 + h + 0.14)
        b.box("trim", x0, x1, -0.07, depth, v0 + h, v0 + h + 0.14)
        # vertical guide rails inside the reveal
        for xr in (x0 + 0.03, x1 - 0.08):
            b.box("galv", xr, xr + 0.05, depth - 0.02, depth + 0.04, v0, v0 + h)
        ph = 0.575
        n = int(round(h / ph))
        ph = h / n
        gap_bottom = v0 + h * open_frac
        for i in range(n):
            z_lo = v0 + i * ph + h * open_frac
            z_hi = z_lo + ph - 0.012
            if z_lo >= v0 + h - 0.02:
                break
            z_hi = min(z_hi, v0 + h)
            # micro-ribbed insulated steel panel: body + three shallow stiffening ribs
            b.box("door", x0 + 0.02, x1 - 0.02, depth, depth + 0.04, z_lo, z_hi, uv="box")
            if z_hi - z_lo > 0.4:
                for k in (0.25, 0.5, 0.75):
                    zc = z_lo + (z_hi - z_lo) * k
                    b.box("door", x0 + 0.02, x1 - 0.02, depth - 0.008, depth, zc - 0.035, zc + 0.035,
                          skip=("+y",))
            if windows and i == (n * 2) // 3 and z_hi - z_lo > 0.4:
                nw = max(2, int(w / 1.1))
                for k in range(nw):
                    xc = x0 + w * (k + 0.5) / nw
                    zc = (z_lo + z_hi) * 0.5
                    b.box("rubber", xc - 0.33, xc + 0.33, depth - 0.016, depth, zc - 0.17, zc + 0.17, skip=("+y",))
                    b.box("glass", xc - 0.29, xc + 0.29, depth - 0.020, depth - 0.015, zc - 0.13, zc + 0.13,
                          skip=("+y", "-x", "+x", "-z", "+z"), uv_rand=False)
        # rubber floor seal + handle
        b.box("rubber", x0 + 0.02, x1 - 0.02, depth - 0.005, depth + 0.045, gap_bottom - 0.035, gap_bottom + 0.012)
        if open_frac < 0.05:
            b.box("trim", uc - 0.12, uc + 0.12, depth - 0.03, depth, v0 + 0.95, v0 + 1.0)
        if open_frac > 0.05 and interior:
            interior(b, x0, x1, v0, v0 + h, depth)


BAY_DEPTH = 10.0      # drive-in bay behind the raised door (m)
BAY_MARGIN = 1.4      # storage strip left and right of the 4.6 m lane


def hall_interior(b: Builder, x0, x1, z0, z1, depth, deep=BAY_DEPTH):
    """Drive-in machinery bay behind the raised door: dim sheet-metal walls, concrete floor, harvest bins
    and pallets stacked along the sides and the back so the lane itself stays clear."""
    y0, y1 = depth + 0.06, depth + deep
    xa, xb = x0 - BAY_MARGIN, x1 + BAY_MARGIN
    zt = z1 + 0.9
    b.floor("apron", xa, xb, y0, y1, z0 + 0.002, cell=2.5, color=(0.5, 0.5, 0.5))
    # inward-facing shell (sheet walls with a few liner-tray joints so it does not read as a black box)
    b.face("interior", [(xa, y1, z0), (xb, y1, z0), (xb, y1, zt), (xa, y1, zt)])
    b.face("interior", [(xa, y0, z0), (xa, y1, z0), (xa, y1, zt), (xa, y0, zt)])
    b.face("interior", [(xb, y1, z0), (xb, y0, z0), (xb, y0, zt), (xb, y1, zt)])
    b.face("interior", [(xa, y1, zt), (xb, y1, zt), (xb, y0, zt), (xa, y0, zt)])
    b.face("interior", [(xb, y0, z0), (x1, y0, z0), (x1, y0, zt), (xb, y0, zt)])
    b.face("interior", [(x0, y0, z0), (xa, y0, z0), (xa, y0, zt), (x0, y0, zt)])
    b.face("interior", [(x1, y0, z1), (x0, y0, z1), (x0, y0, zt), (x1, y0, zt)])
    for k in range(1, 5):
        yy = y0 + (y1 - y0) * k / 5
        for xs, sg in ((xa, 1), (xb, -1)):
            b.box("galv", min(xs, xs + sg * 0.05), max(xs, xs + sg * 0.05), yy - 0.04, yy + 0.04, z0, zt, color=(0.25, 0.25, 0.25))
    for k in (0.28, 0.72):                                 # two strip lights under the bay ceiling
        yy = y0 + (y1 - y0) * k
        b.box("lamp", (x0 + x1) / 2 - 0.75, (x0 + x1) / 2 + 0.75, yy - 0.06, yy + 0.06, zt - 0.10, zt - 0.05)
    dim = (0.45, 0.45, 0.45)

    def bin_stack(bx, by, levels):
        for lvl in range(levels):
            bz = z0 + lvl * 0.80
            b.box("bin", bx - 0.58, bx + 0.58, by - 0.5, by + 0.5, bz + 0.12, bz + 0.78, color=dim)
            for fx in (-0.5, 0.0, 0.5):
                b.box("bin", bx + fx - 0.06, bx + fx + 0.06, by - 0.5, by + 0.5, bz, bz + 0.12, color=dim)

    for row in range(5):                                   # bins along the left wall
        bin_stack(xa + 0.68, y0 + 1.4 + row * 1.15, 3 if row % 2 == 0 else 2)
    for col in range(4):                                   # and across the back
        bin_stack(x0 + 0.7 + col * 1.25, y1 - 0.65, 3 - (col % 2))
    for row in range(3):                                   # pallets with sacks along the right wall
        py = y0 + 1.6 + row * 1.6
        eu.pallet(b, "wood", xb - 0.72, py, z0, rz=PI / 2 + 0.05 * row)
        for k in range(3):
            b.box("wood", xb - 1.2, xb - 0.24, py - 0.52 + k * 0.36, py - 0.20 + k * 0.36, z0 + 0.125,
                  z0 + 0.125 + 0.36 + 0.06 * ((k + row) % 2), color=(0.8, 0.72, 0.55))


# ---------------------------------------------------------------------------
# Silos
# ---------------------------------------------------------------------------

def silo(b: Builder, r, wall_h, z_base, with_ladder=True, ladder_angle=PI * 1.15):
    """Bolted galvanized grain bin at the frame origin (base ring at z_base)."""
    seg = 32
    b.lathe("concrete", [(r + 0.35, z_base - 1.7), (r + 0.35, z_base + 0.18), (r + 0.28, z_base + 0.25)], seg=seg,
            cap_bottom=False, cap_top=True, sharp=(1,))
    z0 = z_base + 0.25
    ring_h = 0.81
    n = int(round(wall_h / ring_h))
    ring_h = wall_h / n
    prof = []
    for i in range(n):
        za = z0 + i * ring_h
        prof += [(r + 0.010, za), (r + 0.010, za + 0.05), (r, za + 0.06), (r, za + ring_h)]
    b.lathe("silo", prof, seg=seg, cap_bottom=False, cap_top=False, sharp=range(len(prof)))
    z_top = z0 + wall_h
    # vertical hat-section stiffeners
    for k in range(16):
        a = 2 * PI * (k + 0.5) / 16
        with b.place(0, 0, 0, rz=a):
            b.box("silo", r + 0.008, r + 0.065, -0.045, 0.045, z0, z_top - 0.02, uv="long")
    # eave ring + conical roof with radial ribs
    cone_h = r * 0.52
    b.lathe("silo", [(r + 0.06, z_top - 0.05), (r + 0.09, z_top + 0.02), (0.45, z_top + cone_h), (0.45, z_top + cone_h + 0.18)],
            seg=seg, cap_bottom=False, cap_top=False, sharp=(1, 2))
    for k in range(seg):
        a = 2 * PI * k / seg
        p0 = Vector(((r + 0.08) * math.cos(a), (r + 0.08) * math.sin(a), z_top + 0.03))
        p1 = Vector((0.46 * math.cos(a), 0.46 * math.sin(a), z_top + cone_h + 0.01))
        b.beam("silo", p0, p1, 0.035, 0.03, normal=(math.cos(a) * 0.45, math.sin(a) * 0.45, 0.9))
    # fill cap / vent
    b.lathe("galv", [(0.52, z_top + cone_h + 0.16), (0.52, z_top + cone_h + 0.24), (0.12, z_top + cone_h + 0.42)], seg=12,
            cap_bottom=True, cap_top=True, sharp=(1,))
    # manway door at the base
    with b.place(0, 0, 0, rz=ladder_angle - 0.9):
        b.box("galv", r - 0.02, r + 0.05, -0.38, 0.38, z0 + 0.35, z0 + 1.25)
        b.box("trim", r + 0.05, r + 0.07, -0.30, 0.30, z0 + 0.43, z0 + 1.17)
    # discharge slide gate + pipe stub
    if with_ladder:
        with b.place(0, 0, 0, rz=ladder_angle):
            lx = r + 0.34
            top = z_top + 0.95
            for sy in (-0.2, 0.2):
                b.cyl("galv", (lx, sy, z0 + 0.4), (lx, sy, top), 0.022, seg=6)
            z = z0 + 0.65
            while z < z_top + 0.1:
                b.cyl("galv", (lx, -0.2, z), (lx, 0.2, z), 0.014, seg=5, caps=(False, False))
                z += 0.28
            # stand-off brackets back to the wall
            z = z0 + 1.2
            while z < z_top:
                for sy in (-0.2, 0.2):
                    b.beam("galv", (r, sy, z), (lx, sy, z), 0.03, 0.006, normal=(0, 0, 1))
                z += 1.62
            # safety cage (Rückenschutz): hoops + 5 vertical straps from 2.4 m up
            cz = z0 + 2.4
            hoops = []
            while cz < top + 0.01:
                hoops.append(cz)
                cz += 0.9
            for hz in hoops:
                ring = [(lx + 0.02 + 0.62 * math.sin(PI * i / 10), 0.33 * math.cos(PI * i / 10), hz) for i in range(11)]
                b.tube("galv", ring, 0.011, seg=4, caps=False)
            if hoops:
                for i in (1, 3, 5, 7, 9):
                    px, py = lx + 0.02 + 0.62 * math.sin(PI * i / 10), 0.33 * math.cos(PI * i / 10)
                    b.beam("galv", (px, py, hoops[0]), (px, py, hoops[-1]), 0.03, 0.005,
                           normal=(math.sin(PI * i / 10), math.cos(PI * i / 10), 0))
            # roof ladder up the cone to the cap
            p_e = Vector((r + 0.1, 0, z_top + 0.12))
            p_c = Vector((0.6, 0, z_top + cone_h + 0.12))
            for sy in (-0.2, 0.2):
                b.cyl("galv", p_e + Vector((0, sy, 0)), p_c + Vector((0, sy, 0)), 0.02, seg=5)
            for k in range(1, 9):
                p = p_e.lerp(p_c, k / 9)
                b.cyl("galv", p + Vector((0, -0.2, 0)), p + Vector((0, 0.2, 0)), 0.013, seg=5, caps=(False, False))
    return z_top, cone_h


def outward_prism(b: Builder, key, u0, width, pts):
    """Solid with profile pts = [(outward distance, z)] standing against a wall (current frame = wall
    frame), extruded along the wall from u0 to u0 + width."""
    with b.at(Matrix.Translation((u0, 0, 0)) @ Matrix.Rotation(-PI / 2, 4, "Z")):
        b.prism_xz(key, pts, 0.0, width)


def railing(b: Builder, key, pts, h=1.05, post_step=1.5):
    pts = [Vector(p) for p in pts]
    for lvl in (h, h * 0.52):
        b.tube(key, [p + Vector((0, 0, lvl)) for p in pts], 0.017, seg=5)
    for i in range(len(pts) - 1):
        a, c = pts[i], pts[i + 1]
        n = max(1, int((c - a).length / post_step))
        for k in range(n + 1):
            p = a.lerp(c, k / n)
            b.cyl(key, p, p + Vector((0, 0, h)), 0.017, seg=5)


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------

def build_agri_halle(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    eu.clear_scene()
    col = bpy.data.collections.new("Agri_Halle_Kindenheim")
    bpy.context.scene.collection.children.link(col)
    site = eu.Site(KEY)
    b = Builder("AgriHalle", materials(), seed=16)

    L, D = cfg["length_x"], cfg["depth_y"]
    hx, hy = L / 2, D / 2
    F = cfg["floor_z"]
    He = cfg["eave_h"]
    pitch = cfg["pitch_deg"]
    tan = math.tan(math.radians(pitch))
    ph = cfg["plinth_h"]
    z_eave = F + He
    z_ridge = z_eave + hy * tan
    fd = cfg["foundation_depth"]
    z_plinth = F + ph
    bays = 6
    bay = L / bays

    def gable_top(length):
        return lambda u: z_eave + (hy - abs(u - length / 2)) * tan

    # ------------------------------------------------------------------
    # 1. Walls: concrete base (down to the skirt) + profiled cladding
    # ------------------------------------------------------------------
    walls = {
        "S": ((-hx, -hy), (hx, -hy), L),
        "E": ((hx, -hy), (hx, hy), D),
        "N": ((hx, hy), (-hx, hy), L),
        "W": ((-hx, hy), (-hx, -hy), D),
    }
    # West gable = yard face: two sectional doors + personnel door. South side: one sectional door.
    doorW_h = 4.55
    w_doors = [(7.2, 4.6, 0.0), (13.9, 4.6, 0.93)]          # (u centre, width, open fraction): door B = drive-in bay
    pd_u = 19.6
    s_door_u = hx                # centre of the long side, where the terrain meets the floor level
    doorS_h = 4.2
    notches = {
        "W": [(uc - w / 2 - 0.14, uc + w / 2 + 0.14) for uc, w, _ in w_doors] + [(pd_u - 0.63, pd_u + 0.63)],
        "S": [(s_door_u - 2.1 - 0.14, s_door_u + 2.1 + 0.14)],
        "E": [],
        "N": [],
    }
    fac = {}
    for name, (p0, p1, length) in walls.items():
        # concrete base wall: skirt .. plinth top, notched down to floor level at every door
        outline = [(0.0, -fd), (length, -fd), (length, z_plinth)]
        for (a, c_) in sorted(notches[name], reverse=True):
            outline += [(c_, z_plinth), (c_, F), (a, F), (a, z_plinth)]
        outline.append((0.0, z_plinth))
        f = Facade(b, "concrete", p0, p1, -fd, z_plinth, outline=outline, grid=2.6, bands=(fd + 0.3, fd + 1.0, fd + F))
        f.build()
        fac[name] = f
        # formwork panel joints: faint darker lines, skipped across the door notches
        jc = (0.55, 0.55, 0.55)
        with b.at(f.frame):
            nj = int(round(length / 2.65))
            for k in range(1, nj):
                uj = length * k / nj
                if any(a - 0.05 < uj < c_ + 0.05 for a, c_ in notches[name]):
                    continue
                b.box("concrete", uj - 0.008, uj + 0.008, -0.005, 0.0, -fd, z_plinth - 0.01, color=jc, skip=("+y", "-z", "+z"))
            for zj in (F - 2.6, F - 1.3, F):
                if zj > -fd + 0.1:
                    b.box("concrete", 0.0, length, -0.005, 0.0, zj - 0.008, zj + 0.008, color=jc, skip=("+y", "-x", "+x"))
        print(f"[halle] terrain along wall {name}: " + ", ".join(
            f"{site.terrain_z(*(f.frame @ Vector((u, -0.8, 0)))[:2]):.2f}" for u in [length * k / 6 for k in range(7)]))
    with b.at(fac["W"].frame):
        for uc, w, op in w_doors:
            sectional_door(b, uc, F, w, doorW_h, open_frac=op, interior=hall_interior)
    with b.at(fac["S"].frame):
        sectional_door(b, s_door_u, F, 4.2, doorS_h, open_frac=0.0)

    # cladding above the plinth (cut around door openings), set 4 cm behind the plinth face
    cut = {
        "W": [(uc - w / 2 - 0.14, uc + w / 2 + 0.14, z_plinth, F + doorW_h + 0.14) for uc, w, _ in w_doors]
             + [(pd_u - 0.63, pd_u + 0.63, z_plinth, F + 2.20)],
        "S": [(s_door_u - 2.1 - 0.14, s_door_u + 2.1 + 0.14, z_plinth, F + doorS_h + 0.14)],
        "E": [],
        "N": [],
    }
    band_z0, band_z1 = z_eave - 1.75, z_eave - 0.75     # translucent light band under the eaves
    for name in ("S", "N"):
        for i in range(bays):
            u0, u1 = i * bay + 0.55, (i + 1) * bay - 0.55
            cut[name].append((u0, u1, band_z0, band_z1))
    louv = (D / 2 - 1.1, D / 2 + 1.1, z_eave + 0.9, z_eave + 2.0)
    cut["E"].append(louv)
    cut["W"].append(louv)

    for name, (p0, p1, length) in walls.items():
        f = fac[name]
        top = gable_top(length) if name in ("E", "W") else z_eave
        with b.at(f.frame):
            with b.place(0, 0.05, 0):
                clad_wall(b, "clad", length, z_plinth, top, cut[name])
            # plinth top: sloped drip flashing
            b.sweep_h("trim", [(0.0, 0.0), (0.035, -0.03), (0.035, -0.045), (-0.06, 0.035), (-0.06, 0.05)],
                      [(0.0, 0.0, z_plinth), (length, 0.0, z_plinth)])
            # corner flashings
            for uu in (0.0, length):
                b.box("trim", uu - 0.11, uu + 0.11, -0.012, 0.11, z_plinth, (top(uu) if callable(top) else top))
            # louvred gable vent
            if name in ("E", "W"):
                u0, u1, v0, v1 = louv
                b.box("trim", u0 - 0.06, u1 + 0.06, -0.02, 0.06, v0 - 0.06, v0)
                b.box("trim", u0 - 0.06, u1 + 0.06, -0.02, 0.06, v1, v1 + 0.06)
                b.box("trim", u0 - 0.06, u0, -0.02, 0.06, v0, v1)
                b.box("trim", u1, u1 + 0.06, -0.02, 0.06, v0, v1)
                nl = 11
                for k in range(nl):
                    zc = v0 + (v1 - v0) * (k + 0.5) / nl
                    with b.place((u0 + u1) / 2, 0.03, zc, rx=math.radians(35)):
                        b.box("galv", -(u1 - u0) / 2, (u1 - u0) / 2, -0.004, 0.004, -0.06, 0.06)
                b.face("interior", [(u0, 0.07, v0), (u1, 0.07, v0), (u1, 0.07, v1), (u0, 0.07, v1)])
            # light bands (twin-wall polycarbonate in aluminium frames)
            if name in ("S", "N"):
                for i in range(bays):
                    u0, u1 = i * bay + 0.55, (i + 1) * bay - 0.55
                    b.box("galv", u0, u1, 0.0, 0.07, band_z0, band_z0 + 0.05)
                    b.box("galv", u0, u1, 0.0, 0.07, band_z1 - 0.05, band_z1)
                    nm = 4
                    for k in range(nm + 1):
                        xm = u0 + (u1 - u0) * k / nm
                        b.box("galv", xm - 0.025, xm + 0.025, 0.0, 0.07, band_z0 + 0.05, band_z1 - 0.05)
                    b.face("glass", [(u0, 0.045, band_z0), (u1, 0.045, band_z0), (u1, 0.045, band_z1), (u0, 0.045, band_z1)])
                    b.box("galv", u0 - 0.04, u1 + 0.04, -0.012, 0.07, band_z0 - 0.045, band_z0)   # sill flashing
                    b.box("galv", u0 - 0.04, u1 + 0.04, -0.012, 0.07, band_z1, band_z1 + 0.03)
                    b.box("galv", u0 - 0.04, u0, -0.012, 0.07, band_z0, band_z1)
                    b.box("galv", u1, u1 + 0.04, -0.012, 0.07, band_z0, band_z1)
                # downpipes on every second frame line
                for i in range(0, bays + 1, 2):
                    uu = min(max(i * bay, 0.35), length - 0.35)
                    gz = z_eave - 0.42 * tan + 0.10 - 0.17
                    eu.downpipe(b, "galv", (uu, -0.505, gz), F, wall_offset=(0.0, 0.40), r=0.055)

    # personnel door (west) with canopy lamp + sign
    with b.at(fac["W"].frame):
        b.box("trim", pd_u - 0.63, pd_u - 0.55, -0.06, 0.14, F, F + 2.20)
        b.box("trim", pd_u + 0.55, pd_u + 0.63, -0.06, 0.14, F, F + 2.20)
        b.box("trim", pd_u - 0.55, pd_u + 0.55, -0.06, 0.14, F + 2.12, F + 2.20)
        b.box("door", pd_u - 0.55, pd_u + 0.55, 0.08, 0.13, F + 0.02, F + 2.12)
        b.box("glass", pd_u - 0.30, pd_u + 0.30, 0.07, 0.08, F + 1.25, F + 1.85, skip=("+y",), uv_rand=False)
        b.box("galv", pd_u + 0.36, pd_u + 0.42, 0.02, 0.08, F + 1.0, F + 1.05)
        b.tube("galv", [(pd_u + 0.40, 0.03, F + 1.03), (pd_u + 0.40, -0.02, F + 1.03), (pd_u + 0.27, -0.02, F + 1.03)], 0.012, seg=5)
        # floodlights over the doors
        for uc, w, _ in w_doors:
            lz = F + doorW_h + 0.75
            eu.glow_wall(b, "glow", uc, lz - 1.7, 6.5, 5.6, alpha=0.30, y=-0.075)
            b.box("trim", uc - 0.05, uc + 0.05, -0.16, 0.06, lz + 0.02, lz + 0.08)
            with b.place(uc, -0.2, lz, rx=math.radians(-28)):
                b.box("trim", -0.19, 0.19, -0.06, 0.06, -0.14, 0.14)
                b.box("lamp", -0.165, 0.165, -0.068, -0.058, -0.115, 0.115, skip=("+y",), uv_rand=False)
        lz = F + 2.55
        eu.glow_wall(b, "glow", pd_u, lz - 1.1, 3.4, 3.4, alpha=0.30, y=-0.075)
        b.box("trim", pd_u - 0.04, pd_u + 0.04, -0.12, 0.06, lz, lz + 0.05)
        with b.place(pd_u, -0.15, lz - 0.02, rx=math.radians(-20)):
            b.box("trim", -0.13, 0.13, -0.045, 0.045, -0.10, 0.10)
            b.box("lamp", -0.11, 0.11, -0.052, -0.044, -0.08, 0.08, skip=("+y",), uv_rand=False)
        # signs: company board between the doors, house number + warning sign by the personnel door
        eu.sign_panel(b, "sign", 9.75, 11.35, F + 2.25, F + 3.05, -0.062, SIGN_HALLE, back_key="trim")
        eu.sign_panel(b, "sign", pd_u + 0.80, pd_u + 1.10, F + 1.55, F + 1.85, -0.03, SIGN_HAUSNR_16, back_key="trim")
        eu.sign_panel(b, "sign", pd_u - 1.20, pd_u - 0.85, F + 1.45, F + 1.80, -0.03, SIGN_WARN, back_key="trim")
    with b.at(fac["S"].frame):
        lz = F + doorS_h + 0.75
        eu.glow_wall(b, "glow", s_door_u, lz - 1.7, 6.0, 5.4, alpha=0.30, y=-0.075)
        b.box("trim", s_door_u - 0.05, s_door_u + 0.05, -0.16, 0.06, lz + 0.02, lz + 0.08)
        with b.place(s_door_u, -0.2, lz, rx=math.radians(-28)):
            b.box("trim", -0.19, 0.19, -0.06, 0.06, -0.14, 0.14)
            b.box("lamp", -0.165, 0.165, -0.068, -0.058, -0.115, 0.115, skip=("+y",), uv_rand=False)


    # ------------------------------------------------------------------
    # 2. Roof: trapezoidal sheet with GRP roof-light strips, ridge cap, verge trims, gutters
    # ------------------------------------------------------------------
    eave_oh, verge_oh = 0.42, 0.28
    slope_len = (hy + eave_oh) / math.cos(math.radians(pitch))
    z_eo = z_eave - eave_oh * tan + 0.10
    c, s_ = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    light_bays = []
    for i in range(bays):
        mid = verge_oh + i * bay + bay / 2
        light_bays.append((mid - 0.5, mid + 0.5))

    def roof_key(u):
        return "rooflight" if any(a <= u <= c_ for a, c_ in light_bays) else "roof"

    for side in (-1, 1):
        if side < 0:
            frame = Matrix(((1, 0, 0, -hx - verge_oh), (0, s_, c, -hy - eave_oh), (0, -c, s_, z_eo), (0, 0, 0, 1)))
        else:
            frame = Matrix(((-1, 0, 0, hx + verge_oh), (0, -s_, -c, hy + eave_oh), (0, -c, s_, z_eo), (0, 0, 0, 1)))
        with b.at(frame):
            width = L + 2 * verge_oh
            # full-slope sheets; roof-light strips replace the steel between 1.3 m above the eave and 1.2 m below the ridge
            edges = sorted({0.0, width, *[a for a, _ in light_bays], *[c_ for _, c_ in light_bays]})
            for a, c_ in zip(edges[:-1], edges[1:]):
                is_light = roof_key((a + c_) / 2) == "rooflight"
                if is_light:
                    trapezoid_sheet(b, "roof", a, c_, 0.0, 1.3, depth=0.045)
                    trapezoid_sheet(b, "rooflight", a, c_, 1.3, slope_len - 1.2, depth=0.045)
                    trapezoid_sheet(b, "roof", a, c_, slope_len - 1.2, slope_len, depth=0.045)
                else:
                    trapezoid_sheet(b, "roof", a, c_, 0.0, slope_len, depth=0.045)
            # underside + eave fascia + verge trims
            b.face("clad", [(width, 0.07, 0.0), (0.0, 0.07, 0.0), (0.0, 0.07, slope_len), (width, 0.07, slope_len)],
                   color=(0.75, 0.75, 0.75))
            b.box("trim", 0.0, width, -0.05, 0.12, -0.03, 0.0)
            for xv in (0.0, width):
                b.box("trim", xv - 0.02, xv + 0.02, -0.075, 0.16, -0.03, slope_len)
                b.box("trim", xv - 0.10 if xv > 0 else xv, xv if xv > 0 else xv + 0.10, -0.075, -0.05, -0.03, slope_len)
            # snow guard pipes above the eaves (south side over the paved strip)
            # purlin ends visible under the verge
            for k in range(7):
                zz = 0.35 + k * (slope_len - 0.7) / 6
                b.box("galv", 0.02, verge_oh + 0.1, 0.07, 0.25, zz - 0.035, zz + 0.035)
                b.box("galv", width - verge_oh - 0.1, width - 0.02, 0.07, 0.25, zz - 0.035, zz + 0.035)
        gz = z_eo - 0.085
        eu.half_round_gutter(b, "galv", (-hx - verge_oh + 0.02, side * (hy + eave_oh + 0.085), gz),
                             (hx + verge_oh - 0.02, side * (hy + eave_oh + 0.085), gz), outward=(0, side, 0), r=0.09)
    # ridge cap (bent sheet) along the whole roof
    zr = z_eo + slope_len * s_ + 0.045
    cap = [(-0.34, -0.34 * tan - 0.01), (0.0, 0.035), (0.34, -0.34 * tan - 0.01), (0.34, -0.34 * tan - 0.03), (0.0, 0.012),
           (-0.34, -0.34 * tan - 0.03)]
    b.sweep("trim", [(a, bb) for a, bb in cap], [(-hx - verge_oh - 0.02, 0, zr), (hx + verge_oh + 0.02, 0, zr)],
            [Vector((0, -1, 0))] * 2, [Vector((0, 0, 1))] * 2)

    # ------------------------------------------------------------------
    # 3. Yard aprons draped onto the real terrain + door ramps
    # ------------------------------------------------------------------
    b.drape("apron", site, -hx - 9.0, -hx + 0.05, -hy - 4.4, 6.0, cell=0.5)
    b.drape("apron", site, -hx + 0.05, hx + 0.6, -hy - 4.4, -hy + 0.05, cell=0.5)

    def ramp(f: Facade, uc, w, run=2.8):
        # concrete wedge from the door sill down into the terrain-draped apron
        end = f.frame @ Vector((uc, -run, 0.0))
        z_end = min(F - 0.04, site.terrain_z(end.x, end.y) - 0.10)
        with b.at(f.frame):
            outward_prism(b, "apron", uc - w / 2 - 0.25, w + 0.5,
                          [(0.0, F - 1.0), (run, F - 1.0), (run, z_end), (0.0, F)])

    for uc, w, _ in w_doors:
        ramp(fac["W"], uc, w)
        cy_ = hy - uc
        zt_ = max(site.terrain_z(-hx - dx_, cy_ + dy_) for dx_ in (0.6, 3.0, 5.4) for dy_ in (-2.6, 0.0, 2.6)) + 0.10
        eu.glow_ground(b, "glow", -hx - 3.0, cy_, max(zt_, F + 0.02), 6.0, 6.4, alpha=0.20)
    ramp(fac["S"], s_door_u, 4.2)
    ramp(fac["W"], pd_u, 1.2, run=1.6)

    # ------------------------------------------------------------------
    # 3b. Downhill (north) side: the ground falls 1-3 m below the hall floor there. The silo terrace is a raised
    #     concrete slab at yard level (an L that joins the west yard), retained by concrete walls with a coping
    #     and a railing, and a crushed-stone embankment is backfilled against the hall's north base wall and
    #     around the terrace, so only ~1.4 m of plinth (as on the uphill sides) and a 0.55 m terrace edge show.
    # ------------------------------------------------------------------
    r = cfg["silo_radius"]
    (sax, say), (sbx, sby) = cfg["silo_centres"]
    zP = F - 0.05                                   # terrace slab top (west yard level)
    tx0, tx1 = sax - r - 5.6, sbx + r + 1.4          # terrace slab x range (covers the intake pit in the west)
    ty0, ty1 = hy, max(say, sby) + r + 1.5          # terrace slab y range (against the north wall)
    acc_y0 = 6.0                                    # access strip from the west yard (yard apron ends at y = 6)
    plat_rects = [(tx0, tx1, ty0, ty1), (tx0, -hx, acc_y0, hy)]
    for (x0_, x1_, y0_, y1_) in plat_rects:
        zlow = min(site.terrain_z(x0_ + (x1_ - x0_) * i / 8, y0_ + (y1_ - y0_) * j / 6)
                   for i in range(9) for j in range(7)) - 0.6
        if zlow > zP - 0.6:
            raise RuntimeError(f"terrace rect {(x0_, x1_, y0_, y1_)}: terrain is not below the slab (zlow {zlow:.2f})")
        b.box("concrete", x0_, x1_, y0_, y1_, zlow, zP - 0.22, skip=("+z",))      # retaining walls (block sides)
        b.box("apron", x0_, x1_, y0_, y1_, zP - 0.22, zP)                          # slab
    # coping on the exposed terrace edges (north, east, west) + railing on the north and east drops
    cop = 0.09
    b.box("concrete", tx0 - cop, tx1 + cop, ty1 - 0.28, ty1 + cop, zP - 0.30, zP + 0.10)
    b.box("concrete", tx1 - 0.28, tx1 + cop, ty0, ty1, zP - 0.30, zP + 0.10)
    b.box("concrete", tx0 - cop, tx0 + 0.28, acc_y0 + 0.6, ty1, zP - 0.30, zP + 0.10)
    railing(b, "galv", [(tx0 + 0.35, ty1 - 0.12, zP + 0.10), (tx1 - 0.12, ty1 - 0.12, zP + 0.10),
                        (tx1 - 0.12, ty0 + 0.12, zP + 0.10)], post_step=1.6)

    # crushed-stone embankment: z = max(terrain, bank top - slope * distance outside the hall / terrace)
    def rect_dist(x, y, rc):
        x0_, x1_, y0_, y1_ = rc
        return math.hypot(max(x0_ - x, 0.0, x - x1_), max(y0_ - y, 0.0, y - y1_))

    hall_rc = (-hx, hx, -hy, hy)
    slope = 0.62                                    # ~1 : 1.6 embankment
    bank_hall, bank_plat = F - 0.15, zP - 0.55

    def bank_top(x, y):
        return max([bank_hall - slope * rect_dist(x, y, hall_rc)]
                   + [bank_plat - slope * rect_dist(x, y, rc) for rc in plat_rects])

    def grid(a, c, step, keep):
        n = max(1, int(math.ceil((c - a) / step)))
        return sorted(set([round(a + (c - a) * k / n, 4) for k in range(n + 1)]
                          + [round(v, 4) for v in keep if a <= v <= c]))

    gx = grid(-hx - 16.0, hx + 6.0, 0.6, (-hx, hx, tx0, tx1))
    gy = grid(0.0, ty1 + 7.5, 0.6, (hy, ty1, acc_y0))
    no_bank = [hall_rc] + plat_rects + [(-hx - 9.0, -hx + 0.05, -hy - 4.4, acc_y0)]   # + the west yard apron
    zt = [[site.terrain_z(x, y) + 0.03 for x in gx] for y in gy]
    zk = [[bank_top(x, y) for x in gx] for y in gy]
    bverts, bfaces, buvs, vid = [], [], [], {}

    def bv(i, j):
        if (i, j) not in vid:
            vid[(i, j)] = len(bverts)
            bverts.append((gx[i], gy[j], max(zt[j][i], zk[j][i])))
        return vid[(i, j)]

    for j in range(len(gy) - 1):
        for i in range(len(gx) - 1):
            cxm, cym = (gx[i] + gx[i + 1]) / 2, (gy[j] + gy[j + 1]) / 2
            if any(rc[0] < cxm < rc[1] and rc[2] < cym < rc[3] for rc in no_bank):
                continue
            corners = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if not any(zk[jj][ii] > zt[jj][ii] + 0.02 for ii, jj in corners):
                continue
            q = [bv(ii, jj) for ii, jj in corners]
            for tri in ((q[0], q[1], q[2]), (q[0], q[2], q[3])):
                bfaces.append(list(tri))
                buvs.append([(bverts[t][0] / 2.0, bverts[t][1] / 2.0) for t in tri])   # grass tile = 2 m
    if not bfaces:
        raise RuntimeError("north embankment produced no faces - terrain probe or bank heights are wrong")
    b.mesh("bank", bverts, bfaces, buvs, color=(0.9, 0.9, 0.9))
    print(f"[halle] north embankment: {len(bfaces)} triangles, terrace slab top {zP:.2f}, "
          f"max fill {max(zk[j][i] - zt[j][i] for j in range(len(gy)) for i in range(len(gx))):.2f} m")

    # ------------------------------------------------------------------
    # 4. Grain silos on the terrace slab + catwalk, elevator, pipes
    # ------------------------------------------------------------------
    tops = []
    for i, (sx, sy) in enumerate(cfg["silo_centres"]):
        zb = zP + 0.02
        with b.place(sx, sy, 0.0):
            z_top, cone_h = silo(b, r, cfg["silo_wall_h"], zb, with_ladder=(i == 0), ladder_angle=PI * 1.02)
        tops.append((sx, sy, z_top, cone_h, zb))
    (ax, ay, a_top, a_cone, a_zb), (bx_, by_, b_top, b_cone, b_zb) = tops
    peak = max(a_top + a_cone, b_top + b_cone) + 0.55
    # catwalk bridge across both silo peaks, carrying the chain conveyor
    cw0 = Vector((ax - r - 1.3, ay, peak))
    cw1 = Vector((bx_ + 0.9, by_, peak))
    b.box("galv", cw0.x, cw1.x, ay - 0.45, ay + 0.45, peak - 0.06, peak)
    for sy in (-0.45, 0.45):
        b.box("galv", cw0.x, cw1.x, ay + sy - 0.03, ay + sy + 0.03, peak - 0.20, peak - 0.06)
        railing(b, "galv", [(cw0.x, ay + sy, peak), (cw1.x, ay + sy, peak)])
    b.box("silo", cw0.x + 0.3, cw1.x - 0.5, ay - 0.16, ay + 0.16, peak + 0.10, peak + 0.42)        # conveyor trough
    for cx_, cy_, ctop, ccone, _ in tops:
        b.cyl("silo", (cx_, cy_, peak + 0.10), (cx_, cy_, ctop + ccone + 0.30), 0.16, seg=8)      # drop spout
        for sx_ in (-0.5, 0.5):
            b.cyl("galv", (cx_ + sx_, cy_ - 0.4, peak - 0.06), (cx_ + sx_ * 2.2, cy_ - 0.4, ctop + ccone * 0.55), 0.03, seg=5)
            b.cyl("galv", (cx_ + sx_, cy_ + 0.4, peak - 0.06), (cx_ + sx_ * 2.2, cy_ + 0.4, ctop + ccone * 0.55), 0.03, seg=5)
    # bucket elevator leg + intake hopper at the west end of the catwalk
    ex, ey = cw0.x + 0.1, ay
    ez0 = zP + 0.02
    for sy in (-0.24, 0.24):
        b.box("silo", ex - 0.17, ex + 0.17, ey + sy - 0.13, ey + sy + 0.13, ez0 + 0.9, peak + 1.5, uv="long")
    b.box("silo", ex - 0.30, ex + 0.30, ey - 0.50, ey + 0.50, peak + 1.5, peak + 2.25)             # head
    b.box("silo", ex - 0.33, ex + 0.33, ey - 0.52, ey + 0.52, ez0, ez0 + 0.95)                     # boot
    b.cyl("trim", (ex - 0.32, ey, peak + 1.95), (ex - 0.62, ey, peak + 1.95), 0.20, seg=10)        # drive motor
    b.tube("silo", [(ex + 0.25, ey, peak + 1.6), (ex + 0.8, ey, peak + 0.95), (ex + 1.2, ey, peak + 0.42)], 0.13, seg=8)
    for zb_ in (ez0 + 2.5, ez0 + 5.0, peak - 0.3):
        b.box("galv", ex - 0.20, ex + 0.20, ey - 0.40, ey + 0.40, zb_ - 0.03, zb_ + 0.03)
    # intake pit: concrete kerb + steel grating + tipping apron
    px, py = ex - 2.0, ey - 0.2
    pz = zP - 0.10
    if not (tx0 + 1.6 < px < tx1 and ty0 + 1.4 < py < ty1 - 1.4):
        raise RuntimeError(f"intake pit ({px:.2f}, {py:.2f}) is not on the terrace slab")
    b.box("concrete", px - 1.5, px + 1.5, py - 1.3, py + 1.3, pz - 1.4, pz + 0.12)
    b.box("interior", px - 1.25, px + 1.25, py - 1.05, py + 1.05, pz + 0.10, pz + 0.125)
    for k in range(13):
        xx = px - 1.25 + 2.5 * k / 12
        b.box("galv", xx - 0.015, xx + 0.015, py - 1.05, py + 1.05, pz + 0.12, pz + 0.16)
    for k in range(4):
        yy = py - 1.05 + 2.1 * k / 3
        b.box("galv", px - 1.25, px + 1.25, yy - 0.02, yy + 0.02, pz + 0.115, pz + 0.155)
    b.tube("silo", [(px + 1.0, py, pz - 0.2), (ex - 0.25, ey, ez0 + 0.5)], 0.14, seg=8)
    # blower pipes from each silo base into the hall's north wall
    for (sx, sy, ztop, _, zb) in tops:
        ppx = min(max(sx + 1.2, -hx + 1.0), hx - 1.0)
        b.tube("galv", [(sx + 1.0, sy - r + 0.25, zb + 0.9), (ppx, sy - r - 0.25, zb + 0.9), (ppx, sy - r - 0.25, z_plinth + 1.2),
                        (ppx, hy - 0.05, z_plinth + 1.2)], 0.08, seg=8)
        b.cyl("galv", (sx + 1.0, sy - r + 0.4, zb + 0.9), (sx + 1.0, sy - r + 0.05, zb + 0.9), 0.13, seg=8)

    # ------------------------------------------------------------------
    # 5. Yard details: diesel tank, pallets, IBC, bollards at the door jambs
    # ------------------------------------------------------------------
    with b.at(fac["W"].frame):
        for uc, w, _ in w_doors:
            for sx in (-1, 1):
                ux = uc + sx * (w / 2 + 0.32)
                b.cyl("tank", (ux, -0.32, F - 0.3), (ux, -0.32, F + 0.95), 0.085, seg=10)
        # pallets + harvest bins between door B and the personnel door
        eu.pallet(b, "wood", 17.5, -0.75, F - 0.02, rz=0.08)
        eu.pallet(b, "wood", 17.5, -0.75, F + 0.105, rz=0.02)
        eu.pallet(b, "wood", 17.45, -0.77, F + 0.23, rz=0.12)
        for lvl in range(2):
            bz = F + lvl * 0.80
            b.box("bin", 21.4, 22.6, -1.25, -0.25, bz + 0.12, bz + 0.78)
            for fx in (21.5, 22.0, 22.5):
                b.box("bin", fx - 0.06, fx + 0.06, -1.25, -0.25, bz, bz + 0.12)
    # diesel tank on a steel cradle against the south wall (east end)
    with b.at(fac["S"].frame):
        tx = L - 4.2
        zt = F + 1.05
        b.cyl("tank", (tx - 1.1, -1.0, zt), (tx + 1.1, -1.0, zt), 0.55, seg=16)
        for xs in (-1, 1):
            b.box("trim", tx + xs * 0.75 - 0.05, tx + xs * 0.75 + 0.05, -1.5, -0.5, F - 0.25, zt - 0.38)
        b.box("concrete", tx - 1.5, tx + 1.5, -1.75, -0.25, F - 0.5, F + 0.14)
        b.cyl("galv", (tx + 0.3, -1.0, zt + 0.5), (tx + 0.3, -1.0, zt + 0.75), 0.06, seg=8)
        b.box("trim", tx - 0.75, tx - 0.45, -1.62, -1.50, zt - 0.15, zt + 0.35)        # pump cabinet

    # ------------------------------------------------------------------
    # Colliders (replace the OSM footprint): hall with the drive-in bay notched out, silos, elevator, tank
    # ------------------------------------------------------------------
    R = eu.rect_poly
    bay_uc, bay_w = w_doors[1][0], w_doors[1][1]
    by_hi, by_lo = hy - (bay_uc - bay_w / 2 + 0.1), hy - (bay_uc + bay_w / 2 - 0.1)
    bx_end = -hx + BAY_DEPTH - 1.2
    oct_ = [(math.cos(k * PI / 4 + PI / 8), math.sin(k * PI / 4 + PI / 8)) for k in range(8)]
    solids = [
        [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy), (-hx, by_hi), (bx_end, by_hi), (bx_end, by_lo), (-hx, by_lo)],
        R(ex - 0.55, ex + 0.55, ey - 0.75, ey + 0.75),                 # bucket elevator
        R(px - 1.55, px + 1.55, py - 1.35, py + 1.35),                 # intake pit kerb
        R(hx - 5.8, hx - 2.6, -hy - 1.8, -hy),                         # diesel tank on its plinth
        R(-hx - 1.4, -hx, hy - 23.0, hy - 16.6),                       # pallets + bins beside the personnel door
        R(tx0 - 1.5, tx1 + 1.5, ty0, ty1 + 1.5),                       # raised silo terrace + its embankment
        R(tx0 - 1.5, -hx, acc_y0 + 2.5, ty0),                          # terrace access strip where it is raised
        R(tx1 + 1.5, hx + 0.8, hy, hy + 3.0),                          # embankment along the north wall
    ]
    for (sx, sy, _, _, _) in tops:
        solids.append([(sx + (r + 0.4) * cx_, sy + (r + 0.4) * cy_) for cx_, cy_ in oct_])
    objects = b.finalize(col, ground_z=F)
    if do_export:
        eu.export_landmark(KEY, objects, site=site, solids=solids, replace_footprint=True)
    return objects


if __name__ == "__main__":
    build_agri_halle(eu.load_override_params(KEY), do_render=False, do_export=True)
