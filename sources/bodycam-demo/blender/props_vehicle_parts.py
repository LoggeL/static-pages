# props_vehicle_parts.py — Anbauteile (wird von props_vehicle.py per exec geladen)
# Alle Funktionen liefern Objekte im Fahrzeug-Raum (Blender, Front = -Y, Fahrerseite = +X).


def xform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    if scale:
        ob.scale = Vector(scale)
    ob.rotation_euler = Euler(rot)
    ob.location = Vector(loc)
    apply_tf(ob)
    return ob


def mirror_x(ob, name=None):
    """Spiegelt eine Kopie an der YZ-Ebene (Normalen korrigiert)."""
    me = ob.data.copy()
    me.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
    me.flip_normals()
    o2 = new_obj(name or ob.name + '_m', me)
    return o2


# ---------------------------------------------------------------------------------------------
# Rad: Reifen mit Profil, Stahlfelge mit Lüftungslöchern, Radkappe, Radmuttern, Bremsscheibe
def make_wheel(name, R=0.381, w=0.255, rim_r=0.2286, rim_mat='steel_wheel_black', cap='chrome',
               hubcap=None, flat=0.0, seed=0, segs=72, wear=0.0, holes=8):
    rnd = random.Random(seed)
    hw = w / 2
    M_t, M_r = mat('tire_rubber'), mat(rim_mat)
    parts = []
    # --- Reifen (offenes Profil von Innen- zu Außenwulst)
    side_in = [(-hw * 0.80, rim_r + 0.012), (-hw * 0.93, rim_r + 0.028), (-hw * 0.985, rim_r + 0.055),
               (-hw, rim_r + 0.085), (-hw * 0.995, (rim_r + R) / 2 + 0.01), (-hw * 0.965, R - 0.04),
               (-hw * 0.90, R - 0.018), (-hw * 0.80, R - 0.005), (-hw * 0.72, R)]
    tread = []
    gx = [-0.47, -0.15, 0.15, 0.47]
    gw = 0.040  # Rillenbreite relativ
    xs = [-0.72]
    for g in gx:
        xs += [g - gw, g - gw * 0.6, g + gw * 0.6, g + gw]
    xs.append(0.72)
    for i, xr in enumerate(xs):
        depth = 0.0
        if 1 <= i <= len(xs) - 2:
            k = (i - 1) % 4
            depth = 0.0095 * (1 - wear) if k in (1, 2) else 0.0
        tread.append((xr * hw, R - depth))
    side_out = [(-x, r) for (x, r) in reversed(side_in)]
    prof = side_in + tread[1:-1] + side_out
    tire = lathe(prof, segs=segs, m=M_t, name=name + '_tire')
    # Querrillen auf der Schulter
    me = tire.data
    for v in me.vertices:
        r = sqrt(v.co.y ** 2 + v.co.z ** 2)
        if r > R - 0.0035 and abs(v.co.x) > hw * 0.5:
            a = math.atan2(v.co.z, v.co.y)
            j = int(round(a / (2 * pi) * segs)) % segs
            if j % 2 == 0:
                s = (R - 0.008 * (1 - wear)) / r
                v.co.y *= s; v.co.z *= s
        if r > R - 0.0035 and abs(v.co.x) <= hw * 0.4:
            a = math.atan2(v.co.z, v.co.y)
            j = int(round(a / (2 * pi) * segs)) % segs
            if j % 6 == 3:
                s = (R - 0.004 * (1 - wear)) / r
                v.co.y *= s; v.co.z *= s
    parts.append(tire)
    # --- Felge (Stahl): Bett + Horn, außen
    rim_prof = [(-hw * 0.84, rim_r + 0.022), (-hw * 0.86, rim_r + 0.008), (-hw * 0.80, rim_r - 0.004),
                (-hw * 0.55, rim_r - 0.010), (-0.01, rim_r - 0.035), (hw * 0.45, rim_r - 0.035),
                (hw * 0.62, rim_r - 0.008), (hw * 0.80, rim_r - 0.002), (hw * 0.86, rim_r + 0.010),
                (hw * 0.86, rim_r + 0.024), (hw * 0.80, rim_r + 0.020), (hw * 0.76, rim_r + 0.002),
                (hw * 0.70, rim_r - 0.012), (hw * 0.58, rim_r - 0.022)]
    rim = lathe(rim_prof, segs=48, m=M_r, name=name + '_rim')
    parts.append(rim)
    # --- Felgenschüssel mit Löchern (Lathe, dann Löcher löschen, Solidify)
    dx = hw * 0.58
    disc_prof = [(dx, rim_r - 0.022), (dx - 0.012, rim_r - 0.040), (dx - 0.030, 0.172), (dx - 0.034, 0.165),
                 (dx - 0.036, 0.150), (dx - 0.036, 0.135), (dx - 0.036, 0.122), (dx - 0.034, 0.112),
                 (dx - 0.020, 0.100), (dx - 0.006, 0.088), (dx - 0.002, 0.07)]
    dsegs = holes * 6
    disc = lathe(disc_prof, segs=dsegs, m=M_r, name=name + '_disc')
    bm = bmesh.new(); bm.from_mesh(disc.data)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        r = sqrt(c.y ** 2 + c.z ** 2)
        a = (math.atan2(c.z, c.y) / (2 * pi) * dsegs) % dsegs
        if 0.122 < r < 0.165 and (int(a) % 6) in (1, 2, 3):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(disc.data); bm.free()
    mod = disc.modifiers.new('sol', 'SOLIDIFY'); mod.thickness = 0.006; mod.offset = -1
    apply_mods(disc)
    parts.append(disc)
    # --- Nabenkappe / Radmuttern
    if cap:
        cp = [(dx - 0.004, 0.072), (dx + 0.006, 0.07), (dx + 0.018, 0.062), (dx + 0.028, 0.046),
              (dx + 0.033, 0.025), (dx + 0.035, 0.0)]
        parts.append(lathe(cp, segs=32, m=mat(cap), name=name + '_cap'))
        for i in range(6):
            a = 2 * pi * i / 6 + pi / 6
            nut = cyl(0.0105, 0.022, loc=(dx + 0.006, 0.087 * cos(a), 0.087 * sin(a)), rot=(0, pi / 2, 0),
                      segs=6, m=mat('chrome_dull'), name='nut')
            parts.append(nut)
    if hubcap:
        hp = [(hw * 0.84, rim_r + 0.030), (hw * 0.90, rim_r + 0.020), (hw * 0.95, 0.20), (hw * 1.0, 0.17),
              (hw * 1.02, 0.12), (hw * 1.06, 0.10), (hw * 1.07, 0.06), (hw * 1.10, 0.035), (hw * 1.11, 0.0)]
        hc = lathe(hp, segs=48, m=mat(hubcap), name=name + '_hubcap')
        # Rippen
        for v in hc.data.vertices:
            r = sqrt(v.co.y ** 2 + v.co.z ** 2)
            if 0.11 < r < 0.20:
                a = math.atan2(v.co.z, v.co.y)
                v.co.x += 0.006 * max(0.0, cos(a * 8))
        parts.append(hc)
    # --- Bremse (dreht nicht mit – reicht für Standmodell)
    parts.append(cyl(0.165, 0.026, loc=(-0.02, 0, 0), rot=(0, pi / 2, 0), segs=36, m=mat('metal_rusty'), name='disc'))
    parts.append(cyl(0.08, 0.06, loc=(0.02, 0, 0), rot=(0, pi / 2, 0), segs=20, m=mat('metal_rusty'), name='hub'))
    cal = rbox((0.07, 0.10, 0.055), loc=(-0.02, 0.0, 0.15), bevel=0.012, m=mat('plastic_black'), name='cal')
    cal.rotation_euler = Euler((radians(35), 0, 0)); apply_tf(cal)
    parts.append(cal)
    ob = join(parts, name)
    if flat > 0:
        for v in ob.data.vertices:
            if v.co.z < -R + flat:
                bulge = (-R + flat - v.co.z)
                v.co.z = -R + flat - bulge * 0.15
                v.co.x *= 1 + bulge * 1.4
    return ob


