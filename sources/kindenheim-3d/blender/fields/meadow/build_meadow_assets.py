#!/usr/bin/env python3
"""
Blender 5.2 Meadow & Wildflower Margin Builder for Kindenheim (Rheinland-Pfalz, Germany).

Builds and exports two botanically realistic, GPU-instancing-ready PBR .glb assets to:
  public/assets/models/fields/meadow/
    - meadow_grass_patch.glb   (~5.0m x 5.0m summer meadow turf, h ~0.42-0.56m, -0.22m skirt, 104 tris, <300 KB)
    - wildflower_strip.glb     (~5.0m x 1.6m Pfalz Blühstreifen border, h ~0.65m, -0.22m skirt, 124 tris, <300 KB)
    - meta.json                (verified bounds, tri counts, instancing spacing, wind-sway strength = 0.10)

Also saves:
  - blender/fields/meadow/kindenheim_meadow.blend
  - Sunlit 1280x720 Cycles showcase render (--render <png_path>)

Run via:
  /opt/homebrew/bin/blender --background --python blender/fields/meadow/build_meadow_assets.py -- \
    --render /Users/logge/.gemini/antigravity-cli/brain/f1b8f0cd-9a3d-400a-aeee-5a781e9e2e22/preview_meadow_wildflowers.png
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
TEX_DIR = os.path.join(PROJECT_ROOT, "blender/fields/meadow/textures")
BLEND_OUT = os.path.join(PROJECT_ROOT, "blender/fields/meadow/kindenheim_meadow.blend")
GLB_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/fields/meadow")
META_OUT = os.path.join(GLB_DIR, "meta.json")

os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
os.makedirs(GLB_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Blender 5.2 Material & Foliage Mesh Helpers
# ---------------------------------------------------------------------------

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


def make_foliage_mask_material(
    name: str,
    albedo_alpha_path: str,
    normal_path: str = None,
    roughness: float = 0.88,
    alpha_threshold: float = 0.45,
    normal_strength: float = 0.35,
):
    """
    Create a Blender 5.2 PBR material that exports cleanly to glTF 2.0:
      - alphaMode: "MASK" (via ShaderNodeMath(ROUND) + mat.alpha_threshold)
      - doubleSided: true (mat.use_backface_culling = False)
      - matte-velvet botanical Roughness (0.86-0.88) & low Specular (0.14) to avoid plastic glare
      - 0 external image URIs (packed embedded images)
    """
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.06

    tex = nodes.new("ShaderNodeTexImage")
    tex.image = load_packed_image(albedo_alpha_path, "sRGB")
    tex.extension = "EXTEND"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    math_n = nodes.new("ShaderNodeMath")
    math_n.operation = "ROUND"
    links.new(tex.outputs["Alpha"], math_n.inputs[0])
    links.new(math_n.outputs["Value"], bsdf.inputs["Alpha"])
    mat.alpha_threshold = alpha_threshold

    if normal_path and os.path.exists(normal_path):
        ntex = nodes.new("ShaderNodeTexImage")
        ntex.image = load_packed_image(normal_path, "Non-Color")
        ntex.extension = "EXTEND"
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    mat.use_backface_culling = False
    return mat


def pick_clump_uv(rng: random.Random, idx: int) -> tuple:
    """
    Select one of the two 512x512 feathered clumps from our 1024x512 atlas,
    optionally mirrored horizontally for 4 distinct botanical silhouettes with ZERO edge clipping.
    """
    is_b = (idx % 2 == 1)
    u_lo, u_hi = (0.504, 0.996) if is_b else (0.004, 0.496)
    if rng.random() < 0.5:
        return (u_lo, u_hi)
    return (u_hi, u_lo)


def add_feathered_tuft_ribbon(
    bm: bmesh.types.BMesh,
    uv_layer,
    center_xy: tuple,
    yaw_rad: float,
    width: float,
    z_bottom: float,
    z_top: float,
    cup_depth: float,
    top_splay: float,
    mid_height_delta: float,
    u0: float,
    u1: float,
    clamp_xy: tuple = None,
):
    """
    Add a 2-quad (4-tri) gently cupped & subtly splayed organic grass/wildflower tuft.
    Because the mapped atlas panel is organically domed & feathered to alpha=0 on left, top, AND right,
    there are ZERO straight scissor-cut card edges from any angle — ground OR aerial!
    """
    cx, cy = center_xy
    c_yaw = math.cos(yaw_rad)
    s_yaw = math.sin(yaw_rad)
    tx = Vector((c_yaw, s_yaw, 0.0))
    ty = Vector((-s_yaw, c_yaw, 0.0))

    hw = width * 0.5
    # Bottom edge firmly rooted at z_bottom (-0.22m underground slope skirt)
    pts_bot = [
        Vector((cx, cy, z_bottom)) - tx * hw - ty * (cup_depth * 0.45),
        Vector((cx, cy, z_bottom)) + ty * (cup_depth * 0.55),
        Vector((cx, cy, z_bottom)) + tx * hw - ty * (cup_depth * 0.45),
    ]
    # Top edge gracefully splayed outward by top_splay (gives aerial top-down thickness too!)
    pts_top = [
        Vector((cx, cy, z_top - mid_height_delta * 0.30)) - tx * (hw * 1.05) + ty * (top_splay - cup_depth * 0.45),
        Vector((cx, cy, z_top + mid_height_delta)) + ty * (top_splay + cup_depth * 0.55),
        Vector((cx, cy, z_top - mid_height_delta * 0.30)) + tx * (hw * 1.05) + ty * (top_splay - cup_depth * 0.45),
    ]

    if clamp_xy is not None:
        max_x, max_y = clamp_xy
        for p in pts_bot + pts_top:
            p.x = max(-max_x, min(max_x, p.x))
            p.y = max(-max_y, min(max_y, p.y))

    vb = [bm.verts.new(p) for p in pts_bot]
    vt = [bm.verts.new(p) for p in pts_top]

    um = 0.5 * (u0 + u1)
    v0, v1 = 0.004, 0.996
    quads = [
        ((vb[0], vb[1], vt[1], vt[0]), ((u0, v0), (um, v0), (um, v1), (u0, v1))),
        ((vb[1], vb[2], vt[2], vt[1]), ((um, v0), (u1, v0), (u1, v1), (um, v1))),
    ]
    for vlist, uvs in quads:
        f = bm.faces.new(vlist)
        for lp, uv in zip(f.loops, uvs):
            lp[uv_layer].uv = uv


def finalize_foliage_mesh(name: str, bm: bmesh.types.BMesh, material, collection):
    """
    Convert BMesh to Blender Object with clean, smooth natural geometric normals.
    IMPORTANT: For double-sided foliage cards (doubleSided: true), natural smooth face
    normals remain outward-facing on BOTH front & back faces (never flipping straight
    downward into black shadows like forced +Z normals do!).
    """
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(material)

    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------------------
# Asset 1: Palatinate Summer Meadow Patch (meadow_grass_patch.glb)
# ~5.0m x 5.0m, height 0.42-0.56m, -0.22m skirt, 104 tris (26 feathered tufts)
# ---------------------------------------------------------------------------

def build_meadow_grass_patch(col):
    rng = random.Random(20261)
    mat = make_foliage_mask_material(
        "MeadowGrass_PBR",
        albedo_alpha_path=os.path.join(TEX_DIR, "meadow_albedo_alpha.png"),
        normal_path=os.path.join(TEX_DIR, "meadow_normal.jpg"),
        roughness=0.88,
        alpha_threshold=0.45,
        normal_strength=0.35,
    )

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # 27 lush overlapping feathered grass-and-wildflower tufts (27 * 4 = 108 tris, right inside 64-110!)
    # Layer A: 16 evenly distributed 4x4 jittered tufts covering the full 5.0m x 5.0m footprint symmetrically
    # Layer B: 11 staggered inter-cell & border-seam crossing tufts eliminating every bare turf pocket!
    centers = []
    grid_a = [-1.82, -0.61, 0.61, 1.82]
    for gx in grid_a:
        for gy in grid_a:
            centers.append((gx + rng.uniform(-0.18, 0.18), gy + rng.uniform(-0.18, 0.18), False))

    # 9 staggered 3x3 inter-cell tufts + 2 extra edge-bridge tufts = 11 inter-cell crossing tufts
    grid_b = [-1.22, 0.0, 1.22]
    for gx in grid_b:
        for gy in grid_b:
            centers.append((gx + rng.uniform(-0.20, 0.20), gy + rng.uniform(-0.20, 0.20), True))
    centers.append((-0.15, 2.02, True))
    centers.append((0.15, -2.02, True))

    for idx, (cx, cy, is_splayed_fill) in enumerate(centers):
        yaw = (idx * 2.399963 + rng.uniform(-0.25, 0.25)) % math.tau
        width = rng.uniform(2.25, 2.72) if not is_splayed_fill else rng.uniform(2.15, 2.58)
        z_top = rng.uniform(0.44, 0.56) if not is_splayed_fill else rng.uniform(0.41, 0.52)
        cup = rng.uniform(0.24, 0.38) * (1.0 if idx % 2 == 0 else -1.0)
        # Gentle balanced splay (12°-24° from vertical) for plush aerial coverage without sun-glare flats!
        if is_splayed_fill:
            splay = rng.uniform(0.18, 0.30) * (1.0 if idx % 3 == 0 else -1.0)
        else:
            splay = rng.uniform(-0.16, 0.16)
        u0, u1 = pick_clump_uv(rng, idx)

        add_feathered_tuft_ribbon(
            bm, uv_layer,
            center_xy=(cx, cy),
            yaw_rad=yaw,
            width=width,
            z_bottom=-0.22,
            z_top=z_top,
            cup_depth=cup,
            top_splay=splay,
            mid_height_delta=rng.uniform(-0.02, 0.03),
            u0=u0, u1=u1,
            clamp_xy=(2.50, 2.50),
        )

    return finalize_foliage_mesh("MeadowGrassPatch", bm, mat, col)


# ---------------------------------------------------------------------------
# Asset 2: Palatinate Wildflower Strip / Blühstreifen (wildflower_strip.glb)
# ~5.0m long (+X) x ~1.6m wide, height ~0.65m, -0.22m skirt, 124 tris (31 tufts)
# ---------------------------------------------------------------------------

def build_wildflower_strip(col):
    rng = random.Random(55903)
    mat = make_foliage_mask_material(
        "WildflowerStrip_PBR",
        albedo_alpha_path=os.path.join(TEX_DIR, "wildflower_albedo_alpha.png"),
        normal_path=os.path.join(TEX_DIR, "wildflower_normal.jpg"),
        roughness=0.86,
        alpha_threshold=0.45,
        normal_strength=0.35,
    )

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # 31 feathered curved botanical wildflower clumps (31 * 4 = 124 tris, target 80-130!)
    # 1) 15 longitudinal staggered clumps across 3 lanes (south verge, tall center spine, north verge)
    lanes = [
        (-0.34, -0.26, 5),   # south shoulder spilling gently outward toward -Y
        (0.00, 0.00, 5),     # tall central poppy & cornflower spine (~0.65m!)
        (+0.34, +0.26, 5),   # north shoulder spilling gently outward toward +Y
    ]
    idx = 0
    for lane_y, out_splay, count in lanes:
        step = 5.0 / count
        for k in range(count):
            cx = -2.50 + (k + 0.5) * step + rng.uniform(-0.15, 0.15)
            cy = lane_y + rng.uniform(-0.08, 0.08)
            yaw = rng.uniform(-0.26, 0.26)
            width = rng.uniform(1.50, 1.85)
            z_top = rng.uniform(0.58, 0.65) if abs(lane_y) < 0.1 else rng.uniform(0.48, 0.58)
            cup = rng.uniform(0.14, 0.24) * (1.0 if lane_y >= 0 else -1.0)
            splay = out_splay + rng.uniform(-0.08, 0.08)
            u0, u1 = pick_clump_uv(rng, idx)

            add_feathered_tuft_ribbon(
                bm, uv_layer,
                center_xy=(cx, cy),
                yaw_rad=yaw,
                width=width,
                z_bottom=-0.22,
                z_top=z_top,
                cup_depth=cup,
                top_splay=splay,
                mid_height_delta=rng.uniform(-0.02, 0.025),
                u0=u0, u1=u1,
                clamp_xy=(2.50, 0.80),
            )
            idx += 1

    # 2) 16 cross-angled & diagonally splayed bouquet clumps along X (64 tris) -> total = 124 tris!
    # Ensures both end-on Feldweg driving AND overhead aerial views see dense poppies & cornflowers!
    for k in range(16):
        cx = -2.28 + k * (4.56 / 15.0) + rng.uniform(-0.08, 0.08)
        cy = rng.uniform(-0.15, 0.15)
        yaw = math.radians(rng.choice([48, 68, 90, 112, 132]) + rng.uniform(-10, 10))
        width = rng.uniform(1.30, 1.62)
        z_top = rng.uniform(0.52, 0.65)
        cup = rng.uniform(0.14, 0.24) * (1.0 if k % 2 == 0 else -1.0)
        # Alternating generous lean for rich 3D crown breadth from above
        splay = (0.24 if k % 2 == 0 else -0.24) + rng.uniform(-0.06, 0.06)
        u0, u1 = pick_clump_uv(rng, idx)

        add_feathered_tuft_ribbon(
            bm, uv_layer,
            center_xy=(cx, cy),
            yaw_rad=yaw,
            width=width,
            z_bottom=-0.22,
            z_top=z_top,
            cup_depth=cup,
            top_splay=splay,
            mid_height_delta=rng.uniform(-0.02, 0.025),
            u0=u0, u1=u1,
            clamp_xy=(2.50, 0.80),
        )
        idx += 1

    return finalize_foliage_mesh("WildflowerStrip", bm, mat, col)


# ---------------------------------------------------------------------------
# GLB Export & Binary Structural Verification
# ---------------------------------------------------------------------------

def export_single_glb(obj, glb_path: str):
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


def inspect_glb_contract(glb_path: str) -> dict:
    with open(glb_path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2, f"Invalid GLB header in {glb_path}"
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    assert chunk_type == 0x4E4F534A, "First chunk is not JSON"
    gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))

    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])
    images = gltf.get("images", [])

    total_tris = 0
    min_pt = [1e9, 1e9, 1e9]
    max_pt = [-1e9, -1e9, -1e9]
    for m in meshes:
        for prim in m.get("primitives", []):
            if "indices" in prim:
                total_tris += accessors[prim["indices"]]["count"] // 3
            pos_acc = accessors[prim["attributes"]["POSITION"]]
            for i in range(3):
                min_pt[i] = min(min_pt[i], pos_acc["min"][i])
                max_pt[i] = max(max_pt[i], pos_acc["max"][i])

    external_uris = [img.get("uri") for img in images if "uri" in img]
    mat_checks = [
        {
            "name": mt.get("name"),
            "alphaMode": mt.get("alphaMode", "OPAQUE"),
            "alphaCutoff": mt.get("alphaCutoff", 0.5),
            "doubleSided": mt.get("doubleSided", False),
        }
        for mt in materials
    ]
    size = [round(max_pt[i] - min_pt[i], 3) for i in range(3)]
    return {
        "fileSizeBytes": len(data),
        "fileSizeKB": round(len(data) / 1024.0, 1),
        "meshCount": len(meshes),
        "triangles": total_tris,
        "bounds": size,
        "bbox": {
            "min": [round(v, 3) for v in min_pt],
            "max": [round(v, 3) for v in max_pt],
            "size": size,
        },
        "skirtDepthM": round(-min_pt[1], 3),
        "aboveGroundHeightM": round(max_pt[1], 3),
        "materials": mat_checks,
        "imageCount": len(images),
        "imageMimeTypes": [img.get("mimeType") for img in images],
        "externalImageURIs": len(external_uris),
    }


# ---------------------------------------------------------------------------
# Sunlit 1280x720 Cycles Showcase Renderer (Calibrated Natural Summer Sunlight!)
# ---------------------------------------------------------------------------

def make_procedural_ground_mat(name: str, col_a, col_b, scale: float = 2.5, roughness: float = 0.94):
    """Organic mottled Palatinate turf or limestone-gravel ground shader for Cycles preview."""
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.15

    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.65
    links.new(coord.outputs["Object"], noise.inputs["Vector"])

    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*col_a, 1.0)
    mix.inputs["B"].default_value = (*col_b, 1.0)
    links.new(noise.outputs["Fac"], mix.inputs["Factor"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


def render_cycles_showcase(render_path: str, meadow_obj, wildflower_obj):
    """
    Build a sunlit Palatinate summer showcase diorama in a temporary collection:
      - Left/Center: 3x2 seamless tiled meadow_grass_patch instances carpeting gently sloped Pfalz hillside turf
      - Right/Foreground: Pale Pfalz limestone-gravel Feldweg lined on BOTH edges by tiled wildflower_strip bays
      - Calibrated summer daylight (NO blown-out sky overexposure!) in Cycles 1280x720!
    """
    scene = bpy.context.scene
    tmp_col = bpy.data.collections.new("Showcase_Temp")
    scene.collection.children.link(tmp_col)

    meadow_obj.hide_render = True
    wildflower_obj.hide_render = True

    def terrain_z(x, y):
        # Gentle rolling Palatinate hillside (~5-8° slope!) to prove -0.22m skirt never floats
        return 0.14 * math.sin(x * 0.22 + 0.4) + 0.11 * math.cos(y * 0.24 - 0.3) + 0.042 * y

    # 1. Sculpted Palatinate grassy hillside ground
    bm_g = bmesh.new()
    nx, ny = 48, 48
    span = 42.0
    verts_grid = []
    for iy in range(ny + 1):
        row = []
        y = -span * 0.40 + (iy / ny) * span
        for ix in range(nx + 1):
            x = -span * 0.50 + (ix / nx) * span
            row.append(bm_g.verts.new((x, y, terrain_z(x, y))))
        verts_grid.append(row)
    for iy in range(ny):
        for ix in range(nx):
            bm_g.faces.new((
                verts_grid[iy][ix],
                verts_grid[iy][ix + 1],
                verts_grid[iy + 1][ix + 1],
                verts_grid[iy + 1][ix],
            ))
    g_mesh = bpy.data.meshes.new("ShowcaseTerrain")
    bm_g.normal_update()
    bm_g.to_mesh(g_mesh)
    bm_g.free()
    g_mesh.polygons.foreach_set("use_smooth", [True] * len(g_mesh.polygons))
    g_mesh.materials.append(make_procedural_ground_mat(
        "Pfalz_Turf_Soil", (0.07, 0.11, 0.035), (0.14, 0.18, 0.065), scale=1.6, roughness=0.95
    ))
    g_obj = bpy.data.objects.new("ShowcaseTerrain", g_mesh)
    tmp_col.objects.link(g_obj)

    # 2. Classic Palatinate limestone-gravel Feldweg running along foreground-right
    bm_r = bmesh.new()
    for iy in range(36):
        y0 = -10.0 + (iy / 36.0) * 32.0
        y1 = -10.0 + ((iy + 1) / 36.0) * 32.0
        x_l, x_r = 2.40, 4.75
        v0 = bm_r.verts.new((x_l, y0, terrain_z(x_l, y0) + 0.015))
        v1 = bm_r.verts.new((x_r, y0, terrain_z(x_r, y0) + 0.015))
        v2 = bm_r.verts.new((x_r, y1, terrain_z(x_r, y1) + 0.015))
        v3 = bm_r.verts.new((x_l, y1, terrain_z(x_l, y1) + 0.015))
        bm_r.faces.new((v0, v1, v2, v3))
    r_mesh = bpy.data.meshes.new("ShowcaseFeldweg")
    bm_r.normal_update()
    bm_r.to_mesh(r_mesh)
    bm_r.free()
    r_mesh.materials.append(make_procedural_ground_mat(
        "Pfalz_Feldweg_Gravel", (0.24, 0.21, 0.16), (0.35, 0.31, 0.24), scale=4.5, roughness=0.92
    ))
    r_obj = bpy.data.objects.new("ShowcaseFeldweg", r_mesh)
    tmp_col.objects.link(r_obj)

    # 3. Seamless 3x4 tiled meadow_grass_patch instances carpeting the left/center hillside (~4.70m spacing!)
    meadow_placements = [
        (-9.4, -2.0, math.radians(42)), (-4.75, -1.9, math.radians(15)), (-0.15, -1.8, math.radians(108)),
        (-9.3, 2.7, math.radians(188)), (-4.70, 2.8, math.radians(224)), (-0.10, 2.9, math.radians(315)),
        (-9.4, 7.4, math.radians(82)), (-4.75, 7.5, math.radians(66)), (-0.15, 7.6, math.radians(176)),
        (-9.3, 12.1, math.radians(140)), (-4.70, 12.2, math.radians(295)), (-0.10, 12.3, math.radians(14)),
    ]
    for i, (mx, my, myaw) in enumerate(meadow_placements):
        inst = bpy.data.objects.new(f"MeadowInst_{i}", meadow_obj.data)
        inst.location = (mx, my, terrain_z(mx, my))
        inst.rotation_euler = Euler((0.0, 0.0, myaw), "XYZ")
        tmp_col.objects.link(inst)

    # 4. Seamless tiled wildflower_strip bays lining BOTH sides of the Feldweg!
    wf_placements = [
        # Left verge of Feldweg (hero border between meadow & track!)
        (2.05, -2.20, math.radians(90.0)),
        (2.05, 2.65, math.radians(90.0)),
        (2.05, 7.50, math.radians(90.0)),
        (2.05, 12.35, math.radians(90.0)),
        # Right verge of Feldweg (framing the track!)
        (5.10, -1.80, math.radians(-90.0)),
        (5.10, 3.05, math.radians(-90.0)),
        (5.10, 7.90, math.radians(-90.0)),
        (5.10, 12.75, math.radians(-90.0)),
    ]
    for i, (wx, wy, wyaw) in enumerate(wf_placements):
        inst = bpy.data.objects.new(f"WildflowerInst_{i}", wildflower_obj.data)
        inst.location = (wx, wy, terrain_z(wx, wy))
        inst.rotation_euler = Euler((0.0, 0.0, wyaw), "XYZ")
        tmp_col.objects.link(inst)

    # 5. Calibrated Blue-Sky Summer Atmosphere + Warm Golden Afternoon Directional Sun (ZERO overexposure!)
    world = bpy.data.worlds.new("PfalzSummerSky")
    scene.world = world
    wnt = world.node_tree
    bg = wnt.nodes.get("Background")
    sky = wnt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = False
    sky.sun_elevation = math.radians(34.0)
    sky.sun_rotation = math.radians(225.0)
    wnt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.11

    sun_data = bpy.data.lights.new("PfalzSun", type="SUN")
    sun_data.energy = 2.8
    sun_data.color = (1.0, 0.96, 0.88)
    sun_data.angle = math.radians(2.0)
    sun_obj = bpy.data.objects.new("PfalzSun", sun_data)
    # Warm 3/4 Palatinate summer afternoon sun illuminating meadow waves + vibrant crimson poppies & blue cornflowers
    sun_obj.rotation_euler = Euler((math.radians(50.0), math.radians(10.0), math.radians(-42.0)), "XYZ")
    tmp_col.objects.link(sun_obj)

    # 6. Camera framing sunlit meadow (left/center) + Feldweg & Blühstreifen verges (right)!
    cam_data = bpy.data.cameras.new("ShowcaseCam")
    cam_data.lens = 35.0
    cam_obj = bpy.data.objects.new("ShowcaseCam", cam_data)
    cam_obj.location = Vector((2.65, -6.30, 1.58))
    target = Vector((0.65, 1.80, 0.35))
    cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    tmp_col.objects.link(cam_obj)
    scene.camera = cam_obj

    # 7. Cycles Render Settings (Metal GPU / CPU fallback, clean denoising, high transparent bounces!)
    bpy.ops.preferences.addon_enable(module="cycles")
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.refresh_devices()
        gpu = False
        for d in prefs.devices:
            if d.type == "METAL":
                d.use = True
                gpu = True
            else:
                d.use = False
        scene.cycles.device = "GPU" if gpu else "CPU"
    except Exception:
        scene.cycles.device = "CPU"

    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.transparent_max_bounces = 28
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = render_path
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        scene.view_settings.view_transform = "Filmic"
    scene.view_settings.exposure = 0.05

    os.makedirs(os.path.dirname(render_path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Cycles showcase -> {render_path}")

    for obj in list(tmp_col.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(tmp_col)
    bpy.data.worlds.remove(world)
    meadow_obj.hide_render = False
    wildflower_obj.hide_render = False


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", type=str, default="", help="Optional 1280x720 Cycles showcase render PNG path")
    args = parser.parse_args(argv)

    clear_scene()

    col_meadow = bpy.data.collections.new("MeadowGrassPatch")
    bpy.context.scene.collection.children.link(col_meadow)
    meadow_obj = build_meadow_grass_patch(col_meadow)

    col_wf = bpy.data.collections.new("WildflowerStrip")
    bpy.context.scene.collection.children.link(col_wf)
    wf_obj = build_wildflower_strip(col_wf)

    meadow_glb = os.path.join(GLB_DIR, "meadow_grass_patch.glb")
    wf_glb = os.path.join(GLB_DIR, "wildflower_strip.glb")
    export_single_glb(meadow_obj, meadow_glb)
    export_single_glb(wf_obj, wf_glb)

    meadow_info = inspect_glb_contract(meadow_glb)
    wf_info = inspect_glb_contract(wf_glb)

    print("=== EXPORTED GLB VERIFICATION ===")
    print("meadow_grass_patch.glb:", json.dumps(meadow_info, indent=2))
    print("wildflower_strip.glb:  ", json.dumps(wf_info, indent=2))

    # Strict contract assertions so we can never ship a broken asset
    assert meadow_info["fileSizeBytes"] < 300_000, f"meadow GLB too large: {meadow_info['fileSizeKB']} KB"
    assert wf_info["fileSizeBytes"] < 300_000, f"wildflower GLB too large: {wf_info['fileSizeKB']} KB"
    assert 64 <= meadow_info["triangles"] <= 110, f"meadow tris out of range: {meadow_info['triangles']}"
    assert 80 <= wf_info["triangles"] <= 130, f"wildflower tris out of range: {wf_info['triangles']}"
    assert meadow_info["externalImageURIs"] == 0 and wf_info["externalImageURIs"] == 0
    assert meadow_info["materials"][0]["alphaMode"] == "MASK" and meadow_info["materials"][0]["doubleSided"]
    assert wf_info["materials"][0]["alphaMode"] == "MASK" and wf_info["materials"][0]["doubleSided"]

    meta = {
        "category": "meadow",
        "coordinateSystem": "glTF 2.0 Y-up meters (ground contact Y = 0.0, slope skirt minY = -0.22)",
        "windSwayStrength": 0.10,
        "assets": {
            "meadow_grass_patch": {
                "glbPath": "/assets/models/fields/meadow/meadow_grass_patch.glb",
                "bounds": meadow_info["bounds"],
                "bbox": meadow_info["bbox"],
                "aboveGroundHeightM": meadow_info["aboveGroundHeightM"],
                "skirtDepthM": meadow_info["skirtDepthM"],
                "triangles": meadow_info["triangles"],
                "meshCount": meadow_info["meshCount"],
                "fileSizeBytes": meadow_info["fileSizeBytes"],
                "fileSizeKB": meadow_info["fileSizeKB"],
                "alphaMode": meadow_info["materials"][0]["alphaMode"],
                "doubleSided": meadow_info["materials"][0]["doubleSided"],
                "externalImageURIs": meadow_info["externalImageURIs"],
                "recommendedSpacing": {
                    "gridM": 4.75,
                    "patchSizeM": 5.0,
                    "jitterM": 0.35,
                    "randomYaw": True,
                    "scaleRange": [0.90, 1.15],
                },
                "windSwayStrength": 0.10,
            },
            "wildflower_strip": {
                "glbPath": "/assets/models/fields/meadow/wildflower_strip.glb",
                "bounds": wf_info["bounds"],
                "bbox": wf_info["bbox"],
                "aboveGroundHeightM": wf_info["aboveGroundHeightM"],
                "skirtDepthM": wf_info["skirtDepthM"],
                "triangles": wf_info["triangles"],
                "meshCount": wf_info["meshCount"],
                "fileSizeBytes": wf_info["fileSizeBytes"],
                "fileSizeKB": wf_info["fileSizeKB"],
                "alphaMode": wf_info["materials"][0]["alphaMode"],
                "doubleSided": wf_info["materials"][0]["doubleSided"],
                "externalImageURIs": wf_info["externalImageURIs"],
                "recommendedSpacing": {
                    "alongStripM": 4.85,
                    "stripLengthM": 5.0,
                    "stripWidthM": 1.6,
                    "alignToEdge": True,
                    "lengthAxis": "+X",
                    "scaleRange": [0.95, 1.12],
                },
                "windSwayStrength": 0.10,
            },
        },
    }
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote verified metadata -> {META_OUT}")

    if args.render:
        render_cycles_showcase(args.render, meadow_obj, wf_obj)

    meadow_obj.location = (-3.4, 0.0, 0.0)
    wf_obj.location = (3.4, 0.0, 0.0)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"Saved master .blend -> {BLEND_OUT}")


if __name__ == "__main__":
    main()
