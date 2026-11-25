#!/usr/bin/env python3
"""
Blender 5.2 Rural Field-Boundary Props Builder for Kindenheim (Rheinland-Pfalz).

Builds and exports 4 lightweight, GPU-instancing-ready PBR .glb models to:
  public/assets/models/fields/props/
    - hedgerow_bay.glb        (~5.0m Pfalz hawthorn/shrub Windschutzhecke along local +X)
    - vineyard_rose_post.glb  (Weathered vineyard end-post + climbing pink/crimson Pfalz rose bush)
    - hochsitz.glb            (Classic German wooden hunter's high-seat tower, ~3.85m tall, window facing +Z)
    - wegekreuz.glb           (Historic Pfälzer Buntsandstein wayside cross, ~2.45m tall, front facing +Z)
    - meta.json               (Bounds, triangle counts, file sizes, spacing & wind metadata)

Also saves:
  - blender/fields/props/rural_props.blend
  - Optional 1280x720 Cycles sunlit showcase PNG (--render <path>)

Run via:
  /opt/homebrew/bin/blender --background --python blender/fields/props/build_props.py -- --render <png_path>
"""

import argparse
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
TEX_DIR = os.path.join(PROJECT_ROOT, "blender/fields/props/textures")
BLEND_OUT = os.path.join(PROJECT_ROOT, "blender/fields/props/rural_props.blend")
GLB_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/fields/props")
META_OUT = os.path.join(GLB_DIR, "meta.json")

os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
os.makedirs(GLB_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Blender 5.2 Helpers
# ---------------------------------------------------------------------------

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


def make_pbr_material(
    name: str,
    albedo_path: str | None = None,
    normal_path: str | None = None,
    base_color=(0.8, 0.8, 0.8, 1.0),
    roughness: float = 0.82,
    metallic: float = 0.0,
    alpha_clip: bool = False,
    double_sided: bool = False,
    normal_strength: float = 0.9,
):
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Base Color"].default_value = base_color
    if alpha_clip and "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.12

    if albedo_path and os.path.exists(albedo_path):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = load_image(albedo_path, "sRGB")
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_clip:
            # Blender 5.x glTF exporter converts Math(ROUND) on Alpha -> glTF alphaMode: "MASK"
            math_n = nodes.new("ShaderNodeMath")
            math_n.operation = "ROUND"
            links.new(tex.outputs["Alpha"], math_n.inputs[0])
            links.new(math_n.outputs["Value"], bsdf.inputs["Alpha"])
            mat.alpha_threshold = 0.45

    if normal_path and os.path.exists(normal_path):
        ntex = nodes.new("ShaderNodeTexImage")
        ntex.image = load_image(normal_path, "Non-Color")
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    mat.use_backface_culling = not double_sided
    return mat


def create_mesh_object(name: str, bm: bmesh.types.BMesh, material, smooth: bool = False, collection=None):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    if smooth and len(mesh.polygons) > 0:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.collection).objects.link(obj)
    return obj


def add_box(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    rot_euler: Euler | None = None,
    uv_scale: float = 0.8,
):
    """Add an oriented box with clean box-projected UVs."""
    sx, sy, sz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    corners = [
        Vector((-sx, -sy, -sz)), Vector((sx, -sy, -sz)), Vector((sx, sy, -sz)), Vector((-sx, sy, -sz)),
        Vector((-sx, -sy,  sz)), Vector((sx, -sy,  sz)), Vector((sx, sy,  sz)), Vector((-sx, sy,  sz)),
    ]
    mat = rot_euler.to_matrix() if rot_euler is not None else Matrix.Identity(3)
    cvec = Vector(center)
    verts = [bm.verts.new(cvec + mat @ p) for p in corners]
    faces_def = [
        ((0, 3, 2, 1), (size[0], size[1])),  # bottom
        ((4, 5, 6, 7), (size[0], size[1])),  # top
        ((0, 1, 5, 4), (size[0], size[2])),  # -Y front
        ((2, 3, 7, 6), (size[0], size[2])),  # +Y back
        ((1, 2, 6, 5), (size[1], size[2])),  # +X right
        ((3, 0, 4, 7), (size[1], size[2])),  # -X left
    ]
    for idxs, (uw, vh) in faces_def:
        try:
            f = bm.faces.new([verts[i] for i in idxs])
            u_max = max(0.15, uw * uv_scale)
            v_max = max(0.15, vh * uv_scale)
            uvs = [(0.0, 0.0), (u_max, 0.0), (u_max, v_max), (0.0, v_max)]
            for lp, uv in zip(f.loops, uvs):
                lp[uv_layer].uv = uv
        except ValueError:
            pass


