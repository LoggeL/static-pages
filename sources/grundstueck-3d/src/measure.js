// Messdaten: Strecken, Flächen, Höhen und die Nachkalibrierung des Maßstabs.
// Punkte liegen in Weltkoordinaten (Meter laut ausgelieferter Kalibrierung, Y = oben).
// Der Nutzerfaktor `k` (Standard 1) korrigiert den Maßstab nachträglich.
// Je Punkt wird die Herkunft gespeichert (`src`):
//   'g' Boden gemessen (2D-Bodenraster q2), 'e' Boden geschätzt (q1),
//   's' 3D-Oberfläche (Splat-Picking), 'h' Hausentwurf (Modellgeometrie), 'p' Planpunkt (eingerastet; Höhe nur geschätzt)

const STORE_V2 = 'grundstueck-viewer:v2';
const STORE_V1 = 'grundstueck-viewer:v1';

export const TYPE_LABEL = { dist: 'Strecke', area: 'Fläche', height: 'Höhe' };
export const SRC_LABEL = { g: 'Boden gemessen', e: 'Boden geschätzt', s: '3D-Oberfläche', h: 'Hausentwurf', p: 'Planpunkt' };

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

// Höhe stammt (teilweise) aus einer Schätzung: geschätzter Boden oder Planpunkt
export const heightEstimated = (src) => Array.isArray(src) && src.some((s) => s === 'e' || s === 'p');

// Kennzahlen einer Messung in Metern bzw. Quadratmetern (mit Faktor k).
export function evaluate(item, k = 1) {
  const p = item.points;
  if (item.type === 'dist' || item.type === 'calib') {
    let total = 0, horiz = 0;
    const segs = [];
    for (let i = 1; i < p.length; i++) {
      const d = dist(p[i - 1], p[i]) * k; segs.push(d); total += d;
      horiz += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]) * k;
    }
    if (item.type === 'calib' || p.length < 2) return { segs, total, horiz, primary: fmtLen(total) };
    // Planmaße (Kataster) sind waagerecht gemessen: die horizontale Länge steht immer dabei
    const dh = (p[p.length - 1][1] - p[0][1]) * k;
    const est = heightEstimated(item.src);
    return { segs, total, horiz, dh, estimated: est, primary: fmtLen(total),
      secondary: `horizontal ${fmtLen(horiz)} · Höhenunterschied ${fmtLen(Math.abs(dh))}${est ? ' (Höhe geschätzt)' : ''}` };
  }
  if (item.type === 'height') {
    if (p.length < 2) return { primary: '–' };
    const dh = (p[1][1] - p[0][1]) * k;
    const horiz = Math.hypot(p[1][0] - p[0][0], p[1][2] - p[0][2]) * k;
    const slope = dist(p[0], p[1]) * k;
    const est = heightEstimated(item.src?.slice(0, 2));
    return { dh, horiz, slope, estimated: est, primary: `${fmtLen(Math.abs(dh))}${est ? ' (geschätzt)' : ''}`,
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
  throw new Error(`Unbekannter Messtyp "${item.type}"`);
}

const okPoint = (q) => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite);
const okSrc = (src, n) => Array.isArray(src) && src.length === n && src.every((s) => SRC_LABEL[s]);

// Prüft einen gespeicherten Eintrag; liefert den Grund der Ablehnung oder null.
function itemProblem(it) {
  if (!it || typeof it !== 'object') return 'kein Objekt';
  if (!TYPE_LABEL[it.type]) return `unbekannter Typ ${JSON.stringify(it.type)}`;
  if (typeof it.id !== 'string' || !it.id) return 'id fehlt';
  if (typeof it.name !== 'string') return 'name fehlt';
  if (!Array.isArray(it.points) || it.points.length < 2) return 'weniger als 2 Punkte';
  if (it.type === 'area' && it.points.length < 3) return 'Fläche mit weniger als 3 Punkten';
  if (!it.points.every(okPoint)) return 'Punkt ohne gültige Koordinaten';
  return null;
}

