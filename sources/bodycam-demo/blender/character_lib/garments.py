# Stage "garments": Uniformhemd (mit Ärmeln, Manschetten, Kragen), Handschuhe, Hose, Stiefel aus dem Basiskörper.
# Figur blickt in diesem Stage -Y, links = +X.
import bpy, bmesh, math, os, json
import numpy as np
from mathutils import Vector
from .common import *
from . import gutil as G

J = {}


def jn(name):
    return np.array(J[name], float)


def tmp_color(o, rgba):
    m = bpy.data.materials.get('TMP_' + o.name) or bpy.data.materials.new('TMP_' + o.name)
    m.diffuse_color = rgba
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = rgba
    b.inputs['Roughness'].default_value = 0.85
    o.data.materials.clear()
    o.data.materials.append(m)


# ---------------------------------------------------------------- Arm-Koordinaten
def arm_coords(P, side):
    S = 'Left' if side > 0 else 'Right'
    A, E, W = jn(S + 'Arm'), jn(S + 'ForeArm'), jn(S + 'Hand')
    Lu = np.linalg.norm(E - A); Lf = np.linalg.norm(W - E)
    tu, ru, du, _ = G.seg_param(P, A, E)
    tf, rf, df, _ = G.seg_param(P, E, W)
    # Gelenkübergang weich: Oberarm bis tu<1, dann Unterarm
    use_f = tf > 0.0
    s = np.where(use_f, Lu + tf * Lf, tu * Lu)
    radial = np.where(use_f[:, None], rf, ru)
    axis = np.where(use_f[:, None], df[None, :], du[None, :])
    front = np.array([0.0, -1.0, 0.0])
    # Winkel: 0 = vorn (anterior), +pi/2 = seitlich außen
    th = np.zeros(len(P))
    for i in range(len(P)):
        ax = axis[i]
        ref = front - ax * (front @ ax); ref /= np.linalg.norm(ref)
        sd = np.cross(ax, ref)
        th[i] = math.atan2(radial[i] @ sd * side, radial[i] @ ref)
    return s, th, Lu, Lf


def fold(phase, sharp=1.5):
    return (0.5 + 0.5 * np.cos(2 * np.pi * phase)) ** sharp


def gauss(x, mu, sig):
    return np.exp(-0.5 * ((x - mu) / sig) ** 2)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- Hemd
CUFF_GAP = 0.012     # Ärmelende proximal vom Handgelenk
CUFF_W = 0.060       # Manschettenbreite


