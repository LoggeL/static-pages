#!/usr/bin/env python3
"""
Hero Landmark #2: Rathaus / Historisches Gemeindehaus Kindenheim (Hauptstraße 77) — graphics-overhaul build.

Modelled against the Aug-2023 Street View shots sv_rathaus_ortsmitte (facade) and sv_kirche_full_west
(west hip, eaves, siren) and the LoD2 footprint:

- Real cadastral plan: a right trapezoid inside the surveyed 22.41 x 9.34 m bounding box (the east gable
  follows Schulgasse obliquely), 8.2 m to the eaves, hipped roof 4.65 m high.
- Pale beige-grey render on a red sandstone plinth; sandstone sill band, belt course and upper sill band;
  every window is a real opening with a moulded sandstone surround (upper floor with frieze + cornice hood),
  white two-casement window, net curtains, and roller shutters at different heights like in the photo.
- Portal with eared sandstone architrave, glazed two-leaf door with transom, granite steps that meet the
  sloping street, mosaic coat of arms with 'GEMEINDE KINDENHEIM', two wrought-iron lanterns, house number,
  bell panel, flag-holder bracket, yellow post box, zinc downpipes.
- Dark hipped tile roof with individual ridge/hip tiles, boxed timber eaves cornice, zinc gutters, chimney,
  roof light and the village siren on its mast.

Coordinates: Blender local, origin = centre of the surveyed bounding box at ground contact; the street front
is local -Y (see arch_utils docstring). Night glow: *_Emissive / *Lamp* materials carry authored emission.
"""

import json
import math

import bmesh
from mathutils import Matrix, Vector

from arch_utils import (
    ARTIFACT_DIR,
    GLB_OUT_DIR,
    LANDMARKS_DIR,
    TEX_DIR,
    MeshKit,
    SiteTerrain,
    add_box,
    add_cylinder,
    add_extruded_outline,
    add_lathe,
    add_ridge_tiles,
    add_step_flight,
    add_text,
    add_tube,
    add_ashlar_wall,
    add_wall_panel,
    ashlar_block_tint,
    clear_scene,
    edge_frame,
    ensure_collection,
    get_flat_material,
    grid_cut,
    get_image_material,
    get_library_material,
    notched_outline,
    offset_outline,
    opening_outline,
    outline_path,
    render_preview,
    save_blend_and_export_glb_draco,
    sweep_profile,
    weather_tint,
)


DEFAULT_PARAMS = {
    "length_x": 22.41,
    "depth_y": 9.34,
    "wall_h": 8.20,
    "roof_h": 4.65,
    "hip_x": 4.4,
    "foundation_depth": 1.8,
    "plinth_h": 0.90,
}

# LoD2 footprint in the GLB frame for the surveyed 22.41 x 9.34 m box (counter-clockwise from the front-east
# corner): front-east, front-west, rear-west, rear-east. The east wall is oblique (Schulgasse).
FOOTPRINT_SURVEYED = [(-11.20, -4.67), (10.68, -4.67), (11.21, 4.67), (-7.79, 4.63)]

SITE_TERRAIN_JSON = TEX_DIR / "site_terrain_kirche_rathaus.json"
FONT_SANS_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_SERIF_BOLD = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"
WALL_OUT = Vector((0.0, -1.0, 0.0))
Z_UP = Vector((0.0, 0.0, 1.0))


GLOW_MAP = TEX_DIR / "lamp_glow.png"

# Local-frame collision solids of the last build; build_all.py writes them to colliders.json in world space.
COLLIDER_SOLIDS: list = []


def _materials():
    # Library images are embedded as the unchanged library files (1K everywhere except the shared 2K ashlar
    # normal map that the church uses too). The dusty-rose trim and the darker plinth are the lighter buff
    # ashlar scan toned by vertex colours, which leaves room for pale as well as dark stones.
    return {
        "plaster": get_library_material("Rathaus_Render_BeigeGrey_Emissive", "plaster_smooth", vertex_color=True,
                                        tint=(0.90, 0.85, 0.79), albedo_res="1k", normal_res="1k", orm_res="1k",
                                        normal_strength=0.9, glow_map=GLOW_MAP, glow_strength=0.05),
        "red": get_library_material("Rathaus_Sandstone_Rose", "sandstone_yellow_ashlar", vertex_color=True,
                                    normal_from="sandstone_red_ashlar", orm_from="sandstone_red_ashlar",
                                    albedo_res="2k", normal_res="2k", orm_res="1k", normal_strength=1.6),
        "mortar": get_flat_material("Rathaus_Lime_Mortar", (0.36, 0.33, 0.28), roughness=0.95, vertex_color=True),
        "roof": get_library_material("Rathaus_Roof_Tiles_Dark", "roof_tiles_dark", vertex_color=True,
                                     tint=(0.74, 0.70, 0.70), albedo_res="1k", normal_res="1k", orm_res="1k",
                                     normal_strength=1.2),
        # grey granite blocks: the ashlar scan already embedded for the trim, cooled to grey by the tint
        "granite": get_library_material("Rathaus_Granite_Steps", "sandstone_yellow_ashlar", tint=(0.33, 0.48, 0.88),
                                        normal_from="sandstone_red_ashlar", orm_from="sandstone_red_ashlar",
                                        albedo_res="2k", normal_res="2k", orm_res="1k", normal_strength=1.2),
        "wood_door": get_library_material("Rathaus_Door_Wood", "wood_planks_painted", tint=(0.20, 0.07, 0.07),
                                          albedo_res="1k", normal_res="1k", orm_res="1k"),
        "atlas": get_image_material("Rathaus_Details", TEX_DIR / "rathaus_details.png", roughness=0.7),
        "curtain": get_image_material("Rathaus_Curtain", TEX_DIR / "rathaus_details.png", roughness=0.9),
        "curtain_lit": get_image_material("Rathaus_Curtain_Lit_Emissive", TEX_DIR / "rathaus_details.png", roughness=0.9,
                                          emissive_strength=0.16),
        "glass_win": get_flat_material("Rathaus_Glass_Window", (0.02, 0.028, 0.036), roughness=0.05, alpha=0.52),
        "shutter": get_image_material("Rathaus_Rolladen", TEX_DIR / "rolladen_slats_albedo.png", roughness=0.55,
                                      normal_path=TEX_DIR / "rolladen_slats_normal.png", normal_strength=1.0),
        "glass_dark": get_flat_material("Rathaus_Glass_Door", (0.03, 0.035, 0.045), roughness=0.08),
        "void": get_flat_material("Rathaus_Void", (0.012, 0.012, 0.014), roughness=0.9),
        "white": get_flat_material("Rathaus_Window_Frame_White", (0.80, 0.80, 0.77), roughness=0.45),
        "iron": get_flat_material("Rathaus_Wrought_Iron", (0.025, 0.025, 0.03), roughness=0.55, metallic=0.6),
        "zinc": get_flat_material("Rathaus_Zinc", (0.42, 0.45, 0.47), roughness=0.42, metallic=0.85),
        "yellow": get_flat_material("Rathaus_Postbox_Yellow", (0.93, 0.66, 0.04), roughness=0.4),
        "paint": get_flat_material("Rathaus_Paint", (1.0, 1.0, 1.0), roughness=0.7, vertex_color=True),
        "lamp": get_flat_material("Rathaus_Lamp_Emissive", (0.62, 0.61, 0.56), roughness=0.25,
                                  emissive=(1.0, 0.80, 0.52), emissive_strength=0.22),
    }


