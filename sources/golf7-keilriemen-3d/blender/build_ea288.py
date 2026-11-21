"""
VW Golf 7 EA288 1.6 TDI Serpentine Belt Drive & Engine Core CAD Builder
Blender 5.2 LTS Python script -> exports public/models/ea288_engine.glb

Coordinate contract:
  Three.js (x, y, z) -> Blender (x, -z, y) via t2b(x, y, z).
  Belt drive plane: X_three = 0.44, centered at (0.44, 0.45, -1.32).
  Local (u, v) maps to Three.js (0.44, 0.45 + v, -1.32 - u).
  Every named node has .location = t2b(...), .rotation_euler = (0, 0, 0), .scale = (1, 1, 1).
"""

import math
import os
from pathlib import Path
import numpy as np
import bpy
import bmesh
from mathutils import Matrix, Vector, Euler


# ---------------------------------------------------------------------------
# Paths & Mechanical Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUT_GLB = PROJECT_ROOT / "public" / "models" / "ea288_engine.glb"

DRIVE_X = 0.44
CRANK_POS = (DRIVE_X, 0.340, -1.270)
AC_POS = (DRIVE_X, 0.355, -1.485)
ALT_POS = (DRIVE_X, 0.585, -1.445)
TENS_PIVOT = (DRIVE_X, 0.545, -1.379)

TENS_ARM_LEN = 0.085
HEX_ARM_RADIUS = 0.066
HEX_ARM_ANGLE = math.radians(-12.0)
PIN_ARM_RADIUS = 0.042
PIN_ARM_ANGLE = math.radians(-35.0)
PIN_STAT_ANGLE = math.radians(-195.0)

# 6PK multi-rib groove geometry matching EA288Engine.ts analytical belt profile
RIB_START = -0.0099
RIB_PITCH = 0.0198 / 6.0  # 0.0033 m


