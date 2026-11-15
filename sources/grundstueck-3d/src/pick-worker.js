// Punkt-Picking auf Gaussian Splats: Median-Tiefe entlang des Klickstrahls.
//
// Ein Splat hat keine harte Oberfläche. Statt den ersten getroffenen Splat zu
// nehmen (anfällig für halbtransparente "Floater"), werden alle Gaußglocken
// entlang des Strahls von vorn nach hinten aufsummiert – genau wie beim Rendern –
// und die Tiefe genommen, bei der die aufgelaufene Deckkraft den Schwellwert
// erreicht (Standard 0,35; einstellbar über scene.json). Das entspricht der sichtbaren
// Oberfläche. Reicht die Deckkraft insgesamt nicht bis zum Schwellwert, zählt die Stelle
// als "schwach" und es gilt die Tiefe bei der halben Gesamtdeckkraft.
//
// Alle Größen liegen im lokalen Koordinatensystem des Splat-Objekts.

let N = 0;
let C, S, Q, A, RMAX; // Zentren, Skalen (sigma), Quaternionen (xyzw), Deckkraft, max. sigma

const K = 3;        // Vorfilter: Splats bis 3 sigma Abstand vom Strahl
const K2 = 8;       // wie im Renderer: Beitrag bis sqrt(8) sigma

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    ({ C, S, Q, A, RMAX } = m);
    N = A.length;
    self.postMessage({ type: 'ready', n: N });
  } else if (m.type === 'pick') {
    const hits = pickRays(m.o, m.dirs, m.tau ?? 0.35, m.tanTheta ?? 0, m.near ?? 0.02, m.amin ?? 0.15);
    self.postMessage({ type: 'hit', id: m.id, hits });
  }
};

// Mehrere fast parallele Strahlen mit gemeinsamem Ursprung. Die Kandidaten
// werden einmal mit dem ersten (mittleren) Strahl und einem Kegel-Zuschlag
// vorgefiltert, danach wird jeder Strahl exakt ausgewertet.
function pickRays(o, dirs, tau, tanTheta, near, amin) {
  const ox = o[0], oy = o[1], oz = o[2];
  const dx = dirs[0][0], dy = dirs[0][1], dz = dirs[0][2];
  const cand = [];
  for (let i = 0; i < N; i++) {
    const i3 = 3 * i;
    const vx = C[i3] - ox, vy = C[i3 + 1] - oy, vz = C[i3 + 2] - oz;
    const tc = vx * dx + vy * dy + vz * dz;
    const r = K * RMAX[i];
    if (tc < -r) continue;
    const rr = r + (tc > 0 ? tc * tanTheta : 0);
    if (vx * vx + vy * vy + vz * vz - tc * tc > rr * rr) continue;
    cand.push(i);
  }
  return dirs.map((d) => composite(cand, ox, oy, oz, d[0], d[1], d[2], tau, near, amin));
}

function composite(cand, ox, oy, oz, dx, dy, dz, tau, near, amin) {
  const ts = [], al = [];
  for (let c = 0; c < cand.length; c++) {
    const i = cand[c];
    const i3 = 3 * i, i4 = 4 * i;
    const vx = C[i3] - ox, vy = C[i3 + 1] - oy, vz = C[i3 + 2] - oz;
    // konjugiertes Quaternion: Welt -> Hauptachsen des Splats
    const qx = -Q[i4], qy = -Q[i4 + 1], qz = -Q[i4 + 2], qw = Q[i4 + 3];
    let ux = qy * vz - qz * vy, uy = qz * vx - qx * vz, uz = qx * vy - qy * vx;
    let wx = qy * uz - qz * uy, wy = qz * ux - qx * uz, wz = qx * uy - qy * ux;
    const px = -(vx + 2 * (qw * ux + wx));
    const py = -(vy + 2 * (qw * uy + wy));
    const pz = -(vz + 2 * (qw * uz + wz));
    ux = qy * dz - qz * dy; uy = qz * dx - qx * dz; uz = qx * dy - qy * dx;
    wx = qy * uz - qz * uy; wy = qz * ux - qx * uz; wz = qx * uy - qy * ux;
    const ex = dx + 2 * (qw * ux + wx);
    const ey = dy + 2 * (qw * uy + wy);
    const ez = dz + 2 * (qw * uz + wz);
    const isx = 1 / Math.max(S[i3], 1e-6);
    const isy = 1 / Math.max(S[i3 + 1], 1e-6);
    const isz = 1 / Math.max(S[i3 + 2], 1e-6);
    const gx = px * isx, gy = py * isy, gz = pz * isz;
    const hx = ex * isx, hy = ey * isy, hz = ez * isz;
    const a = hx * hx + hy * hy + hz * hz;
    const b = gx * hx + gy * hy + gz * hz;
    const t = -b / a; // Stelle der größten Dichte entlang des Strahls
    if (!(t > near)) continue;
    const cx = gy * hz - gz * hy, cy = gz * hx - gx * hz, cz = gx * hy - gy * hx;
    const m2 = (cx * cx + cy * cy + cz * cz) / a; // quadr. Mahalanobis-Abstand dort
    if (m2 > K2) continue;
    const alpha = Math.min(0.99, A[i] * Math.exp(-0.5 * m2));
    if (!(alpha >= 1 / 255)) continue; // verwirft auch NaN
    ts.push(t); al.push(alpha);
  }
  if (!ts.length) return null;
  const idx = ts.map((_, j) => j).sort((p, q) => ts[p] - ts[q]);
  let T = 1, t25 = NaN, t50 = NaN, t75 = NaN;
  const acc = [];
  for (const j of idx) {
    T *= 1 - al[j];
    const o = 1 - T;
    acc.push(o);
    if (Number.isNaN(t25) && o >= tau * 0.5) t25 = ts[j];
    if (Number.isNaN(t50) && o >= tau) t50 = ts[j];
    if (Number.isNaN(t75) && o >= Math.min(0.95, tau * 1.5)) t75 = ts[j];
    if (T < 1e-3) break;
  }
  const total = 1 - T;
  let conf = 'ok';
  if (Number.isNaN(t50)) {
    if (total < amin) return null; // Loch, Himmel, maskierter Bereich
    const k = acc.findIndex((o) => o >= total / 2);
    t50 = ts[idx[k]];
    conf = 'weak';
  }
  if (!Number.isFinite(t50)) return null;
  const spread = Number.isNaN(t25) || Number.isNaN(t75) ? null : t75 - t25;
  return { t: t50, spread, opacity: total, conf };
}
