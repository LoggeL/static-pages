// Modellabgeleitete Bemaßung (Single Source of Truth aus HOUSE_SPEC)
// sowie leichte 2D-Karten-Overlay-Geometrie für src/overlay.js (ohne Three.js!).
import { HOUSE_SPEC, planToLocal } from './spec.js';

const r2 = (v) => +v.toFixed(2);
const r3 = (v) => +v.toFixed(3);

export function fmtM(v, digits = 2) {
  return `${v.toFixed(digits).replace('.', ',')} m`;
}

// Erzeugt aus einer Außenwand + ihren Öffnungen eine lückenlose Pfeiler-/Öffnungs-Maßkette
function buildFacadeChain(totalLen, openings) {
  const ops = [...openings].sort((a, b) => a.s0 - b.s0);
  const segments = [];
  let cur = 0;
  for (const o of ops) {
    if (o.s0 - cur > 1e-4) {
      segments.push({ kind: 'pier', from: r3(cur), to: r3(o.s0), len: r3(o.s0 - cur) });
    }
    segments.push({
      kind: o.kind,
      id: o.id,
      from: r3(o.s0),
      to: r3(o.s1),
      len: r3(o.s1 - o.s0),
      height: o.height,
      sillY: o.sillY,
      ratioHB: r2(o.height / (o.s1 - o.s0)),
    });
    cur = o.s1;
  }
  if (totalLen - cur > 1e-4) {
    segments.push({ kind: 'pier', from: r3(cur), to: r3(totalLen), len: r3(totalLen - cur) });
  }
  return segments;
}

