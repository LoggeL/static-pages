// Prozeduraler Peel P50 (1962–65): SDF-Karosserie -> Surface Nets -> Three.js-Szene -> GLB
// Koordinaten: x = Fahrtrichtung (Heck -0.685 … Front +0.685), y = oben (Boden 0), z = rechts (+) / links (−). Einheit: Meter.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import fs from 'node:fs';

const OUT = process.argv[2] || 'p50.glb';
const H = Number(process.argv[3] || 0.0065); // Gitterweite der Karosserie

// ---------- SDF-Helfer ----------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
const smax = (a, b, k) => -smin(-a, -b, k);
const sdRect2 = (x, z, hx, hz, r) => {
  const qx = Math.abs(x) - hx + r, qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
};
// 2D-Grundriss extrudieren, Kanten oben/unten mit eigenem Radius runden
const extrudeRound = (d2, y, y0, y1, rTop, rBot) => {
  const cy = (y0 + y1) / 2, hy = (y1 - y0) / 2, rv = y > cy ? rTop : rBot;
  const qx = d2 + rv, qy = Math.abs(y - cy) - hy + rv;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rv;
};

// ---------- Maße ----------
const XR = -0.685, XF = 0.685;         // Länge 1,37 m
const ROOF = 1.22;                      // Höhe 1,22 m
const HALF_W = 0.50;                    // Karosseriebreite ~1,0 m (+ Spiegel ≈ 1,04 m)
// Frontscheibe: Ebene durch (WS_X, WS_Y), Neigung nach hinten
const WS_X = 0.33, WS_Y = 0.70;
const WS_T = new THREE.Vector2(-0.13, 0.50).normalize();   // entlang der Scheibe nach oben
const WS_N = new THREE.Vector2(WS_T.y, -WS_T.x);           // Normale nach vorn/oben
const WS_BOW = 0.06;                                         // Wölbung der Scheibe im Grundriss
const FRONT_AXLE = 0.50, REAR_AXLE = -0.58, TRACK = 0.43, WHEEL_R = 0.15;

const cabinTaper = (x, y) => 1 + 0.07 * smoothstep(0.78, 1.22, y) + 0.035 * smoothstep(-0.2, -0.68, x);
const wsPlane = (x, y, z) => ((x + WS_BOW * z * z - WS_X) * WS_N.x + (y - WS_Y) * WS_N.y);
const wsS = (x, y, z) => ((x + WS_BOW * z * z - WS_X) * WS_T.x + (y - WS_Y) * WS_T.y);

function cabin(x, y, z) {
  const zz = z * cabinTaper(x, y);
  const x0 = XR, x1 = 0.46;
  const d2 = sdRect2(x - (x0 + x1) / 2, zz, (x1 - x0) / 2, HALF_W, 0.19);
  const d = extrudeRound(d2, y, 0.19, ROOF, 0.10, 0.13);
  return smax(d, wsPlane(x, y, z), 0.05);
}
function nose(x, y, z) {
  const yy = y + 0.17 * Math.max(0, x - 0.33);                       // Haube fällt nach vorn ab
  const xx = x + 0.12 * z * z + 0.10 * Math.max(0, y - 0.32);         // Bug gewölbt + oben zurückgesetzt
  const d2 = sdRect2(xx - XF / 2, z, XF / 2, HALF_W - 0.01, 0.17);
  return extrudeRound(d2, yy, 0.21, 0.70, 0.11, 0.12);
}
function body(x, y, z) {
  let d = smin(cabin(x, y, z), nose(x, y, z), 0.04);
  const az = Math.abs(z);
  const dfw = Math.max(Math.hypot(x - FRONT_AXLE, y - WHEEL_R) - 0.195, 0.27 - az); // Radhäuser vorn
  d = smax(d, -dfw, 0.02);
  const drw = Math.max(Math.hypot(x - REAR_AXLE, y - WHEEL_R) - 0.19, az - 0.095); // Radhaus hinten
  d = smax(d, -drw, 0.02);
  return d;
}
const grad = (x, y, z, e = 6e-4) => {
  const g = [body(x + e, y, z) - body(x - e, y, z), body(x, y + e, z) - body(x, y - e, z), body(x, y, z + e) - body(x, y, z - e)];
  const l = Math.hypot(...g) || 1; return [g[0] / l, g[1] / l, g[2] / l];
};

