# Müllsäcke (Tuchsimulation über Inhalt), Plastiktüte

def _bag_contents(rnd, R, H, n):
    """Inhalt als statische Kollider: Kartons, Flaschen, Knäuel – erzeugt die Beulen."""
    obs = []
    for i in range(n):
        for _ in range(30):
            u = rnd.uniform(-1, 1); v = rnd.uniform(-1, 1); w = rnd.uniform(0, 1)
            if u * u + v * v + (w * 2 - 1) ** 2 <= 1.0:
                break
        w = w ** 1.4  # mehr Inhalt unten -> Sack sackt breit auf den Boden
        spread = 0.82 - 0.3 * w
        cx, cy, cz = u * R * spread, v * R * spread * 0.95, 0.05 + w * H * 0.66
        k = rnd.random()
        s = rnd.uniform(0.09, 0.17) * (R / 0.27) ** 0.5
        if k < 0.45:
            bm = bm_box(s * rnd.uniform(0.8, 1.6), s * rnd.uniform(0.6, 1.2), s * rnd.uniform(0.5, 1.1))
        elif k < 0.75:
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=s * 0.6)
        else:
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=s * 0.3, radius2=s * 0.3, depth=s * 2.0)
        ob = mesh_obj('_c%d' % i, bm)
        ob.location = (cx, cy, max(cz, s * 0.5))
        ob.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
        apply_tf(ob)
        make_collider(ob, thick=0.008, friction=6)
        obs.append(ob)
    return obs


def trash_bag(name, seed, R=0.27, H=0.70, mat='plastic_bag_black', n_contents=16, shrink=0.10, lean=(0.04, 0.02),
              tie='ears', tear=False, slump=0.0, pressure=1.2, flop=(0.0, 0.0)):
    rnd = random.Random(seed)
    contents = _bag_contents(rnd, R, H, n_contents)
    ground = collider_plane(0.0)
    # Sackrohling: offener Zylinder mit Boden, oben weit (Material zum Raffen)
    prof = [(0.0, 0.0), (R * 0.45, 0.0), (R * 0.85, 0.01), (R * 1.0, 0.06), (R * 1.04, 0.2), (R * 1.04, 0.42),
            (R * 1.02, 0.6), (R * 1.0, H * 0.95), (R * 1.0, H * 1.05), (R * 1.0, H * 1.15)]
    # Profil fein auflösen
    fine = []
    for i in range(len(prof) - 1):
        (r0, z0), (r1, z1) = prof[i], prof[i + 1]
        L = math.hypot(r1 - r0, z1 - z0)
        k = max(1, int(L / 0.022))
        for j in range(k):
            t = j / k
            fine.append((lerp(r0, r1, t), lerp(z0, z1, t)))
    fine.append(prof[-1])
    seg = 56
    bag = lathe('_bag', fine, mat, seg=seg)
    me = bag.data
    # Stoff-Jitter, damit die Falten nicht symmetrisch werden
    for v in me.vertices:
        v.co += nvec(v.co * 9 + Vector((seed, 0, 0))) * 0.006
    # Pin-Gruppe + Raff-Shape-Key: obere zwei Ringe auf Halspunkt
    ztop = max(v.co.z for v in me.vertices)
    vg = bag.vertex_groups.new(name='pin')
    pin = [v.index for v in me.vertices if v.co.z > ztop - 0.01]
    vg.add(pin, 1.0, 'REPLACE')
    bag.shape_key_add(name='Basis')
    sk = bag.shape_key_add(name='gather')
    neck = Vector((lean[0], lean[1], H * 0.98))
    for i in pin:
        co = me.vertices[i].co
        a = math.atan2(co.y, co.x)
        sk.data[i].co = neck + Vector((cos(a) * 0.022, sin(a) * 0.022, rnd.uniform(-0.01, 0.01)))
    sk.value = 0.0
    sk.keyframe_insert('value', frame=1)
    sk.value = 1.0
    sk.keyframe_insert('value', frame=22)
    cloth_sim(bag, frames=48, mass=0.12, tension=9, bending=0.015, shrink=shrink, dist=0.004, quality=7,
              pin_group='pin', self_coll=True, air=1.5, pressure=pressure)
    # Shape-Keys sind nach apply_mods weg; Vertexgruppe entfernen
    bag.vertex_groups.clear()
    for c in contents:
        remove(c)
    remove(ground)
    ground_clamp(bag, 0.0)
    parts = [bag]
    # Hals: Ringe über dem Halspunkt auf einen kurzen gedrehten Zipfel ziehen
    neckz = neck.z
    for v in bag.data.vertices:
        if v.co.z > neckz - 0.05:
            t = smoothstep(neckz - 0.05, neckz + 0.02, v.co.z)
            d = Vector((v.co.x - neck.x, v.co.y - neck.y, 0))
            v.co.x = neck.x + d.x * (1 - 0.6 * t)
            v.co.y = neck.y + d.y * (1 - 0.6 * t)
    if tie == 'ears':
        # Knoten + zwei Zipfel ("Hasenohren")
        knot = crumple_ball('_knot', 0.028, mat, seed=seed + 3, sub=2, amp=0.25)
        place(knot, (neck.x, neck.y, neckz + 0.02), (0, 0, 0), (1.0, 0.8, 0.75))
        parts.append(knot)
        for s in (-1, 1):
            ear = plane_patch('_ear', 0.06, 0.16, 3, 6, mat)
            for v in ear.data.vertices:
                t = (v.co.y + 0.08) / 0.16  # 0 unten .. 1 Spitze
                v.co.x *= (1.0 - 0.75 * t)
                v.co.z = 0.03 * sin(t * pi) + 0.01 * noise.noise(v.co * 40)
                v.co.x += 0.004 * noise.noise(v.co * 60 + Vector((s, 0, 0)))
            ang = rnd.uniform(25, 55)
            place(ear, (0, 0, 0), (-90 + ang, 0, 0))
            # Spitze hängt durch
            for v in ear.data.vertices:
                if v.co.z > 0.05:
                    v.co.z -= (v.co.z - 0.05) * 0.7
                    v.co.y -= (v.co.z - 0.05) * 0.4
            place(ear, (neck.x, neck.y, neckz + 0.02), (rnd.uniform(-10, 10), 0, 90 * s + rnd.uniform(-25, 25)))
            parts.append(ear)
    elif tie == 'drawstring':
        # Zugband (rot) als zwei Schlaufen
        for s in (-1, 1):
            pts = [neck + Vector((0, 0, 0.01)), neck + Vector((s * 0.05, 0.01, 0.05)),
                   neck + Vector((s * 0.09, -0.01, 0.03)), neck + Vector((s * 0.07, -0.02, -0.01)),
                   neck + Vector((s * 0.02, 0.0, 0.0))]
            pts = [neck + (q - neck) * 0.6 for q in pts]
            parts.append(tube_curve('_str', pts, 0.0028, 'plastic_tie_red', sides=6, n=4))
        knot = crumple_ball('_knot', 0.02, mat, seed=seed + 3, sub=1, amp=0.2)
        place(knot, (neck.x, neck.y, neckz + 0.005))
        parts.append(knot)
    if tear:
        # Riss vorne unten (−Y): Flächen löschen, Rand ausfransen, Inhalt schaut heraus
        bm = bmesh.new()
        bm.from_mesh(bag.data)
        cand = [v.co.copy() for v in bag.data.vertices if abs(v.co.z - H * 0.24) < 0.03 and abs(v.co.x - R * 0.1) < 0.06]
        c = min(cand, key=lambda q: q.y) if cand else Vector((R * 0.15, -R * 1.0, H * 0.22))
        kill = [f for f in bm.faces if ((f.calc_center_median() - c) * Vector((1.0, 1.0, 1.6))).length
                < 0.075 + 0.02 * noise.noise(f.calc_center_median() * 30)]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        for v in bm.verts:
            if v.is_boundary:
                v.co += (v.co - c).normalized() * 0.006 + Vector((0, -0.006, 0))
        bm.to_mesh(bag.data)
        bm.free()
        ball = crumple_ball('_pball', 0.04, 'paper_white', seed=seed + 7)
        place(ball, (c.x - 0.025, c.y + 0.035, c.z - 0.02))
        parts.append(ball)
        can = cyl_patch('_can', 0, 2 * pi, 0, 0.12, 12, 2, lambda a, z: 0.033, 'MU_can_label')
        place(can, (c.x + 0.035, c.y + 0.07, c.z - 0.05), (80, 0, 25))
        parts.append(can)
        # Flüssigkeits-/Schmierfleck nicht als Geometrie, sondern über Vertexfarbe (Grime)
    ob = join(parts, name)
    if flop[0] or flop[1]:
        # Hals kippt zur Seite (Knoten hängt über)
        piv = Vector((neck.x, neck.y, H * 0.72))
        for v in ob.data.vertices:
            t = smoothstep(H * 0.70, H * 1.05, v.co.z)
            if t > 0:
                R_ = Euler((radians(flop[0]) * t, radians(flop[1]) * t, 0)).to_matrix()
                v.co = piv + R_ @ (v.co - piv)
        ob.data.update()
    smooth(ob, 75)
    return ob


