# Bauteile des Karabiners (AR-15/M4-Bauart, 14,5"). Baurahmen in mm:
#   X = rechts (Auswurfseite), Y = vorwärts (Lauf), Z = oben. Seelenachse = (X0, Z0). Y0 = Hinterkante Oberteil.
# Jedes Objekt bekommt ein Custom-Property "wmat" (Materialschlüssel) und "atlas" (A/B/C oder leer).
import math
from mathutils import Vector, Matrix
from weapon_geo import *

ZR = 31.0          # Oberkante Picatinny
ZB = 21.5          # Oberkante Gehäuse (Schienenfuß)
ZP = -14.0         # Trennfuge Ober-/Unterteil
UPPER_L = 188.0
BOLT_FACE = 158.0
MUZZLE = BOLT_FACE + 368.0   # Laufende (526)
FH_END = MUZZLE + 42.0       # Ende Mündungsfeuerdämpfer (568)
HG0, HG1 = 189.0, 497.0      # Handschutz
SIGHT_Z = 67.0               # Visierlinie Holo
RET_Y, RET_HALF = 160.8, 4.0  # Absehen-Ebene (8 x 8 mm)
EYE_Y = 106.0 - 130.0        # STYLE §5.2: 130 mm hinter der Haube
STOCK_F = -80.0              # Vorderkante Schulterstütze (4 Raststufen ausgezogen)
STOCK_L = 169.0
MAGWELL_Y = 151.75
MAGWELL_Z = -70.0
GRIP_TAN = math.tan(math.radians(21))
ORIGIN = (0.0, 33.0 + (-58 + 47) * GRIP_TAN, -58.0)   # Griffmitte auf Abzugsfingerhöhe

PARTS = {}


def reg(ob, mat, atlas, group=None):
    ob["wmat"] = mat
    ob["atlas"] = atlas
    if group:
        ob["group"] = group
    PARTS[ob.name] = ob
    return ob


def rail_profile(base, half_base=8.2, top=ZR):
    return [(half_base, base), (half_base, top - 6.2), (10.6, top - 3.8), (10.6, top - 2.8), (7.8, top),
            (-7.8, top), (-10.6, top - 2.8), (-10.6, top - 3.8), (-half_base, top - 6.2), (-half_base, base)]


def rail_slot_cutters(y0, y1, name, top=ZR, pitch=10.0, w=5.23, depth=3.0, x=12.5):
    cs = []
    y = y0
    i = 0
    while y + w / 2 <= y1:
        cs.append(box2(f"{name}_s{i}", (-x, y - w / 2, top - depth), (x, y + w / 2, top + 3)))
        y += pitch
        i += 1
    return cs


# =========================================================== Oberteil
def build_upper():
    prof = [(-15, ZP), (15, ZP), (15, 14.5), (11.8, ZB), (8.2, ZB)] + \
           [p for p in rail_profile(ZB)][1:-1] + [(-8.2, ZB), (-11.8, ZB), (-15, 14.5)]
    up = prism("Upper", prof, 'Y', 0, UPPER_L)
    cut = [
        cyl("c_bore", 12.75, -5, UPPER_L + 5, seg=48),
        box2("c_bslot", (-9, 8, ZP - 6), (9, UPPER_L - 4, ZP + 4.5)),
        box2("c_port", (9.5, 106, -9), (20, 168, 10)),
        box2("c_ch", (-6.2, -2, 13.2), (6.2, 9, ZB - 0.6)),
        # flache Seitenfelder (Schmiede-Relief) links/rechts vor dem Auswurf
        box2("c_relL", (-16, 106, -10.5), (-14.4, 176, 11)),
        # Absatz an der Front (Laufmutter-Schulter)
        box2("c_frontL", (-16, UPPER_L - 6, ZP - 1), (-14.2, UPPER_L + 1, 12)),
        box2("c_frontR", (14.2, UPPER_L - 6, ZP - 1), (16, UPPER_L + 1, 12)),
    ]
    cut += rail_slot_cutters(6.0, UPPER_L - 4, "c_urail")
    boolean(up, cut)
    finish(up, 0.45, 2)
    reg(up, "alu", "A")

    # Vorderer Verschlusshilfe-Tubus (Forward Assist) rechts
    fa = lathe("FA_Housing", [(0, 12.0), (6.4, 12.0), (8.0, 13.5), (8.4, 16), (8.4, 70), (7.6, 76), (5.5, 80), (0, 81.5)],
               seg=40, axis='Y', center=(14.6, -1.0))
    finish(fa, 0.5, 2)
    reg(fa, "alu", "A")
    fab = lathe("FA_Button", [(0, 0.6), (5.6, 0.6), (6.6, 1.2), (6.9, 2.4), (6.9, 5.5), (6.2, 6.0), (6.2, 7.0),
                              (6.9, 7.5), (6.9, 11.5), (6.2, 13.0), (0, 13.0)],
                seg=36, axis='Y', center=(14.6, -1.0))
    # Riffelung auf der Stirn
    cs = [box2(f"c_fab{i}", (14.6 - 8, 0.0, -1.0 + i * 1.6 - 5.6), (14.6 + 8, 1.0, -1.0 + i * 1.6 - 4.9)) for i in range(8)]
    boolean(fab, cs)
    finish(fab, 0.25, 2)
    reg(fab, "steel", "A")

    # Hülsenabweiser hinter dem Auswurf
    defl = prism("Deflector", [(82, -1.5), (102.5, -1.5), (104.5, 4.0), (101.5, 17.5), (95, 20.5), (84, 20.5), (80.5, 16)],
                 'X', 12.5, 21.0)
    # Schräge Prallfläche (vorne außen)
    boolean(defl, box2("c_defl", (0, 0, 0), (12, 30, 40), xform=rot('Z', -32, (0, 0, 0)) @ move(18.5, 100, -5)))
    finish(defl, 0.6, 3)
    reg(defl, "alu", "A")

    # Laufmutter (unter dem Handschutz, durch Schlitze sichtbar)
    nut = lathe("BarrelNut", [(9.6, UPPER_L - 2), (16.8, UPPER_L - 2), (16.8, UPPER_L + 22), (14.0, UPPER_L + 26),
                              (9.6, UPPER_L + 26)], seg=40, closed=True)
    finish(nut, 0.4, 2)
    reg(nut, "steel", "A")
    return up


def build_dustcover():
    # leicht gewölbte Klappe, Scharnier unten bei (15.6, -12.4)
    outer = [(15.1, -12.6), (16.0, -6), (16.35, 0), (16.1, 6), (15.6, 11.8)]
    inner = [(14.7, 11.8), (15.1, 6), (15.3, 0), (15.0, -6), (14.3, -11.6)]
    dc = prism("W_DustCover", outer + inner, 'Y', 104.5, 170.0)
    rib = box2("dc_rib", (15.5, 132.0, -3.0), (17.5, 140.0, 10.4))
    union(dc, [rib])
    cs = [box2("dc_p1", (16.0, 107, -8.5), (18, 129.5, 9.0)), box2("dc_p2", (16.0, 142.5, -8.5), (18, 167.5, 9.0))]
    boolean(dc, cs)
    kn = [cyl("dc_k1", 2.3, 104.5, 110, center=(15.6, -12.6), seg=16), cyl("dc_k2", 2.3, 164.5, 170, center=(15.6, -12.6), seg=16)]
    union(dc, kn)
    finish(dc, 0.25, 2)
    reg(dc, "steel", "A")
    rod = cyl("DC_Rod", 1.25, 101, 174, center=(15.6, -12.6), seg=16)
    finish(rod, 0.2, 1)
    reg(rod, "steel", "A")
    spr = helix("DC_Spring", 2.0, 0.42, 112, 160, 14, center=(15.6, -12.6), seg_per_turn=12, wire_seg=5)
    smooth_only(spr)
    reg(spr, "steel", "A")
    return dc


