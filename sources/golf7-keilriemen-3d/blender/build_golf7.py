#!/usr/bin/env python3
"""
Procedural Class-A 3D model generator for the VW Golf Mk7 (5G, 1.6 TDI EA288)
in Metallic Medium Blue (Pacific Blue Metallic style, standard OEM trim — no GTI styling)
for Blender 5.2 LTS -> glTF 2.0 (.glb) export.

Usage:
    blender --background --python blender/build_golf7.py [-- --out /path/to/golf7.glb]

Coordinate contract:
    Three.js (+X right, +Y up, +Z rear / -Z front)
    -> Blender (+X right, +Y front, +Z up) via t2b(x, y, z) = (x, -z, y)
    -> glTF export_yup=True converts cleanly back to Three.js world space.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Callable, Sequence

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# ---------------------------------------------------------------------------
# Coordinate Contract & Vehicle Constants (Three.js world meters)
# ---------------------------------------------------------------------------

FRONT_AXLE_Z = -1.32
REAR_AXLE_Z = 1.31
WHEEL_CENTER_X = 0.76
WHEEL_CENTER_Y = 0.317
TIRE_RADIUS = 0.317
HUB_FACE_X = 0.69
BOLT_CIRCLE_RADIUS = 0.056

HOOD_HINGE_Y = 0.94
HOOD_HINGE_Z = -0.82

ARCH_HALF_Z = 0.402
ARCH_SPRING_Y = 0.317
ARCH_CROWN_Y = 0.750

FRONT_ARCH_Z0 = FRONT_AXLE_Z - ARCH_HALF_Z  # -1.722
FRONT_ARCH_Z1 = FRONT_AXLE_Z + ARCH_HALF_Z  # -0.918
REAR_ARCH_Z0 = REAR_AXLE_Z - ARCH_HALF_Z    # +0.908
REAR_ARCH_Z1 = REAR_AXLE_Z + ARCH_HALF_Z    # +1.712

FRONT_FENDER_SEAM_Z = -1.735
DOOR_FRONT_Z = -0.815
DOOR_REAR_Z = 0.855
REAR_BUMPER_SEAM_Z = 1.755


def t2b(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Convert Three.js coordinates (x, y_up, z_rear) to Blender (x, -z, y)."""
    return (float(x), float(-z), float(y))


def v3(x: float, y: float, z: float) -> Vector:
    """Create a Blender mathutils.Vector from Three.js coordinates."""
    return Vector(t2b(x, y, z))


def clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


def smoothstep(e0: float, e1: float, x: float) -> float:
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


# ---------------------------------------------------------------------------
# Clean Procedural 2D Anti-Aliased Canvas (Pure Python -> bpy.data.images)
# ---------------------------------------------------------------------------

_GLYPHS: dict[str, list[tuple[float, float, float, float]]] = {
    "W": [(0.08, 0.08, 0.25, 0.92), (0.25, 0.92, 0.50, 0.34), (0.50, 0.34, 0.75, 0.92), (0.75, 0.92, 0.92, 0.08)],
    "O": [
        (0.26, 0.08, 0.74, 0.08), (0.74, 0.08, 0.88, 0.24), (0.88, 0.24, 0.88, 0.76),
        (0.88, 0.76, 0.74, 0.92), (0.74, 0.92, 0.26, 0.92), (0.26, 0.92, 0.12, 0.76),
        (0.12, 0.76, 0.12, 0.24), (0.12, 0.24, 0.26, 0.08),
    ],
    "B": [
        (0.16, 0.08, 0.16, 0.92), (0.16, 0.08, 0.68, 0.08), (0.68, 0.08, 0.84, 0.20),
        (0.84, 0.20, 0.84, 0.38), (0.84, 0.38, 0.68, 0.48), (0.16, 0.48, 0.70, 0.48),
        (0.70, 0.48, 0.88, 0.60), (0.88, 0.60, 0.88, 0.80), (0.88, 0.80, 0.70, 0.92),
        (0.70, 0.92, 0.16, 0.92),
    ],
    "M": [(0.12, 0.92, 0.12, 0.08), (0.12, 0.08, 0.50, 0.56), (0.50, 0.56, 0.88, 0.08), (0.88, 0.08, 0.88, 0.92)],
    "K": [(0.18, 0.08, 0.18, 0.92), (0.84, 0.08, 0.22, 0.52), (0.34, 0.44, 0.86, 0.92)],
    "D": [
        (0.18, 0.08, 0.18, 0.92), (0.18, 0.08, 0.62, 0.08), (0.62, 0.08, 0.84, 0.26),
        (0.84, 0.26, 0.84, 0.74), (0.84, 0.74, 0.62, 0.92), (0.62, 0.92, 0.18, 0.92),
    ],
    "T": [(0.10, 0.08, 0.90, 0.08), (0.50, 0.08, 0.50, 0.92)],
    "I": [(0.32, 0.08, 0.68, 0.08), (0.50, 0.08, 0.50, 0.92), (0.32, 0.92, 0.68, 0.92)],
    "E": [(0.20, 0.08, 0.20, 0.92), (0.20, 0.08, 0.84, 0.08), (0.20, 0.50, 0.72, 0.50), (0.20, 0.92, 0.84, 0.92)],
    "A": [(0.14, 0.92, 0.50, 0.08), (0.50, 0.08, 0.86, 0.92), (0.26, 0.62, 0.74, 0.62)],
    "1": [(0.32, 0.24, 0.54, 0.08), (0.54, 0.08, 0.54, 0.92), (0.30, 0.92, 0.78, 0.92)],
    "2": [
        (0.16, 0.24, 0.30, 0.08), (0.30, 0.08, 0.70, 0.08), (0.70, 0.08, 0.84, 0.24),
        (0.84, 0.24, 0.84, 0.40), (0.84, 0.40, 0.16, 0.92), (0.16, 0.92, 0.86, 0.92),
    ],
    "6": [
        (0.76, 0.14, 0.60, 0.08), (0.60, 0.08, 0.30, 0.08), (0.30, 0.08, 0.16, 0.28),
        (0.16, 0.28, 0.16, 0.76), (0.16, 0.76, 0.30, 0.92), (0.30, 0.92, 0.70, 0.92),
        (0.70, 0.92, 0.84, 0.76), (0.84, 0.76, 0.84, 0.56), (0.84, 0.56, 0.70, 0.44),
        (0.70, 0.44, 0.18, 0.44),
    ],
    "7": [(0.14, 0.08, 0.86, 0.08), (0.86, 0.08, 0.36, 0.92)],
    "8": [
        (0.30, 0.08, 0.70, 0.08), (0.70, 0.08, 0.82, 0.20), (0.82, 0.20, 0.82, 0.38),
        (0.82, 0.38, 0.70, 0.48), (0.70, 0.48, 0.30, 0.48), (0.30, 0.48, 0.18, 0.38),
        (0.18, 0.38, 0.18, 0.20), (0.18, 0.20, 0.30, 0.08), (0.30, 0.48, 0.14, 0.60),
        (0.14, 0.60, 0.14, 0.80), (0.14, 0.80, 0.30, 0.92), (0.30, 0.92, 0.70, 0.92),
        (0.70, 0.92, 0.86, 0.80), (0.86, 0.80, 0.86, 0.60), (0.86, 0.60, 0.70, 0.48),
    ],
    "0": [
        (0.30, 0.08, 0.70, 0.08), (0.70, 0.08, 0.84, 0.24), (0.84, 0.24, 0.84, 0.76),
        (0.84, 0.76, 0.70, 0.92), (0.70, 0.92, 0.30, 0.92), (0.30, 0.92, 0.16, 0.76),
        (0.16, 0.76, 0.16, 0.24), (0.16, 0.24, 0.30, 0.08),
    ],
    ".": [(0.46, 0.84, 0.54, 0.84), (0.46, 0.84, 0.46, 0.92)],
    " ": [],
}


class PixelCanvas:
    """Fast RGBA sRGB canvas that converts cleanly into a packed Blender Image."""

    def __init__(self, width: int, height: int, bg: tuple[float, float, float, float]) -> None:
        self.w = width
        self.h = height
        self.buf = list(bg) * (width * height)

    def _blend_px(self, ix: int, iy: int, col: tuple[float, float, float], alpha: float) -> None:
        if ix < 0 or ix >= self.w or iy < 0 or iy >= self.h or alpha <= 0.0:
            return
        row = self.h - 1 - iy
        idx = (row * self.w + ix) * 4
        inv = 1.0 - alpha
        self.buf[idx] = self.buf[idx] * inv + col[0] * alpha
        self.buf[idx + 1] = self.buf[idx + 1] * inv + col[1] * alpha
        self.buf[idx + 2] = self.buf[idx + 2] * inv + col[2] * alpha
        self.buf[idx + 3] = 1.0

    def fill_rect(self, x0: float, y0: float, x1: float, y1: float, col: tuple[float, float, float], alpha: float = 1.0) -> None:
        ix0 = max(0, int(math.floor(x0)))
        ix1 = min(self.w - 1, int(math.ceil(x1)))
        iy0 = max(0, int(math.floor(y0)))
        iy1 = min(self.h - 1, int(math.ceil(y1)))
        for iy in range(iy0, iy1 + 1):
            for ix in range(ix0, ix1 + 1):
                self._blend_px(ix, iy, col, alpha)

    def stroke_rect(self, x0: float, y0: float, x1: float, y1: float, t: float, col: tuple[float, float, float]) -> None:
        self.fill_rect(x0, y0, x1, y0 + t, col)
        self.fill_rect(x0, y1 - t, x1, y1, col)
        self.fill_rect(x0, y0, x0 + t, y1, col)
        self.fill_rect(x1 - t, y0, x1, y1, col)

    def fill_circle(self, cx: float, cy: float, r: float, col: tuple[float, float, float], alpha: float = 1.0) -> None:
        ix0 = max(0, int(math.floor(cx - r - 1.5)))
        ix1 = min(self.w - 1, int(math.ceil(cx + r + 1.5)))
        iy0 = max(0, int(math.floor(cy - r - 1.5)))
        iy1 = min(self.h - 1, int(math.ceil(cy + r + 1.5)))
        for iy in range(iy0, iy1 + 1):
            dy = iy + 0.5 - cy
            for ix in range(ix0, ix1 + 1):
                dx = ix + 0.5 - cx
                d = math.hypot(dx, dy) - r
                cov = clamp(0.5 - d, 0.0, 1.0) * alpha
                if cov > 0.0:
                    self._blend_px(ix, iy, col, cov)

    def stroke_circle(self, cx: float, cy: float, r: float, thick: float, col: tuple[float, float, float]) -> None:
        half_t = thick * 0.5
        ix0 = max(0, int(math.floor(cx - r - half_t - 1.5)))
        ix1 = min(self.w - 1, int(math.ceil(cx + r + half_t + 1.5)))
        iy0 = max(0, int(math.floor(cy - r - half_t - 1.5)))
        iy1 = min(self.h - 1, int(math.ceil(cy + r + half_t + 1.5)))
        for iy in range(iy0, iy1 + 1):
            dy = iy + 0.5 - cy
            for ix in range(ix0, ix1 + 1):
                dx = ix + 0.5 - cx
                d = abs(math.hypot(dx, dy) - r) - half_t
                cov = clamp(0.5 - d, 0.0, 1.0)
                if cov > 0.0:
                    self._blend_px(ix, iy, col, cov)

    def draw_capsule(
        self, x0: float, y0: float, x1: float, y1: float, r: float, col: tuple[float, float, float], alpha: float = 1.0
    ) -> None:
        pad = r + 1.5
        ix0 = max(0, int(math.floor(min(x0, x1) - pad)))
        ix1 = min(self.w - 1, int(math.ceil(max(x0, x1) + pad)))
        iy0 = max(0, int(math.floor(min(y0, y1) - pad)))
        iy1 = min(self.h - 1, int(math.ceil(max(y0, y1) + pad)))
        vx = x1 - x0
        vy = y1 - y0
        vv = vx * vx + vy * vy
        for iy in range(iy0, iy1 + 1):
            py = iy + 0.5 - y0
            for ix in range(ix0, ix1 + 1):
                px = ix + 0.5 - x0
                h = clamp((px * vx + py * vy) / vv, 0.0, 1.0) if vv > 1e-6 else 0.0
                d = math.hypot(px - vx * h, py - vy * h) - r
                cov = clamp(0.5 - d, 0.0, 1.0) * alpha
                if cov > 0.0:
                    self._blend_px(ix, iy, col, cov)

    def draw_text(
        self,
        text: str,
        x: float,
        y: float,
        glyph_w: float,
        glyph_h: float,
        stroke_r: float,
        col: tuple[float, float, float],
        advance: float | None = None,
    ) -> None:
        step = advance if advance is not None else glyph_w * 1.24
        cx = x
        for ch in text:
            segs = _GLYPHS.get(ch.upper(), [])
            for x0, y0, x1, y1 in segs:
                self.draw_capsule(
                    cx + x0 * glyph_w,
                    y + y0 * glyph_h,
                    cx + x1 * glyph_w,
                    y + y1 * glyph_h,
                    stroke_r,
                    col,
                )
            cx += step * (0.55 if ch == " " else 1.0)

    def to_packed_image(self, name: str) -> bpy.types.Image:
        img = bpy.data.images.new(name, self.w, self.h, alpha=True)
        img.pixels = self.buf
        img.pack()
        return img


