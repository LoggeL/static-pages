#!/usr/bin/env python3
"""
Hero Landmark #1: Evangelische Martinskirche Kindenheim (Hauptstraße 58) — graphics-overhaul build.

Modelled against data/references/wikimedia/kirche_01..04.jpg, kriegerdenkmal.jpg and the Aug-2023
Street View shots sv_kirche_front_detail / sv_kirche_full_west / sv_kirche_east_angle:

- Free-standing 1871/72 bell tower (surveyed 5.32 m square, gables 31.75 m, finial 47.24 m above its base):
  red Buntsandstein ashlar lower stage with chamfered plinth, moulded Gothic portal (three roll orders,
  shouldered lintel, 'ERBAUT 18 71/72' tympanum, six-panel burgundy door no. 58), quatrefoil roses, drip
  cornices; yellow sandstone upper stages with red quoins, paired + single lancets, louvred belfry openings,
  four gilded clock dials with 3D hands, arcaded gable friezes, slate cross-gable roof and octagonal spire
  with lead hip rolls, gilded orb and weathercock, lightning conductor.
- Late-Gothic plastered hall nave (surveyed 21.42 x 8.32 m, eaves 7.35 m, ridge 13.06 m) with 3-sided apse:
  real window openings with sandstone surrounds and leaded glass, oval oculus, south door with round steps
  and hand rails, external gallery stair, sandstone plinth and boxed eaves cornice, plain-tile roof with
  individual ridge and hip tiles, zinc gutters and downpipes.
- Churchyard: raised terrace behind a red sandstone retaining wall with coping, steps with iron railings,
  cobbled forecourt that follows the app terrain, paved paths, stone flower troughs, parish notice board,
  flagpole, lamp, and the 1930 war memorial (stepped pedestal, wreath relief, sculpted lion).

Coordinates: Blender local, origin = nave footprint centre at ground contact (see arch_utils docstring).
Night glow: materials named *_Emissive (leaded glass, clock dials, lamp) carry authored emission.
"""

import json
import math
import random

import bmesh
from mathutils import Matrix, Vector, noise

from arch_utils import (
    ARTIFACT_DIR,
    GLB_OUT_DIR,
    LANDMARKS_DIR,
    TEX_DIR,
    PLANTING_ATLAS,
    MeshKit,
    SiteTerrain,
    add_planting_cards,
    get_alpha_card_material,
    add_box,
    add_cylinder,
    add_extruded_outline,
    add_ground_patch,
    add_lathe,
    add_ridge_tiles,
    add_sculpted_blobs,
    add_step_flight,
    add_text,
    add_tube,
    add_ashlar_wall,
    add_wall_panel,
    ashlar_block_tint,
    clear_scene,
    ensure_collection,
    get_flat_material,
    grid_cut,
    get_image_material,
    get_library_material,
    offset_outline,
    opening_outline,
    outline_path,
    render_preview,
    save_blend_and_export_glb_draco,
    sweep_profile,
    weather_tint,
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
    "plinth_h": 0.62,
}

SITE_TERRAIN_JSON = TEX_DIR / "site_terrain_kirche_rathaus.json"
FONT_SERIF_BOLD = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"
FONT_SANS_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

WALL_OUT = Vector((0.0, -1.0, 0.0))   # local outward normal of every wall frame
Z_UP = Vector((0.0, 0.0, 1.0))


def _face_xf(cx: float, cy: float, rot: float) -> Matrix:
    return Matrix.Translation((cx, cy, 0.0)) @ Matrix.Rotation(rot, 4, 'Z')


