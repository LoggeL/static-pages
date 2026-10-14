# Gelenkpositionen aus dem Körpermesh ableiten (linke Seite, wird gespiegelt).
# Reine numpy/heapq-Implementierung, damit es in Blender ohne scipy läuft.
import numpy as np, heapq

# Grobe Startwerte (Meter, Blender Z-up, Figur blickt -Y, links = +X), werden per Querschnitt verfeinert.
ROUGH = {
    'Hips':        (0.0, -0.005, 1.000),
    'Spine':       (0.0, 0.010, 1.085),
    'Spine1':      (0.0, 0.015, 1.200),
    'Spine2':      (0.0, 0.015, 1.320),
    'Neck':        (0.0, 0.020, 1.535),
    'Head':        (0.0, 0.005, 1.640),
    'HeadTop':     (0.0, 0.005, 1.808),
    'LeftShoulder': (0.030, -0.015, 1.495),
    'LeftArm':     (0.185, 0.000, 1.440),
    'LeftForeArm': (0.290, 0.000, 1.130),
    'LeftHand':    (0.405, -0.075, 0.945),
    'LeftUpLeg':   (0.095, -0.005, 0.960),
    'LeftLeg':     (0.110, -0.010, 0.520),
    'LeftFoot':    (0.125, 0.025, 0.085),
}

FINGER_TIPS_ROUGH = {
    'Thumb':  (0.393, -0.187, 0.865),
    'Index':  (0.444, -0.177, 0.800),
    'Middle': (0.457, -0.151, 0.775),
    'Ring':   (0.452, -0.121, 0.770),
    'Pinky':  (0.452, -0.072, 0.780),
}
# Länge Basisgelenk->Spitze (m) und Gelenk-Bruchteile (Grundglied, Mittelglied) entlang der Mittellinie
FINGER_LEN = {'Thumb': 0.112, 'Index': 0.094, 'Middle': 0.101, 'Ring': 0.096, 'Pinky': 0.077}
FINGER_FRAC = {'Thumb': (0.42, 0.72), 'Index': (0.47, 0.75), 'Middle': (0.47, 0.77),
               'Ring': (0.47, 0.76), 'Pinky': (0.45, 0.72)}


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


def slab_centroid(V, p, n, half=0.004, radius=0.1, idx=None):
    """Schwerpunkt der Vertices in einer dünnen Scheibe durch p mit Normale n (innerhalb radius)."""
    n = n / np.linalg.norm(n)
    P = V if idx is None else V[idx]
    d = (P - p) @ n
    r = np.linalg.norm((P - p) - np.outer(d, n), axis=1)
    m = (np.abs(d) < half) & (r < radius)
    if m.sum() < 4:
        return np.array(p, float)
    # Mitte der Bounding-Box im Querschnitt ist robuster als Schwerpunkt (ungleichmäßige Vertexdichte)
    Q = P[m]
    return 0.5 * (Q.min(0) + Q.max(0)) * 0.5 + Q.mean(0) * 0.5


def finger_centerline(V, hv, tip, total_len, step=0.0025, radius=0.0105):
    """Mittellinie per Röhren-Tracking von der Fingerspitze zurück.
    Solange der Querschnitt fingerartig ist, wird nachgeführt, danach geradeaus extrapoliert."""
    P = V[hv]
    t = V[tip]
    # Startrichtung: von der Spitze zum Schwerpunkt der Punkte in 1.5..2.5 cm Abstand
    dd = np.linalg.norm(P - t, axis=1)
    c0 = P[(dd > 0.015) & (dd < 0.025)].mean(0)
    dirv = (c0 - t) / np.linalg.norm(c0 - t)
    pts = [t.copy()]
    cur = t.copy()
    s = 0.0
    free = True
    widths = []
    while s < total_len + 0.01:
        pred = cur + dirv * step
        if free:
            d = (P - pred) @ dirv
            r = np.linalg.norm((P - pred) - np.outer(d, dirv), axis=1)
            m = (np.abs(d) < step * 0.8) & (r < radius)
            mw = (np.abs(d) < step * 0.8) & (r < radius * 2.2)
            if m.sum() >= 4 and s > 0.006:
                Q = P[m]
                c = 0.5 * (Q.min(0) + Q.max(0))
                c = c - ((c - pred) @ dirv) * dirv   # in der Ebene halten
                w = r[mw].max()
                widths.append(w)
                # Querschnitt zu breit -> Handfläche erreicht
                if len(widths) > 6 and np.mean(widths[-2:]) > 1.55 * np.median(widths[:6]):
                    free = False
                    pts.append(pred); cur = pred; s += step
                    continue
                nd = c - cur
                nd /= np.linalg.norm(nd)
                dirv = dirv * 0.6 + nd * 0.4
                dirv /= np.linalg.norm(dirv)
                cur = c
            else:
                cur = pred
        else:
            cur = pred
        pts.append(cur.copy())
        s += step
    pts = np.array(pts)
    for _ in range(2):
        pts[1:-1] = 0.25 * pts[:-2] + 0.5 * pts[1:-1] + 0.25 * pts[2:]
    return pts


