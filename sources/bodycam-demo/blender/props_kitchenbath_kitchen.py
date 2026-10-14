# PROPS-KÜCHE-BAD — Küche: Unter-/Oberschränke, Spüle, Herd, Kühlschrank, Mikrowelle, Haube, Geschirr.
# Wird von props_kitchenbath.py per exec geladen (gemeinsamer Namensraum).

# US-Maße: Unterschrank 34,5" Korpus + 1,5" Arbeitsplatte = 36" (0,914 m), Tiefe 24" + Überstand.
CAB_H = 0.876
CNT_T = 0.038
FF_Y = -0.304      # Vorderkante Rahmen (Face Frame)
FF_T = 0.019
DOOR_T = 0.019
BACK_Y = 0.31
CNT_Y0 = -0.335


def wire_pull(name, length=0.096, standoff=0.026, r=0.0045, vertical=True, mat='brass_old'):
    """Bügelgriff, Mitte im Ursprung, ragt nach −Y."""
    h = length / 2
    pts = [(0, 0.002, -h), (0, -standoff, -h), (0, -standoff, h), (0, 0.002, h)]
    ob = pipe(name, pts, r, mat, sides=8, bend=0.009, n=4)
    for z in (-h, h):   # Rosetten
        b = cyl(name + 'r', r * 1.9, 0.004, mat, seg=10, loc=(0, -0.001, z), rot=(90, 0, 0))
        ob = join([ob, b])
    if not vertical:
        place(ob, rot=(0, 90, 0))
    return ob


def knob(name, r=0.016, h=0.024, mat='brass_old'):
    prof = [(0.0001, 0), (r * 0.55, 0), (r * 0.5, h * 0.35), (r * 0.9, h * 0.7), (r, h * 0.85), (r * 0.85, h), (0.0001, h)]
    ob = lathe(name, prof, mat, seg=14, close_top=False)
    place(ob, rot=(90, 0, 0))   # zeigt nach −Y
    return ob


def hinge_plate(name, x, z, y=FF_Y, side=1, bent=False):
    """Halbverdecktes Scharnier, sichtbarer Lappen auf dem Rahmen."""
    ob = rbox(name, 0.016, 0.0025, 0.05, 'brass_old', loc=(x + side * 0.004, y - 0.0012, z), r=0.0008, seg=1)
    if bent:
        rot_about(ob, (x, y, z), 'Y', 18 * side)
        rot_about(ob, (x, y, z), 'Z', -25 * side)
    return ob


def cab_door(name, x0, x1, z0, z1, hinge, state=None, y_back=FF_Y, pull_z=None, mat='cabinet_wood', panel=True,
             knob_pull=False):
    """Tür zwischen x0..x1/z0..z1 (Overlay), Rückseite auf y_back. state: dict(open=deg, tilt=deg, drop=m)."""
    w, h = x1 - x0, z1 - z0
    xc, zc = (x0 + x1) / 2, (z0 + z1) / 2
    d = frame_panel(name, w, h, DOOR_T, mat, border=min(0.06, w * 0.16), loc=(xc, y_back - DOOR_T / 2, zc),
                    panel=panel)
    s = 1 if hinge == 'L' else -1
    free_x = x1 - 0.035 if hinge == 'L' else x0 + 0.035
    pz = pull_z if pull_z is not None else z1 - 0.09
    if knob_pull:
        p = knob(name + 'k', mat='brass_old')
        place(p, loc=(free_x, y_back - DOOR_T, pz))
    else:
        p = wire_pull(name + 'p')
        place(p, loc=(free_x, y_back - DOOR_T, pz))
    ob = join([d, p])
    st = state or {}
    hx = x0 if hinge == 'L' else x1
    if st.get('tilt'):
        rot_about(ob, (hx + s * 0.02, y_back, z1 - 0.07), 'Y', st['tilt'] * s)
    if st.get('drop'):
        xform(ob, Matrix.Translation((0, 0, -st['drop'])))
    if st.get('open'):
        rot_about(ob, (hx, y_back, 0), 'Z', -st['open'] * s)
    return ob


def drawer(name, x0, x1, z0, z1, pull=0.0, yaw=0.0, roll=0.0, depth=0.45, box=True, mat='cabinet_wood',
           contents=None):
    w, h = x1 - x0, z1 - z0
    xc, zc = (x0 + x1) / 2, (z0 + z1) / 2
    parts = [frame_panel(name, w, h, DOOR_T, mat, border=0.03, loc=(xc, FF_Y - DOOR_T / 2, zc), panel=h > 0.12)]
    p = wire_pull(name + 'p', vertical=False)
    place(p, loc=(xc, FF_Y - DOOR_T, zc + 0.005))
    parts.append(p)
    if box:
        bw = w - 0.075
        bh = h - 0.05
        bz = z0 + 0.012
        y0 = FF_Y
        parts += [
            rbox(name + 'sl', 0.012, depth, bh, 'cabinet_interior', loc=(xc - bw / 2 + 0.006, y0 + depth / 2, bz + bh / 2), r=0.001),
            rbox(name + 'sr', 0.012, depth, bh, 'cabinet_interior', loc=(xc + bw / 2 - 0.006, y0 + depth / 2, bz + bh / 2), r=0.001),
            rbox(name + 'sb', bw, 0.012, bh, 'cabinet_interior', loc=(xc, y0 + depth - 0.006, bz + bh / 2), r=0.001),
            rbox(name + 'sf', bw, 0.012, bh, 'cabinet_interior', loc=(xc, y0 + 0.006, bz + bh / 2), r=0.001),
            rbox(name + 'bt', bw, depth, 0.005, 'particleboard', loc=(xc, y0 + depth / 2, bz + 0.004), r=0.0),
        ]
        if contents:
            parts += contents(xc, y0, bz + 0.007, bw, depth)
    ob = join(parts)
    if roll:
        rot_about(ob, (xc, FF_Y, zc), 'Y', roll)
    if yaw:
        rot_about(ob, (xc, FF_Y, zc), 'Z', yaw)
    if pull:
        xform(ob, Matrix.Translation((0, -pull, 0)))
    return ob


def junk_utensils(xc, y0, z, bw, depth):
    """Ein paar Besteckteile/Kram in der Schublade."""
    rnd = random.Random(7)
    out = []
    for i in range(7):
        L = rnd.uniform(0.15, 0.21)
        ob = rbox('ut%d' % i, 0.012, L, 0.003, 'stainless', r=0.001, seg=1)
        bpy_ = None
        place(ob, loc=(xc + rnd.uniform(-bw / 2 + 0.03, bw / 2 - 0.03), y0 + rnd.uniform(0.12, depth - 0.12),
                       z + 0.002 + i * 0.0035), rot=(rnd.uniform(-3, 3), 0, rnd.uniform(-40, 40)))
        out.append(ob)
    return out


def counter(W, z0=CAB_H, cut=None, peel=None, chip=None, lift=0.0, splash=True):
    """Arbeitsplatte (Spanplatte + Laminat, Umleimer vorn, Rückwandaufkantung).
    cut=(x0,x1,y0,y1) Ausschnitt; peel=(x0,x1) abgelöster Umleimer; chip=(x,) Abplatzer an Vorderkante."""
    parts = []
    y0, y1 = CNT_Y0, BACK_Y
    t = CNT_T
    core = rbox('core', W - 0.002, y1 - y0 - 0.003, t - 0.0016, 'particleboard',
                loc=(0, (y0 + 0.0015 + y1) / 2, z0 + (t - 0.0016) / 2), r=0.001, seg=1)
    parts.append(core)
    zt = z0 + t - 0.0016
    lam_t = 0.0016

    def lam(x0, x1, ya, yb):
        return rbox('lam', x1 - x0, yb - ya, lam_t, 'laminate_counter', loc=((x0 + x1) / 2, (ya + yb) / 2, zt + lam_t / 2),
                    r=0.0007, seg=1, step=0.05)
    if cut:
        cx0, cx1, cy0, cy1 = cut
        parts += [lam(-W / 2, W / 2, y0, cy0), lam(-W / 2, W / 2, cy1, y1), lam(-W / 2, cx0, cy0, cy1), lam(cx1, W / 2, cy0, cy1)]
    else:
        parts.append(lam(-W / 2, W / 2, y0, y1))
    # Umleimer vorn (Stücke; abgelöstes Stück rollt sich ab)
    band_y = y0 - 0.0008
    segs = [(-W / 2, W / 2)]
    if peel:
        px0, px1 = peel
        segs = [(-W / 2, px0), (px1, W / 2)]
        # abgerolltes Stück: Streifen, der sich ab px0 nach vorn/unten wegbiegt
        n = 14
        bm = bmesh.new()
        L = px1 - px0
        rows = []
        for i in range(n + 1):
            u = i / n
            ang = (u ** 1.6) * radians(70)
            rr = 0.09
            # Biegung um Z (nach vorn weg) + leichtes Hängen
            x = px0 + rr * sin(ang) + (u * L - rr * ang) * cos(ang) if u * L > rr * ang else px0 + u * L
            y = band_y - (1 - cos(ang)) * 0.06 - u * u * 0.03
            dz = -u * u * 0.025
            rows.append([bm.verts.new((x, y, z0 + dz + 0.0005)), bm.verts.new((x, y, z0 + t + dz - 0.0005))])
        for i in range(n):
            bm.faces.new((rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]))
        strip = mesh_obj('peel', bm, 'laminate_counter')
        mod_solidify(strip, 0.0012, off=0)
        parts.append(strip)
    for (a, b) in segs:
        if b - a > 0.002:
            parts.append(rbox('band', b - a, 0.0016, t, 'laminate_counter', loc=((a + b) / 2, band_y, z0 + t / 2),
                              r=0.0006, seg=1, step=0.06))
    # Seitenkanten
    for sx in (-1, 1):
        parts.append(rbox('end', 0.0016, y1 - y0, t, 'laminate_counter', loc=(sx * (W / 2 + 0.0008), (y0 + y1) / 2, z0 + t / 2),
                          r=0.0006, seg=1))
    if splash:
        parts.append(rbox('splash', W, 0.012, 0.10, 'laminate_counter', loc=(0, y1 - 0.006, z0 + t + 0.05), r=0.002, seg=2))
    ob = join(parts)
    if chip:
        dent(ob, (chip[0], y0, z0 + t), 0.025, 0.006, direction=(0, 0.6, -0.8))
    if lift:
        rot_about(ob, (-W / 2, 0, z0), 'Y', -lift)
    return ob


