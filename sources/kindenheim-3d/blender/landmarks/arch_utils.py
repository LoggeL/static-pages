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
