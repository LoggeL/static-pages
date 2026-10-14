# Stage "prep": CC0-Basismesh (Blender Human Base Meshes, "Body Male - Realistic", Dan Ulrich, CC0) laden,
# Multires Level 1 anwenden, auf Spielergröße skalieren, Kopf-Haare/Augen behalten.
import bpy, os
import numpy as np
from .common import *

BUNDLE = os.path.join(CHARDIR, 'dl/ex/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend')
if not os.path.isfile(BUNDLE):
    BUNDLE = os.path.join(INPUTDIR, 'dl/ex/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend')
EYE_HEIGHT_BAREFOOT = 1.690   # + ~3 cm Stiefelsohle -> Augenhöhe 1.72 (CONTRACT)


def run(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with bpy.data.libraries.load(BUNDLE, link=False) as (df, dt):
        dt.collections = [c for c in df.collections if c == 'Body Male - Realistic']
    coll = dt.collections[0]
    bpy.context.scene.collection.children.link(coll)
    body = obj('GEO-body_male_realistic')
    eyes = [obj('GEO-body_male_realistic.eye.L'), obj('GEO-body_male_realistic.eye.R')]
    body.location.x = 0
    # Multires Level 1 anwenden
    m = body.modifiers[0]
    m.levels = 1
    set_active(body)
    bpy.ops.object.modifier_apply(modifier=m.name)
    # Augen entparenten (Welttransform behalten)
    for e in eyes:
        mw = e.matrix_world.copy()
        e.parent = None
        e.matrix_world = mw
    # Skalierung: Augenmitte -> EYE_HEIGHT_BAREFOOT
    eye_z = eyes[0].matrix_world.translation.z
    co = verts_np(body)
    zmin = co[:, 2].min()
    s = (EYE_HEIGHT_BAREFOOT) / (eye_z - zmin)
    print('PREP scale', s, 'eye_z', eye_z, 'zmin', zmin)
    for o in [body] + eyes:
        set_active(o)
        o.location.z -= zmin
        o.location *= s
        o.scale *= s
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # Objektnamen
    body.name = 'BaseBody'
    body.data.name = 'BaseBody'
    eyes[0].name = 'Eye_L'; eyes[1].name = 'Eye_R'
    # Objekt-Ursprünge der Augen in Augenmitte setzen
    for e in eyes:
        set_active(e)
        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    co = verts_np(body)
    print('PREP verts', len(co), 'bbox', co.min(0), co.max(0))
    np.save(os.path.join(CHARDIR, 'body_verts.npy'), co)
    f = [list(p.vertices) for p in body.data.polygons]
    np.save(os.path.join(CHARDIR, 'body_faces.npy'), np.array(f, dtype=object), allow_pickle=True)
    save_stage('prep')
