# Stage "posetest": Testposen rendern.  args: <stage> <prefix> <pose,pose,...> [engine=wb|cy] [views]
import bpy, os, math
from mathutils import Vector
from .common import *
from . import preview as P
from . import posing as PO

VIEWS = {
    'full': [('front', (0.9, -3.2, 1.2), (0, 0, 0.95), 40, None)],
    'upper': [('upper', (0.9, -1.6, 1.5), (0.1, 0, 1.2), 40, None)],
    'handL': [('handL', (0.75, -0.55, 0.95), (0.42, -0.12, 0.86), 50, None)],
    'handLp': [('handLp', (0.05, -0.45, 0.80), (0.42, -0.12, 0.86), 50, None)],
    'legs': [('legs', (0.9, -2.2, 0.7), (0, 0, 0.55), 40, None)],
    'side': [('side', (3.2, -0.2, 1.1), (0, 0, 0.95), 40, None)],
    'back': [('back', (-1.0, 3.0, 1.3), (0, 0, 0.95), 40, None)],
    'armL': [('armL', (0.9, -0.9, 1.25), (0.32, -0.02, 1.12), 40, None)],
    'armLb': [('armLb', (0.9, 0.7, 1.1), (0.32, -0.02, 1.12), 40, None)],
    'gloveL': [('gloveL', (0.75, -0.3, 0.95), (0.42, -0.10, 0.88), 50, None)],
    'gloveLp': [('gloveLp', (0.15, -0.40, 0.85), (0.42, -0.11, 0.87), 50, None)],
    'bootL': [('bootL', (0.55, -0.45, 0.25), (0.2, -0.03, 0.06), 45, None)],
    'bootLs': [('bootLs', (0.75, 0.0, 0.12), (0.2, -0.03, 0.07), 45, None)],
    'legsF': [('legsF', (0.3, -1.4, 0.7), (0.0, 0, 0.55), 40, None)],
    'down': [('down', (0.0, -0.17, 1.42), (0.0, -0.45, 0.0), 18, None)],
}
# dynamische Ansichten: (suffix, bone, offset-richtung, abstand, lens)
DYN = {
    'fistL': [('fistLa', 'LeftHandMiddle1', (0.8, -0.6, 0.2), 0.32, 50), ('fistLb', 'LeftHandMiddle1', (-0.3, -0.9, -0.3), 0.32, 50),
              ('fistLc', 'LeftHandMiddle1', (0.6, -0.2, -0.8), 0.32, 50)],
    'elbowL': [('elbowLa', 'LeftForeArm', (0.7, -0.7, 0.1), 0.6, 50), ('elbowLb', 'LeftForeArm', (0.9, 0.4, 0.1), 0.6, 50)],
    'shoulderL': [('shoulderLa', 'LeftArm', (0.5, -0.85, 0.2), 0.75, 50), ('shoulderLb', 'LeftArm', (0.6, 0.6, 0.4), 0.75, 50)],
    'kneeL': [('kneeLa', 'LeftLeg', (0.6, -0.8, 0.3), 0.9, 45), ('kneeLb', 'LeftLeg', (1.0, 0.0, 0.2), 0.9, 45)],
    'hipL': [('hipLa', 'LeftUpLeg', (0.3, -0.9, 0.2), 0.8, 45), ('hipLb', 'LeftUpLeg', (0.2, 0.9, 0.2), 0.8, 45)],
    'torso': [('torsoa', 'Spine1', (0.4, -0.9, 0.1), 1.5, 45), ('torsob', 'Spine1', (1.0, 0.1, 0.1), 1.5, 45)],
    'fp': [('fp', 'Spine2', (0.0, -0.25, 0.05), 0.0, 24)],
    'aimside': [('aimside', 'Spine2', (-1.0, -0.6, 0.3), 1.2, 40), ('aimtop', 'Spine2', (0.4, -0.6, 1.0), 1.3, 40)],
    'wristL': [('wristLa', 'LeftHand', (0.8, -0.5, 0.2), 0.3, 50), ('wristLb', 'LeftHand', (-0.5, -0.8, 0.2), 0.3, 50)],
}


def dyn_views(rig, key):
    out = []
    for suf, bone, d, dist, lens in DYN[key]:
        pb = rig.pose.bones[bone]
        c = rig.matrix_world @ ((pb.head + pb.tail) * 0.5 if 'Hand' not in bone else pb.head)
        if dist == 0.0:   # Bodycam-Sicht: Kamera an der Brust, Blick nach vorn
            camp = c + Vector((0, -0.17, 0.06))
            out.append((suf, tuple(camp), tuple(camp + Vector((0, -1, -0.12))), lens, None))
            continue
        dv = Vector(d).normalized()
        out.append((suf, tuple(c + dv * dist), tuple(c), lens, None))
    return out


def custom_pose(rig, name):
    """Posen, die Richtungen in Objektkoordinaten brauchen (Figur blickt -Y)."""
    if name == 'aim':
        # Karabiner im Anschlag: rechte Hand am Griff, linke Hand am Handschutz (Figur blickt -Y)
        PO.apply(rig, {'Spine1': (4, 0, 0), 'Spine2': (4, 0, 0), 'Neck': (6, 0, 0), 'Head': (4, 0, 0)})
        PO.ik2(rig, 'RightArm', 'RightForeArm', (-0.07, -0.33, 1.30), (-0.45, -0.1, 0.9))
        PO.orient(rig, 'RightHand', (0.25, -0.75, -0.6), (0.9, 0.1, 0.1))
        PO.ik2(rig, 'LeftArm', 'LeftForeArm', (0.02, -0.62, 1.30), (0.35, -0.3, 0.9))
        PO.orient(rig, 'LeftHand', (-0.3, -0.85, 0.2), (0.2, 0.0, 0.95))
        PO.apply(rig, {k: v for k, v in PO.GRIP.items() if k.startswith('*')})
        return True
    if name == 'armsup':
        PO.point(rig, 'LeftArm', (0.3, -0.2, 1.0))
        PO.point(rig, 'RightArm', (-1.0, 0.0, 0.1))
        return True
    return False


def run(args):
    stage, prefix, poses = args[0], args[1], args[2].split(',')
    engine = args[3] if len(args) > 3 else 'wb'
    views = args[4].split(',') if len(args) > 4 else ['full']
    if stage.endswith('.blend'):
        bpy.ops.wm.open_mainfile(filepath=stage)
    else:
        load_stage(stage)
    rig = obj('OfficerRig')
    out = []
    if engine == 'cy':
        P.studio_lights()
    for pose in poses:
        PO.reset(rig)
        if not custom_pose(rig, pose):
            src = getattr(PO, pose.upper(), None)
            if src is None:
                src = PO.TEST.get(pose, {})
            PO.apply(rig, src)
        vv = []
        for v in views:
            vv += VIEWS[v] if v in VIEWS else dyn_views(rig, v)
        path = os.path.join(P.PREVIEWS, f'{prefix}_{pose}.png')
        if engine == 'cy':
            out += P.cycles(path, vv, samples=48, res=(900, 1100))
        else:
            out += P.workbench(path, vv, res=(800, 1000))
    print('POSETEST', out)
