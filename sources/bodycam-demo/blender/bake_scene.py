"""C6 scene assembly and clean runtime materials (Blender Z-up)."""
import json
import hashlib
import math
import re
from collections import defaultdict
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector


SURFACES = {
    'concrete': 'concrete', 'asphalt': 'asphalt', 'grass': 'grass', 'dirt': 'dirt',
    'wood': 'wood', 'cabinet': 'wood', 'laminate': 'wood', 'cardboard': 'cardboard',
    'carpet': 'carpet', 'fabric': 'fabric', 'mattress': 'fabric', 'tile': 'tile',
    'metal': 'metal', 'glass': 'glass', 'roof': 'concrete', 'brick': 'concrete',
}
SURFACE_NAMES = ('concrete', 'wood', 'carpet', 'tile', 'metal', 'plaster', 'glass',
                 'dirt', 'grass', 'asphalt', 'fabric', 'cardboard', 'flesh')
SURFACE_ATTRIBUTE = 'C14_surface'


def canonical(name):
    return re.sub(r'\.\d{3}$', '', name)


def surface_for(material, fallback='plaster'):
    if material.get('surface') in SURFACE_NAMES:
        return material['surface']
    name = material.name.removeprefix('M_').lower()
    special = {'fridge_note':'cardboard', 'microwave_panel':'metal', 'stove_panel':'metal',
        'kitchen_sink':'metal', 'range_hood':'metal', 'fridge':'metal', 'stove':'metal', 'microwave':'metal',
        'paper':'cardboard', 'newspaper':'cardboard', 'book':'cardboard', 'pizza':'cardboard',
        'curtain':'fabric', 'rug':'carpet', 'coffee_rings':'wood', 'crt_screen':'glass', 'painting':'wood',
        'can_label':'metal', 'box_label':'cardboard', 'chainlink':'metal',
        'porcelain':'metal', 'enamel':'metal', 'chrome':'metal', 'rust_chip':'metal',
        'limescale':'metal', 'bark':'wood'}
    for key,value in special.items():
        if key in name: return value
    return next((value for key, value in SURFACES.items() if key in name), fallback)


def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0] if objects else None