def build_shirt(body):
    o = G.dup_object(body, 'Shirt')
    bm = G.bm_from(o)
    # Hals: vorn tiefer
    G.bisect_keep(bm, (0, -0.02, 1.488), Vector((0, 0.42, -1)).normalized(), True,
                  region_mask=lambda c: abs(c.x) < 0.13 and c.z > 1.36)
    # Bund (wird in die Hose gesteckt)
    G.bisect_keep(bm, (0, 0, 0.955), (0, 0, 1), True, region_mask=lambda c: abs(c.x) < 0.30)
    # Manschetten
    for side, S in ((1, 'Left'), (-1, 'Right')):
        E, W = jn(S + 'ForeArm'), jn(S + 'Hand')
        d = (W - E) / np.linalg.norm(W - E)
        c = W - d * CUFF_GAP
        G.bisect_keep(bm, tuple(c), tuple(-d), True,
                      region_mask=lambda co, W=W: (Vector(co) - Vector(W)).length < 0.16)
    G.delete_small_islands(bm, 1)
    G.bm_to(o, bm); bm.free()
    G.subdivide(o, 1)
    P, e = G.mesh_arrays(o)
    n = len(P)
    # Glätten (Muskeldefinition raus)
    G.smooth_positions(o, np.ones(n), iters=12, lam=0.5)
    P, e = G.mesh_arrays(o)
    N = G.vnormals(o)
    off = np.full(n, 0.007)
    disp = np.zeros(n)
    sleeve_mask = np.zeros(n)
    s_all = np.zeros(n); th_all = np.zeros(n)
    for side, S in ((1, 'Left'), (-1, 'Right')):
        A = jn(S + 'Arm')
        sel = (P[:, 0] * side) > 0.13
        idx = np.where(sel)[0]
        s, th, Lu, Lf = arm_coords(P[idx], side)
        Lend = Lu + Lf - CUFF_GAP
        # Ärmelbereich: ab Schulter (s>0.0) weich einblenden
        w = smoothstep(-0.04, 0.03, s)
        sleeve_mask[idx] = w
        s_all[idx] = s; th_all[idx] = th
        # Weite: Oberarm 11 mm, Ellbogen 13, Unterarm 16, Manschette 6 mm
        ease = np.interp(s, [0.0, Lu * 0.5, Lu, Lu + Lf * 0.5, Lend - CUFF_W - 0.01, Lend - CUFF_W + 0.004, Lend],
                         [0.009, 0.011, 0.013, 0.016, 0.015, 0.0065, 0.0060])
        # Durchhang nach unten (Schwerkraft)
        sag = 0.005 * np.clip(-N[idx, 2], 0, 1) * smoothstep(0.02, 0.1, s) * (1 - smoothstep(Lend - CUFF_W - 0.02, Lend - CUFF_W, s))
        off[idx] = off[idx] * (1 - w) + (ease + sag) * w
        rng = np.random.default_rng(7 if side > 0 else 11)
        h = np.zeros(len(idx))
        cuff_env = 1 - smoothstep(Lend - CUFF_W - 0.012, Lend - CUFF_W, s)
        # Ellbogenbeuge: gebogene Falten vorn
        ant = gauss(th, 0.25, 0.75)
        ph = (s - Lu) / 0.024 + 0.35 * np.sin(th * 1.3) + 0.2
        h += 0.0042 * ant * gauss(s, Lu + 0.005, 0.045) * fold(ph, 2.0)
        # Ellbogenspitze hinten: weite Querfalten
        post = gauss(np.abs(th), math.pi, 0.8)
        h += 0.0022 * post * gauss(s, Lu + 0.01, 0.04) * fold((s - Lu) / 0.035 + 0.3 * np.sin(th * 2), 1.2)
        # Unterarm: Stauchung zur Manschette, spiralig
        phs = s / 0.030 + 0.45 * np.sin(th + rng.uniform(0, 6)) + 0.25 * np.sin(2.3 * th + rng.uniform(0, 6))
        bunch = smoothstep(Lu + 0.06, Lend - CUFF_W - 0.04, s) * cuff_env
        h += 0.0040 * bunch * fold(phs, 1.6)
        # Oberarm: diagonale Zugfalten von der Achsel (innen/hinten)
        under = gauss(th, -1.9, 0.9) + 0.5 * gauss(th, 1.9, 0.7)
        h += 0.0026 * under * gauss(s, 0.09, 0.07) * fold(s / 0.05 + th * 0.9, 1.3)
        # leichte Grundunruhe
        h += 0.0012 * G.noise3(P[idx], 9.0, seed=3 if side > 0 else 5) * cuff_env
        # Manschettennaht (Rille) + Manschettenkante
        h -= 0.0010 * gauss(s, Lend - CUFF_W, 0.0018)
        disp[idx] = h * w
    # Rumpf: Blusen über dem Gürtel + Grundunruhe
    torso = 1 - sleeve_mask
    z = P[:, 2]
    blouse = smoothstep(1.06, 0.98, z) * torso
    off += 0.006 * blouse
    disp += torso * (0.0014 * G.noise3(P, 6.0, seed=9) + 0.0035 * blouse * fold(z / 0.03 + 3 * np.sin(np.arctan2(P[:, 0], P[:, 1]) * 3), 1.5))
    co = P + N * (off + disp)[:, None]
    G.set_verts_np(o, co)
    G.set_attr(o, 'sleeve_s', s_all)
    G.set_attr(o, 'sleeve_th', th_all)
    G.set_attr(o, 'sleeve', sleeve_mask)
    # Säume an den Manschetten nach innen umschlagen
    hem_inward(o, lambda c: abs(c.x) > 0.3, depth=0.0025, length=0.012)
    tmp_color(o, (0.05, 0.07, 0.13, 1))
    return o