@prop('trash_bag_a', 'fabric', 'überall; Küche, Garage, Veranda, Hof',
      'Schwarzer Müllsack, prall gefüllt, Hals mit Knoten und zwei Zipfeln. Tuchsimulation über Inhalt (Beulen).')
def p_trash_bag_a():
    ob = trash_bag('trash_bag_a', 11, R=0.27, H=0.70, mat='plastic_bag_black', n_contents=24, shrink=0.08, flop=(25, -10))
    return finalize(ob, 'trash_bag_a', 'fabric', ao=dict(rays=18, dist=0.15, strength=0.75, grime=0.10, floor_dirt=0.3), seed=11)


@prop('trash_bag_b', 'fabric', 'Küche, Flur, Garage',
      'Schwarzer Müllsack, unförmig, vorne unten aufgerissen – Papierknäuel und Dose schauen heraus.')
def p_trash_bag_b():
    ob = trash_bag('trash_bag_b', 23, R=0.31, H=0.60, mat='plastic_bag_black', n_contents=20, shrink=0.12,
                   lean=(-0.06, 0.05), tear=True, pressure=0.6, flop=(-35, 20))
    return finalize(ob, 'trash_bag_b', 'fabric', ao=dict(rays=18, dist=0.15, strength=0.75, grime=0.12, floor_dirt=0.3), seed=23)


@prop('trash_bag_c', 'fabric', 'Küche, Bad, Schlafzimmer',
      'Kleiner weißer Küchenbeutel mit rotem Zugband, schmutzig, etwas schlaff.')
def p_trash_bag_c():
    ob = trash_bag('trash_bag_c', 37, R=0.19, H=0.48, mat='plastic_bag_white', n_contents=14, shrink=0.10,
                   lean=(0.03, -0.03), tie='drawstring', pressure=0.8, flop=(15, 20))
    return finalize(ob, 'trash_bag_c', 'fabric', ao=dict(rays=18, dist=0.12, strength=0.8, grime=0.35, floor_dirt=0.45), seed=37)