def base_carcass(W, parts, drawer_slot=True, center_stile=False, wet=False, shelf=True, shelf_tilt=0.0):
    hw = W / 2
    # Seiten (mit Sockelaussparung)
    for sx in (-1, 1):
        x = sx * (hw - 0.008)
        parts.append(rbox('side', 0.016, BACK_Y + 0.285, CAB_H - 0.10, 'cabinet_wood', loc=(x, (BACK_Y - 0.285) / 2, 0.10 + (CAB_H - 0.10) / 2), r=0.0015))
        parts.append(rbox('sidek', 0.016, BACK_Y + 0.21, 0.10, 'cabinet_wood', loc=(x, (BACK_Y - 0.21) / 2, 0.05), r=0.0015))
    ib = 'particleboard_wet' if wet else 'cabinet_interior'
    bot = rbox('bottom', W - 0.032, BACK_Y + 0.285 - 0.005, 0.016, ib, loc=(0, (BACK_Y - 0.005 - 0.285) / 2, 0.108), r=0.001, step=0.03)
    if wet:   # aufgequollene Spanplatte
        jitter(bot, 0.004, 22, seed=3, normal_only=True)
        deform(bot, lambda v: v + Vector((0, 0, 0.006 * max(0, 1 - ((v.x / (W / 2)) ** 2 + ((v.y - 0.05) / 0.3) ** 2)))))
    parts.append(bot)
    parts.append(rbox('back', W - 0.032, 0.005, CAB_H - 0.10, 'cabinet_interior', loc=(0, BACK_Y - 0.0025, 0.10 + (CAB_H - 0.10) / 2), r=0.0))
    if shelf:
        sh = rbox('shelf', W - 0.034, 0.30, 0.016, 'cabinet_interior', loc=(0, 0.13, 0.42), r=0.0015)
        if shelf_tilt:
            rot_about(sh, (W / 2 - 0.02, 0.13, 0.42), 'Y', shelf_tilt)
        parts.append(sh)
        # Fachbodenträger
        for sx in (-1, 1):
            for yy in (0.0, 0.26):
                parts.append(cyl('pin', 0.0025, 0.012, 'brass_old', seg=6, loc=(sx * (hw - 0.022), yy, 0.410), rot=(0, 90, 0)))
    # Rahmen
    yfc = FF_Y + FF_T / 2
    fz0 = 0.10
    for sx in (-1, 1):
        parts.append(rbox('stile', 0.038, FF_T, CAB_H - fz0, 'cabinet_wood', loc=(sx * (hw - 0.019), yfc, fz0 + (CAB_H - fz0) / 2), r=0.0018))
    parts.append(rbox('rtop', W - 0.076, FF_T, 0.038, 'cabinet_wood', loc=(0, yfc, CAB_H - 0.019), r=0.0018))
    parts.append(rbox('rbot', W - 0.076, FF_T, 0.025, 'cabinet_wood', loc=(0, yfc, fz0 + 0.0125), r=0.0018))
    if drawer_slot:
        parts.append(rbox('rmid', W - 0.076, FF_T, 0.025, 'cabinet_wood', loc=(0, yfc, 0.6875), r=0.0018))
        # Schubladenschienen
        for sx in (-1, 1):
            parts.append(rbox('rail', 0.012, 0.50, 0.012, 'galvanized', loc=(sx * (hw - 0.04), 0.0, 0.715), r=0.001, seg=1))
    if center_stile:
        parts.append(rbox('cstile', 0.038, FF_T, 0.55, 'cabinet_wood', loc=(0, yfc, 0.125 + 0.275), r=0.0018))
    # Sockelblende
    parts.append(rbox('kick', W - 0.002, 0.012, 0.096, 'cabinet_wood', loc=(0, -0.21 - 0.006, 0.048), r=0.0015))
    return parts


def cab_tint_wall(co, nrm, mn, dark_bottom=0.0):
    return np.ones((len(co), 3), np.float32)


@prop('kitchen_base_cab_60', 'wood', 'kitchen',
      'Unterschrank 60 cm mit Arbeitsplatte (Laminat). Schublade halb herausgezogen und verkantet, Tür hängt am oberen '
      'Scharnier schief offen. Rückseite bündig an Wand (+Y), Ursprung = Mitte Korpusgrundfläche.')
def kitchen_base_cab_60():
    W = 0.60
    parts = base_carcass(W, [])
    parts.append(drawer('drw', -W / 2 + 0.026, W / 2 - 0.026, 0.69, 0.85, pull=0.17, yaw=4, roll=-2.5,
                        contents=junk_utensils))
    parts.append(cab_door('door', -W / 2 + 0.026, W / 2 - 0.026, 0.113, 0.687, 'L',
                          state=dict(open=28, tilt=6, drop=0.008)))
    parts.append(hinge_plate('h1', -W / 2 + 0.03, 0.62))
    parts.append(hinge_plate('h2', -W / 2 + 0.03, 0.18, bent=True))
    parts.append(counter(W, chip=(0.21,)))
    ob = join(parts, 'kitchen_base_cab_60')

    def tint(co, nrm, mn):
        t = np.ones((len(co), 3), np.float32)
        top = (mn == 'M_laminate_counter') & (nrm[:, 2] > 0.5)
        # Brandring auf der Platte, Messerkerben/Fett zur Wand hin
        d = np.hypot(co[:, 0] + 0.12, co[:, 1] - 0.02)
        ring = np.exp(-((d - 0.085) / 0.012) ** 2) * 0.55 + np.exp(-(d / 0.07) ** 2) * 0.25
        g = np.exp(-((BACK_Y - co[:, 1]) / 0.08)) * 0.35
        k = np.clip(ring + g, 0, 0.8) * top
        t *= (1 - k[:, None] * np.array([0.55, 0.65, 0.8], np.float32))
        return t
    return finalize(ob, 'kitchen_base_cab_60', 'wood', center=(-W / 2, W / 2, -0.304, BACK_Y), tint_fn=tint, seed=1)


@prop('kitchen_base_cab_45', 'wood', 'kitchen',
      'Unterschrank 45 cm, Tür fehlt (Scharniere hängen noch, eins verbogen), Schublade fehlt, Fachboden abgesackt, '
      'Wasserschaden am Boden. Arbeitsplatte leicht angehoben (Stoß). Ursprung = Mitte Korpusgrundfläche.')
def kitchen_base_cab_45():
    W = 0.45
    parts = base_carcass(W, [], wet=True, shelf_tilt=-9)
    parts.append(hinge_plate('h1', W / 2 - 0.03, 0.62, side=-1, bent=True))
    parts.append(hinge_plate('h2', W / 2 - 0.03, 0.18, side=-1))
    # Schublade fehlt: nur Laufschiene; dafür ein herausgerissenes Stück Rahmen
    parts.append(counter(W, lift=0.6, chip=(-0.1,)))
    ob = join(parts, 'kitchen_base_cab_45')

    def tint(co, nrm, mn):
        t = np.ones((len(co), 3), np.float32)
        # Wasserränder unten im Schrank
        wet = np.exp(-np.maximum(co[:, 2] - 0.10, 0) / 0.07) * (np.abs(co[:, 0]) < W / 2 - 0.01) * (co[:, 1] > -0.29)
        t *= (1 - 0.45 * wet[:, None] * np.array([0.7, 0.8, 0.95], np.float32))
        return t
    return finalize(ob, 'kitchen_base_cab_45', 'wood', center=(-W / 2, W / 2, -0.304, BACK_Y), tint_fn=tint, seed=2)


# ---------- Spüle (Edelstahl-Doppelbecken), Armatur, Abfluss
SINK_C = (0.0, -0.025)


def sink_bowl_loops(cx, cy, hx, hy, depth, z_top, N=6):
    loops = []
    prof = [(0.0, 0.0, 0.0), (0.004, -0.004, 0.0), (0.006, -0.012, 0.0), (0.012, -0.08, 0.01),
            (0.022, -depth + 0.025, 0.03), (0.034, -depth + 0.006, 0.045), (0.048, -depth, 0.05)]
    r0 = 0.045
    for inset, dz, dr in prof:
        loops.append(rrect(cx, cy, hx - inset, hy - inset, r0 + dr, z_top + dz, nc=N, ns=3))
    return loops


def kitchen_sink(z_top):
    """Doppelbecken 84 x 53 cm, Ober-/Unterseite, Abläufe. Gibt (parts, drain_points)."""
    parts = []
    cx, cy = SINK_C
    HX, HY = 0.42, 0.265
    bowls = [(-0.205, -0.015, 0.175, 0.19), (0.205, -0.015, 0.175, 0.19)]
    # Deck mit zwei Löchern (Scanfill)
    bm = bmesh.new()
    outer = rrect(cx, cy, HX - 0.008, HY - 0.008, 0.03, z_top + 0.006, nc=4, ns=6)
    ov = [bm.verts.new(p) for p in outer]
    edges = [bm.edges.new((ov[i], ov[(i + 1) % len(ov)])) for i in range(len(ov))]
    inner_loops = []
    for (bx, by, hx, hy) in bowls:
        L = rrect(cx + bx, cy + by, hx, hy, 0.045, z_top + 0.006, nc=6, ns=3)
        iv = [bm.verts.new(p) for p in L]
        inner_loops.append(iv)
        edges += [bm.edges.new((iv[i], iv[(i + 1) % len(iv)])) for i in range(len(iv))]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    # Löcher entfernen (Flächen, deren Mittelpunkt im Becken liegt)
    for f in list(bm.faces):
        c = f.calc_center_median()
        for (bx, by, hx, hy) in bowls:
            if abs(c.x - cx - bx) < hx - 0.002 and abs(c.y - cy - by) < hy - 0.002:
                bm.faces.remove(f)
                break
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    deck = mesh_obj('deck', bm, 'MU_kitchen_sink')
    parts.append(deck)
    # Außenrand (Wulst nach unten auf die Platte)
    rim = loft('rim', [rrect(cx, cy, HX - 0.008, HY - 0.008, 0.03, z_top + 0.006, nc=4, ns=6),
                       rrect(cx, cy, HX - 0.002, HY - 0.002, 0.034, z_top + 0.004, nc=4, ns=6),
                       rrect(cx, cy, HX, HY, 0.036, z_top + 0.0005, nc=4, ns=6)], 'MU_kitchen_sink')
    parts.append(rim)
    drains = []
    for (bx, by, hx, hy) in bowls:
        loops = sink_bowl_loops(cx + bx, cy + by, hx, hy, 0.18, z_top + 0.006)
        b = loft('bowl', loops, 'MU_kitchen_sink', cap_last=False)
        parts.append(b)
        # Boden: Ring nach innen bis Ablauf
        zb = z_top + 0.006 - 0.18
        dx, dy = cx + bx, cy + by + 0.02
        last = loops[-1]
        Nl = len(last)
        ring1 = []
        ring2 = []
        for p in last:
            v = Vector(p) - Vector((dx, dy, zb))
            v.z = 0
            d = v.normalized()
            ring1.append(tuple(Vector((dx, dy, zb - 0.004)) + d * (v.length * 0.5)))
            ring2.append(tuple(Vector((dx, dy, zb - 0.008)) + d * 0.046))
        parts.append(loft('bowlb', [last, ring1, ring2], 'MU_kitchen_sink'))
        # Siebkorb
        sb = lathe('strainer', [(0.046, 0.0), (0.05, 0.002), (0.044, 0.003), (0.034, -0.004), (0.03, -0.03), (0.0001, -0.03)],
                   'stainless_dark', seg=20, loc=(dx, dy, zb - 0.008))
        parts.append(sb)
        drains.append((dx, dy, zb - 0.04))
    return parts, drains