// ---------- Surface Nets ----------
function surfaceNets() {
  const x0 = -0.76, y0 = 0.10, z0 = -0.57, x1 = 0.76, y1 = 1.29, z1 = 0.57;
  const nx = Math.ceil((x1 - x0) / H) + 1, ny = Math.ceil((y1 - y0) / H) + 1, nz = Math.ceil((z1 - z0) / H) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    F[id(i, j, k)] = body(x0 + i * H, y0 + j * H, z0 + k * H);
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cid = (i, j, k) => i + cx * (j + cy * k);
  const vmap = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [], nor = [];
  const corners = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const v = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { const o = corners[c]; v[c] = F[id(i + o[0], j + o[1], k + o[2])]; if (v[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]), A = corners[a], B = corners[b];
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; n++;
    }
    let p = [x0 + (i + sx / n) * H, y0 + (j + sy / n) * H, z0 + (k + sz / n) * H];
    for (let it = 0; it < 3; it++) { // Newton-Projektion auf die Isofläche
      const d = body(...p), g = grad(...p);
      const s = clamp(d, -H, H);
      p = [p[0] - g[0] * s, p[1] - g[1] * s, p[2] - g[2] * s];
    }
    vmap[cid(i, j, k)] = pos.length / 3;
    pos.push(...p); nor.push(...grad(...p));
  }
  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Ausrichtung über Gradienten prüfen
    const P = (q) => [pos[3 * q], pos[3 * q + 1], pos[3 * q + 2]];
    const pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nn = [nor[3 * a] + nor[3 * c], nor[3 * a + 1] + nor[3 * c + 1], nor[3 * a + 2] + nor[3 * c + 2]];
    if (fn[0] * nn[0] + fn[1] * nn[1] + fn[2] * nn[2] < 0) [b, d] = [d, b];
    const dist = (p, q) => Math.hypot(pos[3 * p] - pos[3 * q], pos[3 * p + 1] - pos[3 * q + 1], pos[3 * p + 2] - pos[3 * q + 2]);
    if (dist(a, c) <= dist(b, d)) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    const f0 = F[id(i, j, k)] < 0;
    if (i < cx && (F[id(i + 1, j, k)] < 0) !== f0)
      quad(vmap[cid(i, j - 1, k - 1)], vmap[cid(i, j, k - 1)], vmap[cid(i, j, k)], vmap[cid(i, j - 1, k)]);
    if (j < cy && (F[id(i, j + 1, k)] < 0) !== f0)
      quad(vmap[cid(i - 1, j, k - 1)], vmap[cid(i, j, k - 1)], vmap[cid(i, j, k)], vmap[cid(i - 1, j, k)]);
    if (k < cz && (F[id(i, j, k + 1)] < 0) !== f0)
      quad(vmap[cid(i - 1, j - 1, k)], vmap[cid(i, j - 1, k)], vmap[cid(i, j, k)], vmap[cid(i - 1, j, k)]);
  }
  return { pos, nor, idx };
}

