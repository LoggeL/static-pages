# Kartons, Pizzakartons

def _grid_into(bm, origin, U, V, nu, nv, want_n, mat_idx=0, uvl=None, uv_full=False, bend=None):
    """Rasterfläche origin + U*s + V*t (s,t in 0..1). want_n: gewünschte Außennormale. bend(s,t)->Offset-Vektor."""
    O, U, V = Vector(origin), Vector(U), Vector(V)
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            s, t = i / nu, j / nv
            p = O + U * s + V * t
            if bend:
                p = p + bend(s, t)
            row.append(bm.verts.new(p))
        grid.append(row)
    flip = U.cross(V).dot(Vector(want_n)) < 0
    faces = []
    for j in range(nv):
        for i in range(nu):
            idx = [(j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)]
            if flip:
                idx = idx[::-1]
            f = bm.faces.new([grid[a][b] for a, b in idx])
            f.material_index = mat_idx
            if uvl is not None and uv_full:
                for lp, (a, b) in zip(f.loops, idx):
                    lp[uvl].uv = (b / nu, a / nv)
            faces.append(f)
    return faces


def cardboard_box(name, sx, sy, sz, flaps=(0, 0, 0, 0), droop=(0, 0, 0, 0), step=0.06, t=0.0045, label_side=None,
                  tape=True, seed=0, sag=0.012, bulge=0.006, dents=(), crush=None, open_tape=False):
    """flaps: Winkel (Grad) für (vorn −Y, hinten +Y, links −X, rechts +X); 0 = zu, 90 = senkrecht, >90 = nach außen.
    Lange Klappen vorn/hinten liegen beim geschlossenen Karton oben."""
    rnd = random.Random(seed)
    mats = ['cardboard', 'MU_box_label']
    bm = bmesh.new()
    uvl = bm_uv(bm)
    nx, ny, nz = max(2, round(sx / step)), max(2, round(sy / step)), max(2, round(sz / step))
    hx, hy = sx / 2, sy / 2
    # Boden + Seiten
    _grid_into(bm, (-hx, -hy, 0), (sx, 0, 0), (0, sy, 0), nx, ny, (0, 0, -1))
    _grid_into(bm, (-hx, -hy, 0), (sx, 0, 0), (0, 0, sz), nx, nz, (0, -1, 0), 1 if label_side == 'front' else 0, uvl, label_side == 'front')
    _grid_into(bm, (hx, hy, 0), (-sx, 0, 0), (0, 0, sz), nx, nz, (0, 1, 0), 1 if label_side == 'back' else 0, uvl, label_side == 'back')
    _grid_into(bm, (-hx, hy, 0), (0, -sy, 0), (0, 0, sz), ny, nz, (-1, 0, 0), 1 if label_side == 'left' else 0, uvl, label_side == 'left')
    _grid_into(bm, (hx, -hy, 0), (0, sy, 0), (0, 0, sz), ny, nz, (1, 0, 0), 1 if label_side == 'right' else 0, uvl, label_side == 'right')
    # Klappen
    fd = sy / 2  # Klappentiefe
    defs = [  # Scharnier-Start, Scharnier-Vektor, nach-innen-Vektor, Index
        ((-hx, -hy, sz), (sx, 0, 0), Vector((0, 1, 0)), 0, nx),
        ((-hx, hy, sz), (sx, 0, 0), Vector((0, -1, 0)), 1, nx),
        ((-hx, -hy, sz), (0, sy, 0), Vector((1, 0, 0)), 2, ny),
        ((hx, -hy, sz), (0, sy, 0), Vector((-1, 0, 0)), 3, ny),
    ]
    up = Vector((0, 0, 1))
    for (o, hv, inw, k, nu) in (defs if flaps is not None else []):
        ang = radians(flaps[k])
        dr = radians(droop[k])
        long_ = k < 2
        z_off = t * 1.05 if (long_ and flaps[k] < 20) else 0.0
        nvv = max(2, round(fd / step))

        def bend(s, tt, ang=ang, dr=dr, inw=inw, z_off=z_off, k=k):
            # Klappe entlang Tiefe gekrümmt (droop), leicht verzogen
            a = ang + dr * tt * tt + 0.04 * noise.noise(Vector((s * 3, tt * 3, k + seed)))
            d = (inw * cos(a) + up * sin(a))
            # Integration der Krümmung grob: Länge * Richtung beim mittleren Winkel
            am = ang + dr * tt * tt / 3
            dm = (inw * cos(am) + up * sin(am))
            return dm * fd * tt - (inw * fd * tt) + Vector((0, 0, z_off))
        O = Vector(o)
        n_closed = up
        # gewünschte Normale beim aktuellen Winkel
        wn = -inw * sin(ang) + up * cos(ang)
        _grid_into(bm, O, hv, inw * fd, nu, nvv, wn, 0, None, False, bend)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    ob = mesh_obj('_box', bm, mats)
    me = ob.data
    off = Vector((seed * 1.3, seed * 2.9, 0))
    # Verformung: Deckel sackt, Seiten beulen, Rauschen
    for v in me.vertices:
        co = v.co
        if co.z > sz - 0.002 and abs(co.x) < hx - 0.002 and abs(co.y) < hy - 0.002:
            co.z -= sag * cos(pi * co.x / sx) * cos(pi * co.y / sy) * (0.7 + 0.6 * (noise.noise(co * 4 + off) * 0.5 + 0.5))
        fx = sin(pi * (co.z / sz)) if 0 < co.z < sz else 0
        if abs(abs(co.y) - hy) < 0.001 and abs(co.x) < hx - 0.001:
            co.y += math.copysign(1, co.y) * bulge * fx * cos(pi * co.x / sx)
        if abs(abs(co.x) - hx) < 0.001 and abs(co.y) < hy - 0.001:
            co.x += math.copysign(1, co.x) * bulge * fx * cos(pi * co.y / sy)
        co += nvec(co * 7 + off) * 0.0018
    me.update()
    for (c, r, d) in dents:
        dent(ob, c, r, d)
    if crush:
        k, shear, kink = crush
        for v in me.vertices:
            co = v.co
            zn = co.z / sz
            # Knick in halber Höhe nach außen, Zusammenstauchen, Scherung
            out = sin(pi * min(1, max(0, zn))) * kink * (0.6 + 0.4 * noise.noise(co * 3 + off))
            dxy = Vector((co.x, co.y, 0))
            if dxy.length > 1e-6 and co.z > 0.001:
                co.x += dxy.normalized().x * out
                co.y += dxy.normalized().y * out
            co.z = co.z * k
            co.x += shear * co.z
        me.update()
    mod_solidify(ob, t, off=-1.0, rim=True)
    apply_mods(ob)
    if label_side:
        fix_inner_faces(ob, 'MU_box_label', 'cardboard', center=(0, 0, sz * 0.5))
    mod_bevel(ob, 0.0018, 1, angle=50)
    apply_mods(ob)
    parts = [ob]
    if tape:
        # Paketband über die Mittelfuge der langen Klappen, an den Stirnseiten 7 cm herunter
        tw, tl = 0.048, 0.07
        ztop = max(v.co.z for v in ob.data.vertices if abs(v.co.x) < 0.02 and abs(v.co.y) < 0.02)
        tb = bmesh.new()
        prof = [(-hx - t - 0.0006, sz - tl), (-hx - t - 0.0006, sz + t), (-hx + 0.004, ztop + 0.0012),
                (hx - 0.004, ztop + 0.0012), (hx + t + 0.0006, sz + t), (hx + t + 0.0006, sz - tl)]
        if open_tape:
            prof = prof[:3]
        rows = []
        for (x, z) in prof:
            rows.append([tb.verts.new((x, y, z)) for y in (-tw / 2, tw / 2)])
        for i in range(len(rows) - 1):
            tb.faces.new((rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]))
        bmesh.ops.subdivide_edges(tb, edges=[e for e in tb.edges if abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-6], cuts=3)
        tob = mesh_obj('_tape', tb, 'tape_packing')
        # Band folgt der gesackten Oberseite
        for v in tob.data.vertices:
            if v.co.z > sz - 0.001 and abs(v.co.x) < hx - 0.002:
                v.co.z = sz + t * 2.05 - sag * cos(pi * v.co.x / sx) * 0.9 + 0.0012
        if crush:
            k, shear, kink = crush
            for v in tob.data.vertices:
                v.co.z *= k
                v.co.x += shear * v.co.z
        tob.data.update()
        # Band per Strahl auf die Außenfläche legen (oben von oben, Stirnseiten von außen)
        bmb = bmesh.new(); bmb.from_mesh(ob.data); bvh = BVHTree.FromBMesh(bmb); bmb.free()
        zt = max(v.co.z for v in ob.data.vertices)
        for v in tob.data.vertices:
            co = v.co
            if abs(co.x) < hx - 0.003:
                hit = bvh.ray_cast(Vector((co.x, co.y, zt + 0.1)), Vector((0, 0, -1)))
                if hit[0] is not None:
                    co.z = hit[0].z + 0.0008
            else:
                sg = 1 if co.x > 0 else -1
                hit = bvh.ray_cast(Vector((sg * (hx + 0.2), co.y, co.z)), Vector((-sg, 0, 0)))
                if hit[0] is not None:
                    co.x = hit[0].x + sg * 0.0008
        tob.data.update()
        parts.append(tob)
    return parts


