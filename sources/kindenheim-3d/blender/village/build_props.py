#!/usr/bin/env python3
"""
Blender Rural & Village Props Builder for Kindenheim (Rheinland-Pfalz).

Builds and exports 7 realistic, PBR-textured, GPU-instancing-ready .glb props to:
  public/assets/models/village/props/
    - vine_row.glb
    - tree_deciduous.glb
    - tree_orchard.glb
    - ortsschild.glb
    - streetlamp.glb
    - hay_bale.glb
    - wine_barrel.glb

Also saves:
  - blender/village/props/kindenheim_props.blend (all props neatly arranged for inspection/reuse)
  - public/assets/models/village/props_meta.json (exact glTF bounding boxes & metadata)
  - Optional sunlit 1280x720 preview render (--render <path>)

Run via:
  /opt/homebrew/bin/blender --background --python blender/village/build_props.py -- --render <png_path>
"""

import argparse
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector, Euler

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
TEX_DIR = os.path.join(PROJECT_ROOT, "blender/village/textures/props")
BLEND_OUT = os.path.join(PROJECT_ROOT, "blender/village/props/kindenheim_props.blend")
GLB_DIR = os.path.join(PROJECT_ROOT, "public/assets/models/village/props")
META_OUT = os.path.join(PROJECT_ROOT, "blender/village/props/props_meta.json")

os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
os.makedirs(GLB_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Blender 5.2 Safe Material Helpers
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
    albedo_path: str = None,
    normal_path: str = None,
    base_color=(0.8, 0.8, 0.8, 1.0),
    roughness: float = 0.75,
    metallic: float = 0.0,
    alpha_clip: bool = False,
    double_sided: bool = False,
    emission_color=None,
    emission_strength: float = 0.0,
    normal_strength: float = 1.0,
):
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Base Color"].default_value = base_color

    if emission_color is not None and emission_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = emission_color
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    if albedo_path and os.path.exists(albedo_path):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = load_image(albedo_path, "sRGB")
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_clip:
            # Blender 5.x + glTF exporter maps Math(ROUND) on Alpha -> alphaMode: "MASK"
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
    if smooth:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    if collection is None:
        bpy.context.collection.objects.link(obj)
    else:
        collection.objects.link(obj)
    return obj


def add_tapered_tube(
    bm: bmesh.types.BMesh,
    uv_layer,
    points: list,
    radii: list,
    sides: int = 7,
    uv_v_scale: float = 1.0,
    cap_start: bool = False,
    cap_end: bool = True,
):
    """Extrude an organic tapered cylindrical branch/post along a 3D polyline with clean UVs."""
    rings = []
    v_dist = 0.0
    prev_up = Vector((0.0, 0.0, 1.0))

    for idx, (pt, rad) in enumerate(zip(points, radii)):
        p = Vector(pt)
        if idx > 0:
            v_dist += (p - Vector(points[idx - 1])).length
        if idx == 0:
            tangent = (Vector(points[1]) - p).normalized()
        elif idx == len(points) - 1:
            tangent = (p - Vector(points[idx - 1])).normalized()
        else:
            tangent = (Vector(points[idx + 1]) - Vector(points[idx - 1])).normalized()
        if tangent.length < 1e-6:
            tangent = Vector((0.0, 0.0, 1.0))

        ref = Vector((1.0, 0.0, 0.0)) if abs(tangent.z) > 0.92 else Vector((0.0, 0.0, 1.0))
        side_x = tangent.cross(ref).normalized()
        side_y = tangent.cross(side_x).normalized()

        ring = []
        for s in range(sides):
            a = (s / sides) * 2.0 * math.pi
            offset = (side_x * math.cos(a) + side_y * math.sin(a)) * rad
            ring.append(bm.verts.new(p + offset))
        rings.append((ring, v_dist))

    for i in range(len(rings) - 1):
        r0, v0 = rings[i]
        r1, v1 = rings[i + 1]
        for s in range(sides):
            sn = (s + 1) % sides
            try:
                f = bm.faces.new((r0[s], r0[sn], r1[sn], r1[s]))
                u0 = s / sides
                u1 = (s + 1) / sides
                f.loops[0][uv_layer].uv = (u0, v0 * uv_v_scale)
                f.loops[1][uv_layer].uv = (u1, v0 * uv_v_scale)
                f.loops[2][uv_layer].uv = (u1, v1 * uv_v_scale)
                f.loops[3][uv_layer].uv = (u0, v1 * uv_v_scale)
            except ValueError:
                pass

    if cap_start and rings:
        try:
            f = bm.faces.new(list(reversed(rings[0][0])))
            for lp in f.loops:
                lp[uv_layer].uv = (0.5, 0.5)
        except ValueError:
            pass
    if cap_end and rings:
        try:
            f = bm.faces.new(rings[-1][0])
            for lp in f.loops:
                lp[uv_layer].uv = (0.5, 0.5)
        except ValueError:
            pass


