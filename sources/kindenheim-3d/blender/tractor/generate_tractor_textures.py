#!/usr/bin/env python3
"""
Procedural PBR Texture Library for the Kindenheim 3D German Pfalz Tractor & Weinlese Grape Trailer.
Generates crisp Albedo, Roughness, Normal, and Metallic maps via NumPy + Pillow:
- Agricultural metallic enamel green paint (subtle micro-flake + light field dust)
- Golden-yellow rim enamel paint
- Ribbed agricultural steel side panels (trailer Bordwaende)
- Heavy rubber tire texture (micro-grain + sidewall ribs)
- Dark cast-iron / chassis powder-coated steel
- Black honeycomb radiator grille mesh
- Illuminated German tractor dashboard instrument cluster (RPM, km/h, fuel, temp, icons)
- Authentic German license plate ("DÜW · KH 2026" — Landkreis Bad Dürkheim / Kindenheim!)
- Red-and-white German agricultural warning stripes (Warnmarkierung DIN 11030)
- Rich deep-purple Palatinate wine-grape harvest mound (Spätburgunder / Dornfelder Trauben + vine leaves)
- Amber Fresnel Rundumleuchte beacon lens
"""

import math
import os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_DIR = Path(__file__).resolve().parent / "textures"


def tileable_noise(size: int, grid: int, seed: int = 0) -> np.ndarray:
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
    ux, uy = u[None, :], u[:, None]
    return (v00 * (1 - ux) + v10 * ux) * (1 - uy) + (v01 * (1 - ux) + v11 * ux) * uy


def fbm(size: int, octaves=(4, 8, 16, 32), seed: int = 1) -> np.ndarray:
    acc = np.zeros((size, size), dtype=np.float32)
    wsum = 0.0
    for i, g in enumerate(octaves):
        w = 0.5 ** i
        acc += w * tileable_noise(size, g, seed + i * 97)
        wsum += w
    return acc / max(wsum, 1e-6)


def height_to_normal(height: np.ndarray, strength: float = 2.0) -> np.ndarray:
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    nx, ny, nz = -dx, dy, np.ones_like(height)
    l = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    rgb = np.stack([(nx / l) * 0.5 + 0.5, (ny / l) * 0.5 + 0.5, (nz / l) * 0.5 + 0.5], axis=-1)
    return np.clip(rgb * 255.0, 0, 255).astype(np.uint8)


def save_pbr(name: str, albedo: np.ndarray, roughness: np.ndarray, normal: np.ndarray,
             metallic: np.ndarray | None = None, aux_size: int = 512):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(albedo, 0, 255).astype(np.uint8), mode="RGB").save(
        OUT_DIR / f"{name}_albedo.jpg", quality=90, optimize=True
    )
    r_img = Image.fromarray(np.clip(roughness * 255.0, 0, 255).astype(np.uint8), mode="L")
    if r_img.width > aux_size:
        r_img = r_img.resize((aux_size, aux_size), Image.Resampling.BILINEAR)
    r_img.save(OUT_DIR / f"{name}_roughness.jpg", quality=85, optimize=True)

    n_img = Image.fromarray(np.clip(normal, 0, 255).astype(np.uint8), mode="RGB")
    if n_img.width > aux_size:
        n_img = n_img.resize((aux_size, aux_size), Image.Resampling.BILINEAR)
    n_img.save(OUT_DIR / f"{name}_normal.png", optimize=True)

    if metallic is not None:
        m_img = Image.fromarray(np.clip(metallic * 255.0, 0, 255).astype(np.uint8), mode="L")
        if m_img.width > aux_size:
            m_img = m_img.resize((aux_size, aux_size), Image.Resampling.BILINEAR)
        m_img.save(OUT_DIR / f"{name}_metallic.jpg", quality=85, optimize=True)


def lerp(c0, c1, t):
    t = np.clip(t, 0.0, 1.0)[..., None]
    return np.array(c0, dtype=np.float32) * (1.0 - t) + np.array(c1, dtype=np.float32) * t


def load_font(px: int):
    for p in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf",
    ]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, px)
            except Exception:
                pass
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# 1. Metallic Enamel Paints (Pfalz Green, Golden Yellow Rim, Cab Roof Silver)
# ---------------------------------------------------------------------------