def t2b(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Convert Three.js (X, Y, Z) to Blender (X, -Z, Y)."""
    bx = 0.0 if abs(x) < 1e-12 else float(x)
    by = 0.0 if abs(z) < 1e-12 else float(-z)
    bz = 0.0 if abs(y) < 1e-12 else float(y)
    return (bx, by, bz)


def v_t2b(pt: tuple[float, float, float]) -> Vector:
    return Vector(t2b(pt[0], pt[1], pt[2]))


def uv_offset_t(u: float, v: float, x: float = 0.0) -> tuple[float, float, float]:
    """Local belt-plane (x, u, v) offset in Three.js coordinates: (x, v, -u)."""
    return (x, v, -u)


# ---------------------------------------------------------------------------
# Scene Cleanup & Procedural Texture Synthesis
# ---------------------------------------------------------------------------

def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def _create_packed_image(name: str, rgba_uint8: np.ndarray, colorspace: str = "sRGB") -> bpy.types.Image:
    h, w, _ = rgba_uint8.shape
    img = bpy.data.images.new(name=name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = colorspace
    # Blender expects bottom-to-top float array in [0, 1]
    flipped = np.flipud(rgba_uint8).astype(np.float32) / 255.0
    img.pixels.foreach_set(flipped.ravel())
    img.pack()
    return img


def _height_to_normal(height: np.ndarray, strength: float = 2.0) -> np.ndarray:
    """Convert tileable 2D height field in [0, 1] to tangent-space normal RGBA uint8."""
    dh_dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dh_dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    nx = -dh_dx
    ny = -dh_dy
    nz = np.ones_like(height)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    r = np.clip((nx / norm * 0.5 + 0.5) * 255.0, 0, 255)
    g = np.clip((ny / norm * 0.5 + 0.5) * 255.0, 0, 255)
    b = np.clip((nz / norm * 0.5 + 0.5) * 255.0, 0, 255)
    a = np.full_like(r, 255.0)
    return np.stack([r, g, b, a], axis=-1).astype(np.uint8)


def generate_textures() -> dict[str, bpy.types.Image]:
    rng = np.random.default_rng(20260288)
    res = 256
    yy, xx = np.mgrid[0:res, 0:res]

    # 1. Sand/die-cast aluminum micro-grain normal map
    fine = rng.normal(0.5, 0.14, (res, res))
    # Add low-frequency smooth casting waves (tileable)
    wave = (
        0.5
        + 0.12 * np.sin(2.0 * np.pi * xx / res * 4.0) * np.cos(2.0 * np.pi * yy / res * 4.0)
        + 0.08 * np.sin(2.0 * np.pi * (xx + yy) / res * 7.0)
    )
    cast_h = np.clip(0.65 * fine + 0.35 * wave, 0.0, 1.0)
    cast_norm_img = _create_packed_image("Tex_CastAlu_Normal", _height_to_normal(cast_h, strength=1.4), "Non-Color")

    # 2. Stamped dimpled heatshield normal + subtle tonal map
    step = 16.0
    gx = (xx % step) / step - 0.5
    gy = (yy % step) / step - 0.5
    row_shift = ((yy // int(step)) % 2) * 0.5
    gx_hex = ((xx + row_shift * step) % step) / step - 0.5
    dist = np.sqrt(gx_hex * gx_hex + gy * gy)
    dimple = np.clip(1.0 - (dist / 0.36) ** 2, 0.0, 1.0)
    dimple = dimple * dimple * (3.0 - 2.0 * dimple)
    hs_h = 0.5 + 0.45 * dimple + 0.04 * rng.normal(0.0, 1.0, (res, res))
    hs_norm_img = _create_packed_image("Tex_HeatShield_Normal", _height_to_normal(hs_h, strength=3.2), "Non-Color")

    hs_tone = np.clip(165.0 + 58.0 * dimple + rng.normal(0.0, 4.0, (res, res)), 110, 240)
    hs_rgba = np.stack([hs_tone * 0.96, hs_tone * 0.98, hs_tone, np.full_like(hs_tone, 255)], axis=-1).astype(np.uint8)
    hs_col_img = _create_packed_image("Tex_HeatShield_Albedo", hs_rgba, "sRGB")

    # 3. Brushed stainless / machined metal normal map
    streak = np.repeat(rng.normal(0.5, 0.16, (res, 1)), res, axis=1)
    streak += 0.08 * np.sin(2.0 * np.pi * xx / res * 2.0)
    brushed_img = _create_packed_image("Tex_Brushed_Normal", _height_to_normal(streak, strength=1.0), "Non-Color")

    return {
        "cast_norm": cast_norm_img,
        "hs_norm": hs_norm_img,
        "hs_col": hs_col_img,
        "brushed_norm": brushed_img,
    }


# ---------------------------------------------------------------------------
# PBR Material Library
# ---------------------------------------------------------------------------

def make_pbr_material(
    name: str,
    base_color: tuple[float, float, float],
    metallic: float = 0.0,
    roughness: float = 0.5,
    coat_weight: float = 0.0,
    coat_roughness: float = 0.15,
    normal_img: bpy.types.Image | None = None,
    normal_strength: float = 0.25,
    albedo_img: bpy.types.Image | None = None,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    if mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (360, 0)

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (60, 0)
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat_weight
    bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    if albedo_img is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.location = (-260, 140)
        tex.image = albedo_img
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    if normal_img is not None:
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-440, -160)
        tex_n.image = normal_img
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-160, -160)
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    return mat


def srgb_hex(h: int) -> tuple[float, float, float]:
    """Convert 0xRRGGBB sRGB hex color to Blender linear RGB."""
    def to_lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (
        to_lin(((h >> 16) & 0xFF) / 255.0),
        to_lin(((h >> 8) & 0xFF) / 255.0),
        to_lin((h & 0xFF) / 255.0),
    )


def build_materials(tex: dict[str, bpy.types.Image]) -> dict[str, bpy.types.Material]:
    return {
        # Engine core materials (accurate linear sRGB values for Three.js PBR)
        "cast_alu": make_pbr_material("Cast_Aluminum", srgb_hex(0x9AA3AD), 0.78, 0.42, normal_img=tex["cast_norm"], normal_strength=0.22),
        "dark_cast_iron": make_pbr_material("Dark_Cast_Iron", srgb_hex(0x3B414A), 0.68, 0.58, normal_img=tex["cast_norm"], normal_strength=0.30),
        "sump_alu": make_pbr_material("Sump_Cast_Aluminum", srgb_hex(0x6D747E), 0.76, 0.48, normal_img=tex["cast_norm"], normal_strength=0.25),
        "polyamide": make_pbr_material("Polyamide_PA66_GF30", srgb_hex(0x1B1E24), 0.04, 0.56, coat_weight=0.06, coat_roughness=0.45),
        "matte_rubber": make_pbr_material("EPDM_Rubber_Hose", srgb_hex(0x15171B), 0.02, 0.84),
        "stainless": make_pbr_material("Brushed_Stainless", srgb_hex(0xC8D0D8), 0.92, 0.24, normal_img=tex["brushed_norm"], normal_strength=0.12),
        "machined_steel": make_pbr_material("Machined_Steel", srgb_hex(0xB8C0CA), 0.90, 0.24, normal_img=tex["brushed_norm"], normal_strength=0.14),
        "dark_pulley_steel": make_pbr_material("Dark_Phosphate_Steel", srgb_hex(0x282D35), 0.78, 0.34, coat_weight=0.10, coat_roughness=0.28),
        "damper_rubber": make_pbr_material("Damper_Elastomer", srgb_hex(0x14161A), 0.04, 0.86),
        "heatshield": make_pbr_material("Dimpled_HeatShield", srgb_hex(0xCBD2D9), 0.88, 0.30, normal_img=tex["hs_norm"], normal_strength=0.42, albedo_img=tex["hs_col"]),
        "exhaust_iron": make_pbr_material("Heat_Exhaust_Iron", srgb_hex(0x5A463B), 0.72, 0.55, normal_img=tex["cast_norm"], normal_strength=0.28),
        "copper": make_pbr_material("Lacquered_Copper_Stator", srgb_hex(0xC45A18), 0.92, 0.22, coat_weight=0.35, coat_roughness=0.14),
        "yellow_plastic": make_pbr_material("Dipstick_Yellow", srgb_hex(0xFACC15), 0.04, 0.38, coat_weight=0.2, coat_roughness=0.2),
        "blue_torque_seal": make_pbr_material("TorqueSeal_Blue", srgb_hex(0x38BDF8), 0.05, 0.34, coat_weight=0.25, coat_roughness=0.2),
        "red_anodized": make_pbr_material("Anodized_Red_T10060A", srgb_hex(0xDC2626), 0.76, 0.28, coat_weight=0.25, coat_roughness=0.22),
        "brass": make_pbr_material("Brass_Terminal", srgb_hex(0xD4A238), 0.90, 0.26),
        "dark_bore": make_pbr_material("Dark_Bore_Shadow", srgb_hex(0x0B0D10), 0.15, 0.85),

        # Required named tensioner materials for EA288Engine.ts hot-swapping
        "Tensioner_Old": make_pbr_material("Tensioner_Old", srgb_hex(0x7E8389), 0.65, 0.56, normal_img=tex["cast_norm"], normal_strength=0.24),
        "Tensioner_Roller": make_pbr_material("Tensioner_Roller", srgb_hex(0xC8D0DA), 0.90, 0.20, normal_img=tex["brushed_norm"], normal_strength=0.10),
        "Tensioner_Bolt": make_pbr_material("Tensioner_Bolt", srgb_hex(0x9FA8B2), 0.86, 0.26),
        "Tensioner_PinRing": make_pbr_material("Tensioner_PinRing", srgb_hex(0x94A3B8), 0.82, 0.28),
        "Tensioner_BearingCap": make_pbr_material("Tensioner_BearingCap", srgb_hex(0x1E293B), 0.08, 0.64),
    }


# ---------------------------------------------------------------------------
# BMesh CAD Geometry Helpers (Three.js input coords -> Blender via t2b)
# ---------------------------------------------------------------------------

def _assign_triplanar_uvs(bm: bmesh.types.BMesh, scale: float = 10.0) -> None:
    uv_layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            co = loop.vert.co
            if ax >= ay and ax >= az:
                u, v = co.y, co.z
            elif ay >= ax and ay >= az:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            loop[uv_layer].uv = (u * scale, v * scale)


def add_box(
    bm: bmesh.types.BMesh,
    center_t: tuple[float, float, float],
    size_t: tuple[float, float, float],
    mat_idx: int = 0,
    rot_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
    chamfer: float = 0.0,
) -> None:
    """Create a box in Three.js dimensions (sx, sy, sz), optionally chamfered."""
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    sx, sy, sz = size_t
    # In Blender space: X=sx, Y=sz, Z=sy
    scale_mat = Matrix.Diagonal((sx, sz, sy, 1.0))
    for v in verts:
        v.co = scale_mat @ v.co

    faces = list({f for v in verts for f in v.link_faces})
    if chamfer > 0.0:
        edges = list({e for v in verts for e in v.link_edges})
        bev = bmesh.ops.bevel(bm, geom=edges, offset=chamfer, segments=2, affect="EDGES", clamp_overlap=True)
        faces = [f for f in (set(faces) | set(bev["faces"])) if f.is_valid]
        verts = list({v for f in faces for v in f.verts if v.is_valid})

    # Convert Three.js Euler XYZ to Blender rotation matrix via P * R_t * P^-1
    p_mat = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    r_three = Euler(rot_t, "XYZ").to_matrix().to_4x4()
    r_blender = p_mat @ r_three @ p_mat.inverted()
    trans = Matrix.Translation(v_t2b(center_t))
    xf = trans @ r_blender
    for v in verts:
        v.co = xf @ v.co
    for f in faces:
        if f.is_valid:
            f.material_index = mat_idx


def add_cylinder_x(
    bm: bmesh.types.BMesh,
    center_t: tuple[float, float, float],
    r1: float,
    r2: float,
    length: float,
    segs: int = 24,
    mat_idx: int = 0,
    cap_ends: bool = True,
) -> None:
    """Cylinder aligned along X axis (r1 at -X, r2 at +X)."""
    res = bmesh.ops.create_cone(
        bm,
        cap_ends=cap_ends,
        cap_tris=False,
        segments=segs,
        radius1=r1,
        radius2=r2,
        depth=length,
    )
    verts = res["verts"]
    rot_y = Matrix.Rotation(math.pi / 2.0, 4, "Y")
    trans = Matrix.Translation(v_t2b(center_t))
    xf = trans @ rot_y
    for v in verts:
        v.co = xf @ v.co
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mat_idx


def add_cylinder_axis(
    bm: bmesh.types.BMesh,
    p1_t: tuple[float, float, float],
    p2_t: tuple[float, float, float],
    r1: float,
    r2: float,
    segs: int = 16,
    mat_idx: int = 0,
    cap_ends: bool = True,
) -> None:
    """Cylinder connecting two Three.js points p1_t -> p2_t."""
    v1 = v_t2b(p1_t)
    v2 = v_t2b(p2_t)
    vec = v2 - v1
    dist = vec.length
    if dist < 1e-6:
        return
    mid = (v1 + v2) * 0.5
    quat = Vector((0.0, 0.0, 1.0)).rotation_difference(vec.normalized())
    res = bmesh.ops.create_cone(
        bm,
        cap_ends=cap_ends,
        cap_tris=False,
        segments=segs,
        radius1=r1,
        radius2=r2,
        depth=dist,
    )
    verts = res["verts"]
    xf = Matrix.Translation(mid) @ quat.to_matrix().to_4x4()
    for v in verts:
        v.co = xf @ v.co
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mat_idx


def add_torus_axis(
    bm: bmesh.types.BMesh,
    center_t: tuple[float, float, float],
    axis_t: tuple[float, float, float],
    major_r: float,
    minor_r: float,
    maj_segs: int = 28,
    min_segs: int = 10,
    mat_idx: int = 0,
) -> None:
    """Torus oriented along an arbitrary Three.js axis vector."""
    c_vec = v_t2b(center_t)
    ax = v_t2b(axis_t).normalized()
    ref = Vector((0.0, 0.0, 1.0)) if abs(ax.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    u_vec = ax.cross(ref).normalized()
    v_vec = ax.cross(u_vec).normalized()

    rings: list[list[bmesh.types.BMVert]] = []
    for i in range(maj_segs):
        phi = (2.0 * math.pi * i) / maj_segs
        cp, sp = math.cos(phi), math.sin(phi)
        rad_dir = u_vec * cp + v_vec * sp
        ring: list[bmesh.types.BMVert] = []
        for j in range(min_segs):
            th = (2.0 * math.pi * j) / min_segs
            ct, st = math.cos(th), math.sin(th)
            pt = c_vec + rad_dir * (major_r + minor_r * ct) + ax * (minor_r * st)
            ring.append(bm.verts.new(pt))
        rings.append(ring)

    for i in range(maj_segs):
        r_a = rings[i]
        r_b = rings[(i + 1) % maj_segs]
        for j in range(min_segs):
            jn = (j + 1) % min_segs
            f = bm.faces.new((r_a[j], r_b[j], r_b[jn], r_a[jn]))
            f.material_index = mat_idx


def add_torus_x(
    bm: bmesh.types.BMesh,
    center_t: tuple[float, float, float],
    major_r: float,
    minor_r: float,
    maj_segs: int = 28,
    min_segs: int = 10,
    mat_idx: int = 0,
) -> None:
    """Torus whose symmetry axis is X."""
    add_torus_axis(bm, center_t, (1.0, 0.0, 0.0), major_r, minor_r, maj_segs, min_segs, mat_idx)


def add_lathe_x(
    bm: bmesh.types.BMesh,
    profile_xr: list[tuple[float, float]],
    segs: int = 48,
    mat_idx: int = 0,
    closed_profile: bool = True,
    center_t: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> None:
    """
    Revolve a 2D (x_axial, radius) profile cleanly around the X axis.
    Points with radius <= 1e-6 collapse to a center pole vertex cleanly.
    """
    cx, cy, cz = t2b(*center_t)
    n_prof = len(profile_xr)
    rings: list[list[bmesh.types.BMVert] | bmesh.types.BMVert] = []

    for x_off, rad in profile_xr:
        if rad <= 1e-6:
            rings.append(bm.verts.new((cx + x_off, cy, cz)))
        else:
            ring: list[bmesh.types.BMVert] = []
            for s in range(segs):
                ang = (2.0 * math.pi * s) / segs
                ring.append(bm.verts.new((cx + x_off, cy + rad * math.cos(ang), cz + rad * math.sin(ang))))
            rings.append(ring)

    span = n_prof if closed_profile else n_prof - 1
    for i in range(span):
        a = rings[i]
        b = rings[(i + 1) % n_prof]
        if isinstance(a, bmesh.types.BMVert) and isinstance(b, bmesh.types.BMVert):
            continue
        if isinstance(a, bmesh.types.BMVert):
            for s in range(segs):
                sn = (s + 1) % segs
                f = bm.faces.new((a, b[s], b[sn]))
                f.material_index = mat_idx
        elif isinstance(b, bmesh.types.BMVert):
            for s in range(segs):
                sn = (s + 1) % segs
                f = bm.faces.new((a[s], b, a[sn]))
                f.material_index = mat_idx
        else:
            for s in range(segs):
                sn = (s + 1) % segs
                f = bm.faces.new((a[s], b[s], b[sn], a[sn]))
                f.material_index = mat_idx


def add_tube(
    bm: bmesh.types.BMesh,
    points_t: list[tuple[float, float, float]],
    radius: float,
    segs_ring: int = 12,
    subdiv_per_seg: int = 4,
    mat_idx: int = 0,
    cap_ends: bool = True,
) -> None:
    """Sweep a smooth Catmull-Rom tube through Three.js waypoints."""
    pts = [v_t2b(p) for p in points_t]
    if len(pts) < 2:
        return

    # Catmull-Rom interpolation for smooth hose/pipe bends
    dense: list[Vector] = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[max(0, i - 1)]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[min(n - 1, i + 2)]
        steps = subdiv_per_seg
        for s in range(steps):
            t = s / steps
            t2 = t * t
            t3 = t2 * t
            pt = 0.5 * (
                (2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
            dense.append(pt)
    dense.append(pts[-1])

    rings: list[list[bmesh.types.BMVert]] = []
    # Parallel transport frame
    t0 = (dense[1] - dense[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    n_vec = t0.cross(ref).normalized()
    b_vec = t0.cross(n_vec).normalized()

    for idx, p in enumerate(dense):
        if idx == 0:
            tan = (dense[1] - dense[0]).normalized()
        elif idx == len(dense) - 1:
            tan = (dense[-1] - dense[-2]).normalized()
        else:
            tan = (dense[idx + 1] - dense[idx - 1]).normalized()

        if idx > 0:
            prev_tan = (dense[idx] - dense[idx - 1]).normalized()
            q = prev_tan.rotation_difference(tan)
            n_vec = (q @ n_vec).normalized()
            b_vec = tan.cross(n_vec).normalized()

        ring: list[bmesh.types.BMVert] = []
        for s in range(segs_ring):
            ang = (2.0 * math.pi * s) / segs_ring
            off = (n_vec * math.cos(ang) + b_vec * math.sin(ang)) * radius
            ring.append(bm.verts.new(p + off))
        rings.append(ring)

    for i in range(len(rings) - 1):
        ra = rings[i]
        rb = rings[i + 1]
        for s in range(segs_ring):
            sn = (s + 1) % segs_ring
            f = bm.faces.new((ra[s], rb[s], rb[sn], ra[sn]))
            f.material_index = mat_idx

    if cap_ends:
        f0 = bm.faces.new(list(reversed(rings[0])))
        f0.material_index = mat_idx
        f1 = bm.faces.new(rings[-1])
        f1.material_index = mat_idx


def add_star_or_hex_bolt_x(
    bm: bmesh.types.BMesh,
    center_t: tuple[float, float, float],
    r_outer: float,
    r_inner: float,
    length: float,
    points: int = 6,
    mat_idx: int = 0,
    chamfer: float = 0.0007,
    socket_r: float = 0.0,
    socket_depth: float = 0.0,
) -> None:
    """
    Build a chamfered hex or 12-point spline bolt aligned along X,
    with optional Allen/Torx recessed socket on the +X face.
    """
    cx, cy, cz = t2b(*center_t)
    half_l = length * 0.5
    n_verts = points * 2 if r_inner < r_outer - 1e-6 else points

    def get_r(k: int) -> float:
        if n_verts == points:
            return r_outer
        return r_outer if (k % 2 == 0) else r_inner

    rings_x = [
        (cx - half_l, 0.92),
        (cx - half_l + chamfer, 1.0),
        (cx + half_l - chamfer, 1.0),
        (cx + half_l, 0.90),
    ]
    rings: list[list[bmesh.types.BMVert]] = []
    for x_pos, r_mul in rings_x:
        ring: list[bmesh.types.BMVert] = []
        for k in range(n_verts):
            ang = (2.0 * math.pi * k) / n_verts
            rad = get_r(k) * r_mul
            ring.append(bm.verts.new((x_pos, cy + rad * math.cos(ang), cz + rad * math.sin(ang))))
        rings.append(ring)

    for i in range(len(rings) - 1):
        ra, rb = rings[i], rings[i + 1]
        for k in range(n_verts):
            kn = (k + 1) % n_verts
            f = bm.faces.new((ra[k], rb[k], rb[kn], ra[kn]))
            f.material_index = mat_idx

    # Back cap (-X)
    f_back = bm.faces.new(list(reversed(rings[0])))
    f_back.material_index = mat_idx

    # Front cap (+X) with optional recessed hex socket
    if socket_r > 1e-5 and socket_depth > 1e-5:
        sock_outer: list[bmesh.types.BMVert] = []
        sock_inner: list[bmesh.types.BMVert] = []
        for k in range(6):
            ang = (2.0 * math.pi * k) / 6.0
            yy = cy + socket_r * math.cos(ang)
            zz = cz + socket_r * math.sin(ang)
            sock_outer.append(bm.verts.new((cx + half_l, yy, zz)))
            sock_inner.append(bm.verts.new((cx + half_l - socket_depth, yy * 0.96 + cy * 0.04, zz * 0.96 + cz * 0.04)))

        # Bridge outer rim (n_verts) to 6-sided socket rim
        if n_verts == 6:
            for k in range(6):
                kn = (k + 1) % 6
                f = bm.faces.new((rings[-1][k], sock_outer[k], sock_outer[kn], rings[-1][kn]))
                f.material_index = mat_idx
        else:
            # 12-point outer ring -> 6-point inner ring
            for k in range(6):
                kn = (k + 1) % 6
                k2 = k * 2
                f1 = bm.faces.new((rings[-1][k2], rings[-1][k2 + 1], sock_outer[k]))
                f2 = bm.faces.new((rings[-1][k2 + 1], rings[-1][(k2 + 2) % n_verts], sock_outer[kn], sock_outer[k]))
                f1.material_index = mat_idx
                f2.material_index = mat_idx

        for k in range(6):
            kn = (k + 1) % 6
            f = bm.faces.new((sock_outer[k], sock_inner[k], sock_inner[kn], sock_outer[kn]))
            f.material_index = mat_idx
        f_bot = bm.faces.new(sock_inner)
        f_bot.material_index = mat_idx
    else:
        f_front = bm.faces.new(rings[-1])
        f_front.material_index = mat_idx


def add_holed_washer_lug_x(
    bm: bmesh.types.BMesh,
    center_t: tuple[float, float, float],
    r_outer: float,
    r_bore: float,
    thickness: float,
    segs: int = 24,
    mat_idx: int = 0,
    chamfer: float = 0.0005,
) -> None:
    """Create a real solid ring/lug around X with an actual open cylindrical through-hole."""
    cx, cy, cz = t2b(*center_t)
    ht = thickness * 0.5
    # Closed cross-section profile rotated around center_t
    prof = [
        (cx - ht, r_bore + chamfer),
        (cx - ht + chamfer, r_bore),
        (cx + ht - chamfer, r_bore),
        (cx + ht, r_bore + chamfer),
        (cx + ht, r_outer - chamfer),
        (cx + ht - chamfer, r_outer),
        (cx - ht + chamfer, r_outer),
        (cx - ht, r_outer - chamfer),
    ]
    rings: list[list[bmesh.types.BMVert]] = []
    for px, rad in prof:
        ring: list[bmesh.types.BMVert] = []
        for s in range(segs):
            ang = (2.0 * math.pi * s) / segs
            ring.append(bm.verts.new((px, cy + rad * math.cos(ang), cz + rad * math.sin(ang))))
        rings.append(ring)

    n_prof = len(rings)
    for i in range(n_prof):
        ra = rings[i]
        rb = rings[(i + 1) % n_prof]
        for s in range(segs):
            sn = (s + 1) % segs
            f = bm.faces.new((ra[s], rb[s], rb[sn], ra[sn]))
            f.material_index = mat_idx


def build_6pk_pulley_profile(
    r_pitch: float,
    width: float = 0.025,
    flange_r: float | None = None,
    hub_r: float = 0.016,
    bore_r: float = 0.010,
    web_x: tuple[float, float] = (-0.007, 0.007),
) -> list[tuple[float, float]]:
    """
    Generate an exact closed cross-section (x, radius) profile for a 6-V-groove
    lathe-turned pulley matching EA288Engine.ts's 6PK1025 rib pitch (0.0033 m).
    """
    hw = width * 0.5  # 0.0125
    fl_r = flange_r if flange_r is not None else r_pitch + 0.0030
    peak_r = r_pitch + 0.0017
    root_r = r_pitch - 0.0002
    rim_inner_r = max(hub_r + 0.006, r_pitch - 0.009)

    prof: list[tuple[float, float]] = []
    # Back inner bore & recessed web face (-X)
    prof.append((-hw + 0.001, bore_r))
    prof.append((-hw + 0.001, hub_r))
    prof.append((web_x[0], hub_r))
    prof.append((web_x[0], rim_inner_r))
    prof.append((-hw + 0.0004, rim_inner_r))
    prof.append((-hw, rim_inner_r + 0.0005))

    # -X outer retaining flange with crisp chamfers
    prof.append((-hw, fl_r - 0.0006))
    prof.append((-hw + 0.0005, fl_r))
    prof.append((-0.0106, fl_r))
    prof.append((-0.0099, peak_r))

    # 6 true V-grooves matching ribs at -0.00825 .. +0.00825
    for r in range(6):
        left_x = RIB_START + r * RIB_PITCH
        mid_x = left_x + RIB_PITCH * 0.5
        right_x = left_x + RIB_PITCH
        prof.append((mid_x - 0.00025, root_r))
        prof.append((mid_x + 0.00025, root_r))
        prof.append((right_x - 0.00015, peak_r))
        if r < 5:
            prof.append((right_x + 0.00015, peak_r))

    # +X outer retaining flange
    prof.append((0.0106, fl_r))
    prof.append((hw - 0.0005, fl_r))
    prof.append((hw, fl_r - 0.0006))
    prof.append((hw, rim_inner_r + 0.0005))
    prof.append((hw - 0.0004, rim_inner_r))
    prof.append((web_x[1], rim_inner_r))
    prof.append((web_x[1], hub_r))
    prof.append((hw - 0.001, hub_r))
    prof.append((hw - 0.001, bore_r))

    return prof


def finalize_mesh_obj(
    name: str,
    bm: bmesh.types.BMesh,
    materials: list[bpy.types.Material],
    location_t: tuple[float, float, float],
    parent: bpy.types.Object | None = None,
    add_bevel: bool = False,
    bevel_width: float = 0.0008,
    smooth_angle_deg: float = 38.0,
) -> bpy.types.Object:
    """Convert BMesh to Blender Object with exact identity rot/scale, UVs, and smooth shading."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _assign_triplanar_uvs(bm, scale=12.0)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    for m in materials:
        mesh.materials.append(m)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    obj.location = t2b(*location_t)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)

    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)

    if add_bevel:
        bev = obj.modifiers.new(name="CadBevel", type="BEVEL")
        bev.width = bevel_width
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(36.0)
        bev.use_clamp_overlap = True

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle_deg))
    obj.select_set(False)

    return obj