def faucet_single(x, y, z, swing=25):
    """Einhebel-Spültischarmatur (80er), schwenkbarer Auslauf."""
    parts = []
    base = rbox('fbase', 0.07, 0.07, 0.03, 'chrome_dull', loc=(x, y, z + 0.015), r=0.012, seg=3)
    parts.append(base)
    body = lathe('fbody', [(0.026, 0), (0.026, 0.05), (0.022, 0.07), (0.0001, 0.075)], 'chrome_dull', seg=18, loc=(x, y, z + 0.028))
    parts.append(body)
    # Hebel
    lev = rbox('flever', 0.018, 0.09, 0.012, 'chrome_dull', loc=(x, y + 0.035, z + 0.11), rot=(-20, 0, 0), r=0.005, seg=2)
    parts.append(lev)
    # Auslauf
    pts = [(x, y, z + 0.06), (x, y - 0.03, z + 0.062), (x, y - 0.21, z + 0.065), (x, y - 0.235, z + 0.05)]
    sp = pipe('spout', pts, 0.011, 'chrome_dull', sides=12, bend=0.025, n=5)
    rot_about(sp, (x, y, 0), 'Z', swing)
    tip = cyl('aer', 0.013, 0.018, 'chrome_dull', seg=12, loc=(0, 0, 0))
    v = Vector((0, -0.235, 0))
    v.rotate(Euler((0, 0, radians(swing))))
    place(tip, loc=(x + v.x, y + v.y, z + 0.045))
    parts += [sp, tip]
    # Kalk am Auslaufende
    return join(parts)


def plumbing_under_sink(drains, y_wall=BACK_Y - 0.005):
    parts = []
    (lx, ly, lz), (rx, ry, rz) = drains
    R = 0.019
    parts.append(pipe('tailL', [(lx, ly, lz + 0.03), (lx, ly, 0.66), (rx - 0.03, ry, 0.66)], R, 'pvc_white', sides=12, bend=0.05))
    parts.append(pipe('tailR', [(rx, ry, rz + 0.03), (rx, ry, 0.50), (rx, ry - 0.0, 0.45), (rx, ry + 0.09, 0.45), (rx, ry + 0.09, 0.52),
                                (rx, ry + 0.10, 0.53), (rx, y_wall, 0.53)], R, 'pvc_white', sides=12, bend=0.05))
    # Überwurfmuttern
    for (x, y, z) in ((lx, ly, 0.80), (rx, ry, 0.80), (rx, ry, 0.56), (rx, ry + 0.09, 0.51)):
        parts.append(cyl('nut', R * 1.35, 0.025, 'pvc_white', seg=12, loc=(x, y, z)))
    parts.append(cyl('tee', R * 1.3, 0.07, 'pvc_white', seg=12, loc=(rx, ry, 0.66)))
    # Wandrosette
    parts.append(cyl('esc', 0.04, 0.006, 'chrome_dull', seg=16, loc=(rx, y_wall - 0.003, 0.53), rot=(90, 0, 0)))
    # Eckventile + Zuleitungen
    for sx in (-1, 1):
        vx = sx * 0.12
        parts.append(cyl('esc2', 0.025, 0.006, 'chrome_dull', seg=14, loc=(vx, y_wall - 0.003, 0.30), rot=(90, 0, 0)))
        parts.append(cyl('vstem', 0.008, 0.06, 'chrome_dull', seg=10, loc=(vx, y_wall - 0.03, 0.30), rot=(90, 0, 0)))
        parts.append(rbox('vbody', 0.026, 0.028, 0.03, 'chrome_dull', loc=(vx, y_wall - 0.06, 0.30), r=0.008, seg=2))
        parts.append(rbox('vhandle', 0.035, 0.008, 0.016, 'chrome_dull', loc=(vx, y_wall - 0.08, 0.30), r=0.004, seg=2))
        pts = catmull([(vx, y_wall - 0.06, 0.315), (vx, y_wall - 0.06, 0.42), (vx * 0.6, 0.18, 0.62), (sx * 0.03, 0.19, 0.80),
                       (sx * 0.03, 0.19, CAB_H)], 5)
        parts.append(tube_path('riser', pts, 0.005, 'chrome_dull', sides=6))
    return parts


@prop('kitchen_sink_cab_90', 'wood', 'kitchen',
      'Spülenunterschrank 90 cm mit Edelstahl-Doppelbecken (MU_kitchen_sink gebacken), Einhebelarmatur, Siphon, '
      'Eckventilen. Linke Tür fehlt, rechte steht offen, Boden aufgequollen, Umleimer der Platte löst sich. '
      'Ursprung = Mitte Korpusgrundfläche.')
def kitchen_sink_cab_90():
    W = 0.90
    parts = base_carcass(W, [], drawer_slot=True, center_stile=True, wet=True, shelf=False)
    # Blende statt Schublade (fest, eine Seite gelöst)
    fp = frame_panel('false', W - 0.052, 0.15, DOOR_T, 'cabinet_wood', border=0.03, loc=(0, FF_Y - DOOR_T / 2, 0.77), panel=True)
    rot_about(fp, (W / 2 - 0.03, FF_Y, 0.77), 'Y', -3.5)
    parts.append(fp)
    parts.append(cab_door('doorR', 0.0, W / 2 - 0.026, 0.113, 0.687, 'R', state=dict(open=72)))
    for z in (0.62, 0.18):
        parts.append(hinge_plate('hl', -W / 2 + 0.03, z, bent=(z > 0.5)))
        parts.append(hinge_plate('hr', W / 2 - 0.03, z, side=-1))
    sink_parts, drains = kitchen_sink(CAB_H + CNT_T)
    parts += sink_parts
    parts.append(counter(W, cut=(SINK_C[0] - 0.40, SINK_C[0] + 0.40, SINK_C[1] - 0.245, SINK_C[1] + 0.245),
                         peel=(-0.36, -0.10)))
    parts.append(faucet_single(0.0, 0.195, CAB_H + CNT_T + 0.006))
    parts += plumbing_under_sink(drains)
    ob = join(parts, 'kitchen_sink_cab_90')

    def tint(co, nrm, mn):
        t = np.ones((len(co), 3), np.float32)
        wet = np.exp(-np.maximum(co[:, 2] - 0.10, 0) / 0.09) * (np.abs(co[:, 0]) < W / 2 - 0.01) * (co[:, 1] > -0.29)
        t *= (1 - 0.5 * wet[:, None] * np.array([0.6, 0.75, 0.95], np.float32))
        # Kalk/Schmutz an der Armatur
        fa = (mn == 'M_chrome_dull') & (co[:, 2] > CAB_H)
        n = nfbm(co, 60.0, 2, 4)
        t[fa] *= (0.75 + 0.5 * n[fa])[:, None]
        return t

    return finalize(ob, 'kitchen_sink_cab_90', 'wood', center=(-W / 2, W / 2, -0.304, BACK_Y), tint_fn=tint, seed=3)


def sink_recipe(P, N, A):
    """Gebürsteter Edelstahl: Wasserflecken, Kalkränder, Rost um den Ablauf, Fettfilm."""
    n = len(P)
    col = np.tile(np.array([0.52, 0.51, 0.49], np.float32), (n, 1))
    rough = np.full(n, 0.32, np.float32)
    metal = np.ones(n, np.float32)
    # Bürststruktur
    br = nfbm(P, 1.0, 2, 11, aniso=(400, 3, 3))
    rough += (br - 0.5) * 0.12
    col *= (0.92 + 0.16 * br)[:, None]
    # Wasserflecken (Kalk): weißliche Ringe, matt
    sp = nfbm(P, 30.0, 3, 12)
    spots = smoothstep(0.6, 0.66, sp) * (1 - smoothstep(0.66, 0.74, sp))
    lime = np.clip(spots * 1.5 + smoothstep(0.55, 0.85, nfbm(P, 8, 3, 13)) * 0.4, 0, 1)
    col = mix(col, np.array([0.62, 0.60, 0.55], np.float32), lime * 0.7)
    metal -= lime * 0.6
    rough += lime * 0.4
    # Schmutzfilm im Becken (unten), Rost um Abläufe
    zmin = P[:, 2].min()
    low = np.exp(-(P[:, 2] - zmin) / 0.05)
    g = smoothstep(0.35, 0.8, nfbm(P, 6, 4, 14)) * 0.6 + low * 0.6
    g = np.clip(g, 0, 1) * (P[:, 2] < P[:, 2].max() - 0.01)
    col = mix(col, np.array([0.12, 0.08, 0.04], np.float32), g * 0.75)
    metal -= g * 0.7
    rough += g * 0.4
    for dx in (-0.205, 0.205):
        d = np.hypot(P[:, 0] - dx, P[:, 1] - (SINK_C[1] + 0.005))
        r = np.exp(-np.maximum(d - 0.05, 0) / 0.03) * (P[:, 2] < zmin + 0.03) * (0.6 + 0.4 * nfbm(P, 40, 2, 15))
        col = mix(col, np.array([0.18, 0.07, 0.02], np.float32), np.clip(r, 0, 1))
        metal -= r
        rough += r * 0.5
    return col, np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)