# ---------------------------------------------------------------------------------------------
def roof_z(S, y, x=0.0):
    return S.top_z(y, x)


def make_lightbar(S, yc, name='lightbar'):
    """Flacher LED-Lichtbalken. Gibt (gehäuse, linse, module[(name, obj, matkey)]) zurück."""
    L, D, H = 1.26, 0.30, 0.070
    z0 = roof_z(S, yc, 0.0) + 0.045
    parts = []
    base = rbox((L, D, 0.026), loc=(0, yc, z0 + 0.013), bevel=0.010, segs=2, m=mat('plastic_black'), name='lb_base')
    parts.append(base)
    # Endkappen
    for sx in (-1, 1):
        parts.append(rbox((0.035, D - 0.01, 0.06), loc=(sx * (L / 2 - 0.012), yc, z0 + 0.035), bevel=0.012,
                          m=mat('plastic_black'), name='lb_end'))
    # Mittelsteg (Reflektorplatte)
    parts.append(rbox((L - 0.08, 0.012, 0.038), loc=(0, yc, z0 + 0.045), bevel=0.003, m=mat('lamp_housing'),
                      name='lb_mid'))
    # Füße + Halteklammern zur Regenrinne
    for sx in (-1, 1):
        for sy in (-1, 1):
            x = sx * 0.52; y = yc + sy * 0.09
            zt = roof_z(S, y, x)
            parts.append(rbox((0.06, 0.05, z0 - zt + 0.005), loc=(x, y, (z0 + zt) / 2), bevel=0.008,
                              m=mat('rubber_black'), name='lb_foot'))
        # Klammer: dünnes Band über die Dachkante
        y = yc
        pts = []
        for t in np.linspace(0.0, 1.0, 7):
            x = sx * lerp(0.55, S.Wt(y) + 0.03, t)
            pts.append((x, y, roof_z(S, y, x) + 0.004 if t < 0.85 else S.zt(y) - 0.02 * (t - 0.85) / 0.15))
        parts.append(tube_path(pts, 0.006, segs=6, m=mat('metal_powdercoat'), name='lb_strap'))
    housing = join(parts, name)
    lens = rbox((L - 0.06, D - 0.02, 0.048), loc=(0, yc, z0 + 0.048), bevel=0.02, segs=3,
                m=mat('plastic_clear'), name=name + '_lens')
    mods = []
    zm = z0 + 0.045
    mod_me = None
    idx = {'red': 0, 'blue': 0, 'white': 0}

    def module(col, x, y, rotz=0.0):
        nonlocal mod_me
        o = rbox((0.115, 0.022, 0.030), bevel=0.004, segs=1, m=mat('E:lightbar_' + col), name='mod')
        # Reflektor-Rückseite (Chrom) als zweites Material
        back = rbox((0.118, 0.008, 0.033), loc=(0, 0.012, 0), bevel=0.002, segs=1, m=mat('lamp_housing'),
                    name='modb')
        o = join([o, back], 'mod')
        o.rotation_euler = Euler((0, 0, rotz))
        o.location = Vector((x, y, zm))
        apply_tf(o)
        nm = 'LB_%s_%d' % (col, idx[col]); idx[col] += 1
        o.name = nm; o.data.name = nm
        mods.append((nm, o))

    xs = [0.105 + i * 0.128 for i in range(4)]
    # vorn: innen -> außen; Fahrerseite (+X) rot, Beifahrer (-X) blau
    for col, sx in (('red', 1), ('blue', -1)):
        for x in xs:
            module(col, sx * x, yc - 0.075, 0.0)
        module(col, sx * 0.585, yc - 0.06, sx * radians(-55))   # Eckmodul vorn
        module(col, sx * 0.585, yc + 0.06, sx * radians(55) + pi)  # Eckmodul hinten
        for x in reversed(xs):
            module(col, sx * x, yc + 0.075, pi)
    module('white', 0.0, yc - 0.075, 0.0)     # Takedown vorn
    module('white', 0.0, yc + 0.075, pi)      # hinten
    return housing, lens, mods, idx


