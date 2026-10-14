"""shell_lib.py - Geometrie-Helfer fuer house_shell.py (UNIT 27 Bodycam-Demo, Baustein SHELL).

Alle Meshes werden direkt in Weltkoordinaten (Blender, Z-up, Meter) aufgebaut.
UVs werden am Ende pro Flaeche in Weltmetern projiziert (1 UV = 1 m).
"""
import bpy, math, zlib, random
from mathutils import Vector, Matrix

Z = Vector((0, 0, 1))
X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))


def rng(tag):
    """Deterministischer Zufall pro Merkmal (unabhaengig von PYTHONHASHSEED)."""
    return random.Random(zlib.crc32(tag.encode()))


def V(*a):
    return Vector(a if len(a) == 3 else a[0])


# --------------------------------------------------------------------------- mesh builder
class MB:
    """Sammelt Vertices/Faces/Materialien fuer ein Objekt."""

    def __init__(self):
        self.v = []
        self.f = []
        self.fm = []
        self.fs = []
        self.mats = []
        self.weld = {}

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def vert(self, p, key=None):
        if key is not None and key in self.weld:
            return self.weld[key]
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        i = len(self.v) - 1
        if key is not None:
            self.weld[key] = i
        return i

    def new_part(self):
        self.weld = {}

    def face(self, idx, mat, smooth=False):
        idx = list(idx)
        # doppelte aufeinanderfolgende Indizes entfernen
        out = []
        for i in idx:
            if not out or out[-1] != i:
                out.append(i)
        if len(out) > 2 and out[0] == out[-1]:
            out.pop()
        if len(out) < 3:
            return
        self.f.append(out)
        self.fm.append(self.mi(mat))
        self.fs.append(smooth)

    def poly(self, pts, mat, expect=None, smooth=False):
        """Flaeche aus Punkten; mit expect (Vector) wird die Windung so gedreht,
        dass die Normale in Richtung expect zeigt."""
        pts = [Vector(p) for p in pts]
        # doppelte Punkte entfernen
        clean = []
        for p in pts:
            if not clean or (p - clean[-1]).length > 1e-7:
                clean.append(p)
        if len(clean) > 2 and (clean[0] - clean[-1]).length < 1e-7:
            clean.pop()
        if len(clean) < 3:
            return
        if expect is not None:
            n = newell(clean)
            if n.dot(Vector(expect)) < 0:
                clean.reverse()
        self.face([self.vert(p) for p in clean], mat, smooth)

    def extend(self, other):
        off = len(self.v)
        self.v.extend(other.v)
        for f, m, s in zip(other.f, other.fm, other.fs):
            self.f.append([i + off for i in f])
            self.fm.append(self.mi(other.mats[m]))
            self.fs.append(s)

    def empty(self):
        return not self.f


def newell(pts):
    n = Vector((0, 0, 0))
    for i in range(len(pts)):
        a = pts[i]
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


# --------------------------------------------------------------------------- primitives
def box(mb, a, b, mat, M=None, mats=None):
    """Achsparalleler Quader von a nach b (optional mit Matrix M transformiert).
    mats: optional dict mit Materialien je Seite: 'top','bottom','side'."""
    x0, y0, z0 = a
    x1, y1, z1 = b
    if x0 > x1: x0, x1 = x1, x0
    if y0 > y1: y0, y1 = y1, y0
    if z0 > z1: z0, z1 = z1, z0
    P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    if M is not None:
        P = [tuple(M @ Vector(p)) for p in P]
    mb.new_part()
    idx = [mb.vert(p) for p in P]
    F = [((0, 3, 2, 1), 'bottom'), ((4, 5, 6, 7), 'top'), ((0, 1, 5, 4), 'side'),
         ((1, 2, 6, 5), 'side'), ((2, 3, 7, 6), 'side'), ((3, 0, 4, 7), 'side')]
    for f, k in F:
        m = mats.get(k, mat) if mats else mat
        mb.face([idx[i] for i in f], m)