def hem_inward(o, loop_pred, depth=0.002, length=0.01):
    """Randschleifen (die loop_pred erfüllen) nach innen umschlagen: Materialstärke sichtbar."""
    bm = G.bm_from(o)
    bm.normal_update()
    for loop in G.boundary_loops(bm):
        cen = sum((v.co for v in loop), Vector()) / len(loop)
        if not loop_pred(cen):
            continue
        # Richtung "in den Ärmel hinein": von der Schleife weg zur Mitte der Nachbarn
        edges = [e for e in bm.edges if e.is_boundary and e.verts[0] in loop and e.verts[1] in loop]
        inward = Vector()
        for v in loop:
            for e in v.link_edges:
                w = e.other_vert(v)
                if not e.is_boundary:
                    inward += (w.co - v.co)
        inward.normalize()
        normals = {v: v.normal.copy() for v in loop}
        r1 = bmesh.ops.extrude_edge_only(bm, edges=edges)
        nv1 = [g for g in r1['geom'] if isinstance(g, bmesh.types.BMVert)]
        # Zuordnung neue->alte Vertices über Position
        for v in nv1:
            src = min(loop, key=lambda x: (x.co - v.co).length)
            v.co = src.co - normals[src] * depth
        e2 = [g for g in r1['geom'] if isinstance(g, bmesh.types.BMEdge) and g.is_boundary]
        r2 = bmesh.ops.extrude_edge_only(bm, edges=e2)
        nv2 = [g for g in r2['geom'] if isinstance(g, bmesh.types.BMVert)]
        for v in nv2:
            v.co = v.co + inward * length
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    G.bm_to(o, bm); bm.free()


# ---------------------------------------------------------------- Handschuhe
GLOVE_CUFF = 0.055


def build_gloves(body):
    out = []
    for side, S in ((1, 'Left'), (-1, 'Right')):
        o = G.dup_object(body, 'Glove_' + S[0])
        bm = G.bm_from(o)
        E, W = jn(S + 'ForeArm'), jn(S + 'Hand')
        d = (W - E) / np.linalg.norm(W - E)
        c = W - d * GLOVE_CUFF
        Wv = Vector(W)
        G.delete_verts(bm, lambda co: (co - Wv).length > 0.24)
        G.bisect_keep(bm, tuple(c), tuple(d), True)
        G.delete_small_islands(bm, 1)
        G.bm_to(o, bm); bm.free()
        G.subdivide(o, 1)
        P, e = G.mesh_arrays(o)
        n = len(P)
        # Abstand vom Handgelenk entlang Unterarmachse (negativ = Richtung Ellbogen)
        a = (P - W) @ d
        # Fingernägel / Venen leicht glätten (Finger nur wenig, sonst schrumpfen sie)
        m = np.clip(0.4 + 0.6 * smoothstep(-0.02, 0.03, a), 0, 1)
        G.smooth_positions(o, m * 0.6, iters=4, lam=0.4)
        P, e = G.mesh_arrays(o)
        N = G.vnormals(o)
        # Handrücken-Richtung (Hand-Bone-Z zeigt zur Handfläche -> dorsal = +X links)
        dorsal = np.array([side, 0.0, 0.0])
        dn = N @ dorsal
        off = 0.0014 + 0.0008 * np.clip(dn, 0, 1)
        cuff = smoothstep(0.0, -0.012, a)          # Bündchen
        off = off * (1 - cuff) + 0.0042 * cuff
        # Finger-Faltenringe auf Rückseite an den Gelenken
        h = np.zeros(n)
        for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
            for k in (2, 3):
                jp = jn(f'{S}Hand{f}{k}')
                dist = np.linalg.norm(P - jp, axis=1)
                h += 0.0006 * gauss(dist, 0.009, 0.002) * np.clip(dn, 0, 1)
        h += 0.0004 * G.noise3(P, 40.0, seed=21)
        co = P + N * (off + h)[:, None]
        G.set_verts_np(o, co)
        # Zonen: 1 = Handfläche (Kunstleder), 0 = Rücken (Stretch), 2 = Bündchen
        palm = smoothstep(0.05, 0.35, -dn) * (1 - cuff)
        G.set_attr(o, 'g_palm', palm)
        G.set_attr(o, 'g_cuff', cuff)
        G.set_attr(o, 'g_a', a)
        hem_inward(o, lambda cc: True, depth=0.0018, length=0.008)
        tmp_color(o, (0.02, 0.02, 0.022, 1))
        out.append(o)
    return out