def make_push_bumper(front_y, name='pushbar'):
    parts = []
    M = mat('metal_powdercoat'); Mr = mat('rubber_black')
    y = front_y - 0.075
    for sx in (-1, 1):
        x = sx * 0.33
        parts.append(rbox((0.065, 0.075, 0.64), loc=(x, y, 0.70), bevel=0.012, m=M, name='pb_up'))
        parts.append(rbox((0.07, 0.03, 0.56), loc=(x, y - 0.048, 0.72), bevel=0.01, m=Mr, name='pb_pad'))
        # Ausleger zum Rahmen
        parts.append(rbox((0.06, 0.34, 0.07), loc=(x, y + 0.17, 0.44), bevel=0.01, m=M, name='pb_arm'))
        parts.append(rbox((0.045, 0.012, 0.06), loc=(x + sx * 0.04, y + 0.02, 0.44), bevel=0.004, m=M, name='pb_tab'))
    parts.append(rbox((0.72, 0.055, 0.065), loc=(0, y + 0.005, 1.00), bevel=0.014, m=M, name='pb_top'))
    parts.append(rbox((0.72, 0.055, 0.06), loc=(0, y + 0.005, 0.54), bevel=0.012, m=M, name='pb_low'))
    parts.append(rbox((0.60, 0.05, 0.05), loc=(0, y + 0.01, 0.78), bevel=0.01, m=M, name='pb_mid'))
    return join(parts, name)


