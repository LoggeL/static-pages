#!/usr/bin/env python3
"""
Blender 5.2 Corn / Maize Field (Maisfeld) Row Bay Builder for Kindenheim (Rheinland-Pfalz).

Builds and exports a botanically realistic, GPU-instancing-ready July/August Pfalz maize row bay:
  - public/assets/models/fields/corn/crop_corn_row.glb
      * ~6.0m long along local +X ([-3.0, +3.0]) for seamless row tiling (alongRowM = 6.0)
      * ~2.4m wide across 3 parallel planting ridges at exact 0.75m spacing (betweenBaysM = 2.4)
      * Height ~2.1m to branching golden-tan tassel tips (Fahnen)
      * -0.25m underground root skirt so zero stalks float on Kindenheim slopes
      * 180 triangles (single merged mesh, single PBR material -> 1 draw call per InstancedMesh!)
      * Physically clean smooth mesh normals (zero backface shadow-terminator blackening!)
      * glTF alphaMode: "MASK", doubleSided: true, 0 external URIs, <400 KB
  - public/assets/models/fields/corn/meta.json
  - blender/fields/corn/crop_corn_row.blend
  - Optional sunlit 1280x720 Cycles showcase render (--render <png_path>)
  - Optional aerial diagnostic render (--aerial <png_path>)
"""

import argparse
import json
import math
import os
import random
import struct
import sys

import bpy
import bmesh
from mathutils import Euler, Vector

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
CORN_BLENDER_DIR = os.path.join(PROJECT_ROOT, "blender/fields/corn")
TEX_DIR = os.path.join(CORN_BLENDER_DIR, "textures")
BLEND_OUT = os.path.join(CORN_BLENDER_DIR, "crop_corn_row.blend")
OUT_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/fields/corn")
GLB_OUT = os.path.join(OUT_DIR, "crop_corn_row.glb")
META_OUT = os.path.join(OUT_DIR, "meta.json")

