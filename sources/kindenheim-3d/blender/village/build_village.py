#!/usr/bin/env python3
"""
Footprint-Accurate Palatinate (Pfalz) Village Architecture Builder for Kindenheim (Rheinland-Pfalz).

Generates realistic, pitched-roof, PBR-textured 3D Blender architecture for EVERY real OSM
building polygon in Kindenheim (excluding hero landmarks built by @blender-landmarks):
- Exact real-world footprint geometry at world (x, baseElevationM, z) coordinates
  (Blender (x, -z, y) -> glTF Y-up (x, y, z) exact contract!)
- 2.0m underground + 0.55m above-ground Pfälzer Sandstein plinth/foundation skirt (zero floating!)
- Proper pitched gabled (Satteldach), hipped (Walmdach), and multi-wing L/T/U courtyard roofs
  aligned to each building's longest axis / OBB — with roof overhangs, soffit thickness,
  watertight gable end walls, ridge caps, brick/sandstone chimneys, roof dormers,
  recessed front doors & barn gates!
- Clean metric UV mapping (integer window bays & stories, slope-aligned roof tiles)
- Deterministic varied Pfalz stucco & clay/slate roof materials (customizable via palette_override.json
  once real Street View references from @streetview-ref are calibrated!)
- Batched spatially grouped .glb chunks (village_center, village_north, village_south, village_outskirts)
- Clean master .blend archive (blender/village/kindenheim_village.blend) + 4 modular building
  archetype .blend files in blender/village/archetypes/
- Writes public/assets/models/village/manifest.json combining chunks + props metadata!

Usage:
  Demo mode (tests 12 varied Pfalz buildings on sloped terrain + renders sunlit preview):
    /opt/homebrew/bin/blender --background --python blender/village/build_village.py -- --demo --render <png>

  Production mode (reads data/osm/kindenheim_scene.json + excludes landmark IDs):
    /opt/homebrew/bin/blender --background --python blender/village/build_village.py -- \
      --scene data/osm/kindenheim_scene.json \
      --landmarks-manifest public/assets/models/landmarks/manifest.json \
      --render-aerial <png1> --render-street <png2>
"""

import argparse
import glob
import hashlib
import json
import math
import os
import sys
from typing import List, Tuple, Dict, Optional

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler
from mathutils.geometry import tessellate_polygon

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
TEX_DIR = os.path.join(PROJECT_ROOT, "blender/village/textures")
BLEND_ARCHIVE = os.path.join(PROJECT_ROOT, "blender/village/kindenheim_village.blend")
ARCHETYPE_DIR = os.path.join(PROJECT_ROOT, "blender/village/archetypes")
OUT_GLB_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/village")
PROPS_META = os.path.join(PROJECT_ROOT, "blender/village/props/props_meta.json")
MANIFEST_OUT = os.path.join(OUT_GLB_DIR, "manifest.json")

os.makedirs(ARCHETYPE_DIR, exist_ok=True)
os.makedirs(OUT_GLB_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Deterministic Hashing & Material Palette
# ---------------------------------------------------------------------------

def stable_hash_int(key: str) -> int:
    return int(hashlib.md5(str(key).encode("utf-8")).hexdigest()[:8], 16)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_image(path: str, colorspace: str = "sRGB"):
    img = bpy.data.images.load(path, check_existing=True)
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    img.pack()
    return img


def make_arch_material(
    name: str,
    albedo_file: Optional[str] = None,
    normal_file: Optional[str] = None,
    rough_file: Optional[str] = None,
    base_color=(0.75, 0.72, 0.68, 1.0),
    roughness: float = 0.85,
    metallic: float = 0.0,
    normal_strength: float = 1.0,
    alpha_clip: bool = False,
    double_sided: bool = False,
):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic

    if albedo_file:
        fp = os.path.join(TEX_DIR, albedo_file)
        if os.path.exists(fp):
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = load_image(fp, "sRGB")
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if alpha_clip:
                math_n = nodes.new("ShaderNodeMath")
                math_n.operation = "ROUND"
                links.new(tex.outputs["Alpha"], math_n.inputs[0])
                links.new(math_n.outputs["Value"], bsdf.inputs["Alpha"])
                mat.alpha_threshold = 0.45

    if rough_file:
        fp = os.path.join(TEX_DIR, rough_file)
        if os.path.exists(fp):
            rtex = nodes.new("ShaderNodeTexImage")
            rtex.image = load_image(fp, "Non-Color")
            links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])

    if normal_file:
        fp = os.path.join(TEX_DIR, normal_file)
        if os.path.exists(fp):
            ntex = nodes.new("ShaderNodeTexImage")
            ntex.image = load_image(fp, "Non-Color")
            nmap = nodes.new("ShaderNodeNormalMap")
            nmap.inputs["Strength"].default_value = normal_strength
            links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    mat.use_backface_culling = not double_sided
    return mat


def create_material_library() -> Dict[str, bpy.types.Material]:
    mats = {}
    # 6 global real-world calibrated Kindenheim Pfalz residential stucco facades
    shuttered = {"ochre", "warmwhite", "sage"}
    for col in ("ochre", "cream", "warmwhite", "terracotta", "sage", "sandstone"):
        v = "facade" if col in shuttered else "facade_clean"
        mats[f"wall_{col}"] = make_arch_material(
            f"Pfalz_Wall_{col}",
            albedo_file=f"wall_{col}_albedo.jpg",
            normal_file=f"{v}_normal.png",
            rough_file=f"{v}_rough.png",
            normal_strength=1.05,
        )

    # Photographed corridor-exact facade materials (reuse clean facade normal/rough!)
    for col in (
        "ochre_rolladen",
        "ochre_arched",
        "butter_yellow",
        "weathered_cream_dark",
        "bauhaus_white",
        "white_clean",
        "blush_clean",
        "siding_lower",
        # Wave 2: Triftstraße, Am Kirchrain & adjacent street facades
        "mustard_yellow",
        "coral_terracotta",
        "cool_gray",
        "cool_gray_light",
        "sandstone_buff",
        "modern_raffstore",
    ):
        mats[f"wall_{col}"] = make_arch_material(
            f"Pfalz_Wall_{col}",
            albedo_file=f"wall_{col}_albedo.jpg",
            normal_file="facade_clean_normal.png" if col not in ("bauhaus_white", "modern_raffstore") else None,
            rough_file="facade_clean_rough.png" if col not in ("bauhaus_white", "modern_raffstore") else None,
            roughness=0.84,
            normal_strength=0.95,
        )

    # Specialized corridor cladding & masonry materials
    mats["wall_timber_vertical"] = make_arch_material(
        "Pfalz_Wall_TimberVertical",
        albedo_file="wall_timber_vertical_albedo.jpg",
        roughness=0.82,
    )
    mats["wall_brick_barn_yellow"] = make_arch_material(
        "Pfalz_Wall_BrickBarnYellow",
        albedo_file="wall_brick_barn_yellow_albedo.jpg",
        normal_file="sandstone_plinth_normal.png",
        roughness=0.88,
        normal_strength=0.85,
    )
    mats["wall_fachwerk_yellow"] = make_arch_material(
        "Pfalz_Wall_FachwerkYellow",
        albedo_file="wall_fachwerk_yellow_albedo.jpg",
        normal_file="wall_barn_normal.png",
        rough_file="wall_barn_rough.png",
        normal_strength=1.0,
    )
    mats["wall_fachwerk_white"] = make_arch_material(
        "Pfalz_Wall_FachwerkWhite",
        albedo_file="wall_fachwerk_white_albedo.jpg",
        normal_file="wall_barn_normal.png",
        rough_file="wall_barn_rough.png",
        normal_strength=1.0,
    )
    mats["wall_limestone_brick"] = make_arch_material(
        "Pfalz_Wall_LimestoneBrick",
        albedo_file="wall_limestone_brick_albedo.jpg",
        normal_file="sandstone_plinth_normal.png",
        roughness=0.90,
        normal_strength=1.10,
    )
    mats["wall_rubble_barn"] = make_arch_material(
        "Pfalz_Wall_RubbleBarn",
        albedo_file="wall_rubble_barn_albedo.jpg",
        normal_file="sandstone_plinth_normal.png",
        roughness=0.92,
        normal_strength=1.15,
    )
    mats["wall_mustard_porthole"] = make_arch_material(
        "Pfalz_Wall_MustardPorthole",
        albedo_file="wall_mustard_porthole_albedo.jpg",
        roughness=0.82,
    )
    mats["wall_peach_plain"] = make_arch_material(
        "Pfalz_Wall_PeachPlain",
        albedo_file="wall_peach_plain_albedo.jpg",
        roughness=0.88,
    )

    # 4 classic Pfalz roof tile materials (terracotta, darkred, darkbrown, slate)
    for rcol in ("terracotta", "darkred", "darkbrown", "slate"):
        mats[f"roof_{rcol}"] = make_arch_material(
            f"Pfalz_Roof_{rcol}",
            albedo_file=f"roof_{rcol}_albedo.jpg",
            normal_file="roof_tiles_normal.png",
            rough_file="roof_tiles_rough.png",
            normal_strength=1.25,
        )

    # 4 authentic Kindenheim plinth materials (dressed sandstone, checkered ceramic tiles, limestone rubble, smooth red)
    mats["plinth"] = make_arch_material(
        "Pfalz_Sandstone_Plinth",
        albedo_file="sandstone_plinth_albedo.jpg",
        normal_file="sandstone_plinth_normal.png",
        rough_file="sandstone_plinth_rough.png",
        normal_strength=1.15,
    )
    mats["plinth_checkered"] = make_arch_material(
        "Pfalz_Plinth_Checkered",
        albedo_file="plinth_checkered_albedo.jpg",
        roughness=0.46,
    )
    mats["plinth_rubble"] = make_arch_material(
        "Pfalz_Plinth_Rubble",
        albedo_file="plinth_rubble_albedo.jpg",
        normal_file="sandstone_plinth_normal.png",
        roughness=0.90,
        normal_strength=1.20,
    )
    mats["plinth_red_smooth"] = make_arch_material(
        "Pfalz_Plinth_RedSmooth",
        albedo_file="plinth_red_smooth_albedo.jpg",
        roughness=0.86,
    )
    mats["plinth_slate_gray"] = make_arch_material(
        "Pfalz_Plinth_SlateGray",
        albedo_file="plinth_slate_gray_albedo.jpg",
        roughness=0.86,
    )
    mats["plinth_concrete"] = make_arch_material(
        "Pfalz_Plinth_Concrete",
        albedo_file="plinth_concrete_albedo.jpg",
        roughness=0.88,
    )
    mats["wall_block_light"] = make_arch_material(
        "Pfalz_Wall_BlockLight",
        albedo_file="wall_block_light_albedo.jpg",
        normal_file="sandstone_plinth_normal.png",
        roughness=0.88,
        normal_strength=0.85,
    )
    mats["wall_block_dark"] = make_arch_material(
        "Pfalz_Wall_BlockDark",
        albedo_file="wall_block_dark_albedo.jpg",
        normal_file="sandstone_plinth_normal.png",
        roughness=0.90,
        normal_strength=0.95,
    )
    mats["wall_palisade_brown"] = make_arch_material(
        "Pfalz_Wall_PalisadeBrown",
        albedo_file="wall_palisade_brown_albedo.jpg",
        roughness=0.88,
    )

    # Traditional half-timbered Scheune barn wall & double oak gate
    mats["wall_barn"] = make_arch_material(
        "Pfalz_Wall_Barn",
        albedo_file="wall_barn_albedo.jpg",
        normal_file="wall_barn_normal.png",
        rough_file="wall_barn_rough.png",
        normal_strength=1.05,
    )
    mats["barn_gate"] = make_arch_material(
        "Pfalz_Barn_Gate",
        albedo_file="barn_gate_albedo.jpg",
        normal_file="barn_gate_normal.png",
        roughness=0.80,
        normal_strength=1.0,
    )
    mats["door_wood"] = make_arch_material(
        "Pfalz_Front_Door",
        albedo_file="door_wood_albedo.jpg",
        roughness=0.68,
    )

    # Utility plaster & corrugated agricultural metal / flat roofs
    mats["wall_utility"] = make_arch_material(
        "Pfalz_Wall_Utility",
        albedo_file="wall_utility_albedo.jpg",
        roughness=0.88,
    )
    mats["roof_metal"] = make_arch_material(
        "Pfalz_Roof_Metal",
        albedo_file="roof_metal_albedo.jpg",
        normal_file="roof_metal_normal.png",
        roughness=0.52,
        metallic=0.35,
        normal_strength=1.0,
    )
    mats["roof_flat"] = make_arch_material(
        "Pfalz_Roof_Flat_Gravel",
        base_color=(0.44, 0.45, 0.46, 1.0),
        roughness=0.88,
    )

    # Dark timber roof soffit/fascia & galvanized zinc gutters
    mats["trim_wood"] = make_arch_material(
        "Pfalz_Roof_Trim_Wood",
        base_color=(0.20, 0.14, 0.10, 1.0),
        roughness=0.82,
    )
    mats["gutter_metal"] = make_arch_material(
        "Pfalz_Gutter_Zinc",
        base_color=(0.56, 0.58, 0.60, 1.0),
        roughness=0.40,
        metallic=0.62,
    )

    # Specialized photorealistic corridor details: Solar PV, Climbing Ivy, Gates, Hedges/Cypress
    mats["solar_pv"] = make_arch_material(
        "Pfalz_Solar_PV",
        albedo_file="solar_pv_albedo.jpg",
        normal_file="solar_pv_normal.png",
        roughness=0.18,
        metallic=0.34,
        normal_strength=0.9,
    )
    mats["ivy_foliage"] = make_arch_material(
        "Pfalz_Ivy_Foliage",
        albedo_file="ivy_foliage_albedo.jpg",
        normal_file="ivy_foliage_normal.png",
        roughness=0.68,
        normal_strength=1.25,
    )
    mats["hedge_olive"] = make_arch_material(
        "Pfalz_Hedge_Olive",
        albedo_file="hedge_olive_albedo.jpg",
        normal_file="ivy_foliage_normal.png",
        roughness=0.78,
        normal_strength=1.20,
    )
    mats["cypress_foliage"] = make_arch_material(
        "Pfalz_Cypress_Foliage",
        albedo_file="hedge_olive_albedo.jpg",
        normal_file="ivy_foliage_normal.png",
        roughness=0.80,
        normal_strength=1.30,
    )
    mats["gate_wrought_iron"] = make_arch_material(
        "Pfalz_Gate_WroughtIron",
        albedo_file="gate_wrought_iron.png",
        roughness=0.42,
        metallic=0.55,
        alpha_clip=True,
        double_sided=True,
    )
    mats["gate_iron_dark"] = make_arch_material(
        "Pfalz_Gate_IronDark",
        albedo_file="gate_iron_dark.png",
        roughness=0.45,
        metallic=0.48,
        alpha_clip=True,
        double_sided=True,
    )
    mats["gate_bauhaus_slat"] = make_arch_material(
        "Pfalz_Gate_BauhausSlat",
        albedo_file="gate_bauhaus_slat_albedo.jpg",
        normal_file="gate_bauhaus_slat_normal.png",
        roughness=0.48,
        metallic=0.36,
        normal_strength=1.0,
        double_sided=True,
    )
    # Wave 2 specialized trims, bright metal fascia, fences & Kinderbach bridge railings
    mats["roof_red_bright"] = make_arch_material(
        "Pfalz_Roof_RedBright",
        base_color=(0.72, 0.24, 0.20, 1.0),
        roughness=0.52,
        metallic=0.22,
    )
    mats["trim_honey_wood"] = make_arch_material(
        "Pfalz_Trim_HoneyWood",
        base_color=(0.68, 0.46, 0.24, 1.0),
        roughness=0.72,
    )
    mats["trim_white"] = make_arch_material(
        "Pfalz_Trim_White",
        base_color=(0.93, 0.92, 0.90, 1.0),
        roughness=0.72,
    )
    mats["sign_kdc_blue"] = make_arch_material(
        "Pfalz_Sign_KDCBlue",
        base_color=(0.12, 0.28, 0.56, 1.0),
        roughness=0.45,
    )
    mats["fence_wood_picket"] = make_arch_material(
        "Pfalz_Fence_WoodPicket",
        albedo_file="fence_wood_picket.png",
        roughness=0.82,
        alpha_clip=True,
        double_sided=True,
    )
    mats["fence_mesh_green"] = make_arch_material(
        "Pfalz_Fence_MeshGreen",
        albedo_file="fence_mesh_green.png",
        roughness=0.55,
        metallic=0.35,
        alpha_clip=True,
        double_sided=True,
    )
    mats["fence_mesh_galv"] = make_arch_material(
        "Pfalz_Fence_MeshGalv",
        albedo_file="fence_mesh_galv.png",
        roughness=0.42,
        metallic=0.62,
        alpha_clip=True,
        double_sided=True,
    )
    mats["bridge_railing_galv"] = make_arch_material(
        "Pfalz_Bridge_RailingGalv",
        albedo_file="bridge_railing_galv.png",
        roughness=0.36,
        metallic=0.68,
        alpha_clip=True,
        double_sided=True,
    )
    return mats


# ---------------------------------------------------------------------------
# Street-View-Exact Per-Building Overrides & Missing Orthophoto Infill Table
# Verified against all 15 Aug-2023 Brave Street View & Satellite shots + DOP20
# ---------------------------------------------------------------------------

