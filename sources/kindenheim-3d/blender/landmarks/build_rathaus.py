#!/usr/bin/env python3
"""
Hero Landmark #2: Rathaus / Historisches Gemeindehaus Kindenheim (Hauptstraße 77).
Photorealism & Diff-Optimized pixel-for-pixel against Aug-2023 Google Street View
(`sv_rathaus_ortsmitte.png` & `sv_kirche_full_west.png`) and RLP LoD2:
- Exact real footprint: 22.41m x 9.34m, 2 stately tall stories (8.2m to eaves), dark hipped roof (4.65m)
- Calibrated warm pale beige-gray plaster (#DDD6C8) with subtle vertical grime/weathering
- Calibrated softer dusty-rose Pfälzer Sandstein plinth, split ground-floor sill ledge, belt course,
  doorway architrave, and upper classical cornice entablatures (#A76F64)
- Authentic 9-bay rhythm with white inner window frames and realistic light-gray ribbed German
  roller shutters (Rolläden) partially lowered or closed matching `sv_rathaus_ortsmitte.png`!
- Civic portal (#77 at local X = +2.38m) w/ 4 stepped gray granite stairs, dark mahogany glazed
  double door, colorful Gemeindewappen + 'GEMEINDE KINDENHEIM' plaque, twin black wrought-iron
  lanterns, and the iconic bright yellow Deutsche Post mailbox on the West corner!
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
    add_cylinder,
    add_framed_window,
    add_gutter_and_downspout,
    add_pitched_roof_solid,
    add_ridge_cap,
    clear_scene,
    ensure_collection,
    finalize_mesh,
    get_pbr_material,
    render_preview,
    save_blend_and_export_glb,
)


DEFAULT_PARAMS = {
    "length_x": 22.41,
    "depth_y": 9.34,
    "wall_h": 8.20,
    "roof_h": 4.65,
    "hip_x": 4.4,
    "foundation_depth": 1.8,
    "plinth_h": 0.78,
}


def _add_rathaus_window(bms, pos: Vector, rot_z: float, width: float, height: float,
                        has_cornice_hood: bool = False, closed_rolladen: bool = False):
    """Authentic Rathaus Kindenheim window: dusty-rose sandstone frame, white sash, Rolladen glazing."""
    glass_k = "rolladen_closed" if closed_rolladen else "rolladen_partial"
    add_framed_window(
        bms, pos, rot_z,
        width=width, height=height,
        has_shutters=False,
        stone_key="sandstone_red",
        frame_key="frame_white",
        glass_key=glass_k,
        iron_key="iron",
        mullions=(0, 0) if closed_rolladen else (1, 0),  # Real Rathaus windows have clean single/split white casements!
    )
    if has_cornice_hood:
        cos_r, sin_r = math.cos(rot_z), math.sin(rot_z)
        hz = pos.z + height * 0.5 + 0.24
        hx = pos.x + sin_r * 0.14
        hy = pos.y - cos_r * 0.14
        add_box(bms["sandstone_red"], hx, hy, hz, width + 0.56, 0.28, 0.16, rot_z=rot_z)
        add_box(bms["sandstone_red"], hx + sin_r * 0.04, hy - cos_r * 0.04, hz + 0.11,
                width + 0.68, 0.34, 0.09, rot_z=rot_z)


def build_rathaus(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    clear_scene()
    col = ensure_collection("Rathaus_Kindenheim")

    mats = {
        "stucco": get_pbr_material("Rathaus_BeigeGray_Stucco", "stucco_rathaus_greycream", normal_strength=0.9),
        "sandstone_red": get_pbr_material("Rathaus_Rose_Sandstone", "sandstone_rathaus_rose", normal_strength=1.15),
        "stone_steps": get_pbr_material("Rathaus_Granite_Steps", "concrete_plinth", normal_strength=1.0),
        "roof_dark": get_pbr_material("Rathaus_Dark_Hipped_Roof", "roof_dark_tile", normal_strength=1.3),
        "frame_white": get_pbr_material("Rathaus_White_Frames", "window_frame_white", normal_strength=0.4),
        "door_burgundy": get_pbr_material("Rathaus_Mahogany_Door", "door_burgundy_panel", normal_strength=1.1, tint=(0.68, 0.62, 0.66)),
        "wappen": get_pbr_material("Rathaus_Gemeindewappen", "rathaus_wappen", normal_strength=0.65),
        "rolladen_partial": get_pbr_material("Rathaus_Window_Rolladen_Partial", "window_rolladen_partial", normal_strength=0.9),
        "rolladen_closed": get_pbr_material("Rathaus_Window_Rolladen_Closed", "window_rolladen_closed", normal_strength=1.2),
        "glass_warm": get_pbr_material("Rathaus_Door_Glass", "window_glass_warm", normal_strength=0.35),
        "copper": get_pbr_material("Rathaus_Zinc_Gutters", "metal_silo", normal_strength=0.45, tint=(0.65, 0.67, 0.70)),
        "iron": get_pbr_material("Rathaus_Wrought_Iron", "iron_dark", normal_strength=0.75),
        "gold": get_pbr_material("Rathaus_Lantern_Glow", "gold_gilded", normal_strength=0.3),
        "post_yellow": get_pbr_material("Rathaus_DeutschePost_Yellow", "stucco_ochre", normal_strength=0.25,
                                        roughness_override=0.32, tint=(1.0, 0.90, 0.24)),
    }
    bms = {k: bmesh.new() for k in mats.keys()}

    L = cfg["length_x"]
    D = cfg["depth_y"]
    H = cfg["wall_h"]
    Rh = cfg["roof_h"]
    hip_x = min(cfg["hip_x"], L * 0.28)
    fd = cfg["foundation_depth"]
    ph = cfg["plinth_h"]

    # ------------------------------------------------------------------
    # 1. Dusty-Rose Sandstone Plinth + Deep Hillside Foundation Skirt
    # ------------------------------------------------------------------
    add_box(bms["sandstone_red"], 0.0, 0.0, (-fd + ph) * 0.5, L + 0.22, D + 0.22, fd + ph)
    add_box(bms["sandstone_red"], 0.0, 0.0, ph + 0.05, L + 0.30, D + 0.30, 0.12)

    # ------------------------------------------------------------------
    # 2. Main 2-Story Civic Facade + Continuous Belt Course & Split Sill Ledge
    # ------------------------------------------------------------------
    add_box(bms["stucco"], 0.0, 0.0, ph + (H - ph) * 0.5, L, D, H - ph)

    gf_sill_z = ph + 0.85
    belt_z = ph + (H - ph) * 0.51
    bays_x = 9 if L >= 20.0 else 6
    margin = 1.70 if bays_x == 9 else 2.05
    xs = [-L * 0.5 + margin + i * (L - 2.0 * margin) / max(bays_x - 1, 1) for i in range(bays_x)]
    portal_idx = 5 if bays_x == 9 else 3  # local X = +2.38m (exact match to sv_rathaus_ortsmitte!)
    portal_x = xs[portal_idx]
    gap_half = 0.88

    # Rear (+Y) and sides get full sill ledge; Front (-Y) cleanly interrupted across portal opening!
    add_box(bms["sandstone_red"], 0.0, 0.05, gf_sill_z, L + 0.18, D + 0.08, 0.14)
    left_x0, left_x1 = -(L * 0.5 + 0.09), portal_x - gap_half
    if left_x1 > left_x0:
        add_box(bms["sandstone_red"], (left_x0 + left_x1) * 0.5, -(D * 0.5 + 0.045), gf_sill_z,
                left_x1 - left_x0, 0.12, 0.14)
    right_x0, right_x1 = portal_x + gap_half, L * 0.5 + 0.09
    if right_x1 > right_x0:
        add_box(bms["sandstone_red"], (right_x0 + right_x1) * 0.5, -(D * 0.5 + 0.045), gf_sill_z,
                right_x1 - right_x0, 0.12, 0.14)

    add_box(bms["sandstone_red"], 0.0, 0.0, belt_z, L + 0.24, D + 0.24, 0.20)
    add_box(bms["sandstone_red"], 0.0, 0.0, H - 0.16, L + 0.32, D + 0.32, 0.28)
    for sx in (-L * 0.5 + 0.24, L * 0.5 - 0.24):
        for sy in (-D * 0.5, D * 0.5):
            add_box(bms["stucco"], sx, sy, ph + (H - ph) * 0.5, 0.52, 0.10, H - ph - 0.1)

    # ------------------------------------------------------------------
    # 3. 9-Bay Facade Matched to sv_rathaus_ortsmitte.png (Rolläden + Portal + Postbox!)
    # ------------------------------------------------------------------
    z_gf = gf_sill_z + 1.02
    z_uf = belt_z + (H - 0.28 - belt_z) * 0.50

    # Exact closed-Rolladen bays on front upper floor from sv_rathaus_ortsmitte.png!
    # Bay 5 = above door (partial/frosted), Bay 6 = CLOSED, Bay 7 = OPEN/partial, Bay 8 = CLOSED!
    front_uf_closed = {1, 3, 6, 8}

    for face_y, rot_z, is_front in [(-D * 0.5, 0.0, True), (D * 0.5, math.pi, False)]:
        for idx, wx in enumerate(xs):
            uf_closed = is_front and (idx in front_uf_closed)
            _add_rathaus_window(bms, Vector((wx, face_y, z_uf)), rot_z,
                                width=1.18, height=1.95, has_cornice_hood=True,
                                closed_rolladen=uf_closed)
            if is_front and idx == portal_idx:
                py = face_y
                # 4 stepped gray granite entrance stairs
                for st_i in range(4):
                    sh = ph * (1.0 - st_i * 0.24)
                    add_box(bms["stone_steps"], wx, py - 0.18 - st_i * 0.24, sh * 0.5, 1.48, 0.28, sh)
                # Molded dusty-rose sandstone doorway jambs & lintel
                dw, dh = 1.42, 2.75
                add_box(bms["sandstone_red"], wx - dw * 0.5 - 0.14, py - 0.10, ph + dh * 0.5, 0.28, 0.24, dh + 0.10)
                add_box(bms["sandstone_red"], wx + dw * 0.5 + 0.14, py - 0.10, ph + dh * 0.5, 0.28, 0.24, dh + 0.10)
                add_box(bms["sandstone_red"], wx, py - 0.12, ph + dh + 0.12, dw + 0.60, 0.28, 0.24)
                # Recessed dark mahogany glazed civic double door + upper fanlight transom + pinned notice paper
                add_box(bms["door_burgundy"], wx, py - 0.02, ph + 1.12, dw - 0.06, 0.08, 2.18)
                add_box(bms["glass_warm"], wx, py - 0.02, ph + 2.46, dw - 0.10, 0.06, 0.44)
                add_box(bms["frame_white"], wx, py - 0.05, ph + 2.22, dw, 0.06, 0.06)
                # Subtle bright yellow-cream official notice card inside left door leaf (sv_rathaus_ortsmitte!)
                add_box(bms["frame_white"], wx - 0.24, py - 0.065, ph + 1.32, 0.22, 0.015, 0.30)
                # Two black wrought-iron heritage wall lanterns flanking the portal
                for side in (-1.0, 1.0):
                    lx = wx + side * (dw * 0.5 + 0.54)
                    add_box(bms["iron"], lx, py - 0.16, ph + 2.86, 0.08, 0.26, 0.08)
                    add_cylinder(bms["iron"], lx, py - 0.26, ph + 2.78, 0.14, 0.20, 0.32, segments=6)
                    add_cylinder(bms["iron"], lx, py - 0.26, ph + 3.00, 0.24, 0.04, 0.16, segments=6)
                    add_cylinder(bms["gold"], lx, py - 0.26, ph + 2.76, 0.09, 0.11, 0.22, segments=6)
                # Colorful Gemeindewappen + 'GEMEINDE KINDENHEIM' plaque directly above portal
                add_box(bms["sandstone_red"], wx, py - 0.04, ph + 3.25, 0.90, 0.06, 0.98)
                bm_wp = bms["wappen"]
                w_w, w_h = 0.42, 0.46
                wz = ph + 3.25
                wy = py - 0.08
                bm_wp.faces.new([
                    bm_wp.verts.new((wx - w_w, wy, wz - w_h)),
                    bm_wp.verts.new((wx + w_w, wy, wz - w_h)),
                    bm_wp.verts.new((wx + w_w, wy, wz + w_h)),
                    bm_wp.verts.new((wx - w_w, wy, wz + w_h)),
                ])
            else:
                _add_rathaus_window(bms, Vector((wx, face_y, z_gf)), rot_z,
                                    width=1.14, height=1.76, has_cornice_hood=False,
                                    closed_rolladen=False)

    # Iconic Bright Yellow Deutsche Post Mailbox (Briefkasten) on right/West front corner beside downspout!
    # Visible right at bottom-right of Rathaus wall in `sv_rathaus_ortsmitte.png`!
    mb_x, mb_y, mb_z = L * 0.5 - 0.42, -D * 0.5 - 0.18, ph + 0.96
    add_box(bms["post_yellow"], mb_x, mb_y, mb_z, 0.44, 0.32, 0.46)
    add_box(bms["iron"], mb_x, mb_y - 0.165, mb_z + 0.11, 0.34, 0.02, 0.06)  # mail slot flap
    add_box(bms["frame_white"], mb_x, mb_y - 0.165, mb_z - 0.06, 0.24, 0.015, 0.14)  # collection schedule plate

    # Side walls (-X East & +X West)
    for sx, rot_z in [(-L * 0.5, -math.pi * 0.5), (L * 0.5, math.pi * 0.5)]:
        for wy in (-D * 0.23, D * 0.23):
            _add_rathaus_window(bms, Vector((sx, wy, z_gf)), rot_z, width=1.12, height=1.68, has_cornice_hood=False)
            _add_rathaus_window(bms, Vector((sx, wy, z_uf)), rot_z, width=1.12, height=1.82, has_cornice_hood=True)

    # ------------------------------------------------------------------
    # 4. Stately Dark Hipped Roof (Walmdach) + Galvanized Gutters + Village Siren
    # ------------------------------------------------------------------
    add_pitched_roof_solid(
        bms["roof_dark"], 0.0, 0.0, H,
        length_x=L, width_y=D, ridge_h=Rh,
        overhang_x=0.45, overhang_y=0.48, thickness=0.24, hip_x=hip_x
    )
    hx_ov = L * 0.5 + 0.45
    hy_ov = D * 0.5 + 0.48
    rx = max(0.0, hx_ov - hip_x)
    slope = Rh / max(D * 0.5, 0.1)
    z_outer_eave = H - slope * 0.48
    dz_r = 0.24 * math.sqrt(1.0 + slope * slope)

    add_ridge_cap(bms["roof_dark"], Vector((-rx, 0.0, H + Rh + dz_r)), Vector((rx, 0.0, H + Rh + dz_r)), radius=0.14)
    for sgn_x in (-1.0, 1.0):
        for sgn_y in (-1.0, 1.0):
            add_ridge_cap(
                bms["roof_dark"],
                Vector((sgn_x * hx_ov, sgn_y * hy_ov, z_outer_eave + dz_r)),
                Vector((sgn_x * rx, 0.0, H + Rh + dz_r)),
                radius=0.12
            )

    for side in (-1.0, 1.0):
        add_gutter_and_downspout(
            bms, -hx_ov, hx_ov, side * (hy_ov + 0.05), z_outer_eave + 0.05, 0.0,
            copper_key="copper", downspout_x=L * 0.46
        )

    add_chimney(bms, L * 0.26, D * 0.14, H + Rh * 0.48, H + Rh + 1.05, sx=0.68, sy=0.68,
                wall_key="stucco", stone_key="sandstone_red")
    add_cylinder(bms["iron"], -L * 0.18, 0.0, H + Rh + 1.15, 0.06, 0.05, 2.1, segments=8)
    add_cylinder(bms["iron"], -L * 0.18, 0.0, H + Rh + 2.25, 0.62, 0.18, 0.34, segments=14)

    # ------------------------------------------------------------------
    # Finalize meshes
    # ------------------------------------------------------------------
    uv_specs = {
        "stucco":           (3.2, 3.2, False, False),
        "sandstone_red":    (2.3, 2.3, False, False),
        "stone_steps":      (2.0, 2.0, False, False),
        "roof_dark":        (2.4, 2.4, True,  False),
        "frame_white":      (1.5, 1.5, False, False),
        "door_burgundy":    (1.5, 2.2, False, True),
        "wappen":           (1.0, 1.0, False, True),
        "rolladen_partial": (1.0, 1.0, False, True),
        "rolladen_closed":  (1.0, 1.0, False, True),
        "glass_warm":       (1.2, 1.6, False, False),
        "copper":           (1.5, 1.5, False, False),
        "iron":             (1.0, 1.0, False, False),
        "gold":             (1.0, 1.0, False, False),
        "post_yellow":      (1.0, 1.0, False, False),
    }

    objects = []
    for key, (tu, tv, slope, fit) in uv_specs.items():
        bm = bms[key]
        if len(bm.verts) == 0:
            bm.free()
            continue
        obj = finalize_mesh(
            f"Rathaus_{key}", bm, mats[key], col,
            tile_u=tu, tile_v=tv, slope_align=slope, fit_uv=fit,
            smooth=(key in ("copper", "gold")),
        )
        objects.append(obj)

    if do_export:
        save_blend_and_export_glb(
            LANDMARKS_DIR / "rathaus.blend",
            GLB_OUT_DIR / "rathaus.glb",
            objects,
        )
    if do_render:
        render_preview(
            ARTIFACT_DIR / "preview_rathaus.png",
            objects,
            cam_azimuth_deg=-18.0,
            cam_elev_deg=12.0,
            dist_mult=1.72,
            samples=40,
        )
    return objects


if __name__ == "__main__":
    build_rathaus()
