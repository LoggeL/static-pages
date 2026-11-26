#!/usr/bin/env python3
"""
Hero landmark: Weingut Raspfambert, Hauptstraße 44 (weingut_estate) — a Palatinate winery "Hofreite".

Layout follows the DOP20 aerial of the real plot (20 x 17.5 m):
  * two-storey Winzerhaus along the whole street front (ridge parallel to the street) with sandstone
    ashlar plinth, window surrounds, louvred shutters and – in the east bay – the regional signature:
    a sandstone Torbogen with a sunburst timber gate leading through a covered gateway (Tordurchfahrt);
  * press house / barrel-cellar wing running back from the middle of the house (ridge across);
  * cobbled courtyard in the north-east with vine pergola, barrels, grape tubs and crates;
  * open lean-to with the old basket press on the north-west, facing the side lane;
  * the small detached shed (LoD2 QOJB) on the east edge of the yard.
The neighbour's house (QOR9) stands against the east gable, so the street front stops at x = 8.85.

Run on its own:  blender --background --python blender/landmarks/build_weingut.py
"""

import math
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import estates_utils as eu  # noqa: E402
from estates_utils import Builder, Facade, MatSpec, PI  # noqa: E402

KEY = "weingut_estate"

DEFAULT_PARAMS = {
    "length_x": 19.96,
    "depth_y": 17.50,
    "house_eave_h": 7.2,
    "house_pitch_deg": 48.0,
    "house_depth": 8.16,
    "yard_z": 0.40,           # courtyard level (terrain rises ~0.4 m towards the back of the plot)
    "leanto_z": 1.0,          # lean-to floor = level of the side lane on the north-west
    "gate_both_open": True,   # both Torbogen leaves swung in: the 3.5 m gateway is drivable (see colliders.json)
    "foundation_depth": 1.6,
}

SIGNS = eu.OWN_TEX_DIR / "estates_signs_albedo.webp"
GLASS_ORM = eu.OWN_TEX_DIR / "estates_glass_orm.png"
FOLIAGE = eu.OWN_TEX_DIR / "estates_foliage_albedo.webp"
GLOW = eu.OWN_TEX_DIR / "estates_glow.webp"
SIGN_MAIN = (0.0, 0.75, 0.75, 1.0)
SIGN_KEYSTONE = (0.75, 0.75, 1.0, 0.875)
SIGN_NR_44 = (0.75, 0.875, 0.875, 1.0)
SIGN_VERKAUF = (0.0, 0.5, 0.5, 0.75)
SIGN_TAFEL = (0.0, 0.0, 0.375, 0.25)


def materials() -> dict:
    return {
        # untinted bases (one mesh / draw call each); the tinted variants below merge into them
        "plaster_base": MatSpec("Weingut_Plaster", "plaster_smooth"),
        "painted": MatSpec("Weingut_Painted_Wood", "wood_planks_painted"),
        "timber": MatSpec("Weingut_Weathered_Timber", "wood_planks_weathered"),
        "tiles_base": MatSpec("Weingut_Clay_Roof", "roof_tiles_clay_red"),
        "paint": MatSpec("Weingut_Painted", "metal_painted"),
        "plaster": MatSpec("-", "plaster_smooth", tint=(0.93, 0.87, 0.71), grime="wall", into="plaster_base"),
        "ashlar": MatSpec("Weingut_Sandstone_Ashlar", "sandstone_yellow_ashlar", grime="wall"),
        "rubble": MatSpec("Weingut_Rubble_Sandstone", "sandstone_rubble_wall", grime="wall"),
        # roof: the village's red clay tile, slightly greyed and mottled so the old house reads weathered
        "tiles": MatSpec("-", "roof_tiles_clay_red", tint=(0.84, 0.80, 0.80), grime="roof", into="tiles_base"),
        "tiles_dark": MatSpec("-", "roof_tiles_clay_red", tint=(0.40, 0.40, 0.44), grime="roof", into="tiles_base"),
        "boards": MatSpec("-", "wood_planks_weathered", tint=(0.80, 0.68, 0.55), into="timber"),
        "oak": MatSpec("-", "wood_planks_weathered", tint=(1.0, 0.80, 0.56), into="timber"),
        "gate": MatSpec("-", "wood_planks_painted", tint=(0.17, 0.12, 0.085), into="painted"),
        "shutter": MatSpec("-", "wood_planks_painted", tint=(0.07, 0.15, 0.10), into="painted"),
        # painted / metal / plastic / fired-clay parts share the library's painted-steel maps, tinted per part
        "win": MatSpec("-", "metal_painted", tint=(0.86, 0.85, 0.80), into="paint"),
        "zinc": MatSpec("-", "metal_painted", tint=(0.52, 0.55, 0.57), into="paint"),
        "iron": MatSpec("-", "metal_painted", tint=(0.045, 0.045, 0.05), into="paint"),
        "interior": MatSpec("-", "metal_painted", tint=(0.02, 0.019, 0.017), into="paint"),
        "crate": MatSpec("-", "metal_painted", into="paint"),
        "terracotta": MatSpec("-", "metal_painted", tint=(0.62, 0.20, 0.09), into="paint"),
        "glass": MatSpec("Weingut_Glass_Window", color=(0.02, 0.026, 0.032), rough=0.08, orm_tiny=GLASS_ORM),
        "cobble": MatSpec("Weingut_Courtyard_Cobble", "cobblestone", grime="ground"),
        "fol": MatSpec("Weingut_Foliage", own_albedo=FOLIAGE, rough=0.95, alpha_clip=True, lit_cards=True),
        "lamp": MatSpec("Weingut_Lamp_Emissive", color=eu.LAMP_GLASS, rough=0.4, emissive=eu.LAMP_EMISSIVE),
        "glow": MatSpec("Weingut_LampGlow_Emissive", own_albedo=GLOW, rough=1.0, alpha_blend=True, emissive=(1.0, 0.78, 0.45, 0.12)),
        "glass_lit": MatSpec("Weingut_Window_Lit_Emissive", color=(0.03, 0.025, 0.02), rough=0.08, orm_tiny=GLASS_ORM,
                             emissive=(1.0, 0.70, 0.36, 0.10)),
        "sign": MatSpec("Weingut_Signs", own_albedo=SIGNS, rough=0.6),
    }


def win_style(**kw):
    base = dict(stone="ashlar", frame="win", glass="glass", shutter="shutter", iron="iron")
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# Torbogen gate leaf with sunburst
# ---------------------------------------------------------------------------

def sunburst_leaf(b: Builder, half_w, h_spring, rise, thick=0.06):
    """One leaf of the arched gate (hinge at x = 0, meeting edge at x = half_w, outside = -Y).
    Lower part boarded with raised frame, upper quadrant filled with radiating slats (Sonnentor)."""
    n = 10
    top = [(half_w * k / n, h_spring + rise * math.sqrt(max(0.0, 1.0 - ((half_w - half_w * k / n) / half_w) ** 2)))
           for k in range(n + 1)]
    eu.plank_leaf(b, "gate", half_w, h_spring, thick=thick, iron="iron", frame_key="gate", hinge_len=1.25, top_pts=top)
    yo = -thick
    # raised frame on the outside face of the lower panel
    for (x0, x1, z0, z1) in ((0.0, half_w, 0.0, 0.16), (0.0, half_w, h_spring - 0.16, h_spring), (0.0, 0.14, 0.16, h_spring - 0.16),
                             (half_w - 0.14, half_w, 0.16, h_spring - 0.16), (0.14, half_w - 0.14, h_spring * 0.48, h_spring * 0.48 + 0.13)):
        b.box("gate", x0, x1, yo - 0.022, yo, z0, z1, uv="long" if (z1 - z0) > (x1 - x0) else "longu", skip=("+y",))
    # sunburst: hub + rays from the arch centre (the meeting edge at springing height)
    cx, cz = half_w, h_spring
    hub = [(cx, cz)] + [(cx - 0.34 * math.cos(a), cz + 0.34 * rise / half_w * 0 + 0.34 * math.sin(a))
                         for a in [PI / 2 * k / 6 for k in range(7)]]
    b.prism_xz("gate", hub, yo - 0.03, yo, caps=(True, False))
    rays = 6
    for k in range(rays):
        a = PI / 2 * (k + 0.5) / rays
        ex = cx - (half_w - 0.05) * math.cos(a)
        ez = cz + (rise - 0.05) * math.sin(a)
        b.beam("gate", (cx - 0.30 * math.cos(a), yo - 0.012, cz + 0.30 * math.sin(a)), (ex, yo - 0.012, ez), 0.075, 0.024,
               normal=(0, -1, 0))
    # iron ring handle + lock plate near the meeting edge
    b.box("iron", half_w - 0.20, half_w - 0.10, yo - 0.03, yo - 0.02, 1.0, 1.22)
    with b.place(half_w - 0.15, yo - 0.035, 1.02):
        with b.at(Matrix.Rotation(PI / 2, 4, "X")):
            b.lathe("iron", [(0.055, -0.008), (0.07, -0.008), (0.07, 0.008), (0.055, 0.008), (0.055, -0.008)], seg=10,
                    cap_bottom=False, cap_top=False)