def obox(mb, center, xaxis, yaxis, size, mat, mats=None):
    """Orientierter Quader: center, lokale x/y-Achse (z = x cross y), size=(sx,sy,sz)."""
    xa = Vector(xaxis).normalized()
    ya = Vector(yaxis).normalized()
    za = xa.cross(ya).normalized()
    ya = za.cross(xa).normalized()
    M = Matrix((
        (xa.x, ya.x, za.x, center[0]),
        (xa.y, ya.y, za.y, center[1]),
        (xa.z, ya.z, za.z, center[2]),
        (0, 0, 0, 1)))
    sx, sy, sz = size
    box(mb, (-sx / 2, -sy / 2, -sz / 2), (sx / 2, sy / 2, sz / 2), mat, M, mats)


def beam(mb, p0, p1, w, h, mat, up=Z):
    """Balken von p0 nach p1 mit Querschnitt w (seitlich) x h (in 'up'-Richtung)."""
    p0 = Vector(p0); p1 = Vector(p1)
    d = p1 - p0
    L = d.length
    if L < 1e-6:
        return
    xa = d / L
    side = xa.cross(Vector(up))
    if side.length < 1e-6:
        side = xa.cross(Vector((1, 0, 0)))
    side.normalize()
    obox(mb, (p0 + p1) / 2, xa, side, (L, w, h), mat)


def prism(mb, poly2d, origin, U, Vv, d0, d1, mat, mat_cap=None, caps=True):
    """Extrudiert ein 2D-Polygon (in Ebene origin + U*x + Vv*y) entlang N=U x Vv von d0 bis d1."""
    U = Vector(U); Vv = Vector(Vv); O = Vector(origin)
    N = U.cross(Vv).normalized()
    if d0 > d1:
        d0, d1 = d1, d0
    pts = [Vector(p) for p in poly2d]
    # Polygon CCW machen
    area = 0
    for i in range(len(pts)):
        a = pts[i]; b = pts[(i + 1) % len(pts)]
        area += a.x * b.y - b.x * a.y
    if area < 0:
        pts.reverse()
    mb.new_part()
    lo = [mb.vert(O + U * p.x + Vv * p.y + N * d0) for p in pts]
    hi = [mb.vert(O + U * p.x + Vv * p.y + N * d1) for p in pts]
    n = len(pts)
    if caps:
        mb.face(hi, mat_cap or mat)
        mb.face(lo[::-1], mat_cap or mat)
    for i in range(n):
        j = (i + 1) % n
        mb.face([lo[i], lo[j], hi[j], hi[i]], mat)


def cylinder(mb, p0, p1, r, mat, seg=12, caps=True, r1=None, smooth=True):
    p0 = Vector(p0); p1 = Vector(p1)
    d = (p1 - p0)
    if d.length < 1e-7:
        return
    a = d.normalized()
    t = a.cross(Vector((0, 0, 1)))
    if t.length < 1e-3:
        t = a.cross(Vector((1, 0, 0)))
    t.normalize()
    b = a.cross(t)
    r1 = r if r1 is None else r1
    mb.new_part()
    lo = []; hi = []
    for k in range(seg):
        ang = 2 * math.pi * k / seg
        c = t * math.cos(ang) + b * math.sin(ang)
        lo.append(mb.vert(p0 + c * r))
        hi.append(mb.vert(p1 + c * r1))
    for k in range(seg):
        j = (k + 1) % seg
        mb.face([lo[k], lo[j], hi[j], hi[k]], mat, smooth)
    if caps:
        mb.face(hi, mat)
        mb.face(lo[::-1], mat)
    # Windung pruefen: Seitenflaeche muss nach aussen zeigen
    va = Vector(mb.v[lo[0]]); vb = Vector(mb.v[lo[1]]); vc = Vector(mb.v[hi[1]])
    n = (vb - va).cross(vc - vb)
    if n.dot((va + vb) / 2 - p0) < 0:
        # alle gerade angelegten Flaechen umdrehen
        cnt = seg + (2 if caps else 0)
        for fi in range(len(mb.f) - cnt, len(mb.f)):
            mb.f[fi] = mb.f[fi][::-1]


def tube_path(mb, pts, r, mat, seg=6):
    """Duenne Leitung/Draht entlang Punktliste (einzelne Zylinder)."""
    for i in range(len(pts) - 1):
        cylinder(mb, pts[i], pts[i + 1], r, mat, seg=seg, caps=False)


