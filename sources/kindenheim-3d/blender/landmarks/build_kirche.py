#!/usr/bin/env python3
"""
Hero Landmark #1: Evangelische Martinskirche Kindenheim (Hauptstraße 58).
Photorealism & Diff-Optimized against REAL Aug-2023 Google Street View
(`sv_kirche_front_detail.png`, `sv_kirche_full_west.png`, `sv_kirche_east_angle.png`),
Wikimedia photography (`kirche_01..04.jpg`, `kriegerdenkmal.jpg`), and RLP LoD2 LiDAR:

- Detached 1871/72 Neo-Gothic Bell Tower (5.32m x 5.22m, 47.24m total height):
  * Lower story: Lighter dusty rose-pink Pfälzer Sandstein ashlar (#B37B6C..#C08A79) w/ pale
    lime mortar, Gothic portal ('ERBAUT 1871/72', burgundy door #58), quatrefoil rose window
    (Vierpass) on S/E/W faces, bold projecting drip cornice.
  * Middle story: Pale yellow-buff ashlar (#D2C29D) + dusty-rose corner quoins (#AA6F60),
    twin narrow pointed lancet windows, projecting balcony cornice.
  * Upper belfry & clock story: Pale buff ashlar, tall pointed louvered belfry arches,
    4 black-and-gold Roman clock dials inside 4 crisp slimmer Neo-Gothic triangular Wimperge gables.
  * Spire: Steep 8-sided weathered blue-gray slate Rheinischer Helm (#444D57) + copper ribs +
    gilded Turmkugel orb & golden weathercock.
- Late-Gothic Saalbau Nave (21.42m x 8.32m, eaves 7.35m, ridge 13.06m):
  * Weathered off-white stucco (#EAE6DC), weathered warm red-brown Biberschwanz clay tile roof
    (#8B5847), 3-sided East choir apse, arched nave windows, horizontal oval oculus over arched
    South portal + semicircular steps.
- Photorealistic Churchyard Forecourt (`sv_kirche_front_detail.png` & `kriegerdenkmal.jpg`):
  * Sculpted roaring stone lion statue (Kriegerdenkmal 1930) on 4-tier buff sandstone pedestal
  * Green churchyard lawn terrace inside low dusty-rose sandstone retaining wall
  * 4 weathered stone flower planters with lush greenery & colorful geranium blooms
  * Gray granite entrance stairs w/ curved black wrought-iron handrails
  * Glass-fronted Ev. Kirchengemeinde notice board (Schaukasten) + tall silver flagpole
  * Fanned gray granite cobblestone forecourt (Bogenpflaster) meeting Hauptstraße!
"""

import math
import bmesh
from mathutils import Matrix, Vector

from arch_utils import (
    ARTIFACT_DIR,
    GLB_OUT_DIR,
    LANDMARKS_DIR,
    add_arched_window,
    add_box,
    add_cylinder,
    add_gable_wall_triangles,
    add_gutter_and_downspout,
    add_pitched_roof_solid,
    add_prism,
    add_quoins,
    add_ridge_cap,
    clear_scene,
    ensure_collection,
    finalize_mesh,
    get_pbr_material,
    render_preview,
    save_blend_and_export_glb,
)


DEFAULT_PARAMS = {
    "total_length": 21.42,
    "nave_width": 8.32,
    "nave_eave_h": 7.35,
    "nave_roof_h": 5.71,
    "tower_local_x": -6.85,
    "tower_local_y": -10.49,
    "tower_base_z": -0.40,
    "tower_size": 5.32,
    "tower_wall_h": 31.75,
    "spire_total_h": 47.24,
    "foundation_depth": 2.2,
    "plinth_h": 0.65,
}


def _add_quatrefoil_rose(bms, pos: Vector, rot_z: float, radius: float = 0.56):
    """Carved dusty-rose sandstone Gothic circular quatrefoil window (Vierpass)."""
    xf = Matrix.Translation(pos) @ Matrix.Rotation(rot_z, 4, 'Z')
    add_cylinder(bms["louvers"], pos.x, pos.y, pos.z, radius * 0.88, radius * 0.88, 0.08,
                 segments=20, rot_x=math.pi * 0.5, rot_z=rot_z)
    for i in range(16):
        a = 2.0 * math.pi * i / 16
        pt = xf @ Vector(((radius * 0.96) * math.cos(a), -0.06, (radius * 0.96) * math.sin(a)))
        add_box(bms["stone_red"], pt.x, pt.y, pt.z, 0.24, 0.16, 0.22, rot_z=rot_z, rot_y=-a)
    for i in range(4):
        a = (i + 0.5) * (math.pi * 0.5)
        pt = xf @ Vector(((radius * 0.48) * math.cos(a), -0.05, (radius * 0.48) * math.sin(a)))
        add_box(bms["stone_red"], pt.x, pt.y, pt.z, 0.20, 0.12, 0.20, rot_z=rot_z, rot_y=-a)