# ---------------------------------------------------------------------------
# 1. EA288_CoreBlock — Origin t2b(0, 0, 0)
#    Strictly inside X in [-0.42, +0.42], Y in [0.22, 0.76], Z in [-1.62, -1.02]
# ---------------------------------------------------------------------------

def build_core_block(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["sump_alu"],        # 0
        mats["dark_cast_iron"],  # 1
        mats["cast_alu"],        # 2
        mats["polyamide"],       # 3
        mats["stainless"],       # 4
        mats["matte_rubber"],    # 5
        mats["heatshield"],      # 6
        mats["exhaust_iron"],    # 7
        mats["yellow_plastic"],  # 8
        mats["brass"],           # 9
        mats["machined_steel"],  # 10
    ]
    I_SUMP, I_BLOCK, I_ALU, I_POLY, I_SS, I_RUB, I_HS, I_EXH, I_YEL, I_BRASS, I_STEEL = range(11)

    # --- A. Finned Cast-Aluminum Oil Sump & Pan (Y in [0.222, 0.352], X in [-0.30, +0.35]) ---
    add_box(bm, (0.025, 0.320, -1.32), (0.64, 0.062, 0.33), I_SUMP, chamfer=0.006)
    add_box(bm, (0.045, 0.258, -1.32), (0.52, 0.064, 0.28), I_SUMP, chamfer=0.008)
    # 9 longitudinal cooling fins under sump (Y_min >= 0.222)
    for i in range(-4, 5):
        add_box(bm, (0.045, 0.227, -1.32 + i * 0.028), (0.48, 0.010, 0.008), I_SUMP, chamfer=0.001)
    # Sump flange bolt bosses
    for i in range(7):
        bx = -0.26 + i * 0.095
        for bz in (-1.475, -1.165):
            add_cylinder_axis(bm, (bx, 0.340, bz), (bx, 0.356, bz), 0.008, 0.008, 10, I_STEEL)
    # Oil drain plug + plastic oil level sensor
    add_star_or_hex_bolt_x(bm, (0.295, 0.242, -1.19), 0.011, 0.011, 0.012, 6, I_STEEL)
    add_box(bm, (-0.12, 0.242, -1.465), (0.055, 0.028, 0.024), I_POLY, chamfer=0.003)

    # --- B. Ribbed Dark Cast-Iron Cylinder Block (Y in [0.352, 0.575], X in [-0.30, +0.36]) ---
    add_box(bm, (0.030, 0.462, -1.32), (0.66, 0.222, 0.31), I_BLOCK, chamfer=0.008)
    # Cast structural cross ribs + vertical cylinder webbing on front & rear faces
    for c in range(4):
        cx = -0.175 + c * 0.13
        for bz in (-1.478, -1.162):
            add_box(bm, (cx, 0.465, bz), (0.075, 0.18, 0.016), I_BLOCK, chamfer=0.003)
        # Freeze core plugs on front block skirt
        add_cylinder_axis(bm, (cx + 0.035, 0.455, -1.482), (cx + 0.035, 0.455, -1.490), 0.018, 0.018, 16, I_BRASS)
    for hy in (0.405, 0.485, 0.535):
        add_box(bm, (0.030, hy, -1.478), (0.62, 0.012, 0.012), I_BLOCK, chamfer=0.002)

    # Oil filter & cooler module (front-left lower block, Z in [-1.56, -1.47])
    add_box(bm, (-0.17, 0.40, -1.495), (0.13, 0.11, 0.055), I_ALU, chamfer=0.004)
    add_cylinder_axis(bm, (-0.20, 0.38, -1.52), (-0.20, 0.47, -1.555), 0.036, 0.034, 20, I_POLY)
    add_star_or_hex_bolt_x(bm, (-0.20, 0.475, -1.558), 0.014, 0.014, 0.010, 6, I_POLY)

    # --- C. Cast-Aluminum 16V Cylinder Head (Y in [0.575, 0.692], X in [-0.30, +0.365]) ---
    add_box(bm, (0.032, 0.632, -1.32), (0.67, 0.116, 0.34), I_ALU, chamfer=0.006)
    # Cam carrier seam flange + 14 bolt bosses
    add_box(bm, (0.032, 0.688, -1.32), (0.68, 0.016, 0.352), I_ALU, chamfer=0.003)
    for i in range(7):
        bx = -0.27 + i * 0.098
        for bz in (-1.495, -1.145):
            add_cylinder_axis(bm, (bx, 0.682, bz), (bx, 0.702, bz), 0.009, 0.008, 10, I_ALU)
            add_cylinder_axis(bm, (bx, 0.700, bz), (bx, 0.708, bz), 0.0055, 0.0055, 8, I_STEEL)
    # Lifting eye brackets
    add_box(bm, (-0.29, 0.715, -1.21), (0.012, 0.055, 0.038), I_STEEL, chamfer=0.002)
    add_box(bm, (0.33, 0.710, -1.41), (0.012, 0.052, 0.036), I_STEEL, chamfer=0.002)

    # --- D. Black Glass-Fiber Polyamide Valve Cover (Y in [0.694, 0.744]) ---
    add_box(bm, (0.020, 0.718, -1.32), (0.62, 0.048, 0.29), I_POLY, chamfer=0.008)
    # Sculpted acoustic ribs + PCV breather dome + oil filler neck/cap
    for i in range(5):
        add_box(bm, (-0.22 + i * 0.11, 0.743, -1.235), (0.085, 0.008, 0.065), I_POLY, chamfer=0.002)
    add_cylinder_axis(bm, (-0.05, 0.732, -1.23), (-0.05, 0.750, -1.23), 0.034, 0.030, 20, I_POLY)
    add_cylinder_axis(bm, (-0.22, 0.732, -1.42), (-0.22, 0.750, -1.42), 0.028, 0.031, 20, I_POLY)
    add_box(bm, (-0.22, 0.750, -1.42), (0.068, 0.009, 0.014), I_POLY, chamfer=0.002)

    # --- E. Common-Rail Fuel Manifold + 4 Piezo Injectors + Curved HP Lines ---
    # Stainless common rail
    add_cylinder_x(bm, (0.03, 0.736, -1.415), 0.015, 0.015, 0.50, 18, I_SS)
    add_cylinder_x(bm, (-0.235, 0.736, -1.415), 0.012, 0.014, 0.038, 12, I_BRASS)  # Rail pressure sensor
    add_cylinder_x(bm, (0.295, 0.736, -1.415), 0.013, 0.011, 0.035, 12, I_STEEL)   # Regulating valve
    for bx in (-0.16, 0.20):
        add_box(bm, (bx, 0.718, -1.415), (0.022, 0.036, 0.024), I_STEEL, chamfer=0.002)

    # 4 Bosch piezo injectors + curved S-bend stainless HP lines (Y_max <= 0.756)
    for i in range(4):
        ix = -0.175 + i * 0.125
        add_cylinder_axis(bm, (ix, 0.710, -1.32), (ix, 0.746, -1.32), 0.012, 0.014, 14, I_STEEL)
        add_box(bm, (ix, 0.746, -1.32), (0.026, 0.016, 0.034), I_POLY, chamfer=0.003)
        add_cylinder_axis(bm, (ix, 0.748, -1.305), (ix, 0.752, -1.29), 0.004, 0.004, 8, I_BRASS)
        # Curved HP fuel line from rail (Z = -1.415) to injector (Z = -1.32)
        add_tube(
            bm,
            [
                (ix, 0.736, -1.402),
                (ix - 0.012, 0.750, -1.385),
                (ix + 0.008, 0.751, -1.352),
                (ix, 0.744, -1.328),
            ],
            radius=0.0036,
            segs_ring=10,
            subdiv_per_seg=4,
            mat_idx=I_SS,
        )

    # Bosch CP4 High-Pressure Fuel Pump on +X front flank + steel feed tube
    add_box(bm, (0.285, 0.625, -1.43), (0.085, 0.085, 0.078), I_ALU, chamfer=0.005)
    add_cylinder_axis(bm, (0.285, 0.665, -1.43), (0.285, 0.695, -1.43), 0.022, 0.020, 14, I_POLY)
    add_tube(
        bm,
        [(0.285, 0.680, -1.430), (0.295, 0.718, -1.440), (0.265, 0.738, -1.415)],
        radius=0.004,
        segs_ring=10,
        subdiv_per_seg=4,
        mat_idx=I_SS,
    )

    # --- F. Sculpted Intake Plenum + 4 Runners + Intercooler Charge Pipe & Clamps ---
    add_cylinder_x(bm, (0.01, 0.565, -1.555), 0.049, 0.051, 0.54, 22, I_POLY)
    for rx in (-0.18, -0.06, 0.06, 0.18):
        add_torus_x(bm, (rx, 0.565, -1.555), 0.0515, 0.0038, 22, 8, I_POLY)
    for i in range(4):
        ix = -0.175 + i * 0.125
        add_tube(
            bm,
            [(ix, 0.635, -1.475), (ix, 0.618, -1.525), (ix, 0.575, -1.555)],
            radius=0.024,
            segs_ring=14,
            subdiv_per_seg=3,
            mat_idx=I_POLY,
        )
    # Throttle body + EGR housing + charge boost hose + stainless clamps (strictly Z >= -1.615)
    add_cylinder_x(bm, (0.295, 0.565, -1.555), 0.039, 0.039, 0.070, 18, I_ALU)
    add_tube(
        bm,
        [(0.328, 0.565, -1.555), (0.360, 0.495, -1.576), (0.345, 0.375, -1.582), (0.265, 0.310, -1.582)],
        radius=0.024,
        segs_ring=14,
        subdiv_per_seg=4,
        mat_idx=I_RUB,
    )
    add_torus_axis(bm, (0.328, 0.565, -1.555), (1.0, 0.0, 0.0), 0.0255, 0.0028, 20, 6, I_SS)
    add_torus_axis(bm, (0.358, 0.435, -1.580), (-0.015, -0.120, -0.004), 0.0252, 0.0028, 20, 6, I_SS)

    # --- G. Turbocharger + Dimpled Heat Shield (Z = -1.10) + DPF Canister ---
    # Cast exhaust manifold runners
    for i in range(4):
        ix = -0.175 + i * 0.125
        add_tube(bm, [(ix, 0.620, -1.16), (ix * 0.5, 0.585, -1.12), (0.03, 0.555, -1.10)], 0.020, 12, 3, I_EXH)
    # VNT Turbo turbine scroll (bronze/iron) + compressor scroll (cast aluminum)
    add_torus_x(bm, (0.045, 0.525, -1.095), 0.038, 0.024, 22, 12, I_EXH)
    add_cylinder_x(bm, (-0.005, 0.525, -1.095), 0.026, 0.026, 0.048, 16, I_STEEL)
    add_torus_x(bm, (-0.055, 0.525, -1.095), 0.040, 0.025, 22, 12, I_ALU)
    # VNT vacuum actuator pod tucked neatly beside heat shield (X = -0.21, Y = 0.505, Z = -1.085)
    add_cylinder_axis(bm, (-0.215, 0.485, -1.085), (-0.215, 0.528, -1.085), 0.025, 0.023, 16, I_STEEL)
    add_cylinder_axis(bm, (-0.200, 0.505, -1.085), (-0.035, 0.525, -1.085), 0.0035, 0.0035, 8, I_SS)

    # Smooth 9x8 curved dimpled stamped heat shield around Z = -1.10
    hs_pts = [
        (0.660, -1.158),
        (0.658, -1.138),
        (0.652, -1.116),
        (0.640, -1.095),
        (0.625, -1.076),
        (0.606, -1.062),
        (0.585, -1.052),
        (0.562, -1.046),
        (0.540, -1.043),
    ]
    x_hs_vals = [-0.18 + k * (0.42 / 7.0) for k in range(8)]
    hs_grid: list[list[bmesh.types.BMVert]] = []
    for x_hs in x_hs_vals:
        col: list[bmesh.types.BMVert] = []
        for hy, hz in hs_pts:
            col.append(bm.verts.new(t2b(x_hs, hy, hz)))
        hs_grid.append(col)
    hs_faces: list[bmesh.types.BMFace] = []
    for ix in range(len(hs_grid) - 1):
        for iy in range(len(hs_pts) - 1):
            f = bm.faces.new((hs_grid[ix][iy], hs_grid[ix + 1][iy], hs_grid[ix + 1][iy + 1], hs_grid[ix][iy + 1]))
            f.material_index = I_HS
            hs_faces.append(f)
    sol = bmesh.ops.solidify(bm, geom=hs_faces, thickness=0.0035)
    for item in sol["geom"]:
        if isinstance(item, bmesh.types.BMFace) and item.is_valid:
            item.material_index = I_HS
    for btx in (-0.14, 0.19):
        add_cylinder_axis(bm, (btx, 0.654, -1.125), (btx, 0.666, -1.125), 0.006, 0.006, 10, I_STEEL)

    # Close-coupled DPF / DOC Canister + turbo-to-DPF cast transition elbow
    add_tube(bm, [(0.055, 0.540, -1.095), (0.095, 0.542, -1.092), (0.118, 0.515, -1.090)], 0.032, 16, 3, I_EXH)
    add_cylinder_axis(bm, (0.145, 0.365, -1.10), (0.120, 0.510, -1.09), 0.065, 0.065, 24, I_SS)
    add_cylinder_axis(bm, (0.120, 0.510, -1.09), (0.108, 0.545, -1.092), 0.065, 0.034, 22, I_SS)
    add_cylinder_axis(bm, (0.145, 0.365, -1.10), (0.160, 0.315, -1.105), 0.065, 0.028, 22, I_SS)
    add_torus_axis(bm, (0.132, 0.440, -1.095), (-0.025, 0.145, 0.010), 0.066, 0.0038, 24, 8, I_STEEL)
    # Exhaust gas temp / lambda sensor boss (safely inside Z <= -1.03)
    add_cylinder_axis(bm, (0.125, 0.50, -1.055), (0.125, 0.52, -1.032), 0.007, 0.007, 10, I_SS)

    # --- H. Black Ribbed Timing-Belt Cover (X = 0.398 cam bulge, lower X <= 0.410 clear of tensioner arm!) ---
    add_cylinder_x(bm, (0.397, 0.642, -1.30), 0.074, 0.070, 0.034, 28, I_POLY)
    add_box(bm, (0.390, 0.485, -1.292), (0.036, 0.290, 0.122), I_POLY, chamfer=0.008)
    add_cylinder_x(bm, (0.390, 0.340, -1.270), 0.064, 0.060, 0.036, 26, I_POLY)
    for ry in (0.41, 0.46, 0.51, 0.56):
        add_box(bm, (0.408, ry, -1.292), (0.004, 0.008, 0.104), I_POLY, chamfer=0.001)
    add_box(bm, (0.414, 0.642, -1.300), (0.004, 0.010, 0.102), I_POLY, chamfer=0.001)
    for cz in (-1.345, -1.238):
        add_box(bm, (0.398, 0.52, cz), (0.014, 0.020, 0.009), I_STEEL, chamfer=0.001)

    # --- I. Sculpted Stepped Cast-Aluminum Accessory Mounting Bracket (X = 0.388, zero z-fighting) ---
    add_box(bm, (0.372, 0.468, -1.435), (0.024, 0.235, 0.145), I_ALU, chamfer=0.005)
    add_box(bm, (0.382, 0.468, -1.438), (0.012, 0.180, 0.095), I_ALU, chamfer=0.003)
    # Clean cylindrical mounting bosses at distinct stepped X planes behind A/C, Alternator & Tensioner
    add_cylinder_x(bm, (0.382, 0.355, -1.485), 0.044, 0.042, 0.024, 22, I_ALU)
    add_cylinder_x(bm, (0.382, 0.585, -1.445), 0.046, 0.044, 0.024, 22, I_ALU)
    add_cylinder_x(bm, (0.385, 0.545, -1.379), 0.032, 0.032, 0.018, 22, I_ALU)

    # --- J. Yellow Oil Dipstick Handle & Guide Tube ---
    add_cylinder_axis(bm, (-0.04, 0.44, -1.505), (-0.04, 0.715, -1.525), 0.005, 0.005, 10, I_POLY)
    add_torus_axis(bm, (-0.04, 0.733, -1.527), (0.0, 0.0, 1.0), 0.014, 0.0040, 20, 8, I_YEL)

    # --- K. Gearbox Bellhousing (X in [-0.418, -0.295], strictly X >= -0.42 & X < -0.32!) ---
    add_cylinder_x(bm, (-0.348, 0.425, -1.32), 0.115, 0.145, 0.105, 22, I_ALU)
    add_cylinder_x(bm, (-0.398, 0.425, -1.32), 0.088, 0.112, 0.036, 20, I_ALU)
    for k in range(6):
        ang = (k * math.pi) / 3.0
        ry = 0.425 + 0.125 * math.sin(ang)
        rz = -1.32 + 0.125 * math.cos(ang)
        add_box(bm, (-0.345, ry, rz), (0.095, 0.012, 0.012), I_ALU, chamfer=0.001)
    # Front-mounted starter motor attached to bellhousing
    add_cylinder_x(bm, (-0.355, 0.355, -1.475), 0.038, 0.038, 0.12, 16, I_BLOCK)
    add_cylinder_x(bm, (-0.355, 0.402, -1.495), 0.020, 0.020, 0.085, 14, I_STEEL)

    return finalize_mesh_obj(
        "EA288_CoreBlock",
        bm,
        mat_list,
        (0.0, 0.0, 0.0),
        add_bevel=False,
        smooth_angle_deg=38.0,
    )