def make_mirror(S, side=1, name='mirror', body_mat='plastic_black_gloss'):
    y = -0.66
    zb = S.zbelt(y)
    xb = S.side_x(y, zb - 0.03)
    parts = []
    hx = xb + 0.155
    arm = rbox((0.15, 0.07, 0.05), loc=(xb + 0.06, y - 0.02, zb + 0.02), bevel=0.018, m=mat(body_mat), name='m_arm')
    parts.append(arm)
    house = rbox((0.20, 0.11, 0.16), loc=(hx, y, zb + 0.085), bevel=0.045, segs=3, m=mat(body_mat), name='m_h')
    # Front gerundet stärker: leicht nach vorn verjüngen
    for v in house.data.vertices:
        if v.co.y < y:
            f = (y - v.co.y) / 0.055
            v.co.z = zb + 0.085 + (v.co.z - zb - 0.085) * (1 - 0.15 * f)
    parts.append(house)
    parts.append(rbox((0.172, 0.006, 0.128), loc=(hx + 0.002, y + 0.053, zb + 0.085), bevel=0.012, segs=2,
                      m=mat('mirror'), name='m_glass'))
    # Blinker-Streifen an der Unterseite
    parts.append(rbox((0.12, 0.03, 0.006), loc=(hx + 0.02, y - 0.03, zb + 0.006), bevel=0.002, m=mat('lens_amber'),
                      name='m_turn'))
    ob = join(parts, name)
    if side < 0:
        o2 = mirror_x(ob, name)
        remove(ob)
        ob = o2
    return ob


def make_handle(S, y, z, side=1, name='handle'):
    x = S.side_x(y, z)
    h = rbox((0.032, 0.17, 0.034), loc=(x + 0.012, y, z), bevel=0.012, segs=2, m=mat('plastic_black_gloss'), name=name)
    # Griffmulde (dunkel) dahinter
    cup = rbox((0.012, 0.13, 0.05), loc=(x - 0.0, y, z), bevel=0.004, m=mat('plastic_black'), name='cup')
    ob = join([h, cup], name)
    if side < 0:
        o2 = mirror_x(ob, name); remove(ob); ob = o2
    return ob


