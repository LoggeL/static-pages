#!/usr/bin/env python3
"""
Hero Landmark #3: Historic Pfalz Weingut (Winery Courtyard Ensemble, Hauptstraße Kindenheim).
Authentic Palatinate Hofanlage featuring:
- Main 2-story stucco Winzerhaus with sandstone plinth, quoins, shuttered windows, dormers
- Iconic Pfalz Sandstein Torbogen (grand vaulted sandstone winery gateway + pedestrian wicket
  arch + radiating voussoirs + keystone + heavy open timber carriage gates)
- L-wing Kelterhaus & vaulted sandstone wine cellar wing with loft hoist beam
- Cobblestone courtyard base + stacked curved oak wine barrels (Barriques) + stone trough
"""

import math
import bmesh
from mathutils import Matrix, Vector

from arch_utils import (
    ARTIFACT_DIR,
    GLB_OUT_DIR,
    LANDMARKS_DIR,
    add_box,
    add_chimney,
    add_cylinder,
    add_dormer,
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
    "length_x": 19.5,         # Street frontage along X (Main house + Torbogen + Wing end)
    "depth_y": 15.0,          # Ensemble depth back into courtyard along Y
    "house_wall_h": 6.6,      # Main Winzerhaus eave height
    "house_roof_h": 4.2,      # Main Winzerhaus gable roof height
    "foundation_depth": 1.6,
    "plinth_h": 0.78,
    "wall_tex": "stucco_warm_cream",
    "wing_wall_tex": "stucco_ochre",
    "stone_tex": "sandstone_yellow",
    "plinth_tex": "sandstone_red",
    "roof_tex": "roof_clay_tiles",
    "shutter_tex": "wood_shutter_green",
}


