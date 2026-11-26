"""
Material definitions for the recreation assets + the shared-library binding contract.

Model GLBs do NOT embed the tiling PBR maps. Every material that uses the shared CC0 library carries
custom properties (exported as glTF `extras`, i.e. three `material.userData`):

    lib          library material id (e.g. "wood_beam_oak")
    libMaps      "all" | "no_albedo"  (no_albedo: keep the flat base colour, use normal + ORM only)
    colorBoost   scalar multiplied into the base-colour factor at runtime (glTF factors are <= 1)
    normalScale  normal-map strength

The maps themselves are exported once into `recreation_materials.glb` (materials `Lib_<id>`), which
`src/recreation.ts` loads first and binds onto every model material by `userData.lib`. UVs in the
model GLBs are already in "library tiles" (metres / tileSizeM), so no texture transform is needed.
"""

from __future__ import annotations

import json
from pathlib import Path

import bpy

from rec_toolkit import load_image

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
LIB_DIR = PROJECT_ROOT / "blender" / "shared_textures"
EXTRA_DIR = LIB_DIR / "_extra_recreation"
REC_TEX_DIR = SCRIPT_DIR / "textures"


def srgb(hex_or_rgb) -> tuple[float, float, float]:
    """sRGB (0-255 tuple or 0xRRGGBB) -> linear floats."""
    if isinstance(hex_or_rgb, int):
        rgb = ((hex_or_rgb >> 16) & 255, (hex_or_rgb >> 8) & 255, hex_or_rgb & 255)
    else:
        rgb = hex_or_rgb
    out = []
    for c in rgb:
        c = c / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# Library maps exported into recreation_materials.glb: id -> which maps are shipped.
# Fix round: the maps are embedded as the UNCHANGED library `_1k` files (same image name == same
# bytes in every GLB of the project, so the runtime de-duplication is exact). To stay inside the
# 12 MB recreation budget with un-recompressed JPEGs, only the maps that visibly matter are shipped;
# a material without ORM uses a flat roughness (`roughFlat`, from the library's average).
LIB_MAPS = {
    "red_clay_court": ("albedo", "normal", "orm"),
    "grass": ("albedo",),
    "sand": ("albedo", "normal"),
    "bark_mulch": ("albedo", "normal", "orm"),
    "concrete": ("albedo", "normal"),
    "paving_stones": ("albedo", "normal", "orm"),
    "wood_beam_oak": ("albedo", "normal", "orm"),
    "metal_galvanized": ("albedo", "orm"),
    "metal_painted": ("albedo", "normal"),
    "plaster_smooth": ("albedo", "normal"),
    "roof_tiles_clay_weathered": ("albedo", "normal"),
    "roof_tiles_clay_red": ("albedo", "normal"),
}

# Materials that are not in the shared library. bark_mulch is Poly Haven "Wood Chips" (CC0, source
# files in blender/shared_textures/_extra_recreation/); generate_textures.py writes the size-reduced
# copies that are shipped. The names are unique to this area, so no other GLB can collide with them.
EXTRA_LIB = {
    "bark_mulch": {
        "tileSizeM": [2.0, 2.0],
        "avgRoughness": 0.9,
        "files": {
            "albedo": REC_TEX_DIR / "bark_mulch_albedo_1k.jpg",
            "normal": REC_TEX_DIR / "bark_mulch_normal_512.jpg",
            "orm": REC_TEX_DIR / "bark_mulch_orm_512.jpg",
        },
    },
}


def load_library() -> dict:
    path = LIB_DIR / "library.json"
    if not path.exists():
        raise FileNotFoundError(f"Shared texture library not found: {path}")
    data = json.loads(path.read_text())
    lib = {m["id"]: m for m in data["materials"]}
    for mid, extra in EXTRA_LIB.items():
        lib[mid] = {"id": mid, "tileSizeM": extra["tileSizeM"], "extraFiles": extra["files"], "avgRoughness": extra["avgRoughness"], "avgMetalness": 0.0}
    missing = [mid for mid in LIB_MAPS if mid not in lib]
    if missing:
        raise RuntimeError(f"Shared texture library is missing materials needed by recreation: {missing}")
    return lib


def lib_tile(lib: dict, mid: str) -> tuple[float, float]:
    t = lib[mid]["tileSizeM"]
    return (float(t[0]), float(t[1]))


