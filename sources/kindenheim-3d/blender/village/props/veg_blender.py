"""Blender-side helpers shared by blender/village/build_props.py and blender/fields/build_fields.py.

Conventions (consumed by src/scenery.ts):
  * Blender Z-up, metres, object origin = ground contact; exported Y-up glTF.
  * Every asset is one GLB with child nodes named <key>_LOD0 / _LOD1 / _LOD2 / _FAR.
  * Foliage materials are named Veg_* (alpha-masked, double sided). Their meshes carry
      - explicit custom normals (crown-spherical blend) for soft shading,
      - COLOR_0   = per-card tint x fake ambient occlusion (multiplies albedo),
      - TEXCOORD_1 = (flutter weight, translucency mask)   -> runtime attribute "uv1".
  * Library PBR textures keep their library basename as image name (runtime de-duplicates by name).
"""
from __future__ import annotations

import json
import math
import os
import random

import bpy
from mathutils import Matrix, Vector

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SHARED = os.path.join(PROJECT_ROOT, 'blender', 'shared_textures')


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _library_entry(mat_id: str) -> dict:
    with open(os.path.join(SHARED, 'library.json'), 'r', encoding='utf-8') as fh:
        lib = json.load(fh)
    for m in lib['materials']:
        if m['id'] == mat_id:
            return m
    raise KeyError(f'shared texture library has no material "{mat_id}"')


def library_tile_m(mat_id: str) -> float:
    return float(_library_entry(mat_id)['tileSizeM'][0])


def load_image(path: str, colorspace: str, name: str | None = None):
    if not os.path.isfile(path):
        raise FileNotFoundError(f'texture missing: {path}')
    want = name or os.path.splitext(os.path.basename(path))[0]
    existing = bpy.data.images.get(want)
    if existing is not None and bpy.path.abspath(existing.filepath) == path:
        return existing
    img = bpy.data.images.load(path, check_existing=False)
    img.name = want
    img.colorspace_settings.name = colorspace
    img.pack()
    return img


def load_library_image(mat_id: str, which: str, size: str, colorspace: str):
    """Library map as a Blender image. size: '' (2K) | '_1k' | '_512' (written by build_veg_atlases.py lib512)."""
    if size == '_512':
        return load_image(os.path.join(PROJECT_ROOT, 'blender/village/textures/props/lib512', f'{mat_id}_{which}_512.jpg'), colorspace)
    return load_image(os.path.join(PROJECT_ROOT, _library_entry(mat_id)['files'][f'{which}{size}']), colorspace)


def _gltf_output_group():
    """The node group the glTF exporter looks for to pick up the occlusion texture."""
    name = 'glTF Material Output'
    grp = bpy.data.node_groups.get(name)
    if grp is None:
        grp = bpy.data.node_groups.new(name, 'ShaderNodeTree')
        grp.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        grp.nodes.new('NodeGroupInput')
    return grp


