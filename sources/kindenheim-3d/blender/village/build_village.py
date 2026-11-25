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
    ):
        mats[f"wall_{col}"] = make_arch_material(
            f"Pfalz_Wall_{col}",
            albedo_file=f"wall_{col}_albedo.jpg",
            normal_file="facade_clean_normal.png" if col != "bauhaus_white" else None,
            rough_file="facade_clean_rough.png" if col != "bauhaus_white" else None,
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
    mats["cypress_foliage"] = make_arch_material(
        "Pfalz_Cypress_Foliage",
        albedo_file="ivy_foliage_albedo.jpg",
        normal_file="ivy_foliage_normal.png",
        base_color=(0.14, 0.26, 0.12, 1.0),
        roughness=0.76,
        normal_strength=1.35,
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
    ):
        """Add stacked dark-stained Pfalz timber balconies on the specified facade (Neugasse villa QOR1)."""
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
            if elen < 5.0:
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
        bw = min(elen * 0.72, 9.2)
        bd = 1.25
        mx, my = 0.5 * (x0 + x1) + nx * (bd * 0.5), 0.5 * (y0 + y1) + ny * (bd * 0.5)
        for bz in (z_base + 3.05, z_base + 5.75):
            if bz > z_eave + 0.5:
                continue
            # Deck slab + front balustrade rail + top handrail + side rails
            self.add_box(Vector((mx, my, bz)), u_vec, v_vec, sx=bw, sy=bd, sz=0.22, mat_key="trim_wood", uv_scale=2.0)
            front_c = Vector((mx + nx * (bd * 0.45), my + ny * (bd * 0.45), bz + 0.56))
            self.add_box(front_c, u_vec, v_vec, sx=bw, sy=0.12, sz=0.92, mat_key="trim_wood", uv_scale=2.0)
            for sgn in (-1.0, 1.0):
                sc = Vector((mx + ex * sgn * (bw * 0.48), my + ey * sgn * (bw * 0.48), bz + 0.56))
                self.add_box(sc, u_vec, v_vec, sx=0.14, sy=bd, sz=0.92, mat_key="trim_wood", uv_scale=2.0)

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

        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            elen = math.hypot(x1 - x0, y1 - y0)
            if elen < 0.08:
                continue
            if is_windowed:
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
            full_clad_mats = {"wall_timber_vertical", "wall_fachwerk_yellow", "wall_brick_barn_yellow", "wall_peach_plain", "wall_utility"}
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
                if is_stucco_wall and len_v >= 5.2 and roof_h >= 2.2:
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
                self.add_quad(r0_b, e0_b, e1_b, r1_b, ((0, 0), (0, 1), (1, 1), (1, 0)), "trim_wood")
                self.add_quad(e0_b, e0_t, e1_t, e1_b, ((0, 0), (0, 0.2), (tile_u, 0.2), (tile_u, 0)), "trim_wood")
                self.add_quad(r0_b, r0_t, e0_t, e0_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), "trim_wood")
                self.add_quad(e1_b, e1_t, r1_t, r1_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), "trim_wood")
            else:
                self.add_quad(e1_t, r1_t, r0_t, e0_t, ((0, 0), (0, tile_v), (tile_u, tile_v), (tile_u, 0)), roof_mat)
                self.add_quad(r1_b, e1_b, e0_b, r0_b, ((0, 0), (0, 1), (1, 1), (1, 0)), "trim_wood")
                self.add_quad(e1_b, e1_t, e0_t, e0_b, ((0, 0), (0, 0.2), (tile_u, 0.2), (tile_u, 0)), "trim_wood")
                self.add_quad(e0_b, e0_t, r0_t, r0_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), "trim_wood")
                self.add_quad(r1_b, r1_t, e1_t, e1_b, ((0, 0), (0, 0.2), (tile_v, 0.2), (tile_v, 0)), "trim_wood")

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
            n_dormers = 2 if (len_u >= 14.0 and dormer_mat is None) else 1
            d_offsets = [-hu * 0.38, hu * 0.38] if n_dormers == 2 else [0.0]
            # If dormer_mat override (Michelsberg QOQx), put dormer on south-facing slope!
            if dormer_mat is not None:
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

    def add_skillion_roof(self, obb: Dict, z_eave: float, roof_h: float, wall_mat: str, roof_mat: str, overhang: float = 0.26):
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
        thick = 0.14
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
        self.add_quad(b0, b1, b2, b3, ((0, 0), (1, 0), (1, 1), (0, 1)), "trim_wood")
        for q0, q1, r1, r0 in [(b0, b1, p1, p0), (b1, b2, p2, p1), (b2, b3, p3, p2), (b3, b0, p0, p3)]:
            self.add_quad(q0, q1, r1, r0, ((0, 0), (1, 0), (1, 0.2), (0, 0.2)), "trim_wood")

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
        non_windowed_mats = {"wall_barn", "wall_utility", "wall_peach_plain", "wall_brick_barn_yellow", "wall_timber_vertical", "wall_fachwerk_yellow"}
        is_windowed = ov.get("is_windowed", (not is_utility) and (wall_mat not in non_windowed_mats))
        self.add_facade_wall_ring(pts, z_plinth_top, z_eave, wall_mat, is_windowed=is_windowed)

        # 2b. Optional Climbing Ivy Blankets & Dark Timber Balconies on exact corridor buildings!
        ivy_dir = ov.get("ivy_dir")
        if ivy_dir is not None:
            self.add_ivy_blanket_on_wall(pts, z_plinth_top, z_eave, ivy_dir)
        balcony_dir = ov.get("balcony_dir")
        if balcony_dir is not None:
            self.add_dark_balconies(pts, z_base, z_eave, balcony_dir)

        # 3. 3D Front Door / Barn Gate Accent on main street/courtyard wall
        if not ov.get("no_door", False) and not is_utility and poly_area >= 42.0:
            self.add_door_or_gate(pts, z_base, z_eave, is_barn=is_barn, seed=h)

        # 4. Exact LoD2-Matched Roof Geometry (Flat Parapet / Skillion / Multi-Wing Gabled / Hipped)
        gable_wall_mat = ov.get("gable_wall_mat")
        dormer_mat = ov.get("dormer_mat")
        solar_pv_dir = ov.get("solar_pv_dir")
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
                self.add_skillion_roof(obb, z_eave, max(0.45, roof_h), wall_mat, roof_mat, overhang=0.22)
        elif rectangularity < 0.78 and poly_area >= 45.0 and not ov.get("roof_shape"):
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
                        add_chimney=(w_idx == 0 and not is_barn),
                        add_dormer=(w_idx == 0 and not is_barn and (h % 4 == 0)),
                        seed=h + w_idx * 17,
                        gable_wall_mat=gable_wall_mat,
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


def add_courtyard_accessories(builders: Dict[str, VillageMeshBuilder]):
    """Add Street-View-exact Kindenheim courtyard gates (Hoftore), canopies, Bauhaus sliding gate + cypresses, hedges & rubble walls."""

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

    chunk_names = ("village_center", "village_north", "village_south", "village_outskirts")
    builders = {cn: VillageMeshBuilder(cn, mats) for cn in chunk_names}
    chunk_counts = {cn: 0 for cn in chunk_names}
    built_ids = []
    skipped_landmark_ids = []
    elevs = []

    all_buildings = list(buildings) + list(CORRIDOR_INFILL_BUILDINGS)
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

    # Add Street-View-calibrated courtyard Hoftore, Bauhaus gateway + cypresses, hedges & walls!
    add_courtyard_accessories(builders)

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