def make_wipers(S, y_base):
    parts = []
    for (xa, xb_, dy) in ((0.62, -0.04, 0.0), (-0.06, -0.74, 0.03)):
        pts = []
        for t in np.linspace(0, 1, 9):
            x = lerp(xa, xb_, t)
            y = y_base + 0.06 + dy + 0.02 * sin(t * pi)
            pts.append((x, y, S.top_z(y, x) + 0.010))
        parts.append(tube_path(pts, 0.0065, segs=6, m=mat('rubber_black'), name='wb'))
        # Arm: vom Drehpunkt (unten) zur Blattmitte
        xm = (xa + xb_) / 2
        piv = (xa - 0.05 * (1 if xa > 0 else -1), y_base - 0.02, S.top_z(y_base - 0.02, xa) + 0.02)
        mid = (xm, y_base + 0.07 + dy, S.top_z(y_base + 0.07 + dy, xm) + 0.022)
        parts.append(tube_path([piv, mid], 0.0055, segs=6, m=mat('plastic_black'), name='wa'))
        parts.append(cyl(0.016, 0.02, loc=piv, segs=10, m=mat('plastic_black'), name='wp'))
    # Windlauf-Abdeckung (Kunststoffgitter) als dunkles Band
    pts = []
    return join(parts, 'wipers')


def make_antennas(S):
    parts = []
    for (x, y, Ln, bend) in ((0.0, 1.05, 0.70, 0.06), (0.30, 1.55, 0.42, 0.03), (-0.30, 1.55, 0.42, 0.03)):
        z = S.top_z(y, x)
        parts.append(cyl(0.016, 0.012, loc=(x, y, z + 0.006), segs=12, m=mat('plastic_black'), name='ab'))
        parts.append(cyl(0.008, 0.045, loc=(x, y, z + 0.034), segs=8, m=mat('chrome_dull'), name='as'))
        pts = [(x, y + bend * (t ** 2), z + 0.055 + Ln * t) for t in np.linspace(0, 1, 6)]
        parts.append(tube_path(pts, 0.0022, segs=5, m=mat('chrome_dull'), name='aw'))
    for (x, y) in ((-0.32, 0.55), (0.32, 0.55), (0.0, 1.75)):
        z = S.top_z(y, x)
        parts.append(lathe([(0.0, 0.048), (0.006, 0.046), (0.014, 0.038), (0.020, 0.024), (0.024, 0.0)], segs=20,
                           m=mat('plastic_black'), name='puck'))
        o = parts[-1]
        o.rotation_euler = Euler((0, -pi / 2, 0)); o.location = Vector((x, y, z - 0.002)); apply_tf(o)
    return join(parts, 'antennas')


def make_spotlight(S, side=1):
    y = -0.70
    zb = S.zbelt(y)
    k = S.kfac(y)
    h = S.half(y)
    # Punkt auf der A-Säule (Kontrollpunkt c9 der Station)
    px, pz = h[CSTART[9]]
    parts = []
    lx = px + 0.11; lz = pz - 0.05
    body = cyl(0.068, 0.15, loc=(lx, y - 0.02, lz), rot=(pi / 2, 0, 0), segs=24, m=mat('chrome'), name='sp_b', bevel=0.01)
    back = lathe([(0.0, 0.068), (0.025, 0.06), (0.045, 0.035), (0.052, 0.0)], segs=24, m=mat('chrome'), name='sp_back')
    back.rotation_euler = Euler((0, 0, -pi / 2)); back.location = Vector((lx, y + 0.055, lz)); apply_tf(back)
    lens = cyl(0.060, 0.008, loc=(lx, y - 0.097, lz), rot=(pi / 2, 0, 0), segs=24, m=mat('E:spotlight'), name='sp_l')
    ring = lathe([(0.0, 0.07), (0.006, 0.069), (0.008, 0.061)], segs=24, m=mat('chrome'), name='sp_ring')
    ring.rotation_euler = Euler((0, 0, -pi / 2)); ring.location = Vector((lx, y - 0.095, lz)); apply_tf(ring)
    yoke = rbox((0.10, 0.03, 0.025), loc=((px + lx) / 2 + 0.01, y + 0.02, lz - 0.065), bevel=0.008,
                m=mat('chrome_dull'), name='sp_y')
    shaft = tube_path([(px - 0.01, y + 0.03, lz - 0.06), (lx, y + 0.03, lz - 0.065), (lx, y + 0.01, lz - 0.04)],
                      0.011, segs=8, m=mat('chrome_dull'), name='sp_s')
    parts += [body, back, lens, ring, yoke, shaft]
    ob = join(parts, 'spotlight')
    if side < 0:
        o2 = mirror_x(ob, 'spotlight'); remove(ob); ob = o2
    return ob


