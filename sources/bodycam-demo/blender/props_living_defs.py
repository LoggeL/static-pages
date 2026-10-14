# Prop-Definitionen fuer props_living.py (wird dort per exec in den Namespace geladen).
# Alle Masse in Metern. Vorderseite = -Y. Gebaut wird direkt um den Ursprung (Koerpermitte, Boden z = 0).

# ==============================================================================================
# Polstermoebel (Sofa, Sessel)
def _cushion(sx, sy, sz, r, step, loc, rot=(0, 0, 0), bulge=(0.01, 0.01, 0.02), sag=0.0, wr=0.004, seed=0,
             tear_at=None, tear_r=0.09, tear_dir=(0, 0, 1), mat='fabric_sofa_dirty'):
    bm = L.rbox(sx, sy, sz, r=r, step=step)
    puff(bm, (sx, sy, sz), *bulge)
    if sag:
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        for v in bm.verts:
            fx = max(0.0, 1 - (v.co.x / (hx * 1.05)) ** 2)
            fy = max(0.0, 1 - ((v.co.y + hy * 0.15) / (hy * 1.1)) ** 2)
            k = fx * fy
            if v.co.z > -hz * 0.3:
                v.co.z -= sag * k * (0.5 + 0.5 * min(1, (v.co.z + hz) / sz))
    wrinkle(bm, wr, 9.0, seed)
    holes = None
    if tear_at is not None:
        holes = tear(bm, tear_at, tear_r, seed=seed, face_dir=tear_dir, lift=0.012)
    ob = mk(bm, mat, loc, rot)
    _XF[ob.name] = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    return ob


_XF = {}


def _mat(ob):
    return _XF[ob.name]


def _foam(center, rad, scale, seed, rot=(0, 0, 0)):
    return blob(rad, 'foam_old', loc=center, scale=scale, rot=rot, amp=0.35, freq=1.4, seed=seed, subdiv=3)


def upholstered(W, D, H, seat_h, n, arm_w=0.22, arm_h=0.64, back_d=0.20, damage=None, seed=0):
    """Ein Polstermoebel im 80er-Stil. damage: dict mit Schaeden. Gibt Teileliste zurueck."""
    damage = damage or {}
    P = []
    fab = 'fabric_sofa_dirty'
    hx, hy = W / 2, D / 2
    foot_h = 0.07
    # Fuesse (gedrechselt, konisch)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (hx - 0.07), sy * (hy - 0.07)
            prof = [(0.0, 0.0), (0.016, 0.0), (0.018, 0.004), (0.019, 0.03), (0.023, 0.05), (0.025, foot_h), (0.0, foot_h)]
            P.append(lathe_part(prof, 'cabinet_wood', loc=(x, y, 0), segs=12))
    # Sockel (gepolstert)
    base_top = seat_h - 0.15
    P.append(box(W - 0.02, D - 0.04, base_top - foot_h + 0.02, fab, loc=(0, 0.0, (foot_h - 0.01 + base_top + 0.01) / 2),
                 r=0.03, step=0.2, fn=lambda p: p, noise_amp=0.002, seed=seed))
    # Volant/Saum unten: leichte Lippe
    P.append(box(W, D - 0.02, 0.025, fab, loc=(0, 0.0, foot_h + 0.012), r=0.01, step=0.25))
    # Rueckenteil
    bz0, bz1 = base_top - 0.03, H
    back = L.rbox(W, back_d, bz1 - bz0, r=0.07, step=0.16)
    puff(back, (W, back_d, bz1 - bz0), 0.0, 0.012, 0.015)
    wrinkle(back, 0.003, 7.0, seed + 1)
    P.append(mk(back, fab, loc=(0, hy - back_d / 2, (bz0 + bz1) / 2)))
    # Armlehnen (gerollt)
    arm_d = D - back_d + 0.06
    ay = -hy + arm_d / 2
    for s in (-1, 1):
        ah = arm_h - foot_h - 0.02
        bm = L.rbox(arm_w, arm_d, ah, r=0.085, step=0.11)
        puff(bm, (arm_w, arm_d, ah), 0.012, 0.01, 0.018)
        # Rolle: obere Aussenkante etwas nach aussen ziehen
        for v in bm.verts:
            t = max(0.0, (v.co.z - ah * 0.15) / (ah * 0.35))
            if v.co.z > ah * 0.15:
                v.co.x += 0.018 * min(1, t) * (v.co.x / (arm_w / 2))
        wrinkle(bm, 0.003, 8.0, seed + 2 + s)
        arm_tear = damage.get('arm_tear') if damage.get('arm_tear_side', -1) == s else None
        holes = None
        if arm_tear:
            holes = tear(bm, arm_tear[0], arm_tear[1], seed=seed + 7, face_dir=(0, -1, 0), lift=0.008)
        ob = mk(bm, fab, loc=(s * (hx - arm_w / 2), ay, foot_h + 0.02 + ah / 2))
        P.append(ob)
        if arm_tear:
            c = Vector(arm_tear[0]) + Vector((s * (hx - arm_w / 2), ay, foot_h + 0.02 + ah / 2))
            fr = arm_tear[1] * 1.2
            P.append(blob(fr, 'foam_old', loc=c + Vector((0, fr * 0.3 - 0.008, 0)), scale=(0.95, 0.3, 1.0), amp=0.3,
                          freq=1.4, seed=seed + 3, subdiv=2))
    # Sitzkissen
    inner = W - 2 * arm_w
    cw = inner / n
    cd = D - back_d - 0.02
    cz = base_top + 0.075
    seat_cfg = damage.get('seats', [{}] * n)
    for i in range(n):
        cfg = seat_cfg[i] if i < len(seat_cfg) else {}
        x = -inner / 2 + cw * (i + 0.5)
        dx, dy, rz = cfg.get('shift', (0, 0, 0))
        tear_at = cfg.get('tear')
        ob = _cushion(cw - 0.008, cd, 0.15, 0.045, 0.075 if not tear_at else 0.03,
                      loc=(x + dx, -hy + cd / 2 + 0.005 + dy, cz + cfg.get('dz', 0.0)), rot=(cfg.get('rx', 0), cfg.get('ry', 0), rz),
                      bulge=(0.008, 0.01, 0.022), sag=cfg.get('sag', 0.0), wr=0.005, seed=seed + 10 + i,
                      tear_at=tear_at, tear_r=cfg.get('tear_r', 0.09))
        P.append(ob)
        if tear_at:
            # Schaumstoff quillt heraus (in Kissen-Lokalkoordinaten -> Welt)
            tr = cfg.get('tear_r', 0.09)
            fr = tr * 1.25
            c = _mat(ob) @ Vector((tear_at[0], tear_at[1], tear_at[2] + 0.012 - fr * 0.4))
            P.append(_foam(c, fr, (1.0, 0.9, 0.4), seed + 20, rot=(0, 0, rz)))
            # Brocken daneben
            for k in range(cfg.get('crumbs', 0)):
                rr = 0.012 + 0.012 * random.random()
                cx = x + dx + (random.random() - 0.5) * 0.5
                cy = -hy - 0.05 - random.random() * 0.25
                P.append(blob(rr, 'foam_old', loc=(cx, cy, rr * 0.45), scale=(1.3, 1.0, 0.6),
                              amp=0.4, freq=1.5, seed=seed + 40 + k, subdiv=1))
    # Rueckenkissen
    bcfg = damage.get('backs', [{}] * n)
    for i in range(n):
        cfg = bcfg[i] if i < len(bcfg) else {}
        if cfg.get('missing'):
            continue
        x = -inner / 2 + cw * (i + 0.5)
        bh = H - cz - 0.05
        dx, dy, dz = cfg.get('shift', (0, 0, 0))
        rx = radians(-14) + cfg.get('rx', 0.0)
        ob = _cushion(cw - 0.012, 0.19, bh, 0.06, 0.11, loc=(x + dx, hy - back_d - 0.07 + dy, cz + 0.04 + bh / 2 + dz),
                      rot=(rx, cfg.get('ry', 0.0), cfg.get('rz', 0.0)), bulge=(0.008, 0.03, 0.01), sag=0.0, wr=0.005,
                      seed=seed + 30 + i)
        P.append(ob)
    return P


@prop('sofa_torn', 'fabric', 'wohnzimmer',
      'Durchgesessenes 3-Sitzer-Sofa (80er), linkes Sitzkissen aufgerissen mit herausquellendem Schaumstoff, '
      'mittleres Kissen durchgesessen, rechtes verrutscht, Armlehne vorne aufgerissen. Schaumbrocken am Boden.')
def b_sofa():
    damage = dict(
        seats=[dict(tear=(-0.04, -0.06, 0.09), tear_r=0.105, crumbs=4, sag=0.015),
               dict(sag=0.05),
               dict(shift=(0.02, -0.05, radians(-4)), sag=0.02, rx=radians(-2))],
        backs=[dict(rx=radians(4)), dict(rx=radians(-3), rz=radians(2)),
               dict(shift=(0.03, -0.10, -0.06), rx=radians(26), ry=radians(-9), rz=radians(-6))],
        arm_tear=((0.03, -0.44, 0.13), 0.06), arm_tear_side=-1,
    )
    P = upholstered(2.06, 0.92, 0.84, 0.47, 3, damage=damage, seed=3)
    stains = [stain((0.05, -0.15, 0.47), 0.13, STAIN_DARK, ring=True), stain((0.6, -0.05, 0.48), 0.09, STAIN_DARK),
              stain((-0.55, 0.28, 0.65), 0.12, STAIN_YEL, ring=True), stain((0.9, -0.3, 0.6), 0.08, STAIN_DARK)]
    return finish('sofa_torn', P, grime=dict(stains=stains, dirt=0.25))


@prop('armchair_worn', 'fabric', 'wohnzimmer',
      'Passender Ohrensessel/Polstersessel, Kissen schief, rechte Armlehne vorne aufgerissen, Sitz fleckig.')
def b_armchair():
    damage = dict(
        seats=[dict(shift=(0.03, -0.03, radians(5)), sag=0.03, rx=radians(-3))],
        backs=[dict(rx=radians(6), rz=radians(-3), shift=(-0.01, 0.0, 0.0))],
        arm_tear=((-0.02, -0.44, 0.12), 0.05), arm_tear_side=1,
    )
    P = upholstered(0.94, 0.90, 0.92, 0.46, 1, arm_w=0.20, arm_h=0.62, damage=damage, seed=11)
    stains = [stain((0.0, -0.2, 0.46), 0.12, STAIN_DARK, ring=True), stain((-0.3, -0.3, 0.6), 0.06, STAIN_DARK)]
    ob = finish('armchair_worn', P, grime=dict(stains=stains, dirt=0.3))
    # etwas gruenlicher/ausgeblichener als das Sofa
    L.set_vertex_tint(ob, lambda p: (0.92, 0.95, 0.85))
    return ob


