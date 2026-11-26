#!/usr/bin/env python3
"""
Shared Blender 5.2 Architectural Modeling, PBR Material, Metric UV, glTF/Blend Export,
and Cycles Metal Preview Renderer toolkit for Kindenheim Hero Landmarks.

Coordinate Contract:
- Blender local coordinates: +X = East, +Y = North, +Z = Up (meters).
- Ground contact at Z = 0.0. Foundation skirt extends down to Z = -1.55m.
- glTF export uses export_yup=True: Blender (X, Y, Z) -> Three.js (X, Z, -Y),
  so Three.js ground contact is Y = 0.0, foundation extends down to Y = -1.55m,
  +X = East, -Z = North, and Blender rot_z(+theta) == Three.js rotation.y(+theta).
"""

import math
import os
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector, Euler

LANDMARKS_DIR = Path(__file__).resolve().parent
TEX_DIR = LANDMARKS_DIR / "textures"
ARTIFACT_DIR = Path("/Users/logge/.gemini/antigravity-cli/brain/570ed9bb-2be2-4946-8ab8-468ce077beea")
GLB_OUT_DIR = LANDMARKS_DIR.parent.parent / "public" / "assets" / "models" / "landmarks"


# ---------------------------------------------------------------------------
# Scene & Material Management
# ---------------------------------------------------------------------------

def clear_scene():
    """Reset Blender scene cleanly."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    return scene


def ensure_collection(name: str, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        if parent is None:
            bpy.context.scene.collection.children.link(col)
        else:
            parent.children.link(col)
    return col


def _load_image(path: Path, colorspace: str):
    key = path.name
    img = bpy.data.images.get(key)
    if img is None:
        img = bpy.data.images.load(str(path), check_existing=True)
        img.name = key
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    return img


def get_pbr_material(
    name: str,
    tex_name: str,
    normal_strength: float = 1.0,
    roughness_override: float | None = None,
    metallic_override: float | None = None,
    tint: tuple[float, float, float] | None = None,
):
    """Create or retrieve a Principled BSDF material wired with Albedo/Roughness/Normal/(Metallic)."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat

    mat = bpy.data.materials.new(name=name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (180, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # Albedo
    albedo_path = TEX_DIR / f"{tex_name}_albedo.jpg"
    if albedo_path.exists():
        tex_alb = nt.nodes.new("ShaderNodeTexImage")
        tex_alb.location = (-360, 260)
        tex_alb.image = _load_image(albedo_path, "sRGB")
        if tint is not None:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs["B"].default_value = (tint[0], tint[1], tint[2], 1.0)
            mix.location = (-80, 260)
            nt.links.new(tex_alb.outputs["Color"], mix.inputs["A"])
            nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tex_alb.outputs["Color"], bsdf.inputs["Base Color"])

    # Roughness
    rough_path = TEX_DIR / f"{tex_name}_roughness.jpg"
    if roughness_override is not None:
        bsdf.inputs["Roughness"].default_value = roughness_override
    elif rough_path.exists():
        tex_r = nt.nodes.new("ShaderNodeTexImage")
        tex_r.location = (-360, -20)
        tex_r.image = _load_image(rough_path, "Non-Color")
        nt.links.new(tex_r.outputs["Color"], bsdf.inputs["Roughness"])

    # Metallic
    metal_path = TEX_DIR / f"{tex_name}_metallic.jpg"
    if metallic_override is not None:
        bsdf.inputs["Metallic"].default_value = metallic_override
    elif metal_path.exists():
        tex_m = nt.nodes.new("ShaderNodeTexImage")
        tex_m.location = (-360, -280)
        tex_m.image = _load_image(metal_path, "Non-Color")
        nt.links.new(tex_m.outputs["Color"], bsdf.inputs["Metallic"])

    # Normal Map
    norm_path = TEX_DIR / f"{tex_name}_normal.png"
    if norm_path.exists():
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-360, -540)
        tex_n.image = _load_image(norm_path, "Non-Color")
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-80, -480)
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    return mat


def get_skylight_material(name: str = "mat_skylight"):
    """Translucent-look frosted polycarbonate industrial skylight panels (opaque PBR for zero sorting bugs)."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = get_pbr_material(
        name,
        "metal_roof_sheet",
        normal_strength=0.45,
        roughness_override=0.22,
        metallic_override=0.04,
    )
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    # Disconnect dark roof albedo and replace with bright translucent-look frosted sky-blue polycarbonate
    for link in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(link)
    bsdf.inputs["Base Color"].default_value = (0.76, 0.85, 0.90, 1.0)
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.6
        bsdf.inputs["Coat Roughness"].default_value = 0.12
    return mat


# ---------------------------------------------------------------------------
# Mesh & Metric UV Helpers
# ---------------------------------------------------------------------------

def apply_metric_box_uv(bm: bmesh.types.BMesh, tile_u: float = 2.0, tile_v: float = 2.0,
                        slope_align: bool = False):
    """
    Project real-world metric UVs onto all faces of a BMesh.
    - Vertical faces: U horizontal along face, V vertical (+Z).
    - Sloped roofs (when slope_align=True): U horizontal along eave, V up-slope (+Z)
      so roof tiles always run cleanly down the roof pitch!
    - Flat horizontal faces: U = X, V = Y.
    """
    uv_layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        horiz_len = math.hypot(n.x, n.y)
        if slope_align and horiz_len > 1e-4 and abs(n.z) > 0.05:
            # Horizontal eave vector
            u_axis = Vector((-n.y / horiz_len, n.x / horiz_len, 0.0))
            v_axis = n.cross(u_axis).normalized()
            if v_axis.z < 0.0:
                v_axis = -v_axis
        elif abs(n.z) > 0.72:
            u_axis = Vector((1.0, 0.0, 0.0))
            v_axis = Vector((0.0, 1.0, 0.0))
        else:
            if horiz_len > 1e-4:
                u_axis = Vector((-n.y / horiz_len, n.x / horiz_len, 0.0))
            else:
                u_axis = Vector((1.0, 0.0, 0.0))
            v_axis = Vector((0.0, 0.0, 1.0))

        for loop in f.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (co.dot(u_axis) / tile_u, co.dot(v_axis) / tile_v)


def apply_face_fit_uv(bm: bmesh.types.BMesh):
    """Fit every quad/ngon cleanly to [0, 1] x [0, 1] (used for clock dials, framed panels, glass)."""
    uv_layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        horiz = math.hypot(n.x, n.y)
        if abs(n.z) > 0.72:
            u_axis = Vector((1.0, 0.0, 0.0))
            v_axis = Vector((0.0, 1.0, 0.0))
        else:
            u_axis = Vector((-n.y / max(horiz, 1e-5), n.x / max(horiz, 1e-5), 0.0))
            v_axis = Vector((0.0, 0.0, 1.0))
        us = [l.vert.co.dot(u_axis) for l in f.loops]
        vs = [l.vert.co.dot(v_axis) for l in f.loops]
        u0, u1 = min(us), max(us)
        v0, v1 = min(vs), max(vs)
        du = max(u1 - u0, 1e-5)
        dv = max(v1 - v0, 1e-5)
        for l, u, v in zip(f.loops, us, vs):
            l[uv_layer].uv = ((u - u0) / du, (v - v0) / dv)


def finalize_mesh(
    name: str,
    bm: bmesh.types.BMesh,
    material,
    collection,
    tile_u: float = 2.0,
    tile_v: float = 2.0,
    slope_align: bool = False,
    fit_uv: bool = False,
    smooth: bool = False,
    skip_uv: bool = False,
):
    """Recalculate normals, project UVs, build Blender object, link to collection."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if not skip_uv:
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


# ---------------------------------------------------------------------------
# Architectural BMesh Geometry Builders
# ---------------------------------------------------------------------------

def _xform(rot_z: float, tx: float, ty: float, tz: float) -> Matrix:
    return Matrix.Translation((tx, ty, tz)) @ Matrix.Rotation(rot_z, 4, 'Z')


def add_box(bm: bmesh.types.BMesh, cx: float, cy: float, cz: float,
            sx: float, sy: float, sz: float, rot_z: float = 0.0, rot_x: float = 0.0, rot_y: float = 0.0):
    """Add an oriented box centered at (cx, cy, cz) with full extents (sx, sy, sz)."""
    rot = Euler((rot_x, rot_y, rot_z), 'XYZ').to_matrix().to_4x4()
    mat = Matrix.Translation((cx, cy, cz)) @ rot @ Matrix.Diagonal((sx, sy, sz, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=mat)


def add_cylinder(bm: bmesh.types.BMesh, cx: float, cy: float, cz: float,
                 r_bot: float, r_top: float, height: float, segments: int = 16,
                 rot_x: float = 0.0, rot_y: float = 0.0, rot_z: float = 0.0, cap_ends: bool = True):
    rot = Euler((rot_x, rot_y, rot_z), 'XYZ').to_matrix().to_4x4()
    mat = Matrix.Translation((cx, cy, cz)) @ rot
    bmesh.ops.create_cone(
        bm, cap_ends=cap_ends, cap_tris=False, segments=segments,
        radius1=r_bot, radius2=r_top, depth=height, matrix=mat
    )


def add_prism(bm: bmesh.types.BMesh, pts_2d: list[tuple[float, float]], z0: float, z1: float):
    """Extrude a 2D CCW polygon cleanly from z0 to z1 with solid caps."""
    n = len(pts_2d)
    if n < 3:
        return
    # Ensure CCW order in XY
    area = sum(pts_2d[i][0] * pts_2d[(i + 1) % n][1] - pts_2d[(i + 1) % n][0] * pts_2d[i][1] for i in range(n))
    if area < 0:
        pts_2d = list(reversed(pts_2d))
    bot = [bm.verts.new((x, y, z0)) for x, y in pts_2d]
    top = [bm.verts.new((x, y, z1)) for x, y in pts_2d]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bot[i], bot[j], top[j], top[i]])


def add_pitched_roof_solid(
    bm: bmesh.types.BMesh,
    cx: float, cy: float, z_eave: float,
    length_x: float, width_y: float, ridge_h: float,
    overhang_x: float = 0.45, overhang_y: float = 0.45,
    thickness: float = 0.24, hip_x: float = 0.0, rot_z: float = 0.0
):
    """
    Create a genuinely thick solid pitched roof (gabled when hip_x=0, hipped when hip_x>0)
    with crisp eaves overhang. Ridge runs along local X axis; roof slopes toward +Y and -Y.
    """
    hx = length_x * 0.5 + overhang_x
    hy = width_y * 0.5 + overhang_y
    # Eave outer edge drops slightly below wall top by slope * overhang_y
    slope = ridge_h / max(width_y * 0.5, 0.1)
    z_outer_eave = z_eave - slope * overhang_y
    z_ridge = z_eave + ridge_h
    rx = max(0.0, hx - hip_x)

    xf = _xform(rot_z, cx, cy, 0.0)

    def V(x, y, z):
        return bm.verts.new(xf @ Vector((x, y, z)))

    # Outer top shell & inner bottom shell (offset vertically by thickness/cos(pitch))
    dz = thickness * math.sqrt(1.0 + slope * slope)

    # 4 eave corners (CCW: SW, SE, NE, NW)
    e_top = [
        V(-hx, -hy, z_outer_eave + dz),
        V( hx, -hy, z_outer_eave + dz),
        V( hx,  hy, z_outer_eave + dz),
        V(-hx,  hy, z_outer_eave + dz),
    ]
    e_bot = [
        V(-hx, -hy, z_outer_eave),
        V( hx, -hy, z_outer_eave),
        V( hx,  hy, z_outer_eave),
        V(-hx,  hy, z_outer_eave),
    ]

    if rx <= 1e-4:
        # Pyramid roof (all 4 hips meet at apex)
        apex_t = V(0.0, 0.0, z_ridge + dz)
        apex_b = V(0.0, 0.0, z_ridge)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new([e_top[i], e_top[j], apex_t])
            bm.faces.new([e_bot[j], e_bot[i], apex_b])
            bm.faces.new([e_bot[i], e_bot[j], e_top[j], e_top[i]])
    else:
        r_top = [V(-rx, 0.0, z_ridge + dz), V(rx, 0.0, z_ridge + dz)]
        r_bot = [V(-rx, 0.0, z_ridge),      V(rx, 0.0, z_ridge)]
        # South slope (0 -> 1 -> r1 -> r0)
        bm.faces.new([e_top[0], e_top[1], r_top[1], r_top[0]])
        bm.faces.new([e_bot[1], e_bot[0], r_bot[0], r_bot[1]])
        # North slope (2 -> 3 -> r0 -> r1)
        bm.faces.new([e_top[2], e_top[3], r_top[0], r_top[1]])
        bm.faces.new([e_bot[3], e_bot[2], r_bot[1], r_bot[0]])

        if hip_x > 1e-4:
            # Hipped roof: add East & West sloped hip triangles + all 4 eave fascia edges
            bm.faces.new([e_top[1], e_top[2], r_top[1]])
            bm.faces.new([e_bot[2], e_bot[1], r_bot[1]])
            bm.faces.new([e_top[3], e_top[0], r_top[0]])
            bm.faces.new([e_bot[0], e_bot[3], r_bot[0]])
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new([e_bot[i], e_bot[j], e_top[j], e_top[i]])
        else:
            # Pure gabled roof: ONLY South (0->1) and North (2->3) eave fascia strips + 4 clean gable rake bargeboards!
            bm.faces.new([e_bot[0], e_bot[1], e_top[1], e_top[0]])
            bm.faces.new([e_bot[2], e_bot[3], e_top[3], e_top[2]])
            # East gable rake edges
            bm.faces.new([e_bot[1], r_bot[1], r_top[1], e_top[1]])
            bm.faces.new([r_bot[1], e_bot[2], e_top[2], r_top[1]])
            # West gable rake edges
            bm.faces.new([e_bot[3], r_bot[0], r_top[0], e_top[3]])
            bm.faces.new([r_bot[0], e_bot[0], e_top[0], r_top[0]])