def build_bolt():
    car = lathe("W_Bolt", [(0, 52), (11.0, 52), (12.2, 53.5), (12.2, 150.5), (10.5, 152), (0, 152)], seg=48)
    cs = [box2(f"bc_fa{i}", (11.3, 112 + i * 2.1, -6.0), (14, 113.1 + i * 2.1, 6.0)) for i in range(10)]
    cs.append(box2("bc_flat", (11.6, 132, -7.5), (14, 150, 7.5)))
    cs.append(box2("bc_rel", (-14, 60, -14), (14, 100, -10.6)))
    boolean(car, cs)
    bolt = lathe("BoltHead", [(0, 150), (8.6, 150), (8.6, 157.0), (8.0, 158.0), (2.2, 158.0), (2.2, 157.2), (0, 157.2)], seg=32)
    ext = box2("Extractor", (5.6, 140, -2.4), (9.6, 157.6, 2.4))
    # Visual carrier detail, in the carrier envelope, moves with W_Bolt.
    cam = cyl("CamPin", 3.4, 9.0, 15.8, axis='Z', center=(0, 120), seg=16)
    car = join([car, bolt, ext, cam], "W_Bolt")
    finish(car, 0.3, 2)
    reg(car, "bcg", "A")
    return car


def build_charging_handle():
    prof = [(-4.6, 9), (4.6, 9), (4.6, -4.5), (17.0, -4.5), (20.0, -7.0), (20.0, -10.5), (17.0, -13.2),
            (-17.0, -13.2), (-20.0, -10.5), (-20.0, -7.0), (-17.0, -4.5), (-4.6, -4.5)]
    ch = prism("W_ChargingHandle", prof, 'Z', 16.6, 21.2)
    latch = prism("CH_Latch", [(-25.5, -12.6), (-17.5, -12.6), (-17.5, -4.0), (-22.0, -4.0), (-25.5, -7.5)], 'Z', 16.9, 20.9)
    grooves = [box2(f"chl_g{i}", (-26, -12.0 + i * 1.6, 20.2), (-18, -11.3 + i * 1.6, 22)) for i in range(5)]
    boolean(latch, grooves)
    ch = join([ch, latch], "W_ChargingHandle")
    finish(ch, 0.45, 2)
    reg(ch, "alu", "A")
    return ch


# =========================================================== Unterteil
def build_lower():
    body = [(-11.0, ZP), (118, ZP), (118, -47), (60, -47), (57.5, -49.5), (14, -49.5), (10, -45), (6, -38),
            (0, -31), (-6, -26), (-10.5, -20), (-11.0, -15)]
    lo = prism("Lower", body, 'X', -12.8, 12.8)
    mw = [(114, ZP), (188.5, ZP), (190.5, -16.5), (190.5, -22.5), (187.5, -26), (187.5, -63.5),
          (189.5, -65.5), (189.5, -68.5), (116.5, -75.5), (113.5, -73.5), (113.5, -47)]
    mag = prism("Magwell", mw, 'X', -15.4, 15.4)
    lip = prism("MagLip", [(114.5, -69.0), (189.8, -62.5), (189.8, -68.6), (116.3, -75.6), (114.5, -74.5)], 'X', -16.2, 16.2)
    lo = join([lo, mag, lip], "Lower")
    lo = boolean(lo, [], 'UNION')
    cut = [
        box2("c_mw", (-11.7, 119.0, -90), (11.7, 184.5, ZP + 2)),
        box2("c_trig", (-4.9, 70, -52), (4.9, 104, -40)),
        box2("c_fcg", (-9.5, 22, -40), (9.5, 112, ZP + 2)),     # Abzugsgruppen-Tasche (von oben)
        # Seitenfelder Magazinschacht (flache Vertiefung)
        box2("c_mwL", (-17, 124, -60), (-14.9, 182, -26)),
        box2("c_mwR", (14.9, 124, -60), (17, 182, -26)),
    ]
    boolean(lo, cut)
    finish(lo, 0.5, 2)
    reg(lo, "alu", "A")

    # Pufferrohr-Turm
    tower = lathe("Tower", [(12.0, -11.5), (15.4, -11.5), (16.2, -10.5), (16.2, 0.5), (12.0, 0.5)], seg=40, closed=True)
    boolean(tower, [box2("c_tw", (-20, -14, 13.4), (20, 2, 20))])
    finish(tower, 0.5, 2)
    reg(tower, "alu", "A")

    # Abzugsbügel
    outer = [(52.0, -47), (52.0, -60), (57.5, -71.5), (68, -77.0), (110, -77.0), (117, -72.5), (117, -60)]
    inner = [(113.5, -60), (113.5, -70.2), (108.5, -72.8), (69, -72.8), (61, -68.6), (56.2, -59), (56.2, -47)]
    tg = prism("TriggerGuard", outer + inner, 'X', -5.6, 5.6)
    finish(tg, 1.2, 3)
    reg(tg, "alu", "A")

    # Magazinknopf-Zaun (rechts) mit Mulde
    fence = prism("MagFence", [(104, -24), (121, -24), (121, -48), (104, -48)], 'X', 11.5, 15.0)
    boolean(fence, [cyl("c_fen", 6.4, 10, 20, axis='X', center=(113.0, -35.0), seg=32)])
    finish(fence, 0.6, 2)
    reg(fence, "alu", "A")
    btn = lathe("MagButton", [(0, 12.0), (5.3, 12.0), (5.3, 15.2), (4.7, 15.9), (0, 15.9)], seg=32, axis='X', center=(113.0, -35.0))
    rid = [box2(f"c_mb{i}", (15.4, 107 + i * 1.5, -41), (17, 107.6 + i * 1.5, -29)) for i in range(8)]
    boolean(btn, rid)
    finish(btn, 0.2, 2)
    reg(btn, "steel", "A")

    # Verschlussfang-Ohren links
    ears = prism("BC_Ears", [(102, ZP - 0.5), (118, ZP - 0.5), (118, -27), (102, -27)], 'X', -15.0, -12.0)
    finish(ears, 0.5, 2)
    reg(ears, "alu", "A")

    # Stifte (Kopf links und rechts)
    pins = []
    for nm, y, z, r in [("TakedownPin", 27, -20, 3.4), ("PivotPin", 183, -19.5, 3.4)]:
        for s in (-1, 1):
            p = lathe(f"{nm}{'L' if s < 0 else 'R'}", [(0, 0), (r, 0), (r, 0.9), (r * 0.65, 1.5), (0, 1.6)], seg=24, axis='X', center=(y, z))
            if s < 0:
                xf_obj(p, Matrix.Scale(-1, 4, Vector((1, 0, 0))))
                xf_obj(p, move(-12.85 if nm == "TakedownPin" else -15.3, 0, 0))
            else:
                xf_obj(p, move(12.85 if nm == "TakedownPin" else 15.3, 0, 0))
            finish(p, 0.15, 1)
            pins.append(reg(p, "steel", "A"))
    for nm, y, z in [("TrigPin", 74, -36), ("HamPin", 92, -31)]:
        for s in (-1, 1):
            p = cyl(f"{nm}{s}", 2.0, 0, 0.5, axis='X', center=(y, z), seg=16)
            xf_obj(p, move(12.8 * s - (0.5 if s < 0 else 0), 0, 0))
            finish(p, 0.1, 1)
            pins.append(reg(p, "steel", "A"))
    # Rastbolzen-Schraube vorne am Pistolengriff entfällt (unten verdeckt)
    return lo