BUILDING_OVERRIDES: Dict[str, Dict] = {
    # --- sv_kirche_full_west & sv_kirche_front_detail (Hauptstraße #60-#62) ---
    "lod2/DERPLP110000QOQr": {
        "wall_mat": "wall_ochre_arched",      # East wall facing Martinskirche: warm ochre + white arched multi-pane!
        "gable_wall_mat": "wall_ochre_rolladen",
        "plinth_mat": "plinth_rubble",        # Pale limestone rubble plinth (sv_kirche_front_detail!)
        "plinth_above": 0.88,
        "roof_mat": "roof_darkbrown",
        "roof_shape": "gabled",
        "wall_h": 5.4,                        # Brings solar PV roof right down above wooden Hoftor canopy!
        "roof_h": 4.5,
        "solar_pv_dir": (-1.0, 0.0),          # Full rooftop solar PV array on west-facing slope!
        "ivy_dir": (0.0, -1.0),               # Lush green ivy climbing south gable wall facing Hauptstraße!
        "no_door": True,
    },
    "lod2/DERPLP110000QP1z": {
        "wall_mat": "wall_white_clean",
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_slate",
        "no_door": True,
    },
    "lod2/DERPLP110000QOQ9": {
        "wall_mat": "wall_ochre_rolladen",
        "plinth_mat": "plinth_red_smooth",
        "plinth_above": 0.85,
        "roof_mat": "roof_terracotta",
        "wall_h": 3.8,
        "roof_h": 3.1,
        "no_door": True,
    },
    # --- sv_rathaus_ortsmitte & sv_kirche_full_west right side (Webers-Weinstube & neighbor) ---
    "lod2/DERPLP110000QOLC": {
        "wall_mat": "wall_butter_yellow",     # "Webers-Weinstube" right of Rathaus (#DFD39E)
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.72,
        "roof_mat": "roof_darkbrown",
        "roof_shape": "gabled",
        "wall_h": 5.3,
        "roof_h": 2.9,
        "no_door": True,
    },
    "lod2/DERPLP110000QOQp": {
        "wall_mat": "wall_butter_yellow",     # Half-timbered pale yellow house right foreground of sv_kirche_full_west
        "gable_wall_mat": "wall_fachwerk_yellow",
        "plinth_mat": "plinth",
        "plinth_above": 0.82,
        "roof_mat": "roof_darkbrown",
        "roof_shape": "gabled",
        "wall_h": 6.2,
        "roof_h": 4.1,
        "no_door": True,
    },
    # --- sv_kirche_east_angle (Michelsberg corner & ivy house) ---
    "lod2/DERPLP110000QOQx": {
        "wall_mat": "wall_siding_lower",      # Horizontal light siding lower story + orange reveals
        "gable_wall_mat": "wall_timber_vertical",  # Vertical brown wood plank gable cladding
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.75,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 4.5,
        "roof_h": 4.0,
        "force_dormer": True,
        "dormer_mat": "wall_timber_vertical",
        "no_door": True,
    },
    "lod2/DERPLP110000QOQB": {
        "wall_mat": "wall_white_clean",       # Ivy-draped white house right of Michelsberg
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 5.4,
        "roof_h": 3.8,
        "ivy_dir": (0.0, -1.0),               # Dense climbing ivy blanketing south street-facing facade!
        "no_door": True,
    },
    "lod2/DERPLP110000QOQN": {
        "wall_mat": "wall_weathered_cream_dark",
        "plinth_mat": "plinth_checkered",
        "plinth_above": 0.85,
        "roof_mat": "roof_terracotta",
    },
    # --- sv_hauptstrasse_west_weingueter (Hauptstraße #59 corridor) ---
    "lod2/DERPLP110000QOR3": {
        "wall_mat": "wall_weathered_cream_dark",  # Left facade: weathered cream + dark brown Rolläden
        "plinth_mat": "plinth_checkered",         # Checkered brown-and-tan ceramic tile plinth!
        "plinth_above": 0.92,
        "roof_mat": "roof_darkred",
        "wall_h": 5.8,
        "roof_h": 3.8,
        "no_door": True,
    },
    "lod2/DERPLP110000QOQX": {
        "wall_mat": "wall_white_clean",
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "wall_h": 5.9,
        "roof_h": 3.8,
    },
    "lod2/DERPLP110000QOQZ": {
        "wall_mat": "wall_butter_yellow",     # Right gabled Winzerhaus: warm sand-yellow
        "plinth_mat": "plinth_checkered",     # Matching checkered brown-and-tan plinth!
        "plinth_above": 0.95,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 6.1,
        "roof_h": 4.3,
        "no_door": True,
    },
    "lod2/DERPLP110000QOYW": {
        "wall_mat": "wall_butter_yellow",
        "roof_mat": "roof_terracotta",
    },
    "lod2/DERPLP110000QOQT": {
        "wall_mat": "wall_cream",
        "gable_wall_mat": "wall_barn",
        "roof_mat": "roof_terracotta",
    },
    # --- sv_hauptstrasse_center_east (Hauptstraße #36-#45) ---
    "lod2/DERPLP110000QORh": {
        "wall_mat": "wall_blush_clean",       # Right dusty blush-pink gable house (#C8A69E)
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.25,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 4.35,                       # Matches real low eave & tall pink gable triangle!
        "roof_h": 4.65,
        "no_door": True,
    },
    "lod2/DERPLP110000QOV5": {
        "wall_mat": "wall_cream",
        "roof_mat": "roof_terracotta",
        "wall_h": 4.4,
        "roof_h": 3.0,
    },
    "lod2/DERPLP110000QP1f": {
        "wall_mat": "wall_white_clean",
        "roof_mat": "roof_terracotta",
    },
    # --- sv_weingut_kreutzenberger (1929 Bauhaus Landmark, Hauptstraße 5!) ---
    "lod2/DERPLP110000QOUr": {
        "wall_mat": "wall_bauhaus_white",
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.14,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",                 # Kills giant overhanging skillion wedge!
        "wall_h": 6.8,
        "roof_h": 0.0,
        "bauhaus_penthouse": True,            # Stepped upper 1929 Bauhaus clerestory block!
        "no_door": True,
    },
    "lod2/DERPLP110000QOUm": {
        "wall_mat": "wall_bauhaus_white",
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.14,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 4.8,
        "roof_h": 0.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QP2T": {
        "wall_mat": "wall_bauhaus_white",
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.14,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 4.6,
        "roof_h": 0.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QP2O": {
        "wall_mat": "wall_bauhaus_white",
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 5.8,
        "roof_h": 0.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QP2Q": {
        "wall_mat": "wall_bauhaus_white",
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 6.4,
        "roof_h": 0.0,
        "no_door": True,
    },
    # --- sv_side_street_neugasse (Neugasse #11 residential quarter) ---
    "lod2/DERPLP110000QORb": {
        "wall_mat": "wall_warmwhite",         # Crisp white w/ dark walnut shutters (not pink!)
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.45,
        "roof_mat": "roof_slate",
        "wall_h": 5.3,
        "roof_h": 3.2,
        "no_door": True,
    },
    "lod2/DERPLP110000QOR1": {
        "wall_mat": "wall_white_clean",       # Large crisp white villa w/ dark timber balconies
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.40,
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 6.4,
        "roof_h": 3.7,
        "balcony_dir": (0.45, -0.89),         # Twin dark-timber balconies facing SE onto Neugasse!
        "no_door": True,
    },
    "lod2/DERPLP110000QOZc": {
        "wall_mat": "wall_white_clean",
        "roof_mat": "roof_slate",
        "wall_h": 4.4,
        "roof_h": 2.4,
        "no_door": True,
    },
    "lod2/DERPLP110000QOZ8": {
        "wall_mat": "wall_white_clean",
        "roof_mat": "roof_slate",
        "wall_h": 5.2,
        "roof_h": 3.2,
        "no_door": True,
    },
    "way/734608755": {
        "wall_mat": "wall_white_clean",
        "roof_mat": "roof_darkred",
        "plinth_mat": "plinth_rubble",
        "no_door": True,
    },
    # --- sv_side_street_burgweg (Burgweg #4 north edge) ---
    "lod2/DERPLP110000QOH9": {
        "wall_mat": "wall_peach_plain",       # Windowless pale peach-cream garden garage/wall!
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.25,
        "roof_mat": "roof_slate",
        "roof_shape": "skillion",
        "wall_h": 2.9,
        "roof_h": 1.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QOSX": {
        "wall_mat": "wall_peach_plain",
        "is_windowed": False,
        "roof_mat": "roof_slate",
        "wall_h": 5.0,
        "roof_h": 2.2,
        "no_door": True,
    },
    "lod2/DERPLP110000QOSt": {
        "wall_mat": "wall_cream",             # Warm cream house on left w/ dark roof
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_slate",
        "wall_h": 5.6,
        "roof_h": 3.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QOSZ": {
        "wall_mat": "wall_white_clean",
        "roof_mat": "roof_slate",
        "solar_pv_dir": (0.0, -1.0),
    },
    # --- sv_vineyard_edge_west (Hauptstraße #95 heritage house & yellow brick barn) ---
    "lod2/DERPLP110000QOOd": {
        "wall_mat": "wall_sage",              # Iconic heritage blue-gray 1.5-story Winzerhaus w/ wood shutters!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.55,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.6,
        "roof_h": 4.3,
        "no_door": True,
    },
    "lod2/DERPLP110000QP1S": {
        "wall_mat": "wall_brick_barn_yellow", # Unplastered banded yellow/orange brick barn!
        "is_windowed": False,
        "plinth_mat": "wall_peach_plain",     # Smooth warm taupe plaster lower wall matching sv_vineyard_edge_west!
        "plinth_above": 2.45,
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 7.2,
        "roof_h": 1.85,
        "no_door": True,
    },
    "lod2/DERPLP110000QOXm": {
        "wall_mat": "wall_butter_yellow",
        "roof_mat": "roof_terracotta",
    },
    # --- sv_vineyard_hills_west (Hauptstraße #107 west exit) ---
    "lod2/DERPLP110000QOWg": {
        "wall_mat": "wall_white_clean",       # Crisp modern white house w/ warm terracotta roof!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.35,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.9,
        "roof_h": 4.4,
        "no_door": True,
    },
    "lod2/DERPLP110000QONJ": {
        "wall_mat": "wall_cream",
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_darkbrown",
        "wall_h": 4.8,
        "roof_h": 3.8,
    },
    # =========================================================================
    # WAVE 2: TRIFTSTRASSE, AM KIRCHRAIN & ADJACENT STREETS (Jul-2023 Street View)
    # =========================================================================

    # --- Triftstraße North Entry (sv_triftstrasse_north_entry) ---
    "lod2/DERPLP110000QOX3": {
        "wall_mat": "wall_limestone_brick",   # Unplastered buff limestone + red-brick band & louvered shutter!
        "gable_wall_mat": "wall_limestone_brick",
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.45,
        "roof_mat": "roof_darkred",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,              # Eave runs along Triftstraße edge matching photo!
        "wall_h": 5.4,
        "roof_h": 3.5,
        "no_door": True,
    },
    "lod2/DERPLP110000QP17": {
        "wall_mat": "wall_fachwerk_white",    # Triftstraße #4: iconic 2-story white Pfalz Fachwerk! (keep L-wing decomposition!)
        "gable_wall_mat": "wall_fachwerk_white",
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.55,
        "roof_mat": "roof_slate",             # Dark anthracite glazed clay tiles (#3B3E42)
        "wall_h": 6.4,
        "roof_h": 3.4,
        "ivy_dir": (1.0, 0.0),                # Green climbing grapevine/wisteria pergola along east facade!
        "no_door": True,
    },
    "lod2/DERPLP110000QOX6": {
        "wall_mat": "wall_fachwerk_white",    # Triftstraße #4 south-east street annex
        "gable_wall_mat": "wall_fachwerk_white",
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.55,
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 4.2,
        "roof_h": 1.9,
        "no_door": True,
    },
    "lod2/DERPLP110000QOX7": {
        "wall_mat": "wall_white_clean",
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_slate",
        "roof_shape": "skillion",
        "wall_h": 3.8,
        "roof_h": 0.9,
        "no_door": True,
    },
    "lod2/DERPLP110000QP1P": {
        "wall_mat": "wall_rubble_barn",       # Hauptstraße 95 east-flank shed w/ crisp blank white gable!
        "gable_wall_mat": "wall_white_clean",
        "no_attic_window": True,
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.2,
        "roof_h": 2.7,
        "no_door": True,
    },
    "lod2/DERPLP110000QP1Q": {
        "wall_mat": "wall_rubble_barn",       # Hauptstraße 95 massive stone barn w/ HUGE south solar PV!
        "gable_wall_mat": "wall_rubble_barn",
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 6.8,
        "roof_h": 4.6,
        "solar_pv_dir": (0.29, -0.96),        # Full-slope dark blue-slate PV facing south down Triftstraße!
        "no_door": True,
    },
    "lod2/DERPLP110000QP15": {
        "wall_mat": "wall_utility",           # KDC workshop building
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "wall_h": 4.8,
        "roof_h": 2.5,
        "no_door": True,
    },
    # --- Triftstraße Mid (#6 & #3: mid_southbound, mid_northbound, south_house3) ---
    "lod2/DERPLP110000QOWK": {
        "wall_mat": "wall_rubble_barn",       # Triftstraße #6 massive unplastered limestone rubble barn!
        "gable_wall_mat": "wall_rubble_barn",
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 5.8,
        "roof_h": 5.1,
        "no_door": True,
    },
    "lod2/DERPLP110000QOWP": {
        "wall_mat": "wall_rubble_barn",       # Triftstraße #6 north stone street wall wing
        "gable_wall_mat": "wall_rubble_barn",
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 4.4,
        "roof_h": 1.5,
        "no_door": True,
    },
    "lod2/DERPLP110000QOWM": {
        "wall_mat": "wall_rubble_barn",
        "is_windowed": False,
        "roof_mat": "roof_terracotta",
        "wall_h": 3.6,
        "roof_h": 1.8,
        "no_door": True,
    },
    "lod2/DERPLP110000QOWQ": {
        "wall_mat": "wall_butter_yellow",     # Triftstraße #6 cream-sand street wing
        "is_windowed": False,
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "skillion",
        "wall_h": 3.6,
        "roof_h": 1.3,
        "no_door": True,
    },
    "lod2/DERPLP110000QOWN": {
        "wall_mat": "wall_butter_yellow",     # Triftstraße #6 residence: cream-yellow + dormer + white balcony!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.45,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 4.7,
        "roof_h": 3.6,
        "force_dormer": True,
        "dormer_dir": (0.0, -1.0),            # South-facing roof dormer visible in mid_northbound!
        "balcony_dir": (0.0, -1.0),           # Cantilevered white-railed upper balcony on south wall!
        "balcony_mat": "trim_white",
        "balcony_w": 3.8,
        "no_door": True,
    },
    "lod2/DERPLP110000QOWL": {
        "wall_mat": "wall_white_clean",       # Triftstraße #6 pale gray-white west annex
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_darkbrown",
        "roof_shape": "gabled",
        "wall_h": 3.8,
        "roof_h": 1.7,
        "no_door": True,
    },
    "lod2/DERPLP110000QP1N": {
        "wall_mat": "wall_white_clean",       # East roadside crisp white shed w/ bright brick-red fascia!
        "is_windowed": False,
        "plinth_mat": "plinth_concrete",
        "plinth_above": 0.25,
        "roof_mat": "roof_red_bright",
        "fascia_mat": "roof_red_bright",
        "roof_shape": "skillion",
        "wall_h": 2.9,
        "roof_h": 0.75,
        "no_door": True,
    },
    "lod2/DERPLP110000QP1O": {
        "wall_mat": "wall_white_clean",
        "is_windowed": False,
        "plinth_mat": "plinth_concrete",
        "roof_mat": "roof_terracotta",
        "fascia_mat": "roof_red_bright",
        "roof_shape": "skillion",
        "wall_h": 2.3,
        "roof_h": 0.7,
        "no_door": True,
    },
    "lod2/DERPLP110000QOXi": {
        "wall_mat": "wall_butter_yellow",     # Triftstraße #3 street-front cream wing
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.6,
        "roof_h": 2.2,
        "no_door": True,
    },
    "lod2/DERPLP110000QOXe": {
        "wall_mat": "wall_butter_yellow",     # Triftstraße #3 ochre-cream house + terracotta roof!
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 5.8,
        "roof_h": 3.6,
        "no_door": True,
    },
    # --- Triftstraße South (#7/#7A/#8 & Solar Barns visible on aerial_trift_kirchrain_west) ---
    "lod2/DERPLP110000QP1G": {
        "wall_mat": "wall_cream",
        "roof_mat": "roof_darkred",
        "wall_h": 4.8,
        "roof_h": 2.4,
    },
    "lod2/DERPLP110000QOWH": {
        "wall_mat": "wall_butter_yellow",
        "roof_mat": "roof_terracotta",
        "wall_h": 4.8,
        "roof_h": 4.0,
    },
    "lod2/DERPLP110000QP1M": {
        "wall_mat": "wall_utility",
        "is_windowed": False,
        "roof_mat": "roof_metal",
        "roof_shape": "gabled",
        "solar_pv_dir": (0.32, -0.95),        # Large south-slope rooftop solar PV visible on DOP20/satellite!
        "no_door": True,
    },
    "lod2/DERPLP110000QOGj": {
        "wall_mat": "wall_utility",
        "is_windowed": False,
        "roof_mat": "roof_metal",
        "roof_shape": "gabled",
        "solar_pv_dir": (0.32, -0.95),        # Large south-slope agricultural hall PV array!
        "no_door": True,
    },

    # --- Am Kirchrain SW & Mid (sv_kirchrain_sw_eastbound & sv_kirchrain_mid_westbound) ---
    "way/734370315": {
        "wall_mat": "wall_white_clean",       # Am Kirchrain #5: crisp white 1.5-story + steep anthracite roof!
        "plinth_mat": "plinth_slate_gray",
        "plinth_above": 0.35,
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 3.3,
        "roof_h": 4.6,
        "no_door": True,
    },
    "lod2/DERPLP1100011swg": {
        "wall_mat": "wall_white_clean",       # Flat crisp white garage between #5 & #7!
        "is_windowed": False,
        "plinth_mat": "plinth_concrete",
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 2.7,
        "roof_h": 0.0,
        "no_door": True,
    },
    "lod2/DERPLP1100011swf": {
        "wall_mat": "wall_white_clean",       # Rear annex of #5 (clamps crazy 5.8m LoD2 needle spike!)
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 3.1,
        "roof_h": 1.4,
        "no_door": True,
    },
    "lod2/DERPLP110000QOFP": {
        "wall_mat": "wall_mustard_yellow",    # Am Kirchrain #7: unmistakable vibrant mustard-ochre (#CFA245)!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.45,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.8,
        "roof_h": 4.6,
        "balcony_dir": (-0.87, -0.49),        # WSW timber balcony rail facing street approach!
        "balcony_mat": "trim_honey_wood",
        "no_door": True,
    },
    "lod2/DERPLP110000QOFh": {
        "wall_mat": "wall_white_clean",       # Crisp white garage west of Doppelhaus QOFT!
        "is_windowed": False,
        "plinth_mat": "plinth_concrete",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 2.7,
        "roof_h": 1.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QOFo": {
        "wall_mat": "wall_white_clean",       # Am Kirchrain #16 flat white garage
        "is_windowed": False,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 2.4,
        "roof_h": 0.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QOFH": {
        "wall_mat": "wall_white_clean",       # Am Kirchrain #16: crisp white 2-story + deep burgundy roof!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.40,
        "roof_mat": "roof_darkred",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,              # Burgundy roof slope faces WSW toward sw_eastbound; white balcony gable faces SE street!
        "wall_h": 4.9,
        "roof_h": 4.3,
        "balcony_dir": (0.48, -0.88),         # White-railed side balcony facing SE toward Am Kirchrain!
        "balcony_mat": "trim_white",
        "no_door": True,
    },
    "lod2/DERPLP110000QOFR": {
        "wall_mat": "wall_cream",             # Am Kirchrain #18: pale cream + honey-wood eaves/balcony + terracotta!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.55,
        "roof_mat": "roof_terracotta",
        "fascia_mat": "trim_honey_wood",
        "roof_shape": "gabled",
        "wall_h": 5.0,
        "roof_h": 4.4,
        "balcony_dir": (0.48, -0.88),         # Warm honey-wood upper balcony facing street!
        "balcony_mat": "trim_honey_wood",
        "no_door": True,
    },
    "lod2/DERPLP200003sEHT": {
        "wall_mat": "wall_cream",             # #18 street-edge wing
        "is_windowed": False,
        "roof_mat": "roof_terracotta",
        "fascia_mat": "trim_honey_wood",
        "roof_shape": "gabled",
        "wall_h": 2.9,
        "roof_h": 1.4,
        "no_door": True,
    },
    "lod2/DERPLP110000QOFV": {
        "wall_mat": "wall_butter_yellow",     # Twin Doppelhaus EAST unit: cream-ochre, street-parallel ridge!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.35,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,              # Unifies ridge parallel to Am Kirchrain!
        "wall_h": 5.5,
        "roof_h": 2.9,
        "no_door": True,
    },
    "lod2/DERPLP110000QOFT": {
        "wall_mat": "wall_white_clean",       # Twin Doppelhaus WEST unit: crisp white, street-parallel ridge!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.35,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,
        "wall_h": 5.5,
        "roof_h": 2.9,
        "no_door": True,
    },
    "lod2/DERPLP110000QOG9": {
        "wall_mat": "wall_coral_terracotta",  # Am Kirchrain #10: dusty salmon-pink w/ red-brown half-hipped roof!
        "plinth_mat": "plinth_rubble",
        "roof_mat": "roof_darkred",
        "roof_shape": "hipped",
        "wall_h": 5.2,
        "roof_h": 4.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QOFz": {
        "wall_mat": "wall_cream",             # Am Kirchrain #1 outbuilding (clamps 5.2m LoD2 spike!)
        "is_windowed": False,
        "roof_mat": "roof_darkred",
        "roof_shape": "gabled",
        "wall_h": 3.0,
        "roof_h": 1.1,
        "no_door": True,
    },
    # --- Am Kirchrain NE, Bend & North Slope (ne_eastbound, bend_east_vista, north_southbound) ---
    "lod2/DERPLP110000QONN": {
        "wall_mat": "wall_coral_terracotta",  # Am Kirchrain #13: dusty coral-terracotta stucco bungalow (#B96C5E)!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.35,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.6,
        "roof_h": 3.4,
        "no_door": True,
    },
    "lod2/DERPLP110000QOHz": {
        "wall_mat": "wall_coral_terracotta",  # #13 corner garage/wing
        "is_windowed": False,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.1,
        "roof_h": 1.2,
        "no_door": True,
    },
    "lod2/DERPLP110000QOWu": {
        "wall_mat": "wall_cream",             # Pale cream-beige gabled double carport/garage!
        "is_windowed": False,
        "plinth_mat": "plinth_concrete",
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 2.8,
        "roof_h": 1.6,
        "no_door": True,
    },
    "way/734370329": {
        "wall_mat": "wall_coral_terracotta",  # Am Sonnenberg 2 / Kirchrain NE corner: coral-terracotta stucco bungalow!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.35,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "wall_h": 3.4,
        "roof_h": 3.5,
        "no_door": True,
    },
    "lod2/DERPLP110000QONP": {
        "wall_mat": "wall_white_clean",       # Am Kirchrain #24: crisp white modern bungalow + anthracite hipped roof!
        "plinth_mat": "plinth_concrete",
        "plinth_above": 0.35,
        "roof_mat": "roof_slate",
        "roof_shape": "hipped",
        "wall_h": 3.4,
        "roof_h": 2.3,
        "no_door": True,
    },
    "lod2/DERPLP110000QP0j": {
        "wall_mat": "wall_white_clean",
        "is_windowed": False,
        "roof_mat": "roof_slate",
        "wall_h": 2.6,
        "roof_h": 1.0,
        "no_door": True,
    },
    "lod2/DERPLP200000Iss2": {"skip": True},  # Replaced cleanly by exact DOP20 villa infill/am_kirchrain_28!
    "lod2/DERPLP200000Iss3": {"skip": True},  # Replaced cleanly by exact DOP20 villa infill/am_kirchrain_28!
    "lod2/DERPLP110000QOO1": {
        "wall_mat": "wall_cool_gray_light",   # Am Kirchrain #25: light gray gable + E-W ridge + south solar PV!
        "plinth_mat": "plinth_concrete",
        "plinth_above": 0.35,
        "roof_mat": "roof_darkbrown",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,              # Ridge runs E-W so gable faces west & PV slope faces south!
        "wall_h": 3.9,
        "roof_h": 4.0,
        "solar_pv_dir": (0.17, -0.98),        # Large black solar PV array on south roof slope!
        "no_door": True,
    },
    "lod2/DERPLP110000QOO3": {
        "wall_mat": "wall_sandstone_buff",    # Am Kirchrain #15: warm buff sand-lime brick + dark anthracite hipped roof!
        "plinth_mat": "plinth_concrete",
        "plinth_above": 0.40,
        "roof_mat": "roof_slate",
        "roof_shape": "hipped",
        "wall_h": 5.2,
        "roof_h": 3.3,
        "no_door": True,
    },
    "lod2/DERPLP110000QOHK": {
        "wall_mat": "wall_sandstone_buff",    # #15 buff brick garage/gable wing w/ dark charcoal roof!
        "is_windowed": False,
        "plinth_mat": "plinth_concrete",
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 3.7,
        "roof_h": 2.4,
        "no_door": True,
    },
    "lod2/DERPLP110000QOO5": {
        "wall_mat": "wall_white_clean",       # East spur houses (#17–#23) visible in bend_east_vista!
        "roof_mat": "roof_terracotta",
        "wall_h": 5.4,
        "roof_h": 2.8,
    },
    "lod2/DERPLP110000QOOf": {
        "wall_mat": "wall_white_clean",
        "roof_mat": "roof_terracotta",
        "wall_h": 5.4,
        "roof_h": 3.8,
        "no_door": True,
    },
    "lod2/DERPLP110000QOHV": {
        "wall_mat": "wall_white_clean",
        "is_windowed": False,
        "roof_mat": "roof_terracotta",
        "wall_h": 2.8,
        "roof_h": 1.3,
        "no_door": True,
    },

    # --- Adjacent Streets: Im Rosengarten, Judenberg, Raiffeisenstraße East ---
    "lod2/DERPLP110000QOFN": {
        "wall_mat": "wall_butter_yellow",     # Im Rosengarten #11: sunny butter-yellow + slate plinth + darkred roof!
        "plinth_mat": "plinth_slate_gray",
        "plinth_above": 0.65,
        "roof_mat": "roof_darkred",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,              # Street-parallel main ridge + street-facing gable dormer!
        "wall_h": 5.6,
        "roof_h": 3.2,
        "force_dormer": True,
        "dormer_dir": (-0.48, 0.88),
        "no_door": True,
    },
    "lod2/DERPLP110000QOFr": {
        "wall_mat": "wall_timber_vertical",   # Im Rosengarten #11 natural wooden garden shed!
        "gable_wall_mat": "wall_timber_vertical",
        "is_windowed": False,
        "roof_mat": "roof_darkred",
        "roof_shape": "gabled",
        "wall_h": 2.1,
        "roof_h": 0.8,
        "no_door": True,
    },
    "lod2/DERPLP110001536K": {
        "wall_mat": "wall_cool_gray",         # Im Rosengarten #6: modern concrete-gray + full black solar PV roof!
        "plinth_mat": "plinth_slate_gray",
        "plinth_above": 0.35,
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 3.4,
        "roof_h": 3.3,
        "solar_pv_dir": (0.48, -0.88),        # Full SSE street-facing solar PV slope!
        "no_door": True,
    },
    "lod2/DERPLP110000QOFJ": {
        "wall_mat": "wall_white_clean",       # Im Rosengarten #4: crisp white 2-story stucco!
        "plinth_mat": "plinth_concrete",
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 4.9,
        "roof_h": 3.6,
        "no_door": True,
    },
    "lod2/DERPLP110000QOFf": {
        "wall_mat": "wall_white_clean",       # Im Rosengarten #4 garage tucked behind green hedge
        "is_windowed": False,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 2.4,
        "roof_h": 0.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QOOn": {
        "wall_mat": "wall_butter_yellow",     # Judenberg #5: warm butter-yellow + bright terracotta + rotated ridge!
        "plinth_mat": "plinth_rubble",
        "plinth_above": 0.35,
        "roof_mat": "roof_terracotta",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,              # Ridge E-W so long terracotta slope faces Judenberg north!
        "wall_h": 3.4,
        "roof_h": 3.5,
        "no_door": True,
    },
    "lod2/DERPLP110000QPa5": {
        "wall_mat": "wall_timber_vertical",   # Judenberg #5 open timber carport/garage
        "is_windowed": False,
        "roof_mat": "roof_terracotta",
        "roof_shape": "skillion",
        "wall_h": 2.5,
        "roof_h": 0.7,
        "no_door": True,
    },
    "lod2/DERPLP110000QOXq": {
        "wall_mat": "wall_white_clean",       # Judenberg #4 distant white solar PV roof visible along Judenberg!
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "rotate_ridge_90": True,
        "solar_pv_dir": (0.13, -0.99),
        "no_door": True,
    },
    "lod2/DERPLP110000QOSx": {
        "wall_mat": "wall_blush_clean",       # Raiffeisenstraße #31: dusty blush-pink + 1.15m slate-gray plinth!
        "plinth_mat": "plinth_slate_gray",
        "plinth_above": 1.15,
        "roof_mat": "roof_darkred",
        "roof_shape": "gabled",
        "wall_h": 6.4,
        "roof_h": 3.1,
        "no_door": True,
    },
    "lod2/DERPLP110000QOV9": {
        "wall_mat": "wall_cool_gray_light",   # Gässelstraße 19: light gray + anthracite roof + solar PV!
        "plinth_mat": "plinth_slate_gray",
        "roof_mat": "roof_slate",
        "roof_shape": "gabled",
        "wall_h": 5.6,
        "roof_h": 2.9,
        "solar_pv_dir": (0.27, -0.96),
        "no_door": True,
    },
    "lod2/DERPLP110000QOSz": {
        "wall_mat": "wall_white_clean",       # Gässelstraße 17: crisp white + terracotta roof!
        "roof_mat": "roof_terracotta",
        "wall_h": 5.6,
        "roof_h": 2.8,
        "no_door": True,
    },
    "lod2/DERPLP110000QOLm": {
        "wall_mat": "wall_utility",           # Raiffeisenstraße north flat concrete garage
        "is_windowed": False,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 2.6,
        "roof_h": 0.0,
        "no_door": True,
    },
    "lod2/DERPLP110000QOLl": {
        "wall_mat": "wall_utility",
        "is_windowed": False,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 2.6,
        "roof_h": 0.0,
        "no_door": True,
    },
}