def add_gable_wall_triangles(
    bm: bmesh.types.BMesh,
    cx: float, cy: float, z_eave: float,
    length_x: float, width_y: float, ridge_h: float,
    wall_thick: float = 0.35, rot_z: float = 0.0, both_ends: bool = True,
    west_end: bool = True, east_end: bool = True
):
    """Build solid triangular gable walls closing the roof ends flush with the main wall."""
    hx = length_x * 0.5
    hy = width_y * 0.5
    xf = _xform(rot_z, cx, cy, 0.0)

    def build_end(x_outer, x_inner):
        x0, x1 = (min(x_outer, x_inner), max(x_outer, x_inner))
        v = [
            bm.verts.new(xf @ Vector((x0, -hy, z_eave))),
            bm.verts.new(xf @ Vector((x0,  hy, z_eave))),
            bm.verts.new(xf @ Vector((x0, 0.0, z_eave + ridge_h + 0.06))),
            bm.verts.new(xf @ Vector((x1, -hy, z_eave))),
            bm.verts.new(xf @ Vector((x1,  hy, z_eave))),
            bm.verts.new(xf @ Vector((x1, 0.0, z_eave + ridge_h + 0.06))),
        ]
        bm.faces.new([v[0], v[2], v[1]])
        bm.faces.new([v[3], v[4], v[5]])
        bm.faces.new([v[0], v[1], v[4], v[3]])
        bm.faces.new([v[1], v[2], v[5], v[4]])
        bm.faces.new([v[2], v[0], v[3], v[5]])

    if both_ends or west_end:
        build_end(-hx, -hx + wall_thick)
    if both_ends or east_end:
        build_end(hx, hx - wall_thick)


def add_ridge_cap(bm: bmesh.types.BMesh, p0: Vector, p1: Vector, radius: float = 0.13, segments: int = 8):
    """Add cylindrical clay ridge/hip cap tiles running from p0 to p1."""
    vec = p1 - p0
    length = vec.length
    if length < 1e-4:
        return
    mid = (p0 + p1) * 0.5
    quat = Vector((0, 0, 1)).rotation_difference(vec.normalized())
    mat = Matrix.Translation(mid) @ quat.to_matrix().to_4x4()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=length + radius * 0.6, matrix=mat
    )


def add_quoins(
    bm: bmesh.types.BMesh,
    corner_x: float, corner_y: float, z0: float, z1: float,
    dir_x: float, dir_y: float,
    course_h: float = 0.42, long_l: float = 0.64, short_l: float = 0.36,
    protrude: float = 0.045, rot_z: float = 0.0, origin_xy=(0.0, 0.0)
):
    """
    Add authentic alternating Pfälzer Sandstein corner quoins (Eckquaderung).
    dir_x, dir_y are +1 or -1 pointing INTO the building along local X and Y from the corner.
    """
    xf = _xform(rot_z, origin_xy[0], origin_xy[1], 0.0)
    z = z0
    idx = 0
    while z + 0.12 < z1:
        h = min(course_h - 0.025, z1 - z)
        lx = long_l if idx % 2 == 0 else short_l
        ly = short_l if idx % 2 == 0 else long_l
        # Outer face protrudes by `protrude` outside the corner
        cx_local = corner_x + dir_x * (lx * 0.5 - protrude)
        cy_local = corner_y + dir_y * (ly * 0.5 - protrude)
        cz_local = z + h * 0.5
        mat = xf @ Matrix.Translation((cx_local, cy_local, cz_local)) @ Matrix.Diagonal((lx, ly, h, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
        z += course_h
        idx += 1


def add_framed_window(
    bms: dict,
    pos: Vector,
    rot_z: float,
    width: float = 1.05,
    height: float = 1.45,
    has_shutters: bool = True,
    shutter_key: str = "shutter_green",
    stone_key: str = "sandstone_yellow",
    frame_key: str = "wood_dark",
    glass_key: str = "glass_warm",
    iron_key: str = "iron",
    mullions: tuple[int, int] = (1, 1),
    shutter_open_deg: float = 12.0,
):
    """
    Build a detailed 3D recessed Palatinate window mounted on an exterior wall face.
    Local convention: wall exterior face is at local Y = 0, outward normal is -Y!
    pos = world center of window on the exterior wall surface.
    rot_z = rotation around Z such that local -Y points outward from the wall.
      - South wall (outward -Y): rot_z = 0
      - East wall  (outward +X): rot_z = +pi/2
      - North wall (outward +Y): rot_z = pi
      - West wall  (outward -X): rot_z = -pi/2
    """
    xf = _xform(rot_z, pos.x, pos.y, pos.z)

    def box_local(bm_key, lx, ly, lz, sx, sy, sz, lrz=0.0):
        mat = xf @ Matrix.Translation((lx, ly, lz)) @ Matrix.Rotation(lrz, 4, 'Z') @ Matrix.Diagonal((sx, sy, sz, 1.0))
        bmesh.ops.create_cube(bms[bm_key], size=1.0, matrix=mat)

    hw, hh = width * 0.5, height * 0.5
    st = 0.13   # sandstone surround width
    sd = 0.11   # sandstone surround protrusion out from wall

    # Sandstone surround (Gewände): left jamb, right jamb, lintel with keystone accent, protruding sill
    box_local(stone_key, -(hw + st * 0.5), -sd * 0.45, 0.0, st, sd, height + 0.02)
    box_local(stone_key, +(hw + st * 0.5), -sd * 0.45, 0.0, st, sd, height + 0.02)
    box_local(stone_key, 0.0, -sd * 0.50, +(hh + st * 0.55), width + st * 2.15, sd * 1.15, st * 1.1)
    # Beveled projecting sill (Fensterbank)
    box_local(stone_key, 0.0, -sd * 0.85, -(hh + 0.06), width + st * 2.35, sd * 1.8, 0.11)
    # Subtle keystone block at top center
    box_local(stone_key, 0.0, -sd * 0.65, +(hh + st * 0.65), 0.18, sd * 1.35, st * 1.35)

    # Recessed glass pane sitting slightly forward of wall face (hidden inside deep frame so no z-fighting)
    box_local(glass_key, 0.0, -0.022, 0.0, width - 0.02, 0.02, height - 0.02)

    # Outer timber sash frame + 3D mullions/transoms (Sprossen)
    ft = 0.055
    box_local(frame_key, -(hw - ft * 0.5), -0.048, 0.0, ft, 0.05, height)
    box_local(frame_key, +(hw - ft * 0.5), -0.048, 0.0, ft, 0.05, height)
    box_local(frame_key, 0.0, -0.048, +(hh - ft * 0.5), width, 0.05, ft)
    box_local(frame_key, 0.0, -0.048, -(hh - ft * 0.5), width, 0.05, ft)

    v_bars, h_bars = mullions
    for i in range(1, v_bars + 1):
        lx = -hw + width * (i / (v_bars + 1))
        box_local(frame_key, lx, -0.052, 0.0, 0.045, 0.05, height - ft)
    for j in range(1, h_bars + 1):
        lz = -hh + height * (j / (h_bars + 1))
        box_local(frame_key, 0.0, -0.052, lz, width - ft, 0.05, 0.045)

    # Open louvered Palatinate timber shutters (Klappläden)
    if has_shutters:
        sw = width * 0.48
        sh = height + 0.02
        # Left shutter hinged at -(hw + st)
        ang = math.radians(shutter_open_deg)
        for side in (-1.0, 1.0):
            hinge_x = side * (hw + st * 0.95)
            hinge_y = -sd * 0.72
            # Center of shutter panel folded back against wall with slight open angle
            cx_s = hinge_x + side * (sw * 0.5 * math.cos(ang))
            cy_s = hinge_y - sw * 0.5 * math.sin(ang)
            box_local(shutter_key, cx_s, cy_s, 0.0, sw, 0.045, sh, lrz=-side * ang)
            # Shutter outer stile rails for subtle depth + iron hinge straps
            for hz in (-sh * 0.34, sh * 0.34):
                box_local(iron_key, hinge_x + side * 0.11 * math.cos(ang), cy_s - 0.028, hz, 0.22, 0.018, 0.032, lrz=-side * ang)


def add_arched_window(
    bms: dict,
    pos: Vector,
    rot_z: float,
    width: float = 1.15,
    height: float = 2.8,
    pointed: bool = True,
    stone_key: str = "sandstone_red",
    glass_key: str = "glass_church",
    frame_key: str = "wood_dark",
    arch_segs: int = 12,
):
    """
    Build a tall neo-Gothic lancet (pointed=True) or Romanesque round-arched window
    with radiating sandstone voussoirs, leaded glass, stone sill, and vertical tracery mullions.
    Local outward normal is -Y.
    """
    xf = _xform(rot_z, pos.x, pos.y, pos.z)
    hw = width * 0.5
    spring_z = height * 0.5 - (width * 0.68 if pointed else hw)
    bot_z = -height * 0.5
    arch_h = height * 0.5 - spring_z

    def arch_pts(r_x, r_h, segs):
        pts = []
        for i in range(segs + 1):
            t = i / segs  # 0 (right) -> 1 (left)
            if pointed:
                # Gothic ogive arch via two intersecting arcs
                if t <= 0.5:
                    u = t * 2.0  # 0 at right spring -> 1 at apex
                    ang = u * (math.pi * 0.5)
                    x = r_x * (1.0 - math.sin(ang) ** 1.15) if False else r_x * math.cos(ang)
                    # Slightly pinched gothic tip
                    x = r_x * math.pow(math.cos(ang), 1.18)
                    z = spring_z + r_h * math.sin(ang)
                else:
                    u = (t - 0.5) * 2.0  # 0 at apex -> 1 at left spring
                    ang = u * (math.pi * 0.5)
                    x = -r_x * math.pow(math.sin(ang), 1.18)
                    z = spring_z + r_h * math.cos(ang)
            else:
                ang = t * math.pi
                x = r_x * math.cos(ang)
                z = spring_z + r_h * math.sin(ang)
            pts.append((x, z))
        return pts

    def add_extruded_xz_poly(bm, xz_pts, y0, y1):
        front = [bm.verts.new(xf @ Vector((x, y0, z))) for x, z in xz_pts]
        back = [bm.verts.new(xf @ Vector((x, y1, z))) for x, z in xz_pts]
        bm.faces.new(front)
        bm.faces.new(list(reversed(back)))
        n = len(xz_pts)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([front[i], back[i], back[j], front[j]])

    # Glass polygon (slightly recessed inside stone surround)
    inner_arch = arch_pts(hw, arch_h, arch_segs)
    glass_poly = [(hw, bot_z)] + inner_arch + [(-hw, bot_z)]
    add_extruded_xz_poly(bms[glass_key], glass_poly, -0.03, 0.01)

    # Sandstone surround jambs + radiating arch ring
    st = 0.16
    sd = 0.14
    outer_arch = arch_pts(hw + st, arch_h + st * 1.15, arch_segs)
    # Build arch ring as discrete wedge quads (voussoirs)
    bm_st = bms[stone_key]
    for i in range(arch_segs):
        p_in0, p_in1 = inner_arch[i], inner_arch[i + 1]
        p_out0, p_out1 = outer_arch[i], outer_arch[i + 1]
        # Slight alternation in protrusion for authentic masonry relief
        p_depth = sd * (1.08 if i % 2 == 0 else 0.94)
        add_extruded_xz_poly(bm_st, [p_in0, p_out0, p_out1, p_in1], -p_depth, 0.04)

    # Left and right stone jambs
    jamb_h = spring_z - bot_z
    jamb_cz = (spring_z + bot_z) * 0.5
    for side in (-1.0, 1.0):
        mat = xf @ Matrix.Translation((side * (hw + st * 0.5), -sd * 0.45, jamb_cz)) @ Matrix.Diagonal((st, sd, jamb_h, 1.0))
        bmesh.ops.create_cube(bm_st, size=1.0, matrix=mat)
    # Projecting sloped sill
    mat_sill = xf @ Matrix.Translation((0.0, -sd * 0.85, bot_z - 0.08)) @ Matrix.Diagonal((width + st * 2.4, sd * 1.85, 0.15, 1.0))
    bmesh.ops.create_cube(bm_st, size=1.0, matrix=mat_sill)

    # Stone/timber center vertical mullion + horizontal transom bars
    bm_fr = bms[frame_key]
    mat_m = xf @ Matrix.Translation((0.0, -0.05, (bot_z + spring_z + arch_h * 0.72) * 0.5)) @ Matrix.Diagonal((0.06, 0.06, (spring_z + arch_h * 0.72 - bot_z), 1.0))
    bmesh.ops.create_cube(bm_fr, size=1.0, matrix=mat_m)
    for frac in (0.33, 0.66):
        tz = bot_z + (spring_z - bot_z) * frac
        mat_t = xf @ Matrix.Translation((0.0, -0.05, tz)) @ Matrix.Diagonal((width, 0.06, 0.055, 1.0))
        bmesh.ops.create_cube(bm_fr, size=1.0, matrix=mat_t)


def add_dormer(
    bms: dict,
    pos: Vector,
    rot_z: float,
    width: float = 1.45,
    height: float = 1.55,
    depth: float = 2.0,
    wall_key: str = "stucco",
    roof_key: str = "roof_clay",
    stone_key: str = "sandstone_yellow",
    frame_key: str = "wood_dark",
    glass_key: str = "glass_warm",
    shutter_key: str = "shutter_green",
    iron_key: str = "iron",
):
    """Add a pitched gabled roof dormer facing local -Y (outward) embedded back into the main roof."""
    xf = _xform(rot_z, pos.x, pos.y, pos.z)
    hw = width * 0.5
    ridge_h = width * 0.44

    # Dormer rectangular box extends from y = 0 (front face) back to y = +depth (inside main roof)
    mat_body = xf @ Matrix.Translation((0.0, depth * 0.5, height * 0.5)) @ Matrix.Diagonal((width, depth, height, 1.0))
    bmesh.ops.create_cube(bms[wall_key], size=1.0, matrix=mat_body)

    # Flush triangular gable prism on top of dormer box (exact same local frame: y in [0, depth], x in [-hw, hw])
    bm_w = bms[wall_key]
    v = [
        bm_w.verts.new(xf @ Vector((-hw, 0.0,   height))),
        bm_w.verts.new(xf @ Vector(( hw, 0.0,   height))),
        bm_w.verts.new(xf @ Vector((0.0, 0.0,   height + ridge_h + 0.05))),
        bm_w.verts.new(xf @ Vector((-hw, depth, height))),
        bm_w.verts.new(xf @ Vector(( hw, depth, height))),
        bm_w.verts.new(xf @ Vector((0.0, depth, height + ridge_h + 0.05))),
    ]
    bm_w.faces.new([v[0], v[1], v[2]])
    bm_w.faces.new([v[3], v[5], v[4]])
    bm_w.faces.new([v[0], v[3], v[4], v[1]])
    bm_w.faces.new([v[1], v[4], v[5], v[2]])
    bm_w.faces.new([v[2], v[5], v[3], v[0]])

    # Miniature gabled roof centered over dormer box (ridge runs along local Y -> rot_z + pi/2)
    mid_world = xf @ Vector((0.0, depth * 0.5, 0.0))
    add_pitched_roof_solid(
        bms[roof_key], mid_world.x, mid_world.y, pos.z + height,
        length_x=depth + 0.30, width_y=width, ridge_h=ridge_h,
        overhang_x=0.22, overhang_y=0.20, thickness=0.13, rot_z=rot_z + math.pi * 0.5
    )
    # Small dormer window on front face (local y = 0)
    win_world = xf @ Vector((0.0, 0.0, height * 0.50))
    add_framed_window(
        bms, win_world, rot_z,
        width=width * 0.58, height=height * 0.66,
        has_shutters=False, stone_key=stone_key, frame_key=frame_key,
        glass_key=glass_key, shutter_key=shutter_key, iron_key=iron_key,
        mullions=(1, 1)
    )


def add_chimney(bms: dict, x: float, y: float, z_base: float, z_top: float,
                sx: float = 0.62, sy: float = 0.62, wall_key: str = "stucco", stone_key: str = "sandstone_red"):
    """Village masonry chimney stack with projecting sandstone crown cap & flue top."""
    h = z_top - z_base
    add_box(bms[wall_key], x, y, z_base + h * 0.5, sx, sy, h)
    # Corbeled stone cap
    add_box(bms[stone_key], x, y, z_top + 0.07, sx + 0.18, sy + 0.18, 0.14)
    add_box(bms[stone_key], x, y, z_top + 0.22, sx * 0.55, sy * 0.55, 0.18)


def add_wine_barrel(bms: dict, x: float, y: float, z_bot: float,
                    radius: float = 0.36, length: float = 0.92,
                    standing: bool = True, rot_z: float = 0.0,
                    wood_key: str = "barrel", iron_key: str = "iron"):
    """Authentic curved Pfalz oak wine barrel (Barrique / Stückfass) with bilge bulge & iron hoops."""
    segs = 14
    bm_w = bms[wood_key]
    bm_i = bms[iron_key]

    if standing:
        base_xf = Matrix.Translation((x, y, z_bot + length * 0.5)) @ Matrix.Rotation(rot_z, 4, 'Z')
    else:
        # Lying horizontally on timber cradle
        base_xf = (Matrix.Translation((x, y, z_bot + radius))
                   @ Matrix.Rotation(rot_z, 4, 'Z')
                   @ Matrix.Rotation(math.pi * 0.5, 4, 'X'))

    # 5 axial rings for classic curved barrel bilge profile
    z_fracs = [-0.5, -0.28, 0.0, 0.28, 0.5]
    r_mults = [0.82, 0.96, 1.02, 0.96, 0.82]
    rings = []
    for zf, rm in zip(z_fracs, r_mults):
        ring = []
        for s in range(segs):
            a = 2.0 * math.pi * s / segs
            v = bm_w.verts.new(base_xf @ Vector((radius * rm * math.cos(a), radius * rm * math.sin(a), zf * length)))
            ring.append(v)
        rings.append(ring)

    for r_idx in range(len(rings) - 1):
        r0, r1 = rings[r_idx], rings[r_idx + 1]
        for s in range(segs):
            sn = (s + 1) % segs
            bm_w.faces.new([r0[s], r0[sn], r1[sn], r1[s]])
    # End heads
    bm_w.faces.new(list(reversed(rings[0])))
    bm_w.faces.new(rings[-1])

    # 4 wrought-iron barrel hoops
    for zf, rm in [(-0.43, 0.87), (-0.21, 0.985), (0.21, 0.985), (0.43, 0.87)]:
        mat_h = base_xf @ Matrix.Translation((0.0, 0.0, zf * length))
        bmesh.ops.create_cone(
            bm_i, cap_ends=False, cap_tris=False, segments=segs,
            radius1=radius * rm + 0.012, radius2=radius * rm + 0.012, depth=0.045, matrix=mat_h
        )


def add_gutter_and_downspout(
    bms: dict,
    x0: float, x1: float, y_eave: float, z_eave: float, z_ground: float = 0.0,
    rot_z: float = 0.0, origin_xy=(0.0, 0.0), copper_key: str = "copper",
    downspout_x: float | None = None
):
    """Aged copper eaves gutter along [x0..x1] at y_eave + optional corner downspout."""
    xf = _xform(rot_z, origin_xy[0], origin_xy[1], 0.0)
    p0 = xf @ Vector((x0, y_eave, z_eave))
    p1 = xf @ Vector((x1, y_eave, z_eave))
    add_ridge_cap(bms[copper_key], p0, p1, radius=0.065, segments=8)
    if downspout_x is not None:
        dp_top = xf @ Vector((downspout_x, y_eave * 0.94, z_eave - 0.05))
        dp_bot = xf @ Vector((downspout_x, y_eave * 0.94, z_ground))
        add_ridge_cap(bms[copper_key], dp_bot, dp_top, radius=0.045, segments=8)


# ---------------------------------------------------------------------------
# Export (.blend + .glb) & Sunlit Cycles Metal Preview Renderer
# ---------------------------------------------------------------------------

def save_blend_and_export_glb(blend_path: Path, glb_path: Path, objects: list):
    """Pack textures, save clean .blend (GIANTS Exporter ready), and export Y-up .glb."""
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)

    # Pack all image textures into .blend so it's 100% portable for GIANTS Exporter
    try:
        bpy.ops.file.pack_all()
    except Exception as e:
        print(f"Warning pack_all: {e}")

    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    # Select only landmark objects for GLB export
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format='GLB',
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_jpeg_quality=88,
    )
    size_kb = glb_path.stat().st_size / 1024.0
    print(f"Exported {blend_path.name} + {glb_path.name} ({size_kb:.1f} KB, {len(objects)} objects)")


