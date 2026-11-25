#!/usr/bin/env python3
"""
Shared Blender 5.2 Vehicle Modeling, Multi-Material Single-Node Merger, 3D Chevron-Lugged
Agricultural Tire Builder, glTF Exporter, and Cycles Preview Renderer for Kindenheim Tractor Game.

STRICT COORDINATE CONTRACT:
- All helper builders take Three.js / glTF Y-up coordinates (gx, gy, gz):
    +X = Left side of vehicle, -X = Right side
    +Y = Up (0.0 = exact tire bottom ground contact!)
    +Z = Forward (front of vehicle), -Z = Rear (hitch side)
- Internally converts to Blender Z-up via gl_to_bl(gx, gy, gz) = (gx, -gz, gy),
  so glTF export (`export_yup=True`) outputs exact Three.js coordinates!
"""

import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector, Euler

TRACTOR_DIR = Path(__file__).resolve().parent
TEX_DIR = TRACTOR_DIR / "textures"
GLB_OUT_DIR = TRACTOR_DIR.parent.parent / "public" / "assets" / "models" / "tractor"
ARTIFACT_DIR = Path("/Users/logge/.gemini/antigravity-cli/brain/570ed9bb-2be2-4946-8ab8-468ce077beea")


def gl_to_bl(gx: float, gy: float, gz: float) -> Vector:
    """Convert Three.js/glTF (gx=Left, gy=Up, gz=Forward) -> Blender (bx=gx, by=-gz, bz=gy)."""
    return Vector((gx, -gz, gy))


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    return scene


def ensure_collection(name: str):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def _load_img(path: Path, colorspace: str):
    img = bpy.data.images.get(path.name)
    if img is None:
        img = bpy.data.images.load(str(path), check_existing=True)
        img.name = path.name
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    return img


