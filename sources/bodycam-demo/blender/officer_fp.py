"""C18 first-person arms, derived from the packed C10 character without rebaking.

Run from the repository root:
  blender -b --python-exit-code 1 -P sources/bodycam-demo/blender/officer_fp.py --

Only the final validated GLB is written into public/. Inspection reports, a
reopenable .blend and the pending GLB stay under --work. The source is read-only.
"""
import argparse
import bmesh
import bpy
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
from mathutils import Matrix, Vector

REPO = Path(__file__).resolve().parents[3]
DEFAULT_WORK = REPO.parent / 'bodycam-work/codex/C18'
DEFAULT_SOURCE = REPO.parent / 'bodycam-work/codex/C10/blend/officer.blend'
CHEST_GLTF = (0.0, 1.4, -0.2830248)  # C10 measured lens, 25 mm ahead of carrier.
MAX_TRIANGLES = 40_000
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')
BONES = tuple(side + suffix for side in ('Left', 'Right') for suffix in (
    'Shoulder', 'Arm', 'ForeArm', 'ForeArmTwist', 'Hand',
    *(f'Hand{finger}{joint}' for finger in FINGERS for joint in range(1, 5))))
DTYPE = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def sleeve(source, side, sign, cut_x, min_arm_weight):
    """Keep only the original sleeve surface, preserving atlas UVs/normals."""
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = f'FP_Sleeve_{side[0]}'
    obj.data.name = obj.name
    bpy.context.collection.objects.link(obj)
    side_groups = {g.index for g in obj.vertex_groups if g.name in BONES and g.name.startswith(side)}
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    weights = mesh.verts.layers.deform.active
    # Arm weights separate the torso. Then bisect, rather than delete whole
    # boundary triangles, so the proximal rim is a continuous interpolated edge.
    remove = [v for v in mesh.verts if
              sum(w for g, w in v[weights].items() if g in side_groups) < min_arm_weight]
    bmesh.ops.delete(mesh, geom=remove, context='VERTS')
    world_plane = Vector((sign * cut_x, 0, 0))
    local_plane = obj.matrix_world.inverted() @ world_plane
    local_normal = obj.matrix_world.to_3x3().transposed() @ Vector((sign, 0, 0))
    bmesh.ops.bisect_plane(mesh, geom=[*mesh.verts, *mesh.edges, *mesh.faces],
                         plane_co=local_plane, plane_no=local_normal, dist=1e-7,
                         clear_inner=True, clear_outer=False)
    # The x cut must contain all of the mixed torso/arm-weight seam.
    # A seam farther out would create an additional opening and is rejected.
    for vertex in mesh.verts:
        point = obj.matrix_world @ vertex.co
        if vertex.is_boundary and point.z > 1.10:
            assert abs(sign * point.x - cut_x) < 2e-5, 'Sleeve cut leaves a torso-side opening'
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()
    if not obj.data.polygons:
        raise RuntimeError(f'No sleeve survived for {side}')
    return obj


def normalize_weights(obj, side):
    allowed = {g.index for g in obj.vertex_groups if g.name in BONES and g.name.startswith(side)}
    assignments = []
    for vertex in obj.data.vertices:
        weights = sorted(((g.group, g.weight) for g in vertex.groups
                          if g.group in allowed and g.weight > 0), key=lambda item: -item[1])[:4]
        total = sum(weight for _, weight in weights)
        if total <= 1e-8:
            raise RuntimeError(f'{obj.name}: unweighted vertex {vertex.index}')
        assignments.append([(group, weight / total) for group, weight in weights])
    # Remove obsolete groups after collecting indices; deleting groups renumbers them.
    names = {g.index: g.name for g in obj.vertex_groups}
    for group in list(obj.vertex_groups):
        group.remove(range(len(obj.data.vertices)))
    for vertex, weights in zip(obj.data.vertices, assignments):
        for group, weight in weights:
            obj.vertex_groups[names[group]].add([vertex.index], weight, 'REPLACE')
    for group in list(obj.vertex_groups):
        if group.name not in BONES or not group.name.startswith(side):
            obj.vertex_groups.remove(group)


def from_blender(vector):
    return [float(vector.x), float(vector.z), float(-vector.y)]


