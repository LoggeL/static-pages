#!/usr/bin/env python3
"""
Unique (non-library) textures for the Kindenheim recreation assets.

Everything that tiles (clay, sand, grass, timber, steel, concrete, plaster, roof tiles ...) comes
from the shared CC0 PBR library in blender/shared_textures/. This script only produces the few
maps the library cannot provide:

  rec_net_albedo.png            RGBA  goal net (square mesh, alpha)
  rec_chain_albedo.png          RGBA  swing chain strip (alpha)
  rec_chainlink_albedo.png      RGBA  chain-link fence mesh (alpha)
  rec_rope_albedo.png / _normal.png   twisted play-rope (neutral, tinted per material)
  rec_sportheim_sign_albedo.png       club house fascia sign (fictional texts kept from v1)
  rec_scoreboard_albedo.png           manual village scoreboard face
  rec_spielplatz_sign_albedo.png      municipal playground sign
  rec_decals_albedo.png               atlas: door labels, kiosk board, notice-board sheets

Run with the system python (needs numpy + Pillow):
    python3 blender/recreation/generate_textures.py
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent / "textures"
FONT_DIR = Path("/System/Library/Fonts/Supplemental")
FONTS = {
    "bold": FONT_DIR / "Arial Bold.ttf",
    "regular": FONT_DIR / "Arial.ttf",
    "narrow": FONT_DIR / "Arial Narrow Bold.ttf",
    "black": FONT_DIR / "Arial Black.ttf",
}


def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONTS[kind]
    if not path.exists():
        raise FileNotFoundError(f"Font for sign textures is missing: {path}")
    return ImageFont.truetype(str(path), size)


def save(img: Image.Image, name: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    img.save(path)
    print(f"  wrote {path.name}  {img.size[0]}x{img.size[1]} {img.mode}")


def tile_noise(w: int, h: int, grid: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    gy = max(1, round(grid * h / w))
    base = rng.random((gy, grid), dtype=np.float32)
    xs = np.linspace(0, grid, w, endpoint=False, dtype=np.float32)
    ys = np.linspace(0, gy, h, endpoint=False, dtype=np.float32)
    ix, iy = np.floor(xs).astype(int) % grid, np.floor(ys).astype(int) % gy
    fx, fy = xs - np.floor(xs), ys - np.floor(ys)
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    ix1, iy1 = (ix + 1) % grid, (iy + 1) % gy
    a = base[np.ix_(iy, ix)] * (1 - ux)[None, :] + base[np.ix_(iy, ix1)] * ux[None, :]
    b = base[np.ix_(iy1, ix)] * (1 - ux)[None, :] + base[np.ix_(iy1, ix1)] * ux[None, :]
    return a * (1 - uy)[:, None] + b * uy[:, None]


def fbm(w: int, h: int, seed: int, grids=(4, 8, 16, 32, 64)) -> np.ndarray:
    acc = np.zeros((h, w), dtype=np.float32)
    wsum = 0.0
    for i, g in enumerate(grids):
        wgt = 0.5**i
        acc += wgt * tile_noise(w, h, g, seed + 31 * i)
        wsum += wgt
    return acc / wsum


def weather(img: Image.Image, seed: int, dirt: float = 0.10, streaks: float = 0.08) -> Image.Image:
    """Subtle outdoor weathering: blotchy fading plus vertical rain streaks. No baked lighting."""
    w, h = img.size
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    blot = fbm(w, h, seed, grids=(3, 6, 12, 24))
    arr *= (1.0 - dirt) + dirt * blot[..., None] + dirt * 0.5
    col = np.random.default_rng(seed + 7).random(w + 12).astype(np.float32)
    col = np.convolve(col, np.ones(13, dtype=np.float32) / 13, mode="valid")[:w]
    ramp = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None] ** 0.7
    streak = np.clip((col[None, :] - 0.52) * 6.0, 0.0, 1.0) * ramp
    grime = np.array([0.45, 0.42, 0.36], dtype=np.float32)
    arr = arr * (1.0 - streaks * streak[..., None]) + grime * streaks * streak[..., None] * 0.6
    grain = np.random.default_rng(seed + 3).normal(0.0, 0.012, (h, w, 1)).astype(np.float32)
    arr = np.clip(arr + grain, 0.0, 1.0)
    return Image.fromarray((arr * 255).astype(np.uint8), "RGB")


def centered(draw: ImageDraw.ImageDraw, cx: float, y: float, text: str, fnt, fill) -> None:
    box = draw.textbbox((0, 0), text, font=fnt)
    draw.text((cx - (box[2] - box[0]) / 2 - box[0], y), text, fill=fill, font=fnt)


# ---------------------------------------------------------------------------
# Alpha-blended thin structures
# ---------------------------------------------------------------------------

def gen_net() -> None:
    """Knotted square goal net, 4 x 4 meshes per tile (tile = 0.48 m -> 12 cm mesh)."""
    s, ss = 256, 4
    big = s * ss
    alpha = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(alpha)
    cell = big / 4
    cord = 30  # ~5 mm cord on a 12 cm mesh, slightly fat so mip levels keep some coverage
    for i in range(-1, 6):
        c = (i + 0.5) * cell
        d.line([(c, -8), (c, big + 8)], fill=255, width=cord)
        d.line([(-8, c), (big + 8, c)], fill=255, width=cord)
    for i in range(5):
        for j in range(5):
            cx, cy = (i + 0.5) * cell, (j + 0.5) * cell
            r = cord * 0.95
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    alpha = alpha.resize((s, s), Image.LANCZOS)
    a = np.asarray(alpha, dtype=np.float32) / 255.0
    shade = 0.86 + 0.14 * fbm(s, s, 11, grids=(16, 32, 64))
    rgb = np.stack([shade * 0.96, shade * 0.96, shade * 0.93], axis=-1)
    out = np.dstack([np.clip(rgb, 0, 1), a])
    save(Image.fromarray((out * 255).astype(np.uint8), "RGBA"), "rec_net_albedo.png")


def gen_chain() -> None:
    """Short-link galvanised chain, 4 links per tile, alternating face-on / edge-on links."""
    w, h, ss = 64, 256, 4
    W, H = w * ss, h * ss
    col = Image.new("RGB", (W, H), (150, 154, 158))
    alpha = Image.new("L", (W, H), 0)
    dc, da = ImageDraw.Draw(col), ImageDraw.Draw(alpha)
    link_h = H / 4
    for i in range(-1, 5):
        cy = (i + 0.5) * link_h
        if i % 2 == 0:
            rx, ry, t = W * 0.36, link_h * 0.68, W * 0.15
            da.ellipse([W / 2 - rx, cy - ry, W / 2 + rx, cy + ry], fill=255)
            da.ellipse([W / 2 - rx + t, cy - ry + t, W / 2 + rx - t, cy + ry - t], fill=0)
            dc.ellipse([W / 2 - rx, cy - ry, W / 2 + rx, cy + ry], fill=(176, 180, 184))
            dc.arc([W / 2 - rx + 3, cy - ry + 3, W / 2 + rx - 3, cy + ry - 3], 200, 320, fill=(214, 218, 222), width=5)
        else:
            bw = W * 0.085
            da.rounded_rectangle([W / 2 - bw, cy - link_h * 0.68, W / 2 + bw, cy + link_h * 0.68], radius=bw, fill=255)
            dc.rounded_rectangle([W / 2 - bw, cy - link_h * 0.68, W / 2 + bw, cy + link_h * 0.68], radius=bw, fill=(132, 136, 140))
    col = col.resize((w, h), Image.LANCZOS)
    alpha = alpha.resize((w, h), Image.LANCZOS)
    col.putalpha(alpha)
    save(col, "rec_chain_albedo.png")


def gen_chainlink() -> None:
    """Chain-link (Maschendraht) fence mesh, 4 x 4 diamonds per tile (tile = 0.24 m -> 60 mm mesh)."""
    s, ss = 256, 4
    big = s * ss
    alpha = Image.new("L", (big, big), 0)
    lum = Image.new("L", (big, big), 150)
    da, dl = ImageDraw.Draw(alpha), ImageDraw.Draw(lum)
    step = big / 4
    wire = int(big * 0.030)
    for i in range(-6, 12):
        x = i * step
        da.line([(x, 0), (x + big, big)], fill=255, width=wire)
        da.line([(x, big), (x + big, 0)], fill=255, width=wire)
        dl.line([(x, 0), (x + big, big)], fill=178, width=wire)
        dl.line([(x, big), (x + big, 0)], fill=140, width=wire)
        dl.line([(x - wire * 0.25, 0), (x + big - wire * 0.25, big)], fill=206, width=max(1, wire // 4))
    alpha = alpha.resize((s, s), Image.LANCZOS)
    lum = lum.resize((s, s), Image.LANCZOS)
    l = np.asarray(lum, dtype=np.float32) / 255.0
    rgb = np.stack([l * 0.97, l * 1.0, l * 1.02], axis=-1)
    out = np.dstack([np.clip(rgb, 0, 1), np.asarray(alpha, dtype=np.float32) / 255.0])
    save(Image.fromarray((out * 255).astype(np.uint8), "RGBA"), "rec_chainlink_albedo.png")


def gen_rope() -> None:
    """Twisted 3-strand play rope. U runs along the rope (1 tile = 8 cm), V around it."""
    s = 128
    u = np.linspace(0, 1, s, endpoint=False, dtype=np.float32)[None, :]
    v = np.linspace(0, 1, s, endpoint=False, dtype=np.float32)[:, None]
    phase = (u * 2.0 + v * 3.0) % 1.0  # strands wrap diagonally, seamless in both directions
    strand = np.sin(phase * math.pi) ** 0.6
    fibre = 0.5 + 0.5 * np.sin((u * 2.0 + v * 3.0) * math.pi * 14.0)
    height = strand * 0.85 + fibre * 0.15
    lum = 0.62 + 0.30 * strand + 0.08 * (fibre - 0.5)
    rgb = np.repeat(np.clip(lum, 0, 1)[..., None], 3, axis=2)
    save(Image.fromarray((rgb * 255).astype(np.uint8), "RGB"), "rec_rope_albedo.png")
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 2.4
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 2.4
    n = np.stack([-dx, dy, np.ones_like(height)], axis=-1)  # OpenGL (+Y up) convention
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    save(Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8), "RGB"), "rec_rope_normal.png")


# ---------------------------------------------------------------------------
# Signs (fictional texts carried over from the previous version)
# ---------------------------------------------------------------------------

def gen_sportheim_sign() -> None:
    w, h = 2048, 256
    img = Image.new("RGB", (w, h), (24, 66, 40))
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, w - 11, h - 11], outline=(238, 228, 196), width=7)
    d.rectangle([24, 24, w - 25, h - 25], outline=(190, 160, 92), width=2)
    for cx in (130, w - 130):  # club crest roundel on both ends
        d.ellipse([cx - 78, h / 2 - 78, cx + 78, h / 2 + 78], fill=(238, 228, 196), outline=(190, 160, 92), width=5)
        d.ellipse([cx - 62, h / 2 - 62, cx + 62, h / 2 + 62], fill=(24, 66, 40))
        centered(d, cx, h / 2 - 48, "TV", font("black", 44), (238, 228, 196))
        centered(d, cx, h / 2 + 6, "1920", font("bold", 34), (232, 196, 98))
    centered(d, w / 2, 26, "OLLI'S SCHLEMMERSTUBE", font("black", 104), (248, 240, 214))
    centered(d, w / 2, 172, "TV 1920 KINDENHEIM  ·  SPORTHEIM", font("bold", 50), (232, 196, 98))
    save(weather(img, 501, dirt=0.08, streaks=0.10), "rec_sportheim_sign_albedo.png")


def gen_scoreboard() -> None:
    w, h = 1024, 512
    img = Image.new("RGB", (w, h), (20, 50, 32))
    d = ImageDraw.Draw(img)
    d.rectangle([8, 8, w - 9, h - 9], outline=(230, 234, 228), width=8)
    d.rectangle([26, 26, w - 27, 128], fill=(28, 74, 44), outline=(216, 222, 212), width=3)
    centered(d, w / 2, 34, "TV 1920 KINDENHEIM", font("black", 60), (244, 242, 230))
    for txt, cx in (("HEIM", 240), ("GAST", 784)):
        centered(d, cx, 146, txt, font("bold", 50), (236, 206, 104))
    # hanging number plates (raised geometry in the model re-uses these texels)
    for bx0, bx1, val in ((115, 365, "2"), (659, 909, "1")):
        d.rounded_rectangle([bx0, 214, bx1, 462], radius=10, fill=(18, 20, 22), outline=(206, 210, 204), width=4)
        d.ellipse([bx0 + 40, 222, bx0 + 56, 238], fill=(120, 124, 120))
        d.ellipse([bx1 - 56, 222, bx1 - 40, 238], fill=(120, 124, 120))
        centered(d, (bx0 + bx1) / 2, 232, val, font("black", 190), (246, 246, 240))
    d.ellipse([494, 288, 530, 324], fill=(244, 242, 230))
    d.ellipse([494, 366, 530, 402], fill=(244, 242, 230))
    centered(d, w / 2, 470, "SPORTPLATZ ANDINGSTRASSE", font("narrow", 26), (170, 190, 170))
    save(weather(img, 502, dirt=0.10, streaks=0.14), "rec_scoreboard_albedo.png")


def gen_spielplatz_sign() -> None:
    w, h = 512, 768
    img = Image.new("RGB", (w, h), (244, 246, 248))
    d = ImageDraw.Draw(img)
    blue = (22, 82, 158)
    d.rounded_rectangle([10, 10, w - 11, h - 11], radius=30, fill=(246, 248, 250), outline=blue, width=16)
    d.rounded_rectangle([26, 26, w - 27, 190], radius=16, fill=blue)
    centered(d, w / 2, 52, "KINDERSPIELPLATZ", font("bold", 44), (255, 255, 255))
    centered(d, w / 2, 114, "Kindenheim", font("bold", 44), (238, 224, 118))
    d.line([(96, 430), (160, 262), (224, 430)], fill=blue, width=13)
    d.line([(160, 262), (286, 262), (322, 430)], fill=blue, width=12)
    d.line([(206, 262), (206, 372)], fill=blue, width=5)
    d.line([(250, 262), (250, 372)], fill=blue, width=5)
    d.rectangle([194, 372, 262, 386], fill=(214, 58, 44))
    d.line([(352, 430), (352, 284), (446, 424)], fill=blue, width=13)
    d.line([(330, 430), (352, 284)], fill=blue, width=9)
    centered(d, w / 2, 470, "Für Kinder 0–14 Jahre", font("bold", 36), (24, 42, 68))
    y = 536
    for line in ("Benutzung auf eigene Gefahr", "Spielzeit 8–20 Uhr", "Hunde bitte draußen lassen"):
        centered(d, w / 2, y, line, font("regular", 27), (60, 70, 86))
        y += 40
    d.line([(60, 668), (w - 60, 668)], fill=blue, width=3)
    centered(d, w / 2, 684, "Ortsgemeinde Kindenheim", font("bold", 30), (82, 92, 108))
    save(weather(img, 503, dirt=0.07, streaks=0.10), "rec_spielplatz_sign_albedo.png")


def gen_decals() -> None:
    """1024 x 1024 atlas, 4 rows of 256 px. UV rects are listed in build_recreation.DECALS."""
    s = 1024
    img = Image.new("RGB", (s, s), (236, 236, 230))
    d = ImageDraw.Draw(img)
    green, cream, gold = (24, 66, 40), (242, 236, 214), (232, 196, 98)

    # row 0: three door plates (each 341 x 256)
    for i, (t1, t2) in enumerate((("UMKLEIDE", "HEIM"), ("UMKLEIDE", "GAST"), ("SCHIEDS-", "RICHTER"))):
        x0 = i * 341
        d.rectangle([x0, 0, x0 + 340, 255], fill=green)
        d.rectangle([x0 + 10, 10, x0 + 330, 245], outline=cream, width=5)
        centered(d, x0 + 170, 48, t1, font("bold", 52), cream)
        centered(d, x0 + 170, 128, t2, font("black", 60), gold)

    # row 1: kiosk price board (chalkboard look), 1024 x 256
    d.rectangle([0, 256, 1023, 511], fill=(34, 40, 38))
    d.rectangle([8, 264, 1015, 503], outline=(150, 112, 70), width=10)
    centered(d, 250, 280, "KIOSK", font("black", 84), (240, 238, 228))
    centered(d, 250, 400, "Speisen & Getränke", font("bold", 40), gold)
    y = 286
    for item, price in (("Rostbratwurst im Brötchen", "3,00"), ("Pfälzer Weinschorle 0,5 l", "3,50"), ("Limo / Wasser", "2,00"), ("Kaffee & Kuchen", "3,00")):
        d.text((500, y), item, fill=(232, 232, 224), font=font("regular", 34))
        d.text((930, y), price, fill=(232, 232, 224), font=font("bold", 34))
        y += 50

    # row 2: notice board sheets (two sheets + a poster), 1024 x 256
    d.rectangle([0, 512, 1023, 767], fill=(120, 96, 66))
    sheets = (
        (20, "SPIELPLAN", ("So 15:00  TV 1920 – Gäste", "Mi 19:00  Training Aktive", "Fr 17:30  Jugend E/F", "Sa 14:00  Alte Herren")),
        (360, "VEREINSNACHRICHTEN", ("Arbeitseinsatz am Platz", "Samstag ab 9 Uhr", "Helfer willkommen!", "Der Vorstand")),
    )
    for x0, title, lines in sheets:
        d.rectangle([x0, 526, x0 + 320, 754], fill=(248, 247, 240))
        centered(d, x0 + 160, 536, title, font("bold", 26), (30, 30, 30))
        d.line([(x0 + 20, 574), (x0 + 300, 574)], fill=(30, 30, 30), width=2)
        yy = 586
        for ln in lines:
            d.text((x0 + 22, yy), ln, fill=(50, 50, 50), font=font("regular", 22))
            yy += 40
    d.rectangle([700, 526, 1004, 754], fill=(236, 206, 104))
    centered(d, 852, 536, "SPORTFEST", font("black", 44), green)
    centered(d, 852, 604, "mit Weinstand", font("bold", 34), (110, 30, 38))
    centered(d, 852, 656, "am Sportplatz", font("bold", 30), green)
    centered(d, 852, 704, "Eintritt frei", font("regular", 28), (40, 40, 40))

    # row 3: house-rules plate + street-number plate
    d.rectangle([0, 768, 511, 1023], fill=(250, 250, 246))
    d.rectangle([8, 776, 503, 1015], outline=(196, 30, 36), width=10)
    centered(d, 256, 800, "Betreten der Sportanlage", font("bold", 34), (30, 30, 30))
    centered(d, 256, 850, "auf eigene Gefahr", font("bold", 34), (30, 30, 30))
    centered(d, 256, 916, "Hunde sind an der Leine zu führen", font("regular", 26), (60, 60, 60))
    centered(d, 256, 958, "TV 1920 Kindenheim e.V.", font("regular", 26), (60, 60, 60))
    d.rectangle([512, 768, 1023, 1023], fill=(22, 82, 158))
    d.rectangle([522, 778, 1013, 1013], outline=(255, 255, 255), width=6)
    centered(d, 768, 800, "Andingstraße", font("bold", 62), (255, 255, 255))
    centered(d, 768, 880, "7", font("black", 96), (255, 255, 255))

    save(weather(img, 504, dirt=0.06, streaks=0.05), "rec_decals_albedo.png")


def gen_bark_mulch() -> None:
    """Size-reduced copies of the CC0 "Wood Chips" set (names are unique to the recreation area)."""
    src = OUT_DIR.parent.parent / "shared_textures" / "_extra_recreation" / "bark_mulch"
    for kind, size, quality, name in (
        ("albedo", 1024, 84, "bark_mulch_albedo_1k.jpg"),
        ("normal", 512, 86, "bark_mulch_normal_512.jpg"),
        ("orm", 512, 84, "bark_mulch_orm_512.jpg"),
    ):
        path = src / f"bark_mulch_{kind}_1k.jpg"
        if not path.exists():
            raise FileNotFoundError(f"bark mulch source texture missing: {path}")
        img = Image.open(path).convert("RGB")
        if img.size != (size, size):
            img = img.resize((size, size), Image.LANCZOS)
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        img.save(OUT_DIR / name, quality=quality, optimize=True)
        print(f"  wrote {name}  {size}x{size}")


def main() -> None:
    print("=== Generating unique recreation textures ===")
    # v1 shipped hand-made noise maps for every material; they are superseded by the shared
    # photo-scanned library, so remove them instead of leaving dead files next to the new ones.
    if OUT_DIR.exists():
        for old in OUT_DIR.iterdir():
            if old.is_file() and not old.name.startswith(("rec_", "bark_mulch_")):
                old.unlink()
    gen_net()
    gen_chain()
    gen_chainlink()
    gen_rope()
    gen_sportheim_sign()
    gen_scoreboard()
    gen_spielplatz_sign()
    gen_decals()
    gen_bark_mulch()


if __name__ == "__main__":
    main()
