#!/usr/bin/env python3
"""
Hero Landmark #5: Modern Rheinland-Pfalz Agricultural Machinery Hall & Silo Complex (Maschinenhalle).
Authentic edge-of-village Palatinate agricultural hall featuring:
- Heavy poured reinforced concrete base push-walls & 1.6m deep foundation skirt
- Weathered sage-grey trapezoidal corrugated steel cladding with steel portal columns & trims
- Low-pitched dark anthracite trapezoidal metal roof with translucent frosted polycarbonate
  roof skylight bands, metal ridge flashing, galvanized box gutters & downspouts
- Oversized industrial sliding steel machinery doors on overhead galvanized steel track rail
  (one partially slid open revealing recessed steel bay depth) + personnel door & ribbon windows
- Side lean-to equipment shelter overhang (Schleppdach) on H-columns
- Pair of tall galvanized corrugated steel grain/wine silos with conical roofs, stiffener ribs,
  overhead grain auger chute, and vertical steel safety ladder
"""

import math
import bmesh
from mathutils import Vector

from arch_utils import (
    ARTIFACT_DIR,
    GLB_OUT_DIR,
    LANDMARKS_DIR,
    add_box,
    add_cylinder,
    add_gable_wall_triangles,
    add_gutter_and_downspout,
    add_pitched_roof_solid,
    add_ridge_cap,
    clear_scene,
    ensure_collection,
    finalize_mesh,
    get_pbr_material,
    get_skylight_material,
    render_preview,
    save_blend_and_export_glb,
)


DEFAULT_PARAMS = {
    "length_x": 26.0,         # Total complex length along X (Hall + Silo pad)
    "depth_y": 14.0,          # Hall depth along Y (incl. side overhang bay)
    "wall_h": 6.2,            # Eaves wall height
    "roof_h": 2.45,           # Low-pitched modern steel hall gable (~18 deg)
    "concrete_h": 1.45,       # Poured concrete lower push-wall height
    "foundation_depth": 1.6,
    "include_silos": True,
}


