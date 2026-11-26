"""2D compositing toolkit for vegetation atlases (run with the system python3, NOT inside Blender).

Cuts individual photo-scanned leaves / blades out of the CC0 ambientCG "LeafSet" / "Foliage" atlases under
blender/shared_textures/_extra_vegetation/<id>/ and composes them into branch cards, leaf walls, crop rows …
Every canvas carries albedo (sRGB), alpha and a tangent-space normal (OpenGL, +Y up) so the composed cards
shade like the scans they are made of.

Fails loudly: a missing source atlas or library material raises immediately.
"""
from __future__ import annotations

import json
import math
import os
import random

import cv2
import numpy as np
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SHARED = os.path.join(ROOT, 'blender', 'shared_textures')
EXTRA = os.path.join(SHARED, '_extra_vegetation')


def _read(path: str, flags=cv2.IMREAD_COLOR) -> np.ndarray:
    if not os.path.isfile(path):
        raise FileNotFoundError(f'vegetation atlas source missing: {path}')
    img = cv2.imread(path, flags)
    if img is None:
        raise RuntimeError(f'could not decode image: {path}')
    return img


def library_map(mat_id: str, which: str = 'albedo', size: str = '_1k') -> str:
    """Absolute path of a shared-library map (which = albedo | normal | orm). Raises if the id is not built yet."""
    lib_path = os.path.join(SHARED, 'library.json')
    with open(lib_path, 'r', encoding='utf-8') as fh:
        lib = json.load(fh)
    mats = lib['materials']
    entries = mats if isinstance(mats, list) else list(mats.values())
    for m in entries:
        if m['id'] == mat_id:
            key = f'{which}{size}' if size else which
            return os.path.join(ROOT, m['files'][key])
    raise KeyError(f'shared texture library has no material "{mat_id}" yet (see {lib_path})')


def library_tile_m(mat_id: str) -> float:
    with open(os.path.join(SHARED, 'library.json'), 'r', encoding='utf-8') as fh:
        lib = json.load(fh)
    mats = lib['materials']
    entries = mats if isinstance(mats, list) else list(mats.values())
    for m in entries:
        if m['id'] == mat_id:
            return float(m['tileSizeM'][0])
    raise KeyError(f'shared texture library has no material "{mat_id}" yet')


class Sprite:
    """rgb: float32 HxWx3 (sRGB 0..1), alpha: float32 HxW, normal: float32 HxWx3 (-1..1, +Y = image up)."""

    def __init__(self, rgb: np.ndarray, alpha: np.ndarray, normal: np.ndarray):
        self.rgb = rgb
        self.alpha = alpha
        self.normal = normal

    @property
    def h(self) -> int:
        return self.rgb.shape[0]

    @property
    def w(self) -> int:
        return self.rgb.shape[1]

    def rotated90(self, k: int) -> 'Sprite':
        """Rotate counter-clockwise by k*90 degrees (normals follow)."""
        rgb = np.rot90(self.rgb, k).copy()
        alpha = np.rot90(self.alpha, k).copy()
        n = np.rot90(self.normal, k).copy()
        ang = k * math.pi / 2
        c, s = math.cos(ang), math.sin(ang)
        nx = n[..., 0] * c - n[..., 1] * s
        ny = n[..., 0] * s + n[..., 1] * c
        n[..., 0], n[..., 1] = nx, ny
        return Sprite(rgb, alpha, n)

    def mirrored(self) -> 'Sprite':
        n = self.normal[:, ::-1].copy()
        n[..., 0] *= -1
        return Sprite(self.rgb[:, ::-1].copy(), self.alpha[:, ::-1].copy(), n)

    def graded(self, gain=(1.0, 1.0, 1.0), sat: float = 1.0, gamma: float = 1.0) -> 'Sprite':
        rgb = self.rgb.copy()
        if gamma != 1.0:
            rgb = np.power(np.clip(rgb, 0, 1), gamma)
        rgb = rgb * np.asarray(gain, np.float32)[None, None, :]
        if sat != 1.0:
            lum = rgb @ np.asarray([0.3, 0.59, 0.11], np.float32)
            rgb = lum[..., None] + (rgb - lum[..., None]) * sat
        return Sprite(np.clip(rgb, 0, 1).astype(np.float32), self.alpha, self.normal)

    def mean_rgb(self) -> np.ndarray:
        m = self.alpha > 0.6
        return self.rgb[m].mean(axis=0)

    def toward(self, target_srgb255, amount: float = 1.0, sat: float = 1.0) -> 'Sprite':
        """Scale colours so the sprite mean moves toward target (keeps the scanned vein detail)."""
        mean = np.maximum(self.mean_rgb(), 1e-3)
        tgt = np.asarray(target_srgb255, np.float32) / 255.0
        gain = 1.0 + (tgt / mean - 1.0) * amount
        return self.graded(gain=gain, sat=sat)