class _LinearVertexColors:
    """Keep source linear COLOR_0 values out of Blender's byte/sRGB conversion."""
    is_critical = True
    error = None

    def gather_import_material_after_hook(self, source, vertex_color, material, gltf):
        # A linked COLOR_0 multiply leaves this unused socket at Blender's 0.8
        # default. Keep the actual glTF factor available to the clean graph.
        pbr = source.pbr_metallic_roughness
        if pbr is None: return
        for node in material.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Base Color'].default_value = pbr.base_color_factor or [1, 1, 1, 1]

    def gather_import_mesh_after_hook(self, source, mesh, gltf):
        from io_scene_gltf2.io.imp.gltf2_io_binary import BinaryData
        from io_scene_gltf2.blender.imp.mesh import points_edges_tris
        if not any('COLOR_0' in primitive.attributes for primitive in source.primitives):
            return
        try:
            colors, positions = [], []
            for primitive in source.primitives:
                if 'POSITION' not in primitive.attributes: continue
                indices = (BinaryData.decode_accessor(gltf, primitive.indices).reshape(-1)
                    if primitive.indices is not None else
                    np.arange(gltf.data.accessors[primitive.attributes['POSITION']].count))
                points, edges, triangles = points_edges_tris(4 if primitive.mode is None else primitive.mode, indices)
                if points is not None or edges is not None:
                    raise ValueError('C14 prop colors require triangle meshes')
                values = np.ones((len(triangles), 4), np.float32)
                if 'COLOR_0' in primitive.attributes:
                    original = BinaryData.decode_accessor(gltf, primitive.attributes['COLOR_0'])
                    values[:, :original.shape[1]] = original[triangles]
                colors.append(values)
                vertices = BinaryData.decode_accessor(gltf, primitive.attributes['POSITION'])[triangles].copy()
                gltf.locs_batch_gltf_to_blender(vertices); positions.append(vertices)
            values = np.concatenate(colors)
            if len(values) != len(mesh.loops):
                # Native mesh.validate() can remove collapsed/duplicate source
                # triangles. Match the surviving triangles, never shift colors
                # after a removed face. Existing byte colors disambiguate any
                # coincident source triangles without becoming the color source.
                source_positions = np.concatenate(positions).reshape(-1, 3, 3)
                source_colors = values.reshape(-1, 3, 4)
                candidates = defaultdict(list)
                for index, triangle in enumerate(source_positions):
                    candidates[tuple(np.rint(triangle.ravel() * 1e6).astype(np.int64))].append(index)
                vertices = np.empty(len(mesh.vertices) * 3, np.float32)
                mesh.vertices.foreach_get('co', vertices); vertices = vertices.reshape(-1, 3)
                loops = np.empty(len(mesh.loops), np.int32); mesh.loops.foreach_get('vertex_index', loops)
                previous = np.empty(len(mesh.loops) * 4, np.float32)
                mesh.color_attributes['Color'].data.foreach_get('color', previous)
                previous = previous.reshape(-1, 3, 4)
                chosen = []
                for index, triangle in enumerate(vertices[loops].reshape(-1, 3, 3)):
                    matches = candidates.get(tuple(np.rint(triangle.ravel() * 1e6).astype(np.int64)), [])
                    if not matches: raise ValueError(f'Unmatched source color triangle in {mesh.name}')
                    match = min(matches, key=lambda candidate: np.max(np.abs(source_colors[candidate] - previous[index])))
                    if np.max(np.abs(source_colors[match] - previous[index])) > .005:
                        raise ValueError(f'Ambiguous source color triangle in {mesh.name}')
                    chosen.append(match)
                values = source_colors[chosen].reshape(-1, 4)
            existing = mesh.color_attributes.get('Color')
            if existing: mesh.color_attributes.remove(existing)
            attribute = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
            attribute.data.foreach_set('color', values.ravel())
            mesh.color_attributes.active_color = attribute
            mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(attribute)
        except Exception as error:
            self.error = error
            raise


def import_prop(path):
    """Use Blender's native importer with its supported mesh-completion hook."""
    from io_scene_gltf2.io.imp.gltf2_io_gltf import glTFImporter
    from io_scene_gltf2.blender.imp.blender_gltf import BlenderGlTF
    extension = _LinearVertexColors()
    settings = {prop.identifier: prop.default for prop in bpy.ops.import_scene.gltf.get_rna_type().properties
                if prop.type in {'BOOLEAN', 'INT', 'FLOAT', 'STRING', 'ENUM'} and not prop.is_readonly}
    settings.update(filepath=str(path), merge_vertices=True, loglevel=40, import_user_extensions=[extension])
    importer = glTFImporter(str(path), settings)
    importer.read(); importer.checks(); BlenderGlTF.create(importer)
    importer.log.flush()
    if extension.error: raise extension.error


def prepare_vertex_colors(objects):
    """Use one linear corner layer and explicit white on every unpainted face."""
    report = {'paintedMeshes': 0, 'whiteDefaultMeshes': 0, 'paintedCorners': 0, 'whiteDefaultCorners': 0}
    for obj in objects:
        mesh = obj.data
        source = mesh.color_attributes.active_color
        if source is None and len(mesh.color_attributes): source = mesh.color_attributes[0]
        if source:
            values = np.empty(len(source.data) * 4, np.float32)
            source.data.foreach_get('color', values); values = values.reshape(-1, 4)
            if source.domain == 'POINT':
                indices = np.empty(len(mesh.loops), np.int32)
                mesh.loops.foreach_get('vertex_index', indices); values = values[indices]
            elif source.domain != 'CORNER':
                raise ValueError(f'Unsupported color domain in {obj.name}: {source.domain}')
            report['paintedMeshes'] += 1; report['paintedCorners'] += len(values)
        else:
            values = np.ones((len(mesh.loops), 4), np.float32)
            report['whiteDefaultMeshes'] += 1; report['whiteDefaultCorners'] += len(values)
        if not np.isfinite(values).all() or values.min(initial=0) < 0 or values.max(initial=1) > 1:
            raise ValueError(f'Invalid vertex color in {obj.name}')
        for attribute in list(mesh.color_attributes): mesh.color_attributes.remove(attribute)
        attribute = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
        attribute.data.foreach_set('color', values.ravel())
        mesh.color_attributes.active_color = attribute
        mesh.color_attributes.render_color_index = 0
    return report


