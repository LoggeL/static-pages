// Exakte Lage-, Abstands-, Konflikt-, Hüll- und Gelände-Berechnung auf Flurstück 214
// direkt aus public/scene/scene.json, ground.json und src/baugrenze.js.
// Ohne three.js (bleibt leicht für 2D).
//
// Orientierungskonvention (LVermGeo ALKIS EPSG:25832: Welt-+Z zeigt Richtung Dautengasse ~NO 58°,
// NICHT nach Süden!). An der Oberfläche ausschließlich lagebezogene Bezeichnungen verwenden:
//   -X = Grenzwand 215/3 | +X = Hof/Kanal | +Z = Dautengasse | -Z = Garten (Flst. 215)

import { OFFICIAL_BAUGRENZE, BPLAN_SOURCE_URL, baugrenzeZAt, signedDistToBaugrenze } from './baugrenze.js';

export const NHN_OFFSET_M = 314.38; // exakt aus allen 4 Schachtdeckelhöhen in scene.json (y + 314,38 m = m ü. NHN)
export const TARGET_Z_MID = 3.55;   // verbindliche z-Mitte (11,00-m-Außenwände bei z ≈ -1,95 .. +9,05 m)
export const BOUNDARY_215_3_CLEARANCE_TARGET = 0.02; // bündig innen an Grenze 215/3 (B-Plan I.3, kein Übertritt)

export const PARCEL_214_AREA_INFO = {
  viewerDigitized_m2: 206.5,
  alkisAttribute_m2: 200,
  alkisPolygon_m2: 205.9,
  label: 'Viewer-Polygon 206,5 m² (digitalisiert); amtliches ALKIS-Attribut 200 m², amtliches Polygon 205,9 m²',
};

const xz = (p) => [p[0], p[2]];

export function ptInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function distPtSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

function segsIntersect(a, b, c, d) {
  const cross = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p, q, r) => Math.min(p[0], r[0]) - 1e-9 <= q[0] && q[0] <= Math.max(p[0], r[0]) + 1e-9
    && Math.min(p[1], r[1]) - 1e-9 <= q[1] && q[1] <= Math.max(p[1], r[1]) + 1e-9;
  if (Math.abs(d1) < 1e-9 && on(c, a, d)) return true;
  if (Math.abs(d2) < 1e-9 && on(c, b, d)) return true;
  if (Math.abs(d3) < 1e-9 && on(a, c, b)) return true;
  if (Math.abs(d4) < 1e-9 && on(a, d, b)) return true;
  return false;
}

export function distSegSeg(a, b, c, d) {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(distPtSeg(a, c, d), distPtSeg(b, c, d), distPtSeg(c, a, b), distPtSeg(d, a, b));
}

export function distPolyPoly(p1, p2) {
  for (const p of p1) if (ptInPoly(p, p2)) return 0;
  for (const p of p2) if (ptInPoly(p, p1)) return 0;
  let m = Infinity;
  for (let i = 0; i < p1.length; i++) {
    const a = p1[i], b = p1[(i + 1) % p1.length];
    for (let j = 0; j < p2.length; j++) m = Math.min(m, distSegSeg(a, b, p2[j], p2[(j + 1) % p2.length]));
  }
  return m;
}

export function distPolyPolyline(poly, line) {
  for (const p of line) if (ptInPoly(p, poly)) return 0;
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    for (let j = 0; j < line.length - 1; j++) m = Math.min(m, distSegSeg(a, b, line[j], line[j + 1]));
  }
  return m;
}

// Strenge Three.js-konforme Rotation um +Y (rechtshändig, Y-up):
//   wx = cx + lx * cos(theta) + lz * sin(theta)
//   wz = cz - lx * sin(theta) + lz * cos(theta)
export function makeTransform(cx, cz, theta) {
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return {
    cx, cz, theta, cos, sin,
    toWorldXZ(lx, lz) { return [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos]; },
    toWorld3(lx, ly, lz, okffY = 0) { return [cx + lx * cos + lz * sin, okffY + ly, cz - lx * sin + lz * cos]; },
    toLocalXZ(wx, wz) {
      const dx = wx - cx, dz = wz - cz;
      return [dx * cos - dz * sin, dx * sin + dz * cos];
    },
  };
}