UNIQUE_BAKE['kitchen_sink'] = dict(res=512, base=((0.5, 0.5, 0.49), 0.35, 1.0), recipe=sink_recipe)


# ---------- Oberschränke (Tiefe 12", Höhe 30")
WC_D = 0.31
WC_FF = -0.155 + DOOR_T   # Vorderkante Rahmen


def wall_carcass(W, H=0.76, mid_stile=False):
    parts = []
    hw = W / 2
    yb, yf = 0.155, WC_FF + FF_T   # Korpus hinter dem Rahmen
    for sx in (-1, 1):
        parts.append(rbox('side', 0.016, yb - yf, H, 'cabinet_wood', loc=(sx * (hw - 0.008), (yb + yf) / 2, H / 2), r=0.0015))
    parts.append(rbox('top', W - 0.032, yb - yf, 0.016, 'cabinet_interior', loc=(0, (yb + yf) / 2, H - 0.008), r=0.001))
    parts.append(rbox('bot', W - 0.032, yb - yf, 0.016, 'cabinet_interior', loc=(0, (yb + yf) / 2, 0.02), r=0.001))
    parts.append(rbox('back', W - 0.032, 0.005, H, 'cabinet_interior', loc=(0, yb - 0.0025, H / 2), r=0.0))
    for z in (0.27, 0.51):
        parts.append(rbox('shelf', W - 0.034, yb - yf - 0.01, 0.016, 'cabinet_interior', loc=(0, (yb + yf) / 2 + 0.005, z), r=0.0015))
    yfc = WC_FF + FF_T / 2
    for sx in (-1, 1):
        parts.append(rbox('stile', 0.038, FF_T, H, 'cabinet_wood', loc=(sx * (hw - 0.019), yfc, H / 2), r=0.0018))
    parts.append(rbox('rtop', W - 0.076, FF_T, 0.04, 'cabinet_wood', loc=(0, yfc, H - 0.02), r=0.0018))
    parts.append(rbox('rbot', W - 0.076, FF_T, 0.03, 'cabinet_wood', loc=(0, yfc, 0.015), r=0.0018))
    if mid_stile:
        parts.append(rbox('cst', 0.038, FF_T, H - 0.07, 'cabinet_wood', loc=(0, yfc, H / 2), r=0.0018))
    return parts


def mug(name, x, y, z, rot=0, mat='ceramic_plate', tipped=False):
    m = lathe(name, [(0.0001, 0), (0.036, 0), (0.04, 0.004), (0.041, 0.095), (0.037, 0.095), (0.036, 0.008), (0.0001, 0.008)],
              mat, seg=16)
    h = pipe(name + 'h', [(0.038, 0, 0.075), (0.065, 0, 0.07), (0.065, 0, 0.03), (0.038, 0, 0.025)], 0.006, mat, sides=6, bend=0.015)
    ob = join([m, h])
    if tipped:
        place(ob, rot=(90, 0, 0))
        xform(ob, Matrix.Translation((0, 0, 0.041)))
    place(ob, loc=(x, y, z), rot=(0, 0, rot))
    return ob


@prop('kitchen_wall_cab_60', 'wood', 'kitchen',
      'Oberschrank 60 x 76 x 31 cm, eine Tür halb offen, zwei Fachböden mit Tassen. Ursprung = Unterkante Mitte '
      '(Montagehöhe Unterkante 1,37 m), Rückseite an Wand (+Y).', mount='Unterkante 1.37 m über Boden')
def kitchen_wall_cab_60():
    W, H = 0.60, 0.76
    parts = wall_carcass(W, H)
    parts.append(cab_door('door', -W / 2 + 0.026, W / 2 - 0.026, 0.028, H - 0.028, 'R', state=dict(open=48), y_back=WC_FF,
                          pull_z=0.10))
    for z in (0.08, H - 0.08):
        parts.append(hinge_plate('h', W / 2 - 0.03, z, y=WC_FF, side=-1))
    parts.append(mug('mug1', -0.12, 0.02, 0.278))
    parts.append(mug('mug2', 0.05, -0.02, 0.278, rot=70, tipped=True))
    parts.append(mug('mug3', -0.15, 0.03, 0.518, rot=200))
    ob = join(parts, 'kitchen_wall_cab_60')
    return finalize(ob, 'kitchen_wall_cab_60', 'wood', center=(-W / 2, W / 2, -0.155, 0.155), seed=4)


@prop('kitchen_wall_cab_76', 'wood', 'kitchen',
      'Oberschrank 76 x 76 x 31 cm, zwei Türen: linke fehlt, rechte hängt nur noch am oberen Scharnier schräg herunter. '
      'Ursprung = Unterkante Mitte (Montagehöhe 1,37 m).', mount='Unterkante 1.37 m über Boden')
def kitchen_wall_cab_76():
    W, H = 0.76, 0.76
    parts = wall_carcass(W, H, mid_stile=True)
    parts.append(cab_door('door', 0.0 + 0.002, W / 2 - 0.026, 0.028, H - 0.028, 'R', state=dict(open=22, tilt=17, drop=0.02),
                          y_back=WC_FF, pull_z=0.10))
    parts.append(hinge_plate('h1', W / 2 - 0.03, H - 0.08, y=WC_FF, side=-1))
    parts.append(hinge_plate('h2', W / 2 - 0.03, 0.08, y=WC_FF, side=-1, bent=True))
    parts.append(hinge_plate('h3', -W / 2 + 0.03, H - 0.08, y=WC_FF, bent=True))
    parts.append(hinge_plate('h4', -W / 2 + 0.03, 0.08, y=WC_FF))
    # Teller/Schüsseln im Fach
    for i in range(4):
        parts.append(lathe('bowl%d' % i, [(0.0001, 0), (0.04, 0), (0.07, 0.03), (0.075, 0.055), (0.07, 0.055), (0.066, 0.033),
                                           (0.037, 0.005), (0.0001, 0.005)], 'ceramic_plate', seg=18,
                           loc=(-0.2, 0.0, 0.278 + i * 0.012)))
    parts.append(mug('mug1', 0.18, 0.0, 0.518, rot=40))
    ob = join(parts, 'kitchen_wall_cab_76')
    return finalize(ob, 'kitchen_wall_cab_76', 'wood', center=(-W / 2, W / 2, -0.155, 0.155), seed=5)


# ==============================================================================================
# Herd (30"-Elektroherd, 80er, Mandelweiß), Kochplatten mit Heizspiralen, Backofen angelehnt
STOVE_W = 0.762
STOVE_BURNERS = [(-0.19, -0.12, 0.125), (0.19, -0.12, 0.095), (-0.19, 0.12, 0.095), (0.19, 0.12, 0.125)]


def coil_element(name, cx, cy, z, rc, turns, r=0.0042):
    pts = []
    n = int(turns * 26)
    r0 = 0.032
    for i in range(n + 1):
        t = i / n
        a = t * turns * 2 * pi
        rr = r0 + (rc - r0) * t
        pts.append((cx + rr * cos(a), cy + rr * sin(a), z))
    a_end = turns * 2 * pi
    # Anschlussbein nach hinten in den Topf
    ex, ey = cx + rc * cos(a_end), cy + rc * sin(a_end)
    pts += [(ex + 0.012 * cos(a_end + 1.2), ey + 0.012 * sin(a_end + 1.2), z - 0.004), (cx, cy + rc + 0.012, z - 0.012),
            (cx, cy + rc + 0.03, z - 0.03)]
    ob = tube_path(name, pts, r, 'coil', sides=5)
    # Haltekreuz
    arms = []
    for k in range(3):
        a = radians(90 + k * 120)
        arm = rbox('arm', rc * 1.05, 0.006, 0.012, 'steel_dark', r=0.001, seg=1)
        place(arm, loc=(cx + cos(a) * rc * 0.5, cy + sin(a) * rc * 0.5, z - 0.011), rot=(0, 0, math.degrees(a)))
        arms.append(arm)
    return join([ob] + arms)


def stove_recipe(P, N, A):
    zmin = 0.0
    col, rough, metal = grime_recipe(P, N, A, (0.50, 0.43, 0.30), 0.22, seed=21, yellow=0.4, grime=0.55, crevice=0.9,
                                     floor=0.7, drips=0.55, rust_edges=0.35, rust_spots=0.25, dust_top=0.15, zmin=0, zmax=1.17,
                                     grime_col=(0.16, 0.09, 0.03))
    # eingebrannte Fettringe um die Kochplatten, Fettfilm vorn
    top = np.clip(N[:, 2], 0, 1)
    burn = np.zeros(len(P), np.float32)
    for (bx, by, rp) in STOVE_BURNERS:
        d = np.hypot(P[:, 0] - bx, P[:, 1] - by)
        burn += np.exp(-np.maximum(d - rp, 0) / 0.035) * (d > rp - 0.01)
    burn = np.clip(burn * top * (P[:, 2] > 0.88) * (0.5 + 0.7 * nfbm(P, 18, 3, 22)), 0, 1)
    col = mix(col, np.array([0.06, 0.035, 0.012], np.float32), burn * 0.85)
    rough = rough * (1 - burn * 0.4)
    # Fettläufer über Backofentür von der Kochfläche
    fr = (N[:, 1] < -0.5) & (P[:, 2] > 0.5)
    run = smoothstep(0.66, 0.78, nfbm(P, 1.0, 3, 23, aniso=(45, 45, 1.8))) * np.exp(-(0.89 - P[:, 2]) / 0.25)
    col = mix(col, np.array([0.12, 0.06, 0.015], np.float32), np.clip(run * fr, 0, 1) * 0.8)
    # Griffbereich speckig
    m = A.get('m_handle_zone')
    if m is not None:
        col = mix(col, np.array([0.18, 0.12, 0.06], np.float32), np.clip(m, 0, 1) * 0.5)
    return col, rough, metal


UNIQUE_BAKE['stove'] = dict(res=1024, base=((0.50, 0.43, 0.30), 0.22, 0.0), recipe=stove_recipe)


@prop('stove_old', 'metal', 'kitchen',
      'Alter 30"-Elektroherd (Mandelweiß), vier Heizspiralen (eine fehlt), rostige Tropfschalen, Backofentür steht einen '
      'Spalt offen (Ofenraum mit Rost sichtbar), Schublade halb offen, ein Knebel fehlt, Delle in der linken Seitenwand. '
      'Bedienblende = Imagegen-Etikett MU_stove_panel. Rückseite an Wand (+Y).')