# ==============================================================================================
@prop('coffee_table', 'wood', 'wohnzimmer',
      'Couchtisch Eiche dunkel, Wasser-/Kaffeeraender (MU_coffee_rings, Alpha-Decal 1,2 mm ueber der Platte), '
      'abgeplatzte Ecke, Furnier vorne angehoben, Ablage unten.')
def b_coffee_table():
    P = []
    W, D, H = 1.10, 0.60, 0.45
    t = 0.028
    top = rb(W, D, t, r=0.007, step=0.06)
    # abgestossene Ecke vorne rechts + leichte Delle
    L.dent(top, (W / 2, -D / 2, t / 2), 0.045, 0.012, direction=(-0.5, 0.5, -0.7))
    L.dent(top, (-0.2, 0.1, t / 2), 0.08, 0.002)
    P.append(mk(top, 'cabinet_wood', loc=(0, 0, H - t / 2)))
    # Zarge
    ah = 0.075
    for s in (-1, 1):
        P.append(board(-W / 2 + 0.05, W / 2 - 0.05, s * (D / 2 - 0.045) - 0.009, s * (D / 2 - 0.045) + 0.009, H - t - ah, H - t,
                       'cabinet_wood', r=0.003))
        P.append(board(s * (W / 2 - 0.045) - 0.009, s * (W / 2 - 0.045) + 0.009, -D / 2 + 0.05, D / 2 - 0.05, H - t - ah, H - t,
                       'cabinet_wood', r=0.003))
    # Beine konisch
    for sx in (-1, 1):
        for sy in (-1, 1):
            lh = H - t
            bm = rb(0.05, 0.05, lh, r=0.006, step=0.2)
            L.deform(bm, lambda p, lh=lh: Vector((p.x * (0.7 + 0.3 * (p.z / lh + 0.5)), p.y * (0.7 + 0.3 * (p.z / lh + 0.5)), p.z)))
            P.append(mk(bm, 'cabinet_wood', loc=(sx * (W / 2 - 0.045), sy * (D / 2 - 0.045), lh / 2)))
    # Ablage
    P.append(board(-W / 2 + 0.03, W / 2 - 0.03, -D / 2 + 0.03, D / 2 - 0.03, 0.10, 0.118, 'cabinet_wood', r=0.003, step=0.15))
    # Furnierstreifen hebt sich (vorne links)
    bm, vs = L.grid(10, 1, lambda u, v: Vector((-0.42 + 0.26 * u, -D / 2 + 0.002 + 0.028 * v, H + 0.0004 + 0.012 * max(0, u - 0.45) ** 2 * 4)))
    _uv(bm, 'cabinet_wood')
    P.append(L.part(bm, M('cabinet_wood'), name='veneer', uv=None))
    # Decal-Ebene Wasserraender
    bm, vs = L.grid(1, 1, lambda u, v: Vector((-W / 2 + 0.01 + (W - 0.02) * u, -D / 2 + 0.01 + (D - 0.02) * v, H + 0.0012)))
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = ((co.x + W / 2) / W, (co.y + D / 2) / D)
    P.append(L.part(bm, M('coffee_rings'), name='rings', uv=None))
    stains = [stain((0.3, -0.1, H), 0.08, STAIN_WATER, ring=True)]
    return finish('coffee_table', P, grime=dict(stains=stains, dirt=0.18))


# ==============================================================================================
# Hilfen fuer Mehrmaterial-Teile
def mk_multi(bm, mats, loc=(0, 0, 0), rot=(0, 0, 0), name='pm'):
    """bm mit face.material_index -> Objekt mit mehreren Materialien. UVs muessen gesetzt sein."""
    bm.loops.layers.uv.verify()
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in mats:
        me.materials.append(M(m))
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = Euler(rot, 'XYZ')
    L._PARTS.append(ob)
    _XF[ob.name] = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    return ob


def book(w, h, d, loc, rot=(0, 0, 0), idx=None):
    """Buch: Ruecken nach -Y (Atlas MU_book_spines, 16 Ruecken), Deckel seitlich, Schnitt oben/unten/hinten."""
    idx = random.randrange(16) if idx is None else idx
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, v.co.y * d, v.co.z * h))
    # Ruecken leicht gewoelbt: mittlere Reihe einziehen geht ohne Extra-Verts nicht -> kleine Fase reicht
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-6 and e.verts[0].co.y < 0],
                    offset=min(w * 0.25, 0.006), segments=2, profile=0.5, affect='EDGES')
    uvl = bm.loops.layers.uv.verify()
    bm.normal_update()
    u0, u1 = idx / 16 + 0.006, (idx + 1) / 16 - 0.006
    for f in bm.faces:
        n = f.normal
        if n.y < -0.3:
            f.material_index = 0
            for l in f.loops:
                co = l.vert.co
                l[uvl].uv = (u0 + (co.x / w + 0.5) * (u1 - u0), 0.015 + (co.z / h + 0.5) * 0.97)
        elif abs(n.x) > 0.7:
            f.material_index = 1
            for l in f.loops:
                l[uvl].uv = (l.vert.co.y, l.vert.co.z)
        else:
            f.material_index = 2
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x, l.vert.co.y + l.vert.co.z)
    # Schnitt (Seiten) leicht einziehen: Deckel stehen ueber -> Seitenkanten bleiben
    return mk_multi(bm, ['book_spines', 'book_cover', 'paper_old'], loc, rot)


def book_row(x0, x1, z, y_front, depth_max, fill=1.0, lean_end=True, seed=0, hmax=0.27):
    """Buecherreihe auf einem Brett von x0 bis x1 (Ruecken buendig vorne bei y_front)."""
    rnd = random.Random(seed)
    P = []
    x = x0 + 0.004
    xend = x0 + (x1 - x0) * fill
    while x < xend - 0.02:
        w = rnd.uniform(0.018, 0.048)
        h = rnd.uniform(0.17, hmax)
        d = min(depth_max, rnd.uniform(0.11, 0.2))
        if x + w > xend:
            break
        yoff = rnd.uniform(0.0, 0.025)
        P.append(book(w, h, d, (x + w / 2, y_front + d / 2 + yoff, z + h / 2), rot=(0, 0, rnd.uniform(-0.03, 0.03))))
        x += w + rnd.uniform(0.0, 0.004)
    if lean_end and xend < x1 - 0.08:
        # letztes Buch lehnt schraeg
        w, h, d = 0.03, rnd.uniform(0.2, hmax), 0.16
        ang = radians(rnd.uniform(18, 32))
        cx = x + math.sin(ang) * h / 2 + w / 2
        P.append(book(w, h, d, (cx, y_front + d / 2 + 0.01, z + math.cos(ang) * h / 2 + math.sin(ang) * w / 2), rot=(0, ang, 0)))
    return P


def book_stack(cx, cy, z, n, seed=0, rz=0.0):
    rnd = random.Random(seed)
    P = []
    for i in range(n):
        w, h, d = rnd.uniform(0.025, 0.045), rnd.uniform(0.18, 0.26), rnd.uniform(0.13, 0.18)
        P.append(book(w, h, d, (cx + rnd.uniform(-0.01, 0.01), cy + rnd.uniform(-0.01, 0.01), z + w / 2),
                      rot=(0, radians(90), rz + rnd.uniform(-0.2, 0.2))))
        z += w
    return P


# ==============================================================================================
@prop('tv_crt', 'metal', 'wohnzimmer',
      '27"-Roehrenfernseher (90er), Kunststoffgehaeuse anthrazit, staubiger gewoelbter Bildschirm (MU_crt_screen), '
      'Lautsprechergitter, Tasten, Lueftungsschlitze, Netzkabel. Steht auf tv_stand (Oberkante 0,52 m).')
def b_tv():
    P = []
    W, H = 0.66, 0.54
    yF = -0.25
    # Frontrahmen
    bez = rb(W, 0.07, H, r=0.022, step=0.12)
    L.dent(bez, (W / 2, -0.035, H / 2), 0.05, 0.006, direction=(-0.6, 0.6, -0.3))
    P.append(mk(bez, 'plastic_tv', loc=(0, yF + 0.035, H / 2)))
    # Rueckteil (konisch zur Bildroehre)
    bd = 0.42
    bm = L.rbox(0.60, bd, 0.50, r=0.05, step=0.14)

    def taper(p):
        t = (p.y + bd / 2) / bd
        k = 1.0 - 0.42 * t ** 1.3
        return Vector((p.x * k, p.y, p.z * (1.0 - 0.32 * t ** 1.3) - 0.03 * t))
    L.deform(bm, taper)
    P.append(mk(bm, 'plastic_tv', loc=(0, yF + 0.065 + bd / 2, H / 2 + 0.005)))
    # Bildschirm gewoelbt
    sw, sh, sz = 0.53, 0.40, 0.305
    bm, vs = L.grid(20, 16, lambda u, v: Vector(((u - 0.5) * sw, yF - 0.004 - 0.016 * (1 - (2 * u - 1) ** 2 * 0.8) * (1 - (2 * v - 1) ** 2 * 0.8) + 0.006,
                                                  sz + (v - 0.5) * sh)))
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = ((co.x / sw) + 0.5, (co.z - sz) / sh + 0.5)
    # Normalen nach -Y
    bm.normal_update()
    if sum(f.normal.y for f in bm.faces) > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    P.append(L.part(bm, M('crt_screen'), name='screen', uv=None))
    # Bildschirm-Einfassung (Lippe)
    lip = 0.018
    for (x0, x1, z0, z1) in ((-sw / 2 - lip, sw / 2 + lip, sz + sh / 2, sz + sh / 2 + lip),
                             (-sw / 2 - lip, sw / 2 + lip, sz - sh / 2 - lip, sz - sh / 2),
                             (-sw / 2 - lip, -sw / 2, sz - sh / 2, sz + sh / 2),
                             (sw / 2, sw / 2 + lip, sz - sh / 2, sz + sh / 2)):
        P.append(board(x0, x1, yF - 0.008, yF + 0.01, z0, z1, 'plastic_black', r=0.004))
    # Lautsprechergitter (Schlitze) links/rechts unten
    for s in (-1, 1):
        for i in range(9):
            x = s * 0.12 + (i - 4) * 0.012
            P.append(board(x - 0.0035, x + 0.0035, yF - 0.003, yF + 0.002, 0.035, 0.075, 'plastic_black', r=0.0015))
    # Tasten + Netzschalter + LED
    for i in range(4):
        P.append(cyl(0.006, 0.006, 'plastic_grey', loc=(0.21 + i * 0.022, yF + 0.002, 0.055), rot=(radians(90), 0, 0), segs=10))
    P.append(board(-0.29, -0.25, yF - 0.006, yF + 0.002, 0.04, 0.07, 'plastic_grey', r=0.003))
    P.append(cyl(0.003, 0.004, 'plastic_black', loc=(-0.23, yF + 0.002, 0.055), rot=(radians(90), 0, 0), segs=8))
    # Lueftungsschlitze oben hinten
    for i in range(10):
        y = yF + 0.20 + i * 0.022
        t = (y - (yF + 0.065)) / bd
        ztop = H / 2 + 0.005 + (0.25 * (1.0 - 0.32 * t ** 1.3) - 0.03 * t)
        P.append(board(-0.16 * (1 - 0.4 * t), 0.16 * (1 - 0.4 * t), y - 0.004, y + 0.004, ztop - 0.012, ztop + 0.002, 'plastic_black', r=0.002))
    # Fuesse
    for sx in (-1, 1):
        for sy in (0.0, 0.3):
            P.append(cyl(0.018, 0.008, 'rubber_black', loc=(sx * 0.22, yF + 0.06 + sy, 0.0), segs=10))
    # Netzkabel hinten raus, liegt auf der Stellflaeche
    pts = catmull([(0.12, yF + 0.47, 0.12), (0.14, yF + 0.53, 0.05), (0.16, yF + 0.57, 0.006), (0.05, yF + 0.66, 0.004),
                   (-0.15, yF + 0.63, 0.004)], 5)
    P.append(tube(pts, 0.0035, 'cord_black', sides=6))
    return finish('tv_crt', P, grime=dict(dirt=0.12, floor_dirt=0.05, ao_strength=0.5))


