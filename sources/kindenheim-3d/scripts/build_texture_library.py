#!/usr/bin/env python3
"""Build the shared CC0 PBR texture library in blender/shared_textures/.

Reproducible: every material below names its exact source asset. Only two sources are
used, both CC0: Poly Haven (https://api.polyhaven.com) and ambientCG (https://ambientcg.com).

    python3 scripts/build_texture_library.py                 # build everything that is not built yet
    python3 scripts/build_texture_library.py --only brick_red,grass
    python3 scripts/build_texture_library.py --force         # rebuild from the cached downloads
    python3 scripts/build_texture_library.py --sheet-only    # only re-render contact_sheet.jpg

Needs Python 3.10+, Pillow and numpy. Runs outside Blender.

Output per material <id> (see .gfx/BRIEF.md, "Shared CC0 PBR texture library"):
    <id>/<id>_albedo.jpg      sRGB, 2048 px, seamless
    <id>/<id>_normal.jpg      tangent space, OpenGL (+Y) convention
    <id>/<id>_orm.jpg         R = AO, G = roughness, B = metalness
    <id>/<id>_{albedo,normal,orm}_1k.jpg   1024 px variants
library.json is rewritten atomically after every finished material; "complete" turns true
only once every planned id is either built or listed under "missing".

Downloads are untrusted data: they are stored under _downloads/<id>/ (never shipped), only
image files are read from them (decoded with Pillow), nothing is executed.
Any failure raises immediately with the cause — there are no silent fallbacks. The only
defaults are the ones the library contract defines: white AO / zero metalness where the
source material has no such map (recorded per material under "maps").
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import io
import json
import os
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFile

Image.MAX_IMAGE_PIXELS = 9000 * 9000
# optimize=True needs the whole JPEG in one encoder buffer; the default is too small for noisy 2K maps
# (Pillow then dies with "Suspension not allowed here").
ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 2048 * 2048 * 4)

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "blender" / "shared_textures"
DOWNLOADS = LIB / "_downloads"
LIBRARY_JSON = LIB / "library.json"
CONTACT_SHEET = LIB / "contact_sheet.jpg"

USER_AGENT = "texture-library-builder/1.0"
SIZE = 2048
SIZE_1K = 1024
JPEG_QUALITY = 92

PLANNED_IDS = [
    "plaster_smooth", "plaster_rough", "plaster_weathered",
    "sandstone_red_ashlar", "sandstone_yellow_ashlar", "sandstone_rubble_wall",
    "roof_tiles_clay_red", "roof_tiles_clay_weathered", "roof_tiles_dark", "roof_slate",
    "wood_planks_weathered", "wood_beam_oak",
    "brick_red", "wood_planks_painted", "bark_deciduous",
    "metal_corrugated", "metal_galvanized", "metal_rusty", "metal_painted",
    "concrete", "concrete_weathered", "asphalt", "asphalt_worn", "cobblestone",
    "paving_stones", "gravel", "soil_ploughed", "grass", "sand", "red_clay_court",
    "rubber_tire", "leather_seat", "plastic_rough",
]

# ---------------------------------------------------------------------------------------
# Material table, in build order (what blocks the most model agents comes first).
#   site        "polyhaven" | "ambientcg"
#   asset       asset id on that site
#   description one line, shown in library.json
#   recolor     optional {"hue_deg", "sat_mul", "val_mul"} HSV shift applied to the albedo
#               (only where no fitting scan exists; always stated in the description)
#               or {"neutral_mean_linear", "contrast"} (see recolor_albedo)
#   flatten_normal_profile  optional True: remove a V-constant relief profile (corrugation) from the
#               normal map (see flatten_normal_profile); always stated in the description
#   rough_add   optional constant added to the roughness map (only for an authored, non-scanned source
#               whose gloss level does not fit the planned id); always stated in the description
#   tile_m      optional [w, h] override in metres, ONLY for sources without dimension
#               metadata; recorded as tileSizeSource "estimated"
# ---------------------------------------------------------------------------------------
MATERIALS: list[dict] = [
    dict(id="plaster_smooth", site="polyhaven", asset="white_stucco",
         description="Smooth off-white painted render (fine float finish); neutral, meant to be tinted "
                     "via base-colour factor."),
    dict(id="plaster_rough", site="polyhaven", asset="white_stucco_02",
         description="Rough light-grey mineral render with open grain and small pits (Rauputz); neutral, "
                     "tintable."),
    dict(id="plaster_weathered", site="polyhaven", asset="plastered_wall_03",
         description="Old grey-brown cement/lime render with stains, patches and hairline flaws; 4 m tile "
                     "for barns and outbuildings."),
    dict(id="sandstone_red_ashlar", site="polyhaven", asset="sandstone_blocks_08",
         recolor=dict(hue_deg=-24.0, sat_mul=1.45, val_mul=0.80),
         description="Dressed sandstone ashlar, large coursed blocks with thin joints. DERIVED: albedo of "
                     "the buff scan hue/value-shifted to Palatinate Buntsandstein red (no fitting scanned "
                     "red ashlar on either source); normal/ORM unchanged."),
    dict(id="sandstone_yellow_ashlar", site="polyhaven", asset="sandstone_blocks_08",
         description="Dressed buff/yellow sandstone ashlar, large coursed blocks with thin joints; colour "
                     "as scanned."),
    dict(id="sandstone_rubble_wall", site="polyhaven", asset="stone_wall",
         description="Irregular yellow-grey rubble masonry (Bruchsteinmauerwerk) with recessed joints and "
                     "some lichen; yard and vineyard walls, barn plinths."),
    dict(id="roof_tiles_clay_red", site="polyhaven", asset="clay_roof_tiles_03",
         description="Red clay plain tiles (Biberschwanz-type, straight cut) in regular courses, fairly "
                     "new; eaves run along the tile's bottom edge (V down the slope)."),
    dict(id="roof_tiles_clay_weathered", site="polyhaven", asset="roof_09",
         description="Old weathered clay pantiles, red-brown with grey patina and lichen; V runs down the "
                     "slope."),
    dict(id="roof_tiles_dark", site="polyhaven", asset="grey_roof_tiles",
         description="Dark grey/anthracite roof tiles with moss and yellow lichen streaks; V runs down the "
                     "slope."),
    dict(id="roof_slate", site="polyhaven", asset="grey_roof_tiles_02",
         description="Natural blue-grey slate in rectangular courses (church/tower roofs, slate-hung "
                     "gables); V runs down the slope."),
    dict(id="wood_planks_weathered", site="polyhaven", asset="old_planks_02",
         description="Weathered grey-brown barn boards, vertical, with knots, nail heads and open joints; "
                     "boards run along V."),
    dict(id="wood_beam_oak", site="polyhaven", asset="rough_wood",
         description="Old weathered oak timber surface with deep checks and open grain (0.5 m tile, grain "
                     "along V); grey-brown as scanned, tint dark brown for stained half-timber beams."),
    dict(id="brick_red", site="polyhaven", asset="red_brick",
         description="Red clay facing brick in stretcher bond with grey cement joints, lightly weathered."),
    dict(id="wood_planks_painted", site="polyhaven", asset="white_planks_clean",
         description="Painted tongue-and-groove boards, off-white, vertical (boards along V); neutral so "
                     "doors, shutters, gates and fences can be tinted via base-colour factor."),
    dict(id="bark_deciduous", site="polyhaven", asset="bark_brown_02",
         description="Furrowed grey-brown deciduous tree bark with some moss and knots; furrows run along "
                     "V (up the trunk); one tile = 1 m of trunk circumference."),
    dict(id="metal_corrugated", site="polyhaven", asset="corrugated_iron_02",
         description="Weathered grey corrugated steel sheet for sheds and barn roofs; corrugations run "
                     "along V."),
    dict(id="metal_galvanized", site="polyhaven", asset="corrugated_iron", flatten_normal_profile=True,
         description="Galvanised (zinc-coated) steel sheet with visible zinc spangle, light grey; gutters, "
                     "downpipes, posts, railings, troughs. DERIVED: scanned from a corrugated galvanised "
                     "sheet (no flat galvanised scan on either source); the corrugation profile is removed "
                     "from the normal map so it reads as flat sheet, albedo/ORM as scanned."),
    dict(id="metal_rusty", site="polyhaven", asset="rusty_metal_04",
         description="Heavily rusted steel sheet with remnants of grey paint (old machinery, tanks, gates)."),
    dict(id="concrete", site="polyhaven", asset="brushed_concrete",
         description="Plain grey cast concrete with a light brushed finish and fine pores; neutral."),
    dict(id="concrete_weathered", site="polyhaven", asset="dirty_concrete",
         description="Old light-grey concrete with dirt blotches, stains and surface wear."),
    dict(id="asphalt", site="polyhaven", asset="clean_asphalt",
         description="Intact dark grey asphalt with fine aggregate (village streets, newer surfaces)."),
    dict(id="asphalt_worn", site="polyhaven", asset="asphalt_04",
         description="Old sun-bleached rural asphalt, light grey with patches, exposed aggregate and fine "
                     "cracks (farm tracks, side roads); 4 m tile."),
    dict(id="cobblestone", site="polyhaven", asset="cobblestone_floor_08",
         description="Grey granite/basalt setts (Kopfsteinpflaster) in irregular rows with sandy joints."),
    dict(id="gravel", site="polyhaven", asset="gravel_floor_02",
         description="Fine light-grey limestone chippings (Schotter/Splitt) for yards, paths and track "
                     "shoulders."),
    dict(id="soil_ploughed", site="polyhaven", asset="farm_soil",
         description="Freshly tilled brown field soil with clods in faint rows (rows along V)."),
    dict(id="leather_seat", site="polyhaven", asset="leather_white",
         description="Fine-grain seat leather/vinyl, light neutral grey (0.3 m tile); tint black or brown "
                     "via base-colour factor."),
    dict(id="paving_stones", site="polyhaven", asset="concrete_pavers_02",
         description="Grey-brown rectangular concrete block paving (Betonpflaster) in running bond with "
                     "sanded joints; pavements, yards, driveways."),
    dict(id="grass", site="polyhaven", asset="forrest_ground_01",
         description="Short mown grass with clover, thatch and a little bare soil, seen from above (lawns, "
                     "verges, sports turf); tint greener/darker via base-colour factor."),
    dict(id="sand", site="polyhaven", asset="dense_sand",
         description="Compacted beige fine sand with faint damp patches (sandpits, volleyball court, "
                     "riding/play areas)."),
    dict(id="red_clay_court", site="polyhaven", asset="red_sand",
         description="Fine red-brown crushed-clay surface (Tennenplatz / clay court), even and matt; 3 m "
                     "tile."),
    dict(id="metal_painted", site="polyhaven", asset="green_metal_rust",
         recolor=dict(neutral_mean_linear=0.42, contrast=0.5),
         description="Painted steel sheet with scratches, chips and a few run marks. DERIVED: the green "
                     "scan's albedo is desaturated to neutral light grey (value contrast halved) so vehicles, gates and signs can "
                     "be tinted to any paint colour (no neutral painted-metal scan on either source); "
                     "normal/ORM unchanged."),
    dict(id="rubber_tire", site="ambientcg", asset="Rubber004",
         description="Plain matt black rubber with fine grain for tyres, hoses and mats (tread is "
                     "geometry). Not a scan: authored/procedural ambientCG material, no rubber scan exists "
                     "on either source."),
    dict(id="plastic_rough", site="ambientcg", asset="Plastic004", tile_m=[0.3, 0.3], rough_add=0.32,
         description="Matt grained grey-brown plastic with light scuffs (mudguards, cab trim, bins, crates); "
                     "tint via base-colour factor. Not a scan: authored/procedural ambientCG material (no "
                     "plastic scan on either source) without dimension metadata, so the tile size is "
                     "estimated. DERIVED: roughness raised by 0.32 (source is semi-gloss, mean 0.28)."),
]


# ---------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------
def http_get(url: str, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                raise RuntimeError(f"HTTP {resp.status} for {url}")
            return resp.read()
    except Exception as exc:  # re-raise with the URL so the cause is obvious
        raise RuntimeError(f"download failed: {url}: {exc}") from exc


def http_json(url: str):
    return json.loads(http_get(url, timeout=60).decode("utf-8"))


def cached_download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = http_get(url)
    tmp = dest.with_name(dest.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return dest


def atomic_write_json(path: Path, obj) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def open_image(path: Path) -> Image.Image:
    im = Image.open(path)
    if im.format not in ("JPEG", "PNG"):
        raise RuntimeError(f"{path}: unexpected image format {im.format!r} (only JPEG/PNG are read)")
    im.load()
    return im


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def to_size(im: Image.Image, size: int, what: str) -> Image.Image:
    if im.size[0] != im.size[1]:
        raise RuntimeError(f"{what}: source is not square ({im.size}); pick a square source asset")
    if im.size[0] < size:
        raise RuntimeError(f"{what}: source is only {im.size[0]} px, need >= {size}")
    return im if im.size[0] == size else im.resize((size, size), Image.LANCZOS)


def renormalize_normal(im: Image.Image) -> Image.Image:
    n = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0 * 2.0 - 1.0
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    return Image.fromarray(np.clip((n * 0.5 + 0.5) * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")


def flatten_normal_profile(im: Image.Image) -> Image.Image:
    """Remove a relief profile that runs along V (e.g. corrugation) from a normal map: subtract the
    per-column mean of X, then high-pass X along U (periodic Gaussian, sigma 10 px) to drop what is left
    of the waves where they are not perfectly straight; rebuild Z. Fine detail (a few pixels) and
    tileability are untouched."""
    n = np.asarray(im.convert("RGB"), dtype=np.float64) / 127.5 - 1.0
    x = n[..., 0] - n[..., 0].mean(axis=0, keepdims=True)
    freq = np.fft.rfftfreq(x.shape[1])
    lowpass = np.exp(-2.0 * (np.pi * freq * 10.0) ** 2)
    x = x - np.fft.irfft(np.fft.rfft(x, axis=1) * lowpass[None, :], n=x.shape[1], axis=1)
    y = n[..., 1] - n[..., 1].mean(axis=1, keepdims=True)
    z = np.sqrt(np.clip(1.0 - x * x - y * y, 0.0, 1.0))
    out = np.stack([x, y, z], -1)
    return Image.fromarray(np.clip((out * 0.5 + 0.5) * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")


def save_jpeg(im: Image.Image, path: Path, data_map: bool) -> None:
    """data_map=True (normal, ORM): no chroma subsampling, channels are independent data."""
    tmp = path.with_name(path.name + ".tmp")
    im.save(tmp, format="JPEG", quality=JPEG_QUALITY, subsampling=0 if data_map else 2, optimize=True)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------------------
# albedo recolouring (derived variants)
# ---------------------------------------------------------------------------------------
def rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-8
    rc = np.where(m, (mx - r) / np.where(m, d, 1), 0)
    gc = np.where(m, (mx - g) / np.where(m, d, 1), 0)
    bc = np.where(m, (mx - b) / np.where(m, d, 1), 0)
    h = np.where(mx == r, bc - gc, np.where(mx == g, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(m, (h / 6.0) % 1.0, 0.0)
    s = np.where(mx > 1e-8, d / np.where(mx > 1e-8, mx, 1), 0)
    return np.stack([h, s, mx], -1)


def hsv_to_rgb(hsv: np.ndarray) -> np.ndarray:
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    i = i.astype(np.int32) % 6
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)


def recolor_albedo(im: Image.Image, spec: dict) -> Image.Image:
    """spec is either {"hue_deg", "sat_mul", "val_mul"} (HSV shift that keeps the scan's own colour
    variation) or {"neutral_mean_linear": x, "contrast": c} (drop all chroma, scale so the mean linear
    luminance is x, scale the remaining value contrast by c — for surfaces that must be tintable to any
    paint colour)."""
    rgb = np.asarray(im.convert("RGB"), dtype=np.float64) / 255.0
    if "neutral_mean_linear" in spec:
        if set(spec) != {"neutral_mean_linear", "contrast"}:
            raise RuntimeError(f"neutral recolor spec must have neutral_mean_linear and contrast: {spec}")
        lum = srgb_to_linear(rgb) @ np.array([0.2126, 0.7152, 0.0722])
        lum = lum * (float(spec["neutral_mean_linear"]) / max(float(lum.mean()), 1e-6))
        grey = linear_to_srgb(np.clip(lum, 0, 1))
        grey = grey.mean() + (grey - grey.mean()) * float(spec["contrast"])  # tame chips/stains (sRGB domain)
        out = np.repeat(np.clip(grey, 0, 1)[..., None], 3, axis=2)
    else:
        if set(spec) != {"hue_deg", "sat_mul", "val_mul"}:
            raise RuntimeError(f"recolor spec must have hue_deg, sat_mul, val_mul: {spec}")
        hsv = rgb_to_hsv(rgb)
        hsv[..., 0] = (hsv[..., 0] + spec["hue_deg"] / 360.0) % 1.0
        hsv[..., 1] = np.clip(hsv[..., 1] * spec["sat_mul"], 0, 1)
        hsv[..., 2] = np.clip(hsv[..., 2] * spec["val_mul"], 0, 1)
        out = hsv_to_rgb(hsv)
    return Image.fromarray(np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------------------------------
# source fetchers: each returns dict(albedo, normal, rough, ao|None, metal|None, arm|None,
# height|None as PIL images, tile_m, tile_source, url)
# ---------------------------------------------------------------------------------------
def fetch_polyhaven(mat: dict) -> dict:
    asset = mat["asset"]
    ddir = DOWNLOADS / mat["id"] / f"polyhaven_{asset}"
    info = http_json(f"https://api.polyhaven.com/info/{urllib.parse.quote(asset)}")
    if info.get("type") != 1:
        raise RuntimeError(f"Poly Haven asset {asset!r} is not a texture (type={info.get('type')})")
    dims = info.get("dimensions")
    if not dims or len(dims) < 2 or dims[0] <= 0 or dims[1] <= 0:
        raise RuntimeError(f"Poly Haven asset {asset!r} has no usable dimensions: {dims!r}")
    files = http_json(f"https://api.polyhaven.com/files/{urllib.parse.quote(asset)}")

    def pick(names: list[str], res: str, required: bool):
        for name in names:
            if name in files:
                entry = files[name].get(res, {}).get("jpg")
                if not entry:
                    raise RuntimeError(f"Poly Haven {asset}: map {name!r} has no {res} jpg")
                return name, entry["url"]
        if required:
            raise RuntimeError(f"Poly Haven {asset}: none of the maps {names} exist (has {sorted(files)})")
        return None, None

    wanted = {
        "albedo": pick(["Diffuse", "diff", "col", "Color"], "2k", True),
        "normal": pick(["nor_gl"], "2k", True),
        "arm": pick(["arm"], "2k", False),
        "height": pick(["Displacement"], "1k", False),
    }
    if wanted["arm"][1] is None:
        wanted["rough"] = pick(["Rough"], "2k", True)
        wanted["ao"] = pick(["AO"], "2k", False)
        wanted["metal"] = pick(["Metal"], "2k", False)

    def dl(item):
        key, (name, url) = item
        if url is None:
            return key, None
        fname = os.path.basename(urllib.parse.urlparse(url).path)
        if not fname.lower().endswith(".jpg"):
            raise RuntimeError(f"Poly Haven {asset}: unexpected file name {fname!r}")
        return key, cached_download(url, ddir / fname)

    with cf.ThreadPoolExecutor(4) as ex:
        paths = dict(ex.map(dl, wanted.items()))
    out = {k: (open_image(p) if p else None) for k, p in paths.items()}
    out.setdefault("rough", None), out.setdefault("ao", None), out.setdefault("metal", None)
    out["tile_m"] = [round(dims[0] / 1000.0, 3), round(dims[1] / 1000.0, 3)]
    out["tile_source"] = "source-metadata"
    out["url"] = f"https://polyhaven.com/a/{asset}"
    out["site_name"] = "Poly Haven"
    out["capture"] = "photoscan"
    return out


def fetch_ambientcg(mat: dict) -> dict:
    asset = mat["asset"]
    ddir = DOWNLOADS / mat["id"] / f"ambientcg_{asset}"
    meta = http_json("https://ambientcg.com/api/v2/full_json?include=downloadData,dimensionData&id="
                     + urllib.parse.quote(asset))
    found = [a for a in meta.get("foundAssets", []) if a.get("assetId") == asset]
    if len(found) != 1:
        raise RuntimeError(f"ambientCG: asset {asset!r} not found (got {len(found)} matches)")
    a = found[0]
    try:
        downloads = a["downloadFolders"]["default"]["downloadFiletypeCategories"]["zip"]["downloads"]
    except KeyError as exc:
        raise RuntimeError(f"ambientCG {asset}: unexpected API shape, missing {exc}") from exc
    link = next((d["downloadLink"] for d in downloads if d.get("attribute") == "2K-JPG"), None)
    if not link:
        raise RuntimeError(f"ambientCG {asset}: no 2K-JPG download (has {[d.get('attribute') for d in downloads]})")
    if urllib.parse.urlparse(link).hostname not in ("ambientcg.com", "www.ambientcg.com"):
        raise RuntimeError(f"ambientCG {asset}: download link points off-site: {link}")
    zpath = cached_download(link, ddir / f"{asset}_2K-JPG.zip")

    # Untrusted archive: take image members only, by sanitised base name, into a fresh directory.
    xdir = ddir / "images"
    xdir.mkdir(parents=True, exist_ok=True)
    imgs: dict[str, Path] = {}
    with zipfile.ZipFile(zpath) as zf:
        for zi in zf.infolist():
            base = os.path.basename(zi.filename.replace("\\", "/"))
            if zi.is_dir() or not base.lower().endswith((".jpg", ".png")) or base.startswith("."):
                continue
            if zi.file_size > 80 * 1024 * 1024:
                raise RuntimeError(f"ambientCG {asset}: member {base} is implausibly large")
            if not all(ch.isalnum() or ch in "._-" for ch in base):
                raise RuntimeError(f"ambientCG {asset}: suspicious member name {zi.filename!r}")
            target = xdir / base
            if not target.exists():
                target.write_bytes(zf.read(zi))
            imgs[base] = target

    def find(suffix: str, required: bool):
        hits = [p for n, p in imgs.items() if n.rsplit(".", 1)[0].endswith("_" + suffix)]
        if len(hits) > 1:
            raise RuntimeError(f"ambientCG {asset}: several {suffix} maps: {hits}")
        if not hits:
            if required:
                raise RuntimeError(f"ambientCG {asset}: no {suffix} map in archive (has {sorted(imgs)})")
            return None
        return open_image(hits[0])

    out = dict(albedo=find("Color", True), normal=find("NormalGL", True), rough=find("Roughness", True),
               ao=find("AmbientOcclusion", False), metal=find("Metalness", False), arm=None,
               height=find("Displacement", False))
    dx, dy = a.get("dimensionX") or 0, a.get("dimensionY") or 0
    if dx > 0 and dy > 0:
        out["tile_m"] = [round(dx / 100.0, 3), round(dy / 100.0, 3)]  # API gives centimetres
        out["tile_source"] = "source-metadata"
    elif mat.get("tile_m"):
        out["tile_m"] = [float(mat["tile_m"][0]), float(mat["tile_m"][1])]
        out["tile_source"] = "estimated"
    else:
        raise RuntimeError(f"ambientCG {asset}: no dimension metadata and no tile_m estimate in the table")
    out["url"] = f"https://ambientcg.com/a/{asset}"
    out["site_name"] = "ambientCG"
    method = a.get("creationMethod")
    capture = {"PBRPhotogrammetry": "photoscan", "PBRMultiAngle": "photoscan",
               "PBRApproximated": "photo (maps approximated from one photo)",
               "PBRProcedural": "procedural (authored, not a scan)"}.get(method)
    if capture is None:
        raise RuntimeError(f"ambientCG {asset}: unknown creationMethod {method!r}")
    out["capture"] = capture
    return out


FETCHERS = {"polyhaven": fetch_polyhaven, "ambientcg": fetch_ambientcg}


# ---------------------------------------------------------------------------------------
# checks
# ---------------------------------------------------------------------------------------
def seam_ratio(albedo: Image.Image) -> list[float]:
    """Wrap-around edge step relative to the strongest step between two neighbouring pixel lines
    inside the image (<= ~1 means the wrap is no more visible than e.g. a mortar joint that
    already exists in the texture; a real seam on a smooth texture gives values far above 1)."""
    g = np.asarray(albedo.convert("L").resize((1024, 1024), Image.BILINEAR), dtype=np.float32)
    ix = np.abs(np.diff(g, axis=1)).mean(axis=0).max() + 1e-6   # per column pair
    iy = np.abs(np.diff(g, axis=0)).mean(axis=1).max() + 1e-6   # per row pair
    sx = np.abs(g[:, 0] - g[:, -1]).mean()
    sy = np.abs(g[0, :] - g[-1, :]).mean()
    return [round(float(sx / ix), 2), round(float(sy / iy), 2)]


def normal_handedness(normal: Image.Image, height: Image.Image | None):
    """Correlation of the normal's XY with the height gradient. Both > 0 means OpenGL (+Y up)."""
    if height is None:
        return None
    h = np.asarray(height.convert("L").resize((512, 512), Image.BILINEAR), dtype=np.float32)
    # blur a little so JPEG noise does not dominate
    for _ in range(2):
        h = (h + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 5.0
    n = np.asarray(normal.convert("RGB").resize((512, 512), Image.BILINEAR), dtype=np.float32) / 127.5 - 1.0
    dhdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1))          # +x = image right
    dhdrow = (np.roll(h, -1, 0) - np.roll(h, 1, 0))        # +row = image down = -Y in GL

    def corr(a, b):
        a, b = a - a.mean(), b - b.mean()
        d = float(np.sqrt((a * a).sum() * (b * b).sum()))
        return 0.0 if d < 1e-9 else float((a * b).sum() / d)

    return [round(corr(n[..., 0], -dhdx), 3), round(corr(n[..., 1], dhdrow), 3)]