# 3 real Kindenheim street-facing buildings visible on RLP DOP20 orthophoto & Street View
# that were absent from the upstream LoD2 export (zero overlap with existing footprints or landmarks!)
CORRIDOR_INFILL_BUILDINGS: List[Dict] = [
    {
        # Hauptstraße 62 (ochre Winzerhaus filling left foreground of sv_kirche_full_west.png!)
        "id": "infill/hauptstr_62",
        "category": "residential",
        "center": [-60.15, -51.45],
        "baseElevationM": 57.55,
        "wallHeightM": 3.45,
        "roofHeightM": 3.25,
        "roofShape": "gabled",
        "roofTone": "terracotta",
        "footprint": [[-65.8, -45.3], [-51.8, -50.4], [-54.5, -57.6], [-68.5, -52.4]],
        "override": {
            "wall_mat": "wall_ochre_rolladen",
            "plinth_mat": "plinth_red_smooth",
            "plinth_above": 0.88,
            "roof_mat": "roof_terracotta",
            "roof_shape": "gabled",
            "wall_h": 3.45,
            "roof_h": 3.25,
            "no_door": True,
        },
    },
    {
        # Hauptstraße 36 (yellow Winzerhaus w/ rubble plinth & ivy gable filling left of sv_hauptstrasse_center_east.png!)
        "id": "infill/hauptstr_36",
        "category": "residential",
        "center": [149.3, -131.3],
        "baseElevationM": 52.91,
        "wallHeightM": 6.1,
        "roofHeightM": 3.8,
        "roofShape": "gabled",
        "roofTone": "charcoal",
        "footprint": [[147.8, -121.0], [156.4, -124.2], [150.7, -141.6], [142.3, -138.4]],
        "override": {
            "wall_mat": "wall_butter_yellow",
            "plinth_mat": "plinth_rubble",
            "plinth_above": 1.05,
            "roof_mat": "roof_slate",
            "roof_shape": "gabled",
            "wall_h": 6.1,
            "roof_h": 3.8,
            "ivy_dir": (0.94, 0.34),  # Thick green climbing ivy blanketing the ENE street gable!
            "no_door": True,
        },
    },
    {
        # Neugasse 13 (crisp white steep-charcoal-roofed house 2nd on left in sv_side_street_neugasse.png!)
        "id": "infill/neugasse_13",
        "category": "residential",
        "center": [63.0, -195.2],
        "baseElevationM": 63.09,
        "wallHeightM": 3.8,
        "roofHeightM": 4.4,
        "roofShape": "gabled",
        "roofTone": "charcoal",
        "footprint": [[69.4, -198.2], [59.6, -201.4], [56.5, -192.2], [66.4, -189.0]],
        "override": {
            "wall_mat": "wall_white_clean",
            "plinth_mat": "plinth_rubble",
            "plinth_above": 0.35,
            "roof_mat": "roof_slate",
            "roof_shape": "gabled",
            "wall_h": 3.8,
            "roof_h": 4.4,
            "no_door": True,
        },
    },
    # --- Wave 2: 4 DOP20- & Street-View-Verified Missing Buildings on Am Kirchrain & Triftstraße ---
    {
        # Am Kirchrain #28: Modern minimalist cubic off-white villa w/ dark Raffstore ribbon windows!
        # (Replaces broken LoD2 slivers Iss2 & Iss3 in sv_kirchrain_north_southbound.png!)
        "id": "infill/am_kirchrain_28",
        "category": "residential",
        "center": [-437.95, -23.7],
        "baseElevationM": 84.10,
        "wallHeightM": 6.1,
        "roofHeightM": 0.0,
        "roofShape": "flat",
        "roofTone": "charcoal",
        "footprint": [[-431.2, -29.8], [-429.7, -20.2], [-444.7, -17.6], [-446.2, -27.2]],
        "override": {
            "wall_mat": "wall_modern_raffstore",
            "plinth_mat": "plinth_concrete",
            "plinth_above": 0.22,
            "roof_mat": "roof_flat",
            "roof_shape": "flat",
            "wall_h": 6.1,
            "roof_h": 0.0,
            "no_door": True,
        },
    },
    {
        # Am Kirchrain #7 Front Mustard-Yellow Porthole Garden Shed (Bullaugen — sv_kirchrain_sw_eastbound!)
        "id": "infill/am_kirchrain_7_shed",
        "category": "shed",
        "center": [-564.35, 88.65],
        "baseElevationM": 83.20,
        "wallHeightM": 2.35,
        "roofHeightM": 1.25,
        "roofShape": "gabled",
        "roofTone": "terracotta",
        "footprint": [[-567.2, 88.0], [-563.4, 85.9], [-561.5, 89.3], [-565.3, 91.4]],
        "override": {
            "wall_mat": "wall_mustard_porthole",
            "gable_wall_mat": "wall_mustard_yellow",
            "is_windowed": False,
            "plinth_mat": "plinth_concrete",
            "plinth_above": 0.14,
            "roof_mat": "roof_terracotta",
            "roof_shape": "gabled",
            "wall_h": 2.35,
            "roof_h": 1.25,
            "no_door": True,
        },
    },
    {
        # Am Kirchrain #1 Missing Main House (visible between QOFa/QOFc/QOFz on DOP20 & aerial_trift_kirchrain_west!)
        "id": "infill/am_kirchrain_1",
        "category": "residential",
        "center": [-625.75, 131.4],
        "baseElevationM": 85.30,
        "wallHeightM": 5.3,
        "roofHeightM": 3.5,
        "roofShape": "gabled",
        "roofTone": "dark_red",
        "footprint": [[-634.5, 131.5], [-620.8, 124.2], [-617.0, 131.3], [-630.7, 138.6]],
        "override": {
            "wall_mat": "wall_cream",
            "plinth_mat": "plinth_rubble",
            "roof_mat": "roof_darkred",
            "roof_shape": "gabled",
            "wall_h": 5.3,
            "roof_h": 3.5,
            "no_door": True,
        },
    },
    {
        # Triftstraße #8 Missing Courtyard Building (between QOWH, QP0B & QOHR on DOP20 & aerial_trift_kirchrain_west!)
        "id": "infill/triftstr_8_shed",
        "category": "residential",
        "center": [-332.8, 308.9],
        "baseElevationM": 67.68,
        "wallHeightM": 3.5,
        "roofHeightM": 2.3,
        "roofShape": "gabled",
        "roofTone": "terracotta",
        "footprint": [[-338.8, 307.6], [-328.8, 304.2], [-326.8, 310.2], [-336.8, 313.6]],
        "override": {
            "wall_mat": "wall_cream",
            "plinth_mat": "plinth_rubble",
            "roof_mat": "roof_terracotta",
            "roof_shape": "gabled",
            "wall_h": 3.5,
            "roof_h": 2.3,
            "no_door": True,
        },
    },
]


# ---------------------------------------------------------------------------
# 2D Polygon Math: Cleaning, OBB, Point-in-Polygon, Wing Decomposition
# ---------------------------------------------------------------------------

def signed_area_2d(pts: List[Tuple[float, float]]) -> float:
    a = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return 0.5 * a


def clean_polygon_2d(raw_pts: List[Tuple[float, float]], min_dist: float = 0.22) -> List[Tuple[float, float]]:
    """Deduplicate, ensure CCW winding, and drop tiny/collinear artifacts."""
    pts = []
    for x, y in raw_pts:
        if not pts or math.hypot(x - pts[-1][0], y - pts[-1][1]) >= min_dist:
            pts.append((float(x), float(y)))
    if len(pts) >= 2 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < min_dist:
        pts.pop()
    if len(pts) < 3:
        return []
    if signed_area_2d(pts) < 0:
        pts.reverse()
    # Drop nearly-collinear vertices (< 1.5 deg bend)
    cleaned = []
    n = len(pts)
    for i in range(n):
        p_prev = pts[(i - 1) % n]
        p_cur = pts[i]
        p_next = pts[(i + 1) % n]
        v1 = (p_cur[0] - p_prev[0], p_cur[1] - p_prev[1])
        v2 = (p_next[0] - p_cur[0], p_next[1] - p_cur[1])
        l1 = math.hypot(*v1)
        l2 = math.hypot(*v2)
        if l1 < 1e-4 or l2 < 1e-4:
            continue
        cross = abs(v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2)
        dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)
        if cross < 0.025 and dot > 0.0:
            continue
        cleaned.append(p_cur)
    return cleaned if len(cleaned) >= 3 else pts


