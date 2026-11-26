#!/usr/bin/env python3
"""
Baked occlusion / cavity / edge maps for the hero vehicle (Cycles, one EMIT bake per atlas).

Every bake object gets a second, unique UV set ("UVBake" -> glTF TEXCOORD_1 -> three `uv1`) made with
Smart UV Project across all objects of an atlas. One emission material packs three ray-traced masks:

    R = ambient occlusion, long range (1.2 m)   -> contact shadows under cab, in wheel arches, between parts
    G = cavity, short range (5 cm)              -> grime / dust collects here, grease at joints
    B = "inside" occlusion (8 mm)                -> DARK on convex edges -> paint chips and polished plastic

The atlas is written next to the GLBs (`<name>_bake.webp`) and applied by the vehicle shader hook in
src/tractor.ts; it is not referenced by the glTF materials (they are shared between tractor and trailer).
"""

import math
import subprocess
from pathlib import Path

import bmesh
import bpy
from mathutils import kdtree

BAKE_UV = "UVBake"
SKIP_MATERIAL_WORDS = ("Glass", "Decal", "Display", "Leaf", "Headlight", "Taillight", "Beacon", "Lens", "Live")


def _wants_bake(mat) -> bool:
    return mat is not None and not any(w in mat.name for w in SKIP_MATERIAL_WORDS)


def make_bake_uvs(unwrap_objs, copies=()):
    """
    unwrap_objs: mesh objects that share one atlas.  copies: (src_obj, dst_obj) pairs with identical
    topology (mirrored wheels) -- dst simply reuses the UVs of src so the atlas only stores one of them.
    """
    for obj in list(unwrap_objs) + [d for _s, d in copies]:
        me = obj.data
        if BAKE_UV in me.uv_layers:
            me.uv_layers.remove(me.uv_layers[BAKE_UV])
        me.uv_layers.new(name=BAKE_UV, do_init=False)
        me.uv_layers.active = me.uv_layers[BAKE_UV]

    bpy.ops.object.select_all(action='DESELECT')
    for obj in unwrap_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = unwrap_objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    for obj in unwrap_objs:
        bm = bmesh.from_edit_mesh(obj.data)
        want = [_wants_bake(m) for m in obj.data.materials]
        for f in bm.faces:
            f.select = want[f.material_index]
        bmesh.update_edit_mesh(obj.data)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0012, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    for src, dst in copies:
        # Same part, possibly X-mirrored (left / right wheel): match faces by centre, loops by position.
        ms, md = src.data, dst.data
        if len(ms.polygons) != len(md.polygons):
            raise RuntimeError(f"bake UV copy {src.name} -> {dst.name}: face count differs")
        kd = kdtree.KDTree(len(ms.polygons))
        for p in ms.polygons:
            kd.insert(p.center, p.index)
        kd.balance()
        us, ud = ms.uv_layers[BAKE_UV].data, md.uv_layers[BAKE_UV].data
        tol = 2e-4
        for pd in md.polygons:
            c = pd.center
            mirror = False
            _co, idx, dist = kd.find(c)
            if dist > tol:
                _co, idx, dist = kd.find((-c.x, c.y, c.z))
                mirror = True
                if dist > tol:
                    raise RuntimeError(f"bake UV copy {src.name} -> {dst.name}: no matching face at {tuple(c)}")
            ps = ms.polygons[idx]
            src_loops = [(ms.vertices[ms.loops[li].vertex_index].co, li) for li in ps.loop_indices]
            for li in pd.loop_indices:
                co = md.vertices[md.loops[li].vertex_index].co
                if mirror:
                    co = co.copy()
                    co.x = -co.x
                best = min(src_loops, key=lambda t: (t[0] - co).length_squared)
                ud[li].uv = us[best[1]].uv

    for obj in list(unwrap_objs) + [d for _s, d in copies]:
        obj.data.uv_layers.active = obj.data.uv_layers[0]


def _bake_material(image):
    mat = bpy.data.materials.new("_KH_BakeMasks")
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    comb = nt.nodes.new("ShaderNodeCombineColor")
    chans = []
    for dist, inside in ((1.2, False), (0.05, False), (0.008, True)):
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 12
        ao.inside = inside
        ao.only_local = False
        ao.inputs["Distance"].default_value = dist
        chans.append(ao)
    for k, name in enumerate(("Red", "Green", "Blue")):
        nt.links.new(chans[k].outputs["AO"], comb.inputs[name])
    nt.links.new(comb.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.nodes.active = tex
    return mat


def bake_masks(passes, out_webp: Path, size=4096, pixel_samples=6, ground=True):
    """
    passes: list of (objects_to_bake, isolate) -- isolate=True hides every other object while baking
    (wheels must not carry the shadow of the mudguards or the ground: they rotate).
    """
    scene = bpy.context.scene
    bpy.ops.preferences.addon_enable(module='cycles')
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.refresh_devices()
    gpu = False
    for d in prefs.devices:
        d.use = d.type == 'METAL'
        gpu = gpu or d.use
    scene.cycles.device = 'GPU' if gpu else 'CPU'
    scene.cycles.samples = pixel_samples
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 6
    scene.render.bake.use_clear = False

    img = bpy.data.images.new("_kh_bake", size, size, alpha=False, float_buffer=False, is_data=True)
    img.generated_color = (1.0, 1.0, 1.0, 1.0)
    mat = _bake_material(img)

    ground_obj = None
    if ground:
        me = bpy.data.meshes.new("_kh_bake_ground")
        me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
        ground_obj = bpy.data.objects.new("_kh_bake_ground", me)
        scene.collection.objects.link(ground_obj)

    all_objs = [o for o in scene.objects if o.type == 'MESH' and o is not ground_obj]
    overlays = [o for o in all_objs if o.name.endswith("_Overlay")]      # glass / decals never occlude
    saved = {}
    try:
        for objs, isolate in passes:
            for o in all_objs:
                o.hide_render = (isolate and o not in objs) or o in overlays
            if ground_obj is not None:
                ground_obj.hide_render = isolate
            bpy.ops.object.select_all(action='DESELECT')
            for o in objs:
                if o.name not in saved:
                    saved[o.name] = (o, [s.material for s in o.material_slots])
                for s in o.material_slots:
                    s.material = mat
                o.data.uv_layers.active = o.data.uv_layers[BAKE_UV]
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.object.bake(type='EMIT')
            for o in objs:
                o.data.uv_layers.active = o.data.uv_layers[0]
                for s, m in zip(o.material_slots, saved[o.name][1]):
                    s.material = m
    finally:
        for o in all_objs:
            o.hide_render = False
        for _name, (o, mats) in saved.items():
            for s, m in zip(o.material_slots, mats):
                s.material = m
        if ground_obj is not None:
            bpy.data.objects.remove(ground_obj, do_unlink=True)
        bpy.data.materials.remove(mat)

    png = out_webp.with_suffix(".png")
    img.filepath_raw = str(png)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    # Blender's Python has no Pillow: convert with the system interpreter (fail loudly if that breaks)
    code = ("import sys; from PIL import Image; im = Image.open(sys.argv[1]).convert('RGB'); "
            "im.save(sys.argv[2], 'WEBP', quality=86, method=6)")
    subprocess.run(["python3", "-c", code, str(png), str(out_webp)], check=True)
    png.unlink()
    print(f"Baked {out_webp.name}: {size}px, {out_webp.stat().st_size / 1e6:.2f} MB")