def build_textures() -> dict[str, bpy.types.Image]:
    """Generate crisp packed procedural textures via bpy.data.images.new."""
    # 1. Neutral German License Plate "WOB MK 700" (768 x 168)
    pw, ph = 768, 168
    pc = PixelCanvas(pw, ph, (0.96, 0.97, 0.98, 1.0))
    pc.stroke_rect(2, 2, pw - 2, ph - 2, 7.0, (0.06, 0.08, 0.11))
    pc.fill_rect(8, 8, 78, ph - 8, (0.09, 0.25, 0.72))
    for k in range(12):
        ang = k * (2.0 * math.pi / 12.0)
        pc.fill_circle(43 + math.cos(ang) * 20, 48 + math.sin(ang) * 20, 2.6, (0.98, 0.82, 0.12))
    pc.draw_text("D", 28, 96, 30, 44, 3.6, (0.98, 0.99, 1.0))
    pc.draw_text("WOB", 98, 30, 56, 108, 6.8, (0.06, 0.08, 0.11), advance=68)
    pc.fill_circle(334, 54, 15, (0.85, 0.24, 0.18))
    pc.fill_circle(334, 54, 9, (0.96, 0.85, 0.35))
    pc.fill_circle(334, 114, 17, (0.14, 0.42, 0.75))
    pc.fill_circle(334, 114, 11, (0.93, 0.94, 0.96))
    pc.fill_circle(334, 114, 4, (0.82, 0.14, 0.16))
    pc.draw_text("MK 700", 368, 30, 54, 108, 6.8, (0.06, 0.08, 0.11), advance=64)
    plate_img = pc.to_packed_image("Golf7_LicensePlateTex")

    # 2. EA288 TDI Engine Cover Plaque (512 x 224)
    tw, th = 512, 224
    tc = PixelCanvas(tw, th, (0.12, 0.14, 0.18, 1.0))
    for y in range(12, th - 12, 6):
        shade = 0.135 if (y // 6) % 2 == 0 else 0.115
        tc.fill_rect(12, y, tw - 12, y + 3, (shade, shade + 0.015, shade + 0.03))
    tc.stroke_rect(8, 8, tw - 8, th - 8, 5.0, (0.48, 0.54, 0.62))
    tc.fill_circle(92, 112, 58, (0.07, 0.09, 0.12))
    tc.stroke_circle(92, 112, 54, 7.5, (0.82, 0.86, 0.92))
    tc.draw_capsule(60, 74, 92, 115, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(124, 74, 92, 115, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(50, 92, 74, 152, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(74, 152, 92, 122, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(92, 122, 110, 152, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(110, 152, 134, 92, 4.5, (0.84, 0.88, 0.94))
    tc.draw_text("TD", 188, 42, 74, 96, 9.0, (0.88, 0.91, 0.95), advance=88)
    tc.draw_text("I", 364, 42, 74, 96, 9.0, (0.86, 0.10, 0.12), advance=74)
    tc.draw_text("1.6 EA288", 190, 156, 22, 34, 2.8, (0.64, 0.70, 0.78), advance=29)
    tdi_img = tc.to_packed_image("Golf7_TDIPlaqueTex")

    # 3. Machined Concentric Brake Rotor Texture (256 x 256)
    rw, rh = 256, 256
    rc = PixelCanvas(rw, rh, (0.68, 0.71, 0.76, 1.0))
    for rad in range(56, 126, 3):
        shade = 0.56 if rad % 6 == 0 else 0.78
        rc.stroke_circle(128, 128, rad, 1.3, (shade, shade + 0.02, shade + 0.04))
    rotor_img = rc.to_packed_image("Golf7_RotorTex")

    return {
        "plate": plate_img,
        "tdi_plaque": tdi_img,
        "rotor": rotor_img,
    }


# ---------------------------------------------------------------------------
# Material Factory (Blender 5.2 Principled BSDF)
# ---------------------------------------------------------------------------


def make_mat(
    name: str,
    base_color: tuple[float, float, float, float],
    metallic: float = 0.0,
    roughness: float = 0.5,
    alpha: float = 1.0,
    coat_weight: float = 0.0,
    coat_roughness: float = 0.04,
    emit_color: tuple[float, float, float, float] | None = None,
    emit_strength: float = 0.0,
    image: bpy.types.Image | None = None,
    double_sided: bool = False,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_backface_culling = not double_sided
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")

    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    bsdf.inputs["Coat Weight"].default_value = coat_weight
    bsdf.inputs["Coat Roughness"].default_value = coat_roughness

    if emit_color is not None and emit_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = emit_color
        bsdf.inputs["Emission Strength"].default_value = emit_strength

    if image is not None:
        tex_node = nt.nodes.new("ShaderNodeTexImage")
        tex_node.image = image
        nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])

    return mat


def build_materials(images: dict[str, bpy.types.Image]) -> dict[str, bpy.types.Material]:
    return {
        # OEM VW Golf Mk7 Metallic Medium Blue (Pacific Blue Metallic style matching reference photo):
        # deep rich cobalt/navy flanks + vibrant steel/sky-blue clearcoat edge highlights.
        "paint": make_mat(
            "Golf7_Paint",
            base_color=(0.015, 0.068, 0.275, 1.0),
            metallic=0.68,
            roughness=0.21,
            coat_weight=1.0,
            coat_roughness=0.035,
            double_sided=False,
        ),
        "glass": make_mat(
            "Golf7_Glass",
            base_color=(0.012, 0.020, 0.032, 1.0),
            metallic=0.08,
            roughness=0.05,
            alpha=0.76,
            coat_weight=1.0,
            coat_roughness=0.03,
            double_sided=True,
        ),
        "glass_frit": make_mat(
            "Golf7_GlassFrit",
            base_color=(0.008, 0.010, 0.013, 1.0),
            metallic=0.04,
            roughness=0.18,
            coat_weight=0.75,
            coat_roughness=0.06,
        ),
        # Crystal-clear halogen headlight polycarbonate cover (zero milky white veil; pure specular clearcoat!)
        "headlight_lens": make_mat(
            "Golf7_HeadlightLens",
            base_color=(0.14, 0.18, 0.24, 1.0),
            metallic=0.06,
            roughness=0.02,
            alpha=0.15,
            coat_weight=1.0,
            coat_roughness=0.015,
            double_sided=True,
        ),
        # Faceted mirror-chrome halogen reflector bowls (crisp metallic silver contrast against dark housing)
        "reflector": make_mat(
            "Golf7_ReflectorChrome",
            base_color=(0.86, 0.89, 0.93, 1.0),
            metallic=0.96,
            roughness=0.14,
        ),
        "halogen_bulb": make_mat(
            "Golf7_HalogenBulb",
            base_color=(0.98, 0.95, 0.88, 1.0),
            metallic=0.15,
            roughness=0.14,
            emit_color=(1.0, 0.92, 0.76, 1.0),
            emit_strength=0.35,
        ),
        "amber_lamp": make_mat(
            "Golf7_CornerAmber",
            base_color=(0.94, 0.56, 0.16, 1.0),
            metallic=0.12,
            roughness=0.18,
            emit_color=(1.0, 0.62, 0.18, 1.0),
            emit_strength=0.45,
        ),
        "mirror_led": make_mat(
            "Golf7_MirrorRepeater",
            base_color=(0.94, 0.96, 0.98, 1.0),
            metallic=0.15,
            roughness=0.12,
            emit_color=(0.96, 0.97, 1.0, 1.0),
            emit_strength=0.30,
        ),
        "tail_led": make_mat(
            "Golf7_TailLED",
            base_color=(0.55, 0.015, 0.015, 1.0),
            metallic=0.05,
            roughness=0.20,
            emit_color=(0.75, 0.03, 0.02, 1.0),
            emit_strength=0.32,
        ),
        "tail_lens": make_mat(
            "Golf7_TailLens",
            base_color=(0.28, 0.007, 0.010, 1.0),
            metallic=0.08,
            roughness=0.06,
            alpha=0.80,
            coat_weight=1.0,
            coat_roughness=0.03,
            double_sided=True,
        ),
        "tail_white": make_mat(
            "Golf7_TailWhite",
            base_color=(0.88, 0.90, 0.93, 1.0),
            metallic=0.12,
            roughness=0.16,
        ),
        "gloss_black": make_mat(
            "Golf7_GlossBlack",
            base_color=(0.004, 0.005, 0.007, 1.0),
            metallic=0.02,
            roughness=0.30,
            coat_weight=0.25,
            coat_roughness=0.08,
        ),
        "matte_trim": make_mat(
            "Golf7_MatteTrim",
            base_color=(0.007, 0.008, 0.011, 1.0),
            metallic=0.02,
            roughness=0.82,
        ),
        "panel_seam": make_mat(
            "Golf7_PanelSeam",
            base_color=(0.005, 0.008, 0.014, 1.0),
            metallic=0.04,
            roughness=0.85,
        ),
        "chrome": make_mat(
            "Golf7_Chrome",
            base_color=(0.90, 0.92, 0.95, 1.0),
            metallic=0.97,
            roughness=0.08,
        ),
        "mirror_glass": make_mat(
            "Golf7_MirrorGlass",
            base_color=(0.68, 0.74, 0.82, 1.0),
            metallic=0.96,
            roughness=0.04,
        ),
        "plate": make_mat(
            "Golf7_LicensePlate",
            base_color=(1.0, 1.0, 1.0, 1.0),
            metallic=0.04,
            roughness=0.34,
            image=images["plate"],
        ),
        "interior": make_mat(
            "Golf7_Interior",
            base_color=(0.038, 0.042, 0.050, 1.0),
            metallic=0.02,
            roughness=0.86,
        ),
        "bay_steel": make_mat(
            "Golf7_BaySteel",
            base_color=(0.050, 0.058, 0.072, 1.0),
            metallic=0.45,
            roughness=0.55,
        ),
        "coolant_bottle": make_mat(
            "Golf7_CoolantBottle",
            base_color=(0.90, 0.86, 0.88, 1.0),
            metallic=0.02,
            roughness=0.25,
            alpha=0.58,
            double_sided=True,
        ),
        "coolant_g13": make_mat(
            "Golf7_CoolantG13",
            base_color=(0.92, 0.12, 0.48, 1.0),
            metallic=0.0,
            roughness=0.25,
            emit_color=(0.82, 0.08, 0.42, 1.0),
            emit_strength=0.16,
        ),
        "coolant_cap": make_mat(
            "Golf7_CoolantCap",
            base_color=(0.02, 0.36, 0.78, 1.0),
            metallic=0.05,
            roughness=0.42,
        ),
        "hood_pad": make_mat(
            "Golf7_HoodPad",
            base_color=(0.030, 0.034, 0.040, 1.0),
            metallic=0.10,
            roughness=0.80,
        ),
        # Engine Cover
        "ec_poly": make_mat(
            "Golf7_EngineCoverPolyamide",
            base_color=(0.042, 0.048, 0.058, 1.0),
            metallic=0.14,
            roughness=0.62,
        ),
        "ec_silver": make_mat(
            "Golf7_EngineCoverSilver",
            base_color=(0.56, 0.60, 0.66, 1.0),
            metallic=0.82,
            roughness=0.26,
        ),
        "ec_plaque": make_mat(
            "Golf7_EngineCoverPlaque",
            base_color=(1.0, 1.0, 1.0, 1.0),
            metallic=0.35,
            roughness=0.32,
            image=images["tdi_plaque"],
        ),
        # Wheels & Tires
        "alloy": make_mat(
            "Golf7_Alloy",
            base_color=(0.78, 0.82, 0.86, 1.0),
            metallic=0.90,
            roughness=0.18,
            coat_weight=0.6,
            coat_roughness=0.08,
        ),
        "alloy_pocket": make_mat(
            "Golf7_AlloyPocket",
            base_color=(0.042, 0.048, 0.058, 1.0),
            metallic=0.26,
            roughness=0.48,
        ),
        "tire": make_mat(
            "Golf7_Tire",
            base_color=(0.020, 0.022, 0.026, 1.0),
            metallic=0.0,
            roughness=0.78,
        ),
        "bolt_chrome": make_mat(
            "Golf7_BoltChrome",
            base_color=(0.84, 0.87, 0.91, 1.0),
            metallic=0.94,
            roughness=0.14,
        ),
        "bolt_thread": make_mat(
            "Golf7_BoltThread",
            base_color=(0.24, 0.27, 0.31, 1.0),
            metallic=0.80,
            roughness=0.38,
        ),
        # Suspension & Brakes (ALL prefixed Golf7_Susp_ for X-Ray mode!)
        "susp_iron": make_mat(
            "Golf7_Susp_Iron",
            base_color=(0.11, 0.125, 0.145, 1.0),
            metallic=0.68,
            roughness=0.52,
        ),
        "susp_rotor": make_mat(
            "Golf7_Susp_Rotor",
            base_color=(1.0, 1.0, 1.0, 1.0),
            metallic=0.88,
            roughness=0.22,
            image=images["rotor"],
        ),
        "susp_caliper": make_mat(
            "Golf7_Susp_Caliper",
            base_color=(0.30, 0.34, 0.39, 1.0),
            metallic=0.58,
            roughness=0.42,
        ),
        "susp_black": make_mat(
            "Golf7_Susp_GlossBlack",
            base_color=(0.025, 0.03, 0.038, 1.0),
            metallic=0.45,
            roughness=0.25,
        ),
        "susp_chrome": make_mat(
            "Golf7_Susp_Chrome",
            base_color=(0.86, 0.89, 0.93, 1.0),
            metallic=0.95,
            roughness=0.12,
        ),
        "susp_hub": make_mat(
            "Golf7_Susp_Hub",
            base_color=(0.64, 0.68, 0.74, 1.0),
            metallic=0.86,
            roughness=0.24,
        ),
        "susp_bore": make_mat(
            "Golf7_Susp_Bore",
            base_color=(0.04, 0.045, 0.055, 1.0),
            metallic=0.65,
            roughness=0.48,
        ),
        # Wheel Liner & Torx Screws
        "liner": make_mat(
            "Golf7_Liner",
            base_color=(0.024, 0.027, 0.033, 1.0),
            metallic=0.04,
            roughness=0.82,
        ),
        "screw_metal": make_mat(
            "Golf7_LinerScrewMetal",
            base_color=(0.68, 0.72, 0.78, 1.0),
            metallic=0.88,
            roughness=0.24,
        ),
        "screw_recess": make_mat(
            "Golf7_LinerScrewRecess",
            base_color=(0.04, 0.045, 0.055, 1.0),
            metallic=0.5,
            roughness=0.55,
        ),
    }


# ---------------------------------------------------------------------------
# BMesh Geometry Primitives & Loft Helpers
# ---------------------------------------------------------------------------


def add_quad_or_tri(bm: bmesh.types.BMesh, verts: Sequence[bmesh.types.BMVert], mat_idx: int = 0) -> None:
    try:
        f = bm.faces.new(verts)
        f.material_index = mat_idx
        f.smooth = True
    except ValueError:
        pass


def add_loft_grid(
    bm: bmesh.types.BMesh,
    pts_grid: list[list[Vector]],
    mat_idx: int = 0,
    closed_u: bool = False,
    flip: bool = False,
    crease_layer: bmesh.types.BMLayerItem | None = None,
    crease_rows: dict[int, float] | None = None,
    crease_cols: dict[int, float] | None = None,
    outward_dir: Vector | None = None,
    outward_rows: tuple[int, int] | None = None,
) -> list[list[bmesh.types.BMVert]]:
    """Create a lofted quad grid from a 2D array of Blender Vectors, auto-orienting normals if outward_dir is given."""
    rows = len(pts_grid)
    cols = len(pts_grid[0])
    u_max = rows if closed_u else rows - 1

    if outward_dir is not None:
        r0, r1 = outward_rows if outward_rows is not None else (0, u_max)
        r0 = max(0, r0)
        r1 = min(u_max, r1)
        normal_sum = Vector((0.0, 0.0, 0.0))
        for r in range(r0, r1):
            r_next = (r + 1) % rows
            for c in range(cols - 1):
                p00 = pts_grid[r][c]
                p10 = pts_grid[r_next][c]
                p01 = pts_grid[r][c + 1]
                normal_sum += (p10 - p00).cross(p01 - p00)
        if normal_sum.length > 1e-9:
            flip = normal_sum.dot(outward_dir) < 0.0

    vgrid: list[list[bmesh.types.BMVert]] = [[bm.verts.new(p) for p in row] for row in pts_grid]
    bm.verts.ensure_lookup_table()

    for r in range(u_max):
        r_next = (r + 1) % rows
        for c in range(cols - 1):
            v00 = vgrid[r][c]
            v10 = vgrid[r_next][c]
            v11 = vgrid[r_next][c + 1]
            v01 = vgrid[r][c + 1]
            quad = (v00, v01, v11, v10) if flip else (v00, v10, v11, v01)
            add_quad_or_tri(bm, quad, mat_idx)

    if crease_layer is not None:
        if crease_rows:
            for r, val in crease_rows.items():
                if 0 <= r < rows:
                    for c in range(cols - 1):
                        e = bm.edges.get((vgrid[r][c], vgrid[r][c + 1]))
                        if e:
                            e[crease_layer] = val
        if crease_cols:
            for c, val in crease_cols.items():
                if 0 <= c < cols:
                    for r in range(u_max):
                        r_next = (r + 1) % rows
                        e = bm.edges.get((vgrid[r][c], vgrid[r_next][c]))
                        if e:
                            e[crease_layer] = val

    return vgrid


def mirror_bmesh_x(bm: bmesh.types.BMesh, crease_layer: bmesh.types.BMLayerItem | None = None, weld_dist: float = 0.0005) -> None:
    """Duplicate all geometry in bm across X=0 (preserving outward winding & creases) and weld centerline."""
    orig_verts = list(bm.verts)
    orig_faces = list(bm.faces)
    orig_edges = list(bm.edges)

    vmap: dict[bmesh.types.BMVert, bmesh.types.BMVert] = {}
    for v in orig_verts:
        if abs(v.co.x) < weld_dist:
            v.co.x = 0.0
            vmap[v] = v
        else:
            nv = bm.verts.new((-v.co.x, v.co.y, v.co.z))
            vmap[v] = nv

    for f in orig_faces:
        mverts = [vmap[v] for v in reversed(f.verts)]
        try:
            nf = bm.faces.new(mverts)
            nf.material_index = f.material_index
            nf.smooth = f.smooth
        except ValueError:
            pass

    if crease_layer is not None:
        bm.edges.ensure_lookup_table()
        for e in orig_edges:
            cv = e[crease_layer]
            if cv > 0.0:
                mv0, mv1 = vmap[e.verts[0]], vmap[e.verts[1]]
                if mv0 != mv1:
                    me = bm.edges.get((mv0, mv1))
                    if me is not None:
                        me[crease_layer] = cv

    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=weld_dist)


def add_beveled_box(
    bm: bmesh.types.BMesh,
    center_three: tuple[float, float, float],
    size_three: tuple[float, float, float],
    rot_euler_three: tuple[float, float, float] = (0.0, 0.0, 0.0),
    mat_idx: int = 0,
    bevel: float = 0.0,
    bevel_segs: int = 2,
) -> list[bmesh.types.BMVert]:
    """Create a box in Three.js dimensions transformed to Blender coordinates."""
    sx, sy, sz = size_three
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    for v in verts:
        v.co.x *= sx
        v.co.y *= sz
        v.co.z *= sy

    rx, ry, rz = rot_euler_three
    rot_eul = Euler((rx, ry, rz), "XYZ")
    for v in verts:
        p_t = Vector((v.co.x, v.co.z, -v.co.y))
        p_t.rotate(rot_eul)
        p_t += Vector(center_three)
        v.co = v3(p_t.x, p_t.y, p_t.z)

    box_faces = {f for v in verts for f in v.link_faces}
    for f in box_faces:
        f.material_index = mat_idx
        f.smooth = True

    if bevel > 0.0:
        box_edges = list({e for f in box_faces for e in f.edges})
        bres = bmesh.ops.bevel(
            bm,
            geom=box_edges,
            offset=bevel,
            segments=bevel_segs,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )
        for f in bres.get("faces", []):
            f.material_index = mat_idx
            f.smooth = True

    return verts


def add_cylinder_between(
    bm: bmesh.types.BMesh,
    p1_three: tuple[float, float, float],
    p2_three: tuple[float, float, float],
    r1: float,
    r2: float | None = None,
    segs: int = 24,
    cap: bool = True,
    mat_idx: int = 0,
    bevel: float = 0.0,
) -> list[bmesh.types.BMVert]:
    """Create a cylinder/cone strictly spanning p1 -> p2 in Three.js coordinates."""
    if r2 is None:
        r2 = r1
    a = v3(*p1_three)
    b = v3(*p2_three)
    axis = b - a
    length = axis.length
    if length < 1e-6:
        return []

    mid = (a + b) * 0.5
    z_vec = Vector((0.0, 0.0, 1.0))
    quat = z_vec.rotation_difference(axis.normalized())
    mat = Matrix.Translation(mid) @ quat.to_matrix().to_4x4()

    res = bmesh.ops.create_cone(
        bm,
        cap_ends=cap,
        cap_tris=False,
        segments=segs,
        radius1=r1,
        radius2=r2,
        depth=length,
        matrix=mat,
    )
    verts = res["verts"]
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.material_index = mat_idx
        f.smooth = True

    if bevel > 0.0 and cap:
        cap_edges = [e for f in faces if len(f.verts) > 4 for e in f.edges]
        if cap_edges:
            bres = bmesh.ops.bevel(
                bm,
                geom=cap_edges,
                offset=bevel,
                segments=2,
                profile=0.5,
                affect="EDGES",
                clamp_overlap=True,
            )
            for f in bres.get("faces", []):
                f.material_index = mat_idx
                f.smooth = True

    return verts


def add_revolved_profile(
    bm: bmesh.types.BMesh,
    profile_rx: list[tuple[float, float]],
    center_three: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segs: int = 48,
    closed_profile: bool = True,
    mat_idx: int = 0,
    flip: bool = False,
    axis_flip_x: bool = False,
    auto_orient: bool = True,
) -> list[list[bmesh.types.BMVert]]:
    """Revolve a 2D profile [(radius, x_offset), ...] around the X axis (Three.js wheel/hub axis)."""
    cx, cy, cz = center_three
    n_pts = len(profile_rx)
    p_max = n_pts if closed_profile else n_pts - 1
    x_dir = -1.0 if axis_flip_x else 1.0

    use_flip = flip
    if auto_orient and closed_profile and n_pts >= 3:
        rc = sum(r for r, _ in profile_rx) / n_pts
        xc = sum(x * x_dir for _, x in profile_rx) / n_pts
        orient_sum = 0.0
        for p in range(n_pts):
            r0, x0 = profile_rx[p]
            r1, x1 = profile_rx[(p + 1) % n_pts]
            x0d, x1d = x0 * x_dir, x1 * x_dir
            dr = r1 - r0
            dx = x1d - x0d
            r_mid = 0.5 * (r0 + r1)
            x_mid = 0.5 * (x0d + x1d)
            orient_sum += (x_mid - xc) * dr + (-(r_mid - rc)) * dx
        use_flip = orient_sum < 0.0

    rings: list[list[bmesh.types.BMVert]] = []
    for s in range(segs):
        ang = (s / segs) * 2.0 * math.pi
        ca = math.cos(ang)
        sa = math.sin(ang)
        ring: list[bmesh.types.BMVert] = []
        for r, x_off in profile_rx:
            ring.append(bm.verts.new(v3(cx + x_off * x_dir, cy + sa * r, cz + ca * r)))
        rings.append(ring)

    for s in range(segs):
        s_next = (s + 1) % segs
        for p in range(p_max):
            p_next = (p + 1) % n_pts
            v00 = rings[s][p]
            v10 = rings[s_next][p]
            v11 = rings[s_next][p_next]
            v01 = rings[s][p_next]
            quad = (v00, v01, v11, v10) if use_flip else (v00, v10, v11, v01)
            add_quad_or_tri(bm, quad, mat_idx)
    return rings


def add_tube(
    bm: bmesh.types.BMesh,
    pts_three: Sequence[tuple[float, float, float]],
    radius: float,
    ring_segs: int = 10,
    mat_idx: int = 0,
    cap: bool = True,
) -> None:
    """Sweep a smooth circular tube along 3D Three.js points using parallel transport frames."""
    pts = [v3(*p) for p in pts_three]
    if len(pts) < 2:
        return

    tangents = []
    for i in range(len(pts)):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        tangents.append(t)

    t0 = tangents[0]
    ref = Vector((0.0, 0.0, 1.0)) if abs(t0.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    n = t0.cross(ref).normalized()
    b = t0.cross(n).normalized()

    rings: list[list[bmesh.types.BMVert]] = []
    for i, p in enumerate(pts):
        if i > 0:
            rot = tangents[i - 1].rotation_difference(tangents[i])
            n = (rot @ n).normalized()
            b = tangents[i].cross(n).normalized()
        ring = []
        for s in range(ring_segs):
            a = (s / ring_segs) * 2.0 * math.pi
            offset = (n * math.cos(a) + b * math.sin(a)) * radius
            ring.append(bm.verts.new(p + offset))
        rings.append(ring)

    for i in range(len(rings) - 1):
        for s in range(ring_segs):
            sn = (s + 1) % ring_segs
            add_quad_or_tri(bm, (rings[i][s], rings[i][sn], rings[i + 1][sn], rings[i + 1][s]), mat_idx)

    if cap:
        add_quad_or_tri(bm, list(reversed(rings[0])), mat_idx)
        add_quad_or_tri(bm, rings[-1], mat_idx)


def add_curved_ribbon(
    bm: bmesh.types.BMesh,
    pts_three: Sequence[tuple[float, float, float]],
    normal_three: Sequence[tuple[float, float, float]],
    half_h: float,
    thickness: float,
    mat_idx: int = 0,
) -> None:
    """Create a solid rectangular-profile horizontal bar/trim strip swept along a 3D curve."""
    rings: list[list[bmesh.types.BMVert]] = []
    for (px, py, pz), (nx, ny, nz) in zip(pts_three, normal_three):
        n = Vector((nx, ny, nz)).normalized()
        # Cross section in Three.js space: outer top, outer bot, inner bot, inner top
        p_ot = (px + n.x * thickness, py + half_h, pz + n.z * thickness)
        p_ob = (px + n.x * thickness, py - half_h, pz + n.z * thickness)
        p_ib = (px, py - half_h, pz)
        p_it = (px, py + half_h, pz)
        rings.append([bm.verts.new(v3(*p)) for p in (p_ot, p_ob, p_ib, p_it)])

    for i in range(len(rings) - 1):
        for k in range(4):
            kn = (k + 1) % 4
            add_quad_or_tri(bm, (rings[i][k], rings[i + 1][k], rings[i + 1][kn], rings[i][kn]), mat_idx)
    # Caps
    add_quad_or_tri(bm, list(reversed(rings[0])), mat_idx)
    add_quad_or_tri(bm, rings[-1], mat_idx)


def assign_planar_uv(
    bm: bmesh.types.BMesh,
    face_filter: Callable[[bmesh.types.BMFace], bool],
    u_fn: Callable[[Vector], float],
    v_fn: Callable[[Vector], float],
) -> None:
    uv_layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        if face_filter(f):
            for loop in f.loops:
                co = loop.vert.co
                loop[uv_layer].uv = (u_fn(co), v_fn(co))


def create_object_from_bm(
    name: str,
    bm: bmesh.types.BMesh,
    materials: list[bpy.types.Material],
    parent: bpy.types.Object | None = None,
    loc_three: tuple[float, float, float] = (0.0, 0.0, 0.0),
    subsurf: int = 0,
    sharp_angle_deg: float | None = None,
    recalc_normals: bool = False,
) -> bpy.types.Object:
    if recalc_normals and len(bm.faces) > 0:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))

    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(mesh)
    bm.free()

    for m in materials:
        mesh.materials.append(m)

    obj = bpy.data.objects.new(name, mesh)
    obj.location = t2b(*loc_three)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    obj.scale = (1.0, 1.0, 1.0)

    if parent is not None:
        obj.parent = parent

    bpy.context.collection.objects.link(obj)

    if subsurf > 0:
        sub = obj.modifiers.new("Subsurf", "SUBSURF")
        sub.levels = subsurf
        sub.render_levels = subsurf
        sub.boundary_smooth = "PRESERVE_CORNERS"

    if sharp_angle_deg is not None:
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(sharp_angle_deg))
        obj.select_set(False)

    return obj


def create_empty(name: str, loc_three: tuple[float, float, float], parent: bpy.types.Object | None = None) -> bpy.types.Object:
    emp = bpy.data.objects.new(name, None)
    emp.empty_display_type = "PLAIN_AXES"
    emp.empty_display_size = 0.05
    emp.location = t2b(*loc_three)
    emp.rotation_euler = (0.0, 0.0, 0.0)
    emp.scale = (1.0, 1.0, 1.0)
    if parent is not None:
        emp.parent = parent
    bpy.context.collection.objects.link(emp)
    return emp


# ---------------------------------------------------------------------------
# Master VW Golf Mk7 Parametric Surface Functions (Single Source of Truth!)
# ---------------------------------------------------------------------------


def hood_half_width(tz: float) -> float:
    """Half-width of the Golf 7 hood from cowl (tz=0) to front headlight corner (tz=1)."""
    t = clamp(tz, 0.0, 1.0)
    return 0.722 - 0.095 * (t ** 1.30)


def hood_front_z_local(fx: float) -> float:
    """Curved leading edge of the hood in local hinge Z (seating flush onto grille and headlights!)."""
    af = clamp(abs(fx), 0.0, 1.0)
    return -1.264 + 0.130 * (af ** 2.05)


def hood_profile_world(lx: float, lz: float) -> float:
    """
    Golf Mk7 hood surface Y_world(lx, lz_local) relative to hinge (0, 0.94, -0.82).
    Seats flush right onto the top of the black upper grille (Y=0.686 at center) and headlights!
    """
    lz_max = -hood_front_z_local(0.0)
    tz = clamp(-lz / lz_max, 0.0, 1.0)
    hw = hood_half_width(tz)
    fx = clamp(lx / max(hw, 0.1), -1.0, 1.0)

    # Smooth slope down to Y=0.686 at center nose (eliminating gap above grille!)
    slope = -tz * 0.184 - (tz ** 2.30) * 0.074 + math.sin(tz * math.pi) * 0.020
    crown = (1.0 - (fx * fx)) * 0.024 * (1.0 - tz * 0.55)

    # Signature VW Golf Mk7 twin V-creases converging from A-pillar roots toward inner headlight corners
    crease_u = 0.76 - tz * 0.28
    dist_c = abs(abs(fx) - crease_u)
    crease_env = math.sin(clamp((tz - 0.03) / 0.92, 0.0, 1.0) * math.pi)
    v_crease = (max(0.0, 1.0 - dist_c / 0.095) ** 2.2) * 0.0085 * crease_env

    nose_tuck = -smoothstep(0.80, 1.0, tz) * 0.015

    return HOOD_HINGE_Y + 0.005 + slope + crown + v_crease + nose_tuck


def hood_badge_notch_lift(lx: float, tz: float) -> float:
    """Classic Golf Mk7 semicircular upward notch in the front hood lip framing the top of the VW badge."""
    if tz < 0.85 or abs(lx) >= 0.072:
        return 0.0
    u = abs(lx) / 0.072
    arc = math.sqrt(max(0.0, 1.0 - u * u))
    return smoothstep(0.85, 1.0, tz) * 0.028 * arc


def tornado_line_y(z: float) -> float:
    """Signature Golf 7 crisp shoulder character line rising subtly from front headlight to taillight."""
    u = clamp((z + 1.98) / 3.92, 0.0, 1.0)
    return 0.675 + u * 0.225


def beltline_y(z: float) -> float:
    """Upper window sill / front fender hood-seam height (matches hood outer edge seamlessly)."""
    if z <= HOOD_HINGE_Z:
        tz = clamp((HOOD_HINGE_Z - z) / 1.12, 0.0, 1.0)
        hw = hood_half_width(tz)
        return hood_profile_world(hw, z - HOOD_HINGE_Z) - 0.002
    u = clamp((z - HOOD_HINGE_Z) / (1.88 - HOOD_HINGE_Z), 0.0, 1.0)
    return 0.941 + u * 0.064


def body_plan_half_width(z: float) -> float:
    """Golf 7 plan-view half-width at widest flank (~0.874m mid-body)."""
    mid_bow = 0.009 * math.cos(clamp(z / 1.65, -1.0, 1.0) * math.pi * 0.5)
    base = 0.868 + mid_bow
    if z < -1.52:
        t = clamp((-1.52 - z) / 0.58, 0.0, 1.0)
        base -= 0.140 * (t ** 2.2)
    elif z > 1.52:
        t = clamp((z - 1.52) / 0.54, 0.0, 1.0)
        base -= 0.125 * (t ** 2.1)
    return base


def body_side_x(z: float, y: float, y_top: float | None = None) -> float:
    """
    Unified VW Golf Mk7 side-flank X(z, y) cross-section.
    Shared by front bumper cheek, front fender, doors, rear quarter, C-pillar base, and rear bumper
    so every welded seam is C1-smooth with zero steps!
    """
    if y_top is None:
        y_top = beltline_y(z)

    bw = body_plan_half_width(z)

    # Subtle, taut OEM wheel-arch eyebrow flare around both wheel cutouts
    for az in (FRONT_AXLE_Z, REAR_AXLE_Z):
        dz = z - az
        dy = y - ARCH_SPRING_Y
        r_ell = math.hypot(dz / 0.465, max(0.0, dy) / 0.495)
        if 0.72 < r_ell < 1.14 and y >= 0.24:
            bell = math.sin(clamp((1.14 - r_ell) / 0.42, 0.0, 1.0) * math.pi)
            bw += 0.017 * bell

    y_torn = tornado_line_y(z)

    if y < 0.245:
        t = clamp((0.245 - y) / 0.085, 0.0, 1.0)
        return bw - 0.036 * (t ** 1.25)
    if y < 0.46:
        # Subtle lower door reflection concave sculpt (creates authentic dark lower flank band)
        s = math.sin(((y - 0.245) / 0.215) * math.pi)
        return bw - 0.014 * s
    if y <= y_torn:
        p = (y - 0.46) / max(0.05, y_torn - 0.46)
        return bw + 0.012 * (p ** 0.85)

    # Clean tumblehome above Tornado Line up to beltline / hood edge
    span = max(0.04, y_top - y_torn)
    t_top = clamp((y - y_torn) / span, 0.0, 1.0)
    if z <= HOOD_HINGE_Z:
        # Smoothly blend outer flank shoulder directly into the hood edge width!
        tz = clamp((HOOD_HINGE_Z - z) / 1.12, 0.0, 1.0)
        x_hood_edge = hood_half_width(tz) + 0.008
        x_torn = bw + 0.012
        return lerp(x_torn, x_hood_edge, t_top ** 1.15)

    # Door & rear quarter upper shoulder tumblehome into window sill
    tuck = 0.108
    return bw + 0.012 - (t_top ** 1.15) * tuck


def front_fascia_xz(u: float, y: float) -> tuple[float, float]:
    """
    Unified smooth superelliptical front wraparound surface for u in [0.0, 1.0] (center -> front wheel arch edge).
    At u = 1.0, EXACTLY matches (body_side_x(FRONT_FENDER_SEAM_Z, y), FRONT_FENDER_SEAM_Z) for 100% seamless weld!
    """
    u = clamp(u, 0.0, 1.0)
    y_top_seam = beltline_y(FRONT_FENDER_SEAM_Z)
    x_seam = body_side_x(FRONT_FENDER_SEAM_Z, y, y_top_seam)
    z_seam = FRONT_FENDER_SEAM_Z  # -1.735

    # Vertical nose profile Z_center(y): crisp Golf 7 front bumper contour
    if y < 0.22:
        # Lower chin lip tucks slightly back at very bottom
        t = clamp((0.22 - y) / 0.05, 0.0, 1.0)
        z_nose = -2.104 + 0.022 * t
    elif y < 0.40:
        # Lower air dam plane rises slightly forward toward bumper shelf
        t = (y - 0.22) / 0.18
        z_nose = lerp(-2.104, -2.126, smoothstep(0.0, 1.0, t))
    elif y < 0.54:
        # License plate face (most forward point of bumper)
        t = (y - 0.40) / 0.14
        z_nose = -2.126 - math.sin(t * math.pi) * 0.008
    elif y < 0.61:
        # Crisp upper bumper shelf rolling back into grille & headlights (catches bright light-blue shelf reflection!)
        t = (y - 0.54) / 0.07
        z_nose = lerp(-2.126, -2.092, smoothstep(0.0, 1.0, t))
    else:
        # Upper grille / headlight / hood-nose plane slanting cleanly back
        t = clamp((y - 0.61) / 0.14, 0.0, 1.0)
        z_nose = lerp(-2.092, -2.048, t)

    # Superellipse wraparound (p = 2.65 gives VW's taut flat-ish center with smooth rounded corners)
    ang = u * (math.pi * 0.5)
    ca = math.cos(ang)
    sa = math.sin(ang)
    # Power curve: x goes 0 -> x_seam, z goes z_nose -> z_seam
    p_x = 0.74
    p_z = 0.78
    x = x_seam * (sa ** p_x)
    z = z_seam + (z_nose - z_seam) * (ca ** p_z)
    return x, z


def front_fascia_normal(u: float, y: float) -> tuple[float, float, float]:
    """Approximate outward unit normal (Three.js space) on front_fascia_xz."""
    du = 0.015
    u0 = max(0.0, u - du)
    u1 = min(1.0, u + du)
    x0, z0 = front_fascia_xz(u0, y)
    x1, z1 = front_fascia_xz(u1, y)
    # Tangent along +u is (dx, 0, dz); outward normal perpendicular in XZ facing -Z/+X is (-dz, 0, dx)
    nx, nz = -(z1 - z0), (x1 - x0)
    # Wait: as u increases from 0 -> 1, x increases (+), z increases (-2.1 -> -1.73, so dz > 0).
    # We want outward normal pointing toward (-Z, +X): (+dz, 0, -dx)!
    nx, nz = (z1 - z0), -(x1 - x0)
    ln = math.hypot(nx, nz)
    if ln < 1e-6:
        return (0.0, 0.0, -1.0)
    return (nx / ln, 0.0, nz / ln)


def rear_fascia_xz(u: float, y: float) -> tuple[float, float]:
    """
    Unified smooth wraparound rear bumper/tailgate corner for u in [0.0, 1.0] (center -> rear seam Z = +1.755).
    At u = 1.0, EXACTLY matches (body_side_x(REAR_BUMPER_SEAM_Z, y), REAR_BUMPER_SEAM_Z)!
    """
    u = clamp(u, 0.0, 1.0)
    y_top_seam = beltline_y(REAR_BUMPER_SEAM_Z)
    x_seam = body_side_x(REAR_BUMPER_SEAM_Z, min(y, y_top_seam), y_top_seam)
    z_seam = REAR_BUMPER_SEAM_Z  # +1.755

    if y < 0.28:
        t = clamp((0.28 - y) / 0.10, 0.0, 1.0)
        z_tail = lerp(2.045, 1.990, t)
    elif y < 0.56:
        t = (y - 0.28) / 0.28
        z_tail = 2.045 + math.sin(t * math.pi) * 0.026
    elif y < 0.64:
        # Subtle loading shelf step into tailgate
        t = (y - 0.56) / 0.08
        z_tail = lerp(2.045, 2.012, smoothstep(0.0, 1.0, t))
    else:
        # Tailgate sloping cleanly forward to rear glass base at y=1.00
        t = clamp((y - 0.64) / 0.365, 0.0, 1.0)
        z_tail = lerp(2.012, 1.875, t ** 1.35)

    ang = u * (math.pi * 0.5)
    sa = math.sin(ang)
    ca = math.cos(ang)
    x = x_seam * (sa ** 0.72)
    z = z_seam + (z_tail - z_seam) * (ca ** 0.76)
    return x, z


def roof_edge_xyz(z: float) -> tuple[float, float, float]:
    """Roof outer rail (x_edge, y_edge, center_camber) for z in [-0.24, +1.58]."""
    if z <= 1.44:
        tz = clamp((z - -0.24) / (1.44 - -0.24), 0.0, 1.0)
        x_e = 0.592 - tz * 0.022 + math.sin(tz * math.pi) * 0.012
        y_e = 1.404 + math.sin(tz * math.pi * 0.85) * 0.026 - tz * 0.026
        cam = 0.026 * (1.0 - 0.18 * tz)
    else:
        ts = clamp((z - 1.44) / 0.14, 0.0, 1.0)
        x_e = 0.570 - ts * 0.018
        y_e = 1.378 - ts * 0.012
        cam = 0.021 * (1.0 - ts * 0.25)
    return x_e, y_e, cam


def headlight_y_bounds(u: float) -> tuple[float, float]:
    """
    Signature VW Golf Mk7 angular rising halogen headlight upper & lower Y bounds on front_fascia_xz
    for u in [0.235, 0.86] (compact jet-black grille edge |X|=0.39 -> outer fender corner |X|=0.80).
    Crisp Golf 7 halogen height (~9.5-10cm), flush with hood edge & cleanly tucked beneath painted fender crown.
    """
    t = clamp((u - 0.235) / (0.86 - 0.235), 0.0, 1.0)
    y_bot = 0.592 + 0.064 * (t ** 1.65)
    y_top = 0.686 + 0.066 * (t ** 1.05)
    return y_bot, y_top


# ---------------------------------------------------------------------------
# 1. Golf7_BodyShell Builder (Seamless Welded Class-A Shell!)
# ---------------------------------------------------------------------------


def build_polar_arch_panel(
    bm: bmesh.types.BMesh,
    crease_layer: bmesh.types.BMLayerItem,
    axle_z: float,
    z_front: float,
    z_rear: float,
    y_bot_front: float,
    y_bot_rear: float,
    y_front_samples: list[float],
    y_rear_samples: list[float],
    get_top_y: Callable[[float], float],
    mat_idx: int = 0,
) -> None:
    """
    Build a smooth 100%-quad sculpted fender/quarter panel around a circular wheel arch cutout
    with EXACT matching vertical vertex heights on z_front and z_rear so adjacent bumper/door grids
    weld cleanly with ZERO gaps!
    """
    # Perimeter stations:
    # Front vertical edge: len(y_front_samples) points (bottom -> top)
    # Top edge: 10 intermediate points (z_front -> z_rear)
    # Rear vertical edge: len(y_rear_samples) points (top -> bottom)
    n_f = len(y_front_samples)
    n_r = len(y_rear_samples)
    n_top_mid = 9  # strictly interior top stations

    perim_out: list[tuple[float, float]] = []
    # Front edge bottom -> top (includes front-top corner)
    for y in y_front_samples:
        perim_out.append((z_front, y))
    # Top interior stations
    for k in range(1, n_top_mid + 1):
        f = k / (n_top_mid + 1)
        zo = lerp(z_front, z_rear, f)
        perim_out.append((zo, get_top_y(zo)))
    # Rear edge top -> bottom (includes rear-top corner)
    for y in reversed(y_rear_samples):
        perim_out.append((z_rear, y))

    n_perim = len(perim_out)

    # Map each perimeter station smoothly to the semicircular arch + vertical drops below springY
    # Index ranges: 0..1 front lower drop, 2..(n_perim-3) smooth arch 180->0 deg, (n_perim-2)..(n_perim-1) rear lower drop
    perim_in: list[tuple[float, float]] = []
    arc_start = 2
    arc_end = n_perim - 3
    n_arc = arc_end - arc_start
    for idx in range(n_perim):
        if idx == 0:
            perim_in.append((axle_z - ARCH_HALF_Z, y_bot_front))
        elif idx == 1:
            perim_in.append((axle_z - ARCH_HALF_Z, lerp(y_bot_front, ARCH_SPRING_Y, 0.55)))
        elif idx == n_perim - 2:
            perim_in.append((axle_z + ARCH_HALF_Z, lerp(y_bot_rear, ARCH_SPRING_Y, 0.55)))
        elif idx == n_perim - 1:
            perim_in.append((axle_z + ARCH_HALF_Z, y_bot_rear))
        else:
            frac = (idx - arc_start) / n_arc
            ang = math.pi * (1.0 - frac)
            zi = axle_z + ARCH_HALF_Z * math.cos(ang)
            yi = ARCH_SPRING_Y + (ARCH_CROWN_Y - ARCH_SPRING_Y) * math.sin(ang)
            perim_in.append((zi, yi))

    # 5 concentric rings:
    # Ring 0: inner rolled arch return flange (keeps FR cavity X <= 0.84 strictly open!)
    # Ring 1: crisp wheel-arch lip edge
    # Ring 2: smooth eyebrow crest (28%)
    # Ring 3: mid flank / Tornado Line (64%)
    # Ring 4: outer boundary matching adjacent bumper / door / beltline EXACTLY!
    ring_fracs = [0.0, 0.0, 0.28, 0.64, 1.0]
    grid: list[list[Vector]] = []
    for r_idx, frac in enumerate(ring_fracs):
        row: list[Vector] = []
        for p_idx in range(n_perim):
            zi, yi = perim_in[p_idx]
            zo, yo = perim_out[p_idx]
            z = lerp(zi, zo, frac)
            y = lerp(yi, yo, frac)
            top_ref = get_top_y(z)
            x = body_side_x(z, y, top_ref)

            if r_idx == 0:
                # Rolled sheet-metal arch flange inward 1.6 cm (stays X >= 0.848 at crown -> 0 FR cavity violations!)
                x -= 0.016
                if y >= ARCH_SPRING_Y:
                    y += 0.004
            elif r_idx == 1:
                x += 0.002

            row.append(v3(x, y, z))
        grid.append(row)

    add_loft_grid(
        bm,
        grid,
        mat_idx=mat_idx,
        closed_u=False,
        crease_layer=crease_layer,
        crease_rows={1: 0.72, 4: 0.25},
        crease_cols={0: 0.85, n_perim - 1: 0.85},
        outward_dir=Vector((1.0, 0.0, 0.0)),
        outward_rows=(1, 4),
    )


def build_body_shell(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    Build Golf7_BodyShell at t2b(0,0,0) with seamless welded Class-A exterior in Metallic Medium Blue,
    standard VW Golf Mk7 halogen headlights, narrow gloss-black grille with chrome strip & VW badge,
    horizontal slatted lower air dam, closed FL/RL/RR wheelhouses, open FR wheel-well cavity,
    seamless roof/A-pillars/C-pillars, realistic mirrors, doors, rear hatch, and 3 static alloy wheels.
    """
    root = create_empty("Golf7_BodyShell", (0.0, 0.0, 0.0))

    # Shared vertical stations at panel boundaries so bumper <-> fender <-> door <-> rear quarter <-> rear bumper weld 100%!
    y_front_seam = [0.174, 0.214, 0.268, 0.352, 0.435, 0.520, 0.592, 0.658, 0.752, beltline_y(FRONT_FENDER_SEAM_Z)]
    y_door_front = [0.164, 0.245, 0.340, 0.460, 0.580, 0.700, 0.795, 0.865, beltline_y(DOOR_FRONT_Z)]
    y_door_rear = [0.164, 0.245, 0.340, 0.460, 0.580, 0.710, 0.825, 0.905, beltline_y(DOOR_REAR_Z)]
    y_rear_seam = [0.192, 0.275, 0.385, 0.495, 0.605, 0.720, 0.835, 0.920, beltline_y(REAR_BUMPER_SEAM_Z)]

    # =========================================================================
    # 1. UNIFIED SEAMLESS PAINTED BODY SHELL (Golf7_Paint, welded + Subsurf 1)
    # =========================================================================
    bm_paint = bmesh.new()
    cr = bm_paint.edges.layers.float.new("crease_edge")

    # 1A. Front Fender Panel (Z = -1.735 .. -0.815) around FR wheel arch
    build_polar_arch_panel(
        bm_paint,
        cr,
        axle_z=FRONT_AXLE_Z,
        z_front=FRONT_FENDER_SEAM_Z,
        z_rear=DOOR_FRONT_Z,
        y_bot_front=0.174,
        y_bot_rear=0.164,
        y_front_samples=y_front_seam,
        y_rear_samples=y_door_front,
        get_top_y=beltline_y,
        mat_idx=0,
    )

    # Hood gutter inner return along front fender top edge (Z = -1.735 .. -0.815)
    gutter_zs = [lerp(FRONT_FENDER_SEAM_Z, DOOR_FRONT_Z, k / 10.0) for k in range(11)]
    gutter_grid: list[list[Vector]] = []
    for z in gutter_zs:
        yt = beltline_y(z)
        xt = body_side_x(z, yt, yt)
        gutter_grid.append([
            v3(xt - 0.026, yt - 0.015, z),
            v3(xt - 0.008, yt - 0.002, z),
            v3(xt, yt, z),
        ])
    add_loft_grid(
        bm_paint,
        gutter_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_cols={1: 0.70, 2: 0.55},
        outward_dir=Vector((0.0, 0.0, 1.0)),
    )

    # 1B. Continuous Front & Rear Door Flank (Z = -0.815 .. +0.855) — welds edge-for-edge to both fenders!
    door_zs = [lerp(DOOR_FRONT_Z, DOOR_REAR_Z, k / 16.0) for k in range(17)]
    door_grid: list[list[Vector]] = []
    for z in door_zs:
        t_z = (z - DOOR_FRONT_Z) / (DOOR_REAR_Z - DOOR_FRONT_Z)
        ys_col = [lerp(y_door_front[i], y_door_rear[i], t_z) for i in range(len(y_door_front))]
        ys_col[-1] = beltline_y(z)
        yt = ys_col[-1]
        col: list[Vector] = []
        # Inward rocker return lip
        col.append(v3(body_side_x(z, ys_col[0], yt) - 0.032, ys_col[0] - 0.004, z))
        for y in ys_col:
            col.append(v3(body_side_x(z, y, yt), y, z))
        # Top window sill inner return
        col.append(v3(body_side_x(z, yt, yt) - 0.030, yt - 0.008, z))
        door_grid.append(col)
    add_loft_grid(
        bm_paint,
        door_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_cols={1: 0.65, 7: 0.65, 9: 0.72},
        outward_dir=Vector((1.0, 0.0, 0.0)),
    )

    # 1C. Rear Quarter Panel (Z = +0.855 .. +1.755) around rear wheel arch — welds to door & rear bumper!
    build_polar_arch_panel(
        bm_paint,
        cr,
        axle_z=REAR_AXLE_Z,
        z_front=DOOR_REAR_Z,
        z_rear=REAR_BUMPER_SEAM_Z,
        y_bot_front=0.160,
        y_bot_rear=0.195,
        y_front_samples=y_door_rear,
        y_rear_samples=y_rear_seam,
        get_top_y=beltline_y,
        mat_idx=0,
    )

    # 1D. Seamless Wraparound Standard Golf VII Front Bumper & Fender Eyebrow (welds directly to FRONT_FENDER_SEAM_Z!)
    # Helper to build a conformal painted band on front_fascia_xz
    def add_front_band(
        u_list: list[float],
        y_fn_rows: list[Callable[[float], float]],
        crease_r: dict[int, float] | None = None,
        crease_c: dict[int, float] | None = None,
        inward_lip_top: float = 0.0,
        inward_lip_bot: float = 0.0,
    ) -> None:
        grid: list[list[Vector]] = []
        if inward_lip_bot > 0.0:
            row_b: list[Vector] = []
            for u in u_list:
                y = y_fn_rows[0](u)
                x, z = front_fascia_xz(u, y)
                nx, _, nz = front_fascia_normal(u, y)
                row_b.append(v3(x - nx * inward_lip_bot, y + 0.004, z - nz * inward_lip_bot))
            grid.append(row_b)
        for y_fn in y_fn_rows:
            row: list[Vector] = []
            for u in u_list:
                y = y_fn(u)
                x, z = front_fascia_xz(u, y)
                row.append(v3(x, y, z))
            grid.append(row)
        if inward_lip_top > 0.0:
            row_t: list[Vector] = []
            for u in u_list:
                y = y_fn_rows[-1](u)
                x, z = front_fascia_xz(u, y)
                nx, _, nz = front_fascia_normal(u, y)
                row_t.append(v3(x - nx * inward_lip_top, y - 0.004, z - nz * inward_lip_top))
            grid.append(row_t)
        add_loft_grid(
            bm_paint,
            grid,
            mat_idx=0,
            crease_layer=cr,
            crease_rows=crease_r or {},
            crease_cols=crease_c or {},
            outward_dir=Vector((0.25, 1.0, 0.0)),
        )

    # Full-width u stations matching exact Golf VII front opening geometry:
    # - Compact jet-black upper grille: u in [0.00 .. 0.235] (|X| <= 0.40 m -> realistic ~80cm VW grille!)
    # - Large angular rising halogen headlights: u in [0.235 .. 0.86] (|X| = 0.40 .. 0.80 m!)
    # - Wide lower slatted intake: u in [0.00 .. 0.52] (y = 0.214 .. 0.352)
    # - Sleek horizontal outer corner lamp recesses: u in [0.60 .. 0.85] (y = 0.268 .. 0.352)
    u_full = [0.0, 0.12, 0.235, 0.36, 0.46, 0.52, 0.56, 0.60, 0.70, 0.79, 0.86, 0.93, 1.0]

    # (i) Continuous Lower Painted Chin Valance (y = 0.174 .. 0.214) — full width meeting wheel arch!
    add_front_band(
        u_full,
        [lambda _u: 0.174, lambda _u: 0.194, lambda _u: 0.214],
        crease_r={1: 0.65, 3: 0.78},
        inward_lip_bot=0.032,
        inward_lip_top=0.024,
    )

    # (ii) Painted continuous lower cheek band BELOW outer corner lamp recesses (u = 0.52 .. 1.0, y = 0.214 .. 0.268)
    add_front_band(
        [0.52, 0.56, 0.60, 0.70, 0.79, 0.86, 0.93, 1.0],
        [lambda _u: 0.214, lambda _u: 0.242, lambda _u: 0.268],
        crease_r={0: 0.72, 2: 0.72},
        crease_c={0: 0.75},
    )

    # (iii) Slim painted divider between central slatted intake (u<=0.52) and outer corner lamp recess (u>=0.60)
    add_front_band(
        [0.52, 0.56, 0.60],
        [lambda _u: 0.268, lambda _u: 0.310, lambda _u: 0.352],
        crease_c={0: 0.75, 2: 0.75},
    )

    # (iv) Painted outer bumper corner cheek flanking outer corner lamp recess (u = 0.86 .. 1.0, y = 0.268 .. 0.352)
    add_front_band(
        [0.86, 0.93, 1.0],
        [lambda _u: 0.268, lambda _u: 0.310, lambda _u: 0.352],
        crease_c={0: 0.75},
    )

    # (v) Continuous Full-Width Mid Bumper (License Plate Area) & Upper Shelf directly under Grille & Headlights!
    def upper_shelf_top_y(u: float) -> float:
        if u <= 0.235:
            return 0.592
        if u <= 0.86:
            return headlight_y_bounds(u)[0]
        return lerp(headlight_y_bounds(0.86)[0], 0.658, (u - 0.86) / 0.14)

    add_front_band(
        u_full,
        [
            lambda _u: 0.352,
            lambda _u: 0.435,
            lambda _u: 0.520,
            upper_shelf_top_y,
        ],
        crease_r={0: 0.78, 2: 0.58, 3: 0.80},
        inward_lip_top=0.024,
    )

    # (vi) Outer Front Corner Painted Fender Cheek behind Headlight (u = 0.86 .. 1.00, y = 0.656 .. beltline_y(-1.735))
    def eyebrow_bot_y(u: float) -> float:
        if u <= 0.86:
            return headlight_y_bounds(u)[1]
        return lerp(headlight_y_bounds(0.86)[1], 0.752, (u - 0.86) / 0.14)

    def fender_nose_top_y(u: float) -> float:
        _, z_u = front_fascia_xz(u, 0.75)
        return beltline_y(clamp(z_u, -1.96, FRONT_FENDER_SEAM_Z))

    add_front_band(
        [0.86, 0.93, 1.0],
        [
            upper_shelf_top_y,
            lambda u: lerp(upper_shelf_top_y(u), eyebrow_bot_y(u), 0.5),
            eyebrow_bot_y,
            fender_nose_top_y,
        ],
        crease_r={3: 0.55},
        crease_c={0: 0.75},
    )

    # (vii) SEAMLESS Painted Fender Eyebrow Bridge ABOVE Headlight Outer Half (u = 0.56 .. 1.00)!
    # Smoothly blended into FRONT_FENDER_SEAM_Z with zero shading pinch!
    eb_us = [0.56, 0.63, 0.70, 0.77, 0.84, 0.90, 0.95, 1.0]
    eb_grid: list[list[Vector]] = []
    for u in eb_us:
        yb = eyebrow_bot_y(u)
        xb, zb = front_fascia_xz(u, yb)
        nx, _, nz = front_fascia_normal(u, yb)
        z_clamped = clamp(zb, -1.954, FRONT_FENDER_SEAM_Z)
        tz_u = clamp((HOOD_HINGE_Z - z_clamped) / 1.134, 0.0, 1.0)
        x_hood_e = hood_half_width(tz_u) + 0.004
        y_hood_e = hood_profile_world(x_hood_e, z_clamped - HOOD_HINGE_Z) - 0.001
        t_fade = smoothstep(0.56, 0.80, u)
        y_top_e = max(yb + 0.006, lerp(yb + 0.008, y_hood_e, t_fade))
        x_top_e = min(xb - 0.005, lerp(xb - 0.008, x_hood_e, t_fade))
        # Taper proud offset smoothly to 0 at u=1.0 so it meets FRONT_FENDER_SEAM_Z flush!
        out_off = 0.0025 * (1.0 - smoothstep(0.84, 1.0, u))
        xb_out = xb + nx * out_off
        zb_out = zb + nz * out_off
        x_mid = lerp(x_top_e, xb_out, 0.52)
        y_mid = lerp(y_top_e, yb, 0.48)
        eb_grid.append([
            v3(x_top_e - 0.015, y_top_e - 0.011, z_clamped),
            v3(x_top_e, y_top_e, z_clamped),
            v3(x_mid, y_mid, lerp(z_clamped, zb_out, 0.5)),
            v3(xb_out, yb, zb_out),
            v3(xb - nx * 0.018, yb - 0.007, zb - nz * 0.018),
        ])
    add_loft_grid(
        bm_paint,
        eb_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_cols={1: 0.65, 3: 0.65},
        outward_dir=Vector((0.5, 0.6, 0.8)),
    )

    # 1E. Seamless Wraparound Rear Bumper & Tailgate (welds edge-for-edge to REAR_BUMPER_SEAM_Z = +1.755!)
    u_rear = [0.0, 0.14, 0.28, 0.42, 0.56, 0.70, 0.82, 0.91, 1.0]

    # Rear painted bumper lower-to-mid wrap (y = 0.285 .. 0.605; matte valance sits cleanly at y = 0.185 .. 0.285)
    rb_ys = [0.285, 0.390, 0.500, 0.605]
    rb_grid: list[list[Vector]] = []
    # Bottom inward lip
    row_r_in: list[Vector] = []
    for u in u_rear:
        x, z = rear_fascia_xz(u, 0.285)
        row_r_in.append(v3(x * 0.96, 0.280, z - 0.025))
    rb_grid.append(row_r_in)
    for y in rb_ys:
        row: list[Vector] = []
        for u in u_rear:
            x, z = rear_fascia_xz(u, y)
            row.append(v3(x, y, z))
        rb_grid.append(row)
    # Top loading ledge step into tailgate
    row_ledge: list[Vector] = []
    for u in u_rear:
        x, z = rear_fascia_xz(u, 0.610)
        row_ledge.append(v3(x * 0.985, 0.612, z - 0.032))
    rb_grid.append(row_ledge)
    add_loft_grid(
        bm_paint,
        rb_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={1: 0.75, 4: 0.72, 5: 0.75},
        outward_dir=Vector((0.25, -1.0, 0.0)),
    )

    # Outer rear bumper corner skirt below 0.285 (u = 0.76 .. 1.00) closing smoothly down to 0.195 at rear wheel arch!
    rb_corner_grid: list[list[Vector]] = []
    for y in [0.195, 0.240, 0.285]:
        row = []
        for u in [0.76, 0.85, 0.93, 1.0]:
            x, z = rear_fascia_xz(u, y)
            row.append(v3(x, y, z))
        rb_corner_grid.append(row)
    add_loft_grid(
        bm_paint,
        rb_corner_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.75, 2: 0.65},
        outward_dir=Vector((0.5, -0.8, 0.0)),
    )

    # Rear tailgate & upper rear quarter wrap (y = 0.605 .. beltline_y(1.755) ~ 1.00)
    tg_ys = [0.605, 0.720, 0.835, 0.920, beltline_y(REAR_BUMPER_SEAM_Z)]
    tg_grid: list[list[Vector]] = []
    for y in tg_ys:
        row = []
        for u in u_rear:
            x, z = rear_fascia_xz(u, y)
            row.append(v3(x, y, z))
        tg_grid.append(row)
    # Upper tailgate rabbet tucked cleanly beneath rear hatch glass
    row_tg_in: list[Vector] = []
    for u in u_rear:
        x, z = rear_fascia_xz(u, tg_ys[-1])
        row_tg_in.append(v3(x * 0.96, tg_ys[-1] - 0.008, z - 0.030))
    tg_grid.append(row_tg_in)
    add_loft_grid(
        bm_paint,
        tg_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.72, 2: 0.45, 4: 0.75},
        outward_dir=Vector((0.25, -1.0, 0.0)),
    )

    # 1F. SEAMLESS GREENHOUSE: Continuous Roof + Front Windshield Header + 3D A-Pillars + Classic Wide C-Pillars!
    roof_zs = [-0.24, -0.06, 0.16, 0.42, 0.70, 0.98, 1.24, 1.44, 1.56]
    roof_grid: list[list[Vector]] = []
    # Front windshield header return lip (closes top of windshield 100% — zero gap!)
    xe0, ye0, cam0 = roof_edge_xyz(roof_zs[0])
    hdr_row: list[Vector] = []
    for ix in range(7):
        fx = ix / 6.0
        x = fx * xe0
        y = ye0 + cam0 * (1.0 - fx * fx) - 0.022
        hdr_row.append(v3(x, y, roof_zs[0] - 0.016))
    hdr_row.append(v3(xe0 + 0.006, ye0 - 0.032, roof_zs[0] - 0.010))
    roof_grid.append(hdr_row)

    for z in roof_zs:
        xe, ye, cam = roof_edge_xyz(z)
        row = []
        for ix in range(7):
            fx = ix / 6.0
            x = fx * xe
            y = ye + cam * (1.0 - fx * fx)
            row.append(v3(x, y, z))
        # Outer cant-rail lip wrapping smoothly down over top of side glass
        row.append(v3(xe + 0.010, ye - 0.028, z))
        roof_grid.append(row)

    # Rear roof spoiler trailing return lip closing cleanly into rear hatch glass top
    xe_s, ye_s, cam_s = roof_edge_xyz(roof_zs[-1])
    sp_ret: list[Vector] = []
    for ix in range(7):
        fx = ix / 6.0
        x = fx * xe_s
        y = ye_s + cam_s * (1.0 - fx * fx) - 0.020
        sp_ret.append(v3(x, y, roof_zs[-1] - 0.020))
    sp_ret.append(v3(xe_s + 0.004, ye_s - 0.034, roof_zs[-1] - 0.018))
    roof_grid.append(sp_ret)

    add_loft_grid(
        bm_paint,
        roof_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={1: 0.72, len(roof_grid) - 2: 0.75},
        crease_cols={6: 0.58, 7: 0.80},
        outward_dir=Vector((0.0, 0.0, 1.0)),
        outward_rows=(1, len(roof_grid) - 2),
    )

    # Sculpted Solid 3D A-Pillar seamlessly bridging front fender/cowl (Z=-0.825) to roof front corner (Z=-0.235)!
    ap_steps = 10
    ap_grid: list[list[Vector]] = []
    x_ap_bot = body_side_x(DOOR_FRONT_Z, beltline_y(DOOR_FRONT_Z), beltline_y(DOOR_FRONT_Z))
    y_ap_bot = beltline_y(DOOR_FRONT_Z)
    x_ap_top, y_ap_top, _ = roof_edge_xyz(-0.235)
    for i in range(ap_steps + 1):
        t = i / ap_steps
        z = lerp(DOOR_FRONT_Z - 0.008, -0.235, t)
        # Slight elegant outward bow on A-pillar matching VW Golf 7 windshield curvature
        bow_y = math.sin(t * math.pi) * 0.016
        bow_x = math.sin(t * math.pi) * 0.012
        y_o = lerp(y_ap_bot - 0.006, y_ap_top, t) + bow_y
        x_o = lerp(x_ap_bot, x_ap_top, t) + bow_x
        w_p = lerp(0.068, 0.056, t)

        # Clean closed 5-point aerodynamic A-pillar beam section
        p0 = v3(x_o - w_p, y_o - 0.008, z + 0.016)       # inner windshield rabbet
        p1 = v3(x_o - w_p * 0.72, y_o + 0.004, z - 0.002) # front-inner crest
        p2 = v3(x_o, y_o + 0.002, z)                      # crisp outer A-pillar highlight edge
        p3 = v3(x_o + 0.010, y_o - 0.024, z + 0.012)      # outer side-window rabbet
        p4 = v3(x_o - w_p * 0.45, y_o - 0.044, z + 0.036) # inner cabin backing
        ap_grid.append([p0, p1, p2, p3, p4, p0])
    add_loft_grid(
        bm_paint,
        ap_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.90, ap_steps: 0.90},
        crease_cols={1: 0.45, 2: 0.58, 3: 0.70},
        flip=False,
    )

    # Iconic Seamless VW Golf Mk7 Wide C-Pillar!
    # Bottom edge evaluates EXACT rear quarter beltline X/Y (ZERO step!), top edge joins roof rail & rear spoiler!
    cp_rows = 10
    cp_grid: list[list[Vector]] = []
    for ir in range(cp_rows):
        v = ir / (cp_rows - 1)
        sv = smoothstep(0.0, 1.0, v)
        z_f = lerp(0.955, 1.165, sv)   # rear side window rear border (classic Golf hockey-stick slope!)
        z_r = lerp(1.845, 1.545, sv)   # rear hatch glass side border
        zs = [lerp(z_f, z_r, k / 4.0) for k in range(5)]

        outer_pts: list[tuple[float, float, float]] = []
        for idx_z, zc in enumerate(zs):
            x_re, y_re, _ = roof_edge_xyz(clamp(zc, 0.95, 1.56))
            yb = beltline_y(clamp(zc, DOOR_REAR_Z, REAR_BUMPER_SEAM_Z))
            # At rear edge (zc > REAR_BUMPER_SEAM_Z), follow rear_fascia_xz smoothly!
            if zc <= REAR_BUMPER_SEAM_Z:
                xb = body_side_x(zc, yb, yb)
            else:
                # Blend gracefully along upper rear corner
                u_back = clamp(1.0 - (zc - REAR_BUMPER_SEAM_Z) / 0.135, 0.62, 1.0)
                xb, _ = rear_fascia_xz(u_back, yb)
            y = lerp(yb - 0.004, y_re - 0.004, v)
            x = lerp(xb, x_re + 0.002, v) + 0.003 * math.sin(v * math.pi)
            if idx_z == 4:
                # Wrap cleanly around the rear glass side edge
                x -= 0.014 * (1.0 - 0.35 * v)
            outer_pts.append((x, y, zc))

        xf, yf, zf = outer_pts[0]
        xr, yr, zr = outer_pts[-1]
        ring_v = [v3(xf - 0.045, yf - 0.010, zf + 0.014)]
        for (px, py, pz) in outer_pts:
            ring_v.append(v3(px, py, pz))
        ring_v.append(v3(xr - 0.058, yr - 0.012, zr - 0.012))
        ring_v.append(v3(lerp(xf, xr, 0.5) - 0.055, lerp(yf, yr, 0.5) - 0.016, lerp(zf, zr, 0.5)))
        ring_v.append(ring_v[0])
        cp_grid.append(ring_v)

    add_loft_grid(
        bm_paint,
        cp_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.90, cp_rows - 1: 0.90},
        crease_cols={1: 0.65, 5: 0.68},
        flip=False,
    )

    # 1G. Sleek Contoured Golf VII Door Handles (body-colored curved pull-straps along Tornado Line!)
    for hz in (-0.08, 0.69):
        hy = tornado_line_y(hz) - 0.010
        hx = body_side_x(hz, hy, beltline_y(hz))
        # Curved ergonomic door pull grip bar
        dh_grid: list[list[Vector]] = []
        for iz in range(7):
            f = iz / 6.0
            zz = hz + (f - 0.5) * 0.155
            arch_out = math.sin(f * math.pi) * 0.018 + 0.005
            cx = body_side_x(zz, hy, beltline_y(zz)) + arch_out
            dh_grid.append([
                v3(cx - 0.012, hy + 0.011, zz),
                v3(cx + 0.006, hy + 0.012, zz),
                v3(cx + 0.008, hy, zz),
                v3(cx + 0.006, hy - 0.012, zz),
                v3(cx - 0.012, hy - 0.011, zz),
                v3(cx - 0.012, hy + 0.011, zz),
            ])
        add_loft_grid(bm_paint, dh_grid, mat_idx=0, crease_layer=cr, crease_rows={0: 0.85, 6: 0.85}, flip=False)

    # 1H. Contoured Aerodynamic VW Golf VII Painted Side Mirror Cap (upper blue shell matching photo!)
    mir_grid: list[list[Vector]] = []
    for ix in range(8):
        f = ix / 7.0
        mx = lerp(0.812, 1.005, f)
        taper = math.sin(clamp(f * 0.85 + 0.15, 0.0, 1.0) * math.pi) ** 0.50
        if f > 0.76:
            taper *= lerp(1.0, 0.36, (f - 0.76) / 0.24)
        my_c = 0.986 + 0.018 * f - 0.005 * (f * f)
        mz_c = -0.640 + 0.050 * (f ** 1.22)
        h_up = 0.056 * taper + 0.008
        h_dn = 0.020 * taper + 0.005
        d_fw = 0.054 * taper + 0.010
        d_bk = 0.048 * taper + 0.008
        mir_grid.append([
            v3(mx, my_c - h_dn, mz_c + d_bk),
            v3(mx, my_c + h_up * 0.58, mz_c + d_bk * 0.95),
            v3(mx, my_c + h_up, mz_c + d_bk * 0.08),
            v3(mx, my_c + h_up * 0.65, mz_c - d_fw * 0.76),
            v3(mx, my_c - h_dn * 0.12, mz_c - d_fw),
            v3(mx, my_c - h_dn, mz_c - d_fw * 0.65),
            v3(mx, my_c - h_dn, mz_c + d_bk),
        ])
    add_loft_grid(bm_paint, mir_grid, mat_idx=0, crease_layer=cr, crease_rows={0: 0.7, 7: 0.7}, flip=False)

    # Weld shared seam edges BEFORE mirroring, then mirror cleanly across X=0!
    bmesh.ops.remove_doubles(bm_paint, verts=list(bm_paint.verts), dist=0.0025)
    mirror_bmesh_x(bm_paint, crease_layer=cr, weld_dist=0.0015)

    create_object_from_bm(
        "BodyShell_Paint",
        bm_paint,
        [mats["paint"]],
        parent=root,
        subsurf=1,
        recalc_normals=False,
    )

    # =========================================================================
    # 2. FLUSH AUTOMOTIVE GLASS + BLACK CERAMIC FRIT BORDERS
    # =========================================================================
    bm_glass = bmesh.new()
    # Mat indices: 0=glass, 1=glass_frit

    # 2A. Curved Laminated Windshield tucked seamlessly inside A-pillars, roof header & cowl
    ws_rows, ws_cols = 10, 14
    ws_grid: list[list[Vector]] = []
    for ir in range(ws_rows):
        t = ir / (ws_rows - 1)
        z_base = lerp(DOOR_FRONT_Z - 0.005, -0.238, t)
        y = lerp(0.928, 1.402, t) + math.sin(t * math.pi) * 0.015
        hw = lerp(0.695, 0.555, t) + math.sin(t * math.pi) * 0.010
        row = []
        for ic in range(ws_cols):
            fx = (ic / (ws_cols - 1)) * 2.0 - 1.0
            x = fx * hw
            z = z_base - (1.0 - fx * fx) * 0.032 * (0.45 + 0.55 * math.sin(t * math.pi))
            row.append(v3(x, y, z))
        ws_grid.append(row)
    add_loft_grid(bm_glass, ws_grid, mat_idx=0, outward_dir=Vector((0.0, 0.75, 0.65)))

    # Black ceramic windshield frit frame (top, bottom, and sides)
    for ir in range(ws_rows - 1):
        for ic in range(ws_cols - 1):
            is_border = (ir == 0) or (ir == ws_rows - 2) or (ic == 0) or (ic == ws_cols - 2)
            if is_border:
                pass
    # Assign frit material directly to outer border quads of windshield
    bm_glass.faces.ensure_lookup_table()
    # Quick exact frit strips on top/bottom/sides of windshield
    for f in bm_glass.faces:
        c = f.calc_center_median()
        # Blender coords: c.z is Y_three, -c.y is Z_three
        if c.z < 0.965 or c.z > 1.375:
            f.material_index = 1
        else:
            t_est = clamp((c.z - 0.928) / (1.402 - 0.928), 0.0, 1.0)
            hw_est = lerp(0.695, 0.555, t_est) + math.sin(t_est * math.pi) * 0.010
            if abs(c.x) > hw_est - 0.042:
                f.material_index = 1

    # Rearview mirror ceramic patch + interior mirror stalk/head behind windshield
    add_beveled_box(bm_glass, (0.0, 1.305, -0.365), (0.065, 0.075, 0.012), (0.72, 0.0, 0.0), mat_idx=1, bevel=0.004)

    # 2B. Curved Rear Hatch Glass tucked flush into C-pillars, roof spoiler & tailgate top
    rg_grid: list[list[Vector]] = []
    for ir in range(8):
        fy = ir / 7.0
        y = lerp(0.996, 1.372, fy)
        hw = lerp(0.640, 0.538, fy)
        z_base = lerp(1.862, 1.540, fy)
        row = []
        for ic in range(10):
            fx = (ic / 9.0) * 2.0 - 1.0
            x = fx * hw
            z = z_base + (1.0 - fx * fx) * 0.028
            row.append(v3(x, y, z))
        rg_grid.append(row)
    n_before_rg = len(bm_glass.faces)
    add_loft_grid(bm_glass, rg_grid, mat_idx=0, outward_dir=Vector((0.0, -0.75, 0.65)))
    bm_glass.faces.ensure_lookup_table()
    for f in bm_glass.faces[n_before_rg:]:
        c = f.calc_center_median()
        if c.z < 1.028 or c.z > 1.345:
            f.material_index = 1
        else:
            fy_e = clamp((c.z - 0.996) / (1.372 - 0.996), 0.0, 1.0)
            hw_e = lerp(0.640, 0.538, fy_e)
            if abs(c.x) > hw_e - 0.048:
                f.material_index = 1

    # 2C. Flush Side Greenhouse Windows (matching exact A-pillar -> roof rail -> C-pillar -> beltline)
    for side in (1.0, -1.0):
        sg_grid: list[list[Vector]] = []
        for ir in range(6):
            fy = ir / 5.0
            zf = lerp(DOOR_FRONT_Z + 0.015, -0.225, fy) + math.sin(fy * math.pi) * 0.014
            zr = lerp(0.965, 1.175, smoothstep(0.0, 1.0, fy))
            row = []
            for ic in range(12):
                fz = ic / 11.0
                z = lerp(zf, zr, fz)
                x_re, y_re, _ = roof_edge_xyz(clamp(z, -0.24, 1.44))
                yb = beltline_y(z)
                y = lerp(yb - 0.014, y_re - 0.016, fy)
                xb = body_side_x(z, yb, yb) - 0.012
                xt = x_re - 0.008
                x = side * (lerp(xb, xt, fy) + 0.012 * math.sin(fy * math.pi))
                row.append(v3(x, y, z))
            sg_grid.append(row)
        add_loft_grid(bm_glass, sg_grid, mat_idx=0, outward_dir=Vector((side, 0.0, 0.0)))

    create_object_from_bm("BodyShell_Glass", bm_glass, [mats["glass"], mats["glass_frit"]], parent=root, recalc_normals=False)

    # =========================================================================
    # 3. EXTERIOR TRIM, NARROW UPPER GRILLE + CHROME BAR, VW BADGES, SLATTED LOWER INTAKE,
    #    DOOR SHUT LINES, MIRROR BASES, CLOSED FL/RL/RR WHEELHOUSES
    # =========================================================================
    bm_trim = bmesh.new()
    # Mat indices: 0=gloss_black, 1=matte_trim, 2=chrome, 3=mirror_glass, 4=panel_seam

    # 3A. Narrow Jet-Black Upper Mk7 Radiator Grille + Single Horizontal Chrome Strip (Matching Photo!)
    u_gr = [k / 12.0 * 0.242 for k in range(-12, 13)]
    # Deep recessed jet-black grille backing plate following exact front_fascia_xz (sealed tightly up to hood!)
    gr_back: list[list[Vector]] = []
    for y in [0.596, 0.646, 0.700]:
        row = []
        for u in u_gr:
            s_sign = -1.0 if u < 0 else 1.0
            x, z = front_fascia_xz(abs(u), y)
            nx, _, nz = front_fascia_normal(abs(u), y)
            row.append(v3(s_sign * (x - nx * 0.024), y, z - nz * 0.024))
        gr_back.append(row)
    add_loft_grid(bm_trim, gr_back, mat_idx=1, outward_dir=Vector((0.0, 1.0, 0.0)))

    # Top & mid slim jet-black grille louvers + ONE razor-sharp polished Chrome lower trim strip!
    for y_bar, hh, thk, m_idx in [
        (0.678, 0.005, 0.018, 0),  # top jet-black louver
        (0.644, 0.005, 0.016, 0),  # center jet-black louver
        (0.608, 0.0068, 0.024, 2), # SIGNATURE VW Golf 7 horizontal Chrome lower grille trim strip!
    ]:
        pts_b = []
        nrm_b = []
        for u in u_gr:
            s_sign = -1.0 if u < 0 else 1.0
            x, z = front_fascia_xz(abs(u), y_bar)
            nx, _, nz = front_fascia_normal(abs(u), y_bar)
            pts_b.append((s_sign * (x - nx * 0.018), y_bar, z - nz * 0.018))
            nrm_b.append((s_sign * nx, 0.0, nz))
        add_curved_ribbon(bm_trim, pts_b, nrm_b, half_h=hh, thickness=thk, mat_idx=m_idx)

    # 3B. Prominent 3D VW Front & Rear Emblems (Crisp Chrome Ring + Gloss-Black Backing + Authentic VW Monogram!)
    def add_3d_vw_emblem(center_three: tuple[float, float, float], radius: float, facing_sign: int) -> None:
        cx, cy, cz = center_three
        dz = facing_sign * 0.016
        add_cylinder_between(bm_trim, (cx, cy, cz), (cx, cy, cz + dz), radius, radius * 0.98, segs=36, mat_idx=0, bevel=0.003)
        n_ring = 36
        ring_pts = [
            (
                cx + math.cos(k * 2.0 * math.pi / n_ring) * (radius - 0.004),
                cy + math.sin(k * 2.0 * math.pi / n_ring) * (radius - 0.004),
                cz + dz + facing_sign * 0.003,
            )
            for k in range(n_ring + 1)
        ]
        add_tube(bm_trim, ring_pts, radius * 0.095, ring_segs=8, mat_idx=2, cap=False)
        z_fg = cz + dz + facing_sign * 0.0045
        s = radius * 0.80
        vw_strokes = [
            ((-0.44 * s, 0.74 * s), (0.0, 0.04 * s)),
            ((0.44 * s, 0.74 * s), (0.0, 0.04 * s)),
            ((-0.78 * s, 0.44 * s), (-0.32 * s, -0.76 * s)),
            ((-0.32 * s, -0.76 * s), (0.0, -0.09 * s)),
            ((0.0, -0.09 * s), (0.32 * s, -0.76 * s)),
            ((0.32 * s, -0.76 * s), (0.78 * s, 0.44 * s)),
        ]
        for p0, p1 in vw_strokes:
            add_tube(
                bm_trim,
                [(cx + p0[0], cy + p0[1], z_fg), (cx + p1[0], cy + p1[1], z_fg)],
                radius * 0.092,
                ring_segs=8,
                mat_idx=2,
            )

    # Front VW emblem centered cleanly in the upper grille & hood semicircle notch
    add_3d_vw_emblem((0.0, 0.650, -2.078), 0.066, -1)
    # Rear VW tailgate hatch handle emblem
    add_3d_vw_emblem((0.0, 0.875, 1.946), 0.056, +1)

    # 3C. Wide Standard Golf VII Lower Air Intake with Dark Matte Horizontal Slats + Sealed Side Walls!
    u_low = [k / 14.0 * 0.532 for k in range(-14, 15)]
    low_back: list[list[Vector]] = []
    for y in [0.210, 0.282, 0.356]:
        row = []
        for u in u_low:
            s_sign = -1.0 if u < 0 else 1.0
            x, z = front_fascia_xz(abs(u), y)
            nx, _, nz = front_fascia_normal(abs(u), y)
            row.append(v3(s_sign * (x - nx * 0.045), y, z - nz * 0.045))
        low_back.append(row)
    add_loft_grid(bm_trim, low_back, mat_idx=1, outward_dir=Vector((0.0, 1.0, 0.0)))
    # Seal left & right side walls of lower intake opening so zero background light leaks!
    for side in (1.0, -1.0):
        sw_g: list[list[Vector]] = []
        for y in [0.210, 0.282, 0.356]:
            x, z = front_fascia_xz(0.525, y)
            nx, _, nz = front_fascia_normal(0.525, y)
            sw_g.append([
                v3(side * (x - nx * 0.045), y, z - nz * 0.045),
                v3(side * (x + nx * 0.002), y, z + nz * 0.002),
            ])
        add_loft_grid(bm_trim, sw_g, mat_idx=1, outward_dir=Vector((-side, 0.0, 0.0)))

    # 3 crisp horizontal dark matte-black slats (waagerechte dunkle Lamellen) curving conformally with bumper!
    for y_slat in (0.244, 0.283, 0.322):
        pts_s = []
        nrm_s = []
        for u in u_low:
            s_sign = -1.0 if u < 0 else 1.0
            x, z = front_fascia_xz(abs(u), y_slat)
            nx, _, nz = front_fascia_normal(abs(u), y_slat)
            pts_s.append((s_sign * (x - nx * 0.036), y_slat, z - nz * 0.036))
            nrm_s.append((s_sign * nx, 0.0, nz))
        add_curved_ribbon(bm_trim, pts_s, nrm_s, half_h=0.0058, thickness=0.026, mat_idx=1)

    # Discreet matte-black under-bumper aero chin strip (tucked cleanly under painted lower lip)
    chin_grid: list[list[Vector]] = []
    for y_c, inset in ((0.160, 0.028), (0.176, 0.014), (0.176, 0.056)):
        row = []
        for k in range(-14, 15):
            u = k / 14.0 * 0.96
            s_sign = -1.0 if u < 0 else 1.0
            x, z = front_fascia_xz(abs(u), 0.176)
            nx, _, nz = front_fascia_normal(abs(u), 0.176)
            row.append(v3(s_sign * (x - nx * inset), y_c, z - nz * inset))
        chin_grid.append(row)
    add_loft_grid(bm_trim, chin_grid, mat_idx=1, outward_dir=Vector((0.0, 1.0, -0.2)))

    # 3D. Sleek Horizontal Recessed Outer Lower Corner Housings (u = 0.595 .. 0.865, y = 0.266 .. 0.354)
    for side in (1.0, -1.0):
        u_cor = [lerp(0.595, 0.865, k / 7.0) for k in range(8)]
        cor_back: list[list[Vector]] = []
        for y in [0.266, 0.310, 0.354]:
            row = []
            for u in u_cor:
                x, z = front_fascia_xz(u, y)
                nx, _, nz = front_fascia_normal(u, y)
                row.append(v3(side * (x - nx * 0.036), y, z - nz * 0.036))
            cor_back.append(row)
        add_loft_grid(bm_trim, cor_back, mat_idx=1, outward_dir=Vector((side * 0.6, 0.8, 0.0)))
        # Side closing walls for corner lamp recess
        for u_end, dir_s in [(0.595, side), (0.865, -side)]:
            cw_g: list[list[Vector]] = []
            for y in [0.266, 0.310, 0.354]:
                x, z = front_fascia_xz(u_end, y)
                nx, _, nz = front_fascia_normal(u_end, y)
                cw_g.append([
                    v3(side * (x - nx * 0.036), y, z - nz * 0.036),
                    v3(side * (x + nx * 0.002), y, z + nz * 0.002),
                ])
            add_loft_grid(bm_trim, cw_g, mat_idx=1, outward_dir=Vector((dir_s, 0.0, 0.0)))

        # Crisp dark horizontal louver fin above/below sleek corner lamp
        for y_fin in (0.280, 0.338):
            pts_f = []
            nrm_f = []
            for u in u_cor:
                x, z = front_fascia_xz(u, y_fin)
                nx, _, nz = front_fascia_normal(u, y_fin)
                pts_f.append((side * (x - nx * 0.026), y_fin, z - nz * 0.026))
                nrm_f.append((side * nx, 0.0, nz))
            add_curved_ribbon(bm_trim, pts_f, nrm_f, half_h=0.0045, thickness=0.016, mat_idx=1)

    # 3E. Side Greenhouse Trim, Mirror Triangles/Lower Housings/Glass, Door Shut Lines & Finger Pockets
    for side in (1.0, -1.0):
        # Gloss-black B-pillar applique conforming smoothly to side window curve
        bp_grid: list[list[Vector]] = []
        for ir in range(6):
            fy = ir / 5.0
            row = []
            for z in (0.005, 0.062, 0.118):
                x_re, y_re, _ = roof_edge_xyz(z)
                yb = beltline_y(z)
                y = lerp(yb - 0.006, y_re - 0.012, fy)
                xb = body_side_x(z, yb, yb) - 0.006
                xt = x_re - 0.003
                x = side * (lerp(xb, xt, fy) + 0.012 * math.sin(fy * math.pi))
                row.append(v3(x, y, z))
            bp_grid.append(row)
        add_loft_grid(bm_trim, bp_grid, mat_idx=0, outward_dir=Vector((side, 0.0, 0.0)))

        # Slim gloss-black rear quarter glass vertical divider bar
        rqd_grid: list[list[Vector]] = []
        for ir in range(6):
            fy = ir / 5.0
            row = []
            for z in (0.838, 0.864):
                x_re, y_re, _ = roof_edge_xyz(z)
                yb = beltline_y(z)
                y = lerp(yb - 0.006, y_re - 0.012, fy)
                xb = body_side_x(z, yb, yb) - 0.006
                xt = x_re - 0.003
                x = side * (lerp(xb, xt, fy) + 0.012 * math.sin(fy * math.pi))
                row.append(v3(x, y, z))
            rqd_grid.append(row)
        add_loft_grid(bm_trim, rqd_grid, mat_idx=0, outward_dir=Vector((side, 0.0, 0.0)))

        # Front A-pillar quarter glass thin black divider bar (authentic Golf Mk7 detail!)
        fqd_grid: list[list[Vector]] = []
        for ir in range(5):
            fy = ir / 4.0
            row = []
            for z in (-0.618, -0.596):
                x_re, y_re, _ = roof_edge_xyz(-0.24)
                yb = beltline_y(z)
                y_max_a = lerp(0.94, 1.40, clamp((z - DOOR_FRONT_Z) / (-0.235 - DOOR_FRONT_Z), 0.0, 1.0))
                y = lerp(yb - 0.004, y_max_a - 0.008, fy)
                t_g = clamp((y - yb) / (1.40 - yb), 0.0, 1.0)
                x = side * (lerp(body_side_x(z, yb, yb) - 0.006, x_re - 0.003, t_g) + 0.010 * math.sin(t_g * math.pi))
                row.append(v3(x, y, z))
            fqd_grid.append(row)
        add_loft_grid(bm_trim, fqd_grid, mat_idx=0, outward_dir=Vector((side, 0.0, 0.0)))

        # Matte-black window beltline rubber weatherstrip running seamlessly along window sill
        ws_pts = []
        ws_nrm = []
        for k in range(15):
            z = lerp(DOOR_FRONT_Z + 0.02, 0.96, k / 14.0)
            yb = beltline_y(z)
            xb = body_side_x(z, yb, yb) - 0.004
            ws_pts.append((side * xb, yb - 0.003, z))
            ws_nrm.append((side, 0.0, 0.0))
        add_curved_ribbon(bm_trim, ws_pts, ws_nrm, half_h=0.009, thickness=0.008, mat_idx=1)

        # Mirror black mounting triangle base, sleek stalk, lower black housing & mirror glass
        add_beveled_box(bm_trim, (side * 0.770, 0.944, -0.665), (0.055, 0.036, 0.095), (0.0, side * 0.15, side * 0.28), mat_idx=1, bevel=0.006)
        add_beveled_box(bm_trim, (side * 0.822, 0.958, -0.648), (0.085, 0.024, 0.056), (0.0, side * -0.14, side * 0.16), mat_idx=1, bevel=0.006)
        # Lower matte-black underside of mirror shell
        add_beveled_box(bm_trim, (side * 0.902, 0.964, -0.616), (0.140, 0.020, 0.078), (0.0, side * -0.22, side * 0.06), mat_idx=1, bevel=0.008)
        # Reflective mirror glass inset in rearward face
        add_beveled_box(bm_trim, (side * 0.905, 0.985, -0.576), (0.128, 0.056, 0.007), (0.0, side * -0.22, side * 0.06), mat_idx=3)

        # Razor-clean Door Shut Lines (Türfugen — flush 3mm dark shadow lines following exact flank curvature!)
        # 1. Front door front seam (Z = -0.805)
        # 2. Front/rear door center B-pillar seam (Z = +0.062)
        # 3. Rear door rear dogleg seam (curving smoothly around rear wheel arch from Z=+0.84 to Z=+0.95)
        seam_specs = [
            lambda fy: -0.805,
            lambda fy: 0.062,
            lambda fy: lerp(0.835, 0.955, smoothstep(0.15, 0.85, fy)),
        ]
        for z_fn in seam_specs:
            seam_g: list[list[Vector]] = []
            for iy in range(11):
                fy = iy / 10.0
                z_s = z_fn(fy)
                yt = beltline_y(z_s)
                y_s = lerp(0.185, yt - 0.005, fy)
                x_s = body_side_x(z_s, y_s, yt) + 0.0012
                seam_g.append([
                    v3(side * x_s, y_s, z_s - 0.0022),
                    v3(side * x_s, y_s, z_s + 0.0022),
                ])
            add_loft_grid(bm_trim, seam_g, mat_idx=4, outward_dir=Vector((side, 0.0, 0.0)))

        # Horizontal door bottom sill shut-line seam (Z = -0.805 .. +0.835 at y = 0.210)
        sill_seam: list[list[Vector]] = []
        for iz in range(14):
            z_s = lerp(-0.805, 0.835, iz / 13.0)
            x_s = body_side_x(z_s, 0.212, beltline_y(z_s)) + 0.0012
            sill_seam.append([v3(side * x_s, 0.210, z_s), v3(side * x_s, 0.214, z_s)])
        add_loft_grid(bm_trim, sill_seam, mat_idx=4, outward_dir=Vector((side, 0.0, 0.0)))

        # Subtle dark door-handle finger recess behind each pull handle
        for hz in (-0.08, 0.69):
            hy = tornado_line_y(hz) - 0.010
            hx = body_side_x(hz, hy, beltline_y(hz)) + 0.0008
            add_beveled_box(bm_trim, (side * hx, hy, hz), (0.004, 0.022, 0.105), mat_idx=4, bevel=0.0015)

        # Fuel filler flap outline on right rear quarter (+X only, Z = +1.34, Y = 0.84)
        if side > 0:
            for (dz0, dy0, dz1, dy1) in [
                (-0.075, -0.055, 0.075, -0.055),
                (0.075, -0.055, 0.075, 0.055),
                (0.075, 0.055, -0.075, 0.055),
                (-0.075, 0.055, -0.075, -0.055),
            ]:
                p0 = (body_side_x(1.34 + dz0, 0.83 + dy0) + 0.0012, 0.83 + dy0, 1.34 + dz0)
                p1 = (body_side_x(1.34 + dz1, 0.83 + dy1) + 0.0012, 0.83 + dy1, 1.34 + dz1)
                add_tube(bm_trim, [p0, p1], 0.0014, ring_segs=6, mat_idx=4)

        # Flush gloss-black rear hatch glass side trim strips (tucked directly onto glass edge!)
        add_beveled_box(bm_trim, (side * 0.578, 1.188, 1.695), (0.022, 0.365, 0.024), (-0.70, 0.0, side * 0.25), mat_idx=0, bevel=0.004)

        # Clean matte-black lower rocker trim + jacking rail (strictly behind FR arch Z >= -0.915!)
        add_beveled_box(bm_trim, (side * 0.834, 0.162, -0.005), (0.042, 0.032, 1.80), mat_idx=1, bevel=0.005)
        add_beveled_box(bm_trim, (side * 0.68, 0.150, 0.0), (0.038, 0.026, 1.54), mat_idx=1)

    # 3F. CLOSED INNER WHEELHOUSE TUBS for FL (-X front), RL (-X rear), RR (+X rear)
    # Tucked cleanly up to crown Y=0.762 & outer X=0.862 inside the rolled fender lip -> ZERO daylight leaks!
    # NOTE: FR (+X front) MUST stay open in BodyShell for the removable Golf7_WheelLiner & repair game!
    for wh_side, wh_az in [(-1.0, FRONT_AXLE_Z), (-1.0, REAR_AXLE_Z), (1.0, REAR_AXLE_Z)]:
        r_wh = 0.412
        x_in = wh_side * 0.44
        x_out = wh_side * 0.862
        wh_grid: list[list[Vector]] = []
        for k in range(29):
            ang = math.pi + 0.28 - (k / 28.0) * (math.pi + 0.56)
            z = wh_az + math.cos(ang) * r_wh
            y = ARCH_SPRING_Y + math.sin(ang) * (r_wh + 0.032)
            wh_grid.append([v3(x_in, y, z), v3(x_out, y, z)])
        add_loft_grid(bm_trim, wh_grid, mat_idx=1, outward_dir=Vector((0.0, 0.0, -1.0)))
        wall_g: list[list[Vector]] = []
        for iz in range(15):
            fz = iz / 14.0
            z = wh_az + lerp(-r_wh, r_wh, fz)
            dz = z - wh_az
            y_hi = ARCH_SPRING_Y + math.sqrt(max(0.0, r_wh * r_wh - dz * dz)) + 0.032
            wall_g.append([v3(x_in, 0.16, z), v3(x_in, y_hi, z)])
        add_loft_grid(bm_trim, wall_g, mat_idx=1, outward_dir=Vector((wh_side, 0.0, 0.0)))

    # 3G. Roof Shark-Fin Antenna, Wiper Cowl, Twin Front Wipers, Rear Wiper
    add_beveled_box(bm_trim, (0.0, 1.438, 1.08), (0.028, 0.048, 0.138), (-0.18, 0.0, 0.0), mat_idx=0, bevel=0.010)
    # Plenum wiper cowl
    add_beveled_box(bm_trim, (0.0, 0.916, -0.835), (1.34, 0.036, 0.125), mat_idx=1, bevel=0.008)
    for wx in (-0.27, 0.19):
        add_beveled_box(bm_trim, (wx, 0.946, -0.798), (0.46, 0.012, 0.018), (0.0, 0.07, 0.0), mat_idx=0, bevel=0.003)
    # Rear wiper
    add_beveled_box(bm_trim, (0.10, 1.032, 1.862), (0.28, 0.014, 0.016), (0.76, 0.0, 0.0), mat_idx=0, bevel=0.003)

    # 3H. Clean OEM Standard TDI Matte-Black Lower Rear Bumper Valance (NO GTI racing fins!) + Dual Left TDI Tips
    val_grid: list[list[Vector]] = []
    for y_v in (0.185, 0.238, 0.288):
        row = []
        for k in range(-12, 13):
            u = k / 12.0 * 0.78
            s_sign = -1.0 if u < 0 else 1.0
            x, z = rear_fascia_xz(abs(u), y_v)
            row.append(v3(s_sign * x, y_v, z - 0.004))
        val_grid.append(row)
    add_loft_grid(bm_trim, val_grid, mat_idx=1, outward_dir=Vector((0.0, -1.0, 0.0)))
    # Discreet OEM left-side twin TDI chrome exhaust tips
    for ex in (-0.50, -0.415):
        add_cylinder_between(bm_trim, (ex, 0.208, 1.92), (ex, 0.208, 2.018), 0.030, 0.029, segs=24, mat_idx=2, bevel=0.003)
        add_cylinder_between(bm_trim, (ex, 0.208, 2.002), (ex, 0.208, 2.022), 0.023, 0.023, segs=20, mat_idx=0)

    # Underbody floor pan strictly clear of FR wheel arch cavity (Z >= -0.89, or |X| <= 0.34!)
    add_beveled_box(bm_trim, (0.0, 0.172, 0.45), (1.32, 0.034, 2.68), mat_idx=1)
    add_beveled_box(bm_trim, (0.0, 0.195, -1.32), (0.68, 0.040, 0.92), mat_idx=1)

    create_object_from_bm(
        "BodyShell_Trim",
        bm_trim,
        [mats["gloss_black"], mats["matte_trim"], mats["chrome"], mats["mirror_glass"], mats["panel_seam"]],
        parent=root,
        sharp_angle_deg=42.0,
    )

    # =========================================================================
    # 4. NEUTRAL LICENSE PLATES ("WOB MK 700" Front & Rear — Cleanly Mounted!)
    # =========================================================================
    bm_plate = bmesh.new()
    # Front slim matte-black plate frame + white embossed plate centered cleanly between lower intake & bumper crease
    add_beveled_box(bm_plate, (0.0, 0.435, -2.134), (0.534, 0.120, 0.016), mat_idx=0, bevel=0.003)
    add_beveled_box(bm_plate, (0.0, 0.435, -2.145), (0.520, 0.110, 0.009), mat_idx=1, bevel=0.002)
    assign_planar_uv(
        bm_plate,
        lambda f: f.material_index == 1 and f.calc_center_median().y > 0.0,
        lambda co: 0.5 - co.x / 0.520,
        lambda co: (co.z - (0.435 - 0.055)) / 0.110,
    )

    # Rear neutral license plate cleanly mounted on rear bumper center
    add_beveled_box(bm_plate, (0.0, 0.435, 2.068), (0.534, 0.120, 0.014), mat_idx=0, bevel=0.003)
    add_beveled_box(bm_plate, (0.0, 0.435, 2.078), (0.520, 0.110, 0.009), mat_idx=1, bevel=0.002)
    assign_planar_uv(
        bm_plate,
        lambda f: f.material_index == 1 and f.calc_center_median().y < 0.0,
        lambda co: 0.5 + co.x / 0.520,
        lambda co: (co.z - (0.435 - 0.055)) / 0.110,
    )

    create_object_from_bm(
        "BodyShell_LicensePlates",
        bm_plate,
        [mats["gloss_black"], mats["plate"]],
        parent=root,
        sharp_angle_deg=38.0,
    )

    # =========================================================================
    # 5. OEM GOLF VII CLEAR HALOGEN HEADLIGHTS, CORNER LAMPS & FLUSH TAILLIGHTS
    # =========================================================================
    bm_lights = bmesh.new()
    # Mat indices:
    # 0=gloss_black, 1=reflector, 2=halogen_bulb, 3=headlight_lens, 4=amber_lamp,
    # 5=tail_led, 6=tail_lens, 7=tail_white, 8=mirror_led, 9=chrome

    for side in (1.0, -1.0):
        # --- 5A. Expressive Wide Angular Rising OEM Halogen Headlights (u = 0.236 .. 0.860) ---
        u_hl = [lerp(0.236, 0.860, k / 14.0) for k in range(15)]

        # 1. Deep Dark Recessed Housing Cavity behind lens (zero gaps into fender!)
        hl_back_g: list[list[Vector]] = []
        hl_rim_top: list[list[Vector]] = []
        hl_rim_bot: list[list[Vector]] = []
        for u in u_hl:
            yb, yt = headlight_y_bounds(u)
            ym = 0.5 * (yb + yt)
            xb, zb = front_fascia_xz(u, yb)
            xm, zm = front_fascia_xz(u, ym)
            xt, zt = front_fascia_xz(u, yt)
            nx, _, nz = front_fascia_normal(u, ym)
            depth = 0.072
            hl_back_g.append([
                v3(side * (xb - nx * depth), yb + 0.004, zb - nz * depth),
                v3(side * (xm - nx * (depth + 0.016)), ym, zm - nz * (depth + 0.016)),
                v3(side * (xt - nx * depth), yt - 0.004, zt - nz * depth),
            ])
            hl_rim_top.append([
                v3(side * (xt - nx * depth), yt - 0.004, zt - nz * depth),
                v3(side * (xt + nx * 0.002), yt, zt + nz * 0.002),
            ])
            hl_rim_bot.append([
                v3(side * (xb + nx * 0.002), yb, zb + nz * 0.002),
                v3(side * (xb - nx * depth), yb + 0.004, zb - nz * depth),
            ])
        add_loft_grid(bm_lights, hl_back_g, mat_idx=0, outward_dir=Vector((side * 0.45, 0.88, 0.0)))
        add_loft_grid(bm_lights, hl_rim_top, mat_idx=0, outward_dir=Vector((0.0, 0.0, -1.0)))
        add_loft_grid(bm_lights, hl_rim_bot, mat_idx=0, outward_dir=Vector((0.0, 0.0, 1.0)))
        # Inner & outer end walls sealing the headlight housing
        for u_end, d_sign in [(0.236, side), (0.860, -side)]:
            yb, yt = headlight_y_bounds(u_end)
            ew_g: list[list[Vector]] = []
            for fv in (0.0, 0.5, 1.0):
                y = lerp(yb, yt, fv)
                x, z = front_fascia_xz(u_end, y)
                nx, _, nz = front_fascia_normal(u_end, y)
                ew_g.append([
                    v3(side * (x - nx * 0.072), y, z - nz * 0.072),
                    v3(side * (x + nx * 0.002), y, z + nz * 0.002),
                ])
            add_loft_grid(bm_lights, ew_g, mat_idx=0, outward_dir=Vector((d_sign, 0.0, 0.0)))

        # Crisp dark inner divider separating inner high-beam and outer low-beam chambers
        yb_d, yt_d = headlight_y_bounds(0.49)
        xd, zd = front_fascia_xz(0.49, lerp(yb_d, yt_d, 0.5))
        nxd, _, nzd = front_fascia_normal(0.49, lerp(yb_d, yt_d, 0.5))
        add_beveled_box(
            bm_lights,
            (side * (xd - nxd * 0.030), lerp(yb_d, yt_d, 0.52), zd - nzd * 0.030),
            (0.014, (yt_d - yb_d) * 0.80, 0.050),
            (0.0, side * -0.25, 0.0),
            mat_idx=0,
            bevel=0.003,
        )

        # 2. Bright Multi-Faceted Chrome Halogen Reflector Bowls (Inner High-Beam + Large Outer Low-Beam!)
        for u_ctr, rx_rad, ry_rad in [
            (0.370, 0.082, 0.038),   # Inner high-beam / DRL faceted chrome reflector
            (0.640, 0.105, 0.044),   # Outer large main low-beam faceted chrome reflector
        ]:
            yb_c, yt_c = headlight_y_bounds(u_ctr)
            yc = lerp(yb_c, yt_c, 0.54)
            xc, zc = front_fascia_xz(u_ctr, yc)
            nx, _, nz = front_fascia_normal(u_ctr, yc)
            tx, tz = -nz, nx
            dish_rings: list[list[Vector]] = []
            n_seg = 12
            for rf, depth_off in [(0.16, 0.058), (0.52, 0.046), (0.86, 0.025), (1.0, 0.014)]:
                ring = []
                for k in range(n_seg + 1):
                    a = (k / n_seg) * 2.0 * math.pi
                    du_t = math.cos(a) * rx_rad * rf
                    dy_t = math.sin(a) * ry_rad * rf
                    px = xc + tx * du_t - nx * depth_off
                    py = yc + dy_t
                    pz = zc + tz * du_t - nz * depth_off
                    ring.append(v3(side * px, py, pz))
                dish_rings.append(ring)
            add_loft_grid(bm_lights, dish_rings, mat_idx=1, outward_dir=Vector((side * nx, -nz, 0.0)))

            p_bulb0 = (side * (xc - nx * 0.055), yc, zc - nz * 0.055)
            p_bulb1 = (side * (xc - nx * 0.025), yc, zc - nz * 0.025)
            add_cylinder_between(bm_lights, p_bulb0, p_bulb1, 0.012, 0.010, segs=14, mat_idx=2, bevel=0.002)
            p_cap0 = (side * (xc - nx * 0.026), yc, zc - nz * 0.026)
            p_cap1 = (side * (xc - nx * 0.017), yc, zc - nz * 0.017)
            add_cylinder_between(bm_lights, p_cap0, p_cap1, 0.011, 0.007, segs=14, mat_idx=9)

        # Crisp lower chrome trim accent bar inside headlight continuing the grille's chrome strip seamlessly!
        pts_hlc = []
        nrm_hlc = []
        for u in u_hl[:-2]:
            yb, yt = headlight_y_bounds(u)
            y_bar = lerp(yb, yt, 0.13)
            x, z = front_fascia_xz(u, y_bar)
            nx, _, nz = front_fascia_normal(u, y_bar)
            pts_hlc.append((side * (x - nx * 0.016), y_bar, z - nz * 0.016))
            nrm_hlc.append((side * nx, 0.0, nz))
        add_curved_ribbon(bm_lights, pts_hlc, nrm_hlc, half_h=0.006, thickness=0.012, mat_idx=9)

        # Subtle outer-corner indicator prism tucked neatly into outer headlight corner
        u_ind = [lerp(0.76, 0.85, k / 3.0) for k in range(4)]
        pts_ind = []
        nrm_ind = []
        for u in u_ind:
            yb, yt = headlight_y_bounds(u)
            y_i = lerp(yb, yt, 0.40)
            x, z = front_fascia_xz(u, y_i)
            nx, _, nz = front_fascia_normal(u, y_i)
            pts_ind.append((side * (x - nx * 0.028), y_i, z - nz * 0.028))
            nrm_ind.append((side * nx, 0.0, nz))
        add_curved_ribbon(bm_lights, pts_ind, nrm_ind, half_h=0.012, thickness=0.010, mat_idx=4)

        # Crisp dark gasket tucked neatly flush inside the headlight perimeter (zero poke-out!)
        for edge_idx in (0, 1):
            pts_g = []
            nrm_g = []
            for u in u_hl:
                yb, yt = headlight_y_bounds(u)
                yg = yb if edge_idx == 0 else yt - 0.002
                x, z = front_fascia_xz(u, yg)
                nx, _, nz = front_fascia_normal(u, yg)
                pts_g.append((side * (x - nx * 0.007), yg, z - nz * 0.007))
                nrm_g.append((side * nx, 0.0, nz))
            add_curved_ribbon(bm_lights, pts_g, nrm_g, half_h=0.0032, thickness=0.005, mat_idx=0)

        # 3. Flush Curved Crystal-Clear Polycarbonate Outer Lens
        lens_g: list[list[Vector]] = []
        for u in u_hl:
            yb, yt = headlight_y_bounds(u)
            row = []
            for fv in (0.0, 0.25, 0.50, 0.75, 1.0):
                y = lerp(yb, yt, fv)
                x, z = front_fascia_xz(u, y)
                nx, _, nz = front_fascia_normal(u, y)
                bulge = 0.002 + 0.005 * math.sin(fv * math.pi)
                row.append(v3(side * (x + nx * bulge), y, z + nz * bulge))
            lens_g.append(row)
        add_loft_grid(bm_lights, lens_g, mat_idx=3, outward_dir=Vector((side * 0.45, 0.88, 0.0)))

        # --- 5B. Warm Horizontal Corner Fog/Indicator Lamp in Sleek Lower Outer Recess (matching photo!) ---
        u_fog = [lerp(0.625, 0.835, k / 5.0) for k in range(6)]
        pts_fog = []
        nrm_fog = []
        for k_f, u in enumerate(u_fog):
            y_f = 0.304 + (k_f / 5.0) * 0.015
            x, z = front_fascia_xz(u, y_f)
            nx, _, nz = front_fascia_normal(u, y_f)
            pts_fog.append((side * (x - nx * 0.022), y_f, z - nz * 0.022))
            nrm_fog.append((side * nx, 0.0, nz))
        add_curved_ribbon(bm_lights, pts_fog, nrm_fog, half_h=0.013, thickness=0.014, mat_idx=4)
        pts_fl = [(p[0] + n[0] * 0.015, p[1], p[2] + n[2] * 0.015) for p, n in zip(pts_fog, nrm_fog)]
        add_curved_ribbon(bm_lights, pts_fl, nrm_fog, half_h=0.015, thickness=0.004, mat_idx=3)

        # --- 5C. Sleek Horizontal LED Turn Repeater Strip Integrated into Side Mirror Cap ---
        add_beveled_box(bm_lights, (side * 0.916, 0.976, -0.666), (0.112, 0.009, 0.012), (0.0, side * -0.22, side * 0.06), mat_idx=8, bevel=0.002)

        # --- 5D. Flush Curved OEM VW Golf Mk7 Taillights Wrapping Cleanly Around Rear Corner ---
        u_tl = [lerp(0.32, 0.90, k / 8.0) for k in range(9)]
        tl_lens: list[list[Vector]] = []
        tl_inner: list[list[Vector]] = []
        for idx_u, u in enumerate(u_tl):
            f = idx_u / (len(u_tl) - 1)
            # Signature Golf 7 wedge taillight: slimmer inner tailgate tip, taller crisp outer corner
            yb_t = lerp(0.835, 0.818, f)
            yt_t = lerp(0.922, 0.940, f)
            r_l = []
            r_i = []
            for fv in (0.0, 0.35, 0.65, 1.0):
                y = lerp(yb_t, yt_t, fv)
                x, z = rear_fascia_xz(u, y)
                out_x = side * (0.006 if f > 0.5 else 0.002)
                out_z = 0.008 * (1.0 - 0.5 * f)
                r_l.append(v3(side * x + out_x, y, z + out_z))
                r_i.append(v3(side * x + out_x * 0.3, y, z + out_z * 0.3))
            tl_lens.append(r_l)
            tl_inner.append(r_i)
        add_loft_grid(bm_lights, tl_inner, mat_idx=5, outward_dir=Vector((side * 0.35, -0.92, 0.0)))
        add_loft_grid(bm_lights, tl_lens, mat_idx=6, outward_dir=Vector((side * 0.35, -0.92, 0.0)))

        # Crisp white reverse light strip along lower inner edge of taillight
        u_rev = [lerp(0.34, 0.68, k / 4.0) for k in range(5)]
        pts_rv = []
        nrm_rv = []
        for u in u_rev:
            x, z = rear_fascia_xz(u, 0.855)
            pts_rv.append((side * x, 0.855, z + 0.004))
            nrm_rv.append((side * 0.25, 0.0, 0.96))
        add_curved_ribbon(bm_lights, pts_rv, nrm_rv, half_h=0.010, thickness=0.006, mat_idx=7)

        # Flush slim rear bumper reflectors
        u_rf = [lerp(0.56, 0.78, k / 3.0) for k in range(4)]
        pts_rf = []
        nrm_rf = []
        for u in u_rf:
            x, z = rear_fascia_xz(u, 0.312)
            pts_rf.append((side * x, 0.312, z + 0.002))
            nrm_rf.append((side * 0.45, 0.0, 0.89))
        add_curved_ribbon(bm_lights, pts_rf, nrm_rf, half_h=0.009, thickness=0.005, mat_idx=5)

    # High-mount 3rd brake light tucked cleanly into rear roof spoiler
    add_beveled_box(bm_lights, (0.0, 1.378, 1.564), (0.34, 0.014, 0.014), mat_idx=5, bevel=0.002)

    create_object_from_bm(
        "BodyShell_Lights",
        bm_lights,
        [
            mats["gloss_black"],
            mats["reflector"],
            mats["halogen_bulb"],
            mats["headlight_lens"],
            mats["amber_lamp"],
            mats["tail_led"],
            mats["tail_lens"],
            mats["tail_white"],
            mats["mirror_led"],
            mats["chrome"],
        ],
        parent=root,
        sharp_angle_deg=38.0,
    )

    # =========================================================================
    # 6. CABIN INTERIOR & ENGINE BAY SURROUND (STRICTLY CLEAR OF FR CAVITY!)
    # =========================================================================
    bm_int = bmesh.new()
    # Mat indices: 0=interior, 1=bay_steel, 2=matte_trim, 3=coolant_bottle, 4=coolant_g13, 5=coolant_cap

    # Cabin dashboard, center console, interior rearview mirror & 3-spoke VW steering wheel (driver side -X)
    add_beveled_box(bm_int, (0.0, 0.78, -0.58), (1.30, 0.22, 0.40), mat_idx=0, bevel=0.03)
    add_beveled_box(bm_int, (-0.34, 0.90, -0.55), (0.28, 0.10, 0.18), mat_idx=0, bevel=0.02)
    add_beveled_box(bm_int, (0.0, 1.24, -0.37), (0.19, 0.052, 0.025), mat_idx=0, bevel=0.008)
    sw_pts = [
        (
            -0.34 + math.cos(k * 2.0 * math.pi / 24) * 0.155,
            0.88 + math.sin(k * 2.0 * math.pi / 24) * 0.155 * math.cos(0.35),
            -0.35 + math.sin(k * 2.0 * math.pi / 24) * 0.155 * math.sin(0.35),
        )
        for k in range(25)
    ]
    add_tube(bm_int, sw_pts, 0.016, ring_segs=8, mat_idx=0, cap=False)

    # Front comfort seats + headrests & rear bench
    for sx in (-0.34, 0.34):
        add_beveled_box(bm_int, (sx, 0.40, -0.05), (0.46, 0.14, 0.48), mat_idx=0, bevel=0.035)
        add_beveled_box(bm_int, (sx, 0.70, 0.18), (0.44, 0.56, 0.14), (-0.18, 0.0, 0.0), mat_idx=0, bevel=0.035)
        add_beveled_box(bm_int, (sx, 1.07, 0.22), (0.21, 0.17, 0.10), (-0.12, 0.0, 0.0), mat_idx=0, bevel=0.030)
    add_beveled_box(bm_int, (0.0, 0.45, 0.78), (1.24, 0.22, 0.48), mat_idx=0, bevel=0.04)
    add_beveled_box(bm_int, (0.0, 0.76, 1.02), (1.22, 0.50, 0.14), (-0.22, 0.0, 0.0), mat_idx=0, bevel=0.04)

    # Engine Bay Surround (STRICTLY CLEAR of X in [0.45, 0.84], Y in [0.16, 0.78], Z in [-1.72, -0.92]!)
    add_beveled_box(bm_int, (0.0, 0.62, -0.82), (1.36, 0.56, 0.075), mat_idx=1, bevel=0.01)
    add_beveled_box(bm_int, (0.0, 0.650, -1.89), (1.10, 0.052, 0.09), mat_idx=2, bevel=0.01)
    add_beveled_box(bm_int, (-0.02, 0.44, -1.89), (0.80, 0.36, 0.05), mat_idx=1, bevel=0.005)
    # Right upper fender apron rail (Y >= 0.788, strictly above cavity Y = 0.78 AND strictly below fender/hood!)
    add_beveled_box(bm_int, (0.60, 0.808, -1.16), (0.085, 0.036, 0.56), (-0.12, 0.0, 0.0), mat_idx=1, bevel=0.006)
    # Right strut tower top dome (Z = -1.25, Y >= 0.788)
    add_cylinder_between(bm_int, (0.54, 0.788, -1.25), (0.54, 0.830, -1.25), 0.095, 0.085, segs=22, mat_idx=1, bevel=0.004)
    # Left apron, battery, airbox (-X side)
    add_beveled_box(bm_int, (-0.61, 0.64, -1.26), (0.12, 0.24, 0.82), mat_idx=1, bevel=0.01)
    add_beveled_box(bm_int, (-0.49, 0.63, -1.16), (0.16, 0.18, 0.24), mat_idx=2, bevel=0.012)
    add_beveled_box(bm_int, (-0.52, 0.63, -1.52), (0.16, 0.16, 0.26), mat_idx=2, bevel=0.012)

    # G13 Pink Coolant Expansion Sphere (-0.48, 0.76, -0.97)
    res_fluid = bmesh.ops.create_uvsphere(
        bm_int, u_segments=16, v_segments=12, radius=0.070, matrix=Matrix.Translation(v3(-0.48, 0.745, -0.97)) @ Matrix.Scale(0.72, 4, (0, 0, 1))
    )
    for v in res_fluid["verts"]:
        for f in v.link_faces:
            f.material_index = 4
            f.smooth = True
    res_orb = bmesh.ops.create_uvsphere(
        bm_int, u_segments=18, v_segments=14, radius=0.084, matrix=Matrix.Translation(v3(-0.48, 0.76, -0.97))
    )
    for v in res_orb["verts"]:
        for f in v.link_faces:
            f.material_index = 3
            f.smooth = True
    add_cylinder_between(bm_int, (-0.48, 0.84, -0.97), (-0.48, 0.865, -0.97), 0.025, 0.025, segs=18, mat_idx=5, bevel=0.003)

    create_object_from_bm(
        "BodyShell_CabinAndBay",
        bm_int,
        [mats["interior"], mats["bay_steel"], mats["matte_trim"], mats["coolant_bottle"], mats["coolant_g13"], mats["coolant_cap"]],
        parent=root,
        sharp_angle_deg=40.0,
    )

    # =========================================================================
    # 7. THREE STATIC DIJON WHEELS (FL, RL, RR) + BACKING BRAKE DISCS/CALIPERS
    # =========================================================================
    bm_wheels = bmesh.new()
    placements = [
        (-WHEEL_CENTER_X, WHEEL_CENTER_Y, FRONT_AXLE_Z, True),
        (-WHEEL_CENTER_X, WHEEL_CENTER_Y, REAR_AXLE_Z, True),
        (WHEEL_CENTER_X, WHEEL_CENTER_Y, REAR_AXLE_Z, False),
    ]
    for wx, wy, wz, flip_left in placements:
        populate_dijon_wheel_bmesh(
            bm_wheels,
            center_three=(wx, wy, wz),
            flip_left=flip_left,
            include_lug_bolts=True,
        )

    create_object_from_bm(
        "BodyShell_StaticWheels",
        bm_wheels,
        [mats["tire"], mats["alloy"], mats["alloy_pocket"], mats["gloss_black"], mats["chrome"], mats["bolt_chrome"]],
        parent=root,
        sharp_angle_deg=38.0,
    )

    bm_static_brakes = bmesh.new()
    for wx, wy, wz, flip_left in placements:
        rx = wx + (0.088 if flip_left else -0.088)
        add_cylinder_between(bm_static_brakes, (rx - 0.011, wy, wz), (rx + 0.011, wy, wz), 0.148, 0.148, segs=32, mat_idx=0, bevel=0.002)
        add_beveled_box(bm_static_brakes, (rx, wy + 0.02, wz + 0.115), (0.062, 0.112, 0.082), mat_idx=1, bevel=0.010)
    uv_sb = bm_static_brakes.loops.layers.uv.verify()
    for f in bm_static_brakes.faces:
        if f.material_index == 0:
            for loop in f.loops:
                loop[uv_sb].uv = (0.5, 0.5)
    create_object_from_bm(
        "BodyShell_StaticBrakes",
        bm_static_brakes,
        [mats["susp_rotor"], mats["susp_caliper"]],
        parent=root,
        sharp_angle_deg=38.0,
    )

    return root


# ---------------------------------------------------------------------------
# 2. Golf7_HoodPivot Builder (Origin: t2b(0, 0.94, -0.82))
# ---------------------------------------------------------------------------


def build_hood(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    Build Golf7_HoodPivot at exact hinge origin t2b(0, 0.94, -0.82).
    Curved leading edge seats cleanly onto the upper grille & headlights with a crisp VW badge
    semicircle notch, twin Golf 7 V-creases, rolled hem, and dark acoustic underside pad >= 1.8 cm below skin.
    """
    pivot = create_empty("Golf7_HoodPivot", (0.0, HOOD_HINGE_Y, HOOD_HINGE_Z))

    # 1. Sculpted Top Hood Skin + curved front nose + rolled hem
    bm_skin = bmesh.new()
    cr = bm_skin.edges.layers.float.new("crease_edge")

    z_steps = 20
    # Dense fx stations near centerline (for crisp VW emblem semicircle notch!) and V-crease
    fx_list = [0.0, 0.035, 0.070, 0.105, 0.145, 0.22, 0.34, 0.46, 0.56, 0.66, 0.76, 0.85, 0.93, 1.0]
    skin_grid: list[list[Vector]] = []
    for iz in range(z_steps + 1):
        tz = iz / z_steps
        row: list[Vector] = []
        for fx in fx_list:
            # Interpolate smoothly from straight cowl edge (lz=0) to curved front nose edge (lz=hood_front_z_local(fx))!
            lz_front = hood_front_z_local(fx)
            lz = tz * lz_front
            hw = hood_half_width(tz)
            lx = fx * hw
            wy = hood_profile_world(lx, lz) + hood_badge_notch_lift(lx, tz)
            ly = wy - HOOD_HINGE_Y
            row.append(v3(lx, ly, lz))
        # Rolled side edge hem returning cleanly downward & inward 1.1 cm
        lz_edge = tz * hood_front_z_local(1.0)
        hw_e = hood_half_width(tz)
        edge_ly = hood_profile_world(hw_e, lz_edge) - HOOD_HINGE_Y
        row.append(v3(hw_e - 0.008, edge_ly - 0.011, lz_edge))
        skin_grid.append(row)

    add_loft_grid(
        bm_skin,
        skin_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.75, z_steps: 0.80},
        crease_cols={len(fx_list) - 1: 0.72},
        outward_dir=Vector((0.0, 0.0, 1.0)),
        outward_rows=(0, z_steps),
    )

    # Front nose rolled underside return lip tucked cleanly down toward top of grille/headlights
    front_lip = [
        skin_grid[z_steps][:-1],
        [Vector((p.x, p.y - 0.014, p.z - 0.012)) for p in skin_grid[z_steps][:-1]],
    ]
    add_loft_grid(bm_skin, front_lip, mat_idx=0, crease_layer=cr, outward_dir=Vector((0.0, 1.0, -1.0)))

    mirror_bmesh_x(bm_skin, crease_layer=cr)
    create_object_from_bm("Hood_Skin", bm_skin, [mats["paint"]], parent=pivot, subsurf=1)

    # 2. Dark Underside Acoustic Pad & Inner Hood Steel Stamping strictly >= 0.018m BELOW hood_profile_world!
    bm_under = bmesh.new()
    # Full underside painted inner-frame skin at -0.019m (strictly ABOVE pad -0.025..-0.036 so ZERO blue poke-through!)
    frame_grid: list[list[Vector]] = []
    for iz in range(15):
        tz = 0.03 + (iz / 14.0) * 0.92
        row_f: list[Vector] = []
        for ix in range(15):
            fx = (ix / 14.0) * 2.0 - 1.0
            lz = tz * hood_front_z_local(fx)
            hw = hood_half_width(tz) - 0.018
            lx = fx * hw
            skin_ly = hood_profile_world(lx, lz) - HOOD_HINGE_Y
            row_f.append(v3(lx, skin_ly - 0.0185, lz))
        frame_grid.append(row_f)
    add_loft_grid(bm_under, frame_grid, mat_idx=2, outward_dir=Vector((0.0, 0.0, -1.0)))

    pad_grid_top: list[list[Vector]] = []
    pad_grid_bot: list[list[Vector]] = []
    for iz in range(9):
        tz = 0.09 + (iz / 8.0) * 0.74
        r_top: list[Vector] = []
        r_bot: list[Vector] = []
        for ix in range(9):
            fx = (ix / 8.0) * 2.0 - 1.0
            lz = tz * hood_front_z_local(fx)
            hw = hood_half_width(tz) - 0.095
            lx = fx * hw
            skin_ly = hood_profile_world(lx, lz) - HOOD_HINGE_Y
            is_diag = min(abs(fx - (tz - 0.45) * 1.4), abs(fx + (tz - 0.45) * 1.4)) < 0.14
            is_frame = abs(fx) > 0.82 or tz < 0.16 or tz > 0.75
            drop = 0.032 if (is_diag or is_frame) else 0.040
            r_top.append(v3(lx, skin_ly - 0.026, lz))
            r_bot.append(v3(lx, skin_ly - drop, lz))
        pad_grid_top.append(r_top)
        pad_grid_bot.append(r_bot)

    v_top = add_loft_grid(bm_under, pad_grid_top, mat_idx=0, flip=False)
    v_bot = add_loft_grid(bm_under, pad_grid_bot, mat_idx=0, flip=True)
    for iz in range(8):
        add_quad_or_tri(bm_under, (v_top[iz][0], v_bot[iz][0], v_bot[iz + 1][0], v_top[iz + 1][0]), 0)
        add_quad_or_tri(bm_under, (v_top[iz][-1], v_top[iz + 1][-1], v_bot[iz + 1][-1], v_bot[iz][-1]), 0)
    for ix in range(8):
        add_quad_or_tri(bm_under, (v_top[0][ix], v_top[0][ix + 1], v_bot[0][ix + 1], v_bot[0][ix]), 0)
        add_quad_or_tri(bm_under, (v_top[-1][ix], v_bot[-1][ix], v_bot[-1][ix + 1], v_top[-1][ix + 1]), 0)

    # Assert every under-pad vertex is strictly >= 0.018m below hood skin!
    for v in bm_under.verts:
        lx = v.co.x
        lz = -v.co.y
        ly = v.co.z
        skin_ly = hood_profile_world(lx, lz) - HOOD_HINGE_Y
        clearance = skin_ly - ly
        assert clearance >= 0.018, f"Hood pad clearance violation: {clearance:.4f}m at ({lx:.3f}, {lz:.3f})"

    # Chrome hood striker latch U-loop at front center
    latch_y = hood_profile_world(0.0, -1.16) - HOOD_HINGE_Y - 0.025
    striker_pts = [
        (-0.022, latch_y, -1.15),
        (-0.022, latch_y - 0.026, -1.15),
        (0.022, latch_y - 0.026, -1.15),
        (0.022, latch_y, -1.15),
    ]
    add_tube(bm_under, striker_pts, 0.0045, ring_segs=8, mat_idx=1)

    create_object_from_bm("Hood_Underside", bm_under, [mats["hood_pad"], mats["chrome"], mats["paint"]], parent=pivot, sharp_angle_deg=38.0)

    return pivot


# ---------------------------------------------------------------------------
# 3. Golf7_EngineCover Builder (Origin: t2b(0.02, 0.77, -1.32))
# ---------------------------------------------------------------------------


def build_engine_cover(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Sculpted beveled EA288 acoustic engine cover with TDI 1.6 EA288 badge texture."""
    bm = bmesh.new()
    add_beveled_box(bm, (0.0, 0.0, 0.0), (0.46, 0.044, 0.42), mat_idx=0, bevel=0.014, bevel_segs=3)
    for rx in (-0.155, -0.055, 0.055, 0.155):
        add_beveled_box(bm, (rx, 0.026, 0.015), (0.036, 0.016, 0.34), mat_idx=0, bevel=0.005)
    add_beveled_box(bm, (0.01, 0.029, -0.082), (0.41, 0.012, 0.052), (0.0, 0.22, 0.0), mat_idx=1, bevel=0.004)
    add_cylinder_between(bm, (-0.15, 0.016, -0.12), (-0.15, 0.036, -0.12), 0.042, 0.039, segs=24, mat_idx=0, bevel=0.003)
    add_cylinder_between(bm, (-0.15, 0.032, -0.12), (-0.15, 0.048, -0.12), 0.032, 0.031, segs=20, mat_idx=3, bevel=0.003)
    add_beveled_box(bm, (-0.15, 0.051, -0.12), (0.046, 0.010, 0.014), (0.0, 0.4, 0.0), mat_idx=3, bevel=0.002)

    pw, pd = 0.24, 0.105
    px, py, pz = 0.05, 0.037, 0.055
    v0 = bm.verts.new(v3(px - pw * 0.5, py, pz - pd * 0.5))
    v1 = bm.verts.new(v3(px + pw * 0.5, py, pz - pd * 0.5))
    v2 = bm.verts.new(v3(px + pw * 0.5, py, pz + pd * 0.5))
    v3v = bm.verts.new(v3(px - pw * 0.5, py, pz + pd * 0.5))
    f_plaque = bm.faces.new((v0, v3v, v2, v1))
    f_plaque.material_index = 2
    uv_layer = bm.loops.layers.uv.verify()
    uvs = [(1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]
    for loop, uv in zip(f_plaque.loops, uvs):
        loop[uv_layer].uv = uv

    return create_object_from_bm(
        "Golf7_EngineCover",
        bm,
        [mats["ec_poly"], mats["ec_silver"], mats["ec_plaque"], mats["gloss_black"]],
        loc_three=(0.02, 0.77, -1.32),
        sharp_angle_deg=38.0,
    )


# ---------------------------------------------------------------------------
# 4. Golf7_FrontRightSuspension & Golf7_WheelHub
# ---------------------------------------------------------------------------


def build_front_right_suspension(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Front-right suspension & vented rotor (all materials prefixed Golf7_Susp_)."""
    bm = bmesh.new()
    rotor_cx = 0.672
    rotor_profile = [
        (0.029, 0.016),
        (0.080, 0.016),
        (0.084, 0.010),
        (0.148, 0.010),
        (0.148, 0.004),
        (0.136, 0.003),
        (0.136, -0.003),
        (0.148, -0.004),
        (0.148, -0.010),
        (0.084, -0.010),
        (0.080, 0.004),
        (0.029, 0.004),
    ]
    add_revolved_profile(bm, rotor_profile, center_three=(rotor_cx, WHEEL_CENTER_Y, FRONT_AXLE_Z), segs=48, mat_idx=1)
    uv_layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        if f.material_index == 1:
            for loop in f.loops:
                co = loop.vert.co
                dz = -co.y - FRONT_AXLE_Z
                dy = co.z - WHEEL_CENTER_Y
                loop[uv_layer].uv = (0.5 + dz / 0.305, 0.5 + dy / 0.305)

    add_cylinder_between(
        bm,
        (0.658, WHEEL_CENTER_Y, FRONT_AXLE_Z),
        (0.688, WHEEL_CENTER_Y, FRONT_AXLE_Z),
        0.080,
        0.078,
        segs=36,
        mat_idx=0,
        bevel=0.002,
    )

    add_beveled_box(bm, (0.674, WHEEL_CENTER_Y + 0.018, -1.19), (0.068, 0.132, 0.086), mat_idx=2, bevel=0.012)
    add_beveled_box(bm, (0.692, WHEEL_CENTER_Y + 0.018, -1.19), (0.052, 0.076, 0.054), mat_idx=2, bevel=0.008)
    add_cylinder_between(bm, (0.655, WHEEL_CENTER_Y + 0.018, -1.19), (0.635, WHEEL_CENTER_Y + 0.018, -1.19), 0.028, 0.028, segs=18, mat_idx=2)
    add_tube(
        bm,
        [
            (0.65, WHEEL_CENTER_Y + 0.06, -1.16),
            (0.58, WHEEL_CENTER_Y + 0.14, -1.10),
            (0.52, WHEEL_CENTER_Y + 0.24, -1.04),
        ],
        0.006,
        ring_segs=8,
        mat_idx=3,
    )

    p_bot = Vector((0.59, 0.37, -1.24))
    p_top = Vector((0.54, 0.79, -1.25))
    strut_dir = (p_top - p_bot).normalized()
    p_damper_top = p_bot + strut_dir * 0.24
    p_rod_bot = p_bot + strut_dir * 0.22

    add_cylinder_between(bm, tuple(p_bot), tuple(p_damper_top), 0.023, 0.023, segs=20, mat_idx=3, bevel=0.002)
    add_cylinder_between(bm, tuple(p_rod_bot), tuple(p_top), 0.011, 0.011, segs=16, mat_idx=4)

    p_lperch_a = p_bot + strut_dir * 0.10
    p_lperch_b = p_bot + strut_dir * 0.118
    add_cylinder_between(bm, tuple(p_lperch_a), tuple(p_lperch_b), 0.028, 0.042, segs=22, mat_idx=3)

    p_uperch_a = p_top - strut_dir * 0.045
    p_uperch_b = p_top - strut_dir * 0.020
    add_cylinder_between(bm, tuple(p_uperch_a), tuple(p_uperch_b), 0.044, 0.048, segs=22, mat_idx=3)

    coil_start = p_bot + strut_dir * 0.115
    coil_end = p_top - strut_dir * 0.042
    coil_axis = coil_end - coil_start
    u_vec = strut_dir.cross(Vector((0.0, 0.0, 1.0))).normalized()
    w_vec = strut_dir.cross(u_vec).normalized()
    coil_pts: list[tuple[float, float, float]] = []
    turns = 5.0
    n_coil = 75
    for i in range(n_coil + 1):
        f = i / n_coil
        ang = f * turns * 2.0 * math.pi
        center = coil_start + coil_axis * f
        pt = center + (u_vec * math.cos(ang) + w_vec * math.sin(ang)) * 0.036
        coil_pts.append((pt.x, pt.y, pt.z))
    add_tube(bm, coil_pts, 0.0058, ring_segs=8, mat_idx=3)

    add_beveled_box(bm, (0.625, 0.320, -1.30), (0.052, 0.125, 0.088), mat_idx=0, bevel=0.008)
    add_beveled_box(bm, (0.590, 0.372, -1.242), (0.072, 0.046, 0.052), (0.0, 0.0, -0.45), mat_idx=0, bevel=0.006)
    add_cylinder_between(bm, (0.625, 0.27, -1.30), (0.618, 0.205, -1.305), 0.024, 0.018, segs=14, mat_idx=0)

    add_beveled_box(bm, (0.46, 0.205, -1.33), (0.31, 0.025, 0.044), (0.0, -0.10, 0.0), mat_idx=3, bevel=0.004)
    add_beveled_box(bm, (0.46, 0.205, -1.175), (0.33, 0.025, 0.044), (0.0, 0.78, 0.0), mat_idx=3, bevel=0.004)
    add_cylinder_between(bm, (0.575, 0.215, -1.215), (0.568, 0.435, -1.232), 0.006, 0.006, segs=12, mat_idx=4)
    add_cylinder_between(bm, (0.30, 0.29, -1.21), (0.64, WHEEL_CENTER_Y, FRONT_AXLE_Z), 0.017, 0.017, segs=16, mat_idx=3)
    add_cylinder_between(bm, (0.56, 0.308, -1.294), (0.62, 0.315, -1.314), 0.022, 0.036, segs=18, mat_idx=3)

    return create_object_from_bm(
        "Golf7_FrontRightSuspension",
        bm,
        [mats["susp_iron"], mats["susp_rotor"], mats["susp_caliper"], mats["susp_black"], mats["susp_chrome"]],
        loc_three=(0.0, 0.0, 0.0),
        sharp_angle_deg=40.0,
    )


def build_wheel_hub(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Build Golf7_WheelHub at exact origin t2b(0.69, 0.317, -1.32)."""
    bm = bmesh.new()
    add_cylinder_between(bm, (-0.010, 0.0, 0.0), (0.001, 0.0, 0.0), 0.078, 0.078, segs=36, mat_idx=0, bevel=0.0015)
    add_cylinder_between(bm, (-0.001, 0.0, 0.0), (0.019, 0.0, 0.0), 0.0285, 0.0280, segs=28, mat_idx=0, bevel=0.0015)
    add_cylinder_between(bm, (0.018, 0.0, 0.0), (0.020, 0.0, 0.0), 0.021, 0.021, segs=24, mat_idx=1)

    for i in range(5):
        a = i * (2.0 * math.pi / 5.0) + math.pi / 10.0
        ly = math.sin(a) * BOLT_CIRCLE_RADIUS
        lz = math.cos(a) * BOLT_CIRCLE_RADIUS
        add_cylinder_between(bm, (-0.008, ly, lz), (0.0016, ly, lz), 0.0095, 0.0095, segs=16, mat_idx=0, bevel=0.0008)
        add_cylinder_between(bm, (-0.008, ly, lz), (0.0020, ly, lz), 0.0070, 0.0070, segs=14, mat_idx=1)

    return create_object_from_bm(
        "Golf7_WheelHub",
        bm,
        [mats["susp_hub"], mats["susp_bore"]],
        loc_three=(HUB_FACE_X, WHEEL_CENTER_Y, FRONT_AXLE_Z),
        sharp_angle_deg=38.0,
    )


# ---------------------------------------------------------------------------
# 5. OEM VW 17" Dijon 5-Twin-Spoke Alloy Wheel & 225/45 R17 Tire
# ---------------------------------------------------------------------------


def populate_dijon_wheel_bmesh(
    bm: bmesh.types.BMesh,
    center_three: tuple[float, float, float] = (0.0, 0.0, 0.0),
    flip_left: bool = False,
    include_lug_bolts: bool = False,
) -> None:
    cx, cy, cz = center_three
    sx_dir = -1.0 if flip_left else 1.0

    def wx(lx: float) -> float:
        return cx + sx_dir * lx

    R_OUT = TIRE_RADIUS
    R_GRV = TIRE_RADIUS - 0.0045
    tire_prof = [
        (0.214, -0.095),
        (0.242, -0.103),
        (0.278, -0.106),
        (0.305, -0.097),
        (0.315, -0.084),
        (R_OUT, -0.068),
        (R_OUT, -0.052), (R_GRV, -0.050), (R_GRV, -0.042), (R_OUT, -0.040),
        (R_OUT, -0.018), (R_GRV, -0.016), (R_GRV, -0.008), (R_OUT, -0.006),
        (R_OUT, 0.006), (R_GRV, 0.008), (R_GRV, 0.016), (R_OUT, 0.018),
        (R_OUT, 0.040), (R_GRV, 0.042), (R_GRV, 0.050), (R_OUT, 0.052),
        (R_OUT, 0.068),
        (0.315, 0.084),
        (0.305, 0.097),
        (0.278, 0.106),
        (0.242, 0.103),
        (0.214, 0.095),
        (0.212, 0.065),
        (0.212, -0.065),
    ]
    add_revolved_profile(bm, tire_prof, center_three=center_three, segs=56, closed_profile=True, mat_idx=0, flip=flip_left, axis_flip_x=flip_left)

    barrel_prof = [
        (0.214, -0.092),
        (0.215, 0.092),
        (0.207, 0.096),
        (0.202, 0.094),
        (0.202, 0.056),
        (0.188, 0.036),
        (0.188, -0.080),
        (0.200, -0.092),
    ]
    add_revolved_profile(bm, barrel_prof, center_three=center_three, segs=50, closed_profile=True, mat_idx=1, flip=flip_left, axis_flip_x=flip_left)

    pocket_prof = [
        (0.194, 0.022),
        (0.194, 0.032),
        (0.074, 0.030),
        (0.074, 0.020),
    ]
    add_revolved_profile(bm, pocket_prof, center_three=center_three, segs=40, closed_profile=True, mat_idx=2, flip=flip_left, axis_flip_x=flip_left)

    hub_prof = [
        (0.0285, -0.070),
        (0.078, -0.070),
        (0.081, 0.032),
        (0.076, 0.042),
        (0.040, 0.042),
        (0.032, 0.052),
        (0.0285, 0.052),
    ]
    add_revolved_profile(bm, hub_prof, center_three=center_three, segs=40, closed_profile=True, mat_idx=1, flip=flip_left, axis_flip_x=flip_left)

    for i in range(5):
        mid_a = i * (2.0 * math.pi / 5.0) + 3.0 * math.pi / 10.0
        for side_sign in (-1.0, 1.0):
            r_stations = [
                (0.072, 0.043, 0.145, 0.0115),
                (0.105, 0.049, 0.162, 0.0105),
                (0.145, 0.055, 0.175, 0.0095),
                (0.185, 0.059, 0.184, 0.0090),
                (0.206, 0.054, 0.186, 0.0105),
            ]
            spoke_rings: list[list[bmesh.types.BMVert]] = []
            for r, x_front, ang_off, half_w in r_stations:
                a = mid_a + side_sign * ang_off
                ru_y, ru_z = math.sin(a), math.cos(a)
                tu_y, tu_z = math.cos(a), -math.sin(a)
                y_c = cy + ru_y * r
                z_c = cz + ru_z * r
                bw_front = half_w * 0.72
                bw_back = half_w * 1.15
                x_chamfer = x_front - 0.004
                x_back = x_front - 0.022

                ring_pts = [
                    v3(wx(x_front), y_c - tu_y * bw_front, z_c - tu_z * bw_front),
                    v3(wx(x_front), y_c + tu_y * bw_front, z_c + tu_z * bw_front),
                    v3(wx(x_chamfer), y_c + tu_y * bw_back, z_c + tu_z * bw_back),
                    v3(wx(x_back), y_c + tu_y * bw_back * 0.9, z_c + tu_z * bw_back * 0.9),
                    v3(wx(x_back), y_c - tu_y * bw_back * 0.9, z_c - tu_z * bw_back * 0.9),
                    v3(wx(x_chamfer), y_c - tu_y * bw_back, z_c - tu_z * bw_back),
                ]
                spoke_rings.append([bm.verts.new(p) for p in ring_pts])

            for ir in range(len(spoke_rings) - 1):
                for k in range(6):
                    kn = (k + 1) % 6
                    m_i = 1 if k == 0 else 2
                    quad = (
                        (spoke_rings[ir][k], spoke_rings[ir + 1][k], spoke_rings[ir + 1][kn], spoke_rings[ir][kn])
                        if flip_left
                        else (spoke_rings[ir][k], spoke_rings[ir][kn], spoke_rings[ir + 1][kn], spoke_rings[ir + 1][k])
                    )
                    add_quad_or_tri(bm, quad, m_i)

    add_cylinder_between(bm, (wx(0.048), cy, cz), (wx(0.057), cy, cz), 0.032, 0.031, segs=28, mat_idx=3, bevel=0.002)
    cap_ring_pts = [
        (wx(0.058), cy + math.sin(k * 2.0 * math.pi / 24) * 0.028, cz + math.cos(k * 2.0 * math.pi / 24) * 0.028)
        for k in range(25)
    ]
    add_tube(bm, cap_ring_pts, 0.0024, ring_segs=6, mat_idx=4, cap=False)
    x_vw = wx(0.0585)
    for p0, p1 in [
        ((-0.011, 0.016), (0.0, -0.001)),
        ((0.011, 0.016), (0.0, -0.001)),
        ((-0.018, 0.008), (-0.008, -0.018)),
        ((-0.008, -0.018), (0.0, -0.004)),
        ((0.0, -0.004), (0.008, -0.018)),
        ((0.008, -0.018), (0.018, 0.008)),
    ]:
        add_tube(bm, [(x_vw, cy + p0[1], cz + p0[0] * sx_dir), (x_vw, cy + p1[1], cz + p1[0] * sx_dir)], 0.0022, ring_segs=6, mat_idx=4)

    for i in range(5):
        a = i * (2.0 * math.pi / 5.0) + math.pi / 10.0
        ly = cy + math.sin(a) * BOLT_CIRCLE_RADIUS
        lz = cz + math.cos(a) * BOLT_CIRCLE_RADIUS
        pocket_ring_prof = [
            (0.0110, 0.032),
            (0.0155, 0.0422),
            (0.0170, 0.0425),
            (0.0170, 0.036),
        ]
        add_revolved_profile(
            bm,
            pocket_ring_prof,
            center_three=(cx, ly, lz),
            segs=20,
            closed_profile=True,
            mat_idx=2,
            flip=flip_left,
            axis_flip_x=flip_left,
        )
        if include_lug_bolts:
            add_cylinder_between(bm, (wx(0.036), ly, lz), (wx(0.052), ly, lz), 0.011, 0.0105, segs=6, mat_idx=5, bevel=0.001)


def build_front_right_wheel(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    bm = bmesh.new()
    populate_dijon_wheel_bmesh(bm, center_three=(0.0, 0.0, 0.0), flip_left=False, include_lug_bolts=False)
    return create_object_from_bm(
        "Golf7_FrontRightWheel",
        bm,
        [mats["tire"], mats["alloy"], mats["alloy_pocket"], mats["gloss_black"], mats["chrome"], mats["bolt_chrome"]],
        loc_three=(WHEEL_CENTER_X, WHEEL_CENTER_Y, FRONT_AXLE_Z),
        sharp_angle_deg=38.0,
    )


# ---------------------------------------------------------------------------
# 6. Golf7_LugBolt_0 .. Golf7_LugBolt_4
# ---------------------------------------------------------------------------


def build_lug_bolts(mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    bolts: list[bpy.types.Object] = []
    for i in range(5):
        a = i * (2.0 * math.pi / 5.0) + math.pi / 10.0
        by = WHEEL_CENTER_Y + math.sin(a) * BOLT_CIRCLE_RADIUS
        bz = FRONT_AXLE_Z + math.cos(a) * BOLT_CIRCLE_RADIUS

        bm = bmesh.new()
        add_cylinder_between(bm, (0.0, 0.0, 0.0), (0.017, 0.0, 0.0), 0.011, 0.011, segs=6, mat_idx=0, bevel=0.0018)
        add_cylinder_between(bm, (-0.008, 0.0, 0.0), (0.0, 0.0, 0.0), 0.008, 0.0125, segs=20, mat_idx=0, bevel=0.001)
        add_cylinder_between(bm, (-0.036, 0.0, 0.0), (-0.008, 0.0, 0.0), 0.0063, 0.0068, segs=16, mat_idx=1, bevel=0.001)
        for tx in range(8):
            x_t = -0.033 + tx * 0.003
            add_cylinder_between(bm, (x_t, 0.0, 0.0), (x_t + 0.0014, 0.0, 0.0), 0.0070, 0.0070, segs=14, mat_idx=1)

        obj = create_object_from_bm(
            f"Golf7_LugBolt_{i}",
            bm,
            [mats["bolt_chrome"], mats["bolt_thread"]],
            loc_three=(0.796, by, bz),
            sharp_angle_deg=35.0,
        )
        bolts.append(obj)
    return bolts


# ---------------------------------------------------------------------------
# 7. Golf7_WheelLiner & 8. Golf7_LinerScrew_0 .. Golf7_LinerScrew_5
# ---------------------------------------------------------------------------

_LINER_SCREW_SPECS: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = [
    ((0.69, 0.24, -1.63), (0.60, 0.10, 0.78)),
    ((0.68, 0.56, -1.58), (0.60, -0.50, 0.62)),
    ((0.68, 0.67, -1.32), (0.55, -0.83, 0.0)),
    ((0.68, 0.56, -1.06), (0.60, -0.50, -0.62)),
    ((0.69, 0.24, -1.01), (0.60, 0.10, -0.78)),
    ((0.525, 0.44, -1.49), (1.0, 0.0, 0.0)),
]


def build_wheel_liner(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    Smooth molded matte-black plastic arch tunnel + inner vertical splash shield
    closing the FR wheel well cleanly up to the rolled fender lip while remaining 100% removable!
    """
    bm = bmesh.new()
    radius = 0.402
    inner_x = 0.505
    outer_x = 0.855

    arc_steps = 32
    a_start = math.pi + 0.28
    a_end = -0.28
    tunnel_outer_grid: list[list[Vector]] = []
    tunnel_inner_grid: list[list[Vector]] = []
    for i in range(arc_steps + 1):
        f = i / arc_steps
        a = lerp(a_start, a_end, f)
        ca, sa = math.cos(a), math.sin(a)
        z_out = FRONT_AXLE_Z + ca * radius
        y_out = WHEEL_CENTER_Y + sa * (radius + 0.040)
        rib = 0.004 * math.sin(f * math.pi * 12.0)
        r_surf = radius - rib
        z_in = FRONT_AXLE_Z + ca * r_surf
        y_in = WHEEL_CENTER_Y + sa * (r_surf + 0.040)

        z_lip = FRONT_AXLE_Z + ca * (radius - 0.004)
        y_lip = WHEEL_CENTER_Y + sa * (radius + 0.032)
        tunnel_inner_grid.append([
            v3(inner_x, y_out, z_out),
            v3(0.62, y_in, z_in),
            v3(0.75, y_out, z_out),
            v3(outer_x, y_lip, z_lip),
        ])
        tunnel_outer_grid.append([
            v3(inner_x - 0.004, y_out + 0.004, z_out),
            v3(0.62, y_in + 0.004, z_in),
            v3(0.75, y_out + 0.004, z_out),
            v3(outer_x + 0.004, y_lip + 0.004, z_lip),
        ])

    v_in = add_loft_grid(bm, tunnel_inner_grid, mat_idx=0, flip=False)
    v_out = add_loft_grid(bm, tunnel_outer_grid, mat_idx=0, flip=True)
    for i in range(arc_steps):
        add_quad_or_tri(bm, (v_in[i][-1], v_out[i][-1], v_out[i + 1][-1], v_in[i + 1][-1]), 0)
        add_quad_or_tri(bm, (v_in[i][0], v_in[i + 1][0], v_out[i + 1][0], v_out[i][0]), 0)

    # Inner vertical engine-bay splash shield wall (conceals serpentine/timing side cleanly until removed)
    z_cols, y_rows = 16, 8
    wall_front_grid: list[list[Vector]] = []
    wall_back_grid: list[list[Vector]] = []
    for iz in range(z_cols + 1):
        fz = iz / z_cols
        z = lerp(-1.70, -0.94, fz)
        dz = z - FRONT_AXLE_Z
        max_y = WHEEL_CENTER_Y + math.sqrt(max(0.0, radius * radius - dz * dz)) + 0.022 if abs(dz) < radius else 0.25
        min_y = 0.20
        col_f: list[Vector] = []
        col_b: list[Vector] = []
        for iy in range(y_rows + 1):
            fy = iy / y_rows
            y = lerp(min_y, max(min_y + 0.05, max_y), fy)
            rib_bulge = max(0.0, math.sin(fz * math.pi * 5.0) * 0.006 + (1.0 - abs(fz - 0.5) * 1.4) * 0.012)
            x = inner_x + rib_bulge
            col_f.append(v3(x, y, z))
            col_b.append(v3(x - 0.004, y, z))
        wall_front_grid.append(col_f)
        wall_back_grid.append(col_b)

    add_loft_grid(bm, wall_front_grid, mat_idx=0, flip=True)
    add_loft_grid(bm, wall_back_grid, mat_idx=0, flip=False)

    add_beveled_box(bm, (0.635, 0.265, -1.665), (0.24, 0.14, 0.016), (0.0, 0.12, 0.0), mat_idx=0, bevel=0.004)
    add_beveled_box(bm, (0.635, 0.265, -0.975), (0.24, 0.14, 0.016), (0.0, -0.12, 0.0), mat_idx=0, bevel=0.004)
    for idx in range(5):
        s_pos, s_dir = _LINER_SCREW_SPECS[idx]
        n = Vector(s_dir).normalized()
        back_p = (s_pos[0] - n.x * 0.006, s_pos[1] - n.y * 0.006, s_pos[2] - n.z * 0.006)
        front_p = (s_pos[0] + n.x * 0.001, s_pos[1] + n.y * 0.001, s_pos[2] + n.z * 0.001)
        add_cylinder_between(bm, back_p, front_p, 0.020, 0.018, segs=14, mat_idx=0, bevel=0.002)
        arch_pt = (0.74, s_pos[1] + n.y * -0.025, s_pos[2] + n.z * -0.025)
        add_cylinder_between(bm, back_p, arch_pt, 0.012, 0.015, segs=10, mat_idx=0)

    return create_object_from_bm(
        "Golf7_WheelLiner",
        bm,
        [mats["liner"]],
        loc_three=(0.0, 0.0, 0.0),
        sharp_angle_deg=42.0,
    )


def build_liner_screws(mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    screws: list[bpy.types.Object] = []
    for i, (pos, dir_vec) in enumerate(_LINER_SCREW_SPECS):
        d = Vector(dir_vec).normalized()
        p_washer0 = (-d.x * 0.001, -d.y * 0.001, -d.z * 0.001)
        p_washer1 = (d.x * 0.003, d.y * 0.003, d.z * 0.003)
        p_head1 = (d.x * 0.010, d.y * 0.010, d.z * 0.010)
        p_star0 = (d.x * 0.007, d.y * 0.007, d.z * 0.007)
        p_star1 = (d.x * 0.0112, d.y * 0.0112, d.z * 0.0112)

        bm = bmesh.new()
        add_cylinder_between(bm, p_washer0, p_washer1, 0.0115, 0.011, segs=18, mat_idx=0, bevel=0.0008)
        add_cylinder_between(bm, p_washer1, p_head1, 0.0080, 0.0072, segs=16, mat_idx=0, bevel=0.0012)
        add_cylinder_between(bm, p_star0, p_star1, 0.0040, 0.0042, segs=6, mat_idx=1)

        obj = create_object_from_bm(
            f"Golf7_LinerScrew_{i}",
            bm,
            [mats["screw_metal"], mats["screw_recess"]],
            loc_three=pos,
            sharp_angle_deg=35.0,
        )
        screws.append(obj)
    return screws


# ---------------------------------------------------------------------------
# Verification & Export
# ---------------------------------------------------------------------------


def verify_and_report(out_path: Path) -> None:
    """Verify node contract, zero rotation/scale, open FR wheel-well cavity, and materials."""
    expected_nodes: dict[str, tuple[float, float, float]] = {
        "Golf7_BodyShell": t2b(0.0, 0.0, 0.0),
        "Golf7_HoodPivot": t2b(0.0, HOOD_HINGE_Y, HOOD_HINGE_Z),
        "Golf7_EngineCover": t2b(0.02, 0.77, -1.32),
        "Golf7_FrontRightSuspension": t2b(0.0, 0.0, 0.0),
        "Golf7_WheelHub": t2b(HUB_FACE_X, WHEEL_CENTER_Y, FRONT_AXLE_Z),
        "Golf7_FrontRightWheel": t2b(WHEEL_CENTER_X, WHEEL_CENTER_Y, FRONT_AXLE_Z),
        "Golf7_WheelLiner": t2b(0.0, 0.0, 0.0),
    }
    for i in range(5):
        a = i * (2.0 * math.pi / 5.0) + math.pi / 10.0
        expected_nodes[f"Golf7_LugBolt_{i}"] = t2b(
            0.796, WHEEL_CENTER_Y + math.sin(a) * BOLT_CIRCLE_RADIUS, FRONT_AXLE_Z + math.cos(a) * BOLT_CIRCLE_RADIUS
        )
    for i, (pos, _) in enumerate(_LINER_SCREW_SPECS):
        expected_nodes[f"Golf7_LinerScrew_{i}"] = t2b(*pos)

    for name, exp_loc in expected_nodes.items():
        obj = bpy.data.objects.get(name)
        assert obj is not None, f"Missing required node: {name}"
        for k in range(3):
            assert abs(obj.location[k] - exp_loc[k]) < 1e-5, f"{name} location mismatch: {tuple(obj.location)} != {exp_loc}"
            assert abs(obj.rotation_euler[k]) < 1e-6, f"{name} rotation not zero: {tuple(obj.rotation_euler)}"
            assert abs(obj.scale[k] - 1.0) < 1e-6, f"{name} scale not 1: {tuple(obj.scale)}"

    assert "Golf7_Paint" in bpy.data.materials, "Missing Golf7_Paint material"

    depsgraph = bpy.context.evaluated_depsgraph_get()
    body_root = bpy.data.objects["Golf7_BodyShell"]
    arch_violations = 0
    bay_violations = 0
    for child in body_root.children_recursive:
        if child.type != "MESH":
            continue
        ev = child.evaluated_get(depsgraph)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            wb = mw @ v.co
            xt, yt, zt = wb.x, wb.z, -wb.y
            if 0.45 <= xt <= 0.84 and 0.16 <= yt <= 0.78 and -1.72 <= zt <= -0.92:
                dz = zt - FRONT_AXLE_Z
                u = dz / 0.395
                arch_y = ARCH_SPRING_Y + (0.745 - ARCH_SPRING_Y) * math.sqrt(max(0.0, 1.0 - u * u)) if abs(u) < 1.0 else 0.16
                if yt < arch_y:
                    arch_violations += 1
                if xt <= 0.64 and yt <= 0.745:
                    bay_violations += 1
        ev.to_mesh_clear()

    assert arch_violations == 0, f"FR wheel arch cutout has {arch_violations} vertices from BodyShell!"
    assert bay_violations == 0, f"FR inner wheel bay (X<=0.64) has {bay_violations} vertices from BodyShell!"
    print(f"[Verify] All {len(expected_nodes)} required nodes verified (rot=0, scale=1). Arch violations: 0, Bay violations: 0.")


def resolve_output_path() -> Path:
    if "--" in sys.argv:
        extra = sys.argv[sys.argv.index("--") + 1 :]
        if "--out" in extra:
            idx = extra.index("--out")
            if idx + 1 < len(extra):
                return Path(extra[idx + 1]).resolve()

    project_root = Path(__file__).resolve().parent.parent
    repo_public = project_root.parent.parent / "public" / "golf7-keilriemen-3d" / "models" / "golf7.glb"
    if repo_public.parent.exists():
        return repo_public
    return project_root / "public" / "models" / "golf7.glb"


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)

    images = build_textures()
    mats = build_materials(images)

    build_body_shell(mats)
    build_hood(mats)
    build_engine_cover(mats)
    build_front_right_suspension(mats)
    build_wheel_hub(mats)
    build_front_right_wheel(mats)
    build_lug_bolts(mats)
    build_wheel_liner(mats)
    build_liner_screws(mats)

    out_path = resolve_output_path()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    verify_and_report(out_path)

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
    )

    size_bytes = out_path.stat().st_size
    print(f"[Export] Wrote {out_path} ({size_bytes / (1024 * 1024):.2f} MB / {size_bytes} bytes)")


if __name__ == "__main__":
    import traceback
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