def stove_old():
    W = STOVE_W
    hw = W / 2
    Y0, Y1 = -0.30, 0.33
    parts = []
    # Korpus aus Blechen (Ofenraum offen nach vorn)
    for sx in (-1, 1):
        s = rbox('side', 0.012, Y1 - Y0, 0.89, 'MU_stove', loc=(sx * (hw - 0.006), (Y0 + Y1) / 2, 0.445), r=0.004, step=0.04)
        parts.append(s)
    parts[0].name = 'sideL'
    dent(parts[0], (-hw, 0.02, 0.48), 0.14, 0.014, direction=(1, 0, 0))
    dent(parts[0], (-hw, -0.18, 0.25), 0.06, 0.006, direction=(1, 0, 0))
    parts.append(rbox('back', W - 0.024, 0.012, 0.89, 'MU_stove', loc=(0, Y1 - 0.006, 0.445), r=0.003, step=0.08))
    parts.append(rbox('bottom', W - 0.024, Y1 - Y0, 0.012, 'steel_dark', loc=(0, (Y0 + Y1) / 2, 0.026), r=0.002))
    # Frontrahmen um Ofenöffnung
    fy = Y0 + 0.006
    parts += [rbox('fT', W - 0.02, 0.012, 0.07, 'MU_stove', loc=(0, fy, 0.855), r=0.003, step=0.06),
              rbox('fL', 0.07, 0.012, 0.64, 'MU_stove', loc=(-hw + 0.045, fy, 0.50), r=0.003, step=0.06),
              rbox('fR', 0.07, 0.012, 0.64, 'MU_stove', loc=(hw - 0.045, fy, 0.50), r=0.003, step=0.06),
              rbox('fB', W - 0.02, 0.012, 0.03, 'MU_stove', loc=(0, fy, 0.18), r=0.003)]
    # Ofenraum (dunkle Emaille), Rost
    cx0, cx1, cz0, cz1, cy1 = -0.31, 0.31, 0.20, 0.82, 0.26
    parts += [rbox('cT', 0.62, cy1 - Y0, 0.01, 'steel_dark', loc=(0, (Y0 + cy1) / 2, cz1), r=0.002),
              rbox('cB', 0.62, cy1 - Y0, 0.01, 'steel_dark', loc=(0, (Y0 + cy1) / 2, cz0), r=0.002),
              rbox('cL', 0.01, cy1 - Y0, cz1 - cz0, 'steel_dark', loc=(cx0, (Y0 + cy1) / 2, (cz0 + cz1) / 2), r=0.002),
              rbox('cR', 0.01, cy1 - Y0, cz1 - cz0, 'steel_dark', loc=(cx1, (Y0 + cy1) / 2, (cz0 + cz1) / 2), r=0.002),
              rbox('cBk', 0.62, 0.01, cz1 - cz0, 'steel_dark', loc=(0, cy1, (cz0 + cz1) / 2), r=0.002)]
    rack = [tube_path('rk', [(-0.29, -0.27, 0.46), (0.29, -0.27, 0.46), (0.29, 0.24, 0.46), (-0.29, 0.24, 0.46), (-0.29, -0.27, 0.46)],
                      0.003, 'chrome_dull', sides=4, caps=False)]
    for i in range(11):
        x = -0.27 + i * 0.054
        rack.append(tube_path('rw', [(x, -0.27, 0.461), (x, 0.24, 0.461)], 0.0022, 'chrome_dull', sides=4))
    parts += rack
    for sx in (-1, 1):   # Führungsrippen
        for z in (0.34, 0.45, 0.56, 0.67):
            parts.append(rbox('rib', 0.01, 0.45, 0.008, 'steel_dark', loc=(sx * 0.302, -0.02, z), r=0.003))
    # Kochfläche mit vier Mulden
    bm = bmesh.new()
    ztop = 0.912
    outer = rrect(0, (Y0 - 0.022 + Y1 - 0.06) / 2, hw, (Y1 - 0.06 - Y0 + 0.022) / 2, 0.01, ztop, nc=3, ns=8)
    ov = [bm.verts.new(p) for p in outer]
    edges = [bm.edges.new((ov[i], ov[(i + 1) % len(ov)])) for i in range(len(ov))]
    for (bx, by, rp) in STOVE_BURNERS:
        cv = [bm.verts.new((bx + (rp - 0.004) * cos(2 * pi * k / 28), by + (rp - 0.004) * sin(2 * pi * k / 28), ztop)) for k in range(28)]
        edges += [bm.edges.new((cv[k], cv[(k + 1) % 28])) for k in range(28)]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    for f in list(bm.faces):
        c = f.calc_center_median()
        if any(math.hypot(c.x - bx, c.y - by) < rp - 0.006 for (bx, by, rp) in STOVE_BURNERS):
            bm.faces.remove(f)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    top = mesh_obj('cooktop', bm, 'MU_stove')
    mod_solidify(top, 0.022, off=-1)
    apply_mods(top)
    mod_bevel(top, 0.004, 2, angle=40)
    apply_mods(top)
    parts.append(top)
    for i, (bx, by, rp) in enumerate(STOVE_BURNERS):
        pan = lathe('pan', [(0.042, ztop - 0.045), (0.05, ztop - 0.043), (rp * 0.6, ztop - 0.036), (rp - 0.012, ztop - 0.004),
                            (rp - 0.004, ztop + 0.0015), (rp + 0.002, ztop + 0.002), (rp + 0.004, ztop + 0.0005)],
                    'burner_pan', seg=28, loc=(bx, by, 0))
        mod_solidify(pan, 0.001, off=-1)
        parts.append(pan)
        if i == 2:   # Spirale fehlt: Anschlussblock sichtbar
            parts.append(rbox('term', 0.03, 0.025, 0.02, 'plastic_white', loc=(bx, by + rp - 0.015, ztop - 0.025), r=0.002))
            continue
        parts.append(coil_element('coil', bx, by, ztop + 0.010, rp - 0.032, 4.0 if rp > 0.1 else 3.0))
    # Blende
    bg = rbox('guard', W, 0.06, 0.254, 'MU_stove', loc=(0, Y1 - 0.03, 0.912 + 0.127), r=0.004, step=0.06)
    parts.append(bg)
    pnl = plane_uv01('panel', W - 0.006, 0.250, 'MU_stove_panel', nx=8, ny=3)
    place(pnl, loc=(0, Y1 - 0.0605, 0.912 + 0.127))
    parts.append(pnl)
    parts.append(rbox('trim', W + 0.004, 0.066, 0.008, 'chrome_dull', loc=(0, Y1 - 0.03, 0.912 + 0.254 + 0.004), r=0.003))
    kz = 0.912 + 0.254 * (1 - 0.468)
    for i, u in enumerate([0.0735, 0.2205, 0.645, 0.7985, 0.9285]):
        kx = -hw + u * W
        if i == 1:   # Knebel fehlt: D-Welle
            parts.append(cyl('shaft', 0.003, 0.016, 'steel_dark', seg=8, loc=(kx, Y1 - 0.068, kz), rot=(90, 0, 0)))
            continue
        k = lathe('knob', [(0.0001, 0.0), (0.024, 0.0), (0.024, 0.006), (0.019, 0.010), (0.017, 0.028), (0.013, 0.032), (0.0001, 0.033)],
                  'plastic_black', seg=20)
        fin = rbox('fin', 0.008, 0.03, 0.036, 'plastic_black', loc=(0, 0, 0.02), r=0.002)
        cap = cyl('cap', 0.0125, 0.003, 'chrome_dull', seg=16, loc=(0, 0, 0.0335))
        kk = join([k, fin, cap])
        place(kk, rot=(90, 0, (i * 37) % 70 - 30))
        place(kk, loc=(kx, Y1 - 0.0605, kz))
        rot_about(kk, (kx, Y1, kz), 'Y', [0, 0, 40, -60, 15][i])
        parts.append(kk)
    tk = cyl('timer', 0.008, 0.012, 'chrome_dull', seg=12, loc=(-hw + 0.4915 * W, Y1 - 0.066, 0.912 + 0.254 * 0.53), rot=(90, 0, 0))
    parts.append(tk)
    # Backofentür (einen Spalt offen)
    dz0, dz1 = 0.175, 0.865
    door = rbox('door', W - 0.012, 0.055, dz1 - dz0, 'MU_stove', loc=(0, Y0 - 0.0275, (dz0 + dz1) / 2), r=0.008, step=0.05)
    mark(door, 'handle_zone', 0.0)
    gl = rbox('glass', 0.44, 0.004, 0.24, 'glass_dark', loc=(0, Y0 - 0.0565, 0.60), r=0.001, seg=1)
    fr = [rbox('wf', 0.52, 0.004, 0.04, 'steel_dark', loc=(0, Y0 - 0.0575, 0.60 + 0.14), r=0.0015),
          rbox('wf', 0.52, 0.004, 0.04, 'steel_dark', loc=(0, Y0 - 0.0575, 0.60 - 0.14), r=0.0015),
          rbox('wf', 0.04, 0.004, 0.24, 'steel_dark', loc=(0.24, Y0 - 0.0575, 0.60), r=0.0015),
          rbox('wf', 0.04, 0.004, 0.24, 'steel_dark', loc=(-0.24, Y0 - 0.0575, 0.60), r=0.0015)]
    hd = pipe('handle', [(-0.31, Y0 - 0.054, 0.815), (-0.31, Y0 - 0.10, 0.815), (0.31, Y0 - 0.10, 0.815), (0.31, Y0 - 0.054, 0.815)],
              0.011, 'chrome_dull', sides=10, bend=0.025)
    # innere Türscheibe/Blech (sichtbar im Spalt)
    inner = rbox('dinner', 0.60, 0.006, 0.60, 'steel_dark', loc=(0, Y0 + 0.002, 0.52), r=0.002)
    dd = join([door, gl, hd, inner] + fr)
    rot_about(dd, (0, Y0, dz0), 'X', 7.5)
    parts.append(dd)
    # Schublade (verkantet, halb offen)
    dr = rbox('drw', W - 0.012, 0.03, 0.135, 'MU_stove', loc=(0, Y0 - 0.015, 0.025 + 0.0675), r=0.006, step=0.06)
    dbx = [rbox('db', 0.66, 0.5, 0.004, 'steel_dark', loc=(0, Y0 + 0.25, 0.04), r=0.0),
           rbox('db', 0.004, 0.5, 0.1, 'steel_dark', loc=(-0.33, Y0 + 0.25, 0.09), r=0.0),
           rbox('db', 0.004, 0.5, 0.1, 'steel_dark', loc=(0.33, Y0 + 0.25, 0.09), r=0.0)]
    # Backblech im Fach
    dbx.append(rbox('sheet', 0.40, 0.30, 0.012, 'aluminium_dark', loc=(0.05, Y0 + 0.20, 0.05), r=0.004))
    d2 = join([dr] + dbx)
    rot_about(d2, (0.3, Y0, 0.05), 'Z', 3)
    xform(d2, Matrix.Translation((0, -0.12, 0)))
    parts.append(d2)
    # Füße
    for sx in (-1, 1):
        for yy in (Y0 + 0.04, Y1 - 0.05):
            parts.append(cyl('foot', 0.015, 0.025, 'steel_dark', seg=10, loc=(sx * (hw - 0.04), yy, 0.0125)))
    ob = join(parts, 'stove_old')

    def masks_handle(co, nrm):
        d = np.abs(co[:, 2] - 0.80) < 0.06
        return (d & (co[:, 1] < Y0 - 0.03)).astype(np.float32)

    def tint(co, nrm, mn):
        t = np.ones((len(co), 3), np.float32)
        pan = mn == 'M_burner_pan'
        n = nfbm(co, 25, 3, 31)
        rust = np.clip(smoothstep(0.45, 0.7, n) + (co[:, 2] < 0.88) * 0.6, 0, 1)
        t[pan] = (1 - rust[pan, None] * np.array([0.55, 0.75, 0.9], np.float32))
        return t
    return finalize(ob, 'stove_old', 'metal', center=(-hw, hw, Y0, Y1), tint_fn=tint, seed=6,
                    masks={'handle_zone': masks_handle})


