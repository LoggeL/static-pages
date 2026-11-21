// Kappung im homogenen Clip-Raum, gemeinsam für 2D (Draufsicht) und 3D (Perspektive).
//
// Eine Projektion `proj` liefert für einen Weltpunkt die Clip-Koordinaten [cx, cy, cz, cw]
// (proj.toClip). Gekappt wird gegen fünf Ebenen, alle linear in (cx, cy, cw) und damit auch
// unter Perspektive exakt:
//   near:   cw - n ≥ 0
//   links:  cx + kx·cw ≥ 0     rechts: kx·cw - cx ≥ 0      kx = 1 + 2·margin/w
//   unten:  cy + ky·cw ≥ 0     oben:   ky·cw - cy ≥ 0      ky = 1 + 2·margin/h
// So liegt keine SVG-Koordinate weiter als `margin` Pixel außerhalb des Bildes – lange Linien
// und gestrichelte Pfade bleiben auch bei Blick dicht über eine Grenze kurz.

const D = new Float64Array(5);

function planes(c, proj, out) {
  const kx = 1 + (2 * proj.margin) / proj.w, ky = 1 + (2 * proj.margin) / proj.h;
  out[0] = c[3] - proj.near;
  out[1] = c[0] + kx * c[3];
  out[2] = kx * c[3] - c[0];
  out[3] = c[1] + ky * c[3];
  out[4] = ky * c[3] - c[1];
  return out;
}

const DA = new Float64Array(5), DB = new Float64Array(5);

// Liang–Barsky: Parameterbereich [t0, t1] des sichtbaren Teils von a→b oder null.
export function clipSegment(a, b, proj) {
  planes(a, proj, DA); planes(b, proj, DB);
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 5; i++) {
    const da = DA[i], db = DB[i];
    if (da < 0 && db < 0) return null;
    if (da < 0) { const t = da / (da - db); if (t > t0) t0 = t; }
    else if (db < 0) { const t = da / (da - db); if (t < t1) t1 = t; }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

// Homogene Interpolation a + t(b-a) → Bildschirm (x, y)
export function screenAt(a, b, t, proj) {
  const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, w = a[3] + (b[3] - a[3]) * t;
  return [(x / w * 0.5 + 0.5) * proj.w, (1 - (y / w * 0.5 + 0.5)) * proj.h];
}
export function toScreen(c, proj) {
  return [(c[0] / c[3] * 0.5 + 0.5) * proj.w, (1 - (c[1] / c[3] * 0.5 + 0.5)) * proj.h];
}

// Sutherland–Hodgman über die fünf Ebenen. V: Clip-Koordinaten (je Float64Array(4)).
// Ergebnis: Bildschirmpunkte [[x,y],…] oder null bei weniger als 3 Ecken.
export function clipPolygon(V, proj) {
  let poly = V;
  for (let k = 0; k < 5; k++) {
    if (poly.length < 3) return null;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = planes(a, proj, DA)[k], db = planes(b, proj, DB)[k];
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push(Float64Array.of(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t));
      }
    }
    poly = out;
  }
  return poly.length >= 3 ? poly.map((c) => toScreen(c, proj)) : null;
}

// Punkt sichtbar (vor der Near-Ebene und höchstens marginPx außerhalb des Bildes)?
export function inside(c, proj, marginPx = 0) {
  if (c[3] - proj.near < 0) return false;
  const kx = 1 + (2 * marginPx) / proj.w, ky = 1 + (2 * marginPx) / proj.h;
  return Math.abs(c[0]) <= kx * c[3] && Math.abs(c[1]) <= ky * c[3];
}

// Hülltest: liegen alle 8 Ecken der Welt-AABB [x0,y0,z0,x1,y1,z1] außerhalb derselben Ebene?
const C8 = new Float64Array(4), P3 = [0, 0, 0];
export function boxOutside(box, proj) {
  let mask = 31;
  for (let i = 0; i < 8 && mask; i++) {
    P3[0] = i & 1 ? box[3] : box[0]; P3[1] = i & 2 ? box[4] : box[1]; P3[2] = i & 4 ? box[5] : box[2];
    planes(proj.toClip(P3, C8), proj, D);
    let m = 0;
    for (let k = 0; k < 5; k++) if (D[k] < 0) m |= 1 << k;
    mask &= m;
  }
  return mask !== 0;
}

export function bbox(points) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) { if (p[i] < b[i]) b[i] = p[i]; if (p[i] > b[3 + i]) b[3 + i] = p[i]; }
  }
  return b;
}