def get_pbr_mat(name: str, tex_name: str, normal_strength: float = 1.0,
                rough_override: float | None = None, metal_override: float | None = None,
                coat_weight: float = 0.0, emission_strength: float = 0.0,
                emission_color=None, alpha: float = 1.0):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat

    mat = bpy.data.materials.new(name=name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (520, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (180, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    alb = TEX_DIR / f"{tex_name}_albedo.jpg"
    if alb.exists():
        n = nt.nodes.new("ShaderNodeTexImage")
        n.location = (-360, 260)
        n.image = _load_img(alb, "sRGB")
        nt.links.new(n.outputs["Color"], bsdf.inputs["Base Color"])
        if emission_strength > 0.0 and emission_color is None:
            nt.links.new(n.outputs["Color"], bsdf.inputs["Emission Color"])

    if rough_override is not None:
        bsdf.inputs["Roughness"].default_value = rough_override
    elif (TEX_DIR / f"{tex_name}_roughness.jpg").exists():
        n = nt.nodes.new("ShaderNodeTexImage")
        n.location = (-360, -20)
        n.image = _load_img(TEX_DIR / f"{tex_name}_roughness.jpg", "Non-Color")
        nt.links.new(n.outputs["Color"], bsdf.inputs["Roughness"])

    if metal_override is not None:
        bsdf.inputs["Metallic"].default_value = metal_override
    elif (TEX_DIR / f"{tex_name}_metallic.jpg").exists():
        n = nt.nodes.new("ShaderNodeTexImage")
        n.location = (-360, -280)
        n.image = _load_img(TEX_DIR / f"{tex_name}_metallic.jpg", "Non-Color")
        nt.links.new(n.outputs["Color"], bsdf.inputs["Metallic"])

    if (TEX_DIR / f"{tex_name}_normal.png").exists():
        n = nt.nodes.new("ShaderNodeTexImage")
        n.location = (-360, -540)
        n.image = _load_img(TEX_DIR / f"{tex_name}_normal.png", "Non-Color")
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.location = (-80, -480)
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    if coat_weight > 0.0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat_weight
        bsdf.inputs["Coat Roughness"].default_value = 0.08

    if emission_strength > 0.0:
        if emission_color is not None:
            bsdf.inputs["Emission Color"].default_value = (*emission_color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "blend_method"):
            mat.blend_method = 'BLEND'

    return mat


def get_solid_pbr_mat(name: str, color, roughness: float = 0.35, metallic: float = 0.0,
                      alpha: float = 1.0, emission_color=None, emission_strength: float = 0.0,
                      coat: float = 0.0):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name=name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    if coat > 0.0 and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.06
    if emission_strength > 0.0:
        ec = emission_color if emission_color is not None else color
        bsdf.inputs["Emission Color"].default_value = (*ec, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0 and hasattr(mat, "blend_method"):
        mat.blend_method = 'BLEND'
    return mat


# ---------------------------------------------------------------------------
# Multi-Material Single-Node Mesh Builder (Clean glTF Scene Hierarchy!)
# ---------------------------------------------------------------------------

class MultiMatMesh:
    """Accumulates geometry across multiple materials and builds ONE named Blender Object."""

    def __init__(self, name: str):
        self.name = name
        self.mats: list = []
        self.mat_idx: dict[str, int] = {}
        self.bms: dict[str, bmesh.types.BMesh] = {}
        self.uv_cfg: dict[str, tuple[float, float, bool]] = {}  # (tile_u, tile_v, fit_uv)
        self.smooth_cfg: dict[str, bool] = {}

    def ensure_mat(self, key: str, mat, tile_u: float = 1.0, tile_v: float = 1.0,
                   fit_uv: bool = False, smooth: bool = False):
        if key not in self.bms:
            self.mat_idx[key] = len(self.mats)
            self.mats.append(mat)
            self.bms[key] = bmesh.new()
            self.uv_cfg[key] = (tile_u, tile_v, fit_uv)
            self.smooth_cfg[key] = smooth
        return self.bms[key]

    def add_box_gl(self, key: str, gx: float, gy: float, gz: float,
                   sx: float, sy: float, sz: float,
                   rot_x_deg: float = 0.0, rot_y_deg: float = 0.0, rot_z_deg: float = 0.0):
        """Add oriented box in Three.js glTF coordinates (gx=Left, gy=Up, gz=Forward)."""
        bm = self.bms[key]
        # Build box in local glTF axes, then map vertices through gl_to_bl!
        rot_gl = Euler((math.radians(rot_x_deg), math.radians(rot_y_deg), math.radians(rot_z_deg)), 'YXZ').to_matrix()
        half = Vector((sx * 0.5, sy * 0.5, sz * 0.5))
        center = Vector((gx, gy, gz))
        # 8 corners in glTF local space
        local_corners = [
            Vector((-half.x, -half.y, -half.z)),
            Vector(( half.x, -half.y, -half.z)),
            Vector(( half.x,  half.y, -half.z)),
            Vector((-half.x,  half.y, -half.z)),
            Vector((-half.x, -half.y,  half.z)),
            Vector(( half.x, -half.y,  half.z)),
            Vector(( half.x,  half.y,  half.z)),
            Vector((-half.x,  half.y,  half.z)),
        ]
        verts = []
        for c in local_corners:
            p = center + (rot_gl @ c)
            verts.append(bm.verts.new(gl_to_bl(p.x, p.y, p.z)))
        faces = [
            (0, 3, 2, 1),  # -Z rear
            (4, 5, 6, 7),  # +Z front
            (0, 1, 5, 4),  # -Y bottom
            (3, 7, 6, 2),  # +Y top
            (0, 4, 7, 3),  # -X right
            (1, 2, 6, 5),  # +X left
        ]
        for f in faces:
            bm.faces.new([verts[i] for i in f])

    def add_prism_yz_gl(self, key: str, yz_pts: list[tuple[float, float]], x0: float, x1: float):
        """Extrude a 2D side-profile polygon in Three.js (Y=Up, Z=Forward) along X from x0 to x1."""
        bm = self.bms[key]
        n = len(yz_pts)
        # Ensure CCW in (Z, Y) for consistent winding
        v_r = [bm.verts.new(gl_to_bl(x0, y, z)) for y, z in yz_pts]
        v_l = [bm.verts.new(gl_to_bl(x1, y, z)) for y, z in yz_pts]
        bm.faces.new(list(reversed(v_r)))
        bm.faces.new(v_l)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([v_r[i], v_r[j], v_l[j], v_l[i]])

    def add_tapered_hood_gl(self, key: str, profiles: list[tuple[float, float, float, float, float]]):
        """
        Loft a sleek sculpted tractor hood from rear->front along +Z.
        Each profile = (gz, half_w_bot, half_w_top, y_bot, y_top) -> octagonal/chamfered cross section!
        """
        bm = self.bms[key]
        rings = []
        for gz, hwb, hwt, yb, yt in profiles:
            cham = min(0.11, (hwb - hwt) * 0.6 + 0.08)
            ym = yt - cham * 1.15
            pts = [
                (-hwb, yb),
                (-hwb, ym),
                (-hwt, yt),
                ( hwt, yt),
                ( hwb, ym),
                ( hwb, yb),
            ]
            rings.append([bm.verts.new(gl_to_bl(px, py, gz)) for px, py in pts])

        for r in range(len(rings) - 1):
            r0, r1 = rings[r], rings[r + 1]
            m = len(r0)
            for i in range(m):
                j = (i + 1) % m
                bm.faces.new([r0[i], r0[j], r1[j], r1[i]])
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])

    def add_cyl_gl(self, key: str, gx: float, gy: float, gz: float,
                   r0: float, r1: float, length: float, axis: str = 'Y',
                   segments: int = 16, cap_ends: bool = True,
                   rot_x_deg: float = 0.0, rot_y_deg: float = 0.0, rot_z_deg: float = 0.0):
        """Add cylinder/cone along Three.js axis 'X', 'Y', or 'Z'."""
        bm = self.bms[key]
        # Start in Blender cone along local Z, orient to axis in Blender coords:
        # glTF X -> Blender X (rot Y 90)
        # glTF Y -> Blender Z (identity!)
        # glTF Z -> Blender -Y (rot X 90)
        if axis == 'X':
            ax_m = Matrix.Rotation(math.pi * 0.5, 4, 'Y')
        elif axis == 'Z':
            ax_m = Matrix.Rotation(math.pi * 0.5, 4, 'X')
        else:
            ax_m = Matrix.Identity(4)

        # Optional extra rotation in Blender space mapped from glTF Euler
        # glTF rot X -> Blender rot X; glTF rot Y -> Blender rot Z; glTF rot Z -> Blender rot -Y
        extra = (Matrix.Rotation(math.radians(rot_y_deg), 4, 'Z')
                 @ Matrix.Rotation(math.radians(rot_x_deg), 4, 'X')
                 @ Matrix.Rotation(math.radians(-rot_z_deg), 4, 'Y'))
        mat = Matrix.Translation(gl_to_bl(gx, gy, gz)) @ extra @ ax_m
        bmesh.ops.create_cone(
            bm, cap_ends=cap_ends, cap_tris=False, segments=segments,
            radius1=r0, radius2=r1, depth=length, matrix=mat
        )

    def add_tube_gl(self, key: str, p0_gl: tuple, p1_gl: tuple, radius: float, segments: int = 10):
        """Add structural bar/tube connecting two Three.js points."""
        bm = self.bms[key]
        a = gl_to_bl(*p0_gl)
        b = gl_to_bl(*p1_gl)
        vec = b - a
        if vec.length < 1e-5:
            return
        mid = (a + b) * 0.5
        quat = Vector((0, 0, 1)).rotation_difference(vec.normalized())
        mat = Matrix.Translation(mid) @ quat.to_matrix().to_4x4()
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=segments,
            radius1=radius, radius2=radius, depth=vec.length + radius * 0.4, matrix=mat
        )

    def add_single_sided_quad_gl(self, key: str, pts_gl: list[tuple[float, float, float]]):
        """Add a single-sided outward-facing quad (used for cab glass & decals like dashboard/plate!)."""
        bm = self.bms[key]
        verts = [bm.verts.new(gl_to_bl(*p)) for p in pts_gl]
        f = bm.faces.new(verts)
        return f

    def build_object(self, collection, location_gl=(0.0, 0.0, 0.0), rot_gl_deg=(0.0, 0.0, 0.0),
                     parent=None, keep_winding_keys: set | None = None):
        """Merge all material buffers into ONE clean Blender mesh object with proper UVs & normals."""
        keep_winding_keys = keep_winding_keys or set()
        merged = bmesh.new()
        uv_dst = merged.loops.layers.uv.verify()

        for key, bm in self.bms.items():
            if len(bm.verts) == 0:
                bm.free()
                continue
            if key not in keep_winding_keys:
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.normal_update()

            tu, tv, fit_uv = self.uv_cfg[key]
            m_i = self.mat_idx[key]
            is_smooth = self.smooth_cfg[key]

            # Copy into merged bmesh with material index & UVs
            bm.verts.index_update()
            v_map = {v.index: merged.verts.new(v.co) for v in bm.verts}
            for f in bm.faces:
                try:
                    nf = merged.faces.new([v_map[v.index] for v in f.verts])
                except ValueError:
                    continue
                nf.material_index = m_i
                nf.smooth = is_smooth

                n = f.normal
                if fit_uv:
                    # Fit quad cleanly to [0, 1] x [0, 1] (preserve order for quads!)
                    if len(nf.loops) == 4:
                        uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
                        for lp, uv in zip(nf.loops, uvs):
                            lp[uv_dst].uv = uv
                    else:
                        # Generic projection fit
                        ax = Vector((1, 0, 0)) if abs(n.x) < 0.8 else Vector((0, 1, 0))
                        u_ax = n.cross(ax).normalized()
                        v_ax = u_ax.cross(n).normalized()
                        us = [lp.vert.co.dot(u_ax) for lp in nf.loops]
                        vs = [lp.vert.co.dot(v_ax) for lp in nf.loops]
                        u0, u1 = min(us), max(us)
                        v0, v1 = min(vs), max(vs)
                        for lp, u, v in zip(nf.loops, us, vs):
                            lp[uv_dst].uv = ((u - u0) / max(u1 - u0, 1e-5), (v - v0) / max(v1 - v0, 1e-5))
                else:
                    # Clean box/triplanar metric UV projection
                    if abs(n.z) > 0.72:
                        u_ax, v_ax = Vector((1, 0, 0)), Vector((0, 1, 0))
                    elif abs(n.x) > 0.72:
                        u_ax, v_ax = Vector((0, 1, 0)), Vector((0, 0, 1))
                    else:
                        u_ax, v_ax = Vector((1, 0, 0)), Vector((0, 0, 1))
                    for lp in nf.loops:
                        co = lp.vert.co
                        lp[uv_dst].uv = (co.dot(u_ax) / tu, co.dot(v_ax) / tv)
            bm.free()

        mesh = bpy.data.meshes.new(self.name)
        merged.to_mesh(mesh)
        merged.free()
        mesh.update()

        obj = bpy.data.objects.new(self.name, mesh)
        for m in self.mats:
            obj.data.materials.append(m)
        obj.location = gl_to_bl(*location_gl)
        rx, ry, rz = rot_gl_deg
        obj.rotation_euler = Euler((math.radians(rx), math.radians(-rz), math.radians(ry)), 'XYZ')
        collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        return obj


# ---------------------------------------------------------------------------
# 3D Deep-Lugged Agricultural Wheel Builder (Exact Origin at Hub Center!)
# ---------------------------------------------------------------------------

def build_agri_wheel(
    name: str,
    collection,
    pos_gl: tuple[float, float, float],
    outer_radius: float,
    width: float,
    is_left: bool,
    mat_tire,
    mat_rim,
    mat_hub,
    mat_chrome,
    lug_pairs: int = 16,
    lug_height: float = 0.055,
    rim_ratio: float = 0.56,
):
    """
    Create ONE named agricultural wheel node (`Wheel_FL`, etc.) whose local origin is at exact
    axle hub center (0, 0, 0), rolling cleanly around local X, with tire bottom at Y = -outer_radius
    (so world Y = pos_gl[1] - outer_radius = 0.000m!).
    Includes curved tire carcass, 3D alternating chevron V-lugs (Ackerstollen), deep-dish enameled
    rim, 8 chrome lug bolts, and central planetary reduction hub cap facing OUTWARD!
    """
    mm = MultiMatMesh(name)
    mm.ensure_mat("tire", mat_tire, tile_u=0.6, tile_v=0.6, smooth=True)
    mm.ensure_mat("lugs", mat_tire, tile_u=0.4, tile_v=0.4, smooth=False)
    mm.ensure_mat("rim", mat_rim, tile_u=0.8, tile_v=0.8, smooth=True)
    mm.ensure_mat("hub", mat_hub, tile_u=0.5, tile_v=0.5, smooth=True)
    mm.ensure_mat("chrome", mat_chrome, tile_u=0.4, tile_v=0.4, smooth=True)

    r_carcass = outer_radius - lug_height
    r_rim = outer_radius * rim_ratio
    hw = width * 0.5
    out_sgn = 1.0 if is_left else -1.0  # +X outward on Left wheels, -X outward on Right wheels

    # 1. Curved agricultural tire carcass lathe around X axis (28 radial segments)
    bm_t = mm.bms["tire"]
    n_rad = 28
    # Cross-section profile (x_off, radius) from inner side -> tread -> outer side -> bead
    prof = [
        (-hw * 0.80, r_rim * 0.96),
        (-hw * 0.96, r_rim + (r_carcass - r_rim) * 0.35),
        (-hw * 1.00, r_rim + (r_carcass - r_rim) * 0.72),
        (-hw * 0.86, r_carcass * 0.985),
        (-hw * 0.45, r_carcass),
        ( hw * 0.45, r_carcass),
        ( hw * 0.86, r_carcass * 0.985),
        ( hw * 1.00, r_rim + (r_carcass - r_rim) * 0.72),
        ( hw * 0.96, r_rim + (r_carcass - r_rim) * 0.35),
        ( hw * 0.80, r_rim * 0.96),
    ]
    rings = []
    for s in range(n_rad):
        a = 2.0 * math.pi * s / n_rad
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for px, pr in prof:
            # In glTF: X = px, Y = pr*cos(a), Z = pr*sin(a)
            ring.append(bm_t.verts.new(gl_to_bl(px, pr * ca, pr * sa)))
        rings.append(ring)

    m = len(prof)
    for s in range(n_rad):
        sn = (s + 1) % n_rad
        for i in range(m - 1):
            bm_t.faces.new([rings[s][i], rings[sn][i], rings[sn][i + 1], rings[s][i + 1]])
        # Close inner rim bead wall
        bm_t.faces.new([rings[s][m - 1], rings[sn][m - 1], rings[sn][0], rings[s][0]])

    # 2. Authentic 3D Alternating Chevron V-Lugs (Ackerstollen) reaching EXACTLY outer_radius!
    bm_l = mm.bms["lugs"]
    lug_w = width * 0.46
    lug_thick = max(0.048, (2.0 * math.pi * r_carcass / lug_pairs) * 0.28)
    for i in range(lug_pairs):
        for side_idx, sx_sgn in enumerate((-1.0, 1.0)):
            # Stagger right & left chevron bars by half pitch (real tractor V-tread!)
            ang = 2.0 * math.pi * (i + side_idx * 0.5) / lug_pairs
            # Bar runs from near center (x = sx_sgn * 0.03) outward to shoulder (x = sx_sgn * hw * 0.88)
            # Swept backward toward shoulder so V points FORWARD (+Z) at top of tire!
            ang_in = ang + 0.14
            ang_out = ang - 0.16
            x_in = sx_sgn * (width * 0.02)
            x_out = sx_sgn * (hw * 0.88)
            r_in = r_carcass - 0.015
            r_top = outer_radius  # Exact tire outer radius -> bottom touches Y = 0.000m!
            da = lug_thick / max(r_carcass, 0.2) * 0.5

            def lv(x, r, a):
                return bm_l.verts.new(gl_to_bl(x, r * math.cos(a), r * math.sin(a)))

            v = [
                lv(x_in,  r_in,  ang_in - da),
                lv(x_in,  r_in,  ang_in + da),
                lv(x_out, r_in,  ang_out + da),
                lv(x_out, r_in,  ang_out - da),
                lv(x_in,  r_top, ang_in - da * 0.72),
                lv(x_in,  r_top, ang_in + da * 0.72),
                lv(x_out, r_top, ang_out + da * 0.72),
                lv(x_out, r_top, ang_out - da * 0.72),
            ]
            bm_l.faces.new([v[4], v[5], v[6], v[7]])  # top tread pad
            bm_l.faces.new([v[0], v[3], v[2], v[1]])  # base
            bm_l.faces.new([v[0], v[1], v[5], v[4]])
            bm_l.faces.new([v[1], v[2], v[6], v[5]])
            bm_l.faces.new([v[2], v[3], v[7], v[6]])
            bm_l.faces.new([v[3], v[0], v[4], v[7]])

    # 3. Authentic Deep-Dish Enameled Steel Wheel Rim + Protruding Dark Planetary Hub & 8 Chrome Bolts!
    # Outer hollow barrel ring (open outer face so you see genuine wheel dish depth!)
    bm_r = mm.bms["rim"]
    barrel_segs = 28
    # Cross-section for a deep-dish agricultural rim (outer lip -> outer barrel -> recessed dish -> inner barrel)
    # Build in local X along out_sgn direction so outer face is always deeply dished!
    rim_prof = [
        (-out_sgn * width * 0.36, r_rim * 0.98),
        ( out_sgn * width * 0.38, r_rim * 0.98),
        ( out_sgn * width * 0.41, r_rim * 1.035),  # rolled outer lip flange!
        ( out_sgn * width * 0.37, r_rim * 0.90),
        ( out_sgn * width * 0.14, r_rim * 0.86),   # deep-dish barrel wall recessed inward!
        ( out_sgn * width * 0.08, r_rim * 0.42),   # recessed wheel center dish plate
        (-out_sgn * width * 0.12, r_rim * 0.42),
        (-out_sgn * width * 0.36, r_rim * 0.90),
    ]
    r_rings = []
    for s in range(barrel_segs):
        a = 2.0 * math.pi * s / barrel_segs
        ca, sa = math.cos(a), math.sin(a)
        r_rings.append([bm_r.verts.new(gl_to_bl(px, pr * ca, pr * sa)) for px, pr in rim_prof])
    rm = len(rim_prof)
    for s in range(barrel_segs):
        sn = (s + 1) % barrel_segs
        for i in range(rm):
            inext = (i + 1) % rm
            bm_r.faces.new([r_rings[s][i], r_rings[sn][i], r_rings[sn][inext], r_rings[s][inext]])

    # Inner hub plate closing the center dish + protruding heavy dark-steel planetary reduction hub!
    mm.add_cyl_gl("rim", out_sgn * width * 0.06, 0.0, 0.0, r_rim * 0.46, r_rim * 0.46, width * 0.14, axis='X', segments=20)
    mm.add_cyl_gl("hub", out_sgn * width * 0.22, 0.0, 0.0, r_rim * 0.36, r_rim * 0.31, width * 0.28, axis='X', segments=18)
    mm.add_cyl_gl("hub", out_sgn * width * 0.37, 0.0, 0.0, r_rim * 0.24, r_rim * 0.20, 0.06, axis='X', segments=16)
    mm.add_cyl_gl("chrome", out_sgn * width * 0.405, 0.0, 0.0, r_rim * 0.11, r_rim * 0.10, 0.03, axis='X', segments=12)
    # 8 crisp chrome lug nuts around the wheel dish bolt circle + 6 hub-cap bolts
    bolt_r = r_rim * 0.52
    for k in range(8):
        a = 2.0 * math.pi * k / 8.0
        mm.add_cyl_gl("chrome", out_sgn * width * 0.16, bolt_r * math.cos(a), bolt_r * math.sin(a),
                      0.026, 0.024, 0.07, axis='X', segments=6)
    hub_bolt_r = r_rim * 0.26
    for k in range(6):
        a = 2.0 * math.pi * k / 6.0
        mm.add_cyl_gl("chrome", out_sgn * width * 0.36, hub_bolt_r * math.cos(a), hub_bolt_r * math.sin(a),
                      0.014, 0.014, 0.04, axis='X', segments=6)

    return mm.build_object(collection, location_gl=pos_gl)


# ---------------------------------------------------------------------------
# Export & Multi-Angle Cycles Metal Preview Renderer
# ---------------------------------------------------------------------------

def save_blend_and_export_glb(blend_path: Path, glb_path: Path, objects: list):
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.file.pack_all()
    except Exception as e:
        print(f"Warning pack_all: {e}")

    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

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
        export_apply=False,  # Preserve exact node hierarchy & hub origins!
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_jpeg_quality=88,
    )
    print(f"Exported {blend_path.name} + {glb_path.name} ({glb_path.stat().st_size / 1024:.1f} KB, {len(objects)} nodes)")


