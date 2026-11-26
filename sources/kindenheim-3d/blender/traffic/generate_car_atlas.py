#!/usr/bin/env python3
"""
NPC traffic: one shared texture atlas for every car type (system python3 + numpy + Pillow, no Blender).

Writes into blender/traffic/textures/ and public/assets/models/traffic/:
  traffic_car_albedo.webp      2048 px sRGB   (paint swatch is white: the runtime tints it per car)
  traffic_car_albedo_1k.webp   1024 px        (low / medium quality)
  traffic_car_normal.webp      1024 px        OpenGL (+Y) tangent-space normal
  traffic_car_orm.webp         1024 px        R = AO, G = roughness, B = metalness (glTF packing)
  traffic_car_mask.png         1024 px RGBA   R = tail/brake lamp, G = head lamp, B = indicator, A = paint tint amount
  atlas_layout.json            swatch rectangles in IMAGE space (u right, v DOWN from the top row), consumed by
                               build_cars.py (UVs) and src/traffic.ts (plate block, via the manifest)

Layout convention: (u0, v0, u1, v1) with v measured from the top of the image. glTF uses the same convention
(Blender UVs are written as (u, 1 - v)), and the runtime loads these textures with flipY = false.

Plates are fictional "DUW-xx nnn" combinations of the Landkreis Bad Duerkheim; no brands anywhere.
"""

import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
TEX_OUT = HERE / "textures"
PUBLIC_OUT = PROJECT / "public" / "assets" / "models" / "traffic"
LIB = PROJECT / "blender" / "shared_textures"

S = 2048  # albedo size; the other maps are rendered at S and downsampled to 1024

rng = np.random.default_rng(20261126)
random.seed(20261126)

# ---------------------------------------------------------------------------------------------- layout
L = {
    # row A
    "paint": (0.0, 0.0, 0.5, 0.25),
    "glass": (0.5, 0.0, 0.75, 0.125),
    "plastic": (0.75, 0.0, 1.0, 0.125),
    "seam": (0.5, 0.125, 0.5625, 0.25),
    "chrome": (0.5625, 0.125, 0.625, 0.25),
    "under": (0.625, 0.125, 0.75, 0.25),
    "grille": (0.75, 0.125, 1.0, 0.25),
    # row B (lamps, 256 px squares)
    "headlight": (0.0, 0.25, 0.125, 0.375),
    "headlight_old": (0.125, 0.25, 0.25, 0.375),
    "taillight": (0.25, 0.25, 0.375, 0.375),
    "taillight_old": (0.375, 0.25, 0.5, 0.375),
    "indicator": (0.5, 0.25, 0.5625, 0.3125),
    "lamp_round": (0.5625, 0.25, 0.625, 0.3125),
    "rubber": (0.625, 0.25, 0.75, 0.3125),
    "interior": (0.75, 0.25, 1.0, 0.3125),
    "paint_black": (0.5, 0.3125, 0.625, 0.375),   # painted black parts (tractor frame, bumpers)
    "galv": (0.625, 0.3125, 0.75, 0.375),         # galvanised steel
    "wood": (0.75, 0.3125, 1.0, 0.375),           # flatbed floor
    # row B2
    "plates": (0.0, 0.375, 0.5, 0.5),             # 4 x 4 cells, 256 x 64 px each at 2048
    "alu": (0.5, 0.375, 0.75, 0.5),
    "seal": (0.75, 0.375, 1.0, 0.4375),
    "light_grey": (0.75, 0.4375, 1.0, 0.5),       # unpainted light grey plastic (mirror caps of vans, tractor seat)
    # row C (wheels)
    "tread": (0.0, 0.5, 0.5, 0.5625),
    "tread_tractor": (0.0, 0.5625, 0.5, 0.625),
    "sidewall": (0.0, 0.625, 0.125, 0.75),
    "rim_alloy": (0.125, 0.625, 0.25, 0.75),
    "rim_steel": (0.25, 0.625, 0.375, 0.75),
    "rim_tractor": (0.375, 0.625, 0.5, 0.75),
    "rim_alloy2": (0.5, 0.625, 0.625, 0.75),
    "sidewall_tractor": (0.625, 0.625, 0.75, 0.75),
    "hubcap": (0.75, 0.625, 0.875, 0.75),
    "brake": (0.875, 0.625, 1.0, 0.75),
}
PLATE_COLS = 4
PLATE_ROWS = 4