# ---------------------------------------------------------------------------
# 2 & 3. EA288_PulleyCrank & EA288_CrankBolt
# ---------------------------------------------------------------------------

def build_crank_pulley(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["dark_pulley_steel"],  # 0
        mats["damper_rubber"],      # 1
        mats["machined_steel"],     # 2
        mats["yellow_plastic"],     # 3
    ]

    # True lathe-profiled 6-V-groove outer inertia ring (R=0.080, width=0.025)
    # Inner steel core stopped at R=0.068 so elastomer damper fills R in [0.050, 0.068]
    hw = 0.0125
    fl_r = 0.0830
    peak_r = 0.0817
    root_r = 0.0798
    rim_in = 0.067

    outer_prof = [
        (-hw + 0.001, rim_in),
        (-hw, rim_in + 0.001),
        (-hw, fl_r - 0.0006),
        (-hw + 0.0005, fl_r),
        (-0.0106, fl_r),
        (-0.0099, peak_r),
    ]
    for r in range(6):
        left_x = RIB_START + r * RIB_PITCH
        mid_x = left_x + RIB_PITCH * 0.5
        right_x = left_x + RIB_PITCH
        outer_prof.append((mid_x - 0.00025, root_r))
        outer_prof.append((mid_x + 0.00025, root_r))
        outer_prof.append((right_x - 0.00015, peak_r))
        if r < 5:
            outer_prof.append((right_x + 0.00015, peak_r))
    outer_prof.extend([
        (0.0106, fl_r),
        (hw - 0.0005, fl_r),
        (hw, fl_r - 0.0006),
        (hw, rim_in + 0.001),
        (hw - 0.001, rim_in),
    ])
    add_lathe_x(bm, outer_prof, segs=64, mat_idx=0)

    # Vulcanized black elastomeric harmonic vibration damper ring (R in [0.049, 0.0675])
    elast_prof = [
        (-0.010, 0.0495),
        (-0.010, 0.0672),
        (0.0108, 0.0672),
        (0.0118, 0.0655),
        (0.0118, 0.0510),
        (0.0108, 0.0495),
    ]
    add_lathe_x(bm, elast_prof, segs=56, mat_idx=1)

    # Chamfered central steel hub with recessed bolt pocket
    hub_prof = [
        (-0.012, 0.012),
        (-0.012, 0.0498),
        (0.0135, 0.0498),
        (0.0145, 0.0480),
        (0.0145, 0.0405),
        (0.0115, 0.0390),
        (0.0115, 0.0210),
        (0.0140, 0.0195),
        (0.0140, 0.012),
    ]
    add_lathe_x(bm, hub_prof, segs=48, mat_idx=0)

    # 4 recessed Allen socket bolts at R = 0.032 m
    for i in range(4):
        ang = (i * math.pi) / 2.0 + math.pi / 4.0
        by = math.sin(ang) * 0.032
        bz = -math.cos(ang) * 0.032
        add_cylinder_x(bm, (0.0142, by, bz), 0.0062, 0.0058, 0.0055, 16, mat_idx=2)
        add_star_or_hex_bolt_x(
            bm, (0.0155, by, bz), 0.0058, 0.0058, 0.004,
            points=12, mat_idx=2, chamfer=0.0004, socket_r=0.0032, socket_depth=0.0025
        )

    # Subtle yellow TDC index mark at top edge of outer flange/damper
    add_box(bm, (0.0124, 0.074, 0.0), (0.0022, 0.010, 0.0036), mat_idx=3, chamfer=0.0)

    return finalize_mesh_obj("EA288_PulleyCrank", bm, mat_list, CRANK_POS, add_bevel=False, smooth_angle_deg=35.0)


