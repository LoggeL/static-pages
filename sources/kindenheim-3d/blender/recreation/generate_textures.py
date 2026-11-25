#!/usr/bin/env python3
"""
Procedural PBR Texture Library for Kindenheim Recreation Areas
(Fußballplatz / Sportplatz Andingstraße 7 & Kinderspielplatz Kindenheim).

Generates seamless PBR Albedo (RGB), Roughness (L), Normal (RGB), and Metallic (L)
maps into blender/recreation/textures/ using NumPy + Pillow.
"""

import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent / "textures"


# ---------------------------------------------------------------------------
# Tileable Noise & PBR Helpers
# ---------------------------------------------------------------------------

def tileable_value_noise(size: int, grid: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = rng.random((grid, grid), dtype=np.float32)
    coords = np.linspace(0, grid, size, endpoint=False, dtype=np.float32)
    ix = np.floor(coords).astype(np.int32) % grid
    fx = coords - np.floor(coords)
    u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0)
    ix1 = (ix + 1) % grid

    v00 = base[np.ix_(ix, ix)]
    v10 = base[np.ix_(ix, ix1)]
    v01 = base[np.ix_(ix1, ix)]
    v11 = base[np.ix_(ix1, ix1)]

    ux = u[None, :]
    uy = u[:, None]
    nx0 = v00 * (1.0 - ux) + v10 * ux
    nx1 = v01 * (1.0 - ux) + v11 * ux
    return nx0 * (1.0 - uy) + nx1 * uy


def fbm(size: int, octaves=(4, 8, 16, 32, 64), weights=None, seed: int = 42) -> np.ndarray:
    if weights is None:
        weights = [0.5 ** i for i in range(len(octaves))]
    acc = np.zeros((size, size), dtype=np.float32)
    wsum = 0.0
    for i, (g, w) in enumerate(zip(octaves, weights)):
        acc += w * tileable_value_noise(size, g, seed + i * 137)
        wsum += w
    acc /= max(wsum, 1e-6)
    return acc


def height_to_normal(height: np.ndarray, strength: float = 2.0) -> np.ndarray:
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    nx = -dx
    ny = dy
    nz = np.ones_like(height)
    length = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    nx /= length
    ny /= length
    nz /= length
    rgb = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5)], axis=-1)
    return np.clip(rgb * 255.0, 0, 255).astype(np.uint8)


def lerp_color(c0, c1, t):
    t = np.clip(t, 0.0, 1.0)[..., None]
    return np.array(c0, dtype=np.float32) * (1.0 - t) + np.array(c1, dtype=np.float32) * t


def save_pbr(
    name: str,
    albedo: np.ndarray,
    roughness: np.ndarray,
    normal: np.ndarray,
    metallic: np.ndarray | None = None,
    normal_size: int = 512,
    rough_size: int = 512,
):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(albedo, 0, 255).astype(np.uint8), mode="RGB").save(
        OUT_DIR / f"{name}_albedo.jpg", quality=88, optimize=True
    )
    r_img = Image.fromarray(np.clip(roughness * 255.0, 0, 255).astype(np.uint8), mode="L")
    if r_img.width > rough_size or r_img.height > rough_size:
        r_img = r_img.resize(
            (min(r_img.width, rough_size), min(r_img.height, rough_size)),
            Image.Resampling.BILINEAR,
        )
    r_img.save(OUT_DIR / f"{name}_roughness.jpg", quality=84, optimize=True)

    n_img = Image.fromarray(np.clip(normal, 0, 255).astype(np.uint8), mode="RGB")
    if n_img.width > normal_size or n_img.height > normal_size:
        n_img = n_img.resize(
            (min(n_img.width, normal_size), min(n_img.height, normal_size)),
            Image.Resampling.BILINEAR,
        )
    n_img.save(OUT_DIR / f"{name}_normal.png", optimize=True)

    if metallic is not None:
        m_img = Image.fromarray(np.clip(metallic * 255.0, 0, 255).astype(np.uint8), mode="L")
        if m_img.width > rough_size or m_img.height > rough_size:
            m_img = m_img.resize(
                (min(m_img.width, rough_size), min(m_img.height, rough_size)),
                Image.Resampling.BILINEAR,
            )
        m_img.save(OUT_DIR / f"{name}_metallic.jpg", quality=84, optimize=True)


def load_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf",
            "/System/Library/Fonts/HelveticaNeue.ttc",
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial Bold.ttf",
        ]
        if bold
        else [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/HelveticaNeue.ttc",
        ]
    )
    for fp in candidates:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# 1. Robinia / Larch Natural Playground Wood