def basket_press(b: Builder, wood, iron, stone):
    """Old Korbkelter (basket press) standing at the frame origin."""
    for sx in (-0.55, 0.55):
        for sy in (-0.55, 0.55):
            b.box(wood, sx - 0.07, sx + 0.07, sy - 0.07, sy + 0.07, 0.0, 0.42, uv="long")
    b.box(stone, -0.80, 0.80, -0.80, 0.80, 0.42, 0.56)
    b.box(stone, -0.80, 0.80, -0.80, -0.72, 0.56, 0.64)
    b.box(stone, -0.80, 0.80, 0.72, 0.80, 0.56, 0.64)
    b.box(stone, -0.80, -0.72, -0.72, 0.72, 0.56, 0.64)
    b.box(stone, 0.72, 0.80, -0.72, 0.72, 0.56, 0.64)
    b.box(stone, -0.12, 0.12, -1.05, -0.80, 0.50, 0.58)                    # juice spout
    r = 0.56
    n = 26
    for k in range(n):
        a = 2 * PI * k / n
        with b.place(r * math.cos(a), r * math.sin(a), 0.58, rz=a):
            b.box(wood, -0.018, 0.018, -0.045, 0.045, 0.0, 0.78, uv="long")
    for z in (0.74, 1.20):
        b.lathe(iron, [(r + 0.022, z - 0.03), (r + 0.022, z + 0.03)], seg=n, cap_bottom=False, cap_top=False)
    b.cyl(iron, (0, 0, 0.56), (0, 0, 2.05), 0.038, seg=8)
    b.lathe(wood, [(0.0, 1.30), (0.50, 1.30), (0.50, 1.40), (0.0, 1.40)], seg=14, cap_bottom=False, cap_top=False, sharp=(1, 2))
    b.lathe(iron, [(0.10, 1.40), (0.12, 1.62), (0.07, 1.66)], seg=8, cap_bottom=False, cap_top=True)
    b.cyl(iron, (-0.85, 0.05, 1.56), (0.85, -0.05, 1.56), 0.022, seg=6)


def potted_bush(b: Builder, pot, fol, flowers=False, r=0.26, h=0.42, size=1.0):
    """Terracotta tub with a shrub: a bouquet of alpha-masked sprig cards fanning out of the pot."""
    b.lathe(pot, [(r * 0.72, 0.0), (r, h), (r + 0.03, h), (r + 0.03, h + 0.04), (r - 0.03, h + 0.04), (r - 0.05, h - 0.06)],
            seg=16, cap_bottom=True, cap_top=False, sharp=(1, 2, 3, 4))
    b.lathe(pot, [(r - 0.05, h - 0.06), (0.0, h - 0.05)], seg=16, cap_bottom=False, cap_top=False, color=(0.12, 0.09, 0.07))
    rng = b.rng
    n = 14
    for k in range(n):
        yaw = 2 * PI * k / n + rng.uniform(-0.2, 0.2)
        tilt = rng.uniform(0.05, 0.6) if k % 3 else rng.uniform(0.0, 0.2)
        up = Vector((math.sin(tilt) * math.cos(yaw), math.sin(tilt) * math.sin(yaw), math.cos(tilt)))
        face = rng.uniform(0, PI)
        right = Vector((math.cos(face), math.sin(face), 0.0))
        right = (right - up * right.dot(up)).normalized()
        s_ = size * rng.uniform(0.55, 0.85)
        base = Vector((0.08 * math.cos(yaw), 0.08 * math.sin(yaw), h - 0.08))
        # lit cards: the sprig's normal points out of the bush and up, like the leaves of a round shrub
        nk = {"normal": (Vector((math.cos(yaw), math.sin(yaw), 0.0)) * 0.6 + Vector((0.0, 0.0, 0.8))).normalized()} \
            if b.specs[fol].lit_cards else {}
        b.card(fol, "tuft" if k % 2 else "hornbeam", base, right, up, s_, s_, flip=rng.random() < 0.5, **nk)
        if flowers and k % 2 == 0:
            tip = base + up * s_ * 0.8
            b.card(fol, "oleander", tip, right, up, 0.34, 0.34, anchor=(0.5, 0.5), **nk)
            b.card(fol, "oleander", tip, up.cross(right), up, 0.30, 0.30, anchor=(0.5, 0.5), **nk)


def shed_dormer(b: Builder, x, y_front, z_sill, w, h, y_meet, z_meet):
    """Schleppgaube on a south slope: plastered front with a two-light window, boarded cheeks,
    low-pitched tiled roof running back into the main roof at (y_meet, z_meet)."""
    f = Facade(b, "plaster", (x - w / 2, y_front), (x + w / 2, y_front), z_sill - 0.05, z_sill + h, bands=(), grid=3.0)
    eu.add_window(f, w / 2, z_sill + 0.22, w - 0.75, h - 0.48, **win_style(stone=None, depth=0.10, division="two", bars=1,
                                                                           shutter=None, proud=0.05))
    f.build()
    with b.at(f.frame):
        b.box("boards", -0.02, 0.10, -0.03, 0.02, z_sill - 0.05, z_sill + h, uv="long")
        b.box("boards", w - 0.10, w + 0.02, -0.03, 0.02, z_sill - 0.05, z_sill + h, uv="long")
        b.box("boards", -0.02, w + 0.02, -0.04, 0.02, z_sill + h - 0.12, z_sill + h, uv="longu")
        b.box("zinc", -0.05, w + 0.05, -0.10, 0.02, z_sill - 0.09, z_sill - 0.05)
    zt = z_sill + h
    # cheeks
    for sx in (-1, 1):
        xs = x + sx * w / 2
        pts = [(y_front, z_sill - 0.05), (y_front, zt), (y_meet, z_meet)]
        with b.at(Matrix.Translation((xs, 0, 0)) @ Matrix.Rotation(PI / 2, 4, "Z")):
            b.prism_xz("boards", pts, -0.04, 0.04)
    oh = 0.18
    sl = (z_meet - zt) / (y_meet - y_front)
    e0 = (x - w / 2 - oh, y_front - oh, zt - oh * sl + 0.07)
    e1 = (x + w / 2 + oh, y_front - oh, zt - oh * sl + 0.07)
    r0 = (x - w / 2 - oh, y_meet + 0.25, z_meet + 0.25 * sl + 0.07)
    r1 = (x + w / 2 + oh, y_meet + 0.25, z_meet + 0.25 * sl + 0.07)
    eu.roof_slab(b, e0, e1, r1, r0, 0.07, "tiles", "boards", "boards", cell=2.0)