def run(args):
    global J
    load_stage('rig')
    J = json.load(open(os.path.join(CHARDIR, 'joints.json')))
    body = obj('BaseBody')
    # Körper in Ruhepose (Modifier aus), damit Kopien unverformt sind
    rig = obj('OfficerRig')
    # Körper unverformt kopieren: Armature-Modifier wirkt nicht auf Mesh-Daten
    sh = build_shirt(body)
    col = build_collar(sh)
    gl = build_gloves(body)
    bo = build_boots(body)
    pa = build_pants(body)
    for o in [sh, col, pa] + gl + bo:
        skin(o, body, rig)
    # Körperkopie mit vollen Gewichten für NPC/Gewichtsübertrag behalten (versteckt)
    full = G.dup_object(body, 'BaseBody_Full')
    m = full.modifiers.new('Armature', 'ARMATURE'); m.object = rig
    full.parent = rig
    full.hide_render = True; full.hide_viewport = True
    trim_body(body)
    body.name = 'OFF_Head'
    tmp_color(body, (0.55, 0.38, 0.30, 1))
    save_stage('garments')


# ---------------------------------------------------------------- Hilfen 2D
def hull2d(P):
    P = sorted(set(map(tuple, np.round(P, 6))))
    if len(P) < 3:
        return np.array(P)
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return np.array(lo[:-1] + up[:-1])


def ring_from_hull(H, center, n, offset, fwd_angle):
    """Hülle radial (Strahlen vom Zentrum) mit n Punkten abtasten, nach außen versetzen.
    Winkel 0 = Fußvorwärtsrichtung."""
    out = []
    Hc = H - center
    m = len(H)
    for i in range(n):
        a = fwd_angle + 2 * np.pi * i / n
        d = np.array([np.cos(a), np.sin(a)])
        best = None
        for k in range(m):
            p, q = Hc[k], Hc[(k + 1) % m]
            # Strahl t*d schneidet Segment p + u (q-p)
            M = np.array([[d[0], p[0] - q[0]], [d[1], p[1] - q[1]]])
            if abs(np.linalg.det(M)) < 1e-12:
                continue
            t, u = np.linalg.solve(M, p)
            if t > 0 and -1e-6 <= u <= 1 + 1e-6:
                if best is None or t > best:
                    best = t
        r = (best if best is not None else 0.05) + offset
        out.append(center + d * r)
    return np.array(out)


def smooth_ring(R, k=2):
    for _ in range(k):
        R = 0.25 * np.roll(R, 1, 0) + 0.5 * R + 0.25 * np.roll(R, -1, 0)
    return R


def loft(name, rings, cap_bottom=True, cap_top=False):
    """rings: Liste (z, Nx2 xy) oder (N,3) -> Quad-Mesh."""
    verts = []; faces = []
    n = len(rings[0])
    for r in rings:
        verts += [tuple(p) for p in r]
    for j in range(len(rings) - 1):
        for i in range(n):
            a = j * n + i; b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_bottom:
        c = len(verts); verts.append(tuple(np.mean(rings[0], 0)))
        for i in range(n):
            faces.append((c, (i + 1) % n, i))
    if cap_top:
        base = (len(rings) - 1) * n
        c = len(verts); verts.append(tuple(np.mean(rings[-1], 0)))
        for i in range(n):
            faces.append((c, base + i, base + (i + 1) % n))
    o = new_mesh_obj(name, verts, faces)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


# ---------------------------------------------------------------- Stiefel
SOLE = 0.030          # Sohlenstärke (Figur wird in assemble um SOLE angehoben)
BOOT_TOP = 0.215
NB = 64               # Punkte pro Ring


