# Flaschen, Dosen, Zeitungen/Papier, Plastiktüte, Spritze

def bottle_lathe(name, outer, wall, mat, seg=20):
    """outer: Profil (r,z) von Boden-Mitte bis Mündung. Innenprofil = nach innen versetzt, zurück nach unten."""
    inner = []
    for (r, z) in reversed(outer[1:]):
        inner.append((max(0.0, r - wall), z if z > outer[-1][1] - 1e-6 else max(z, wall * 1.2)))
    inner[-1] = (0.0, outer[0][1] + wall)
    prof = list(outer) + inner
    # doppelte Mündungspunkte vermeiden
    return lathe(name, prof, mat, seg=seg)


BEER = [(0.0, 0.006), (0.012, 0.003), (0.024, 0.0), (0.0295, 0.002), (0.031, 0.008), (0.031, 0.122), (0.0298, 0.135),
        (0.025, 0.152), (0.018, 0.17), (0.0135, 0.188), (0.0125, 0.205), (0.0125, 0.222), (0.0138, 0.225),
        (0.0138, 0.231), (0.0128, 0.234)]


def beer_bottle(name, seed, label=True, mat='glass_brown'):
    rnd = random.Random(seed)
    ob = bottle_lathe('_bb', BEER, 0.0028, mat, seg=20)
    parts = [ob]
    if label:
        a_c = -pi / 2 + rnd.uniform(-0.3, 0.3)
        span = radians(150)
        def rfn(a, z):
            # Etikett liegt 0,4 mm über dem Glas; eine Ecke löst sich
            lift = 0.0035 * smoothstep(0.6, 1.0, (a - (a_c - span / 2)) / span) * smoothstep(0.075, 0.105, z)
            return 0.0314 + lift
        lab = cyl_patch('_lab', a_c - span / 2, a_c + span / 2, 0.035, 0.105, 10, 3, rfn, 'MU_beer_label')
        parts.append(lab)
    return parts


@prop('bottle_beer', 'glass', 'Küche, Wohnzimmer, Veranda',
      'Leere braune Bierflasche (Longneck, 23 cm), Papieretikett (MU_beer_label) halb abgelöst. Stehend.')
def p_bottle_beer():
    ob = join(beer_bottle('bottle_beer', 1), 'bottle_beer')
    smooth(ob, 50)
    return finalize(ob, 'bottle_beer', 'glass', ao=dict(rays=10, dist=0.05, strength=0.5, grime=0.25, floor_dirt=0.2), seed=1)


@prop('bottle_beer_lying', 'glass', 'überall auf dem Boden',
      'Leere braune Bierflasche, liegend, Etikett abgerissen (nur Papierrest).')
def p_bottle_beer_lying():
    parts = beer_bottle('bottle_beer_lying', 2, label=False)
    scrap = cyl_patch('_scrap', -pi / 2 - 0.4, -pi / 2 + 0.1, 0.05, 0.075, 4, 2, lambda a, z: 0.0314, 'paper_white')
    parts.append(scrap)
    ob = join(parts, 'bottle_beer_lying')
    place(ob, (0, 0, 0), (0, 90, 17))
    # Hals liegt etwas höher (rund) -> leichte Neigung um Y
    smooth(ob, 50)
    return finalize(ob, 'bottle_beer_lying', 'glass', ao=dict(rays=10, dist=0.05, strength=0.5, grime=0.3, floor_dirt=0.2), seed=2)


@prop('bottle_wine', 'glass', 'Küche, Wohnzimmer',
      'Leere grüne Weinflasche (30 cm), liegend, mit tiefer Bodenwölbung, Etikettreste.')
def p_bottle_wine():
    prof = [(0.0, 0.03), (0.012, 0.026), (0.022, 0.012), (0.03, 0.003), (0.0355, 0.0), (0.0375, 0.006), (0.0375, 0.19),
            (0.034, 0.213), (0.024, 0.232), (0.016, 0.248), (0.0135, 0.262), (0.0135, 0.288), (0.0152, 0.29), (0.0152, 0.3),
            (0.0128, 0.301)]
    ob = bottle_lathe('_wb', prof, 0.003, 'glass_green', seg=22)
    scrap = cyl_patch('_scrap', -pi / 2 - 0.6, -pi / 2 + 0.3, 0.07, 0.11, 5, 2, lambda a, z: 0.0379, 'paper_white')
    ob = join([ob, scrap], 'bottle_wine')
    place(ob, (0, 0, 0), (0, 90, -24))
    smooth(ob, 50)
    return finalize(ob, 'bottle_wine', 'glass', ao=dict(rays=10, dist=0.05, strength=0.5, grime=0.3, floor_dirt=0.2), seed=3)