def resample_arclen(pts, svals):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    acc = np.concatenate([[0], np.cumsum(seg)])
    out = []
    for s in svals:
        if s >= acc[-1]:
            # linear extrapolieren entlang der letzten 4 Punkte
            dvec = pts[-1] - pts[max(0, len(pts) - 5)]
            dvec /= np.linalg.norm(dvec)
            out.append(pts[-1] + dvec * (s - acc[-1]))
        else:
            i = np.searchsorted(acc, s) - 1
            i = max(0, i)
            t = (s - acc[i]) / max(1e-9, seg[i])
            out.append(pts[i] * (1 - t) + pts[i + 1] * t)
    return np.array(out)


def compute(V, F):
    E = edges_from_faces(F)
    J = {}
    # Rumpf/Beine/Arme: Querschnitts-Zentrierung in der X-Z- bzw. Y-Ebene
    for k, p in ROUGH.items():
        J[k] = np.array(p, float)
    # Arm-Gelenke entlang Armrichtung zentrieren
    def refine(name, nrm, radius):
        J[name] = slab_centroid(V, J[name], np.array(nrm, float), half=0.006, radius=radius)
    a = J['LeftForeArm'] - J['LeftArm']; refine('LeftForeArm', a, 0.06)
    b = J['LeftHand'] - J['LeftForeArm']; refine('LeftHand', b, 0.045)
    # Knie/Knöchel: Y-Zentrierung per horizontalem Schnitt (nur linkes Bein)
    for name, rad in (('LeftLeg', 0.08), ('LeftUpLeg', 0.10)):
        c = slab_centroid(V, J[name], np.array([0, 0, 1.0]), half=0.006, radius=rad)
        J[name][1] = c[1]
        if name == 'LeftLeg':
            J[name][0] = c[0]
    # Wirbelsäule: Y aus Querschnitt (Gelenk liegt ~35 % von hinten)
    for name in ('Spine', 'Spine1', 'Spine2', 'Neck'):
        z = J[name][2]
        m = (np.abs(V[:, 2] - z) < 0.006) & (np.abs(V[:, 0]) < 0.12)
        ys = V[m, 1]
        J[name][1] = ys.max() - 0.38 * (ys.max() - ys.min())
    # Finger: geodätische Distanz vom Handgelenk, Watershed von den Fingerspitzen -> Finger-Territorien
    hand_mask = (V[:, 0] > 0.30) & (V[:, 2] > 0.60) & (V[:, 2] < 1.05)
    W = J['LeftHand']
    fa = W - J['LeftForeArm']; fa /= np.linalg.norm(fa)
    hand_mask &= ((V - W) @ fa) > -0.01
    adj = build_adj(E, V, hand_mask)
    hv = np.where(hand_mask)[0]
    src = [i for i in hv if ((V[i] - W) @ fa) < -0.006]
    g = dijkstra(adj, src)
    tips = {}
    for f, tp in FINGER_TIPS_ROUGH.items():
        tips[f] = hv[np.argmin(np.linalg.norm(V[hv] - np.array(tp), axis=1))]
    label = {}
    order = sorted(g.keys(), key=lambda i: -g[i])
    for f, t in tips.items():
        label[t] = f
    # Watershed: höchste Distanz zuerst, Label vom Nachbarn mit größerer Distanz übernehmen
    for i in order:
        if i in label:
            continue
        best = None; bg = -1
        for nb, w in adj.get(i, ()):
            if nb in label and g.get(nb, -1) > g[i] and g[nb] > bg:
                best = label[nb]; bg = g[nb]
        if best is not None:
            label[i] = best
    J['_labels'] = label
    J['_g'] = g
    for f in FINGER_TIPS_ROUGH:
        ids = np.array([i for i, l in label.items() if l == f])
        gv = np.array([g[i] for i in ids])
        P = V[ids]
        gt = g[tips[f]]
        cl = []
        s = gt - 0.003
        while s > 0.0:
            m = np.abs(gv - s) < 0.0025
            if m.sum() >= 3:
                Q = P[m]
                cl.append(0.5 * (Q.min(0) + Q.max(0)) * 0.5 + Q.mean(0) * 0.5)
            s -= 0.003
        cl = np.array([V[tips[f]]] + cl)
        for _ in range(3):
            cl[1:-1] = 0.25 * cl[:-2] + 0.5 * cl[1:-1] + 0.25 * cl[2:]
        L = FINGER_LEN[f]
        fr = FINGER_FRAC[f]
        pts = resample_arclen(cl, [L, L * (1 - fr[0]), L * (1 - fr[1]), 0.004])
        for k in range(4):
            J[f'LeftHand{f}{k+1}'] = pts[k]
        J['_cl_' + f] = cl
    return J