def render_vehicle_preview(
    png_path: Path,
    cam_pos_gl: tuple[float, float, float],
    look_at_gl: tuple[float, float, float],
    lens_mm: float = 38.0,
    samples: int = 44,
    res_x: int = 1280,
    res_y: int = 720,
    show_ground: bool = True,
):
    """Render a sunlit outdoor Cycles Metal preview from exact Three.js glTF camera coordinates!"""
    png_path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene

    tmp_col = bpy.data.collections.new("_preview_tmp")
    scene.collection.children.link(tmp_col)

    if show_ground:
        bm_g = bmesh.new()
        bmesh.ops.create_circle(bm_g, cap_ends=True, radius=45.0, segments=48)
        m_g = bpy.data.meshes.new("_preview_ground")
        bm_g.to_mesh(m_g)
        bm_g.free()
        g_obj = bpy.data.objects.new("_preview_ground", m_g)
        g_mat = get_solid_pbr_mat("_preview_ground_mat", (0.28, 0.29, 0.27), roughness=0.82)
        g_obj.data.materials.append(g_mat)
        g_obj.location = (0, 0, -0.002)
        tmp_col.objects.link(g_obj)

    cam_data = bpy.data.cameras.new("_preview_cam")
    cam_data.lens = lens_mm
    cam_data.clip_start = 0.05
    cam_data.clip_end = 500.0
    cam_obj = bpy.data.objects.new("_preview_cam", cam_data)
    tmp_col.objects.link(cam_obj)
    c_bl = gl_to_bl(*cam_pos_gl)
    t_bl = gl_to_bl(*look_at_gl)
    cam_obj.location = c_bl
    cam_obj.rotation_euler = (t_bl - c_bl).normalized().to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam_obj

    sun_data = bpy.data.lights.new("_preview_sun", type='SUN')
    sun_data.energy = 3.8
    sun_data.angle = math.radians(1.2)
    sun_data.color = (1.0, 0.95, 0.86)
    sun_obj = bpy.data.objects.new("_preview_sun", sun_data)
    tmp_col.objects.link(sun_obj)
    sun_obj.rotation_euler = Euler((math.radians(52), math.radians(15), math.radians(-135)), 'XYZ')

    world = bpy.data.worlds.new("_preview_world")
    scene.world = world
    if hasattr(world, "use_nodes") and not world.use_nodes:
        world.use_nodes = True
    wnt = world.node_tree
    wnt.nodes.clear()
    w_out = wnt.nodes.new("ShaderNodeOutputWorld")
    w_bg = wnt.nodes.new("ShaderNodeBackground")
    w_bg.inputs["Strength"].default_value = 0.80
    sky = wnt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = 'NISHITA'
        sky.sun_disc = False
        sky.sun_elevation = math.radians(36)
        sky.sun_rotation = math.radians(-135)
    except Exception:
        pass
    wnt.links.new(sky.outputs["Color"], w_bg.inputs["Color"])
    wnt.links.new(w_bg.outputs["Background"], w_out.inputs["Surface"])

    bpy.ops.preferences.addon_enable(module='cycles')
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.refresh_devices()
        gpu = False
        for d in prefs.devices:
            if d.type == 'METAL':
                d.use = True
                gpu = True
            else:
                d.use = False
        scene.cycles.device = 'GPU' if gpu else 'CPU'
    except Exception:
        scene.cycles.device = 'CPU'

    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.transparent_max_bounces = 8
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(png_path)
    try:
        scene.view_settings.view_transform = 'AgX'
    except Exception:
        scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.exposure = -0.35

    bpy.ops.render.render(write_still=True)

    for obj in list(tmp_col.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(tmp_col)
    bpy.data.worlds.remove(world)
    print(f"Rendered preview: {png_path}")