def build_crank_bolt(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["machined_steel"],    # 0
        mats["blue_torque_seal"],  # 1
    ]

    # Chamfered integrated flange washer (X_local in [0.0145, 0.0195])
    washer_prof = [
        (0.0145, 0.007),
        (0.0145, 0.0205),
        (0.0175, 0.0205),
        (0.0195, 0.0185),
        (0.0195, 0.007),
    ]
    add_lathe_x(bm, washer_prof, segs=36, mat_idx=0)

    # True 12-point spline bolt head (X_local in [0.0195, 0.0320])
    add_star_or_hex_bolt_x(
        bm, (0.02575, 0.0, 0.0),
        r_outer=0.0145, r_inner=0.0124, length=0.0125,
        points=12, mat_idx=0, chamfer=0.0010, socket_r=0.0045, socket_depth=0.0020
    )

    # Blue factory torque-seal stripe cleanly painted across washer flange & spline head
    add_box(bm, (0.0258, 0.0138, 0.0), (0.0110, 0.0020, 0.0032), mat_idx=1, chamfer=0.0)
    add_box(bm, (0.0196, 0.0168, 0.0), (0.0018, 0.0066, 0.0032), mat_idx=1, chamfer=0.0)
    add_box(bm, (0.0322, 0.0096, 0.0), (0.0012, 0.0086, 0.0032), mat_idx=1, chamfer=0.0)

    return finalize_mesh_obj("EA288_CrankBolt", bm, mat_list, CRANK_POS, add_bevel=False, smooth_angle_deg=35.0)


# ---------------------------------------------------------------------------
# 4 & 5. EA288_ACBody & EA288_PulleyAC
# ---------------------------------------------------------------------------