# ---------------------------------------------------------------------------------------
# build one material
# ---------------------------------------------------------------------------------------
def build_material(mat: dict) -> dict:
    mid = mat["id"]
    src = FETCHERS[mat["site"]](mat)
    out_dir = LIB / mid
    out_dir.mkdir(parents=True, exist_ok=True)

    albedo = to_size(src["albedo"].convert("RGB"), SIZE, f"{mid} albedo")
    if mat.get("recolor"):
        albedo = recolor_albedo(albedo, mat["recolor"])
    normal = to_size(src["normal"].convert("RGB"), SIZE, f"{mid} normal")
    hand = normal_handedness(normal, src.get("height"))  # checked on the source normal, before any edit
    if hand is not None and min(hand) < -0.1:
        raise RuntimeError(f"{mid}: normal map is not OpenGL convention (corr with height gradient {hand})")
    if mat.get("flatten_normal_profile"):
        normal = flatten_normal_profile(normal)

    maps_note = {}
    if src["arm"] is not None:
        orm = to_size(src["arm"].convert("RGB"), SIZE, f"{mid} arm")
        maps_note = {"ao": "source", "roughness": "source", "metalness": "source"}
    else:
        rough = to_size(src["rough"].convert("L"), SIZE, f"{mid} roughness")
        if src["ao"] is not None:
            ao = to_size(src["ao"].convert("L"), SIZE, f"{mid} ao")
            maps_note["ao"] = "source"
        else:
            ao = Image.new("L", (SIZE, SIZE), 255)
            maps_note["ao"] = "none in source -> white"
        if src["metal"] is not None:
            metal = to_size(src["metal"].convert("L"), SIZE, f"{mid} metalness")
            maps_note["metalness"] = "source"
        else:
            metal = Image.new("L", (SIZE, SIZE), 0)
            maps_note["metalness"] = "none in source -> 0"
        maps_note["roughness"] = "source"
        orm = Image.merge("RGB", (ao, rough, metal))

    if mat.get("rough_add"):
        ao_c, rough_c, metal_c = orm.split()
        r = np.asarray(rough_c, dtype=np.float32) + float(mat["rough_add"]) * 255.0
        orm = Image.merge("RGB", (ao_c, Image.fromarray(np.clip(r + 0.5, 0, 255).astype(np.uint8), "L"), metal_c))
        maps_note["roughness"] = f"source {float(mat['rough_add']):+.2f}"

    # --- checks (fail loudly) ---
    seam = seam_ratio(albedo)
    if max(seam) > 1.5:
        raise RuntimeError(f"{mid}: albedo does not tile (seam ratio {seam}, 1.0 = seamless)")
    lin = srgb_to_linear(np.asarray(albedo, dtype=np.float64) / 255.0)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    mean_lin = lin.reshape(-1, 3).mean(0)
    p1, p99 = np.percentile(lum, [1, 99])
    if not (0.008 <= float(lum.mean()) <= 0.80):
        raise RuntimeError(f"{mid}: implausible albedo, mean linear luminance {lum.mean():.3f}")
    avg_srgb = [int(round(float(v) * 255)) for v in linear_to_srgb(mean_lin)]

    files = {}

    def emit(key: str, im: Image.Image, data_map: bool):
        rel2k = f"{mid}_{key}.jpg"
        rel1k = f"{mid}_{key}_1k.jpg"
        save_jpeg(im, out_dir / rel2k, data_map)
        small = im.resize((SIZE_1K, SIZE_1K), Image.LANCZOS)
        if key == "normal":
            small = renormalize_normal(small)
        save_jpeg(small, out_dir / rel1k, data_map)
        files[key] = str((out_dir / rel2k).relative_to(ROOT))
        files[key + "_1k"] = str((out_dir / rel1k).relative_to(ROOT))

    emit("albedo", albedo, False)
    emit("normal", normal, True)
    emit("orm", orm, True)

    orm_np = np.asarray(orm, dtype=np.float32) / 255.0
    entry = {
        "id": mid,
        "description": mat["description"],
        "tileSizeM": src["tile_m"],
        "tileSizeSource": src["tile_source"],
        "files": files,
        "resolution": SIZE,
        "source": {"site": src["site_name"], "assetId": mat["asset"], "url": src["url"]},
        "license": "CC0",
        "capture": src["capture"],
        "avgAlbedoSRGB": avg_srgb,
        "avgAlbedoLinear": [round(float(v), 4) for v in mean_lin],
        "avgRoughness": round(float(orm_np[..., 1].mean()), 3),
        "avgMetalness": round(float(orm_np[..., 2].mean()), 3),
        "maps": maps_note,
        "checks": {
            "seamRatio": seam,
            "normalVsHeightCorr": hand,
            "albedoLinearLuminanceP1P99": [round(float(p1), 4), round(float(p99), 4)],
        },
    }
    derived = {}
    if mat.get("recolor"):
        derived["albedoRecolor"] = mat["recolor"]
    if mat.get("flatten_normal_profile"):
        derived["normal"] = "profile that is constant along V (corrugation) removed; fine detail kept"
    if mat.get("rough_add"):
        derived["roughnessOffset"] = float(mat["rough_add"])
    if derived:
        derived["note"] = "derived from the source scan as listed here; every other map is unchanged"
        entry["derived"] = derived
    return entry


