#!/usr/bin/env python3
"""
Hero Landmark #4: Traditional Pfalz Winzerhof / Bauernhof with Timber-Framed Scheune (Barn).
Authentic Palatinate rural farmstead featuring:
- Grand Pfalz Scheune (barn) with dressed sandstone ground story, authentic 3D exposed dark oak
  Fachwerk (timber framing with corner braces, posts & girts) over warm stucco upper story & gables
- Towering double recessed wooden carriage barn gates (Scheunentor) with Z-bracing & wrought-iron hinges
- Upper hayloft loading shutter (Heuluke) + projecting oak hoist beam (Aufzugsbalken)
- Steep terracotta clay-tiled gabled roof with timber eaves rafters, ridge cap & copper gutters
- Connected L-shaped stucco farmhouse/stable courtyard wing with heritage red timber shutters
"""

import math
import bmesh
from mathutils import Vector

from arch_utils import (
    ARTIFACT_DIR,
    GLB_OUT_DIR,
    LANDMARKS_DIR,
    add_box,
    add_chimney,
    add_framed_window,
    add_gable_wall_triangles,
    add_gutter_and_downspout,
    add_pitched_roof_solid,
    add_quoins,
    add_ridge_cap,
    add_wine_barrel,
    clear_scene,
    ensure_collection,
    finalize_mesh,
    get_pbr_material,
    render_preview,
    save_blend_and_export_glb,
)


DEFAULT_PARAMS = {
    "length_x": 18.2,         # Barn main ridge length along X
    "depth_y": 14.5,          # Total L-farmstead depth along Y
    "barn_wall_h": 6.4,       # Tall Palatinate Scheune eave height
    "barn_roof_h": 4.9,       # Steep clay tiled barn gable height
    "foundation_depth": 1.6,
    "wall_tex": "stucco_terracotta",
    "barn_plaster_tex": "stucco_warm_cream",
    "stone_tex": "sandstone_yellow",
    "plinth_tex": "sandstone_red",
    "roof_tex": "roof_clay_tiles",
    "shutter_tex": "wood_shutter_red",
}


def _add_fachwerk_wall(bm_wood, cx, cy, z0, z1, span, face_rot_z, bays=5, protrude=0.055):
    """
    Build authentic 3D Palatinate Fachwerk (half-timbering) along a wall face:
    horizontal sill + head plates, vertical posts, mid girt rail, and diagonal corner braces (Streben).
    Local outward normal is -Y when face_rot_z = 0.
    """
    h = z1 - z0
    t = 0.16  # beam thickness
    d = protrude * 2.0
    cos_r, sin_r = math.cos(face_rot_z), math.sin(face_rot_z)

    def place(lx, lz, sx, sz, tilt=0.0):
        wx = cx + lx * cos_r
        wy = cy + lx * sin_r
        # Offset slightly outward along local -Y -> (sin_r, -cos_r)
        wx += sin_r * protrude * 0.45
        wy += -cos_r * protrude * 0.45
        add_box(bm_wood, wx, wy, lz, sx, d, sz, rot_z=face_rot_z, rot_y=tilt)

    # Bottom sill, mid rail, top eaves plate
    place(0.0, z0 + t * 0.5, span + 0.08, t)
    place(0.0, z0 + h * 0.52, span + 0.06, t * 0.85)
    place(0.0, z1 - t * 0.5, span + 0.08, t)

    # Vertical posts
    step = span / bays
    for i in range(bays + 1):
        px = -span * 0.5 + i * step
        place(px, z0 + h * 0.5, t, h)
        # Diagonal corner braces (Kopfstreben / Fußstreben) in outer bays
        if i == 0:
            diag_len = math.hypot(step * 0.72, h * 0.82)
            ang = math.atan2(step * 0.72, h * 0.82)
            place(px + step * 0.36, z0 + h * 0.5, t * 0.82, diag_len, tilt=ang)
        elif i == bays - 1:
            diag_len = math.hypot(step * 0.72, h * 0.82)
            ang = -math.atan2(step * 0.72, h * 0.82)
            place(px + step * 0.64, z0 + h * 0.5, t * 0.82, diag_len, tilt=ang)


