#!/usr/bin/env python3
"""
estates_utils.py — modelling toolkit for the three "estate" hero landmarks
(weingut_estate, winzerhof_barn, agri_halle). Self-contained on purpose: it does NOT import
arch_utils.py (owned by another agent), so a half-finished edit there cannot break these builds.

Coordinate contract (same as arch_utils): Blender +X = East, +Y = North, +Z = up, metres.
glTF export is Y-up: Blender (x, y, z) -> three.js (x, z, -y). Model origin = footprint centre at
manifest baseElevationM; a foundation skirt reaches down to at least Z = -1.6 m.

Everything here fails loudly: a missing shared-library material, texture file or site record raises.
"""

from __future__ import annotations

import array
import json
import math
import random
from contextlib import contextmanager
from pathlib import Path

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector, noise
from mathutils.geometry import tessellate_polygon

LANDMARKS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = LANDMARKS_DIR.parent.parent
LIB_DIR = PROJECT_ROOT / "blender" / "shared_textures"
EXTRA_DIR = LIB_DIR / "_extra_estates"
OWN_TEX_DIR = LANDMARKS_DIR / "estates_textures"
GLB_OUT_DIR = PROJECT_ROOT / "public" / "assets" / "models" / "landmarks"
SCENE_JSON = PROJECT_ROOT / "data" / "osm" / "kindenheim_scene.json"
META_JSON = PROJECT_ROOT / "data" / "meta.json"
HEIGHTMAP_BIN = PROJECT_ROOT / "data" / "terrain" / "heightmap.bin"
OVERRIDES_JSON = LANDMARKS_DIR / "landmark_overrides.json"

PI = math.pi


# ---------------------------------------------------------------------------
# Scene / site helpers
# ---------------------------------------------------------------------------

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def load_override_params(key: str) -> dict:
    """Params for one landmark exactly as build_all.py would pass them (overrides win)."""
    with open(OVERRIDES_JSON, "r", encoding="utf-8") as f:
        ov = json.load(f)
    if key not in ov:
        raise RuntimeError(f"landmark_overrides.json has no entry '{key}'")
    return dict(ov[key].get("params", {}))


class Site:
    """Real-world placement of a landmark + terrain sampler (heights relative to the model origin)."""

    def __init__(self, key: str):
        with open(OVERRIDES_JSON, "r", encoding="utf-8") as f:
            ov = json.load(f)[key]
        with open(SCENE_JSON, "r", encoding="utf-8") as f:
            scene = json.load(f)
        rec = next((b for b in scene["buildings"] if str(b.get("id")) == str(ov["osmId"])), None)
        if rec is None:
            raise RuntimeError(f"Site({key}): OSM id {ov['osmId']} not found in {SCENE_JSON}")
        self.key = key
        self.cx, self.cz = float(rec["center"][0]), float(rec["center"][1])
        self.rot = float(rec["rotationRad"]) + float(ov.get("rotationOffsetRad", 0.0))
        self.base = float(rec["baseElevationM"])
        self.footprint_world = [(float(p[0]), float(p[1])) for p in rec["footprint"]]
        with open(META_JSON, "r", encoding="utf-8") as f:
            meta = json.load(f)
        self.n = int(meta["gridSize"])
        self.map = float(meta["mapSizeM"])
        raw = HEIGHTMAP_BIN.read_bytes()
        if len(raw) < self.n * self.n * 4:
            raise RuntimeError(f"heightmap.bin too small for gridSize {self.n}")
        self.h = array.array("f")
        self.h.frombytes(raw[: self.n * self.n * 4])

    def world(self, x: float, y: float) -> tuple[float, float]:
        cr, sr = math.cos(self.rot), math.sin(self.rot)
        lz = -y
        return self.cx + x * cr + lz * sr, self.cz - x * sr + lz * cr

    def local(self, wx: float, wz: float) -> tuple[float, float]:
        cr, sr = math.cos(self.rot), math.sin(self.rot)
        dx, dz = wx - self.cx, wz - self.cz
        return dx * cr - dz * sr, -(dx * sr + dz * cr)

    def footprint_local(self) -> list[tuple[float, float]]:
        return [self.local(x, z) for x, z in self.footprint_world]

    def _cell(self, wx: float, wz: float):
        n = self.n
        gx = min(max((wx + self.map * 0.5) / self.map, 0.0), 1.0) * (n - 1)
        gz = min(max((wz + self.map * 0.5) / self.map, 0.0), 1.0) * (n - 1)
        x0, z0 = min(int(gx), n - 2), min(int(gz), n - 2)
        tx, tz = gx - x0, gz - z0
        h = self.h
        return tx, tz, h[z0 * n + x0], h[z0 * n + x0 + 1], h[(z0 + 1) * n + x0], h[(z0 + 1) * n + x0 + 1]

    def terrain_z(self, x: float, y: float) -> float:
        """Terrain height (relative to model origin) at local (x, y): the upper envelope of the
        runtime's bilinear sample (tractor wheels) and the rendered triangle mesh (PlaneGeometry split)."""
        wx, wz = self.world(x, y)
        tx, tz, h00, h10, h01, h11 = self._cell(wx, wz)
        bil = (h00 + (h10 - h00) * tx) * (1 - tz) + (h01 + (h11 - h01) * tx) * tz
        if tx + tz <= 1.0:
            tri = h00 + (h10 - h00) * tx + (h01 - h00) * tz
        else:
            tri = h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz)
        return max(bil, tri) - self.base


# ---------------------------------------------------------------------------
# Materials (shared CC0 library, glTF metal/rough)
# ---------------------------------------------------------------------------

_LIB_CACHE: dict | None = None


def _library() -> dict:
    global _LIB_CACHE
    if _LIB_CACHE is None:
        lib_file = LIB_DIR / "library.json"
        if not lib_file.exists():
            raise RuntimeError(f"Shared texture library manifest missing: {lib_file}")
        with open(lib_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        _LIB_CACHE = {m["id"]: m for m in data["materials"]}
        extra = EXTRA_DIR / "library.json"
        if extra.exists():
            with open(extra, "r", encoding="utf-8") as f:
                for m in json.load(f)["materials"]:
                    _LIB_CACHE[m["id"]] = m
    return _LIB_CACHE


def library_has(mat_id: str) -> bool:
    return mat_id in _library()


def _lib_entry(mat_id: str) -> dict:
    lib = _library()
    if mat_id not in lib:
        raise RuntimeError(
            f"Shared texture library has no material '{mat_id}' yet. Available: {sorted(lib.keys())}"
        )
    return lib[mat_id]


def _load_image(path: Path, colorspace: str):
    if not path.exists():
        raise RuntimeError(f"Texture file missing: {path}")
    name = path.stem  # library basename == Blender image name (runtime texture de-duplication key)
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.load(str(path), check_existing=True)
        img.name = name
    img.colorspace_settings.name = colorspace
    return img


def _gltf_output_group():
    name = "glTF Material Output"
    grp = bpy.data.node_groups.get(name)
    if grp is None:
        grp = bpy.data.node_groups.new(name, "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        grp.nodes.new("NodeGroupInput")
    return grp


class MatSpec:
    """
    lib:      shared-library material id (None = flat colour material)
    tint:     base-colour factor multiplied onto the albedo (colour variants without new textures)
    res:      (albedo, normal, orm) resolution: '2k' or '1k'
    tile:     optional UV tile-size multiplier (1.0 = real-world size from library.json)
    color/rough/metal: flat materials only
    emissive: (r, g, b, strength)
    grime:    vertex-colour weathering mode applied at finalize: None | 'wall' | 'roof' | 'ground' | 'metal'
    rot_uv:   swap U/V (texture rotated 90 deg), e.g. horizontal corrugation on silos
    into:     key of an untinted base MatSpec to merge this variant into: its tint / colour is written
              to the vertex colours instead, so all variants of one texture share ONE mesh and draw call
    """

    def __init__(self, name, lib=None, tint=(1.0, 1.0, 1.0), res=("1k", "1k", "1k"), tile=1.0,
                 normal=1.0, color=(0.5, 0.5, 0.5), rough=0.7, metal=0.0, emissive=None,
                 double=False, grime=None, rot_uv=False, own_albedo=None, orm_tiny=None, into=None,
                 alpha_clip=False, alpha_blend=False, lit_cards=False):
        self.name = name
        # lit_cards: foliage cards are emitted as TWO single-sided quads (front + back) that both carry an
        # upward-leaning custom normal, so a card seen from below or edge-on is lit like a translucent leaf
        # (a double-sided material flips the normal of back faces away from the sun -> black undersides)
        self.lit_cards = lit_cards
        if lit_cards and double:
            raise RuntimeError(f"MatSpec {name}: lit_cards needs a single-sided material (double=False)")
        self.into = into
        self.alpha_clip = alpha_clip      # own_albedo with an alpha channel -> glTF alphaMode MASK (leaf cards)
        self.alpha_blend = alpha_blend    # own_albedo alpha -> glTF alphaMode BLEND (lamp glow cards)
        self.lib = lib
        self.tint = tint
        self.res = res
        self.normal = normal
        self.color = color
        self.rough = rough
        self.metal = metal
        self.emissive = emissive
        self.double = double
        self.grime = grime
        self.rot_uv = rot_uv
        self.own_albedo = own_albedo      # Path to a unique atlas (signs) – UVs are 0..1
        self.orm_tiny = orm_tiny          # Path to a tiny constant ORM image (keeps very smooth glass smooth)
        if lib is not None:
            ts = _lib_entry(lib)["tileSizeM"]
            self.tile = (float(ts[0]) * tile, float(ts[1]) * tile)
        else:
            self.tile = (1.0, 1.0)


def _lib_file(entry: dict, kind: str, res: str) -> Path:
    key = kind if res == "2k" else f"{kind}_1k"
    files = entry["files"]
    if key not in files:
        raise RuntimeError(f"Library material '{entry['id']}' has no file '{key}'")
    p = Path(files[key])
    return p if p.is_absolute() else PROJECT_ROOT / p


def lib_file(mat_id: str, kind: str, res: str = "1k") -> Path:
    """Path of one unchanged library file (e.g. as an own_albedo that keeps its library image name)."""
    return _lib_file(_lib_entry(mat_id), kind, res)


def build_material(spec: MatSpec):
    mat = bpy.data.materials.new(name=spec.name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (260, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.use_backface_culling = not spec.double

    def tinted(tex_node):
        if tuple(spec.tint) == (1.0, 1.0, 1.0):
            nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
            return
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.location = (20, 260)
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (spec.tint[0], spec.tint[1], spec.tint[2], 1.0)
        nt.links.new(tex_node.outputs["Color"], mix.inputs[6])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])

    if spec.lib is not None:
        entry = _lib_entry(spec.lib)
        tex_a = nt.nodes.new("ShaderNodeTexImage")
        tex_a.location = (-420, 300)
        tex_a.image = _load_image(_lib_file(entry, "albedo", spec.res[0]), "sRGB")
        tinted(tex_a)

        tex_o = nt.nodes.new("ShaderNodeTexImage")
        tex_o.location = (-420, 0)
        tex_o.image = _load_image(_lib_file(entry, "orm", spec.res[2]), "Non-Color")
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-120, 0)
        nt.links.new(tex_o.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        grp = nt.nodes.new("ShaderNodeGroup")
        grp.node_tree = _gltf_output_group()
        grp.location = (260, -420)
        nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])

        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-420, -320)
        tex_n.image = _load_image(_lib_file(entry, "normal", spec.res[1]), "Non-Color")
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-120, -320)
        nmap.inputs["Strength"].default_value = spec.normal
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    elif spec.own_albedo is not None:
        tex_a = nt.nodes.new("ShaderNodeTexImage")
        tex_a.location = (-420, 300)
        tex_a.image = _load_image(Path(spec.own_albedo), "sRGB")
        tinted(tex_a)
        bsdf.inputs["Roughness"].default_value = spec.rough
        bsdf.inputs["Metallic"].default_value = spec.metal
        if spec.alpha_clip:
            # Math(ROUND) on the texture alpha is what the glTF exporter turns into alphaMode MASK (cutoff 0.5)
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            rnd.location = (20, 120)
            nt.links.new(tex_a.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs["Value"], bsdf.inputs["Alpha"])
            mat.alpha_threshold = 0.5
        elif spec.alpha_blend:
            # texture alpha x vertex-colour alpha -> glTF alphaMode BLEND (COLOR_0.a scales each card)
            nt.links.new(tex_a.outputs["Alpha"], bsdf.inputs["Alpha"])
            if hasattr(mat, "surface_render_method"):
                mat.surface_render_method = "BLENDED"
    else:
        bsdf.inputs["Base Color"].default_value = (spec.color[0], spec.color[1], spec.color[2], 1.0)
        bsdf.inputs["Roughness"].default_value = spec.rough
        bsdf.inputs["Metallic"].default_value = spec.metal
        if spec.orm_tiny is not None:
            tex_o = nt.nodes.new("ShaderNodeTexImage")
            tex_o.location = (-420, 0)
            tex_o.image = _load_image(Path(spec.orm_tiny), "Non-Color")
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            sep.location = (-120, 0)
            nt.links.new(tex_o.outputs["Color"], sep.inputs["Color"])
            nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
            nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    if spec.emissive is not None:
        r, g, b_, strength = spec.emissive
        bsdf.inputs["Emission Color"].default_value = (r, g, b_, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


# ---------------------------------------------------------------------------
# Geometry builder
# ---------------------------------------------------------------------------

def _poly_area(pts) -> float:
    n = len(pts)
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))


def ccw(pts):
    pts = list(pts)
    return pts if _poly_area(pts) > 0 else list(reversed(pts))


def arc_pts(cx, cz, rx, rz, a0, a1, n):
    """Ellipse arc points (x, z) from angle a0 to a1 (radians), n segments."""
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cz + rz * math.sin(a0 + (a1 - a0) * i / n))
            for i in range(n + 1)]


# NOTE: all flat MatSpec colours, tints and vertex colours are LINEAR values (glTF baseColorFactor /
# COLOR_0), not sRGB: linear 0.05 is already a mid-dark sRGB 63.

_FOLIAGE: dict | None = None


def foliage_rect(name: str) -> tuple[float, float, float, float]:
    """(u0, v0, u1, v1) of a tile in the estates foliage atlas (written by estates_textures.py)."""
    global _FOLIAGE
    if _FOLIAGE is None:
        meta = OWN_TEX_DIR / "estates_foliage.json"
        if not meta.exists():
            raise RuntimeError(f"{meta} missing – run: python3 blender/landmarks/estates_textures.py")
        with open(meta, "r", encoding="utf-8") as f:
            _FOLIAGE = json.load(f)["tiles"]
    if name not in _FOLIAGE:
        raise RuntimeError(f"foliage atlas has no tile '{name}' (have {sorted(_FOLIAGE)})")
    return tuple(_FOLIAGE[name])


