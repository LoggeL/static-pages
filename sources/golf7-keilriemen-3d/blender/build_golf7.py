#!/usr/bin/env python3
"""
Procedural Class-A 3D model generator for the VW Golf Mk7 (1.6 TDI EA288)
in Tornado Red (LY3D) for Blender 5.2 LTS -> glTF 2.0 (.glb) export.

Usage:
    blender --background --python blender/build_golf7.py

Coordinate contract:
    Three.js (+X right, +Y up, +Z rear / -Z front)
    -> Blender (+X right, +Y front, +Z up) via t2b(x, y, z) = (x, -z, y)
    -> glTF export_yup=True converts cleanly back to Three.js world space.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import Callable, Iterable, Sequence

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
ARCH_SPRING_Y = 0.320
ARCH_CROWN_Y = 0.750


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


# ---------------------------------------------------------------------------
# Clean Procedural 2D Anti-Aliased Canvas (Pure Python -> bpy.data.images)
# ---------------------------------------------------------------------------

# Stroke glyph definitions in normalized [0..1] x [0..1] box (x left->right, y top->bottom)
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
        # Flip Y so y=0 is top in canvas space, matching PNG top-down layout
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
    # 1. German License Plate "WOB MK 700" (768 x 168)
    pw, ph = 768, 168
    pc = PixelCanvas(pw, ph, (0.96, 0.97, 0.98, 1.0))
    pc.stroke_rect(2, 2, pw - 2, ph - 2, 7.0, (0.06, 0.08, 0.11))
    # EU blue strip
    pc.fill_rect(8, 8, 78, ph - 8, (0.09, 0.25, 0.72))
    # 12 EU yellow stars in circle
    for k in range(12):
        ang = k * (2.0 * math.pi / 12.0)
        pc.fill_circle(43 + math.cos(ang) * 20, 48 + math.sin(ang) * 20, 2.6, (0.98, 0.82, 0.12))
    pc.draw_text("D", 28, 96, 30, 44, 3.6, (0.98, 0.99, 1.0))
    # "WOB"
    pc.draw_text("WOB", 98, 30, 56, 108, 6.8, (0.06, 0.08, 0.11), advance=68)
    # HU + Niedersachsen registration seals
    pc.fill_circle(334, 54, 15, (0.85, 0.24, 0.18))
    pc.fill_circle(334, 54, 9, (0.96, 0.85, 0.35))
    pc.fill_circle(334, 114, 17, (0.14, 0.42, 0.75))
    pc.fill_circle(334, 114, 11, (0.93, 0.94, 0.96))
    pc.fill_circle(334, 114, 4, (0.82, 0.14, 0.16))
    # "MK 700"
    pc.draw_text("MK 700", 368, 30, 54, 108, 6.8, (0.06, 0.08, 0.11), advance=64)
    plate_img = pc.to_packed_image("Golf7_LicensePlateTex")

    # 2. EA288 TDI Engine Cover Plaque (512 x 224)
    tw, th = 512, 224
    tc = PixelCanvas(tw, th, (0.12, 0.14, 0.18, 1.0))
    # Brushed horizontal sheen bands
    for y in range(12, th - 12, 6):
        shade = 0.135 if (y // 6) % 2 == 0 else 0.115
        tc.fill_rect(12, y, tw - 12, y + 3, (shade, shade + 0.015, shade + 0.03))
    tc.stroke_rect(8, 8, tw - 8, th - 8, 5.0, (0.48, 0.54, 0.62))
    # Left VW Roundel
    tc.fill_circle(92, 112, 58, (0.07, 0.09, 0.12))
    tc.stroke_circle(92, 112, 54, 7.5, (0.82, 0.86, 0.92))
    tc.draw_capsule(60, 74, 92, 115, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(124, 74, 92, 115, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(50, 92, 74, 152, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(74, 152, 92, 122, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(92, 122, 110, 152, 4.5, (0.84, 0.88, 0.94))
    tc.draw_capsule(110, 152, 134, 92, 4.5, (0.84, 0.88, 0.94))
    # Bold "TD" silver + "I" Tornado Red + "1.6 EA288"
    tc.draw_text("TD", 188, 42, 74, 96, 9.0, (0.88, 0.91, 0.95), advance=88)
    tc.draw_text("I", 364, 42, 74, 96, 9.0, (0.86, 0.10, 0.12), advance=74)
    tc.draw_text("1.6 EA288", 190, 156, 22, 34, 2.8, (0.64, 0.70, 0.78), advance=29)
    tdi_img = tc.to_packed_image("Golf7_TDIPlaqueTex")

    # 3. Lower Air Dam Honeycomb Texture (256 x 128)
    hw, hh = 256, 128
    hc = PixelCanvas(hw, hh, (0.03, 0.035, 0.045, 1.0))
    r = 12.0
    dx = r * 1.5
    dy = r * math.sqrt(3.0)
    for col in range(-1, 16):
        for row in range(-1, 8):
            cx = col * dx
            cy = row * dy + (0.0 if col % 2 == 0 else dy * 0.5)
            pts = [(cx + r * math.cos(k * math.pi / 3.0), cy + r * math.sin(k * math.pi / 3.0)) for k in range(6)]
            for k in range(6):
                p0, p1 = pts[k], pts[(k + 1) % 6]
                hc.draw_capsule(p0[0], p0[1], p1[0], p1[1], 1.6, (0.16, 0.18, 0.22))
    honeycomb_img = hc.to_packed_image("Golf7_HoneycombTex")

    # 4. Machined Concentric Brake Rotor Texture (256 x 256)
    rw, rh = 256, 256
    rc = PixelCanvas(rw, rh, (0.68, 0.71, 0.76, 1.0))
    for rad in range(56, 126, 3):
        shade = 0.56 if rad % 6 == 0 else 0.78
        rc.stroke_circle(128, 128, rad, 1.3, (shade, shade + 0.02, shade + 0.04))
    rotor_img = rc.to_packed_image("Golf7_RotorTex")

    return {
        "plate": plate_img,
        "tdi_plaque": tdi_img,
        "honeycomb": honeycomb_img,
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
        # Iconic VW Golf Mk7 Tornado Red (LY3D) with clearcoat — exact required name
        "paint": make_mat(
            "Golf7_Paint",
            base_color=(0.48, 0.015, 0.022, 1.0),
            metallic=0.38,
            roughness=0.14,
            coat_weight=1.0,
            coat_roughness=0.04,
            double_sided=False,
        ),
        "glass": make_mat(
            "Golf7_Glass",
            base_color=(0.012, 0.020, 0.032, 1.0),
            metallic=0.08,
            roughness=0.06,
            alpha=0.88,
            coat_weight=1.0,
            coat_roughness=0.04,
            double_sided=True,
        ),
        "headlight_lens": make_mat(
            "Golf7_HeadlightLens",
            base_color=(0.92, 0.96, 1.0, 1.0),
            metallic=0.05,
            roughness=0.04,
            alpha=0.24,
            coat_weight=1.0,
            coat_roughness=0.03,
            double_sided=True,
        ),
        "drl": make_mat(
            "Golf7_DRL",
            base_color=(0.95, 0.98, 1.0, 1.0),
            metallic=0.0,
            roughness=0.12,
            emit_color=(0.88, 0.96, 1.0, 1.0),
            emit_strength=1.9,
        ),
        "amber": make_mat(
            "Golf7_TurnAmber",
            base_color=(0.95, 0.45, 0.02, 1.0),
            metallic=0.1,
            roughness=0.2,
            emit_color=(0.95, 0.42, 0.02, 1.0),
            emit_strength=0.35,
        ),
        "tail_led": make_mat(
            "Golf7_TailLED",
            base_color=(0.85, 0.04, 0.04, 1.0),
            metallic=0.0,
            roughness=0.18,
            emit_color=(0.95, 0.06, 0.05, 1.0),
            emit_strength=0.9,
        ),
        "tail_lens": make_mat(
            "Golf7_TailLens",
            base_color=(0.45, 0.015, 0.02, 1.0),
            metallic=0.08,
            roughness=0.08,
            alpha=0.68,
            coat_weight=1.0,
            coat_roughness=0.04,
            double_sided=True,
        ),
        "tail_white": make_mat(
            "Golf7_TailWhite",
            base_color=(0.92, 0.94, 0.96, 1.0),
            metallic=0.1,
            roughness=0.15,
            emit_color=(0.92, 0.95, 1.0, 1.0),
            emit_strength=0.25,
        ),
        "gloss_black": make_mat(
            "Golf7_GlossBlack",
            base_color=(0.02, 0.024, 0.03, 1.0),
            metallic=0.22,
            roughness=0.18,
            coat_weight=0.85,
            coat_roughness=0.06,
        ),
        "matte_trim": make_mat(
            "Golf7_MatteTrim",
            base_color=(0.035, 0.04, 0.048, 1.0),
            metallic=0.05,
            roughness=0.72,
        ),
        "chrome": make_mat(
            "Golf7_Chrome",
            base_color=(0.88, 0.90, 0.92, 1.0),
            metallic=0.95,
            roughness=0.12,
        ),
        "mirror_glass": make_mat(
            "Golf7_MirrorGlass",
            base_color=(0.65, 0.72, 0.80, 1.0),
            metallic=0.96,
            roughness=0.05,
        ),
        "honeycomb": make_mat(
            "Golf7_Honeycomb",
            base_color=(1.0, 1.0, 1.0, 1.0),
            metallic=0.1,
            roughness=0.68,
            image=images["honeycomb"],
        ),
        "plate": make_mat(
            "Golf7_LicensePlate",
            base_color=(1.0, 1.0, 1.0, 1.0),
            metallic=0.05,
            roughness=0.35,
            image=images["plate"],
        ),
        "interior": make_mat(
            "Golf7_Interior",
            base_color=(0.04, 0.045, 0.055, 1.0),
            metallic=0.02,
            roughness=0.85,
        ),
        "bay_steel": make_mat(
            "Golf7_BaySteel",
            base_color=(0.055, 0.062, 0.075, 1.0),
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
            base_color=(0.032, 0.036, 0.042, 1.0),
            metallic=0.12,
            roughness=0.78,
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
            base_color=(0.76, 0.80, 0.85, 1.0),
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
            roughness=0.76,
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
            base_color=(0.028, 0.031, 0.037, 1.0),
            metallic=0.05,
            roughness=0.80,
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


def mirror_bmesh_x(bm: bmesh.types.BMesh, crease_layer: bmesh.types.BMLayerItem | None = None, weld_dist: float = 0.0003) -> None:
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
    # Build in local Three.js axes mapped to Blender axes: (sx, sz, sy)
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

    box_faces = set()
    for v in verts:
        for f in v.link_faces:
            box_faces.add(f)
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
    """
    Revolve a 2D profile [(radius, x_offset), ...] around the X axis (Three.js wheel/hub axis),
    auto-orienting closed profiles so normals always point outward.
    """
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
            # Outward at ang=0 in Blender (x, y=-r): (x_mid - xc, -(r_mid - rc)) dot (+dr, +dx)
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

    # Initial frame
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
# Golf 7 Surface Shaping Functions
# ---------------------------------------------------------------------------


def hood_profile(lx: float, lz: float) -> float:
    """
    Exact Golf 7 hood surface Y_world(lx, lz_local) relative to hinge (0, 0.94, -0.82).
    lz runs from 0.0 (cowl) to -1.24 (nose lip).
    """
    tz = clamp(-lz / 1.24, 0.0, 1.0)
    half_w = 0.735 - (tz ** 1.28) * 0.115
    fx = clamp(lx / max(half_w, 0.1), -1.0, 1.0)
    slope_y = -tz * 0.210 - (tz * tz) * 0.024 + math.sin(tz * math.pi) * 0.024
    crown = (1.0 - fx * fx) * 0.030 * (1.0 - tz * 0.22)
    # Golf 7 signature twin V-creases converging from A-pillar roots toward grille edges
    crease_u = 0.74 - tz * 0.28
    d = abs(abs(fx) - crease_u)
    v_crease = max(0.0, 1.0 - d / 0.075) ** 2 * 0.011 * math.sin(clamp(tz, 0.05, 0.95) * math.pi)
    return HOOD_HINGE_Y + slope_y + crown + v_crease


def hood_half_width(tz: float) -> float:
    return 0.735 - (clamp(tz, 0.0, 1.0) ** 1.28) * 0.115


def body_plan_half_width(z: float) -> float:
    """Golf 7 plan-view half-width at shoulder/mid flank."""
    base = 0.858 + 0.008 * math.cos(clamp(z / 1.5, -1.0, 1.0) * math.pi * 0.5)
    if z < -1.68:
        t = clamp((-1.68 - z) / 0.445, 0.0, 1.0)
        base -= 0.185 * (t ** 2.05)
    elif z > 1.64:
        t = clamp((z - 1.64) / 0.44, 0.0, 1.0)
        base -= 0.145 * (t ** 1.9)
    return base


def tornado_line_y(z: float) -> float:
    """Iconic Golf 7 sharp character line rising gently from front headlight corner to taillight corner."""
    u = clamp((z + 2.02) / 3.98, 0.0, 1.0)
    return 0.680 + u * 0.220


def body_side_x(z: float, y: float, y_top: float) -> float:
    """
    Golf 7 cross-sectional X half-width with rocker tuck, lower sculpt,
    sharp Tornado Line shoulder break, tumblehome, and wheel-arch eyebrow flares.
    """
    bw = body_plan_half_width(z)

    # Subtle sculpted fender eyebrow flare around front and rear wheel cutouts
    for az in (FRONT_AXLE_Z, REAR_AXLE_Z):
        dz = z - az
        dy = y - ARCH_SPRING_Y
        r_ell = math.hypot(dz / 0.48, max(0.0, dy) / 0.50)
        if r_ell < 1.08 and y >= 0.26:
            w_rad = math.sin(clamp((1.08 - r_ell) / 0.30, 0.0, 1.0) * math.pi * 0.8)
            bw += 0.022 * w_rad

    # Vertical section sculpt
    y_torn = tornado_line_y(z)
    if y < 0.245:
        t = clamp((0.245 - y) / 0.085, 0.0, 1.0)
        return bw - 0.032 * (t ** 1.2)
    if y < 0.50:
        # Subtle lower door concavity catching workshop floor highlight
        mid = math.sin(((y - 0.245) / 0.255) * math.pi)
        return bw - 0.015 * mid
    if y <= y_torn:
        p = (y - 0.50) / max(0.05, y_torn - 0.50)
        return bw + 0.010 * p

    # Tumblehome above Tornado shoulder line to beltline/window sill (scaled smoothly over narrow front nose)
    span = max(0.05, y_top - y_torn)
    t_top = clamp((y - y_torn) / span, 0.0, 1.0)
    tuck = (0.102 * clamp(span / 0.18, 0.28, 1.0)) if y_top < 1.1 else 0.145
    return bw + 0.010 - t_top * tuck


def beltline_y(z: float) -> float:
    """Upper window sill / front fender hood-line height."""
    if z <= -0.82:
        tz = clamp((-0.82 - z) / 1.24, 0.0, 1.0)
        return hood_profile(hood_half_width(tz), -tz * 1.24) - 0.002
    u = clamp((z + 0.82) / 1.80, 0.0, 1.0)
    return 0.935 + u * 0.058


def door_shutline_recess(z: float, y: float) -> float:
    """Subtle 3mm panel gap V-groove on door seams at Z = -0.80, 0.06, 0.84."""
    if y < 0.18 or y > 0.99:
        return 0.0
    for sz in (-0.80, 0.06, 0.84):
        dz = abs(z - sz)
        if dz < 0.009:
            return -0.0035 * (1.0 - dz / 0.009)
    return 0.0


# ---------------------------------------------------------------------------
# 1. Golf7_BodyShell Builder
# ---------------------------------------------------------------------------


def build_polar_arch_panel(
    bm: bmesh.types.BMesh,
    crease_layer: bmesh.types.BMLayerItem,
    axle_z: float,
    z_front: float,
    z_rear: float,
    y_bot_front: float,
    y_bot_rear: float,
    get_top_y: Callable[[float], float],
    mat_idx: int = 0,
    door_grooves: bool = False,
) -> tuple[list[Vector], list[Vector]]:
    """
    Build a 100%-quad sculpted fender/quarter panel around a semicircular wheel arch cutout
    with a rolled inward sheet-metal lip, eyebrow flare, and Tornado character crease.
    Returns (front_col_outer_pts, rear_col_outer_pts) for seamless stitching.
    """
    # 16 angular arch stations from front spring (i=0) over crown (i=8) to rear spring (i=16)
    # Plus 2 vertical drop stations below springY on front & rear ends -> 21 perimeter samples (0..20)
    n_arc = 16
    perim_in: list[tuple[float, float]] = []
    perim_out: list[tuple[float, float]] = []

    # Front lower drop (2 points below springY)
    perim_in.append((axle_z - ARCH_HALF_Z, y_bot_front))
    perim_in.append((axle_z - ARCH_HALF_Z, 0.245))
    perim_out.append((z_front, y_bot_front))
    perim_out.append((z_front, 0.245))

    # Arch perimeter i=0..16 from front spring (-ARCH_HALF_Z) over crown (+0.750) to rear spring (+ARCH_HALF_Z)
    for i in range(n_arc + 1):
        a = math.pi * (1.0 - i / n_arc)
        zi = axle_z + ARCH_HALF_Z * math.cos(a)
        yi = ARCH_SPRING_Y + (ARCH_CROWN_Y - ARCH_SPRING_Y) * math.sin(a)
        perim_in.append((zi, yi))

        if i <= 3:
            # Front edge rising from 0.32 -> get_top_y(z_front)
            f = i / 4.0
            y_top_f = get_top_y(z_front)
            perim_out.append((z_front, ARCH_SPRING_Y + f * (y_top_f - ARCH_SPRING_Y)))
        elif i <= 12:
            # Top edge spanning z_front -> z_rear along top shoulder / beltline (i=4 is exact front-top corner, i=12 is rear-top!)
            f = (i - 4) / 8.0
            zo = z_front + f * (z_rear - z_front)
            perim_out.append((zo, get_top_y(zo)))
        else:
            # Rear edge descending from get_top_y(z_rear) -> 0.32
            f = (16 - i) / 4.0
            y_top_r = get_top_y(z_rear)
            perim_out.append((z_rear, ARCH_SPRING_Y + f * (y_top_r - ARCH_SPRING_Y)))

    # Rear lower drop (2 points below springY)
    perim_in.append((axle_z + ARCH_HALF_Z, 0.245))
    perim_in.append((axle_z + ARCH_HALF_Z, y_bot_rear))
    perim_out.append((z_rear, 0.245))
    perim_out.append((z_rear, y_bot_rear))

    # Build 5 concentric rings across the panel:
    # Ring 0: inner rolled arch return lip (tucked 0.025m in -X, stays X >= 0.845 at crown!)
    # Ring 1: crisp arch lip edge
    # Ring 2: eyebrow flare ridge (~42% blend)
    # Ring 3: tornado crease intermediate (~75% blend)
    # Ring 4: outer boundary frame
    grid: list[list[Vector]] = []
    ring_fracs = [0.0, 0.0, 0.24, 0.62, 1.0]

    n_perim = len(perim_in)
    for r_idx, frac in enumerate(ring_fracs):
        row: list[Vector] = []
        for p_idx in range(n_perim):
            zi, yi = perim_in[p_idx]
            zo, yo = perim_out[p_idx]
            z = zi + (zo - zi) * frac
            y = yi + (yo - yi) * frac

            # Snap Ring 3 on the top span to the Tornado Line height for crisp Golf 7 shoulder crease!
            if r_idx == 3 and 6 <= p_idx <= 14:
                y = min(yo - 0.020, tornado_line_y(z))

            top_ref = get_top_y(z)
            x = body_side_x(z, y, top_ref)
            if door_grooves:
                x += door_shutline_recess(z, y)

            if r_idx == 0:
                # Rolled sheet-metal flange inward, keeping cavity X <= 0.84 strictly open
                x -= 0.018
                if y >= ARCH_SPRING_Y:
                    y += 0.004
            elif r_idx == 2:
                # Subtle eyebrow crest
                x += 0.004

            row.append(v3(x, y, z))
        grid.append(row)

    add_loft_grid(
        bm,
        grid,
        mat_idx=mat_idx,
        closed_u=False,
        crease_layer=crease_layer,
        crease_rows={1: 0.82, 2: 0.35, 3: 0.68, 4: 0.92},
        crease_cols={0: 0.92, 6: 0.92, 14: 0.92, n_perim - 1: 0.92},
        outward_dir=Vector((1.0, 0.0, 0.0)),
        outward_rows=(1, 4),
    )

    front_col = [grid[4][0], grid[4][1], grid[4][2], grid[4][3], grid[4][4], grid[4][5]]
    rear_col = [grid[4][-1], grid[4][-2], grid[4][-3], grid[4][-4], grid[4][-5], grid[4][-6]]
    return front_col, rear_col


def build_body_shell(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """
    Build Golf7_BodyShell at t2b(0,0,0) with Class-A Subsurf exterior, seamless A-pillars,
    true open front-right wheel well cavity (X in [0.45,0.84], Y in [0.16,0.78], Z in [-1.72,-0.92]),
    Mk7 Double-U LED headlights, 3D VW emblems, protruding WOB MK 700 plates, cabin, engine bay,
    and 3 static Dijon wheels + brakes.
    """
    root = create_empty("Golf7_BodyShell", (0.0, 0.0, 0.0))

    # =========================================================================
    # 1. EXTERIOR PAINTED SHELL (Golf7_Paint + SUBSURF level 2)
    # =========================================================================
    bm_paint = bmesh.new()
    cr = bm_paint.edges.layers.float.new("crease_edge")

    # 1A. Front Fender Panel (Z = -1.78 .. -0.82, around front wheel arch Z = -1.32)
    def front_fender_top_y(z: float) -> float:
        tz = clamp((-0.82 - z) / 1.24, 0.0, 1.0)
        return hood_profile(hood_half_width(tz), -tz * 1.24) - 0.002

    build_polar_arch_panel(
        bm_paint,
        cr,
        axle_z=FRONT_AXLE_Z,
        z_front=-1.76,
        z_rear=-0.812,
        y_bot_front=0.175,
        y_bot_rear=0.160,
        get_top_y=front_fender_top_y,
        mat_idx=0,
        door_grooves=False,
    )

    def nose_x_cap(z: float) -> float:
        # Smooth plan envelope hugging headlight/bumper wrap from grille corner (-2.045) to front arch (-1.755)
        u = clamp((z - -2.045) / (-1.755 - -2.045), 0.0, 1.0)
        return 0.636 + smoothstep(0.0, 1.0, u) * 0.230

    # Front fender nose extension wrapping smoothly over headlight & stitched seamlessly to front arch (-2.045 .. -1.755)
    fender_nose_z = [-2.045, -1.96, -1.86, -1.755]
    fender_nose_grid: list[list[Vector]] = []
    for z in fender_nose_z:
        tz = clamp((-0.82 - z) / 1.24, 0.0, 1.0)
        y_top = front_fender_top_y(z)
        x_hood = hood_half_width(tz) + 0.004
        # Smooth eyebrow drop over headlight -> full side cheek transition at -1.755
        if z < -1.90:
            y_bot = 0.695
        elif z < -1.82:
            y_bot = 0.660
        else:
            y_bot = 0.602
        y_mid = (y_top + y_bot) * 0.52
        xc = nose_x_cap(z)
        x_top_side = min(body_side_x(z, y_top, y_top), xc - 0.006)
        x_mid_side = min(body_side_x(z, y_mid, y_top), xc)
        x_bot_side = min(body_side_x(z, y_bot, y_top), xc)
        col = [
            v3(x_hood - 0.022, y_top - 0.014, z),
            v3(x_hood, y_top, z),
            v3(max(x_hood + 0.006, x_top_side), y_top - 0.002, z),
            v3(max(x_hood + 0.008, x_mid_side), y_mid, z),
            v3(max(x_hood + 0.008, x_bot_side), y_bot, z),
        ]
        fender_nose_grid.append(col)
    add_loft_grid(
        bm_paint,
        fender_nose_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.90, 3: 0.92},
        crease_cols={0: 0.85, 1: 0.80, 4: 0.90},
        outward_dir=Vector((1.0, 0.2, 0.2)),
    )

    # Hood gutter shelf along front fender top (-1.76 .. -0.82)
    gutter_z = [-1.76, -1.60, -1.42, -1.24, -1.04, -0.82]
    gutter_grid: list[list[Vector]] = []
    for z in gutter_z:
        tz = clamp((-0.82 - z) / 1.24, 0.0, 1.0)
        y_top = front_fender_top_y(z)
        x_hood = hood_half_width(tz) + 0.004
        x_outer = body_side_x(z, y_top, y_top)
        gutter_grid.append([
            v3(x_hood - 0.020, y_top - 0.012, z),
            v3(x_hood, y_top, z),
            v3(x_outer, y_top, z),
        ])
    add_loft_grid(
        bm_paint,
        gutter_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_cols={1: 0.7, 2: 0.6},
        outward_dir=Vector((0.0, 0.0, 1.0)),
    )

    # 1B. Doors & Sill Body Side (Z = -0.825 .. +0.865, overlapping slightly with fender/quarter creases!)
    door_z = [-0.825, -0.80, -0.58, -0.32, -0.04, 0.05, 0.06, 0.07, 0.24, 0.48, 0.72, 0.84, 0.865]
    door_grid: list[list[Vector]] = []
    for z in door_z:
        y_top = beltline_y(z)
        y_torn = tornado_line_y(z)
        ys = [
            0.160,
            0.160,
            0.245,
            0.320,
            0.480,
            y_torn,
            y_torn + (y_top - y_torn) * 0.52,
            y_top,
        ]
        col: list[Vector] = []
        for idx_y, y in enumerate(ys):
            x = body_side_x(z, y, y_top) + door_shutline_recess(z, y)
            if idx_y == 0:
                x -= 0.030  # inward rocker pinch return
            col.append(v3(x, y, z))
        col.append(v3(body_side_x(z, y_top, y_top) - 0.028, y_top - 0.006, z))
        door_grid.append(col)
    add_loft_grid(
        bm_paint,
        door_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.8, len(door_z) - 1: 0.8},
        crease_cols={1: 0.7, 5: 0.78, 7: 0.72},
        outward_dir=Vector((1.0, 0.0, 0.0)),
    )

    # 1C. Rear Quarter Panel around rear wheel arch (Z = +0.86 .. +1.80)
    def rear_lower_top_y(z: float) -> float:
        return 0.985 + clamp((z - 0.86) / 0.94, 0.0, 1.0) * 0.015

    build_polar_arch_panel(
        bm_paint,
        cr,
        axle_z=REAR_AXLE_Z,
        z_front=0.852,
        z_rear=1.80,
        y_bot_front=0.160,
        y_bot_rear=0.220,
        get_top_y=rear_lower_top_y,
        mat_idx=0,
        door_grooves=True,
    )

    # Rear quarter tail corner wrap closing seamlessly around taillight & bumper corner (+1.795 .. +1.97)
    rq_tail_z = [1.795, 1.88, 1.97]
    rq_tail_ys = [0.220, 0.34, 0.56, 0.79, 0.90, 0.995]
    rq_tail_grid: list[list[Vector]] = []
    for z in rq_tail_z:
        col = []
        for y in rq_tail_ys:
            x = body_side_x(z, y, rear_lower_top_y(z))
            if z > 1.88:
                x -= (z - 1.88) / 0.09 * 0.095
            col.append(v3(x, y, z))
        rq_tail_grid.append(col)
    add_loft_grid(
        bm_paint,
        rq_tail_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.90, 2: 0.88},
        crease_cols={0: 0.85, 4: 0.65, 5: 0.90},
        outward_dir=Vector((1.0, -0.3, 0.0)),
    )

    # 1D. Seamless Greenhouse: Roof + Closed 3D A-Pillars + Closed 3D C-Pillars + Roof Spoiler
    def roof_edge_xy(z: float) -> tuple[float, float, float]:
        if z <= 1.46:
            tz = clamp((z - -0.22) / (1.46 - -0.22), 0.0, 1.0)
            x_e = 0.595 - tz * 0.022 + math.sin(tz * math.pi) * 0.010
            y_e = 1.415 + math.sin(tz * math.pi * 0.82) * 0.024 - tz * 0.030
            cam = 0.022 * (1.0 - 0.15 * tz)
        else:
            ts = clamp((z - 1.46) / 0.14, 0.0, 1.0)
            x_e = 0.573 - ts * 0.018
            y_e = 1.385 - ts * 0.014
            cam = 0.018 * (1.0 - ts * 0.2)
        return x_e, y_e, cam

    roof_z_stations = [-0.22, -0.02, 0.25, 0.55, 0.88, 1.20, 1.46, 1.60]
    roof_grid: list[list[Vector]] = []
    for iz, z in enumerate(roof_z_stations):
        x_edge, y_edge, camber = roof_edge_xy(z)
        row = []
        for ix in range(6):
            fx = ix / 5.0
            x = fx * x_edge
            y = y_edge + camber * (1.0 - fx * fx)
            row.append(v3(x, y, z))
        row.append(v3(x_edge + 0.008, y_edge - 0.018, z))
        roof_grid.append(row)

    add_loft_grid(
        bm_paint,
        roof_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.85, 6: 0.55, 7: 0.88},
        crease_cols={5: 0.72, 6: 0.85},
        outward_dir=Vector((0.0, 0.0, 1.0)),
    )

    sp_under = [
        [v3(0.0, 1.403, 1.46), v3(0.28, 1.399, 1.46), v3(0.573, 1.367, 1.46)],
        [v3(0.0, 1.385, 1.60), v3(0.28, 1.380, 1.60), v3(0.555, 1.353, 1.60)],
    ]
    add_loft_grid(bm_paint, sp_under, mat_idx=0, crease_layer=cr, outward_dir=Vector((0.0, 0.0, -1.0)))

    # Closed 3D Sculpted A-Pillar Beam flush into cowl (t=0, Z=-0.825) and roof header (t=1, Z=-0.220)
    ap_steps = 8
    ap_outer_grid: list[list[Vector]] = []
    for i in range(ap_steps + 1):
        t = i / ap_steps
        z = -0.825 + t * 0.605
        y_top = 0.933 + t * (1.415 - 0.933) + math.sin(t * math.pi) * 0.015
        x_out = 0.742 - t * (0.742 - 0.595) + math.sin(t * math.pi) * 0.010
        x_in = x_out - (0.068 - t * 0.010)
        p0 = v3(x_in, y_top - 0.002, z + 0.014)
        p1 = v3(x_in + 0.014, y_top + 0.002, z)
        p2 = v3(x_out, y_top, z)
        p3 = v3(x_out + 0.008, y_top - 0.018, z + 0.014)
        p4 = v3(x_in + 0.012, y_top - 0.036, z + 0.034)
        ap_outer_grid.append([p0, p1, p2, p3, p4, p0])
    add_loft_grid(
        bm_paint,
        ap_outer_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.95, ap_steps: 0.95},
        crease_cols={1: 0.65, 2: 0.75, 3: 0.75},
        flip=False,
    )

    # Closed 3D Golf 7 C-Pillar Beam smoothly flowing from rear quarter top edge (no 7cm step!) to roof rail
    cp_rows = 8
    cp_grid: list[list[Vector]] = []
    for ir in range(cp_rows):
        v = ir / (cp_rows - 1)
        sv = smoothstep(0.0, 1.0, v)
        z_front = 0.96 + sv * (1.16 - 0.96)
        z_rear = 1.855 - sv * (1.855 - 1.470)
        z_m1 = z_front + (z_rear - z_front) * 0.35
        z_m2 = z_front + (z_rear - z_front) * 0.72
        row_zs = [z_front, z_m1, z_m2, z_rear]
        pts_out = []
        for idx_z, zc in enumerate(row_zs):
            x_re, y_re, _ = roof_edge_xy(zc)
            y = 0.978 + v * (y_re - 0.978)
            x_bot = body_side_x(zc, 0.985, rear_lower_top_y(zc))
            x_out = x_bot + v * (x_re - x_bot) + 0.008 * math.sin(v * math.pi)
            if idx_z == 3:
                x_out -= 0.012 * (1.0 - v * 0.4)
            pts_out.append((x_out, y, zc))
        xf, yf, zf = pts_out[0]
        xm1, ym1, zm1 = pts_out[1]
        xm2, ym2, zm2 = pts_out[2]
        xr, yr, zr = pts_out[3]
        p0 = v3(xf - 0.048, yf - 0.010, zf + 0.012)
        p1 = v3(xf, yf, zf)
        p2 = v3(xm1 + 0.004, ym1, zm1)
        p3 = v3(xm2, ym2, zm2)
        p4 = v3(xr, yr, zr)
        p5 = v3(xr - 0.056, yr - 0.012, zr - 0.008)
        p6 = v3(xm2 - 0.054, ym2 - 0.014, zm2)
        cp_grid.append([p0, p1, p2, p3, p4, p5, p6, p0])
    add_loft_grid(
        bm_paint,
        cp_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.95, cp_rows - 1: 0.95},
        crease_cols={1: 0.78, 4: 0.80, 5: 0.75},
        flip=False,
    )

    # 1E. Sculpted Front Bumper Cover WITH REAL CUTOUTS for lower honeycomb air dam & fog recesses!
    def build_bumper_band(fx_list: list[float], rows: list[tuple[float, float, float]], crease_r: dict[int, float] | None = None) -> None:
        g: list[list[Vector]] = []
        for y, zc, zpull in rows:
            row = []
            for fx in fx_list:
                x = fx * body_plan_half_width(-1.74)
                z = zc + zpull * (fx ** 1.85)
                if y < 0.24:
                    x *= 0.968
                row.append(v3(x, y, z))
            g.append(row)
        add_loft_grid(
            bm_paint,
            g,
            mat_idx=0,
            crease_layer=cr,
            crease_rows=crease_r or {},
            outward_dir=Vector((0.2, 1.0, 0.0)),
        )

    # Bottom chin bar (full width)
    build_bumper_band(
        [0.0, 0.18, 0.36, 0.56, 0.64, 0.85, 0.94, 1.0],
        [(0.182, -2.075, 0.32), (0.215, -2.098, 0.34)],
        crease_r={1: 0.75},
    )
    # Mid nose beam + plate mount (full width)
    build_bumper_band(
        [0.0, 0.18, 0.36, 0.56, 0.64, 0.85, 0.94, 1.0],
        [(0.398, -2.112, 0.36), (0.490, -2.126, 0.37), (0.602, -2.104, 0.36)],
        crease_r={0: 0.75, 2: 0.75},
    )
    # Painted pillar between center honeycomb air dam (|X|<=0.48) and fog recess (|X| in [0.54,0.72])
    build_bumper_band(
        [0.56, 0.60, 0.64],
        [(0.215, -2.098, 0.34), (0.31, -2.108, 0.35), (0.398, -2.112, 0.36)],
        crease_r={0: 0.7, 2: 0.7},
    )
    # Outer bumper corner flanking fog recess
    build_bumper_band(
        [0.85, 0.92, 1.0],
        [(0.215, -2.098, 0.34), (0.31, -2.108, 0.35), (0.398, -2.112, 0.36)],
        crease_r={0: 0.7, 2: 0.7},
    )

    # Painted front bumper outer cheek closing to front wheel arch front edge (Z = -1.755) & behind headlight
    cheek_grid: list[list[Vector]] = []
    for y in [0.182, 0.24, 0.40, 0.52, 0.602, 0.660]:
        row = []
        for z in [-1.86, -1.805, -1.755]:
            x = min(body_side_x(z, y, front_fender_top_y(z)), nose_x_cap(z))
            row.append(v3(x, y, z))
        cheek_grid.append(row)
    add_loft_grid(
        bm_paint,
        cheek_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.90, 5: 0.90},
        crease_cols={0: 0.85, 2: 0.92},
        outward_dir=Vector((1.0, 0.1, 0.0)),
    )

    # Painted fog-light diagonal strakes inside fog recess (|X| in [0.55, 0.71])
    add_beveled_box(bm_paint, (0.63, 0.305, -1.965), (0.16, 0.018, 0.044), (0.0, -0.45, 0.0), mat_idx=0, bevel=0.004)

    # 1F. Sculpted Rear Hatch Tailgate & Rear Bumper (Z = +1.71 .. +2.07)
    tg_rows = [
        (1.005, 1.850, 0.635),
        (0.920, 1.945, 0.675),
        (0.790, 1.998, 0.705),
        (0.615, 2.022, 0.725),
    ]
    tg_grid: list[list[Vector]] = []
    for y, zc, max_w in tg_rows:
        row = []
        for fx in [0.0, 0.22, 0.44, 0.68, 0.86, 1.0]:
            x = fx * max_w
            z = zc - 0.11 * (fx ** 2.0)
            row.append(v3(x, y, z))
        tg_grid.append(row)
    add_loft_grid(
        bm_paint,
        tg_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.90, 2: 0.72, 3: 0.90},
        crease_cols={5: 0.90},
        outward_dir=Vector((0.2, -1.0, 0.0)),
    )

    rb_rows = [
        (0.615, 2.025, 0.725, 0.14),
        (0.540, 2.055, 0.750, 0.18),
        (0.420, 2.068, 0.775, 0.22),
        (0.285, 2.050, 0.800, 0.24),
    ]
    rb_grid: list[list[Vector]] = []
    for y, zc, max_w, z_wrap in rb_rows:
        row = []
        for fx in [0.0, 0.20, 0.40, 0.60, 0.78, 0.92, 1.0]:
            x = fx * max_w
            z = zc - z_wrap * (fx ** 2.0)
            row.append(v3(x, y, z))
        rb_grid.append(row)
    add_loft_grid(
        bm_paint,
        rb_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.88, 3: 0.88},
        crease_cols={6: 0.88},
        outward_dir=Vector((0.2, -1.0, 0.0)),
    )

    rb_cheek = []
    for y in [0.285, 0.40, 0.51, 0.615]:
        rb_cheek.append([
            v3(body_side_x(1.715, y, 0.65), y, 1.715),
            v3(body_side_x(1.815, y, 0.65), y, 1.815),
            v3(body_side_x(1.90, y, 0.65) - 0.03, y, 1.90),
        ])
    add_loft_grid(
        bm_paint,
        rb_cheek,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.90, 3: 0.90},
        crease_cols={0: 0.88, 2: 0.88},
        outward_dir=Vector((1.0, -0.2, 0.0)),
    )

    # Flush Door Handles + Side Mirror Shells
    for hz in (-0.06, 0.72):
        hy = 0.835 if hz < 0 else 0.855
        add_beveled_box(bm_paint, (0.865, hy, hz), (0.030, 0.026, 0.150), (0.0, 0.0, 0.0), mat_idx=0, bevel=0.008)
    add_beveled_box(bm_paint, (0.905, 0.972, -0.625), (0.140, 0.072, 0.098), (0.0, -0.18, 0.06), mat_idx=0, bevel=0.022)

    mirror_bmesh_x(bm_paint, crease_layer=cr)
    create_object_from_bm(
        "BodyShell_Paint",
        bm_paint,
        [mats["paint"]],
        parent=root,
        subsurf=2,
        recalc_normals=False,
    )

    # =========================================================================
    # 2. AUTOMOTIVE GLASS (Windshield, Side Windows, Rear Hatch Glass)
    # =========================================================================
    bm_glass = bmesh.new()
    # Front curved laminated windshield strictly framed inside closed A-pillar & roof header
    ws_rows, ws_cols = 8, 10
    ws_grid: list[list[Vector]] = []
    for ir in range(ws_rows):
        t = ir / (ws_rows - 1)
        y = 0.935 + t * (1.408 - 0.935) + math.sin(t * math.pi) * 0.012
        half_w = 0.675 - t * (0.675 - 0.540) + math.sin(t * math.pi) * 0.008
        z_base = -0.805 + t * (-0.218 - -0.805)
        row = []
        for ic in range(ws_cols):
            fx = (ic / (ws_cols - 1)) * 2.0 - 1.0
            x = fx * half_w
            z = z_base - (1.0 - fx * fx) * 0.026 * math.sin(t * math.pi * 0.85)
            row.append(v3(x, y, z))
        ws_grid.append(row)
    add_loft_grid(bm_glass, ws_grid, mat_idx=0, outward_dir=Vector((0.0, 0.7, 0.7)))

    # Rear hatch curved glass tucked cleanly into C-pillar rabbets & roof spoiler
    rg_grid: list[list[Vector]] = []
    for ir in range(6):
        fy = ir / 5.0
        y = 0.992 + fy * (1.376 - 0.992)
        half_w = 0.635 - fy * 0.105
        z_base = 1.852 - fy * (1.852 - 1.482)
        row = []
        for ic in range(8):
            fx = (ic / 7.0) * 2.0 - 1.0
            x = fx * half_w
            z = z_base + (1.0 - fx * fx) * 0.026
            row.append(v3(x, y, z))
        rg_grid.append(row)
    add_loft_grid(bm_glass, rg_grid, mat_idx=0, outward_dir=Vector((0.0, -0.7, 0.7)))

    # Side greenhouse window panes matching exact A-pillar -> roof rail -> C-pillar -> beltline envelope
    for side in (1.0, -1.0):
        sg_grid: list[list[Vector]] = []
        for ir in range(5):
            fy = ir / 4.0
            zf = -0.785 + fy * (-0.215 - -0.785) + math.sin(fy * math.pi) * 0.015
            zr = 0.965 + smoothstep(0.0, 1.0, fy) * (1.165 - 0.965)
            row = []
            for ic in range(9):
                fz = ic / 8.0
                z = zf + fz * (zr - zf)
                x_re, y_re, _ = roof_edge_xy(z)
                y_bot = beltline_y(z) - 0.012
                y = y_bot * (1.0 - fy) + (y_re - 0.012) * fy
                x_bot = body_side_x(z, beltline_y(z), beltline_y(z)) - 0.015
                x_top = x_re - 0.010
                x = side * (x_bot * (1.0 - fy) + x_top * fy + 0.008 * math.sin(fy * math.pi))
                row.append(v3(x, y, z))
            sg_grid.append(row)
        add_loft_grid(bm_glass, sg_grid, mat_idx=0, outward_dir=Vector((side, 0.0, 0.0)))

    create_object_from_bm("BodyShell_Glass", bm_glass, [mats["glass"]], parent=root, recalc_normals=False)

    # =========================================================================
    # 3. EXTERIOR TRIM, GRILLES, SPOILER BLADES, MIRRORS, DIFFUSER & EXHAUST
    # =========================================================================
    bm_trim = bmesh.new()
    # Mat indices: 0=gloss_black, 1=matte_trim, 2=chrome, 3=honeycomb, 4=mirror_glass

    # Gloss-black B-pillar appliques + rear window C-quarter vertical trim + mirror stalks + aero spoiler blades
    for side in (1.0, -1.0):
        # B-pillar gloss black panel tilted flush with side greenhouse tumblehome
        add_beveled_box(bm_trim, (side * 0.665, 1.185, 0.065), (0.014, 0.445, 0.118), (0.0, 0.0, side * 0.365), mat_idx=0, bevel=0.003)
        # Rear door fixed quarter glass divider bar
        add_beveled_box(bm_trim, (side * 0.665, 1.185, 0.855), (0.012, 0.415, 0.032), (0.0, 0.0, side * 0.365), mat_idx=0, bevel=0.002)
        # Lower door window rubber beltline weatherstrip
        add_beveled_box(bm_trim, (side * 0.745, 0.962, 0.10), (0.016, 0.022, 1.72), (-0.032, 0.0, 0.0), mat_idx=1, bevel=0.003)

        # Mirror stalk + lower black housing + mirror glass
        add_beveled_box(bm_trim, (side * 0.81, 0.948, -0.64), (0.095, 0.034, 0.064), (0.0, 0.0, side * 0.25), mat_idx=0, bevel=0.006)
        add_beveled_box(bm_trim, (side * 0.905, 0.946, -0.625), (0.135, 0.038, 0.092), (0.0, side * -0.18, 0.06), mat_idx=0, bevel=0.010)
        add_beveled_box(bm_trim, (side * 0.905, 0.965, -0.578), (0.118, 0.068, 0.008), (0.0, side * -0.18, 0.06), mat_idx=4)

        # Gloss-black rear hatch side aero blades flush against rear glass outer edge
        add_beveled_box(bm_trim, (side * 0.578, 1.195, 1.668), (0.038, 0.40, 0.042), (-0.77, 0.0, side * 0.21), mat_idx=0, bevel=0.004)

        # Black lower rocker skirt (strictly behind front wheel well Z >= -0.92!)
        add_beveled_box(bm_trim, (side * 0.822, 0.165, -0.005), (0.044, 0.040, 1.79), mat_idx=1, bevel=0.006)
        # Jacking pinch-weld rails along left/right sills
        add_beveled_box(bm_trim, (side * 0.68, 0.152, 0.0), (0.038, 0.028, 1.54), mat_idx=1)

        # Front bumper foglight recess housings tucked cleanly BEHIND bumper pillars
        add_beveled_box(bm_trim, (side * 0.625, 0.305, -1.925), (0.17, 0.140, 0.042), (0.0, side * -0.45, 0.0), mat_idx=0, bevel=0.006)
        # Inner door/fender shutline backing strips tucked strictly inside exterior skin
        add_beveled_box(bm_trim, (side * 0.745, 0.54, -0.82), (0.040, 0.66, 0.028), mat_idx=1)
        add_beveled_box(bm_trim, (side * 0.745, 0.56, 0.86), (0.040, 0.66, 0.028), mat_idx=1)
        add_beveled_box(bm_trim, (side * 0.680, 0.65, -1.84), (0.055, 0.15, 0.16), mat_idx=1)

    # Shark-fin GPS antenna
    add_beveled_box(bm_trim, (0.0, 1.445, 1.08), (0.032, 0.052, 0.145), (-0.18, 0.0, 0.0), mat_idx=0, bevel=0.012)

    # Plenum cowl + twin wipers
    add_beveled_box(bm_trim, (0.0, 0.916, -0.835), (1.28, 0.040, 0.13), mat_idx=0, bevel=0.008)
    for wx in (-0.26, 0.18):
        add_beveled_box(bm_trim, (wx, 0.946, -0.79), (0.45, 0.014, 0.020), (0.0, 0.08, 0.0), mat_idx=0, bevel=0.003)

    # Rear wiper
    add_beveled_box(bm_trim, (0.11, 1.035, 1.855), (0.28, 0.015, 0.018), (0.78, 0.0, 0.0), mat_idx=0, bevel=0.003)

    # Curved front lower chin splitter matching bumper wraparound contour (strictly Z <= -1.73 and Y <= 0.178!)
    spl_grid = []
    for y_s, z_off in ((0.160, 0.01), (0.178, -0.022), (0.178, 0.045)):
        row = []
        for ic in range(11):
            fx = (ic / 10.0) * 2.0 - 1.0
            x = fx * 0.76
            z = -2.092 + 0.31 * (abs(fx) ** 1.85) + z_off
            row.append(v3(x, y_s, z))
        spl_grid.append(row)
    add_loft_grid(bm_trim, spl_grid, mat_idx=1, outward_dir=Vector((0.0, 1.0, 0.2)))
    # Curved dark backing recess strictly behind curved honeycomb air dam (+0.02m behind hc_grid!)
    hc_back = []
    for iy, y in enumerate([0.215, 0.305, 0.398]):
        row = []
        for ic in range(9):
            fx = (ic / 8.0) * 2.0 - 1.0
            x = fx * 0.50
            z = -2.065 + 0.125 * (fx ** 2)
            row.append(v3(x, y, z))
        hc_back.append(row)
    add_loft_grid(bm_trim, hc_back, mat_idx=0, outward_dir=Vector((0.0, 1.0, 0.0)))

    # Curved lower honeycomb air dam (textured with UV!)
    hc_grid = []
    for iy, y in enumerate([0.215, 0.305, 0.398]):
        row = []
        for ic in range(9):
            fx = (ic / 8.0) * 2.0 - 1.0
            x = fx * 0.50
            z = -2.088 + 0.125 * (fx ** 2)
            row.append(v3(x, y, z))
        hc_grid.append(row)
    add_loft_grid(bm_trim, hc_grid, mat_idx=3, outward_dir=Vector((0.0, 1.0, 0.0)))
    assign_planar_uv(
        bm_trim,
        lambda f: f.material_index == 3,
        lambda co: (co.x + 0.50) * 3.0,
        lambda co: (co.z - 0.215) / 0.183,
    )

    # Upper Mk7 radiator grille + chrome bar + 3D VW Front & Rear Emblems (aligned with Y = 0.60..0.70!)
    add_beveled_box(bm_trim, (0.0, 0.652, -2.078), (0.86, 0.092, 0.042), mat_idx=0, bevel=0.005)
    add_beveled_box(bm_trim, (0.0, 0.614, -2.092), (0.89, 0.014, 0.042), mat_idx=2, bevel=0.004)
    add_beveled_box(bm_trim, (0.0, 0.662, -2.088), (0.86, 0.010, 0.040), mat_idx=0, bevel=0.002)

    def add_3d_vw_emblem(center_three: tuple[float, float, float], radius: float, facing_sign: int) -> None:
        cx, cy, cz = center_three
        dz = facing_sign * 0.012
        # Gloss black backing disc
        add_cylinder_between(bm_trim, (cx, cy, cz), (cx, cy, cz + dz), radius, radius, segs=32, mat_idx=0, bevel=0.003)
        # Outer chrome ring (24 small capsules around perimeter)
        n_ring = 28
        ring_pts = [
            (
                cx + math.cos(k * 2 * math.pi / n_ring) * (radius - 0.004),
                cy + math.sin(k * 2 * math.pi / n_ring) * (radius - 0.004),
                cz + dz + facing_sign * 0.002,
            )
            for k in range(n_ring + 1)
        ]
        add_tube(bm_trim, ring_pts, radius * 0.095, ring_segs=8, mat_idx=2, cap=False)
        # 3D Chrome V + W bars
        z_fg = cz + dz + facing_sign * 0.003
        s = radius * 0.78
        vw_strokes = [
            # V
            ((-0.44 * s, 0.62 * s), (0.0, -0.02 * s)),
            ((0.44 * s, 0.62 * s), (0.0, -0.02 * s)),
            # W
            ((-0.72 * s, 0.34 * s), (-0.30 * s, -0.76 * s)),
            ((-0.30 * s, -0.76 * s), (0.0, -0.18 * s)),
            ((0.0, -0.18 * s), (0.30 * s, -0.76 * s)),
            ((0.30 * s, -0.76 * s), (0.72 * s, 0.34 * s)),
        ]
        for p0, p1 in vw_strokes:
            add_tube(
                bm_trim,
                [(cx + p0[0], cy + p0[1], z_fg), (cx + p1[0], cy + p1[1], z_fg)],
                radius * 0.085,
                ring_segs=8,
                mat_idx=2,
            )

    # Front VW emblem (facing -Z) & Rear VW hatch emblem (facing +Z)
    add_3d_vw_emblem((0.0, 0.662, -2.100), 0.062, -1)
    add_3d_vw_emblem((0.0, 0.890, 1.970), 0.056, +1)

    # Curved Rear Matte Diffuser matching rear bumper contour + dual left-side TDI chrome exhaust tips
    diff_grid = []
    for y_d, z_off in ((0.185, 0.0), (0.288, 0.036)):
        row = []
        for ic in range(11):
            fx = (ic / 10.0) * 2.0 - 1.0
            x = fx * 0.68
            z = 2.028 - 0.21 * (abs(fx) ** 2.0) + z_off
            row.append(v3(x, y_d, z))
        diff_grid.append(row)
    add_loft_grid(bm_trim, diff_grid, mat_idx=1, outward_dir=Vector((0.0, -1.0, 0.0)))
    for ex_fin in (-0.30, -0.14, 0.02, 0.18, 0.34):
        z_fin = 2.038 - 0.21 * ((abs(ex_fin) / 0.68) ** 2.0)
        add_beveled_box(bm_trim, (ex_fin, 0.230, z_fin), (0.014, 0.088, 0.024), mat_idx=1, bevel=0.003)

    for ex in (-0.52, -0.43):
        add_cylinder_between(bm_trim, (ex, 0.212, 1.94), (ex, 0.212, 2.045), 0.032, 0.031, segs=24, mat_idx=2, bevel=0.003)
        add_cylinder_between(bm_trim, (ex, 0.212, 2.025), (ex, 0.212, 2.048), 0.024, 0.024, segs=20, mat_idx=0)

    # Underbody floor pan strictly behind front wheel arch cavity (Z >= -0.89) & inside curved rear bumper (Z <= 1.79)
    add_beveled_box(bm_trim, (0.0, 0.174, 0.45), (1.32, 0.036, 2.68), mat_idx=1)
    add_beveled_box(bm_trim, (0.0, 0.195, -1.32), (0.68, 0.042, 0.92), mat_idx=1)  # X in [-0.34, +0.34], clear of X >= 0.45

    create_object_from_bm(
        "BodyShell_Trim",
        bm_trim,
        [mats["gloss_black"], mats["matte_trim"], mats["chrome"], mats["honeycomb"], mats["mirror_glass"]],
        parent=root,
        sharp_angle_deg=42.0,
    )

    # =========================================================================
    # 4. LICENSE PLATES ("WOB MK 700" Front & Rear — Cleanly Protruding!)
    # =========================================================================
    bm_plate = bmesh.new()
    # Front black carrier plinth + white embossed plate strictly IN FRONT OF bumper skin (Z = -2.142..-2.154)
    add_beveled_box(bm_plate, (0.0, 0.490, -2.140), (0.535, 0.122, 0.016), mat_idx=0, bevel=0.003)
    add_beveled_box(bm_plate, (0.0, 0.490, -2.152), (0.520, 0.110, 0.010), mat_idx=1, bevel=0.002)
    assign_planar_uv(
        bm_plate,
        lambda f: f.material_index == 1 and f.calc_center_median().y > 0.0,
        lambda co: 0.5 - co.x / 0.520,
        lambda co: (co.z - (0.490 - 0.055)) / 0.110,
    )

    # Rear license plate carrier + plate cleanly proud of rear bumper (Z = +2.082)
    add_beveled_box(bm_plate, (0.0, 0.445, 2.072), (0.535, 0.122, 0.014), mat_idx=0, bevel=0.003)
    add_beveled_box(bm_plate, (0.0, 0.445, 2.082), (0.520, 0.110, 0.010), mat_idx=1, bevel=0.002)
    assign_planar_uv(
        bm_plate,
        lambda f: f.material_index == 1 and f.calc_center_median().y < 0.0,
        lambda co: 0.5 + co.x / 0.520,
        lambda co: (co.z - (0.445 - 0.055)) / 0.110,
    )

    create_object_from_bm(
        "BodyShell_LicensePlates",
        bm_plate,
        [mats["gloss_black"], mats["plate"]],
        parent=root,
        sharp_angle_deg=38.0,
    )

    # =========================================================================
    # 5. BI-XENON DOUBLE-U LED HEADLIGHTS & LED TAILLIGHTS
    # =========================================================================
    bm_lights = bmesh.new()
    # Mat indices: 0=gloss_black, 1=chrome, 2=drl, 3=headlight_lens, 4=amber, 5=tail_led, 6=tail_lens, 7=tail_white

    for side in (1.0, -1.0):
        # Swept headlight position tucked smoothly into front bumper/fender corner
        yaw = side * -0.46
        cy_rot, sy_rot = math.cos(yaw), math.sin(yaw)

        def hl_pt(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
            wx = lx * cy_rot + lz * sy_rot
            wz = -lx * sy_rot + lz * cy_rot
            return (side * 0.585 + wx, 0.652 + ly, -1.965 + wz)

        add_beveled_box(bm_lights, hl_pt(0.0, 0.0, 0.025), (0.310, 0.104, 0.105), (0.0, yaw, 0.0), mat_idx=0, bevel=0.012)
        add_beveled_box(bm_lights, hl_pt(0.0, -0.042, -0.032), (0.305, 0.011, 0.014), (0.0, yaw, 0.0), mat_idx=1, bevel=0.002)

        for px in (-0.072, 0.066):
            p1 = hl_pt(px, 0.006, -0.005)
            p2 = hl_pt(px, 0.006, -0.032)
            add_cylinder_between(bm_lights, p1, p2, 0.032, 0.030, segs=24, mat_idx=1, bevel=0.003)
            b1 = hl_pt(px, 0.006, -0.024)
            b2 = hl_pt(px, 0.006, -0.038)
            add_cylinder_between(bm_lights, b1, b2, 0.020, 0.015, segs=20, mat_idx=2)

            u_pts = [
                hl_pt(px - 0.044, 0.022, -0.032),
                hl_pt(px - 0.043, -0.026, -0.034),
                hl_pt(px - 0.022, -0.037, -0.035),
                hl_pt(px, -0.039, -0.035),
                hl_pt(px + 0.022, -0.037, -0.035),
                hl_pt(px + 0.043, -0.026, -0.034),
                hl_pt(px + 0.044, 0.022, -0.032),
            ]
            add_tube(bm_lights, u_pts, 0.0050, ring_segs=8, mat_idx=2)

        add_beveled_box(bm_lights, hl_pt(side * 0.128, -0.018, -0.018), (0.040, 0.016, 0.014), (0.0, yaw, 0.0), mat_idx=4, bevel=0.003)
        add_beveled_box(bm_lights, hl_pt(0.0, 0.0, -0.038), (0.318, 0.108, 0.018), (0.0, yaw, 0.0), mat_idx=3, bevel=0.008)

        # Side mirror LED turn repeater strip
        add_beveled_box(bm_lights, (side * 0.915, 0.960, -0.674), (0.112, 0.011, 0.014), (0.0, side * -0.18, 0.06), mat_idx=2, bevel=0.002)

        # Angular Mk7 LED Taillights (wrapping cleanly into rear quarter corner)
        tyaw = side * 0.30
        add_beveled_box(bm_lights, (side * 0.515, 0.875, 1.915), (0.38, 0.130, 0.065), (0.0, tyaw, 0.0), mat_idx=6, bevel=0.012)
        c_t, s_t = math.cos(tyaw), math.sin(tyaw)

        def tl_pt(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
            wx = lx * c_t + lz * s_t
            wz = -lx * s_t + lz * c_t
            return (side * 0.515 + wx, 0.875 + ly, 1.915 + wz)

        for loff in (-0.08, 0.05):
            l_pts = [
                tl_pt(loff - 0.04, 0.040, 0.026),
                tl_pt(loff + 0.04, 0.040, 0.026),
                tl_pt(loff + 0.04, -0.034, 0.026),
                tl_pt(loff - 0.03, -0.034, 0.026),
            ]
            add_tube(bm_lights, l_pts, 0.0068, ring_segs=8, mat_idx=5)

        add_beveled_box(bm_lights, tl_pt(side * -0.05, -0.015, 0.026), (0.20, 0.020, 0.014), (0.0, tyaw, 0.0), mat_idx=7, bevel=0.002)
        # Rear bumper red reflectors flush with bumper curve
        add_beveled_box(bm_lights, (side * 0.55, 0.305, 1.936), (0.165, 0.020, 0.014), (0.0, side * 0.34, 0.0), mat_idx=5, bevel=0.003)

    # High-mount 3rd brake light in rear roof spoiler
    add_beveled_box(bm_lights, (0.0, 1.384, 1.595), (0.34, 0.016, 0.018), mat_idx=5, bevel=0.002)

    create_object_from_bm(
        "BodyShell_Lights",
        bm_lights,
        [
            mats["gloss_black"],
            mats["chrome"],
            mats["drl"],
            mats["headlight_lens"],
            mats["amber"],
            mats["tail_led"],
            mats["tail_lens"],
            mats["tail_white"],
        ],
        parent=root,
        sharp_angle_deg=38.0,
    )

    # =========================================================================
    # 6. SIMPLE CABIN INTERIOR & ENGINE BAY SURROUND
    # =========================================================================
    bm_int = bmesh.new()
    # Mat indices: 0=interior, 1=bay_steel, 2=matte_trim, 3=coolant_bottle, 4=coolant_g13, 5=coolant_cap

    # Cabin dashboard & 3-spoke VW flat-bottom steering wheel (driver side -X)
    add_beveled_box(bm_int, (0.0, 0.78, -0.58), (1.30, 0.22, 0.40), mat_idx=0, bevel=0.03)
    add_beveled_box(bm_int, (-0.34, 0.90, -0.55), (0.28, 0.10, 0.18), mat_idx=0, bevel=0.02)
    sw_pts = [
        (
            -0.34 + math.cos(k * 2 * math.pi / 24) * 0.155,
            0.88 + math.sin(k * 2 * math.pi / 24) * 0.155 * math.cos(0.35),
            -0.35 + math.sin(k * 2 * math.pi / 24) * 0.155 * math.sin(0.35),
        )
        for k in range(25)
    ]
    add_tube(bm_int, sw_pts, 0.016, ring_segs=8, mat_idx=0, cap=False)

    # Front sport seats & rear bench
    for sx in (-0.34, 0.34):
        add_beveled_box(bm_int, (sx, 0.40, -0.05), (0.46, 0.14, 0.48), mat_idx=0, bevel=0.035)
        add_beveled_box(bm_int, (sx, 0.70, 0.18), (0.44, 0.56, 0.14), (-0.18, 0.0, 0.0), mat_idx=0, bevel=0.035)
        add_beveled_box(bm_int, (sx, 1.05, 0.22), (0.20, 0.16, 0.10), (-0.12, 0.0, 0.0), mat_idx=0, bevel=0.025)
    add_beveled_box(bm_int, (0.0, 0.45, 0.78), (1.24, 0.22, 0.48), mat_idx=0, bevel=0.04)
    add_beveled_box(bm_int, (0.0, 0.76, 1.02), (1.22, 0.50, 0.14), (-0.22, 0.0, 0.0), mat_idx=0, bevel=0.04)

    # Engine Bay Surround (STRICTLY CLEAR of X in [0.45, 0.84], Y in [0.16, 0.78], Z in [-1.72, -0.92]!)
    # Firewall behind engine (Z = -0.82)
    add_beveled_box(bm_int, (0.0, 0.62, -0.82), (1.36, 0.56, 0.075), mat_idx=1, bevel=0.01)
    # Front radiator slam panel & radiator core (Z <= -1.78, strictly below closed hood and inside fenders!)
    add_beveled_box(bm_int, (0.0, 0.665, -1.89), (1.12, 0.055, 0.09), mat_idx=2, bevel=0.01)
    add_beveled_box(bm_int, (-0.02, 0.44, -1.89), (0.80, 0.36, 0.05), mat_idx=1, bevel=0.005)
    # Right upper fender apron rail (Y >= 0.786, strictly above cavity Y = 0.78 AND strictly below fender/hood!)
    add_beveled_box(bm_int, (0.60, 0.808, -1.16), (0.085, 0.036, 0.56), (-0.12, 0.0, 0.0), mat_idx=1, bevel=0.006)
    # Right strut tower top dome (aligned with rearward MacPherson strut at Z = -1.25, Y >= 0.788!)
    add_cylinder_between(bm_int, (0.54, 0.788, -1.25), (0.54, 0.830, -1.25), 0.095, 0.085, segs=22, mat_idx=1, bevel=0.004)
    # Left apron, battery, airbox (strictly on -X side & below left fender)
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
    # Mat indices: 0=tire, 1=alloy, 2=alloy_pocket, 3=gloss_black, 4=chrome, 5=bolt_chrome
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
    Includes smooth sculpted Golf7_Paint top skin with twin V-creases + SUBSURF
    and dark underside acoustic pad & X-ribs strictly >= 1.8 cm below skin!
    """
    pivot = create_empty("Golf7_HoodPivot", (0.0, HOOD_HINGE_Y, HOOD_HINGE_Z))

    # 1. Sculpted Top Hood Skin + rolled perimeter hem
    bm_skin = bmesh.new()
    cr = bm_skin.edges.layers.float.new("crease_edge")

    z_steps = 16
    x_steps = 12  # half side x >= 0 (mirrored cleanly later)
    skin_grid: list[list[Vector]] = []
    for iz in range(z_steps + 1):
        tz = iz / z_steps
        lz = -tz * 1.24
        half_w = hood_half_width(tz)
        row: list[Vector] = []
        for ix in range(x_steps + 1):
            fx = ix / x_steps
            lx = fx * half_w
            wy = hood_profile(lx, lz)
            ly = wy - HOOD_HINGE_Y
            row.append(v3(lx, ly, lz))
        # Rolled edge hem returning downward & slightly inward 1.2 cm (still well above pad!)
        edge_wy = hood_profile(half_w, lz) - HOOD_HINGE_Y
        row.append(v3(half_w - 0.008, edge_wy - 0.012, lz))
        skin_grid.append(row)

    # Mark twin V-crease line near fx ~ (0.74 - tz*0.28) -> col idx ~ 7..9
    add_loft_grid(
        bm_skin,
        skin_grid,
        mat_idx=0,
        crease_layer=cr,
        crease_rows={0: 0.75, z_steps: 0.85},
        crease_cols={x_steps: 0.78},
        outward_dir=Vector((0.0, 0.0, 1.0)),
        outward_rows=(0, z_steps),
    )

    # Front nose rolled underside return lip (Blender coords: Y is front -Z_three, Z is up +Y_three)
    front_lip = [
        skin_grid[z_steps][:-1],
        [Vector((p.x, p.y - 0.012, p.z - 0.010)) for p in skin_grid[z_steps][:-1]],
    ]
    add_loft_grid(bm_skin, front_lip, mat_idx=0, crease_layer=cr, outward_dir=Vector((0.0, 1.0, -1.0)))

    mirror_bmesh_x(bm_skin, crease_layer=cr)
    create_object_from_bm("Hood_Skin", bm_skin, [mats["paint"]], parent=pivot, subsurf=2)

    # 2. Dark Underside Acoustic Pad & Stamped X-Ribs strictly >= 0.018m BELOW hood_profile!
    bm_under = bmesh.new()
    # Conformal inner sound-deadening blanket offset strictly -0.024m .. -0.036m below skin
    pad_grid_top: list[list[Vector]] = []
    pad_grid_bot: list[list[Vector]] = []
    for iz in range(9):
        tz = 0.08 + (iz / 8.0) * 0.78  # spans Z_local = -0.10 .. -1.07
        lz = -tz * 1.24
        half_w = (hood_half_width(tz) - 0.095)
        r_top: list[Vector] = []
        r_bot: list[Vector] = []
        for ix in range(9):
            fx = (ix / 8.0) * 2.0 - 1.0
            lx = fx * half_w
            skin_ly = hood_profile(lx, lz) - HOOD_HINGE_Y
            # X-rib stamping relief: slightly deeper (-0.034) in pad bays, -0.023 on ribs, ALWAYS <= skin_ly - 0.022!
            is_diag = min(abs(fx - (tz - 0.45) * 1.4), abs(fx + (tz - 0.45) * 1.4)) < 0.14
            is_frame = abs(fx) > 0.82 or tz < 0.16 or tz > 0.78
            drop = 0.023 if (is_diag or is_frame) else 0.032
            r_top.append(v3(lx, skin_ly - 0.021, lz))
            r_bot.append(v3(lx, skin_ly - drop, lz))
        pad_grid_top.append(r_top)
        pad_grid_bot.append(r_bot)

    v_top = add_loft_grid(bm_under, pad_grid_top, mat_idx=0, flip=False)
    v_bot = add_loft_grid(bm_under, pad_grid_bot, mat_idx=0, flip=True)
    # Close perimeter of under-pad
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
        skin_ly = hood_profile(lx, lz) - HOOD_HINGE_Y
        clearance = skin_ly - ly
        assert clearance >= 0.018, f"Hood pad clearance violation: {clearance:.4f}m at ({lx:.3f}, {lz:.3f})"

    # Chrome hood striker latch U-loop at front center
    latch_y = hood_profile(0.0, -1.16) - HOOD_HINGE_Y - 0.025
    striker_pts = [
        (-0.022, latch_y, -1.15),
        (-0.022, latch_y - 0.026, -1.15),
        (0.022, latch_y - 0.026, -1.15),
        (0.022, latch_y, -1.15),
    ]
    add_tube(bm_under, striker_pts, 0.0045, ring_segs=8, mat_idx=1)

    create_object_from_bm("Hood_Underside", bm_under, [mats["hood_pad"], mats["chrome"]], parent=pivot, sharp_angle_deg=38.0)

    return pivot