def render_preview(
    png_path: Path,
    landmark_objects: list,
    cam_azimuth_deg: float = -40.0,
    cam_elev_deg: float = 22.0,
    dist_mult: float = 2.05,
    samples: int = 36,
    res_x: int = 1280,
    res_y: int = 720,
):
    """
    Render a sunlit outdoor 1280x720 Cycles (Apple Metal GPU + OpenImageDenoise) preview
    showing the landmark grounded on a subtle village plaza disc (temporary, removed after render).
    """
    png_path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene

    # Compute above-ground bounding box of landmark objects
    mins = Vector((1e9, 1e9, 0.0))
    maxs = Vector((-1e9, -1e9, -1e9))
    for obj in landmark_objects:
        for corner in obj.bound_box:
            wc = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, wc.x)
            mins.y = min(mins.y, wc.y)
            maxs.x = max(maxs.x, wc.x)
            maxs.y = max(maxs.y, wc.y)
            maxs.z = max(maxs.z, wc.z)
    center = Vector(((mins.x + maxs.x) * 0.5, (mins.y + maxs.y) * 0.5, maxs.z * 0.48))
    span_xy = math.hypot(maxs.x - mins.x, maxs.y - mins.y)
    span = max(span_xy * 0.85, maxs.z * 1.18)

    # Temporary studio/outdoor environment collection
    tmp_col = bpy.data.collections.new("_preview_tmp")
    scene.collection.children.link(tmp_col)

    # Subtle muted courtyard/earth ground plane at Z=0 so foundation skirt below Z=0 is buried cleanly
    bm_g = bmesh.new()
    bmesh.ops.create_circle(bm_g, cap_ends=True, radius=max(span * 5.0, 45.0), segments=48)
    ground_mat = get_pbr_material("_preview_ground", "cobble_courtyard", normal_strength=0.5, tint=(0.45, 0.47, 0.42))
    g_obj = finalize_mesh("_preview_ground", bm_g, ground_mat, tmp_col, tile_u=3.5, tile_v=3.5)
    g_obj.location = (center.x, center.y, -0.005)

    # Camera framed cleanly on 3/4 front hero angle with full spire/roof headroom
    az = math.radians(cam_azimuth_deg)
    el = math.radians(cam_elev_deg)
    dist = span * dist_mult
    cam_loc = center + Vector((
        dist * math.cos(el) * math.sin(az),
        -dist * math.cos(el) * math.cos(az),
        dist * math.sin(el),
    ))
    cam_data = bpy.data.cameras.new("_preview_cam")
    cam_data.lens = 35.0
    cam_data.clip_end = 1000.0
    cam_obj = bpy.data.objects.new("_preview_cam", cam_data)
    tmp_col.objects.link(cam_obj)
    cam_obj.location = cam_loc
    direction = (center - cam_loc).normalized()
    cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam_obj

    # Golden afternoon Pfalz sunlight (warm crisp highlights, rich shadows)
    sun_data = bpy.data.lights.new("_preview_sun", type='SUN')
    sun_data.energy = 3.6
    sun_data.angle = math.radians(1.0)
    sun_data.color = (1.0, 0.93, 0.82)
    sun_obj = bpy.data.objects.new("_preview_sun", sun_data)
    tmp_col.objects.link(sun_obj)
    sun_obj.rotation_euler = Euler((math.radians(56), math.radians(12), math.radians(-35)), 'XYZ')

    # Crisp sunlit blue sky World
    world = bpy.data.worlds.new("_preview_world")
    scene.world = world
    if hasattr(world, "use_nodes") and not world.use_nodes:
        world.use_nodes = True
    wnt = world.node_tree
    wnt.nodes.clear()
    w_out = wnt.nodes.new("ShaderNodeOutputWorld")
    w_bg = wnt.nodes.new("ShaderNodeBackground")
    w_bg.inputs["Strength"].default_value = 0.75
    sky = wnt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = 'NISHITA'
        sky.sun_disc = False
        sky.sun_elevation = math.radians(34)
        sky.sun_rotation = math.radians(-32)
        sky.air_density = 1.15
        sky.dust_density = 1.1
    except Exception:
        pass
    wnt.links.new(sky.outputs["Color"], w_bg.inputs["Color"])
    wnt.links.new(w_bg.outputs["Background"], w_out.inputs["Surface"])

    # Configure Cycles with Apple Metal GPU if available
    bpy.ops.preferences.addon_enable(module='cycles')
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.refresh_devices()
        gpu_found = False
        for d in prefs.devices:
            if d.type == 'METAL':
                d.use = True
                gpu_found = True
            else:
                d.use = False
        scene.cycles.device = 'GPU' if gpu_found else 'CPU'
    except Exception:
        scene.cycles.device = 'CPU'

    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(png_path)

    # AgX / Filmic tone mapping for rich outdoor contrast
    try:
        scene.view_settings.view_transform = 'AgX'
    except Exception:
        scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.exposure = -0.15

    bpy.ops.render.render(write_still=True)

    # Clean up temporary preview scene items
    for obj in list(tmp_col.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(tmp_col)
    bpy.data.worlds.remove(world)
    print(f"Rendered preview: {png_path}")


# ===========================================================================
# v2 DETAIL TOOLKIT (graphics overhaul) — purely additive, nothing above is changed.
#
#   Materials : get_library_material (shared CC0 library, ORM packing, vertex colours, tint factor),
#               get_flat_material, get_image_material
#   Assembly  : MeshKit (per-part UVs / normals / vertex colours, one mesh per material)
#   Geometry  : wall_frame, edge_frame, opening_outline, offset_outline, notched_outline, triangulate_outline,
#               add_wall_panel, add_extruded_outline, sweep_profile, add_lathe, add_tube, add_ridge_tiles,
#               add_step_flight, add_ground_patch, add_text, add_sculpted_blobs, grid_cut
#   Site      : SiteTerrain (terrain probe of the running app in the landmark's local frame)
#   Weathering: weather_tint (vertex-colour dirt / tonal variation callback factory),
#               ashlar_block_tint (per-stone tint that follows the library ashlar scan's own joints)
#   Export    : save_blend_and_export_glb_webp, save_blend_and_export_glb_draco (Draco + original image bytes)
#
# Local wall convention (same as add_framed_window): wall plane = local XZ at local Y = 0,
# outward normal = local -Y, +X is to the RIGHT when looking at the wall from outside.
# ===========================================================================

import json as _json
from contextlib import contextmanager as _contextmanager
from mathutils import geometry as _geometry
from mathutils import noise as _noise

SHARED_TEX_DIR = LANDMARKS_DIR.parent / "shared_textures"
VERTEX_COLOR_LAYER = "Col"
UV2_LAYER = "UV2"
_LIBRARY_CACHE: dict | None = None


def load_texture_library() -> dict:
    """Return {material id: library entry} from blender/shared_textures/library.json (raises if absent)."""
    global _LIBRARY_CACHE
    if _LIBRARY_CACHE is None:
        path = SHARED_TEX_DIR / "library.json"
        if not path.exists():
            raise RuntimeError(f"Shared texture library not found: {path}")
        with open(path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        _LIBRARY_CACHE = {m["id"]: m for m in data.get("materials", [])}
    return _LIBRARY_CACHE


def library_tile_size(lib_id: str) -> tuple[float, float]:
    """Real-world size in metres covered by ONE repeat of a library material."""
    lib = load_texture_library()
    if lib_id not in lib:
        raise RuntimeError(f"Texture library has no material '{lib_id}' (available: {sorted(lib)})")
    t = lib[lib_id]["tileSizeM"]
    return float(t[0]), float(t[1])


def _library_image(lib_id: str, map_name: str, res: str, colorspace: str):
    """Load <id>_<map>[_1k].jpg; the Blender image name is the file basename (runtime de-dupes by name)."""
    lib = load_texture_library()
    if lib_id not in lib:
        raise RuntimeError(f"Texture library has no material '{lib_id}' (available: {sorted(lib)})")
    if res not in ("2k", "1k"):
        raise ValueError(f"res must be '2k' or '1k', got {res!r}")
    suffix = "" if res == "2k" else "_1k"
    path = SHARED_TEX_DIR / lib_id / f"{lib_id}_{map_name}{suffix}.jpg"
    if not path.exists():
        raise RuntimeError(f"Library texture file missing: {path}")
    key = path.stem
    img = bpy.data.images.get(key)
    if img is None:
        img = bpy.data.images.load(str(path), check_existing=False)
        img.name = key
    img.colorspace_settings.name = colorspace
    return img


def _gltf_output_group():
    """The node group the glTF exporter recognises for the ambient-occlusion channel."""
    name = "glTF Material Output"
    grp = bpy.data.node_groups.get(name)
    if grp is None:
        grp = bpy.data.node_groups.new(name, "ShaderNodeTree")
        grp.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        grp.nodes.new("NodeGroupInput")
    return grp


def _new_principled(name: str):
    mat = bpy.data.materials.new(name=name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (620, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat, nt, bsdf


def _wire_base_color(nt, bsdf, color_socket, tint, vertex_color: bool):
    """base colour = texture (x vertex colour) (x constant tint) — exported as texture + COLOR_0 + baseColorFactor."""
    src = color_socket
    if vertex_color:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = VERTEX_COLOR_LAYER
        vc.location = (-380, 420)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs["Factor"].default_value = 1.0
        mix.location = (-140, 300)
        if src is not None:
            nt.links.new(src, mix.inputs["A"])
        else:
            mix.inputs["A"].default_value = (1.0, 1.0, 1.0, 1.0)
        nt.links.new(vc.outputs["Color"], mix.inputs["B"])
        src = mix.outputs["Result"]
    if tint is not None:
        if src is None:
            bsdf.inputs["Base Color"].default_value = (tint[0], tint[1], tint[2], 1.0)
            return
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["B"].default_value = (tint[0], tint[1], tint[2], 1.0)
        mix.location = (60, 300)
        nt.links.new(src, mix.inputs["A"])
        src = mix.outputs["Result"]
    if src is not None:
        nt.links.new(src, bsdf.inputs["Base Color"])


def get_library_material(
    name: str,
    lib_id: str,
    *,
    tint: tuple[float, float, float] | None = None,
    albedo_res: str = "2k",
    normal_res: str = "1k",
    orm_res: str = "1k",
    normal_strength: float = 1.0,
    vertex_color: bool = False,
    normal_from: str | None = None,
    orm_from: str | None = None,
    use_occlusion: bool = True,
    use_orm: bool = True,
    use_normal: bool = True,
    roughness: float = 0.8,
    glow_map: Path | None = None,
    glow_strength: float = 0.0,
):
    """
    Principled material from the shared CC0 photo-scan library (blender/shared_textures/<lib_id>/).
    - `use_orm=False` / `use_normal=False` leave those maps out (distant or flat surfaces; `roughness` is then
      the constant roughness) — every library JPEG that is not embedded saves download and GPU memory.
    - `glow_map` + `glow_strength`: a small emissive "light pool" image sampled through the SECOND UV set
      ("UV2", clamp-to-edge) — the wall or ground around a lamp is lit at night. Name such a material with
      'Emissive' so the runtime fades it with the night factor; MeshKit(uv2_keys=...) / part(uv2=...) writes UV2.
    - albedo sRGB, normal (OpenGL), ORM (R = AO -> glTF occlusion, G = roughness, B = metalness).
    - `tint` multiplies the albedo and is exported as baseColorFactor (no recoloured texture copies).
    - `vertex_color=True` additionally multiplies by the float colour attribute "Col" (exported as COLOR_0);
      use it with MeshKit(..., vc=...) for dirt / tonal variation on large surfaces.
    - `normal_from` / `orm_from`: take those maps from ANOTHER library id whose pixels are identical
      (e.g. sandstone_yellow_ashlar shares normal + ORM with sandstone_red_ashlar) to save GLB bytes.
    - *_res: '2k' (library original) or '1k' (library `_1k` variant, already carries the size suffix).
    Raises RuntimeError when the library or the id is missing — never falls back to another texture.
    """
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat, nt, bsdf = _new_principled(name)

    tex_a = nt.nodes.new("ShaderNodeTexImage")
    tex_a.location = (-700, 320)
    tex_a.image = _library_image(lib_id, "albedo", albedo_res, "sRGB")
    _wire_base_color(nt, bsdf, tex_a.outputs["Color"], tint, vertex_color)

    if use_orm:
        tex_o = nt.nodes.new("ShaderNodeTexImage")
        tex_o.location = (-700, -20)
        tex_o.image = _library_image(orm_from or lib_id, "orm", orm_res, "Non-Color")
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-380, -20)
        nt.links.new(tex_o.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        if use_occlusion:
            grp = nt.nodes.new("ShaderNodeGroup")
            grp.node_tree = _gltf_output_group()
            grp.location = (300, -420)
            nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    else:
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0.0

    if use_normal:
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-700, -360)
        tex_n.image = _library_image(normal_from or lib_id, "normal", normal_res, "Non-Color")
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-380, -360)
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    if glow_map is not None and glow_strength > 0.0:
        _wire_glow_map(nt, bsdf, Path(glow_map), glow_strength)
    return mat


def _wire_glow_map(nt, bsdf, glow_map: Path, glow_strength: float):
    if not glow_map.exists():
        raise RuntimeError(f"Glow map missing: {glow_map} (run generate_textures.py --atlases)")
    key = glow_map.stem
    img = bpy.data.images.get(key)
    if img is None:
        img = bpy.data.images.load(str(glow_map), check_existing=False)
        img.name = key
    img.colorspace_settings.name = "sRGB"
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = UV2_LAYER
    uvn.location = (-980, 640)
    tex_g = nt.nodes.new("ShaderNodeTexImage")
    tex_g.location = (-700, 640)
    tex_g.image = img
    tex_g.extension = 'EXTEND'
    nt.links.new(uvn.outputs["UV"], tex_g.inputs["Vector"])
    nt.links.new(tex_g.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = glow_strength


def get_flat_material(
    name: str,
    color: tuple[float, float, float],
    roughness: float = 0.6,
    metallic: float = 0.0,
    emissive: tuple[float, float, float] | None = None,
    emissive_strength: float = 1.0,
    vertex_color: bool = False,
    alpha: float | None = None,
):
    """Texture-less PBR material (painted metal, zinc, gilding, glass, lamp glass). Costs zero texture bytes.
    Name it with 'Glass' / 'Emissive' / 'Lamp' per the project conventions where applicable.
    `alpha` < 1 makes it alpha-blended (glTF alphaMode BLEND) — e.g. dark reflective panes in front of a
    modelled curtain."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat, nt, bsdf = _new_principled(name)
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    if vertex_color:
        _wire_base_color(nt, bsdf, None, None, True)
        # constant colour as multiply factor on top of the vertex colour
        mix = bsdf.inputs["Base Color"].links[0].from_node
        mix.inputs["A"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (emissive[0], emissive[1], emissive[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    if alpha is not None and alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = 'BLENDED'
        if hasattr(mat, "blend_method"):
            mat.blend_method = 'BLEND'
    return mat


def get_image_material(
    name: str,
    image_path: Path,
    *,
    roughness: float = 0.6,
    metallic: float = 0.0,
    tint: tuple[float, float, float] | None = None,
    normal_path: Path | None = None,
    normal_strength: float = 1.0,
    emissive_strength: float = 0.0,
    emissive_path: Path | None = None,
):
    """Material for a unique atlas / decal image (clock face, coat of arms, notice board, leaded glass).
    `emissive_strength > 0` wires the albedo (or `emissive_path`) into emission so the lighting pass can
    fade it in at dusk — name such materials with 'Emissive'."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    image_path = Path(image_path)
    if not image_path.exists():
        raise RuntimeError(f"Atlas image missing: {image_path} (run generate_textures.py --atlases)")
    mat, nt, bsdf = _new_principled(name)

    def load(path: Path, colorspace: str):
        key = path.stem
        img = bpy.data.images.get(key)
        if img is None:
            img = bpy.data.images.load(str(path), check_existing=False)
            img.name = key
        img.colorspace_settings.name = colorspace
        return img

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.location = (-700, 320)
    tex.image = load(image_path, "sRGB")
    _wire_base_color(nt, bsdf, tex.outputs["Color"], tint, False)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if normal_path is not None:
        normal_path = Path(normal_path)
        if not normal_path.exists():
            raise RuntimeError(f"Atlas normal map missing: {normal_path}")
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-700, -360)
        tex_n.image = load(normal_path, "Non-Color")
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-380, -360)
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if emissive_strength > 0.0:
        if emissive_path is not None:
            emissive_path = Path(emissive_path)
            if not emissive_path.exists():
                raise RuntimeError(f"Atlas emissive map missing: {emissive_path}")
            tex_e = nt.nodes.new("ShaderNodeTexImage")
            tex_e.location = (-700, 40)
            tex_e.image = load(emissive_path, "sRGB")
            nt.links.new(tex_e.outputs["Color"], bsdf.inputs["Emission Color"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    return mat


def get_alpha_card_material(name: str, image_path: Path, *, roughness: float = 0.75,
                            vertex_color: bool = False):
    """Double-sided alpha-tested material for foliage / flower cards (RGBA atlas).
    The texture alpha goes through a Math 'Round' node, which the glTF exporter turns into
    alphaMode MASK with alphaCutoff 0.5 (no sorting cost, casts cut-out shadows)."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    image_path = Path(image_path)
    if not image_path.exists():
        raise RuntimeError(f"Alpha-card atlas missing: {image_path} (run generate_textures.py --atlases)")
    mat, nt, bsdf = _new_principled(name)
    img = bpy.data.images.get(image_path.stem)
    if img is None:
        img = bpy.data.images.load(str(image_path), check_existing=False)
        img.name = image_path.stem
    img.colorspace_settings.name = "sRGB"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.location = (-700, 320)
    tex.image = img
    _wire_base_color(nt, bsdf, tex.outputs["Color"], None, vertex_color)
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = 'ROUND'
    rnd.location = (-300, -120)
    nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs["Value"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = roughness
    mat.use_backface_culling = False
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = 'DITHERED'
    return mat


# Flower-trough foliage cards (generate_textures.py gen_trough_planting, 1024 x 512 RGBA):
# pixel rects (x0, y0, x1, y1), y down — keep in sync with generate_textures.PLANTING_CELLS.
PLANTING_ATLAS = TEX_DIR / "trough_planting.png"
_PLANTING_CELLS_PX = {
    "geranium_red": (0, 0, 512, 256),
    "marigold_yellow": (512, 0, 1024, 256),
    "petunia_violet": (0, 256, 512, 512),
    "trailing": (512, 256, 1024, 512),
}


def _planting_uv(cell: str):
    if cell not in _PLANTING_CELLS_PX:
        raise KeyError(f"Unknown planting cell {cell!r} (known: {sorted(_PLANTING_CELLS_PX)})")
    x0, y0, x1, y1 = _PLANTING_CELLS_PX[cell]
    inset = 3
    return ((x0 + inset) / 1024.0, 1.0 - (y1 - inset) / 512.0, (x1 - inset) / 1024.0, 1.0 - (y0 + inset) / 512.0)


def add_planting_cards(kit, key: str, xf: Matrix, length: float, z_soil: float, cell: str, rng,
                       width: float = 0.44, height: float = 0.30, trailing: bool = True):
    """Fill a flower trough / window box with alpha-tested foliage cards (material from
    get_alpha_card_material(..., PLANTING_ATLAS)). `xf` = trough frame (local x along the trough, z up at its
    base), `length`/`width` = outer trough size, `z_soil` = soil level in that frame, `cell` = clump cell of the
    atlas ('geranium_red', 'marigold_yellow', 'petunia_violet'), `rng` = random.Random.
    Two staggered rows of upright clump cards along the trough, short cross cards, and trailing shoots hanging
    over both long sides. About 2 triangles per card, ~30 per metre of trough."""
    def card_part(cell_name, quads, windows=None):
        """windows: optional per-quad (fu0, fu1, flip) = horizontal sub-range of the cell used by that card."""
        u0, v0, u1, v1 = _planting_uv(cell_name)

        def uv(bm):
            layer = bm.loops.layers.uv.verify()
            for fi, f in enumerate(bm.faces):
                a0, a1 = u0, u1
                if windows is not None:
                    fu0, fu1, flip = windows[fi]
                    a0, a1 = u0 + (u1 - u0) * fu0, u0 + (u1 - u0) * fu1
                    if flip:
                        a0, a1 = a1, a0
                for loop, (u, v) in zip(f.loops, ((a0, v0), (a1, v0), (a1, v1), (a0, v1))):
                    loop[layer].uv = (u, v)
        with kit.part(key, uv=uv, normals=None) as bm:
            for q in quads:
                bm.faces.new([bm.verts.new(xf @ Vector(c)) for c in q])
            bm.faces.ensure_lookup_table()
            if len(bm.faces) != len(quads):
                raise RuntimeError(f"add_planting_cards: {len(quads)} cards but {len(bm.faces)} faces were created")

    def upright(cx, cy, yaw, w, h, z0, lean=0.0):
        dx, dy = 0.5 * w * math.cos(yaw), 0.5 * w * math.sin(yaw)
        lx, ly = -math.sin(yaw) * lean * h, math.cos(yaw) * lean * h
        return [(cx - dx, cy - dy, z0), (cx + dx, cy + dy, z0),
                (cx + dx + lx, cy + dy + ly, z0 + h), (cx - dx + lx, cy - dy + ly, z0 + h)]

    inner = length - 0.16
    quads = []
    n_row = max(2, math.ceil(inner / 0.42))
    for row, yo in enumerate((-0.07, 0.07)):
        for i in range(n_row):
            cx = -inner * 0.5 + (i + 0.5 + 0.35 * row) * inner / (n_row + 0.35) + rng.uniform(-0.03, 0.03)
            w = rng.uniform(0.50, 0.62) * height / 0.30
            yaw = rng.uniform(-0.25, 0.25)
            # the card must stay inside the trough's end walls: a card poking out through an end wall reads as
            # a rectangular notch cut into the stone with foliage behind it
            w = min(w, inner * 0.9, 2.0 * (inner * 0.5 + 0.02 - abs(cx)) / max(math.cos(yaw), 0.5))
            if w < 0.12:
                continue
            quads.append(upright(cx, yo + rng.uniform(-0.02, 0.02), yaw, w,
                                 height * rng.uniform(0.9, 1.08), z_soil - 0.07, lean=(-0.12 if yo < 0 else 0.12)))
    for i in range(max(1, round(inner / 0.38))):
        cx = -inner * 0.5 + (i + 0.5) * inner / max(1, round(inner / 0.38))
        quads.append(upright(cx, 0.0, math.pi * 0.5 + rng.uniform(-0.4, 0.4), min(width * 0.85, 0.36),
                             height * 0.62, z_soil - 0.05))
    card_part(cell, quads)
    if not trailing:
        return
    hang, windows = [], []
    for side in (-1.0, 1.0):
        # irregular: uneven gaps, some stretches bare, every card shows its own random slice of the trailing cell
        cx = -inner * 0.5 + rng.uniform(0.0, 0.18)
        while cx < inner * 0.5 - 0.06:
            w = min(rng.uniform(0.18, 0.42), inner * 0.5 - cx + 0.06)
            if w > 0.10 and rng.random() < 0.8:
                frac = min(1.0, w / 0.50 * rng.uniform(0.8, 1.2))
                fu0 = rng.uniform(0.0, 1.0 - frac)
                # top edge sits ON the outer edge of the rim (never inside the stone wall, which would show the
                # leaves as a rectangular notch cut into the trough), the card hangs down and away from the wall
                y0 = side * (width * 0.5 + 0.006)
                y1 = side * (width * 0.5 + rng.uniform(0.03, 0.09))
                zt = z_soil + rng.uniform(0.015, 0.03)
                hgt = rng.uniform(0.16, 0.34)
                tilt = rng.uniform(-0.05, 0.05)
                hang.append([(cx + tilt, y1, zt - hgt), (cx + w + tilt, y1, zt - hgt),
                             (cx + w, y0, zt), (cx, y0, zt)])
                windows.append((fu0, fu0 + frac, rng.random() < 0.5))
            cx += w * rng.uniform(0.55, 1.05) + rng.uniform(0.0, 0.10)
    # trailing cell: shoots hang from the image's top edge -> v1 (top) at the rim, v0 at the tips
    if hang:
        card_part("trailing", hang, windows)


# ---------------------------------------------------------------------------
# Vertex-colour weathering
# ---------------------------------------------------------------------------

def weather_tint(
    ground_z: float | None = 0.0,
    splash_h: float = 0.9,
    splash_dark: float = 0.22,
    splash_color: tuple[float, float, float] = (0.80, 0.86, 0.74),
    noise_scale: float = 0.45,
    noise_amp: float = 0.10,
    hue_amp: float = 0.035,
    top_z: float | None = None,
    top_fade_h: float = 0.0,
    top_dark: float = 0.0,
    seed: float = 0.0,
    level: float = 0.9,
    streak_amp: float = 0.0,
    streak_scale: float = 2.2,
    drip_lines: list | tuple = (),
    ledge_dark: float = 0.0,
    ledge_color: tuple[float, float, float] = (0.62, 0.70, 0.50),
    tone: tuple[float, float, float] = (1.0, 1.0, 1.0),
):
    """
    Factory for a MeshKit `vc=` callback returning a per-vertex multiply colour:
    - `drip_lines` = [(z, fade_h, dark), ...]: run-off staining below sills / string courses / copings; with
      `streak_amp` > 0 the stains break up into vertical streaks (`streak_scale` streaks per metre). `top_z`
      is simply one more drip line. Needs vertices about every 0.3 m along the wall (MeshKit cut=).
    - `ledge_dark`: upward-facing surfaces (ledges, copings, steps) get moss / lichen (`ledge_color`).
    - `tone`: constant colour multiplier (stone-specific hue on top of a shared library albedo).
    - blotchy large-scale value noise (+- noise_amp) with a slight warm/cool hue drift (+- hue_amp),
    - optional damp/green "splash zone" darkening within `splash_h` above `ground_z`,
    - optional soot/run-off darkening within `top_fade_h` below `top_z` (under eaves / cornices).
    Colours are linear multipliers clamped to [0, 1]; `level` is the neutral value (default 0.9 leaves headroom
    for the noise to brighten as well as darken).
    """
    def fn(co: Vector, _normal: Vector):
        p = Vector((co.x * noise_scale + seed, co.y * noise_scale - seed * 0.7, co.z * noise_scale * 1.3))
        n1 = _noise.noise(p)
        n2 = _noise.noise(p * 2.7 + Vector((11.3, 4.1, 7.7)))
        v = level * (1.0 + noise_amp * (0.7 * n1 + 0.3 * n2))
        hue = hue_amp * _noise.noise(p * 0.6 + Vector((31.0, 17.0, 5.0)))
        r, g, b = v * (1.0 + hue), v, v * (1.0 - hue)
        if ground_z is not None and splash_h > 0.0:
            t = 1.0 - min(max((co.z - ground_z) / splash_h, 0.0), 1.0)
            t = t * t * (0.75 + 0.25 * n2)
            k = splash_dark * t
            r *= 1.0 - k * (1.0 - splash_color[0] * 0.2) - k * (1.0 - splash_color[0])
            g *= 1.0 - k * (1.0 - splash_color[1])
            b *= 1.0 - k * (1.0 - splash_color[2]) - k * 0.15
        lines = list(drip_lines)
        if top_z is not None and top_fade_h > 0.0 and top_dark > 0.0:
            lines.append((top_z, top_fade_h, top_dark))
        if lines:
            streak = 1.0
            if streak_amp > 0.0:
                h = (co.x * 0.83 + co.y * 0.56) * streak_scale
                sn = _noise.noise(Vector((h, seed * 3.1, 0.37))) * 0.6 + _noise.noise(Vector((h * 2.9, 5.0, seed))) * 0.4
                streak = 1.0 - streak_amp + streak_amp * min(max(sn * 1.6 + 0.45, 0.0), 1.0) * 2.0
            for (zl, fade, dark) in lines:
                if co.z > zl + 1e-4:
                    continue
                t = 1.0 - min(max((zl - co.z) / fade, 0.0), 1.0)
                k = 1.0 - min(dark * streak, 0.85) * t * t
                r, g, b = r * k, g * k, b * k
        if ledge_dark > 0.0 and _normal.z > 0.4:
            k = ledge_dark * min((_normal.z - 0.4) / 0.4, 1.0) * (0.65 + 0.35 * n2)
            r *= 1.0 - k * (1.0 - ledge_color[0])
            g *= 1.0 - k * (1.0 - ledge_color[1])
            b *= 1.0 - k * (1.0 - ledge_color[2])
        r, g, b = r * tone[0], g * tone[1], b * tone[2]
        return (min(max(r, 0.0), 1.0), min(max(g, 0.0), 1.0), min(max(b, 0.0), 1.0))
    return fn


def grid_cut(bm: bmesh.types.BMesh, step: float = 1.2, axes: str = "xyz"):
    """Bisect all geometry of `bm` by axis-aligned planes every `step` metres, so large flat faces get
    interior vertices that can carry vertex-colour variation. Shape is unchanged."""
    if len(bm.verts) == 0:
        return
    for ax_i, ax in enumerate("xyz"):
        if ax not in axes:
            continue
        lo = min(v.co[ax_i] for v in bm.verts)
        hi = max(v.co[ax_i] for v in bm.verts)
        k0 = math.floor(lo / step) + 1
        k1 = math.ceil(hi / step) - 1
        no = Vector((1.0 if ax_i == 0 else 0.0, 1.0 if ax_i == 1 else 0.0, 1.0 if ax_i == 2 else 0.0))
        for k in range(k0, k1 + 1):
            c = k * step
            if c - lo < 0.02 or hi - c < 0.02:
                continue
            co = Vector((c if ax_i == 0 else 0.0, c if ax_i == 1 else 0.0, c if ax_i == 2 else 0.0))
            bmesh.ops.bisect_plane(
                bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                dist=1e-5, plane_co=co, plane_no=no, clear_inner=False, clear_outer=False,
            )


# Block layout of the library scan shared by sandstone_red_ashlar / sandstone_yellow_ashlar
# (Poly Haven sandstone_blocks_08), measured from its normal map: `rows` = V of the five bed joints inside one
# tile, `joints[m]` = U of the perpend joints of the course that starts at rows[m].
ASHLAR_LAYOUT_SANDSTONE_08 = {
    "rows": [0.0073, 0.2021, 0.4014, 0.6011, 0.8018],
    "joints": [
        [0.006, 0.292, 0.592],
        [0.115, 0.348, 0.469, 0.725],
        [0.173, 0.270, 0.566, 0.868],
        [0.045, 0.342, 0.635],
        [0.194, 0.492, 0.786],
    ],
}


def ashlar_block_tint(tile: float, off_u: float = 0.0, off_v: float = 0.0, base=None, amp: float = 0.16,
                      hue: float = 0.05, seed: int = 0, layout: dict | None = None, joint: float = 0.0,
                      repair: float = 0.0, violet: float = 0.0):
    """
    Per-stone tonal variation for ashlar walls textured with ("box", tile, tile, off_u, off_v):
    returns (prepare, vc) for MeshKit.part(..., prepare=prepare, vc=vc).
    - `prepare(bm)` cuts the (vertical, planar) wall part along the texture's own bed and perpend joints, so
      every stone of the photo-scan becomes its own face(s) — openings stay exactly as modelled.
    - `vc` multiplies `base(co, normal)` (e.g. a weather_tint) by one random tint per stone, which gives the
      block-to-block colour play of real Buntsandstein masonry that a repeating scan alone cannot.
    - `joint` > 0 shrinks every stone face by joint/2 on all sides, leaving open joints of that width: put a
      mortar-coloured copy of the wall panel a few millimetres behind (see add_ashlar_wall) for real joints.
    - `repair`: fraction of stones that read as lighter, fresher replacements; `violet`: share of stones
      drifting toward the grey-violet beds typical of Palatinate Buntsandstein.
    """
    lay = layout or ASHLAR_LAYOUT_SANDSTONE_08
    rows = lay["rows"]
    joints = lay["joints"]
    nrows = len(rows)

    def u_axis_of(n: Vector):
        ln = math.hypot(n.x, n.y)
        if ln < 1e-6:
            return None
        return Vector((-n.y / ln, n.x / ln, 0.0))

    def prepare(bm: bmesh.types.BMesh):
        wall_n = Vector((0.0, 0.0, 0.0))
        for f in bm.faces:
            if abs(f.normal.z) < 0.3:
                wall_n += f.normal * f.calc_area()
        if wall_n.length < 1e-9:
            return
        wall_n.normalize()
        ua = u_axis_of(wall_n)
        zs = [v.co.z for v in bm.verts]
        us = [v.co.dot(ua) for v in bm.verts]
        z_lo, z_hi, u_lo, u_hi = min(zs), max(zs), min(us), max(us)
        # bed joints
        beds = []
        k = math.floor(z_lo / tile + off_v) - 1
        while True:
            done = False
            for m in range(nrows):
                z = (k + rows[m] - off_v) * tile
                if z > z_hi + 1e-6:
                    done = True
                    break
                beds.append((z, m))
            if done:
                break
            k += 1
        beds.sort()
        for z, _m in beds:
            if z_lo + 0.01 < z < z_hi - 0.01:
                bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-5,
                                       plane_co=Vector((0.0, 0.0, z)), plane_no=Vector((0.0, 0.0, 1.0)))
        # perpend joints, course by course
        for i, (z0, m) in enumerate(beds):
            z1 = beds[i + 1][0] if i + 1 < len(beds) else z_hi + 1.0
            if z1 < z_lo or z0 > z_hi:
                continue
            ku = math.floor(u_lo / tile + off_u) - 1
            while (ku - off_u) * tile < u_hi:
                for jf in joints[m]:
                    u = (ku + jf - off_u) * tile
                    if not (u_lo + 0.01 < u < u_hi - 0.01):
                        continue
                    faces = [f for f in bm.faces
                             if z0 - 1e-4 <= f.calc_center_median().z <= z1 + 1e-4 and f.normal.dot(wall_n) > 0.9]
                    if not faces:
                        continue
                    geom = set(faces)
                    for f in faces:
                        geom.update(f.edges)
                        geom.update(f.verts)
                    bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5, plane_co=ua * u, plane_no=ua)
                ku += 1
        # merge the fragments of every stone back into a single polygon (keeps the triangle count low)
        bm.normal_update()
        area_before = sum(f.calc_area() for f in bm.faces)
        ids = {}
        for f in bm.faces:
            if f.normal.dot(wall_n) > 0.9:
                ids[f] = block_id(f.calc_center_median(), f.normal)
        inner = [e for e in bm.edges
                 if len(e.link_faces) == 2 and e.link_faces[0] in ids and e.link_faces[1] in ids
                 and ids[e.link_faces[0]] == ids[e.link_faces[1]]]
        if inner:
            bmesh.ops.dissolve_edges(bm, edges=inner, use_verts=False, use_face_split=False)
            # drop the now redundant vertices that sit in the middle of a straight edge (never arc points)
            straight = []
            for v in bm.verts:
                if len(v.link_edges) == 2:
                    d0 = (v.link_edges[0].other_vert(v).co - v.co)
                    d1 = (v.link_edges[1].other_vert(v).co - v.co)
                    if d0.length > 1e-9 and d1.length > 1e-9 and d0.normalized().dot(d1.normalized()) < -0.999999:
                        straight.append(v)
            if straight:
                bmesh.ops.dissolve_verts(bm, verts=straight, use_face_split=False, use_boundary_tear=False)
        bm.normal_update()
        area_after = sum(f.calc_area() for f in bm.faces)
        if abs(area_after - area_before) > 1e-3 * max(area_before, 1.0):
            raise RuntimeError(f"ashlar_block_tint: merging stone fragments changed the wall area "
                               f"({area_before:.3f} -> {area_after:.3f} m2)")
        if joint > 0.0:
            stones = [f for f in bm.faces if f.normal.dot(wall_n) > 0.9 and f.calc_area() > joint * joint * 9.0]
            res = bmesh.ops.inset_individual(bm, faces=stones, thickness=joint * 0.5, depth=0.0,
                                             use_even_offset=True, use_interpolate=False, use_relative_offset=False)
            bmesh.ops.delete(bm, geom=res["faces"], context='FACES')
            slivers = [f for f in bm.faces if f.calc_area() < 1e-5]
            if slivers:
                bmesh.ops.delete(bm, geom=slivers, context='FACES')
            bm.normal_update()

    def block_id(center: Vector, n: Vector):
        ua = u_axis_of(n)
        if ua is None or abs(n.z) > 0.3:
            return None
        u = center.dot(ua) / tile + off_u
        v = center.z / tile + off_v - rows[0]
        iv = math.floor(v)
        fv = v - iv
        m = 0
        for r in range(nrows):
            if rows[r] - rows[0] <= fv + 1e-6:
                m = r
        iu = math.floor(u)
        fu = u - iu
        j = sum(1 for jf in joints[m] if jf <= fu)
        if j == 0:
            j, iu = len(joints[m]), iu - 1
        return (iu, iv, m, j)

    def vc(co: Vector, n: Vector, center: Vector):
        col = base(co, n) if base is not None else (1.0, 1.0, 1.0)
        bid = block_id(center, n)
        if bid is None:
            return col
        iu, iv, m, j = bid
        h = math.sin(iu * 127.1 + iv * 311.7 + m * 74.7 + j * 269.5 + seed * 19.19) * 43758.5453
        r1 = h - math.floor(h)
        h2 = math.sin(iu * 269.5 + iv * 183.3 + m * 246.1 + j * 113.5 + seed * 7.7) * 43758.5453
        r2 = h2 - math.floor(h2)
        val = 1.0 - amp * r1 * r1 * 1.4 if r1 > 0.15 else 1.0 - amp * 0.2
        val = max(1.0 - amp * 1.4, val)
        hs = hue * (r2 - 0.5) * 2.0
        cr, cg, cb = col[0] * val * (1.0 + hs), col[1] * val, col[2] * val * (1.0 - hs)
        if repair > 0.0 or violet > 0.0:
            h3 = math.sin(iu * 71.3 + iv * 157.9 + m * 39.1 + j * 311.3 + seed * 3.3) * 43758.5453
            r3 = h3 - math.floor(h3)
            if r3 < repair:                        # fresh replacement stone: lighter, cleaner
                lift = 1.0 / max(val, 0.35)
                cr, cg, cb = cr * lift * 1.22, cg * lift * 1.25, cb * lift * 1.22
            elif r3 > 1.0 - violet:                # grey-violet bed
                cr, cg, cb = cr * 0.80, cg * 0.84, cb * 1.0
        return (min(max(cr, 0.0), 1.0), min(max(cg, 0.0), 1.0), min(max(cb, 0.0), 1.0))

    vc.uses_face_center = True
    return prepare, vc


# ---------------------------------------------------------------------------
# MeshKit: one mesh per material key, assembled from independently UV-mapped parts
# ---------------------------------------------------------------------------

def _uv_box_offset(bm, tile_u, tile_v, slope_align, off_u, off_v, rot90):
    apply_metric_box_uv(bm, tile_u=tile_u, tile_v=tile_v, slope_align=slope_align)
    if off_u or off_v or rot90:
        uv_layer = bm.loops.layers.uv.verify()
        for f in bm.faces:
            for loop in f.loops:
                u, v = loop[uv_layer].uv
                if rot90:
                    u, v = -v, u
                loop[uv_layer].uv = (u + off_u, v + off_v)


def _uv_rect(bm, rect):
    """Fit every face to an atlas sub-rectangle (u0, v0, u1, v1) (v up, as in Blender UV space)."""
    apply_face_fit_uv(bm)
    u0, v0, u1, v1 = rect
    uv_layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for loop in f.loops:
            u, v = loop[uv_layer].uv
            loop[uv_layer].uv = (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v)


def _uv_planar(bm, origin, u_axis, v_axis, size_u, size_v, rect=(0.0, 0.0, 1.0, 1.0)):
    """Planar projection: UV = rect.lo + ((co - origin) . axis / size) * rect.size (one image over a known frame)."""
    uv_layer = bm.loops.layers.uv.verify()
    u0, v0, u1, v1 = rect
    for f in bm.faces:
        for loop in f.loops:
            d = loop.vert.co - origin
            loop[uv_layer].uv = (u0 + (u1 - u0) * d.dot(u_axis) / size_u, v0 + (v1 - v0) * d.dot(v_axis) / size_v)


class MeshKit:
    """
    Collects geometry per material key from small, independently mapped parts:

        kit = MeshKit({"stone": mat_stone, "roof": mat_roof}, vc_keys={"stone"})
        with kit.part("stone", uv=("box", 3.0, 3.0), vc=weather_tint(ground_z=0.0), cut=1.2) as bm:
            add_box(bm, ...)                     # any bmesh builder from this module
        objects = kit.finalize("Rathaus", collection)

    uv options:  ("box", tile_u, tile_v[, off_u, off_v[, rot90]])  metric box projection (walls / stone)
                 ("slope", tile_u, tile_v[, off_u, off_v])          eave-aligned projection for roof planes
                 ("fit",)                                          every face stretched over the full 0..1 image
                 ("rect", u0, v0, u1, v1)                          every face fitted into an atlas sub-rectangle
                 ("planar", origin, u_axis, v_axis, size_u, size_v[, rect])
                 None                                              no UVs written (untextured materials)
                 callable(bm)                                      custom mapper
    normals:     "solid"  recalc outward (closed shells; default)
                 Vector   recalc, then flip every island whose faces look toward this INSIDE point
                 None     keep the winding exactly as built
    smooth:      None = flat shaded; float (degrees) = smooth shading with edges sharper than that marked sharp
    vc:          callable(co, normal) -> (r, g, b) multiply colour (only stored for keys listed in vc_keys)
    cut:         grid_cut step in metres applied before colouring (gives big faces vertices for `vc`)
    prepare:     callable(bm) run before UV mapping / colouring, e.g. the cutter from ashlar_block_tint()
    uv2:         callable(co) -> (u, v) for keys listed in uv2_keys (glow maps of get_library_material)
    """

    def __init__(self, materials: dict, vc_keys: set | None = None, uv2_keys: set | None = None):
        self.materials = dict(materials)
        self.vc_keys = set(vc_keys or ())
        self.uv2_keys = set(uv2_keys or ())
        unknown = (self.vc_keys | self.uv2_keys) - set(self.materials)
        if unknown:
            raise KeyError(f"vc_keys / uv2_keys not in materials: {sorted(unknown)}")
        self.bms = {k: bmesh.new() for k in self.materials}
        self.tri_counts = {k: 0 for k in self.materials}

    @_contextmanager
    def part(self, key: str, uv=("box", 2.0, 2.0), normals="solid", smooth: float | None = None,
             vc=None, cut: float | None = None, cut_axes: str = "xyz", prepare=None, uv2=None):
        if key not in self.bms:
            raise KeyError(f"MeshKit has no material key '{key}' (known: {sorted(self.bms)})")
        bm = bmesh.new()
        yield bm
        if len(bm.faces) == 0:
            bm.free()
            return
        bm.normal_update()
        # --- normals ---
        if normals is not None:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            if isinstance(normals, Vector):
                self._flip_islands_facing(bm, normals)
        # --- optional custom cutting (e.g. ashlar_block_tint) / grid subdivision for vertex-colour variation ---
        if prepare is not None:
            prepare(bm)
        if cut is not None and vc is not None and key in self.vc_keys:
            grid_cut(bm, step=cut, axes=cut_axes)
        bm.normal_update()
        # --- UVs ---
        if uv is not None:
            if callable(uv):
                uv(bm)
            else:
                mode = uv[0]
                if mode == "box":
                    tu, tv = uv[1], uv[2]
                    ou = uv[3] if len(uv) > 3 else 0.0
                    ov = uv[4] if len(uv) > 4 else 0.0
                    r90 = bool(uv[5]) if len(uv) > 5 else False
                    _uv_box_offset(bm, tu, tv, False, ou, ov, r90)
                elif mode == "slope":
                    tu, tv = uv[1], uv[2]
                    ou = uv[3] if len(uv) > 3 else 0.0
                    ov = uv[4] if len(uv) > 4 else 0.0
                    _uv_box_offset(bm, tu, tv, True, ou, ov, False)
                elif mode == "fit":
                    apply_face_fit_uv(bm)
                elif mode == "rect":
                    _uv_rect(bm, uv[1:5])
                elif mode == "planar":
                    rect = uv[6] if len(uv) > 6 else (0.0, 0.0, 1.0, 1.0)
                    _uv_planar(bm, uv[1], uv[2], uv[3], uv[4], uv[5], rect)
                else:
                    raise ValueError(f"Unknown uv mode {mode!r}")
        else:
            bm.loops.layers.uv.verify()
        # --- second UV set (light-pool / lightmap coordinates); (0, 0) = unlit corner of a clamped glow map ---
        if key in self.uv2_keys:
            layer2 = bm.loops.layers.uv.get(UV2_LAYER) or bm.loops.layers.uv.new(UV2_LAYER)
            for f in bm.faces:
                for loop in f.loops:
                    loop[layer2].uv = uv2(loop.vert.co) if uv2 is not None else (0.0, 0.0)
        # --- shading ---
        if smooth is not None:
            limit = math.radians(smooth)
            for f in bm.faces:
                f.smooth = True
            for e in bm.edges:
                if len(e.link_faces) == 2:
                    e.smooth = e.calc_face_angle(0.0) <= limit
                else:
                    e.smooth = False
        # --- vertex colours ---
        if key in self.vc_keys:
            layer = bm.loops.layers.float_color.get(VERTEX_COLOR_LAYER) or bm.loops.layers.float_color.new(VERTEX_COLOR_LAYER)
            per_face = bool(getattr(vc, "uses_face_center", False))
            for f in bm.faces:
                center = f.calc_center_median() if per_face else None
                for loop in f.loops:
                    if vc is None:
                        loop[layer] = (0.9, 0.9, 0.9, 1.0)
                    elif per_face:
                        r, g, b = vc(loop.vert.co, f.normal, center)
                        loop[layer] = (r, g, b, 1.0)
                    else:
                        r, g, b = vc(loop.vert.co, f.normal)
                        loop[layer] = (r, g, b, 1.0)
        # --- merge into the per-material mesh ---
        self.tri_counts[key] += sum(len(f.verts) - 2 for f in bm.faces)
        tmp = bpy.data.meshes.new("_kit_part")
        bm.to_mesh(tmp)
        bm.free()
        dest = self.bms[key]
        if key in self.vc_keys and dest.loops.layers.float_color.get(VERTEX_COLOR_LAYER) is None:
            dest.loops.layers.float_color.new(VERTEX_COLOR_LAYER)
        dest.loops.layers.uv.verify()
        if key in self.uv2_keys and dest.loops.layers.uv.get(UV2_LAYER) is None:
            dest.loops.layers.uv.new(UV2_LAYER)
        dest.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    @staticmethod
    def _flip_islands_facing(bm, inside_point: Vector):
        """Flip each connected island whose (area-weighted) normals point toward `inside_point`."""
        bm.faces.ensure_lookup_table()
        seen = set()
        for f0 in bm.faces:
            if f0.index in seen:
                continue
            island, stack = [], [f0]
            seen.add(f0.index)
            while stack:
                f = stack.pop()
                island.append(f)
                for e in f.edges:
                    for g in e.link_faces:
                        if g.index not in seen:
                            seen.add(g.index)
                            stack.append(g)
            score = sum(f.normal.dot(f.calc_center_median() - inside_point) * f.calc_area() for f in island)
            if score < 0.0:
                bmesh.ops.reverse_faces(bm, faces=island)

    def total_triangles(self) -> int:
        return sum(self.tri_counts.values())

    def finalize(self, prefix: str, collection) -> list:
        """Create one object per non-empty material key (named '<prefix>_<key>') and return them."""
        objects = []
        for key, bm in self.bms.items():
            if len(bm.faces) == 0:
                bm.free()
                continue
            mesh = bpy.data.meshes.new(f"{prefix}_{key}")
            bm.to_mesh(mesh)
            bm.free()
            if key in self.vc_keys:
                attr = mesh.color_attributes.get(VERTEX_COLOR_LAYER)
                if attr is None:
                    raise RuntimeError(f"MeshKit: vertex colour layer missing on '{key}'")
                mesh.color_attributes.active_color = attr
                mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(attr)
            mesh.update()
            obj = bpy.data.objects.new(f"{prefix}_{key}", mesh)
            obj.data.materials.append(self.materials[key])
            collection.objects.link(obj)
            objects.append(obj)
        self.bms = {}
        return objects


# ---------------------------------------------------------------------------
# Openings, wall panels with real holes, extrusions
# ---------------------------------------------------------------------------

def opening_outline(cx: float, z0: float, width: float, height: float, kind: str = "rect",
                    segs: int = 12, rise: float | None = None) -> list[tuple[float, float]]:
    """
    Outline of a wall opening as (x, z) points in local wall coordinates, ordered counter-clockwise as seen
    from OUTSIDE: bottom-right -> up the right jamb -> over the head -> down the left jamb -> bottom-left.
    kind: 'rect' | 'round' (semicircle) | 'segmental' (flat arc, `rise` default width*0.18)
          | 'pointed' (two-centred Gothic arch, `rise` default width*0.80) | 'oval' (full ellipse, z0 = bottom)
    `height` is the total clear height including the arch.
    """
    hw = width * 0.5
    if kind == "rect":
        return [(cx + hw, z0), (cx + hw, z0 + height), (cx - hw, z0 + height), (cx - hw, z0)]
    if kind == "oval":
        hz = height * 0.5
        n = max(8, segs * 2)
        return [(cx + hw * math.cos(2 * math.pi * i / n - math.pi * 0.5),
                 z0 + hz + hz * math.sin(2 * math.pi * i / n - math.pi * 0.5)) for i in range(n)]
    if kind == "round":
        r = hw
        zs = z0 + height - r
        pts = [(cx + hw, z0)]
        for i in range(segs + 1):
            a = math.pi * i / segs
            pts.append((cx + r * math.cos(a), zs + r * math.sin(a)))
        pts.append((cx - hw, z0))
        return pts
    if kind == "segmental":
        rise = width * 0.18 if rise is None else rise
        R = (hw * hw + rise * rise) / (2.0 * rise)
        zs = z0 + height - rise
        a0 = math.asin(hw / R)
        pts = [(cx + hw, z0)]
        for i in range(segs + 1):
            a = a0 - 2.0 * a0 * i / segs
            pts.append((cx + R * math.sin(a), zs - (R - rise) + R * math.cos(a)))
        pts.append((cx - hw, z0))
        return pts
    if kind == "pointed":
        rise = width * 0.80 if rise is None else rise
        R = (hw * hw + rise * rise) / (2.0 * hw)
        zs = z0 + height - rise
        a_top = math.atan2(rise, R - hw)  # angle of the apex seen from the right arc's centre (cx + hw - R, zs)
        half = max(2, segs // 2)
        pts = [(cx + hw, z0)]
        # right arc: centre (cx + hw - R, zs), from angle 0 up to the apex
        for i in range(half + 1):
            a = a_top * i / half
            pts.append((cx + hw - R + R * math.cos(a), zs + R * math.sin(a)))
        # left arc mirrored, from the apex back down
        for i in range(half - 1, -1, -1):
            a = a_top * i / half
            pts.append((cx - hw + R - R * math.cos(a), zs + R * math.sin(a)))
        pts.append((cx - hw, z0))
        return pts
    raise ValueError(f"Unknown opening kind {kind!r}")


def offset_outline(outline: list[tuple[float, float]], dist: float, closed: bool = False) -> list[tuple[float, float]]:
    """Offset an opening outline (ordered as opening_outline) outward by `dist` (mitred). For open outlines the
    two end points are moved sideways only, so jambs stay vertical and end at the same sill height."""
    n = len(outline)
    out = []
    for i in range(n):
        p = Vector((outline[i][0], outline[i][1]))
        if closed:
            a = Vector(outline[(i - 1) % n]); b = Vector(outline[(i + 1) % n])
        else:
            a = Vector(outline[i - 1]) if i > 0 else None
            b = Vector(outline[i + 1]) if i < n - 1 else None
        normals = []
        if a is not None:
            t = (p - a).normalized(); normals.append(Vector((t.y, -t.x)))
        if b is not None:
            t = (b - p).normalized(); normals.append(Vector((t.y, -t.x)))
        nrm = sum(normals, Vector((0.0, 0.0)))
        if nrm.length < 1e-6:
            nrm = normals[0]
        nrm.normalize()
        scale = 1.0 / max(nrm.dot(normals[0]), 0.35)
        q = p + nrm * dist * scale
        out.append((q.x, q.y))
    return out


def wall_frame(cx: float, cy: float, rot_z: float) -> Matrix:
    """Local wall frame (see the convention at the top of this toolkit): origin (cx, cy, 0), rotated about Z so
    that local -Y is the outward normal. rot_z: 0 = south-facing, +pi/2 = east, pi = north, -pi/2 = west."""
    return Matrix.Translation((cx, cy, 0.0)) @ Matrix.Rotation(rot_z, 4, 'Z')


def edge_frame(p0, p1) -> tuple[Matrix, float]:
    """Wall frame of one edge p0 -> p1 of a COUNTER-CLOCKWISE footprint polygon (works for oblique walls):
    origin at the edge midpoint, local +X along the edge, local -Y outward. Returns (matrix, half_length)."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    return wall_frame((p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5, math.atan2(dy, dx)), math.hypot(dx, dy) * 0.5


def notched_outline(x0: float, x1: float, z0: float, z1: float, notches) -> list[tuple[float, float]]:
    """Wall rectangle whose BOTTOM edge is interrupted by door-type openings (each an opening_outline()
    whose sill lies on z0). Use it instead of a hole when an opening starts at the bottom of the panel."""
    pts = [(x0, z0)]
    for o in sorted(notches, key=lambda o: min(p[0] for p in o)):
        pts.extend(reversed(o))
    pts += [(x1, z0), (x1, z1), (x0, z1)]
    return pts


def _loop_area(loop) -> float:
    return 0.5 * sum(loop[i][0] * loop[(i + 1) % len(loop)][1] - loop[(i + 1) % len(loop)][0] * loop[i][1]
                     for i in range(len(loop)))


def triangulate_outline(outline: list[tuple[float, float]], holes=()) -> tuple[list, list]:
    """
    Constrained Delaunay triangulation of a simple 2D polygon with holes.
    Returns (points, triangles) where points are (x, z) tuples and triangles index into them.
    Raises ValueError if the filled area does not match outline minus holes — i.e. when an outline
    self-intersects or a hole leaves the outline — instead of silently producing a broken wall.
    (mathutils.geometry.tessellate_polygon mis-fills notched outlines and several holes on one level.)
    """
    loops = [list(outline)] + [list(h) for h in holes]
    pts = [Vector((float(x), float(z))) for lp in loops for (x, z) in lp]
    faces, base = [], 0
    for lp in loops:
        if len(lp) < 3:
            raise ValueError("triangulate_outline: every loop needs at least 3 points")
        faces.append(list(range(base, base + len(lp))))
        base += len(lp)
    verts, _edges, tris, _ov, _oe, _of = _geometry.delaunay_2d_cdt(pts, [], faces, 2, 1e-6)
    out_pts = [(v.x, v.y) for v in verts]
    out_tris = [tuple(t) for t in tris if len(t) == 3]
    expected = abs(_loop_area(loops[0])) - sum(abs(_loop_area(h)) for h in loops[1:])
    got = sum(abs(_loop_area([out_pts[i] for i in t])) for t in out_tris)
    if len(out_pts) != len(pts) or abs(got - expected) > max(1e-4, 0.002 * abs(expected)):
        raise ValueError(
            f"triangulate_outline: invalid polygon (filled area {got:.4f} vs expected {expected:.4f}, "
            f"{len(pts)} points in / {len(out_pts)} out) — outline self-intersects or a hole crosses the outline")
    return out_pts, out_tris


def add_wall_panel(bm: bmesh.types.BMesh, xf: Matrix, outline: list[tuple[float, float]],
                   holes: list[list[tuple[float, float]]] | tuple = (), reveal: float = 0.0, y: float = 0.0):
    """
    Planar wall face with REAL openings. `outline` and each hole are (x, z) loops in local wall coordinates
    (wall plane local Y = y, outward -Y; loop direction does not matter). Every hole gets reveal faces running
    `reveal` metres back into the wall (local +Y), so windows and doors sit in true depth.
    Faces are wound to look outward (-Y), reveals to look into their opening.
    """
    pts, tris = triangulate_outline(outline, holes)
    verts = [bm.verts.new(xf @ Vector((px, y, pz))) for px, pz in pts]
    for a, b, c in tris:
        pa, pb, pc = pts[a], pts[b], pts[c]
        ccw = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0.0
        # counter-clockwise in (x, z) seen from outside == normal toward -Y
        bm.faces.new([verts[a], verts[b], verts[c]] if ccw else [verts[a], verts[c], verts[b]])
    if reveal > 0.0:
        new_verts = list(verts)
        for h in holes:
            h = list(h)
            if _loop_area(h) < 0.0:
                h.reverse()
            front = [bm.verts.new(xf @ Vector((px, y, pz))) for px, pz in h]
            back = [bm.verts.new(xf @ Vector((px, y + reveal, pz))) for px, pz in h]
            n = len(h)
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new([front[i], front[j], back[j], back[i]])
            new_verts += front
        bmesh.ops.remove_doubles(bm, verts=new_verts, dist=1e-6)


def add_extruded_outline(bm: bmesh.types.BMesh, xf: Matrix, outline: list[tuple[float, float]],
                         y0: float, y1: float, holes: list[list[tuple[float, float]]] | tuple = (),
                         cap_front: bool = True, cap_back: bool = True):
    """Extrude an (x, z) outline (with optional holes, e.g. tracery) from local Y = y0 (front, toward the
    viewer) to y1 (back). Loop direction does not matter; all faces are wound to look out of the solid."""
    pts, tris = triangulate_outline(outline, holes)
    front = [bm.verts.new(xf @ Vector((px, y0, pz))) for px, pz in pts] if cap_front else []
    back = [bm.verts.new(xf @ Vector((px, y1, pz))) for px, pz in pts] if cap_back else []
    for a, b, c in tris:
        pa, pb, pc = pts[a], pts[b], pts[c]
        ccw = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0.0
        order = (a, b, c) if ccw else (a, c, b)
        if cap_front:
            bm.faces.new([front[i] for i in order])
        if cap_back:
            bm.faces.new([back[i] for i in reversed(order)])
    weld = front + back
    for k, lp in enumerate([list(outline)] + [list(h) for h in holes]):
        # outer loop clockwise / holes counter-clockwise (seen from the front) gives outward side faces
        want_ccw = k > 0
        if (_loop_area(lp) > 0.0) != want_ccw:
            lp.reverse()
        f_ring = [bm.verts.new(xf @ Vector((px, y0, pz))) for px, pz in lp]
        b_ring = [bm.verts.new(xf @ Vector((px, y1, pz))) for px, pz in lp]
        n = len(lp)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([f_ring[i], f_ring[j], b_ring[j], b_ring[i]])
        weld += f_ring + b_ring
    bmesh.ops.remove_doubles(bm, verts=weld, dist=1e-6)


def add_ashlar_wall(kit, key: str, mortar_key: str, xf: Matrix, outline, holes=(), *, tile: float,
                    off_u: float = 0.0, off_v: float = 0.0, base=None, amp: float = 0.2, hue: float = 0.06,
                    seed: int = 0, joint: float = 0.010, repair: float = 0.02, violet: float = 0.12,
                    y: float = 0.0, normals=None, layout: dict | None = None, mortar_vc=None,
                    mortar_cut: float = 0.9):
    """
    Complete stone-by-stone ashlar wall face on `kit` (a MeshKit): the library scan cut into its own stones
    (ashlar_block_tint: individual tint, weathering from `base`), every stone shrunk by an open joint, and a
    mortar-coloured backing panel (material key `mortar_key`) 6 mm behind that shows through the joints.
    `outline` / `holes` as for add_wall_panel; `key` must be in the kit's vc_keys. If `mortar_key` is a
    vertex-coloured material too, `mortar_vc` (e.g. a neutral weather_tint) weathers the joints with the wall.
    """
    prep, vcb = ashlar_block_tint(tile, off_u, off_v, base=base, amp=amp, hue=hue, seed=seed, layout=layout,
                                  joint=joint, repair=repair, violet=violet)
    with kit.part(key, uv=("box", tile, tile, off_u, off_v), normals=normals, vc=vcb, prepare=prep) as bm:
        add_wall_panel(bm, xf, outline, holes, y=y)
    if joint > 0.0:
        with kit.part(mortar_key, uv=("box", 1.0, 1.0), normals=normals, vc=mortar_vc,
                      cut=mortar_cut if mortar_vc is not None else None) as bm:
            add_wall_panel(bm, xf, outline, holes, y=y + 0.006)


# ---------------------------------------------------------------------------
# Sweeps, lathes, tubes
# ---------------------------------------------------------------------------

def sweep_profile(bm: bmesh.types.BMesh, path: list, profile: list[tuple[float, float]], up: Vector,
                  closed: bool = False, profile_closed: bool = False, cap_ends: bool = True,
                  matrix: Matrix | None = None):
    """
    Sweep a 2D profile along a planar 3D polyline with mitred corners (cornices, string courses, arch
    mouldings, copings, gutters, handrails).
    - `path`: points lying in a plane perpendicular to `up`.
    - `profile`: (u, v) offsets; v is measured along `up`, u along `tangent x up`. For a path that runs
      counter-clockwise around a building (seen from above, up = +Z) u therefore points OUTWARD; for an
      opening outline from opening_outline() with up = wall outward normal (0, -1, 0) u points away from
      the opening (into the surrounding wall face) and v out of the wall.
    - `closed`: path is a loop.  `profile_closed`: profile is a closed section (free-standing members).
    - `matrix`: optional transform applied to the result.
    """
    pts = [Vector(p) for p in path]
    n = len(pts)
    if n < 2:
        return
    if len(pts[0]) != 3:
        raise ValueError("sweep_profile needs 3D path points (use outline_path() for (x, z) wall outlines)")
    upn = Vector(up).normalized()
    rings = []
    for i in range(n):
        prev_d = None
        next_d = None
        if closed or i > 0:
            d = pts[i] - pts[i - 1]
            if d.length > 1e-9:
                prev_d = d.normalized()
        if closed or i < n - 1:
            d = pts[(i + 1) % n] - pts[i]
            if d.length > 1e-9:
                next_d = d.normalized()
        na = prev_d.cross(upn) if prev_d is not None else None
        nb = next_d.cross(upn) if next_d is not None else None
        if na is None:
            side, scale = nb, 1.0
        elif nb is None:
            side, scale = na, 1.0
        else:
            side = na + nb
            if side.length < 1e-6:
                side, scale = na, 1.0
            else:
                side.normalize()
                scale = 1.0 / max(side.dot(na), 0.25)
        ring = []
        for u, v in profile:
            p = pts[i] + side * (u * scale) + upn * v
            if matrix is not None:
                p = matrix @ p
            ring.append(bm.verts.new(p))
        rings.append(ring)
    m = len(profile)
    seg_count = n if closed else n - 1
    for i in range(seg_count):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(m - 1 if not profile_closed else m):
            k = (j + 1) % m
            try:
                bm.faces.new([r0[j], r1[j], r1[k], r0[k]])
            except ValueError:
                pass
    if cap_ends and not closed and m >= 3:
        try:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        except ValueError:
            pass


def outline_path(outline: list[tuple[float, float]], y: float = 0.0) -> list:
    """(x, z) wall outline -> 3D path in the local wall plane (for sweep_profile with up = (0, -1, 0))."""
    return [Vector((x, y, z)) for x, z in outline]


def rect_path(x0: float, y0: float, x1: float, y1: float, z: float) -> list:
    """Counter-clockwise rectangle (seen from above) at height z — a closed sweep_profile path."""
    return [Vector((x0, y0, z)), Vector((x1, y0, z)), Vector((x1, y1, z)), Vector((x0, y1, z))]


def add_lathe(bm: bmesh.types.BMesh, profile_rz: list[tuple[float, float]], segments: int = 16,
              matrix: Matrix | None = None, cap_bottom: bool = True, cap_top: bool = True):
    """Revolve an (r, z) profile around local Z (finials, orbs, urns, lamp heads, balusters, round frames)."""
    mat = matrix or Matrix.Identity(4)
    rings = []
    for r, z in profile_rz:
        if r <= 1e-6:
            rings.append([bm.verts.new(mat @ Vector((0.0, 0.0, z)))])
        else:
            rings.append([bm.verts.new(mat @ Vector((r * math.cos(2 * math.pi * s / segments),
                                                     r * math.sin(2 * math.pi * s / segments), z)))
                          for s in range(segments)])
    for a, b in zip(rings[:-1], rings[1:]):
        for s in range(segments):
            t = (s + 1) % segments
            try:
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    bm.faces.new([a[0], b[s], b[t]])
                elif len(b) == 1:
                    bm.faces.new([a[s], a[t], b[0]])
                else:
                    bm.faces.new([a[s], a[t], b[t], b[s]])
            except ValueError:
                pass
    if cap_bottom and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])


def add_tube(bm: bmesh.types.BMesh, pts: list, radius: float, segments: int = 8,
             closed: bool = False, cap: bool = True):
    """Round pipe along a 3D polyline with mitred bends (downpipes, handrails, lightning conductors, poles)."""
    P = [Vector(p) for p in pts]
    n = len(P)
    if n < 2:
        return
    tangents = []
    for i in range(n):
        if closed:
            t = (P[(i + 1) % n] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
        elif i == 0:
            t = P[1] - P[0]
        elif i == n - 1:
            t = P[-1] - P[-2]
        else:
            t = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
        if t.length < 1e-9:
            t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        tangents.append(t.normalized())
    ref = Vector((0.0, 0.0, 1.0))
    if abs(tangents[0].dot(ref)) > 0.95:
        ref = Vector((1.0, 0.0, 0.0))
    nrm = (ref - tangents[0] * ref.dot(tangents[0])).normalized()
    rings = []
    for i in range(n):
        t = tangents[i]
        nrm = (nrm - t * nrm.dot(t))
        if nrm.length < 1e-6:
            nrm = t.orthogonal()
        nrm.normalize()
        bi = t.cross(nrm)
        # widen at bends so the pipe keeps its section through the mitre
        scale = 1.0
        if 0 < i < n - 1 or closed:
            d_in = (P[i] - P[i - 1]).normalized()
            scale = 1.0 / max(d_in.dot(t), 0.5)
        rings.append([bm.verts.new(P[i] + (nrm * math.cos(2 * math.pi * s / segments)
                                           + bi * math.sin(2 * math.pi * s / segments)) * radius * scale)
                      for s in range(segments)])
    for i in range(n if closed else n - 1):
        a, b = rings[i], rings[(i + 1) % n]
        for s in range(segments):
            t = (s + 1) % segments
            bm.faces.new([a[s], a[t], b[t], b[s]])
    if cap and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])