# Lamp panes: dark by day, lit at dusk. The runtime (src/buildings.ts) multiplies the authored emissive of
# materials named Lamp/Emissive by (1 + 7 * nightFactor): 0.5 -> 4.0 (HDR, blooms) at night.
LAMP_GLASS = (0.20, 0.17, 0.12)
LAMP_EMISSIVE = (1.0, 0.78, 0.45, 0.5)

GRIME_MODES = (None, "wall", "roof", "ground", "metal", "concrete")


class Builder:
    def __init__(self, prefix: str, specs: dict[str, MatSpec], seed: int = 7):
        self.prefix = prefix
        self.specs = specs
        for key, sp in specs.items():
            if sp.grime not in GRIME_MODES:
                raise RuntimeError(f"material '{key}': unknown grime mode '{sp.grime}'")
            if sp.into is None:
                continue
            if sp.into not in specs:
                raise RuntimeError(f"material '{key}' merges into unknown key '{sp.into}'")
            base = specs[sp.into]
            if base.into is not None or base.lib != sp.lib or base.res != sp.res or base.tile != sp.tile:
                raise RuntimeError(f"material '{key}' cannot merge into '{sp.into}': library id / resolution differ")
            white = tuple(base.tint) == (1.0, 1.0, 1.0) if base.lib else tuple(base.color) == (1.0, 1.0, 1.0)
            if not white:
                raise RuntimeError(f"merge base '{sp.into}' must be untinted (white) – tints live in the vertex colours")
        self.bms: dict[str, bmesh.types.BMesh] = {}
        self.stack = [Matrix.Identity(4)]
        self.rng = random.Random(seed)
        self.tri_estimate = 0
        self.colored: set[str] = set()   # material keys that received explicit vertex colours

    # -- transform stack ----------------------------------------------------
    @property
    def M(self) -> Matrix:
        return self.stack[-1]

    @contextmanager
    def at(self, m: Matrix):
        self.stack.append(self.M @ m)
        try:
            yield
        finally:
            self.stack.pop()

    def place(self, x=0.0, y=0.0, z=0.0, rz=0.0, rx=0.0, ry=0.0):
        return self.at(Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), "XYZ").to_matrix().to_4x4())

    # -- low-level emit -----------------------------------------------------
    def _bm(self, key: str):
        bm = self.bms.get(key)
        if bm is None:
            bm = bmesh.new()
            bm.loops.layers.uv.new("UVMap")
            bm.loops.layers.float_color.new("Color")
            bm.faces.layers.int.new("grime")
            self.bms[key] = bm
        return bm

    def mesh(self, key, verts, faces, uvs, smooth=False, color=None, normals=None):
        """verts: list of 3D points (current local frame); faces: index lists (CCW seen from outside);
        uvs: per-face list of per-corner (u, v) in METRES (divided by the material's tile size here).
        normals: optional per-face custom normal (local frame) exported as the split normal of every corner."""
        if key not in self.specs:
            raise KeyError(f"Builder: unknown material key '{key}' (have {sorted(self.specs)})")
        src = self.specs[key]
        if src.into is not None:
            # merged variant: its tint / flat colour becomes a vertex-colour multiplier on the base material
            mult = src.tint if src.lib else src.color
            base_c = (1.0, 1.0, 1.0) if color is None else color
            color = (base_c[0] * mult[0], base_c[1] * mult[1], base_c[2] * mult[2], base_c[3] if len(base_c) > 3 else 1.0)
            key = src.into
        bm = self._bm(key)
        spec = self.specs[key]
        uv_layer = bm.loops.layers.uv.active
        col_layer = bm.loops.layers.float_color.active
        grime_layer = bm.faces.layers.int["grime"]
        grime_idx = GRIME_MODES.index(src.grime)
        tu, tv = spec.tile
        M = self.M
        mirrored = M.determinant() < 0.0     # mirrored frames flip the winding back
        bverts = [bm.verts.new(M @ Vector(v)) for v in verts]
        nrm_layer = None
        if normals is not None:
            if len(normals) != len(faces):
                raise RuntimeError(f"Builder.mesh({key}): {len(normals)} normals for {len(faces)} faces")
            nrm_layer = bm.loops.layers.float_vector.get("cnrm") or bm.loops.layers.float_vector.new("cnrm")
            n_mat = M.to_3x3().inverted_safe().transposed()
        col = (1.0, 1.0, 1.0, 1.0) if color is None else (color[0], color[1], color[2], color[3] if len(color) > 3 else 1.0)
        if color is not None:
            self.colored.add(key)
        for fi, idx in enumerate(faces):
            if len(set(idx)) < 3:
                continue
            fuv = uvs[fi]
            if mirrored:
                idx = list(reversed(idx))
                fuv = list(reversed(fuv))
            try:
                f = bm.faces.new([bverts[i] for i in idx])
            except ValueError:
                continue
            f.smooth = smooth
            f[grime_layer] = grime_idx
            cn = (n_mat @ Vector(normals[fi])).normalized() if nrm_layer is not None else None
            for li, loop in enumerate(f.loops):
                u, v = fuv[li]
                if spec.rot_uv:
                    u, v = v, u
                loop[uv_layer].uv = (u / tu, v / tv)
                loop[col_layer] = col
                if cn is not None:
                    loop[nrm_layer] = cn
            self.tri_estimate += len(idx) - 2

    def face(self, key, pts, uvs=None, smooth=False, color=None):
        """Single polygon; uvs in metres (default: planar projection onto the face's own plane)."""
        if uvs is None:
            p0 = Vector(pts[0])
            ex = (Vector(pts[1]) - p0).normalized()
            nrm = Vector((0, 0, 0))
            for i in range(1, len(pts) - 1):
                nrm += (Vector(pts[i]) - p0).cross(Vector(pts[i + 1]) - p0)
            ey = nrm.normalized().cross(ex)
            uvs = [((Vector(p) - p0).dot(ex), (Vector(p) - p0).dot(ey)) for p in pts]
        self.mesh(key, pts, [list(range(len(pts)))], [uvs], smooth=smooth, color=color)

    def floor(self, key, x0, x1, y0, y1, z, cell=1.6, color=None):
        """Horizontal upward-facing slab top, subdivided so vertex-colour weathering can vary."""
        nx = max(1, int(math.ceil((x1 - x0) / cell)))
        ny = max(1, int(math.ceil((y1 - y0) / cell)))
        verts = [(x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, z) for j in range(ny + 1) for i in range(nx + 1)]
        faces, uvs = [], []
        for j in range(ny):
            for i in range(nx):
                q = [j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i]
                faces.append(q)
                uvs.append([(verts[k][0], verts[k][1]) for k in q])
        self.mesh(key, verts, faces, uvs, color=color)

    def card(self, key, tile, origin, right, up, w, h, anchor=(0.5, 0.0), flip=False, color=None, normal=None,
             facing=None):
        """Alpha-masked quad from the foliage atlas. `origin` is the anchor point (anchor = fraction of
        width / height), the quad spans `right` * w and `up` * h.
        For a `lit_cards` material the card is emitted front + back with one shared custom normal: `normal` if
        given, else the card plane's normal oriented to `facing` (or upward) and leaned 55 % toward the sky."""
        u0, v0, u1, v1 = foliage_rect(tile)
        if flip:
            u0, u1 = u1, u0
        o = Vector(origin)
        r = Vector(right).normalized() * w
        u = Vector(up).normalized() * h
        p0 = o - r * anchor[0] - u * anchor[1]
        quad = [p0, p0 + r, p0 + r + u, p0 + u]
        uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        spec = self.specs[key]
        if not spec.lit_cards:
            if normal is not None or facing is not None:
                raise RuntimeError(f"Builder.card({key}): normal / facing need a lit_cards material")
            self.mesh(key, quad, [[0, 1, 2, 3]], [uv], color=color)
            return
        if normal is None:
            fn = r.cross(u).normalized()
            ref = Vector(facing) if facing is not None else Vector((0.0, 0.0, 1.0))
            if fn.dot(ref) < 0.0:
                fn = -fn
            normal = (fn * 0.45 + Vector((0.0, 0.0, 0.55))).normalized()
        # separate vertices for the back face: BMesh refuses a second face on the same four vertices
        n_before = len(self._bm(key).faces)
        self.mesh(key, quad, [[0, 1, 2, 3]], [uv], color=color, normals=[normal])
        self.mesh(key, quad, [[3, 2, 1, 0]], [list(reversed(uv))], color=color, normals=[normal])
        if len(self._bm(key).faces) != n_before + 2:
            raise RuntimeError(f"Builder.card({key}, {tile}): degenerate card, front/back faces not created")

    # -- boxes & beams ------------------------------------------------------
    def box(self, key, x0, x1, y0, y1, z0, z1, uv="box", skip=(), color=None, uv_rand=True):
        """Axis-aligned box in the current frame. uv: 'box' (metric planar), 'long' (V along longest
        axis – wood grain / boards), 'longu' (U along longest axis), 'fit' (each face 0..1 in metres=1)."""
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if z1 < z0:
            z0, z1 = z1, z0
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        # face -> (indices CCW from outside, in-plane axes (a, b))
        defs = {
            "-y": ([0, 1, 5, 4], (0, 2)), "+y": ([2, 3, 7, 6], (0, 2)),
            "-x": ([3, 0, 4, 7], (1, 2)), "+x": ([1, 2, 6, 5], (1, 2)),
            "-z": ([3, 2, 1, 0], (0, 1)), "+z": ([4, 5, 6, 7], (0, 1)),
        }
        size = (x1 - x0, y1 - y0, z1 - z0)
        longest = max(range(3), key=lambda i: size[i])
        ou, ov = (self.rng.uniform(0, 5.0), self.rng.uniform(0, 5.0)) if uv_rand else (0.0, 0.0)
        faces, uvs = [], []
        for name, (idx, (a, b_)) in defs.items():
            if name in skip:
                continue
            faces.append(idx)
            fuv = []
            for i in idx:
                p = v[i]
                if uv == "fit":
                    lo = (x0, y0, z0)
                    fuv.append(((p[a] - lo[a]) / max(size[a], 1e-6), (p[b_] - lo[b_]) / max(size[b_], 1e-6)))
                elif uv in ("long", "longu") and longest in (a, b_):
                    other = b_ if longest == a else a
                    if uv == "long":
                        fuv.append((p[other] + ou, p[longest] + ov))
                    else:
                        fuv.append((p[longest] + ou, p[other] + ov))
                else:
                    fuv.append((p[a] + ou, p[b_] + ov))
            uvs.append(fuv)
        self.mesh(key, v, faces, uvs, color=color)

    def cbox(self, key, cx, cy, cz, sx, sy, sz, **kw):
        self.box(key, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, **kw)

    def beam(self, key, p0, p1, width, depth, normal=(0.0, -1.0, 0.0), uv="long", extend=0.0, color=None):
        """Box running from p0 to p1. 'depth' is measured along `normal`, 'width' across."""
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        length = axis.length
        if length < 1e-5:
            return
        ax = axis / length
        nrm = Vector(normal).normalized()
        side = nrm.cross(ax)
        if side.length < 1e-5:
            side = ax.orthogonal()
        side.normalize()
        nrm = ax.cross(side).normalized()
        m = Matrix((
            (side.x, nrm.x, ax.x, p0.x),
            (side.y, nrm.y, ax.y, p0.y),
            (side.z, nrm.z, ax.z, p0.z),
            (0, 0, 0, 1),
        ))
        with self.at(m):
            self.box(key, -width / 2, width / 2, -depth / 2, depth / 2, -extend, length + extend, uv=uv, color=color)

    # -- round things -------------------------------------------------------
    def cyl(self, key, p0, p1, r0, r1=None, seg=12, caps=(True, True), smooth=True, color=None):
        p0, p1 = Vector(p0), Vector(p1)
        r1 = r0 if r1 is None else r1
        axis = p1 - p0
        length = axis.length
        if length < 1e-6:
            return
        ax = axis / length
        s = ax.orthogonal().normalized()
        t = ax.cross(s).normalized()
        verts, faces, uvs = [], [], []
        circ = 2 * PI * max(r0, r1)
        for ring, (p, r) in enumerate(((p0, r0), (p1, r1))):
            for i in range(seg):
                a = 2 * PI * i / seg
                verts.append(p + (s * math.cos(a) + t * math.sin(a)) * r)
        for i in range(seg):
            j = (i + 1) % seg
            faces.append([i, j, seg + j, seg + i])
            u0, u1 = circ * i / seg, circ * (i + 1) / seg
            uvs.append([(u0, 0.0), (u1, 0.0), (u1, length), (u0, length)])
        self.mesh(key, verts, faces, uvs, smooth=smooth, color=color)
        for ci, (p, r, on) in enumerate(((p0, r0, caps[0]), (p1, r1, caps[1]))):
            if not on or r < 1e-5:
                continue
            ring = [p + (s * math.cos(2 * PI * i / seg) + t * math.sin(2 * PI * i / seg)) * r for i in range(seg)]
            uv = [(r * math.cos(2 * PI * i / seg), r * math.sin(2 * PI * i / seg)) for i in range(seg)]
            if ci == 0:
                ring.reverse()
                uv.reverse()
            self.mesh(key, ring, [list(range(seg))], [uv], color=color)

    def tube(self, key, pts, r, seg=8, caps=True, color=None):
        """Round pipe along a polyline with mitred bends (downpipes, handrails, augers)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        if n < 2:
            return
        tangents = []
        for i in range(n):
            if i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i] - pts[i - 1]).normalized() + (pts[i + 1] - pts[i]).normalized()
            tangents.append(t.normalized())
        s = tangents[0].orthogonal().normalized()
        verts, faces, uvs = [], [], []
        dist = 0.0
        dists = []
        circ = 2 * PI * r
        for i in range(n):
            t = tangents[i]
            s = (s - t * s.dot(t))
            if s.length < 1e-6:
                s = t.orthogonal()
            s.normalize()
            w = t.cross(s).normalized()
            if i > 0:
                dist += (pts[i] - pts[i - 1]).length
            dists.append(dist)
            for j in range(seg):
                a = 2 * PI * j / seg
                verts.append(pts[i] + (s * math.cos(a) + w * math.sin(a)) * r)
        for i in range(n - 1):
            for j in range(seg):
                j2 = (j + 1) % seg
                a, b_, c, d = i * seg + j, i * seg + j2, (i + 1) * seg + j2, (i + 1) * seg + j
                faces.append([a, b_, c, d])
                u0, u1 = circ * j / seg, circ * (j + 1) / seg
                uvs.append([(u0, dists[i]), (u1, dists[i]), (u1, dists[i + 1]), (u0, dists[i + 1])])
        self.mesh(key, verts, faces, uvs, smooth=True, color=color)
        if caps:
            for end in (0, n - 1):
                ring = [verts[end * seg + j] for j in range(seg)]
                if end == 0:
                    ring.reverse()
                self.mesh(key, ring, [list(range(seg))], [[(0.0, 0.0)] * seg], color=color)

    def lathe(self, key, profile, seg=16, smooth=True, cap_bottom=True, cap_top=True, color=None, sharp=()):
        """Revolve profile [(r, z), ...] (bottom -> top, outside surface) around local Z."""
        rmax = max(p[0] for p in profile)
        circ = 2 * PI * rmax
        segs_v = [0.0]
        for i in range(1, len(profile)):
            segs_v.append(segs_v[-1] + math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]))
        # split into smooth groups at 'sharp' profile indices
        breaks = [0] + sorted(i for i in sharp if 0 < i < len(profile) - 1) + [len(profile) - 1]
        for bi in range(len(breaks) - 1):
            lo, hi = breaks[bi], breaks[bi + 1]
            verts, faces, uvs = [], [], []
            for k in range(lo, hi + 1):
                r, z = profile[k]
                for i in range(seg):
                    a = 2 * PI * i / seg
                    verts.append((r * math.cos(a), r * math.sin(a), z))
            rows = hi - lo
            for k in range(rows):
                for i in range(seg):
                    j = (i + 1) % seg
                    faces.append([k * seg + i, k * seg + j, (k + 1) * seg + j, (k + 1) * seg + i])
                    u0, u1 = circ * i / seg, circ * (i + 1) / seg
                    uvs.append([(u0, segs_v[lo + k]), (u1, segs_v[lo + k]), (u1, segs_v[lo + k + 1]), (u0, segs_v[lo + k + 1])])
            self.mesh(key, verts, faces, uvs, smooth=smooth, color=color)
        for on, (r, z), flip in ((cap_bottom, profile[0], True), (cap_top, profile[-1], False)):
            if not on or r < 1e-5:
                continue
            ring = [(r * math.cos(2 * PI * i / seg), r * math.sin(2 * PI * i / seg), z) for i in range(seg)]
            uv = [(p[0], p[1]) for p in ring]
            if flip:
                ring.reverse()
                uv.reverse()
            self.mesh(key, ring, [list(range(seg))], [uv], color=color)

    # -- prisms & sweeps ----------------------------------------------------
    def prism_xy(self, key, pts, z0, z1, caps=(True, True), color=None, side_key=None):
        """Vertical extrusion of a 2D polygon (x, y)."""
        pts = ccw(pts)
        n = len(pts)
        bot = [(p[0], p[1], z0) for p in pts]
        top = [(p[0], p[1], z1) for p in pts]
        per = [0.0]
        for i in range(n):
            j = (i + 1) % n
            per.append(per[-1] + math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]))
        faces, uvs = [], []
        for i in range(n):
            j = (i + 1) % n
            faces.append([i, j, n + j, n + i])
            uvs.append([(per[i], z0), (per[i + 1], z0), (per[i + 1], z1), (per[i], z1)])
        self.mesh(side_key or key, bot + top, faces, uvs, color=color)
        if caps[1]:
            self.mesh(key, top, [list(range(n))], [[(p[0], p[1]) for p in pts]], color=color)
        if caps[0]:
            self.mesh(key, list(reversed(bot)), [list(range(n))], [[(p[0], p[1]) for p in reversed(pts)]], color=color)

    def prism_xz(self, key, pts, y0, y1, caps=(True, True), color=None, side_key=None, sides=True):
        """Polygon (x, z) in the facade plane, extruded along +Y from y0 (front, faces -Y) to y1."""
        pts = ccw(pts)
        n = len(pts)
        fr = [(p[0], y0, p[1]) for p in pts]
        bk = [(p[0], y1, p[1]) for p in pts]
        per = [0.0]
        for i in range(n):
            j = (i + 1) % n
            per.append(per[-1] + math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]))
        if sides:
            faces, uvs = [], []
            for i in range(n):
                j = (i + 1) % n
                faces.append([j, i, n + i, n + j])
                uvs.append([(per[i + 1], y0), (per[i], y0), (per[i], y1), (per[i + 1], y1)])
            self.mesh(side_key or key, fr + bk, faces, uvs, color=color)
        if caps[0]:
            self.mesh(key, fr, [list(range(n))], [[(p[0], p[1]) for p in pts]], color=color)
        if caps[1]:
            self.mesh(key, list(reversed(bk)), [list(range(n))], [[(p[0], p[1]) for p in reversed(pts)]], color=color)

    def sweep(self, key, profile, pts, sides, ups, closed=True, caps=True, smooth=False, color=None):
        """Sweep a 2D profile [(a, b)] along a path. At path point k the profile point lands at
        P_k + a * sides[k] + b * ups[k]. Profile is CCW when looking along the path direction with
        `side` to the right and `up` up (outside surface)."""
        pts = [Vector(p) for p in pts]
        sides = [Vector(s) for s in sides]
        ups = [Vector(u) for u in ups]
        if closed:
            profile = ccw(profile)
        n, m = len(pts), len(profile)
        if n < 2:
            return
        t0 = (pts[1] - pts[0]).normalized()
        flip = sides[0].cross(ups[0]).dot(t0) > 0
        verts = []
        dist = [0.0]
        for k in range(n):
            if k > 0:
                dist.append(dist[-1] + (pts[k] - pts[k - 1]).length)
            for a, b_ in profile:
                verts.append(pts[k] + sides[k] * a + ups[k] * b_)
        plen = [0.0]
        for i in range(1, m + 1):
            p, q = profile[i - 1], profile[i % m]
            plen.append(plen[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
        faces, uvs = [], []
        edges = m if closed else m - 1
        for k in range(n - 1):
            for i in range(edges):
                j = (i + 1) % m
                quad = [k * m + j, k * m + i, (k + 1) * m + i, (k + 1) * m + j]
                uv = [(dist[k], plen[i + 1]), (dist[k], plen[i]), (dist[k + 1], plen[i]), (dist[k + 1], plen[i + 1])]
                if flip:
                    quad.reverse()
                    uv.reverse()
                faces.append(quad)
                uvs.append(uv)
        self.mesh(key, verts, faces, uvs, smooth=smooth, color=color)
        if caps and closed:
            start = [verts[i] for i in range(m)]
            end = [verts[(n - 1) * m + i] for i in range(m)]
            uv = [(p[0], p[1]) for p in profile]
            if flip:
                self.mesh(key, list(reversed(start)), [list(range(m))], [list(reversed(uv))], color=color)
                self.mesh(key, end, [list(range(m))], [uv], color=color)
            else:
                self.mesh(key, start, [list(range(m))], [uv], color=color)
                self.mesh(key, list(reversed(end)), [list(range(m))], [list(reversed(uv))], color=color)

    def sweep_h(self, key, profile, path, closed_path=False, **kw):
        """Sweep along a horizontal polyline [(x, y, z)]; profile a = to the RIGHT of travel, b = up.
        Corners are mitred. For a building outline walked counter-clockwise, right = outside."""
        pts = [Vector(p) for p in path]
        n = len(pts)
        if closed_path:
            pts = pts + [pts[0]]
        sides = []
        cnt = len(pts)
        for k in range(cnt):
            if closed_path:
                d_in = (pts[k] - pts[(k - 1) % n]).normalized() if k > 0 else (pts[0] - pts[n - 1]).normalized()
                d_out = (pts[(k + 1) % n] - pts[k % n]).normalized() if k < cnt - 1 else (pts[1] - pts[0]).normalized()
            else:
                d_in = (pts[k] - pts[k - 1]).normalized() if k > 0 else (pts[1] - pts[0]).normalized()
                d_out = (pts[k + 1] - pts[k]).normalized() if k < cnt - 1 else d_in
            r_in = Vector((d_in.y, -d_in.x, 0.0))
            r_out = Vector((d_out.y, -d_out.x, 0.0))
            bis = r_in + r_out
            if bis.length < 1e-6:
                bis = r_in
            bis.normalize()
            scale = 1.0 / max(0.25, bis.dot(r_in))
            sides.append(bis * scale)
        ups = [Vector((0, 0, 1))] * cnt
        self.sweep(key, profile, pts, sides, ups, **kw)

    def sweep_arc(self, key, profile, cx, cz, rx, rz, a0=0.0, a1=PI, n=16, y=0.0, **kw):
        """Sweep along an ellipse arc in the facade (x, z) plane at depth y, from angle a0 to a1
        (counter-clockwise seen from the front). Profile a = radially outward, b = out of the wall (-Y)."""
        pts, sides = [], []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            pts.append(Vector((cx + rx * math.cos(a), y, cz + rz * math.sin(a))))
            nrm = Vector((math.cos(a) / max(rx, 1e-6), 0.0, math.sin(a) / max(rz, 1e-6))).normalized()
            sides.append(nrm)
        ups = [Vector((0, -1, 0))] * (n + 1)
        self.sweep(key, profile, pts, sides, ups, **kw)

    # -- terrain-draped ground slab (aprons outside the collision footprint) -
    def drape(self, key, site: Site, x0, x1, y0, y1, cell=0.5, offset=0.06, skirt=0.35, color=None):
        nx = max(1, int(math.ceil((x1 - x0) / cell)))
        ny = max(1, int(math.ceil((y1 - y0) / cell)))
        verts, faces, uvs = [], [], []
        for j in range(ny + 1):
            for i in range(nx + 1):
                x = x0 + (x1 - x0) * i / nx
                y = y0 + (y1 - y0) * j / ny
                verts.append((x, y, site.terrain_z(x, y) + offset))
        def vid(i, j):
            return j * (nx + 1) + i
        for j in range(ny):
            for i in range(nx):
                a, b_, c, d = vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)
                for tri in ([a, b_, c], [a, c, d]):
                    faces.append(tri)
                    uvs.append([(verts[t][0], verts[t][1]) for t in tri])
        self.mesh(key, verts, faces, uvs, color=color)
        # perimeter skirt so the slab edge never floats
        border = ([vid(i, 0) for i in range(nx + 1)] + [vid(nx, j) for j in range(1, ny + 1)]
                  + [vid(i, ny) for i in range(nx - 1, -1, -1)] + [vid(0, j) for j in range(ny - 1, 0, -1)])
        for k in range(len(border)):
            p, q = verts[border[k]], verts[border[(k + 1) % len(border)]]
            self.face(key, [p, q, (q[0], q[1], q[2] - skirt), (p[0], p[1], p[2] - skirt)], color=color)

    # -- finalize -----------------------------------------------------------
    def finalize(self, collection, ground_z: float = 0.0):
        objects = []
        for key, bm in self.bms.items():
            if len(bm.faces) == 0:
                bm.free()
                continue
            spec = self.specs[key]
            grimed = _apply_grime(bm, ground_z)
            bm.faces.layers.int.remove(bm.faces.layers.int["grime"])
            keep_color = grimed or key in self.colored
            if not keep_color:
                # all-white vertex colours would only cost 8 bytes per vertex in the GLB
                bm.loops.layers.float_color.remove(bm.loops.layers.float_color.active)
            mesh = bpy.data.meshes.new(f"{self.prefix}_{key}")
            has_cnrm = bm.loops.layers.float_vector.get("cnrm") is not None
            bm.to_mesh(mesh)
            bm.free()
            mesh.update()
            if has_cnrm:
                _apply_custom_normals(mesh, "cnrm")
            if keep_color:
                attr = mesh.color_attributes.get("Color")
                if attr is None:
                    raise RuntimeError(f"{self.prefix}_{key}: vertex colour layer missing after to_mesh")
                mesh.color_attributes.active_color = attr
                mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(attr)
            obj = bpy.data.objects.new(f"{self.prefix}_{key}", mesh)
            obj.data.materials.append(build_material(spec))
            collection.objects.link(obj)
            objects.append(obj)
        self.bms = {}
        return objects


def _apply_custom_normals(mesh, attr_name: str):
    """Turn a per-corner FLOAT_VECTOR attribute into custom split normals (zero vectors keep the automatic
    normal of that corner) and drop the attribute."""
    attr = mesh.attributes.get(attr_name)
    if attr is None or attr.domain != "CORNER" or attr.data_type != "FLOAT_VECTOR":
        raise RuntimeError(f"{mesh.name}: custom-normal attribute '{attr_name}' missing or not a corner vector")
    vals = [tuple(d.vector) for d in attr.data]
    if len(vals) != len(mesh.loops):
        raise RuntimeError(f"{mesh.name}: {len(vals)} custom normals for {len(mesh.loops)} corners")
    n_set = sum(1 for v in vals if v != (0.0, 0.0, 0.0))
    mesh.attributes.remove(attr)
    mesh.normals_split_custom_set(vals)
    if n_set == 0:
        raise RuntimeError(f"{mesh.name}: custom-normal layer present but no corner carries a normal")


def _apply_grime(bm, ground_z: float) -> bool:
    """Vertex-colour weathering (multiplied onto the albedo by glTF COLOR_0): breaks up texture tiling
    and grounds the buildings (splash-zone darkening at the base, mottled roofs, stained aprons).
    The mode is stored per face (several material variants can share one mesh). Returns True if used."""
    col = bm.loops.layers.float_color.active
    layer = bm.faces.layers.int["grime"]
    dirt = Vector((0.62, 0.56, 0.47))
    used = False
    bm.normal_update()
    for f in bm.faces:
        mode = GRIME_MODES[f[layer]]
        if mode is None:
            continue
        used = True
        nz = f.normal.z
        for loop in f.loops:
            co = loop.vert.co
            n1 = noise.noise(Vector((co.x * 0.21, co.y * 0.21, co.z * 0.33)))            # -1..1 low frequency
            n2 = noise.noise(Vector((co.x * 0.9 + 17.0, co.y * 0.9 - 5.0, co.z * 1.3)))  # mid frequency
            if mode == "wall":
                h = co.z - ground_z
                k = 0.42 * math.exp(-max(h, 0.0) / 0.55) + 0.10 * math.exp(-max(h, 0.0) / 2.2)
                if h < 0.0:
                    k = 0.30
                k += 0.07 * n1 + 0.04 * n2
            elif mode == "roof":
                k = 0.10 + 0.16 * n1 + 0.07 * n2
            elif mode == "ground":
                k = 0.08 + 0.14 * n1 + 0.08 * n2
            elif mode == "metal":
                h = co.z - ground_z
                k = 0.14 * math.exp(-max(h, 0.0) / 0.9) + 0.06 * n1 + 0.03 * n2
            elif mode == "concrete":      # cast concrete: only faint large-scale mottling, no splash band
                k = 0.06 + 0.07 * n1 + 0.03 * n2
            else:
                raise RuntimeError(f"unknown grime mode '{mode}'")
            if nz < -0.5 and mode == "wall":
                k += 0.12  # undersides (soffits, lintels) sit in permanent shade
            k = min(max(k, 0.0), 0.75)
            base = Vector(loop[col][:3])
            c = base.lerp(Vector((base.x * dirt.x, base.y * dirt.y, base.z * dirt.z)), k / 0.75) if k > 0 else base
            loop[col] = (c.x, c.y, c.z, loop[col][3])     # k = 0.75 -> full dirt tint
    return used


# ---------------------------------------------------------------------------
# Facades: plaster / cladding wall planes with real openings and reveals
# ---------------------------------------------------------------------------

class Facade:
    """A wall plane from p0 to p1 (outside is on the RIGHT when walking p0 -> p1).
    Local frame: X along the wall, Z up, -Y outward (so +Y is 'into the building').
    Openings are real holes with reveals; detail callbacks run inside the wall frame."""

    def __init__(self, b: Builder, key: str, p0, p1, z0: float, z1: float, outline=None,
                 grid=1.4, bands=(0.35, 0.9, 1.8), offset=0.0, u0=None, u1=None):
        self.b = b
        self.key = key
        self.p0 = Vector((p0[0], p0[1], 0.0))
        self.p1 = Vector((p1[0], p1[1], 0.0))
        d = self.p1 - self.p0
        self.length = d.length
        self.rz = math.atan2(d.y, d.x)
        # offset > 0 moves the surface outward (plinths standing proud of the wall above)
        self.frame = Matrix.Translation(self.p0) @ Matrix.Rotation(self.rz, 4, "Z") @ Matrix.Translation((0, -offset, 0))
        self.z0, self.z1 = z0, z1
        ua = 0.0 if u0 is None else u0
        ub = self.length if u1 is None else u1
        self.outline = outline if outline is not None else [(ua, z0), (ub, z0), (ub, z1), (ua, z1)]
        self.holes: list[dict] = []
        self.details = []
        self.grid = grid
        self.bands = bands

    # -- openings -----------------------------------------------------------
    def hole(self, pts, depth=0.2, reveal=None):
        self.holes.append({"pts": ccw(pts), "depth": depth, "reveal": reveal})

    def rect_hole(self, u0, u1, v0, v1, depth=0.2, reveal=None):
        self.hole([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], depth, reveal)

    def arch_hole(self, uc, w, v0, v_spring, rise, depth=0.3, reveal=None, n=14):
        pts = [(uc - w / 2, v0), (uc + w / 2, v0)] + arc_pts(uc, v_spring, w / 2, rise, 0.0, PI, n)
        self.hole(pts, depth, reveal)

    def detail(self, fn):
        """fn(b) is called inside the wall frame after the wall surface is built."""
        self.details.append(fn)

    # -- build --------------------------------------------------------------
    def build(self):
        b = self.b
        outer = ccw(self.outline)
        loops = [[Vector((p[0], p[1], 0.0)) for p in outer]]
        for h in self.holes:
            loops.append([Vector((p[0], p[1], 0.0)) for p in reversed(h["pts"])])
        flat = [p for lp in loops for p in lp]
        tris = tessellate_polygon(loops)
        tmp = bmesh.new()
        tv = [tmp.verts.new((p.x, 0.0, p.y)) for p in flat]
        want = abs(_poly_area(outer)) - sum(abs(_poly_area(h["pts"])) for h in self.holes)
        got = 0.0
        for a, c, d in tris:
            pa, pc, pd = flat[a], flat[c], flat[d]
            area = (pc.x - pa.x) * (pd.y - pa.y) - (pd.x - pa.x) * (pc.y - pa.y)
            got += abs(area) * 0.5
            if abs(area) < 1e-9:
                continue
            idx = (a, c, d) if area > 0 else (a, d, c)   # CCW in (u, v) seen from the front (-Y)
            try:
                tmp.faces.new([tv[i] for i in idx])
            except ValueError:
                pass
        if abs(got - want) > 0.01 * max(want, 0.01):
            # tessellate_polygon can mis-fill notched outlines – never ship a wall with a wrong fill
            raise RuntimeError(f"Facade '{self.key}' at {tuple(round(c, 2) for c in self.p0[:2])}: tessellated area "
                               f"{got:.3f} m2 != outline minus holes {want:.3f} m2")
        us = [p[0] for p in outer]
        vs = [p[1] for p in outer]
        u_lo, u_hi, v_lo, v_hi = min(us), max(us), min(vs), max(vs)
        cuts = []
        nu = int((u_hi - u_lo) / self.grid)
        for i in range(1, nu + 1):
            u = u_lo + (u_hi - u_lo) * i / (nu + 1)
            cuts.append(((u, 0, 0), (1, 0, 0)))
        v = v_lo
        for bh in self.bands:
            if v_lo + bh < v_hi - 0.1:
                cuts.append(((0, 0, v_lo + bh), (0, 0, 1)))
        v = v_lo + (self.bands[-1] if self.bands else 0.0) + self.grid
        while v < v_hi - 0.3:
            cuts.append(((0, 0, v), (0, 0, 1)))
            v += self.grid
        for co, no in cuts:
            geom = list(tmp.verts) + list(tmp.edges) + list(tmp.faces)
            bmesh.ops.bisect_plane(tmp, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
        with b.at(self.frame):
            for f in tmp.faces:
                pts = [(l.vert.co.x, 0.0, l.vert.co.z) for l in f.loops]
                b.face(self.key, pts, uvs=[(p[0], p[2]) for p in pts])
            for h in self.holes:
                if not h["reveal"]:
                    continue
                pts, d = h["pts"], h["depth"]
                n = len(pts)
                per = 0.0
                for i in range(n):
                    j = (i + 1) % n
                    seg = math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])
                    b.face(h["reveal"],
                           [(pts[i][0], 0.0, pts[i][1]), (pts[j][0], 0.0, pts[j][1]),
                            (pts[j][0], d, pts[j][1]), (pts[i][0], d, pts[i][1])],
                           uvs=[(per, 0.0), (per + seg, 0.0), (per + seg, d), (per, d)])
                    per += seg
            for fn in self.details:
                fn(b)
        tmp.free()


# ---------------------------------------------------------------------------
# Windows, shutters, doors
# ---------------------------------------------------------------------------

def louvre_shutter(b: Builder, key, w, h, thick=0.032, slat_pitch=0.062, iron=None, out_sign=-1.0):
    """Louvred shutter leaf in its own frame: hinge edge at x = 0, leaf extends to +x, front faces -Y.
    out_sign: local Y direction that ends up facing away from the wall (slats shed water that way)."""
    st = 0.055
    b.box(key, 0, st, -thick, 0, 0, h, uv="long")
    b.box(key, w - st, w, -thick, 0, 0, h, uv="long")
    for z0, z1 in ((0, 0.07), (h * 0.5 - 0.03, h * 0.5 + 0.03), (h - 0.07, h)):
        b.box(key, st, w - st, -thick, 0, z0, z1, uv="longu")
    for z_lo, z_hi in ((0.07, h * 0.5 - 0.03), (h * 0.5 + 0.03, h - 0.07)):
        n = max(1, int((z_hi - z_lo) / slat_pitch))
        for i in range(n):
            zc = z_lo + (z_hi - z_lo) * (i + 0.5) / n
            hw, dy, dz = (w - 2 * st) / 2, 0.028 * math.sin(math.radians(32)), 0.028 * math.cos(math.radians(32))
            lo = [(w / 2 - hw, -thick / 2 + out_sign * dy, zc - dz), (w / 2 + hw, -thick / 2 + out_sign * dy, zc - dz)]
            hi = [(w / 2 + hw, -thick / 2 - out_sign * dy, zc + dz), (w / 2 - hw, -thick / 2 - out_sign * dy, zc + dz)]
            quad = lo + hi
            uvq = [(0, 0), (2 * hw, 0), (2 * hw, 0.056), (0, 0.056)]
            b.mesh(key, quad, [[0, 1, 2, 3]], [uvq])                       # face seen from above/outside... 
            b.mesh(key, list(reversed(quad)), [[0, 1, 2, 3]], [list(reversed(uvq))])   # ...and from below
    if iron:
        for zc in (h * 0.16, h * 0.84):
            b.box(iron, -0.02, w * 0.55, -thick - 0.006, 0.006, zc - 0.014, zc + 0.014)


def window_unit(b: Builder, w, h, frame_key, glass_key, division="T", bars=2, depth=0.07):
    """Timber window in its own frame: origin = bottom-centre of the clear opening on the window plane,
    front faces -Y, frame occupies y in [0, depth]."""
    ft = 0.055
    b.box(frame_key, -w / 2, -w / 2 + ft, 0, depth, 0, h, uv="long", skip=("+y", "-x", "-z", "+z"))
    b.box(frame_key, w / 2 - ft, w / 2, 0, depth, 0, h, uv="long", skip=("+y", "+x", "-z", "+z"))
    b.box(frame_key, -w / 2 + ft, w / 2 - ft, 0, depth, 0, ft, uv="longu", skip=("+y", "-x", "+x", "-z"))
    b.box(frame_key, -w / 2 + ft, w / 2 - ft, 0, depth, h - ft, h, uv="longu", skip=("+y", "-x", "+x", "+z"))
    b.box(glass_key, -w / 2 + ft, w / 2 - ft, depth * 0.55, depth * 0.55 + 0.01, ft, h - ft, uv="box", uv_rand=False,
          skip=("+y", "-x", "+x", "-z", "+z"))
    sash = 0.04
    tz = h * 0.70 if division == "T" else None
    if division in ("T", "cross"):
        tz = h * 0.70 if division == "T" else h * 0.5
        b.box(frame_key, -w / 2 + ft, w / 2 - ft, -0.008, depth, tz - 0.035, tz + 0.035, uv="longu", skip=("+y", "-x", "+x"))
    if division in ("T", "cross", "two"):
        top = tz - 0.035 if (tz and division == "T") else h - ft
        b.box(frame_key, -0.035, 0.035, -0.012, depth, ft, top, uv="long", skip=("+y", "-z", "+z"))
    # casement sash frames (slightly proud) + glazing bars
    panes = []
    if division == "single":
        panes.append((-w / 2 + ft, w / 2 - ft, ft, h - ft))
    else:
        top = (tz - 0.035) if tz else (h - ft)
        panes.append((-w / 2 + ft, -0.035, ft, top))
        panes.append((0.035, w / 2 - ft, ft, top))
        if tz:
            if division == "T":
                panes.append((-w / 2 + ft, w / 2 - ft, tz + 0.035, h - ft))
            else:
                panes.append((-w / 2 + ft, -0.035, tz + 0.035, h - ft))
                panes.append((0.035, w / 2 - ft, tz + 0.035, h - ft))
    for (x0, x1, z0, z1) in panes:
        y0, y1 = 0.012, depth * 0.55
        b.box(frame_key, x0, x0 + sash, y0, y1, z0, z1, uv="long", skip=("+y", "-x", "-z", "+z"))
        b.box(frame_key, x1 - sash, x1, y0, y1, z0, z1, uv="long", skip=("+y", "+x", "-z", "+z"))
        b.box(frame_key, x0 + sash, x1 - sash, y0, y1, z0, z0 + sash, uv="longu", skip=("+y", "-x", "+x", "-z"))
        b.box(frame_key, x0 + sash, x1 - sash, y0, y1, z1 - sash, z1, uv="longu", skip=("+y", "-x", "+x", "+z"))
        tall = (z1 - z0) > (x1 - x0) * 1.3
        if bars and tall:
            for k in range(1, bars + 1):
                zc = z0 + (z1 - z0) * k / (bars + 1)
                b.box(frame_key, x0 + sash, x1 - sash, 0.02, depth * 0.55, zc - 0.011, zc + 0.011, uv="longu",
                      skip=("+y", "-x", "+x"))


def add_window(f: Facade, u, v, w=1.0, h=1.5, *, stone="stone", frame="win", glass="glass",
               shutter=None, iron=None, depth=0.20, sw=0.14, proud=0.035, division="T", bars=2,
               lintel="plain", sill_proj=0.075, shutter_open=(8.0, 8.0), flowers=None, grille=None):
    """Recessed window with a stone surround (Gewände) lining a real hole in the wall.
    (u, v) = centre / sill-top of the clear opening in facade coordinates."""
    lh = 0.17 if lintel != "none" else sw
    sh = 0.11
    if stone:
        f.rect_hole(u - w / 2 - sw, u + w / 2 + sw, v - sh, v + h + lh, depth=depth)
    else:
        f.rect_hole(u - w / 2, u + w / 2, v, v + h, depth=depth, reveal=f.key)

    def detail(b: Builder):
        x0, x1 = u - w / 2, u + w / 2
        if stone:
            b.box(stone, x0 - sw, x0, -proud, depth, v - sh, v + h + lh, uv="long")
            b.box(stone, x1, x1 + sw, -proud, depth, v - sh, v + h + lh, uv="long")
            ear = 0.05 if lintel in ("cornice", "ear") else 0.0
            b.box(stone, x0 - ear, x1 + ear, -proud - (0.012 if ear else 0.0), depth, v + h, v + h + lh, uv="longu")
            if lintel == "cornice":
                prof = [(0.0, 0.0), (0.035, 0.0), (0.085, 0.045), (0.085, 0.075), (0.0, 0.10)]
                b.sweep_h(stone, [(a + proud, bb) for a, bb in prof],
                          [(x0 - sw - 0.05, 0.0, v + h + lh), (x1 + sw + 0.05, 0.0, v + h + lh)])
            elif lintel == "segment":
                # shallow carved relief panel with keystone
                b.box(stone, u - 0.07, u + 0.07, -proud - 0.025, 0.0, v + h + 0.01, v + h + lh + 0.03, uv="long")
            # projecting sill with sloped top
            sp = sill_proj + proud
            # sill profile (a = outward, b = up) swept along the wall
            b.sweep_h(stone, [(sp, -sh), (sp, -0.035), (0.0, 0.0), (-depth, 0.0), (-depth, -sh)],
                      [(x0 - sw - 0.045, 0.0, v), (x1 + sw + 0.045, 0.0, v)])
        if not stone:
            b.box(frame, x0 - 0.04, x1 + 0.04, -0.035, depth, v - 0.045, v, uv="longu")
        with b.place(u, depth - 0.075, v):
            window_unit(b, w, h, frame, glass, division=division, bars=bars)
        if grille:
            for k in range(1, int(w / 0.14)):
                xk = x0 + w * k / int(w / 0.14)
                b.cyl(grille, (xk, depth * 0.35, v), (xk, depth * 0.35, v + h), 0.009, seg=5, caps=(False, False))
            b.box(grille, x0, x1, depth * 0.35 - 0.006, depth * 0.35 + 0.006, v + h * 0.5 - 0.012, v + h * 0.5 + 0.012)
        if shutter:
            lw = w / 2 + 0.01
            for side, ang in ((-1, shutter_open[0]), (1, shutter_open[1])):
                hx = u + side * (w / 2 + (sw if stone else 0.0) + 0.012)
                a = math.radians(ang)
                # leaf folded back beside the window, standing `ang` degrees off the wall
                rz = (PI + a) if side < 0 else -a
                with b.place(hx, -proud - 0.014, v, rz=rz):
                    louvre_shutter(b, shutter, lw, h, iron=iron, out_sign=1.0 if side < 0 else -1.0)
                if iron:
                    b.box(iron, hx - 0.02, hx + 0.02, -proud - 0.03, -proud + 0.01, v + h * 0.16 - 0.03, v + h * 0.16 + 0.03)
                    b.box(iron, hx - 0.02, hx + 0.02, -proud - 0.03, -proud + 0.01, v + h * 0.84 - 0.03, v + h * 0.84 + 0.03)
        if flowers:
            flower_box(b, u, -proud - sill_proj - 0.02, v + 0.0, w * 0.92, *flowers)

    f.detail(detail)


def flower_box(b: Builder, u, y, z, w, box_key, fol_key):
    """Geranium window box hanging in front of the sill (facade coords; y = front of the sill).
    The plants are alpha-masked cards from the foliage atlas."""
    b.box(box_key, u - w / 2, u + w / 2, y - 0.16, y, z - 0.02, z + 0.14, uv="longu")
    rng = b.rng
    kw = {"facing": (0.0, -1.0, 0.0)} if b.specs[fol_key].lit_cards else {}      # out of the facade
    n = max(2, int(round(w / 0.26)))
    for i in range(n):
        x = u - w / 2 + w * (i + 0.5) / n + rng.uniform(-0.03, 0.03)
        s = rng.uniform(0.30, 0.38)
        a = rng.uniform(-0.5, 0.5)
        # two crossed upright cards + one leaning out over the front edge of the box
        b.card(fol_key, "geranium", (x, y - 0.08, z + 0.06), (math.cos(a), math.sin(a), 0), (0, 0, 1), s, s, flip=rng.random() < 0.5,
               **kw)
        b.card(fol_key, "geranium", (x, y - 0.08, z + 0.06), (-math.sin(a), math.cos(a), 0), (0, 0, 1), s * 0.9, s * 0.9,
               flip=rng.random() < 0.5, **kw)
        b.card(fol_key, "geranium", (x + rng.uniform(-0.05, 0.05), y - 0.10, z + 0.10), (1, 0, 0), (0, -0.75, 0.66), s, s * 0.95,
               flip=rng.random() < 0.5, **kw)


def plank_leaf(b: Builder, key, w, h, thick=0.05, iron=None, frame_key=None, brace=True, hinge_len=0.75,
               top_pts=None):
    """Boarded door/gate leaf in its own frame: hinge edge at x = 0, extends to +x, outside face at -Y.
    top_pts: optional list of (x, z) describing a shaped (arched) top edge from x = 0 to x = w."""
    fk = frame_key or key
    if top_pts is None:
        b.box(key, 0, w, -thick, 0, 0, h, uv="long")
    else:
        poly = [(0.0, 0.0), (w, 0.0)] + list(reversed(top_pts))
        b.prism_xz(key, poly, -thick, 0)
    # ledges and brace on the INSIDE (+Y) face
    for zc in (0.25, h * 0.52, h - 0.28):
        b.box(fk, 0.04, w - 0.04, 0, 0.045, zc - 0.07, zc + 0.07, uv="longu")
    if brace:
        b.beam(fk, (0.10, 0.022, 0.32), (w - 0.10, 0.022, h * 0.52 - 0.07), 0.12, 0.045, normal=(0, 1, 0))
        b.beam(fk, (0.10, 0.022, h * 0.52 + 0.07), (w - 0.10, 0.022, h - 0.35), 0.12, 0.045, normal=(0, 1, 0))
    if iron:
        for zc in (0.30, h - 0.32):
            # long strap hinge on the outside face with a forged spear tip
            L = min(hinge_len, w * 0.8)
            pts = [(0.0, zc - 0.03), (L - 0.10, zc - 0.022), (L - 0.06, zc - 0.045), (L, zc), (L - 0.06, zc + 0.045),
                   (L - 0.10, zc + 0.022), (0.0, zc + 0.03)]
            b.prism_xz(iron, pts, -thick - 0.008, -thick)
            b.cyl(iron, (0.0, -thick * 0.5, zc - 0.07), (0.0, -thick * 0.5, zc + 0.07), 0.02, seg=6)
            for k in range(3):
                xk = L * (0.15 + 0.3 * k)
                b.box(iron, xk - 0.012, xk + 0.012, -thick - 0.014, -thick - 0.006, zc - 0.012, zc + 0.012)


# ---------------------------------------------------------------------------
# Roofs
# ---------------------------------------------------------------------------

def roof_slab(b: Builder, e0, e1, r1, r0, thickness, tiles, soffit, edge, cell=1.5):
    """One roof plane: eave edge e0 -> e1 (outside to the right when walking e0 -> e1 is FALSE: the
    eave is walked so that the roof rises to the LEFT), ridge edge r0 (above e0) -> r1 (above e1).
    Top = tiles (V up the slope), underside = soffit, edges = edge material."""
    e0, e1, r0, r1 = Vector(e0), Vector(e1), Vector(r0), Vector(r1)
    along = (e1 - e0)
    L = along.length
    up = (r0 - e0)
    S = up.length
    nrm = along.cross(up).normalized()
    if nrm.z < 0:
        raise RuntimeError("roof_slab: wind the eave so that the roof rises to the left of e0->e1")
    nx = max(1, int(math.ceil(L / cell)))
    ny = max(1, int(math.ceil(S / cell)))
    verts, uvs = [], []
    for j in range(ny + 1):
        t = j / ny
        a = e0.lerp(r0, t)
        c = e1.lerp(r1, t)
        la = (c - a).length
        for i in range(nx + 1):
            verts.append(a.lerp(c, i / nx))
            # U measured from the slab's centre line so tapered (hip) planes stay undistorted
            uvs.append(((i / nx - 0.5) * la, t * S))
    quad_faces, quad_uvs = [], []
    for j in range(ny):
        for i in range(nx):
            a, b_, c, d = j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i
            quad_faces.append([a, b_, c, d])
            quad_uvs.append([uvs[a], uvs[b_], uvs[c], uvs[d]])
    b.mesh(tiles, verts, quad_faces, quad_uvs)
    dn = -nrm * thickness
    b.face(soffit, [e1 + dn, e0 + dn, r0 + dn, r1 + dn], uvs=[(L, 0), (0, 0), (0, S), (L, S)])
    b.face(edge, [e0 + dn, e1 + dn, e1, e0], uvs=[(0, 0), (L, 0), (L, thickness), (0, thickness)])
    b.face(edge, [e1 + dn, r1 + dn, r1, e1], uvs=[(0, 0), (S, 0), (S, thickness), (0, thickness)])
    b.face(edge, [r0 + dn, e0 + dn, e0, r0], uvs=[(0, 0), (S, 0), (S, thickness), (0, thickness)])
    b.face(edge, [r1 + dn, r0 + dn, r0, r1], uvs=[(0, 0), (L, 0), (L, thickness), (0, thickness)])


def ridge_caps(b: Builder, key, p0, p1, r=0.12, step=0.38):
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    n = max(1, int(round(L / step)))
    d = (p1 - p0) / n
    for i in range(n):
        a = p0 + d * i
        c = p0 + d * (i + 1.12)
        b.cyl(key, a, c, r * 0.92, r * 1.08, seg=8, caps=(i == 0, True))


def gable_roof(b: Builder, L, W, z_eave, pitch_deg, *, tiles, soffit, edge, ridge=None, eave_oh=0.45,
               verge_oh=0.30, thickness=0.16, rafters=None, rafter_step=0.85, gutter=None, bargeboard=None,
               sides=(True, True), ridge_r=0.12, verge_oh2=None):
    """Gable roof in the current frame: ridge along X from -L/2..L/2 over a body W wide (Y).
    Returns dict with ridge height etc. sides=(south(-Y), north(+Y)) lets a slope be omitted."""
    tan = math.tan(math.radians(pitch_deg))
    cosp = math.cos(math.radians(pitch_deg))
    z_r = z_eave + (W / 2) * tan
    hy = W / 2 + eave_oh
    z_eo = z_eave - eave_oh * tan
    v0 = L / 2 + verge_oh
    v1 = L / 2 + (verge_oh if verge_oh2 is None else verge_oh2)
    t_v = thickness / cosp
    lift = t_v  # top surface sits one slab thickness above the structural line
    if sides[0]:
        roof_slab(b, (-v0, -hy, z_eo + lift), (v1, -hy, z_eo + lift), (v1, 0, z_r + lift), (-v0, 0, z_r + lift),
                  thickness, tiles, soffit, edge)
    if sides[1]:
        roof_slab(b, (v1, hy, z_eo + lift), (-v0, hy, z_eo + lift), (-v0, 0, z_r + lift), (v1, 0, z_r + lift),
                  thickness, tiles, soffit, edge)
    if ridge:
        ridge_caps(b, ridge, (-v0 - 0.03, 0, z_r + lift + 0.02), (v1 + 0.03, 0, z_r + lift + 0.02), r=ridge_r)
    for s, on in ((-1, sides[0]), (1, sides[1])):
        if not on:
            continue
        if rafters:
            n = max(2, int(round(L / rafter_step)))
            for i in range(n + 1):
                x = -L / 2 + 0.06 + (L - 0.12) * i / n
                p_out = Vector((x, s * (hy - 0.04), z_eo + lift - thickness / cosp - 0.075 + 0.04 * tan))
                p_in = Vector((x, s * (W / 2 - 0.25), z_eave + lift - thickness / cosp - 0.075 + 0.25 * tan))
                b.beam(rafters, p_out, p_in, 0.09, 0.15, normal=(0, s * math.sin(math.radians(pitch_deg)), -cosp))
        if bargeboard:
            for xs in (-1, 1):
                xv = xs * ((v0 if xs < 0 else v1) - 0.025)
                b.beam(bargeboard, (xv, s * hy, z_eo + lift - t_v - 0.02), (xv, 0, z_r + lift - t_v - 0.02), 0.22, 0.035,
                       normal=(xs, 0, 0))
        if gutter:
            gz = z_eo + lift - t_v + 0.01
            half_round_gutter(b, gutter, (-v0 + 0.02, s * (hy + 0.07), gz), (v1 - 0.02, s * (hy + 0.07), gz), outward=(0, s, 0))
    return {"z_ridge": z_r + lift, "z_eave_out": z_eo, "tan": tan, "hy": hy}


def half_round_gutter(b: Builder, key, p0, p1, outward=(0, -1, 0), r=0.075, brackets=True):
    """Hanging half-round zinc gutter with a rolled bead and strap brackets."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0)
    L = d.length
    ax = d / L
    out = Vector(outward).normalized()
    up = Vector((0, 0, 1))
    n = 7
    outer = [(r * math.cos(PI + PI * i / n), r * math.sin(PI + PI * i / n)) for i in range(n + 1)]
    inner = [((r - 0.012) * math.cos(2 * PI - PI * i / n), (r - 0.012) * math.sin(2 * PI - PI * i / n)) for i in range(n + 1)]
    prof = outer + inner
    side = out
    b.sweep(key, prof, [p0, p1], [side, side], [up, up], smooth=False)
    b.cyl(key, p0 + out * r, p1 + out * r, 0.012, seg=6, caps=(True, True))
    if brackets:
        nb = max(2, int(L / 0.9))
        for i in range(nb + 1):
            c = p0 + ax * (0.15 + (L - 0.3) * i / nb)
            b.beam(key, c - out * (r + 0.07) + up * 0.03, c + out * (r + 0.01) + up * 0.01, 0.025, 0.006, normal=(0, 0, 1))


