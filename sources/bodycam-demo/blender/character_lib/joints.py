# Gelenkpositionen aus dem CC0-Basismesh (Figur blickt -Y, links = +X, Z-up, Meter).
# Rumpf/Gliedmaßen: Querschnitts-Mittellinien; Finger: geodätische Ringe ab Fingerspitze.
# Reines numpy (läuft in Blender und außerhalb).
import numpy as np, heapq

# Anatomische Gliedlängen (m, erwachsener Mann), werden auf die Handgröße skaliert.
# (Spitze->DIP, DIP->PIP, PIP->MCP); Daumen: (Spitze->IP, IP->MCP, MCP->CMC)
PHAL = {
    'Thumb':  (0.027, 0.032, 0.046),
    'Index':  (0.024, 0.025, 0.044),
    'Middle': (0.025, 0.030, 0.049),
    'Ring':   (0.025, 0.028, 0.046),
    'Pinky':  (0.022, 0.020, 0.036),
}
FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']


def edges_from_faces(F):
    E = []
    for f in F:
        n = len(f)
        for i in range(n):
            a, b = f[i], f[(i + 1) % n]
            E.append((a, b) if a < b else (b, a))
    return np.unique(np.array(E), axis=0)


def build_adj(E, V, mask=None):
    adj = {}
    for a, b in E:
        if mask is not None and not (mask[a] and mask[b]):
            continue
        w = float(np.linalg.norm(V[a] - V[b]))
        adj.setdefault(a, []).append((b, w))
        adj.setdefault(b, []).append((a, w))
    return adj


def dijkstra(adj, sources, maxd=1e9):
    dist = {}
    h = [(0.0, s) for s in sources]
    heapq.heapify(h)
    while h:
        d, u = heapq.heappop(h)
        if u in dist:
            continue
        dist[u] = d
        if d > maxd:
            continue
        for v, w in adj.get(u, ()):
            if v not in dist:
                heapq.heappush(h, (d + w, v))
    return dist


def section_center(V, p, n, half=0.004, radius=0.1):
    n = np.asarray(n, float); n = n / np.linalg.norm(n)
    d = (V - p) @ n
    r = np.linalg.norm((V - p) - np.outer(d, n), axis=1)
    m = (np.abs(d) < half) & (r < radius)
    if m.sum() < 6:
        return np.array(p, float), 0
    Q = V[m]
    # Mittelpunkt aus Bounding-Box in der Schnittebene (robust gegen ungleiche Dichte)
    return 0.5 * (0.5 * (Q.min(0) + Q.max(0)) + Q.mean(0)), m.sum()