// ---------- Fenster- und Türfelder (2D-SDFs auf der Karosserie) ----------
function sdPoly(px, py, V) { // iq: exakte SDF eines Polygons
  let d = (px - V[0][0]) ** 2 + (py - V[0][1]) ** 2, s = 1;
  for (let i = 0, j = V.length - 1; i < V.length; j = i, i++) {
    const ex = V[j][0] - V[i][0], ey = V[j][1] - V[i][1], wx = px - V[i][0], wy = py - V[i][1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t; d = Math.min(d, bx * bx + by * by);
    const c1 = py >= V[i][1], c2 = py < V[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
const wsLineX = (y) => WS_X - (y - WS_Y) * (-WS_T.x / WS_T.y) - WS_BOW * 0.25; // Scheibenkante seitlich
const SIDE_R = 0.05;
const sideWin = [[-0.30 + SIDE_R, 0.75 + SIDE_R], [wsLineX(0.75) - 0.075 - SIDE_R * 1.4, 0.75 + SIDE_R],
                 [wsLineX(1.11) - 0.075 - SIDE_R * 0.6, 1.11 - SIDE_R], [-0.30 + SIDE_R, 1.11 - SIDE_R]];
const doorPoly = [[-0.36, 0.27], [wsLineX(0.70) - 0.035, 0.27], [wsLineX(0.70) - 0.035, 0.70],
                  [wsLineX(1.165) - 0.035, 1.165], [-0.36, 1.165]];
const SEAL = 0.016, GAP = 0.0032;

function windowField(x, y, z) {
  const az = Math.abs(z);
  let d = 1;
  // Frontscheibe
  if (x > 0.05 && Math.abs(wsPlane(x, y, z)) < 0.02) {
    const s = wsS(x, y, z);
    d = Math.min(d, sdRect2(s - 0.255, z * cabinTaper(x, y), 0.205, 0.405, 0.065));
  }
  // Seitenfenster (links = Türfenster, rechts = Festfenster)
  if (az > 0.38 && y > 0.6) d = Math.min(d, sdPoly(x, y, sideWin) - SIDE_R);
  // Heckscheibe
  if (x < -0.60) d = Math.min(d, sdRect2(z, y - 1.0, 0.23, 0.085, 0.055));
  return d;
}
function doorField(x, y, z) {
  if (z > -0.38) return 1;
  return sdPoly(x, y, doorPoly);
}

// Dreiecke an Isolinien eines Feldes zerschneiden (Marching Triangles)
function splitAt(tris, key, fn, t) {
  const out = [];
  const val = (v) => (v.f[key] ??= fn(v.p[0], v.p[1], v.p[2]));
  const lerpV = (a, b, u) => {
    const p = [0, 1, 2].map((i) => a.p[i] + (b.p[i] - a.p[i]) * u);
    let n = [0, 1, 2].map((i) => a.n[i] + (b.n[i] - a.n[i]) * u); const l = Math.hypot(...n); n = n.map((c) => c / l);
    return { p, n, f: {} };
  };
  for (const tri of tris) {
    const f = tri.map(val);
    const below = f.map((x) => x < t);
    const nb = below.filter(Boolean).length;
    if (nb === 0 || nb === 3) { out.push(tri); continue; }
    const lone = below.findIndex((b) => (nb === 1 ? b : !b));
    const a = tri[lone], b = tri[(lone + 1) % 3], c = tri[(lone + 2) % 3];
    const fa = f[lone], fb = f[(lone + 1) % 3], fc = f[(lone + 2) % 3];
    const ab = lerpV(a, b, (t - fa) / (fb - fa)), ac = lerpV(a, c, (t - fa) / (fc - fa));
    out.push([a, ab, ac], [ab, b, c], [ab, c, ac]);
  }
  return out;
}

function buildBody() {
  console.time('surface nets');
  const { pos, nor, idx } = surfaceNets();
  console.timeEnd('surface nets');
  console.log('Karosserie:', pos.length / 3, 'Vertices,', idx.length / 3, 'Dreiecke');
  const verts = [];
  for (let i = 0; i < pos.length / 3; i++) verts.push({ p: [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], n: [nor[3 * i], nor[3 * i + 1], nor[3 * i + 2]], f: {} });
  let tris = [];
  for (let i = 0; i < idx.length; i += 3) tris.push([verts[idx[i]], verts[idx[i + 1]], verts[idx[i + 2]]]);
  console.time('split');
  tris = splitAt(tris, 'w', windowField, 0);
  tris = splitAt(tris, 'w', windowField, SEAL);
  tris = splitAt(tris, 'd', doorField, -GAP);
  tris = splitAt(tris, 'd', doorField, GAP);
  console.timeEnd('split');
  const groups = { paint: [], glass: [], seal: [], gap: [] };
  for (const tri of tris) {
    const c = [0, 1, 2].map((i) => (tri[0].p[i] + tri[1].p[i] + tri[2].p[i]) / 3);
    const w = windowField(...c);
    const g = w < 0 ? 'glass' : w < SEAL ? 'seal' : Math.abs(doorField(...c)) < GAP ? 'gap' : 'paint';
    groups[g].push(tri);
  }
  const geos = {};
  for (const [g, list] of Object.entries(groups)) {
    const P = new Float32Array(list.length * 9), N = new Float32Array(list.length * 9);
    list.forEach((tri, i) => tri.forEach((v, j) => { P.set(v.p, i * 9 + j * 3); N.set(v.n, i * 9 + j * 3); }));
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo = mergeVertices(geo, 1e-6);
    geos[g] = geo;
  }
  return geos;
}

// ---------- Oberflächen-Abfragen für Anbauteile ----------
function hit(origin, dir) {
  const o = new THREE.Vector3(...origin), d = new THREE.Vector3(...dir).normalize();
  let t = 0;
  for (let i = 0; i < 400; i++) {
    const p = o.clone().addScaledVector(d, t); const s = body(p.x, p.y, p.z);
    if (s < 1e-5) return { p, n: new THREE.Vector3(...grad(p.x, p.y, p.z)) };
    t += Math.max(s * 0.9, 2e-4);
    if (t > 3) break;
  }
  throw new Error('kein Treffer ' + origin + ' ' + dir);
}
const front = (y, z) => hit([1.2, y, z], [-1, 0, 0]);
const rear = (y, z) => hit([-1.2, y, z], [1, 0, 0]);
const side = (x, y, s) => hit([x, y, s * 1.2], [0, 0, -s]); // s=+1 rechts, -1 links
const top = (x, z) => hit([x, 2, z], [0, -1, 0]);
// Objekt auf Oberfläche setzen: lokales +Z = Flächennormale
function mount(obj, h, out = 0) {
  obj.position.copy(h.p).addScaledVector(h.n, out);
  obj.lookAt(obj.position.clone().add(h.n));
  return obj;
}

// ---------- Materialien ----------
const M = {
  paint: new THREE.MeshPhysicalMaterial({ name: 'Lack', color: 0xa8121a, roughness: 0.3, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ name: 'Glas', color: 0x1d2a33, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
  seal: new THREE.MeshStandardMaterial({ name: 'Gummidichtung', color: 0x0d0d0d, roughness: 0.75, side: THREE.DoubleSide }),
  gap: new THREE.MeshStandardMaterial({ name: 'Spaltmaß', color: 0x140606, roughness: 0.9, side: THREE.DoubleSide }),
  chrome: new THREE.MeshStandardMaterial({ name: 'Chrom', color: 0xe6e8ea, roughness: 0.08, metalness: 1.0 }),
  tire: new THREE.MeshStandardMaterial({ name: 'Reifen', color: 0x161616, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ name: 'Felge', color: 0xd7d4cc, roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide }),
  lens: new THREE.MeshPhysicalMaterial({ name: 'Scheinwerferglas', color: 0xf4f1e6, roughness: 0.05, transparent: true, opacity: 0.55, emissive: 0xfff6dc, emissiveIntensity: 0.15 }),
  reflector: new THREE.MeshStandardMaterial({ name: 'Reflektor', color: 0xffffff, roughness: 0.04, metalness: 1.0 }),
  red: new THREE.MeshPhysicalMaterial({ name: 'Rücklicht', color: 0xb3000c, roughness: 0.12, emissive: 0x6a0005, emissiveIntensity: 0.6 }),
  amber: new THREE.MeshPhysicalMaterial({ name: 'Blinker', color: 0xff8a12, roughness: 0.12, emissive: 0xa04000, emissiveIntensity: 0.45 }),
  black: new THREE.MeshStandardMaterial({ name: 'Schwarz', color: 0x111111, roughness: 0.6 }),
  plate: new THREE.MeshStandardMaterial({ name: 'Kennzeichen', color: 0x0c0c0c, roughness: 0.5 }),
  plateText: new THREE.MeshStandardMaterial({ name: 'Kennzeichenschrift', color: 0xf0f0ea, roughness: 0.4, metalness: 0.2 }),
  trim: new THREE.MeshStandardMaterial({ name: 'Stoßleiste', color: 0xe9dcbd, roughness: 0.45 }),
  seat: new THREE.MeshStandardMaterial({ name: 'Sitzbezug', color: 0x8d9093, roughness: 0.55 }),
  dash: new THREE.MeshStandardMaterial({ name: 'Armaturenbrett', color: 0x2c5a8a, roughness: 0.4 }),
  wheelGrey: new THREE.MeshStandardMaterial({ name: 'Lenkrad', color: 0x7b7f86, roughness: 0.3 }),
  floor: new THREE.MeshStandardMaterial({ name: 'Bodenmatte', color: 0x222222, roughness: 0.95 }),
  knob: new THREE.MeshStandardMaterial({ name: 'Schaltknauf', color: 0xc8100f, roughness: 0.25 }),
};

// ---------- Anbauteile ----------
const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg).rotateX(Math.PI / 2); // Achse = +Z
const mesh = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); if (name) m.name = name; return m; };

function makeWheel(name) {
  const g = new THREE.Group(); g.name = name;
  const tg = lathe([[0.064, -0.034], [0.09, -0.041], [0.12, -0.044], [0.138, -0.042], [0.147, -0.034], [0.151, -0.02], [0.152, 0],
    [0.151, 0.02], [0.147, 0.034], [0.138, 0.042], [0.12, 0.044], [0.09, 0.041], [0.064, 0.034]], 168);
  // Grobstollen-Profil
  const p = tg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, y);
    if (r < 0.142) continue;
    const phi = Math.atan2(y, x) / (2 * Math.PI) + 0.5;
    const k = Math.floor(phi * 28 + (z > 0 ? 0.5 : 0) + (Math.abs(z) < 0.006 ? 0.25 : 0));
    if (k % 2 === 0) { const s = (r - 0.0065) / r; p.setXY(i, x * s, y * s); }
  }
  tg.computeVertexNormals();
  g.add(mesh(tg, M.tire, name + '_Reifen'));
  g.add(mesh(lathe([[0.071, -0.037], [0.066, -0.034], [0.066, 0.031], [0.071, 0.037], [0.068, 0.040], [0.058, 0.036],
    [0.046, 0.033], [0.036, 0.038], [0.024, 0.040], [0.0, 0.040]], 64), M.rim, name + '_Felge'));
  const cap = mesh(new THREE.SphereGeometry(0.026, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.55), M.chrome, name + '_Nabenkappe');
  cap.position.z = 0.039; g.add(cap);
  for (let i = 0; i < 4; i++) {
    const n = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 6).rotateX(Math.PI / 2), M.chrome);
    const a = i * Math.PI / 2 + Math.PI / 4; n.position.set(Math.cos(a) * 0.033, Math.sin(a) * 0.033, 0.041); g.add(n);
  }
  return g;
}

