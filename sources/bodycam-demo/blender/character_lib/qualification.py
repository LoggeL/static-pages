"""Reproducible pose, skin and contact diagnostics; scratch output only.

    blender -b -P character.py -- qualification [input.blend] [--no-render]

Open garments do not enclose a physical volume. Their signed tetrahedron sums and
joint covariance ratios are diagnostic proxies, explicitly not collision proofs.
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .common import SCRATCH, CHARDIR
from . import posing as PO
from . import preview as P
from . import skincheck

POSES = ('rest', 'fist', 'grip', 'arms-forward', 'squat', 'look-down')
QA_DIR = os.path.join(CHARDIR, 'qa')
CONTACT_PAIRS = (('Shirt', 'Carrier_Front'), ('Shirt', 'Carrier_Back'),
                 ('Shirt', 'Glove_L'), ('Shirt', 'Glove_R'),
                 ('Pants', 'Holster_shell'), ('OFF_Head', 'ShirtCollar'),
                 ('Cummerbund_L', 'Shirt'), ('Cummerbund_R', 'Shirt'),
                 ('Strap_L', 'Shirt'), ('Strap_R', 'Shirt'))
REFERENCE_BONES = ('Hips', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
                   'LeftHand', 'RightHand', 'LeftHandIndex3', 'LeftHandMiddle3',
                   'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot')


def gltf_points(points):
    points = np.asarray(points)
    return np.round(points[..., [0, 2, 1]] * np.array([1, 1, -1]), 7).tolist()


def bodycam():
    # Fixed required height; move the test lens outside its physical housing.
    front = .17
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.hide_render:
            continue
        vertices, _ = evaluated(obj)
        band = (np.abs(vertices[:, 0]) < .08) & (np.abs(vertices[:, 2] - 1.4) < .05)
        if band.any():
            front = max(front, float(vertices[band, 1].max()))
    position = (0, front + .025, 1.40)
    target = (0, front + .175, 0)
    return {'position': gltf_points(position), 'target': gltf_points(target), 'fov': 82,
            'near': .005, 'heightMeters': 1.40,
            'note': 'Lens 25 mm in front of chest-band geometry; physical pouches occlude lower torso.'}


def evaluated(obj):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    mesh.calc_loop_triangles()
    vertices = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get('co', vertices)
    vertices = vertices.reshape(-1, 3)
    matrix = np.asarray(ev.matrix_world)
    vertices = vertices @ matrix[:3, :3].T + matrix[:3, 3]
    faces = np.array([tuple(t.vertices) for t in mesh.loop_triangles], dtype=np.int32)
    ev.to_mesh_clear()
    return vertices, faces


def geometric_stats(vertices, faces):
    points = vertices[faces]
    cross = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
    area = np.linalg.norm(cross, axis=1) * 0.5
    # Centroid reference reduces floating point cancellation and is consistent
    # under translation even for an open garment.
    center = vertices.mean(axis=0)
    signed_volume = float(np.einsum('ij,ij->i', points[:, 0] - center, cross).sum() / 6)
    edges = np.sort(np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]])), axis=1)
    unique_edges, edge_count = np.unique(edges, axis=0, return_counts=True)
    lengths = np.linalg.norm(vertices[unique_edges[:, 0]] - vertices[unique_edges[:, 1]], axis=1)
    return area, lengths, signed_volume, int(np.count_nonzero(edge_count != 2))


def self_contacts(vertices, faces):
    """Nonadjacent BVH triangle overlap candidates, excluding shared vertices.

    Thin hems, touching surfaces and preexisting folded seams can contribute.
    Baseline subtraction is reported separately; this is not penetration depth.
    """
    tree = BVHTree.FromPolygons(vertices.tolist(), faces.tolist(), all_triangles=True, epsilon=1e-7)
    candidates = tree.overlap(tree)
    count = 0
    participating = set()
    examples = []
    for a, b in candidates:
        if a >= b or len(set(faces[a]) & set(faces[b])):
            continue
        count += 1
        participating.update((a, b))
        if len(examples) < 8:
            examples.append([int(a), int(b)])
    return {'nonadjacentTrianglePairs': count, 'triangles': len(participating),
            'examples': examples}


def garment_contacts(data):
    names = {n for pair in CONTACT_PAIRS for n in pair if n in data}
    trees = {n: BVHTree.FromPolygons(data[n][0].tolist(), data[n][1].tolist(),
                                   all_triangles=True, epsilon=1e-7) for n in names}
    return {'/'.join(pair): len(trees[pair[0]].overlap(trees[pair[1]]))
            for pair in CONTACT_PAIRS if all(n in trees for n in pair)}


def pose(rig, name):
    PO.reset(rig)
    bpy.context.view_layer.update()
    if name in ('fist', 'grip'):
        PO.apply(rig, PO.FIST if name == 'fist' else PO.GRIP)
    elif name == 'arms-forward':
        for side, sign in (('Left', -1), ('Right', 1)):
            PO.point(rig, side + 'Arm', (sign * .20, 1.0, -.24))
            PO.point(rig, side + 'ForeArm', (-sign * .10, 1.0, .16))
            PO.point(rig, side + 'Hand', (0, 1.0, -.10))
        PO.apply(rig, PO.GRIP)
    elif name == 'squat':
        PO.apply(rig, PO.TEST['squat'])
        bpy.context.view_layer.update()
        boot_bottom = min(evaluated(bpy.data.objects[n])[0][:, 2].min()
                          for n in ('BootSole_L', 'BootSole_R'))
        hips = rig.pose.bones['Hips']
        local_to_world = (rig.matrix_world @ hips.bone.matrix_local).to_3x3()
        hips.location = local_to_world.inverted() @ Vector((0, 0, -float(boot_bottom)))
    elif name == 'look-down':
        PO.apply(rig, {'Neck': (30, 0, 0), 'Head': (25, 0, 0)})
    bpy.context.view_layer.update()


def pose_delta(rig):
    bones = {}
    for pb in rig.pose.bones:
        q = pb.matrix_basis.to_quaternion().normalized()
        if abs(q.w - 1) < 1e-8 and pb.location.length < 1e-8:
            continue
        entry = {'quaternion': [float(q.x), float(q.y), float(q.z), float(q.w)]}
        if pb.location.length > 1e-8:
            entry['position'] = [float(x) for x in pb.location]
        bones[pb.name] = entry
    return {'bones': bones}


def joint_regions(rig, baseline):
    regions = []
    for side, glove in (('Left', 'Glove_L'), ('Right', 'Glove_R')):
        for bone, name, radius in ((side + 'Arm', 'Shirt', .085),
                                   (side + 'ForeArm', 'Shirt', .065),
                                   (side + 'Hand', glove, .035),
                                   (side + 'Leg', 'Pants', .065)):
            if name not in baseline:
                continue
            center = np.asarray(rig.matrix_world @ rig.data.bones[bone].head_local)
            vertices = baseline[name][0]
            indices = np.where(np.linalg.norm(vertices - center, axis=1) < radius)[0]
            if len(indices) > 8:
                regions.append((bone, name, indices))
    return regions


def local_extent(vertices):
    singular = np.linalg.svd(vertices - vertices.mean(axis=0), compute_uv=False)
    return np.maximum(singular / math.sqrt(len(vertices)), 1e-9)


def views(rig, name):
    result = [('full', (1.9, 3.5, 1.45), (0, .05, .95), 65, None)]
    def close(label, bone, offset, distance, lens=50):
        pb = rig.pose.bones[bone]
        center = rig.matrix_world @ pb.head
        position = center + Vector(offset).normalized() * distance
        return (label, position, center, lens, None)
    if name in ('fist', 'grip', 'rest'):
        result.extend([
            close('hand-palm', 'LeftHandMiddle1', (.7, .8, -.3), .28),
            close('hand-back', 'LeftHandMiddle1', (-.8, .6, .3), .28),
        ])
    if name == 'arms-forward':
        result.extend([
            close('shoulder', 'LeftArm', (-.8, .65, .3), .65),
            close('elbow', 'LeftForeArm', (-.8, .1, -.2), .5),
            close('wrist', 'LeftHand', (-.7, .8, .1), .32),
        ])
    if name == 'squat':
        result.extend([('side', (3, 0, .9), (0, .1, .65), 58, None),
                       close('knee', 'LeftLeg', (-.8, .65, .2), .65)])
    if name == 'look-down':
        camera = bodycam()
        # glTF -> Blender conversion for the render camera.
        def blender(point):
            return (point[0], -point[2], point[1])
        lens = 24 / (2 * math.tan(math.radians(camera['fov']) / 2))
        result.append(('bodycam-1m40', blender(camera['position']), blender(camera['target']), lens, None))
    return result


def run(args):
    os.makedirs(QA_DIR, exist_ok=True)
    inputs = [a for a in args if not a.startswith('--')]
    source = inputs[0] if inputs else os.path.join(SCRATCH, 'blend', 'officer.blend')
    bpy.ops.wm.open_mainfile(filepath=source)
    rig = bpy.data.objects['OfficerRig']
    visible = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render]
    PO.reset(rig)
    bpy.context.view_layer.update()
    meshes = {o.name: o for o in visible if any(
        modifier.type == 'ARMATURE' and modifier.object == rig for modifier in o.modifiers)}
    baseline = {n: evaluated(o) for n, o in meshes.items()}
    contact_meshes = {n: bpy.data.objects[n] for pair in CONTACT_PAIRS for n in pair
                      if n in bpy.data.objects}
    baseline_contacts = garment_contacts({n: evaluated(o) for n, o in contact_meshes.items()})
    base_stats = {n: geometric_stats(*data) for n, data in baseline.items()}
    base_contacts = {n: self_contacts(*data) for n, data in baseline.items()}
    regions = joint_regions(rig, baseline)
    report = {'source': source, 'weights': skincheck.validate(rig, visible), 'poses': {},
              'limits': [
                  'BVH overlap counts are nonadjacent triangle candidates, not penetration depths.',
                  'Open garments have signed-volume proxies only; baseline seams and hems are retained.',
                  'Joint covariance is a local thickness/volume proxy, not physical enclosed volume.',
                  'Linear-blend skinning is measured; no corrective shapes or cloth collision solver.',
                  'Pose renders require visual review; metrics alone do not certify collision-free meshes.',
              ]}
    payload = {'version': 1, 'space': 'bone-delta', 'poses': {}}
    reference = {'version': 1, 'space': 'gltf-world', 'source': source, 'bones': {}, 'meshes': {}}
    for mesh_name in ('Shirt', 'Glove_L', 'Cummerbund_L'):
        vertices = baseline[mesh_name][0]
        indices = np.unique(np.linspace(0, len(vertices) - 1, min(1024, len(vertices)), dtype=int))
        reference['meshes'][mesh_name] = {'indices': indices.tolist(),
                                          'rest': gltf_points(vertices[indices]), 'poses': {}}
    for name in POSES:
        pose(rig, name)
        payload['poses'][name] = pose_delta(rig)
        if name == 'look-down':
            payload['poses'][name]['camera'] = bodycam()
        reference['bones'][name] = {bone: gltf_points(rig.matrix_world @ rig.pose.bones[bone].head)
                                   for bone in REFERENCE_BONES}
        current = {n: evaluated(o) for n, o in meshes.items()}
        for mesh_name, entry in reference['meshes'].items():
            entry['poses'][name] = gltf_points(current[mesh_name][0][entry['indices']])
        contacts_between = garment_contacts({n: evaluated(o) for n, o in contact_meshes.items()})
        results = {}
        for mesh_name, data in current.items():
            areas, edges, volume, boundaries = geometric_stats(*data)
            base_area, base_edge, base_volume, _ = base_stats[mesh_name]
            eligible = base_area > 1e-10
            ratios = areas[eligible] / base_area[eligible]
            edge_ratio = edges[base_edge > 1e-7] / base_edge[base_edge > 1e-7]
            contacts = self_contacts(*data) if name != 'rest' else base_contacts[mesh_name]
            results[mesh_name] = {
                'vertices': len(data[0]), 'triangles': len(data[1]),
                'finite': bool(np.isfinite(data[0]).all()),
                'triangleAreaRatio': {str(q): float(np.percentile(ratios, q)) for q in (0, 1, 5, 50, 99, 100)},
                'collapsedBelow5Percent': int(np.count_nonzero(ratios < .05)),
                'edgeLengthRatio': {str(q): float(np.percentile(edge_ratio, q)) for q in (0, 1, 50, 99, 100)},
                'restDegenerateTriangles': int(np.count_nonzero(~eligible)),
                'nonManifoldEdges': boundaries,
                'signedVolumeProxy': volume,
                'absoluteSignedVolumeRatio': abs(volume / base_volume) if abs(base_volume) > 1e-10 else None,
                'volumeIsClosed': boundaries == 0,
                'selfContactCandidates': contacts,
                'contactPairDeltaFromRest': contacts['nonadjacentTrianglePairs'] - base_contacts[mesh_name]['nonadjacentTrianglePairs'],
            }
        joint_results = {}
        for bone, mesh_name, indices in regions:
            old = local_extent(baseline[mesh_name][0][indices])
            new = local_extent(current[mesh_name][0][indices])
            joint_results[bone] = {'mesh': mesh_name, 'vertices': len(indices),
                                  'principalExtentRatios': (new / old).tolist(),
                                  'covarianceVolumeRatio': float(np.prod(new / old))}
        renders = []
        if '--no-render' not in args:
            # Workbench exposes silhouette and fold collapse without texture noise.
            for view in views(rig, name):
                camera = P._cam()
                camera.data.sensor_fit = 'VERTICAL' if view[0] == 'bodycam-1m40' else 'AUTO'
                camera.data.sensor_height = 24
                renders.extend(P.workbench(os.path.join(QA_DIR, name + '.png'), [view],
                                           res=(800, 900), color='MATERIAL'))
        report['poses'][name] = {'meshes': results, 'joints': joint_results, 'renders': renders,
                                'garmentContactCandidates': {
                                    n: {'trianglePairs': count, 'deltaFromRest': count - baseline_contacts[n]}
                                    for n, count in contacts_between.items()}}
        print('QUALIFICATION', name, 'collapsed', sum(r['collapsedBelow5Percent'] for r in results.values()),
              'contactDelta', sum(r['contactPairDeltaFromRest'] for r in results.values()), flush=True)
    report['structuralChecksCovered'] = ['Normalized weights', 'Maximum four deform influences',
                                         'No unweighted vertices', 'Finite deformed coordinates']
    report['structuralChecksPassed'] = report['weights']['passed'] and all(
        m['finite'] for p in report['poses'].values() for m in p['meshes'].values())
    with open(os.path.join(QA_DIR, 'metrics.json'), 'w') as file:
        json.dump(report, file, indent=2, allow_nan=False)
    with open(os.path.join(QA_DIR, 'poses.json'), 'w') as file:
        json.dump(payload, file, indent=2, allow_nan=False)
    with open(os.path.join(QA_DIR, 'pose-reference.json'), 'w') as file:
        json.dump(reference, file, separators=(',', ':'), allow_nan=False)
    PO.reset(rig)
    print('QUALIFICATION report', os.path.join(QA_DIR, 'metrics.json'), flush=True)
