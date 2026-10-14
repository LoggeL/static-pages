# props_vehicle_body.py — Karosserie-Loft (wird von props_vehicle.py per exec geladen)
#
# Querschnitt (halbe Kontur, x >= 0) durch 13 Kontrollpunkte c0..c12:
#   c0 Boden Mitte, c1/c2 Bodenkante, c3 Schweller-Knick, c4 Türbauch, c5 Schulter, c6 Gürtellinie,
#   c7 Scheibe unten, c8 Scheibe oben, c9 Regenleiste, c10 Dachkante, c11 Dach-/Frontscheibenrand, c12 Dachmitte.
# Vor/hinter dem Fahrgastraum (Haube/Kofferraum) fallen c7..c11 auf die Haubenfläche (k = 0).

COUNTS = [4, 2, 3, 4, 4, 2, 1, 6, 2, 2, 1, 8]
CSTART = [sum(COUNTS[:i]) for i in range(len(COUNTS) + 1)]  # Index des Kontrollpunkts in der Halbkontur
NHALF = CSTART[-1]  # Anzahl Segmente der Halbkontur (Punkte = NHALF + 1)


def seg_cls(j):
    """Kontroll-Segment (0..11) für Halbkontur-Segment j."""
    for i in range(len(COUNTS)):
        if CSTART[i] <= j < CSTART[i + 1]:
            return i
    return len(COUNTS) - 1


class CarSpec:
    def __init__(self, **kw):
        self.__dict__.update(kw)
        for key in ('zb', 'zr', 'zs', 'zbelt', 'crown', 'W', 'Wb', 'Wt', 'kmul'):
            v = kw.get(key)
            if isinstance(v, (list, tuple)):
                setattr(self, key, Pchip(v))
            elif v is not None and not callable(v):
                setattr(self, key, (lambda c: (lambda y: c))(v))
        self.zt = Pchip(kw['zt'], linear=True)
        if not hasattr(self, 'kmul'):
            self.kmul = lambda y: 1.0

    def kfac(self, y):
        return clamp((self.zt(y) - self.zbelt(y) - 0.03) / 0.45, 0.0, 1.0) * self.kmul(y)

    def half_ctrl(self, y):
        zb, zr, zs, zbelt, zt = self.zb(y), self.zr(y), self.zs(y), self.zbelt(y), self.zt(y)
        W, Wb, Wt, cr = self.W(y), self.Wb(y), self.Wt(y), self.crown(y)
        k = self.kfac(y)
        zt = max(zt, zbelt + 0.02)
        return [
            (0.0, zb),
            (Wb - 0.14, zb),
            (Wb, zb + 0.035),
            (W - 0.022, zr),
            (W, zr + 0.55 * (zs - zr)),
            (W - 0.006, zs),
            (W - 0.035, zbelt),
            (W - 0.048, zbelt + 0.016),
            (lerp(W - 0.085, Wt + 0.05, k), max(zbelt + 0.020, zt - 0.065 * k)),
            (lerp(W - 0.115, Wt + 0.022, k), max(zbelt + 0.022, zt - 0.018 * k)),
            (lerp(W - 0.155, Wt - 0.025, k), max(zbelt + 0.024, zt + 0.004)),
            (lerp(W - 0.215, Wt - 0.085, k), max(zbelt + 0.026, zt + 0.010)),
            (0.0, max(zbelt + 0.03, zt + cr)),
        ]

    def half(self, y):
        return catmull(self.half_ctrl(y), COUNTS)

    def side_x(self, y, z):
        """x der Karosserieseite (+X) auf Höhe z (zwischen c2 und c8)."""
        h = self.half(y)
        best = None
        for j in range(CSTART[2], CSTART[8]):
            (x0, z0), (x1, z1) = h[j], h[j + 1]
            if (z0 - z) * (z1 - z) <= 0 and abs(z1 - z0) > 1e-6:
                t = (z - z0) / (z1 - z0)
                best = x0 + (x1 - x0) * t
                break
        if best is None:
            best = max(p[0] for p in h)
        return best

    def top_z(self, y, x=0.0):
        """z der Oberseite (Haube/Dach) an (x, y)."""
        h = self.half(y)
        x = abs(x)
        for j in range(NHALF - 1, CSTART[6] - 1, -1):
            (x0, z0), (x1, z1) = h[j], h[j + 1]
            if (x0 - x) * (x1 - x) <= 0 and abs(x1 - x0) > 1e-6:
                return z0 + (z1 - z0) * (x - x0) / (x1 - x0)
        return h[-1][1]