function headlight() {
  const g = new THREE.Group(); g.name = 'Scheinwerfer';
  g.add(mesh(lathe([[0.045, -0.02], [0.062, 0.0], [0.072, 0.03], [0.075, 0.048], [0.078, 0.054], [0.075, 0.06], [0.069, 0.058]], 64), M.chrome));
  g.add(mesh(lathe([[0.012, 0.012], [0.04, 0.024], [0.066, 0.052]], 64), M.reflector));
  g.add(mesh(lathe([[0.069, 0.057], [0.055, 0.064], [0.035, 0.069], [0.0, 0.071]], 64), M.lens));
  return g;
}
function smallLamp(r, mat, name, depth = 0.012) {
  const g = new THREE.Group(); g.name = name;
  g.add(mesh(lathe([[r * 0.8, 0.001], [r + 0.004, 0.0], [r + 0.005, depth * 0.5], [r + 0.002, depth], [r - 0.001, depth]], 40), M.chrome));
  g.add(mesh(lathe([[r, depth * 0.9], [r * 0.7, depth * 1.35], [0, depth * 1.55]], 40), mat));
  return g;
}

// 7-Segment-Schrift fürs Kennzeichen
const SEG = { P: 'abefg', E: 'adefg', L: 'def', 5: 'acdfg', 0: 'abcdef', ' ': '' };
function plate(text, w = 0.33, h = 0.095) {
  const g = new THREE.Group(); g.name = 'Kennzeichen';
  g.add(mesh(new RoundedBoxGeometry(w, h, 0.006, 2, 0.006), M.plate));
  const cw = 0.034, ch = 0.058, th = 0.0075, pitch = 0.043;
  const segs = [];
  [...text].forEach((c, i) => {
    const ox = (i - (text.length - 1) / 2) * pitch;
    const add = (x, y, sw, sh) => segs.push(new THREE.BoxGeometry(sw, sh, 0.002).translate(ox + x, y, 0.0035));
    for (const s of SEG[c]) {
      if (s === 'a') add(0, ch / 2, cw, th); if (s === 'g') add(0, 0, cw, th); if (s === 'd') add(0, -ch / 2, cw, th);
      if (s === 'b') add(cw / 2, ch / 4, th, ch / 2 + th); if (s === 'c') add(cw / 2, -ch / 4, th, ch / 2 + th);
      if (s === 'f') add(-cw / 2, ch / 4, th, ch / 2 + th); if (s === 'e') add(-cw / 2, -ch / 4, th, ch / 2 + th);
    }
  });
  g.add(mesh(mergeGeometries(segs), M.plateText));
  return g;
}

