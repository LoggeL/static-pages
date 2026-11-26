#!/usr/bin/env python3
"""
estates_textures.py — generates the two unique textures of the estate landmarks (plain python3 + Pillow,
NOT run inside Blender):

  blender/landmarks/estates_textures/estates_signs_albedo.webp  1024 px sign atlas (winery sign, yard
                                                                boards, house numbers, hall signs)
  blender/landmarks/estates_textures/estates_glass_orm.png      8 px constant ORM (keeps window glass smooth)

Everything else on the three models comes from the shared CC0 library (blender/shared_textures).
Atlas rectangles are (u0, v0, u1, v1) with v = 0 at the BOTTOM of the image; keep them in sync with
the SIGN_* constants in the build_*.py files.

    python3 blender/landmarks/estates_textures.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / "estates_textures"
FONTS = Path("/System/Library/Fonts/Supplemental")
S = 1024

RECTS = {
    "weingut_main":   (0.0, 0.75, 0.75, 1.0),
    "keystone":       (0.75, 0.75, 1.0, 0.875),
    "nr_44":          (0.75, 0.875, 0.875, 1.0),
    "nr_107":         (0.875, 0.875, 1.0, 1.0),
    "hofverkauf":     (0.0, 0.5, 0.5, 0.75),
    "winzerhof":      (0.5, 0.5, 1.0, 0.75),
    "halle":          (0.0, 0.25, 0.5, 0.5),
    "nr_16":          (0.5, 0.375, 0.625, 0.5),
    "warn":           (0.625, 0.375, 0.75, 0.5),
    "einfahrt":       (0.75, 0.375, 1.0, 0.5),
    "tafel":          (0.0, 0.0, 0.375, 0.25),
    "tuev":           (0.5, 0.25, 0.75, 0.375),
}


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    p = FONTS / name
    if not p.exists():
        raise RuntimeError(f"Font not found: {p}")
    return ImageFont.truetype(str(p), size)


def px(rect):
    u0, v0, u1, v1 = rect
    return int(u0 * S), int((1 - v1) * S), int(u1 * S), int((1 - v0) * S)


def centered(d: ImageDraw.ImageDraw, box, y, text, fnt, fill, spacing=0):
    x0, y0, x1, y1 = box
    w = d.textlength(text, font=fnt)
    d.text(((x0 + x1 - w) / 2, y0 + y), text, font=fnt, fill=fill)


def grapes(d: ImageDraw.ImageDraw, cx, cy, r, fill, leaf):
    rows = [3, 4, 3, 2, 1]
    for j, n in enumerate(rows):
        for i in range(n):
            x = cx + (i - (n - 1) / 2) * r * 1.9
            y = cy + j * r * 1.65
            d.ellipse([x - r, y - r, x + r, y + r], fill=fill)
    d.polygon([(cx - r * 4.2, cy - r * 2.6), (cx - r * 0.4, cy - r * 3.6), (cx + r * 0.6, cy - r * 1.3), (cx - r * 2.0, cy - r * 0.6)], fill=leaf)
    d.line([(cx, cy - r * 1.2), (cx + r * 0.8, cy - r * 4.2)], fill=leaf, width=max(2, int(r * 0.5)))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", (S, S), (60, 60, 60))
    d = ImageDraw.Draw(im)

    # --- Weingut main sign: dark green enamel board, cream lettering, gold line ---------------
    b = px(RECTS["weingut_main"])
    d.rectangle(b, fill=(24, 48, 36))
    d.rectangle([b[0] + 10, b[1] + 10, b[2] - 10, b[3] - 10], outline=(196, 164, 92), width=4)
    centered(d, (b[0] + 150, b[1], b[2], b[3]), 34, "WEINGUT", font("Georgia Bold.ttf", 54), (232, 222, 196))
    centered(d, (b[0] + 150, b[1], b[2], b[3]), 98, "Raspfambert", font("Georgia Bold Italic.ttf", 84), (236, 226, 200))
    centered(d, (b[0] + 150, b[1], b[2], b[3]), 200, "KINDENHEIM  ·  PFALZ", font("Georgia.ttf", 28), (196, 164, 92))
    grapes(d, b[0] + 98, b[1] + 96, 15, (196, 164, 92), (150, 170, 110))

    # --- Keystone date (carved sandstone look) -------------------------------------------------
    b = px(RECTS["keystone"])
    d.rectangle(b, fill=(176, 142, 104))
    f = font("Times New Roman Bold.ttf", 66)
    for off, col in (((2, 3), (104, 78, 54)), ((0, 0), (128, 98, 70))):
        d.text((b[0] + 18 + off[0], b[1] + 28 + off[1]), "17", font=f, fill=col)
        d.text((b[0] + 166 + off[0], b[1] + 28 + off[1]), "82", font=f, fill=col)
    grapes(d, (b[0] + b[2]) // 2, b[1] + 44, 8, (118, 90, 64), (118, 90, 64))

    # --- Enamel house numbers (blue with white figures) ----------------------------------------
    for key, txt in (("nr_44", "44"), ("nr_107", "107"), ("nr_16", "16")):
        b = px(RECTS[key])
        d.rectangle(b, fill=(22, 52, 122))
        d.rectangle([b[0] + 6, b[1] + 6, b[2] - 6, b[3] - 6], outline=(236, 236, 232), width=4)
        fs = 76 if len(txt) < 3 else 58
        f = font("DIN Alternate Bold.ttf", fs)
        w = d.textlength(txt, font=f)
        d.text(((b[0] + b[2] - w) / 2, b[1] + (128 - fs) / 2 - 6), txt, font=f, fill=(240, 240, 236))

    # --- Hofverkauf board: cream board, burgundy text -----------------------------------------
    b = px(RECTS["hofverkauf"])
    d.rectangle(b, fill=(226, 214, 184))
    d.rectangle([b[0] + 8, b[1] + 8, b[2] - 8, b[3] - 8], outline=(112, 28, 36), width=5)
    centered(d, b, 26, "Weinverkauf", font("Georgia Bold Italic.ttf", 68), (112, 28, 36))
    centered(d, b, 112, "Probierstube · Hofladen", font("Georgia.ttf", 36), (60, 44, 36))
    centered(d, b, 166, "Riesling · Dornfelder · Sekt", font("Georgia Italic.ttf", 30), (60, 44, 36))
    centered(d, b, 208, "Mo – Sa  9 – 18 Uhr", font("Georgia.ttf", 24), (112, 28, 36))

    # --- Winzerhof board: weathered timber board, painted white lettering ----------------------
    b = px(RECTS["winzerhof"])
    d.rectangle(b, fill=(84, 60, 42))
    for i in range(0, 256, 9):
        shade = 78 + (i * 37 % 17)
        d.line([(b[0], b[1] + i), (b[2], b[1] + i)], fill=(shade, shade - 22, shade - 40), width=2)
    centered(d, b, 30, "Winzerhof", font("Georgia Bold.ttf", 78), (236, 230, 214))
    centered(d, b, 128, "Hauptstraße 107", font("Georgia Italic.ttf", 40), (236, 230, 214))
    centered(d, b, 186, "Wein · Trauben · Brennholz ab Hof", font("Georgia.ttf", 27), (214, 196, 150))

    # --- Hall company board: white aluminium composite, green stripe --------------------------
    b = px(RECTS["halle"])
    d.rectangle(b, fill=(238, 238, 232))
    d.rectangle([b[0], b[1], b[2], b[1] + 62], fill=(44, 96, 58))
    centered(d, b, 12, "AGRARHALLE KINDENHEIM", font("DIN Condensed Bold.ttf", 44), (240, 240, 234))
    centered(d, b, 84, "Maschinen | Lager | Getreide", font("DIN Alternate Bold.ttf", 34), (40, 44, 42))
    centered(d, b, 138, "Raiffeisenstraße 16", font("DIN Alternate Bold.ttf", 40), (44, 96, 58))
    centered(d, b, 198, "Anlieferung über den Hof – Schritt fahren", font("Arial.ttf", 22), (70, 74, 72))

    # --- Warning sign: yellow triangle on white --------------------------------------------------
    b = px(RECTS["warn"])
    d.rectangle(b, fill=(240, 240, 236))
    cx = (b[0] + b[2]) // 2
    d.polygon([(cx, b[1] + 10), (b[2] - 12, b[3] - 34), (b[0] + 12, b[3] - 34)], fill=(20, 20, 20))
    d.polygon([(cx, b[1] + 24), (b[2] - 26, b[3] - 42), (b[0] + 26, b[3] - 42)], fill=(246, 198, 22))
    d.text((cx - 8, b[1] + 38), "!", font=font("Arial Black.ttf", 44), fill=(20, 20, 20))
    centered(d, b, 100, "Betriebsgelände", font("Arial Bold.ttf", 13), (20, 20, 20))

    # --- "Einfahrt freihalten" -------------------------------------------------------------------
    b = px(RECTS["einfahrt"])
    d.rectangle(b, fill=(238, 238, 234))
    d.rectangle([b[0] + 5, b[1] + 5, b[2] - 5, b[3] - 5], outline=(196, 30, 34), width=6)
    centered(d, b, 22, "Einfahrt", font("Arial Black.ttf", 40), (196, 30, 34))
    centered(d, b, 72, "freihalten!", font("Arial Black.ttf", 36), (30, 30, 30))

    # --- Chalk board (Federweißer season) --------------------------------------------------------
    b = px(RECTS["tafel"])
    d.rectangle(b, fill=(34, 40, 38))
    d.rectangle([b[0] + 4, b[1] + 4, b[2] - 4, b[3] - 4], outline=(120, 86, 56), width=10)
    centered(d, b, 30, "Neuer Wein", font("Chalkduster.ttf", 46), (236, 236, 226))
    centered(d, b, 92, "& Zwiebelkuchen", font("Chalkduster.ttf", 34), (236, 236, 226))
    centered(d, b, 150, "Hof geöffnet", font("Chalkduster.ttf", 34), (246, 214, 120))
    centered(d, b, 200, "Trauben frisch gelesen", font("Chalkduster.ttf", 20), (200, 220, 200))

    # --- Tank label / safety plate ---------------------------------------------------------------
    b = px(RECTS["tuev"])
    d.rectangle(b, fill=(244, 206, 30))
    d.rectangle([b[0] + 5, b[1] + 5, b[2] - 5, b[3] - 5], outline=(20, 20, 20), width=4)
    centered(d, b, 18, "DIESEL", font("Arial Black.ttf", 48), (20, 20, 20))
    centered(d, b, 80, "Rauchen verboten", font("Arial Bold.ttf", 22), (20, 20, 20))

    # slight softening so the lettering does not alias against the photo-scanned surroundings
    im = im.filter(ImageFilter.GaussianBlur(0.45))
    im.save(OUT / "estates_signs_albedo.webp", "WEBP", quality=92, method=6)

    # constant ORM for glass: AO 1.0, roughness 0.08, metalness 0
    Image.new("RGB", (8, 8), (255, 20, 0)).save(OUT / "estates_glass_orm.png")
    print("wrote", OUT / "estates_signs_albedo.webp", "and estates_glass_orm.png")
    build_foliage_atlas()
    build_glow_sprite()


def build_glow_sprite():
    """Soft radial alpha sprite for lamp glow cards / light pools (alpha-blended, emissive at night)."""
    import numpy as np
    n = 128
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - (n - 1) / 2, yy - (n - 1) / 2) / (n / 2)
    alpha = np.clip(1.0 - r, 0.0, 1.0) ** 2.2
    arr = np.zeros((n, n, 4), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = 255, 238, 210
    arr[..., 3] = (alpha * 255).astype(np.uint8)
    Image.fromarray(arr, "RGBA").save(OUT / "estates_glow.webp", "WEBP", lossless=True, exact=True)
    print("wrote", OUT / "estates_glow.webp")


# ---------------------------------------------------------------------------
# Alpha-masked foliage atlas (vine leaves, shoots, grape clusters, geraniums, shrubs, grape heap)
# ---------------------------------------------------------------------------

VEG_DIR = Path(__file__).resolve().parents[1] / "village" / "textures" / "props"   # vegetation agent's atlases (read-only)
FOL = 1024
# name: (source atlas, source px box (x, y, w, h), destination px box (x, y, w, h))
FOLIAGE_TILES = {
    "leaf_wall":   ("veg_vine_atlas_albedo.png", (0, 520, 2048, 624), (0, 0, 1024, 312)),
    "shoot_0":     ("veg_vine_atlas_albedo.png", (8, 1160, 368, 496), (4, 320, 184, 248)),
    "shoot_1":     ("veg_vine_atlas_albedo.png", (392, 1160, 368, 496), (196, 320, 184, 248)),
    "shoot_2":     ("veg_vine_atlas_albedo.png", (776, 1160, 368, 496), (388, 320, 184, 248)),
    "shoot_3":     ("veg_vine_atlas_albedo.png", (1160, 1160, 368, 496), (580, 320, 184, 248)),
    "grape_0":     ("veg_vine_atlas_albedo.png", (1544, 1160, 160, 320), (772, 320, 80, 160)),
    "grape_1":     ("veg_vine_atlas_albedo.png", (1712, 1160, 160, 320), (856, 320, 80, 160)),
    "grape_2":     ("veg_vine_atlas_albedo.png", (1880, 1160, 160, 320), (940, 320, 80, 160)),
    "leaf_0":      ("veg_vine_atlas_albedo.png", (8, 1672, 240, 240), (4, 576, 120, 120)),
    "leaf_1":      ("veg_vine_atlas_albedo.png", (264, 1672, 240, 240), (132, 576, 120, 120)),
    "leaf_2":      ("veg_vine_atlas_albedo.png", (520, 1672, 240, 240), (260, 576, 120, 120)),
    "leaf_3":      ("veg_vine_atlas_albedo.png", (776, 1672, 240, 240), (388, 576, 120, 120)),
    "leaf_4":      ("veg_vine_atlas_albedo.png", (1032, 1672, 240, 240), (516, 576, 120, 120)),
    "geranium":    ("veg_garden_atlas_albedo.png", (520, 1032, 496, 496), (4, 832, 184, 184)),
    "tuft":        ("veg_garden_atlas_albedo.png", (520, 520, 496, 496), (196, 832, 184, 184)),
    "shrub":       ("veg_garden_atlas_albedo.png", (8, 1032, 496, 496), (388, 832, 184, 184)),
    "hornbeam":    ("veg_garden_atlas_albedo.png", (1544, 520, 496, 496), (580, 832, 184, 184)),
    "oleander":    ("veg_garden_atlas_albedo.png", (520, 1032, 496, 496), (772, 832, 184, 184)),
}
GRAPE_HEAP_BOX = (660, 576, 248, 248)


def _strip_cut_grapes(crop: Image.Image) -> Image.Image:
    """The vineyard-row strip of the vegetation atlas ends in grape clusters cut flat at its bottom edge (in a
    vineyard row that edge hides behind the next row). On the pergola the strips are seen from below, where those
    cut clusters read as dark squares with straight edges: remove every grape pixel in the lower band and give
    the remaining leaves a ragged, uneven bottom edge instead of the straight crop line."""
    import numpy as np
    a = np.asarray(crop.convert("RGBA")).copy()
    h, w = a.shape[:2]
    rgb = a[..., :3].astype(np.int16)
    band = np.zeros((h, w), bool)
    band[int(h * 0.62):] = True
    grape = band & (a[..., 3] > 0) & ((rgb[..., 2] >= rgb[..., 1] - 6) | (rgb.sum(-1) < 150))
    # grow the mask by 3 px so no dark fringe of a cluster survives
    from scipy.ndimage import binary_dilation
    grape = binary_dilation(grape, iterations=3) & band
    a[..., 3][grape] = 0
    # ragged bottom edge: every column ends at its own height in the last 0..9 % of the strip
    rng = np.random.default_rng(11)
    cut = h - 1 - (np.convolve(rng.uniform(0.0, 0.09 * h, w), np.ones(9) / 9.0, mode="same")).astype(int)
    rows = np.arange(h)[:, None]
    a[..., 3][rows > cut[None, :]] = 0
    removed = int(grape.sum())
    if removed < 1000:
        raise RuntimeError(f"leaf_wall strip: expected the cut grape clusters in its bottom band, found only {removed} px")
    return Image.fromarray(a, "RGBA")


def _grape_heap_tile(w: int, h: int, rng) -> Image.Image:
    """Seamless tile of densely heaped grape berries: near-black blue-violet berries, each with a soft
    grey-blue bloom (the waxy coating), a darker core and a small dull highlight, dark gaps between them."""
    import numpy as np
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    acc = np.zeros((h, w, 3), np.float32)
    acc[...] = (0.005, 0.004, 0.008)                     # deep gaps between the berries (linear)
    zbuf = np.full((h, w), -1e9, np.float32)
    berries = []
    for _ in range(3800):                                # ~4 mm per texel on the tub heap: berries 2.5-3.8 cm
        r = rng.uniform(3.2, 4.8)
        berries.append((rng.uniform(0, w), rng.uniform(0, h), r, rng.uniform(0.0, 1.0), rng.uniform(0.75, 1.2),
                        rng.uniform(-0.6, 0.6)))
    for (cx, cy, r, z, val, hue) in berries:
        for ox in (-w, 0, w):
            for oy in (-h, 0, h):
                x0, x1 = int(cx + ox - r - 1), int(cx + ox + r + 2)
                y0, y1 = int(cy + oy - r - 1), int(cy + oy + r + 2)
                if x1 < 0 or y1 < 0 or x0 >= w or y0 >= h:
                    continue
                x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
                dx = (xx[y0:y1, x0:x1] - (cx + ox)) / r
                dy = (yy[y0:y1, x0:x1] - (cy + oy)) / (r * 0.92)
                d2 = dx * dx + dy * dy
                inside = d2 < 1.0
                nz = np.sqrt(np.clip(1.0 - d2, 0.0, 1.0))
                depth = z + nz * 0.3
                vis = inside & (depth > zbuf[y0:y1, x0:x1])
                if not vis.any():
                    continue
                # body: blue-black, slightly violet or slightly red-purple per berry
                body = np.array((0.009 + 0.003 * hue, 0.0055, 0.021 - 0.003 * hue), np.float32) * val
                # bloom: matte grey-blue film, strongest towards the berry's rim (grazing view through the wax)
                bloom = np.clip(1.0 - nz, 0.0, 1.0) ** 1.8 * 0.40 + 0.10
                bloom_col = np.array((0.030, 0.036, 0.062), np.float32)
                shade = 0.40 + 0.60 * np.clip(nz * 0.8 - dx * 0.25 - dy * 0.35, 0.0, 1.0)    # light from upper left
                col = (body[None, None, :] * (1.0 - bloom[..., None]) + bloom_col[None, None, :] * bloom[..., None])
                col = col * shade[..., None]
                spec = np.exp(-((dx + 0.35) ** 2 + (dy + 0.38) ** 2) / 0.025)[..., None] * 0.035
                col = col + spec
                # dark contact ring at the berry outline
                col = col * (0.35 + 0.65 * np.clip((1.0 - d2) / 0.25, 0.0, 1.0))[..., None]
                sl = acc[y0:y1, x0:x1]
                sl[vis] = col[vis]
                zbuf[y0:y1, x0:x1][vis] = depth[vis]
    # a few short green-brown stems (drawn after the sRGB conversion)
    srgb = np.where(acc <= 0.0031308, acc * 12.92, 1.055 * np.power(np.clip(acc, 0.0031308, None), 1 / 2.4) - 0.055)
    img = Image.fromarray(np.clip(srgb * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    for _ in range(14):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        a_ = rng.uniform(0, 6.283)
        L = rng.uniform(5, 10)
        import math as _m
        d.line([(x, y), (x + L * _m.cos(a_), y + L * _m.sin(a_))], fill=(52, 50, 30), width=1)
    return img.convert("RGBA")


def _bleed_rgb(atlas: Image.Image) -> Image.Image:
    """Fill the colour of fully transparent texels with the colour of the nearest opaque texels (push-pull).
    The GPU builds the mip chain from the raw RGBA, so without this the dark RGB under alpha 0 bleeds into the
    leaf edges at a distance and at grazing angles (black, ragged canopy silhouettes)."""
    import numpy as np
    a = np.asarray(atlas).astype(np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]
    w = (alpha > 0.5).astype(np.float32)
    levels = [(rgb * w[..., None], w)]
    while levels[-1][1].shape[0] > 1:
        c, ww = levels[-1]
        hh, wd = c.shape[0] // 2, c.shape[1] // 2
        c2 = c[:hh * 2, :wd * 2].reshape(hh, 2, wd, 2, 3).sum((1, 3))
        w2 = ww[:hh * 2, :wd * 2].reshape(hh, 2, wd, 2).sum((1, 3))
        levels.append((c2, w2))
    c, ww = levels[-1]
    filled = c / np.maximum(ww, 1e-6)[..., None]
    for c, ww in reversed(levels[:-1]):
        up = np.repeat(np.repeat(filled, 2, 0), 2, 1)[:c.shape[0], :c.shape[1]]
        own = c / np.maximum(ww, 1e-6)[..., None]
        k = np.clip(ww, 0.0, 1.0)[..., None]
        filled = own * k + up * (1.0 - k)
    out = np.where((alpha > 0.5)[..., None], rgb, filled)
    res = np.dstack([out, alpha])
    if not np.isfinite(res).all():
        raise RuntimeError("foliage atlas colour bleed produced non-finite texels")
    return Image.fromarray(np.clip(res * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGBA")


def build_foliage_atlas():
    """Crops the tiles we need from the vegetation agent's vine / garden atlases into our own
    1K RGBA atlas (estates-prefixed copy) and writes the UV rectangles next to it."""
    import json
    import random
    import numpy as np

    atlas = Image.new("RGBA", (FOL, FOL), (74, 84, 44, 0))
    src_cache = {}
    rects = {}
    for name, (src_name, (sx, sy, sw, sh), (dx, dy, dw, dh)) in FOLIAGE_TILES.items():
        src_path = VEG_DIR / src_name
        if not src_path.exists():
            raise RuntimeError(f"Vegetation atlas missing: {src_path}")
        if src_name not in src_cache:
            src_cache[src_name] = Image.open(src_path).convert("RGBA")
        crop = src_cache[src_name].crop((sx, sy, sx + sw, sy + sh))
        if name == "leaf_wall":
            crop = _strip_cut_grapes(crop)
        tile = crop.resize((dw, dh), Image.LANCZOS)
        if name == "geranium":
            # pink blossom -> geranium red (hue shift only where the source is magenta/pink)
            arr = np.asarray(tile.convert("RGB").convert("HSV")).astype(np.int16)
            h, sat = arr[..., 0], arr[..., 1]
            pink = ((h > 200) | (h < 12)) & (sat > 60)
            arr[..., 0] = np.where(pink, 252, h)
            arr[..., 1] = np.where(pink, np.clip(sat * 1.5 + 40, 0, 255), sat)
            rgb = Image.fromarray(arr.astype(np.uint8), "HSV").convert("RGB")
            tile = Image.merge("RGBA", (*rgb.split(), tile.split()[3]))
        atlas.paste(tile, (dx, dy))
        rects[name] = [round((dx + 2) / FOL, 5), round(1 - (dy + dh - 2) / FOL, 5), round((dx + dw - 2) / FOL, 5),
                       round(1 - (dy + 2) / FOL, 5)]
    # opaque grape heap tile: loose, tightly packed blue-black berries with the waxy grey-blue bloom of
    # ripe Dornfelder / Portugieser grapes (painted berry by berry, tiles seamlessly in both directions)
    hx, hy, hw, hh = GRAPE_HEAP_BOX
    atlas.paste(_grape_heap_tile(hw, hh, random.Random(7)), (hx, hy))
    rects["grape_heap"] = [round((hx + 3) / FOL, 5), round(1 - (hy + hh - 3) / FOL, 5), round((hx + hw - 3) / FOL, 5),
                           round(1 - (hy + 3) / FOL, 5)]
    atlas = _bleed_rgb(atlas)
    atlas.save(OUT / "estates_foliage_albedo.webp", "WEBP", quality=90, method=6, exact=True)
    with open(OUT / "estates_foliage.json", "w", encoding="utf-8") as f:
        json.dump({"size": FOL, "source": "tiles cropped from blender/village/textures/props/veg_vine_atlas + veg_garden_atlas",
                   "tiles": rects}, f, indent=1)
    print("wrote", OUT / "estates_foliage_albedo.webp", f"({len(rects)} tiles)")


if __name__ == "__main__":
    main()