# ==============================================================================================
# Kühlschrank (Gefrierfach oben), Tür weit offen, innen verschimmelt
FR_W, FR_Y0, FR_Y1, FR_H = 0.76, -0.335, 0.37, 1.68


def fridge_recipe(P, N, A):
    liner = np.clip(A.get('m_liner', np.zeros(len(P), np.float32)), 0, 1)
    col, rough, metal = grime_recipe(P, N, A, (0.60, 0.58, 0.52), 0.18, seed=41, yellow=0.45, grime=0.4, crevice=0.8,
                                     floor=0.6, drips=0.35, rust_edges=0.2, rust_spots=0.18, dust_top=0.6, zmin=0, zmax=FR_H,
                                     grime_col=(0.22, 0.17, 0.09))
    # Innenraum: Kunststoff, Schimmel, eingetrocknete Pfützen, Läufer
    n1 = nfbm(P, 9.0, 4, 42)
    n2 = nfbm(P, 40.0, 3, 43)
    lin = np.array([0.62, 0.63, 0.60], np.float32)
    lcol = np.tile(lin, (len(P), 1))
    lr = np.full(len(P), 0.28, np.float32)
    ao = A.get('ao', np.ones(len(P), np.float32))
    mold = np.clip(smoothstep(0.55, 0.8, n1) * (0.5 + 0.8 * smoothstep(0.9, 0.5, ao)) + smoothstep(0.7, 0.85, n2) * 0.5, 0, 1)
    mold *= np.clip(1.3 - (P[:, 2] - 0.1) / 1.2, 0.3, 1)
    lcol = mix(lcol, np.array([0.05, 0.07, 0.03], np.float32), mold * 0.9)
    lcol = mix(lcol, np.array([0.20, 0.22, 0.12], np.float32), smoothstep(0.5, 0.6, n2) * mold * 0.6)
    run = smoothstep(0.62, 0.8, nfbm(P, 1.0, 3, 44, aniso=(30, 30, 1.5))) * (np.abs(N[:, 2]) < 0.5)
    lcol = mix(lcol, np.array([0.25, 0.12, 0.03], np.float32), run * 0.7)
    puddle = (N[:, 2] > 0.7) * smoothstep(0.45, 0.6, nfbm(P, 4.0, 3, 45))
    lcol = mix(lcol, np.array([0.10, 0.05, 0.015], np.float32), puddle * 0.85)
    lr = lr + mold * 0.6 - puddle * 0.2
    col = mix(col, lcol, liner)
    rough = rough * (1 - liner) + lr * liner
    return col, np.clip(rough, 0.05, 1), metal * (1 - liner)


UNIQUE_BAKE['fridge'] = dict(res=1024, base=((0.60, 0.58, 0.52), 0.2, 0.0), recipe=fridge_recipe)


def bottle(name, h, r, mat, neck=0.4, seg=12):
    prof = [(0.0001, 0), (r * 0.9, 0), (r, 0.01), (r, h * (1 - neck)), (r * 0.45, h * (1 - neck * 0.4)), (r * 0.38, h * 0.97),
            (r * 0.42, h), (0.0001, h)]
    return lathe(name, prof, mat, seg=seg)


def blob(name, r, mat, n=10, seed=0, h=0.002):
    rnd = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2 * pi * i / n
        rr = r * rnd.uniform(0.6, 1.25)
        pts.append((rr * cos(a), rr * sin(a)))
    bm = bm_poly_slab(pts, h)
    ob = mesh_obj(name, bm, mat)
    mod_bevel(ob, h * 0.45, 2, angle=30)
    apply_mods(ob)
    return ob


@prop('fridge_open', 'metal', 'kitchen',
      'Kühlschrank mit Gefrierfach oben (76 x 70 x 168 cm). Kühlteil-Tür ~105° offen (Scharnier rechts), Innenraum '
      'verschimmelt, Pfützen, Glasböden, ein Gemüsefach herausgezogen, Türfächer mit Flaschen. Kinderzeichnung '
      '(MU_fridge_note) am Gefrierfach. Ursprung = Mitte Korpusgrundfläche; offene Tür ragt nach vorn rechts.')