@prop('tv_stand', 'wood', 'wohnzimmer',
      'TV-Moebel Eiche-Furnier: linke Tuer fehlt, rechte Tuer haengt schief an einem Scharnier, '
      'Videorekorder und VHS-Kassetten im Fach, Rueckwand Hartfaser. Oberkante 0,52 m (tv_crt darauf).')
def b_tv_stand():
    P = []
    W, D, H = 1.00, 0.45, 0.52
    t = 0.019
    wood = 'cabinet_wood'
    P.append(board(-W / 2, W / 2, -D / 2, D / 2, H - 0.025, H, wood, r=0.005, step=0.15))
    P.append(board(-W / 2, -W / 2 + t, -D / 2 + 0.01, D / 2 - 0.005, 0.0, H - 0.025, wood, r=0.003, step=0.2))
    P.append(board(W / 2 - t, W / 2, -D / 2 + 0.01, D / 2 - 0.005, 0.0, H - 0.025, wood, r=0.003, step=0.2))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.03, D / 2 - 0.01, 0.06, 0.06 + t, wood, r=0.002, step=0.2))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.035, -D / 2 + 0.035 + t, 0.0, 0.06, wood, r=0.002))   # Sockelblende
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.03, D / 2 - 0.01, 0.27, 0.27 + t, wood, r=0.002, step=0.2))
    P.append(board(-0.005, 0.012, -D / 2 + 0.02, D / 2 - 0.01, 0.06, 0.27, wood, r=0.002))  # Mittelwand
    P.append(board(-W / 2 + 0.005, W / 2 - 0.005, D / 2 - 0.012, D / 2 - 0.006, 0.02, H - 0.026, 'hardboard', r=0.001))
    # rechte Tuer: an unterem Scharnier, oben ausgerissen -> schief und offen
    dw, dh = W / 2 - t - 0.01, 0.20
    door = board(0.0, dw, -0.01, 0.008, 0.0, dh, wood, r=0.003)
    rimp = board(0.03, dw - 0.03, -0.016, -0.009, 0.03, dh - 0.03, wood, r=0.002)
    knob = cyl(0.009, 0.02, 'brass_tarnished', loc=(0.04, -0.016, dh / 2), rot=(radians(90), 0, 0), segs=10)
    for o in (door, rimp, knob):
        L.transform_obj(o, loc=(0.012, -D / 2 + 0.01, 0.067), rot=(radians(-6), radians(-4), radians(-62)), pivot=(dw, 0, 0))
    P += [door, rimp, knob]
    # Videorekorder im linken Fach unten
    vx, vy = -0.25, -0.02
    P.append(box(0.36, 0.27, 0.085, 'plastic_black', loc=(vx, vy, 0.06 + t + 0.0425), r=0.004, step=0.2))
    P.append(board(vx - 0.16, vx + 0.02, vy - 0.137, vy - 0.133, 0.06 + t + 0.03, 0.06 + t + 0.055, 'plastic_grey', r=0.002))  # Kassettenschacht
    P.append(board(vx + 0.06, vx + 0.15, vy - 0.138, vy - 0.133, 0.06 + t + 0.045, 0.06 + t + 0.06, 'plastic_tv', r=0.001))
    for i in range(5):
        P.append(cyl(0.004, 0.004, 'plastic_grey', loc=(vx + 0.06 + i * 0.018, vy - 0.136, 0.06 + t + 0.025), rot=(radians(90), 0, 0), segs=8))
    # VHS-Kassetten im rechten Fach (gestapelt + umgekippt)
    for i in range(3):
        P.append(box(0.188, 0.104, 0.025, 'plastic_black', loc=(0.25 + random.uniform(-0.01, 0.01), -0.05, 0.06 + t + 0.0125 + i * 0.025),
                     rot=(0, 0, random.uniform(-0.15, 0.15)), r=0.002))
    P.append(box(0.188, 0.104, 0.025, 'plastic_black', loc=(0.33, 0.08, 0.06 + t + 0.052), rot=(radians(90), radians(20), 0.3), r=0.002))
    # VHS im oberen Fach
    for i in range(4):
        P.append(box(0.025, 0.104, 0.188, 'plastic_black', loc=(-0.42 + i * 0.027, 0.0, 0.27 + t + 0.094), r=0.002))
    stains = [stain((0.3, 0.0, H), 0.07, STAIN_WATER, ring=True)]
    return finish('tv_stand', P, grime=dict(stains=stains, dirt=0.2))


@prop('floor_lamp_bare', 'metal', 'wohnzimmer',
      'Stehlampe Messing angelaufen, ohne Schirm: verbogener Schirmhalter, nackte (aus) Gluehbirne, Kabel am Boden. '
      'Stange leicht schief.')
