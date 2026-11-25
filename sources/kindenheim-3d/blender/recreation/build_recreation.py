#!/usr/bin/env python3
"""
Blender 5.2 PBR 3D Asset Builder for Kindenheim Recreation Areas:
  - Fußballplatz (Sportplatz Andingstraße 7 / TV 1920 Kindenheim & Olli's Schlemmerstube)
  - Spielplatz (Kinderspielplatz Kindenheim, Neugasse / Sport- & Freizeithalle)

Exports 20 modular PBR-textured .glb assets to public/assets/models/recreation/
along with manifest.json and blender/recreation/kindenheim_recreation.blend.

Coordinate Contract:
  Blender local: +X = East, +Y = North, +Z = Up (front faces look toward -Y).
  glTF export uses export_yup=True -> Three.js (+X = East, +Y = Up, +Z = South / Blender -Y).
  Blender rot_z(+theta) == Three.js rotation.y(+theta).

Run via:
  /opt/homebrew/bin/blender --background --python blender/recreation/build_recreation.py
"""

import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
LANDMARKS_DIR = PROJECT_ROOT / "blender" / "landmarks"
if str(LANDMARKS_DIR) not in sys.path:
    sys.path.insert(0, str(LANDMARKS_DIR))

from arch_utils import (
    add_box,
    add_chimney,
    add_cylinder,
    add_gable_wall_triangles,
    add_gutter_and_downspout,
    add_pitched_roof_solid,
    add_ridge_cap,
    apply_face_fit_uv,
    apply_metric_box_uv,
    clear_scene,
    ensure_collection,
)

REC_TEX_DIR = SCRIPT_DIR / "textures"
LANDMARK_TEX_DIR = LANDMARKS_DIR / "textures"
GLB_OUT_DIR = PROJECT_ROOT / "public" / "assets" / "models" / "recreation"
BLEND_OUT = SCRIPT_DIR / "kindenheim_recreation.blend"
MANIFEST_OUT = GLB_OUT_DIR / "manifest.json"


# ---------------------------------------------------------------------------
# Blender 5.2 Safe PBR Material Loader (recreation/textures -> landmarks/textures)
# ---------------------------------------------------------------------------

def _resolve_tex(tex_name: str, suffix: str) -> Path | None:
    for d in (REC_TEX_DIR, LANDMARK_TEX_DIR):
        p = d / f"{tex_name}{suffix}"
        if p.exists():
            return p
    return None


def _load_img(path: Path, colorspace: str):
    key = f"{path.parent.name}_{path.name}"
    img = bpy.data.images.get(key)
    if img is None:
        img = bpy.data.images.load(str(path), check_existing=False)
        img.name = key
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    return img