def fridge_open():
    W, hw = FR_W, FR_W / 2
    parts = []
    body = rbox('body', W, FR_Y1 - FR_Y0, FR_H, 'MU_fridge', loc=(0, (FR_Y0 + FR_Y1) / 2, FR_H / 2), r=0.022, seg=3, step=0.05)
    cav = rbox('cav', 0.68, 0.70, 1.05, 'MU_fridge', loc=(0, FR_Y0 - 0.35 + 0.665, 0.10 + 0.525), r=0.03, seg=3)
    # Kavität: vorn offen bis y=0.33
    xform(cav, Matrix.Translation((0, 0, 0)))
    boolean_diff(body, cav)
    mod_bevel(body, 0.012, 3, angle=60)
    apply_mods(body)
    # Innenflächen = Kunststoff
    me = body.data
    mk = np.zeros(len(me.vertices), np.float32)
    for v in me.vertices:
        if abs(v.co.x) < 0.3405 and 0.098 < v.co.z < 1.152 and v.co.y > FR_Y0 + 0.004:
            mk[v.index] = 1.0
    a = me.attributes.new('kbm_liner', 'FLOAT', 'POINT')
    a.data.foreach_set('value', mk)
    parts.append(body)
    # Innenleben
    inner = []
    for z in (0.56, 0.86):
        sh = rbox('shelf', 0.672, 0.50, 0.005, 'glass_dirty', loc=(0, 0.06, z), r=0.0015, seg=1)
        trim = rbox('trim', 0.676, 0.018, 0.022, 'plastic_white', loc=(0, -0.19, z - 0.004), r=0.004)
        inner += [sh, trim]
        for sx in (-1, 1):
            inner.append(rbox('rib', 0.012, 0.52, 0.01, 'fridge_liner', loc=(sx * 0.335, 0.05, z - 0.009), r=0.004))
    # Gemüsefächer + Abdeckung
    inner.append(rbox('cover', 0.672, 0.50, 0.006, 'glass_dirty', loc=(0, 0.06, 0.355), r=0.002, seg=1))
    for i, sx in enumerate((-1, 1)):
        x = sx * 0.168
        bxp = [rbox('cf', 0.32, 0.01, 0.22, 'plastic_clear', loc=(x, -0.18, 0.225), r=0.004),
               rbox('cl', 0.008, 0.48, 0.20, 'plastic_clear', loc=(x - 0.156, 0.06, 0.215), r=0.003),
               rbox('cr', 0.008, 0.48, 0.20, 'plastic_clear', loc=(x + 0.156, 0.06, 0.215), r=0.003),
               rbox('cb', 0.32, 0.008, 0.20, 'plastic_clear', loc=(x, 0.30, 0.215), r=0.003),
               rbox('cbt', 0.31, 0.48, 0.006, 'plastic_clear', loc=(x, 0.06, 0.118), r=0.002),
               rbox('cgrip', 0.12, 0.02, 0.02, 'plastic_white', loc=(x, -0.192, 0.31), r=0.006)]
        # vergammelter Inhalt
        bxp.append(blob('rot', 0.06, 'spill_dark', seed=i + 3, h=0.02))
        place(bxp[-1], loc=(x + 0.03, 0.02, 0.122))
        bxp.append(blob('mold', 0.04, 'mold_green', seed=i + 7, h=0.03))
        place(bxp[-1], loc=(x - 0.05, 0.12, 0.122))
        cb = join(bxp)
        if i == 0:
            xform(cb, Matrix.Translation((0, -0.17, 0)))
        inner.append(cb)
    # Pfützen/Flecken auf Glasböden
    for k, (x, y, z, r) in enumerate([(-0.18, 0.0, 0.5625, 0.07), (0.15, 0.12, 0.5625, 0.05), (0.05, -0.05, 0.8625, 0.09),
                                      (-0.2, 0.15, 0.8625, 0.04), (0.1, 0.1, 0.3585, 0.08)]):
        b = blob('spill', r, 'spill_dark', seed=k, h=0.0012)
        place(b, loc=(x, y, z))
        inner.append(b)
    # Inhalt: Glas, Schachtel, liegende Flasche
    jar = lathe('jar', [(0.0001, 0), (0.035, 0), (0.038, 0.01), (0.038, 0.09), (0.03, 0.105), (0.03, 0.115), (0.0001, 0.115)],
                'glass_dirty', seg=14, loc=(-0.2, 0.15, 0.565))
    lid = cyl('lid', 0.032, 0.014, 'steel_dark', seg=14, loc=(-0.2, 0.15, 0.565 + 0.12))
    box_ = rbox('takeout', 0.20, 0.20, 0.07, 'plastic_white', loc=(0.15, 0.08, 0.865 + 0.035), r=0.012)
    btl = bottle('btl', 0.30, 0.05, 'plastic_clear')
    place(btl, loc=(0.08, 0.10, 0.565 + 0.05), rot=(0, 90, 20))
    inner += [jar, lid, box_, btl]
    # Leuchte + Thermostat oben
    inner.append(rbox('lamp', 0.16, 0.08, 0.05, 'plastic_clear', loc=(0, 0.12, 1.12), r=0.01))
    inner.append(cyl('thermo', 0.025, 0.02, 'plastic_white', seg=14, loc=(0.2, 0.0, 1.14)))
    parts += inner
    # Sockelgitter
    for i in range(5):
        parts.append(rbox('grille', 0.70, 0.012, 0.009, 'plastic_black', loc=(0, FR_Y0 + 0.012, 0.02 + i * 0.016), r=0.003))
    # Gefrierfach-Tür (zu) mit Zeichnung
    fz0, fz1 = 1.185, 1.675
    fd = rbox('fdoor', W, 0.06, fz1 - fz0, 'MU_fridge', loc=(0, FR_Y0 - 0.03, (fz0 + fz1) / 2), r=0.014, seg=3, step=0.05)
    gk = rbox('fgasket', W - 0.03, 0.01, fz1 - fz0 - 0.03, 'gasket', loc=(0, FR_Y0 - 0.004, (fz0 + fz1) / 2), r=0.004)
    fh = pipe('fh', [(-hw + 0.04, FR_Y0 - 0.058, fz0 + 0.03), (-hw + 0.04, FR_Y0 - 0.095, fz0 + 0.06),
                     (-hw + 0.04, FR_Y0 - 0.095, fz0 + 0.24), (-hw + 0.04, FR_Y0 - 0.058, fz0 + 0.27)], 0.011, 'chrome_dull', sides=10, bend=0.03)
    note = plane_uv01('note', 0.20, 0.26, 'MU_fridge_note', nx=5, ny=6)
    def curl(v):
        u = (v.x / 0.2 + 0.5)
        w = (0.5 - v.z / 0.26)
        return v + Vector((0, -0.014 * (w ** 2) * (0.4 + abs(u - 0.5) * 1.6), 0))
    deform(note, curl)
    place(note, loc=(0.06, FR_Y0 - 0.0612, 1.42), rot=(0, 4, 0))
    mag = cyl('magnet', 0.016, 0.009, 'plastic_red', seg=12, loc=(0.06 - 0.008, FR_Y0 - 0.066, 1.42 + 0.115), rot=(90, 0, 0), bevel=0.003)
    parts += [fd, gk, fh, note, mag]
    # Kühlteil-Tür, offen
    dz0, dz1 = 0.115, 1.17
    dparts = [rbox('door', W, 0.05, dz1 - dz0, 'MU_fridge', loc=(0, FR_Y0 - 0.035, (dz0 + dz1) / 2), r=0.014, seg=3, step=0.05)]
    il = rbox('dliner', 0.66, 0.035, 0.96, 'MU_fridge', loc=(0, FR_Y0 - 0.010 + 0.0175 - 0.0175, (dz0 + dz1) / 2), r=0.012, seg=2, step=0.05)
    mark(il, 'liner')
    dparts.append(il)
    for (gx, gy, gw, gh) in ((0, (dz1 - 0.018), 0.73, 0.022), (0, dz0 + 0.018, 0.73, 0.022),
                             (-0.356, (dz0 + dz1) / 2, 0.022, dz1 - dz0 - 0.03), (0.356, (dz0 + dz1) / 2, 0.022, dz1 - dz0 - 0.03)):
        dparts.append(rbox('gk', gw, 0.016, gh, 'gasket', loc=(gx, FR_Y0 - 0.006, gy), r=0.007, seg=2))
    for k, z in enumerate((0.30, 0.58, 0.86)):
        y0 = FR_Y0 + 0.008
        bin_ = [rbox('bf', 0.60, 0.006, 0.085, 'fridge_liner', loc=(0, y0 + 0.09, z + 0.042), r=0.002),
                rbox('bb', 0.60, 0.09, 0.006, 'fridge_liner', loc=(0, y0 + 0.045, z), r=0.002),
                rbox('bl', 0.006, 0.09, 0.07, 'fridge_liner', loc=(-0.30, y0 + 0.045, z + 0.035), r=0.002),
                rbox('br', 0.006, 0.09, 0.07, 'fridge_liner', loc=(0.30, y0 + 0.045, z + 0.035), r=0.002)]
        for b in bin_:
            mark(b, 'liner')
        dparts += bin_
    b1 = bottle('ket', 0.20, 0.03, 'plastic_red', neck=0.3); place(b1, loc=(-0.2, FR_Y0 + 0.05, 0.585))
    b2 = bottle('jug', 0.25, 0.055, 'plastic_white', neck=0.25); place(b2, loc=(0.18, FR_Y0 + 0.05, 0.305))
    b3 = bottle('btl2', 0.24, 0.032, 'glass_dirty', neck=0.45); place(b3, loc=(-0.08, FR_Y0 + 0.05, 0.305), rot=(14, 0, 0))
    b4 = lathe('jar2', [(0.0001, 0), (0.03, 0), (0.032, 0.08), (0.025, 0.09), (0.0001, 0.09)], 'glass_dirty', seg=12)
    place(b4, loc=(0.1, FR_Y0 + 0.05, 0.865))
    dparts += [b1, b2, b3, b4]
    dh = pipe('dh', [(-hw + 0.04, FR_Y0 - 0.058, dz1 - 0.03), (-hw + 0.04, FR_Y0 - 0.095, dz1 - 0.06),
                     (-hw + 0.04, FR_Y0 - 0.095, dz1 - 0.30), (-hw + 0.04, FR_Y0 - 0.058, dz1 - 0.33)], 0.011, 'chrome_dull', sides=10, bend=0.03)
    dparts.append(dh)
    dd = join(dparts)
    rot_about(dd, (hw - 0.01, FR_Y0 - 0.06, 0), 'Z', 105)
    parts.append(dd)
    # Scharniere
    for z in (dz0 - 0.01, 1.178, fz1 + 0.006):
        parts.append(rbox('hinge', 0.05, 0.07, 0.012, 'chrome_dull', loc=(hw - 0.03, FR_Y0 - 0.03, z), r=0.003))
    ob = join(parts, 'fridge_open')
    return finalize(ob, 'fridge_open', 'metal', center=(-hw, hw, FR_Y0, FR_Y1), seed=7, ao=dict(dist=0.35))


# ==============================================================================================
def microwave_recipe(P, N, A):
    return grime_recipe(P, N, A, (0.52, 0.50, 0.45), 0.3, seed=51, yellow=0.4, grime=0.6, crevice=0.9, floor=0.3, drips=0.5,
                        rust_edges=0.1, rust_spots=0.08, dust_top=0.7, zmin=0, zmax=0.29, grime_col=(0.15, 0.09, 0.03))


UNIQUE_BAKE['microwave'] = dict(res=512, base=((0.52, 0.50, 0.45), 0.3, 0.0), recipe=microwave_recipe)


@prop('microwave', 'metal', 'kitchen',
      'Alte Arbeitsplatten-Mikrowelle 51 x 38 x 29 cm, verfettet, Delle oben, Bedienfeld = MU_microwave_panel.')
def microwave():
    W, D, H = 0.51, 0.38, 0.29
    parts = []
    body = rbox('mbody', W, D - 0.02, H - 0.012, 'MU_microwave', loc=(0, 0.01, 0.012 + (H - 0.012) / 2), r=0.01, seg=3, step=0.04)
    dent(body, (-0.05, 0.05, H), 0.08, 0.008, direction=(0, 0, -1))
    parts.append(body)
    y0 = -D / 2 + 0.02
    door = rbox('mdoor', 0.385, 0.025, H - 0.03, 'plastic_grey', loc=(-W / 2 + 0.005 + 0.1925, y0 - 0.0125, 0.012 + (H - 0.012) / 2), r=0.006, seg=2)
    win = rbox('mwin', 0.27, 0.004, 0.16, 'glass_dark', loc=(-W / 2 + 0.175, y0 - 0.026, 0.155), r=0.004, seg=1)
    pull = rbox('mpull', 0.016, 0.012, 0.18, 'plastic_black', loc=(-W / 2 + 0.37, y0 - 0.03, 0.155), r=0.005)
    pnl_bg = rbox('mpbg', 0.112, 0.012, H - 0.03, 'plastic_black', loc=(W / 2 - 0.062, y0 - 0.006, 0.012 + (H - 0.012) / 2), r=0.004)
    pnl = plane_uv01('mpanel', 0.106, 0.244, 'MU_microwave_panel')
    place(pnl, loc=(W / 2 - 0.062, y0 - 0.0125, 0.012 + (H - 0.012) / 2))
    parts += [door, win, pull, pnl_bg, pnl]
    for i in range(7):   # Lüftungsschlitze rechts
        parts.append(rbox('vent', 0.003, 0.11, 0.006, 'plastic_black', loc=(W / 2 + 0.0005, 0.05, 0.12 + i * 0.016), r=0.001))
    for sx in (-1, 1):
        for yy in (-0.13, 0.15):
            parts.append(cyl('foot', 0.012, 0.012, 'rubber_black', seg=10, loc=(sx * 0.21, yy, 0.006)))
    ob = join(parts, 'microwave')
    return finalize(ob, 'microwave', 'metal', seed=8, ao=dict(dist=0.12))


# ==============================================================================================
def hood_recipe(P, N, A):
    col, rough, metal = grime_recipe(P, N, A, (0.50, 0.44, 0.32), 0.25, seed=61, yellow=0.5, grime=0.8, crevice=1.0, floor=0.0,
                                     drips=0.8, rust_edges=0.3, rust_spots=0.2, dust_top=0.9, zmin=0, zmax=0.15,
                                     grime_col=(0.14, 0.08, 0.02))
    under = np.clip(-N[:, 2], 0, 1)
    g = under * (0.5 + 0.5 * nfbm(P, 12, 3, 62))
    col = mix(col, np.array([0.08, 0.045, 0.012], np.float32), g * 0.8)
    rough = rough * (1 - g * 0.5)
    return col, rough, metal


