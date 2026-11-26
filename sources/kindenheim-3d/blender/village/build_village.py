#!/usr/bin/env python3
"""
Footprint-Accurate Palatinate (Pfalz) Village Architecture Builder for Kindenheim (Rheinland-Pfalz).

Builds every real OSM / LoD2 building polygon of Kindenheim (hero landmarks excluded) as real geometry,
positioned in world space (Blender (x, -z, y) -> glTF Y-up (x, y, z)), and exports four spatial chunks.

V2 (graphics overhaul) - what a house is made of:
- Walls with REAL openings: recessed windows (reveals, sandstone / painted surrounds, sills), folding shutters,
  recessed front doors with steps, barn gates, garage doors, string courses, half-timbering as separate beams.
  Detail tiers per wall: 'A' = faces / is visible from a street (full depth), 'B' = rear (flush window units in
  wall cut-outs), 'party' = wall on wall (blank). Tiers come from the road network + neighbouring footprints.
- Plinth course standing proud of the wall, cut out at doors; 2 m buried skirt (no floating houses on slopes).
- Roofs with thickness: tiles, soffit, fascia, barge boards + verge tile course, saddle ridge tiles, zinc gutters
  and downpipes, brick chimneys, dormers with windows, roof lights, module-accurate solar PV.
- Materials: photo-scanned CC0 library (blender/shared_textures, real-world UV scale from library.json).
  Colour per house = neutral scan x linear vertex colour ('Col' / COLOR_0): tint, dirt at the wall foot,
  rain shadow under the eaves, per-house roof tone. Authored atlases only for windows / joinery / PV
  (blender/village/generate_textures.py).
- Windows: `Pfalz_Window_Glass` (dark mirror glass via ORM) and `Pfalz_Window_Glass_Lit_A|B|C` (same atlas +
  emissive interior); src/buildings.ts fades the lit groups in at dusk (setTimeOfDay contract).
- Export: Draco-compressed GLB chunks (village_center / _north / _south / _outskirts). Textures are NOT embedded:
  they are published once to public/assets/models/village/tex/ and referenced by relative URI from all chunks.
- manifest.json: only the chunk / building keys are rewritten; the "props" section is preserved verbatim.
- The per-building override vocabulary (BUILDING_OVERRIDES, data/streets/*/overrides.json: wall_mat, roof_mat,
  plinth_mat, ...) is unchanged - every key resolves through the SEM palette to a real material + tint.

Usage:
  Demo (8 test houses -> public/assets/models/village/_wip/demo_village.glb):
    /opt/homebrew/bin/blender --background --python blender/village/build_village.py -- --demo --skip-archetypes

  Dev build next to the live chunks (view with http://localhost:<port>/?villageDir=_wip):
    /opt/homebrew/bin/blender --background --python blender/village/build_village.py -- --out-subdir _wip --no-blend
    (optionally --only-near x,z,radius)

  Production (rewrites the four live chunks, the master .blend, the archetypes and the manifest chunk keys):
    /opt/homebrew/bin/blender --background --python blender/village/build_village.py
"""

import argparse
import glob
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from typing import List, Tuple, Dict, Optional

import bpy
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
# Deterministic Hashing, Colour Helpers & PBR Material Library (V2: shared photo-scanned library)
# ---------------------------------------------------------------------------

SHARED_TEX_DIR = os.path.join(PROJECT_ROOT, "blender/shared_textures")
LIBRARY_JSON = os.path.join(SHARED_TEX_DIR, "library.json")
WEB_TEX_DIRNAME = "tex"
WEB_TEX_DIR = os.path.join(OUT_GLB_DIR, WEB_TEX_DIRNAME)

WHITE = (1.0, 1.0, 1.0)


def stable_hash_int(key: str) -> int:
    return int(hashlib.md5(str(key).encode("utf-8")).hexdigest()[:8], 16)


def hash01(key: str) -> float:
    """Deterministic pseudo-random float in [0, 1) for any string key."""
    return (int(hashlib.md5(str(key).encode("utf-8")).hexdigest()[:12], 16) % 1000003) / 1000003.0


def srgb_to_lin(c255: float) -> float:
    c = max(0.0, min(1.0, c255 / 255.0))
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin_rgb(rgb255) -> Tuple[float, float, float]:
    return (srgb_to_lin(rgb255[0]), srgb_to_lin(rgb255[1]), srgb_to_lin(rgb255[2]))


def mul3(a, b) -> Tuple[float, float, float]:
    if isinstance(b, (int, float)):
        return (a[0] * b, a[1] * b, a[2] * b)
    return (a[0] * b[0], a[1] * b[1], a[2] * b[2])


def clamp01_3(a) -> Tuple[float, float, float]:
    return (max(0.0, min(1.0, a[0])), max(0.0, min(1.0, a[1])), max(0.0, min(1.0, a[2])))


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_library() -> Dict[str, Dict]:
    if not os.path.exists(LIBRARY_JSON):
        raise RuntimeError(f"Shared texture library missing: {LIBRARY_JSON} (built by scripts/build_texture_library.py)")
    with open(LIBRARY_JSON, "r", encoding="utf-8") as f:
        lib = json.load(f)
    mats = lib.get("materials")
    if isinstance(mats, dict):
        return mats
    return {m["id"]: m for m in mats}


def load_image(path: str, colorspace: str = "sRGB", name: Optional[str] = None):
    """Load (never pack) an image; the image NAME is the cross-GLB texture identity (src/sharedAssets.ts)."""
    if not os.path.exists(path):
        raise RuntimeError(f"Texture file missing: {path}")
    want = name or os.path.splitext(os.path.basename(path))[0]
    img = bpy.data.images.get(want)
    if img is None:
        img = bpy.data.images.load(path, check_existing=False)
        img.name = want
    img.colorspace_settings.name = colorspace
    return img


def _gltf_output_group():
    """The glTF exporter reads ambient occlusion from a node group called 'glTF Material Output'."""
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.nodes.new("NodeGroupInput")
    return ng


def make_pbr_material(
    name: str,
    albedo_path: Optional[str] = None,
    normal_path: Optional[str] = None,
    orm_path: Optional[str] = None,
    emissive_path: Optional[str] = None,
    base_color=(1.0, 1.0, 1.0, 1.0),
    roughness: float = 0.85,
    metallic: float = 0.0,
    normal_strength: float = 1.0,
    alpha_clip: bool = False,
    double_sided: bool = False,
    vertex_tint: bool = True,
    alpha_blend: bool = False,
):
    """glTF-exportable Principled material: base colour = albedo texture x vertex colour ('Col'), ORM packed map."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic

    color_out = None
    if albedo_path:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = load_image(albedo_path, "sRGB")
        color_out = tex.outputs["Color"]
        if alpha_clip:
            math_n = nodes.new("ShaderNodeMath")
            math_n.operation = "ROUND"
            links.new(tex.outputs["Alpha"], math_n.inputs[0])
            links.new(math_n.outputs["Value"], bsdf.inputs["Alpha"])
            mat.alpha_threshold = 0.45
        elif alpha_blend:
            links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.surface_render_method = "BLENDED"
    if vertex_tint:
        vcol = nodes.new("ShaderNodeVertexColor")
        vcol.layer_name = "Col"
        if color_out is not None:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            links.new(color_out, mix.inputs["A"])
            links.new(vcol.outputs["Color"], mix.inputs["B"])
            color_out = mix.outputs["Result"]
        else:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs["A"].default_value = base_color
            links.new(vcol.outputs["Color"], mix.inputs["B"])
            color_out = mix.outputs["Result"]
    if color_out is not None:
        links.new(color_out, bsdf.inputs["Base Color"])

    if orm_path:
        otex = nodes.new("ShaderNodeTexImage")
        otex.image = load_image(orm_path, "Non-Color")
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(otex.outputs["Color"], sep.inputs["Color"])
        links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        grp = nodes.new("ShaderNodeGroup")
        grp.node_tree = _gltf_output_group()
        links.new(sep.outputs["Red"], grp.inputs["Occlusion"])

    if normal_path:
        ntex = nodes.new("ShaderNodeTexImage")
        ntex.image = load_image(normal_path, "Non-Color")
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    if emissive_path:
        etex = nodes.new("ShaderNodeTexImage")
        etex.image = load_image(emissive_path, "sRGB")
        links.new(etex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0

    mat.use_backface_culling = not double_sided
    return mat


def _vt(fname: str) -> str:
    return os.path.join(TEX_DIR, fname)


# real material key -> spec.  lib: (library id, kind, '2k'|'1k')   own: file in blender/village/textures
#   tile  = metres covered by one texture repeat (real-world scale, from library.json)
#   mean  = library id whose average albedo normalises target colours (see tint_for)
REAL_SPECS: Dict[str, Dict] = {
    "plaster_smooth": dict(name="Pfalz_Plaster_Smooth", alb=("plaster_smooth", "1k"), nrm=("plaster_smooth", "2k"), orm=("plaster_smooth", "1k"), mean="plaster_smooth"),
    # rough render: neutral white albedo of the smooth scan (tintable) + relief / roughness of the coarse stucco scan
    "plaster_rough": dict(name="Pfalz_Plaster_Rough", alb=("plaster_smooth", "1k"), nrm=("plaster_rough", "2k"), orm=("plaster_rough", "1k"), mean="plaster_smooth", tile=1.15, normal_strength=0.6, ao_strength=0.45),
    "plaster_weathered": dict(name="Pfalz_Plaster_Weathered", alb=("plaster_weathered", "1k"), nrm=("plaster_weathered", "1k"), orm=("plaster_weathered", "1k"), mean="plaster_weathered"),
    "sandstone_red": dict(name="Pfalz_Sandstone_Red", alb=("sandstone_red_ashlar", "1k"), nrm=("sandstone_red_ashlar", "1k"), orm=("sandstone_red_ashlar", "1k"), mean="sandstone_red_ashlar"),
    # yellow ashlar shares normal + ORM pixels with the red one (same scan, recoloured albedo)
    "sandstone_yellow": dict(name="Pfalz_Sandstone_Yellow", alb=("sandstone_yellow_ashlar", "1k"), nrm=("sandstone_red_ashlar", "1k"), orm=("sandstone_red_ashlar", "1k"), mean="sandstone_yellow_ashlar"),
    "rubble": dict(name="Pfalz_Rubble_Stone", alb=("sandstone_rubble_wall", "1k"), nrm=("sandstone_rubble_wall", "1k"), orm=("sandstone_rubble_wall", "1k"), mean="sandstone_rubble_wall"),
    "brick": dict(name="Pfalz_Brick_Red", alb=("brick_red", "1k"), nrm=("brick_red", "1k"), orm=("brick_red", "1k"), mean="brick_red"),
    # Roof tile scale: one real-world course height for every tile scan (0.30 m exposed course, counted on the
    # 1K maps: clay red 8 courses, weathered pantiles 6, dark tiles 10 per repeat); slate courses are 0.20 m.
    "roof_clay_red": dict(name="Pfalz_Roof_Clay_Red", alb=("roof_tiles_clay_red", "1k"), nrm=("roof_tiles_clay_red", "1k"), orm=("roof_tiles_clay_red", "1k"), mean="roof_tiles_clay_red", tile=2.4),
    "roof_clay_weathered": dict(name="Pfalz_Roof_Clay_Weathered", alb=("roof_tiles_clay_weathered", "1k"), nrm=("roof_tiles_clay_weathered", "1k"), orm=("roof_tiles_clay_weathered", "1k"), mean="roof_tiles_clay_weathered", tile=1.8),   # 6 courses per repeat -> 0.30 m
    "roof_dark": dict(name="Pfalz_Roof_Tiles_Dark", alb=("roof_tiles_dark", "1k"), nrm=("roof_tiles_dark", "1k"), orm=("roof_tiles_dark", "1k"), mean="roof_tiles_dark", tile=3.0),   # 10 courses -> 0.30 m
    "roof_slate": dict(name="Pfalz_Roof_Slate", alb=("roof_slate", "1k"), nrm=("roof_slate", "1k"), orm=("roof_slate", "1k"), mean="roof_slate", tile=2.2),   # 11 courses per repeat -> 0.20 m
    "wood_planks": dict(name="Pfalz_Wood_Planks", alb=("wood_planks_weathered", "1k"), nrm=("wood_planks_weathered", "1k"), orm=("wood_planks_weathered", "1k"), mean="wood_planks_weathered"),
    "wood_beam": dict(name="Pfalz_Wood_Beam", alb=("wood_beam_oak", "1k"), nrm=("wood_beam_oak", "1k"), orm=("wood_beam_oak", "1k"), mean="wood_beam_oak"),
    "metal_corrugated": dict(name="Pfalz_Metal_Corrugated", alb=("metal_corrugated", "1k"), nrm=("metal_corrugated", "1k"), orm=("metal_corrugated", "1k"), mean="metal_corrugated"),
    "concrete": dict(name="Pfalz_Concrete", alb=("concrete", "1k"), nrm=("concrete", "1k"), orm=("concrete", "1k"), mean="concrete"),
    "gravel": dict(name="Pfalz_Gravel", alb=("gravel", "1k"), nrm=("gravel", "1k"), orm=("gravel", "1k"), mean="gravel"),
    # authored atlases (generate_textures.py)
    "window": dict(name="Pfalz_Window_Glass", own=("village_window_atlas_albedo.png", "village_window_atlas_normal.png", "village_window_atlas_orm.png"), tile=None, vertex_tint=False),
    "window_lit_a": dict(name="Pfalz_Window_Glass_Lit_A", own=("village_window_atlas_albedo.png", "village_window_atlas_normal.png", "village_window_atlas_orm.png"), emi="village_window_atlas_emissive.png", tile=None, vertex_tint=False),
    "window_lit_b": dict(name="Pfalz_Window_Glass_Lit_B", own=("village_window_atlas_albedo.png", "village_window_atlas_normal.png", "village_window_atlas_orm.png"), emi="village_window_atlas_emissive.png", tile=None, vertex_tint=False),
    "window_lit_c": dict(name="Pfalz_Window_Glass_Lit_C", own=("village_window_atlas_albedo.png", "village_window_atlas_normal.png", "village_window_atlas_orm.png"), emi="village_window_atlas_emissive.png", tile=None, vertex_tint=False),
    "joinery": dict(name="Pfalz_Joinery", own=("village_joinery_atlas_albedo.png", "village_joinery_atlas_normal.png", "village_joinery_atlas_orm.png"), tile=None),
    "solar": dict(name="Pfalz_Solar_PV", own=("village_solar_albedo.png", "village_solar_normal.png", "village_solar_orm.png"), tile=None, vertex_tint=False),
    "plinth_tile": dict(name="Pfalz_Plinth_Tile", own=("village_plinth_tile_albedo.png", "village_plinth_tile_normal.png", "village_plinth_tile_orm.png"), tile=0.72),
    # flat colour materials (vertex-tinted)
    "paint": dict(name="Pfalz_Paint", flat=dict(roughness=0.55, metallic=0.0), tile=None),
    # weathered zinc / copper rainwater goods: mid-grey and fairly rough so they do not mirror the blue sky
    "zinc": dict(name="Pfalz_Gutter_Zinc", flat=dict(roughness=0.58, metallic=0.30), tile=None),
    "grime": dict(name="Pfalz_Grime_Decal", decal="village_grime_atlas.png", tile=None),
    "ivy": dict(name="Pfalz_Ivy_Cards", cards="village_ivy_cards.png", tile=None),
    "signs": dict(name="Pfalz_Signs", flat_tex="village_signs.png", tile=None, vertex_tint=False),
    # garden greenery baked into the chunks (hedges, ivy, cypress columns) + alpha-cut fences / gates
    "gate_wrought_iron": dict(name="Pfalz_Gate_WroughtIron", legacy=dict(albedo="gate_wrought_iron.png", roughness=0.42, metallic=0.55, alpha_clip=True, double_sided=True), tile=None, vertex_tint=False),
    "gate_iron_dark": dict(name="Pfalz_Gate_IronDark", legacy=dict(albedo="gate_iron_dark.png", roughness=0.45, metallic=0.48, alpha_clip=True, double_sided=True), tile=None, vertex_tint=False),
    "gate_bauhaus_slat": dict(name="Pfalz_Gate_BauhausSlat", legacy=dict(albedo="gate_bauhaus_slat_albedo.jpg", normal="gate_bauhaus_slat_normal.png", roughness=0.48, metallic=0.36, double_sided=True), tile=None, vertex_tint=False),
    "fence_wood_picket": dict(name="Pfalz_Fence_WoodPicket", legacy=dict(albedo="fence_wood_picket.png", roughness=0.82, alpha_clip=True, double_sided=True), tile=None, vertex_tint=False),
    "fence_mesh_green": dict(name="Pfalz_Fence_MeshGreen", legacy=dict(albedo="fence_mesh_green.png", roughness=0.55, metallic=0.35, alpha_clip=True, double_sided=True), tile=None, vertex_tint=False),
    "fence_mesh_galv": dict(name="Pfalz_Fence_MeshGalv", legacy=dict(albedo="fence_mesh_galv.png", roughness=0.42, metallic=0.62, alpha_clip=True, double_sided=True), tile=None, vertex_tint=False),
    "bridge_railing_galv": dict(name="Pfalz_Bridge_RailingGalv", legacy=dict(albedo="bridge_railing_galv.png", roughness=0.36, metallic=0.68, alpha_clip=True, double_sided=True), tile=None, vertex_tint=False),
}

ZINC_GREY = (0.40, 0.41, 0.42)
COPPER_BROWN = (0.30, 0.19, 0.13)
# median linear luminance of the aerial-sampled roof colours per roofTone class (filled by run_production)
ROOF_CLASS_LUM: Dict[str, float] = {}

REAL_TILE: Dict[str, Optional[float]] = {}
REAL_MEAN_LIN: Dict[str, Tuple[float, float, float]] = {}


def atlas_cell(col: int, row: int, cols: int = 4, rows: int = 4, inset: float = 0.0025):
    """UV rect (u0, v0, u1, v1) of an atlas cell; row 0 is the TOP row of the image."""
    u0, u1 = col / cols + inset, (col + 1) / cols - inset
    v1, v0 = 1.0 - row / rows - inset, 1.0 - (row + 1) / rows + inset
    return (u0, v0, u1, v1)


def J_CELL(col: int, row: int):
    return atlas_cell(col, row, 4, 2)


# Semantic palette: the per-building override data (BUILDING_OVERRIDES, data/streets/*/overrides.json) keeps
# speaking the ORIGINAL material vocabulary; every key resolves to a real PBR material + vertex-colour tint.
#   rgb   = target surface colour (sRGB 0-255), normalised against the scan's mean albedo
#   mul   = direct linear multiplier on the scan (used where the target is not reachable by darkening)
#   plaster=True -> the building picks smooth / rough / weathered render itself (age & roughness variation)
def _P(r, g, b, **kw):
    d = dict(real="plaster_rough", rgb=(r, g, b), plaster=True)
    d.update(kw)
    return d


SEM: Dict[str, Dict] = {
    # --- rendered facades ---
    "wall_cream": _P(229, 222, 209), "wall_ochre": _P(210, 176, 111), "wall_warmwhite": _P(237, 234, 227),
    "wall_terracotta": _P(201, 163, 154), "wall_sage": _P(160, 172, 170), "wall_sandstone": _P(213, 205, 194),
    "wall_ochre_rolladen": _P(200, 163, 91, win="rolladen"), "wall_ochre_arched": _P(199, 169, 96, win="sprossen"),
    "wall_butter_yellow": _P(220, 209, 155), "wall_weathered_cream_dark": _P(204, 194, 176, aged=True),
    "wall_bauhaus_white": _P(234, 234, 234, era="modern", smooth=True), "wall_white_clean": _P(234, 233, 228),
    "wall_blush_clean": _P(197, 163, 154), "wall_siding_lower": _P(210, 206, 198),
    "wall_mustard_yellow": _P(204, 160, 67), "wall_coral_terracotta": _P(187, 112, 96),
    "wall_cool_gray": _P(178, 182, 181), "wall_cool_gray_light": _P(203, 203, 201),
    "wall_sandstone_buff": _P(188, 165, 129), "wall_modern_raffstore": _P(226, 227, 221, era="modern", smooth=True, win="raffstore"),
    "wall_mustard_porthole": _P(202, 158, 67), "wall_peach_plain": _P(224, 211, 194),
    "wall_utility": _P(216, 212, 201), "wall_barn": _P(211, 199, 176, aged=True),
    "wall_fachwerk_white": _P(229, 227, 223, fachwerk=True), "wall_fachwerk_yellow": _P(224, 211, 158, fachwerk=True),
    # --- exposed masonry / cladding ---
    "wall_rubble_barn": dict(real="rubble", mul=(0.96, 0.95, 0.93)),
    "wall_limestone_brick": dict(real="rubble", mul=(0.90, 0.90, 0.90)),
    "wall_brick_barn_yellow": dict(real="brick", mul=(1.0, 0.97, 0.84)),
    "wall_timber_vertical": dict(real="wood_planks", mul=(1.0, 0.90, 0.80)),
    "wall_block_light": dict(real="plaster_rough", rgb=(196, 193, 186)),
    "wall_block_dark": dict(real="concrete", mul=(0.86, 0.92, 1.0)),
    "wall_palisade_brown": dict(real="concrete", mul=(1.0, 0.68, 0.56)),
    # --- plinths ---
    "plinth": dict(real="sandstone_red", mul=(0.94, 0.94, 0.94)),
    "plinth_checkered": dict(real="plinth_tile"),
    "plinth_rubble": dict(real="rubble", mul=(0.98, 0.98, 0.98)),
    "plinth_red_smooth": dict(real="plaster_smooth", rgb=(155, 97, 74)),
    "plinth_slate_gray": dict(real="plaster_smooth", rgb=(92, 99, 106)),
    "plinth_concrete": dict(real="plaster_rough", rgb=(167, 169, 164)),
    # --- roofs ---
    "roof_terracotta": dict(real="roof_clay_red"),
    "roof_darkred": dict(real="roof_clay_red", mul=(0.74, 0.60, 0.62)),
    "roof_darkbrown": dict(real="roof_clay_weathered", mul=(0.66, 0.56, 0.52)),
    "roof_slate": dict(real="roof_slate", mul=(0.30, 0.31, 0.34)),
    "roof_metal": dict(real="metal_corrugated", mul=(1.0, 1.0, 1.0)),
    "roof_flat": dict(real="concrete", mul=(0.80, 0.84, 0.90)),
    "roof_red_bright": dict(real="paint", rgb=(184, 62, 52)),
    # --- trims & details ---
    "trim_wood": dict(real="wood_beam", mul=(0.50, 0.37, 0.29)),
    "trim_honey_wood": dict(real="wood_beam", mul=(1.0, 0.72, 0.42)),
    "trim_white": dict(real="paint", rgb=(232, 230, 224)),
    "gutter_metal": dict(real="zinc", mul=ZINC_GREY),
    "sign_kdc_blue": dict(real="paint", rgb=(46, 92, 160)),
    "solar_pv": dict(real="solar"),
    "barn_gate": dict(real="joinery", rgb=(120, 92, 64), uvrect=J_CELL(2, 1)),
    "door_wood": dict(real="joinery", rgb=(128, 92, 66), uvrect=J_CELL(2, 0)),
    # hedges / cypress columns / slab ivy are no longer built here (see DROPPED_GREENERY)
    "ivy_foliage": dict(real="ivy"), "hedge_olive": dict(real="ivy"), "cypress_foliage": dict(real="ivy"),
    "gate_wrought_iron": dict(real="gate_wrought_iron"), "gate_iron_dark": dict(real="gate_iron_dark"),
    "gate_bauhaus_slat": dict(real="gate_bauhaus_slat"),
    "fence_wood_picket": dict(real="fence_wood_picket"), "fence_mesh_green": dict(real="fence_mesh_green"),
    "fence_mesh_galv": dict(real="fence_mesh_galv"), "bridge_railing_galv": dict(real="bridge_railing_galv"),
}


# Garden greenery used to be baked into the chunks as boxes and cones. Hedges, shrubs and trees are now placed by
# the vegetation system from the aerial detection (data/osm/vegetation_layout.json); the override data may still
# name these materials, but the builder skips such geometry (counted in the build statistics).
DROPPED_GREENERY = {"ivy_foliage", "hedge_olive", "cypress_foliage"}


def tint_for(real_key: str, rgb255) -> Tuple[float, float, float]:
    """Vertex-colour multiplier that turns the scan's mean albedo into the target colour (hue-preserving clamp to <= 1)."""
    mean = REAL_MEAN_LIN.get(real_key)
    tgt = lin_rgb(rgb255)
    if mean is None:
        return tgt
    t = [tgt[i] / max(mean[i], 1e-4) for i in range(3)]
    mx = max(t)
    if mx > 1.0:
        t = [x / mx for x in t]
    return (t[0], t[1], t[2])


def sem_look(key: str) -> Tuple[str, Tuple[float, float, float], Dict]:
    """Resolve a semantic material key -> (real material key, linear tint, entry)."""
    ent = SEM.get(key)
    if ent is None:
        if key in REAL_SPECS:
            return key, WHITE, {}
        raise KeyError(f"Unknown village material key '{key}' (not in SEM palette nor REAL_SPECS)")
    real = ent["real"]
    if "rgb" in ent:
        tint = tint_for(real, ent["rgb"])
    else:
        tint = ent.get("mul", WHITE)
    return real, tint, ent


def create_material_library() -> Dict[str, bpy.types.Material]:
    """Build every real PBR material. Returns {real_key: material}; semantic keys resolve through SEM."""
    lib = load_library()
    mats: Dict[str, bpy.types.Material] = {}

    def lib_path(ref) -> str:
        mid, kind, res = ref
        if mid not in lib:
            raise RuntimeError(f"Shared texture library has no material '{mid}' (needed by the village builder)")
        files = lib[mid]["files"]
        k = kind if res == "2k" else f"{kind}_1k"
        if k not in files:
            raise RuntimeError(f"Library material '{mid}' has no '{k}' file")
        return os.path.join(PROJECT_ROOT, files[k])

    kinds = {"alb": "albedo", "nrm": "normal", "orm": "orm"}
    for key, spec in REAL_SPECS.items():
        vt = spec.get("vertex_tint", True)
        if "alb" in spec:
            mats[key] = make_pbr_material(
                spec["name"],
                albedo_path=lib_path((spec["alb"][0], kinds["alb"], spec["alb"][1])),
                normal_path=lib_path((spec["nrm"][0], kinds["nrm"], spec["nrm"][1])),
                orm_path=lib_path((spec["orm"][0], kinds["orm"], spec["orm"][1])),
                vertex_tint=vt, normal_strength=spec.get("normal_strength", 1.0),
            )
            REAL_TILE[key] = float(spec["tile"]) if spec.get("tile") else float(lib[spec["alb"][0]]["tileSizeM"][0])
            REAL_MEAN_LIN[key] = tuple(lib[spec["mean"]]["avgAlbedoLinear"])
        elif "own" in spec:
            a, n, o = spec["own"]
            mats[key] = make_pbr_material(
                spec["name"], albedo_path=_vt(a), normal_path=_vt(n), orm_path=_vt(o),
                emissive_path=_vt(spec["emi"]) if spec.get("emi") else None, vertex_tint=vt,
            )
            REAL_TILE[key] = spec.get("tile")
        elif "decal" in spec:
            mats[key] = make_pbr_material(spec["name"], albedo_path=_vt(spec["decal"]), roughness=0.95, alpha_blend=True, vertex_tint=True)
            REAL_TILE[key] = None
        elif "cards" in spec:
            mats[key] = make_pbr_material(spec["name"], albedo_path=_vt(spec["cards"]), roughness=0.62, alpha_clip=True, double_sided=True, vertex_tint=True)
            REAL_TILE[key] = None
        elif "flat_tex" in spec:
            mats[key] = make_pbr_material(spec["name"], albedo_path=_vt(spec["flat_tex"]), roughness=0.5, vertex_tint=False)
            REAL_TILE[key] = None
        elif "flat" in spec:
            fl = spec["flat"]
            mats[key] = make_pbr_material(
                spec["name"], base_color=fl.get("base", (1.0, 1.0, 1.0, 1.0)), roughness=fl["roughness"],
                metallic=fl["metallic"], vertex_tint=vt,
            )
            REAL_TILE[key] = None
        else:
            lg = spec["legacy"]
            mats[key] = make_pbr_material(
                spec["name"], albedo_path=_vt(lg["albedo"]),
                normal_path=_vt(lg["normal"]) if lg.get("normal") else None,
                roughness=lg.get("roughness", 0.8), metallic=lg.get("metallic", 0.0),
                normal_strength=lg.get("normal_strength", 1.0),
                alpha_clip=lg.get("alpha_clip", False), double_sided=lg.get("double_sided", False), vertex_tint=vt,
            )
            REAL_TILE[key] = None
    # vertex tints for the (light, neutral) joinery atlas are normalised against its mean tone
    REAL_MEAN_LIN["joinery"] = lin_rgb((204, 200, 192))
    REAL_MEAN_LIN["paint"] = (1.0, 1.0, 1.0)
    return mats