os.makedirs(CORN_BLENDER_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

# 5-Panel Zero-Crop Atlas UV regions (matching generate_corn_textures.py v3, inset by 3px)
UV_STAND_LONG = (0.003, 0.437, 0.342, 0.997)  # 2.0m longitudinal stand
UV_STAND_X1   = (0.461, 0.716, 0.342, 0.997)  # 1.0m cross-baffle cluster var 1
UV_STAND_X2   = (0.741, 0.997, 0.342, 0.997)  # 1.0m cross-baffle cluster var 2
UV_CROWN_C    = (0.003, 0.487, 0.003, 0.317)  # overhead crown rosette var 1
UV_CROWN_D    = (0.513, 0.997, 0.003, 0.317)  # overhead crown rosette var 2


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_packed_image(path: str, colorspace: str = "sRGB"):
    img = bpy.data.images.load(path, check_existing=True)
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    img.pack()
    return img


def make_corn_material():
    """
    Create Blender 5.2 PBR foliage material exporting cleanly to glTF 2.0 as:
      - alphaMode: "MASK", alphaCutoff: 0.5
      - doubleSided: true
      - Natural satin-matte botanical roughness (0.68) + restrained specular (0.28)
      - Embedded 1024x1024 RGBA albedo PNG + 512x512 tangent normal JPG (0 external URIs)
    """
    mat = bpy.data.materials.new(name="Corn_Maize_Mat")
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.68
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.28

    albedo_path = os.path.join(TEX_DIR, "corn_maize_albedo.png")
    normal_path = os.path.join(TEX_DIR, "corn_maize_normal.jpg")

    tex_albedo = nodes.new("ShaderNodeTexImage")
    tex_albedo.image = load_packed_image(albedo_path, "sRGB")
    tex_albedo.extension = "CLIP"
    links.new(tex_albedo.outputs["Color"], bsdf.inputs["Base Color"])

    # Blender 5.x + glTF exporter maps ShaderNodeMath(ROUND) on Alpha -> alphaMode: "MASK"
    math_round = nodes.new("ShaderNodeMath")
    math_round.operation = "ROUND"
    links.new(tex_albedo.outputs["Alpha"], math_round.inputs[0])
    links.new(math_round.outputs["Value"], bsdf.inputs["Alpha"])
    mat.alpha_threshold = 0.45

    if os.path.exists(normal_path):
        tex_norm = nodes.new("ShaderNodeTexImage")
        tex_norm.image = load_packed_image(normal_path, "Non-Color")
        tex_norm.extension = "CLIP"
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 0.72
        links.new(tex_norm.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    mat.use_backface_culling = False
    return mat


def add_vertical_2seg_card(
    bm: bmesh.types.BMesh,
    uv_layer,
    center_xy: tuple,
    width: float,
    z_bot: float,
    z_mid: float,
    z_top: float,
    yaw_rad: float,
    mid_bow: float,
    top_lean: float,
    uv_rect: tuple,
    flip_u: bool = False,
):
    """Add a gently bowed 2-vertical-segment maize stand card (2 quads = 4 tris)."""
    cx, cy = center_xy
    u0, u1, v0, v1 = uv_rect
    if flip_u:
        u0, u1 = u1, u0
    v_mid = v0 + (v1 - v0) * ((z_mid - z_bot) / max(1e-4, (z_top - z_bot)))

    tx = math.cos(yaw_rad)
    ty = math.sin(yaw_rad)
    nx = -ty
    ny = tx
    hw = width * 0.5

    def make_pt(s, z, offset_n):
        return Vector((cx + tx * s + nx * offset_n, cy + ty * s + ny * offset_n, z))

    v_bl = bm.verts.new(make_pt(-hw, z_bot, 0.0))
    v_br = bm.verts.new(make_pt(+hw, z_bot, 0.0))
    v_ml = bm.verts.new(make_pt(-hw, z_mid, mid_bow))
    v_mr = bm.verts.new(make_pt(+hw, z_mid, mid_bow))
    v_tl = bm.verts.new(make_pt(-hw, z_top, top_lean))
    v_tr = bm.verts.new(make_pt(+hw, z_top, top_lean))

    q_bot = bm.faces.new((v_bl, v_br, v_mr, v_ml))
    for lp, uv in zip(q_bot.loops, ((u0, v0), (u1, v0), (u1, v_mid), (u0, v_mid))):
        lp[uv_layer].uv = uv

    q_top = bm.faces.new((v_ml, v_mr, v_tr, v_tl))
    for lp, uv in zip(q_top.loops, ((u0, v_mid), (u1, v_mid), (u1, v1), (u0, v1))):
        lp[uv_layer].uv = uv


def add_soft_cupped_canopy_card(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: Vector,
    length_x: float,
    width_y: float,
    cup_drop: float,
    pitch_rad: float,
    roll_rad: float,
    yaw_rad: float,
    uv_rect: tuple,
    flip_u: bool = False,
    flip_v: bool = False,
):
    """
    Add a gently cupped, organically tilted 2-quad foliage crown cluster (4 tris) folded
    softly across X (instead of a straight ridge crease along X!) so it NEVER creates a
    horizontal awning/roof line from eye level while filling aerial views cleanly!
    """
    u0, u1, v0, v1 = uv_rect
    if flip_u:
        u0, u1 = u1, u0
    if flip_v:
        v0, v1 = v1, v0
    u_mid = (u0 + u1) * 0.5

    rot = Euler((roll_rad, pitch_rad, yaw_rad), "XYZ").to_matrix()
    hl = length_x * 0.5
    hw = width_y * 0.5

    # Soft longitudinal arch along X (ends droop slightly like overarching leaves; zero straight crease along row!)
    pts_local = [
        Vector((-hl, -hw, -cup_drop)),
        Vector((0.0, -hw, +cup_drop * 0.25)),
        Vector((+hl, -hw, -cup_drop)),
        Vector((-hl, +hw, -cup_drop)),
        Vector((0.0, +hw, +cup_drop * 0.25)),
        Vector((+hl, +hw, -cup_drop)),
    ]
    verts = [bm.verts.new(center + rot @ p) for p in pts_local]

    q1 = bm.faces.new((verts[0], verts[1], verts[4], verts[3]))
    for lp, uv in zip(q1.loops, ((u0, v0), (u_mid, v0), (u_mid, v1), (u0, v1))):
        lp[uv_layer].uv = uv

    q2 = bm.faces.new((verts[1], verts[2], verts[5], verts[4]))
    for lp, uv in zip(q2.loops, ((u_mid, v0), (u1, v0), (u1, v1), (u_mid, v1))):
        lp[uv_layer].uv = uv


def add_mid_frond_card(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: Vector,
    length_x: float,
    width_y: float,
    roll_rad: float,
    pitch_rad: float,
    yaw_rad: float,
    uv_rect: tuple,
    flip_u: bool = False,
):
    """Add an angled outward-drooping mid-tier frond cluster (1 quad = 2 tris)."""
    u0, u1, v0, v1 = uv_rect
    if flip_u:
        u0, u1 = u1, u0
    rot = Euler((roll_rad, pitch_rad, yaw_rad), "XYZ").to_matrix()
    hl = length_x * 0.5
    hw = width_y * 0.5

    pts_local = [
        Vector((-hl, -hw, 0.0)),
        Vector((+hl, -hw, 0.0)),
        Vector((+hl, +hw, 0.0)),
        Vector((-hl, +hw, 0.0)),
    ]
    verts = [bm.verts.new(center + rot @ p) for p in pts_local]
    f = bm.faces.new(verts)
    for lp, uv in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        lp[uv_layer].uv = uv


def build_corn_row_bay(collection):
    """
    Build the single merged GPU-instancing-ready `Crop_Corn_Row` mesh:
      - 3 parallel planting ridges at Y = -0.75, 0.00, +0.75 (exact 0.75m Reihenabstand)
      - Seamless 6.0m length along local +X (X in [-3.0, +3.0])
      - ~2.4m total foliage breadth across Y ([-1.20, +1.20])
      - Height ~2.1m above ground, -0.25m underground root skirt
      - Exactly 180 triangles (36 longitudinal + 72 cross-baffle + 48 staggered crowns + 24 mid fronds)
      - Physically clean geometric smooth normals (zero dark shadow-terminator bugs!)
    """
    rng = random.Random(202608)
    mat_corn = make_corn_material()

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    ridge_ys = (-0.75, 0.00, 0.75)
    z_bot = -0.25

    for r_idx, ry in enumerate(ridge_ys):
        # ------------------------------------------------------------------
        # 1. Longitudinal undulating row-spine cards: 3 per ridge (12 tris/ridge -> 36 tris)
        # ------------------------------------------------------------------
        seg_centers_x = (-1.98, 0.00, +1.98)
        for s_idx, cx in enumerate(seg_centers_x):
            flip_u = ((r_idx + s_idx) % 2 == 1)
            yaw = math.radians(rng.uniform(-4.5, 4.5))
            card_w = 2.00 if s_idx in (0, 2) else 2.06
            cy = ry + rng.uniform(-0.025, 0.025)
            z_mid = rng.uniform(0.90, 1.02)
            z_top = rng.uniform(2.04, 2.13)
            mid_bow = rng.uniform(-0.035, 0.035)
            top_lean = mid_bow * 1.4 + rng.uniform(-0.04, 0.04)

            add_vertical_2seg_card(
                bm, uv_layer,
                center_xy=(cx, cy),
                width=card_w,
                z_bot=z_bot, z_mid=z_mid, z_top=z_top,
                yaw_rad=yaw, mid_bow=mid_bow, top_lean=top_lean,
                uv_rect=UV_STAND_LONG, flip_u=flip_u,
            )

        # ------------------------------------------------------------------
        # 2. Dedicated zero-crop angled cross-baffles: 6 per ridge (24 tris/ridge -> 72 tris)
        #    Alternating +-48..60 deg yaw fills every viewing angle with lush 3D stalks,
        #    arching leaves, corn cobs + silk & tassels while keeping exact ~2.40m bay width!
        # ------------------------------------------------------------------
        baffle_xs = (-2.44, -1.48, -0.50, +0.50, +1.48, +2.44)
        for b_idx, bx in enumerate(baffle_xs):
            uv_panel = UV_STAND_X1 if ((r_idx + b_idx) % 2 == 0) else UV_STAND_X2
            flip_u = ((b_idx // 2 + r_idx) % 2 == 1)

            sign = 1.0 if ((b_idx + r_idx) % 2 == 0) else -1.0
            yaw_deg = sign * rng.uniform(44.0, 56.0)
            card_w = rng.uniform(0.92, 0.98)
            bx_j = bx + rng.uniform(-0.04, 0.04)
            cy = ry + rng.uniform(-0.02, 0.02)
            z_mid = rng.uniform(0.88, 1.00)
            z_top = rng.uniform(2.00, 2.13)
            mid_bow = rng.uniform(-0.035, 0.035)
            top_lean = mid_bow * 1.4 + rng.uniform(-0.04, 0.04)

            add_vertical_2seg_card(
                bm, uv_layer,
                center_xy=(bx_j, cy),
                width=card_w,
                z_bot=z_bot, z_mid=z_mid, z_top=z_top,
                yaw_rad=math.radians(yaw_deg),
                mid_bow=mid_bow, top_lean=top_lean,
                uv_rect=uv_panel, flip_u=flip_u,
            )

        # ------------------------------------------------------------------
        # 3. Staggered organic canopy-rosette clusters: 4 per ridge (16 tris/ridge -> 48 tris)
        #    Varied heights (Z = 1.08..1.52m) + alternating roll/yaw so there is ZERO
        #    horizontal shelf/roof line at tractor eye height, yet aerial views show
        #    dense, crisp green maize ridges separated by dark furrows!
        # ------------------------------------------------------------------
        crown_specs = [
            (-2.22, 1.18, +22.0, +9.0),
            (-0.74, 1.48, -26.0, -10.0),
            (+0.74, 1.14, +25.0, +10.0),
            (+2.22, 1.46, -23.0, -9.0),
        ]
        for c_idx, (cx, base_z, base_roll, base_yaw) in enumerate(crown_specs):
            panel = UV_CROWN_C if ((r_idx + c_idx) % 2 == 0) else UV_CROWN_D
            flip_u = (c_idx % 2 == 1)
            flip_v = ((r_idx + c_idx) % 3 == 0)

            z_shift = 0.14 if (r_idx == 1 and c_idx % 2 == 0) else (-0.12 if (r_idx == 1 and c_idx % 2 == 1) else 0.0)
            cz = base_z + z_shift + rng.uniform(-0.05, 0.05)
            cy = ry + rng.uniform(-0.025, 0.025)
            add_soft_cupped_canopy_card(
                bm, uv_layer,
                center=Vector((cx, cy, cz)),
                length_x=1.40,
                width_y=rng.uniform(0.58, 0.64),
                cup_drop=rng.uniform(0.14, 0.22),
                pitch_rad=math.radians(rng.uniform(-9.0, 9.0)),
                roll_rad=math.radians(base_roll + rng.uniform(-5.0, 5.0)),
                yaw_rad=math.radians(base_yaw + rng.uniform(-4.0, 4.0)),
                uv_rect=panel, flip_u=flip_u, flip_v=flip_v,
            )

        # ------------------------------------------------------------------
        # 4. Mid-tier drooping frond cards: 4 per ridge (8 tris/ridge -> 24 tris)
        #    Tucked at Z = 0.76..1.05m angled 32..44 deg outward for lush mid-stalk depth!
        # ------------------------------------------------------------------
        frond_xs = (-2.12, -0.70, +0.70, +2.12)
        for f_idx, fx in enumerate(frond_xs):
            panel = UV_CROWN_D if ((r_idx + f_idx) % 2 == 0) else UV_CROWN_C
            side = -1.0 if ((f_idx + r_idx) % 2 == 0) else 1.0
            fz = rng.uniform(0.76, 1.04)
            fy = ry + side * rng.uniform(0.03, 0.07)
            add_mid_frond_card(
                bm, uv_layer,
                center=Vector((fx, fy, fz)),
                length_x=1.32,
                width_y=0.52,
                roll_rad=math.radians(side * rng.uniform(32.0, 44.0)),
                pitch_rad=math.radians(rng.uniform(-7.0, 7.0)),
                yaw_rad=math.radians(rng.uniform(-8.0, 8.0)),
                uv_rect=panel, flip_u=(f_idx % 2 == 0),
            )

    mesh = bpy.data.meshes.new("Crop_Corn_Row")
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    # Use physically valid smooth mesh normals (zero backface shadow-terminator blackening!)
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(mat_corn)

    obj = bpy.data.objects.new("Crop_Corn_Row", mesh)
    collection.objects.link(obj)
    return obj


def export_glb(obj, glb_path: str):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_draco_mesh_compression_enable=False,
    )


def verify_glb_binary(glb_path: str):
    with open(glb_path, "rb") as f:
        data = f.read()

    magic, version, length = struct.unpack("<4sII", data[:12])
    assert magic == b"glTF" and version == 2, f"Invalid GLB header: {magic} v{version}"
    chunk_len, chunk_type = struct.unpack("<I4s", data[12:20])
    assert chunk_type == b"JSON", f"Expected JSON chunk, got {chunk_type}"
    gltf = json.loads(data[20 : 20 + chunk_len].decode("utf-8"))

    images = gltf.get("images", [])
    external_uris = [im.get("uri") for im in images if im.get("uri")]
    assert len(external_uris) == 0, f"Found external image URIs: {external_uris}"

    materials = gltf.get("materials", [])
    assert len(materials) == 1
    m0 = materials[0]
    alpha_mode = m0.get("alphaMode")
    alpha_cutoff = m0.get("alphaCutoff", 0.5)
    double_sided = m0.get("doubleSided", False)
    assert alpha_mode == "MASK", f"Expected alphaMode='MASK', got {alpha_mode}"
    assert double_sided is True, f"Expected doubleSided=True, got {double_sided}"

    accessors = gltf.get("accessors", [])
    total_tris = 0
    pos_min = [1e9, 1e9, 1e9]
    pos_max = [-1e9, -1e9, -1e9]
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            idx_acc = prim.get("indices")
            if idx_acc is not None:
                total_tris += accessors[idx_acc]["count"] // 3
            pos_acc = prim["attributes"]["POSITION"]
            amin = accessors[pos_acc]["min"]
            amax = accessors[pos_acc]["max"]
            for k in range(3):
                pos_min[k] = min(pos_min[k], amin[k])
                pos_max[k] = max(pos_max[k], amax[k])

    return {
        "fileSizeBytes": len(data),
        "triangles": total_tris,
        "meshCount": len(gltf.get("meshes", [])),
        "materialCount": len(materials),
        "alphaMode": alpha_mode,
        "alphaCutoff": round(alpha_cutoff, 3),
        "doubleSided": double_sided,
        "externalUris": len(external_uris),
        "embeddedImages": [(im.get("mimeType"), im.get("name")) for im in images],
        "gltfMin": [round(v, 3) for v in pos_min],
        "gltfMax": [round(v, 3) for v in pos_max],
        "gltfSize": [round(pos_max[k] - pos_min[k], 3) for k in range(3)],
    }


def make_soil_material():
    """Fertile Palatinate loamy-brown tilled soil with subtle 0.75m planting furrows."""
    mat = bpy.data.materials.new(name="Pfalz_Soil_Preview")
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.94
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.14

    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 24.0
    noise.inputs["Detail"].default_value = 10.0
    noise.inputs["Roughness"].default_value = 0.78
    links.new(coord.outputs["Object"], noise.inputs["Vector"])

    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Y"
    wave.inputs["Scale"].default_value = 4.25
    wave.inputs["Distortion"].default_value = 2.6
    links.new(coord.outputs["Object"], wave.inputs["Vector"])

    mix_f = nodes.new("ShaderNodeMix")
    mix_f.data_type = "FLOAT"
    mix_f.inputs["Factor"].default_value = 0.22
    links.new(noise.outputs["Fac"], mix_f.inputs["A"])
    links.new(wave.outputs["Fac"], mix_f.inputs["B"])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.22
    ramp.color_ramp.elements[0].color = (0.045, 0.032, 0.019, 1.0)
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = (0.125, 0.088, 0.055, 1.0)
    links.new(mix_f.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.42
    bump.inputs["Distance"].default_value = 0.05
    links.new(mix_f.outputs["Result"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def configure_cycles_sunlit_scene(scene, width=1280, height=720, samples=80):
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        gpu_ok = False
        for d in prefs.devices:
            if d.type == "METAL":
                d.use = True
                gpu_ok = True
        scene.cycles.device = "GPU" if gpu_ok else "CPU"
    except Exception:
        scene.cycles.device = "CPU"

    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.transparent_max_bounces = 24
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 3

    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -0.35

    # Luminous sunlit Rheinland-Pfalz summer sky (sun_disc disabled -> zero double-sun blowout!)
    world = bpy.data.worlds.new("PfalzSummerSky")
    scene.world = world
    wnt = world.node_tree
    bg = wnt.nodes.get("Background")

    sky = wnt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = False
    sky.sun_elevation = math.radians(42.0)
    sky.sun_rotation = math.radians(155.0)
    wnt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.24

    # Warm July/August sun from camera's front-left 3/4 side illuminating stalks, cobs, leaves & tassels!
    # Light travels along local -Z of the sun object: aim from (-X, -Y, +Z) toward (+X, +Y, 0)!
    sun_data = bpy.data.lights.new("PfalzSun", type="SUN")
    sun_data.energy = 3.6
    sun_data.color = (1.0, 0.965, 0.88)
    sun_data.angle = math.radians(2.0)
    sun_obj = bpy.data.objects.new("PfalzSun", sun_data)
    sun_dir = Vector((0.55, 0.62, -0.78)).normalized()
    sun_obj.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun_obj)


def render_cycles_previews(hero_obj, render_path: str, aerial_path: str = ""):
    scene = bpy.context.scene
    preview_col = bpy.data.collections.new("Cycles_Preview_Stage")
    scene.collection.children.link(preview_col)

    # Tiled 3x4 Maisfeld patch (18m long x 9.6m wide = 12 parallel maize ridges at exact spacing!)
    for ix in (-1, 0, 1):
        for iy in (-1, 0, 1, 2):
            if ix == 0 and iy == 0:
                continue
            dup = bpy.data.objects.new(f"CornBay_{ix}_{iy}", hero_obj.data)
            z_off = 0.015 * math.sin(ix * 2.1 + iy * 3.7)
            dup.location = (ix * 6.0, iy * 2.4, z_off)
            if (ix + iy) % 2 != 0:
                dup.rotation_euler = (0.0, 0.0, math.pi)
            preview_col.objects.link(dup)

    # Subtle sloping Palatinate fertile soil proving -0.25m root skirt prevents any floating stalks!
    mat_soil = make_soil_material()
    bm_g = bmesh.new()
    bmesh.ops.create_grid(bm_g, x_segments=64, y_segments=64, size=64.0)
    for v in bm_g.verts:
        v.co.z = 0.025 * math.sin(v.co.x * 0.45) * math.cos(v.co.y * 0.55)
        if v.co.y > 7.5:
            v.co.z += (v.co.y - 7.5) * 0.04
    mesh_g = bpy.data.meshes.new("Preview_Soil")
    bm_g.to_mesh(mesh_g)
    bm_g.free()
    mesh_g.polygons.foreach_set("use_smooth", [True] * len(mesh_g.polygons))
    mesh_g.materials.append(mat_soil)
    obj_g = bpy.data.objects.new("Preview_Soil", mesh_g)
    preview_col.objects.link(obj_g)

    configure_cycles_sunlit_scene(scene, width=1280, height=720, samples=80)

    # Hero camera: Sunlit tractor-edge / Feldweg 3/4 view showing grounded stalks,
    # broad arching ribbed leaves with pale midribs, plump husked young cobs + pale silk,
    # feathery golden-tan tassels against blue Pfalz summer sky, AND receding agricultural rows!
    cam_data = bpy.data.cameras.new("HeroCam")
    cam_data.lens = 35.0
    cam_obj = bpy.data.objects.new("HeroCam", cam_data)
    cam_obj.location = Vector((-5.1, -6.5, 1.72))
    target = Vector((0.35, -1.60, 1.04))
    cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    preview_col.objects.link(cam_obj)
    scene.camera = cam_obj

    os.makedirs(os.path.dirname(render_path), exist_ok=True)
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Cycles hero showcase -> {render_path}")

    if aerial_path:
        scene.render.resolution_x = 960
        scene.render.resolution_y = 540
        scene.cycles.samples = 56
        cam_data.lens = 34.0
        cam_obj.location = Vector((-9.8, -11.5, 12.6))
        target_air = Vector((0.0, 1.0, 0.8))
        cam_obj.rotation_euler = (target_air - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
        os.makedirs(os.path.dirname(aerial_path), exist_ok=True)
        scene.render.filepath = aerial_path
        bpy.ops.render.render(write_still=True)
        print(f"Rendered Cycles aerial diagnostic -> {aerial_path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", type=str, default="", help="1280x720 Cycles hero showcase output PNG")
    parser.add_argument("--aerial", type=str, default="", help="Optional 960x540 Cycles aerial check PNG")
    args = parser.parse_args(argv)

    clear_scene()
    col = bpy.data.collections.new("Crop_Corn_Row")
    bpy.context.scene.collection.children.link(col)

    obj = build_corn_row_bay(col)

    # 1. Export clean origin-centered GLB
    export_glb(obj, GLB_OUT)

    # 2. Save clean .blend source containing ONLY the canonical crop_corn_row bay at origin
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"Saved clean Blender source -> {BLEND_OUT}")

    # 3. Verify exported GLB binary directly
    info = verify_glb_binary(GLB_OUT)
    print("GLB Verification:", json.dumps(info, indent=2))
    assert 120 <= info["triangles"] <= 220, f"Triangle count {info['triangles']} outside 120..220!"
    assert info["fileSizeBytes"] < 400_000, f"GLB size {info['fileSizeBytes']} exceeds 400 KB!"
    assert info["externalUris"] == 0, "GLB has external URIs!"
    assert info["alphaMode"] == "MASK" and info["doubleSided"] is True

    # 4. Write public/assets/models/fields/corn/meta.json
    meta = {
        "id": "crop_corn_row",
        "cropType": "corn",
        "labelDe": "Maisfeld",
        "glbPath": "/assets/models/fields/corn/crop_corn_row.glb",
        "bounds": info["gltfSize"],  # [w, h, d] in glTF Y-up meters
        "boundsBox": {
            "min": info["gltfMin"],
            "max": info["gltfMax"],
            "size": info["gltfSize"],
        },
        "heightAboveGroundM": info["gltfMax"][1],
        "groundSkirtM": info["gltfMin"][1],
        "triangles": info["triangles"],
        "meshCount": info["meshCount"],
        "materialCount": info["materialCount"],
        "fileSizeBytes": info["fileSizeBytes"],
        "alphaMode": info["alphaMode"],
        "alphaCutoff": info["alphaCutoff"],
        "doubleSided": info["doubleSided"],
        "rowCount": 3,
        "rowSpacingM": 0.75,
        "alongRowM": 6.0,
        "betweenBaysM": 2.4,
        "recommendedSpacing": {
            "alongRowM": 6.0,
            "betweenBaysM": 2.4,
        },
        "windSwayStrength": 0.16,
    }
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote metadata -> {META_OUT}")

    if args.render:
        render_cycles_previews(obj, args.render, args.aerial)


if __name__ == "__main__":
    main()
