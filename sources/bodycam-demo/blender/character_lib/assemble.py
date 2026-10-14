"""Bind rigid equipment, validate skin, orient the existing A-pose for the player."""
import bpy
import json
import math
from pathlib import Path
from .common import SCRATCH, CHARDIR, load_stage, save_stage, obj
from .materials import visible_meshes
from .settings import RIGID_BIND, ALBEDO_JPEG_QUALITY
from . import posing


def bone_parent(o, rig, bone):
    mw = o.matrix_world.copy()
    for mod in list(o.modifiers):
        if mod.type == 'ARMATURE':
            o.modifiers.remove(mod)
    for group in list(o.vertex_groups):
        o.vertex_groups.remove(group)
    o.parent = rig
    o.parent_type = 'BONE'
    o.parent_bone = bone
    bpy.context.view_layer.update()
    o.matrix_world = mw
    bpy.context.view_layer.update()
    o['rigidBone'] = bone


def run(args):
    from .skincheck import repair
    load_stage('bake')
    bpy.context.preferences.filepaths.save_version = 0
    rig = obj('OfficerRig')
    posing.reset(rig)
    bpy.context.view_layer.update()
    meshes = visible_meshes()
    rigid = {}
    for o in meshes:
        bone = RIGID_BIND.get(o.get('bind'))
        if o.name.startswith('Eye_'):
            bone = 'Head'
        if bone:
            bone_parent(o, rig, bone)
            rigid[o.name] = bone
        o['surface'] = ('flesh' if o.name.startswith(('OFF_Head', 'Eye_')) else
                        'metal' if o.get('gear_mat') == 'metal_dark' else 'fabric')
    skin = [o for o in meshes if any(m.type == 'ARMATURE' for m in o.modifiers)]
    for o in skin:
        for mod in o.modifiers:
            if mod.type == 'ARMATURE':
                # Match WebGL/glTF linear blend skinning in Blender previews.
                mod.use_deform_preserve_volume = False
    weights = repair(rig, skin)
    # Color-only JPEG saves bandwidth; linear ORM and normal stay lossless PNG.
    source_albedo = bpy.data.images['Officer_Albedo']
    albedo = bpy.data.images.load(str(Path(CHARDIR) / 'atlas/albedo.png'), check_existing=False)
    albedo.name = 'Officer_Albedo_Export'
    albedo.colorspace_settings.name = 'sRGB'
    # Force pixel load before assigning the output filepath.
    _ = albedo.pixels[0]
    albedo.filepath_raw = str(Path(CHARDIR) / 'atlas/albedo.jpg')
    albedo.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = ALBEDO_JPEG_QUALITY
    albedo.save(quality=ALBEDO_JPEG_QUALITY)
    albedo.pack()
    for node in bpy.data.materials['MU_OfficerAtlas'].node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image == source_albedo:
            node.image = albedo
    # Hidden transfer body is authoring input, not part of the shipped character.
    for o in list(bpy.context.scene.objects):
        if o not in meshes and o != rig:
            bpy.data.objects.remove(o, do_unlink=True)
    rig.rotation_euler.z = math.pi
    bpy.context.view_layer.update()
    floor_z = min((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
    rig.location.z -= floor_z
    bpy.context.view_layer.update()
    rig['forward'] = '+Y Blender / -Z glTF'
    rig['restPose'] = 'A-pose; no animation clips'
    rig['atlasSize'] = 2048
    report = {'rigidAttachments': rigid, 'weights': weights, 'floorShiftMeters': -floor_z,
              'bones': [b.name for b in rig.data.bones], 'skinMeshes': [o.name for o in skin]}
    (Path(CHARDIR) / 'reports/assemble.json').write_text(json.dumps(report, indent=2))
    save_stage('assemble')
    blend = Path(SCRATCH) / 'blend/officer.blend'
    blend.parent.mkdir(exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