def build_agri_halle(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    clear_scene()
    col = ensure_collection("Agri_Halle_Kindenheim")

    mats = {
        "concrete": get_pbr_material("Agri_Concrete_Plinth", "concrete_plinth", normal_strength=1.15),
        "cladding": get_pbr_material("Agri_Corrugated_Cladding", "metal_corrugated_sage", normal_strength=1.3),
        "roof_metal": get_pbr_material("Agri_Metal_Roof", "metal_roof_sheet", normal_strength=1.25),
        "silo_steel": get_pbr_material("Agri_Silo_Galvanized", "metal_silo", normal_strength=1.2),
        "skylight": get_skylight_material("Agri_Polycarbonate_Skylights"),
        "steel_dark": get_pbr_material("Agri_Structural_Steel", "iron_dark", normal_strength=0.75),
        "glass_warm": get_pbr_material("Agri_Office_Glass", "window_glass_warm", normal_strength=0.35),
    }
    bms = {k: bmesh.new() for k in mats.keys()}

    L = cfg["length_x"]
    D = cfg["depth_y"]
    H = cfg["wall_h"]
    Rh = cfg["roof_h"]
    ch = cfg["concrete_h"]
    fd = cfg["foundation_depth"]
    has_silos = cfg["include_silos"] and L >= 18.0

    # Reserve ~22% of length at East (+X) end for twin grain silos on concrete apron
    silo_pad_w = min(6.2, L * 0.24) if has_silos else 0.0
    hall_L = L - silo_pad_w
    hall_cx = -silo_pad_w * 0.5
    # Reserve front overhang apron (2.4m along -Y) or full depth
    canopy_d = min(2.4, D * 0.18)
    hall_D = D - canopy_d
    hall_cy = canopy_d * 0.5

    # ------------------------------------------------------------------
    # 1. Heavy Reinforced Concrete Foundation Skirt (-1.6m) & Push-Walls
    # ------------------------------------------------------------------
    # Continuous concrete foundation slab + skirt under entire footprint (incl. canopy & silos)
    add_box(bms["concrete"], 0.0, 0.0, (-fd + 0.10) * 0.5, L + 0.20, D + 0.20, fd + 0.10)

    # Poured concrete lower push-wall around the main hall perimeter (Z = 0.10 to concrete_h)
    add_box(bms["concrete"], hall_cx, hall_cy, 0.10 + (ch - 0.10) * 0.5, hall_L + 0.14, hall_D + 0.14, ch - 0.10)
    # Angled steel drip flashing cap atop concrete plinth
    add_box(bms["steel_dark"], hall_cx, hall_cy, ch + 0.04, hall_L + 0.24, hall_D + 0.24, 0.08)

    # ------------------------------------------------------------------
    # 2. Corrugated Steel Upper Walls, Steel Portal Frame & Side Canopy
    # ------------------------------------------------------------------
    add_box(bms["cladding"], hall_cx, hall_cy, ch + (H - ch) * 0.5, hall_L, hall_D, H - ch)
    add_gable_wall_triangles(bms["cladding"], hall_cx, hall_cy, H, hall_L, hall_D, Rh, wall_thick=0.30)

    # Dark structural steel corner trims & exterior vertical bay pilasters
    bay_count = max(4, int(round(hall_L / 4.5)))
    for i in range(bay_count + 1):
        px = hall_cx - hall_L * 0.5 + i * (hall_L / bay_count)
        for sy in (hall_cy - hall_D * 0.5, hall_cy + hall_D * 0.5):
            add_box(bms["steel_dark"], px, sy, H * 0.5, 0.24, 0.24, H + 0.05)

    # Low-pitched anthracite trapezoidal steel gable roof (extends forward over the front machinery canopy!)
    # Compute extended eave along -Y for the front Schleppdach canopy
    slope = Rh / max(hall_D * 0.5, 0.1)
    # Main symmetric roof over hall_D
    add_pitched_roof_solid(
        bms["roof_metal"], hall_cx, hall_cy, H,
        length_x=hall_L, width_y=hall_D, ridge_h=Rh,
        overhang_x=0.65, overhang_y=0.55, thickness=0.20
    )
    # Front continuous lean-to canopy roof extension (Schleppdach) covering [-D/2 .. hall_cy - hall_D/2]
    canopy_z_top = H - slope * 0.45
    canopy_z_front = canopy_z_top - slope * canopy_d
    # Sloped canopy roof slab
    canopy_len = math.hypot(canopy_d + 0.55, slope * (canopy_d + 0.55))
    canopy_mid_y = hall_cy - hall_D * 0.5 - canopy_d * 0.5
    canopy_mid_z = (canopy_z_top + canopy_z_front) * 0.5 + 0.06
    add_box(bms["roof_metal"], hall_cx, canopy_mid_y, canopy_mid_z,
            hall_L + 1.30, canopy_len, 0.16, rot_x=math.atan(slope))
    # Steel H-columns & eaves header beam supporting the front canopy
    front_col_y = -D * 0.5 + 0.25
    add_box(bms["steel_dark"], hall_cx, front_col_y, canopy_z_front - 0.12, hall_L + 0.20, 0.22, 0.26)
    for i in range(bay_count + 1):
        px = hall_cx - hall_L * 0.5 + i * (hall_L / bay_count)
        add_box(bms["steel_dark"], px, front_col_y, canopy_z_front * 0.5, 0.22, 0.22, canopy_z_front)
        # Diagonal knee brace from column to canopy purlin
        add_box(bms["steel_dark"], px, front_col_y + 0.55, canopy_z_front - 0.55, 0.12, 1.15, 0.12, rot_x=math.radians(38))

    # Crisp dark metal ridge flashing cap + galvanized box gutters & downspouts
    add_box(bms["steel_dark"], hall_cx, hall_cy, H + Rh + 0.24, hall_L + 1.38, 0.46, 0.12)
    # Front & rear gutters
    add_gutter_and_downspout(
        bms, hall_cx - hall_L * 0.5 - 0.65, hall_cx + hall_L * 0.5 + 0.65,
        -D * 0.5 - 0.08, canopy_z_front - 0.04, 0.08, copper_key="steel_dark",
        downspout_x=hall_cx - hall_L * 0.5
    )
    add_gutter_and_downspout(
        bms, hall_cx - hall_L * 0.5 - 0.65, hall_cx + hall_L * 0.5 + 0.65,
        hall_cy + hall_D * 0.5 + 0.58, H - slope * 0.55, 0.08, copper_key="steel_dark",
        downspout_x=hall_cx + hall_L * 0.5
    )

    # Luminous Frosted Polycarbonate Skylight Bands embedded cleanly on both roof slopes!
    sky_pitch = math.atan(slope)
    sky_slope_w = min(2.4, hall_D * 0.24)
    sky_y_off = hall_D * 0.24
    sky_z = H + (hall_D * 0.5 - sky_y_off) * slope + 0.22
    for i in range(bay_count):
        if i % 2 == 0 or bay_count <= 4:
            sx = hall_cx - hall_L * 0.5 + (i + 0.5) * (hall_L / bay_count)
            seg_w = (hall_L / bay_count) * 0.68
            # South slope skylight
            add_box(bms["skylight"], sx, hall_cy - sky_y_off, sky_z, seg_w, sky_slope_w, 0.08, rot_x=sky_pitch)
            # North slope skylight
            add_box(bms["skylight"], sx, hall_cy + sky_y_off, sky_z, seg_w, sky_slope_w, 0.08, rot_x=-sky_pitch)

    # ------------------------------------------------------------------
    # 3. Oversized Industrial Sliding Machinery Doors & Ribbon Windows
    # ------------------------------------------------------------------
    front_y = hall_cy - hall_D * 0.5
    door_w = min(4.3, hall_L * 0.22)
    door_h = min(4.45, H - 0.95)
    # Continuous heavy galvanized overhead slider track rail along front wall!
    add_box(bms["silo_steel"], hall_cx, front_y - 0.16, door_h + 0.26, hall_L * 0.88, 0.20, 0.22)

    door_centers = [hall_cx - hall_L * 0.25, hall_cx + hall_L * 0.16]
    for idx, dcx in enumerate(door_centers):
        # Dark recessed machinery bay interior behind door opening
        add_box(bms["steel_dark"], dcx, front_y - 0.04, 0.10 + door_h * 0.5, door_w, 0.12, door_h)
        # Heavy steel door jamb trim
        add_box(bms["steel_dark"], dcx - door_w * 0.5 - 0.09, front_y - 0.09, 0.10 + door_h * 0.5, 0.18, 0.22, door_h + 0.16)
        add_box(bms["steel_dark"], dcx + door_w * 0.5 + 0.09, front_y - 0.09, 0.10 + door_h * 0.5, 0.18, 0.22, door_h + 0.16)

        # Sliding steel corrugated door panel (2nd door slid 36% open to show real architectural depth!)
        slide_off = 0.0 if idx == 0 else door_w * 0.36
        px = dcx + slide_off
        add_box(bms["roof_metal"], px, front_y - 0.16, 0.12 + door_h * 0.5, door_w + 0.12, 0.10, door_h)
        # Perimeter steel stiffener frame + trolley hangers on overhead track
        add_box(bms["steel_dark"], px, front_y - 0.22, 0.12 + door_h * 0.5, door_w + 0.14, 0.04, 0.14)
        for hx in (-door_w * 0.38, door_w * 0.38):
            add_box(bms["silo_steel"], px + hx, front_y - 0.18, door_h + 0.18, 0.16, 0.18, 0.28)
        # Industrial recessed safety grab handle
        add_box(bms["silo_steel"], px - door_w * 0.40, front_y - 0.23, 1.35, 0.08, 0.08, 0.42)

    # Personnel side door near right end + horizontal translucent clerestory ribbon windows along walls
    pdoor_x = hall_cx + hall_L * 0.42
    add_box(bms["steel_dark"], pdoor_x, front_y - 0.06, 1.18, 1.18, 0.16, 2.18)
    add_box(bms["silo_steel"], pdoor_x, front_y - 0.10, 1.16, 0.98, 0.08, 2.02)
    # High industrial ribbon window band along rear (+Y) and West gable (-X) walls
    win_z = H - 0.92
    add_box(bms["steel_dark"], hall_cx, hall_cy + hall_D * 0.5 + 0.04, win_z, hall_L * 0.84, 0.12, 1.05)
    add_box(bms["glass_warm"], hall_cx, hall_cy + hall_D * 0.5 + 0.07, win_z, hall_L * 0.82, 0.08, 0.88)
    # West gable industrial ribbon window + ventilation louver
    west_x = hall_cx - hall_L * 0.5
    add_box(bms["steel_dark"], west_x - 0.04, hall_cy, win_z, 0.12, hall_D * 0.62, 1.05)
    add_box(bms["glass_warm"], west_x - 0.07, hall_cy, win_z, 0.08, hall_D * 0.60, 0.88)
    add_box(bms["steel_dark"], west_x - 0.05, hall_cy, H + Rh * 0.46, 0.12, 1.85, 0.78)

    # ------------------------------------------------------------------
    # 4. Pair of Galvanized Corrugated Steel Agricultural Silos (+X end)
    # ------------------------------------------------------------------
    if has_silos:
        silo_r = min(2.35, silo_pad_w * 0.42, D * 0.22)
        silo_h = H + 2.35
        silo_cone_h = silo_r * 0.72
        silo_x = hall_cx + hall_L * 0.5 + silo_r + 0.72
        silo_ys = [hall_cy - silo_r - 0.45, hall_cy + silo_r + 0.45]

        for idx, sy in enumerate(silo_ys):
            # Concrete circular silo ring plinth
            add_cylinder(bms["concrete"], silo_x, sy, 0.32, silo_r + 0.22, silo_r + 0.18, 0.56, segments=24)
            # Corrugated galvanized steel silo cylinder
            add_cylinder(bms["silo_steel"], silo_x, sy, 0.60 + silo_h * 0.5, silo_r, silo_r, silo_h, segments=24)
            # Conical steel silo roof + breather cap
            cone_z0 = 0.60 + silo_h
            add_cylinder(bms["silo_steel"], silo_x, sy, cone_z0 + silo_cone_h * 0.5,
                         silo_r + 0.14, 0.34, silo_cone_h, segments=24)
            add_cylinder(bms["steel_dark"], silo_x, sy, cone_z0 + silo_cone_h + 0.20,
                         0.42, 0.38, 0.38, segments=16)
            # 8 bolted vertical exterior steel stiffener ribs around cylinder
            for k in range(8):
                a = k * math.pi / 4.0
                rx = silo_x + (silo_r + 0.04) * math.cos(a)
                ry = sy + (silo_r + 0.04) * math.sin(a)
                add_box(bms["steel_dark"], rx, ry, 0.60 + silo_h * 0.5, 0.09, 0.09, silo_h, rot_z=a)
            # Overhead galvanized grain auger chute connecting silo apex into the East hall gable!
            p_silo = Vector((silo_x, sy, cone_z0 + silo_cone_h + 0.10))
            p_hall = Vector((hall_cx + hall_L * 0.5 - 0.10, sy * 0.65, H + Rh * 0.45))
            add_ridge_cap(bms["silo_steel"], p_silo, p_hall, radius=0.14, segments=10)

        # Steel safety ladder with protective cage on front silo
        lad_x = silo_x + silo_r + 0.22
        lad_y = silo_ys[0]
        for dy in (-0.22, 0.22):
            add_cylinder(bms["steel_dark"], lad_x, lad_y + dy, 0.60 + silo_h * 0.5, 0.025, 0.025, silo_h, segments=6)
        for rz_i in range(int(silo_h / 0.38)):
            add_box(bms["steel_dark"], lad_x, lad_y, 0.85 + rz_i * 0.38, 0.04, 0.44, 0.03)
        # Safety cage hoops on upper two-thirds of ladder
        for cz in range(3, int(silo_h) + 1):
            add_cylinder(bms["steel_dark"], lad_x + 0.22, lad_y, float(cz), 0.38, 0.38, 0.05, segments=12, cap_ends=False)

    # ------------------------------------------------------------------
    # Finalize meshes
    # ------------------------------------------------------------------
    uv_specs = {
        "concrete":   (3.0, 2.5, False, False),
        "cladding":   (2.8, 3.0, False, False),
        "roof_metal": (2.8, 3.0, True,  False),
        "silo_steel": (2.4, 2.4, False, False),
        "skylight":   (2.4, 2.4, True,  False),
        "steel_dark": (1.5, 1.5, False, False),
        "glass_warm": (2.2, 1.0, False, False),
    }

    objects = []
    for key, (tu, tv, slope, fit) in uv_specs.items():
        bm = bms[key]
        if len(bm.verts) == 0:
            bm.free()
            continue
        obj = finalize_mesh(
            f"AgriHalle_{key}", bm, mats[key], col,
            tile_u=tu, tile_v=tv, slope_align=slope, fit_uv=fit,
            smooth=(key in ("silo_steel",)),
        )
        objects.append(obj)

    if do_export:
        save_blend_and_export_glb(
            LANDMARKS_DIR / "agri_halle.blend",
            GLB_OUT_DIR / "agri_halle.glb",
            objects,
        )
    if do_render:
        render_preview(
            ARTIFACT_DIR / "preview_agri_halle.png",
            objects,
            cam_azimuth_deg=36.0,
            cam_elev_deg=22.0,
            dist_mult=1.82,
            samples=36,
        )
    return objects


if __name__ == "__main__":
    build_agri_halle()