def build_trigger():
    prof = [(78.5, -38), (77.6, -48), (77.8, -56), (79.6, -62.5), (82.6, -66.8), (85.6, -66.0), (84.6, -62.0),
            (83.4, -56), (83.6, -48), (85.0, -40), (84.0, -36)]
    tr = prism("W_Trigger", prof, 'X', -4.6, 4.6)
    finish(tr, 0.9, 3)
    reg(tr, "steel", "A")
    return tr


def build_selector():
    # Hebel links, zeigt in Ruheform nach vorne (SAFE); Objekt-Rotation X=+90° -> FIRE
    hub = lathe("Sel_Hub", [(0, -16.6), (5.2, -16.6), (5.8, -15.8), (5.8, -12.8), (0, -12.8)], seg=32, axis='X', center=(45, -30))
    lev = prism("Sel_Lever", [(45, -33.2), (61, -31.6), (63.5, -30.0), (61, -28.4), (45, -26.8)], 'X', -16.4, -13.8)
    sel = join([hub, lev], "W_Selector")
    sel = boolean(sel, [], 'UNION')
    grv = [box2(f"c_sg{i}", (-17.5, 54 + i * 2.2, -34), (-15.9, 54.8 + i * 2.2, -26)) for i in range(4)]
    boolean(sel, grv)
    stub = lathe("Sel_R", [(0, 12.8), (4.0, 12.8), (4.0, 14.2), (3.4, 14.8), (0, 14.8)], seg=24, axis='X', center=(45, -30))
    sel = join([sel, stub], "W_Selector")
    finish(sel, 0.3, 2)
    reg(sel, "steel", "A")
    return sel


def build_boltcatch():
    prof = [(103.0, -19.0), (113.5, -19.0), (114.0, -22.5), (111.5, -33.5), (104.5, -33.5), (103.0, -27.0)]
    bc = prism("W_BoltCatch", prof, 'X', -16.6, -14.9)
    grv = [box2(f"c_bcg{i}", (-18, 105 + i * 1.6, -33), (-16.2, 105.6 + i * 1.6, -26.5)) for i in range(4)]
    boolean(bc, grv)
    pin = cyl("BC_Pin", 1.6, -16.9, -14.9, axis='X', center=(110.5, -21.5), seg=12)
    bc = join([bc, pin], "W_BoltCatch")
    finish(bc, 0.3, 2)
    reg(bc, "steel", "A")
    return bc


# =========================================================== Griff
def grip_section(z, n=28):
    t = (-47 - z)          # Abstand unter Gehäuse
    yc = 33.0 + (z + 47) * GRIP_TAN
    D = 45.0 - 0.04 * max(t, 0)          # Tiefe vorn-hinten
    W = 30.0 - 0.02 * max(t, 0)
    # Biberschwanz oben hinten
    ext = 9.0 * max(0.0, min(1.0, (z + 63) / 14.0)) ** 1.5
    flare = 0.0
    if z < -133:
        flare = min(1.8, (-133 - z) * 0.6)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        e = 2.4
        u = math.copysign(abs(c) ** (2 / e), c)
        v = math.copysign(abs(s) ** (2 / e), s)
        # vorne schmaler (Frontstrap), hinten voller
        wf = 0.80 + 0.20 * (1 - (u + 1) / 2)
        du = (D / 2 + (ext if u < 0 else 0) * (abs(u) ** 2)) * u
        pts.append(((W / 2 + flare) * wf * v, yc + du + (flare if u > 0 else -flare) * 0.6 * abs(u), z))
    return pts


def build_grip():
    zs = [-40, -44, -47, -50, -53, -57, -62, -68, -75, -83, -91, -99, -107, -115, -122, -128, -132.5, -135, -137.5, -139.5]
    secs = [grip_section(z) for z in zs]
    gp = loft("PistolGrip", secs, True, True)
    finish(gp, 1.2, 3, angle=40)
    reg(gp, "poly", "B", "grip")
    return gp


# =========================================================== Pufferrohr / Schaft
STOCK_STATIONS = [0, 1.5, 5, 10, 20, 35, 50, 65, 80, 95, 110, 125, 138, 150, 159, 165, 169]


def _smax(a, b, k=4.0):
    h = max(0.0, min(1.0, 0.5 + 0.5 * (a - b) / k))
    return b + (a - b) * h + k * h * (1 - h)


def stock_section(y, sv, N=20):
    """Querschnitt Schaft bei Station sv (0 = Vorderkante). Rohrgehäuse R=19.5 um die Pufferrohrachse,
    Steg nach unten (Breite wächst nach hinten), Unterkante fällt nach hinten ab."""
    L = STOCK_L
    Rt = 19.5 if sv > 3 else 17.5 + 2.0 * sv / 3
    if sv < 22:
        zb = -24.0
    else:
        k = min(1.0, (sv - 22) / (L - 30))
        zb = -24.0 - 78.0 * (k ** 1.08)
    if sv > L - 8:
        zb += (sv - (L - 8)) * 0.35
    ww = 11.5 + 8.5 * max(0.0, min(1.0, (sv - 95) / 45.0))      # halbe Stegbreite
    rc = 6.0
    top = Rt
    pts_r = []
    for i in range(N + 1):
        t = i / N
        z = top - (top - zb) * (0.5 - 0.5 * math.cos(math.pi * t))
        circ = math.sqrt(max(0.0, Rt * Rt - z * z)) if z > -Rt else 0.0
        if z > -6:
            web = 0.0
        elif z < zb + rc:
            dz = (zb + rc) - z
            web = (ww - rc) + math.sqrt(max(0.0, rc * rc - dz * dz))
        else:
            web = ww
        x = _smax(circ, web, 5.0) if z < Rt - 0.5 else circ
        pts_r.append((x, z))
    pts_r[-1] = (ww - rc, zb)
    pts = [(x, y, z) for x, z in pts_r] + [(-x, y, z) for x, z in reversed(pts_r[1:-1])]
    # Punkt 0 (oben, x=0) und Punkt N (unten) gemeinsam; linke Seite ohne Endpunkte -> 2N Punkte
    pts.insert(N + 1, (-(ww - rc), y, zb))
    return pts


