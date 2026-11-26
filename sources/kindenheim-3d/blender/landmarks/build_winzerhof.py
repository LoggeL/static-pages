#!/usr/bin/env python3
"""
Hero landmark: Pfälzer Winzerhof Hauptstraße 107 (winzerhof_barn) — a Palatinate "Streckhof".

Site facts used (DOP20 aerial, LoD2, OSM roads): corner plot, Hauptstraße runs along the short
-X end, Allwendstraße along the long -Y side, ridge of the real roof runs along the long axis.
Layout inside the 29.1 x 23.8 m footprint:
  * one long range along the lane (-Y side): dwelling at the street end (plastered ground floor,
    half-timbered upper floor and street gable) continuing as the Fachwerk barn under one roof;
  * cobbled yard on the +Y half, closed to the street by a rubble wall with a wide gate between
    sandstone piers (both leaves open – the tour checkpoint looks straight into the yard);
  * open cart shed (Remise) along the far boundary, dung heap, pump, trough, cart, firewood.
The plot falls ~1.5 m away from the street, so the whole yard is a terrace at `floor_z` above the
model origin with a rubble retaining skirt.

Run on its own:  blender --background --python blender/landmarks/build_winzerhof.py
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

KEY = "winzerhof_barn"

DEFAULT_PARAMS = {
    "length_x": 29.14,
    "depth_y": 23.83,
    "floor_z": 0.95,          # yard / ground-floor level above the model origin
    "range_depth": 10.0,      # depth of the house + barn range along the lane
    "house_len": 9.97,        # dwelling part at the street end
    "eave_h": 5.9,
    "pitch_deg": 45.0,
    "foundation_depth": 1.6,
}

SIGNS = eu.OWN_TEX_DIR / "estates_signs_albedo.webp"
GLASS_ORM = eu.OWN_TEX_DIR / "estates_glass_orm.png"
FOLIAGE = eu.OWN_TEX_DIR / "estates_foliage_albedo.webp"
GLOW = eu.OWN_TEX_DIR / "estates_glow.webp"
LAMP_GLASS = eu.LAMP_GLASS
LAMP_EMISSIVE = eu.LAMP_EMISSIVE
SIGN_WINZERHOF = (0.5, 0.5, 1.0, 0.75)
SIGN_NR_107 = (0.875, 0.875, 1.0, 1.0)
SIGN_TAFEL = (0.0, 0.0, 0.375, 0.25)
GATE_OPEN_DEG = 96.0     # both yard-gate leaves swung fully in: the 3.6 m gateway is clear for the tractor


def materials() -> dict:
    return {
        # untinted bases (one mesh / draw call each); the tinted variants below merge into them
        "rubble_base": MatSpec("Winzerhof_Rubble_Sandstone", "sandstone_rubble_wall"),
        "plaster_base": MatSpec("Winzerhof_Plaster", "plaster_smooth"),
        "paint": MatSpec("Winzerhof_Painted", "metal_painted"),
        "rubble": MatSpec("-", "sandstone_rubble_wall", grime="wall", into="rubble_base"),
        "stone": MatSpec("Winzerhof_Red_Sandstone", "sandstone_red_ashlar", grime="wall"),
        "plaster": MatSpec("-", "plaster_smooth", tint=(0.93, 0.80, 0.56), grime="wall", into="plaster_base"),
        "infill": MatSpec("-", "plaster_smooth", tint=(0.97, 0.94, 0.84), grime="wall", into="plaster_base"),
        "beam": MatSpec("Winzerhof_Fachwerk_Oak", "wood_beam_oak", tint=(0.40, 0.25, 0.18)),
        "boards": MatSpec("Winzerhof_Barn_Boards", "wood_planks_weathered", grime="wall"),
        "tiles": MatSpec("Winzerhof_Clay_Roof", "roof_tiles_clay_red", grime="roof"),
        # painted / metal / plastic parts share the library's painted-steel maps, tinted per part
        "win": MatSpec("-", "metal_painted", tint=(0.86, 0.85, 0.80), into="paint"),
        "shutter": MatSpec("-", "metal_painted", tint=(0.30, 0.045, 0.04), into="paint"),
        "door": MatSpec("-", "metal_painted", tint=(0.07, 0.17, 0.10), into="paint"),
        "zinc": MatSpec("-", "metal_painted", tint=(0.52, 0.55, 0.57), into="paint"),
        "iron": MatSpec("-", "metal_painted", tint=(0.045, 0.045, 0.05), into="paint"),
        "hay": MatSpec("-", "metal_painted", tint=(0.80, 0.60, 0.22), into="paint"),
        "interior": MatSpec("-", "metal_painted", tint=(0.02, 0.019, 0.017), into="paint"),
        "crate": MatSpec("-", "metal_painted", into="paint"),
        "water": MatSpec("-", "metal_painted", tint=(0.02, 0.035, 0.03), into="paint"),
        "dung": MatSpec("-", "sandstone_rubble_wall", tint=(0.20, 0.15, 0.09), into="rubble_base"),
        "glass": MatSpec("Winzerhof_Glass_Window", color=(0.02, 0.026, 0.032), rough=0.08, orm_tiny=GLASS_ORM),
        "cobble": MatSpec("Winzerhof_Yard_Cobble", "cobblestone", grime="ground"),
        "fol": MatSpec("Winzerhof_Foliage", own_albedo=FOLIAGE, rough=0.95, alpha_clip=True, lit_cards=True),
        "lamp": MatSpec("Winzerhof_Lamp_Emissive", color=LAMP_GLASS, rough=0.4, emissive=LAMP_EMISSIVE),
        "glow": MatSpec("Winzerhof_LampGlow_Emissive", own_albedo=GLOW, rough=1.0, alpha_blend=True, emissive=(1.0, 0.78, 0.45, 0.12)),
        "glass_lit": MatSpec("Winzerhof_Window_Lit_Emissive", color=(0.03, 0.025, 0.02), rough=0.08, orm_tiny=GLASS_ORM,
                             emissive=(1.0, 0.70, 0.36, 0.10)),
        "sign": MatSpec("Winzerhof_Signs", own_albedo=SIGNS, rough=0.6),
    }


def win_style(shutter=True, **kw):
    base = dict(stone="stone", frame="win", glass="glass", shutter="shutter" if shutter else None, iron="iron")
    base.update(kw)
    return base


def barn_door(b: Builder, uc, w, h, open_deg=(0.0, 0.0), depth=0.32, interior=True, wicket=True):
    """Two-leaf boarded barn door in a sandstone-jambed opening under an oak lintel (wall frame).
    The opening itself must already be a hole/notch in the wall."""
    x0, x1 = uc - w / 2, uc + w / 2
    # dressed sandstone jambs with a chamfered wheel-guard stone, heavy oak lintel
    for xs, xa, xb in ((-1, x0 - 0.34, x0), (1, x1, x1 + 0.34)):
        b.box("stone", xa, xb, -0.06, depth, 0.0, h, uv="long")
        with b.place(x0 + 0.05 if xs < 0 else x1 - 0.05, -0.14, 0.0):
            b.lathe("rubble", [(0.17, 0.0), (0.16, 0.26), (0.10, 0.48), (0.0, 0.53)], seg=8, cap_bottom=False, cap_top=False)
    b.box("beam", x0 - 0.62, x1 + 0.62, -0.09, depth, h, h + 0.36, uv="longu")
    lw = w / 2 - 0.015
    for side, ang in ((-1, open_deg[0]), (1, open_deg[1])):
        a = math.radians(ang)
        hx = x0 if side < 0 else x1
        # doors hang on the outside face and swing outward
        rz = -a if side < 0 else a
        with b.place(hx, 0.05, 0.03, rz=rz):
            if side < 0:
                eu.plank_leaf(b, "boards", lw, h - 0.06, thick=0.055, iron="iron", frame_key="beam", hinge_len=1.15)
                if wicket:
                    # wicket door outline + latch on the closed leaf
                    b.box("beam", lw * 0.28, lw * 0.30, -0.075, -0.055, 0.05, 2.0, skip=("+y",))
                    b.box("beam", lw * 0.82, lw * 0.84, -0.075, -0.055, 0.05, 2.0, skip=("+y",))
                    b.box("beam", lw * 0.28, lw * 0.84, -0.075, -0.055, 2.0, 2.03, skip=("+y",))
                    b.box("iron", lw * 0.76, lw * 0.80, -0.085, -0.055, 1.02, 1.12)
            else:
                # mirrored leaf (hinge on the right): same build in an X-mirrored frame
                with b.at(Matrix.Scale(-1, 4, (1, 0, 0))):
                    eu.plank_leaf(b, "boards", lw, h - 0.06, thick=0.055, iron="iron", frame_key="beam", hinge_len=1.15)
    # iron drop bolt on the meeting stile
    if max(open_deg) < 1:
        b.box("iron", uc - 0.03, uc + 0.03, -0.03, 0.0, 0.9, 1.5)
    if interior and max(open_deg) > 1:
        y0, y1 = depth + 0.02, depth + 7.0
        xa, xb = x0 - 1.5, x1 + 1.5
        zt = h + 1.2
        b.face("cobble", [(xa, y0, 0.004), (xb, y0, 0.004), (xb, y1, 0.004), (xa, y1, 0.004)], color=(0.45, 0.42, 0.38))
        b.face("interior", [(xa, y1, 0), (xb, y1, 0), (xb, y1, zt), (xa, y1, zt)])
        b.face("interior", [(xa, y0, 0), (xa, y1, 0), (xa, y1, zt), (xa, y0, zt)])
        b.face("interior", [(xb, y1, 0), (xb, y0, 0), (xb, y0, zt), (xb, y1, zt)])
        b.face("interior", [(xa, y1, zt), (xb, y1, zt), (xb, y0, zt), (xa, y0, zt)])
        dim = (0.5, 0.5, 0.5)
        # threshing floor: hay bales stacked at the back, a ladder to the loft
        for row in range(3):
            for k in range(4 - row):
                bx = xa + 1.0 + k * 1.05 + row * 0.5
                b.box("hay", bx - 0.5, bx + 0.5, y1 - 2.2, y1 - 1.4, row * 0.46, row * 0.46 + 0.44, color=dim)
        for sx in (0.0, 0.42):
            b.beam("beam", (xb - 1.4 + sx, y0 + 2.4, 0.0), (xb - 1.4 + sx, y0 + 3.3, 3.6), 0.05, 0.07, color=dim)
        for k in range(10):
            t = (k + 0.5) / 10
            b.beam("beam", (xb - 1.4, y0 + 2.4 + 0.9 * t, 3.6 * t), (xb - 0.98, y0 + 2.4 + 0.9 * t, 3.6 * t), 0.035, 0.035, color=dim)


def dutch_door(b: Builder, uc, w=1.05, h=2.0, depth=0.22, top_open=False):
    """Stable door (two halves) in a sandstone frame; the hole must already exist in the wall."""
    x0, x1 = uc - w / 2, uc + w / 2
    b.box("stone", x0 - 0.16, x0, -0.04, depth, 0.0, h, uv="long")
    b.box("stone", x1, x1 + 0.16, -0.04, depth, 0.0, h, uv="long")
    b.box("stone", x0 - 0.20, x1 + 0.20, -0.05, depth, h, h + 0.22, uv="longu")
    b.box("stone", x0 - 0.16, x1 + 0.16, -0.10, depth, -0.06, 0.02, uv="longu")
    hb = h * 0.52
    b.box("boards", x0, x1, depth - 0.07, depth - 0.02, 0.02, hb - 0.01, uv="long")
    b.box("beam", x0 + 0.03, x1 - 0.03, depth - 0.085, depth - 0.07, hb - 0.16, hb - 0.05, uv="longu", skip=("+y",))
    b.box("beam", x0 + 0.03, x1 - 0.03, depth - 0.085, depth - 0.07, 0.12, 0.23, uv="longu", skip=("+y",))
    if top_open:
        with b.place(x0, depth - 0.02, hb + 0.01, rz=math.radians(100)):
            b.box("boards", 0, w, -0.05, 0, 0, h - hb - 0.02, uv="long")
        b.face("interior", [(x0, depth + 0.01, hb), (x1, depth + 0.01, hb), (x1, depth + 0.01, h), (x0, depth + 0.01, h)])
    else:
        b.box("boards", x0, x1, depth - 0.07, depth - 0.02, hb + 0.01, h - 0.01, uv="long")
        b.box("beam", x0 + 0.03, x1 - 0.03, depth - 0.085, depth - 0.07, h - 0.22, h - 0.11, uv="longu", skip=("+y",))
    for zc in (0.32, hb - 0.2, hb + 0.25, h - 0.22):
        b.box("iron", x0 - 0.02, x0 + 0.42, depth - 0.095, depth - 0.085, zc - 0.022, zc + 0.022, skip=("+y",))


def build_winzerhof(params: dict | None = None, do_render: bool = True, do_export: bool = True):
    cfg = {**DEFAULT_PARAMS, **(params or {})}
    eu.clear_scene()
    col = bpy.data.collections.new("Winzerhof_Barn_Kindenheim")
    bpy.context.scene.collection.children.link(col)
    site = eu.Site(KEY)
    b = Builder("Winzerhof", materials(), seed=107)

    L, D = cfg["length_x"], cfg["depth_y"]
    hx, hy = L / 2, D / 2
    F = cfg["floor_z"]
    fd = cfg["foundation_depth"]
    RD = cfg["range_depth"]
    HL = cfg["house_len"]
    He = cfg["eave_h"]
    pitch = cfg["pitch_deg"]
    tan = math.tan(math.radians(pitch))
    yN = -hy + RD                       # yard-side wall line of the range
    xJ = -hx + HL                       # house / barn junction
    zb = -(fd + F)                      # skirt bottom in the floor frame
    GF = 2.95                           # ground-floor storey height (Fachwerk / barn frame starts here)
    PL = 0.55                           # house plinth height

    with b.place(0, 0, F):
        # ==================================================================
        # 1. The long range: dwelling (street end) + barn under one roof
        # ==================================================================
        S0, S1 = (-hx, -hy), (hx, -hy)          # lane side, u = x + hx
        N0, N1 = (hx, yN), (-hx, yN)            # yard side, u = hx - x
        W0, W1 = (-hx, yN), (-hx, -hy)          # street gable, u = yN - y
        E0, E1 = (hx, -hy), (hx, yN)            # rear gable (against the neighbours)
        uJs = HL                                # junction on the lane side
        uJn = L - HL                            # junction on the yard side

        def gable_outline(z_lo, width):
            return [(0.0, z_lo), (width, z_lo), (width, He), (width / 2, He + width / 2 * tan), (0.0, He)]

        # ---- lane side (S) -------------------------------------------------
        fS_pl = Facade(b, "stone", S0, S1, zb, PL, u0=0.0, u1=uJs, offset=0.045, bands=(-zb - 0.2, -zb + 0.3))
        fS_gf = Facade(b, "plaster", S0, S1, PL, GF, u0=0.0, u1=uJs)
        fS_uf = Facade(b, "infill", S0, S1, GF, He, u0=0.0, u1=uJs, bands=())
        # barn base with the notch of the lane-side barn door
        bd2_u, bd2_w, bd2_h = uJs + 6.4, 3.3, 3.4
        fS_rb = Facade(b, "rubble", S0, S1, zb, GF, grid=1.6, bands=(-zb - 0.2, -zb + 0.35, -zb + 1.0),
                       outline=[(uJs, zb), (L, zb), (L, GF), (bd2_u + bd2_w / 2 + 0.34, GF), (bd2_u + bd2_w / 2 + 0.34, 0.0),
                                (bd2_u - bd2_w / 2 - 0.34, 0.0), (bd2_u - bd2_w / 2 - 0.34, GF), (uJs, GF)])
        fS_fw = Facade(b, "infill", S0, S1, GF, He, bands=(),
                       outline=[(uJs, GF), (bd2_u - bd2_w / 2 - 0.34, GF), (bd2_u - bd2_w / 2 - 0.34, bd2_h + 0.30),
                                (bd2_u + bd2_w / 2 + 0.34, bd2_h + 0.30), (bd2_u + bd2_w / 2 + 0.34, GF), (L, GF), (L, He), (uJs, He)])
        s_gf_win = [2.1, 5.0, 7.9]
        for u in s_gf_win:
            eu.add_window(fS_gf, u, 1.25, 1.0, 1.35, **win_style(lintel="cornice", glass="glass_lit" if u == 5.0 else "glass"))
        s_uf_open = []
        for u in s_gf_win:
            eu.add_window(fS_uf, u, GF + 0.92, 0.95, 1.2, **win_style(stone=None, depth=0.12, proud=0.085,
                                                                       glass="glass_lit" if u == 2.1 else "glass"))
            s_uf_open.append((u - 0.475, u + 0.475, GF + 0.92, GF + 2.12))
        # slit vents in the barn base
        s_slits = [uJs + 2.2, uJs + 11.2, uJs + 14.4, uJs + 17.3]
        for u in s_slits:
            fS_rb.rect_hole(u - 0.26, u + 0.26, 1.35, 2.25, depth=0.3)
        # loft openings (boarded) in the frame above
        s_fw_open = [(uJs + 3.1, uJs + 4.0, GF + 0.95, GF + 1.95), (uJs + 13.0, uJs + 13.9, GF + 0.95, GF + 1.95)]
        for ua, ub, za, zb_ in s_fw_open:
            fS_fw.rect_hole(ua, ub, za, zb_, depth=0.10, reveal="beam")
        for f in (fS_pl, fS_gf, fS_uf, fS_rb, fS_fw):
            f.build()
        with b.at(fS_gf.frame):
            b.face("stone", [(0.0, -0.045, PL), (uJs, -0.045, PL), (uJs, 0.0, PL), (0.0, 0.0, PL)])       # plinth ledge
            eu.fachwerk_band(b, "beam", 0.0, uJs, GF, He, post_step=1.45, openings=s_uf_open, mann_every=0,
                             crosses=[(u - 0.475, u + 0.475, GF + 0.17, GF + 0.75) for u in s_gf_win])
            eu.fachwerk_band(b, "beam", uJs, L, GF, He, post_step=1.6, openings=s_fw_open, mann_every=3, rails=(0.52,),
                             gaps=[(bd2_u - bd2_w / 2 - 0.34, bd2_u + bd2_w / 2 + 0.34, bd2_h + 0.36)])
            for ua, ub, za, zb_ in s_fw_open:
                b.box("boards", ua, ub, 0.06, 0.10, za, zb_, uv="long", skip=("+y",))
            for u in s_slits:
                b.box("stone", u - 0.34, u - 0.26, -0.03, 0.3, 1.27, 2.33, uv="long")
                b.box("stone", u + 0.26, u + 0.34, -0.03, 0.3, 1.27, 2.33, uv="long")
                b.box("stone", u - 0.26, u + 0.26, -0.03, 0.3, 2.25, 2.33)
                b.box("stone", u - 0.26, u + 0.26, -0.05, 0.3, 1.27, 1.35)
                b.box("iron", u - 0.012, u + 0.012, 0.10, 0.124, 1.35, 2.25)
                b.face("interior", [(u - 0.26, 0.29, 1.35), (u + 0.26, 0.29, 1.35), (u + 0.26, 0.29, 2.25), (u - 0.26, 0.29, 2.25)])
            barn_door(b, bd2_u, bd2_w, bd2_h, open_deg=(0.0, 0.0), interior=False, wicket=False)

        # ---- street gable (W): plinth, plastered ground floor, half-timbered upper floor + gable ----
        fW_pl = Facade(b, "stone", W0, W1, zb, PL, offset=0.045, bands=(-zb - 0.2, -zb + 0.3))
        fW_gf = Facade(b, "plaster", W0, W1, PL, GF)
        fW_uf = Facade(b, "infill", W0, W1, GF, He, bands=(),
                       outline=[(0.0, GF), (RD, GF), (RD, He), (RD / 2, He + RD / 2 * tan), (0.0, He)])
        w_win = [2.9, 7.1]
        for u in w_win:
            eu.add_window(fW_gf, u, 1.25, 1.0, 1.35, **win_style(lintel="cornice", flowers=("boards", "fol"),
                                                                  glass="glass_lit" if u == 7.1 else "glass"))
        w_uf_open, w_gb_open = [], []
        for u in w_win:
            eu.add_window(fW_uf, u, GF + 0.92, 0.95, 1.2, **win_style(stone=None, depth=0.12, proud=0.085,
                                                                       glass="glass_lit" if u == 2.9 else "glass"))
            w_uf_open.append((u - 0.475, u + 0.475, GF + 0.92, GF + 2.12))
        for u in (3.75, 6.25):
            eu.add_window(fW_uf, u, He + 0.95, 0.75, 1.0, **win_style(stone=None, depth=0.12, proud=0.085, division="two", bars=1))
            w_gb_open.append((u - 0.375, u + 0.375, He + 0.95, He + 1.95))
        eu.add_window(fW_uf, RD / 2, He + 3.05, 0.55, 0.65, **win_style(stone=None, depth=0.12, division="single", bars=0,
                                                                         shutter=False))
        w_gb_open.append((RD / 2 - 0.275, RD / 2 + 0.275, He + 3.05, He + 3.7))
        for f in (fW_pl, fW_gf, fW_uf):
            f.build()
        with b.at(fW_gf.frame):
            b.face("stone", [(0.0, -0.045, PL), (RD, -0.045, PL), (RD, 0.0, PL), (0.0, 0.0, PL)])
            eu.fachwerk_band(b, "beam", 0.0, RD, GF, He, post_step=1.4, openings=w_uf_open, mann_every=0,
                             crosses=[(u - 0.475, u + 0.475, GF + 0.17, GF + 0.75) for u in w_win])
            eu.fachwerk_gable(b, "beam", RD, He, tan, levels=(2.35, 4.0), post_step=1.25, openings=w_gb_open)
            # quoin-like sandstone corner blocks on the ground floor
            for uq, sgn in ((0.0, 1), (RD, -1)):
                z = PL
                k = 0
                while z < GF - 0.3:
                    w_ = 0.52 if k % 2 == 0 else 0.34
                    b.box("stone", min(uq, uq + sgn * w_), max(uq, uq + sgn * w_), -0.03, 0.02, z, z + 0.36)
                    z += 0.39
                    k += 1
            # house number, lantern, cellar hatch
            eu.sign_panel(b, "sign", 0.55, 0.83, 1.75, 2.03, -0.02, SIGN_NR_107, back_key="iron")
            eu.wall_lantern(b, "iron", "lamp", 5.0, 2.55, glow="glow")
        with b.at(fS_gf.frame):
            for uq, sgn in ((0.0, 1),):
                z = PL
                k = 0
                while z < GF - 0.3:
                    w_ = 0.34 if k % 2 == 0 else 0.52
                    b.box("stone", uq, uq + w_, -0.03, 0.02, z, z + 0.36)
                    z += 0.39
                    k += 1

        # ---- yard side (N): house door + windows, barn doors, stables, hay hatch ----------------
        bd_u, bd_w, bd_h = 13.1, 3.6, 3.6                  # main barn door (u measured from the rear end)
        st_doors = [(4.1, False), (7.3, True)]             # stable doors (u, upper half open)
        hd_u = uJn + 7.4                                   # house door
        fN_rb = Facade(b, "rubble", N0, N1, 0.0, GF, grid=1.6, bands=(0.35, 1.0),
                       outline=[(0.0, 0.0)] + [p for (u, _) in st_doors for p in
                                               [(u - 0.685, 0.0), (u - 0.685, 2.22), (u + 0.685, 2.22), (u + 0.685, 0.0)]]
                       + [(bd_u - bd_w / 2 - 0.34, 0.0), (bd_u - bd_w / 2 - 0.34, GF), (0.0, GF)])
        fN_rb2 = Facade(b, "rubble", N0, N1, 0.0, GF, grid=1.6, bands=(0.35, 1.0), u0=bd_u + bd_w / 2 + 0.34, u1=uJn)
        fN_fw = Facade(b, "infill", N0, N1, GF, He, bands=(),
                       outline=[(0.0, GF), (bd_u - bd_w / 2 - 0.34, GF), (bd_u - bd_w / 2 - 0.34, bd_h + 0.30),
                                (bd_u + bd_w / 2 + 0.34, bd_h + 0.30), (bd_u + bd_w / 2 + 0.34, GF), (uJn, GF), (uJn, He), (0.0, He)])
        fN_pl = Facade(b, "stone", N0, N1, 0.0, PL, offset=0.045, bands=(),
                       outline=[(uJn, 0.0), (hd_u - 0.68, 0.0), (hd_u - 0.68, PL), (uJn, PL)])
        fN_pl2 = Facade(b, "stone", N0, N1, 0.0, PL, offset=0.045, bands=(), u0=hd_u + 0.68, u1=L)
        fN_gf = Facade(b, "plaster", N0, N1, PL, GF, bands=(0.4, 1.2),
                       outline=[(uJn, PL), (hd_u - 0.68, PL), (hd_u - 0.68, 2.72), (hd_u + 0.68, 2.72), (hd_u + 0.68, PL), (L, PL),
                                (L, GF), (uJn, GF)])
        fN_uf = Facade(b, "infill", N0, N1, GF, He, u0=uJn, u1=L, bands=())
        n_gf_win = [uJn + 1.9, uJn + 4.7]
        for u in n_gf_win:
            eu.add_window(fN_gf, u, 1.25, 1.0, 1.35, **win_style(lintel="cornice", flowers=("boards", "fol"),
                                                                  glass="glass_lit" if u == n_gf_win[0] else "glass"))
        n_uf_open = []
        for u in (uJn + 1.9, uJn + 4.7, hd_u):
            eu.add_window(fN_uf, u, GF + 0.92, 0.95, 1.2, **win_style(stone=None, depth=0.12, proud=0.085,
                                                                       glass="glass_lit" if u == hd_u else "glass"))
            n_uf_open.append((u - 0.475, u + 0.475, GF + 0.92, GF + 2.12))
        # small stable windows in the rubble base
        n_stw = [1.9, 9.6, 16.7]
        for u in n_stw:
            if u < bd_u - bd_w / 2 - 0.5:
                eu.add_window(fN_rb, u, 1.45, 0.7, 0.6, **win_style(shutter=False, division="single", bars=0, sw=0.12,
                                                                    grille="iron", lintel="plain"))
            else:
                eu.add_window(fN_rb2, u, 1.45, 0.7, 0.6, **win_style(shutter=False, division="single", bars=0, sw=0.12,
                                                                     grille="iron", lintel="plain"))
        hatch = (bd_u - 0.7, bd_u + 0.7, 4.38, 5.55)
        fN_fw.rect_hole(*hatch, depth=0.10, reveal="beam")
        n_fw_open = [hatch, (2.4, 3.2, GF + 1.0, GF + 1.9), (8.0, 8.8, GF + 1.0, GF + 1.9)]
        for ua, ub, za, zb_ in n_fw_open[1:]:
            fN_fw.rect_hole(ua, ub, za, zb_, depth=0.10, reveal="beam")
        for f in (fN_rb, fN_rb2, fN_fw, fN_pl, fN_pl2, fN_gf, fN_uf):
            f.build()
        with b.at(fN_gf.frame):
            b.face("stone", [(uJn, -0.045, PL), (hd_u - 0.68, -0.045, PL), (hd_u - 0.68, 0.0, PL), (uJn, 0.0, PL)])
            b.face("stone", [(hd_u + 0.68, -0.045, PL), (L, -0.045, PL), (L, 0.0, PL), (hd_u + 0.68, 0.0, PL)])
            eu.fachwerk_band(b, "beam", uJn, L, GF, He, post_step=1.45, openings=n_uf_open, mann_every=0,
                             crosses=[(u - 0.475, u + 0.475, GF + 0.17, GF + 0.75) for u in n_gf_win])
            eu.fachwerk_band(b, "beam", 0.0, uJn, GF, He, post_step=1.6, openings=n_fw_open, mann_every=3, rails=(0.52,),
                             gaps=[(bd_u - bd_w / 2 - 0.34, bd_u + bd_w / 2 + 0.34, bd_h + 0.36)])
            for ua, ub, za, zb_ in n_fw_open[1:]:
                b.box("boards", ua, ub, 0.06, 0.10, za, zb_, uv="long", skip=("+y",))
            barn_door(b, bd_u, bd_w, bd_h, open_deg=(0.0, 38.0), interior=True)
            for u, top_open in st_doors:
                dutch_door(b, u, top_open=top_open)
            # hay-loft hatch with hoist beam, pulley and rope
            ua, ub, za, zb_ = hatch
            with b.place(ua, 0.08, za, rz=0.0):
                b.box("boards", 0.0, (ub - ua) / 2 - 0.01, 0.0, 0.04, 0.0, zb_ - za, uv="long", skip=("+y",))
            with b.place(ub, 0.02, za, rz=math.radians(-155)):
                b.box("boards", 0.0, (ub - ua) / 2 - 0.01, -0.04, 0.0, 0.0, zb_ - za, uv="long")
            b.face("interior", [((ua + ub) / 2, 0.095, za), (ub, 0.095, za), (ub, 0.095, zb_), ((ua + ub) / 2, 0.095, zb_)])
            b.beam("beam", (bd_u, 0.3, He - 0.38), (bd_u, -1.45, He - 0.38), 0.20, 0.22, normal=(0, 0, 1))
            b.beam("beam", (bd_u, 0.0, He - 1.35), (bd_u, -1.05, He - 0.50), 0.12, 0.12, normal=(1, 0, 0))
            with b.place(bd_u, -1.25, He - 0.72):
                with b.at(Matrix.Rotation(PI / 2, 4, "Y")):
                    b.lathe("iron", [(0.02, -0.03), (0.14, -0.03), (0.14, 0.03), (0.02, 0.03)], seg=10, cap_bottom=False, cap_top=False)
                b.box("iron", -0.035, 0.035, -0.02, 0.02, 0.0, 0.24)
            b.tube("hay", [(bd_u, -1.25 + 0.14, He - 0.72), (bd_u + 0.02, -1.12, He - 2.9), (bd_u, -1.14, GF + 0.2)], 0.014, seg=5)
            b.tube("iron", [(bd_u, -1.14, GF + 0.2), (bd_u, -1.14, GF + 0.05), (bd_u + 0.06, -1.14, GF - 0.02), (bd_u + 0.03, -1.14, GF + 0.06)],
                   0.012, seg=5)
            # house door: sandstone frame, three steps, panelled door, canopy lantern
            x0, x1 = hd_u - 0.52, hd_u + 0.52
            b.box("stone", x0 - 0.16, x0, -0.04, 0.24, 0.0, 2.50, uv="long")
            b.box("stone", x1, x1 + 0.16, -0.04, 0.24, 0.0, 2.50, uv="long")
            b.box("stone", x0 - 0.22, x1 + 0.22, -0.06, 0.24, 2.50, 2.72, uv="longu")
            b.sweep_h("stone", [(0.06, 0.0), (0.10, 0.0), (0.15, 0.05), (0.15, 0.08), (0.06, 0.10)],
                      [(x0 - 0.26, 0.0, 2.72), (x1 + 0.26, 0.0, 2.72)])
            b.box("door", x0, x1, 0.16, 0.21, 0.42, 2.12, uv="long")
            for (pa, pb, qa, qb) in ((x0 + 0.12, x1 - 0.12, 0.58, 1.15), (x0 + 0.12, x1 - 0.12, 1.30, 1.98)):
                b.box("door", pa, pb, 0.145, 0.16, qa, qb, uv="long", skip=("+y",))
            b.box("win", x0, x1, 0.16, 0.21, 2.16, 2.50)
            b.box("glass", x0 + 0.06, x1 - 0.06, 0.15, 0.16, 2.21, 2.45, skip=("+y",), uv_rand=False)
            b.box("stone", x0 - 0.16, x1 + 0.16, 0.0, 0.24, 0.0, 0.42)
            b.box("iron", x1 - 0.14, x1 - 0.10, 0.10, 0.16, 1.22, 1.34)
            eu.steps(b, "stone", x0 - 0.16, x1 + 0.16, 0.42, n=2, run=0.32, rise=0.14)
            eu.wall_lantern(b, "iron", "lamp", hd_u + 1.15, 2.35, glow="glow", ground_z=0.0)
            # house vine trained along the yard wall + bench
            eu.vine_wall(b, "beam", "fol", [(uJn + 0.5, -0.10, 0.0), (uJn + 0.55, -0.12, 2.55), (uJn + 3.2, -0.12, 2.75),
                                            (uJn + 6.0, -0.12, 2.62)])
            b.box("boards", uJn + 2.7, uJn + 4.0, -0.52, -0.14, 0.42, 0.47, uv="longu")
            for xs in (uJn + 2.8, uJn + 3.9):
                b.box("stone", xs - 0.07, xs + 0.07, -0.50, -0.16, 0.0, 0.42)

        # ---- rear gable (E): rubble base, boarded upper gable ---------------------------------
        fE_rb = Facade(b, "rubble", E0, E1, zb, GF, grid=1.8, bands=(-zb - 0.2, -zb + 0.5))
        fE_bd = Facade(b, "boards", E0, E1, GF, He, bands=(), grid=2.4, outline=gable_outline(GF, RD))
        fE_rb.build()
        fE_bd.build()

        # ---- roof: one continuous clay-tile gable roof, ridge along the range ----------------
        with b.place(0.0, -hy + RD / 2, 0.0):
            info = eu.gable_roof(b, L, RD, He, pitch, tiles="tiles", soffit="boards", edge="boards", ridge="tiles",
                                 eave_oh=0.48, verge_oh=0.36, verge_oh2=0.06, rafters="beam", rafter_step=0.95,
                                 gutter="zinc", bargeboard="boards")
        z_ridge = info["z_ridge"]
        # downpipes: lane side at both ends, yard side at the junction
        gz = He - 0.48 * tan - 0.02
        with b.at(fS_gf.frame):
            eu.downpipe(b, "zinc", (0.35, -0.55, gz), -0.1, wall_offset=(0.0, 0.46))
            eu.downpipe(b, "zinc", (L - 0.4, -0.55, gz), -0.9, wall_offset=(0.0, 0.46))
        with b.at(fN_gf.frame):
            eu.downpipe(b, "zinc", (uJn - 0.25, -0.55, gz), 0.0, wall_offset=(0.0, 0.46))
            eu.downpipe(b, "zinc", (0.4, -0.55, gz), 0.0, wall_offset=(0.0, 0.46))
        # chimney on the dwelling
        cy = -hy + RD / 2 + 1.5
        cz0 = He + (RD / 2 - 1.5) * tan - 0.15
        eu.chimney(b, -hx + 5.6, cy, cz0, z_ridge + 0.95, 0.62, 0.62, key="plaster", cap="stone", pot="tiles")
        b.box("zinc", -hx + 5.6 - 0.37, -hx + 5.6 + 0.37, cy - 0.37, cy + 0.37, cz0 + 0.1, cz0 + 0.55)

        # ==================================================================
        # 2. Yard: cobbles, street wall with gate, boundary walls, cart shed
        # ==================================================================
        b.floor("cobble", -hx + 0.02, hx - 0.02, yN, hy - 0.02, 0.0)
        wt = 0.5                                    # yard wall thickness
        g0, g1 = 1.15, 5.45                         # gate opening (y range) on the street line
        wall_h = 2.35

        def yard_wall(p0, p1, z_top, coping=True):
            """Free-standing rubble wall whose OUTER face lies on p0 -> p1 (outside to the right)."""
            p0v, p1v = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
            d = (p1v - p0v).normalized()
            inward = Vector((-d.y, d.x, 0))
            f_out = Facade(b, "rubble", p0, p1, zb, z_top, grid=1.8, bands=(-zb - 0.2, -zb + 0.4, -zb + 1.1))
            f_out.build()
            q0, q1 = p1v + inward * wt, p0v + inward * wt
            f_in = Facade(b, "rubble", (q0.x, q0.y), (q1.x, q1.y), 0.0, z_top, grid=1.8, bands=(0.4, 1.1))
            f_in.build()
            for a, c in ((p1v, q0), (q1, p0v)):     # end faces
                Facade(b, "rubble", (a.x, a.y), (c.x, c.y), 0.0, z_top, bands=()).build()
            mid0, mid1 = p0v + inward * wt / 2, p1v + inward * wt / 2
            if coping:
                eu.wall_coping_tiles(b, "stone", "tiles", mid0, mid1, z_top, wt, ridge="tiles")
            else:
                b.box("stone", min(p0[0], q0.x) - 0.04, max(p1[0], q1.x) + 0.04, min(p0[1], q0.y) - 0.04, max(p1[1], q1.y) + 0.04,
                      z_top, z_top + 0.1)

        # street wall: range corner -> gate pier, gate pier -> north corner (walked north -> south = outside right)
        yard_wall((-hx, g0 - 0.35), (-hx, yN), wall_h)
        yard_wall((-hx, hy), (-hx, g1 + 0.35), wall_h)
        # skirt under the gate opening
        Facade(b, "rubble", (-hx, g1 + 0.35), (-hx, g0 - 0.35), zb, 0.0, bands=()).build()
        for gy in (g0, g1):
            eu.stone_pier(b, "stone", -hx + 0.33, gy + (-0.02 if gy == g0 else 0.02), 0.0, 2.75, s=0.66)
        # gate leaves, both swung open into the yard
        gw = (g1 - g0 - 0.66) / 2 - 0.02
        arch_top = [(gw * k / 6, 2.05 + 0.32 * math.sin(PI / 2 * k / 6)) for k in range(7)]
        # south leaf: closed it would run +Y with its outside face to the street (-X) -> mirrored frame
        with b.at(Matrix.Translation((-hx + 0.40, g0 + 0.33, 0.04)) @ Matrix.Rotation(math.radians(-GATE_OPEN_DEG - 90), 4, "Z")
                  @ Matrix.Scale(-1, 4, (1, 0, 0))):
            eu.plank_leaf(b, "boards", gw, 2.05, thick=0.05, iron="iron", frame_key="beam", hinge_len=1.2, top_pts=arch_top)
        # north leaf: closed it would run -Y; opened 70 degrees into the yard
        with b.at(Matrix.Translation((-hx + 0.40, g1 - 0.33, 0.04)) @ Matrix.Rotation(math.radians(GATE_OPEN_DEG - 90), 4, "Z")):
            eu.plank_leaf(b, "boards", gw, 2.05, thick=0.05, iron="iron", frame_key="beam", hinge_len=1.2, top_pts=arch_top)
        # signs on the wall beside the gate (street face, wall frame of the north piece: u from the north corner)
        with b.at(Matrix.Translation((-hx, hy, 0)) @ Matrix.Rotation(-PI / 2, 4, "Z")):
            u_gate = hy - (g1 + 0.35)
            eu.sign_panel(b, "sign", u_gate - 2.35, u_gate - 0.75, 1.25, 2.05, -0.035, SIGN_WINZERHOF, back_key="beam")
            eu.wall_lantern(b, "iron", "lamp", u_gate - 0.33, 2.2, glow="glow")
        with b.place(-hx - 0.02, g0 - 1.1, 0.0, rz=math.radians(-90)):
            # chalk board leaning against the wall
            with b.place(0, -0.05, 0.0, rx=math.radians(-12)):
                eu.sign_panel(b, "sign", -0.33, 0.33, 0.12, 0.98, -0.03, SIGN_TAFEL, back_key="beam", thick=0.03)
        # boundary walls: north (+Y) and rear (+X, towards the neighbours) – taller, plain stone coping
        yard_wall((hx, hy), (-hx + wt, hy), 2.9, coping=False)
        yard_wall((hx, yN), (hx, hy - wt), 2.9, coping=False)

        # ---- open cart shed (Remise) against the north wall -----------------------------------
        sx0, sx1 = -7.6, 9.4
        sd = 4.4                                    # depth
        sy_back, sy_front = hy - wt, hy - wt - sd
        z_back, z_front = 3.75, 2.55
        n_bay = 4
        for i in range(n_bay + 1):
            px = sx0 + (sx1 - sx0) * i / n_bay
            b.box("stone", px - 0.19, px + 0.19, sy_front - 0.19, sy_front + 0.19, 0.0, 0.30)
            b.box("beam", px - 0.10, px + 0.10, sy_front - 0.10, sy_front + 0.10, 0.30, z_front - 0.2, uv="long")
            for sgn in (-1, 1):
                if (i == 0 and sgn < 0) or (i == n_bay and sgn > 0):
                    continue
                b.beam("beam", (px, sy_front, z_front - 1.0), (px + sgn * 0.75, sy_front, z_front - 0.28), 0.10, 0.10, normal=(0, 1, 0))
            # tie beams back to the wall
            b.beam("beam", (px, sy_front - 0.2, z_front - 0.12), (px, sy_back + 0.05, z_front - 0.12), 0.14, 0.16, normal=(0, 0, 1))
        b.box("beam", sx0 - 0.25, sx1 + 0.25, sy_front - 0.09, sy_front + 0.09, z_front - 0.2, z_front, uv="longu")
        b.box("beam", sx0 - 0.25, sx1 + 0.25, sy_back - 0.14, sy_back, z_back - 0.2, z_back, uv="longu")
        # mono-pitch tiled roof (high at the wall, low towards the yard) + rafters + gutter
        oh = 0.45
        sl = (z_back - z_front) / sd
        e0 = (sx0 - 0.3, sy_front - oh, z_front - oh * sl + 0.16)
        e1 = (sx1 + 0.3, sy_front - oh, z_front - oh * sl + 0.16)
        r0 = (sx0 - 0.3, sy_back + 0.12, z_back + 0.12 * sl + 0.16)
        r1 = (sx1 + 0.3, sy_back + 0.12, z_back + 0.12 * sl + 0.16)
        eu.roof_slab(b, e0, e1, r1, r0, 0.07, "tiles", "boards", "boards")
        nr = 15
        for i in range(nr + 1):
            px = sx0 - 0.15 + (sx1 - sx0 + 0.3) * i / nr
            b.beam("beam", (px, sy_front - oh + 0.03, z_front - oh * sl + 0.02), (px, sy_back, z_back + 0.0), 0.07, 0.12,
                   normal=(0, -sl, 1))
        eu.half_round_gutter(b, "zinc", (e0[0] + 0.02, e0[1] - 0.07, e0[2] - 0.07), (e1[0] - 0.02, e1[1] - 0.07, e1[2] - 0.07),
                             outward=(0, -1, 0))
        eu.downpipe(b, "zinc", (sx0 - 0.2, e0[1] - 0.07, e0[2] - 0.15), 0.0, wall_offset=(0.0, 0.45))
        # boarded end walls of the shed
        for px, sgn in ((sx0 - 0.1, -1), (sx1 + 0.1, 1)):
            pts = [(sy_front, 0.0), (sy_back, 0.0), (sy_back, z_back - 0.02), (sy_front, z_front - 0.02)]
            with b.at(Matrix.Translation((px, 0, 0)) @ Matrix.Rotation(PI / 2, 4, "Z")):
                b.prism_xz("boards", [(p[0], p[1]) for p in pts], -0.03, 0.03)
        # contents: firewood, ladder cart, barrels, ladder on the wall
        eu.log_stack(b, "beam", sx0 + 0.25, sx0 + 3.6, 0.0, 1.55, sy_back - 1.15, sy_back - 0.1)
        eu.log_stack(b, "beam", sx0 + 0.25, sx0 + 2.4, 0.0, 1.2, sy_back - 2.4, sy_back - 1.35)
        with b.place(sx0 + 8.3, sy_back - 2.3, 0.0, rz=math.radians(96)):
            eu.ladder_cart(b, "beam", "iron")
        for k, (bx, by) in enumerate(((sx1 - 1.0, sy_back - 0.7), (sx1 - 1.85, sy_back - 0.75), (sx1 - 1.4, sy_back - 1.5))):
            with b.place(bx, by, 0.0, rz=k * 1.1):
                eu.barrel(b, "boards", "iron", radius=0.36, length=0.95)
        eu.barrel_lying(b, "boards", "iron", sx1 - 3.3, sy_back - 0.8, 0.0, rz=0.15, chocks="beam")
        with b.place(sx0 + 4.4, sy_back - 0.1, 2.05):
            for dz in (0.0, 0.40):
                b.box("beam", 0.0, 3.6, -0.05, 0.0, dz - 0.025, dz + 0.025, uv="longu")
            for k in range(12):
                b.box("beam", 0.15 + k * 0.3 - 0.015, 0.15 + k * 0.3 + 0.015, -0.04, -0.01, 0.0, 0.40, uv="long")

        # ---- yard furniture: dung heap, pump, trough, crates, tubs ----------------------------
        dx0, dx1, dy0, dy1 = hx - wt - 4.3, hx - wt - 0.1, yN + 2.6, yN + 6.3
        for (xa, xb, ya, yb) in ((dx0 - 0.22, dx0, dy0 - 0.22, dy1 + 0.22), (dx0, dx1, dy0 - 0.22, dy0), (dx0, dx1, dy1, dy1 + 0.22)):
            b.box("stone", xa, xb, ya, yb, 0.0, 0.55)
        eu.mound(b, "dung", dx0 + 0.05, dx1, dy0 + 0.05, dy1 - 0.05, 0.02, 1.05)
        # dung fork stuck in the heap
        b.beam("beam", (dx0 + 1.0, dy0 + 1.2, 0.5), (dx0 + 0.55, dy0 + 0.75, 1.75), 0.035, 0.035)
        eu.hand_pump(b, "iron", "stone", xJ + 2.2, yN + 1.4, 0.0)
        eu.stone_trough(b, "stone", "water", xJ + 3.5, yN + 1.4, 0.0)
        # harvest gear in front of the barn: tubs with grapes + stacked crates
        for k, (tx, ty, full) in enumerate(((5.2, yN + 1.3, True), (6.5, yN + 1.15, True), (7.6, yN + 1.6, False))):
            with b.place(tx, ty, 0.0):
                eu.grape_tub(b, "crate", fill_key="fol" if full else None, color=(0.03, 0.10, 0.045))
        colors = [(0.30, 0.03, 0.022), (0.04, 0.055, 0.05), (0.30, 0.03, 0.022), (0.30, 0.03, 0.022)]
        for k in range(7):
            cx_, cz_ = (-1.6 + (k % 2) * 0.66, (k // 2) * 0.31)
            eu.crate(b, "crate", cx_, yN + 0.85, cz_, rz=0.03 * (k % 3 - 1), color=colors[k % 4],
                     fill_key="fol" if k >= 5 else None)
        with b.place(-11.6, hy - wt - 1.3, 0.0, rz=math.radians(205)):
            # wheelbarrow
            b.box("boards", -0.45, 0.45, -0.3, 0.3, 0.38, 0.42)
            for sy in (-0.3, 0.3):
                b.box("boards", -0.45, 0.45, sy - 0.015, sy + 0.015, 0.42, 0.68)
                b.beam("beam", (-0.3, sy * 0.8, 0.36), (1.25, sy * 1.1, 0.62), 0.04, 0.04)
                b.beam("beam", (0.45, sy * 0.85, 0.40), (0.45, sy * 0.85, 0.0), 0.04, 0.04)
            b.box("boards", -0.47, -0.44, -0.3, 0.3, 0.42, 0.68)
            with b.place(-0.62, 0, 0.24):
                eu.spoked_wheel(b, "beam", "iron", r=0.24, width=0.05, spokes=6)

    # ==================================================================
    # 3. Outside the footprint: cobbled gate ramp draped onto the street-side terrain
    # ==================================================================
    ramp_end = site.terrain_z(-hx - 1.7, (g0 + g1) / 2) - 0.12
    with b.at(Matrix.Translation((-hx, g1 + 0.33, 0)) @ Matrix.Rotation(-PI / 2, 4, "Z")):
        eu.outward_prism(b, "cobble", 0.0, g1 - g0 + 0.66, [(0.0, F - 0.6), (1.7, F - 0.6), (1.7, min(F - 0.02, ramp_end)), (0.0, F)])
    print(f"[winzerhof] terrain at gate {site.terrain_z(-hx - 0.5, (g0 + g1) / 2):.2f} (floor {F}), "
          f"street corner {site.terrain_z(-hx - 0.5, -hy - 0.5):.2f}, rear {site.terrain_z(hx, 0):.2f}")

    # ------------------------------------------------------------------
    # Colliders (replace the solid OSM footprint): everything that stands, the gateway and yard stay drivable
    # ------------------------------------------------------------------
    R = eu.rect_poly
    solids = [
        R(-hx, hx, -hy - 0.05, yN),                                   # house + barn range
        R(-hx, -hx + 0.68, yN, g0 + 0.33),                            # street wall + pier south of the gate
        R(-hx, -hx + 0.68, g1 - 0.33, hy),                            # pier + street wall north of the gate
        R(-hx + 0.3, -hx + 2.35, g0 - 0.05, g0 + 0.33),               # open gate leaf (south)
        R(-hx + 0.3, -hx + 2.35, g1 - 0.33, g1 + 0.05),               # open gate leaf (north)
        R(-hx, hx, hy - wt, hy),                                      # north boundary wall
        R(hx - wt, hx, yN, hy),                                       # rear boundary wall
        R(sx0 - 0.3, sx1 + 0.3, sy_front - 0.2, hy - wt),             # cart shed (posts, cart, firewood, barrels)
        R(dx0 - 0.25, hx - wt, dy0 - 0.25, dy1 + 0.25),               # dung heap
        R(-hx + 1.8, -hx + 3.4, yN, yN + 0.75),                       # house door steps
        R(xJ + 1.6, xJ + 4.6, yN, yN + 2.0),                          # pump + trough
        R(-2.1, 1.3, yN, yN + 1.35),                                  # crates + open barn-door leaf
        R(4.5, 8.3, yN, yN + 2.3),                                    # harvest tubs
        R(-12.5, -10.7, hy - wt - 2.0, hy - wt),                      # wheelbarrow
    ]
    objects = b.finalize(col, ground_z=F)
    if do_export:
        eu.export_landmark(KEY, objects, site=site, solids=solids, replace_footprint=True)
    return objects


if __name__ == "__main__":
    build_winzerhof(eu.load_override_params(KEY), do_render=False, do_export=True)