def b_floor_lamp():
    P = []
    br = 'brass_tarnished'
    prof = [(0.0, 0.0), (0.135, 0.0), (0.14, 0.006), (0.138, 0.016), (0.12, 0.026), (0.07, 0.036), (0.03, 0.042), (0.016, 0.05), (0.0, 0.05)]
    base = lathe_part(prof, br, segs=28)
    P.append(base)
    tilt = radians(2.5)
    Rt = Euler((tilt, 0, 0)).to_matrix()
    top = 1.50
    stem = []
    zs = [0.045, 0.52, 0.53, 1.0, 1.01, top]
    for i in range(0, len(zs) - 1, 2):
        stem.append(cyl(0.0105, zs[i + 1] - zs[i], br, loc=(0, 0, zs[i]), segs=12, bevel=0.001))
        if i + 2 < len(zs):
            stem.append(cyl(0.014, 0.018, br, loc=(0, 0, zs[i + 1] - 0.004), segs=12, bevel=0.002))
    # Fassung
    sprof = [(0.0, 0.0), (0.012, 0.0), (0.02, 0.01), (0.021, 0.05), (0.019, 0.075), (0.0, 0.075)]
    stem.append(lathe_part(sprof, br, loc=(0, 0, top), segs=16))
    stem.append(cyl(0.004, 0.02, br, loc=(0.02, 0, top + 0.04), rot=(0, radians(90), 0), segs=8))  # Drehschalter
    # Gluehbirne (aus)
    bprof = [(0.0, 0.0), (0.0125, 0.0), (0.0125, 0.022), (0.016, 0.03), (0.028, 0.06), (0.031, 0.085), (0.026, 0.105), (0.014, 0.117), (0.0, 0.12)]
    stem.append(lathe_part(bprof, 'glass_dirty', loc=(0, 0, top + 0.068), segs=16))
    stem.append(cyl(0.0128, 0.022, 'steel', loc=(0, 0, top + 0.066), segs=12))
    # Schirmhalter (Harfe), verbogen
    hz = top - 0.01
    harp = []
    for s in (-1, 1):
        harp.append([(s * 0.022, 0, hz + 0.01), (s * 0.06, 0.0, hz + 0.07), (s * 0.075, 0.0, hz + 0.17), (s * 0.045, 0.0, hz + 0.25), (0, 0, hz + 0.265)])
    pts = catmull(list(reversed(harp[0])) + harp[1][1:], 4)
    # Verbiegen: oben zur Seite gedrueckt
    pts = [Vector((p.x + 0.05 * max(0, p.z - hz - 0.08) / 0.2, p.y - 0.06 * max(0, p.z - hz - 0.1) / 0.17, p.z)) for p in pts]
    stem.append(tube(pts, 0.0025, br, sides=6))
    stem.append(cyl(0.006, 0.02, br, loc=(pts[len(pts) // 2].x, pts[len(pts) // 2].y, pts[len(pts) // 2].z), segs=8))  # Finial
    for o in stem:
        L.transform_obj(o, rot=(tilt, 0, 0), pivot=(0, 0, 0.04))
    P += stem
    # Kabel aus dem Fuss ueber den Boden
    pts = catmull([(0.13, 0.02, 0.004), (0.3, 0.1, 0.004), (0.45, -0.05, 0.004), (0.6, 0.12, 0.004), (0.66, 0.30, 0.004)], 6)
    P.append(tube(pts, 0.003, 'cord_black', sides=6))
    P.append(box(0.025, 0.035, 0.016, 'plastic_black', loc=(0.67, 0.33, 0.008), rot=(0, 0, 0.4), r=0.003))
    return finish('floor_lamp_bare', P, grime=dict(dirt=0.25, ao_dist=0.1))


# ---------------------------------------------------------------- Buecherregal
def shelf_unit(W=0.80, D=0.30, H=1.83, books=True, seed=0, sag_shelf=2):
    P = []
    t = 0.018
    wood = 'cabinet_wood'
    for s in (-1, 1):
        P.append(board(s * W / 2 - (t if s > 0 else 0), s * W / 2 + (t if s < 0 else 0), -D / 2, D / 2, 0.0, H, wood, r=0.003, step=0.25))
    P.append(board(-W / 2, W / 2, -D / 2, D / 2, H - t, H, wood, r=0.003, step=0.25))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.01, -D / 2 + 0.01 + t, 0.0, 0.07, wood, r=0.002))
    P.append(board(-W / 2 + 0.004, W / 2 - 0.004, D / 2 - 0.006, D / 2, 0.01, H - 0.01, 'hardboard', r=0.001, step=0.3))
    levels = [0.07, 0.42, 0.76, 1.10, 1.45]
    for i, z in enumerate(levels):
        if i == sag_shelf:
            bm = rb(W - 2 * t, D - 0.01, t, r=0.002, step=0.08)
            L.deform(bm, lambda p, W=W: Vector((p.x, p.y, p.z - 0.018 * (1 - (2 * p.x / (W - 2 * t)) ** 2))))
            P.append(mk(bm, wood, loc=(0, -0.005, z + t / 2)))
        else:
            P.append(board(-W / 2 + t, W / 2 - t, -D / 2, D / 2 - 0.006, z, z + t, wood, r=0.002, step=0.25))
    if books:
        yF = -D / 2 + 0.012
        x0, x1 = -W / 2 + t, W / 2 - t
        P += book_row(x0, x1, levels[0] + t, yF, D - 0.03, fill=0.85, seed=seed + 1)
        P += book_row(x0, x1, levels[1] + t, yF, D - 0.03, fill=0.35, seed=seed + 2)
        P += book_stack(0.2, -0.02, levels[1] + t, 4, seed=seed + 3, rz=0.1)
        P += book_row(x0, x1, levels[2] + t - 0.012, yF, D - 0.03, fill=0.2, seed=seed + 4)
        P += book_row(x0, x1, levels[3] + t, yF, D - 0.03, fill=0.55, seed=seed + 5, hmax=0.3)
        P += book_stack(-0.2, 0.0, levels[4] + t, 2, seed=seed + 6, rz=-0.3)
    return P


@prop('bookshelf', 'wood', 'wohnzimmer',
      'Buecherregal 0,80 x 0,30 x 1,83 m, 5 Boeden (mittlerer durchgebogen), Buecher teils herausgenommen/umgefallen, '
      'Buchruecken MU_book_spines.')
def b_bookshelf():
    P = shelf_unit(seed=5)
    return finish('bookshelf', P, grime=dict(dirt=0.22))


@prop('bookshelf_toppled', 'wood', 'wohnzimmer',
      'Dasselbe Regal umgekippt (liegt vornueber auf Buechern, ein Ende angehoben), Buecher ueber den Boden verstreut. '
      'Footprint ~0,9 x 2,3 m.')
def b_bookshelf_toppled():
    S = shelf_unit(books=False, seed=9, sag_shelf=-1)
    # vornueber gekippt: Front (-Y) nach unten. Drehung um X um +90 Grad -> -Y zeigt nach -Z
    for o in S:
        L.transform_obj(o, rot=(radians(90), 0, radians(180)), pivot=(0, 0, 0))
    for o in S:
        L.transform_obj(o, loc=(0, 0, 0.15), rot=(0, 0, 0))
        # Kopfende liegt auf Buechern: leicht angehoben (Drehung um X am Fussende)
        L.transform_obj(o, rot=(radians(3.2), 0, 0), pivot=(0, 0.0, 0.0))
    P = list(S)
    rnd = random.Random(4)
    # Buecher unter dem Kopfende (stuetzen) + verstreut
    P += book_stack(0.05, 1.6, 0.0, 2, seed=11, rz=0.4)
    for i in range(16):
        ang = rnd.uniform(0, 2 * pi)
        x = rnd.choice([-1, 1]) * rnd.uniform(0.45, 0.75)
        y = rnd.uniform(0.0, 1.9)
        if i > 11:
            x, y = rnd.uniform(-0.5, 0.5), rnd.uniform(-0.45, -0.15)
        w, h, d = rnd.uniform(0.02, 0.045), rnd.uniform(0.17, 0.27), rnd.uniform(0.12, 0.18)
        if rnd.random() < 0.7:
            P.append(book(w, h, d, (x, y, w / 2), rot=(0, radians(90), ang)))
        else:
            # auf dem Ruecken / Schnitt liegend
            P.append(book(w, h, d, (x, y, d / 2), rot=(radians(90), 0, ang)))
    return finish('bookshelf_toppled', P, grime=dict(dirt=0.22), center_xy=True)


# ---------------------------------------------------------------- Essplatz
def turned_leg(h, top_block=0.11, r=0.024):
    prof = [(0.0, 0.0), (r * 0.62, 0.0), (r * 0.7, 0.01), (r * 0.72, h * 0.25), (r * 0.9, h * 0.45), (r, h * 0.52), (r * 0.78, h * 0.58),
            (r * 0.95, h * 0.68), (r * 0.8, h - top_block - 0.02), (r * 1.05, h - top_block - 0.006), (r * 1.05, h - top_block), (0.0, h - top_block)]
    return prof


@prop('dining_table', 'wood', 'esszimmer',
      'Esstisch 1,50 x 0,90 m, gedrechselte Beine, Zarge, Platte mit Dellen/Kratzern und Wasserrand.')
def b_dining_table():
    P = []
    W, D, H = 1.50, 0.90, 0.76
    t = 0.03
    wood = 'cabinet_wood'
    top = rb(W, D, t, r=0.008, step=0.08)
    L.dent(top, (-W / 2, D / 2, t / 2), 0.05, 0.01, direction=(0.6, -0.6, -0.5))
    L.dent(top, (0.3, -0.1, t / 2), 0.06, 0.0025)
    P.append(mk(top, wood, loc=(0, 0, H - t / 2)))
    ah = 0.09
    for s in (-1, 1):
        P.append(board(-W / 2 + 0.09, W / 2 - 0.09, s * (D / 2 - 0.07) - 0.01, s * (D / 2 - 0.07) + 0.01, H - t - ah, H - t, wood, r=0.003, step=0.3))
        P.append(board(s * (W / 2 - 0.07) - 0.01, s * (W / 2 - 0.07) + 0.01, -D / 2 + 0.09, D / 2 - 0.09, H - t - ah, H - t, wood, r=0.003, step=0.3))
    lh = H - t
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W / 2 - 0.08), sy * (D / 2 - 0.08)
            P.append(lathe_part(turned_leg(lh, 0.11, 0.03), wood, loc=(x, y, 0), segs=12))
            P.append(box(0.06, 0.06, 0.11, wood, loc=(x, y, lh - 0.055), r=0.004))
    stains = [stain((-0.3, 0.1, H), 0.07, STAIN_WATER, ring=True), stain((0.45, -0.2, H), 0.12, STAIN_DARK)]
    return finish('dining_table', P, grime=dict(stains=stains, dirt=0.2))


def chair_parts(seed=0):
    P = []
    wood = 'cabinet_wood'
    sw, sd, sh = 0.44, 0.42, 0.46
    # Beine
    for sx in (-1, 1):
        P.append(lathe_part(turned_leg(sh - 0.03, 0.08, 0.019), wood, loc=(sx * (sw / 2 - 0.03), -sd / 2 + 0.03, 0), segs=10))
        P.append(box(0.036, 0.036, 0.08, wood, loc=(sx * (sw / 2 - 0.03), -sd / 2 + 0.03, sh - 0.07), r=0.003))
    # Hinterbeine + Rueckenpfosten (durchgehend, nach hinten geneigt)
    for sx in (-1, 1):
        pts = [Vector((sx * (sw / 2 - 0.03), sd / 2 - 0.03, 0.0)), Vector((sx * (sw / 2 - 0.03), sd / 2 - 0.025, sh)),
               Vector((sx * (sw / 2 - 0.035), sd / 2 + 0.04, 0.92))]
        pts = catmull(pts, 6)
        bm = L.tube(pts, 0.017, sides=8)
        P.append(mk(bm, wood))
    # Zarge
    for s in (-1, 1):
        P.append(board(-sw / 2 + 0.03, sw / 2 - 0.03, s * (sd / 2 - 0.03) - 0.009, s * (sd / 2 - 0.03) + 0.009, sh - 0.1, sh - 0.03, wood, r=0.002))
        P.append(board(s * (sw / 2 - 0.03) - 0.009, s * (sw / 2 - 0.03) + 0.009, -sd / 2 + 0.03, sd / 2 - 0.03, sh - 0.1, sh - 0.03, wood, r=0.002))
    # Querstreben unten
    for s in (-1, 1):
        P.append(cyl(0.009, sd - 0.06, wood, loc=(s * (sw / 2 - 0.03), -sd / 2 + 0.03, 0.16), rot=(radians(-90), 0, 0), segs=8))
    P.append(cyl(0.009, sw - 0.06, wood, loc=(-sw / 2 + 0.03, 0.0, 0.2), rot=(0, radians(90), 0), segs=8))
    # Sitz: Brett + Polster (Stoff, an der Vorderkante aufgerissen)
    P.append(board(-sw / 2 + 0.005, sw / 2 - 0.005, -sd / 2 + 0.005, sd / 2 - 0.005, sh - 0.03, sh - 0.012, wood, r=0.004))
    cu = _cushion(sw - 0.02, sd - 0.03, 0.04, 0.018, 0.06, loc=(0, -0.005, sh + 0.006), bulge=(0.003, 0.003, 0.01), wr=0.002, seed=seed)
    P.append(cu)
    # Rueckenlehne: oberer Bogen + 3 Sprossen
    yb = sd / 2 + 0.035
    rail = L.rbox(sw - 0.08, 0.022, 0.08, r=0.008, step=0.06)
    L.deform(rail, lambda p, sw=sw: Vector((p.x, p.y + 0.03 * (p.x / (sw / 2)) ** 2, p.z)))
    P.append(mk(rail, wood, loc=(0, yb - 0.005, 0.86)))
    for i in (-1, 0, 1):
        x = i * 0.09
        P.append(cyl(0.009, 0.31, wood, loc=(x, yb - 0.025 + 0.0, 0.51), rot=(radians(-6), 0, 0), segs=8))
    return P


@prop('dining_chair', 'wood', 'esszimmer',
      'Esszimmerstuhl Holz mit Stoffpolster (Sitzhoehe 0,46 m). Mehrfach aufstellen (3x stehend).')
def b_chair():
    P = chair_parts(seed=1)
    return finish('dining_chair', P, grime=dict(dirt=0.22), center_xy=True)


@prop('dining_chair_tipped', 'wood', 'esszimmer',
      'Derselbe Stuhl nach hinten umgekippt (liegt auf Lehne und Hinterbeinen).', variantOf='dining_chair')
def b_chair_tipped():
    P = chair_parts(seed=2)
    # Winkel so, dass Lehnenoberkante und Hinterbeinfuss den Boden beruehren
    a, b = Vector((0, 0.18, 0.0)), Vector((0, 0.26, 0.92))
    best = None
    for k in range(600):
        th = radians(60 + k * 0.1)
        R = Euler((-th, 0, 0)).to_matrix()
        za, zb = (R @ a).z, (R @ b).z
        if best is None or abs(za - zb) < best[0]:
            best = (abs(za - zb), th)
    for o in P:
        L.transform_obj(o, rot=(-best[1], 0, 0), pivot=(0, 0, 0))
        L.transform_obj(o, rot=(0, 0, radians(12)), pivot=(0, 0, 0))
    return finish('dining_chair_tipped', P, grime=dict(dirt=0.22), center_xy=True)


# ---------------------------------------------------------------- Schlafzimmer
@prop('mattress_floor', 'fabric', 'schlafzimmer',
      'Queen-Matratze 1,52 x 2,03 m direkt auf dem Boden, durchgelegen, Ecke hochgebogen, grosse Urin-/Wasserflecken, Keder.')
def b_mattress():
    P = []
    W, Lm, T = 1.52, 2.03, 0.23
    bm = L.rbox(W, Lm, T, r=0.06, step=0.075)
    puff(bm, (W, Lm, T), 0.01, 0.01, 0.012)
    hx, hy, hz = W / 2, Lm / 2, T / 2
    for v in bm.verts:
        x, y, z = v.co
        # durchgelegen
        k = max(0, 1 - (x / (hx * 1.1)) ** 2) * max(0, 1 - ((y + 0.15) / (hy * 1.05)) ** 2)
        if z > -hz * 0.4:
            v.co.z -= 0.04 * k * (z + hz) / T
        # Tufting-Dellen (Raster 0.25 m)
        if z > hz * 0.6:
            gx = (x + 10) % 0.25 - 0.125
            gy = (y + 10) % 0.25 - 0.125
            d = math.hypot(gx, gy)
            if d < 0.05:
                v.co.z -= 0.009 * (0.5 + 0.5 * math.cos(pi * d / 0.05))
        # Ecke vorne rechts hochgebogen
        cx, cy = x - hx, y + hy
        dc = math.hypot(cx, cy)
        if dc < 0.55:
            v.co.z += 0.09 * (1 - dc / 0.55) ** 2
    wrinkle(bm, 0.004, 5.0, 3)
    P.append(mk(bm, 'mattress_stained', loc=(0, 0, T / 2)))
    # Keder oben/unten (folgt grob der Kante)
    for zz in (T - 0.012, 0.012):
        pts = []
        n = 64
        for i in range(n + 1):
            a = 2 * pi * i / n
            # abgerundetes Rechteck
            ca, sa = cos(a), sin(a)
            x = math.copysign(min(1, abs(ca) * 1.6) ** 1, ca) * (hx - 0.004)
            y = math.copysign(min(1, abs(sa) * 1.6) ** 1, sa) * (hy - 0.004)
            z = zz
            cx, cy = x - hx, y + hy
            dc = math.hypot(cx, cy)
            if dc < 0.55 and zz > 0.1:
                z += 0.09 * (1 - dc / 0.55) ** 2
            if dc < 0.55 and zz < 0.1:
                z += 0.09 * (1 - dc / 0.55) ** 2 * 0.6
            pts.append((x, y, z))
        P.append(tube(pts, 0.006, 'mattress_stained', sides=6, caps=False))
    stains = [stain((0.2, 0.1, T), 0.32, STAIN_YEL, ring=True), stain((-0.35, -0.5, T), 0.22, STAIN_YEL, ring=True),
              stain((-0.2, 0.6, T), 0.15, STAIN_DARK), stain((0.5, -0.2, T), 0.1, (0.5, 0.35, 0.3)),
              stain((0.0, -0.8, T), 0.18, STAIN_WATER, ring=True)]
    return finish('mattress_floor', P, grime=dict(stains=stains, dirt=0.3, floor_dirt=0.25))


@prop('bed_frame', 'wood', 'schlafzimmer',
      'Bettgestell Queen (Holz) ohne Matratze: Kopfteil hinten (+Y), Lattenrost mit fehlenden/gebrochenen Latten.')
def b_bed_frame():
    P = []
    wood = 'cabinet_wood'
    W, Lb = 1.60, 2.10
    hx, hy = W / 2, Lb / 2
    # Pfosten
    for sx in (-1, 1):
        P.append(box(0.07, 0.07, 1.05, wood, loc=(sx * (hx - 0.035), hy - 0.035, 0.525), r=0.008, step=0.3))
        P.append(lathe_part([(0.0, 0.0), (0.03, 0.0), (0.033, 0.015), (0.02, 0.035), (0.026, 0.05), (0.0, 0.06)], wood,
                            loc=(sx * (hx - 0.035), hy - 0.035, 1.05), segs=12))
        P.append(box(0.07, 0.07, 0.55, wood, loc=(sx * (hx - 0.035), -hy + 0.035, 0.275), r=0.008, step=0.3))
    # Kopfteil: Rahmen + Fuellung
    P.append(board(-hx + 0.07, hx - 0.07, hy - 0.05, hy - 0.02, 0.40, 0.48, wood, r=0.005))
    top = L.rbox(W - 0.14, 0.04, 0.12, r=0.012, step=0.1)
    L.deform(top, lambda p: Vector((p.x, p.y, p.z + 0.08 * (1 - (p.x / (W / 2)) ** 2))))
    P.append(mk(top, wood, loc=(0, hy - 0.035, 0.88)))
    P.append(board(-hx + 0.07, hx - 0.07, hy - 0.042, hy - 0.028, 0.48, 0.86, wood, r=0.003, step=0.25))
    # Fussteil
    P.append(board(-hx + 0.07, hx - 0.07, -hy + 0.02, -hy + 0.05, 0.20, 0.50, wood, r=0.005, step=0.25))
    # Seitenholme
    for sx in (-1, 1):
        P.append(board(sx * (hx - 0.035) - 0.016, sx * (hx - 0.035) + 0.016, -hy + 0.07, hy - 0.07, 0.20, 0.38, wood, r=0.004, step=0.3))
        P.append(board(sx * (hx - 0.035) - (0.016 + 0.025 if sx > 0 else -0.016), sx * (hx - 0.035) + (-0.016 if sx > 0 else 0.016 + 0.025),
                       -hy + 0.07, hy - 0.07, 0.24, 0.265, wood, r=0.002, step=0.3))
    # Mittelholm
    P.append(board(-0.02, 0.02, -hy + 0.07, hy - 0.07, 0.20, 0.265, wood, r=0.003, step=0.3))
    P.append(box(0.04, 0.04, 0.20, wood, loc=(0, 0, 0.10), r=0.004))
    # Latten
    n = 13
    xs0, xs1 = -hx + 0.035 - 0.016 + 0.0, hx - 0.035 + 0.016
    for i in range(n):
        y = -hy + 0.17 + i * (Lb - 0.34) / (n - 1)
        if i in (4, 9):
            continue  # fehlen
        if i == 6:
            # gebrochen: zwei Haelften haengen in V-Form durch
            for s in (-1, 1):
                o = board(0, s * (hx - 0.06), y - 0.04, y + 0.04, 0.265, 0.283, 'wood_planks_raw', r=0.002)
                L.transform_obj(o, rot=(0, s * radians(9), 0), pivot=(s * (hx - 0.06), y, 0.283))
                P.append(o)
            continue
        dz = 0.0 if i != 11 else 0.0
        o = board(xs0 + 0.02, xs1 - 0.02, y - 0.04, y + 0.04, 0.265, 0.283, 'wood_planks_raw', r=0.002, step=0.4)
        if i == 2:
            L.transform_obj(o, loc=(0.05, 0.03, 0), rot=(0, 0, radians(5)), pivot=(0, y, 0))
        P.append(o)
    return finish('bed_frame', P, grime=dict(dirt=0.22))


def drawer(w, h, depth, loc, pull='bail', front_mat='cabinet_wood'):
    """Schublade: Front (Mitte loc, Frontflaeche bei loc.y) + Kasten nach +Y."""
    x, y, z = loc
    P = []
    P.append(board(x - w / 2, x + w / 2, y, y + 0.02, z - h / 2, z + h / 2, front_mat, r=0.004, step=0.3))
    bw, bh = w - 0.05, h - 0.04
    for s in (-1, 1):
        P.append(board(x + s * bw / 2 - 0.006, x + s * bw / 2 + 0.006, y + 0.02, y + depth, z - h / 2 + 0.015, z - h / 2 + 0.015 + bh, 'particleboard', r=0.0015))
    P.append(board(x - bw / 2, x + bw / 2, y + depth - 0.012, y + depth, z - h / 2 + 0.015, z - h / 2 + 0.015 + bh * 0.85, 'particleboard', r=0.0015))
    P.append(board(x - bw / 2, x + bw / 2, y + 0.02, y + depth, z - h / 2 + 0.012, z - h / 2 + 0.018, 'hardboard', r=0.001))
    if pull == 'bail':
        for s in (-1, 1):
            P.append(box(0.022, 0.004, 0.03, 'brass_tarnished', loc=(x + s * 0.045, y - 0.002, z + 0.01), r=0.0015))
        pts = [(x - 0.045, y - 0.006, z + 0.005)] + [(x + 0.045 * cos(a), y - 0.006 - 0.012 * sin(a) * 0.4, z + 0.005 - 0.03 * sin(a))
                                                     for a in [pi - pi * k / 8 for k in range(1, 8)]] + [(x + 0.045, y - 0.006, z + 0.005)]
        P.append(tube(pts, 0.003, 'brass_tarnished', sides=6))
    else:
        P.append(lathe_part([(0.0, 0.0), (0.008, 0.0), (0.006, 0.012), (0.014, 0.022), (0.012, 0.03), (0.0, 0.032)], 'brass_tarnished',
                            loc=(x, y, z), rot=(radians(90), 0, 0), segs=10))
    return P


def cloth_drape(x0, x1, y0, z0, hang, seed, mat='cloth_grey', depth=0.18):
    """Kleidungsstueck haengt ueber eine Kante (y0, z0) heraus: liegt hinten im Kasten, faellt vorne runter."""
    rnd = random.Random(seed)

    def fn(u, v):
        x = x0 + (x1 - x0) * u
        s = v * (depth + hang)
        if s < depth:
            p = Vector((x, y0 + depth - s, z0 - 0.01 + 0.02 * math.sin(u * 7 + seed)))
        else:
            k = s - depth
            p = Vector((x, y0 - 0.02 * math.sin(min(k, 0.05) / 0.05 * pi / 2), z0 - k))
        n = noise.noise(Vector((u * 3 + seed, v * 3, 0.5)))
        return p + Vector((0.02 * n, -0.015 * abs(math.sin(u * 9 + seed)) * min(1, s / 0.05), 0.01 * n))
    bm, vs = L.grid(10, 10, fn)
    wrinkle(bm, 0.006, 25, seed)
    return mk(bm, mat)


@prop('dresser_open', 'wood', 'schlafzimmer',
      'Kommode 1,20 x 0,48 x 0,82 m, 6 Schubladen, mehrere herausgezogen, eine liegt umgekippt davor, '
      'Kleidung haengt heraus, Messing-Buegelgriffe.')
def b_dresser():
    P = []
    wood = 'cabinet_wood'
    W, D, H = 1.20, 0.48, 0.82
    t = 0.02
    P.append(board(-W / 2 - 0.012, W / 2 + 0.012, -D / 2 - 0.015, D / 2, H - 0.028, H, wood, r=0.006, step=0.15))
    for s in (-1, 1):
        P.append(board(s * W / 2 - (t if s > 0 else 0), s * W / 2 + (t if s < 0 else 0), -D / 2, D / 2 - 0.004, 0.0, H - 0.028, wood, r=0.003, step=0.25))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.03, -D / 2 + 0.05, 0.0, 0.07, wood, r=0.002))
    P.append(board(-W / 2 + 0.004, W / 2 - 0.004, D / 2 - 0.006, D / 2, 0.01, H - 0.03, 'hardboard', r=0.001, step=0.3))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.01, D / 2 - 0.006, 0.07, 0.085, wood, r=0.002, step=0.3))
    P.append(board(-0.01, 0.01, -D / 2, D / 2 - 0.006, 0.085, H - 0.028, wood, r=0.002, step=0.3))
    rows = [0.085, 0.33, 0.575, H - 0.028]
    for z in rows[1:-1]:
        P.append(board(-W / 2 + t, W / 2 - t, -D / 2, -D / 2 + 0.03, z - 0.008, z + 0.008, wood, r=0.002))
    cw = (W - 2 * t - 0.02) / 2
    pulls = {(0, 0): 0.0, (0, 1): 0.06, (1, 0): 0.24, (1, 1): None, (2, 0): 0.02, (2, 1): 0.33}
    for r in range(3):
        z0, z1 = rows[r] + 0.004, rows[r + 1] - 0.004
        for c in range(2):
            x = -W / 2 + t + cw / 2 + c * (cw + 0.02)
            out = pulls[(r, c)]
            if out is None:
                continue
            P += drawer(cw - 0.006, z1 - z0, D - 0.06, (x, -D / 2 - 0.02 - out, (z0 + z1) / 2))
            if (r, c) == (2, 1):
                P.append(cloth_drape(x - 0.2, x + 0.05, -D / 2 - out, z1 - 0.02, 0.33, 4, 'cloth_denim'))
            if (r, c) == (1, 0):
                P.append(cloth_drape(x - 0.05, x + 0.18, -D / 2 - out, z1 - 0.03, 0.18, 7, 'cloth_red'))
    # herausgefallene Schublade: liegt kopfueber schraeg vor der Kommode
    z0, z1 = rows[1] + 0.004, rows[2] - 0.004
    dr = drawer(cw - 0.006, z1 - z0, D - 0.06, (0, 0, 0))
    for o in dr:
        L.transform_obj(o, rot=(radians(180), radians(-12), radians(28)), pivot=(0, 0.2, 0))
        L.transform_obj(o, loc=(0.35, -0.88, (z1 - z0) / 2 + 0.05))
    P += dr
    P.append(cloth_drape(0.15, 0.45, -0.62, 0.03, 0.03, 9, 'cloth_white', depth=0.2))
    return finish('dresser_open', P, grime=dict(dirt=0.22), center_xy=False)