def make_library_material(name: str, mat_id: str, size: str = '_1k', tint=(1.0, 1.0, 1.0), roughness_scale: float = 1.0,
                          use_orm: bool = True, emission=None, emission_strength: float = 0.0, metallic_override: float | None = None):
    """Opaque PBR material from the shared library (albedo + normal + ORM). UVs must be in tile units (1 = tileSizeM)."""
    entry = _library_entry(mat_id)
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    alb = nt.nodes.new('ShaderNodeTexImage')
    alb.image = load_library_image(mat_id, 'albedo', size, 'sRGB')
    if tuple(tint) != (1.0, 1.0, 1.0):
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        nt.links.new(alb.outputs['Color'], mix.inputs[6])
        mix.inputs[7].default_value = (tint[0], tint[1], tint[2], 1.0)
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    else:
        nt.links.new(alb.outputs['Color'], bsdf.inputs['Base Color'])
    nrm = nt.nodes.new('ShaderNodeTexImage')
    nrm.image = load_library_image(mat_id, 'normal', size, 'Non-Color')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    if use_orm:
        orm = nt.nodes.new('ShaderNodeTexImage')
        orm.image = load_library_image(mat_id, 'orm', size, 'Non-Color')
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        if metallic_override is None:
            nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        else:
            bsdf.inputs['Metallic'].default_value = metallic_override
        out = nt.nodes.new('ShaderNodeGroup')
        out.node_tree = _gltf_output_group()
        nt.links.new(sep.outputs['Red'], out.inputs['Occlusion'])
    else:
        bsdf.inputs['Roughness'].default_value = float(entry.get('avgRoughness', 0.8)) * roughness_scale
        bsdf.inputs['Metallic'].default_value = metallic_override if metallic_override is not None else float(entry.get('avgMetalness', 0.0))
    if emission is not None and emission_strength > 0:
        bsdf.inputs['Emission Color'].default_value = (emission[0], emission[1], emission[2], 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    mat.use_backface_culling = True
    return mat


def make_flat_material(name: str, color, roughness: float = 0.6, metallic: float = 0.0, emission=None, emission_strength: float = 0.0,
                       double_sided: bool = False):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (emission[0], emission[1], emission[2], 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    mat.use_backface_culling = not double_sided
    return mat


def make_texture_material(name: str, albedo_path: str, normal_path: str | None = None, roughness: float = 0.7, metallic: float = 0.0,
                          alpha_clip: bool = False, double_sided: bool = False, alpha_threshold: float = 0.4):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = load_image(albedo_path, 'sRGB')
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha_clip:
        # Math(ROUND) on alpha -> glTF alphaMode MASK
        rnd = nt.nodes.new('ShaderNodeMath')
        rnd.operation = 'ROUND'
        nt.links.new(tex.outputs['Alpha'], rnd.inputs[0])
        nt.links.new(rnd.outputs['Value'], bsdf.inputs['Alpha'])
        mat.alpha_threshold = alpha_threshold
    if normal_path:
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = load_image(normal_path, 'Non-Color')
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    mat.use_backface_culling = not double_sided
    return mat


class AtlasInfo:
    def __init__(self, json_path: str):
        if not os.path.isfile(json_path):
            raise FileNotFoundError(f'atlas description missing: {json_path} (run the atlas builder first)')
        with open(json_path, 'r', encoding='utf-8') as fh:
            self.meta = json.load(fh)
        self.tiles = self.meta['tiles']
        self.albedo = os.path.join(PROJECT_ROOT, self.meta['albedoWebp'])
        self.normal = os.path.join(PROJECT_ROOT, self.meta['normalWebp'])
        self.width, self.height = self.meta['size']

    def rect(self, tile: str, inset_px: float = 1.0) -> tuple[float, float, float, float]:
        """(u0, v0, u1, v1) of a tile in Blender UV space (v up), shrunk by inset_px to stay off the gutter."""
        if tile not in self.tiles:
            raise KeyError(f'atlas {self.meta["name"]} has no tile "{tile}"')
        t = self.tiles[tile]
        du = inset_px / self.width
        dv = inset_px / self.height
        return (t['u0'] + du, t['v0'] + dv, t['u1'] - du, t['v1'] - dv)

    def material(self, name: str, roughness: float = 0.62):
        return make_texture_material(name, self.albedo, self.normal, roughness=roughness, alpha_clip=True, double_sided=True)


class MeshBuilder:
    """Accumulates faces with explicit per-vertex normals, UV, vertex colour and (flutter, translucency) data."""

    def __init__(self):
        self.verts: list[tuple[float, float, float]] = []
        self.normals: list[tuple[float, float, float]] = []
        self.uvs: list[tuple[float, float]] = []
        self.data: list[tuple[float, float]] = []
        self.colors: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []

    @property
    def tri_count(self) -> int:
        return sum(len(f) - 2 for f in self.faces)

    def vert(self, p, n, uv, data=(0.0, 0.0), color=(1.0, 1.0, 1.0)) -> int:
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        nn = Vector(n)
        if nn.length < 1e-8:
            nn = Vector((0, 0, 1))
        nn.normalize()
        self.normals.append((nn.x, nn.y, nn.z))
        self.uvs.append((float(uv[0]), float(uv[1])))
        self.data.append((float(data[0]), float(data[1])))
        self.colors.append((float(color[0]), float(color[1]), float(color[2])))
        return len(self.verts) - 1

    def face(self, *idx: int) -> None:
        self.faces.append(tuple(idx))

    def quad(self, pts, uv_rect, normals=None, data=None, color=(1.0, 1.0, 1.0), flip_u: bool = False) -> None:
        """pts: bottom-left, bottom-right, top-right, top-left. uv_rect = (u0, v0, u1, v1)."""
        p = [Vector(q) for q in pts]
        if normals is None:
            fn = (p[1] - p[0]).cross(p[3] - p[0])
            normals = [fn, fn, fn, fn]
        u0, v0, u1, v1 = uv_rect
        if flip_u:
            u0, u1 = u1, u0
        uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        if data is None:
            data = [(0.0, 0.0)] * 4
        ids = [self.vert(p[i], normals[i], uvs[i], data[i], color) for i in range(4)]
        self.face(*ids)

    def grid_card(self, origin: Vector, right: Vector, up: Vector, bend: Vector, width: float, height: float, uv_rect, normal_fn,
                  color=(1.0, 1.0, 1.0), translucency: float = 1.0, rows: int = 2, flip_u: bool = False, anchor_bottom: bool = True,
                  cup: float = 0.0, cols: int = 1) -> None:
        """A card anchored at the bottom-centre (origin), `rows` segments tall, bent toward `bend` with height.
        normal_fn(position, card_normal) -> shading normal. Flutter weight grows from 0 at the anchor to 1 at the tip."""
        u0, v0, u1, v1 = uv_rect
        if flip_u:
            u0, u1 = u1, u0
        card_n = right.cross(up).normalized()
        grid: list[list[int]] = []
        for r in range(rows + 1):
            t = r / rows
            row_ids = []
            for c in range(cols + 1):
                s = c / cols - 0.5
                off = bend * (t * t) + card_n * (cup * (abs(s) * 2.0) ** 2 * width)
                yy = t if anchor_bottom else t - 0.5
                p = origin + right * (s * width) + up * (yy * height) + off
                row_ids.append(self.vert(p, normal_fn(p, card_n), (u0 + (u1 - u0) * (c / cols), v0 + (v1 - v0) * t), (t, translucency), color))
            grid.append(row_ids)
        for r in range(rows):
            for c in range(cols):
                self.face(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c])

    def tube(self, path: list[Vector], radii: list[float], sides: int, uv_rect, v_per_m: float | None = None, color=(1.0, 1.0, 1.0),
             cap_end: bool = False, u_repeat: float = 1.0) -> None:
        """Round tapered tube along a polyline with smooth radial normals. UV: u around, v along (bark furrows run along V)."""
        u0, v0, u1, v1 = uv_rect
        rings: list[list[int]] = []
        length = 0.0
        prev_x = None
        for i, p in enumerate(path):
            if i > 0:
                length += (path[i] - path[i - 1]).length
            if i == 0:
                tangent = path[1] - path[0]
            elif i == len(path) - 1:
                tangent = path[i] - path[i - 1]
            else:
                tangent = path[i + 1] - path[i - 1]
            tangent.normalize()
            ref = prev_x if prev_x is not None else (Vector((1, 0, 0)) if abs(tangent.x) < 0.9 else Vector((0, 1, 0)))
            x_axis = (ref - tangent * ref.dot(tangent))
            if x_axis.length < 1e-6:
                x_axis = tangent.orthogonal()
            x_axis.normalize()
            y_axis = tangent.cross(x_axis).normalized()
            prev_x = x_axis
            if v_per_m is None:
                vv = v0 + (v1 - v0) * (i / (len(path) - 1))
            else:
                vv = v0 + length * v_per_m
            ring = []
            for s in range(sides + 1):
                a = (s / sides) * math.tau
                d = x_axis * math.cos(a) + y_axis * math.sin(a)
                ring.append(self.vert(p + d * radii[i], d, (u0 + (u1 - u0) * (s / sides) * u_repeat, vv), (0.0, 0.0), color))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for s in range(sides):
                self.face(rings[i][s], rings[i][s + 1], rings[i + 1][s + 1], rings[i + 1][s])
        if cap_end:
            p = path[-1]
            tangent = (path[-1] - path[-2]).normalized()
            centre = self.vert(p, tangent, ((u0 + u1) / 2, v1), (0.0, 0.0), color)
            last = rings[-1]
            for s in range(sides):
                self.face(last[s], last[s + 1], centre)

    def box(self, lo, hi, uv_rect, color=(1.0, 1.0, 1.0), skip_bottom: bool = True, uv_m: float | None = None) -> None:
        """Axis-aligned box with flat normals. uv_m: metres per UV unit for tiling materials (None = stretch rect)."""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        faces = [
            ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (0, -1, 0)),
            ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), (1, 0, 0)),
            ((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (0, 1, 0)),
            ((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (-1, 0, 0)),
            ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (0, 0, 1)),
        ]
        if not skip_bottom:
            faces.append(((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), (0, 0, -1)))
        for a, b, c, d, n in faces:
            if uv_m is None:
                rect = uv_rect
            else:
                w = (Vector(b) - Vector(a)).length / uv_m
                h = (Vector(d) - Vector(a)).length / uv_m
                rect = (uv_rect[0], uv_rect[1], uv_rect[0] + w, uv_rect[1] + h)
            self.quad([a, b, c, d], rect, normals=[n, n, n, n], color=color)

    def to_object(self, name: str, material, collection, with_color: bool = True, with_data: bool = True):
        if not self.faces:
            raise RuntimeError(f'mesh {name} has no faces')
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        uv = mesh.uv_layers.new(name='UVMap')
        data_layer = mesh.uv_layers.new(name='VegData') if with_data else None
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                uv.data[li].uv = self.uvs[vi]
                if data_layer is not None:
                    # the exporter flips V: store 1 - translucency so the runtime reads uv1.y = translucency
                    data_layer.data[li].uv = (self.data[vi][0], 1.0 - self.data[vi][1])
        if with_color:
            col = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
            for vi, c in enumerate(self.colors):
                col.data[vi].color = (c[0], c[1], c[2], 1.0)
            mesh.color_attributes.active_color = col
            mesh.color_attributes.render_color_index = 0
        mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
        mesh.normals_split_custom_set_from_vertices(self.normals)
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        return obj