def stations(S):
    ys = sorted(set(round(v, 4) for v in S.special if S.yF <= v <= S.yR) | {S.yF, S.yR})
    out = list(ys)
    n = int(math.ceil((S.yR - S.yF) / S.step))
    for i in range(1, n):
        y = S.yF + (S.yR - S.yF) * i / n
        if min(abs(y - s) for s in ys) > S.step * 0.45:
            out.append(y)
    return sorted(out)


def cap_rings(nring, p=2.4):
    """u-Parameter (0<u<1) und Superellipsen-Faktoren."""
    out = []
    for i in range(1, nring):
        u = i / nring
        g = u ** p / (u ** p + (1 - u) ** p)
        out.append(g * pi / 2)
    return out


def build_loft(S, name, cap_n=12):
    """Geschlossene Karosseriehülle. Gibt (bm, ring_info) zurück; Face-Layer: seg, side, zone, sty."""
    verts, faces, ftag = [], [], []
    rings = []  # Liste von Listen Vertex-Indizes
    ring_y = []

    def ring_from_half(half, fn):
        idx = []
        loop = [(x, z) for (x, z) in half] + [(-x, z) for (x, z) in half[NHALF - 1:0:-1]]
        for (x, z) in loop:
            X, Y, Z = fn(x, z)
            verts.append((X, Y, Z))
            idx.append(len(verts) - 1)
        return idx

    # Frontkappe
    hF = S.half(S.yF)
    thetas = cap_rings(cap_n)
    front = []
    for th in reversed(thetas):
        f = cos(th) ** (2.0 / S.nF); s = sin(th) ** (2.0 / S.nF)
        def fnF(x, z, f=f, s=s):
            zz = S.zcF + (z - S.zcF) * f
            xx = x * f
            return (xx, S.yF - S.capF * s + S.leanF * (zz - S.zcF) * s, zz)
        front.append((ring_from_half(hF, fnF), ('F', s)))
    sts = stations(S)
    mids = []
    for y in sts:
        h = S.half(y)
        mids.append((ring_from_half(h, lambda x, z, y=y: (x, y, z)), ('L', y)))
    hR = S.half(S.yR)
    rear = []
    for th in thetas:
        f = cos(th) ** (2.0 / S.nR); s = sin(th) ** (2.0 / S.nR)
        def fnR(x, z, f=f, s=s):
            zz = S.zcR + (z - S.zcR) * f
            xx = x * f
            lean = S.leanRa * (zz - S.zcR) + S.leanRb * max(0.0, zz - S.leanRzk)
            return (xx, S.yR + S.capR * s - lean * s, zz)
        rear.append((ring_from_half(hR, fnR), ('R', s)))
    allr = front + mids + rear
    L = 2 * NHALF
    # Pole
    sF = 1.0
    verts.append((0.0, S.yF - S.capF + 0.0, S.zcF)); poleF = len(verts) - 1
    verts.append((0.0, S.yR + S.capR - 0.0, S.zcR)); poleR = len(verts) - 1

    def seg_side(r):
        if r < NHALF:
            return r, 1
        return 2 * NHALF - r - 1, -1

    def zone_of(a, b):
        za = a[1][0]; zb_ = b[1][0]
        if za == 'L' and zb_ == 'L':
            return 0, (a[1][1] + b[1][1]) * 0.5
        if 'F' in (za, zb_):
            return 1, S.yF
        return 2, S.yR

    for i in range(len(allr) - 1):
        ra, rb = allr[i][0], allr[i + 1][0]
        zone, sty = zone_of(allr[i], allr[i + 1])
        for r in range(L):
            r2 = (r + 1) % L
            faces.append((ra[r], ra[r2], rb[r2], rb[r]))
            j, sd = seg_side(r)
            ftag.append((j, sd, zone, sty))
    # Polfächer
    ra = allr[0][0]
    for r in range(L):
        r2 = (r + 1) % L
        faces.append((poleF, ra[r2], ra[r]))
        j, sd = seg_side(r)
        ftag.append((j, sd, 1, S.yF))
    rb = allr[-1][0]
    for r in range(L):
        r2 = (r + 1) % L
        faces.append((rb[r], rb[r2], poleR))
        j, sd = seg_side(r)
        ftag.append((j, sd, 2, S.yR))
    me = bpy.data.meshes.new(name + '_tmp')
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    lseg = bm.faces.layers.int.new('seg')
    lside = bm.faces.layers.int.new('side')
    lzone = bm.faces.layers.int.new('zone')
    lsty = bm.faces.layers.float.new('sty')
    bm.faces.ensure_lookup_table()
    for f, (j, sd, zone, sty) in zip(bm.faces, ftag):
        f[lseg] = j; f[lside] = sd; f[lzone] = zone; f[lsty] = sty
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # degenerierte Faces entfernen
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def L(bm, name):
    return bm.faces.layers.int.get(name) or bm.faces.layers.float.get(name)


