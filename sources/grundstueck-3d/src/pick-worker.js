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
// Beschleunigung: gleichmäßige Gitter in mehreren Ebenen (Zellgröße h, 2h, 4h … lokale
// Einheiten über die robusten Grenzen, dazu ein grobes Gitter über alle Zentren). Jeder Splat
// liegt in genau einer Zelle der ersten Ebene mit 3·σmax ≤ Zellgröße; ein beitragender Splat
// hat höchstens √8·σmax < 3·σmax Abstand zum Strahl, also liegt er in der 27er-Nachbarschaft
// einer vom Strahl besuchten Zelle seiner Ebene (3D-DDA je Ebene). Was in keine Ebene passt,
// steht in der Liste `big` und wird je Strahl linear geprüft. Ergebnis identisch zur linearen Suche
// (Nachricht 'pick-linear', für den Test).
//
// Alle Größen liegen im lokalen Koordinatensystem des Splat-Objekts.

let N = 0;
let C, S, Q, A, RMAX; // Zentren, Skalen (sigma), Quaternionen (xyzw), Deckkraft, max. sigma
let G = null;          // Gitter

const K = 3;        // Vorfilter: Splats bis 3 sigma Abstand vom Strahl
const K2 = 8;       // wie im Renderer: Beitrag bis sqrt(8) sigma
const MAX_CELLS = 4 * 1024 * 1024;

let cand = new Int32Array(1 << 16);
let nCand = 0;
function push(i) {
  if (nCand === cand.length) { const c = new Int32Array(cand.length * 2); c.set(cand); cand = c; }
  cand[nCand++] = i;
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ({ C, S, Q, A } = m);
      N = A.length;
      const t0 = performance.now();
      G = buildGrid(m.h ?? 0.1);
      self.postMessage({ type: 'ready', n: N, big: G.big.length, cells: G.cells, h: G.h, dims: [G.nx, G.ny, G.nz], ms: Math.round(performance.now() - t0) });
    } else if (m.type === 'pick') {
      const hits = m.dirs.map((d) => rayHit(m.o, d, m.tau, m.near, m.amin, false));
      self.postMessage({ type: 'hit', id: m.id, hits });
    } else if (m.type === 'pick-batch') {
      const hits = m.rays.map((r) => r.dirs.map((d) => rayHit(r.o, d, m.tau, m.near, m.amin, false)));
      self.postMessage({ type: 'hit', id: m.id, hits });
    } else if (m.type === 'pick-linear') {
      const hits = m.dirs.map((d) => rayHit(m.o, d, m.tau, m.near, m.amin, true));
      self.postMessage({ type: 'hit', id: m.id, hits });
    } else {
      throw new Error(`unbekannte Nachricht ${m.type}`);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: `${err.message}` });
  }
};

function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]; }