def _add_gable_fachwerk(bm_wood, gx, cy, z_eave, width_y, ridge_h, sign_x: float):
    """Exposed Fachwerk timbers on the triangular gable end wall at X = gx (outward sign_x = -1 or +1)."""
    off_x = gx + sign_x * 0.03
    t = 0.15
    # Collar tie beams at 2 levels + king post + flanking posts + diagonal struts
    for frac in (0.04, 0.38, 0.70):
        span_y = width_y * (1.0 - frac)
        if span_y > 0.6:
            add_box(bm_wood, off_x, cy, z_eave + ridge_h * frac, 0.10, span_y, t)
    # Center king post & side struts
    add_box(bm_wood, off_x, cy, z_eave + ridge_h * 0.5, 0.10, t, ridge_h)
    for sy in (-width_y * 0.24, width_y * 0.24):
        ph = ridge_h * (1.0 - abs(sy) / (width_y * 0.5))
        add_box(bm_wood, off_x, cy + sy, z_eave + ph * 0.5, 0.10, t, ph)


def build_winzerhof(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    clear_scene()
    col = ensure_collection("Winzerhof_Barn_Kindenheim")

    mats = {
        "stucco": get_pbr_material("Winzerhof_House_Stucco", cfg["wall_tex"], normal_strength=0.9),
        "barn_plaster": get_pbr_material("Winzerhof_Barn_Plaster", cfg["barn_plaster_tex"], normal_strength=0.95),
        "sandstone_yellow": get_pbr_material("Winzerhof_Sandstone", cfg["stone_tex"], normal_strength=1.25),
        "sandstone_red": get_pbr_material("Winzerhof_Plinth", cfg["plinth_tex"], normal_strength=1.3),
        "roof_clay": get_pbr_material("Winzerhof_Clay_Roof", cfg["roof_tex"], normal_strength=1.35),
        "wood_dark": get_pbr_material("Winzerhof_Fachwerk_Oak", "wood_timber_dark", normal_strength=1.15),
        "wood_barn": get_pbr_material("Winzerhof_Barn_Gates", "wood_barn_planks", normal_strength=1.2),
        "shutter_red": get_pbr_material("Winzerhof_Shutters", cfg["shutter_tex"], normal_strength=1.2),
        "glass_warm": get_pbr_material("Winzerhof_Glass", "window_glass_warm", normal_strength=0.4),
        "cobble": get_pbr_material("Winzerhof_Yard_Cobble", "cobble_courtyard", normal_strength=1.2),
        "barrel": get_pbr_material("Winzerhof_Barrels", "wood_barrel_oak", normal_strength=1.1),
        "copper": get_pbr_material("Winzerhof_Copper", "copper_patina", normal_strength=0.7),
        "iron": get_pbr_material("Winzerhof_Iron", "iron_dark", normal_strength=0.7),
    }
    bms = {k: bmesh.new() for k in mats.keys()}

    L = cfg["length_x"]
    D = cfg["depth_y"]
    Hb = cfg["barn_wall_h"]
    Rhb = cfg["barn_roof_h"]
    fd = cfg["foundation_depth"]

    # L-shaped Pfalz Bauernhof layout inside [-L/2, +L/2] x [-D/2, +D/2]:
    # - Main tall Scheune (barn) across the rear (+Y): full width L, depth ~54% of D
    # - Attached Farm/Stable Wing along the West side (-X) projecting forward toward the street (-Y)
    # - Open cobbled farmyard apron on the South-East quadrant framing the grand barn gates!
    barn_d = min(8.6, D * 0.56)
    barn_cy = D * 0.5 - barn_d * 0.5
    stone_h = 3.55  # heavy sandstone ground floor of barn

    wing_w = max(5.6, L * 0.34)
    wing_d = D - barn_d + 0.5
    wing_cx = -L * 0.5 + wing_w * 0.5
    wing_cy = -D * 0.5 + wing_d * 0.5
    wing_h = Hb * 0.82
    wing_rh = wing_w * 0.45

    # ------------------------------------------------------------------
    # 1. Unified Stone Foundation Skirt (-1.6m) + Cobblestone Farmyard Pad
    # ------------------------------------------------------------------
    add_box(bms["sandstone_red"], 0.0, 0.0, (-fd + 0.04) * 0.5, L + 0.22, D + 0.22, fd + 0.04)
    add_box(bms["cobble"], 0.0, 0.0, 0.06, L - 0.06, D - 0.06, 0.08)

    # ------------------------------------------------------------------
    # 2. Grand Palatinate Timber-Framed Scheune (Barn)
    # ------------------------------------------------------------------
    # Heavy stone ground level + water-table ledge
    add_box(bms["sandstone_yellow"], 0.0, barn_cy, stone_h * 0.5, L, barn_d, stone_h)
    add_box(bms["sandstone_red"], 0.0, barn_cy, stone_h + 0.07, L + 0.20, barn_d + 0.20, 0.14)
    # Upper warm lime-plaster hayloft story
    add_box(bms["barn_plaster"], 0.0, barn_cy, stone_h + (Hb - stone_h) * 0.5, L - 0.04, barn_d - 0.04, Hb - stone_h)

    # Corner sandstone quoins on lower barn masonry
    for sx, dx in [(-L * 0.5, 1.0), (L * 0.5, -1.0)]:
        for sy, dy in [(barn_cy - barn_d * 0.5, 1.0), (barn_cy + barn_d * 0.5, -1.0)]:
            add_quoins(bms["sandstone_red"], sx, sy, 0.10, stone_h - 0.05, dx, dy,
                       course_h=0.44, long_l=0.68, short_l=0.38, protrude=0.05)

    # Authentic 3D Fachwerk timber framing on upper barn walls & both triangular gables!
    _add_fachwerk_wall(bms["wood_dark"], 0.0, barn_cy - barn_d * 0.5, stone_h + 0.12, Hb, L - 0.04, 0.0, bays=6)
    _add_fachwerk_wall(bms["wood_dark"], 0.0, barn_cy + barn_d * 0.5, stone_h + 0.12, Hb, L - 0.04, math.pi, bays=6)
    _add_fachwerk_wall(bms["wood_dark"], -L * 0.5, barn_cy, stone_h + 0.12, Hb, barn_d - 0.04, -math.pi * 0.5, bays=3)
    _add_fachwerk_wall(bms["wood_dark"],  L * 0.5, barn_cy, stone_h + 0.12, Hb, barn_d - 0.04,  math.pi * 0.5, bays=3)

    # Triangular gable walls + exposed gable Fachwerk
    add_gable_wall_triangles(bms["barn_plaster"], 0.0, barn_cy, Hb, L - 0.04, barn_d - 0.04, Rhb, wall_thick=0.38)
    _add_gable_fachwerk(bms["wood_dark"], -L * 0.5, barn_cy, Hb, barn_d - 0.04, Rhb, -1.0)
    _add_gable_fachwerk(bms["wood_dark"],  L * 0.5, barn_cy, Hb, barn_d - 0.04, Rhb,  1.0)

    # Towering Double Wooden Barn Carriage Gates (Scheunentor) facing courtyard (-Y)!
    gate_cx = L * 0.18
    gate_y = barn_cy - barn_d * 0.5
    gate_w = 3.70
    gate_h = 3.95
    # Heavy dressed sandstone portal jambs & massive oak lintel beam (extends slightly into upper story!)
    add_box(bms["sandstone_red"], gate_cx - gate_w * 0.5 - 0.22, gate_y - 0.08, gate_h * 0.5, 0.44, 0.36, gate_h)
    add_box(bms["sandstone_red"], gate_cx + gate_w * 0.5 + 0.22, gate_y - 0.08, gate_h * 0.5, 0.44, 0.36, gate_h)
    add_box(bms["wood_dark"], gate_cx, gate_y - 0.12, gate_h + 0.14, gate_w + 1.05, 0.38, 0.28)
    # Dark interior barn recess behind ajar gate so it has real shadow depth
    add_box(bms["iron"], gate_cx, gate_y + 0.16, gate_h * 0.5, gate_w - 0.08, 0.08, gate_h - 0.08)

    # Left gate leaf (closed) + Right gate leaf (swung outward 28 deg for authentic rural liveliness!)
    leaf_w = gate_w * 0.5 - 0.03
    # Left leaf closed
    lx_c = gate_cx - leaf_w * 0.5 - 0.015
    add_box(bms["wood_barn"], lx_c, gate_y - 0.03, gate_h * 0.5, leaf_w, 0.10, gate_h - 0.06)
    for rz in (0.45, gate_h * 0.5, gate_h - 0.45):
        add_box(bms["wood_dark"], lx_c, gate_y - 0.09, rz, leaf_w - 0.06, 0.06, 0.15)
        add_box(bms["iron"], gate_cx - gate_w * 0.5 + 0.48, gate_y - 0.12, rz, 0.92, 0.04, 0.06)
    # Diagonal timber Z-brace on left leaf
    add_box(bms["wood_dark"], lx_c, gate_y - 0.09, gate_h * 0.5, 0.14, 0.05, gate_h * 0.78, rot_y=math.radians(24))

    # Right leaf swung outward 28 deg into courtyard
    ang_r = math.radians(28.0)
    hx_r = gate_cx + gate_w * 0.5
    cx_r = hx_r - leaf_w * 0.5 * math.cos(ang_r)
    cy_r = gate_y - 0.03 - leaf_w * 0.5 * math.sin(ang_r)
    add_box(bms["wood_barn"], cx_r, cy_r, gate_h * 0.5, leaf_w, 0.10, gate_h - 0.06, rot_z=ang_r)
    for rz in (0.45, gate_h * 0.5, gate_h - 0.45):
        add_box(bms["wood_dark"], cx_r, cy_r, rz, leaf_w - 0.06, 0.14, 0.15, rot_z=ang_r)
        add_box(bms["iron"], hx_r - 0.48 * math.cos(ang_r), gate_y - 0.03 - 0.48 * math.sin(ang_r), rz,
                0.92, 0.16, 0.06, rot_z=ang_r)

    # Secondary smaller stable doorway to the right of the main gate (clean jambs + lintel framing recessed planks!)
    sd_x = L * 0.5 - 1.55
    add_box(bms["sandstone_red"], sd_x - 0.66, gate_y - 0.08, 1.15, 0.22, 0.22, 2.30)
    add_box(bms["sandstone_red"], sd_x + 0.66, gate_y - 0.08, 1.15, 0.22, 0.22, 2.30)
    add_box(bms["sandstone_red"], sd_x, gate_y - 0.09, 2.36, 1.58, 0.26, 0.24)
    add_box(bms["wood_barn"], sd_x, gate_y - 0.03, 1.14, 1.12, 0.09, 2.24)
    for hz in (0.55, 1.75):
        add_box(bms["iron"], sd_x - 0.30, gate_y - 0.085, hz, 0.48, 0.03, 0.05)
    # Upper hayloft loading shutter (Heuluke) + projecting timber hoist beam above barn gate!
    add_box(bms["wood_dark"], gate_cx, gate_y - 0.08, stone_h + 1.48, 1.65, 0.16, 1.75)
    add_box(bms["wood_barn"], gate_cx, gate_y - 0.11, stone_h + 1.48, 1.42, 0.08, 1.52)
    add_box(bms["wood_dark"], gate_cx, gate_y - 0.65, Hb - 0.22, 0.20, 1.45, 0.22)  # hoist beam!
    # Vertical ventilation slits in upper barn & gable loft hatch on East gable
    for vx in (-L * 0.10, L * 0.40):
        add_box(bms["wood_dark"], vx, gate_y - 0.04, stone_h + 1.45, 0.26, 0.08, 1.15)
    # East gable hayloft shutter + hoist beam
    add_box(bms["wood_dark"], L * 0.5 + 0.04, barn_cy, Hb + Rhb * 0.32, 0.14, 1.45, 1.65)
    add_box(bms["wood_barn"], L * 0.5 + 0.07, barn_cy, Hb + Rhb * 0.32, 0.08, 1.22, 1.42)
    add_box(bms["wood_dark"], L * 0.5 + 0.65, barn_cy, Hb + Rhb * 0.64, 1.40, 0.20, 0.22)

    # Steep terracotta clay-tiled barn roof + exposed rafter tails + ridge cap + copper gutters
    add_pitched_roof_solid(
        bms["roof_clay"], 0.0, barn_cy, Hb,
        length_x=L, width_y=barn_d, ridge_h=Rhb,
        overhang_x=0.58, overhang_y=0.62, thickness=0.25
    )
    add_ridge_cap(
        bms["roof_clay"],
        Vector((-L * 0.5 - 0.58, barn_cy, Hb + Rhb + 0.25)),
        Vector(( L * 0.5 + 0.58, barn_cy, Hb + Rhb + 0.25)),
        radius=0.15
    )
    slope_b = Rhb / max(barn_d * 0.5, 0.1)
    # Exposed dark oak eaves rafter tails along front & back eaves
    for side in (-1.0, 1.0):
        ey = barn_cy + side * (barn_d * 0.5 + 0.32)
        ez = Hb - slope_b * 0.32 - 0.06
        for k in range(13):
            rx = -L * 0.48 + k * (L * 0.96 / 12.0)
            add_box(bms["wood_dark"], rx, ey, ez, 0.12, 0.72, 0.14, rot_x=-side * math.atan(slope_b))
        add_gutter_and_downspout(
            bms, -L * 0.5 - 0.58, L * 0.5 + 0.58,
            barn_cy + side * (barn_d * 0.5 + 0.66), Hb - slope_b * 0.62 + 0.04, 0.0,
            copper_key="copper", downspout_x=L * 0.47
        )

    # ------------------------------------------------------------------
    # 3. Attached Courtyard Dwelling / Stable Wing (West L-Wing)
    # ------------------------------------------------------------------
    w_ph = 0.75
    add_box(bms["sandstone_red"], wing_cx, wing_cy, w_ph * 0.5, wing_w + 0.18, wing_d + 0.18, w_ph)
    add_box(bms["sandstone_yellow"], wing_cx, wing_cy, w_ph + 0.05, wing_w + 0.24, wing_d + 0.24, 0.11)
    add_box(bms["stucco"], wing_cx, wing_cy, w_ph + (wing_h - w_ph) * 0.5, wing_w, wing_d, wing_h - w_ph)
    # Quoins on front two corners of wing
    for sx, dx in [(wing_cx - wing_w * 0.5, 1.0), (wing_cx + wing_w * 0.5, -1.0)]:
        add_quoins(bms["sandstone_yellow"], sx, -D * 0.5, w_ph + 0.12, wing_h - 0.15, dx, 1.0,
                   course_h=0.38, long_l=0.55, short_l=0.32, protrude=0.045)

    # Shuttered farmhouse windows on front (-Y), west (-X), and courtyard east (+X) faces
    wz1 = w_ph + (wing_h - w_ph) * 0.28
    wz2 = w_ph + (wing_h - w_ph) * 0.72
    # Street-facing gable front (-Y)
    for wx in (wing_cx - wing_w * 0.24, wing_cx + wing_w * 0.24):
        add_framed_window(bms, Vector((wx, -D * 0.5, wz1)), 0.0, width=0.98, height=1.34,
                          has_shutters=True, shutter_key="shutter_red", mullions=(1, 1))
        add_framed_window(bms, Vector((wx, -D * 0.5, wz2)), 0.0, width=0.98, height=1.34,
                          has_shutters=True, shutter_key="shutter_red", mullions=(1, 1))
    add_framed_window(bms, Vector((wing_cx, -D * 0.5, wing_h + wing_rh * 0.36)), 0.0, width=0.88, height=1.08,
                      has_shutters=False, mullions=(1, 1))

    # Courtyard-facing east wall of wing (+X, rot_z = +pi/2)
    ex_wing = wing_cx + wing_w * 0.5
    wy_list = [wing_cy - wing_d * 0.26, wing_cy + wing_d * 0.18]
    for idx, wy in enumerate(wy_list):
        add_framed_window(bms, Vector((ex_wing, wy, wz2)), math.pi * 0.5, width=0.96, height=1.32,
                          has_shutters=True, shutter_key="shutter_red", mullions=(1, 1))
        if idx == 1:
            # Farmhouse courtyard entrance door + stone steps (framed jambs + lintel around recessed oak door!)
            add_box(bms["sandstone_yellow"], ex_wing + 0.35, wy, w_ph * 0.5, 0.70, 1.62, w_ph)
            add_box(bms["sandstone_yellow"], ex_wing + 0.07, wy - 0.64, w_ph + 1.10, 0.20, 0.20, 2.20)
            add_box(bms["sandstone_yellow"], ex_wing + 0.07, wy + 0.64, w_ph + 1.10, 0.20, 0.20, 2.20)
            add_box(bms["sandstone_yellow"], ex_wing + 0.08, wy, w_ph + 2.28, 0.24, 1.54, 0.22)
            add_box(bms["wood_dark"], ex_wing + 0.04, wy, w_ph + 1.08, 0.08, 1.10, 2.16)
        else:
            add_framed_window(bms, Vector((ex_wing, wy, wz1)), math.pi * 0.5, width=0.96, height=1.32,
                              has_shutters=True, shutter_key="shutter_red", mullions=(1, 1))

    # Wing pitched clay-tile roof tying cleanly into the main barn! (ridge along Y -> rot_z = pi/2)
    add_gable_wall_triangles(bms["stucco"], wing_cx, wing_cy, wing_h, wing_d, wing_w, wing_rh,
                             wall_thick=0.35, rot_z=math.pi * 0.5, both_ends=False, west_end=True, east_end=False)
    add_pitched_roof_solid(
        bms["roof_clay"], wing_cx, wing_cy + 0.55, wing_h,
        length_x=wing_d + 1.10, width_y=wing_w, ridge_h=wing_rh,
        overhang_x=0.45, overhang_y=0.46, thickness=0.22, rot_z=math.pi * 0.5
    )
    add_ridge_cap(
        bms["roof_clay"],
        Vector((wing_cx, -D * 0.5 - 0.45, wing_h + wing_rh + 0.22)),
        Vector((wing_cx, barn_cy, wing_h + wing_rh + 0.22)),
        radius=0.13
    )
    add_chimney(bms, wing_cx - 0.65, wing_cy + 0.3, wing_h + wing_rh * 0.55, wing_h + wing_rh + 0.92,
                wall_key="stucco", stone_key="sandstone_red")

    # Farmyard courtyard details: low east garden wall + stacked firewood/timber beams + 3 oak barrels
    add_box(bms["sandstone_yellow"], L * 0.5 - 0.22, -D * 0.5 + (D - barn_d) * 0.5, 0.85, 0.40, D - barn_d, 1.55)
    add_box(bms["sandstone_red"], L * 0.5 - 0.22, -D * 0.5 + (D - barn_d) * 0.5, 1.68, 0.52, D - barn_d + 0.1, 0.14)
    # 3 rustic oak barrels beside stable door
    for i, dy in enumerate((-0.45, 0.35)):
        add_wine_barrel(bms, L * 0.5 - 1.05, -D * 0.5 + 2.2 + dy, 0.10,
                        radius=0.35, length=0.88, standing=True, wood_key="barrel", iron_key="iron")
    add_wine_barrel(bms, L * 0.5 - 1.05, -D * 0.5 + 3.25, 0.10,
                    radius=0.36, length=0.90, standing=False, rot_z=0.35, wood_key="barrel", iron_key="iron")
    # Stacked cut oak timber logs under the barn eaves
    for row in range(3):
        for col_i in range(3 - row):
            add_box(bms["wood_dark"], ex_wing + 0.55 + col_i * 0.24 + row * 0.12, -D * 0.5 + 1.45,
                    0.20 + row * 0.20, 0.20, 1.85, 0.18)

    # ------------------------------------------------------------------
    # Finalize meshes
    # ------------------------------------------------------------------
    uv_specs = {
        "stucco":           (3.0, 3.0, False, False),
        "barn_plaster":     (3.0, 3.0, False, False),
        "sandstone_yellow": (2.3, 2.3, False, False),
        "sandstone_red":    (2.4, 2.4, False, False),
        "roof_clay":        (2.4, 2.4, True,  False),
        "wood_dark":        (1.6, 1.6, False, False),
        "wood_barn":        (1.8, 2.0, False, False),
        "shutter_red":      (0.6, 1.4, False, False),
        "glass_warm":       (1.2, 1.5, False, False),
        "cobble":           (2.4, 2.4, False, False),
        "barrel":           (1.1, 1.0, False, False),
        "copper":           (1.5, 1.5, False, False),
        "iron":             (1.0, 1.0, False, False),
    }

    objects = []
    for key, (tu, tv, slope, fit) in uv_specs.items():
        bm = bms[key]
        if len(bm.verts) == 0:
            bm.free()
            continue
        obj = finalize_mesh(
            f"Winzerhof_{key}", bm, mats[key], col,
            tile_u=tu, tile_v=tv, slope_align=slope, fit_uv=fit,
            smooth=(key in ("barrel", "copper")),
        )
        objects.append(obj)

    if do_export:
        save_blend_and_export_glb(
            LANDMARKS_DIR / "winzerhof_barn.blend",
            GLB_OUT_DIR / "winzerhof_barn.glb",
            objects,
        )
    if do_render:
        render_preview(
            ARTIFACT_DIR / "preview_winzerhof_barn.png",
            objects,
            cam_azimuth_deg=36.0,
            cam_elev_deg=22.0,
            dist_mult=1.88,
            samples=36,
        )
    return objects


if __name__ == "__main__":
    build_winzerhof()