def quad_slab(mb, corners_xy, zfun, thick, mat_top, mat_bot=None, mat_side=None):
    """Platte ueber 4+ Eckpunkten (xy, CCW), Oberseite z=zfun(x,y), Dicke vertikal."""
    top = [Vector((x, y, zfun(x, y))) for x, y in corners_xy]
    bot = [p - Vector((0, 0, thick)) for p in top]
    mb.new_part()
    n = len(top)
    mb.poly(top, mat_top, expect=Z)
    mb.poly(bot, mat_bot or mat_top, expect=-Z)
    c = sum(top, Vector()) / n
    for i in range(n):
        j = (i + 1) % n
        mid = (top[i] + top[j]) / 2
        out = mid - c
        out.z = 0
        mb.poly([bot[i], bot[j], top[j], top[i]], mat_side or mat_top, expect=out)


# --------------------------------------------------------------------------- grid slab with openings
def grid_slab(mb, O, A, B, c0, c1, a_rng, b_rng, holes, mat, mat_side=None,
              caps=(True, True, True, True), disp=None, cell=None, mat_fn=None, extra_a=(), extra_b=()):
    """Platte in der Ebene O + A*a + B*b mit Dicke entlang C=A x B (c0..c1).
    holes: Liste (a0,a1,b0,b1) rechteckiger Aussparungen. caps=(a-,a+,b-,b+) Randflaechen.
    disp(a,b)->Versatz entlang C (fuer Durchhang). cell: maximale Zellgroesse (Unterteilung).
    mat_fn(a,b,side)->Material je Zelle (side: +1 Oberseite c1, -1 Unterseite c0)."""
    O = Vector(O); A = Vector(A); B = Vector(B)
    C = A.cross(B).normalized()
    a0, a1 = a_rng
    b0, b1 = b_rng
    if c0 > c1:
        c0, c1 = c1, c0
    hs = []
    for h in holes:
        ha0, ha1, hb0, hb1 = h
        ha0 = max(ha0, a0); ha1 = min(ha1, a1); hb0 = max(hb0, b0); hb1 = min(hb1, b1)
        if ha1 - ha0 > 1e-5 and hb1 - hb0 > 1e-5:
            hs.append((ha0, ha1, hb0, hb1))
    As = {a0, a1}
    Bs = {b0, b1}
    for h in hs:
        As.update((h[0], h[1])); Bs.update((h[2], h[3]))
    As.update(x for x in extra_a if a0 < x < a1)
    Bs.update(x for x in extra_b if b0 < x < b1)
    As = sorted(As); Bs = sorted(Bs)
    if cell:
        def refine(lst):
            out = [lst[0]]
            for x in lst[1:]:
                n = max(1, int(math.ceil((x - out[-1]) / cell - 1e-6)))
                s = out[-1]
                for k in range(1, n + 1):
                    out.append(s + (x - s) * k / n)
            return out
        As = refine(As); Bs = refine(Bs)
    # doppelte entfernen
    def uniq(lst):
        o = []
        for x in lst:
            if not o or x - o[-1] > 1e-6:
                o.append(x)
        return o
    As = uniq(As); Bs = uniq(Bs)
    na = len(As) - 1; nb = len(Bs) - 1

    def solid(i, j):
        if i < 0 or j < 0 or i >= na or j >= nb:
            return False
        ca = (As[i] + As[i + 1]) / 2; cb = (Bs[j] + Bs[j + 1]) / 2
        for h in hs:
            if h[0] < ca < h[1] and h[2] < cb < h[3]:
                return False
        return True

    mb.new_part()

    def P(i, j, k):
        a = As[i]; b = Bs[j]
        c = c1 if k else c0
        d = disp(a, b) if disp else 0.0
        return mb.vert(O + A * a + B * b + C * (c + d), key=('g', i, j, k))

    ms = mat_side or mat
    for i in range(na):
        for j in range(nb):
            if not solid(i, j):
                continue
            ca = (As[i] + As[i + 1]) / 2; cb = (Bs[j] + Bs[j + 1]) / 2
            mt = mat_fn(ca, cb, 1) if mat_fn else mat
            mbm = mat_fn(ca, cb, -1) if mat_fn else mat
            mb.face([P(i, j, 1), P(i + 1, j, 1), P(i + 1, j + 1, 1), P(i, j + 1, 1)], mt)
            mb.face([P(i, j + 1, 0), P(i + 1, j + 1, 0), P(i + 1, j, 0), P(i, j, 0)], mbm)
            # +A
            if not solid(i + 1, j) and (i + 1 < na or caps[1]):
                mb.face([P(i + 1, j, 0), P(i + 1, j + 1, 0), P(i + 1, j + 1, 1), P(i + 1, j, 1)], ms)
            if not solid(i - 1, j) and (i > 0 or caps[0]):
                mb.face([P(i, j, 1), P(i, j + 1, 1), P(i, j + 1, 0), P(i, j, 0)], ms)
            if not solid(i, j + 1) and (j + 1 < nb or caps[3]):
                mb.face([P(i, j + 1, 0), P(i, j + 1, 1), P(i + 1, j + 1, 1), P(i + 1, j + 1, 0)], ms)
            if not solid(i, j - 1) and (j > 0 or caps[2]):
                mb.face([P(i + 1, j, 0), P(i + 1, j, 1), P(i, j, 1), P(i, j, 0)], ms)