def build_weingut(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    eu.clear_scene()
    col = bpy.data.collections.new("Weingut_Estate_Kindenheim")
    bpy.context.scene.collection.children.link(col)
    site = eu.Site(KEY)
    b = Builder("Weingut", materials(), seed=44)

    fd = cfg["foundation_depth"]
    He = cfg["house_eave_h"]
    pitch = cfg["house_pitch_deg"]
    tan = math.tan(math.radians(pitch))
    HD = cfg["house_depth"]
    YZ = cfg["yard_z"]
    LZ = cfg["leanto_z"]
    hy = cfg["depth_y"] / 2                 # 8.75

    # plan
    yS = -8.76                              # street building line
    yH = yS + HD                            # yard-side wall of the house (-0.6)
    xW, xE = -9.0, 8.85                     # house west / east gable
    HL = xE - xW
    PL = 0.95                               # plinth top
    GFs, UFs = 1.95, 4.75                   # window sill heights
    ZS = 4.0                                # string course
    # gateway
    gx = 5.9                                # arch centre
    ga = 1.75                               # half clear width
    z_street = site.terrain_z(gx, yS - 0.4) + 0.05
    z_spring, rise = 2.2, 1.25
    px0, px1 = gx - 2.0, gx + 2.0           # passage inner walls
    z_ceil = 3.75
    # wing
    wx0, wx1 = -6.0, 1.0
    wy1 = 8.69
    w_eave = 4.3
    w_pitch = 38.0
    print(f"[weingut] street level at the gate {z_street:.2f}, west corner {site.terrain_z(xW, yS - 0.4):.2f}, "
          f"yard terrain {site.terrain_z(5.0, 4.0):.2f}, lane {site.terrain_z(-10.5, 4.0):.2f}")

    # ======================================================================
    # 1. Winzerhaus – street front
    # ======================================================================
    S0, S1 = (xW, yS), (xE, yS)             # u = x - xW
    uA = gx - xW                            # arch centre
    uB = 12.3                               # start of the ashlar gateway bay
    fS_pl = Facade(b, "ashlar", S0, S1, -fd, PL, u0=0.0, u1=uB, offset=0.05, bands=(fd - 0.2, fd + 0.35), grid=1.6)
    fS_bay = Facade(b, "ashlar", S0, S1, -fd, ZS, u0=uB, u1=HL, offset=0.05, bands=(fd - 0.2, fd + 0.35, fd + 1.2), grid=1.6)
    fS_gf = Facade(b, "plaster", S0, S1, PL, ZS, u0=0.0, u1=uB)
    fS_uf = Facade(b, "plaster", S0, S1, ZS, He, bands=())
    fS_bay.arch_hole(uA, 2 * ga, z_street, z_spring, rise, depth=0.55, reveal="ashlar", n=16)
    gf_x = [-7.2, -4.6, -2.0, 0.6]
    for i, x in enumerate(gf_x):
        eu.add_window(fS_gf, x - xW, GFs, 1.05, 1.55, **win_style(lintel="segment", flowers=("boards", "fol"),
                                                                   glass="glass_lit" if i == 3 else "glass"))
    for x in gf_x + [4.6, 7.2]:
        eu.add_window(fS_uf, x - xW, UFs, 1.05, 1.5, **win_style(lintel="cornice", glass="glass_lit" if x in (-4.6, 4.6) else "glass"))
    for x in (-5.9, -0.7):                  # barred cellar windows in the plinth
        fS_pl.rect_hole(x - xW - 0.35, x - xW + 0.35, 0.36, 0.72, depth=0.22, reveal="ashlar")
    for f in (fS_pl, fS_bay, fS_gf, fS_uf):
        f.build()
    with b.at(fS_gf.frame):
        b.face("ashlar", [(0.0, -0.05, PL), (uB, -0.05, PL), (uB, 0.0, PL), (0.0, 0.0, PL)])
        for x in (-5.9, -0.7):
            u = x - xW
            b.face("interior", [(u - 0.35, 0.16, 0.36), (u + 0.35, 0.16, 0.36), (u + 0.35, 0.16, 0.72), (u - 0.35, 0.16, 0.72)])
            for k in range(1, 5):
                b.cyl("iron", (u - 0.35 + 0.14 * k, 0.03, 0.36), (u - 0.35 + 0.14 * k, 0.03, 0.72), 0.011, seg=5, caps=(False, False))
        # string course + eaves cornice (moulded sandstone)
        b.sweep_h("ashlar", [(0.0, 0.0), (0.05, 0.0), (0.085, 0.04), (0.085, 0.12), (0.05, 0.16), (0.0, 0.16)],
                  [(-0.085, 0.0, ZS), (HL + 0.02, 0.0, ZS)])
        b.sweep_h("ashlar", [(0.0, 0.0), (0.04, 0.0), (0.04, 0.07), (0.13, 0.17), (0.13, 0.21), (0.22, 0.30), (0.22, 0.34), (0.0, 0.34)],
                  [(-0.22, 0.0, He - 0.34), (HL + 0.02, 0.0, He - 0.34)])
        # corner quoins at the west end
        z, k = PL, 0
        while z < ZS - 0.3:
            w_ = 0.58 if k % 2 == 0 else 0.36
            b.box("ashlar", 0.0, w_, -0.035, 0.02, z, z + 0.36, skip=("+y",))
            z += 0.38
            k += 1
        # wall board, house number, lantern, hanging sign
        eu.sign_panel(b, "sign", 11.0, 12.0, 1.75, 2.25, -0.03, SIGN_VERKAUF, back_key="gate")
        eu.sign_panel(b, "sign", 11.3, 11.6, 2.55, 2.85, -0.02, SIGN_NR_44, back_key="iron")
        su, sz = 11.55, 5.55
        b.box("iron", su - 0.03, su + 0.03, -0.012, 0.0, sz - 0.75, sz + 0.12)
        b.tube("iron", [(su, 0.0, sz), (su, -1.62, sz), (su, -1.70, sz + 0.06)], 0.016, seg=6)
        b.tube("iron", [(su, 0.0, sz - 0.70), (su, -0.55, sz - 0.42), (su, -1.05, sz - 0.04)], 0.012, seg=5)
        for k in range(4):                 # scroll work
            cy_, cz_ = -0.42 - k * 0.3, sz - 0.14
            b.tube("iron", [(su, cy_ + 0.11 * math.cos(a), cz_ + 0.11 * math.sin(a)) for a in [PI * 2 * i / 10 for i in range(11)]],
                   0.007, seg=4, caps=False)
        for yy in (-0.42, -1.52):
            b.cyl("iron", (su, yy, sz), (su, yy, sz - 0.28), 0.006, seg=4)
        for sgn, rz in ((1, PI / 2), (-1, -PI / 2)):
            with b.at(Matrix.Translation((su + sgn * 0.016, -0.97, sz - 0.50)) @ Matrix.Rotation(rz, 4, "Z")):
                eu.sign_panel(b, "sign", -0.62, 0.62, -0.20, 0.215, 0.0, SIGN_MAIN)
        b.box("gate", su - 0.016, su + 0.016, -1.62, -0.32, sz - 0.73, sz - 0.26)

    # ---- the Torbogen ------------------------------------------------------
    with b.at(fS_bay.frame):
        # moulded archivolt + pilaster strips, imposts, keystone with the date, wheel-guard stones
        mould = [(0.0, 0.0), (0.44, 0.0), (0.44, 0.10), (0.36, 0.10), (0.32, 0.065), (0.10, 0.065), (0.06, 0.10), (0.0, 0.10)]
        b.sweep_arc("ashlar", mould, uA, z_spring, ga, rise, 0.0, PI, n=18)
        for sgn in (-1, 1):
            x_in = uA + sgn * ga
            xa, xb = sorted((x_in, x_in + sgn * 0.44))
            b.box("ashlar", xa, xb, -0.085, 0.0, z_street - 0.3, z_spring, uv="long", skip=("+y",))
            b.box("ashlar", xa - 0.05, xb + 0.05, -0.14, 0.0, z_spring - 0.20, z_spring, skip=("+y",))
            b.box("ashlar", xa - 0.03, xb + 0.03, -0.12, 0.0, z_street - 0.3, z_street + 0.55, skip=("+y",))
            with b.place(x_in - sgn * 0.02, -0.16, z_street - 0.1):
                b.lathe("ashlar", [(0.17, 0.0), (0.16, 0.30), (0.10, 0.52), (0.0, 0.57)], seg=8, cap_bottom=False, cap_top=False)
        zk0, zk1 = z_spring + rise - 0.04, z_spring + rise + 0.50
        b.prism_xz("ashlar", [(uA - 0.25, zk0), (uA + 0.25, zk0), (uA + 0.34, zk1), (uA - 0.34, zk1)], -0.17, 0.0)
        eu.sign_panel(b, "sign", uA - 0.27, uA + 0.27, zk0 + 0.14, zk0 + 0.41, -0.172, SIGN_KEYSTONE)
        eu.wall_lantern(b, "iron", "lamp", uA - ga - 0.95, 2.95, glow="glow")
        # gate: west leaf closed (sunburst visible from the street), east leaf swung into the gateway
        gate_h = z_spring - z_street - 0.05
        west_open = math.radians(86) if cfg["gate_both_open"] else 0.0
        with b.place(uA - ga, 0.36, z_street + 0.05, rz=west_open):
            sunburst_leaf(b, ga - 0.01, gate_h, rise - 0.02)
        with b.at(Matrix.Translation((uA + ga, 0.36, z_street + 0.05)) @ Matrix.Rotation(math.radians(-86), 4, "Z")
                  @ Matrix.Scale(-1, 4, (1, 0, 0))):
            sunburst_leaf(b, ga - 0.01, gate_h, rise - 0.02)

    # ---- covered gateway (Tordurchfahrt): ramped cobbles, plastered walls, beamed ceiling ----
    y_in0, y_in1 = yS + 0.55, yH - 0.50
    ny = 8
    for i in range(ny):
        ya, yb = yS - 0.02 + (yH + 0.02 - yS) * i / ny, yS - 0.02 + (yH + 0.02 - yS) * (i + 1) / ny
        za, zb_ = z_street + (YZ - z_street) * i / ny, z_street + (YZ - z_street) * (i + 1) / ny
        b.face("cobble", [(px0, ya, za), (px1, ya, za), (px1, yb, zb_), (px0, yb, zb_)],
               uvs=[(px0, ya), (px1, ya), (px1, yb), (px0, yb)])
    f_pw = Facade(b, "plaster", (px0, y_in0), (px0, y_in1), z_street - 0.1, z_ceil, bands=(0.5, 1.2), grid=2.0,
                  outline=[(0.0, z_street - 0.1), (y_in1 - y_in0, YZ - 0.05), (y_in1 - y_in0, z_ceil), (0.0, z_ceil)])
    f_pw.build()
    Facade(b, "plaster", (px1, y_in1), (px1, y_in0), z_street - 0.1, z_ceil, bands=(0.5, 1.2), grid=2.0,
           outline=[(0.0, YZ - 0.05), (y_in1 - y_in0, z_street - 0.1), (y_in1 - y_in0, z_ceil), (0.0, z_ceil)]).build()
    f_in = Facade(b, "plaster", (px1, y_in0), (px0, y_in0), z_street - 0.1, z_ceil, bands=(), grid=3.0)
    f_in.arch_hole(px1 - gx, 2 * ga, z_street - 0.1, z_spring, rise, depth=0.0, reveal=None, n=16)
    f_in.build()
    b.face("boards", [(px0, y_in1, z_ceil), (px1, y_in1, z_ceil), (px1, y_in0, z_ceil), (px0, y_in0, z_ceil)],
           color=(0.6, 0.6, 0.6))
    for k in range(6):
        yb = y_in0 + 0.5 + (y_in1 - y_in0 - 1.0) * k / 5
        b.box("boards", px0, px1, yb - 0.09, yb + 0.09, z_ceil - 0.20, z_ceil, uv="longu", color=(0.55, 0.55, 0.55))
    # hanging lantern in the gateway
    lyc = (y_in0 + y_in1) / 2
    b.cyl("iron", (gx, lyc, z_ceil - 0.2), (gx, lyc, z_ceil - 0.62), 0.008, seg=4)
    with b.place(gx, lyc, z_ceil - 0.85):
        b.lathe("iron", [(0.11, 0.12), (0.03, 0.22)], seg=6, cap_bottom=True, cap_top=True)
        b.lathe("lamp", [(0.07, -0.14), (0.10, 0.12)], seg=6, cap_bottom=True, cap_top=False)
        b.lathe("iron", [(0.075, -0.16), (0.075, -0.14)], seg=6, cap_bottom=True, cap_top=True)
    eu.glow_ground(b, "glow", gx, lyc, z_street + (YZ - z_street) * ((lyc - yS) / (yH - yS)) + 0.05, 3.6, 4.6, alpha=0.22)
    # side door from the gateway into the house (west wall) + steps, chalk board at the entrance
    ud = 2.6
    dz0 = z_street + (YZ - z_street) * ((y_in0 + ud - yS) / (yH - yS)) + 0.42
    with b.at(f_pw.frame):
        b.box("ashlar", ud - 0.62, ud - 0.5, -0.05, 0.02, dz0 - 0.36, dz0 + 2.1, uv="long")
        b.box("ashlar", ud + 0.5, ud + 0.62, -0.05, 0.02, dz0 - 0.36, dz0 + 2.1, uv="long")
        b.box("ashlar", ud - 0.66, ud + 0.66, -0.06, 0.02, dz0 + 2.1, dz0 + 2.3, uv="longu")
        b.box("gate", ud - 0.5, ud + 0.5, -0.015, 0.02, dz0, dz0 + 2.1, uv="long")
        for (qa, qb) in ((0.18, 0.9), (1.05, 1.92)):
            b.box("gate", ud - 0.36, ud + 0.36, -0.032, -0.015, dz0 + qa, dz0 + qb, uv="long", skip=("+y",))
        b.box("iron", ud + 0.36, ud + 0.40, -0.06, -0.015, dz0 + 0.98, dz0 + 1.08)
        b.box("ashlar", ud - 0.62, ud + 0.62, -0.30, 0.0, dz0 - 0.5, dz0)
        b.box("ashlar", ud - 0.72, ud + 0.72, -0.60, 0.0, dz0 - 0.7, dz0 - 0.18)
    with b.at(fS_bay.frame):
        with b.place(uA - ga - 1.0, -0.10, z_street + 0.02, rx=math.radians(-10)):
            eu.sign_panel(b, "sign", -0.36, 0.36, 0.0, 0.96, -0.04, SIGN_TAFEL, back_key="boards", thick=0.03)

    # ======================================================================
    # 2. Winzerhaus – gables, yard front, roof
    # ======================================================================
    def gable_outline(z_lo, width):
        return [(0.0, z_lo), (width, z_lo), (width, He), (width / 2, He + width / 2 * tan), (0.0, He)]

    W0, W1 = (xW, yH), (xW, yS)             # west gable (faces the side lane), u = yH - y
    fW_pl = Facade(b, "ashlar", W0, W1, -fd, PL, offset=0.05, bands=(fd - 0.2, fd + 0.35), grid=1.6)
    fW = Facade(b, "plaster", W0, W1, PL, He, outline=gable_outline(PL, HD))
    for u in (2.3, 5.86):
        eu.add_window(fW, u, GFs, 1.0, 1.5, **win_style(lintel="segment"))
        eu.add_window(fW, u, UFs, 1.0, 1.45, **win_style(lintel="cornice", glass="glass_lit" if u < 3 else "glass"))
    for u in (2.9, 5.26):
        eu.add_window(fW, u, He + 0.85, 0.8, 1.05, **win_style(division="two", bars=1, sw=0.12))
    fW_pl.build()
    fW.build()
    with b.at(fW.frame):
        b.face("ashlar", [(0.0, -0.05, PL), (HD, -0.05, PL), (HD, 0.0, PL), (0.0, 0.0, PL)])
        b.sweep_h("ashlar", [(0.0, 0.0), (0.05, 0.0), (0.085, 0.04), (0.085, 0.12), (0.05, 0.16), (0.0, 0.16)],
                  [(-0.02, 0.0, ZS), (HD + 0.085, 0.0, ZS)])
        z, k = PL, 0
        while z < ZS - 0.3:
            w_ = 0.36 if k % 2 == 0 else 0.58
            b.box("ashlar", HD - w_, HD, -0.035, 0.02, z, z + 0.36, skip=("+y",))
            z += 0.38
            k += 1
        eu.sign_panel(b, "sign", 3.58, 4.58, 2.25, 2.75, -0.03, SIGN_VERKAUF, back_key="gate")
    # east gable: stands against the neighbour's house – plain plaster
    Facade(b, "plaster", (xE, yS), (xE, yH), -fd, He, outline=[(0.0, -fd), (HD, -fd), (HD, He), (HD / 2, He + HD / 2 * tan), (0.0, He)],
           grid=2.4, bands=()).build()

    # yard front (north wall): u = xE - x
    N0, N1 = (xE, yH), (xW, yH)
    fN = Facade(b, "plaster", N0, N1, 0.0, He, bands=(YZ + 0.35, YZ + 0.9), grid=1.6)
    pw = 1.8                                # half width of the yard-side gateway arch
    fN.arch_hole(xE - gx, 2 * pw, YZ - 0.05, 2.55, 0.75, depth=0.5, reveal="plaster", n=12)
    for x in (5.9, 2.4, -7.5):
        eu.add_window(fN, xE - x, UFs, 1.0, 1.45, **win_style(lintel="plain", glass="glass_lit" if x == 5.9 else "glass"))
    eu.add_window(fN, xE - 2.4, GFs, 1.0, 1.45, **win_style(lintel="plain", flowers=("boards", "fol"), glass="glass_lit"))
    fN.build()
    with b.at(fN.frame):
        ua = xE - gx
        b.sweep_arc("ashlar", [(0.0, 0.0), (0.26, 0.0), (0.26, 0.05), (0.0, 0.05)], ua, 2.55, pw, 0.75, 0.0, PI, n=12)
        for sgn in (-1, 1):
            xa, xb = sorted((ua + sgn * pw, ua + sgn * (pw + 0.26)))
            b.box("ashlar", xa, xb, -0.05, 0.0, YZ - 0.05, 2.55, uv="long", skip=("+y",))
        b.sweep_h("ashlar", [(0.0, 0.0), (0.04, 0.0), (0.04, 0.07), (0.13, 0.17), (0.13, 0.21), (0.22, 0.30), (0.22, 0.34), (0.0, 0.34)],
                  [(-0.02, 0.0, He - 0.34), (HL + 0.22, 0.0, He - 0.34)])
        b.box("ashlar", 0.0, ua - pw - 0.26, -0.04, 0.0, YZ - 0.05, YZ + 0.55, skip=("+y",))
        b.box("ashlar", ua + pw + 0.26, xE - wx1, -0.04, 0.0, YZ - 0.05, YZ + 0.55, skip=("+y",))
    # inner (gateway-side) face of the yard wall around the arch
    f_in2 = Facade(b, "plaster", (px0, y_in1), (px1, y_in1), YZ - 0.05, z_ceil, bands=(), grid=3.0)
    f_in2.arch_hole(gx - px0, 2 * pw, YZ - 0.05, 2.55, 0.75, depth=0.0, reveal=None, n=12)
    f_in2.build()

    # roof of the Winzerhaus
    with b.place((xW + xE) / 2, (yS + yH) / 2, 0.0):
        info = eu.gable_roof(b, HL, HD, He, pitch, tiles="tiles", soffit="plaster", edge="boards", ridge="tiles",
                             eave_oh=0.42, verge_oh=0.30, verge_oh2=0.05, rafters=None, gutter="zinc", bargeboard="boards",
                             ridge_r=0.13)
    z_ridge = info["z_ridge"]
    lift = 0.16 / math.cos(math.radians(pitch))
    for dx in (-4.6, 1.9):
        yf = yS + 1.25
        z_sill = He + (yf - yS) * tan + lift + 0.02
        zt = z_sill + 1.45
        sl = math.tan(math.radians(16))
        # where the dormer roof meets the main slope
        ym = (zt - sl * yf - He - lift + tan * yS) / (tan - sl)
        zm = He + (ym - yS) * tan + lift
        shed_dormer(b, dx, yf, z_sill, 2.3, 1.45, ym, zm)
    for cx_, cy_ in ((-7.3, (yS + yH) / 2 + 1.2), (0.4, (yS + yH) / 2 + 1.5)):
        cz0 = He + (yH - cy_) * tan - 0.1
        eu.chimney(b, cx_, cy_, cz0, z_ridge + 0.85, 0.66, 0.66, key="plaster", cap="ashlar", pot="terracotta")
        b.box("zinc", cx_ - 0.39, cx_ + 0.39, cy_ - 0.39, cy_ + 0.39, cz0 + 0.2, cz0 + 0.62)
    # snow guard above the street eaves + downpipes
    gz = He - 0.42 * tan - 0.02
    sgy = yS + 0.15
    sgz = He + 0.15 * tan + lift + 0.02
    for dz in (0.10, 0.22):
        b.cyl("zinc", (xW, sgy, sgz + dz), (xE, sgy, sgz + dz), 0.012, seg=5)
    for k in range(13):
        xk = xW + 0.4 + (HL - 0.8) * k / 12
        b.beam("zinc", (xk, sgy, sgz - 0.02), (xk, sgy, sgz + 0.26), 0.03, 0.006, normal=(1, 0, 0))
    with b.at(fS_gf.frame):
        eu.downpipe(b, "zinc", (0.30, -0.49, gz), site.terrain_z(xW + 0.3, yS - 0.2) - 0.05, wall_offset=(0.0, 0.36))
        eu.downpipe(b, "zinc", (HL - 0.22, -0.49, gz), site.terrain_z(xE - 0.2, yS - 0.2) - 0.05, wall_offset=(0.0, 0.36))
    with b.at(fN.frame):
        eu.downpipe(b, "zinc", (0.35, -0.49, gz), YZ, wall_offset=(0.0, 0.36))

    # ======================================================================
    # 3. Press house / barrel cellar wing (rubble masonry) + courtyard
    # ======================================================================
    wl = wy1 - yH
    E0, E1 = (wx1, yH), (wx1, wy1)          # courtyard face of the wing, u = y - yH
    fE = Facade(b, "rubble", E0, E1, 0.0, w_eave, bands=(YZ + 0.35, YZ + 0.9), grid=1.5)
    kd_u, kd_w = 2.35, 2.0                  # arched cellar door
    fE.arch_hole(kd_u, kd_w, YZ - 0.05, YZ + 1.45, 0.95, depth=0.30, reveal="ashlar", n=12)
    pd_u, pd_w, pd_h = 6.35, 2.5, 2.75      # press-house door
    fE.rect_hole(pd_u - pd_w / 2 - 0.2, pd_u + pd_w / 2 + 0.2, YZ - 0.05, YZ + pd_h + 0.3, depth=0.3)
    eu.add_window(fE, 4.35, YZ + 1.55, 0.7, 0.75, **win_style(shutter=None, division="single", bars=0, sw=0.12, grille="iron"))
    eu.add_window(fE, 8.55, YZ + 1.55, 0.7, 0.75, **win_style(shutter=None, division="single", bars=0, sw=0.12, grille="iron"))
    fE.build()
    with b.at(fE.frame):
        # cellar door: dressed arch, boarded leaves, strap hinges
        b.sweep_arc("ashlar", [(0.0, 0.0), (0.30, 0.0), (0.30, 0.06), (0.0, 0.06)], kd_u, YZ + 1.45, kd_w / 2, 0.95, 0.0, PI, n=12)
        for sgn in (-1, 1):
            xa, xb = sorted((kd_u + sgn * kd_w / 2, kd_u + sgn * (kd_w / 2 + 0.30)))
            b.box("ashlar", xa, xb, -0.06, 0.0, YZ - 0.05, YZ + 1.45, uv="long", skip=("+y",))
        b.prism_xz("ashlar", [(kd_u - 0.14, YZ + 2.36), (kd_u + 0.14, YZ + 2.36), (kd_u + 0.20, YZ + 2.78), (kd_u - 0.20, YZ + 2.78)], -0.10, 0.0)
        for sgn in (-1, 1):
            n = 8
            top = [((kd_w / 2) * k / n, 1.45 + 0.95 * math.sqrt(max(0.0, 1 - ((kd_w / 2 - (kd_w / 2) * k / n) / (kd_w / 2)) ** 2)))
                   for k in range(n + 1)]
            m = Matrix.Translation((kd_u + sgn * kd_w / 2, 0.24, YZ))
            if sgn > 0:
                m = m @ Matrix.Scale(-1, 4, (1, 0, 0))
            with b.at(m):
                eu.plank_leaf(b, "boards", kd_w / 2 - 0.01, 1.45, thick=0.05, iron="iron", frame_key="boards", hinge_len=0.75,
                              top_pts=top)
        b.box("ashlar", kd_u - kd_w / 2 - 0.3, kd_u + kd_w / 2 + 0.3, -0.25, 0.3, YZ - 0.12, YZ + 0.02)
        eu.wall_lantern(b, "iron", "lamp", kd_u + kd_w / 2 + 0.75, YZ + 2.25, glow="glow", ground_z=YZ)
        # press-house door: oak lintel, one leaf open, press + barrels inside
        x0, x1 = pd_u - pd_w / 2, pd_u + pd_w / 2
        b.box("ashlar", x0 - 0.2, x0, -0.04, 0.3, YZ - 0.05, YZ + pd_h, uv="long")
        b.box("ashlar", x1, x1 + 0.2, -0.04, 0.3, YZ - 0.05, YZ + pd_h, uv="long")
        b.box("boards", x0 - 0.45, x1 + 0.45, -0.07, 0.3, YZ + pd_h, YZ + pd_h + 0.30, uv="longu")
        with b.place(x0, 0.06, YZ + 0.02):
            eu.plank_leaf(b, "boards", pd_w / 2 - 0.01, pd_h - 0.04, thick=0.05, iron="iron", frame_key="boards", hinge_len=0.9)
        with b.at(Matrix.Translation((x1, 0.06, YZ + 0.02)) @ Matrix.Rotation(math.radians(72), 4, "Z") @ Matrix.Scale(-1, 4, (1, 0, 0))):
            eu.plank_leaf(b, "boards", pd_w / 2 - 0.01, pd_h - 0.04, thick=0.05, iron="iron", frame_key="boards", hinge_len=0.9)
        ya, yb = 0.32, 5.2
        xa, xb = x0 - 1.6, x1 + 1.0
        zt = YZ + pd_h + 0.6
        b.face("cobble", [(xa, ya, YZ + 0.004), (xb, ya, YZ + 0.004), (xb, yb, YZ + 0.004), (xa, yb, YZ + 0.004)], color=(0.4, 0.38, 0.35))
        b.face("interior", [(xa, yb, YZ), (xb, yb, YZ), (xb, yb, zt), (xa, yb, zt)])
        b.face("interior", [(xa, ya, YZ), (xa, yb, YZ), (xa, yb, zt), (xa, ya, zt)])
        b.face("interior", [(xb, yb, YZ), (xb, ya, YZ), (xb, ya, zt), (xb, yb, zt)])
        b.face("interior", [(xa, yb, zt), (xb, yb, zt), (xb, ya, zt), (xa, ya, zt)])
        dim = (0.5, 0.5, 0.5)
        for k in range(3):
            with b.place(xb - 0.75, 1.6 + k * 0.95, YZ + 0.38):
                with b.at(Matrix.Rotation(PI / 2, 4, "Y") @ Matrix.Translation((0, 0, -0.5))):
                    eu.barrel(b, "oak", "iron", radius=0.38, length=1.0, seg=12)
        # hoist dormer above the press-house door (Ladegaube)
        dw = 1.7
        b.box("boards", pd_u - dw / 2, pd_u + dw / 2, -0.02, 2.0, w_eave - 0.05, w_eave + 1.55, uv="long")
        b.box("gate", pd_u - 0.55, pd_u + 0.55, -0.045, -0.02, w_eave + 0.12, w_eave + 1.25, uv="long", skip=("+y",))
        b.beam("boards", (pd_u, 0.4, w_eave + 1.72), (pd_u, -1.25, w_eave + 1.72), 0.16, 0.18, normal=(0, 0, 1))
        with b.place(pd_u, -1.08, w_eave + 1.48):
            with b.at(Matrix.Rotation(PI / 2, 4, "Y")):
                b.lathe("iron", [(0.02, -0.03), (0.12, -0.03), (0.12, 0.03), (0.02, 0.03)], seg=10, cap_bottom=False, cap_top=False)
        b.tube("boards", [(pd_u, -0.96, w_eave + 1.48), (pd_u + 0.02, -0.92, YZ + 2.2), (pd_u, -0.94, YZ + 1.25)], 0.012, seg=5)
        # house vine trained along the wing wall
        eu.vine_wall(b, "boards", "fol", [(3.6, -0.10, YZ), (3.62, -0.12, YZ + 2.9), (5.0, -0.12, YZ + 3.25), (8.9, -0.12, YZ + 3.2)])
    with b.at(fE.frame):
        # dormer roof (small gable, ridge pointing into the wing roof)
        with b.place(pd_u, 1.0, 0.0, rz=PI / 2):
            eu.gable_roof(b, 3.0, 1.7, w_eave + 1.55, 40.0, tiles="tiles", soffit="boards", edge="boards", ridge="tiles",
                          eave_oh=0.18, verge_oh=-0.25, verge_oh2=0.0, ridge_r=0.09)
    # wing north gable + west wall (above the lean-to)
    wtan = math.tan(math.radians(w_pitch))
    ww = wx1 - wx0
    Facade(b, "rubble", (wx1, wy1), (wx0, wy1), -fd, w_eave, grid=1.8, bands=(fd + 0.4, fd + 1.2),
           outline=[(0.0, -fd), (ww, -fd), (ww, w_eave), (ww / 2, w_eave + ww / 2 * wtan), (0.0, w_eave)]).build()
    Facade(b, "rubble", (wx0, wy1), (wx0, yH), LZ - 0.1, w_eave, grid=1.8, bands=(0.5, 1.2)).build()
    with b.place((wx0 + wx1) / 2, (yH + wy1) / 2 - 0.25, 0.0, rz=PI / 2):
        eu.gable_roof(b, wl + 0.5, ww, w_eave, w_pitch, tiles="tiles", soffit="boards", edge="boards", ridge="tiles",
                      eave_oh=0.40, verge_oh=0.0, verge_oh2=0.28, rafters="boards", rafter_step=0.9, gutter="zinc",
                      bargeboard="boards")
    with b.at(fE.frame):
        eu.downpipe(b, "zinc", (wl - 0.3, -0.47, w_eave - 0.40 * wtan - 0.02), YZ, wall_offset=(0.0, 0.39))

    # ---- courtyard: cobbles, boundary walls, shed, pergola, harvest gear ------------------------
    cx0, cx1 = wx1, 9.98
    b.floor("cobble", cx0, cx1 + 0.02, yH, 7.25, YZ)
    b.face("cobble", [(cx0, 7.25, YZ), (9.98, 7.25, YZ), (9.98, 7.28, YZ), (cx0, 8.69, YZ)],
           uvs=[(cx0, 7.25), (9.98, 7.25), (9.98, 7.28), (cx0, 8.69)])
    wt = 0.45

    def boundary(p0, p1, z_top, z_in=YZ, coping=True):
        """Rubble boundary wall, outer face on p0 -> p1 (outside to the right)."""
        p0v, p1v = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
        d = (p1v - p0v).normalized()
        inward = Vector((-d.y, d.x, 0))
        Facade(b, "rubble", p0, p1, -fd, z_top, grid=1.8, bands=(fd + 0.4, fd + 1.2)).build()
        q0, q1 = p1v + inward * wt, p0v + inward * wt
        Facade(b, "rubble", (q0.x, q0.y), (q1.x, q1.y), z_in, z_top, grid=1.8, bands=(0.4, 1.1)).build()
        Facade(b, "rubble", (p1v.x, p1v.y), (q0.x, q0.y), z_in, z_top, bands=()).build()
        Facade(b, "rubble", (q1.x, q1.y), (p0v.x, p0v.y), z_in, z_top, bands=()).build()
        if coping:
            eu.wall_coping_tiles(b, "ashlar", "tiles", p0v + inward * wt / 2, p1v + inward * wt / 2, z_top, wt, ridge="tiles")

    boundary((9.98, 7.28), (wx1 + 0.05, 8.69), 2.75)            # north wall (slightly skewed like the plot)
    boundary((9.98, 3.75), (9.98, 7.28), 2.75)                  # east wall north of the shed
    # the small detached shed (LoD2 QOJB) on the east edge: plastered, dark tiled gable roof, plank door
    sx0, sx1, sy0, sy1 = 9.1, 12.4, -0.5, 3.7
    sh = 2.75
    f_sw = Facade(b, "plaster", (sx0, sy1), (sx0, sy0), YZ - 0.05, sh, bands=(0.4, 1.0))
    f_sw.rect_hole(1.2, 2.2, YZ - 0.05, YZ + 2.0, depth=0.12, reveal="plaster")
    eu.add_window(f_sw, 3.2, YZ + 1.15, 0.6, 0.7, **win_style(stone=None, shutter=None, division="single", bars=0, depth=0.10))
    f_sw.build()
    with b.at(f_sw.frame):
        b.box("boards", 1.2, 2.2, 0.07, 0.11, YZ, YZ + 2.0, uv="long", skip=("+y",))
        b.box("boards", 1.24, 2.16, 0.055, 0.07, YZ + 1.55, YZ + 1.68, uv="longu", skip=("+y",))
        b.box("boards", 1.24, 2.16, 0.055, 0.07, YZ + 0.3, YZ + 0.43, uv="longu", skip=("+y",))
        b.box("iron", 2.02, 2.06, 0.03, 0.07, YZ + 0.95, YZ + 1.05)
    s_tan = math.tan(math.radians(40))
    sw_ = sx1 - sx0
    for (p0, p1, gable) in (((sx0, sy0), (sx1, sy0), True), ((sx1, sy0), (sx1, sy1), False), ((sx1, sy1), (sx0, sy1), True)):
        length = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        outline = ([(0.0, -fd), (length, -fd), (length, sh), (length / 2, sh + length / 2 * s_tan), (0.0, sh)] if gable else None)
        Facade(b, "plaster", p0, p1, -fd, sh, outline=outline, bands=(fd + 0.4,), grid=2.0).build()
    with b.place((sx0 + sx1) / 2, (sy0 + sy1) / 2, 0.0, rz=PI / 2):
        eu.gable_roof(b, sy1 - sy0, sw_, sh, 40.0, tiles="tiles_dark", soffit="boards", edge="boards", ridge="tiles_dark",
                      eave_oh=0.25, verge_oh=0.2, ridge_r=0.10)

    # vine pergola along the north wall with a tasting table
    pg_x0, pg_x1 = 2.2, 9.0
    def wall_y(x):                          # inner face of the skewed north wall
        return 8.69 + (7.28 - 8.69) * (x - wx1) / (9.98 - wx1) - wt - 0.05
    pg_d = 2.6
    posts = [pg_x0, (pg_x0 + pg_x1) / 2, pg_x1]
    for px in posts:
        yb = wall_y(px)
        b.box("ashlar", px - 0.16, px + 0.16, yb - pg_d - 0.16, yb - pg_d + 0.16, YZ, YZ + 0.25)
        b.box("boards", px - 0.08, px + 0.08, yb - pg_d - 0.08, yb - pg_d + 0.08, YZ + 0.25, YZ + 2.45, uv="long")
        b.beam("boards", (px, yb - pg_d - 0.3, YZ + 2.52), (px, yb + 0.1, YZ + 2.62), 0.10, 0.14, normal=(0, 0, 1))
    b.beam("boards", (pg_x0 - 0.4, wall_y(pg_x0) - pg_d, YZ + 2.40), (pg_x1 + 0.4, wall_y(pg_x1) - pg_d, YZ + 2.40), 0.10, 0.14,
           normal=(0, 0, 1))
    for k in range(12):
        px = pg_x0 - 0.2 + (pg_x1 - pg_x0 + 0.4) * k / 11
        yb = wall_y(px)
        b.beam("boards", (px, yb - pg_d - 0.35, YZ + 2.64), (px, yb + 0.05, YZ + 2.74), 0.05, 0.08, normal=(0, 0, 1))
    # vines: two stems climbing the posts, leafy canopy with hanging grapes over the laths
    for px in (pg_x0, pg_x1):
        yb = wall_y(px) - pg_d
        eu.vine_wall(b, "boards", "fol", [(px + 0.12, yb, YZ), (px + 0.14, yb + 0.05, YZ + 2.5)], density=2.2, grapes=False)
    eu.vine_canopy(b, "fol", pg_x0 - 0.3, pg_x1 + 0.3, wall_y, pg_d + 0.25, YZ + 2.80)
    # tasting table + benches under the pergola
    tx, ty = (pg_x0 + pg_x1) / 2 + 0.4, wall_y(5.6) - 1.3
    b.box("boards", tx - 1.1, tx + 1.1, ty - 0.42, ty + 0.42, YZ + 0.72, YZ + 0.77, uv="longu")
    for sx in (-0.85, 0.85):
        b.box("boards", tx + sx - 0.05, tx + sx + 0.05, ty - 0.36, ty + 0.36, YZ, YZ + 0.72, uv="long")
    for sy in (-0.75, 0.75):
        b.box("boards", tx - 1.1, tx + 1.1, ty + sy - 0.15, ty + sy + 0.15, YZ + 0.42, YZ + 0.46, uv="longu")
        for sx in (-0.85, 0.85):
            b.box("boards", tx + sx - 0.04, tx + sx + 0.04, ty + sy - 0.13, ty + sy + 0.13, YZ, YZ + 0.42, uv="long")
    for k, (bx_, by_) in enumerate(((tx - 0.3, ty + 0.05), (tx + 0.25, ty - 0.1), (tx + 0.55, ty + 0.15))):
        with b.place(bx_, by_, YZ + 0.77):
            b.lathe("crate", [(0.036, 0.0), (0.036, 0.20), (0.013, 0.27), (0.013, 0.33)], seg=8, cap_bottom=False, cap_top=True,
                    color=(0.02, 0.08, 0.035))

    # barrels, tubs, crates and plants around the yard
    for k, (bx_, by_, r_) in enumerate(((1.75, 0.95, 0.40), (1.72, 3.55, 0.36), (2.45, 3.25, 0.36))):
        with b.place(bx_, by_, YZ, rz=k * 0.9):
            eu.barrel(b, "oak", "iron", radius=r_, length=1.0 if r_ > 0.38 else 0.92)
    eu.barrel_lying(b, "oak", "iron", 1.95, 8.9 - 1.9, YZ, rz=PI / 2, radius=0.42, length=1.1, chocks="boards")
    for k, (tx_, ty_, full) in enumerate(((3.1, 5.6, True), (4.3, 6.15, True), (3.4, 6.95, False))):
        with b.place(tx_, ty_, YZ):
            eu.grape_tub(b, "crate", fill_key="fol" if full else None, color=(0.03, 0.10, 0.045))
    colors = [(0.30, 0.03, 0.022), (0.30, 0.03, 0.022), (0.04, 0.055, 0.05)]
    for k in range(9):
        eu.crate(b, "crate", 8.35 - (k % 2) * 0.66, 4.6 + (k % 3) * 0.02, YZ + (k // 2) * 0.31, rz=PI / 2 + 0.04 * (k % 3 - 1),
                 color=colors[k % 3], fill_key="fol" if k >= 7 else None)
    for (bx_, by_, fl) in ((8.55, 0.2, True), (3.55, 0.45, False), (8.6, 6.3, True)):
        with b.place(bx_, by_, YZ):
            potted_bush(b, "terracotta", "fol", flowers=fl)

    # ======================================================================
    # 4. Lean-to on the north-west with the old basket press (faces the side lane)
    # ======================================================================
    lx0 = -9.9
    ly0, ly1 = yH + 0.05, wy1
    b.floor("cobble", lx0, wx0, ly0, ly1, LZ)
    # kerb / skirt towards the lane and north end
    Facade(b, "rubble", (lx0, ly1), (lx0, ly0), -fd, LZ, bands=(), grid=2.4).build()
    Facade(b, "rubble", (wx0, ly1), (lx0, ly1), -fd, LZ + 2.6, bands=(fd + 0.3,), grid=2.0,
           outline=[(0.0, -fd), (wx0 - lx0, -fd), (wx0 - lx0, LZ + 2.25), (0.0, LZ + 3.25)]).build()
    Facade(b, "rubble", (lx0, ly1 - 0.4), (wx0, ly1 - 0.4), LZ, LZ + 3.25, bands=(),
           outline=[(0.0, LZ), (wx0 - lx0, LZ), (wx0 - lx0, LZ + 3.25), (0.0, LZ + 2.25)]).build()
    Facade(b, "rubble", (lx0, ly1), (lx0, ly1 - 0.4), LZ, LZ + 2.25, bands=()).build()
    z_hi, z_lo = LZ + 3.3, LZ + 2.35
    for k, py in enumerate((ly0 + 0.35, (ly0 + ly1) / 2 - 0.1, ly1 - 0.6)):
        b.box("ashlar", lx0 + 0.02, lx0 + 0.36, py - 0.17, py + 0.17, LZ, LZ + 0.3)
        b.box("boards", lx0 + 0.10, lx0 + 0.28, py - 0.09, py + 0.09, LZ + 0.3, z_lo - 0.16, uv="long")
        b.beam("boards", (lx0 + 0.19, py, z_lo - 0.08), (wx0 + 0.05, py, z_hi - 0.12), 0.12, 0.16, normal=(0, 0, 1))
        for sgn in (-1, 1):
            if (k == 0 and sgn < 0) or (k == 2 and sgn > 0):
                continue
            b.beam("boards", (lx0 + 0.19, py, z_lo - 0.95), (lx0 + 0.19, py + sgn * 0.7, z_lo - 0.22), 0.09, 0.09, normal=(1, 0, 0))
    b.box("boards", lx0 + 0.10, lx0 + 0.28, ly0, ly1 - 0.2, z_lo - 0.16, z_lo, uv="longu")
    sl = (z_hi - z_lo) / (wx0 - lx0 - 0.19)
    e0 = (lx0 - 0.25, ly1 + 0.05, z_lo - 0.44 * sl + 0.12)
    e1 = (lx0 - 0.25, ly0 - 0.02, z_lo - 0.44 * sl + 0.12)
    r1 = (wx0 + 0.05, ly0 - 0.02, z_hi + 0.12)
    r0 = (wx0 + 0.05, ly1 + 0.05, z_hi + 0.12)
    eu.roof_slab(b, e0, e1, r1, r0, 0.07, "tiles_dark", "boards", "boards")
    for k in range(10):
        py = ly0 + 0.15 + (ly1 - ly0 - 0.3) * k / 9
        b.beam("boards", (lx0 - 0.2, py, z_lo - 0.42 * sl + 0.0), (wx0, py, z_hi - 0.02), 0.06, 0.11, normal=(0, 0, 1))
    eu.half_round_gutter(b, "zinc", (e0[0] - 0.07, e0[1] - 0.05, e0[2] - 0.08), (e1[0] - 0.07, e1[1] + 0.05, e1[2] - 0.08),
                         outward=(-1, 0, 0))
    with b.place(-8.0, 5.9, LZ):
        basket_press(b, "boards", "iron", "ashlar")
    for k, (bx_, by_) in enumerate(((-6.6, 1.0), (-6.65, 1.9), (-7.4, 1.1))):
        with b.place(bx_, by_, LZ, rz=0.7 * k):
            eu.barrel(b, "oak", "iron", radius=0.36, length=0.92)
    eu.barrel_lying(b, "oak", "iron", -6.75, 3.6, LZ, rz=PI / 2, radius=0.45, length=1.2, chocks="boards")
    eu.barrel_lying(b, "oak", "iron", -6.75, 7.9, LZ, rz=PI / 2, radius=0.45, length=1.2, chocks="boards")
    eu.pallet(b, "boards", -8.6, 2.0, LZ, rz=0.1)
    for k in range(4):
        eu.crate(b, "crate", -8.6 + 0.02 * k, 2.0, LZ + 0.125 + k * 0.31, rz=0.05 * (k % 2), color=colors[k % 3])

    # ======================================================================
    # 5. Outside the footprint: cobbled driveway crossing draped over the pavement
    # ======================================================================
    b.drape("cobble", site, gx - ga - 0.6, gx + ga + 0.6, yS - 1.55, yS - 0.02, cell=0.4, offset=0.05, skirt=0.2)

    # ------------------------------------------------------------------
    # Colliders (replace the solid OSM footprint): gateway (3.4 m clear) and yard stay drivable
    # ------------------------------------------------------------------
    R = eu.rect_poly
    solids = [
        R(xW - 0.05, gx - ga + 0.2, yS - 0.05, yH),                    # house west of the gateway (+ open gate leaf)
        R(gx + ga - 0.2, xE, yS - 0.05, yH),                           # house east of the gateway (+ open gate leaf)
        R(3.2, 3.9, 0.1, 0.8),                                         # shrub tub beside the gateway
        R(wx0, wx1, yH, wy1),                                          # press-house wing
        R(lx0, wx0, ly0, ly1),                                         # lean-to (raised floor, press, barrels)
        R(sx0, sx1, sy0, sy1),                                         # yard shed
        [(wx1, 8.69 - wt), (9.98, 7.28 - wt), (9.98, 7.28), (wx1, 8.69)],   # north yard wall
        R(9.98 - wt, 9.98, 3.7, 7.28),                                 # east yard wall
        R(pg_x0 - 0.4, 9.98 - wt, 4.15, 8.3),                          # pergola: posts, table, benches, tubs, crates
        R(wx1, wx1 + 1.9, 0.3, 4.15),                                  # barrels along the wing + cellar-door step
        R(8.1, 9.1, -0.2, 0.7),                                        # oleander tub by the shed
    ]
    objects = b.finalize(col, ground_z=0.0)
    if do_export:
        eu.export_landmark(KEY, objects, site=site, solids=solids, replace_footprint=True)
    return objects


if __name__ == "__main__":
    build_weingut(eu.load_override_params(KEY), do_render=False, do_export=True)