def import_props(layout, public, placement=None):
    templates, instances, missing = {}, [], []
    rotation_offsets = (placement or {}).get('rotationsByPropDegrees', {})
    for room, entries in layout['furniture'].items():
        for source in entries:
            entry = dict(source)
            entry['rotZ'] = (entry.get('rotZ', 0) + rotation_offsets.get(entry['prop'], 0)) % 360
            path = public / 'models' / 'props' / (entry['prop'] + '.glb')
            if not path.exists():
                missing.append({'room': room, **entry})
                continue
            if entry['prop'] not in templates:
                before = set(bpy.data.objects)
                import_prop(path)
                bpy.context.view_layer.update()
                imported = set(bpy.data.objects) - before
                templates[entry['prop']] = [(o.data.copy(), o.matrix_world.copy(), o.get('surface', 'wood'))
                    for o in sorted(imported, key=lambda o: o.name) if o.type == 'MESH']
                for obj in imported:
                    bpy.data.objects.remove(obj, do_unlink=True)
            matrix = Matrix.Translation(Vector(entry['pos'])) @ Matrix.Rotation(math.radians(entry.get('rotZ', 0)), 4, 'Z')
            objects = []
            for i, (mesh, transform, surface) in enumerate(templates[entry['prop']]):
                obj = bpy.data.objects.new(f'PROP_{room}_{entry["name"]}_{i}', mesh.copy())
                bpy.context.scene.collection.objects.link(obj)
                obj.matrix_world = matrix @ transform
                obj['room'] = room; obj['surface'] = surface; obj['prop'] = entry['prop']
                objects.append(obj)
            instances.append({'room': room, 'definition': entry, 'objects': objects})
    bpy.context.view_layer.update()
    return instances, missing


def tag_surface_faces(obj):
    """Keep authored mesh tags through joins, triangulation and material separation."""
    mesh = obj.data
    attribute = mesh.attributes.get(SURFACE_ATTRIBUTE)
    if attribute is None:
        attribute = mesh.attributes.new(name=SURFACE_ATTRIBUTE, type='INT', domain='FACE')
    own = obj.get('surface')
    values = []
    for face in mesh.polygons:
        material = mesh.materials[face.material_index] if face.material_index < len(mesh.materials) else None
        surface = own if own in SURFACE_NAMES else surface_for(material) if material else 'plaster'
        values.append(SURFACE_NAMES.index(surface))
    attribute.data.foreach_set('value', values)


def separate_surfaces(obj):
    """Split a material primitive only where authored surface tags differ."""
    attribute = obj.data.attributes.get(SURFACE_ATTRIBUTE)
    if attribute is None:
        raise ValueError(f'Missing source surface tags in {obj.name}')
    values = sorted({item.value for item in attribute.data})
    if any(value < 0 or value >= len(SURFACE_NAMES) for value in values):
        raise ValueError(f'Invalid source surface tag in {obj.name}')
    result = []
    for value in values:
        if len(values) == 1:
            part = obj
        else:
            mesh = obj.data.copy()
            bm = bmesh.new(); bm.from_mesh(mesh)
            layer = bm.faces.layers.int[SURFACE_ATTRIBUTE]
            bmesh.ops.delete(bm, geom=[face for face in bm.faces if face[layer] != value], context='FACES')
            bm.to_mesh(mesh); bm.free()
            part = bpy.data.objects.new(obj.name + '_' + SURFACE_NAMES[value], mesh)
            bpy.context.scene.collection.objects.link(part)
            part.matrix_world = obj.matrix_world.copy()
        part.data.attributes.remove(part.data.attributes[SURFACE_ATTRIBUTE])
        result.append((part, SURFACE_NAMES[value]))
    if len(values) > 1:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0: bpy.data.meshes.remove(mesh)
    return result