def join_under_empty(name: str, children: list, collection):
    """Parent LOD parts under an empty node named `name` (the runtime looks nodes up by this name)."""
    empty = bpy.data.objects.new(name, None)
    collection.objects.link(empty)
    for ch in children:
        ch.parent = empty
    return empty


def object_bounds_gltf(objs) -> dict:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            g = Vector((w.x, w.z, -w.y))
            lo = Vector((min(lo.x, g.x), min(lo.y, g.y), min(lo.z, g.z)))
            hi = Vector((max(hi.x, g.x), max(hi.y, g.y), max(hi.z, g.z)))
    return {
        'min': [round(lo.x, 3), round(lo.y, 3), round(lo.z, 3)],
        'max': [round(hi.x, 3), round(hi.y, 3), round(hi.z, 3)],
        'size': [round(hi.x - lo.x, 3), round(hi.y - lo.y, 3), round(hi.z - lo.z, 3)],
    }


def triangle_count(objs) -> int:
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')


def export_glb(objects: list, glb_path: str, image_quality: int = 82) -> int:
    os.makedirs(os.path.dirname(glb_path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_materials='EXPORT',
        # AUTO keeps every source image in its own format with its ORIGINAL bytes: shared-library JPEGs stay
        # byte-identical across all GLBs of the project (texture de-duplication by name), our atlases are pre-encoded
        # WebP files (written by veg_atlas_lib.Atlas.save). image_quality only applies if Blender has to re-encode.
        export_image_format='AUTO',
        export_image_quality=image_quality,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_attributes=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_extras=True,   # LOD metadata (tileM, lodDist, ...) travels as custom properties -> glTF extras -> userData
        export_draco_mesh_compression_enable=False,
    )
    if not os.path.isfile(glb_path):
        raise RuntimeError(f'glTF export produced no file: {glb_path}')
    return os.path.getsize(glb_path)


def rand_unit(rng: random.Random) -> Vector:
    z = rng.uniform(-1, 1)
    a = rng.uniform(0, math.tau)
    r = math.sqrt(max(0.0, 1 - z * z))
    return Vector((r * math.cos(a), r * math.sin(a), z))


def rot_about(axis: Vector, angle: float) -> Matrix:
    return Matrix.Rotation(angle, 3, axis)


def make_straw_material(name: str, tex_dir: str):
    """CC0 straw scan (ambientCG ThatchedRoof001A) at 512 px for hay / straw bales: albedo + normal + ORM."""
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    alb = nt.nodes.new('ShaderNodeTexImage')
    alb.image = load_image(os.path.join(tex_dir, 'lib512', 'straw_thatch_albedo_512.jpg'), 'sRGB')
    nt.links.new(alb.outputs['Color'], bsdf.inputs['Base Color'])
    nrm = nt.nodes.new('ShaderNodeTexImage')
    nrm.image = load_image(os.path.join(tex_dir, 'lib512', 'straw_thatch_normal_512.jpg'), 'Non-Color')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    orm = nt.nodes.new('ShaderNodeTexImage')
    orm.image = load_image(os.path.join(tex_dir, 'lib512', 'straw_thatch_orm_512.jpg'), 'Non-Color')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    grp = nt.nodes.new('ShaderNodeGroup')
    grp.node_tree = _gltf_output_group()
    nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    mat.use_backface_culling = True
    return mat