def _edge_xf(p0, p1):
    """Wall frame of a footprint edge of a counter-clockwise polygon: origin at the edge midpoint,
    local +X along the edge, local -Y outward. Returns (matrix, half_length)."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    return _face_xf((p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5, math.atan2(dy, dx)), math.hypot(dx, dy) * 0.5


def _notched_outline(x0, x1, z0, z1, notches):
    """Rectangle whose BOTTOM edge is interrupted by door-type openings (each an opening_outline whose
    sill lies on z0). Returns a single (x, z) loop."""
    pts = [(x0, z0)]
    for o in sorted(notches, key=lambda o: min(p[0] for p in o)):
        pts.extend(reversed(o))
    pts += [(x1, z0), (x1, z1), (x0, z1)]
    return pts


def _circle(cx, cz, r, segs):
    return [(cx + r * math.cos(2 * math.pi * i / segs - math.pi * 0.5),
             cz + r * math.sin(2 * math.pi * i / segs - math.pi * 0.5)) for i in range(segs)]


def _quatrefoil(cx, cz, d=0.235, r=0.172, segs=9):
    """Outline of a four-lobed tracery opening: the union of four overlapping circles on the axes, whose
    outer intersection points form the inward-pointing cusps on the diagonals."""
    p = d * math.sqrt(0.5) + math.sqrt(max(r * r - d * d * 0.5, 1e-6))
    phi = math.atan2(p * math.sqrt(0.5), p * math.sqrt(0.5) - d)
    pts = []
    for lobe in range(4):
        a0 = lobe * math.pi * 0.5
        for i in range(segs + 1):
            a = a0 - phi + 2.0 * phi * i / segs
            if i == segs:
                continue  # the next lobe starts on the shared cusp
            pts.append((cx + d * math.cos(a0) + r * math.cos(a), cz + d * math.sin(a0) + r * math.sin(a)))
    return pts


def _half_width_at(outline, cx, z):
    """Half clear width of an opening outline (symmetric about cx) at height z."""
    best = 0.0
    n = len(outline)
    for i in range(n):
        (xa, za), (xb, zb) = outline[i], outline[(i + 1) % n]
        if (za - z) * (zb - z) <= 0.0 and abs(zb - za) > 1e-9:
            t = (z - za) / (zb - za)
            best = max(best, abs(xa + (xb - xa) * t - cx))
    return best


ROOSTER = [(-0.38, 0.36), (-0.50, 0.55), (-0.62, 0.80), (-0.48, 0.98), (-0.30, 0.86), (-0.20, 0.62),
           (-0.05, 0.52), (0.12, 0.58), (0.22, 0.80), (0.20, 0.98), (0.28, 1.08), (0.36, 1.02),
           (0.42, 0.94), (0.55, 0.90), (0.42, 0.84), (0.40, 0.74), (0.34, 0.70), (0.36, 0.50),
           (0.28, 0.30), (0.10, 0.18), (0.06, 0.0), (-0.02, 0.0), (-0.04, 0.18), (-0.22, 0.22)]


GLOW_MAP = TEX_DIR / "lamp_glow.png"

# Local-frame collision solids of the last build (x east, y north of the GLB origin); build_all.py turns them
# into world-space polygons in public/assets/models/landmarks/colliders.json.
COLLIDER_SOLIDS: list = []


def _materials():
    # All library images are embedded as the unchanged library files. Stone colour is carried by vertex colours
    # (per-stone tint + weathering) on top of the scans; 2K only where the camera gets closer than ~3 m.
    # The scan's ORM roughness is a flat ~0.51 (p10-p90 0.49-0.52): far too glossy for weathered Buntsandstein --
    # sun-facing ledges, chamfers and treads mirrored the bright sky and read as clean, polished salmon stone
    # whatever their vertex-colour weathering. Constant matte roughness instead (and one image less in the GLB).
    stone = dict(normal_res="2k", normal_strength=1.6, use_orm=False, roughness=0.9)
    return {
        # ONE scan (the lighter buff ashlar) for all dressed stone: the red Buntsandstein of the lower tower, walls
        # and trim and the yellow upper stages differ only in their vertex-colour tone, which leaves headroom for
        # pale repairs as well as dark, sooty stones. "red" and "yellow" stay separate meshes of the same material.
        "red": get_library_material("Kirche_Sandstone", "sandstone_yellow_ashlar", vertex_color=True,
                                    normal_from="sandstone_red_ashlar", albedo_res="2k", **stone),
        "yellow": get_library_material("Kirche_Sandstone", "sandstone_yellow_ashlar", vertex_color=True,
                                       normal_from="sandstone_red_ashlar", albedo_res="2k", **stone),
        "mortar": get_flat_material("Kirche_Lime_Mortar", (0.36, 0.33, 0.28), roughness=0.95, vertex_color=True),
        "plaster": get_library_material("Kirche_Nave_Plaster_Emissive", "plaster_smooth", vertex_color=True,
                                        tint=(0.97, 0.955, 0.91), albedo_res="1k", normal_res="1k", orm_res="1k",
                                        normal_strength=0.8, glow_map=GLOW_MAP, glow_strength=0.045),
        "roof": get_library_material("Kirche_Roof_Biberschwanz", "roof_tiles_clay_red", vertex_color=True,
                                     tint=(0.58, 0.60, 0.68), albedo_res="1k", normal_res="1k", orm_res="1k",
                                     normal_strength=1.2),
        "slate": get_library_material("Kirche_Spire_Slate", "roof_slate", tint=(0.52, 0.56, 0.63),
                                      albedo_res="1k", normal_res="1k", use_orm=False, roughness=0.55,
                                      normal_strength=1.2),
        "cobble": get_library_material("Kirche_Forecourt_Cobbles", "cobblestone", vertex_color=True,
                                       tint=(0.80, 0.80, 0.80), albedo_res="1k", normal_res="1k", orm_res="1k"),
        "paving": get_library_material("Kirche_Path_Paving_Emissive", "paving_stones", tint=(0.88, 0.80, 0.74),
                                       albedo_res="1k", normal_res="1k", orm_res="1k",
                                       glow_map=GLOW_MAP, glow_strength=0.035),
        "grass": get_library_material("Kirche_Churchyard_Grass_Emissive", "grass", vertex_color=True,
                                      tint=(0.62, 0.86, 0.45), albedo_res="1k", use_normal=False, use_orm=False,
                                      roughness=0.92, glow_map=GLOW_MAP, glow_strength=0.03),
        "monument": get_library_material("Kirche_Monument_Sandstone", "plaster_smooth", vertex_color=True,
                                         tint=(0.44, 0.41, 0.33), albedo_res="1k", normal_res="1k", orm_res="1k",
                                         normal_strength=1.8),
        "wood_door": get_library_material("Kirche_Door_Burgundy", "wood_planks_painted", tint=(0.19, 0.034, 0.042),
                                          albedo_res="1k", normal_res="1k", orm_res="1k"),
        "wood_dark": get_library_material("Kirche_Timber_Dark", "wood_planks_painted", tint=(0.20, 0.13, 0.085),
                                          albedo_res="1k", normal_res="1k", orm_res="1k"),
        "atlas": get_image_material("Kirche_Details", TEX_DIR / "kirche_details.png", roughness=0.75),
        "clock": get_image_material("Kirche_Clock_Emissive", TEX_DIR / "kirche_details.png", roughness=0.45,
                                    emissive_strength=0.10),
        "glass_lead": get_image_material("Kirche_Glass_Leaded_Emissive", TEX_DIR / "kirche_leaded_glass_albedo.png",
                                         roughness=0.12, normal_path=TEX_DIR / "kirche_leaded_glass_normal.png",
                                         normal_strength=1.0, emissive_strength=0.08,
                                         emissive_path=TEX_DIR / "kirche_leaded_glass_emissive.png"),
        "glass_dark": get_flat_material("Kirche_Glass_Dark", (0.035, 0.045, 0.06), roughness=0.08),
        "void": get_flat_material("Kirche_Void", (0.012, 0.012, 0.014), roughness=0.9),
        "iron": get_flat_material("Kirche_Wrought_Iron", (0.03, 0.03, 0.035), roughness=0.55, metallic=0.6),
        "zinc": get_flat_material("Kirche_Zinc", (0.42, 0.45, 0.47), roughness=0.42, metallic=0.85),
        "lead": get_flat_material("Kirche_Lead", (0.16, 0.17, 0.19), roughness=0.55, metallic=0.6),
        "gold": get_flat_material("Kirche_Gilding", (0.86, 0.62, 0.20), roughness=0.28, metallic=1.0),
        "alu": get_flat_material("Kirche_Aluminium", (0.66, 0.68, 0.70), roughness=0.38, metallic=0.8),
        "paint": get_flat_material("Kirche_Paint", (1.0, 1.0, 1.0), roughness=0.7, vertex_color=True),
        "planting": get_alpha_card_material("Kirche_Trough_Planting", PLANTING_ATLAS, roughness=0.8),
        "lamp": get_flat_material("Kirche_Lamp_Emissive", (0.70, 0.68, 0.62), roughness=0.3,
                                  emissive=(1.0, 0.80, 0.52), emissive_strength=0.22),
    }


def build_kirche(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    clear_scene()
    col = ensure_collection("Evangelische_Martinskirche_Kindenheim")
    T = SiteTerrain(SITE_TERRAIN_JSON, "evangelische_kirche")
    with open(TEX_DIR / "kirche_details.json", "r", encoding="utf-8") as f:
        rects = json.load(f)["rects"]

    mats = _materials()
    kit = MeshKit(mats, vc_keys={"red", "yellow", "mortar", "plaster", "roof", "cobble", "grass", "monument", "paint"},
                  uv2_keys={"plaster", "paving", "grass"})

    L = cfg["total_length"]
    W = cfg["nave_width"]
    H = cfg["nave_eave_h"]
    H_roof = cfg["nave_roof_h"]
    fd = cfg["foundation_depth"]
    ph = cfg["plinth_h"]
    hw = W * 0.5
    GL = -0.05                                   # churchyard terrace level

    RED_UV = 1.6                                 # 5 courses per tile -> 0.32 m courses like the real tower ashlar
    YEL_UV = 1.45                                # the upper stages use smaller hammer-dressed stones (0.29 m)

    wt_roof = weather_tint(ground_z=None, noise_scale=0.6, noise_amp=0.20, hue_amp=0.05, level=0.84, seed=11.0)
    MOSS = (0.46, 0.56, 0.30)                    # green-black algae / moss where stone stays damp
    SOOT = (0.60, 0.60, 0.58)
    yard_lamp = (1.75, -15.7)                    # churchyard lamp post (light pool on lawn + paths)

    # ==================================================================
    # 1. BELL TOWER
    # ==================================================================
    tx, ty = cfg["tower_local_x"], cfg["tower_local_y"]
    tz0 = cfg["tower_base_z"]
    T1 = cfg["tower_size"]
    h1 = T1 * 0.5
    h2 = h1 - 0.15
    h3 = h1 - 0.32
    z_thr = GL + 0.55                            # portal threshold (three risers above the terrace)
    z_c1 = tz0 + 9.6                             # first drip cornice
    z_c2 = tz0 + 18.8                            # second cornice (belfry stage above)
    z_eave = tz0 + 27.9                          # gable springing
    z_gable = tz0 + cfg["tower_wall_h"]          # gable apex (surveyed)
    z_tip = tz0 + cfg["spire_total_h"] - 2.9     # spire tip
    z_fin = tz0 + cfg["spire_total_h"]           # top of the weathercock (surveyed)
    gable_k = (z_gable - z_eave) / h3
    tower_c = Vector((tx, ty, 14.0))
    faces = [("S", 0.0, 0.0, -1.0), ("E", math.pi * 0.5, 1.0, 0.0),
             ("N", math.pi, 0.0, 1.0), ("W", -math.pi * 0.5, -1.0, 0.0)]

    def tface(h, nx, ny, rot):
        return _face_xf(tx + nx * h, ty + ny * h, rot)

    # --- weathering (vertex colours on top of the neutral library scans) ---
    # Buntsandstein as built: dark brown-red, mossy and damp at the ground, sooty run-off below every cornice.
    # Tone that turns the buff scan into weathered Palatinate Buntsandstein. Measured on the lower tower stage
    # (sv_kirche_front_detail.png, kirche_04.jpg, normalised to the white nave plaster in the same frame): hue
    # 20-24 deg, G/R 0.80-0.83, B/R 0.69-0.71 in sRGB -- a dusty, greyish brown-red, not the clean salmon-pink
    # (hue 15, G/R 0.74) the old tone (0.665, 0.40, 0.48) rendered. Green is raised most, blue a little.
    RED = (0.70, 0.525, 0.56)
    wt_red = weather_tint(ground_z=GL, splash_h=1.1, splash_dark=0.55, splash_color=MOSS, noise_scale=0.9, noise_amp=0.16,
                          hue_amp=0.06, level=0.76, ledge_dark=0.6, ledge_color=MOSS, tone=RED)
    # plinth courses: darker, greyer and green-black from splash water and lichen, as on kirche_04.jpg
    # (measured there: #75604b, hue 30, a grey-green-brown band clearly darker than the wall above)
    wt_plinth = weather_tint(ground_z=GL - 0.6, splash_h=1.5, splash_dark=0.80, splash_color=MOSS, noise_scale=2.2,
                             noise_amp=0.34, hue_amp=0.05, level=0.60, ledge_dark=0.92, ledge_color=(0.40, 0.46, 0.30),
                             tone=(0.64, 0.54, 0.50))
    # steps: grey, worn sandstone (kirche_02.jpg: #867b6f); the risers and the foot get the damp ground zone
    wt_step = weather_tint(ground_z=GL - 0.7, splash_h=1.0, splash_dark=0.55, splash_color=MOSS, noise_scale=2.0,
                           noise_amp=0.28, hue_amp=0.04, level=0.74, ledge_dark=0.30, ledge_color=(0.62, 0.62, 0.56),
                           tone=(0.70, 0.62, 0.62))
    # lower tower wall: damp, darker and greener towards the terrace (splash water), streaky run-off
    wall1 = dict(ground_z=GL, splash_h=1.7, splash_dark=0.62, splash_color=MOSS, noise_scale=0.55, noise_amp=0.16,
                 hue_amp=0.05, streak_amp=0.65, streak_scale=1.3, drip_lines=[(z_c1 - 0.30, 2.6, 0.34)])
    wt_red_wall = weather_tint(level=0.97, tone=RED, **wall1)
    wt_mortar1 = weather_tint(level=0.72, **wall1)
    wt_red_hi = weather_tint(ground_z=None, noise_scale=1.3, noise_amp=0.12, hue_amp=0.05, level=0.88, seed=3.0,
                             ledge_dark=0.55, ledge_color=(0.52, 0.56, 0.42), tone=RED)
    wall2 = dict(ground_z=None, noise_scale=0.5, noise_amp=0.13, hue_amp=0.05, seed=7.0,
                 streak_amp=0.65, streak_scale=1.4, drip_lines=[(z_c2 - 0.36, 3.2, 0.30)])
    wt_yel2 = weather_tint(level=0.80, tone=(1.0, 0.975, 0.92), **wall2)
    wt_mortar2 = weather_tint(level=0.92, **wall2)
    wall3 = dict(ground_z=None, noise_scale=0.5, noise_amp=0.14, hue_amp=0.05, seed=17.0,
                 streak_amp=0.6, streak_scale=1.4, drip_lines=[(z_eave + 0.4, 3.5, 0.20), (z_gable, 3.0, 0.16)])
    wt_yel3 = weather_tint(level=0.82, tone=(1.0, 0.975, 0.92), **wall3)
    wt_mortar3 = weather_tint(level=0.92, **wall3)
    wt_yel = wt_yel3
    wt_plaster = weather_tint(ground_z=ph, splash_h=1.1, splash_dark=0.26, splash_color=(0.78, 0.80, 0.74),
                              noise_scale=0.7, noise_amp=0.06, hue_amp=0.015, level=0.90, streak_amp=0.75, streak_scale=1.8,
                              drip_lines=[(6.3, 1.9, 0.20), (2.56, 1.2, 0.13)])

    # --- foundation + chamfered plinth course -------------------------
    with kit.part("red", uv=("box", RED_UV, RED_UV, 0.21, 0.4), vc=wt_plinth, cut=0.3) as bm:
        add_box(bm, tx, ty, (-fd - 0.4 + GL) * 0.5, T1 + 0.36, T1 + 0.36, GL + fd + 0.4)
    with kit.part("red", uv=("box", RED_UV * 1.2, RED_UV * 1.2, 0.5, 0.13), normals=tower_c, vc=wt_plinth, cut=0.3) as bm:
        sweep_profile(bm, [Vector((tx - h1, ty - h1, 0)), Vector((tx + h1, ty - h1, 0)),
                           Vector((tx + h1, ty + h1, 0)), Vector((tx - h1, ty + h1, 0))],
                      [(0.20, GL - 0.5), (0.20, GL + 0.40), (0.06, GL + 0.55), (0.0, GL + 0.55)],
                      up=Z_UP, closed=True)

    # --- portal profile (u away from the opening, v out of the wall) ---
    portal_profile = [(0.34, 0.0), (0.31, 0.04), (0.03, 0.04), (0.0, 0.0),
                      (-0.03, -0.05), (-0.08, -0.07), (-0.10, -0.12),
                      (-0.12, -0.17), (-0.17, -0.19), (-0.19, -0.24),
                      (-0.21, -0.29), (-0.26, -0.31), (-0.28, -0.36),
                      (-0.30, -0.40), (-0.30, -0.50)]
    portal_depth = 0.50
    portal = opening_outline(0.0, z_thr, 2.00, 4.15, "pointed", segs=16, rise=1.75)
    rose_z = tz0 + 7.15
    rose_ring = [(0.12, 0.0), (0.10, 0.04), (0.01, 0.04), (-0.03, -0.02), (-0.08, -0.05),
                 (-0.10, -0.10), (-0.14, -0.14), (-0.14, -0.24)]

    # --- stage 1: red ashlar faces with portal + quatrefoil roses ------
    for fi, (name, rot, nx, ny) in enumerate(faces):
        xf = tface(h1, nx, ny, rot)
        rose = _circle(0.0, rose_z, 0.62, 28)
        notches = [portal] if name == "S" else []
        outline = _notched_outline(-h1, h1, GL + 0.55, z_c1 - 0.30, notches)
        add_ashlar_wall(kit, "red", "mortar", xf, outline, [rose], tile=RED_UV, off_u=0.37 * fi, off_v=0.0,
                        base=wt_red_wall, amp=0.30, hue=0.09, seed=fi, joint=0.009, repair=0.025, violet=0.07,
                        normals=tower_c, mortar_vc=wt_mortar1)
        # rose: moulded round frame, pierced quatrefoil plate, dark void behind
        with kit.part("red", uv=("box", 1.7, 1.7, 0.11, 0.3), normals=tower_c, vc=wt_red_hi) as bm:
            sweep_profile(bm, outline_path(rose), rose_ring, up=WALL_OUT, closed=True, matrix=xf)
        with kit.part("red", uv=("box", 1.9, 1.9, 0.5, 0.2), vc=wt_red_hi) as bm:
            add_extruded_outline(bm, xf, _circle(0.0, rose_z, 0.50, 28), 0.13, 0.22,
                                 holes=[_quatrefoil(0.0, rose_z)], cap_back=False)
        with kit.part("void", uv=None, normals=None) as bm:
            add_extruded_outline(bm, xf, _circle(0.0, rose_z, 0.50, 16), 0.34, 0.36, cap_back=False)

    # --- portal on the south face ---------------------------------------
    xf_s = tface(h1, 0.0, -1.0, 0.0)
    with kit.part("red", uv=("box", 2.2, 2.2, 0.31, 0.17), normals=tower_c, vc=wt_red_hi) as bm:
        sweep_profile(bm, outline_path(portal), portal_profile, up=WALL_OUT, matrix=xf_s, cap_ends=False)
    inner = offset_outline(portal, -0.30)
    z_door_top = z_thr + 2.25
    z_lintel_top = z_door_top + 0.26
    with kit.part("red", uv=("box", 2.6, 2.6, 0.7, 0.45), vc=wt_red_hi) as bm:
        # plain stops at the jamb feet, door jamb strips, shouldered lintel with moulded top
        for sx in (-1.0, 1.0):
            m = xf_s @ Matrix.Translation((sx * 0.86, portal_depth * 0.5 - 0.01, z_thr + 0.21)) @ Matrix.Diagonal((0.34, portal_depth + 0.02, 0.42, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            m = xf_s @ Matrix.Translation((sx * 0.85, portal_depth * 0.5, z_thr + 0.46)) @ Matrix.Diagonal((0.30, portal_depth, 0.09, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            m = xf_s @ Matrix.Translation((sx * 0.64, portal_depth + 0.02, (z_thr + z_door_top) * 0.5)) @ Matrix.Diagonal((0.12, 0.12, z_door_top - z_thr, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            corbel = [(sx * 0.58, z_door_top), (sx * 0.58, z_door_top - 0.26), (sx * 0.52, z_door_top - 0.26),
                      (sx * 0.44, z_door_top - 0.17), (sx * 0.40, z_door_top)]
            add_extruded_outline(bm, xf_s, corbel, portal_depth - 0.12, portal_depth + 0.06)
        m = xf_s @ Matrix.Translation((0.0, portal_depth - 0.03, z_door_top + 0.10)) @ Matrix.Diagonal((1.42, 0.20, 0.20, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        m = xf_s @ Matrix.Translation((0.0, portal_depth - 0.06, z_door_top + 0.23)) @ Matrix.Diagonal((1.42, 0.26, 0.06, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    # tympanum with the painted inscription (atlas)
    tymp = [(0.70, z_lintel_top)] + [p for p in inner if p[1] > z_lintel_top + 0.01] + [(-0.70, z_lintel_top)]
    tymp_top = max(p[1] for p in tymp)
    origin = xf_s @ Vector((-0.70, 0.0, z_lintel_top))
    with kit.part("atlas", uv=("planar", origin, xf_s.to_3x3() @ Vector((1, 0, 0)), Z_UP, 1.40,
                               tymp_top - z_lintel_top, tuple(rects["tympanum"]))) as bm:
        add_extruded_outline(bm, xf_s, tymp, portal_depth - 0.02, portal_depth + 0.04, cap_back=False)
    # six-panel door leaf, studs, lever handle, house number
    with kit.part("wood_door", uv=("box", 1.8, 1.8, 0.2, 0.0)) as bm:
        def door_box(lx, lz, sx, sz, proud=0.0):
            m = xf_s @ Matrix.Translation((lx, portal_depth + 0.05 - proud * 0.5, lz)) @ Matrix.Diagonal((sx, 0.06 + proud, sz, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        door_box(0.0, z_thr + 1.125, 1.16, 2.25)
        for lx, sx in ((-0.51, 0.14), (0.0, 0.11), (0.51, 0.14)):
            door_box(lx, z_thr + 1.125, sx, 2.25, proud=0.025)
        for z_a, z_b in ((0.0, 0.22), (0.72, 0.86), (1.42, 1.54), (2.00, 2.25)):
            door_box(0.0, z_thr + (z_a + z_b) * 0.5, 1.16, z_b - z_a, proud=0.024)
    with kit.part("iron", uv=None, smooth=50) as bm:
        for i in range(6):
            p = xf_s @ Vector((-0.50 + i * 0.20, portal_depth - 0.01, z_door_top - 0.03))
            add_cylinder(bm, p.x, p.y, p.z, 0.018, 0.008, 0.02, segments=6, rot_x=math.pi * 0.5)
        for i in range(5):
            p = xf_s @ Vector((0.535, portal_depth - 0.01, z_door_top - 0.35 - i * 0.22))
            add_cylinder(bm, p.x, p.y, p.z, 0.018, 0.008, 0.02, segments=6, rot_x=math.pi * 0.5)
        m = xf_s @ Matrix.Translation((-0.44, portal_depth - 0.005, z_thr + 1.05)) @ Matrix.Diagonal((0.05, 0.012, 0.24, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        p0 = xf_s @ Vector((-0.44, portal_depth - 0.01, z_thr + 1.12))
        p1 = xf_s @ Vector((-0.44, portal_depth - 0.07, z_thr + 1.12))
        p2 = xf_s @ Vector((-0.31, portal_depth - 0.07, z_thr + 1.12))
        add_tube(bm, [p0, p1, p2], 0.012, segments=6)
    with kit.part("paint", uv=None, vc=lambda co, n: (0.90, 0.90, 0.88)) as bm:
        add_text(bm, "58", xf_s @ Matrix.Translation((0.0, portal_depth - 0.005, z_door_top - 0.135)),
                 size=0.15, depth=0.006, font_path=FONT_SANS_BOLD)
    # landing + steps in front of the portal
    with kit.part("red", uv=("box", 3.4, 3.4, 0.6, 0.2), vc=wt_step, cut=0.3) as bm:
        m = xf_s @ Matrix.Translation((0.0, -0.50, (z_thr - 0.9) * 0.5)) @ Matrix.Diagonal((2.9, 1.0, z_thr + 0.9, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        add_step_flight(bm, xf_s @ Matrix.Translation((0.0, -1.0, 0.0)), width=3.3, steps=2,
                        rise=(z_thr - GL) / 3.0, going=0.34, z_top=z_thr - (z_thr - GL) / 3.0,
                        z_bottom=-0.9, nosing=0.02, side_extra=0.30)

    # --- first drip cornice ------------------------------------------------
    def tower_cornice(h_low, h_high, z, scale, uv_off):
        prof = [(0.0, -0.34 * scale), (0.06 * scale, -0.30 * scale), (0.06 * scale, -0.22 * scale),
                (0.16 * scale, -0.12 * scale), (0.24 * scale, -0.10 * scale), (0.27 * scale, 0.0),
                (0.27 * scale, 0.05 * scale), (h_high - h_low, 0.30 * scale)]
        with kit.part("red", uv=("box", 2.4, 2.4, uv_off, 0.37), normals=tower_c, vc=wt_red_hi) as bm:
            sweep_profile(bm, [Vector((tx - h_low, ty - h_low, z)), Vector((tx + h_low, ty - h_low, z)),
                               Vector((tx + h_low, ty + h_low, z)), Vector((tx - h_low, ty + h_low, z))],
                          prof, up=Z_UP, closed=True)

    tower_cornice(h1, h2, z_c1, 1.0, 0.2)
    tower_cornice(h2, h3, z_c2, 1.15, 0.6)

    # --- generic moulded window (frame sweep + sill + recessed infill) -----
    frame_small = [(0.15, 0.0), (0.15, 0.035), (0.02, 0.035), (-0.035, -0.03), (-0.035, -0.22)]

    def window(xf, outline, cx, z0, width, infill_key, infill_uv, depth=0.22, frame=frame_small, frame_key="red",
               frame_uv=("box", 2.1, 2.1, 0.13, 0.41), frame_vc=None, inside=None, sill=True, infill_normals="solid"):
        with kit.part(frame_key, uv=frame_uv, normals=inside, vc=frame_vc) as bm:
            sweep_profile(bm, outline_path(outline), frame, up=WALL_OUT, matrix=xf, cap_ends=False)
        if sill:
            with kit.part(frame_key, uv=frame_uv, vc=frame_vc) as bm:
                m = xf @ Matrix.Translation((cx, (depth - 0.10) * 0.5, z0 - 0.07)) @ Matrix.Diagonal((width + 0.40, depth + 0.10, 0.14, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        with kit.part(infill_key, uv=infill_uv, normals=infill_normals) as bm:
            add_extruded_outline(bm, xf, offset_outline(outline, -0.03), depth - 0.02, depth, cap_back=False)

    # --- stage 2: yellow masonry, red quoins, paired + single lancets ----
    for fi, (name, rot, nx, ny) in enumerate(faces):
        xf = tface(h2, nx, ny, rot)
        holes = []
        small = opening_outline(0.0, z_c2 - 3.35, 0.46, 1.45, "pointed", segs=8, rise=0.40)
        holes.append(small)
        pair = []
        if name == "S":
            for cx in (-0.46, 0.46):
                pair.append((cx, opening_outline(cx, z_c1 + 1.05, 0.56, 2.35, "pointed", segs=8, rise=0.50)))
            holes.extend(o for _, o in pair)
        add_ashlar_wall(kit, "yellow", "mortar", xf,
                        [(-h2, z_c1 + 0.25), (h2, z_c1 + 0.25), (h2, z_c2 - 0.36), (-h2, z_c2 - 0.36)], holes,
                        tile=YEL_UV, off_u=0.41 * fi, off_v=0.2, base=wt_yel2, amp=0.26, hue=0.08, seed=10 + fi,
                        joint=0.008, repair=0.02, violet=0.0, normals=tower_c, mortar_vc=wt_mortar2)
        window(xf, small, 0.0, z_c2 - 3.35, 0.46, "glass_dark", None, depth=0.20, inside=tower_c, frame_vc=wt_red_hi)
        for cx, o in pair:
            window(xf, o, cx, z_c1 + 1.05, 0.56, "glass_dark", None, depth=0.20, inside=tower_c, frame_vc=wt_red_hi)
            with kit.part("iron", uv=None) as bm:
                for k in range(1, 4):
                    m = xf @ Matrix.Translation((cx, 0.17, z_c1 + 1.05 + k * 0.48)) @ Matrix.Diagonal((0.52, 0.02, 0.025, 1.0))
                    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    # alternating long/short red quoins on the four corners of stage 2
    with kit.part("red", uv=("box", 1.6, 1.6, 0.27, 0.6), vc=wt_red_hi) as bm:
        course = 0.33
        z = z_c1 + 0.27
        idx = 0
        while z + course * 0.6 < z_c2 - 0.36:
            hc = min(course - 0.014, z_c2 - 0.37 - z)
            for sx in (-1.0, 1.0):
                for sy in (-1.0, 1.0):
                    flip = (idx + (0 if sx * sy > 0 else 1)) % 2 == 0
                    lx, ly = (0.92, 0.50) if flip else (0.50, 0.92)
                    m = Matrix.Translation((tx + sx * (h2 + 0.025 - lx * 0.5), ty + sy * (h2 + 0.025 - ly * 0.5), z + hc * 0.5)) \
                        @ Matrix.Diagonal((lx, ly, hc, 1.0))
                    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            z += course
            idx += 1

    # --- stage 3: belfry, clocks, gables ---------------------------------
    belfry_z0 = z_c2 + 1.55
    belfry_h = 3.70
    clock_z = z_eave - 1.42
    clock_r = 0.98
    belfry_frame = [(0.19, 0.0), (0.17, 0.05), (0.03, 0.05), (-0.02, -0.02), (-0.07, -0.05), (-0.07, -0.30)]
    clock_ring = [(0.17, 0.0), (0.15, 0.05), (0.04, 0.07), (0.0, 0.035), (0.0, -0.02)]
    for fi, (name, rot, nx, ny) in enumerate(faces):
        xf = tface(h3, nx, ny, rot)
        belfry = opening_outline(0.0, belfry_z0, 1.16, belfry_h, "pointed", segs=12, rise=1.0)
        gable = [(-h3, z_c2 + 0.28), (h3, z_c2 + 0.28), (h3, z_eave), (0.0, z_gable), (-h3, z_eave)]
        add_ashlar_wall(kit, "yellow", "mortar", xf, gable, [belfry], tile=YEL_UV, off_u=0.33 * fi + 0.1, off_v=0.55,
                        base=wt_yel3, amp=0.26, hue=0.08, seed=20 + fi, joint=0.008, repair=0.02, violet=0.0,
                        normals=tower_c, mortar_vc=wt_mortar3)
        # corner lisenes + stepped arcaded frieze under the gable rakes
        with kit.part("yellow", uv=("box", YEL_UV, YEL_UV, 0.7, 0.1), vc=wt_yel) as bm:
            for sx in (-1.0, 1.0):
                m = xf @ Matrix.Translation((sx * (h3 - 0.20), -0.03, (z_c2 + 0.35 + z_eave - 0.02) * 0.5)) \
                    @ Matrix.Diagonal((0.42, 0.07, z_eave - 0.02 - z_c2 - 0.35, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
                for i in range(4):
                    a = 0.07 + 0.46 * i
                    b = a + 0.46
                    zt = z_gable - gable_k * b - 0.10
                    zb = zt - 0.58
                    xa, xb = (a, b) if sx > 0 else (-b, -a)
                    arch = opening_outline((xa + xb) * 0.5, zb, 0.34, 0.44, "round", segs=6)
                    unit = [(xa, zb)] + list(reversed(arch)) + [(xb, zb), (xb, zt), (xa, zt)]
                    add_extruded_outline(bm, xf, unit, -0.10, 0.0, cap_back=False)
        # red gable coping
        with kit.part("red", uv=("box", 2.0, 2.0, 0.4, 0.2), normals=tower_c, vc=wt_red_hi) as bm:
            sweep_profile(bm, outline_path([(h3 + 0.04, z_eave - 0.07), (0.0, z_gable + 0.01), (-h3 - 0.04, z_eave - 0.07)]),
                          [(-0.02, 0.09), (0.11, 0.09), (0.15, 0.03), (0.15, -0.34), (-0.02, -0.34)],
                          up=WALL_OUT, matrix=xf)
        # belfry opening: moulded frame, timber louvres on rails, void behind
        with kit.part("red", uv=("box", 2.1, 2.1, 0.2, 0.3), normals=tower_c, vc=wt_red_hi) as bm:
            sweep_profile(bm, outline_path(belfry), belfry_frame, up=WALL_OUT, matrix=xf, cap_ends=False)
            m = xf @ Matrix.Translation((0.0, 0.08, belfry_z0 - 0.08)) @ Matrix.Diagonal((1.62, 0.40, 0.16, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        with kit.part("wood_dark", uv=("box", 1.8, 1.8)) as bm:
            z = belfry_z0 + 0.12
            while z < belfry_z0 + belfry_h - 0.20:
                hwz = _half_width_at(belfry, 0.0, z) - 0.09
                if hwz > 0.08:
                    m = xf @ Matrix.Translation((0.0, 0.16, z)) @ Matrix.Rotation(math.radians(38), 4, 'X') \
                        @ Matrix.Diagonal((hwz * 2.0, 0.26, 0.03, 1.0))
                    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
                z += 0.215
            for zr in (belfry_z0 + 1.25, belfry_z0 + 2.45):
                m = xf @ Matrix.Translation((0.0, 0.07, zr)) @ Matrix.Diagonal((1.02, 0.07, 0.09, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            m = xf @ Matrix.Translation((0.0, 0.07, belfry_z0 + belfry_h * 0.5 - 0.3)) @ Matrix.Diagonal((0.07, 0.07, belfry_h - 0.7, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        with kit.part("void", uv=None, normals=None) as bm:
            add_extruded_outline(bm, xf, belfry, 0.36, 0.38, cap_back=False)
        # clock: red ring, gilded dial (atlas, emissive), 3D hands
        with kit.part("red", uv=("box", 2.0, 2.0, 0.6, 0.1), normals=tower_c, vc=wt_red_hi) as bm:
            sweep_profile(bm, outline_path(_circle(0.0, clock_z, clock_r, 36)), clock_ring, up=WALL_OUT,
                          closed=True, matrix=xf)
        org = xf @ Vector((-clock_r, 0.0, clock_z - clock_r))
        with kit.part("clock", uv=("planar", org, xf.to_3x3() @ Vector((1, 0, 0)), Z_UP, 2 * clock_r, 2 * clock_r,
                                   tuple(rects["clock"])), normals=None) as bm:
            add_extruded_outline(bm, xf, _circle(0.0, clock_z, clock_r, 36), -0.012, 0.0, cap_back=False)
        with kit.part("gold", uv=None) as bm:
            for ang_deg, length, width in ((54.0, 0.84, 0.050), (304.5, 0.56, 0.075)):
                m = xf @ Matrix.Translation((0.0, -0.035, clock_z)) @ Matrix.Rotation(math.radians(ang_deg), 4, 'Y') \
                    @ Matrix.Translation((0.0, 0.0, length * 0.5 - 0.12)) @ Matrix.Diagonal((width, 0.014, length, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            p = xf @ Vector((0.0, -0.03, clock_z))
            add_cylinder(bm, p.x, p.y, p.z, 0.07, 0.05, 0.03, segments=10, rot_x=math.pi * 0.5, rot_z=rot)
    with kit.part("red", uv=("box", 1.4, 1.4, 0.2, 0.2), vc=wt_red_hi) as bm:   # kneelers at the four corners
        for sx in (-1.0, 1.0):
            for sy in (-1.0, 1.0):
                add_box(bm, tx + sx * (h3 - 0.14), ty + sy * (h3 - 0.14), z_eave - 0.12, 0.46, 0.46, 0.30)

    # --- cross-gable slate roofs + octagonal spire -----------------------
    with kit.part("slate", uv=("slope", 1.5, 1.5), normals=Vector((tx, ty, z_eave))) as bm:
        centre = Vector((tx, ty, z_gable))
        inset = 0.04
        for name, rot, nx, ny in faces:
            g = Vector((tx + nx * (h3 - inset), ty + ny * (h3 - inset), z_gable))
            for s in (-1.0, 1.0):
                c = Vector((tx + nx * (h3 - inset) + (-ny) * s * (h3 - inset), ty + ny * (h3 - inset) + nx * s * (h3 - inset), z_eave))
                va, vb, vc_ = bm.verts.new(g), bm.verts.new(c), bm.verts.new(centre)
                bm.faces.new([va, vb, vc_])
        r0 = 1.90 / math.cos(math.pi / 8)
        base = [Vector((tx + r0 * math.cos(math.pi / 8 + i * math.pi / 4), ty + r0 * math.sin(math.pi / 8 + i * math.pi / 4), z_eave + 0.5))
                for i in range(8)]
        tip = Vector((tx, ty, z_tip))
        for i in range(8):
            a, b = base[i], base[(i + 1) % 8]
            bm.faces.new([bm.verts.new(a), bm.verts.new(b), bm.verts.new(tip)])
    with kit.part("lead", uv=None, smooth=60) as bm:
        for i in range(8):
            add_tube(bm, [base[i] * 0.8 + tip * 0.2, tip], 0.032, segments=5, cap=False)
        for name, rot, nx, ny in faces:
            add_tube(bm, [Vector((tx + nx * (h3 - 0.02), ty + ny * (h3 - 0.02), z_gable + 0.02)),
                          Vector((tx + nx * 1.2, ty + ny * 1.2, z_gable + 0.02))], 0.045, segments=5)
        add_lathe(bm, [(0.26, z_tip - 1.5), (0.11, z_tip - 0.25), (0.07, z_tip + 0.22), (0.12, z_tip + 0.27),
                       (0.07, z_tip + 0.34), (0.035, z_tip + 0.5)], 10, Matrix.Translation((tx, ty, 0.0)), cap_bottom=False)
    ball_z = z_tip + 0.92
    cock_h = 0.62
    with kit.part("iron", uv=None) as bm:
        add_tube(bm, [Vector((tx, ty, z_tip + 0.4)), Vector((tx, ty, z_fin - cock_h + 0.05))], 0.028, segments=6)
        # lightning conductor down the north face
        xf_n = tface(h1, 0.0, 1.0, math.pi)
        add_tube(bm, [Vector((tx + 0.6, ty + 0.5, z_tip - 1.0)), Vector((tx + 0.9, ty + h3 + 0.05, z_eave + 0.4)),
                      Vector((tx + 0.9, ty + h3 + 0.06, z_c2 + 0.45)), Vector((tx + 0.9, ty + h2 + 0.36, z_c2 + 0.05)),
                      Vector((tx + 0.9, ty + h2 + 0.06, z_c2 - 0.5)), Vector((tx + 0.9, ty + h2 + 0.06, z_c1 + 0.5)),
                      Vector((tx + 0.9, ty + h1 + 0.32, z_c1 + 0.02)), Vector((tx + 0.9, ty + h1 + 0.05, z_c1 - 0.5)),
                      Vector((tx + 0.9, ty + h1 + 0.05, GL + 0.7)), Vector((tx + 0.9, ty + h1 + 0.24, GL + 0.5)),
                      Vector((tx + 0.9, ty + h1 + 0.24, GL - 0.2))], 0.012, segments=4)
    with kit.part("gold", uv=None, smooth=60) as bm:
        prof = [(0.0, -0.33)] + [(0.33 * math.cos(a), 0.33 * math.sin(a)) for a in
                                 [math.radians(d) for d in (-67.5, -45, -22.5, 0, 22.5, 45, 67.5)]] + [(0.0, 0.33)]
        add_lathe(bm, prof, 14, Matrix.Translation((tx, ty, ball_z)))
        add_lathe(bm, [(0.0, 0.0), (0.07, 0.03), (0.04, 0.10), (0.0, 0.12)], 8, Matrix.Translation((tx, ty, z_fin - cock_h - 0.1)))
    with kit.part("gold", uv=None) as bm:
        cock = [(x * cock_h, z * cock_h / 1.08) for x, z in ROOSTER]
        add_extruded_outline(bm, Matrix.Translation((tx, ty, z_fin - cock_h)), cock, -0.02, 0.02)
        add_box(bm, tx - 0.05, ty, z_fin - cock_h - 0.02, 0.9, 0.03, 0.03)       # wind arrow shaft
        add_extruded_outline(bm, Matrix.Translation((tx, ty, z_fin - cock_h - 0.02)),
                             [(0.40, -0.07), (0.56, 0.0), (0.40, 0.07)], -0.012, 0.012)
        add_extruded_outline(bm, Matrix.Translation((tx, ty, z_fin - cock_h - 0.02)),
                             [(-0.50, 0.0), (-0.62, 0.09), (-0.44, 0.09), (-0.36, 0.0), (-0.44, -0.09), (-0.62, -0.09)], -0.012, 0.012)

    # ==================================================================
    # 2. NAVE + APSE
    # ==================================================================
    x0 = -L * 0.5
    xs = 8.05                                    # shoulder where the 3-sided apse starts (LoD2 footprint)
    xa, ya = L * 0.5 - 0.09, 1.78                # apse end wall
    poly = [(x0, -hw), (xs, -hw), (xa, -ya), (xa, ya), (xs, hw), (x0, hw)]
    nave_c = Vector((0.0, 0.0, 3.5))
    slope = H_roof / hw
    z_ridge = H + H_roof
    eave_out = 0.40
    z_ev = H - slope * eave_out                  # tile surface at the eave edge
    z_wall_top = z_ev - 0.15                     # soffit of the boxed eaves = top of the stone cornice
    door_x = -0.15
    door_w, door_h = 1.36, 2.62
    z_door = GL + 0.51
    win_w, win_h, win_z0 = 1.30, 3.40, 2.70

    # --- foundation, plinth, eaves cornice ---------------------------------
    with kit.part("red", uv=("box", RED_UV, RED_UV, 0.3, 0.6), normals=nave_c, vc=wt_plinth) as bm:
        loop = [bm.verts.new((x, y, -fd)) for x, y in offset_outline(poly, 0.10, closed=True)]
        top = [bm.verts.new((x, y, GL - 0.3)) for x, y in offset_outline(poly, 0.10, closed=True)]
        for i in range(len(loop)):
            j = (i + 1) % len(loop)
            bm.faces.new([loop[i], loop[j], top[j], top[i]])
    plinth_prof = [(0.10, GL - 0.4), (0.10, ph - 0.12), (0.03, ph), (0.0, ph)]
    plinth_runs = [
        [(x0, hw), (x0, -hw), (door_x - door_w * 0.5 - 0.10, -hw)],
        [(door_x + door_w * 0.5 + 0.10, -hw), (xs, -hw), (xa, -ya), (xa, ya), (xs, hw), (x0, hw)],
    ]
    for run in plinth_runs:
        with kit.part("red", uv=("box", RED_UV * 1.2, RED_UV * 1.2, 0.15, 0.48), normals=nave_c, vc=wt_plinth, cut=0.4) as bm:
            sweep_profile(bm, [Vector((x, y, 0.0)) for x, y in run], plinth_prof, up=Z_UP, cap_ends=False)
    with kit.part("red", uv=("box", 2.4, 2.4, 0.44, 0.2), normals=nave_c, vc=wt_red_hi) as bm:
        sweep_profile(bm, [Vector((x, y, 0.0)) for x, y in poly],
                      [(0.0, z_wall_top - 0.32), (0.05, z_wall_top - 0.29), (0.05, z_wall_top - 0.20),
                       (0.15, z_wall_top - 0.09), (0.19, z_wall_top - 0.07), (0.19, z_wall_top), (0.0, z_wall_top)],
                      up=Z_UP, cap_ends=True)

    # --- walls with real openings -----------------------------------------
    win_frame = [(0.19, 0.0), (0.19, 0.035), (0.02, 0.035), (-0.03, -0.02), (-0.03, -0.26)]
    lead_uv = ("box", 0.62, 0.62)

    def nave_window(xf, cx, kind="round", w=win_w, h=win_h, z0=win_z0, key="glass_lead", bars=True):
        o = opening_outline(cx, z0, w, h, kind, segs=14)
        window(xf, o, cx, z0, w, key, lead_uv if key == "glass_lead" else None, depth=0.26, frame=win_frame,
               frame_uv=("box", 2.3, 2.3, 0.21, 0.07), frame_vc=wt_red_hi, inside=nave_c)
        if bars:
            with kit.part("iron", uv=None) as bm:
                k = 1
                while z0 + k * 0.62 < z0 + h - w * 0.5:
                    m = xf @ Matrix.Translation((cx, 0.225, z0 + k * 0.62)) @ Matrix.Diagonal((w - 0.06, 0.02, 0.022, 1.0))
                    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
                    k += 1
                m = xf @ Matrix.Translation((cx, 0.225, z0 + h * 0.5 - 0.05)) @ Matrix.Diagonal((0.022, 0.02, h - 0.12, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        return o

    door_lamp = Vector((door_x + 1.22, -hw, z_door + 1.9))

    def door_lamp_uv2(co):
        return (0.5 + (co.x - door_lamp.x) / 3.6, 0.5 + (co.z - door_lamp.z + 0.35) / 3.6)

    def plaster_panel(xf, outline, holes, uv_off, uv2=None):
        with kit.part("plaster", uv=("box", 2.0, 2.0, uv_off, 0.0), normals=nave_c, vc=wt_plaster,
                      prepare=lambda bm: (grid_cut(bm, 0.45, "xy"), grid_cut(bm, 0.8, "z")), uv2=uv2) as bm:
            add_wall_panel(bm, xf, outline, [list(reversed(o)) for o in holes])

    # south wall: three windows, oval oculus above the door zone, door, gallery door
    xf_sw, half_s = _edge_xf(poly[0], poly[1])
    cxs = (poly[0][0] + poly[1][0]) * 0.5

    def sx_local(x_world):
        return x_world - cxs

    s_holes = [nave_window(xf_sw, sx_local(wx)) for wx in (-6.9, -1.9, 3.1)]
    oculus = opening_outline(sx_local(0.6), 4.38, 1.30, 0.86, "oval", segs=12)
    s_holes.append(oculus)
    with kit.part("red", uv=("box", 2.3, 2.3, 0.6, 0.3), normals=nave_c, vc=wt_red_hi) as bm:
        sweep_profile(bm, outline_path(oculus), win_frame, up=WALL_OUT, closed=True, matrix=xf_sw)
    with kit.part("glass_lead", uv=lead_uv) as bm:
        add_extruded_outline(bm, xf_sw, oculus, 0.24, 0.26, cap_back=False)
    gal_z = GL + 2.40
    gal_x = 7.45
    gal_door = opening_outline(sx_local(gal_x), gal_z, 0.92, 2.0, "rect")
    s_holes.append(gal_door)
    door_o = opening_outline(sx_local(door_x), z_door, door_w, door_h, "pointed", segs=12, rise=0.52)
    door_notch = [(door_o[0][0], ph)] + door_o[1:-1] + [(door_o[-1][0], ph)]
    plaster_panel(xf_sw, _notched_outline(-half_s, half_s, ph, z_wall_top, [door_notch]), s_holes, 0.0, uv2=door_lamp_uv2)
    # south door: sandstone surround, plank double door with strap hinges
    door_frame = [(0.20, 0.0), (0.20, 0.04), (0.03, 0.04), (-0.03, -0.03), (-0.03, -0.24)]
    with kit.part("red", uv=("box", 2.3, 2.3, 0.4, 0.6), normals=nave_c, vc=wt_red_hi) as bm:
        sweep_profile(bm, outline_path(door_o), door_frame, up=WALL_OUT, matrix=xf_sw, cap_ends=False)
    with kit.part("wood_dark", uv=("box", 1.8, 1.8)) as bm:
        add_extruded_outline(bm, xf_sw, offset_outline(door_o, -0.03), 0.20, 0.26, cap_back=False)
    with kit.part("iron", uv=None) as bm:
        dxl = sx_local(door_x)
        m = xf_sw @ Matrix.Translation((dxl, 0.195, z_door + door_h * 0.5 - 0.1)) @ Matrix.Diagonal((0.016, 0.012, door_h - 0.25, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        for zz in (z_door + 0.35, z_door + 1.15, z_door + 1.95):
            for s in (-1.0, 1.0):
                m = xf_sw @ Matrix.Translation((dxl + s * 0.36, 0.19, zz)) @ Matrix.Diagonal((0.52, 0.012, 0.045, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        m = xf_sw @ Matrix.Translation((dxl + 0.09, 0.185, z_door + 1.08)) @ Matrix.Diagonal((0.04, 0.03, 0.16, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    # gallery door (plain boarded, red frame)
    with kit.part("red", uv=("box", 2.3, 2.3, 0.1, 0.2), normals=nave_c, vc=wt_red_hi) as bm:
        sweep_profile(bm, outline_path(gal_door), [(0.14, 0.0), (0.14, 0.03), (0.0, 0.03), (0.0, -0.20)],
                      up=WALL_OUT, matrix=xf_sw, cap_ends=False)
    with kit.part("wood_dark", uv=("box", 1.8, 1.8)) as bm:
        add_extruded_outline(bm, xf_sw, gal_door, 0.17, 0.20, cap_back=False)

    # north wall
    xf_nw, half_n = _edge_xf(poly[4], poly[5])
    cxn = (poly[4][0] + poly[5][0]) * 0.5
    n_holes = [nave_window(xf_nw, -(wx - cxn)) for wx in (-6.9, -1.9, 3.1)]
    plaster_panel(xf_nw, [(-half_n, ph), (half_n, ph), (half_n, z_wall_top), (-half_n, z_wall_top)], n_holes, 0.3)
    # apse faces (window in each)
    for k, (pa, pb) in enumerate(((poly[1], poly[2]), (poly[2], poly[3]), (poly[3], poly[4]))):
        xf_a, half_a = _edge_xf(pa, pb)
        o = nave_window(xf_a, 0.0, w=1.16, h=3.30)
        plaster_panel(xf_a, [(-half_a, ph), (half_a, ph), (half_a, z_wall_top), (-half_a, z_wall_top)], [o], 0.5 + 0.2 * k)
    # west gable wall: window + small oculus in the gable
    xf_w, half_w = _edge_xf(poly[5], poly[0])
    w_win = nave_window(xf_w, 0.0)
    w_oc = _circle(0.0, 9.6, 0.46, 20)
    with kit.part("red", uv=("box", 2.3, 2.3, 0.3, 0.3), normals=nave_c, vc=wt_red_hi) as bm:
        sweep_profile(bm, outline_path(w_oc), win_frame, up=WALL_OUT, closed=True, matrix=xf_w)
    with kit.part("glass_lead", uv=lead_uv) as bm:
        add_extruded_outline(bm, xf_w, w_oc, 0.24, 0.26, cap_back=False)
    plaster_panel(xf_w, [(-hw, ph), (hw, ph), (hw, H - 0.02), (0.0, z_ridge - 0.02), (-hw, H - 0.02)], [w_win, w_oc], 0.8)

    # --- roof: plain tiles, boxed eaves, ridge + hip tiles ------------------
    eave_poly = offset_outline(poly, eave_out, closed=True)
    xv = x0 - 0.28                                # west verge
    R = Vector((xs, 0.0, z_ridge))
    Rw = Vector((xv, 0.0, z_ridge))
    e_sw = Vector((xv, -hw - eave_out, z_ev))
    e_nw = Vector((xv, hw + eave_out, z_ev))
    e_pts = [Vector((eave_poly[i][0], eave_poly[i][1], z_ev)) for i in (1, 2, 3, 4)]
    with kit.part("roof", uv=("slope", 2.6, 2.6), normals=Vector((0.0, 0.0, 6.0)), vc=wt_roof, cut=1.4) as bm:
        def tri_or_quad(pts):
            bm.faces.new([bm.verts.new(p) for p in pts])
        tri_or_quad([e_sw, e_pts[0], R, Rw])
        tri_or_quad([e_pts[3], e_nw, Rw, R])
        for a, b in ((0, 1), (1, 2), (2, 3)):
            tri_or_quad([e_pts[a], e_pts[b], R])
    with kit.part("roof", uv=("box", 2.6, 2.6, 0.3, 0.1), vc=wt_roof) as bm:
        add_ridge_tiles(bm, Rw + Vector((-0.02, 0, 0.03)), R + Vector((0.05, 0, 0.03)), radius=0.15, tile_len=0.38)
        for p in e_pts:
            add_ridge_tiles(bm, p + Vector((0, 0, 0.02)), R + Vector((0, 0, 0.02)), radius=0.12, tile_len=0.38)
    # fascia boards, soffit, verge boards, kneeler blocks at the west eaves
    eave_run = [e_sw] + e_pts + [e_nw]
    with kit.part("wood_dark", uv=("box", 1.8, 1.8), normals=Vector((0.0, 0.0, 6.0))) as bm:
        sweep_profile(bm, [p + Vector((0, 0, -0.005)) for p in eave_run], [(0.0, 0.0), (0.012, -0.02), (0.012, -0.15), (0.0, -0.15)],
                      up=Z_UP, cap_ends=False)
        for sy in (-1.0, 1.0):
            a = Vector((xv, sy * (hw + eave_out), z_ev - 0.02))
            b = Vector((xv, 0.0, z_ridge - 0.02))
            d = (b - a)
            n = Vector((0.0, -d.z, d.y)).normalized()
            if n.z > 0:
                n = -n
            q = [a, b, b + n * 0.20, a + n * 0.20]
            for off in (0.0, 0.035):
                vs = [bm.verts.new(p + Vector((off, 0, 0))) for p in q]
                bm.faces.new(vs)
    with kit.part("plaster", uv=("box", 2.0, 2.0, 0.2, 0.2), normals=None, vc=lambda co, n: (0.62, 0.61, 0.58)) as bm:
        inner_run = [Vector((x0, -hw, z_ev - 0.15)), Vector((xs, -hw, z_ev - 0.15)), Vector((xa, -ya, z_ev - 0.15)),
                     Vector((xa, ya, z_ev - 0.15)), Vector((xs, hw, z_ev - 0.15)), Vector((x0, hw, z_ev - 0.15))]
        outer_run = [p + Vector((0, 0, -0.15)) for p in eave_run]
        outer_run[0].x = x0
        outer_run[-1].x = x0
        for i in range(len(inner_run) - 1):
            bm.faces.new([bm.verts.new(inner_run[i]), bm.verts.new(inner_run[i + 1]),
                          bm.verts.new(outer_run[i + 1]), bm.verts.new(outer_run[i])])
    with kit.part("red", uv=("box", 1.6, 1.6, 0.2, 0.2), vc=wt_red_hi) as bm:
        for sy in (-1.0, 1.0):
            xf_k = _face_xf(xv, 0.0, -math.pi * 0.5)       # local +X = world -Y
            sgn = -sy
            kn = [(sgn * hw, z_wall_top - 0.34), (sgn * (hw + 0.22), z_wall_top - 0.20), (sgn * (hw + eave_out + 0.03), z_ev - 0.17),
                  (sgn * (hw + eave_out + 0.03), z_ev + 0.02), (sgn * hw, H + 0.04)]
            add_extruded_outline(bm, xf_k, kn, 0.0, 0.30)
    # zinc gutters on brackets + downpipes
    gutter = [(0.0, 0.0), (0.012, -0.045), (0.045, -0.078), (0.085, -0.090), (0.125, -0.078), (0.158, -0.045), (0.17, 0.0)]
    with kit.part("zinc", uv=None, normals=None, smooth=50) as bm:
        sweep_profile(bm, [p + Vector((0, 0, -0.03)) for p in eave_run], gutter, up=Z_UP, cap_ends=False)
    with kit.part("zinc", uv=None, smooth=50) as bm:
        for (gx, gy, sy) in ((x0 + 0.45, -hw, -1.0), (x0 + 0.45, hw, 1.0), (xs - 0.35, -hw, -1.0), (xs - 0.35, hw, 1.0)):
            yo = gy + sy * (eave_out + 0.085)
            yw = gy + sy * 0.09
            add_tube(bm, [Vector((gx, yo, z_ev - 0.11)), Vector((gx, yo, z_ev - 0.30)), Vector((gx, yw, z_ev - 0.75)),
                          Vector((gx, yw, ph + 0.1)), Vector((gx, yw + sy * 0.05, ph - 0.05)), Vector((gx, yw + sy * 0.05, GL - 0.3))],
                     0.045, segments=8)
    with kit.part("zinc", uv=None) as bm:
        for (gx, gy, sy) in ((x0 + 0.45, -hw, -1.0), (x0 + 0.45, hw, 1.0), (xs - 0.35, -hw, -1.0), (xs - 0.35, hw, 1.0)):
            for zz in (1.6, 3.4, 5.2):
                add_box(bm, gx, gy + sy * 0.07, zz, 0.13, 0.14, 0.03)
        gx = x0 + 0.3
        while gx < xs:
            for sy in (-1.0, 1.0):
                add_box(bm, gx, sy * (hw + eave_out + 0.07), z_ev - 0.085, 0.025, 0.20, 0.012)
            gx += 0.9

    # --- south door: round steps + hand rails + wall lamp ---------------------
    with kit.part("red", uv=("box", 3.2, 3.2, 0.2, 0.7), vc=wt_red, smooth=35) as bm:
        rise = (z_door - GL) / 3.0
        for i, rad in enumerate((1.12, 1.47, 1.82)):
            top = z_door - i * rise
            add_cylinder(bm, door_x, -hw - 0.02, (top - 0.7) * 0.5, rad, rad, top + 0.7, segments=24)
    with kit.part("iron", uv=None, smooth=60) as bm:
        for s in (-1.0, 1.0):
            add_tube(bm, [Vector((door_x + s * 0.98, -hw - 0.03, z_door + 0.95)), Vector((door_x + s * 1.02, -hw - 0.20, z_door + 0.98)),
                          Vector((door_x + s * 1.55, -hw - 1.65, GL + 0.95)), Vector((door_x + s * 1.60, -hw - 1.80, GL + 0.90)),
                          Vector((door_x + s * 1.60, -hw - 1.80, GL - 0.1))], 0.017, segments=6)
    with kit.part("lamp", uv=None) as bm:
        add_box(bm, door_x + 1.22, -hw - 0.07, z_door + 1.9, 0.16, 0.12, 0.26)

    # --- external gallery stair along the south wall ------------------------
    st_top_x = 7.0
    st_w = 1.30
    st_rise = (gal_z - GL) / 12.0
    st_going = 0.28
    xf_st = _face_xf(st_top_x, -hw - st_w * 0.5, -math.pi * 0.5)   # flight descends toward -X
    with kit.part("red", uv=("box", 3.2, 3.2, 0.5, 0.3), vc=wt_step) as bm:
        add_step_flight(bm, xf_st, width=st_w, steps=11, rise=st_rise, going=st_going,
                        z_top=gal_z - st_rise, z_bottom=-0.8, nosing=0.03)
        add_box(bm, st_top_x + 0.52, -hw - st_w * 0.5, (gal_z - 0.8) * 0.5, 1.04, st_w, gal_z + 0.8)
    st_x_bot = st_top_x - 11 * st_going - 0.30
    par_top = [(st_x_bot, GL + 0.95), (st_top_x, gal_z + 0.95), (st_top_x + 1.29, gal_z + 0.95)]
    with kit.part("plaster", uv=("box", 2.0, 2.0, 0.4, 0.3), vc=wt_plaster, cut=1.4) as bm:
        outline = [(st_x_bot, -0.8), (st_top_x + 1.29, -0.8)] + list(reversed(par_top))
        add_extruded_outline(bm, _face_xf(0.0, -hw - st_w, 0.0), outline, -0.24, 0.0)
        add_box(bm, st_top_x + 1.165, -hw - st_w * 0.5 - 0.12, (gal_z + 0.95 - 0.8) * 0.5, 0.25, st_w + 0.24, gal_z + 0.95 + 0.8)
    with kit.part("red", uv=("box", 2.2, 2.2, 0.2, 0.5), vc=wt_red_hi) as bm:
        yc = -hw - st_w - 0.12
        sweep_profile(bm, [Vector((x, yc, z)) for x, z in reversed(par_top)],
                      [(0.0, -0.17), (0.0, 0.17), (0.09, 0.17), (0.13, 0.0), (0.09, -0.17)],
                      up=Vector((0.0, -1.0, 0.0)), profile_closed=True)
    with kit.part("iron", uv=None, smooth=60) as bm:
        yc = -hw - st_w - 0.12
        rail = [Vector((x, yc, z + 0.13 + 0.50)) for x, z in par_top]
        add_tube(bm, [rail[0] + Vector((0, 0, -0.5))] + rail + [rail[-1] + Vector((0, 0, -0.5))], 0.016, segments=6)
        n_posts = 4
        for i in range(1, n_posts):
            t = i / n_posts
            p = rail[0].lerp(rail[1], t)
            add_tube(bm, [p, p + Vector((0, 0, -0.5))], 0.012, segments=5)

    # ==================================================================
    # 3. CHURCHYARD: terrace, retaining wall, steps, forecourt
    # ==================================================================
    wall_y = -16.9                              # centre line of the street-side retaining wall (west part)
    bast_y = -18.9                              # ... and of the projecting east terrace (war memorial)
    yard_x0, yard_x1 = -11.6, 9.6
    stair_x0, stair_x1 = -1.7, 0.3
    stair_top_y = -16.2
    cope_z = GL + 0.12

    def lawn_z(x, y):
        return max(GL, T(x, y) + 0.10)

    APRON_STREET_Y = -20.9

    def apron_z(x, y):
        # 0.13 m above the terrain probe; the outer rim (street side, west and east ends) dives 0.12 m below
        # it so the cobbles run out flush into the road / sidewalk instead of ending in a riser.
        edge = min(x - yard_x0, (yard_x1 + 0.25) - x, y - APRON_STREET_Y)
        t = min(max(edge / 0.7, 0.0), 1.0)
        return T(x, y) - 0.12 + 0.25 * t

    def yard_uv2(co):
        return (0.5 + (co.x - yard_lamp[0]) / 9.0, 0.5 + (co.y - yard_lamp[1]) / 9.0)

    wt_grass = weather_tint(ground_z=None, noise_scale=0.55, noise_amp=0.20, hue_amp=0.07, level=0.86, seed=21.0)
    wt_cobble = weather_tint(ground_z=None, noise_scale=0.5, noise_amp=0.14, hue_amp=0.03, level=0.88, seed=5.0)
    with kit.part("grass", uv=("box", 2.0, 2.0), normals=None, vc=wt_grass, uv2=yard_uv2) as bm:
        # main terrace + two strips left and right of the stairwell that is cut into it
        add_ground_patch(bm, yard_x0, stair_top_y, yard_x1, -2.7, lawn_z, step=1.0, skirt_to=-1.6)
        add_ground_patch(bm, yard_x0, wall_y + 0.15, stair_x0, stair_top_y, lawn_z, step=1.0)
        add_ground_patch(bm, stair_x1, bast_y + 0.15, yard_x1, stair_top_y, lawn_z, step=1.0)
    with kit.part("cobble", uv=("box", 2.0, 2.0), normals=None, vc=wt_cobble) as bm:
        add_ground_patch(bm, yard_x0, APRON_STREET_Y, stair_x1 - 0.15, wall_y - 0.15, apron_z, step=0.7, skirt_to=-2.6)
        add_ground_patch(bm, stair_x1 - 0.15, APRON_STREET_Y, yard_x1 + 0.25, bast_y - 0.15, apron_z, step=0.7, skirt_to=-2.6)

    # paved paths on the terrace
    with kit.part("paving", uv=("box", 2.0, 2.0), uv2=yard_uv2, prepare=lambda bm: grid_cut(bm, 1.0, "xy")) as bm:
        zt = GL + 0.03
        for quad in (
            [(stair_x0 + 0.2, stair_top_y - 0.03), (stair_x1 - 0.2, stair_top_y - 0.03), (door_x + 0.85, -hw - 1.75), (door_x - 0.85, -hw - 1.75)],
            [(tx - 1.9, wall_y + 0.5), (stair_x0 - 0.2, wall_y + 0.5), (stair_x0 - 0.2, stair_top_y + 0.9), (stair_x0 + 0.2, stair_top_y + 0.9),
             (stair_x0 + 0.2, ty - h1 - 1.6), (tx - 1.9, ty - h1 - 1.6)],
        ):
            lo = [bm.verts.new((x, y, zt - 0.3)) for x, y in quad]
            hi = [bm.verts.new((x, y, zt)) for x, y in quad]
            bm.faces.new(hi)
            for i in range(len(quad)):
                j = (i + 1) % len(quad)
                bm.faces.new([lo[i], lo[j], hi[j], hi[i]])

    # retaining walls (red sandstone blocks + projecting coping)
    WALL_TONE = (0.66, 0.55, 0.57)               # the terrace wall is a browner, greyer stone than the tower
                                                 # (sv_kirche_front_detail.png: #695949, hue 30)
    wall_w = dict(ground_z=-1.0, splash_h=0.75, splash_dark=0.60, splash_color=MOSS, noise_scale=0.8, noise_amp=0.16,
                  hue_amp=0.05, seed=9.0, streak_amp=0.7, streak_scale=1.6, drip_lines=[(GL + 0.03, 0.75, 0.38)])
    wt_wall = weather_tint(level=0.86, tone=WALL_TONE, **wall_w)
    wt_mortar_w = weather_tint(level=0.80, **wall_w)
    # (start, end, extend_start, extend_end): the visible face is on the right-hand side of start -> end
    wall_segments = [
        ((yard_x0, -hw - 0.2), (yard_x0, wall_y), 0.0, 0.2),
        ((yard_x0, wall_y), (stair_x0, wall_y), 0.2, 0.2),
        ((stair_x0, wall_y), (stair_x0, stair_top_y + 0.2), 0.2, 0.0),
        ((stair_x1, stair_top_y + 0.2), (stair_x1, bast_y), 0.0, 0.2),
        ((stair_x1, bast_y), (yard_x1, bast_y), 0.2, 0.2),
        ((yard_x1, bast_y), (yard_x1, -2.9), 0.2, 0.0),
    ]
    WALL_UV = 3.0                                # big blocks: 0.6 m courses as scanned
    wall_off_v = -(GL + 0.03) / WALL_UV          # a bed joint exactly under the coping
    for wi, (a, b, ea, eb) in enumerate(wall_segments):
        xf_wl, half_l = _edge_xf(a, b)
        add_ashlar_wall(kit, "red", "mortar", xf_wl,
                        [(-half_l - ea, -fd), (half_l + eb, -fd), (half_l + eb, GL + 0.03), (-half_l - ea, GL + 0.03)],
                        tile=WALL_UV, off_u=0.23 * wi, off_v=wall_off_v, base=wt_wall, amp=0.30, hue=0.08, seed=40 + wi,
                        joint=0.011, repair=0.04, violet=0.10, y=-0.20, normals=None, mortar_vc=wt_mortar_w)
    wt_cope = weather_tint(ground_z=None, noise_scale=1.5, noise_amp=0.18, hue_amp=0.05, level=0.82, seed=13.0,
                           ledge_dark=0.75, ledge_color=(0.50, 0.56, 0.38), tone=WALL_TONE)
    with kit.part("red", uv=("box", 2.6, 2.6, 0.55, 0.05), vc=wt_cope, cut=0.6) as bm:
        for a, b, ea, eb in wall_segments:
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            ux, uy = dx / ln, dy / ln
            ca = (a[0] - ux * (ea + 0.06 if ea else 0.0), a[1] - uy * (ea + 0.06 if ea else 0.0))
            cb = (b[0] + ux * (eb + 0.06 if eb else 0.0), b[1] + uy * (eb + 0.06 if eb else 0.0))
            add_box(bm, (ca[0] + cb[0]) * 0.5, (ca[1] + cb[1]) * 0.5, (GL + 0.02 + cope_z) * 0.5,
                    math.hypot(cb[0] - ca[0], cb[1] - ca[1]), 0.52, cope_z - GL - 0.02, rot_z=math.atan2(dy, dx))

    # steps through the wall + wrought-iron railings
    stair_cx = (stair_x0 + stair_x1) * 0.5
    y_rise = 0.19
    with kit.part("red", uv=("box", 3.2, 3.2, 0.8, 0.1), vc=wt_step) as bm:
        add_step_flight(bm, _face_xf(stair_cx, stair_top_y, 0.0), width=stair_x1 - stair_x0 - 0.4, steps=3,
                        rise=y_rise, going=0.33, z_top=GL - y_rise, z_bottom=-2.0, nosing=0.02)
    with kit.part("iron", uv=None, smooth=60) as bm:
        for rx in (stair_x0 + 0.12, stair_x1 - 0.12):
            y_bot = stair_top_y - 3 * 0.33 - 0.05
            z_bot = apron_z(rx, y_bot)
            top = Vector((rx, stair_top_y + 0.55, GL + 0.95))
            knee = Vector((rx, stair_top_y - 0.05, GL + 0.95))
            foot = Vector((rx, y_bot, z_bot + 0.92))
            add_tube(bm, [Vector((rx, stair_top_y + 0.55, GL + 0.05)), top, knee, foot, Vector((rx, y_bot, z_bot - 0.1))], 0.019, segments=6)
            for i in range(1, 6):
                t = i / 6.0
                p = knee.lerp(foot, t)
                zb = (GL + 0.1) * (1 - t) + (z_bot + 0.05) * t
                add_tube(bm, [p, Vector((p.x, p.y, zb))], 0.008, segments=4, cap=False)
            lower = [Vector((rx, stair_top_y + 0.55, GL + 0.22)), Vector((rx, stair_top_y - 0.05, GL + 0.22)),
                     Vector((rx, y_bot, z_bot + 0.2))]
            add_tube(bm, lower, 0.010, segments=4, cap=False)

    # stone flower troughs (rough sandstone) with planting
    def trough(cx, cy, z, rot=0.0, length=1.15, cell="geranium_red", seed=0):
        xf = Matrix.Translation((cx, cy, z)) @ Matrix.Rotation(rot, 4, 'Z')
        stone = weather_tint(ground_z=z, splash_h=0.3, splash_dark=0.4, splash_color=MOSS, noise_scale=4.0, noise_amp=0.25,
                             hue_amp=0.05, level=0.72, seed=seed, ledge_dark=0.5, ledge_color=MOSS, tone=(0.60, 0.46, 0.50))
        with kit.part("red", uv=("box", 1.5, 1.5, 0.13 * seed, 0.2), vc=stone, cut=0.2) as bm:
            m = xf @ Matrix.Translation((0, 0, 0.21)) @ Matrix.Diagonal((length, 0.44, 0.34, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            for sxx in (-1.0, 1.0):
                m = xf @ Matrix.Translation((sxx * (length * 0.5 - 0.14), 0, 0.02)) @ Matrix.Diagonal((0.12, 0.34, 0.05, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        rng = random.Random(100 + seed)
        z_soil = 0.37
        # dark soil just under the rim (only visible between the cards from above)
        with kit.part("paint", uv=None, vc=lambda co, n: (0.035, 0.026, 0.018)) as bm:
            m = xf @ Matrix.Translation((0, 0, z_soil - 0.01)) @ Matrix.Diagonal((length - 0.10, 0.34, 0.02, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        add_planting_cards(kit, "planting", xf, length, z_soil, cell, rng)

    trough(-9.4, wall_y, cope_z, cell="marigold_yellow", seed=1)
    trough(-5.7, wall_y, cope_z, cell="geranium_red", seed=2)
    trough(-3.3, wall_y, cope_z, cell="marigold_yellow", seed=3)
    trough(stair_x1, -18.0, cope_z, rot=math.pi * 0.5, cell="petunia_violet", seed=4)
    trough(5.6, bast_y, cope_z, cell="marigold_yellow", seed=5)
    trough(tx + 0.95, ty - h1 - 0.52, z_thr, length=0.95, cell="geranium_red", seed=6)

    # parish notice board on posts in front of the wall
    nb_x, nb_y = -2.75, wall_y - 0.42
    nb_z = apron_z(nb_x, nb_y)
    with kit.part("alu", uv=None) as bm:
        for dx in (-0.52, 0.52):
            add_box(bm, nb_x + dx, nb_y, nb_z + 0.95, 0.05, 0.05, 2.1)
        add_box(bm, nb_x, nb_y, nb_z + 1.50, 1.12, 0.09, 0.94)
    with kit.part("atlas", uv=("rect",) + tuple(rects["notice_board"]), normals=None) as bm:
        z_a, z_b = nb_z + 1.50 - 0.42, nb_z + 1.50 + 0.42
        bm.faces.new([bm.verts.new((nb_x - 0.51, nb_y - 0.048, z_a)), bm.verts.new((nb_x + 0.51, nb_y - 0.048, z_a)),
                      bm.verts.new((nb_x + 0.51, nb_y - 0.048, z_b)), bm.verts.new((nb_x - 0.51, nb_y - 0.048, z_b))])
    # flagpole + churchyard lamp
    with kit.part("alu", uv=None, smooth=60) as bm:
        add_lathe(bm, [(0.055, GL - 0.2), (0.050, GL + 1.0), (0.032, GL + 9.0), (0.045, GL + 9.02), (0.045, GL + 9.08), (0.0, GL + 9.12)],
                  10, Matrix.Translation((-2.35, wall_y + 0.75, 0.0)))
        lx, ly = yard_lamp
        add_lathe(bm, [(0.06, GL - 0.2), (0.055, GL + 0.9), (0.038, GL + 1.0), (0.034, GL + 4.1), (0.05, GL + 4.12)],
                  10, Matrix.Translation((lx, ly, 0.0)))
    with kit.part("iron", uv=None, smooth=60) as bm:
        add_lathe(bm, [(0.05, GL + 4.12), (0.20, GL + 4.20), (0.21, GL + 4.24), (0.05, GL + 4.56), (0.0, GL + 4.58)],
                  12, Matrix.Translation((lx, ly, 0.0)))
    with kit.part("lamp", uv=None, smooth=60) as bm:
        add_lathe(bm, [(0.0, GL + 4.02), (0.12, GL + 4.06), (0.17, GL + 4.19), (0.0, GL + 4.19)], 12, Matrix.Translation((lx, ly, 0.0)))

    # ==================================================================
    # 4. KRIEGERDENKMAL (1930): stepped pedestal, wreath, inscription, lion
    # ==================================================================
    mx, my = 4.7, -15.9
    xf_m = Matrix.Translation((mx, my, GL)) @ Matrix.Rotation(-math.pi * 0.5, 4, 'Z')   # front faces west

    tier_tops = (0.20, 0.86, 1.88, 2.30, 2.37)
    lichen = weather_tint(ground_z=GL, splash_h=0.7, splash_dark=0.50, splash_color=MOSS, noise_scale=2.6, noise_amp=0.30,
                          hue_amp=0.06, level=0.86, seed=4.0, streak_amp=0.8, streak_scale=3.0,
                          drip_lines=[(GL + zt_ + 0.001, 0.55, 0.40) for zt_ in tier_tops],
                          ledge_dark=0.85, ledge_color=(0.42, 0.52, 0.22))

    tiers = [(1.75, 2.25, -0.25, 0.20), (1.50, 2.00, 0.20, 0.86), (1.28, 1.76, 0.86, 1.88), (1.14, 1.56, 1.88, 2.30), (0.66, 1.26, 2.30, 2.37)]
    with kit.part("monument", uv=("box", 1.2, 1.2, 0.2, 0.3), vc=lichen, cut=0.22) as bm:
        for wx, dy, z_a, z_b in tiers:
            m = xf_m @ Matrix.Translation((0, 0, (z_a + z_b) * 0.5)) @ Matrix.Diagonal((wx, dy, z_b - z_a, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        m = xf_m @ Matrix.Translation((0, 0, 0.89)) @ Matrix.Diagonal((1.36, 1.86, 0.06, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    # wreath + helmet relief on the crown block front
    with kit.part("monument", uv=("box", 1.2, 1.2), vc=lichen, smooth=70) as bm:
        fy = -0.78
        for i in range(14):
            a = 2 * math.pi * i / 14
            m = xf_m @ Matrix.Translation((0.19 * math.cos(a), fy, 2.09 + 0.145 * math.sin(a))) @ Matrix.Rotation(-a, 4, 'Y') \
                @ Matrix.Diagonal((0.032, 0.028, 0.068, 1.0))
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=m)
        m = xf_m @ Matrix.Translation((0.0, fy, 2.10)) @ Matrix.Diagonal((0.115, 0.045, 0.075, 1.0))
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0, matrix=m)
        m = xf_m @ Matrix.Translation((0.0, fy, 2.06)) @ Matrix.Diagonal((0.15, 0.04, 0.018, 1.0))
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=m)
    with kit.part("paint", uv=None, normals=xf_m @ Vector((0.0, 0.0, 1.4)), vc=lambda co, n: (0.22, 0.19, 0.14)) as bm:
        lines = [("IHREN TAPFEREN SÖHNEN", 1.68, 0.058), ("IN DANKBARKEIT", 1.55, 0.058), ("DIE GEMEINDE KINDENHEIM", 1.42, 0.052),
                 ("WELTKRIEG 1914 – 1918", 1.14, 0.062)]
        for txt, zz, size in lines:
            add_text(bm, txt, xf_m @ Matrix.Translation((0.0, -0.881, zz)), size=size, depth=0.003,
                     font_path=FONT_SERIF_BOLD, resolution=1, flat=True)
    # the lion: sits upright on straight forelegs, hindquarters low, head raised roaring toward the tower
    lz = 2.37
    lion = [
        ((0.17, -0.47, 0.055), (0.085, 0.14, 0.055), None), ((-0.17, -0.47, 0.055), (0.085, 0.14, 0.055), None),
        ((0.165, -0.40, 0.36), (0.078, 0.088, 0.34), (math.radians(-5), 0, 0)),
        ((-0.165, -0.40, 0.36), (0.078, 0.088, 0.34), (math.radians(-5), 0, 0)),
        ((0.0, -0.33, 0.66), (0.235, 0.225, 0.27), (math.radians(-18), 0, 0)),          # chest
        ((0.0, -0.27, 0.88), (0.285, 0.26, 0.26), (math.radians(-20), 0, 0)),           # mane
        ((0.0, -0.19, 1.03), (0.245, 0.215, 0.19), None),                                # mane top / nape
        ((0.17, -0.30, 0.98), (0.13, 0.15, 0.20), None), ((-0.17, -0.30, 0.98), (0.13, 0.15, 0.20), None),   # mane cheeks
        ((0.0, -0.42, 1.11), (0.150, 0.185, 0.150), (math.radians(28), 0, 0)),          # skull
        ((0.0, -0.60, 1.21), (0.090, 0.150, 0.070), (math.radians(30), 0, 0)),          # upper jaw / muzzle
        ((0.0, -0.56, 1.04), (0.072, 0.115, 0.042), (math.radians(4), 0, 0)),           # dropped lower jaw (roar)
        ((0.11, -0.33, 1.235), (0.045, 0.035, 0.05), None), ((-0.11, -0.33, 1.235), (0.045, 0.035, 0.05), None),
        ((0.0, -0.03, 0.66), (0.215, 0.27, 0.23), (math.radians(-32), 0, 0)),           # back
        ((0.0, 0.22, 0.47), (0.235, 0.27, 0.215), (math.radians(-34), 0, 0)),
        ((0.0, 0.43, 0.30), (0.255, 0.24, 0.24), None),                                  # rump
        ((0.235, 0.30, 0.22), (0.12, 0.25, 0.20), (math.radians(-12), 0, 0)),           # thighs
        ((-0.235, 0.30, 0.22), (0.12, 0.25, 0.20), (math.radians(-12), 0, 0)),
        ((0.27, 0.02, 0.055), (0.075, 0.17, 0.055), None), ((-0.27, 0.02, 0.055), (0.075, 0.17, 0.055), None),
        ((0.20, 0.62, 0.07), (0.05, 0.14, 0.05), (0, 0, math.radians(35))),             # tail along the plinth
        ((0.31, 0.50, 0.06), (0.045, 0.12, 0.045), (0, 0, math.radians(-25))),
    ]
    with kit.part("monument", uv=("box", 1.2, 1.2, 0.6, 0.1), vc=lichen, smooth=70, normals=None) as bm:
        add_sculpted_blobs(bm, lion, xf_m @ Matrix.Translation((0.0, 0.04, lz)) @ Matrix.Scale(0.86, 4),
                           voxel=0.028, smooth_iterations=5, target_tris=3400)
        # rough-hewn, weather-worn surface instead of a polished blob
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * (0.012 * noise.noise(v.co * 9.0) + 0.006 * noise.noise(v.co * 23.0))

    # ==================================================================
    # Finalize + export
    # ==================================================================
    # collision solids (local frame): nave + apse, tower with its steps, the raised terrace behind the
    # retaining walls (covers memorial, lamp, flagpole, troughs, gallery stair), the steps block, notice board
    COLLIDER_SOLIDS.clear()
    COLLIDER_SOLIDS.extend([
        offset_outline(poly, 0.12, closed=True),
        [(tx - h1 - 0.25, ty - h1 - 1.75), (tx + h1 + 0.25, ty - h1 - 1.75), (tx + h1 + 0.25, ty + h1 + 0.25), (tx - h1 - 0.25, ty + h1 + 0.25)],
        [(yard_x0 - 0.3, wall_y - 0.3), (yard_x1 + 0.3, wall_y - 0.3), (yard_x1 + 0.3, -hw), (yard_x0 - 0.3, -hw)],
        [(stair_x1 - 0.3, bast_y - 0.3), (yard_x1 + 0.3, bast_y - 0.3), (yard_x1 + 0.3, wall_y), (stair_x1 - 0.3, wall_y)],
        [(stair_x0, stair_top_y - 1.15), (stair_x1, stair_top_y - 1.15), (stair_x1, wall_y), (stair_x0, wall_y)],
        [(nb_x - 0.62, nb_y - 0.12), (nb_x + 0.62, nb_y - 0.12), (nb_x + 0.62, nb_y + 0.12), (nb_x - 0.62, nb_y + 0.12)],
    ])

    counts = dict(kit.tri_counts)
    objects = kit.finalize("Kirche", col)
    print("Kirche triangle counts per material:", {k: v for k, v in counts.items() if v}, "total", sum(counts.values()))

    if do_export:
        save_blend_and_export_glb_draco(
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