def _add_sandstone_archway(
    bms: dict,
    cx: float, cy: float, z0: float,
    wall_w: float, wall_h: float, wall_thick: float,
    arch_w: float, arch_spring_h: float,
    has_wicket: bool = True,
    gate_open_deg: float = 48.0,
):
    """
    Build a genuine 3D thick Palatinate sandstone Torbogen archway along X (facing -Y street).
    Includes arched vault opening, radiating 3D voussoirs, projecting keystone, coping tiles,
    optional pedestrian Mannpforte arch, and ajar heavy double timber carriage gates.
    """
    bm_st = bms["sandstone_yellow"]
    bm_sr = bms["sandstone_red"]
    bm_wd = bms["wood_barn"]
    bm_dk = bms["wood_dark"]
    bm_ir = bms["iron"]
    bm_rf = bms["roof_clay"]

    arch_cx = cx - (0.65 if has_wicket else 0.0)
    arch_r = arch_w * 0.5
    arch_top_z = z0 + arch_spring_h + arch_r

    left_edge = cx - wall_w * 0.5
    right_edge = cx + wall_w * 0.5

    # Left pier (from left_edge to arch left jamb)
    lp_w = max(0.55, (arch_cx - arch_r) - left_edge)
    add_box(bm_st, left_edge + lp_w * 0.5, cy, z0 + wall_h * 0.5, lp_w, wall_thick, wall_h)

    if has_wicket:
        wick_w = 1.05
        wick_h = 2.05
        wick_cx = right_edge - 0.95
        # Middle pier between carriage arch and wicket door
        mp_x0 = arch_cx + arch_r
        mp_x1 = wick_cx - wick_w * 0.5
        if mp_x1 - mp_x0 > 0.25:
            add_box(bm_st, (mp_x0 + mp_x1) * 0.5, cy, z0 + wall_h * 0.5, mp_x1 - mp_x0, wall_thick, wall_h)
        # Right pier beyond wicket
        rp_x0 = wick_cx + wick_w * 0.5
        rp_w = max(0.45, right_edge - rp_x0)
        add_box(bm_st, rp_x0 + rp_w * 0.5, cy, z0 + wall_h * 0.5, rp_w, wall_thick, wall_h)
        # Spandrel above wicket door
        sp_h = wall_h - wick_h
        if sp_h > 0.2:
            add_box(bm_st, wick_cx, cy, z0 + wick_h + sp_h * 0.5, wick_w + 0.08, wall_thick, sp_h)
        # Wicket recessed oak door + sandstone lintel + iron hinges
        add_box(bm_sr, wick_cx, cy - wall_thick * 0.1, z0 + wick_h + 0.14, wick_w + 0.34, wall_thick + 0.12, 0.26)
        add_box(bm_wd, wick_cx, cy + 0.08, z0 + wick_h * 0.5, wick_w - 0.04, 0.09, wick_h - 0.02)
        add_box(bm_ir, wick_cx + 0.22, cy + 0.02, z0 + 1.0, 0.14, 0.05, 0.06)
    else:
        rp_x0 = arch_cx + arch_r
        rp_w = max(0.55, right_edge - rp_x0)
        add_box(bm_st, rp_x0 + rp_w * 0.5, cy, z0 + wall_h * 0.5, rp_w, wall_thick, wall_h)

    # Spandrel masonry above carriage arch crown (curved underside approximated cleanly with wedge blocks!)
    segs = 12
    for i in range(segs):
        a0 = math.pi * (i / segs)
        a1 = math.pi * ((i + 1) / segs)
        x_in0 = arch_cx + arch_r * math.cos(a0)
        z_in0 = z0 + arch_spring_h + arch_r * math.sin(a0)
        x_in1 = arch_cx + arch_r * math.cos(a1)
        z_in1 = z0 + arch_spring_h + arch_r * math.sin(a1)
        # Spandrel wedge from arch extrados up to top of wall
        z_top = z0 + wall_h
        y0, y1 = cy - wall_thick * 0.5, cy + wall_thick * 0.5
        vf = [
            bm_st.verts.new((x_in0, y0, z_in0)),
            bm_st.verts.new((x_in1, y0, z_in1)),
            bm_st.verts.new((x_in1, y0, z_top)),
            bm_st.verts.new((x_in0, y0, z_top)),
        ]
        vb = [
            bm_st.verts.new((x_in0, y1, z_in0)),
            bm_st.verts.new((x_in1, y1, z_in1)),
            bm_st.verts.new((x_in1, y1, z_top)),
            bm_st.verts.new((x_in0, y1, z_top)),
        ]
        bm_st.faces.new(vf)
        bm_st.faces.new(list(reversed(vb)))
        for k in range(4):
            kn = (k + 1) % 4
            bm_st.faces.new([vf[k], vb[k], vb[kn], vf[kn]])

        # Proud radiating red sandstone voussoir ring stones on both front and back faces!
        r_out = arch_r + (0.48 if i in (segs // 2 - 1, segs // 2) else 0.36)
        px0 = arch_cx + r_out * math.cos(a0)
        pz0 = z0 + arch_spring_h + r_out * math.sin(a0)
        px1 = arch_cx + r_out * math.cos(a1)
        pz1 = z0 + arch_spring_h + r_out * math.sin(a1)
        pro = 0.08 if i % 2 == 0 else 0.05
        yv0, yv1 = cy - (wall_thick * 0.5 + pro), cy + (wall_thick * 0.5 + pro)
        v_f = [
            bm_sr.verts.new((x_in0, yv0, z_in0)),
            bm_sr.verts.new((px0,   yv0, pz0)),
            bm_sr.verts.new((px1,   yv0, pz1)),
            bm_sr.verts.new((x_in1, yv0, z_in1)),
        ]
        v_b = [
            bm_sr.verts.new((x_in0, yv1, z_in0)),
            bm_sr.verts.new((px0,   yv1, pz0)),
            bm_sr.verts.new((px1,   yv1, pz1)),
            bm_sr.verts.new((x_in1, yv1, z_in1)),
        ]
        bm_sr.faces.new(v_f)
        bm_sr.faces.new(list(reversed(v_b)))
        for k in range(4):
            kn = (k + 1) % 4
            bm_sr.faces.new([v_f[k], v_b[k], v_b[kn], v_f[kn]])

    # Projecting carved Keystone (Schlussstein) at the very crown of the Torbogen!
    add_box(bm_sr, arch_cx, cy, arch_top_z + 0.24, 0.42, wall_thick + 0.24, 0.62)

    # Molded impost blocks where arch springs from piers
    for side in (-1.0, 1.0):
        add_box(bm_sr, arch_cx + side * (arch_r + 0.20), cy, z0 + arch_spring_h, 0.52, wall_thick + 0.16, 0.22)
        # Stone wheel guards (Prellsteine / Radabweiser) at the base of the archway!
        add_cylinder(bm_sr, arch_cx + side * (arch_r - 0.10), cy - wall_thick * 0.35, z0 + 0.34,
                     0.24, 0.14, 0.68, segments=10)

    # Sandstone top coping cornice + miniature protective clay tile cap roof along top of Torbogen wall!
    add_box(bm_sr, cx, cy, z0 + wall_h + 0.08, wall_w + 0.22, wall_thick + 0.24, 0.16)
    add_pitched_roof_solid(
        bm_rf, cx, cy, z0 + wall_h + 0.16,
        length_x=wall_w + 0.12, width_y=wall_thick + 0.28, ridge_h=0.45,
        overhang_x=0.18, overhang_y=0.18, thickness=0.10
    )
    add_ridge_cap(bm_rf, Vector((left_edge - 0.22, cy, z0 + wall_h + 0.68)),
                  Vector((right_edge + 0.22, cy, z0 + wall_h + 0.68)), radius=0.09)

    # Invitingly open double timber carriage gates swung inward into the courtyard!
    leaf_w = arch_r - 0.04
    leaf_h = arch_spring_h + arch_r * 0.48
    ang = math.radians(gate_open_deg)
    for side in (-1.0, 1.0):
        hx = arch_cx + side * (arch_r - 0.04)
        hy = cy + wall_thick * 0.30
        # Gate swings inward (+Y)
        cx_g = hx - side * (leaf_w * 0.5 * math.cos(ang))
        cy_g = hy + leaf_w * 0.5 * math.sin(ang)
        rot_g = side * ang
        add_box(bm_wd, cx_g, cy_g, z0 + leaf_h * 0.5 + 0.05, leaf_w, 0.09, leaf_h, rot_z=rot_g)
        # Heavy oak top/mid/bottom cross rails on inside face
        for rz in (0.45, leaf_h * 0.52, leaf_h - 0.30):
            add_box(bm_dk, cx_g, cy_g, z0 + rz, leaf_w - 0.06, 0.13, 0.14, rot_z=rot_g)
            # Wrought iron hinge strap
            add_box(bm_ir, hx - side * 0.42 * math.cos(ang), hy + 0.42 * math.sin(ang), z0 + rz,
                    0.82, 0.15, 0.055, rot_z=rot_g)


def build_weingut(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    clear_scene()
    col = ensure_collection("Weingut_Estate_Kindenheim")

    mats = {
        "stucco": get_pbr_material("Weingut_Main_Stucco", cfg["wall_tex"], normal_strength=0.9),
        "stucco_wing": get_pbr_material("Weingut_Wing_Stucco", cfg["wing_wall_tex"], normal_strength=0.9),
        "sandstone_yellow": get_pbr_material("Weingut_Sandstone_Yellow", cfg["stone_tex"], normal_strength=1.2),
        "sandstone_red": get_pbr_material("Weingut_Sandstone_Red", cfg["plinth_tex"], normal_strength=1.3),
        "roof_clay": get_pbr_material("Weingut_Clay_Roof", cfg["roof_tex"], normal_strength=1.35),
        "wood_dark": get_pbr_material("Weingut_Oak_Timber", "wood_timber_dark", normal_strength=1.0),
        "wood_barn": get_pbr_material("Weingut_Gate_Planks", "wood_barn_planks", normal_strength=1.15),
        "shutter_green": get_pbr_material("Weingut_Shutters", cfg["shutter_tex"], normal_strength=1.2),
        "glass_warm": get_pbr_material("Weingut_Glass", "window_glass_warm", normal_strength=0.4),
        "cobble": get_pbr_material("Weingut_Courtyard_Cobble", "cobble_courtyard", normal_strength=1.25),
        "barrel": get_pbr_material("Weingut_Oak_Barrels", "wood_barrel_oak", normal_strength=1.15),
        "copper": get_pbr_material("Weingut_Copper", "copper_patina", normal_strength=0.7),
        "iron": get_pbr_material("Weingut_Iron", "iron_dark", normal_strength=0.7),
    }
    bms = {k: bmesh.new() for k in mats.keys()}

    L = cfg["length_x"]
    D = cfg["depth_y"]
    H = cfg["house_wall_h"]
    Rh = cfg["house_roof_h"]
    fd = cfg["foundation_depth"]
    ph = cfg["plinth_h"]

    # Ensemble layout inside [-L/2, +L/2] x [-D/2, +D/2]:
    # - Unified cobblestone courtyard & stone retaining foundation skirt down to Z = -1.6m
    # - Main Winzerhaus on West/Street-left: width ~52% of L, depth ~55% of D
    # - Grand Sandstein Torbogen spanning the East street frontage (-Y) into courtyard!
    # - Kelterhaus & Vaulted Cellar Wing running along the East/Back of the courtyard (L-shape)!
    main_w = L * 0.54
    main_d = min(9.2, D * 0.58)
    main_cx = -L * 0.5 + main_w * 0.5
    main_cy = -D * 0.5 + main_d * 0.5

    wing_w = max(5.4, L * 0.30)
    wing_d = D * 0.72
    wing_cx = L * 0.5 - wing_w * 0.5
    wing_cy = D * 0.5 - wing_d * 0.5
    wing_h = H * 0.84
    wing_rh = wing_w * 0.44

    # ------------------------------------------------------------------
    # 1. Unified Courtyard Cobble Terrace & Deep Foundation Skirt (-1.6m)
    # ------------------------------------------------------------------
    add_box(bms["sandstone_red"], 0.0, 0.0, (-fd + 0.04) * 0.5, L + 0.20, D + 0.20, fd + 0.04)
    add_box(bms["cobble"], 0.0, 0.0, 0.06, L - 0.06, D - 0.06, 0.08)

    # Low sandstone perimeter courtyard wall on back (+Y) and west rear gap
    wall_h_back = 2.25
    add_box(bms["sandstone_yellow"], -L * 0.5 + (L - wing_w) * 0.5, D * 0.5 - 0.25, wall_h_back * 0.5,
            L - wing_w + 0.2, 0.42, wall_h_back)
    add_box(bms["sandstone_red"], -L * 0.5 + (L - wing_w) * 0.5, D * 0.5 - 0.25, wall_h_back + 0.07,
            L - wing_w + 0.3, 0.54, 0.14)
    west_gap_d = D - main_d
    if west_gap_d > 0.5:
        add_box(bms["sandstone_yellow"], -L * 0.5 + 0.22, D * 0.5 - west_gap_d * 0.5, wall_h_back * 0.5,
                0.42, west_gap_d, wall_h_back)
        add_box(bms["sandstone_red"], -L * 0.5 + 0.22, D * 0.5 - west_gap_d * 0.5, wall_h_back + 0.07,
                0.54, west_gap_d + 0.1, 0.14)

    # ------------------------------------------------------------------
    # 2. Main 2-Story Palatinate Winzerhaus (Street-Left Front)
    # ------------------------------------------------------------------
    add_box(bms["sandstone_red"], main_cx, main_cy, ph * 0.5, main_w + 0.20, main_d + 0.20, ph)
    add_box(bms["sandstone_yellow"], main_cx, main_cy, ph + 0.06, main_w + 0.28, main_d + 0.28, 0.12)
    add_box(bms["stucco"], main_cx, main_cy, ph + (H - ph) * 0.5, main_w, main_d, H - ph)
    # Eaves cornice
    add_box(bms["sandstone_yellow"], main_cx, main_cy, H - 0.10, main_w + 0.22, main_d + 0.22, 0.20)

    # Quoins on all 4 corners of main Winzerhaus
    for sx, dx in [(main_cx - main_w * 0.5, 1.0), (main_cx + main_w * 0.5, -1.0)]:
        for sy, dy in [(main_cy - main_d * 0.5, 1.0), (main_cy + main_d * 0.5, -1.0)]:
            add_quoins(bms["sandstone_yellow"], sx, sy, ph + 0.12, H - 0.22, dx, dy,
                       course_h=0.39, long_l=0.58, short_l=0.34, protrude=0.045)

    # Windows on street front (-Y) and courtyard rear (+Y)
    bays = 4 if main_w >= 9.5 else 3
    m_xs = [main_cx - main_w * 0.5 + 1.35 + i * (main_w - 2.7) / max(bays - 1, 1) for i in range(bays)]
    z1 = ph + (H - ph) * 0.27
    z2 = ph + (H - ph) * 0.72
    for fy, r_z, is_front in [(main_cy - main_d * 0.5, 0.0, True), (main_cy + main_d * 0.5, math.pi, False)]:
        for i, wx in enumerate(m_xs):
            add_framed_window(bms, Vector((wx, fy, z2)), r_z, width=1.02, height=1.42,
                              has_shutters=True, shutter_key="shutter_green", mullions=(1, 1))
            if (not is_front) and i == bays - 1:
                # Courtyard entrance doorway with sandstone steps
                add_box(bms["sandstone_yellow"], wx, fy + 0.35, ph * 0.5, 1.65, 0.72, ph)
                add_box(bms["sandstone_yellow"], wx, fy + 0.06, ph + 1.18, 1.48, 0.20, 2.36)
                add_box(bms["wood_dark"], wx, fy + 0.03, ph + 1.08, 1.14, 0.10, 2.15)
            else:
                add_framed_window(bms, Vector((wx, fy, z1)), r_z, width=1.02, height=1.40,
                                  has_shutters=True, shutter_key="shutter_green", mullions=(1, 1))

    # Gable end windows on West (-X) and East courtyard side (+X)
    for gx, r_z in [(main_cx - main_w * 0.5, -math.pi * 0.5), (main_cx + main_w * 0.5, math.pi * 0.5)]:
        for wy in (main_cy - main_d * 0.22, main_cy + main_d * 0.22):
            add_framed_window(bms, Vector((gx, wy, z2)), r_z, width=0.96, height=1.35,
                              has_shutters=True, shutter_key="shutter_green", mullions=(1, 1))
        add_framed_window(bms, Vector((gx, main_cy, H + Rh * 0.36)), r_z, width=0.90, height=1.10,
                          has_shutters=False, mullions=(1, 1))

    # Main Winzerhaus pitched clay tile roof + dormers + chimney + gutters
    add_gable_wall_triangles(bms["stucco"], main_cx, main_cy, H, main_w, main_d, Rh, wall_thick=0.36)
    add_pitched_roof_solid(
        bms["roof_clay"], main_cx, main_cy, H,
        length_x=main_w, width_y=main_d, ridge_h=Rh,
        overhang_x=0.45, overhang_y=0.48, thickness=0.22
    )
    add_ridge_cap(
        bms["roof_clay"],
        Vector((main_cx - main_w * 0.5 - 0.45, main_cy, H + Rh + 0.22)),
        Vector((main_cx + main_w * 0.5 + 0.45, main_cy, H + Rh + 0.22)),
        radius=0.13
    )
    slope_m = Rh / max(main_d * 0.5, 0.1)
    for side in (-1.0, 1.0):
        add_gutter_and_downspout(
            bms, main_cx - main_w * 0.5 - 0.45, main_cx + main_w * 0.5 + 0.45,
            main_cy + side * (main_d * 0.5 + 0.52), H - slope_m * 0.48 + 0.04, 0.0,
            copper_key="copper", downspout_x=main_cx - main_w * 0.46
        )
    # 2 front roof dormers facing street
    for dx in (main_cx - main_w * 0.23, main_cx + main_w * 0.23):
        add_dormer(bms, Vector((dx, main_cy - main_d * 0.30, H + main_d * 0.20 * slope_m)), 0.0,
                   width=1.30, height=1.38, depth=2.1)
    add_chimney(bms, main_cx - main_w * 0.12, main_cy + main_d * 0.15, H + Rh * 0.5, H + Rh + 0.90)

    # ------------------------------------------------------------------
    # 3. Iconic Pfalz Sandstein Torbogen (Winery Archway on Street Front)
    # ------------------------------------------------------------------
    tor_x0 = main_cx + main_w * 0.5
    tor_x1 = L * 0.5
    tor_w = tor_x1 - tor_x0
    tor_cx = (tor_x0 + tor_x1) * 0.5
    tor_cy = -D * 0.5 + 0.42
    _add_sandstone_archway(
        bms, cx=tor_cx, cy=tor_cy, z0=0.08,
        wall_w=tor_w, wall_h=4.35, wall_thick=0.72,
        arch_w=min(3.35, tor_w * 0.48), arch_spring_h=2.05,
        has_wicket=(tor_w >= 6.2), gate_open_deg=52.0
    )

    # ------------------------------------------------------------------
    # 4. Kelterhaus & Vaulted Wine Cellar Wing (East/Rear L-Wing)
    # ------------------------------------------------------------------
    cellar_h = 2.65
    # Heavy red/yellow sandstone vaulted cellar ground floor
    add_box(bms["sandstone_yellow"], wing_cx, wing_cy, cellar_h * 0.5, wing_w + 0.12, wing_d + 0.12, cellar_h)
    add_box(bms["sandstone_red"], wing_cx, wing_cy, cellar_h + 0.07, wing_w + 0.22, wing_d + 0.22, 0.14)
    # Upper ochre-stucco Kelterhaus loft + exposed dark timber framing accent
    add_box(bms["stucco_wing"], wing_cx, wing_cy, cellar_h + (wing_h - cellar_h) * 0.5, wing_w, wing_d, wing_h - cellar_h)
    # Exposed Fachwerk timber posts & diagonal corner braces along courtyard face (-X of wing)
    wx_face = wing_cx - wing_w * 0.5
    add_box(bms["wood_dark"], wx_face - 0.02, wing_cy, cellar_h + 0.18, 0.12, wing_d, 0.18)
    add_box(bms["wood_dark"], wx_face - 0.02, wing_cy, wing_h - 0.12, 0.12, wing_d, 0.18)
    for k in range(5):
        py = wing_cy - wing_d * 0.46 + k * (wing_d * 0.92 / 4.0)
        add_box(bms["wood_dark"], wx_face - 0.02, py, (cellar_h + wing_h) * 0.5, 0.12, 0.16, wing_h - cellar_h)

    # Arched vaulted wine-cellar doors facing into courtyard (-X face of wing, framed with proper jambs + lintel!)
    for cy_d in (wing_cy - wing_d * 0.22, wing_cy + wing_d * 0.18):
        add_box(bms["sandstone_red"], wx_face - 0.09, cy_d - 0.96, 1.16, 0.22, 0.24, 2.32)
        add_box(bms["sandstone_red"], wx_face - 0.09, cy_d + 0.96, 1.16, 0.22, 0.24, 2.32)
        add_box(bms["sandstone_red"], wx_face - 0.10, cy_d, 2.40, 0.26, 2.24, 0.26)
        add_box(bms["wood_barn"], wx_face - 0.03, cy_d, 1.14, 0.09, 1.72, 2.24)
        # Iron strap hinges on cellar doors
        for hz in (0.65, 1.65):
            add_box(bms["iron"], wx_face - 0.09, cy_d - 0.52, hz, 0.03, 0.58, 0.06)
            add_box(bms["iron"], wx_face - 0.09, cy_d + 0.52, hz, 0.03, 0.58, 0.06)

    # Upper loft hay/cask loading hatch + timber hoist beam (Kranbalken)
    add_box(bms["wood_dark"], wx_face - 0.06, wing_cy, cellar_h + 1.45, 0.14, 1.55, 1.85)
    add_box(bms["wood_barn"], wx_face - 0.09, wing_cy, cellar_h + 1.45, 0.08, 1.30, 1.62)
    add_box(bms["wood_dark"], wx_face - 0.68, wing_cy, wing_h - 0.25, 1.45, 0.18, 0.20)  # projecting hoist beam
    # Flanking loft windows
    for wy in (wing_cy - wing_d * 0.32, wing_cy + wing_d * 0.32):
        add_framed_window(bms, Vector((wx_face, wy, cellar_h + 1.55)), -math.pi * 0.5,
                          width=0.92, height=1.18, has_shutters=True, shutter_key="shutter_green", mullions=(1, 1))

    # Pitched clay-tile roof on Kelterhaus wing (ridge running along Y -> rot_z = pi/2!)
    add_gable_wall_triangles(bms["stucco_wing"], wing_cx, wing_cy, wing_h, wing_d, wing_w, wing_rh,
                             wall_thick=0.34, rot_z=math.pi * 0.5)
    add_pitched_roof_solid(
        bms["roof_clay"], wing_cx, wing_cy, wing_h,
        length_x=wing_d, width_y=wing_w, ridge_h=wing_rh,
        overhang_x=0.40, overhang_y=0.45, thickness=0.20, rot_z=math.pi * 0.5
    )
    add_ridge_cap(
        bms["roof_clay"],
        Vector((wing_cx, wing_cy - wing_d * 0.5 - 0.40, wing_h + wing_rh + 0.20)),
        Vector((wing_cx, wing_cy + wing_d * 0.5 + 0.40, wing_h + wing_rh + 0.20)),
        radius=0.12
    )

    # ------------------------------------------------------------------
    # 5. Courtyard Details: Stacked Oak Wine Barrels (Weinfässer) & Pergola
    # ------------------------------------------------------------------
    # Pyramid stack of 6 authentic oak Barrique wine barrels along the cellar courtyard!
    bx_base = wx_face - 1.35
    by_base = wing_cy - wing_d * 0.02
    # Timber skid beams under barrel stack
    add_box(bms["wood_dark"], bx_base, by_base - 0.28, 0.15, 0.90, 0.14, 0.12)
    add_box(bms["wood_dark"], bx_base, by_base + 0.28, 0.15, 0.90, 0.14, 0.12)
    # Bottom row (3 horizontal barrels)
    for dy in (-0.78, 0.0, 0.78):
        add_wine_barrel(bms, bx_base, by_base + dy, 0.18, radius=0.36, length=0.92,
                        standing=False, rot_z=math.pi * 0.5, wood_key="barrel", iron_key="iron")
    # Middle row (2 horizontal barrels)
    for dy in (-0.39, 0.39):
        add_wine_barrel(bms, bx_base, by_base + dy, 0.18 + 0.62, radius=0.36, length=0.92,
                        standing=False, rot_z=math.pi * 0.5, wood_key="barrel", iron_key="iron")
    # Top crown barrel
    add_wine_barrel(bms, bx_base, by_base, 0.18 + 1.24, radius=0.36, length=0.92,
                    standing=False, rot_z=math.pi * 0.5, wood_key="barrel", iron_key="iron")
    # Two upright decorative standing barrels flanking the courtyard doorway
    add_wine_barrel(bms, main_cx + main_w * 0.5 + 0.65, main_cy + main_d * 0.5 - 0.75, 0.10,
                    radius=0.34, length=0.90, standing=True, wood_key="barrel", iron_key="iron")
    add_wine_barrel(bms, main_cx + main_w * 0.5 + 0.65, main_cy + main_d * 0.5 - 1.60, 0.10,
                    radius=0.34, length=0.90, standing=True, wood_key="barrel", iron_key="iron")

    # Classic Pfalz sandstone courtyard water trough (Sandstein-Brunnentrog)
    tx, ty = main_cx - 0.6, D * 0.5 - 1.55
    add_box(bms["sandstone_red"], tx, ty, 0.45, 1.85, 0.88, 0.74)
    add_box(bms["sandstone_yellow"], tx + 0.85, ty, 0.82, 0.34, 0.34, 1.48)
    add_cylinder(bms["iron"], tx + 0.64, ty, 1.05, 0.03, 0.025, 0.34, segments=8, rot_y=math.pi * 0.5)

    # Timber wine-arbor pergola frame along rear of main house
    perg_y = main_cy + main_d * 0.5 + 1.35
    for px in (main_cx - main_w * 0.35, main_cx, main_cx + main_w * 0.35):
        add_box(bms["wood_dark"], px, perg_y, 1.45, 0.15, 0.15, 2.75)
    add_box(bms["wood_dark"], main_cx, perg_y, 2.85, main_w * 0.78, 0.16, 0.18)
    for k in range(7):
        rx = main_cx - main_w * 0.36 + k * (main_w * 0.72 / 6.0)
        add_box(bms["wood_dark"], rx, main_cy + main_d * 0.5 + 0.75, 2.98, 0.10, 1.65, 0.12)

    # ------------------------------------------------------------------
    # Finalize meshes
    # ------------------------------------------------------------------
    uv_specs = {
        "stucco":           (3.0, 3.0, False, False),
        "stucco_wing":      (3.0, 3.0, False, False),
        "sandstone_yellow": (2.2, 2.2, False, False),
        "sandstone_red":    (2.4, 2.4, False, False),
        "roof_clay":        (2.4, 2.4, True,  False),
        "wood_dark":        (1.6, 1.6, False, False),
        "wood_barn":        (1.8, 2.0, False, False),
        "shutter_green":    (0.6, 1.4, False, False),
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
            f"Weingut_{key}", bm, mats[key], col,
            tile_u=tu, tile_v=tv, slope_align=slope, fit_uv=fit,
            smooth=(key in ("barrel", "copper")),
        )
        objects.append(obj)

    if do_export:
        save_blend_and_export_glb(
            LANDMARKS_DIR / "weingut_estate.blend",
            GLB_OUT_DIR / "weingut_estate.glb",
            objects,
        )
    if do_render:
        render_preview(
            ARTIFACT_DIR / "preview_weingut_estate.png",
            objects,
            cam_azimuth_deg=34.0,
            cam_elev_deg=24.0,
            dist_mult=1.85,
            samples=36,
        )
    return objects


if __name__ == "__main__":
    build_weingut()