# per swatch: (roughness, metalness) defaults for the ORM map
RM = {
    "paint": (0.32, 0.0), "glass": (0.05, 0.0), "plastic": (0.62, 0.0), "seam": (0.8, 0.0), "chrome": (0.12, 1.0),
    "under": (0.92, 0.0), "grille": (0.45, 0.0), "headlight": (0.12, 0.0), "headlight_old": (0.14, 0.0),
    "taillight": (0.1, 0.0), "taillight_old": (0.14, 0.0), "indicator": (0.12, 0.0), "lamp_round": (0.12, 0.0),
    "rubber": (0.85, 0.0), "interior": (0.85, 0.0), "paint_black": (0.4, 0.0), "galv": (0.45, 1.0),
    "wood": (0.8, 0.0), "plates": (0.38, 0.0), "alu": (0.38, 1.0), "seal": (0.7, 0.0), "light_grey": (0.6, 0.0),
    "tread": (0.88, 0.0), "tread_tractor": (0.9, 0.0), "sidewall": (0.82, 0.0), "rim_alloy": (0.3, 1.0),
    "rim_steel": (0.45, 0.0), "rim_tractor": (0.42, 0.0), "rim_alloy2": (0.28, 1.0), "sidewall_tractor": (0.86, 0.0),
    "hubcap": (0.35, 0.0), "brake": (0.55, 1.0),
}

albedo = np.zeros((S, S, 3), np.float32)      # sRGB 0..1
height = np.zeros((S, S), np.float32)         # for the normal map (metres-ish, arbitrary scale per swatch)
rough = np.zeros((S, S), np.float32)
metal = np.zeros((S, S), np.float32)
ao = np.ones((S, S), np.float32)
mask = np.zeros((S, S, 4), np.float32)        # R tail, G head, B indicator, A paint


def px(rect):
    u0, v0, u1, v1 = rect
    return int(round(u0 * S)), int(round(v0 * S)), int(round(u1 * S)), int(round(v1 * S))


def region(name):
    x0, y0, x1, y1 = px(L[name])
    return slice(y0, y1), slice(x0, x1), (y1 - y0, x1 - x0)


def srgb(c):
    return np.array(c, np.float32) / 255.0


def noise(h, w, scale, octaves=4, seed=0):
    """Smooth value noise in 0..1 (bilinear upsampled random grids)."""
    r = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gh = max(2, int(h / scale * 2 ** o) + 2)
        gw = max(2, int(w / scale * 2 ** o) + 2)
        g = r.random((gh, gw)).astype(np.float32)
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * np.asarray(img, np.float32) / 255.0
        tot += amp
        amp *= 0.5
    return out / tot


def lib(mat_id, kind, size):
    p = LIB / mat_id / f"{mat_id}_{kind}.jpg"
    if not p.exists():
        raise FileNotFoundError(f"shared texture missing: {p}")
    img = Image.open(p).convert("RGB" if kind != "normal" else "RGB")
    return img


def fill_flat(name, color, h_noise=0.0, seed=1):
    ys, xs, (h, w) = region(name)
    albedo[ys, xs] = srgb(color)
    r, m = RM[name]
    rough[ys, xs] = r
    metal[ys, xs] = m
    if h_noise > 0:
        height[ys, xs] = noise(h, w, 24, 3, seed) * h_noise


def set_rm(name):
    ys, xs, _ = region(name)
    r, m = RM[name]
    rough[ys, xs] = r
    metal[ys, xs] = m


# ---------------------------------------------------------------------------------------------- paint
def build_paint():
    ys, xs, (h, w) = region("paint")
    v = (np.arange(h, dtype=np.float32) / (h - 1))[:, None]          # 0 = roof line, 1 = ground
    n1 = noise(h, w, 40, 4, 11)
    n2 = noise(h, w, 9, 3, 12)
    # road dust climbs the lower body: strongest on the sills, broken up by streaks
    streak = noise(h, w * 4, 30, 3, 13)[:, ::4]
    dust = np.clip((v - 0.80) / 0.2, 0, 1) ** 1.6 * (0.55 + 0.45 * n1)
    dust += np.clip((v - 0.62) / 0.38, 0, 1) * 0.18 * streak
    dust = np.clip(dust, 0, 0.85)
    base = np.ones((h, w, 3), np.float32) * 0.985
    base *= (0.985 + 0.015 * n2)[..., None]
    dust_col = srgb((150, 138, 118))
    albedo[ys, xs] = base * (1 - dust[..., None]) + dust_col * dust[..., None]
    mask[ys, xs, 3] = 1.0 - dust
    rough[ys, xs] = 0.3 + 0.45 * dust
    metal[ys, xs] = 0.0
    height[ys, xs] = n2 * 0.15  # faint orange peel