def surface_grid(mb, xs, ys, zfun, mat_fn, smooth=False):
    """Einseitige Hoehenfeld-Flaeche (Normale +Z)."""
    mb.new_part()
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            pts = [(xs[i], ys[j]), (xs[i + 1], ys[j]), (xs[i + 1], ys[j + 1]), (xs[i], ys[j + 1])]
            idx = [mb.vert((x, y, zfun(x, y)), key=('s', round(x, 5), round(y, 5))) for x, y in pts]
            cx = (xs[i] + xs[i + 1]) / 2; cy = (ys[j] + ys[j + 1]) / 2
            m = mat_fn(cx, cy)
            if m is None:
                continue
            mb.face(idx, m, smooth)


# --------------------------------------------------------------------------- shapes
def jagged(r, cx, cy, rx, ry, n=24, rough=0.3, spikes=0.25, octaves=True):
    """Sternfoermiges, zackiges Polygon (fuer Loecher, Risse, Abrisse)."""
    # geglaettetes Rauschen ueber den Umfang + Spitzen
    base = [r.uniform(-1, 1) for _ in range(6)]
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n + r.uniform(-0.35, 0.35) * math.pi / n
        f = 1.0
        if octaves:
            f += 0.18 * (base[0] * math.cos(a) + base[1] * math.sin(a)) + 0.12 * (base[2] * math.cos(2 * a) + base[3] * math.sin(2 * a)) \
                + 0.08 * (base[4] * math.cos(3 * a) + base[5] * math.sin(3 * a))
        f += r.uniform(-rough, rough)
        if r.random() < spikes:
            f *= r.uniform(1.12, 1.45) if r.random() < 0.6 else r.uniform(0.6, 0.85)
        f = max(0.25, f)
        pts.append((cx + rx * f * math.cos(a), cy + ry * f * math.sin(a)))
    return pts


def rect_pts(a0, b0, a1, b1):
    return [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]


def clip_poly_rect(pts, x0, y0, x1, y1):
    """Sutherland-Hodgman: Polygon an Rechteck clippen."""
    def clip(poly, inside, inter):
        out = []
        for i in range(len(poly)):
            cur = poly[i]; prv = poly[i - 1]
            ci = inside(cur); pi = inside(prv)
            if ci:
                if not pi:
                    out.append(inter(prv, cur))
                out.append(cur)
            elif pi:
                out.append(inter(prv, cur))
        return out

    def ix(xv):
        return lambda p, q: (xv, p[1] + (q[1] - p[1]) * (xv - p[0]) / (q[0] - p[0]))

    def iy(yv):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (yv - p[1]) / (q[1] - p[1]), yv)
    poly = list(pts)
    for inside, inter in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1)),
                          (lambda p: p[1] >= y0, iy(y0)), (lambda p: p[1] <= y1, iy(y1))):
        if not poly:
            break
        poly = clip(poly, inside, inter)
    return poly