UNIQUE_BAKE['range_hood'] = dict(res=512, base=((0.50, 0.44, 0.32), 0.25, 0.0), recipe=hood_recipe)


@prop('range_hood', 'metal', 'kitchen',
      'Unterbau-Dunstabzugshaube 30" (76 x 46 x 15 cm), Mandelweiß, stark verfettet, Fettfilter, Lampenabdeckung, '
      'zwei Wippschalter. Ursprung = Unterkante Mitte; Montage unter Oberschrank (Unterkante ca. 1,52 m).',
      mount='Unterkante ca. 1.52 m (unter 76er-Oberschrank, 61 cm über Kochfläche)')
def range_hood():
    W, D, H = 0.762, 0.457, 0.152
    outline = [(D / 2, 0.0), (D / 2, H), (-D / 2 + 0.03, H), (-D / 2, H - 0.04), (-D / 2, 0.0)]
    bm = bm_poly_slab(outline, W, z0=-W / 2)
    ob = mesh_obj('hood', bm, 'MU_range_hood')
    xform(ob, Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
    mod_bevel(ob, 0.006, 3, angle=30)
    apply_mods(ob)
    parts = [ob]
    parts.append(rbox('filter', 0.36, 0.26, 0.004, 'aluminium_dark', loc=(-0.12, 0.02, -0.001), r=0.002))
    for i in range(9):
        parts.append(rbox('fl', 0.35, 0.003, 0.002, 'steel_dark', loc=(-0.12, -0.10 + i * 0.03, -0.0035), r=0.0))
    parts.append(rbox('lens', 0.16, 0.10, 0.012, 'plastic_clear', loc=(0.24, -0.02, -0.004), r=0.004))
    for i in range(2):
        sw = rbox('sw', 0.022, 0.012, 0.03, 'plastic_black', loc=(-0.31 + i * 0.035, -D / 2 - 0.002, 0.06), r=0.003)
        rot_about(sw, (-0.31 + i * 0.035, -D / 2, 0.06), 'X', 8 if i else -8)
        parts.append(sw)
    # Fetttropfen an der Vorderkante
    rnd = random.Random(3)
    for i in range(6):
        x = rnd.uniform(-0.33, 0.33)
        dpp = lathe('drip', [(0.0001, -0.008 - rnd.uniform(0, 0.006)), (0.003, -0.004), (0.004, 0.0), (0.0001, 0.0005)], 'grease', seg=6,
                    loc=(x, -D / 2 + 0.006, 0.0))
        parts.append(dpp)
    o = join(parts, 'range_hood')
    return finalize(o, 'range_hood', 'metal', seed=9, ao=dict(dist=0.1))


# ==============================================================================================
# Geschirr und Töpfe (Kleinkram < 1k Tris)
def crust_tint(co, nrm, mn):
    t = np.ones((len(co), 3), np.float32)
    n = nfbm(co, 30, 3, 71)
    k = smoothstep(0.5, 0.75, n) * 0.6
    t *= (1 - k[:, None] * np.array([0.5, 0.65, 0.85], np.float32))
    return t


@prop('kitchen_pot', 'metal', 'kitchen', 'Alu-Kochtopf (Ø 24 cm) mit Delle, angebranntem Rest, Deckel schief aufgelegt.')
def kitchen_pot():
    r, h = 0.12, 0.16
    prof = [(0.0001, 0.006), (r - 0.012, 0.0), (r - 0.002, 0.008), (r, 0.03), (r, h - 0.006), (r + 0.004, h), (r - 0.003, h + 0.002),
            (r - 0.005, h - 0.01), (r - 0.005, 0.03), (r - 0.016, 0.009), (0.0001, 0.009)]
    pot = lathe('pot', prof, 'aluminium', seg=20)
    dent(pot, (r, 0.0, 0.08), 0.05, 0.01, direction=(-1, 0, 0))
    hs = []
    for sx in (-1, 1):
        hs.append(pipe('h', [(sx * (r - 0.002), -0.035, h - 0.03), (sx * (r + 0.03), -0.035, h - 0.022), (sx * (r + 0.03), 0.035, h - 0.022),
                             (sx * (r - 0.002), 0.035, h - 0.03)], 0.005, 'aluminium', sides=6, bend=0.012, n=3))
    crust = blob('crust', 0.085, 'food_crust', seed=4, h=0.008)
    place(crust, loc=(0, 0, 0.009))
    lid = lathe('lid', [(0.0001, 0.032), (0.03, 0.03), (0.09, 0.016), (r + 0.004, 0.002), (r + 0.004, 0.0)], 'aluminium', seg=20, close_bot=False)
    mod_solidify(lid, 0.0015)
    knb = lathe('lk', [(0.0001, 0.03), (0.012, 0.03), (0.01, 0.04), (0.02, 0.05), (0.0001, 0.052)], 'bakelite', seg=10)
    L = join([lid, knb])
    place(L, loc=(0.02, 0.0, h + 0.002), rot=(0, -9, 0))
    ob = join([pot, crust, L] + hs, 'kitchen_pot')
    return finalize(ob, 'kitchen_pot', 'metal', tint_fn=crust_tint, seed=10, ao=dict(dist=0.08, rays=16))


@prop('kitchen_saucepan', 'metal', 'kitchen', 'Kleiner Stieltopf (Ø 17 cm), Bakelitgriff, innen eingebrannt.')
def kitchen_saucepan():
    r, h = 0.085, 0.09
    prof = [(0.0001, 0.005), (r - 0.01, 0.0), (r, 0.012), (r, h), (r + 0.003, h + 0.002), (r - 0.004, h), (r - 0.004, 0.014),
            (r - 0.013, 0.006), (0.0001, 0.006)]
    pan = lathe('sp', prof, 'stainless', seg=20)
    hd = rbox('hd', 0.022, 0.17, 0.016, 'bakelite', r=0.007, seg=2)
    place(hd, loc=(0, -(r + 0.09), h - 0.012), rot=(12, 0, 0))
    br = rbox('br', 0.02, 0.03, 0.02, 'stainless', r=0.004, loc=(0, -(r + 0.008), h - 0.022))
    crust = blob('crust', 0.06, 'food_crust', seed=6, h=0.012)
    place(crust, loc=(0.01, 0.0, 0.006))
    ob = join([pan, hd, br, crust], 'kitchen_saucepan')
    return finalize(ob, 'kitchen_saucepan', 'metal', tint_fn=crust_tint, seed=11, ao=dict(dist=0.06, rays=16))


@prop('kitchen_pan', 'metal', 'kitchen', 'Bratpfanne (Ø 28 cm), zerkratzte Antihaftschicht mit eingebranntem Fett.')
def kitchen_pan():
    r, h = 0.14, 0.045
    outp = [(0.0001, 0.0), (r - 0.04, 0.0), (r - 0.015, 0.008), (r, h), (r + 0.002, h + 0.002)]
    inp = [(r - 0.004, h + 0.002), (r - 0.018, 0.012), (r - 0.042, 0.005), (0.0001, 0.005)]
    o = lathe('po', outp, 'aluminium_dark', seg=24)
    i = lathe('pi', inp, 'nonstick', seg=24)
    hd = rbox('hd', 0.03, 0.19, 0.02, 'bakelite', r=0.009, seg=2, step=0.05)
    place(hd, loc=(0, -(r + 0.105), h + 0.012), rot=(10, 0, 0))
    hole = cyl('hole', 0.006, 0.03, 'steel_dark', seg=8, loc=(0, -(r + 0.18), h + 0.03))
    rv = rbox('rv', 0.03, 0.03, 0.025, 'aluminium_dark', r=0.005, loc=(0, -(r + 0.01), h - 0.005))
    gr = blob('grease', 0.07, 'grease', seed=9, h=0.0015)
    place(gr, loc=(0.03, 0.02, 0.005))
    ob = join([o, i, hd, hole, rv, gr], 'kitchen_pan')
    return finalize(ob, 'kitchen_pan', 'metal', tint_fn=crust_tint, seed=12, ao=dict(dist=0.05, rays=16))


def plate_obj(name, r=0.13, seg=18):
    prof = [(0.0001, 0.003), (0.06, 0.0), (0.07, 0.006), (r - 0.025, 0.012), (r - 0.002, 0.022), (r, 0.024), (r - 0.004, 0.026),
            (r - 0.03, 0.016), (0.07, 0.01), (0.0001, 0.01)]
    return lathe(name, prof, 'ceramic_plate', seg=seg)


@prop('kitchen_plate_stack', 'ceramic' if False else 'glass', 'kitchen',
      'Stapel aus 5 schmutzigen Tellern (Ø 26 cm), leicht versetzt, oberster mit Essensresten und Abplatzer.')
def kitchen_plate_stack():
    rnd = random.Random(5)
    parts = []
    for i in range(5):
        p = plate_obj('pl%d' % i, seg=16)
        place(p, loc=(rnd.uniform(-0.008, 0.008), rnd.uniform(-0.008, 0.008), i * 0.0115), rot=(rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0))
        parts.append(p)
    top = parts[-1]
    dent(top, (0.13, 0.0, 0.046 + 0.024), 0.02, 0.006, direction=(-0.7, 0, -0.7))
    c = blob('crust', 0.05, 'food_crust', seed=2, h=0.006)
    place(c, loc=(0.02, -0.02, 4 * 0.0115 + 0.01))
    ob = join(parts + [c], 'kitchen_plate_stack')
    return finalize(ob, 'kitchen_plate_stack', 'glass', tint_fn=crust_tint, seed=13, ao=dict(dist=0.04, rays=16))


@prop('kitchen_plate', 'glass', 'kitchen', 'Einzelner schmutziger Teller (Ø 26 cm) mit angetrockneten Resten.')
def kitchen_plate():
    p = plate_obj('plate', seg=20)
    c = blob('crust', 0.06, 'food_crust', seed=8, h=0.005)
    place(c, loc=(-0.02, 0.01, 0.01))
    c2 = blob('crust2', 0.025, 'grease', seed=11, h=0.003)
    place(c2, loc=(0.05, -0.03, 0.01))
    ob = join([p, c, c2], 'kitchen_plate')
    return finalize(ob, 'kitchen_plate', 'glass', tint_fn=crust_tint, seed=14, ao=dict(dist=0.04, rays=16))
