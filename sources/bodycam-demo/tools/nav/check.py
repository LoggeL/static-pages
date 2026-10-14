#!/usr/bin/env python3
"""Validate nav topology, raw spawns and capsule clearance against the source GLB."""

import argparse
from collections import Counter
import json
from pathlib import Path
import sys
import time

import numpy as np

sys.dont_write_bytecode = True
from bake import REPO, ROOT, CollisionGrid, read_collision, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nav', type=Path, default=ROOT/'data/nav.json')
    parser.add_argument('--report', type=Path, help='Write report outside the repository')
    args = parser.parse_args()
    if args.report:
        args.report = args.report.expanduser().resolve()
        if args.report.is_relative_to(REPO):
            parser.error('--report must be outside the repository (C19 scratch directory)')
    started = time.monotonic()
    data = json.loads(args.nav.read_text())
    level_path, collision_path = ROOT/data['bake']['level'], ROOT/data['bake']['collision']
    assert sha(level_path) == data['bake']['levelSHA256'], 'Stale level bake'
    assert sha(collision_path) == data['bake']['collisionSHA256'], 'Stale collision bake'
    level = json.loads(level_path.read_text())
    triangles, surfaces, meshes, door_meshes = read_collision(collision_path)
    assert sum(q['triangles'] for q in meshes) == data['bake']['staticTriangles']
    assert len(door_meshes) == len(data['doors']) == 7
    agent, grid, nodes = data['agent'], data['grid'], data['nodes']
    queries = CollisionGrid(triangles, surfaces, data['bake']['boundsXZ'], level['rooms'],
                            agent['radius'], agent['height'], agent['maxStep'], agent['skin'])
    lookup = {tuple(node[:2]): i for i, node in enumerate(nodes)}
    assert len(lookup) == len(nodes), 'Duplicate XZ cells'
    points = np.array([[grid['origin'][0]+node[0]*grid['cellSize'], node[2],
                        grid['origin'][1]+node[1]*grid['cellSize']] for node in nodes])
    bad_nodes, bad_edges, directed, checked_midpoints = [], [], 0, 0
    room_counts = Counter()
    for i, node in enumerate(nodes):
        x, y, z = points[i]
        if not queries.clear(x, y-agent['skin'], z):
            bad_nodes.append(i)
        if node[5] == grid['mainComponent']:
            room_counts[data['rooms'][node[3]]['id']] += 1
        for direction, (dx, dz) in enumerate(grid['directions']):
            if not node[4] & (1 << direction):
                continue
            directed += 1
            j = lookup.get((node[0]+dx, node[1]+dz))
            assert j is not None, f'Edge to missing cell {i}'
            assert nodes[j][5] == node[5], f'Edge crosses component label {i}'
            reverse = grid['directions'].index([-dx, -dz])
            assert nodes[j][4] & (1 << reverse), f'Asymmetric edge {i}-{j}'
            assert abs(node[2]-nodes[j][2]) <= agent['maxStep']+.003, f'Step too high {i}-{j}'
            if direction >= 4:
                for side in [(node[0]+dx, node[1]), (node[0], node[1]+dz)]:
                    assert side in lookup, f'Corner cut {i}-{j}'
                    side_index = lookup[side]
                    side_direction = grid['directions'].index([side[0]-node[0], side[1]-node[1]])
                    next_direction = grid['directions'].index([nodes[j][0]-side[0], nodes[j][1]-side[1]])
                    assert node[4] & (1 << side_direction), f'Missing cardinal corridor {i}-{j}'
                    assert nodes[side_index][4] & (1 << next_direction), f'Missing cardinal corridor {i}-{j}'
            # Independently sample every indoor link and every height transition.
            indoor = not level['rooms'][node[3]].get('outdoor')
            changed_height = abs(node[2]-nodes[j][2]) > .002
            if j > i and (indoor or changed_height):
                checked_midpoints += 1
                middle = (points[i]+points[j])/2
                middle[1] = max(node[2], nodes[j][2])-agent['skin']
                if not queries.clear(*[middle[0], middle[1], middle[2]]):
                    bad_edges.append([i, j])
        if i % 5000 == 0:
            print(f'validated {i}/{len(nodes)} cells', flush=True)
    assert directed//2 == data['bake']['edges']
    # Rounded recorded feet cannot silently make a support-free or collision point valid.
    assert not bad_nodes, f'Capsule-overlapping cells: {bad_nodes[:12]}'
    assert not bad_edges, f'Capsule-overlapping links: {bad_edges[:12]}'
    for room in data['rooms']:
        if room['node'] is None:
            continue
        point = np.array(room['goal'])
        assert np.linalg.norm(point-points[room['node']]) < .0001
        assert nodes[room['node']][3] == next(i for i, r in enumerate(data['rooms']) if r['id'] == room['id'])
        assert room['reachable'] == (nodes[room['node']][5] == grid['mainComponent'])
    for spawn in data['spawns']:
        raw = spawn['raw']
        assert queries.clear(*raw) == spawn['rawCapsuleClear']
        projected = spawn['projected']
        if projected:
            assert queries.clear(projected[0], projected[1]-agent['skin'], projected[2])
    report = {'status': 'passed', 'cells': len(nodes), 'edges': directed//2,
              'fullCapsuleClearanceCells': len(nodes), 'indoorOrChangingHeightEdgeMidpoints': checked_midpoints,
              'edgeCheckScope': 'topology: every edge; capsule midpoint: every indoor edge and every height-changing edge',
              'mainComponentRooms': dict(room_counts),
              'unreachableRooms': [room['id'] for room in data['rooms'] if not room['reachable']],
              'rawSpawns': data['spawns'], 'sourceHashes': {'collision': sha(collision_path), 'level': sha(level_path)},
              'seconds': round(time.monotonic()-started, 2)}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