@prop('wardrobe_open', 'wood', 'schlafzimmer',
      'Kleiderschrank 1,00 x 0,58 x 1,95 m, linke Tuer weit offen (Scharnier links), rechte angelehnt; '
      'Kleiderstange mit Drahtbuegeln, Kleiderhaufen am Boden.')
def b_wardrobe():
    P = []
    wood = 'cabinet_wood'
    W, D, H = 1.00, 0.58, 1.95
    t = 0.02
    for s in (-1, 1):
        P.append(board(s * W / 2 - (t if s > 0 else 0), s * W / 2 + (t if s < 0 else 0), -D / 2 + 0.02, D / 2, 0.0, H - 0.03, wood, r=0.003, step=0.35))
    P.append(board(-W / 2 - 0.015, W / 2 + 0.015, -D / 2, D / 2 + 0.01, H - 0.03, H, wood, r=0.006, step=0.3))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.02, D / 2 - 0.006, 0.07, 0.09, wood, r=0.002, step=0.3))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.03, -D / 2 + 0.05, 0.0, 0.07, wood, r=0.002))
    P.append(board(-W / 2 + 0.004, W / 2 - 0.004, D / 2 - 0.006, D / 2, 0.01, H - 0.03, 'hardboard', r=0.001, step=0.35))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.04, D / 2 - 0.006, 1.68, 1.70, wood, r=0.002, step=0.3))
    # Kleiderstange + Halter
    P.append(cyl(0.012, W - 2 * t, 'steel', loc=(-W / 2 + t, 0.02, 1.60), rot=(0, radians(90), 0), segs=10))
    # Drahtbuegel
    for i, x in enumerate((-0.30, -0.22, 0.05, 0.12, 0.31)):
        rz = radians(random.uniform(-25, 25))
        o = tube(catmull([(0, -0.005, 0.02), (0, 0.013, 0.012), (0, 0.006, -0.008), (0, 0.0, -0.035)], 3) + [Vector((0, -0.2, -0.17)),
                 Vector((0, 0.2, -0.17)), Vector((0, 0.0, -0.035))], 0.0016, 'steel', sides=5)
        L.transform_obj(o, loc=(x, 0.02, 1.60), rot=(0, 0, 0))
        L.transform_obj(o, rot=(0, 0, rz), pivot=(x, 0.02, 1.60))
        if i == 4:
            L.transform_obj(o, rot=(radians(35), 0, 0), pivot=(x, 0.02, 1.60))
        P.append(o)
    # ein Hemd haengt noch
    def shirt(u, v):
        x = (u - 0.5) * (0.40 - 0.08 * (1 - v) ** 3)
        z = 1.43 - (1 - v) * 0.72
        z += 0.12 * (1 - abs(2 * u - 1)) ** 2 * (v > 0.9) * (v - 0.9) * 10 * 0.1
        y = 0.02 + 0.02 * math.sin(u * 12) * (1 - v) + 0.015 * noise.noise(Vector((u * 4, v * 4, 1.0)))
        if v > 0.95:
            z += 0.0
        return Vector((x, y, z + 0.17 * (v > 0.92) * ((v - 0.92) / 0.08) * (1 - abs(2 * u - 1) ** 2) * 0.4))
    bm, vs = L.grid(10, 14, shirt)
    wrinkle(bm, 0.008, 18, 2)
    o = mk(bm, 'cloth_white')
    L.transform_obj(o, loc=(-0.20, 0, 0.0))
    L.transform_obj(o, rot=(0, 0, radians(10)), pivot=(-0.2, 0.02, 1.6))
    P.append(o)
    # Kleiderhaufen
    rnd = random.Random(3)
    for i, m in enumerate(('cloth_denim', 'cloth_grey', 'cloth_red', 'cloth_grey')):
        P.append(blob(0.12, m, loc=(rnd.uniform(-0.25, 0.25), rnd.uniform(-0.12, 0.12), 0.11 + 0.03 * i),
                      scale=(1.5, 1.1, 0.35), amp=0.35, freq=1.6, seed=20 + i, rot=(0, 0, rnd.uniform(0, 3))))
    P.append(cloth_drape(-0.42, -0.1, -D / 2 + 0.03, 0.09, 0.09, 5, 'cloth_grey', depth=0.25))
    # Tueren
    dw, dh = W / 2 - 0.005, H - 0.12
    for side, ang in ((-1, radians(-108)), (1, radians(5))):
        hinge_x = side * W / 2
        x0, x1 = (hinge_x, hinge_x - side * dw) if side < 0 else (hinge_x - dw, hinge_x)
        x0, x1 = min(x0, x1), max(x0, x1)
        door = [board(x0, x1, -D / 2 - 0.002, -D / 2 + 0.02, 0.08, 0.08 + dh, wood, r=0.004, step=0.4)]
        # Fuellungen (Rahmenleisten)
        for (zz0, zz1) in ((0.18, 0.95), (1.05, 1.75)):
            for (a0, a1, b0, b1) in ((x0 + 0.06, x1 - 0.06, zz0, zz0 + 0.02), (x0 + 0.06, x1 - 0.06, zz1 - 0.02, zz1),
                                     (x0 + 0.06, x0 + 0.08, zz0, zz1), (x1 - 0.08, x1 - 0.06, zz0, zz1)):
                door.append(board(a0, a1, -D / 2 - 0.009, -D / 2 - 0.001, b0, b1, wood, r=0.003))
        kx = x1 - 0.04 if side < 0 else x0 + 0.04
        door.append(lathe_part([(0.0, 0.0), (0.008, 0.0), (0.006, 0.012), (0.014, 0.022), (0.012, 0.03), (0.0, 0.032)], 'brass_tarnished',
                               loc=(kx, -D / 2 - 0.002, 1.0), rot=(radians(90), 0, 0), segs=10))
        for o in door:
            L.transform_obj(o, rot=(0, 0, ang), pivot=(hinge_x, -D / 2 + 0.01, 0))
        P += door
        for hz in (0.25, 1.75):
            P.append(cyl(0.006, 0.07, 'brass_tarnished', loc=(hinge_x - side * 0.003, -D / 2 + 0.005, hz - 0.035), segs=8))
    return finish('wardrobe_open', P, grime=dict(dirt=0.22))