def add_tapered_prism(
    bm: bmesh.types.BMesh,
    uv_layer,
    z0: float,
    z1: float,
    w0: float,
    d0: float,
    w1: float,
    d1: float,
    uv_scale: float = 0.85,
    cap_bottom: bool = False,
    cap_top: bool = True,
):
    """Add a clean rectangular frustum/tier centered at X=0, Y=0 from z0 to z1."""
    b_pts = [(-w0 * 0.5, -d0 * 0.5, z0), (w0 * 0.5, -d0 * 0.5, z0), (w0 * 0.5, d0 * 0.5, z0), (-w0 * 0.5, d0 * 0.5, z0)]
    t_pts = [(-w1 * 0.5, -d1 * 0.5, z1), (w1 * 0.5, -d1 * 0.5, z1), (w1 * 0.5, d1 * 0.5, z1), (-w1 * 0.5, d1 * 0.5, z1)]
    bv = [bm.verts.new(p) for p in b_pts]
    tv = [bm.verts.new(p) for p in t_pts]
    h = max(0.05, z1 - z0)
    sides = [
        ((bv[0], bv[1], tv[1], tv[0]), max(w0, w1)),
        ((bv[1], bv[2], tv[2], tv[1]), max(d0, d1)),
        ((bv[2], bv[3], tv[3], tv[2]), max(w0, w1)),
        ((bv[3], bv[0], tv[0], tv[3]), max(d0, d1)),
    ]
    for vs, span in sides:
        f = bm.faces.new(vs)
        us = span * uv_scale
        v0 = (z0 + 0.3) * uv_scale
        v1 = (z1 + 0.3) * uv_scale
        for lp, uv in zip(f.loops, [(0.0, v0), (us, v0), (us, v1), (0.0, v1)]):
            lp[uv_layer].uv = uv
    if cap_bottom:
        f = bm.faces.new([bv[0], bv[3], bv[2], bv[1]])
        for lp, uv in zip(f.loops, [(0, 0), (0, 0.5), (0.5, 0.5), (0.5, 0)]):
            lp[uv_layer].uv = uv
    if cap_top:
        f = bm.faces.new([tv[0], tv[1], tv[2], tv[3]])
        for lp, uv in zip(f.loops, [(0, 0), (w1 * uv_scale, 0), (w1 * uv_scale, d1 * uv_scale), (0, d1 * uv_scale)]):
            lp[uv_layer].uv = uv


def add_pole(
    bm: bmesh.types.BMesh,
    uv_layer,
    p0: tuple[float, float, float],
    p1: tuple[float, float, float],
    r0: float,
    r1: float,
    sides: int = 5,
    uv_v_scale: float = 0.55,
    cap_top: bool = True,
):
    """Add a low-poly tapered wooden pole/branch between p0 and p1."""
    v0 = Vector(p0)
    v1 = Vector(p1)
    d = v1 - v0
    length = d.length
    if length < 1e-5:
        return
    t = d / length
    ref = Vector((1.0, 0.0, 0.0)) if abs(t.z) > 0.92 else Vector((0.0, 0.0, 1.0))
    sx = t.cross(ref).normalized()
    sy = t.cross(sx).normalized()
    ring0, ring1 = [], []
    for s in range(sides):
        a = (s / sides) * 2.0 * math.pi
        off = sx * math.cos(a) + sy * math.sin(a)
        ring0.append(bm.verts.new(v0 + off * r0))
        ring1.append(bm.verts.new(v1 + off * r1))
    for s in range(sides):
        sn = (s + 1) % sides
        f = bm.faces.new((ring0[s], ring0[sn], ring1[sn], ring1[s]))
        u0, u1 = s / sides, (s + 1) / sides
        f.loops[0][uv_layer].uv = (u0, 0.0)
        f.loops[1][uv_layer].uv = (u1, 0.0)
        f.loops[2][uv_layer].uv = (u1, length * uv_v_scale)
        f.loops[3][uv_layer].uv = (u0, length * uv_v_scale)
    if cap_top:
        f = bm.faces.new(ring1)
        for lp in f.loops:
            lp[uv_layer].uv = (0.5, 0.5)