def bone_report(rig):
    conversion = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
    result = {}
    for name in BONES:
        bone = rig.data.bones[name]
        world = rig.matrix_world @ bone.matrix_local
        axes = conversion @ world.to_3x3().normalized()
        result[name] = {
            'parent': bone.parent.name if bone.parent else 'FP_Armature',
            'head': from_blender(rig.matrix_world @ bone.head_local),
            'tail': from_blender(rig.matrix_world @ bone.tail_local),
            'length': float(bone.length),
            'worldAxes': {axis: list(axes.col[index]) for index, axis in enumerate(('x', 'y', 'z'))},
            'localQuaternionBlenderWXYZ': list((bone.parent.matrix_local.inverted() @ bone.matrix_local
                                     if bone.parent else bone.matrix_local).to_quaternion()),
        }
    return result


def glb_readback(path):
    """Validate the actual delivered bytes, rather than the Blender scene only."""
    data = path.read_bytes()
    magic, version, size = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and size == len(data)
    length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    doc = json.loads(data[20:20 + length])
    offset = 20 + length
    length, kind = struct.unpack_from('<II', data, offset)
    assert kind == 0x004e4942
    binary = data[offset + 8:offset + 8 + length]

    def accessor(index):
        item = doc['accessors'][index]
        view = doc['bufferViews'][item['bufferView']]
        dtype = np.dtype(DTYPE[item['componentType']])
        width = WIDTH[item['type']]
        array = np.ndarray((item['count'], width), dtype=dtype, buffer=binary,
                           offset=view.get('byteOffset', 0) + item.get('byteOffset', 0),
                           strides=(view.get('byteStride', width * dtype.itemsize), dtype.itemsize))
        assert np.isfinite(array).all()
        return array

    nodes = doc['nodes']
    names = [node.get('name', '') for node in nodes]
    assert all(names.count(name) == 1 for name in (*BONES, 'FP_Root', 'FP_Camera', 'FP_WeaponSocket'))
    assert len(doc['skins']) == 1
    skin = doc['skins'][0]
    assert {names[i] for i in skin['joints']} == set(BONES)
    assert not doc.get('animations') and not doc.get('extensionsRequired')
    assert len(doc['meshes']) == 4
    assert {mesh['name'] for mesh in doc['meshes']} == {'FP_Sleeve_L', 'FP_Sleeve_R', 'FP_Glove_L', 'FP_Glove_R'}
    assert all('uri' not in buffer for buffer in doc['buffers'])
    assert len(doc['images']) == 3 and all('uri' not in image for image in doc['images'])
    assert len(doc['materials']) == 1 and doc['materials'][0]['name'] == 'MU_OfficerAtlas'
    material = doc['materials'][0]
    assert all(key in material for key in ('normalTexture', 'occlusionTexture'))
    assert all(key in material['pbrMetallicRoughness'] for key in ('baseColorTexture', 'metallicRoughnessTexture'))
    assert material['occlusionTexture']['index'] == material['pbrMetallicRoughness']['metallicRoughnessTexture']['index']
    count = vertices = 0
    max_error = 0.0
    mesh_counts = {}
    for mesh in doc['meshes']:
        mesh_count = 0
        for primitive in mesh['primitives']:
            assert primitive.get('mode', 4) == 4
            indices = accessor(primitive['indices'])
            attrs = primitive['attributes']
            positions = accessor(attrs['POSITION'])
            assert len(indices) % 3 == 0 and (indices < len(positions)).all()
            for index in attrs.values():
                accessor(index)
            assert all(key in attrs for key in ('NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'))
            assert 'JOINTS_1' not in attrs and 'WEIGHTS_1' not in attrs
            joints, weights = accessor(attrs['JOINTS_0']), accessor(attrs['WEIGHTS_0'])
            assert (joints < len(skin['joints'])).all()
            assert (weights >= 0).all() and (weights <= 1).all()
            error = float(np.abs(weights.sum(axis=1) - 1).max())
            assert error < 1e-5
            max_error = max(max_error, error)
            vertices += len(positions)
            mesh_count += len(indices) // 3
        mesh_counts[mesh['name']] = mesh_count
        count += mesh_count
    assert 0 < count <= MAX_TRIANGLES, f'Triangle budget exceeded: {count}'

    parents = {child: parent for parent, node in enumerate(nodes) for child in node.get('children', [])}
    world_cache = {}

    def world_matrix(index):
        if index in world_cache:
            return world_cache[index]
        node = nodes[index]
        if 'matrix' in node:
            local = np.array(node['matrix']).reshape((4, 4)).T
        else:
            x, y, z, w = node.get('rotation', [0, 0, 0, 1])
            local = np.eye(4)
            local[:3, :3] = np.array([
                [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]) @ np.diag(node.get('scale', [1, 1, 1]))
            local[:3, 3] = node.get('translation', [0, 0, 0])
        world = world_matrix(parents[index]) @ local if index in parents else local
        world_cache[index] = world
        return world

    camera = world_matrix(names.index('FP_Camera'))
    assert np.max(np.abs(camera - np.eye(4))) < 1e-6, 'Camera reference is not identity'
    roots = doc['scenes'][doc.get('scene', 0)]['nodes']
    assert roots == [names.index('FP_Root')], 'Unexpected scene root'
    inverse = accessor(skin['inverseBindMatrices']).reshape((-1, 4, 4)).transpose((0, 2, 1))
    # Blender writes inverse *world* joint matrices; Three.js bindMatrix applies
    # the skinned mesh transform. Each joint/inverse product must be identity.
    bind_error = max(float(np.abs(world_matrix(joint) @ inv - np.eye(4)).max())
                     for joint, inv in zip(skin['joints'], inverse))
    assert bind_error < 1e-5, f'Rest binding mismatch: {bind_error}'
    transforms = {name: world_matrix(names.index(name)).tolist() for name in
                  (*BONES, 'FP_Root', 'FP_Camera', 'FP_WeaponSocket')}
    return {'passed': True, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'triangles': count, 'meshTriangles': mesh_counts, 'vertices': vertices,
            'bones': len(skin['joints']), 'maxWeightSumError': max_error,
            'restBindMatrixError': bind_error, 'animations': 0,
            'requiredExtensions': doc.get('extensionsRequired', []), 'worldMatrices': transforms,
            'imageSha256': [hashlib.sha256(binary[doc['bufferViews'][image['bufferView']].get('byteOffset', 0):
                doc['bufferViews'][image['bufferView']].get('byteOffset', 0) +
                doc['bufferViews'][image['bufferView']]['byteLength']]).hexdigest() for image in doc['images']]}


def run(args):
    work = Path(args.work).resolve() / 'model'
    work.mkdir(parents=True, exist_ok=True)
    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    bpy.context.preferences.filepaths.save_version = 0
    rig = bpy.data.objects['OfficerRig']
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.location = (0, 0, 0)
        bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    sleeves = [sleeve(bpy.data.objects['Shirt'], side, sign, args.sleeve_cut_x, args.arm_weight_min)
               for side, sign in (('Left', -1), ('Right', 1))]
    gloves = [bpy.data.objects['Glove_L'], bpy.data.objects['Glove_R']]
    for obj, suffix in zip(gloves, ('L', 'R')):
        obj.name = f'FP_Glove_{suffix}'
        obj.data.name = obj.name
    kept = [*sleeves, *gloves]
    for obj in list(bpy.context.scene.objects):
        if obj not in kept and obj != rig:
            bpy.data.objects.remove(obj, do_unlink=True)
    source_triangles = {obj.name: triangles(obj) for obj in kept}
    glove_count = sum(triangles(obj) for obj in gloves)
    sleeve_count = sum(triangles(obj) for obj in sleeves)
    # Preserve all finger geometry. Reduce only sleeve surfaces to meet budget.
    sleeve_ratio = min(1.0, (MAX_TRIANGLES - 128 - glove_count) / sleeve_count)
    if sleeve_ratio <= 0:
        raise RuntimeError('Gloves alone exceed the first-person triangle budget')
    if sleeve_ratio < 1:
        for obj in sleeves:
            activate(obj)
            modifier = obj.modifiers.new('FP_SleeveBudget', 'DECIMATE')
            modifier.ratio = sleeve_ratio
            modifier.use_collapse_triangulate = True
            while obj.modifiers[0] != modifier:
                bpy.ops.object.modifier_move_up(modifier=modifier.name)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    for side, sleeve_obj, glove_obj in zip(('Left', 'Right'), sleeves, gloves):
        for obj in (sleeve_obj, glove_obj):
            normalize_weights(obj, side)
            obj['surface'] = 'fabric'
            obj['sourcePart'] = 'C10 packed officer atlas; sleeve trim only' if obj in sleeves else 'C10 glove unchanged'
            for modifier in obj.modifiers:
                if modifier.type == 'ARMATURE':
                    modifier.use_deform_preserve_volume = False
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in list(rig.data.edit_bones):
        if bone.name not in BONES:
            rig.data.edit_bones.remove(bone)
    for side in ('Left', 'Right'):
        rig.data.edit_bones[side + 'Shoulder'].parent = None
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.name = 'FP_Armature'
    rig.data.name = 'FP_Armature'
    rig.animation_data_clear()
    root = bpy.data.objects.new('FP_Root', None)
    bpy.context.collection.objects.link(root)
    root['forward'] = '+Y Blender / -Z glTF; camera-relative meters'
    root['sourceChestPosition'] = list(CHEST_GLTF)
    root['sourceSha256'] = source_hash
    root['restPose'] = 'C10 A-pose; shoulder-to-fingertip rig; no clips'
    root['version'] = 1
    chest_blender = Vector((CHEST_GLTF[0], -CHEST_GLTF[2], CHEST_GLTF[1]))
    rig.location -= chest_blender
    rig.parent = root
    rig['boneCount'] = len(BONES)
    for name in ('FP_Camera', 'FP_WeaponSocket'):
        empty = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(empty)
        empty.parent = root
        empty.empty_display_type = 'ARROWS'
        empty.empty_display_size = 0.05
    bpy.data.objects['FP_Camera']['role'] = 'C10 chest lens reference; identity camera space'
    bpy.data.objects['FP_WeaponSocket']['role'] = 'Identity anchor; runtime owns W_Root/weapon pose'
    bpy.context.view_layer.update()
    report = {'sourceSha256': source_hash, 'chestReference': list(CHEST_GLTF),
              'sleeveCut': {'absWorldXMin': args.sleeve_cut_x, 'ownArmWeightMin': args.arm_weight_min},
              'sleeveDecimateRatio': sleeve_ratio, 'inputTrianglesAfterTrim': source_triangles,
              'triangles': {obj.name: triangles(obj) for obj in kept},
              'materials': [material.name for material in kept[0].data.materials],
              'bones': bone_report(rig)}
    (work / 'blender-report.json').write_text(json.dumps(report, indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(work / 'officer_fp.blend'), compress=True)
    pending = work / 'officer_fp.pending.glb'
    bpy.ops.export_scene.gltf(filepath=str(pending), export_format='GLB',
        export_animations=False, export_skins=True, export_all_influences=False,
        export_influence_nb=4, export_rest_position_armature=True,
        export_yup=True, export_apply=False, export_texcoords=True,
        export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='AUTO', export_extras=True, export_morph=False,
        export_cameras=False, export_lights=False, export_leaf_bone=False,
        export_def_bones=False, export_armature_object_remove=False)
    result = glb_readback(pending)
    # Numerical independent exported bone heads must agree with Blender conversion.
    for name, bone in report['bones'].items():
        head = np.array(result['worldMatrices'][name])[:3, 3]
        assert np.max(np.abs(head - bone['head'])) < 1e-5, f'Bone head changed: {name}'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash, 'Source changed during export'
    (work / 'glb-report.json').write_text(json.dumps(result, indent=2))
    output.parent.mkdir(parents=True, exist_ok=True)
    pending.replace(output)
    print('C18_FP_EXPORT', output, json.dumps({k: v for k, v in result.items()
          if k not in ('worldMatrices', 'imageSha256')}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default=str(DEFAULT_SOURCE))
    parser.add_argument('--output', default=str(REPO / 'public/bodycam-demo/models/officer_fp.glb'))
    parser.add_argument('--work', default=str(DEFAULT_WORK))
    parser.add_argument('--sleeve-cut-x', type=float, default=0.21)
    parser.add_argument('--arm-weight-min', type=float, default=0.35)
    cli = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    run(parser.parse_args(cli))