def convex_hull_2d(pts: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    pts_s = sorted(set(pts))
    if len(pts_s) <= 2:
        return pts_s

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts_s:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts_s):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def compute_min_obb(pts: List[Tuple[float, float]]) -> Dict:
    """Exact minimum-area Oriented Bounding Box aligned to convex hull edges."""
    hull = convex_hull_2d(pts)
    if len(hull) < 3:
        hull = pts
    best = None
    n = len(hull)
    for i in range(n):
        x0, y0 = hull[i]
        x1, y1 = hull[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        elen = math.hypot(dx, dy)
        if elen < 1e-5:
            continue
        ux, uy = dx / elen, dy / elen
        vx, vy = -uy, ux
        us = [p[0] * ux + p[1] * uy for p in pts]
        vs = [p[0] * vx + p[1] * vy for p in pts]
        min_u, max_u = min(us), max(us)
        min_v, max_v = min(vs), max(vs)
        lu = max_u - min_u
        lv = max_v - min_v
        area = lu * lv
        if best is None or area < best["area"]:
            best = {
                "area": area,
                "u_axis": (ux, uy),
                "v_axis": (vx, vy),
                "min_u": min_u, "max_u": max_u,
                "min_v": min_v, "max_v": max_v,
                "len_u": lu, "len_v": lv,
            }
    # Ensure u_axis is always the LONGEST axis (ridge runs along u_axis!)
    if best["len_v"] > best["len_u"]:
        ux, uy = best["v_axis"]
        vx, vy = -uy, ux
        us = [p[0] * ux + p[1] * uy for p in pts]
        vs = [p[0] * vx + p[1] * vy for p in pts]
        best["u_axis"] = (ux, uy)
        best["v_axis"] = (vx, vy)
        best["min_u"], best["max_u"] = min(us), max(us)
        best["min_v"], best["max_v"] = min(vs), max(vs)
        best["len_u"] = best["max_u"] - best["min_u"]
        best["len_v"] = best["max_v"] - best["min_v"]

    cu = 0.5 * (best["min_u"] + best["max_u"])
    cv = 0.5 * (best["min_v"] + best["max_v"])
    ux, uy = best["u_axis"]
    vx, vy = best["v_axis"]
    best["center"] = (cu * ux + cv * vx, cu * uy + cv * vy)
    return best


def point_in_polygon(px: float, py: float, poly: List[Tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / ((yj - yi) + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def offset_polygon_outward(pts: List[Tuple[float, float]], offset: float) -> List[Tuple[float, float]]:
    """Safe miter-clamped outward polygon offset for CCW polygon."""
    n = len(pts)
    out = []
    for i in range(n):
        p_prev = pts[(i - 1) % n]
        p_cur = pts[i]
        p_next = pts[(i + 1) % n]
        e1 = Vector((p_cur[0] - p_prev[0], p_cur[1] - p_prev[1]))
        e2 = Vector((p_next[0] - p_cur[0], p_next[1] - p_cur[1]))
        if e1.length < 1e-5 or e2.length < 1e-5:
            out.append(p_cur)
            continue
        e1.normalize()
        e2.normalize()
        # Outward normals for CCW polygon point right: (ey, -ex)
        n1 = Vector((e1.y, -e1.x))
        n2 = Vector((e2.y, -e2.x))
        bis = n1 + n2
        if bis.length < 1e-4:
            bis = n1
        else:
            bis.normalize()
        denom = max(bis.dot(n1), 0.45)  # Clamp miter spike
        dist = min(offset / denom, abs(offset) * 1.8)
        out.append((p_cur[0] + bis.x * dist, p_cur[1] + bis.y * dist))
    return out


def cluster_1d(vals: List[float], tol: float = 0.85) -> List[float]:
    sv = sorted(vals)
    clusters = []
    for v in sv:
        if not clusters or v - clusters[-1][-1] > tol:
            clusters.append([v])
        else:
            clusters[-1].append(v)
    return [sum(c) / len(c) for c in clusters]


def decompose_rectilinear_wings(pts: List[Tuple[float, float]], obb: Dict) -> Optional[List[Tuple[float, float, float, float]]]:
    """
    Decompose L/T/U/courtyard rectilinear footprints into clean (u0, u1, v0, v1) wings
    in the OBB coordinate frame so each wing gets its own crisp intersecting gabled roof!
    Returns None if polygon isn't well-approximated by orthogonal wings.
    """
    ux, uy = obb["u_axis"]
    vx, vy = obb["v_axis"]
    poly_uv = [(p[0] * ux + p[1] * uy, p[0] * vx + p[1] * vy) for p in pts]
    us = cluster_1d([p[0] for p in poly_uv], tol=0.95)
    vs = cluster_1d([p[1] for p in poly_uv], tol=0.95)
    if len(us) < 2 or len(vs) < 2 or len(us) > 8 or len(vs) > 8:
        return None

    nu, nv = len(us) - 1, len(vs) - 1
    grid = [[False] * nv for _ in range(nu)]
    covered_area = 0.0
    for i in range(nu):
        for j in range(nv):
            mu = 0.5 * (us[i] + us[i + 1])
            mv = 0.5 * (vs[j] + vs[j + 1])
            if point_in_polygon(mu, mv, poly_uv):
                grid[i][j] = True
                covered_area += (us[i + 1] - us[i]) * (vs[j + 1] - vs[j])

    poly_area = abs(signed_area_2d(pts))
    if poly_area < 1.0:
        return None
    ratio = covered_area / poly_area
    if ratio < 0.80 or ratio > 1.22:
        return None

    # Greedily extract maximal rectangles covering all True cells
    remaining = [row[:] for row in grid]
    wings = []
    for _ in range(6):
        best_rect = None
        best_score = 0.0
        for i0 in range(nu):
            for j0 in range(nv):
                if not remaining[i0][j0]:
                    continue
                for i1 in range(i0, nu):
                    for j1 in range(j0, nv):
                        # All cells in [i0..i1] x [j0..j1] must be inside original polygon!
                        valid = True
                        new_area = 0.0
                        for ii in range(i0, i1 + 1):
                            for jj in range(j0, j1 + 1):
                                if not grid[ii][jj]:
                                    valid = False
                                    break
                                if remaining[ii][jj]:
                                    new_area += (us[ii + 1] - us[ii]) * (vs[jj + 1] - vs[jj])
                            if not valid:
                                break
                        if valid and new_area > best_score:
                            best_score = new_area
                            best_rect = (i0, i1, j0, j1)
        if best_rect is None or best_score < 4.0:
            break
        i0, i1, j0, j1 = best_rect
        for ii in range(i0, i1 + 1):
            for jj in range(j0, j1 + 1):
                remaining[ii][jj] = False
        wings.append((us[i0], us[i1 + 1], vs[j0], vs[j1 + 1]))

    if len(wings) < 2:
        return None
    return wings


# ---------------------------------------------------------------------------
# Mesh Builder Core (Single BMesh per Chunk with Multiple Material Slots!)
# ---------------------------------------------------------------------------

class VillageMeshBuilder:
    def __init__(self, name: str, mat_lib: Dict[str, bpy.types.Material]):
        self.name = name
        self.mat_lib = mat_lib
        self.mat_order: List[str] = []
        self.mat_to_idx: Dict[str, int] = {}
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def mat_idx(self, mat_key: str) -> int:
        if mat_key not in self.mat_to_idx:
            self.mat_to_idx[mat_key] = len(self.mat_order)
            self.mat_order.append(mat_key)
        return self.mat_to_idx[mat_key]

    def add_quad(self, p0, p1, p2, p3, uvs, mat_key: str):
        vs = [self.bm.verts.new(p) for p in (p0, p1, p2, p3)]
        try:
            f = self.bm.faces.new(vs)
            f.material_index = self.mat_idx(mat_key)
            for lp, uv_c in zip(f.loops, uvs):
                lp[self.uv].uv = uv_c
            return f
        except ValueError:
            return None

    def add_tri(self, p0, p1, p2, uvs, mat_key: str):
        vs = [self.bm.verts.new(p) for p in (p0, p1, p2)]
        try:
            f = self.bm.faces.new(vs)
            f.material_index = self.mat_idx(mat_key)
            for lp, uv_c in zip(f.loops, uvs):
                lp[self.uv].uv = uv_c
            return f
        except ValueError:
            return None

    def add_box(self, center: Vector, u_axis: Vector, v_axis: Vector, sx: float, sy: float, sz: float, mat_key: str, uv_scale: float = 2.0):
        """Add an oriented box centered at `center` along u_axis (sx), v_axis (sy), and +Z (sz)."""
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        z_axis = Vector((0.0, 0.0, 1.0))

        def pt(dx, dy, dz):
            return center + u_axis * dx + v_axis * dy + z_axis * dz

        c000 = pt(-hx, -hy, -hz)
        c100 = pt(hx, -hy, -hz)
        c110 = pt(hx, hy, -hz)
        c010 = pt(-hx, hy, -hz)
        c001 = pt(-hx, -hy, hz)
        c101 = pt(hx, -hy, hz)
        c111 = pt(hx, hy, hz)
        c011 = pt(-hx, hy, hz)

        faces = [
            ((c000, c100, c101, c001), sx / uv_scale, sz / uv_scale),  # -v side
            ((c100, c110, c111, c101), sy / uv_scale, sz / uv_scale),  # +u side
            ((c110, c010, c011, c111), sx / uv_scale, sz / uv_scale),  # +v side
            ((c010, c000, c001, c011), sy / uv_scale, sz / uv_scale),  # -u side
            ((c001, c101, c111, c011), sx / uv_scale, sy / uv_scale),  # top
            ((c010, c110, c100, c000), sx / uv_scale, sy / uv_scale),  # bottom
        ]
        for (a, b, c, d), su, sv in faces:
            self.add_quad(a, b, c, d, ((0, 0), (su, 0), (su, sv), (0, sv)), mat_key)

    def add_plinth_skirt(self, pts: List[Tuple[float, float]], z_bot: float, z_top: float, plinth_mat: str = "plinth"):
        """Extrude 2.0m underground + above-ground plinth with slight proud ledge."""
        outer = offset_polygon_outward(pts, 0.045)
        n = len(outer)
        perim = 0.0
        h = z_top - z_bot
        uv_w = 2.2 if plinth_mat == "plinth_checkered" else 4.0
        uv_h = 1.1 if plinth_mat == "plinth_checkered" else 2.0
        v_top = h / uv_h
        for i in range(n):
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            elen = math.hypot(x1 - x0, y1 - y0)
            u0 = perim / uv_w
            u1 = (perim + elen) / uv_w
            self.add_quad(
                (x0, y0, z_bot), (x1, y1, z_bot), (x1, y1, z_top), (x0, y0, z_top),
                ((u0, 0.0), (u1, 0.0), (u1, v_top), (u0, v_top)),
                plinth_mat,
            )
            ix0, iy0 = pts[i]
            ix1, iy1 = pts[(i + 1) % n]
            self.add_quad(
                (x0, y0, z_top), (x1, y1, z_top), (ix1, iy1, z_top), (ix0, iy0, z_top),
                ((u0, 0.0), (u1, 0.0), (u1, 0.08), (u0, 0.08)),
                plinth_mat,
            )
            perim += elen

    def add_ivy_blanket_on_wall(
        self,
        pts: List[Tuple[float, float]],
        z_bot: float,
        z_top: float,
        ivy_dir_blender: Tuple[float, float],
    ):
        """Drape organic multi-panel 3D climbing green ivy foliage slabs across walls facing ivy_dir_blender."""
        dx_t, dy_t = ivy_dir_blender
        dlen = math.hypot(dx_t, dy_t)
        if dlen < 1e-4:
            return
        tx, ty = dx_t / dlen, dy_t / dlen
        n = len(pts)
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            elen = math.hypot(x1 - x0, y1 - y0)
            if elen < 2.2:
                continue
            ex, ey = (x1 - x0) / elen, (y1 - y0) / elen
            nx, ny = ey, -ex  # Outward normal for CCW polygon
            if nx * tx + ny * ty < 0.45:
                continue
            u_vec = Vector((ex, ey, 0.0))
            v_vec = Vector((nx, ny, 0.0))
            wall_h = max(1.0, z_top - z_bot)
            # 5 organic staggered vertical foliage blankets covering ~75% of wall
            n_strips = max(4, int(elen / 1.4))
            for k in range(n_strips):
                f0 = (k + 0.06) / n_strips
                f1 = (k + 0.94) / n_strips
                mid_f = 0.5 * (f0 + f1)
                strip_w = (f1 - f0) * elen + 0.18
                # Natural climbing ivy silhouette: fuller near right/top eaves and ground base
                wave = 0.72 + 0.28 * math.sin(mid_f * math.pi * 1.4 + 0.5)
                h_strip = min(wall_h + 0.15, wall_h * wave)
                zc = z_top - h_strip * 0.48
                px = x0 + (x1 - x0) * mid_f + nx * 0.12
                py = y0 + (y1 - y0) * mid_f + ny * 0.12
                self.add_box(
                    Vector((px, py, zc)), u_vec, v_vec,
                    sx=strip_w, sy=0.22, sz=h_strip,
                    mat_key="ivy_foliage", uv_scale=1.8,
                )

    def add_dark_balconies(
        self,
        pts: List[Tuple[float, float]],
        z_base: float,
        z_eave: float,
        balcony_dir_blender: Tuple[float, float],
        balcony_mat: str = "trim_wood",
        balcony_w: Optional[float] = None,
    ):
        """Add stacked Pfalz timber/white balconies on the specified facade (Neugasse QOR1, Triftstr #6, Kirchrain #7/#16/#18)."""
        dx_t, dy_t = balcony_dir_blender
        dlen = math.hypot(dx_t, dy_t)
        if dlen < 1e-4:
            return
        tx, ty = dx_t / dlen, dy_t / dlen
        best_e = None
        best_score = 0.0
        n = len(pts)
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            elen = math.hypot(x1 - x0, y1 - y0)
            if elen < 4.5:
                continue
            ex, ey = (x1 - x0) / elen, (y1 - y0) / elen
            nx, ny = ey, -ex
            score = (nx * tx + ny * ty) * elen
            if score > best_score:
                best_score = score
                best_e = (x0, y0, x1, y1, ex, ey, nx, ny, elen)
        if not best_e:
            return
        x0, y0, x1, y1, ex, ey, nx, ny, elen = best_e
        u_vec = Vector((ex, ey, 0.0))
        v_vec = Vector((nx, ny, 0.0))
        bw = min(elen * 0.62, balcony_w if balcony_w is not None else 7.6)
        bd = 1.25
        mx, my = 0.5 * (x0 + x1) + nx * (bd * 0.5), 0.5 * (y0 + y1) + ny * (bd * 0.5)
        for bz in (z_base + 3.05, z_base + 5.75):
            if bz > z_eave + 0.5:
                continue
            self.add_box(Vector((mx, my, bz)), u_vec, v_vec, sx=bw, sy=bd, sz=0.22, mat_key=balcony_mat, uv_scale=2.0)
            front_c = Vector((mx + nx * (bd * 0.45), my + ny * (bd * 0.45), bz + 0.56))
            self.add_box(front_c, u_vec, v_vec, sx=bw, sy=0.12, sz=0.92, mat_key=balcony_mat, uv_scale=2.0)
            for sgn in (-1.0, 1.0):
                sc = Vector((mx + ex * sgn * (bw * 0.48), my + ey * sgn * (bw * 0.48), bz + 0.56))
                self.add_box(sc, u_vec, v_vec, sx=0.14, sy=bd, sz=0.92, mat_key=balcony_mat, uv_scale=2.0)

    def add_facade_wall_ring(
        self,
        pts: List[Tuple[float, float]],
        z_bot: float,
        z_eave: float,
        wall_mat: str,
        is_windowed: bool = True,
    ):
        """Extrude footprint walls with clean integer-bay & integer-story metric UVs (zero half-cut windows!)."""
        n = len(pts)
        wall_h = max(0.5, z_eave - z_bot)
        # Snap vertical UV count to clean integer stories for windowed facades (1 story = 2.95m)
        if is_windowed:
            n_stories = max(1, int(round(wall_h / 2.95)))
            v_span = float(n_stories)
        else:
            v_span = wall_h / 3.0

        plain_tile_mats = {
            "wall_barn", "wall_utility", "wall_peach_plain", "wall_brick_barn_yellow",
            "wall_timber_vertical", "wall_fachwerk_yellow", "wall_fachwerk_white",
            "wall_limestone_brick", "wall_rubble_barn", "wall_mustard_porthole",
        }
        use_plain_stucco_strip = (not is_windowed) and (wall_mat not in plain_tile_mats)

        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            elen = math.hypot(x1 - x0, y1 - y0)
            if elen < 0.08:
                continue
            if use_plain_stucco_strip:
                # Windowless stucco garage/shed using a windowed wall palette -> sample ONLY clean stucco strip [0.005..0.095]!
                u0, u1 = 0.005, 0.095
            elif is_windowed:
                if elen < 2.1:
                    # Narrow wall jog -> map purely into clean stucco border [0.00..0.10]!
                    u0, u1 = 0.0, 0.10
                else:
                    # Snap to integer window bays (each bay = 0.5 U = 3.0m) -> NEVER slices windows!
                    n_bays = max(1, int(round(elen / 3.0)))
                    u0, u1 = 0.0, n_bays * 0.5
            else:
                u0, u1 = 0.0, elen / 6.0

            self.add_quad(
                (x0, y0, z_bot), (x1, y1, z_bot), (x1, y1, z_eave), (x0, y0, z_eave),
                ((u0, 0.0), (u1, 0.0), (u1, v_span), (u0, v_span)),
                wall_mat,
            )

    def add_gabled_roof_wing(
        self,
        center_xy: Tuple[float, float],
        u_axis: Tuple[float, float],
        v_axis: Tuple[float, float],
        len_u: float,
        len_v: float,
        z_eave: float,
        roof_h: float,
        wall_mat: str,
        roof_mat: str,
        overhang_eave: float = 0.36,
        overhang_gable: float = 0.28,
        slab_thick: float = 0.17,
        add_gable_walls: bool = True,
        add_chimney: bool = False,
        add_dormer: bool = False,
        seed: int = 0,
        gable_wall_mat: Optional[str] = None,
        dormer_mat: Optional[str] = None,
        solar_pv_dir: Optional[Tuple[float, float]] = None,
        ivy_dir: Optional[Tuple[float, float]] = None,
        dormer_dir: Optional[Tuple[float, float]] = None,
        fascia_mat: str = "trim_wood",
        no_attic_window: bool = False,
    ):
        """Build a watertight gabled roof wing (Satteldach) with gable walls, thick overhang slabs, gutters, ridge cap, chimney, dormer, solar PV & ivy."""
        cx, cy = center_xy
        ux, uy = u_axis
        vx, vy = v_axis
        u_vec = Vector((ux, uy, 0.0))
        v_vec = Vector((vx, vy, 0.0))
        c_vec = Vector((cx, cy, 0.0))

        hu = len_u * 0.5
        hv = len_v * 0.5
        slope_ratio = roof_h / max(hv, 0.4)
        eave_drop = overhang_eave * slope_ratio

        def wpt(du, dv, z):
            return c_vec + u_vec * du + v_vec * dv + Vector((0.0, 0.0, z))

        g_mat = gable_wall_mat or wall_mat

        # 1. Gable End Triangles at du = -hu and du = +hu
        if add_gable_walls:
            full_clad_mats = {
                "wall_timber_vertical", "wall_fachwerk_yellow", "wall_fachwerk_white",
                "wall_brick_barn_yellow", "wall_limestone_brick", "wall_rubble_barn",
                "wall_peach_plain", "wall_utility", "wall_mustard_porthole",
            }
            is_stucco_wall = g_mat.startswith("wall_") and g_mat not in (full_clad_mats | {"wall_barn"})
            if g_mat == "wall_barn":
                uv_plain = ((0.29, 0.10), (0.48, 0.10), (0.385, 0.44))
            elif g_mat in full_clad_mats:
                # Full proportional metric UV for timber cladding, half-timbered Fachwerk, or brick barns!
                gu = len_v / 4.5
                gv = roof_h / 3.0
                uv_plain = ((0.0, 0.0), (gu, 0.0), (gu * 0.5, gv))
            else:
                uv_plain = ((0.005, 0.05), (0.095, 0.05), (0.05, 0.92))
            for sign_u in (-1.0, 1.0):
                du = sign_u * hu
                p_left = wpt(du, -hv, z_eave)
                p_right = wpt(du, hv, z_eave)
                p_peak = wpt(du, 0.0, z_eave + roof_h)
                if sign_u > 0:
                    self.add_tri(p_left, p_right, p_peak, uv_plain, g_mat)
                else:
                    self.add_tri(p_right, p_left, p_peak, uv_plain, g_mat)

                # Climbing green ivy across gable triangle if facing ivy_dir!
                if ivy_dir is not None:
                    gnx, gny = sign_u * ux, sign_u * uy
                    id_len = math.hypot(ivy_dir[0], ivy_dir[1])
                    if id_len > 1e-4 and (gnx * ivy_dir[0] + gny * ivy_dir[1]) / id_len > 0.45:
                        du_iv = du + sign_u * 0.14
                        p_l_iv = wpt(du_iv, -hv * 0.88, z_eave - 0.10)
                        p_r_iv = wpt(du_iv, hv * 0.88, z_eave - 0.10)
                        p_p_iv = wpt(du_iv, 0.0, z_eave + roof_h * 0.92)
                        gu_i = len_v / 2.2
                        gv_i = roof_h / 2.2
                        if sign_u > 0:
                            self.add_tri(p_l_iv, p_r_iv, p_p_iv, ((0, 0), (gu_i, 0), (gu_i * 0.5, gv_i)), "ivy_foliage")
                        else:
                            self.add_tri(p_r_iv, p_l_iv, p_p_iv, ((0, 0), (gu_i, 0), (gu_i * 0.5, gv_i)), "ivy_foliage")
                        # Lush volumetric ivy tufts near gable base & corners
                        for dv_f in (-0.52, -0.18, 0.18, 0.52):
                            h_here = roof_h * (1.0 - abs(dv_f)) * 0.82
                            if h_here > 0.45:
                                self.add_box(
                                    wpt(du + sign_u * 0.14, dv_f * hv, z_eave + h_here * 0.46),
                                    u_vec, v_vec, sx=0.22, sy=len_v * 0.22, sz=h_here,
                                    mat_key="ivy_foliage", uv_scale=1.8,
                                )

                # Human-scale centered Palatinate attic gable window
                if (not no_attic_window) and is_stucco_wall and len_v >= 5.2 and roof_h >= 2.2:
                    aw = min(1.18, len_v * 0.20)
                    ah = min(1.28, roof_h * 0.42)
                    zc_win = z_eave + roof_h * 0.34
                    max_half_w_at_top = hv * max(0.0, 1.0 - ((zc_win + ah * 0.5) - z_eave) / max(roof_h, 0.5)) - 0.35
                    if max_half_w_at_top >= aw * 0.5:
                        du_out = du + sign_u * 0.035
                        z0_w, z1_w = zc_win - ah * 0.5, zc_win + ah * 0.5
                        uv_win = ((0.148, 0.18), (0.352, 0.18), (0.352, 0.78), (0.148, 0.78))
                        if sign_u > 0:
                            self.add_quad(
                                wpt(du_out, -aw * 0.5, z0_w),
                                wpt(du_out, aw * 0.5, z0_w),
                                wpt(du_out, aw * 0.5, z1_w),
                                wpt(du_out, -aw * 0.5, z1_w),
                                uv_win, g_mat,
                            )
                        else:
                            self.add_quad(
                                wpt(du_out, aw * 0.5, z0_w),
                                wpt(du_out, -aw * 0.5, z0_w),
                                wpt(du_out, -aw * 0.5, z1_w),
                                wpt(du_out, aw * 0.5, z1_w),
                                uv_win, g_mat,
                            )

        # 2. Thick Overhanging Roof Slabs (left slope dv < 0, right slope dv > 0)
        hu_o = hu + overhang_gable
        hv_o = hv + overhang_eave
        z_ridge = z_eave + roof_h
        z_eave_o = z_eave - eave_drop
        slope_len = math.hypot(hv_o, z_ridge - z_eave_o)
        tile_u = (2.0 * hu_o) / 4.0
        tile_v = slope_len / 4.0

        for side in (-1.0, 1.0):
            r0_t = wpt(-hu_o, 0.0, z_ridge + slab_thick)
            r1_t = wpt(hu_o, 0.0, z_ridge + slab_thick)
            e0_t = wpt(-hu_o, side * hv_o, z_eave_o + slab_thick)
            e1_t = wpt(hu_o, side * hv_o, z_eave_o + slab_thick)

            r0_b = wpt(-hu_o, 0.0, z_ridge)
            r1_b = wpt(hu_o, 0.0, z_ridge)
            e0_b = wpt(-hu_o, side * hv_o, z_eave_o)
            e1_b = wpt(hu_o, side * hv_o, z_eave_o)

            if side > 0:
                self.add_quad(e0_t, r0_t, r1_t, e1_t, ((0, 0), (0, tile_v), (tile_u, tile_v), (tile_u, 0)), roof_mat)
                self.add_quad(r0_b, e0_b, e1_b, r1_b, ((0, 0), (0, 1), (1, 1), (1, 0)), fascia_mat)
                self.add_quad(e0_b, e0_t, e1_t, e1_b, ((0, 0), (0, 0.2), (tile_u, 0.2), (tile_u, 0)), fascia_mat)
                self.add_quad(r0_b, r0_t, e0_t, e0_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), fascia_mat)
                self.add_quad(e1_b, e1_t, r1_t, r1_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), fascia_mat)
            else:
                self.add_quad(e1_t, r1_t, r0_t, e0_t, ((0, 0), (0, tile_v), (tile_u, tile_v), (tile_u, 0)), roof_mat)
                self.add_quad(r1_b, e1_b, e0_b, r0_b, ((0, 0), (0, 1), (1, 1), (1, 0)), fascia_mat)
                self.add_quad(e1_b, e1_t, e0_t, e0_b, ((0, 0), (0, 0.2), (tile_u, 0.2), (tile_u, 0)), fascia_mat)
                self.add_quad(e0_b, e0_t, r0_t, r0_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), fascia_mat)
                self.add_quad(r1_b, r1_t, e1_t, e1_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), fascia_mat)

            # Galvanized zinc rainwater gutter (Regenrinne) along eave!
            if len_u >= 5.0 and overhang_eave >= 0.25:
                self.add_box(
                    wpt(0.0, side * (hv_o + 0.055), z_eave_o + 0.05),
                    u_vec, v_vec, sx=2.0 * hu_o + 0.04, sy=0.09, sz=0.09,
                    mat_key="gutter_metal", uv_scale=2.0,
                )

            # Rooftop Photovoltaic Solar PV Array mounted proud on target slope!
            if solar_pv_dir is not None:
                snx, sny = side * vx, side * vy
                sd_len = math.hypot(solar_pv_dir[0], solar_pv_dir[1])
                if sd_len > 1e-4 and (snx * solar_pv_dir[0] + sny * solar_pv_dir[1]) / sd_len > 0.35:
                    # Inset solar array slightly from gable edges & eave/ridge
                    u_pad = min(0.55, hu * 0.12)
                    t_lo, t_hi = 0.12, 0.90  # Fraction up slope from eave to ridge
                    dz_pv = 0.11  # Proud mounting rail clearance
                    def pv_pt(du_val, frac):
                        dv_val = side * hv_o * (1.0 - frac)
                        zz = (z_eave_o + slab_thick) * (1.0 - frac) + (z_ridge + slab_thick) * frac + dz_pv
                        return wpt(du_val, dv_val, zz)
                    p_e0 = pv_pt(-(hu_o - u_pad), t_lo)
                    p_e1 = pv_pt(hu_o - u_pad, t_lo)
                    p_r0 = pv_pt(-(hu_o - u_pad), t_hi)
                    p_r1 = pv_pt(hu_o - u_pad, t_hi)
                    pv_u = max(1.0, (2.0 * (hu_o - u_pad)) / 3.4)
                    pv_v = max(1.0, (slope_len * (t_hi - t_lo)) / 3.0)
                    if side > 0:
                        self.add_quad(p_e0, p_r0, p_r1, p_e1, ((0, 0), (0, pv_v), (pv_u, pv_v), (pv_u, 0)), "solar_pv")
                    else:
                        self.add_quad(p_e1, p_r1, p_r0, p_e0, ((0, 0), (0, pv_v), (pv_u, pv_v), (pv_u, 0)), "solar_pv")

        # 3. Crisp 3D Ridge Cap Beam along du in [-hu_o, +hu_o]
        self.add_box(
            wpt(0.0, 0.0, z_ridge + slab_thick + 0.05),
            u_vec, v_vec,
            sx=2.0 * hu_o + 0.06, sy=0.24, sz=0.14,
            mat_key=roof_mat, uv_scale=4.0,
        )

        # 4. Brick/Sandstone Chimney rising cleanly above ridge
        if add_chimney and len_u >= 5.0 and len_v >= 4.0:
            ch_u = ((seed % 5) - 2) * (hu * 0.26)
            ch_v = (0.28 if (seed % 2 == 0) else -0.28) * min(hv * 0.45, 1.2)
            ch_base_z = z_eave + roof_h * (1.0 - abs(ch_v) / max(hv, 0.5)) - 0.35
            ch_top_z = z_ridge + slab_thick + 0.88
            ch_h = max(1.1, ch_top_z - ch_base_z)
            self.add_box(
                wpt(ch_u, ch_v, ch_base_z + ch_h * 0.5),
                u_vec, v_vec, sx=0.56, sy=0.56, sz=ch_h,
                mat_key="plinth", uv_scale=2.0,
            )
            self.add_box(
                wpt(ch_u, ch_v, ch_top_z + 0.05),
                u_vec, v_vec, sx=0.68, sy=0.68, sz=0.10,
                mat_key="trim_wood", uv_scale=1.0,
            )

        # 5. Classic Pfalz Roof Dormer (Gaube) on larger residential houses
        if add_dormer and len_u >= 8.5 and len_v >= 6.4 and roof_h >= 2.6:
            d_mat = dormer_mat or wall_mat
            n_dormers = 2 if (len_u >= 14.0 and dormer_mat is None and dormer_dir is None) else 1
            d_offsets = [-hu * 0.38, hu * 0.38] if n_dormers == 2 else [0.0]
            if dormer_dir is not None:
                d_side = 1.0 if (vx * dormer_dir[0] + vy * dormer_dir[1]) >= 0 else -1.0
                dw, dd, dh = 2.3, 2.0, 1.55
            elif dormer_mat is not None:
                d_side = 1.0 if vy < 0 else -1.0
                dw, dd, dh = 2.6, 2.2, 1.65
            else:
                d_side = 1.0 if (seed % 2 == 0) else -1.0
                dw, dd, dh = 1.65, 1.85, 1.35
            for du_d in d_offsets:
                dv_front = d_side * (hv * 0.58)
                dv_center = dv_front - d_side * (dd * 0.42)
                z_d_bot = z_eave + roof_h * (1.0 - abs(dv_front) / max(hv, 0.5)) - 0.14
                d_front_c = wpt(du_d, dv_center, z_d_bot + dh * 0.5)
                self.add_box(d_front_c, u_vec, v_vec, sx=dw, sy=dd, sz=dh, mat_key=d_mat, uv_scale=3.0)
                self.add_gabled_roof_wing(
                    center_xy=(d_front_c.x, d_front_c.y),
                    u_axis=(v_vec.x * d_side, v_vec.y * d_side),
                    v_axis=(-v_vec.y * d_side, v_vec.x * d_side),
                    len_u=dd + 0.15,
                    len_v=dw + 0.10,
                    z_eave=z_d_bot + dh,
                    roof_h=0.95 if dormer_mat else 0.68,
                    wall_mat=d_mat,
                    roof_mat=roof_mat,
                    overhang_eave=0.16,
                    overhang_gable=0.18,
                    slab_thick=0.10,
                    add_gable_walls=True,
                    add_chimney=False,
                    add_dormer=False,
                    gable_wall_mat=d_mat,
                )

    def add_hipped_roof_obb(
        self,
        obb: Dict,
        z_eave: float,
        roof_h: float,
        roof_mat: str,
        overhang: float = 0.36,
        slab_thick: float = 0.16,
        add_chimney: bool = False,
        seed: int = 0,
    ):
        """Classic Pfalz hipped roof (Walmdach / Zeltdach) with thick fascia & ridge cap."""
        cx, cy = obb["center"]
        ux, uy = obb["u_axis"]
        vx, vy = obb["v_axis"]
        u_vec = Vector((ux, uy, 0.0))
        v_vec = Vector((vx, vy, 0.0))
        c_vec = Vector((cx, cy, 0.0))

        hu = obb["len_u"] * 0.5 + overhang
        hv = obb["len_v"] * 0.5 + overhang
        # Inset ridge length so hip faces slope around ~40-45 deg cleanly
        ridge_half = max(0.0, hu - hv * 0.92)
        z_bot = z_eave - 0.10
        z_top = z_eave + slab_thick
        z_ridge = z_eave + roof_h + slab_thick

        def wpt(du, dv, z):
            return c_vec + u_vec * du + v_vec * dv + Vector((0.0, 0.0, z))

        # 4 eaves corners (bottom fascia + top roof edge)
        b0 = wpt(-hu, -hv, z_bot)
        b1 = wpt(hu, -hv, z_bot)
        b2 = wpt(hu, hv, z_bot)
        b3 = wpt(-hu, hv, z_bot)
        t0 = wpt(-hu, -hv, z_top)
        t1 = wpt(hu, -hv, z_top)
        t2 = wpt(hu, hv, z_top)
        t3 = wpt(-hu, hv, z_top)

        # Soffit bottom & vertical fascia band
        self.add_quad(b3, b2, b1, b0, ((0, 0), (1, 0), (1, 1), (0, 1)), "trim_wood")
        for p0, p1, q1, q0 in [(b0, b1, t1, t0), (b1, b2, t2, t1), (b2, b3, t3, t2), (b3, b0, t0, t3)]:
            self.add_quad(p0, p1, q1, q0, ((0, 0), (2, 0), (2, 0.2), (0, 0.2)), "trim_wood")

        slope_v = math.hypot(hv, roof_h) / 4.0
        u_full = (2.0 * hu) / 4.0
        u_r0 = (hu - ridge_half) / 4.0
        u_r1 = (hu + ridge_half) / 4.0

        if ridge_half < 0.25:
            # Pyramid roof (Zeltdach) for square houses
            apex = wpt(0.0, 0.0, z_ridge)
            for p0, p1 in [(t0, t1), (t1, t2), (t2, t3), (t3, t0)]:
                elen = (p1 - p0).length / 4.0
                self.add_tri(p0, p1, apex, ((0, 0), (elen, 0), (elen * 0.5, slope_v)), roof_mat)
        else:
            r0 = wpt(-ridge_half, 0.0, z_ridge)
            r1 = wpt(ridge_half, 0.0, z_ridge)
            # 2 trapezoidal side slopes
            self.add_quad(t0, t1, r1, r0, ((0, 0), (u_full, 0), (u_r1, slope_v), (u_r0, slope_v)), roof_mat)
            self.add_quad(t2, t3, r0, r1, ((0, 0), (u_full, 0), (u_r1, slope_v), (u_r0, slope_v)), roof_mat)
            # 2 triangular hip ends
            hv_u = (2.0 * hv) / 4.0
            hip_slope = math.hypot(hu - ridge_half, roof_h) / 4.0
            self.add_tri(t1, t2, r1, ((0, 0), (hv_u, 0), (hv_u * 0.5, hip_slope)), roof_mat)
            self.add_tri(t3, t0, r0, ((0, 0), (hv_u, 0), (hv_u * 0.5, hip_slope)), roof_mat)
            # Ridge cap beam
            self.add_box(wpt(0.0, 0.0, z_ridge + 0.05), u_vec, v_vec, sx=2.0 * ridge_half + 0.2, sy=0.22, sz=0.13, mat_key=roof_mat, uv_scale=4.0)

        if add_chimney:
            ch_u = (ridge_half * 0.35) * (1 if seed % 2 == 0 else -1)
            self.add_box(wpt(ch_u, 0.35, z_ridge + 0.25), u_vec, v_vec, sx=0.55, sy=0.55, sz=1.25, mat_key="plinth", uv_scale=2.0)
            self.add_box(wpt(ch_u, 0.35, z_ridge + 0.92), u_vec, v_vec, sx=0.66, sy=0.66, sz=0.09, mat_key="trim_wood", uv_scale=1.0)

    def add_polygon_hipped_roof(self, pts: List[Tuple[float, float]], z_eave: float, roof_h: float, roof_mat: str):
        """Guaranteed watertight pitched roof for ANY arbitrary non-rectangular/irregular polygon."""
        outer = offset_polygon_outward(pts, 0.28)
        n = len(outer)
        # Compute interior pole/centroid (average of vertices clamped inside polygon)
        cx = sum(p[0] for p in pts) / n
        cy = sum(p[1] for p in pts) / n
        if not point_in_polygon(cx, cy, pts):
            # Fallback to midpoint of longest interior chord via tessellation
            vecs = [Vector((p[0], p[1], 0.0)) for p in pts]
            tris = tessellate_polygon([vecs])
            if tris:
                best_t = max(tris, key=lambda t: abs((vecs[t[1]] - vecs[t[0]]).cross(vecs[t[2]] - vecs[t[0]]).z))
                cx = (vecs[best_t[0]].x + vecs[best_t[1]].x + vecs[best_t[2]].x) / 3.0
                cy = (vecs[best_t[0]].y + vecs[best_t[1]].y + vecs[best_t[2]].y) / 3.0

        # Fascia rim around outer overhang
        z_bot = z_eave - 0.08
        z_top = z_eave + 0.14
        for i in range(n):
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            self.add_quad((x0, y0, z_bot), (x1, y1, z_bot), (x1, y1, z_top), (x0, y0, z_top),
                          ((0, 0), (1, 0), (1, 0.2), (0, 0.2)), "trim_wood")

        # Tessellate outer polygon and lift an inward-shrunk ring + centroid to create true sloped hip roof!
        vecs = [Vector((p[0], p[1], 0.0)) for p in outer]
        tris = tessellate_polygon([vecs])
        # Build clean pitched roof triangles using boundary-distance elevation on vertices + centroid peak
        apex = (cx, cy, z_top + roof_h)
        # Check if star-shaped from (cx, cy); if yes, crisp radial fan; else tessellated cap + slight ridge lift
        is_star = True
        for i in range(n):
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            # Cross product (p1-p0) x (apex-p0) must be > 0 for CCW star-shaped
            if (x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0) <= 0.01:
                is_star = False
                break

        if is_star:
            for i in range(n):
                x0, y0 = outer[i]
                x1, y1 = outer[(i + 1) % n]
                elen = math.hypot(x1 - x0, y1 - y0)
                slope = math.hypot(math.hypot(0.5 * (x0 + x1) - cx, 0.5 * (y0 + y1) - cy), roof_h)
                self.add_tri(
                    (x0, y0, z_top), (x1, y1, z_top), apex,
                    ((0, 0), (elen / 4.0, 0), (elen / 8.0, slope / 4.0)),
                    roof_mat,
                )
        else:
            # Safe fallback for non-star polygons: clean tiled roof cap without floating gray utility boxes!
            for t in tris:
                p0, p1, p2 = outer[t[0]], outer[t[1]], outer[t[2]]
                self.add_tri(
                    (p0[0], p0[1], z_top), (p1[0], p1[1], z_top), (p2[0], p2[1], z_top),
                    ((p0[0] / 4.0, p0[1] / 4.0), (p1[0] / 4.0, p1[1] / 4.0), (p2[0] / 4.0, p2[1] / 4.0)),
                    roof_mat,
                )

    def add_skillion_roof(self, obb: Dict, z_eave: float, roof_h: float, wall_mat: str, roof_mat: str, overhang: float = 0.26, fascia_mat: str = "trim_wood"):
        """Mono-pitch shed/garage roof with clean slope walls & overhang fascia."""
        cx, cy = obb["center"]
        ux, uy = obb["u_axis"]
        vx, vy = obb["v_axis"]
        u_vec = Vector((ux, uy, 0.0))
        v_vec = Vector((vx, vy, 0.0))
        c_vec = Vector((cx, cy, 0.0))
        hu = obb["len_u"] * 0.5
        hv = obb["len_v"] * 0.5

        def wpt(du, dv, z):
            return c_vec + u_vec * du + v_vec * dv + Vector((0.0, 0.0, z))

        # High wall along -hv, low along +hv
        # Add triangular side spandrels + raised rear wall
        self.add_quad(
            wpt(-hu, -hv, z_eave), wpt(hu, -hv, z_eave),
            wpt(hu, -hv, z_eave + roof_h), wpt(-hu, -hv, z_eave + roof_h),
            ((0, 0), (0.1, 0), (0.1, 0.4), (0, 0.4)), wall_mat,
        )
        self.add_tri(wpt(hu, -hv, z_eave), wpt(hu, hv, z_eave), wpt(hu, -hv, z_eave + roof_h), ((0, 0), (0.1, 0), (0, 0.4)), wall_mat)
        self.add_tri(wpt(-hu, hv, z_eave), wpt(-hu, -hv, z_eave), wpt(-hu, -hv, z_eave + roof_h), ((0, 0), (0.1, 0), (0, 0.4)), wall_mat)

        hu_o = hu + overhang
        hv_o = hv + overhang
        thick = 0.16 if fascia_mat != "trim_wood" else 0.14
        z_hi = z_eave + roof_h + 0.05
        z_lo = z_eave - 0.06
        slope_l = math.hypot(2.0 * hv_o, z_hi - z_lo) / 4.0
        u_len = (2.0 * hu_o) / 4.0

        p0 = wpt(-hu_o, -hv_o, z_hi + thick)
        p1 = wpt(hu_o, -hv_o, z_hi + thick)
        p2 = wpt(hu_o, hv_o, z_lo + thick)
        p3 = wpt(-hu_o, hv_o, z_lo + thick)
        self.add_quad(p3, p2, p1, p0, ((0, 0), (u_len, 0), (u_len, slope_l), (0, slope_l)), roof_mat)

        b0 = wpt(-hu_o, -hv_o, z_hi)
        b1 = wpt(hu_o, -hv_o, z_hi)
        b2 = wpt(hu_o, hv_o, z_lo)
        b3 = wpt(-hu_o, hv_o, z_lo)
        self.add_quad(b0, b1, b2, b3, ((0, 0), (1, 0), (1, 1), (0, 1)), fascia_mat)
        for q0, q1, r1, r0 in [(b0, b1, p1, p0), (b1, b2, p2, p1), (b2, b3, p3, p2), (b3, b0, p0, p3)]:
            self.add_quad(q0, q1, r1, r0, ((0, 0), (1, 0), (1, 0.2), (0, 0.2)), fascia_mat)

    def add_flat_parapet_roof(self, pts: List[Tuple[float, float]], z_eave: float, wall_mat: str, roof_mat: str):
        """Architectural flat roof with crisp raised parapet wall (Attika), dark coping rim, and textured roof slab."""
        n = len(pts)
        parapet_h = 0.28
        z_parapet = z_eave + parapet_h
        # Raised parapet outer wall (plain stucco border)
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            self.add_quad(
                (x0, y0, z_eave), (x1, y1, z_eave), (x1, y1, z_parapet), (x0, y0, z_parapet),
                ((0.0, 0.0), (0.08, 0.0), (0.08, 0.12), (0.0, 0.12)), wall_mat,
            )
        # Slightly proud dark metal coping cap around perimeter
        outer = offset_polygon_outward(pts, 0.07)
        for i in range(n):
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            self.add_quad(
                (x0, y0, z_parapet - 0.04), (x1, y1, z_parapet - 0.04),
                (x1, y1, z_parapet + 0.06), (x0, y0, z_parapet + 0.06),
                ((0, 0), (1, 0), (1, 0.1), (0, 0.1)), "trim_wood",
            )
        # Tessellated roof deck surface slightly recessed inside parapet
        vecs = [Vector((p[0], p[1], 0.0)) for p in outer]
        tris = tessellate_polygon([vecs])
        for t in tris:
            p0, p1, p2 = outer[t[0]], outer[t[1]], outer[t[2]]
            self.add_tri(
                (p0[0], p0[1], z_parapet + 0.05),
                (p1[0], p1[1], z_parapet + 0.05),
                (p2[0], p2[1], z_parapet + 0.05),
                ((p0[0] / 4.0, p0[1] / 4.0), (p1[0] / 4.0, p1[1] / 4.0), (p2[0] / 4.0, p2[1] / 4.0)),
                roof_mat,
            )

    def add_door_or_gate(self, pts: List[Tuple[float, float]], z_ground: float, z_eave: float, is_barn: bool, seed: int):
        """Attach a crisp 3D framed German Haustür (or double wooden Barn Gate) on the longest straight facade wall."""
        n = len(pts)
        # Pick longest wall edge
        best_i = -1
        best_len = 0.0
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            l = math.hypot(x1 - x0, y1 - y0)
            if l > best_len:
                best_len = l
                best_i = i
        if best_i < 0 or best_len < (4.2 if is_barn else 3.2):
            return

        x0, y0 = pts[best_i]
        x1, y1 = pts[(best_i + 1) % n]
        e = Vector((x1 - x0, y1 - y0, 0.0)).normalized()
        nrm = Vector((e.y, -e.x, 0.0))  # Outward normal for CCW polygon

        # Place offset cleanly along wall (slightly off-center or centered)
        t = 0.5 if is_barn else (0.34 if seed % 2 == 0 else 0.66)
        mid = Vector((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.0))

        if is_barn:
            dw = min(3.1, best_len * 0.48)
            dh = min(3.2, max(2.2, (z_eave - z_ground) - 0.45))
            mat_k = "barn_gate"
            z0 = z_ground + 0.06
        else:
            dw = 1.25
            dh = min(2.25, max(1.9, (z_eave - z_ground) - 0.50))
            mat_k = "door_wood"
            z0 = z_ground + 0.28
            # Sandstone entrance step!
            self.add_box(
                mid + nrm * 0.22 + Vector((0, 0, z_ground + 0.14)),
                e, nrm, sx=dw + 0.40, sy=0.44, sz=0.28,
                mat_key="plinth", uv_scale=2.0,
            )

        # Slightly proud door/gate frame panel (0.07m proud of facade -> zero z-fighting!)
        p_bl = mid - e * (dw * 0.5) + nrm * 0.07 + Vector((0, 0, z0))
        p_br = mid + e * (dw * 0.5) + nrm * 0.07 + Vector((0, 0, z0))
        p_tr = p_br + Vector((0, 0, dh))
        p_tl = p_bl + Vector((0, 0, dh))
        self.add_quad(p_bl, p_br, p_tr, p_tl, ((0, 0), (1, 0), (1, 1), (0, 1)), mat_k)

        # Side reveal jambs connecting back to wall
        b_bl = p_bl - nrm * 0.07
        b_br = p_br - nrm * 0.07
        b_tr = p_tr - nrm * 0.07
        b_tl = p_tl - nrm * 0.07
        self.add_quad(b_bl, p_bl, p_tl, b_tl, ((0, 0), (0.1, 0), (0.1, 1), (0, 1)), "plinth")
        self.add_quad(p_br, b_br, b_tr, p_tr, ((0, 0), (0.1, 0), (0.1, 1), (0, 1)), "plinth")
        self.add_quad(p_tl, b_tl, b_tr, p_tr, ((0, 0), (0.1, 0), (0.1, 1), (0, 1)), "plinth")

    def build_building(self, bld: Dict):
        """Construct one complete realistic Kindenheim village building directly in world space."""
        raw_fp = bld.get("footprint", [])
        if len(raw_fp) < 3:
            return False
        # Convert Three.js [x, z] -> Blender (x, -z)
        pts = clean_polygon_2d([(p[0], -p[1]) for p in raw_fp])
        if len(pts) < 3:
            return False
        poly_area = abs(signed_area_2d(pts))
        if poly_area < 4.0:
            return False

        obb = compute_min_obb(pts)
        rectangularity = poly_area / max(obb["area"], 1e-4)

        bid = str(bld.get("id", "0"))
        h = stable_hash_int(bid)
        ov = bld.get("override") or BUILDING_OVERRIDES.get(bid) or {}
        if ov.get("skip"):
            return False

        if ov.get("rotate_ridge_90"):
            ux_old, uy_old = obb["u_axis"]
            vx_old, vy_old = obb["v_axis"]
            obb["u_axis"] = (vx_old, vy_old)
            obb["v_axis"] = (-ux_old, -uy_old)
            obb["len_u"], obb["len_v"] = obb["len_v"], obb["len_u"]

        # Determine building category & Palatinate architectural parameters
        cat = str(bld.get("category", "")).lower()
        btype = str(bld.get("building", bld.get("tags", {}).get("building", ""))).lower()
        z_base = float(bld.get("baseElevationM", 0.0))

        is_barn = (
            cat in ("barn", "agricultural", "farm", "winery_barn")
            or btype in ("barn", "farm_auxiliary", "stable", "cowshed", "agricultural", "warehouse")
            or (poly_area > 180.0 and btype in ("yes", "") and float(bld.get("levels", 1) or 1) <= 1.5 and obb["len_u"] / max(obb["len_v"], 1.0) > 1.7)
        )
        is_utility = (
            not is_barn
            and (
                cat in ("garage", "shed", "utility", "outbuilding")
                or btype in ("garage", "garages", "shed", "carport", "hut", "greenhouse", "roof")
                or poly_area < 34.0
            )
        )

        # Wall height & roof height directly from official 2026 RLP LoD2 CityGML (with override + spike/sliver clamps!)
        roof_shape_tag = str(ov.get("roof_shape", bld.get("roofShape", ""))).lower()
        wall_h_raw = ov.get("wall_h", bld.get("wallHeightM"))
        if wall_h_raw is None or float(wall_h_raw) < 1.8:
            levels = float(bld.get("levels") or 0)
            if levels >= 1:
                wall_h = levels * 2.95 + 0.35
            elif is_utility:
                wall_h = 2.65
            elif is_barn:
                wall_h = 4.6 + (h % 3) * 0.45
            else:
                wall_h = 5.9 if poly_area >= 68.0 else 3.6
        else:
            wall_h = float(wall_h_raw)
        wall_h = max(2.2, min(16.0, wall_h))

        roof_h_raw = ov.get("roof_h", bld.get("roofHeightM"))
        is_sliver = (obb["len_v"] < 2.6 and not ov)
        is_true_flat = (
            roof_shape_tag == "flat"
            and (roof_h_raw is None or float(roof_h_raw) < 0.35)
        )
        if is_sliver and obb["len_v"] < 1.85 and roof_shape_tag != "flat":
            # Prevent bizarre knife-blade gables on narrow LoD2 sliver polygons (< 1.85m wide)!
            roof_shape_tag = "skillion"
        if is_true_flat:
            roof_h = 0.0
        elif roof_h_raw is None or float(roof_h_raw) < 0.3:
            half_span = min(obb["len_v"] * 0.5, 6.5)
            if is_utility or is_sliver:
                roof_h = max(0.45, min(1.15, half_span * 0.35))
            elif is_barn:
                roof_h = max(2.0, min(4.6, half_span * 0.72))
            else:
                pitch_tan = 0.68 + ((h >> 4) % 5) * 0.04
                roof_h = max(1.5, min(4.6, half_span * pitch_tan))
        else:
            roof_h = float(roof_h_raw)

        if not is_true_flat:
            # Global artifact cleanup: clamp narrow slivers & prevent impossible >50 deg LoD2 needle spikes!
            half_span = max(0.4, obb["len_v"] * 0.5)
            if is_sliver:
                roof_h = min(roof_h, max(0.35, obb["len_v"] * 0.32))
            elif roof_shape_tag == "skillion":
                roof_h = min(roof_h, max(0.45, obb["len_v"] * 0.38))
            elif not ov:
                max_realistic_pitch_h = min(6.0, max(0.55, half_span * 1.16))
                roof_h = min(roof_h, max_realistic_pitch_h)
            roof_h = max(0.35, min(6.4, roof_h))

        # Choose authentic Kindenheim facade & DOP20-sampled REAL roof materials!
        tags = bld.get("tags", {}) or {}
        wall_col_tag = str(tags.get("building:colour", "")).lower()
        roof_col_tag = str(tags.get("roof:colour", "")).lower()
        roof_tone = str(bld.get("roofTone", "")).lower()

        pfalz_wall_weights = [
            "wall_cream", "wall_cream", "wall_cream", "wall_cream", "wall_cream", "wall_cream", "wall_cream",
            "wall_ochre", "wall_ochre", "wall_ochre", "wall_ochre", "wall_ochre",
            "wall_sandstone", "wall_sandstone", "wall_sandstone", "wall_sandstone",
            "wall_terracotta", "wall_terracotta",
            "wall_warmwhite",
            "wall_sage",
        ]
        pfalz_roof_weights = [
            "roof_terracotta", "roof_terracotta", "roof_terracotta", "roof_terracotta", "roof_terracotta",
            "roof_darkred", "roof_darkred",
            "roof_slate", "roof_slate", "roof_darkbrown",
        ]

        if "roof_mat" in ov:
            roof_mat = ov["roof_mat"]
        elif roof_tone == "terracotta":
            roof_mat = "roof_terracotta"
        elif roof_tone == "dark_red":
            roof_mat = "roof_darkred"
        elif roof_tone == "charcoal":
            roof_mat = "roof_slate"
        elif roof_tone == "metal_grey":
            roof_mat = "roof_metal" if (is_utility or is_barn or is_true_flat or cat == "agricultural") else "roof_slate"
        elif "grey" in roof_col_tag or "gray" in roof_col_tag or "black" in roof_col_tag or "anthracite" in roof_col_tag:
            roof_mat = "roof_slate"
        elif "brown" in roof_col_tag:
            roof_mat = "roof_darkbrown"
        else:
            roof_mat = pfalz_roof_weights[(h >> 3) % len(pfalz_roof_weights)]

        if "wall_mat" in ov:
            wall_mat = ov["wall_mat"]
        elif is_barn:
            barn_choices = ("wall_barn", "wall_barn", "wall_sandstone", "wall_cream", "wall_utility", "wall_ochre")
            wall_mat = barn_choices[h % len(barn_choices)]
            if roof_tone == "" and "roof_mat" not in ov:
                roof_mat = "roof_darkred" if (h % 2 == 0) else "roof_terracotta"
        elif is_utility:
            wall_mat = "wall_utility" if (h % 3 != 0) else pfalz_wall_weights[h % len(pfalz_wall_weights)]
            if roof_tone == "" and "roof_mat" not in ov and poly_area < 24.0 and h % 2 == 0:
                roof_mat = "roof_metal"
        else:
            if "yellow" in wall_col_tag or "ochre" in wall_col_tag:
                wall_mat = "wall_ochre"
            elif "white" in wall_col_tag or "beige" in wall_col_tag:
                wall_mat = "wall_warmwhite"
            elif "red" in wall_col_tag or "orange" in wall_col_tag or "brown" in wall_col_tag:
                wall_mat = "wall_terracotta"
            elif "green" in wall_col_tag:
                wall_mat = "wall_sage"
            elif roof_tone == "charcoal" and (h % 3 != 0):
                wall_mat = "wall_white_clean" if (h % 2 == 0) else "wall_cream"
            else:
                wall_mat = pfalz_wall_weights[h % len(pfalz_wall_weights)]

        # 1. 2.0m Underground + Above-Ground Plinth Skirt (ZERO floating houses!)
        plinth_mat = ov.get("plinth_mat", "plinth")
        plinth_above = float(ov.get("plinth_above", 0.18 if is_utility else 0.55))
        z_plinth_top = z_base + plinth_above
        z_eave = z_base + wall_h
        self.add_plinth_skirt(pts, z_base - 2.0, z_plinth_top, plinth_mat=plinth_mat)

        # 2. Exact Footprint Exterior Facade Walls
        non_windowed_mats = {
            "wall_barn", "wall_utility", "wall_peach_plain", "wall_brick_barn_yellow",
            "wall_timber_vertical", "wall_fachwerk_yellow", "wall_fachwerk_white",
            "wall_limestone_brick", "wall_rubble_barn", "wall_mustard_porthole",
        }
        is_windowed = ov.get("is_windowed", (not is_utility) and (wall_mat not in non_windowed_mats))
        self.add_facade_wall_ring(pts, z_plinth_top, z_eave, wall_mat, is_windowed=is_windowed)

        # 2b. Optional Climbing Ivy Blankets & Balconies on exact corridor buildings!
        ivy_dir = ov.get("ivy_dir")
        if ivy_dir is not None:
            self.add_ivy_blanket_on_wall(pts, z_plinth_top, z_eave, ivy_dir)
        balcony_dir = ov.get("balcony_dir")
        if balcony_dir is not None:
            self.add_dark_balconies(pts, z_base, z_eave, balcony_dir, balcony_mat=ov.get("balcony_mat", "trim_wood"), balcony_w=ov.get("balcony_w"))

        # 3. 3D Front Door / Barn Gate Accent on main street/courtyard wall
        if not ov.get("no_door", False) and not is_utility and poly_area >= 42.0:
            self.add_door_or_gate(pts, z_base, z_eave, is_barn=is_barn, seed=h)

        # 4. Exact LoD2-Matched Roof Geometry (Flat Parapet / Skillion / Multi-Wing Gabled / Hipped)
        gable_wall_mat = ov.get("gable_wall_mat")
        dormer_mat = ov.get("dormer_mat")
        dormer_dir = ov.get("dormer_dir")
        solar_pv_dir = ov.get("solar_pv_dir")
        fascia_mat = ov.get("fascia_mat", "trim_wood")
        force_dormer = bool(ov.get("force_dormer", False))

        if is_true_flat:
            flat_mat = "roof_flat" if (roof_mat not in ("roof_metal",)) else "roof_metal"
            self.add_flat_parapet_roof(pts, z_eave, wall_mat, flat_mat)
            # Stepped upper 1929 Bauhaus clerestory penthouse on Weingut Kreutzenberger QOUr!
            if ov.get("bauhaus_penthouse"):
                cx_p, cy_p = obb["center"]
                ux_p, uy_p = obb["u_axis"]
                vx_p, vy_p = obb["v_axis"]
                ph_w = obb["len_u"] * 0.44
                ph_d = obb["len_v"] * 0.48
                ph_h = 2.05
                # Shift slightly back (south-east in Blender -Y, +X) like real Bauhaus stepped massing
                pc = Vector((cx_p + 1.2, cy_p - 1.2, z_eave + 0.25 + ph_h * 0.5))
                self.add_box(pc, Vector((ux_p, uy_p, 0.0)), Vector((vx_p, vy_p, 0.0)), sx=ph_w, sy=ph_d, sz=ph_h, mat_key="wall_bauhaus_white", uv_scale=6.0)
                self.add_box(pc + Vector((0, 0, ph_h * 0.5 + 0.05)), Vector((ux_p, uy_p, 0.0)), Vector((vx_p, vy_p, 0.0)), sx=ph_w + 0.14, sy=ph_d + 0.14, sz=0.10, mat_key="trim_wood", uv_scale=2.0)
        elif roof_shape_tag == "skillion" or (is_utility and poly_area < 28.0 and h % 2 == 0 and not ov):
            # Prevent floating overhanging skillion wedges on irregular/L-shaped footprints!
            if rectangularity < 0.82 and not ov:
                self.add_flat_parapet_roof(pts, z_eave, wall_mat, "roof_flat")
            else:
                self.add_skillion_roof(obb, z_eave, max(0.45, roof_h), wall_mat, roof_mat, overhang=0.22, fascia_mat=fascia_mat)
        elif rectangularity < 0.78 and poly_area >= 45.0 and (
            not ov.get("roof_shape")
            or (ov.get("_from_street") and roof_shape_tag == "gabled" and not ov.get("rotate_ridge_90"))
        ):
            wings = decompose_rectilinear_wings(pts, obb)
            if wings:
                ux, uy = obb["u_axis"]
                vx, vy = obb["v_axis"]
                for w_idx, (u0, u1, v0, v1) in enumerate(wings):
                    lu = u1 - u0
                    lv = v1 - v0
                    cu = 0.5 * (u0 + u1)
                    cv = 0.5 * (v0 + v1)
                    w_center = (cu * ux + cv * vx, cu * uy + cv * vy)
                    if lu >= lv:
                        w_u, w_v, w_lu, w_lv = (ux, uy), (vx, vy), lu, lv
                    else:
                        w_u, w_v, w_lu, w_lv = (vx, vy), (-ux, -uy), lv, lu
                    w_roof_h = max(0.55, min(roof_h, w_lv * 0.52))
                    self.add_gabled_roof_wing(
                        w_center, w_u, w_v, w_lu, w_lv, z_eave, w_roof_h,
                        wall_mat, roof_mat,
                        overhang_eave=0.32, overhang_gable=0.24, slab_thick=0.15,
                        add_gable_walls=True,
                        add_chimney=(w_idx == 0 and not is_barn and not ov),
                        add_dormer=(w_idx == 0 and (force_dormer or (not is_barn and (h % 4 == 0) and not ov))),
                        seed=h + w_idx * 17,
                        gable_wall_mat=gable_wall_mat,
                        dormer_mat=dormer_mat,
                        solar_pv_dir=(solar_pv_dir if w_idx == 0 else None),
                        ivy_dir=(ivy_dir if w_idx == 0 else None),
                        dormer_dir=(dormer_dir if w_idx == 0 else None),
                        fascia_mat=fascia_mat,
                        no_attic_window=bool(ov.get("no_attic_window", False)),
                    )
            else:
                self.add_polygon_hipped_roof(pts, z_eave, roof_h, roof_mat)
        else:
            use_hipped = roof_shape_tag in ("hipped", "pyramidal", "half-hipped")
            if use_hipped:
                self.add_hipped_roof_obb(
                    obb, z_eave, roof_h, roof_mat,
                    overhang=0.36, slab_thick=0.16,
                    add_chimney=(not is_barn and poly_area >= 48.0),
                    seed=h,
                )
            else:
                self.add_gabled_roof_wing(
                    obb["center"], obb["u_axis"], obb["v_axis"],
                    obb["len_u"], obb["len_v"], z_eave, roof_h,
                    wall_mat, roof_mat,
                    overhang_eave=0.36, overhang_gable=0.28, slab_thick=0.17,
                    add_gable_walls=True,
                    add_chimney=(not is_barn and not is_utility and poly_area >= 44.0 and not ov),
                    add_dormer=(force_dormer or (not is_barn and not is_utility and wall_h >= 5.0 and (h % 5 == 0) and not ov)),
                    seed=h,
                    gable_wall_mat=gable_wall_mat,
                    dormer_mat=dormer_mat,
                    solar_pv_dir=solar_pv_dir,
                    ivy_dir=ivy_dir,
                    dormer_dir=dormer_dir,
                    fascia_mat=fascia_mat,
                    no_attic_window=bool(ov.get("no_attic_window", False)),
                )
        return True

    def finalize_object(self, collection) -> Optional[bpy.types.Object]:
        if len(self.bm.faces) == 0:
            self.bm.free()
            return None
        # Keep exact mathematically verified outward CCW winding (avoid recalc_face_normals flipping open foundation skirts!)
        self.bm.normal_update()
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for mk in self.mat_order:
            mesh.materials.append(self.mat_lib[mk])
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