def downpipe(b: Builder, key, top, bottom_z, wall_offset=None, r=0.05, clamp_key=None, shoe=True):
    """Downpipe from a gutter outlet at `top` (x, y, z) to bottom_z with a swan neck back to the wall.
    wall_offset = (dx, dy): horizontal vector from the gutter outlet to the pipe's vertical run."""
    top = Vector(top)
    off = Vector((wall_offset[0], wall_offset[1], 0.0)) if wall_offset else Vector((0, 0, 0))
    pts = [top, top - Vector((0, 0, 0.18))]
    if off.length > 1e-3:
        pts.append(top + off * 0.25 - Vector((0, 0, 0.30)))
        pts.append(top + off * 0.85 - Vector((0, 0, 0.30 + off.length * 0.75)))
        pts.append(top + off - Vector((0, 0, 0.45 + off.length * 0.75)))
    base = top + off
    if shoe:
        pts.append(Vector((base.x, base.y, bottom_z + 0.22)))
        o = off.normalized() if off.length > 1e-3 else Vector((0, -1, 0))
        pts.append(Vector((base.x, base.y, bottom_z + 0.10)) - o * 0.05)
        pts.append(Vector((base.x, base.y, bottom_z + 0.04)) - o * 0.20)
    else:
        pts.append(Vector((base.x, base.y, bottom_z)))
    b.tube(key, pts, r, seg=8)
    ck = clamp_key or key
    z = base.z - 0.9 - off.length
    while z > bottom_z + 0.5:
        b.cyl(ck, (base.x, base.y, z - 0.02), (base.x, base.y, z + 0.02), r + 0.008, seg=8)
        z -= 1.9