// Leiste, die horizontal um eine Karosserieecke läuft
function cornerStrip(name, y, cx, cz, a0, a1, r = 0.015) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const a = a0 + (a1 - a0) * i / 24, d = [Math.cos(a), 0, Math.sin(a)];
    const h = hit([cx + d[0] * 1.2, y, cz + d[2] * 1.2], [-d[0], 0, -d[2]]);
    pts.push(h.p.clone().addScaledVector(h.n, r * 0.55));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 64, r, 12, false).scale(1, 1, 1);
  const g = new THREE.Group(); g.name = name;
  g.add(mesh(geo, M.trim));
  for (const p of [pts[0], pts[pts.length - 1]]) { const s = mesh(new THREE.SphereGeometry(r, 12, 8), M.trim); s.position.copy(p); g.add(s); }
  return g;
}

function buildCar() {
  const car = new THREE.Group(); car.name = 'Peel_P50';
  const geos = buildBody();
  const bodyG = new THREE.Group(); bodyG.name = 'Karosserie';
  bodyG.add(mesh(geos.paint, M.paint, 'Karosserie_Lack'));
  bodyG.add(mesh(geos.glass, M.glass, 'Verglasung'));
  bodyG.add(mesh(geos.seal, M.seal, 'Fensterdichtungen'));
  bodyG.add(mesh(geos.gap, M.gap, 'Tuerfuge'));
  car.add(bodyG);

  // Räder
  const wFL = makeWheel('Rad_vorn_links'); wFL.rotation.y = Math.PI; wFL.position.set(FRONT_AXLE, WHEEL_R, -TRACK);
  const wFR = makeWheel('Rad_vorn_rechts'); wFR.position.set(FRONT_AXLE, WHEEL_R, TRACK);
  const wR = makeWheel('Rad_hinten'); wR.position.set(REAR_AXLE, WHEEL_R, 0.0);
  car.add(wFL, wFR, wR);
  // Achsschenkel / Federbeine (dunkel)
  for (const s of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 10).rotateX(Math.PI / 2), M.black, 'Querlenker');
    arm.position.set(FRONT_AXLE, WHEEL_R, s * 0.31); car.add(arm);
    const strut = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), M.black, 'Federbein');
    strut.position.set(FRONT_AXLE - 0.02, WHEEL_R + 0.09, s * 0.33); strut.rotation.x = s * 0.15; car.add(strut);
  }
  const fork = mesh(new THREE.BoxGeometry(0.2, 0.02, 0.012), M.black, 'Schwinge');
  for (const s of [-1, 1]) { const f = fork.clone(); f.position.set(REAR_AXLE + 0.1, WHEEL_R + 0.01, s * 0.058); car.add(f); }

  // Front: Scheinwerfer, Standlichter, Blinker/Hupe, Kennzeichen, Emblem
  car.add(mount(headlight(), front(0.585, 0), -0.012));
  for (const s of [-1, 1]) car.add(mount(smallLamp(0.019, M.lens, 'Standlicht'), front(0.47, s * 0.37), -0.002));
  car.add(mount(smallLamp(0.02, M.black, 'Hupe'), front(0.445, 0), -0.002));
  car.add(mount(plate('PEEL 50'), front(0.31, 0), 0.004));
  const badge = mount(smallLamp(0.012, M.red, 'Emblem', 0.004), hit([1.2, 0.98, 0], [-1, -0.6, 0]), 0);
  car.add(badge);

  // Stoßleisten: vordere Ecken (tief) und hintere Ecken (mittelhoch)
  for (const s of [-1, 1]) {
    car.add(cornerStrip('Stossleiste_vorn', 0.335, 0.52, s * 0.33, s > 0 ? 0.05 : -0.05, s > 0 ? 1.45 : -1.45));
    car.add(cornerStrip('Stossleiste_hinten', 0.52, -0.5, s * 0.31, s > 0 ? 1.75 : -1.75, s > 0 ? 3.05 : -3.05));
  }

  // Heck: Rückleuchten, Kennzeichen, Rangiergriff
  for (const s of [-1, 1]) car.add(mount(smallLamp(0.028, M.red, 'Rueckleuchte', 0.014), rear(0.58, s * 0.33), -0.002));
  car.add(mount(plate('PEEL 50', 0.3, 0.085), rear(0.40, 0), 0.004));
  {
    const pts = [];
    const a = rear(0.80, -0.2), b = rear(0.80, 0.2);
    pts.push(a.p.clone().addScaledVector(a.n, -0.01), a.p.clone().addScaledVector(a.n, 0.045),
      new THREE.Vector3(a.p.x - 0.06, 0.80, -0.12), new THREE.Vector3(a.p.x - 0.06, 0.80, 0.12),
      b.p.clone().addScaledVector(b.n, 0.045), b.p.clone().addScaledVector(b.n, -0.01));
    const handle = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), 80, 0.011, 12), M.chrome, 'Rangiergriff');
    car.add(handle);
  }

  // Seitliche Blinker oben an den hinteren Dachecken
  for (const s of [-1, 1]) {
    const l = smallLamp(0.022, M.amber, 'Blinker', 0.02); car.add(mount(l, side(-0.585, 1.075, s), 0));
  }

  // Tür (links): Griff + Schloss
  {
    const h = side(-0.31, 0.72, -1);
    const grip = new THREE.Group(); grip.name = 'Tuergriff';
    const base = mesh(new RoundedBoxGeometry(0.03, 0.022, 0.012, 2, 0.004), M.chrome); grip.add(base);
    const lever = mesh(new RoundedBoxGeometry(0.075, 0.012, 0.01, 2, 0.004), M.chrome); lever.position.set(0.03, 0, 0.01); grip.add(lever);
    car.add(mount(grip, h, 0.002));
    car.add(mount(smallLamp(0.008, M.chrome, 'Tuerschloss', 0.004), side(-0.31, 0.665, -1), 0));
  }
  // Rechts: Spiegel und Lüftungsschlitze
  {
    const h = side(0.19, 0.735, 1);
    const g = new THREE.Group(); g.name = 'Aussenspiegel';
    const stalk = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.075, 8).rotateX(Math.PI / 2).translate(0, 0, 0.0375), M.chrome); g.add(stalk);
    const cup = mesh(lathe([[0.0, -0.012], [0.03, -0.01], [0.045, 0.0], [0.046, 0.004], [0.042, 0.006]], 40), M.chrome);
    const glassM = mesh(new THREE.CircleGeometry(0.042, 40), M.reflector); glassM.position.z = 0.005;
    const head = new THREE.Group(); head.add(cup, glassM); head.position.set(0, 0.02, 0.085); head.rotation.y = Math.PI / 2 + 0.25; head.rotation.x = 0;
    g.add(head);
    car.add(mount(g, h, 0));
    for (let i = 0; i < 4; i++) {
      const hh = side(0.20, 0.30 + i * 0.03, 1);
      const slat = mesh(new RoundedBoxGeometry(0.12, 0.012, 0.012, 2, 0.004), M.chrome, 'Luftschlitz');
      mount(slat, hh, 0.002); slat.rotateX(0.5); car.add(slat);
    }
    const recess = mesh(new RoundedBoxGeometry(0.135, 0.11, 0.004, 2, 0.002), M.black, 'Luftschlitz_Grund');
    car.add(mount(recess, side(0.20, 0.345, 1), -0.0005));
  }
  // Einzelner Scheibenwischer (mittig rechts, senkrecht geparkt)
  {
    const z = 0.07, s0 = 0.025, s1 = 0.44;
    const P = (s, off) => { const x = WS_X + WS_T.x * s + WS_N.x * off - WS_BOW * z * z, y = WS_Y + WS_T.y * s + WS_N.y * off; return new THREE.Vector3(x, y, z); };
    const g = new THREE.Group(); g.name = 'Scheibenwischer';
    const piv = mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.02, 12), M.chrome); piv.position.copy(P(s0, 0.005));
    piv.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(WS_N.x, WS_N.y, 0)); g.add(piv);
    const a = P(s0, 0.018), b = P(s1, 0.016);
    const arm = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, a.distanceTo(b), 6), M.chrome);
    arm.position.copy(a).lerp(b, 0.5); arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(arm);
    const blade = mesh(new THREE.BoxGeometry(0.006, 0.30, 0.012), M.black);
    blade.position.copy(P(0.27, 0.010)); blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(WS_T.x, WS_T.y, 0));
    g.add(blade); car.add(g);
  }

  // ---------- Innenraum ----------
  const inner = new THREE.Group(); inner.name = 'Innenraum';
  const floor = mesh(new RoundedBoxGeometry(1.05, 0.01, 0.80, 2, 0.004), M.floor, 'Bodenmatte'); floor.position.set(-0.08, 0.215, 0); inner.add(floor);
  const cushion = mesh(new RoundedBoxGeometry(0.36, 0.11, 0.70, 4, 0.04), M.seat, 'Sitzflaeche'); cushion.position.set(-0.36, 0.40, 0); inner.add(cushion);
  const box = mesh(new RoundedBoxGeometry(0.34, 0.14, 0.72, 2, 0.02), M.paint, 'Sitzkasten'); box.position.set(-0.37, 0.28, 0); inner.add(box);
  const back = mesh(new RoundedBoxGeometry(0.10, 0.46, 0.70, 4, 0.04), M.seat, 'Rueckenlehne'); back.position.set(-0.56, 0.68, 0); back.rotation.z = -0.12; inner.add(back);
  const dash = mesh(new RoundedBoxGeometry(0.07, 0.07, 0.86, 3, 0.02), M.dash, 'Armaturenbrett'); dash.position.set(0.26, 0.70, 0); inner.add(dash);
  // Lenkrad
  const swC = new THREE.Vector3(0.06, 0.84, -0.06), swN = new THREE.Vector3(-0.62, 0.78, 0).normalize();
  const sw = new THREE.Group(); sw.name = 'Lenkrad';
  sw.add(mesh(new THREE.TorusGeometry(0.165, 0.011, 12, 72), M.wheelGrey));
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * 2 * Math.PI / 3;
    const sp = mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.16, 8).translate(0, 0.08, 0), M.wheelGrey); sp.rotation.z = a - Math.PI / 2 + Math.PI; sp.position.z = -0.01; sw.add(sp);
  }
  const hub = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 20).rotateX(Math.PI / 2), M.trim); hub.position.z = -0.01; sw.add(hub);
  sw.position.copy(swC); sw.lookAt(swC.clone().add(swN)); inner.add(sw);
  const colEnd = swC.clone().addScaledVector(swN, -0.55);
  const col = mesh(new THREE.CylinderGeometry(0.014, 0.014, swC.distanceTo(colEnd), 10), M.wheelGrey, 'Lenksaeule');
  col.position.copy(swC).lerp(colEnd, 0.5); col.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), swN); inner.add(col);
  const stalk = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6).rotateX(Math.PI / 2).translate(0, 0, -0.035), M.chrome, 'Lichtschalter');
  stalk.position.copy(swC).addScaledVector(swN, -0.06); stalk.position.z -= 0.0; inner.add(stalk);
  const knob = mesh(new THREE.SphereGeometry(0.014, 16, 12), M.knob, 'Knauf'); knob.position.copy(stalk.position); knob.position.z -= 0.07; inner.add(knob);
  // Schalthebel rechts neben dem Sitz
  const gear = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.30, 8), M.black, 'Schalthebel'); gear.position.set(-0.12, 0.35, 0.36); gear.rotation.z = 0.35; inner.add(gear);
  const gk = mesh(new THREE.SphereGeometry(0.018, 16, 12), M.black); gk.position.set(-0.17, 0.495, 0.36); inner.add(gk);
  car.add(inner);
  return car;
}

// ---------- Export ----------
globalThis.FileReader = class {
  readAsArrayBuffer(b) { b.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); this.onload?.({ target: this }); }); }
  readAsDataURL(b) { b.arrayBuffer().then((buf) => { this.result = `data:${b.type || 'application/octet-stream'};base64,` + Buffer.from(buf).toString('base64'); this.onloadend?.(); this.onload?.({ target: this }); }); }
};
const scene = new THREE.Scene();
const car = buildCar();
scene.add(car);
const bb = new THREE.Box3().setFromObject(car);
console.log('Abmessungen (m): L', (bb.max.x - bb.min.x).toFixed(3), 'B', (bb.max.z - bb.min.z).toFixed(3), 'H', (bb.max.y - bb.min.y).toFixed(3));
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
fs.writeFileSync(OUT, Buffer.from(glb));
console.log('geschrieben:', OUT, (glb.byteLength / 1e6).toFixed(2), 'MB');
