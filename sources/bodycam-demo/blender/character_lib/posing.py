# Testposen für Sichtprüfung der Gewichte (Rotationen in Bone-lokalen Achsen, Grad, XYZ-Euler).
# Konvention (siehe rig.py): Beugen = +X für Wirbelsäule, Arm/Unterarm (nach vorn), Hand und Finger (zur Handfläche),
# Hüfte (Oberschenkel nach vorn); Knie beugen = -X.
import bpy, math
from mathutils import Vector, Euler, Matrix, Quaternion


def reset(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def apply(rig, pose):
    for name, rot in pose.items():
        for S in (('Left', 'Right') if name.startswith('*') else ('',)):
            n = name.replace('*', S)
            pb = rig.pose.bones.get(n)
            if pb is None:
                continue
            pb.rotation_mode = 'XYZ'
            r = list(rot)
            if S == 'Right':   # gespiegelte Seite: Y/Z-Rotation invertieren
                r = [r[0], -r[1], -r[2]]
            pb.rotation_euler = [math.radians(a) for a in r]
    bpy.context.view_layer.update()


def point(rig, name, world_dir, twist=0.0):
    """Knochen (lokale Y-Achse) in Weltrichtung drehen (minimale Rotation), optional Twist um Y (Grad)."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[name]
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    M = rig.matrix_world @ pb.matrix
    cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    tgt = Vector(world_dir).normalized()
    q_world = cur.rotation_difference(tgt)
    # Weltrotation in lokale Bone-Rotation umrechnen
    R = M.to_3x3().normalized()
    q_local = (R.inverted() @ q_world.to_matrix() @ R).to_quaternion()
    q_local = q_local @ Quaternion((0, 1, 0), math.radians(twist))
    pb.rotation_quaternion = q_local
    bpy.context.view_layer.update()


FIST = {}
for f, (a, b, c) in {'Index': (85, 100, 60), 'Middle': (88, 100, 60), 'Ring': (90, 100, 60), 'Pinky': (92, 95, 60)}.items():
    FIST[f'*Hand{f}1'] = (a, 0, 0); FIST[f'*Hand{f}2'] = (b, 0, 0); FIST[f'*Hand{f}3'] = (c, 0, 0)
FIST.update({'*HandThumb1': (25, 0, 25), '*HandThumb2': (35, 0, 0), '*HandThumb3': (45, 0, 0)})

GRIP = {}
for f, (a, b, c) in {'Middle': (75, 85, 35), 'Ring': (80, 85, 35), 'Pinky': (85, 80, 35)}.items():
    GRIP[f'*Hand{f}1'] = (a, 0, 0); GRIP[f'*Hand{f}2'] = (b, 0, 0); GRIP[f'*Hand{f}3'] = (c, 0, 0)
GRIP.update({'*HandIndex1': (20, 0, 0), '*HandIndex2': (25, 0, 0), '*HandIndex3': (10, 0, 0),
             '*HandThumb1': (30, 0, 20), '*HandThumb2': (30, 0, 0), '*HandThumb3': (25, 0, 0)})

SPREAD = {'*HandIndex1': (-10, 0, 8), '*HandMiddle1': (-10, 0, 0), '*HandRing1': (-10, 0, -8), '*HandPinky1': (-10, 0, -16),
          '*HandIndex2': (-5, 0, 0), '*HandMiddle2': (-5, 0, 0), '*HandRing2': (-5, 0, 0), '*HandPinky2': (-5, 0, 0),
          '*HandThumb1': (-10, 0, -25)}

TEST = {
    'rest': {},
    'elbow': {'*ForeArm': (125, 0, 0), '*Arm': (40, 0, 0)},
    'squat': {'*UpLeg': (95, 0, 0), '*Leg': (-115, 0, 0), '*Foot': (25, 0, 0), 'Spine': (15, 0, 0), 'Spine1': (10, 0, 0)},
    'bend': {'Spine': (25, 0, 0), 'Spine1': (20, 0, 0), 'Spine2': (15, 0, 0), 'Neck': (20, 0, 0), 'Head': (20, 0, 0)},
    'twist': {'*ForeArmTwist': (0, 45, 0), '*Hand': (0, 90, 0)},
    'wrist': {'*Hand': (60, 0, 0)},
}


def ik2(rig, upper, lower, target, pole):
    """Analytisches 2-Knochen-IK: upper/lower = Bone-Namen, target = Weltposition Handgelenk, pole = Weltpunkt für Ellbogen."""
    bpy.context.view_layer.update()
    for n in (upper, lower):
        pb = rig.pose.bones[n]
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    mw = rig.matrix_world
    pu, pl = rig.pose.bones[upper], rig.pose.bones[lower]
    S = mw @ pu.head
    a = (pu.tail - pu.head).length
    b = (pl.tail - pl.head).length
    T = Vector(target); Pp = Vector(pole)
    d = T - S
    L = min(d.length, (a + b) * 0.999)
    dn = d.normalized()
    # Ellbogen in der Ebene (S, T, pole)
    x = (a * a - b * b + L * L) / (2 * L)
    h = math.sqrt(max(a * a - x * x, 0.0))
    pv = (Pp - S) - dn * ((Pp - S) @ dn)
    pv = pv.normalized()
    E = S + dn * x + pv * h
    point(rig, upper, E - S)
    point(rig, lower, (S + dn * L) - E)
    return E


def orient(rig, name, y_dir, z_dir):
    """Bone so drehen, dass lokale Y = y_dir und lokale Z ~ z_dir (Weltkoordinaten)."""
    bpy.context.view_layer.update()
    pb = rig.pose.bones[name]
    pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    M = (rig.matrix_world @ pb.matrix).to_3x3().normalized()
    y = Vector(y_dir).normalized()
    z = Vector(z_dir); z = (z - y * (z @ y)).normalized()
    x = y.cross(z)
    Rt = Matrix((x, y, z)).transposed()
    q_local = (M.inverted() @ Rt).to_quaternion()
    pb.rotation_quaternion = q_local
    bpy.context.view_layer.update()