@prop('bottle_liquor', 'glass', 'Schlafzimmer, Wohnzimmer',
      'Flache Schnapsflasche (Taschenflasche, klar, schmutzig) mit Schraubverschluss, stehend.')
def p_bottle_liquor():
    prof = [(0.0, 0.002), (0.04, 0.0), (0.048, 0.006), (0.05, 0.02), (0.05, 0.12), (0.046, 0.135), (0.03, 0.15),
            (0.014, 0.158), (0.0125, 0.163), (0.0125, 0.178)]
    ob = bottle_lathe('_lq', prof, 0.003, 'glass', seg=24)
    for v in ob.data.vertices:
        if v.co.z < 0.155:
            k = smoothstep(0.158, 0.13, v.co.z)
            v.co.y *= lerp(1.0, 0.42, k)
            v.co.x *= lerp(1.0, 0.95, k)
    cap = cyl('_cap', 0.0145, 0.02, 'metal_cap', seg=16, loc=(0, 0, 0.176), bevel=0.0012)
    # Riffelung
    for v in cap.data.vertices:
        a = math.atan2(v.co.y, v.co.x)
        rr = math.hypot(v.co.x, v.co.y)
        if rr > 0.013:
            f = 1 + 0.03 * cos(a * 16)
            v.co.x *= f; v.co.y *= f
    ob = join([ob, cap], 'bottle_liquor')
    smooth(ob, 50)
    return finalize(ob, 'bottle_liquor', 'glass', ao=dict(rays=10, dist=0.05, strength=0.5, grime=0.3, floor_dirt=0.2), seed=4)


@prop('bottle_broken', 'glass', 'Küche, Flur, Veranda',
      'Abgebrochene braune Flasche (unterer Teil mit gezackter Bruchkante) + Scherben am Boden.')
def p_bottle_broken():
    rnd = random.Random(7)
    outer = [p for p in BEER if p[1] <= 0.01] + [(0.031, 0.03), (0.031, 0.05), (0.031, 0.07), (0.031, 0.13)]
    ob = bottle_lathe('_bk', outer, 0.0028, 'glass_brown', seg=32)
    # gezackte Bruchkante: obere Ringe je Winkel stark variieren (Zacken + Spitze)
    for v in ob.data.vertices:
        if v.co.z > 0.1:
            a = math.atan2(v.co.y, v.co.x)
            j = (noise.noise(Vector((cos(a) * 3.0, sin(a) * 3.0, 0.3))) * 0.5 + 0.5)
            spike = max(0.0, 1 - abs(((a + 1.2) % (2 * pi)) - pi) / 0.5)
            saw = abs(((a * 7 / pi) % 2) - 1)
            v.co.z = 0.075 + 0.03 * j + 0.012 * saw + 0.05 * spike
    ob.data.update()
    parts = [ob]
    # Scherben: gebogene Glasplättchen
    for i in range(7):
        n = 3 if rnd.random() < 0.6 else 4
        r0 = rnd.uniform(0.01, 0.028)
        outl = []
        for k in range(n):
            a = 2 * pi * k / n + rnd.uniform(-0.3, 0.3)
            outl.append((cos(a) * r0 * rnd.uniform(0.6, 1.2), sin(a) * r0 * rnd.uniform(0.5, 1.0)))
        sh = mesh_obj('_sh', bm_poly_slab(outl, 0.0028), 'glass_brown')
        for v in sh.data.vertices:
            v.co.z += (v.co.x ** 2) / (2 * 0.031)
        d = rnd.uniform(0.06, 0.16)
        a = rnd.uniform(-2.6, -0.5)
        place(sh, (cos(a) * d, sin(a) * d, 0), (0, 0, rnd.uniform(0, 360)))
        parts.append(sh)
    ob = join(parts, 'bottle_broken')
    smooth(ob, 45)
    return finalize(ob, 'bottle_broken', 'glass', ao=dict(rays=10, dist=0.05, strength=0.5, grime=0.35, floor_dirt=0.2), seed=7)