def build_ac_body(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["cast_alu"],        # 0
        mats["machined_steel"],  # 1
        mats["polyamide"],       # 2
        mats["dark_cast_iron"],  # 3
    ]

    # Main die-cast Sanden/Denso cylindrical compressor body (X_local <= -0.025)
    body_prof = [
        (-0.195, 0.0),
        (-0.195, 0.044),
        (-0.188, 0.054),
        (-0.155, 0.056),
        (-0.055, 0.058),
        (-0.045, 0.054),
        (-0.045, 0.042),  # Electromagnetic clutch coil neck
        (-0.026, 0.042),
        (-0.026, 0.0),
    ]
    add_lathe_x(bm, body_prof, segs=36, mat_idx=0)

    # 5 cast radial cooling ribs around compressor barrel
    for rx in (-0.168, -0.140, -0.112, -0.084, -0.056):
        add_torus_x(bm, (rx, 0.0, 0.0), 0.058, 0.0032, 28, 8, mat_idx=0)

    # 4 perimeter through-case tie bolts + top/bottom mounting ears toward accessory bracket
    for i in range(4):
        ang = (i * math.pi) / 2.0 + math.pi / 4.0
        by = math.sin(ang) * 0.058
        bz = -math.cos(ang) * 0.058
        add_cylinder_x(bm, (-0.12, by, bz), 0.0045, 0.0045, 0.135, 10, mat_idx=1)
        add_star_or_hex_bolt_x(bm, (-0.188, by, bz), 0.007, 0.007, 0.008, 6, mat_idx=1)

    for ey in (-0.052, 0.052):
        add_box(bm, (-0.098, ey, 0.038), (0.088, 0.020, 0.038), mat_idx=0, chamfer=0.0025)
        add_cylinder_axis(bm, (-0.085, ey, 0.048), (-0.085, ey, 0.064), 0.006, 0.006, 8, mat_idx=1)

    # Rear refrigerant suction/discharge manifold block + 2 curved aluminum A/C pipes
    add_box(bm, (-0.155, 0.062, 0.0), (0.044, 0.020, 0.052), mat_idx=0, chamfer=0.003)
    add_cylinder_axis(bm, (-0.155, 0.072, 0.0), (-0.155, 0.078, 0.0), 0.006, 0.006, 8, mat_idx=1)
    # Suction & discharge aluminum lines with block fittings sweeping cleanly inboard
    for pz, rad in ((0.014, 0.0085), (-0.014, 0.0068)):
        add_cylinder_axis(bm, (-0.155, 0.070, pz), (-0.155, 0.084, pz), rad * 1.35, rad * 1.35, 14, mat_idx=0)
    add_tube(
        bm,
        [(-0.145, 0.080, 0.014), (-0.155, 0.112, 0.018), (-0.195, 0.122, -0.010), (-0.235, 0.115, -0.045)],
        radius=0.0082, segs_ring=12, subdiv_per_seg=4, mat_idx=1
    )
    add_tube(
        bm,
        [(-0.165, 0.080, -0.014), (-0.175, 0.108, -0.025), (-0.210, 0.110, -0.055), (-0.245, 0.095, -0.082)],
        radius=0.0066, segs_ring=12, subdiv_per_seg=4, mat_idx=1
    )

    # Electrical clutch coil pigtail & molded connector tucked along top-rear of coil neck
    add_box(bm, (-0.040, 0.042, 0.012), (0.016, 0.012, 0.014), mat_idx=2, chamfer=0.002)
    add_tube(
        bm,
        [(-0.040, 0.046, 0.012), (-0.058, 0.056, 0.024), (-0.098, 0.054, 0.036)],
        radius=0.0025, segs_ring=8, subdiv_per_seg=3, mat_idx=3
    )

    return finalize_mesh_obj("EA288_ACBody", bm, mat_list, AC_POS, add_bevel=False, smooth_angle_deg=38.0)


def build_ac_pulley(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["dark_pulley_steel"],  # 0
        mats["machined_steel"],     # 1
        mats["dark_cast_iron"],     # 2
    ]

    # Lathe-profiled 6-V-groove A/C pulley (R=0.062, centered at X_local=0)
    prof = build_6pk_pulley_profile(r_pitch=0.062, width=0.025, flange_r=0.0650, hub_r=0.018, bore_r=0.008, web_x=(-0.004, 0.005))
    add_lathe_x(bm, prof, segs=56, mat_idx=0)

    # Beveled electromagnetic clutch pressure plate (X_local in [0.0135, 0.0188])
    clutch_prof = [
        (0.0135, 0.016),
        (0.0135, 0.0485),
        (0.0170, 0.0485),
        (0.0188, 0.0462),
        (0.0188, 0.016),
    ]
    add_lathe_x(bm, clutch_prof, segs=44, mat_idx=1)

    # Tri-lobe spring straps + rivet heads + central hub boss
    add_cylinder_x(bm, (0.0195, 0.0, 0.0), 0.017, 0.016, 0.005, 24, mat_idx=0)
    for i in range(3):
        ang = (i * math.pi * 2.0) / 3.0
        # Leaf spring strap bridging from hub to outer pressure plate
        cy = math.sin(ang) * 0.028
        cz = -math.cos(ang) * 0.028
        add_box(bm, (0.0202, cy, cz), (0.0024, 0.014, 0.034), mat_idx=0, rot_t=(ang, 0.0, 0.0), chamfer=0.0004)
        # Rivet pin on outer plate
        ry = math.sin(ang + 0.45) * 0.039
        rz = -math.cos(ang + 0.45) * 0.039
        add_cylinder_x(bm, (0.0205, ry, rz), 0.0038, 0.0032, 0.004, 12, mat_idx=1)

    # Center hex locknut + shaft tip
    add_star_or_hex_bolt_x(bm, (0.0238, 0.0, 0.0), 0.0108, 0.0108, 0.0075, 6, mat_idx=1, chamfer=0.0007)
    add_cylinder_x(bm, (0.0285, 0.0, 0.0), 0.0052, 0.0048, 0.004, 14, mat_idx=2)

    return finalize_mesh_obj("EA288_PulleyAC", bm, mat_list, AC_POS, add_bevel=False, smooth_angle_deg=35.0)


# ---------------------------------------------------------------------------
# 6 & 7. EA288_AlternatorBody & EA288_PulleyAlternator
# ---------------------------------------------------------------------------

def build_alternator_body(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["cast_alu"],   # 0
        mats["copper"],     # 1
        mats["polyamide"],  # 2
        mats["brass"],      # 3
        mats["machined_steel"],  # 4
    ]

    # Front vented die-cast aluminum housing (X_local in [-0.090, -0.034])
    front_prof = [
        (-0.090, 0.048),
        (-0.090, 0.065),
        (-0.056, 0.065),
        (-0.046, 0.056),
        (-0.036, 0.044),
        (-0.034, 0.022),
        (-0.055, 0.022),
        (-0.055, 0.048),
    ]
    add_lathe_x(bm, front_prof, segs=36, mat_idx=0)

    # Rear aluminum stator housing ring (X_local in [-0.142, -0.116])
    rear_alu_prof = [
        (-0.142, 0.050),
        (-0.142, 0.065),
        (-0.116, 0.065),
        (-0.116, 0.050),
    ]
    add_lathe_x(bm, rear_alu_prof, segs=36, mat_idx=0)

    # Lacquered copper stator windings clearly visible through cooling slots!
    add_cylinder_x(bm, (-0.103, 0.0, 0.0), 0.0555, 0.0555, 0.034, 32, mat_idx=1)
    # Individual copper coil loops on outer stator crown
    for i in range(24):
        ang = (2.0 * math.pi * i) / 24.0
        cy = math.sin(ang) * 0.0565
        cz = -math.cos(ang) * 0.0565
        add_box(bm, (-0.103, cy, cz), (0.028, 0.006, 0.008), mat_idx=1, rot_t=(ang, 0.0, 0.0), chamfer=0.001)

    # 6 axial cast-aluminum clamping struts bridging over the copper stator
    for i in range(6):
        ang = (i * math.pi) / 3.0 + math.pi / 6.0
        sy = math.sin(ang) * 0.0625
        sz = -math.cos(ang) * 0.0625
        add_box(bm, (-0.103, sy, sz), (0.034, 0.011, 0.013), mat_idx=0, rot_t=(ang, 0.0, 0.0), chamfer=0.0015)

    # Front radial cooling fin ribs on alternator face
    for i in range(8):
        ang = (2.0 * math.pi * i) / 8.0
        fy = math.sin(ang) * 0.046
        fz = -math.cos(ang) * 0.046
        add_box(bm, (-0.037, fy, fz), (0.006, 0.022, 0.006), mat_idx=0, rot_t=(ang, 0.0, 0.0), chamfer=0.001)

    # Mounting lugs tying into engine accessory bracket (X = 0.388, Z = -1.40)
    add_box(bm, (-0.090, -0.066, 0.025), (0.088, 0.032, 0.038), mat_idx=0, chamfer=0.003)
    add_box(bm, (-0.090, 0.048, 0.052), (0.082, 0.028, 0.032), mat_idx=0, chamfer=0.003)
    add_star_or_hex_bolt_x(bm, (-0.044, -0.070, 0.028), 0.007, 0.007, 0.008, 6, mat_idx=4)
    add_star_or_hex_bolt_x(bm, (-0.046, 0.052, 0.055), 0.007, 0.007, 0.008, 6, mat_idx=4)

    # Black rear regulator cover + B+ terminal stud + LIN connector socket
    rear_cap_prof = [
        (-0.172, 0.0),
        (-0.172, 0.052),
        (-0.165, 0.060),
        (-0.140, 0.061),
        (-0.140, 0.0),
    ]
    add_lathe_x(bm, rear_cap_prof, segs=32, mat_idx=2)
    # B+ brass terminal stud + nut + regulator plug
    add_cylinder_x(bm, (-0.178, 0.024, 0.018), 0.0045, 0.0045, 0.018, 12, mat_idx=3)
    add_star_or_hex_bolt_x(bm, (-0.176, 0.024, 0.018), 0.0075, 0.0075, 0.005, 6, mat_idx=4)
    add_box(bm, (-0.168, -0.022, 0.022), (0.020, 0.022, 0.024), mat_idx=2, chamfer=0.002)

    return finalize_mesh_obj("EA288_AlternatorBody", bm, mat_list, ALT_POS, add_bevel=False, smooth_angle_deg=38.0)


def build_alternator_pulley(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["machined_steel"],  # 0
        mats["polyamide"],       # 1
        mats["stainless"],       # 2
    ]

    # Lathe-profiled 6-V-groove OAP (R=0.036, centered at X_local=0)
    prof = build_6pk_pulley_profile(r_pitch=0.036, width=0.025, flange_r=0.0390, hub_r=0.019, bore_r=0.010, web_x=(-0.006, 0.008))
    add_lathe_x(bm, prof, segs=48, mat_idx=0)
    # Rear OAP spacer collar bridging to alternator shaft
    add_cylinder_x(bm, (-0.019, 0.0, 0.0), 0.016, 0.018, 0.014, 24, mat_idx=0)

    # Serrated black dust cap on front (+X)
    add_cylinder_x(bm, (0.0148, 0.0, 0.0), 0.0215, 0.0205, 0.0065, 24, mat_idx=1)
    for i in range(18):
        ang = (2.0 * math.pi * i) / 18.0
        sy = math.sin(ang) * 0.0212
        sz = -math.cos(ang) * 0.0212
        add_box(bm, (0.0150, sy, sz), (0.0055, 0.0018, 0.0024), mat_idx=1, rot_t=(ang, 0.0, 0.0))

    # Silver spin index dot for crystal-clear OAP rotation feedback
    add_cylinder_x(bm, (0.0182, 0.0145, 0.0), 0.0032, 0.0030, 0.0022, 12, mat_idx=2)

    return finalize_mesh_obj("EA288_PulleyAlternator", bm, mat_list, ALT_POS, add_bevel=False, smooth_angle_deg=35.0)


