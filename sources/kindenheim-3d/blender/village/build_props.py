#!/usr/bin/env python3
"""
Kindenheim vegetation & village props builder (Blender 5.2, no rendering).

    python3 blender/village/props/build_veg_atlases.py          # once: photo leaf atlases (system python)
    /opt/homebrew/bin/blender --background --python blender/village/build_props.py

Exports to public/assets/models/village/props/:
    vine_row.glb      trellised vine bay (6 m along X): nodes vine_row_LOD0 / _LOD1 / _FAR (far = leaf tent + lane floor)
    trees.glb         4 species x 3 LODs: tree_deciduous (linden), tree_orchard (apple), tree_riparian (alder),
                      tree_poplar - nodes <key>_LOD0 / _LOD1 / _LOD2, each with a *_wood and a *_leaves mesh
    ortsschild.glb, streetlamp.glb, hay_bale.glb, wine_barrel.glb
and writes blender/village/props/props_meta.json + public/assets/models/village/props_meta.json and merges the
`props` key of public/assets/models/village/manifest.json (all other manifest keys are left untouched).

Mesh conventions are documented in blender/village/props/veg_blender.py.
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'props'))
from veg_blender import (  # noqa: E402
    PROJECT_ROOT,
    AtlasInfo,
    MeshBuilder,
    clear_scene,
    export_glb,
    join_under_empty,
    library_tile_m,
    make_flat_material,
    make_library_material,
    make_straw_material,
    make_texture_material,
    object_bounds_gltf,
    rand_unit,
    rot_about,
    triangle_count,
)

TEX_DIR = os.path.join(PROJECT_ROOT, 'blender/village/textures/props')
BLEND_OUT = os.path.join(PROJECT_ROOT, 'blender/village/props/kindenheim_props.blend')
GLB_DIR = os.path.join(PROJECT_ROOT, 'public/assets/models/village/props')
META_OUT = os.path.join(PROJECT_ROOT, 'blender/village/props/props_meta.json')
META_PUBLIC = os.path.join(PROJECT_ROOT, 'public/assets/models/village/props_meta.json')
MANIFEST = os.path.join(PROJECT_ROOT, 'public/assets/models/village/manifest.json')

UP = Vector((0, 0, 1))


def smoothstep(a: float, b: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------------------
# Vineyard bay
# ---------------------------------------------------------------------------------------------------------

def _quad_c(mb: MeshBuilder, pts, uvs, normals, datas, colors) -> None:
    ids = [mb.vert(pts[i], normals[i], uvs[i], datas[i], colors[i]) for i in range(4)]
    mb.face(*ids)


def _vine_wall(mb: MeshBuilder, rect, side: float, y: float, z0: float, z1: float, u_off: float, segs: int = 3, bulge: float = 0.05) -> None:
    """Leaf-wall card on one side of the row; u runs along the row (3.94 m per repeat keeps the leaves life-size)."""
    _, v0, _, v1 = rect
    rep = 6.0 / 3.94
    for s in range(segs):
        xa = -3.0 + 6.0 * s / segs
        xb = -3.0 + 6.0 * (s + 1) / segs
        ua = u_off + rep * s / segs
        ub = u_off + rep * (s + 1) / segs
        ya = y + side * bulge * math.sin(s * 2.1 + u_off * 9)
        yb = y + side * bulge * math.sin((s + 1) * 2.1 + u_off * 9)
        n_lo = Vector((0, side * 0.85, 0.25))
        n_hi = Vector((0, side * 0.6, 0.75))
        pts = [(xa, ya, z0), (xb, yb, z0), (xb, yb * 0.6, z1), (xa, ya * 0.6, z1)]
        _quad_c(mb, pts, [(ua, v0), (ub, v0), (ub, v1), (ua, v1)], [n_lo, n_lo, n_hi, n_hi],
                [(0.0, 1.0), (0.0, 1.0), (0.6, 1.0), (0.6, 1.0)], [(0.70, 0.72, 0.68)] * 2 + [(1.0, 1.0, 1.0)] * 2)


def _vine_canopy_top(mb: MeshBuilder, wall, rng: random.Random, pieces: int, z_base: float, leaves: int = 0, leaf_tiles=None) -> None:
    """Leafy canopy top. Each piece is a pair of short leaf-wall panels leaning out from the row centre like a ridge;
    they sample the strip from its dense middle (on the ridge) to its ragged upper edge (outside), so every panel ends
    in a leaf silhouette that droops over the wall top. The previous single rolled panels cut from the dense middle
    had four straight edges and caught the noon sun: from the chase camera they read as pale paper cards (review).
    Optional single leaves scattered over the top break the ridge line up further (LOD0)."""
    v_mid = wall[1] + (wall[3] - wall[1]) * 0.5
    v_top = wall[3]
    seg = 6.0 / pieces
    for i in range(pieces):
        xc = -3.0 + seg * (i + 0.5) + rng.uniform(-0.12, 0.12)
        for side in (-1.0, 1.0):
            half_l = seg * rng.uniform(0.62, 0.82)
            yaw = math.radians(rng.uniform(-8, 8))
            ax = Vector((math.cos(yaw), math.sin(yaw), 0.0))
            z_ridge = z_base + rng.uniform(0.02, 0.14)
            ridge = Vector((xc + rng.uniform(-0.1, 0.1), side * rng.uniform(-0.02, 0.04), z_ridge))
            out = Vector((0.0, side * rng.uniform(0.24, 0.34), -rng.uniform(0.08, 0.24)))
            n = Vector((0.0, side * 0.5, 0.82)).normalized()
            sh = rng.uniform(0.78, 0.9)
            tint = (sh * rng.uniform(0.95, 1.03), sh, sh * rng.uniform(0.9, 0.98))
            uo = rng.random()
            du = (2 * half_l) / 3.94
            p0 = ridge - ax * half_l
            p1 = ridge + ax * half_l
            pts = [p0, p1, p1 + out, p0 + out]
            _quad_c(mb, pts, [(uo, v_mid), (uo + du, v_mid), (uo + du, v_top), (uo, v_top)], [n] * 4,
                    [(0.2, 0.7), (0.2, 0.7), (0.6, 0.7), (0.6, 0.7)], [tint] * 4)
    for _ in range(leaves):
        x = rng.uniform(-3.0, 3.0)
        y = rng.uniform(-0.3, 0.3)
        z = z_base + rng.uniform(-0.04, 0.2)
        a = rng.uniform(0, math.tau)
        right = Vector((math.cos(a), math.sin(a), 0.0))
        up = Vector((-math.sin(a), math.cos(a), rng.uniform(0.35, 1.2))).normalized()
        size = rng.uniform(0.14, 0.2)
        u0, v0, u1, v1 = rng.choice(leaf_tiles)
        sh = rng.uniform(0.8, 0.95)
        mb.grid_card(Vector((x, y, z)), right, up, Vector((0, 0, 0)), size, size, (u0, v0, u1, v1), lambda p, c: (c if c.z >= 0 else -c) * 0.5 + UP * 0.6,
                     color=(sh * rng.uniform(0.94, 1.06), sh, sh * rng.uniform(0.86, 0.98)), rows=1)


def build_vine(col, atlas: AtlasInfo):
    mat = atlas.material('Veg_Vine', roughness=0.7)
    rect = atlas.rect
    wall = rect('leaf_wall', 2.0)
    wall = (0.0, wall[1], 1.0, wall[3])  # full-width tile: u wraps
    rng = random.Random(101)

    # ---------------- LOD0 -------------------------------------------------------------------------------
    mb = MeshBuilder()
    steel = rect('post_steel', 3.0)
    mb.box((-3.0 - 0.027, -0.019, -0.4), (-3.0 + 0.027, 0.019, 2.12), steel)
    wire = rect('wire', 6.0)
    wires = [(0.0, 0.74), (-0.03, 1.06), (0.03, 1.06), (-0.035, 1.38), (0.035, 1.38), (-0.03, 1.70), (0.03, 1.70)]
    for wy, wz in wires:
        n = Vector((0, -1 if wy <= 0 else 1, 0.25))
        mb.quad([(-3, wy, wz - 0.006), (3, wy, wz - 0.006), (3, wy, wz + 0.006), (-3, wy, wz + 0.006)], wire, normals=[n] * 4)
    bark = rect('bark', 3.0)
    vine_x = [-2.4 + 1.2 * i + rng.uniform(-0.09, 0.09) for i in range(5)]
    for xv in vine_x:
        path = [
            Vector((xv, 0.0, -0.12)),
            Vector((xv + rng.uniform(-0.05, 0.05), rng.uniform(-0.04, 0.04), 0.24)),
            Vector((xv + rng.uniform(-0.06, 0.06), rng.uniform(-0.04, 0.04), 0.50)),
            Vector((xv + rng.uniform(-0.03, 0.03), 0.0, 0.73)),
        ]
        mb.tube(path, [0.036, 0.029, 0.026, 0.023], 5, bark)
        top = path[-1]
        for d in (-1, 1):
            arm = [top, top + Vector((d * 0.30, rng.uniform(-0.015, 0.015), 0.035)), top + Vector((d * 0.60, 0, 0.01))]
            mb.tube(arm, [0.019, 0.015, 0.011], 4, bark)

    _vine_wall(mb, wall, -1.0, -0.10, 0.64, 1.90, rng.random())
    _vine_wall(mb, wall, 1.0, 0.10, 0.64, 1.90, rng.random())
    # ragged leafy top so the row is closed from the drone but never a flat strip
    _vine_canopy_top(mb, wall, rng, 9, 1.82, leaves=36, leaf_tiles=[rect(f'leaf_{i}') for i in range(5)])

    def shoot_normal(side: float):
        def fn(p, card_n):
            cn = card_n if card_n.y * side >= 0 else -card_n
            return cn * 0.45 + UP * 0.5 + Vector((0, side * 0.4, 0))
        return fn

    upright = [rect('shoot_0'), rect('shoot_1'), rect('shoot_3')]
    hanging = rect('shoot_2')
    for xv in vine_x:
        for k in range(9):
            lower = k < 5
            x = xv + rng.uniform(-0.62, 0.62)
            y = rng.uniform(-0.17, 0.17)
            side = 1.0 if y >= 0 else -1.0
            z = (0.70 + rng.uniform(0, 0.22)) if lower else (1.12 + rng.uniform(0, 0.2))
            yaw = math.radians(rng.uniform(-42, 42))
            right = Vector((math.cos(yaw), math.sin(yaw), 0))
            up = Vector((rng.uniform(-0.15, 0.15), side * rng.uniform(0.04, 0.3), 1)).normalized()
            s = rng.uniform(0.95, 1.3)
            shade = rng.uniform(0.84, 1.0) if lower else rng.uniform(0.94, 1.08)
            tint = (shade * rng.uniform(0.95, 1.05), shade, shade * rng.uniform(0.9, 1.05))
            mb.grid_card(Vector((x, y, z)), right, up, Vector((0, side * 0.12, 0)), 0.52 * s, 0.70 * s, rng.choice(upright),
                         shoot_normal(side), color=tint, rows=2, flip_u=rng.random() < 0.5)
    for k in range(12):
        # young shoots standing above the top wire: they break the silhouette of the row
        x = -2.8 + 5.6 * (k + rng.uniform(0.1, 0.9)) / 12
        yaw = math.radians(rng.uniform(-80, 80))
        right = Vector((math.cos(yaw), math.sin(yaw), 0))
        up = Vector((rng.uniform(-0.2, 0.2), rng.uniform(-0.25, 0.25), 1)).normalized()
        s = rng.uniform(0.7, 1.0)
        mb.grid_card(Vector((x, rng.uniform(-0.06, 0.06), 1.56)), right, up, Vector((0, rng.uniform(-0.08, 0.08), 0)), 0.52 * s, 0.70 * s, rng.choice(upright),
                     shoot_normal(1.0 if rng.random() < 0.5 else -1.0), color=(1.02, 1.04, 0.96), rows=2, flip_u=rng.random() < 0.5)
    for _ in range(7):
        x = rng.uniform(-2.9, 2.9)
        side = rng.choice((-1.0, 1.0))
        y = side * rng.uniform(0.08, 0.2)
        right = Vector((1, rng.uniform(-0.3, 0.3), 0)).normalized()
        down = Vector((rng.uniform(-0.1, 0.1), side * rng.uniform(0.1, 0.3), -1)).normalized()
        u0, v0, u1, v1 = hanging
        mb.grid_card(Vector((x, y, 1.93)), right, down, Vector((0, side * 0.1, 0)), 0.52, 0.72, (u0, v1, u1, v0),
                     shoot_normal(side), color=(1.0, 1.0, 0.96), rows=2)
    leaf_tiles = [rect(f'leaf_{i}') for i in range(5)]
    for _ in range(72):
        side = rng.choice((-1.0, 1.0))
        x = rng.uniform(-3.0, 3.0)
        z = rng.uniform(0.78, 1.98)
        y = side * rng.uniform(0.11, 0.27)
        n = Vector((rng.uniform(-0.5, 0.5), side * rng.uniform(0.5, 1.0), rng.uniform(0.15, 0.9))).normalized()
        hang = Vector((rng.uniform(-0.5, 0.5), 0, -1))
        hang = (hang - n * hang.dot(n)).normalized()
        right = hang.cross(n).normalized()
        size = rng.uniform(0.13, 0.18)
        u0, v0, u1, v1 = rng.choice(leaf_tiles)
        shade = 0.8 + 0.25 * smoothstep(0.7, 1.7, z) + rng.uniform(-0.05, 0.05)
        tint = (shade * rng.uniform(0.94, 1.1), shade, shade * rng.uniform(0.85, 1.0))
        nn = (n * 0.6 + UP * 0.4)
        mb.grid_card(Vector((x, y, z)), right, hang, n * 0.03, size, size, (u0, v1, u1, v0), lambda p, c, nn=nn: nn, color=tint, rows=1)
    grape_tiles = [rect(f'grape_{i}') for i in range(3)]
    for xv in vine_x:
        for _ in range(3):
            x = xv + rng.uniform(-0.5, 0.5)
            side = rng.choice((-1.0, 1.0))
            y = side * rng.uniform(0.04, 0.13)
            zt = rng.uniform(0.80, 1.0)
            u0, v0, u1, v1 = rng.choice(grape_tiles)
            sz = rng.uniform(0.9, 1.15)
            for yaw in (rng.uniform(-0.4, 0.4), math.pi / 2 + rng.uniform(-0.4, 0.4)):
                r = Vector((math.cos(yaw), math.sin(yaw), 0))
                nrm = Vector((-r.y, r.x, 0))
                if nrm.y * side < 0:
                    nrm = -nrm
                w, h = 0.105 * sz, 0.195 * sz
                top = Vector((x, y, zt))
                pts = [top - r * (w / 2) - UP * h, top + r * (w / 2) - UP * h, top + r * (w / 2), top - r * (w / 2)]
                na = (nrm * 0.8 + UP * 0.3)
                mb.quad(pts, (u0, v0, u1, v1), normals=[na] * 4, color=(1.0, 1.0, 1.0))
    lod0 = mb.to_object('vine_row_LOD0', mat, col)

    # ---------------- LOD1 -------------------------------------------------------------------------------
    rng = random.Random(202)
    mb = MeshBuilder()
    mb.box((-3.0 - 0.03, -0.022, -0.3), (-3.0 + 0.03, 0.022, 2.12), steel)
    for xv in vine_x:
        mb.tube([Vector((xv, 0, -0.1)), Vector((xv + 0.03, 0.02, 0.36)), Vector((xv, 0, 0.74))], [0.036, 0.03, 0.026], 3, bark)
    _vine_wall(mb, wall, -1.0, -0.13, 0.62, 1.92, rng.random(), segs=1, bulge=0.0)
    _vine_wall(mb, wall, 1.0, 0.13, 0.62, 1.92, rng.random(), segs=1, bulge=0.0)
    _vine_canopy_top(mb, wall, rng, 5, 1.82)
    for k in range(18):
        x = -2.85 + 5.7 * (k + rng.uniform(0.1, 0.9)) / 18
        side = 1.0 if k % 2 == 0 else -1.0
        y = side * rng.uniform(0.1, 0.2)
        z = rng.uniform(0.74, 1.2)
        yaw = math.radians(rng.uniform(-35, 35))
        right = Vector((math.cos(yaw), math.sin(yaw), 0))
        up = Vector((rng.uniform(-0.12, 0.12), side * rng.uniform(0.1, 0.32), 1)).normalized()
        s = rng.uniform(1.25, 1.6)
        mb.grid_card(Vector((x, y, z)), right, up, Vector((0, 0, 0)), 0.52 * s, 0.70 * s, rng.choice(upright), shoot_normal(side),
                     color=(0.98, 1.0, 0.95), rows=1, flip_u=rng.random() < 0.5)
    lod1 = mb.to_object('vine_row_LOD1', mat, col)

    # ---------------- FAR: leaf tent, 4 triangles per bay (covers the hills) -------------------------------
    mb = MeshBuilder()
    for side in (-1.0, 1.0):
        n_lo = Vector((0, side * 0.8, 0.45))
        n_hi = Vector((0, side * 0.45, 0.9))
        uo = 0.0 if side < 0 else 0.37
        pts = [(-3, side * 0.42, 0.58), (3, side * 0.42, 0.58), (3, side * 0.05, 1.94), (-3, side * 0.05, 1.94)]
        _quad_c(mb, pts, [(uo, wall[1]), (uo + 1.5, wall[1]), (uo + 1.5, wall[3]), (uo, wall[3])], [n_lo, n_lo, n_hi, n_hi],
                [(0.0, 1.0)] * 2 + [(0.5, 1.0)] * 2, [(0.74, 0.76, 0.72)] * 2 + [(1.0, 1.0, 1.0)] * 2)
    far = mb.to_object('vine_row_FAR', mat, col)

    # ---------------- FLOOR: material carrier for the lane carpet the runtime drapes over the terrain grid ----
    floor_mat = make_texture_material('Floor_Vineyard', os.path.join(TEX_DIR, 'veg_vine_floor_albedo.jpg'),
                                      os.path.join(TEX_DIR, 'veg_vine_floor_normal.jpg'), roughness=0.92)
    mb = MeshBuilder()
    mb.quad([(-3, -2, 0), (3, -2, 0), (3, 2, 0), (-3, 2, 0)], (0, 0, 1, 1), normals=[UP] * 4)
    floor_obj = mb.to_object('vine_row_FLOOR', floor_mat, col, with_color=False, with_data=False)
    floor_obj['tileM'] = [6.0, 4.0]
    return {'LOD0': [lod0], 'LOD1': [lod1], 'FAR': [far], 'FLOOR': [floor_obj]}


# ---------------------------------------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------------------------------------

TREES = {
    'tree_deciduous': dict(  # village linden / lime, round dense crown
        atlas='linden', seed=11, height=11.5, trunk_h=2.7, trunk_r=0.27, crown_c=(0.0, 0.0, 7.0), crown_r=(4.3, 4.3, 4.5),
        mains=6, leader=True, branch_angle=(38, 62), up_bias=0.42, droop=0.05, cards=360, card_m=1.45, shell=0.42,
    ),
    'tree_orchard': dict(  # half-standard apple, low broad crown with fruit
        atlas='orchard', seed=23, height=5.2, trunk_h=1.45, trunk_r=0.13, crown_c=(0.0, 0.0, 3.3), crown_r=(2.7, 2.7, 1.9),
        mains=5, leader=False, branch_angle=(48, 70), up_bias=0.22, droop=0.18, cards=230, card_m=1.05, shell=0.45,
    ),
    'tree_riparian': dict(  # black alder / ash along the Kinderbach: tall, irregular
        atlas='alder', seed=37, height=14.5, trunk_h=3.4, trunk_r=0.24, crown_c=(0.2, 0.0, 9.0), crown_r=(3.5, 3.3, 5.6),
        mains=6, leader=True, branch_angle=(34, 58), up_bias=0.5, droop=0.10, cards=360, card_m=1.4, shell=0.38,
    ),
    'tree_garden': dict(  # small ornamental / young garden tree (rowan, field maple): compact crown on a thin stem
        atlas='alder', seed=71, height=6.4, trunk_h=1.7, trunk_r=0.11, crown_c=(0.0, 0.0, 4.2), crown_r=(2.3, 2.3, 2.2),
        mains=5, leader=True, branch_angle=(36, 60), up_bias=0.4, droop=0.06, cards=210, card_m=1.05, shell=0.45,
    ),
    'tree_poplar': dict(  # Lombardy poplar, fastigiate column
        atlas='poplar', seed=53, height=21.0, trunk_h=2.2, trunk_r=0.30, crown_c=(0.0, 0.0, 11.8), crown_r=(1.9, 1.9, 9.6),
        mains=10, leader=True, branch_angle=(14, 26), up_bias=0.9, droop=0.0, cards=300, card_m=1.3, shell=0.5,
    ),
}


class TreeSkeleton:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.rng = random.Random(cfg['seed'])
        self.c = Vector(cfg['crown_c'])
        self.r = Vector(cfg['crown_r'])
        self.branches: list[dict] = []   # {path, radii, level}
        self.anchors: list[tuple[Vector, Vector]] = []  # leaf anchors (position, direction)
        self._grow()

    def crown_d(self, p: Vector) -> float:
        q = p - self.c
        return math.sqrt((q.x / self.r.x) ** 2 + (q.y / self.r.y) ** 2 + (q.z / self.r.z) ** 2)

    def _grow(self) -> None:
        cfg, rng = self.cfg, self.rng
        h, th, tr = cfg['height'], cfg['trunk_h'], cfg['trunk_r']
        lean = Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), 0))
        top_h = h * 0.86 if cfg['leader'] else th * 1.15
        n = 7
        path, radii = [], []
        for i in range(n + 1):
            t = i / n
            z = -0.5 + (top_h + 0.5) * t
            wob = Vector((math.sin(t * 5.1 + 1.0), math.cos(t * 4.3), 0)) * 0.10 * tr * 4 * t
            path.append(Vector((lean.x * t, lean.y * t, z)) + wob)
            flare = 1.0 + 0.55 * max(0.0, 1.0 - (z + 0.5) / 1.1) ** 2
            taper = 1.0 - 0.9 * smoothstep(th * 0.6, top_h, z)
            radii.append(max(0.03, tr * flare * taper))
        self.branches.append({'path': path, 'radii': radii, 'level': 0})

        def trunk_at(z: float) -> tuple[Vector, float]:
            t = min(1.0, max(0.0, (z + 0.5) / (top_h + 0.5)))
            f = t * n
            i0 = min(int(f), n - 1)
            fr = f - i0
            return path[i0].lerp(path[i0 + 1], fr), radii[i0] + (radii[i0 + 1] - radii[i0]) * fr

        mains = cfg['mains']
        z_lo = th
        z_hi = top_h * (0.94 if cfg['leader'] else 1.0)
        for m in range(mains):
            z = z_lo + (z_hi - z_lo) * ((m + rng.uniform(0.1, 0.9)) / mains if cfg['leader'] else rng.uniform(0.75, 1.0))
            base, r_tr = trunk_at(z)
            az = (m / mains) * math.tau * (2.4 if cfg['leader'] else 1.0) + rng.uniform(-0.35, 0.35)
            el = math.radians(rng.uniform(*cfg['branch_angle']))
            d = Vector((math.cos(az) * math.sin(el), math.sin(az) * math.sin(el), math.cos(el)))
            reach = self._reach(base, d)
            self._branch(base, d, reach * rng.uniform(0.82, 0.98), min(r_tr * 0.62, tr * 0.5), 1)
        if cfg['leader']:
            self.anchors.append((path[-1], UP))

    def _reach(self, start: Vector, d: Vector) -> float:
        lo, hi = 0.2, 30.0
        for _ in range(18):
            mid = (lo + hi) / 2
            if self.crown_d(start + d * mid) < 1.0:
                lo = mid
            else:
                hi = mid
        return max(0.6, lo)

    def _branch(self, start: Vector, d: Vector, length: float, radius: float, level: int) -> None:
        cfg, rng = self.cfg, self.rng
        segs = 5 if level == 1 else 4 if level == 2 else 3
        path = [start]
        radii = [radius]
        p = start.copy()
        dd = d.normalized()
        for i in range(segs):
            dd = (dd + rand_unit(rng) * 0.16 + UP * (cfg['up_bias'] * 0.10) - UP * (cfg['droop'] * 0.25 * level * (i / segs))).normalized()
            p = p + dd * (length / segs)
            path.append(p.copy())
            radii.append(max(0.012, radius * (1.0 - 0.78 * (i + 1) / segs)))
        self.branches.append({'path': path, 'radii': radii, 'level': level})
        if level >= 3:
            for i in range(1, len(path)):
                self.anchors.append((path[i], (path[i] - path[i - 1]).normalized()))
            return
        if level == 2:
            for i in range(2, len(path)):
                self.anchors.append((path[i], (path[i] - path[i - 1]).normalized()))
        kids = 5 if level == 1 else 3
        for k in range(kids):
            t = 0.28 + 0.66 * (k + rng.uniform(0.15, 0.85)) / kids
            f = t * segs
            i0 = min(int(f), segs - 1)
            base = path[i0].lerp(path[i0 + 1], f - i0)
            tangent = (path[i0 + 1] - path[i0]).normalized()
            perp = tangent.orthogonal().normalized()
            perp = rot_about(tangent, rng.uniform(0, math.tau)) @ perp
            ang = math.radians(rng.uniform(32, 62))
            cd = (tangent * math.cos(ang) + perp * math.sin(ang) + UP * cfg['up_bias'] * 0.25).normalized()
            r0 = radii[i0] * 0.58
            ln = min(length * rng.uniform(0.42, 0.6) * (1.15 - 0.5 * t), self._reach(base, cd) * 0.97)
            if ln > 0.35:
                self._branch(base, cd, ln, max(0.012, r0), level + 1)


def _leaf_normal_fn(sk: TreeSkeleton, blend: float = 0.72):
    centre = sk.c - Vector((0, 0, sk.r.z * 0.28))

    def fn(p: Vector, card_n: Vector) -> Vector:
        q = p - centre
        sph = Vector((q.x / sk.r.x, q.y / sk.r.y, q.z / sk.r.z))
        if sph.length < 1e-4:
            sph = UP.copy()
        sph.normalize()
        cn = card_n if card_n.dot(sph) >= 0 else -card_n
        return (sph * blend + cn * (1 - blend)).normalized()
    return fn


def _leaf_color(sk: TreeSkeleton, p: Vector, rng: random.Random):
    d = sk.crown_d(p)
    ao = 0.52 + 0.48 * smoothstep(0.30, 0.95, d)
    ao *= 0.86 + 0.14 * smoothstep(-0.6, 0.5, (p.z - sk.c.z) / sk.r.z)
    if rng.random() < 0.08:
        tint = (1.12, 1.04, 0.78)
    else:
        tint = (rng.uniform(0.92, 1.06), rng.uniform(0.95, 1.05), rng.uniform(0.86, 1.04))
    return (ao * tint[0], ao * tint[1], ao * tint[2])


def _shell_points(sk: TreeSkeleton, count: int, rng: random.Random, d_range=(0.78, 0.98)):
    pts = []
    while len(pts) < count:
        u = rand_unit(rng)
        if u.z < -0.55:
            continue
        s = rng.uniform(*d_range)
        p = sk.c + Vector((u.x * sk.r.x * s, u.y * sk.r.y * s, u.z * sk.r.z * s))
        out = Vector((u.x / sk.r.x, u.y / sk.r.y, u.z / sk.r.z)).normalized()
        pts.append((p, out))
    return pts


def _add_wood(mb: MeshBuilder, sk: TreeSkeleton, max_level: int, sides_by_level: dict, ring_step: dict, tile_m: float) -> None:
    for br in sk.branches:
        lvl = br['level']
        if lvl > max_level:
            continue
        step = ring_step.get(lvl, 1)
        idx = list(range(0, len(br['path']), step))
        if idx[-1] != len(br['path']) - 1:
            idx.append(len(br['path']) - 1)
        path = [br['path'][i] for i in idx]
        radii = [br['radii'][i] for i in idx]
        sides = sides_by_level[lvl]
        circ = math.tau * radii[0]
        u_rep = max(1.0, round(circ / tile_m * 2.0)) / 2.0 if lvl == 0 else max(0.25, circ / tile_m)
        mb.tube(path, radii, sides, (0.0, 0.0, 1.0, 1.0), v_per_m=1.0 / tile_m, u_repeat=u_rep, cap_end=(lvl >= 2 or lvl == max_level))


def _core_cards(leaves: MeshBuilder, sk: TreeSkeleton, rng: random.Random, tile_crown, normal_fn, count: int) -> None:
    """Dark, dense cards through the crown centre: real crowns are opaque inside, the sky must not show through."""
    rx, rz = max(sk.r.x, sk.r.y), sk.r.z
    stack = max(1, int(round(rz / rx * 0.8)))
    for k in range(count):
        for sidx in range(stack):
            d = rand_unit(rng)
            d.z *= 0.35
            d.normalize()
            right = d.cross(UP).normalized()
            up = (UP + rand_unit(rng) * 0.35).normalized()
            zc = sk.c.z + (0.0 if stack == 1 else (-rz * 0.7 + 1.4 * rz * (sidx + 0.5) / stack))
            centre = Vector((sk.c.x, sk.c.y, zc)) + rand_unit(rng) * (0.22 * rx)
            s = rx * rng.uniform(1.25, 1.6)
            shade = rng.uniform(0.42, 0.58)
            leaves.grid_card(centre, right, up, Vector((0, 0, 0)), s, s, tile_crown, normal_fn, color=(shade, shade * 1.02, shade * 0.95), rows=1,
                             anchor_bottom=False, translucency=0.3, flip_u=rng.random() < 0.5)


def build_tree(col, key: str, cfg: dict, atlas: AtlasInfo, mat_leaf, mat_bark, bark_tile_m: float):
    sk = TreeSkeleton(cfg)
    species = cfg['atlas']
    tiles_branch = [atlas.rect(f'{species}_branch_a'), atlas.rect(f'{species}_branch_b')]
    tile_crown = atlas.rect(f'{species}_crown')
    tile_sprig = atlas.rect(f'{species}_sprig')
    normal_fn = _leaf_normal_fn(sk)
    out = {}

    def card_frame(pos: Vector, direction: Vector, rng: random.Random):
        outward = (pos - sk.c)
        outward = Vector((outward.x / sk.r.x, outward.y / sk.r.y, outward.z / sk.r.z))
        if outward.length < 1e-3:
            outward = UP.copy()
        outward.normalize()
        up = (direction * 0.55 + outward * 0.6 + UP * 0.18 - UP * cfg['droop'] * 1.2 + rand_unit(rng) * 0.3).normalized()
        right = up.cross(rand_unit(rng))
        if right.length < 1e-3:
            right = up.orthogonal()
        right.normalize()
        return right, up, outward

    # ---------------- LOD0 ----------------
    rng = random.Random(cfg['seed'] * 7 + 1)
    wood = MeshBuilder()
    _add_wood(wood, sk, 3, {0: 10, 1: 6, 2: 4, 3: 3}, {0: 1, 1: 1, 2: 1, 3: 2}, bark_tile_m)
    leaves = MeshBuilder()
    n_cards = cfg['cards']
    n_shell = int(n_cards * cfg['shell'])
    anchors = list(sk.anchors)
    rng.shuffle(anchors)
    anchors = anchors[: n_cards - n_shell]
    spots = [(p, d) for p, d in anchors] + _shell_points(sk, n_shell, rng)
    for pos, direction in spots:
        right, up, outward = card_frame(pos, direction, rng)
        s = cfg['card_m'] * rng.uniform(0.8, 1.2)
        base = pos - up * (s * 0.18)
        leaves.grid_card(base, right, up, outward * (0.10 * s) - UP * (cfg['droop'] * s * 0.5), s, s, rng.choice(tiles_branch), normal_fn,
                         color=_leaf_color(sk, pos, rng), rows=2, flip_u=rng.random() < 0.5, cup=0.06)
    _core_cards(leaves, sk, rng, tile_crown, normal_fn, 7)
    for pos, outward in _shell_points(sk, 70, rng, (0.92, 1.04)):
        up = (outward * 0.8 + UP * 0.3 + rand_unit(rng) * 0.35).normalized()
        right = up.cross(rand_unit(rng)).normalized()
        s = 0.55 * rng.uniform(0.85, 1.25)
        leaves.grid_card(pos - up * 0.1, right, up, Vector((0, 0, -0.04)), s, s, tile_sprig, normal_fn, color=_leaf_color(sk, pos, rng), rows=1)
    o_w = wood.to_object(f'{key}_LOD0_wood', mat_bark, col, with_color=False, with_data=True)
    o_l = leaves.to_object(f'{key}_LOD0_leaves', mat_leaf, col)
    out['LOD0'] = [join_under_empty(f'{key}_LOD0', [o_w, o_l], col), o_w, o_l]

    # ---------------- LOD1 ----------------
    rng = random.Random(cfg['seed'] * 7 + 2)
    wood = MeshBuilder()
    _add_wood(wood, sk, 1, {0: 6, 1: 3}, {0: 2, 1: 2}, bark_tile_m)
    leaves = MeshBuilder()
    n1 = max(70, int(n_cards * 0.42))
    _core_cards(leaves, sk, rng, tile_crown, normal_fn, 5)
    spots = [(p, d) for p, d in anchors[: n1 // 2]] + _shell_points(sk, n1 - n1 // 2, rng, (0.7, 0.95))
    for pos, direction in spots:
        right, up, outward = card_frame(pos, direction, rng)
        s = cfg['card_m'] * 1.75 * rng.uniform(0.85, 1.15)
        leaves.grid_card(pos - up * (s * 0.3), right, up, outward * (0.08 * s), s, s, rng.choice(tiles_branch), normal_fn,
                         color=_leaf_color(sk, pos, rng), rows=1, flip_u=rng.random() < 0.5)
    o_w = wood.to_object(f'{key}_LOD1_wood', mat_bark, col, with_color=False, with_data=True)
    o_l = leaves.to_object(f'{key}_LOD1_leaves', mat_leaf, col)
    out['LOD1'] = [join_under_empty(f'{key}_LOD1', [o_w, o_l], col), o_w, o_l]

    # ---------------- LOD2: a handful of crown cards ----------------
    rng = random.Random(cfg['seed'] * 7 + 3)
    wood = MeshBuilder()
    trunk = sk.branches[0]
    wood.tube([trunk['path'][0], trunk['path'][3], trunk['path'][-1]], [trunk['radii'][0], trunk['radii'][3], trunk['radii'][-1]], 4,
              (0.0, 0.0, 1.0, 1.0), v_per_m=1.0 / bark_tile_m)
    leaves = MeshBuilder()
    rx, rz = max(sk.r.x, sk.r.y), sk.r.z
    stack = max(1, int(round(rz / rx * 0.8)))
    cell_h = 2.0 * rz * 1.06 / stack
    card_w = 2.0 * rx * 1.22
    columnar = stack > 1
    for k in range(4 if columnar else 3):
        ang = k * math.pi / (4 if columnar else 3) + rng.uniform(-0.2, 0.2)
        right = Vector((math.cos(ang), math.sin(ang), 0))
        if columnar:
            # fastigiate crown (poplar): ONE tall card per plane - stacked round crown cards read as a string of beads
            leaves.grid_card(Vector((sk.c.x, sk.c.y, sk.c.z)), right, UP, Vector((0, 0, 0)), card_w * 1.1, 2.0 * rz * 1.04, tile_crown, normal_fn,
                             color=(0.9, 0.92, 0.88), rows=2, anchor_bottom=False, flip_u=rng.random() < 0.5)
            continue
        centre = Vector((sk.c.x, sk.c.y, sk.c.z - rz * 1.03 + cell_h * 0.5)) + right * rng.uniform(-0.1, 0.1) * rx
        leaves.grid_card(centre, right, UP, Vector((0, 0, 0)), card_w * rng.uniform(0.9, 1.08), cell_h, tile_crown, normal_fn,
                         color=(0.66, 0.68, 0.64), rows=1, anchor_bottom=False, flip_u=rng.random() < 0.5)
    n_sh = 0 if columnar else 14
    normal_fn = _leaf_normal_fn(sk, 0.9)
    for pos, outward in _shell_points(sk, n_sh, rng, (0.5, 0.9)):
        up = (UP - outward * outward.dot(UP))
        if up.length < 0.2:
            up = outward.orthogonal()
        up.normalize()
        right = up.cross(outward).normalized()
        # uneven lobes + the same depth shading as the detailed LODs: far crowns must not read as smooth green balls
        s = rx * rng.uniform(0.75, 1.3)
        leaves.grid_card(pos, right, up, Vector((0, 0, 0)), s * rng.uniform(0.85, 1.2), s, tile_crown, normal_fn, color=_leaf_color(sk, pos, rng), rows=1,
                         anchor_bottom=False, flip_u=rng.random() < 0.5)
    # lid seen from the drone (slightly tilted and off-centre so crowns do not read as perfect discs)
    lid_x = Vector((1, rng.uniform(-0.3, 0.3), rng.uniform(-0.18, 0.18))).normalized()
    lid_y = Vector((rng.uniform(-0.3, 0.3), 1, rng.uniform(-0.18, 0.18))).normalized()
    leaves.grid_card(Vector((sk.c.x, sk.c.y, sk.c.z + rz * (0.6 if columnar else 0.25))), lid_x, lid_y, Vector((0, 0, 0)), card_w * 0.95, card_w * 0.95,
                     tile_crown, normal_fn, color=(0.9, 0.92, 0.86), rows=1, anchor_bottom=False)
    o_w = wood.to_object(f'{key}_LOD2_wood', mat_bark, col, with_color=False, with_data=True)
    o_l = leaves.to_object(f'{key}_LOD2_leaves', mat_leaf, col)
    out['LOD2'] = [join_under_empty(f'{key}_LOD2', [o_w, o_l], col), o_w, o_l]
    return out


# ---------------------------------------------------------------------------------------------------------
# Village props
# ---------------------------------------------------------------------------------------------------------

def build_ortsschild(col):
    galv_m = library_tile_m('metal_galvanized')
    mat_steel = make_library_material('Ortsschild_Galvanized', 'metal_galvanized', size='_512')
    mat_front = make_texture_material('Ortsschild_Front', os.path.join(TEX_DIR, 'ortsschild_front.png'), roughness=0.34)
    mat_back = make_texture_material('Ortsschild_Back', os.path.join(TEX_DIR, 'ortsschild_back.png'), roughness=0.4)
    mb = MeshBuilder()
    for px in (-0.34, 0.34):
        mb.tube([Vector((px, 0.034, -0.5)), Vector((px, 0.034, 1.2)), Vector((px, 0.034, 2.27))], [0.03, 0.03, 0.03], 10,
                (0, 0, 1, 1), v_per_m=1 / galv_m, u_repeat=0.25, cap_end=True)
    for rz in (1.72, 2.12):
        mb.box((-0.43, 0.004, rz - 0.015), (0.43, 0.026, rz + 0.015), (0, 0, 1, 1), uv_m=galv_m, skip_bottom=False)
    sw, sh, st, cz = 0.96, 0.64, 0.02, 1.92
    mb.box((-sw / 2, -st / 2, cz - sh / 2), (sw / 2, st / 2, cz + sh / 2), (0, 0, 1, 1), uv_m=galv_m, skip_bottom=False)
    steel = mb.to_object('Ortsschild_Frame', mat_steel, col, with_color=False, with_data=False)
    front = MeshBuilder()
    yf = -st / 2 - 0.002
    front.quad([(-sw / 2, yf, cz - sh / 2), (sw / 2, yf, cz - sh / 2), (sw / 2, yf, cz + sh / 2), (-sw / 2, yf, cz + sh / 2)], (0, 0, 1, 1))
    o_front = front.to_object('Ortsschild_FrontFace', mat_front, col, with_color=False, with_data=False)
    back = MeshBuilder()
    yb = st / 2 + 0.002
    back.quad([(sw / 2, yb, cz - sh / 2), (-sw / 2, yb, cz - sh / 2), (-sw / 2, yb, cz + sh / 2), (sw / 2, yb, cz + sh / 2)], (0, 0, 1, 1))
    o_back = back.to_object('Ortsschild_BackFace', mat_back, col, with_color=False, with_data=False)
    return [steel, o_front, o_back]


def build_streetlamp(col):
    """Galvanised whip lamp (Peitschenleuchte) as on Hauptstrasse / Neugasse. Arm points to -Y (glTF +Z)."""
    galv_m = library_tile_m('metal_galvanized')
    mat_pole = make_library_material('Streetlamp_Galvanized', 'metal_galvanized', size='_512')
    mat_head = make_library_material('Streetlamp_Housing', 'metal_painted', size='_512', tint=(0.24, 0.26, 0.28))
    mat_lens = make_flat_material('Lamp_Emissive_Lens', (0.92, 0.9, 0.84), roughness=0.25, emission=(1.0, 0.86, 0.62), emission_strength=1.0)
    pole_pts = [(0, 0, -0.5), (0, 0, 0.0), (0, 0, 1.15), (0, 0, 3.0), (0, 0, 4.45), (0, -0.06, 4.95), (0, -0.22, 5.35), (0, -0.50, 5.64),
                (0, -0.84, 5.80), (0, -1.12, 5.86)]
    pole_r = [0.07, 0.068, 0.062, 0.052, 0.044, 0.040, 0.036, 0.033, 0.030, 0.028]
    mb = MeshBuilder()
    mb.tube([Vector(p) for p in pole_pts], pole_r, 12, (0, 0, 1, 1), v_per_m=1 / galv_m, u_repeat=0.5)
    mb.tube([Vector((0, 0, 0.0)), Vector((0, 0, 0.035))], [0.13, 0.13], 12, (0, 0, 1, 1), v_per_m=1 / galv_m, cap_end=True)
    mb.box((-0.04, -0.074, 0.55), (0.04, -0.06, 0.95), (0, 0, 1, 1), uv_m=galv_m, skip_bottom=False)
    pole = mb.to_object('Streetlamp_Pole', mat_pole, col, with_color=False, with_data=False)
    hb = MeshBuilder()
    paint_m = library_tile_m('metal_painted')
    tilt = math.radians(-8)
    c = Vector((0, -1.32, 5.885))

    def tp(x, y, z):
        return c + Vector((x, y * math.cos(tilt) - z * math.sin(tilt), y * math.sin(tilt) + z * math.cos(tilt)))
    prof = [(-0.26, 0.055, 0.03), (-0.10, 0.105, 0.045), (0.12, 0.11, 0.05), (0.27, 0.07, 0.03)]  # (y, half width, half height)
    rings = []
    for (y, hw, hh) in prof:
        ring = []
        for (sx, sz) in ((-1, -1), (1, -1), (1, 0.4), (0.55, 1), (-0.55, 1), (-1, 0.4)):
            ring.append(hb.vert(tp(sx * hw, y, sz * hh), Vector((sx, 0, sz)), (y / paint_m, (sx + sz) * 0.1 / paint_m)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(6):
            a, b = s, (s + 1) % 6
            hb.face(rings[i][a], rings[i + 1][a], rings[i + 1][b], rings[i][b])
    for ring, ny in ((rings[0], -1), (rings[-1], 1)):
        ids = [hb.vert(hb.verts[i], (0, ny, 0), (0, 0)) for i in ring]
        hb.face(*(ids if ny < 0 else list(reversed(ids))))
    head = hb.to_object('Streetlamp_Housing', mat_head, col, with_color=False, with_data=False)
    lb = MeshBuilder()
    down = Vector((0, math.sin(tilt), -math.cos(tilt)))
    lpts = [tp(-0.075, -0.16, -0.034), tp(0.075, -0.16, -0.034), tp(0.075, 0.2, -0.05), tp(-0.075, 0.2, -0.05)]
    lb.quad([lpts[3], lpts[2], lpts[1], lpts[0]], (0, 0, 1, 1), normals=[down] * 4)
    lens = lb.to_object('Streetlamp_Lamp_Emissive_Lens', mat_lens, col, with_color=False, with_data=False)
    return [pole, head, lens]


def build_hay_bale(col):
    """Round straw bale, 1.5 m diameter x 1.25 m, axis along X. Straw strands wrap around the circumference."""
    mat = make_straw_material('HayBale_Straw', TEX_DIR)
    mb = MeshBuilder()
    radius, half = 0.75, 0.625
    cz = radius - 0.03
    segs = 28
    prof = [(-half, radius * 0.9), (-half + 0.07, radius * 0.99), (-0.2, radius * 1.01), (0.2, radius * 1.01), (half - 0.07, radius * 0.99), (half, radius * 0.9)]
    tile = 1.5
    rings = []
    for xp, rp in prof:
        ring = []
        for s in range(segs + 1):
            a = (s % segs) / segs * math.tau
            jit = 1.0 + 0.012 * math.sin(a * 7 + xp * 9) + 0.008 * math.sin(a * 13)
            yy = math.cos(a) * rp * jit
            zz = math.sin(a) * rp * jit
            if zz < -radius * 0.9:
                zz = -radius * 0.9 + (zz + radius * 0.9) * 0.35  # settled on the ground
            n = Vector((0.25 * (1 if xp > half - 0.1 else -1 if xp < -half + 0.1 else 0), math.cos(a), math.sin(a)))
            ring.append(mb.vert((xp, yy, cz + zz), n, (xp / tile, (s / segs) * math.tau * radius / tile)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(segs):
            mb.face(rings[i][s], rings[i][s + 1], rings[i + 1][s + 1], rings[i + 1][s])
    for sign, ring in ((-1, rings[0]), (1, rings[-1])):
        n = Vector((sign, 0, 0))
        centre = mb.vert((sign * (half + 0.03), 0, cz), n, (0.5, 0.5))
        rim = []
        for s in range(segs + 1):
            px, py, pz = mb.verts[ring[s]]
            rim.append(mb.vert((px, py, pz), n + Vector((0, py, pz - cz)) * 0.3, (0.5 + py / tile, 0.5 + (pz - cz) / tile)))
        for s in range(segs):
            if sign > 0:
                mb.face(rim[s], rim[s + 1], centre)
            else:
                mb.face(rim[s + 1], rim[s], centre)
    return [mb.to_object('HayBale', mat, col, with_color=False, with_data=False)]


def build_wine_barrel(col):
    """Upright 225 l barrique: oak staves (grain along the staves), weathered steel hoops."""
    oak_m = library_tile_m('wood_beam_oak')
    mat_oak = make_library_material('WineBarrel_Oak', 'wood_beam_oak', size='_512', tint=(0.86, 0.74, 0.6))
    mat_hoop = make_library_material('WineBarrel_Hoops', 'metal_rusty', size='_512', tint=(0.55, 0.5, 0.48))
    segs = 24
    H = 0.94
    profile = [(0.00, 0.275), (0.04, 0.285), (0.18, 0.320), (0.35, 0.348), (0.47, 0.356), (0.59, 0.348), (0.76, 0.320), (0.90, 0.285), (0.94, 0.275)]
    mb = MeshBuilder()
    rings = []
    for i, (zp, rp) in enumerate(profile):
        slope = 0.0
        if 0 < i < len(profile) - 1:
            slope = (profile[i + 1][1] - profile[i - 1][1]) / (profile[i + 1][0] - profile[i - 1][0])
        ring = []
        for s in range(segs + 1):
            a = (s % segs) / segs * math.tau
            ring.append(mb.vert((math.cos(a) * rp, math.sin(a) * rp, zp), Vector((math.cos(a), math.sin(a), -slope)),
                                (s / segs * math.tau * 0.35 / oak_m, zp / oak_m)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(segs):
            mb.face(rings[i][s], rings[i][s + 1], rings[i + 1][s + 1], rings[i + 1][s])
    for top in (True, False):
        zl = H if top else 0.0
        zh = H - 0.035 if top else 0.03
        nz = 1 if top else -1
        outer, inner = [], []
        for s in range(segs + 1):
            a = (s % segs) / segs * math.tau
            ca, sa = math.cos(a), math.sin(a)
            outer.append(mb.vert((ca * 0.275, sa * 0.275, zl), (0, 0, nz), (0.5 + ca * 0.275 / oak_m, 0.5 + sa * 0.275 / oak_m)))
            inner.append(mb.vert((ca * 0.252, sa * 0.252, zh), (-ca, -sa, nz * 0.4), (0.5 + ca * 0.252 / oak_m, 0.5 + sa * 0.252 / oak_m)))
        centre = mb.vert((0, 0, zh), (0, 0, nz), (0.5, 0.5))
        lid = [mb.vert(mb.verts[i], (0, 0, nz), mb.uvs[i]) for i in inner]
        for s in range(segs):
            if top:
                mb.face(outer[s], outer[s + 1], inner[s + 1], inner[s])
                mb.face(lid[s], lid[s + 1], centre)
            else:
                mb.face(outer[s + 1], outer[s], inner[s], inner[s + 1])
                mb.face(lid[s + 1], lid[s], centre)
    oak = mb.to_object('WineBarrel_Oak', mat_oak, col, with_color=False, with_data=False)
    hb = MeshBuilder()
    rust_m = library_tile_m('metal_rusty')
    for hz, hr, hh in [(0.055, 0.292, 0.036), (0.21, 0.328, 0.032), (0.37, 0.354, 0.03), (0.57, 0.354, 0.03), (0.73, 0.328, 0.032), (0.885, 0.292, 0.036)]:
        lo, hi = [], []
        for s in range(segs + 1):
            a = (s % segs) / segs * math.tau
            n = (math.cos(a), math.sin(a), 0)
            u = s / segs * math.tau * hr / rust_m
            lo.append(hb.vert((math.cos(a) * (hr + 0.005), math.sin(a) * (hr + 0.005), hz - hh / 2), n, (u, 0)))
            hi.append(hb.vert((math.cos(a) * (hr + 0.005), math.sin(a) * (hr + 0.005), hz + hh / 2), n, (u, hh / rust_m)))
        for s in range(segs):
            hb.face(lo[s], lo[s + 1], hi[s + 1], hi[s])
    hoops = hb.to_object('WineBarrel_Hoops', mat_hoop, col, with_color=False, with_data=False)
    return [oak, hoops]


# ---------------------------------------------------------------------------------------------------------

def _meta(glb_rel: str, objs: list, fsize: int, lods: dict | None = None, node_prefix: str | None = None) -> dict:
    meshes = [o for o in objs if o.type == 'MESH']
    entry = {
        'glbPath': glb_rel,
        'bounds': object_bounds_gltf(meshes),
        'meshCount': len(meshes),
        'approxTriangles': triangle_count(meshes),
        'fileSizeBytes': fsize,
    }
    if node_prefix:
        entry['nodePrefix'] = node_prefix
    if lods:
        entry['lods'] = lods
    return entry


def main() -> None:
    clear_scene()
    os.makedirs(GLB_DIR, exist_ok=True)
    scene_col = bpy.context.scene.collection
    props_meta: dict = {}

    col = bpy.data.collections.new('Prop_vine_row')
    scene_col.children.link(col)
    vine_atlas = AtlasInfo(os.path.join(TEX_DIR, 'veg_vine_atlas.json'))
    vine = build_vine(col, vine_atlas)
    vine_objs = vine['LOD0'] + vine['LOD1'] + vine['FAR'] + vine['FLOOR']
    size = export_glb(vine_objs, os.path.join(GLB_DIR, 'vine_row.glb'), image_quality=80)
    props_meta['vine_row'] = _meta('/assets/models/village/props/vine_row.glb', vine['LOD0'], size, node_prefix='vine_row', lods={
        k: {'node': f'vine_row_{k}', 'triangles': triangle_count(v)} for k, v in vine.items()})
    props_meta['vine_row']['bayLengthM'] = 6.0
    props_meta['vine_row']['rowSpacingM'] = 2.0

    col = bpy.data.collections.new('Prop_trees')
    scene_col.children.link(col)
    tree_atlas = AtlasInfo(os.path.join(TEX_DIR, 'veg_tree_atlas.json'))
    mat_leaf = tree_atlas.material('Veg_TreeLeaves', roughness=0.6)
    mat_bark = make_library_material('Tree_Bark', 'bark_deciduous')
    bark_m = library_tile_m('bark_deciduous')
    tree_parts = {}
    all_tree_objs = []
    for key, cfg in TREES.items():
        parts = build_tree(col, key, cfg, tree_atlas, mat_leaf, mat_bark, bark_m)
        tree_parts[key] = parts
        for objs in parts.values():
            all_tree_objs += objs
    size = export_glb(all_tree_objs, os.path.join(GLB_DIR, 'trees.glb'), image_quality=80)
    for key, parts in tree_parts.items():
        props_meta[key] = _meta('/assets/models/village/props/trees.glb', parts['LOD0'], size, node_prefix=key, lods={
            k: {'node': f'{key}_{k}', 'triangles': triangle_count(v)} for k, v in parts.items()})
        props_meta[key]['crownCenter'] = list(TREES[key]['crown_c'])
        props_meta[key]['crownRadius'] = list(TREES[key]['crown_r'])
        props_meta[key]['heightM'] = TREES[key]['height']

    for key, fn in (('ortsschild', build_ortsschild), ('streetlamp', build_streetlamp), ('hay_bale', build_hay_bale), ('wine_barrel', build_wine_barrel)):
        col = bpy.data.collections.new(f'Prop_{key}')
        scene_col.children.link(col)
        objs = fn(col)
        size = export_glb(objs, os.path.join(GLB_DIR, f'{key}.glb'), image_quality=85)
        props_meta[key] = _meta(f'/assets/models/village/props/{key}.glb', objs, size)

    for key, m in props_meta.items():
        print(f"[props] {key}: {m['fileSizeBytes'] / 1024:.0f} KB, LOD0 tris {m['approxTriangles']}, lods {m.get('lods')}")

    # keys written by other builders of this agent (garden.glb, groundcover.glb) are kept
    for path in (META_OUT, META_PUBLIC):
        merged = {}
        if os.path.isfile(path):
            with open(path, 'r', encoding='utf-8') as fh:
                merged = json.load(fh)
        merged.update(props_meta)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(merged, fh, indent=2)

    # merge ONLY our prop keys into the shared village manifest
    with open(MANIFEST, 'r', encoding='utf-8') as fh:
        manifest = json.load(fh)
    manifest.setdefault('props', {}).update(props_meta)
    tmp = MANIFEST + '.props.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2)
    os.replace(tmp, MANIFEST)

    # the per-species tree GLBs of the previous pipeline are superseded by trees.glb
    for stale in ('tree_deciduous.glb', 'tree_orchard.glb'):
        p = os.path.join(GLB_DIR, stale)
        if os.path.isfile(p):
            os.remove(p)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f'[props] saved {BLEND_OUT}')


if __name__ == '__main__':
    main()