def limb_line(V, a, b, radius, n=12):
    """Mittellinie zwischen a und b per Querschnitten; liefert Punkte."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    d = b - a
    pts = []
    for t in np.linspace(0.0, 1.0, n):
        c, k = section_center(V, a + d * t, d, 0.004, radius)
        if k:
            pts.append(c)
    return np.array(pts)


def fit_line(P):
    c = P.mean(0)
    u, s, vt = np.linalg.svd(P - c)
    d = vt[0]
    return c, d


def closest_on_line(c, d, p):
    return c + d * ((p - c) @ d)


def compute(V, F):
    J = {}
    # ---------- Bein (links) ----------
    thigh = limb_line(V, (0.10, -0.01, 0.80), (0.11, -0.01, 0.62), 0.09)
    shin = limb_line(V, (0.12, 0.0, 0.40), (0.125, 0.01, 0.16), 0.07)
    ct, dt = fit_line(thigh); cs, ds = fit_line(shin)
    knee_z = 0.505
    J['LeftLeg'] = closest_on_line(ct, dt, np.array([0, 0, knee_z])) * 0.5 + closest_on_line(cs, ds, np.array([0, 0, knee_z])) * 0.5
    # z exakt setzen (Line-Projektion kann leicht abweichen)
    def at_z(c, d, z):
        t = (z - c[2]) / d[2]
        return c + d * t
    J['LeftLeg'] = 0.5 * (at_z(ct, dt, knee_z) + at_z(cs, ds, knee_z))
    J['LeftLeg'][1] += 0.008   # Kniegelenk liegt etwas hinter der Mitte
    # Hüftgelenk/Sprunggelenk: Achsen-Extrapolation trifft die Gelenke schlecht -> anatomisch gesetzt (gemessen)
    J['LeftUpLeg'] = np.array([0.090, -0.008, 0.945])
    J['LeftFoot'] = np.array([0.190, 0.042, 0.082])
    # Fußballen / Zehen
    foot = V[(V[:, 0] > 0.05) & (V[:, 2] < 0.10)]
    toe_tip = foot[np.argmin(foot[:, 1])]
    J['LeftToe_End'] = np.array([toe_tip[0], toe_tip[1] + 0.004, 0.022])
    ball = J['LeftFoot'] + (J['LeftToe_End'] - J['LeftFoot']) * 0.72
    J['LeftToeBase'] = np.array([ball[0], ball[1], 0.028])
    # ---------- Becken / Wirbelsäule ----------
    hip_z = J['LeftUpLeg'][2]

    def spine_y(z, frac):
        m = (np.abs(V[:, 2] - z) < 0.005) & (np.abs(V[:, 0]) < 0.06)
        ys = V[m, 1]
        return ys.max() - frac * (ys.max() - ys.min())   # von hinten (+Y) gemessen
    J['Hips'] = np.array([0.0, spine_y(hip_z + 0.05, 0.50), hip_z + 0.05])
    J['Spine'] = np.array([0.0, spine_y(1.095, 0.36), 1.095])
    J['Spine1'] = np.array([0.0, spine_y(1.215, 0.33), 1.215])
    J['Spine2'] = np.array([0.0, spine_y(1.335, 0.33), 1.335])
    J['Neck'] = np.array([0.0, spine_y(1.515, 0.45), 1.515])
    J['Head'] = np.array([0.0, -0.020, 1.630])
    J['HeadTop_End'] = np.array([0.0, J['Head'][1], V[:, 2].max()])
    # ---------- Arm ----------
    up = limb_line(V, (0.215, -0.005, 1.33), (0.27, -0.005, 1.19), 0.07)
    fo = limb_line(V, (0.31, -0.02, 1.08), (0.375, -0.04, 0.99), 0.06)
    cu, du = fit_line(up); cf, df = fit_line(fo)
    # Ellbogen: Punkt kleinsten Abstands der beiden Achsen
    w0 = cu - cf
    a_, b_, c_ = du @ du, du @ df, df @ df
    d_, e_ = du @ w0, df @ w0
    den = a_ * c_ - b_ * b_
    s = (b_ * e_ - c_ * d_) / den; t = (a_ * e_ - b_ * d_) / den
    elbow = 0.5 * ((cu + du * s) + (cf + df * t))
    J['LeftForeArm'] = elbow
    J['LeftArm'] = np.array([0.188, -0.005, 1.430])
    J['LeftShoulder'] = np.array([0.032, J['Neck'][1] - 0.025, 1.475])
    # Handgelenk: Querschnitt am Übergang Unterarm->Hand
    wr = at_z(cf, df, 0.948)
    J['LeftHand'] = section_center(V, wr, df, 0.004, 0.05)[0]
    J['_arm'] = (cu, du, cf, df)
    # ---------- Hand / Finger ----------
    E = edges_from_faces(F)
    W = J['LeftHand']
    hand_mask = (V[:, 0] > 0.30) & (V[:, 2] < W[2] + 0.02)
    adj = build_adj(E, V, hand_mask)
    hv = np.where(hand_mask)[0]
    TIPS = {'Thumb': (0.393, -0.190, 0.868), 'Index': (0.444, -0.176, 0.798), 'Middle': (0.457, -0.151, 0.776),
            'Ring': (0.452, -0.121, 0.772), 'Pinky': (0.452, -0.072, 0.786)}
    # Fingerlänge-Skalierung: Handlänge (Handgelenk->Mittelfingerspitze), Referenz 0.189 m
    tipM = hv[np.argmin(np.linalg.norm(V[hv] - np.array(TIPS['Middle']), axis=1))]
    hand_len = np.linalg.norm(V[tipM] - W)
    k = 1.0   # Handlänge gerade gemessen ist durch die Fingerkrümmung verkürzt -> anatomische Längen 1:1
    J['_handscale'] = k
    for f in FINGERS:
        tp = np.array(TIPS[f])
        cand = hv[np.linalg.norm(V[hv] - tp, axis=1) < 0.012]
        tip = cand[np.argmax((V[cand] - W) @ ((tp - W) / np.linalg.norm(tp - W)))]
        g = dijkstra(adj, [tip], maxd=0.11)
        ids = np.array(list(g.keys())); gv = np.array([g[i] for i in ids])
        cl = []
        sv = []
        r = 0.006
        while r < 0.10:
            m = np.abs(gv - r) < 0.0022
            if m.sum() >= 5:
                Q = V[ids[m]]
                ext = np.linalg.norm(Q.max(0) - Q.min(0))
                cl.append(0.5 * (Q.min(0) + Q.max(0)) * 0.5 + Q.mean(0) * 0.5)
                sv.append(ext)
            r += 0.002
        cl = np.array(cl); sv = np.array(sv)
        # freier Fingerabschnitt: Ringweite bleibt fingerartig
        base_w = np.median(sv[:6])
        free = len(cl)
        for i in range(6, len(sv)):
            if sv[i] > 1.6 * base_w:
                free = i; break
        J['_cl_' + f] = cl[:free]
        J['_clall_' + f] = cl
        tipP = V[tip]
        # Bogenlänge entlang Mittellinie, Start an der Spitze
        P = np.vstack([tipP, cl[:free]])
        seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
        acc = np.concatenate([[0], np.cumsum(seg)])
        # Richtung des proximalen freien Endstücks für Extrapolation
        tail = P[-min(6, len(P) - 1):]
        dprox = tail[-1] - tail[0]; dprox /= np.linalg.norm(dprox)

        def along(sdist):
            if sdist <= acc[-1]:
                i = max(0, np.searchsorted(acc, sdist) - 1)
                tt = (sdist - acc[i]) / max(seg[i], 1e-9)
                return P[i] * (1 - tt) + P[i + 1] * tt
            return P[-1] + dprox * (sdist - acc[-1])
        L = [x * k for x in PHAL[f]]
        s1 = L[0]; s2 = L[0] + L[1]; s3 = L[0] + L[1] + L[2]
        J[f'LeftHand{f}4'] = tipP
        J[f'LeftHand{f}3'] = along(s1)
        J[f'LeftHand{f}2'] = along(s2)
        J[f'LeftHand{f}1'] = along(s3)
        J['_free_' + f] = acc[-1]
    return J


def mirror(J):
    out = {}
    for k, v in J.items():
        if k.startswith('_'):
            continue
        out[k] = np.array(v, float)
        if k.startswith('Left'):
            r = np.array(v, float); r[0] = -r[0]
            out['Right' + k[4:]] = r
    return out