def chimney(b: Builder, x, y, z0, z1, sx=0.6, sy=0.6, key="brick", cap="stone", flashing=None, pot=None):
    b.box(key, x - sx / 2, x + sx / 2, y - sy / 2, y + sy / 2, z0, z1)
    b.box(cap, x - sx / 2 - 0.06, x + sx / 2 + 0.06, y - sy / 2 - 0.06, y + sy / 2 + 0.06, z1, z1 + 0.07)
    b.box(key, x - sx / 2 + 0.02, x + sx / 2 - 0.02, y - sy / 2 + 0.02, y + sy / 2 - 0.02, z1 + 0.07, z1 + 0.20)
    b.box(cap, x - sx / 2 - 0.04, x + sx / 2 + 0.04, y - sy / 2 - 0.04, y + sy / 2 + 0.04, z1 + 0.20, z1 + 0.26)
    if pot:
        with b.place(x, y, z1 + 0.26):
            b.lathe(pot, [(0.13, 0.0), (0.11, 0.25), (0.125, 0.27), (0.125, 0.33), (0.095, 0.33)], seg=10,
                    cap_bottom=False, cap_top=True)
    if flashing:
        b.box(flashing, x - sx / 2 - 0.05, x + sx / 2 + 0.05, y - sy / 2 - 0.05, y + sy / 2 + 0.05, z0 - 0.0, z0 + 0.0001)