def make_plate(loc, rot_z=0.0, key='MU_plate_police', name='plate'):
    """Kennzeichen 305x152 mm; Vorderseite zeigt nach -Y (vor Rotation). UV 0..1 auf der Vorderseite."""
    pl = rbox((0.305, 0.004, 0.152), bevel=0.0015, segs=1, m=mat('aluminium'), name=name)
    face = bpy.data.meshes.new(name + '_f')
    w, h = 0.300, 0.148
    face.from_pydata([(-w / 2, -0.0024, -h / 2), (w / 2, -0.0024, -h / 2), (w / 2, -0.0024, h / 2), (-w / 2, -0.0024, h / 2)],
                     [], [(0, 1, 2, 3)])
    face.update()
    fo = new_obj(name + '_f', face)
    fo.data.materials.append(mat(key))
    uv = face.uv_layers.new(name='UVMap')
    for i, (u, v) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = (u, v)
    # Normale nach -Y
    if face.polygons[0].normal.y > 0:
        face.flip_normals()
        for i, (u, v) in enumerate([(0, 0), (0, 1), (1, 1), (1, 0)]):
            uv.data[i].uv = (u, v)
    box_uv(pl)
    ob = join([pl, fo], name)
    ob.rotation_euler = Euler((0, 0, rot_z)); ob.location = Vector(loc); apply_tf(ob)
    return ob


def make_arch_lips(S, axles, track_r, z_c, r_arch, name='archlips', m='plastic_black', width=0.038):
    """Radlauf-Leisten: Bogen um den Boolean-Ausschnitt."""
    parts = []
    for ya in axles:
        for sx in (-1, 1):
            verts, faces = [], []
            n = 40
            a0, a1 = radians(-8), radians(188)
            rows = []
            for i in range(n + 1):
                a = a0 + (a1 - a0) * i / n
                cy, cz = cos(a), sin(a)
                z = z_c + r_arch * cz
                y = ya - r_arch * cy
                xs = S.side_x(y, max(z, S.zb(y) + 0.04))
                prof = [(-0.020, -0.004), (0.004, 0.002), (0.012, 0.012), (0.010, width * 0.6),
                        (0.002, width), (-0.012, width + 0.002)]
                ring = []
                for (dx, dr) in prof:
                    rr = r_arch + dr
                    ring.append((sx * (xs + dx), ya - rr * cy, z_c + rr * cz))
                rows.append(ring)
            for ring in rows:
                verts += ring
            k = len(rows[0])
            for i in range(n):
                for j in range(k - 1):
                    a = i * k + j
                    faces.append((a, a + 1, a + k + 1, a + k) if sx > 0 else (a, a + k, a + k + 1, a + 1))
            me = bpy.data.meshes.new('lip')
            me.from_pydata(verts, [], faces); me.update()
            o = new_obj('lip', me); o.data.materials.append(mat(m))
            parts.append(o)
    ob = join(parts, name)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    return ob