@prop('box_closed', 'cardboard', 'überall; Garage, Keller, Flur',
      'Umzugskarton 50×38×36 cm, zugeklebt, Deckel eingesackt, Delle an der Ecke, Seite mit Etikett/Kritzelei (MU_box_label).')
def p_box_closed():
    parts = cardboard_box('box_closed', 0.50, 0.38, 0.36, label_side='front', seed=3,
                          dents=[((0.25, -0.19, 0.30), 0.09, 0.03)])
    ob = join(parts, 'box_closed')
    smooth(ob, 40)
    return finalize(ob, 'box_closed', 'cardboard', ao=dict(rays=18, dist=0.15, strength=0.8, grime=0.25, floor_dirt=0.4), seed=3)


@prop('box_open', 'cardboard', 'Wohnzimmer, Schlafzimmer, Garage',
      'Offener Karton 45×33×30 cm, Klappen in verschiedenen Winkeln durchhängend, Papierknäuel darin.')
def p_box_open():
    parts = cardboard_box('box_open', 0.45, 0.33, 0.30, flaps=(205, 115, 150, 98), droop=(25, -20, 20, 35), seed=5,
                          tape=True, open_tape=True, sag=0.0, dents=[((-0.2, 0.17, 0.12), 0.07, 0.02)])
    rnd = random.Random(5)
    for i in range(6):
        b = crumple_ball('_pb', rnd.uniform(0.04, 0.06), rnd.choice(['paper_white', 'paper_news']), seed=i + 50)
        place(b, (rnd.uniform(-0.15, 0.15), rnd.uniform(-0.1, 0.1), rnd.uniform(0.2, 0.26)), (rnd.uniform(0, 90), 0, 0))
        parts.append(b)
    ob = join(parts, 'box_open')
    smooth(ob, 40)
    return finalize(ob, 'box_open', 'cardboard', ao=dict(rays=20, dist=0.18, strength=0.85, grime=0.25, floor_dirt=0.4), seed=5)