# ---------------------------------------------------------------------------
# Half-timbering (Fachwerk) – beams stand proud of the plaster infill behind them
# ---------------------------------------------------------------------------

def _fw_h(b, key, ua, ub, zc, t, proud):
    if ub - ua > 0.02:
        b.box(key, ua, ub, -proud, 0.03, zc - t / 2, zc + t / 2, uv="longu", skip=("+y",))


def _fw_v(b, key, uc, za, zb, t, proud):
    if zb - za > 0.02:
        b.box(key, uc - t / 2, uc + t / 2, -proud, 0.03, za, zb, uv="long", skip=("+y", "-z", "+z"))


def _fw_d(b, key, pa, pb, t, proud):
    b.beam(key, (pa[0], -proud / 2 + 0.015, pa[1]), (pb[0], -proud / 2 + 0.015, pb[1]), t, proud + 0.03, normal=(0, -1, 0))


def fachwerk_band(b: Builder, key, u0, u1, z0, z1, *, post_step=1.5, rails=(0.5,), openings=(), brace_ends=True,
                  mann_every=3, crosses=(), gaps=(), t=0.17, proud=0.05):
    """Timber frame over the rectangle [u0, u1] x [z0, z1] in the current wall frame.
    openings: [(ua, ub, za, zb)] – framed with jamb posts, sill and head rails; other members stop there.
    gaps: [(ua, ub, ztop)] – tall door openings rising from below into the frame (sill plate interrupted).
    crosses: [(ua, ub, za, zb)] panels that receive a St Andrew's cross."""
    rng = b.rng
    cuts = sorted((ua, ub) for ua, ub, _ in gaps)
    lo = u0
    for ua, ub in cuts + [(u1, u1)]:
        _fw_h(b, key, lo, ua, z0 + t / 2, t, proud + 0.012)      # sill plate (Schwelle), slightly prouder
        lo = ub
    _fw_h(b, key, u0, u1, z1 - t / 2, t, proud + 0.006)          # head plate (Rähm)
    zi0, zi1 = z0 + t, z1 - t
    n = max(1, int(round((u1 - u0 - t) / post_step)))
    posts = [u0 + t / 2 + (u1 - u0 - t) * i / n for i in range(n + 1)]
    # drop regular posts that fall into / too close to an opening; add jamb posts instead
    def blocked(u):
        return (any(ua - t * 1.4 < u < ub + t * 1.4 for ua, ub, _, _ in openings)
                or any(ua - t * 1.4 < u < ub + t * 1.4 for ua, ub, _ in gaps))
    posts = [u for u in posts if not blocked(u)]
    for ua, ub, ztop in gaps:
        posts += [ua - t / 2, ub + t / 2]
        if zi1 - ztop > 0.6 and not any(a_ < (ua + ub) / 2 < c_ for a_, c_, _, _ in openings):
            _fw_v(b, key, (ua + ub) / 2, ztop, zi1, t * 0.85, proud)
    gap_rects = [(ua, ub, ztop) for ua, ub, ztop in gaps]
    for ua, ub, za, zb in openings:
        posts += [ua - t / 2, ub + t / 2]
        _fw_h(b, key, ua, ub, za - t / 2, t * 0.9, proud)        # sill rail
        _fw_h(b, key, ua, ub, zb + t / 2, t * 0.9, proud)        # head rail
        if za - t - zi0 > 0.5:                                    # short stud under the window
            _fw_v(b, key, (ua + ub) / 2, zi0, za - t, t * 0.8, proud)
    posts = sorted(set(round(u, 3) for u in posts))
    for u in posts:
        _fw_v(b, key, u, zi0, zi1, t * rng.uniform(0.92, 1.1), proud)
    # rails between neighbouring posts
    for fr in rails:
        zc = zi0 + (zi1 - zi0) * fr
        for a, c in zip(posts[:-1], posts[1:]):
            mid = (a + c) / 2
            if any(ua - 0.01 < mid < ub + 0.01 and za - t < zc < zb + t for ua, ub, za, zb in openings):
                continue
            if any(ua - 0.01 < mid < ub + 0.01 and zc < ztop + t for ua, ub, ztop in gap_rects):
                continue
            _fw_h(b, key, a + t / 2, c - t / 2, zc + rng.uniform(-0.02, 0.02), t * 0.85, proud)
    # braces
    def free(a, c):
        mid = (a + c) / 2
        return (not any(ua - 0.01 < mid < ub + 0.01 for ua, ub, _, _ in openings)
                and not any(ua - 0.01 < mid < ub + 0.01 for ua, ub, _ in gap_rects))
    if brace_ends and len(posts) >= 3:
        if free(posts[0], posts[1]):
            _fw_d(b, key, (posts[1] - t / 2, zi0), (posts[0] + t / 2, zi1 - 0.25), t * 0.85, proud - 0.005)
        if free(posts[-2], posts[-1]):
            _fw_d(b, key, (posts[-2] + t / 2, zi0), (posts[-1] - t / 2, zi1 - 0.25), t * 0.85, proud - 0.005)
    if mann_every:
        for i in range(mann_every, len(posts) - 2, mann_every):
            if free(posts[i - 1], posts[i]) and free(posts[i], posts[i + 1]):
                # "Mann" figure: two foot braces rising to the post
                h = (zi1 - zi0) * 0.72
                _fw_d(b, key, (posts[i - 1] + t / 2 + 0.25, zi0), (posts[i] - t / 2, zi0 + h), t * 0.8, proud - 0.005)
                _fw_d(b, key, (posts[i + 1] - t / 2 - 0.25, zi0), (posts[i] + t / 2, zi0 + h), t * 0.8, proud - 0.005)
    for ua, ub, za, zb in crosses:
        _fw_d(b, key, (ua, za), (ub, zb), t * 0.7, proud - 0.008)
        _fw_d(b, key, (ua, zb), (ub, za), t * 0.7, proud - 0.012)