# ---------------------------------------------------------------------------
# Model material specs
# ---------------------------------------------------------------------------
# lib:      library id (None = flat PBR colour or unique texture)
# color:    linear base-colour factor (multiplies the library albedo); boost: runtime multiplier
# rough:    with lib = roughness-map multiplier, without = absolute roughness
# swap:     library grain runs along V -> map "along the member" to V
# world_uv: box-project in model space instead of per primitive (continuous plaster / concrete)
# grime:    ground-contact darkening strength (vertex colour), grime_h: height of the gradient
MATS: dict[str, dict] = {
    # timber -------------------------------------------------------------------------
    "wood_robinia": dict(lib="wood_beam_oak", color=(1.0, 0.78, 0.55), boost=1.55, swap=True, jitter=0.12, grime=0.30, grime_h=0.45),
    "wood_plank": dict(lib="wood_beam_oak", color=(1.0, 0.80, 0.58), boost=1.75, swap=True, jitter=0.14, grime=0.22, grime_h=0.3),
    "wood_dark": dict(lib="wood_beam_oak", color=(0.62, 0.42, 0.28), boost=1.0, swap=True, jitter=0.08, grime=0.15),
    "wood_grey": dict(lib="wood_beam_oak", color=(1.0, 0.97, 0.92), boost=1.25, swap=True, jitter=0.12, grime=0.25),
    # metals -------------------------------------------------------------------------
    "steel_galv": dict(lib="metal_galvanized", color=(0.92, 0.93, 0.94), metal=1.0, rough=0.85, swap=True, jitter=0.03, grime=0.18, grime_h=0.25),
    "gutter": dict(name="Rec_steel_gutter", lib="metal_galvanized", color=(0.86, 0.87, 0.88), metal=1.0, rough=0.9, swap=True, double=True, jitter=0.0),
    "steel_stainless": dict(lib="metal_galvanized", maps="no_albedo", color=(0.80, 0.81, 0.82), metal=1.0, rough=0.3, normal=0.3, jitter=0.0, grime=0.06),
    "alu_plate": dict(lib="metal_galvanized", color=(0.82, 0.83, 0.84), metal=1.0, rough=0.7, jitter=0.02, grime=0.1),
    "steel_dark": dict(lib="metal_painted", color=srgb((52, 56, 60)), rough=0.9, jitter=0.03, grime=0.15),
    "paint_white": dict(lib="metal_painted", color=srgb((236, 238, 236)), boost=1.25, rough=0.8, jitter=0.02, grime=0.2, grime_h=0.3),
    "paint_green": dict(lib="metal_painted", color=srgb((40, 96, 58)), boost=1.5, rough=0.85, jitter=0.04, grime=0.15),
    "paint_red": dict(lib="metal_painted", color=srgb((186, 44, 38)), boost=1.5, rough=0.85, jitter=0.04, grime=0.15),
    "paint_blue": dict(lib="metal_painted", color=srgb((38, 92, 168)), boost=1.5, rough=0.85, jitter=0.04, grime=0.15),
    "paint_yellow": dict(lib="metal_painted", color=srgb((226, 172, 32)), boost=1.5, rough=0.85, jitter=0.04, grime=0.15),
    # HDPE play panels / plastics ---------------------------------------------------------
    "hdpe_red": dict(color=srgb((196, 46, 40)), rough=0.46, jitter=0.05, grime=0.12),
    "hdpe_blue": dict(color=srgb((36, 98, 176)), rough=0.46, jitter=0.05, grime=0.12),
    "hdpe_yellow": dict(color=srgb((236, 184, 38)), rough=0.46, jitter=0.05, grime=0.12),
    "hdpe_green": dict(color=srgb((58, 140, 70)), rough=0.46, jitter=0.05, grime=0.12),
    "hdpe_orange": dict(color=srgb((224, 112, 36)), rough=0.46, jitter=0.05, grime=0.12),
    "hdpe_black": dict(color=srgb((34, 35, 37)), rough=0.46, jitter=0.03, grime=0.08),
    "hdpe_white": dict(color=srgb((232, 232, 226)), rough=0.46, jitter=0.03, grime=0.15),
    "rubber": dict(color=srgb((36, 37, 40)), rough=0.86, jitter=0.04, grime=0.0),
    # mineral ------------------------------------------------------------------------
    "concrete": dict(lib="concrete", color=(1.0, 1.0, 1.0), boost=1.35, world_uv=True, jitter=0.0, grime=0.18, grime_h=0.3),
    "concrete_white": dict(lib="concrete", color=(1.0, 0.99, 0.95), boost=3.3, world_uv=True, jitter=0.0, grime=0.22, grime_h=0.25),
    "concrete_old": dict(lib="concrete", color=(1.0, 0.98, 0.93), boost=1.9, world_uv=True, jitter=0.0, grime=0.2),
    "paving": dict(lib="paving_stones", color=(1.0, 1.0, 1.0), boost=1.25, world_uv=True, jitter=0.0),
    "plaster_cream": dict(lib="plaster_smooth", color=srgb((250, 240, 214)), boost=1.42, world_uv=True, jitter=0.0, grime=0.16, grime_h=0.5),
    "plaster_grey": dict(lib="plaster_smooth", color=srgb((150, 146, 138)), boost=1.2, world_uv=True, jitter=0.0, grime=0.2, grime_h=0.3),
    "tt_top": dict(lib="concrete", color=srgb((70, 118, 104)), boost=2.2, rough=0.55, normal=0.4, world_uv=True, jitter=0.0),
    "sand": dict(lib="sand", color=(1.0, 1.0, 1.0), boost=1.5, jitter=0.03),
    # roofs (explicit UVs: u along the eave, v up the slope) ------------------------------------
    "roof_old": dict(lib="roof_tiles_clay_weathered", color=(0.78, 0.62, 0.52), boost=1.0, jitter=0.0),
    "roof_red": dict(lib="roof_tiles_clay_red", color=(1.0, 0.95, 0.9), boost=1.0, jitter=0.0),
    "roof_dark": dict(lib="roof_tiles_clay_weathered", color=(0.42, 0.42, 0.44), boost=1.0, jitter=0.0),
    # glass / light ----------------------------------------------------------------------
    "glass": dict(name="Glass_Window_Sportheim", color=srgb((30, 38, 44)), rough=0.08, metal=0.0, jitter=0.0),
    "polycarb": dict(name="Rec_Polycarbonate_Clear", color=srgb((176, 206, 224)), rough=0.12, metal=0.0, alpha=0.34, double=True, jitter=0.0),
    "lens": dict(name="Floodlight_Lens_Lamp", color=srgb((214, 224, 232)), rough=0.14, metal=0.0, emissive=(1.0, 0.94, 0.82), jitter=0.0),
    "lamp_wall": dict(name="Rec_Lamp_Wall_Emissive", color=srgb((236, 232, 220)), rough=0.3, metal=0.0, emissive=(1.0, 0.86, 0.62), jitter=0.0),
    # unique textures ----------------------------------------------------------------------
    "net": dict(tex="rec_net", tile=(0.48, 0.48), alpha_tex=True, double=True, rough=0.8, jitter=0.0),
    "chain": dict(tex="rec_chain", alpha_tex=True, double=True, rough=0.45, metal=1.0, jitter=0.0),
    "mesh_steel": dict(tex="rec_chainlink", tile=(0.06, 0.06), alpha_tex=True, double=True, rough=0.5, metal=1.0, jitter=0.0),
    "rope_red": dict(tex="rec_rope", normal_tex=True, tile=(0.08, 0.06), color=srgb((190, 44, 40)), rough=0.85, jitter=0.05),
    "rope_blue": dict(tex="rec_rope", normal_tex=True, tile=(0.08, 0.06), color=srgb((40, 92, 160)), rough=0.85, jitter=0.05),
    "rope_black": dict(tex="rec_rope", normal_tex=True, tile=(0.08, 0.06), color=srgb((46, 46, 48)), rough=0.85, jitter=0.05),
    "rope_hemp": dict(tex="rec_rope", normal_tex=True, tile=(0.08, 0.06), color=srgb((188, 160, 112)), rough=0.9, jitter=0.06),
    "sign_sportheim": dict(tex="rec_sportheim_sign", rough=0.5, jitter=0.0),
    "sign_scoreboard": dict(tex="rec_scoreboard", rough=0.55, jitter=0.0),
    "sign_spielplatz": dict(tex="rec_spielplatz_sign", rough=0.4, jitter=0.0),
    "decals": dict(tex="rec_decals", rough=0.55, jitter=0.0),
}