def gen_enamel_paint(name: str, c_dark, c_bright, metal_val: float, rough_base: float,
                     seed: int, size: int = 512, dust_amt: float = 0.06):
    macro = fbm(size, (4, 8, 16), seed=seed)
    fine = fbm(size, (32, 64, 128), seed=seed + 17)
    albedo = lerp(c_dark, c_bright, 0.45 + 0.35 * macro + 0.20 * fine)
    # Subtle warm agricultural dust specks in micro-crevices
    dust = np.clip((macro - 0.62) * 2.2, 0.0, 1.0) * dust_amt
    albedo = lerp(albedo, (132, 118, 96), dust)
    normal = height_to_normal(0.5 + 0.12 * fine, strength=0.6)
    roughness = np.clip(rough_base + dust * 0.45 + (1.0 - fine) * 0.06, 0.14, 0.72)
    metallic = np.clip(np.full((size, size), metal_val, dtype=np.float32) * (1.0 - dust * 0.8), 0.0, 0.95)
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


# ---------------------------------------------------------------------------
# 2. Ribbed Steel Trailer Panels (Weinlese-Kipper Bordwaende)
# ---------------------------------------------------------------------------

def gen_trailer_steel(name: str, base_rgb, seed: int = 21, size: int = 512):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    # Horizontal pressed stiffening ribs characteristic of German agricultural Kipper drop-sides
    ribs = 0.5 + 0.5 * np.sin(2.0 * math.pi * yy * 7.0)
    ribs = np.power(np.clip(ribs, 0, 1), 1.8)
    n = fbm(size, (8, 16, 32, 64), seed=seed)
    albedo = np.array(base_rgb, dtype=np.float32)[None, None, :] * (0.86 + 0.18 * ribs[..., None]) * (0.92 + 0.16 * n[..., None])
    # Subtle vineyard soil splash near bottom edge
    mud = np.clip((yy - 0.72) * 3.0 * (0.5 + 0.5 * n), 0.0, 0.32)
    albedo = lerp(albedo, (108, 92, 72), mud)
    normal = height_to_normal(0.75 * ribs + 0.15 * n, strength=3.4)
    roughness = np.clip(0.32 + mud * 0.5 + (1.0 - n) * 0.12, 0.22, 0.88)
    metallic = np.clip(0.58 * (1.0 - mud), 0.15, 0.72)
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


# ---------------------------------------------------------------------------
# 3. Heavy Rubber Agricultural Tire + Dark Powder-Coated Chassis Steel
# ---------------------------------------------------------------------------

def gen_rubber_tire(name: str, seed: int = 31, size: int = 512):
    macro = fbm(size, (8, 16, 32), seed=seed)
    fine = fbm(size, (64, 128), seed=seed + 19)
    # Rich dark vulcanized rubber with subtle earthy vineyard dust in grooves
    albedo = lerp((24, 24, 26), (48, 46, 44), macro * 0.55 + fine * 0.45)
    dust = np.clip((macro - 0.54) * 1.6, 0.0, 0.28)
    albedo = lerp(albedo, (94, 84, 70), dust)
    normal = height_to_normal(0.4 * macro + 0.6 * fine, strength=2.2)
    roughness = np.clip(0.76 + dust * 0.18 + (1.0 - fine) * 0.10, 0.66, 0.96)
    save_pbr(name, albedo, roughness, normal)


def gen_chassis_steel(name: str, seed: int = 41, size: int = 512):
    macro = fbm(size, (8, 16, 32), seed=seed)
    fine = fbm(size, (32, 64, 128), seed=seed + 11)
    albedo = lerp((40, 44, 48), (64, 68, 74), macro * 0.6 + fine * 0.4)
    normal = height_to_normal(0.45 * macro + 0.55 * fine, strength=1.6)
    roughness = np.clip(0.44 + (1.0 - fine) * 0.18, 0.30, 0.72)
    metallic = np.full((size, size), 0.72, dtype=np.float32) * (0.88 + 0.16 * fine)
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


def gen_grille_mesh(name: str, size: int = 512):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    # Crisp perforated radiator grille mesh
    hx = np.abs(((xx * 38.0) % 1.0) - 0.5)
    hy = np.abs(((yy * 38.0) % 1.0) - 0.5)
    hole = ((hx < 0.33) & (hy < 0.33)).astype(np.float32)
    albedo = lerp((46, 50, 54), (10, 12, 14), hole)
    height = 1.0 - hole
    normal = height_to_normal(height, strength=4.5)
    roughness = np.clip(0.38 + hole * 0.45, 0.25, 0.90)
    metallic = np.clip(0.75 * (1.0 - hole), 0.0, 0.85)
    save_pbr(name, albedo, roughness, normal, metallic=metallic)