def add_bent_card(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: Vector,
    rot_euler: Euler,
    width: float,
    height: float,
    cup: float = 0.14,
):
    """Add a 2-quad gently cupped alpha foliage card (4 tris) in local XZ plane."""
    mat = rot_euler.to_matrix()
    hw, hh = width * 0.5, height * 0.5
    pts = [
        Vector((-hw, -cup, -hh)),
        Vector((0.0, cup * 0.55, -hh)),
        Vector((hw, -cup, -hh)),
        Vector((-hw, -cup, hh)),
        Vector((0.0, cup * 0.55, hh)),
        Vector((hw, -cup, hh)),
    ]
    verts = [bm.verts.new(center + mat @ p) for p in pts]
    for idxs, uvs in (
        ((0, 1, 4, 3), ((0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (0.0, 1.0))),
        ((1, 2, 5, 4), ((0.5, 0.0), (1.0, 0.0), (1.0, 1.0), (0.5, 1.0))),
    ):
        try:
            f = bm.faces.new([verts[i] for i in idxs])
            for lp, uv in zip(f.loops, uvs):
                lp[uv_layer].uv = uv
        except ValueError:
            pass


def compute_gltf_bbox(objects):
    xs, ys, zs = [], [], []
    for obj in objects:
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            # Blender (bx, by, bz) -> glTF (bx, bz, -by)
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


def count_tris(objects) -> int:
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        for poly in obj.data.polygons:
            total += max(1, len(poly.vertices) - 2)
    return total


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
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )


# ---------------------------------------------------------------------------
# 1. Hedgerow Bay (hedgerow_bay.glb) — ~5.0m along local +X, irregular natural crown
# ---------------------------------------------------------------------------