def faces_where(bm, pred):
    return [f for f in bm.faces if pred(f)]


def bisect(bm, faces, co, no):
    """Schneidet nur die gegebenen Faces an der Ebene (co, no)."""
    edges = list({e for f in faces for e in f.edges})
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, dist=1e-5, plane_co=Vector(co), plane_no=Vector(no),
                           clear_inner=False, clear_outer=False)


def fc(f):
    return f.calc_center_median()


def recess(bm, faces, depth, rim=0.004, rim_mat=None, floor_mat=None, mats=None):
    """Vertieft eine Face-Region (Leuchtengehäuse, Grill). Gibt (Boden-Faces, Wand-Faces) zurück."""
    if not faces:
        return [], []
    res = bmesh.ops.inset_region(bm, faces=faces, thickness=rim, depth=0.0, use_even_offset=True,
                                 use_boundary=True)
    walls1 = res['faces']
    res2 = bmesh.ops.inset_region(bm, faces=faces, thickness=0.0005, depth=-depth, use_even_offset=True,
                                  use_boundary=True)
    walls2 = res2['faces']
    if floor_mat is not None:
        for f in faces:
            f.material_index = floor_mat
    if rim_mat is not None:
        for f in walls2:
            f.material_index = rim_mat
    return faces, walls1 + walls2


# ---------- Atlas-UV für das Lack-Unikat
def atlas_layout(tex, scale, ext):
    """Regionen im Atlas (Pixel). ext: dict mit y0,y1,z0,z1,x0,x1. Liefert dict region -> (px0, py0, sx, sy, achsen)."""
    pad = 12
    y0, y1, z0, z1, x0, x1 = ext['y0'], ext['y1'], ext['z0'], ext['z1'], ext['x0'], ext['x1']
    sw = int((y1 - y0) * scale); sh = int((z1 - z0) * scale); th = int((x1 - x0) * scale)
    R = {}
    # Seiten: u = y (L) bzw. -y (R), v = z
    R['L'] = (pad, pad, sw, sh)
    R['R'] = (pad, pad * 2 + sh, sw, sh)
    R['T'] = (pad, pad * 3 + 2 * sh, sw, th)
    colx = pad * 2 + sw
    colw = tex - colx - pad
    fs = colw / (x1 - x0)
    fh = int((ext['zf1'] - z0) * fs); rh = int((z1 - z0) * fs)
    R['F'] = (colx, pad, colw, fh)
    R['B'] = (colx, pad * 2 + fh, colw, rh)
    R['U'] = (colx, pad * 3 + fh + rh, colw, max(16, tex - (pad * 4 + fh + rh)))  # Unterboden
    return R, fs


def face_region(n):
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    if n.z < -0.55:
        return 'U'
    if az >= ax and az >= ay:
        return 'T'
    if ax >= ay:
        return 'L' if n.x > 0 else 'R'
    return 'F' if n.y < 0 else 'B'


def assign_atlas_uv(ob, paint_mats, tex, scale, ext):
    """Projiziert Lack-Faces in Atlasregionen. Andere Faces: Weltmeter-Box-UV."""
    R, fs = atlas_layout(tex, scale, ext)
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    reg_of = {}
    for p in me.polygons:
        m = me.materials[p.material_index] if p.material_index < len(me.materials) else None
        if m is None or m.name not in paint_mats:
            continue
        rg = face_region(p.normal)
        reg_of[p.index] = rg
        px, py, sw, sh = R[rg]
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if rg == 'L':
                u = px + (co.y - ext['y0']) * scale; v = py + (ext['z1'] - co.z) * scale
            elif rg == 'R':
                u = px + (ext['y1'] - co.y) * scale; v = py + (ext['z1'] - co.z) * scale
            elif rg == 'T':
                u = px + (co.y - ext['y0']) * scale; v = py + (co.x - ext['x0']) * scale
            elif rg == 'F':
                u = px + (ext['x1'] - co.x) * fs; v = py + (ext['zf1'] - co.z) * fs
            elif rg == 'B':
                u = px + (co.x - ext['x0']) * fs; v = py + (ext['z1'] - co.z) * fs
            else:
                u = px + (co.x - ext['x0']) / (ext['x1'] - ext['x0']) * sw
                v = py + (co.y - ext['y0']) / (ext['y1'] - ext['y0']) * sh
            uv.data[li].uv = (u / tex, 1.0 - v / tex)
    return reg_of, R, fs