# ---------------------------------------------------------------------------
# 3. Golf7_EngineCover Builder (Origin: t2b(0.02, 0.77, -1.32))
# ---------------------------------------------------------------------------


def build_engine_cover(mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Sculpted beveled EA288 acoustic engine cover with TDI 1.6 EA288 badge texture."""
    bm = bmesh.new()
    # Mat indices: 0=ec_poly, 1=ec_silver, 2=ec_plaque, 3=gloss_black

    # Sculpted tapered polyamide acoustic shell
    add_beveled_box(bm, (0.0, 0.0, 0.0), (0.46, 0.044, 0.42), mat_idx=0, bevel=0.014, bevel_segs=3)
    # Molded longitudinal acoustic ribs
    for rx in (-0.155, -0.055, 0.055, 0.155):
        add_beveled_box(bm, (rx, 0.026, 0.015), (0.036, 0.016, 0.34), mat_idx=0, bevel=0.005)
    # Brushed silver diagonal EA288 accent strip
    add_beveled_box(bm, (0.01, 0.029, -0.082), (0.41, 0.012, 0.052), (0.0, 0.22, 0.0), mat_idx=1, bevel=0.004)
    # Oil filler recess collar & knurled oil cap on front-left (-0.15, -0.12)
    add_cylinder_between(bm, (-0.15, 0.016, -0.12), (-0.15, 0.036, -0.12), 0.042, 0.039, segs=24, mat_idx=0, bevel=0.003)
    add_cylinder_between(bm, (-0.15, 0.032, -0.12), (-0.15, 0.048, -0.12), 0.032, 0.031, segs=20, mat_idx=3, bevel=0.003)
    add_beveled_box(bm, (-0.15, 0.051, -0.12), (0.046, 0.010, 0.014), (0.0, 0.4, 0.0), mat_idx=3, bevel=0.002)

    # Recessed "TDI 1.6 EA288" plaque facing +Y (upward)
    pw, pd = 0.24, 0.105
    px, py, pz = 0.05, 0.037, 0.055
    v0 = bm.verts.new(v3(px - pw * 0.5, py, pz - pd * 0.5))
    v1 = bm.verts.new(v3(px + pw * 0.5, py, pz - pd * 0.5))
    v2 = bm.verts.new(v3(px + pw * 0.5, py, pz + pd * 0.5))
    v3v = bm.verts.new(v3(px - pw * 0.5, py, pz + pd * 0.5))
    f_plaque = bm.faces.new((v0, v3v, v2, v1))
    f_plaque.material_index = 2
    uv_layer = bm.loops.layers.uv.verify()
    # Standing in front (-Z) looking +Z: +X (v1, v2) is left (u=0), -X (v0, v3v) is right (u=1); +Z (v2, v3v) is top (v=1)
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
    """
    Front-right suspension & vented rotor with rearward MacPherson strut (Z = -1.23..-1.25)
    so the wheel-well camera at Z ~ -1.70 sees crankshaft pulley & tensioner completely unobstructed!
    All materials prefixed Golf7_Susp_.
    """
    bm = bmesh.new()
    # Mat indices: 0=susp_iron, 1=susp_rotor, 2=susp_caliper, 3=susp_black, 4=susp_chrome

    # 1. Smooth Vented Machined Brake Rotor (R = 0.148m centered at X = 0.672, Y = 0.317, Z = -1.32)
    # Single clean revolved profile with recessed perimeter cooling slot — NO protruding vane boxes!
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
    # Assign concentric rotor UVs on friction faces
    uv_layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        if f.material_index == 1:
            for loop in f.loops:
                co = loop.vert.co
                dz = -co.y - FRONT_AXLE_Z
                dy = co.z - WHEEL_CENTER_Y
                loop[uv_layer].uv = (0.5 + dz / 0.305, 0.5 + dy / 0.305)

    # Dark cast iron rotor hat bell
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

    # 2. Cast Grey Brake Caliper at Z = -1.19 + Brake Flex Hose
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

    # 3. Rearward MacPherson Coilover Strut (Z = -1.23 .. -1.25, top dome (0.54,0.79,-1.25), clamp (0.59,0.37,-1.24))
    p_bot = Vector((0.59, 0.37, -1.24))
    p_top = Vector((0.54, 0.79, -1.25))
    strut_dir = (p_top - p_bot).normalized()
    p_damper_top = p_bot + strut_dir * 0.24
    p_rod_bot = p_bot + strut_dir * 0.22

    # Damper body & chrome shaft
    add_cylinder_between(bm, tuple(p_bot), tuple(p_damper_top), 0.023, 0.023, segs=20, mat_idx=3, bevel=0.002)
    add_cylinder_between(bm, tuple(p_rod_bot), tuple(p_top), 0.011, 0.011, segs=16, mat_idx=4)

    # Lower & upper spring perches
    p_lperch_a = p_bot + strut_dir * 0.10
    p_lperch_b = p_bot + strut_dir * 0.118
    add_cylinder_between(bm, tuple(p_lperch_a), tuple(p_lperch_b), 0.028, 0.042, segs=22, mat_idx=3)

    p_uperch_a = p_top - strut_dir * 0.045
    p_uperch_b = p_top - strut_dir * 0.020
    add_cylinder_between(bm, tuple(p_uperch_a), tuple(p_uperch_b), 0.044, 0.048, segs=22, mat_idx=3)

    # Compact gloss-black helical coil spring (r = 0.036 m, 5 turns) along tilted strut axis
    coil_start = p_bot + strut_dir * 0.115
    coil_end = p_top - strut_dir * 0.042
    coil_axis = coil_end - coil_start
    # Construct orthonormal basis perpendicular to strut_dir
    ref_x = Vector((1.0, 0.0, 0.0))
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

    # Steering knuckle connecting hub (0.64, 0.317, -1.32) -> strut clamp (0.59, 0.37, -1.24) -> lower ball joint (0.62, 0.21, -1.31)
    add_beveled_box(bm, (0.625, 0.320, -1.30), (0.052, 0.125, 0.088), mat_idx=0, bevel=0.008)
    add_beveled_box(bm, (0.590, 0.372, -1.242), (0.072, 0.046, 0.052), (0.0, 0.0, -0.45), mat_idx=0, bevel=0.006)
    add_cylinder_between(bm, (0.625, 0.27, -1.30), (0.618, 0.205, -1.305), 0.024, 0.018, segs=14, mat_idx=0)

    # 4. Lower Wishbone Control Arm (Y = 0.205)
    add_beveled_box(bm, (0.46, 0.205, -1.33), (0.31, 0.025, 0.044), (0.0, -0.10, 0.0), mat_idx=3, bevel=0.004)
    add_beveled_box(bm, (0.46, 0.205, -1.175), (0.33, 0.025, 0.044), (0.0, 0.78, 0.0), mat_idx=3, bevel=0.004)

    # 5. Sway Bar End Link (rearward at Z = -1.22)
    add_cylinder_between(bm, (0.575, 0.215, -1.215), (0.568, 0.435, -1.232), 0.006, 0.006, segs=12, mat_idx=4)

    # 6. CV Half-Shaft & Rubber Boot (Z = -1.21 -> -1.32)
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
    """
    Build Golf7_WheelHub at exact origin t2b(0.69, 0.317, -1.32) with hub flange,
    center locating spigot, and 5 recessed threaded M14 bores at R = 0.056m.
    """
    bm = bmesh.new()
    # Mat indices: 0=susp_hub, 1=susp_bore

    # Hub flange (-0.010 .. +0.001 in X_local) with beveled edge
    add_cylinder_between(bm, (-0.010, 0.0, 0.0), (0.001, 0.0, 0.0), 0.078, 0.078, segs=36, mat_idx=0, bevel=0.0015)
    # Center wheel-locating spigot (0.0 .. +0.020 in X_local)
    add_cylinder_between(bm, (-0.001, 0.0, 0.0), (0.019, 0.0, 0.0), 0.0285, 0.0280, segs=28, mat_idx=0, bevel=0.0015)
    add_cylinder_between(bm, (0.018, 0.0, 0.0), (0.020, 0.0, 0.0), 0.021, 0.021, segs=24, mat_idx=1)

    # 5 recessed M14 threaded bores at R = 0.056m, a_i = i*2pi/5 + pi/10
    for i in range(5):
        a = i * (2.0 * math.pi / 5.0) + math.pi / 10.0
        ly = math.sin(a) * BOLT_CIRCLE_RADIUS
        lz = math.cos(a) * BOLT_CIRCLE_RADIUS
        # Chamfered outer thread collar + deep dark bore socket
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
# 5. Realistic VW 17" Dijon 5-Twin-Spoke Alloy Wheel & 225/45 R17 Tire
# ---------------------------------------------------------------------------


def populate_dijon_wheel_bmesh(
    bm: bmesh.types.BMesh,
    center_three: tuple[float, float, float] = (0.0, 0.0, 0.0),
    flip_left: bool = False,
    include_lug_bolts: bool = False,
) -> None:
    """
    Build a high-detail VW 17" Dijon 5-twin-spoke alloy wheel + 225/45 R17 tire
    with radial tapered beveled spokes (NO overlapping boxes!), 5 lug pockets at R = 0.056m,
    3D VW center cap, and carved circumferential tire tread grooves.
    Material indices expected: 0=tire, 1=alloy, 2=alloy_pocket, 3=gloss_black, 4=chrome, 5=bolt_chrome.
    """
    cx, cy, cz = center_three
    sx_dir = -1.0 if flip_left else 1.0

    def wx(lx: float) -> float:
        return cx + sx_dir * lx

    # 1. Radial 225/45 R17 Tire with smoothly rounded sidewall & 4 real carved circumferential tread grooves!
    # Profile [(r, x_local), ...] around circumference
    R_OUT = TIRE_RADIUS  # 0.317m
    R_GRV = TIRE_RADIUS - 0.0045
    tire_prof = [
        (0.214, -0.095),
        (0.242, -0.103),
        (0.278, -0.106),
        (0.305, -0.097),
        (0.315, -0.084),
        (R_OUT, -0.068),
        # Groove 1
        (R_OUT, -0.052), (R_GRV, -0.050), (R_GRV, -0.042), (R_OUT, -0.040),
        # Groove 2
        (R_OUT, -0.018), (R_GRV, -0.016), (R_GRV, -0.008), (R_OUT, -0.006),
        # Groove 3
        (R_OUT, 0.006), (R_GRV, 0.008), (R_GRV, 0.016), (R_OUT, 0.018),
        # Groove 4
        (R_OUT, 0.040), (R_GRV, 0.042), (R_GRV, 0.050), (R_OUT, 0.052),
        # Outer shoulder & sidewall
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

    # 2. Alloy Outer Lip & Inner Rim Barrel (R = 0.184 .. 0.215m)
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

    # Anthracite dark inner rim well backing ring behind spokes
    pocket_prof = [
        (0.194, 0.022),
        (0.194, 0.032),
        (0.074, 0.030),
        (0.074, 0.020),
    ]
    add_revolved_profile(bm, pocket_prof, center_three=center_three, segs=40, closed_profile=True, mat_idx=2, flip=flip_left, axis_flip_x=flip_left)

    # 3. Sculpted Center Hub Bell (inner mounting face at X_local = -0.070 -> world X = 0.69!)
    # With clean lug dish at X_local = +0.042
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

    # 4. 10 Radial Tapered Beveled Dijon Twin Spokes (5 pairs straddling midpoints between lug holes!)
    # Lug holes are at a_i = i*72deg + 18deg -> midpoints between lugs are 54deg, 126deg, 198deg, 270deg, 342deg!
    for i in range(5):
        mid_a = i * (2.0 * math.pi / 5.0) + 3.0 * math.pi / 10.0
        for side_sign in (-1.0, 1.0):
            # Radial sweep stations r = 0.073 -> 0.204m
            # Each spoke tapers gracefully in width and angles slightly outward like a crisp VW Dijon blade
            r_stations = [
                (0.072, 0.043, 0.145, 0.0115),
                (0.105, 0.049, 0.162, 0.0105),
                (0.145, 0.055, 0.175, 0.0095),
                (0.185, 0.059, 0.184, 0.0090),
                (0.206, 0.054, 0.186, 0.0105),
            ]
            # Build closed 4-sided tapered beveled spoke prism across r_stations
            # 6 vertices around cross-section: front machined bevel left/right, side dark pockets, rear face
            spoke_rings: list[list[bmesh.types.BMVert]] = []
            for r, x_front, ang_off, half_w in r_stations:
                a = mid_a + side_sign * ang_off
                # Radial unit & tangential unit in YZ plane
                ru_y, ru_z = math.sin(a), math.cos(a)
                tu_y, tu_z = math.cos(a), -math.sin(a)

                # Slight V-sweep twist of twin spoke
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
                    # Front face (k=0) gets bright diamond-cut alloy (mat 1), bevel sides/pocket get anthracite (mat 2)
                    m_i = 1 if k == 0 else 2
                    quad = (
                        (spoke_rings[ir][k], spoke_rings[ir + 1][k], spoke_rings[ir + 1][kn], spoke_rings[ir][kn])
                        if flip_left
                        else (spoke_rings[ir][k], spoke_rings[ir][kn], spoke_rings[ir + 1][kn], spoke_rings[ir + 1][k])
                    )
                    add_quad_or_tri(bm, quad, m_i)

    # 5. Center Cap with Sculpted 3D VW Chrome Ring & V/W Emblem
    add_cylinder_between(bm, (wx(0.048), cy, cz), (wx(0.057), cy, cz), 0.032, 0.031, segs=28, mat_idx=3, bevel=0.002)
    cap_ring_pts = [
        (wx(0.058), cy + math.sin(k * 2 * math.pi / 24) * 0.028, cz + math.cos(k * 2 * math.pi / 24) * 0.028)
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

    # 6. 5 Recessed Lug Pockets at R = 0.056m (open beveled dark pocket rings matching hub & Golf7_LugBolt_0..4!)
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
    """Build Golf7_FrontRightWheel at t2b(0.76, 0.317, -1.32) without lug bolts (bolts are separate objects)."""
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
    """
    Build 5 individual 17mm chrome hex lug bolts at exact coordinates:
    t2b(0.796, 0.317 + sin(a)*0.056, -1.32 + cos(a)*0.056), a = i*2pi/5 + pi/10.
    """
    bolts: list[bpy.types.Object] = []
    for i in range(5):
        a = i * (2.0 * math.pi / 5.0) + math.pi / 10.0
        by = WHEEL_CENTER_Y + math.sin(a) * BOLT_CIRCLE_RADIUS
        bz = FRONT_AXLE_Z + math.cos(a) * BOLT_CIRCLE_RADIUS

        bm = bmesh.new()
        # 17mm beveled hex head (r = 0.011m, X_local 0.0 -> +0.017)
        add_cylinder_between(bm, (0.0, 0.0, 0.0), (0.017, 0.0, 0.0), 0.011, 0.011, segs=6, mat_idx=0, bevel=0.0018)
        # Washer & conical seat collar (-0.008 -> 0.0)
        add_cylinder_between(bm, (-0.008, 0.0, 0.0), (0.0, 0.0, 0.0), 0.008, 0.0125, segs=20, mat_idx=0, bevel=0.001)
        # Threaded M14 shank extending -X (-0.036 -> -0.008) with subtle thread rings
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
    (X = 0.505..0.78, Z in [-1.69, -0.95]) with beveled outer lip, molded acoustic ribs,
    and mounting flange tabs seating cleanly beneath all 6 Torx T25 screws.
    """
    bm = bmesh.new()
    radius = 0.378
    inner_x = 0.505
    outer_x = 0.780

    # 1. Arch tunnel shell with beveled outer flange lip (solidified via double-layer profile)
    arc_steps = 32
    a_start = math.pi + 0.28
    a_end = -0.28
    tunnel_outer_grid: list[list[Vector]] = []
    tunnel_inner_grid: list[list[Vector]] = []
    for i in range(arc_steps + 1):
        f = i / arc_steps
        a = a_start + (a_end - a_start) * f
        ca, sa = math.cos(a), math.sin(a)
        z_out = FRONT_AXLE_Z + ca * radius
        y_out = WHEEL_CENTER_Y + sa * (radius + 0.015)
        # Molded acoustic ribs slightly indented along tunnel
        rib = 0.005 * math.sin(f * math.pi * 12.0)
        r_surf = radius - rib
        z_in = FRONT_AXLE_Z + ca * r_surf
        y_in = WHEEL_CENTER_Y + sa * (r_surf + 0.015)

        # Cross section in X: inner splash seam -> tunnel mid -> outer lip step -> outer fender bevel lip
        z_lip = FRONT_AXLE_Z + ca * (radius - 0.022)
        y_lip = WHEEL_CENTER_Y + sa * (radius - 0.008)
        tunnel_inner_grid.append([
            v3(inner_x, y_out, z_out),
            v3(0.62, y_in, z_in),
            v3(0.74, y_out, z_out),
            v3(outer_x, y_lip, z_lip),
        ])
        tunnel_outer_grid.append([
            v3(inner_x - 0.004, y_out + 0.004, z_out),
            v3(0.62, y_in + 0.004, z_in),
            v3(0.74, y_out + 0.004, z_out),
            v3(outer_x + 0.004, y_lip + 0.004, z_lip),
        ])

    v_in = add_loft_grid(bm, tunnel_inner_grid, mat_idx=0, flip=False)
    v_out = add_loft_grid(bm, tunnel_outer_grid, mat_idx=0, flip=True)
    # Close outer lip edge
    for i in range(arc_steps):
        add_quad_or_tri(bm, (v_in[i][-1], v_out[i][-1], v_out[i + 1][-1], v_in[i + 1][-1]), 0)
        add_quad_or_tri(bm, (v_in[i][0], v_in[i + 1][0], v_out[i + 1][0], v_out[i][0]), 0)

    # 2. Inner vertical engine-bay splash shield wall (conceals serpentine belt until removed)
    z_cols, y_rows = 16, 8
    wall_front_grid: list[list[Vector]] = []
    wall_back_grid: list[list[Vector]] = []
    for iz in range(z_cols + 1):
        fz = iz / z_cols
        z = -1.67 + fz * (-0.97 - -1.67)
        dz = z - FRONT_AXLE_Z
        max_y = WHEEL_CENTER_Y + math.sqrt(max(0.0, radius * radius - dz * dz)) + 0.01 if abs(dz) < radius else 0.25
        min_y = 0.21
        col_f: list[Vector] = []
        col_b: list[Vector] = []
        for iy in range(y_rows + 1):
            fy = iy / y_rows
            y = min_y + fy * max(0.05, max_y - min_y)
            rib_bulge = max(0.0, math.sin(fz * math.pi * 5.0) * 0.007 + (1.0 - abs(fz - 0.5) * 1.4) * 0.014)
            x = inner_x + rib_bulge
            col_f.append(v3(x, y, z))
            col_b.append(v3(x - 0.004, y, z))
        wall_front_grid.append(col_f)
        wall_back_grid.append(col_b)

    add_loft_grid(bm, wall_front_grid, mat_idx=0, flip=True)
    add_loft_grid(bm, wall_back_grid, mat_idx=0, flip=False)

    # 3. Molded lower front/rear skirt flanges & mounting tabs right behind perimeter screws (0..4)
    add_beveled_box(bm, (0.615, 0.265, -1.645), (0.21, 0.13, 0.016), (0.0, 0.12, 0.0), mat_idx=0, bevel=0.004)
    add_beveled_box(bm, (0.615, 0.265, -0.995), (0.21, 0.13, 0.016), (0.0, -0.12, 0.0), mat_idx=0, bevel=0.004)
    for idx in range(5):
        s_pos, s_dir = _LINER_SCREW_SPECS[idx]
        n = Vector(s_dir).normalized()
        back_p = (s_pos[0] - n.x * 0.006, s_pos[1] - n.y * 0.006, s_pos[2] - n.z * 0.006)
        front_p = (s_pos[0] + n.x * 0.001, s_pos[1] + n.y * 0.001, s_pos[2] + n.z * 0.001)
        add_cylinder_between(bm, back_p, front_p, 0.020, 0.018, segs=14, mat_idx=0, bevel=0.002)
        arch_pt = (0.72, s_pos[1] + n.y * -0.025, s_pos[2] + n.z * -0.025)
        add_cylinder_between(bm, back_p, arch_pt, 0.012, 0.015, segs=10, mat_idx=0)

    return create_object_from_bm(
        "Golf7_WheelLiner",
        bm,
        [mats["liner"]],
        loc_three=(0.0, 0.0, 0.0),
        sharp_angle_deg=42.0,
    )


def build_liner_screws(mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    """
    Build 6 beveled Torx T25 flange screws at exact coordinates, each with .rotation_euler = (0,0,0)
    and screw geometry aligned cleanly along its surface normal pullDir.
    """
    screws: list[bpy.types.Object] = []
    for i, (pos, dir_vec) in enumerate(_LINER_SCREW_SPECS):
        d = Vector(dir_vec).normalized()
        # Construct screw axis endpoints in local space (Three.js directions around local 0,0,0)
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
    """Verify node contract, zero rotation/scale, open FR wheel-well cavity, and file size."""
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

    # Verify Golf7_Paint exists
    assert "Golf7_Paint" in bpy.data.materials, "Missing Golf7_Paint material"

    # Evaluate depsgraph on Golf7_BodyShell children to guarantee FR wheel well cavity & arch cutout are 100% open!
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
            # Convert Blender back to Three.js: (x, y_three=z_b, z_three=-y_b)
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

    project_root = Path(__file__).resolve().parent.parent
    out_path = project_root / "public" / "models" / "golf7.glb"
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