def room_at(point, layout):
    x, y, _ = point
    for room in layout['rooms']:
        for a, b, c, d in room.get('rects', []):
            if a - .025 <= x <= c + .025 and b - .025 <= y <= d + .025:
                return room['id']
    return 'EXT'


def make_decals(layout, public, config):
    result = []
    index = json.loads((public / 'textures/index.json').read_text())
    materials = {}
    for i, entry in enumerate(layout.get('decals', [])):
        key = entry['decal']
        if key not in materials:
            material = bpy.data.materials.new('MU_decal_' + key)
            material.use_nodes = True
            bsdf = material.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Roughness'].default_value = index['decals'][key].get('roughness', .9)
            tex = material.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(str(public / 'textures' / index['decals'][key]['file']), check_existing=True)
            material.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            material.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            material.surface_render_method = 'DITHERED'
            material['decal'] = True
            materials[key] = material
        size = entry.get('size', 1)
        width, height = size if isinstance(size, list) else (size, size)
        bpy.ops.mesh.primitive_plane_add(size=1)
        obj = bpy.context.object; obj.name = f'DECAL_{i:02}_{key}'
        obj.scale = (width, height, 1)
        normal = Vector(entry['normal']).normalized()
        rotation = Vector((0, 0, 1)).rotation_difference(normal)
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = rotation @ Matrix.Rotation(math.radians(entry.get('rot', 0)), 4, 'Z').to_quaternion()
        obj.location = Vector(entry['pos']) + normal * config['decals']['offsetMeters']
        obj.data.materials.append(materials[key])
        obj['room'] = room_at(entry['pos'], layout)
        obj['decal'] = True; obj['surface'] = 'plaster'; obj.visible_shadow = False
        result.append(obj)
    return result


def atlas_for(obj, layout):
    if obj.get('room'):
        return 'SITE' if obj['room'] == 'OUT' else obj['room']
    name = obj.name
    if name.startswith('NBR_'): return 'NEIGHBORS'
    if name.startswith('SITE_'): return 'SITE'
    if name.startswith('PORCH_'): return 'PORCH'
    if name.startswith('FRAME_'):
        entry = next((d for d in layout['doors'] if d['id'] == obj.get('opening')), None)
        if entry:
            return next((r for r in entry['rooms'] if r not in ['EXT', 'OUT']), 'EXT')
    if name in ['THRESHOLDS', 'INT_fixtures']: return 'HAL'
    return 'EXT'


