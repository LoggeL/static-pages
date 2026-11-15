// Messdaten: Strecken, Flächen, Höhen und die Nachkalibrierung des Maßstabs.
// Punkte liegen in Weltkoordinaten (Meter laut ausgelieferter Kalibrierung, Y = oben).
// Der Nutzerfaktor `k` (Standard 1) korrigiert den Maßstab nachträglich.

const STORE_KEY = 'grundstueck-viewer:v1';

export const TYPE_LABEL = { dist: 'Strecke', area: 'Fläche', height: 'Höhe' };

const nf = (digits) => new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const NF1 = nf(1), NF2 = nf(2), NF3 = nf(3), NF4 = nf(4);
// Für CSV: feste drei Nachkommastellen, kein Tausenderpunkt (bleibt in Tabellenprogrammen eine Zahl)
const CSV3 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false });

export function fmtLen(m) {
  if (!Number.isFinite(m)) return '–';
  const a = Math.abs(m);
  if (a < 0.995) return `${NF1.format(m * 100)} cm`;
  if (a < 100) return `${NF2.format(m)} m`;
  return `${NF1.format(m)} m`;
}
export function fmtArea(m2) {
  if (!Number.isFinite(m2)) return '–';
  return `${(m2 < 10 ? NF2 : NF1).format(m2)} m²`;
}
export const fmtFactor = (k) => NF4.format(k);
export const fmtNum3 = (v) => NF3.format(v);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));

// Fläche eines (annähernd ebenen) 3D-Polygons nach Newell sowie die
// Grundrissfläche (Projektion auf die Horizontale, Y = oben).
export function polygonArea(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return { surface: 0.5 * Math.hypot(nx, ny, nz), plan: 0.5 * Math.abs(ny) };
}

// Kennzahlen einer Messung in Metern bzw. Quadratmetern (mit Faktor k).
export function evaluate(item, k = 1) {
  const p = item.points;
  if (item.type === 'dist') {
    let total = 0;
    const segs = [];
    for (let i = 1; i < p.length; i++) { const d = dist(p[i - 1], p[i]) * k; segs.push(d); total += d; }
    return { segs, total, primary: fmtLen(total) };
  }
  if (item.type === 'height') {
    if (p.length < 2) return { primary: '–' };
    const dh = (p[1][1] - p[0][1]) * k;
    const horiz = Math.hypot(p[1][0] - p[0][0], p[1][2] - p[0][2]) * k;
    const slope = dist(p[0], p[1]) * k;
    return { dh, horiz, slope, primary: fmtLen(Math.abs(dh)),
      secondary: `horizontal ${fmtLen(horiz)} · schräg ${fmtLen(slope)}` };
  }
  if (item.type === 'area') {
    const segs = [];
    let perimeter = 0;
    const n = p.length;
    for (let i = 0; i < n; i++) {
      if (!item.closed && i === n - 1) break;
      const d = dist(p[i], p[(i + 1) % n]) * k; segs.push(d); perimeter += d;
    }
    if (n < 3) return { segs, perimeter, primary: '–' };
    const a = polygonArea(p);
    return { segs, perimeter, surface: a.surface * k * k, plan: a.plan * k * k,
      primary: fmtArea(a.plan * k * k),
      secondary: `Grundrissfläche · geneigte Fläche ${fmtArea(a.surface * k * k)} · Umfang ${fmtLen(perimeter)}` };
  }
  return { primary: '–' };
}

export class MeasureStore extends EventTarget {
  constructor() {
    super();
    this.items = [];
    this.calibPairs = []; // { raw: Rohabstand in Welteinheiten, known: Sollmaß in m }
    this.counter = { dist: 0, area: 0, height: 0 };
    this.sceneId = null;
  }

  // Nutzerfaktor: Summe der Sollmaße / Summe der gemessenen Rohabstände.
  get k() {
    if (!this.calibPairs.length) return 1;
    const known = this.calibPairs.reduce((s, c) => s + c.known, 0);
    const raw = this.calibPairs.reduce((s, c) => s + c.raw, 0);
    return raw > 0 ? known / raw : 1;
  }

  add(type, points, extra = {}) {
    this.counter[type] = (this.counter[type] || 0) + 1;
    const item = {
      id: `${type}-${Date.now().toString(36)}-${Math.floor(performance.now() % 1e4)}`,
      type, name: `${TYPE_LABEL[type]} ${this.counter[type]}`,
      points: points.map((q) => [q[0], q[1], q[2]]), closed: type === 'area', ...extra,
    };
    this.items.push(item);
    this.changed();
    return item;
  }
  remove(id) { this.items = this.items.filter((i) => i.id !== id); this.changed(); }
  clear() { this.items = []; this.counter = { dist: 0, area: 0, height: 0 }; this.changed(); }
  addCalibration(raw, known) { this.calibPairs.push({ raw, known }); this.changed(); }
  resetCalibration() { this.calibPairs = []; this.changed(); }

  changed() { this.save(); this.dispatchEvent(new Event('change')); }

  // Gespeichert wird je Szene und je Ablageort der Seite, damit sich mehrere
  // Veröffentlichungen auf derselben Domain nicht gegenseitig überschreiben.
  get storageKey() { return `${STORE_KEY}:${this.sceneId}`; }

  save() {
    if (!this.sceneId) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        items: this.items, calibPairs: this.calibPairs, counter: this.counter,
      }));
    } catch { /* privater Modus o. Ä.: Messungen bleiben nur in dieser Sitzung */ }
  }

  restoreFor(sceneId) {
    this.sceneId = sceneId;
    try {
      const s = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
      if (s) {
        const okPoint = (q) => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite);
        this.items = (Array.isArray(s.items) ? s.items : []).filter((it) => it && TYPE_LABEL[it.type]
          && Array.isArray(it.points) && it.points.length >= 2 && it.points.every(okPoint));
        this.calibPairs = (Array.isArray(s.calibPairs) ? s.calibPairs : [])
          .filter((c) => c && c.raw > 0 && c.known > 0 && Number.isFinite(c.raw + c.known));
        this.counter = { dist: 0, area: 0, height: 0, ...(s.counter || {}) };
      }
    } catch { /* unlesbare Altdaten ignorieren */ }
    this.dispatchEvent(new Event('change'));
  }

  toCSV() {
    const k = this.k;
    const rows = [['Name', 'Typ', 'Wert', 'Einheit', 'Zusatz', 'Punkte (x y z in m)']];
    for (const it of this.items) {
      const e = evaluate(it, k);
      let value = '', unit = '', extra = '';
      if (it.type === 'dist') { value = e.total; unit = 'm'; }
      if (it.type === 'height') { value = Math.abs(e.dh); unit = 'm'; extra = `horizontal ${CSV3.format(e.horiz)} m; schräg ${CSV3.format(e.slope)} m`; }
      if (it.type === 'area') { value = e.plan; unit = 'm²'; extra = `geneigt ${CSV3.format(e.surface)} m²; Umfang ${CSV3.format(e.perimeter)} m`; }
      const pts = it.points.map((q) => q.map((v) => CSV3.format(v * k)).join(' ')).join(' | ');
      rows.push([it.name, TYPE_LABEL[it.type], CSV3.format(value), unit, extra, pts]);
    }
    return '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  }
}