def _add_oval_oculus(bms, pos: Vector, rot_z: float, rx: float = 0.68, rz: float = 0.44):
    """Horizontal oval oculus window above Martinskirche South nave door."""
    xf = Matrix.Translation(pos) @ Matrix.Rotation(rot_z, 4, 'Z')
    bm_g = bms["glass_church"]
    bm_s = bms["stone_red"]
    g_verts = [
        bm_g.verts.new(xf @ Vector((rx * 0.86 * math.cos(2 * math.pi * i / 16), -0.03,
                                    rz * 0.86 * math.sin(2 * math.pi * i / 16))))
        for i in range(16)
    ]
    bm_g.faces.new(g_verts)
    for i in range(16):
        a = 2.0 * math.pi * i / 16
        pt = xf @ Vector((rx * math.cos(a), -0.06, rz * math.sin(a)))
        add_box(bm_s, pt.x, pt.y, pt.z, 0.20, 0.14, 0.17, rot_z=rot_z, rot_y=-a)


def _add_flower_planter(bms, cx: float, cy: float, z_base: float, length: float = 1.25):
    """Weathered stone flower planter box filled with lush foliage & colorful Pfalz geraniums."""
    # Stone trough box
    add_box(bms["stone_granite"], cx, cy, z_base + 0.18, length, 0.42, 0.36)
    # Lush mounded green foliage tufts
    bm_f = bms["grass_lawn"]
    for i in range(5):
        fx = cx - length * 0.36 + i * (length * 0.72 / 4.0)
        bmesh.ops.create_icosphere(
            bm_f, subdivisions=1, radius=0.17,
            matrix=Matrix.Translation((fx, cy + (0.04 if i % 2 else -0.04), z_base + 0.40))
                   @ Matrix.Diagonal((1.2, 1.0, 0.72, 1.0))
        )
    # Bright cheerful blooms (warm yellow/cream & pink geranium clusters matching sv_kirche_front_detail!)
    for i in range(6):
        bx = cx - length * 0.38 + i * (length * 0.76 / 5.0)
        by = cy + (0.07 if i % 2 else -0.07)
        key = "flowers_yellow" if i % 2 == 0 else "flowers_pink"
        bmesh.ops.create_icosphere(
            bms[key], subdivisions=1, radius=0.075,
            matrix=Matrix.Translation((bx, by, z_base + 0.49 + (0.03 if i % 3 == 0 else 0.0)))
        )


def _add_kriegerdenkmal_lion(bms, kx: float, ky: float, z0: float):
    """
    Sculpted 1930 Kindenheim Kriegerdenkmal matching `kriegerdenkmal.jpg` & `sv_kirche_front_detail.png`:
    - 4-tier weathered buff-sandstone monument pedestal (wide base plinth, chamfered lower block,
      tall inscribed central shaft, smaller crown block w/ carved wreath relief)
    - Roaring seated stone lion facing South-Southwest toward Hauptstraße: upright front forelegs,
      thick sculpted shaggy mane, sloping muscular back/haunches, raised roaring head!
    """
    bm = bms["monument_stone"]
    # Tier 1: Wide weathered granite base slab (extends down into lawn)
    add_box(bms["stone_granite"], kx, ky, z0 - 0.15, 2.30, 1.75, 0.85)
    # Tier 2: Heavy lower pedestal block + beveled shoulder
    add_box(bm, kx, ky, z0 + 0.62, 1.85, 1.38, 0.72)
    add_box(bm, kx, ky, z0 + 1.02, 1.66, 1.24, 0.12)
    # Tier 3: Tall inscribed central monument shaft ("Ihren tapferen Söhnen... Weltkrieg 1914/18")
    add_box(bm, kx, ky, z0 + 1.74, 1.44, 1.12, 1.34)
    # Tier 4: Upper carved crown plinth + sculpted wreath/helmet relief on front face
    add_box(bm, kx, ky, z0 + 2.58, 1.22, 0.96, 0.42)
    add_box(bms["stone_granite"], kx, ky - 0.49, z0 + 2.58, 0.62, 0.08, 0.28)
    # Lion base plinth pad
    z_paw = z0 + 2.84
    add_box(bm, kx, ky, z_paw - 0.03, 0.96, 0.82, 0.10)

    # Sculpted roaring seated stone lion oriented facing South-Southwest (rot_z ~ -18 deg toward Hauptstraße!)
    rot_l = math.radians(-18.0)
    xf = Matrix.Translation((kx, ky, z_paw)) @ Matrix.Rotation(rot_l, 4, 'Z')

    def lion_part(lx, ly, lz, sx, sy, sz, rx=0.0, ry=0.0, rz=0.0, sphere=False):
        rot = Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
        mat = xf @ Matrix.Translation((lx, ly, lz)) @ rot @ Matrix.Diagonal((sx, sy, sz, 1.0))
        if sphere:
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.5, matrix=mat)
        else:
            bmesh.ops.create_cube(bm, size=1.0, matrix=mat)

    # Upright muscular front forelegs + sculpted paws resting on front of plinth (-Y)
    for sx in (-0.17, 0.17):
        lion_part(sx, -0.26, 0.34, 0.17, 0.18, 0.66, rx=math.radians(-6))
        lion_part(sx, -0.32, 0.06, 0.20, 0.26, 0.11, sphere=True)
    # Broad deep chest & thick shaggy sculpted lion mane!
    lion_part(0.0, -0.18, 0.72, 0.56, 0.50, 0.54, sphere=True)
    lion_part(0.0, -0.12, 0.86, 0.58, 0.54, 0.52, sphere=True)
    # Raised roaring head tilted slightly upward (iconic silhouette in kriegerdenkmal.jpg!)
    lion_part(0.0, -0.24, 1.12, 0.38, 0.44, 0.38, rx=math.radians(26), sphere=True)
    lion_part(0.0, -0.38, 1.18, 0.22, 0.28, 0.22, rx=math.radians(28), sphere=True)  # snout
    # Sloping muscular back & seated haunches resting toward rear (+Y)
    lion_part(0.0,  0.14, 0.46, 0.44, 0.76, 0.38, rx=math.radians(-42), sphere=True)
    for sx in (-0.18, 0.18):
        lion_part(sx,  0.34, 0.22, 0.24, 0.40, 0.36, rx=math.radians(-20), sphere=True)
    # Tail tucked along rear plinth
    lion_part(0.18, 0.44, 0.10, 0.12, 0.34, 0.12, rz=math.radians(35), sphere=True)