def build_buffer_stock():
    tube = lathe("BufferTube", [(0, -172), (13.4, -172), (14.6, -170.8), (14.6, -11.5), (0, -11.5)], seg=48)
    key = box2("BT_Key", (-4.6, -168, -18.2), (4.6, -24, -12.5))
    holes = [cyl(f"c_bth{i}", 2.0, -25, -10, axis='Z', center=(0, -40 - i * 16.8), seg=12) for i in range(6)]
    boolean(key, holes)
    tube = join([tube, key], "BufferTube")
    finish(tube, 0.4, 2)
    reg(tube, "alu", "A")

    endp = lathe("EndPlate", [(14.7, -11.4), (17.6, -11.4), (17.6, -13.2), (14.7, -13.2)], seg=48, closed=True)
    qd = cyl("QD_Boss", 5.4, -23.8, -8.0, axis='X', center=(-12.3, -9.5), seg=24)
    qd_link = box2("QD_Web", (-19.5, -13.2, -14.0), (-12.0, -11.4, -5.0))
    endp = join([endp, qd, qd_link], "EndPlate")
    endp = boolean(endp, [cyl("c_qd", 3.0, -25, -20, axis='X', center=(-12.3, -9.5), seg=20)])
    finish(endp, 0.3, 2)
    reg(endp, "steel", "A")

    cn = lathe("CastleNut", [(14.7, -13.3), (17.6, -13.3), (18.2, -14.0), (18.2, -21.4), (17.4, -22.2), (14.7, -22.2)], seg=48, closed=True)
    notches = [box2(f"c_cn{i}", (-3, -23, 15.2), (3, -19.8, 20), xform=rot('Y', 45 + i * 90)) for i in range(4)]
    boolean(cn, notches)
    finish(cn, 0.3, 2)
    reg(cn, "steel", "A")

    # Schulterstütze (Loft entlang -Y): Rohrgehäuse oben + Steg nach unten, hinten breiter Kolben
    f = STOCK_F
    L = STOCK_L
    st = loft("Stock", [stock_section(f - sv, sv) for sv in STOCK_STATIONS], True, True)
    # Riemenschlitz hinten unten + seitliche Mulden
    slot = prism("c_sslot", rrect(f - 146, -84, 14.0, 6.0, 2.5, 3), 'X', -40, 40)
    recL = prism("c_recL", rrect(f - 112, -52, 62.0, 40.0, 8.0, 4), 'X', -40, -14.6)
    recR = prism("c_recR", rrect(f - 112, -52, 62.0, 40.0, 8.0, 4), 'X', 14.6, 40)
    boolean(st, [slot, recL, recR])
    finish(st, 0.9, 3, angle=35)
    reg(st, "poly", "B", "stock")

    # Verstellhebel unter dem Kragen
    lev = prism("StockLever", [(f - 6, -22), (f - 42, -22), (f - 45, -26.5), (f - 40, -30.0), (f - 12, -28.5), (f - 6, -25.5)], 'X', -6.5, 6.5)
    finish(lev, 0.8, 3)
    reg(lev, "poly", "B")
    pin = cyl("StockPin", 2.4, -10, 10, axis='X', center=(f - 34, -26.0), seg=16)
    finish(pin, 0.2, 1)
    reg(pin, "steel", "A")

    # Schaftkappe (Gummi) mit Rillen
    y1 = f - L
    sb = stock_section(y1, L)
    cz = sum(p[2] for p in sb) / len(sb)
    pad_secs = []
    for dy, grow in [(0.5, 0.0), (-1.0, 0.9), (-6.5, 1.4), (-9.0, 0.7)]:
        pad_secs.append([(x * (1 + grow / 22), y1 + dy, cz + (z - cz) * (1 + grow / 64)) for (x, _, z) in sb])
    pad = loft("ButtPad", pad_secs, True, True)
    grooves = [box2(f"c_bp{i}", (-30, y1 - 10, -96 + i * 8.5), (30, y1 - 7.8, -94.6 + i * 8.5)) for i in range(14)]
    boolean(pad, grooves)
    finish(pad, 0.6, 2, angle=35)
    reg(pad, "rubber", "B")
    return st


# =========================================================== Handschutz, Lauf, Mündung
def hg_octagon(s=0.0):
    a, b, c, d = 9.5, 20.0, 9.5, -10.5
    return [(9.5 - s * 0.4, -21 + s), (20 - s, -10.5 + s * 0.4), (20 - s, 9.5 - s * 0.4), (9.5 - s * 0.4, 20 - s),
            (-9.5 + s * 0.4, 20 - s), (-20 + s, 9.5 - s * 0.4), (-20 + s, -10.5 + s * 0.4), (-9.5 + s * 0.4, -21 + s)]


def build_handguard():
    outer = [(9.5, -21), (20, -10.5), (20, 9.5), (11.2, 18.3), (8.2, 19.6)] + rail_profile(19.6)[1:-1] + \
            [(-8.2, 19.6), (-11.2, 18.3), (-20, 9.5), (-20, -10.5), (-9.5, -21)]
    hg = prism("Handguard", outer, 'Y', HG0, HG1)
    inner = prism("c_hgin", hg_octagon(3.0), 'Y', HG0 - 5, HG1 + 5)
    cuts = [inner]
    cuts += rail_slot_cutters(HG0 + 6, HG1 - 3, "c_hgrail")
    # M-LOK-Schlitze 32x7 mm, Teilung 40 mm
    ys = [HG0 + 46 + 40 * k for k in range(7)]
    faces = [("R", (20.0, -0.5), 0), ("L", (-20.0, -0.5), 180), ("B", (0.0, -21.0), -90),
             ("BR", (14.75, -15.75), -45), ("BL", (-14.75, -15.75), -135), ("TR", (15.6, 13.9), 45), ("TL", (-15.6, 13.9), 135)]
    for nm, (fx, fz), ang in faces:
        for k, yc in enumerate(ys):
            if nm in ("TR", "TL") and k % 2 == 1:
                continue
            st = stadium(yc, 0.0, 32.0, 7.0, seg=6)
            c = prism(f"c_ml{nm}{k}", [(0.0, v) for v in []] or [(p[0], p[1]) for p in st], 'Z', -6, 6)
            # Prisma: (u=y, v=quer) liegt in XY-Ebene, extrudiert Z -> drehen, dass Z = Flächennormale
            M = Matrix.Translation(Vector((fx, 0, fz)) * MM) @ Matrix.Rotation(math.radians(-ang), 4, 'Y') @ \
                Matrix.Rotation(math.radians(90), 4, 'Y')
            xf_obj(c, _swap_xy())
            xf_obj(c, M)
            cuts.append(c)
    # Klemmschrauben-Bohrungen (unten schräg)
    boolean(hg, cuts)
    finish(hg, 0.45, 2)
    reg(hg, "alu", "A")
    # Klemmschrauben
    for i, y in enumerate((HG0 + 8, HG0 + 22)):
        for s in (-1, 1):
            sc = lathe(f"HG_Screw{i}{s}", [(0, 0), (3.0, 0), (3.0, 1.6), (2.6, 2.1), (0, 2.1)], seg=20, axis='Z', center=(0, y))
            boolean(sc, [lathe(f"c_hex{i}{s}", [(0, 0.6), (1.45, 0.6), (1.45, 3), (0, 3)], seg=6, axis='Z', center=(0, y))])
            M = Matrix.Translation(Vector((14.75 * s, 0, -15.75)) * MM) @ Matrix.Rotation(math.radians(135 * s), 4, 'Y')
            xf_obj(sc, M)
            finish(sc, 0.15, 1)
            reg(sc, "steel", "A")
    return hg