# Atlas rectangles (u0, v0, u1, v1) in rec_decals_albedo.png, v pointing up.
DECALS = {
    "door_heim": (0.0, 0.75, 0.333, 1.0),
    "door_gast": (0.333, 0.75, 0.666, 1.0),
    "door_ref": (0.666, 0.75, 1.0, 1.0),
    "kiosk": (0.0, 0.5, 1.0, 0.75),
    "notice": (0.0, 0.25, 1.0, 0.5),
    "rules": (0.0, 0.0, 0.5, 0.25),
    "street_no": (0.5, 0.0, 1.0, 0.25),
}


def resolve_spec(key: str, lib: dict) -> dict:
    if key not in MATS:
        raise KeyError(f"Unknown recreation material key '{key}'")
    spec = dict(MATS[key])
    if spec.get("lib"):
        if spec["lib"] not in LIB_MAPS:
            raise KeyError(f"Material '{key}' uses library id '{spec['lib']}' that is not exported in LIB_MAPS")
        spec["rough_flat"] = max(0.05, min(1.0, float(lib[spec["lib"]]["avgRoughness"]) * spec.get("rough", 1.0)))
        spec.setdefault("tile", lib_tile(lib, spec["lib"]))
    spec.setdefault("tile", (1.0, 1.0))
    return spec