# ---------------------------------------------------------------------------
# 4. Illuminated German Tractor Dashboard Instrument Cluster (1st-person POV!)
# ---------------------------------------------------------------------------

def gen_dashboard(name: str, size: int = 1024):
    img = Image.new("RGB", (size, size // 2), (24, 27, 31))
    draw = ImageDraw.Draw(img)
    w, h = img.size

    # Recessed carbon-matte instrument bezel
    draw.rounded_rectangle([24, 20, w - 24, h - 20], radius=34, fill=(18, 21, 25), outline=(66, 72, 78), width=6)

    # Left Dial: Tachometer (U/min x100) + Right Dial: Speedometer (km/h)
    def draw_dial(cx, cy, r, max_val, step_val, label, needle_frac, red_start=0.78):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(12, 16, 20), outline=(140, 148, 156), width=5)
        draw.ellipse([cx - r + 10, cy - r + 10, cx + r - 10, cy + r - 10], outline=(46, 54, 62), width=2)
        n_ticks = int(max_val // step_val)
        for i in range(n_ticks + 1):
            frac = i / n_ticks
            ang = math.radians(135 + frac * 270)
            col = (232, 62, 48) if frac >= red_start else (235, 240, 244)
            x0, y0 = cx + math.cos(ang) * (r - 28), cy + math.sin(ang) * (r - 28)
            x1, y1 = cx + math.cos(ang) * (r - 12), cy + math.sin(ang) * (r - 12)
            draw.line([x0, y0, x1, y1], fill=col, width=4)
        # Glowing orange/red needle
        n_ang = math.radians(135 + needle_frac * 270)
        draw.line([cx, cy, cx + math.cos(n_ang) * (r - 32), cy + math.sin(n_ang) * (r - 32)],
                  fill=(250, 96, 36), width=6)
        draw.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=(210, 215, 220))
        fnt = load_font(22)
        bb = draw.textbbox((0, 0), label, font=fnt)
        draw.text((cx - (bb[2] - bb[0]) // 2, cy + r // 2 - 12), label, fill=(175, 205, 185), font=fnt)

    draw_dial(int(w * 0.24), int(h * 0.52), 145, 30, 5, "U/min", 0.36, red_start=0.76)
    draw_dial(int(w * 0.76), int(h * 0.52), 145, 50, 10, "km/h", 0.24, red_start=0.88)

    # Center glowing LCD multifunction display (Vario / Pfalz Agri terminal!)
    draw.rounded_rectangle([int(w * 0.41), int(h * 0.20), int(w * 0.59), int(h * 0.78)],
                           radius=14, fill=(14, 42, 34), outline=(72, 138, 104), width=4)
    f_big = load_font(34)
    f_sm = load_font(20)
    draw.text((int(w * 0.435), int(h * 0.26)), "PFALZ", fill=(116, 236, 152), font=f_big)
    draw.text((int(w * 0.432), int(h * 0.44)), "DIESEL OK", fill=(165, 240, 186), font=f_sm)
    draw.text((int(w * 0.438), int(h * 0.58)), "4WD  AUTO", fill=(244, 206, 84), font=f_sm)
    # Indicator warning LEDs along top
    for i, col in enumerate([(52, 224, 92), (52, 224, 92), (248, 186, 40), (62, 156, 246), (235, 64, 52)]):
        ix = int(w * 0.425 + i * 36)
        draw.ellipse([ix, int(h * 0.10), ix + 16, int(h * 0.10) + 16], fill=col)

    # Pad to square 1024x1024 (centered strip) or keep crisp 1024x512!
    arr = np.array(img, dtype=np.float32)
    rough = np.full((h, w), 0.34, dtype=np.float32)
    norm = np.full((h, w, 3), [128, 128, 255], dtype=np.uint8)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr.astype(np.uint8)).save(OUT_DIR / f"{name}_albedo.jpg", quality=92)
    Image.fromarray((rough * 255).astype(np.uint8), mode="L").save(OUT_DIR / f"{name}_roughness.jpg", quality=85)
    Image.fromarray(norm).save(OUT_DIR / f"{name}_normal.png")


# ---------------------------------------------------------------------------
# 5. Authentic German License Plate ("DÜW · KH 2026" — Bad Dürkheim / Kindenheim)
# ---------------------------------------------------------------------------

def gen_license_plate(name: str, text: str = "DÜW  KH 26"):
    w, h = 512, 128
    img = Image.new("RGB", (w, h), (242, 244, 246))
    draw = ImageDraw.Draw(img)
    # Outer black stamped border
    draw.rounded_rectangle([3, 3, w - 4, h - 4], radius=12, outline=(22, 24, 28), width=6)
    # Left EU Euroband blue strip + "D"
    draw.rectangle([8, 8, 62, h - 8], fill=(22, 62, 148))
    f_eu = load_font(34)
    draw.text((22, 72), "D", fill=(244, 246, 250), font=f_eu)
    # Yellow EU stars ring
    for i in range(10):
        a = 2 * math.pi * i / 10
        sx, sy = 35 + int(15 * math.cos(a)), 38 + int(15 * math.sin(a))
        draw.ellipse([sx - 2, sy - 2, sx + 2, sy + 2], fill=(245, 206, 42))
    # Bold German FE-Schrift-style plate lettering
    f_main = load_font(68)
    draw.text((80, 26), text, fill=(18, 20, 24), font=f_main)
    # RLP state seal + TÜV badge between district & letters
    draw.ellipse([226, 24, 248, 46], fill=(214, 168, 42), outline=(80, 70, 40), width=2)
    draw.ellipse([225, 62, 249, 86], fill=(198, 48, 42), outline=(40, 40, 40), width=2)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img.save(OUT_DIR / f"{name}_albedo.jpg", quality=92)
    Image.new("L", (w, h), 85).save(OUT_DIR / f"{name}_roughness.jpg", quality=85)
    Image.new("RGB", (w, h), (128, 128, 255)).save(OUT_DIR / f"{name}_normal.png")


# ---------------------------------------------------------------------------
# 6. German Agricultural Trailer Warning Stripes (DIN 11030 Red/White Chevrons)
# ---------------------------------------------------------------------------

def gen_warning_stripes(name: str, size: int = 256):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    stripe = (((xx * 6.0 + yy * 2.0) % 1.0) < 0.5).astype(np.float32)
    albedo = lerp((235, 235, 232), (206, 36, 32), stripe)
    rough = np.full((size, size), 0.28, dtype=np.float32)
    norm = np.full((size, size, 3), [128, 128, 255], dtype=np.uint8)
    save_pbr(name, albedo, rough, norm, aux_size=256)


# ---------------------------------------------------------------------------
# 7. Rich Palatinate Wine-Grape Harvest Load (Deep Purple Spätburgunder Trauben + Leaves!)
# ---------------------------------------------------------------------------

def gen_grape_load(name: str, seed: int = 77, size: int = 1024):
    """Densely packed glossy deep-purple Palatinate wine grapes with silvery bloom & scattered green vine leaves."""
    rng = np.random.default_rng(seed)
    img = Image.new("RGB", (size, size), (28, 18, 36))
    h_img = Image.new("L", (size, size), 35)
    r_img = Image.new("L", (size, size), 145)

    draw = ImageDraw.Draw(img)
    hdraw = ImageDraw.Draw(h_img)
    rdraw = ImageDraw.Draw(r_img)

    # First layer: dark woody grape stems & crushed shadow cavity
    for _ in range(180):
        x0, y0 = rng.integers(0, size), rng.integers(0, size)
        x1, y1 = x0 + rng.integers(-65, 65), y0 + rng.integers(-65, 65)
        draw.line([x0, y0, x1, y1], fill=(54, 68, 34), width=5)

    # Second layer: ~2,600 overlapping plump wine-grape berries (with seamless toroidal wrap!)
    berry_palette = [
        (56, 32, 78),
        (44, 24, 64),
        (72, 42, 92),
        (38, 26, 58),
        (64, 38, 86),
        (82, 54, 102),  # silvery dusty grape bloom!
    ]
    for _ in range(2600):
        cx = int(rng.integers(0, size))
        cy = int(rng.integers(0, size))
        rad = int(rng.integers(10, 18))
        base = berry_palette[rng.integers(0, len(berry_palette))]
        hi = tuple(min(255, c + 48) for c in base)
        lo = tuple(max(0, c - 24) for c in base)
        for ox in (-size, 0, size):
            for oy in (-size, 0, size):
                px, py = cx + ox, cy + oy
                if -rad <= px <= size + rad and -rad <= py <= size + rad:
                    draw.ellipse([px - rad, py - rad, px + rad, py + rad], fill=base, outline=lo, width=2)
                    # Glossy powdery grape highlight off-center
                    hr = max(3, rad // 3)
                    draw.ellipse([px - rad // 2, py - rad // 2, px - rad // 2 + hr * 2, py - rad // 2 + hr * 2], fill=hi)
                    hdraw.ellipse([px - rad, py - rad, px + rad, py + rad], fill=185)
                    hdraw.ellipse([px - rad // 2, py - rad // 2, px + rad // 2, py + rad // 2], fill=245)
                    rdraw.ellipse([px - rad, py - rad, px + rad, py + rad], fill=72)

    # Third layer: occasional fresh green/golden-autumn Palatinate grapevine leaves tucked into the load!
    for _ in range(28):
        cx, cy = int(rng.integers(0, size)), int(rng.integers(0, size))
        ang = rng.uniform(0, 2 * math.pi)
        rad = rng.uniform(26, 44)
        lcol = (68, 108, 44) if rng.random() > 0.25 else (142, 134, 48)
        pts = []
        for k in range(7):
            a = ang + k * (2 * math.pi / 7)
            rr = rad * (1.0 if k % 2 == 0 else 0.58)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        draw.polygon(pts, fill=lcol, outline=(42, 66, 28))
        hdraw.polygon(pts, fill=215)
        rdraw.polygon(pts, fill=140)

    albedo = np.array(img, dtype=np.float32)
    h_arr = np.array(h_img.filter(ImageFilter.GaussianBlur(2.0)), dtype=np.float32) / 255.0
    rough = np.array(r_img, dtype=np.float32) / 255.0
    normal = height_to_normal(h_arr, strength=5.5)
    save_pbr(name, albedo, rough, normal, aux_size=512)


# ---------------------------------------------------------------------------
# 8. Amber Fresnel Rundumleuchte Beacon Lens
# ---------------------------------------------------------------------------

def gen_beacon_amber(name: str, size: int = 256):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    flutes = 0.5 + 0.5 * np.sin(2.0 * math.pi * xx * 24.0)
    rings = 0.5 + 0.5 * np.sin(2.0 * math.pi * yy * 14.0)
    albedo = lerp((218, 96, 8), (255, 168, 24), 0.4 + 0.4 * flutes + 0.2 * rings)
    normal = height_to_normal(0.65 * flutes + 0.35 * rings, strength=4.2)
    rough = np.full((size, size), 0.14, dtype=np.float32)
    save_pbr(name, albedo, rough, normal, aux_size=256)


def main():
    print(f"Generating Tractor & Weinlese Trailer PBR textures in {OUT_DIR} ...")
    # Classic German Fendt/Deere-inspired Pfalz agricultural enamel green & golden-yellow rims!
    gen_enamel_paint("tractor_green", (32, 98, 34), (56, 146, 52), metal_val=0.38, rough_base=0.22, seed=11)
    gen_enamel_paint("tractor_yellow_rim", (212, 158, 18), (242, 194, 42), metal_val=0.42, rough_base=0.24, seed=12)
    gen_enamel_paint("tractor_roof_silver", (196, 202, 204), (224, 230, 232), metal_val=0.35, rough_base=0.26, seed=13)
    gen_enamel_paint("tractor_chrome", (200, 206, 212), (236, 240, 244), metal_val=0.92, rough_base=0.14, seed=14, dust_amt=0.01)
    gen_enamel_paint("trailer_red_chassis", (142, 32, 28), (178, 44, 38), metal_val=0.45, rough_base=0.32, seed=15, dust_amt=0.10)
    gen_trailer_steel("trailer_green_panel", (44, 118, 46), seed=21)
    gen_rubber_tire("tractor_tire_rubber", seed=31)
    gen_chassis_steel("tractor_chassis_steel", seed=41)
    gen_grille_mesh("tractor_grille_mesh")
    gen_dashboard("tractor_dashboard", size=1024)
    gen_license_plate("plate_tractor", "DÜW  KH 26")
    gen_license_plate("plate_trailer", "DÜW  WL 26")
    gen_warning_stripes("trailer_warning")
    gen_grape_load("trailer_grapes", seed=77, size=1024)
    gen_beacon_amber("beacon_amber")

    files = sorted(OUT_DIR.glob("*"))
    total_mb = sum(f.stat().st_size for f in files) / (1024 * 1024)
    print(f"Done! Generated {len(files)} vehicle PBR texture files ({total_mb:.2f} MB).")


if __name__ == "__main__":
    main()
