# Stage "gear": Plattenträger (Front/Rücken, Kummerbund, Schultergurte, MOLLE), 3 Gewehrmagazintaschen + Magazine,
# Funkgerät-Tasche + Funkgerät + Antenne, Schultermikrofon mit Spiralkabel, Klettfeld + POLICE-Aufnäher, Bodycam,
# Einsatzgürtel (Holster + Pistole, Handschellentasche, Lampe, Pistolenmagazintasche, Gürtelschlaufen), Cargotaschen.
# Figur blickt in diesem Stage -Y, links = +X.
import bpy, bmesh, math, os, json
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from .common import *
from . import gutil as G
from . import gmesh as M
from .garments import hull2d, ring_from_hull, smooth_ring, smoothstep, gauss

J = {}
INFO = {}          # Positionen für spätere Stages (Bodycam-Linse usw.)
PANEL_BIND = {}    # starre Gewichte für Vorder-/Rückenpaneel


def jn(n):
    return np.array(J[n], float)


def V_of(o):
    a = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', a)
    a = a.reshape(-1, 3)
    Mw = np.array(o.matrix_world)
    return a @ Mw[:3, :3].T + Mw[:3, 3]


def tag(o, kind):
    o['gear_mat'] = kind      # Materialzone für den Bake-Stage
    return o


def place(o, Mx):
    o.data.transform(Mx)
    o.data.update()
    return o


# ------------------------------------------------------------------ Plattenflächen
class PlateSurf:
    """y = f(x,z) (an Torso angepasst), side=-1 vorne, +1 hinten."""

    def __init__(self, V, side, xr, zr, gapfun, fitx=0.105):
        self.side = side
        m = (np.abs(V[:, 0]) < xr) & (V[:, 2] > zr[0]) & (V[:, 2] < zr[1])
        Q = V[m]
        pts = []
        for x in np.arange(-xr, xr + 1e-6, 0.01):
            mx = np.abs(Q[:, 0] - x) < 0.006
            Qx = Q[mx]
            for z in np.arange(zr[0], zr[1] + 1e-6, 0.01):
                mm = np.abs(Qx[:, 2] - z) < 0.006
                if mm.sum():
                    y = Qx[mm, 1].min() if side < 0 else Qx[mm, 1].max()
                    pts.append((x, z, y))
        P = np.array(pts)
        P = P[P[:, 2] * side > 0.03]          # nur die passende Körperseite (dünn besetzte Bins greifen sonst durch)
        self.pts = P
        P = P[np.abs(P[:, 0]) < fitx]
        self.zc = 0.5 * (zr[0] + zr[1])
        A = np.column_stack([np.ones(len(P)), P[:, 0] ** 2, P[:, 1] - self.zc, (P[:, 1] - self.zc) ** 2])
        c = np.linalg.lstsq(A, P[:, 2], rcond=None)[0]
        self.b = float(np.clip(c[1], 0.9, 1.6)) if side < 0 else -1.0
        # vertikales Profil: Platte liegt auf den vordersten Punkten auf (konvexe Hülle), dazwischen gerade
        P = self.pts
        gap = gapfun(P[:, 0], P[:, 1])
        need = P[:, 2] + side * gap - self.b * P[:, 0] ** 2
        zs = np.unique(np.round(P[:, 1], 3))
        req = np.array([(need[np.abs(P[:, 1] - z) < 1e-3]).min() if side < 0 else (need[np.abs(P[:, 1] - z) < 1e-3]).max() for z in zs])
        r = side * req                       # Abstand nach außen
        # obere Hülle von (z, r): kleinste konkave Funktion über allen Punkten = Plattenlinie
        up = []
        for p in zip(zs, r):
            while len(up) >= 2 and ((up[-1][0] - up[-2][0]) * (p[1] - up[-2][1]) - (up[-1][1] - up[-2][1]) * (p[0] - up[-2][0])) >= 0:
                up.pop()
            up.append(p)
        up = np.array(up)
        zz = np.linspace(zr[0] - 0.05, zr[1] + 0.05, 200)
        g = side * np.interp(zz, up[:, 0], up[:, 1])
        # über die Enden linear fortsetzen
        # glätten (Platte ist leicht gewölbt, keine Knicke)
        k = np.exp(-0.5 * (np.arange(-30, 31) * (zz[1] - zz[0]) / 0.03) ** 2); k /= k.sum()
        gp = np.pad(g, 30, mode='edge')
        g = np.convolve(gp, k, mode='same')[30:-30]
        f = np.interp(P[:, 1], zz, g)
        shift = np.max(side * (need - f))
        g = g + side * max(shift, 0)
        self.zz = zz; self.g = g
        print('PLATE side', side, 'b', round(self.b, 3), 'shift', round(shift, 4), 'g(top/mid/bot)', np.round(np.interp([zr[1], self.zc, zr[0]], zz, g), 3))

    def y(self, x, z):
        x = np.asarray(x, float); z = np.asarray(z, float)
        return np.interp(z.ravel(), self.zz, self.g).reshape(z.shape) + self.b * x * x


    def point_normal(self, x, z):
        x = np.asarray(x, float); z = np.asarray(z, float)
        e = 1e-4
        y = self.y(x, z)
        fx = (self.y(x + e, z) - self.y(x - e, z)) / (2 * e)
        fz = (self.y(x, z + e) - self.y(x, z - e)) / (2 * e)
        n = np.stack([fx, -np.ones_like(fx), fz], -1) * (-self.side)
        n /= np.linalg.norm(n, axis=-1)[..., None]
        P = np.stack([x, y, z], -1)
        return P, n


def half_width_fn(W, Wt, zcut, z0, z1, rb=0.028, rt=0.016):
    def w(z):
        z = np.asarray(z, float)
        t = np.clip((z - zcut) / max(z1 - 0.012 - zcut, 1e-6), 0, 1)
        t = t * t * (3 - 2 * t) * 0.35 + t * 0.65
        ww = W + (Wt - W) * t
        db = np.clip(rb - (z - z0), 0, rb)
        ww = ww - (rb - np.sqrt(np.clip(rb * rb - db * db, 0, None)))
        dt = np.clip(rt - (z1 - z), 0, rt)
        ww = ww - (rt - np.sqrt(np.clip(rt * rt - dt * dt, 0, None)))
        return ww
    return w