def _principled(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return nt, bsdf


def get_material(key: str, spec: dict):
    name = spec.get("name", f"Rec_{key}")
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    nt, bsdf = _principled(mat)
    col = spec.get("color", (1.0, 1.0, 1.0))
    bsdf.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1.0)
    bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)
    if spec.get("lib"):
        # roughness factor is a multiplier for the library roughness map (bound at runtime)
        bsdf.inputs["Roughness"].default_value = min(1.0, spec.get("rough", 1.0))
        mat["lib"] = spec["lib"]
        mat["libMaps"] = spec.get("maps", "all")
        mat["colorBoost"] = float(spec.get("boost", 1.0))
        mat["normalScale"] = float(spec.get("normal", 1.0))
        mat["roughScale"] = float(spec.get("rough", 1.0))
        mat["roughFlat"] = float(spec["rough_flat"])
    else:
        bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.6)
    if spec.get("tex"):
        img = load_image(REC_TEX_DIR / f"{spec['tex']}_albedo.png", f"{spec['tex']}_albedo", "sRGB")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.location = (-520, 200)
        if "color" in spec:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs["B"].default_value = (col[0], col[1], col[2], 1.0)
            mix.location = (-200, 200)
            nt.links.new(tex.outputs["Color"], mix.inputs["A"])
            nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if spec.get("alpha_tex"):
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.surface_render_method = "BLENDED"
        if spec.get("normal_tex"):
            nimg = load_image(REC_TEX_DIR / f"{spec['tex']}_normal.png", f"{spec['tex']}_normal", "Non-Color")
            ntex = nt.nodes.new("ShaderNodeTexImage")
            ntex.image = nimg
            ntex.location = (-520, -260)
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nmap.location = (-200, -260)
            nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if "alpha" in spec:
        bsdf.inputs["Alpha"].default_value = spec["alpha"]
        mat.surface_render_method = "BLENDED"
    if "emissive" in spec:
        e = spec["emissive"]
        bsdf.inputs["Emission Color"].default_value = (e[0], e[1], e[2], 1.0)
        # strength 0: lamps are switched on by src/recreation.ts (setTimeOfDay / setDuskMode)
        bsdf.inputs["Emission Strength"].default_value = 0.0
        mat["lampEmissive"] = [float(e[0]), float(e[1]), float(e[2])]
    mat.use_backface_culling = not spec.get("double", False)
    return mat


# ---------------------------------------------------------------------------
# Library material GLB
# ---------------------------------------------------------------------------

def _lib_image(lib: dict, mid: str, kind: str):
    """Loads the unchanged library `_1k` file (or our own extra file); the datablock keeps the file stem."""
    entry = lib[mid]
    colorspace = "sRGB" if kind == "albedo" else "Non-Color"
    if "extraFiles" in entry:
        path = entry["extraFiles"][kind]
    else:
        key = f"{kind}_1k"
        if key not in entry["files"]:
            raise KeyError(f"library.json has no '{key}' file for '{mid}'")
        path = PROJECT_ROOT / entry["files"][key]
    return load_image(path, path.stem, colorspace)


