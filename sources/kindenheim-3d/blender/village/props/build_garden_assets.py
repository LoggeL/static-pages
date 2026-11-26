#!/usr/bin/env python3
"""
Garden vegetation + near-camera ground cover (Blender 5.2, no rendering).

    python3 blender/village/props/build_garden_atlases.py
    /opt/homebrew/bin/blender --background --python blender/village/props/build_garden_assets.py

Writes public/assets/models/village/props/garden.glb and groundcover.glb and merges the props keys
"garden" / "groundcover" into props_meta.json and the village manifest (other keys untouched).

garden.glb nodes (<name>_LOD0 [/_LOD1] /_FAR), all in UNIT sizes that src/scenery.ts scales per detection:
    hedge_thuja | hedge_laurel | hedge_privet | hedge_hornbeam   clipped hedge bay: 2 m long (X), 1 m wide, 1.6 m tall
    shrub_round | shrub_pink | shrub_white | shrub_fine           bush: radius 1 m, height 1.75 m
    conifer_spruce (10 m tall, r 2.3) | conifer_thuja (5 m, r 0.8) | conifer_pine (12 m, crown r 3.2)
groundcover.glb nodes: gc_grass, gc_tall, gc_weed, gc_flower, gc_reed (one small mesh each, single LOD)
The LOD0 node of every asset carries its unit size and LOD distances as glTF extras.
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veg_blender import (  # noqa: E402
    PROJECT_ROOT,
    AtlasInfo,
    MeshBuilder,
    clear_scene,
    export_glb,
    object_bounds_gltf,
    rand_unit,
    triangle_count,
)

TEX_DIR = os.path.join(PROJECT_ROOT, 'blender/village/textures/props')
GLB_DIR = os.path.join(PROJECT_ROOT, 'public/assets/models/village/props')
META_FILES = (os.path.join(PROJECT_ROOT, 'blender/village/props/props_meta.json'), os.path.join(PROJECT_ROOT, 'public/assets/models/village/props_meta.json'))
MANIFEST = os.path.join(PROJECT_ROOT, 'public/assets/models/village/manifest.json')
UP = Vector((0, 0, 1))


def _quad_c(mb, pts, uvs, normals, datas, colors):
    ids = [mb.vert(pts[i], normals[i], uvs[i], datas[i], colors[i]) for i in range(4)]
    mb.face(*ids)


def _rect_uvs(rect, flip=False):
    u0, v0, u1, v1 = rect
    if flip:
        u0, u1 = u1, u0
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


# ---------------------------------------------------------------------------------------------------------
# Clipped garden hedge bay (unit: x -1..1, y -0.5..0.5, z 0..HEDGE_H)
# ---------------------------------------------------------------------------------------------------------

# Unit height of the bay. Detected clipped hedges are 0.6-3.2 m tall (most 1-2 m); the bay is authored at a typical
# 1.6 m so scenery.ts stretches / squashes it by at most ~2x instead of 3x (a 1 m unit turned tall hedges into
# vertical streaks).
HEDGE_H = 1.6
# Cross-section of the clipped hedge core (y, z/HEDGE_H) from the left foot over the rounded crown to the right foot.
# The foot is drawn in (hedges go thin and bare at the bottom), the shoulders are rounded - no cuboid edge anywhere.
_PROFILE_N = [(-0.37, 0.0), (-0.43, 0.14), (-0.45, 0.5), (-0.44, 0.8), (-0.36, 0.92), (-0.17, 0.985), (0.0, 1.0),
              (0.17, 0.985), (0.36, 0.92), (0.44, 0.8), (0.45, 0.5), (0.43, 0.14), (0.37, 0.0)]
_PROFILE_FAR_N = [(-0.37, 0.0), (-0.45, 0.6), (-0.37, 0.93), (0.0, 1.0), (0.37, 0.93), (0.45, 0.6), (0.37, 0.0)]
HEDGE_PROFILE = [(y, z * HEDGE_H) for y, z in _PROFILE_N]
HEDGE_PROFILE_FAR = [(y, z * HEDGE_H) for y, z in _PROFILE_FAR_N]


def _hedge_half_width(z: float) -> float:
    """Half width of the core at height z (right half of HEDGE_PROFILE)."""
    right = [p for p in HEDGE_PROFILE if p[0] >= 0.0][::-1]  # foot -> crown
    for (y0, z0), (y1, z1) in zip(right, right[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / max(1e-6, z1 - z0)
            return y0 + (y1 - y0) * t
    raise ValueError(f'height {z} outside the hedge profile')


def _profile_normal(y: float, z: float) -> Vector:
    zn = z / HEDGE_H
    return Vector((0.0, y / 0.45, max(0.0, zn - 0.5) / 0.5 * 1.2 + 0.15)).normalized()


def _hedge_ao(z: float) -> float:
    return 0.42 + 0.58 * min(1.0, z / (0.85 * HEDGE_H))


def _hedge_core(mb: MeshBuilder, wall, profile, rng: random.Random, x_segs: int, shade: float, wobble: float) -> None:
    """Rounded, slightly uneven hedge core extruded along X (-1..1), darker towards the foot (the inside of a hedge
    is shaded and sparse). The end rings are exact so mirrored neighbour bays join without a seam; inner rings wobble."""
    u0, v0, u1, v1 = wall
    arc = [0.0]
    for (ya, za), (yb, zb) in zip(profile, profile[1:]):
        arc.append(arc[-1] + math.hypot(yb - ya, zb - za))
    half_arc = arc[-1] * 0.5  # the wall tile runs foot -> crown on each flank (mirrored): ~2 m per tile, no stretch
    rings = []
    for ix in range(x_segs + 1):
        x = -1.0 + 2.0 * ix / x_segs
        inner = 0 < ix < x_segs
        dz = rng.uniform(-wobble, wobble) if inner else 0.0
        dy = rng.uniform(-wobble, wobble) * 0.6 if inner else 0.0
        ring = []
        for k, (y, z) in enumerate(profile):
            zz = z + dz * z
            yy = y * (1.0 + dy)
            ao = _hedge_ao(zz)
            c = (shade * ao * rng.uniform(0.95, 1.04), shade * ao, shade * ao * rng.uniform(0.9, 1.0))
            uv = (u0 + (u1 - u0) * (ix / x_segs), v0 + (v1 - v0) * (min(arc[k], arc[-1] - arc[k]) / half_arc))
            ring.append(mb.vert((x, yy, zz), _profile_normal(yy, zz), uv, (0.0, 0.6), c))
        rings.append(ring)
    for ix in range(x_segs):
        for k in range(len(profile) - 1):
            # winding: outward faces (profile runs from -y over the top to +y, x grows)
            mb.face(rings[ix][k], rings[ix + 1][k], rings[ix + 1][k + 1], rings[ix][k + 1])
    # end caps (dark: only the cut end of a run shows them, and there sprigs cover most of it)
    for x in (-1.0, 1.0):
        n = Vector((x, 0, 0))
        ids = []
        for y, z in profile:
            uv = (u0 + (u1 - u0) * (0.5 + y), v0 + (v1 - v0) * (z / HEDGE_H))
            ao = _hedge_ao(z) * 0.85
            ids.append(mb.vert((x, y, z), n, uv, (0.0, 0.6), (shade * ao, shade * ao, shade * ao * 0.95)))
        mb.face(*(ids[::-1] if x > 0 else ids))


def build_hedge(col, mat, atlas: AtlasInfo, key: str, wall_tile: str, tuft_tile: str, seed: int):
    """Clipped garden hedge bay, unit 2 m (X) x 1 m (Y) x HEDGE_H (Z). A rounded dark core under a ragged shell of
    alpha leaf sprigs: sprigs rooted inside the core stick out of the flanks and fan over the crown, so the silhouette
    is leafy instead of a textured cuboid; a skirt of dark sprigs hides the line where the hedge meets the ground."""
    wall = atlas.rect(wall_tile, 3)
    tuft = atlas.rect(tuft_tile)
    rng = random.Random(seed)
    H = HEDGE_H

    def nrm_fn(outward: Vector):
        n = outward.normalized()
        return lambda p, c, n=n: n

    def sprig(mb: MeshBuilder, root: Vector, direction: Vector, size: float, shade: float, along: Vector | None = None):
        """A leaf card rooted at `root` (stem end, inside the core) growing along `direction`."""
        up = direction.normalized()
        side = along if along is not None else Vector((1.0, 0.0, 0.0))
        right = (side - up * side.dot(up))
        if right.length < 0.1:
            right = up.orthogonal()
        right.normalize()
        out = Vector((0.0, up.y, max(0.25, up.z)))
        tint = (shade * rng.uniform(0.9, 1.06), shade * rng.uniform(0.96, 1.02), shade * rng.uniform(0.84, 1.0))
        mb.grid_card(root, right, up, Vector((0, 0, -0.08)) * size, size * rng.uniform(0.9, 1.15), size, tuft, nrm_fn(out), color=tint,
                     translucency=0.6, rows=1, flip_u=rng.random() < 0.5)

    def side_point(side: float, x: float, z: float, depth: float) -> Vector:
        return Vector((x, side * (_hedge_half_width(z) - depth), z))

    # ---------------- FAR: rounded core + crown and flank sprigs (ragged outline from the drone / cab) ----------------
    mb = MeshBuilder()
    _hedge_core(mb, wall, HEDGE_PROFILE_FAR, rng, 1, 0.82, 0.0)
    for i in range(3):
        x = -0.66 + 0.66 * i + rng.uniform(-0.1, 0.1)
        y = rng.uniform(-0.12, 0.12)
        sprig(mb, Vector((x, y, H * 0.86)), Vector((rng.uniform(-0.25, 0.25), (1 if i % 2 else -1) * rng.uniform(0.7, 1.0), 1.0)), 0.6, 1.0)
    for side in (-1.0, 1.0):
        for x in (rng.uniform(-0.75, -0.15), rng.uniform(0.15, 0.75)):
            sprig(mb, side_point(side, x, H * rng.uniform(0.4, 0.65), 0.16), Vector((rng.uniform(-0.3, 0.3), side * 1.0, 0.5)), 0.6, 0.78)
    far = mb.to_object(f'{key}_FAR', mat, col)

    # ---------------- LOD0 ----------------
    mb = MeshBuilder()
    _hedge_core(mb, wall, HEDGE_PROFILE, rng, 2, 0.72, 0.035)
    tiers = ((0.16, 0.3, 0.6, 0.25), (0.34, 0.5, 0.72, 0.35), (0.54, 0.7, 0.85, 0.45), (0.72, 0.86, 0.97, 0.6))
    for side in (-1.0, 1.0):
        # flank sprigs in four tiers, rooted 0.1-0.17 m inside the core and standing out of it: leafy, uneven flanks
        for z_lo, z_hi, shade, lean_up in tiers:
            for ix in range(6):
                x = -0.92 + 0.37 * ix + rng.uniform(-0.13, 0.13)
                z = H * rng.uniform(z_lo, z_hi)
                d = Vector((rng.uniform(-0.5, 0.5), side * 1.0, lean_up + rng.uniform(-0.15, 0.2)))
                sprig(mb, side_point(side, x, z, rng.uniform(0.1, 0.17)), d, rng.uniform(0.38, 0.52), shade)
        # skirt: dark sprigs drooping out at the foot - no hard line where the hedge meets the ground
        for ix in range(4):
            x = -0.8 + 0.53 * ix + rng.uniform(-0.12, 0.12)
            sprig(mb, side_point(side, x, 0.2, 0.12), Vector((rng.uniform(-0.3, 0.3), side * 1.0, -0.15)), rng.uniform(0.34, 0.44), 0.48)
        # a few long stray shoots - the slightly overgrown look of a hedge some weeks after clipping
        for _ in range(2):
            x = rng.uniform(-0.85, 0.85)
            z = H * rng.uniform(0.45, 0.85)
            sprig(mb, side_point(side, x, z, 0.08), Vector((rng.uniform(-0.4, 0.4), side * 1.0, rng.uniform(0.4, 0.9))), rng.uniform(0.5, 0.62), 0.92)
    # crown: sprigs rooted under the rounded top fanning OUT over it (not up - an upright row reads as a picket fence)
    for ix in range(9):
        x = -0.92 + 0.23 * ix + rng.uniform(-0.08, 0.08)
        y = rng.uniform(-0.24, 0.24)
        lean = 1 if y >= 0 else -1
        sprig(mb, Vector((x, y * 0.5, H * 0.9)), Vector((rng.uniform(-0.45, 0.45), lean * rng.uniform(0.7, 1.3), 1.0)), rng.uniform(0.36, 0.48), 1.0)
    for _ in range(3):
        x = rng.uniform(-0.8, 0.8)
        sprig(mb, Vector((x, rng.uniform(-0.1, 0.1), H * 0.93)), Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.5, 0.5), 1.0)), rng.uniform(0.32, 0.42), 1.0)
    # cut ends of a run: sprigs pointing out along X cover the end cap (inside a run they vanish in the neighbour)
    for sx in (-1.0, 1.0):
        for z in (0.25, 0.55, 0.82):
            sprig(mb, Vector((sx * 0.86, rng.uniform(-0.15, 0.15), H * z)), Vector((sx * 1.0, rng.uniform(-0.5, 0.5), 0.4)), 0.44, 0.8,
                  along=Vector((0.0, 1.0, 0.0)))
        # corner sprigs pointing diagonally out: the vertical corner of a run end is no hard cuboid edge (inside a
        # run they become a leafy tuft at the joint)
        for side in (-1.0, 1.0):
            for z in (0.3, 0.62, 0.88):
                zz = H * z + rng.uniform(-0.08, 0.08)
                sprig(mb, side_point(side, sx * 0.9, zz, 0.14), Vector((sx * 0.85, side * 0.85, 0.35)), rng.uniform(0.38, 0.48), 0.6 + 0.4 * z,
                      along=Vector((0.0, 0.0, 1.0)))
    lod0 = mb.to_object(f'{key}_LOD0', mat, col)
    lod0['unitM'] = [2.0, 1.0, HEDGE_H]
    lod0['lodDist'] = [48.0]
    return {'LOD0': [lod0], 'FAR': [far]}


# ---------------------------------------------------------------------------------------------------------
# Shrubs (unit: radius 1 m, height 1.75 m)
# ---------------------------------------------------------------------------------------------------------

def build_shrub(col, mat, atlas: AtlasInfo, key: str, tile: str, seed: int):
    rect = atlas.rect(tile)
    rng = random.Random(seed)
    c = Vector((0, 0, 0.85))
    rad = Vector((1.0, 1.0, 0.9))

    def nfn(p, cn):
        q = p - Vector((0, 0, 0.45))
        sph = Vector((q.x / rad.x, q.y / rad.y, q.z / rad.z))
        sph = sph.normalized() if sph.length > 1e-4 else UP.copy()
        cc = cn if cn.dot(sph) >= 0 else -cn
        return sph * 0.75 + cc * 0.25

    def tint_at(p):
        ao = 0.6 + 0.4 * min(1.0, max(0.0, p.z / 1.3))
        return (ao * rng.uniform(0.92, 1.06), ao * rng.uniform(0.95, 1.05), ao * rng.uniform(0.88, 1.02))

    mb = MeshBuilder()
    for k in range(3):
        a = k * math.pi / 3 + rng.uniform(-0.2, 0.2)
        mb.grid_card(c, Vector((math.cos(a), math.sin(a), 0)), UP, Vector((0, 0, 0)), 1.9, 1.7, rect, nfn, color=(0.55, 0.57, 0.52), rows=1, anchor_bottom=False,
                     translucency=0.3)
    for _ in range(30):
        u = rand_unit(rng)
        if u.z < -0.3:
            u.z = -u.z * 0.5
            u.normalize()
        s = rng.uniform(0.72, 0.96)
        p = c + Vector((u.x * rad.x * s, u.y * rad.y * s, u.z * rad.z * s))
        outward = Vector((u.x, u.y, u.z * 1.1)).normalized()
        up = (UP * 0.7 + outward * 0.6 + rand_unit(rng) * 0.25).normalized()
        right = up.cross(outward)
        if right.length < 0.1:
            right = Vector((1, 0, 0))
        right.normalize()
        size = rng.uniform(0.75, 1.05)
        mb.grid_card(p, right, up, outward * 0.06, size, size, rect, nfn, color=tint_at(p), rows=1, anchor_bottom=False, flip_u=rng.random() < 0.5)
    lod0 = mb.to_object(f'{key}_LOD0', mat, col)
    lod0['unitM'] = [1.0, 1.75]
    lod0['lodDist'] = [38.0]

    mb = MeshBuilder()
    for k in range(2):
        a = k * math.pi / 2 + 0.4
        mb.grid_card(c, Vector((math.cos(a), math.sin(a), 0)), UP, Vector((0, 0, 0)), 2.1, 1.8, rect, nfn, color=(0.86, 0.88, 0.84), rows=1, anchor_bottom=False)
    # two tilted caps instead of one flat lid: the bush keeps a dome when seen from the drone
    for tilt in (-0.55, 0.55):
        mb.grid_card(Vector((0, 0, 1.05)), Vector((1, 0, 0)), Vector((0, 1, tilt)).normalized(), Vector((0, 0, 0)), 1.9, 1.9, rect, nfn, color=(1, 1, 1), rows=1,
                     anchor_bottom=False)
    far = mb.to_object(f'{key}_FAR', mat, col)
    return {'LOD0': [lod0], 'FAR': [far]}


# ---------------------------------------------------------------------------------------------------------
# Conifers
# ---------------------------------------------------------------------------------------------------------

def sub_half(rect):
    """Left half of a bough tile: the sprays of one side, used for cards that hang below a bough."""
    u0, v0, u1, v1 = rect
    return (u0, v0, (u0 + u1) * 0.5, v1)


def build_spruce(col, mat, atlas: AtlasInfo, key='conifer_spruce'):
    r_branch, r_tree, r_bark = atlas.rect('spruce_branch'), atlas.rect('spruce_tree'), atlas.rect('bark', 3)
    H, R = 10.0, 2.3

    def radius_at(z: float) -> float:
        t = min(1.0, max(0.0, (z - 0.8) / (H - 0.8)))
        return R * (1.0 - t) ** 0.85 + 0.2

    def nfn(p, cn):
        radial = Vector((p.x, p.y, 0))
        radial = radial.normalized() if radial.length > 1e-3 else Vector((1, 0, 0))
        return radial * 0.6 + UP * 0.75

    def tiers(mb, rng, count, per_tier, rows, shade_boost=0.0, skirts=True):
        """Whorls of drooping boughs. Every bough is a flat card plus (near LOD) a hanging 'skirt' card in the
        vertical plane through it, so the tree reads as layered branches from eye level and from the drone."""
        for k in range(count):
            t = k / (count - 1)
            z = 1.0 + (H - 1.8) * t
            n = max(3, int(round(per_tier * (1.0 - 0.45 * t))))
            a0 = rng.uniform(0, math.tau)
            for j in range(n):
                a = a0 + j * math.tau / n + rng.uniform(-0.25, 0.25)
                out = Vector((math.cos(a), math.sin(a), 0))
                droop = -0.75 + 0.55 * t + rng.uniform(-0.1, 0.1)
                along = (out + UP * droop).normalized()
                right = UP.cross(out).normalized()
                ln = radius_at(z) * rng.uniform(1.0, 1.3) / max(0.6, along.dot(out))
                ao = 0.62 + 0.38 * t + shade_boost
                tint = (ao * rng.uniform(0.92, 1.05), ao, ao * rng.uniform(0.92, 1.05))
                base = Vector((0, 0, z + rng.uniform(-0.15, 0.15)))
                mb.grid_card(base, right, along, -UP * (0.12 * ln), ln * 0.9, ln, r_branch, nfn, color=tint, rows=rows, flip_u=rng.random() < 0.5, cup=-0.05)
                if skirts and j % 2 == 0:
                    w = ln * 0.55
                    down = (along.cross(right)).normalized()
                    if down.z > 0:
                        down = -down
                    mb.grid_card(base + down * (w * 0.42), down, along, Vector((0, 0, 0)), w, ln, sub_half(r_branch), nfn,
                                 color=(tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85), rows=1, flip_u=rng.random() < 0.5)

    def cross(mb, count, shade):
        for k in range(count):
            a = k * math.pi / count + 0.3
            mb.grid_card(Vector((0, 0, H * 0.5 + 0.15)), Vector((math.cos(a), math.sin(a), 0)), UP, Vector((0, 0, 0)), R * 2.05, H - 0.3, r_tree, nfn,
                         color=(shade, shade, shade), rows=1, anchor_bottom=False, translucency=0.4)

    out = {}
    rng = random.Random(31)
    mb = MeshBuilder()
    mb.tube([Vector((0, 0, -0.3)), Vector((0.03, 0, 3.0)), Vector((0, 0.03, 7.0)), Vector((0, 0, H - 0.6))], [0.2, 0.15, 0.08, 0.025], 5, r_bark)
    cross(mb, 4, 0.72)
    tiers(mb, rng, 13, 7, 2)
    lod0 = mb.to_object(f'{key}_LOD0', mat, col)
    lod0['unitM'] = [R, H]
    lod0['lodDist'] = [55.0, 170.0]
    out['LOD0'] = [lod0]
    rng = random.Random(32)
    mb = MeshBuilder()
    cross(mb, 4, 0.78)
    tiers(mb, rng, 7, 5, 1, 0.05, skirts=False)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]
    rng = random.Random(33)
    mb = MeshBuilder()
    cross(mb, 3, 0.86)
    for z, ln in ((2.0, 2.5), (4.6, 1.9), (7.0, 1.2)):
        for j in range(4):
            a = j * math.pi / 2 + z
            outv = Vector((math.cos(a), math.sin(a), 0))
            mb.grid_card(Vector((0, 0, z)), UP.cross(outv).normalized(), (outv - UP * 0.25).normalized(), Vector((0, 0, 0)), ln * 1.25, ln, r_branch, nfn,
                         color=(0.92, 0.94, 0.92), rows=1)
    out['FAR'] = [mb.to_object(f'{key}_FAR', mat, col)]
    return out


def build_thuja(col, mat, atlas: AtlasInfo, key='conifer_thuja'):
    r_col, r_tuft = atlas.rect('thuja_column', 3), atlas.rect('tuft_thuja')
    H, R = 5.0, 0.8
    prof = [(0.0, 0.62), (0.5, 0.95), (1.6, 1.0), (3.0, 0.82), (4.2, 0.45), (5.0, 0.06)]

    def column(mb, sides):
        rings = []
        for z, rf in prof:
            ring = []
            for s in range(sides + 1):
                a = (s % sides) / sides * math.tau
                d = Vector((math.cos(a), math.sin(a), 0))
                ao = 0.66 + 0.34 * (z / H)
                u = r_col[0] + (r_col[2] - r_col[0]) * ((s / sides * 2.0) % 1.0 if s < sides else 1.0)
                # two repeats around: mirror the second half so the seam matches
                frac = s / sides * 2.0
                u = r_col[0] + (r_col[2] - r_col[0]) * (frac if frac <= 1.0 else 2.0 - frac)
                ring.append(mb.vert(d * (R * rf), d * 0.8 + UP * 0.45, (u, r_col[1] + (r_col[3] - r_col[1]) * (z / H)), (0.15 * z / H, 0.7), (ao, ao, ao)))
            rings.append(ring)
            ring_z = z
            for vi in ring:
                x, y, _ = mb.verts[vi]
                mb.verts[vi] = (x, y, ring_z)
        for i in range(len(rings) - 1):
            for s in range(sides):
                mb.face(rings[i][s], rings[i][s + 1], rings[i + 1][s + 1], rings[i + 1][s])

    rng = random.Random(41)
    mb = MeshBuilder()
    column(mb, 8)
    for _ in range(34):
        z = rng.uniform(0.3, 4.5)
        a = rng.uniform(0, math.tau)
        rf = 0.0
        for (z0, f0), (z1, f1) in zip(prof, prof[1:]):
            if z0 <= z <= z1:
                rf = f0 + (f1 - f0) * (z - z0) / (z1 - z0)
        out = Vector((math.cos(a), math.sin(a), 0))
        up = (UP + out * 0.35).normalized()
        ao = 0.72 + 0.28 * (z / H)
        mb.grid_card(out * (R * rf * 0.9) + UP * z, UP.cross(out).normalized(), up, out * 0.04, 0.6, 0.62, r_tuft, lambda p, c, o=out: o * 0.7 + UP * 0.6,
                     color=(ao * rng.uniform(0.92, 1.05), ao, ao * rng.uniform(0.9, 1.04)), rows=1, flip_u=rng.random() < 0.5)
    lod0 = mb.to_object(f'{key}_LOD0', mat, col)
    lod0['unitM'] = [R, H]
    lod0['lodDist'] = [45.0]
    mb = MeshBuilder()
    column(mb, 6)
    return {'LOD0': [lod0], 'FAR': [mb.to_object(f'{key}_FAR', mat, col)]}


def build_pine(col, mat, atlas: AtlasInfo, key='conifer_pine'):
    r_tuft, r_bark = atlas.rect('pine_tuft'), atlas.rect('bark', 3)
    H, R = 12.0, 3.2
    c = Vector((0.2, 0.1, 9.4))
    rad = Vector((R, R, 2.3))

    def nfn(p, cn):
        q = p - (c - Vector((0, 0, 1.2)))
        sph = Vector((q.x / rad.x, q.y / rad.y, q.z / rad.z))
        sph = sph.normalized() if sph.length > 1e-4 else UP.copy()
        cc = cn if cn.dot(sph) >= 0 else -cn
        return sph * 0.75 + cc * 0.25

    def wood(mb, rng, sides, branch_sides, branches):
        trunk = [Vector((0, 0, -0.4)), Vector((0.12, 0.05, 3.0)), Vector((0.05, 0.16, 6.2)), Vector((0.2, 0.1, 9.0)), Vector((0.2, 0.1, 10.6))]
        mb.tube(trunk, [0.27, 0.21, 0.17, 0.11, 0.03], sides, r_bark)
        ends = []
        for k in range(branches):
            a = k * math.tau / branches + rng.uniform(-0.3, 0.3)
            z0 = rng.uniform(6.4, 9.2)
            start = Vector((0.12, 0.1, z0))
            out = Vector((math.cos(a), math.sin(a), 0))
            ln = rng.uniform(1.8, 2.9)
            mid = start + out * (ln * 0.55) + UP * rng.uniform(0.3, 0.8)
            end = start + out * ln + UP * rng.uniform(0.9, 1.9)
            mb.tube([start, mid, end], [0.07, 0.05, 0.02], branch_sides, r_bark)
            ends += [mid, end]
        return ends

    def tufts(mb, rng, spots, size, rows):
        for p in spots:
            outward = (p - c)
            outward = Vector((outward.x / rad.x, outward.y / rad.y, outward.z / rad.z))
            outward = outward.normalized() if outward.length > 1e-3 else UP.copy()
            up = (outward * 0.6 + UP * 0.6 + rand_unit(rng) * 0.4).normalized()
            right = up.cross(rand_unit(rng))
            if right.length < 0.1:
                right = up.orthogonal()
            right.normalize()
            d = math.sqrt(((p.x - c.x) / rad.x) ** 2 + ((p.y - c.y) / rad.y) ** 2 + ((p.z - c.z) / rad.z) ** 2)
            ao = 0.55 + 0.45 * min(1.0, d)
            s = size * rng.uniform(0.8, 1.2)
            mb.grid_card(p - up * (s * 0.3), right, up, outward * 0.05, s, s, r_tuft, nfn, color=(ao * rng.uniform(0.92, 1.05), ao, ao * rng.uniform(0.9, 1.04)), rows=rows,
                         flip_u=rng.random() < 0.5)

    def shell(rng, n, lo, hi):
        pts = []
        while len(pts) < n:
            u = rand_unit(rng)
            if u.z < -0.25:
                continue
            s = rng.uniform(lo, hi)
            pts.append(c + Vector((u.x * rad.x * s, u.y * rad.y * s, u.z * rad.z * s)))
        return pts

    out = {}
    rng = random.Random(51)
    mb = MeshBuilder()
    ends = wood(mb, rng, 7, 4, 7)
    tufts(mb, rng, ends + shell(rng, 190, 0.4, 1.0), 1.7, 2)
    lod0 = mb.to_object(f'{key}_LOD0', mat, col)
    lod0['unitM'] = [R, H]
    lod0['lodDist'] = [55.0, 170.0]
    out['LOD0'] = [lod0]
    rng = random.Random(52)
    mb = MeshBuilder()
    wood(mb, rng, 5, 3, 4)
    tufts(mb, rng, shell(rng, 60, 0.4, 0.95), 2.6, 1)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]
    rng = random.Random(53)
    mb = MeshBuilder()
    mb.tube([Vector((0, 0, -0.3)), Vector((0.1, 0.1, 6.0)), Vector((0.2, 0.1, 10.0))], [0.27, 0.17, 0.05], 4, r_bark)
    tufts(mb, rng, shell(rng, 16, 0.2, 0.7), 4.6, 1)
    out['FAR'] = [mb.to_object(f'{key}_FAR', mat, col)]
    return out


# ---------------------------------------------------------------------------------------------------------
# Ground cover
# ---------------------------------------------------------------------------------------------------------

def build_groundcover(col, mat, atlas: AtlasInfo, key: str, tiles: list[str], width: float, height: float, seed: int, cards: int = 3, spread: float = 0.12):
    rng = random.Random(seed)
    mb = MeshBuilder()
    for k in range(cards):
        a = k * math.pi / cards + rng.uniform(-0.25, 0.25)
        right = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-right.y, right.x, 0))
        base = Vector((rng.uniform(-spread, spread), rng.uniform(-spread, spread), -0.03))
        n = side * (0.3 if rng.random() < 0.5 else -0.3) + UP * 0.95
        rect = atlas.rect(tiles[k % len(tiles)])
        u0, v0, u1, v1 = rect
        if rng.random() < 0.5:
            u0, u1 = u1, u0
        lean = side * (rng.uniform(-0.18, 0.18) * height)
        w = width * rng.uniform(0.85, 1.1)
        h = height * rng.uniform(0.85, 1.1)
        pts = [base - right * (w / 2), base + right * (w / 2), base + right * (w / 2) + UP * h + lean, base - right * (w / 2) + UP * h + lean]
        _quad_c(mb, pts, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [n] * 4, [(0.0, 0.7)] * 2 + [(1.0, 0.7)] * 2, [(0.72, 0.74, 0.7)] * 2 + [(1.0, 1.0, 1.0)] * 2)
    obj = mb.to_object(key, mat, col)
    obj['unitM'] = [float(width), float(height)]
    return [obj]


# ---------------------------------------------------------------------------------------------------------

def merge_props(entries: dict) -> None:
    """Adds / replaces only the given prop keys in props_meta.json (both copies) and the village manifest."""
    for path in META_FILES:
        with open(path, 'r', encoding='utf-8') as fh:
            meta = json.load(fh)
        meta.update(entries)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(meta, fh, indent=2)
    with open(MANIFEST, 'r', encoding='utf-8') as fh:
        manifest = json.load(fh)
    manifest.setdefault('props', {}).update(entries)
    tmp = MANIFEST + '.garden.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2)
    os.replace(tmp, MANIFEST)


def main() -> None:
    clear_scene()
    scene_col = bpy.context.scene.collection
    col = bpy.data.collections.new('Garden')
    scene_col.children.link(col)
    atlas = AtlasInfo(os.path.join(TEX_DIR, 'veg_garden_atlas.json'))
    mat = atlas.material('Veg_Garden', roughness=0.72)
    assets: dict[str, dict] = {}
    for i, kind in enumerate(('thuja', 'laurel', 'privet', 'hornbeam')):
        assets[f'hedge_{kind}'] = build_hedge(col, mat, atlas, f'hedge_{kind}', f'wall_{kind}', f'tuft_{kind}', 60 + i)
    for i, kind in enumerate(('round', 'pink', 'white', 'fine')):
        assets[f'shrub_{kind}'] = build_shrub(col, mat, atlas, f'shrub_{kind}', f'shrub_{kind}', 70 + i)
    assets['conifer_spruce'] = build_spruce(col, mat, atlas)
    assets['conifer_thuja'] = build_thuja(col, mat, atlas)
    assets['conifer_pine'] = build_pine(col, mat, atlas)
    objs = [o for parts in assets.values() for lod in parts.values() for o in lod]
    size = export_glb(objs, os.path.join(GLB_DIR, 'garden.glb'), image_quality=80)
    garden_entry = {
        'glbPath': '/assets/models/village/props/garden.glb',
        'bounds': object_bounds_gltf(assets['conifer_pine']['LOD0']),
        'meshCount': len(objs),
        'approxTriangles': sum(triangle_count(p['LOD0']) for p in assets.values()),
        'fileSizeBytes': size,
        'nodes': {k: {lod: triangle_count(v) for lod, v in parts.items()} for k, parts in assets.items()},
    }
    for k, n in garden_entry['nodes'].items():
        print(f'[garden] {k}: {n}')
    print(f'[garden] garden.glb {size / 1024:.0f} KB')

    col = bpy.data.collections.new('GroundCover')
    scene_col.children.link(col)
    g_atlas = AtlasInfo(os.path.join(TEX_DIR, 'veg_groundcover_atlas.json'))
    g_mat = g_atlas.material('Veg_GroundCover', roughness=0.8)
    gc = {
        'gc_grass': build_groundcover(col, g_mat, g_atlas, 'gc_grass', ['grass_a', 'grass_b', 'grass_a'], 0.6, 0.3, 81),
        'gc_tall': build_groundcover(col, g_mat, g_atlas, 'gc_tall', ['tall_a', 'tall_b', 'tall_a'], 0.75, 0.8, 82),
        'gc_weed': build_groundcover(col, g_mat, g_atlas, 'gc_weed', ['weed', 'grass_b', 'weed'], 0.5, 0.38, 83),
        'gc_flower': build_groundcover(col, g_mat, g_atlas, 'gc_flower', ['flower_a', 'flower_b', 'tall_b'], 0.7, 0.68, 84),
        'gc_reed': build_groundcover(col, g_mat, g_atlas, 'gc_reed', ['reed', 'reed', 'reed', 'reed'], 1.0, 1.9, 85, cards=4, spread=0.3),
    }
    gobjs = [o for v in gc.values() for o in v]
    gsize = export_glb(gobjs, os.path.join(GLB_DIR, 'groundcover.glb'), image_quality=80)
    cover_entry = {
        'glbPath': '/assets/models/village/props/groundcover.glb',
        'bounds': object_bounds_gltf(gc['gc_reed']),
        'meshCount': len(gobjs),
        'approxTriangles': triangle_count(gobjs),
        'fileSizeBytes': gsize,
        'nodes': {k: {'LOD0': triangle_count(v)} for k, v in gc.items()},
    }
    print(f'[garden] groundcover.glb {gsize / 1024:.0f} KB, {cover_entry["nodes"]}')
    merge_props({'garden': garden_entry, 'groundcover': cover_entry})
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PROJECT_ROOT, 'blender/village/props/kindenheim_garden.blend'))
    print('[garden] done')


if __name__ == '__main__':
    main()