# ---------------------------------------------------------------- Dosen
def can_parts(seed):
    R = 0.033
    body = cyl_patch('_cb', 0, 2 * pi, 0.012, 0.108, 24, 16, lambda a, z: R, 'MU_can_label')
    low = lathe('_cl', [(0.0, 0.011), (0.016, 0.007), (0.024, 0.002), (0.027, 0.0), (0.031, 0.004), (R, 0.012)], 'aluminium', seg=24)
    up = lathe('_cu', [(R, 0.108), (0.031, 0.114), (0.0285, 0.1185), (0.0292, 0.1215), (0.0284, 0.1225), (0.027, 0.121),
                       (0.0262, 0.1175), (0.0, 0.1175)], 'aluminium', seg=24)
    tab = box('_tab', 0.012, 0.02, 0.0012, 'aluminium', loc=(0, -0.008, 0.1185), bevel=0.0004)
    ob = join([body, low, up, tab], '_can')
    remove_doubles(ob, 0.0004)
    return ob


@prop('can_crushed_a', 'metal', 'überall',
      'Getränkedose (MU_can_label, generische Marke), axial zusammengestaucht mit Knickfalten, schief.')
def p_can_crushed_a():
    ob = can_parts(1)
    off = Vector((1.7, 2.3, 0))
    for v in ob.data.vertices:
        co = v.co
        a = math.atan2(co.y, co.x)
        z = co.z
        if 0.012 < z < 0.112:
            zn = (z - 0.012) / 0.1
            # Knickfalten (Rauten) und Stauchung
            fold = sin(zn * pi * 4 + 3 * a) * 0.5 + 0.5 * sin(zn * pi * 3 - 2 * a + 1)
            k = 1 + 0.16 * fold * sin(pi * zn)
            co.x *= k; co.y *= k
            co.z = 0.012 + (z - 0.012) * 0.55 + 0.004 * noise.noise(co * 80 + off)
        elif z >= 0.112:
            co.z = z - 0.045
        co.x += (co.z) * 0.18  # schräg
    ob.data.update()
    ob.name = 'can_crushed_a'
    smooth(ob, 60)
    return finalize(ob, 'can_crushed_a', 'metal', ao=dict(rays=10, dist=0.04, strength=0.5, grime=0.3, floor_dirt=0.3), seed=8)


@prop('can_crushed_b', 'metal', 'überall, draußen auf der Straße',
      'Plattgetretene Dose, liegend, Mitte flach, Enden aufgeworfen.')
def p_can_crushed_b():
    ob = can_parts(2)
    place(ob, (0, 0.061, 0), (90, 0, 0))  # Achse jetzt entlang Y, Mitte im Ursprung
    off = Vector((5.1, 0.3, 0))
    for v in ob.data.vertices:
        co = v.co
        t = abs(co.y) / 0.061
        flat = lerp(0.22, 0.7, t ** 3)
        co.z *= flat
        co.x *= lerp(1.45, 1.05, t ** 2)
        co.z += 0.004 * noise.noise(co * 60 + off) + 0.006 * (co.y / 0.061) ** 2
        co += nvec(co * 40 + off) * 0.0015
    ob.data.update()
    place(ob, (0, 0, 0), (0, 0, 35))
    ob.name = 'can_crushed_b'
    smooth(ob, 60)
    return finalize(ob, 'can_crushed_b', 'metal', ao=dict(rays=10, dist=0.04, strength=0.5, grime=0.35, floor_dirt=0.2), seed=9)


@prop('can_dented', 'metal', 'überall',
      'Liegende Dose mit seitlicher Delle (nicht zerdrückt).')
def p_can_dented():
    ob = can_parts(3)
    dent(ob, (0.03, -0.012, 0.07), 0.03, 0.009)
    dent(ob, (-0.025, 0.02, 0.03), 0.02, 0.004)
    place(ob, (0, 0, 0), (90, 0, 70))
    ob.name = 'can_dented'
    smooth(ob, 60)
    return finalize(ob, 'can_dented', 'metal', ao=dict(rays=10, dist=0.04, strength=0.5, grime=0.25, floor_dirt=0.2), seed=10)