def _gltf_output_group():
    """The exporter reads ambient occlusion from a node group called 'glTF Material Output'."""
    name = "glTF Material Output"
    ng = bpy.data.node_groups.get(name)
    if ng is None:
        ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.nodes.new("NodeGroupInput")
    return ng


def _avg_albedo_linear(lib: dict, mid: str, img) -> list[float]:
    """Mean linear albedo: ground shaders divide by it to keep the photo detail but set their own colour."""
    entry = lib[mid]
    if "avgAlbedoLinear" in entry:
        return [float(c) for c in entry["avgAlbedoLinear"]]
    import numpy as np

    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)  # 8-bit images come back sRGB-encoded -> linearise before averaging
    c = px.reshape(-1, 4)[:, :3]
    rgb = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).mean(axis=0)
    return [float(c) for c in rgb]


def build_library_material(lib: dict, mid: str):
    maps = LIB_MAPS[mid]
    mat = bpy.data.materials.new(f"Lib_{mid}")
    nt, bsdf = _principled(mat)
    if "albedo" not in maps:
        raise ValueError(f"Library material '{mid}' must at least ship its albedo")
    alb = nt.nodes.new("ShaderNodeTexImage")
    alb.image = _lib_image(lib, mid, "albedo")
    alb.location = (-700, 320)
    nt.links.new(alb.outputs["Color"], bsdf.inputs["Base Color"])
    if "orm" in maps:
        orm = nt.nodes.new("ShaderNodeTexImage")
        orm.image = _lib_image(lib, mid, "orm")
        orm.location = (-700, 0)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-380, 0)
        nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        grp = nt.nodes.new("ShaderNodeGroup")
        grp.node_tree = _gltf_output_group()
        grp.location = (100, -420)
        nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    else:
        bsdf.inputs["Roughness"].default_value = float(lib[mid]["avgRoughness"])
        bsdf.inputs["Metallic"].default_value = 0.0
    if "normal" in maps:
        nrm = nt.nodes.new("ShaderNodeTexImage")
        nrm.image = _lib_image(lib, mid, "normal")
        nrm.location = (-700, -320)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-380, -320)
        nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    tw, th = lib_tile(lib, mid)
    mat["avgAlbedo"] = _avg_albedo_linear(lib, mid, alb.image)
    mat["avgRoughness"] = float(lib[mid]["avgRoughness"])
    mat["libId"] = mid
    mat["libMapsShipped"] = ",".join(maps)
    mat["tileW"] = tw
    mat["tileH"] = th
    return mat


def build_extra_surface_material(key: str):
    """Unique alpha textures needed by the TypeScript-built fences (exported with the library GLB).

    The library GLB embeds files byte-for-byte (PNG), the model GLBs re-encode their textures as WebP.
    Both copies must therefore carry DIFFERENT image names (the runtime de-duplicates by name and
    throws when one name maps to different pixels): the library copy gets the suffix `_lib`.
    """
    spec = resolve_spec(key, {})
    if not spec.get("tex") or not spec.get("alpha_tex"):
        raise ValueError(f"extra library surface '{key}' must be an alpha-textured material")
    mat = bpy.data.materials.new(f"Lib_rec_{key}")
    nt, bsdf = _principled(mat)
    # the exporter names embedded files after their file stem, so the library copy is a renamed file
    import shutil

    src = REC_TEX_DIR / f"{spec['tex']}_albedo.png"
    lib_copy = REC_TEX_DIR / f"{spec['tex']}_lib_albedo.png"
    if not src.exists():
        raise FileNotFoundError(f"Texture file missing: {src} (run generate_textures.py)")
    if not lib_copy.exists() or lib_copy.read_bytes() != src.read_bytes():
        shutil.copyfile(src, lib_copy)
    img = load_image(lib_copy, lib_copy.stem, "sRGB")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.6)
    bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)
    mat.surface_render_method = "BLENDED"
    mat.use_backface_culling = False
    mat["libId"] = f"rec_{key}"
    mat["libMapsShipped"] = "albedo"
    mat["avgAlbedo"] = [1.0, 1.0, 1.0]
    mat["avgRoughness"] = float(spec.get("rough", 0.6))
    mat["tileW"] = spec["tile"][0]
    mat["tileH"] = spec["tile"][1]
    return mat