# ---------------------------------------------------------------------------------------
# library.json + contact sheet
# ---------------------------------------------------------------------------------------
def load_library() -> dict:
    if LIBRARY_JSON.exists():
        lib = json.loads(LIBRARY_JSON.read_text(encoding="utf-8"))
        if "materials" not in lib or not isinstance(lib["materials"], list):
            raise RuntimeError(f"{LIBRARY_JSON} exists but has no 'materials' list — refusing to overwrite it")
        return lib
    return {"materials": [], "missing": []}


def write_library(entries: dict[str, dict], missing: list[dict]) -> bool:
    order = {m: i for i, m in enumerate(PLANNED_IDS)}
    mats = sorted(entries.values(), key=lambda e: order.get(e["id"], 999))
    missing_ids = {m["id"] for m in missing}
    complete = all(i in entries or i in missing_ids for i in PLANNED_IDS)
    lib = {
        "version": 1,
        "complete": complete,
        "generatedBy": "scripts/build_texture_library.py",
        "license": "CC0",
        "sources": ["https://polyhaven.com", "https://ambientcg.com"],
        "conventions": {
            "albedo": "sRGB JPEG, 2048 px, seamless; tint via base-colour factor / vertex colours",
            "normal": "tangent space, OpenGL (+Y up) as glTF expects, linear",
            "orm": "R = ambient occlusion, G = roughness, B = metalness (glTF packing), linear",
            "variants": "every map also exists at 1024 px with the suffix _1k (files.<map>_1k)",
            "tileSizeM": "[width, height] in metres that ONE repeat of the texture covers; "
                         "UV = position_in_metres / tileSizeM",
            "imageNames": "use the file basename without extension as the Blender image name",
        },
        "plannedIds": PLANNED_IDS,
        "ids": [e["id"] for e in mats],
        "materials": mats,
        "missing": missing,
    }
    LIB.mkdir(parents=True, exist_ok=True)
    atomic_write_json(LIBRARY_JSON, lib)
    return complete