def add_bent_foliage_card(
    bm: bmesh.types.BMesh,
    uv_layer,
    center: Vector,
    rot_euler: Euler,
    width: float,
    height: float,
    cup: float = 0.14,
):
    """Add a 2-quad gently cupped foliage sprig card (4 tris) so crowns never look flat."""
    mat = rot_euler.to_matrix()
    hw, hh = width * 0.5, height * 0.5
    # 6 vertices forming a subtly folded V/cup leaf cluster
    local_pts = [
        Vector((-hw, -cup, -hh)),
        Vector((0.0, cup * 0.5, -hh)),
        Vector((hw, -cup, -hh)),
        Vector((-hw, -cup, hh)),
        Vector((0.0, cup * 0.5, hh)),
        Vector((hw, -cup, hh)),
    ]
    verts = [bm.verts.new(center + mat @ p) for p in local_pts]
    quads = [
        ((0, 1, 4, 3), ((0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (0.0, 1.0))),
        ((1, 2, 5, 4), ((0.5, 0.0), (1.0, 0.0), (1.0, 1.0), (0.5, 1.0))),
    ]
    for idxs, uvs in quads:
        try:
            f = bm.faces.new([verts[i] for i in idxs])
            for lp, uv in zip(f.loops, uvs):
                lp[uv_layer].uv = uv
        except ValueError:
            pass


def compute_gltf_bbox(objects):
    """Compute world-space glTF (Y-up) bounding box from Blender (Z-up) objects."""
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


def export_prop_glb(objects, glb_path: str):
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
# Prop 1: Palatinate Grapevine Trellis Section (vine_row.glb)
# 6.0m seamless bay along X in [-3.0, +3.0], ground Z=0 (Y=0 in glTF)
# ---------------------------------------------------------------------------

def build_vine_row(col):
    rng = random.Random(101)
    mat_wood = make_pbr_material(
        "Vine_Wood",
        albedo_path=os.path.join(TEX_DIR, "bark_vine_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "bark_tree_normal.png"),
        roughness=0.88,
        normal_strength=0.9,
    )
    mat_wire = make_pbr_material(
        "Vine_Wire",
        base_color=(0.48, 0.50, 0.52, 1.0),
        roughness=0.38,
        metallic=0.82,
    )
    mat_canopy = make_pbr_material(
        "Vine_Canopy_Mat",
        albedo_path=os.path.join(TEX_DIR, "vine_leaves.png"),
        roughness=0.62,
        alpha_clip=True,
        double_sided=True,
    )

    # 1. Wooden posts & gnarled vine trunks + cordon arms
    bm_wood = bmesh.new()
    uv_w = bm_wood.loops.layers.uv.new("UVMap")

    # Two wooden Pfähle at X = -1.5 and +1.5 (seamless 3.0m spacing across tiled 6.0m bays!)
    for px in (-1.5, 1.5):
        pts = [(px, 0.0, -0.45), (px, 0.0, 0.0), (px + rng.uniform(-0.015, 0.015), rng.uniform(-0.015, 0.015), 1.72), (px, 0.0, 1.80)]
        rads = [0.042, 0.042, 0.036, 0.008]
        add_tapered_tube(bm_wood, uv_w, pts, rads, sides=7, uv_v_scale=0.6)

    # 4 gnarled grapevine trunks at X = -2.25, -0.75, +0.75, +2.25
    for vx in (-2.25, -0.75, 0.75, 2.25):
        g1 = rng.uniform(-0.04, 0.04)
        g2 = rng.uniform(-0.04, 0.04)
        trunk_pts = [
            (vx, 0.0, -0.35),
            (vx + g1 * 0.5, g2 * 0.5, 0.20),
            (vx - g1, g2, 0.48),
            (vx + g1 * 0.3, -g2 * 0.4, 0.74),
        ]
        trunk_rads = [0.038, 0.034, 0.028, 0.022]
        add_tapered_tube(bm_wood, uv_w, trunk_pts, trunk_rads, sides=6, uv_v_scale=1.2)
        # Left & right horizontal fruiting cordon arms along wire (Z=0.74m)
        for dx in (-0.65, 0.65):
            arm_pts = [
                (vx, 0.0, 0.74),
                (vx + dx * 0.5, rng.uniform(-0.03, 0.03), 0.78),
                (vx + dx, rng.uniform(-0.02, 0.02), 0.73),
            ]
            add_tapered_tube(bm_wood, uv_w, arm_pts, [0.018, 0.014, 0.009], sides=5, uv_v_scale=1.2)

    obj_wood = create_mesh_object("Vine_Wood", bm_wood, mat_wood, smooth=True, collection=col)

    # 2. Galvanized trellis wires running full 6.0m bay (X = -3.0 .. +3.0)
    bm_wire = bmesh.new()
    uv_wi = bm_wire.loops.layers.uv.new("UVMap")
    for wz in (0.74, 1.16, 1.56):
        add_tapered_tube(bm_wire, uv_wi, [(-3.0, 0.0, wz), (3.0, 0.0, wz)], [0.006, 0.006], sides=4, cap_end=False)
    obj_wire = create_mesh_object("Vine_Wire", bm_wire, mat_wire, smooth=False, collection=col)

    # 3. Lush dense multi-angle leafy canopy wall (Z = 0.58..1.72m, matching real Kindenheim L450 vineyards!)
    # Note: add_bent_foliage_card lies in the vertical XZ plane (rx=0 is vertical, rx=90deg is horizontal!)
    bm_leaf = bmesh.new()
    uv_l = bm_leaf.loops.layers.uv.new("UVMap")

    # Longitudinal front & back vertical bushy foliage walls (9 overlapping cards per side along 6m!)
    for side in (-1.0, 1.0):
        for i in range(9):
            cx = -2.66 + i * 0.665 + rng.uniform(-0.06, 0.06)
            cy = side * (0.22 + rng.uniform(-0.04, 0.06))
            cz = 1.15 + rng.uniform(-0.07, 0.08)
            rx = math.radians(side * rng.uniform(-16.0, 14.0))
            ry = math.radians(rng.uniform(-10.0, 10.0))
            rz = math.radians((0.0 if side < 0 else 180.0) + rng.uniform(-16.0, 16.0))
            add_bent_foliage_card(
                bm_leaf, uv_l,
                Vector((cx, cy, cz)),
                Euler((rx, ry, rz), "XYZ"),
                width=1.08, height=1.10, cup=0.10,
            )

    # Vertical diagonal cross-baffles inside canopy so row looks lush from down-the-alley angle!
    for i in range(11):
        cx = -2.72 + i * 0.544 + rng.uniform(-0.04, 0.04)
        cy = rng.uniform(-0.06, 0.06)
        cz = 1.14 + rng.uniform(-0.08, 0.08)
        rz = math.radians(52.0 if i % 2 == 0 else -52.0) + math.radians(rng.uniform(-14, 14))
        rx = math.radians(rng.uniform(-15.0, 15.0))
        add_bent_foliage_card(
            bm_leaf, uv_l,
            Vector((cx, cy, cz)),
            Euler((rx, 0.0, rz), "XYZ"),
            width=0.76, height=1.06, cup=0.07,
        )

    # Horizontal ruffled top crown shoots (caps top of vine wall cleanly for aerial drone camera!)
    for i in range(8):
        cx = -2.62 + i * 0.75
        cy = rng.uniform(-0.05, 0.05)
        cz = 1.62 + rng.uniform(-0.05, 0.06)
        add_bent_foliage_card(
            bm_leaf, uv_l,
            Vector((cx, cy, cz)),
            Euler((math.radians(90.0 + rng.uniform(-18, 18)), math.radians(rng.uniform(-12, 12)), math.radians(rng.uniform(-18, 18))), "XYZ"),
            width=1.12, height=0.68, cup=0.08,
        )

    obj_leaf = create_mesh_object("Vine_Canopy", bm_leaf, mat_canopy, smooth=True, collection=col)
    return [obj_wood, obj_wire, obj_leaf]


# ---------------------------------------------------------------------------
# Prop 2 & 3: Natural Multi-Branch Deciduous & Orchard Trees
# ---------------------------------------------------------------------------

def build_tree(col, name_prefix: str, orchard: bool = False):
    rng = random.Random(202 if not orchard else 303)
    mat_bark = make_pbr_material(
        f"{name_prefix}_Bark_Mat",
        albedo_path=os.path.join(TEX_DIR, "bark_tree_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "bark_tree_normal.png"),
        roughness=0.90,
        normal_strength=1.1,
    )
    fol_tex = "tree_foliage_orchard.png" if orchard else "tree_foliage_deciduous.png"
    mat_fol = make_pbr_material(
        f"{name_prefix}_Foliage_Mat",
        albedo_path=os.path.join(TEX_DIR, fol_tex),
        roughness=0.68,
        alpha_clip=True,
        double_sided=True,
    )

    bm_bark = bmesh.new()
    uv_b = bm_bark.loops.layers.uv.new("UVMap")

    if not orchard:
        # Palatinate Walnut / Oak / Linden (~8.4m tall, ~6.4m crown)
        trunk_h = 2.65
        base_r = 0.34
        fork_r = 0.20
        n_main = 5
        branch_len = (2.4, 3.3)
        branch_elev = (0.55, 1.05)
        crown_center_z = 5.4
        cluster_size = (1.75, 2.35)
    else:
        # Pfalz Apple / Almond Orchard Tree (~4.9m tall, ~4.5m crown)
        trunk_h = 1.45
        base_r = 0.22
        fork_r = 0.14
        n_main = 4
        branch_len = (1.5, 2.2)
        branch_elev = (0.42, 0.88)
        crown_center_z = 3.1
        cluster_size = (1.25, 1.75)

    # Organic subtly leaning trunk extending -0.55m underground for hillside grounding
    lean_x = rng.uniform(-0.14, 0.14)
    lean_y = rng.uniform(-0.14, 0.14)
    trunk_pts = [
        (0.0, 0.0, -0.55),
        (0.0, 0.0, 0.0),
        (lean_x * 0.4, lean_y * 0.4, trunk_h * 0.48),
        (lean_x, lean_y, trunk_h),
    ]
    trunk_rads = [base_r * 1.18, base_r * 1.12, (base_r + fork_r) * 0.52, fork_r]
    add_tapered_tube(bm_bark, uv_b, trunk_pts, trunk_rads, sides=8, uv_v_scale=0.5)

    # Primary & secondary limbs + collect foliage anchor points
    foliage_anchors = []
    fork_top = Vector((lean_x, lean_y, trunk_h))

    # Central leader branch for tall deciduous trees
    if not orchard:
        leader_mid = fork_top + Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), 1.9))
        leader_tip = leader_mid + Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 2.1))
        add_tapered_tube(bm_bark, uv_b, [fork_top, leader_mid, leader_tip], [fork_r * 0.72, 0.11, 0.04], sides=6, uv_v_scale=0.6)
        foliage_anchors.append((leader_tip, 1.15))
        foliage_anchors.append((leader_mid.lerp(leader_tip, 0.45), 1.0))

    for i in range(n_main):
        az = (i / n_main) * 2.0 * math.pi + rng.uniform(-0.28, 0.28)
        elev = rng.uniform(*branch_elev)
        blen = rng.uniform(*branch_len)
        d = Vector((math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev)))
        p0 = fork_top + Vector((0, 0, rng.uniform(-0.22, 0.05)))
        p1 = p0 + d * (blen * 0.52) + Vector((0, 0, 0.18))
        p2 = p0 + d * blen + Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), 0.28))
        add_tapered_tube(bm_bark, uv_b, [p0, p1, p2], [fork_r * 0.65, fork_r * 0.42, 0.04], sides=6, uv_v_scale=0.7)
        foliage_anchors.append((p2, 1.05))
        foliage_anchors.append((p1.lerp(p2, 0.55) + Vector((0, 0, 0.35)), 0.92))

        # 2 secondary sub-branches per primary limb
        for sub_side in (-1, 1):
            az2 = az + sub_side * rng.uniform(0.45, 0.85)
            elev2 = elev + rng.uniform(-0.15, 0.32)
            slen = blen * rng.uniform(0.42, 0.60)
            d2 = Vector((math.cos(az2) * math.cos(elev2), math.sin(az2) * math.cos(elev2), math.sin(elev2)))
            sp1 = p1 + d2 * slen
            add_tapered_tube(bm_bark, uv_b, [p1, sp1], [fork_r * 0.34, 0.03], sides=5, uv_v_scale=0.8)
            foliage_anchors.append((sp1, 0.90))

    obj_bark = create_mesh_object(f"{name_prefix}_Bark", bm_bark, mat_bark, smooth=True, collection=col)

    # Multi-layered crossed & cupped organic leaf clusters at every branch tip
    bm_fol = bmesh.new()
    uv_f = bm_fol.loops.layers.uv.new("UVMap")
    crown_center = Vector((lean_x, lean_y, crown_center_z))

    for anchor, scale_w in foliage_anchors:
        # 3-4 intersecting tilted foliage cards per branch cluster -> rich lush crown volume!
        n_cards = 4 if not orchard else 3
        for k in range(n_cards):
            jitter = Vector((rng.uniform(-0.46, 0.46), rng.uniform(-0.46, 0.46), rng.uniform(-0.32, 0.40)))
            pos = anchor + jitter
            sz = rng.uniform(*cluster_size) * scale_w * 1.15
            rx = math.radians(rng.uniform(32.0, 128.0)) if k < 2 else math.radians(rng.uniform(-32.0, 32.0))
            ry = math.radians(rng.uniform(-35.0, 35.0))
            rz = math.radians(rng.uniform(0.0, 360.0))
            add_bent_foliage_card(
                bm_fol, uv_f, pos, Euler((rx, ry, rz), "XYZ"),
                width=sz, height=sz * rng.uniform(0.88, 1.12), cup=sz * 0.12,
            )

    # Extra sunlit upper-crown & inner-crown puffs so both street & aerial views look lush and natural
    n_top = 12 if not orchard else 10
    for i in range(n_top):
        az = (i / n_top) * 2.0 * math.pi + rng.uniform(-0.25, 0.25)
        rad = rng.uniform(0.3, 2.3 if not orchard else 1.55)
        tz = (crown_center_z + (1.4 if not orchard else 0.7)) + rng.uniform(-0.85, 0.95)
        pos = Vector((math.cos(az) * rad, math.sin(az) * rad, tz))
        sz = rng.uniform(*cluster_size) * 1.12
        add_bent_foliage_card(
            bm_fol, uv_f, pos,
            Euler((math.radians(rng.uniform(-32, 32)), math.radians(rng.uniform(-32, 32)), rng.uniform(0, 6.28)), "XYZ"),
            width=sz, height=sz * 0.96, cup=sz * 0.11,
        )

    obj_fol = create_mesh_object(f"{name_prefix}_Foliage", bm_fol, mat_fol, smooth=True, collection=col)

    # Smooth outward-blended custom normals on foliage mesh for lush natural sun wrap!
    mesh = obj_fol.data
    normals = []
    for v in mesh.vertices:
        radial = (v.co - crown_center)
        if radial.length < 1e-4:
            radial = Vector((0.0, 0.0, 1.0))
        else:
            radial.normalize()
        # Bias slightly upward so top of crown catches warm sunlight
        nrm = (radial * 0.78 + Vector((0.0, 0.0, 0.22))).normalized()
        normals.append(nrm)
    try:
        mesh.normals_split_custom_set_from_vertices(normals)
    except Exception:
        pass

    return [obj_bark, obj_fol]