def get_rec_material(
    name: str,
    tex_name: str | None = None,
    base_color: tuple[float, float, float, float] | None = None,
    normal_strength: float = 0.85,
    roughness_override: float | None = None,
    metallic_override: float | None = None,
    tint: tuple[float, float, float] | None = None,
    emissive_color: tuple[float, float, float, float] | None = None,
    emissive_strength: float = 0.0,
):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat

    mat = bpy.data.materials.new(name=name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (520, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (180, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    if base_color is not None:
        bsdf.inputs["Base Color"].default_value = base_color

    if tex_name:
        albedo_p = _resolve_tex(tex_name, "_albedo.jpg")
        if albedo_p is not None:
            t_alb = nt.nodes.new("ShaderNodeTexImage")
            t_alb.location = (-360, 260)
            t_alb.image = _load_img(albedo_p, "sRGB")
            if tint is not None:
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                mix.inputs["B"].default_value = (tint[0], tint[1], tint[2], 1.0)
                mix.location = (-80, 260)
                nt.links.new(t_alb.outputs["Color"], mix.inputs["A"])
                nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
            else:
                nt.links.new(t_alb.outputs["Color"], bsdf.inputs["Base Color"])

        rough_p = _resolve_tex(tex_name, "_roughness.jpg")
        if roughness_override is not None:
            bsdf.inputs["Roughness"].default_value = roughness_override
        elif rough_p is not None:
            t_r = nt.nodes.new("ShaderNodeTexImage")
            t_r.location = (-360, -20)
            t_r.image = _load_img(rough_p, "Non-Color")
            nt.links.new(t_r.outputs["Color"], bsdf.inputs["Roughness"])

        metal_p = _resolve_tex(tex_name, "_metallic.jpg")
        if metallic_override is not None:
            bsdf.inputs["Metallic"].default_value = metallic_override
        elif metal_p is not None:
            t_m = nt.nodes.new("ShaderNodeTexImage")
            t_m.location = (-360, -280)
            t_m.image = _load_img(metal_p, "Non-Color")
            nt.links.new(t_m.outputs["Color"], bsdf.inputs["Metallic"])

        norm_p = _resolve_tex(tex_name, "_normal.png")
        if norm_p is not None:
            t_n = nt.nodes.new("ShaderNodeTexImage")
            t_n.location = (-360, -540)
            t_n.image = _load_img(norm_p, "Non-Color")
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nmap.location = (-80, -480)
            nmap.inputs["Strength"].default_value = normal_strength
            nt.links.new(t_n.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        if roughness_override is not None:
            bsdf.inputs["Roughness"].default_value = roughness_override
        if metallic_override is not None:
            bsdf.inputs["Metallic"].default_value = metallic_override

    if emissive_color is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emissive_color
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emissive_strength

    return mat


def finalize_rec_mesh(
    name: str,
    bm: bmesh.types.BMesh,
    material,
    collection,
    tile_u: float = 1.5,
    tile_v: float = 1.5,
    slope_align: bool = False,
    fit_uv: bool = False,
    smooth: bool = False,
):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if fit_uv:
        apply_face_fit_uv(bm)
    else:
        apply_metric_box_uv(bm, tile_u=tile_u, tile_v=tile_v, slope_align=slope_align)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    if material is not None:
        obj.data.materials.append(material)
    collection.objects.link(obj)
    return obj


def add_segment(bm: bmesh.types.BMesh, p0: Vector, p1: Vector, radius: float, segments: int = 8):
    vec = p1 - p0
    length = vec.length
    if length < 1e-4:
        return
    mid = (p0 + p1) * 0.5
    quat = Vector((0.0, 0.0, 1.0)).rotation_difference(vec.normalized())
    mat = Matrix.Translation(mid) @ quat.to_matrix().to_4x4()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius,
        depth=length,
        matrix=mat,
    )


def add_rect_cord(bm: bmesh.types.BMesh, p0: Vector, p1: Vector, thickness: float = 0.014):
    """Lightweight 4-sided cord segment (12 tris) for soccer goal nets & climbing webs."""
    vec = p1 - p0
    length = vec.length
    if length < 1e-4:
        return
    mid = (p0 + p1) * 0.5
    quat = Vector((0.0, 0.0, 1.0)).rotation_difference(vec.normalized())
    mat = Matrix.Translation(mid) @ quat.to_matrix().to_4x4() @ Matrix.Diagonal((thickness, thickness, length, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=mat)


def add_torus_ring(
    bm: bmesh.types.BMesh,
    center: Vector,
    major_r: float,
    tube_r: float,
    major_segs: int = 24,
    minor_segs: int = 8,
    normal_axis: str = "Z",
):
    rot = Matrix.Identity(4)
    if normal_axis == "X":
        rot = Matrix.Rotation(math.pi * 0.5, 4, "Y")
    elif normal_axis == "Y":
        rot = Matrix.Rotation(math.pi * 0.5, 4, "X")

    rings = []
    for i in range(major_segs):
        theta = 2.0 * math.pi * i / major_segs
        ct, st = math.cos(theta), math.sin(theta)
        ring = []
        for j in range(minor_segs):
            phi = 2.0 * math.pi * j / minor_segs
            r = major_r + tube_r * math.cos(phi)
            z = tube_r * math.sin(phi)
            local_v = Vector((r * ct, r * st, z))
            world_v = center + (rot @ local_v)
            ring.append(bm.verts.new(world_v))
        rings.append(ring)

    for i in range(major_segs):
        inext = (i + 1) % major_segs
        r0, r1 = rings[i], rings[inext]
        for j in range(minor_segs):
            jnext = (j + 1) % minor_segs
            bm.faces.new([r0[j], r1[j], r1[jnext], r0[jnext]])


def add_front_quad(bm: bmesh.types.BMesh, cx: float, cy: float, cz: float, w: float, h: float):
    """Single quad facing -Y with exact CCW winding so face_fit_uv maps left->right cleanly."""
    hw, hh = w * 0.5, h * 0.5
    v0 = bm.verts.new((cx - hw, cy, cz - hh))
    v1 = bm.verts.new((cx + hw, cy, cz - hh))
    v2 = bm.verts.new((cx + hw, cy, cz + hh))
    v3 = bm.verts.new((cx - hw, cy, cz + hh))
    bm.faces.new([v0, v1, v2, v3])


def get_palette():
    return {
        "robinia": get_rec_material("Rec_Robinia_Wood", "robinia_wood", normal_strength=0.95),
        "timber_dark": get_rec_material("Rec_Timber_Dark", "wood_timber_dark", normal_strength=0.95),
        "shingle": get_rec_material("Rec_Timber_Shingle", "timber_shingle", normal_strength=1.1),
        "paint_red": get_rec_material("Rec_Paint_Red", "paint_red", normal_strength=0.45),
        "paint_blue": get_rec_material("Rec_Paint_Blue", "paint_blue", normal_strength=0.45),
        "paint_yellow": get_rec_material("Rec_Paint_Yellow", "paint_yellow", normal_strength=0.45),
        "paint_green": get_rec_material("Rec_Paint_Green", "paint_green", normal_strength=0.45),
        "galvanized": get_rec_material("Rec_Galvanized_Steel", "galvanized_steel", normal_strength=0.75),
        "stainless": get_rec_material("Rec_Stainless_Brushed", "stainless_brushed", normal_strength=0.35),
        "rubber": get_rec_material("Rec_Rubber_Black", "rubber_black", normal_strength=0.9),
        "rope_red": get_rec_material("Rec_Rope_Red", "rope_red", normal_strength=1.25),
        "rope_blue": get_rec_material("Rec_Rope_Blue", "rope_blue", normal_strength=1.25),
        "concrete_terrace": get_rec_material("Rec_Concrete_Terrace", "concrete_terrace", normal_strength=0.85),
        "concrete_plinth": get_rec_material("Rec_Concrete_Plinth", "concrete_plinth", normal_strength=0.95),
        "stucco_cream": get_rec_material("Rec_Stucco_Cream", "stucco_warm_cream", normal_strength=0.85),
        "roof_clay": get_rec_material("Rec_Roof_Clay", "roof_clay_tiles", normal_strength=1.15),
        "roof_slate": get_rec_material("Rec_Roof_Slate", "roof_slate", normal_strength=1.1),
        "glass_warm": get_rec_material("Rec_Glass_Warm", "window_glass_warm", roughness_override=0.14, metallic_override=0.08),
        "door_burgundy": get_rec_material("Rec_Door_Burgundy", "door_burgundy_panel", normal_strength=0.8),
        "white_enamel": get_rec_material(
            "Rec_White_Enamel",
            base_color=(0.94, 0.95, 0.96, 1.0),
            roughness_override=0.32,
            metallic_override=0.12,
        ),
        "net_cord": get_rec_material(
            "Rec_Net_White",
            base_color=(0.93, 0.93, 0.91, 1.0),
            roughness_override=0.72,
            metallic_override=0.0,
        ),
        "dugout_poly": get_rec_material(
            "Rec_Dugout_Polycarb",
            base_color=(0.56, 0.72, 0.84, 1.0),
            roughness_override=0.18,
            metallic_override=0.10,
        ),
        "floodlight_lens": get_rec_material(
            "Floodlight_Lens",
            base_color=(0.86, 0.90, 0.95, 1.0),
            roughness_override=0.16,
            metallic_override=0.05,
            emissive_color=(1.0, 0.94, 0.82, 1.0),
            emissive_strength=0.0,
        ),
        "sportheim_sign": get_rec_material("Rec_Sportheim_Sign", "sportheim_sign", normal_strength=0.2),
        "scoreboard_face": get_rec_material("Rec_Scoreboard_Face", "scoreboard_face", normal_strength=0.2),
        "spielplatz_sign": get_rec_material("Rec_Spielplatz_Sign", "spielplatz_sign", normal_strength=0.2),
        "tischtennis_top": get_rec_material("Rec_Tischtennis_Top", "tischtennis_top", normal_strength=0.35),
        "iron_dark": get_rec_material("Rec_Iron_Dark", "iron_dark", normal_strength=0.65),
    }


def export_asset(
    key: str,
    objects: list,
    manifest_entries: dict,
):
    glb_path = GLB_OUT_DIR / f"{key}.glb"
    glb_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=88,
    )

    # Measure world-space Three.js Y-up bounds: Blender (x, y, z) -> Three (x, z, -y)
    mins = [1e9, 1e9, 1e9]
    maxs = [-1e9, -1e9, -1e9]
    tris = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        tris += sum(max(1, len(p.vertices) - 2) for p in obj.data.polygons)
        mw = obj.matrix_world
        for v in obj.data.vertices:
            wp = mw @ v.co
            tx, ty, tz = wp.x, wp.z, -wp.y
            mins[0] = min(mins[0], tx)
            mins[1] = min(mins[1], ty)
            mins[2] = min(mins[2], tz)
            maxs[0] = max(maxs[0], tx)
            maxs[1] = max(maxs[1], ty)
            maxs[2] = max(maxs[2], tz)

    size = [round(maxs[i] - mins[i], 3) for i in range(3)]
    manifest_entries[key] = {
        "glbPath": f"/assets/models/recreation/{key}.glb",
        "bounds": {
            "min": [round(v, 3) for v in mins],
            "max": [round(v, 3) for v in maxs],
            "size": size,
        },
        "triangles": tris,
        "fileSizeBytes": glb_path.stat().st_size,
    }
    print(f"  Exported {key}.glb ({glb_path.stat().st_size / 1024:.1f} KB, {tris} tris, size={size})")


# ---------------------------------------------------------------------------
# FUSSBALLPLATZ ASSETS
# ---------------------------------------------------------------------------

def build_sportheim(pal, col, manifest):
    """47.5m x 6.5m Sportheim ('Olli's Schlemmerstube') with covered veranda, 6 Bierzeltgarnituren & -2.8m plinth."""
    bms = {
        "concrete_plinth": bmesh.new(),
        "stucco_cream": bmesh.new(),
        "roof_clay": bmesh.new(),
        "timber_dark": bmesh.new(),
        "robinia": bmesh.new(),
        "glass_warm": bmesh.new(),
        "door_burgundy": bmesh.new(),
        "galvanized": bmesh.new(),
        "iron_dark": bmesh.new(),
        "sportheim_sign": bmesh.new(),
    }

    L = 47.5
    D = 6.5
    body_d = 4.1
    veranda_d = 2.4
    body_cy = veranda_d * 0.5      # +1.20 (north side)
    veranda_cy = -body_d * 0.5     # -2.05 (south/pitch side)
    floor_z = 0.72
    eave_z = 4.10
    ridge_h = 1.75
    front_wall_y = body_cy - body_d * 0.5  # -0.85

    # Retaining concrete plinth (-2.8m to +0.72m) spanning full 47.5m x 6.5m footprint
    add_box(bms["concrete_plinth"], 0.0, 0.0, (-2.8 + floor_z) * 0.5, L, D, floor_z + 2.8)
    # Two wide access stairs descending from veranda edge (y=-3.25) into pitch edge
    for sx in (-12.5, 8.5):
        for step in range(6):
            st_y = -3.25 - (step + 0.5) * 0.30
            st_z = floor_z - (step + 0.5) * 0.24
            add_box(bms["concrete_plinth"], sx, st_y, st_z - 0.6, 3.2, 0.34, 1.2)

    # Main building stucco walls + gables
    add_box(bms["stucco_cream"], 0.0, body_cy, (floor_z + eave_z) * 0.5, L - 0.2, body_d, eave_z - floor_z)
    add_gable_wall_triangles(bms["stucco_cream"], 0.0, body_cy, eave_z, L - 0.2, body_d, ridge_h, wall_thick=0.35)

    # Terracotta clay-tile roof extending continuously over front veranda!
    # Main gable over body
    add_pitched_roof_solid(
        bms["roof_clay"], 0.0, body_cy, eave_z,
        length_x=L - 0.2, width_y=body_d, ridge_h=ridge_h,
        overhang_x=0.55, overhang_y=0.45, thickness=0.22,
    )
    # Front Schleppdach roof extension covering veranda (y=-3.55 .. -0.85)
    slope = ridge_h / (body_d * 0.5)
    v_top_z = eave_z - slope * 0.25
    v_bot_z = v_top_z - slope * (veranda_d + 0.35)
    v_span = math.hypot(veranda_d + 0.55, v_top_z - v_bot_z)
    add_box(
        bms["roof_clay"], 0.0, veranda_cy - 0.10, (v_top_z + v_bot_z) * 0.5 + 0.08,
        L + 0.90, v_span, 0.18, rot_x=math.atan(slope),
    )
    # Ridge tiles & brick chimney
    add_ridge_cap(bms["roof_clay"], Vector((-L * 0.5 - 0.45, body_cy, eave_z + ridge_h + 0.22)), Vector((L * 0.5 + 0.45, body_cy, eave_z + ridge_h + 0.22)), radius=0.14)
    add_chimney(bms, -11.0, body_cy + 0.5, eave_z + 0.8, eave_z + ridge_h + 0.85, sx=0.68, sy=0.68, wall_key="stucco_cream", stone_key="concrete_plinth")

    # Galvanized gutter + 3 downspouts along veranda eave
    add_gutter_and_downspout(bms, -L * 0.5 - 0.4, L * 0.5 + 0.4, -D * 0.5 - 0.28, v_bot_z - 0.04, z_ground=0.0, copper_key="galvanized")
    for dx in (-22.8, 0.0, 22.8):
        add_segment(bms["galvanized"], Vector((dx, -D * 0.5 - 0.18, v_bot_z - 0.04)), Vector((dx, -D * 0.5 - 0.12, 0.0)), radius=0.045)

    # Front veranda timber columns, header beam & spectator railing
    veranda_edge_y = -D * 0.5 + 0.18
    add_box(bms["timber_dark"], 0.0, veranda_edge_y, v_bot_z + 0.02, L - 0.2, 0.20, 0.22)
    n_bays = 10
    for i in range(n_bays + 1):
        cx = -L * 0.5 + 0.35 + i * ((L - 0.7) / n_bays)
        add_box(bms["timber_dark"], cx, veranda_edge_y, (floor_z + v_bot_z) * 0.5, 0.18, 0.18, v_bot_z - floor_z)
        # Knee braces
        if i < n_bays:
            add_box(bms["timber_dark"], cx + 0.45, veranda_edge_y, v_bot_z - 0.38, 0.72, 0.10, 0.10, rot_y=math.radians(40))
    # Veranda railing segments (with gaps at the 2 stair entrances)
    for rx0, rx1 in [(-23.4, -14.2), (-10.8, 6.8), (10.2, 23.4)]:
        rcx = (rx0 + rx1) * 0.5
        rlen = rx1 - rx0
        add_box(bms["timber_dark"], rcx, veranda_edge_y, floor_z + 0.95, rlen, 0.10, 0.08)
        add_box(bms["timber_dark"], rcx, veranda_edge_y, floor_z + 0.50, rlen, 0.07, 0.06)

    # Clubhouse front windows & doors along front_wall_y (-0.85)
    for wx in (-19.5, -16.0, -9.2, -5.5, -1.8, 1.8, 5.5, 13.5, 17.5, 21.0):
        add_box(bms["glass_warm"], wx, front_wall_y - 0.02, floor_z + 1.48, 1.55, 0.06, 1.15)
        add_box(bms["timber_dark"], wx, front_wall_y - 0.04, floor_z + 1.48, 1.68, 0.08, 0.07)
        add_box(bms["timber_dark"], wx, front_wall_y - 0.04, floor_z + 2.04, 1.68, 0.08, 0.07)
        add_box(bms["timber_dark"], wx - 0.79, front_wall_y - 0.04, floor_z + 1.48, 0.08, 0.08, 1.18)
        add_box(bms["timber_dark"], wx + 0.79, front_wall_y - 0.04, floor_z + 1.48, 0.08, 0.08, 1.18)
    for dx in (-12.5, 8.8):
        add_box(bms["door_burgundy"], dx, front_wall_y - 0.03, floor_z + 1.05, 1.30, 0.08, 2.08)
        add_box(bms["timber_dark"], dx, front_wall_y - 0.05, floor_z + 2.12, 1.46, 0.10, 0.10)

    # 6 Pfalz wooden Bierzeltgarnituren (tables + benches) under the veranda
    for bx in (-19.0, -15.5, -6.5, -2.5, 2.0, 15.5):
        by = -2.05
        # Table top + 2 steel legs
        add_box(bms["robinia"], bx, by, floor_z + 0.75, 2.20, 0.65, 0.05)
        for lx in (-0.85, 0.85):
            add_box(bms["iron_dark"], bx + lx, by, floor_z + 0.37, 0.05, 0.56, 0.72)
        # 2 Benches
        for side in (-0.62, 0.62):
            add_box(bms["robinia"], bx, by + side, floor_z + 0.45, 2.20, 0.26, 0.04)
            for lx in (-0.85, 0.85):
                add_box(bms["iron_dark"], bx + lx, by + side, floor_z + 0.22, 0.04, 0.22, 0.44)

    # Mounted fascia sign "OLLI'S SCHLEMMERSTUBE · TV 1920 KINDENHEIM"
    sign_cx, sign_cy, sign_cz = -4.5, veranda_edge_y - 0.14, v_bot_z + 0.24
    add_box(bms["timber_dark"], sign_cx, sign_cy + 0.03, sign_cz, 7.36, 0.06, 1.18)
    add_front_quad(bms["sportheim_sign"], sign_cx, sign_cy - 0.01, sign_cz, 7.20, 1.04)

    objs = []
    uv_cfg = {
        "concrete_plinth": (2.0, 2.0, False, False),
        "stucco_cream": (2.5, 2.5, False, False),
        "roof_clay": (1.8, 1.8, True, False),
        "timber_dark": (1.5, 1.5, False, False),
        "robinia": (1.2, 1.2, False, False),
        "glass_warm": (1.0, 1.0, False, True),
        "door_burgundy": (1.2, 2.0, False, True),
        "galvanized": (1.0, 1.0, False, False),
        "iron_dark": (1.0, 1.0, False, False),
        "sportheim_sign": (1.0, 1.0, False, True),
    }
    for k, bm in bms.items():
        if len(bm.verts) == 0:
            bm.free()
            continue
        tu, tv, sl, fit = uv_cfg[k]
        objs.append(finalize_rec_mesh(f"Sportheim_{k}", bm, pal[k], col, tu, tv, sl, fit, smooth=(k == "galvanized")))
    export_asset("sportheim_kindenheim", objs, manifest)


def build_terrace(pal, col, manifest):
    """28.0m x 3.4m whitewashed concrete Stehtraversen with 4 tiers, 2 stairways, retaining backwall & railing."""
    bms = {
        "concrete_terrace": bmesh.new(),
        "galvanized": bmesh.new(),
    }
    L = 28.0
    D = 3.4
    # 4 concrete tiers stepping up from front (-Y = -1.7) to rear (+Y = +1.7)
    # Tier i: y center, depth, top z
    tiers = [
        (-1.275, 0.85, 0.28),
        (-0.425, 0.85, 0.64),
        (0.425,  0.85, 1.02),
        (1.275,  0.85, 1.42),
    ]
    for cy, d, top_z in tiers:
        bot_z = -2.40
        add_box(bms["concrete_terrace"], 0.0, cy, (bot_z + top_z) * 0.5, L, d, top_z - bot_z)

    # Rear retaining cheek wall along top back edge (+1.62) rising to 2.25m to retain hillside cleanly
    add_box(bms["concrete_terrace"], 0.0, 1.62, (-2.40 + 2.15) * 0.5, L, 0.24, 4.55)
    # End concrete retaining cheek walls
    for ex in (-L * 0.5 + 0.14, L * 0.5 - 0.14):
        add_box(bms["concrete_terrace"], ex, 0.0, (-2.40 + 1.55) * 0.5, 0.28, D, 3.95)

    # Two intermediate stair flights (half-steps overlaid neatly at x=-6.5 and x=+6.5)
    for sx in (-6.5, 6.5):
        for i in range(7):
            sy = -1.52 + i * 0.44
            sz = 0.16 + i * 0.20
            add_box(bms["concrete_terrace"], sx, sy, sz - 0.12, 1.65, 0.46, 0.24)

    # Top galvanized tubular safety railing along rear edge (y=1.62, top z=2.15)
    rail_base_z = 2.15
    rail_h = 0.92
    add_segment(bms["galvanized"], Vector((-L * 0.5 + 0.2, 1.62, rail_base_z + rail_h)), Vector((L * 0.5 - 0.2, 1.62, rail_base_z + rail_h)), 0.032)
    add_segment(bms["galvanized"], Vector((-L * 0.5 + 0.2, 1.62, rail_base_z + rail_h * 0.5)), Vector((L * 0.5 - 0.2, 1.62, rail_base_z + rail_h * 0.5)), 0.022)
    n_posts = 12
    for i in range(n_posts + 1):
        px = -L * 0.5 + 0.3 + i * ((L - 0.6) / n_posts)
        add_segment(bms["galvanized"], Vector((px, 1.62, rail_base_z - 0.05)), Vector((px, 1.62, rail_base_z + rail_h)), 0.028)

    objs = [
        finalize_rec_mesh("Terrace_concrete", bms["concrete_terrace"], pal["concrete_terrace"], col, 2.2, 2.2),
        finalize_rec_mesh("Terrace_railing", bms["galvanized"], pal["galvanized"], col, 1.0, 1.0, smooth=True),
    ]
    export_asset("sportplatz_terrace", objs, manifest)


def build_soccer_goal(key: str, width: float, height: float, depth_bot: float, depth_top: float, pal, col, manifest):
    """Soccer goal with open mouth facing +X, crossbar/posts in Y (±width/2), net back toward -X."""
    bm_frame = bmesh.new()
    bm_galv = bmesh.new()
    bm_net = bmesh.new()

    hy = width * 0.5
    post_r = 0.058 if width > 6.0 else 0.048

    # Left & Right main posts (with -0.35m sockets) + Crossbar
    add_segment(bm_frame, Vector((0.0, -hy, -0.35)), Vector((0.0, -hy, height)), post_r, segments=12)
    add_segment(bm_frame, Vector((0.0, +hy, -0.35)), Vector((0.0, +hy, height)), post_r, segments=12)
    add_segment(bm_frame, Vector((0.0, -hy - post_r, height)), Vector((0.0, +hy + post_r, height)), post_r, segments=12)

    # Ground frame & rear galvanized net stanchions
    add_segment(bm_galv, Vector((0.0, -hy, 0.025)), Vector((-depth_bot, -hy, 0.025)), 0.028, segments=8)
    add_segment(bm_galv, Vector((0.0, +hy, 0.025)), Vector((-depth_bot, +hy, 0.025)), 0.028, segments=8)
    add_segment(bm_galv, Vector((-depth_bot, -hy, 0.025)), Vector((-depth_bot, +hy, 0.025)), 0.028, segments=8)
    # Top rear support bars & angled stanchions
    for side in (-1.0, 1.0):
        sy = side * hy
        add_segment(bm_galv, Vector((0.0, sy, height - 0.03)), Vector((-depth_top, sy, height - 0.03)), 0.026, segments=8)
        add_segment(bm_galv, Vector((-depth_top, sy, height - 0.03)), Vector((-depth_bot, sy, 0.025)), 0.026, segments=8)
        # Angled diagonal brace
        add_segment(bm_galv, Vector((-depth_top * 0.5, sy, height - 0.03)), Vector((-depth_bot * 0.6, sy, 0.025)), 0.020, segments=8)

    # Lightweight 3D crisscross white cord net lattice (back slope, top roof, left & right sides)
    ny = max(12, int(round(width / 0.34)))
    nz = max(6, int(round(height / 0.34)))
    nd = max(4, int(round(depth_bot / 0.34)))

    # Back slope: from top (-depth_top, height) down to bottom (-depth_bot, 0.03)
    for i in range(ny + 1):
        y = -hy + width * (i / ny)
        add_rect_cord(bm_net, Vector((-depth_top, y, height - 0.02)), Vector((-depth_bot, y, 0.03)), 0.013)
        # Top roof longitudinal cords
        add_rect_cord(bm_net, Vector((0.0, y, height - 0.02)), Vector((-depth_top, y, height - 0.02)), 0.013)
    for j in range(1, nz):
        t = j / nz
        rx = -depth_top * (1.0 - t) - depth_bot * t
        rz = (height - 0.02) * (1.0 - t) + 0.03 * t
        add_rect_cord(bm_net, Vector((rx, -hy, rz)), Vector((rx, +hy, rz)), 0.013)
    for k in range(1, nd // 2 + 1):
        rx = -depth_top * (k / (nd // 2 + 1))
        add_rect_cord(bm_net, Vector((rx, -hy, height - 0.02)), Vector((rx, +hy, height - 0.02)), 0.013)

    # Side trapezoids
    for side in (-1.0, 1.0):
        sy = side * hy
        for j in range(1, nz):
            t = j / nz
            rx_back = -depth_top * (1.0 - t) - depth_bot * t
            rz = (height - 0.02) * (1.0 - t) + 0.03 * t
            add_rect_cord(bm_net, Vector((0.0, sy, rz)), Vector((rx_back, sy, rz)), 0.013)
        for k in range(1, nd):
            u = k / nd
            x_bot = -depth_bot * u
            # Intersect vertical plane x = x_bot with side profile
            if abs(x_bot) <= depth_top:
                z_top = height - 0.02
            else:
                s = (abs(x_bot) - depth_top) / max(depth_bot - depth_top, 1e-4)
                z_top = (height - 0.02) * (1.0 - s) + 0.03 * s
            add_rect_cord(bm_net, Vector((x_bot, sy, 0.03)), Vector((x_bot, sy, z_top)), 0.013)

    objs = [
        finalize_rec_mesh(f"{key}_frame", bm_frame, pal["white_enamel"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh(f"{key}_stanchions", bm_galv, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh(f"{key}_net", bm_net, pal["net_cord"], col, 1.0, 1.0),
    ]
    export_asset(key, objs, manifest)


def build_floodlight_mast(pal, col, manifest):
    """16.5m tall galvanized steel floodlight mast with climb rungs, crossbar & 3 angled Floodlight_Lens projectors facing -Y."""
    bm_steel = bmesh.new()
    bm_dark = bmesh.new()
    bm_lens = bmesh.new()
    bm_conc = bmesh.new()

    # Concrete footing (-1.2m to +0.25m)
    add_cylinder(bm_conc, 0.0, 0.0, -0.475, 0.34, 0.28, 1.45, segments=12)
    # 3-section tapered galvanized steel mast up to Z=16.5m
    add_cylinder(bm_steel, 0.0, 0.0, 3.0, 0.16, 0.135, 6.0, segments=14)
    add_cylinder(bm_steel, 0.0, 0.0, 8.8, 0.135, 0.105, 5.8, segments=14)
    add_cylinder(bm_steel, 0.0, 0.0, 14.1, 0.105, 0.075, 4.9, segments=14)

    # Maintenance climb ladder rungs up rear (+Y) side
    for z_rung in [i * 0.45 for i in range(4, 34)]:
        add_segment(bm_steel, Vector((-0.14, 0.14, z_rung)), Vector((0.14, 0.14, z_rung)), 0.016, segments=6)

    # Top T-crossbar at Z=16.35m (width 3.2m along X) + diagonal braces
    add_box(bm_steel, 0.0, -0.10, 16.35, 3.20, 0.12, 0.12)
    add_segment(bm_steel, Vector((-1.10, -0.06, 16.30)), Vector((0.0, 0.0, 15.20)), 0.032, segments=8)
    add_segment(bm_steel, Vector((+1.10, -0.06, 16.30)), Vector((0.0, 0.0, 15.20)), 0.032, segments=8)

    # 3 Floodlight projector housings angled downward ~28 deg facing -Y
    tilt_x = math.radians(-28.0)
    for lx in (-1.25, 0.0, 1.25):
        # Mounting yoke
        add_box(bm_steel, lx, -0.18, 16.48, 0.10, 0.18, 0.22)
        # Rectangular projector housing rotated down toward pitch (-Y)
        add_box(bm_dark, lx, -0.26, 16.60, 0.62, 0.26, 0.38, rot_x=tilt_x)
        # Hood visor
        add_box(bm_dark, lx, -0.36, 16.77, 0.64, 0.22, 0.04, rot_x=tilt_x)
        # Emissive glass lens face on front (-Y)
        rot_m = Matrix.Translation((lx, -0.26, 16.60)) @ Euler((tilt_x, 0.0, 0.0), "XYZ").to_matrix().to_4x4()
        lens_center = rot_m @ Vector((0.0, -0.14, 0.0))
        add_box(bm_lens, lens_center.x, lens_center.y, lens_center.z, 0.54, 0.03, 0.30, rot_x=tilt_x)

    objs = [
        finalize_rec_mesh("Mast_concrete", bm_conc, pal["concrete_plinth"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("Mast_steel", bm_steel, pal["galvanized"], col, 1.5, 1.5, smooth=True),
        finalize_rec_mesh("Mast_housings", bm_dark, pal["iron_dark"], col, 1.0, 1.0),
        finalize_rec_mesh("Mast_Floodlight_Lens", bm_lens, pal["floodlight_lens"], col, 1.0, 1.0),
    ]
    export_asset("floodlight_mast", objs, manifest)


def build_dugout_bench(pal, col, manifest):
    """4.2m x 1.5m x 2.15m curved polycarbonate & aluminum Auswechselbank facing -Y."""
    bm_alu = bmesh.new()
    bm_poly = bmesh.new()
    bm_seat = bmesh.new()
    bm_conc = bmesh.new()

    W = 4.20
    D = 1.45
    add_box(bm_conc, 0.0, 0.0, -0.20, W + 0.2, D + 0.2, 0.45)

    # Curved aluminum C-ribs at 3 bays (rear is +Y=+0.68, opens toward -Y)
    rib_pts = [
        (0.68, 0.02),
        (0.68, 1.35),
        (0.45, 1.85),
        (0.05, 2.12),
        (-0.58, 2.10),
    ]
    for rx in (-W * 0.5 + 0.06, -0.68, 0.68, W * 0.5 - 0.06):
        for i in range(len(rib_pts) - 1):
            p0 = Vector((rx, rib_pts[i][0], rib_pts[i][1]))
            p1 = Vector((rx, rib_pts[i + 1][0], rib_pts[i + 1][1]))
            add_segment(bm_alu, p0, p1, 0.032, segments=8)
        # Base rail forward
        add_segment(bm_alu, Vector((rx, 0.68, 0.04)), Vector((rx, -0.58, 0.04)), 0.032, segments=8)

    # Horizontal purlins
    for py, pz in rib_pts[1:]:
        add_segment(bm_alu, Vector((-W * 0.5, py, pz)), Vector((W * 0.5, py, pz)), 0.026, segments=8)

    # Translucent polycarbonate rear & roof panels
    for i in range(len(rib_pts) - 1):
        y0, z0 = rib_pts[i]
        y1, z1 = rib_pts[i + 1]
        my, mz = (y0 + y1) * 0.5, (z0 + z1) * 0.5
        seg_l = math.hypot(y1 - y0, z1 - z0)
        ang = math.atan2(y1 - y0, z1 - z0)
        add_box(bm_poly, 0.0, my, mz, W - 0.06, 0.03, seg_l + 0.02, rot_x=ang)

    # 6 Blue molded team seats along timber/steel seat rail
    add_box(bm_alu, 0.0, 0.28, 0.42, W - 0.16, 0.14, 0.06)
    for sx in (-1.65, -0.99, -0.33, 0.33, 0.99, 1.65):
        add_box(bm_seat, sx, 0.22, 0.48, 0.44, 0.38, 0.06)
        add_box(bm_seat, sx, 0.40, 0.72, 0.44, 0.06, 0.44, rot_x=math.radians(8))

    objs = [
        finalize_rec_mesh("Dugout_base", bm_conc, pal["concrete_plinth"], col, 1.5, 1.5),
        finalize_rec_mesh("Dugout_frame", bm_alu, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("Dugout_poly", bm_poly, pal["dugout_poly"], col, 1.5, 1.5),
        finalize_rec_mesh("Dugout_seats", bm_seat, pal["paint_blue"], col, 0.6, 0.6),
    ]
    export_asset("dugout_bench", objs, manifest)


def build_scoreboard(pal, col, manifest):
    """2.6m x 1.3m green village Anzeigetafel on twin galvanized posts facing -Y."""
    bm_posts = bmesh.new()
    bm_frame = bmesh.new()
    bm_face = bmesh.new()

    for px in (-1.05, 1.05):
        add_cylinder(bm_posts, px, 0.0, 1.15, 0.055, 0.055, 3.30, segments=10)
    # Dark green casing + top rain hood
    add_box(bm_frame, 0.0, 0.0, 2.30, 2.66, 0.16, 1.36)
    add_box(bm_posts, 0.0, -0.06, 3.01, 2.74, 0.32, 0.05, rot_x=math.radians(12))
    add_front_quad(bm_face, 0.0, -0.085, 2.30, 2.54, 1.24)

    objs = [
        finalize_rec_mesh("Scoreboard_posts", bm_posts, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("Scoreboard_case", bm_frame, pal["paint_green"], col, 1.0, 1.0),
        finalize_rec_mesh("Scoreboard_face", bm_face, pal["scoreboard_face"], col, 1.0, 1.0, fit_uv=True),
    ]
    export_asset("scoreboard", objs, manifest)


# ---------------------------------------------------------------------------
# SPIELPLATZ ASSETS
# ---------------------------------------------------------------------------

def build_playground_tower(pal, col, manifest):
    """Hero Ritterburg / Kletterturm mit Edelstahl-Rutsche facing -Y, bridge, climbing wall, net & fireman's pole."""
    bms = {
        "robinia": bmesh.new(),
        "shingle": bmesh.new(),
        "stainless": bmesh.new(),
        "paint_red": bmesh.new(),
        "paint_blue": bmesh.new(),
        "paint_yellow": bmesh.new(),
        "paint_green": bmesh.new(),
        "rope_red": bmesh.new(),
        "galvanized": bmesh.new(),
    }

    # Main Tower centered around (-0.65, 0.35), deck 1.85m x 1.85m at Z=1.70m
    mx, my = -0.65, 0.35
    hw = 0.92
    deck_z = 1.70
    eave_z = 3.25
    ridge_h = 0.92

    # 4 Heavy Robinia corner posts (-0.65m underground to eave_z + 0.15m)
    for sx in (-hw, hw):
        for sy in (-hw, hw):
            add_cylinder(bms["robinia"], mx + sx, my + sy, (-0.65 + eave_z + 0.12) * 0.5, 0.085, 0.080, eave_z + 0.77, segments=10)

    # Main platform deck planks + joists
    add_box(bms["robinia"], mx, my, deck_z - 0.08, 1.94, 1.94, 0.16)
    # Gabled cedar shingle roof over main tower
    add_pitched_roof_solid(
        bms["shingle"], mx, my, eave_z,
        length_x=2.05, width_y=2.05, ridge_h=ridge_h,
        overhang_x=0.30, overhang_y=0.30, thickness=0.14,
    )
    add_gable_wall_triangles(bms["robinia"], mx, my, eave_z, 1.90, 1.90, ridge_h, wall_thick=0.12)

    # Colorful balustrade pickets around main deck (leaving front -Y slide exit & +X bridge exit)
    # North (+Y) & West (-X) closed rails
    add_box(bms["robinia"], mx, my + hw, deck_z + 0.85, 1.84, 0.08, 0.08)
    add_box(bms["robinia"], mx - hw, my, deck_z + 0.85, 0.08, 1.84, 0.08)
    picket_cols = ["paint_red", "paint_blue", "paint_yellow", "paint_green"]
    for i in range(6):
        px = mx - 0.72 + i * 0.288
        add_box(bms[picket_cols[i % 4]], px, my + hw, deck_z + 0.44, 0.11, 0.05, 0.76)
        py = my - 0.72 + i * 0.288
        add_box(bms[picket_cols[(i + 1) % 4]], mx - hw, py, deck_z + 0.44, 0.05, 0.11, 0.76)
    # Front (-Y) slide guard bar & partial pickets
    add_box(bms["galvanized"], mx, my - hw, deck_z + 0.88, 1.80, 0.05, 0.05)
    for px in (mx - 0.68, mx + 0.68):
        add_box(bms["paint_red"], px, my - hw, deck_z + 0.44, 0.14, 0.05, 0.76)

    # Gleaming Stainless-Steel Slide running -Y from front of main deck (my - hw = -0.57) out to y = -3.85!
    slide_w = 0.56
    n_seg = 12
    pts_slide = []
    for i in range(n_seg + 1):
        t = i / n_seg
        sy = (my - hw) - t * 3.30
        # Smooth S-curve profile ending in horizontal runout at Z=0.30
        if t < 0.75:
            u = t / 0.75
            sz = deck_z * (1.0 - (0.5 - 0.5 * math.cos(u * math.pi)) * 0.82)
        else:
            sz = 0.30 - (t - 0.75) * 0.25
        pts_slide.append((sy, sz))

    for i in range(n_seg):
        y0, z0 = pts_slide[i]
        y1, z1 = pts_slide[i + 1]
        cy, cz = (y0 + y1) * 0.5, (z0 + z1) * 0.5
        seg_l = math.hypot(y1 - y0, z1 - z0) + 0.04
        ang = math.atan2(z0 - z1, y0 - y1)
        # Chute floor
        add_box(bms["stainless"], mx, cy, cz, slide_w, seg_l, 0.045, rot_x=ang)
        # Rolled side guard curbs
        for sx in (-slide_w * 0.5 - 0.02, slide_w * 0.5 + 0.02):
            add_box(bms["stainless"], mx + sx, cy, cz + 0.11, 0.04, seg_l, 0.20, rot_x=ang)
    # Slide runout support leg
    add_cylinder(bms["galvanized"], mx, pts_slide[-1][0] + 0.2, -0.15, 0.045, 0.045, 0.72, segments=8)

    # Secondary lower platform (+X side at sx2 = +1.75, sy2 = +0.35, deck2_z = 1.18m)
    sx2, sy2 = 1.85, 0.35
    hw2 = 0.62
    deck2_z = 1.18
    for dx in (-hw2, hw2):
        for dy in (-hw2, hw2):
            add_cylinder(bms["robinia"], sx2 + dx, sy2 + dy, (-0.65 + deck2_z + 0.92) * 0.5, 0.075, 0.072, deck2_z + 1.57, segments=10)
    add_box(bms["robinia"], sx2, sy2, deck2_z - 0.07, 1.32, 1.32, 0.14)
    # Connecting stepped walkway bridge (x from mx+hw=0.27 to sx2-hw2=1.23)
    for s in range(5):
        t = (s + 0.5) / 5.0
        bx = (mx + hw) * (1.0 - t) + (sx2 - hw2) * t
        bz = deck_z * (1.0 - t) + deck2_z * t
        add_box(bms["robinia"], bx, my, bz - 0.04, 0.19, 1.05, 0.06)
    # Bridge safety side ropes
    for side in (-0.52, 0.52):
        add_segment(bms["rope_red"], Vector((mx + hw, my + side, deck_z + 0.72)), Vector((sx2 - hw2, sy2 + side, deck2_z + 0.72)), 0.022, segments=6)

    # Inclined Climbing Wall on West (-X) side of main tower with 14 colorful holds!
    cw_ang = math.radians(-24.0)
    add_box(bms["robinia"], mx - hw - 0.42, my + 0.15, deck_z * 0.45, 0.10, 1.15, 2.15, rot_y=cw_ang)
    for k in range(14):
        row = k // 2
        col_i = k % 2
        tz = 0.25 + row * 0.24
        tx = (mx - hw - 0.80) + tz * math.tan(abs(cw_ang)) - 0.04
        ty = my - 0.22 + col_i * 0.45 + (0.12 if row % 2 else -0.06)
        add_box(bms[picket_cols[k % 4]], tx, ty, tz, 0.08, 0.11, 0.09)

    # Inclined Rope Climbing Net on North (+Y) side of lower platform
    net_top_y, net_top_z = sy2 + hw2, deck2_z
    net_bot_y, net_bot_z = sy2 + hw2 + 1.15, -0.10
    add_segment(bms["robinia"], Vector((sx2 - 0.52, net_top_y, net_top_z)), Vector((sx2 - 0.52, net_bot_y, net_bot_z)), 0.06, segments=8)
    add_segment(bms["robinia"], Vector((sx2 + 0.52, net_top_y, net_top_z)), Vector((sx2 + 0.52, net_bot_y, net_bot_z)), 0.06, segments=8)
    for i in range(5):
        rx = sx2 - 0.42 + i * 0.21
        add_rect_cord(bms["rope_red"], Vector((rx, net_top_y, net_top_z)), Vector((rx, net_bot_y, max(0.05, net_bot_z))), 0.024)
    for j in range(5):
        t = (j + 1) / 6.0
        ry = net_top_y * (1.0 - t) + net_bot_y * t
        rz = net_top_z * (1.0 - t) + max(0.05, net_bot_z) * t
        add_rect_cord(bms["rope_red"], Vector((sx2 - 0.50, ry, rz)), Vector((sx2 + 0.50, ry, rz)), 0.024)

    # Stainless Fireman's Pole (Rutschstange) on East (+X) side of lower platform
    pole_x, pole_y = sx2 + hw2 + 0.45, sy2 - 0.20
    add_segment(bms["stainless"], Vector((sx2 + hw2, pole_y, deck2_z + 0.85)), Vector((pole_x, pole_y, deck2_z + 0.85)), 0.032, segments=8)
    add_cylinder(bms["stainless"], pole_x, pole_y, (-0.45 + deck2_z + 0.88) * 0.5, 0.032, 0.032, deck2_z + 1.33, segments=10)

    # Wooden access ladder on South (-Y) of lower platform
    for side in (-0.34, 0.34):
        add_segment(bms["robinia"], Vector((sx2 + side, sy2 - hw2, deck2_z)), Vector((sx2 + side, sy2 - hw2 - 0.55, -0.30)), 0.045, segments=8)
    for r in range(5):
        t = (r + 0.8) / 5.4
        ry = (sy2 - hw2) - t * 0.52
        rz = deck2_z * (1.0 - t)
        add_segment(bms["paint_yellow"], Vector((sx2 - 0.34, ry, rz)), Vector((sx2 + 0.34, ry, rz)), 0.025, segments=8)

    objs = []
    for k, bm in bms.items():
        if len(bm.verts) == 0:
            bm.free()
            continue
        sm = k in ("stainless", "galvanized")
        objs.append(finalize_rec_mesh(f"Tower_{k}", bm, pal[k], col, 1.4, 1.4, slope_align=(k == "shingle"), smooth=sm))
    export_asset("playground_tower", objs, manifest)


def build_playground_swings(pal, col, manifest):
    """7.2m wide Robinia A-frame Doppelschaukel + Vogelnestschaukel with 3 animated pivot-at-beam child objects."""
    bm_wood = bmesh.new()
    bm_galv = bmesh.new()

    beam_z = 2.65
    leg_xs = (-3.40, 0.85, 3.40)
    leg_spread_y = 1.25

    # 3 A-frame leg pairs (-0.55m skirt up to beam_z)
    for lx in leg_xs:
        for sy in (-leg_spread_y, leg_spread_y):
            add_segment(bm_wood, Vector((lx, sy, -0.55)), Vector((lx, 0.0, beam_z)), 0.078, segments=10)
        # Galvanized apex saddle bracket
        add_box(bm_galv, lx, 0.0, beam_z + 0.04, 0.22, 0.26, 0.22)

    # Heavy top crossbar (steel-clad timber beam)
    add_segment(bm_wood, Vector((-3.75, 0.0, beam_z)), Vector((3.75, 0.0, beam_z)), 0.088, segments=12)

    frame_objs = [
        finalize_rec_mesh("Swings_frame_wood", bm_wood, pal["robinia"], col, 1.5, 1.5, smooth=True),
        finalize_rec_mesh("Swings_frame_galv", bm_galv, pal["galvanized"], col, 1.0, 1.0, smooth=True),
    ]

    # Build 3 child swinging objects whose origins are RIGHT AT THE TOP BEAM (Z = beam_z)!
    def make_standard_swing(obj_name: str, px: float, seat_mat_key: str):
        bm_ch = bmesh.new()
        bm_st = bmesh.new()
        drop = 2.10
        for cx in (-0.24, 0.24):
            add_segment(bm_ch, Vector((cx, 0.0, 0.0)), Vector((cx, 0.0, -drop)), 0.015, segments=6)
        add_box(bm_st, 0.0, 0.0, -drop - 0.02, 0.48, 0.19, 0.048)

        # Merge chain + seat into single object or two objects? Single object with 2 material slots so it rotates as 1 node!
        bmesh.ops.recalc_face_normals(bm_ch, faces=bm_ch.faces)
        bmesh.ops.recalc_face_normals(bm_st, faces=bm_st.faces)
        apply_metric_box_uv(bm_ch, 1.0, 1.0)
        apply_metric_box_uv(bm_st, 0.6, 0.6)

        # Combine into single multi-material mesh
        for f in bm_ch.faces:
            f.material_index = 0
        for f in bm_st.faces:
            f.material_index = 1
        me_tmp = bpy.data.meshes.new("_tmp_st")
        bm_st.to_mesh(me_tmp)
        bm_st.free()
        bm_ch.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)

        mesh = bpy.data.meshes.new(obj_name)
        bm_ch.to_mesh(mesh)
        bm_ch.free()
        obj = bpy.data.objects.new(obj_name, mesh)
        obj.data.materials.append(pal["galvanized"])
        obj.data.materials.append(pal[seat_mat_key])
        obj.location = (px, 0.0, beam_z)
        col.objects.link(obj)
        return obj

    def make_nest_swing(obj_name: str, px: float):
        bm_ch = bmesh.new()
        bm_ring = bmesh.new()
        bm_web = bmesh.new()
        drop = 2.02
        nest_r = 0.56
        # 4 suspension chains meeting at 2 top beam shackles
        for side_x, top_x in [(-1, -0.45), (1, 0.45)]:
            for side_y in (-1, 1):
                p_top = Vector((top_x, 0.0, 0.0))
                p_ring = Vector((side_x * nest_r * 0.70, side_y * nest_r * 0.70, -drop))
                add_segment(bm_ch, p_top, p_ring, 0.015, segments=6)

        # Outer cushioned red/blue ring
        add_torus_ring(bm_ring, Vector((0.0, 0.0, -drop)), nest_r, 0.068, major_segs=22, minor_segs=8)
        # Inner braided rope spiderweb
        for i in range(10):
            a = i * (math.pi / 5.0)
            p0 = Vector((math.cos(a) * nest_r * 0.92, math.sin(a) * nest_r * 0.92, -drop - 0.02))
            p1 = Vector((-math.cos(a) * nest_r * 0.92, -math.sin(a) * nest_r * 0.92, -drop - 0.02))
            add_rect_cord(bm_web, p0, p1, 0.022)
        add_torus_ring(bm_web, Vector((0.0, 0.0, -drop - 0.02)), nest_r * 0.48, 0.022, major_segs=16, minor_segs=6)

        # Combine into 1 object with 3 materials
        parts = [(bm_ch, pal["galvanized"]), (bm_ring, pal["rope_blue"]), (bm_web, pal["rope_red"])]
        master_bm = bmesh.new()
        mesh = bpy.data.meshes.new(obj_name)
        for idx, (pbm, pmat) in enumerate(parts):
            bmesh.ops.recalc_face_normals(pbm, faces=pbm.faces)
            apply_metric_box_uv(pbm, 0.8, 0.8)
            for f in pbm.faces:
                f.material_index = idx
            tme = bpy.data.meshes.new(f"_tmp_nest_{idx}")
            pbm.to_mesh(tme)
            pbm.free()
            master_bm.from_mesh(tme)
            bpy.data.meshes.remove(tme)
            mesh.materials.append(pmat)
        master_bm.to_mesh(mesh)
        master_bm.free()
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.update()

        obj = bpy.data.objects.new(obj_name, mesh)
        obj.location = (px, 0.0, beam_z)
        col.objects.link(obj)
        return obj

    s_left = make_standard_swing("Swing_Left", -2.25, "rubber")
    s_right = make_standard_swing("Swing_Right", -0.45, "rubber")
    s_nest = make_nest_swing("Swing_Nest", 2.15)
    export_asset("playground_swings", frame_objs + [s_left, s_right, s_nest], manifest)


def build_playground_pyramid(pal, col, manifest):
    """3.8m tall Seilnetzpyramide (Space-Net Climber) with steel mast, red finial, 4 anchor cables & braided rope web."""
    bm_steel = bmesh.new()
    bm_finial = bmesh.new()
    bm_red = bmesh.new()
    bm_blue = bmesh.new()

    H = 3.80
    R = 2.55
    add_cylinder(bm_steel, 0.0, 0.0, (-0.60 + H) * 0.5, 0.095, 0.068, H + 0.60, segments=12)
    bmesh.ops.create_uvsphere(bm_finial, u_segments=12, v_segments=8, radius=0.14, matrix=Matrix.Translation((0.0, 0.0, H + 0.05)))

    # 4 corner anchor steel pipes + main ridge ropes
    corners = []
    for k in range(4):
        a = k * (math.pi * 0.5) + math.pi * 0.25
        cx, cy = math.cos(a) * R, math.sin(a) * R
        corners.append((cx, cy))
        add_cylinder(bm_steel, cx, cy, -0.22, 0.05, 0.04, 0.65, segments=8)
        add_rect_cord(bm_blue, Vector((0.0, 0.0, H - 0.15)), Vector((cx, cy, 0.08)), 0.028)

    # Intermediate radial ribs + concentric square rope tiers
    for k in range(4):
        c0 = corners[k]
        c1 = corners[(k + 1) % 4]
        mid = ((c0[0] + c1[0]) * 0.5, (c0[1] + c1[1]) * 0.5)
        add_rect_cord(bm_red, Vector((0.0, 0.0, H - 0.18)), Vector((mid[0], mid[1], 0.14)), 0.022)

    for tier in range(1, 7):
        t = tier / 7.0
        tz = (H - 0.18) * (1.0 - t) + 0.14 * t
        target_bm = bm_red if tier % 2 == 0 else bm_blue
        for k in range(4):
            c0 = corners[k]
            c1 = corners[(k + 1) % 4]
            p0 = Vector((c0[0] * t, c0[1] * t, tz))
            p1 = Vector((c1[0] * t, c1[1] * t, tz))
            add_rect_cord(target_bm, p0, p1, 0.020)

    # Horizontal low net floor ring at Z=0.45
    for k in range(4):
        c0 = corners[k]
        add_rect_cord(bm_red, Vector((0.0, 0.0, 0.55)), Vector((c0[0] * 0.72, c0[1] * 0.72, 0.55)), 0.020)

    objs = [
        finalize_rec_mesh("Pyramid_mast", bm_steel, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("Pyramid_finial", bm_finial, pal["paint_red"], col, 0.5, 0.5, smooth=True),
        finalize_rec_mesh("Pyramid_rope_red", bm_red, pal["rope_red"], col, 0.6, 0.6),
        finalize_rec_mesh("Pyramid_rope_blue", bm_blue, pal["rope_blue"], col, 0.6, 0.6),
    ]
    export_asset("playground_pyramid", objs, manifest)


def build_playground_carousel(pal, col, manifest):
    """Ø 2.2m Drehkarussell with base collar + separate Carousel_Rotor child object."""
    bm_base = bmesh.new()
    add_cylinder(bm_base, 0.0, 0.0, -0.20, 0.42, 0.36, 0.55, segments=14)
    base_obj = finalize_rec_mesh("Carousel_Base", bm_base, pal["galvanized"], col, 1.0, 1.0, smooth=True)

    # Rotor built as multi-material mesh with origin at (0, 0, 0)
    bm_deck = bmesh.new()
    bm_rail = bmesh.new()
    bm_red = bmesh.new()
    bm_blue = bmesh.new()
    bm_yellow = bmesh.new()

    add_cylinder(bm_deck, 0.0, 0.0, 0.14, 1.10, 1.10, 0.08, segments=24)
    add_cylinder(bm_rail, 0.0, 0.0, 0.45, 0.06, 0.06, 0.70, segments=10)
    # Central steering wheel
    add_torus_ring(bm_yellow, Vector((0.0, 0.0, 0.80)), 0.24, 0.026, major_segs=18, minor_segs=6)
    for k in range(3):
        a = k * (2.0 * math.pi / 3.0)
        add_segment(bm_rail, Vector((0.0, 0.0, 0.78)), Vector((math.cos(a) * 0.24, math.sin(a) * 0.24, 0.80)), 0.018, segments=6)

    # 3 colorful curved bench seats + perimeter grab rails
    seat_bms = [bm_red, bm_blue, bm_yellow]
    for k in range(3):
        a_mid = k * (2.0 * math.pi / 3.0)
        sx = math.cos(a_mid) * 0.74
        sy = math.sin(a_mid) * 0.74
        add_box(seat_bms[k], sx, sy, 0.44, 0.44, 0.74, 0.06, rot_z=a_mid)
        for dy in (-0.30, 0.30):
            ax = math.cos(a_mid) * 0.96 - math.sin(a_mid) * dy
            ay = math.sin(a_mid) * 0.96 + math.cos(a_mid) * dy
            add_segment(bm_rail, Vector((ax, ay, 0.18)), Vector((ax, ay, 0.84)), 0.022, segments=8)
        p0 = Vector((math.cos(a_mid) * 0.96 - math.sin(a_mid) * -0.30, math.sin(a_mid) * 0.96 + math.cos(a_mid) * -0.30, 0.84))
        p1 = Vector((math.cos(a_mid) * 0.96 - math.sin(a_mid) * 0.30, math.sin(a_mid) * 0.96 + math.cos(a_mid) * 0.30, 0.84))
        add_segment(bm_rail, p0, p1, 0.024, segments=8)

    parts = [
        (bm_deck, pal["robinia"]),
        (bm_rail, pal["galvanized"]),
        (bm_red, pal["paint_red"]),
        (bm_blue, pal["paint_blue"]),
        (bm_yellow, pal["paint_yellow"]),
    ]
    master = bmesh.new()
    rotor_mesh = bpy.data.meshes.new("Carousel_Rotor")
    for idx, (pbm, pmat) in enumerate(parts):
        bmesh.ops.recalc_face_normals(pbm, faces=pbm.faces)
        apply_metric_box_uv(pbm, 0.8, 0.8)
        for f in pbm.faces:
            f.material_index = idx
        tme = bpy.data.meshes.new(f"_tmp_cr_{idx}")
        pbm.to_mesh(tme)
        pbm.free()
        master.from_mesh(tme)
        bpy.data.meshes.remove(tme)
        rotor_mesh.materials.append(pmat)
    master.to_mesh(rotor_mesh)
    master.free()
    rotor_mesh.polygons.foreach_set("use_smooth", [True] * len(rotor_mesh.polygons))
    rotor_mesh.update()

    rotor_obj = bpy.data.objects.new("Carousel_Rotor", rotor_mesh)
    col.objects.link(rotor_obj)
    export_asset("playground_carousel", [base_obj, rotor_obj], manifest)


def build_playground_seesaw(pal, col, manifest):
    """3.6m Robinia Holzwippe with yellow grab handles, colorful seats & buried black shock tires."""
    bm_wood = bmesh.new()
    bm_galv = bmesh.new()
    bm_yellow = bmesh.new()
    bm_red = bmesh.new()
    bm_tire = bmesh.new()

    # Galvanized fulcrum stand (-0.45m skirt to Z=0.58m)
    add_cylinder(bm_galv, 0.0, 0.0, 0.06, 0.075, 0.075, 1.02, segments=10)
    add_box(bm_galv, 0.0, 0.0, 0.56, 0.24, 0.34, 0.16)

    # Tilted heavy Robinia seesaw beam (8 deg playful tilt)
    tilt = math.radians(8.0)
    beam_mat = Matrix.Translation((0.0, 0.0, 0.58)) @ Matrix.Rotation(tilt, 4, "Y")
    bmesh.ops.create_cube(bm_wood, size=1.0, matrix=beam_mat @ Matrix.Diagonal((3.60, 0.22, 0.16, 1.0)))

    for side, sbm in [(-1.0, bm_red), (1.0, bm_yellow)]:
        sx = side * 1.56
        # Seat cushion & yellow tubular grab handle
        p_seat = beam_mat @ Vector((sx, 0.0, 0.11))
        add_box(sbm, p_seat.x, p_seat.y, p_seat.z, 0.42, 0.28, 0.06, rot_y=tilt)
        hx = side * 1.16
        p_hb = beam_mat @ Vector((hx, 0.0, 0.08))
        p_ht = beam_mat @ Vector((hx, 0.0, 0.44))
        add_segment(bm_yellow, p_hb, p_ht, 0.02, segments=8)
        p_hl = beam_mat @ Vector((hx, -0.18, 0.44))
        p_hr = beam_mat @ Vector((hx, +0.18, 0.44))
        add_segment(bm_yellow, p_hl, p_hr, 0.02, segments=8)

        # Half-buried black rubber shock-absorber tire on ground under each end
        add_torus_ring(bm_tire, Vector((sx, 0.0, 0.04)), 0.24, 0.085, major_segs=16, minor_segs=8, normal_axis="Y")

    objs = [
        finalize_rec_mesh("Seesaw_wood", bm_wood, pal["robinia"], col, 1.2, 1.2),
        finalize_rec_mesh("Seesaw_galv", bm_galv, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("Seesaw_yellow", bm_yellow, pal["paint_yellow"], col, 0.8, 0.8, smooth=True),
        finalize_rec_mesh("Seesaw_red", bm_red, pal["paint_red"], col, 0.8, 0.8),
        finalize_rec_mesh("Seesaw_tires", bm_tire, pal["rubber"], col, 0.8, 0.8, smooth=True),
    ]
    export_asset("playground_seesaw", objs, manifest)


def build_spring_riders(pal, col, manifest):
    """Mini Kindenheim red/yellow tractor Federwipptier & blue/wood horse Federwipptier."""
    # 1. Tractor spring rider
    bm_conc = bmesh.new()
    bm_spring = bmesh.new()
    bm_red = bmesh.new()
    bm_yellow = bmesh.new()
    bm_black = bmesh.new()

    add_cylinder(bm_conc, 0.0, 0.0, -0.18, 0.22, 0.20, 0.44, segments=10)
    # Coiled heavy spring rings
    for i in range(6):
        add_torus_ring(bm_spring, Vector((0.0, 0.0, 0.06 + i * 0.058)), 0.11, 0.022, major_segs=14, minor_segs=6)
    # Mini red tractor body (facing -Y)
    add_box(bm_red, 0.0, 0.02, 0.56, 0.42, 0.92, 0.34)
    add_box(bm_red, 0.0, -0.26, 0.76, 0.34, 0.40, 0.18)  # Hood
    add_box(bm_yellow, 0.0, 0.26, 0.78, 0.42, 0.32, 0.12)  # Seat back
    # Painted yellow wheel discs + black tread
    for sx in (-0.23, 0.23):
        add_cylinder(bm_black, sx, 0.22, 0.46, 0.17, 0.17, 0.08, segments=12, rot_y=math.pi * 0.5)
        add_cylinder(bm_yellow, sx * 1.05, 0.22, 0.46, 0.10, 0.10, 0.09, segments=12, rot_y=math.pi * 0.5)
        add_cylinder(bm_black, sx, -0.28, 0.42, 0.12, 0.12, 0.07, segments=12, rot_y=math.pi * 0.5)
    # Exhaust pipe & handlebars
    add_cylinder(bm_black, -0.10, -0.34, 0.96, 0.022, 0.022, 0.24, segments=8)
    add_segment(bm_yellow, Vector((-0.24, -0.14, 0.88)), Vector((0.24, -0.14, 0.88)), 0.02, segments=6)

    objs = [
        finalize_rec_mesh("RiderTr_conc", bm_conc, pal["concrete_plinth"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("RiderTr_spring", bm_spring, pal["paint_yellow"], col, 0.6, 0.6, smooth=True),
        finalize_rec_mesh("RiderTr_red", bm_red, pal["paint_red"], col, 0.8, 0.8),
        finalize_rec_mesh("RiderTr_yellow", bm_yellow, pal["paint_yellow"], col, 0.8, 0.8, smooth=True),
        finalize_rec_mesh("RiderTr_black", bm_black, pal["rubber"], col, 0.8, 0.8, smooth=True),
    ]
    export_asset("spring_rider_tractor", objs, manifest)

    # 2. Horse / pony spring rider
    bm_conc = bmesh.new()
    bm_spring = bmesh.new()
    bm_blue = bmesh.new()
    bm_wood = bmesh.new()
    bm_red = bmesh.new()

    add_cylinder(bm_conc, 0.0, 0.0, -0.18, 0.22, 0.20, 0.44, segments=10)
    for i in range(6):
        add_torus_ring(bm_spring, Vector((0.0, 0.0, 0.06 + i * 0.058)), 0.11, 0.022, major_segs=14, minor_segs=6)
    add_box(bm_blue, 0.0, 0.05, 0.56, 0.34, 0.86, 0.30)
    add_box(bm_blue, 0.0, -0.30, 0.84, 0.20, 0.28, 0.40, rot_x=math.radians(20))
    add_box(bm_blue, 0.0, -0.44, 0.96, 0.18, 0.28, 0.18, rot_x=math.radians(-16))
    add_box(bm_wood, 0.0, 0.12, 0.72, 0.36, 0.34, 0.06)
    add_segment(bm_red, Vector((-0.22, -0.24, 0.92)), Vector((0.22, -0.24, 0.92)), 0.02, segments=6)

    objs2 = [
        finalize_rec_mesh("RiderHo_conc", bm_conc, pal["concrete_plinth"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("RiderHo_spring", bm_spring, pal["paint_red"], col, 0.6, 0.6, smooth=True),
        finalize_rec_mesh("RiderHo_blue", bm_blue, pal["paint_blue"], col, 0.8, 0.8),
        finalize_rec_mesh("RiderHo_wood", bm_wood, pal["robinia"], col, 0.8, 0.8),
        finalize_rec_mesh("RiderHo_red", bm_red, pal["paint_red"], col, 0.6, 0.6, smooth=True),
    ]
    export_asset("spring_rider_horse", objs2, manifest)


def build_sandpit_toys(pal, col, manifest):
    """Sandbagger swivel excavator + wooden Matschtisch with pulley & bucket + sand bucket/shovel."""
    bm_galv = bmesh.new()
    bm_yellow = bmesh.new()
    bm_red = bmesh.new()
    bm_blue = bmesh.new()
    bm_wood = bmesh.new()

    # 1. Sandbagger at (-1.1, 0.0)
    bx, by = -1.10, 0.0
    add_cylinder(bm_galv, bx, by, -0.10, 0.07, 0.07, 0.72, segments=10)
    add_box(bm_red, bx, by + 0.10, 0.42, 0.34, 0.36, 0.06)
    add_segment(bm_yellow, Vector((bx, by - 0.10, 0.42)), Vector((bx, by - 0.75, 1.02)), 0.036, segments=8)
    add_segment(bm_yellow, Vector((bx, by - 0.75, 1.02)), Vector((bx, by - 1.15, 0.48)), 0.030, segments=8)
    add_box(bm_red, bx, by - 1.22, 0.38, 0.24, 0.26, 0.18)
    # Dual control levers
    for lx in (-0.12, 0.12):
        add_segment(bm_galv, Vector((bx + lx, by - 0.12, 0.44)), Vector((bx + lx, by - 0.18, 0.76)), 0.014, segments=6)

    # 2. Wooden Matschtisch at (+1.05, 0.25)
    mx, my = 1.05, 0.25
    for dx in (-0.52, 0.52):
        for dy in (-0.32, 0.32):
            h = 1.75 if dy > 0 else 0.72
            add_cylinder(bm_wood, mx + dx, my + dy, (-0.45 + h) * 0.5, 0.055, 0.05, h + 0.45, segments=8)
    add_box(bm_wood, mx, my, 0.62, 1.20, 0.74, 0.08)
    add_box(bm_wood, mx, my, 0.32, 1.04, 0.58, 0.06)
    # Pulley beam & hanging red bucket
    add_box(bm_wood, mx, my + 0.32, 1.74, 1.20, 0.10, 0.10)
    add_segment(bm_galv, Vector((mx, my + 0.26, 1.70)), Vector((mx, my + 0.26, 1.18)), 0.012, segments=6)
    add_cylinder(bm_red, mx, my + 0.26, 1.06, 0.11, 0.15, 0.24, segments=10)

    # 3. Play sand bucket + blue shovel on sand at (0.05, -0.45)
    add_cylinder(bm_blue, 0.05, -0.45, 0.12, 0.10, 0.14, 0.24, segments=10)
    add_box(bm_yellow, 0.34, -0.40, 0.04, 0.12, 0.46, 0.03, rot_z=0.4)

    objs = [
        finalize_rec_mesh("SandToys_galv", bm_galv, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("SandToys_yellow", bm_yellow, pal["paint_yellow"], col, 0.8, 0.8, smooth=True),
        finalize_rec_mesh("SandToys_red", bm_red, pal["paint_red"], col, 0.8, 0.8, smooth=True),
        finalize_rec_mesh("SandToys_blue", bm_blue, pal["paint_blue"], col, 0.8, 0.8, smooth=True),
        finalize_rec_mesh("SandToys_wood", bm_wood, pal["robinia"], col, 1.2, 1.2, smooth=True),
    ]
    export_asset("playground_sandpit_toys", objs, manifest)


def build_playground_pavilion(pal, col, manifest):
    """4.0m x 3.2m open 4-post Robinia Spielplatz-Pavillon with dark slate hipped roof & picnic table."""
    bm_wood = bmesh.new()
    bm_slate = bmesh.new()
    bm_conc = bmesh.new()

    L, D = 4.0, 3.2
    eave_z = 2.38
    for sx in (-L * 0.5 + 0.22, L * 0.5 - 0.22):
        for sy in (-D * 0.5 + 0.22, D * 0.5 - 0.22):
            add_cylinder(bm_wood, sx, sy, (-0.60 + eave_z + 0.08) * 0.5, 0.095, 0.088, eave_z + 0.68, segments=10)
            add_cylinder(bm_conc, sx, sy, -0.26, 0.16, 0.15, 0.60, segments=10)

    # Perimeter timber ring beams
    add_box(bm_wood, 0.0, -D * 0.5 + 0.22, eave_z, L - 0.24, 0.16, 0.20)
    add_box(bm_wood, 0.0, +D * 0.5 - 0.22, eave_z, L - 0.24, 0.16, 0.20)
    add_box(bm_wood, -L * 0.5 + 0.22, 0.0, eave_z, 0.16, D - 0.24, 0.20)
    add_box(bm_wood, +L * 0.5 - 0.22, 0.0, eave_z, 0.16, D - 0.24, 0.20)

    # Dark slate hipped roof matching DOP20 dark pavilion pad!
    add_pitched_roof_solid(
        bm_slate, 0.0, 0.0, eave_z + 0.08,
        length_x=L, width_y=D, ridge_h=1.18,
        overhang_x=0.36, overhang_y=0.36, thickness=0.18, hip_x=1.25,
    )
    add_ridge_cap(bm_slate, Vector((-0.75, 0.0, eave_z + 1.32)), Vector((0.75, 0.0, eave_z + 1.32)), radius=0.11)

    # Integrated heavy wooden picnic table & benches inside pavilion
    add_box(bm_wood, 0.0, 0.0, 0.74, 2.20, 0.82, 0.07)
    for lx in (-0.82, 0.82):
        add_box(bm_wood, lx, 0.0, 0.36, 0.12, 1.56, 0.12)
        add_box(bm_wood, lx, -0.28, 0.36, 0.10, 0.10, 0.72, rot_x=math.radians(24))
        add_box(bm_wood, lx, +0.28, 0.36, 0.10, 0.10, 0.72, rot_x=math.radians(-24))
    for side in (-0.68, 0.68):
        add_box(bm_wood, 0.0, side, 0.45, 2.20, 0.30, 0.06)

    objs = [
        finalize_rec_mesh("Pavilion_wood", bm_wood, pal["robinia"], col, 1.4, 1.4, smooth=True),
        finalize_rec_mesh("Pavilion_roof", bm_slate, pal["roof_slate"], col, 1.6, 1.6, slope_align=True),
        finalize_rec_mesh("Pavilion_conc", bm_conc, pal["concrete_plinth"], col, 1.0, 1.0, smooth=True),
    ]
    export_asset("playground_pavilion", objs, manifest)


def build_tischtennisplatte(pal, col, manifest):
    """Regulation German Beton-Tischtennisplatte (2.74m x 1.525m x 0.76m) with white-lined slab & steel net."""
    bm_top = bmesh.new()
    bm_conc = bmesh.new()
    bm_net = bmesh.new()

    L, W, H = 2.74, 1.525, 0.76
    # Concrete slab base (0.68..0.755) + single top court surface quad at Z=0.761
    add_box(bm_conc, 0.0, 0.0, H - 0.045, L, W, 0.08)
    v0 = bm_top.verts.new((-L * 0.5, -W * 0.5, H + 0.002))
    v1 = bm_top.verts.new((+L * 0.5, -W * 0.5, H + 0.002))
    v2 = bm_top.verts.new((+L * 0.5, +W * 0.5, H + 0.002))
    v3 = bm_top.verts.new((-L * 0.5, +W * 0.5, H + 0.002))
    bm_top.faces.new([v0, v1, v2, v3])

    # Solid concrete leg panels (-0.45m skirt to underside of slab)
    for lx in (-0.90, 0.90):
        add_box(bm_conc, lx, 0.0, (-0.45 + H - 0.08) * 0.5, 0.14, 1.08, H + 0.37)
    add_box(bm_conc, 0.0, 0.0, 0.36, 1.80, 0.12, 0.24)

    # Perforated galvanized steel net across center X=0
    add_box(bm_net, 0.0, 0.0, H + 0.076, 0.025, W + 0.04, 0.15)

    objs = [
        finalize_rec_mesh("PingPong_conc", bm_conc, pal["concrete_terrace"], col, 1.5, 1.5),
        finalize_rec_mesh("PingPong_top", bm_top, pal["tischtennis_top"], col, 1.0, 1.0, fit_uv=True),
        finalize_rec_mesh("PingPong_net", bm_net, pal["galvanized"], col, 0.5, 0.5),
    ]
    export_asset("tischtennisplatte", objs, manifest)


# ---------------------------------------------------------------------------
# SHARED PARK FURNITURE PROPS
# ---------------------------------------------------------------------------

def build_park_bench(pal, col, manifest):
    """1.8m wooden-slat & dark cast-iron/steel park bench facing -Y."""
    bm_wood = bmesh.new()
    bm_iron = bmesh.new()
    for lx in (-0.72, 0.72):
        add_box(bm_iron, lx, 0.0, (-0.35 + 0.43) * 0.5, 0.06, 0.48, 0.78)
        add_box(bm_iron, lx, 0.24, 0.64, 0.05, 0.06, 0.46, rot_x=math.radians(14))
        add_box(bm_iron, lx, -0.02, 0.60, 0.05, 0.46, 0.05)  # Armrest
    for sy in (-0.16, -0.02, 0.12):
        add_box(bm_wood, 0.0, sy, 0.45, 1.80, 0.11, 0.04)
    for sz in (0.62, 0.78):
        add_box(bm_wood, 0.0, 0.21 + (sz - 0.62) * 0.22, sz, 1.80, 0.04, 0.12, rot_x=math.radians(14))

    objs = [
        finalize_rec_mesh("Bench_wood", bm_wood, pal["robinia"], col, 1.0, 1.0),
        finalize_rec_mesh("Bench_iron", bm_iron, pal["iron_dark"], col, 0.8, 0.8),
    ]
    export_asset("park_bench", objs, manifest)


def build_trash_bin(pal, col, manifest):
    """Dark-green/orange hooded municipal park trash bin on galvanized post."""
    bm_galv = bmesh.new()
    bm_green = bmesh.new()
    bm_red = bmesh.new()
    add_cylinder(bm_galv, 0.0, 0.0, 0.32, 0.032, 0.032, 1.44, segments=8)
    add_cylinder(bm_green, 0.0, -0.14, 0.68, 0.16, 0.18, 0.56, segments=12)
    add_cylinder(bm_red, 0.0, -0.14, 1.02, 0.19, 0.10, 0.14, segments=12)

    objs = [
        finalize_rec_mesh("Bin_post", bm_galv, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("Bin_body", bm_green, pal["paint_green"], col, 0.8, 0.8, smooth=True),
        finalize_rec_mesh("Bin_hood", bm_red, pal["paint_red"], col, 0.8, 0.8, smooth=True),
    ]
    export_asset("trash_bin", objs, manifest)


def build_spielplatz_sign(pal, col, manifest):
    """Galvanized municipal signpost with blue/white Kinderspielplatz sign plaque facing -Y."""
    bm_galv = bmesh.new()
    bm_face = bmesh.new()
    add_cylinder(bm_galv, 0.0, 0.0, 0.90, 0.038, 0.038, 2.70, segments=10)
    add_box(bm_galv, 0.0, -0.02, 1.90, 0.74, 0.04, 0.74)
    add_front_quad(bm_face, 0.0, -0.043, 1.90, 0.70, 0.70)

    objs = [
        finalize_rec_mesh("Sign_post", bm_galv, pal["galvanized"], col, 1.0, 1.0, smooth=True),
        finalize_rec_mesh("Sign_face", bm_face, pal["spielplatz_sign"], col, 1.0, 1.0, fit_uv=True),
    ]
    export_asset("spielplatz_sign", objs, manifest)


def main():
    print("=== Building Kindenheim Recreation 3D Assets (Blender 5.2) ===")
    clear_scene()
    pal = get_palette()
    manifest_models = {}

    builders = [
        ("Sportheim", lambda c: build_sportheim(pal, c, manifest_models)),
        ("Terrace", lambda c: build_terrace(pal, c, manifest_models)),
        ("GoalFull", lambda c: build_soccer_goal("soccer_goal_full", 7.32, 2.44, 2.00, 1.00, pal, c, manifest_models)),
        ("GoalMini", lambda c: build_soccer_goal("soccer_goal_mini", 5.00, 2.00, 1.45, 0.85, pal, c, manifest_models)),
        ("FloodlightMast", lambda c: build_floodlight_mast(pal, c, manifest_models)),
        ("DugoutBench", lambda c: build_dugout_bench(pal, c, manifest_models)),
        ("Scoreboard", lambda c: build_scoreboard(pal, c, manifest_models)),
        ("PlaygroundTower", lambda c: build_playground_tower(pal, c, manifest_models)),
        ("PlaygroundSwings", lambda c: build_playground_swings(pal, c, manifest_models)),
        ("PlaygroundPyramid", lambda c: build_playground_pyramid(pal, c, manifest_models)),
        ("PlaygroundCarousel", lambda c: build_playground_carousel(pal, c, manifest_models)),
        ("PlaygroundSeesaw", lambda c: build_playground_seesaw(pal, c, manifest_models)),
        ("SpringRiders", lambda c: build_spring_riders(pal, c, manifest_models)),
        ("SandpitToys", lambda c: build_sandpit_toys(pal, c, manifest_models)),
        ("PlaygroundPavilion", lambda c: build_playground_pavilion(pal, c, manifest_models)),
        ("Tischtennisplatte", lambda c: build_tischtennisplatte(pal, c, manifest_models)),
        ("ParkBench", lambda c: build_park_bench(pal, c, manifest_models)),
        ("TrashBin", lambda c: build_trash_bin(pal, c, manifest_models)),
        ("SpielplatzSign", lambda c: build_spielplatz_sign(pal, c, manifest_models)),
    ]

    for idx, (col_name, fn) in enumerate(builders):
        col = ensure_collection(col_name)
        fn(col)
        # Keep archive blend cleanly arranged along X for easy inspection in Blender GUI
        shift_x = idx * 14.0
        for obj in col.objects:
            obj.location.x += shift_x

    # Pack textures & save .blend archive
    try:
        bpy.ops.file.pack_all()
    except Exception as e:
        print(f"Warning pack_all: {e}")
    BLEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))

    MANIFEST_OUT.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "coordinateSystem": "Three.js Y-up meters (+X East, +Y Up, +Z South / Blender -Y)",
        "models": manifest_models,
    }
    with open(MANIFEST_OUT, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"Wrote manifest: {MANIFEST_OUT} ({len(manifest_models)} models)")


if __name__ == "__main__":
    main()
