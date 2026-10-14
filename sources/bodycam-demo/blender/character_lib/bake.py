"""Cycles bake of existing recipes into albedo, tangent normal and packed ORM."""
import bpy
from pathlib import Path
from .common import CHARDIR, load_stage, save_stage, set_active
from .materials import visible_meshes
from .settings import ATLAS_SIZE, ATLAS_MARGIN, BAKE_SAMPLES, AO_DISTANCE


def image(name, color, srgb=False):
    im = bpy.data.images.new(name, width=ATLAS_SIZE, height=ATLAS_SIZE, alpha=False)
    im.generated_color = (*color, 1)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return im


def run(args):
    load_stage('materials')
    bpy.context.preferences.filepaths.save_version = 0
    meshes = visible_meshes()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = BAKE_SAMPLES
    sc.render.bake.margin = ATLAS_MARGIN
    sc.render.bake.use_clear = False
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.normal_space = 'TANGENT'
    materials = set(m for o in meshes for m in o.data.materials)
    targets = {}
    for m in materials:
        m.use_nodes = True
        targets[m] = m.node_tree.nodes.new('ShaderNodeTexImage')
    set_active(meshes[0])
    for o in meshes:
        o.select_set(True)
    maps = {
        'albedo': image('Officer_Albedo', (0.05, 0.05, 0.05), True),
        'normal': image('Officer_Normal', (0.5, 0.5, 1.0)),
        'orm': image('Officer_ORM', (1, 0.85, 0)),
    }
    # AO node goes into emission R, existing recipe roughness G and metalness B.
    # This avoids three additional full bakes and writes linear packed data.
    for key in ('albedo', 'normal', 'orm'):
        restore = []
        for m in materials:
            nt = m.node_tree
            nt.nodes.active = targets[m]
            targets[m].image = maps[key]
            if key == 'orm':
                bsdf = nt.nodes.get('Principled BSDF')
                out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
                old = [(l.from_socket, l.to_socket) for l in out.inputs['Surface'].links]
                ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
                ao.inputs['Distance'].default_value = AO_DISTANCE
                ao.samples = BAKE_SAMPLES
                combine = nt.nodes.new('ShaderNodeCombineColor')
                combine.mode = 'RGB'
                combine.inputs[1].default_value = bsdf.inputs['Roughness'].default_value
                combine.inputs[2].default_value = bsdf.inputs['Metallic'].default_value
                emit = nt.nodes.new('ShaderNodeEmission')
                nt.links.new(ao.outputs['AO'], combine.inputs[0])
                nt.links.new(combine.outputs[0], emit.inputs[0])
                nt.links.new(emit.outputs[0], out.inputs['Surface'])
                restore.append((nt, old, (ao, combine, emit)))
        kwargs = {'type': {'albedo': 'DIFFUSE', 'normal': 'NORMAL', 'orm': 'EMIT'}[key]}
        if key == 'albedo':
            kwargs['pass_filter'] = {'COLOR'}
        print('BAKE', key, flush=True)
        bpy.ops.object.bake(**kwargs)
        for nt, old, nodes in restore:
            for n in nodes:
                nt.nodes.remove(n)
            for src, dst in old:
                nt.links.new(src, dst)
        outdir = Path(CHARDIR) / 'atlas'
        outdir.mkdir(exist_ok=True)
        maps[key].filepath_raw = str(outdir / (key + '.png'))
        maps[key].file_format = 'PNG'
        maps[key].save()
        maps[key].pack()
    mat = bpy.data.materials.new('MU_OfficerAtlas')
    mat.use_nodes = True
    nt = mat.node_tree
    bs = nt.nodes.get('Principled BSDF')
    bs.inputs['Metallic'].default_value = 1
    bs.inputs['Roughness'].default_value = 1
    tex = {}
    for key, im in maps.items():
        tex[key] = nt.nodes.new('ShaderNodeTexImage')
        tex[key].image = im
    nt.links.new(tex['albedo'].outputs['Color'], bs.inputs['Base Color'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex['normal'].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tex['orm'].outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs[1], bs.inputs['Roughness'])
    nt.links.new(sep.outputs[2], bs.inputs['Metallic'])
    group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    group.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    ao_out = nt.nodes.new('ShaderNodeGroup')
    ao_out.node_tree = group
    nt.links.new(sep.outputs[0], ao_out.inputs['Occlusion'])
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mat)
        # Export one UV channel. Atlas was baked on this exact mesh.
        for uv in list(o.data.uv_layers):
            if uv.name != 'AtlasUV':
                o.data.uv_layers.remove(uv)
        for mod in o.modifiers:
            if mod.type == 'ARMATURE':
                mod.show_viewport = mod.show_render = True
    save_stage('bake')