def prepare_runtime_materials(objects, config, texture_index=None):
    """M_* remain image-free; MU_* retain unique image assets. All lamps are opt-in."""
    canonical_materials, first_factors = {}, {}
    texture_index = texture_index or {}
    for obj in objects:
        for slot in obj.material_slots:
            original = slot.material
            if not original: continue
            name = canonical(original.name)
            principled = next((n for n in original.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if original.use_nodes else None
            color = list(principled.inputs['Base Color'].default_value) if principled else list(original.diffuse_color)
            roughness = principled.inputs['Roughness'].default_value if principled else original.roughness
            metallic = principled.inputs['Metallic'].default_value if principled else original.metallic
            is_kitchen_bulb = obj.get('room') == 'KIT' and name.startswith('ME_')
            key = 'ME_kitchen_bulb' if is_kitchen_bulb else name
            if name.startswith('M_') and name[2:] not in texture_index:
                factors = tuple(color) + (roughness, metallic)
                first_factors.setdefault(name, factors)
                if factors != first_factors[name]:
                    key += '__' + hashlib.sha256(json.dumps(factors).encode()).hexdigest()[:8]
            # MU assets can have the same name but different images; only reuse exact source material.
            if name.startswith('MU_'):
                key = original.name
            if key not in canonical_materials:
                material = original.copy(); material.name = key + '_C6'
                material['runtimeName'] = key
                material.use_nodes = True
                if name.startswith(('M_', 'ME_')):
                    material.node_tree.nodes.clear()
                    out = material.node_tree.nodes.new('ShaderNodeOutputMaterial')
                    bsdf = material.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
                    bsdf.inputs['Base Color'].default_value = color
                    bsdf.inputs['Roughness'].default_value = roughness
                    bsdf.inputs['Metallic'].default_value = metallic
                    vertex = material.node_tree.nodes.new('ShaderNodeVertexColor'); vertex.layer_name = 'Color'
                    multiply = material.node_tree.nodes.new('ShaderNodeMix'); multiply.data_type = 'RGBA'
                    multiply.name = 'C14_BaseColorTimesVertex'; multiply.blend_type = 'MULTIPLY'
                    multiply.inputs[0].default_value = 1; multiply.inputs[6].default_value = color
                    material.node_tree.links.new(vertex.outputs['Color'], multiply.inputs[7])
                    material.node_tree.links.new(multiply.outputs[2], bsdf.inputs['Base Color'])
                    if name.startswith('M_glass'):
                        bsdf.inputs['Alpha'].default_value = .35
                        material.surface_render_method = 'DITHERED'
                    if name.startswith('ME_'):
                        source = config['kitchen'] if is_kitchen_bulb else config['streetlight'] if name == 'ME_sodium' else None
                        bsdf.inputs['Emission Color'].default_value = (*(source['color'] if source else [0, 0, 0]), 1)
                        bsdf.inputs['Emission Strength'].default_value = source.get('visibleEmission', 0) if source and source.get('enabled', True) else 0
                    material.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
                    material['textureId'] = name[2:] if name.startswith('M_') else ''
                canonical_materials[key] = material
            slot.material = canonical_materials[key]
    # Give runtime materials exact convention names without Blender suffixes.
    for key, material in canonical_materials.items():
        conflicting = bpy.data.materials.get(key)
        if conflicting and conflicting != material: conflicting.name = '__SOURCE_' + key
        material.name = key
    return list(canonical_materials.values())


def make_bake_material(material, public, index):
    """Keep albedo color bleeding, strip micro normals/specularity from irradiance bake."""
    result = material.copy(); result.name = '__BAKE_' + material.name
    nt = result.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        for socket in ['Metallic', 'Normal', 'Coat Weight', 'Specular IOR Level', 'Emission Strength']:
            inp = bsdf.inputs.get(socket)
            if inp:
                for link in list(inp.links): nt.links.remove(link)
                if socket != 'Normal': inp.default_value = 0
        # A diffuse receiver on metal gives a usable incoming-light field (runtime remains PBR).
        bsdf.inputs['Roughness'].default_value = 1
        tid = material.get('textureId', material.name[2:]) if material.name.startswith('M_') else None
        if tid in index and 'albedo' in index[tid].get('maps', []):
            uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
            scale = nt.nodes.new('ShaderNodeVectorMath'); scale.operation = 'SCALE'
            scale.inputs[3].default_value = 1 / index[tid]['tileMeters']
            nt.links.new(uv.outputs['UV'], scale.inputs[0])
            texture = nt.nodes.new('ShaderNodeTexImage')
            texture.image = bpy.data.images.load(
                str(public / 'textures' / tid / index[tid]['files']['albedo']), check_existing=True)
            nt.links.new(scale.outputs['Vector'], texture.inputs['Vector'])
            multiply = nt.nodes.get('C14_BaseColorTimesVertex')
            nt.links.new(texture.outputs['Color'], multiply.inputs[6] if multiply else bsdf.inputs['Base Color'])
        # Window panes transmit the night illumination without expensive caustics.
        if material.name.startswith('M_glass'):
            bsdf.inputs['Alpha'].default_value = .05
        # The parameterized point light sits inside the visible bulb. Its glass
        # must not self-occlude transport; runtime emission remains untouched.
        if material.name.startswith('ME_'):
            bsdf.inputs['Alpha'].default_value = 0
    # bpy.ops.object.bake(uv_layer=...) changes implicit image coordinates too.
    # Every source image must explicitly keep the original material UV set.
    source_uv = nt.nodes.new('ShaderNodeUVMap'); source_uv.uv_map = 'UVMap'
    for node in list(nt.nodes):
        if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
            nt.links.new(source_uv.outputs['UV'], node.inputs['Vector'])
    target = nt.nodes.new('ShaderNodeTexImage'); target.name = 'C6_BakeTarget'
    nt.nodes.active = target
    return result


def setup_lights(layout, config):
    scene = bpy.context.scene
    for obj in list(scene.objects):
        if obj.type == 'LIGHT': bpy.data.objects.remove(obj, do_unlink=True)
    world = bpy.data.worlds.new('C6_NightSky'); world.use_nodes = True; scene.world = world
    background = world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (*config['sky']['color'], 1)
    background.inputs['Strength'].default_value = config['sky']['strength']
    records = []
    def light(name, kind, position, settings, energy):
        data = bpy.data.lights.new(name, kind); data.energy = energy; data.color = settings['color']
        if kind == 'POINT': data.shadow_soft_size = settings['radius']
        obj = bpy.data.objects.new(name, data); scene.collection.objects.link(obj); obj.location = position
        return obj
    moon = light('C6_Moon', 'SUN', (0, 0, 20), config['moon'], config['moon']['energy'])
    moon.rotation_euler = Vector(config['moon']['direction']).normalized().to_track_quat('-Z', 'Y').to_euler()
    moon.data.angle = math.radians(config['moon']['angleDegrees'])
    records.append({'id': 'moon', 'type': 'sun', 'baked': True, **config['moon']})
    records.append({'id': 'sky', 'type': 'environment', 'baked': True, **config['sky']})
    for key in ['streetlight', 'porch', 'kitchen']:
        settings = config[key]
        position = layout['lights'][settings['layoutAnchor']]['pos'] if 'layoutAnchor' in settings else settings['position']
        if settings['enabled']:
            light('C6_' + key, 'POINT', position, settings, settings['powerWatts'])
        records.append({'id': key, 'type': 'point', 'baked': settings['enabled'], **settings, 'position': position})
    return records


def join_atlases(objects, layout):
    groups = defaultdict(list)
    for obj in objects:
        if obj.type != 'MESH' or obj.name.startswith('DOOR_'): continue
        tag_surface_faces(obj)
        if len(obj.data.uv_layers) == 0:
            obj.data.uv_layers.new(name='UVMap')
        obj.data.uv_layers[0].name = 'UVMap'
        while len(obj.data.uv_layers) > 1: obj.data.uv_layers.remove(obj.data.uv_layers[-1])
        groups[atlas_for(obj, layout)].append(obj)
    result = {}
    for key in sorted(groups):
        items = groups[key]; select(items)
        # Join evaluated local geometry into world-space coordinates once.
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bpy.ops.object.join()
        obj = bpy.context.object
        matrix = obj.matrix_world.copy(); obj.data.transform(matrix); obj.matrix_world = Matrix.Identity(4)
        obj.name = 'ATLAS_' + key
        for extra in list(obj.keys()): del obj[extra]
        obj['room'] = key
        if len(obj.data.color_attributes):
            obj.data.color_attributes.active_color_index = 0
            obj.data.color_attributes.render_color_index = 0
        result[key] = obj
    return result