# ---------------------------------------------------------------------------
# Export, Modular Archetype .blend Saving & Sunlit Preview Renderer
# ---------------------------------------------------------------------------

def export_objects_glb(objs: List[bpy.types.Object], glb_path: str):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )


def save_modular_archetypes():
    """Save 4 clean origin-centered Palatinate village house .blend archetypes in blender/village/archetypes/."""
    archetypes = [
        (
            "pfalz_wohnhaus_ochre.blend",
            {
                "id": "arch_ochre_1", "category": "residential", "roofShape": "gabled",
                "baseElevationM": 0.0, "wallHeightM": 6.1, "roofHeightM": 3.5,
                "tags": {"building:colour": "ochre"},
                "footprint": [[-6.0, -4.5], [6.0, -4.5], [6.0, 4.5], [-6.0, 4.5]],
            },
        ),
        (
            "pfalz_wohnhaus_cream_hipped.blend",
            {
                "id": "arch_cream_hip", "category": "residential", "roofShape": "hipped",
                "baseElevationM": 0.0, "wallHeightM": 6.0, "roofHeightM": 3.3,
                "tags": {"building:colour": "white"},
                "footprint": [[-5.5, -5.0], [5.5, -5.0], [5.5, 5.0], [-5.5, 5.0]],
            },
        ),
        (
            "pfalz_scheune_barn.blend",
            {
                "id": "arch_barn_1", "category": "barn", "roofShape": "gabled",
                "baseElevationM": 0.0, "wallHeightM": 5.2, "roofHeightM": 3.8,
                "footprint": [[-8.0, -4.8], [8.0, -4.8], [8.0, 4.8], [-8.0, 4.8]],
            },
        ),
        (
            "pfalz_winzerhaus_lshape.blend",
            {
                "id": "arch_winzer_l", "category": "residential", "roofShape": "gabled",
                "baseElevationM": 0.0, "wallHeightM": 5.9, "roofHeightM": 3.2,
                "tags": {"building:colour": "red"},
                "footprint": [
                    [-7.5, -6.0], [7.5, -6.0], [7.5, -0.5],
                    [1.0, -0.5], [1.0, 6.0], [-7.5, 6.0],
                ],
            },
        ),
    ]
    for fname, bspec in archetypes:
        clear_scene()
        mats = create_material_library()
        col = bpy.data.collections.new("Archetype")
        bpy.context.scene.collection.children.link(col)
        builder = VillageMeshBuilder(fname.replace(".blend", ""), mats)
        builder.build_building(bspec)
        builder.finalize_object(col)
        out_fp = os.path.join(ARCHETYPE_DIR, fname)
        bpy.ops.wm.save_as_mainfile(filepath=out_fp)
        print(f"Saved archetype .blend -> {out_fp}")


