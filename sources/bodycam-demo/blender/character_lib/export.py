"""Portable GLB, embedded atlas, stable skeleton, no clips or decoder dependency."""
import bpy
import json
from pathlib import Path
from .common import SCRATCH, CHARDIR
from .settings import DEPLOY, MAX_GLB_BYTES


def run(args):
    bpy.ops.wm.open_mainfile(filepath=str(Path(SCRATCH) / 'blend/officer.blend'))
    path = DEPLOY / 'models/officer.glb'
    path.parent.mkdir(exist_ok=True)
    pending = Path(CHARDIR) / 'officer.pending.glb'
    bpy.ops.export_scene.gltf(filepath=str(pending), export_format='GLB',
        export_animations=False, export_skins=True, export_all_influences=False,
        export_influence_nb=4, export_rest_position_armature=True,
        export_yup=True, export_apply=False, export_texcoords=True,
        export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='AUTO', export_extras=True, export_morph=False,
        export_cameras=False, export_lights=False, export_leaf_bone=False,
        export_def_bones=False, export_armature_object_remove=False)
    size = pending.stat().st_size
    if size > MAX_GLB_BYTES:
        raise RuntimeError(f'GLB exceeds size budget: {size} > {MAX_GLB_BYTES}')
    from .glbcheck import check
    report = check(pending)
    (Path(CHARDIR) / 'reports/glbcheck.json').write_text(json.dumps(report, indent=2))
    pending.replace(path)
    print('EXPORTED', path, size, 'bytes', flush=True)
