"""
Procedural Blender 5.2 LTS builder for VW Golf 7 EA288 Workshop & Tools assets.

Exports two glTF 2.0 binary (.glb) files with exact Three.js -> Blender
coordinate conversion t2b(x, y, z) = (x, -z, y) and export_yup=True:
  1. public/models/workshop_props.glb
  2. public/models/tools.glb

Run headless:
  blender --background --python blender/build_workshop_and_tools.py
"""

from __future__ import annotations

import math
import os
import struct
import json
from pathlib import Path
from typing import Iterable, Sequence

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector


# ---------------------------------------------------------------------------
# Paths & Coordinate Contract
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUT_DIR = PROJECT_ROOT / "public" / "models"
WORKSHOP_GLB_PATH = OUT_DIR / "workshop_props.glb"
TOOLS_GLB_PATH = OUT_DIR / "tools.glb"


def t2b(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Convert Three.js Y-up coordinates (x, y, z) to Blender Z-up (x, -z, y)."""
    return (x, -z, y)


def vec_t2b(v: Sequence[float]) -> Vector:
    return Vector(t2b(v[0], v[1], v[2]))


# ---------------------------------------------------------------------------
# Color & Material Helpers (Blender 5.2 Principled BSDF)
# ---------------------------------------------------------------------------

def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_val: int, alpha: float = 1.0) -> tuple[float, float, float, float]:
    r = ((hex_val >> 16) & 0xFF) / 255.0
    g = ((hex_val >> 8) & 0xFF) / 255.0
    b = (hex_val & 0xFF) / 255.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


def make_pbr_mat(
    name: str,
    base_hex: int,
    *,
    metallic: float = 0.0,
    roughness: float = 0.5,
    coat_weight: float = 0.0,
    coat_roughness: float = 0.12,
    emissive_hex: int | None = None,
    emissive_strength: float = 0.0,
    image: bpy.types.Image | None = None,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    assert bsdf is not None

    bsdf.inputs["Base Color"].default_value = hex_to_linear(base_hex)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat_weight
    bsdf.inputs["Coat Roughness"].default_value = coat_roughness

    if emissive_hex is not None and emissive_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = hex_to_linear(emissive_hex)
        bsdf.inputs["Emission Strength"].default_value = emissive_strength

    if image is not None:
        tex_node = nt.nodes.new("ShaderNodeTexImage")
        tex_node.image = image
        tex_node.location = (-320, 260)
        nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])

    return mat


def create_torque_scale_image() -> bpy.types.Image:
    """Create a crisp 512x256 micrometer Nm scale texture packed into memory."""
    w, h = 512, 256
    img = bpy.data.images.new("TorqueScaleNm", width=w, height=h, alpha=False)

    # Pixel buffer RGBA float [0..1]
    buf = [0.0] * (w * h * 4)

    def fill_rect(x0: int, y0: int, x1: int, y1: int, rgba: tuple[float, float, float, float]) -> None:
        x0c, x1c = max(0, x0), min(w, x1)
        y0c, y1c = max(0, y0), min(h, y1)
        r, g, b, a = rgba
        for py in range(y0c, y1c):
            row_off = py * w * 4
            for px in range(x0c, x1c):
                idx = row_off + px * 4
                buf[idx] = r
                buf[idx + 1] = g
                buf[idx + 2] = b
                buf[idx + 3] = a

    # Brushed satin sleeve background
    fill_rect(0, 0, w, h, (0.68, 0.73, 0.79, 1.0))

    # Draw two identical sight-glass windows centered at u=0.25 (x=128) and u=0.75 (x=384)
    # so both +Z and -Z viewing sides read cleanly without crossing the u=0/1 seam
    glyphs = {
        "N": ["10001", "11001", "10101", "10011", "10001"],
        "m": ["00000", "11010", "10101", "10101", "10001"],
        "4": ["10010", "10010", "11111", "00010", "00010"],
        "0": ["01110", "10011", "10101", "11001", "01110"],
        "2": ["01110", "10001", "00110", "01000", "11111"],
        "-": ["00000", "00000", "11111", "00000", "00000"],
        " ": ["00000", "00000", "00000", "00000", "00000"],
    }
    text = "40-200 Nm"
    scale_px = 3
    text_w = len(text) * (6 * scale_px) - scale_px

    for win_cx in (128, 384):
        wx0, wx1 = win_cx - 96, win_cx + 96
        fill_rect(wx0, 28, wx1, h - 28, (0.04, 0.06, 0.09, 1.0))
        fill_rect(wx0 - 2, 26, wx1 + 2, 30, (0.42, 0.48, 0.56, 1.0))
        fill_rect(wx0 - 2, h - 30, wx1 + 2, h - 26, (0.42, 0.48, 0.56, 1.0))
        fill_rect(win_cx - 2, 28, win_cx + 2, h - 28, (0.85, 0.12, 0.12, 1.0))

        for i, ty in enumerate(range(42, h - 66, 15)):
            major = i % 2 == 0
            tick_w = 34 if major else 20
            col = (0.94, 0.96, 0.99, 1.0) if major else (0.58, 0.65, 0.74, 1.0)
            fill_rect(wx0 + 18, ty, wx0 + 18 + tick_w, ty + 3, col)
            fill_rect(wx1 - 18 - tick_w, ty, wx1 - 18, ty + 3, col)

        start_x = win_cx - text_w // 2
        base_y = h - 56
        for ci, ch in enumerate(text):
            pattern = glyphs.get(ch, glyphs[" "])
            gx = start_x + ci * (6 * scale_px)
            for ry, row in enumerate(pattern):
                for rx, bit in enumerate(row):
                    if bit == "1":
                        px = gx + rx * scale_px
                        py = base_y + (4 - ry) * scale_px
                        fill_rect(px, py, px + scale_px, py + scale_px, (0.95, 0.97, 1.0, 1.0))

    img.pixels.foreach_set(buf)
    img.pack()
    return img


# ---------------------------------------------------------------------------
# Scene & Mesh Lifecycle Helpers
# ---------------------------------------------------------------------------

def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("World")


def create_empty(
    name: str,
    loc_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.1
    obj.location = t2b(*loc_t)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)
    if parent is not None:
        obj.parent = parent
    bpy.context.scene.collection.objects.link(obj)
    return obj


def assign_box_uvs(bm: bmesh.types.BMesh, uv_scale: float = 2.0) -> None:
    uv_layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        # Skip faces that already carry custom UV coordinates (e.g., cylindrical scale sleeve)
        if any(loop[uv_layer].uv.length_squared > 1e-9 for loop in face.loops):
            continue
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            co = loop.vert.co
            if az >= ax and az >= ay:
                u, v = co.x, co.y
            elif ax >= ay and ax >= az:
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            loop[uv_layer].uv = (u * uv_scale, v * uv_scale)


def finalize_mesh_object(
    name: str,
    bm: bmesh.types.BMesh,
    materials: Sequence[bpy.types.Material],
    *,
    loc_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
    smooth_angle_deg: float = 38.0,
    uv_scale: float = 2.0,
) -> bpy.types.Object:
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    assign_box_uvs(bm, uv_scale=uv_scale)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    for mat in materials:
        mesh.materials.append(mat)

    obj = bpy.data.objects.new(name, mesh)
    obj.location = t2b(*loc_t)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)
    if parent is not None:
        obj.parent = parent

    bpy.context.scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle_deg))
    obj.select_set(False)
    return obj


# ---------------------------------------------------------------------------
# BMesh Geometry Primitives (All authored in Three.js space -> converted via t2b)
# ---------------------------------------------------------------------------

def _rot_matrix_three(rot_t: tuple[float, float, float]) -> Matrix:
    """Euler XYZ rotation in Three.js coordinates."""
    rx, ry, rz = rot_t
    return Euler((rx, ry, rz), "XYZ").to_matrix().to_4x4()


def _transform_verts_t2b(
    verts: Iterable[bmesh.types.BMVert],
    mat_t: Matrix | None = None,
) -> None:
    for v in verts:
        if not v.is_valid:
            continue
        p = mat_t @ v.co if mat_t is not None else v.co
        v.co = Vector(t2b(p.x, p.y, p.z))


def _tag_faces_mat(faces: Iterable[bmesh.types.BMFace], mat_idx: int) -> None:
    for f in faces:
        if f.is_valid:
            f.material_index = mat_idx


def _merge_sub_bmesh(
    target_bm: bmesh.types.BMesh,
    sub: bmesh.types.BMesh,
    mat_idx: int,
    xform_t: Matrix | None = None,
) -> None:
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    vmap: dict[bmesh.types.BMVert, bmesh.types.BMVert] = {}
    for v in sub.verts:
        p = xform_t @ v.co if xform_t is not None else v.co
        vmap[v] = target_bm.verts.new(t2b(p.x, p.y, p.z))
    for f in sub.faces:
        nf = target_bm.faces.new([vmap[v] for v in f.verts])
        nf.material_index = mat_idx
    sub.free()


def add_box(
    bm: bmesh.types.BMesh,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    *,
    rot_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
    mat_idx: int = 0,
    bevel: float = 0.0,
    bevel_segs: int = 2,
) -> None:
    sx, sy, sz = size
    sub = bmesh.new()
    bmesh.ops.create_cube(sub, size=1.0)
    for v in sub.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz

    if bevel > 1e-5:
        bmesh.ops.bevel(
            sub,
            geom=list(sub.edges),
            offset=bevel,
            offset_type="OFFSET",
            segments=bevel_segs,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )

    xform = Matrix.Translation(Vector(center)) @ _rot_matrix_three(rot_t)
    _merge_sub_bmesh(bm, sub, mat_idx, xform)


def add_cylinder(
    bm: bmesh.types.BMesh,
    p0: tuple[float, float, float],
    p1: tuple[float, float, float],
    r0: float,
    r1: float | None = None,
    *,
    segs: int = 24,
    cap_ends: bool = True,
    mat_idx: int = 0,
    bevel_caps: float = 0.0,
    bevel_segs: int = 1,
) -> None:
    if r1 is None:
        r1 = r0
    v0 = Vector(p0)
    v1 = Vector(p1)
    axis = v1 - v0
    length = axis.length
    if length < 1e-6:
        return

    sub = bmesh.new()
    bmesh.ops.create_cone(
        sub,
        cap_ends=cap_ends,
        cap_tris=False,
        segments=segs,
        radius1=r0,
        radius2=r1,
        depth=length,
    )
    sub.normal_update()

    if bevel_caps > 1e-5 and cap_ends:
        cap_edges = [
            e
            for e in sub.edges
            if len(e.link_faces) == 2 and any(abs(f.normal.z) > 0.9 for f in e.link_faces)
        ]
        if cap_edges:
            bmesh.ops.bevel(
                sub,
                geom=cap_edges,
                offset=bevel_caps,
                segments=bevel_segs,
                profile=0.5,
                affect="EDGES",
                clamp_overlap=True,
            )

    mid = (v0 + v1) * 0.5
    dir_n = axis.normalized()
    quat = Vector((0.0, 0.0, 1.0)).rotation_difference(dir_n)
    xform = Matrix.Translation(mid) @ quat.to_matrix().to_4x4()
    _merge_sub_bmesh(bm, sub, mat_idx, xform)


def add_extruded_polygon(
    bm: bmesh.types.BMesh,
    pts_2d: Sequence[tuple[float, float]],
    depth: float,
    *,
    axis: str = "y",
    center: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rot_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
    mat_idx: int = 0,
    bevel: float = 0.0,
    bevel_segs: int = 1,
    holes_2d: Sequence[Sequence[tuple[float, float]]] | None = None,
) -> None:
    """
    Create a closed extruded 2D shape (with optional inner cutouts via annular bridging)
    in Three.js local coordinates, then transform to Blender via t2b.
    axis='y': pts_2d are (x, z), extruded along Y in [-depth/2, +depth/2].
    axis='x': pts_2d are (z, y), extruded along X in [-depth/2, +depth/2].
    axis='z': pts_2d are (x, y), extruded along Z in [-depth/2, +depth/2].
    """
    half = depth * 0.5

    def to_3d(u: float, v: float, d: float) -> Vector:
        if axis == "y":
            return Vector((u, d, v))
        if axis == "x":
            return Vector((d, v, u))
        return Vector((u, v, d))

    sub = bmesh.new()
    if not holes_2d:
        bot_v = [sub.verts.new(to_3d(u, v, -half)) for u, v in pts_2d]
        top_v = [sub.verts.new(to_3d(u, v, +half)) for u, v in pts_2d]
        sub.faces.new(list(reversed(bot_v)))
        sub.faces.new(top_v)
        n = len(pts_2d)
        for i in range(n):
            j = (i + 1) % n
            sub.faces.new([bot_v[i], bot_v[j], top_v[j], top_v[i]])
    else:
        inner = holes_2d[0]
        n_out = len(pts_2d)
        if n_out != len(inner):
            sub.free()
            raise ValueError("Holed extrusion requires matching outer/inner loop vertex count")
        ob = [sub.verts.new(to_3d(u, v, -half)) for u, v in pts_2d]
        ot = [sub.verts.new(to_3d(u, v, +half)) for u, v in pts_2d]
        ib = [sub.verts.new(to_3d(u, v, -half)) for u, v in inner]
        it = [sub.verts.new(to_3d(u, v, +half)) for u, v in inner]
        for i in range(n_out):
            j = (i + 1) % n_out
            sub.faces.new([ob[i], ob[j], ot[j], ot[i]])
            sub.faces.new([ib[j], ib[i], it[i], it[j]])
            sub.faces.new([ot[i], ot[j], it[j], it[i]])
            sub.faces.new([ib[i], ib[j], ob[j], ob[i]])

    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    if bevel > 1e-5:
        bmesh.ops.bevel(
            sub,
            geom=list(sub.edges),
            offset=bevel,
            segments=bevel_segs,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )

    xform = Matrix.Translation(Vector(center)) @ _rot_matrix_three(rot_t)
    _merge_sub_bmesh(bm, sub, mat_idx, xform)


def add_lathe(
    bm: bmesh.types.BMesh,
    profile_rz: Sequence[tuple[float, float]],
    *,
    axis: str = "x",
    center: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rot_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segs: int = 24,
    mat_idx: int = 0,
    cyl_uv: bool = False,
) -> None:
    """
    Revolve a (radius, axial_coord) profile around local X or Y axis in Three.js space.
    Endpoints with radius <= 1e-5 automatically cap into a single apex vertex.
    """
    rings: list[list[bmesh.types.BMVert]] = []
    uv_layer = bm.loops.layers.uv.verify() if cyl_uv else None
    created_verts: list[bmesh.types.BMVert] = []
    created_faces: list[bmesh.types.BMFace] = []

    z_vals = [p[1] for p in profile_rz]
    z_min, z_max = min(z_vals), max(z_vals)
    z_span = max(1e-6, z_max - z_min)

    def pt_at(r: float, axial: float, theta: float) -> Vector:
        c, s = math.cos(theta), math.sin(theta)
        if axis == "x":
            return Vector((axial, r * c, r * s))
        if axis == "y":
            return Vector((r * c, axial, r * s))
        return Vector((r * c, r * s, axial))

    for r, ax in profile_rz:
        if r <= 1e-5:
            v = bm.verts.new(pt_at(0.0, ax, 0.0))
            created_verts.append(v)
            rings.append([v])
        else:
            ring = []
            for i in range(segs):
                th = (2.0 * math.pi * i) / segs
                v = bm.verts.new(pt_at(r, ax, th))
                created_verts.append(v)
                ring.append(v)
            rings.append(ring)

    for ri in range(len(rings) - 1):
        r0 = rings[ri]
        r1 = rings[ri + 1]
        v_coord0 = (profile_rz[ri][1] - z_min) / z_span
        v_coord1 = (profile_rz[ri + 1][1] - z_min) / z_span

        if len(r0) == 1 and len(r1) == 1:
            continue
        if len(r0) == 1:
            apex = r0[0]
            for i in range(segs):
                j = (i + 1) % segs
                f = bm.faces.new([apex, r1[i], r1[j]])
                created_faces.append(f)
        elif len(r1) == 1:
            apex = r1[0]
            for i in range(segs):
                j = (i + 1) % segs
                f = bm.faces.new([r0[i], apex, r0[j]])
                created_faces.append(f)
        else:
            for i in range(segs):
                j = (i + 1) % segs
                f = bm.faces.new([r0[i], r1[i], r1[j], r0[j]])
                created_faces.append(f)
                if uv_layer is not None:
                    u0 = 1.0 - i / segs
                    u1 = 1.0 - (i + 1) / segs
                    f.loops[0][uv_layer].uv = (u0, v_coord0)
                    f.loops[1][uv_layer].uv = (u0, v_coord1)
                    f.loops[2][uv_layer].uv = (u1, v_coord1)
                    f.loops[3][uv_layer].uv = (u1, v_coord0)

    bmesh.ops.recalc_face_normals(bm, faces=created_faces)
    _tag_faces_mat(created_faces, mat_idx)
    xform = Matrix.Translation(Vector(center)) @ _rot_matrix_three(rot_t)
    _transform_verts_t2b(created_verts, xform)


def add_torus(
    bm: bmesh.types.BMesh,
    center: tuple[float, float, float],
    major_r: float,
    minor_r: float,
    *,
    axis: str = "x",
    major_segs: int = 24,
    minor_segs: int = 12,
    mat_idx: int = 0,
    rot_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> None:
    rings: list[list[bmesh.types.BMVert]] = []
    created_verts: list[bmesh.types.BMVert] = []
    created_faces: list[bmesh.types.BMFace] = []

    for i in range(major_segs):
        phi = (2.0 * math.pi * i) / major_segs
        cp, sp = math.cos(phi), math.sin(phi)
        ring = []
        for j in range(minor_segs):
            th = (2.0 * math.pi * j) / minor_segs
            rad = major_r + minor_r * math.cos(th)
            axial = minor_r * math.sin(th)
            if axis == "x":
                pt = Vector((axial, rad * cp, rad * sp))
            elif axis == "y":
                pt = Vector((rad * cp, axial, rad * sp))
            else:
                pt = Vector((rad * cp, rad * sp, axial))
            v = bm.verts.new(pt)
            created_verts.append(v)
            ring.append(v)
        rings.append(ring)

    for i in range(major_segs):
        ni = (i + 1) % major_segs
        for j in range(minor_segs):
            nj = (j + 1) % minor_segs
            f = bm.faces.new([rings[i][j], rings[ni][j], rings[ni][nj], rings[i][nj]])
            created_faces.append(f)

    bmesh.ops.recalc_face_normals(bm, faces=created_faces)
    _tag_faces_mat(created_faces, mat_idx)
    xform = Matrix.Translation(Vector(center)) @ _rot_matrix_three(rot_t)
    _transform_verts_t2b(created_verts, xform)


def add_tube_sweep(
    bm: bmesh.types.BMesh,
    points_t: Sequence[tuple[float, float, float]],
    radius: float,
    *,
    ring_segs: int = 12,
    cap_ends: bool = True,
    mat_idx: int = 0,
    rot_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
    center: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> None:
    """Sweep a circular cross-section along a polyline in Three.js coordinates using parallel transport."""
    pts = [Vector(p) for p in points_t]
    if len(pts) < 2:
        return

    tangents: list[Vector] = []
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - p).normalized()
        elif i == len(pts) - 1:
            t = (p - pts[-2]).normalized()
        else:
            t1 = (p - pts[i - 1]).normalized()
            t2 = (pts[i + 1] - p).normalized()
            t = (t1 + t2)
            t = t.normalized() if t.length > 1e-6 else t2
        tangents.append(t)

    up_hint = Vector((0.0, 1.0, 0.0)) if abs(tangents[0].y) < 0.9 else Vector((1.0, 0.0, 0.0))
    normal = tangents[0].cross(up_hint).normalized()
    binormal = tangents[0].cross(normal).normalized()

    rings: list[list[bmesh.types.BMVert]] = []
    created_verts: list[bmesh.types.BMVert] = []
    created_faces: list[bmesh.types.BMFace] = []

    for i, p in enumerate(pts):
        if i > 0:
            q = tangents[i - 1].rotation_difference(tangents[i])
            normal = (q @ normal).normalized()
            binormal = tangents[i].cross(normal).normalized()

        ring = []
        for s in range(ring_segs):
            a = (2.0 * math.pi * s) / ring_segs
            offset = (normal * math.cos(a) + binormal * math.sin(a)) * radius
            v = bm.verts.new(p + offset)
            created_verts.append(v)
            ring.append(v)
        rings.append(ring)

    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for s in range(ring_segs):
            ns = (s + 1) % ring_segs
            created_faces.append(bm.faces.new([r0[s], r0[ns], r1[ns], r1[s]]))

    if cap_ends:
        created_faces.append(bm.faces.new(list(reversed(rings[0]))))
        created_faces.append(bm.faces.new(rings[-1]))

    bmesh.ops.recalc_face_normals(bm, faces=created_faces)
    _tag_faces_mat(created_faces, mat_idx)
    xform = Matrix.Translation(Vector(center)) @ _rot_matrix_three(rot_t)
    _transform_verts_t2b(created_verts, xform)


def sample_catmull_rom(
    ctrl: Sequence[tuple[float, float, float]],
    subdivs_per_seg: int = 6,
) -> list[tuple[float, float, float]]:
    if len(ctrl) < 2:
        return list(ctrl)
    pts = [Vector(ctrl[0])] + [Vector(p) for p in ctrl] + [Vector(ctrl[-1])]
    out: list[tuple[float, float, float]] = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        steps = subdivs_per_seg
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            p = 0.5 * (
                (2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
            out.append((p.x, p.y, p.z))
    out.append(ctrl[-1])
    return out


# ---------------------------------------------------------------------------
# ASSET 1: workshop_props.glb
# ---------------------------------------------------------------------------

def build_workshop_props() -> None:
    reset_scene()

    # Materials Palette
    mat_lift_blue = make_pbr_mat("Lift_BlueCoat", 0x1E4B85, metallic=0.45, roughness=0.38, coat_weight=0.25)
    mat_anthracite = make_pbr_mat("Steel_Anthracite", 0x1E2530, metallic=0.72, roughness=0.44)
    mat_yellow = make_pbr_mat("Safety_Yellow", 0xEAB308, metallic=0.22, roughness=0.36, coat_weight=0.20)
    mat_rubber = make_pbr_mat("Rubber_Matte", 0x14171C, metallic=0.05, roughness=0.86)
    mat_chrome = make_pbr_mat("Chrome_Polished", 0xE2E8F0, metallic=0.95, roughness=0.14)
    mat_alu = make_pbr_mat("Aluminum_Brushed", 0xBCC6D4, metallic=0.88, roughness=0.26)
    mat_brass = make_pbr_mat("Brass_Fitting", 0xC99E38, metallic=0.90, roughness=0.28)
    mat_red_estop = make_pbr_mat("EStop_Red", 0xDC2626, metallic=0.15, roughness=0.35)
    mat_btn_up = make_pbr_mat(
        "Lift_BtnUp_Green", 0x22C55E, metallic=0.10, roughness=0.25, emissive_hex=0x22C55E, emissive_strength=1.45
    )
    mat_btn_down = make_pbr_mat(
        "Lift_BtnDown_Amber", 0xF59E0B, metallic=0.10, roughness=0.25, emissive_hex=0xF59E0B, emissive_strength=1.35
    )

    mat_cart_red = make_pbr_mat("Cart_RedCoat", 0xC41E22, metallic=0.22, roughness=0.30, coat_weight=0.35)
    mat_wood_beech = make_pbr_mat("Wood_OiledBeech", 0xA67746, metallic=0.02, roughness=0.52, coat_weight=0.15)
    mat_wood_beech_alt = make_pbr_mat("Wood_OiledBeech_Plank", 0x946639, metallic=0.02, roughness=0.56, coat_weight=0.12)
    mat_vise_blue = make_pbr_mat("Vise_CastBlue", 0x1D4ED8, metallic=0.62, roughness=0.44)
    mat_rack_amber = make_pbr_mat("Rack_AmberCoat", 0xD97706, metallic=0.30, roughness=0.42)
    mat_rack_steel = make_pbr_mat("Rack_DarkSteel", 0x2B3441, metallic=0.70, roughness=0.45)
    mat_led_strip = make_pbr_mat(
        "Bench_LED", 0xF8FAFC, metallic=0.0, roughness=0.2, emissive_hex=0xE0F2FE, emissive_strength=1.5
    )

    workshop_mats = [
        mat_lift_blue,      # 0
        mat_anthracite,     # 1
        mat_yellow,         # 2
        mat_rubber,         # 3
        mat_chrome,         # 4
        mat_alu,            # 5
        mat_brass,          # 6
        mat_red_estop,      # 7
        mat_cart_red,       # 8
        mat_wood_beech,     # 9
        mat_wood_beech_alt, # 10
        mat_vise_blue,      # 11
        mat_rack_amber,     # 12
        mat_rack_steel,     # 13
        mat_led_strip,      # 14
    ]

    # -----------------------------------------------------------------------
    # 1. Lift_Columns + Lift_BtnUp + Lift_BtnDown
    # -----------------------------------------------------------------------
    lift_columns_root = create_empty("Lift_Columns", (0.0, 0.0, 0.0))
    bm_cols = bmesh.new()

    col_h = 3.65
    col_z = -0.35

    for side_x in (-1.48, 1.48):
        in_sign = 1.0 if side_x < 0 else -1.0
        out_sign = -in_sign

        # Thick bolted steel base plate with bevel + 6 hex anchor bolts + 4 corner gussets
        add_box(bm_cols, (side_x, 0.013, col_z), (0.44, 0.026, 0.48), mat_idx=1, bevel=0.004, bevel_segs=1)
        for ax in (-0.16, 0.16):
            for az in (-0.18, 0.0, 0.18):
                # Washer + hex bolt head
                add_cylinder(
                    bm_cols,
                    (side_x + ax, 0.026, col_z + az),
                    (side_x + ax, 0.032, col_z + az),
                    0.020,
                    segs=12,
                    mat_idx=4,
                )
                add_cylinder(
                    bm_cols,
                    (side_x + ax, 0.032, col_z + az),
                    (side_x + ax, 0.050, col_z + az),
                    0.014,
                    segs=6,
                    mat_idx=1,
                )

        # Welded triangular base gusset plates (front/back & outer)
        gusset_pts = [(0.0, 0.0), (0.09, 0.0), (0.0, 0.14)]
        for gz in (-0.155, 0.155):
            add_extruded_polygon(
                bm_cols,
                gusset_pts,
                0.014,
                axis="z",
                center=(side_x + out_sign * 0.12, 0.026, col_z + gz),
                rot_t=(0.0, math.pi if out_sign < 0 else 0.0, 0.0),
                mat_idx=0,
                bevel=0.002,
            )

        # Chamfered H/C-profile upright column (open track facing inward toward car)
        # Outer spine flange
        add_box(
            bm_cols,
            (side_x + out_sign * 0.11, col_h * 0.5 + 0.013, col_z),
            (0.032, col_h - 0.026, 0.28),
            mat_idx=0,
            bevel=0.005,
        )
        # Front & rear deep web plates forming H/C profile
        for wz in (-0.122, 0.122):
            add_box(
                bm_cols,
                (side_x, col_h * 0.5 + 0.013, col_z + wz),
                (0.22, col_h - 0.026, 0.032),
                mat_idx=0,
                bevel=0.004,
            )
        # Inner channel lips leaving clean central carriage slot
        for wz in (-0.105, 0.105):
            add_box(
                bm_cols,
                (side_x + in_sign * 0.11, col_h * 0.5 + 0.013, col_z + wz),
                (0.030, col_h - 0.026, 0.068),
                mat_idx=0,
                bevel=0.004,
            )

        # Internal hydraulic cylinder + chrome piston rod + top cable pulley sheave
        add_cylinder(
            bm_cols,
            (side_x + out_sign * 0.02, 0.04, col_z),
            (side_x + out_sign * 0.02, 1.95, col_z),
            0.038,
            segs=16,
            mat_idx=1,
        )
        add_cylinder(
            bm_cols,
            (side_x + out_sign * 0.02, 1.95, col_z),
            (side_x + out_sign * 0.02, 3.58, col_z),
            0.022,
            segs=14,
            mat_idx=4,
        )
        add_cylinder(
            bm_cols,
            (side_x - 0.03, 3.60, col_z),
            (side_x + 0.03, 3.60, col_z),
            0.065,
            segs=18,
            mat_idx=1,
            bevel_caps=0.004,
        )

        # Stepped safety lock rack inside column + yellow safety lock latch housing
        for ry in [0.55 + i * 0.18 for i in range(15)]:
            add_box(
                bm_cols,
                (side_x + out_sign * 0.075, ry, col_z + 0.06),
                (0.025, 0.035, 0.028),
                mat_idx=1,
            )

        # Yellow safety lock latch mechanism at Y = 1.56
        add_box(
            bm_cols,
            (side_x + out_sign * 0.145, 1.56, col_z),
            (0.048, 0.34, 0.14),
            mat_idx=2,
            bevel=0.005,
        )
        add_cylinder(
            bm_cols,
            (side_x + out_sign * 0.165, 1.48, col_z - 0.04),
            (side_x + out_sign * 0.215, 1.48, col_z - 0.04),
            0.014,
            segs=12,
            mat_idx=1,
        )
        # Top column cap flange
        add_box(
            bm_cols,
            (side_x, col_h + 0.015, col_z),
            (0.32, 0.030, 0.34),
            mat_idx=1,
            bevel=0.004,
        )

    # Overhead Crossbeam Gantry (Y = 3.66 .. 3.84)
    add_box(bm_cols, (0.0, 3.74, col_z), (3.24, 0.16, 0.24), mat_idx=0, bevel=0.006)
    add_box(bm_cols, (0.0, 3.825, col_z), (3.28, 0.024, 0.28), mat_idx=1, bevel=0.004)
    add_box(bm_cols, (0.0, 3.655, col_z), (3.28, 0.024, 0.28), mat_idx=1, bevel=0.004)
    # Bolted gantry end plates
    for gx in (-1.48, 1.48):
        for bx in (-0.11, 0.11):
            for bz in (-0.10, 0.10):
                add_cylinder(
                    bm_cols,
                    (gx + bx, 3.835, col_z + bz),
                    (gx + bx, 3.855, col_z + bz),
                    0.012,
                    segs=6,
                    mat_idx=4,
                )

    # Overhead padded safety limit-switch bar
    add_cylinder(
        bm_cols,
        (-1.26, 3.55, col_z),
        (1.26, 3.55, col_z),
        0.028,
        segs=16,
        mat_idx=2,
        bevel_caps=0.006,
    )
    for sx in (-1.24, 1.24):
        add_box(bm_cols, (sx, 3.60, col_z), (0.032, 0.11, 0.04), mat_idx=1, bevel=0.003)

    # Hydraulic Power Unit (HPU) on right column outside (+X = 1.68)
    add_box(bm_cols, (1.60, 1.62, col_z), (0.04, 0.62, 0.24), mat_idx=1, bevel=0.004)
    # Oil reservoir tank
    add_box(bm_cols, (1.70, 1.50, col_z), (0.18, 0.42, 0.21), mat_idx=1, bevel=0.012)
    # Sight glass gauge & breather cap on tank
    add_cylinder(bm_cols, (1.71, 1.38, col_z - 0.108), (1.71, 1.62, col_z - 0.108), 0.006, segs=10, mat_idx=4)
    add_cylinder(bm_cols, (1.74, 1.71, col_z + 0.06), (1.74, 1.74, col_z + 0.06), 0.018, segs=12, mat_idx=3)
    # Aluminum manifold block + pressure gauge + brass fittings
    add_box(bm_cols, (1.70, 1.755, col_z), (0.15, 0.09, 0.15), mat_idx=5, bevel=0.005)
    add_cylinder(bm_cols, (1.70, 1.76, col_z - 0.075), (1.70, 1.76, col_z - 0.102), 0.028, segs=18, mat_idx=1, bevel_caps=0.003)
    add_cylinder(bm_cols, (1.70, 1.76, col_z - 0.102), (1.70, 1.76, col_z - 0.105), 0.022, segs=18, mat_idx=4)
    add_cylinder(bm_cols, (1.64, 1.78, col_z - 0.075), (1.64, 1.78, col_z - 0.105), 0.011, segs=6, mat_idx=6)

    # Finned Electric Motor above manifold (Y = 1.80..2.12)
    add_cylinder(bm_cols, (1.70, 1.80, col_z), (1.70, 2.08, col_z), 0.078, segs=22, mat_idx=0, bevel_caps=0.005)
    for fy in [1.83 + k * 0.020 for k in range(12)]:
        add_cylinder(bm_cols, (1.70, fy, col_z), (1.70, fy + 0.007, col_z), 0.086, segs=22, mat_idx=0)
    add_cylinder(bm_cols, (1.70, 2.08, col_z), (1.70, 2.14, col_z), 0.074, 0.056, segs=22, mat_idx=1)
    add_box(bm_cols, (1.78, 1.94, col_z - 0.04), (0.045, 0.09, 0.08), mat_idx=1, bevel=0.004)

    # Curved hydraulic pressure hose lines from HPU up right column & across gantry to left column
    hose1_pts = sample_catmull_rom(
        [
            (1.64, 1.78, col_z - 0.095),
            (1.63, 2.35, col_z - 0.07),
            (1.62, 3.55, col_z - 0.04),
            (1.52, 3.855, col_z - 0.03),
            (0.0, 3.855, col_z - 0.03),
            (-1.46, 3.855, col_z - 0.03),
            (-1.48, 3.58, col_z - 0.02),
        ],
        subdivs_per_seg=6,
    )
    add_tube_sweep(bm_cols, hose1_pts, 0.011, ring_segs=10, mat_idx=3)

    hose2_pts = sample_catmull_rom(
        [
            (1.64, 1.80, col_z + 0.05),
            (1.63, 2.40, col_z + 0.05),
            (1.62, 3.56, col_z + 0.04),
            (1.50, 3.855, col_z + 0.03),
            (0.0, 3.855, col_z + 0.03),
            (-1.44, 3.855, col_z + 0.03),
            (-1.46, 3.58, col_z + 0.02),
        ],
        subdivs_per_seg=6,
    )
    add_tube_sweep(bm_cols, hose2_pts, 0.009, ring_segs=10, mat_idx=3)

    # Control Box at t2b(1.32, 1.25, -0.58) with cantilever bracket & flex conduit
    add_box(bm_cols, (1.41, 1.25, -0.45), (0.055, 0.065, 0.26), mat_idx=1, bevel=0.004)
    add_box(bm_cols, (1.32, 1.25, -0.58), (0.146, 0.320, 0.106), mat_idx=2, bevel=0.008)
    add_box(bm_cols, (1.32, 1.25, -0.634), (0.120, 0.285, 0.012), mat_idx=1, bevel=0.003)

    # Button bezels on faceplate (separate from button meshes so buttons stay 1-material Mesh nodes)
    add_torus(bm_cols, (1.32, 1.306, -0.638), 0.0285, 0.0045, axis="z", major_segs=20, minor_segs=8, mat_idx=1)
    add_torus(bm_cols, (1.32, 1.198, -0.638), 0.0285, 0.0045, axis="z", major_segs=20, minor_segs=8, mat_idx=1)

    # Embossed Emergency Stop (Not-Aus) switch below DOWN button at (1.32, 1.126, -0.64)
    add_cylinder(bm_cols, (1.32, 1.126, -0.638), (1.32, 1.126, -0.644), 0.022, segs=8, mat_idx=2, bevel_caps=0.002)
    add_cylinder(bm_cols, (1.32, 1.126, -0.644), (1.32, 1.126, -0.654), 0.011, segs=14, mat_idx=1)
    add_cylinder(bm_cols, (1.32, 1.126, -0.652), (1.32, 1.126, -0.665), 0.018, 0.016, segs=18, mat_idx=7, bevel_caps=0.003)

    # Key/Power selector switch above UP button at (1.32, 1.370, -0.64)
    add_cylinder(bm_cols, (1.32, 1.370, -0.638), (1.32, 1.370, -0.647), 0.014, segs=14, mat_idx=1, bevel_caps=0.002)
    add_box(bm_cols, (1.32, 1.370, -0.651), (0.007, 0.022, 0.010), mat_idx=4, bevel=0.001)

    # Looped flexible power conduit from bottom gland of control box into right column flange
    add_cylinder(bm_cols, (1.32, 1.072, -0.58), (1.32, 1.092, -0.58), 0.015, segs=12, mat_idx=1)
    add_cylinder(bm_cols, (1.385, 1.045, -0.47), (1.415, 1.045, -0.45), 0.015, segs=12, mat_idx=1)
    conduit_pts = sample_catmull_rom(
        [(1.32, 1.08, -0.58), (1.325, 0.99, -0.56), (1.375, 0.985, -0.49), (1.40, 1.045, -0.46)],
        subdivs_per_seg=6,
    )
    add_tube_sweep(bm_cols, conduit_pts, 0.010, ring_segs=10, mat_idx=3)

    finalize_mesh_object("Lift_Columns_Body", bm_cols, workshop_mats, loc_t=(0.0, 0.0, 0.0), parent=lift_columns_root)

    # Separate clickable UP & DOWN illuminated button meshes at exact target origins
    bm_up = bmesh.new()
    add_lathe(
        bm_up,
        [(0.0, -0.011), (0.025, -0.011), (0.025, 0.005), (0.022, 0.011), (0.0, 0.011)],
        axis="z",
        segs=22,
        mat_idx=0,
    )
    finalize_mesh_object(
        "Lift_BtnUp",
        bm_up,
        [mat_btn_up],
        loc_t=(1.32, 1.306, -0.646),
        parent=lift_columns_root,
    )

    bm_down = bmesh.new()
    add_lathe(
        bm_down,
        [(0.0, -0.011), (0.025, -0.011), (0.025, 0.005), (0.022, 0.011), (0.0, 0.011)],
        axis="z",
        segs=22,
        mat_idx=0,
    )
    finalize_mesh_object(
        "Lift_BtnDown",
        bm_down,
        [mat_btn_down],
        loc_t=(1.32, 1.198, -0.646),
        parent=lift_columns_root,
    )

    # -----------------------------------------------------------------------
    # 2. Lift_Carriages (origin t2b(0,0,0), rubber pad tops at Y_three = 0.080)
    # -----------------------------------------------------------------------
    lift_carriages_root = create_empty("Lift_Carriages", (0.0, 0.0, 0.0))
    bm_car = bmesh.new()

    for side_x in (-1.48, 1.48):
        in_sign = 1.0 if side_x < 0 else -1.0
        # Heavy steel carriage sleeve riding inside column channel
        add_box(bm_car, (side_x + in_sign * 0.095, 0.34, col_z), (0.165, 0.62, 0.245), mat_idx=0, bevel=0.005)
        # Upper & lower wear guide blocks
        for gy in (0.08, 0.60):
            add_box(bm_car, (side_x + in_sign * 0.02, gy, col_z), (0.10, 0.06, 0.18), mat_idx=1, bevel=0.003)
        # Dual clevis arm mounting bracket plates
        for cy in (0.015, 0.082):
            add_box(bm_car, (side_x + in_sign * 0.145, cy, col_z), (0.11, 0.016, 0.28), mat_idx=1, bevel=0.002)

    sill_points = [
        (-1.48, -0.44, -0.72, -0.90),
        (-1.48, -0.26, -0.72, +0.85),
        (+1.48, -0.44, +0.72, -0.90),
        (+1.48, -0.26, +0.72, +0.85),
    ]
    for col_x, pivot_z, target_x, target_z in sill_points:
        in_sign = 1.0 if col_x < 0 else -1.0
        pivot_x = col_x + in_sign * 0.16
        dx = target_x - pivot_x
        dz = target_z - pivot_z
        arm_len = math.hypot(dx, dz)
        yaw = math.atan2(-dz, dx)

        # Articulated pivot knuckle + gear lock pin & knob
        add_cylinder(
            bm_car,
            (pivot_x, 0.012, pivot_z),
            (pivot_x, 0.088, pivot_z),
            0.044,
            segs=18,
            mat_idx=1,
            bevel_caps=0.004,
        )
        add_cylinder(
            bm_car,
            (pivot_x, 0.088, pivot_z),
            (pivot_x, 0.132, pivot_z),
            0.010,
            segs=12,
            mat_idx=4,
        )
        add_cylinder(
            bm_car,
            (pivot_x, 0.128, pivot_z),
            (pivot_x, 0.150, pivot_z),
            0.022,
            segs=14,
            mat_idx=3,
            bevel_caps=0.003,
        )

        # Outer & inner telescoping rectangular swing arm beams rotated by yaw around Y_three
        outer_len = arm_len * 0.56
        inner_len = arm_len * 0.52

        def arm_world(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
            c, s = math.cos(yaw), math.sin(yaw)
            return (pivot_x + lx * c + lz * s, ly, pivot_z - lx * s + lz * c)

        add_box(
            bm_car,
            arm_world(outer_len * 0.5, 0.044, 0.0),
            (outer_len, 0.052, 0.072),
            rot_t=(0.0, yaw, 0.0),
            mat_idx=0,
            bevel=0.004,
        )
        # Welded mouth reinforcement collar on outer beam
        add_box(
            bm_car,
            arm_world(outer_len - 0.018, 0.044, 0.0),
            (0.038, 0.062, 0.082),
            rot_t=(0.0, yaw, 0.0),
            mat_idx=1,
            bevel=0.003,
        )
        # Inner telescoping steel slider stage
        add_box(
            bm_car,
            arm_world(arm_len - inner_len * 0.5, 0.044, 0.0),
            (inner_len, 0.040, 0.054),
            rot_t=(0.0, yaw, 0.0),
            mat_idx=1,
            bevel=0.003,
        )
        # Yellow safety toe-guard tip
        add_box(
            bm_car,
            arm_world(arm_len - 0.032, 0.044, 0.0),
            (0.082, 0.044, 0.060),
            rot_t=(0.0, yaw, 0.0),
            mat_idx=2,
            bevel=0.003,
        )

        # Screw saddle socket, threaded Acme spindle, steel saucer, and knurled rubber puck (TOP EXACTLY AT Y = 0.080)
        add_cylinder(
            bm_car,
            (target_x, 0.022, target_z),
            (target_x, 0.046, target_z),
            0.034,
            segs=16,
            mat_idx=1,
            bevel_caps=0.002,
        )
        add_cylinder(
            bm_car,
            (target_x, 0.046, target_z),
            (target_x, 0.056, target_z),
            0.022,
            segs=16,
            mat_idx=4,
        )
        add_cylinder(
            bm_car,
            (target_x, 0.053, target_z),
            (target_x, 0.059, target_z),
            0.065,
            segs=24,
            mat_idx=1,
            bevel_caps=0.002,
        )
        # Beveled rubber lifting puck with top face at exact Y = 0.080
        add_lathe(
            bm_car,
            [
                (0.0, 0.059),
                (0.064, 0.059),
                (0.064, 0.074),
                (0.058, 0.080),
                (0.0, 0.080),
            ],
            axis="y",
            center=(target_x, 0.0, target_z),
            segs=24,
            mat_idx=3,
        )
        # Raised knurled cross-waffle grip pads flush with Y = 0.080 (recessed groove illusion via 4 crisp quadrant pads)
        for qx in (-0.022, 0.022):
            for qz in (-0.022, 0.022):
                add_box(
                    bm_car,
                    (target_x + qx, 0.079, target_z + qz),
                    (0.032, 0.002, 0.032),
                    mat_idx=3,
                    bevel=0.0008,
                )

    finalize_mesh_object("Lift_Carriages_Body", bm_car, workshop_mats, loc_t=(0.0, 0.0, 0.0), parent=lift_carriages_root)

    # -----------------------------------------------------------------------
    # 3. Workshop_ToolCart (origin t2b(2.35, 0, -2.25), baked -0.24 rad yaw)
    # -----------------------------------------------------------------------
    cart_root = create_empty("Workshop_ToolCart", (2.35, 0.0, -2.25))
    bm_cart = bmesh.new()
    cart_yaw = -0.24

    def cart_pt(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        c, s = math.cos(cart_yaw), math.sin(cart_yaw)
        return (lx * c + lz * s, ly, -lx * s + lz * c)

    # 4 heavy-duty swivel casters (Y = 0..0.12)
    for cx in (-0.30, 0.30):
        for cz in (-0.175, 0.175):
            # Mounting plate
            add_box(bm_cart, cart_pt(cx, 0.116, cz), (0.072, 0.012, 0.072), rot_t=(0.0, cart_yaw, 0.0), mat_idx=4, bevel=0.002)
            # Swivel fork cheeks
            for fx in (-0.020, 0.020):
                add_box(bm_cart, cart_pt(cx + fx, 0.080, cz + 0.008), (0.007, 0.064, 0.048), rot_t=(0.0, cart_yaw, 0.0), mat_idx=4, bevel=0.001)
            # Wheel tread + hub
            add_cylinder(
                bm_cart,
                cart_pt(cx - 0.016, 0.050, cz + 0.014),
                cart_pt(cx + 0.016, 0.050, cz + 0.014),
                0.050,
                segs=20,
                mat_idx=3,
                bevel_caps=0.004,
            )
            add_cylinder(
                bm_cart,
                cart_pt(cx - 0.018, 0.050, cz + 0.014),
                cart_pt(cx + 0.018, 0.050, cz + 0.014),
                0.024,
                segs=14,
                mat_idx=5,
            )
            # Brake lock pedal on front (-Z) casters
            if cz < 0:
                add_box(bm_cart, cart_pt(cx, 0.075, cz - 0.032), (0.028, 0.008, 0.035), rot_t=(0.25, cart_yaw, 0.0), mat_idx=7, bevel=0.002)

    # Main red steel cabinet body (0.74 x 0.725 x 0.46 m, Y = 0.122..0.847)
    add_box(bm_cart, cart_pt(0.0, 0.484, 0.02), (0.74, 0.724, 0.44), rot_t=(0.0, cart_yaw, 0.0), mat_idx=8, bevel=0.006)

    # Protective dark rubber vertical corner bumper guards
    for bx in (-0.372, 0.372):
        for bz in (-0.212, 0.238):
            add_box(bm_cart, cart_pt(bx, 0.484, bz), (0.028, 0.722, 0.028), rot_t=(0.0, cart_yaw, 0.0), mat_idx=3, bevel=0.005)

    # 6 beveled drawers with full-width brushed aluminum grip rails & label strips
    drawer_heights = [0.074, 0.074, 0.084, 0.094, 0.124, 0.144]
    cur_y = 0.785
    for dh in drawer_heights:
        cur_y -= dh * 0.5
        # Drawer front panel
        add_box(bm_cart, cart_pt(0.0, cur_y, -0.205), (0.656, dh - 0.010, 0.022), rot_t=(0.0, cart_yaw, 0.0), mat_idx=8, bevel=0.003)
        # Brushed aluminum full-width grip rail
        add_box(bm_cart, cart_pt(0.0, cur_y + dh * 0.25, -0.220), (0.625, 0.018, 0.018), rot_t=(0.0, cart_yaw, 0.0), mat_idx=5, bevel=0.002)
        # Recessed dark label strip inside rail
        add_box(bm_cart, cart_pt(0.0, cur_y + dh * 0.25, -0.229), (0.560, 0.008, 0.003), rot_t=(0.0, cart_yaw, 0.0), mat_idx=1)
        cur_y -= dh * 0.5 + 0.009

    # Key barrel lock on top right of drawer header
    add_cylinder(bm_cart, cart_pt(0.30, 0.818, -0.195), cart_pt(0.30, 0.818, -0.214), 0.010, segs=14, mat_idx=4, bevel_caps=0.002)

    # Tubular chrome side push handle (-X side)
    add_cylinder(bm_cart, cart_pt(-0.44, 0.82, -0.18), cart_pt(-0.44, 0.82, 0.20), 0.014, segs=14, mat_idx=4, bevel_caps=0.003)
    for bz in (-0.16, 0.18):
        add_box(bm_cart, cart_pt(-0.405, 0.82, bz), (0.075, 0.024, 0.024), rot_t=(0.0, cart_yaw, 0.0), mat_idx=1, bevel=0.003)

    # Side aerosol caddy & two workshop spray cans (+X side)
    add_box(bm_cart, cart_pt(0.41, 0.64, 0.02), (0.085, 0.09, 0.28), rot_t=(0.0, cart_yaw, 0.0), mat_idx=1, bevel=0.003)
    for cz, can_mat in ((-0.05, 8), (0.08, 0)):
        add_cylinder(bm_cart, cart_pt(0.41, 0.65, cz), cart_pt(0.41, 0.83, cz), 0.032, segs=16, mat_idx=can_mat, bevel_caps=0.003)
        add_cylinder(bm_cart, cart_pt(0.41, 0.83, cz), cart_pt(0.41, 0.86, cz), 0.026, segs=14, mat_idx=7)

    # Molded ribbed rubber top work tray (0.78 x 0.50 m, Y = 0.846..0.900)
    add_box(bm_cart, cart_pt(0.0, 0.862, 0.01), (0.78, 0.032, 0.50), rot_t=(0.0, cart_yaw, 0.0), mat_idx=3, bevel=0.005)
    # Raised organizer perimeter lip
    for rz, rlen in ((-0.23, 0.78), (0.25, 0.78)):
        add_box(bm_cart, cart_pt(0.0, 0.888, rz), (rlen, 0.022, 0.024), rot_t=(0.0, cart_yaw, 0.0), mat_idx=3, bevel=0.003)
    for rx in (-0.378, 0.378):
        add_box(bm_cart, cart_pt(rx, 0.888, 0.01), (0.024, 0.022, 0.48), rot_t=(0.0, cart_yaw, 0.0), mat_idx=3, bevel=0.003)
    # Ribbed grooves / raised mat strips
    for mx in (-0.28 + i * 0.055 for i in range(7)):
        add_box(bm_cart, cart_pt(mx, 0.880, 0.02), (0.022, 0.004, 0.34), rot_t=(0.0, cart_yaw, 0.0), mat_idx=3, bevel=0.001)

    # Parts organizer tray & spare chrome wrench prop on top mat
    add_box(bm_cart, cart_pt(0.18, 0.892, 0.04), (0.26, 0.028, 0.22), rot_t=(0.0, cart_yaw + 0.14, 0.0), mat_idx=1, bevel=0.004)
    add_box(bm_cart, cart_pt(0.18, 0.905, 0.04), (0.22, 0.008, 0.18), rot_t=(0.0, cart_yaw + 0.14, 0.0), mat_idx=5)
    # Spare wrench prop lying neatly on the rubber mat
    w_rot = cart_yaw + 0.35
    add_box(bm_cart, cart_pt(-0.15, 0.884, -0.06), (0.20, 0.007, 0.016), rot_t=(0.0, w_rot, 0.0), mat_idx=4, bevel=0.002)
    add_cylinder(
        bm_cart,
        cart_pt(-0.15 - 0.105 * math.cos(w_rot - cart_yaw), 0.880, -0.06 + 0.105 * math.sin(w_rot - cart_yaw)),
        cart_pt(-0.15 - 0.105 * math.cos(w_rot - cart_yaw), 0.889, -0.06 + 0.105 * math.sin(w_rot - cart_yaw)),
        0.015,
        segs=14,
        mat_idx=4,
    )

    finalize_mesh_object("Workshop_ToolCart_Body", bm_cart, workshop_mats, loc_t=(0.0, 0.0, 0.0), parent=cart_root)

    # -----------------------------------------------------------------------
    # 4. Workshop_Workbench (origin t2b(2.40, 0, 1.35))
    # -----------------------------------------------------------------------
    bench_root = create_empty("Workshop_Workbench", (2.40, 0.0, 1.35))
    bm_bench = bmesh.new()

    # Heavy welded steel square-tube legs with leveling feet (Y = 0..0.845)
    for lx in (-0.31, 0.31):
        for lz in (-0.73, 0.73):
            add_cylinder(bm_bench, (lx, 0.0, lz), (lx, 0.016, lz), 0.032, segs=14, mat_idx=3, bevel_caps=0.002)
            add_box(bm_bench, (lx, 0.43, lz), (0.055, 0.83, 0.055), mat_idx=0, bevel=0.004)
    # Side & longitudinal frame stretchers
    for lz in (-0.73, 0.73):
        add_box(bm_bench, (0.0, 0.22, lz), (0.62, 0.04, 0.04), mat_idx=0, bevel=0.003)
        add_box(bm_bench, (0.0, 0.82, lz), (0.62, 0.045, 0.045), mat_idx=0, bevel=0.003)
    for lx in (-0.31, 0.31):
        add_box(bm_bench, (lx, 0.22, 0.0), (0.04, 0.04, 1.46), mat_idx=0, bevel=0.003)
        add_box(bm_bench, (lx, 0.82, 0.0), (0.045, 0.045, 1.46), mat_idx=0, bevel=0.003)

    # Lower steel storage shelf (Y = 0.235)
    add_box(bm_bench, (0.0, 0.24, 0.0), (0.60, 0.025, 1.44), mat_idx=1, bevel=0.003)

    # Under-bench 2-drawer steel cabinet pod (+Z side)
    add_box(bm_bench, (0.0, 0.66, 0.42), (0.58, 0.34, 0.52), mat_idx=0, bevel=0.005)
    for dy in (0.74, 0.58):
        add_box(bm_bench, (-0.292, dy, 0.42), (0.018, 0.135, 0.46), mat_idx=1, bevel=0.003)
        add_box(bm_bench, (-0.305, dy + 0.035, 0.42), (0.015, 0.016, 0.38), mat_idx=5, bevel=0.002)

    # Thick oiled beechwood butcher-block top (7 planks laminated side by side, top surface at Y = 0.895)
    plank_w = 0.74 / 7.0
    for pi in range(7):
        px = -0.37 + (pi + 0.5) * plank_w
        add_box(
            bm_bench,
            (px, 0.870, 0.0),
            (plank_w - 0.002, 0.050, 1.64),
            mat_idx=9 if pi % 2 == 0 else 10,
            bevel=0.003,
        )

    # Cast-iron bench vise on front-left corner (-0.24, 0.895, -0.58)
    vx, vy, vz = -0.24, 0.895, -0.58
    add_cylinder(bm_bench, (vx, vy, vz), (vx, vy + 0.018, vz), 0.072, segs=18, mat_idx=1, bevel_caps=0.003)
    add_box(bm_bench, (vx, vy + 0.068, vz + 0.015), (0.12, 0.095, 0.145), mat_idx=11, bevel=0.006)
    add_box(bm_bench, (vx, vy + 0.095, vz - 0.085), (0.13, 0.065, 0.055), mat_idx=11, bevel=0.005)
    # Anvil horn & serrated steel jaw plates
    add_box(bm_bench, (vx, vy + 0.115, vz + 0.055), (0.085, 0.025, 0.065), mat_idx=11, bevel=0.004)
    add_box(bm_bench, (vx, vy + 0.118, vz - 0.048), (0.132, 0.026, 0.016), mat_idx=5, bevel=0.002)
    add_box(bm_bench, (vx, vy + 0.118, vz - 0.068), (0.132, 0.026, 0.016), mat_idx=5, bevel=0.002)
    # Screw spindle + sliding tommy bar with ball ends
    add_cylinder(bm_bench, (vx, vy + 0.065, vz - 0.11), (vx, vy + 0.065, vz - 0.155), 0.016, segs=14, mat_idx=4, bevel_caps=0.002)
    add_cylinder(bm_bench, (vx - 0.105, vy + 0.065, vz - 0.142), (vx + 0.105, vy + 0.065, vz - 0.142), 0.0075, segs=12, mat_idx=4)
    for bx in (vx - 0.105, vx + 0.105):
        add_cylinder(bm_bench, (bx - 0.008, vy + 0.065, vz - 0.142), (bx + 0.008, vy + 0.065, vz - 0.142), 0.013, segs=12, mat_idx=4)

    # Stainless magnetic parts tray at local (-0.14, 0.895, 0.0) -> world (2.26, 0.895, 1.35)
    add_box(bm_bench, (-0.14, 0.903, 0.0), (0.24, 0.016, 0.34), mat_idx=4, bevel=0.004)
    add_box(bm_bench, (-0.14, 0.916, 0.0), (0.21, 0.006, 0.31), mat_idx=5, bevel=0.002)
    for bx, bz in ((-0.17, -0.06), (-0.12, 0.04), (-0.15, 0.09)):
        add_cylinder(bm_bench, (bx, 0.919, bz), (bx, 0.928, bz), 0.007, segs=6, mat_idx=1)

    # Rear steel wall pegboard stand (Lochwand) along +X back edge (local X = +0.34)
    for pz in (-0.76, 0.76):
        add_box(bm_bench, (0.34, 1.32, pz), (0.045, 0.86, 0.045), mat_idx=0, bevel=0.003)
    # Main pegboard panel & slotted organizer lip
    add_box(bm_bench, (0.34, 1.32, 0.0), (0.022, 0.72, 1.50), mat_idx=1, bevel=0.003)
    add_box(bm_bench, (0.325, 1.32, 0.0), (0.012, 0.64, 1.42), mat_idx=0, bevel=0.002)
    # Top shelf hood + LED worklight strip illuminating workbench
    add_box(bm_bench, (0.20, 1.72, 0.0), (0.30, 0.035, 1.56), mat_idx=0, bevel=0.004)
    add_box(bm_bench, (0.16, 1.698, 0.0), (0.08, 0.010, 1.32), mat_idx=14)

    # Hanging tool hooks + wrenches & pliers on pegboard facing -X
    for wz, wlen in ((-0.45, 0.18), (-0.37, 0.21), (-0.29, 0.24)):
        add_cylinder(bm_bench, (0.315, 1.46, wz), (0.285, 1.46, wz), 0.004, segs=8, mat_idx=4)
        add_box(bm_bench, (0.292, 1.46 - wlen * 0.5, wz), (0.008, wlen, 0.018), mat_idx=4, bevel=0.002)
    # Tool storage shelf tray on pegboard
    add_box(bm_bench, (0.27, 1.08, 0.36), (0.11, 0.022, 0.48), mat_idx=1, bevel=0.003)

    finalize_mesh_object("Workshop_Workbench_Body", bm_bench, workshop_mats, loc_t=(0.0, 0.0, 0.0), parent=bench_root)

    # -----------------------------------------------------------------------
    # 5. Workshop_TireRack (origin t2b(2.35, 0, -0.35), width 0.85m, open slot at (0,0,0))
    # -----------------------------------------------------------------------
    rack_root = create_empty("Workshop_TireRack", (2.35, 0.0, -0.35))
    bm_rack = bmesh.new()

    # 4 corner tubular steel posts (0.85m wide in X: -0.407..+0.407 + 0.036 = 0.850m, depth 0.64m in Z)
    for rx in (-0.407, 0.407):
        for rz in (-0.302, 0.302):
            add_cylinder(bm_rack, (rx, 0.0, rz), (rx, 0.014, rz), 0.026, segs=14, mat_idx=3, bevel_caps=0.002)
            add_cylinder(bm_rack, (rx, 0.014, rz), (rx, 1.44, rz), 0.018, segs=16, mat_idx=13, bevel_caps=0.002)

    # Side horizontal tie bars & top crossbars
    for rx in (-0.407, 0.407):
        for ry in (0.06, 0.78, 1.40):
            add_cylinder(bm_rack, (rx, ry, -0.302), (rx, ry, 0.302), 0.016, segs=14, mat_idx=13)
    # Top rear stabilizer bar (Y = 1.40)
    add_cylinder(bm_rack, (-0.407, 1.40, 0.302), (0.407, 1.40, 0.302), 0.016, segs=14, mat_idx=13)

    # Lower cradle bay (Y = 0..0.72) - clean open slot around (0, 0.317, 0) for Golf 7 front-right wheel!
    # Front/back amber cradle tubes at Z = +-0.278, Y = 0.080 (wheel tangent at Z=0.278 is Y ~ 0.165, completely clear!)
    for cz in (-0.278, 0.278):
        add_cylinder(bm_rack, (-0.407, 0.080, cz), (0.407, 0.080, cz), 0.016, segs=14, mat_idx=12)
    # Protective side wheel guide rails & closed U-shaped rear wheel-stop hoop (X = +-0.245, outside rotated wheel +-0.19)
    for gx in (-0.245, 0.245):
        add_cylinder(bm_rack, (gx, 0.080, -0.278), (gx, 0.080, 0.278), 0.012, segs=12, mat_idx=12)
    stop_hoop_pts = [
        (-0.245, 0.080, 0.278),
        (-0.245, 0.420, 0.278),
        (-0.220, 0.455, 0.278),
        (+0.220, 0.455, 0.278),
        (+0.245, 0.420, 0.278),
        (+0.245, 0.080, 0.278),
    ]
    add_tube_sweep(bm_rack, stop_hoop_pts, 0.012, ring_segs=12, mat_idx=12)

    # Upper tire storage shelf (Y = 0.78) holding 2 spare workshop tires (R = 0.295m) cleanly above Y = 0.78
    for uz in (-0.165, 0.165):
        add_cylinder(bm_rack, (-0.407, 0.780, uz), (0.407, 0.780, uz), 0.016, segs=14, mat_idx=12)

    # Corner bolted gusset collars on upper shelf
    for rx in (-0.407, 0.407):
        for rz in (-0.302, 0.302):
            add_box(bm_rack, (rx, 0.780, rz), (0.048, 0.065, 0.048), mat_idx=1, bevel=0.004)

    # 2 spare tires parked cleanly on the upper tier (axle along X, sitting on Z = +-0.165 rails -> center Y = 1.045)
    tire_profile = [
        (0.185, -0.095),
        (0.245, -0.105),
        (0.290, -0.098),
        (0.298, -0.072),
        (0.298, -0.036),
        (0.293, -0.030),
        (0.298, -0.024),
        (0.298, +0.024),
        (0.293, +0.030),
        (0.298, +0.036),
        (0.298, +0.072),
        (0.290, +0.098),
        (0.245, +0.105),
        (0.185, +0.095),
        (0.185, -0.095),
    ]
    for tx in (-0.18, 0.16):
        add_lathe(bm_rack, tire_profile, axis="x", center=(tx, 1.045, 0.0), segs=30, mat_idx=3)
        # Inner dark wheel barrel + outer silver alloy rim lip + 5-spoke center + lug nuts
        add_cylinder(bm_rack, (tx - 0.072, 1.045, 0.0), (tx + 0.072, 1.045, 0.0), 0.186, segs=24, mat_idx=1)
        add_torus(bm_rack, (tx - 0.088, 1.045, 0.0), 0.184, 0.009, axis="x", major_segs=24, minor_segs=8, mat_idx=5)
        add_cylinder(bm_rack, (tx - 0.082, 1.045, 0.0), (tx - 0.055, 1.045, 0.0), 0.056, segs=18, mat_idx=5, bevel_caps=0.003)
        for sp in range(5):
            sa = (2.0 * math.pi * sp) / 5.0
            sy = math.cos(sa) * 0.115
            sz = math.sin(sa) * 0.115
            add_box(bm_rack, (tx - 0.078, 1.045 + sy, sz), (0.014, 0.128, 0.028), rot_t=(sa, 0.0, 0.0), mat_idx=5, bevel=0.003)
            # Lug bolt
            la = sa + math.pi / 5.0
            add_cylinder(
                bm_rack,
                (tx - 0.086, 1.045 + math.cos(la) * 0.036, math.sin(la) * 0.036),
                (tx - 0.075, 1.045 + math.cos(la) * 0.036, math.sin(la) * 0.036),
                0.007,
                segs=6,
                mat_idx=4,
            )

    finalize_mesh_object("Workshop_TireRack_Body", bm_rack, workshop_mats, loc_t=(0.0, 0.0, 0.0), parent=rack_root)

    # Export workshop_props.glb
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(WORKSHOP_GLB_PATH),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
    )


# ---------------------------------------------------------------------------
# ASSET 2: tools.glb
# ---------------------------------------------------------------------------

def build_tools() -> None:
    reset_scene()

    scale_img = create_torque_scale_image()

    mat_red_body = make_pbr_mat("Tool_RedBody", 0xC81E24, metallic=0.22, roughness=0.34, coat_weight=0.20)
    mat_red_anodized = make_pbr_mat("Tool_RedAnodized", 0xDC2626, metallic=0.78, roughness=0.26)
    mat_rubber_dark = make_pbr_mat("Tool_RubberDark", 0x16181D, metallic=0.06, roughness=0.84)
    mat_alu_cast = make_pbr_mat("Tool_AluminumCast", 0xB8C0CA, metallic=0.86, roughness=0.26)
    mat_chrome = make_pbr_mat("Tool_ChromeVanadium", 0xE6EBF2, metallic=0.95, roughness=0.14)
    mat_satin_chrome = make_pbr_mat("Tool_SatinChrome", 0xDCE3EC, metallic=0.92, roughness=0.20)
    mat_s2_steel = make_pbr_mat("Tool_S2Steel", 0x3B424C, metallic=0.88, roughness=0.30)
    mat_blue_handle = make_pbr_mat("Tool_BlueHandle", 0x1D5BBF, metallic=0.16, roughness=0.25, coat_weight=0.22)
    mat_dark_blue_grip = make_pbr_mat("Tool_DarkBlueGrip", 0x173A7A, metallic=0.12, roughness=0.68)
    mat_led = make_pbr_mat("Tool_LED", 0xFFFFFF, metallic=0.0, roughness=0.15, emissive_hex=0xE0F2FE, emissive_strength=2.1)
    mat_scale = make_pbr_mat("Tool_TorqueScale", 0xCBD5E1, metallic=0.55, roughness=0.30, image=scale_img)
    mat_dark_cavity = make_pbr_mat("Tool_DarkCavity", 0x0B0E13, metallic=0.50, roughness=0.65)

    tool_mats = [
        mat_red_body,       # 0
        mat_red_anodized,   # 1
        mat_rubber_dark,    # 2
        mat_alu_cast,       # 3
        mat_chrome,         # 4
        mat_satin_chrome,   # 5
        mat_s2_steel,       # 6
        mat_blue_handle,    # 7
        mat_dark_blue_grip, # 8
        mat_led,            # 9
        mat_scale,          # 10
        mat_dark_cavity,    # 11
    ]

    # -----------------------------------------------------------------------
    # 1. Tool_impact17 (deep 17mm socket at (0,0,0)..(+0.052,0,0), body +X, grip -Y)
    # -----------------------------------------------------------------------
    impact_root = create_empty("Tool_impact17", (0.0, 0.0, 0.0))

    # Separate socket mesh child so ToolModels can spin socket if desired while Tool_impact17 moves as unit
    bm_sock17 = bmesh.new()
    # Outer socket profile with chamfered nose & dark internal hex recess at X = 0
    add_lathe(
        bm_sock17,
        [
            (0.0086, 0.018),
            (0.0092, 0.001),
            (0.0125, 0.0),
            (0.0155, 0.003),
            (0.0155, 0.052),
            (0.0, 0.052),
        ],
        axis="x",
        segs=24,
        mat_idx=4,
    )
    # Red anodized 17mm socket ID band
    add_cylinder(bm_sock17, (0.038, 0.0, 0.0), (0.046, 0.0, 0.0), 0.0159, segs=24, mat_idx=1)
    # Deep internal dark hex bore
    add_cylinder(bm_sock17, (0.0005, 0.0, 0.0), (0.020, 0.0, 0.0), 0.0090, segs=6, mat_idx=11)
    finalize_mesh_object("Tool_impact17_Socket", bm_sock17, tool_mats, parent=impact_root)

    bm_imp = bmesh.new()
    # 1/2" anvil + brushed cast aluminum hammer nose
    add_cylinder(bm_imp, (0.050, 0.0, 0.0), (0.064, 0.0, 0.0), 0.010, segs=14, mat_idx=3)
    add_lathe(
        bm_imp,
        [
            (0.0, 0.062),
            (0.025, 0.062),
            (0.028, 0.066),
            (0.029, 0.088),
            (0.033, 0.118),
            (0.0, 0.118),
        ],
        axis="x",
        segs=24,
        mat_idx=3,
    )
    # LED worklight ring around nose
    add_torus(bm_imp, (0.063, 0.0, 0.0), 0.024, 0.0028, axis="x", major_segs=22, minor_segs=8, mat_idx=9)
    # 4 nose housing bolts
    for a in (math.pi * 0.25, math.pi * 0.75, math.pi * 1.25, math.pi * 1.75):
        cy, cz = math.cos(a) * 0.028, math.sin(a) * 0.028
        add_cylinder(bm_imp, (0.112, cy, cz), (0.120, cy, cz), 0.0032, segs=6, mat_idx=6)

    # Red brushless motor barrel (X = 0.118..0.218)
    add_lathe(
        bm_imp,
        [
            (0.0, 0.118),
            (0.034, 0.118),
            (0.0355, 0.145),
            (0.0345, 0.214),
            (0.0, 0.214),
        ],
        axis="x",
        segs=24,
        mat_idx=0,
    )
    # Black rubber rear bumper boot & side vents
    add_lathe(
        bm_imp,
        [
            (0.0, 0.212),
            (0.035, 0.212),
            (0.034, 0.228),
            (0.028, 0.236),
            (0.0, 0.236),
        ],
        axis="x",
        segs=22,
        mat_idx=2,
    )
    for side_z in (-0.033, 0.033):
        for vx in (0.178, 0.188, 0.198):
            add_box(bm_imp, (vx, 0.005, side_z), (0.004, 0.026, 0.005), mat_idx=2, bevel=0.001)

    # Ergonomic pistol grip angling down (-Y_three) + red trigger + F/R switch
    add_box(bm_imp, (0.160, -0.078, 0.0), (0.040, 0.115, 0.032), rot_t=(0.0, 0.0, 0.18), mat_idx=0, bevel=0.008, bevel_segs=2)
    add_box(bm_imp, (0.164, -0.082, 0.0), (0.032, 0.095, 0.034), rot_t=(0.0, 0.0, 0.18), mat_idx=2, bevel=0.006, bevel_segs=2)
    add_box(bm_imp, (0.126, -0.042, 0.0), (0.022, 0.024, 0.015), rot_t=(0.0, 0.0, -0.15), mat_idx=0, bevel=0.003)
    add_cylinder(bm_imp, (0.142, -0.025, -0.022), (0.142, -0.025, 0.022), 0.005, segs=10, mat_idx=2)

    # 18V 5.0Ah Li-Ion Battery Pack at base (Y = -0.132..-0.194)
    add_box(bm_imp, (0.172, -0.138, 0.0), (0.096, 0.014, 0.072), mat_idx=0, bevel=0.003)
    add_box(bm_imp, (0.174, -0.168, 0.0), (0.110, 0.052, 0.076), mat_idx=2, bevel=0.007, bevel_segs=2)
    add_box(bm_imp, (0.174, -0.182, 0.0), (0.102, 0.014, 0.078), mat_idx=0, bevel=0.003)
    # Fuel gauge LED bar on battery front (-X)
    add_box(bm_imp, (0.118, -0.165, 0.0), (0.004, 0.010, 0.028), mat_idx=9)

    finalize_mesh_object("Tool_impact17_Body", bm_imp, tool_mats, parent=impact_root)

    # -----------------------------------------------------------------------
    # 2. Tool_torx25 (6-lobe Torx tip at (0,0,0), handle X = +0.11..+0.22)
    # -----------------------------------------------------------------------
    torx_root = create_empty("Tool_torx25", (0.0, 0.0, 0.0))
    bm_tx = bmesh.new()

    # True 6-lobe Torx T25 star profile extruded along +X (0..0.016m)
    torx_pts: list[tuple[float, float]] = []
    for k in range(24):
        ang = (2.0 * math.pi * k) / 24.0
        r = 0.0023 + 0.00055 * math.cos(6.0 * ang)
        torx_pts.append((r * math.cos(ang), r * math.sin(ang)))
    add_extruded_polygon(bm_tx, torx_pts, 0.016, axis="x", center=(0.008, 0.0, 0.0), mat_idx=6)
    # Subtle chamfer cone at X=0 tip
    add_cylinder(bm_tx, (0.0, 0.0, 0.0), (0.0025, 0.0, 0.0), 0.0017, 0.0024, segs=12, mat_idx=6)

    # Polished chrome shaft (X = 0.015..0.105)
    add_cylinder(bm_tx, (0.015, 0.0, 0.0), (0.105, 0.0, 0.0), 0.0030, segs=16, mat_idx=4)

    # Hex anti-roll bolster collar (X = 0.102..0.116)
    add_cylinder(bm_tx, (0.102, 0.0, 0.0), (0.116, 0.0, 0.0), 0.0095, segs=6, mat_idx=2, bevel_caps=0.0015)

    # Ergonomic Wera/Hazet fluted blue/black handle (X = 0.114..0.222)
    add_lathe(
        bm_tx,
        [
            (0.0, 0.114),
            (0.0088, 0.114),
            (0.0158, 0.130),
            (0.0132, 0.154),
            (0.0185, 0.188),
            (0.0165, 0.212),
            (0.0085, 0.221),
            (0.0, 0.223),
        ],
        axis="x",
        segs=24,
        mat_idx=7,
    )
    # 6 longitudinal black soft-grip flutes around handle waist/swell
    for i in range(6):
        ang = (2.0 * math.pi * i) / 6.0
        cy, cz = math.cos(ang) * 0.0152, math.sin(ang) * 0.0152
        add_box(bm_tx, (0.172, cy, cz), (0.072, 0.0065, 0.0065), rot_t=(ang, 0.0, 0.0), mat_idx=2, bevel=0.0018)
    # End cap accent ring
    add_torus(bm_tx, (0.214, 0.0, 0.0), 0.0145, 0.0018, axis="x", major_segs=20, minor_segs=6, mat_idx=2)

    finalize_mesh_object("Tool_torx25_Body", bm_tx, tool_mats, parent=torx_root)

    # -----------------------------------------------------------------------
    # 3. Tool_wrench16 (12-point ring at (0,0,0), offset +0.027 X, -0.36 rad)
    # -----------------------------------------------------------------------
    wrench_root = create_empty("Tool_wrench16", (0.0, 0.0, 0.0))
    bm_w16 = bmesh.new()

    # True 12-point bi-hex ring head centered at (0,0,0): outer R = 0.0155, thickness = 0.010 around X
    n_ring = 24
    ring_outer_pts: list[tuple[float, float]] = []
    ring_inner_pts: list[tuple[float, float]] = []
    for k in range(n_ring):
        a = (2.0 * math.pi * k) / n_ring
        ring_outer_pts.append((0.0155 * math.cos(a), 0.0155 * math.sin(a)))
        # 12-point bi-hex star inner bore (peaks/valleys every 30 deg)
        ri = 0.0102 if (k % 2 == 0) else 0.0114
        ring_inner_pts.append((ri * math.cos(a), ri * math.sin(a)))
    add_extruded_polygon(
        bm_w16,
        ring_outer_pts,
        0.010,
        axis="x",
        center=(0.0, 0.0, 0.0),
        mat_idx=5,
        bevel=0.0010,
        holes_2d=[ring_inner_pts],
    )

    # Tilted neck & shaft axis: rotated -0.36 rad around X in Three.js
    tilt_x = -0.36

    def w_pos(lx: float, ly: float, lz: float = 0.0) -> tuple[float, float, float]:
        c, s = math.cos(tilt_x), math.sin(tilt_x)
        return (lx, ly * c - lz * s, ly * s + lz * c)

    # Seamless lofted forged offset neck connecting ring (X=0, Y=0.012) -> shaft base (X=+0.027, Y=0.046)
    sub_neck = bmesh.new()
    neck_steps = 8
    neck_rings = []
    for st in range(neck_steps + 1):
        t = st / neck_steps
        s = t * t * (3.0 - 2.0 * t)
        nx = 0.027 * s
        ny = 0.012 + (0.044 - 0.012) * t
        half_th = (0.0045 * (1.0 - s) + 0.0036 * s)
        half_w = (0.0070 * (1.0 - s) + 0.0086 * s)
        ring_corners = [
            (-half_th, -half_w),
            (+half_th, -half_w),
            (+half_th, +half_w),
            (-half_th, +half_w),
        ]
        rv = [sub_neck.verts.new(Vector(w_pos(nx + dx, ny, dz))) for dx, dz in ring_corners]
        neck_rings.append(rv)
    sub_neck.faces.new(list(reversed(neck_rings[0])))
    sub_neck.faces.new(neck_rings[-1])
    for st in range(neck_steps):
        r0, r1 = neck_rings[st], neck_rings[st + 1]
        for k in range(4):
            nk = (k + 1) % 4
            sub_neck.faces.new([r0[k], r0[nk], r1[nk], r1[k]])
    bmesh.ops.bevel(sub_neck, geom=list(sub_neck.edges), offset=0.0010, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    _merge_sub_bmesh(bm_w16, sub_neck, 5)

    # Forged I-beam shaft along tilted axis (Y_neck = 0.040 .. 0.210, X = +0.027)
    add_box(bm_w16, w_pos(0.027, 0.125), (0.0048, 0.172, 0.0175), rot_t=(tilt_x, 0.0, 0.0), mat_idx=5, bevel=0.0012)
    # Raised forged I-beam flank ribs
    for z_rib in (-0.0072, 0.0072):
        add_box(bm_w16, w_pos(0.027, 0.125, z_rib), (0.0078, 0.152, 0.0038), rot_t=(tilt_x, 0.0, 0.0), mat_idx=5, bevel=0.0010)

    # Forged angled 16mm open-end jaw at top (Y_neck = 0.205 .. 0.242, X = +0.027)
    jaw_rot_x = tilt_x + 0.26  # 15 deg standard open-end offset angle
    jaw_poly = [
        (-0.013, -0.010),
        (-0.017, +0.008),
        (-0.012, +0.025),
        (-0.008, +0.025),
        (-0.008, +0.008),
        (+0.008, +0.008),
        (+0.008, +0.025),
        (+0.012, +0.025),
        (+0.017, +0.008),
        (+0.013, -0.010),
    ]
    # Note: axis='x' takes (z, y) in Three.js
    add_extruded_polygon(
        bm_w16,
        jaw_poly,
        0.0072,
        axis="x",
        center=w_pos(0.027, 0.214),
        rot_t=(jaw_rot_x, 0.0, 0.0),
        mat_idx=5,
        bevel=0.0010,
    )

    finalize_mesh_object("Tool_wrench16_Body", bm_w16, tool_mats, parent=wrench_root)

    # -----------------------------------------------------------------------
    # 4. Tool_pinT10060A (4mm steel dowel pin tip at (0,0,0)..+0.068, red grip +0.072..+0.115)
    # -----------------------------------------------------------------------
    pin_root = create_empty("Tool_pinT10060A", (0.0, 0.0, 0.0))
    bm_pin = bmesh.new()

    # Tapered tip + hardened 4mm steel dowel shaft (X = 0..0.068)
    add_lathe(
        bm_pin,
        [
            (0.0, 0.0),
            (0.0012, 0.0004),
            (0.0022, 0.006),
            (0.0022, 0.068),
            (0.0, 0.068),
        ],
        axis="x",
        segs=18,
        mat_idx=6,
    )
    # Machined chrome depth-stop collar (X = 0.064..0.072)
    add_lathe(
        bm_pin,
        [
            (0.0, 0.064),
            (0.0068, 0.064),
            (0.0068, 0.072),
            (0.0, 0.072),
        ],
        axis="x",
        segs=20,
        mat_idx=4,
    )
    # Anodized red diamond-knurled thumb grip (X = 0.072..0.115)
    add_lathe(
        bm_pin,
        [
            (0.0, 0.072),
            (0.0095, 0.072),
            (0.0110, 0.075),
            (0.0110, 0.112),
            (0.0092, 0.115),
            (0.0, 0.115),
        ],
        axis="x",
        segs=24,
        mat_idx=1,
    )
    # Diamond-knurl ring bands + axial flutes on thumb grip
    for kx in (0.079, 0.085, 0.091, 0.097, 0.103, 0.109):
        add_torus(bm_pin, (kx, 0.0, 0.0), 0.0110, 0.0008, axis="x", major_segs=20, minor_segs=6, mat_idx=1)
    for k in range(12):
        ang = (2.0 * math.pi * k) / 12.0
        cy, cz = math.cos(ang) * 0.0110, math.sin(ang) * 0.0110
        add_box(bm_pin, (0.0935, cy, cz), (0.032, 0.0012, 0.0012), rot_t=(ang, 0.0, 0.0), mat_idx=1)

    finalize_mesh_object("Tool_pinT10060A_Body", bm_pin, tool_mats, parent=pin_root)

    # -----------------------------------------------------------------------
    # 5. Tool_ratchet13 (13mm socket at (0,0,0), handle extending +Y_three)
    # -----------------------------------------------------------------------
    ratchet_root = create_empty("Tool_ratchet13", (0.0, 0.0, 0.0))
    bm_rat = bmesh.new()

    # 13mm chrome socket at X = 0..0.036
    add_lathe(
        bm_rat,
        [
            (0.0068, 0.014),
            (0.0072, 0.001),
            (0.0102, 0.0),
            (0.0122, 0.003),
            (0.0122, 0.036),
            (0.0, 0.036),
        ],
        axis="x",
        segs=22,
        mat_idx=4,
    )
    add_cylinder(bm_rat, (0.0005, 0.0, 0.0), (0.015, 0.0, 0.0), 0.0072, segs=6, mat_idx=11)
    add_torus(bm_rat, (0.028, 0.0, 0.0), 0.0122, 0.0008, axis="x", major_segs=20, minor_segs=6, mat_idx=4)

    # Short 3/8" chrome extension bar (X = 0.036..0.090)
    add_cylinder(bm_rat, (0.036, 0.0, 0.0), (0.090, 0.0, 0.0), 0.0072, segs=16, mat_idx=4)
    add_cylinder(bm_rat, (0.036, 0.0, 0.0), (0.048, 0.0, 0.0), 0.0095, segs=16, mat_idx=4, bevel_caps=0.001)

    # Teardrop forged chrome ratchet head centered around (X = 0.095, Y = 0)
    teardrop_pts: list[tuple[float, float]] = []
    for k in range(18):
        # Upper round arc from -130 deg to +130 deg around Y=0, tapering down toward neck at +Y
        a = -math.pi * 0.65 + (k / 17.0) * math.pi * 1.30
        teardrop_pts.append((0.0185 * math.sin(a), -0.0185 * math.cos(a)))
    teardrop_pts.extend([(0.0085, 0.032), (-0.0085, 0.032)])
    add_extruded_polygon(bm_rat, teardrop_pts, 0.016, axis="x", center=(0.095, 0.0, 0.0), mat_idx=4, bevel=0.0020)

    # Quick-release anvil center + directional selector lever on +X back face
    add_cylinder(bm_rat, (0.102, 0.0, 0.0), (0.107, 0.0, 0.0), 0.007, segs=14, mat_idx=2)
    add_box(bm_rat, (0.106, 0.007, 0.0), (0.006, 0.017, 0.008), rot_t=(0.35, 0.0, 0.0), mat_idx=1, bevel=0.0015)

    # Tapered forged chrome shaft extending +Y_three (Y = 0.028..0.148)
    add_box(bm_rat, (0.097, 0.088, 0.0), (0.0095, 0.125, 0.0145), mat_idx=4, bevel=0.0020)

    # Knurled ergonomic dark-blue/black handle (Y = 0.145..0.258)
    add_lathe(
        bm_rat,
        [
            (0.0, 0.144),
            (0.0115, 0.144),
            (0.0145, 0.160),
            (0.0128, 0.190),
            (0.0150, 0.228),
            (0.0135, 0.250),
            (0.0075, 0.257),
            (0.0, 0.258),
        ],
        axis="y",
        center=(0.097, 0.0, 0.0),
        segs=22,
        mat_idx=8,
    )
    # Dark rubber overmold comfort grip bands matched smoothly to handle taper
    for gy, gr in ((0.168, 0.0140), (0.184, 0.0132), (0.200, 0.0134), (0.216, 0.0143), (0.232, 0.0147)):
        add_torus(bm_rat, (0.097, gy, 0.0), gr, 0.0014, axis="y", major_segs=32, minor_segs=10, mat_idx=2)

    finalize_mesh_object("Tool_ratchet13_Body", bm_rat, tool_mats, parent=ratchet_root)

    # -----------------------------------------------------------------------
    # 6. Tool_torqueWrench (socket at (0,0,0), 0.46m lever extending +Y_three)
    # -----------------------------------------------------------------------
    torque_root = create_empty("Tool_torqueWrench", (0.0, 0.0, 0.0))
    bm_tq = bmesh.new()

    # Socket at X = 0..0.042
    add_lathe(
        bm_tq,
        [
            (0.0080, 0.016),
            (0.0085, 0.001),
            (0.0115, 0.0),
            (0.0142, 0.003),
            (0.0142, 0.042),
            (0.0, 0.042),
        ],
        axis="x",
        segs=24,
        mat_idx=4,
    )
    add_cylinder(bm_tq, (0.0005, 0.0, 0.0), (0.018, 0.0, 0.0), 0.0085, segs=6, mat_idx=11)

    # Clearance extension neck (X = 0.042..0.088)
    add_cylinder(bm_tq, (0.042, 0.0, 0.0), (0.088, 0.0, 0.0), 0.0085, segs=18, mat_idx=4)

    # Heavy forged ratcheting drive head (X = 0.084..0.106, Y = 0)
    tq_head_pts: list[tuple[float, float]] = []
    for k in range(20):
        a = -math.pi * 0.68 + (k / 19.0) * math.pi * 1.36
        tq_head_pts.append((0.021 * math.sin(a), -0.021 * math.cos(a)))
    tq_head_pts.extend([(0.011, 0.036), (-0.011, 0.036)])
    add_extruded_polygon(bm_tq, tq_head_pts, 0.019, axis="x", center=(0.095, 0.0, 0.0), mat_idx=4, bevel=0.0022)
    add_cylinder(bm_tq, (0.104, 0.0, 0.0), (0.109, 0.0, 0.0), 0.010, segs=16, mat_idx=2)
    add_box(bm_tq, (0.109, 0.008, 0.0), (0.006, 0.020, 0.008), rot_t=(0.3, 0.0, 0.0), mat_idx=1, bevel=0.0015)

    # Long calibrated chrome lever shaft (Y = 0.032..0.242)
    add_cylinder(bm_tq, (0.096, 0.032, 0.0), (0.096, 0.242, 0.0), 0.0112, segs=22, mat_idx=4)

    # Etched micrometer scale sleeve (Y = 0.240..0.318) with mapped UV texture
    add_lathe(
        bm_tq,
        [
            (0.0115, 0.240),
            (0.0138, 0.244),
            (0.0138, 0.314),
            (0.0115, 0.318),
        ],
        axis="y",
        center=(0.096, 0.0, 0.0),
        segs=24,
        mat_idx=10,
        cyl_uv=True,
    )

    # Locking knurled collar (Y = 0.318..0.342) + red unlock ring
    add_cylinder(bm_tq, (0.096, 0.318, 0.0), (0.096, 0.342, 0.0), 0.0162, segs=24, mat_idx=5, bevel_caps=0.002)
    add_cylinder(bm_tq, (0.096, 0.315, 0.0), (0.096, 0.319, 0.0), 0.0150, segs=20, mat_idx=1)
    for k in range(16):
        a = (2.0 * math.pi * k) / 16.0
        add_box(
            bm_tq,
            (0.096 + math.cos(a) * 0.0162, 0.330, math.sin(a) * 0.0162),
            (0.0016, 0.018, 0.0016),
            rot_t=(0.0, -a, 0.0),
            mat_idx=2,
        )

    # Black rubberized contoured grip (Y = 0.342..0.452)
    add_lathe(
        bm_tq,
        [
            (0.0, 0.342),
            (0.0148, 0.342),
            (0.0172, 0.365),
            (0.0156, 0.398),
            (0.0175, 0.432),
            (0.0150, 0.452),
            (0.0, 0.452),
        ],
        axis="y",
        center=(0.096, 0.0, 0.0),
        segs=24,
        mat_idx=2,
    )
    for gy in (0.360, 0.376, 0.392, 0.408, 0.424, 0.440):
        add_torus(bm_tq, (0.096, gy, 0.0), 0.0164, 0.0013, axis="y", major_segs=22, minor_segs=6, mat_idx=2)

    # Brushed chrome micrometer end adjuster cap (Y = 0.452..0.468 -> total lever ~0.465m)
    add_lathe(
        bm_tq,
        [
            (0.0, 0.452),
            (0.0155, 0.452),
            (0.0155, 0.463),
            (0.0125, 0.468),
            (0.0, 0.468),
        ],
        axis="y",
        center=(0.096, 0.0, 0.0),
        segs=22,
        mat_idx=5,
    )

    finalize_mesh_object("Tool_torqueWrench_Body", bm_tq, tool_mats, parent=torque_root)

    # Export tools.glb
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(TOOLS_GLB_PATH),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
    )


# ---------------------------------------------------------------------------
# Verification Helper (Inspects Exported GLB Headers & Node Hierarchy)
# ---------------------------------------------------------------------------

def verify_glb(path: Path, expected_nodes: Sequence[str]) -> None:
    assert path.exists(), f"Missing output GLB: {path}"
    size_bytes = path.stat().st_size
    size_mb = size_bytes / (1024.0 * 1024.0)
    assert size_bytes < 4 * 1024 * 1024, f"{path.name} exceeds 4 MB limit ({size_mb:.2f} MB)"

    with path.open("rb") as f:
        data = f.read()
    magic, version, total_len = struct.unpack("<4sII", data[:12])
    assert magic == b"glTF" and version == 2, f"Invalid GLB header in {path.name}"
    json_len, chunk_type = struct.unpack("<I4s", data[12:20])
    assert chunk_type == b"JSON"
    gltf = json.loads(data[20 : 20 + json_len].decode("utf-8"))

    node_map = {n.get("name"): n for n in gltf.get("nodes", []) if "name" in n}
    missing = [name for name in expected_nodes if name not in node_map]
    assert not missing, f"Missing expected nodes in {path.name}: {missing}"

    print(f"\n=== Verified {path.name} ({size_bytes / 1024.0:.1f} KB, {len(gltf.get('meshes', []))} meshes) ===")
    for name in expected_nodes:
        n = node_map[name]
        print(
            f"  Node '{name}': translation={n.get('translation', [0, 0, 0])} "
            f"rotation={n.get('rotation', [0, 0, 0, 1])} scale={n.get('scale', [1, 1, 1])} "
            f"mesh={n.get('mesh')} children={n.get('children')}"
        )


def main() -> None:
    build_workshop_props()
    build_tools()

    verify_glb(
        WORKSHOP_GLB_PATH,
        [
            "Lift_Columns",
            "Lift_BtnUp",
            "Lift_BtnDown",
            "Lift_Carriages",
            "Workshop_ToolCart",
            "Workshop_Workbench",
            "Workshop_TireRack",
        ],
    )
    verify_glb(
        TOOLS_GLB_PATH,
        [
            "Tool_impact17",
            "Tool_torx25",
            "Tool_wrench16",
            "Tool_pinT10060A",
            "Tool_ratchet13",
            "Tool_torqueWrench",
        ],
    )
    print("\nALL EXPORTS AND VERIFICATIONS SUCCEEDED.")


if __name__ == "__main__":
    main()