# ---------------------------------------------------------------- Papier
def paper_sheet(name, sx, sy, mat, seed, curl=0.02, crumple=0.004, nx=8, ny=10, fold=None):
    sh = plane_patch(name, sx, sy, nx, ny, mat)
    off = Vector((seed * 1.9, seed * 0.7, 0))
    rnd = random.Random(seed)
    cdir = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)).normalized()
    for v in sh.data.vertices:
        co = v.co
        e = min(sx / 2 - abs(co.x), sy / 2 - abs(co.y))
        z = curl * smoothstep(0.06, 0.0, e) * (0.5 + 0.5 * noise.noise(co * 6 + off))
        z += curl * 0.6 * max(0.0, co.dot(cdir) / (0.5 * max(sx, sy))) ** 2
        z += crumple * (noise.noise(co * 18 + off) * 0.5 + 0.5)
        if fold:
            z += fold * max(0.0, 1 - abs(co.x) / 0.02)
        co.z = z
    sh.data.update()
    return sh


@prop('newspaper_stack', 'cardboard', 'Garage, Wohnzimmer, Veranda',
      'Gebündelter Zeitungsstapel (≈22 Ausgaben), mit Schnur kreuzweise, oberste Zeitung bedruckt (MU_newspaper), Ränder gewellt.')
def p_newspaper_stack():
    rnd = random.Random(21)
    parts = []
    z = 0.0
    sx, sy = 0.29, 0.38
    for i in range(22):
        th = rnd.uniform(0.0055, 0.0075)
        top = (i == 21)
        b = box('_np', sx, sy, th, 'paper_news', bevel=0.002, cuts=0)
        if top:
            lab = plane_patch('_npt', sx * 0.995, sy * 0.995, 6, 8, 'MU_newspaper')
            place(lab, (0, 0, th / 2 + 0.0004))
            b = join([b, lab], '_np')
        place(b, (rnd.uniform(-0.008, 0.008), rnd.uniform(-0.008, 0.008), z + th / 2), (0, 0, rnd.uniform(-3, 3)))
        z += th
        parts.append(b)
    ob = join(parts, '_ns')
    off = Vector((2, 3, 0))
    for v in ob.data.vertices:
        e = min(sx / 2 - abs(v.co.x), sy / 2 - abs(v.co.y))
        v.co.z += 0.004 * smoothstep(0.05, 0.0, e) * noise.noise(v.co * 10 + off) + 0.003 * noise.noise(v.co * 3 + off)
    ob.data.update()
    # Schnur kreuzweise (eingeschnürt)
    H = z
    for ax in (0, 1):
        L = (sx if ax == 0 else sy) / 2 + 0.004
        pts = []
        for k in range(13):
            tt = -1 + 2 * k / 12
            pts.append((L * tt, 0, H + 0.002 - 0.006 * (1 - tt * tt)))
        pts = [(-L, 0, 0.006), (-L - 0.002, 0, H * 0.5)] + pts + [(L + 0.002, 0, H * 0.5), (L, 0, 0.006)]
        if ax == 1:
            pts = [(0, p[0], p[2]) for p in pts]
        parts2 = tube_curve('_tw', pts, 0.0018, 'paper_news' if False else 'rope_twine', sides=5, n=2)
        ob = join([ob, parts2], '_ns')
    ob.name = 'newspaper_stack'
    smooth(ob, 45)
    return finalize(ob, 'newspaper_stack', 'cardboard', ao=dict(rays=14, dist=0.06, strength=0.75, grime=0.3, floor_dirt=0.3), seed=21)


@prop('paper_pile', 'cardboard', 'Wohnzimmer, Küche, Arbeitszimmer',
      'Unordentlicher Papierstapel: Briefe (MU_paper_letter), Zeitungsseiten, Umschläge, verrutscht und gewellt.')