def build_hedgerow_bay(col):
    rng = random.Random(8101)
    mat_wood = make_pbr_material(
        "Hedgerow_Wood",
        albedo_path=os.path.join(TEX_DIR, "timber_weathered_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "timber_weathered_normal.png"),
        roughness=0.90,
        normal_strength=0.7,
    )
    mat_leaf = make_pbr_material(
        "Hedgerow_Foliage",
        albedo_path=os.path.join(TEX_DIR, "hedgerow_foliage.png"),
        roughness=0.86,
        alpha_clip=True,
        double_sided=True,
    )

    # Woody crooked hawthorn stems anchored to Z = -0.26m
    bm_wood = bmesh.new()
    uv_w = bm_wood.loops.layers.uv.new("UVMap")
    stem_xs = [-1.95, -1.15, -0.35, 0.40, 1.18, 1.92]
    for sx in stem_xs:
        sy = rng.uniform(-0.20, 0.20)
        h_top = rng.uniform(1.30, 1.80)
        mx = sx + rng.uniform(-0.14, 0.14)
        my = sy + rng.uniform(-0.16, 0.16)
        add_pole(bm_wood, uv_w, (sx, sy, -0.26), (mx, my, h_top * 0.55), 0.048, 0.032, sides=4, cap_top=False)
        add_pole(bm_wood, uv_w, (mx, my, h_top * 0.55), (mx + rng.uniform(-0.20, 0.20), my + rng.uniform(-0.20, 0.20), h_top), 0.032, 0.015, sides=4, cap_top=True)
        add_pole(bm_wood, uv_w, (mx, my, h_top * 0.52), (mx + rng.uniform(-0.30, 0.30), my + rng.choice([-0.38, 0.38]), h_top * 0.88), 0.024, 0.012, sides=4, cap_top=True)
    obj_wood = create_mesh_object("Hedgerow_Stems", bm_wood, mat_wood, smooth=True, collection=col)

    # Multi-layered irregular foliage cards (~48 cupped cards = 192 tris, lush spherical outward normals!)
    bm_leaf = bmesh.new()
    uv_l = bm_leaf.loops.layers.uv.new("UVMap")

    def crown_height_at(x: float) -> float:
        return 2.08 + 0.36 * math.sin((x + 1.1) * 1.35) + 0.18 * math.cos(x * 2.6)

    # Outer front & back billowing shrub walls (16 cards total, tucked cleanly within X in [-2.6, +2.6])
    for side in (-1.0, 1.0):
        for i in range(8):
            cx = -2.02 + i * 0.575 + rng.uniform(-0.07, 0.07)
            ch = crown_height_at(cx)
            cy = side * rng.uniform(0.28, 0.50)
            card_h = rng.uniform(1.30, 1.65)
            cz = card_h * 0.5 - 0.25 + rng.uniform(0.0, max(0.14, ch - card_h - 0.10))
            rot = Euler((
                math.radians(rng.uniform(14, 30)) * (-side),
                rng.uniform(-0.18, 0.18),
                rng.uniform(-0.42, 0.42) + (0.0 if side < 0 else math.pi),
            ), "XYZ")
            add_bent_card(bm_leaf, uv_l, Vector((cx, cy, cz)), rot, rng.uniform(1.18, 1.48), card_h, cup=0.22)

    # Upper irregular crown domes so aerial & hillside views read as lush billowing hedgerows!
    for i in range(14):
        cx = -2.00 + i * 0.31 + rng.uniform(-0.07, 0.07)
        ch = crown_height_at(cx)
        cy = rng.uniform(-0.30, 0.30)
        cz = ch - rng.uniform(0.38, 0.78)
        rot = Euler((
            math.radians(rng.uniform(44, 76)) * rng.choice([-1, 1]),
            rng.uniform(-0.28, 0.28),
            rng.uniform(0, math.pi),
        ), "XYZ")
        add_bent_card(bm_leaf, uv_l, Vector((cx, cy, cz)), rot, rng.uniform(1.12, 1.42), rng.uniform(1.02, 1.32), cup=0.20)

    # Cross-axis vertical baffles
    for i in range(8):
        cx = -1.95 + i * 0.56 + rng.uniform(-0.06, 0.06)
        ch = crown_height_at(cx)
        cy = rng.uniform(-0.12, 0.12)
        card_h = min(ch + 0.10, rng.uniform(1.55, 2.02))
        cz = card_h * 0.5 - 0.24
        rot = Euler((
            rng.uniform(-0.18, 0.18),
            rng.uniform(-0.16, 0.16),
            math.pi * 0.5 + rng.uniform(-0.45, 0.45),
        ), "XYZ")
        add_bent_card(bm_leaf, uv_l, Vector((cx, cy, cz)), rot, rng.uniform(1.22, 1.54), card_h, cup=0.20)

    # Ground-hugging skirt tufts dipping cleanly to Z = -0.25m
    for i in range(8):
        cx = -1.95 + i * 0.56 + rng.uniform(-0.06, 0.06)
        cy = rng.choice([-0.38, 0.38]) + rng.uniform(-0.10, 0.10)
        rot = Euler((math.radians(rng.uniform(12, 26)) * (-1 if cy > 0 else 1), rng.uniform(-0.15, 0.15), rng.uniform(0, math.pi)), "XYZ")
        add_bent_card(bm_leaf, uv_l, Vector((cx, cy, 0.30)), rot, rng.uniform(1.08, 1.36), 1.12, cup=0.18)

    obj_leaf = create_mesh_object("Hedgerow_Canopy", bm_leaf, mat_leaf, smooth=True, collection=col)
    return [obj_wood, obj_leaf]


# ---------------------------------------------------------------------------
# 2. Vineyard Rose End-Post (vineyard_rose_post.glb) — Pfälzer Weinberg-Rosenstock
# ---------------------------------------------------------------------------

def build_vineyard_rose_post(col):
    rng = random.Random(8202)
    mat_wood = make_pbr_material(
        "RosePost_Wood",
        albedo_path=os.path.join(TEX_DIR, "timber_weathered_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "timber_weathered_normal.png"),
        roughness=0.88,
        normal_strength=0.95,
    )
    mat_iron = make_pbr_material(
        "RosePost_Wire",
        base_color=(0.36, 0.38, 0.40, 1.0),
        roughness=0.42,
        metallic=0.80,
    )
    mat_rose = make_pbr_material(
        "RoseBush_Mat",
        albedo_path=os.path.join(TEX_DIR, "rose_bush.png"),
        roughness=0.82,
        alpha_clip=True,
        double_sided=True,
    )

    # Classic weathered Pfalz oak/acacia vineyard end-post leaning slightly outward (-Y = glTF +Z)
    bm_wood = bmesh.new()
    uv_w = bm_wood.loops.layers.uv.new("UVMap")
    # Main post from Z=-0.28m to Z=1.84m with beveled tip (clearly visible above the rose bush!)
    add_pole(bm_wood, uv_w, (0.0, 0.08, -0.28), (0.0, -0.10, 1.76), 0.064, 0.054, sides=6, uv_v_scale=0.65, cap_top=False)
    add_pole(bm_wood, uv_w, (0.0, -0.10, 1.76), (0.0, -0.11, 1.85), 0.054, 0.014, sides=6, uv_v_scale=0.65, cap_top=True)
    # Short diagonal anchor strut / tension stay brace into ground on vineyard side (+Y)
    add_pole(bm_wood, uv_w, (0.0, 0.62, -0.24), (0.0, -0.02, 1.12), 0.038, 0.030, sides=5, uv_v_scale=0.75, cap_top=True)
    obj_wood = create_mesh_object("RosePost_Timber", bm_wood, mat_wood, smooth=True, collection=col)

    # Galvanized trellis tension wire anchor & stub leading back into vineyard (+Y)
    bm_wire = bmesh.new()
    uv_wi = bm_wire.loops.layers.uv.new("UVMap")
    add_pole(bm_wire, uv_wi, (0.0, -0.09, 1.56), (0.0, -0.52, -0.18), 0.008, 0.008, sides=4, cap_top=False)
    for wz in (0.82, 1.26, 1.62):
        add_pole(bm_wire, uv_wi, (0.0, -0.06, wz), (0.0, 0.42, wz), 0.006, 0.006, sides=4, cap_top=False)
    obj_wire = create_mesh_object("RosePost_Wire", bm_wire, mat_iron, smooth=False, collection=col)

    # Lush low-to-mid Pfalz pink/crimson rose bush blooming around base & roadside (-Y = glTF +Z),
    # leaving the upper weathered timber end-post & wires unmistakably visible!
    bm_rose = bmesh.new()
    uv_r = bm_rose.loops.layers.uv.new("UVMap")
    # Rounded lush bush mound around base (Z=-0.24..0.88m, wide ~1.1m diameter!)
    for k in range(11):
        ang = (k / 11.0) * math.pi + rng.uniform(-0.12, 0.12)
        off_x = math.cos(ang) * rng.uniform(0.08, 0.24)
        off_y = -0.20 + math.sin(ang) * rng.uniform(0.08, 0.24)
        h_card = rng.uniform(0.68, 0.96)
        w_card = rng.uniform(0.76, 1.04)
        rot = Euler((rng.uniform(-0.22, 0.22), rng.uniform(-0.18, 0.18), ang), "XYZ")
        add_bent_card(bm_rose, uv_r, Vector((off_x, off_y, h_card * 0.5 - 0.22)), rot, w_card, h_card, cup=0.18)

    # Tilted crown dome cards over the rose bush (Z=0.35..0.86m) for crisp top/oblique blooms!
    for k in range(11):
        ang = (k / 11.0) * 2.0 * math.pi + 0.25
        rad = rng.uniform(0.18, 0.36)
        cx = math.cos(ang) * rad
        cy = -0.20 + math.sin(ang) * rad
        cz = rng.uniform(0.36, 0.74)
        rot = Euler((math.radians(rng.uniform(35, 65)), rng.uniform(-0.22, 0.22), ang + math.pi * 0.5), "XYZ")
        add_bent_card(bm_rose, uv_r, Vector((cx, cy, cz)), rot, rng.uniform(0.56, 0.80), rng.uniform(0.56, 0.78), cup=0.14)

    # Single delicate climbing rose cane accent hugging front of post up to Z=1.18m
    for k in range(3):
        ang = (k / 3.0) * math.pi + 0.15
        rot = Euler((rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18), ang), "XYZ")
        add_bent_card(bm_rose, uv_r, Vector((rng.uniform(-0.06, 0.06), -0.14, rng.uniform(0.86, 1.06))), rot, 0.44, 0.48, cup=0.10)

    obj_rose = create_mesh_object("RosePost_Bush", bm_rose, mat_rose, smooth=True, collection=col)
    return [obj_wood, obj_wire, obj_rose]


# ---------------------------------------------------------------------------
# 3. German Hunter's High-Seat (hochsitz.glb) — ~3.85m tall, viewing window faces +Z (Blender -Y)
# ---------------------------------------------------------------------------

def build_hochsitz(col):
    mat_timber = make_pbr_material(
        "Hochsitz_Timber",
        albedo_path=os.path.join(TEX_DIR, "timber_weathered_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "timber_weathered_normal.png"),
        roughness=0.87,
        normal_strength=0.95,
    )
    mat_roof = make_pbr_material(
        "Hochsitz_RoofFelt",
        albedo_path=os.path.join(TEX_DIR, "roof_felt_albedo.jpg"),
        roughness=0.92,
    )

    bm_t = bmesh.new()
    uv_t = bm_t.loops.layers.uv.new("UVMap")

    # Dimensions (Blender Z-up, front viewing window = -Y -> glTF +Z!)
    z_skirt = -0.28
    z_floor = 2.22
    z_parapet = 3.16
    z_roof_front = 3.84
    z_roof_back = 3.58

    w_base = 0.80  # half-width at ground (1.60m total stance)
    w_top = 0.60   # half-width at floor (1.20m cabin)

    # 4 splayed sturdy timber stilt legs (Z = -0.28..2.26m)
    leg_specs = [
        ((-w_base, -w_base, z_skirt), (-w_top, -w_top, z_floor + 0.04)),
        (( w_base, -w_base, z_skirt), ( w_top, -w_top, z_floor + 0.04)),
        (( w_base,  w_base, z_skirt), ( w_top,  w_top, z_floor + 0.04)),
        ((-w_base,  w_base, z_skirt), (-w_top,  w_top, z_floor + 0.04)),
    ]
    for p0, p1 in leg_specs:
        add_pole(bm_t, uv_t, p0, p1, 0.068, 0.058, sides=5, uv_v_scale=0.5)

    # Horizontal ledger beams supporting cabin floor (at Z = 2.16m)
    for sy in (-w_top, w_top):
        add_pole(bm_t, uv_t, (-w_top - 0.14, sy, z_floor - 0.06), (w_top + 0.14, sy, z_floor - 0.06), 0.052, 0.052, sides=4)
    for sx in (-w_top, w_top):
        add_pole(bm_t, uv_t, (sx, -w_top - 0.14, z_floor - 0.02), (sx, w_top + 0.14, z_floor - 0.02), 0.048, 0.048, sides=4)

    # Diagonal X-bracing poles on left (-X), right (+X), and front (-Y) faces!
    def lerp3(a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)

    braces = [
        # Left (-X)
        (lerp3(leg_specs[0][0], leg_specs[0][1], 0.18), lerp3(leg_specs[3][0], leg_specs[3][1], 0.88)),
        (lerp3(leg_specs[3][0], leg_specs[3][1], 0.18), lerp3(leg_specs[0][0], leg_specs[0][1], 0.88)),
        # Right (+X)
        (lerp3(leg_specs[1][0], leg_specs[1][1], 0.18), lerp3(leg_specs[2][0], leg_specs[2][1], 0.88)),
        (lerp3(leg_specs[2][0], leg_specs[2][1], 0.18), lerp3(leg_specs[1][0], leg_specs[1][1], 0.88)),
        # Front (-Y)
        (lerp3(leg_specs[0][0], leg_specs[0][1], 0.22), lerp3(leg_specs[1][0], leg_specs[1][1], 0.86)),
        (lerp3(leg_specs[1][0], leg_specs[1][1], 0.22), lerp3(leg_specs[0][0], leg_specs[0][1], 0.86)),
    ]
    for bp0, bp1 in braces:
        add_pole(bm_t, uv_t, bp0, bp1, 0.036, 0.036, sides=4)

    # Rear climbing ladder (+Y side = glTF -Z) from Z=-0.26m up to floor Z=2.24m
    lad_y_bot = 1.42
    lad_y_top = w_top + 0.04
    for lx in (-0.23, 0.23):
        add_pole(bm_t, uv_t, (lx, lad_y_bot, -0.26), (lx, lad_y_top, z_floor + 0.06), 0.040, 0.038, sides=4)
    # 7 sturdy wooden ladder rungs
    for r_idx in range(7):
        t = (r_idx + 0.8) / 7.6
        rz = -0.05 + t * (z_floor - 0.05)
        ry = lad_y_bot + (lad_y_top - lad_y_bot) * ((rz + 0.26) / (z_floor + 0.32))
        add_pole(bm_t, uv_t, (-0.26, ry - 0.03, rz), (0.26, ry - 0.03, rz), 0.025, 0.025, sides=4)

    # Cabin wooden plank deck (1.28m x 1.28m)
    add_box(bm_t, uv_t, (0.0, 0.0, z_floor + 0.03), (1.28, 1.28, 0.06))

    # 4 corner cabin posts supporting roof
    for sx, sy, zt in (
        (-w_top + 0.03, -w_top + 0.03, z_roof_front - 0.05),
        ( w_top - 0.03, -w_top + 0.03, z_roof_front - 0.05),
        ( w_top - 0.03,  w_top - 0.03, z_roof_back - 0.05),
        (-w_top + 0.03,  w_top - 0.03, z_roof_back - 0.05),
    ):
        add_box(bm_t, uv_t, (sx, sy, (z_floor + zt) * 0.5), (0.075, 0.075, zt - z_floor))

    # Half-height timber boarded enclosure (Kanzel-Brüstung) on front, left, right + rear door half
    wall_h = z_parapet - (z_floor + 0.06)
    wall_cz = z_floor + 0.06 + wall_h * 0.5
    add_box(bm_t, uv_t, (0.0, -w_top, wall_cz), (1.26, 0.05, wall_h))        # Front wall (-Y)
    add_box(bm_t, uv_t, (-w_top, 0.0, wall_cz), (0.05, 1.22, wall_h))        # Left wall (-X)
    add_box(bm_t, uv_t, ( w_top, 0.0, wall_cz), (0.05, 1.22, wall_h))        # Right wall (+X)
    add_box(bm_t, uv_t, (0.0,  w_top, wall_cz + 0.25), (1.26, 0.05, wall_h + 0.48))  # Higher windbreak back wall (+Y)

    # Upper wooden header fascia above viewing windows + rifle rest ledge (Gewehrauflage!)
    add_box(bm_t, uv_t, (0.0, -w_top - 0.05, z_parapet + 0.025), (1.36, 0.16, 0.045))  # Front shooting sill
    add_box(bm_t, uv_t, (0.0, 0.28, z_floor + 0.48), (1.14, 0.30, 0.045))              # Interior hunter bench

    # Timber roof rafters / fascia frame under sloped shed roof
    roof_pitch = math.atan2(z_roof_front - z_roof_back, 1.56)
    roof_cz = (z_roof_front + z_roof_back) * 0.5
    add_box(bm_t, uv_t, (0.0, 0.0, roof_cz - 0.045), (1.50, 1.54, 0.055), rot_euler=Euler((-roof_pitch, 0.0, 0.0), "XYZ"))

    obj_timber = create_mesh_object("Hochsitz_Timber", bm_t, mat_timber, smooth=False, collection=col)

    # Sloped overhanging dark Bitumen-Dachpappe shed roof (high in front -Y, sloping back to +Y!)
    bm_r = bmesh.new()
    uv_r = bm_r.loops.layers.uv.new("UVMap")
    add_box(bm_r, uv_r, (0.0, 0.0, roof_cz + 0.005), (1.58, 1.66, 0.048), rot_euler=Euler((-roof_pitch, 0.0, 0.0), "XYZ"))
    obj_roof = create_mesh_object("Hochsitz_Roof", bm_r, mat_roof, smooth=False, collection=col)

    return [obj_timber, obj_roof]


# ---------------------------------------------------------------------------
# 4. Palatinate Sandstone Wayside Cross (wegekreuz.glb) — ~2.46m tall, front faces +Z (Blender -Y)
# ---------------------------------------------------------------------------

def build_wegekreuz(col):
    mat_stone = make_pbr_material(
        "Wegekreuz_Sandstone",
        albedo_path=os.path.join(TEX_DIR, "sandstone_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "sandstone_normal.png"),
        roughness=0.88,
        normal_strength=1.0,
    )
    mat_bronze = make_pbr_material(
        "Wegekreuz_WeatheredBronze",
        base_color=(0.14, 0.13, 0.11, 1.0),
        roughness=0.72,
        metallic=0.52,
    )

    bm_s = bmesh.new()
    uv_s = bm_s.loops.layers.uv.new("UVMap")

    # 1. Stepped ground foundation & base plinth (Z = -0.28m..0.34m)
    add_tapered_prism(bm_s, uv_s, -0.28, 0.16, 1.04, 0.86, 0.98, 0.80, cap_top=True)
    add_tapered_prism(bm_s, uv_s,  0.16, 0.34, 0.86, 0.70, 0.72, 0.58, cap_top=True)

    # 2. Classical Pfalz altar pedestal shaft (Sockel, Z = 0.34..1.16m)
    add_tapered_prism(bm_s, uv_s,  0.34, 1.14, 0.58, 0.44, 0.54, 0.40, cap_top=False)
    # Recessed carved plaque border on front (-Y = glTF +Z)
    add_box(bm_s, uv_s, (0.0, -0.22, 0.74), (0.38, 0.04, 0.52))

    # 3. Projecting carved Baroque/classical cornice cap (Gesims, Z = 1.14..1.32m)
    add_tapered_prism(bm_s, uv_s,  1.14, 1.24, 0.56, 0.42, 0.72, 0.58, cap_top=True)
    add_tapered_prism(bm_s, uv_s,  1.24, 1.34, 0.68, 0.54, 0.46, 0.36, cap_top=True)

    # 4. Cross base socket & tall vertical sandstone cross shaft (Z = 1.34..2.46m)
    add_tapered_prism(bm_s, uv_s,  1.34, 1.46, 0.34, 0.28, 0.24, 0.20, cap_top=False)
    add_tapered_prism(bm_s, uv_s,  1.46, 2.40, 0.20, 0.16, 0.17, 0.14, cap_top=False)
    # Chamfered peaked top finial
    add_tapered_prism(bm_s, uv_s,  2.40, 2.48, 0.17, 0.14, 0.09, 0.08, cap_top=True)

    # 5. Horizontal cross arms (Querbalken at Z = 1.98m, total span 0.86m) with subtly flared ends
    add_box(bm_s, uv_s, (0.0, 0.0, 1.98), (0.76, 0.15, 0.16))
    for sx in (-1.0, 1.0):
        add_box(bm_s, uv_s, (sx * 0.41, 0.0, 1.98), (0.08, 0.17, 0.19))

    bmesh.ops.recalc_face_normals(bm_s, faces=bm_s.faces)
    obj_stone = create_mesh_object("Wegekreuz_Sandstone", bm_s, mat_stone, smooth=False, collection=col)

    # Weathered dark-bronze wrought relief accent (INRI scroll & stylized silhouette on front -Y face)
    bm_b = bmesh.new()
    uv_b = bm_b.loops.layers.uv.new("UVMap")
    add_box(bm_b, uv_b, (0.0, -0.092, 2.22), (0.12, 0.022, 0.065))             # INRI scroll plaque
    add_pole(bm_b, uv_b, (0.0, -0.098, 1.72), (0.0, -0.098, 2.08), 0.024, 0.028, sides=5)  # Torso/vertical relief
    add_pole(bm_b, uv_b, (-0.23, -0.096, 1.99), (0.23, -0.096, 1.99), 0.017, 0.017, sides=5)  # Arms relief
    add_box(bm_b, uv_b, (0.0, -0.245, 0.74), (0.26, 0.014, 0.34))              # Dark bronze memorial inscription tablet
    obj_bronze = create_mesh_object("Wegekreuz_Bronze", bm_b, mat_bronze, smooth=True, collection=col)

    return [obj_stone, obj_bronze]


# ---------------------------------------------------------------------------
# Cycles 1280x720 Sunlit Showcase Renderer
# ---------------------------------------------------------------------------

def render_cycles_showcase(render_path: str, prop_groups: dict):
    """Arrange all 4 rural props cleanly on a sunlit Pfalz meadow hillside and render in Cycles."""
    placements = {
        "hedgerow_bay":       (-3.2,  1.8, 0.0, math.radians(10)),
        "vineyard_rose_post": (-0.6, -2.1, 0.0, math.radians(-18)),
        "wegekreuz":          ( 1.2, -1.7, 0.0, math.radians(16)),
        "hochsitz":           ( 3.2,  1.5, 0.0, math.radians(-28)),
    }
    for key, objs in prop_groups.items():
        dx, dy, dz, rz = placements[key]
        for o in objs:
            o.location = (dx, dy, dz)
            o.rotation_euler = Euler((0.0, 0.0, rz), "XYZ")

    # Sunlit grassy Pfalz hillside ground pad
    mat_ground = make_pbr_material("Showcase_Meadow", base_color=(0.14, 0.20, 0.08, 1.0), roughness=0.95)
    bpy.ops.mesh.primitive_plane_add(size=80.0, location=(0.0, 2.0, 0.0))
    ground = bpy.context.active_object
    ground.data.materials.append(mat_ground)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.transparent_max_bounces = 12
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -1.65

    world = bpy.data.worlds.new("PfalzSummerSky")
    scene.world = world
    wnt = world.node_tree
    bg = wnt.nodes.get("Background")
    sky = wnt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = True
    sky.sun_elevation = math.radians(38.0)
    sky.sun_rotation = math.radians(218.0)
    sky.air_density = 1.15
    wnt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.38

    cam_data = bpy.data.cameras.new("ShowcaseCam")
    cam_data.lens = 35.0
    cam_obj = bpy.data.objects.new("ShowcaseCam", cam_data)
    cam_obj.location = Vector((-0.3, -10.8, 2.65))
    target = Vector((0.2, 0.4, 1.65))
    cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    os.makedirs(os.path.dirname(render_path), exist_ok=True)
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    print(f"[RENDER] Saved Cycles showcase -> {render_path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", type=str, default="", help="Optional 1280x720 Cycles showcase PNG output")
    args = parser.parse_args(argv)

    clear_scene()
    builders = {
        "hedgerow_bay":       (build_hedgerow_bay,       {"alongRowM": 5.0, "betweenBaysM": 2.2, "windSway": 0.04}),
        "vineyard_rose_post": (build_vineyard_rose_post, {"spacingM": 5.5, "windSway": 0.03}),
        "hochsitz":           (build_hochsitz,           {"spacingM": 4.0, "windSway": 0.0}),
        "wegekreuz":          (build_wegekreuz,          {"spacingM": 2.5, "windSway": 0.0}),
    }

    prop_groups = {}
    meta_models = {}
    total_bytes = 0

    for key, (fn, extra) in builders.items():
        col = bpy.data.collections.new(f"Prop_{key}")
        bpy.context.scene.collection.children.link(col)
        objs = fn(col)
        prop_groups[key] = objs

        glb_path = os.path.join(GLB_DIR, f"{key}.glb")
        export_glb(objs, glb_path)
        bbox = compute_gltf_bbox(objs)
        tris = count_tris(objs)
        fsize = os.path.getsize(glb_path)
        total_bytes += fsize
        entry = {
            "key": key,
            "name": key,
            "glbPath": f"/assets/models/fields/props/{key}.glb",
            "bounds": bbox["size"],
            "boundsDetail": bbox,
            "meshCount": len(objs),
            "triangles": tris,
            "fileSizeBytes": fsize,
        }
        entry.update(extra)
        meta_models[key] = entry
        print(f"[GLB] {key}.glb: {fsize/1024:.1f} KB | {tris} tris | size={bbox['size']} | minY={bbox['min'][1]}")

    meta = {
        "category": "rural_props",
        "totalBytes": total_bytes,
        "models": meta_models,
    }
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"[META] Wrote {META_OUT} (total props GLB size: {total_bytes/1024:.1f} KB)")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"[BLEND] Saved {BLEND_OUT}")

    if args.render:
        render_cycles_showcase(args.render, prop_groups)


if __name__ == "__main__":
    main()