def add_ridge_tiles(bm: bmesh.types.BMesh, p0: Vector, p1: Vector, radius: float = 0.13,
                    tile_len: float = 0.40, segments: int = 6, lap: float = 0.05, up: Vector | None = None):
    """Individual overlapping half-round ridge / hip tiles (Firstziegel) from p0 to p1. Each tile is a tapered
    half pipe, slightly lifted at its head so the lap reads as a real joint line."""
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    length = axis.length
    if length < 1e-4:
        return
    t = axis / length
    upv = Vector(up) if up is not None else Vector((0.0, 0.0, 1.0))
    upv = (upv - t * upv.dot(t))
    if upv.length < 1e-6:
        upv = t.orthogonal()
    upv.normalize()
    side = t.cross(upv)
    count = max(1, round(length / tile_len))
    step = length / count
    for i in range(count):
        a = p0 + t * (i * step - lap * 0.5)
        b = p0 + t * ((i + 1) * step + lap * 0.5)
        ra, rb = radius * 1.0, radius * 1.12
        ring_a, ring_b = [], []
        for s in range(segments + 1):
            ang = math.pi * s / segments
            off = side * math.cos(ang) + upv * math.sin(ang)
            ring_a.append(bm.verts.new(a + off * ra))
            ring_b.append(bm.verts.new(b + off * rb + upv * 0.012))
        for s in range(segments):
            bm.faces.new([ring_a[s], ring_b[s], ring_b[s + 1], ring_a[s + 1]])
        bm.faces.new(list(reversed(ring_b)))
        bm.faces.new(ring_a)