def load_set(set_id: str) -> Sprite:
    d = os.path.join(EXTRA, set_id)
    bgr = _read(os.path.join(d, f'{set_id}_albedo.jpg')).astype(np.float32) / 255.0
    op = _read(os.path.join(d, f'{set_id}_opacity.jpg'), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0
    nrm = _read(os.path.join(d, f'{set_id}_normal.jpg')).astype(np.float32) / 255.0
    rgb = bgr[..., ::-1].copy()
    n = nrm[..., ::-1].copy() * 2.0 - 1.0
    return Sprite(rgb, op, n)


def extract_sprites(set_id: str, min_area_frac: float = 0.0015, pad: int = 6) -> list[Sprite]:
    """Connected opaque regions of an atlas, sorted top-to-bottom / left-to-right."""
    full = load_set(set_id)
    mask = full.alpha > 0.5
    mask = ndimage.binary_closing(mask, iterations=3)
    labels, count = ndimage.label(mask)
    if count == 0:
        raise RuntimeError(f'{set_id}: opacity map has no opaque regions')
    min_area = min_area_frac * mask.size
    out: list[tuple[int, int, Sprite]] = []
    for idx, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        region = labels[sl] == idx
        if region.sum() < min_area:
            continue
        y0 = max(0, sl[0].start - pad)
        y1 = min(mask.shape[0], sl[0].stop + pad)
        x0 = max(0, sl[1].start - pad)
        x1 = min(mask.shape[1], sl[1].stop + pad)
        own = ndimage.binary_dilation(labels[y0:y1, x0:x1] == idx, iterations=pad)
        a = full.alpha[y0:y1, x0:x1] * own
        out.append((y0 // 300, x0, Sprite(full.rgb[y0:y1, x0:x1].copy(), a.astype(np.float32), full.normal[y0:y1, x0:x1].copy())))
    if not out:
        raise RuntimeError(f'{set_id}: no sprite above the minimum area')
    out.sort(key=lambda t: (t[0], t[1]))
    return [s for _, _, s in out]


class Canvas:
    def __init__(self, w: int, h: int):
        self.w = w
        self.h = h
        self.rgb = np.zeros((h, w, 3), np.float32)
        self.alpha = np.zeros((h, w), np.float32)
        self.normal = np.zeros((h, w, 3), np.float32)
        self.normal[..., 2] = 1.0

    def place(
        self,
        sp: Sprite,
        x: float,
        y: float,
        angle_deg: float = 0.0,
        scale: float = 1.0,
        anchor=(0.5, 1.0),
        shade: float = 1.0,
        tilt=(0.0, 0.0),
        wrap_x: bool = False,
        wrap_y: bool = False,
        opacity: float = 1.0,
    ) -> None:
        """Alpha-over a sprite. (x, y) = canvas pixel of the sprite anchor (fractions of the sprite, default = stem base).
        angle_deg rotates counter-clockwise around the anchor; 0 keeps the sprite as scanned."""
        ax = anchor[0] * sp.w
        ay = anchor[1] * sp.h
        m = cv2.getRotationMatrix2D((ax, ay), angle_deg, scale)
        m[0, 2] += x - ax
        m[1, 2] += y - ay
        offsets = [(0, 0)]
        if wrap_x:
            offsets += [(-self.w, 0), (self.w, 0)]
        if wrap_y:
            offsets += [(dx, dy) for dx, _ in list(offsets) for dy in (-self.h, self.h)]
        # bounding box of the transformed sprite to keep the warp small
        corners = np.array([[0, 0, 1], [sp.w, 0, 1], [0, sp.h, 1], [sp.w, sp.h, 1]], np.float32).T
        tc = m @ corners
        ang = math.radians(angle_deg)
        c, s = math.cos(ang), math.sin(ang)
        for dx, dy in offsets:
            bx0 = int(math.floor(tc[0].min() + dx)) - 2
            bx1 = int(math.ceil(tc[0].max() + dx)) + 2
            by0 = int(math.floor(tc[1].min() + dy)) - 2
            by1 = int(math.ceil(tc[1].max() + dy)) + 2
            cx0, cx1 = max(0, bx0), min(self.w, bx1)
            cy0, cy1 = max(0, by0), min(self.h, by1)
            if cx1 <= cx0 or cy1 <= cy0:
                continue
            mm = m.copy()
            mm[0, 2] += dx - cx0
            mm[1, 2] += dy - cy0
            size = (cx1 - cx0, cy1 - cy0)
            interp = cv2.INTER_AREA if scale < 0.6 else cv2.INTER_LINEAR
            src_rgb, src_a, src_n = sp.rgb, sp.alpha, sp.normal
            if scale < 0.45:
                # pre-filter strongly minified sprites to avoid aliasing
                k = max(1, int(round(0.5 / scale)))
                ks = 2 * k + 1
                src_a = cv2.GaussianBlur(sp.alpha, (ks, ks), 0)
                pre = cv2.GaussianBlur(sp.rgb * sp.alpha[..., None], (ks, ks), 0)
                src_rgb = pre / np.maximum(src_a[..., None], 1e-4)
                src_n = cv2.GaussianBlur(sp.normal, (ks, ks), 0)
                interp = cv2.INTER_LINEAR
            a = cv2.warpAffine(src_a, mm, size, flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            rgb = cv2.warpAffine(src_rgb, mm, size, flags=interp, borderMode=cv2.BORDER_REPLICATE)
            n = cv2.warpAffine(src_n, mm, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            nx = n[..., 0] * c - n[..., 1] * s + tilt[0]
            ny = n[..., 0] * s + n[..., 1] * c + tilt[1]
            nz = np.maximum(n[..., 2], 0.05)
            ln = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
            n = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
            a = a * opacity
            a3 = a[..., None]
            reg = (slice(cy0, cy1), slice(cx0, cx1))
            self.rgb[reg] = self.rgb[reg] * (1 - a3) + rgb * shade * a3
            self.normal[reg] = self.normal[reg] * (1 - a3) + n * a3
            self.alpha[reg] = self.alpha[reg] * (1 - a) + a

    def stroke(self, pts, width0: float, width1: float, color0, color1=None, shade: float = 1.0) -> None:
        """Tapered round twig / stalk along a polyline with a cylinder-like normal."""
        color1 = color0 if color1 is None else color1
        pts = [(float(px), float(py)) for px, py in pts]
        total = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
        if total < 1e-3:
            return
        acc = 0.0
        pad = int(max(width0, width1)) + 3
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            seg = math.hypot(x1 - x0, y1 - y0)
            if seg < 1e-4:
                continue
            t0, t1 = acc / total, (acc + seg) / total
            acc += seg
            bx0 = max(0, int(min(x0, x1)) - pad)
            bx1 = min(self.w, int(max(x0, x1)) + pad + 1)
            by0 = max(0, int(min(y0, y1)) - pad)
            by1 = min(self.h, int(max(y0, y1)) + pad + 1)
            if bx1 <= bx0 or by1 <= by0:
                continue
            yy, xx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)
            dx, dy = (x1 - x0) / seg, (y1 - y0) / seg
            u = np.clip(((xx - x0) * dx + (yy - y0) * dy) / seg, 0, 1)
            px, py = x0 + dx * seg * u, y0 + dy * seg * u
            # signed lateral distance
            lat = (xx - px) * (-dy) + (yy - py) * dx
            dist = np.hypot(xx - px, yy - py)
            t = t0 + (t1 - t0) * u
            half = 0.5 * (width0 + (width1 - width0) * t)
            a = np.clip(half - dist + 0.5, 0, 1)
            col = np.asarray(color0, np.float32)[None, None, :] * (1 - t[..., None]) + np.asarray(color1, np.float32)[None, None, :] * t[..., None]
            col = col / 255.0 * shade
            r = np.clip(lat / np.maximum(half, 0.5), -1, 1)
            # normal across the cylinder: lateral direction in image space is (-dy, dx); image y is down -> flip for +Y up
            nxv = r * (-dy) * 0.85
            nyv = -(r * dx) * 0.85
            nzv = np.sqrt(np.clip(1 - nxv * nxv - nyv * nyv, 0.05, 1))
            n = np.stack([nxv, nyv, nzv], axis=-1)
            # cheap bark-like lightness variation along the stroke
            col = col * (0.82 + 0.18 * (1 - np.abs(r)))[..., None]
            a3 = a[..., None]
            reg = (slice(by0, by1), slice(bx0, bx1))
            self.rgb[reg] = self.rgb[reg] * (1 - a3) + col * a3
            self.normal[reg] = self.normal[reg] * (1 - a3) + n * a3
            self.alpha[reg] = self.alpha[reg] * (1 - a) + a

    def disc(self, x: float, y: float, r: float, color, shade: float = 1.0, bloom: float = 0.0, squash: float = 1.0) -> None:
        """Shaded sphere (berry / apple / flower centre) with a proper sphere normal."""
        pad = int(r) + 2
        bx0, bx1 = max(0, int(x) - pad), min(self.w, int(x) + pad + 1)
        by0, by1 = max(0, int(y) - pad), min(self.h, int(y) + pad + 1)
        if bx1 <= bx0 or by1 <= by0:
            return
        yy, xx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)
        ux = (xx - x) / r
        uy = (yy - y) / (r * squash)
        d2 = ux * ux + uy * uy
        a = np.clip((1 - np.sqrt(d2)) * r + 0.5, 0, 1)
        nz = np.sqrt(np.clip(1 - d2, 0.02, 1))
        n = np.stack([ux * 0.95, -uy * 0.95, nz], axis=-1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        col = np.asarray(color, np.float32)[None, None, :] / 255.0 * shade
        col = np.repeat(np.repeat(col, by1 - by0, axis=0), bx1 - bx0, axis=1)
        if bloom > 0:
            # waxy bloom: lighter, bluish toward the upper side
            w = np.clip(0.55 - uy * 0.5, 0, 1)[..., None] * bloom
            col = col * (1 - w) + np.asarray([0.62, 0.66, 0.80], np.float32)[None, None, :] * w * (0.35 + 0.65 * shade)
        col = col * (0.72 + 0.28 * nz)[..., None]
        a3 = a[..., None]
        reg = (slice(by0, by1), slice(bx0, bx1))
        self.rgb[reg] = self.rgb[reg] * (1 - a3) + col * a3
        self.normal[reg] = self.normal[reg] * (1 - a3) + n * a3
        self.alpha[reg] = self.alpha[reg] * (1 - a) + a

    def fill_opaque(self, rgb: np.ndarray, normal: np.ndarray | None = None) -> None:
        self.rgb[:] = rgb
        self.alpha[:] = 1.0
        if normal is not None:
            self.normal[:] = normal

    def to_sprite(self) -> Sprite:
        return Sprite(self.rgb.copy(), self.alpha.copy(), self.normal.copy())


def bleed_edges(rgb: np.ndarray, alpha: np.ndarray, iterations: int = 24) -> np.ndarray:
    """Push opaque colours outward into transparent texels so mip-maps and bilinear taps never pick up black."""
    out = rgb.copy()
    known = alpha > 0.35
    if not known.any():
        return out
    work = out * known[..., None]
    weight = known.astype(np.float32)
    for _ in range(iterations):
        blur_c = cv2.blur(work, (5, 5))
        blur_w = cv2.blur(weight, (5, 5))
        new = blur_w > 1e-4
        fill = blur_c / np.maximum(blur_w[..., None], 1e-4)
        grow = new & ~known
        out[grow] = fill[grow]
        work = out * (known | grow)[..., None]
        weight = (known | grow).astype(np.float32)
        known = known | grow
    if (~known).any():
        mean = out[known].mean(axis=0)
        out[~known] = mean
    return out


def luminance_normal(rgb: np.ndarray, alpha: np.ndarray, strength: float = 2.0, blur: float = 1.2) -> np.ndarray:
    """Tangent-space normal from a pseudo height (luminance x coverage) for procedurally drawn parts."""
    lum = rgb @ np.asarray([0.3, 0.59, 0.11], np.float32)
    hgt = cv2.GaussianBlur(lum * alpha, (0, 0), blur)
    gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3) * strength
    gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3) * strength
    n = np.stack([-gx, gy, np.ones_like(gx)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


class Atlas:
    """A sheet of named tiles. Tiles are composed on their own Canvas and blitted with a transparent gutter."""

    def __init__(self, w: int, h: int):
        self.canvas = Canvas(w, h)
        self.tiles: dict[str, dict] = {}

    def blit(self, name: str, tile: Canvas, x: int, y: int, meta: dict | None = None) -> None:
        if x < 0 or y < 0 or x + tile.w > self.canvas.w or y + tile.h > self.canvas.h:
            raise ValueError(f'tile {name} ({tile.w}x{tile.h} at {x},{y}) does not fit atlas {self.canvas.w}x{self.canvas.h}')
        reg = (slice(y, y + tile.h), slice(x, x + tile.w))
        if (self.canvas.alpha[reg] > 0).any():
            raise ValueError(f'tile {name} overlaps an existing tile')
        self.canvas.rgb[reg] = tile.rgb
        self.canvas.alpha[reg] = tile.alpha
        self.canvas.normal[reg] = tile.normal
        info = {
            'px': [x, y, tile.w, tile.h],
            # UV rectangle with glTF/three convention handled by the Blender side (v = 1 - y/h)
            'u0': x / self.canvas.w,
            'u1': (x + tile.w) / self.canvas.w,
            'v0': 1.0 - (y + tile.h) / self.canvas.h,
            'v1': 1.0 - y / self.canvas.h,
            'coverage': float((tile.alpha > 0.5).mean()),
        }
        if meta:
            info.update(meta)
        self.tiles[name] = info

    def save(self, out_dir: str, name: str, normal_size: int | None = None, opaque_bleed: bool = True, webp_quality: int = 82) -> dict:
        os.makedirs(out_dir, exist_ok=True)
        c = self.canvas
        rgb = bleed_edges(c.rgb, c.alpha) if opaque_bleed else c.rgb
        rgba = np.dstack([np.clip(rgb[..., ::-1], 0, 1), np.clip(c.alpha, 0, 1)])
        albedo_path = os.path.join(out_dir, f'{name}_albedo.png')
        rgba8 = (rgba * 255.0 + 0.5).astype(np.uint8)
        cv2.imwrite(albedo_path, rgba8, [cv2.IMWRITE_PNG_COMPRESSION, 6])
        # shipped encodings (embedded unchanged by the glTF exporter)
        albedo_webp = os.path.join(out_dir, f'{name}_albedo.webp')
        if not cv2.imwrite(albedo_webp, rgba8, [cv2.IMWRITE_WEBP_QUALITY, webp_quality]):
            raise RuntimeError(f'could not write {albedo_webp}')
        # normals: fill transparent texels with flat normal blended outward
        n = c.normal.copy()
        flat = np.zeros_like(n)
        flat[..., 2] = 1
        a3 = np.clip(cv2.GaussianBlur(c.alpha, (0, 0), 2.0) * 1.5, 0, 1)[..., None]
        n = n * a3 + flat * (1 - a3)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        n8 = ((n * 0.5 + 0.5)[..., ::-1] * 255.0 + 0.5).astype(np.uint8)
        if normal_size and normal_size != c.w:
            n8 = cv2.resize(n8, (normal_size, int(round(c.h * normal_size / c.w))), interpolation=cv2.INTER_AREA)
        normal_path = os.path.join(out_dir, f'{name}_normal.png')
        cv2.imwrite(normal_path, n8, [cv2.IMWRITE_PNG_COMPRESSION, 6])
        normal_webp = os.path.join(out_dir, f'{name}_normal.webp')
        if not cv2.imwrite(normal_webp, n8, [cv2.IMWRITE_WEBP_QUALITY, 86]):
            raise RuntimeError(f'could not write {normal_webp}')
        meta = {'name': name, 'size': [c.w, c.h], 'albedo': os.path.relpath(albedo_path, ROOT), 'normal': os.path.relpath(normal_path, ROOT),
                'albedoWebp': os.path.relpath(albedo_webp, ROOT), 'normalWebp': os.path.relpath(normal_webp, ROOT), 'tiles': self.tiles}
        with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8') as fh:
            json.dump(meta, fh, indent=1)
        return meta


def seamless_resample(alb: np.ndarray, nrm: np.ndarray, tile_m: float, w_px: int, h_px: int, width_m: float,
                      rng: random.Random | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Whole number of source tiles squeezed into the target so the result still wraps in u and v (scale error < 1 tile)."""
    height_m = width_m * h_px / w_px
    nx = max(1, int(round(width_m / tile_m)))
    ny = max(1, int(round(height_m / tile_m)))
    ox = rng.randrange(alb.shape[1]) if rng else 0
    oy = rng.randrange(alb.shape[0]) if rng else 0
    big_a = np.tile(np.roll(alb, (oy, ox), axis=(0, 1)), (ny, nx, 1))
    big_n = np.tile(np.roll(nrm, (oy, ox), axis=(0, 1)), (ny, nx, 1))
    a = cv2.resize(big_a, (w_px, h_px), interpolation=cv2.INTER_AREA)
    n = cv2.resize(big_n, (w_px, h_px), interpolation=cv2.INTER_AREA)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
    return a.astype(np.float32), n.astype(np.float32)


def fbm_wrap(w: int, h: int, rng: random.Random, octaves: int = 4, base: int = 4) -> np.ndarray:
    """Value noise in 0..1 that is periodic in x AND y (for ground carpets that repeat)."""
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    nprng = np.random.default_rng(rng.randrange(1 << 30))
    for o in range(octaves):
        gw = base * (2 ** o)
        gh = max(2, int(round(gw * h / w)))
        g = nprng.random((gh, gw), dtype=np.float32)
        g = np.pad(g, ((1, 2), (1, 2)), mode='wrap')
        sx, sy = w / gw, h / gh
        layer = cv2.resize(g, (int(round((gw + 3) * sx)), int(round((gh + 3) * sy))), interpolation=cv2.INTER_CUBIC)
        x0, y0 = int(round(1.5 * sx)), int(round(1.5 * sy))
        out += layer[y0:y0 + h, x0:x0 + w] * amp
        tot += amp
        amp *= 0.5
    return np.clip(out / tot, 0, 1)


def tile_library_albedo(mat_id: str, w_px: int, h_px: int, width_m: float, rng: random.Random | None = None,
                        seamless: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """Crop of a seamless library albedo + normal resampled so `w_px` covers `width_m` metres (real-world scale)."""
    tile_m = library_tile_m(mat_id)
    alb = _read(library_map(mat_id, 'albedo', '')).astype(np.float32)[..., ::-1] / 255.0
    nrm = _read(library_map(mat_id, 'normal', '')).astype(np.float32)[..., ::-1] / 255.0 * 2.0 - 1.0
    if seamless:
        return seamless_resample(alb, nrm, tile_m, w_px, h_px, width_m, rng)
    src_px_per_m = alb.shape[1] / tile_m
    dst_px_per_m = w_px / width_m
    scale = dst_px_per_m / src_px_per_m
    need_w = int(math.ceil(w_px / scale)) + 2
    need_h = int(math.ceil(h_px / scale)) + 2
    reps_x = int(math.ceil(need_w / alb.shape[1])) + 1
    reps_y = int(math.ceil(need_h / alb.shape[0])) + 1
    ox = rng.randrange(alb.shape[1]) if rng else 0
    oy = rng.randrange(alb.shape[0]) if rng else 0
    big_a = np.roll(np.tile(alb, (reps_y, reps_x, 1)), (oy, ox), axis=(0, 1))[:need_h, :need_w]
    big_n = np.roll(np.tile(nrm, (reps_y, reps_x, 1)), (oy, ox), axis=(0, 1))[:need_h, :need_w]
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    a = cv2.resize(big_a, (w_px, h_px), interpolation=interp)
    n = cv2.resize(big_n, (w_px, h_px), interpolation=interp)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
    return a.astype(np.float32), n.astype(np.float32)


def fbm(w: int, h: int, rng: random.Random, octaves: int = 4, base: int = 4, wrap_x: bool = False) -> np.ndarray:
    """Smooth value noise in 0..1 (optionally periodic in x)."""
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    nprng = np.random.default_rng(rng.randrange(1 << 30))
    for o in range(octaves):
        gw = base * (2 ** o)
        gh = max(2, int(round(gw * h / w)))
        g = nprng.random((gh, gw), dtype=np.float32)
        if wrap_x:
            g = np.concatenate([g, g[:, :1]], axis=1)
            layer = cv2.resize(g, (w + w // gw, h), interpolation=cv2.INTER_CUBIC)[:, :w]
        else:
            layer = cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)
        out += layer * amp
        tot += amp
        amp *= 0.5
    return np.clip(out / tot, 0, 1)


def save_floor(canvas: Canvas, out_dir: str, name: str, meta: dict | None = None) -> None:
    """Opaque, seamless ground-carpet texture (albedo + normal) kept OUT of the card atlas so it can tile by UV repeat."""
    os.makedirs(out_dir, exist_ok=True)
    rgb = (np.clip(canvas.rgb[..., ::-1], 0, 1) * 255.0 + 0.5).astype(np.uint8)
    n = canvas.normal / (np.linalg.norm(canvas.normal, axis=-1, keepdims=True) + 1e-6)
    n8 = ((n * 0.5 + 0.5)[..., ::-1] * 255.0 + 0.5).astype(np.uint8)
    n8 = cv2.resize(n8, (canvas.w // 2, canvas.h // 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(out_dir, f'{name}_albedo.jpg'), rgb, [cv2.IMWRITE_JPEG_QUALITY, 84])
    cv2.imwrite(os.path.join(out_dir, f'{name}_normal.jpg'), n8, [cv2.IMWRITE_JPEG_QUALITY, 86])
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8') as fh:
        json.dump({'name': name, 'size': [canvas.w, canvas.h], **(meta or {})}, fh, indent=1)