def valid_material_keys() -> set:
    """Keys that override data may use (semantic palette + real materials)."""
    return set(SEM.keys()) | set(REAL_SPECS.keys())


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
        "plinth_mat": "plinth_concrete",      # smooth grey render socle (Street View), not rubble
        "plinth_above": 0.30,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",                 # Kills giant overhanging skillion wedge!
        "wall_h": 6.8,
        "roof_h": 0.0,
        "bauhaus_penthouse": True,            # Stepped upper 1929 Bauhaus clerestory block!
        "ribbon_windows": True,               # horizontal window bands (Fensterbaender) instead of punched bays
        "no_door": True,
    },
    "lod2/DERPLP110000QOUm": {
        "wall_mat": "wall_bauhaus_white",
        "plinth_mat": "plinth_concrete",
        "plinth_above": 0.30,
        "roof_mat": "roof_flat",
        "roof_shape": "flat",
        "wall_h": 4.8,
        "roof_h": 0.0,
        "ribbon_windows": True,
        "is_windowed": True,
        "no_gate": True,                      # white Bauhaus wall on the street, no plank barn gate
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
        "center": [64.97, -193.19],
        "baseElevationM": 63.00,
        "wallHeightM": 3.8,
        "roofHeightM": 4.4,
        "roofShape": "gabled",
        "roofTone": "charcoal",
        "footprint": [[68.83, -198.55], [58.62, -195.01], [61.11, -187.83], [71.32, -191.37]],
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

class SiteContext:
    """Village-wide spatial context: which facades face a street, which walls are party walls, ground height.

    All coordinates are Blender XY = (worldX, -worldZ).
    """

    CELL = 24.0

    def __init__(self, road_segments=None, footprints=None, heightmap_path: Optional[str] = None):
        # road_segments: (x0, y0, x1, y1, width, role) in Blender XY
        self.roads = list(road_segments or [])
        self.road_grid: Dict[Tuple[int, int], List[int]] = {}
        for idx, (x0, y0, x1, y1, _w, _role) in enumerate(self.roads):
            pad = 26.0
            for gx in range(int(math.floor((min(x0, x1) - pad) / self.CELL)), int(math.floor((max(x0, x1) + pad) / self.CELL)) + 1):
                for gy in range(int(math.floor((min(y0, y1) - pad) / self.CELL)), int(math.floor((max(y0, y1) + pad) / self.CELL)) + 1):
                    self.road_grid.setdefault((gx, gy), []).append(idx)
        # footprints: (id, pts[(x, y)], z_top) in Blender XY
        self.fps = list(footprints or [])
        self.fp_grid: Dict[Tuple[int, int], List[int]] = {}
        self.fp_bbox = []
        for idx, (_bid, pts, _zt) in enumerate(self.fps):
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            bb = (min(xs), min(ys), max(xs), max(ys))
            self.fp_bbox.append(bb)
            for gx in range(int(math.floor(bb[0] / self.CELL)), int(math.floor(bb[2] / self.CELL)) + 1):
                for gy in range(int(math.floor(bb[1] / self.CELL)), int(math.floor(bb[3] / self.CELL)) + 1):
                    self.fp_grid.setdefault((gx, gy), []).append(idx)
        self.hm_vals = None
        self.hm_n = 0
        if heightmap_path and os.path.exists(heightmap_path):
            import struct
            raw = open(heightmap_path, "rb").read()
            self.hm_n = int(round(math.sqrt(len(raw) // 4)))
            self.hm_vals = struct.unpack(f"<{self.hm_n * self.hm_n}f", raw)

    def ground(self, x: float, y: float) -> Optional[float]:
        """Terrain elevation at Blender (x, y) (same units as baseElevationM), None without a heightmap."""
        if self.hm_vals is None or self.hm_n < 2:
            return None
        n = self.hm_n
        u = max(0.0, min(1.0, (x + 1024.0) / 2048.0)) * (n - 1)
        v = max(0.0, min(1.0, (-y + 1024.0) / 2048.0)) * (n - 1)
        c0, r0 = int(math.floor(u)), int(math.floor(v))
        c1, r1 = min(n - 1, c0 + 1), min(n - 1, r0 + 1)
        fu, fv = u - c0, v - r0
        hv = self.hm_vals
        return (hv[r0 * n + c0] * (1 - fu) + hv[r0 * n + c1] * fu) * (1 - fv) + (hv[r1 * n + c0] * (1 - fu) + hv[r1 * n + c1] * fu) * fv

    def nearest_road(self, x: float, y: float):
        """(distance to road EDGE, (qx, qy) nearest centreline point, role) or None if no road within ~26 m."""
        best = None
        for idx in self.road_grid.get((int(math.floor(x / self.CELL)), int(math.floor(y / self.CELL))), ()):
            x0, y0, x1, y1, w, role = self.roads[idx]
            dx, dy = x1 - x0, y1 - y0
            l2 = dx * dx + dy * dy
            t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / l2))
            qx, qy = x0 + dx * t, y0 + dy * t
            d = math.hypot(x - qx, y - qy) - 0.5 * w
            if best is None or d < best[0]:
                best = (d, (qx, qy), role)
        return best

    def inside_other(self, x: float, y: float, self_id: str) -> bool:
        for idx in self.fp_grid.get((int(math.floor(x / self.CELL)), int(math.floor(y / self.CELL))), ()):
            bid, pts, _zt = self.fps[idx]
            if bid == self_id:
                continue
            bb = self.fp_bbox[idx]
            if x < bb[0] or x > bb[2] or y < bb[1] or y > bb[3]:
                continue
            if point_in_polygon(x, y, pts):
                return True
        return False

    def near_role(self, x: float, y: float, role: str, dist: float) -> bool:
        for idx in self.road_grid.get((int(math.floor(x / self.CELL)), int(math.floor(y / self.CELL))), ()):
            x0, y0, x1, y1, w, r = self.roads[idx]
            if r != role:
                continue
            dx, dy = x1 - x0, y1 - y0
            l2 = dx * dx + dy * dy
            t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / l2))
            if math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)) <= dist:
                return True
        return False

    def sight_blocked(self, x: float, y: float, qx: float, qy: float, self_id: str) -> bool:
        """True if another building stands between a facade point and the road point it would face."""
        d = math.hypot(qx - x, qy - y)
        steps = max(2, int(d / 1.6))
        for i in range(1, steps):
            t = i / steps
            if self.inside_other(x + (qx - x) * t, y + (qy - y) * t, self_id):
                return True
        return False


class Facade:
    """Local frame of one wall edge: s runs along the edge, z is up, d is the outward offset."""

    __slots__ = ("x0", "y0", "ex", "ey", "nx", "ny", "L", "s_base")

    def __init__(self, x0, y0, x1, y1, s_base: float = 0.0):
        self.x0, self.y0 = x0, y0
        self.L = math.hypot(x1 - x0, y1 - y0)
        inv = 1.0 / max(self.L, 1e-9)
        self.ex, self.ey = (x1 - x0) * inv, (y1 - y0) * inv
        self.nx, self.ny = self.ey, -self.ex      # outward for CCW footprints
        self.s_base = s_base

    def P(self, s: float, z: float, d: float = 0.0):
        return (self.x0 + self.ex * s + self.nx * d, self.y0 + self.ey * s + self.ny * d, z)

    @property
    def n3(self):
        return (self.nx, self.ny, 0.0)

    @property
    def e3(self):
        return (self.ex, self.ey, 0.0)


# Window atlas cells (col, row) - see generate_textures.generate_window_atlas()
WIN_FAMILIES = {
    "white": [(0, 0), (0, 0), (1, 0), (1, 0), (2, 0), (3, 0)],
    "white_box": [(3, 3), (3, 3), (0, 0), (1, 0), (3, 0), (2, 0)],
    "sprossen": [(0, 1), (0, 1), (1, 1), (1, 1), (3, 0)],
    "brown": [(2, 1), (2, 1), (3, 1), (2, 1)],
    "anthracite": [(0, 2), (0, 2), (1, 2), (0, 2)],
    "modern_white": [(2, 2), (0, 0), (2, 0), (3, 3), (0, 2)],
    "raffstore": [(1, 2), (1, 2), (0, 2)],
}
WIN_ATTIC = (0, 3)
WIN_BARN = (1, 3)
WIN_SKYLIGHT = (2, 3)
WIN_BATH = (3, 2)
WIN_NEVER_LIT = {(1, 3)}

SHUTTER_COLOURS = [(52, 78, 58), (66, 44, 34), (96, 40, 36), (60, 72, 88), (120, 122, 118), (70, 54, 40), (40, 60, 46)]
DOOR_COLOURS = [(110, 76, 50), (72, 50, 36), (228, 226, 220), (60, 66, 72), (46, 70, 56), (120, 44, 38), (150, 120, 88), (88, 96, 104)]
GARAGE_COLOURS = [(226, 226, 222), (226, 226, 222), (196, 198, 198), (110, 82, 58), (64, 68, 74), (58, 84, 64), (150, 152, 150)]
GATE_COLOURS = [(118, 88, 60), (92, 70, 50), (60, 84, 62), (130, 124, 112), (84, 60, 46), (150, 110, 70)]
STONE_TRIMS = [
    ("sandstone_red", (1.0, 1.0, 1.0)), ("sandstone_red", (0.86, 0.84, 0.84)), ("sandstone_red", (1.0, 0.92, 0.88)),
    ("sandstone_yellow", (1.0, 1.0, 1.0)), ("sandstone_yellow", (0.90, 0.88, 0.84)),
]


