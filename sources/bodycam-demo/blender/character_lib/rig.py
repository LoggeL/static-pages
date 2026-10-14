# Stage "rig": Armature mit Standardnamen aus den Gelenkpositionen (joints.py), Auto-Weights auf dem Basiskörper.
# Ausrichtung in diesem Stage: Figur blickt -Y (Blender-Standard). Die Drehung auf +Y (CONTRACT) passiert in "assemble".
import bpy, os, json
import numpy as np
from mathutils import Vector
from .common import *
from . import joints as JT

FING = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']

# (Name, Parent, Tail-Joint, Roll-Referenz (Z-Achse zeigt dorthin), deform)
def bone_table():
    B = [
        ('Hips', None, 'Spine', (0, -1, 0), True),
        ('Spine', 'Hips', 'Spine1', (0, -1, 0), True),
        ('Spine1', 'Spine', 'Spine2', (0, -1, 0), True),
        ('Spine2', 'Spine1', 'Neck', (0, -1, 0), True),
        ('Neck', 'Spine2', 'Head', (0, -1, 0), True),
        ('Head', 'Neck', 'HeadTop_End', (0, -1, 0), True),
        ('HeadTop_End', 'Head', None, (0, -1, 0), False),
    ]
    for S in ('Left', 'Right'):
        B += [
            (S + 'Shoulder', 'Spine2', S + 'Arm', (0, -1, 0), True),
            (S + 'Arm', S + 'Shoulder', S + 'ForeArm', (0, -1, 0), True),
            (S + 'ForeArm', S + 'Arm', S + 'Hand', (0, -1, 0), True),
            (S + 'ForeArmTwist', S + 'ForeArm', S + 'Hand', (0, -1, 0), True),
            (S + 'Hand', S + 'ForeArm', S + 'HandMiddle1', ('dorsal',), True),
        ]
        for f in FING:
            ref = ('thumb',) if f == 'Thumb' else ('dorsal',)
            for i in (1, 2, 3):
                par = S + 'Hand' if i == 1 else f'{S}Hand{f}{i-1}'
                B.append((f'{S}Hand{f}{i}', par, f'{S}Hand{f}{i+1}', ref, True))
            B.append((f'{S}Hand{f}4', f'{S}Hand{f}3', None, ref, False))
        B += [
            (S + 'UpLeg', 'Hips', S + 'Leg', (0, -1, 0), True),
            (S + 'Leg', S + 'UpLeg', S + 'Foot', (0, -1, 0), True),
            (S + 'Foot', S + 'Leg', S + 'ToeBase', (0, 0, 1), True),
            (S + 'ToeBase', S + 'Foot', S + 'Toe_End', (0, 0, 1), True),
            (S + 'Toe_End', S + 'ToeBase', None, (0, 0, 1), False),
        ]
    return B


def compute_joints():
    V = np.load(os.path.join(CHARDIR, 'body_verts.npy'))
    F = np.load(os.path.join(CHARDIR, 'body_faces.npy'), allow_pickle=True)
    J = JT.compute(V, F)
    return JT.mirror(J)


def run(args):
    load_stage('prep')
    J = compute_joints()
    json.dump({k: [float(x) for x in v] for k, v in J.items()}, open(os.path.join(CHARDIR, 'joints.json'), 'w'), indent=1)
    body = obj('BaseBody')
    arm_data = bpy.data.armatures.new('OfficerRig')
    rig = bpy.data.objects.new('OfficerRig', arm_data)
    bpy.context.scene.collection.objects.link(rig)
    set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    table = bone_table()
    # Twist-Bone: Kopf in Unterarmmitte
    for name, par, tail, ref, deform in table:
        b = eb.new(name)
        if name.endswith('ForeArmTwist'):
            S = name[:-12]
            h = 0.5 * (J[S + 'ForeArm'] + J[S + 'Hand'])
        else:
            h = J[name]
        b.head = Vector(h)
        if tail is not None:
            b.tail = Vector(J[tail])
        else:
            # Endknochen: Verlängerung des Elternknochens
            pb = eb[par]
            d = (pb.tail - pb.head).normalized()
            b.tail = b.head + d * (0.02 if 'Hand' in name else 0.05)
        b.use_deform = deform
    for name, par, tail, ref, deform in table:
        b = eb[name]
        if par:
            b.parent = eb[par]
            b.use_connect = False
        side = -1.0 if name.startswith('Right') else 1.0
        if ref == ('dorsal',):
            v = Vector((-side, 0, 0))         # Z zur Handfläche -> Beugen = +X-Rotation
        elif ref == ('thumb',):
            v = Vector((-side * 0.55, 0.85, 0))  # Z zur Daumenbeere (Nagel zeigt nach vorn/außen)
        else:
            v = Vector(ref)
        b.align_roll(v)
    # Twist-Knochen ist ForeArm-Kind; Hand bleibt am ForeArm (Animation dreht Twist optional mit)
    bpy.ops.object.mode_set(mode='OBJECT')
    arm_data.display_type = 'STICK'
    # Auto-Weights
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    print('RIG groups', len(body.vertex_groups))
    # Augen starr an Head
    for e in (obj('Eye_L'), obj('Eye_R')):
        mw = e.matrix_world.copy()
        e.parent = rig
        e.parent_type = 'BONE'
        e.parent_bone = 'Head'
        e.matrix_world = mw
    save_stage('rig')