@prop('box_crushed', 'cardboard', 'Garage, Hof, Keller',
      'Zusammengedrückter Karton (draufgetreten/nass): gestaucht, geknickt, verschert, große Delle.')
def p_box_crushed():
    parts = cardboard_box('box_crushed', 0.46, 0.36, 0.34, seed=9, step=0.045, sag=0.05, bulge=0.012,
                          crush=(0.52, 0.22, 0.035), dents=[((0.15, -0.18, 0.3), 0.14, 0.06), ((-0.2, 0.0, 0.33), 0.12, 0.05)])
    ob = join(parts, 'box_crushed')
    smooth(ob, 40)
    return finalize(ob, 'box_crushed', 'cardboard', ao=dict(rays=18, dist=0.15, strength=0.8, grime=0.4, floor_dirt=0.5), seed=9)


@prop('box_flat', 'cardboard', 'überall auf dem Boden, an Wände gelehnt',
      'Flachgelegter Karton (zwei Lagen, Knickfalte, Klappen geschlitzt), leicht gewellt, liegt flach.')
def p_box_flat():
    rnd = random.Random(13)
    sx, sy, sz, t = 0.50, 0.38, 0.36, 0.0045
    fd = sy / 2
    W = sx + sy
    bm = bmesh.new()
    uvl = bm_uv(bm)
    # zwei Lagen: Unterseite (z=0) und Oberseite (z=t*2), Breite W, Tiefe fd + sz + fd, Schlitze bei x=sx-W/2
    gap = 0.006
    for zl in (0.0, t * 1.1):
        xs = [(-W / 2, -W / 2 + sx - gap / 2), (-W / 2 + sx + gap / 2, W / 2)]
        for (x0, x1) in xs:
            _grid_into(bm, (x0, -sz / 2 - fd, zl), (x1 - x0, 0, 0), (0, fd - gap / 2, 0), max(2, round((x1 - x0) / 0.06)), 3, (0, 0, 1))
            _grid_into(bm, (x0, sz / 2 + gap / 2, zl), (x1 - x0, 0, 0), (0, fd - gap / 2, 0), max(2, round((x1 - x0) / 0.06)), 3, (0, 0, 1))
        _grid_into(bm, (-W / 2, -sz / 2 - gap / 2, zl), (W, 0, 0), (0, sz + gap, 0), round(W / 0.06), round(sz / 0.06), (0, 0, 1))
    ob = mesh_obj('_flat', bm, 'cardboard')
    off = Vector((3.3, 1.1, 0))
    for v in ob.data.vertices:
        co = v.co
        # Welle + Knickfalte an der Mittellinie leicht aufgestellt
        co.z += 0.01 * (noise.noise(co * 2.2 + off) * 0.5 + 0.5) + 0.006 * max(0, 1 - abs(co.x - (-W / 2 + sx)) / 0.05)
        if abs(co.y) > sz / 2:
            co.z += 0.012 * ((abs(co.y) - sz / 2) / fd) ** 2 * (1 if co.x > 0 else 0.4)
    ob.data.update()
    mod_solidify(ob, t, off=-1.0)
    mod_bevel(ob, 0.0015, 1, angle=50)
    apply_mods(ob)
    ob = join([ob], 'box_flat')
    smooth(ob, 40)
    return finalize(ob, 'box_flat', 'cardboard', ao=dict(rays=14, dist=0.08, strength=0.7, grime=0.4, floor_dirt=0.2), seed=13)