def fachwerk_gable(b: Builder, key, W, z0, tan, *, levels=(1.9, 3.5), post_step=1.25, openings=(), t=0.17, proud=0.05,
                   u_off=0.0):
    """Timber-framed gable triangle of width W standing on z0 (roof pitch tan) in the current wall frame."""
    rng = b.rng

    def roof(u):
        return z0 + (W / 2 - abs(u - W / 2)) * tan

    o = u_off
    _fw_h(b, key, o, o + W, z0 + t / 2, t, proud + 0.012)
    lv = [0.0] + [h for h in levels if h < W / 2 * tan - 0.5]
    inset = t * 0.9 / max(1e-3, math.cos(math.atan(tan)))
    for k, h in enumerate(lv):
        ua = h / tan + inset * 0.6
        ub = W - ua
        if k > 0:
            _fw_h(b, key, o + ua, o + ub, z0 + h + t / 2, t * 0.9, proud)
        top = lv[k + 1] if k + 1 < len(lv) else None
        zlo = z0 + h + t
        n = max(1, int(round((ub - ua) / post_step)))
        us = [ua + t / 2 + (ub - ua - t) * i / n for i in range(n + 1)]
        for u in us:
            zhi = (z0 + top) if top is not None else 1e9
            zhi = min(zhi, roof(u) - inset * 0.9)
            if any(a_ - t * 1.3 < u < c_ + t * 1.3 and za - t < zhi and zb + t > zlo for a_, c_, za, zb in openings):
                continue
            _fw_v(b, key, o + u, zlo, zhi, t * rng.uniform(0.9, 1.05), proud)
        if len(us) >= 4:
            hh = ((top if top is not None else (W / 2 - ua) * tan + h) - h - t) * 0.8
            if hh > 0.6:
                _fw_d(b, key, (o + us[1] - t / 2, zlo), (o + us[0] + t / 2, zlo + min(hh, roof(us[0]) - zlo - 0.3)), t * 0.8, proud - 0.005)
                _fw_d(b, key, (o + us[-2] + t / 2, zlo), (o + us[-1] - t / 2, zlo + min(hh, roof(us[-1]) - zlo - 0.3)), t * 0.8, proud - 0.005)
    for ua, ub, za, zb in openings:
        _fw_v(b, key, o + ua - t / 2, za - t, min(zb + t, roof(ua - t / 2) - inset), t, proud)
        _fw_v(b, key, o + ub + t / 2, za - t, min(zb + t, roof(ub + t / 2) - inset), t, proud)
        _fw_h(b, key, o + ua, o + ub, za - t / 2, t * 0.9, proud)
        _fw_h(b, key, o + ua, o + ub, zb + t / 2, t * 0.9, proud)
    # rafters along both slopes (stand a little prouder, like a barge couple)
    apex = (o + W / 2, z0 + W / 2 * tan)
    c = math.cos(math.atan(tan))
    for sgn, foot in ((1, o), (-1, o + W)):
        nx, nz = sgn * math.sin(math.atan(tan)), -c          # inward normal of the slope line
        pa = (foot + nx * t * 0.5, z0 + nz * t * 0.5 + t * 0.2)
        pb = (apex[0] + nx * t * 0.5, apex[1] + nz * t * 0.5)
        _fw_d(b, key, pa, pb, t, proud + 0.01)


def outward_prism(b: Builder, key, u0, width, pts, **kw):
    """Solid with profile pts = [(outward distance, z)] standing against a wall (current frame = wall
    frame), extruded along the wall from u0 to u0 + width."""
    with b.at(Matrix.Translation((u0, 0, 0)) @ Matrix.Rotation(-PI / 2, 4, "Z")):
        b.prism_xz(key, pts, 0.0, width, **kw)


def steps(b: Builder, key, u0, u1, z_top, n=3, run=0.30, rise=0.17):
    """Stone steps descending outward from a door sill (current frame = wall frame)."""
    for i in range(n):
        d0 = run * (i + 1)
        b.box(key, u0 - 0.12 * (i > 0), u1 + 0.12 * (i > 0), -d0, 0.0, z_top - rise * (i + 1), z_top - rise * i)


def stone_pier(b: Builder, key, x, y, z0, h, s=0.62, cap=None, ball=True):
    ck = cap or key
    b.box(key, x - s / 2, x + s / 2, y - s / 2, y + s / 2, z0, z0 + h)
    b.box(ck, x - s / 2 - 0.05, x + s / 2 + 0.05, y - s / 2 - 0.05, y + s / 2 + 0.05, z0, z0 + 0.32)
    b.box(ck, x - s / 2 - 0.07, x + s / 2 + 0.07, y - s / 2 - 0.07, y + s / 2 + 0.07, z0 + h, z0 + h + 0.12)
    with b.place(x, y, z0 + h + 0.12):
        with b.at(Matrix.Rotation(PI / 4, 4, "Z")):
            b.lathe(ck, [((s / 2 + 0.05) * 1.414, 0.0), (0.12 * 1.414, 0.14)], seg=4, cap_bottom=False, cap_top=True,
                    smooth=False)
        if ball:
            b.lathe(ck, [(0.07, 0.14), (0.09, 0.19), (0.16, 0.26), (0.19, 0.36), (0.16, 0.46), (0.09, 0.53), (0.0, 0.55)],
                    seg=10, cap_bottom=False, cap_top=False)


def wall_coping_tiles(b: Builder, stone, tiles, p0, p1, z, thick, ridge=None):
    """Small tiled saddle coping on top of a yard wall running p0 -> p1 (wall centred on that line)."""
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    d = (p1 - p0)
    L = d.length
    with b.at(Matrix.Translation(p0) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, "Z")):
        w = thick / 2 + 0.07
        b.box(stone, 0, L, -w, w, z, z + 0.07)
        rise = 0.16
        for sgn in (-1, 1):
            e0, e1 = ((0, sgn * (w + 0.03), z + 0.07), (L, sgn * (w + 0.03), z + 0.07))
            r0, r1 = (0, 0, z + 0.07 + rise), (L, 0, z + 0.07 + rise)
            if sgn < 0:
                roof_slab(b, e0, e1, r1, r0, 0.03, tiles, stone, stone, cell=3.0)
            else:
                roof_slab(b, e1, e0, r0, r1, 0.03, tiles, stone, stone, cell=3.0)
        if ridge:
            ridge_caps(b, ridge, (0, 0, z + 0.07 + rise + 0.01), (L, 0, z + 0.07 + rise + 0.01), r=0.07, step=0.33)


def spoked_wheel(b: Builder, wood, iron, r=0.55, width=0.07, spokes=10):
    """Wooden cart wheel in the XZ plane (axle along Y), centre at the frame origin."""
    with b.at(Matrix.Rotation(PI / 2, 4, "X")):
        b.lathe(wood, [(r - 0.075, -width / 2), (r, -width / 2), (r, width / 2), (r - 0.075, width / 2), (r - 0.075, -width / 2)],
                seg=18, cap_bottom=False, cap_top=False, sharp=(1, 2, 3))
        b.lathe(iron, [(r + 0.006, -width / 2 - 0.004), (r + 0.006, width / 2 + 0.004)], seg=18, cap_bottom=False, cap_top=False)
        b.lathe(wood, [(0.0, -0.11), (0.06, -0.11), (0.095, -0.04), (0.095, 0.04), (0.06, 0.11), (0.0, 0.11)], seg=8,
                cap_bottom=False, cap_top=False)
    for i in range(spokes):
        a = 2 * PI * i / spokes
        b.beam(wood, (0.085 * math.cos(a), 0, 0.085 * math.sin(a)), ((r - 0.07) * math.cos(a), 0, (r - 0.07) * math.sin(a)),
               0.045, 0.035, normal=(0, 1, 0))