def p_paper_pile():
    rnd = random.Random(23)
    parts = []
    z = 0.0
    for i in range(16):
        k = rnd.random()
        if k < 0.45:
            sh = paper_sheet('_s', 0.216, 0.279, 'MU_paper_letter', 100 + i, curl=0.01, crumple=0.002)
        elif k < 0.75:
            sh = paper_sheet('_s', 0.29, 0.38, 'MU_newspaper', 100 + i, curl=0.012, crumple=0.003)
        else:
            sh = paper_sheet('_s', 0.24, 0.105, 'paper_white', 100 + i, curl=0.004, crumple=0.001, nx=4, ny=2)
        place(sh, (rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), z), (0, 0, rnd.uniform(-25, 25)))
        z += 0.0022
        parts.append(sh)
    ob = join(parts, 'paper_pile')
    smooth(ob, 60)
    return finalize(ob, 'paper_pile', 'cardboard', ao=dict(rays=12, dist=0.04, strength=0.7, grime=0.2, floor_dirt=0.0), seed=23)


def loose(name, seed, n=5):
    rnd = random.Random(seed)
    parts = []
    for i in range(n):
        k = rnd.random()
        if k < 0.55:
            sh = paper_sheet('_s', 0.216, 0.279, 'MU_paper_letter', seed + i, curl=rnd.uniform(0.01, 0.035),
                             crumple=rnd.uniform(0.002, 0.008))
        else:
            sh = paper_sheet('_s', 0.29, 0.38, 'MU_newspaper', seed + i, curl=rnd.uniform(0.01, 0.03),
                             crumple=rnd.uniform(0.003, 0.01), fold=0.006)
        d = rnd.uniform(0.0, 0.35)
        a = rnd.uniform(0, 2 * pi)
        place(sh, (cos(a) * d, sin(a) * d, i * 0.0015), (0, 0, rnd.uniform(0, 360)))
        parts.append(sh)
    for i in range(rnd.randint(1, 3)):
        b = crumple_ball('_pb', rnd.uniform(0.03, 0.05), rnd.choice(['paper_white', 'paper_news']), seed=seed + 30 + i)
        d = rnd.uniform(0.2, 0.45); a = rnd.uniform(0, 2 * pi)
        place(b, (cos(a) * d, sin(a) * d, 0.03), (0, 0, 0), (1, 1, 0.8))
        parts.append(b)
    ob = join(parts, name)
    ground_clamp(ob, 0.0)
    smooth(ob, 60)
    return ob


@prop('papers_loose_a', 'cardboard', 'überall auf dem Boden',
      'Verstreute lose Blätter (Mahnungen, Zeitungsseiten) mit Knicken/Wellen + Papierknäuel. Einseitige Flächen (doubleSided).')
def p_papers_loose_a():
    ob = loose('papers_loose_a', 300, 5)
    return finalize(ob, 'papers_loose_a', 'cardboard', ao=dict(rays=10, dist=0.04, strength=0.6, grime=0.15, floor_dirt=0.0), seed=31)


@prop('papers_loose_b', 'cardboard', 'überall auf dem Boden',
      'Zweite Variante loser Blätter (andere Verteilung).')
def p_papers_loose_b():
    ob = loose('papers_loose_b', 400, 4)
    return finalize(ob, 'papers_loose_b', 'cardboard', ao=dict(rays=10, dist=0.04, strength=0.6, grime=0.15, floor_dirt=0.0), seed=32)


# ---------------------------------------------------------------- Plastiktüte
@prop('plastic_bag', 'fabric', 'überall, Küche, Hof',
      'Zerknüllte, platt gefallene Einkaufstüte (dünnes graues Plastik) mit Henkeln. Tuchsimulation.')