@prop('nightstand', 'wood', 'schlafzimmer',
      'Nachttisch 0,45 x 0,38 x 0,58 m, Schublade halb offen, offenes Fach mit umgefallenem Buch.')
def b_nightstand():
    P = []
    wood = 'cabinet_wood'
    W, D, H = 0.45, 0.38, 0.58
    t = 0.018
    P.append(board(-W / 2 - 0.008, W / 2 + 0.008, -D / 2 - 0.01, D / 2, H - 0.022, H, wood, r=0.005, step=0.12))
    for s in (-1, 1):
        P.append(board(s * W / 2 - (t if s > 0 else 0), s * W / 2 + (t if s < 0 else 0), -D / 2, D / 2 - 0.004, 0.06, H - 0.022, wood, r=0.003, step=0.2))
        for sy in (-1, 1):
            bm = rb(0.035, 0.035, 0.065, r=0.004)
            P.append(mk(bm, wood, loc=(s * (W / 2 - 0.02), sy * (D / 2 - 0.03), 0.0325)))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.005, D / 2 - 0.004, 0.06, 0.08, wood, r=0.002, step=0.2))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + 0.005, D / 2 - 0.004, 0.40, 0.418, wood, r=0.002, step=0.2))
    P.append(board(-W / 2 + 0.003, W / 2 - 0.003, D / 2 - 0.006, D / 2, 0.065, H - 0.025, 'hardboard', r=0.001))
    P += drawer(W - 2 * t - 0.006, 0.13, D - 0.05, (0, -D / 2 - 0.02 - 0.12, 0.488), pull='knob')
    P.append(book(0.035, 0.24, 0.17, (0.0, -0.02, 0.08 + 0.0175), rot=(0, radians(90), 0.25)))
    P.append(book(0.03, 0.2, 0.14, (-0.11, 0.02, 0.08 + 0.1), rot=(0, radians(-14), 0)))
    stains = [stain((0.08, 0.03, H), 0.045, STAIN_WATER, ring=True)]
    return finish('nightstand', P, grime=dict(stains=stains, dirt=0.22))


@prop('toy_box', 'wood', 'kinderzimmer',
      'Spielzeugkiste aus Holz (blau lackiert, abgeplatzt), Deckel offen nach hinten, Bauklötze, Ball, Stoffbaer (dezent).')