# ---------------------------------------------------------------------------
# Prop 4: Authentic German Ortsschild ("Kindenheim / Landkreis Bad Dürkheim")
# ---------------------------------------------------------------------------

def build_ortsschild(col):
    mat_steel = make_pbr_material(
        "Ortsschild_Steel",
        base_color=(0.66, 0.68, 0.70, 1.0),
        roughness=0.38,
        metallic=0.82,
    )
    mat_front = make_pbr_material(
        "Ortsschild_Front",
        albedo_path=os.path.join(TEX_DIR, "ortsschild_front.png"),
        roughness=0.32,
        metallic=0.08,
    )
    mat_back = make_pbr_material(
        "Ortsschild_Back",
        albedo_path=os.path.join(TEX_DIR, "ortsschild_back.png"),
        roughness=0.32,
        metallic=0.08,
    )

    # Galvanized twin posts + rear mounting brackets + sign rim frame
    bm_st = bmesh.new()
    uv_st = bm_st.loops.layers.uv.new("UVMap")
    for px in (-0.34, 0.34):
        add_tapered_tube(bm_st, uv_st, [(px, 0.032, -0.50), (px, 0.032, 2.26)], [0.030, 0.030], sides=12)
    # Horizontal mounting rails behind sign
    for rz in (1.72, 2.12):
        bmesh.ops.create_cube(bm_st, size=1.0, matrix=Matrix.Translation((0.0, 0.015, rz)) @ Matrix.Diagonal((0.86, 0.02, 0.03, 1.0)))
    # Thin metal sign edge frame (width 0.96m, height 0.64m, centered at Z=1.92m)
    sw, sh, st = 0.96, 0.64, 0.022
    cz = 1.92
    bmesh.ops.create_cube(bm_st, size=1.0, matrix=Matrix.Translation((0.0, 0.0, cz)) @ Matrix.Diagonal((sw, st, sh, 1.0)))
    obj_steel = create_mesh_object("Ortsschild_Frame", bm_st, mat_steel, smooth=False, collection=col)

    # Front face (facing -Y in Blender -> +Z in glTF!)
    bm_fr = bmesh.new()
    uv_fr = bm_fr.loops.layers.uv.new("UVMap")
    y_f = -st * 0.5 - 0.002
    v0 = bm_fr.verts.new((-sw * 0.5, y_f, cz - sh * 0.5))
    v1 = bm_fr.verts.new((sw * 0.5, y_f, cz - sh * 0.5))
    v2 = bm_fr.verts.new((sw * 0.5, y_f, cz + sh * 0.5))
    v3 = bm_fr.verts.new((-sw * 0.5, y_f, cz + sh * 0.5))
    f = bm_fr.faces.new((v0, v1, v2, v3))
    for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv_fr].uv = uv
    obj_front = create_mesh_object("Ortsschild_FrontFace", bm_fr, mat_front, smooth=False, collection=col)

    # Back face (facing +Y in Blender -> -Z in glTF!)
    bm_bk = bmesh.new()
    uv_bk = bm_bk.loops.layers.uv.new("UVMap")
    y_b = st * 0.5 + 0.002
    b0 = bm_bk.verts.new((sw * 0.5, y_b, cz - sh * 0.5))
    b1 = bm_bk.verts.new((-sw * 0.5, y_b, cz - sh * 0.5))
    b2 = bm_bk.verts.new((-sw * 0.5, y_b, cz + sh * 0.5))
    b3 = bm_bk.verts.new((sw * 0.5, y_b, cz + sh * 0.5))
    fb = bm_bk.faces.new((b0, b1, b2, b3))
    for lp, uv in zip(fb.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv_bk].uv = uv
    obj_back = create_mesh_object("Ortsschild_BackFace", bm_bk, mat_back, smooth=False, collection=col)

    return [obj_steel, obj_front, obj_back]