def ladder_cart(b: Builder, wood, iron, length=3.0):
    """Traditional Leiterwagen standing at the frame origin, drawbar pointing to +X."""
    rf, rr = 0.42, 0.52
    for xa, r in ((length / 2 - 0.45, rf), (-length / 2 + 0.5, rr)):
        b.cyl(iron, (xa, -0.62, r), (xa, 0.62, r), 0.035, seg=6)
        b.box(wood, xa - 0.07, xa + 0.07, -0.48, 0.48, r + 0.02, r + 0.16, uv="longu")
        for sy in (-0.60, 0.60):
            with b.place(xa, sy, r):
                spoked_wheel(b, wood, iron, r=r)
    zb = rr + 0.18
    b.box(wood, -length / 2, length / 2, -0.40, 0.40, zb, zb + 0.04, uv="longu")
    for sy in (-1, 1):
        # splayed ladder sides
        lo = Vector((0, sy * 0.40, zb + 0.04))
        hi = Vector((0, sy * 0.72, zb + 0.62))
        for p in (lo, hi):
            b.beam(wood, (-length / 2 - 0.15, p.y, p.z), (length / 2 + 0.15, p.y, p.z), 0.05, 0.05)
        n = 9
        for i in range(n):
            x = -length / 2 + 0.1 + (length - 0.2) * i / (n - 1)
            b.beam(wood, (x, lo.y, lo.z), (x, hi.y, hi.z), 0.03, 0.03)
    b.beam(wood, (length / 2 - 0.3, 0, rf + 0.05), (length / 2 + 2.0, 0, 0.32), 0.07, 0.07)


def log_stack(b: Builder, key, x0, x1, z0, z1, y0, y1):
    """Split firewood stacked between x0..x1 / z0..z1, logs lying along Y from y0 (visible ends) to y1."""
    rng = b.rng
    z = z0
    row = 0
    while z < z1 - 0.08:
        rr = rng.uniform(0.07, 0.10)
        x = x0 + (rr if row % 2 == 0 else rr * 1.8)
        while x < x1 - rr:
            r = rr * rng.uniform(0.85, 1.1)
            yo = rng.uniform(-0.05, 0.05)
            c = rng.uniform(0.55, 0.85)
            a0 = rng.uniform(0, PI)
            ring = [(x + r * math.cos(a0 + k * PI / 3), y0 + yo, z + rr + r * math.sin(a0 + k * PI / 3)) for k in range(6)]
            back = [(p[0], y1, p[2]) for p in ring]
            # end grain (pale) + bark sides
            b.mesh(key, ring, [list(range(6))], [[(p[0], p[2]) for p in ring]], color=(1.25 * c, 1.1 * c, 0.8 * c))
            verts = ring + back
            faces = [[(k + 1) % 6, k, 6 + k, 6 + (k + 1) % 6] for k in range(6)]
            uvs = [[(0, 0), (0.1, 0), (0.1, y1 - y0), (0, y1 - y0)] for _ in range(6)]
            b.mesh(key, verts, faces, uvs, color=(0.42, 0.36, 0.30))
            x += r * 2.05
        z += rr * 1.78
        row += 1


def mound(b: Builder, key, x0, x1, y0, y1, z0, height, nx=10, ny=8, color=None):
    """Lumpy heap (dung heap, gravel pile) over a rectangle."""
    verts, faces, uvs = [], [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x, y = x0 + (x1 - x0) * u, y0 + (y1 - y0) * v
            dome = (math.sin(PI * u) ** 0.7) * (math.sin(PI * v) ** 0.7)
            nz = noise.noise(Vector((x * 1.7, y * 1.7, 3.1)))
            verts.append((x, y, z0 + height * dome * (0.85 + 0.3 * nz)))
    for j in range(ny):
        for i in range(nx):
            a, c, d, e = j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i
            faces.append([a, c, d, e])
            uvs.append([(verts[q][0], verts[q][1]) for q in (a, c, d, e)])
    b.mesh(key, verts, faces, uvs, smooth=True, color=color)


def hand_pump(b: Builder, iron, stone, x, y, z0):
    with b.place(x, y, z0):
        b.box(stone, -0.35, 0.35, -0.35, 0.35, 0.0, 0.14)
        b.lathe(iron, [(0.09, 0.14), (0.075, 0.20), (0.06, 0.95), (0.085, 1.0), (0.085, 1.32), (0.10, 1.34), (0.03, 1.42)], seg=10,
                cap_bottom=False, cap_top=True, sharp=(1, 3, 4, 5))
        b.tube(iron, [(0.07, 0, 0.98), (0.26, 0, 1.0), (0.32, 0, 0.90)], 0.035, seg=6)
        b.tube(iron, [(-0.05, 0, 1.36), (-0.14, 0, 1.45), (-0.42, 0, 1.25), (-0.58, 0, 0.80)], 0.016, seg=5)
        b.cyl(iron, (0, 0, 1.36), (0, 0, 1.62), 0.014, seg=5)


def stone_trough(b: Builder, stone, water, x, y, z0, lx=1.7, ly=0.75, h=0.55):
    with b.place(x, y, z0):
        t = 0.10
        b.box(stone, -lx / 2, lx / 2, -ly / 2, ly / 2, 0, 0.14)
        b.box(stone, -lx / 2, lx / 2, -ly / 2, -ly / 2 + t, 0.14, h)
        b.box(stone, -lx / 2, lx / 2, ly / 2 - t, ly / 2, 0.14, h)
        b.box(stone, -lx / 2, -lx / 2 + t, -ly / 2 + t, ly / 2 - t, 0.14, h)
        b.box(stone, lx / 2 - t, lx / 2, -ly / 2 + t, ly / 2 - t, 0.14, h)
        b.face(water, [(-lx / 2 + t, -ly / 2 + t, h - 0.08), (lx / 2 - t, -ly / 2 + t, h - 0.08),
                       (lx / 2 - t, ly / 2 - t, h - 0.08), (-lx / 2 + t, ly / 2 - t, h - 0.08)])


# ---------------------------------------------------------------------------
# Props
# ---------------------------------------------------------------------------

def barrel(b: Builder, wood, iron, radius=0.36, length=0.95, seg=16, head=None):
    """Oak barrel standing on its end at the frame origin (rotate the frame to lay it down)."""
    prof = []
    for i in range(9):
        t = i / 8
        z = t * length
        bulge = 1.0 - 0.17 * (2 * t - 1) ** 2
        prof.append((radius * bulge, z))
    b.lathe(wood, prof, seg=seg, cap_bottom=False, cap_top=False)
    r_end = prof[0][0]
    hk = head or wood
    for z, flip in ((0.035, True), (length - 0.035, False)):
        ring = [((r_end - 0.02) * math.cos(2 * PI * i / seg), (r_end - 0.02) * math.sin(2 * PI * i / seg), z) for i in range(seg)]
        uv = [(p[0], p[1]) for p in ring]
        if flip:
            ring.reverse()
            uv.reverse()
        b.mesh(hk, ring, [list(range(seg))], [uv])
    # chime rims
    for z0, z1 in ((0.0, 0.035), (length - 0.035, length)):
        b.lathe(wood, [(r_end - 0.02, z0), (r_end - 0.02, z1)], seg=seg, cap_bottom=False, cap_top=False)
    for t in (0.06, 0.20, 0.36, 0.64, 0.80, 0.94):
        z = t * length
        rr = radius * (1.0 - 0.17 * (2 * t - 1) ** 2) + 0.006
        b.lathe(iron, [(rr, z - 0.022), (rr + 0.002, z), (rr, z + 0.022)], seg=seg, cap_bottom=False, cap_top=False)
    b.cyl(wood, (radius - 0.01, 0, length * 0.5), (radius + 0.035, 0, length * 0.5), 0.028, seg=6)


def barrel_lying(b: Builder, wood, iron, x, y, z, rz=0.0, radius=0.36, length=0.95, chocks=None):
    with b.place(x, y, z + radius, rz=rz):
        with b.at(Matrix.Rotation(PI / 2, 4, "Y") @ Matrix.Translation((0, 0, -length / 2))):
            barrel(b, wood, iron, radius, length)
        if chocks:
            for sx in (-length * 0.3, length * 0.3):
                b.box(chocks, sx - 0.05, sx + 0.05, -radius * 0.9, radius * 0.9, -radius - 0.0, -radius + 0.07, uv="longu")


def grape_tub(b: Builder, key, r_top=0.55, r_bot=0.42, h=0.62, fill_key=None, seg=28, color=None):
    """Round harvest tub (Bütte / Maischebottich); optional heap of grapes (foliage-atlas grape tile)."""
    t = 0.025
    prof = [(r_bot, 0.0), (r_top, h), (r_top + 0.03, h), (r_top + 0.03, h + 0.03), (r_top - t, h + 0.03),
            (r_bot - t, t)]
    b.lathe(key, prof, seg=seg, cap_bottom=True, cap_top=False, color=color, sharp=(1, 2, 3, 4))
    b.mesh(key, [((r_bot - t) * math.cos(2 * PI * i / seg), (r_bot - t) * math.sin(2 * PI * i / seg), t) for i in range(seg)],
           [list(range(seg))], [[(0, 0)] * seg], color=color)
    # two moulded stiffening rings + grab handles
    for zr in (h * 0.35, h * 0.78):
        rr = r_bot + (r_top - r_bot) * zr / h + 0.012
        b.lathe(key, [(rr - 0.012, zr - 0.03), (rr, zr - 0.015), (rr, zr + 0.015), (rr - 0.012, zr + 0.03)], seg=seg,
                cap_bottom=False, cap_top=False, color=color)
    if fill_key:
        u0, v0, u1, v1 = foliage_rect("grape_heap")
        # low, lumpy mound of loose berries: polar grid from the rim to ONE apex vertex (no converging ring of
        # vertices that would pinch the planar-projected texture), heights = dome + clumps of grapes
        rf = r_top - t - 0.01
        n_ring = 9
        hseg = 40
        rng = b.rng
        ph = [rng.uniform(0, 2 * PI) for _ in range(5)]

        def lump(x, y):
            # clumps of whole bunches (~10-15 cm) plus single proud berries: breaks up the grazing-angle sheen
            return (0.020 * math.sin(x * 23.0 + ph[0]) * math.sin(y * 19.0 + ph[1])
                    + 0.012 * math.sin(x * 41.0 + y * 13.0 + ph[2]) + 0.009 * math.sin(y * 47.0 - x * 11.0 + ph[3])
                    + 0.006 * math.sin(x * 83.0 + ph[4]) * math.sin(y * 79.0 - ph[0]))
        verts = []
        for k in range(n_ring):
            fr = 1.0 - k / n_ring                          # 1 at the rim .. 1/n_ring next to the apex
            for i in range(hseg):
                a = 2 * PI * (i + 0.5 * (k % 2)) / hseg
                r = rf * fr * (1.0 + (rng.uniform(-0.035, 0.035) if k > 0 else 0.0))
                x, y = r * math.cos(a), r * math.sin(a)
                z = h - 0.07 + 0.19 * (1.0 - fr ** 2) ** 0.8 + (lump(x, y) if k > 0 else 0.0)
                verts.append((x, y, z))
        apex = len(verts)
        verts.append((0.0, 0.0, h + 0.12 + lump(0.0, 0.0)))

        def uv(q):
            return (u0 + (u1 - u0) * (0.5 + 0.5 * verts[q][0] / rf), v0 + (v1 - v0) * (0.5 + 0.5 * verts[q][1] / rf))
        faces, uvs = [], []
        for k in range(n_ring - 1):
            for i in range(hseg):
                j = (i + 1) % hseg
                faces.append([k * hseg + i, k * hseg + j, (k + 1) * hseg + j, (k + 1) * hseg + i])
                uvs.append([uv(q) for q in faces[-1]])
        k = n_ring - 1
        for i in range(hseg):
            faces.append([k * hseg + i, k * hseg + (i + 1) % hseg, apex])
            uvs.append([uv(q) for q in faces[-1]])
        b.mesh(fill_key, verts, faces, uvs, smooth=True)


def crate(b: Builder, key, x, y, z, sx=0.6, sy=0.4, sz=0.3, rz=0.0, color=None, fill_key=None):
    """Stackable plastic grape crate (Lesekiste), open top with rim."""
    t = 0.02
    with b.place(x, y, z, rz=rz):
        b.box(key, -sx / 2, sx / 2, -sy / 2, sy / 2, 0, t, color=color)
        b.box(key, -sx / 2, sx / 2, -sy / 2, -sy / 2 + t, t, sz, color=color)
        b.box(key, -sx / 2, sx / 2, sy / 2 - t, sy / 2, t, sz, color=color)
        b.box(key, -sx / 2, -sx / 2 + t, -sy / 2 + t, sy / 2 - t, t, sz, color=color)
        b.box(key, sx / 2 - t, sx / 2, -sy / 2 + t, sy / 2 - t, t, sz, color=color)
        b.box(key, -sx / 2 - 0.012, sx / 2 + 0.012, -sy / 2 - 0.012, -sy / 2 + 0.0, sz - 0.05, sz, color=color)
        b.box(key, -sx / 2 - 0.012, sx / 2 + 0.012, sy / 2 - 0.0, sy / 2 + 0.012, sz - 0.05, sz, color=color)
        dark = (0.008, 0.008, 0.008)
        for sgn in (-1, 1):
            for fx in (-0.28, -0.14, 0.14, 0.28):       # stiffening ribs on the long sides
                b.box(key, fx * sx - 0.012, fx * sx + 0.012, sgn * sy / 2 - 0.008 * (sgn < 0) - 0.0, sgn * sy / 2 + 0.008 * (sgn > 0),
                      0.02, sz - 0.05, color=color)
            # grip slots on the short ends
            xg = sgn * (sx / 2 + 0.001)
            b.box(key, min(xg, xg + sgn * 0.002), max(xg, xg + sgn * 0.002), -0.07, 0.07, sz - 0.115, sz - 0.075, color=dark)
        if fill_key:
            u0, v0, u1, v1 = foliage_rect("grape_heap")
            zf = sz - 0.045
            b.mesh(fill_key, [(-sx / 2 + t, -sy / 2 + t, zf), (sx / 2 - t, -sy / 2 + t, zf), (sx / 2 - t, sy / 2 - t, zf),
                              (-sx / 2 + t, sy / 2 - t, zf)], [[0, 1, 2, 3]],
                   [[(u0, v0), (u1, v0), (u1, v0 + (v1 - v0) * 0.66), (u0, v0 + (v1 - v0) * 0.66)]])


def pallet(b: Builder, key, x, y, z, rz=0.0):
    with b.place(x, y, z, rz=rz):
        for yy in (-0.36, 0.0, 0.36):
            b.box(key, -0.6, 0.6, yy - 0.05, yy + 0.05, 0.0, 0.10, uv="longu")
        for i in range(5):
            xx = -0.6 + 0.05 + i * (1.1 / 4)
            b.box(key, xx - 0.05, xx + 0.05, -0.4, 0.4, 0.10, 0.122, uv="long")


def glow_wall(b: Builder, key, u, z, w, h, alpha=0.32, y=-0.008):
    """Soft light patch on a wall (current frame = wall frame, card faces -Y), centred on (u, z)."""
    c = (1.0, 1.0, 1.0, alpha)
    b.mesh(key, [(u - w / 2, y, z - h / 2), (u + w / 2, y, z - h / 2), (u + w / 2, y, z + h / 2), (u - w / 2, y, z + h / 2)],
           [[0, 1, 2, 3]], [[(0, 0), (1, 0), (1, 1), (0, 1)]], color=c)


def glow_ground(b: Builder, key, x, y, z, sx, sy, alpha=0.20):
    """Soft light pool on the ground (upward-facing card) centred on (x, y) at height z."""
    c = (1.0, 1.0, 1.0, alpha)
    b.mesh(key, [(x - sx / 2, y - sy / 2, z), (x + sx / 2, y - sy / 2, z), (x + sx / 2, y + sy / 2, z), (x - sx / 2, y + sy / 2, z)],
           [[0, 1, 2, 3]], [[(0, 0), (1, 0), (1, 1), (0, 1)]], color=c)


def wall_lantern(b: Builder, iron, lamp, u, v, reach=0.42, glow=None, ground_z=None):
    """Wrought-iron bracket lantern on a facade (facade coords; projects to -Y). With `glow` (an
    alpha-blended *_Lamp*_Emissive material) it also gets a light patch on the wall and a pool on the ground."""
    b.box(iron, u - 0.03, u + 0.03, -0.012, 0, v - 0.20, v + 0.22)
    b.tube(iron, [(u, 0, v + 0.18), (u, -reach * 0.5, v + 0.30), (u, -reach, v + 0.22)], 0.012, seg=6)
    b.tube(iron, [(u, 0, v - 0.16), (u, -reach * 0.55, v + 0.02), (u, -reach * 0.9, v + 0.2)], 0.008, seg=5)
    with b.place(u, -reach, v):
        b.cyl(iron, (0, 0, 0.16), (0, 0, 0.22), 0.012, seg=5)
        b.lathe(iron, [(0.10, 0.10), (0.03, 0.17)], seg=4, cap_bottom=True, cap_top=True)
        b.lathe(lamp, [(0.055, -0.13), (0.085, 0.10)], seg=4, cap_bottom=True, cap_top=False)
        for i in range(4):
            a = PI / 4 + i * PI / 2 - PI / 4
            b.beam(iron, (0.057 * math.cos(a), 0.057 * math.sin(a), -0.13), (0.087 * math.cos(a), 0.087 * math.sin(a), 0.10),
                   0.008, 0.008)
        b.lathe(iron, [(0.06, -0.15), (0.06, -0.13)], seg=4, cap_bottom=True, cap_top=True)
    if glow:
        glow_wall(b, glow, u, v - 0.35, 2.6, 3.2)
        if ground_z is not None:
            glow_ground(b, glow, u, -reach - 0.5, ground_z + 0.015, 3.6, 3.0)


def vine_wall(b: Builder, wood, fol, path, density=3.2, r=0.022, normal=(0, -1, 0), grapes=True):
    """Trained grapevine on a wall: gnarled stem along `path` + alpha-masked shoot / leaf cards.
    normal = direction away from the wall."""
    rng = b.rng
    pts = [Vector(p) for p in path]
    stem = []
    for i in range(len(pts) - 1):
        seg_len = (pts[i + 1] - pts[i]).length
        n = max(1, int(seg_len / 0.45))
        for k in range(n):
            p = pts[i].lerp(pts[i + 1], k / n)
            stem.append(p + Vector((rng.uniform(-0.03, 0.03), rng.uniform(-0.015, 0.015), rng.uniform(-0.03, 0.03))))
    stem.append(pts[-1])
    b.tube(wood, stem, r, seg=5)
    nrm = Vector(normal).normalized()
    up = Vector((0, 0, 1))
    face_kw = {"facing": nrm} if b.specs[fol].lit_cards else {}
    for i in range(len(pts) - 1):
        a, c = pts[i], pts[i + 1]
        L = (c - a).length
        axis = (c - a) / max(L, 1e-6)
        along = axis if abs(axis.z) < 0.8 else nrm.cross(up).normalized()   # horizontal direction along the wall
        vertical = abs(axis.z) >= 0.8
        count = max(1, int(L * density * (0.6 if vertical else 1.0)))
        for k in range(count):
            t = (k + rng.random()) / count
            base = a.lerp(c, t) + nrm * rng.uniform(0.03, 0.14)
            yaw = rng.uniform(-0.45, 0.45)
            right = (along * math.cos(yaw) + nrm * math.sin(yaw)).normalized()
            tile = f"shoot_{rng.randrange(4)}" if (grapes or rng.random() < 0.5) else "shoot_2"
            s = rng.uniform(0.75, 1.1)
            lean = (up + nrm * rng.uniform(-0.15, 0.25) + along * rng.uniform(-0.3, 0.3)).normalized()
            b.card(fol, tile, base - up * 0.12 * s, right, lean, 0.52 * s, 0.70 * s, flip=rng.random() < 0.5, **face_kw)
            # a second shoot hanging below the cane on horizontal runs
            if not vertical and rng.random() < 0.6:
                b.card(fol, f"shoot_{rng.choice((2, 2, 0, 1, 3))}", base + up * 0.10, right, -lean, 0.50 * s, 0.62 * s,
                       flip=rng.random() < 0.5, **face_kw)
        for _ in range(int(L * density * 2.5)):          # single leaves for volume
            t = rng.random()
            base = a.lerp(c, t) + nrm * rng.uniform(0.02, 0.16) + along * rng.uniform(-0.25, 0.25) + up * rng.uniform(-0.3, 0.35)
            ang = rng.uniform(0, 2 * PI)
            right = (along * math.cos(ang) + up * math.sin(ang)).normalized()
            upv = nrm.cross(right).normalized() + nrm * rng.uniform(-0.4, 0.4)
            b.card(fol, f"leaf_{rng.randrange(5)}", base, right, upv, 0.17, 0.17, anchor=(0.5, 0.5), **face_kw)


def vine_canopy(b: Builder, fol, x0, x1, y_fn, depth, z, rows=7, grapes=True):
    """Leafy vine roof over a pergola: ONE mat of overlapping, only slightly tilted foliage strips on the laths
    (a stack of steep strips shadows itself black at noon), a few loose shoots on top for a ragged silhouette,
    irregular shoots trailing over the open edge and grape clusters underneath. y_fn(x) = back edge (wall side).
    With a lit_cards material every card's normal leans to the sky, so the mat reads as sunlit translucent
    leaves from below and edge-on instead of a dark slab."""
    rng = b.rng
    lit = b.specs[fol].lit_cards
    up_z = Vector((0.0, 0.0, 1.0))

    def sky_normal(spread=0.18):
        return Vector((rng.uniform(-spread, spread), rng.uniform(-spread, spread), 1.0)).normalized() if lit else None
    for row in range(rows):
        fr = (row + 0.5) / rows
        x = x0 - 0.2 + rng.uniform(0, 0.5)
        k = 0
        while x < x1 + 0.1:
            sw = rng.uniform(1.2, 1.9)
            sd = sw * 0.305
            yc = y_fn(x) - depth * (1 - fr) + rng.uniform(-0.10, 0.10)
            zc = z + rng.uniform(-0.01, 0.09)
            yaw = rng.uniform(-0.35, 0.35)
            roll = rng.uniform(0.06, 0.30) * (1 if (k + row) % 2 == 0 else -1)     # tilt about the strip's long axis
            right = Vector((math.cos(yaw), math.sin(yaw), rng.uniform(-0.05, 0.05))).normalized()
            flat = Vector((-math.sin(yaw), math.cos(yaw), 0.0))
            side = (flat * math.cos(roll) + up_z * math.sin(roll)).normalized()
            if rng.random() < 0.5:
                side = -side
            b.card(fol, "leaf_wall", (x, yc, zc), right, side, sw, sd, anchor=(0.0, 0.5), flip=rng.random() < 0.5,
                   **({"normal": sky_normal()} if lit else {}))
            x += sw * rng.uniform(0.5, 0.7)
            k += 1
    # a few upright / leaning shoots on top
    n_up = int((x1 - x0) * depth * 0.8)
    for _ in range(n_up):
        x = rng.uniform(x0, x1)
        y = y_fn(x) - rng.uniform(0.0, depth)
        a = rng.uniform(0, PI)
        s = rng.uniform(0.5, 0.9)
        up = Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), 1.0)).normalized()
        b.card(fol, f"shoot_{rng.choice((0, 1, 2, 2, 3))}", (x, y, z + 0.02), (math.cos(a), math.sin(a), 0), up, 0.52 * s,
               0.70 * s, flip=rng.random() < 0.5)
    # shoots trailing over the open edge: irregular spacing, length, droop and lean; clusters only on some
    x = x0 + rng.uniform(0.0, 0.3)
    while x < x1:
        if rng.random() < 0.78:
            yf = y_fn(x) - depth - rng.uniform(0.02, 0.22)
            s = rng.uniform(0.55, 1.2)
            tile = f"shoot_{rng.choice((0, 1, 2, 2, 2, 3))}"
            yaw = rng.uniform(-0.6, 0.6)
            right = Vector((math.cos(yaw), math.sin(yaw), 0.0))
            down = Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.45, 0.15), -1.0)).normalized()
            b.card(fol, tile, (x, yf, z + rng.uniform(0.02, 0.12)), right, down, 0.52 * s, 0.70 * s,
                   flip=rng.random() < 0.5)
            if rng.random() < 0.3:                       # a second, shorter shoot from the same spot
                s2 = s * rng.uniform(0.5, 0.75)
                b.card(fol, f"shoot_{rng.choice((1, 2, 2))}", (x + rng.uniform(-0.15, 0.15), yf + 0.05, z + 0.06),
                       Vector((math.cos(yaw + 1.2), math.sin(yaw + 1.2), 0.0)), down, 0.52 * s2, 0.70 * s2,
                       flip=rng.random() < 0.5)
        x += rng.uniform(0.22, 1.0)
    if grapes:
        n = int((x1 - x0) * depth * 1.6)
        for _ in range(n):
            x = rng.uniform(x0, x1)
            y = y_fn(x) - rng.uniform(0.15, depth)
            ang = rng.uniform(0, PI)
            s = rng.uniform(1.2, 1.7)
            for da in (0.0, PI / 2):                   # two crossed cards per cluster
                b.card(fol, f"grape_{rng.randrange(3)}", (x, y, z - 0.02), (math.cos(ang + da), math.sin(ang + da), 0), (0, 0, -1),
                       0.10 * s, 0.19 * s)