def export_paint_tris(ob, paint_mats, reg_of, tex, path):
    """Dreiecke der Lack-Faces (UV in Pixeln, Position, Normale, Region) für den Painter."""
    me = ob.data
    me.calc_loop_triangles()
    uv = me.uv_layers['UVMap']
    T = []
    regs = []
    rcode = {'L': 0, 'R': 1, 'T': 2, 'F': 3, 'B': 4, 'U': 5}
    for t in me.loop_triangles:
        if t.polygon_index not in reg_of:
            continue
        row = []
        for li in t.loops:
            u, v = uv.data[li].uv
            co = me.vertices[me.loops[li].vertex_index].co
            n = me.loops[li].normal if hasattr(me.loops[li], 'normal') else me.vertices[me.loops[li].vertex_index].normal
            row.append([u * tex, (1 - v) * tex, co.x, co.y, co.z, n.x, n.y, n.z])
        T.append(row)
        regs.append(rcode[reg_of[t.polygon_index]])
    np.savez_compressed(path, tris=np.array(T, dtype=np.float32), regs=np.array(regs, dtype=np.int8))


def box_uv(ob, skip=(), scale=1.0, seed=0):
    """Weltmeter-Box-UV für alle Faces, deren Material nicht in skip ist."""
    me = ob.data
    uv = me.uv_layers.get('UVMap') or (me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap'))
    uv.name = 'UVMap'
    rnd = random.Random(seed)
    ox, oy = rnd.uniform(0, 4), rnd.uniform(0, 4)
    for p in me.polygons:
        m = me.materials[p.material_index] if p.material_index < len(me.materials) else None
        if m is not None and m.name in skip:
            continue
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y * (1 if n.z > 0 else -1)
            elif ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            uv.data[li].uv = (u * scale + ox, v * scale + oy)
    return ob


def smooth(ob, angle=40):
    me = ob.data
    me.shade_smooth()
    if angle is not None and angle < 180:
        me.set_sharp_from_angle(angle=radians(angle))
    return ob


def fib_dirs(n):
    out = []
    ga = pi * (3 - sqrt(5))
    for i in range(n):
        z = 1 - (i + 0.5) / n
        r = sqrt(max(0, 1 - z * z))
        a = ga * i
        out.append(Vector((r * cos(a), r * sin(a), z)))
    return out


def bake_ao(obs, rays=14, dist=0.35, strength=0.75, ground=True, min_val=0.25, occluders=None):
    """Vertex-AO (COLOR_0) für mehrere Objekte gegen gemeinsame Geometrie (Weltraum)."""
    occ_list = occluders or obs
    bm = bmesh.new()
    for o in occ_list:
        tmp = o.data.copy()
        tmp.transform(o.matrix_world)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    dirs = fib_dirs(rays)
    for o in obs:
        me = o.data
        mw = o.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        cols = []
        for v in me.vertices:
            n = (nm @ v.normal).normalized()
            if n.length < 0.5:
                n = Vector((0, 0, 1))
            co = mw @ v.co
            t = n.orthogonal().normalized(); b = n.cross(t)
            o_ = co + n * 0.002
            occ = 0.0
            for d in dirs:
                w = t * d.x + b * d.y + n * d.z
                hit = bvh.ray_cast(o_, w, dist)
                if hit[0] is not None:
                    occ += 1.0 - (hit[3] / dist) * 0.5
                elif ground and w.z < -1e-4:
                    tt = -o_.z / w.z
                    if 0 < tt < dist:
                        occ += 1.0 - (tt / dist) * 0.5
            ao = 1.0 - occ / len(dirs)
            val = max(min_val, 1.0 - strength * (1.0 - ao))
            cols.append(val)
        attr = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(cols):
            attr.data[i].color = (c, c * 0.995, c * 0.99, 1.0)
        me.color_attributes.active_color = attr
        try:
            me.color_attributes.render_color_index = me.color_attributes.find('Color')
        except Exception:
            pass