def p_plastic_bag():
    rnd = random.Random(55)
    W, H = 0.28, 0.42
    # flacher Schlauch: Vorder-/Rückseite als Gitter, Henkel-Ausschnitt oben
    bm = bmesh.new()
    nx, nz = 14, 22
    grid = {}
    for side in (0, 1):
        for j in range(nz + 1):
            for i in range(nx + 1):
                x = (i / nx - 0.5) * W
                z = j / nz * (H + 0.12)
                if z > H and 0.22 * W < abs(x) + 0 < 0.38 * W:
                    pass
                y = (-0.02 if side == 0 else 0.02) * sin(pi * i / nx)
                grid[(side, i, j)] = bm.verts.new((x, y, z))
    for side in (0, 1):
        for j in range(nz):
            for i in range(nx):
                zc = (j + 0.5) / nz * (H + 0.12)
                xc = ((i + 0.5) / nx - 0.5) * W
                if zc > H and not (0.25 * W < abs(xc) < 0.45 * W):
                    continue  # Henkel bleiben stehen
                vs = [grid[(side, i, j)], grid[(side, i + 1, j)], grid[(side, i + 1, j + 1)], grid[(side, i, j + 1)]]
                bm.faces.new(vs if side == 0 else vs[::-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # Seiten + Boden verbinden: Kanten x=±W/2 und z=0 sind in beiden Seiten gleich -> verschweißen
    for v in bm.verts:
        if abs(abs(v.co.x) - W / 2) < 1e-4 or v.co.z < 1e-4:
            v.co.y = 0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    ob = mesh_obj('_pbag', bm, 'plastic_bag_white')
    # zufällig zerknüllt in der Luft, dann fallen lassen
    for v in ob.data.vertices:
        v.co += nvec(v.co * 7 + Vector((3, 1, 0))) * 0.09
        v.co.z *= 0.7
    place(ob, (0, 0, 0.25), (rnd.uniform(40, 60), rnd.uniform(-30, 30), 0))
    ground = collider_plane(0.0)
    cloth_sim(ob, frames=70, mass=0.05, tension=6, bending=0.002, shrink=0.18, dist=0.003, quality=7, self_coll=True, air=2.0)
    remove(ground)
    ground_clamp(ob, 0.0)
    ob.name = 'plastic_bag'
    smooth(ob, 80)
    return finalize(ob, 'plastic_bag', 'fabric', ao=dict(rays=12, dist=0.05, strength=0.6, grime=0.3, floor_dirt=0.0), seed=55)


# ---------------------------------------------------------------- Spritze (sehr dezent)
@prop('syringe', 'metal', 'Schlafzimmer, Bad (sparsam)',
      'Einweg-Spritze 3 ml, leer, liegend, Kanüle mit orangefarbener Schutzkappe daneben. Sehr klein und unauffällig.')
def p_syringe():
    parts = []
    barrel = lathe('_br', [(0.0045, 0.0), (0.0048, 0.002), (0.0048, 0.055), (0.0045, 0.058), (0.0015, 0.062), (0.0012, 0.066)],
                   'plastic_clear', seg=12)
    flange = box('_fl', 0.022, 0.0016, 0.012, 'plastic_clear', loc=(0, 0, 0.001), rot=(90, 0, 0), bevel=0.0006)
    flange = box('_fl', 0.022, 0.012, 0.0016, 'plastic_clear', loc=(0, 0, 0.0008), bevel=0.0005)
    plunger = box('_pl', 0.0055, 0.0012, 0.05, 'plastic_white_dirty', loc=(0, 0, -0.012))
    pl2 = box('_pl2', 0.0012, 0.0055, 0.05, 'plastic_white_dirty', loc=(0, 0, -0.012))
    thumb = cyl('_th', 0.0055, 0.0015, 'plastic_white_dirty', seg=12, loc=(0, 0, -0.037))
    seal = cyl('_se', 0.0044, 0.004, 'rubber_black', seg=12, loc=(0, 0, 0.012))
    needle = cyl('_nd', 0.00035, 0.025, 'needle', seg=4, loc=(0, 0, 0.078))
    hub = cyl('_hb', 0.002, 0.006, 'plastic_orange', seg=8, loc=(0, 0, 0.067), r2=0.0016)
    parts = [barrel, flange, plunger, pl2, thumb, seal, needle, hub]
    ob = join(parts, '_sy')
    place(ob, (0, 0, 0.0056), (90, 0, 70))
    cap = cyl('_cap', 0.0022, 0.028, 'plastic_orange', seg=8, loc=(0.03, -0.02, 0.0022), rot=(90, 0, 15), r2=0.0015)
    ob = join([ob, cap], 'syringe')
    smooth(ob, 50)
    return finalize(ob, 'syringe', 'metal', ao=dict(rays=8, dist=0.01, strength=0.4, grime=0.2, floor_dirt=0.0), seed=60)