function buildGrid(h) {
  RMAX = new Float32Array(N);
  for (let i = 0; i < N; i++) { const i3 = 3 * i; RMAX[i] = Math.max(S[i3], S[i3 + 1], S[i3 + 2]); }
  // robuste Grenzen (0,5- bis 99,5-Perzentil der Zentren, aus einer Stichprobe) und volle Grenzen
  const step = Math.max(1, Math.floor(N / 200000));
  const m = Math.ceil(N / step);
  const lo = [0, 0, 0], hi = [0, 0, 0], fmin = [Infinity, Infinity, Infinity], fmax = [-Infinity, -Infinity, -Infinity];
  for (let a = 0; a < 3; a++) {
    const s = new Float32Array(m);
    let k = 0;
    for (let i = 0; i < N; i += step) {
      const v = C[3 * i + a];
      // picker.js lehnt Modelle mit NaN/∞ schon beim Einlesen ab; hier nur zur Sicherheit, ohne Ersatzwert
      if (!Number.isFinite(v)) throw new Error(`Splat ${i}: Mittelpunkt nicht endlich (${v})`);
      s[k++] = v;
    }
    s.sort();
    lo[a] = pct(s, 0.005); hi[a] = pct(s, 0.995);
    for (let i = 0; i < N; i++) { const v = C[3 * i + a]; if (v < fmin[a]) fmin[a] = v; if (v > fmax[a]) fmax[a] = v; }
  }
  // Ebenen: feines Gitter h, dann 2h, 4h … über die robusten Grenzen (für größere Splats),
  // zuletzt ein grobes Gitter über die vollen Grenzen (Ausreißer). Jeder Splat kommt in die
  // erste Ebene, deren Grenzen ihn enthalten und deren Zelle ≥ 3·σmax ist; nur was nirgends
  // passt, steht in `big`.
  const dims = (h, a, b) => [0, 1, 2].map((k) => Math.ceil((b[k] - a[k]) / h) + 3);
  for (;;) {
    const d = dims(h, lo, hi);
    if (d[0] * d[1] * d[2] <= MAX_CELLS) break;
    h *= Math.cbrt((d[0] * d[1] * d[2]) / MAX_CELLS) * 1.01;
  }
  const specs = [];
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  for (let hk = h; specs.length < 10; hk *= 2) {
    specs.push({ h: hk, lo, hi });
    if (hk * 4 >= span) break;
  }
  const fspan = Math.max(fmax[0] - fmin[0], fmax[1] - fmin[1], fmax[2] - fmin[2]);
  if (Number.isFinite(fspan) && fspan > span) specs.push({ h: fspan / 96, lo: fmin, hi: fmax });
  const levels = specs.map(({ h, lo, hi }) => {
    const [nx, ny, nz] = dims(h, lo, hi);
    return { h, lo, hi, gx: lo[0] - h, gy: lo[1] - h, gz: lo[2] - h, nx, ny, nz, cells: nx * ny * nz, n: 0 };
  });
  const lvl = new Int8Array(N);
  const cellOf = new Int32Array(N);
  const big = [];
  for (let i = 0; i < N; i++) {
    const i3 = 3 * i;
    const x = C[i3], y = C[i3 + 1], z = C[i3 + 2], r = K * RMAX[i];
    let li = -1;
    for (let k = 0; k < levels.length; k++) {
      const L = levels[k];
      if (r <= L.h && x >= L.lo[0] && x <= L.hi[0] && y >= L.lo[1] && y <= L.hi[1] && z >= L.lo[2] && z <= L.hi[2]) { li = k; break; }
    }
    lvl[i] = li;
    if (li < 0) { big.push(i); continue; }
    const L = levels[li];
    cellOf[i] = (Math.floor((z - L.gz) / L.h) * L.ny + Math.floor((y - L.gy) / L.h)) * L.nx + Math.floor((x - L.gx) / L.h);
    L.n++;
  }
  for (const L of levels) {
    L.cellStart = new Uint32Array(L.cells + 1);
    L.idx = new Uint32Array(L.n);
    L.stamp = new Uint32Array(L.cells);
  }
  for (let i = 0; i < N; i++) if (lvl[i] >= 0) levels[lvl[i]].cellStart[cellOf[i] + 1]++;
  for (const L of levels) { const cs = L.cellStart; for (let c = 0; c < L.cells; c++) cs[c + 1] += cs[c]; L.fill = cs.slice(0, L.cells); }
  for (let i = 0; i < N; i++) { const li = lvl[i]; if (li >= 0) { const L = levels[li]; L.idx[L.fill[cellOf[i]]++] = i; } }
  for (const L of levels) delete L.fill;
  const used = levels.filter((L) => L.n > 0);
  console.info(`Mess-Gitter: ${used.map((L) => `${L.nx}×${L.ny}×${L.nz} (h = ${L.h.toFixed(3)}, ${L.n})`).join(', ')}; ${big.length} von ${N} Splats in der Liste „big“ (linear geprüft)`);
  const L0 = levels[0];
  return { levels: used, big: Int32Array.from(big), gen: 0, h: L0.h, nx: L0.nx, ny: L0.ny, nz: L0.nz, cells: used.reduce((s, L) => s + L.cells, 0) };
}

// Kandidaten entlang eines Strahls über 3D-DDA je Gitterebene sammeln
function gatherGrid(ox, oy, oz, dx, dy, dz, near) {
  nCand = 0;
  const g = G;
  // `big` mit demselben Abstandstest wie die lineare Suche vorfiltern (billig, spart die
  // Quaternion-Rechnung in composite für fast alle dieser Splats)
  const big = g.big;
  for (let k = 0; k < big.length; k++) {
    const i = big[k], i3 = 3 * i;
    const vx = C[i3] - ox, vy = C[i3 + 1] - oy, vz = C[i3 + 2] - oz;
    const tc = vx * dx + vy * dy + vz * dz;
    const r = K * RMAX[i];
    if (tc < -r) continue;
    if (vx * vx + vy * vy + vz * vz - tc * tc > r * r) continue;
    push(i);
  }
  if (++g.gen === 0xffffffff) { for (const L of g.levels) L.stamp.fill(0); g.gen = 1; }
  for (const L of g.levels) walkLevel(L, g.gen, ox, oy, oz, dx, dy, dz, near);
}