class VillageMeshBuilder:
    """Accumulates flat-shaded faces (position, UV, linear vertex colour) per real PBR material."""

    def __init__(self, name: str, mat_lib: Dict[str, bpy.types.Material], site: Optional[SiteContext] = None, detail: float = 1.0):
        self.name = name
        self.mat_lib = mat_lib
        self.site = site
        self.detail = detail
        self.mat_order: List[str] = []
        self.mat_to_idx: Dict[str, int] = {}
        self.co: List[Tuple[float, float, float]] = []
        self.faces: List[Tuple[int, ...]] = []
        self.fmat: List[int] = []
        self.uvs: List[Tuple[float, float]] = []
        self.cols: List[Tuple[float, float, float]] = []
        self.fdet: List[bool] = []            # per face: True = small facade detail (separate '<chunk>_detail' mesh)
        self._detail = False
        self.detail_obj = None
        self.cur: Optional[Dict] = None       # look of the building currently being built
        self.warnings: List[str] = []
        self.stats: Dict[str, int] = {}

    # ---------------- low level ----------------
    def mat_idx(self, real_key: str) -> int:
        idx = self.mat_to_idx.get(real_key)
        if idx is None:
            if real_key not in self.mat_lib:
                raise KeyError(f"Real material '{real_key}' missing from material library")
            idx = len(self.mat_order)
            self.mat_to_idx[real_key] = idx
            self.mat_order.append(real_key)
        return idx

    def count(self, key: str, n: int = 1):
        self.stats[key] = self.stats.get(key, 0) + n

    def _emit(self, real: str, pts, uv, col):
        n = len(pts)
        base = len(self.co)
        self.co.extend(pts)
        self.faces.append(tuple(range(base, base + n)))
        self.fmat.append(self.mat_idx(real))
        self.fdet.append(self._detail)
        self.uvs.extend(uv)
        if isinstance(col[0], (int, float)):
            self.cols.extend([col] * n)
        else:
            self.cols.extend(col)

    def q(self, real: str, p0, p1, p2, p3, uv, col=WHITE, facing=None):
        """Quad in a REAL material. facing: optional direction the face must look at (winding fixed automatically)."""
        ax, ay, az = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        bx, by, bz = p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]
        nx, ny, nz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
        if nx * nx + ny * ny + nz * nz < 1e-12:
            return
        pts = (tuple(p0), tuple(p1), tuple(p2), tuple(p3))
        if facing is not None and (nx * facing[0] + ny * facing[1] + nz * facing[2]) < 0.0:
            pts = pts[::-1]
            uv = tuple(uv)[::-1]
            if not isinstance(col[0], (int, float)):
                col = tuple(col)[::-1]
        self._emit(real, pts, uv, col)

    def t(self, real: str, p0, p1, p2, uv, col=WHITE, facing=None):
        ax, ay, az = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        bx, by, bz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        nx, ny, nz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
        if nx * nx + ny * ny + nz * nz < 1e-12:
            return
        pts = (tuple(p0), tuple(p1), tuple(p2))
        if facing is not None and (nx * facing[0] + ny * facing[1] + nz * facing[2]) < 0.0:
            pts = pts[::-1]
            uv = tuple(uv)[::-1]
            if not isinstance(col[0], (int, float)):
                col = tuple(col)[::-1]
        self._emit(real, pts, uv, col)

    class _DetailScope:
        def __init__(self, b):
            self.b = b

        def __enter__(self):
            self.prev = self.b._detail
            self.b._detail = True

        def __exit__(self, *a):
            self.b._detail = self.prev

    def detail_scope(self):
        """with builder.detail_scope(): faces go to the '<chunk>_detail' mesh (hidden / shadow-less on low quality)."""
        return VillageMeshBuilder._DetailScope(self)

    def tile_of(self, mat_key: str, default: float) -> float:
        """Real-world metres per texture repeat for a semantic or real key (default for untiled legacy materials)."""
        real = SEM[mat_key]["real"] if mat_key in SEM else mat_key
        t = REAL_TILE.get(real)
        return float(t) if t else float(default)

    def look(self, mat_key: str):
        """(real, tint) for a semantic key; the current building's own wall / roof look wins for its keys."""
        cur = self.cur
        if cur is not None:
            hit = cur.get("looks", {}).get(mat_key)
            if hit is not None:
                return hit
        real, tint, _ = sem_look(mat_key)
        return real, tint

    # ---------------- legacy API (semantic keys, used by the courtyard / street accessories) ----------------
    def _legacy_uv(self, mat_key: str, uvs):
        ent = SEM.get(mat_key) or {}
        rect = ent.get("uvrect")
        if rect is None:
            return uvs
        u0, v0, u1, v1 = rect
        return tuple((u0 + (u1 - u0) * max(0.0, min(1.0, uv[0])), v0 + (v1 - v0) * max(0.0, min(1.0, uv[1]))) for uv in uvs)

    def add_quad(self, p0, p1, p2, p3, uvs, mat_key: str, col=None):
        if mat_key in DROPPED_GREENERY:
            self.count("greenery_faces_dropped")
            return
        real, tint = self.look(mat_key)
        self.q(real, p0, p1, p2, p3, self._legacy_uv(mat_key, uvs), mul3(tint, col) if col else tint)

    def add_tri(self, p0, p1, p2, uvs, mat_key: str, col=None):
        if mat_key in DROPPED_GREENERY:
            self.count("greenery_faces_dropped")
            return
        real, tint = self.look(mat_key)
        self.t(real, p0, p1, p2, self._legacy_uv(mat_key, uvs), mul3(tint, col) if col else tint)

    def add_box(self, center: Vector, u_axis: Vector, v_axis: Vector, sx: float, sy: float, sz: float, mat_key: str,
                uv_scale: float = 2.0, col=None, skip_bottom: bool = False):
        """Oriented box centered at `center` along u_axis (sx), v_axis (sy), +Z (sz); real-world UV scale."""
        if mat_key in DROPPED_GREENERY:
            self.count("greenery_boxes_dropped")
            return
        real, tint = self.look(mat_key)
        if col:
            tint = mul3(tint, col)
        self.box(real, center, u_axis, v_axis, sx, sy, sz, tint, default_tile=uv_scale, skip_bottom=skip_bottom,
                 uvrect=(SEM.get(mat_key) or {}).get("uvrect"))

    def box(self, real: str, center, u_axis, v_axis, sx, sy, sz, col=WHITE, default_tile: float = 2.0,
            skip_bottom: bool = False, skip_top: bool = False, uvrect=None, uv_off=(0.0, 0.0)):
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        c = Vector(center)
        u_axis = Vector(u_axis)
        v_axis = Vector(v_axis)
        z_axis = Vector((0.0, 0.0, 1.0))
        tile = REAL_TILE.get(real) or default_tile

        def pt(dx, dy, dz):
            v = c + u_axis * dx + v_axis * dy + z_axis * dz
            return (v.x, v.y, v.z)

        c000, c100, c110, c010 = pt(-hx, -hy, -hz), pt(hx, -hy, -hz), pt(hx, hy, -hz), pt(-hx, hy, -hz)
        c001, c101, c111, c011 = pt(-hx, -hy, hz), pt(hx, -hy, hz), pt(hx, hy, hz), pt(-hx, hy, hz)
        faces = [
            ((c000, c100, c101, c001), sx, sz),
            ((c100, c110, c111, c101), sy, sz),
            ((c110, c010, c011, c111), sx, sz),
            ((c010, c000, c001, c011), sy, sz),
        ]
        if not skip_top:
            faces.append(((c001, c101, c111, c011), sx, sy))
        if not skip_bottom:
            faces.append(((c010, c110, c100, c000), sx, sy))
        uo, vo = uv_off
        for (a, b, cc, d), wu, wv in faces:
            if uvrect is not None:
                u0, v0, u1, v1 = uvrect
                uv = ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
            else:
                su, sv = wu / tile, wv / tile
                uv = ((uo, vo), (uo + su, vo), (uo + su, vo + sv), (uo, vo + sv))
            self.q(real, a, b, cc, d, uv, col)

    def gutter(self, center, along, outward, length: float):
        """Half-round zinc gutter approximated by a channel: front, underside, back and dark inside.

        The channel is closed at the back and tucked 3 cm under the fascia: an open profile standing off the
        eave left a hair-thin lit gap between the roof's and the gutter's shadow, which the shadow map broke
        up into a comb of light dots along every eave shadow."""
        o = Vector(outward)
        c = Vector(center) - o * 0.03
        a = Vector(along)
        h = length * 0.5
        w, d = 0.12, 0.09
        p = lambda da, do, dz: tuple(c + a * da + o * do + Vector((0.0, 0.0, dz)))   # noqa: E731
        uv = ((0.0, 0.0), (0.2, 0.0), (0.2, 0.1), (0.0, 0.1))
        zc = (self.cur or {}).get("zinc", ZINC_GREY)
        with self.detail_scope():
            self.q("zinc", p(-h, w * 0.5, -d * 0.5), p(h, w * 0.5, -d * 0.5), p(h, w * 0.5, d * 0.5), p(-h, w * 0.5, d * 0.5), uv, zc, facing=tuple(o))
            self.q("zinc", p(-h, -w * 0.5, -d * 0.5), p(h, -w * 0.5, -d * 0.5), p(h, w * 0.5, -d * 0.5), p(-h, w * 0.5, -d * 0.5), uv, mul3(zc, 0.8), facing=(0, 0, -1))
            self.q("zinc", p(-h, -w * 0.5, -d * 0.5), p(h, -w * 0.5, -d * 0.5), p(h, -w * 0.5, d * 0.5), p(-h, -w * 0.5, d * 0.5), uv, mul3(zc, 0.6), facing=tuple(-o))
            self.q("zinc", p(-h, -w * 0.5, d * 0.5 - 0.03), p(h, -w * 0.5, d * 0.5 - 0.03), p(h, w * 0.5, d * 0.5 - 0.03), p(-h, w * 0.5, d * 0.5 - 0.03), uv, mul3(zc, 0.45), facing=(0, 0, 1))

    def tube(self, real: str, pa, pb, radius: float, col=WHITE, sides: int = 6):
        """Round pipe from pa to pb (open ends)."""
        a, b = Vector(pa), Vector(pb)
        d = b - a
        ln = d.length
        if ln < 1e-5:
            return
        d /= ln
        ref = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.95 else Vector((1.0, 0.0, 0.0))
        e1 = d.cross(ref)
        e1.normalize()
        e2 = d.cross(e1)
        ring = [(math.cos(2 * math.pi * k / sides), math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        for k in range(sides):
            c0, s0 = ring[k]
            c1, s1 = ring[(k + 1) % sides]
            o0 = e1 * (c0 * radius) + e2 * (s0 * radius)
            o1 = e1 * (c1 * radius) + e2 * (s1 * radius)
            shade = 0.82 + 0.18 * (0.5 + 0.5 * c0)
            self.q(real, tuple(a + o0), tuple(a + o1), tuple(b + o1), tuple(b + o0),
                   ((0.0, 0.0), (0.05, 0.0), (0.05, ln * 0.2), (0.0, ln * 0.2)), mul3(col, shade), facing=tuple(o0 + o1))

    def beam(self, real: str, pa, pb, w: float, h: float, col=WHITE, up=(0.0, 0.0, 1.0), caps: bool = False, tile: float = 1.0):
        """4-sided prism from pa to pb with cross-section w (horizontal-ish) x h (along `up`)."""
        a, b = Vector(pa), Vector(pb)
        d = b - a
        ln = d.length
        if ln < 1e-5:
            return
        d /= ln
        upv = Vector(up)
        side = d.cross(upv)
        if side.length < 1e-4:
            side = d.cross(Vector((1.0, 0.0, 0.0)))
        side.normalize()
        upv = side.cross(d)
        upv.normalize()
        hw, hh = w * 0.5, h * 0.5
        ring = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        pa_r = [a + side * x + upv * y for x, y in ring]
        pb_r = [b + side * x + upv * y for x, y in ring]
        t_len = ln / max(REAL_TILE.get(real) or tile, 1e-3)
        mid = (a + b) * 0.5
        for i in range(4):
            j = (i + 1) % 4
            fc = (pa_r[i] + pa_r[j] + pb_r[i] + pb_r[j]) * 0.25 - mid
            self.q(real, tuple(pa_r[i]), tuple(pa_r[j]), tuple(pb_r[j]), tuple(pb_r[i]),
                   ((0.0, 0.0), (0.15, 0.0), (0.15, t_len), (0.0, t_len)), col, facing=tuple(fc))
        if caps:
            self.q(real, tuple(pa_r[0]), tuple(pa_r[1]), tuple(pa_r[2]), tuple(pa_r[3]), ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), col, facing=tuple(-d))
            self.q(real, tuple(pb_r[0]), tuple(pb_r[1]), tuple(pb_r[2]), tuple(pb_r[3]), ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), col, facing=tuple(d))

    # ---------------- plinth ----------------
    def add_plinth_skirt(self, pts: List[Tuple[float, float]], z_bot: float, z_top: float, plinth_mat: str = "plinth",
                         notches: Optional[Dict[int, List[Tuple[float, float, float]]]] = None, proud: float = 0.05,
                         skip_edges: Optional[set] = None):
        """2 m underground + above-ground plinth course standing proud of the wall, with door / gate cut-outs.

        notches: {edge index: [(s0, s1, z_notch)]} - between s0..s1 the plinth only rises to z_notch.
        """
        real, tint = self.look(plinth_mat)
        tile = REAL_TILE.get(real) or 2.0
        outer = offset_polygon_outward(pts, proud)
        n = len(outer)
        perim = hash01(f"pl{pts[0][0]:.2f}{pts[0][1]:.2f}") * 3.0
        dirt = mul3(tint, (0.52, 0.50, 0.46))        # splash zone right above the ground
        mid_c = mul3(tint, (0.80, 0.79, 0.76))
        top_c = mul3(tint, (0.97, 0.97, 0.97))
        site = self.site

        def gnd(x, y):
            g = site.ground(x, y) if site is not None else None
            return (z_bot + 2.0) if g is None else g

        for i in range(n):
            if skip_edges and i in skip_edges:
                x0, y0 = outer[i]
                x1, y1 = outer[(i + 1) % n]
                perim += math.hypot(x1 - x0, y1 - y0)
                continue
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            elen = math.hypot(x1 - x0, y1 - y0)
            if elen < 1e-4:
                continue
            ix0, iy0 = pts[i]
            ix1, iy1 = pts[(i + 1) % n]
            cuts = sorted((notches or {}).get(i, []))
            # split the edge into spans: (t0, t1, z_span_top)
            spans = []
            cur_s = 0.0
            ilen = math.hypot(ix1 - ix0, iy1 - iy0)
            for (s0, s1, zn) in cuts:
                a, b = max(0.0, s0 / max(ilen, 1e-6)), min(1.0, s1 / max(ilen, 1e-6))
                if b <= a or a < cur_s:
                    continue
                if a > cur_s:
                    spans.append((cur_s, a, z_top, False))
                spans.append((a, b, min(z_top, zn), True))
                cur_s = b
            if cur_s < 1.0:
                spans.append((cur_s, 1.0, z_top, False))
            # a wall that stands in a slope: where the terrain rises above the plinth course, the course steps up
            # with it (0.3 m above the ground, like a Sockel following the street) instead of the ground climbing
            # over the plinth onto the render and the house reading as sunk
            pieces = []
            for (ta, tb, zt, is_cut) in spans:
                if is_cut:
                    pieces.append((ta, tb, zt, zt, True))
                    continue
                m = max(1, int(math.ceil((tb - ta) * elen / 2.5)))
                ts = [ta + (tb - ta) * k / m for k in range(m + 1)]
                tops = [max(zt, min(zt + 1.8, gnd(x0 + (x1 - x0) * t_, y0 + (y1 - y0) * t_) + 0.30)) for t_ in ts]
                if max(tops) <= zt + 0.02:
                    pieces.append((ta, tb, zt, zt, False))
                    continue
                self.count("plinth_stepped_spans")
                k = 0
                while k < m:
                    if tops[k] <= zt + 0.02 and tops[k + 1] <= zt + 0.02:
                        k2 = k + 1          # merge a run of level pieces into one
                        while k2 < m and tops[k2 + 1] <= zt + 0.02:
                            k2 += 1
                        pieces.append((ts[k], ts[k2], zt, zt, False))
                        k = k2
                    else:
                        pieces.append((ts[k], ts[k + 1], tops[k], tops[k + 1], False))
                        k += 1
            for (ta, tb, zta, ztb, is_cut) in pieces:
                ax, ay = x0 + (x1 - x0) * ta, y0 + (y1 - y0) * ta
                bx, by = x0 + (x1 - x0) * tb, y0 + (y1 - y0) * tb
                u0 = (perim + elen * ta) / tile
                u1 = (perim + elen * tb) / tile
                vta, vtb = (zta - z_bot) / tile, (ztb - z_bot) / tile
                if min(zta, ztb) > z_bot + 0.02:
                    # lower quad up to a splash line 0.25 m above the terrain at each end (it follows the slope),
                    # upper quad clean: no long grey gradient where a wall stands deep in a slope
                    za_s = min(zta, max(z_bot + 0.05, gnd(ax, ay) + 0.25))
                    zb_s = min(ztb, max(z_bot + 0.05, gnd(bx, by) + 0.25))
                    if min(zta - za_s, ztb - zb_s) > 0.06:
                        va, vb = (za_s - z_bot) / tile, (zb_s - z_bot) / tile
                        self.q(real, (ax, ay, z_bot), (bx, by, z_bot), (bx, by, zb_s), (ax, ay, za_s),
                               ((u0, 0.0), (u1, 0.0), (u1, vb), (u0, va)), (dirt, dirt, mid_c, mid_c))
                        self.q(real, (ax, ay, za_s), (bx, by, zb_s), (bx, by, ztb), (ax, ay, zta),
                               ((u0, va), (u1, vb), (u1, vtb), (u0, vta)), (mid_c, mid_c, top_c, top_c))
                    else:
                        self.q(real, (ax, ay, z_bot), (bx, by, z_bot), (bx, by, ztb), (ax, ay, zta),
                               ((u0, 0.0), (u1, 0.0), (u1, vtb), (u0, vta)), (dirt, dirt, mid_c, mid_c))
                # weathering ledge on top (connects back to the wall line)
                jax, jay = ix0 + (ix1 - ix0) * ta, iy0 + (iy1 - iy0) * ta
                jbx, jby = ix0 + (ix1 - ix0) * tb, iy0 + (iy1 - iy0) * tb
                if not is_cut:
                    self.q(real, (ax, ay, zta), (bx, by, ztb), (jbx, jby, ztb), (jax, jay, zta),
                           ((u0, vta), (u1, vtb), (u1, vtb + 0.03), (u0, vta + 0.03)), top_c)
                else:
                    zt = zta
                    # returns at both sides of the cut-out so one cannot look into the hollow plinth
                    for (px_, py_, qx_, qy_, sgn) in ((ax, ay, jax, jay, 1.0), (bx, by, jbx, jby, -1.0)):
                        ex_, ey_ = (x1 - x0) / elen * sgn, (y1 - y0) / elen * sgn
                        self.q(real, (px_, py_, zt), (qx_, qy_, zt), (qx_, qy_, z_top), (px_, py_, z_top),
                               ((0.0, 0.0), (0.03, 0.0), (0.03, 0.2), (0.0, 0.2)), top_c, facing=(ex_, ey_, 0.0))
            perim += elen

    # ---------------- walls with real openings ----------------
    def wall_panel(self, F: Facade, z0: float, z1: float, real: str, col, holes=None, notches=None,
                   grime=(0.80, 0.90), uv_off=(0.0, 0.0), poly_top=None, bands: bool = True, top_band: bool = True):
        """One wall face (z0..z1 over the whole edge) with rectangular holes and bottom notches cut out.

        holes   : [(s0, s1, za, zb)] fully inside the wall
        notches : [(s0, s1, zb)] openings that start at the wall foot (doors, gates)
        grime   : vertex-colour multipliers at the wall foot / under the eaves (dirt gradients)
        poly_top: optional list of (s, z) points replacing the straight top edge (gable / skillion walls), s descending
        """
        holes = [h for h in (holes or []) if h[1] - h[0] > 0.05 and h[3] - h[2] > 0.05]
        notches = sorted([nn for nn in (notches or []) if nn[1] - nn[0] > 0.05])
        L = F.L
        tile = REAL_TILE.get(real) or 2.0
        uo, vo = uv_off
        H = z1 - z0

        def UV(s, z):
            return ((F.s_base + s) / tile + uo, (z - z0) / tile + vo)

        g_b = mul3(col, grime[0])
        g_b = (g_b[0], g_b[1] * 0.985, g_b[2] * 0.95)
        g_t = mul3(col, grime[1])
        hb = 0.50 if (bands and H > 1.7) else 0.0
        ht = 0.38 if (bands and top_band and H > 1.7 and poly_top is None) else 0.0
        tops = [h[3] for h in holes] + [nn[2] for nn in notches]
        bots = [h[2] for h in holes]
        if tops and ht > 0.0:
            ht = min(ht, (z1 - max(tops)) - 0.03)
            if ht < 0.08:
                ht = 0.0
        if bots and hb > 0.0:
            hb = min(hb, (min(bots) - z0) - 0.03)
            if hb < 0.08:
                hb = 0.0
        if notches and hb > 0.0:
            hb = min(hb, min(nn[2] for nn in notches) - z0 - 0.05)
            if hb < 0.08:
                hb = 0.0
        za, zb = z0 + hb, z1 - ht
        nrm = F.n3

        # foot band (dirt gradient), split around door / gate notches
        if hb > 0.0:
            cur_s = 0.0
            segs = []
            for (s0, s1, _z) in notches:
                if s0 > cur_s + 1e-3:
                    segs.append((cur_s, s0))
                cur_s = max(cur_s, s1)
            if cur_s < L - 1e-3:
                segs.append((cur_s, L))
            for (sa, sb) in segs:
                self.q(real, F.P(sa, z0), F.P(sb, z0), F.P(sb, za), F.P(sa, za),
                       (UV(sa, z0), UV(sb, z0), UV(sb, za), UV(sa, za)), (g_b, g_b, col, col), facing=nrm)
        # eaves band (rain-shadow / soot gradient)
        if ht > 0.0:
            self.q(real, F.P(0.0, zb), F.P(L, zb), F.P(L, z1), F.P(0.0, z1),
                   (UV(0.0, zb), UV(L, zb), UV(L, z1), UV(0.0, z1)), (col, col, g_t, g_t), facing=nrm)

        # main field
        if not holes and not notches and poly_top is None:
            c_lo = col if (hb > 0.0 or not bands) else g_b
            c_hi = col if (ht > 0.0 or not bands or not top_band) else (g_t if H > 1.0 else col)
            self.q(real, F.P(0.0, za), F.P(L, za), F.P(L, zb), F.P(0.0, zb),
                   (UV(0.0, za), UV(L, za), UV(L, zb), UV(0.0, zb)), (c_lo, c_lo, c_hi, c_hi), facing=nrm)
            return True

        outer = [(0.0, za)]
        for (s0, s1, zn) in notches:
            s0c, s1c = max(0.0, s0), min(L, s1)
            if hb > 0.0 or zn > za + 1e-3:
                if s0c > 1e-4:
                    outer.append((s0c, za))
                else:
                    outer.pop()
                outer.append((s0c, zn))
                outer.append((s1c, zn))
                if s1c < L - 1e-4:
                    outer.append((s1c, za))
        if outer[-1][0] < L - 1e-4:
            outer.append((L, za))
        if poly_top is not None:
            outer.extend(poly_top)
        else:
            outer.append((L, zb))
            outer.append((0.0, zb))
        # drop consecutive duplicates
        ring = []
        for p in outer:
            if not ring or abs(p[0] - ring[-1][0]) > 1e-5 or abs(p[1] - ring[-1][1]) > 1e-5:
                ring.append(p)
        if len(ring) > 2 and abs(ring[0][0] - ring[-1][0]) < 1e-5 and abs(ring[0][1] - ring[-1][1]) < 1e-5:
            ring.pop()
        loops = [[Vector((p[0], p[1], 0.0)) for p in ring]]
        flat = list(ring)
        area_expected = abs(signed_area_2d(ring))
        for (s0, s1, ha, hb_) in holes:
            hole = [(s0, ha), (s0, hb_), (s1, hb_), (s1, ha)]
            loops.append([Vector((p[0], p[1], 0.0)) for p in hole])
            flat.extend(hole)
            area_expected -= (s1 - s0) * (hb_ - ha)
        tris = tessellate_polygon(loops)
        area_got = 0.0
        out = []
        for (i0, i1, i2) in tris:
            a, b, c = flat[i0], flat[i1], flat[i2]
            ar = 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
            if abs(ar) < 1e-7:
                continue
            area_got += abs(ar)
            out.append((a, b, c) if ar > 0 else (a, c, b))
        if abs(area_got - area_expected) > 0.02 * max(area_expected, 0.5):
            self.warnings.append(f"wall tessellation area mismatch ({area_got:.2f} vs {area_expected:.2f}) on {self.cur.get('id') if self.cur else '?'} L={L:.2f} z={z0:.2f}..{z1:.2f} holes={[(round(a,2),round(b,2),round(c,2),round(d,2)) for a,b,c,d in holes]} notches={[(round(a,2),round(b,2),round(c,2)) for a,b,c in notches]}")
            return False
        for (a, b, c) in out:
            self.t(real, F.P(a[0], a[1]), F.P(b[0], b[1]), F.P(c[0], c[1]), (UV(*a), UV(*b), UV(*c)), col, facing=nrm)
        return True

    def _pick_lit(self, key: str, cell) -> str:
        if cell in WIN_NEVER_LIT:
            return "window"
        cur = self.cur or {}
        r = hash01("lit" + key)
        p = cur.get("lit_share", 0.36)
        if r > p:
            return "window"
        r2 = r / max(p, 1e-6)
        return "window_lit_a" if r2 < 0.50 else ("window_lit_b" if r2 < 0.84 else "window_lit_c")

    def window_unit(self, F: Facade, s0, s1, za, zb, d, cell, key: str):
        u0, v0, u1, v1 = atlas_cell(cell[0], cell[1])
        real = self._pick_lit(key, cell)
        if hash01("flip" + key) < 0.5:
            u0, u1 = u1, u0
        self.q(real, F.P(s0, za, d), F.P(s1, za, d), F.P(s1, zb, d), F.P(s0, zb, d),
               ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), WHITE, facing=F.n3)
        self.count("windows")

    def add_window(self, F: Facade, s0, s1, za, zb, style: Dict, tier: str, wall_real: str, wall_col, key: str,
                   cell=None, allow_shutters: bool = True, units: int = 1):
        """Build one window; returns the wall hole (s0, s1, za, zb) it needs.

        units > 1: one long opening (ribbon window / Fensterband) glazed as a row of `units` casements.
        """
        if units < 1:
            raise ValueError(f"add_window {key}: units must be >= 1, got {units}")
        cell = cell or style["cells"][int(hash01("cell" + key) * len(style["cells"])) % len(style["cells"])]
        if tier != "A":
            self.window_unit(F, s0, s1, za, zb, 0.0, cell, key)
            return (s0, s1, za, zb)
        n3, e3 = F.n3, F.e3
        ne3 = (-e3[0], -e3[1], 0.0)
        dep = style.get("reveal", 0.13)
        sur = style.get("surround")
        if sur == "stone":
            fw, pr = style.get("fw", 0.13), 0.03
            s_real, s_col = style["trim"]
            sill_h, sill_out = 0.10, 0.075
            tile = REAL_TILE.get(s_real) or 2.0
            k = 1.0 / tile
            uo = hash01("su" + key) * 3.0
            # bevelled jambs + lintel (outer edge flush with the wall, inner edge proud)
            self.q(s_real, F.P(s0 - fw, za), F.P(s0, za, pr), F.P(s0, zb, pr), F.P(s0 - fw, zb + fw),
                   ((uo, 0.0), (uo + fw * k, 0.0), (uo + fw * k, (zb - za) * k), (uo, (zb - za + fw) * k)), s_col, facing=n3)
            self.q(s_real, F.P(s1, za, pr), F.P(s1 + fw, za), F.P(s1 + fw, zb + fw), F.P(s1, zb, pr),
                   ((uo + 0.5, 0.0), (uo + 0.5 + fw * k, 0.0), (uo + 0.5 + fw * k, (zb - za + fw) * k), (uo + 0.5, (zb - za) * k)), s_col, facing=n3)
            self.q(s_real, F.P(s0, zb, pr), F.P(s1, zb, pr), F.P(s1 + fw, zb + fw), F.P(s0 - fw, zb + fw),
                   ((uo, 0.6), (uo + (s1 - s0) * k, 0.6), (uo + (s1 - s0 + fw) * k, 0.6 + fw * k), (uo - fw * k, 0.6 + fw * k)), s_col, facing=n3)
            # reveals
            self.q(s_real, F.P(s0, za, pr), F.P(s0, za, -dep), F.P(s0, zb, -dep), F.P(s0, zb, pr),
                   ((uo, 0.0), (uo + (dep + pr) * k, 0.0), (uo + (dep + pr) * k, (zb - za) * k), (uo, (zb - za) * k)), mul3(s_col, 0.92), facing=e3)
            self.q(s_real, F.P(s1, za, pr), F.P(s1, za, -dep), F.P(s1, zb, -dep), F.P(s1, zb, pr),
                   ((uo, 0.0), (uo + (dep + pr) * k, 0.0), (uo + (dep + pr) * k, (zb - za) * k), (uo, (zb - za) * k)), mul3(s_col, 0.92), facing=ne3)
            self.q(s_real, F.P(s0, zb, pr), F.P(s1, zb, pr), F.P(s1, zb, -dep), F.P(s0, zb, -dep),
                   ((uo, 0.0), (uo + (s1 - s0) * k, 0.0), (uo + (s1 - s0) * k, (dep + pr) * k), (uo, (dep + pr) * k)), mul3(s_col, 0.85), facing=(0, 0, -1))
            # sill block (top doubles as the bottom reveal)
            a, b = s0 - fw - 0.03, s1 + fw + 0.03
            zs = za - sill_h
            self.q(s_real, F.P(a, za, -dep), F.P(b, za, -dep), F.P(b, za - 0.012, sill_out), F.P(a, za - 0.012, sill_out),
                   ((uo, 0.2), (uo + (b - a) * k, 0.2), (uo + (b - a) * k, 0.2 + (dep + sill_out) * k), (uo, 0.2 + (dep + sill_out) * k)), s_col, facing=(0, 0, 1))
            self.q(s_real, F.P(a, zs, sill_out), F.P(b, zs, sill_out), F.P(b, za - 0.012, sill_out), F.P(a, za - 0.012, sill_out),
                   ((uo, 0.4), (uo + (b - a) * k, 0.4), (uo + (b - a) * k, 0.4 + sill_h * k), (uo, 0.4 + sill_h * k)), mul3(s_col, 0.95), facing=n3)
            self.q(s_real, F.P(a, zs, 0.0), F.P(b, zs, 0.0), F.P(b, zs, sill_out), F.P(a, zs, sill_out),
                   ((uo, 0.0), (uo + (b - a) * k, 0.0), (uo + (b - a) * k, sill_out * k), (uo, sill_out * k)), mul3(s_col, 0.7), facing=(0, 0, -1))
            for (sx_, fc) in ((a, ne3), (b, e3)):
                self.q(s_real, F.P(sx_, zs, 0.0), F.P(sx_, zs, sill_out), F.P(sx_, za - 0.012, sill_out), F.P(sx_, za, 0.0),
                       ((uo, 0.0), (uo + sill_out * k, 0.0), (uo + sill_out * k, sill_h * k), (uo, sill_h * k)), mul3(s_col, 0.9), facing=fc)
            hole = (s0 - fw, s1 + fw, zs, zb + fw)
            sh_edge = fw
        else:
            fw = 0.0
            r_real, r_col = wall_real, wall_col
            tile = REAL_TILE.get(r_real) or 2.0
            k = 1.0 / tile
            uo = hash01("su" + key) * 3.0
            hole = (s0, s1, za, zb)
            if sur == "fasche":
                fw = style.get("fw", 0.11)
                f_real, f_col = style["trim"]
                ft = REAL_TILE.get(f_real) or 2.0
                for (pa, pb, pc, pd) in (
                    (F.P(s0 - fw, za - fw), F.P(s0, za), F.P(s0, zb), F.P(s0 - fw, zb + fw)),
                    (F.P(s1, za), F.P(s1 + fw, za - fw), F.P(s1 + fw, zb + fw), F.P(s1, zb)),
                    (F.P(s0, zb), F.P(s1, zb), F.P(s1 + fw, zb + fw), F.P(s0 - fw, zb + fw)),
                    (F.P(s0 - fw, za - fw), F.P(s1 + fw, za - fw), F.P(s1, za), F.P(s0, za)),
                ):
                    self.q(f_real, pa, pb, pc, pd, ((uo, 0.0), (uo + 0.06, 0.0), (uo + 0.06, 0.5), (uo, 0.5)), f_col, facing=n3)
                hole = (s0 - fw, s1 + fw, za - fw, zb + fw)
                r_real, r_col = f_real, f_col
            self.q(r_real, F.P(s0, za, 0.0), F.P(s0, za, -dep), F.P(s0, zb, -dep), F.P(s0, zb, 0.0),
                   ((uo, 0.0), (uo + dep * k, 0.0), (uo + dep * k, (zb - za) * k), (uo, (zb - za) * k)), mul3(r_col, 0.93), facing=e3)
            self.q(r_real, F.P(s1, za, 0.0), F.P(s1, za, -dep), F.P(s1, zb, -dep), F.P(s1, zb, 0.0),
                   ((uo, 0.0), (uo + dep * k, 0.0), (uo + dep * k, (zb - za) * k), (uo, (zb - za) * k)), mul3(r_col, 0.93), facing=ne3)
            self.q(r_real, F.P(s0, zb, 0.0), F.P(s1, zb, 0.0), F.P(s1, zb, -dep), F.P(s0, zb, -dep),
                   ((uo, 0.0), (uo + (s1 - s0) * k, 0.0), (uo + (s1 - s0) * k, dep * k), (uo, dep * k)), mul3(r_col, 0.86), facing=(0, 0, -1))
            # thin projecting sill (aluminium / artificial stone)
            sill_real, sill_col = style.get("sill_mat", ("paint", (0.62, 0.62, 0.60)))
            so = 0.04
            self.q(sill_real, F.P(s0, za, -dep), F.P(s1, za, -dep), F.P(s1, za - 0.012, so), F.P(s0, za - 0.012, so),
                   ((0.0, 0.0), (0.4, 0.0), (0.4, 0.08), (0.0, 0.08)), sill_col, facing=(0, 0, 1))
            self.q(sill_real, F.P(s0, za - 0.045, so), F.P(s1, za - 0.045, so), F.P(s1, za - 0.012, so), F.P(s0, za - 0.012, so),
                   ((0.0, 0.0), (0.4, 0.0), (0.4, 0.02), (0.0, 0.02)), mul3(sill_col, 0.9), facing=n3)
            self.q(sill_real, F.P(s0, za - 0.045, 0.0), F.P(s1, za - 0.045, 0.0), F.P(s1, za - 0.045, so), F.P(s0, za - 0.045, so),
                   ((0.0, 0.0), (0.4, 0.0), (0.4, 0.02), (0.0, 0.02)), mul3(sill_col, 0.6), facing=(0, 0, -1))
            sh_edge = fw
        if units == 1:
            self.window_unit(F, s0, s1, za, zb, -dep, cell, key)
        else:
            uw = (s1 - s0) / units
            for ui in range(units):
                self.window_unit(F, s0 + uw * ui, s0 + uw * (ui + 1), za, zb, -dep, cell, f"{key}_u{ui}")
        # folding shutters (Klappläden), opened flat against the wall
        if units == 1 and allow_shutters and style.get("shutters") and (zb - za) > 0.9:
            lw = (s1 - s0) * 0.5 - 0.01
            sc = style["shutter_col"]
            ju0, jv0, ju1, jv1 = J_CELL(*style.get("shutter_cell", (0, 0)))
            dd = 0.05
            self._detail = True
            for side in (-1.0, 1.0):
                inner = (s0 - sh_edge - 0.012) if side < 0 else (s1 + sh_edge + 0.012)
                outer_s = inner + side * lw
                a, b = (outer_s, inner) if side < 0 else (inner, outer_s)
                uu0, uu1 = (ju0, ju1) if side < 0 else (ju1, ju0)
                self.q("joinery", F.P(a, za, dd), F.P(b, za, dd), F.P(b, zb, dd), F.P(a, zb, dd),
                       ((uu0, jv0), (uu1, jv0), (uu1, jv1), (uu0, jv1)), sc, facing=n3)
                edge_uv = ((ju0 + 0.01, jv0 + 0.01), (ju0 + 0.02, jv0 + 0.01), (ju0 + 0.02, jv0 + 0.2), (ju0 + 0.01, jv0 + 0.2))
                self.q("joinery", F.P(outer_s, za, 0.0), F.P(outer_s, za, dd), F.P(outer_s, zb, dd), F.P(outer_s, zb, 0.0),
                       edge_uv, mul3(sc, 0.8), facing=(e3[0] * side, e3[1] * side, 0.0))
                self.q("joinery", F.P(a, za, 0.0), F.P(b, za, 0.0), F.P(b, za, dd), F.P(a, za, dd),
                       edge_uv, mul3(sc, 0.6), facing=(0, 0, -1))
            self._detail = False
            self.count("shutters")
        return hole

    def add_door(self, F: Facade, s0, s1, z_d0, z_top, style: Dict, tier: str, wall_real, wall_col, key: str,
                 kind: str = "door", z_ground: Optional[float] = None):
        """Recessed door / garage door / barn gate. Returns (notch for the wall, notch for the plinth)."""
        n3, e3 = F.n3, F.e3
        ne3 = (-e3[0], -e3[1], 0.0)
        dep = {"door": 0.17, "garage": 0.10, "gate": 0.16, "hall": 0.12, "shed": 0.07}.get(kind, 0.12) if tier == "A" else 0.0
        sur = style.get("surround") if kind in ("door", "gate") else None
        fw = 0.0
        pr = 0.0
        if sur == "stone" and tier == "A":
            fw, pr = (0.15 if kind == "door" else 0.20), 0.035
            s_real, s_col = style["trim"]
            k = 1.0 / (REAL_TILE.get(s_real) or 2.0)
            uo = hash01("du" + key) * 3.0
            H = z_top - z_d0
            self.q(s_real, F.P(s0 - fw, z_d0), F.P(s0, z_d0, pr), F.P(s0, z_top, pr), F.P(s0 - fw, z_top + fw),
                   ((uo, 0.0), (uo + fw * k, 0.0), (uo + fw * k, H * k), (uo, (H + fw) * k)), s_col, facing=n3)
            self.q(s_real, F.P(s1, z_d0, pr), F.P(s1 + fw, z_d0), F.P(s1 + fw, z_top + fw), F.P(s1, z_top, pr),
                   ((uo + 0.5, 0.0), (uo + 0.5 + fw * k, 0.0), (uo + 0.5 + fw * k, (H + fw) * k), (uo + 0.5, H * k)), s_col, facing=n3)
            self.q(s_real, F.P(s0, z_top, pr), F.P(s1, z_top, pr), F.P(s1 + fw, z_top + fw), F.P(s0 - fw, z_top + fw),
                   ((uo, 0.6), (uo + (s1 - s0) * k, 0.6), (uo + (s1 - s0 + fw) * k, 0.6 + fw * k), (uo - fw * k, 0.6 + fw * k)), s_col, facing=n3)
            r_real, r_col = s_real, s_col
        else:
            r_real, r_col = wall_real, wall_col
        if dep > 0.0:
            k = 1.0 / (REAL_TILE.get(r_real) or 2.0)
            uo = hash01("dr" + key) * 3.0
            H = z_top - z_d0
            self.q(r_real, F.P(s0, z_d0, pr), F.P(s0, z_d0, -dep), F.P(s0, z_top, -dep), F.P(s0, z_top, pr),
                   ((uo, 0.0), (uo + (dep + pr) * k, 0.0), (uo + (dep + pr) * k, H * k), (uo, H * k)), mul3(r_col, 0.92), facing=e3)
            self.q(r_real, F.P(s1, z_d0, pr), F.P(s1, z_d0, -dep), F.P(s1, z_top, -dep), F.P(s1, z_top, pr),
                   ((uo, 0.0), (uo + (dep + pr) * k, 0.0), (uo + (dep + pr) * k, H * k), (uo, H * k)), mul3(r_col, 0.92), facing=ne3)
            self.q(r_real, F.P(s0, z_top, pr), F.P(s1, z_top, pr), F.P(s1, z_top, -dep), F.P(s0, z_top, -dep),
                   ((uo, 0.0), (uo + (s1 - s0) * k, 0.0), (uo + (s1 - s0) * k, (dep + pr) * k), (uo, (dep + pr) * k)), mul3(r_col, 0.82), facing=(0, 0, -1))
            # threshold
            th_real, th_col = style.get("step", ("concrete", (1.0, 1.0, 1.0)))
            self.q(th_real, F.P(s0, z_d0, -dep), F.P(s1, z_d0, -dep), F.P(s1, z_d0, 0.06), F.P(s0, z_d0, 0.06),
                   ((0.0, 0.0), (0.5, 0.0), (0.5, 0.1), (0.0, 0.1)), th_col, facing=(0, 0, 1))
        # leaf
        if kind == "gate":
            mid = 0.5 * (s0 + s1)
            if tier == "A":
                # two real leaves: boards + ledged-and-braced frame + strap hinges
                self.gate_leaf(F, s0, mid - 0.008, z_d0 + 0.03, z_top - 0.02, -dep, style["gate_wood"], style["gate_col"], key + "L", hinge_at_a=True)
                self.gate_leaf(F, mid + 0.008, s1, z_d0 + 0.03, z_top - 0.02, -dep, style["gate_wood"], style["gate_col"], key + "R", hinge_at_a=False)
                self.q("paint", F.P(s0, z_d0, -dep - 0.03), F.P(s1, z_d0, -dep - 0.03), F.P(s1, z_top, -dep - 0.03), F.P(s0, z_top, -dep - 0.03),
                       ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), (0.02, 0.02, 0.02), facing=n3)       # dark gap behind the leaves
            else:
                g_col = style["gate_col"]
                u0, v0, u1, v1 = J_CELL(1, 0)
                self.q("joinery", F.P(s0, z_d0, -dep), F.P(mid, z_d0, -dep), F.P(mid, z_top, -dep), F.P(s0, z_top, -dep),
                       ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), g_col, facing=n3)
                self.q("joinery", F.P(mid, z_d0, -dep), F.P(s1, z_d0, -dep), F.P(s1, z_top, -dep), F.P(mid, z_top, -dep),
                       ((u1, v0), (u0, v0), (u0, v1), (u1, v1)), g_col, facing=n3)
            self.count("gates")
        else:
            if kind == "hall":
                cell = (3, 1)
                l_col = tint_for("joinery", [(150, 154, 156), (86, 110, 92), (196, 198, 196), (70, 84, 104)][int(hash01("hc" + key) * 4) % 4])
                self.count("hall_doors")
            elif kind == "garage":
                cell = style.get("garage_cell", (0, 1))
                l_col = style["garage_col"]
                self.count("garage_doors")
            elif kind == "shed":
                cell = (2, 1)
                l_col = style["gate_col"]
                self.count("doors")
            else:
                cell = style["door_cell"]
                l_col = style["door_col"]
                self.count("doors")
            u0, v0, u1, v1 = J_CELL(*cell)
            if hash01("dflip" + key) < 0.5 and kind not in ("garage", "hall"):
                u0, u1 = u1, u0
            self.q("joinery", F.P(s0, z_d0, -dep), F.P(s1, z_d0, -dep), F.P(s1, z_top, -dep), F.P(s0, z_top, -dep),
                   ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), l_col, facing=n3)
        # entrance step in front of house doors; where the terrain falls away a real flight of steps
        if kind in ("door", "shed") and self._entrance_steps(F, s0 - fw - 0.06, s1 + fw + 0.06, z_d0, style, key):
            pass
        elif kind == "door" and tier == "A":
            zg = z_ground if z_ground is not None else z_d0 - 0.17
            if z_d0 - zg > 0.05:
                st_real, st_col = style.get("step", ("concrete", (1.0, 1.0, 1.0)))
                a, b, out = s0 - fw - 0.06, s1 + fw + 0.06, 0.34
                zb_ = zg - 0.35
                k = 1.0 / (REAL_TILE.get(st_real) or 2.0)
                self.q(st_real, F.P(a, z_d0, 0.05), F.P(b, z_d0, 0.05), F.P(b, z_d0, out), F.P(a, z_d0, out),
                       ((0, 0), ((b - a) * k, 0), ((b - a) * k, out * k), (0, out * k)), st_col, facing=(0, 0, 1))
                self.q(st_real, F.P(a, zb_, out), F.P(b, zb_, out), F.P(b, z_d0, out), F.P(a, z_d0, out),
                       ((0, 0), ((b - a) * k, 0), ((b - a) * k, (z_d0 - zb_) * k), (0, (z_d0 - zb_) * k)), mul3(st_col, 0.92), facing=n3)
                for (sx_, fc) in ((a, ne3), (b, e3)):
                    self.q(st_real, F.P(sx_, zb_, 0.05), F.P(sx_, zb_, out), F.P(sx_, z_d0, out), F.P(sx_, z_d0, 0.05),
                           ((0, 0), (out * k, 0), (out * k, (z_d0 - zb_) * k), (0, (z_d0 - zb_) * k)), mul3(st_col, 0.88), facing=fc)
        # vehicle openings: flush threshold apron that runs out onto (and a little into) the ground
        if kind in ("gate", "hall", "garage") and tier == "A":
            a, b, out = s0 - fw - 0.12, s1 + fw + 0.12, 0.85
            zt_, zb_ = z_d0 - 0.005, z_d0 - 0.9
            ap_real, ap_col = style.get("step", ("concrete", (1.0, 1.0, 1.0)))
            k = 1.0 / (REAL_TILE.get(ap_real) or 2.0)
            self.q(ap_real, F.P(a, zt_, 0.05), F.P(b, zt_, 0.05), F.P(b, zt_ - 0.06, out), F.P(a, zt_ - 0.06, out),
                   ((0, 0), ((b - a) * k, 0), ((b - a) * k, out * k), (0, out * k)), mul3(ap_col, 0.9), facing=(0, 0, 1))
            self.q(ap_real, F.P(a, zb_, out), F.P(b, zb_, out), F.P(b, zt_ - 0.06, out), F.P(a, zt_ - 0.06, out),
                   ((0, 0), ((b - a) * k, 0), ((b - a) * k, 0.8 * k), (0, 0.8 * k)), mul3(ap_col, 0.8), facing=n3)
            for (sx_, fc) in ((a, ne3), (b, e3)):
                self.q(ap_real, F.P(sx_, zb_, 0.05), F.P(sx_, zb_, out), F.P(sx_, zt_ - 0.06, out), F.P(sx_, zt_, 0.05),
                       ((0, 0), (out * k, 0), (out * k, 0.8 * k), (0, 0.8 * k)), mul3(ap_col, 0.8), facing=fc)
        wall_notch = (s0 - fw, s1 + fw, z_top + fw)
        plinth_notch = (s0 - fw, s1 + fw, z_d0)
        return wall_notch, plinth_notch

    STEP_RISE, STEP_TREAD, STEP_MAX = 0.17, 0.30, 14

    def _entrance_steps(self, F: Facade, a: float, b: float, z_top: float, style, key: str) -> bool:
        """Landing + flight of steps from a door threshold down to the real terrain, when the ground in front of the
        door lies more than 0.3 m below it (doors of houses that stand on a bank or above a graded street).

        The flight runs straight out from the wall when the ground levels out within ~2.5 m; otherwise it runs
        along the facade towards the lower side (a Pfalz 'Freitreppe'). Returns False when no flight is needed
        (the caller then builds the plain one-block stoop)."""
        site = self.site
        if site is None:
            return False

        def g_at(s_, d_):
            x_, y_, _ = F.P(s_, 0.0, d_)
            gz = site.ground(x_, y_)
            if gz is None:
                raise RuntimeError(f"_entrance_steps: no terrain height at ({x_:.1f}, {y_:.1f}) for door {key}")
            return gz

        sm = 0.5 * (a + b)
        if z_top - min(g_at(sm, 0.4), g_at(sm, 0.9)) <= 0.30:
            return False
        R, T, NMAX = self.STEP_RISE, self.STEP_TREAD, self.STEP_MAX
        w = b - a

        def simulate(ground_fn, start):
            """Step k occupies [start + (k-1)T, start + kT] along the run; returns step count or None."""
            for k in range(1, NMAX + 1):
                zt = z_top - k * R
                pos = start + (k - 0.5) * T
                if zt - ground_fn(pos) <= R * 0.75:
                    return k
            return None

        st_real, st_col = style.get("step", ("concrete", (1.0, 1.0, 1.0)))
        tile = REAL_TILE.get(st_real) or 2.0
        n3, e3 = F.n3, F.e3
        ne3, nn3 = (-e3[0], -e3[1], 0.0), (-n3[0], -n3[1], 0.0)

        def block(sa, sb, da, db, zt, shade=1.0):
            """Solid step block (Facade coords s sa..sb, outward da..db) from zt down into the ground."""
            zb = min(g_at(sa, da), g_at(sb, da), g_at(sa, db), g_at(sb, db), g_at(0.5 * (sa + sb), 0.5 * (da + db))) - 0.30
            c = mul3(st_col, shade)
            k = 1.0 / tile
            ds, dd, dh = (sb - sa) * k, (db - da) * k, (zt - zb) * k
            self.q(st_real, F.P(sa, zt, da), F.P(sb, zt, da), F.P(sb, zt, db), F.P(sa, zt, db), ((0, 0), (ds, 0), (ds, dd), (0, dd)), c, facing=(0, 0, 1))
            self.q(st_real, F.P(sa, zb, db), F.P(sb, zb, db), F.P(sb, zt, db), F.P(sa, zt, db), ((0, 0), (ds, 0), (ds, dh), (0, dh)), mul3(c, 0.92), facing=n3)
            self.q(st_real, F.P(sa, zb, da), F.P(sa, zb, db), F.P(sa, zt, db), F.P(sa, zt, da), ((0, 0), (dd, 0), (dd, dh), (0, dh)), mul3(c, 0.86), facing=ne3)
            self.q(st_real, F.P(sb, zb, da), F.P(sb, zb, db), F.P(sb, zt, db), F.P(sb, zt, da), ((0, 0), (dd, 0), (dd, dh), (0, dh)), mul3(c, 0.86), facing=e3)
            self.count("step_blocks")

        # 1. straight out from the wall
        land = 0.95
        n_out = simulate(lambda pos: min(g_at(a, pos), g_at(b, pos), g_at(sm, pos)), land)

        def straight():
            block(a, b, 0.05, land, z_top)
            for k in range(1, n_out + 1):
                block(a, b, land + (k - 1) * T, land + k * T, z_top - k * R, 0.97 if k % 2 else 1.0)
            self.count("entrance_flights")
            return True

        if n_out is not None and land + n_out * T <= 2.9:
            return straight()
        # 2. along the facade, towards the lower side (a long straight flight would reach into the street)
        depth = 1.05
        best = None
        for sgn in (-1.0, 1.0):
            edge0 = b if sgn > 0 else a
            n_side = simulate(lambda pos, _e=edge0, _g=sgn: min(g_at(_e + _g * pos, 0.4), g_at(_e + _g * pos, depth)), 0.0)
            if n_side is None:
                continue
            end = edge0 + sgn * n_side * T
            if end < 0.15 or end > F.L - 0.15:
                continue
            if best is None or n_side < best[1]:
                best = (sgn, n_side)
        if best is None and n_out is not None:
            return straight()
        if best is None:
            raise RuntimeError(
                f"_entrance_steps: door {key} sits {z_top - g_at(sm, 0.9):.2f} m above the terrain and neither a straight "
                f"nor a facade flight of <= {NMAX} steps reaches the ground (wall length {F.L:.1f} m)")
        sgn, n_side = best
        block(a, b, 0.05, depth, z_top)
        for k in range(1, n_side + 1):
            if sgn > 0:
                sa_, sb_ = b + (k - 1) * T, b + k * T
            else:
                sa_, sb_ = a - k * T, a - (k - 1) * T
            block(sa_, sb_, 0.05, depth, z_top - k * R, 0.97 if k % 2 else 1.0)
        self.count("entrance_flights")
        return True

    def gate_leaf(self, F: Facade, sa: float, sb: float, z0: float, z1: float, d: float, wood_col, frame_col, key: str,
                  hinge_at_a: bool = True, frame: bool = True):
        """One boarded gate leaf: vertical boards (base mesh) + stiles, three ledges, a brace and strap hinges (detail)."""
        n3 = F.n3
        tile = REAL_TILE.get("wood_planks") or 2.0
        uo = hash01("gl" + key) * 3.0
        w, hgt = sb - sa, z1 - z0
        self.q("wood_planks", F.P(sa, z0, d), F.P(sb, z0, d), F.P(sb, z1, d), F.P(sa, z1, d),
               ((uo, 0.0), (uo + w / tile, 0.0), (uo + w / tile, hgt / tile), (uo, hgt / tile)), wood_col, facing=n3)
        if not frame or w < 0.5 or hgt < 1.0:
            return
        t, fwid = 0.045, min(0.14, w * 0.16)
        fc = mul3(frame_col, 0.9)
        pu0, pv0, pu1, pv1 = J_CELL(2, 1)
        pw = (pu1 - pu0) / 7.0            # one plank of the 7-plank cell

        def bar(a0, b0, za, zb, vertical, plank):
            ua, ub = pu0 + pw * (plank + 0.12), pu0 + pw * (plank + 0.88)
            if vertical:
                uv = ((ua, pv0), (ub, pv0), (ub, pv1), (ua, pv1))
            else:       # grain along the ledge
                uv = ((ua, pv0), (ua, pv1), (ub, pv1), (ub, pv0))
            self.q("joinery", F.P(a0, za, d + t), F.P(b0, za, d + t), F.P(b0, zb, d + t), F.P(a0, zb, d + t), uv, fc, facing=n3)
            euv = ((ua, pv0), (ua + 0.004, pv0), (ua + 0.004, pv1), (ua, pv1))
            if vertical:
                self.q("joinery", F.P(a0, za, d), F.P(a0, za, d + t), F.P(a0, zb, d + t), F.P(a0, zb, d), euv, mul3(fc, 0.7), facing=(-F.ex, -F.ey, 0.0))
                self.q("joinery", F.P(b0, za, d), F.P(b0, za, d + t), F.P(b0, zb, d + t), F.P(b0, zb, d), euv, mul3(fc, 0.7), facing=F.e3)
            else:
                self.q("joinery", F.P(a0, zb, d), F.P(b0, zb, d), F.P(b0, zb, d + t), F.P(a0, zb, d + t), euv, mul3(fc, 0.95), facing=(0, 0, 1))
                self.q("joinery", F.P(a0, za, d), F.P(b0, za, d), F.P(b0, za, d + t), F.P(a0, za, d + t), euv, mul3(fc, 0.55), facing=(0, 0, -1))

        with self.detail_scope():
            bar(sa, sa + fwid, z0, z1, True, 0)
            bar(sb - fwid, sb, z0, z1, True, 6)
            ledges = (z0 + 0.14, z0 + hgt * 0.5 - fwid * 0.5, z1 - 0.14 - fwid)
            for li, zr in enumerate(ledges):
                bar(sa + fwid, sb - fwid, zr, zr + fwid, False, 2 + li)
            # diagonal brace rising from the hinge side (lower field)
            hs, fs = (sa + fwid, sb - fwid) if hinge_at_a else (sb - fwid, sa + fwid)
            zb0, zb1 = ledges[0] + fwid, ledges[1]
            dz = fwid * 1.05
            ua, ub = pu0 + pw * 5.12, pu0 + pw * 5.88
            self.q("joinery", F.P(hs, zb0, d + t), F.P(hs, zb0 + dz, d + t), F.P(fs, zb1, d + t), F.P(fs, zb1 - dz, d + t),
                   ((ua, pv0), (ub, pv0), (ub, pv1), (ua, pv1)), mul3(fc, 0.95), facing=n3)
            zc0, zc1 = ledges[1] + fwid, ledges[2]
            self.q("joinery", F.P(hs, zc0, d + t), F.P(hs, zc0 + dz, d + t), F.P(fs, zc1, d + t), F.P(fs, zc1 - dz, d + t),
                   ((ua, pv0), (ub, pv0), (ub, pv1), (ua, pv1)), mul3(fc, 0.95), facing=n3)
            # wrought strap hinges on the top and bottom ledge
            hu0, hv0, hu1, hv1 = J_CELL(0, 0)
            huv = ((hu0 + 0.02, hv1 - 0.076), (hu0 + 0.06, hv1 - 0.076), (hu0 + 0.06, hv1 - 0.070), (hu0 + 0.02, hv1 - 0.070))
            for zr in (ledges[0], ledges[2]):
                zc = zr + fwid * 0.5
                h0, h1 = (sa - 0.02, sa + w * 0.55) if hinge_at_a else (sb - w * 0.55, sb + 0.02)
                self.q("joinery", F.P(h0, zc - 0.028, d + t + 0.008), F.P(h1, zc - 0.028, d + t + 0.008), F.P(h1, zc + 0.028, d + t + 0.008), F.P(h0, zc + 0.028, d + t + 0.008),
                       huv, (0.05, 0.05, 0.05), facing=n3)

    def _weathering_decals(self, F: Facade, z_foot: float, z_eave: float, holes, notches, col, age: float, key: str, eaves: bool = True):
        """Alpha-blended stains on a street-facing wall: rising damp, run-off under sills and eaves, repaired patches."""
        mean = REAL_MEAN_LIN.get("plaster_smooth", (0.68, 0.65, 0.63))
        base = mul3(col, mean)          # what the wall actually reflects (linear albedo)
        n3 = F.n3
        L = F.L

        def r(t):
            return hash01(t + key)

        def stain(k, hue=(1.0, 1.0, 1.0)):
            return clamp01_3(mul3(mul3(base, k), hue))

        def decal(sa, sb, za, zb, cell, c, salt):
            u0, v0, u1, v1 = atlas_cell(cell[0], cell[1], 4, 2, 0.004)
            if r("fl" + salt) < 0.5:
                u0, u1 = u1, u0
            self.q("grime", F.P(sa, za, 0.008), F.P(sb, za, 0.008), F.P(sb, zb, 0.008), F.P(sa, zb, 0.008),
                   ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), c, facing=n3)
            self.count("decals")

        def free(sa, sb, za, zb, pad=0.06):
            for (h0, h1, ha, hb) in holes:
                if h0 - pad < sb and h1 + pad > sa and ha - pad < zb and hb + pad > za:
                    return False
            for (n0, n1, nz) in notches:
                if n0 - pad < sb and n1 + pad > sa and za < nz + pad:
                    return False
            return True

        with self.detail_scope():
            # rising damp / splash zone at the wall foot
            # (Street View: grey-brown damp / splash bands above the plinth on most old and mid-age houses)
            # every street wall has a splash zone; how dark and how high it reaches follows the house's age
            n_d = 1 + int(L / 6.0)
            for i in range(n_d):
                w = min(L - 0.2, 1.8 + 2.8 * r(f"dw{i}"))
                sa = 0.1 + (L - 0.2 - w) * (i + r(f"ds{i}")) / n_d
                hgt = (0.45 + 0.50 * r(f"dh{i}")) * (0.75 + 0.6 * age)
                # doors cut the band into pieces, low windows only cap its height
                pieces = [(sa, sa + w)]
                for (n0, n1, _nz) in notches:
                    nxt = []
                    for (pa, pb) in pieces:
                        if n0 - 0.04 < pb and n1 + 0.04 > pa:
                            nxt += [(pa, n0 - 0.04), (n1 + 0.04, pb)]
                        else:
                            nxt.append((pa, pb))
                    pieces = nxt
                for j, (pa, pb) in enumerate(pieces):
                    if pb - pa < 0.5:
                        continue
                    h_p = hgt
                    for (h0, h1, ha, _hb) in holes:
                        if h0 - 0.04 < pb and h1 + 0.04 > pa:
                            h_p = min(h_p, ha - 0.06 - z_foot)
                    if h_p >= 0.25:
                        decal(pa, pb, z_foot, z_foot + h_p, (2 + int(r(f"dc{i}") * 2) % 2, 0), stain(0.48 - 0.18 * age + 0.10 * r(f"dk{i}"), (0.95, 0.97, 0.90)), f"d{i}_{j}")
            # dirt run-off below window sills
            for hi, (h0, h1, ha, hb) in enumerate(holes):
                if h1 - h0 < 0.7 or r(f"st{hi}") > 0.35 + 0.55 * age:
                    continue
                top = ha - 0.005
                bot = max(z_foot + 0.03, top - (0.45 + 0.45 * r(f"sl{hi}")))
                for (g0, g1, ga, gb) in holes:
                    if g0 < h1 + 0.1 and g1 > h0 - 0.1 and gb < top:
                        bot = max(bot, gb + 0.05)
                for (n0, n1, nz) in notches:
                    if n0 < h1 + 0.1 and n1 > h0 - 0.1:
                        bot = max(bot, nz + 0.05)
                if top - bot > 0.25:
                    decal(max(0.02, h0 - 0.05), min(L - 0.02, h1 + 0.05), bot, top, (0, 0), stain(0.48 + 0.14 * r(f"sk{hi}")), f"s{hi}")
            # rain-shadow streaks below the eaves
            if eaves and r("ev") < 0.45 + 0.50 * age:
                tops = [hb for (_a, _b, _c, hb) in holes] + [nz for (_a, _b, nz) in notches] + [z_foot]
                hgt = min(0.85, (z_eave - 0.03) - max(tops) - 0.05)
                if hgt > 0.22:
                    w = min(L - 0.2, 1.8 + 3.0 * r("evw"))
                    sa = 0.1 + (L - 0.2 - w) * r("evs")
                    decal(sa, sa + w, z_eave - 0.03 - hgt, z_eave - 0.03, (1, 0) if r("evc") < 0.6 else (3, 1), stain(0.50 + 0.12 * r("evk")), "e")
            # repaired plaster patches / flaking paint on older houses
            if r("pt") < 0.25 + 0.70 * age:
                for attempt in range(5):
                    w = 0.7 + 1.3 * r(f"pw{attempt}")
                    hgt = 0.6 + 1.0 * r(f"ph{attempt}")
                    if L - w - 0.3 <= 0 or z_eave - hgt - 0.4 <= z_foot + 0.5:
                        break
                    sa = 0.15 + (L - w - 0.3) * r(f"ps{attempt}")
                    za = z_foot + 0.5 + (z_eave - hgt - 0.4 - z_foot - 0.5) * r(f"pz{attempt}")
                    if free(sa, sa + w, za, za + hgt, 0.10):
                        if r("pk") < 0.55:
                            decal(sa, sa + w, za, za + hgt, (0, 1), stain(1.12 if r("pl") < 0.5 else 0.80, (1.0, 0.99, 0.95)), "p")
                        else:
                            decal(sa, sa + w, za, za + hgt, (2, 1) if r("pf") < 0.6 else (1, 1), stain(0.66, (1.0, 0.98, 0.94)), "p")
                        break

    _vn_cache: Dict = {}

    @staticmethod
    def _vnoise(x: float, y: float, seed: str) -> float:
        """Small deterministic 2D value noise in [0, 1)."""
        x0, y0 = math.floor(x), math.floor(y)
        fx, fy = x - x0, y - y0
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

        def lat(ix, iy):
            k = (seed, ix, iy)
            v = VillageMeshBuilder._vn_cache.get(k)
            if v is None:
                v = hash01(f"{seed}|{ix}|{iy}")
                VillageMeshBuilder._vn_cache[k] = v
            return v

        a = lat(x0, y0) * (1 - sx) + lat(x0 + 1, y0) * sx
        b = lat(x0, y0 + 1) * (1 - sx) + lat(x0 + 1, y0 + 1) * sx
        return a * (1 - sy) + b * sy

    def add_ivy_cards(self, F: Facade, z0: float, z1: float, top_fn, opens, key: str):
        """Ivy as a thin, irregular layer of alpha-cut leaf cards hugging the wall; it leaves windows and doors free.

        top_fn(s) -> highest z the ivy may reach at s (gable rake), or None for a straight top at z1.
        """
        step = 0.40
        ns, nz = int(F.L / step) + 1, int((z1 - z0) / step) + 1
        from_right = hash01("ivs" + key) < 0.5
        cover = {}
        for i in range(ns):
            for j in range(nz):
                s_ = (i + 0.5 + (hash01(f"ij{key}{i}{j}") - 0.5) * 0.5) * step
                z_ = z0 + (j + 0.5 + (hash01(f"iz{key}{i}{j}") - 0.5) * 0.5) * step
                if s_ < 0.15 or s_ > F.L - 0.15:
                    continue
                zt = top_fn(s_) if top_fn else z1
                if z_ > zt - 0.1:
                    continue
                hf = (z_ - z0) / max(z1 - z0, 1.0)
                sf = s_ / F.L if from_right else 1.0 - s_ / F.L
                n = 0.72 * self._vnoise(s_ * 0.30, z_ * 0.30, key) + 0.28 * self._vnoise(s_ * 1.0, z_ * 1.0, key + "b")
                if n + 0.16 * (1.0 - hf) + 0.22 * sf < 0.50:
                    continue
                if any(o0 - 0.36 < s_ < o1 + 0.36 and oa - 0.36 < z_ < ob + 0.36 for (o0, o1, oa, ob) in opens):
                    continue
                cover[(i, j)] = (s_, z_)
        n3 = F.n3
        with self.detail_scope():
            for (i, j), (s_, z_) in cover.items():
                nb = sum(1 for (di, dj) in ((1, 0), (-1, 0), (0, 1), (0, -1)) if (i + di, j + dj) in cover)
                fringe = nb < 3
                rk = f"{key}{i}_{j}"
                size = (0.80 + 0.30 * hash01("isz" + rk)) * (0.9 if fringe else 1.0)
                cidx = (2 + int(hash01("ic" + rk) * 2) % 2) if fringe else (int(hash01("ic" + rk) * 2) % 2)
                u0, v0, u1, v1 = atlas_cell(cidx % 2, cidx // 2, 2, 2, 0.004)
                ang = (hash01("ia" + rk) - 0.5) * 0.7 if fringe else hash01("ia" + rk) * 2.0 * math.pi
                ca, sa_ = math.cos(ang), math.sin(ang)
                d0 = 0.03 + 0.05 * hash01("id" + rk)
                tilt = 0.10 if fringe else 0.03
                # every corner of the (rotated) card stays below the eave / gable rake: cards poking past the
                # wall top came out through the roof slab and lay on the tiles as stray green clumps
                pts = None
                for shrink in (1.0, 0.75, 0.55):
                    hs = size * 0.5 * shrink
                    cand = []
                    for (lx, lz) in ((-hs, -hs), (hs, -hs), (hs, hs), (-hs, hs)):
                        rx, rz = lx * ca - lz * sa_, lx * sa_ + lz * ca
                        cand.append((s_ + rx, z_ + rz, d0 + tilt * (0.5 + rz / size)))
                    if all(cz <= (top_fn(cs) if top_fn else z1) for (cs, cz, _cd) in cand):
                        pts = [F.P(cs, cz, cd) for (cs, cz, cd) in cand]
                        break
                if pts is None:
                    continue
                g = 0.62 + 0.38 * hash01("ig" + rk)
                colr = (g * (0.80 + 0.2 * hash01("ir" + rk)), g, g * (0.70 + 0.25 * hash01("ib" + rk)))
                self.q("ivy", pts[0], pts[1], pts[2], pts[3], ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), colr, facing=n3)
            self.count("ivy_cards", len(cover))

    def add_fachwerk(self, F: Facade, z0: float, z1: float, holes, floors: List[float], key: str, col):
        """Exposed half-timbering: sill / rail beams per storey, posts beside every opening, corner braces."""
        bw, d = 0.16, 0.02
        real = "wood_beam"
        n3 = F.n3
        L = F.L

        def hbeam(sa, sb, zc):
            if sb - sa < 0.1:
                return
            self.q(real, F.P(sa, zc - bw * 0.5, d), F.P(sb, zc - bw * 0.5, d), F.P(sb, zc + bw * 0.5, d), F.P(sa, zc + bw * 0.5, d),
                   ((0.0, sa * 2.0), (0.3, sa * 2.0), (0.3, sb * 2.0), (0.0, sb * 2.0))[::1], col, facing=n3)

        def vbeam(sc, za, zb):
            if zb - za < 0.1:
                return
            self.q(real, F.P(sc - bw * 0.5, za, d), F.P(sc + bw * 0.5, za, d), F.P(sc + bw * 0.5, zb, d), F.P(sc - bw * 0.5, zb, d),
                   ((0.0, za * 2.0), (0.32, za * 2.0), (0.32, zb * 2.0), (0.0, zb * 2.0)), col, facing=n3)

        levels = sorted(set([z0 + bw * 0.5] + [f for f in floors if z0 + 0.5 < f < z1 - 0.5] + [z1 - bw * 0.5]))
        for zc in levels:
            hbeam(0.0, L, zc)
        for li in range(len(levels) - 1):
            za, zb = levels[li] + bw * 0.5, levels[li + 1] - bw * 0.5
            posts = [bw * 0.5, L - bw * 0.5]
            hs = [h for h in holes if h[2] < zb and h[3] > za]
            for h in hs:
                posts.extend([h[0] - bw * 0.5, h[1] + bw * 0.5])
                hbeam(h[0], h[1], min(zb, h[3] + bw * 0.5))
                hbeam(h[0], h[1], max(za, h[2] - bw * 0.5))
            posts = sorted(posts)
            # fill long fields with extra posts
            extra = []
            for a, b in zip(posts[:-1], posts[1:]):
                inside_hole = any(h[0] - 0.01 <= a and b <= h[1] + 0.01 + bw for h in hs)
                if inside_hole:
                    continue
                gap = b - a
                if gap > 1.55:
                    n_in = int(gap / 1.15)
                    for k_ in range(1, n_in + 0):
                        extra.append(a + gap * k_ / n_in)
            for sc in posts + extra:
                vbeam(sc, za, zb)
            # diagonal braces in the outer fields
            allp = sorted(posts + extra)
            for (a, b, flip) in ((allp[0], allp[1], False), (allp[-2], allp[-1], True)) if len(allp) >= 3 else ():
                if b - a < 0.6 or any(h[0] < b and h[1] > a for h in hs):
                    continue
                sa, sb = (a + bw * 0.5, b - bw * 0.5) if not flip else (b - bw * 0.5, a + bw * 0.5)
                dz = zb - za
                ln = math.hypot(sb - sa, dz)
                ox = bw * 0.5 * dz / ln * (1 if sb > sa else -1)
                self.q(real, F.P(sa - ox * 0 , za, d), F.P(sa + 2 * ox, za, d), F.P(sb, zb, d), F.P(sb - 2 * ox, zb, d),
                       ((0.0, 0.0), (0.32, 0.0), (0.32, ln * 2.0), (0.0, ln * 2.0)), col, facing=n3)
    # ---------------- greenery & balconies (corridor specials) ----------------
    def add_ivy_blanket_on_wall(self, pts: List[Tuple[float, float]], z_bot: float, z_top: float, ivy_dir_blender: Tuple[float, float]):
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
            nx, ny = ey, -ex
            if nx * tx + ny * ty < 0.45:
                continue
            u_vec = Vector((ex, ey, 0.0))
            v_vec = Vector((nx, ny, 0.0))
            wall_h = max(1.0, z_top - z_bot)
            n_strips = max(4, int(elen / 1.4))
            for k in range(n_strips):
                f0 = (k + 0.06) / n_strips
                f1 = (k + 0.94) / n_strips
                mid_f = 0.5 * (f0 + f1)
                strip_w = (f1 - f0) * elen + 0.18
                wave = 0.72 + 0.28 * math.sin(mid_f * math.pi * 1.4 + 0.5)
                h_strip = min(wall_h + 0.15, wall_h * wave)
                zc = z_top - h_strip * 0.48
                px = x0 + (x1 - x0) * mid_f + nx * 0.14
                py = y0 + (y1 - y0) * mid_f + ny * 0.14
                shade = 0.82 + 0.18 * hash01(f"ivy{i}{k}{x0:.1f}")
                self.add_box(Vector((px, py, zc)), u_vec, v_vec, sx=strip_w, sy=0.24, sz=h_strip, mat_key="ivy_foliage", uv_scale=1.8,
                             col=(shade, shade, shade))

    def add_dark_balconies(self, pts: List[Tuple[float, float]], z_base: float, z_eave: float, balcony_dir_blender: Tuple[float, float],
                           balcony_mat: str = "trim_wood", balcony_w: Optional[float] = None):
        """Stacked timber / white balconies on the specified facade (Neugasse QOR1, Triftstr #6, Kirchrain #7/#16/#18)."""
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
            # slab + boarded parapet with gaps between rail and boards + posts
            self.add_box(Vector((mx, my, bz)), u_vec, v_vec, sx=bw, sy=bd, sz=0.18, mat_key=balcony_mat)
            front = Vector((mx + nx * (bd * 0.46), my + ny * (bd * 0.46), 0.0))
            self.add_box(front + Vector((0, 0, bz + 0.48)), u_vec, v_vec, sx=bw, sy=0.05, sz=0.62, mat_key=balcony_mat)
            self.add_box(front + Vector((0, 0, bz + 0.98)), u_vec, v_vec, sx=bw + 0.06, sy=0.09, sz=0.07, mat_key=balcony_mat)
            n_post = max(2, int(bw / 1.8) + 1)
            for k in range(n_post):
                f = -0.5 + k / (n_post - 1)
                self.add_box(front + u_vec * (bw * f * 0.985) + Vector((0, 0, bz + 0.52)), u_vec, v_vec, sx=0.08, sy=0.08, sz=0.94, mat_key=balcony_mat, skip_bottom=True)
            for sgn in (-1.0, 1.0):
                sc = Vector((mx + ex * sgn * (bw * 0.49), my + ey * sgn * (bw * 0.49), bz + 0.48))
                self.add_box(sc, u_vec, v_vec, sx=0.05, sy=bd, sz=0.62, mat_key=balcony_mat)
                self.add_box(sc + Vector((0, 0, 0.50)), u_vec, v_vec, sx=0.09, sy=bd, sz=0.07, mat_key=balcony_mat)

    def add_facade_wall_ring(self, pts: List[Tuple[float, float]], z_bot: float, z_eave: float, wall_mat: str, is_windowed: bool = True):
        """Plain wall ring (used by accessories / archetype fallbacks); buildings go through build_building()."""
        real, tint = self.look(wall_mat)
        perim = 0.0
        n = len(pts)
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            F = Facade(x0, y0, x1, y1, perim)
            if F.L >= 0.08:
                self.wall_panel(F, z_bot, z_eave, real, tint, bands=False)
            perim += F.L

    # ---------------- roofs ----------------
    def _roof_look(self, roof_mat: str):
        real, col = self.look(roof_mat)
        return real, col, (REAL_TILE.get(real) or 3.0)

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
        main_roof: bool = False,
        gutters: bool = True,
    ):
        """Gabled roof wing (Satteldach): gable walls with attic windows, thick tiled slabs with verge + barge boards,
        soffits, gutters, ridge tiles, chimney, dormers, roof lights, solar PV & ivy."""
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
        cur = self.cur if main_roof else None
        style = (cur or {}).get("style")

        def wpt(du, dv, z):
            p = c_vec + u_vec * du + v_vec * dv
            return (p.x, p.y, z)

        g_mat = gable_wall_mat or wall_mat
        g_real, g_col = self.look(g_mat)
        r_real, r_col, r_tile = self._roof_look(roof_mat)
        f_real, f_col = self.look(fascia_mat)
        uo = hash01(f"ruv{seed}{cx:.1f}") * 5.0

        # 1. gable end walls (du = -hu / +hu) with real attic windows
        if add_gable_walls:
            for sign_u in (-1.0, 1.0):
                du = sign_u * hu
                if sign_u > 0:
                    a, b = wpt(du, -hv, z_eave), wpt(du, hv, z_eave)
                else:
                    a, b = wpt(du, hv, z_eave), wpt(du, -hv, z_eave)
                F = Facade(a[0], a[1], b[0], b[1], hash01(f"g{seed}{sign_u}") * 4.0)
                holes = []
                tier = "B"
                if cur is not None:
                    tier = cur["tier_at"](0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), F.nx, F.ny)
                want_window = (
                    cur is not None and style is not None and cur.get("windowed") and (not no_attic_window)
                    and tier != "party" and len_v >= 5.0 and roof_h >= 2.1
                )
                if want_window:
                    aw = min(style["ww"] * 0.92, len_v * 0.19)
                    ah = min(style["wh"] * 0.85, roof_h * 0.36)
                    zc = z_eave + roof_h * 0.30
                    fwm = style.get("fw", 0.12) if style.get("surround") else 0.0
                    z_hi = zc + ah * 0.5 + fwm
                    half_at_top = hv * max(0.0, 1.0 - (z_hi - z_eave) / max(roof_h, 0.5))
                    if half_at_top >= aw * 0.5 + fwm + 0.30 and ah > 0.5 and aw > 0.5:
                        key = f"{cur['id']}_g{sign_u}"
                        wide = len_v >= 9.0 and roof_h >= 3.4
                        offs = [-(aw * 0.5 + 0.55), (aw * 0.5 + 0.55)] if (wide and half_at_top >= aw * 1.5 + fwm + 0.9) else [0.0]
                        for wi, off in enumerate(offs):
                            holes.append(self.add_window(
                                F, hv + off - aw * 0.5, hv + off + aw * 0.5, zc - ah * 0.5, zc + ah * 0.5,
                                style, "A" if tier == "A" else "B", g_real, g_col, f"{key}_{wi}",
                                cell=(WIN_ATTIC if hash01(key) < 0.45 else None), allow_shutters=False))
                lift = min(0.07, slab_thick * 0.45)
                g_top = [(F.L, z_eave + lift), (hv, z_eave + roof_h + lift), (0.0, z_eave + lift)]
                ok = self.wall_panel(F, z_eave, z_eave + roof_h, g_real, g_col, holes=holes, poly_top=g_top, bands=False, uv_off=(uo, 0.0))
                if not ok:
                    self.wall_panel(F, z_eave, z_eave + roof_h, g_real, g_col, poly_top=g_top, bands=False)
                if cur is not None and cur.get("fachwerk") and tier != "party":
                    self._gable_fachwerk(F, z_eave, roof_h, hv, holes, cur["fachwerk_col"])

                # climbing ivy across the gable triangle (leaf cards hugging the wall, clear of the attic windows)
                if ivy_dir is not None and cur is not None:
                    gnx, gny = sign_u * ux, sign_u * uy
                    id_len = math.hypot(ivy_dir[0], ivy_dir[1])
                    if id_len > 1e-4 and (gnx * ivy_dir[0] + gny * ivy_dir[1]) / id_len > 0.45:
                        self.add_ivy_cards(F, z_eave - 0.05, z_eave + roof_h,
                                           lambda s_, _hv=hv, _ze=z_eave, _rh=roof_h: _ze + _rh * max(0.0, 1.0 - abs(s_ - _hv) / _hv) - 0.25,
                                           holes, f"{cur['id']}_givy{sign_u}")

        # 2. roof slabs
        hu_o = hu + overhang_gable
        hv_o = hv + overhang_eave
        z_ridge = z_eave + roof_h
        z_eave_o = z_eave - eave_drop
        slope_len = math.hypot(hv_o, z_ridge - z_eave_o)
        tu = (2.0 * hu_o) / r_tile
        tv = slope_len / r_tile
        up3 = (0.0, 0.0, 1.0)
        verge_h = min(0.085, slab_thick * 0.5)
        # slope-normal offset direction components for the given side
        s_cos = hv_o / max(slope_len, 1e-6)

        for side in (-1.0, 1.0):
            out3 = (vx * side, vy * side, 0.0)
            r0_t, r1_t = wpt(-hu_o, 0.0, z_ridge + slab_thick), wpt(hu_o, 0.0, z_ridge + slab_thick)
            e0_t, e1_t = wpt(-hu_o, side * hv_o, z_eave_o + slab_thick), wpt(hu_o, side * hv_o, z_eave_o + slab_thick)
            r0_b, r1_b = wpt(-hu_o, 0.0, z_ridge), wpt(hu_o, 0.0, z_ridge)
            e0_b, e1_b = wpt(-hu_o, side * hv_o, z_eave_o), wpt(hu_o, side * hv_o, z_eave_o)
            # tiles: V runs up the slope from the eave (eaves = bottom of the scan)
            if cur is not None and (2.0 * hu_o) * slope_len > 16.0:
                # weathering never is even: 2 rows x n columns with a tone per node (soot, lichen, replaced areas)
                r_age = cur.get("age", 0.4)
                ncol = max(1, min(4, int(round(2.0 * hu_o / 5.5))))
                nrow = 2
                mossy = (vx * side * 0.0 + vy * side) > 0.3 and r_age > 0.45     # north-facing slopes of old roofs

                def node(i, j):
                    uf, vf = i / ncol, j / nrow
                    pnt = wpt(-hu_o + 2.0 * hu_o * uf, side * hv_o * (1.0 - vf),
                              (z_eave_o + slab_thick) * (1.0 - vf) + (z_ridge + slab_thick) * vf)
                    k = 1.0 - (0.06 + 0.14 * r_age) * hash01(f"rn{seed}{side}{i}{j}{cx:.1f}")
                    if j == 0:
                        k *= 0.96
                    c = mul3(r_col, k)
                    if mossy and j == 0:
                        c = (c[0] * 0.90, c[1] * 0.98, c[2] * 0.84)
                    return pnt, (uo + tu * uf, tv * vf), c

                for i in range(ncol):
                    for j in range(nrow):
                        (p00, uv00, c00), (p10, uv10, c10) = node(i, j), node(i + 1, j)
                        (p11, uv11, c11), (p01, uv01, c01) = node(i + 1, j + 1), node(i, j + 1)
                        self.q(r_real, p00, p10, p11, p01, (uv00, uv10, uv11, uv01), (c00, c10, c11, c01), facing=up3)
            else:
                self.q(r_real, e0_t, e1_t, r1_t, r0_t, ((uo, 0.0), (uo + tu, 0.0), (uo + tu, tv), (uo, tv)), r_col, facing=up3)
            # soffit
            self.q(f_real, e0_b, e1_b, r1_b, r0_b, ((0.0, 0.0), (0.0, tu * 2.0), (2.0, tu * 2.0), (2.0, 0.0)), mul3(f_col, 0.85), facing=(0, 0, -1))
            # eaves fascia
            self.q(f_real, e0_b, e1_b, e1_t, e0_t, ((0.0, 0.0), (0.0, tu * 3.0), (0.4, tu * 3.0), (0.4, 0.0)), f_col, facing=out3)
            # verges: barge board + tile edge course
            for (sg, rb, rt, eb, et) in ((-1.0, r0_b, r0_t, e0_b, e0_t), (1.0, r1_b, r1_t, e1_b, e1_t)):
                g3 = (ux * sg, uy * sg, 0.0)
                self.q(f_real, eb, rb, rt, et, ((0.0, 0.0), (0.0, tv * 3.0), (0.4, tv * 3.0), (0.4, 0.0)), f_col, facing=g3)
                o = 0.014
                et2 = (et[0] + g3[0] * o, et[1] + g3[1] * o, et[2] + 0.004)
                rt2 = (rt[0] + g3[0] * o, rt[1] + g3[1] * o, rt[2] + 0.004)
                eb2 = (et2[0], et2[1], et2[2] - verge_h)
                rb2 = (rt2[0], rt2[1], rt2[2] - verge_h)
                self.q(r_real, eb2, rb2, rt2, et2, ((uo, 0.0), (uo, tv), (uo + 0.06, tv), (uo + 0.06, 0.0)), mul3(r_col, 0.88), facing=g3)

            # zinc gutter along the eaves
            if gutters and len_u >= 3.2 and overhang_eave >= 0.2:
                self.gutter(wpt(0.0, side * (hv_o + 0.06), z_eave_o + 0.035), u_vec, v_vec * side, 2.0 * hu_o - 0.04)

            # solar PV array (module-accurate UVs) on the slope facing solar_pv_dir
            if solar_pv_dir is not None:
                snx, sny = side * vx, side * vy
                sd_len = math.hypot(solar_pv_dir[0], solar_pv_dir[1])
                if sd_len > 1e-4 and (snx * solar_pv_dir[0] + sny * solar_pv_dir[1]) / sd_len > 0.35:
                    mod_w, mod_h = 1.03, 1.72
                    n_u = max(1, int((2.0 * hu - 0.7) / mod_w))
                    n_v = max(1, int((slope_len * 0.80) / mod_h))
                    arr_w, arr_h = n_u * mod_w, n_v * mod_h
                    t_lo = max(0.08, 0.5 - 0.5 * arr_h / slope_len - 0.04)
                    t_hi = t_lo + arr_h / slope_len
                    dz_pv = 0.10

                    def pv_pt(du_val, frac, lift=dz_pv):
                        dv_val = side * hv_o * (1.0 - frac)
                        zz = (z_eave_o + slab_thick) * (1.0 - frac) + (z_ridge + slab_thick) * frac + lift
                        return wpt(du_val, dv_val, zz)

                    p_e0, p_e1 = pv_pt(-arr_w * 0.5, t_lo), pv_pt(arr_w * 0.5, t_lo)
                    p_r0, p_r1 = pv_pt(-arr_w * 0.5, t_hi), pv_pt(arr_w * 0.5, t_hi)
                    self.q("solar", p_e0, p_e1, p_r1, p_r0, ((0.0, 0.0), (n_u, 0.0), (n_u, n_v), (0.0, n_v)), WHITE, facing=up3)
                    b_e0, b_e1 = pv_pt(-arr_w * 0.5, t_lo, 0.01), pv_pt(arr_w * 0.5, t_lo, 0.01)
                    b_r0, b_r1 = pv_pt(-arr_w * 0.5, t_hi, 0.01), pv_pt(arr_w * 0.5, t_hi, 0.01)
                    dark = (0.10, 0.10, 0.11)
                    euv = ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1))
                    self.q("paint", b_e0, b_e1, p_e1, p_e0, euv, dark, facing=out3)
                    self.q("paint", b_e1, b_r1, p_r1, p_e1, euv, dark, facing=(ux, uy, 0.0))
                    self.q("paint", b_r0, b_e0, p_e0, p_r0, euv, dark, facing=(-ux, -uy, 0.0))
                    self.count("solar_arrays")

            # roof lights (Dachflächenfenster) on lived-in attics
            if cur is not None and cur.get("skylights") and len_u >= 6.0 and solar_pv_dir is None:
                n_sky = cur["skylights"]
                if hash01(f"sk{cur['id']}{side}") < 0.55:
                    sw, sh = 0.78, 1.18
                    for k in range(n_sky):
                        du_c = (k - (n_sky - 1) * 0.5) * max(2.2, len_u * 0.28) + (hash01(f"sko{cur['id']}{side}") - 0.5) * 1.0
                        if abs(du_c) > hu - 1.0:
                            continue
                        f_lo = 0.34
                        f_hi = f_lo + sh / slope_len

                        def sk_pt(du_val, frac, lift):
                            dv_val = side * hv_o * (1.0 - frac)
                            zz = (z_eave_o + slab_thick) * (1.0 - frac) + (z_ridge + slab_thick) * frac + lift
                            return wpt(du_val, dv_val, zz)

                        a0, a1 = sk_pt(du_c - sw * 0.5, f_lo, 0.05), sk_pt(du_c + sw * 0.5, f_lo, 0.05)
                        b0, b1 = sk_pt(du_c - sw * 0.5, f_hi, 0.05), sk_pt(du_c + sw * 0.5, f_hi, 0.05)
                        u0_, v0_, u1_, v1_ = atlas_cell(*WIN_SKYLIGHT)
                        self.q(self._pick_lit(f"sky{cur['id']}{side}{k}", WIN_SKYLIGHT), a0, a1, b1, b0,
                               ((u0_, v0_), (u1_, v0_), (u1_, v1_), (u0_, v1_)), WHITE, facing=up3)
                        self.count("skylights")

        # 3. ridge tiles (saddle profile)
        rw, rh = 0.15, 0.075
        z_r = z_ridge + slab_thick
        drop = rw * slope_ratio
        for side in (-1.0, 1.0):
            a0, a1 = wpt(-hu_o - 0.02, 0.0, z_r + rh), wpt(hu_o + 0.02, 0.0, z_r + rh)
            b0, b1 = wpt(-hu_o - 0.02, side * rw, z_r - drop + 0.035), wpt(hu_o + 0.02, side * rw, z_r - drop + 0.035)
            self.q(r_real, b0, b1, a1, a0, ((uo, 0.0), (uo + tu, 0.0), (uo + tu, 0.09), (uo, 0.09)), mul3(r_col, 0.90), facing=up3)
        for sg in (-1.0, 1.0):
            du_e = sg * (hu_o + 0.02)
            self.t(r_real, wpt(du_e, -rw, z_r - drop + 0.035), wpt(du_e, rw, z_r - drop + 0.035), wpt(du_e, 0.0, z_r + rh),
                   ((0.0, 0.0), (0.1, 0.0), (0.05, 0.05)), mul3(r_col, 0.8), facing=(ux * sg, uy * sg, 0.0))

        # 4. chimney near the ridge
        if add_chimney and len_u >= 5.0 and len_v >= 4.0:
            ch_u = ((seed % 5) - 2) * (hu * 0.26)
            ch_v = (0.28 if (seed % 2 == 0) else -0.28) * min(hv * 0.45, 1.2)
            ch_base_z = z_eave + roof_h * (1.0 - abs(ch_v) / max(hv, 0.5)) - 0.35
            ch_top_z = z_ridge + slab_thick + 0.72 + (seed % 3) * 0.14
            ch_h = max(1.1, ch_top_z - ch_base_z)
            brick = (seed >> 3) % 5 < 3
            if brick:
                c_real, c_col = "brick", (0.86 + 0.14 * hash01(f"chb{seed}"),) * 3
            else:
                c_real, c_col = g_real, mul3(g_col, 0.92)
            cs = 0.50 + ((seed >> 5) % 3) * 0.06
            self.box(c_real, wpt(ch_u, ch_v, ch_base_z + ch_h * 0.5), u_vec, v_vec, cs, cs, ch_h, c_col, skip_bottom=True, skip_top=True)
            self.box("concrete", wpt(ch_u, ch_v, ch_top_z + 0.04), u_vec, v_vec, cs + 0.12, cs + 0.12, 0.08, (0.9, 0.9, 0.9))
            # sooty flue opening on top of the cover slab
            fl = cs * 0.28
            self.q("paint", wpt(ch_u - fl, ch_v - fl, ch_top_z + 0.085), wpt(ch_u + fl, ch_v - fl, ch_top_z + 0.085),
                   wpt(ch_u + fl, ch_v + fl, ch_top_z + 0.085), wpt(ch_u - fl, ch_v + fl, ch_top_z + 0.085),
                   ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), (0.03, 0.03, 0.03), facing=(0, 0, 1))
            self.count("chimneys")

        # 5. roof dormers (Gauben) with a real window in the front
        if add_dormer and len_u >= 8.5 and len_v >= 6.4 and roof_h >= 2.6:
            d_mat = dormer_mat or wall_mat
            d_real, d_col = self.look(d_mat)
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
            for di, du_d in enumerate(d_offsets):
                dv_front = d_side * (hv * 0.58)
                dv_center = dv_front - d_side * (dd * 0.42)
                z_d_bot = z_eave + roof_h * (1.0 - abs(dv_front) / max(hv, 0.5)) - 0.14
                d_c = wpt(du_d, dv_center, z_d_bot + dh * 0.5)
                self.box(d_real, d_c, u_vec, v_vec, dw, dd, dh, d_col, skip_bottom=True, skip_top=True)
                # window on the dormer front (flush unit + slim frame)
                fa = wpt(du_d - d_side * dw * 0.5, dv_center + d_side * (dd * 0.5 + 0.012), 0.0)
                fb = wpt(du_d + d_side * dw * 0.5, dv_center + d_side * (dd * 0.5 + 0.012), 0.0)
                Fd = Facade(fa[0], fa[1], fb[0], fb[1])
                if Fd.nx * vx * d_side + Fd.ny * vy * d_side < 0:
                    Fd = Facade(fb[0], fb[1], fa[0], fa[1])
                wkey = f"{(cur or {}).get('id', seed)}_d{di}"
                cells = style["cells"] if style else WIN_FAMILIES["white"]
                cell = cells[int(hash01("dc" + wkey) * len(cells)) % len(cells)]
                self.window_unit(Fd, 0.22, dw - 0.22, z_d_bot + 0.32, z_d_bot + dh - 0.14, 0.0, cell, wkey)
                self.add_gabled_roof_wing(
                    center_xy=(d_c[0], d_c[1]),
                    u_axis=(v_vec.x * d_side, v_vec.y * d_side),
                    v_axis=(-v_vec.y * d_side, v_vec.x * d_side),
                    len_u=dd + 0.15, len_v=dw + 0.10, z_eave=z_d_bot + dh,
                    roof_h=0.95 if dormer_mat else 0.68,
                    wall_mat=d_mat, roof_mat=roof_mat,
                    overhang_eave=0.16, overhang_gable=0.18, slab_thick=0.10,
                    add_gable_walls=True, gable_wall_mat=d_mat, gutters=False, seed=seed + 7,
                )
                self.count("dormers")

    def _gable_fachwerk(self, F: Facade, z_eave: float, roof_h: float, hv: float, holes, col):
        """Half-timbered gable triangle: tie beam, king post, collar + struts following the rafters."""
        bw, d = 0.16, 0.02
        n3 = F.n3

        def qb(p0, p1, p2, p3):
            self.q("wood_beam", F.P(p0[0], p0[1], d), F.P(p1[0], p1[1], d), F.P(p2[0], p2[1], d), F.P(p3[0], p3[1], d),
                   ((0.0, 0.0), (0.32, 0.0), (0.32, 2.0), (0.0, 2.0)), col, facing=n3)

        L = F.L
        qb((0.0, z_eave), (L, z_eave), (L, z_eave + bw), (0.0, z_eave + bw))
        zc = z_eave + roof_h * 0.55
        half_c = hv * (1.0 - 0.55)
        qb((hv - half_c, zc), (hv + half_c, zc), (hv + half_c - bw * 0.3, zc + bw), (hv - half_c + bw * 0.3, zc + bw))
        if not any(h[0] < hv + bw and h[1] > hv - bw for h in holes):
            qb((hv - bw * 0.5, z_eave + bw), (hv + bw * 0.5, z_eave + bw), (hv + bw * 0.5, z_eave + roof_h - 0.25), (hv - bw * 0.5, z_eave + roof_h - 0.25))
        for frac in (0.28, 0.72):
            sc = L * frac
            top = z_eave + roof_h * (1.0 - abs(sc - hv) / hv) - 0.12
            if top - z_eave > 0.6 and not any(h[0] < sc + bw and h[1] > sc - bw for h in holes):
                qb((sc - bw * 0.5, z_eave + bw), (sc + bw * 0.5, z_eave + bw), (sc + bw * 0.5, top), (sc - bw * 0.5, top))

    def add_hipped_roof_obb(self, obb: Dict, z_eave: float, roof_h: float, roof_mat: str, overhang: float = 0.36,
                            slab_thick: float = 0.16, add_chimney: bool = False, seed: int = 0, fascia_mat: str = "trim_wood"):
        """Hipped roof (Walmdach / Zeltdach) with fascia, soffit, gutters and ridge / hip tiles."""
        cx, cy = obb["center"]
        ux, uy = obb["u_axis"]
        vx, vy = obb["v_axis"]
        u_vec = Vector((ux, uy, 0.0))
        v_vec = Vector((vx, vy, 0.0))
        c_vec = Vector((cx, cy, 0.0))
        r_real, r_col, T = self._roof_look(roof_mat)
        f_real, f_col = self.look(fascia_mat)
        hu = obb["len_u"] * 0.5 + overhang
        hv = obb["len_v"] * 0.5 + overhang
        ridge_half = max(0.0, hu - hv * 0.92)
        z_bot = z_eave - 0.10
        z_top = z_eave + slab_thick
        z_ridge = z_eave + roof_h + slab_thick
        up3 = (0.0, 0.0, 1.0)
        uo = hash01(f"hip{seed}{cx:.1f}") * 5.0

        def wpt(du, dv, z):
            p = c_vec + u_vec * du + v_vec * dv
            return (p.x, p.y, z)

        b0, b1, b2, b3 = wpt(-hu, -hv, z_bot), wpt(hu, -hv, z_bot), wpt(hu, hv, z_bot), wpt(-hu, hv, z_bot)
        t0, t1, t2, t3 = wpt(-hu, -hv, z_top), wpt(hu, -hv, z_top), wpt(hu, hv, z_top), wpt(-hu, hv, z_top)
        self.q(f_real, b3, b2, b1, b0, ((0, 0), (2, 0), (2, 2), (0, 2)), mul3(f_col, 0.85), facing=(0, 0, -1))
        for (p0, p1, q1, q0, fc, ln) in ((b0, b1, t1, t0, (-vx, -vy, 0), 2 * hu), (b1, b2, t2, t1, (ux, uy, 0), 2 * hv),
                                          (b2, b3, t3, t2, (vx, vy, 0), 2 * hu), (b3, b0, t0, t3, (-ux, -uy, 0), 2 * hv)):
            self.q(f_real, p0, p1, q1, q0, ((0, 0), (0, ln * 2.0), (0.5, ln * 2.0), (0.5, 0)), f_col, facing=fc)
            mid = Vector(((p0[0] + p1[0]) * 0.5 + fc[0] * 0.06, (p0[1] + p1[1]) * 0.5 + fc[1] * 0.06, z_top - 0.07))
            ax = u_vec if abs(fc[0] * ux + fc[1] * uy) < 0.5 else v_vec
            self.gutter(mid, ax, Vector((fc[0], fc[1], 0.0)), ln - 0.04)

        slope_v = math.hypot(hv, roof_h) / T
        u_full = (2.0 * hu) / T
        u_r0 = (hu - ridge_half) / T
        u_r1 = (hu + ridge_half) / T
        if ridge_half < 0.25:
            apex = wpt(0.0, 0.0, z_ridge)
            for p0, p1 in ((t0, t1), (t1, t2), (t2, t3), (t3, t0)):
                elen = math.dist(p0, p1) / T
                self.t(r_real, p0, p1, apex, ((uo, 0), (uo + elen, 0), (uo + elen * 0.5, slope_v)), r_col, facing=up3)
        else:
            r0 = wpt(-ridge_half, 0.0, z_ridge)
            r1 = wpt(ridge_half, 0.0, z_ridge)
            self.q(r_real, t0, t1, r1, r0, ((uo, 0), (uo + u_full, 0), (uo + u_r1, slope_v), (uo + u_r0, slope_v)), r_col, facing=up3)
            self.q(r_real, t2, t3, r0, r1, ((uo, 0), (uo + u_full, 0), (uo + u_r1, slope_v), (uo + u_r0, slope_v)), r_col, facing=up3)
            hv_u = (2.0 * hv) / T
            hip_slope = math.hypot(hu - ridge_half, roof_h) / T
            self.t(r_real, t1, t2, r1, ((uo, 0), (uo + hv_u, 0), (uo + hv_u * 0.5, hip_slope)), r_col, facing=up3)
            self.t(r_real, t3, t0, r0, ((uo, 0), (uo + hv_u, 0), (uo + hv_u * 0.5, hip_slope)), r_col, facing=up3)
            self.beam(r_real, wpt(-ridge_half - 0.1, 0.0, z_ridge + 0.03), wpt(ridge_half + 0.1, 0.0, z_ridge + 0.03), 0.24, 0.12, mul3(r_col, 0.9), caps=True)
            for (tp, rp) in ((t0, r0), (t3, r0), (t1, r1), (t2, r1)):
                self.beam(r_real, (tp[0], tp[1], tp[2] + 0.03), (rp[0], rp[1], rp[2] + 0.03), 0.22, 0.10, mul3(r_col, 0.9))

        if add_chimney:
            ch_u = (ridge_half * 0.35) * (1 if seed % 2 == 0 else -1)
            self.box("brick", wpt(ch_u, 0.35, z_ridge + 0.25), u_vec, v_vec, 0.55, 0.55, 1.25, (0.92, 0.92, 0.92), skip_bottom=True)
            self.box("concrete", wpt(ch_u, 0.35, z_ridge + 0.92), u_vec, v_vec, 0.66, 0.66, 0.09, (0.9, 0.9, 0.9))

    def add_polygon_hipped_roof(self, pts: List[Tuple[float, float]], z_eave: float, roof_h: float, roof_mat: str):
        """Guaranteed watertight pitched roof for ANY arbitrary non-rectangular/irregular polygon."""
        r_real, r_col, T = self._roof_look(roof_mat)
        f_real, f_col = self.look("trim_wood")
        outer = offset_polygon_outward(pts, 0.28)
        n = len(outer)
        cx = sum(p[0] for p in pts) / n
        cy = sum(p[1] for p in pts) / n
        if not point_in_polygon(cx, cy, pts):
            vecs = [Vector((p[0], p[1], 0.0)) for p in pts]
            tris = tessellate_polygon([vecs])
            if tris:
                best_t = max(tris, key=lambda t: abs((vecs[t[1]] - vecs[t[0]]).cross(vecs[t[2]] - vecs[t[0]]).z))
                cx = (vecs[best_t[0]].x + vecs[best_t[1]].x + vecs[best_t[2]].x) / 3.0
                cy = (vecs[best_t[0]].y + vecs[best_t[1]].y + vecs[best_t[2]].y) / 3.0
        z_bot = z_eave - 0.10
        z_top = z_eave + 0.16
        for i in range(n):
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            ln = math.hypot(x1 - x0, y1 - y0)
            self.q(f_real, (x0, y0, z_bot), (x1, y1, z_bot), (x1, y1, z_top), (x0, y0, z_top),
                   ((0, 0), (0, ln * 2.0), (0.5, ln * 2.0), (0.5, 0)), f_col)
            ix0, iy0 = pts[i]
            ix1, iy1 = pts[(i + 1) % n]
            self.q(f_real, (x0, y0, z_bot), (ix0, iy0, z_bot), (ix1, iy1, z_bot), (x1, y1, z_bot),
                   ((0, 0), (0.5, 0), (0.5, ln * 2.0), (0, ln * 2.0)), mul3(f_col, 0.85), facing=(0, 0, -1))
        vecs = [Vector((p[0], p[1], 0.0)) for p in outer]
        tris = tessellate_polygon([vecs])
        apex = (cx, cy, z_top + roof_h)
        is_star = True
        for i in range(n):
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            if (x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0) <= 0.01:
                is_star = False
                break
        up3 = (0.0, 0.0, 1.0)
        if is_star:
            for i in range(n):
                x0, y0 = outer[i]
                x1, y1 = outer[(i + 1) % n]
                elen = math.hypot(x1 - x0, y1 - y0)
                slope = math.hypot(math.hypot(0.5 * (x0 + x1) - cx, 0.5 * (y0 + y1) - cy), roof_h)
                self.t(r_real, (x0, y0, z_top), (x1, y1, z_top), apex, ((0, 0), (elen / T, 0), (elen / (2 * T), slope / T)), r_col, facing=up3)
        else:
            for t in tris:
                p0, p1, p2 = outer[t[0]], outer[t[1]], outer[t[2]]
                self.t(r_real, (p0[0], p0[1], z_top), (p1[0], p1[1], z_top), (p2[0], p2[1], z_top),
                       (((p0[0] - cx) / T, (p0[1] - cy) / T), ((p1[0] - cx) / T, (p1[1] - cy) / T), ((p2[0] - cx) / T, (p2[1] - cy) / T)), r_col, facing=up3)

    def add_skillion_roof(self, obb: Dict, z_eave: float, roof_h: float, wall_mat: str, roof_mat: str, overhang: float = 0.26, fascia_mat: str = "trim_wood"):
        """Mono-pitch shed/garage roof with raised rear wall, side spandrels & overhang fascia."""
        cx, cy = obb["center"]
        ux, uy = obb["u_axis"]
        vx, vy = obb["v_axis"]
        u_vec = Vector((ux, uy, 0.0))
        v_vec = Vector((vx, vy, 0.0))
        c_vec = Vector((cx, cy, 0.0))
        hu = obb["len_u"] * 0.5
        hv = obb["len_v"] * 0.5
        w_real, w_col = self.look(wall_mat)
        r_real, r_col, T = self._roof_look(roof_mat)
        f_real, f_col = self.look(fascia_mat)
        wt = REAL_TILE.get(w_real) or 2.0

        def wpt(du, dv, z):
            p = c_vec + u_vec * du + v_vec * dv
            return (p.x, p.y, z)

        self.q(w_real, wpt(-hu, -hv, z_eave), wpt(hu, -hv, z_eave), wpt(hu, -hv, z_eave + roof_h), wpt(-hu, -hv, z_eave + roof_h),
               ((0, 0), (2 * hu / wt, 0), (2 * hu / wt, roof_h / wt), (0, roof_h / wt)), w_col, facing=(-vx, -vy, 0))
        self.t(w_real, wpt(hu, -hv, z_eave), wpt(hu, hv, z_eave), wpt(hu, -hv, z_eave + roof_h),
               ((0, 0), (2 * hv / wt, 0), (0, roof_h / wt)), w_col, facing=(ux, uy, 0))
        self.t(w_real, wpt(-hu, hv, z_eave), wpt(-hu, -hv, z_eave), wpt(-hu, -hv, z_eave + roof_h),
               ((0, 0), (2 * hv / wt, 0), (2 * hv / wt, roof_h / wt)), w_col, facing=(-ux, -uy, 0))

        hu_o = hu + overhang
        hv_o = hv + overhang
        thick = 0.16
        z_hi = z_eave + roof_h + 0.05
        z_lo = z_eave - 0.06
        slope_l = math.hypot(2.0 * hv_o, z_hi - z_lo) / T
        u_len = (2.0 * hu_o) / T
        uo = hash01(f"sk{cx:.1f}{cy:.1f}") * 5.0
        p0, p1 = wpt(-hu_o, -hv_o, z_hi + thick), wpt(hu_o, -hv_o, z_hi + thick)
        p2, p3 = wpt(hu_o, hv_o, z_lo + thick), wpt(-hu_o, hv_o, z_lo + thick)
        # eaves (low side) at V = 0
        self.q(r_real, p3, p2, p1, p0, ((uo, 0), (uo + u_len, 0), (uo + u_len, slope_l), (uo, slope_l)), r_col, facing=(0, 0, 1))
        b0, b1 = wpt(-hu_o, -hv_o, z_hi), wpt(hu_o, -hv_o, z_hi)
        b2, b3 = wpt(hu_o, hv_o, z_lo), wpt(-hu_o, hv_o, z_lo)
        self.q(f_real, b0, b1, b2, b3, ((0, 0), (2, 0), (2, 2), (0, 2)), mul3(f_col, 0.85), facing=(0, 0, -1))
        for (q0, q1, r1, r0, fc) in ((b0, b1, p1, p0, (-vx, -vy, 0)), (b1, b2, p2, p1, (ux, uy, 0)), (b2, b3, p3, p2, (vx, vy, 0)), (b3, b0, p0, p3, (-ux, -uy, 0))):
            ln = math.dist(q0, q1)
            self.q(f_real, q0, q1, r1, r0, ((0, 0), (0, ln * 2.0), (0.4, ln * 2.0), (0.4, 0)), f_col, facing=fc)
        if obb["len_u"] >= 3.0:
            self.gutter(wpt(0.0, hv_o + 0.06, z_lo + 0.04), u_vec, v_vec, 2.0 * hu_o - 0.04)

    def add_flat_parapet_roof(self, pts: List[Tuple[float, float]], z_eave: float, wall_mat: str, roof_mat: str):
        """Flat roof with raised parapet (Attika), metal coping and gravel / membrane deck."""
        w_real, w_col = self.look(wall_mat)
        r_real, r_col, T = self._roof_look(roof_mat)
        wt = REAL_TILE.get(w_real) or 2.0
        n = len(pts)
        parapet_h = 0.28
        z_parapet = z_eave + parapet_h
        perim = 0.0
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            ln = math.hypot(x1 - x0, y1 - y0)
            self.q(w_real, (x0, y0, z_eave), (x1, y1, z_eave), (x1, y1, z_parapet), (x0, y0, z_parapet),
                   ((perim / wt, 0.0), ((perim + ln) / wt, 0.0), ((perim + ln) / wt, parapet_h / wt), (perim / wt, parapet_h / wt)), mul3(w_col, 0.92))
            perim += ln
        outer = offset_polygon_outward(pts, 0.07)
        inner = offset_polygon_outward(pts, -0.22)
        cop = (0.66, 0.66, 0.65) if wall_mat == "wall_bauhaus_white" else (0.20, 0.21, 0.22)
        for i in range(n):
            x0, y0 = outer[i]
            x1, y1 = outer[(i + 1) % n]
            j0, j1 = inner[i], inner[(i + 1) % n]
            self.q("paint", (x0, y0, z_parapet - 0.05), (x1, y1, z_parapet - 0.05), (x1, y1, z_parapet + 0.05), (x0, y0, z_parapet + 0.05),
                   ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), cop)
            self.q("paint", (x0, y0, z_parapet + 0.05), (x1, y1, z_parapet + 0.05), (j1[0], j1[1], z_parapet + 0.05), (j0[0], j0[1], z_parapet + 0.05),
                   ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), mul3(cop, 1.2), facing=(0, 0, 1))
        vecs = [Vector((p[0], p[1], 0.0)) for p in pts]
        tris = tessellate_polygon([vecs])
        ox, oy = pts[0]
        for t in tris:
            p0, p1, p2 = pts[t[0]], pts[t[1]], pts[t[2]]
            self.t(r_real, (p0[0], p0[1], z_parapet - 0.06), (p1[0], p1[1], z_parapet - 0.06), (p2[0], p2[1], z_parapet - 0.06),
                   (((p0[0] - ox) / T, (p0[1] - oy) / T), ((p1[0] - ox) / T, (p1[1] - oy) / T), ((p2[0] - ox) / T, (p2[1] - oy) / T)), r_col, facing=(0, 0, 1))

    def add_door_or_gate(self, pts: List[Tuple[float, float]], z_ground: float, z_eave: float, is_barn: bool, seed: int):
        """Legacy entry point (kept for external callers): doors and gates are now part of build_building()."""
        return
    # ---------------- per-building look & facade style ----------------
    def _jitter(self, key: str, amount: float = 0.06, hue: float = 0.025):
        v = 1.0 - amount * hash01("jv" + key)
        return (v * (1.0 - hue * hash01("jr" + key)), v * (1.0 - hue * hash01("jg" + key)), v * (1.0 - hue * hash01("jb" + key)))

    def _make_look(self, bid: str, h: int, wall_mat: str, gable_wall_mat: Optional[str], dormer_mat: Optional[str], roof_mat: str,
                   plinth_mat: str, is_barn: bool, is_utility: bool, cx: float, cy: float, roof_tone: str,
                   roof_hex: Optional[str] = None, plinth_free: bool = False) -> Dict:
        ent = SEM.get(wall_mat, {})
        site = self.site
        near_main = bool(site and site.near_role(cx, cy, "main", 34.0))
        r_era = hash01("era" + bid)
        modern_walls = ("wall_white_clean", "wall_cool_gray_light", "wall_cool_gray", "wall_bauhaus_white", "wall_modern_raffstore")
        if ent.get("era"):
            era = ent["era"]
        elif is_barn or is_utility:
            era = "old" if (is_barn and r_era < 0.7) else "mid"
        elif roof_mat == "roof_slate" and wall_mat in modern_walls:
            era = "modern" if r_era < 0.72 else "mid"
        elif near_main:
            era = "old" if r_era < 0.72 else "mid"
        elif roof_mat in ("roof_terracotta", "roof_darkred", "roof_darkbrown") and wall_mat not in modern_walls:
            era = "old" if r_era < 0.30 else ("mid" if r_era < 0.88 else "modern")
        else:
            era = "mid" if r_era < 0.55 else ("modern" if r_era < 0.85 else "old")

        looks: Dict[str, Tuple[str, Tuple[float, float, float]]] = {}

        def wall_look(key: str, salt: str):
            e = SEM.get(key)
            if e is None:
                raise KeyError(f"Unknown wall material '{key}' on building {bid}")
            jit = self._jitter(bid + salt, 0.07, 0.03)
            if e.get("plaster"):
                rv = hash01("pv" + bid)
                if e.get("smooth") or (era == "modern" and rv < 0.80) or (era == "mid" and rv < 0.35):
                    real = "plaster_smooth"
                else:
                    real = "plaster_rough"
                tint = tint_for(real, e["rgb"])
                if real == "plaster_weathered":
                    tint = (min(1.0, tint[0] * 1.0), min(1.0, tint[1] * 1.0), min(1.0, tint[2] * 1.0))
                return real, clamp01_3(mul3(tint, jit))
            real, tint, _ = sem_look(key)
            return real, clamp01_3(mul3(tint, jit))

        looks[wall_mat] = wall_look(wall_mat, "w")
        for extra in (gable_wall_mat, dormer_mat):
            if extra and extra not in looks:
                looks[extra] = wall_look(extra, "g")

        # roofs: scan + tone follow the AERIAL-sampled roof colour of this very building (scene roofColorHex):
        # brightness relative to its tone class, a share of its hue, and how saturated (= how new) the tiles are.
        rr = hash01("rv" + bid)
        rj = self._jitter(bid + "roof", 0.10, 0.04)
        f_lum, sat, hue_n = 1.0, 0.22, (1.0, 1.0, 1.0)
        if roof_hex and len(roof_hex) == 7:
            a_lin = lin_rgb((int(roof_hex[1:3], 16), int(roof_hex[3:5], 16), int(roof_hex[5:7], 16)))
            lum = 0.2126 * a_lin[0] + 0.7152 * a_lin[1] + 0.0722 * a_lin[2]
            ref = ROOF_CLASS_LUM.get(roof_tone)
            if ref:
                f_lum = max(0.66, min(1.10, (lum / ref) ** 0.75))
            mx_a = max(a_lin)
            sat = (mx_a - min(a_lin)) / max(mx_a, 1e-4)
            hue_n = tuple(0.45 + 0.55 * (c / max(mx_a, 1e-4)) for c in a_lin)

        def roof_tint(base):
            t = mul3(mul3(mul3(base, hue_n), f_lum), rj)
            mx = max(t)
            return tuple(c / mx for c in t) if mx > 1.0 else t

        if roof_mat == "roof_terracotta":
            # the clay-red scan is far more saturated than any roof in the orthophoto (beige-brown to dull red):
            # it is used for a minority of roofs only and always toned down (red channel cut hardest)
            if sat > 0.48 and rr < 0.45:
                looks[roof_mat] = ("roof_clay_red", roof_tint((0.78, 0.90, 1.0)))           # fairly new clay tiles
            elif rr < 0.28:
                looks[roof_mat] = ("roof_clay_red", roof_tint((0.60, 0.76, 0.92)))          # aged, sooty red-brown
            elif rr < 0.82:
                looks[roof_mat] = ("roof_clay_weathered", roof_tint((0.98, 0.84, 0.72)))     # old pantiles, warm red-brown
            else:
                looks[roof_mat] = ("roof_clay_weathered", roof_tint((0.86, 0.78, 0.72)))    # old pantiles, brown with patina
        elif roof_mat == "roof_darkred":
            looks[roof_mat] = ("roof_clay_red", roof_tint((0.56, 0.62, 0.74))) if rr < 0.45 else ("roof_clay_weathered", roof_tint((0.80, 0.66, 0.60)))
        elif roof_mat == "roof_darkbrown":
            looks[roof_mat] = ("roof_clay_weathered", roof_tint((0.62, 0.54, 0.50)))
        elif roof_mat == "roof_slate":
            if era != "modern" and rr < 0.38:
                looks[roof_mat] = ("roof_dark", roof_tint((0.78, 0.78, 0.82)))              # old dark concrete tiles with lichen
            else:
                looks[roof_mat] = ("roof_slate", roof_tint((0.30, 0.31, 0.34)))
        else:
            real, tint, _ = sem_look(roof_mat)
            looks[roof_mat] = (real, clamp01_3(mul3(mul3(tint, max(0.75, min(1.0, f_lum))), rj)))
        # the default plinth of the street-level data is "rubble everywhere"; where it is not a verified
        # per-house observation choose what the references show: mostly painted render, some sandstone,
        # concrete, a few tiled, and rubble only on barns / old houses.
        if plinth_free:
            rp = hash01("plv" + bid)
            w_real, w_col = looks[wall_mat]
            if is_utility:
                plinth_mat_eff = ("plaster_rough", tint_for("plaster_rough", (150, 150, 146))) if rp < 0.7 else ("concrete", (0.9, 0.9, 0.9))
            elif is_barn:
                plinth_mat_eff = ("rubble", (0.96, 0.95, 0.93)) if rp < 0.55 else (("sandstone_red", (0.9, 0.9, 0.9)) if rp < 0.8 else ("plaster_rough", tint_for("plaster_rough", (140, 136, 128))))
            elif rp < 0.40:      # painted render: a darker / greyer tone of the wall colour
                dark = [(0.52, 0.50, 0.48), (0.60, 0.42, 0.34), (0.44, 0.45, 0.47), (0.66, 0.62, 0.54)][int(hash01("plc" + bid) * 4) % 4]
                base = w_col if w_real != "plaster_weathered" else (0.9, 0.88, 0.84)
                plinth_mat_eff = ("plaster_smooth" if rp < 0.2 else "plaster_rough", clamp01_3(mul3(base, dark)))
            elif rp < 0.60:
                plinth_mat_eff = ("sandstone_red", (0.94, 0.94, 0.94))
            elif rp < 0.74:
                plinth_mat_eff = ("plaster_rough", tint_for("plaster_rough", (158, 158, 152)))        # grey cement render
            elif rp < 0.80 and era != "modern":
                plinth_mat_eff = ("plinth_tile", WHITE)
            elif rp < 0.88:
                plinth_mat_eff = ("sandstone_yellow", (0.92, 0.90, 0.86))
            else:
                plinth_mat_eff = ("rubble", (0.98, 0.98, 0.98))
            looks[plinth_mat] = (plinth_mat_eff[0], clamp01_3(mul3(plinth_mat_eff[1], self._jitter(bid + "pl", 0.10, 0.03))))
        if plinth_mat not in looks:
            p_real, p_tint, _ = sem_look(plinth_mat)
            looks[plinth_mat] = (p_real, clamp01_3(mul3(p_tint, self._jitter(bid + "pl", 0.10, 0.03))))

        # ---- facade style ----
        r = lambda s: hash01(s + bid)      # noqa: E731
        st: Dict = {"era": era}
        hint = ent.get("win")
        if era == "old":
            st.update(ww=0.94 + 0.16 * r("ww"), wh=1.30 + 0.20 * r("wh"), sill_h=0.86 + 0.12 * r("si"), gap=1.15 + 0.55 * r("gp"), reveal=0.15)
            rs = r("sur")
            st["surround"] = "stone" if rs < 0.68 else ("fasche" if rs < 0.84 else None)
            fam = "sprossen" if r("fam") < 0.28 else ("white" if r("fam") < 0.74 else "brown")
            st["shutters"] = r("sh") < 0.34
            st["door_cell"] = (1, 1) if r("dc") < 0.5 else (2, 0)
        elif era == "mid":
            st.update(ww=1.08 + 0.28 * r("ww"), wh=1.20 + 0.16 * r("wh"), sill_h=0.88 + 0.10 * r("si"), gap=1.35 + 0.65 * r("gp"), reveal=0.12)
            rs = r("sur")
            st["surround"] = "fasche" if rs < 0.30 else ("stone" if rs < 0.44 else None)
            fam = "white" if r("fam") < 0.48 else ("white_box" if r("fam") < 0.78 else "brown")
            st["shutters"] = r("sh") < 0.12
            st["door_cell"] = (2, 0) if r("dc") < 0.62 else (3, 0)
        else:
            st.update(ww=1.20 + 0.55 * r("ww"), wh=1.26 + 0.16 * r("wh"), sill_h=0.86 + 0.10 * r("si"), gap=1.6 + 0.8 * r("gp"), reveal=0.16)
            st["surround"] = "fasche" if r("sur") < 0.10 else None
            fam = "anthracite" if r("fam") < 0.46 else "modern_white"
            st["shutters"] = False
            st["door_cell"] = (3, 0)
        if hint == "rolladen":
            fam = "white_box"
        elif hint == "sprossen":
            fam = "sprossen"
        elif hint == "raffstore":
            fam = "raffstore"
        st["family"] = fam
        st["cells"] = WIN_FAMILIES[fam]
        st["fw"] = 0.115 + 0.04 * r("fw")
        trim = STONE_TRIMS[int(r("trim") * len(STONE_TRIMS)) % len(STONE_TRIMS)]
        if st["surround"] == "stone":
            if r("trimpaint") < 0.22:      # painted stone surrounds (white / grey / brown-red oil paint)
                pc = [(226, 224, 216), (150, 150, 146), (122, 66, 52), (96, 70, 56)][int(r("tp2") * 4) % 4]
                st["trim"] = ("plaster_smooth", tint_for("plaster_smooth", pc))
            else:
                st["trim"] = (trim[0], mul3(trim[1], self._jitter(bid + "tr", 0.10, 0.03)))
        elif st["surround"] == "fasche":
            w_real, w_col = looks[wall_mat]
            light = sum(w_col) / 3.0 < 0.72
            pc = (232, 230, 224) if light else [(168, 166, 160), (150, 132, 112), (206, 204, 198)][int(r("fc") * 3) % 3]
            st["trim"] = ("plaster_smooth", tint_for("plaster_smooth", pc))
        st["sill_mat"] = ("paint", lin_rgb((150, 150, 146))) if era == "modern" else ("concrete", (0.95, 0.95, 0.95))
        st["step"] = ("sandstone_red", (0.92, 0.92, 0.92)) if (era == "old" and r("stp") < 0.6) else ("concrete", (1.0, 1.0, 1.0))
        st["shutter_cell"] = (0, 0) if r("shc") < 0.75 else (1, 0)
        st["shutter_col"] = tint_for("joinery", SHUTTER_COLOURS[int(r("shcol") * len(SHUTTER_COLOURS)) % len(SHUTTER_COLOURS)])
        dcols = DOOR_COLOURS if era != "modern" else [(60, 66, 72), (228, 226, 220), (88, 96, 104), (110, 76, 50)]
        st["door_col"] = tint_for("joinery", dcols[int(r("dcol") * len(dcols)) % len(dcols)])
        st["garage_col"] = tint_for("joinery", GARAGE_COLOURS[int(r("gcol") * len(GARAGE_COLOURS)) % len(GARAGE_COLOURS)])
        st["garage_cell"] = (0, 1) if r("gcell") < 0.8 else (2, 1)
        gate_rgb = GATE_COLOURS[int(r("gate") * len(GATE_COLOURS)) % len(GATE_COLOURS)]
        st["gate_col"] = tint_for("joinery", gate_rgb)
        st["gate_wood"] = tint_for("wood_planks", gate_rgb)
        st["belt"] = (era == "old" and st["surround"] == "stone" and r("belt") < 0.5)
        # how weathered this house is: 0 = freshly painted ... 1 = decades without a coat
        age = {"old": 0.45, "mid": 0.25, "modern": 0.05}[era] + 0.55 * r("age") ** 1.6
        if is_barn or is_utility:
            age = min(1.0, age + 0.2)
        age = min(1.0, age)
        grime = (0.86 - 0.34 * age, 0.95 - 0.16 * age)
        rz = r("zinc")
        zinc = mul3(ZINC_GREY, 0.85 + 0.3 * r("zj")) if rz < 0.80 else (mul3(COPPER_BROWN, 0.8 + 0.4 * r("zj")) if rz < 0.92 else (0.10, 0.10, 0.11))
        lit_share = 0.0 if (is_barn or is_utility) else (0.30 + 0.25 * r("lit"))
        sky = 0
        if not is_barn and not is_utility and era != "old" and r("sky") < 0.34:
            sky = 1 + int(r("sky2") * 2.0)
        return dict(id=bid, looks=looks, style=st, grime=grime, age=age, zinc=zinc, lit_share=lit_share, skylights=sky,
                    fachwerk=bool(ent.get("fachwerk")), fachwerk_col=mul3((0.42, 0.32, 0.26), self._jitter(bid + "fw", 0.2, 0.05)))

    def _classify_edges(self, pts, bid: str):
        """Tier per footprint edge: 'A' street-facing / visible from a street, 'B' rear, 'party' wall on wall."""
        site = self.site
        n = len(pts)
        out = []
        perim = hash01("per" + bid) * 4.0
        for i in range(n):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % n]
            F = Facade(x0, y0, x1, y1, perim)
            perim += F.L
            info = dict(F=F, tier="A", front=True, road_d=0.0)
            if F.L < 0.9:
                info.update(tier="B", front=False)
            elif site is not None:
                hits = 0
                for frac in (0.25, 0.5, 0.75):
                    px, py, _ = F.P(F.L * frac, 0.0, 0.75)
                    if site.inside_other(px, py, bid):
                        hits += 1
                mx, my, _ = F.P(F.L * 0.5, 0.0, 0.3)
                if hits >= 2:
                    info.update(tier="party", front=False, road_d=99.0)
                else:
                    rd = site.nearest_road(mx, my)
                    tier, front, d = "B", False, 99.0
                    if rd is not None:
                        d, (qx, qy), _role = rd
                        tl = math.hypot(qx - mx, qy - my) or 1.0
                        facing = (F.nx * (qx - mx) + F.ny * (qy - my)) / tl
                        r_front = 18.0 * self.detail
                        r_side = 9.0 * self.detail
                        if d <= r_front and facing >= 0.30:
                            if not site.sight_blocked(mx, my, qx, qy, bid):
                                tier, front = "A", True
                        elif d <= r_side and facing > -0.30:
                            if not site.inside_other(*F.P(F.L * 0.5, 0.0, 2.2)[:2], bid):
                                tier = "A"
                    info.update(tier=tier, front=front, road_d=d)
            out.append(info)
        return out

    def build_building(self, bld: Dict):
        """Construct one complete Kindenheim village building directly in world space."""
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

        plinth_mat = ov.get("plinth_mat", "plinth")
        # "plinth_free": no hand-verified plinth for this house (only the blanket default of the street data)
        plinth_free = ("plinth_mat" not in ov) or (bool(ov.get("_from_street")) and plinth_mat in ("plinth_rubble", "plinth", "plinth_concrete"))
        plinth_above = float(ov.get("plinth_above", 0.24 if is_utility else 0.55))
        z_plinth_top = z_base + plinth_above
        z_eave = z_base + wall_h

        gable_wall_mat = ov.get("gable_wall_mat")
        dormer_mat = ov.get("dormer_mat")
        dormer_dir = ov.get("dormer_dir")
        solar_pv_dir = ov.get("solar_pv_dir")
        fascia_mat = ov.get("fascia_mat", "trim_wood")
        force_dormer = bool(ov.get("force_dormer", False))

        non_windowed_mats = {
            "wall_barn", "wall_utility", "wall_peach_plain", "wall_brick_barn_yellow",
            "wall_timber_vertical", "wall_limestone_brick", "wall_rubble_barn",
        }
        is_windowed = bool(ov.get("is_windowed", (not is_utility) and (not is_barn) and (wall_mat not in non_windowed_mats)))
        if (SEM.get(wall_mat) or {}).get("fachwerk") and not is_utility:
            is_windowed = True      # the old flag only existed because the Fachwerk texture had its windows painted in

        # ---- look, style & edge tiers ----
        cx_c = sum(p[0] for p in pts) / len(pts)
        cy_c = sum(p[1] for p in pts) / len(pts)
        cur = self._make_look(bid, h, wall_mat, gable_wall_mat, dormer_mat, roof_mat, plinth_mat, is_barn, is_utility, cx_c, cy_c, roof_tone,
                              roof_hex=bld.get("roofColorHex"), plinth_free=plinth_free)
        cur["windowed"] = is_windowed
        if fascia_mat == "trim_wood" and cur["style"]["era"] == "modern" and hash01("fas" + bid) < 0.6:
            cur["looks"]["trim_wood"] = ("paint", lin_rgb((226, 226, 222)) if hash01("fas2" + bid) < 0.6 else lin_rgb((70, 72, 76)))
        elif fascia_mat == "trim_wood":
            cur["looks"]["trim_wood"] = ("wood_beam", mul3((0.50, 0.37, 0.29), self._jitter(bid + "fa", 0.35, 0.08)))
        edges = self._classify_edges(pts, bid)

        def tier_at(x, y, nx, ny):
            best, best_d = "B", 1e9
            for e in edges:
                F = e["F"]
                if F.nx * nx + F.ny * ny < 0.80:
                    continue
                mx, my, _ = F.P(F.L * 0.5, 0.0)
                dd = math.hypot(mx - x, my - y)
                if dd < best_d:
                    best, best_d = e["tier"], dd
            return best

        cur["tier_at"] = tier_at
        self.cur = cur
        style = cur["style"]
        wall_real, wall_col = cur["looks"][wall_mat]
        uv_off = (hash01("uo" + bid) * 6.0, hash01("vo" + bid) * 6.0)
        site = self.site

        def ground_at(F, s):
            """Terrain height in front of the wall, for house doors (kept near the plinth; stoops bridge the rest)."""
            if site is None:
                return z_base
            px, py, _ = F.P(s, 0.0, 0.4)
            g = site.ground(px, py)
            return z_base if g is None else max(z_base - 0.9, min(z_plinth_top - 0.05, g))

        def ground_span(F, sa, sb):
            """Real terrain height under a vehicle opening: gates and garage doors reach the ground, whatever the
            building's base elevation says (on sloping streets the downhill side lies well below it)."""
            if site is None:
                return z_base
            gs = []
            for ss in (sa, 0.5 * (sa + sb), sb):
                px, py, _ = F.P(ss, 0.0, 0.5)
                g = site.ground(px, py)
                if g is not None:
                    gs.append(g)
            if not gs:
                return z_base
            return max(z_base - 1.8, min(z_plinth_top + 0.5, sum(gs) / len(gs)))

        # which kind of roof will close this shell (walls poke slightly into pitched roofs so no light leaks)
        flat_like = is_true_flat or ((roof_shape_tag == "skillion" or (is_utility and poly_area < 28.0 and h % 2 == 0 and not ov)) and rectangularity < 0.82 and not ov)
        z_wall_top = z_eave + (0.0 if flat_like else 0.07)

        # ---- which edge carries the entrance / gate / garage door ----
        usable_edges = [e for e in edges if e["tier"] != "party"]
        door_edge = None
        door_kind = None
        if is_barn:
            cands = [e for e in usable_edges if e["F"].L >= 4.4]
            door_kind = "gate"
        elif is_utility:
            if btype in ("carport", "roof", "greenhouse") or poly_area < 6.0:
                cands = []
            elif poly_area < 13.0:
                cands = [e for e in usable_edges if e["F"].L >= 1.5]
                door_kind = "shed"
            else:
                cands = [e for e in usable_edges if e["F"].L >= 2.9]
                door_kind = "garage"
        else:
            cands = [e for e in usable_edges if e["F"].L >= 2.4]
            door_kind = "door"
        if cands and wall_h >= 2.25:
            def score(e):
                sc = e["F"].L
                if e["front"]:
                    sc += 40.0
                elif e["tier"] == "A":
                    sc += 18.0
                sc -= min(e["road_d"], 40.0) * 0.4
                if door_kind == "garage":
                    sc -= e["F"].L * 0.6     # garages open on the gable end facing the drive
                return sc
            door_edge = max(cands, key=score)
        elif is_utility and wall_h >= 2.1 and poly_area >= 6.0 and btype not in ("carport", "roof", "greenhouse"):
            # garage-sized footprint without a wall long enough for a garage door: at least a plank door
            cands = [e for e in usable_edges if e["F"].L >= 1.5]
            if cands:
                door_kind = "shed"
                door_edge = max(cands, key=lambda e: e["F"].L + (30.0 if e["tier"] == "A" else 0.0) - min(e["road_d"], 40.0) * 0.4)
        if ov.get("no_gate") and door_kind in ("gate", "garage", "shed"):
            door_edge = None        # verified frontage without a vehicle opening (e.g. Kreutzenberger QOUm)
        # barns / outbuildings whose vehicle opening ended up on a hidden side (or that got none) still show the
        # street a plain plank door, so no street-facing outbuilding is a blank box
        side_door_edge = None
        if (is_barn or is_utility) and not ov.get("no_gate") and wall_h >= 2.1 and btype not in ("carport", "roof", "greenhouse") \
                and (door_edge is None or door_edge["tier"] != "A"):
            a_edges = [e for e in usable_edges if e["tier"] == "A" and e["F"].L >= 1.5 and e is not door_edge]
            if a_edges:
                side_door_edge = max(a_edges, key=lambda e: e["F"].L - min(e["road_d"], 40.0) * 0.3)
        is_hall = is_barn and poly_area > 260.0 and roof_mat in ("roof_metal", "roof_flat") and cur["style"]["era"] != "old"

        # ---- storey layout ----
        floor0 = max(z_plinth_top, z_base + 0.12)
        sur = style.get("surround")
        fw_out = style["fw"] if sur else 0.0
        n_st = max(1, int(round((z_eave - floor0) / 2.85)))
        S = max(2.55, min(3.15, (z_eave - floor0) / n_st))
        stories = []
        for k in range(n_st + 1):
            za = floor0 + k * S + style["sill_h"]
            zb = min(za + style["wh"], z_eave - 0.26 - fw_out)
            if zb - za >= 0.55:
                stories.append((za, zb))
        floors = [floor0 + k * S for k in range(1, n_st + 1)]

        gable_roof = (not is_true_flat) and roof_shape_tag not in ("skillion", "hipped", "pyramidal", "half-hipped", "flat")
        plinth_notches: Dict[int, List[Tuple[float, float, float]]] = {}
        skip_plinth = set()
        edge_open: Dict[int, List[Tuple[float, float, float, float]]] = {}     # per edge: rectangles taken by openings
        aux_win_budget = 2 if (is_utility and poly_area >= 13.0 and wall_h >= 2.3) else 0
        for ei, e in enumerate(edges):
            F = e["F"]
            tier = e["tier"]
            if F.L < 0.08:
                continue
            holes: List[Tuple[float, float, float, float]] = []
            notches: List[Tuple[float, float, float]] = []
            key = f"{bid}_e{ei}"
            if tier == "party":
                # wall on wall: one blank panel right down into the ground (keeps the shell light-tight)
                self.wall_panel(F, z_base - 2.0, z_wall_top, wall_real, mul3(wall_col, 0.95), bands=False, uv_off=uv_off)
                skip_plinth.add(ei)
                continue
            # sun-bleached / shaded sides: every facade of a house is a slightly different tone
            e_col = clamp01_3(mul3(wall_col, 1.0 - 0.07 * cur["age"] * hash01("ec" + key)))
            is_door_edge = (door_edge is e)
            blocked: List[Tuple[float, float]] = []     # s-ranges taken by doors on the ground floor

            if is_door_edge and door_kind == "gate":
                gw = min(4.2 if is_hall else 3.4, F.L - 1.3)
                gh = min(3.9 if is_hall else 3.3, wall_h - 0.75)
                if gw >= 2.4 and gh >= 2.1:
                    sc = F.L * (0.5 if F.L < 9.0 else (0.32 if h % 2 == 0 else 0.68))
                    zg = min(ground_span(F, sc - gw * 0.5, sc + gw * 0.5) + 0.02, z_eave - 0.6 - 2.1)
                    gh = max(2.1, min(gh, z_eave - zg - 0.6))
                    wn, pn = self.add_door(F, sc - gw * 0.5, sc + gw * 0.5, zg, zg + gh, style, tier, wall_real, e_col, key, kind="hall" if is_hall else "gate")
                    notches.append(wn)
                    plinth_notches.setdefault(ei, []).append(pn)
                    blocked.append((wn[0] - 0.3, wn[1] + 0.3))
            elif is_door_edge and door_kind == "garage":
                gw = 2.45
                gh = min(2.12, wall_h - 0.42)
                n_g = max(1, min(3, int((F.L - 0.5) / 2.95)))
                if F.L - 0.5 >= gw and gh >= 1.8:
                    pitch = (F.L - 0.5) / n_g
                    for gi in range(n_g):
                        sc = 0.25 + pitch * (gi + 0.5)
                        zg = min(ground_span(F, sc - gw * 0.5, sc + gw * 0.5) + 0.02, z_eave - 0.30 - 1.8)
                        gh_i = max(1.8, min(gh, z_eave - zg - 0.30))
                        wn, pn = self.add_door(F, sc - gw * 0.5, sc + gw * 0.5, zg, zg + gh_i, style, tier, wall_real, e_col, f"{key}_{gi}", kind="garage")
                        notches.append(wn)
                        plinth_notches.setdefault(ei, []).append(pn)
                        blocked.append((wn[0] - 0.2, wn[1] + 0.2))
            elif (is_door_edge and door_kind == "shed") or e is side_door_edge:
                if e is side_door_edge:
                    self.count("side_doors")
                sc = F.L * (0.35 if h % 2 == 0 else 0.6)
                dw, dh = 0.9, min(1.95, wall_h - 0.3)
                if F.L >= dw + 0.5:
                    sc = max(dw * 0.5 + 0.25, min(F.L - dw * 0.5 - 0.25, sc))
                    zg = min(ground_span(F, sc - dw * 0.5, sc + dw * 0.5) + 0.04, z_eave - 0.25 - 1.7)
                    dh = max(1.7, min(dh, z_eave - zg - 0.25))
                    wn, pn = self.add_door(F, sc - dw * 0.5, sc + dw * 0.5, zg, zg + dh, style, tier, wall_real, e_col, key, kind="shed")
                    notches.append(wn)
                    plinth_notches.setdefault(ei, []).append(pn)

            # windows
            margin = 0.55 + fw_out
            ww = style["ww"]
            use_shutters = bool(style.get("shutters")) and tier == "A"
            bays: List[float] = []
            if is_windowed and F.L - 2 * margin >= ww * 0.8 and stories:
                ww_e = min(ww, F.L - 2 * margin)
                usable = F.L - 2 * margin
                pitch_min = ww_e + style["gap"]
                n_b = max(1, int((usable + style["gap"]) // pitch_min))
                if use_shutters:
                    need = 2.0 * ww_e + 2.0 * fw_out + 0.14
                    while n_b > 1 and usable / n_b < need:
                        n_b -= 1
                    if usable / n_b < need - 0.3 or usable < need:
                        use_shutters = False
                pitch = usable / n_b
                bays = [margin + pitch * (bi + 0.5) for bi in range(n_b)]
            else:
                ww_e = ww

            door_bay = -1
            if is_door_edge and door_kind == "door":
                old_door = style["door_cell"] == (1, 1)
                dw = 1.22 if old_door else 1.02
                dh = 2.42 if old_door else 2.10
                if bays:
                    order = [0, len(bays) - 1, len(bays) // 2]
                    door_bay = order[h % 3] if len(bays) > 1 else 0
                    sc = bays[door_bay]
                else:
                    sc = F.L * 0.5
                fw_d = 0.15 if sur == "stone" else 0.0
                if F.L >= dw + 2 * fw_d + 0.5:
                    sc = max(dw * 0.5 + fw_d + 0.2, min(F.L - dw * 0.5 - fw_d - 0.2, sc))
                    zg = ground_at(F, sc)
                    z_d0 = min(z_plinth_top, max(zg + 0.17, z_base + 0.02))
                    dh = min(dh, z_eave - z_d0 - 0.45 - fw_d)
                    if dh >= 1.9:
                        wn, pn = self.add_door(F, sc - dw * 0.5, sc + dw * 0.5, z_d0, z_d0 + dh, style, tier, wall_real, e_col, key, kind="door", z_ground=zg)
                        notches.append(wn)
                        plinth_notches.setdefault(ei, []).append(pn)
                        blocked.append((wn[0] - 0.25, wn[1] + 0.25))
                    else:
                        door_bay = -1
                else:
                    door_bay = -1

            def hits_notch(sa, sb, z_lo):
                # an opening must never overlap a door / gate cut-out (also not the lintel zone above it)
                return any(n0 - 0.12 < sb and n1 + 0.12 > sa and z_lo < nz + 0.12 for (n0, n1, nz) in notches)

            if bays and ov.get("ribbon_windows") and tier == "A" and F.L >= 3.2:
                # Bauhaus Fensterband: per storey one long, low opening from margin to margin (split around doors /
                # gates), glazed as a row of white single-pane casements, flush render reveal, thin metal sill
                r_style = dict(style)
                r_style.update(surround=None, shutters=False, reveal=0.16, sill_mat=("paint", (0.74, 0.74, 0.72)))
                rm = 0.7
                for si, (za, zb) in enumerate(stories):
                    zb_r = min(zb, za + 1.25)
                    cuts = sorted([(a - 0.3, b + 0.3) for a, b in blocked] +
                                  [(n0 - 0.4, n1 + 0.4) for (n0, n1, nz) in notches if za - 0.2 < nz + 0.12])
                    spans, cur_s = [], rm
                    for a, b in cuts:
                        if a > cur_s:
                            spans.append((cur_s, min(a, F.L - rm)))
                        cur_s = max(cur_s, b)
                    if cur_s < F.L - rm:
                        spans.append((cur_s, F.L - rm))
                    for ri, (ra, rb) in enumerate(spans):
                        if rb - ra < 1.4:
                            continue
                        n_u = max(1, int(round((rb - ra) / 1.05)))
                        holes.append(self.add_window(F, ra, rb, za, zb_r, r_style, tier, wall_real, e_col, f"{key}_{si}_r{ri}",
                                                     cell=(3, 2), allow_shutters=False, units=n_u))
                        self.count("ribbon_windows")
            elif bays:
                for si, (za, zb) in enumerate(stories):
                    for bi, sc in enumerate(bays):
                        wkey = f"{key}_{si}_{bi}"
                        if si == 0 and (bi == door_bay or any(a < sc + ww_e * 0.5 + fw_out and b > sc - ww_e * 0.5 - fw_out for a, b in blocked)):
                            continue
                        if hits_notch(sc - ww_e * 0.5 - fw_out, sc + ww_e * 0.5 + fw_out, za - 0.2):
                            continue
                        rskip = hash01("skip" + wkey)
                        if (tier == "B" and rskip < 0.16) or (tier == "A" and rskip < 0.035):
                            continue
                        w_here, za_h, zb_h, cell = ww_e, za, zb, None
                        if hash01("bath" + wkey) < 0.07 and (zb - za) > 0.9:
                            w_here, za_h, cell = min(ww_e, 0.62), zb - 0.72, WIN_BATH
                        holes.append(self.add_window(F, sc - w_here * 0.5, sc + w_here * 0.5, za_h, zb_h, style, tier, wall_real, e_col, wkey,
                                                     cell=cell, allow_shutters=use_shutters and cell is None))
            elif is_barn and tier == "A" and F.L >= 4.0 and wall_h >= 3.4 and not is_windowed:
                # small stable / loft openings high up in barn walls
                n_w = max(1, int(F.L / 4.6))
                zc = z_base + min(wall_h * 0.66, wall_h - 0.9)
                for bi in range(n_w):
                    sc = F.L * (bi + 0.5) / n_w
                    if hits_notch(sc - 0.6, sc + 0.6, zc - 0.5):
                        continue
                    if hash01(f"bw{key}{bi}") < 0.25:
                        continue
                    b_style = dict(style)
                    b_style.update(surround="stone" if style.get("surround") == "stone" else None, shutters=False, reveal=0.16)
                    holes.append(self.add_window(F, sc - 0.38, sc + 0.38, zc - 0.32, zc + 0.32, b_style, "A", wall_real, e_col, f"{key}_b{bi}", cell=WIN_BARN, allow_shutters=False))

            elif (not is_windowed and not is_door_edge and F.L >= 2.6
                  and ((tier == "A" and (is_utility or is_barn)) or (aux_win_budget > 0 and hash01("aw" + key) < 0.75))):
                # garages / sheds / annexes: a plain small window on a side wall; a street-facing (tier A) wall of an
                # outbuilding always gets one, so no outbuilding shows the street a blank box
                aux_win_budget -= 1
                sc = F.L * (0.35 + 0.3 * hash01("aws" + key))
                wwa, wha = (0.9, 0.62) if hash01("awk" + key) < 0.6 else (0.6, 0.9)
                za_w = min(z_base + 1.35, z_eave - wha - 0.35)
                if site is not None:
                    # clear of a plinth course that steps up with the terrain (see add_plinth_skirt)
                    g_w = max(site.ground(*F.P(s_w, 0.0, 0.3)[:2]) for s_w in (sc - wwa * 0.5, sc + wwa * 0.5))
                    za_w = max(za_w, g_w + 0.75)
                if hits_notch(sc - wwa * 0.5 - 0.1, sc + wwa * 0.5 + 0.1, za_w):
                    # a side door already sits there: use the free end of the wall, or leave the window out
                    sc = F.L - sc
                if (za_w > z_plinth_top + 0.3 and za_w + wha < z_eave - 0.25
                        and not hits_notch(sc - wwa * 0.5 - 0.1, sc + wwa * 0.5 + 0.1, za_w)):
                    a_style = dict(style)
                    a_style.update(surround=None, shutters=False, reveal=0.10)
                    holes.append(self.add_window(F, sc - wwa * 0.5, sc + wwa * 0.5, za_w, za_w + wha, a_style, tier, wall_real, e_col, f"{key}_aux",
                                                 cell=(WIN_ATTIC if wwa > wha else WIN_BATH), allow_shutters=False))

            has_open = bool(holes or notches)
            edge_open[ei] = list(holes) + [(n0, n1, z_base - 2.0, nz) for (n0, n1, nz) in notches]
            is_gable_edge = gable_roof and abs(F.ex * obb["u_axis"][0] + F.ey * obb["u_axis"][1]) < 0.5
            ok = self.wall_panel(F, z_plinth_top, z_wall_top, wall_real, e_col, holes=holes, notches=notches,
                                 grime=cur["grime"], uv_off=uv_off, bands=(tier == "A" or has_open), top_band=not is_gable_edge)
            if not ok:
                self.wall_panel(F, z_plinth_top, z_wall_top, wall_real, e_col, grime=cur["grime"], uv_off=uv_off, bands=False)
            if tier == "A" and F.L >= 1.8 and wall_real in ("plaster_smooth", "plaster_rough"):
                self._weathering_decals(F, z_plinth_top, z_eave, holes, notches, e_col, cur["age"], key, eaves=not is_gable_edge)
            # string course between the storeys of old stone-trimmed houses
            if tier == "A" and style.get("belt") and len(floors) >= 1 and not is_barn and is_windowed and F.L > 2.5:
                zb_ = floors[0] - 0.02
                t_real, t_col = style["trim"]
                if zb_ + 0.2 < z_eave - 0.6 and not any(hh[2] < zb_ + 0.16 and hh[3] > zb_ - 0.02 for hh in holes) and not any(nn[2] > zb_ - 0.02 for nn in notches):
                    k = 1.0 / (REAL_TILE.get(t_real) or 2.0)
                    self.q(t_real, F.P(0.0, zb_, 0.035), F.P(F.L, zb_, 0.035), F.P(F.L, zb_ + 0.14, 0.035), F.P(0.0, zb_ + 0.14, 0.035),
                           ((0, 0), (F.L * k, 0), (F.L * k, 0.14 * k), (0, 0.14 * k)), t_col, facing=F.n3)
                    self.q(t_real, F.P(0.0, zb_ + 0.14, 0.0), F.P(F.L, zb_ + 0.14, 0.0), F.P(F.L, zb_ + 0.14, 0.035), F.P(0.0, zb_ + 0.14, 0.035),
                           ((0, 0), (F.L * k, 0), (F.L * k, 0.02), (0, 0.02)), t_col, facing=(0, 0, 1))
                    self.q(t_real, F.P(0.0, zb_, 0.0), F.P(F.L, zb_, 0.0), F.P(F.L, zb_, 0.035), F.P(0.0, zb_, 0.035),
                           ((0, 0), (F.L * k, 0), (F.L * k, 0.02), (0, 0.02)), mul3(t_col, 0.7), facing=(0, 0, -1))
            if cur["fachwerk"]:
                self.add_fachwerk(F, z_plinth_top, z_eave, holes, floors, key, cur["fachwerk_col"])

        # 1. 2.0m Underground + Above-Ground Plinth Skirt (ZERO floating houses!)
        # the buried skirt reaches below the lowest terrain point of the footprint (on graded streets the
        # ground in front of a downhill wall can lie more than 2 m below the LoD2 base elevation)
        z_skirt = z_base - 2.0
        if site is not None:
            g_fp = [site.ground(px_, py_) for (px_, py_) in offset_polygon_outward(pts, 0.3)]
            if any(gv is None for gv in g_fp):
                raise RuntimeError(f"building {bid}: footprint lies outside the terrain heightmap")
            z_skirt = min(z_skirt, min(g_fp) - 0.6)
        self.add_plinth_skirt(pts, z_skirt, z_plinth_top, plinth_mat=plinth_mat, notches=plinth_notches, skip_edges=skip_plinth)

        # 2b. Optional Climbing Ivy Blankets & Balconies on exact corridor buildings!
        ivy_dir = ov.get("ivy_dir")
        if ivy_dir is not None:
            il = math.hypot(ivy_dir[0], ivy_dir[1]) or 1.0
            for ei, e in enumerate(edges):
                F = e["F"]
                if e["tier"] == "party" or F.L < 2.2 or (F.nx * ivy_dir[0] + F.ny * ivy_dir[1]) / il < 0.45:
                    continue
                self.add_ivy_cards(F, z_plinth_top - 0.1, z_eave - 0.12, None, edge_open.get(ei, []), f"{bid}_ivy{ei}")
        balcony_dir = ov.get("balcony_dir")
        if balcony_dir is not None:
            self.add_dark_balconies(pts, z_base, z_eave, balcony_dir, balcony_mat=ov.get("balcony_mat", "trim_wood"), balcony_w=ov.get("balcony_w"))

        # 4. Exact LoD2-Matched Roof Geometry (Flat Parapet / Skillion / Multi-Wing Gabled / Hipped)
        residential = (not is_barn) and (not is_utility)
        want_chimney = residential and poly_area >= 40.0 and hash01("chim" + bid) < (0.9 if style["era"] != "modern" else 0.55)
        gabled_main = False
        if is_true_flat:
            flat_mat = "roof_flat" if (roof_mat not in ("roof_metal",)) else "roof_metal"
            self.add_flat_parapet_roof(pts, z_eave, wall_mat, flat_mat)
            if ov.get("bauhaus_penthouse"):
                cx_p, cy_p = obb["center"]
                ux_p, uy_p = obb["u_axis"]
                vx_p, vy_p = obb["v_axis"]
                ph_w = obb["len_u"] * 0.44
                ph_d = obb["len_v"] * 0.48
                ph_h = 2.05
                pc = Vector((cx_p + 1.2, cy_p - 1.2, z_eave + 0.25 + ph_h * 0.5))
                self.add_box(pc, Vector((ux_p, uy_p, 0.0)), Vector((vx_p, vy_p, 0.0)), sx=ph_w, sy=ph_d, sz=ph_h, mat_key="wall_bauhaus_white", uv_scale=6.0)
                # thin light metal coping (not a brown timber band)
                self.box("paint", pc + Vector((0, 0, ph_h * 0.5 + 0.03)), Vector((ux_p, uy_p, 0.0)), Vector((vx_p, vy_p, 0.0)), ph_w + 0.08, ph_d + 0.08, 0.06,
                         (0.66, 0.66, 0.65), default_tile=2.0)
        elif roof_shape_tag == "skillion" or (is_utility and poly_area < 28.0 and h % 2 == 0 and not ov):
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
                        overhang_eave=0.32, overhang_gable=0.24, slab_thick=0.20,
                        add_gable_walls=True,
                        add_chimney=(w_idx == 0 and want_chimney),
                        add_dormer=(w_idx == 0 and (force_dormer or (residential and (h % 4 == 0) and not solar_pv_dir))),
                        seed=h + w_idx * 17,
                        gable_wall_mat=gable_wall_mat,
                        dormer_mat=dormer_mat,
                        solar_pv_dir=(solar_pv_dir if w_idx == 0 else None),
                        ivy_dir=(ivy_dir if w_idx == 0 else None),
                        dormer_dir=(dormer_dir if w_idx == 0 else None),
                        fascia_mat=fascia_mat,
                        no_attic_window=bool(ov.get("no_attic_window", False)),
                        main_roof=True,
                    )
            else:
                self.add_polygon_hipped_roof(pts, z_eave, roof_h, roof_mat)
        else:
            use_hipped = roof_shape_tag in ("hipped", "pyramidal", "half-hipped")
            if use_hipped:
                self.add_hipped_roof_obb(
                    obb, z_eave, roof_h, roof_mat,
                    overhang=0.36, slab_thick=0.18,
                    add_chimney=(not is_barn and poly_area >= 48.0),
                    seed=h, fascia_mat=fascia_mat,
                )
            else:
                gabled_main = True
                self.add_gabled_roof_wing(
                    obb["center"], obb["u_axis"], obb["v_axis"],
                    obb["len_u"], obb["len_v"], z_eave, roof_h,
                    wall_mat, roof_mat,
                    overhang_eave=0.36 if not is_utility else 0.24, overhang_gable=0.28 if not is_utility else 0.18,
                    slab_thick=0.22 if not is_utility else 0.16,
                    add_gable_walls=True,
                    add_chimney=want_chimney,
                    add_dormer=(force_dormer or (residential and wall_h >= 4.4 and (h % 5 == 0) and not solar_pv_dir)),
                    seed=h,
                    gable_wall_mat=gable_wall_mat,
                    dormer_mat=dormer_mat,
                    solar_pv_dir=solar_pv_dir,
                    ivy_dir=ivy_dir,
                    dormer_dir=dormer_dir,
                    fascia_mat=fascia_mat,
                    no_attic_window=bool(ov.get("no_attic_window", False)),
                    main_roof=True,
                )

        # 5. zinc downpipes on street-facing eaves walls (gutter outlet -> swan neck -> wall -> ground)
        if gabled_main and not is_sliver and obb["len_u"] >= 5.0:
            ux, uy = obb["u_axis"]
            ov_e = 0.36 if not is_utility else 0.24
            for ei, e in enumerate(edges):
                F = e["F"]
                if e["tier"] != "A" or F.L < 3.5 or abs(F.ex * ux + F.ey * uy) < 0.85:
                    continue
                if not e["front"] and hash01(f"dp{bid}{ei}") < 0.5:
                    continue
                s_pipe = 0.22 if (h + ei) % 2 == 0 else F.L - 0.22
                zt = z_eave - ov_e * (roof_h / max(obb["len_v"] * 0.5, 0.4)) - 0.02
                p_g = F.P(s_pipe, zt, ov_e + 0.06)
                p_w = F.P(s_pipe, zt - 0.42, 0.075)
                zg = min(ground_at(F, s_pipe), z_plinth_top) - 0.5
                with self.detail_scope():
                    self.tube("zinc", p_g, p_w, 0.045, cur["zinc"])
                    self.tube("zinc", p_w, F.P(s_pipe, zg, 0.075), 0.045, cur["zinc"])
                self.count("downpipes")

        self.cur = None
        return True

    def _mesh_from(self, name: str, face_ids, collection):
        import numpy as np
        co, faces, fmat, uvs, cols = [], [], [], [], []
        used: Dict[int, int] = {}
        for fi in face_ids:
            f = self.faces[fi]
            base = len(co)
            n = len(f)
            co.extend(self.co[f[0]:f[0] + n])
            uvs.extend(self.uvs[f[0]:f[0] + n])
            cols.extend(self.cols[f[0]:f[0] + n])
            faces.append(tuple(range(base, base + n)))
            m = self.fmat[fi]
            if m not in used:
                used[m] = len(used)
            fmat.append(used[m])
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(co, [], faces)
        n_loops = len(mesh.loops)
        if n_loops != len(uvs) or n_loops != len(cols):
            raise RuntimeError(f"{name}: loop count mismatch ({n_loops} loops, {len(uvs)} uvs, {len(cols)} colours)")
        mesh.polygons.foreach_set("material_index", np.asarray(fmat, dtype=np.int32))
        uv_layer = mesh.uv_layers.new(name="UVMap")
        uv_layer.data.foreach_set("uv", np.asarray(uvs, dtype=np.float32).ravel())
        ca = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
        rgba = np.ones((n_loops, 4), dtype=np.float32)
        rgba[:, :3] = np.clip(np.asarray(cols, dtype=np.float32), 0.0, 1.0)
        ca.data.foreach_set("color", rgba.ravel())
        mesh.color_attributes.active_color = ca
        mesh.color_attributes.render_color_index = 0
        for m_idx in sorted(used, key=lambda k: used[k]):
            mesh.materials.append(self.mat_lib[self.mat_order[m_idx]])
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        return obj

    def finalize_object(self, collection) -> Optional[bpy.types.Object]:
        """Returns the base mesh object; self.detail_obj holds the '<name>_detail' object (or None)."""
        if not self.faces:
            return None
        # every face owns its vertices contiguously (see _emit), which _mesh_from relies on
        base_ids = [i for i, d in enumerate(self.fdet) if not d]
        det_ids = [i for i, d in enumerate(self.fdet) if d]
        obj = self._mesh_from(self.name, base_ids, collection) if base_ids else None
        self.detail_obj = self._mesh_from(self.name + "_detail", det_ids, collection) if det_ids else None
        self.co, self.faces, self.fmat, self.uvs, self.cols, self.fdet = [], [], [], [], [], []
        return obj


# ---------------------------------------------------------------------------
# Export, Modular Archetype .blend Saving & Sunlit Preview Renderer
# ---------------------------------------------------------------------------

CWEBP = shutil.which("cwebp") or "/opt/homebrew/bin/cwebp"
_WEB_TEX_CACHE: Dict[str, str] = {}


def prepare_web_texture(img: bpy.types.Image) -> str:
    """Publish one texture ONCE to public/assets/models/village/tex/ and return its file name.

    All four chunk GLBs reference the same external files (instead of embedding ~15 MB of identical
    textures four times). Albedo / ORM / emissive -> WebP; photo-scanned normal maps are copied verbatim
    (lossy WebP chroma subsampling would smear them); alpha-cut PNGs are copied verbatim too.
    """
    name = img.name
    if name in _WEB_TEX_CACHE:
        return _WEB_TEX_CACHE[name]
    src = bpy.path.abspath(img.filepath)
    if not os.path.exists(src):
        raise RuntimeError(f"Image '{name}' has no source file on disk: {src}")
    os.makedirs(WEB_TEX_DIR, exist_ok=True)
    ext = os.path.splitext(src)[1].lower()
    own_atlas = name.startswith("village_")
    is_normal = name.endswith("_normal") or "_normal_" in name
    if not own_atlas:
        # Shared-library scans and the small legacy alpha textures ship as the UNCHANGED source file, so one
        # image name means the same bytes in every GLB of the project (texture de-duplication contract).
        dst_name = name + ext
        mode = "copy"
    elif is_normal or name.endswith("_orm"):
        dst_name = name + ".webp"
        mode = "lossless"
    else:
        dst_name = name + ".webp"
        mode = "q92"
    dst = os.path.join(WEB_TEX_DIR, dst_name)
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
        tmp = dst + ".tmp"
        if mode == "copy":
            shutil.copyfile(src, tmp)
        else:
            if not os.path.exists(CWEBP):
                raise RuntimeError("cwebp not found (needed to publish the village textures as WebP)")
            args = [CWEBP, "-quiet", "-mt"]
            args += ["-lossless", "-z", "8"] if mode == "lossless" else ["-q", mode[1:], "-m", "6", "-sharp_yuv", "-alpha_q", "95"]
            subprocess.run(args + [src, "-o", tmp], check=True)
        os.replace(tmp, dst)
    _WEB_TEX_CACHE[name] = dst_name
    return dst_name


def export_objects_glb(objs: List[bpy.types.Object], glb_path: str):
    """Draco-compressed GLB whose textures are external files shared by all village chunks."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    tmp_dir = tempfile.mkdtemp(prefix="kindenheim_village_export_")
    try:
        stem = os.path.splitext(os.path.basename(glb_path))[0]
        gltf_path = os.path.join(tmp_dir, stem + ".gltf")
        kwargs = dict(
            filepath=gltf_path,
            export_format="GLTF_SEPARATE",
            use_selection=True,
            export_yup=True,
            export_materials="EXPORT",
            export_image_format="AUTO",
            export_texcoords=True,
            export_normals=True,
            export_vertex_color="MATERIAL",
            export_all_vertex_colors=False,
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_draco_position_quantization=20,
            export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=16,
            export_draco_color_quantization=8,
        )
        props = bpy.ops.export_scene.gltf.get_rna_type().properties
        if "export_keep_originals" in props:
            kwargs["export_keep_originals"] = True
        bpy.ops.export_scene.gltf(**kwargs)

        with open(gltf_path, "r", encoding="utf-8") as f:
            gltf = json.load(f)
        if len(gltf.get("buffers", [])) != 1:
            raise RuntimeError(f"Expected exactly one buffer in {gltf_path}, got {len(gltf.get('buffers', []))}")
        with open(os.path.join(tmp_dir, gltf["buffers"][0]["uri"]), "rb") as f:
            bin_data = f.read()
        gltf["buffers"][0] = {"byteLength": len(bin_data)}

        rel = os.path.relpath(WEB_TEX_DIR, os.path.dirname(os.path.abspath(glb_path))).replace(os.sep, "/")
        webp_images = set()
        for idx, im in enumerate(gltf.get("images", [])):
            if "bufferView" in im:
                raise RuntimeError("GLTF_SEPARATE export unexpectedly embedded an image")
            name = im.get("name") or os.path.splitext(os.path.basename(im.get("uri", "")))[0]
            bimg = bpy.data.images.get(name)
            if bimg is None:
                raise RuntimeError(f"Exported image '{name}' not found among the Blender images (name contract broken)")
            fname = prepare_web_texture(bimg)
            gltf["images"][idx] = {"name": name, "uri": f"{rel}/{fname}"}
            if fname.endswith(".webp"):
                webp_images.add(idx)
        if webp_images:
            for tex in gltf.get("textures", []):
                if tex.get("source") in webp_images:
                    tex.setdefault("extensions", {})["EXT_texture_webp"] = {"source": tex.pop("source")}
            for k in ("extensionsUsed", "extensionsRequired"):
                lst = gltf.setdefault(k, [])
                if "EXT_texture_webp" not in lst:
                    lst.append("EXT_texture_webp")
        ao_by_name = {sp["name"]: sp["ao_strength"] for sp in REAL_SPECS.values() if "ao_strength" in sp}
        for mat in gltf.get("materials", []):
            mat.pop("extras", None)
            if mat.get("name") in ao_by_name and "occlusionTexture" in mat:
                mat["occlusionTexture"]["strength"] = ao_by_name[mat["name"]]

        js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        js += b" " * ((4 - len(js) % 4) % 4)
        bin_data += b"\x00" * ((4 - len(bin_data) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(bin_data)
        tmp_glb = glb_path + ".tmp"
        with open(tmp_glb, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack("<II", len(bin_data), 0x004E4942))
            f.write(bin_data)
        os.replace(tmp_glb, glb_path)   # atomic: the running app never sees a half-written chunk
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def mesh_triangle_count(obj) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


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
    stats = dict(builder.stats)
    warnings = list(builder.warnings)
    obj = builder.finalize_object(col)
    print(f"Demo village built: {mesh_triangle_count(obj)} triangles, {len(obj.data.materials)} materials, details: {stats}")
    for w in warnings:
        print("[WARN]", w)
    demo_dir = os.path.join(OUT_GLB_DIR, "_wip")
    os.makedirs(demo_dir, exist_ok=True)
    export_objects_glb([o for o in (obj, builder.detail_obj) if o is not None], os.path.join(demo_dir, "demo_village.glb"))
    print("Demo GLB ->", os.path.join(demo_dir, "demo_village.glb"))

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
        if gate_mat == "barn_gate":
            # timber courtyard gate: two real boarded leaves, built from both sides, standing on the real ground
            zg = z_ground
            if b.site is not None:
                g_here = b.site.ground(mid.x, mid.y)
                if g_here is not None:
                    zg = min(z_ground, g_here)
            gk = f"cg{mid.x:.1f}_{mid.y:.1f}"
            g_rgb = GATE_COLOURS[int(hash01(gk) * len(GATE_COLOURS)) % len(GATE_COLOURS)]
            wood_c, frame_c = tint_for("wood_planks", g_rgb), tint_for("joinery", g_rgb)
            a_pt = mid - u_vec * (gw * 0.5)
            b_pt = mid + u_vec * (gw * 0.5)
            for (pa, pb, tag) in ((a_pt, b_pt, "f"), (b_pt, a_pt, "b")):
                Fg = Facade(pa.x, pa.y, pb.x, pb.y)
                b.gate_leaf(Fg, 0.0, gw * 0.5 - 0.008, zg + 0.03, z_ground + gate_h, -0.02, wood_c, frame_c, gk + tag + "L", hinge_at_a=True)
                b.gate_leaf(Fg, gw * 0.5 + 0.008, gw, zg + 0.03, z_ground + gate_h, -0.02, wood_c, frame_c, gk + tag + "R", hinge_at_a=False)
            b.count("gates")
        else:
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
    # Crisp white Bauhaus lintel bridge uniting QOUm (wh=4.8m) and QOUr, thin light metal coping on top
    b_kr.add_box(g_mid + Vector((0, 0, z_kr + 4.18)), gu, gv, sx=g_span + 0.9, sy=0.74, sz=1.28, mat_key="wall_bauhaus_white", uv_scale=8.0)
    b_kr.box("paint", g_mid + Vector((0, 0, z_kr + 4.845)), gu, gv, g_span + 0.96, 0.80, 0.05, (0.66, 0.66, 0.65), default_tile=2.0)
    # Full-width, recessed steel-grey slat gate: as in Street View it hangs in the upper part of the opening
    # (open passage below, the yard visible through it) - one panel over the whole span, no half leaf
    b_kr.add_box(g_mid - gv * 0.24 + Vector((0, 0, z_kr + 2.92)), gu, gv, sx=g_span - 0.04, sy=0.08, sz=1.24, mat_key="gate_bauhaus_slat", uv_scale=2.2)
    b_kr.box("paint", g_mid - gv * 0.24 + Vector((0, 0, z_kr + 2.28)), gu, gv, g_span - 0.04, 0.12, 0.06, (0.30, 0.31, 0.32), default_tile=2.0)
    b_kr.count("kreutzenberger_gate")

    # Gravel beds with a low concrete kerb along the street front (the cypresses in them are placed by the
    # vegetation system), the black Weingut sign and a white info board - see sv_weingut_kreutzenberger.png
    def kr_ground(x, y):
        g = b_kr.site.ground(x, y) if b_kr.site is not None else None
        if g is None:
            raise RuntimeError(f"Kreutzenberger frontage: no terrain height at Blender ({x:.1f}, {y:.1f})")
        return g

    def kr_bed(Fb, sa, sb, d0, d1):
        """Gravel bed in front of facade Fb (normal = street side) between s=sa..sb and d=d0..d1."""
        mx, my, _ = Fb.P(0.5 * (sa + sb), 0.0, 0.5 * (d0 + d1))
        zg = kr_ground(mx, my)
        zt = zg + 0.10
        k = 1.0 / (REAL_TILE.get("gravel") or 2.0)
        b_kr.q("gravel", Fb.P(sa, zt, d0), Fb.P(sb, zt, d0), Fb.P(sb, zt, d1), Fb.P(sa, zt, d1),
               ((sa * k, d0 * k), (sb * k, d0 * k), (sb * k, d1 * k), (sa * k, d1 * k)), (0.92, 0.91, 0.88), facing=(0, 0, 1))
        cw, ch = 0.10, 0.16
        kc = 1.0 / (REAL_TILE.get("concrete") or 2.0)
        cc = (0.80, 0.80, 0.78)
        # kerb on the street side and both ends: top + outer faces
        for (a0, a1, b0, b1, fc) in ((sa - cw, sb + cw, d1, d1 + cw, Fb.n3), (sa - cw, sa, d0, d1, (-Fb.ex, -Fb.ey, 0.0)), (sb, sb + cw, d0, d1, Fb.e3)):
            b_kr.q("concrete", Fb.P(a0, zg + ch, b0), Fb.P(a1, zg + ch, b0), Fb.P(a1, zg + ch, b1), Fb.P(a0, zg + ch, b1),
                   ((a0 * kc, b0 * kc), (a1 * kc, b0 * kc), (a1 * kc, b1 * kc), (a0 * kc, b1 * kc)), cc, facing=(0, 0, 1))
        b_kr.q("concrete", Fb.P(sa - cw, zg - 0.1, d1 + cw), Fb.P(sb + cw, zg - 0.1, d1 + cw), Fb.P(sb + cw, zg + ch, d1 + cw), Fb.P(sa - cw, zg + ch, d1 + cw),
               ((0, 0), ((sb - sa) * kc, 0), ((sb - sa) * kc, 0.26 * kc), (0, 0.26 * kc)), mul3(cc, 0.9), facing=Fb.n3)
        b_kr.q("concrete", Fb.P(sa - cw, zg - 0.1, d0), Fb.P(sa - cw, zg - 0.1, d1 + cw), Fb.P(sa - cw, zg + ch, d1 + cw), Fb.P(sa - cw, zg + ch, d0),
               ((0, 0), ((d1 - d0) * kc, 0), ((d1 - d0) * kc, 0.26 * kc), (0, 0.26 * kc)), mul3(cc, 0.85), facing=(-Fb.ex, -Fb.ey, 0.0))
        b_kr.q("concrete", Fb.P(sb + cw, zg - 0.1, d1 + cw), Fb.P(sb + cw, zg - 0.1, d0), Fb.P(sb + cw, zg + ch, d0), Fb.P(sb + cw, zg + ch, d1 + cw),
               ((0, 0), ((d1 - d0) * kc, 0), ((d1 - d0) * kc, 0.26 * kc), (0, 0.26 * kc)), mul3(cc, 0.85), facing=Fb.e3)
        b_kr.count("kreutzenberger_beds")

    def kr_panel(Fb, s_c, d, z0, z1, w, uv_u, back_col, post_col=(0.16, 0.16, 0.17)):
        """Free-standing sign panel (front = Fb normal) on two square posts; uv_u = (u0, u1) of village_signs.png."""
        x, y, _ = Fb.P(s_c, 0.0, d)
        zg = kr_ground(x, y)
        za, zb = zg + z0, zg + z1
        sa, sb = s_c - 0.5 * w, s_c + 0.5 * w
        t = 0.04
        b_kr.q("signs", Fb.P(sa, za, d + t), Fb.P(sb, za, d + t), Fb.P(sb, zb, d + t), Fb.P(sa, zb, d + t),
               ((uv_u[0], 0.004), (uv_u[1], 0.004), (uv_u[1], 0.996), (uv_u[0], 0.996)), WHITE, facing=Fb.n3)
        b_kr.q("paint", Fb.P(sb, za, d), Fb.P(sa, za, d), Fb.P(sa, zb, d), Fb.P(sb, zb, d),
               ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), back_col, facing=(-Fb.nx, -Fb.ny, 0.0))
        for (s_e, fc) in ((sa, (-Fb.ex, -Fb.ey, 0.0)), (sb, Fb.e3)):
            b_kr.q("paint", Fb.P(s_e, za, d), Fb.P(s_e, za, d + t), Fb.P(s_e, zb, d + t), Fb.P(s_e, zb, d),
                   ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), back_col, facing=fc)
        b_kr.q("paint", Fb.P(sa, zb, d), Fb.P(sa, zb, d + t), Fb.P(sb, zb, d + t), Fb.P(sb, zb, d),
               ((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)), back_col, facing=(0, 0, 1))
        for s_p in (sa + 0.12, sb - 0.12):
            px, py, _ = Fb.P(s_p, 0.0, d - 0.04)
            b_kr.box("paint", (px, py, zg - 0.2 + 0.5 * (z1 + 0.25)), Fb.e3, Fb.n3, 0.06, 0.06, z1 + 0.25, post_col, default_tile=2.0)
        b_kr.count("kreutzenberger_signs")

    F_ur = Facade(490.1, 217.2, 484.4, 215.8)      # QOUr street front west of the step (normal -> street)
    F_ur2 = Facade(496.1, 217.1, 490.5, 215.7)     # QOUr street front east of the step (set back 1.5 m)
    F_um = Facade(478.7, 214.4, 473.0, 213.1)      # QOUm narrow street end
    kr_bed(F_ur, 0.25, F_ur.L - 0.55, 0.08, 1.05)
    kr_bed(F_ur2, 0.30, F_ur2.L - 0.30, 0.08, 1.35)
    kr_bed(F_um, 0.35, F_um.L - 0.35, 0.08, 1.20)
    # black portrait sign (SEKT / WEIN / BRAENDE / PRAESENTE + parking P) at the west end of the frontage
    kr_panel(F_um, F_um.L - 0.9, 1.75, 0.50, 2.05, 0.62, (0.004, 0.396), (0.07, 0.07, 0.08))
    # white info board beside the gate
    kr_panel(F_ur, F_ur.L - 0.45, 1.30, 0.60, 1.85, 0.75, (0.424, 0.996), (0.86, 0.86, 0.84), post_col=(0.55, 0.56, 0.57))

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
            uvs = b_inst.tile_of(mk, uvs)
            us = dl / uvs
            vs = (z_t0 - z_b0) / uvs
            ws = w_thick / uvs
            if (SEM.get(mk) or {}).get("real") in ("wood_beam", "wood_planks") and (z_t0 - z_b0) < 0.5:
                # horizontal timber rail: the scan's grain runs along V -> rotate the mapping by 90 degrees
                b_inst.add_quad(r0b, r1b, r1t, r0t, ((0, 0), (0, us), (vs, us), (vs, 0)), mk)
                b_inst.add_quad(l1b, l0b, l0t, l1t, ((0, 0), (0, us), (vs, us), (vs, 0)), mk)
                b_inst.add_quad(r0t, r1t, l1t, l0t, ((0, 0), (0, us), (ws, us), (ws, 0)), mk)
                return
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
    out_subdir: str = "",
    only_near: Optional[Tuple[float, float, float]] = None,
    save_blend: bool = True,
):
    with open(scene_json_path, "r", encoding="utf-8") as f:
        scene_data = json.load(f)

    buildings = scene_data.get("buildings", [])
    excluded_ids = load_excluded_landmark_ids(landmarks_manifest_path, extra_exclude_ids)
    print(f"Loaded {len(buildings)} OSM buildings from {scene_json_path}; excluding {len(excluded_ids)} landmark IDs: {sorted(excluded_ids)}")

    clear_scene()
    mats = create_material_library()
    valid_mats = valid_material_keys()

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

    all_buildings = list(buildings) + list(CORRIDOR_INFILL_BUILDINGS) + list(street_infills)

    # Village-wide context: street-facing facades get the full geometric detail, party walls stay blank,
    # doors / gates sit on the real terrain height.
    site_roads = []
    for r in scene_data.get("roads", []):
        role = str(r.get("role") or r.get("highway") or "")
        if role in ("track", "path") or str(r.get("highway")) in ("track", "path", "steps", "footway"):
            continue
        rw = float(r.get("widthM") or 4.5)
        pts_r = r.get("points") or []
        for i in range(len(pts_r) - 1):
            p0, p1 = pts_r[i], pts_r[i + 1]
            if len(p0) >= 3 and len(p1) >= 3:
                site_roads.append((float(p0[0]), -float(p0[2]), float(p1[0]), -float(p1[2]), rw, role))
    site_fps = []
    for b in all_buildings:
        fp_b = b.get("footprint") or []
        bid_b = str(b.get("id", ""))
        if len(fp_b) < 3 or (b.get("override") or BUILDING_OVERRIDES.get(bid_b) or {}).get("skip"):
            continue
        poly_b = clean_polygon_2d([(p[0], -p[1]) for p in fp_b])
        if len(poly_b) >= 3:
            site_fps.append((bid_b, poly_b, 0.0))
    site = SiteContext(site_roads, site_fps, os.path.join(PROJECT_ROOT, "data/terrain/heightmap.bin"))

    # reference brightness of the aerial-sampled roof colours per tone class (roofs are tinted relative to it)
    by_tone: Dict[str, List[float]] = {}
    for b in all_buildings:
        hx = b.get("roofColorHex")
        if isinstance(hx, str) and len(hx) == 7:
            a_lin = lin_rgb((int(hx[1:3], 16), int(hx[3:5], 16), int(hx[5:7], 16)))
            by_tone.setdefault(str(b.get("roofTone", "")).lower(), []).append(0.2126 * a_lin[0] + 0.7152 * a_lin[1] + 0.0722 * a_lin[2])
    ROOF_CLASS_LUM.clear()
    for tone, vals in by_tone.items():
        vals.sort()
        ROOF_CLASS_LUM[tone] = vals[len(vals) // 2]

    chunk_names = ("village_center", "village_north", "village_south", "village_outskirts")
    chunk_detail = {"village_center": 1.0, "village_north": 1.0, "village_south": 1.0, "village_outskirts": 0.7}
    builders = {cn: VillageMeshBuilder(cn, mats, site=site, detail=chunk_detail[cn]) for cn in chunk_names}
    chunk_counts = {cn: 0 for cn in chunk_names}
    built_ids = []
    skipped_landmark_ids = []
    elevs = []

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
        if only_near is not None and math.hypot(cx - only_near[0], cz - only_near[1]) > only_near[2]:
            continue
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
    out_dir = os.path.join(OUT_GLB_DIR, out_subdir) if out_subdir else OUT_GLB_DIR
    os.makedirs(out_dir, exist_ok=True)
    chunk_entries = []
    all_chunk_objs = []
    all_warnings = []
    total_stats: Dict[str, int] = {}
    for cn in chunk_names:
        col = bpy.data.collections.new(cn)
        bpy.context.scene.collection.children.link(col)
        all_warnings.extend(f"{cn}: {w}" for w in builders[cn].warnings)
        for k, v in builders[cn].stats.items():
            total_stats[k] = total_stats.get(k, 0) + v
        obj = builders[cn].finalize_object(col)
        if obj is None:
            if only_near is None:
                raise RuntimeError(f"Chunk {cn} came out empty - refusing to write a broken village")
            # partial dev build: still write a valid (tiny) chunk so the loader finds all four files
            dummy = VillageMeshBuilder(cn, mats)
            dummy.box("concrete", (0.0, 0.0, -50.0), (1, 0, 0), (0, 1, 0), 0.1, 0.1, 0.1)
            obj = dummy.finalize_object(col)
        all_chunk_objs.append(obj)
        det = builders[cn].detail_obj
        glb_path = os.path.join(out_dir, f"{cn}.glb")
        export_objects_glb([o for o in (obj, det) if o is not None], glb_path)
        fsize = os.path.getsize(glb_path)
        det_tris = mesh_triangle_count(det) if det is not None else 0
        tris = mesh_triangle_count(obj) + det_tris
        chunk_entries.append({
            "id": cn,
            "glbPath": f"/assets/models/village/{cn}.glb",
            "buildingCount": chunk_counts[cn],
            "triangles": tris,
            "detailTriangles": det_tris,
            "materialCount": len(obj.data.materials) + (len(det.data.materials) if det is not None else 0),
            "fileSizeBytes": fsize,
            "worldPositioned": True,
            "bounds": compute_gltf_bbox_obj(obj),
        })
        print(f"Exported {cn}.glb: {chunk_counts[cn]} buildings, {tris} tris, {fsize / 1024:.1f} KB")

    total_tris = sum(c["triangles"] for c in chunk_entries)
    total_bytes = sum(c["fileSizeBytes"] for c in chunk_entries)
    tex_bytes = sum(os.path.getsize(os.path.join(WEB_TEX_DIR, fn)) for fn in set(_WEB_TEX_CACHE.values()))
    print(f"VILLAGE TOTAL: {sum(chunk_counts.values())} buildings, {total_tris} triangles, "
          f"{sum(c['materialCount'] for c in chunk_entries)} primitives, GLBs {total_bytes / 1e6:.2f} MB, "
          f"shared textures {tex_bytes / 1e6:.2f} MB ({len(set(_WEB_TEX_CACHE.values()))} files)")
    print(f"VILLAGE DETAIL COUNTS: {total_stats}")
    if all_warnings:
        print(f"!!! {len(all_warnings)} BUILDER WARNINGS (walls that fell back to a plain panel):")
        for w in all_warnings[:60]:
            print("   ", w)

    if save_blend and not out_subdir and only_near is None:
        # Save full master .blend archive BEFORE adding temporary preview ground/camera!
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_ARCHIVE)
        print(f"Saved master Kindenheim village archive -> {BLEND_ARCHIVE}")

    # Merge into public/assets/models/village/manifest.json: ONLY the chunk / building keys are ours;
    # the "props" section (and anything else) belongs to the props pipeline and is preserved verbatim.
    chunk_keys = {
        "coordinateSystem": "Three.js Y-up meters (+X East, -Z North, +Y Up above minElevationM)",
        "worldPositionedChunks": True,
        "totalVillageBuildings": sum(chunk_counts.values()),
        "excludedLandmarkIds": sorted(set(excluded_ids)),
        "matchedExcludedLandmarkIds": sorted(set(skipped_landmark_ids)),
        "chunks": chunk_entries,
        "villageTextures": {
            "directory": f"/assets/models/village/{WEB_TEX_DIRNAME}",
            "note": "external textures shared by all village chunk GLBs (referenced by relative URI)",
            "fileCount": len(set(_WEB_TEX_CACHE.values())),
            "totalBytes": tex_bytes,
        },
        "villageTriangles": total_tris,
    }
    if out_subdir or only_near is not None:
        wip_manifest = os.path.join(out_dir, "manifest_chunks.json")
        with open(wip_manifest, "w", encoding="utf-8") as f:
            json.dump(chunk_keys, f, indent=2)
        print(f"WIP build: wrote {wip_manifest}; the live manifest was NOT touched")
    else:
        if not os.path.exists(MANIFEST_OUT):
            raise RuntimeError(f"{MANIFEST_OUT} is missing - refusing to create it without the props section")
        with open(MANIFEST_OUT, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        manifest.update(chunk_keys)
        tmp_manifest = MANIFEST_OUT + ".tmp"
        with open(tmp_manifest, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        os.replace(tmp_manifest, MANIFEST_OUT)
        print(f"Merged village manifest -> {MANIFEST_OUT} ({chunk_keys['totalVillageBuildings']} buildings; props section untouched)")

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
    parser.add_argument("--out-subdir", type=str, default="", help="Write chunks to public/assets/models/village/<subdir>/ (dev builds; live manifest untouched)")
    parser.add_argument("--only-near", type=str, default="", help="x,z,radius (world metres): only build buildings near that point (dev builds)")
    parser.add_argument("--no-blend", action="store_true", help="Do not save the master .blend archive")
    args = parser.parse_args(argv)

    if args.demo:
        run_demo(args.render)
        if not args.skip_archetypes:
            save_modular_archetypes()
    else:
        extra = [s.strip() for s in args.exclude_ids.split(",") if s.strip()]
        only_near = None
        if args.only_near:
            parts = [float(v) for v in args.only_near.split(",")]
            if len(parts) != 3:
                raise SystemExit("--only-near expects x,z,radius")
            only_near = (parts[0], parts[1], parts[2])
            if not args.out_subdir:
                raise SystemExit("--only-near is a dev option and requires --out-subdir (never write partial chunks to the live folder)")
        run_production(
            args.scene,
            args.landmarks_manifest,
            extra,
            args.render_aerial,
            args.render_street,
            skip_archetypes=args.skip_archetypes or bool(args.out_subdir),
            render_corridors_dir=args.render_corridors_dir,
            out_subdir=args.out_subdir,
            only_near=only_near,
            save_blend=not args.no_blend,
        )


if __name__ == "__main__":
    main()