# ---------------------------------------------------------------------------
# 8, 9, 10, 11, 12, 13, 14. Spannrolle 04L 903 315 + T10060A Pin
# ---------------------------------------------------------------------------

def build_tensioner_housing(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["Tensioner_Old"],      # 0
        mats["Tensioner_PinRing"],  # 1
    ]

    # Stationary spring drum centered at X_local = -0.032 (X_world = 0.408)
    drum_prof = [
        (-0.045, 0.008),
        (-0.045, 0.0285),
        (-0.043, 0.0305),
        (-0.022, 0.0305),
        (-0.020, 0.0285),
        (-0.020, 0.0215),
        (-0.017, 0.0215),
        (-0.017, 0.008),
    ]
    add_lathe_x(bm, drum_prof, segs=36, mat_idx=0)

    # Rear anti-rotation locating pin boss engaging accessory bracket
    add_cylinder_x(bm, (-0.048, 0.020, 0.0), 0.0045, 0.0050, 0.007, 12, mat_idx=0)

    # Stationary cast backplate flange extending to the 4mm alignment bore at (r=0.042, -195 deg)
    u_stat = PIN_ARM_RADIUS * math.cos(PIN_STAT_ANGLE)
    v_stat = PIN_ARM_RADIUS * math.sin(PIN_STAT_ANGLE)

    # Flange bridge arm from spring cup (r=0.022) out to lug (r=0.042) at angle -195 deg
    u_mid = u_stat * 0.52
    v_mid = v_stat * 0.52
    add_box(bm, (-0.032, v_mid, -u_mid), (0.0095, 0.017, 0.042), mat_idx=0, rot_t=(PIN_STAT_ANGLE, 0.0, 0.0), chamfer=0.0012)

    # Real open 4mm alignment bore through stationary ear at t2b(-0.032, v_stat, -u_stat)
    add_holed_washer_lug_x(bm, (-0.032, v_stat, -u_stat), r_outer=0.0088, r_bore=0.0025, thickness=0.010, segs=24, mat_idx=0, chamfer=0.0005)
    # Subtle chamfer collar ring around front lip for crisp alignment highlight
    add_holed_washer_lug_x(bm, (-0.0268, v_stat, -u_stat), r_outer=0.0052, r_bore=0.0025, thickness=0.0014, segs=24, mat_idx=1, chamfer=0.0003)

    return finalize_mesh_obj("EA288_TensionerHousing", bm, mat_list, TENS_PIVOT, add_bevel=False, smooth_angle_deg=38.0)