def _swap_xy():
    # Stadium-Prisma: (x=Y-Länge, y=Quer, z=Extrusion) -> Länge auf Y-Achse, Quer auf X, Extrusion auf Z
    return Matrix(((0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))


def build_barrel():
    prof = [(0, BOLT_FACE - 30), (12.5, BOLT_FACE - 30), (12.5, UPPER_L - 2), (9.5, UPPER_L), (9.5, 318), (8.0, 323),
            (7.95, MUZZLE - 13), (7.4, MUZZLE - 12.4), (7.4, MUZZLE), (2.9, MUZZLE), (2.9, BOLT_FACE - 30 + 2), (0, BOLT_FACE - 28)]
    br = lathe("Barrel", prof, seg=40)
    finish(br, 0.3, 2)
    reg(br, "steel", "A")
    # Flaches Gasblock (low profile) mit Klemmschrauben
    gb = prism("GasBlock", rrect(0, 1.5, 24.0, 25.0, 6.0, 4), 'Y', 326, 348)
    boolean(gb, [cyl("c_gbb", 8.05, 320, 355, seg=32)])
    for i, y in enumerate((331, 342)):
        boolean(gb, [lathe(f"c_gbs{i}", [(0, -20), (2.0, -20), (2.0, -9.0), (0, -9.0)], seg=12, axis='Z', center=(0, y))])
    finish(gb, 0.5, 2)
    reg(gb, "steel", "A")
    gt = cyl("GasTube", 2.4, UPPER_L - 6, 330, center=(0, 15.0), seg=12)
    finish(gt, 0.0, 0)
    reg(gt, "steel", "A")
    # Quetschscheibe
    cw = lathe("CrushWasher", [(7.4, MUZZLE - 12.4), (9.6, MUZZLE - 12.4), (9.6, MUZZLE - 11.0), (7.4, MUZZLE - 11.0)], seg=32, closed=True)
    reg(cw, "steel", "A")
    finish(cw, 0.15, 1)
    # Mündungsfeuerdämpfer (Vogelkäfig, unten geschlossen)
    y0 = MUZZLE - 11.0
    fh = lathe("FlashHider", [(5.2, y0), (9.4, y0), (10.0, y0 + 1), (10.0, y0 + 9), (11.1, y0 + 12.5), (11.1, FH_END - 1.6),
                              (10.3, FH_END), (7.6, FH_END), (7.2, FH_END - 1), (7.2, y0 + 15), (5.2, y0 + 13)],
               seg=48, closed=True)
    slots = []
    for k, a in enumerate((0, 60, -60, 120, -120)):
        c = box2(f"c_fhs{k}", (-1.45, y0 + 18.5, 4.5), (1.45, FH_END - 3.2, 14))
        xf_obj(c, rot('Y', a))
        slots.append(c)
    # Schlüsselflächen
    slots.append(box2("c_fhf1", (9.0, y0 - 1, -12), (12, y0 + 9.5, 12)))
    slots.append(box2("c_fhf2", (-12, y0 - 1, -12), (-9.0, y0 + 9.5, 12)))
    boolean(fh, slots)
    finish(fh, 0.3, 2)
    reg(fh, "steel", "A")
    return br


# =========================================================== Visierung
def build_iron_sights():
    # Hinten (umgeklappt) auf dem Oberteil
    base = prism("RearSight", [(-11.5, ZR - 4.6), (11.5, ZR - 4.6), (11.5, ZR + 4.5), (7.0, ZR + 7.4), (-7.0, ZR + 7.4), (-11.5, ZR + 4.5)],
                 'Y', 3.0, 31.0)
    boolean(base, [prism("c_rsr", rail_profile(ZR - 8.0), 'Y', 0, 40)])
    boolean(base, [box2("c_rsp", (-8.5, 10, ZR + 5.8), (8.5, 29, ZR + 9))])
    leaf = prism("RS_Leaf", rrect(0, 0, 17.0, 3.0, 1.2, 3), 'X', -7.8, 7.8)  # Platzhalter
    delete(leaf)
    leaf = prism("RS_Leaf", [(10.5, ZR + 5.6), (28.0, ZR + 5.6), (28.0, ZR + 8.4), (10.5, ZR + 8.4)], 'X', -7.6, 7.6)
    boolean(leaf, [cyl("c_rsl", 2.4, -10, 10, axis='Z', center=(0, 22.5), seg=20), box2("c_rsw", (-4.5, 13, ZR + 4), (4.5, 18.5, ZR + 10))])
    knob = lathe("RS_Knob", [(0, 11.5), (5.2, 11.5), (5.2, 15.5), (4.6, 16.2), (0, 16.2)], seg=24, axis='X', center=(12.0, ZR + 1.8))
    rs = join([base, leaf, knob], "RearSight")
    finish(rs, 0.4, 2)
    reg(rs, "alu", "A")
    # Vorne (umgeklappt) auf dem Handschutz
    fb = prism("FrontSight", [(-11.5, ZR - 4.6), (11.5, ZR - 4.6), (11.5, ZR + 3.8), (6.5, ZR + 7.8), (-6.5, ZR + 7.8), (-11.5, ZR + 3.8)],
               'Y', HG1 - 30, HG1 - 4)
    boolean(fb, [prism("c_fsr", rail_profile(ZR - 8.0), 'Y', HG1 - 40, HG1 + 5)])
    boolean(fb, [box2("c_fsp", (-4.8, HG1 - 26, ZR + 5), (4.8, HG1 - 7, ZR + 9))])
    post = box2("FS_Post", (-1.2, HG1 - 25, ZR + 5.2), (1.2, HG1 - 8, ZR + 7.0))
    hinge = cyl("FS_Hinge", 2.2, -8, 8, axis='X', center=(HG1 - 7, ZR + 5.5), seg=16)
    fs = join([fb, post, hinge], "FrontSight")
    finish(fs, 0.4, 2)
    reg(fs, "alu", "A")


def trap(cx, z0, z1, wb, wt, rb, rt, seg=5):
    """Trapez (unten breiter) mit gerundeten Ecken, Punkte (x, z)."""
    pts = []
    cs = [(cx + wb / 2 - rb, z0 + rb, rb, -90, 0), (cx + wt / 2 - rt, z1 - rt, rt, 0, 90),
          (cx - wt / 2 + rt, z1 - rt, rt, 90, 180), (cx - wb / 2 + rb, z0 + rb, rb, 180, 270)]
    for (ox, oz, r, a0, a1) in cs:
        for k in range(seg + 1):
            a = math.radians(a0 + (a1 - a0) * k / seg)
            pts.append((ox + r * math.cos(a), oz + r * math.sin(a)))
    return pts


def build_holo():
    S = SIGHT_Z
    # Schienenklemme
    cl = prism("Holo_Clamp", [(-12.8, ZR - 5.0), (12.8, ZR - 5.0), (13.5, ZR - 1.0), (13.5, ZR + 3.5), (-13.5, ZR + 3.5), (-13.5, ZR - 1.0)],
               'Y', 78, 138)
    boolean(cl, [prism("c_hcr", rail_profile(ZR - 9.0), 'Y', 70, 145)])
    finish(cl, 0.5, 2)
    reg(cl, "alu", "A")
    # Querschraube mit gerändeltem Knopf links
    star = []
    n = 28
    for i in range(2 * n):
        a = math.pi * i / n
        r = 7.4 if i % 2 == 0 else 6.7
        star.append((128 + r * math.cos(a), ZR - 0.5 + r * math.sin(a)))
    knob = prism("Holo_Knob", star, 'X', -22.0, -14.5)
    cap = lathe("Holo_KnobCap", [(0, -22.6), (5.0, -22.6), (6.6, -22.0), (0, -22.0)], seg=28, axis='X', center=(128, ZR - 0.5))
    knob = join([knob, cap], "Holo_Knob")
    finish(knob, 0.25, 1)
    reg(knob, "alu", "A")
    nut = lathe("Holo_Nut", [(0, 13.5), (4.6, 13.5), (4.6, 16.5), (0, 16.5)], seg=6, axis='X', center=(128, ZR - 0.5))
    finish(nut, 0.2, 1)
    reg(nut, "steel", "A")

    # Grundkörper (Batteriefach vorne quer, Bedienfeld hinten schräg)
    base_prof = [(76, ZR + 3.0), (170, ZR + 3.0), (172.5, ZR + 6), (172.5, ZR + 15.0), (168, ZR + 18.5), (86, ZR + 18.5), (76, ZR + 11.5)]
    body = prism("Holo_Body", base_prof, 'X', -17.0, 17.0)
    finish(body, 0.9, 3)
    reg(body, "alu", "A")
    batt = lathe("Holo_Batt", [(0, -18.5), (7.6, -18.5), (8.4, -17.6), (8.4, 17.6), (7.6, 18.5), (0, 18.5)], seg=32, axis='X', center=(160, ZR + 10.5))
    finish(batt, 0.3, 2)
    reg(batt, "alu", "A")
    star = []
    for i in range(40):
        a = math.pi * i / 20
        r = 8.6 if i % 2 == 0 else 8.1
        star.append((160 + r * math.cos(a), ZR + 10.5 + r * math.sin(a)))
    bcap = prism("Holo_BattCap", star, 'X', 18.5, 21.5)
    finish(bcap, 0.3, 1)
    reg(bcap, "alu", "A")

    # Haube: rechteckiger Rahmen um das Fenster
    zo0, zo1 = ZR + 14.5, S + 15.0
    ow, oh = 46.0, zo1 - zo0
    outer = trap(0, zo0, zo1, 45.0, 39.0, 5.0, 4.5)
    hood = prism("Holo_Hood", outer, 'Y', 106, 166)
    win = prism("c_win", trap(0, S - 13.0, S + 12.8, 37.0, 31.5, 3.0, 2.5), 'Y', 100, 172)
    # Fasen an den Haubenkanten vorn/hinten oben
    ch1 = box2("c_hc1", (-30, 0, 0), (30, 10, 10), xform=Matrix.Translation(Vector((0, 166, zo1)) * MM) @ rot('X', 35) @ move(0, -5, -2))
    ch2 = box2("c_hc2", (-30, 0, 0), (30, 10, 10), xform=Matrix.Translation(Vector((0, 106, zo1)) * MM) @ rot('X', -35) @ move(0, -5, -2))
    boolean(hood, [win, ch1, ch2])
    finish(hood, 0.8, 3)
    reg(hood, "alu", "A")
    # Bedientasten hinten (Gummi)
    for i, x in enumerate((-9.0, 0.0, 9.0)):
        b = prism(f"Holo_Btn{i}", rrect(x, 0, 6.5, 6.5, 1.8, 3), 'Z', 0, 2.2)
        M = Matrix.Translation(Vector((0, 80.6, ZR + 9.6)) * MM) @ Matrix.Rotation(math.radians(-55), 4, 'X') @ Matrix.Rotation(math.radians(-90), 4, 'X')
        xf_obj(b, Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))))
        xf_obj(b, Matrix.Translation(Vector((0, 80.5, ZR + 10.2)) * MM) @ Matrix.Rotation(math.radians(55), 4, 'X') @ Matrix.Translation(Vector((0, 0, 0))))
        finish(b, 0.5, 2)
        reg(b, "rubber", "B")
    # Laserfenster innen unten (dunkel)
    lw = box2("Holo_LaserWin", (-6, 150, ZR + 18.4), (6, 157, ZR + 18.9))
    reg(lw, "glassdark", "A")
    # Gläser
    g1 = prism("SG_Rear", trap(0, S - 13.2, S + 13.0, 37.4, 31.9, 3.0, 2.5), 'Y', 111.0, 112.0)
    g2 = prism("SG_Front", trap(0, S - 13.2, S + 13.0, 37.4, 31.9, 3.0, 2.5), 'Y', 161.5, 162.5)
    sg = join([g1, g2], "W_SightGlass")
    smooth_only(sg)
    reg(sg, "holo_glass", "")
    # Absehen-Ebene
    import bmesh
    bm = bmesh.new()
    h = RET_HALF
    vs = [bm.verts.new(Vector((x, RET_Y, S + z)) * MM) for x, z in ((-h, -h), (h, -h), (h, h), (-h, h))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new("UVMap")
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    rt = obj_from_bm("W_Reticle", bm)
    # Normale soll nach -Y (zum Auge) zeigen
    if rt.data.polygons[0].normal.y > 0:
        rt.data.flip_normals()
    reg(rt, "reticle", "")
    return hood


# =========================================================== Waffenlicht, Druckschalter, Winkelgriff
LIGHT_C = (33.0, 17.0)
LIGHT_Y0, LIGHT_Y1 = 384.0, 494.0


def build_light():
    cx, cz = LIGHT_C
    y0, y1 = LIGHT_Y0, LIGHT_Y1
    body = lathe("Light_Body", [(0, y0 + 4), (9.6, y0 + 4), (11.2, y0 + 5.2), (11.4, y0 + 17), (10.4, y0 + 18.5), (10.4, y0 + 74),
                                (11.0, y0 + 76), (12.7, y0 + 86), (12.9, y1 - 3), (12.4, y1), (11.0, y1), (11.0, y1 - 1.8),
                                (0, y1 - 1.8)], seg=48, axis='Y', center=LIGHT_C)
    # Griffringe (Rändel als Rillen) am Endkappenbereich
    rings = [lathe(f"c_lr{i}", [(11.0, y0 + 7 + i * 2.0), (13, y0 + 7 + i * 2.0), (13, y0 + 7.9 + i * 2.0), (11.0, y0 + 7.9 + i * 2.0)],
                   seg=48, axis='Y', center=LIGHT_C, closed=True) for i in range(5)]
    flats = [box2(f"c_lf{i}", (cx - 15, y0 + 22 + i * 12, cz - 15), (cx + 15, y0 + 28 + i * 12, cz + 15)) for i in range(0)]
    boolean(body, rings)
    finish(body, 0.35, 2)
    reg(body, "alu", "A")
    refl = lathe("Light_Reflector", [(10.9, y1 - 2.0), (8.0, y1 - 6.0), (5.5, y1 - 9.0), (3.4, y1 - 11.0), (0, y1 - 11.0)],
                 seg=48, axis='Y', center=LIGHT_C)
    smooth_only(refl)
    reg(refl, "chrome", "A")
    led = lathe("Light_LED", [(0, y1 - 8.6), (1.4, y1 - 8.8), (2.2, y1 - 9.6), (2.4, y1 - 10.9), (0, y1 - 10.9)], seg=20, axis='Y', center=LIGHT_C)
    smooth_only(led)
    reg(led, "led", "A")
    lens = lathe("W_LightLens", [(0, y1 - 2.4), (11.0, y1 - 2.4), (11.0, y1 - 1.6), (0, y1 - 1.6)], seg=48, axis='Y', center=LIGHT_C)
    smooth_only(lens)
    reg(lens, "lens", "")
    btn = lathe("Light_Button", [(0, y0 - 0.8), (4.0, y0 - 0.8), (5.6, y0 + 0.4), (6.6, y0 + 4.2), (0, y0 + 4.2)], seg=32, axis='Y', center=LIGHT_C)
    finish(btn, 0.3, 2)
    reg(btn, "rubber", "B")
    # Versetzte Montage: Ring um den Körper + Steg zum Handschutz (rechte Seitenfläche)
    ring = lathe("Light_Ring", [(10.3, 422), (13.6, 422), (14.2, 423), (14.2, 445), (13.6, 446), (10.3, 446)], seg=40, axis='Y', center=LIGHT_C, closed=True)
    arm = prism("Light_Arm", [(19.6, -4.0), (24.0, -4.0), (30.0, 6.0), (27.0, 9.0), (19.6, 8.0)], 'Y', 424, 444)
    clampb = prism("Light_ClampBolt", circle_pts(0, 0, 2.6, 6), 'Z', 0, 5.0)
    xf_obj(clampb, Matrix.Translation(Vector((cx + 9.0, 434.0, cz - 13.5)) * MM) @ Matrix.Rotation(math.radians(30), 4, 'Y'))
    mount = join([ring, arm], "Light_Mount")
    finish(mount, 0.5, 2)
    reg(mount, "alu", "A")
    finish(clampb, 0.2, 1)
    reg(clampb, "steel", "A")


def build_pressure_switch():
    pad = prism("PS_Pad", rrect(0, 0, 40.0, 15.0, 4.0, 4), 'Z', 0.0, 4.6)
    bump = prism("PS_Bump", rrect(0, 0, 22.0, 9.0, 3.5, 4), 'Z', 4.0, 6.0)
    ps = join([pad, bump], "PS_Pad")
    # in Seitenfläche rechts (X=20), Länge entlang Y
    M = Matrix.Translation(Vector((20.0, 352.0, -1.0)) * MM) @ Matrix.Rotation(math.radians(90), 4, 'Y') @ _swap_xy()
    xf_obj(ps, M)
    finish(ps, 0.8, 3)
    reg(ps, "rubber", "B")
    # Kabel vom Pad-Ende zur Endkappe
    cx, cz = LIGHT_C
    path = [(23.0, 372.0, -1.0), (24.0, 376.0, -0.5), (27.0, 380.0, 1.5), (32.0, 381.0, 6.0), (34.5, 379.5, 12.0), (34.0, 378.5, 16.5),
            (33.0, 380.5, 17.0), (33.0, 383.0, 17.0)]
    cab = sweep("PS_Cable", path, circle_pts(0, 0, 1.6, 8), up=(0, 0, 1))
    smooth_only(cab)
    reg(cab, "rubber", "B")
    plug = lathe("PS_Plug", [(0, 381.5), (2.6, 381.5), (3.2, 383.5), (3.2, 386.0), (0, 386.0)], seg=16, axis='Y', center=(cx, cz))
    xf_obj(plug, move(0, -4.0, 0))
    delete(plug)


def build_afg():
    prof = [(362, -20.0), (362.5, -25.5), (357, -29.2), (322, -35.5), (307, -44.5), (298.5, -52.0), (293.8, -51.5),
            (291.5, -46.0), (291.5, -20.0)]
    afg = prism("AFG", prof, 'X', -11.5, 11.5)
    # seitliche Hohlkehle
    finish(afg, 3.0, 4, angle=30)
    reg(afg, "poly", "B", "afg")
    rail = prism("AFG_Base", rrect(326.5, 0, 68.0, 17.0, 3.0, 3), 'Z', -21.6, -19.6)
    xf_obj(rail, _swap_xy())
    finish(rail, 0.3, 1)
    reg(rail, "poly", "B")


# =========================================================== Magazin + Patrone
MAG_ZS, MAG_R, MAG_ANG = 92.0, 430.0, 0.205


def mag_path():
    """Mittellinie des Magazins: gerade bis Z=-80, dann Bogen nach vorn."""
    pts = []
    y0, z_top = MAGWELL_Y, -21.0
    for i in range(10):
        z = z_top - (MAG_ZS - 21) * i / 9.0
        pts.append((y0, z, 0.0))
    for i in range(1, 17):
        a = MAG_ANG * i / 16.0
        pts.append((y0 + MAG_R * (1 - math.cos(a)), -MAG_ZS - MAG_R * math.sin(a), a))
    return pts


def build_mag():
    path = mag_path()
    secs = []
    n = 36
    for k, (yc, zc, a) in enumerate(path):
        tdir = Vector((0, math.sin(a), -math.cos(a)))   # nach unten/vorne
        fb = Vector((0, math.cos(a), math.sin(a)))      # vorne-hinten-Richtung senkrecht
        D = 62.5 + 3.0 * a / MAG_ANG
        W = 22.6
        if k == 0:
            W, D = 20.0, 60.0
        pts = []
        for i in range(n):
            t = 2 * math.pi * i / n
            c, s = math.cos(t), math.sin(t)
            e = 4.0
            u = math.copysign(abs(c) ** (2 / e), c)
            v = math.copysign(abs(s) ** (2 / e), s)
            # vorne gerundeter (Front), hinten Rippe
            p = Vector((0, yc, zc)) + fb * (u * D / 2) + Vector((W / 2 * v, 0, 0))
            pts.append(tuple(p))
        secs.append(pts)
    body = loft("MagBody", secs, True, True)
    # Bodenplatte
    yc, zc, a = path[-1]
    fb = Vector((0, math.cos(a), math.sin(a)))
    tdir = Vector((0, math.sin(a), -math.cos(a)))
    bp_secs = []
    for off, grow, dd in [(-3.0, 1.0, 0), (0.0, 1.6, 1.5), (5.5, 1.6, 2.5), (7.0, 0.8, 2.5)]:
        pts = []
        for i in range(n):
            t = 2 * math.pi * i / n
            c, s = math.cos(t), math.sin(t)
            u = math.copysign(abs(c) ** 0.5, c)
            v = math.copysign(abs(s) ** 0.5, s)
            D = 65.5 + 2 * grow + (dd if u > 0 else 0)
            W = 22.6 + 2 * grow
            p = Vector((0, yc, zc)) + tdir * off + fb * (u * D / 2 + (dd / 2 if u > 0 else 0)) + Vector((W / 2 * v, 0, 0))
            pts.append(tuple(p))
        bp_secs.append(pts)
    bp = loft("MagFloor", bp_secs, True, True)
    # Griffrippen quer über die Seiten (untere Hälfte) + Längsrippe vorn
    ribs = []
    for j, (yc2, zc2, a2) in enumerate(path[11:24]):
        if j % 1:
            continue
        fb2 = Vector((0, math.cos(a2), math.sin(a2)))
        Dd = 62.5 + 3.0 * a2 / MAG_ANG
        r = box("MagRib%d" % j, (0, 0, 0), (24.0, Dd - 16.0, 2.6))
        finish(r, 0.5, 2)
        apply_mods(r)
        xf_obj(r, Matrix.Translation(Vector((0, yc2, zc2)) * MM) @ Matrix.Rotation(a2, 4, 'X') @ move(0, -2.0, 0))
        ribs.append(r)
    # Halteloch für Magazinhalter rechts
    mag = join([body, bp] + ribs, "MagBody")
    cut = box2("c_mcat", (9.0, MAGWELL_Y - 33, -38), (13, MAGWELL_Y - 22, -32))
    boolean(mag, [cut])
    finish(mag, 0.5, 2, angle=35)
    reg(mag, "poly_mag", "C")
    # Zubringer/Lippen: oberste Patrone
    rnd = build_round("MagRound", center=(-2.8, MAGWELL_Y - 29.0, -16.8), axis_dir=1)
    for o in rnd:
        reg(o, o["wmat"], "C")
    return mag


def build_round(name, center=(0, 0, 0), axis_dir=1, with_bullet=True, fired=False):
    """5,56x45-Patrone/Hülse entlang +Y. center = Hülsenboden-Mitte."""
    cx, cy, cz = center
    # Profil (r, t) ab Boden
    case = [(0, 0.0), (2.0, 0.0), (4.5, 0.0), (4.79, 0.3), (4.79, 1.0), (4.0, 1.4), (4.0, 2.4), (4.75, 3.0), (4.75, 3.6),
            (4.70, 36.0), (4.55, 39.4), (3.1, 39.7), (3.1, 43.0), (3.1, 44.5), (2.85, 44.5), (2.85, 39.0), (0, 39.0)]
    if not with_bullet:
        case = case[:-1] + [(2.2, 38.0), (0, 38.0)]
    objs = []
    c = lathe(name + "_Case", case, seg=32, axis='Y', center=(cx, cz))
    xf_obj(c, move(0, cy, 0))
    # Zündhütchen
    pr = lathe(name + "_Primer", [(0, -0.05), (2.15, -0.05), (2.15, 0.6), (0, 0.6)], seg=24, axis='Y', center=(cx, cz))
    xf_obj(pr, move(0, cy, 0))
    if fired:
        boolean(pr, [lathe("c_dent", [(0, -0.5), (0.6, -0.5), (0.0, 0.5)], seg=12, axis='Y', center=(cx, cz), xform=move(0, cy, 0))])
    finish(c, 0.12, 1)
    finish(pr, 0.08, 1)
    c["wmat"] = "brass"
    pr["wmat"] = "brass"
    objs += [c, pr]
    if with_bullet:
        b = lathe(name + "_Bullet", [(0, 39.5), (2.84, 39.5), (2.84, 46.0), (2.5, 50.0), (1.7, 54.0), (0.6, 56.6), (0, 57.0)], seg=32,
                  axis='Y', center=(cx, cz))
        xf_obj(b, move(0, cy, 0))
        smooth_only(b)
        b["wmat"] = "copper"
        objs.append(b)
    return objs


# =========================================================== Riemen
def build_sling():
    # QD-Riemenbügel an der Endplatte links
    cx, cy, cz = -24.6, -12.3, -9.5
    body = lathe("QD_Body", [(0, -3.0), (4.8, -3.0), (5.2, -2.4), (5.2, 3.6), (4.6, 4.2), (0, 4.2)], seg=24, axis='X', center=(cy, cz))
    xf_obj(body, move(cx + 3.0, 0, 0))
    btn = cyl("QD_Btn", 2.4, cx - 2.6, cx - 1.0, axis='X', center=(cy, cz), seg=16)
    # Bügel (Schlaufe) nach unten-hinten geneigt
    loop_pts = []
    for i in range(24):
        a = 2 * math.pi * i / 24
        loop_pts.append((0.0 + 15.5 * math.cos(a), 8.0 * math.sin(a)))
    path = []
    for i in range(25):
        a = 2 * math.pi * i / 24
        path.append((cx - 3.5, cy - 2.0 + 9.5 * math.sin(a) * 0.55, cz - 13.0 + 13.0 * math.cos(a)))
    loop = sweep("QD_Loop", path, circle_pts(0, 0, 1.6, 8), up=(1, 0, 0))
    q = join([body, btn, loop], "QD_Swivel")
    finish(q, 0.2, 1)
    reg(q, "steel", "A")
    # Gurtband (25 x 2 mm): Schlaufe um den Bügel, dann flach an der linken Schaftseite nach hinten
    loop_c = (cx - 3.5, cy - 2.0, cz - 13.0)
    strap_path = [(cx - 3.5, cy + 3.0, cz - 26.0), (cx - 3.4, cy - 6.0, cz - 27.0), (cx - 4.0, cy - 16.0, cz - 25.0),
                  (cx - 5.5, cy - 30.0, cz - 21.0), (-27.5, -110.0, -24.0), (-28.5, -150.0, -27.0), (-29.0, -190.0, -31.0),
                  (-29.5, -228.0, -35.0), (-29.0, -250.0, -40.0), (-27.5, -262.0, -52.0), (-26.0, -268.0, -72.0)]
    prof = [(-1.1, -12.5), (1.1, -12.5), (1.1, 12.5), (-1.1, 12.5)]
    st = sweep("SlingStrap", strap_path, prof, up=(1, 0, 0))
    # zweite Lage (umgeschlagen, vernäht) bis zur Schnalle
    fold_path = [(cx - 5.7, cy - 6.0, cz - 27.0), (cx - 6.2, cy - 16.0, cz - 25.0), (cx - 7.7, cy - 30.0, cz - 21.0),
                 (-29.7, -95.0, -23.4)]
    fo = sweep("SlingFold", fold_path, prof, up=(1, 0, 0))
    # Schiebeschnalle (Polymer)
    bk = box2("SlingBuckle", (-34.5, -101.0, -40.0), (-28.0, -93.0, -7.0))
    boolean(bk, [box2("c_bk", (-40, -99.0, -37.5), (-20, -95.0, -9.5))])
    s = join([st, fo], "SlingStrap")
    finish(s, 0.4, 2, angle=60)
    reg(s, "fabric", "B")
    finish(bk, 0.6, 2)
    reg(bk, "poly", "B")


# =========================================================== Vorderer QD-Napf
def build_front_qd():
    cup = lathe("FrontQD", [(3.1, -20.0), (6.4, -20.0), (6.4, -24.0), (5.6, -24.8), (3.1, -24.8)], seg=24, axis='X', center=(470.0, -0.5), closed=True)
    xf_obj(cup, Matrix.Translation(Vector((0, 0, 0))))
    finish(cup, 0.25, 1)
    reg(cup, "steel", "A")


def build_all():
    build_upper()
    build_dustcover()
    build_bolt()
    build_charging_handle()
    build_lower()
    build_trigger()
    build_selector()
    build_boltcatch()
    build_grip()
    build_buffer_stock()
    build_handguard()
    build_barrel()
    build_iron_sights()
    build_holo()
    build_light()
    build_pressure_switch()
    build_afg()
    build_mag()
    build_sling()
    build_front_qd()
    return PARTS
