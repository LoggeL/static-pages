"""Finish existing constant material recipes, prepare one shared atlas UV set."""
import bpy
import json
import math
from pathlib import Path
from .common import CHARDIR, load_stage, save_stage, set_active
from .settings import ATLAS_SIZE, ATLAS_MARGIN, DECIMATE


def visible_meshes():
    return sorted((o for o in bpy.context.scene.objects
                   if o.type == 'MESH' and not o.hide_render and not o.hide_viewport), key=lambda o: o.name)


def run(args):
    load_stage('gear')
    bpy.context.preferences.filepaths.save_version = 0
    meshes = visible_meshes()
    report = {'paletteSource': 'gear.blend existing Principled values; no new surface design', 'meshes': {}}
    for o in meshes:
        if o.name == 'Pants':
            # Generated lower-leg BM faces defaulted to flat while the original
            # upper garment was smooth. Restore continuous cloth shading only.
            for polygon in o.data.polygons:
                polygon.use_smooth = True
        for m in o.modifiers:
            if m.type == 'ARMATURE':
                m.show_viewport = m.show_render = False
        if not o.data.materials:
            m = bpy.data.materials.new('SRC_' + o.name)
            m.use_nodes = True
            # Blender's original default surface (eyes had no assigned material).
            o.data.materials.append(m)
        before = len(o.data.polygons)
        ratio = DECIMATE.get(o.name, 1.0)
        if ratio < 1:
            set_active(o)
            mod = o.modifiers.new('ExportDensity', 'DECIMATE')
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_move_up(modifier=mod.name)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        report['meshes'][o.name] = {'sourcePolygons': before, 'exportPolygons': len(o.data.polygons), 'ratio': ratio}
        # All source recipes use constants. Preserve source UVs for future authoring.
        if o.data.uv_layers.active:
            o.data.uv_layers.active.name = 'SourceUV'
        atlas = o.data.uv_layers.new(name='AtlasUV')
        o.data.uv_layers.active = atlas
        atlas.active_render = True
    set_active(meshes[0])
    for o in meshes:
        o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=ATLAS_MARGIN / ATLAS_SIZE,
                            margin_method='FRACTION', area_weight=0.5, correct_aspect=True,
                            scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    out = Path(CHARDIR) / 'reports'
    out.mkdir(exist_ok=True)
    (out / 'materials.json').write_text(json.dumps(report, indent=2))
    save_stage('materials')