def sign_panel(b: Builder, key, x0, x1, z0, z1, y, uv_rect, thick=0.02, back_key=None):
    """Flat sign facing -Y in the current frame; uv_rect = (u0, v0, u1, v1) in the sign atlas (0..1)."""
    u0, v0, u1, v1 = uv_rect
    b.mesh(key, [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], [[0, 1, 2, 3]],
           [[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]])
    if back_key:
        b.box(back_key, x0 - 0.012, x1 + 0.012, y + 0.001, y + thick, z0 - 0.012, z1 + 0.012)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def _glb_images(glb_path: Path) -> list[tuple[str, str, bytes]]:
    import struct
    data = glb_path.read_bytes()
    jl = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + jl])
    bin_start = 20 + jl + 8
    out = []
    for img in gltf.get("images", []):
        bv = gltf["bufferViews"][img["bufferView"]]
        off = bin_start + bv.get("byteOffset", 0)
        out.append((img.get("name", ""), img.get("mimeType", ""), data[off:off + bv["byteLength"]]))
    return out


def verify_embedded_textures(glb_path: Path):
    """Every embedded image must be the UNCHANGED source file (shared library or estates_textures), so the
    same image name always means the same bytes across all GLBs (runtime texture de-duplication)."""
    sources = {}
    for d in list(LIB_DIR.iterdir()) + [OWN_TEX_DIR]:
        if d.is_dir():
            for f in d.iterdir():
                if f.suffix.lower() in (".jpg", ".png", ".webp"):
                    sources.setdefault(f.stem, f)
    for name, mime, blob in _glb_images(glb_path):
        src = sources.get(name)
        if src is None:
            raise RuntimeError(f"{glb_path.name}: embedded image '{name}' has no source file in the texture library")
        if src.read_bytes() != blob:
            raise RuntimeError(f"{glb_path.name}: embedded image '{name}' ({mime}, {len(blob)} bytes) is not byte-identical "
                               f"to {src} – the exporter re-encoded it")


def write_colliders(key: str, site: Site, solids_local: list, replace_footprint: bool = True):
    """Read-modify-write our key in public/assets/models/landmarks/colliders.json (world [x, z] polygons).
    Other agents' keys are kept untouched."""
    import os
    path = GLB_OUT_DIR / "colliders.json"
    solids = []
    for poly in solids_local:
        if len(poly) < 3:
            raise RuntimeError(f"collider for {key}: polygon with fewer than 3 points: {poly}")
        solids.append([[round(v, 2) for v in site.world(x, y)] for x, y in poly])
    data = {}
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise RuntimeError(f"{path} is not a JSON object")
    data[key] = {"replaceFootprint": bool(replace_footprint), "solids": solids}
    tmp = path.with_suffix(".json.tmp_estates")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
    print(f"[estates] colliders.json: wrote '{key}' ({len(solids)} solids, replaceFootprint={replace_footprint}); "
          f"keys now {sorted(data)}")


def rect_poly(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def export_landmark(key: str, objects: list, site: Site | None = None, solids: list | None = None,
                    replace_footprint: bool = True) -> dict:
    blend_path = LANDMARKS_DIR / f"{key}.blend"
    glb_path = GLB_OUT_DIR / f"{key}.glb"
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    if not objects:
        raise RuntimeError(f"export_landmark({key}): no objects to export")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",          # JPEG / PNG / WebP sources are embedded as the unchanged files
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=14,
        export_draco_color_quantization=10,
    )
    verify_embedded_textures(glb_path)
    tris = sum(len(p.vertices) - 2 for o in objects for p in o.data.polygons)
    size_mb = glb_path.stat().st_size / (1024 * 1024)
    print(f"[estates] exported {glb_path.name}: {size_mb:.2f} MB, {tris} triangles, {len(objects)} meshes (Draco)")
    if size_mb > 10.0:
        raise RuntimeError(f"{glb_path.name} is {size_mb:.2f} MB – over the 10 MB landmark budget")
    if tris > 300_000:
        raise RuntimeError(f"{glb_path.name} has {tris} triangles – over the 300k landmark budget")
    if solids is not None:
        if site is None:
            raise RuntimeError("export_landmark: solids given without a Site")
        write_colliders(key, site, solids, replace_footprint)
    return {"sizeMB": size_mb, "triangles": tris, "meshes": len(objects)}