def b_toy_box():
    P = []
    W, D, H = 0.70, 0.40, 0.42
    t = 0.016
    pm = 'paint_toybox'
    for s in (-1, 1):
        P.append(board(-W / 2, W / 2, s * D / 2 - (t if s > 0 else 0), s * D / 2 + (t if s < 0 else 0), 0.0, H, pm, r=0.004, step=0.12))
        P.append(board(s * W / 2 - (t if s > 0 else 0), s * W / 2 + (t if s < 0 else 0), -D / 2 + t, D / 2 - t, 0.0, H, pm, r=0.004, step=0.12))
    P.append(board(-W / 2 + t, W / 2 - t, -D / 2 + t, D / 2 - t, 0.02, 0.035, pm, r=0.002, step=0.2))
    for x in (-W / 2 - 0.004, W / 2 + 0.004):
        P.append(box(0.012, 0.12, 0.03, 'plastic_black', loc=(x, 0, H - 0.08), r=0.004))
    # Deckel offen (Scharnier hinten oben), lehnt nach hinten
    lid = [board(-W / 2 - 0.01, W / 2 + 0.01, -D / 2 - 0.01, D / 2 + 0.005, H, H + 0.02, pm, r=0.005, step=0.12)]
    for o in lid:
        L.transform_obj(o, rot=(radians(-112), 0, 0), pivot=(0, D / 2 + 0.005, H))
    P += lid
    rnd = random.Random(8)
    cols = ['toy_red', 'toy_yellow', 'toy_blue', 'toy_green']
    # Inhalt: Bauklötze, Ball, Baer
    for i in range(9):
        s = 0.045
        P.append(box(s, s, s, cols[i % 4], loc=(rnd.uniform(-0.25, 0.25), rnd.uniform(-0.12, 0.12), 0.27 + rnd.uniform(0, 0.04)),
                     rot=(rnd.uniform(0, 1), rnd.uniform(0, 1), rnd.uniform(0, 1)), r=0.005))
    for i in range(4):
        s = 0.045
        P.append(box(s, s, s, cols[(i + 1) % 4], loc=(rnd.uniform(-0.45, 0.6), rnd.uniform(-0.55, -0.28), s / 2),
                     rot=(0, 0, rnd.uniform(0, 1.5)), r=0.005))
    P.append(blob(0.09, 'toy_red', loc=(0.16, -0.02, 0.33), scale=(1, 1, 0.92), amp=0.04, freq=1.0, seed=3, subdiv=3))
    P.append(blob(0.22, 'cloth_grey', loc=(0.0, 0.0, 0.16), scale=(1.4, 0.8, 0.55), amp=0.3, freq=1.4, seed=6))  # Fuellung (Decke)
    # Stoffbaer sitzt zusammengesackt am Rand
    bx, by, bz = -0.18, -0.05, 0.30
    pl = 'plush_brown'
    P.append(blob(0.075, pl, loc=(bx, by, bz), scale=(1.0, 0.85, 1.15), amp=0.12, freq=1.2, seed=1))
    P.append(blob(0.06, pl, loc=(bx + 0.02, by - 0.03, bz + 0.12), scale=(1, 0.95, 0.9), amp=0.08, freq=1.2, seed=2, rot=(0.3, 0, 0.3)))
    for s in (-1, 1):
        P.append(blob(0.022, pl, loc=(bx + 0.02 + s * 0.045, by - 0.01, bz + 0.17), scale=(1, 0.55, 1), amp=0.05, freq=1.0, seed=3 + s))
        P.append(blob(0.028, pl, loc=(bx + s * 0.075, by - 0.05, bz - 0.02), scale=(0.8, 0.8, 1.6), amp=0.1, freq=1.0, seed=5 + s, rot=(0.6, s * 0.3, 0)))
    P.append(blob(0.022, 'plush_brown', loc=(bx + 0.025, by - 0.085, bz + 0.105), scale=(1.2, 0.8, 0.9), amp=0.05, freq=1.0, seed=9))
    P.append(blob(0.006, 'plastic_black', loc=(bx + 0.0, by - 0.083, bz + 0.135), amp=0.02, freq=1.0, seed=10, subdiv=1))  # nur ein Auge
    return finish('toy_box', P, grime=dict(dirt=0.3))


# ---------------------------------------------------------------- Wand / Fenster / Decke
@prop('wall_picture_crooked', 'wood', 'wohnzimmer',
      'Wandbild (Oelbild-Druck Berglandschaft, MU_painting) im Holzrahmen 0,82 x 0,57 m, haengt schief (~6 Grad) '
      'und steht unten von der Wand ab. anchor wall: Ursprung Wandebene, Unterkante; empfohlen Unterkante ~1,25 m.',
      anchor='wall')
def b_picture():
    P = []
    OW, OH, fw, fd = 0.82, 0.57, 0.045, 0.035
    fr = 'cabinet_wood'
    # Rahmenleisten mit Profil (zwei Stufen)
    for (x0, x1, z0, z1) in ((-OW / 2, OW / 2, OH - fw, OH), (-OW / 2, OW / 2, 0, fw), (-OW / 2, -OW / 2 + fw, fw, OH - fw), (OW / 2 - fw, OW / 2, fw, OH - fw)):
        P.append(board(x0, x1, -fd, -0.005, z0, z1, fr, r=0.006))
        # innere Stufe
        cx0 = x0 + (0.012 if x0 < -OW / 2 + 0.001 or x1 - x0 < fw + 0.001 else 0)
        P.append(board(max(x0, -OW / 2 + fw - 0.012), min(x1, OW / 2 - fw + 0.012), -fd - 0.006, -fd + 0.004,
                       max(z0, fw - 0.012), min(z1, OH - fw + 0.012), fr, r=0.004))
    # Leinwand (leicht vertieft)
    cw, ch = OW - 2 * fw + 0.01, OH - 2 * fw + 0.01
    bm, vs = L.grid(8, 6, lambda u, v: Vector(((u - 0.5) * cw, -0.02 + 0.002 * math.sin(u * pi) * math.sin(v * pi), fw - 0.005 + v * ch)))
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = (co.x / cw + 0.5, (co.z - fw + 0.005) / ch)
    bm.normal_update()
    if sum(f.normal.y for f in bm.faces) > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    P.append(L.part(bm, M('painting'), name='canvas', uv=None))
    P.append(board(-cw / 2, cw / 2, -0.019, -0.006, fw - 0.005, fw - 0.005 + ch, 'canvas_back', r=0.002))
    # Ecke unten rechts: Gehrung geoeffnet (Leiste leicht verschoben)
    for o in P[2:4]:
        L.transform_obj(o, loc=(0.004, 0, -0.003))
    # schief + unten abstehend
    for o in P:
        L.transform_obj(o, rot=(radians(3), radians(6.5), 0), pivot=(0, 0, OH))
    return finish('wall_picture_crooked', P, anchor='wall', grime=dict(floor=False, dirt=0.15, floor_dirt=0.0))


@prop('curtain_torn', 'fabric', 'wohnzimmer',
      'Vorhangstange mit zwei Stoffbahnen (MU_curtain, doppelseitig), rechte Bahn halb von den Ringen gerissen, '
      'Loch und ausgefranster Saum. anchor wall: Ursprung Wandebene, Unterkante; Stange liegt 1,80 m darueber '
      '-> Ursprung z ~0,40 fuer Stange auf 2,20 m.', anchor='wall')
def b_curtain():
    P = []
    rod_z, rod_y = 1.80, -0.10
    RW = 1.70
    P.append(cyl(0.011, RW, 'brass_tarnished', loc=(-RW / 2, rod_y, rod_z), rot=(0, radians(90), 0), segs=10))
    for s in (-1, 1):
        P.append(blob(0.022, 'brass_tarnished', loc=(s * (RW / 2 + 0.018), rod_y, rod_z), amp=0.02, freq=1.0, seed=s, subdiv=2))
        P.append(box(0.025, 0.11, 0.025, 'brass_tarnished', loc=(s * 0.70, rod_y / 2, rod_z), r=0.006))
        P.append(cyl(0.03, 0.01, 'brass_tarnished', loc=(s * 0.70, -0.005, rod_z), rot=(radians(90), 0, 0), segs=12))
    tile = 0.55

    def panel(x0, x1, top_fn, length, seed, nu=28, nv=22, holes=(), torn_bottom=True):
        def fn(u, v):
            x = x0 + (x1 - x0) * u
            zt = top_fn(u)
            z = zt - length * (1 - v)
            fold = 0.035 * math.sin(2 * pi * (x - x0) / 0.13 + seed) * (0.6 + 0.4 * (1 - v))
            y = rod_y + 0.015 + fold + 0.02 * noise.noise(Vector((x * 3, z * 2, seed)))
            return Vector((x, y, z))
        bm, vs = L.grid(nu, nv, fn)
        # UV in Bildkacheln (Bogenlaenge / tile)
        uvl = bm.loops.layers.uv.verify()
        for f in bm.faces:
            for l in f.loops:
                l[uvl].uv = (l[uvl].uv.x / tile, l[uvl].uv.y / tile)
        kill = set()
        for f in bm.faces:
            c = f.calc_center_median()
            for (hx, hz, hr) in holes:
                d = math.hypot(c.x - hx, (c.z - hz) * 0.7)
                if d < hr * (1 + 0.5 * noise.noise(Vector((c.x * 9, c.z * 9, seed)))):
                    kill.add(f)
            if torn_bottom:
                zt = min(v.co.z for v in f.verts)
                lim = top_fn(0.5) - length + 0.06 + 0.08 * (0.5 + 0.5 * noise.noise(Vector((c.x * 6, seed, 0.3))))
                if c.z < lim:
                    kill.add(f)
        bmesh.ops.delete(bm, geom=list(kill), context='FACES_ONLY')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        wrinkle(bm, 0.006, 8, seed)
        return mk(bm, 'curtain', uv=False)

    # links: haengt komplett, zusammengeschoben
    P.append(panel(-0.82, -0.18, lambda u: rod_z - 0.03, 1.80, 1, holes=((-0.45, 0.85, 0.08),)))
    # rechts: aeussere Haelfte von den Ringen gerissen -> Oberkante faellt diagonal ab
    P.append(panel(0.12, 0.84, lambda u: rod_z - 0.03 - 0.55 * max(0, (u - 0.35) / 0.65) ** 1.4, 1.62, 2,
                   holes=((0.55, 0.65, 0.06),)))
    # Ringe (nur wo Stoff haengt)
    for x in [-0.8 + i * 0.065 for i in range(10)] + [0.13 + i * 0.065 for i in range(4)] + [0.5, 0.62]:
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, segments=10, radius=0.016)
        P.append(tube([Vector((0, 0.016 * cos(a), 0.016 * sin(a))) for a in [2 * pi * k / 10 for k in range(11)]], 0.0022,
                      'brass_tarnished', sides=4, caps=False))
        L.transform_obj(P[-1], loc=(x, rod_y, rod_z - 0.004))
        bm.free()
    return finish('curtain_torn', P, anchor='wall', grime=dict(floor=False, dirt=0.25, floor_dirt=0.0, ao_strength=0.4))


