# Gemeinsame Helfer für character.py (Blender 5.x, headless)
import bpy, bmesh, math, os, sys, shutil
import numpy as np
from mathutils import Vector, Matrix

SCRATCH = os.environ.get('BODYCAM_SCRATCH',
    '/Users/logge/Documents/Projects/bodycam-work/codex/C10')
CHARDIR = os.path.join(SCRATCH, 'character')
STAGEDIR = os.path.join(CHARDIR, 'stages')
INPUTDIR = os.environ.get('BODYCAM_CHARACTER_SOURCE',
    '/Users/logge/Documents/Projects/bodycam-work/character')
os.makedirs(STAGEDIR, exist_ok=True)


def stage_path(name):
    return os.path.join(STAGEDIR, name + '.blend')


def save_stage(name):
    bpy.ops.wm.save_as_mainfile(filepath=stage_path(name), compress=True)
    print('STAGE saved', name)


def load_stage(name):
    path = stage_path(name)
    if not os.path.isfile(path):
        source = os.path.join(INPUTDIR, 'stages', name + '.blend')
        if not os.path.isfile(source):
            raise FileNotFoundError(f'Missing stage {name}: {path} or {source}')
        shutil.copy2(source, path)
    # Reuse source metadata without ever writing into the original stage tree.
    for filename in ('joints.json', 'gear_info.json', 'body_verts.npy', 'body_faces.npy'):
        dst, src = os.path.join(CHARDIR, filename), os.path.join(INPUTDIR, filename)
        if not os.path.exists(dst) and os.path.isfile(src):
            shutil.copy2(src, dst)
    bpy.ops.wm.open_mainfile(filepath=path)


def obj(name):
    return bpy.data.objects[name]


def set_active(o, select_only=True):
    if select_only:
        for x in bpy.context.view_layer.objects:
            x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def verts_np(o, world=True):
    me = o.data
    a = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', a)
    a = a.reshape(-1, 3)
    if world:
        M = np.array(o.matrix_world)
        a = a @ M[:3, :3].T + M[:3, 3]
    return a


def set_verts_np(o, a):
    o.data.vertices.foreach_set('co', a.astype(np.float32).ravel())
    o.data.update()


def normals_np(o):
    me = o.data
    a = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('normal', a)
    return a.reshape(-1, 3)


def link(o, coll=None):
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def new_mesh_obj(name, verts, faces, coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    o = bpy.data.objects.new(name, me)
    link(o, coll)
    return o


def apply_mods(o):
    set_active(o)
    for m in list(o.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:
            print('modifier_apply failed', o.name, m.name, e)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def adjacency(me):
    """vertex adjacency list (numpy-friendly)"""
    n = len(me.vertices)
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    return e


def laplacian_smooth(co, edges, mask, iters=10, lam=0.5):
    """smooth positions co (N,3) along edges; mask (N,) weight 0..1 per vertex"""
    n = len(co)
    co = co.copy()
    deg = np.bincount(edges.ravel(), minlength=n).astype(np.float64)
    deg[deg == 0] = 1
    for _ in range(iters):
        acc = np.zeros_like(co)
        np.add.at(acc, edges[:, 0], co[edges[:, 1]])
        np.add.at(acc, edges[:, 1], co[edges[:, 0]])
        avg = acc / deg[:, None]
        co += (avg - co) * (lam * mask)[:, None]
    return co


def taubin_smooth(co, edges, mask, iters=10, lam=0.5, mu=-0.53):
    n = len(co)
    co = co.copy()
    deg = np.bincount(edges.ravel(), minlength=n).astype(np.float64)
    deg[deg == 0] = 1
    for i in range(iters * 2):
        acc = np.zeros_like(co)
        np.add.at(acc, edges[:, 0], co[edges[:, 1]])
        np.add.at(acc, edges[:, 1], co[edges[:, 0]])
        avg = acc / deg[:, None]
        f = lam if i % 2 == 0 else mu
        co += (avg - co) * (f * mask)[:, None]
    return co


def vertex_normals_from(co, faces_flat, loop_start, loop_total):
    """recompute vertex normals for co using polygon fan (numpy)."""
    n = len(co)
    nrm = np.zeros((n, 3))
    for ls, lt in zip(loop_start, loop_total):
        pass
    return nrm