export class MeasureStore extends EventTarget {
  constructor() {
    super();
    this.items = [];
    this.calibPairs = []; // { raw: Rohabstand in Welteinheiten, known: Sollmaß in m }
    this.counter = { dist: 0, area: 0, height: 0 };
    this.key = null;
    this.onStorageError = null; // (err, aktion) – die App zeigt einen Dauerhinweis
  }

  // Nutzerfaktor: Summe der Sollmaße / Summe der gemessenen Rohabstände.
  get k() {
    if (!this.calibPairs.length) return 1;
    const known = this.calibPairs.reduce((s, c) => s + c.known, 0);
    const raw = this.calibPairs.reduce((s, c) => s + c.raw, 0);
    return raw > 0 ? known / raw : 1;
  }

  add(type, points, src) {
    if (!okSrc(src, points.length)) throw new Error(`Messung ${type}: Punktherkunft fehlt oder passt nicht zu ${points.length} Punkten`);
    this.counter[type] = (this.counter[type] || 0) + 1;
    const item = {
      id: `${type}-${Date.now().toString(36)}-${Math.floor(performance.now() % 1e4)}`,
      type, name: `${TYPE_LABEL[type]} ${this.counter[type]}`,
      points: points.map((q) => [q[0], q[1], q[2]]), src: src.slice(), closed: type === 'area',
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

  save() {
    if (!this.key) throw new Error('MeasureStore.save() vor restore()');
    try {
      localStorage.setItem(this.key, JSON.stringify({ items: this.items, calibPairs: this.calibPairs, counter: this.counter }));
    } catch (err) {
      this.onStorageError?.(err, 'schreiben');
    }
  }

  // Schlüssel hängt nur am Ablageort der Seite und am Meter-Weltsystem (scene.json `frame`),
  // nicht an Datei, Qualitätsstufe oder Ansicht.
  // Ergebnis: { migrated, legacyKey, broken: [{kind, index, reason}], backupKey, storageError }
  // kind: 'daten' (ganzer Eintrag unlesbar), 'messung' oder 'kalibrierung'
  restore({ pathname, frame, legacyIds }) {
    this.key = `${STORE_V2}:${pathname}|${frame}`;
    const report = { migrated: false, legacyKey: null, broken: [], backupKey: null, storageError: null };
    let raw = null;
    try {
      raw = localStorage.getItem(this.key);
      if (raw === null) {
        // einmalige, ausdrückliche Übernahme aus der bisherigen Version (Schlüssel je Datei und Transformation)
        for (const id of legacyIds) {
          const k = `${STORE_V1}:${pathname}|${id}`;
          const old = localStorage.getItem(k);
          if (old !== null && old !== 'null') { raw = old; report.legacyKey = k; break; }
        }
      }
    } catch (err) {
      report.storageError = err;
      this.onStorageError?.(err, 'lesen');
      this.dispatchEvent(new Event('change'));
      return report;
    }
    if (raw !== null) {
      const legacy = !!report.legacyKey;
      let s = null, parseErr = null;
      try { s = JSON.parse(raw); } catch (err) { parseErr = err; }
      if (parseErr || !s || typeof s !== 'object' || !Array.isArray(s.items)) {
        report.broken.push({ kind: 'daten', index: -1, reason: parseErr ? `kein JSON (${parseErr.message})` : 'Aufbau unbekannt (items fehlt)' });
      } else {
        s.items.forEach((it, index) => {
          const problem = itemProblem(it);
          if (problem) { report.broken.push({ kind: 'messung', index, reason: problem }); return; }
          // Alte Messungen konnten nur aus 3D kommen: fehlende Herkunft wird „3D-Oberfläche“ (dokumentierte Regel).
          const src = legacy && it.src === undefined ? it.points.map(() => 's') : it.src;
          if (!okSrc(src, it.points.length)) { report.broken.push({ kind: 'messung', index, reason: 'Punktherkunft src fehlt oder ungültig' }); return; }
          this.items.push({ id: it.id, type: it.type, name: it.name, points: it.points.map((q) => q.slice()), src: src.slice(), closed: it.type === 'area' });
        });
        // save() schreibt calibPairs immer (auch v1): fehlt die Liste, ist der Eintrag beschädigt
        if (!Array.isArray(s.calibPairs)) {
          report.broken.push({ kind: 'kalibrierung', index: -1, reason: `calibPairs fehlt oder ist keine Liste (${s.calibPairs === undefined ? 'fehlt' : typeof s.calibPairs})` });
        } else {
          s.calibPairs.forEach((c, index) => {
            if (c && c.raw > 0 && c.known > 0 && Number.isFinite(c.raw + c.known)) this.calibPairs.push({ raw: c.raw, known: c.known });
            else report.broken.push({ kind: 'kalibrierung', index, reason: 'ungültige Kalibrierung' });
          });
        }
        const cnt = s.counter && typeof s.counter === 'object' ? s.counter : {};
        for (const t of Object.keys(TYPE_LABEL)) {
          // Zähler nur für die Namensvergabe; fehlt er, zählt die Zahl der geladenen Messungen dieses Typs
          const v = cnt[t];
          this.counter[t] = Number.isInteger(v) && v >= 0 ? v : this.items.filter((i) => i.type === t).length;
        }
      }
      if (report.broken.length) {
        report.backupKey = `${this.key}:defekt-${new Date().toISOString()}`;
        for (const b of report.broken) console.error(`Gespeicherte ${b.kind === 'kalibrierung' ? 'Kalibrierung' : 'Messung'} (Index ${b.index}) nicht geladen: ${b.reason}`);
        let saved = false;
        try {
          localStorage.setItem(report.backupKey, raw);
          saved = true;
        } catch (err) {
          this.onStorageError?.(err, 'sichern');
          report.backupKey = null;
        }
        // Nach erfolgreicher Sicherung den bereinigten Stand sofort unter v2 schreiben – auch bei einer
        // Übernahme aus v1, von der nichts Lesbares übrig bleibt: Ohne v2-Eintrag würde v1 bei jedem
        // Neuladen wieder gelesen, erneut gesichert und gemeldet. Ohne Sicherung bleibt der
        // Originaleintrag unangetastet (nichts geht verloren, die Meldung kommt wieder).
        if (saved) this.save();
      }
      if (legacy && (this.items.length || this.calibPairs.length)) {
        report.migrated = true;
        if (!report.backupKey) this.save(); // mit Sicherung oben schon geschrieben; der alte Schlüssel bleibt stehen
      }
    }
    this.dispatchEvent(new Event('change'));
    return report;
  }

  toCSV() {
    const k = this.k;
    const rows = [['Name', 'Typ', 'Wert', 'Einheit', 'Zusatz', 'Punkte (x y z in m)', 'Punktherkunft']];
    for (const it of this.items) {
      const e = evaluate(it, k);
      let value = '', unit = '', extra = '';
      if (it.type === 'dist') { value = e.total; unit = 'm'; extra = `horizontal ${CSV3.format(e.horiz)} m; Höhenunterschied ${CSV3.format(Math.abs(e.dh))} m${e.estimated ? '; Höhe geschätzt' : ''}`; }
      if (it.type === 'height') { value = Math.abs(e.dh); unit = 'm'; extra = `horizontal ${CSV3.format(e.horiz)} m; schräg ${CSV3.format(e.slope)} m${e.estimated ? '; Höhe geschätzt' : ''}`; }
      if (it.type === 'area') { value = e.plan; unit = 'm²'; extra = `geneigt ${CSV3.format(e.surface)} m²; Umfang ${CSV3.format(e.perimeter)} m`; }
      const pts = it.points.map((q) => q.map((v) => CSV3.format(v * k)).join(' ')).join(' | ');
      rows.push([it.name, TYPE_LABEL[it.type], CSV3.format(value), unit, extra, pts, it.src.map((s) => SRC_LABEL[s]).join(' | ')]);
    }
    return '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  }
}