function walkLevel(L, gen, ox, oy, oz, dx, dy, dz, near) {
  const { h, nx, ny, nz, cellStart, idx, stamp } = L;
  const x0 = L.gx, y0 = L.gy, z0 = L.gz, x1 = x0 + nx * h, y1 = y0 + ny * h, z1 = z0 + nz * h;
  // Strahl gegen die Gitter-Box (Slabs)
  let tmin = near, tmax = Infinity;
  const slab = (o, d, a, b) => {
    if (Math.abs(d) < 1e-12) return o >= a && o <= b;
    let t1 = (a - o) / d, t2 = (b - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  if (!slab(ox, dx, x0, x1) || !slab(oy, dy, y0, y1) || !slab(oz, dz, z0, z1)) return;
  const px = ox + dx * tmin, py = oy + dy * tmin, pz = oz + dz * tmin;
  let ix = Math.min(nx - 1, Math.max(0, Math.floor((px - x0) / h)));
  let iy = Math.min(ny - 1, Math.max(0, Math.floor((py - y0) / h)));
  let iz = Math.min(nz - 1, Math.max(0, Math.floor((pz - z0) / h)));
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(dx) < 1e-12 ? Infinity : h / Math.abs(dx);
  const tdy = Math.abs(dy) < 1e-12 ? Infinity : h / Math.abs(dy);
  const tdz = Math.abs(dz) < 1e-12 ? Infinity : h / Math.abs(dz);
  let tmx = Math.abs(dx) < 1e-12 ? Infinity : ((x0 + (ix + (dx > 0 ? 1 : 0)) * h) - ox) / dx;
  let tmy = Math.abs(dy) < 1e-12 ? Infinity : ((y0 + (iy + (dy > 0 ? 1 : 0)) * h) - oy) / dy;
  let tmz = Math.abs(dz) < 1e-12 ? Infinity : ((z0 + (iz + (dz > 0 ? 1 : 0)) * h) - oz) / dz;
  for (;;) {
    for (let cz = iz - 1; cz <= iz + 1; cz++) {
      if (cz < 0 || cz >= nz) continue;
      for (let cy = iy - 1; cy <= iy + 1; cy++) {
        if (cy < 0 || cy >= ny) continue;
        const row = (cz * ny + cy) * nx;
        for (let cx = ix - 1; cx <= ix + 1; cx++) {
          if (cx < 0 || cx >= nx) continue;
          const c = row + cx;
          if (stamp[c] === gen) continue;
          stamp[c] = gen;
          for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
            // derselbe Abstandstest wie in der linearen Suche
            const i = idx[k], i3 = 3 * i;
            const vx = C[i3] - ox, vy = C[i3 + 1] - oy, vz = C[i3 + 2] - oz;
            const tc = vx * dx + vy * dy + vz * dz;
            const r = K * RMAX[i];
            if (tc < -r || vx * vx + vy * vy + vz * vz - tc * tc > r * r) continue;
            push(i);
          }
        }
      }
    }
    // nächste Zelle
    if (tmx < tmy && tmx < tmz) { if (tmx > tmax) break; ix += sx; tmx += tdx; if (ix < 0 || ix >= nx) break; }
    else if (tmy < tmz) { if (tmy > tmax) break; iy += sy; tmy += tdy; if (iy < 0 || iy >= ny) break; }
    else { if (tmz > tmax) break; iz += sz; tmz += tdz; if (iz < 0 || iz >= nz) break; }
  }
}

// Lineare Suche (Vergleich): alle Splats bis 3·σmax Abstand vom Strahl
function gatherLinear(ox, oy, oz, dx, dy, dz) {
  nCand = 0;
  for (let i = 0; i < N; i++) {
    const i3 = 3 * i;
    const vx = C[i3] - ox, vy = C[i3 + 1] - oy, vz = C[i3 + 2] - oz;
    const tc = vx * dx + vy * dy + vz * dz;
    const r = K * RMAX[i];
    if (tc < -r) continue;
    if (vx * vx + vy * vy + vz * vz - tc * tc > r * r) continue;
    push(i);
  }
}

function rayHit(o, d, tau, near, amin, linear) {
  if (!(tau > 0) || !(near > 0) || !(amin >= 0)) throw new Error(`Pick-Parameter ungültig: tau=${tau} near=${near} amin=${amin}`);
  const len = Math.hypot(d[0], d[1], d[2]);
  // NaN/∞ im Strahl liefe sonst in der Gitter-Durchquerung endlos (Schritte werden NaN)
  if (!Number.isFinite(o[0] + o[1] + o[2]) || !Number.isFinite(len) || !(len > 0)) {
    throw new Error(`Strahl ungültig: Ursprung ${o.join(' ')}, Richtung ${d.join(' ')}`);
  }
  const dx = d[0] / len, dy = d[1] / len, dz = d[2] / len;
  if (linear) gatherLinear(o[0], o[1], o[2], dx, dy, dz); else gatherGrid(o[0], o[1], o[2], dx, dy, dz, near);
  return composite(o[0], o[1], o[2], dx, dy, dz, tau, near, amin);
}

function composite(ox, oy, oz, dx, dy, dz, tau, near, amin) {
  const ts = [], al = [];
  for (let c = 0; c < nCand; c++) {
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
  // nach Tiefe, bei Gleichstand nach Deckkraft: Reihenfolge unabhängig von der Kandidatenreihenfolge
  const idx = ts.map((_, j) => j).sort((p, q) => ts[p] - ts[q] || al[p] - al[q]);
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
  // Kann bei geprüften Splats und Strahlen nicht vorkommen: laut melden statt „keine Oberfläche“
  if (!Number.isFinite(t50)) throw new Error(`Treffertiefe nicht endlich (t=${t50}, ${ts.length} Kandidaten)`);
  const spread = Number.isNaN(t25) || Number.isNaN(t75) ? null : t75 - t25;
  return { t: t50, spread, opacity: total, conf };
}