def lit_preview(entry: dict, cell: int) -> Image.Image:
    """2x2 tiled preview, lit from the top-left with the normal map (raised parts catch light top-left)."""
    half = cell // 2
    alb = open_image(ROOT / entry["files"]["albedo_1k"]).convert("RGB").resize((half, half), Image.LANCZOS)
    nor = open_image(ROOT / entry["files"]["normal_1k"]).convert("RGB").resize((half, half), Image.LANCZOS)
    orm = open_image(ROOT / entry["files"]["orm_1k"]).convert("RGB").resize((half, half), Image.LANCZOS)
    a = srgb_to_linear(np.asarray(alb, dtype=np.float64) / 255.0)
    n = np.asarray(nor, dtype=np.float64) / 127.5 - 1.0
    n[..., :2] *= 2.0  # exaggerate relief a little so handedness is readable at thumbnail size
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    ao = np.asarray(orm, dtype=np.float64)[..., 0:1] / 255.0
    light = np.array([-0.55, 0.55, 0.63])  # from the top-left (x right, y up, z towards the viewer)
    light /= np.linalg.norm(light)
    ndl = np.clip((n * light).sum(-1, keepdims=True), 0, 1)
    lit = a * (0.30 * ao + 1.25 * ndl)
    tile = Image.fromarray(np.clip(linear_to_srgb(np.clip(lit, 0, 1)) * 255 + 0.5, 0, 255).astype(np.uint8))
    out = Image.new("RGB", (cell, cell))
    for i in range(2):
        for j in range(2):
            out.paste(tile, (i * half, j * half))
    return out


