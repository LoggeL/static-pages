"""Deterministic weight sanitation; never changes rest vertices or bone matrices."""
import math
import re

FINGER = re.compile(r'^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([123])$')
EPSILON = 1e-6
FINGER_DISTAL_METERS = 0.012


def _is_skin(obj, rig):
    return obj.type == 'MESH' and (bool(obj.vertex_groups) or any(
        modifier.type == 'ARMATURE' and modifier.object == rig for modifier in obj.modifiers))


def validate(rig, meshes):
    deform = {b.name for b in rig.data.bones if b.use_deform}
    objects = {}
    for obj in meshes:
        if not _is_skin(obj, rig):
            continue
        names = {g.index: g.name for g in obj.vertex_groups}
        result = dict(vertices=len(obj.data.vertices), maxInfluences=0,
                      unweighted=0, unnormalized=0, invalid=0, maxSumError=0.0)
        for vertex in obj.data.vertices:
            weights = [g.weight for g in vertex.groups
                       if names[g.group] in deform and g.weight > EPSILON]
            result['invalid'] += sum(not math.isfinite(g.weight) or g.weight < 0
                                     for g in vertex.groups)
            total = sum(weights)
            result['maxInfluences'] = max(result['maxInfluences'], len(weights))
            result['unweighted'] += not weights
            result['unnormalized'] += abs(total - 1) > 1e-5
            result['maxSumError'] = max(result['maxSumError'], abs(total - 1))
        objects[obj.name] = result
    return {'objects': objects,
            'passed': all(v['maxInfluences'] <= 4 and not any(v[k] for k in
                          ('unweighted', 'unnormalized', 'invalid')) for v in objects.values())}


def repair(rig, meshes):
    """Limit/normalize deform weights and remove anatomically impossible leakage.

    Finger-family weights at webs and palm remain blended. Past the MCP transition
    only the dominant finger family and Hand are retained. Source phalanx ratios
    remain intact; no nearest-bone rebinding replaces authored joint falloffs.
    """
    meshes = [o for o in meshes if _is_skin(o, rig)]
    report = {'before': validate(rig, meshes), 'objects': {},
              'parameters': {'maxInfluences': 4, 'epsilon': EPSILON,
                             'fingerDistalMeters': FINGER_DISTAL_METERS}}
    bones = {b.name: b for b in rig.data.bones if b.use_deform}
    inv = rig.matrix_world.inverted()
    for obj in meshes:
        names = {g.index: g.name for g in obj.vertex_groups}
        changes = dict(normalizedOrLimited=0, crossSideRemoved=0,
                       distalFingerFamilyRemoved=0, sleeveFingerRemoved=0,
                       torsoBandLeakageRemoved=0, unweightedAssigned=0)
        transform = inv @ obj.matrix_world
        for vertex in obj.data.vertices:
            old = {names[g.group]: float(g.weight) for g in vertex.groups}
            weights = {n: w for n, w in old.items()
                       if n in bones and math.isfinite(w) and w > EPSILON}
            point = transform @ vertex.co
            if obj.name.startswith('Cummerbund_'):
                # Body transfer leaked from nearby arms and thighs into these
                # waist/chest bands. Keep their existing torso falloff, moving
                # only invalid mass to the two surrounding axial joints.
                axial = ('Hips', 'Spine', 'Spine1', 'Spine2')
                bad = [n for n in weights if n not in axial]
                if bad:
                    amount = sum(weights.pop(n) for n in bad)
                    z = float(point.z)
                    lower, upper = axial[0], axial[-1]
                    for a, b in zip(axial[:-1], axial[1:]):
                        if z <= bones[b].head_local.z:
                            lower, upper = a, b
                            break
                    lo, hi = bones[lower].head_local.z, bones[upper].head_local.z
                    t = max(0, min(1, (z - lo) / (hi - lo)))
                    for bone, portion in ((lower, 1 - t), (upper, t)):
                        if portion > EPSILON:
                            weights[bone] = weights.get(bone, 0) + amount * portion
                    changes['torsoBandLeakageRemoved'] += 1
            # Bones and source geometry retain their pre-assemble local axes.
            side = 'Left' if point.x > 0 else 'Right'
            other = 'Right' if side == 'Left' else 'Left'
            if abs(point.x) > 0.12:
                bad = [n for n in weights if n.startswith(other)]
                if bad:
                    changes['crossSideRemoved'] += 1
                    for n in bad:
                        del weights[n]
            if obj.name in ('Shirt', 'ShirtCollar'):
                fingers = [n for n in weights if FINGER.match(n)]
                if fingers:
                    hand = side + 'Hand'
                    weights[hand] = weights.get(hand, 0) + sum(weights.pop(n) for n in fingers)
                    changes['sleeveFingerRemoved'] += 1
            if obj.name.startswith('Glove_'):
                families = {}
                for n, w in weights.items():
                    match = FINGER.match(n)
                    if match:
                        family = match.group(1) + 'Hand' + match.group(2)
                        families[family] = families.get(family, 0) + w
                if len(families) > 1:
                    family = max(families, key=families.get)
                    first = bones[family + '1']
                    distal = (point - first.head_local).dot(
                        (first.tail_local - first.head_local).normalized())
                    if distal > FINGER_DISTAL_METERS:
                        bad = [n for n in weights if FINGER.match(n) and not n.startswith(family)]
                        for n in bad:
                            del weights[n]
                        changes['distalFingerFamilyRemoved'] += bool(bad)
            if not weights:
                # Only reached for missing/invalid source skin. Closest rest segment.
                def distance(bone):
                    a, b = bone.head_local, bone.tail_local
                    direction = b - a
                    t = max(0, min(1, (point - a).dot(direction) / direction.length_squared))
                    return (point - a - direction * t).length_squared
                weights = {min(bones, key=lambda n: distance(bones[n])): 1.0}
                changes['unweightedAssigned'] += 1
            weights = dict(sorted(weights.items(), key=lambda item: (-item[1], item[0]))[:4])
            total = sum(weights.values())
            weights = {n: w / total for n, w in weights.items()}
            if set(old) != set(weights) or any(abs(old.get(n, 0) - w) > 1e-7 for n, w in weights.items()):
                changes['normalizedOrLimited'] += 1
                for index in [g.group for g in vertex.groups]:
                    obj.vertex_groups[index].remove([vertex.index])
                for n, w in weights.items():
                    group = obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n)
                    group.add([vertex.index], w, 'REPLACE')
        report['objects'][obj.name] = changes
    report['after'] = validate(rig, meshes)
    if not report['after']['passed']:
        raise RuntimeError('Skin weight repair did not meet normalized four-influence contract')
    return report
