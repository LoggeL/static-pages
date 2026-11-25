#!/usr/bin/env python3
"""
Blender 5.2 Vorderpfalz Sugar Beet / Root Crop Row Bay Builder (Zuckerrübenfeld)
for Kindenheim (Rheinland-Pfalz, Germany).

Builds and exports a botanically realistic, GPU-instancing-ready 5-row sugar beet bay:
  - public/assets/models/fields/sugarbeet/crop_sugarbeet_row.glb
      * 6.0m long along local +X (X in [-3.0, +3.0]), seamless end-to-end tiling
      * 2.5m wide across 5 crisp 0.50m agricultural rows (Y_blender / Z_gltf in [-1.25, +1.25])
      * ~0.48m crop height above ground + -0.22m underground skirt (zero floating on hills!)
      * 170 triangles (85 quads), single unified PBR MASK + doubleSided material (1 GPU draw call!)
      * Organic multi-layered rosette cluster architecture (NO straight tent ridges!)
      * < 350 KB total GLB size, 0 external URIs, Y-up glTF 2.0
  - public/assets/models/fields/sugarbeet/meta.json
  - blender/fields/sugarbeet/crop_sugarbeet_row.blend
  - Optional sunlit 1280x720 Cycles showcase render (--render <png_path>)

Run via:
  /opt/homebrew/bin/blender --background --python blender/fields/sugarbeet/build_sugarbeet.py -- \
    --render /path/to/preview_sugarbeet_field.png
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
WORK_DIR = os.path.join(PROJECT_ROOT, "blender/fields/sugarbeet")
TEX_DIR = os.path.join(WORK_DIR, "textures")
BLEND_OUT = os.path.join(WORK_DIR, "crop_sugarbeet_row.blend")
OUT_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/fields/sugarbeet")
GLB_OUT = os.path.join(OUT_DIR, "crop_sugarbeet_row.glb")
META_OUT = os.path.join(OUT_DIR, "meta.json")

os.makedirs(WORK_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Atlas UV Band Constants (exact pixel-safe bounds matching generate_textures.py)
# ---------------------------------------------------------------------------
# Band 1: Seamless top-down 6-rosette canopy row (U in 0..1 wraps cleanly)
UV_TOP_V0, UV_TOP_V1 = 0.652, 0.996
# Band 2: Seamless side-profile 6-rosette foliage wall + underground soil skirt
UV_SIDE_V0, UV_SIDE_V1 = 0.304, 0.637
# Band 3A: Dark fertile Palatinate loam soil ridge (seamless U in 0.004..0.406)
UV_SOIL_U0, UV_SOIL_U1 = 0.004, 0.406
UV_SOIL_V0, UV_SOIL_V1 = 0.004, 0.289
# Band 3B & 3C: Standalone full-silhouette rosette clumps (for diagonal cross-cards)
UV_CLUMP_A = (0.422, 0.703, 0.004, 0.289)
UV_CLUMP_B = (0.715, 0.996, 0.004, 0.289)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_image_packed(path: str, colorspace: str = "sRGB"):
    img = bpy.data.images.load(path, check_existing=True)
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    img.pack()
    return img


def make_sugarbeet_material():
    """
    Single unified glTF-compliant PBR MASK + doubleSided material for the sugar beet bay:
      - Albedo + crisp Alpha cutout (Math ROUND -> glTF alphaMode: "MASK", alpha_threshold=0.45)
      - Tangent-space Normal map (crinkled bullate leaves, raised pale veins, crumbly loam clods)
      - ORM Roughness/Metallic map (waxy glossy foliage ~0.44..0.54 vs matte fertile loam ~0.92)
    """
    albedo_path = os.path.join(TEX_DIR, "sugarbeet_atlas_albedo.png")
    normal_path = os.path.join(TEX_DIR, "sugarbeet_atlas_normal.png")
    orm_path = os.path.join(TEX_DIR, "sugarbeet_atlas_orm.png")

    mat = bpy.data.materials.new(name="SugarBeet_PBR_Mat")
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.48
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.36

    # Albedo + MASK alpha cutout
    tex_alb = nodes.new("ShaderNodeTexImage")
    tex_alb.image = load_image_packed(albedo_path, "sRGB")
    tex_alb.extension = "REPEAT"
    links.new(tex_alb.outputs["Color"], bsdf.inputs["Base Color"])

    # Blender 5.2 glTF exporter maps ShaderNodeMath(ROUND) on Alpha -> glTF alphaMode: "MASK"
    math_round = nodes.new("ShaderNodeMath")
    math_round.operation = "ROUND"
    links.new(tex_alb.outputs["Alpha"], math_round.inputs[0])
    links.new(math_round.outputs["Value"], bsdf.inputs["Alpha"])
    mat.alpha_threshold = 0.45

    # Normal map (crinkled/savoyed leaves + veins + soil clods)
    if os.path.exists(normal_path):
        tex_nrm = nodes.new("ShaderNodeTexImage")
        tex_nrm.image = load_image_packed(normal_path, "Non-Color")
        tex_nrm.extension = "REPEAT"
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 0.95
        links.new(tex_nrm.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    # ORM map: Green -> Roughness, Blue -> Metallic (packed natively as glTF metallicRoughnessTexture)
    if os.path.exists(orm_path):
        tex_orm = nodes.new("ShaderNodeTexImage")
        tex_orm.image = load_image_packed(orm_path, "Non-Color")
        tex_orm.extension = "REPEAT"
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(tex_orm.outputs["Color"], sep.inputs["Color"])
        links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    mat.use_backface_culling = False  # glTF doubleSided: true
    return mat


def add_quad(bm, uv_layer, pts, uvs):
    verts = [bm.verts.new(p) for p in pts]
    f = bm.faces.new(verts)
    for lp, uv in zip(f.loops, uvs):
        lp[uv_layer].uv = uv
    return f


def build_sugarbeet_row_bay(col):
    """
    Build the 6.0m x 2.5m 5-row sugar beet bay (Zuckerrübenfeld) in Blender Z-up:
      - 5 parallel agricultural rows at Y = -1.00, -0.50, 0.00, +0.50, +1.00 (0.50m spacing)
      - Seamless X in [-3.00, +3.00]
      - Underground root & loam skirt down to Z = -0.22m (zero floating on slopes!)
      - Organic multi-layered rosette clusters peaking at Z = 0.44..0.48m with ZERO straight tent seams!
      - Crisp ~12-15cm dark fertile Palatinate loam soil furrow visible between every lush green row!
      - 85 quads = 170 triangles total (single mesh, 1 draw call, smooth dome-biased foliage normals)
    """
    rng = random.Random(49682)
    mat = make_sugarbeet_material()

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    foliage_faces = []
    soil_faces = []

    row_ys = [-1.00, -0.50, 0.00, +0.50, +1.00]
    x_stops = [-3.0, 0.0, 3.0]

    for r_idx, y0 in enumerate(row_ys):
        u_phase_top = r_idx * 0.37
        u_phase_side = r_idx * 0.43 + 0.19

        # ---------------------------------------------------------------------
        # 1. DARK FERTILE PALATINATE LOAM FURROW BED & -0.22m UNDERGROUND SKIRT
        #    3 quads (6 tris) per row -> 30 tris total across 5 rows
        #    Low neat earth bed spanning y0 +/- 0.238m at Z = 0.015..0.024m with
        #    steep skirts descending to Z = -0.220m so zero slopes show floating gaps
        #    and crisp dark chocolate soil reads clearly between all 5 green rows!
        # ---------------------------------------------------------------------
        soil_profile = [
            (y0 - 0.246, -0.220, UV_SOIL_V0),
            (y0 - 0.232,  0.016, UV_SOIL_V0 + 0.22 * (UV_SOIL_V1 - UV_SOIL_V0)),
            (y0 + 0.232,  0.016, UV_SOIL_V1 - 0.22 * (UV_SOIL_V1 - UV_SOIL_V0)),
            (y0 + 0.246, -0.220, UV_SOIL_V1),
        ]
        su0, su1 = (UV_SOIL_U0, UV_SOIL_U1) if (r_idx % 2 == 0) else (UV_SOIL_U1, UV_SOIL_U0)
        for p_i in range(len(soil_profile) - 1):
            ya, za, va = soil_profile[p_i]
            yb, zb, vb = soil_profile[p_i + 1]
            f = add_quad(
                bm, uv_layer,
                [
                    Vector((-3.0, ya, za)),
                    Vector(( 3.0, ya, za)),
                    Vector(( 3.0, yb, zb)),
                    Vector((-3.0, yb, zb)),
                ],
                [(su0, va), (su1, va), (su1, vb), (su0, vb)],
            )
            soil_faces.append(f)

        # ---------------------------------------------------------------------
        # 2. OUTWARD-SPLAYING BOUQUET/FOUNTAIN BROAD-LEAF CURTAINS (2 sides x 2 X-segs)
        #    4 quads (8 tris) per row -> 40 tris total across 5 rows
        #    Mimics authentic Beta vulgaris rosette growth: leaves burst from the
        #    crown base (y0 +/- 0.048, Z=-0.20m) and arch gracefully OUTWARD to
        #    y0 +/- 0.196m, Z=0.42..0.46m — enveloping the inner rosette core!
        #    Tiled U=0..3.0 across 6m (15 wide plump rosettes/row -> seamless!)
        # ---------------------------------------------------------------------
        for side in (-1.0, 1.0):
            y_bot = y0 + side * 0.048
            y_top_end = y0 + side * (0.194 + rng.uniform(-0.010, 0.010))
            y_top_mid = y0 + side * (0.200 + rng.uniform(-0.012, 0.012))
            y_tops = [y_top_end, y_top_mid, y_top_end]

            z_end = 0.435 + rng.uniform(-0.018, 0.018)
            z_mid = 0.452 + rng.uniform(-0.018, 0.018)
            z_tops = [z_end, z_mid, z_end]

            u_dir = 1.0 if side > 0 else -1.0
            u_base = u_phase_side + (0.47 if side < 0 else 0.0)
            # 1.5 seamless repeats per 3m segment = 3.0 integer repeats across 6m (seamless bay-to-bay!)
            u_vals = [u_base, u_base + 1.5 * u_dir, u_base + 3.0 * u_dir]

            for seg in range(2):
                xa, xb = x_stops[seg], x_stops[seg + 1]
                yta, ytb = y_tops[seg], y_tops[seg + 1]
                zta, ztb = z_tops[seg], z_tops[seg + 1]
                ua, ub = u_vals[seg], u_vals[seg + 1]
                f = add_quad(
                    bm, uv_layer,
                    [
                        Vector((xa, y_bot, -0.200)),
                        Vector((xb, y_bot, -0.200)),
                        Vector((xb, ytb, ztb)),
                        Vector((xa, yta, zta)),
                    ],
                    [(ua, UV_SIDE_V0), (ub, UV_SIDE_V0), (ub, UV_SIDE_V1), (ua, UV_SIDE_V1)],
                )
                foliage_faces.append((f, y0))

        # ---------------------------------------------------------------------
        # 3. TUCKED LOW INNER-HEART ROSETTE CORE (2 X-segs -> 2 quads/row -> 20 tris)
        #    Nestled LOW inside the open V-fountain (Z = 0.14..0.18m, width y0 +/- 0.120m)
        #    so ZERO flat shelf edges ever poke past the arching outer leaves!
        #    Aerial views look straight into lush bright-heart star rosettes framed by
        #    deep-emerald splayed outer foliage & crisp ~11-13cm dark Palatinate loam furrows!
        # ---------------------------------------------------------------------
        u_top_vals = [u_phase_top, u_phase_top + 1.5, u_phase_top + 3.0]
        zc_end = 0.155 + rng.uniform(-0.014, 0.014)
        zc_mid = 0.172 + rng.uniform(-0.014, 0.014)
        zc_vals = [zc_end, zc_mid, zc_end]
        for seg in range(2):
            xa, xb = x_stops[seg], x_stops[seg + 1]
            za, zb = zc_vals[seg], zc_vals[seg + 1]
            ua, ub = u_top_vals[seg], u_top_vals[seg + 1]
            tilt_dz = 0.018 if ((seg + r_idx) % 2 == 0) else -0.018
            f_core = add_quad(
                bm, uv_layer,
                [
                    Vector((xa, y0 - 0.120, za - tilt_dz)),
                    Vector((xb, y0 - 0.120, zb - tilt_dz)),
                    Vector((xb, y0 + 0.120, zb + tilt_dz)),
                    Vector((xa, y0 + 0.120, za + tilt_dz)),
                ],
                [(ua, UV_TOP_V0), (ub, UV_TOP_V0), (ub, UV_TOP_V1), (ua, UV_TOP_V1)],
            )
            foliage_faces.append((f_core, y0))

        # ---------------------------------------------------------------------
        # 4. 8 STAGGERED VOLUMETRIC BROAD-LEAVED ROSETTE CROSS-CARDS (80 tris total!)
        #    40 plump individual beet rosette clusters across the 5 rows!
        #    Gently tilted (20..30 deg pitch lean + varied oblique yaw) so leaves
        #    catch warm overhead sunlight like natural arching rosettes (zero harsh dark fins!)
        # ---------------------------------------------------------------------
        row_x_shift = ((r_idx * 2) % 5 - 2) * 0.12
        for c_i in range(8):
            cx = -2.625 + c_i * 0.75 + row_x_shift + rng.uniform(-0.09, 0.09)
            cx = max(-2.80, min(2.80, cx))
            cy = y0 + rng.uniform(-0.022, 0.022)
            yaw_deg = (56.0 if (c_i + r_idx) % 2 == 0 else -56.0) + rng.uniform(-22.0, 22.0)
            pitch_deg = (24.0 if c_i % 2 == 0 else -24.0) + rng.uniform(-6.0, 6.0)
            card_w = rng.uniform(0.39, 0.45)
            z_bot = -0.200
            z_top = rng.uniform(0.435, 0.478)

            rot = Euler((math.radians(pitch_deg), 0.0, math.radians(yaw_deg)), "XYZ").to_matrix()
            center_bot = Vector((cx, cy, z_bot))
            half_vec = rot @ Vector((card_w * 0.5, 0.0, 0.0))
            tilt_top = rot @ Vector((0.0, 0.0, z_top - z_bot))

            p0 = center_bot - half_vec
            p1 = center_bot + half_vec
            p2 = center_bot + tilt_top + half_vec
            p3 = center_bot + tilt_top - half_vec
            for p in (p0, p1, p2, p3):
                p.y = max(y0 - 0.198, min(y0 + 0.198, p.y))
                p.x = max(-2.98, min(2.98, p.x))
                p.z = min(0.480, p.z)

            u0, u1, v0, v1 = UV_CLUMP_A if ((c_i + r_idx) % 2 == 0) else UV_CLUMP_B
            if rng.random() < 0.5:
                u0, u1 = u1, u0

            f_c = add_quad(
                bm, uv_layer,
                [p0, p1, p2, p3],
                [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
            )
            foliage_faces.append((f_c, y0))

    bm.normal_update()
    bm.faces.ensure_lookup_table()
    foliage_row_by_fidx = {f.index: ry0 for (f, ry0) in foliage_faces}

    mesh = bpy.data.meshes.new("Crop_SugarBeet_Row")
    bm.to_mesh(mesh)
    bm.free()

    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(mat)

    # Smooth plush botanical dome normals on foliage faces so crossed cards merge seamlessly
    # into volumetric leafy rosettes without harsh X-card light seams!
    loop_normals = [Vector((0.0, 0.0, 1.0))] * len(mesh.loops)
    verts = mesh.vertices
    for poly in mesh.polygons:
        if poly.index in foliage_row_by_fidx:
            ry0 = foliage_row_by_fidx[poly.index]
            for li in poly.loop_indices:
                vco = verts[mesh.loops[li].vertex_index].co
                dy = (vco.y - ry0) / 0.22
                dz = max(0.35, (vco.z + 0.22) / 0.68)
                n_dome = Vector((0.0, dy * 0.58, 0.84 + dz * 0.36)).normalized()
                # Preserve 22% of geometric plane normal for organic faceted leaf catching
                n_final = (n_dome * 0.78 + poly.normal * 0.22).normalized()
                loop_normals[li] = n_final
        else:
            n_geo = poly.normal.normalized()
            for li in poly.loop_indices:
                loop_normals[li] = n_geo

    mesh.normals_split_custom_set(loop_normals)

    obj = bpy.data.objects.new("Crop_SugarBeet_Row", mesh)
    col.objects.link(obj)
    return obj


def compute_gltf_bbox(obj):
    xs, ys, zs = [], [], []
    for corner in obj.bound_box:
        w = obj.matrix_world @ Vector(corner)
        # Blender (x, y, z) -> glTF Y-up (x, z, -y)
        xs.append(w.x)
        ys.append(w.z)
        zs.append(-w.y)
    mn = [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)]
    mx = [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]
    sz = [round(mx[i] - mn[i], 3) for i in range(3)]
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


def inspect_glb(glb_path: str):
    raw = open(glb_path, "rb").read()
    magic, version, total_len = struct.unpack_from("<III", raw, 0)
    chunk_len, chunk_type = struct.unpack_from("<II", raw, 12)
    gltf = json.loads(raw[20 : 20 + chunk_len].decode("utf-8"))

    tri_count = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                acc = gltf["accessors"][prim["indices"]]
                tri_count += acc["count"] // 3
            else:
                pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
                tri_count += pos_acc["count"] // 3

    mats = gltf.get("materials", [])
    imgs = gltf.get("images", [])
    ext_uris = [img["uri"] for img in imgs if "uri" in img]
    img_sizes = [
        (img.get("name", f"img{i}"), img.get("mimeType"), gltf["bufferViews"][img["bufferView"]]["byteLength"])
        for i, img in enumerate(imgs)
        if "bufferView" in img
    ]
    return {
        "fileSizeBytes": len(raw),
        "triangles": tri_count,
        "materials": mats,
        "externalUris": ext_uris,
        "images": img_sizes,
    }


def render_cycles_showcase(render_path: str, base_obj):
    """
    Render a sunlit 1280x720 Cycles showcase of a realistic tiled Vorderpfalz
    Zuckerrübenfeld (4x5 seamlessly instanced bays = 24m x 12.5m) with calibrated
    warm afternoon Palatinate daylight showing BOTH foreground botanical rosette
    detail AND crisp receding striped rows separated by dark fertile soil!
    """
    scene = bpy.context.scene
    prev_col = bpy.data.collections.new("Preview_Stage")
    scene.collection.children.link(prev_col)

    # Tile 5 bays along X (-6, 0, +6, +12, +18) x 6 bays across Y (-5.0..+7.5)
    base_obj.location = (0.0, 0.0, 0.0)
    for ix in (-1, 0, 1, 2, 3):
        for iy in (-2, -1, 0, 1, 2, 3):
            if ix == 0 and iy == 0:
                continue
            dup = bpy.data.objects.new(f"Bay_{ix}_{iy}", base_obj.data)
            dup.location = (ix * 6.0, iy * 2.5, 0.0)
            prev_col.objects.link(dup)

    # Dark fertile Palatinate loam field floor (textured with procedural loam noise so horizon looks authentic)
    soil_mat = bpy.data.materials.new("Preview_Pfalz_Loam")
    snt = soil_mat.node_tree
    snodes = snt.nodes
    slinks = snt.links
    sbsdf = snodes.get("Principled BSDF")
    sbsdf.inputs["Roughness"].default_value = 0.94
    sbsdf.inputs["Specular IOR Level"].default_value = 0.15
    noise = snodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 8.0
    ramp = snodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (0.042, 0.029, 0.017, 1.0)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.095, 0.070, 0.042, 1.0)
    slinks.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    slinks.new(ramp.outputs["Color"], sbsdf.inputs["Base Color"])

    bpy.ops.mesh.primitive_plane_add(size=160.0, location=(10.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.data.materials.append(soil_mat)

    # Cycles CPU renderer (crisp denoised natural sunlight!)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 56
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transparent_max_bounces = 18
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.22

    # Calibrated summer Palatinate sky (crisp sunlit July Vorderpfalz blue sky dome!)
    world = bpy.data.worlds.new("PfalzSummerSky")
    scene.world = world
    wnt = world.node_tree
    wnodes = wnt.nodes
    wlinks = wnt.links
    bg = wnodes.get("Background")
    tex_coord = wnodes.new("ShaderNodeTexCoord")
    sep_xyz = wnodes.new("ShaderNodeSeparateXYZ")
    wlinks.new(tex_coord.outputs["Generated"], sep_xyz.inputs["Vector"])
    sky_ramp = wnodes.new("ShaderNodeValToRGB")
    sky_ramp.color_ramp.elements[0].position = 0.0
    sky_ramp.color_ramp.elements[0].color = (0.72, 0.85, 0.98, 1.0)  # Bright crisp Pfalz horizon
    sky_ramp.color_ramp.elements[1].position = 0.42
    sky_ramp.color_ramp.elements[1].color = (0.20, 0.48, 0.92, 1.0)  # Clean summer blue zenith
    wlinks.new(sep_xyz.outputs["Z"], sky_ramp.inputs["Fac"])
    wlinks.new(sky_ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.92

    # Single crisp warm Palatinate summer sun casting rich leaf shadows & waxy highlights!
    sun_data = bpy.data.lights.new("PfalzSun", type="SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(1.0)
    sun_data.color = (1.0, 0.96, 0.88)
    sun_obj = bpy.data.objects.new("PfalzSun", sun_data)
    # Cross-lighting (~38 deg elevation, sweeping diagonally across rows for rich furrow shadows!)
    sun_obj.rotation_euler = Euler((math.radians(50.0), math.radians(16.0), math.radians(-48.0)), "XYZ")
    prev_col.objects.link(sun_obj)

    # Showcase camera: low-oblique tractor-eye angle (~1.42m height) looking diagonally down
    # the neat 0.5m rows so close foreground rosettes AND dark fertile soil furrows shine!
    cam_data = bpy.data.cameras.new("SugarBeetShowcaseCam")
    cam_data.lens = 40.0
    cam_obj = bpy.data.objects.new("SugarBeetShowcaseCam", cam_data)
    cam_obj.location = Vector((-4.6, -2.8, 1.42))
    target = Vector((4.8, 1.35, 0.16))
    cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    prev_col.objects.link(cam_obj)
    scene.camera = cam_obj

    os.makedirs(os.path.dirname(render_path), exist_ok=True)
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Cycles showcase -> {render_path}")

    # Also render a quick aerial-oblique check into scratch/ so we verify aerial row striping!
    aerial_path = os.path.join(os.path.dirname(render_path), "scratch", "check_aerial_sugarbeet.png")
    os.makedirs(os.path.dirname(aerial_path), exist_ok=True)
    scene.cycles.samples = 32
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    cam_obj.location = Vector((-4.5, -10.5, 11.5))
    target_a = Vector((4.5, 1.5, 0.2))
    cam_obj.rotation_euler = (target_a - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = aerial_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Cycles aerial check -> {aerial_path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", type=str, default="", help="Optional 1280x720 Cycles showcase PNG path")
    args = parser.parse_args(argv)

    clear_scene()
    col = bpy.data.collections.new("Crop_SugarBeet")
    bpy.context.scene.collection.children.link(col)

    obj = build_sugarbeet_row_bay(col)

    # 1. Save clean single origin-centered production .blend BEFORE any preview stage
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"Saved clean production .blend -> {BLEND_OUT}")

    # 2. Export GPU-instancing-ready .glb
    export_glb(obj, GLB_OUT)
    bbox = compute_gltf_bbox(obj)
    info = inspect_glb(GLB_OUT)

    print(
        f"Exported crop_sugarbeet_row.glb: "
        f"{info['fileSizeBytes']/1024:.1f} KB, "
        f"{info['triangles']} tris, "
        f"size={bbox['size']}, min={bbox['min']}, max={bbox['max']}"
    )
    print(f"  External URIs: {len(info['externalUris'])}")
    print(f"  Embedded images: {info['images']}")
    for m in info["materials"]:
        print(
            f"  Material '{m.get('name')}': alphaMode={m.get('alphaMode')}, "
            f"doubleSided={m.get('doubleSided')}, alphaCutoff={m.get('alphaCutoff')}"
        )

    # 3. Write clean public/assets/models/fields/sugarbeet/meta.json
    meta = {
        "id": "crop_sugarbeet_row",
        "cropType": "sugarbeet",
        "displayName": "Zuckerrübenfeld (Vorderpfalz Sugar Beet Row Bay)",
        "glbPath": "/assets/models/fields/sugarbeet/crop_sugarbeet_row.glb",
        "coordinateSystem": "Three.js Y-up meters (rows along local +X, 5 parallel 0.5m rows across local Z)",
        "bounds": bbox["size"],
        "boundsDetail": bbox,
        "rowsPerBay": 5,
        "rowSpacingM": 0.5,
        "undergroundSkirtM": 0.22,
        "cropHeightM": bbox["max"][1],
        "triangles": info["triangles"],
        "fileSizeBytes": info["fileSizeBytes"],
        "spacing": {
            "alongRowM": 6.0,
            "betweenBaysM": 2.5,
        },
        "windSwayStrength": 0.05,
        "alphaMode": "MASK",
        "doubleSided": True,
    }
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote metadata -> {META_OUT}")

    # 4. Optional Cycles visual verification render
    if args.render:
        render_cycles_showcase(args.render, obj)


if __name__ == "__main__":
    main()