function border215_3X(p214, z) {
  const segs = [[p214[2], p214[3]], [p214[3], p214[4]], [p214[4], p214[5]]];
  for (const [a, b] of segs) {
    if (z <= Math.max(a[1], b[1]) + 1e-6 && z >= Math.min(a[1], b[1]) - 1e-6) {
      return a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    }
  }
  const [a, b] = z > p214[2][1] ? segs[0] : segs[2];
  return a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
}
function border213X(p214, z) {
  const a = p214[1], b = p214[0];
  return a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
}
function borderStreetZ(p214, x) {
  const a = p214[2], b = p214[1];
  return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
}
function borderGardenZ(p214, x) {
  const a = p214[5], b = p214[0];
  return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
}

function sampleDem(ground, x, z, fallbackY = 0) {
  const r = ground?.sample?.(x, z);
  if (r && !r.error && Number.isFinite(r.y)) return r;
  return { y: fallbackY, q: 0 };
}

function evalPolyAgainst214(polyXZ, p214, bg, pipeXAt, allPipesXZ) {
  const pStreetBoundary = polyXZ[0], pGardenBoundary = polyXZ[1];
  const dz = pGardenBoundary[1] - pStreetBoundary[1];
  const tKink = Math.abs(dz) > 1e-9 ? (p214[3][1] - pStreetBoundary[1]) / dz : 0;
  const kinkX = pStreetBoundary[0] + Math.max(0, Math.min(1, tKink)) * (pGardenBoundary[0] - pStreetBoundary[0]);
  const boundary215_3_m = Math.min(
    ...polyXZ.map(([x, z]) => x - border215_3X(p214, z)),
    kinkX - border215_3X(p214, p214[3][1]),
  );
  const hof213_m = Math.min(...polyXZ.map(([x, z]) => border213X(p214, z) - x));
  const street_m = Math.min(...polyXZ.map(([x, z]) => borderStreetZ(p214, x) - z));
  const garden215_m = Math.min(...polyXZ.map(([x, z]) => z - borderGardenZ(p214, x)));
  const baugrenze_m = Math.min(...polyXZ.map(([x, z]) => signedDistToBaugrenze(x, z, bg)));
  const rawPipe = Math.min(...allPipesXZ.map((pl) => distPolyPolyline(polyXZ, pl)));
  const signedPipe = Math.min(...polyXZ.map(([x, z]) => pipeXAt(z) - x));
  const sewerAxis_m = signedPipe < 0 ? signedPipe : rawPipe;
  const inside214 = polyXZ.every((p) => ptInPoly(p, p214))
    && boundary215_3_m >= -1e-4 && street_m >= -1e-4 && hof213_m >= -1e-4 && garden215_m >= -1e-4;
  return { inside214, boundary215_3_m, hof213_m, street_m, garden215_m, baugrenze_m, sewerAxis_m };
}

function normalizeSide(side) {
  const s = String(side || '').toLowerCase();
  if (s === 'west' || s.includes('grenz') || s === 'boundary') return 'grenzwand';
  if (s === 'east' || s.includes('hof') || s.includes('kanal') || s === 'courtyard') return 'hof';
  if (s === 'south' || s.includes('dauten') || s === 'street') return 'dautengasse';
  if (s === 'north' || s.includes('gart') || s === 'garden') return 'garten';
  return s || 'dautengasse';
}

