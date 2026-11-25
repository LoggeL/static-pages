#!/usr/bin/env python3
"""
Blender 5.2 Sunflower Field Patch Builder (`Sonnenblumenfeld`) for Kindenheim (Rheinland-Pfalz).

Builds and exports:
  - public/assets/models/fields/sunflower/crop_sunflower_patch.glb
      * ~5.0m x 5.0m seamless instancing patch arranged in 7 neat ~0.714m agricultural rows along +X
      * Height ~1.65..1.85m with natural variation + -0.25m underground root skirt for steep Pfalz slopes
      * 224 tris (1 unified GPU-instancing mesh, 1 PBR alpha-masked doubleSided material, 0 external URIs)
      * Dedicated 3D sun-angled sunflower blooms tilted gently toward +Z local (-Y in Blender = South sun)
  - public/assets/models/fields/sunflower/meta.json
  - blender/fields/sunflower/sunflower_field.blend
  - Optional sunlit 1280x720 Cycles showcase render (--render <png_path>) + optional aerial check (--aerial <png_path>)

Run via:
  /opt/homebrew/bin/blender --background --python blender/fields/sunflower/build_sunflower.py -- \
    --render /Users/logge/.gemini/antigravity-cli/brain/d0a5d2c7-e975-4fcb-8956-e06fcef0ce3a/preview_sunflower_field.png
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
from mathutils import Euler, Matrix, Vector

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
TEX_DIR = os.path.join(PROJECT_ROOT, "blender/fields/sunflower/textures")
BLEND_OUT = os.path.join(PROJECT_ROOT, "blender/fields/sunflower/sunflower_field.blend")
GLB_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/fields/sunflower")
GLB_OUT = os.path.join(GLB_DIR, "crop_sunflower_patch.glb")
META_OUT = os.path.join(GLB_DIR, "meta.json")

os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
os.makedirs(GLB_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# UV Region Constants matching generate_textures.py (1024x1024 atlas)
# Remember: Blender UV v=0 is bottom of image, v=1 is top of image.
# ---------------------------------------------------------------------------
UV_CURTAIN_FULL = (0.004, 0.002, 0.996, 0.556)
UV_CURTAIN_SLICES = [
    (0.008, 0.002, 0.345, 0.556),
    (0.330, 0.002, 0.670, 0.556),
    (0.655, 0.002, 0.992, 0.556),
]
UV_BLOOM_A = (0.006, 0.580, 0.324, 0.994)  # Large single radiant sunflower + stem neck & 2 leaves
UV_BLOOM_B = (0.342, 0.580, 0.658, 0.994)  # Twin-bloom sunflower cluster + stem & leaves
UV_ROSETTE = (0.678, 0.580, 0.994, 0.994)  # Aerial broad-leaf serrated rosette + peeking golden bloom


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


def make_sunflower_material(use_normal: bool = True, use_roughness: bool = False):
    """
    Create Blender 5.2 PBR alpha-masked double-sided material exporting as:
      alphaMode: "MASK", doubleSided: true, 0 external URIs.
    """
    mat = bpy.data.materials.new(name="Sunflower_Field_Mat")
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.68
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.32

    albedo_path = os.path.join(TEX_DIR, "sunflower_atlas_albedo.png")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = load_image(albedo_path, "sRGB")
    tex.extension = "CLIP"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    # Blender 5.x glTF exporter maps Math(ROUND) on Alpha -> alphaMode: "MASK"
    math_n = nodes.new("ShaderNodeMath")
    math_n.operation = "ROUND"
    links.new(tex.outputs["Alpha"], math_n.inputs[0])
    links.new(math_n.outputs["Value"], bsdf.inputs["Alpha"])
    mat.alpha_threshold = 0.45

    if use_normal:
        normal_path = os.path.join(TEX_DIR, "sunflower_atlas_normal.jpg")
        if os.path.exists(normal_path):
            ntex = nodes.new("ShaderNodeTexImage")
            ntex.image = load_image(normal_path, "Non-Color")
            nmap = nodes.new("ShaderNodeNormalMap")
            nmap.inputs["Strength"].default_value = 0.72
            links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    if use_roughness:
        rough_path = os.path.join(TEX_DIR, "sunflower_atlas_roughness.jpg")
        if os.path.exists(rough_path):
            rtex = nodes.new("ShaderNodeTexImage")
            rtex.image = load_image(rough_path, "Non-Color")
            links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])

    mat.use_backface_culling = False  # -> glTF doubleSided: true
    return mat


def add_quad_with_uv(
    bm: bmesh.types.BMesh,
    uv_layer,
    p0: Vector,
    p1: Vector,
    p2: Vector,
    p3: Vector,
    uv_rect: tuple,
    flip_u: bool = False,
):
    """Add a single 4-vertex quad (2 tris) with UV mapped cleanly to uv_rect (u0, v0, u1, v1)."""
    u0, v0, u1, v1 = uv_rect
    if flip_u:
        u0, u1 = u1, u0
    v_bl = bm.verts.new(p0)
    v_br = bm.verts.new(p1)
    v_tr = bm.verts.new(p2)
    v_tl = bm.verts.new(p3)
    f = bm.faces.new((v_bl, v_br, v_tr, v_tl))
    for lp, uv in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        lp[uv_layer].uv = uv
    return f


def add_oriented_card(
    bm: bmesh.types.BMesh,
    uv_layer,
    base_center: Vector,
    right_dir: Vector,
    up_dir: Vector,
    width: float,
    height: float,
    uv_rect: tuple,
    flip_u: bool = False,
):
    """Add a quad anchored at base_center extending along right_dir (+/- w/2) and up_dir (0..h)."""
    r = right_dir.normalized() * (width * 0.5)
    u = up_dir.normalized() * height
    p0 = base_center - r
    p1 = base_center + r
    p2 = base_center + r + u
    p3 = base_center - r + u
    return add_quad_with_uv(bm, uv_layer, p0, p1, p2, p3, uv_rect, flip_u=flip_u)


def build_sunflower_patch(col, use_normal: bool = True, use_roughness: bool = False):
    """
    Build the seamless 5.0m x 5.0m sunflower field patch (`crop_sunflower_patch.glb`):
      - 7 neat agricultural rows along local +X spaced 0.7143m apart along Y (-2.143..+2.143)
      - Underground root skirt to Z = -0.25m (glTF Y = -0.25m)
      - Canopy bloom tops Z = 1.65..1.85m with natural height variation
      - All dedicated 3D sunflower blooms angled gently toward -Y Blender (+Z local glTF = South sun!)
      - Exact triangle budget: 42 + 56 + 84 + 42 = 224 tris (1 single GPU-instancing mesh!)
    """
    rng = random.Random(7731)
    mat = make_sunflower_material(use_normal=use_normal, use_roughness=use_roughness)

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    patch_size = 5.0
    n_rows = 7
    row_pitch = patch_size / n_rows  # 0.7143m (~0.75m authentic Pfalz sunflower spacing, 100% seamless!)
    skirt_z = -0.25

    row_ys = [-patch_size * 0.5 + (r + 0.5) * row_pitch for r in range(n_rows)]

    # Store per-vertex custom normal targets so foliage wraps sunlight naturally from all angles
    # Keyed by vertex index after bm.verts.ensure_lookup_table()
    normal_hints = []

    def record_face_normals(face, target_nrm: Vector):
        n = target_nrm.normalized()
        for v in face.verts:
            normal_hints.append((v, n))

    # =========================================================================
    # LAYER 1: 7 Longitudinal Agricultural Row Curtains (3 gently waved segments/row = 42 tris)
    # Runs continuously along X from -2.48 to +2.48 with organic subtle wobble & lean
    # =========================================================================
    # Layer 1 horizontal span: slightly wider than Y so runsAlongX (size.x >= size.z) is guaranteed!
    seg_edges = [-2.50, -0.83, 0.83, 2.50]
    for r_idx, ry in enumerate(row_ys):
        # Gentle organic zigzag offsets along row so looking straight down the row still has 3D thickness
        y_nodes = [
            ry + rng.uniform(-0.045, 0.045),
            ry + (0.055 if r_idx % 2 == 0 else -0.055) + rng.uniform(-0.02, 0.02),
            ry + (-0.055 if r_idx % 2 == 0 else 0.055) + rng.uniform(-0.02, 0.02),
            ry + rng.uniform(-0.045, 0.045),
        ]
        for s_idx in range(3):
            x0, x1 = seg_edges[s_idx], seg_edges[s_idx + 1]
            y0, y1 = y_nodes[s_idx], y_nodes[s_idx + 1]
            top_z0 = rng.uniform(1.50, 1.64)
            top_z1 = rng.uniform(1.50, 1.64)
            lean_y = rng.uniform(-0.07, 0.07)

            p0 = Vector((x0, y0, skirt_z))
            p1 = Vector((x1, y1, skirt_z))
            p2 = Vector((x1, y1 + lean_y, top_z1))
            p3 = Vector((x0, y0 + lean_y, top_z0))

            # Use a 2/3-width slice or full curtain with natural flip variation
            if s_idx == 1:
                uv_r = (0.14, 0.002, 0.86, 0.556)
            else:
                uv_r = UV_CURTAIN_FULL

            f = add_quad_with_uv(bm, uv_layer, p0, p1, p2, p3, uv_r, flip_u=((r_idx + s_idx) % 2 == 1))
            # Soft sky-blended normal so sunlight wraps softly on both sides of the row wall
            record_face_normals(f, Vector((0.0, -0.45 if s_idx % 2 == 0 else 0.45, 0.89)))

    # =========================================================================
    # LAYER 2: Transverse / Diagonal Cross-Row Stalk & Leaf Baffles (4/row = 56 tris)
    # Eliminates thin look when driving along X rows while preserving clear 0.71m furrows!
    # =========================================================================
    for r_idx, ry in enumerate(row_ys):
        for b_idx in range(4):
            bx = -1.92 + b_idx * 1.28 + rng.uniform(-0.14, 0.14)
            by = ry + rng.uniform(-0.03, 0.03)
            # Crisp 0.44-0.50m width stays cleanly inside each 0.714m row so neat furrows show!
            bw = rng.uniform(0.44, 0.50)
            bh = rng.uniform(1.60, 1.76)  # From -0.25m up to 1.35..1.51m
            yaw = math.radians((68.0 if (r_idx + b_idx) % 2 == 0 else -68.0) + rng.uniform(-12.0, 12.0))
            lean_x = rng.uniform(-0.05, 0.05)
            lean_y = rng.uniform(-0.05, 0.05)

            right = Vector((math.cos(yaw), math.sin(yaw), 0.0))
            up = Vector((lean_x, lean_y, 1.0)).normalized()
            uv_slice = UV_CURTAIN_SLICES[(r_idx + b_idx) % len(UV_CURTAIN_SLICES)]
            f = add_oriented_card(
                bm,
                uv_layer,
                base_center=Vector((bx, by, skirt_z)),
                right_dir=right,
                up_dir=up,
                width=bw,
                height=bh,
                uv_rect=uv_slice,
                flip_u=((r_idx * 3 + b_idx) % 2 == 1),
            )
            record_face_normals(f, Vector((math.sin(yaw) * 0.35, -math.cos(yaw) * 0.35, 0.92)))

    # =========================================================================
    # LAYER 4: Splayed Broad-Leaf Aerial Canopy Rosettes (3/row = 42 tris)
    # Gently tilted horizontal leaf shelves right below blooms for lush aerial green+gold rows!
    # =========================================================================
    for r_idx, ry in enumerate(row_ys):
        for c_idx in range(3):
            cx = -1.66 + c_idx * 1.66 + rng.uniform(-0.16, 0.16)
            cy = ry + rng.uniform(-0.03, 0.03)
            cz = rng.uniform(1.12, 1.36)
            # Narrower along Y (~0.44m) so neat dark-soil furrows remain unmistakable from aerial drone!
            card_w = rng.uniform(0.86, 1.02)
            card_d = rng.uniform(0.42, 0.48)

            # Tilt gently toward South sun (+14..+28 deg) so cards never read edge-on at tractor height!
            pitch_sun = math.radians(rng.uniform(14.0, 28.0))
            roll_x = math.radians(rng.uniform(-12.0, 12.0))
            yaw_z = math.radians(rng.uniform(-14.0, 14.0))
            rot = Euler((pitch_sun, roll_x, yaw_z), "XYZ").to_matrix()

            r_vec = rot @ Vector((card_w * 0.5, 0.0, 0.0))
            f_vec = rot @ Vector((0.0, card_d * 0.5, 0.0))
            center = Vector((cx, cy, cz))
            f = add_quad_with_uv(
                bm,
                uv_layer,
                center - r_vec - f_vec,
                center + r_vec - f_vec,
                center + r_vec + f_vec,
                center - r_vec + f_vec,
                UV_ROSETTE,
                flip_u=((r_idx + c_idx) % 2 == 1),
            )
            record_face_normals(f, rot @ Vector((0.0, -0.15, 0.98)))

    # =========================================================================
    # LAYER 3: 42 Dedicated 3D Sun-Angled Sunflower Bloom Cards (6/row = 84 tris!)
    # Botanically true-to-scale (~22-28cm heads!) alternating Single Hero (A) & Twin Cluster (B),
    # angled gently toward +Z local in glTF (-Y in Blender = South sun) & tilted 28-46 deg upward!
    # =========================================================================
    for r_idx, ry in enumerate(row_ys):
        for h_idx in range(6):
            # Organic staggered spacing along the 5m row so rows read naturally, never polka-dot uniform!
            hx = -2.06 + h_idx * 0.824 + rng.uniform(-0.18, 0.18)
            hx = max(-2.30, min(2.30, hx))
            # Tightly aligned to row center (+/-0.07m) so neat 0.71m agricultural rows read crisply!
            hy = ry + rng.uniform(-0.07, 0.07)
            if r_idx == n_rows - 1:
                hy = min(hy, 2.08)

            use_twin = ((r_idx + h_idx) % 3 == 1)  # 1/3 twin clusters + 2/3 bold single heads -> natural rhythm!
            if use_twin:
                bw = rng.uniform(0.40, 0.48)
                bh = bw * rng.uniform(1.12, 1.22)
                uv_rect = UV_BLOOM_B
            else:
                bw = rng.uniform(0.31, 0.38)
                bh = bw * rng.uniform(1.18, 1.28)
                uv_rect = UV_BLOOM_A

            # Natural undulating canopy bloom peak height ~1.62..1.84m!
            target_top_z = rng.uniform(1.60, 1.84)

            elev_deg = rng.uniform(26.0, 44.0)
            yaw_deg = rng.uniform(-24.0, 24.0)
            roll_deg = rng.uniform(-12.0, 12.0)

            elev = math.radians(elev_deg)
            yaw = math.radians(yaw_deg)
            roll = math.radians(roll_deg)

            base_right = Vector((math.cos(yaw), math.sin(yaw), 0.0))
            base_fwd_south = Vector((math.sin(yaw), -math.cos(yaw), 0.0))  # -Y when yaw=0 (+Z in glTF!)
            up_vec = (Vector((0.0, 0.0, math.cos(elev))) - base_fwd_south * math.sin(elev)).normalized()
            right_vec = (base_right * math.cos(roll) + up_vec * math.sin(roll)).normalized()
            up_vec = (up_vec * math.cos(roll) - base_right * math.sin(roll)).normalized()

            vert_span = bh * up_vec.z
            base_z = target_top_z - vert_span
            base_center = Vector((hx, hy - 0.03, base_z))

            f = add_oriented_card(
                bm,
                uv_layer,
                base_center=base_center,
                right_dir=right_vec,
                up_dir=up_vec,
                width=bw,
                height=bh,
                uv_rect=uv_rect,
                flip_u=(rng.random() < 0.45),
            )
            face_nrm = right_vec.cross(up_vec).normalized()
            record_face_normals(f, (face_nrm * 0.72 + Vector((0.0, 0.0, 0.28))).normalized())

    # Finalize BMesh -> Mesh Object
    bm.verts.ensure_lookup_table()
    # Map vertex index -> averaged custom normal before freeing bmesh
    vert_nrm_acc = [Vector((0.0, 0.0, 0.0)) for _ in range(len(bm.verts))]
    for v, n in normal_hints:
        vert_nrm_acc[v.index] += n
    vert_normals = [
        (vn.normalized() if vn.length > 1e-5 else Vector((0.0, 0.0, 1.0)))
        for vn in vert_nrm_acc
    ]

    mesh = bpy.data.meshes.new("SunflowerFieldPatch")
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(mat)
    try:
        mesh.normals_split_custom_set_from_vertices(vert_normals)
    except Exception as exc:
        print(f"Warning: custom normals skipped ({exc})")

    obj = bpy.data.objects.new("SunflowerFieldPatch", mesh)
    col.objects.link(obj)
    return obj


def compute_gltf_bbox(obj):
    """Compute exact glTF (Y-up) bounding box from Blender (Z-up) mesh vertices."""
    xs, ys, zs = [], [], []
    mat_w = obj.matrix_world
    for v in obj.data.vertices:
        w = mat_w @ v.co
        # Blender (bx, by, bz) -> glTF (bx, bz, -by)
        xs.append(w.x)
        ys.append(w.z)
        zs.append(-w.y)
    mn = [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)]
    mx = [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]
    sz = [round(mx[0] - mn[0], 3), round(mx[1] - mn[1], 3), round(mx[2] - mn[2], 3)]
    return {"min": mn, "max": mx, "size": sz}


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


def inspect_glb(glb_path: str) -> dict:
    """Parse binary GLB JSON header to verify alphaMode, doubleSided, external URIs, and exact tri count."""
    with open(glb_path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", f"Not a valid GLB: {magic}"
    chunk_len, chunk_type = struct.unpack_from("<I4s", data, 12)
    assert chunk_type == b"JSON"
    gltf = json.loads(data[20 : 20 + chunk_len].decode("utf-8"))

    # Exact triangle count from primitives
    tris = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            idx_acc = prim.get("indices")
            if idx_acc is not None:
                tris += gltf["accessors"][idx_acc]["count"] // 3
            else:
                pos_acc = prim["attributes"]["POSITION"]
                tris += gltf["accessors"][pos_acc]["count"] // 3

    mats = gltf.get("materials", [])
    images = gltf.get("images", [])
    ext_uris = [img.get("uri") for img in images if img.get("uri")]
    return {
        "triangles": tris,
        "meshCount": len(gltf.get("meshes", [])),
        "materialCount": len(mats),
        "materials": [
            {
                "name": m.get("name"),
                "alphaMode": m.get("alphaMode"),
                "alphaCutoff": m.get("alphaCutoff"),
                "doubleSided": m.get("doubleSided"),
            }
            for m in mats
        ],
        "imageCount": len(images),
        "imageMimes": [img.get("mimeType") for img in images],
        "externalUris": ext_uris,
        "fileSizeBytes": len(data),
    }


# ---------------------------------------------------------------------------
# Sunlit July/August Pfalz Cycles Preview Renderer (1280x720)
# ---------------------------------------------------------------------------

def render_cycles_showcase(base_obj, render_path: str, aerial_path: str = ""):
    """
    Create a temporary 3x3 tiled sunlit Pfalz sunflower field (15m x 15m) on fertile Palatinate soil
    so the Cycles preview proves BOTH hero botanical craft AND seamless 5.0m grid tiling!
    """
    scene = bpy.context.scene
    preview_col = bpy.data.collections.new("CyclesPreviewStage")
    scene.collection.children.link(preview_col)

    # Instance a seamless 3x3 patch field (15m x 15m) using linked mesh duplicates!
    clones = []
    for gx in (-1, 0, 1):
        for gy in (-1, 0, 1):
            if gx == 0 and gy == 0:
                continue
            dup = bpy.data.objects.new(f"SunflowerTile_{gx}_{gy}", base_obj.data)
            dup.location = (gx * 5.0, gy * 5.0, 0.0)
            preview_col.objects.link(dup)
            clones.append(dup)

    # Rich sunlit Palatinate loamy farmland soil plane
    mat_soil = bpy.data.materials.new("Pfalz_Soil_Preview")
    s_nodes = mat_soil.node_tree.nodes
    s_links = mat_soil.node_tree.links
    s_bsdf = s_nodes.get("Principled BSDF")
    s_bsdf.inputs["Roughness"].default_value = 0.96
    noise = s_nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 6.0
    ramp = s_nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (0.045, 0.032, 0.018, 1.0)
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = (0.115, 0.080, 0.046, 1.0)
    s_links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    s_links.new(ramp.outputs["Color"], s_bsdf.inputs["Base Color"])

    bpy.ops.mesh.primitive_plane_add(size=160.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.name = "PfalzSoilGround"
    ground.data.materials.append(mat_soil)
    for c_old in list(ground.users_collection):
        c_old.objects.unlink(ground)
    preview_col.objects.link(ground)

    # Configure Cycles (fast, crisp, denoised, high transparent bounces for stacked alpha foliage!)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 56
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 2
    scene.cycles.transparent_max_bounces = 28
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Punchy"
    except Exception:
        pass
    scene.view_settings.exposure = 0.25

    # Crisp bright Palatinate July Blue Sky (ambient sky dome without double-sun blow-out!)
    world = bpy.data.worlds.new("PfalzSummerSky")
    scene.world = world
    wnt = world.node_tree
    bg = wnt.nodes.get("Background")
    sky = wnt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = False
    sky.sun_elevation = math.radians(42.0)
    sky.sun_rotation = math.radians(150.0)
    sky.air_density = 1.1
    wnt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.16

    # Single crisp warm July afternoon Pfalz sun illuminating the south-facing blooms (-Y)!
    sun_data = bpy.data.lights.new("SummerSun", type="SUN")
    sun_data.energy = 4.2
    sun_data.angle = math.radians(1.0)
    sun_data.color = (1.0, 0.96, 0.86)
    sun_obj = bpy.data.objects.new("SummerSun", sun_data)
    sun_obj.rotation_euler = Euler((math.radians(46.0), math.radians(-14.0), math.radians(-24.0)), "XYZ")
    preview_col.objects.link(sun_obj)

    # Hero Camera: Tractor-cab / roadside 3/4 view showing front stalks in soil, neat 0.71m rows,
    # broad serrated heart leaves, and dazzling sea of golden sun-facing Fibonacci blooms!
    cam_data = bpy.data.cameras.new("TractorShowcaseCam")
    cam_data.lens = 38.0
    cam_obj = bpy.data.objects.new("TractorShowcaseCam", cam_data)
    cam_obj.location = Vector((-6.8, -11.4, 2.45))
    target = Vector((0.4, -1.6, 1.10))
    cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    preview_col.objects.link(cam_obj)
    scene.camera = cam_obj

    os.makedirs(os.path.dirname(render_path), exist_ok=True)
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered sunlit Cycles tractor-level showcase -> {render_path}")

    # Optional aerial 45-deg drone verification render
    if aerial_path:
        cam_data.lens = 35.0
        cam_obj.location = Vector((-5.5, -10.5, 11.8))
        target_a = Vector((0.0, 0.0, 1.0))
        cam_obj.rotation_euler = (target_a - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.resolution_x = 960
        scene.render.resolution_y = 540
        scene.cycles.samples = 36
        os.makedirs(os.path.dirname(aerial_path), exist_ok=True)
        scene.render.filepath = aerial_path
        bpy.ops.render.render(write_still=True)
        print(f"Rendered aerial drone verification -> {aerial_path}")

    # Clean up temporary preview stage before saving clean .blend!
    for obj in list(preview_col.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(preview_col)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", type=str, default="", help="1280x720 Cycles showcase render PNG")
    parser.add_argument("--aerial", type=str, default="", help="Optional aerial check render PNG")
    parser.add_argument("--no-normal", action="store_true", help="Omit normal map to keep GLB smaller")
    parser.add_argument("--with-roughness", action="store_true", help="Include roughness map")
    args = parser.parse_args(argv)

    clear_scene()
    col = bpy.data.collections.new("Crop_Sunflower_Patch")
    bpy.context.scene.collection.children.link(col)

    obj = build_sunflower_patch(
        col,
        use_normal=not args.no_normal,
        use_roughness=args.with_roughness,
    )

    export_glb(obj, GLB_OUT)
    info = inspect_glb(GLB_OUT)
    bbox = compute_gltf_bbox(obj)

    print(
        f"Exported {GLB_OUT}:\n"
        f"  size:      {info['fileSizeBytes']/1024:.1f} KB ({info['fileSizeBytes']} bytes)\n"
        f"  triangles: {info['triangles']}\n"
        f"  bounds:    size={bbox['size']} min={bbox['min']} max={bbox['max']}\n"
        f"  materials: {info['materials']}\n"
        f"  images:    {info['imageCount']} ({info['imageMimes']}), externalURIs={info['externalUris']}"
    )

    meta = {
        "id": "crop_sunflower_patch",
        "key": "crop_sunflower_patch",
        "cropType": "sunflower",
        "germanName": "Sonnenblumenfeld",
        "glbPath": "/assets/models/fields/sunflower/crop_sunflower_patch.glb",
        "blendSource": "blender/fields/sunflower/sunflower_field.blend",
        "coordinateSystem": "Three.js Y-up meters (+X East / along rows, -Z North, +Y Up, blooms angled toward +Z South sun)",
        "bounds": bbox["size"],
        "boundsDetail": bbox,
        "groundContactY": 0.0,
        "undergroundSkirtM": 0.25,
        "canopyHeightRangeM": [1.65, 1.85],
        "rowCount": 7,
        "rowSpacingM": round(5.0 / 7.0, 3),
        "rowAxis": "+X",
        "bloomFacingAxis": "+Z",
        "triangles": info["triangles"],
        "meshCount": info["meshCount"],
        "materialCount": info["materialCount"],
        "alphaMode": info["materials"][0]["alphaMode"] if info["materials"] else "MASK",
        "alphaCutoff": info["materials"][0]["alphaCutoff"] if info["materials"] and info["materials"][0]["alphaCutoff"] is not None else 0.5,
        "doubleSided": info["materials"][0]["doubleSided"] if info["materials"] else True,
        "fileSizeBytes": info["fileSizeBytes"],
        "spacingM": 5.0,
        "alongRowM": 5.0,
        "betweenBaysM": 5.0,
        "recommendedGridSpacingM": 5.0,
        "instancing": {
            "gridSpacingM": 5.0,
            "alongRowM": 5.0,
            "betweenRowsM": 5.0,
        },
        "windSway": 0.14,
        "windSwayStrength": 0.14,
    }
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote metadata -> {META_OUT}")

    # Save clean .blend with packed textures
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"Saved Blender source -> {BLEND_OUT}")

    # Render Cycles showcase if requested
    if args.render:
        render_cycles_showcase(obj, args.render, aerial_path=args.aerial)


if __name__ == "__main__":
    main()