def add_step_flight(bm: bmesh.types.BMesh, xf: Matrix, width: float, steps: int, rise: float, going: float,
                    z_top: float, z_bottom: float | None = None, nosing: float = 0.025, side_extra: float = 0.0):
    """
    Straight flight of solid block steps. Local frame: the TOP landing edge is at local Y = 0, the flight
    descends toward local -Y; local X is the width axis (centred). Tread i (0 = top step) has its surface
    at z_top - i*rise. Each block reaches down to `z_bottom` (default: below the lowest tread), so the
    flight can be sunk into uneven ground. `nosing` adds a small projecting tread lip.
    """
    zb = (z_top - steps * rise - 0.4) if z_bottom is None else z_bottom
    for i in range(steps):
        zt = z_top - i * rise
        y1 = -i * going
        y0 = -(i + 1) * going
        w = width + 2.0 * side_extra * i
        mat = xf @ Matrix.Translation((0.0, (y0 + y1) * 0.5, (zt + zb) * 0.5)) @ Matrix.Diagonal((w, going, zt - zb, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
        if nosing > 0.0:
            mat_n = xf @ Matrix.Translation((0.0, y0 - nosing * 0.5, zt - 0.02)) @ Matrix.Diagonal((w + nosing * 2.0, nosing, 0.04, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=mat_n)


# ---------------------------------------------------------------------------
# Site terrain (so forecourts, steps and plinths meet the real ground of the running app)
# ---------------------------------------------------------------------------

class SiteTerrain:
    """
    Bilinear sampler of the app's terrain around one landmark, in the landmark's own Blender frame
    (x east, y north of the GLB origin; heights relative to the manifest baseElevationM).
    The JSON is produced from the running app (see .gfx/kirche-rathaus/probe_terrain.sh):
        {"<landmark key>": {"x0": .., "y0": .., "step": 1, "nx": .., "ny": .., "h": [row-major, y ascending]}}
    """

    def __init__(self, json_path: Path, key: str):
        json_path = Path(json_path)
        if not json_path.exists():
            raise RuntimeError(f"Site terrain probe missing: {json_path}")
        with open(json_path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        if key not in data:
            raise RuntimeError(f"Site terrain probe {json_path.name} has no entry '{key}'")
        g = data[key]
        self.x0, self.y0, self.step = float(g["x0"]), float(g["y0"]), float(g["step"])
        self.nx, self.ny = int(g["nx"]), int(g["ny"])
        self.h = g["h"]
        if len(self.h) != self.nx * self.ny:
            raise RuntimeError(f"Site terrain probe '{key}': expected {self.nx * self.ny} samples, got {len(self.h)}")

    def __call__(self, x: float, y: float) -> float:
        fx = min(max((x - self.x0) / self.step, 0.0), self.nx - 1.001)
        fy = min(max((y - self.y0) / self.step, 0.0), self.ny - 1.001)
        ix, iy = int(fx), int(fy)
        tx, ty = fx - ix, fy - iy
        h = self.h
        a = h[iy * self.nx + ix] * (1 - tx) + h[iy * self.nx + ix + 1] * tx
        b = h[(iy + 1) * self.nx + ix] * (1 - tx) + h[(iy + 1) * self.nx + ix + 1] * tx
        return a * (1 - ty) + b * ty


def add_ground_patch(bm: bmesh.types.BMesh, x0: float, y0: float, x1: float, y1: float, z_fn,
                     step: float = 1.0, skirt_to: float | None = None):
    """Height-field patch over [x0, x1] x [y0, y1] with z = z_fn(x, y) (lawns, paving that must follow the
    terrain). `skirt_to` adds vertical side faces down to that height so the patch never floats."""
    nx = max(1, math.ceil((x1 - x0) / step))
    ny = max(1, math.ceil((y1 - y0) / step))
    grid = [[bm.verts.new((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny,
                           z_fn(x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny)))
             for i in range(nx + 1)] for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            bm.faces.new([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]])
    if skirt_to is not None:
        rim = ([grid[0][i] for i in range(nx + 1)] + [grid[j][nx] for j in range(1, ny + 1)]
               + [grid[ny][i] for i in range(nx - 1, -1, -1)] + [grid[j][0] for j in range(ny - 1, 0, -1)])
        low = [bm.verts.new((v.co.x, v.co.y, skirt_to)) for v in rim]
        n = len(rim)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([rim[j], rim[i], low[i], low[j]])


# ---------------------------------------------------------------------------
# Lettering and sculpted (organic) forms
# ---------------------------------------------------------------------------

def add_text(bm: bmesh.types.BMesh, text: str, xf: Matrix, size: float = 0.1, depth: float = 0.004,
             font_path: str | None = None, align_x: str = "CENTER", resolution: int = 2,
             line_spacing: float = 1.0, flat: bool = False):
    """
    Real 3D lettering (house numbers, inscriptions) from a font. The text stands on the local wall plane:
    baseline along local +X, letters upright along local +Z, centred vertically on xf's origin, front face
    `depth` metres in front of the wall (local -Y). `size` is the cap height scale in metres.
    `flat=True` creates only the front faces (painted / engraved lettering, about a quarter of the triangles).
    """
    curve = bpy.data.curves.new("_txt", type='FONT')
    curve.body = text
    curve.size = size
    curve.extrude = 0.0 if flat else depth * 0.5
    curve.resolution_u = resolution
    curve.align_x = align_x
    curve.align_y = 'CENTER'
    curve.space_line = line_spacing
    if font_path is not None:
        if not os.path.exists(font_path):
            raise RuntimeError(f"Font not found: {font_path}")
        curve.font = bpy.data.fonts.load(font_path, check_existing=True)
    obj = bpy.data.objects.new("_txt", curve)
    bpy.context.scene.collection.objects.link(obj)
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    # curve space (x right, y up, z toward viewer) -> wall space (x right, z up, -y toward viewer)
    conv = Matrix(((1, 0, 0, 0), (0, 0, -1, -depth if flat else -depth * 0.5), (0, 1, 0, 0), (0, 0, 0, 1)))
    mesh.transform(xf @ conv)
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.curves.remove(curve)


def add_sculpted_blobs(bm: bmesh.types.BMesh, ellipsoids: list, xf: Matrix, voxel: float = 0.03,
                       smooth_iterations: int = 8, target_tris: int = 3000):
    """
    Fuse a list of ellipsoids into ONE smooth sculpted skin (statues, animals, topiary) and append it to `bm`.
    ellipsoids: [(centre (x, y, z), radii (rx, ry, rz), euler_xyz_radians or None), ...] in local coordinates.
    Pipeline: UV spheres -> voxel remesh -> smooth -> decimate to about `target_tris` triangles.
    """
    tmp = bmesh.new()
    for centre, radii, rot in ellipsoids:
        m = Matrix.Translation(centre)
        if rot is not None:
            m = m @ Euler(rot, 'XYZ').to_matrix().to_4x4()
        m = m @ Matrix.Diagonal((radii[0], radii[1], radii[2], 1.0))
        bmesh.ops.create_uvsphere(tmp, u_segments=16, v_segments=10, radius=1.0, matrix=m)
    mesh = bpy.data.meshes.new("_blob")
    tmp.to_mesh(mesh)
    tmp.free()
    obj = bpy.data.objects.new("_blob", mesh)
    bpy.context.scene.collection.objects.link(obj)
    rem = obj.modifiers.new("remesh", 'REMESH')
    rem.mode = 'VOXEL'
    rem.voxel_size = voxel
    rem.adaptivity = 0.0
    if smooth_iterations > 0:
        sm = obj.modifiers.new("smooth", 'SMOOTH')
        sm.factor = 0.6
        sm.iterations = smooth_iterations
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    dense = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    dense_tris = sum(len(p.vertices) - 2 for p in dense.polygons)
    if dense_tris == 0:
        raise RuntimeError("add_sculpted_blobs: voxel remesh produced no geometry")
    bpy.data.meshes.remove(dense)
    dec = obj.modifiers.new("decimate", 'DECIMATE')
    dec.decimate_type = 'COLLAPSE'
    dec.ratio = min(1.0, target_tris / dense_tris)
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    out = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    out.transform(xf)
    while out.uv_layers:
        out.uv_layers.remove(out.uv_layers[0])
    bm.from_mesh(out)
    bpy.data.meshes.remove(out)
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)


# ---------------------------------------------------------------------------
# Export: WebP textures, vertex colours, no texture packing into the .blend
# ---------------------------------------------------------------------------

def save_blend_and_export_glb_webp(blend_path: Path, glb_path: Path, objects: list, quality: int = 85):
    """Save the .blend (textures referenced, not packed) and export a Y-up .glb with WebP-embedded textures
    (EXT_texture_webp) and the 'Col' vertex colours of materials that use them."""
    blend_path = Path(blend_path)
    glb_path = Path(glb_path)
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), relative_remap=True)

    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    if not objects:
        raise RuntimeError(f"No objects to export for {glb_path.name}")
    bpy.context.view_layer.objects.active = objects[0]

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format='GLB',
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=quality,
        export_vertex_color='MATERIAL',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
    )
    size_mb = glb_path.stat().st_size / (1024.0 * 1024.0)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects)
    print(f"Exported {glb_path.name}: {size_mb:.2f} MB, {tris} triangles, {len(objects)} objects (WebP q{quality})")
    return size_mb, tris


def save_blend_and_export_glb_draco(blend_path: Path, glb_path: Path, objects: list, draco_level: int = 7):
    """Save the .blend and export a Y-up .glb with Draco-compressed geometry and every image embedded as its
    ORIGINAL file bytes (export_image_format='AUTO': unmodified library JPEGs / atlas PNGs are copied, not
    re-encoded), so a shared-library image name always means identical bytes in every GLB.
    Positions use 16-bit quantisation (sub-millimetre over a 30 m building) so 6 mm mortar joints survive."""
    blend_path = Path(blend_path)
    glb_path = Path(glb_path)
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), relative_remap=True)

    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    if not objects:
        raise RuntimeError(f"No objects to export for {glb_path.name}")
    bpy.context.view_layer.objects.active = objects[0]

    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format='GLB',
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_vertex_color='MATERIAL',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=draco_level,
        export_draco_position_quantization=16,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=14,
        export_draco_color_quantization=10,
        export_draco_generic_quantization=12,
    )
    size_mb = glb_path.stat().st_size / (1024.0 * 1024.0)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects)
    print(f"Exported {glb_path.name}: {size_mb:.2f} MB, {tris} triangles, {len(objects)} objects (Draco, original image bytes)")
    return size_mb, tris
