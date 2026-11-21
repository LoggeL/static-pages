import { inside, toScreen } from './clip.js';

// Einrasten auf Planpunkte der eingeblendeten Ebenen (Gebäudeecken, Grenzpunkte, Schächte).
// sx, sy: Bildschirmposition relativ zum Overlay (CSS-Pixel). Ergebnis: Weltpunkt oder null.
const C = new Float64Array(4);
export function snapAt(proj, layers, sx, sy, touch = false) {
  const tol = touch ? 20 : 11;
  let best = null, bestD = tol;
  const test = (p) => {
    proj.toClip(p, C);
    if (!inside(C, proj, 0)) return;
    const s = toScreen(C, proj);
    const d = Math.hypot(s[0] - sx, s[1] - sy);
    if (d < bestD) { bestD = d; best = p; }
  };
  if (layers.buildings) for (const b of layers.buildings) b.points.forEach(test);
  if (layers.boundaries) for (const b of layers.boundaries) (b.corners || []).forEach(test);
  if (layers.manholes) for (const m of layers.manholes) test(m.at);
  return best;
}

// Eine Höhe je Planpunkt (eine Quelle der Wahrheit für 2D und 3D).
// In scene.json steht dieselbe Ecke mehrfach (je Flurstück, Gebäude) mit unterschiedlich geschätzter
// Höhe; sonst hinge der eingerastete Wert davon ab, welches Duplikat die Ansicht zuerst trifft (2D: alle
// auf einem Pixel, 3D: perspektivisch getrennt). Regel: Einrastpunkte (Flurstücksecken, Gebäudeecken,
// Schächte), deren Lage auf unter 1 cm übereinstimmt, bekommen eine gemeinsame Höhe – die des Schachts,
// wenn einer dabei ist (Deckelhöhe aus dem Kanalplan), sonst den Mittelwert aller Vorkommen. Dieselbe
// Höhe erhalten die Eckpunkte der Grenzlinien an dieser Stelle, damit Linie und Messpunkt in 3D
// zusammenfallen. Ändert cfg an Ort und Stelle; Ergebnis für die Konsole.
export const PLAN_MERGE_M = 0.01;
export function unifyPlanHeights(cfg) {
  const cand = [];
  for (const b of cfg.boundaries) for (const c of b.corners || []) cand.push({ p: c, fixed: false });
  for (const b of cfg.buildings) for (const c of b.points) cand.push({ p: c, fixed: false });
  for (const m of cfg.sewer.manholes) cand.push({ p: m.at, fixed: true });
  const groups = [];
  for (const c of cand) {
    const g = groups.find((x) => Math.hypot(x.x - c.p[0], x.z - c.p[2]) < PLAN_MERGE_M);
    if (g) g.items.push(c); else groups.push({ x: c.p[0], z: c.p[2], items: [c] });
  }
  let merged = 0, maxSpread = 0;
  const heights = [];
  for (const g of groups) {
    if (g.items.length < 2) continue;
    const fixed = g.items.filter((c) => c.fixed);
    if (fixed.length > 1 && Math.max(...fixed.map((c) => c.p[1])) - Math.min(...fixed.map((c) => c.p[1])) > 1e-6) {
      throw new Error(`scene.json: zwei Schächte an derselben Stelle (${g.x}, ${g.z}) mit verschiedenen Höhen`);
    }
    const ys = g.items.map((c) => c.p[1]);
    const ref = fixed[0] ?? g.items[0]; // Lage: Schacht bzw. erstes Vorkommen (Abweichung < 1 cm)
    const y = fixed.length ? ref.p[1] : ys.reduce((s, v) => s + v, 0) / ys.length;
    maxSpread = Math.max(maxSpread, Math.max(...ys) - Math.min(...ys));
    const [x, , z] = ref.p;
    for (const c of g.items) { c.p[0] = x; c.p[1] = y; c.p[2] = z; }
    heights.push({ x: g.x, z: g.z, y });
    merged++;
  }
  // Grenzlinien: Stützpunkte an einer zusammengeführten Ecke bekommen dieselbe Höhe (Lage bleibt)
  let lineVerts = 0;
  const fix = (p) => {
    const h = heights.find((q) => Math.hypot(q.x - p[0], q.z - p[2]) < PLAN_MERGE_M);
    if (h && p[1] !== h.y) { p[1] = h.y; lineVerts++; }
  };
  for (const b of cfg.boundaries) {
    (b.points || []).forEach(fix);
    for (const l of b.lines || []) l.forEach(fix);
  }
  return { merged, maxSpread, lineVerts };
}