// Leitet sämtliche Außen-, Innen-, Öffnungs-, Raum-, Treppen-, Eingangs- und Höhenmaße direkt aus spec ab.
// Alle Gebäudehöhen sind Entwurfsannahmen ('entwurf') und lagebezogen benannt (keine falschen Himmelsrichtungen!).
export function deriveDimensions(spec = HOUSE_SPEC, { okffWorldY = null, nhnOffset = 314.38, terrainMinY = null, terrainMeanY = null } = {}) {
  const { length: L, width: W, wallExt, innerLength, innerWidth } = spec.footprint;
  const h = spec.heights;
  const st = spec.stairs;
  const ent = spec.entrance;

  const floorChains = (level) => {
    const ext = level.openings.filter((o) => o.side);
    const grenzwand = buildFacadeChain(L, ext.filter((o) => o.side === 'west'));
    const hof = buildFacadeChain(L, ext.filter((o) => o.side === 'east'));
    const dautengasse = buildFacadeChain(W, ext.filter((o) => o.side === 'south'));
    const garten = buildFacadeChain(W, ext.filter((o) => o.side === 'north'));
    return {
      grenzwand,
      hof,
      dautengasse,
      garten,
      // Stabile Achsenschlüssel für Abwärtskompatibilität
      west: grenzwand,
      east: hof,
      south: dautengasse,
      north: garten,
    };
  };

  const levelElevation = (key, localY, label, tag = 'entwurf') => {
    const worldY = okffWorldY !== null ? r2(okffWorldY + localY) : null;
    const nhnM = worldY !== null ? r2(worldY + nhnOffset) : null;
    const aboveMinGroundM = worldY !== null && terrainMinY !== null ? r2(worldY - terrainMinY) : null;
    const aboveMeanGroundM = worldY !== null && terrainMeanY !== null ? r2(worldY - terrainMeanY) : null;
    return { key, localY: r2(localY), worldY, nhnM, aboveMinGroundM, aboveMeanGroundM, label, tag };
  };

  const eaveBoundaryTopY = h.eaveBoundaryTopY ?? h.eaveWestTopY;
  const eaveHofUnderY = h.eaveHofUnderY ?? h.eaveEastUnderY;
  const eaveHofTopY = h.eaveHofTopY ?? h.eaveEastTopY;

  const elevations = [
    levelElevation('splitEntry',    ent.main.sillY,        'Eingangspodest Split-Level (Dautengasse · Entwurf)',             'entwurf'),
    levelElevation('okffEg',        h.okffEg,              'OKFF EG (Bezugsebene ±0,00 · Entwurf)',                          'entwurf'),
    levelElevation('egClear',       h.egClear,             'UK Decke EG (lichte Höhe 2,70 m · Entwurf)',                     'entwurf'),
    levelElevation('okffOg',        h.okffOg,              'OKFF OG (Geschosshöhe 3,00 m · Entwurf)',                        'entwurf'),
    levelElevation('ogClear',       h.okffOg + h.ogClear,  'UK Decke OG (lichte Höhe 2,65 m · Entwurf)',                     'entwurf'),
    levelElevation('eaveHofUnder',  eaveHofUnderY,         'Traufkante UK Hof/Kanal (0,45 m Überstand · Entwurf)',           'entwurf'),
    levelElevation('eaveWall',      h.eaveWallY,           'Wand-Traufpunkt (OK OG-Decke, Grenzwand & Hof/Kanal · Entwurf)', 'entwurf'),
    levelElevation('eaveHofTop',    eaveHofTopY,           'Dachkante OK Hof/Kanal (0,45 m Überstand · Entwurf)',            'entwurf'),
    levelElevation('eaveBoundary',  eaveBoundaryTopY,      'Dachkante / Attika-OK Grenzwand 215/3 (bündig 0,00 m · Entwurf)', 'entwurf'),
    levelElevation('ridgeWall',     h.ridgeWallY,          'Giebelwand-Spitze (UK Dachaufbau · Entwurf)',                    'entwurf'),
    levelElevation('ridgeTop',      h.ridgeTopY,           'Firsthöhe OK ab OKFF EG (Satteldach 35,0° · Entwurf)',           'entwurf'),
  ];

  const ogOpeningAreaM2 = spec.levels.og.stairOpeningAreaM2 ?? st.slabOpening?.areaM2 ?? 5.93;
  const ogUsableRooms = spec.levels.og.rooms.filter((rm) => !rm.isOpening);
  const ogNetAreaM2 = spec.levels.og.netAreaM2 ?? r2(ogUsableRooms.reduce((s, rm) => s + rm.areaM2, 0));

  const mainSt = ent.main.stair;
  const sideSt = ent.side.stair;

  return {
    outer: {
      lengthM: L,
      widthM: W,
      bgfPerFloorM2: spec.footprint.areaM2,
      bgfTotalM2: r2(spec.footprint.areaM2 * 2),
      wallExtM: wallExt,
      innerLengthM: innerLength,
      innerWidthM: innerWidth,
    },
    floors: {
      eg: {
        label: spec.levels.eg.label,
        netAreaM2: spec.levels.eg.netAreaM2,
        areaNote: spec.levels.eg.areaNote,
        chains: floorChains(spec.levels.eg),
        rooms: spec.levels.eg.rooms.map((rm) => {
          const [u0, v0, u1, v1] = rm.rects[0];
          return { id: rm.id, name: rm.name, w: r2(u1 - u0), d: r2(v1 - v0), areaM2: rm.areaM2, provenance: rm.provenance };
        }),
      },
      og: {
        label: spec.levels.og.label,
        netAreaM2: ogNetAreaM2,
        stairOpeningAreaM2: ogOpeningAreaM2,
        areaNote: spec.levels.og.areaNote,
        chains: floorChains(spec.levels.og),
        rooms: spec.levels.og.rooms.map((rm) => {
          const [u0, v0, u1, v1] = rm.rects[0];
          return {
            id: rm.id,
            name: rm.name,
            w: r2(u1 - u0),
            d: r2(v1 - v0),
            areaM2: rm.areaM2,
            isOpening: !!rm.isOpening,
            provenance: rm.provenance,
          };
        }),
      },
    },
    stairs: {
      risers: st.risers,
      treads: st.treads,
      riseCm: r2(st.riseM * 100),
      treadMeanCm: r2(st.treadMeanM * 100),
      stepFormulaCm: r2(st.stepFormulaM * 100),
      dinOk: st.stepFormulaM >= 0.59 && st.stepFormulaM <= 0.65 && st.minHeadroomM >= 2.0,
      clearWidthM: st.clearWidthM,
      openingWidthM: st.box.width,
      openingDepthM: st.box.depth,
      openingAreaM2: ogOpeningAreaM2,
      minHeadroomM: st.minHeadroomM,
    },
    entrances: {
      main: {
        siteSide: 'dautengasse',
        type: 'split-level',
        provenance: ent.main.provenance,
        sillLocalY: ent.main.sillY,
        protrusionM: ent.main.thresholdStep.protrusionM,
        landingDepthM: ent.main.landing.depthM,
        landingWidthM: ent.main.landing.widthM,
        risers: mainSt.risers,
        treads: mainSt.treads,
        riseCm: r2(mainSt.riseM * 100),
        treadCm: r2(mainSt.treadM * 100),
        runM: mainSt.box.runM,
        clearWidthM: mainSt.box.clearWidthM,
        stepFormulaCm: r2(mainSt.stepFormulaM * 100),
        minHeadroomM: mainSt.minHeadroomM,
        dinOk: mainSt.stepFormulaM >= 0.59 && mainSt.stepFormulaM <= 0.65 && mainSt.minHeadroomM >= 2.0 && mainSt.box.clearWidthM >= 0.95,
      },
      side: {
        siteSide: 'hof',
        type: 'exterior-parallel-stair',
        provenance: ent.side.provenance,
        sillLocalY: ent.side.sillY,
        landingLengthM: ent.side.landing.lengthM,
        landingDepthM: ent.side.landing.depthM,
        risers: sideSt.risers,
        treads: sideSt.treads,
        riseCm: r2(sideSt.riseM * 100),
        treadCm: r2(sideSt.treadM * 100),
        runM: sideSt.box.runM,
        clearWidthM: sideSt.box.clearWidthM,
        stepFormulaCm: r2(sideSt.stepFormulaM * 100),
        bottomLocalY: sideSt.bottomY,
        railingHeightM: ent.side.railingHeightM,
        dinOk: sideSt.stepFormulaM >= 0.59 && sideSt.stepFormulaM <= 0.65 && sideSt.box.clearWidthM >= 0.95,
      },
      garden: {
        siteSide: 'garten',
        type: 'single-step',
        provenance: ent.garden.provenance,
        sillLocalY: ent.garden.sillY,
        steps: ent.garden.steps.length,
        treadM: ent.garden.steps[0].treadM,
        riseM: ent.garden.steps[0].riseM,
      },
    },
    roof: {
      pitchDeg: spec.roof.pitchDeg,
      pitchProvenance: spec.roof.pitchProvenance || 'entwurf',
      overhangBoundaryM: spec.roof.overhangWest,
      overhangHofM: spec.roof.overhangEast,
      overhangDautengasseM: spec.roof.overhangSouth,
      overhangGartenM: spec.roof.overhangNorth,
      overhangWestM: spec.roof.overhangWest,
      overhangEastM: spec.roof.overhangEast,
      overhangSouthM: spec.roof.overhangSouth,
      overhangNorthM: spec.roof.overhangNorth,
      eaveLengthM: r2(L + spec.roof.overhangSouth + spec.roof.overhangNorth),
      eaveWidthM: r2(W + spec.roof.overhangWest + spec.roof.overhangEast),
    },
    heightsSummary: {
      provenance: 'entwurf',
      firsthoeheAbOkffEgM: h.ridgeTopY,
      wandTraufeAbOkffEgM: h.eaveWallY,
      dachkanteGrenzwandAbOkffEgM: eaveBoundaryTopY,
      traufkanteHofUkAbOkffEgM: eaveHofUnderY,
      traufkanteHofOkAbOkffEgM: eaveHofTopY,
      // Kompatibilitäts-Aliase
      dachkanteWestAbOkffEgM: eaveBoundaryTopY,
      traufkanteOstUkAbOkffEgM: eaveHofUnderY,
      traufkanteOstOkAbOkffEgM: eaveHofTopY,
    },
    elevations,
  };
}

