# props_vehicle_cars.py — Fahrzeug-Spezifikationen und Zusammenbau (per exec aus props_vehicle.py)

S_POLICE = CarSpec(
    yF=-2.27, yR=2.28, capF=0.27, capR=0.24, nF=4.4, nR=5.0, zcF=0.76, zcR=1.0,
    leanF=0.15, leanRa=0.08, leanRb=0.36, leanRzk=1.24,
    zb=[(-2.27, 0.43), (-1.95, 0.40), (-1.2, 0.365), (1.1, 0.365), (1.9, 0.40), (2.28, 0.45)],
    zr=0.52,
    zs=[(-2.27, 1.01), (-1.6, 1.10), (-0.8, 1.135), (1.4, 1.155), (2.28, 1.165)],
    zbelt=[(-2.27, 1.055), (-1.9, 1.115), (-1.0, 1.17), (0.0, 1.19), (1.5, 1.22), (2.28, 1.235)],
    zt=[(-2.27, 1.075), (-1.9, 1.135), (-1.0, 1.195), (-0.12, 1.745), (0.1, 1.765), (0.5, 1.775),
        (1.2, 1.772), (1.8, 1.76), (2.1, 1.745), (2.28, 1.72)],
    crown=[(-2.27, 0.02), (-1.0, 0.03), (-0.12, 0.03), (2.28, 0.025)],
    W=[(-2.27, 0.905), (-2.0, 0.955), (-1.6, 0.985), (-0.5, 0.995), (1.2, 0.995), (1.9, 0.985), (2.28, 0.945)],
    Wb=[(-2.27, 0.85), (-1.6, 0.925), (1.6, 0.925), (2.28, 0.88)],
    Wt=[(-2.27, 0.70), (-1.0, 0.74), (-0.12, 0.735), (1.0, 0.73), (2.0, 0.715), (2.28, 0.695)],
    special=[-1.0, -0.80, -0.12, 0.47, 0.58, 1.15, 1.25],
    step=0.042)

POLICE = dict(
    name='police_suv', S=S_POLICE, paint='MU_police_body', axles=(-1.55, 1.475), track=0.855,
    tire_R=0.381, tire_w=0.255, rim_r=0.2286, arch_r=0.462, arch_zc=0.405,
    side_glass=[(-0.80, 0.47), (0.58, 1.15), (1.25, 2.30)],
    dpillar=((0.0, 2.15, 1.25), (0.0, 1.98, 1.72)),
    windshield=(-1.0, -0.12), rear_window=dict(z0=1.30, z1=1.67, x=0.60),
    tex=4096, scale=660,
    ext=dict(y0=-2.62, y1=2.62, z0=0.30, z1=1.86, x0=-1.04, x1=1.04, zf1=1.36),
)


def plane_from_pts_yz(p0, p1, toward):
    """Ebene durch zwei Punkte in der YZ-Ebene (x egal), Normale zeigt Richtung 'toward'."""
    a = Vector(p0); b = Vector(p1)
    d = (b - a).normalized()
    n = Vector((0, d.z, -d.y))
    if n.dot(Vector(toward) - a) < 0:
        n = -n
    return a, n


def split_by_mats(ob, names, newname):
    """Verschiebt Faces mit Material in names in ein neues Objekt."""
    me = ob.data
    idx = {i for i, m in enumerate(me.materials) if m and m.name in names}
    if not idx:
        return None
    bm = bmesh.new(); bm.from_mesh(me)
    bm2 = bm.copy()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context='FACES')
    bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if f.material_index not in idx], context='FACES')
    bm.to_mesh(me); bm.free()
    me2 = bpy.data.meshes.new(newname)
    bm2.to_mesh(me2); bm2.free()
    for m in me.materials:
        me2.materials.append(m)
    o2 = new_obj(newname, me2)
    clean_unused_slots(o2); clean_unused_slots(ob)
    return o2


def clean_unused_slots(ob):
    me = ob.data
    used = sorted({p.material_index for p in me.polygons})
    mats = [me.materials[i] for i in used]
    remap = {old: new for new, old in enumerate(used)}
    idxs = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    for p, i in zip(me.polygons, idxs):
        p.material_index = i


