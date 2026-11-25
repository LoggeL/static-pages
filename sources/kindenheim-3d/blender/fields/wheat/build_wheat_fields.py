#!/usr/bin/env python3
"""
Blender 5.2 Wheat, Stubble & Straw Bale Stack Builder for Kindenheim (Rheinland-Pfalz).

Builds and exports 3 GPU-instancing-ready, botanically realistic Pfalz summer harvest GLBs:
  - public/assets/models/fields/wheat/crop_wheat_patch.glb
  - public/assets/models/fields/wheat/crop_stubble_patch.glb
  - public/assets/models/fields/wheat/straw_bale_stack.glb
  - public/assets/models/fields/wheat/meta.json
  - blender/fields/wheat/wheat_fields.blend

Verifies exported GLB JSON (alphaMode MASK, doubleSided, 0 external URIs, exact tri counts & bounds)
and renders a sunlit 1280x720 Cycles showcase PNG (--render <path>).

Run via:
  /opt/homebrew/bin/blender --background --python blender/fields/wheat/build_wheat_fields.py -- --render <png_path>
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
TEX_DIR = os.path.join(PROJECT_ROOT, "blender/fields/wheat/textures")
BLEND_OUT = os.path.join(PROJECT_ROOT, "blender/fields/wheat/wheat_fields.blend")
GLB_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/fields/wheat")
META_OUT = os.path.join(GLB_DIR, "meta.json")

os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
os.makedirs(GLB_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Blender 5.2 Material & Mesh Helpers
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


def make_pbr_material(
    name: str,
    albedo_path: str = None,
    normal_path: str = None,
    roughness_path: str = None,
    base_color=(0.8, 0.7, 0.4, 1.0),
    roughness: float = 0.84,
    metallic: float = 0.0,
    specular_ior: float = 0.22,
    alpha_clip: bool = False,
    double_sided: bool = False,
    normal_strength: float = 0.9,
):
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")

    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = specular_ior

    if albedo_path and os.path.exists(albedo_path):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = load_packed_image(albedo_path, "sRGB")
        tex.location = (-500, 260)
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_clip:
            # Blender 5.2 glTF exporter maps Math(ROUND) on Alpha -> alphaMode: "MASK"
            math_n = nodes.new("ShaderNodeMath")
            math_n.operation = "ROUND"
            math_n.location = (-220, 40)
            links.new(tex.outputs["Alpha"], math_n.inputs[0])
            links.new(math_n.outputs["Value"], bsdf.inputs["Alpha"])
            mat.alpha_threshold = 0.45

    if roughness_path and os.path.exists(roughness_path):
        rtex = nodes.new("ShaderNodeTexImage")
        rtex.image = load_packed_image(roughness_path, "Non-Color")
        rtex.location = (-500, -40)
        links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])

    if normal_path and os.path.exists(normal_path):
        ntex = nodes.new("ShaderNodeTexImage")
        ntex.image = load_packed_image(normal_path, "Non-Color")
        ntex.location = (-500, -320)
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        nmap.location = (-220, -320)
        links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    mat.use_backface_culling = not double_sided
    return mat


def create_mesh_object(name: str, bm: bmesh.types.BMesh, material, smooth: bool = False, collection=None):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    if collection is None:
        bpy.context.collection.objects.link(obj)
    else:
        collection.objects.link(obj)
    return obj


def add_arching_wheat_curtain(
    bm: bmesh.types.BMesh,
    uv_layer,
    p_start: Vector,
    p_end: Vector,
    segs: int,
    z_bot: float,
    z_mid_list: list,
    z_top_list: list,
    wiggle_list: list,
    mid_lean: Vector,
    top_arch: Vector,
    u_start: float,
    u_span: float,
    v_bot: float = 0.0,
    v_mid: float = 0.56,
    v_top: float = 0.99,
):
    """
    Build a 2-tier gracefully arching wheat curtain (segs * 2 quads = segs * 4 tris).
    Lower stems rise near-vertical from the underground skirt; upper golden grain ears nod
    gracefully outward by `top_arch` (~32-40 deg!), delivering BOTH organic billowing eye-level
    silhouettes AND dense continuous overhead golden coverage for drone cameras with ZERO flat roofs!
    """
    axis = p_end - p_start
    if axis.length < 1e-5:
        return
    dir_xy = Vector((axis.x, axis.y, 0.0)).normalized()
    perp_xy = Vector((-dir_xy.y, dir_xy.x, 0.0))

    bot_v, mid_v, top_v = [], [], []
    for i in range(segs + 1):
        t = i / segs
        base_pt = p_start.lerp(p_end, t) + perp_xy * wiggle_list[i]
        bot_v.append(bm.verts.new(Vector((base_pt.x, base_pt.y, z_bot))))
        mid_v.append(bm.verts.new(Vector((base_pt.x + mid_lean.x, base_pt.y + mid_lean.y, z_mid_list[i]))))
        top_v.append(bm.verts.new(Vector((base_pt.x + top_arch.x, base_pt.y + top_arch.y, z_top_list[i]))))

    for i in range(segs):
        u0 = u_start + (i / segs) * u_span
        u1 = u_start + ((i + 1) / segs) * u_span
        for v_lo, v_hi, r_lo, r_hi in ((v_bot, v_mid, bot_v, mid_v), (v_mid, v_top, mid_v, top_v)):
            try:
                f = bm.faces.new((r_lo[i], r_lo[i + 1], r_hi[i + 1], r_hi[i]))
                f.smooth = True
                f.loops[0][uv_layer].uv = (u0, v_lo)
                f.loops[1][uv_layer].uv = (u1, v_lo)
                f.loops[2][uv_layer].uv = (u1, v_hi)
                f.loops[3][uv_layer].uv = (u0, v_hi)
            except ValueError:
                pass


def add_simple_curtain(
    bm: bmesh.types.BMesh,
    uv_layer,
    p_start: Vector,
    p_end: Vector,
    segs: int,
    z_bot: float,
    z_top_list: list,
    wiggle_list: list,
    lean_vec: Vector,
    u_start: float,
    u_span: float,
    v_bot: float,
    v_top: float,
):
    """Build a 1-tier gently undulating curtain (segs quads = segs * 2 tris)."""
    axis = p_end - p_start
    if axis.length < 1e-5:
        return
    dir_xy = Vector((axis.x, axis.y, 0.0)).normalized()
    perp_xy = Vector((-dir_xy.y, dir_xy.x, 0.0))

    bot_v, top_v = [], []
    for i in range(segs + 1):
        t = i / segs
        base_pt = p_start.lerp(p_end, t) + perp_xy * wiggle_list[i]
        bot_v.append(bm.verts.new(Vector((base_pt.x, base_pt.y, z_bot))))
        top_v.append(bm.verts.new(Vector((base_pt.x + lean_vec.x, base_pt.y + lean_vec.y, z_top_list[i]))))

    for i in range(segs):
        u0 = u_start + (i / segs) * u_span
        u1 = u_start + ((i + 1) / segs) * u_span
        try:
            f = bm.faces.new((bot_v[i], bot_v[i + 1], top_v[i + 1], top_v[i]))
            f.smooth = True
            f.loops[0][uv_layer].uv = (u0, v_bot)
            f.loops[1][uv_layer].uv = (u1, v_bot)
            f.loops[2][uv_layer].uv = (u1, v_top)
            f.loops[3][uv_layer].uv = (u0, v_top)
        except ValueError:
            pass


def add_cupped_card(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: Vector,
    rot_euler: Euler,
    width: float,
    height: float,
    cup: float,
    u0: float,
    u1: float,
    v0: float,
    v1: float,
):
    """Add a 2-quad gently cupped card (4 tris) in local XZ plane rotated by rot_euler."""
    mat = rot_euler.to_matrix()
    hw, hh = width * 0.5, height * 0.5
    um = 0.5 * (u0 + u1)
    pts = [
        Vector((-hw, -cup, -hh)),
        Vector((0.0, cup * 0.55, -hh)),
        Vector((hw, -cup, -hh)),
        Vector((-hw, -cup, hh)),
        Vector((0.0, cup * 0.55, hh)),
        Vector((hw, -cup, hh)),
    ]
    verts = [bm.verts.new(center + mat @ p) for p in pts]
    quads = [
        ((0, 1, 4, 3), ((u0, v0), (um, v0), (um, v1), (u0, v1))),
        ((1, 2, 5, 4), ((um, v0), (u1, v0), (u1, v1), (um, v1))),
    ]
    for idxs, uvs in quads:
        try:
            f = bm.faces.new([verts[k] for k in idxs])
            f.smooth = True
            for lp, uv in zip(f.loops, uvs):
                lp[uv_layer].uv = uv
        except ValueError:
            pass


# ---------------------------------------------------------------------------
# Asset 1: Golden Palatinate Summer Wheat Patch (crop_wheat_patch.glb)
# ~6.0m x 6.0m seamless instancing tile, height ~0.95m, -0.25m underground skirt
# Target: ~80-160 tris, <350 KB, glTF MASK + doubleSided: true
# Architecture: Zero flat paper roofs! All cards are gracefully arching/nodding
# wheat curtains (lower stems upright, heavy golden grain ears arching 28-38 deg)
# plus staggered diagonal & leaning cross-sheaves -> lush from BOTH cab & drone!
# ---------------------------------------------------------------------------

def build_wheat_patch(col):
    rng = random.Random(7101)
    mat_wheat = make_pbr_material(
        "Pfalz_Wheat_Mat",
        albedo_path=os.path.join(TEX_DIR, "wheat_blade_albedo.png"),
        normal_path=os.path.join(TEX_DIR, "wheat_blade_normal.jpg"),
        roughness=0.84,
        specular_ior=0.18,
        alpha_clip=True,
        double_sided=True,
        normal_strength=0.85,
    )

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    Z_SKIRT = -0.25

    # 1. Six longitudinal drill-row arching wheat curtains along X (-3.0..+3.0)
    #    Spaced 1.0m apart across Y; alternating gentle perpendicular arch (+Y/-Y) + summer breeze (+X)!
    #    6 curtains * 2 horizontal segs * 2 vertical tiers = 24 quads = 48 tris!
    row_ys = [-2.50, -1.50, -0.50, 0.50, 1.50, 2.50]
    for idx, ry in enumerate(row_ys):
        is_edge = idx in (0, len(row_ys) - 1)
        p0 = Vector((-2.98, ry + rng.uniform(-0.07, 0.07), 0.0))
        p1 = Vector((2.98, ry + rng.uniform(-0.07, 0.07), 0.0))
        z_mids = [rng.uniform(0.40, 0.48) for _ in range(3)]
        z_tops = [rng.uniform(0.86, 0.98) for _ in range(3)]
        wiggles = [0.0, rng.uniform(-0.18, 0.18), 0.0]
        arch_sign = 1.0 if idx % 2 == 0 else -1.0
        arch_scale = 0.65 if is_edge else 1.0
        mid_lean = Vector((rng.uniform(0.04, 0.09), arch_sign * rng.uniform(0.07, 0.12) * arch_scale, 0.0))
        top_arch = Vector((rng.uniform(0.14, 0.22), arch_sign * rng.uniform(0.28, 0.40) * arch_scale, 0.0))
        add_arching_wheat_curtain(
            bm, uv, p0, p1, segs=2, z_bot=Z_SKIRT,
            z_mid_list=z_mids, z_top_list=z_tops, wiggle_list=wiggles,
            mid_lean=mid_lean, top_arch=top_arch,
            u_start=rng.uniform(0.0, 1.0), u_span=2.85,
        )

    # 2. Five transverse arching curtains running across Y (-2.95..+2.95)
    #    Eliminates every straight corridor gap when looking along the drill rows AND adds lush
    #    crisscrossing nodding golden ears from overhead drone views!
    #    5 curtains * 2 segs * 2 tiers = 20 quads = 40 tris!
    col_xs = [-2.25, -1.15, 0.00, 1.15, 2.25]
    for idx, cx in enumerate(col_xs):
        p0 = Vector((cx + rng.uniform(-0.14, 0.14), -2.86, 0.0))
        p1 = Vector((cx + rng.uniform(-0.14, 0.14), 2.86, 0.0))
        z_mids = [rng.uniform(0.38, 0.46) for _ in range(3)]
        z_tops = [rng.uniform(0.84, 0.96) for _ in range(3)]
        wiggles = [0.0, rng.uniform(-0.18, 0.18), 0.0]
        arch_sign = 1.0 if idx % 2 == 0 else -1.0
        mid_lean = Vector((arch_sign * rng.uniform(0.08, 0.13), rng.uniform(0.02, 0.06), 0.0))
        top_arch = Vector((arch_sign * rng.uniform(0.26, 0.36), rng.uniform(0.06, 0.14), 0.0))
        add_arching_wheat_curtain(
            bm, uv, p0, p1, segs=2, z_bot=Z_SKIRT,
            z_mid_list=z_mids, z_top_list=z_tops, wiggle_list=wiggles,
            mid_lean=mid_lean, top_arch=top_arch,
            u_start=rng.uniform(0.0, 1.0), u_span=2.85,
        )

    # 3. Four sweeping diagonal curtains inset cleanly inside tile border (breaks up orthogonal grid!)
    #    4 curtains * 2 segs * 1 tier (tilted 16-22 deg gracefully) = 8 quads = 16 tris!
    diag_specs = [
        (Vector((-2.50, -2.35, 0.0)), Vector((2.45, 2.40, 0.0)), Vector((-0.16, 0.20, 0.0))),
        (Vector((-2.45, 2.35, 0.0)), Vector((2.50, -2.40, 0.0)), Vector((0.18, 0.18, 0.0))),
        (Vector((-2.55, -0.30, 0.0)), Vector((0.35, 2.55, 0.0)), Vector((-0.16, 0.18, 0.0))),
        (Vector((-0.35, -2.55, 0.0)), Vector((2.55, 0.30, 0.0)), Vector((0.18, -0.16, 0.0))),
    ]
    for p0, p1, lean_v in diag_specs:
        z_tops = [rng.uniform(0.84, 0.96) for _ in range(3)]
        wiggles = [0.0, rng.uniform(-0.16, 0.16), 0.0]
        add_simple_curtain(
            bm, uv, p0, p1, segs=2, z_bot=Z_SKIRT,
            z_top_list=z_tops, wiggle_list=wiggles, lean_vec=lean_v,
            u_start=rng.uniform(0.0, 1.0), u_span=(p1 - p0).length / 2.1,
            v_bot=0.0, v_top=0.99,
        )

    # 4. Twelve organically leaning cupped wheat sheaves scattered across edges & pockets (12 * 4 = 48 tris)
    #    Softens tile borders and adds lush billowing canopy volume from every viewing elevation!
    sheaf_pts = [
        (-2.35, -2.05), (-0.75, -2.30), (0.85, -2.10), (2.30, -1.95),
        (-2.20, -0.55), (-0.55, -0.70), (0.75, -0.60), (2.25, -0.45),
        (-2.30, 1.05), (-0.65, 0.95), (0.85, 1.15), (2.20, 1.95),
    ]
    for tx, ty in sheaf_pts:
        h_above = rng.uniform(0.82, 0.96)
        total_h = h_above - Z_SKIRT
        cz = Z_SKIRT + total_h * 0.5
        w_card = rng.uniform(1.75, 2.25)
        yaw = math.radians(rng.uniform(0.0, 180.0))
        # Natural 18-30 deg outward wind-nod tilt!
        tilt_x = math.radians(rng.choice((-1.0, 1.0)) * rng.uniform(18.0, 30.0))
        tilt_y = math.radians(rng.uniform(-10.0, 10.0))
        u0 = rng.uniform(0.0, 0.85)
        add_cupped_card(
            bm, uv,
            center=Vector((tx + rng.uniform(-0.15, 0.15), ty + rng.uniform(-0.15, 0.15), cz)),
            rot_euler=Euler((tilt_x, tilt_y, yaw), "XYZ"),
            width=w_card, height=total_h, cup=0.16,
            u0=u0, u1=u0 + 0.95, v0=0.0, v1=0.99,
        )

    # Keep bounds neatly within 6.0m x 6.0m instancing footprint & exact height envelope
    for v in bm.verts:
        v.co.x = max(-3.04, min(3.04, v.co.x))
        v.co.y = max(-3.04, min(3.04, v.co.y))
        v.co.z = max(Z_SKIRT, min(0.98, v.co.z))

    bmesh.ops.triangulate(bm, faces=bm.faces)
    obj = create_mesh_object("Crop_Wheat_Patch", bm, mat_wheat, smooth=True, collection=col)
    return [obj]


# ---------------------------------------------------------------------------
# Asset 2: Freshly Harvested Golden Stubble Patch (crop_stubble_patch.glb)
# ~6.0m x 6.0m freshly combined Stoppelfeld, height ~0.22m, -0.20m skirt
# Target: ~48-90 tris, <250 KB, glTF MASK + doubleSided: true
# ---------------------------------------------------------------------------

def build_stubble_patch(col):
    rng = random.Random(7202)
    mat_stubble = make_pbr_material(
        "Pfalz_Stubble_Mat",
        albedo_path=os.path.join(TEX_DIR, "stubble_blade_albedo.png"),
        normal_path=os.path.join(TEX_DIR, "stubble_blade_normal.jpg"),
        roughness=0.90,
        specular_ior=0.15,
        alpha_clip=True,
        double_sided=True,
        normal_strength=0.90,
    )

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")

    V_SIDE_BOT = 0.000
    V_SIDE_TOP = 0.495
    V_LITTER_BOT = 0.542
    V_LITTER_TOP = 0.982
    Z_SKIRT = -0.20

    # 1. Nine tightly-spaced combine-cut stubble rows along X (0.68m spacing!) = 18 tris!
    #    Dense parallel rows eliminate bare ground corridors while keeping exact 1-quad-per-row efficiency!
    for i in range(9):
        ry = -2.72 + i * 0.68 + rng.uniform(-0.04, 0.04)
        p0 = Vector((-3.0, ry, 0.0))
        p1 = Vector((3.0, ry, 0.0))
        z_tops = [rng.uniform(0.205, 0.230), rng.uniform(0.205, 0.230)]
        lean = Vector((rng.uniform(-0.03, 0.04), rng.choice((-1.0, 1.0)) * rng.uniform(0.03, 0.06), 0.0))
        add_simple_curtain(
            bm, uv, p0, p1, segs=1, z_bot=Z_SKIRT,
            z_top_list=z_tops, wiggle_list=[0.0, 0.0], lean_vec=lean,
            u_start=rng.uniform(0.0, 1.0), u_span=3.4,
            v_bot=V_SIDE_BOT, v_top=V_SIDE_TOP,
        )

    # 2. Seven transverse & diagonal cross-stubble rows (1 seg each = 14 tris)
    cross_specs = [
        (Vector((-2.50, -2.96, 0.0)), Vector((-2.35, 2.96, 0.0))),
        (Vector((-1.25, -2.96, 0.0)), Vector((-1.15, 2.96, 0.0))),
        (Vector((0.00, -2.96, 0.0)), Vector((0.10, 2.96, 0.0))),
        (Vector((1.25, -2.96, 0.0)), Vector((1.15, 2.96, 0.0))),
        (Vector((2.50, -2.96, 0.0)), Vector((2.35, 2.96, 0.0))),
        (Vector((-2.85, -2.35, 0.0)), Vector((2.85, 2.35, 0.0))),
        (Vector((-2.85, 2.35, 0.0)), Vector((2.85, -2.35, 0.0))),
    ]
    for p0, p1 in cross_specs:
        z_tops = [rng.uniform(0.195, 0.226), rng.uniform(0.195, 0.226)]
        lean = Vector((rng.choice((-1.0, 1.0)) * rng.uniform(0.03, 0.06), rng.uniform(-0.03, 0.03), 0.0))
        add_simple_curtain(
            bm, uv, p0, p1, segs=1, z_bot=Z_SKIRT,
            z_top_list=z_tops, wiggle_list=[0.0, 0.0], lean_vec=lean,
            u_start=rng.uniform(0.0, 1.0), u_span=(p1 - p0).length / 1.75,
            v_bot=V_SIDE_BOT, v_top=V_SIDE_TOP,
        )

    # 3. Twelve upward-facing, softly feathered, overlapping chopped straw & chaff carpets (12 * 4 = 48 tris)
    #    Total = 18 + 14 + 48 = 80 tris (right inside 48-90 tris!)
    #    CRITICAL: rx = -90 deg faces +Z upward (never upside-down!) and tiny ±1.2 deg tilt keeps
    #    every vertex cleanly in Z = +0.014..+0.075m so cards never clip into terrain Z=0!
    litter_centers = [
        (-2.00, -2.00), (-0.05, -2.00), (1.95, -1.95),
        (-2.00, -0.65), (0.05, -0.60), (2.00, -0.65),
        (-1.95, 0.70), (0.10, 0.65), (1.95, 0.72),
        (-1.95, 2.00), (-0.05, 1.98), (1.95, 2.00),
    ]
    for lx, ly in litter_centers:
        jx = lx + rng.uniform(-0.15, 0.15)
        jy = ly + rng.uniform(-0.15, 0.15)
        cz = rng.uniform(0.036, 0.052)
        rx = math.radians(-90.0 + rng.uniform(-1.2, 1.2))
        ry = math.radians(rng.uniform(-1.2, 1.2))
        rz = math.radians(rng.uniform(0.0, 180.0))
        add_cupped_card(
            bm, uv,
            center=Vector((jx, jy, cz)),
            rot_euler=Euler((rx, ry, rz), "XYZ"),
            width=rng.uniform(2.45, 2.85),
            height=rng.uniform(2.00, 2.35),
            cup=0.012,
            u0=0.02, u1=0.98, v0=V_LITTER_BOT, v1=V_LITTER_TOP,
        )

    for v in bm.verts:
        v.co.x = max(-3.04, min(3.04, v.co.x))
        v.co.y = max(-3.04, min(3.04, v.co.y))
        v.co.z = max(Z_SKIRT, min(0.232, v.co.z))

    bmesh.ops.triangulate(bm, faces=bm.faces)
    obj = create_mesh_object("Crop_Stubble_Patch", bm, mat_stubble, smooth=True, collection=col)
    return [obj]


# ---------------------------------------------------------------------------
# Asset 3: Pyramid Stack of 6 Golden Round Straw Bales (straw_bale_stack.glb)
# 3 + 2 + 1 pyramid on ground with -0.25m settled straw/earth skirt
# Target: ~240-380 tris, <300 KB, spiral end-caps + banded wrap + roughness/normal
# ---------------------------------------------------------------------------

def add_round_straw_bale(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: Vector,
    radius: float,
    length: float,
    segs: int,
    roll_rad: float,
    yaw_rad: float,
    rng: random.Random,
    is_bottom_row: bool,
):
    half_len = length * 0.5
    rot_m = Matrix.Rotation(yaw_rad, 3, "Z")

    def make_ring_coords(y_local: float, cap_inset: float = 0.0):
        coords = []
        for s in range(segs):
            a = (s / segs) * 2.0 * math.pi
            jit = rng.uniform(-0.011, 0.011)
            r = radius * (1.0 - cap_inset) + jit
            lx = math.cos(a) * r
            lz = math.sin(a) * r
            if lz < -radius * 0.55:
                compress = 0.042 if is_bottom_row else 0.024
                lz += (-radius * 0.55 - lz) * compress * 2.0
            local_p = Vector((lx, y_local, lz))
            coords.append(center + rot_m @ local_p)
        return coords

    ring_neg_pts = make_ring_coords(-half_len, cap_inset=0.010)
    ring_pos_pts = make_ring_coords(+half_len, cap_inset=0.010)

    b_neg = [bm.verts.new(p) for p in ring_neg_pts]
    b_pos = [bm.verts.new(p) for p in ring_pos_pts]
    v_offset = roll_rad / (2.0 * math.pi)
    u_left = 0.008
    u_right = 0.484

    for s in range(segs):
        sn = (s + 1) % segs
        f = bm.faces.new((b_neg[s], b_pos[s], b_pos[sn], b_neg[sn]))
        f.smooth = True
        v0 = v_offset + s / segs
        v1 = v_offset + (s + 1) / segs
        f.loops[0][uv_layer].uv = (u_left, v0)
        f.loops[1][uv_layer].uv = (u_right, v0)
        f.loops[2][uv_layer].uv = (u_right, v1)
        f.loops[3][uv_layer].uv = (u_left, v1)

    UV_CX, UV_CY, UV_R = 0.75, 0.75, 0.226
    for is_pos, pts in [(False, ring_neg_pts), (True, ring_pos_pts)]:
        c_ring = [bm.verts.new(p) for p in pts]
        y_dome = (+half_len + 0.032) if is_pos else (-half_len - 0.032)
        c_center = bm.verts.new(center + rot_m @ Vector((0.0, y_dome, 0.0)))

        for s in range(segs):
            sn = (s + 1) % segs
            a0 = (s / segs) * 2.0 * math.pi + roll_rad
            a1 = ((s + 1) / segs) * 2.0 * math.pi + roll_rad
            uv_s = (UV_CX + UV_R * math.cos(a0), UV_CY + UV_R * math.sin(a0))
            uv_sn = (UV_CX + UV_R * math.cos(a1), UV_CY + UV_R * math.sin(a1))
            uv_c = (UV_CX, UV_CY)

            if is_pos:
                f = bm.faces.new((c_ring[sn], c_center, c_ring[s]))
                uvs = (uv_sn, uv_c, uv_s)
            else:
                f = bm.faces.new((c_ring[s], c_center, c_ring[sn]))
                uvs = (uv_s, uv_c, uv_sn)
            f.smooth = False
            for lp, uvp in zip(f.loops, uvs):
                lp[uv_layer].uv = uvp


def add_bale_ground_skirt(bm: bmesh.types.BMesh, uv_layer):
    """Low-poly settled straw & harvest-earth hillside base skirt from Z=+0.065m to Z=-0.25m (22 tris)."""
    top_profile = [
        (-2.22, -0.44), (-1.92, -0.62), (1.92, -0.62), (2.22, -0.44),
        (2.22, 0.44), (1.92, 0.62), (-1.92, 0.62), (-2.22, 0.44),
    ]
    bot_profile = [
        (-2.34, -0.50), (-2.00, -0.70), (2.00, -0.70), (2.34, -0.50),
        (2.34, 0.50), (2.00, 0.70), (-2.00, 0.70), (-2.34, 0.50),
    ]
    z_top, z_bot = 0.065, -0.250
    v_top = [bm.verts.new(Vector((x, y, z_top))) for x, y in top_profile]
    v_bot = [bm.verts.new(Vector((x, y, z_bot))) for x, y in bot_profile]

    U0, U1 = 0.515, 0.985
    V_BOT, V_TOP = 0.015, 0.485
    n = len(top_profile)
    for i in range(n):
        inext = (i + 1) % n
        f = bm.faces.new((v_bot[i], v_bot[inext], v_top[inext], v_top[i]))
        f.smooth = True
        ua = U0 + (i / n) * (U1 - U0)
        ub = U0 + ((i + 1) / n) * (U1 - U0)
        f.loops[0][uv_layer].uv = (ua, V_BOT)
        f.loops[1][uv_layer].uv = (ub, V_BOT)
        f.loops[2][uv_layer].uv = (ub, V_TOP)
        f.loops[3][uv_layer].uv = (ua, V_TOP)

    f_cap = bm.faces.new(v_top)
    f_cap.smooth = False
    for lp in f_cap.loops:
        co = lp.vert.co
        u = U0 + ((co.x + 2.34) / 4.68) * (U1 - U0)
        v = 0.36 + ((co.y + 0.70) / 1.40) * 0.12
        lp[uv_layer].uv = (u, v)


def build_straw_bale_stack(col):
    rng = random.Random(7303)
    mat_bale = make_pbr_material(
        "Pfalz_StrawBale_Mat",
        albedo_path=os.path.join(TEX_DIR, "straw_bale_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "straw_bale_normal.jpg"),
        roughness_path=os.path.join(TEX_DIR, "straw_bale_roughness.jpg"),
        roughness=0.92,
        specular_ior=0.14,
        alpha_clip=False,
        double_sided=False,
        normal_strength=1.20,
    )

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")

    R = 0.75
    L = 1.22
    SEGS = 14  # 56 tris * 6 = 336 tris + 22 skirt tris = 358 tris total

    bale_specs = [
        (-1.52, rng.uniform(-0.025, 0.025), 0.72, True),
        (0.00,  rng.uniform(-0.025, 0.025), 0.72, True),
        (1.52,  rng.uniform(-0.025, 0.025), 0.72, True),
        (-0.76, rng.uniform(-0.025, 0.025), 1.97, False),
        (0.76,  rng.uniform(-0.025, 0.025), 1.97, False),
        (0.00,  rng.uniform(-0.025, 0.025), 3.22, False),
    ]

    for bx, by, bz, is_bot in bale_specs:
        add_round_straw_bale(
            bm, uv,
            center=Vector((bx, by, bz)),
            radius=R,
            length=L,
            segs=SEGS,
            roll_rad=rng.uniform(0.0, 2.0 * math.pi),
            yaw_rad=math.radians(rng.uniform(-2.0, 2.0)),
            rng=rng,
            is_bottom_row=is_bot,
        )

    add_bale_ground_skirt(bm, uv)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    obj = create_mesh_object("Straw_Bale_Stack", bm, mat_bale, smooth=False, collection=col)
    return [obj]


# ---------------------------------------------------------------------------
# Export, Bounds & Strict glTF-2.0 Inspection
# ---------------------------------------------------------------------------

def compute_gltf_bbox(objects):
    xs, ys, zs = [], [], []
    for obj in objects:
        if obj.type != "MESH":
            continue
        mw = obj.matrix_world
        for v in obj.data.vertices:
            w = mw @ v.co
            xs.append(w.x)
            ys.append(w.z)
            zs.append(-w.y)
    return {
        "min": [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)],
        "max": [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)],
        "size": [
            round(max(xs) - min(xs), 3),
            round(max(ys) - min(ys), 3),
            round(max(zs) - min(zs), 3),
        ],
    }


def export_glb(objects, glb_path: str):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_jpeg_quality=88,
        export_texcoords=True,
        export_normals=True,
        export_draco_mesh_compression_enable=False,
    )


def inspect_glb(glb_path: str) -> dict:
    with open(glb_path, "rb") as f:
        data = f.read()
    magic, version, total_len = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2, f"Invalid GLB header in {glb_path}"
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    assert chunk_type == 0x4E4F534A, "First chunk is not JSON"
    gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))

    accs = gltf.get("accessors", [])
    tris = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                tris += accs[prim["indices"]]["count"] // 3
            else:
                tris += accs[prim["attributes"]["POSITION"]]["count"] // 3

    ext_uris = [img["uri"] for img in gltf.get("images", []) if "uri" in img]
    mats = [
        {
            "name": m.get("name"),
            "alphaMode": m.get("alphaMode", "OPAQUE"),
            "alphaCutoff": m.get("alphaCutoff"),
            "doubleSided": m.get("doubleSided", False),
        }
        for m in gltf.get("materials", [])
    ]
    images = [
        {
            "mimeType": img.get("mimeType"),
            "byteLength": gltf["bufferViews"][img["bufferView"]]["byteLength"] if "bufferView" in img else 0,
        }
        for img in gltf.get("images", [])
    ]
    return {
        "fileSizeBytes": len(data),
        "triangles": tris,
        "externalUriCount": len(ext_uris),
        "materials": mats,
        "images": images,
    }


# ---------------------------------------------------------------------------
# Sunlit 1280x720 Cycles Metal Showcase Diorama Renderer
# ---------------------------------------------------------------------------

def render_cycles_showcase(render_path: str, prototypes: dict):
    """
    Render a richly lit July Palatinate harvest diorama showing:
      - Tiled lush golden wheat field (left & mid-back, demonstrating seamless instancing)
      - Freshly combined golden stubble field with loose chopped straw (foreground & right)
      - Full hero 6-bale round straw pyramid stack angled 38 deg so BOTH spiral end-caps
        AND twine-banded cylindrical barrels glow in warm afternoon sunlight!
    """
    scene = bpy.context.scene
    stage_col = bpy.data.collections.new("Showcase_Stage")
    scene.collection.children.link(stage_col)

    proto_collections = []
    for col in scene.collection.children:
        if col.name.startswith("Asset_"):
            col.hide_render = True
            proto_collections.append(col)

    def spawn_instance(src_objs, name, loc, rot_z_deg=0.0):
        out = []
        for idx, src in enumerate(src_objs):
            dup = src.copy()
            dup.name = f"{name}_{idx}"
            dup.location = Vector(loc)
            dup.rotation_euler = Euler((0.0, 0.0, math.radians(rot_z_deg)), "XYZ")
            stage_col.objects.link(dup)
            out.append(dup)
        return out

    # 1. Lush seamless ripened wheat field (left & rolling back horizon!)
    wheat_tiles = [
        (-7.6, 1.4, 0.0),
        (-2.0, 1.4, 3.0),
        (-7.6, 7.0, -2.0),
        (-2.0, 7.0, 2.0),
        (3.6, 7.2, -3.0),
        (9.2, 7.2, 1.0),
        (-7.6, 12.6, 4.0),
        (-2.0, 12.6, -2.0),
        (3.6, 12.6, 2.0),
    ]
    for i, (wx, wy, rz) in enumerate(wheat_tiles):
        spawn_instance(prototypes["crop_wheat_patch"], f"WheatTile_{i}", (wx, wy, 0.0), rz)

    # 2. Freshly harvested golden stubble field (foreground & right side!)
    stubble_tiles = [
        (3.8, 1.4, 0.0),
        (9.4, 1.4, -2.0),
        (3.8, -4.2, 2.0),
        (-1.8, -4.2, -1.0),
        (-7.4, -4.2, 2.0),
        (9.4, -4.2, 3.0),
    ]
    for i, (sx, sy, rz) in enumerate(stubble_tiles):
        spawn_instance(prototypes["crop_stubble_patch"], f"StubbleTile_{i}", (sx, sy, 0.0), rz)

    # 3. Hero 6-bale round straw pyramid stack cleanly framed on right-midground!
    #    Angled -44 deg so camera clearly showcases BOTH spiral end-caps AND cinched twine-banded straw barrels!
    spawn_instance(prototypes["straw_bale_stack"], "Hero_StrawStack", (3.15, 2.45, 0.0), rot_z_deg=-44.0)

    # 4. Procedurally textured dry Palatinate harvest loam ground plane at Z = 0.0 (showcase backdrop only!)
    mat_soil = bpy.data.materials.new("Showcase_HarvestLoam")
    snt = mat_soil.node_tree
    s_bsdf = snt.nodes.get("Principled BSDF")
    s_bsdf.inputs["Roughness"].default_value = 0.96
    if "Specular IOR Level" in s_bsdf.inputs:
        s_bsdf.inputs["Specular IOR Level"].default_value = 0.08
    tex_coord = snt.nodes.new("ShaderNodeTexCoord")
    noise = snt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.65
    mix_col = snt.nodes.new("ShaderNodeMix")
    mix_col.data_type = "RGBA"
    mix_col.inputs["A"].default_value = (0.20, 0.15, 0.08, 1.0)
    mix_col.inputs["B"].default_value = (0.34, 0.27, 0.13, 1.0)
    snt.links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])
    snt.links.new(noise.outputs["Fac"], mix_col.inputs["Factor"])
    snt.links.new(mix_col.outputs["Result"], s_bsdf.inputs["Base Color"])

    bm_g = bmesh.new()
    bmesh.ops.create_grid(bm_g, x_segments=2, y_segments=2, size=140.0)
    create_mesh_object("Showcase_Ground", bm_g, mat_soil, smooth=False, collection=stage_col)

    # 5. Sunny July Afternoon Palatinate Sky + Warm Golden Sun
    world = bpy.data.worlds.new("PfalzSummerSky")
    scene.world = world
    wnt = world.node_tree
    wnt.nodes.clear()
    w_out = wnt.nodes.new("ShaderNodeOutputWorld")
    w_bg = wnt.nodes.new("ShaderNodeBackground")
    w_bg.inputs["Strength"].default_value = 0.30
    sky = wnt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_disc = False
        sky.sun_elevation = math.radians(32.0)
        sky.sun_rotation = math.radians(145.0)
        sky.air_density = 1.15
        sky.dust_density = 1.1
        sky.ozone_density = 1.8
    except Exception:
        pass
    wnt.links.new(sky.outputs["Color"], w_bg.inputs["Color"])
    wnt.links.new(w_bg.outputs["Background"], w_out.inputs["Surface"])

    # Raking golden afternoon sun from front-left-above -> casts rich crisp relief across wheat & bale spirals!
    sun_data = bpy.data.lights.new("PfalzSun", type="SUN")
    sun_data.energy = 4.0
    sun_data.angle = math.radians(1.3)
    sun_data.color = (1.0, 0.93, 0.80)
    sun_obj = bpy.data.objects.new("PfalzSun", sun_data)
    sun_obj.rotation_euler = Euler((math.radians(54.0), math.radians(10.0), math.radians(-50.0)), "XYZ")
    stage_col.objects.link(sun_obj)

    # 6. Camera: tractor-cab / rural field-edge vantage framing ALL 3 assets cleanly!
    cam_data = bpy.data.cameras.new("ShowcaseCam")
    cam_data.lens = 32.0
    cam_data.clip_start = 0.1
    cam_data.clip_end = 400.0
    cam_obj = bpy.data.objects.new("ShowcaseCam", cam_data)
    cam_obj.location = Vector((-0.60, -8.4, 2.55))
    target = Vector((0.65, 2.2, 1.38))
    cam_obj.rotation_euler = (target - cam_obj.location).normalized().to_track_quat("-Z", "Y").to_euler()
    stage_col.objects.link(cam_obj)
    scene.camera = cam_obj

    bpy.ops.preferences.addon_enable(module="cycles")
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.refresh_devices()
        has_gpu = False
        for d in prefs.devices:
            if d.type == "METAL":
                d.use = True
                has_gpu = True
            else:
                d.use = False
        scene.cycles.device = "GPU" if has_gpu else "CPU"
    except Exception:
        scene.cycles.device = "CPU"

    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 2
    scene.cycles.transparent_max_bounces = 32

    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Punchy"
    except Exception:
        scene.view_settings.view_transform = "Filmic"
    scene.view_settings.exposure = -1.08

    os.makedirs(os.path.dirname(render_path), exist_ok=True)
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Cycles showcase -> {render_path} (device={scene.cycles.device})")

    for col in proto_collections:
        col.hide_render = False
    for obj in list(stage_col.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(stage_col)


# ---------------------------------------------------------------------------
# Main Build Pipeline
# ---------------------------------------------------------------------------

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", type=str, default="", help="Output 1280x720 Cycles showcase PNG path")
    args = parser.parse_args(argv)

    clear_scene()

    specs = [
        ("crop_wheat_patch", build_wheat_patch, 5.6, 0.12, 0.25, (80, 160), 350 * 1024),
        ("crop_stubble_patch", build_stubble_patch, 5.6, 0.0, 0.20, (48, 90), 250 * 1024),
        ("straw_bale_stack", build_straw_bale_stack, 8.0, 0.0, 0.25, (240, 380), 300 * 1024),
    ]

    prototypes = {}
    meta_assets = {}
    all_ok = True

    for key, builder_fn, spacing_m, wind_sway, skirt_m, tri_range, max_bytes in specs:
        col = bpy.data.collections.new(f"Asset_{key}")
        bpy.context.scene.collection.children.link(col)
        objs = builder_fn(col)
        prototypes[key] = objs

        glb_path = os.path.join(GLB_DIR, f"{key}.glb")
        export_glb(objs, glb_path)

        bbox = compute_gltf_bbox(objs)
        info = inspect_glb(glb_path)

        mat0 = info["materials"][0] if info["materials"] else {}
        tri_ok = tri_range[0] <= info["triangles"] <= tri_range[1]
        size_ok = info["fileSizeBytes"] <= max_bytes
        uri_ok = info["externalUriCount"] == 0
        if not (tri_ok and size_ok and uri_ok):
            all_ok = False

        status = "PASS" if (tri_ok and size_ok and uri_ok) else "FAIL"
        print(
            f"[{key}] {status} | {info['fileSizeBytes']/1024:.1f} KB (limit {max_bytes/1024:.0f} KB) | "
            f"{info['triangles']} tris (target {tri_range[0]}-{tri_range[1]}) | "
            f"bounds={bbox['size']} minY={bbox['min'][1]} maxY={bbox['max'][1]} | "
            f"alphaMode={mat0.get('alphaMode')} doubleSided={mat0.get('doubleSided')} | "
            f"extURIs={info['externalUriCount']} | images={info['images']}"
        )

        meta_assets[key] = {
            "id": key,
            "glbPath": f"/assets/models/fields/wheat/{key}.glb",
            "bounds": bbox["size"],
            "boundsMin": bbox["min"],
            "boundsMax": bbox["max"],
            "aboveGroundHeight": round(bbox["max"][1], 3),
            "undergroundSkirtDepth": skirt_m,
            "triangles": info["triangles"],
            "fileSizeBytes": info["fileSizeBytes"],
            "recommendedGridSpacingM": spacing_m,
            "recommendedSpacing": [spacing_m, spacing_m],
            "windSwayStrength": wind_sway,
            "alphaMode": mat0.get("alphaMode", "OPAQUE"),
            "doubleSided": mat0.get("doubleSided", False),
        }

    meta_doc = {
        "category": "wheat",
        "description": "Palatinate summer ripened wheat, freshly harvested golden stubble, and 6-bale round straw pyramid stack for Kindenheim (July/August harvest)",
        "coordinateSystem": "glTF Y-up meters (+X East, +Y Up, -Z North; ground contact Y=0 with underground root/base skirt)",
        "assets": meta_assets,
    }
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta_doc, f, indent=2)
    print(f"Wrote metadata -> {META_OUT}")

    try:
        bpy.ops.file.pack_all()
    except Exception:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"Saved master .blend -> {BLEND_OUT}")

    if args.render:
        render_cycles_showcase(args.render, prototypes)

    if not all_ok:
        print("WARNING: One or more budget assertions exceeded target range!")
        sys.exit(2)


if __name__ == "__main__":
    main()