def build_tensioner_bolt(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [mats["Tensioner_Bolt"]]

    # Flanged M10 mounting bolt protruding cleanly at X_local = -0.014
    flange_prof = [
        (-0.021, 0.005),
        (-0.021, 0.0128),
        (-0.0175, 0.0128),
        (-0.0165, 0.0112),
        (-0.0165, 0.005),
    ]
    add_lathe_x(bm, flange_prof, segs=28, mat_idx=0)
    add_star_or_hex_bolt_x(
        bm, (-0.0125, 0.0, 0.0),
        r_outer=0.0092, r_inner=0.0092, length=0.0090,
        points=6, mat_idx=0, chamfer=0.0008, socket_r=0.0035, socket_depth=0.0015
    )

    return finalize_mesh_obj("EA288_TensionerBolt", bm, mat_list, TENS_PIVOT, add_bevel=False, smooth_angle_deg=35.0)


def build_tensioner_arm(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    Organic beveled cast-aluminum swing arm built at angle = 0 extending along
    +u_local (-Z_three / +Y_blender) of length L = 0.085 at X_local = -0.021.
    Single material (Tensioner_Old) so GLTF keeps it clean with 3 child nodes.
    """
    bm = bmesh.new()
    mat_list = [mats["Tensioner_Old"]]

    # Pivot hub ring surrounding M10 bolt at (0,0), X_local = -0.021 (stepped outside bolt flange!)
    add_holed_washer_lug_x(bm, (-0.021, 0.0, 0.0), r_outer=0.023, r_bore=0.0135, thickness=0.013, segs=32, mat_idx=0, chamfer=0.0012)

    # Tapered organic cast-aluminum swing arm body from pivot (u=0.012) to roller axle (u=0.085)
    # Build smooth lofted rectangular-chamfered beam with raised top/bottom stiffening flanges
    u_samples = [0.012, 0.032, 0.056, 0.076, 0.085]
    half_heights = [0.0185, 0.0165, 0.0150, 0.0145, 0.0140]
    half_thicks = [0.0062, 0.0056, 0.0054, 0.0058, 0.0062]

    sections: list[list[bmesh.types.BMVert]] = []
    for u, hh, ht in zip(u_samples, half_heights, half_thicks):
        ch = 0.0014
        ring_pts = [
            (-0.021 - ht + ch, +hh),
            (-0.021 + ht - ch, +hh),
            (-0.021 + ht, +hh - ch),
            (-0.021 + ht, -hh + ch),
            (-0.021 + ht - ch, -hh),
            (-0.021 - ht + ch, -hh),
            (-0.021 - ht, -hh + ch),
            (-0.021 - ht, +hh - ch),
        ]
        # t2b(x, v, -u) = (x, u, v)
        sections.append([bm.verts.new((px, u, pv)) for px, pv in ring_pts])

    for i in range(len(sections) - 1):
        ra, rb = sections[i], sections[i + 1]
        n_r = len(ra)
        for k in range(n_r):
            kn = (k + 1) % n_r
            f = bm.faces.new((ra[k], rb[k], rb[kn], ra[kn]))
            f.material_index = 0
    bm.faces.new(list(reversed(sections[0]))).material_index = 0
    bm.faces.new(sections[-1]).material_index = 0

    # Top & bottom cast stiffening ribs along arm flank
    for sgn in (-1.0, 1.0):
        add_box(bm, (-0.018, sgn * 0.0135, -0.048), (0.008, 0.0045, 0.054), mat_idx=0, chamfer=0.0008)

    # Roller mounting axle boss at tip t2b(-0.021, 0, -0.085) stepping to bearing bore (-0.012)
    add_cylinder_x(bm, (-0.0195, 0.0, -0.085), 0.018, 0.016, 0.014, 28, mat_idx=0)
    add_cylinder_x(bm, (-0.008, 0.0, -0.085), 0.011, 0.010, 0.012, 20, mat_idx=0)

    return finalize_mesh_obj("EA288_TensionerArm", bm, mat_list, TENS_PIVOT, add_bevel=False, smooth_angle_deg=38.0)


def build_tensioner_roller(mats: dict[str, bpy.types.Material], arm_obj: bpy.types.Object) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["Tensioner_Roller"],      # 0
        mats["Tensioner_BearingCap"],  # 1
    ]

    # Smooth flanged machined-steel roller (R=0.034, belt track width=0.024, outer flanges R=0.0372)
    # Keep total X extent within [-0.0136, +0.0136] so hex lug at +0.014..+0.025 stays cleanly clear!
    roller_prof = [
        (-0.0135, 0.018),
        (-0.0135, 0.0368),
        (-0.0130, 0.0372),
        (-0.0118, 0.0372),
        (-0.0114, 0.0340),
        (+0.0114, 0.0340),
        (+0.0118, 0.0372),
        (+0.0130, 0.0372),
        (+0.0135, 0.0368),
        (+0.0135, 0.018),
        (+0.0095, 0.018),
        (+0.0095, 0.028),
        (-0.0095, 0.028),
        (-0.0095, 0.018),
    ]
    add_lathe_x(bm, roller_prof, segs=48, mat_idx=0)

    # Dark sealed 6203 ball bearing dust cap + inner seal ring
    cap_prof = [
        (-0.0135, 0.0),
        (-0.0135, 0.0182),
        (+0.0135, 0.0182),
        (+0.0135, 0.0),
    ]
    add_lathe_x(bm, cap_prof, segs=32, mat_idx=1)

    # 3 silver rotation indicator dots on +X dust cap face
    for i in range(3):
        ang = (i * 2.0 * math.pi) / 3.0
        dy = math.sin(ang) * 0.0115
        dz = -math.cos(ang) * 0.0115
        add_cylinder_x(bm, (0.0138, dy, dz), 0.0024, 0.0022, 0.0016, 12, mat_idx=0)

    loc_t = uv_offset_t(TENS_ARM_LEN, 0.0, 0.0)
    return finalize_mesh_obj("EA288_TensionerRoller", bm, mat_list, loc_t, parent=arm_obj, add_bevel=False, smooth_angle_deg=35.0)


def build_tensioner_hex(mats: dict[str, bpy.types.Material], arm_obj: bpy.types.Object) -> bpy.types.Object:
    """
    Prominent cast 16mm hex boss at local origin t2b(0.008, 0.066*sin(-12), -0.066*cos(-12)).
    Hex head sits cleanly at x_hex in [+0.0058, +0.0170] (X_arm in [+0.0138, +0.025])
    completely clear of roller flange (+0.0135) while matching SW 16 wrench ring (x_hex=+0.008).
    Structural cast bridge curves radially inward (-u) around the roller flange down to arm at X_arm=-0.021!
    """
    bm = bmesh.new()
    mat_list = [mats["Tensioner_Old"]]

    # 16mm AF hex boss (circumradius ~0.0096 -> 16.6mm AF, crisp inside wrench ringInner=0.0115)
    add_star_or_hex_bolt_x(
        bm, (0.0115, 0.0, 0.0),
        r_outer=0.0098, r_inner=0.0098, length=0.0115,
        points=6, mat_idx=0, chamfer=0.0009, socket_r=0.0036, socket_depth=0.0014
    )
    # Cast shoulder flange behind hex boss (still X_arm >= +0.0138, clear of roller!)
    add_cylinder_x(bm, (0.0068, 0.0, 0.0), 0.0125, 0.0115, 0.0022, 20, mat_idx=0)

    # Sculpted chamfered cast-aluminum structural web clearing roller flange (r_from_roller >= 0.039)
    # Lofted sections from hex shoulder (z_three=0) inward (-u = +z_three) and back (-x) into arm beam
    web_specs = [
        (0.0068, 0.000, 0.000, 0.0022, 0.0090),
        (0.0068, 0.001, 0.014, 0.0030, 0.0082),
        (0.0020, 0.004, 0.025, 0.0042, 0.0076),
        (-0.0130, 0.008, 0.027, 0.0048, 0.0072),
        (-0.0290, 0.012, 0.028, 0.0052, 0.0085),
    ]
    web_rings: list[list[bmesh.types.BMVert]] = []
    for wx, wy, wz, hx, hy in web_specs:
        ch = 0.0009
        pts_xy = [
            (wx - hx + ch, wy + hy),
            (wx + hx - ch, wy + hy),
            (wx + hx, wy + hy - ch),
            (wx + hx, wy - hy + ch),
            (wx + hx - ch, wy - hy),
            (wx - hx + ch, wy - hy),
            (wx - hx, wy - hy + ch),
            (wx - hx, wy + hy - ch),
        ]
        # Convert Three.js (px, py, wz) -> Blender (px, -wz, py)
        web_rings.append([bm.verts.new((px, -wz, py)) for px, py in pts_xy])
    for i in range(len(web_rings) - 1):
        ra, rb = web_rings[i], web_rings[i + 1]
        for k in range(len(ra)):
            kn = (k + 1) % len(ra)
            bm.faces.new((ra[k], rb[k], rb[kn], ra[kn])).material_index = 0
    bm.faces.new(list(reversed(web_rings[0]))).material_index = 0
    bm.faces.new(web_rings[-1]).material_index = 0

    hex_u = HEX_ARM_RADIUS * math.cos(HEX_ARM_ANGLE)
    hex_v = HEX_ARM_RADIUS * math.sin(HEX_ARM_ANGLE)
    loc_t = uv_offset_t(hex_u, hex_v, 0.008)
    return finalize_mesh_obj("EA288_TensionerHex", bm, mat_list, loc_t, parent=arm_obj, add_bevel=False, smooth_angle_deg=38.0)


def build_tensioner_pin_hole(mats: dict[str, bpy.types.Material], arm_obj: bpy.types.Object) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["Tensioner_Old"],      # 0
        mats["Tensioner_PinRing"],  # 1
    ]

    # Cast ear with real chamfered 4mm/5mm open bore (r_bore = 0.0025 m)
    add_holed_washer_lug_x(bm, (0.0, 0.0, 0.0), r_outer=0.0086, r_bore=0.0025, thickness=0.010, segs=24, mat_idx=0, chamfer=0.0005)
    # Subtle chamfer collar ring on +X face for alignment highlight
    add_holed_washer_lug_x(bm, (0.0052, 0.0, 0.0), r_outer=0.0050, r_bore=0.0025, thickness=0.0014, segs=24, mat_idx=1, chamfer=0.0003)

    # Structural cast web tab connecting ear cleanly back toward arm pivot/beam
    # Relative to pin_hole at (u=0.0344, v=-0.0241), pivot is at (-0.0344, +0.0241), arm centerline at (0, +0.0241).
    add_tube(
        bm,
        [(-0.001, 0.005, 0.0), (-0.001, 0.014, 0.006), (-0.001, 0.024, 0.012)],
        radius=0.0048,
        segs_ring=10,
        subdiv_per_seg=2,
        mat_idx=0,
    )

    pin_u = PIN_ARM_RADIUS * math.cos(PIN_ARM_ANGLE)
    pin_v = PIN_ARM_RADIUS * math.sin(PIN_ARM_ANGLE)
    loc_t = uv_offset_t(pin_u, pin_v, -0.020)
    return finalize_mesh_obj("EA288_TensionerPinHole", bm, mat_list, loc_t, parent=arm_obj, add_bevel=False, smooth_angle_deg=38.0)


def build_tensioner_pin(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    mat_list = [
        mats["machined_steel"],  # 0
        mats["red_anodized"],    # 1
    ]

    # Hardened 4mm steel dowel shaft extending -X through both aligned 5mm bores (X_local in [-0.044, +0.012])
    dowel_prof = [
        (-0.0450, 0.0),
        (-0.0450, 0.0012),
        (-0.0425, 0.0020),  # 4mm OD chamfered tip
        (+0.0120, 0.0020),
        (+0.0120, 0.0055),  # Machined depth stop collar
        (+0.0160, 0.0055),
        (+0.0160, 0.0),
    ]
    add_lathe_x(bm, dowel_prof, segs=24, mat_idx=0)

    # Anodized red diamond-knurled thumb collar extending +X (X_local in [+0.016, +0.038])
    collar_prof = [
        (0.0160, 0.0),
        (0.0160, 0.0060),
        (0.0172, 0.0072),
        (0.0368, 0.0072),
        (0.0380, 0.0060),
        (0.0380, 0.0),
    ]
    add_lathe_x(bm, collar_prof, segs=24, mat_idx=1)

    # Tactile diamond-knurl rings around red grip
    for kx in (0.020, 0.024, 0.028, 0.032):
        add_torus_x(bm, (kx, 0.0, 0.0), 0.0073, 0.0006, 20, 6, mat_idx=1)

    # T-bar cross handle at +X end (X_local = +0.041)
    add_cylinder_x(bm, (0.0395, 0.0, 0.0), 0.0045, 0.0045, 0.005, 14, mat_idx=1)
    add_cylinder_axis(bm, (0.0415, 0.0, -0.018), (0.0415, 0.0, +0.018), 0.0038, 0.0038, 16, mat_idx=1)
    for sz in (-0.018, 0.018):
        add_cylinder_axis(bm, (0.0415, 0.0, sz), (0.0415, 0.0, sz + (0.002 if sz > 0 else -0.002)), 0.0044, 0.0030, 14, mat_idx=1)

    u_stat = PIN_ARM_RADIUS * math.cos(PIN_STAT_ANGLE)
    v_stat = PIN_ARM_RADIUS * math.sin(PIN_STAT_ANGLE)
    pin_loc_t = (
        TENS_PIVOT[0],
        TENS_PIVOT[1] + v_stat,
        TENS_PIVOT[2] - u_stat,
    )
    return finalize_mesh_obj("EA288_TensionerPin", bm, mat_list, pin_loc_t, add_bevel=False, smooth_angle_deg=35.0)


# ---------------------------------------------------------------------------
# Verification & GLB Export
# ---------------------------------------------------------------------------

EXPECTED_NODES = [
    "EA288_CoreBlock",
    "EA288_PulleyCrank",
    "EA288_CrankBolt",
    "EA288_ACBody",
    "EA288_PulleyAC",
    "EA288_AlternatorBody",
    "EA288_PulleyAlternator",
    "EA288_TensionerHousing",
    "EA288_TensionerBolt",
    "EA288_TensionerArm",
    "EA288_TensionerRoller",
    "EA288_TensionerHex",
    "EA288_TensionerPinHole",
    "EA288_TensionerPin",
]


def verify_scene_and_export() -> None:
    bpy.context.view_layer.update()

    print("\n=== EA288 BLENDER SCENE VERIFICATION ===")
    for name in EXPECTED_NODES:
        obj = bpy.data.objects.get(name)
        assert obj is not None, f"Missing node: {name}"
        assert obj.type == "MESH", f"Node {name} is not MESH: {obj.type}"
        rot = tuple(round(v, 6) for v in obj.rotation_euler)
        scl = tuple(round(v, 6) for v in obj.scale)
        assert rot == (0.0, 0.0, 0.0), f"Non-zero rotation on {name}: {rot}"
        assert scl == (1.0, 1.0, 1.0), f"Non-unit scale on {name}: {scl}"
        parent_name = obj.parent.name if obj.parent else "ROOT"
        loc = tuple(round(v, 5) for v in obj.location)
        print(f"  [OK] {name:24s} parent={parent_name:20s} loc={loc} polys={len(obj.data.polygons)}")

    # Verify Three.js-space bounding box of EA288_CoreBlock: b2t(bx, by, bz) = (bx, bz, -by)
    core = bpy.data.objects["EA288_CoreBlock"]
    xs, ys, zs = [], [], []
    for v in core.data.vertices:
        w = core.matrix_world @ v.co
        xs.append(w.x)
        ys.append(w.z)
        zs.append(-w.y)
    print(
        f"\nEA288_CoreBlock Three.js bounds: "
        f"X=[{min(xs):.4f}, {max(xs):.4f}] "
        f"Y=[{min(ys):.4f}, {max(ys):.4f}] "
        f"Z=[{min(zs):.4f}, {max(zs):.4f}]"
    )
    assert min(xs) >= -0.420 and max(xs) <= 0.420, f"CoreBlock X out of [-0.42, +0.42]: [{min(xs)}, {max(xs)}]"
    assert min(ys) >= 0.220 and max(ys) <= 0.760, f"CoreBlock Y out of [0.22, 0.76]: [{min(ys)}, {max(ys)}]"
    assert min(zs) >= -1.620 and max(zs) <= -1.020, f"CoreBlock Z out of [-1.62, -1.02]: [{min(zs)}, {max(zs)}]"

    # Verify exact pulley radial & axial belt-plane bounds
    for p_name, exp_r in (
        ("EA288_PulleyCrank", 0.0830),
        ("EA288_PulleyAC", 0.0650),
        ("EA288_PulleyAlternator", 0.0390),
        ("EA288_TensionerRoller", 0.0372),
    ):
        p_obj = bpy.data.objects[p_name]
        radii = [math.hypot(v.co.y, v.co.z) for v in p_obj.data.vertices]
        pxs = [v.co.x for v in p_obj.data.vertices]
        r_max = max(radii)
        assert abs(r_max - exp_r) < 0.0005, f"{p_name} max R={r_max:.4f}, expected {exp_r:.4f}"
        print(f"  [OK] {p_name:24s} R_flange={r_max:.4f}m  X_local=[{min(pxs):.4f}, {max(pxs):.4f}]")

    # Verify required tensioner material names
    for mname in ("Tensioner_Old", "Tensioner_Roller", "Tensioner_Bolt"):
        assert mname in bpy.data.materials, f"Missing required material: {mname}"
    print("  [OK] Materials Tensioner_Old, Tensioner_Roller, Tensioner_Bolt verified")

    # Export GLB
    OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
    )
    size_bytes = OUT_GLB.stat().st_size
    size_mb = size_bytes / (1024.0 * 1024.0)
    print(f"\nExported GLB: {OUT_GLB} ({size_bytes:,} bytes / {size_mb:.2f} MB)")
    assert size_bytes < 5 * 1024 * 1024, f"GLB exceeds 5 MB limit: {size_mb:.2f} MB"
    print("=== VERIFICATION PASSED ===\n")


def main() -> None:
    clear_scene()
    textures = generate_textures()
    mats = build_materials(textures)

    build_core_block(mats)
    build_crank_pulley(mats)
    build_crank_bolt(mats)
    build_ac_body(mats)
    build_ac_pulley(mats)
    build_alternator_body(mats)
    build_alternator_pulley(mats)
    build_tensioner_housing(mats)
    build_tensioner_bolt(mats)
    arm_obj = build_tensioner_arm(mats)
    build_tensioner_roller(mats, arm_obj)
    build_tensioner_hex(mats, arm_obj)
    build_tensioner_pin_hole(mats, arm_obj)
    build_tensioner_pin(mats)

    verify_scene_and_export()


if __name__ == "__main__":
    main()