def boot_rings(body, side):
    V = np.array([body.matrix_world @ v.co for v in body.data.vertices])
    S = 'Left' if side > 0 else 'Right'
    A = jn(S + 'Foot'); T = jn(S + 'Toe_End')
    fwd = T[:2] - A[:2]; fwd_ang = math.atan2(fwd[1], fwd[0])
    F = V[(V[:, 0] * side > 0.06) & (V[:, 2] < BOOT_TOP + 0.03)]
    zs = [0.0, 0.004, 0.010, 0.018, 0.028, 0.040, 0.052, 0.064, 0.076, 0.090, 0.105, 0.12, 0.135, 0.15, 0.165, 0.18, 0.195, BOOT_TOP]
    rings = []
    for z in zs:
        half = 0.006 if z > 0.03 else 0.004
        S2 = F[np.abs(F[:, 2] - z) < half][:, :2]
        if z < 0.03:
            # unten: ganze Fußsohle als Hülle (Zehen verschmelzen zur Schuhkappe)
            S2 = F[F[:, 2] < z + 0.012][:, :2]
        H = hull2d(S2)
        cen = np.array([A[0], A[1]]) + (fwd / np.linalg.norm(fwd)) * (-0.0 if z > 0.07 else 0.045)
        offs = 0.0065 if z > 0.02 else 0.008
        R = ring_from_hull(H, cen, NB, offs, fwd_ang)
        rings.append((z, R))
    # Glätten in z (Übergang Fußrücken -> Schaft)
    arr = np.array([r for z, r in rings])
    for _ in range(2):
        arr[1:-1] = 0.25 * arr[:-2] + 0.5 * arr[1:-1] + 0.25 * arr[2:]
    for i in range(len(arr)):
        arr[i] = smooth_ring(arr[i], 2)
    return [(z, arr[i]) for i, (z, _) in enumerate(rings)], fwd_ang


def build_boots(body):
    out = []
    for side, S in ((1, 'Left'), (-1, 'Right')):
        rings, fwd_ang = boot_rings(body, side)
        R3 = [np.column_stack([r, np.full(len(r), z)]) for z, r in rings]
        # Schaftoberkante leicht nach innen (Polsterkragen)
        top = R3[-1].copy(); c = top.mean(0)
        coll = c + (top - c) * 0.96; coll[:, 2] += 0.008
        R3.append(coll)
        o = loft('Boot_' + S[0], R3, cap_bottom=True, cap_top=False)
        G.subdivide(o, 1)
        # Sohle
        z0, r0 = rings[0]
        Rs = r0.copy(); cs = Rs.mean(0)
        Rs = cs + (Rs - cs) * 1.0 + 0
        sole_rings = []
        for z, scale in ((-SOLE, 0.985), (-SOLE + 0.004, 1.0), (-0.008, 1.03), (-0.003, 1.035), (0.002, 1.02), (0.006, 0.99)):
            rr = cs + (Rs - cs) * scale
            sole_rings.append(np.column_stack([rr, np.full(len(rr), z)]))
        so = loft('BootSole_' + S[0], sole_rings, cap_bottom=True, cap_top=True)
        G.subdivide(so, 1, simple=True)
        # Ferse: hinterer Teil etwas höher (Absatzkante)
        tmp_color(o, (0.03, 0.03, 0.03, 1)); tmp_color(so, (0.015, 0.015, 0.015, 1))
        out += [o, so]
        J['_boot_rings_' + S] = [(z, r.tolist()) for z, r in rings]
        J['_boot_fwd_' + S] = fwd_ang
    return out


# ---------------------------------------------------------------- Hose
PANT_CUT = 0.32