# ---------------------------------------------------------------------------
# Prop 5: Authentic Kindenheim Galvanized Curved Peitschenleuchte (streetlamp.glb)
# Matches real Kindenheim Hauptstraße, Neugasse & Burgweg streetlamps in Street View!
# ---------------------------------------------------------------------------

def build_streetlamp(col):
    mat_metal = make_pbr_material(
        "Streetlamp_Galvanized_Metal",
        base_color=(0.56, 0.58, 0.60, 1.0),
        roughness=0.38,
        metallic=0.80,
    )
    mat_head = make_pbr_material(
        "Streetlamp_Luminaire_Housing",
        base_color=(0.24, 0.26, 0.28, 1.0),
        roughness=0.42,
        metallic=0.72,
    )
    mat_glass = make_pbr_material(
        "Streetlamp_LED_Lens",
        base_color=(1.0, 0.96, 0.86, 1.0),
        roughness=0.16,
        metallic=0.0,
        emission_color=(1.0, 0.92, 0.72, 1.0),
        emission_strength=1.5,
    )

    bm_m = bmesh.new()
    uv_m = bm_m.loops.layers.uv.new("UVMap")

    # Authentic slim galvanized German Peitschenleuchte sweeping arc (height ~5.85m, reach 1.15m!)
    pole_pts = [
        (0.0, 0.0, -0.50),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 1.15),
        (0.0, 0.0, 4.45),
        (0.0, -0.06, 4.95),
        (0.0, -0.22, 5.35),
        (0.0, -0.50, 5.64),
        (0.0, -0.84, 5.80),
        (0.0, -1.12, 5.86),
    ]
    pole_rads = [0.068, 0.066, 0.060, 0.044, 0.040, 0.036, 0.033, 0.030, 0.028]
    add_tapered_tube(bm_m, uv_m, pole_pts, pole_rads, sides=10)
    obj_metal = create_mesh_object("Streetlamp_Pole", bm_m, mat_metal, smooth=True, collection=col)

    # Streamlined modern-German LED luminaire shoe housing angled slightly upward at arc tip
    bm_h = bmesh.new()
    uv_h = bm_h.loops.layers.uv.new("UVMap")
    head_mat = (
        Matrix.Translation((0.0, -1.28, 5.89))
        @ Matrix.Rotation(math.radians(-10.0), 4, "X")
        @ Matrix.Diagonal((0.20, 0.44, 0.075, 1.0))
    )
    bmesh.ops.create_cube(bm_h, size=1.0, matrix=head_mat)
    obj_head = create_mesh_object("Streetlamp_Housing", bm_h, mat_head, smooth=False, collection=col)

    # Glowing underside diffuser lens
    bm_g = bmesh.new()
    uv_g = bm_g.loops.layers.uv.new("UVMap")
    lens_mat = (
        Matrix.Translation((0.0, -1.30, 5.848))
        @ Matrix.Rotation(math.radians(-10.0), 4, "X")
        @ Matrix.Diagonal((0.15, 0.30, 0.022, 1.0))
    )
    bmesh.ops.create_cube(bm_g, size=1.0, matrix=lens_mat)
    obj_glass = create_mesh_object("Streetlamp_Diffuser", bm_g, mat_glass, smooth=False, collection=col)
    return [obj_metal, obj_head, obj_glass]