def build_kirche(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    clear_scene()
    col = ensure_collection("Evangelische_Martinskirche_Kindenheim")

    mats = {
        "wall": get_pbr_material("Kirche_Nave_Stucco", "stucco_warm_cream", normal_strength=0.85),
        "stone_red": get_pbr_material("Kirche_Rose_Buntsandstein", "sandstone_red", normal_strength=1.2),
        "stone_buff": get_pbr_material("Kirche_Tower_Buff_Ashlar", "sandstone_yellow", normal_strength=1.2),
        "monument_stone": get_pbr_material("Kirche_Monument_Sandstone", "concrete_plinth", normal_strength=0.85, tint=(0.92, 0.86, 0.74)),
        "stone_granite": get_pbr_material("Kirche_Granite_Stairs", "concrete_plinth", normal_strength=1.0),
        "nave_roof": get_pbr_material("Kirche_Nave_Biberschwanz", "roof_kirche_biberschwanz", normal_strength=1.25),
        "spire_roof": get_pbr_material("Kirche_Spire_Slate", "roof_slate", normal_strength=1.15),
        "glass_church": get_pbr_material("Kirche_Leaded_Glass", "window_glass_church", normal_strength=0.55),
        "wood_dark": get_pbr_material("Kirche_Timber", "wood_timber_dark", normal_strength=1.0),
        "door_burgundy": get_pbr_material("Kirche_Burgundy_Door", "door_burgundy_panel", normal_strength=1.1),
        "louvers": get_pbr_material("Kirche_Belfry_Louvers", "belfry_louvers", normal_strength=1.3),
        "clock": get_pbr_material("Kirche_Clock_Dial", "clock_dial", normal_strength=0.8),
        "copper": get_pbr_material("Kirche_Copper_Trim", "copper_patina", normal_strength=0.7),
        "iron": get_pbr_material("Kirche_Wrought_Iron", "iron_dark", normal_strength=0.7),
        "silver": get_pbr_material("Kirche_Flagpole_Silver", "window_frame_white", normal_strength=0.1, roughness_override=0.26, metallic_override=0.85),
        "gold": get_pbr_material("Kirche_Gilded_Finial", "gold_gilded", normal_strength=0.4),
        "bogenpflaster": get_pbr_material("Kirche_Bogenpflaster", "bogenpflaster_cobble", normal_strength=1.15),
        "grass_lawn": get_pbr_material("Kirche_Kirchhof_Grass", "kirchhof_grass", normal_strength=0.95),
        "schaukasten": get_pbr_material("Kirche_Schaukasten", "kirche_schaukasten", normal_strength=0.2),
        "flowers_yellow": get_pbr_material("Kirche_Flowers_Yellow", "stucco_ochre", normal_strength=0.6, tint=(1.0, 0.92, 0.45)),
        "flowers_pink": get_pbr_material("Kirche_Flowers_Pink", "stucco_terracotta", normal_strength=0.6, tint=(1.0, 0.56, 0.72)),
    }

    bms = {k: bmesh.new() for k in mats.keys()}

    L = cfg["total_length"]
    W = cfg["nave_width"]
    H_nave = cfg["nave_eave_h"]
    H_roof = cfg["nave_roof_h"]
    fd = cfg["foundation_depth"]
    ph = cfg["plinth_h"]

    apse_len = 2.75
    nave_x0 = -L * 0.5
    nave_x1 = L * 0.5 - apse_len
    nave_len = nave_x1 - nave_x0
    nave_cx = (nave_x0 + nave_x1) * 0.5
    hw = W * 0.5

    nave_poly = [
        (nave_x0, -hw),
        (nave_x1, -hw),
        (L * 0.5, -hw * 0.42),
        (L * 0.5,  hw * 0.42),
        (nave_x1,  hw),
        (nave_x0,  hw),
    ]
    nave_poly_plinth = [
        (nave_x0 - 0.14, -(hw + 0.14)),
        (nave_x1 + 0.05, -(hw + 0.14)),
        (L * 0.5 + 0.14, -(hw * 0.42 + 0.08)),
        (L * 0.5 + 0.14,  (hw * 0.42 + 0.08)),
        (nave_x1 + 0.05,  (hw + 0.14)),
        (nave_x0 - 0.14,  (hw + 0.14)),
    ]

    # ------------------------------------------------------------------
    # 1. Late-Gothic Saalbau Nave + East 3-Sided Polygonal Choir Apse
    # ------------------------------------------------------------------
    add_prism(bms["stone_red"], nave_poly_plinth, -fd, ph)
    add_prism(bms["stone_red"], nave_poly_plinth, ph, ph + 0.12)
    add_prism(bms["wall"], nave_poly, ph + 0.10, H_nave)
    add_prism(bms["stone_red"], nave_poly_plinth, H_nave - 0.20, H_nave)

    add_gable_wall_triangles(bms["wall"], nave_cx, 0.0, H_nave, nave_len, W, H_roof,
                             wall_thick=0.40, both_ends=False, west_end=True, east_end=False)
    add_pitched_roof_solid(
        bms["nave_roof"], nave_cx, 0.0, H_nave,
        length_x=nave_len, width_y=W, ridge_h=H_roof,
        overhang_x=0.42, overhang_y=0.48, thickness=0.24, hip_x=0.0
    )
    bm_nr = bms["nave_roof"]
    ov_c = [
        (nave_x1 - 0.15, -(hw + 0.48)),
        (L * 0.5 + 0.45, -(hw * 0.42 + 0.22)),
        (L * 0.5 + 0.45,  (hw * 0.42 + 0.22)),
        (nave_x1 - 0.15,  (hw + 0.48)),
    ]
    slope_n = H_roof / max(hw, 0.1)
    z_eave_out = H_nave - slope_n * 0.48
    z_peak = H_nave + H_roof
    dz_r = 0.24 * math.sqrt(1.0 + slope_n * slope_n)
    v_b = [bm_nr.verts.new((x, y, z_eave_out)) for x, y in ov_c]
    v_t = [bm_nr.verts.new((x, y, z_eave_out + dz_r)) for x, y in ov_c]
    v_ap_t = bm_nr.verts.new((nave_x1, 0.0, z_peak + dz_r))
    v_ap_b = bm_nr.verts.new((nave_x1, 0.0, z_peak))
    for i in range(3):
        j = i + 1
        bm_nr.faces.new([v_t[i], v_t[j], v_ap_t])
        bm_nr.faces.new([v_b[j], v_b[i], v_ap_b])
        bm_nr.faces.new([v_b[i], v_b[j], v_t[j], v_t[i]])
    add_ridge_cap(bms["nave_roof"], Vector((nave_x0 - 0.45, 0.0, z_peak + dz_r)),
                  Vector((nave_x1 + 0.05, 0.0, z_peak + dz_r)), radius=0.14)
    for px, py in ov_c:
        add_ridge_cap(bms["nave_roof"], Vector((px, py, z_eave_out + dz_r)),
                      Vector((nave_x1, 0.0, z_peak + dz_r)), radius=0.11)
    for side in (-1.0, 1.0):
        add_gutter_and_downspout(
            bms, nave_x0 - 0.42, nave_x1 + 0.10,
            side * (hw + 0.52), z_eave_out + 0.06, 0.0,
            copper_key="copper", downspout_x=nave_x0 + 0.35
        )

    # South nave portal + semicircular granite steps + horizontal oval oculus + round-arched windows
    door_x = -0.8
    for st_i in range(4):
        sh = (ph + 0.10) * (1.0 - st_i * 0.22)
        add_cylinder(bms["stone_granite"], door_x, -hw - 0.15, sh * 0.5, 1.45 + st_i * 0.32, 1.45 + st_i * 0.32, sh, segments=16)
    add_arched_window(
        bms, Vector((door_x, -hw, ph + 1.45)), 0.0,
        width=1.42, height=2.65, pointed=False,
        stone_key="stone_red", glass_key="wood_dark", frame_key="iron", arch_segs=10
    )
    _add_oval_oculus(bms, Vector((door_x, -hw, ph + 4.35)), 0.0, rx=0.68, rz=0.44)

    win_z = ph + 3.55
    for wx in (nave_x0 + 2.8, nave_x0 + 6.4, door_x + 3.8, nave_x1 - 1.8):
        add_arched_window(
            bms, Vector((wx, -hw, win_z)), 0.0,
            width=1.32, height=3.15, pointed=False,
            stone_key="stone_red", glass_key="glass_church", frame_key="wood_dark"
        )
    for i in range(4):
        wx = nave_x0 + 2.5 + i * ((nave_len - 5.0) / 3.0)
        add_arched_window(
            bms, Vector((wx, hw, win_z)), math.pi,
            width=1.32, height=3.15, pointed=False,
            stone_key="stone_red", glass_key="glass_church", frame_key="wood_dark"
        )
    add_arched_window(
        bms, Vector((L * 0.5, 0.0, win_z)), math.pi * 0.5,
        width=1.24, height=3.05, pointed=False,
        stone_key="stone_red", glass_key="glass_church", frame_key="wood_dark"
    )
    st_x = nave_x1 - 0.6
    for s_i in range(10):
        add_box(bms["stone_red"], st_x + s_i * 0.30, -hw - 0.55, 0.15 + s_i * 0.24, 0.34, 1.15, 0.30 + s_i * 0.48)
    add_box(bms["wall"], st_x + 1.4, -hw - 1.15, 1.35, 3.2, 0.24, 2.7)

    # ------------------------------------------------------------------
    # 2. Detached 1871/72 Neo-Gothic Bell Tower (Street-View Calibrated!)
    # ------------------------------------------------------------------
    tx = cfg["tower_local_x"]
    ty = cfg["tower_local_y"]
    tz0 = cfg["tower_base_z"]
    T1 = cfg["tower_size"]
    T2 = T1 - 0.30
    T3 = T1 - 0.64  # Slightly slimmer crisp upper clock/gable tier (matches sv_kirche_full_west!)

    z_tier1_top = tz0 + 9.2
    z_tier2_top = tz0 + 18.8
    z_eave_twr  = tz0 + 27.9
    z_gable_top = tz0 + cfg["tower_wall_h"]
    z_spire_tip = tz0 + cfg["spire_total_h"] - 2.9
    z_finial_top = tz0 + cfg["spire_total_h"]

    # Stepped dusty-rose sandstone tower plinth & foundation skirt
    add_box(bms["stone_red"], tx, ty, (-fd - 0.4 + tz0 + 0.85) * 0.5, T1 + 0.54, T1 + 0.54, fd + 0.4 + tz0 + 0.85)
    add_box(bms["stone_red"], tx, ty, tz0 + 0.92, T1 + 0.64, T1 + 0.64, 0.16)

    # TIER 1: Lighter Dusty Rose-Pink Pfälzer Sandstein Ashlar (#B37B6C..#C08A79)
    add_box(bms["stone_red"], tx, ty, (tz0 + 0.95 + z_tier1_top) * 0.5, T1, T1, z_tier1_top - (tz0 + 0.95))
    add_box(bms["stone_red"], tx, ty, z_tier1_top + 0.14, T1 + 0.52, T1 + 0.52, 0.28)
    add_box(bms["stone_red"], tx, ty, z_tier1_top + 0.34, T1 + 0.26, T1 + 0.26, 0.16)

    ht1 = T1 * 0.5
    # 3 weathered gray granite entrance steps in front of tower portal + flower planter on step!
    for st_i in range(3):
        sh = 0.78 * (1.0 - st_i * 0.28)
        add_box(bms["stone_granite"], tx, ty - ht1 - 0.42 - st_i * 0.34, tz0 + sh * 0.5, 2.35 + st_i * 0.26, 0.38, sh)
    _add_flower_planter(bms, tx, ty - ht1 - 0.68, tz0 + 0.52, length=0.96)

    # Gothic tower portal arch (without vertical mullion bisecting the cream tympanum!)
    tmp_unused = bmesh.new()
    bms["_skip_mullion"] = tmp_unused
    add_arched_window(
        bms, Vector((tx, ty - ht1, tz0 + 2.55)), 0.0,
        width=1.42, height=3.45, pointed=True,
        stone_key="stone_red", glass_key="wall", frame_key="_skip_mullion", arch_segs=12
    )
    tmp_unused.free()
    del bms["_skip_mullion"]
    add_box(bms["stone_red"], tx, ty - ht1 - 0.08, tz0 + 3.12, 1.56, 0.14, 0.16)  # crisp carved stone lintel above burgundy door
    add_box(bms["door_burgundy"], tx, ty - ht1 - 0.06, tz0 + 1.92, 1.32, 0.10, 2.28)
    _add_quatrefoil_rose(bms, Vector((tx, ty - ht1, tz0 + 6.45)), 0.0, radius=0.58)
    _add_quatrefoil_rose(bms, Vector((tx - ht1, ty, tz0 + 6.45)), -math.pi * 0.5, radius=0.56)
    _add_quatrefoil_rose(bms, Vector((tx + ht1, ty, tz0 + 6.45)),  math.pi * 0.5, radius=0.56)

    # TIER 2: Pale Yellow-Buff Ashlar (#D2C29D) + Dusty-Rose Corner Quoins (#AA6F60)
    add_box(bms["stone_buff"], tx, ty, (z_tier1_top + 0.35 + z_tier2_top) * 0.5, T2, T2, z_tier2_top - (z_tier1_top + 0.35))
    ht2 = T2 * 0.5
    for sx, dx in [(tx - ht2, 1.0), (tx + ht2, -1.0)]:
        for sy, dy in [(ty - ht2, 1.0), (ty + ht2, -1.0)]:
            add_quoins(bms["stone_red"], sx, sy, z_tier1_top + 0.42, z_tier2_top - 0.28, dx, dy,
                       course_h=0.48, long_l=0.80, short_l=0.42, protrude=0.06)
    add_box(bms["stone_red"], tx, ty, z_tier2_top + 0.14, T2 + 0.62, T2 + 0.62, 0.30)
    add_box(bms["stone_red"], tx, ty, z_tier2_top + 0.36, T2 + 0.30, T2 + 0.30, 0.18)

    for pair_off in (-0.42, 0.42):
        add_arched_window(
            bms, Vector((tx + pair_off, ty - ht2, z_tier1_top + 2.55)), 0.0,
            width=0.62, height=2.25, pointed=True,
            stone_key="stone_red", glass_key="louvers", frame_key="stone_red", arch_segs=8
        )
    for p, rot_f in [
        (Vector((tx - ht2, ty, z_tier1_top + 4.8)), -math.pi * 0.5),
        (Vector((tx + ht2, ty, z_tier1_top + 4.8)),  math.pi * 0.5),
        (Vector((tx, ty + ht2, z_tier1_top + 4.8)),  math.pi),
    ]:
        add_arched_window(
            bms, p, rot_f, width=0.58, height=1.85, pointed=True,
            stone_key="stone_red", glass_key="louvers", frame_key="stone_red", arch_segs=8
        )

    # TIER 3: Slimmer Crisp Belfry, 4 Clock Dials & 4 Sharp Wimperge Gables
    add_box(bms["stone_buff"], tx, ty, (z_tier2_top + 0.40 + z_eave_twr) * 0.5, T3, T3, z_eave_twr - (z_tier2_top + 0.40))
    ht3 = T3 * 0.5
    gable_h = z_gable_top - z_eave_twr

    tower_faces = [
        (Vector((tx, ty - ht3, 0.0)), 0.0, Vector((0, -1, 0))),
        (Vector((tx, ty + ht3, 0.0)), math.pi, Vector((0, 1, 0))),
        (Vector((tx - ht3, ty, 0.0)), -math.pi * 0.5, Vector((-1, 0, 0))),
        (Vector((tx + ht3, ty, 0.0)),  math.pi * 0.5, Vector((1, 0, 0))),
    ]
    belfry_z = z_tier2_top + 3.45
    clock_z = z_eave_twr + 0.05
    dial_r = 0.98

    for base_p, f_rot, out_n in tower_faces:
        tangent = Vector((math.cos(f_rot), math.sin(f_rot), 0.0))
        add_arched_window(
            bms, base_p + Vector((0, 0, belfry_z)), f_rot,
            width=1.22, height=3.80, pointed=True,
            stone_key="stone_red", glass_key="louvers", frame_key="wood_dark", arch_segs=10
        )
        bm_gb = bms["stone_buff"]
        p_l = base_p - tangent * ht3
        p_r = base_p + tangent * ht3
        p_in = -out_n * 0.48
        vg = [
            bm_gb.verts.new((p_l.x, p_l.y, z_eave_twr)),
            bm_gb.verts.new((p_r.x, p_r.y, z_eave_twr)),
            bm_gb.verts.new((base_p.x, base_p.y, z_gable_top)),
            bm_gb.verts.new((p_l.x + p_in.x, p_l.y + p_in.y, z_eave_twr)),
            bm_gb.verts.new((p_r.x + p_in.x, p_r.y + p_in.y, z_eave_twr)),
            bm_gb.verts.new((base_p.x + p_in.x, base_p.y + p_in.y, z_gable_top)),
        ]
        bm_gb.faces.new([vg[0], vg[1], vg[2]])
        bm_gb.faces.new([vg[3], vg[5], vg[4]])
        bm_gb.faces.new([vg[0], vg[3], vg[4], vg[1]])
        bm_gb.faces.new([vg[1], vg[4], vg[5], vg[2]])
        bm_gb.faces.new([vg[2], vg[5], vg[3], vg[0]])

        p_apex = Vector((base_p.x, base_p.y, z_gable_top + 0.06))
        add_ridge_cap(bms["stone_red"], Vector((p_l.x, p_l.y, z_eave_twr)), p_apex, radius=0.12, segments=6)
        add_ridge_cap(bms["stone_red"], Vector((p_r.x, p_r.y, z_eave_twr)), p_apex, radius=0.12, segments=6)
        for frac in (0.28, 0.52, 0.76):
            for sgn in (-1.0, 1.0):
                cp_c = base_p + tangent * (sgn * ht3 * (1.0 - frac)) + out_n * 0.05 + Vector((0, 0, z_eave_twr + gable_h * frac - 0.32))
                add_box(bms["stone_red"], cp_c.x, cp_c.y, cp_c.z, 0.14, 0.14, 0.24, rot_z=f_rot)

        cp = base_p + Vector((0, 0, clock_z)) + out_n * 0.08
        add_cylinder(
            bms["stone_red"], cp.x - out_n.x * 0.03, cp.y - out_n.y * 0.03, cp.z,
            r_bot=dial_r + 0.09, r_top=dial_r + 0.09, height=0.12, segments=24,
            rot_x=math.pi * 0.5, rot_z=f_rot
        )
        bm_c = bms["clock"]
        verts = [
            bm_c.verts.new(cp + out_n * 0.045 + tangent * (dial_r * math.cos(2 * math.pi * s / 24))
                           + Vector((0, 0, dial_r * math.sin(2 * math.pi * s / 24))))
            for s in range(24)
        ]
        bm_c.faces.new(verts)

    # ------------------------------------------------------------------
    # 3. Steep 8-Sided Weathered Blue-Gray Slate Spire + Golden Weathercock
    # ------------------------------------------------------------------
    bm_sp = bms["spire_roof"]
    r_oct = T3 * 0.49
    for _, f_rot, out_n in tower_faces:
        add_pitched_roof_solid(
            bm_sp, tx + out_n.x * (ht3 * 0.48), ty + out_n.y * (ht3 * 0.48), z_eave_twr - 0.05,
            length_x=ht3 * 1.12, width_y=T3 * 0.96, ridge_h=gable_h + 0.05,
            overhang_x=0.04, overhang_y=0.02, thickness=0.12, rot_z=f_rot + math.pi * 0.5
        )
    oct_bot = [
        bm_sp.verts.new((tx + r_oct * math.cos((i + 0.5) * math.pi / 4.0),
                         ty + r_oct * math.sin((i + 0.5) * math.pi / 4.0), z_eave_twr + 1.2))
        for i in range(8)
    ]
    v_tip = bm_sp.verts.new((tx, ty, z_spire_tip))
    for i in range(8):
        j = (i + 1) % 8
        bm_sp.faces.new([oct_bot[i], oct_bot[j], v_tip])
        a = (i + 0.5) * math.pi / 4.0
        add_ridge_cap(
            bms["copper"],
            Vector((tx + r_oct * math.cos(a), ty + r_oct * math.sin(a), z_eave_twr + 1.2)),
            Vector((tx, ty, z_spire_tip)),
            radius=0.042, segments=6
        )
    bm_sp.faces.new(list(reversed(oct_bot)))

    add_cylinder(bms["copper"], tx, ty, z_spire_tip + 0.15, 0.20, 0.06, 0.72, segments=12)
    bmesh.ops.create_uvsphere(
        bms["gold"], u_segments=16, v_segments=10, radius=0.30,
        matrix=Matrix.Translation((tx, ty, z_spire_tip + 0.82))
    )
    add_cylinder(bms["iron"], tx, ty, z_spire_tip + 1.85, 0.045, 0.032, 1.95, segments=8)
    add_box(bms["gold"], tx + 0.12, ty, z_finial_top - 0.18, 0.58, 0.06, 0.36)
    add_box(bms["gold"], tx + 0.34, ty, z_finial_top + 0.04, 0.20, 0.06, 0.24)

    # ------------------------------------------------------------------
    # 4. Photorealistic Churchyard Forecourt (sv_kirche_front_detail.png!)
    #    - Green churchyard lawn inside retaining wall
    #    - Fanned gray granite cobblestone Bogenpflaster apron meeting Hauptstraße
    #    - Dusty-rose sandstone retaining wall + 3 stone flower planters w/ blooms
    #    - Gray granite stairs w/ wrought-iron handrails + Schaukasten + Silver Flagpole
    #    - Sculpted 1930 Kriegerdenkmal roaring stone lion statue on 4-tier pedestal!
    # ------------------------------------------------------------------
    wall_y = ty - ht1 - 1.05  # ~ -14.2m along Hauptstraße edge
    wall_z_top = tz0 + 0.72
    # Exact Street-View-aligned forecourt X positions (verified against sv_kirche_front_detail_diff.png!):
    # Tower center = -6.85 | Nave portal = -0.8 | Flagpole = +0.6 | Schaukasten = +1.3 | Stairs = +3.2 | Kriegerdenkmal = +7.4!
    step_cx = 3.2

    # Green churchyard lawn terrace inside retaining wall (from wall_y back to nave south wall -hw!)
    lawn_y0, lawn_y1 = wall_y + 0.20, -hw + 0.25
    add_box(bms["grass_lawn"], 0.0, (lawn_y0 + lawn_y1) * 0.5, tz0 + 0.12, 22.0, lawn_y1 - lawn_y0, 0.55)
    # Stone walkway leading from stairs (+3.2) diagonally/across to nave South portal (-0.8)
    add_box(bms["stone_granite"], 1.2, wall_y + 2.4, tz0 + 0.42, 6.2, 1.85, 0.06)
    add_box(bms["stone_granite"], -0.8, (wall_y + 2.4 - hw) * 0.5, tz0 + 0.42, 2.05, abs(-hw - (wall_y + 2.4)), 0.06)

    # Fanned gray granite cobblestone forecourt apron (Bogenpflaster) in front of retaining wall toward Hauptstraße!
    apron_y0, apron_y1 = wall_y - 4.2, wall_y + 0.10
    add_box(bms["bogenpflaster"], 0.0, (apron_y0 + apron_y1) * 0.5, tz0 - 0.58, 22.4, apron_y1 - apron_y0, 0.35)
    add_box(bms["stone_granite"], 0.0, (apron_y0 + apron_y1) * 0.5, (-fd + tz0 - 0.72) * 0.5, 22.4, apron_y1 - apron_y0, fd + tz0 - 0.72)

    # Low dusty-rose sandstone retaining wall split cleanly around the granite entrance stairs at step_cx = +3.2!
    # Left wall spans [-11.2 .. +2.0], Right wall spans [+4.4 .. +11.2]
    add_box(bms["stone_red"], -4.6, wall_y, (-fd + wall_z_top) * 0.5, 13.2, 0.46, fd + wall_z_top)
    add_box(bms["stone_red"], -4.6, wall_y, wall_z_top + 0.07, 13.35, 0.58, 0.14)
    add_box(bms["stone_red"],  7.8, wall_y, (-fd + wall_z_top) * 0.5,  6.8, 0.46, fd + wall_z_top)
    add_box(bms["stone_red"],  7.8, wall_y, wall_z_top + 0.07,  6.95, 0.58, 0.14)

    # 4 weathered stone flower planters atop the retaining wall matching sv_kirche_front_detail.png!
    for px in (-9.6, -5.0, -0.4, 7.2):
        _add_flower_planter(bms, px, wall_y, wall_z_top + 0.14, length=1.35)

    # Gray granite entrance stairs rising through retaining wall + curved black wrought-iron handrails!
    for st_i in range(5):
        sh = 0.85 * (1.0 - st_i * 0.19)
        add_box(bms["stone_granite"], step_cx, wall_y + 0.95 - st_i * 0.34, tz0 - 0.45 + sh * 0.5, 2.35, 0.36, sh + 0.8)
    for side in (-1.0, 1.0):
        rx = step_cx + side * 1.22
        add_cylinder(bms["iron"], rx, wall_y - 0.35, tz0 + 0.25, 0.025, 0.025, 1.05, segments=8)
        add_cylinder(bms["iron"], rx, wall_y + 0.95, tz0 + 0.88, 0.025, 0.025, 1.05, segments=8)
        add_ridge_cap(bms["iron"], Vector((rx, wall_y - 0.35, tz0 + 0.78)),
                      Vector((rx, wall_y + 0.95, tz0 + 1.40)), radius=0.026, segments=8)

    # Glass-fronted Ev. Kirchengemeinde Notice Board (Schaukasten) right left of the stairs!
    sk_x, sk_y = step_cx - 1.95, wall_y - 0.26
    for dx in (-0.54, 0.54):
        add_cylinder(bms["silver"], sk_x + dx, sk_y, tz0 + 0.45, 0.032, 0.032, 1.95, segments=8)
    add_box(bms["silver"], sk_x, sk_y, tz0 + 1.05, 1.18, 0.12, 0.98)
    bm_sk = bms["schaukasten"]
    sw_h, sh_h = 0.53, 0.44
    bm_sk.faces.new([
        bm_sk.verts.new((sk_x - sw_h, sk_y - 0.068, tz0 + 1.05 - sh_h)),
        bm_sk.verts.new((sk_x + sw_h, sk_y - 0.068, tz0 + 1.05 - sh_h)),
        bm_sk.verts.new((sk_x + sw_h, sk_y - 0.068, tz0 + 1.05 + sh_h)),
        bm_sk.verts.new((sk_x - sw_h, sk_y - 0.068, tz0 + 1.05 + sh_h)),
    ])

    # Tall slender smooth brushed-silver aluminum flagpole right beside the Schaukasten!
    add_cylinder(bms["silver"], sk_x - 0.55, wall_y + 0.55, tz0 + 4.85, 0.048, 0.030, 9.2, segments=12)
    bmesh.ops.create_uvsphere(bms["silver"], u_segments=10, v_segments=6, radius=0.072,
                              matrix=Matrix.Translation((sk_x - 0.55, wall_y + 0.55, tz0 + 9.52)))

    # Sculpted 1930 Kriegerdenkmal roaring stone lion statue on East forecourt (matches sv_kirche_front_detail!)
    _add_kriegerdenkmal_lion(bms, kx=7.4, ky=ty - 0.75, z0=tz0 + 0.32)

    # ------------------------------------------------------------------
    # Finalize all meshes with metric UVs
    # ------------------------------------------------------------------
    uv_specs = {
        "wall":           (3.2, 3.2, False, False),
        "stone_red":      (2.4, 2.4, False, False),
        "stone_buff":     (2.3, 2.3, False, False),
        "monument_stone": (2.0, 2.0, False, False),
        "stone_granite":  (2.2, 2.2, False, False),
        "nave_roof":      (2.2, 2.2, True,  False),
        "spire_roof":     (2.0, 2.0, True,  False),
        "glass_church":   (1.1, 1.8, False, False),
        "wood_dark":      (1.6, 1.6, False, False),
        "door_burgundy":  (1.4, 2.3, False, True),
        "louvers":        (1.0, 1.2, False, False),
        "clock":          (1.0, 1.0, False, True),
        "copper":         (1.5, 1.5, False, False),
        "iron":           (1.0, 1.0, False, False),
        "silver":         (1.0, 1.0, False, False),
        "gold":           (1.0, 1.0, False, False),
        "bogenpflaster":  (2.6, 2.6, False, False),
        "grass_lawn":     (3.2, 3.2, False, False),
        "schaukasten":    (1.0, 1.0, False, True),
        "flowers_yellow": (0.8, 0.8, False, False),
        "flowers_pink":   (0.8, 0.8, False, False),
    }

    objects = []
    for key, (tu, tv, slope, fit) in uv_specs.items():
        bm = bms[key]
        if len(bm.verts) == 0:
            bm.free()
            continue
        obj = finalize_mesh(
            f"Kirche_{key}", bm, mats[key], col,
            tile_u=tu, tile_v=tv, slope_align=slope, fit_uv=fit,
            smooth=(key in ("copper", "gold", "silver", "flowers_yellow", "flowers_pink")),
        )
        objects.append(obj)

    if do_export:
        save_blend_and_export_glb(
            LANDMARKS_DIR / "evangelische_kirche.blend",
            GLB_OUT_DIR / "evangelische_kirche.glb",
            objects,
        )
    if do_render:
        render_preview(
            ARTIFACT_DIR / "preview_evangelische_kirche.png",
            objects,
            cam_azimuth_deg=24.0,
            cam_elev_deg=14.0,
            dist_mult=1.68,
            samples=40,
        )
    return objects


if __name__ == "__main__":
    build_kirche()
