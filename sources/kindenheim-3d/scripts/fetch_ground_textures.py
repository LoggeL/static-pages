#!/usr/bin/env python3
"""
Download CC0 photo-scanned ground materials (Poly Haven + ambientCG only) and pack them into the
web-sized runtime layers used by src/terrain.ts and src/roads.ts.

Output (public/assets/textures/ground/):
    <idx>_<name>_albedo.webp   1024x1024 sRGB albedo (low frequencies partly flattened to hide tiling)
    <idx>_<name>_nr.jpg        1024x1024 4:4:4 JPEG: R = normal X, G = normal Y (OpenGL +Y), B = roughness
    ground.json                layer list (order = texture-array layer index), real-world tile size,
                               mean linear albedo, mean roughness, source + licence

Both sources publish under CC0 1.0. Requests carry a generic User-Agent and no personal data.
NO FALLBACKS: a failed download, a missing map or an unexpected image size aborts with the cause.

Usage:  python3 -I scripts/fetch_ground_textures.py [--cache DIR]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import zipfile

import numpy as np
import requests
from PIL import Image

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(PROJECT_ROOT, "public", "assets", "textures", "ground")
DEFAULT_CACHE = os.path.join(PROJECT_ROOT, ".gfx", "terrain", "cache", "pbr")
USER_AGENT = "kindenheim3d-assets/1.0"
SIZE = 1024

# Order = layer index in the runtime texture arrays. Do not reorder without updating src/terrain.ts.
LAYERS = [
    {"name": "grass",     "source": "ambientcg", "id": "Grass004",             "tileSizeM": 2.0},  # scan is 1.4 m; meadow grass is coarser than a lawn
    {"name": "dry_grass", "source": "polyhaven", "id": "withered_grass",       "tileSizeM": 2.0},
    {"name": "soil",      "source": "polyhaven", "id": "farm_soil",            "tileSizeM": 2.0},
    {"name": "gravel",    "source": "polyhaven", "id": "gravel_ground_01",     "tileSizeM": 3.0},
    {"name": "pavers",    "source": "ambientcg", "id": "PavingStones099",      "tileSizeM": 2.0},
    {"name": "asphalt",   "source": "polyhaven", "id": "asphalt_04",           "tileSizeM": 4.0},
    {"name": "setts",     "source": "polyhaven", "id": "cobblestone_floor_08", "tileSizeM": 1.8},
    {"name": "sidewalk",  "source": "ambientcg", "id": "PavingStones110",      "tileSizeM": 3.5},
]

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})


def http_get(url: str, cache_path: str, timeout: int = 120) -> bytes:
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
        with open(cache_path, "rb") as f:
            return f.read()
    r = SESSION.get(url, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code} for {url}: {r.text[:200]}")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    tmp = cache_path + ".part"
    with open(tmp, "wb") as f:
        f.write(r.content)
    os.replace(tmp, cache_path)
    time.sleep(0.4)
    return r.content


def load_polyhaven(asset_id: str, cache: str) -> dict[str, Image.Image]:
    files = json.loads(http_get(f"https://api.polyhaven.com/files/{asset_id}", os.path.join(cache, "ph", f"{asset_id}.files.json")))
    out = {}
    for key, ph_key in (("color", "Diffuse"), ("normal", "nor_gl"), ("rough", "Rough")):
        try:
            entry = files[ph_key]["1k"]["jpg"]
        except KeyError as exc:
            raise RuntimeError(f"Poly Haven asset '{asset_id}' has no 1k jpg map '{ph_key}' (missing key {exc})") from exc
        url = entry["url"]
        if not url.startswith("https://dl.polyhaven.org/"):
            raise RuntimeError(f"Unexpected Poly Haven download host for {asset_id}/{ph_key}: {url}")
        data = http_get(url, os.path.join(cache, "ph", os.path.basename(url)))
        out[key] = Image.open(io.BytesIO(data))
    return out


def load_ambientcg(asset_id: str, cache: str) -> dict[str, Image.Image]:
    url = f"https://ambientcg.com/get?file={asset_id}_1K-JPG.zip"
    data = http_get(url, os.path.join(cache, "acg", f"{asset_id}_1K-JPG.zip"))
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    out = {}
    for key, suffix in (("color", "_Color.jpg"), ("normal", "_NormalGL.jpg"), ("rough", "_Roughness.jpg")):
        match = [n for n in names if n.endswith(suffix)]
        if len(match) != 1:
            raise RuntimeError(f"ambientCG zip for '{asset_id}' has no unique '*{suffix}' member (members: {names})")
        out[key] = Image.open(io.BytesIO(zf.read(match[0])))
    return out


def to_square(im: Image.Image, mode: str) -> np.ndarray:
    """Return a SIZE x SIZE array. 2:1 scans (e.g. 3.5 m x 1.75 m herringbone) are stacked to a square."""
    im = im.convert(mode)
    w, h = im.size
    if w == h:
        if w != SIZE:
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
        return np.asarray(im)
    if w == 2 * h:
        if w != SIZE:
            im = im.resize((SIZE, SIZE // 2), Image.LANCZOS)
        a = np.asarray(im)
        return np.concatenate([a, a], axis=0)
    raise RuntimeError(f"Unsupported texture aspect {w}x{h}")


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return np.clip(np.round(s * 255.0), 0, 255).astype(np.uint8)


def wrap_blur(a: np.ndarray, sigma_px: float) -> np.ndarray:
    """Periodic Gaussian blur via FFT (keeps the texture seamless)."""
    n0, n1 = a.shape[:2]
    fy = np.fft.fftfreq(n0)[:, None]
    fx = np.fft.fftfreq(n1)[None, :]
    g = np.exp(-2.0 * (np.pi ** 2) * (sigma_px ** 2) * (fx ** 2 + fy ** 2))
    out = np.empty_like(a, dtype=np.float32)
    for ch in range(a.shape[2]):
        out[:, :, ch] = np.real(np.fft.ifft2(np.fft.fft2(a[:, :, ch]) * g))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)

    manifest_layers = []
    total = 0
    for idx, layer in enumerate(LAYERS):
        maps = load_polyhaven(layer["id"], args.cache) if layer["source"] == "polyhaven" else load_ambientcg(layer["id"], args.cache)
        color = to_square(maps["color"], "RGB")
        normal = to_square(maps["normal"], "RGB")
        rough = to_square(maps["rough"], "L")

        lin = srgb_to_linear(color)
        mean_lin = lin.reshape(-1, 3).mean(axis=0)
        # Flatten the low frequencies (blotches wider than ~1/5 tile) by 70 % so repeats are not readable from afar;
        # the aerial photo supplies the macro colour at runtime.
        low = wrap_blur(lin, SIZE / 5.0 / 2.355)
        flat = lin * (mean_lin[None, None, :] / np.maximum(low, 1e-4))
        lin_out = lin * 0.3 + flat * 0.7
        albedo = linear_to_srgb(lin_out)
        mean_out = srgb_to_linear(albedo).reshape(-1, 3).mean(axis=0)

        nr = np.dstack([normal[:, :, 0], normal[:, :, 1], rough])
        base = f"{idx}_{layer['name']}"
        albedo_path = os.path.join(OUT_DIR, f"{base}_albedo.webp")
        nr_path = os.path.join(OUT_DIR, f"{base}_nr.jpg")
        Image.fromarray(albedo, "RGB").save(albedo_path, "WEBP", quality=86, method=6)
        Image.fromarray(nr, "RGB").save(nr_path, "JPEG", quality=84, subsampling=0, optimize=True)
        size_a, size_n = os.path.getsize(albedo_path), os.path.getsize(nr_path)
        total += size_a + size_n
        print(f"[ground] {base}: albedo {size_a / 1024:.0f} KB, normal+rough {size_n / 1024:.0f} KB, "
              f"mean linear albedo {np.round(mean_out, 3).tolist()}, mean roughness {rough.mean() / 255:.2f}")
        manifest_layers.append({
            "index": idx,
            "name": layer["name"],
            "albedo": f"{base}_albedo.webp",
            "normalRoughness": f"{base}_nr.jpg",
            "tileSizeM": layer["tileSizeM"],
            "meanAlbedoLinear": [round(float(v), 4) for v in mean_out],
            "meanRoughness": round(float(rough.mean() / 255.0), 3),
            "source": "Poly Haven" if layer["source"] == "polyhaven" else "ambientCG",
            "sourceId": layer["id"],
            "sourceUrl": (f"https://polyhaven.com/a/{layer['id']}" if layer["source"] == "polyhaven"
                          else f"https://ambientcg.com/view?id={layer['id']}"),
            "licence": "CC0 1.0",
        })

    manifest = {
        "size": SIZE,
        "normalConvention": "OpenGL (+Y), XY in RG, roughness in B",
        "layers": manifest_layers,
    }
    with open(os.path.join(OUT_DIR, "ground.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"[ground] wrote {len(manifest_layers)} layers, {total / 1e6:.2f} MB total -> {OUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ground] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