// Berechnet exakte Wand-Teilrechtecke abzüglich realer Tür-/Fensteröffnungen (für 2D-Overlay, plan2d.js & 3D)
export function splitWallSegments(wall, openings) {
  const ops = openings.filter((o) => o.wallId === wall.id).sort((a, b) => a.s0 - b.s0);
  const start = wall.axis === 'u' ? wall.u0 : wall.v0;
  const end = wall.axis === 'u' ? wall.u1 : wall.v1;
  const solid = [];
  let cur = start;
  for (const o of ops) {
    if (o.s0 > cur + 1e-4) solid.push([cur, o.s0]);
    cur = Math.max(cur, o.s1);
  }
  if (end > cur + 1e-4) solid.push([cur, end]);
  return {
    solid: solid.map(([a, b]) =>
      wall.axis === 'u'
        ? [a, wall.v0, b, wall.v1]
        : [wall.u0, a, wall.u1, b]
    ),
    openings: ops.map((o) => ({
      ...o,
      rect: wall.axis === 'u'
        ? [o.s0, wall.v0, o.s1, wall.v1]
        : [wall.u0, o.s0, wall.u1, o.s1],
    })),
  };
}

// Kompakte lokale (x, z)-Geometrie für das 2D-Karten-Overlay (src/overlay.js)
// mode: 'full' | 'roof' | 'og' | 'eg' | 'cutaway' | 'section'
export function getMapOverlayData(spec = HOUSE_SPEC, mode = 'full') {
  const toPoly = ([u0, v0, u1, v1]) => [
    planToLocal(u0, v0),
    planToLocal(u1, v0),
    planToLocal(u1, v1),
    planToLocal(u0, v1),
  ];

  const showRoof = mode === 'full' || mode === 'roof';
  const floorKey = mode === 'eg' ? 'eg' : 'og';
  const level = spec.levels[floorKey];
  const wallPolys = [];
  const openingLines = [];

  for (const w of level.walls) {
    const { solid, openings } = splitWallSegments(w, level.openings);
    for (const r of solid) wallPolys.push({ ext: w.ext, poly: toPoly(r) });
    for (const o of openings) {
      const [u0, v0, u1, v1] = o.rect;
      const a = w.axis === 'u' ? planToLocal(u0, (v0 + v1) / 2) : planToLocal((u0 + u1) / 2, v0);
      const b = w.axis === 'u' ? planToLocal(u1, (v0 + v1) / 2) : planToLocal((u0 + u1) / 2, v1);
      openingLines.push({ kind: o.kind, a, b });
    }
  }

  const stairSteps = spec.stairs.steps.map((s) => s.poly.map(([u, v]) => planToLocal(u, v)));
  const splitStairSteps = floorKey === 'eg' && spec.entrance.main?.stair?.steps
    ? spec.entrance.main.stair.steps.map((s) => s.poly.map(([u, v]) => planToLocal(u, v)))
    : [];
  const stairOpening = toPoly([
    spec.stairs.slabOpening.u0,
    spec.stairs.slabOpening.v0,
    spec.stairs.slabOpening.u1,
    spec.stairs.slabOpening.v1,
  ]);

  // Außentreppen & Podeste (Hof/Kanal & Garten) für die 2D-Karte (immer 100 % in Flst. 214!)
  const exteriorSteps = [];
  if (spec.entrance.side?.landing?.poly) {
    exteriorSteps.push(spec.entrance.side.landing.poly.map(([u, v]) => planToLocal(u, v)));
  }
  if (spec.entrance.side?.stair?.steps) {
    for (const st of spec.entrance.side.stair.steps) {
      exteriorSteps.push(st.poly.map(([u, v]) => planToLocal(u, v)));
    }
  }
  if (spec.entrance.side?.stair?.bottomPad?.poly) {
    exteriorSteps.push(spec.entrance.side.stair.bottomPad.poly.map(([u, v]) => planToLocal(u, v)));
  }
  if (spec.entrance.garden?.steps) {
    for (const st of spec.entrance.garden.steps) {
      exteriorSteps.push(st.poly.map(([u, v]) => planToLocal(u, v)));
    }
  }

  const entMain = spec.entrance.main;
  const entStart = planToLocal(entMain.plan[0] - 0.65, entMain.plan[1]);
  const entTip = planToLocal(entMain.plan[0] - 0.06, entMain.plan[1]);

  return {
    mode,
    floorShown: showRoof ? 'dach' : floorKey,
    footprintLocal: spec.footprint.cornersLocal,
    eaveCornersLocal: spec.roof.eaveCornersLocal,
    ridgeLocal: spec.roof.ridgeLocal,
    showRoof,
    walls: showRoof ? [] : wallPolys,
    openings: showRoof ? [] : openingLines,
    stairSteps: showRoof ? [] : stairSteps,
    splitStairSteps: showRoof ? [] : splitStairSteps,
    exteriorSteps,
    exteriorParts: exteriorSteps,
    stairOpening: showRoof ? null : stairOpening,
    rooms: showRoof
      ? []
      : level.rooms.map((r) => ({ name: r.name, areaM2: r.areaM2, at: planToLocal(r.labelAt[0], r.labelAt[1]) })),
    entranceArrow: { from: entStart, to: entTip, label: 'Eingang (Dautengasse)' },
    outerDims: {
      length: fmtM(spec.footprint.length),
      width: fmtM(spec.footprint.width),
      lengthAt: planToLocal(spec.footprint.length * 0.34, -0.24),
      widthAt: planToLocal(spec.footprint.length - 0.45, spec.footprint.width * 0.40),
    },
  };
}