# ---------------------------------------------------------------------------
# Prop 6: Round Straw Hay Bale (hay_bale.glb)
# ---------------------------------------------------------------------------

def build_hay_bale(col):
    mat_hay = make_pbr_material(
        "HayBale_Mat",
        albedo_path=os.path.join(TEX_DIR, "hay_bale_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "hay_bale_normal.png"),
        roughness=0.94,
        normal_strength=1.2,
    )

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    rng = random.Random(606)

    radius = 0.75
    half_len = 0.62
    cz = radius - 0.02  # Slightly settled into ground (Z = -0.02..1.48)
    segs = 20
    # Build 5 rings along X from -half_len to +half_len for beveled organic round bale ends
    x_profile = [
        (-half_len, radius * 0.92),
        (-half_len + 0.09, radius),
        (0.0, radius * 1.01),
        (half_len - 0.09, radius),
        (half_len, radius * 0.92),
    ]
    rings = []
    for r_i, (xp, rp) in enumerate(x_profile):
        ring = []
        for s in range(segs):
            a = (s / segs) * 2.0 * math.pi
            jit = rng.uniform(-0.015, 0.015)
            y = math.cos(a) * (rp + jit)
            z = cz + math.sin(a) * (rp + jit)
            ring.append(bm.verts.new((xp, y, z)))
        rings.append((ring, r_i / (len(x_profile) - 1)))

    # Barrel UVs map into LEFT half of texture (u in 0.0..0.49)
    for i in range(len(rings) - 1):
        r0, u_t0 = rings[i]
        r1, u_t1 = rings[i + 1]
        for s in range(segs):
            sn = (s + 1) % segs
            f = bm.faces.new((r0[s], r1[s], r1[sn], r0[sn]))
            v0 = s / segs
            v1 = (s + 1) / segs
            f.loops[0][uv].uv = (u_t0 * 0.49, v0)
            f.loops[1][uv].uv = (u_t1 * 0.49, v0)
            f.loops[2][uv].uv = (u_t1 * 0.49, v1)
            f.loops[3][uv].uv = (u_t0 * 0.49, v1)

    # Spiral end caps map into RIGHT half of texture (u in 0.51..0.99)
    for is_pos, ring in [(False, rings[0][0]), (True, rings[-1][0])]:
        cx_end = half_len if is_pos else -half_len
        c_vert = bm.verts.new((cx_end + (0.02 if is_pos else -0.02), 0.0, cz))
        for s in range(segs):
            sn = (s + 1) % segs
            a0 = (s / segs) * 2.0 * math.pi
            a1 = ((s + 1) / segs) * 2.0 * math.pi
            if is_pos:
                f = bm.faces.new((ring[s], c_vert, ring[sn]))
                uvs = (
                    (0.75 + 0.23 * math.cos(a0), 0.5 + 0.46 * math.sin(a0)),
                    (0.75, 0.5),
                    (0.75 + 0.23 * math.cos(a1), 0.5 + 0.46 * math.sin(a1)),
                )
            else:
                f = bm.faces.new((ring[sn], c_vert, ring[s]))
                uvs = (
                    (0.75 + 0.23 * math.cos(a1), 0.5 + 0.46 * math.sin(a1)),
                    (0.75, 0.5),
                    (0.75 + 0.23 * math.cos(a0), 0.5 + 0.46 * math.sin(a0)),
                )
            for lp, uvp in zip(f.loops, uvs):
                lp[uv].uv = uvp

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = create_mesh_object("HayBale", bm, mat_hay, smooth=True, collection=col)
    return [obj]


# ---------------------------------------------------------------------------
# Prop 7: Pfalz Oak Wine Barrel (wine_barrel.glb)
# ---------------------------------------------------------------------------

def build_wine_barrel(col):
    mat_oak = make_pbr_material(
        "WineBarrel_Oak",
        albedo_path=os.path.join(TEX_DIR, "wine_barrel_albedo.jpg"),
        normal_path=os.path.join(TEX_DIR, "wine_barrel_normal.png"),
        roughness=0.72,
        normal_strength=1.0,
    )
    mat_iron = make_pbr_material(
        "WineBarrel_Iron",
        base_color=(0.18, 0.19, 0.21, 1.0),
        roughness=0.45,
        metallic=0.85,
    )

    bm_oak = bmesh.new()
    uv_o = bm_oak.loops.layers.uv.new("UVMap")
    segs = 20
    H = 0.94
    # Classic Barrique / Halbstück profile (bulged belly)
    profile = [
        (0.00, 0.275),
        (0.04, 0.285),
        (0.18, 0.320),
        (0.35, 0.348),
        (0.47, 0.356),
        (0.59, 0.348),
        (0.76, 0.320),
        (0.90, 0.285),
        (0.94, 0.275),
    ]
    rings = []
    for zp, rp in profile:
        ring = []
        for s in range(segs):
            a = (s / segs) * 2.0 * math.pi
            ring.append(bm_oak.verts.new((math.cos(a) * rp, math.sin(a) * rp, zp)))
        rings.append((ring, zp / H))

    for i in range(len(rings) - 1):
        r0, v0 = rings[i]
        r1, v1 = rings[i + 1]
        for s in range(segs):
            sn = (s + 1) % segs
            f = bm_oak.faces.new((r0[s], r0[sn], r1[sn], r1[s]))
            u0, u1 = s / segs, (s + 1) / segs
            f.loops[0][uv_o].uv = (u0, v0)
            f.loops[1][uv_o].uv = (u1, v0)
            f.loops[2][uv_o].uv = (u1, v1)
            f.loops[3][uv_o].uv = (u0, v1)

    # Recessed top & bottom oak heads (with chime lip)
    for is_top, edge_ring, z_lip, z_lid in [(False, rings[0][0], 0.0, 0.03), (True, rings[-1][0], H, H - 0.035)]:
        inner_ring = []
        for s in range(segs):
            a = (s / segs) * 2.0 * math.pi
            inner_ring.append(bm_oak.verts.new((math.cos(a) * 0.255, math.sin(a) * 0.255, z_lid)))
        for s in range(segs):
            sn = (s + 1) % segs
            verts_q = (edge_ring[s], edge_ring[sn], inner_ring[sn], inner_ring[s]) if is_top else (edge_ring[sn], edge_ring[s], inner_ring[s], inner_ring[sn])
            f = bm_oak.faces.new(verts_q)
            for lp in f.loops:
                lp[uv_o].uv = (0.5, 0.5)
        f_lid = bm_oak.faces.new(inner_ring if is_top else list(reversed(inner_ring)))
        for lp in f_lid.loops:
            v = lp.vert.co
            lp[uv_o].uv = (0.5 + v.x / 0.6, 0.5 + v.y / 0.6)

    bmesh.ops.recalc_face_normals(bm_oak, faces=bm_oak.faces)
    obj_oak = create_mesh_object("WineBarrel_Oak", bm_oak, mat_oak, smooth=True, collection=col)

    # 6 distinct iron hoops hugging the barrel curve
    bm_ir = bmesh.new()
    uv_ir = bm_ir.loops.layers.uv.new("UVMap")
    hoop_specs = [(0.055, 0.292, 0.034), (0.21, 0.328, 0.032), (0.37, 0.354, 0.030),
                  (0.57, 0.354, 0.030), (0.73, 0.328, 0.032), (0.885, 0.292, 0.034)]
    for hz, hr, hh in hoop_specs:
        r_bot = []
        r_top = []
        for s in range(segs):
            a = (s / segs) * 2.0 * math.pi
            r_bot.append(bm_ir.verts.new((math.cos(a) * (hr + 0.004), math.sin(a) * (hr + 0.004), hz - hh * 0.5)))
            r_top.append(bm_ir.verts.new((math.cos(a) * (hr + 0.004), math.sin(a) * (hr + 0.004), hz + hh * 0.5)))
        for s in range(segs):
            sn = (s + 1) % segs
            f = bm_ir.faces.new((r_bot[s], r_bot[sn], r_top[sn], r_top[s]))
            for lp in f.loops:
                lp[uv_ir].uv = (0.5, 0.5)
    bmesh.ops.recalc_face_normals(bm_ir, faces=bm_ir.faces)
    obj_iron = create_mesh_object("WineBarrel_Hoops", bm_ir, mat_iron, smooth=True, collection=col)
    return [obj_oak, obj_iron]


# ---------------------------------------------------------------------------
# Sunlit Outdoor Showcase Renderer for Visual Self-Inspection
# ---------------------------------------------------------------------------

def render_props_showcase(render_path: str, prop_groups: dict):
    """Arrange all 7 props cleanly on a sunlit Pfalz courtyard/vineyard showcase stage and render 1280x720."""
    # Offset each prop cleanly for the showcase shot (after GLB export at origin!)
    placements = {
        "vine_row": (0.0, 2.2, 0.0),
        "tree_deciduous": (-5.8, 3.6, 0.0),
        "tree_orchard": (5.2, 2.8, 0.0),
        "ortsschild": (-2.4, -1.8, 0.0),
        "streetlamp": (2.8, -0.6, 0.0),
        "hay_bale": (0.2, -1.6, 0.0),
        "wine_barrel": (-0.95, -2.1, 0.0),
    }
    for key, objs in prop_groups.items():
        dx, dy, dz = placements[key]
        for o in objs:
            o.location = (dx, dy, dz)

    # Sunlit ground pad
    mat_ground = make_pbr_material("Showcase_Ground", base_color=(0.34, 0.38, 0.24, 1.0), roughness=0.92)
    bpy.ops.mesh.primitive_plane_add(size=45.0, location=(0.0, 1.0, 0.0))
    ground = bpy.context.active_object
    ground.data.materials.append(mat_ground)

    # Sky + Sun
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -1.1

    world = bpy.data.worlds.new("SkyWorld")
    scene.world = world
    wnt = world.node_tree
    bg = wnt.nodes.get("Background")
    sky = wnt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(34.0)
    sky.sun_rotation = math.radians(215.0)
    wnt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.28

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(1.5)
    sun_obj = bpy.data.objects.new("Sun", sun_data)
    sun_obj.rotation_euler = Euler((math.radians(52.0), math.radians(12.0), math.radians(-32.0)), "XYZ")
    scene.collection.objects.link(sun_obj)

    cam_data = bpy.data.cameras.new("ShowcaseCam")
    cam_data.lens = 30.0
    cam_obj = bpy.data.objects.new("ShowcaseCam", cam_data)
    cam_obj.location = Vector((-0.8, -12.8, 3.8))
    target = Vector((-0.2, 1.4, 2.8))
    cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    os.makedirs(os.path.dirname(render_path), exist_ok=True)
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered props showcase -> {render_path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", type=str, default="", help="Optional 1280x720 showcase render output PNG")
    args = parser.parse_args(argv)

    clear_scene()
    builders = {
        "vine_row": lambda col: build_vine_row(col),
        "tree_deciduous": lambda col: build_tree(col, "TreeDeciduous", orchard=False),
        "tree_orchard": lambda col: build_tree(col, "TreeOrchard", orchard=True),
        "ortsschild": lambda col: build_ortsschild(col),
        "streetlamp": lambda col: build_streetlamp(col),
        "hay_bale": lambda col: build_hay_bale(col),
        "wine_barrel": lambda col: build_wine_barrel(col),
    }

    prop_groups = {}
    props_meta = {}

    for key, fn in builders.items():
        col = bpy.data.collections.new(f"Prop_{key}")
        bpy.context.scene.collection.children.link(col)
        objs = fn(col)
        prop_groups[key] = objs

        glb_path = os.path.join(GLB_DIR, f"{key}.glb")
        export_prop_glb(objs, glb_path)
        bbox = compute_gltf_bbox(objs)
        tris = sum(len(o.data.polygons) * 2 for o in objs if o.type == "MESH")
        fsize = os.path.getsize(glb_path)
        props_meta[key] = {
            "glbPath": f"/assets/models/village/props/{key}.glb",
            "bounds": bbox,
            "meshCount": len(objs),
            "approxTriangles": tris,
            "fileSizeBytes": fsize,
        }
        print(f"Exported {key}.glb ({fsize/1024:.1f} KB, ~{tris} tris, size={bbox['size']})")

    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(props_meta, f, indent=2)

    if args.render:
        render_props_showcase(args.render, prop_groups)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"Saved master props .blend -> {BLEND_OUT}")


if __name__ == "__main__":
    main()