def build_contact_sheet(entries: list[dict]) -> None:
    if not entries:
        raise RuntimeError("contact sheet requested but the library has no materials")
    cell, label, cols = 512, 34, 6
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + label)), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    for i, e in enumerate(entries):
        x, y = (i % cols) * cell, (i // cols) * (cell + label)
        sheet.paste(lit_preview(e, cell), (x, y + label))
        tw, th = e["tileSizeM"]
        draw.text((x + 6, y + 4), e["id"], fill=(255, 255, 255))
        draw.text((x + 6, y + 18), f"2x2 tiles, one tile = {tw:g} x {th:g} m | {e['source']['site']}: "
                                   f"{e['source']['assetId']}" + (" | DERIVED" if e.get("derived") else ""),
                  fill=(170, 170, 170))
    tmp = CONTACT_SHEET.with_name(CONTACT_SHEET.name + ".tmp")
    sheet.save(tmp, format="JPEG", quality=88)
    os.replace(tmp, CONTACT_SHEET)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--only", help="comma-separated material ids to (re)build")
    ap.add_argument("--force", action="store_true", help="rebuild even if already listed in library.json")
    ap.add_argument("--sheet-only", action="store_true", help="only re-render the contact sheet")
    args = ap.parse_args()

    table_ids = [m["id"] for m in MATERIALS]
    if len(set(table_ids)) != len(table_ids):
        raise RuntimeError("duplicate ids in MATERIALS")
    unknown = [i for i in table_ids if i not in PLANNED_IDS]
    if unknown:
        raise RuntimeError(f"ids not in PLANNED_IDS: {unknown}")

    lib = load_library()
    entries = {e["id"]: e for e in lib["materials"]}
    missing = [m for m in MISSING if m["id"] not in table_ids]

    if not args.sheet_only:
        only = set(args.only.split(",")) if args.only else None
        if only and not only <= set(table_ids):
            raise RuntimeError(f"--only names ids that are not in MATERIALS: {sorted(only - set(table_ids))}")
        failures = []
        for mat in MATERIALS:
            mid = mat["id"]
            if only and mid not in only:
                continue
            done = (mid in entries and entries[mid]["source"]["assetId"] == mat["asset"]
                    and all((ROOT / p).exists() for p in entries[mid]["files"].values()))
            if done and not (args.force or only):
                continue
            print(f"[build] {mid}  <-  {mat['site']}:{mat['asset']}", flush=True)
            try:
                entries[mid] = build_material(mat)
            except Exception as exc:  # collect, keep building the rest, then fail loudly at the end
                failures.append((mid, exc))
                print(f"[FAILED] {mid}: {exc}", file=sys.stderr, flush=True)
                continue
            write_library(entries, missing)
            e = entries[mid]
            print(f"         tile {e['tileSizeM']} m, avg sRGB {e['avgAlbedoSRGB']}, seam {e['checks']['seamRatio']}, "
                  f"normal/height corr {e['checks']['normalVsHeightCorr']}", flush=True)
        if failures:
            write_library(entries, missing)
            raise SystemExit("FAILED materials (library.json left with complete=false for them):\n"
                             + "\n".join(f"  {m}: {e}" for m, e in failures))

    complete = write_library(entries, missing)
    order = {m: i for i, m in enumerate(PLANNED_IDS)}
    build_contact_sheet(sorted(entries.values(), key=lambda e: order.get(e["id"], 999)))
    total = sum(f.stat().st_size for d in LIB.iterdir() if d.is_dir() and not d.name.startswith("_")
                for f in d.iterdir() if f.is_file())
    print(f"[done] {len(entries)}/{len(PLANNED_IDS)} materials, missing {[m['id'] for m in missing]}, "
          f"complete={complete}, shipped size {total / 1e6:.1f} MB, sheet {CONTACT_SHEET.relative_to(ROOT)}")
    return 0


# Planned ids for which no fitting CC0 source exists on the two approved sites: {"id", "reason"}.
MISSING: list[dict] = []


if __name__ == "__main__":
    sys.exit(main())