def build_rathaus(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    clear_scene()
    col = ensure_collection("Rathaus_Kindenheim")
    T = SiteTerrain(SITE_TERRAIN_JSON, "rathaus")
    with open(TEX_DIR / "rathaus_details.json", "r", encoding="utf-8") as f:
        rects = json.load(f)["rects"]

    mats = _materials()
    kit = MeshKit(mats, vc_keys={"plaster", "red", "mortar", "roof", "paint"}, uv2_keys={"plaster"})

    L, D = cfg["length_x"], cfg["depth_y"]
    Rh = cfg["roof_h"]
    fd = cfg["foundation_depth"]
    sx_, sy_ = L / 22.41, D / 9.34
    poly = [(x * sx_, y * sy_) for x, y in FOOTPRINT_SURVEYED]
    A, Dd, C, B = poly                          # front-east, front-west, rear-west, rear-east
    front_y = A[1]
    centre = Vector((0.0, 0.0, 4.0))

    door_x = 2.40 * sx_

    def ground(x_world: float) -> float:
        """Street / pavement level in front of the facade (road and sidewalk sit ~0.12 m above the terrain)."""
        return T(x_world, front_y - 0.45) + 0.12

    # --- base lift -----------------------------------------------------------------------------------
    # The street climbs ~0.7 m along the facade (east -> west) while the manifest base elevation is the
    # LOWEST ground. The photo shows ~0.55 m of plinth and four steps at the door and still ~0.4 m of plinth
    # at the west corner, so the whole building above the foundation is lifted until that is true on the
    # app's actual street surface (terrain probe). All surveyed heights are kept relative to that lifted base.
    if "base_lift" in cfg:
        lift = float(cfg["base_lift"])
    else:
        lift = max(ground(Dd[0] - 0.6) + 0.40, ground(door_x) + 0.55) - cfg["plinth_h"]
        lift = round(min(max(lift, 0.0), 0.60), 2)
    print(f"Rathaus base lift: {lift:.2f} m (street at door {ground(door_x):+.2f}, at west corner {ground(Dd[0] - 0.6):+.2f})")
    H = cfg["wall_h"] + lift

    # --- levels (photo heights above the pavement at the door, compressed to the surveyed 8.2 m eaves) ---
    z_pl = cfg["plinth_h"] + lift               # top of the sandstone plinth
    z_thr = 1.07 + lift                         # door threshold / ground-floor level
    band1 = (1.68 + lift, 1.80 + lift)          # ground-floor sill band
    gf = (1.97 + lift, 3.37 + lift, 0.98)       # clear opening: sill, head, width
    belt = (4.87 + lift, 5.05 + lift)           # belt course
    band2 = (5.13 + lift, 5.26 + lift)          # upper sill band
    uf = (5.43 + lift, 6.80 + lift, 1.00)
    eave_out = 0.35
    slope = Rh / (D * 0.5)
    z_ev = H - slope * eave_out                 # tile surface at the eave edge
    z_soffit = z_ev - 0.16
    fw = 0.17                                   # sandstone surround width

    MOSS = (0.50, 0.58, 0.36)
    ROSE = (0.92, 0.60, 0.80)                   # tone that turns the buff ashlar scan into dusty-rose sandstone
    g_mid = ground(0.0)
    wt_plaster = weather_tint(ground_z=z_pl, splash_h=1.0, splash_dark=0.22, splash_color=(0.80, 0.80, 0.74),
                              noise_scale=0.6, noise_amp=0.07, hue_amp=0.015, level=0.90, streak_amp=0.8, streak_scale=1.9,
                              drip_lines=[(z_soffit - 0.36, 1.6, 0.20), (belt[0] - 0.02, 1.3, 0.18), (band1[0] - 0.02, 0.8, 0.20)])
    plinth_w = dict(ground_z=g_mid, splash_h=0.9, splash_dark=0.50, splash_color=MOSS, noise_scale=1.2, noise_amp=0.16,
                    hue_amp=0.05, streak_amp=0.6, streak_scale=1.8, drip_lines=[(z_pl - 0.09, 0.9, 0.25)])
    wt_red = weather_tint(level=0.66, tone=(0.92, 0.52, 0.64), **plinth_w)
    wt_mortar = weather_tint(level=0.80, **plinth_w)
    wt_red_hi = weather_tint(ground_z=None, noise_scale=1.6, noise_amp=0.15, hue_amp=0.05, level=0.76, seed=3.0,
                             ledge_dark=0.5, ledge_color=(0.55, 0.58, 0.48), tone=ROSE)
    wt_roof = weather_tint(ground_z=None, noise_scale=0.6, noise_amp=0.18, hue_amp=0.04, level=0.86, seed=11.0)

    # ==================================================================
    # 1. Plinth, bands, eaves cornice (profiles swept around the footprint)
    # ==================================================================
    door_w, door_h = 1.19, 2.30
    PL_UV = 3.0
    pl_off_v = -(z_pl - 0.09) / PL_UV            # a bed joint right under the chamfer
    for ei in range(4):
        xf_e, half_e = edge_frame(poly[ei], poly[(ei + 1) % 4])
        add_ashlar_wall(kit, "red", "mortar", xf_e,
                        [(-half_e - 0.08, -fd), (half_e + 0.08, -fd), (half_e + 0.08, z_pl - 0.09), (-half_e - 0.08, z_pl - 0.09)],
                        tile=PL_UV, off_u=0.27 * ei, off_v=pl_off_v, base=wt_red, amp=0.28, hue=0.07, seed=60 + ei,
                        joint=0.010, repair=0.05, violet=0.15, y=-0.08, normals=None, mortar_vc=wt_mortar)
    with kit.part("red", uv=("box", 3.0, 3.0, 0.4, 0.33), normals=centre, vc=wt_red_hi) as bm:
        sweep_profile(bm, [Vector((x, y, 0.0)) for x, y in poly], [(0.08, z_pl - 0.09), (0.025, z_pl), (0.0, z_pl)],
                      up=Z_UP, closed=True)

    ring = [A, Dd, C, B]
    with kit.part("red", uv=("box", 2.4, 2.4, 0.3, 0.2), normals=centre, vc=wt_red_hi) as bm:
        run = [(door_x + door_w * 0.5 + 0.26, front_y), Dd, C, B, A, (door_x - door_w * 0.5 - 0.26, front_y)]
        z0, z1, proud = band1[0], band1[1], 0.06
        sweep_profile(bm, [Vector((x, y, 0.0)) for x, y in run],
                      [(0.0, z0 - 0.02), (proud, z0), (proud, z1 - 0.01), (proud - 0.02, z1), (0.0, z1 + 0.02)],
                      up=Z_UP, cap_ends=True)
    with kit.part("red", uv=("box", 2.4, 2.4, 0.6, 0.5), normals=centre, vc=wt_red_hi) as bm:
        for (z0, z1, proud) in ((belt[0], belt[1], 0.08), (band2[0], band2[1], 0.06)):
            sweep_profile(bm, [Vector((x, y, 0.0)) for x, y in ring],
                          [(0.0, z0 - 0.02), (proud, z0), (proud, z1 - 0.01), (proud - 0.02, z1), (0.0, z1 + 0.02)],
                          up=Z_UP, closed=True)
    # boxed, cream-painted timber eaves cornice
    cream = (0.74, 0.70, 0.60)
    with kit.part("paint", uv=None, normals=centre, vc=lambda co, n: tuple(c * (0.84 if n.z > -0.5 else 0.60) for c in cream)) as bm:
        zc = z_soffit
        sweep_profile(bm, [Vector((x, y, 0.0)) for x, y in ring],
                      [(0.0, zc - 0.36), (0.04, zc - 0.34), (0.04, zc - 0.25), (0.11, zc - 0.21), (0.11, zc - 0.15),
                       (0.24, zc - 0.07), (0.28, zc - 0.05), (0.28, zc), (0.0, zc)],
                      up=Z_UP, closed=True)

    # ==================================================================
    # 2. Windows (real openings, sandstone surrounds, white casements, roller shutters)
    # ==================================================================
    curtain_day = [tuple(rects["window_curtain"]), tuple(rects["curtain_closed"]), tuple(rects["curtain_half"]), None]
    curtain_lit = [tuple(rects["window_curtain_lit"]), tuple(rects["curtain_closed_lit"])]
    frame_prof = [(fw, 0.0), (fw, 0.045), (fw - 0.03, 0.06), (0.035, 0.06), (0.0, 0.03), (0.0, -0.17)]

    def window(xf, cx, level, hood, shutter=0.0, lit=False, seed=0):
        z0, z1, w = level
        h = z1 - z0
        o = opening_outline(cx, z0, w, h, "rect")
        # surround: all four sides, mitred; plus "ears" at the head
        with kit.part("red", uv=("box", 2.2, 2.2, 0.13 * seed, 0.3), normals=centre, vc=wt_red_hi) as bm:
            sweep_profile(bm, outline_path(o), frame_prof, up=WALL_OUT, closed=True, matrix=xf)
        with kit.part("red", uv=("box", 2.2, 2.2, 0.21 * seed, 0.6), vc=wt_red_hi) as bm:
            for s in (-1.0, 1.0):
                m = xf @ Matrix.Translation((cx + s * (w * 0.5 + fw + 0.02), -0.03, z1 + fw - 0.10)) @ Matrix.Diagonal((0.07, 0.065, 0.20, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            # sill: slightly projecting slab under the bottom frame bar
            m = xf @ Matrix.Translation((cx, -0.045, z0 - fw + 0.035)) @ Matrix.Diagonal((w + 2 * fw + 0.10, 0.11, 0.07, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            if hood:
                zt = z1 + fw
                for (bw, bp, bz0, bz1) in ((w + 2 * fw + 0.06, 0.07, zt, zt + 0.15),
                                           (w + 2 * fw + 0.22, 0.12, zt + 0.15, zt + 0.22),
                                           (w + 2 * fw + 0.36, 0.18, zt + 0.22, zt + 0.28),
                                           (w + 2 * fw + 0.30, 0.10, zt + 0.28, zt + 0.31)):
                    m = xf @ Matrix.Translation((cx, -bp * 0.5 + 0.01, (bz0 + bz1) * 0.5)) @ Matrix.Diagonal((bw, bp + 0.02, bz1 - bz0, 1.0))
                    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        # white window: outer frame, centre mullion with two casements
        yd = 0.11
        with kit.part("white", uv=None) as bm:
            def wb(lx, lz, sx, sz, depth=0.06, yy=yd):
                m = xf @ Matrix.Translation((cx + lx, yy + depth * 0.5, lz)) @ Matrix.Diagonal((sx, depth, sz, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            wb(-w * 0.5 + 0.03, z0 + h * 0.5, 0.06, h)
            wb(w * 0.5 - 0.03, z0 + h * 0.5, 0.06, h)
            wb(0.0, z0 + 0.03, w, 0.06)
            wb(0.0, z1 - 0.03, w, 0.06)
            wb(0.0, z0 + h * 0.5, 0.10, h, depth=0.05, yy=yd - 0.012)
            for s in (-1.0, 1.0):                # casement rails
                wb(s * (w * 0.25 + 0.0125), z0 + 0.085, w * 0.5 - 0.11, 0.05, depth=0.04, yy=yd + 0.01)
                wb(s * (w * 0.25 + 0.0125), z1 - 0.085, w * 0.5 - 0.11, 0.05, depth=0.04, yy=yd + 0.01)
            wb(0.0, z0 - 0.012, w + 0.04, 0.025, depth=0.20, yy=-0.03)   # white inner sill board
            wb(0.0, z1 - 0.075, w - 0.01, 0.15, depth=0.085, yy=0.02)       # roller-shutter box under the lintel
        def pane_quads(bm, yy):
            for s in (-1.0, 1.0):
                xa = cx + (s * 0.05 if s > 0 else -w * 0.5 + 0.06)
                xb = cx + (w * 0.5 - 0.06 if s > 0 else -0.05)
                bm.faces.new([bm.verts.new(xf @ Vector((xa, yy, z0 + 0.06))), bm.verts.new(xf @ Vector((xb, yy, z0 + 0.06))),
                              bm.verts.new(xf @ Vector((xb, yy, z1 - 0.06))), bm.verts.new(xf @ Vector((xa, yy, z1 - 0.06)))])

        # dark reflective pane in front, the room (curtain or darkness) 9 cm behind it
        with kit.part("glass_win", uv=None, normals=None) as bm:
            pane_quads(bm, yd + 0.035)
        rect = curtain_lit[seed % len(curtain_lit)] if lit else curtain_day[(seed * 7 + 3) % len(curtain_day)]
        if rect is None:
            with kit.part("void", uv=None, normals=None) as bm:
                pane_quads(bm, yd + 0.125)
        else:
            with kit.part("curtain_lit" if lit else "curtain", uv=("rect",) + rect, normals=None) as bm:
                pane_quads(bm, yd + 0.125)
        if shutter > 0.0:
            drop = max(0.0, (h - 0.15) * shutter)
            with kit.part("shutter", uv=("box", 0.40, 0.40), normals=None) as bm:
                yy = 0.065
                zt, zb = z1 - 0.15, z1 - 0.15 - drop
                bm.faces.new([bm.verts.new(xf @ Vector((cx - w * 0.5 + 0.035, yy, zb))), bm.verts.new(xf @ Vector((cx + w * 0.5 - 0.035, yy, zb))),
                              bm.verts.new(xf @ Vector((cx + w * 0.5 - 0.035, yy, zt))), bm.verts.new(xf @ Vector((cx - w * 0.5 + 0.035, yy, zt)))])
            with kit.part("white", uv=None) as bm:
                m = xf @ Matrix.Translation((cx, 0.065, z1 - 0.15 - drop - 0.012)) @ Matrix.Diagonal((w - 0.07, 0.02, 0.03, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        return o

    # facade bay axes (local x of the front wall frame == world x - front_mid_x)
    xf_front, half_front = edge_frame(A, Dd)
    fmx = (A[0] + Dd[0]) * 0.5

    def fl(xw):
        return xw - fmx

    bays_right = [door_x + 2.26 * (i + 1) * sx_ for i in range(3)]
    bays_left = [door_x - (3.40 + 2.20 * i) * sx_ for i in range(5)]
    gf_x = sorted(bays_left + bays_right)
    uf_x = sorted(bays_left + [door_x] + bays_right)
    # roller-shutter states read off the photo (0 = up, 1 = closed); lit = softly lit at dusk
    gf_state = {bays_left[0]: (0.38, False), bays_right[0]: (0.0, True), bays_right[1]: (0.0, False), bays_right[2]: (0.0, True),
                bays_left[1]: (0.0, False), bays_left[2]: (0.55, False), bays_left[3]: (0.0, True), bays_left[4]: (1.0, False)}
    uf_state = {door_x: (0.0, True), bays_right[0]: (1.0, False), bays_right[1]: (0.12, False), bays_right[2]: (1.0, False),
                bays_left[0]: (0.0, False), bays_left[1]: (0.30, True), bays_left[2]: (1.0, False), bays_left[3]: (0.0, False),
                bays_left[4]: (0.20, True)}

    front_holes = []
    for i, xw in enumerate(gf_x):
        sh, lit = gf_state[xw]
        front_holes.append(window(xf_front, fl(xw), gf, hood=False, shutter=sh, lit=lit, seed=i))
    for i, xw in enumerate(uf_x):
        sh, lit = uf_state[xw]
        front_holes.append(window(xf_front, fl(xw), uf, hood=True, shutter=sh, lit=lit, seed=10 + i))
    door_o = opening_outline(fl(door_x), z_thr, door_w, door_h, "rect")
    door_notch = [(door_o[0][0], z_pl), door_o[1], door_o[2], (door_o[3][0], z_pl)]
    lantern_z = 3.92 + lift
    lantern_dx = 1.30
    inv_front = xf_front.inverted()

    def lantern_uv2(co):
        # mirrored about the door axis, so one light-pool image serves both lanterns
        loc = inv_front @ co
        return (0.5 + (abs(loc.x - fl(door_x)) - lantern_dx) / 3.6, 0.5 + (loc.z - lantern_z + 0.30) / 3.6)

    def plaster_cut(bm, axis_cut=False):
        grid_cut(bm, 0.45, "xy")
        grid_cut(bm, 0.75, "z")
        if axis_cut:
            bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-5,
                                   plane_co=xf_front @ Vector((fl(door_x), 0.0, 0.0)), plane_no=xf_front.to_3x3() @ Vector((1.0, 0.0, 0.0)))

    with kit.part("plaster", uv=("box", 2.0, 2.0, 0.0, 0.0), normals=centre, vc=wt_plaster,
                  prepare=lambda bm: plaster_cut(bm, True), uv2=lantern_uv2) as bm:
        add_wall_panel(bm, xf_front, notched_outline(-half_front, half_front, z_pl, z_soffit, [door_notch]), front_holes)

    # other walls: rear 7 bays, oblique east gable 2 bays, blank west wall (the neighbour abuts)
    for wi, (pa, pb, n_bays) in enumerate(((Dd, C, 0), (C, B, 7), (B, A, 2))):
        xf_w, half_w = edge_frame(pa, pb)
        holes = []
        if n_bays:
            margin = 1.55
            for bi in range(n_bays):
                cx = -half_w + margin + bi * (2.0 * half_w - 2.0 * margin) / max(n_bays - 1, 1)
                holes.append(window(xf_w, cx, gf, hood=False, shutter=(0.0, 0.45, 1.0, 0.0, 0.2)[bi % 5], lit=(bi % 3 == 1), seed=30 + wi * 10 + bi))
                holes.append(window(xf_w, cx, uf, hood=True, shutter=(0.15, 0.0, 0.0, 1.0, 0.0)[bi % 5], lit=(bi % 4 == 2), seed=50 + wi * 10 + bi))
        with kit.part("plaster", uv=("box", 2.0, 2.0, 0.3 * (wi + 1), 0.0), normals=centre, vc=wt_plaster, prepare=plaster_cut) as bm:
            add_wall_panel(bm, xf_w, [(-half_w, z_pl), (half_w, z_pl), (half_w, z_soffit), (-half_w, z_soffit)], holes)
    # rendered corner lisenes on the street front
    with kit.part("plaster", uv=("box", 2.0, 2.0, 0.7, 0.2), vc=wt_plaster) as bm:
        for s, xc in ((-1.0, A[0]), (1.0, Dd[0])):
            add_box(bm, xc - s * 0.21, front_y - 0.02, (z_pl + z_soffit - 0.36) * 0.5, 0.42, 0.06, z_soffit - 0.36 - z_pl)

    # ==================================================================
    # 3. Portal, door, steps, coat of arms, lanterns, fittings
    # ==================================================================
    dxl = fl(door_x)
    portal_prof = [(0.27, 0.0), (0.27, 0.05), (0.23, 0.075), (0.06, 0.075), (0.03, 0.05), (0.0, 0.05), (0.0, -0.22)]
    with kit.part("red", uv=("box", 2.2, 2.2, 0.5, 0.1), normals=centre, vc=wt_red_hi) as bm:
        sweep_profile(bm, outline_path(door_o), portal_prof, up=WALL_OUT, matrix=xf_front, cap_ends=True)
    with kit.part("red", uv=("box", 2.2, 2.2, 0.8, 0.4), vc=wt_red_hi) as bm:
        zt = z_thr + door_h
        for s in (-1.0, 1.0):                    # ears + plinth blocks of the architrave
            m = xf_front @ Matrix.Translation((dxl + s * (door_w * 0.5 + 0.30), -0.035, zt + 0.12)) @ Matrix.Diagonal((0.08, 0.08, 0.30, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            m = xf_front @ Matrix.Translation((dxl + s * (door_w * 0.5 + 0.135), -0.045, z_thr + 0.16)) @ Matrix.Diagonal((0.30, 0.10, 0.32, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    # door: two leaves with boarded lower panels and glazed, barred upper panels; transom light above
    z_tr = z_thr + 1.96                          # transom bar
    yd = 0.16
    with kit.part("wood_door", uv=("box", 1.8, 1.8, 0.3, 0.1)) as bm:
        def db(lx, lz, sx, sz, depth=0.05, yy=yd):
            m = xf_front @ Matrix.Translation((dxl + lx, yy + depth * 0.5, lz)) @ Matrix.Diagonal((sx, depth, sz, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        db(0.0, z_tr + 0.035, door_w, 0.07, depth=0.09, yy=yd - 0.03)                 # transom bar
        db(0.0, z_thr + door_h - 0.025, door_w, 0.05)                                 # head
        for s in (-1.0, 1.0):
            db(s * (door_w * 0.5 - 0.025), z_thr + door_h * 0.5, 0.05, door_h)        # frame jambs
            lw = door_w * 0.5 - 0.052
            lc = s * (lw * 0.5 + 0.002)
            db(lc, z_thr + (z_tr - z_thr) * 0.5, lw, z_tr - z_thr, depth=0.035, yy=yd + 0.03)   # leaf slab
            for (za, zb_) in ((0.0, 0.16), (0.80, 0.92), (1.80, 1.96)):               # rails
                db(lc, z_thr + (za + zb_) * 0.5, lw, zb_ - za, depth=0.06, yy=yd + 0.005)
            for off in (-1.0, 1.0):                                                   # stiles
                db(lc + off * (lw * 0.5 - 0.045), z_thr + 0.98, 0.09, 1.96, depth=0.06, yy=yd + 0.005)
        db(0.012, z_thr + (z_tr - z_thr) * 0.5, 0.05, z_tr - z_thr, depth=0.07, yy=yd - 0.005)   # meeting stile (astragal)
        for k in range(1, 5):                                                         # transom glazing bars
            db(-door_w * 0.5 + 0.05 + k * (door_w - 0.10) / 5.0, z_tr + 0.07 + (door_h - 1.96 - 0.12) * 0.5, 0.025, door_h - 1.96 - 0.12, depth=0.04, yy=yd)
    with kit.part("glass_dark", uv=None, normals=None) as bm:
        def gq(xa, xb, za, zb_, yy):
            bm.faces.new([bm.verts.new(xf_front @ Vector((dxl + xa, yy, za))), bm.verts.new(xf_front @ Vector((dxl + xb, yy, za))),
                          bm.verts.new(xf_front @ Vector((dxl + xb, yy, zb_))), bm.verts.new(xf_front @ Vector((dxl + xa, yy, zb_)))])
        gq(-door_w * 0.5 + 0.05, door_w * 0.5 - 0.05, z_tr + 0.07, z_thr + door_h - 0.05, yd + 0.03)
        for s in (-1.0, 1.0):
            lw = door_w * 0.5 - 0.052
            lc = s * (lw * 0.5 + 0.002)
            gq(lc - lw * 0.5 + 0.09, lc + lw * 0.5 - 0.09, z_thr + 0.92, z_thr + 1.80, yd + 0.028)
    with kit.part("void", uv=None, normals=None) as bm:
        bm.faces.new([bm.verts.new(xf_front @ Vector((dxl - door_w * 0.5, yd + 0.085, z_thr))), bm.verts.new(xf_front @ Vector((dxl + door_w * 0.5, yd + 0.085, z_thr))),
                      bm.verts.new(xf_front @ Vector((dxl + door_w * 0.5, yd + 0.085, z_thr + door_h))), bm.verts.new(xf_front @ Vector((dxl - door_w * 0.5, yd + 0.085, z_thr + door_h)))])
    with kit.part("iron", uv=None) as bm:
        for s in (-1.0, 1.0):                    # window grilles of the glazed leaves
            lw = door_w * 0.5 - 0.052
            lc = s * (lw * 0.5 + 0.002)
            for k in range(1, 4):
                m = xf_front @ Matrix.Translation((dxl + lc - lw * 0.5 + 0.09 + k * (lw - 0.18) / 4.0, yd + 0.02, z_thr + 1.36)) @ Matrix.Diagonal((0.012, 0.012, 0.88, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            m = xf_front @ Matrix.Translation((dxl + lc, yd + 0.02, z_thr + 1.36)) @ Matrix.Diagonal((lw - 0.18, 0.012, 0.012, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        # lever handle + escutcheon on the right leaf
        m = xf_front @ Matrix.Translation((dxl + 0.07, yd - 0.005, z_thr + 1.05)) @ Matrix.Diagonal((0.035, 0.012, 0.22, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        p0 = xf_front @ Vector((dxl + 0.07, yd - 0.01, z_thr + 1.08))
        add_tube(bm, [p0, xf_front @ Vector((dxl + 0.07, yd - 0.065, z_thr + 1.08)), xf_front @ Vector((dxl + 0.19, yd - 0.065, z_thr + 1.08))], 0.011, segments=6)
    with kit.part("atlas", uv=("rect",) + tuple(rects["notice"]), normals=None) as bm:   # notice taped inside the left leaf
        xa, xb, za, zb_ = dxl - 0.42, dxl - 0.20, z_thr + 1.18, z_thr + 1.50
        yy = yd + 0.02
        bm.faces.new([bm.verts.new(xf_front @ Vector((xa, yy, za))), bm.verts.new(xf_front @ Vector((xb, yy, za))),
                      bm.verts.new(xf_front @ Vector((xb, yy, zb_))), bm.verts.new(xf_front @ Vector((xa, yy, zb_)))])

    # granite steps down to the sloping street
    g_door = ground(door_x)
    n_rise = max(2, round((z_thr - g_door) / 0.165))
    rise = (z_thr - g_door) / n_rise
    going = 0.29
    with kit.part("granite", uv=("box", 2.5, 2.5, 0.2, 0.4)) as bm:
        m = xf_front @ Matrix.Translation((dxl, -0.16, (z_thr - 1.6) * 0.5)) @ Matrix.Diagonal((door_w + 0.75, 0.50, z_thr + 1.6, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        add_step_flight(bm, xf_front @ Matrix.Translation((dxl, -0.41, 0.0)), width=door_w + 0.75, steps=n_rise - 1,
                        rise=rise, going=going, z_top=z_thr - rise, z_bottom=-1.6, nosing=0.015, side_extra=0.0)

    # coat of arms (mosaic shield) + caption
    wz = 4.34 + lift
    shield = [(-0.39, wz + 0.46), (0.39, wz + 0.46), (0.39, wz - 0.12), (0.33, wz - 0.28), (0.20, wz - 0.40),
              (0.0, wz - 0.47), (-0.20, wz - 0.40), (-0.33, wz - 0.28), (-0.39, wz - 0.12)]
    shield = [(dxl + x, z) for x, z in shield]
    org = xf_front @ Vector((dxl - 0.39, 0.0, wz - 0.47))
    with kit.part("atlas", uv=("planar", org, xf_front.to_3x3() @ Vector((1, 0, 0)), Z_UP, 0.78, 0.93, tuple(rects["wappen"])),
                  normals=None) as bm:
        add_extruded_outline(bm, xf_front, shield, -0.025, 0.0, cap_back=False)
    with kit.part("red", uv=("box", 2.2, 2.2, 0.1, 0.7), normals=centre, vc=wt_red_hi) as bm:
        sweep_profile(bm, outline_path(list(reversed(shield))), [(0.045, 0.0), (0.045, 0.035), (0.0, 0.035), (0.0, 0.02)],
                      up=WALL_OUT, closed=True, matrix=xf_front)
    with kit.part("paint", uv=None, normals=xf_front @ Vector((dxl, 2.0, wz)), vc=lambda co, n: (0.10, 0.09, 0.09)) as bm:
        add_text(bm, "GEMEINDE KINDENHEIM", xf_front @ Matrix.Translation((dxl, -0.001, wz - 0.57)), size=0.066, depth=0.002,
                 font_path=FONT_SERIF_BOLD, resolution=1, flat=True)
        add_text(bm, "77", xf_front @ Matrix.Translation((dxl - door_w * 0.5 - 0.62, -0.001, z_thr + 1.85)), size=0.17, depth=0.004,
                 font_path=FONT_SANS_BOLD, resolution=2)

    # two wrought-iron wall lanterns
    for s in (-1.0, 1.0):
        lx = dxl + s * lantern_dx
        lz = lantern_z
        with kit.part("iron", uv=None) as bm:
            m = xf_front @ Matrix.Translation((lx, -0.02, lz - 0.30)) @ Matrix.Diagonal((0.07, 0.03, 0.20, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            add_tube(bm, [xf_front @ Vector((lx, -0.03, lz - 0.30)), xf_front @ Vector((lx, -0.20, lz - 0.34)),
                          xf_front @ Vector((lx, -0.24, lz - 0.20))], 0.014, segments=6)
            mat_l = xf_front @ Matrix.Translation((lx, -0.24, lz))
            add_lathe(bm, [(0.0, -0.21), (0.06, -0.20), (0.075, -0.17), (0.075, -0.15)], 6, mat_l, cap_bottom=False, cap_top=False)
            add_lathe(bm, [(0.135, 0.15), (0.15, 0.16), (0.07, 0.27), (0.03, 0.29), (0.03, 0.33), (0.0, 0.35)], 6, mat_l, cap_bottom=True)
            for k in range(6):                  # glazing bars of the tapered hexagonal lantern
                a = 2 * math.pi * k / 6
                add_tube(bm, [mat_l @ Vector((0.075 * math.cos(a), 0.075 * math.sin(a), -0.15)),
                              mat_l @ Vector((0.135 * math.cos(a), 0.135 * math.sin(a), 0.15))], 0.008, segments=4, cap=False)
        with kit.part("lamp", uv=None) as bm:
            add_lathe(bm, [(0.068, -0.148), (0.126, 0.148)], 6, xf_front @ Matrix.Translation((lx, -0.24, lz)), cap_bottom=True, cap_top=True)

    # bell panel, letter box, flag-holder bracket, yellow post box, basement grilles
    def plate(key, rect, xa, xb, za, zb_, yy=-0.012):
        with kit.part(key, uv=("rect",) + tuple(rect), normals=None) as bm:
            bm.faces.new([bm.verts.new(xf_front @ Vector((xa, yy, za))), bm.verts.new(xf_front @ Vector((xb, yy, za))),
                          bm.verts.new(xf_front @ Vector((xb, yy, zb_))), bm.verts.new(xf_front @ Vector((xa, yy, zb_)))])

    with kit.part("iron", uv=None) as bm:
        m = xf_front @ Matrix.Translation((dxl - door_w * 0.5 - 0.60, -0.008, z_thr + 1.18)) @ Matrix.Diagonal((0.13, 0.016, 0.28, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        m = xf_front @ Matrix.Translation((dxl + door_w * 0.5 + 0.55, -0.03, z_thr + 1.20)) @ Matrix.Diagonal((0.14, 0.06, 0.10, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        for gx in (bays_left[1], bays_left[3]):   # basement window grilles in the plinth
            m = xf_front @ Matrix.Translation((fl(gx), -0.075, z_pl - 0.38)) @ Matrix.Diagonal((0.62, 0.02, 0.30, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    plate("atlas", rects["bell_panel"], dxl - door_w * 0.5 - 0.655, dxl - door_w * 0.5 - 0.545, z_thr + 1.06, z_thr + 1.30, yy=-0.017)
    with kit.part("white", uv=None, smooth=50) as bm:
        bx, bz = dxl - 2.05, z_thr + 2.52       # four-socket flag-holder strip left of the door
        m = xf_front @ Matrix.Translation((bx, -0.01, bz)) @ Matrix.Diagonal((0.40, 0.02, 0.07, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        for k in range(4):
            p = xf_front @ Vector((bx - 0.15 + k * 0.10, -0.02, bz))
            q = xf_front @ Vector((bx - 0.15 + k * 0.10, -0.085, bz + 0.065))
            add_tube(bm, [p, q], 0.019, segments=6)
    pbx = Dd[0] - 0.52
    g_pb = ground(pbx)
    with kit.part("yellow", uv=None) as bm:
        m = xf_front @ Matrix.Translation((fl(pbx), -0.17, g_pb + 1.25)) @ Matrix.Diagonal((0.46, 0.30, 0.50, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        m = xf_front @ Matrix.Translation((fl(pbx), -0.19, g_pb + 1.515)) @ Matrix.Diagonal((0.50, 0.36, 0.035, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    with kit.part("iron", uv=None) as bm:
        m = xf_front @ Matrix.Translation((fl(pbx), -0.322, g_pb + 1.40)) @ Matrix.Diagonal((0.34, 0.012, 0.045, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    plate("atlas", rects["mailbox_plate"], fl(pbx) - 0.13, fl(pbx) + 0.13, g_pb + 1.06, g_pb + 1.32, yy=-0.323)

    # ==================================================================
    # 4. Roof: hipped, dark tiles, ridge + hip tiles, gutters, downpipes, chimney, siren
    # ==================================================================
    eave = offset_outline(poly, eave_out, closed=True)
    eA, eD, eC, eB = [Vector((x, y, z_ev)) for x, y in eave]
    hip = cfg["hip_x"]
    z_ridge = H + Rh
    R0 = Vector(((A[0] + B[0]) * 0.5 + hip, 0.0, z_ridge))      # east ridge end
    R1 = Vector(((Dd[0] + C[0]) * 0.5 - hip, 0.0, z_ridge))     # west ridge end
    roof_in = Vector((0.0, 0.0, H))
    with kit.part("roof", uv=("slope", 3.0, 3.0), normals=roof_in, vc=wt_roof, cut=1.5) as bm:
        for pts in ([eA, eD, R1, R0], [eC, eB, R0, R1], [eD, eC, R1], [eB, eA, R0]):
            bm.faces.new([bm.verts.new(p) for p in pts])
    with kit.part("roof", uv=("box", 3.0, 3.0, 0.3, 0.2), vc=wt_roof) as bm:
        add_ridge_tiles(bm, R0 + Vector((-0.05, 0, 0.03)), R1 + Vector((0.05, 0, 0.03)), radius=0.15, tile_len=0.40)
        for e, r in ((eA, R0), (eB, R0), (eD, R1), (eC, R1)):
            add_ridge_tiles(bm, e + Vector((0, 0, 0.02)), r + Vector((0, 0, 0.02)), radius=0.125, tile_len=0.40)
    eave_ring = [eA, eD, eC, eB]
    with kit.part("paint", uv=None, normals=roof_in, vc=lambda co, n: (0.60, 0.565, 0.48) if n.z > -0.5 else (0.44, 0.415, 0.36)) as bm:
        sweep_profile(bm, [p + Vector((0, 0, -0.005)) for p in eave_ring], [(0.0, 0.0), (0.012, -0.02), (0.012, -0.16), (0.0, -0.16)],
                      up=Z_UP, closed=True)
        inner = [Vector((x, y, z_soffit)) for x, y in poly]
        outer = [p + Vector((0, 0, -0.16)) for p in eave_ring]
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new([bm.verts.new(inner[i]), bm.verts.new(inner[j]), bm.verts.new(outer[j]), bm.verts.new(outer[i])])
    gutter = [(0.0, 0.0), (0.012, -0.045), (0.045, -0.078), (0.085, -0.090), (0.125, -0.078), (0.158, -0.045), (0.17, 0.0)]
    with kit.part("zinc", uv=None, normals=None, smooth=50) as bm:
        sweep_profile(bm, [p + Vector((0, 0, -0.03)) for p in eave_ring], gutter, up=Z_UP, closed=True)
    with kit.part("zinc", uv=None, smooth=50) as bm:
        for (cx_, cy_, sx, sy) in ((Dd[0] - 0.22, Dd[1], 0.0, -1.0), (A[0] + 0.55, A[1], 0.0, -1.0), (C[0] - 0.4, C[1], 0.0, 1.0)):
            yo = cy_ + sy * (eave_out + 0.085)
            yw = cy_ + sy * 0.10
            g = ground(cx_) if sy < 0 else T(cx_, cy_ + 0.5)
            add_tube(bm, [Vector((cx_, yo, z_ev - 0.11)), Vector((cx_, yo, z_ev - 0.28)), Vector((cx_, yw, z_ev - 0.62)),
                          Vector((cx_, yw, z_pl + 0.25)), Vector((cx_, yw + sy * 0.06, z_pl + 0.05)), Vector((cx_, yw + sy * 0.06, g - 0.3))],
                     0.048, segments=8)
    with kit.part("zinc", uv=None) as bm:
        for (cx_, cy_, sy) in ((Dd[0] - 0.22, Dd[1], -1.0), (A[0] + 0.55, A[1], -1.0), (C[0] - 0.4, C[1], 1.0)):
            for zz in (1.9 + lift, 3.6 + lift, 5.6 + lift, 7.0 + lift):
                add_box(bm, cx_, cy_ + sy * 0.08, zz, 0.14, 0.16, 0.03)

    # chimney (rendered, concrete cap), roof light on the west hip, siren on its mast
    chx, chy = -3.6 * sx_, 1.25
    ch_base = z_ridge - slope * abs(chy) - 0.4
    with kit.part("plaster", uv=("box", 2.0, 2.0, 0.1, 0.5), vc=weather_tint(ground_z=None, noise_amp=0.08, level=0.80, top_z=z_ridge + 1.0, top_fade_h=0.7, top_dark=0.45)) as bm:
        add_box(bm, chx, chy, (ch_base + z_ridge + 0.95) * 0.5, 0.62, 0.62, z_ridge + 0.95 - ch_base)
    with kit.part("granite", uv=("box", 2.5, 2.5)) as bm:
        add_box(bm, chx, chy, z_ridge + 1.00, 0.80, 0.80, 0.10)
        add_box(bm, chx, chy, z_ridge + 1.11, 0.50, 0.50, 0.12)
    with kit.part("zinc", uv=None) as bm:       # lead/zinc flashing apron around the chimney foot
        add_box(bm, chx, chy, ch_base + 0.55, 0.70, 0.70, 0.5)
    sx0 = R1.x - 0.9
    with kit.part("zinc", uv=None, smooth=60) as bm:
        add_lathe(bm, [(0.055, z_ridge - 0.2), (0.050, z_ridge + 1.75), (0.09, z_ridge + 1.78), (0.09, z_ridge + 1.84)], 10,
                  Matrix.Translation((sx0, 0.0, 0.0)))
    with kit.part("iron", uv=None, smooth=60) as bm:
        add_lathe(bm, [(0.10, z_ridge + 1.84), (0.20, z_ridge + 1.88), (0.62, z_ridge + 2.04), (0.66, z_ridge + 2.08),
                       (0.60, z_ridge + 2.12), (0.12, z_ridge + 2.26), (0.0, z_ridge + 2.28)], 18, Matrix.Translation((sx0, 0.0, 0.0)))
        add_lathe(bm, [(0.16, z_ridge + 1.66), (0.26, z_ridge + 1.70), (0.26, z_ridge + 1.80), (0.12, z_ridge + 1.84)], 12,
                  Matrix.Translation((sx0, 0.0, 0.0)))
    # roof light on the west hip plane
    hip_n = (eD - R1).cross(eC - R1).normalized()
    if hip_n.z < 0:
        hip_n = -hip_n
    mid_hip = (eD + eC + R1) / 3.0 + Vector((0.0, 0.0, 0.0))
    up_hip = (R1 - (eD + eC) * 0.5).normalized()
    side_hip = up_hip.cross(hip_n).normalized()
    with kit.part("zinc", uv=None) as bm:
        c0 = mid_hip + hip_n * 0.05
        q = [c0 - side_hip * 0.36 - up_hip * 0.50, c0 + side_hip * 0.36 - up_hip * 0.50, c0 + side_hip * 0.36 + up_hip * 0.50, c0 - side_hip * 0.36 + up_hip * 0.50]
        lo = [bm.verts.new(p - hip_n * 0.08) for p in q]
        hi = [bm.verts.new(p) for p in q]
        bm.faces.new(hi)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new([lo[i], lo[j], hi[j], hi[i]])
    with kit.part("glass_dark", uv=None, normals=None) as bm:
        c1 = mid_hip + hip_n * 0.056
        q = [c1 - side_hip * 0.30 - up_hip * 0.44, c1 + side_hip * 0.30 - up_hip * 0.44, c1 + side_hip * 0.30 + up_hip * 0.44, c1 - side_hip * 0.30 + up_hip * 0.44]
        bm.faces.new([bm.verts.new(p) for p in q])

    # ==================================================================
    # Finalize + export
    # ==================================================================
    # collision solids (local frame): the building body and the door steps
    COLLIDER_SOLIDS.clear()
    COLLIDER_SOLIDS.extend([
        offset_outline(poly, 0.10, closed=True),
        [(door_x - (door_w + 0.75) * 0.5, front_y - 0.41 - (n_rise - 1) * going), (door_x + (door_w + 0.75) * 0.5, front_y - 0.41 - (n_rise - 1) * going),
         (door_x + (door_w + 0.75) * 0.5, front_y), (door_x - (door_w + 0.75) * 0.5, front_y)],
    ])

    counts = dict(kit.tri_counts)
    objects = kit.finalize("Rathaus", col)
    print("Rathaus triangle counts per material:", {k: v for k, v in counts.items() if v}, "total", sum(counts.values()))

    if do_export:
        save_blend_and_export_glb_draco(
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