# ---------------------------------------------------------------------------------------------- simple swatches
def build_simple():
    ys, xs, (h, w) = region("glass")
    g = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    albedo[ys, xs] = srgb((20, 23, 27)) * (1 - g * 0.25) + srgb((10, 11, 13)) * g * 0.25
    set_rm("glass")

    ys, xs, (h, w) = region("plastic")
    img = lib("plastic_rough", "albedo", 1024).resize((w, h), Image.LANCZOS)
    a = np.asarray(img, np.float32) / 255.0
    lum = a.mean(axis=2, keepdims=True)
    albedo[ys, xs] = 0.11 + (lum - lum.mean()) * 0.35
    set_rm("plastic")
    height[ys, xs] = noise(h, w, 3, 2, 21) * 0.4

    fill_flat("seam", (14, 14, 15))
    fill_flat("chrome", (205, 207, 210))
    fill_flat("under", (34, 33, 31), 0.4, 22)
    fill_flat("rubber", (24, 24, 25), 0.3, 23)
    fill_flat("interior", (40, 41, 43), 0.5, 24)
    fill_flat("paint_black", (22, 23, 25), 0.1, 25)
    fill_flat("seal", (18, 18, 19), 0.2, 26)
    fill_flat("light_grey", (150, 152, 152), 0.3, 27)
    fill_flat("brake", (90, 88, 86), 0.2, 28)

    ys, xs, (h, w) = region("galv")
    n = noise(h, w, 10, 4, 29)
    albedo[ys, xs] = (srgb((165, 168, 170)) * (0.85 + 0.25 * n)[..., None])
    set_rm("galv")
    rough[ys, xs] = 0.35 + 0.25 * n

    ys, xs, (h, w) = region("alu")
    streaks = noise(h, w * 8, 6, 3, 30)[:, ::8]
    albedo[ys, xs] = srgb((196, 199, 202)) * (0.9 + 0.12 * streaks)[..., None]
    set_rm("alu")
    rough[ys, xs] = 0.3 + 0.15 * streaks
    # embossed sheet ribs every 1/6 of the swatch (drop-side boards)
    rib = (np.sin(np.linspace(0, 6 * 2 * math.pi, h))[:, None] > 0.86).astype(np.float32)
    height[ys, xs] = rib * 0.8

    ys, xs, (h, w) = region("wood")
    planks = (np.arange(h)[:, None] % (h // 6) < 3).astype(np.float32)
    grain = noise(h, w * 6, 5, 3, 31)[:, ::6]
    albedo[ys, xs] = srgb((96, 76, 54)) * (0.75 + 0.4 * grain)[..., None] * (1 - 0.6 * planks)[..., None]
    set_rm("wood")
    height[ys, xs] = -planks * 0.6 + grain * 0.2


# ---------------------------------------------------------------------------------------------- grille
def build_grille():
    ys, xs, (h, w) = region("grille")
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # honeycomb-ish: offset rows of rounded cells
    cell = 22.0
    row = np.floor(yy / (cell * 0.7))
    off = (row % 2) * cell * 0.5
    cx = ((xx + off) % cell) - cell / 2
    cy = (yy % (cell * 0.7)) - cell * 0.35
    d = np.sqrt((cx / (cell * 0.42)) ** 2 + (cy / (cell * 0.27)) ** 2)
    hole = (d < 1.0).astype(np.float32)
    hole = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
    albedo[ys, xs] = (srgb((30, 31, 33)) * (1 - hole[..., None]) + srgb((6, 6, 7)) * hole[..., None])
    set_rm("grille")
    rough[ys, xs] = 0.35 + 0.5 * hole
    height[ys, xs] = (1 - hole) * 1.2
    ao[ys, xs] = 1 - 0.6 * hole


# ---------------------------------------------------------------------------------------------- lamps
def disc(h, w, cx, cy, r, soft=1.5):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    return np.clip((r - d) / soft + 0.5, 0, 1)


def rect_mask(h, w, x0, y0, x1, y1, soft=1.5, rad=0.0):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = np.maximum(np.maximum(x0 + rad - xx, xx - (x1 - rad)), 0)
    dy = np.maximum(np.maximum(y0 + rad - yy, yy - (y1 - rad)), 0)
    d = np.sqrt(dx ** 2 + dy ** 2) - rad
    inside = np.minimum(np.minimum(xx - x0, x1 - xx), np.minimum(yy - y0, y1 - yy))
    sd = np.where((dx > 0) | (dy > 0), d, -inside)
    return np.clip(-sd / soft + 0.5, 0, 1)


def build_headlights():
    # modern: chrome reflector housing, two projector lenses, LED running-light strip below
    ys, xs, (h, w) = region("headlight")
    base = srgb((150, 154, 160))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    grad = 0.75 + 0.25 * np.cos((xx / w) * math.pi * 3) * np.cos((yy / h) * math.pi * 2)
    col = base * grad[..., None]
    lens1 = disc(h, w, w * 0.3, h * 0.42, h * 0.2)
    lens2 = disc(h, w, w * 0.7, h * 0.42, h * 0.17)
    lens = np.maximum(lens1, lens2)
    ring = np.maximum(disc(h, w, w * 0.3, h * 0.42, h * 0.235), disc(h, w, w * 0.7, h * 0.42, h * 0.205)) - lens
    drl = rect_mask(h, w, w * 0.08, h * 0.74, w * 0.92, h * 0.84, 2, h * 0.04)
    col = col * (1 - lens[..., None]) + srgb((228, 232, 240)) * lens[..., None]
    col = col * (1 - ring[..., None]) + srgb((40, 42, 46)) * ring[..., None]
    col = col * (1 - drl[..., None]) + srgb((240, 240, 236)) * drl[..., None]
    # dark housing frame
    frame = 1 - rect_mask(h, w, 6, 6, w - 6, h - 6, 2, 18)
    col = col * (1 - frame[..., None]) + srgb((20, 20, 22)) * frame[..., None]
    albedo[ys, xs] = col
    set_rm("headlight")
    metal[ys, xs] = 0.85 * (1 - lens) * (1 - drl) * (1 - frame)
    rough[ys, xs] = 0.1 + 0.2 * frame
    height[ys, xs] = lens * 1.0 + drl * 0.4 - frame * 0.5
    emit = np.clip(lens * 1.0 + drl * 0.85 + (1 - frame) * 0.25, 0, 1)
    mask[ys, xs, 1] = emit

    # old: rectangular reflector with fluted glass lens
    ys, xs, (h, w) = region("headlight_old")
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    flutes = 0.5 + 0.5 * np.sin(xx / w * math.pi * 26) * np.sin(yy / h * math.pi * 8)
    col = srgb((196, 200, 204)) * (0.8 + 0.2 * flutes)[..., None]
    frame = 1 - rect_mask(h, w, 8, 10, w - 8, h - 10, 2, 8)
    col = col * (1 - frame[..., None]) + srgb((26, 26, 28)) * frame[..., None]
    albedo[ys, xs] = col
    set_rm("headlight_old")
    metal[ys, xs] = 0.5 * (1 - frame)
    height[ys, xs] = flutes * 0.5 * (1 - frame) - frame * 0.4
    mask[ys, xs, 1] = (1 - frame) * 0.95

    # small round lamp (tractor work/head lamp, fog lamp)
    ys, xs, (h, w) = region("lamp_round")
    lens = disc(h, w, w / 2, h / 2, w * 0.4)
    rim = disc(h, w, w / 2, h / 2, w * 0.48) - lens
    col = srgb((214, 216, 220)) * lens[..., None] + srgb((30, 30, 32)) * (1 - lens[..., None])
    col = col * (1 - rim[..., None]) + srgb((180, 182, 186)) * rim[..., None]
    albedo[ys, xs] = col
    set_rm("lamp_round")
    metal[ys, xs] = rim
    height[ys, xs] = lens * 0.6
    mask[ys, xs, 1] = lens


def build_taillights():
    ys, xs, (h, w) = region("taillight")
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    red = srgb((150, 14, 16))
    bands = 0.82 + 0.18 * (np.sin(yy / h * math.pi * 18) > 0.3)
    col = red * bands[..., None]
    ind = rect_mask(h, w, w * 0.06, h * 0.08, w * 0.42, h * 0.38, 2, 6)       # amber indicator top-left
    rev = rect_mask(h, w, w * 0.06, h * 0.62, w * 0.42, h * 0.9, 2, 6)        # clear reverse lamp bottom-left
    led = rect_mask(h, w, w * 0.5, h * 0.12, w * 0.95, h * 0.24, 2, 10)       # LED light guide
    col = col * (1 - ind[..., None]) + srgb((205, 110, 22)) * ind[..., None]
    col = col * (1 - rev[..., None]) + srgb((205, 208, 210)) * rev[..., None]
    col = col * (1 - led[..., None]) + srgb((200, 40, 38)) * led[..., None]
    frame = 1 - rect_mask(h, w, 4, 4, w - 4, h - 4, 2, 14)
    col = col * (1 - frame[..., None]) + srgb((22, 12, 12)) * frame[..., None]
    albedo[ys, xs] = col
    set_rm("taillight")
    height[ys, xs] = bands * 0.3 + led * 0.4 - frame * 0.4
    redmask = (1 - ind) * (1 - rev) * (1 - frame)
    mask[ys, xs, 0] = np.clip(redmask * (0.75 + 0.25 * led), 0, 1)
    mask[ys, xs, 2] = ind * (1 - frame)

    ys, xs, (h, w) = region("taillight_old")
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ribs = 0.75 + 0.25 * (np.sin(yy / h * math.pi * 30) > 0)
    col = srgb((140, 16, 18)) * ribs[..., None]
    ind = rect_mask(h, w, w * 0.04, h * 0.06, w * 0.96, h * 0.32, 2, 4)
    rev = rect_mask(h, w, w * 0.6, h * 0.66, w * 0.96, h * 0.94, 2, 4)
    col = col * (1 - ind[..., None]) + srgb((200, 108, 24)) * (ind * ribs)[..., None]
    col = col * (1 - rev[..., None]) + srgb((196, 198, 200)) * rev[..., None]
    frame = 1 - rect_mask(h, w, 3, 3, w - 3, h - 3, 1.5, 4)
    col = col * (1 - frame[..., None]) + srgb((28, 28, 30)) * frame[..., None]
    albedo[ys, xs] = col
    set_rm("taillight_old")
    height[ys, xs] = ribs * 0.4 - frame * 0.4
    mask[ys, xs, 0] = (1 - ind) * (1 - rev) * (1 - frame)
    mask[ys, xs, 2] = ind * (1 - frame)

    ys, xs, (h, w) = region("indicator")
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    facets = 0.8 + 0.2 * (np.sin(xx / w * math.pi * 10) * np.sin(yy / h * math.pi * 6) > 0)
    frame = 1 - rect_mask(h, w, 3, 3, w - 3, h - 3, 1.5, 10)
    albedo[ys, xs] = srgb((215, 120, 30)) * facets[..., None] * (1 - frame[..., None]) + srgb((30, 30, 32)) * frame[..., None]
    set_rm("indicator")
    height[ys, xs] = facets * 0.3
    mask[ys, xs, 2] = 1 - frame


# ---------------------------------------------------------------------------------------------- plates
def plate_texts(n):
    letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
    out = set()
    banned = {"SS", "SA", "KZ", "HJ", "NS", "AH"}
    while len(out) < n:
        a = random.choice(letters) + (random.choice(letters) if random.random() < 0.7 else "")
        if a in banned:
            continue
        num = str(random.randint(1, 9999 if len(a) == 1 else 999))
        out.add(f"{a} {num}")
    return sorted(out)


def build_plates():
    x0, y0, x1, y1 = px(L["plates"])
    cw = (x1 - x0) // PLATE_COLS
    ch = (y1 - y0) // PLATE_ROWS
    font_path = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"
    if not Path(font_path).exists():
        raise FileNotFoundError(f"plate font missing: {font_path}")
    texts = plate_texts(PLATE_COLS * PLATE_ROWS)
    img = Image.new("RGB", (x1 - x0, y1 - y0), (12, 12, 14))
    hmap = Image.new("L", (x1 - x0, y1 - y0), 0)
    dr = ImageDraw.Draw(img)
    dh = ImageDraw.Draw(hmap)
    font = ImageFont.truetype(font_path, int(ch * 0.86))
    for i, t in enumerate(texts):
        cx = (i % PLATE_COLS) * cw
        cy = (i // PLATE_COLS) * ch
        # plate 520 x 110 mm: fill the 256 x 64 cell with a 2 px black border
        px0, py0, px1, py1 = cx + 2, cy + 5, cx + cw - 2, cy + ch - 5
        dr.rounded_rectangle([px0, py0, px1, py1], radius=4, fill=(18, 18, 18))
        dr.rounded_rectangle([px0 + 2, py0 + 2, px1 - 2, py1 - 2], radius=3, fill=(232, 232, 226))
        dh.rounded_rectangle([px0 + 2, py0 + 2, px1 - 2, py1 - 2], radius=3, fill=60)
        # EU band
        bw = int((py1 - py0) * 0.36)
        dr.rectangle([px0 + 2, py0 + 2, px0 + 2 + bw, py1 - 2], fill=(22, 60, 150))
        for k in range(12):
            a = k / 12 * 2 * math.pi
            sx = px0 + 2 + bw / 2 + math.cos(a) * bw * 0.27
            sy = py0 + (py1 - py0) * 0.36 + math.sin(a) * bw * 0.27
            dr.ellipse([sx - 1, sy - 1, sx + 1, sy + 1], fill=(240, 205, 40))
        dr.text((px0 + 2 + bw / 2, py1 - 9), "D", fill=(240, 240, 240), font=ImageFont.truetype(font_path, 14), anchor="mm")
        # district, seals, letters and numbers
        tx = px0 + bw + 8
        midy = (py0 + py1) / 2 + 2
        base_y = py1 - 8
        avail = (px1 - 6) - tx - 19 - 6
        size = int((py1 - py0) * 0.84)
        font = ImageFont.truetype(font_path, size)
        while font.getlength("DÜW") + font.getlength(t) > avail and size > 20:
            size -= 1
            font = ImageFont.truetype(font_path, size)
        dr.text((tx, base_y), "DÜW", fill=(16, 16, 16), font=font, anchor="ls")
        dh.text((tx, base_y), "DÜW", fill=200, font=font, anchor="ls")
        tx += font.getlength("DÜW") + 6
        # registration seal + HU sticker
        dr.ellipse([tx, midy - 13, tx + 13, midy], fill=(60, 120, 160))
        dr.ellipse([tx, midy + 1, tx + 13, midy + 14], fill=(170, 140, 60))
        tx += 19
        dr.text((tx, base_y), t, fill=(16, 16, 16), font=font, anchor="ls")
        dh.text((tx, base_y), t, fill=200, font=font, anchor="ls")
    a = np.asarray(img, np.float32) / 255.0
    albedo[y0:y1, x0:x1] = a
    height[y0:y1, x0:x1] = np.asarray(hmap.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255.0 * 0.8
    set_rm("plates")
    return texts


# ---------------------------------------------------------------------------------------------- wheels
def build_tread(name, lugs):
    ys, xs, (h, w) = region(name)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rub = lib("rubber_tire", "albedo", 2048).resize((w, h), Image.LANCZOS)
    lum = (np.asarray(rub, np.float32) / 255.0).mean(axis=2)
    base = 0.07 + (lum - lum.mean()) * 0.25
    v = yy / h  # across the tread (0..1 = sidewall to sidewall)
    if not lugs:
        # car tyre: 4 circumferential grooves + sipes
        grooves = np.zeros_like(v)
        for c in (0.22, 0.4, 0.6, 0.78):
            grooves = np.maximum(grooves, np.clip(1 - np.abs(v - c) / 0.025, 0, 1))
        sipes = ((np.sin(xx / w * math.pi * 2 * 90 + v * 8) > 0.92) & (np.abs(v - 0.5) < 0.42)).astype(np.float32)
        shoulder = np.clip((np.abs(v - 0.5) - 0.42) / 0.08, 0, 1)
        hgt = 1 - np.maximum(grooves, sipes * 0.6) - shoulder * 0.4
    else:
        # tractor tyre: chevron lugs
        ph = (xx / w * 24 + np.abs(v - 0.5) * 1.6) % 1.0
        lug = ((ph < 0.38) & (np.abs(v - 0.5) < 0.47)).astype(np.float32)
        lug = np.asarray(Image.fromarray((lug * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
        hgt = lug
    albedo[ys, xs] = np.clip(base + hgt * 0.035, 0, 1)[..., None] * np.ones(3, np.float32)
    set_rm(name)
    height[ys, xs] = hgt * 1.4
    ao[ys, xs] = 0.55 + 0.45 * hgt


def polar(h, w):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (xx - w / 2 + 0.5) / (w / 2)
    dy = (yy - h / 2 + 0.5) / (h / 2)
    return np.sqrt(dx * dx + dy * dy), np.arctan2(dy, dx)


def build_sidewall(name, tractor):
    ys, xs, (h, w) = region(name)
    r, a = polar(h, w)
    base = 0.075 + 0.02 * noise(h, w, 8, 3, 40)
    hgt = 0.6 + 0.4 * np.sin(np.clip((r - 0.55) / 0.45, 0, 1) * math.pi)  # bulge
    if tractor:
        lugs = ((np.sin(a * 22) > 0.2) & (r > 0.9)).astype(np.float32)
        hgt += lugs * 0.5
    else:
        # lettering band: short raised blocks around the ring
        ring = (np.abs(r - 0.82) < 0.035).astype(np.float32)
        blocks = (np.sin(a * 60) > 0.1).astype(np.float32) * ((np.sin(a * 3) > -0.2).astype(np.float32))
        hgt += ring * blocks * 0.35
        base = base + ring * blocks * 0.02
    albedo[ys, xs] = np.clip(base, 0, 1)[..., None] * np.ones(3, np.float32)
    set_rm(name)
    height[ys, xs] = hgt * 0.8


def build_rims():
    # 5-spoke alloy
    ys, xs, (h, w) = region("rim_alloy")
    r, a = polar(h, w)
    spoke = (np.cos(a * 5) > 0.55).astype(np.float32)
    face = ((r < 0.94) & ((spoke > 0) | (r < 0.36) | (r > 0.8))).astype(np.float32)
    face = np.asarray(Image.fromarray((face * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
    nuts = np.zeros_like(r)
    for k in range(5):
        ang = k * 2 * math.pi / 5 + math.pi / 5
        nuts = np.maximum(nuts, disc(h, w, w / 2 + math.cos(ang) * w * 0.13, h / 2 + math.sin(ang) * h * 0.13, w * 0.025))
    cap = disc(h, w, w / 2, h / 2, w * 0.09)
    col = srgb((186, 189, 193)) * face[..., None] + srgb((28, 28, 30)) * (1 - face[..., None])
    col = col * (1 - nuts[..., None]) + srgb((120, 122, 126)) * nuts[..., None]
    col = col * (1 - cap[..., None]) + srgb((40, 40, 44)) * cap[..., None]
    albedo[ys, xs] = col
    set_rm("rim_alloy")
    metal[ys, xs] = face * (1 - cap)
    rough[ys, xs] = 0.25 + 0.55 * (1 - face)
    height[ys, xs] = face * 1.0 + nuts * 0.3
    ao[ys, xs] = 0.35 + 0.65 * face

    # multi-spoke alloy (darker anthracite)
    ys, xs, (h, w) = region("rim_alloy2")
    r, a = polar(h, w)
    spoke = (np.cos(a * 10) > 0.35).astype(np.float32)
    face = ((r < 0.94) & ((spoke > 0) | (r < 0.32) | (r > 0.84))).astype(np.float32)
    face = np.asarray(Image.fromarray((face * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    cap = disc(h, w, w / 2, h / 2, w * 0.08)
    col = srgb((96, 98, 102)) * face[..., None] + srgb((22, 22, 24)) * (1 - face[..., None])
    col = col * (1 - cap[..., None]) + srgb((150, 150, 154)) * cap[..., None]
    albedo[ys, xs] = col
    set_rm("rim_alloy2")
    metal[ys, xs] = face
    rough[ys, xs] = 0.3 + 0.5 * (1 - face)
    height[ys, xs] = face
    ao[ys, xs] = 0.35 + 0.65 * face

    # steel rim with ventilation holes
    ys, xs, (h, w) = region("rim_steel")
    r, a = polar(h, w)
    holes = np.zeros_like(r)
    for k in range(8):
        ang = k * 2 * math.pi / 8
        holes = np.maximum(holes, disc(h, w, w / 2 + math.cos(ang) * w * 0.3, h / 2 + math.sin(ang) * h * 0.3, w * 0.06))
    face = (r < 0.95).astype(np.float32) * (1 - holes)
    col = srgb((70, 72, 74)) * face[..., None] + srgb((15, 15, 16)) * (1 - face[..., None])
    albedo[ys, xs] = col
    set_rm("rim_steel")
    height[ys, xs] = face * (0.6 + 0.4 * np.clip(1 - np.abs(r - 0.6) / 0.25, 0, 1))
    ao[ys, xs] = 0.3 + 0.7 * face

    # plastic hub cap (vans, old sedan)
    ys, xs, (h, w) = region("hubcap")
    r, a = polar(h, w)
    slots = ((np.cos(a * 12) > 0.6) & (r > 0.5) & (r < 0.78)).astype(np.float32)
    face = (r < 0.95).astype(np.float32) * (1 - slots)
    col = srgb((176, 178, 182)) * face[..., None] + srgb((20, 20, 22)) * (1 - face[..., None])
    albedo[ys, xs] = col
    set_rm("hubcap")
    height[ys, xs] = face * (1 - 0.5 * r)
    ao[ys, xs] = 0.35 + 0.65 * face

    # tractor rim: painted light grey disc with bolt circle
    ys, xs, (h, w) = region("rim_tractor")
    r, a = polar(h, w)
    holes = np.zeros_like(r)
    for k in range(6):
        ang = k * 2 * math.pi / 6
        holes = np.maximum(holes, disc(h, w, w / 2 + math.cos(ang) * w * 0.27, h / 2 + math.sin(ang) * h * 0.27, w * 0.07))
    bolts = np.zeros_like(r)
    for k in range(8):
        ang = k * 2 * math.pi / 8
        bolts = np.maximum(bolts, disc(h, w, w / 2 + math.cos(ang) * w * 0.14, h / 2 + math.sin(ang) * h * 0.14, w * 0.02))
    face = (r < 0.96).astype(np.float32) * (1 - holes)
    col = srgb((190, 186, 172)) * face[..., None] + srgb((14, 14, 15)) * (1 - face[..., None])
    col = col * (1 - bolts[..., None]) + srgb((90, 90, 90)) * bolts[..., None]
    albedo[ys, xs] = col
    set_rm("rim_tractor")
    height[ys, xs] = face * 0.8 + bolts * 0.3
    ao[ys, xs] = 0.3 + 0.7 * face


# ---------------------------------------------------------------------------------------------- output
def normal_from_height(hm, strength):
    gy, gx = np.gradient(hm)
    nx = -gx * strength
    ny = gy * strength      # OpenGL convention: +Y up in the image = -row direction
    nz = np.ones_like(hm)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=-1)


def save(arr, path, mode, size, quality=88, lossless=False):
    img = Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8), mode)
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".webp":
        img.save(path, "WEBP", quality=quality, lossless=lossless, method=6)
    else:
        img.save(path, optimize=True)
    return path


def main():
    build_paint()
    build_simple()
    build_grille()
    build_headlights()
    build_taillights()
    plates = build_plates()
    build_tread("tread", False)
    build_tread("tread_tractor", True)
    build_sidewall("sidewall", False)
    build_sidewall("sidewall_tractor", True)
    build_rims()

    hb = (height + np.roll(height, 1, 0) + np.roll(height, -1, 0) + np.roll(height, 1, 1) + np.roll(height, -1, 1)) / 5.0
    nrm = normal_from_height(hb, 3.0)
    orm = np.stack([ao, rough, metal], axis=-1)

    for out_dir in (TEX_OUT, PUBLIC_OUT):
        save(albedo, out_dir / "traffic_car_albedo.webp", "RGB", 2048, 90)
        save(albedo, out_dir / "traffic_car_albedo_1k.webp", "RGB", 1024, 90)
        save(nrm * 0.5 + 0.5, out_dir / "traffic_car_normal.webp", "RGB", 1024, 92)
        save(orm, out_dir / "traffic_car_orm.webp", "RGB", 1024, 92)
        save(mask, out_dir / "traffic_car_mask.png", "RGBA", 1024)
    layout = {"layout": {k: list(v) for k, v in L.items()}, "plateCols": PLATE_COLS, "plateRows": PLATE_ROWS,
              "plateTexts": plates, "convention": "u right, v down from the top row (glTF); flipY = false"}
    (TEX_OUT / "atlas_layout.json").write_text(json.dumps(layout, indent=1))
    # preview
    Image.fromarray(np.clip(albedo * 255, 0, 255).astype(np.uint8)).resize((1024, 1024)).save(TEX_OUT / "_preview_albedo.png")
    Image.fromarray(np.clip(mask * 255, 0, 255).astype(np.uint8), "RGBA").save(TEX_OUT / "_preview_mask.png")
    print("atlas written:", ", ".join(plates))


if __name__ == "__main__":
    main()