def plate_panel(name, surf, wfun, z0, z1, half_t, nu=45, nv=53):
    u = M.cosgrid(nu) * 2 - 1
    v = M.cosgrid(nv)
    UU, VV = np.meshgrid(u, v, indexing='ij')
    Z = z0 + VV * (z1 - z0)
    W = wfun(Z)
    X = UU * W
    P, n = surf.point_normal(X, Z)
    S = P + n * half_t
    du = (1 - np.abs(UU)) * W
    dv = np.minimum(Z - z0, z1 - Z)
    o = M.pillow(name, S, half_t, 0.010, du, dv)
    return o


def panel_frame(surf, half_t, x, z, lift=0.0):
    """Rahmen auf der Paneel-Außenseite: lokales -Y = nach außen."""
    P, n = surf.point_normal(np.array([x]), np.array([z]))
    P = P[0] + n[0] * (2 * half_t + lift)
    _, n1 = surf.point_normal(np.array([x + 0.01]), np.array([z]))
    P1, _ = surf.point_normal(np.array([x + 0.01]), np.array([z]))
    P0, _ = surf.point_normal(np.array([x]), np.array([z]))
    tx = P1[0] - P0[0]
    P2, _ = surf.point_normal(np.array([x]), np.array([z + 0.01]))
    tz = P2[0] - P0[0]
    if surf.side > 0:
        tx = -tx
    return M.mat_frame(Vector(P), Vector(tx), Vector(tz))


def conform(o, surf, half_t, x0, z0, lift=0.0, flip_x=False):
    """Mesh in lokalen Koordinaten (x quer, z hoch, -y nach außen) auf die gekrümmte Paneel-Außenseite biegen."""
    a = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get('co', a); a = a.reshape(-1, 3)
    sx = -1 if (surf.side > 0) != flip_x else 1
    X = x0 + sx * a[:, 0]; Z = z0 + a[:, 2]
    P, n = surf.point_normal(X, Z)
    W = P + n * (2 * half_t + lift - a[:, 1])[:, None]
    o.data.vertices.foreach_set('co', W.astype(np.float32).ravel())
    o.data.update()
    return o


# ------------------------------------------------------------------ Torso-Ringe
def torso_rings(V, zs, xlim=0.24, n=360):
    out = []
    for z in zs:
        m = (np.abs(V[:, 2] - z) < 0.007) & (np.abs(V[:, 0]) < xlim)
        H = hull2d(V[m][:, :2])
        c = H.mean(0)
        R = ring_from_hull(H, c, n, 0.0, 0.0)
        out.append((c, R))
    return out


def ring_dirs(n):
    a = 2 * np.pi * np.arange(n) / n
    return a, np.column_stack([np.cos(a), np.sin(a)])