def setup_sunlit_render_env(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -1.1

    world = bpy.data.worlds.new("PfalzSunSky")
    scene.world = world
    wnt = world.node_tree
    bg = wnt.nodes.get("Background")
    sky = wnt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(32.0)
    sky.sun_rotation = math.radians(220.0)
    wnt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.28

    sun_data = bpy.data.lights.new("PfalzSun", type="SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(1.6)
    sun_obj = bpy.data.objects.new("PfalzSun", sun_data)
    sun_obj.rotation_euler = Euler((math.radians(52.0), math.radians(14.0), math.radians(-35.0)), "XYZ")
    scene.collection.objects.link(sun_obj)


def render_camera(scene, cam_loc: Tuple[float, float, float], target: Tuple[float, float, float], lens: float, out_path: str):
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = lens
    cam_data.clip_end = 4000.0
    cam_obj = bpy.data.objects.new("PreviewCam", cam_data)
    cam_obj.location = Vector(cam_loc)
    cam_obj.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam_obj, do_unlink=True)
    print(f"Rendered preview -> {out_path}")


def add_preview_ground(scene, center_xy=(0.0, 0.0), z_elev: float = 0.0, slope_x: float = 0.0, size: float = 1200.0):
    """Add real DGM1 heightmap preview terrain (or fallback plane) strictly for Blender preview renders (never exported)."""
    hm_path = os.path.join(PROJECT_ROOT, "data/terrain/heightmap.bin")
    ortho_path = os.path.join(PROJECT_ROOT, "data/terrain/orthophoto.jpg")
    if os.path.exists(hm_path) and slope_x == 0.0:
        import struct
        raw = open(hm_path, "rb").read()
        n = int(round(math.sqrt(len(raw) // 4)))
        vals = struct.unpack(f"<{n * n}f", raw)
        step = 4  # 129x129 grid -> fast & crisp
        sub_n = (n - 1) // step + 1
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        grid = []
        for r in range(sub_n):
            row = []
            ri = r * step
            # Row 0 = North (Three.js z = -1024 => Blender y = +1024)
            three_z = -1024.0 + (ri / (n - 1)) * 2048.0
            by = -three_z
            for c in range(sub_n):
                ci = c * step
                bx = -1024.0 + (ci / (n - 1)) * 2048.0
                bz = vals[ri * n + ci]
                row.append(bm.verts.new((bx, by, bz)))
            grid.append(row)
        for r in range(sub_n - 1):
            for c in range(sub_n - 1):
                u0, u1 = c / (sub_n - 1), (c + 1) / (sub_n - 1)
                v0, v1 = 1.0 - r / (sub_n - 1), 1.0 - (r + 1) / (sub_n - 1)
                f = bm.faces.new((grid[r + 1][c], grid[r + 1][c + 1], grid[r][c + 1], grid[r][c]))
                f.loops[0][uv].uv = (u0, v1)
                f.loops[1][uv].uv = (u1, v1)
                f.loops[2][uv].uv = (u1, v0)
                f.loops[3][uv].uv = (u0, v0)
        mesh = bpy.data.meshes.new("PreviewTerrain")
        bm.to_mesh(mesh)
        bm.free()
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mat = bpy.data.materials.new("Preview_Ortho_Terrain")
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.95
        if os.path.exists(ortho_path):
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(ortho_path, check_existing=True)
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new("PreviewTerrain", mesh)
        scene.collection.objects.link(obj)
        return obj

    bm = bmesh.new()
    hs = size * 0.5
    cx, cy = center_xy
    v0 = bm.verts.new((cx - hs, cy - hs, z_elev - hs * slope_x))
    v1 = bm.verts.new((cx + hs, cy - hs, z_elev + hs * slope_x))
    v2 = bm.verts.new((cx + hs, cy + hs, z_elev + hs * slope_x))
    v3 = bm.verts.new((cx - hs, cy + hs, z_elev - hs * slope_x))
    bm.faces.new((v0, v1, v2, v3))
    mesh = bpy.data.meshes.new("PreviewGround")
    bm.to_mesh(mesh)
    bm.free()
    mat = make_arch_material("Preview_Ground_Mat", base_color=(0.30, 0.34, 0.22, 1.0), roughness=0.95)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new("PreviewGround", mesh)
    scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------------------
# Demo Street Block Mode (verifies every building type + hillside grounding!)
# ---------------------------------------------------------------------------

def run_demo(render_path: str):
    clear_scene()
    mats = create_material_library()
    col = bpy.data.collections.new("Demo_Kindenheim_Street")
    bpy.context.scene.collection.children.link(col)
    builder = VillageMeshBuilder("Demo_Village", mats)

    # Sloped hillside z_base = x * 0.06 (6% Pfalz village slope!) to prove ZERO floating houses!
    def slope_z(x):
        return x * 0.06

    demo_buildings = [
        # Row 1: North side of Hauptstraße (z = -12..-2)
        {"id": "demo_1", "category": "residential", "roofShape": "gabled", "baseElevationM": slope_z(-24), "wallHeightM": 6.1, "roofHeightM": 3.4,
         "footprint": [[-30, -12], [-18, -12], [-18, -3], [-30, -3]]},
        {"id": "demo_2", "category": "residential", "roofShape": "hipped", "baseElevationM": slope_z(-10), "wallHeightM": 6.2, "roofHeightM": 3.3,
         "footprint": [[-15, -13], [-5, -13], [-5, -3], [-15, -3]]},
        # L-shaped Pfalz Winzerhof courtyard!
        {"id": "demo_3_lshape", "category": "residential", "roofShape": "gabled", "baseElevationM": slope_z(5), "wallHeightM": 5.9, "roofHeightM": 3.1,
         "footprint": [[-2, -14], [12, -14], [12, -7], [4, -7], [4, -1], [-2, -1]]},
        # Traditional half-timbered Scheune barn!
        {"id": "demo_4_barn", "category": "barn", "roofShape": "gabled", "baseElevationM": slope_z(21), "wallHeightM": 5.2, "roofHeightM": 3.8,
         "footprint": [[14, -14], [28, -14], [28, -4], [14, -4]]},
        # Row 2: South side of Hauptstraße (z = +8..+20)
        {"id": "demo_5", "category": "residential", "roofShape": "gabled", "baseElevationM": slope_z(-20), "wallHeightM": 6.0, "roofHeightM": 3.4,
         "footprint": [[-27, 8], [-13, 8], [-13, 17], [-27, 17]]},
        {"id": "demo_6_garage", "category": "garage", "roofShape": "skillion", "baseElevationM": slope_z(-9), "wallHeightM": 2.7, "roofHeightM": 0.7,
         "footprint": [[-11, 9], [-7, 9], [-7, 15], [-11, 15]]},
        # U-shaped Dreiseithof farmhouse!
        {"id": "demo_7_ushape", "category": "residential", "roofShape": "gabled", "baseElevationM": slope_z(3), "wallHeightM": 5.8, "roofHeightM": 3.0,
         "footprint": [[-4, 8], [12, 8], [12, 20], [7, 20], [7, 13], [1, 13], [1, 20], [-4, 20]]},
        {"id": "demo_8", "category": "residential", "roofShape": "gabled", "baseElevationM": slope_z(20), "wallHeightM": 3.6, "roofHeightM": 2.5,
         "footprint": [[15, 9], [25, 9], [25, 16], [15, 16]]},
    ]

    for b in demo_buildings:
        builder.build_building(b)
    obj = builder.finalize_object(col)
    print(f"Demo village built: {len(obj.data.polygons)} polygons, {len(obj.data.materials)} materials.")

    if render_path:
        setup_sunlit_render_env(bpy.context.scene)
        add_preview_ground(bpy.context.scene, center_xy=(0.0, 0.0), z_elev=0.0, slope_x=0.06, size=220.0)
        render_camera(bpy.context.scene, (-34.0, -34.0, 20.0), (2.0, -2.0, 3.0), 34.0, render_path)


# ---------------------------------------------------------------------------
# Full Production Mode: Build ALL Real Kindenheim OSM Buildings -> Chunks + Manifest
# ---------------------------------------------------------------------------

def load_excluded_landmark_ids(landmarks_manifest_path: Optional[str], extra_ids: List[str]) -> set:
    excluded = set(str(x) for x in extra_ids if x)
    if landmarks_manifest_path and os.path.exists(landmarks_manifest_path):
        with open(landmarks_manifest_path, "r", encoding="utf-8") as f:
            lm = json.load(f)
        # Support either list of landmarks or dict with "landmarks" / "excludedOsmIds"
        for k in ("excludedOsmIds", "excludedIds", "osmIds"):
            for x in lm.get(k, []) if isinstance(lm, dict) else []:
                excluded.add(str(x))
        entries = lm.get("landmarks", []) if isinstance(lm, dict) else (lm if isinstance(lm, list) else [])
        if isinstance(entries, dict):
            entries = list(entries.values())
        for item in entries:
            if not isinstance(item, dict):
                continue
            for k in ("osmId", "id", "buildingId"):
                if item.get(k) is not None:
                    excluded.add(str(item[k]))
            for k in ("osmIds", "buildingIds", "excludedOsmIds"):
                for x in item.get(k, []) or []:
                    excluded.add(str(x))
    return excluded


def classify_chunk(cx: float, cz: float) -> str:
    dist = math.hypot(cx, cz)
    if dist <= 220.0:
        return "village_center"
    if dist > 460.0:
        return "village_outskirts"
    if cz < 0.0:
        return "village_north"
    return "village_south"


def compute_gltf_bbox_obj(obj) -> Dict:
    xs, ys, zs = [], [], []
    for corner in obj.bound_box:
        w = obj.matrix_world @ Vector(corner)
        xs.append(w.x)
        ys.append(w.z)
        zs.append(-w.y)
    return {
        "min": [round(min(xs), 2), round(min(ys), 2), round(min(zs), 2)],
        "max": [round(max(xs), 2), round(max(ys), 2), round(max(zs), 2)],
    }


def add_courtyard_accessories(
    builders: Dict[str, VillageMeshBuilder],
    extra_accessories: Optional[List[Dict]] = None,
    road_segments: Optional[List[Tuple[float, float, float, float, float]]] = None,
    valid_mats: Optional[set] = None,
):
    """Add Street-View-exact Kindenheim courtyard gates (Hoftore), canopies, hedges, retaining walls & per-street accessories."""

    def get_b(wx: float, wz: float) -> VillageMeshBuilder:
        return builders[classify_chunk(wx, wz)]

    def add_gate_span(
        p0_xz: Tuple[float, float],
        p1_xz: Tuple[float, float],
        z_ground: float,
        gate_h: float,
        gate_mat: str,
        canopy_mat: Optional[str] = None,
        pier_mat: str = "wall_butter_yellow",
        plinth_mat: str = "plinth_checkered",
        pier_w: float = 0.55,
    ):
        """Build a courtyard Hoftor span from p0_xz to p1_xz (Three.js XZ) with piers, gate leaf & optional tiled canopy."""
        b = get_b(0.5 * (p0_xz[0] + p1_xz[0]), 0.5 * (p0_xz[1] + p1_xz[1]))
        # Convert Three.js (x, z) -> Blender (x, -z)
        x0, y0 = p0_xz[0], -p0_xz[1]
        x1, y1 = p1_xz[0], -p1_xz[1]
        span = math.hypot(x1 - x0, y1 - y0)
        if span < 1.2:
            return
        u_vec = Vector(((x1 - x0) / span, (y1 - y0) / span, 0.0))
        v_vec = Vector((-u_vec.y, u_vec.x, 0.0))  # Right-handed basis: u x v = +Z!
        mid = Vector((0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.0))

        # Left & right masonry piers (extend 1.2m underground!)
        if pier_w > 0.05:
            for sgn in (-1.0, 1.0):
                pc = mid + u_vec * (sgn * (span * 0.5 - pier_w * 0.5))
                b.add_box(pc + Vector((0, 0, z_ground - 0.15)), u_vec, v_vec, sx=pier_w, sy=0.52, sz=2.1, mat_key=plinth_mat, uv_scale=1.6)
                upper_h = max(0.8, gate_h - 0.85 + 0.35)
                b.add_box(pc + Vector((0, 0, z_ground + 0.90 + upper_h * 0.5)), u_vec, v_vec, sx=pier_w, sy=0.48, sz=upper_h, mat_key=pier_mat, uv_scale=6.0)

        # Gate panel centered between piers
        gw = max(0.8, span - 2.0 * pier_w)
        z0 = z_ground + 0.04
        z1 = z_ground + gate_h
        p_bl = mid - u_vec * (gw * 0.5) + Vector((0, 0, z0))
        p_br = mid + u_vec * (gw * 0.5) + Vector((0, 0, z0))
        p_tr = p_br + Vector((0, 0, gate_h))
        p_tl = p_bl + Vector((0, 0, gate_h))
        b.add_quad(p_bl, p_br, p_tr, p_tl, ((0, 0), (1, 0), (1, 1), (0, 1)), gate_mat)

        # Miniature clay/slate-tile canopy roof spanning top of courtyard gate!
        if canopy_mat:
            b.add_gabled_roof_wing(
                center_xy=(mid.x, mid.y),
                u_axis=(u_vec.x, u_vec.y),
                v_axis=(v_vec.x, v_vec.y),
                len_u=span + 0.25,
                len_v=1.05,
                z_eave=z_ground + gate_h + 0.18,
                roof_h=0.52,
                wall_mat=pier_mat,
                roof_mat=canopy_mat,
                overhang_eave=0.22,
                overhang_gable=0.18,
                slab_thick=0.10,
                add_gable_walls=True,
                add_chimney=False,
                add_dormer=False,
            )

    # 1. Hauptstraße 62 -> 60 Wooden Courtyard Hoftor + Terracotta Canopy (sv_kirche_full_west!)
    add_gate_span(
        p0_xz=(-51.8, -50.4), p1_xz=(-44.8, -50.0), z_ground=57.40,
        gate_h=2.75, gate_mat="barn_gate", canopy_mat="roof_terracotta",
        pier_mat="wall_ochre_rolladen", plinth_mat="plinth_red_smooth", pier_w=0.65,
    )

    # 2. Hauptstraße 59 (east of QOQZ) Ornate Gray Arched Wrought-Iron Hoftor + Dark Slate Canopy!
    add_gate_span(
        p0_xz=(68.35, -80.89), p1_xz=(73.40, -82.65), z_ground=54.05,
        gate_h=2.85, gate_mat="gate_wrought_iron", canopy_mat="roof_slate",
        pier_mat="wall_butter_yellow", plinth_mat="plinth_checkered", pier_w=0.58,
    )

    # 3. Hauptstraße 45 (in front of QORh) Dark Charcoal Arched Gate + Mini Terracotta Door Canopy!
    add_gate_span(
        p0_xz=(155.4, -115.6), p1_xz=(157.8, -109.6), z_ground=51.80,
        gate_h=2.35, gate_mat="gate_iron_dark", canopy_mat=None,
        pier_mat="wall_blush_clean", plinth_mat="plinth_rubble", pier_w=0.32,
    )
    # Small red clay-tile entrance canopy tucked behind the charcoal gate on QORh's WSW gable
    b_45 = get_b(157.5, -112.0)
    b_45.add_gabled_roof_wing(
        center_xy=(157.5, 112.6),
        u_axis=(0.37, -0.93), v_axis=(0.93, 0.37),  # Right-handed: u x v = +Z!
        len_u=2.3, len_v=1.25, z_eave=51.80 + 2.55, roof_h=0.58,
        wall_mat="wall_blush_clean", roof_mat="roof_terracotta",
        overhang_eave=0.16, overhang_gable=0.15, slab_thick=0.09,
        add_gable_walls=True,
    )

    # 4. Iconic 1929 Bauhaus Weingut Kreutzenberger (Hauptstraße 5):
    #    Crisp White Gateway Bridge + Steel-Gray Vertical-Slat Sliding Gate + 5 Italian Cypresses!
    b_kr = get_b(482.0, -214.0)
    gx0, gy0 = 478.69, 214.38   # QOUm NE corner (Blender XY)
    gx1, gy1 = 484.85, 215.70   # Anchored cleanly into QOUr NW corner (Blender XY)
    g_span = math.hypot(gx1 - gx0, gy1 - gy0)
    gu = Vector(((gx1 - gx0) / g_span, (gy1 - gy0) / g_span, 0.0))
    gv = Vector((-gu.y, gu.x, 0.0))  # Right-handed: gu x gv = +Z (gv points north toward street!)
    g_mid = Vector((0.5 * (gx0 + gx1), 0.5 * (gy0 + gy1), 0.0))
    z_kr = 38.15
    # Crisp white Bauhaus upper lintel seamlessly uniting QOUm (wh=4.8m) and QOUr!
    b_kr.add_box(g_mid + Vector((0, 0, z_kr + 4.18)), gu, gv, sx=g_span + 0.9, sy=0.74, sz=1.28, mat_key="wall_bauhaus_white", uv_scale=8.0)
    b_kr.add_box(g_mid + Vector((0, 0, z_kr + 4.86)), gu, gv, sx=g_span + 1.0, sy=0.82, sz=0.08, mat_key="trim_wood", uv_scale=2.0)
    # Recessed steel-gray vertical-slat sliding carriage gate (upper header + left open door leaf next to QOUr!)
    b_kr.add_box(g_mid - gv * 0.16 + Vector((0, 0, z_kr + 2.88)), gu, gv, sx=g_span - 0.10, sy=0.10, sz=1.36, mat_key="gate_bauhaus_slat", uv_scale=2.2)
    b_kr.add_box(g_mid + gu * (g_span * 0.34) - gv * 0.20 + Vector((0, 0, z_kr + 1.25)), gu, gv, sx=g_span * 0.30, sy=0.10, sz=2.50, mat_key="gate_bauhaus_slat", uv_scale=2.2)
    # 5 tall slender dark-green Italian cypresses in stone-curbed gravel planter beds along street frontage!
    cypress_spots = [
        # 2 tall cypresses right of gate (in front of QOUm)
        (475.2, -214.8, 6.2, 0.44),
        (477.4, -215.2, 5.8, 0.40),
        # 3 slender cypresses left of gate (in front of QOUr)
        (486.0, -217.2, 5.4, 0.36),
        (487.5, -217.6, 5.2, 0.35),
        (489.0, -218.0, 5.0, 0.34),
    ]
    for cx_t, cz_t, ch, cr in cypress_spots:
        bx_t, by_t = cx_t, -cz_t
        # Layered tapered hexagonal cypress column (3 overlapping tapered tiers for natural organic foliage!)
        for tier_i, (zf0, zf1, rf0, rf1) in enumerate([
            (0.05, 0.38, cr * 0.92, cr * 1.05),
            (0.32, 0.72, cr * 1.00, cr * 0.78),
            (0.65, 1.00, cr * 0.74, 0.08),
        ]):
            segs = 7
            z_lo = z_kr + ch * zf0
            z_hi = z_kr + ch * zf1
            for s in range(segs):
                a0 = (s / segs) * 2.0 * math.pi + tier_i * 0.3
                a1 = ((s + 1) / segs) * 2.0 * math.pi + tier_i * 0.3
                p00 = (bx_t + math.cos(a0) * rf0, by_t + math.sin(a0) * rf0, z_lo)
                p10 = (bx_t + math.cos(a1) * rf0, by_t + math.sin(a1) * rf0, z_lo)
                p11 = (bx_t + math.cos(a1) * rf1, by_t + math.sin(a1) * rf1, z_hi)
                p01 = (bx_t + math.cos(a0) * rf1, by_t + math.sin(a0) * rf1, z_hi)
                b_kr.add_quad(p00, p10, p11, p01, ((0, 0), (0.6, 0), (0.6, 1.4), (0, 1.4)), "cypress_foliage")

    # 5. Neugasse Villa (QOR1) Clipped Boxwood Garden Hedge & Stone Curb (sv_side_street_neugasse!)
    b_neu = get_b(57.5, -214.0)
    h_u = Vector((0.94, 0.34, 0.0))
    h_v = Vector((0.34, -0.94, 0.0))
    b_neu.add_box(Vector((57.0, 214.0, 64.65)), h_u, h_v, sx=11.5, sy=0.82, sz=1.15, mat_key="ivy_foliage", uv_scale=1.6)
    b_neu.add_box(Vector((57.0, 213.2, 64.25)), h_u, h_v, sx=12.0, sy=0.32, sz=0.75, mat_key="plinth_rubble", uv_scale=2.0)

    # 6. Burgweg #4 Left Corner Lush Clipped Garden Hedge atop Limestone Wall (sv_side_street_burgweg!)
    b_brg = get_b(242.5, -271.5)
    bu = Vector((0.92, -0.39, 0.0))
    bv = Vector((-0.39, -0.92, 0.0))
    b_brg.add_box(Vector((242.5, 271.5, 59.10)), bu, bv, sx=6.6, sy=0.52, sz=1.35, mat_key="plinth_rubble", uv_scale=2.0)
    b_brg.add_box(Vector((242.5, 271.5, 60.45)), bu, bv, sx=6.8, sy=1.18, sz=1.55, mat_key="ivy_foliage", uv_scale=1.5)

    # 7. Hauptstraße #95 Right Barn Low Limestone Rubble Garden Wall (sv_vineyard_edge_west!)
    b_w95 = get_b(-298.0, 54.5)
    wu = Vector((0.32, -0.95, 0.0))
    wv = Vector((-0.95, -0.32, 0.0))
    b_w95.add_box(Vector((-298.8, -54.2, 68.55)), wu, wv, sx=11.5, sy=0.45, sz=1.95, mat_key="plinth_rubble", uv_scale=2.4)

    # =========================================================================
    # WAVE 2: Terrain-Conforming Street Accessories (Triftstraße, Am Kirchrain,
    #         Im Rosengarten, Judenberg, Raiffeisenstraße East)
    # =========================================================================
    hm_path = os.path.join(PROJECT_ROOT, "data/terrain/heightmap.bin")
    hm_vals = None
    hm_n = 0
    if os.path.exists(hm_path):
        import struct
        raw = open(hm_path, "rb").read()
        hm_n = int(round(math.sqrt(len(raw) // 4)))
        hm_vals = struct.unpack(f"<{hm_n * hm_n}f", raw)

    def elev_xz(wx: float, wz: float, fallback: float = 70.0) -> float:
        if hm_vals is None or hm_n < 2:
            return fallback
        u = max(0.0, min(1.0, (wx + 1024.0) / 2048.0)) * (hm_n - 1)
        v = max(0.0, min(1.0, (wz + 1024.0) / 2048.0)) * (hm_n - 1)
        c0, r0 = int(math.floor(u)), int(math.floor(v))
        c1, r1 = min(hm_n - 1, c0 + 1), min(hm_n - 1, r0 + 1)
        fu, fv = u - c0, v - r0
        h00 = hm_vals[r0 * hm_n + c0]
        h10 = hm_vals[r0 * hm_n + c1]
        h01 = hm_vals[r1 * hm_n + c0]
        h11 = hm_vals[r1 * hm_n + c1]
        return (h00 * (1.0 - fu) + h10 * fu) * (1.0 - fv) + (h01 * (1.0 - fu) + h11 * fu) * fv

    def add_polyline_wall(
        pts_xz: List[Tuple[float, float]],
        height: float,
        thick: float,
        mat_key: str,
        uv_scale: float = 2.0,
        z_offset: float = 0.0,
        cap_mat: Optional[str] = None,
        bury: float = 0.65,
    ):
        """Extrude a smooth terrain-sloping 3D wall or hedge along Three.js (x, z) polyline (zero stair-stepping!)."""
        def emit_sloped_prism(b_inst, p0_xy, p1_xy, z_b0, z_t0, z_b1, z_t1, w_thick, mk, uvs):
            dx, dy = p1_xy[0] - p0_xy[0], p1_xy[1] - p0_xy[1]
            dl = math.hypot(dx, dy)
            if dl < 1e-4:
                return
            ux, uy = dx / dl, dy / dl
            vx, vy = -uy, ux  # u x v = +Z
            # Slight 0.03m overlap at joints to seal miter seams at polyline bends
            x0e, y0e = p0_xy[0] - ux * 0.03, p0_xy[1] - uy * 0.03
            x1e, y1e = p1_xy[0] + ux * 0.03, p1_xy[1] + uy * 0.03
            hw = w_thick * 0.5
            r0b = (x0e - vx * hw, y0e - vy * hw, z_b0)
            r0t = (x0e - vx * hw, y0e - vy * hw, z_t0)
            r1b = (x1e - vx * hw, y1e - vy * hw, z_b1)
            r1t = (x1e - vx * hw, y1e - vy * hw, z_t1)
            l0b = (x0e + vx * hw, y0e + vy * hw, z_b0)
            l0t = (x0e + vx * hw, y0e + vy * hw, z_t0)
            l1b = (x1e + vx * hw, y1e + vy * hw, z_b1)
            l1t = (x1e + vx * hw, y1e + vy * hw, z_t1)
            us = max(0.2, dl / uvs)
            vs = max(0.2, (z_t0 - z_b0) / uvs)
            ws = max(0.15, w_thick / uvs)
            b_inst.add_quad(r0b, r1b, r1t, r0t, ((0, 0), (us, 0), (us, vs), (0, vs)), mk)
            b_inst.add_quad(l1b, l0b, l0t, l1t, ((0, 0), (us, 0), (us, vs), (0, vs)), mk)
            b_inst.add_quad(r0t, r1t, l1t, l0t, ((0, 0), (us, 0), (us, ws), (0, ws)), mk)
            b_inst.add_quad(l0b, r0b, r0t, l0t, ((0, 0), (ws, 0), (ws, vs), (0, vs)), mk)
            b_inst.add_quad(r1b, l1b, l1t, r1t, ((0, 0), (ws, 0), (ws, vs), (0, vs)), mk)

        for i in range(len(pts_xz) - 1):
            x0, z0 = pts_xz[i]
            x1, z1 = pts_xz[i + 1]
            seg_len = math.hypot(x1 - x0, z1 - z0)
            if seg_len < 0.25:
                continue
            # Subdivide long spans every <= 4.5m to track curved hill slopes smoothly!
            n_sub = max(1, int(math.ceil(seg_len / 4.5)))
            for s in range(n_sub):
                t0, t1 = s / n_sub, (s + 1) / n_sub
                ax, az = x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0
                bx_w, bz_w = x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1
                mx, mz = 0.5 * (ax + bx_w), 0.5 * (az + bz_w)
                b = get_b(mx, mz)
                e0 = elev_xz(ax, az) + z_offset
                e1 = elev_xz(bx_w, bz_w) + z_offset
                p0b = (ax, -az)
                p1b = (bx_w, -bz_w)
                emit_sloped_prism(b, p0b, p1b, e0 - bury, e0 + height, e1 - bury, e1 + height, thick, mat_key, uv_scale)
                if cap_mat:
                    emit_sloped_prism(b, p0b, p1b, e0 + height, e0 + height + 0.09, e1 + height, e1 + height + 0.09, thick + 0.08, cap_mat, 2.0)

    def add_polyline_fence_panel(
        pts_xz: List[Tuple[float, float]],
        height: float,
        mat_key: str,
        z_offset: float = 0.0,
        tile_w: float = 2.0,
    ):
        """Add terrain-conforming double-sided alpha-clipped fence/picket panel along Three.js (x, z) polyline."""
        for i in range(len(pts_xz) - 1):
            x0, z0 = pts_xz[i]
            x1, z1 = pts_xz[i + 1]
            seg_len = math.hypot(x1 - x0, z1 - z0)
            if seg_len < 0.25:
                continue
            n_sub = max(1, int(math.ceil(seg_len / 4.0)))
            for s in range(n_sub):
                t0, t1 = s / n_sub, (s + 1) / n_sub
                ax, az = x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0
                bx_w, bz_w = x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1
                mx, mz = 0.5 * (ax + bx_w), 0.5 * (az + bz_w)
                b = get_b(mx, mz)
                e0 = elev_xz(ax, az) + z_offset
                e1 = elev_xz(bx_w, bz_w) + z_offset
                dl = math.hypot(bx_w - ax, bz_w - az)
                u_span = max(0.5, dl / tile_w)
                p_bl = (ax, -az, e0)
                p_br = (bx_w, -bz_w, e1)
                p_tr = (bx_w, -bz_w, e1 + height)
                p_tl = (ax, -az, e0 + height)
                b.add_quad(p_bl, p_br, p_tr, p_tl, ((0, 0), (u_span, 0), (u_span, 1.0), (0, 1.0)), mat_key)

    def add_columnar_cypress(wx: float, wz: float, height: float, radius: float = 0.42):
        b = get_b(wx, wz)
        eg = elev_xz(wx, wz) - 0.15
        bx_t, by_t = wx, -wz
        for tier_i, (zf0, zf1, rf0, rf1) in enumerate([
            (0.02, 0.38, radius * 0.92, radius * 1.05),
            (0.32, 0.72, radius * 1.00, radius * 0.76),
            (0.65, 1.00, radius * 0.72, 0.08),
        ]):
            segs = 7
            z_lo = eg + height * zf0
            z_hi = eg + height * zf1
            for s in range(segs):
                a0 = (s / segs) * 2.0 * math.pi + tier_i * 0.3
                a1 = ((s + 1) / segs) * 2.0 * math.pi + tier_i * 0.3
                p00 = (bx_t + math.cos(a0) * rf0, by_t + math.sin(a0) * rf0, z_lo)
                p10 = (bx_t + math.cos(a1) * rf0, by_t + math.sin(a1) * rf0, z_lo)
                p11 = (bx_t + math.cos(a1) * rf1, by_t + math.sin(a1) * rf1, z_hi)
                p01 = (bx_t + math.cos(a0) * rf1, by_t + math.sin(a0) * rf1, z_hi)
                b.add_quad(p00, p10, p11, p01, ((0, 0), (0.6, 0), (0.6, 1.4), (0, 1.4)), "cypress_foliage")

    # 8. Triftstraße East Tall Dry-Laid Buff Limestone Rubble Wall (Bruchsteinmauer, sv_triftstrasse_north_entry!)
    add_polyline_wall(
        [(-315.2, 64.0), (-313.8, 72.0), (-312.5, 80.0), (-311.2, 88.8)],
        height=1.72, thick=0.46, mat_key="wall_rubble_barn", uv_scale=2.2, cap_mat="plinth_concrete",
    )

    # 9. Triftstraße West Weathered Wooden Picket Courtyard Gate (between QOX3 & Triftstr #4 Fachwerk!)
    add_polyline_fence_panel(
        [(-320.2, 74.0), (-317.8, 86.2)],
        height=1.95, mat_key="fence_wood_picket", z_offset=0.04, tile_w=2.4,
    )

    # 10. Triftstraße KDC Yard Limestone Retaining Wall + Dark-Green Weld-Mesh Fence + Blue KDC Sign!
    kdc_wall_pts = [(-323.5, 115.5), (-313.8, 118.0), (-312.9, 126.0), (-312.2, 131.5)]
    add_polyline_wall(kdc_wall_pts, height=0.92, thick=0.44, mat_key="wall_rubble_barn", uv_scale=2.0)
    add_polyline_fence_panel(kdc_wall_pts, height=1.42, mat_key="fence_mesh_green", z_offset=0.92, tile_w=1.8)
    # Iconic blue KDC sign panel at KDC yard corner
    b_kdc = get_b(-314.5, 118.2)
    ekdc = elev_xz(-314.5, 118.2)
    b_kdc.add_box(Vector((-314.5, -118.2, ekdc + 1.55)), Vector((0.97, -0.24, 0.0)), Vector((0.24, 0.97, 0.0)),
                  sx=2.1, sy=0.08, sz=0.82, mat_key="sign_kdc_blue", uv_scale=2.0)

    # 11. Triftstraße #6 ICONIC 2.0m-Tall Dense Manicured Sun-Baked Olive-Sage Privet Hedge (sv_triftstrasse_mid_northbound & south_house3!)
    add_polyline_wall(
        [(-310.7, 153.5), (-311.6, 164.3), (-314.2, 176.2), (-316.8, 188.2), (-318.6, 196.5)],
        height=1.98, thick=0.92, mat_key="hedge_olive", uv_scale=1.5, bury=0.35,
    )

    # 12. Triftstraße #3 East Columnar Cypresses (Thuja) & South Garden Shrub Border!
    for cx_t, cz_t, ch, cr in [
        (-302.5, 163.5, 3.8, 0.36),
        (-303.2, 167.8, 4.3, 0.38),
        (-304.0, 171.8, 3.5, 0.34),
    ]:
        add_columnar_cypress(cx_t, cz_t, ch, cr)
    add_polyline_wall(
        [(-306.2, 178.0), (-308.6, 188.0), (-310.5, 196.5)],
        height=2.35, thick=1.35, mat_key="hedge_olive", uv_scale=1.6, bury=0.35,
    )

    # 13. Am Kirchrain #18 (QOFR) Signature Tiered Limestone Wall + Cream Plastered Pillars + Warm Timber Fence Slats!
    #     (sv_kirchrain_mid_westbound right foreground!)
    kr18_pts = [(-556.5, 73.8), (-545.8, 67.7), (-535.0, 61.5)]
    add_polyline_wall(kr18_pts, height=0.88, thick=0.42, mat_key="plinth_rubble", uv_scale=2.0)
    # 7 evenly spaced cream plastered concrete-capped fence pillars + twin horizontal honey-wood rails!
    p_start, p_end = Vector((-556.5, -73.8, 0.0)), Vector((-535.0, -61.5, 0.0))
    span_18 = (p_end - p_start).length
    u18 = (p_end - p_start).normalized()
    v18 = Vector((-u18.y, u18.x, 0.0))
    n_pillars = 7
    for k in range(n_pillars):
        f = k / (n_pillars - 1)
        px = -556.5 + (-535.0 - (-556.5)) * f
        pz = 73.8 + (61.5 - 73.8) * f
        ep = elev_xz(px, pz)
        b_p = get_b(px, pz)
        b_p.add_box(Vector((px, -pz, ep + 0.86)), u18, v18, sx=0.44, sy=0.46, sz=1.72, mat_key="wall_cream", uv_scale=4.0)
        b_p.add_box(Vector((px, -pz, ep + 1.76)), u18, v18, sx=0.52, sy=0.54, sz=0.09, mat_key="plinth_concrete", uv_scale=2.0)
    # Twin warm orange-brown horizontal timber slats running between pillars!
    add_polyline_wall(kr18_pts, height=0.22, thick=0.10, mat_key="trim_honey_wood", z_offset=1.02, bury=0.0)
    add_polyline_wall(kr18_pts, height=0.22, thick=0.10, mat_key="trim_honey_wood", z_offset=1.38, bury=0.0)

    # 14. Am Kirchrain Twin Doppelhaus (QOFV/QOFT) Front Clipped Boxwood Hedge (sv_kirchrain_mid_westbound left!)
    add_polyline_wall(
        [(-538.5, 73.0), (-532.0, 69.5), (-525.5, 65.8)],
        height=0.95, thick=0.72, mat_key="hedge_olive", uv_scale=1.4, bury=0.25,
    )

    # 15. Am Kirchrain #13 (QONN) & Am Sonnenberg 2 (way/734370329) Front Green Hedges & Brown Palisade Planter Curb!
    #     (sv_kirchrain_ne_eastbound right foreground!)
    add_polyline_wall(
        [(-480.5, 41.6), (-474.8, 38.6), (-469.5, 36.2)],
        height=1.55, thick=0.82, mat_key="hedge_olive", uv_scale=1.5, bury=0.30,
    )
    add_polyline_wall(
        [(-463.5, 33.8), (-456.5, 30.2), (-450.5, 28.5)],
        height=1.75, thick=0.95, mat_key="hedge_olive", uv_scale=1.5, bury=0.30,
    )
    add_polyline_wall(
        [(-464.5, 33.0), (-461.0, 31.4), (-457.5, 32.5)],
        height=0.42, thick=0.24, mat_key="wall_palisade_brown", uv_scale=1.8, bury=0.30,
    )

    # 16. Am Kirchrain #24 (QONP) Roadside Shrub Belt + 3 Tall Columnar Cypresses (sv_kirchrain_ne_eastbound left!)
    add_polyline_wall(
        [(-468.2, 24.4), (-458.0, 19.0), (-449.0, 14.3)],
        height=1.68, thick=1.15, mat_key="hedge_olive", uv_scale=1.6, bury=0.35,
    )
    for cx_t, cz_t, ch, cr in [
        (-454.5, 13.5, 6.2, 0.44),
        (-451.0, 11.8, 5.4, 0.40),
        (-448.5, 10.2, 4.8, 0.36),
    ]:
        add_columnar_cypress(cx_t, cz_t, ch, cr)

    # 17. Am Kirchrain #25 (QOO1) Curved Terracotta-Brown Palisade Retaining Wall + Corner Shrubs + North Boxwood Hedge!
    #     (sv_kirchrain_bend_east_vista left & sv_kirchrain_north_southbound left!)
    kr25_bend = [(-414.5, -5.0), (-413.0, 1.5), (-406.0, 2.5), (-397.0, 1.2)]
    add_polyline_wall(kr25_bend, height=0.85, thick=0.34, mat_key="wall_palisade_brown", uv_scale=1.8, bury=0.45)
    add_polyline_wall(
        [(-413.2, -5.5), (-411.5, 0.2), (-405.5, 1.0), (-397.5, -0.2)],
        height=1.95, thick=1.35, mat_key="hedge_olive", uv_scale=1.6, z_offset=0.55, bury=0.30,
    )
    kr25_north = [(-419.6, -29.5), (-417.1, -17.0), (-414.6, -5.0)]
    add_polyline_wall(kr25_north, height=0.42, thick=0.36, mat_key="wall_rubble_barn", uv_scale=1.8, bury=0.40)
    add_polyline_wall(kr25_north, height=1.42, thick=0.78, mat_key="hedge_olive", uv_scale=1.5, z_offset=0.35, bury=0.20)

    # 18. Am Kirchrain #15 (QOO3/QOHK) Pale Kalksandstein Concrete-Block Yard Wall (sv_kirchrain_bend_east_vista right!)
    add_polyline_wall(
        [(-410.5, 11.2), (-402.0, 10.9), (-391.0, 9.5)],
        height=1.35, thick=0.34, mat_key="wall_block_light", uv_scale=2.0, cap_mat="plinth_concrete",
    )

    # 19. Am Kirchrain #28 (infill/am_kirchrain_28) Exposed Gray Concrete L-Retaining Wall (sv_kirchrain_north_southbound right!)
    add_polyline_wall(
        [(-438.0, -16.5), (-426.8, -18.5), (-424.8, -7.0)],
        height=1.18, thick=0.28, mat_key="plinth_concrete", uv_scale=2.4, bury=0.55,
    )

    # 20. Im Rosengarten #11 Curved Beech Hedge, #6 Dark Concrete-Block Retaining Wall & #4 Tall Hedge!
    add_polyline_wall(
        [(-506.0, 121.2), (-516.5, 126.8), (-526.8, 132.2), (-534.5, 136.2)],
        height=1.52, thick=0.82, mat_key="hedge_olive", uv_scale=1.5, bury=0.30,
    )
    add_polyline_wall(
        [(-511.5, 112.8), (-520.5, 117.5), (-528.5, 121.8)],
        height=1.22, thick=0.38, mat_key="wall_block_dark", uv_scale=2.0, cap_mat="plinth_concrete",
    )
    add_polyline_wall(
        [(-530.5, 122.8), (-540.0, 127.8), (-550.0, 133.0)],
        height=1.92, thick=0.88, mat_key="hedge_olive", uv_scale=1.5, bury=0.30,
    )

    # 21. Judenberg North Subtle Low Dry-Laid Buff Stone Embankment Toe (tucked below grassy slope, sv_extra_judenberg left!)
    add_polyline_wall(
        [(-374.0, -62.5), (-362.4, -64.3), (-350.8, -66.1), (-339.2, -67.9)],
        height=0.38, thick=0.36, mat_key="wall_rubble_barn", uv_scale=2.0, bury=0.55,
    )

    # 22. Raiffeisenstraße East Galvanized Weld-Mesh Yard Fence (sv_extra_raiffeisenstrasse right!)
    add_polyline_fence_panel(
        [(314.0, 74.8), (304.0, 77.8), (293.0, 81.1), (285.0, 83.4)],
        height=1.80, mat_key="fence_mesh_galv", z_offset=0.02, tile_w=2.0,
    )

    # 23. Auto-Merged Per-Street Accessories (data/streets/*/overrides.json) with >= 3.0m Tractor Road-Clearance Guard!
    if extra_accessories:
        def min_road_dist(px: float, pz: float) -> Tuple[float, float]:
            if not road_segments:
                return 999.0, 5.0
            best_d = 999.0
            best_w = 5.0
            for x1, z1, x2, z2, rw in road_segments:
                dx, dz = x2 - x1, z2 - z1
                l2 = dx * dx + dz * dz
                if l2 < 1e-6:
                    d = math.hypot(px - x1, pz - z1)
                else:
                    t = max(0.0, min(1.0, ((px - x1) * dx + (pz - z1) * dz) / l2))
                    d = math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz))
                if d < best_d:
                    best_d = d
                    best_w = rw
            return best_d, best_w

        def is_clear_of_roads(pts_list: List[Tuple[float, float]], extra_pad: float = 0.0) -> bool:
            for i, (px, pz) in enumerate(pts_list):
                d, rw = min_road_dist(px, pz)
                req = max(2.85, rw * 0.5 + 0.55) + extra_pad
                if d < req:
                    return False
                if i + 1 < len(pts_list):
                    mx, mz = 0.5 * (px + pts_list[i + 1][0]), 0.5 * (pz + pts_list[i + 1][1])
                    dm, rwm = min_road_dist(mx, mz)
                    if dm < max(2.85, rwm * 0.5 + 0.55) + extra_pad:
                        return False
            return True

        def safe_acc_mat(mk: Optional[str], default: str) -> str:
            if not mk:
                return default
            if valid_mats is None or mk in valid_mats:
                return mk
            return sanitize_material_key(mk, valid_mats, role="wall", default=default)

        acc_added = 0
        acc_blocked = 0
        for acc in extra_accessories:
            if not isinstance(acc, dict):
                continue
            atype = str(acc.get("type", "")).lower().strip()
            try:
                if atype in ("wall", "retaining_wall", "hedge"):
                    raw_pts = acc.get("points") or []
                    pts_xz = [(float(p[0]), float(p[1])) for p in raw_pts if isinstance(p, (list, tuple)) and len(p) >= 2]
                    if len(pts_xz) < 2:
                        continue
                    thick = max(0.15, min(2.0, float(acc.get("thick", 0.82 if atype == "hedge" else 0.42))))
                    if not is_clear_of_roads(pts_xz, extra_pad=thick * 0.45):
                        acc_blocked += 1
                        continue
                    h_val = max(0.25, min(4.0, float(acc.get("height", 1.65 if atype == "hedge" else 1.35))))
                    default_m = "hedge_olive" if atype == "hedge" else "wall_rubble_barn"
                    mk = safe_acc_mat(acc.get("mat") or acc.get("mat_key"), default_m)
                    cap_m = safe_acc_mat(acc.get("cap_mat"), "plinth_concrete") if acc.get("cap_mat") else None
                    add_polyline_wall(
                        pts_xz, height=h_val, thick=thick, mat_key=mk,
                        uv_scale=float(acc.get("uv_scale", 1.6 if atype == "hedge" else 2.0)),
                        z_offset=float(acc.get("z_offset", 0.0)),
                        cap_mat=cap_m,
                        bury=float(acc.get("bury", 0.35 if atype == "hedge" else 0.55)),
                    )
                    acc_added += 1
                elif atype == "fence":
                    raw_pts = acc.get("points") or []
                    pts_xz = [(float(p[0]), float(p[1])) for p in raw_pts if isinstance(p, (list, tuple)) and len(p) >= 2]
                    if len(pts_xz) < 2:
                        continue
                    if not is_clear_of_roads(pts_xz):
                        acc_blocked += 1
                        continue
                    h_val = max(0.5, min(3.0, float(acc.get("height", 1.6))))
                    mk = safe_acc_mat(acc.get("mat") or acc.get("mat_key"), "fence_wood_picket")
                    add_polyline_fence_panel(
                        pts_xz, height=h_val, mat_key=mk,
                        z_offset=float(acc.get("z_offset", 0.02)),
                        tile_w=float(acc.get("tile_w", 2.0)),
                    )
                    acc_added += 1
                elif atype == "gate":
                    p0 = acc.get("p0")
                    p1 = acc.get("p1")
                    if not (isinstance(p0, (list, tuple)) and isinstance(p1, (list, tuple)) and len(p0) >= 2 and len(p1) >= 2):
                        continue
                    pts_g = [(float(p0[0]), float(p0[1])), (float(p1[0]), float(p1[1]))]
                    if not is_clear_of_roads(pts_g):
                        acc_blocked += 1
                        continue
                    mx_g, mz_g = 0.5 * (pts_g[0][0] + pts_g[1][0]), 0.5 * (pts_g[0][1] + pts_g[1][1])
                    zg = float(acc.get("z_ground", elev_xz(mx_g, mz_g)))
                    add_gate_span(
                        pts_g[0], pts_g[1], z_ground=zg,
                        gate_h=max(1.4, min(3.6, float(acc.get("height", 2.6)))),
                        gate_mat=safe_acc_mat(acc.get("gate_mat"), "barn_gate"),
                        canopy_mat=safe_acc_mat(acc.get("canopy_mat"), "roof_terracotta") if acc.get("canopy_mat") else None,
                        pier_mat=safe_acc_mat(acc.get("pier_mat"), "wall_cream"),
                        plinth_mat=safe_acc_mat(acc.get("plinth_mat"), "plinth_rubble"),
                        pier_w=float(acc.get("pier_w", 0.45)),
                    )
                    acc_added += 1
                elif atype == "cypress":
                    cx_t = float(acc.get("x", 0.0))
                    cz_t = float(acc.get("z", 0.0))
                    if not is_clear_of_roads([(cx_t, cz_t)], extra_pad=0.35):
                        acc_blocked += 1
                        continue
                    add_columnar_cypress(
                        cx_t, cz_t,
                        height=max(1.8, min(9.0, float(acc.get("height", 4.5)))),
                        radius=max(0.22, min(0.85, float(acc.get("radius", 0.38)))),
                    )
                    acc_added += 1
            except Exception as e:
                print(f"[WARN] Skipping malformed street accessory {acc}: {e}")
        print(f"Street accessories merged: {acc_added} added, {acc_blocked} skipped for road clearance")


# ---------------------------------------------------------------------------
# Per-Street Override Auto-Glob Merger & Defensive Validation
# ---------------------------------------------------------------------------

COMPASS_TO_BLENDER_XY: Dict[str, Tuple[float, float]] = {
    "N": (0.0, 1.0), "S": (0.0, -1.0), "E": (1.0, 0.0), "W": (-1.0, 0.0),
    "NE": (0.707, 0.707), "NW": (-0.707, 0.707), "SE": (0.707, -0.707), "SW": (-0.707, -0.707),
    "NNE": (0.383, 0.924), "ENE": (0.924, 0.383), "ESE": (0.924, -0.383), "SSE": (0.383, -0.924),
    "SSW": (-0.383, -0.924), "WSW": (-0.924, -0.383), "WNW": (-0.924, 0.383), "NNW": (-0.383, 0.924),
}


def parse_dir_blender(val) -> Optional[Tuple[float, float]]:
    if val is None:
        return None
    if isinstance(val, str):
        key = val.strip().upper()
        return COMPASS_TO_BLENDER_XY.get(key)
    if isinstance(val, (list, tuple)):
        if len(val) >= 2 and all(isinstance(x, (int, float)) for x in val[:2]):
            return (float(val[0]), float(val[1]))
        # List of compass strings e.g. ["S", "E"] -> take first valid!
        for item in val:
            res = parse_dir_blender(item)
            if res is not None:
                return res
    return None


def sanitize_material_key(raw: Optional[str], valid_mats: set, role: str = "wall", default: str = "wall_cream") -> str:
    if not raw:
        return default
    mk = str(raw).strip()
    if mk in valid_mats:
        return mk
    low = mk.lower()
    if role == "roof":
        if any(k in low for k in ("slate", "charcoal", "anthracite", "black", "grey", "gray")):
            return "roof_slate"
        if "brown" in low:
            return "roof_darkbrown"
        if any(k in low for k in ("darkred", "dark_red", "burgundy")):
            return "roof_darkred"
        if "metal" in low:
            return "roof_metal"
        if "flat" in low:
            return "roof_flat"
        if "bright" in low:
            return "roof_red_bright"
        return "roof_terracotta"
    if role == "plinth":
        if any(k in low for k in ("slate", "dark", "anthracite")):
            return "plinth_slate_gray"
        if "concrete" in low:
            return "plinth_concrete"
        if "red" in low:
            return "plinth_red_smooth"
        if "check" in low:
            return "plinth_checkered"
        if any(k in low for k in ("rubble", "bruch", "stone", "lime")):
            return "plinth_rubble"
        return "plinth"
    if role == "trim":
        if "white" in low:
            return "trim_white"
        if "honey" in low or "light" in low:
            return "trim_honey_wood"
        return "trim_wood"
    # General wall / accessory fallback
    if "hedge" in low or "bush" in low:
        return "hedge_olive"
    if "ivy" in low:
        return "ivy_foliage"
    if "picket" in low:
        return "fence_wood_picket"
    if "mesh" in low and "green" in low:
        return "fence_mesh_green"
    if "mesh" in low or "fence" in low:
        return "fence_mesh_galv"
    if "gate" in low and "iron" in low:
        return "gate_wrought_iron"
    if "gate" in low:
        return "barn_gate"
    if "palisade" in low:
        return "wall_palisade_brown"
    if "block" in low and "dark" in low:
        return "wall_block_dark"
    if "block" in low:
        return "wall_block_light"
    if "fachwerk" in low and "yellow" in low:
        return "wall_fachwerk_yellow"
    if "fachwerk" in low:
        return "wall_fachwerk_white"
    if "brick" in low and "lime" in low:
        return "wall_limestone_brick"
    if "brick" in low:
        return "wall_brick_barn_yellow"
    if "rubble" in low or "stone" in low:
        return "wall_rubble_barn"
    if "timber" in low or "wood" in low:
        return "wall_timber_vertical"
    if "barn" in low:
        return "wall_barn"
    if "mustard" in low:
        return "wall_mustard_yellow"
    if "ochre" in low:
        return "wall_ochre"
    if "yellow" in low or "gold" in low:
        return "wall_butter_yellow"
    if "coral" in low or "salmon" in low or "red" in low:
        return "wall_coral_terracotta"
    if "blush" in low or "pink" in low or "rose" in low:
        return "wall_blush_clean"
    if "terracotta" in low:
        return "wall_terracotta"
    if "peach" in low:
        return "wall_peach_plain"
    if "sage" in low or "blue" in low or "green" in low:
        return "wall_sage"
    if "buff" in low or "sand" in low or "beige" in low:
        return "wall_sandstone_buff"
    if "gray" in low or "grey" in low:
        return "wall_cool_gray_light"
    if "bauhaus" in low:
        return "wall_bauhaus_white"
    if "white" in low:
        return "wall_white_clean"
    if "util" in low:
        return "wall_utility"
    return default


def load_street_overrides_glob(
    valid_mats: set,
    excluded_ids: set,
    existing_buildings: List[Dict],
) -> Tuple[int, List[Dict], List[Dict]]:
    """
    Auto-glob data/streets/*/overrides.json (sorted by slug), validate & sanitize every override,
    merge non-conflicting building overrides into BUILDING_OVERRIDES (protecting Wave 1+2 overrides!),
    deduplicate infill buildings (auto-sampling DGM1 elevation if missing), and return accessories.
    """
    streets_dir = os.path.join(PROJECT_ROOT, "data/streets")
    files = sorted(glob.glob(os.path.join(streets_dir, "*", "overrides.json")))
    if not files:
        return 0, [], []

    # Load DGM1 elevation sampler for infill buildings missing baseElevationM
    hm_path = os.path.join(PROJECT_ROOT, "data/terrain/heightmap.bin")
    hm_vals, hm_n = None, 0
    if os.path.exists(hm_path):
        import struct
        raw = open(hm_path, "rb").read()
        hm_n = int(round(math.sqrt(len(raw) // 4)))
        hm_vals = struct.unpack(f"<{hm_n * hm_n}f", raw)

    def sample_elev(wx: float, wz: float) -> float:
        if hm_vals is None or hm_n < 2:
            return 60.0
        u = max(0.0, min(1.0, (wx + 1024.0) / 2048.0)) * (hm_n - 1)
        v = max(0.0, min(1.0, (wz + 1024.0) / 2048.0)) * (hm_n - 1)
        c0, r0 = int(math.floor(u)), int(math.floor(v))
        c1, r1 = min(hm_n - 1, c0 + 1), min(hm_n - 1, r0 + 1)
        fu, fv = u - c0, v - r0
        return (
            (hm_vals[r0 * hm_n + c0] * (1.0 - fu) + hm_vals[r0 * hm_n + c1] * fu) * (1.0 - fv)
            + (hm_vals[r1 * hm_n + c0] * (1.0 - fu) + hm_vals[r1 * hm_n + c1] * fu) * fv
        )

    protected_wave12 = set(BUILDING_OVERRIDES.keys())
    existing_infill_ids = {str(b.get("id")) for b in CORRIDOR_INFILL_BUILDINGS}

    merged_count = 0
    dup_ov_ids = []
    extra_infills: List[Dict] = []
    extra_accessories: List[Dict] = []

    ROOF_SHAPE_ALIASES = {
        "gable": "gabled",
        "gabled": "gabled",
        "hip": "hipped",
        "hipped": "hipped",
        "half-hipped": "half-hipped",
        "half_hipped": "half-hipped",
        "halfhipped": "half-hipped",
        "pyramidal": "pyramidal",
        "pyramid": "pyramidal",
        "skillion": "skillion",
        "shed": "skillion",
        "monopitch": "skillion",
        "flat": "flat",
    }

    def sanitize_ov(raw_ov: Dict) -> Dict:
        out = {}
        if not isinstance(raw_ov, dict):
            return out
        if raw_ov.get("skip"):
            out["skip"] = True
            return out
        for k, role, dflt in [
            ("wall_mat", "wall", "wall_cream"),
            ("gable_wall_mat", "wall", "wall_cream"),
            ("dormer_mat", "wall", "wall_cream"),
            ("plinth_mat", "plinth", "plinth"),
            ("roof_mat", "roof", "roof_terracotta"),
            ("balcony_mat", "trim", "trim_wood"),
            ("fascia_mat", "trim", "trim_wood"),
        ]:
            if raw_ov.get(k):
                out[k] = sanitize_material_key(raw_ov[k], valid_mats, role=role, default=dflt)
        for fk in ("wall_h", "roof_h", "plinth_above", "balcony_w"):
            if raw_ov.get(fk) is not None:
                try:
                    out[fk] = float(raw_ov[fk])
                except Exception:
                    pass
        if raw_ov.get("roof_shape"):
            rs = ROOF_SHAPE_ALIASES.get(str(raw_ov["roof_shape"]).lower().strip())
            if rs:
                out["roof_shape"] = rs
        for bk in ("rotate_ridge_90", "is_windowed", "no_door", "no_attic_window", "force_dormer", "bauhaus_penthouse"):
            if bk in raw_ov:
                out[bk] = bool(raw_ov[bk])
        # Direction fields (accept compass strings OR Blender [dx, dy] vectors, plus aliases!)
        pv = parse_dir_blender(raw_ov.get("solar_pv_dir") or raw_ov.get("solar_slope"))
        if pv is not None:
            out["solar_pv_dir"] = pv
        iv = parse_dir_blender(raw_ov.get("ivy_dir") or raw_ov.get("ivy_sides"))
        if iv is not None:
            out["ivy_dir"] = iv
        bd = parse_dir_blender(raw_ov.get("balcony_dir"))
        if bd is not None:
            out["balcony_dir"] = bd
        dd = parse_dir_blender(raw_ov.get("dormer_dir"))
        if dd is not None:
            out["dormer_dir"] = dd
        return out

    parsed_docs: List[Tuple[str, Dict]] = []
    for fp in files:
        slug = os.path.basename(os.path.dirname(fp))
        try:
            with open(fp, "r", encoding="utf-8") as f:
                doc = json.load(f)
        except Exception as e:
            print(f"[WARN] Could not parse {fp}: {e}")
            continue
        if isinstance(doc, dict):
            parsed_docs.append((slug, doc))

    # Pass 1: Merge ALL per-street building_overrides first so newly-skipped slivers
    # don't falsely block replacement infill_buildings in Pass 2!
    # Rule: If ANY street marks a broken LoD2 sliver as skip=True (typically replacing it
    # with a verified full infill or marking a demolished structure), skip ALWAYS wins!
    seen_street_bids = {}
    for slug, doc in parsed_docs:
        b_ovs = doc.get("building_overrides") or doc.get("BUILDING_OVERRIDES") or doc.get("overrides") or {}
        if isinstance(b_ovs, dict):
            for bid, raw_ov in b_ovs.items():
                bid_s = str(bid).strip()
                if not bid_s or bid_s in excluded_ids or bid_s in protected_wave12:
                    continue
                clean = sanitize_ov(raw_ov)
                if clean:
                    if bid_s in seen_street_bids:
                        dup_ov_ids.append((bid_s, seen_street_bids[bid_s], slug))
                        # Never overwrite an earlier skip=True with a non-skip override!
                        if BUILDING_OVERRIDES.get(bid_s, {}).get("skip") and not clean.get("skip"):
                            continue
                    seen_street_bids[bid_s] = slug
                    clean["_from_street"] = True
                    BUILDING_OVERRIDES[bid_s] = clean
                    merged_count += 1

    # Build occupied_centers & polygons AFTER Pass 1 skips are applied!
    occupied_centers = []
    occupied_polys: List[Tuple[Tuple[float, float, float, float], List[Tuple[float, float]]]] = []

    def fp_bbox(poly: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        return (min(xs), min(zs), max(xs), max(zs))

    def poly_overlap_frac(
        bb1: Tuple[float, float, float, float], poly1: List[Tuple[float, float]],
        bb2: Tuple[float, float, float, float], poly2: List[Tuple[float, float]],
    ) -> float:
        ix0, iz0 = max(bb1[0], bb2[0]), max(bb1[1], bb2[1])
        ix1, iz1 = min(bb1[2], bb2[2]), min(bb1[3], bb2[3])
        if ix1 <= ix0 or iz1 <= iz0:
            return 0.0
        hits = 0
        nx, nz = 7, 7
        for ix in range(nx):
            px = ix0 + (ix + 0.5) * (ix1 - ix0) / nx
            for iz in range(nz):
                pz = iz0 + (iz + 0.5) * (iz1 - iz0) / nz
                if point_in_polygon(px, pz, poly1) and point_in_polygon(px, pz, poly2):
                    hits += 1
        if hits == 0:
            return 0.0
        inter_area = (hits / (nx * nz)) * (ix1 - ix0) * (iz1 - iz0)
        a1 = max(abs(signed_area_2d(poly1)), 1e-3)
        a2 = max(abs(signed_area_2d(poly2)), 1e-3)
        return inter_area / min(a1, a2)

    for b in list(existing_buildings) + list(CORRIDOR_INFILL_BUILDINGS):
        bid = str(b.get("id", ""))
        if BUILDING_OVERRIDES.get(bid, {}).get("skip"):
            continue
        c = b.get("center")
        if c and len(c) >= 2:
            occupied_centers.append((float(c[0]), float(c[1])))
        bfp = b.get("footprint") or []
        if len(bfp) >= 3:
            bpoly = [(float(p[0]), float(p[1])) for p in bfp]
            occupied_polys.append((fp_bbox(bpoly), bpoly))

    # Pass 2: Merge infill_buildings & accessories (with 2D polygon overlap dedup!)
    skipped_infill_dups = 0
    for slug, doc in parsed_docs:
        infs = doc.get("infill_buildings") or doc.get("INFILL_BUILDINGS") or doc.get("infills") or []
        if isinstance(infs, list):
            for inf in infs:
                if not isinstance(inf, dict):
                    continue
                iid = str(inf.get("id") or f"infill/{slug}_{len(extra_infills) + 1}")
                if iid in existing_infill_ids or iid in excluded_ids:
                    skipped_infill_dups += 1
                    continue
                raw_fp = inf.get("footprint") or []
                if len(raw_fp) < 3:
                    continue
                ipoly = [(float(p[0]), float(p[1])) for p in raw_fp]
                ibb = fp_bbox(ipoly)
                cx = sum(p[0] for p in ipoly) / len(ipoly)
                cz = sum(p[1] for p in ipoly) / len(ipoly)
                # Reject accidental duplicates overlapping non-skipped existing buildings or earlier infills
                if any(math.hypot(cx - ox, cz - oz) < 2.8 for ox, oz in occupied_centers):
                    skipped_infill_dups += 1
                    continue
                if any(poly_overlap_frac(ibb, ipoly, obb, opoly) > 0.22 for obb, opoly in occupied_polys):
                    skipped_infill_dups += 1
                    continue
                elev = inf.get("baseElevationM")
                if elev is None:
                    elev = round(sample_elev(cx, cz), 2)
                rs_clean = ROOF_SHAPE_ALIASES.get(str(inf.get("roofShape", "gabled")).lower().strip(), "gabled")
                clean_inf = {
                    "id": iid,
                    "category": str(inf.get("category", "residential")),
                    "center": [round(cx, 2), round(cz, 2)],
                    "baseElevationM": float(elev),
                    "wallHeightM": float(inf.get("wallHeightM", 5.0)),
                    "roofHeightM": float(inf.get("roofHeightM", 3.0)),
                    "roofShape": rs_clean,
                    "roofTone": str(inf.get("roofTone", "terracotta")),
                    "footprint": [[float(p[0]), float(p[1])] for p in raw_fp],
                }
                raw_inf_ov = inf.get("override") if isinstance(inf.get("override"), dict) else inf
                clean_inf_ov = sanitize_ov(raw_inf_ov)
                if clean_inf_ov:
                    clean_inf["override"] = clean_inf_ov
                existing_infill_ids.add(iid)
                occupied_centers.append((cx, cz))
                occupied_polys.append((ibb, ipoly))
                extra_infills.append(clean_inf)

        accs = doc.get("accessories") or doc.get("STREET_ACCESSORIES") or doc.get("street_accessories") or []
        if isinstance(accs, list):
            extra_accessories.extend(accs)

    print(
        f"Auto-merged {len(parsed_docs)} street override files: "
        f"+{merged_count} building overrides ({len(dup_ov_ids)} cross-street overlaps), "
        f"+{len(extra_infills)} infills ({skipped_infill_dups} deduped), "
        f"+{len(extra_accessories)} accessories"
    )
    if dup_ov_ids:
        print(f"  Cross-street duplicate building IDs (last slug won): {dup_ov_ids[:15]}")
    return merged_count, extra_infills, extra_accessories


def run_production(
    scene_json_path: str,
    landmarks_manifest_path: Optional[str],
    extra_exclude_ids: List[str],
    render_aerial: str,
    render_street: str,
    skip_archetypes: bool = False,
    render_corridors_dir: str = "",
):
    with open(scene_json_path, "r", encoding="utf-8") as f:
        scene_data = json.load(f)

    buildings = scene_data.get("buildings", [])
    excluded_ids = load_excluded_landmark_ids(landmarks_manifest_path, extra_exclude_ids)
    print(f"Loaded {len(buildings)} OSM buildings from {scene_json_path}; excluding {len(excluded_ids)} landmark IDs: {sorted(excluded_ids)}")

    clear_scene()
    mats = create_material_library()
    valid_mats = set(mats.keys())

    # Auto-glob & defensively merge ALL data/streets/*/overrides.json!
    _, street_infills, street_accessories = load_street_overrides_glob(valid_mats, excluded_ids, buildings)

    # Extract road centerline segments for tractor clearance checks on street accessories
    road_segments = []
    for r in scene_data.get("roads", []):
        rw = float(r.get("widthM") or 4.5)
        pts_r = r.get("points") or []
        for i in range(len(pts_r) - 1):
            p0, p1 = pts_r[i], pts_r[i + 1]
            if len(p0) >= 3 and len(p1) >= 3:
                road_segments.append((float(p0[0]), float(p0[2]), float(p1[0]), float(p1[2]), rw))

    chunk_names = ("village_center", "village_north", "village_south", "village_outskirts")
    builders = {cn: VillageMeshBuilder(cn, mats) for cn in chunk_names}
    chunk_counts = {cn: 0 for cn in chunk_names}
    built_ids = []
    skipped_landmark_ids = []
    elevs = []

    all_buildings = list(buildings) + list(CORRIDOR_INFILL_BUILDINGS) + list(street_infills)
    for b in all_buildings:
        bid = str(b.get("id", ""))
        osm_str = f"way/{b.get('osmId')}" if b.get("osmId") is not None else ""
        lod2_str = f"lod2/{b.get('lod2Id')}" if b.get("lod2Id") is not None else ""
        if (
            b.get("landmarkKey") is not None
            or bid in excluded_ids
            or (osm_str and osm_str in excluded_ids)
            or (lod2_str and lod2_str in excluded_ids)
        ):
            skipped_landmark_ids.append(bid)
            continue
        fp = b.get("footprint", [])
        if len(fp) < 3:
            continue
        center = b.get("center")
        if center and len(center) >= 2:
            cx, cz = float(center[0]), float(center[1])
        else:
            cx = sum(p[0] for p in fp) / len(fp)
            cz = sum(p[1] for p in fp) / len(fp)
        ck = classify_chunk(cx, cz)
        if builders[ck].build_building(b):
            chunk_counts[ck] += 1
            built_ids.append(bid)
            elevs.append(float(b.get("baseElevationM", 0.0)))

    # Add Street-View-calibrated courtyard Hoftore, Bauhaus gateway + cypresses, hedges, walls & auto-merged street accessories!
    add_courtyard_accessories(
        builders,
        extra_accessories=street_accessories,
        road_segments=road_segments,
        valid_mats=valid_mats,
    )

    # Finalize chunk meshes, export GLBs, and collect manifest entries
    chunk_entries = []
    all_chunk_objs = []
    for cn in chunk_names:
        col = bpy.data.collections.new(cn)
        bpy.context.scene.collection.children.link(col)
        obj = builders[cn].finalize_object(col)
        if obj is None:
            continue
        all_chunk_objs.append(obj)
        glb_path = os.path.join(OUT_GLB_DIR, f"{cn}.glb")
        export_objects_glb([obj], glb_path)
        fsize = os.path.getsize(glb_path)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        chunk_entries.append({
            "id": cn,
            "glbPath": f"/assets/models/village/{cn}.glb",
            "buildingCount": chunk_counts[cn],
            "triangles": tris,
            "materialCount": len(obj.data.materials),
            "fileSizeBytes": fsize,
            "worldPositioned": True,
            "bounds": compute_gltf_bbox_obj(obj),
        })
        print(f"Exported {cn}.glb: {chunk_counts[cn]} buildings, {tris} tris, {fsize / 1024:.1f} KB")

    # Save full master .blend archive BEFORE adding temporary preview ground/camera!
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_ARCHIVE)
    print(f"Saved master Kindenheim village archive -> {BLEND_ARCHIVE}")

    # Load props metadata and write unified public/assets/models/village/manifest.json
    props_dict = {}
    if os.path.exists(PROPS_META):
        with open(PROPS_META, "r", encoding="utf-8") as f:
            props_dict = json.load(f)

    manifest = {
        "coordinateSystem": "Three.js Y-up meters (+X East, -Z North, +Y Up above minElevationM)",
        "worldPositionedChunks": True,
        "totalVillageBuildings": sum(chunk_counts.values()),
        "excludedLandmarkIds": sorted(set(excluded_ids)),
        "matchedExcludedLandmarkIds": sorted(set(skipped_landmark_ids)),
        "chunks": chunk_entries,
        "props": props_dict,
    }
    with open(MANIFEST_OUT, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"Wrote village manifest -> {MANIFEST_OUT} ({manifest['totalVillageBuildings']} buildings, {len(props_dict)} props)")

    if render_aerial or render_street or render_corridors_dir:
        med_elev = sorted(elevs)[len(elevs) // 2] if elevs else 56.0
        setup_sunlit_render_env(bpy.context.scene)
        add_preview_ground(bpy.context.scene, center_xy=(0.0, 60.0), z_elev=med_elev - 1.2, size=2200.0)
        if render_aerial:
            render_camera(
                bpy.context.scene,
                cam_loc=(-165.0, -95.0, med_elev + 95.0),
                target=(10.0, 72.0, med_elev + 5.0),
                lens=34.0,
                out_path=render_aerial,
            )
        if render_street:
            render_camera(
                bpy.context.scene,
                cam_loc=(79.42, 79.24, 53.5 + 3.2),
                target=(-15.7, 48.3, 53.5 + 8.5),
                lens=26.0,
                out_path=render_street,
            )
        if render_corridors_dir:
            os.makedirs(render_corridors_dir, exist_ok=True)
            # 1. sv_kirche_full_west (Hauptstr 62 ochre + Hoftor + #60 solar PV + ivy!)
            render_camera(
                bpy.context.scene,
                cam_loc=(-54.5, 44.0, 57.5 + 2.6),
                target=(-32.0, 66.0, 57.5 + 8.5),
                lens=22.0,
                out_path=os.path.join(render_corridors_dir, "preview_corridor_kirche_west.png"),
            )
            # 2. sv_weingut_kreutzenberger (1929 Bauhaus crisp white + vertical-slat sliding gate + cypresses!)
            render_camera(
                bpy.context.scene,
                cam_loc=(474.0, 223.0, 38.2 + 2.5),
                target=(490.0, 211.0, 38.2 + 4.8),
                lens=22.0,
                out_path=os.path.join(render_corridors_dir, "preview_corridor_kreutzenberger.png"),
            )
            # 3. sv_hauptstrasse_west_weingueter (checkered plinths + arched wrought-iron Hoftor!)
            render_camera(
                bpy.context.scene,
                cam_loc=(79.4, 79.2, 53.5 + 2.5),
                target=(55.0, 72.0, 53.5 + 4.8),
                lens=22.0,
                out_path=os.path.join(render_corridors_dir, "preview_corridor_hauptstr59.png"),
            )
            # 4. sv_hauptstrasse_center_east (Hauptstr 36 yellow+ivy left & #45 blush+charcoal gate right!)
            render_camera(
                bpy.context.scene,
                cam_loc=(150.5, 115.0, 52.2 + 2.5),
                target=(172.0, 123.0, 52.2 + 5.0),
                lens=22.0,
                out_path=os.path.join(render_corridors_dir, "preview_corridor_hauptstr36_45.png"),
            )
            # --- Wave 2 Corridor Previews (Triftstraße, Am Kirchrain & Adjacent Streets!) ---
            # Note Blender coords: (localX, -localZ, elev + 2.5)
            # 5. sv_triftstrasse_north_entry (cam=-317.35, 65.88, hdg=170° -> SSE)
            render_camera(
                bpy.context.scene,
                cam_loc=(-317.35, -65.88, 69.5 + 2.5),
                target=(-312.0, -95.0, 68.8 + 4.2),
                lens=20.0,
                out_path=os.path.join(render_corridors_dir, "preview_trift_north_entry.png"),
            )
            # 6. sv_triftstrasse_mid_northbound (cam=-307.96, 177.11, hdg=350° -> NNW)
            render_camera(
                bpy.context.scene,
                cam_loc=(-307.96, -177.11, 64.5 + 2.5),
                target=(-313.5, -146.0, 66.2 + 4.5),
                lens=20.0,
                out_path=os.path.join(render_corridors_dir, "preview_trift_mid_northbound.png"),
            )
            # 7. sv_kirchrain_sw_eastbound (cam=-587.37, 94.70, hdg=54° -> ENE)
            render_camera(
                bpy.context.scene,
                cam_loc=(-587.37, -94.70, 84.1 + 2.5),
                target=(-562.0, -76.5, 83.2 + 4.2),
                lens=20.0,
                out_path=os.path.join(render_corridors_dir, "preview_kirchrain_sw_eastbound.png"),
            )
            # 8. sv_kirchrain_mid_westbound (cam=-533.31, 64.76, hdg=234° -> WSW)
            render_camera(
                bpy.context.scene,
                cam_loc=(-533.31, -64.76, 82.3 + 2.5),
                target=(-558.0, -82.5, 83.5 + 4.2),
                lens=20.0,
                out_path=os.path.join(render_corridors_dir, "preview_kirchrain_mid_westbound.png"),
            )
            # 9. sv_kirchrain_ne_eastbound (cam=-474.65, 31.86, hdg=58° -> ENE)
            render_camera(
                bpy.context.scene,
                cam_loc=(-474.65, -31.86, 81.1 + 2.5),
                target=(-448.0, -15.5, 80.8 + 3.8),
                lens=20.0,
                out_path=os.path.join(render_corridors_dir, "preview_kirchrain_ne_eastbound.png"),
            )
            # 10. sv_kirchrain_north_southbound (cam=-423.13, -31.78, hdg=175° -> S)
            render_camera(
                bpy.context.scene,
                cam_loc=(-423.13, 31.78, 84.3 + 2.5),
                target=(-420.5, 2.0, 81.0 + 3.8),
                lens=20.0,
                out_path=os.path.join(render_corridors_dir, "preview_kirchrain_north_southbound.png"),
            )
            # 11. sv_kirchrain_bend_east_vista (cam=-427.72, 8.77, hdg=78° -> ENE)
            render_camera(
                bpy.context.scene,
                cam_loc=(-427.72, -8.77, 80.5 + 2.5),
                target=(-396.0, -2.5, 79.2 + 3.8),
                lens=19.0,
                out_path=os.path.join(render_corridors_dir, "preview_kirchrain_bend_east.png"),
            )
            # 12. sv_extra_im_rosengarten (cam=-503.69, 117.61, hdg=244° -> WSW)
            render_camera(
                bpy.context.scene,
                cam_loc=(-503.69, -117.61, 77.7 + 2.5),
                target=(-532.0, -131.5, 78.5 + 4.0),
                lens=20.0,
                out_path=os.path.join(render_corridors_dir, "preview_im_rosengarten.png"),
            )
            # --- Wave 3 All-Streets Verification Previews (North/East/West/Central Corridors) ---
            # 13. Wave 3 High NE->SW Full-Village Aerial Overview
            render_camera(
                bpy.context.scene,
                cam_loc=(360.0, 290.0, med_elev + 135.0),
                target=(-60.0, 20.0, med_elev + 4.0),
                lens=30.0,
                out_path=os.path.join(render_corridors_dir, "preview_wave3_overview_ne.png"),
            )
            # 14. Wave 3 Neugasse / Sport- und Freizeithalle / Andingstraße Corridor
            render_camera(
                bpy.context.scene,
                cam_loc=(210.0, 205.0, 56.0 + 28.0),
                target=(115.0, 238.0, 56.0 + 3.0),
                lens=26.0,
                out_path=os.path.join(render_corridors_dir, "preview_wave3_neugasse_anding.png"),
            )
            # 15. Wave 3 Bergstraße / Grabenweg / Kellergasse West Hillside Corridor
            render_camera(
                bpy.context.scene,
                cam_loc=(-175.0, 55.0, 68.0 + 26.0),
                target=(-215.0, 170.0, 74.0 + 4.0),
                lens=26.0,
                out_path=os.path.join(render_corridors_dir, "preview_wave3_bergstrasse.png"),
            )
            # 16. Wave 3 Am Kinderbach / Gässelstraße / Raiffeisenstraße East Village Corridor
            render_camera(
                bpy.context.scene,
                cam_loc=(280.0, 120.0, 48.0 + 32.0),
                target=(430.0, 65.0, 44.0 + 3.0),
                lens=26.0,
                out_path=os.path.join(render_corridors_dir, "preview_wave3_kinderbach_east.png"),
            )

    if not skip_archetypes:
        save_modular_archetypes()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--scene", type=str, default=os.path.join(PROJECT_ROOT, "data/osm/kindenheim_scene.json"))
    parser.add_argument("--landmarks-manifest", type=str, default=os.path.join(PROJECT_ROOT, "public/assets/models/landmarks/manifest.json"))
    parser.add_argument("--exclude-ids", type=str, default="", help="Comma-separated extra landmark OSM IDs to exclude")
    parser.add_argument("--render", type=str, default="")
    parser.add_argument("--render-aerial", type=str, default="")
    parser.add_argument("--render-street", type=str, default="")
    parser.add_argument("--render-corridors-dir", type=str, default="")
    parser.add_argument("--skip-archetypes", action="store_true")
    args = parser.parse_args(argv)

    if args.demo:
        run_demo(args.render)
        save_modular_archetypes()
    else:
        extra = [s.strip() for s in args.exclude_ids.split(",") if s.strip()]
        run_production(
            args.scene,
            args.landmarks_manifest,
            extra,
            args.render_aerial,
            args.render_street,
            skip_archetypes=args.skip_archetypes,
            render_corridors_dir=args.render_corridors_dir,
        )


if __name__ == "__main__":
    main()