def make_grille_mesh(x0, x1, z0, z1, y, pitch=0.034, bar=0.007, depth=0.012, name='grille'):
    """Rautengitter aus diagonalen Stäben, auf Rechteck geclippt."""
    parts = []
    M = mat('plastic_black_gloss')
    w = x1 - x0; h = z1 - z0
    for sgn in (1, -1):
        c = -h
        while c < w + h:
            # Linie: x = x0 + c + sgn*t*..., z = z0 + t
            pa = Vector((x0 + c, z0)); pb = Vector((x0 + c + sgn * h, z1))
            # clip an x0..x1
            def clip(p, q):
                pts = []
                for (P, Q) in ((p, q),):
                    t0, t1 = 0.0, 1.0
                    d = Q - P
                    for (pv, dv, lo, hi) in ((P.x, d.x, x0, x1),):
                        if abs(dv) < 1e-9:
                            if pv < lo or pv > hi:
                                return None
                        else:
                            ta = (lo - pv) / dv; tb = (hi - pv) / dv
                            if ta > tb:
                                ta, tb = tb, ta
                            t0 = max(t0, ta); t1 = min(t1, tb)
                    if t1 - t0 < 1e-3:
                        return None
                    return P + d * t0, P + d * t1
            r = clip(pa, pb)
            if r:
                A, B = r
                mid = (A + B) / 2
                ln = (B - A).length
                ang = math.atan2((B - A).y, (B - A).x)
                o = rbox((ln, depth, bar), loc=(mid.x, y, mid.y), rot=(0, -ang, 0), bevel=0.002, segs=1, m=M, name='gb')
                parts.append(o)
            c += pitch
    # Rahmen
    for (cx, cz, sx_, sz_) in (((x0 + x1) / 2, z0, w, 0.012), ((x0 + x1) / 2, z1, w, 0.012),
                                (x0, (z0 + z1) / 2, 0.012, h), (x1, (z0 + z1) / 2, 0.012, h)):
        parts.append(rbox((sx_, depth + 0.004, sz_), loc=(cx, y, cz), bevel=0.003, m=M, name='gf'))
    return join(parts, name)


# ---------------------------------------------------------------------------------------------
# Innenraum
def make_seat(x, y, z, w=0.50, fabric='fabric_seat', name='seat', recline=14, bench=False, torn=False):
    M = mat(fabric)
    parts = []
    cush = rbox((w, 0.52, 0.12), loc=(x, y, z), bevel=0.045, segs=3, m=M, name='s_c')
    # Seitenwangen
    if not bench:
        for sx in (-1, 1):
            parts.append(rbox((0.07, 0.48, 0.07), loc=(x + sx * (w / 2 - 0.035), y + 0.01, z + 0.06), bevel=0.03, segs=2,
                              m=M, name='s_b'))
    parts.append(cush)
    back = rbox((w, 0.13, 0.62), loc=(0, 0, 0.31), bevel=0.05, segs=3, m=M, name='s_r')
    back.rotation_euler = Euler((radians(-recline), 0, 0)); back.location = Vector((x, y + 0.26, z + 0.03)); apply_tf(back)
    parts.append(back)
    if not bench:
        for sx in (-1, 1):
            wing = rbox((0.07, 0.15, 0.45), loc=(0, 0, 0.25), bevel=0.03, segs=2, m=M, name='s_w')
            wing.rotation_euler = Euler((radians(-recline), 0, 0))
            wing.location = Vector((x + sx * (w / 2 - 0.03), y + 0.24, z + 0.05)); apply_tf(wing)
            parts.append(wing)
        hr = rbox((0.26, 0.09, 0.19), loc=(0, 0, 0.0), bevel=0.04, segs=3, m=M, name='s_h')
        a = radians(recline)
        hr.rotation_euler = Euler((-a, 0, 0))
        hr.location = Vector((x, y + 0.26 + 0.72 * sin(a) + 0.02, z + 0.03 + 0.72 * cos(a))); apply_tf(hr)
        parts.append(hr)
        for sx in (-1, 1):
            parts.append(cyl(0.006, 0.08, loc=(x + sx * 0.07, y + 0.26 + 0.64 * sin(a), z + 0.03 + 0.64 * cos(a)),
                             segs=6, m=mat('chrome_dull'), name='s_hp'))
    parts.append(rbox((w - 0.1, 0.40, 0.10), loc=(x, y, z - 0.10), bevel=0.01, m=mat('plastic_black'), name='s_base'))
    ob = join(parts, name)
    if torn:
        # Polsterung quillt heraus: Beule auf der Sitzfläche
        for v in ob.data.vertices:
            d = (Vector((v.co.x, v.co.y)) - Vector((x + 0.08, y - 0.05))).length
            if v.co.z > z + 0.03 and d < 0.09:
                v.co.z += 0.025 * (1 - d / 0.09)
    return ob