# ---------------------------------------------------------------- Pizzakartons
def pizza_box(prefix, seed, lid_angle=0.0, crusts=False):
    rnd = random.Random(seed)
    S, Hh, t = 0.41, 0.045, 0.003
    parts = []
    base = cardboard_box(prefix + '_base', S, S, Hh, flaps=None, step=0.07, t=t, tape=False, sag=0, bulge=0.002, seed=seed)
    parts.append(base[0])
    # Deckel: Platte mit MU-Druck oben + Vorderlasche, Scharnier hinten
    lid = plane_patch('_lid', S, S, 6, 6, 'MU_pizza_box')
    place(lid, (0, 0, Hh + t))
    mod_solidify(lid, t, off=-1.0)
    apply_mods(lid)
    fix_inner_faces(lid, 'MU_pizza_box', 'cardboard', center=(0, 0, -0.5))
    lip = box('_lip', S, t, Hh * 0.8, 'cardboard', loc=(0, -S / 2, Hh + t - Hh * 0.4), bevel=0.001)
    sides = [box('_ls', t, S * 0.98, Hh * 0.5, 'cardboard', loc=(sgn * S / 2, 0, Hh + t - Hh * 0.25), bevel=0.001) for sgn in (-1, 1)]
    lidp = [lid, lip] + sides
    lj = join(lidp, '_lidj')
    for v in lj.data.vertices:
        v.co.z += 0.004 * noise.noise(v.co * 5 + Vector((seed, 0, 0)))
    if lid_angle:
        piv = Vector((0, S / 2, Hh + t))
        R_ = Matrix.Rotation(radians(-lid_angle), 3, 'X')
        for v in lj.data.vertices:
            v.co = piv + R_ @ (v.co - piv)
    parts.append(lj)
    if crusts:
        for i in range(rnd.randint(2, 4)):
            pts = []
            a0 = rnd.uniform(0, 6.28)
            c = Vector((rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.08), 0.008))
            for k in range(5):
                a = a0 + k * 0.22
                pts.append(c + Vector((cos(a) * 0.07, sin(a) * 0.07, 0.004 * sin(k))))
            cr = tube_curve('_crust', pts, 0.014, 'food_crust', sides=7, n=3, taper=(0.55, 1.0))
            jitter(cr, 0.003, 60, seed=i)
            for v in cr.data.vertices:
                v.co.z = c.z + (v.co.z - c.z) * 0.6
            parts.append(cr)
        # Fettfleck-Scheibe
    return parts


@prop('pizza_box', 'cardboard', 'Wohnzimmer, Küche',
      'Pizzakarton 41×41 cm, Deckel einen Spalt offen, Fett-/Kaffeeflecken im MU-Druck.')
def p_pizza_box():
    parts = pizza_box('pz', 41, lid_angle=7, crusts=True)
    ob = join(parts, 'pizza_box')
    smooth(ob, 40)
    return finalize(ob, 'pizza_box', 'cardboard', ao=dict(rays=16, dist=0.08, strength=0.8, grime=0.25, floor_dirt=0.2), seed=41)


@prop('pizza_box_stack', 'cardboard', 'Wohnzimmer, Küche, Couchtisch',
      'Drei verdrehte Pizzakartons übereinander, oberster offen mit Rändern (Krusten).')
def p_pizza_box_stack():
    rnd = random.Random(43)
    allp = []
    z = 0.0
    for i in range(3):
        parts = pizza_box('pzs%d' % i, 43 + i, lid_angle=(105 if i == 2 else rnd.uniform(0, 3)), crusts=(i == 2))
        o = join(parts, '_pz%d' % i)
        place(o, (rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), z), (0, 0, rnd.uniform(-12, 12)))
        z += 0.056
        allp.append(o)
    ob = join(allp, 'pizza_box_stack')
    smooth(ob, 40)
    return finalize(ob, 'pizza_box_stack', 'cardboard', ao=dict(rays=16, dist=0.1, strength=0.85, grime=0.25, floor_dirt=0.2), seed=43)
