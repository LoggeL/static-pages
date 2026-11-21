// Bodenraster für die 2D-Karte (aus tools/build_map.py): Höhe je 0,5-m-Zelle mit Qualitätsstufe
//   q = 2  gemessen (aus der Aufnahme, 15.-Perzentil freier Zellen)
//   q = 1  geschätzt (inverse Distanz der Planhöhen)
//   q = 0  keine Höhe

export class GroundError extends Error {
  constructor(file, field, message) {
    super(`${file}: ${field} – ${message}`);
    this.name = 'GroundError';
    this.file = file;
    this.field = field;
  }
}

export async function loadGround(cfg, base) {
  const g = cfg.map.ground;
  const file = g.file;
  const url = `${base}scene/${file}?v=${g.version}`;
  const r = await fetch(url);
  if (!r.ok) throw new GroundError(file, 'Datei', `HTTP ${r.status}`);
  let d;
  try {
    d = await r.json();
  } catch (err) {
    throw new GroundError(file, 'Datei', `kein gültiges JSON (${err.message})`);
  }
  const bad = (field, msg) => { throw new GroundError(file, field, msg); };
  if (d.format !== 'grundstueck-ground-v1') bad('format', `"${d.format}" statt "grundstueck-ground-v1"`);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  if (!near(d.x0, g.bounds[0])) bad('x0', `${d.x0} passt nicht zu scene.json map.ground.bounds[0] = ${g.bounds[0]}`);
  if (!near(d.z0, g.bounds[2])) bad('z0', `${d.z0} passt nicht zu scene.json map.ground.bounds[2] = ${g.bounds[2]}`);
  if (!near(d.cell, g.cell)) bad('cell', `${d.cell} passt nicht zu scene.json map.ground.cell = ${g.cell}`);
  if (d.cols !== g.cols) bad('cols', `${d.cols} passt nicht zu scene.json map.ground.cols = ${g.cols}`);
  if (d.rows !== g.rows) bad('rows', `${d.rows} passt nicht zu scene.json map.ground.rows = ${g.rows}`);
  if (!(d.unit > 0)) bad('unit', `${d.unit} ist keine positive Zahl`);
  const n = d.cols * d.rows;
  if (!Array.isArray(d.h) || d.h.length !== n) bad('h', `Länge ${d.h?.length} statt ${n}`);
  if (!Array.isArray(d.q)) bad('q', 'fehlt');
  const Q = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < d.q.length; i++) {
    const [q, len] = d.q[i];
    if (!(q === 0 || q === 1 || q === 2) || !Number.isInteger(len) || len <= 0 || k + len > n) bad(`q[${i}]`, `ungültiger Lauf ${JSON.stringify(d.q[i])}`);
    Q.fill(q, k, k + len);
    k += len;
  }
  if (k !== n) bad('q', `Lauflängen ergeben ${k} statt ${n} Zellen`);
  const H = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = d.h[i];
    if (Q[i] === 0) {
      if (v !== null) bad(`h[${i}]`, 'Zelle ohne Höhe (q0) hat einen Wert');
      H[i] = NaN;
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v)) bad(`h[${i}]`, `Zelle mit q${Q[i]} hat keine Höhe`);
      H[i] = v * d.unit;
    }
  }
  return new Ground(d.x0, d.z0, d.cell, d.cols, d.rows, H, Q);
}

export class Ground {
  constructor(x0, z0, cell, cols, rows, H, Q) {
    Object.assign(this, { x0, z0, cell, cols, rows, H, Q });
  }

  // Wie tools/build_map.py (Gegenprobe): bilinear, wenn alle vier Nachbarzellen eine Höhe haben
  // (q = kleinstes q der vier); sonst die nächste Zelle, sofern sie eine Höhe hat; sonst keine Höhe.
  sample(x, z) {
    const fx = (x - this.x0) / this.cell - 0.5, fz = (z - this.z0) / this.cell - 0.5;
    const j = Math.floor(fx), i = Math.floor(fz);
    const { cols, rows, H, Q } = this;
    if (i >= 0 && i < rows - 1 && j >= 0 && j < cols - 1) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      const q = Math.min(Q[a], Q[b], Q[c], Q[d]);
      if (q > 0) {
        const tx = fx - j, tz = fz - i;
        return { y: (H[a] * (1 - tx) + H[b] * tx) * (1 - tz) + (H[c] * (1 - tx) + H[d] * tx) * tz, q };
      }
    }
    const ni = Math.floor(fz + 0.5), nj = Math.floor(fx + 0.5);
    if (ni < 0 || ni >= rows || nj < 0 || nj >= cols) return { error: 'outside' };
    const idx = ni * cols + nj;
    if (Q[idx] === 0) return { error: 'nodata' };
    return { y: H[idx], q: Q[idx] };
  }
}