# ---------------------------------------------------------------------------

def gen_robinia_wood(size: int = 512):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    warp = fbm(size, (4, 8, 16), [0.55, 0.3, 0.15], seed=101)
    fine_grain = fbm(size, (32, 64, 128), [0.5, 0.35, 0.15], seed=107)
    ring_phase = (xx * 9.0 + warp * 2.4) * 2.0 * math.pi
    rings = 0.5 + 0.5 * np.sin(ring_phase)
    streak = 0.5 + 0.5 * np.sin((xx * 38.0 + fine_grain * 3.0) * 2.0 * math.pi)

    # Subtle wood knots
    knot = np.exp(-(((xx - 0.32) * 8.0) ** 2 + ((yy - 0.45) * 4.5) ** 2))
    knot += np.exp(-(((xx - 0.74) * 9.0) ** 2 + ((yy - 0.78) * 5.0) ** 2)) * 0.85

    t = np.clip(rings * 0.48 + streak * 0.25 + fine_grain * 0.27, 0.0, 1.0)
    col = lerp_color((148, 102, 58), (206, 158, 98), t)
    col = lerp_color(col, (96, 62, 34), np.clip(knot * 0.75, 0.0, 0.8))

    height = 0.45 * rings + 0.35 * fine_grain + 0.20 * streak - knot * 0.25
    normal = height_to_normal(height, strength=2.4)
    roughness = np.clip(0.72 + (1.0 - rings) * 0.12 + knot * 0.08, 0.62, 0.90)
    save_pbr("robinia_wood", col, roughness, normal)


# ---------------------------------------------------------------------------
# 2. Cedar Timber Shingles (Kletterturm Roof)
# ---------------------------------------------------------------------------

def gen_timber_shingle(size: int = 512):
    rng = np.random.default_rng(202)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    rows = 8
    cols = 10
    rf = yy * rows
    ri = np.floor(rf).astype(np.int32) % rows
    r_frac = rf - np.floor(rf)
    cf = (xx * cols + (ri % 2) * 0.5) % cols
    ci = np.floor(cf).astype(np.int32) % cols
    c_frac = cf - np.floor(cf)

    tile_shade = rng.uniform(-16, 16, size=(rows, cols, 3)).astype(np.float32)
    grain = fbm(size, (16, 48, 96), [0.5, 0.3, 0.2], seed=209)
    base = np.array((156, 104, 62), dtype=np.float32) + tile_shade[ri, ci]
    col = base * (0.86 + 0.26 * grain[..., None])

    seam_x = np.minimum(c_frac, 1.0 - c_frac) < 0.045
    seam_y = r_frac < 0.06
    seam = seam_x | seam_y
    col[seam] *= 0.55

    height = r_frac * 0.65 + grain * 0.25 - seam.astype(np.float32) * 0.35
    normal = height_to_normal(height, strength=2.8)
    roughness = np.clip(0.76 + (1.0 - grain) * 0.14, 0.65, 0.94)
    save_pbr("timber_shingle", col, roughness, normal)


# ---------------------------------------------------------------------------
# 3. Satin Child-Friendly Playground Enamel Paints
# ---------------------------------------------------------------------------