def cummerbund(V, side, half_t=0.0065):
    zs = np.linspace(1.045, 1.215, 15)
    rings = torso_rings(V, zs)
    n = 360
    a, D = ring_dirs(n)
    radii = np.array([np.linalg.norm(R - c, axis=1) for c, R in rings])
    cen = np.array([c for c, R in rings])
    # glätten (z und Winkel)
    for _ in range(3):
        radii[1:-1] = 0.25 * radii[:-2] + 0.5 * radii[1:-1] + 0.25 * radii[2:]
    for i in range(len(radii)):
        r = radii[i]
        for _ in range(4):
            r = 0.25 * np.roll(r, 1) + 0.5 * r + 0.25 * np.roll(r, -1)
        radii[i] = r
    # Winkelbereich: von x=side*0.10 vorne bis x=side*0.09 hinten (mittlerer Ring)
    k = len(zs) // 2
    Pm = cen[k] + D * radii[k][:, None]
    fr = np.where((Pm[:, 1] < cen[k][1]) & (Pm[:, 0] * side > 0))[0]
    bk = np.where((Pm[:, 1] > cen[k][1]) & (Pm[:, 0] * side > 0))[0]
    af = a[fr[np.argmin(np.abs(Pm[fr, 0] - side * 0.100))]]
    ab = a[bk[np.argmin(np.abs(Pm[bk, 0] - side * 0.092))]]
    # kontinuierlicher Winkelbereich über die Seite
    if side > 0:
        a0, a1 = af - 2 * np.pi if af > np.pi else af, ab
    else:
        a0, a1 = ab, af
        if a1 < a0:
            a1 += 2 * np.pi
    nu, nv = 64, 17
    uu = a0 + (a1 - a0) * M.cosgrid(nu)
    vv = M.cosgrid(nv)
    S = np.zeros((nu, nv, 3)); du = np.zeros((nu, nv)); dv = np.zeros((nu, nv))
    zz = zs[0] + (zs[-1] - zs[0]) * vv
    off = 0.0045 + half_t
    for j, z in enumerate(zz):
        kf = np.interp(z, zs, np.arange(len(zs)))
        k0 = int(np.floor(kf)); k1 = min(k0 + 1, len(zs) - 1); t = kf - k0
        rr = radii[k0] * (1 - t) + radii[k1] * t
        cc = cen[k0] * (1 - t) + cen[k1] * t
        am = np.mod(uu, 2 * np.pi)
        r = np.interp(am, a, rr, period=2 * np.pi)
        P2 = cc + np.column_stack([np.cos(uu), np.sin(uu)]) * (r + off)[:, None]
        S[:, j, :2] = P2; S[:, j, 2] = z
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(S[:, nv // 2], axis=0), axis=1))])
    for j in range(nv):
        du[:, j] = np.minimum(arc, arc[-1] - arc)
        dv[:, j] = min(zz[j] - zz[0], zz[-1] - zz[j])
    o = M.pillow('Cummerbund_' + ('L' if side > 0 else 'R'), S, half_t, 0.008, du, dv)
    return o


# ------------------------------------------------------------------ Schultergurt
def shoulder_strap(V, side, half_t=0.0062, width=0.052, xs=0.100):
    nu, nv = 11, 72
    xo = np.linspace(-width / 2, width / 2, nu)
    c2 = np.array([0.0, 1.30])
    angs = np.linspace(np.pi - 0.02, 0.02, 400)
    paths = []
    for dx in xo:
        x = side * (xs + dx)
        m = (np.abs(V[:, 0] - x) < 0.006) & (V[:, 2] > 1.22)
        H = hull2d(V[m][:, [1, 2]])
        pts = []
        for a in angs:
            R = ring_from_hull(H, c2, 1, 0.0, a)
            pts.append(R[0])
        paths.append(np.array(pts))
    paths = np.array(paths)                     # (nu, 400, 2)
    for i in range(nu):
        for _ in range(6):
            paths[i][1:-1] = 0.25 * paths[i][:-2] + 0.5 * paths[i][1:-1] + 0.25 * paths[i][2:]
    mid = paths[nu // 2]
    ok = np.where(mid[:, 1] >= 1.372)[0]
    i0, i1 = ok.min(), ok.max()
    sel = np.linspace(i0, i1, nv).astype(int)
    S = np.zeros((nu, nv, 3))
    for i in range(nu):
        x = side * (xs + xo[i])
        p = paths[i][sel]
        S[i, :, 0] = x; S[i, :, 1] = p[:, 0]; S[i, :, 2] = p[:, 1]
    # Normale (y,z) nach außen relativ zu c2 -> Versatz
    for i in range(nu):
        d = S[i, :, 1:] - c2
        d /= np.linalg.norm(d, axis=1)[:, None]
        S[i, :, 1:] += d * (0.0035 + half_t)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(S[nu // 2], axis=0), axis=1))])
    du = np.zeros((nu, nv)); dv = np.zeros((nu, nv))
    for i in range(nu):
        du[i, :] = width / 2 - abs(xo[i])
    for j in range(nv):
        dv[:, j] = min(arc[j], arc[-1] - arc[j]) + 0.02
    o = M.pillow('Strap_' + ('L' if side > 0 else 'R'), S, half_t, 0.007, du, dv)
    INFO['strap_' + ('L' if side > 0 else 'R')] = S[nu // 2].tolist()
    return o


# ------------------------------------------------------------------ MOLLE-Reihen
def molle_rows(name, surf, half_t, xr, zrows, pitch=0.038, strip=0.025, lift=0.0):
    objs = []
    for zr in zrows:
        nu = int(2 * xr / 0.003) + 1
        xs = np.linspace(-xr, xr, nu)
        zs = np.linspace(zr - strip / 2, zr + strip / 2, 6)
        X, Z = np.meshgrid(xs, zs, indexing='ij')
        P, n = surf.point_normal(X, Z)
        # Riegel (Bartacks) alle 38 mm: Band liegt dort flach an
        ph = np.mod((X + xr) / pitch, 1.0)
        tack = np.exp(-0.5 * ((np.minimum(ph, 1 - ph)) / 0.045) ** 2)
        edge = np.clip(np.minimum(np.abs(xs[:, None] + xr), np.abs(xr - xs[:, None])) / 0.004, 0, 1)
        loft = 0.0007 + 0.0016 * (1 - tack) * edge
        ht = 0.0006
        S = P + n * (2 * half_t + lift + loft + ht)[..., None]
        du = np.minimum(X + xr, xr - X) + 0.003
        dv = np.minimum(Z - zs[0], zs[-1] - Z)
        o = M.pillow(name + f'_{len(objs)}', S, ht, 0.0012, du, dv)
        objs.append(o)
    return M.join(objs, name)


# ------------------------------------------------------------------ Magazin (Polymer, generisch)
def rifle_mag(name):
    """Stehend: Lippen oben (z=0.19), Boden unten (z=0). Breite (vorn/hinten) entlang X, Dicke entlang Y."""
    nz = 34
    zs = np.linspace(0.0, 0.178, nz)
    rings = []
    seg = 28
    for z in zs:
        t = z / 0.178
        cx = 0.022 * (1 - t) ** 2 - 0.004      # Krümmung (Boden weiter vorne)
        wdt = 0.0655 - 0.004 * t
        th = 0.0262 if z > 0.012 else 0.0262
        rr = 0.006
        pts = []
        for k in range(seg):
            ang = 2 * np.pi * k / seg
            # abgerundetes Rechteck (Superellipse)
            ca, sa = np.cos(ang), np.sin(ang)
            ex = 6.0
            px = np.sign(ca) * abs(ca) ** (2 / ex) * wdt / 2
            py = np.sign(sa) * abs(sa) ** (2 / ex) * th / 2
            pts.append((cx + px, py, z))
        rings.append(pts)
    # Rippen im unteren Drittel (Griffbereich)
    V = np.array(rings, float).reshape(-1, 3)
    F = M.grid_faces(seg, nz, closed_u=True)
    body = M.mesh_from(name + '_body', V, F)
    # Lippen/Deckel oben schließen
    bm = bmesh.new(); bm.from_mesh(body.data)
    bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)
    bm.to_mesh(body.data); bm.free()
    # Bodenplatte
    base = M.rbox(name + '_base', 0.074, 0.031, 0.013, bevel=0.004, segs=3, center=(0.020, 0, -0.004))
    # Griffrippen (quer)
    ribs = []
    for i in range(4):
        z = 0.018 + i * 0.006
        t = z / 0.178
        cx = 0.022 * (1 - t) ** 2 - 0.004
        ribs.append(M.rbox(name + f'_rib{i}', 0.067, 0.0285, 0.0022, bevel=0.0009, segs=1, center=(cx, 0, z)))
    o = M.join([body, base] + ribs, name)
    return o


# ------------------------------------------------------------------ Pistole (generisch, Polymerrahmen)
def pistol(name):
    """Lauf entlang +X, Oberseite +Z, Ursprung = Laufachse an der Verschlussmitte."""
    parts = []
    slide = M.rbox(name + '_slide', 0.186, 0.0254, 0.0285, bevel=0.0028, segs=3, center=(0.0, 0, 0.0055), subdiv=0)
    parts.append(slide)
    # Schlittenfräsungen hinten (Rillen)
    for i in range(7):
        x = -0.088 + i * 0.0045
        for sy in (-1, 1):
            parts.append(M.rbox(name + f'_ser{i}{sy}', 0.0018, 0.0012, 0.020, bevel=0.0004, segs=1,
                                center=(x, sy * 0.0128, 0.004)))
    # Visier
    parts.append(M.rbox(name + '_rsight', 0.008, 0.016, 0.006, bevel=0.0012, segs=1, center=(-0.085, 0, 0.0225)))
    parts.append(M.rbox(name + '_fsight', 0.006, 0.0045, 0.0055, bevel=0.0012, segs=1, center=(0.085, 0, 0.0222)))
    # Lauf-Mündung
    parts.append(M.cyl(name + '_barrel', 0.0068, 0.0068, 0.004, segs=20, center=(0.0935, 0, 0.004), axis='X'))
    # Rahmen (Staubschutz mit Schiene)
    parts.append(M.rbox(name + '_frame', 0.160, 0.0245, 0.0175, bevel=0.003, segs=2, center=(-0.004, 0, -0.0165)))
    for i in range(3):
        parts.append(M.rbox(name + f'_rail{i}', 0.004, 0.022, 0.004, bevel=0.0008, segs=1, center=(0.045 + i * 0.01, 0, -0.026)))
    # Abzugsbügel
    g = [(0.000, -0.024), (0.012, -0.050), (0.040, -0.052), (0.050, -0.040), (0.048, -0.025)]
    pts = M.bezier(np.array([(x, 0.0, z) for x, z in g]), 12)
    tg = M.tube(name + '_guard', pts, 0.0032, segs=10)
    tg.scale = (1, 2.6, 1)
    set_active(tg); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parts.append(tg)
    trig = M.tube(name + '_trigger', M.bezier(np.array([(0.022, 0, -0.026), (0.019, 0, -0.036), (0.022, 0, -0.045)]), 8),
                  0.0028, segs=8)
    parts.append(trig)
    # Griff (18° nach hinten geneigt)
    ang = math.radians(18)
    d = Vector((-math.sin(ang), 0, -math.cos(ang)))
    grip = M.rbox(name + '_grip', 0.050, 0.031, 0.098, bevel=0.007, segs=4, center=(0, 0, 0))
    R = Matrix.Rotation(-ang, 4, 'Y')
    top = Vector((-0.050, 0, -0.024))
    place(grip, Matrix.Translation(top + d * 0.049) @ R)
    parts.append(grip)
    # Griffrücken / Beavertail
    bt = M.rbox(name + '_tail', 0.022, 0.026, 0.014, bevel=0.005, segs=3, center=(-0.082, 0, -0.019))
    parts.append(bt)
    # Magazinboden
    mb = M.rbox(name + '_magbase', 0.052, 0.030, 0.008, bevel=0.0025, segs=2, center=(0, 0, 0))
    place(mb, Matrix.Translation(top + d * 0.101) @ R)
    parts.append(mb)
    o = M.join(parts, name)
    return o


# ------------------------------------------------------------------ Gürtel
def belt_rings(V, zc, n=240):
    rings = torso_rings(V, [zc - 0.02, zc, zc + 0.02], xlim=0.30, n=n)
    radii = np.array([np.linalg.norm(R - c, axis=1) for c, R in rings]).max(0)
    c = rings[1][0]
    for _ in range(6):
        radii = 0.25 * np.roll(radii, 1) + 0.5 * radii + 0.25 * np.roll(radii, -1)
    a, D = ring_dirs(n)
    return c, a, radii


def sweep_closed(name, ring, nrm, prof):
    """Geschlossener Sweep: ring (n,3), nrm (n,3) nach außen, prof (m,2) = (radial, z) geschlossen."""
    n = len(ring); m = len(prof)
    V = []
    up = np.array([0, 0, 1.0])
    for i in range(n):
        for r, z in prof:
            V.append(ring[i] + nrm[i] * r + up * z)
    F = []
    for i in range(n):
        for k in range(m):
            a = i * m + k; b = i * m + (k + 1) % m
            c = ((i + 1) % n) * m + (k + 1) % m; d = ((i + 1) % n) * m + k
            F.append((a, b, c, d))
    o = M.mesh_from(name, V, F)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data); bm.free()
    return o


def sweep_open(name, ring, nrm, prof):
    n = len(ring); m = len(prof)
    V = []; up = np.array([0, 0, 1.0])
    for i in range(n):
        for r, z in prof:
            V.append(ring[i] + nrm[i] * r + up * z)
    F = []
    for i in range(n - 1):
        for k in range(m):
            a = i * m + k; b = i * m + (k + 1) % m
            F.append((a, b, b + m, a + m))
    F.append(tuple(range(m))[::-1]); F.append(tuple((n - 1) * m + k for k in range(m)))
    o = M.mesh_from(name, V, F)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data); bm.free()
    return o


def rrect_profile(w, h, r, seg=4):
    """abgerundetes Rechteck (radial w, z h), zentriert, im Uhrzeigersinn."""
    pts = []
    cs = [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]
    for cx, cz, a0 in cs:
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


class Belt:
    def __init__(self, V, zc=0.996, h=0.056, t=0.0105):
        self.zc = zc
        c, a, radii = belt_rings(V, zc)
        self.c = c; self.a = a; self.r = radii + 0.0035
        self.t = t; self.h = h

    def at(self, ang, out=0.0):
        """Punkt auf der Gürtel-Außenseite bei Winkel ang (0 = +X, pi/2 = +Y), Normale."""
        r = np.interp(np.mod(ang, 2 * np.pi), self.a, self.r, period=2 * np.pi)
        d = np.array([math.cos(ang), math.sin(ang), 0.0])
        e = 1e-3
        r1 = np.interp(np.mod(ang + e, 2 * np.pi), self.a, self.r, period=2 * np.pi)
        r0 = np.interp(np.mod(ang - e, 2 * np.pi), self.a, self.r, period=2 * np.pi)
        p1 = np.array([math.cos(ang + e) * r1, math.sin(ang + e) * r1, 0]); p0 = np.array([math.cos(ang - e) * r0, math.sin(ang - e) * r0, 0])
        tng = (p1 - p0); tng /= np.linalg.norm(tng)
        n = np.cross(tng, [0, 0, 1.0]); n /= np.linalg.norm(n)
        if n @ d < 0:
            n = -n
        P = np.array([self.c[0], self.c[1], self.zc]) + d * r + n * (self.t + out)
        return P, n

    def frame(self, ang, out=0.0, dz=0.0):
        P, n = self.at(ang, out)
        P = P + np.array([0, 0, dz])
        up = Vector((0, 0, 1))
        x = up.cross(Vector(n))
        return M.mat_frame(Vector(P), x, up)

    def ang_for_dir(self, d):
        return math.atan2(d[1], d[0])

    def build(self):
        n = len(self.a)
        ring = []; nrm = []
        for ang in self.a:
            P, nn = self.at(ang, -self.t)
            ring.append(P); nrm.append(nn)
        prof = [(self.t / 2 + x, z) for x, z in rrect_profile(self.t, self.h, 0.0035)]
        o = sweep_closed('Belt', np.array(ring), np.array(nrm), prof)
        return o

    def segment(self, name, a0, a1, t, h, out=0.0, n=12, dz=0.0):
        ring = []; nrm = []
        for ang in np.linspace(a0, a1, n):
            P, nn = self.at(ang, -self.t)
            ring.append(P + np.array([0, 0, dz])); nrm.append(nn)
        prof = [(t / 2 - 0.0012 + out + x, z) for x, z in rrect_profile(t, h, min(t, h) * 0.35)]
        return sweep_open(name, np.array(ring), np.array(nrm), prof)


# ------------------------------------------------------------------ Cargotaschen
def cargo_pocket(pants, side):
    bvh = BVHTree.FromObject(pants, bpy.context.evaluated_depsgraph_get())
    Vp = V_of(pants)
    # Oberschenkel-Mitte bei z=0.66
    m = (np.abs(Vp[:, 2] - 0.66) < 0.01) & (Vp[:, 0] * side > 0.02)
    cy = 0.5 * (Vp[m, 1].min() + Vp[m, 1].max())
    objs = []
    for nm, (y0, y1, z0, z1, ht, lift) in {'body': (-0.062, 0.062, 0.575, 0.745, 0.0045, 0.0010),
                                          'flap': (-0.067, 0.067, 0.722, 0.775, 0.0030, 0.0072)}.items():
        nu, nv = 25, 25
        Y = cy + y0 + (y1 - y0) * M.cosgrid(nu)
        Z = z0 + (z1 - z0) * M.cosgrid(nv)
        S = np.zeros((nu, nv, 3)); du = np.zeros((nu, nv)); dv = np.zeros((nu, nv))
        for i, y in enumerate(Y):
            for j, z in enumerate(Z):
                # Balg: unten etwas abstehend
                o_ = Vector((side * 0.5, y, z))
                hit = bvh.ray_cast(o_, Vector((-side, 0, 0)))
                p = np.array(hit[0]) if hit[0] is not None else np.array([side * 0.15, y, z])
                nn = np.array(hit[1]) if hit[1] is not None else np.array([side, 0, 0.0])
                if nn[0] * side < 0:
                    nn = -nn
                bulge = 0.004 * math.sin(math.pi * (i / (nu - 1))) * (1 - (j / (nv - 1))) if nm == 'body' else 0.0
                S[i, j] = p + nn * (ht + lift + bulge)
                du[i, j] = min(y - Y[0], Y[-1] - y)
                dv[i, j] = min(z - Z[0], Z[-1] - z)
        objs.append(M.pillow(f'Cargo_{nm}_' + ('L' if side > 0 else 'R'), S, ht, 0.004, du, dv))
    o = M.join(objs, 'Cargo_' + ('L' if side > 0 else 'R'))
    return o


# ------------------------------------------------------------------ Hauptteil
def weights_avg(o, src, keep=0.04):
    """Gewichte vom Körper übertragen und gemittelt -> starr."""
    tmp = G.dup_object(o, o.name + '_wtmp')
    G.transfer_weights(tmp, src, 'POLYINTERP_NEAREST')
    nv = len(tmp.data.vertices)
    acc = {}
    names = {g.index: g.name for g in tmp.vertex_groups}
    for v in tmp.data.vertices:
        for ge in v.groups:
            nm = names[ge.group].split('.')[0]
            acc[nm] = acc.get(nm, 0.0) + ge.weight
    bpy.data.objects.remove(tmp, do_unlink=True)
    tot = sum(acc.values())
    w = {k: v / tot for k, v in acc.items() if v / tot > keep}
    s = sum(w.values())
    return {k: v / s for k, v in w.items()}


def blend_bind(o, src, rigid, maskfun):
    """Übertragene Gewichte mit starren Gewichten mischen (mask 1 = übertragen)."""
    G.transfer_weights(o, src, 'POLYINTERP_NEAREST')
    names = {g.index: g.name.split('.')[0] for g in o.vertex_groups}
    co = np.array([v.co[:] for v in o.data.vertices])
    mk = maskfun(co)
    W = []
    for i, v in enumerate(o.data.vertices):
        d = {}
        for ge in v.groups:
            d[names[ge.group]] = d.get(names[ge.group], 0) + ge.weight * mk[i]
        for b, w in rigid.items():
            d[b] = d.get(b, 0) + w * (1 - mk[i])
        W.append(d)
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
    groups = {}
    for i, d in enumerate(W):
        s = sum(d.values()) or 1
        for b, w in d.items():
            if w / s < 0.01:
                continue
            if b not in groups:
                groups[b] = o.vertex_groups.new(name=b)
            groups[b].add([i], w / s, 'REPLACE')
    G.normalize_weights(o, 4)


def run(args):
    global J
    load_stage('garments')
    J = json.load(open(os.path.join(CHARDIR, 'joints.json')))
    shirt = obj('Shirt'); collar = obj('ShirtCollar'); pants = obj('Pants')
    full = obj('BaseBody_Full')
    full.hide_viewport = False
    Vs = np.vstack([V_of(shirt), V_of(collar)])
    Vp = V_of(pants)
    np.save(os.path.join(CHARDIR, 'work', 'Vs.npy'), Vs); np.save(os.path.join(CHARDIR, 'work', 'Vp.npy'), Vp)
    gear = []      # (obj, bindmode)

    # ---------------- Plattenträger
    HT_F = 0.0145   # halbe Dicke Frontpaneel (Platte in Tasche)
    HT_B = 0.0135

    def gap_front(x, z):
        g = np.full_like(x, 0.004)
        g += 0.0165 * ((z > 1.35) & (np.abs(x) > 0.06) & (np.abs(x) < 0.14))
        g += 0.0175 * ((z < 1.225) & (np.abs(x) > 0.085))
        return g

    def gap_back(x, z):
        g = np.full_like(x, 0.004)
        g += 0.0165 * ((z > 1.36) & (np.abs(x) > 0.06) & (np.abs(x) < 0.14))
        g += 0.0175 * ((z < 1.225) & (np.abs(x) > 0.075))
        return g
    FZ0, FZ1 = 1.040, 1.425
    BZ0, BZ1 = 1.050, 1.445
    front = PlateSurf(Vs, -1, 0.14, (FZ0, FZ1), gap_front)
    back = PlateSurf(Vs, +1, 0.145, (BZ0, BZ1), gap_back)
    wf = half_width_fn(0.135, 0.088, 1.300, FZ0, FZ1)
    wb = half_width_fn(0.140, 0.105, 1.340, BZ0, BZ1)
    pf = plate_panel('Carrier_Front', front, wf, FZ0, FZ1, HT_F)
    pb = plate_panel('Carrier_Back', back, wb, BZ0, BZ1, HT_B)
    # starr: Brustkorb dominiert (Platte bewegt sich mit Spine2/Spine1)
    PANEL_BIND['front'] = {'Spine2': 0.45, 'Spine1': 0.35, 'Spine': 0.20}
    PANEL_BIND['back'] = {'Spine2': 0.45, 'Spine1': 0.35, 'Spine': 0.20}
    print('PANEL_BIND', PANEL_BIND)
    gear += [(tag(pf, 'cordura'), 'front'), (tag(pb, 'cordura'), 'back')]
    # Kummerbund + Gurte
    for side in (1, -1):
        cb = cummerbund(Vs, side)
        gear.append((tag(cb, 'cordura'), 'cummer'))
        st = shoulder_strap(Vs, side)
        gear.append((tag(st, 'cordura'), 'strap'))
    # MOLLE auf dem Rückenpaneel und Kummerbund-Laschen
    mo = molle_rows('Molle_Back', back, HT_B, 0.112, [1.10, 1.138, 1.176, 1.214, 1.252, 1.290])
    gear.append((tag(mo, 'webbing'), 'back'))

    # ---------------- Gewehrmagazintaschen (3) + Magazine
    for k, x in enumerate((-0.081, 0.0, 0.081)):
        p = M.rbox(f'MagPouch_{k}', 0.077, 0.036, 0.150, bevel=0.0055, segs=3, open_top=True, wall=0.0028,
                   center=(0, -0.018, 0.075), subdiv=4)
        conform(p, front, HT_F, x, FZ0 + 0.008)
        gear.append((tag(p, 'cordura'), 'front'))
        # Gummizug-Rand oben
        bd = M.rbox(f'MagPouchBand_{k}', 0.079, 0.038, 0.012, bevel=0.0035, segs=2, open_top=True, wall=0.0022,
                    center=(0, -0.018, 0.144), subdiv=3)
        conform(bd, front, HT_F, x, FZ0 + 0.008)
        gear.append((tag(bd, 'elastic'), 'front'))
        mg = rifle_mag(f'RifleMag_{k}')
        # kopfüber (Boden oben), leicht unterschiedliche Höhe
        place(mg, Matrix.Translation(Vector((0, -0.018, 0.184 + 0.003 * ((k * 7) % 3 - 1)))) @ Matrix.Rotation(math.pi, 4, 'Y'))
        conform(mg, front, HT_F, x + 0.006, FZ0 + 0.008)
        gear.append((tag(mg, 'polymer'), 'front'))

    # ---------------- Klettfeld + Aufnäher
    ZV = 1.246
    vel = M.rbox('Velcro', 0.212, 0.0026, 0.060, bevel=0.0012, segs=2, center=(0, -0.0013, 0.030), subdiv=8)
    conform(vel, front, HT_F, 0.0, ZV)
    gear.append((tag(vel, 'velcro'), 'front'))
    patch = M.rbox('Patch', 0.190, 0.0024, 0.050, bevel=0.0010, segs=2, center=(0, -0.0039, 0.030), subdiv=8)
    # Patch-UV planar (vor dem Biegen)
    me = patch.data
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = ((c.x + 0.095) / 0.19, (c.z - 0.005) / 0.05)
    conform(patch, front, HT_F, 0.0, ZV)
    gear.append((patch, 'front'))
    patch['gear_mat'] = 'patch'

    # ---------------- Bodycam (Brust, leicht rechts)
    BX, BZ = -0.036, 1.310
    Fm = panel_frame(front, HT_F, BX, BZ)
    bc = []
    bc.append(tag(M.rbox('BC_mount', 0.044, 0.007, 0.072, bevel=0.002, segs=2, center=(0, -0.0035, 0.046)), 'polymer'))
    bc.append(tag(M.rbox('BC_body', 0.057, 0.027, 0.088, bevel=0.0075, segs=4, center=(0, -0.0205, 0.046), subdiv=1), 'camera'))
    bc.append(tag(M.rbox('BC_bumper', 0.059, 0.012, 0.090, bevel=0.005, segs=3, center=(0, -0.012, 0.046)), 'rubber'))
    lens_z = 0.070
    bc.append(tag(M.cyl('BC_lensring', 0.0125, 0.0115, 0.004, segs=32, center=(0, -0.0355, lens_z), axis='Y', bevel=0.0008), 'metal_dark'))
    bc.append(tag(M.cyl('BC_lens', 0.0088, 0.0080, 0.0035, segs=32, center=(0, -0.0372, lens_z), axis='Y'), 'glass'))
    bc.append(tag(M.cyl('BC_button', 0.0095, 0.0095, 0.0025, segs=28, center=(0, -0.0345, 0.030), axis='Y', bevel=0.0009), 'rubber'))
    bc.append(tag(M.cyl('BC_led', 0.0018, 0.0018, 0.0016, segs=10, center=(0.017, -0.0345, 0.083), axis='Y'), 'led'))
    bc.append(tag(M.rbox('BC_topbtn', 0.014, 0.008, 0.004, bevel=0.0015, segs=2, center=(0.012, -0.020, 0.091)), 'rubber'))
    bc.append(tag(M.rbox('BC_sidebtn', 0.003, 0.010, 0.016, bevel=0.001, segs=2, center=(0.0295, -0.020, 0.050)), 'rubber'))
    for o in bc:
        place(o, Fm)
        gear.append((o, 'front'))
    lens_world = Fm @ Vector((0, -0.039, lens_z))
    fwd_world = (Fm.to_3x3() @ Vector((0, -1, 0))).normalized()
    INFO['bodycam_lens'] = list(lens_world); INFO['bodycam_fwd'] = list(fwd_world)

    # ---------------- Funkgerät (links, Trägerseite +X)
    RX, RZ = 0.062, 1.310
    Fr = panel_frame(front, HT_F, RX, RZ)
    rp = M.rbox('RadioPouch', 0.066, 0.042, 0.092, bevel=0.0055, segs=3, open_top=True, wall=0.0028, center=(0, -0.021, 0.046), subdiv=3)
    rpb = M.rbox('RadioPouchBand', 0.068, 0.044, 0.011, bevel=0.003, segs=2, open_top=True, wall=0.002, center=(0, -0.021, 0.087), subdiv=2)
    radio = []
    radio.append(tag(M.rbox('Radio_body', 0.056, 0.033, 0.128, bevel=0.0065, segs=4, center=(0, -0.021, 0.071)), 'radio'))
    radio.append(tag(M.rbox('Radio_top', 0.052, 0.030, 0.006, bevel=0.002, segs=2, center=(0, -0.021, 0.137)), 'rubber'))
    radio.append(tag(M.cyl('Radio_knob', 0.0085, 0.0085, 0.015, segs=24, center=(0.013, -0.019, 0.146), bevel=0.0015), 'rubber'))
    radio.append(tag(M.cyl('Radio_knob2', 0.0055, 0.0055, 0.011, segs=16, center=(0.0215, -0.030, 0.144), bevel=0.001), 'rubber'))
    radio.append(tag(M.cyl('Radio_antbase', 0.0082, 0.0075, 0.014, segs=20, center=(-0.012, -0.021, 0.147), bevel=0.0012), 'rubber'))
    ap = M.bezier(np.array([(-0.012, -0.021, 0.152), (-0.013, -0.022, 0.20), (-0.017, -0.024, 0.25), (-0.024, -0.028, 0.305)]), 18)
    radio.append(tag(M.tube('Radio_antenna', ap, np.linspace(0.0062, 0.0042, len(ap)), segs=14), 'rubber'))
    radio.append(tag(M.rbox('Radio_conn', 0.008, 0.016, 0.028, bevel=0.002, segs=2, center=(0.031, -0.021, 0.112)), 'polymer'))
    for o in [tag(rp, 'cordura'), tag(rpb, 'elastic')] + radio:
        place(o, Fr)
        gear.append((o, 'front'))
    conn_world = np.array(Fr @ Vector((0.036, -0.021, 0.106)))

    # ---------------- Schultermikrofon (linker Gurt)
    sp = np.array(INFO['strap_L'])
    j = np.argmin(np.abs(sp[:, 2] - 1.452) + 10 * (sp[:, 1] > 0))
    p0 = sp[j]; tng = sp[min(j + 2, len(sp) - 1)] - sp[max(j - 2, 0)]
    tng /= np.linalg.norm(tng)
    Fmic = M.mat_frame(Vector(p0 + np.array([0, 0, 0])), Vector((1, 0, 0)), Vector(-tng if tng[2] < 0 else tng))
    mic = []
    mic.append(tag(M.rbox('Mic_clip', 0.022, 0.012, 0.050, bevel=0.002, segs=2, center=(0, -0.0065, 0.0)), 'polymer'))
    mic.append(tag(M.rbox('Mic_body', 0.052, 0.028, 0.072, bevel=0.0085, segs=4, center=(0, -0.026, -0.008)), 'radio'))
    mic.append(tag(M.cyl('Mic_ptt', 0.0075, 0.0075, 0.006, segs=20, center=(0.0, -0.026, 0.030), bevel=0.0012), 'rubber'))
    mic.append(tag(M.rbox('Mic_grille', 0.036, 0.003, 0.040, bevel=0.0012, segs=2, center=(0, -0.0405, -0.012)), 'grille'))
    for o in mic:
        place(o, Fmic)
        gear.append((o, 'front'))
    mic_bot = np.array(Fmic @ Vector((0.0, -0.026, -0.046)))
    # Spiralkabel: Funkgerät-Seitenbuchse -> nach außen durchhängend -> Mikrofon unten
    ctrl = np.array([conn_world, conn_world + np.array([0.012, -0.008, -0.018]), conn_world + np.array([0.040, -0.016, -0.040]),
                     0.5 * (conn_world + mic_bot) + np.array([0.065, -0.02, -0.03]), mic_bot + np.array([0.030, -0.012, -0.045]),
                     mic_bot + np.array([0.004, -0.002, -0.012]), mic_bot])
    cl = M.bezier(ctrl, 24)
    coil = M.coil_path(cl[6:-6], 0.0048, 0.0052)
    straight0 = cl[:7]; straight1 = cl[-7:]
    cab = [M.tube('Cable_coil', coil, 0.0017, segs=7, caps=False),
           M.tube('Cable_a', straight0, 0.0022, segs=8), M.tube('Cable_b', straight1, 0.0022, segs=8)]
    for o in cab:
        gear.append((tag(o, 'rubber'), 'front'))

    # ---------------- Gürtel
    Vb = np.vstack([Vp, Vs[Vs[:, 2] < 1.06]])
    belt = Belt(Vb)
    bo = belt.build()
    gear.append((tag(bo, 'belt'), 'hips'))
    ang_front = belt.ang_for_dir((0, -1)); ang_right = belt.ang_for_dir((-1, 0.12)); ang_left = belt.ang_for_dir((1, 0))
    # Schnalle vorne
    Fb = belt.frame(ang_front)
    bk = [M.rbox('Buckle', 0.058, 0.010, 0.050, bevel=0.003, segs=2, center=(0, -0.004, 0)),
          M.rbox('Buckle_in', 0.040, 0.004, 0.032, bevel=0.0015, segs=2, center=(0, -0.010, 0))]
    for o in bk:
        place(o, Fb); gear.append((tag(o, 'buckle'), 'hips'))
    # Gürtelschlaufen (Keeper)
    for i, d in enumerate([(0.55, -0.85), (-0.55, -0.85), (0.6, 0.8), (-0.6, 0.8)]):
        a = belt.ang_for_dir(d)
        k = belt.segment(f'Keeper_{i}', a - 0.06, a + 0.06, 0.0045, 0.064, out=belt.t - 0.001)
        gear.append((tag(k, 'belt'), 'hips'))
        for s in (-1, 1):
            Fk = belt.frame(a, out=0.0035, dz=s * 0.021)
            sn = M.cyl(f'Snap_{i}{s}', 0.0042, 0.0038, 0.002, segs=14, center=(0, -0.001, 0), axis='Y')
            place(sn, Fk); gear.append((tag(sn, 'metal_dark'), 'hips'))
    # Holster rechts (Pistole Mündung unten, Griff nach hinten)
    Fh = belt.frame(ang_right)
    hol = []
    hol.append(tag(M.rbox('Holster_mount', 0.050, 0.008, 0.090, bevel=0.003, segs=2, center=(0.0, -0.004, -0.020)), 'polymer'))
    hol.append(tag(M.rbox('Holster_drop', 0.040, 0.010, 0.060, bevel=0.003, segs=2, center=(0.0, -0.012, -0.050)), 'polymer'))
    # Pistole im Holster-Raum: Lauf -> -Z, Oberseite -> +X (vorn), Ursprung tiefer
    Rg = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))   # Spalten: X->(0,0,-1), Y->(0,1,0), Z->(1,0,0)
    gun_o = Vector((0.010, -0.040, -0.108))
    Tg = Matrix.Translation(gun_o) @ Rg
    shell = M.rbox('Holster_shell', 0.200, 0.046, 0.080, bevel=0.012, segs=4, center=(0.006, 0, -0.018), subdiv=2)
    place(shell, Tg)
    hol.append(tag(shell, 'holster'))
    hood = M.tube('Holster_hood', M.bezier(np.array([(-0.080, -0.026, -0.03), (-0.100, -0.026, 0.012), (-0.098, 0, 0.034),
                                                      (-0.100, 0.026, 0.012), (-0.080, 0.026, -0.03)]), 10), 0.0055, segs=10)
    place(hood, Tg)
    hol.append(tag(hood, 'holster'))
    gun = pistol('Pistol')
    place(gun, Tg)
    hol.append(tag(gun, 'pistol'))
    for o in hol:
        place(o, Fh); gear.append((o, 'hips'))
    INFO['pistol_holstered'] = [list(r) for r in (Fh @ Tg)]
    # Pistolenmagazintasche (doppelt) links vorne
    Fpm = belt.frame(belt.ang_for_dir((0.62, -0.78)))
    for s in (-1, 1):
        pp = M.rbox(f'PMagPouch_{s}', 0.034, 0.028, 0.088, bevel=0.005, segs=3, open_top=True, wall=0.0025,
                    center=(s * 0.0175, -0.016, -0.018), subdiv=2)
        place(pp, Fpm); gear.append((tag(pp, 'holster'), 'hips'))
        pm = M.rbox(f'PMag_{s}', 0.030, 0.022, 0.016, bevel=0.003, segs=2, center=(s * 0.0175, -0.016, 0.030))
        place(pm, Fpm); gear.append((tag(pm, 'polymer'), 'hips'))
    # Taschenlampe links (Kopf unten) in Ringhalter
    Fl = belt.frame(belt.ang_for_dir((0.97, -0.24)))
    lt = [M.cyl('Light_body', 0.0128, 0.0128, 0.110, segs=28, center=(0, -0.022, -0.018), bevel=0.001),
          M.cyl('Light_head', 0.0175, 0.0140, 0.036, segs=32, center=(0, -0.022, -0.090), bevel=0.0015),
          M.cyl('Light_tail', 0.0135, 0.0130, 0.016, segs=28, center=(0, -0.022, 0.045), bevel=0.0015),
          M.cyl('Light_lens', 0.0150, 0.0150, 0.002, segs=32, center=(0, -0.022, -0.1085))]
    for o, k in zip(lt, ['metal_dark', 'metal_dark', 'rubber', 'glass']):
        place(o, Fl); gear.append((tag(o, k), 'hips'))
    ringh = M.rbox('Light_holder', 0.036, 0.012, 0.030, bevel=0.003, segs=2, center=(0, -0.006, -0.010))
    place(ringh, Fl); gear.append((tag(ringh, 'holster'), 'hips'))
    lr = M.tube('Light_ring', [(0.0145 * math.cos(t), -0.022 + 0.0145 * math.sin(t), 0.0) for t in np.linspace(0, 2 * np.pi, 33)], 0.0022, segs=8)
    place(lr, Fl); gear.append((tag(lr, 'holster'), 'hips'))
    # Handschellentasche links hinten
    Fc = belt.frame(belt.ang_for_dir((0.55, 0.84)))
    cc = [M.rbox('Cuff_case', 0.066, 0.036, 0.090, bevel=0.007, segs=3, center=(0, -0.018, -0.012), subdiv=2),
          M.rbox('Cuff_flap', 0.068, 0.040, 0.030, bevel=0.006, segs=3, center=(0, -0.019, 0.030)),
          M.cyl('Cuff_snap', 0.0055, 0.005, 0.003, segs=16, center=(0, -0.040, 0.026), axis='Y')]
    for o, k in zip(cc, ['holster', 'holster', 'metal_dark']):
        place(o, Fc); gear.append((tag(o, k), 'hips'))

    # ---------------- Cargotaschen (Hose)
    for side in (1, -1):
        cp = cargo_pocket(pants, side)
        gear.append((tag(cp, 'pants'), 'pants'))

    # ---------------- Gewichte
    rig = obj('OfficerRig')
    for o, mode in gear:
        if mode in ('front', 'back'):
            M.rigid_bind(o, PANEL_BIND[mode])
        elif mode == 'hips':
            M.rigid_bind(o, {'Hips': 1.0})
        elif mode == 'pants':
            G.transfer_weights(o, pants, 'POLYINTERP_NEAREST')
            G.normalize_weights(o, 4)
        elif mode == 'cummer':
            fb = PANEL_BIND['front']

            def mk(co):
                return smoothstep(0.10, 0.15, np.abs(co[:, 0])) * smoothstep(0.075, 0.12, np.abs(co[:, 0]))
            blend_bind(o, full, fb, mk)
        elif mode == 'strap':
            fb = PANEL_BIND['front']

            def mk(co):
                return smoothstep(1.40, 1.47, co[:, 2]) * 0.85
            blend_bind(o, full, fb, mk)
    # Objekte gruppieren: Träger (Cordura/Webbing) und Ausrüstung
    carrier = [o for o, m in gear if o.get('gear_mat') in ('cordura', 'webbing', 'elastic', 'velcro')]
    for o, m in gear:
        o['bind'] = m
    full.hide_viewport = True
    json.dump(INFO, open(os.path.join(CHARDIR, 'gear_info.json'), 'w'), indent=1)
    # Zonen als Material (Platzhalter), Objekte am Rig
    PAL = {'cordura': ((0.035, 0.037, 0.04, 1), 0.85), 'webbing': ((0.03, 0.032, 0.035, 1), 0.8), 'elastic': ((0.02, 0.02, 0.022, 1), 0.8),
           'velcro': ((0.03, 0.03, 0.032, 1), 0.95), 'polymer': ((0.025, 0.025, 0.025, 1), 0.55), 'camera': ((0.03, 0.03, 0.032, 1), 0.45),
           'rubber': ((0.015, 0.015, 0.015, 1), 0.7), 'metal_dark': ((0.05, 0.05, 0.05, 1), 0.35), 'glass': ((0.01, 0.01, 0.012, 1), 0.05),
           'led': ((0.4, 0.02, 0.02, 1), 0.3), 'radio': ((0.02, 0.02, 0.021, 1), 0.5), 'grille': ((0.02, 0.02, 0.02, 1), 0.6),
           'belt': ((0.012, 0.012, 0.012, 1), 0.45), 'buckle': ((0.02, 0.02, 0.02, 1), 0.4), 'holster': ((0.012, 0.012, 0.012, 1), 0.35),
           'pistol': ((0.02, 0.02, 0.021, 1), 0.45), 'pants': ((0.04, 0.05, 0.09, 1), 0.85), 'patch': ((0.02, 0.02, 0.02, 1), 0.8)}
    for o, m in gear:
        k = o.get('gear_mat', 'polymer')
        col, r = PAL.get(k, PAL['polymer'])
        M.assign_mat(o, 'Z_' + k, col, r, 0.6 if k in ('metal_dark',) else 0.0)
        mw = o.matrix_world.copy()
        o.parent = rig
        o.matrix_world = mw
        am = o.modifiers.new('Armature', 'ARMATURE'); am.object = rig
    save_stage('gear')