def build_pants(body):
    o = G.dup_object(body, 'Pants')
    bm = G.bm_from(o)
    G.delete_verts(bm, lambda c: abs(c.x) > 0.235 and c.z > 0.62)          # Hände/Arme
    G.bisect_keep(bm, (0, 0, 1.012), Vector((0, 0.18, -1)).normalized(), True)   # Bund (hinten höher)
    G.bisect_keep(bm, (0, 0, PANT_CUT), (0, 0, 1), True)
    G.delete_small_islands(bm, 1)
    G.bm_to(o, bm); bm.free()
    # Unterschenkel-Röhren anhängen (bis zum Saum über dem Stiefel)
    bm = G.bm_from(o)
    for side, S in ((1, 'Left'), (-1, 'Right')):
        loops = [l for l in G.boundary_loops(bm) if abs(sum(v.co.z for v in l) / len(l) - PANT_CUT) < 0.01
                 and sum(v.co.x for v in l) * side > 0]
        loop = loops[0]
        cen = sum((v.co for v in loop), Vector()) / len(loop)
        boot = {round(z, 3): np.array(r) for z, r in J['_boot_rings_' + S]}
        bz = sorted(boot)
        fwd_ang = J['_boot_fwd_' + S]
        fwd = np.array([math.cos(fwd_ang), math.sin(fwd_ang)])

        def boot_r(z, ang):
            # Stiefelradius bei Höhe z in Richtung ang (vom Ringzentrum)
            zz = min(bz, key=lambda q: abs(q - z))
            R = boot[zz]; c = R.mean(0)
            d = R - c; a = np.arctan2(d[:, 1], d[:, 0])
            i = np.argmin(np.abs(np.angle(np.exp(1j * (a - ang)))))
            return c, np.linalg.norm(d[i])
        # Schleife nach Winkel sortieren
        lv = sorted(loop, key=lambda v: math.atan2(v.co.y - cen.y, v.co.x - cen.x))
        ang = np.array([math.atan2(v.co.y - cen.y, v.co.x - cen.x) for v in lv])
        top = np.array([[v.co.x, v.co.y, v.co.z] for v in lv])
        K = 14
        prev = lv
        for k in range(1, K + 1):
            t = k / K
            ring = []
            for i, v in enumerate(lv):
                a = ang[i]
                front = math.cos(a - fwd_ang)
                hem_z = 0.092 + 0.040 * max(front, 0) - 0.012 * max(-front, 0)   # vorn höher (liegt auf dem Spann)
                z = PANT_CUT + (hem_z - PANT_CUT) * t
                c_b, rb = boot_r(z, a)
                # Zielradius: Stiefel + Luft; oben Übergang zum Körperring
                r_top = math.hypot(top[i, 0] - cen.x, top[i, 1] - cen.y)
                r_t = rb + 0.016 + 0.006 * t
                r = r_top * (1 - t) + max(r_t, r_top * 0.98) * t
                cx = cen.x * (1 - t) + c_b[0] * t; cy = cen.y * (1 - t) + c_b[1] * t
                ring.append(bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)))
            for i in range(len(lv)):
                j = (i + 1) % len(lv)
                try:
                    bm.faces.new((prev[i], prev[j], ring[j], ring[i]))
                except ValueError:
                    pass
            prev = ring
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    G.bm_to(o, bm); bm.free()
    P, e = G.mesh_arrays(o)
    n = len(P)
    # Schritt/Gesäß stark glätten, Rest leicht
    crotch = gauss(np.linalg.norm((P - np.array([0, -0.03, 0.86])) * np.array([1.6, 1.0, 1.0]), axis=1), 0, 0.09)
    G.smooth_positions(o, np.clip(0.35 + crotch, 0, 1), iters=14, lam=0.5)
    P, e = G.mesh_arrays(o)
    N = G.vnormals(o)
    z = P[:, 2]
    off = np.interp(z, [0.09, 0.32, 0.45, 0.6, 0.8, 0.9, 1.0, 1.03], [0.002, 0.004, 0.014, 0.014, 0.013, 0.012, 0.010, 0.010])
    off += 0.012 * crotch
    h = np.zeros(n)
    for side, S in ((1, 'Left'), (-1, 'Right')):
        K = jn(S + 'Leg'); H_ = jn(S + 'UpLeg')
        sel = P[:, 0] * side > 0.0
        rel = P - K
        ang = np.arctan2(rel[:, 0] * side, -rel[:, 1])    # 0 = vorn
        kn = gauss(z, K[2] - 0.005, 0.05) * sel
        # Kniekehle: Querfalten hinten
        h += 0.0045 * kn * gauss(np.abs(ang), math.pi, 0.9) * fold((z - K[2]) / 0.022 + 0.3 * np.sin(ang * 2), 1.8)
        # Knie vorn: weiche Bögen
        h += 0.0025 * kn * gauss(ang, 0, 0.9) * fold((z - K[2]) / 0.04 + 0.2 * ang * ang, 1.2)
        # Schritt-Zugfalten (diagonal, innen oben)
        inner = gauss(ang, -1.6, 0.7) * sel
        h += 0.0035 * inner * gauss(z, 0.80, 0.06) * fold((z * 0.6 + rel[:, 1] * 0.8) / 0.03, 1.5)
        # Stauchung über dem Stiefel
        stack = smoothstep(0.30, 0.14, z) * sel
        h += 0.0060 * stack * fold(z / 0.026 + 0.5 * np.sin(ang * 1.5 + side) + 0.3 * np.sin(ang * 3.1), 1.6)
    h += 0.0016 * G.noise3(P, 5.0, seed=17)
    co = P + N * (off + h)[:, None]
    G.set_verts_np(o, co)
    hem_inward(o, lambda c: c.z < 0.2, depth=0.0025, length=0.015)
    tmp_color(o, (0.05, 0.065, 0.11, 1))
    return o