def gen_enamel_paint(name: str, base_rgb: tuple[int, int, int], seed: int, size: int = 256):
    grain = fbm(size, (16, 32, 64), [0.5, 0.3, 0.2], seed=seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    brush = 0.5 + 0.5 * np.sin((xx * 24.0 + grain * 1.4) * 2.0 * math.pi)

    c_dark = tuple(max(12, int(c * 0.86)) for c in base_rgb)
    c_light = tuple(min(250, int(c * 1.06)) for c in base_rgb)
    col = lerp_color(c_dark, c_light, np.clip(grain * 0.72 + brush * 0.28, 0.0, 1.0))

    height = 0.6 * grain + 0.4 * brush
    normal = height_to_normal(height, strength=0.75)
    roughness = np.clip(0.36 + (1.0 - grain) * 0.14, 0.28, 0.56)
    save_pbr(name, col, roughness, normal, normal_size=256, rough_size=256)


# ---------------------------------------------------------------------------
# 4. Galvanized Steel & Brushed Stainless Steel
# ---------------------------------------------------------------------------

def gen_galvanized_steel(size: int = 512):
    spangle1 = tileable_value_noise(size, 24, seed=301)
    spangle2 = tileable_value_noise(size, 48, seed=305)
    fine = fbm(size, (32, 64, 128), [0.5, 0.3, 0.2], seed=309)
    spangle = np.abs(spangle1 - spangle2) * 1.4 + fine * 0.45

    col = lerp_color((168, 174, 180), (212, 218, 224), np.clip(spangle, 0.0, 1.0))
    normal = height_to_normal(spangle, strength=1.1)
    roughness = np.clip(0.34 + (1.0 - spangle) * 0.22, 0.26, 0.58)
    metallic = np.full((size, size), 0.82, dtype=np.float32)
    save_pbr("galvanized_steel", col, roughness, normal, metallic=metallic)


def gen_stainless_brushed(size: int = 512):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    n = fbm(size, (16, 64, 128), [0.3, 0.4, 0.3], seed=401)
    streak = tileable_value_noise(size, 128, seed=407)
    # Fine longitudinal brushed polish lines along Y
    brush = 0.5 + 0.5 * np.sin((xx * 96.0 + n * 2.0) * 2.0 * math.pi)
    t = np.clip(brush * 0.5 + streak * 0.3 + n * 0.2, 0.0, 1.0)

    col = lerp_color((206, 212, 218), (236, 240, 244), t)
    normal = height_to_normal(brush * 0.35 + streak * 0.25, strength=0.45)
    roughness = np.clip(0.15 + (1.0 - t) * 0.09, 0.12, 0.26)
    metallic = np.full((size, size), 0.92, dtype=np.float32)
    save_pbr("stainless_brushed", col, roughness, normal, metallic=metallic)


# ---------------------------------------------------------------------------
# 5. Vulcanized Black Rubber (Swing Seats & Seesaw Tires)
# ---------------------------------------------------------------------------

def gen_rubber_black(size: int = 256):
    fine = fbm(size, (32, 64, 128), [0.5, 0.35, 0.15], seed=501)
    col = lerp_color((28, 30, 32), (48, 50, 54), fine)
    normal = height_to_normal(fine, strength=1.5)
    roughness = np.clip(0.76 + (1.0 - fine) * 0.14, 0.68, 0.92)
    save_pbr("rubber_black", col, roughness, normal, normal_size=256, rough_size=256)


# ---------------------------------------------------------------------------
# 6. Braided Climbing Rope (Space-Net & Nest Swing)
# ---------------------------------------------------------------------------

def gen_rope(name: str, base_rgb: tuple[int, int, int], seed: int, size: int = 256):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    strand1 = 0.5 + 0.5 * np.sin((xx * 10.0 + yy * 10.0) * 2.0 * math.pi)
    strand2 = 0.5 + 0.5 * np.sin((xx * 10.0 - yy * 10.0) * 2.0 * math.pi)
    braid = strand1 * 0.5 + strand2 * 0.5
    fine = fbm(size, (16, 32), [0.6, 0.4], seed=seed)

    c_dark = tuple(max(10, int(c * 0.62)) for c in base_rgb)
    c_bright = tuple(min(248, int(c * 1.12)) for c in base_rgb)
    col = lerp_color(c_dark, c_bright, np.clip(braid * 0.78 + fine * 0.22, 0.0, 1.0))

    normal = height_to_normal(braid * 0.8 + fine * 0.2, strength=3.4)
    roughness = np.clip(0.78 + (1.0 - braid) * 0.14, 0.68, 0.94)
    save_pbr(name, col, roughness, normal, normal_size=256, rough_size=256)


# ---------------------------------------------------------------------------
# 7. Cast Whitewashed Concrete Terrace (Stehtraversen)
# ---------------------------------------------------------------------------

def gen_concrete_terrace(size: int = 512):
    macro = fbm(size, (4, 8, 16), [0.55, 0.3, 0.15], seed=601)
    fine = fbm(size, (32, 64, 128), [0.45, 0.35, 0.2], seed=607)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    joint = (np.abs(xx - 0.5) < 0.008) | (np.abs(yy - 0.5) < 0.008)

    col = lerp_color((206, 204, 198), (234, 232, 226), np.clip(macro * 0.65 + fine * 0.35, 0.0, 1.0))
    col[joint] *= 0.78

    height = 0.45 * macro + 0.55 * fine - joint.astype(np.float32) * 0.25
    normal = height_to_normal(height, strength=1.8)
    roughness = np.clip(0.84 + (1.0 - fine) * 0.10, 0.74, 0.96)
    save_pbr("concrete_terrace", col, roughness, normal)


# ---------------------------------------------------------------------------
# 8. Sportheim Sign: "OLLI'S SCHLEMMERSTUBE · TV 1920 KINDENHEIM"
# ---------------------------------------------------------------------------

def gen_sportheim_sign():
    w, h = 1024, 256
    img = Image.new("RGB", (w, h), (22, 64, 38))
    draw = ImageDraw.Draw(img)

    # Cream border trim + subtle inner bevel
    draw.rectangle([8, 8, w - 9, h - 9], outline=(240, 230, 196), width=6)
    draw.rectangle([18, 18, w - 19, h - 19], outline=(196, 164, 92), width=2)

    font_big = load_font(62, bold=True)
    font_sub = load_font(34, bold=True)

    title = "OLLI'S SCHLEMMERSTUBE"
    sub = "TV 1920 KINDENHEIM  ·  SPORTHEIM"

    tb = draw.textbbox((0, 0), title, font=font_big)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    draw.text(((w - tw) / 2, 46), title, fill=(248, 240, 214), font=font_big)

    sb = draw.textbbox((0, 0), sub, font=font_sub)
    sw, sh = sb[2] - sb[0], sb[3] - sb[1]
    draw.text(((w - sw) / 2, 150), sub, fill=(232, 196, 98), font=font_sub)

    albedo = np.array(img, dtype=np.float32)
    rough = np.full((h, w), 0.42, dtype=np.float32)
    normal = np.zeros((h, w, 3), dtype=np.uint8)
    normal[..., 0] = 128
    normal[..., 1] = 128
    normal[..., 2] = 255
    save_pbr("sportheim_sign", albedo, rough, normal, normal_size=512, rough_size=512)


# ---------------------------------------------------------------------------
# 9. Village Scoreboard Face ("TV 1920 KINDENHEIM · HEIM 2 : 1 GAST")
# ---------------------------------------------------------------------------

def gen_scoreboard_face():
    w, h = 1024, 512
    img = Image.new("RGB", (w, h), (20, 48, 30))
    draw = ImageDraw.Draw(img)

    # Outer white steel frame border
    draw.rectangle([10, 10, w - 11, h - 11], outline=(232, 236, 230), width=8)
    draw.rectangle([26, 26, w - 27, 132], fill=(28, 72, 42), outline=(218, 224, 214), width=3)

    f_header = load_font(54, bold=True)
    f_label = load_font(44, bold=True)
    f_score = load_font(176, bold=True)

    header = "TV 1920 KINDENHEIM"
    hb = draw.textbbox((0, 0), header, font=f_header)
    draw.text(((w - (hb[2] - hb[0])) / 2, 44), header, fill=(244, 242, 230), font=f_header)

    # Team labels
    for txt, cx in [("HEIM", 240), ("GAST", 784)]:
        tb = draw.textbbox((0, 0), txt, font=f_label)
        draw.text((cx - (tb[2] - tb[0]) / 2, 152), txt, fill=(236, 206, 104), font=f_label)

    # Flip-number black tiles
    for bx0, bx1, val in [(115, 365, "2"), (659, 909, "1")]:
        draw.rounded_rectangle([bx0, 216, bx1, 456], radius=16, fill=(18, 20, 22), outline=(215, 220, 214), width=4)
        draw.line([(bx0 + 6, 336), (bx1 - 6, 336)], fill=(46, 48, 52), width=3)
        sb = draw.textbbox((0, 0), val, font=f_score)
        draw.text(
            ((bx0 + bx1) / 2 - (sb[2] - sb[0]) / 2, 234),
            val,
            fill=(248, 248, 242),
            font=f_score,
        )

    # Center colon
    draw.ellipse([496, 290, 528, 322], fill=(244, 242, 230))
    draw.ellipse([496, 364, 528, 396], fill=(244, 242, 230))

    albedo = np.array(img, dtype=np.float32)
    rough = np.full((h, w), 0.46, dtype=np.float32)
    normal = np.zeros((h, w, 3), dtype=np.uint8)
    normal[..., 0] = 128
    normal[..., 1] = 128
    normal[..., 2] = 255
    save_pbr("scoreboard_face", albedo, rough, normal, normal_size=512, rough_size=512)


# ---------------------------------------------------------------------------
# 10. Municipal German Playground Sign ("Kinderspielplatz Kindenheim")
# ---------------------------------------------------------------------------

def gen_spielplatz_sign():
    size = 512
    img = Image.new("RGB", (size, size), (242, 244, 246))
    draw = ImageDraw.Draw(img)

    # Classic German municipal blue border & header
    draw.rounded_rectangle([12, 12, size - 13, size - 13], radius=24, fill=(246, 248, 250), outline=(22, 82, 158), width=16)
    draw.rectangle([28, 28, size - 29, 158], fill=(22, 82, 158))

    f_title = load_font(44, bold=True)
    f_sub = load_font(34, bold=True)
    f_body = load_font(28, bold=False)

    t1 = "KINDERSPIELPLATZ"
    t2 = "Kindenheim"
    b1 = draw.textbbox((0, 0), t1, font=f_title)
    draw.text(((size - (b1[2] - b1[0])) / 2, 42), t1, fill=(255, 255, 255), font=f_title)
    b2 = draw.textbbox((0, 0), t2, font=f_sub)
    draw.text(((size - (b2[2] - b2[0])) / 2, 100), t2, fill=(238, 224, 118), font=f_sub)

    # Stylized swing & slide pictogram in blue
    pic_col = (22, 82, 158)
    # Swing A-frame
    draw.line([(96, 332), (160, 198), (224, 332)], fill=pic_col, width=11)
    draw.line([(160, 198), (274, 198), (308, 332)], fill=pic_col, width=10)
    draw.line([(204, 198), (204, 286)], fill=pic_col, width=5)
    draw.line([(244, 198), (244, 286)], fill=pic_col, width=5)
    draw.rectangle([194, 286, 254, 298], fill=(214, 58, 44))
    # Slide icon on right
    draw.line([(332, 332), (332, 214), (424, 326)], fill=pic_col, width=11)
    draw.line([(312, 332), (332, 214)], fill=pic_col, width=8)

    t3 = "Für Kinder 0–14 Jahre"
    b3 = draw.textbbox((0, 0), t3, font=f_sub)
    draw.text(((size - (b3[2] - b3[0])) / 2, 376), t3, fill=(24, 42, 68), font=f_sub)

    t4 = "Ortsgemeinde Kindenheim"
    b4 = draw.textbbox((0, 0), t4, font=f_body)
    draw.text(((size - (b4[2] - b4[0])) / 2, 434), t4, fill=(82, 92, 108), font=f_body)

    albedo = np.array(img, dtype=np.float32)
    rough = np.full((size, size), 0.34, dtype=np.float32)
    normal = np.zeros((size, size, 3), dtype=np.uint8)
    normal[..., 0] = 128
    normal[..., 1] = 128
    normal[..., 2] = 255
    save_pbr("spielplatz_sign", albedo, rough, normal, normal_size=256, rough_size=256)


# ---------------------------------------------------------------------------
# 11. Outdoor Concrete Table Tennis Top (Beton-Tischtennisplatte)
# ---------------------------------------------------------------------------

def gen_tischtennis_top():
    w, h = 1024, 512
    fine = fbm(w, (32, 64, 128), [0.5, 0.3, 0.2], seed=701)[:h, :]
    col = lerp_color((118, 128, 124), (138, 148, 144), fine)
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(img)

    # Crisp white regulation outer court lines + center line
    draw.rectangle([16, 16, w - 17, h - 17], outline=(244, 246, 244), width=12)
    draw.line([(16, h // 2), (w - 17, h // 2)], fill=(244, 246, 244), width=8)
    draw.line([(w // 2, 16), (w // 2, h - 17)], fill=(215, 220, 218), width=5)

    albedo = np.array(img, dtype=np.float32)
    rough = np.full((h, w), 0.56, dtype=np.float32)
    normal = height_to_normal(fine, strength=0.6)
    save_pbr("tischtennis_top", albedo, rough, normal, normal_size=512, rough_size=512)


def main():
    print(f"Generating recreation PBR textures into {OUT_DIR} ...")
    gen_robinia_wood()
    gen_timber_shingle()
    gen_enamel_paint("paint_red", (202, 46, 42), seed=801)
    gen_enamel_paint("paint_blue", (38, 108, 186), seed=802)
    gen_enamel_paint("paint_yellow", (232, 178, 34), seed=803)
    gen_enamel_paint("paint_green", (46, 134, 68), seed=804)
    gen_galvanized_steel()
    gen_stainless_brushed()
    gen_rubber_black()
    gen_rope("rope_red", (198, 44, 42), seed=805)
    gen_rope("rope_blue", (38, 102, 178), seed=806)
    gen_concrete_terrace()
    gen_sportheim_sign()
    gen_scoreboard_face()
    gen_spielplatz_sign()
    gen_tischtennis_top()
    print(f"Generated {len(list(OUT_DIR.glob('*_albedo.jpg')))} texture sets.")


if __name__ == "__main__":
    main()