# --------------------------------------------------------------------------- objects
def coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def make_obj(name, mb, collection, surface=None, props=None, uv='auto', location=None, rotation_z=None):
    if mb.empty():
        return None
    me = bpy.data.meshes.new(name)
    me.from_pydata(mb.v, [], mb.f)
    for m in mb.mats:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', mb.fm)
    me.polygons.foreach_set('use_smooth', mb.fs)
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    if surface:
        ob['surface'] = surface
    if props:
        for k, v in props.items():
            ob[k] = v
    ob['uvMode'] = uv
    if location is not None:
        ob.location = location
    if rotation_z is not None:
        ob.rotation_euler = (0, 0, rotation_z)
    return ob


def bool_apply(ob, cutter_mb, op='DIFFERENCE', solver='EXACT'):
    """Wendet einen Boolean mit einem temporaeren Schneidekoerper an (kontextfrei)."""
    if ob is None or cutter_mb.empty():
        return
    cme = bpy.data.meshes.new('_cut')
    cme.from_pydata(cutter_mb.v, [], cutter_mb.f)
    for m in cutter_mb.mats:
        cme.materials.append(m)
    cme.polygons.foreach_set('material_index', cutter_mb.fm)
    cme.update()
    cut = bpy.data.objects.new('_cut', cme)
    bpy.context.scene.collection.objects.link(cut)
    cut.matrix_world = ob.matrix_world.copy()
    mod = ob.modifiers.new('B', 'BOOLEAN')
    mod.operation = op
    mod.object = cut
    mod.solver = solver
    if solver == 'EXACT':
        mod.use_self = True
        mod.use_hole_tolerant = True
        mod.material_mode = 'TRANSFER'
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.remove(mod)
    old = ob.data
    name = old.name
    ob.data = me
    bpy.data.meshes.remove(old)
    me.name = name
    bpy.data.objects.remove(cut)
    bpy.data.meshes.remove(cme)


def world_uv(ob, grain=None):
    """UV in Weltmetern (lokale Objektkoordinaten, Objektmassstab 1).
    Modus 'zup' fuer Fassadenlatten (v = z exakt)."""
    me = ob.data
    mode = ob.get('uvMode', 'auto')
    while len(me.uv_layers):
        me.uv_layers.remove(me.uv_layers[0])
    uvl = me.uv_layers.new(name='UVMap')
    co = [v.co.copy() for v in me.vertices]
    loops_v = [0] * len(me.loops)
    me.loops.foreach_get('vertex_index', loops_v)
    data = [0.0] * (len(me.loops) * 2)
    for p in me.polygons:
        n = p.normal
        if mode == 'xy':
            kind = 2
        elif mode == 'zup' and abs(n.z) < 0.9:
            kind = 1
        elif abs(n.z) < 0.26:
            kind = 1
        elif abs(n.z) > 0.97:
            kind = 2
        else:
            kind = 3
        if kind == 1:
            h = Vector((-n.y, n.x, 0))
            if h.length < 1e-6:
                h = Vector((1, 0, 0))
            h.normalize()
        elif kind == 3:
            h = Vector((-n.y, n.x, 0)).normalized()
            vv = n.cross(h).normalized()
        for li in p.loop_indices:
            c = co[loops_v[li]]
            if kind == 1:
                u, v = c.dot(h), c.z
            elif kind == 2:
                u, v = c.x, c.y
            else:
                u, v = c.dot(h), c.dot(vv)
            data[li * 2] = u
            data[li * 2 + 1] = v
        if grain and ob.get('uvGrain'):
            mname = me.materials[p.material_index].name if p.material_index < len(me.materials) and me.materials[p.material_index] else ''
            g = grain.get(mname)
            if g:
                us = [data[li * 2] for li in p.loop_indices]
                vs = [data[li * 2 + 1] for li in p.loop_indices]
                du = max(us) - min(us); dv = max(vs) - min(vs)
                if (g == 'u' and dv > du * 1.15) or (g == 'v' and du > dv * 1.15):
                    for li in p.loop_indices:
                        data[li * 2], data[li * 2 + 1] = data[li * 2 + 1], -data[li * 2]
    uvl.data.foreach_set('uv', data)
