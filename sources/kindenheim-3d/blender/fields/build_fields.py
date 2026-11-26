#!/usr/bin/env python3
"""
Kindenheim agricultural fields builder (Blender 5.2, no rendering). Replaces the per-crop builders of the
first asset pass (wheat/, corn/, sugarbeet/, sunflower/, meadow/, props/ scripts are kept for reference only).

    python3 blender/fields/build_crop_atlases.py                  # once: crop atlases (system python)
    python3 blender/village/props/build_veg_atlases.py hedge straw
    /opt/homebrew/bin/blender --background --python blender/fields/build_fields.py
    python3 blender/fields/assemble_manifest.py                   # validates + writes fields/manifest.json

Every crop tile is one GLB with nodes <key>_LOD0 / _LOD1 / _FAR (see blender/village/props/veg_blender.py):
    FAR   = opaque floor carpet of the tile (+ a few cards / a canopy lid for tall crops) - drawn for the whole map
    LOD1  = row cards, LOD0 = individual plant cards; both are instanced only around the camera by src/fields.ts.
Tile frame: +X along the rows, origin on the ground in the tile centre.
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'village', 'props'))
from veg_blender import (  # noqa: E402
    PROJECT_ROOT,
    AtlasInfo,
    MeshBuilder,
    clear_scene,
    export_glb,
    join_under_empty,
    library_tile_m,
    make_library_material,
    make_straw_material,
    make_texture_material,
    object_bounds_gltf,
    rand_unit,
    triangle_count,
)

FIELD_TEX = os.path.join(PROJECT_ROOT, 'blender/fields/textures')
PROP_TEX = os.path.join(PROJECT_ROOT, 'blender/village/textures/props')
OUT = os.path.join(PROJECT_ROOT, 'public/assets/models/fields')
BLEND_OUT = os.path.join(PROJECT_ROOT, 'blender/fields/kindenheim_fields.blend')
UP = Vector((0, 0, 1))
# crop floors are noisy photo ground: a slightly lower WebP quality keeps the shipped size inside the budget
CROP_WEBP_QUALITY = 66
# Canopy lids tile edge to edge: at the mip levels used from 100 m on, the transparent atlas gutter bleeds into the
# outer texels and every lid edge turned into a pale line - a lattice over the whole field (review finding). Sample
# lids well inside their atlas tile.
LID_INSET_PX = 48


def _quad_c(mb, pts, uvs, normals, datas, colors):
    ids = [mb.vert(pts[i], normals[i], uvs[i], datas[i], colors[i]) for i in range(4)]
    mb.face(*ids)


def floor_carrier(col, key: str, tex_name: str, tile_m, roughness: float = 0.92):
    """<key>_FLOOR: one quad that only carries the seamless ground-carpet material + its tile size (glTF extras).
    src/fields.ts drapes that material over the terrain grid inside each parcel."""
    mat = make_texture_material(f'Floor_{tex_name}', os.path.join(FIELD_TEX, f'{tex_name}_albedo.jpg'), os.path.join(FIELD_TEX, f'{tex_name}_normal.jpg'),
                                roughness=roughness)
    mb = MeshBuilder()
    sx, sy = tile_m
    mb.quad([(-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0), (sx / 2, sy / 2, 0), (-sx / 2, sy / 2, 0)], (0, 0, 1, 1), normals=[UP] * 4)
    obj = mb.to_object(f'{key}_FLOOR', mat, col, with_color=False, with_data=False)
    obj['tileM'] = [float(sx), float(sy)]
    return [obj]


def lid(mb: MeshBuilder, rect, sx: float, sy: float, z: float, shade: float = 1.0, x0: float | None = None, y0: float | None = None) -> None:
    cx = 0.0 if x0 is None else x0
    cy = 0.0 if y0 is None else y0
    u0, v0, u1, v1 = rect
    pts = [(cx - sx / 2, cy - sy / 2, z), (cx + sx / 2, cy - sy / 2, z), (cx + sx / 2, cy + sy / 2, z), (cx - sx / 2, cy + sy / 2, z)]
    _quad_c(mb, pts, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [UP] * 4, [(0.35, 1.0)] * 4, [(shade, shade, shade)] * 4)


def wall(mb: MeshBuilder, a, b, z0: float, z1: float, uv, rng: random.Random, lean: float = 0.06, shade=(0.62, 1.0), tint=(1.0, 1.0, 1.0),
         flutter: float = 1.0) -> None:
    """Upright card from ground point a to b (x, y). Normal is mostly 'up' so a field shades like one surface."""
    ax, ay = a
    bx, by = b
    d = Vector((bx - ax, by - ay, 0))
    side = Vector((-d.y, d.x, 0)).normalized() * (1 if rng.random() < 0.5 else -1)
    n = side * 0.38 + UP * 0.9
    lv = side * (lean * rng.uniform(-1, 1))
    u0, v0, u1, v1 = uv
    if rng.random() < 0.5:
        u0, u1 = u1, u0
    lo = tuple(t * shade[0] for t in tint)
    hi = tuple(t * shade[1] for t in tint)
    pts = [(ax, ay, z0), (bx, by, z0), (bx + lv.x, by + lv.y, z1), (ax + lv.x, ay + lv.y, z1)]
    _quad_c(mb, pts, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [n] * 4, [(0.0, 1.0)] * 2 + [(flutter, 1.0)] * 2, [lo, lo, hi, hi])


def plant_card(mb: MeshBuilder, x: float, y: float, yaw: float, width: float, height: float, uv, rng: random.Random, bend: float = 0.08,
               shade=(0.6, 1.0), tint=(1.0, 1.0, 1.0)) -> None:
    right = Vector((math.cos(yaw), math.sin(yaw), 0))
    side = Vector((-right.y, right.x, 0))
    n_fn = lambda p, cn: (cn if cn.dot(side) >= 0 else -cn) * 0.38 + UP * 0.9  # noqa: E731
    col = tuple(t * (shade[0] + shade[1]) * 0.5 for t in tint)
    mb.grid_card(Vector((x, y, 0)), right, UP, side * (bend * rng.uniform(-1, 1) * height), width, height, uv, n_fn, color=col, rows=2,
                 flip_u=rng.random() < 0.5)


def sub_u(rect, f0: float, f1: float):
    u0, v0, u1, v1 = rect
    return (u0 + (u1 - u0) * f0, v0, u0 + (u1 - u0) * f1, v1)


def sub_v(rect, f0: float, f1: float):
    u0, v0, u1, v1 = rect
    return (u0, v0 + (v1 - v0) * f0, u1, v0 + (v1 - v0) * f1)


# ---------------------------------------------------------------------------------------------------------
# Crops
# ---------------------------------------------------------------------------------------------------------

def _wheat_row(mb: MeshBuilder, y: float, H: float, r_wall, rng: random.Random, seg: float, jitter: float = 0.0) -> None:
    """One drill row across the 6 m tile, cut into `seg` long cards that start at a random offset (no aligned seams)."""
    x = -3.0 - rng.uniform(0, seg)
    while x < 3.0:
        x0, x1 = max(x, -3.0), min(x + seg, 3.0)
        if x1 - x0 > 0.3:
            f0, f1 = (x0 - x) / seg, (x1 - x) / seg
            wall(mb, (x0, y + rng.uniform(-jitter, jitter)), (x1, y + rng.uniform(-jitter, jitter)), 0, H * rng.uniform(0.92, 1.05), sub_u(r_wall, f0, f1), rng,
                 lean=0.1, tint=(rng.uniform(0.94, 1.05), rng.uniform(0.94, 1.03), rng.uniform(0.9, 1.0)))
        x += seg


def _wheat_clumps(mb: MeshBuilder, H: float, r_wall, rng: random.Random, n: int) -> None:
    """Short cards at random places and angles: depth seen along the rows without a regular cross-wall lattice."""
    for _ in range(n):
        cx, cy = rng.uniform(-2.6, 2.6), rng.uniform(-2.6, 2.6)
        a = rng.uniform(0.35, math.pi - 0.35)
        half = rng.uniform(0.3, 0.6)
        dx, dy = math.cos(a) * half, math.sin(a) * half
        uo = rng.uniform(0.0, 0.7)
        wall(mb, (cx - dx, cy - dy), (cx + dx, cy + dy), 0, H * rng.uniform(0.85, 1.0), sub_u(r_wall, uo, uo + 0.3), rng, lean=0.1)


def build_wheat(col, key='crop_wheat_patch'):
    atlas = AtlasInfo(os.path.join(FIELD_TEX, 'crop_wheat_atlas.json'))
    mat = atlas.material('Veg_Wheat', roughness=0.85)
    r_wall, r_lid = atlas.rect('wall', 2), atlas.rect('lid', LID_INSET_PX)
    H = 0.95
    out = {'FLOOR': floor_carrier(col, key, 'crop_wheat_floor', (6.0, 6.0))}

    rng = random.Random(1)
    mb = MeshBuilder()
    # Row segments start at a random offset per row and there are no cross walls on a fixed grid: aligned segment
    # seams and a 2 m cross-wall lattice drew a brick / straw-mat pattern across the field (review finding).
    for k in range(8):
        y = -2.625 + 0.75 * k
        _wheat_row(mb, y, H, r_wall, rng, seg=2.0)
    _wheat_clumps(mb, H, r_wall, rng, 7)
    for i in range(2):
        for j in range(4):
            lid(mb, r_lid, 3, 1.5, 0.74, 0.95, x0=-1.5 + 3 * i, y0=-2.25 + 1.5 * j)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]

    rng = random.Random(2)
    mb = MeshBuilder()
    for k in range(20):
        _wheat_row(mb, -2.85 + 0.3 * k, H, r_wall, rng, seg=2.0, jitter=0.06)
    _wheat_clumps(mb, H, r_wall, rng, 22)
    for i in range(2):
        for j in range(4):
            lid(mb, r_lid, 3, 1.5, 0.70, 0.9, x0=-1.5 + 3 * i, y0=-2.25 + 1.5 * j)
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]
    return out, dict(tileM=[6.0, 6.0], spacingM=6.0, alongRowM=6.0, betweenBaysM=6.0, windSway=0.11, heightM=H, lodDist=[38, 140])


def build_stubble(col, key='crop_stubble_patch'):
    atlas = AtlasInfo(os.path.join(FIELD_TEX, 'crop_stubble_atlas.json'))
    mat = atlas.material('Veg_Stubble', roughness=0.9)
    r_side = atlas.rect('side', 2)
    r_row = sub_v(r_side, 0.0, 0.5)     # lower half: standing stubble row
    r_straw = sub_v(r_side, 0.5, 1.0)   # upper half: loose straw
    out = {'FLOOR': floor_carrier(col, key, 'crop_stubble_floor', (6.0, 6.0))}
    rng = random.Random(3)
    mb = MeshBuilder()
    for k in range(16):
        y = -2.81 + 0.375 * k
        for s in range(3):
            wall(mb, (-3 + 2 * s, y), (-1 + 2 * s, y), 0, 0.2, r_row, rng, lean=0.02, shade=(0.8, 1.0), flutter=0.0)
    for _ in range(7):
        cx, cy = rng.uniform(-2.2, 2.2), rng.uniform(-2.2, 2.2)
        a = rng.uniform(0, math.tau)
        rx = Vector((math.cos(a), math.sin(a), 0)) * 0.9
        ry = Vector((-math.sin(a), math.cos(a), 0)) * 0.45
        c = Vector((cx, cy, 0.035))
        u0, v0, u1, v1 = r_straw
        _quad_c(mb, [c - rx - ry, c + rx - ry, c + rx + ry, c - rx + ry], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [UP] * 4, [(0, 0)] * 4, [(1, 1, 1)] * 4)
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]
    return out, dict(tileM=[6.0, 6.0], spacingM=6.0, alongRowM=6.0, betweenBaysM=6.0, windSway=0.0, heightM=0.2, lodDist=[36])


def build_corn(col, key='crop_corn_row'):
    atlas = AtlasInfo(os.path.join(FIELD_TEX, 'crop_corn_atlas.json'))
    mat = atlas.material('Veg_Maize', roughness=0.75)
    r_wall = atlas.rect('wall', 2)
    r_wall = (0.0, r_wall[1], 1.0, r_wall[3])
    r_lid = atlas.rect('lid', LID_INSET_PX)
    H = 2.5
    rows = (-0.8, 0.0, 0.8)
    out = {'FLOOR': floor_carrier(col, key, 'crop_corn_floor', (6.0, 2.4))}
    rng = random.Random(4)
    mb = MeshBuilder()
    for i in range(2):
        lid(mb, r_lid, 3, 2.4, 2.02, 0.9, x0=-1.5 + 3 * i)
    for y in (-0.8, 0.8):
        uo = rng.random()
        wall(mb, (-3, y), (3, y), 0.3, H, (uo, r_wall[1] + (r_wall[3] - r_wall[1]) * 0.12, uo + 1.0, r_wall[3]), rng, lean=0.0, shade=(0.55, 0.95))
    # middle row as well: with only the outer two the far field was lighter than LOD1 (a tone step at the LOD ring)
    uo = rng.random()
    wall(mb, (-3, 0.0), (3, 0.0), 0.3, H, (uo, r_wall[1] + (r_wall[3] - r_wall[1]) * 0.12, uo + 1.0, r_wall[3]), rng, lean=0.0, shade=(0.5, 0.9))
    # no cross walls in the far mesh: from the air they draw brick joints across the field
    out['FAR'] = [mb.to_object(f'{key}_FAR', mat, col)]

    rng = random.Random(5)
    mb = MeshBuilder()
    for y in rows:
        for dy in (-0.07, 0.07):
            uo = rng.random()
            wall(mb, (-3, y + dy), (3, y + dy), 0, H, (uo, r_wall[1], uo + 1.0, r_wall[3]), rng, lean=0.12, shade=(0.5, 1.0))
    for x in (-2, 0, 2):
        # cross walls stay below the canopy lid (hidden from the air, give depth from the ground)
        uo = rng.random()
        wall(mb, (x, -1.2), (x, 1.2), 0, 1.95, (uo, r_wall[1], uo + 0.4, r_wall[1] + (r_wall[3] - r_wall[1]) * 0.8), rng, lean=0.05, shade=(0.5, 0.9))
    for i in range(2):
        lid(mb, r_lid, 3, 2.4, 2.0, 0.9, x0=-1.5 + 3 * i)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]

    rng = random.Random(6)
    mb = MeshBuilder()
    for y in rows:
        for dy in (-0.05, 0.05):
            uo = rng.random()
            wall(mb, (-3, y + dy), (3, y + dy), 0, H, (uo, r_wall[1], uo + 1.0, r_wall[3]), rng, lean=0.12, shade=(0.5, 1.0))
        for k in range(15):
            x = -2.8 + 0.4 * k + rng.uniform(-0.1, 0.1)
            uo = rng.random()
            yaw = math.radians(rng.choice((1, -1)) * rng.uniform(40, 90))
            plant_card(mb, x, y + rng.uniform(-0.05, 0.05), yaw, 0.95, H * rng.uniform(0.9, 1.02), (uo, r_wall[1], uo + 0.16, r_wall[3]), rng, shade=(0.6, 1.0),
                       tint=(rng.uniform(0.94, 1.04), rng.uniform(0.95, 1.05), rng.uniform(0.9, 1.0)))
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]
    return out, dict(tileM=[6.0, 2.4], alongRowM=6.0, betweenBaysM=2.4, windSway=0.15, heightM=H, lodDist=[34, 150])


def build_beet(col, key='crop_sugarbeet_row'):
    atlas = AtlasInfo(os.path.join(FIELD_TEX, 'crop_beet_atlas.json'))
    mat = atlas.material('Veg_Beet', roughness=0.62)
    clumps = [atlas.rect(f'clump_{i}') for i in range(4)]
    r_ros = atlas.rect('rosette')
    r_side = atlas.rect('row_side', 2)
    rows = (-1.0, -0.5, 0.0, 0.5, 1.0)
    out = {'FLOOR': floor_carrier(col, key, 'crop_beet_floor', (6.0, 2.5), roughness=0.7)}

    rng = random.Random(7)
    mb = MeshBuilder()
    for y in rows:
        for dy in (-0.09, 0.09):
            for s in range(2):
                wall(mb, (-3 + 3 * s, y + dy), (3 * s, y + dy), 0.0, 0.46, r_side, rng, lean=0.12, shade=(0.92, 1.1), flutter=0.5)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]

    rng = random.Random(8)
    mb = MeshBuilder()
    for y in rows:
        for k in range(12):
            x = -2.75 + 0.5 * k + rng.uniform(-0.08, 0.08)
            yy = y + rng.uniform(-0.04, 0.04)
            s = rng.uniform(0.85, 1.15)
            a0 = rng.uniform(0, math.pi)
            tint = (rng.uniform(0.92, 1.05), rng.uniform(0.95, 1.05), rng.uniform(0.9, 1.0))
            for a in (a0, a0 + math.pi / 2):
                d = Vector((math.cos(a), math.sin(a), 0)) * (0.31 * s)
                wall(mb, (x - d.x, yy - d.y), (x + d.x, yy + d.y), -0.02, 0.5 * s, rng.choice(clumps), rng, lean=0.05, shade=(0.6, 1.0), tint=tint, flutter=0.4)
            # leaves seen from above
            c = Vector((x, yy, 0.24 * s))
            tx = Vector((math.cos(a0), math.sin(a0), rng.uniform(-0.15, 0.15))) * (0.3 * s)
            ty = Vector((-math.sin(a0), math.cos(a0), rng.uniform(-0.15, 0.15))) * (0.3 * s)
            u0, v0, u1, v1 = r_ros
            _quad_c(mb, [c - tx - ty, c + tx - ty, c + tx + ty, c - tx + ty], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [UP] * 4, [(0.3, 1.0)] * 4,
                    [tint] * 4)
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]
    return out, dict(tileM=[6.0, 2.5], alongRowM=6.0, betweenBaysM=2.5, windSway=0.03, heightM=0.5, lodDist=[30, 110])


def build_sunflower(col, key='crop_sunflower_patch'):
    atlas = AtlasInfo(os.path.join(FIELD_TEX, 'crop_sunflower_atlas.json'))
    mat = atlas.material('Veg_Sunflower', roughness=0.7)
    r_lid = atlas.rect('lid', LID_INSET_PX)
    r_wall = atlas.rect('wall', 2)
    r_wall = (0.0, r_wall[1], 1.0, r_wall[3])
    H = 1.95
    rows = [-2.625 + 0.75 * k for k in range(8)]
    out = {'FLOOR': floor_carrier(col, key, 'crop_sunflower_floor', (6.0, 6.0))}
    rng = random.Random(9)
    mb = MeshBuilder()
    lid(mb, r_lid, 6, 6, 1.5, 0.95)
    for y in (-1.875, 1.125):
        uo = rng.random()
        wall(mb, (-3, y), (3, y), 0.25, H, (uo, r_wall[1] + (r_wall[3] - r_wall[1]) * 0.13, uo + 1.0, r_wall[3]), rng, lean=0.0, shade=(0.6, 1.0))
    out['FAR'] = [mb.to_object(f'{key}_FAR', mat, col)]

    rng = random.Random(10)
    mb = MeshBuilder()
    for y in rows:
        uo = rng.random()
        wall(mb, (-3, y), (3, y), 0, H, (uo, r_wall[1], uo + 1.0, r_wall[3]), rng, lean=0.1, shade=(0.55, 1.0))
    for x in (-2, 0, 2):
        uo = rng.random()
        wall(mb, (x, -3), (x, 3), 0, 1.42, (uo, r_wall[1], uo + 1.0, r_wall[1] + (r_wall[3] - r_wall[1]) * 0.74), rng, lean=0.05, shade=(0.55, 0.9))
    lid(mb, r_lid, 6, 6, 1.45, 0.9)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]

    rng = random.Random(11)
    mb = MeshBuilder()
    for y in rows:
        uo = rng.random()
        wall(mb, (-3, y), (3, y), 0, H, (uo, r_wall[1], uo + 1.0, r_wall[3]), rng, lean=0.08, shade=(0.55, 1.0))
        for k in range(10):
            x = -2.7 + 0.6 * k + rng.uniform(-0.12, 0.12)
            uo = rng.random()
            yaw = math.radians(rng.choice((1, -1)) * rng.uniform(35, 90))
            plant_card(mb, x, y + rng.uniform(-0.06, 0.06), yaw, 0.8, H * rng.uniform(0.88, 1.02), (uo, r_wall[1], uo + 0.133, r_wall[3]), rng, shade=(0.62, 1.0),
                       tint=(rng.uniform(0.95, 1.04), rng.uniform(0.95, 1.04), rng.uniform(0.92, 1.0)))
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]
    return out, dict(tileM=[6.0, 6.0], spacingM=6.0, alongRowM=6.0, betweenBaysM=6.0, windSway=0.1, heightM=H, lodDist=[36, 150])


def build_meadow(col, mat, atlas: AtlasInfo, key='meadow_grass_patch'):
    r_wall = atlas.rect('wall', 2)
    tufts = [atlas.rect(f'tuft_{i}') for i in range(3)]
    H = 0.62
    out = {'FLOOR': floor_carrier(col, key, 'crop_meadow_floor', (6.0, 6.0))}
    rng = random.Random(12)
    mb = MeshBuilder()
    for k in range(6):
        y = -2.5 + k + rng.uniform(-0.2, 0.2)
        for s in range(2):
            wall(mb, (-3 + 3 * s, y + rng.uniform(-0.3, 0.3)), (3 * s, y + rng.uniform(-0.3, 0.3)), 0, H * rng.uniform(0.8, 1.0), r_wall, rng, lean=0.15, shade=(0.6, 1.0))
    for x in (-1.5, 1.5):
        for s in range(2):
            wall(mb, (x, -3 + 3 * s), (x, 3 * s), 0, H * 0.9, r_wall, rng, lean=0.15, shade=(0.6, 1.0))
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]
    rng = random.Random(13)
    mb = MeshBuilder()
    for k in range(17):
        y = -2.8 + 0.35 * k
        a = rng.uniform(-0.25, 0.25)
        for s in range(2):
            x0 = -3 + 3 * s
            wall(mb, (x0, y + math.sin(a) * (x0)), (x0 + 3, y + math.sin(a) * (x0 + 3)), 0, H * rng.uniform(0.7, 1.0), r_wall, rng, lean=0.18, shade=(0.6, 1.0),
                 tint=(rng.uniform(0.92, 1.06), rng.uniform(0.95, 1.05), rng.uniform(0.85, 1.0)))
    for _ in range(95):
        x, y = rng.uniform(-2.8, 2.8), rng.uniform(-2.8, 2.8)
        s = rng.uniform(0.85, 1.3)
        plant_card(mb, x, y, rng.uniform(0, math.pi), 0.62 * s, 0.7 * s, rng.choice(tufts), rng, bend=0.12, shade=(0.8, 1.0),
                   tint=(rng.uniform(0.92, 1.08), rng.uniform(0.95, 1.05), rng.uniform(0.85, 1.0)))
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]
    return out, dict(tileM=[6.0, 6.0], spacingM=6.0, alongRowM=6.0, betweenBaysM=6.0, windSway=0.09, heightM=H, lodDist=[34, 110])


def build_wildflower(col, mat, atlas: AtlasInfo, key='wildflower_strip'):
    r_wall = atlas.rect('flower_wall', 2)
    r_wall = (0.0, r_wall[1], 1.0, r_wall[3])
    r_lid = atlas.rect('flower_lid', LID_INSET_PX)
    tufts = [atlas.rect(f'tuft_{i}') for i in range(3)]
    H = 0.95
    out = {}
    rng = random.Random(14)
    mb = MeshBuilder()
    for y in (-0.35, 0.35):
        uo = rng.random()
        wall(mb, (-2.5, y), (2.5, y), 0, H, (uo, r_wall[1], uo + 1.67, r_wall[3]), rng, lean=0.12, shade=(0.6, 1.0))
    lid(mb, r_lid, 5.0, 1.5, 0.5, 0.95)
    out['FAR'] = [mb.to_object(f'{key}_FAR', mat, col)]
    rng = random.Random(15)
    mb = MeshBuilder()
    for y in (-0.55, -0.18, 0.18, 0.55):
        uo = rng.random()
        wall(mb, (-2.5, y), (2.5, y), 0, H * rng.uniform(0.85, 1.0), (uo, r_wall[1], uo + 1.67, r_wall[3]), rng, lean=0.16, shade=(0.6, 1.0))
    lid(mb, r_lid, 5.0, 1.5, 0.45, 0.9)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]
    rng = random.Random(16)
    mb = MeshBuilder()
    for y in (-0.6, -0.36, -0.12, 0.12, 0.36, 0.6):
        uo = rng.random()
        wall(mb, (-2.5, y + rng.uniform(-0.08, 0.08)), (2.5, y + rng.uniform(-0.08, 0.08)), 0, H * rng.uniform(0.8, 1.05), (uo, r_wall[1], uo + 1.67, r_wall[3]), rng,
             lean=0.18, shade=(0.6, 1.0))
    for k in range(5):
        x = -2.0 + k
        uo = rng.random()
        wall(mb, (x, -0.75), (x, 0.75), 0, H, (uo, r_wall[1], uo + 0.5, r_wall[3]), rng, lean=0.15, shade=(0.6, 1.0))
    for _ in range(14):
        s = rng.uniform(0.8, 1.2)
        plant_card(mb, rng.uniform(-2.4, 2.4), rng.uniform(-0.7, 0.7), rng.uniform(0, math.pi), 0.55 * s, 0.8 * s, rng.choice(tufts), rng, bend=0.12, shade=(0.7, 1.0))
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]
    return out, dict(tileM=[5.0, 1.6], alongRowM=5.0, betweenBaysM=1.6, windSway=0.1, heightM=H, lodDist=[36, 120])


# ---------------------------------------------------------------------------------------------------------
# Hedgerow, rose post
# ---------------------------------------------------------------------------------------------------------

def build_hedgerow(col, mat, atlas: AtlasInfo, key='hedgerow_bay'):
    twigs = [atlas.rect('hedge_twigs_0'), atlas.rect('hedge_twigs_1')]
    r_branch, r_crown, r_bark = atlas.rect('hedge_branch'), atlas.rect('hedge_crown'), atlas.rect('bark', 3)
    c = Vector((0, 0, 1.2))
    rad = Vector((2.75, 0.85, 1.3))

    def nfn(p, cn):
        q = p - Vector((0, 0, 0.7))
        sph = Vector((q.x / (rad.x * 2.5), q.y / rad.y, q.z / rad.z)).normalized()
        cc = cn if cn.dot(sph) >= 0 else -cn
        return sph * 0.7 + cc * 0.3

    def shell(rng, lo=0.75, hi=1.0):
        while True:
            u = rand_unit(rng)
            if u.z < -0.35:
                continue
            s = rng.uniform(lo, hi)
            p = c + Vector((u.x * rad.x * s, u.y * rad.y * s, u.z * rad.z * s))
            if abs(p.x) > 2.45:
                p.x = rng.uniform(-2.45, 2.45)
            return p, Vector((u.x / rad.x, u.y / rad.y, u.z / rad.z)).normalized()

    def tint_at(p, rng):
        ao = 0.6 + 0.4 * min(1.0, max(0.0, (p.z - 0.2) / 1.6))
        return (ao * rng.uniform(0.9, 1.05), ao * rng.uniform(0.95, 1.05), ao * rng.uniform(0.85, 1.0))

    out = {}
    rng = random.Random(17)
    mb = MeshBuilder()
    for x in (-2.2, -1.3, -0.4, 0.5, 1.4, 2.2):
        px = x + rng.uniform(-0.2, 0.2)
        mb.tube([Vector((px, rng.uniform(-0.2, 0.2), -0.2)), Vector((px + rng.uniform(-0.2, 0.2), rng.uniform(-0.25, 0.25), 0.7)),
                 Vector((px + rng.uniform(-0.4, 0.4), rng.uniform(-0.3, 0.3), 1.5))], [0.05, 0.035, 0.015], 4, r_bark)
    for _ in range(70):
        p, outward = shell(rng)
        up = (UP * 0.7 + outward * 0.6 + rand_unit(rng) * 0.3).normalized()
        right = up.cross(rand_unit(rng)).normalized()
        s = rng.uniform(1.0, 1.45)
        mb.grid_card(p - up * (s * 0.4), right, up, outward * 0.1, s, s, rng.choice(twigs + [r_branch]), nfn, color=tint_at(p, rng), rows=2,
                     flip_u=rng.random() < 0.5, cup=0.05)
    for x in (-1.9, -0.6, 0.7, 1.9):
        right = Vector((1, rng.uniform(-0.3, 0.3), 0)).normalized()
        mb.grid_card(Vector((x, 0, 1.15)), right, UP, Vector((0, 0, 0)), 2.3, 2.2, r_crown, nfn, color=(0.5, 0.52, 0.48), rows=1, anchor_bottom=False, translucency=0.3)
    out['LOD0'] = [mb.to_object(f'{key}_LOD0', mat, col)]

    rng = random.Random(18)
    mb = MeshBuilder()
    for _ in range(18):
        p, outward = shell(rng, 0.6, 0.9)
        up = (UP * 0.8 + outward * 0.5).normalized()
        right = up.cross(rand_unit(rng)).normalized()
        s = rng.uniform(1.6, 2.0)
        mb.grid_card(p - up * (s * 0.45), right, up, Vector((0, 0, 0)), s, s, rng.choice(twigs), nfn, color=tint_at(p, rng), rows=1, flip_u=rng.random() < 0.5)
    for x in (-1.3, 1.3):
        mb.grid_card(Vector((x, 0, 1.15)), Vector((1, 0, 0)), UP, Vector((0, 0, 0)), 2.6, 2.3, r_crown, nfn, color=(0.55, 0.57, 0.52), rows=1, anchor_bottom=False)
    out['LOD1'] = [mb.to_object(f'{key}_LOD1', mat, col)]

    rng = random.Random(19)
    mb = MeshBuilder()
    for side in (-1.0, 1.0):
        for s in range(2):
            x0 = -2.5 + 2.5 * s
            n_lo = Vector((0, side * 0.9, 0.3))
            n_hi = Vector((0, side * 0.5, 0.85))
            u0, v0, u1, v1 = twigs[(s + (side > 0)) % 2]
            pts = [(x0, side * 0.7, 0.0), (x0 + 2.5, side * 0.7, 0.0), (x0 + 2.5, side * 0.35, 2.35), (x0, side * 0.35, 2.35)]
            _quad_c(mb, pts, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [n_lo, n_lo, n_hi, n_hi], [(0, 1)] * 2 + [(0.5, 1)] * 2,
                    [(0.62, 0.64, 0.6)] * 2 + [(1, 1, 1)] * 2)
    for s in range(2):
        u0, v0, u1, v1 = r_crown
        x0 = -2.5 + 2.5 * s
        _quad_c(mb, [(x0, -0.75, 2.1), (x0 + 2.5, -0.75, 2.1), (x0 + 2.5, 0.75, 2.1), (x0, 0.75, 2.1)], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [UP] * 4,
                [(0.3, 1)] * 4, [(1, 1, 1)] * 4)
    out['FAR'] = [mb.to_object(f'{key}_FAR', mat, col)]
    return out, dict(tileM=[5.0, 1.8], alongRowM=5.0, betweenBaysM=2.2, windSway=0.04, heightM=2.4, lodDist=[45, 160])


def build_rose_post(col, mat, atlas: AtlasInfo, key='vineyard_rose_post'):
    """Weinberg-Rosenstock: weathered end post with a blooming rose bush at its foot (roses face -Y = glTF +Z)."""
    roses = [atlas.rect('rose_a'), atlas.rect('rose_b')]
    r_post = atlas.rect('post_wood', 3)
    rng = random.Random(20)
    mb = MeshBuilder()
    mb.tube([Vector((0, 0.05, -0.3)), Vector((0, -0.02, 0.9)), Vector((0, -0.09, 1.78))], [0.055, 0.052, 0.048], 6, r_post, cap_end=True)
    mb.tube([Vector((0, 0.7, -0.1)), Vector((0, 0.0, 1.35))], [0.035, 0.03], 5, r_post)
    centre = Vector((0, -0.25, 0.45))

    def nfn(p, cn):
        q = (p - Vector((0, -0.2, 0.2)))
        sph = q.normalized() if q.length > 1e-4 else UP
        cc = cn if cn.dot(sph) >= 0 else -cn
        return sph * 0.7 + cc * 0.3

    for k in range(13):
        a = k / 13 * math.tau + rng.uniform(-0.2, 0.2)
        outward = Vector((math.cos(a), math.sin(a) * 0.8 - 0.2, 0)).normalized()
        up = (UP * rng.uniform(0.5, 1.0) + outward * rng.uniform(0.5, 0.9)).normalized()
        right = up.cross(outward).normalized()
        if right.length < 0.1:
            right = Vector((1, 0, 0))
        s = rng.uniform(0.75, 1.0)
        base = Vector((rng.uniform(-0.1, 0.1), -0.2 + rng.uniform(-0.1, 0.1), 0.0))
        sh = rng.uniform(0.85, 1.05)
        mb.grid_card(base, right, up, -UP * 0.08, s, s, rng.choice(roses), nfn, color=(sh, sh, sh), rows=2, flip_u=rng.random() < 0.5, cup=0.08)
    for a in (0.3, 1.9):
        right = Vector((math.cos(a), math.sin(a), 0))
        mb.grid_card(centre, right, UP, Vector((0, 0, 0)), 1.0, 0.95, rng.choice(roses), nfn, color=(0.8, 0.8, 0.8), rows=1, anchor_bottom=False)
    return {'LOD0': [mb.to_object(f'{key}_LOD0', mat, col)]}, dict(spacingM=5.5, windSway=0.03, heightM=1.8, lodDist=[110])


# ---------------------------------------------------------------------------------------------------------
# Solid props
# ---------------------------------------------------------------------------------------------------------

def build_straw_stack(col):
    """Stack of big square straw bales (2.35 x 1.2 x 0.88 m), four layers, long side along X."""
    mat = make_straw_material('StrawBale_Straw', PROP_TEX)
    rng = random.Random(21)
    mb = MeshBuilder()
    bl, bw, bh = 2.35, 1.2, 0.88
    layers = [(-1.18, 1.18), (-1.18, 1.18), (-1.18, 1.18), (0.0,)]
    for li, xs in enumerate(layers):
        for bx in xs:
            dx = bx + rng.uniform(-0.04, 0.04)
            dy = rng.uniform(-0.05, 0.05)
            z0 = li * bh - (0.03 if li == 0 else 0.0)
            col_v = rng.uniform(0.9, 1.05)
            mb.box((dx - bl / 2, dy - bw / 2, z0), (dx + bl / 2, dy + bw / 2, z0 + bh), (0, 0, 1, 1), color=(col_v, col_v * 0.99, col_v * 0.95), uv_m=1.4, skip_bottom=False)
    obj = mb.to_object('StrawBaleStack', mat, col, with_color=True, with_data=False)
    return [obj], dict(spacingM=8.0, windSway=0.0)


def _beam(mb: MeshBuilder, a, b, r: float, tile_m: float) -> None:
    mb.tube([Vector(a), Vector(b)], [r, r], 4, (0, 0, 1, 1), v_per_m=1 / tile_m, u_repeat=max(0.2, 4 * r * 1.4 / tile_m), cap_end=True)


def build_hochsitz(col):
    """Closed hunting stand (Kanzel) on four splayed legs, ~3.9 m; shooting window faces -Y (glTF +Z)."""
    tile = library_tile_m('wood_planks_weathered')
    mat = make_library_material('Hochsitz_Timber', 'wood_planks_weathered', size='_512', tint=(0.82, 0.78, 0.72))
    mat_roof = make_library_material('Hochsitz_RoofFelt', 'wood_planks_weathered', size='_512', tint=(0.2, 0.2, 0.21))
    mb = MeshBuilder()
    wb, wt, zf = 0.85, 0.62, 2.2
    legs = [(sx, sy) for sx in (-1, 1) for sy in (-1, 1)]
    for sx, sy in legs:
        _beam(mb, (sx * wb, sy * wb, -0.3), (sx * wt, sy * wt, zf), 0.06, tile)
    for (ax, ay), (bx, by) in (((-1, -1), (1, -1)), ((-1, -1), (-1, 1)), ((1, -1), (1, 1))):
        _beam(mb, (ax * wb * 0.97, ay * wb * 0.97, 0.15), (bx * wt * 1.02, by * wt * 1.02, zf - 0.15), 0.035, tile)
        _beam(mb, (bx * wb * 0.97, by * wb * 0.97, 0.15), (ax * wt * 1.02, ay * wt * 1.02, zf - 0.15), 0.035, tile)
    for sy in (-1, 1):
        _beam(mb, (-wt - 0.1, sy * wt, zf - 0.06), (wt + 0.1, sy * wt, zf - 0.06), 0.05, tile)
    # ladder at the back (+Y)
    for sx in (-0.28, 0.28):
        _beam(mb, (sx, wb + 0.55, -0.25), (sx, wt + 0.05, zf + 0.1), 0.035, tile)
    for k in range(7):
        t = (k + 0.6) / 7.4
        y = wb + 0.55 + (wt + 0.05 - wb - 0.55) * t
        z = -0.25 + (zf + 0.35) * t
        _beam(mb, (-0.3, y, z), (0.3, y, z), 0.022, tile)
    c = wt + 0.03
    mb.box((-c, -c, zf), (c, c, zf + 0.05), (0, 0, 1, 1), uv_m=tile, skip_bottom=False)
    zt = zf + 1.75
    for sx, sy in legs:
        mb.box((sx * c - 0.04, sy * c - 0.04, zf), (sx * c + 0.04, sy * c + 0.04, zt - (0.0 if sy < 0 else 0.22)), (0, 0, 1, 1), uv_m=tile)
    par = zf + 0.95
    mb.box((-c, -c - 0.02, zf), (c, -c + 0.02, par), (0, 0, 1, 1), uv_m=tile)        # front, below the window
    mb.box((-c - 0.02, -c, zf), (-c + 0.02, c, par), (0, 0, 1, 1), uv_m=tile)
    mb.box((c - 0.02, -c, zf), (c + 0.02, c, par), (0, 0, 1, 1), uv_m=tile)
    mb.box((-c, c - 0.02, zf + 0.9), (c, c + 0.02, zt - 0.25), (0, 0, 1, 1), uv_m=tile)  # back wall above the door
    mb.box((-c, -c - 0.02, zt - 0.3), (c, -c + 0.02, zt), (0, 0, 1, 1), uv_m=tile)      # header over the window
    mb.box((-c - 0.02, -c, zt - 0.3), (-c + 0.02, c, zt - 0.1), (0, 0, 1, 1), uv_m=tile)
    mb.box((c - 0.02, -c, zt - 0.3), (c + 0.02, c, zt - 0.1), (0, 0, 1, 1), uv_m=tile)
    mb.box((-c - 0.04, -c - 0.12, par - 0.02), (c + 0.04, -c + 0.04, par + 0.03), (0, 0, 1, 1), uv_m=tile, skip_bottom=False)  # rifle rest
    timber = mb.to_object('Hochsitz_Timber', mat, col, with_color=False, with_data=False)
    rb = MeshBuilder()
    o = c + 0.22
    z_front, z_back, th = zt + 0.06, zt - 0.2, 0.05
    n_up = Vector((0, -(z_front - z_back), 2 * o)).normalized()
    top = [(-o, -o, z_front + th), (o, -o, z_front + th), (o, o, z_back + th), (-o, o, z_back + th)]
    bot = [(-o, -o, z_front), (o, -o, z_front), (o, o, z_back), (-o, o, z_back)]
    rb.quad(top, (0, 0, 2 * o / tile, 2 * o / tile), normals=[n_up] * 4)
    rb.quad(list(reversed(bot)), (0, 0, 2 * o / tile, 2 * o / tile), normals=[-n_up] * 4)
    for i in range(4):
        j = (i + 1) % 4
        e = Vector(bot[j]) - Vector(bot[i])
        n = Vector((e.y, -e.x, 0)).normalized()
        rb.quad([bot[i], bot[j], top[j], top[i]], (0, 0, e.length / tile, th / tile), normals=[n] * 4)
    roof = rb.to_object('Hochsitz_Roof', mat_roof, col, with_color=False, with_data=False)
    return [timber, roof], dict(spacingM=4.0, windSway=0.0)


def build_wegekreuz(col):
    """Red sandstone wayside cross on a stepped plinth, ~2.5 m; front faces -Y (glTF +Z)."""
    tile = library_tile_m('sandstone_red_ashlar')
    mat = make_library_material('Wegekreuz_Sandstone', 'sandstone_red_ashlar', size='_512')
    mat_bronze = make_library_material('Wegekreuz_Bronze', 'metal_rusty', size='_512', tint=(0.32, 0.3, 0.27))
    mb = MeshBuilder()

    def blk(cx, cy, z0, z1, w, d):
        mb.box((cx - w / 2, cy - d / 2, z0), (cx + w / 2, cy + d / 2, z1), (0.03, 0.03, 1, 1), uv_m=tile * 2.2, skip_bottom=False)

    blk(0, 0, -0.3, 0.12, 1.1, 1.1)
    blk(0, 0, 0.12, 0.34, 0.86, 0.86)
    blk(0, 0, 0.34, 1.16, 0.56, 0.5)
    blk(0, 0, 1.16, 1.24, 0.66, 0.6)
    blk(0, 0, 1.24, 1.32, 0.74, 0.68)
    blk(0, 0, 1.32, 1.40, 0.3, 0.26)
    blk(0, 0, 1.40, 2.42, 0.17, 0.15)
    blk(0, 0, 1.92, 2.08, 0.86, 0.15)
    blk(0, 0, 2.42, 2.48, 0.11, 0.1)
    stone = mb.to_object('Wegekreuz_Stone', mat, col, with_color=False, with_data=False)
    bb = MeshBuilder()
    rust = library_tile_m('metal_rusty')
    bb.box((-0.13, -0.262, 0.58), (0.13, -0.25, 0.92), (0, 0, 1, 1), uv_m=rust, skip_bottom=False)
    bb.box((-0.06, -0.09, 2.2), (0.06, -0.075, 2.26), (0, 0, 1, 1), uv_m=rust, skip_bottom=False)
    bb.tube([Vector((0, -0.095, 1.62)), Vector((0, -0.1, 1.86)), Vector((0, -0.095, 2.06))], [0.022, 0.03, 0.024], 5, (0, 0, 1, 1), cap_end=True)
    bb.tube([Vector((-0.24, -0.092, 2.02)), Vector((0, -0.098, 1.98)), Vector((0.24, -0.092, 2.02))], [0.014, 0.018, 0.014], 5, (0, 0, 1, 1), cap_end=True)
    bronze = bb.to_object('Wegekreuz_Bronze', mat_bronze, col, with_color=False, with_data=False)
    return [stone, bronze], dict(spacingM=2.5, windSway=0.0)


# ---------------------------------------------------------------------------------------------------------

def tag_lod_meta(parts: dict, info: dict) -> None:
    """src/dataLoader.ts keeps only a few manifest fields, so the tile metadata rides on the LOD0 node (glTF extras)."""
    node = parts['LOD0'][0]
    for k in ('tileM', 'lodDist', 'heightM', 'windSway', 'alongRowM', 'betweenBaysM'):
        if k in info:
            node[k] = info[k]


def lod_meta(key: str, parts: dict) -> dict:
    return {k: {'node': f'{key}_{k}', 'triangles': triangle_count(v)} for k, v in parts.items() if k != 'FLOOR'}


def flat(parts: dict) -> list:
    return [o for objs in parts.values() for o in objs]


def main() -> None:
    clear_scene()
    scene_col = bpy.context.scene.collection
    meta: dict[str, dict] = {}

    def new_col(name):
        c = bpy.data.collections.new(name)
        scene_col.children.link(c)
        return c

    def register(key: str, rel_glb: str, objs: list, size: int, info: dict, parts: dict | None = None) -> None:
        meshes = [o for o in objs if o.type == 'MESH']
        entry = {'key': key, 'name': key, 'glbFile': rel_glb, 'fileSizeBytes': size, 'boundsBox': object_bounds_gltf(meshes), 'meshCount': len(meshes)}
        entry.update(info)
        if parts is not None:
            entry['nodePrefix'] = key
            entry['lods'] = lod_meta(key, parts)
        meta[key] = entry
        print(f"[fields] {key}: {size / 1024:.0f} KB {entry.get('lods') or triangle_count(meshes)}")

    for key, rel, fn in (
        ('crop_wheat_patch', 'wheat/crop_wheat_patch.glb', build_wheat),
        ('crop_stubble_patch', 'wheat/crop_stubble_patch.glb', build_stubble),
        ('crop_corn_row', 'corn/crop_corn_row.glb', build_corn),
        ('crop_sugarbeet_row', 'sugarbeet/crop_sugarbeet_row.glb', build_beet),
        ('crop_sunflower_patch', 'sunflower/crop_sunflower_patch.glb', build_sunflower),
    ):
        parts, info = fn(new_col(key))
        tag_lod_meta(parts, info)
        size = export_glb(flat(parts), os.path.join(OUT, rel), image_quality=CROP_WEBP_QUALITY)
        register(key, rel, parts['LOD0'], size, info, parts)

    # meadow + wildflower strip share one atlas -> one GLB
    col = new_col('meadow')
    m_atlas = AtlasInfo(os.path.join(FIELD_TEX, 'crop_meadow_atlas.json'))
    m_mat = m_atlas.material('Veg_Meadow', roughness=0.8)
    meadow, m_info = build_meadow(col, m_mat, m_atlas)
    flowers, f_info = build_wildflower(col, m_mat, m_atlas)
    rel = 'meadow/meadow_grass_patch.glb'
    tag_lod_meta(meadow, m_info)
    tag_lod_meta(flowers, f_info)
    size = export_glb(flat(meadow) + flat(flowers), os.path.join(OUT, rel), image_quality=CROP_WEBP_QUALITY)
    register('meadow_grass_patch', rel, meadow['LOD0'], size, m_info, meadow)
    register('wildflower_strip', rel, flowers['LOD0'], size, f_info, flowers)

    # hedgerow + rose post share the hedge atlas -> one GLB
    col = new_col('hedge')
    h_atlas = AtlasInfo(os.path.join(PROP_TEX, 'veg_hedge_atlas.json'))
    h_mat = h_atlas.material('Veg_Hedge', roughness=0.7)
    hedge, h_info = build_hedgerow(col, h_mat, h_atlas)
    rose, r_info = build_rose_post(col, h_mat, h_atlas)
    rel = 'props/hedgerow_bay.glb'
    tag_lod_meta(hedge, h_info)
    tag_lod_meta(rose, r_info)
    size = export_glb(flat(hedge) + flat(rose), os.path.join(OUT, rel), image_quality=80)
    register('hedgerow_bay', rel, hedge['LOD0'], size, h_info, hedge)
    register('vineyard_rose_post', rel, rose['LOD0'], size, r_info, rose)

    for key, rel, fn in (
        ('straw_bale_stack', 'wheat/straw_bale_stack.glb', build_straw_stack),
        ('hochsitz', 'props/hochsitz.glb', build_hochsitz),
        ('wegekreuz', 'props/wegekreuz.glb', build_wegekreuz),
    ):
        objs, info = fn(new_col(key))
        size = export_glb(objs, os.path.join(OUT, rel), image_quality=85)
        register(key, rel, objs, size, info)

    with open(os.path.join(OUT, 'build_meta.json'), 'w', encoding='utf-8') as fh:
        json.dump({'models': meta}, fh, indent=2)

    # GLBs of the first asset pass that are now merged into shared files
    for stale in ('meadow/wildflower_strip.glb', 'props/vineyard_rose_post.glb'):
        p = os.path.join(OUT, stale)
        if os.path.isfile(p):
            os.remove(p)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print('[fields] done')


if __name__ == '__main__':
    main()