// Exakte Sutherland-Hodgman-Kappung eines XZ-Polygons gegen den DN250-Schutzstreifen (±corridorM)
function clipPolyToSewerCorridor(polyXZ, pStart, pEnd, corridorM) {
  if (!(corridorM > 0) || !polyXZ?.length) return null;
  const dz = pEnd[1] - pStart[1];
  const slope = Math.abs(dz) > 1e-9 ? (pEnd[0] - pStart[0]) / dz : 0;
  const pipeXAt = (z) => pStart[0] + (z - pStart[1]) * slope;
  const halfBandX = corridorM * Math.hypot(1, slope);

  const clipHalfPlane = (pts, evalFn) => {
    if (!pts.length) return [];
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const fa = evalFn(a), fb = evalFn(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0 && fb < 0) || (fa < 0 && fb >= 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    return out;
  };

  let res = clipHalfPlane(polyXZ, ([x, z]) => x - (pipeXAt(z) - halfBandX));
  res = clipHalfPlane(res, ([x, z]) => (pipeXAt(z) + halfBandX) - x);
  return res.length >= 3 ? res : null;
}

export function computeSitePlacement(cfg, ground, spec, corridorM = 2.0, bg = OFFICIAL_BAUGRENZE) {
  const b214 = cfg.boundaries.find((b) => b.name === 'Flurstück 214');
  const b215 = cfg.boundaries.find((b) => b.name === 'Flurstück 215');
  if (!b214?.corners || b214.corners.length < 6) throw new Error('scene.json: Flurstück 214 mit 6 Ecken nicht gefunden');
  const p214 = b214.corners.map(xz);

  const length = spec.footprint.length; // 11,00 m entlang lokalem X
  const width = spec.footprint.width;   // 7,15 m entlang lokalem Z
  const halfL = length / 2;
  const halfW = width / 2;

  const zGarden = TARGET_Z_MID - halfL; // -1,95 m
  const zStreet = TARGET_Z_MID + halfL; // +9,05 m
  const xBStreet = border215_3X(p214, zStreet);
  const xBGarden = border215_3X(p214, zGarden);
  const theta = Math.atan2(-(zGarden - zStreet), xBGarden - xBStreet); // ≈ +92,23° um +Y

  const localCorners = [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]];
  let cx = (xBStreet + xBGarden) / 2 + halfW;
  const cz = TARGET_Z_MID;

  for (let it = 0; it < 6; it++) {
    const tf = makeTransform(cx, cz, theta);
    const wc = localCorners.map(([lx, lz]) => tf.toWorldXZ(lx, lz));
    const pA = wc[0], pB = wc[1];
    const tKink = (p214[3][1] - pA[1]) / (pB[1] - pA[1]);
    const kinkX = pA[0] + Math.max(0, Math.min(1, tKink)) * (pB[0] - pA[0]);
    const minClear = Math.min(...wc.map(([x, z]) => x - border215_3X(p214, z)), kinkX - border215_3X(p214, p214[3][1]));
    cx += (BOUNDARY_215_3_CLEARANCE_TARGET - minClear);
  }

  const tf = makeTransform(cx, cz, theta);
  const cornersXZ = localCorners.map(([lx, lz]) => tf.toWorldXZ(lx, lz));

  const pipeMain = cfg.sewer.pipes[0];
  const pipePts = pipeMain.points.map(xz);
  const pStart = pipePts[0], pEnd = pipePts[pipePts.length - 1];
  const pipeXAt = (z) => pStart[0] + ((z - pStart[1]) / (pEnd[1] - pStart[1])) * (pEnd[0] - pStart[0]);
  const allPipesXZ = cfg.sewer.pipes.map((p) => p.points.map(xz));

  // 1) Wand-Hülle gegen Parzelle 214, Baugrenze & DN250
  const wallEval = evalPolyAgainst214(cornersXZ, p214, bg, pipeXAt, allPipesXZ);

  // 2) Reale 3D-Dach-/Rinnen-Hülle (aus spec.footprint.envelope3DLocal inkl. Rinne Hof/Kanal)
  const env = spec.footprint.envelope3DLocal;
  let roofLocalCorners;
  if (env) {
    roofLocalCorners = [
      [env.minX, env.minZ],
      [env.maxX, env.minZ],
      [env.maxX, env.maxZ],
      [env.minX, env.maxZ],
    ];
  } else if (Array.isArray(spec.roof?.eaveCornersLocal) && spec.roof.eaveCornersLocal.length === 4) {
    roofLocalCorners = spec.roof.eaveCornersLocal;
  } else {
    roofLocalCorners = localCorners;
  }
  const roofCornersXZ = roofLocalCorners.map(([lx, lz]) => tf.toWorldXZ(lx, lz));
  const roofHull = evalPolyAgainst214(roofCornersXZ, p214, bg, pipeXAt, allPipesXZ);

  const worldOutline = door => door.exteriorFootprintPlan.map(([u, v]) => tf.toWorldXZ(u - halfL, v - halfW));
  const courtCheck = evalPolyAgainst214(worldOutline(spec.entrance.side), p214, bg, pipeXAt, allPipesXZ);
  const gardenCheck = evalPolyAgainst214(worldOutline(spec.entrance.garden), p214, bg, pipeXAt, allPipesXZ);
  const dSewerAxis = wallEval.sewerAxis_m;
  const sewerOverlapActive = Math.max(0, corridorM - dSewerAxis);
  const sewerOverlap20 = Math.max(0, 2.0 - dSewerAxis);
  const sewerOverlap25 = Math.max(0, 2.5 - dSewerAxis);
  const sewerOverlap30 = Math.max(0, 3.0 - dSewerAxis);
  const conflictPolyXZ = sewerOverlapActive > 0.005
    ? clipPolyToSewerCorridor(cornersXZ, pStart, pEnd, corridorM)
    : null;

  // Bestandsgebäude
  const findBldg = (name) => cfg.buildings.find((b) => b.name === name)?.points.map(xz);
  const h4 = findBldg('Haus Nr. 4');
  const h6 = findBldg('Haus Nr. 6');
  const h3 = findBldg('Haus Nr. 3');
  const dHaus4 = h4 ? distPolyPoly(cornersXZ, h4) : null;
  const dHaus6 = h6 ? distPolyPoly(cornersXZ, h6) : null;
  const dHaus3 = h3 ? distPolyPoly(cornersXZ, h3) : null;

  // Geländeabtastung (DEM) getrennt für Grenzwand 215/3 (blind) vs. offene Seiten (Garten, Hof/Kanal, Dautengasse)
  let terrainMinY = Infinity, terrainMaxY = -Infinity, openSidesMaxY = -Infinity, qMin = 2;
  const sampleEdge = (a, b, isOpenSide, steps = 24) => {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = sampleDem(ground, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0);
      if (r.q > 0) {
        terrainMinY = Math.min(terrainMinY, r.y);
        terrainMaxY = Math.max(terrainMaxY, r.y);
        if (isOpenSide) openSidesMaxY = Math.max(openSidesMaxY, r.y);
        qMin = Math.min(qMin, r.q);
      }
    }
  };
  sampleEdge(cornersXZ[0], cornersXZ[1], false); // Grenzwand 215/3 (fensterlos)
  sampleEdge(cornersXZ[1], cornersXZ[2], true);  // Garten
  sampleEdge(cornersXZ[2], cornersXZ[3], true);  // Hof/Kanal
  sampleEdge(cornersXZ[3], cornersXZ[0], true);  // Dautengasse

  const centerDem = sampleDem(ground, cx, cz, 0);
  if (!Number.isFinite(terrainMinY)) { terrainMinY = -1.14; terrainMaxY = 0.52; openSidesMaxY = 0.31; qMin = 0; }
  if (!Number.isFinite(openSidesMaxY)) openSidesMaxY = terrainMaxY;

  // OKFF EG: 5 cm über Hochpunkt aller offenen Fassaden (Garten / Hof / Dautengasse)
  const okffEgY = Math.round((openSidesMaxY + 0.05) * 100) / 100;
  const plinthBottomWorldY = Math.round((terrainMinY - 0.45) * 100) / 100;
  const plinthDepth = Math.max(1.8, Math.round((okffEgY - plinthBottomWorldY) * 100) / 100);

  const cornerDefs = [
    { key: 'streetBoundary', label: 'Ecke Dautengasse / Grenzwand 215/3' },
    { key: 'gardenBoundary', label: 'Ecke Garten / Grenzwand 215/3' },
    { key: 'gardenHof',      label: 'Ecke Garten / Hof-Kanal' },
    { key: 'streetHof',      label: 'Ecke Dautengasse / Hof-Kanal' },
  ];
  const cornersGround = cornersXZ.map(([x, z], i) => {
    const g = sampleDem(ground, x, z, centerDem.y);
    return { ...cornerDefs[i], x, z, worldY: +g.y.toFixed(3), localY: +(g.y - okffEgY).toFixed(3), q: g.q };
  });

  // Exakte DEM-Höhen direkt vor jeder Außentür (Dautengasse, Hof/Kanal, Garten)
  const resolveDoor = (door, fallbackSide) => {
    if (!door) return null;
    const normSide = normalizeSide(door.side || fallbackSide);
    const lx = door.local ? door.local[0] : (door.x ?? 0);
    const lz = door.local ? door.local[2] : (door.z ?? 0);
    const [wx, wz] = tf.toWorldXZ(lx, lz);
    let ox, oz;
    if (Array.isArray(door.sampleLocal)) {
      [ox, oz] = tf.toWorldXZ(door.sampleLocal[0], door.sampleLocal[2]);
    } else {
      const nx = door.outwardLocal ? door.outwardLocal[0] : (normSide === 'dautengasse' ? -1 : normSide === 'garten' ? 1 : 0);
      const nz = door.outwardLocal ? door.outwardLocal[2] : (normSide === 'hof' ? 1 : normSide === 'grenzwand' ? -1 : 0);
      const probe = normSide === 'dautengasse' ? 0.25 : 0.65;
      [ox, oz] = tf.toWorldXZ(lx + nx * probe, lz + nz * probe);
    }
    const gWall = sampleDem(ground, wx, wz, centerDem.y);
    const gOut = sampleDem(ground, ox, oz, gWall.y);
    const groundY = Math.min(gWall.y, gOut.y);
    const borderClearance_m = normSide === 'dautengasse'
      ? borderStreetZ(p214, wx) - wz
      : normSide === 'hof'
        ? border213X(p214, wz) - wx
        : normSide === 'garten'
          ? wz - borderGardenZ(p214, wx)
          : wx - border215_3X(p214, wz);
    const baugrenzeClearance_m = signedDistToBaugrenze(wx, wz, bg);
    return {
      openingId: door.openingId || door.id || null,
      side: normSide,
      recessed: !!door.recessed,
      localXZ: [lx, lz],
      worldXZ: [wx, wz],
      outsideXZ: [ox, oz],
      groundY: +groundY.toFixed(3),
      groundLocalY: +(groundY - okffEgY).toFixed(3),
      drop_m: +Math.max(0, okffEgY - groundY).toFixed(3),
      borderClearance_m: +borderClearance_m.toFixed(3),
      baugrenzeClearance_m: +baugrenzeClearance_m.toFixed(3),
      q: Math.min(gWall.q, gOut.q),
    };
  };
  const terrainAtDoors = {
    main: resolveDoor(spec.entrance?.main, 'dautengasse'),
    side: resolveDoor(spec.entrance?.side, 'hof'),
    garden: resolveDoor(spec.entrance?.garden || spec.entrance?.terrace, 'garten'),
  };
  // Alias `terrace` für Abwärtskompatibilität mit model3d.js
  terrainAtDoors.terrace = terrainAtDoors.garden;

  const sampleSectionLine = (axis) => {
    const pts = [];
    const span = axis === 'long' ? halfL : halfW;
    const pad = 2.0;
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const s = -span - pad + ((2 * (span + pad)) * i) / steps;
      const [wx, wz] = axis === 'long' ? tf.toWorldXZ(s, 0) : tf.toWorldXZ(0, s);
      const r = sampleDem(ground, wx, wz, centerDem.y);
      pts.push({ s, yLocal: +(r.y - okffEgY).toFixed(3), yWorld: +r.y.toFixed(3), q: r.q });
    }
    return pts;
  };

  // Sauber getrennte Gebäudehöhen (#20 Punkt 3 + #24 Punkt 2+3: Entwurfswerte, lagebezogene Namen!)
  const h = spec.heights || {};
  const eaveWall = h.eaveWallY ?? h.eaveWall ?? 5.90;
  const eaveBoundaryTop = h.eaveBoundaryTopY ?? h.eaveGrenzwandTopY ?? h.eaveWestTopY ?? 6.22;
  const eaveHofUnder = h.eaveHofUnderY ?? h.eaveCourtyardUnderY ?? h.eaveEastUnderY ?? h.eaveOverhangY ?? 5.58;
  const eaveHofTop = h.eaveHofTopY ?? h.eaveCourtyardTopY ?? h.eaveEastTopY ?? 5.90;
  const ridgeTop = h.ridgeTopY ?? h.ridge ?? 8.72;
  const avgGroundY = cornersGround.reduce((s, c) => s + c.worldY, 0) / cornersGround.length;

  const heightsSummary = {
    okffEg: {
      label: 'OKFF EG (Bezug ±0,00 m · Entwurf)',
      tag: 'entwurf',
      local: 0,
      worldY: okffEgY,
      nhn: +(okffEgY + NHN_OFFSET_M).toFixed(2),
      aboveMinGround: +(okffEgY - terrainMinY).toFixed(2),
    },
    eaveWall: {
      label: 'Wand-Traufpunkt (OK Decke OG · Entwurf)',
      tag: 'entwurf',
      local: +eaveWall.toFixed(2),
      worldY: +(okffEgY + eaveWall).toFixed(2),
      nhn: +(okffEgY + eaveWall + NHN_OFFSET_M).toFixed(2),
    },
    roofEdgeBoundary: {
      label: 'Dachkante Grenzwand 215/3 (bündig/Attika · Entwurf)',
      tag: 'entwurf',
      local: +eaveBoundaryTop.toFixed(2),
      worldY: +(okffEgY + eaveBoundaryTop).toFixed(2),
      nhn: +(okffEgY + eaveBoundaryTop + NHN_OFFSET_M).toFixed(2),
    },
    roofEdgeHofUnder: {
      label: 'Traufkante UK Hof/Kanal (0,45 m Überstand · Entwurf)',
      tag: 'entwurf',
      local: +eaveHofUnder.toFixed(2),
      worldY: +(okffEgY + eaveHofUnder).toFixed(2),
      nhn: +(okffEgY + eaveHofUnder + NHN_OFFSET_M).toFixed(2),
    },
    roofEdgeHofTop: {
      label: 'Dachkante OK Hof/Kanal (0,45 m Überstand · Entwurf)',
      tag: 'entwurf',
      local: +eaveHofTop.toFixed(2),
      worldY: +(okffEgY + eaveHofTop).toFixed(2),
      nhn: +(okffEgY + eaveHofTop + NHN_OFFSET_M).toFixed(2),
    },
    ridge: {
      label: `Firsthöhe OK (Satteldach ${spec.roof?.pitchDeg ?? 35}° · Entwurf)`,
      tag: 'entwurf',
      local: +ridgeTop.toFixed(2),
      worldY: +(okffEgY + ridgeTop).toFixed(2),
      nhn: +(okffEgY + ridgeTop + NHN_OFFSET_M).toFixed(2),
      aboveMinGround: +(okffEgY + ridgeTop - terrainMinY).toFixed(2),
      aboveAvgGround: +(okffEgY + ridgeTop - avgGroundY).toFixed(2),
    },
  };

  const zs = cornersXZ.map((p) => p[1]);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const hofStripMinW = wallEval.hof213_m;
  const hofStripMaxW = Math.max(border213X(p214, cornersXZ[2][1]) - cornersXZ[2][0], border213X(p214, cornersXZ[3][1]) - cornersXZ[3][0]);

  const parking = {
    required: 2,
    stallSize: [2.5, 5.0],
    frontDepth_m: wallEval.street_m,
    hofStripWidth_m: [hofStripMinW, hofStripMaxW],
    resolved: false,
    summary: `2 Stellplätze/WE (à 2,50 × 5,00 m) NICHT konfliktfrei nachgewiesen: zur Dautengasse nur ${wallEval.street_m.toFixed(2).replace('.', ',')} m; der Streifen Hof/Kanal (${hofStripMinW.toFixed(2).replace('.', ',')}–${hofStripMaxW.toFixed(2).replace('.', ',')} m breit) liegt direkt über der DN250-Längsleitung (höchstens Gefangenstellplätze mit Kanal-Konflikt).`,
  };

  return {
    parcel: {
      name: 'Flurstück 214',
      area_m2: b214.area_m2,
      areaInfo: PARCEL_214_AREA_INFO,
    },
    parcel215: {
      name: 'Flurstück 215',
      area_m2: b215?.area_m2 ?? 447.7,
      status: 'Private Grünfläche (B-Plan Wattenheim „Ortskern“, S. 21/22) – als Wohnbauplatz ausgeschlossen.',
    },
    transform: tf,
    center: [cx, okffEgY, cz],
    rotationY: theta,
    rotationDeg: (theta * 180) / Math.PI,
    cornersXZ,
    corners3D: cornersXZ.map(([x, z]) => [x, okffEgY, z]),
    roofCornersXZ,
    roofHull,
    zRange: [zMin, zMax],
    baugrenze: {
      meta: bg,
      clearance_m: wallEval.baugrenze_m,
      roofClearance_m: roofHull.baugrenze_m,
      uncertainty_m: bg.uncertainty_m,
      withinUncertainty: wallEval.baugrenze_m < bg.uncertainty_m,
      exceeded: wallEval.baugrenze_m < 0,
      zAtBoundary: baugrenzeZAt(cornersXZ[1][0], bg),
      zAtHof: baugrenzeZAt(cornersXZ[2][0], bg),
    },
    clearances: {
      inside214: wallEval.inside214,
      boundary215_3_m: wallEval.boundary215_3_m,
      hof213_m: wallEval.hof213_m,
      street_m: wallEval.street_m,
      garden215_m: wallEval.garden215_m,
      haus4_m: dHaus4,
      haus6_m: dHaus6,
      haus3_m: dHaus3,
    },
    sewer: {
      pipeName: pipeMain.name,
      dn: pipeMain.dn,
      corridorActive_m: corridorM,
      axisDist_m: dSewerAxis,
      roofAxisDist_m: roofHull.sewerAxis_m,
      stairAxisDist_m: courtCheck.sewerAxis_m,
      gardenStepRear_m: gardenCheck.baugrenze_m,
      overlapActive_m: sewerOverlapActive,
      overlap20_m: sewerOverlap20,
      overlap25_m: sewerOverlap25,
      overlap30_m: sewerOverlap30,
      conflictActive: sewerOverlapActive > 0.005,
      conflict20: sewerOverlap20 > 0.005,
      conflictPolyXZ,
    },
    terrain: {
      minY: terrainMinY,
      maxY: terrainMaxY,
      openSidesMaxY,
      avgY: avgGroundY,
      spanY: terrainMaxY - terrainMinY,
      qMin,
      okffEgY,
      okffWorldY: okffEgY,
      okffEgNhn: +(okffEgY + NHN_OFFSET_M).toFixed(2),
      ridgeWorldY: +(okffEgY + ridgeTop).toFixed(2),
      ridgeNhn: +(okffEgY + ridgeTop + NHN_OFFSET_M).toFixed(2),
      plinthBottomWorldY,
      plinthDepth,
      plinthBottomLocalY: -plinthDepth,
      nhnOffset: NHN_OFFSET_M,
      corners: cornersGround,
      doors: terrainAtDoors,
      sectionCross: sampleSectionLine('cross'),
      sectionLong: sampleSectionLine('long'),
    },
    heightsSummary,
    parking,
    bplanUrl: BPLAN_SOURCE_URL,
    disclaimer: 'Reine geometrische Vorprüfung auf Grundlage der Kataster-/B-Plan-Einpassung – keine baurechtliche Zusicherung oder Genehmigungsfreigabe.',
  };
}

export function getHouseFocusPoints(placement, spec) {
  const y0 = placement.terrain.minY;
  const y1 = placement.terrain.ridgeWorldY ?? (placement.terrain.okffEgY + (spec.heights?.ridgeTopY ?? 8.72));
  const pts = [];
  for (const [x, z] of placement.cornersXZ) {
    pts.push([x, y0, z], [x, y1, z]);
  }
  return pts;
}
