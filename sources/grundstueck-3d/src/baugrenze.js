// Amtliche rückwärtige blaue Baugrenze auf Flurstück 214 (Mitte) aus dem Bebauungsplan
// Wattenheim „Ortskern“ (Planzeichnung 1:1000, über identische Katasterecken in Viewer-Koordinaten
// eingepasst). Leicht aktualisierbare Konfiguration: Falls später digitalisierte Stützpunkte
// (`points`) eingetragen werden, nutzen Prüfung und Overlay diese direkt statt der Geraden.
// Hinweis zur Orientierung (LVermGeo ALKIS, EPSG:25832): Welt-+Z zeigt Richtung Dautengasse
// (geografisch ca. NO, Azimut ~58°), Welt--Z Richtung Garten / Flurstück 215.

export const BPLAN_SOURCE_URL = 'https://gis.kreis-bad-duerkheim.de/docs_bad_duerkheim_online/b_plan_Wattenheim_Ortskern/';

export const OFFICIAL_BAUGRENZE = {
  id: 'baugrenze-214-hinten',
  label: 'Hintere Baugrenze (B-Plan 1:1000)',
  shortLabel: 'Baugrenze ±0,5 m',
  status: 'official-1000-fit',
  // Geradengleichung im Viewer-Koordinatensystem (Meter, +Z = Richtung Dautengasse):
  //   z(x) = slope * x + intercept = 0,018 * x - 2,20
  equation: { slope: 0.018, intercept: -2.20 },
  // Optional: explizite Stützpunkte [[x, z], ...] für spätere Aktualisierung
  points: null,
  uncertainty_m: 0.5,
  source: 'Original-Bebauungsplan Wattenheim „Ortskern“ (Planzeichnung 1:1000, über Katasterecken eingepasst)',
  sourceUrl: BPLAN_SOURCE_URL,
  note: 'Rückwärtige blaue Baugrenze auf Flurstück 214 (z = 0,018·x − 2,20 m). Überlagerungsunsicherheit mind. ±0,5 m; kein amtlicher Grenznachweis.',
};

// z-Koordinate der hinteren Baugrenze an Position x (Meter).
// Richtung Dautengasse (+Z) ist z größer; jenseits der Baugrenze Richtung Garten (-Z) ist z kleiner.
export function baugrenzeZAt(x, bg = OFFICIAL_BAUGRENZE) {
  if (Array.isArray(bg.points) && bg.points.length >= 2) {
    const pts = bg.points;
    if (x <= pts[0][0]) return pts[0][1];
    const last = pts[pts.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      if ((x >= x0 && x <= x1) || (x >= x1 && x <= x0)) {
        const dx = x1 - x0;
        return Math.abs(dx) < 1e-9 ? z0 : z0 + ((x - x0) / dx) * (z1 - z0);
      }
    }
  }
  return bg.equation.slope * x + bg.equation.intercept;
}

// Vorzeichenbehafteter senkrechter Abstand eines Punktes (x, z) zur hinteren Baugrenze:
//   > 0: vor der Baugrenze (Richtung Dautengasse, im vorderen Baufenster)
//   < 0: jenseits der Baugrenze (Richtung Garten, Überschreitung)
export function signedDistToBaugrenze(x, z, bg = OFFICIAL_BAUGRENZE) {
  const m = bg.equation.slope;
  const zLine = baugrenzeZAt(x, bg);
  return (z - zLine) / Math.hypot(1, m);
}

// Erzeugt 3D-Linienzug und ±0,5-m-Unsicherheitsband auf Flurstück 214 für das 2D/3D-Overlay.
export function buildBaugrenzeOverlay(cfg, ground, bg = OFFICIAL_BAUGRENZE) {
  const f214 = cfg.boundaries.find((b) => b.name === 'Flurstück 214');
  const corners = f214?.corners || [[-6.04, 0, -10.47], [4.94, 0, -10.41]];
  const xs = corners.map((c) => c[0]);
  const xMin = Math.min(...xs) - 0.6;
  const xMax = Math.max(...xs) + 0.6;
  const u = bg.uncertainty_m;
  const m = bg.equation.slope;
  const dzBand = u * Math.hypot(1, m);

  const sampleY = (x, z) => {
    const r = ground?.sample?.(x, z);
    if (r && !r.error && Number.isFinite(r.y)) return r.y + 0.04;
    return 0.15;
  };

  const steps = 12;
  const line = [];
  const bandFront = [];
  const bandBack = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + ((xMax - xMin) * i) / steps;
    const z = baugrenzeZAt(x, bg);
    line.push([x, sampleY(x, z), z]);
    bandFront.push([x, sampleY(x, z + dzBand), z + dzBand]);
    bandBack.push([x, sampleY(x, z - dzBand), z - dzBand]);
  }
  const bandPoly = [...bandFront, ...bandBack.slice().reverse()];
  const midX = (xMin + xMax) / 2;
  const midZ = baugrenzeZAt(midX, bg);

  return {
    meta: bg,
    line,
    bandFront,
    bandBack,
    bandPoly,
    labelAt: [midX, sampleY(midX, midZ), midZ],
  };
}