def make_steering(x, y, z, tilt=25, name='steering'):
    parts = []
    M = mat('plastic_black'); Mg = mat('vinyl_seat_black')
    pts = [(0.19 * cos(a), 0.0, 0.19 * sin(a)) for a in np.linspace(0, 2 * pi, 33)]
    parts.append(tube_path(pts, 0.017, segs=8, m=Mg, name='sw_r', cap=False))
    parts.append(rbox((0.12, 0.05, 0.10), loc=(0, 0.01, -0.01), bevel=0.02, segs=2, m=M, name='sw_hub'))
    for a in (pi, 0.0, -pi / 2):
        p = Vector((0.19 * cos(a), 0, 0.19 * sin(a)))
        parts.append(tube_path([(0, 0.01, 0), (p.x * 0.92, 0.0, p.z * 0.92)], 0.016, segs=6, m=M, name='sw_s'))
    parts.append(cyl(0.032, 0.30, loc=(0, 0.16, 0), rot=(pi / 2, 0, 0), segs=12, m=M, name='sw_col'))
    ob = join(parts, name)
    ob.rotation_euler = Euler((radians(-tilt), 0, 0)); ob.location = Vector((x, y, z)); apply_tf(ob)
    return ob


def make_laptop(x, y, z, rotz=-28, name='laptop'):
    parts = []
    M = mat('plastic_grey_dark')
    parts.append(rbox((0.31, 0.25, 0.035), loc=(0, 0, 0.0175), bevel=0.008, m=M, name='lt_base'))
    parts.append(rbox((0.27, 0.12, 0.004), loc=(0, -0.03, 0.036), bevel=0.001, m=mat('plastic_black'), name='lt_kb'))
    lid = rbox((0.31, 0.022, 0.225), loc=(0, 0, 0.1125), bevel=0.008, m=M, name='lt_lid')
    scr = bpy.data.meshes.new('lt_scr')
    w, h = 0.27, 0.17
    scr.from_pydata([(-w / 2, -0.0115, 0.11 - h / 2), (w / 2, -0.0115, 0.11 - h / 2), (w / 2, -0.0115, 0.11 + h / 2),
                     (-w / 2, -0.0115, 0.11 + h / 2)], [], [(0, 3, 2, 1)])
    scr.update()
    so = new_obj('lt_scr', scr)
    so.data.materials.append(mat('E:screen_mdt'))
    uv = scr.uv_layers.new(name='UVMap')
    for i, uvv in enumerate([(0, 0), (0, 1), (1, 1), (1, 0)]):
        uv.data[i].uv = uvv
    if scr.polygons[0].normal.y > 0:
        scr.flip_normals()
    lid_o = join([lid, so], 'lt_lidj')
    lid_o.rotation_euler = Euler((radians(-12), 0, 0)); lid_o.location = Vector((0, 0.12, 0.03)); apply_tf(lid_o)
    parts.append(lid_o)
    ob = join(parts, name)
    ob.rotation_euler = Euler((0, 0, radians(rotz))); ob.location = Vector((x, y, z)); apply_tf(ob)
    return ob