def faces_copy_obj(faces, name, m, offset=0.0):
    """Kopie einer Face-Menge (bmesh) als eigenes Objekt (z. B. Leuchtenabdeckung)."""
    vmap = {}
    verts, polys = [], []
    for f in faces:
        poly = []
        for v in f.verts:
            if v.index not in vmap:
                vmap[v.index] = len(verts)
                verts.append(tuple(v.co + v.normal * offset))
            poly.append(vmap[v.index])
        polys.append(poly)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], polys); me.update()
    o = new_obj(name, me)
    o.data.materials.append(m)
    return o


def ray_y(bvh, x, z, front=True):
    o = Vector((x, -6.0 if front else 6.0, z))
    d = Vector((0, 1.0 if front else -1.0, 0))
    hit = bvh.ray_cast(o, d, 12.0)
    return hit[0].y if hit[0] is not None else None


def build_body_shell(C):
    """Loft + Fenster + Leuchten + Grill + Radhäuser. Gibt (body, glass_parts, info) zurück."""
    S = C['S']
    bm = build_loft(S, C['name'] + '_body')
    lseg, lside, lzone = L(bm, 'seg'), L(bm, 'side'), L(bm, 'zone')
    mats = []
    MI = lambda key: bm_mat_index(mats, mat(key))
    P = MI(C['paint'])
    for f in bm.faces:
        f.material_index = P
    UB = MI('underbody')
    for f in bm.faces:
        if f[lzone] == 0 and f[lseg] < CSTART[1]:
            f.material_index = UB
    bm.verts.ensure_lookup_table()
    bvh0 = BVHTree.FromBMesh(bm)
    info = dict(bvh0=bvh0)
    # ---- D-Säule schräg (bisect)
    p0, pn = None, None
    if C.get('dpillar'):
        a, b = C['dpillar']
        p0, pn = plane_from_pts_yz(a, b, (0, 3.0, 1.5))
        sub = [f for f in bm.faces if f[lzone] == 0 and CSTART[7] <= f[lseg] < CSTART[8] and fc(f).y > 1.5]
        bisect(bm, sub, p0, pn)
    # ---- Scheiben
    G = MI('glass')
    glass = []
    for f in bm.faces:
        if f[lzone] != 0:
            continue
        j = f[lseg]; c = fc(f)
        if CSTART[7] <= j < CSTART[8]:
            for (a, b) in C['side_glass']:
                if a < c.y < b:
                    if p0 is not None and b > 2.0 and pn.dot(c - p0) > 0:
                        continue
                    glass.append(f)
        elif j >= CSTART[11]:
            w0, w1 = C['windshield']
            if w0 < c.y < w1:
                glass.append(f)
            if C.get('rear_window_top'):
                r0, r1 = C['rear_window_top']
                if r0 < c.y < r1:
                    glass.append(f)
    rw = C.get('rear_window')
    if rw:
        sub = [f for f in bm.faces if f[lzone] == 2 and fc(f).z > rw['z0'] - 0.15]
        for co, no in (((0, 0, rw['z0']), (0, 0, 1)), ((0, 0, rw['z1']), (0, 0, 1)),
                       ((rw['x'], 0, 0), (1, 0, 0)), ((-rw['x'], 0, 0), (1, 0, 0))):
            bisect(bm, sub, co, no)
            sub = [f for f in bm.faces if f[lzone] == 2 and fc(f).z > rw['z0'] - 0.15]
        for f in bm.faces:
            if f[lzone] != 2:
                continue
            c = fc(f)
            if rw['z0'] < c.z < rw['z1'] and abs(c.x) < rw['x'] and f.normal.y > 0.25:
                glass.append(f)
    glass = list(set(glass))
    for f in glass:
        f.material_index = G
    res = bmesh.ops.inset_region(bm, faces=glass, thickness=0.013, depth=-0.007, use_even_offset=True)
    RS = MI('rubber_seal')
    for f in res['faces']:
        f.material_index = RS
    info['glass_faces'] = len(glass)
    # ---- Leuchten / Grill
    covers = []
    front_zone = lambda f: (f[lzone] == 1 or (f[lzone] == 0 and fc(f).y < -1.9)) and f.material_index == P
    rear_zone = lambda f: (f[lzone] == 2 or (f[lzone] == 0 and fc(f).y > 1.95)) and f.material_index == P
    for spec in C['lamps']:
        zone = front_zone if spec['front'] else rear_zone
        sub = [f for f in bm.faces if zone(f)]
        for (co, no) in spec['planes']:
            bisect(bm, sub, co, no)
            sub = [f for f in bm.faces if zone(f)]
        reg = [f for f in sub if spec['test'](fc(f), f.normal)]
        if not reg:
            print('WARN lamp region empty', spec['key'])
            continue
        spec['center'] = sum((fc(f) for f in reg), Vector()) / len(reg)
        spec['n_faces'] = len(reg)
        if spec.get('cover'):
            covers.append(faces_copy_obj(reg, 'cover', mat(spec['cover']), 0.0))
        if spec.get('split'):
            # zweites Material unterhalb split_z (z. B. Rückfahrlicht)
            pass
        floor = MI(spec['floor']); wall = MI(spec.get('wall', spec['floor']))
        floor_faces, walls = recess(bm, reg, spec['depth'], rim=spec.get('rim', 0.004), floor_mat=floor, rim_mat=wall)
        if spec.get('split'):
            sz, skey = spec['split']
            m2 = MI(skey)
            for f in floor_faces:
                if fc(f).z < sz:
                    f.material_index = m2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(C['name'] + '_body')
    bm.to_mesh(me); bm.free()
    body = new_obj(C['name'] + '_body', me)
    for m in mats:
        me.materials.append(m)
    # ---- Radhäuser (Boolean)
    cut_col = bpy.data.collections.new('_cut')
    bpy.context.scene.collection.children.link(cut_col)
    for ya in C['axles']:
        for sx in (-1, 1):
            c = cyl(C['arch_r'], 0.50, loc=(sx * 0.90, ya, C['arch_zc']), rot=(0, pi / 2, 0), segs=72,
                    m=mat('wheelwell'), name='cut')
            for col in list(c.users_collection):
                col.objects.unlink(c)
            cut_col.objects.link(c)
    mod = body.modifiers.new('arch', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.operand_type = 'COLLECTION'
    mod.collection = cut_col
    mod.solver = 'EXACT'
    try:
        mod.material_mode = 'TRANSFER'
    except Exception:
        pass
    apply_mods(body)
    for o in list(cut_col.objects):
        remove(o)
    bpy.data.collections.remove(cut_col)
    return body, covers, info


def lamp_specs_police(S):
    sgn = lambda c: 1 if c.x >= 0 else -1
    specs = []
    # Scheinwerfer: Band unter der Haubenkante, außen leicht ansteigend
    def hl_low(c):
        return 0.885 + 0.07 * clamp((abs(c.x) - 0.40) / 0.55, 0, 1)
    planes = [((0, 0, 1.012), (0, 0, 1)), ((0.40, 0, 0), (1, 0, 0)), ((-0.40, 0, 0), (1, 0, 0)),
              ((0, -2.03, 0), (0, 1, 0))]
    for sx in (1, -1):
        a = Vector((sx * 0.40, 0, 0.885)); b = Vector((sx * 0.95, 0, 0.955))
        d = (b - a).normalized(); n = Vector((-d.z * sx, 0, d.x * sx)) if sx > 0 else Vector((d.z, 0, -d.x))
        n = Vector((-(b - a).z, 0, (b - a).x)) if sx > 0 else Vector(((b - a).z, 0, -(b - a).x))
        if n.z < 0:
            n = -n
        planes.append((tuple(a), tuple(n.normalized())))
    specs.append(dict(key='headlight', front=True, planes=planes, depth=0.04, floor='lamp_housing',
                      wall='lamp_housing_dark', cover='plastic_clear',
                      test=lambda c, n: abs(c.x) > 0.40 and c.z < 1.012 and c.z > hl_low(c) and c.y < -2.03
                      and n.y < 0.6))
    # Grill
    specs.append(dict(key='grille', front=True,
                      planes=[((0, 0, 0.765), (0, 0, 1)), ((0, 0, 0.995), (0, 0, 1)), ((0.385, 0, 0), (1, 0, 0)),
                              ((-0.385, 0, 0), (1, 0, 0))],
                      depth=0.055, floor='plastic_black', wall='plastic_black_gloss', rim=0.006,
                      test=lambda c, n: abs(c.x) < 0.385 and 0.765 < c.z < 0.995 and n.y < -0.5))
    # untere Lufteinlass
    specs.append(dict(key='intake', front=True,
                      planes=[((0, 0, 0.50), (0, 0, 1)), ((0, 0, 0.655), (0, 0, 1)), ((0.58, 0, 0), (1, 0, 0)),
                              ((-0.58, 0, 0), (1, 0, 0))],
                      depth=0.045, floor='plastic_black', wall='plastic_black', rim=0.006,
                      test=lambda c, n: abs(c.x) < 0.58 and 0.50 < c.z < 0.655 and n.y < -0.5))
    # Rückleuchten (oben rot, unten Rückfahrlicht)
    specs.append(dict(key='taillight', front=False,
                      planes=[((0, 0, 0.985), (0, 0, 1)), ((0, 0, 1.275), (0, 0, 1)), ((0, 0, 1.055), (0, 0, 1)),
                              ((0.585, 0, 0), (1, 0, 0)), ((-0.585, 0, 0), (1, 0, 0)), ((0, 2.08, 0), (0, 1, 0))],
                      depth=0.010, floor='E:taillight', wall='plastic_black_gloss', rim=0.004,
                      split=(1.055, 'lamp_housing'),
                      test=lambda c, n: abs(c.x) > 0.585 and 0.985 < c.z < 1.275 and c.y > 2.08 and n.y > -0.3))
    # Reflektoren in der Heckschürze
    specs.append(dict(key='reflector', front=False,
                      planes=[((0, 0, 0.60), (0, 0, 1)), ((0, 0, 0.655), (0, 0, 1)), ((0.64, 0, 0), (1, 0, 0)),
                              ((-0.64, 0, 0), (1, 0, 0)), ((0.86, 0, 0), (1, 0, 0)), ((-0.86, 0, 0), (1, 0, 0))],
                      depth=0.004, floor='reflector_red', rim=0.002,
                      test=lambda c, n: 0.64 < abs(c.x) < 0.86 and 0.60 < c.z < 0.655 and n.y > 0.4))
    return specs


def assemble_police():
    C = POLICE
    S = C['S']
    C['lamps'] = lamp_specs_police(S)
    UNIQUE_TEX['MU_police_body'] = dict(col=(0.02, 0.02, 0.02), rough=0.25, coat=0.35, coat_rough=0.04)
    body, covers, info = build_body_shell(C)
    bvh0 = info['bvh0']
    lamps = {s['key']: s for s in C['lamps']}
    trim = []
    # Frontmaß
    yfront = min(ray_y(bvh0, x, z) for x in (-0.3, 0.0, 0.3) for z in (0.55, 0.7, 0.85))
    # Radlauf-Leisten
    trim.append(make_arch_lips(S, C['axles'], C['track'], C['arch_zc'], C['arch_r']))
    # Grill-Gitter + Grill-LEDs
    gy = ray_y(bvh0, 0.0, 0.88) + 0.03
    trim.append(make_grille_mesh(-0.37, 0.37, 0.775, 0.985, gy))
    # Lufteinlass-Lamellen
    iy = ray_y(bvh0, 0.0, 0.58) + 0.025
    for z in (0.545, 0.61):
        trim.append(rbox((1.10, 0.02, 0.012), loc=(0, iy, z), bevel=0.004, m=mat('plastic_black_gloss'), name='slat'))
    # Scheinwerfer-Innenleben
    hl = lamps['headlight']
    for sx in (1, -1):
        for (xr, rr) in ((0.56, 0.036), (0.70, 0.030)):
            x = sx * xr
            yy = ray_y(bvh0, x, 0.955)
            pr = lathe([(0.0, rr), (0.006, rr * 0.95), (0.014, rr * 0.75), (0.019, rr * 0.4), (0.021, 0.0)], segs=20,
                       m=mat('E:headlight'), name='proj')
            pr.rotation_euler = Euler((0, 0, pi / 2)); pr.location = Vector((x, yy + 0.045, 0.952)); apply_tf(pr)
            trim.append(pr)
            ring = lathe([(0.0, rr + 0.012), (0.004, rr + 0.010), (0.008, rr + 0.002)], segs=20,
                         m=mat('lamp_housing_dark'), name='projr')
            ring.rotation_euler = Euler((0, 0, pi / 2)); ring.location = Vector((x, yy + 0.047, 0.952)); apply_tf(ring)
            trim.append(ring)
        pts = []
        for t in np.linspace(0, 1, 12):
            x = sx * lerp(0.43, 0.93, t)
            z = 0.885 + 0.07 * clamp((abs(x) - 0.40) / 0.55, 0, 1) + 0.016
            yy = ray_y(bvh0, x, z)
            pts.append((x, yy + 0.03, z))
        trim.append(tube_path(pts, 0.0055, segs=6, m=mat('E:headlight'), name='drl'))
        # Blinker (bernstein) außen
        x = sx * 0.88
        yy = ray_y(bvh0, x, 0.985)
        trim.append(rbox((0.08, 0.01, 0.022), loc=(x, yy + 0.03, 0.985), bevel=0.004, m=mat('lens_amber'), name='turn'))
    # Schubbügel
    trim.append(make_push_bumper(yfront))
    # Spiegel, Griffe, Wischer, Antennen, Suchscheinwerfer
    trim.append(make_mirror(S, 1, 'mirror_l'))
    trim.append(make_mirror(S, -1, 'mirror_r'))
    for (y, z) in ((0.22, 1.105), (0.98, 1.125)):
        trim.append(make_handle(S, y, z, 1, 'h'))
        trim.append(make_handle(S, y, z, -1, 'h'))
    trim.append(make_wipers(S, C['windshield'][0]))
    trim.append(make_antennas(S))
    trim.append(make_spotlight(S, 1))
    # Heckspoiler mit 3. Bremsleuchte
    ys = S.yR + 0.02
    zs = S.top_z(S.yR - 0.05, 0.0)
    sp = rbox((1.36, 0.26, 0.045), loc=(0, ys + 0.02, zs + 0.005), rot=(radians(-9), 0, 0), bevel=0.02, segs=2,
              m=mat('plastic_black_gloss'), name='spoiler')
    trim.append(sp)
    trim.append(rbox((0.36, 0.012, 0.018), loc=(0, ys + 0.145, zs - 0.012), bevel=0.004, m=mat('E:taillight'),
                     name='chmsl'))
    # Kennzeichen
    yrp = ray_y(bvh0, 0.0, 0.86, front=False)
    trim.append(make_plate((0, yrp + 0.006, 0.86), rot_z=pi, key='MU_plate_police', name='plate_r'))
    trim.append(rbox((0.36, 0.03, 0.03), loc=(0, yrp - 0.005, 0.955), bevel=0.008, m=mat('chrome_dull'), name='plb'))
    trim.append(make_plate((0, yfront - 0.09, 0.66), key='MU_plate_police', name='plate_f'))
    # Unterboden-Andeutung: Auspuff, Achsen, Tank
    trim.append(tube_path([(-0.55, 1.7, 0.30), (-0.55, 2.35, 0.30)], 0.035, segs=10, m=mat('metal_rusty'), name='exh'))
    for ya in C['axles']:
        trim.append(rbox((1.45, 0.12, 0.10), loc=(0, ya, 0.36), bevel=0.02, m=mat('underbody'), name='axle'))
    trim.append(rbox((1.6, 4.0, 0.06), loc=(0, 0.0, 0.335), bevel=0.02, m=mat('underbody'), name='floorpan'))
    # Frontscheibe Windlauf (dunkles Kunststoffgitter)
    cy = C['windshield'][0]
    pts = [(x, cy - 0.035, S.top_z(cy - 0.035, x) + 0.006) for x in np.linspace(-0.78, 0.78, 13)]
    trim.append(tube_path(pts, 0.014, segs=6, m=mat('plastic_black'), name='cowl'))
    body = join([body] + trim, C['name'] + '_body')
    # ---- Glas
    glass = split_by_mats(body, {'M_glass'}, C['name'] + '_glass')
    glass = join([glass] + covers, C['name'] + '_glass')
    # ---- Innenraum
    interior = make_interior_police(S, C)
    # ---- Lichtbalken
    lbh, lbl, mods, lbidx = make_lightbar(S, -0.02, C['name'] + '_lightbar')
    # Grill-/Heck-Blitzer (gleiche Namenskonvention)
    extra = []
    for col, sx in (('red', 1), ('blue', -1)):
        o = rbox((0.085, 0.025, 0.028), bevel=0.004, m=mat('E:lightbar_' + col), name='g')
        xform(o, loc=(sx * 0.22, gy - 0.004, 0.83))
        nm = 'LB_%s_%d' % (col, lbidx[col]); lbidx[col] += 1
        o.name = nm; o.data.name = nm; extra.append((nm, o))
        o = rbox((0.10, 0.02, 0.026), bevel=0.004, m=mat('E:lightbar_' + col), name='g')
        xform(o, loc=(sx * 0.30, S.yR - 0.03, 1.665), rot=(radians(-20), 0, 0))
        nm = 'LB_%s_%d' % (col, lbidx[col]); lbidx[col] += 1
        o.name = nm; o.data.name = nm; extra.append((nm, o))
    mods += extra
    # ---- Räder
    wl = make_wheel('wheel_L', R=C['tire_R'], w=C['tire_w'], rim_r=C['rim_r'], seed=1, wear=0.25)
    wr = mirror_x(wl, 'wheel_R')
    wheels = []
    zc = C['tire_R'] - 0.012
    for ya, tag in zip(C['axles'], ('F', 'R')):
        for sx, side in ((1, 'L'), (-1, 'R')):
            o = bpy.data.objects.new(C['name'] + '_wheel_' + tag + side, wl.data if sx > 0 else wr.data)
            work_coll().objects.link(o)
            o.location = Vector((sx * C['track'], ya, zc))
            if tag == 'F':
                o.rotation_euler = Euler((0, 0, radians(-9)))
            wheels.append(o)
    # Reifen unten abplatten (Aufstandsfläche) – im gemeinsamen Mesh, Radmitte bei zc
    for me in (wl.data, wr.data):
        for v in me.vertices:
            if v.co.z < -zc:
                v.co.z = -zc + (v.co.z + zc) * 0.15
    bpy.data.objects.remove(wl); bpy.data.objects.remove(wr)
    return dict(C=C, body=body, glass=glass, interior=interior, lightbar=lbh, lens=lbl, mods=mods, wheels=wheels)


def make_interior_police(S, C):
    parts = []
    # Innenschale: kleinere Loft-Kopie, Fensterband entfernt, Normalen nach innen
    Si = CarSpec(**{k: v for k, v in S.__dict__.items()})
    Si.yF, Si.yR = -1.05, 2.12
    Si.capF, Si.capR, Si.nF, Si.nR = 0.06, 0.06, 4.0, 4.0
    Si.leanF = 0.0; Si.leanRa = 0.0; Si.leanRb = 0.0
    Si.zcF, Si.zcR = 0.9, 1.0
    W0, Wb0, Wt0, zb0, zt0 = S.W, S.Wb, S.Wt, S.zb, S.zt
    Si.W = lambda y: W0(y) - 0.075
    Si.Wb = lambda y: Wb0(y) - 0.09
    Si.Wt = lambda y: Wt0(y) - 0.05
    Si.zb = lambda y: 0.47
    Si.zt = lambda y: zt0(y) - 0.045
    Si.special = [-0.12, 0.47, 0.58]
    Si.step = 0.12
    bm = build_loft(Si, 'ishell')
    lseg, lzone = L(bm, 'seg'), L(bm, 'zone')
    kill = []
    for f in bm.faces:
        c = fc(f); j = f[lseg]
        if CSTART[6] <= j < CSTART[11] and f[lzone] == 0:
            kill.append(f)
        elif j >= CSTART[11] and c.y < -0.10:
            kill.append(f)
        elif f[lzone] == 2 and c.z > 1.22:
            kill.append(f)
        elif f[lzone] == 1 and c.z > 1.10:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    for f in bm.faces:
        f.normal_flip()
    mats = [mat('interior_plastic'), mat('headliner'), mat('rubber_black')]
    for f in bm.faces:
        j = f[lseg]
        f.material_index = 1 if j >= CSTART[9] else (2 if j < CSTART[2] else 0)
    me = bpy.data.meshes.new('ishell'); bm.to_mesh(me); bm.free()
    sh = new_obj('ishell', me)
    for m in mats:
        me.materials.append(m)
    parts.append(sh)
    # Armaturenbrett
    M = mat('interior_plastic')
    dash = rbox((1.78, 0.46, 0.22), loc=(0, -0.83, 1.02), bevel=0.06, segs=3, m=M, name='dash')
    for v in dash.data.vertices:
        if v.co.y < -0.83:
            v.co.z -= (-0.83 - v.co.y) * 0.25
    parts.append(dash)
    parts.append(rbox((0.42, 0.16, 0.07), loc=(0.37, -0.66, 1.155), bevel=0.03, segs=2, m=M, name='binn'))
    parts.append(rbox((0.30, 0.22, 0.34), loc=(0, -0.70, 0.84), bevel=0.03, m=M, name='stack'))
    parts.append(rbox((0.26, 0.70, 0.18), loc=(0, -0.12, 0.60), bevel=0.03, m=M, name='console'))
    # Funkgeräte/Bedienteile in der Konsole
    for i, z in enumerate((0.72, 0.76)):
        parts.append(rbox((0.20, 0.06, 0.035), loc=(0, -0.34 + i * 0.09, z), bevel=0.006, m=mat('plastic_grey_dark'),
                          name='radio'))
    parts.append(make_steering(0.37, -0.52, 1.03))
    parts.append(make_seat(0.38, -0.08, 0.66, name='seat_l'))
    parts.append(make_seat(-0.38, -0.08, 0.66, name='seat_r', torn=True))
    # Laptop auf Ständer
    parts.append(tube_path([(0.02, -0.40, 0.69), (0.04, -0.44, 0.90), (0.10, -0.47, 1.02)], 0.018, segs=8,
                           m=mat('metal_powdercoat'), name='lt_pole'))
    parts.append(make_laptop(0.12, -0.48, 1.03, rotz=180 - 28))
    # Trennwand (unten massiv, oben Polycarbonat mit Gitter)
    yp = 0.42
    parts.append(rbox((1.56, 0.03, 0.50), loc=(0, yp, 0.78), bevel=0.01, m=mat('plastic_grey_dark'), name='part_l'))
    parts.append(rbox((1.30, 0.012, 0.46), loc=(0, yp, 1.27), bevel=0.004, m=mat('plastic_clear'), name='part_w'))
    for x in np.linspace(-0.62, 0.62, 9):
        parts.append(rbox((0.012, 0.012, 0.47), loc=(x, yp - 0.015, 1.27), bevel=0.003, m=mat('metal_powdercoat'), name='bar'))
    for z in (1.04, 1.51):
        parts.append(rbox((1.36, 0.03, 0.03), loc=(0, yp, z), bevel=0.006, m=mat('metal_powdercoat'), name='frame'))
    # Rücksitzbank (Hartschale)
    MB = mat('plastic_black')
    parts.append(rbox((1.36, 0.52, 0.10), loc=(0, 0.88, 0.66), bevel=0.04, segs=2, m=MB, name='rb_c'))
    rb = rbox((1.36, 0.10, 0.58), loc=(0, 0, 0.29), bevel=0.04, segs=2, m=MB, name='rb_b')
    rb.rotation_euler = Euler((radians(-12), 0, 0)); rb.location = Vector((0, 1.14, 0.70)); apply_tf(rb)
    parts.append(rb)
    # Kofferraum: Ausrüstungsbox
    parts.append(rbox((1.0, 0.45, 0.30), loc=(0, 1.75, 0.62), bevel=0.02, m=mat('metal_powdercoat'), name='vault'))
    parts.append(rbox((0.30, 0.22, 0.012), loc=(0.15, -0.95, 1.135), rot=(0, 0, 0.3), bevel=0.002,
                      m=mat('paper_white'), name='papers'))
    ob = join(parts, C['name'] + '_interior')
    return ob


# ----------------------------------------------------------------------------------------------
def test_body(S, out):
    bm = build_loft(S, 'body')
    ob = bm_to_obj(bm, 'body', [mat('plastic_grey_dark')])
    smooth(ob, 50)
    print('TEST tris', tri_count(ob), 'dims', ob.dimensions[:])
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'MATCAP'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.6, 0.6, 0.62)
    sc.render.resolution_x, sc.render.resolution_y = 900, 520
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    views = {'side': (Vector((9.5, 0, 1.0)), Vector((0, 0, 0.9))),
             'fq': (Vector((5.5, -6.5, 2.2)), Vector((0, -0.2, 0.8))),
             'rq': (Vector((-5.5, 6.5, 2.4)), Vector((0, 0.2, 0.9))),
             'front': (Vector((0, -9.5, 1.0)), Vector((0, 0, 0.9)))}
    for k, (p, t) in views.items():
        cam.location = p
        cam.rotation_euler = (t - p).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = out + '_' + k + '.png'
        bpy.ops.render.render(write_still=True)


exec(compile(open(os.path.join(HERE, 'props_vehicle_finish.py')).read(), 'props_vehicle_finish.py', 'exec'), globals())