# ---------------------------------------------------------------- Kragen
def build_collar(shirt):
    bm = G.bm_from(shirt)
    loops = [l for l in G.boundary_loops(bm) if sum(v.co.z for v in l) / len(l) > 1.4]
    loop = loops[0]
    pts = np.array([[v.co.x, v.co.y, v.co.z] for v in loop])
    bm.free()
    cen = pts.mean(0)
    ang = np.arctan2(pts[:, 0], -(pts[:, 1] - cen[1]))      # 0 = vorn
    order = np.argsort(ang)
    pts = pts[order]; ang = ang[order]
    # gleichmäßig neu abtasten
    M = 72
    A = np.linspace(-np.pi, np.pi, M, endpoint=False) + np.pi / M
    base = np.zeros((M, 3))
    for k in range(3):
        base[:, k] = np.interp(A, np.concatenate([ang - 2 * np.pi, ang, ang + 2 * np.pi]), np.tile(pts[:, k], 3))
    up = np.array([0, 0.18, 1.0]); up /= np.linalg.norm(up)
    radial = base - cen; radial -= np.outer(radial @ up, up)
    rn = radial / np.linalg.norm(radial, axis=1)[:, None]
    gap = 0.20   # vorn offen (rad)
    keep = np.abs(A) > gap
    idx = np.where(keep)[0]
    # Rollen der Spalte: Kragen beginnt hinter der Lücke, läuft um den Nacken
    start = np.argmax(A > gap)
    seq = [(start + i) % M for i in range(M) if keep[(start + i) % M]]
    rows = []
    front = np.cos(A)   # 1 = vorn
    stand_h = 0.034 - 0.006 * np.clip(front, 0, 1)
    r0 = base + rn * 0.002
    r1 = base + rn * 0.006 + up * stand_h[:, None]
    r2 = base + rn * 0.011 + up * (stand_h + 0.004)[:, None]
    leaf = 0.042 + 0.030 * np.clip(front, 0, 1) ** 3                # Kragenspitzen vorn länger
    r3 = base + rn * (0.030 + 0.012 * np.clip(front, 0, 1))[:, None] + up * (stand_h + 0.004 - leaf * 0.85)[:, None]
    # Spitzen: vorderste Punkte nach vorn-unten ziehen
    rows = [r0, r1, r2, r3]
    verts = []; faces = []
    nseq = len(seq)
    for r in rows:
        verts += [tuple(r[i]) for i in seq]
    for j in range(len(rows) - 1):
        for i in range(nseq - 1):
            a = j * nseq + i
            faces.append((a, a + 1, a + 1 + nseq, a + nseq))
    o = new_mesh_obj('ShirtCollar', verts, faces)
    for p in o.data.polygons:
        p.use_smooth = True
    m = o.modifiers.new('sol', 'SOLIDIFY'); m.thickness = 0.0022; m.offset = 0
    G.subdivide(o, 1)
    apply_mods(o)
    tmp_color(o, (0.05, 0.07, 0.13, 1))
    return o


# ---------------------------------------------------------------- Körper ausdünnen
def trim_body(body):
    """Unter Kleidung verborgene Haut löschen: nur Kopf/Hals bleibt."""
    bm = G.bm_from(body)
    G.bisect_keep(bm, (0, -0.02, 1.462), Vector((0, -0.42, 1)).normalized(), True,
                  region_mask=lambda c: True)
    G.delete_small_islands(bm, 1)
    G.bm_to(body, bm); bm.free()


def skin(o, body, rig):
    G.transfer_weights(o, body, 'POLYINTERP_NEAREST')
    G.normalize_weights(o, 4)
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = rig
    o.parent = rig