@prop('blinds_bent', 'metal', 'wohnzimmer',
      'Alu-/Vinyl-Jalousie 0,90 x 1,20 m: Lamellen in der Mitte verbogen (Spaehloch), einige fehlen, '
      'Unterschiene haengt schief (Leiterkordel gerissen). anchor wall: Ursprung Rueckseite Kopfschiene, Unterkante.',
      anchor='wall')
def b_blinds():
    P = []
    BW, drop = 0.90, 1.20
    top = drop + 0.05
    P.append(box(BW + 0.02, 0.05, 0.04, 'blind_vinyl', loc=(0, -0.03, top + 0.02), r=0.006, step=0.3))
    n = 52
    sp = (drop - 0.03) / n
    rnd = random.Random(5)
    missing = {37, 38, 44}
    nu = 22
    for i in range(n):
        if i in missing:
            continue
        zc = top - 0.03 - i * sp
        tilt_side = max(0.0, (i - 40) / 11.0)   # untere Lamellen kippen (rechts tiefer)

        def fn(u, v, zc=zc, i=i, tilt_side=tilt_side):
            x = (u - 0.5) * BW
            yy = (v - 0.5) * 0.025
            y = -0.03 + yy * cos(radians(20))
            z = zc + yy * sin(radians(20)) + 0.0015 * (1 - (2 * v - 1) ** 2)
            # Spaehloch: Lamellen 16..24 im Bereich x 0.05..0.3 nach unten/vorne verbogen
            if 16 <= i <= 24:
                k = max(0.0, 1 - ((x - 0.17) / 0.15) ** 2) * (1 - abs(i - 20) / 5.0)
                z -= 0.035 * k
                y -= 0.03 * k
            if 10 <= i <= 12:
                k = max(0.0, 1 - ((x + 0.3) / 0.08) ** 2)
                z += 0.012 * k
            z -= tilt_side * 0.10 * (u)
            return Vector((x, y, z))
        bm, vs = L.grid(nu, 2, fn)
        if i == 30:
            # geknickte Lamelle haengt am Ende herab
            for v in bm.verts:
                if v.co.x > 0.25:
                    d = v.co.x - 0.25
                    v.co.z -= d * 0.6
                    v.co.x = 0.25 + d * 0.8
        P.append(mk(bm, 'blind_vinyl'))
    # Unterschiene (schief)
    o = box(BW + 0.005, 0.03, 0.012, 'blind_vinyl', loc=(0, -0.03, top - 0.03 - n * sp - 0.01), r=0.004)
    L.transform_obj(o, rot=(0, radians(6.5), 0), pivot=(-BW / 2, -0.03, top - 0.03 - n * sp))
    P.append(o)
    # Leiterkordeln
    for x in (-0.33, 0.0, 0.33):
        for dy in (-0.0135, 0.0135):
            zb = top - 0.03 - n * sp - 0.01 - (x + BW / 2) * math.tan(radians(6.5))
            pts = [(x, -0.03 + dy, top), (x, -0.03 + dy, zb)]
            if x > 0.2:
                pts = [(x, -0.03 + dy, top), (x, -0.03 + dy, top - 0.85)]  # gerissen
            P.append(tube(pts, 0.0008, 'cord_white', sides=4))
    # Zugschnur + Wendestab rechts
    P.append(tube(catmull([(0.42, -0.06, top), (0.425, -0.065, top - 0.6), (0.43, -0.06, top - 1.0)], 4), 0.0012, 'cord_white', sides=4))
    P.append(cyl(0.004, 0.55, 'plastic_clear' if False else 'blind_vinyl', loc=(-0.42, -0.065, top - 0.56), segs=6))
    return finish('blinds_bent', P, anchor='wall', grime=dict(floor=False, dirt=0.3, floor_dirt=0.0, ao_strength=0.45))


@prop('ceiling_fan', 'metal', 'wohnzimmer',
      'Deckenventilator 52" (1,32 m): Baldachin, Stange, Motorgehaeuse, 5 Fluegel (Holzdekor), einer haengt herab, '
      'Zugkette. anchor ceiling: Ursprung an der Decke, haengt 0,42 m herab.', anchor='ceiling')
def b_fan():
    P = []
    br = 'brass_tarnished'
    P.append(lathe_part([(0.0, 0.0), (0.075, 0.0), (0.078, -0.01), (0.06, -0.06), (0.02, -0.075), (0.0, -0.075)], br, segs=20))
    P.append(cyl(0.0125, 0.18, br, loc=(0, 0, -0.25), segs=10))
    P.append(lathe_part([(0.0, -0.25), (0.05, -0.25), (0.11, -0.27), (0.125, -0.30), (0.12, -0.33), (0.10, -0.345), (0.0, -0.345)][::-1], br, segs=24))
    P.append(lathe_part([(0.0, -0.345), (0.07, -0.345), (0.075, -0.36), (0.055, -0.40), (0.02, -0.415), (0.0, -0.415)], br, segs=20))
    # Zugkette
    pts = [(0.03, -0.02, -0.40), (0.035, -0.022, -0.55), (0.036, -0.02, -0.62)]
    P.append(tube(pts, 0.0012, 'steel', sides=4))
    P.append(blob(0.006, br, loc=(0.036, -0.02, -0.628), amp=0.0, freq=1.0, seed=1, subdiv=1))
    for k in range(5):
        a = 2 * pi * k / 5 + 0.3
        droop = radians(16) if k == 2 else radians(random.uniform(-1, 1.5))
        parts = []
        # Fluegelhalter
        parts.append(box(0.15, 0.03, 0.008, 'steel_dark', loc=(0.15, 0, -0.315), r=0.003))
        parts.append(box(0.06, 0.05, 0.01, 'steel_dark', loc=(0.24, 0, -0.32), r=0.003))
        bm = rb(0.50, 0.13, 0.008, r=0.003, step=0.12)
        # abgerundete Spitze
        L.deform(bm, lambda p: Vector((p.x, p.y * (1 - 0.25 * max(0, (p.x - 0.18) / 0.07) ** 2), p.z)))
        if k == 4:
            L.dent(bm, (0.25, 0.065, 0), 0.04, 0.0)
        blade = mk(bm, 'fan_blade', loc=(0.47, 0, -0.325), rot=(radians(13), 0, 0))
        parts.append(blade)
        for o in parts:
            L.transform_obj(o, rot=(0, droop, 0), pivot=(0.12, 0, -0.315))
            L.transform_obj(o, rot=(0, 0, a), pivot=(0, 0, 0))
        P += parts
    return finish('ceiling_fan', P, anchor='ceiling', grime=dict(dirt=0.3, floor=False))


@prop('ceiling_lamp_bulb', 'metal', 'flur',
      'Pendelfassung an der Decke mit nackter Gluehbirne (ME_bulb_warm, leuchtend). anchor ceiling. '
      'Lichtquelle: lightOffset (glTF-Koordinaten, relativ zum Ursprung).', anchor='ceiling',
      lightOffset=[0.0, -0.585, 0.0], lightColor=[1.0, 0.62, 0.30])
def b_ceiling_lamp():
    P = []
    P.append(lathe_part([(0.0, 0.0), (0.06, 0.0), (0.062, -0.006), (0.05, -0.025), (0.012, -0.03), (0.0, -0.03)], 'paint_white_old', segs=20))
    pts = catmull([(0, 0, -0.03), (0.003, 0.002, -0.2), (0.0, 0.0, -0.42)], 6)
    P.append(tube(pts, 0.0028, 'cord_black', sides=6))
    P.append(lathe_part([(0.0, -0.49), (0.015, -0.49), (0.018, -0.485), (0.019, -0.44), (0.012, -0.42), (0.0, -0.418)][::-1], 'plastic_black', segs=14))
    P.append(cyl(0.0128, 0.022, 'steel', loc=(0, 0, -0.51), segs=12))
    bprof = [(0.0, 0.0), (0.0125, 0.0), (0.0125, 0.022), (0.016, 0.03), (0.028, 0.06), (0.031, 0.085), (0.026, 0.105), (0.014, 0.117), (0.0, 0.12)]
    o = lathe_part(bprof, 'bulb_warm', segs=16)
    L.transform_obj(o, rot=(radians(180), 0, 0), pivot=(0, 0, 0))
    L.transform_obj(o, loc=(0, 0, -0.49 + 0.0 - 0.0))
    P.append(o)
    return finish('ceiling_lamp_bulb', P, anchor='ceiling', grime=dict(dirt=0.15, floor=False, ao_strength=0.3))


@prop('rug_runner', 'carpet', 'flur',
      'Orientalischer Laeufer 0,76 x 2,40 m (MU_rug_runner, abgelaufen, Fussspuren), Falten, Ecke umgeschlagen, Fransen.')
def b_rug():
    P = []
    RW, RL, T = 0.76, 2.40, 0.008
    nu, nv = 14, 44

    def h(x, y):
        z = 0.0
        for (yc, a, w) in ((0.35, 0.022, 0.09), (-0.55, 0.012, 0.07), (0.62, 0.008, 0.05)):
            z += a * math.exp(-((y - yc - 0.1 * x) / w) ** 2)
        # Ecke vorne links umgeschlagen/aufgerollt
        cx, cy = x + RW / 2, y + RL / 2
        d = (cx + cy) / math.sqrt(2)
        if d < 0.28:
            z += 0.05 * (1 - d / 0.28) ** 2
        return z

    def fn(u, v):
        x = (u - 0.5) * RW
        y = (v - 0.5) * RL
        return Vector((x, y, T + h(x, y)))
    bm, vs = L.grid(nu, nv, fn)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uvl].uv = (co.x / RW + 0.5, 0.02 + (co.y / RL + 0.5) * 0.96)
    bm.normal_update()
    if sum(f.normal.z for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    top_faces = list(bm.faces)
    res = bmesh.ops.solidify(bm, geom=top_faces, thickness=T)
    for f in bm.faces:
        f.material_index = 0 if f in top_faces else 1
    for f in bm.faces:
        if f.material_index == 1:
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x, l.vert.co.y)
    P.append(mk_multi(bm, ['rug_runner', 'rug_back']))
    # Fransen
    rnd = random.Random(2)
    for s in (-1, 1):
        def ff(u, v, s=s):
            x = (u - 0.5) * (RW - 0.04)
            y = s * (RL / 2 + 0.055 * v)
            return Vector((x, y, 0.002 + 0.003 * (1 - v) + h(x, s * RL / 2) * (1 - v)))
        bm, vs = L.grid(40, 1, ff)
        # Strähnen: jede zweite Spalte loeschen
        kill = [f for i, f in enumerate(bm.faces) if i % 2 == 1]
        bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        for v in bm.verts:
            if abs(v.co.y) > RL / 2 + 0.01:
                v.co.x += rnd.uniform(-0.006, 0.006)
                v.co.y += s * rnd.uniform(-0.015, 0.005)
        P.append(mk(bm, 'rug_fringe'))
    return finish('rug_runner', P, grime=dict(dirt=0.15, ao_dist=0.1, floor_dirt=0.05))
