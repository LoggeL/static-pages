// Single Source of Truth für das 3D-Hausmodell, 2D-Grundrisse, Schnitte und Bemaßungen.
// Reines JavaScript OHNE Three.js-Import (bleibt leicht für den 2D-Start-Chunk!).
//
// Lokales Koordinatensystem (Y-up, Meter):
//   Ursprung (0, 0, 0) = Grundrissmitte auf y = 0,00 m (OKFF Erdgeschoss)
//   Lokal-X ∈ [-5,50 .. +5,50] = lange Hausachse 11,00 m [Vorgabe] (Skizze links u=0 -> -5,50, rechts u=11 -> +5,50)
//   Lokal-Z ∈ [-3,575 .. +3,575] = Hausbreite 7,15 m [Foto-Näherung] (Skizze oben v=0 -> -3,575, unten v=7,15 -> +3,575)
//   Lokal-Y = Höhe über OKFF EG in Metern
//
// Lagezuordnung auf Flurstück 214 (LVermGeo ALKIS EPSG:25832: Welt-+Z zeigt Richtung Dautengasse ~NO 58°,
// NICHT geografisch Süden! Drehung um +92,23° um +Y ohne Spiegelung der Skizze):
//   Skizze oben  (v = 0,     Lokal −Z) -> Grenzwand 215/3 (Welt −X): fensterlos, bündige Traufe (0,00 m Überstand)
//   Skizze unten (v = 7,15,  Lokal +Z) -> Hof/Kanal       (Welt +X): 0,45 m Traufüberstand + Nebeneingang
//   Skizze links (u = 0,     Lokal −X) -> Dautengasse     (Welt +Z): bündiger Ortgang (0,00 m), Split-Level-Haupteingang
//   Skizze rechts(u = 11,00, Lokal +X) -> Garten/Flst.215 (Welt −Z): bündiger Ortgang (0,00 m), 5 OG-Fenster + Gartentür
//
// Hinweis zu internen Schlüsseln: `side: 'west'|'east'|'south'|'north'` und `overhangWest/East/South/North`
// bleiben als stabile geometrische Achsenschlüssel für bestehende Consumer erhalten; alle sichtbaren
// Bezeichnungen verwenden ausschließlich Dautengasse, Garten, Hof/Kanal und Grenzwand 215/3.

const L = 11.0;        // [Vorgabe] exakt 11,00 m
const W = 7.15;        // [Foto-Näherung] aus entzerrter Skizze (OG 7,17 m, EG gleicher Maßstab 7,04 m, ±0,15 m)
const T_EXT = 0.365;   // [Entwurfsannahme / Foto-Näherung 0,35–0,40 m]
const T_INT_L = 0.175; // [Entwurfsannahme] Installations-/Tragwand innen
const T_INT_S = 0.115; // [Entwurfsannahme] leichte Trennwand innen

const EG_CLEAR = 2.7;
const EG_SLAB = 0.3;
const OKFF_OG = EG_CLEAR + EG_SLAB; // 3.00 m
const OG_CLEAR = 2.65;
const OG_SLAB = 0.25;
const EAVE_WALL_Y = OKFF_OG + OG_CLEAR + OG_SLAB; // 5.90 m (Wand-Traufpunkt / OK OG-Decke)

// Satteldach 35,0° (beidseits exakt gleich geneigt, First mittig bei v = W/2 = 3,575 m):
// Grenzwand 215/3 (v=0): bündig 0,00 m Überstand mit innenliegender Kastenrinne/Attika (KEIN Nachbarüberbau!)
// Hof/Kanal (v=7,15): regulärer 0,45 m Traufüberstand mit vorgehängter Rinne & Fallrohr
// Dautengasse (u=0) & Garten (u=11): bündiger Ortgang 0,00 m (KEIN Straßenüberbau / vor Baugrenze!)
const ROOF_PITCH_DEG = 35.0; // [Vorgabe B-Plan >= 30°] + [Entwurfsannahme 35,0°]
const ROOF_PITCH_RAD = (ROOF_PITCH_DEG * Math.PI) / 180;
const ROOF_THICK = 0.26;
const OVERHANG_WEST = 0.0;   // Grenzwand 215/3 (Lokal -Z): bündige Traufe (0,00 m)
const OVERHANG_EAST = 0.45;  // Hof/Kanal (Lokal +Z): regulärer Traufüberstand (0,45 m)
const OVERHANG_SOUTH = 0.0;  // Dautengasse (Lokal -X): bündiger Ortgang (0,00 m, kein Straßenüberbau)
const OVERHANG_NORTH = 0.0;  // Garten (Lokal +X): bündiger Ortgang (0,00 m)

const ROOF_VERT_THICK = ROOF_THICK / Math.cos(ROOF_PITCH_RAD); // 0.3174 m
const GABLE_TRI_H = (W / 2) * Math.tan(ROOF_PITCH_RAD);        // 2.503 m
const RIDGE_WALL_Y = EAVE_WALL_Y + GABLE_TRI_H;                // 8.403 m (Giebelwand-Spitze / UK Dach)
const RIDGE_TOP_Y = RIDGE_WALL_Y + ROOF_VERT_THICK;            // 8.720 m (First OK, Entwurfsannahme)
const RIDGE_CAP_RADIUS = 0.06;
const RIDGE_CAP_LIFT = 0.035;
const EAVE_BOUNDARY_TOP_Y = EAVE_WALL_Y + ROOF_VERT_THICK;     // 6.217 m (Dachkante / Attika-OK Grenzwand 215/3)
const EAVE_HOF_UNDER_Y = EAVE_WALL_Y - OVERHANG_EAST * Math.tan(ROOF_PITCH_RAD); // 5.585 m (Traufkante UK Hof/Kanal)
const EAVE_HOF_TOP_Y = EAVE_HOF_UNDER_Y + ROOF_VERT_THICK;     // 5.902 m (Dachkante OK Ziegel Hof/Kanal)

export function planToLocal(u, v) {
  return [+(u - L / 2).toFixed(4), +(v - W / 2).toFixed(4)];
}

export function localToPlan(x, z) {
  return [+(x + L / 2).toFixed(4), +(z + W / 2).toFixed(4)];
}

function rectToLocalBox(u0, v0, u1, v1, yBottom, yTop) {
  const [minX, minZ] = planToLocal(Math.min(u0, u1), Math.min(v0, v1));
  const [maxX, maxZ] = planToLocal(Math.max(u0, u1), Math.max(v0, v1));
  return {
    minX,
    maxX,
    minY: +yBottom.toFixed(4),
    maxY: +yTop.toFixed(4),
    minZ,
    maxZ,
  };
}

// ---------------------------------------------------------------------------
// Begehbare Eingänge für reale loadGround-Geländehöhen (0,00 m auf Straße/215/3)
// ---------------------------------------------------------------------------
function buildEntrances() {
  // 1) Haupteingang Dautengasse (Gelände ~ -1,50 m unter OKFF EG):
  //    [Entwurfsannahme: Split-Level-Eingang am Hang]
  //    Haustür bündig in Dautengasse-Außenwand (u=0..0,365, v=4,38..5,43) mit Schwelle auf y=-1,44 m
  //    (Δ ≈ 5–6 cm zur Straßenböschung, 0,00 m Überstand vor Fassade / 0,00 m auf Straßenfläche!),
  //    dahinter innenliegendes Eingangspodest (1,20 × 1,235 m auf y=-1,44 m) + gerader, voll begehbarer
  //    Innentreppe-Lauf (8 Steigungen × 18,0 cm = 1,44 m, 7 Auftritte × 26,5 cm = 1,855 m, 2s+a = 62,5 cm,
  //    Laufbreite licht 1,175 m ≥ 0,95 m, Kopfhöhe ≥ 2,20 m an Tür / 2,70 m über gesamtem Lauf) bis OKFF EG = 0,00 m.
  const mainDoorV0 = 4.38;
  const mainDoorV1 = 5.43; // Breite 1,05 m, Höhe 2,20 m (H/B = 2,10 >= 1,25)
  const mainDoorMidV = +((mainDoorV0 + mainDoorV1) / 2).toFixed(4); // 4.905
  const mainSillY = -1.44;
  const mainDoorH = 2.20;
  const mainPitV0 = 4.265;
  const mainPitV1 = 5.50;
  const mainLandingU0 = T_EXT;   // 0.365
  const mainLandingU1 = 1.565;   // Tiefe 1,20 m >= 1,00 m
  const mainRisers = 8;
  const mainRise = +(Math.abs(mainSillY) / mainRisers).toFixed(4); // 0.1800 m
  const mainTread = 0.265;       // 7 Auftritte × 0,265 m = 1,855 m
  const mainTreads = mainRisers - 1;
  const mainStairU0 = mainLandingU1; // 1.565
  const mainStairU1 = +(mainStairU0 + mainTreads * mainTread).toFixed(4); // 3.420

  const mainSteps = [];
  for (let i = 0; i < mainTreads; i++) {
    const u0 = +(mainStairU0 + i * mainTread).toFixed(4);
    const u1 = +(u0 + mainTread).toFixed(4);
    const yBottom = +(mainSillY + i * mainRise).toFixed(4);
    const yTop = +(mainSillY + (i + 1) * mainRise).toFixed(4);
    mainSteps.push({
      index: i + 1,
      u0,
      v0: mainPitV0,
      u1,
      v1: mainPitV1,
      yBottom,
      yTop,
      poly: [[u0, mainPitV0], [u1, mainPitV0], [u1, mainPitV1], [u0, mainPitV1]],
      localBox: rectToLocalBox(u0, mainPitV0, u1, mainPitV1, yBottom, yTop),
    });
  }

  const main = {
    openingId: 'T_haupt',
    side: 'south',
    siteSide: 'dautengasse',
    label: 'Haupteingang (Dautengasse · Split-Level-Eingang)',
    shortLabel: 'Split-Level-Eingang (8 Stg. innen)',
    accessSummary: 'Split-Level-Eingang (Entwurfsannahme): Schwelle −1,44 m bündig in Wandlaibung (0,00 m vor Fassade), Innenpodest 1,20 m + 8 Stg. à 18,0 cm bis OKFF EG',
    provenance: 'entwurf',
    provenanceTag: 'Entwurfsannahme: Split-Level-Eingang am Hang',
    recessed: false,
    splitLevel: true,
    plan: [0, mainDoorMidV],
    local: [planToLocal(0, mainDoorMidV)[0], mainSillY, planToLocal(0, mainDoorMidV)[1]],
    sampleLocal: [planToLocal(-0.15, mainDoorMidV)[0], 0, planToLocal(-0.15, mainDoorMidV)[1]],
    outwardLocal: [-1, 0, 0],
    width: +(mainDoorV1 - mainDoorV0).toFixed(3),
    height: mainDoorH,
    sillY: mainSillY,
    headY: +(mainSillY + mainDoorH).toFixed(3),
    // Exakte rechteckige Aussparung in der EG-Bodenplatte (y = -0,30..0,00 m)
    slabOpening: { u0: mainLandingU0, v0: mainPitV0, u1: mainStairU1, v1: mainPitV1 },
    // Exakte Tür-Aussparung im Hangsockel unterhalb OKFF EG (y = -1,44..0,00 m)
    plinthCutout: {
      u0: 0.0,
      v0: mainDoorV0,
      u1: T_EXT,
      v1: mainDoorV1,
      yBottom: mainSillY,
      yTop: 0.0,
      localBox: rectToLocalBox(0.0, mainDoorV0, T_EXT, mainDoorV1, mainSillY, 0.0),
    },
    // Bündige bodennahe Eingangsschwelle innerhalb der 0,365-m-Wandlaibung (0,00 m Überstand!)
    thresholdStep: {
      u0: 0.0,
      v0: mainDoorV0,
      u1: T_EXT,
      v1: mainDoorV1,
      yBottom: -1.58,
      yTop: mainSillY,
      protrusionM: 0.0,
      localBox: rectToLocalBox(0.0, mainDoorV0, T_EXT, mainDoorV1, -1.58, mainSillY),
    },
    landing: {
      u0: mainLandingU0,
      v0: mainPitV0,
      u1: mainLandingU1,
      v1: mainPitV1,
      yBottom: +(mainSillY - 0.30).toFixed(3),
      yTop: mainSillY,
      depthM: +(mainLandingU1 - mainLandingU0).toFixed(3),
      widthM: +(mainPitV1 - mainPitV0).toFixed(3),
      localBox: rectToLocalBox(mainLandingU0, mainPitV0, mainLandingU1, mainPitV1, mainSillY - 0.30, mainSillY),
    },
    stair: {
      direction: '+u',
      box: {
        u0: mainStairU0,
        v0: mainPitV0,
        u1: mainStairU1,
        v1: mainPitV1,
        runM: +(mainStairU1 - mainStairU0).toFixed(3),
        widthM: +(mainPitV1 - mainPitV0).toFixed(3),
        clearWidthM: +(mainPitV1 - mainPitV0 - 0.06).toFixed(3), // 1,175 m >= 0,95 m
      },
      risers: mainRisers,
      treads: mainTreads,
      riseM: mainRise,
      treadM: mainTread,
      stepFormulaM: +(2 * mainRise + mainTread).toFixed(4), // 0.625 m (DIN 18065: 0.59–0.65 m)
      dinOk: true,
      minHeadroomDoorM: mainDoorH,
      minHeadroomStairM: +EG_CLEAR.toFixed(2),
      minHeadroomM: mainDoorH, // 2,20 m >= 2,00 m (über gesamtem Lauf 2,70 m!)
      walkLine: [[(mainLandingU0 + mainLandingU1) / 2, mainDoorMidV], [mainStairU0, mainDoorMidV], [mainStairU1, mainDoorMidV]],
      steps: mainSteps,
    },
    // Umschließende Innen-Sockelwände (y = -1,44..0,00 m) rund um Eingangspodest & Innentreppe
    enclosingWalls: [
      { id: 'split_wall_wc',   u0: T_EXT,       v0: 4.15,      u1: mainStairU1, v1: mainPitV0, yBottom: mainSillY, yTop: 0.0 },
      { id: 'split_wall_hof',  u0: T_EXT,       v0: mainPitV1, u1: mainStairU1, v1: +(mainPitV1 + T_INT_S).toFixed(3), yBottom: mainSillY, yTop: 0.0 },
      { id: 'split_wall_back', u0: mainStairU1, v0: mainPitV0, u1: +(mainStairU1 + T_INT_S).toFixed(3), v1: mainPitV1, yBottom: mainSillY, yTop: 0.0 },
    ],
    railingHeightM: 1.0,
    railingSegments: [
      { id: 'split_rail_hof', u0: T_EXT,       v0: mainPitV1, y0: 0.0,       u1: mainStairU1, v1: mainPitV1, y1: 0.0, heightM: 1.0, kind: 'level-guardrail' },
      { id: 'split_rail_wc',  u0: 2.215,       v0: mainPitV0, y0: 0.0,       u1: mainStairU1, v1: mainPitV0, y1: 0.0, heightM: 1.0, kind: 'level-guardrail' },
      { id: 'split_handrail', u0: mainStairU0, v0: +(mainPitV1 - 0.05).toFixed(3), y0: mainSillY, u1: mainStairU1, v1: +(mainPitV1 - 0.05).toFixed(3), y1: 0.0, heightM: 0.9, kind: 'sloped-handrail' },
    ],
    exteriorFootprintPlan: [], // 0,00 m vor Dautengasse-Außenwand!
  };

  // 2) Nebeneingang Hof/Kanal (Gelände ~ -1,27 m unter OKFF EG):
  //    Außenpodest 1,05 × 1,05 m (y = 0,00 m) + paralleler Treppenlauf entlang Hof/Kanal Richtung Dautengasse (-u):
  //    7 Steigungen × 18,14 cm = 1,27 m, 6 Auftritte × 27,0 cm = 1,62 m, 2s+a = 63,3 cm ∈ DIN, Geländer 1,00 m.
  //    100 % innerhalb Flurstück 214 (dHof >= 1,59 m, dDautengasse >= 0,83 m, 0,00 m auf Straße).
  const sideLandU0 = 2.15;
  const sideLandU1 = 3.20; // 1,05 m entlang Wand (T_ost liegt bei u = 2,20..3,15)
  const sideV0 = W;        // 7.15
  const sideV1 = +(W + 1.05).toFixed(3); // 8.20 (Tiefe 1,05 m)
  const sideRisers = 7;
  const sideTreads = 6;
  const sideDrop = 1.27;
  const sideRise = +(sideDrop / sideRisers).toFixed(4); // 0.1814 m
  const sideTread = 0.27;
  const sideStairU0 = +(sideLandU0 - sideTreads * sideTread).toFixed(4); // 0.5300 m
  const sideStairU1 = sideLandU0; // 2.1500 m
  const sidePadU0 = 0.18;  // bodenbündige Antrittsplatte (0,35 m) zum Übergang ins Hofgelände

  const sideSteps = [];
  for (let i = 0; i < sideTreads; i++) {
    // Aufsteigend von u = 0,53 (unten) Richtung u = 2,15 (Podest y = 0,00 m)
    const u0 = +(sideStairU0 + i * sideTread).toFixed(4);
    const u1 = +(u0 + sideTread).toFixed(4);
    const yTop = +(-sideDrop + (i + 1) * sideRise).toFixed(4);
    const yBottom = +(-sideDrop + i * sideRise).toFixed(4);
    sideSteps.push({
      index: i + 1,
      u0,
      v0: sideV0,
      u1,
      v1: sideV1,
      yBottom,
      yTop,
      poly: [[u0, sideV0], [u1, sideV0], [u1, sideV1], [u0, sideV1]],
      localBox: rectToLocalBox(u0, sideV0, u1, sideV1, yBottom, yTop),
    });
  }

  const side = {
    openingId: 'T_ost',
    side: 'east',
    siteSide: 'hof',
    label: 'Nebeneingang (Hof/Kanal · Podest & Außentreppe)',
    shortLabel: 'Podest 1,05×1,05 m + 7 Stg. parallel',
    accessSummary: 'Außenpodest 1,05 × 1,05 m + paralleler Treppenlauf (7 Stg. à 18,1 cm, 6 Auftr. à 27,0 cm, Geländer 1,00 m), 100 % in Flst. 214',
    provenance: 'entwurf',
    recessed: false,
    plan: [2.675, W],
    local: [planToLocal(2.675, W)[0], 0, planToLocal(2.675, W)[1]],
    sampleLocal: [planToLocal(2.675, W + 0.65)[0], 0, planToLocal(2.675, W + 0.65)[1]],
    outwardLocal: [0, 0, 1],
    width: 0.95,
    height: 2.2,
    sillY: 0.0,
    headY: 2.2,
    landing: {
      u0: sideLandU0,
      v0: sideV0,
      u1: sideLandU1,
      v1: sideV1,
      yBottom: -0.22,
      yTop: 0.0,
      lengthM: +(sideLandU1 - sideLandU0).toFixed(3),
      depthM: +(sideV1 - sideV0).toFixed(3),
      poly: [[sideLandU0, sideV0], [sideLandU1, sideV0], [sideLandU1, sideV1], [sideLandU0, sideV1]],
      localBox: rectToLocalBox(sideLandU0, sideV0, sideLandU1, sideV1, -0.22, 0.0),
    },
    stair: {
      direction: '-u',
      box: {
        u0: sideStairU0,
        v0: sideV0,
        u1: sideStairU1,
        v1: sideV1,
        runM: +(sideStairU1 - sideStairU0).toFixed(3),
        widthM: +(sideV1 - sideV0).toFixed(3),
        clearWidthM: +(sideV1 - sideV0 - 0.07).toFixed(3), // 0,98 m >= 0,95 m
      },
      risers: sideRisers,
      treads: sideTreads,
      riseM: sideRise,
      treadM: sideTread,
      stepFormulaM: +(2 * sideRise + sideTread).toFixed(4), // 0.6328 m ∈ [0.59; 0.65]
      dinOk: true,
      bottomY: -sideDrop,
      bottomPad: {
        u0: sidePadU0,
        v0: sideV0,
        u1: sideStairU0,
        v1: sideV1,
        yBottom: -1.65,
        yTop: -sideDrop,
        poly: [[sidePadU0, sideV0], [sideStairU0, sideV0], [sideStairU0, sideV1], [sidePadU0, sideV1]],
        localBox: rectToLocalBox(sidePadU0, sideV0, sideStairU0, sideV1, -1.65, -sideDrop),
      },
      steps: sideSteps,
    },
    railingHeightM: 1.0,
    railingSegments: [
      { id: 'hof_rail_back',    u0: +(sideLandU1 - 0.03).toFixed(3), v0: sideV0,                     y0: 0.0,       u1: +(sideLandU1 - 0.03).toFixed(3), v1: +(sideV1 - 0.03).toFixed(3), y1: 0.0, heightM: 1.0, kind: 'level-guardrail' },
      { id: 'hof_rail_landing', u0: sideLandU0,                      v0: +(sideV1 - 0.03).toFixed(3), y0: 0.0,       u1: +(sideLandU1 - 0.03).toFixed(3), v1: +(sideV1 - 0.03).toFixed(3), y1: 0.0, heightM: 1.0, kind: 'level-guardrail' },
      { id: 'hof_rail_flight',  u0: sideStairU0,                     v0: +(sideV1 - 0.03).toFixed(3), y0: -sideDrop, u1: sideLandU0,                      v1: +(sideV1 - 0.03).toFixed(3), y1: 0.0, heightM: 1.0, kind: 'sloped-guardrail' },
    ],
    exteriorFootprintPlan: [[sidePadU0, sideV0], [sideLandU1, sideV0], [sideLandU1, sideV1], [sidePadU0, sideV1]],
    exteriorFootprintLocal: [
      planToLocal(sidePadU0, sideV0),
      planToLocal(sideLandU1, sideV0),
      planToLocal(sideLandU1, sideV1),
      planToLocal(sidePadU0, sideV1),
    ],
    sewerNote: 'Liegt im Hof/Kanal-Streifen (100 % innerhalb Flurstück 214), jedoch über dem DN250-Schutzstreifen – Konflikt offen im Lageplan dokumentiert.',
  };

  // 3) Gartentür Garten (Gelände ~ -0,15 m unter OKFF EG):
  //    1 Gartenstufe (0,30 m tief × 1,05 m breit, Δ ≈ 0,15 m), 100 % innerhalb Flurstück 214 UND vor der Baugrenze!
  const gStepU0 = L;
  const gStepU1 = +(L + 0.30).toFixed(3); // 11.30 (bleibt an allen 4 Ecken vor der blauen Baugrenze!)
  const gStepV0 = 1.975;
  const gStepV1 = 3.025; // Breite 1,05 m (Tür T_terr bei v = 2,025..2,975)
  const gardenStep = {
    index: 1,
    u0: gStepU0,
    v0: gStepV0,
    u1: gStepU1,
    v1: gStepV1,
    yBottom: -0.35,
    yTop: -0.02,
    riseM: 0.148,
    treadM: 0.30,
    poly: [[gStepU0, gStepV0], [gStepU1, gStepV0], [gStepU1, gStepV1], [gStepU0, gStepV1]],
    localBox: rectToLocalBox(gStepU0, gStepV0, gStepU1, gStepV1, -0.35, -0.02),
  };

  const garden = {
    openingId: 'T_terr',
    side: 'north',
    siteSide: 'garten',
    label: 'Gartentür (Garten · 1 Gartenstufe)',
    shortLabel: '1 Gartenstufe (~0,15 m)',
    accessSummary: '1 Gartenstufe (0,30 × 1,05 m, Δ ≈ 0,15 m), im eingepassten Plan rund 2 cm vor der Baugrenze (Lagegenauigkeit etwa ±0,5 m)',
    provenance: 'entwurf',
    recessed: false,
    plan: [L, 2.50],
    local: [planToLocal(L, 2.50)[0], 0, planToLocal(L, 2.50)[1]],
    sampleLocal: [planToLocal(L + 0.30, 2.50)[0], 0, planToLocal(L + 0.30, 2.50)[1]],
    outwardLocal: [1, 0, 0],
    width: 0.95,
    height: 2.2,
    sillY: 0.0,
    headY: 2.2,
    steps: [gardenStep],
    exteriorFootprintPlan: gardenStep.poly,
    exteriorFootprintLocal: gardenStep.poly.map(([u, v]) => planToLocal(u, v)),
  };

  return { main, side, garden, terrace: garden };
}

// Exakte 17-Steigungen / 16-Auftritte halbgewendelte U-Treppe im Eckkern Garten / Hof-Kanal
function buildUStairSteps() {
  const u0 = 8.15, u1 = 10.635, v0 = 4.40, v1 = 6.785;
  const spU0 = 9.31, spU1 = 9.475; // Spindel / Auge (0,165 m)
  const pivotU = (spU0 + spU1) / 2; // 9.3925
  const pivotV = 5.72;
  const risers = 17;
  const rise = OKFF_OG / risers;
  const straightN = 5;
  const treadStraight = (pivotV - v0) / straightN; // 0.264 m
  const steps = [];

  // 1..5: Antrittslauf (Gartenseite bei v0=4,40 -> Richtung Hof/Kanal +v)
  for (let i = 0; i < straightN; i++) {
    const a = v0 + i * treadStraight;
    const b = a + treadStraight;
    steps.push({
      index: i + 1,
      flight: 'right',
      yBottom: +(i * rise).toFixed(4),
      yTop: +((i + 1) * rise).toFixed(4),
      poly: [[spU1, a], [u1, a], [u1, b], [spU1, b]],
    });
  }

  const rayToBox = (angRad) => {
    const du = Math.cos(angRad);
    const dv = Math.sin(angRad);
    const ts = [];
    if (du > 1e-6) ts.push((u1 - pivotU) / du);
    if (du < -1e-6) ts.push((u0 - pivotU) / du);
    if (dv > 1e-6) ts.push((v1 - pivotV) / dv);
    const t = Math.min(...ts.filter((x) => x > 0));
    return [+(pivotU + t * du).toFixed(4), +(pivotV + t * dv).toFixed(4)];
  };

  // 6..11: 6 gewendelte Stufen über 180°
  const winderN = 6;
  const cBR = [u1, v1];
  const cBL = [u0, v1];
  const angBR = Math.atan2(v1 - pivotV, u1 - pivotU);
  const angBL = Math.atan2(v1 - pivotV, u0 - pivotU);
  for (let i = 0; i < winderN; i++) {
    const a0 = (i * Math.PI) / winderN;
    const a1 = ((i + 1) * Math.PI) / winderN;
    const p0 = rayToBox(a0);
    const p1 = rayToBox(a1);
    const poly = [[+pivotU.toFixed(4), +pivotV.toFixed(4)], p0];
    if (a0 < angBR && angBR < a1) poly.push(cBR);
    if (a0 < angBL && angBL < a1) poly.push(cBL);
    poly.push(p1);
    const idx = straightN + i + 1;
    steps.push({
      index: idx,
      flight: 'winder',
      yBottom: +((idx - 1) * rise).toFixed(4),
      yTop: +(idx * rise).toFixed(4),
      poly,
    });
  }

  // 12..16: Austrittslauf (Richtung −v -> Austritt OG bei v0=4,40)
  for (let i = 0; i < straightN; i++) {
    const a = pivotV - i * treadStraight;
    const b = a - treadStraight;
    const idx = straightN + winderN + i + 1;
    steps.push({
      index: idx,
      flight: 'left',
      yBottom: +((idx - 1) * rise).toFixed(4),
      yTop: +(idx * rise).toFixed(4),
      poly: [[u0, a], [spU0, a], [spU0, b], [u0, b]],
    });
  }

  const rWalk = 0.56;
  const walkRightU = +(spU1 + (u1 - spU1) * 0.5).toFixed(3);
  const walkLeftU = +(u0 + (spU0 - u0) * 0.5).toFixed(3);
  const walkLine = [[walkRightU, v0], [walkRightU, pivotV]];
  for (let k = 1; k < 12; k++) {
    const a = (k * Math.PI) / 12;
    walkLine.push([+(pivotU + rWalk * Math.cos(a)).toFixed(3), +(pivotV + rWalk * Math.sin(a)).toFixed(3)]);
  }
  walkLine.push([walkLeftU, pivotV], [walkLeftU, v0]);

  const treadWinder = +(rWalk * (Math.PI / winderN)).toFixed(4);
  const treadMean = +((10 * treadStraight + 6 * treadWinder) / 16).toFixed(4);
  const openingAreaM2 = +((u1 - u0) * (v1 - v0)).toFixed(2); // 5.93 m²

  return {
    type: 'u-winder',
    provenance: 'interpretation',
    label: 'Halbgewendelte U-Treppe EG ↔ OG',
    box: { u0, v0, u1, v1, width: +(u1 - u0).toFixed(3), depth: +(v1 - v0).toFixed(3) },
    spindle: { u0: spU0, u1: spU1, v0, v1: pivotV, pivot: [pivotU, pivotV] },
    slabOpening: { u0, v0, u1, v1, areaM2: openingAreaM2 },
    risers,
    treads: steps.length,
    riseM: +rise.toFixed(4),
    treadStraightM: +treadStraight.toFixed(4),
    treadWinderM: treadWinder,
    treadMeanM: treadMean,
    stepFormulaM: +(2 * rise + treadMean).toFixed(4), // 0.624 m (DIN 18065: 0.59–0.65 m)
    clearWidthM: +(u1 - spU1).toFixed(3),
    minHeadroomM: +EG_CLEAR.toFixed(2),
    railingHeightM: 1.0,
    railingSegments: [
      { u0: 8.09, v0: 4.40, u1: 8.09, v1: 6.785, kind: 'parapet-rail' }, // Seite Wohnbereich (u=8,09)
      { u0: spU0, v0: 4.40, u1: u1,   v1: 4.40,  kind: 'open-rail' },    // Seite über Antritt (Austritt u0..spU0 bleibt offen!)
    ],
    walkLine,
    steps,
  };
}

// Außenwände (ohne Eck-Überlappung: Grenzwand 215/3 & Hof/Kanal volle Länge 0..11,00; Dautengasse & Garten dazwischen)
function makeOuterWalls(prefix) {
  return [
    { id: `${prefix}_ext_west`,  side: 'west',  siteSide: 'grenzwand',   ext: true, axis: 'u', u0: 0,         v0: 0,         u1: L,     v1: T_EXT },
    { id: `${prefix}_ext_east`,  side: 'east',  siteSide: 'hof',         ext: true, axis: 'u', u0: 0,         v0: W - T_EXT, u1: L,     v1: W },
    { id: `${prefix}_ext_south`, side: 'south', siteSide: 'dautengasse', ext: true, axis: 'v', u0: 0,         v0: T_EXT,     u1: T_EXT, v1: W - T_EXT },
    { id: `${prefix}_ext_north`, side: 'north', siteSide: 'garten',      ext: true, axis: 'v', u0: L - T_EXT, v0: T_EXT,     u1: L,     v1: W - T_EXT },
  ];
}

// EG-Wände (unten im Foto) – sauber abgestimmt auf Split-Level-Haupteingang ohne WC/HWR-Blockade
const EG_WALLS = [
  ...makeOuterWalls('eg'),
  { id: 'eg_hwr_east',   ext: false, axis: 'v', u0: 3.25,  v0: T_EXT, u1: 3.25 + T_INT_L, v1: 3.10 },
  { id: 'eg_hwr_south',  ext: false, axis: 'u', u0: T_EXT, v0: 2.985, u1: 3.25,           v1: 3.10 },
  { id: 'eg_wc_east',    ext: false, axis: 'v', u0: 2.10,  v0: 3.10,  u1: 2.10 + T_INT_S, v1: 4.15 },
  { id: 'eg_wc_south',   ext: false, axis: 'u', u0: T_EXT, v0: 4.15,  u1: 2.10 + T_INT_S, v1: 4.265 },
  { id: 'eg_entry_stub', ext: false, axis: 'v', u0: 3.25,  v0: 6.50,  u1: 3.25 + T_INT_L, v1: W - T_EXT },
  { id: 'eg_stair_west', ext: false, axis: 'v', u0: 8.035, v0: 4.40,  u1: 8.15,           v1: W - T_EXT },
];

// OG-Wände (oben im Foto) – statisch & haustechnisch über EG-Wänden gestapelt
const OG_WALLS = [
  ...makeOuterWalls('og'),
  { id: 'og_bath_east',  ext: false, axis: 'v', u0: 3.25,  v0: T_EXT, u1: 3.25 + T_INT_L, v1: 3.10 },
  { id: 'og_bath_south', ext: false, axis: 'u', u0: T_EXT, v0: 2.985, u1: 3.25,           v1: 3.10 },
  { id: 'og_wc_east',    ext: false, axis: 'v', u0: 2.10,  v0: 3.10,  u1: 2.10 + T_INT_S, v1: 4.15 },
  { id: 'og_room_north', ext: false, axis: 'u', u0: T_EXT, v0: 4.15,  u1: 3.25,           v1: 4.265 },
  { id: 'og_room_east',  ext: false, axis: 'v', u0: 3.25,  v0: 4.15,  u1: 3.25 + T_INT_L, v1: W - T_EXT },
];

const ENTRANCES = buildEntrances();

// Öffnungen (Türen & Fenster) – JEDE Außenöffnung im Hochformat H/B >= 1,25 (B-Plan Wattenheim „Ortskern“)
const EG_OPENINGS = [
  // Giebel Dautengasse (u = 0)
  { id: 'F_eg_s1',  wallId: 'eg_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 1.35, s1: 2.15, sillY: 0.95,  height: 1.25, label: 'Fenster HWR (Dautengasse)', provenance: 'entwurf' },
  { id: 'F_eg_s2',  wallId: 'eg_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 3.30, s1: 3.95, sillY: 1.15,  height: 1.05, label: 'Fenster WC EG (Dautengasse)', provenance: 'foto' },
  { id: 'T_haupt',  wallId: 'eg_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'door',   s0: 4.38, s1: 5.43, sillY: -1.44, height: 2.20, swing: 'in-left', mainEntrance: true, splitLevel: true, label: 'Haupteingang (Dautengasse · Split-Level)', provenance: 'entwurf' },
  // Längswand Hof/Kanal (v = 7,15)
  { id: 'T_ost',    wallId: 'eg_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'door',   s0: 2.20, s1: 3.15, sillY: 0.00,  height: 2.20, swing: 'in-right', sideEntrance: true, label: 'Nebeneingang (Hof/Kanal)', provenance: 'foto' },
  { id: 'F_eg_o1',  wallId: 'eg_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'window', s0: 4.45, s1: 5.35, sillY: 0.90,  height: 1.35, label: 'Fenster EG Hof/Kanal 1', provenance: 'entwurf' },
  { id: 'F_eg_o2',  wallId: 'eg_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'window', s0: 6.30, s1: 7.20, sillY: 0.90,  height: 1.35, label: 'Fenster EG Hof/Kanal 2', provenance: 'entwurf' },
  // Giebel Garten / Flurstück 215 (u = 11,00)
  { id: 'F_eg_n1',  wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 0.80,  s1: 1.68,  sillY: 0.90, height: 1.35, label: 'Fenster EG Garten 1', provenance: 'entwurf' },
  { id: 'T_terr',   wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'door',   s0: 2.025, s1: 2.975, sillY: 0.00, height: 2.20, swing: 'in-left', glazed: true, gardenEntrance: true, label: 'Gartentür (Garten)', provenance: 'entwurf' },
  { id: 'F_eg_n2',  wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 3.32,  s1: 4.20,  sillY: 0.90, height: 1.35, label: 'Fenster EG Garten 2', provenance: 'entwurf' },
  { id: 'F_eg_n3',  wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 4.58,  s1: 5.40,  sillY: 1.00, height: 1.35, label: 'Fenster Treppe EG (Garten)', provenance: 'entwurf' },
  // Innentüren EG
  { id: 'T_eg_hwr', wallId: 'eg_hwr_east',  kind: 'interior-door', s0: 1.90, s1: 2.785, sillY: 0.00, height: 2.10, swing: 'in-neg', label: 'Tür HWR', provenance: 'entwurf' },
  { id: 'T_eg_wc',  wallId: 'eg_wc_east',   kind: 'interior-door', s0: 3.26, s1: 4.02,  sillY: 0.00, height: 2.10, swing: 'in-neg', label: 'Tür WC EG', provenance: 'foto' },
];

const OG_OPENINGS = [
  // Giebel Dautengasse (u = 0) – exakt 3 Fenster wie in OG-Skizze
  { id: 'F_og_s1',  wallId: 'og_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 1.35, s1: 2.15, sillY: 0.95, height: 1.25, label: 'Fenster Bad (Dautengasse)', provenance: 'foto' },
  { id: 'F_og_s2',  wallId: 'og_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 3.30, s1: 3.95, sillY: 1.15, height: 1.05, label: 'Fenster WC OG (Dautengasse)', provenance: 'foto' },
  { id: 'F_og_s3',  wallId: 'og_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 5.15, s1: 5.95, sillY: 0.95, height: 1.25, label: 'Fenster Zimmer OG (Dautengasse)', provenance: 'foto' },
  // Längswand Hof/Kanal (v = 7,15) – exakt 1 Fenster wie in OG-Skizze
  { id: 'F_og_o1',  wallId: 'og_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'window', s0: 4.45, s1: 5.35, sillY: 0.90, height: 1.35, label: 'Fenster OG Hof/Kanal', provenance: 'foto' },
  // Giebel Garten (u = 11,00) – exakt 5 diskrete Hochformatfenster mit Pfeilern >= 0,36 m
  { id: 'F_og_n1',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 0.80, s1: 1.68, sillY: 0.90, height: 1.35, label: 'Fenster Wohnen 1 (Garten)', provenance: 'foto' },
  { id: 'F_og_n2',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 2.06, s1: 2.94, sillY: 0.90, height: 1.35, label: 'Fenster Wohnen 2 (Garten)', provenance: 'foto' },
  { id: 'F_og_n3',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 3.32, s1: 4.20, sillY: 0.90, height: 1.35, label: 'Fenster Wohnen 3 (Garten)', provenance: 'foto' },
  { id: 'F_og_n4',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 4.58, s1: 5.40, sillY: 0.90, height: 1.35, label: 'Fenster Treppe OG 1 (Garten)', provenance: 'foto' },
  { id: 'F_og_n5',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 5.76, s1: 6.58, sillY: 0.90, height: 1.35, label: 'Fenster Treppe OG 2 (Garten)', provenance: 'foto' },
  // Innentüren OG
  { id: 'T_og_bath', wallId: 'og_bath_south', kind: 'interior-door', s0: 2.30, s1: 3.15, sillY: 0.00, height: 2.10, swing: 'in-neg', label: 'Tür Bad', provenance: 'foto' },
  { id: 'T_og_wc',   wallId: 'og_wc_east',    kind: 'interior-door', s0: 3.26, s1: 4.02, sillY: 0.00, height: 2.10, swing: 'in-neg', label: 'Tür WC OG', provenance: 'foto' },
  { id: 'T_og_room', wallId: 'og_room_north', kind: 'interior-door', s0: 2.30, s1: 3.15, sillY: 0.00, height: 2.10, swing: 'in-pos', label: 'Tür Zimmer OG', provenance: 'foto' },
];

// Spitzboden-Giebelfenster (je 1 zentriertes Hochformatfenster in den Giebeln Dautengasse und Garten)
const GABLE_OPENINGS = [
  { id: 'F_dg_s1', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 3.20, s1: 3.95, sillY: 0.35, height: 1.05, absSillY: EAVE_WALL_Y + 0.35, label: 'Giebelfenster Dautengasse', provenance: 'entwurf' },
  { id: 'F_dg_n1', side: 'north', siteSide: 'garten',      kind: 'window', s0: 3.20, s1: 3.95, sillY: 0.35, height: 1.05, absSillY: EAVE_WALL_Y + 0.35, label: 'Giebelfenster Garten', provenance: 'entwurf' },
];

function makeRoom(id, name, rects, labelAt, provenance, note = '', extra = {}) {
  const areaM2 = +rects.reduce((s, [u0, v0, u1, v1]) => s + (u1 - u0) * (v1 - v0), 0).toFixed(2);
  return { id, name, rects, labelAt, areaM2, provenance, note, ...extra };
}

const EG_ROOMS = [
  makeRoom('eg_hwr',     'HWR / Technik',       [[T_EXT, T_EXT, 3.25, 2.985]], [1.80, 1.65], 'foto', 'Handschrift „HWR“ in EG-Skizze; direkt unter OG-Bad'),
  makeRoom('eg_wc',      'WC',                  [[T_EXT, 3.10, 2.10, 4.15]],   [1.22, 3.62], 'foto', 'Deckungsgleich unter OG-WC'),
  makeRoom('eg_eingang', 'Split-Level Eingang', [[T_EXT, 4.265, 1.565, 5.50], [1.565, 4.265, 3.420, 5.50]], [0.96, 4.88], 'entwurf', 'Entwurfsannahme am Hang: Innenpodest auf −1,44 m + 8-stufiger Treppenlauf bis OKFF EG (0,00 m auf Straßenfläche)'),
  makeRoom('eg_diele',   'Diele / Hofzugang',   [[T_EXT, 5.50, 3.25, W - T_EXT], [2.215, 3.10, 3.25, 4.265]], [2.52, 6.14], 'foto', 'Verbindung Nebeneingang (Hof/Kanal), Garderobe, WC & offene EG-Fläche'),
  makeRoom('eg_halle',   'Offener Bereich EG',  [[3.425, T_EXT, L - T_EXT, 4.40], [3.425, 4.40, 8.035, W - T_EXT]], [6.40, 2.60], 'foto', 'Große offene Innenfläche laut EG-Skizze (Entwurf, keine WoFlV-Berechnung)'),
  makeRoom('eg_treppe',  'Treppe',              [[8.15, 4.40, L - T_EXT, W - T_EXT]], [9.40, 5.60], 'interpretation', 'Zusammengeführte U-Treppe EG ↔ OG'),
];

const OG_ROOMS = [
  makeRoom('og_bad',    'Bad',                    [[T_EXT, T_EXT, 3.25, 2.985]], [1.75, 1.85], 'foto', 'Dusche, Schrank/G, Sanitär laut OG-Skizze'),
  makeRoom('og_wc',     'WC',                     [[T_EXT, 3.10, 2.10, 4.15]],   [1.22, 3.62], 'foto', 'Separates WC + Handwaschbecken'),
  makeRoom('og_flur',   'Flur',                   [[2.215, 3.10, 3.35, 4.15]],   [2.78, 3.62], 'foto', 'Verteiler Bad / WC / Zimmer'),
  makeRoom('og_zimmer', 'Zimmer',                 [[T_EXT, 4.265, 3.25, W - T_EXT]], [1.80, 5.55], 'foto', 'Arbeits-/Gästezimmer (Skizzenmotiv an Hof/Kanal-Kante nicht als Treppe ausgeführt)'),
  makeRoom('og_wohnen', 'Wohnen / Essen / Küche', [[3.425, T_EXT, L - T_EXT, 4.40], [3.425, 4.40, 8.035, W - T_EXT]], [6.30, 2.45], 'foto', '2-teilige Küchenzeile (Spülmasch./Spüle | Kühlschr./Herd/Backofen), Sitzecke & Wohnlandschaft'),
  makeRoom('og_treppe', 'Treppenloch',            [[8.15, 4.40, L - T_EXT, W - T_EXT]], [9.40, 5.60], 'interpretation', 'Offenes Treppenloch 2,49 × 2,39 m (5,93 m²) – aus OG-Innenfläche herausgerechnet', { isOpening: true }),
];

// Mobiliar (sämtliche EG-Möbel auf y = 0,00 m und frei von Split-Level-Ausschnitt & Türschwenkbereichen!)
const EG_FURNITURE = [
  { id: 'eg_wm',      kind: 'appliance', label: 'WM / TR',   u0: 0.42, v0: 0.42, u1: 1.65, v1: 1.05, h: 0.85 },
  { id: 'eg_wp',      kind: 'cabinet',   label: 'Technik',   u0: 1.80, v0: 0.42, u1: 3.18, v1: 1.08, h: 1.95 },
  { id: 'eg_regal',   kind: 'shelf',     label: 'Regal',     u0: 0.42, v0: 2.50, u1: 2.95, v1: 2.94, h: 1.80 },
  { id: 'eg_wc_pan',  kind: 'wc',        label: 'WC',        u0: 0.40, v0: 3.45, u1: 0.96, v1: 3.85, h: 0.42 },
  { id: 'eg_wc_sink', kind: 'sink',      label: 'WB',        u0: 1.38, v0: 3.12, u1: 1.82, v1: 3.46, h: 0.84 },
  { id: 'eg_gard',    kind: 'cabinet',   label: 'Garderobe', u0: 0.45, v0: 6.22, u1: 1.85, v1: 6.74, h: 2.00 },
  { id: 'eg_table',   kind: 'table',     label: 'Tisch',     u0: 5.20, v0: 1.85, u1: 7.40, v1: 2.85, h: 0.76 },
  { id: 'eg_sideb',   kind: 'cabinet',   label: 'Sideboard', u0: 4.20, v0: 0.42, u1: 7.20, v1: 0.90, h: 0.85 },
  { id: 'eg_bench',   kind: 'table',     label: 'Arbeiten',  u0: 8.60, v0: 0.42, u1: 10.55, v1: 1.15, h: 0.78 },
];

const OG_FURNITURE = [
  { id: 'og_g_box',    kind: 'cabinet',      label: 'G',              u0: 0.40, v0: 0.40, u1: 1.22, v1: 1.18, h: 1.95 },
  { id: 'og_bad_sch',  kind: 'cabinet',      label: 'Schrank',        u0: 1.25, v0: 0.40, u1: 2.10, v1: 1.18, h: 0.90 },
  { id: 'og_dusche',   kind: 'shower',       label: 'Dusche',         u0: 2.14, v0: 0.38, u1: 3.23, v1: 1.46, h: 2.05 },
  { id: 'og_bad_wb1',  kind: 'sink',         label: 'WT',             u0: 0.40, v0: 1.48, u1: 0.88, v1: 2.02, h: 0.85 },
  { id: 'og_bad_wc',   kind: 'wc',           label: 'WC',             u0: 0.40, v0: 2.26, u1: 0.96, v1: 2.66, h: 0.42 },
  { id: 'og_bad_wb2',  kind: 'sink',         label: 'WT',             u0: 1.35, v0: 2.54, u1: 1.92, v1: 2.96, h: 0.85 },
  { id: 'og_wc_pan',   kind: 'wc',           label: 'WC',             u0: 0.40, v0: 3.45, u1: 0.96, v1: 3.85, h: 0.42 },
  { id: 'og_wc_sink',  kind: 'sink',         label: 'WB',             u0: 1.38, v0: 3.12, u1: 1.82, v1: 3.46, h: 0.84 },
  { id: 'og_desk',     kind: 'bed-desk',     label: 'Tisch/Bett',     u0: 0.40, v0: 4.30, u1: 2.25, v1: 5.18, h: 0.75 },
  { id: 'og_lowb',     kind: 'shelf',        label: 'Stauraum',       u0: 0.42, v0: 6.20, u1: 3.18, v1: 6.74, h: 0.95 },
  { id: 'og_k_spuelm', kind: 'kitchen',      label: 'Spülmasch.',     u0: 3.43, v0: 0.38, u1: 4.10, v1: 1.24, h: 0.90 },
  { id: 'og_k_spuele', kind: 'kitchen-sink', label: 'Spüle',          u0: 3.43, v0: 1.24, u1: 4.10, v1: 2.12, h: 0.90 },
  { id: 'og_k_arbp',   kind: 'kitchen',      label: 'Arbeitsfl.',     u0: 3.43, v0: 2.12, u1: 4.10, v1: 3.02, h: 0.90 },
  { id: 'og_k_kuehl',  kind: 'kitchen-tall', label: 'Kühlschr.',      u0: 3.43, v0: 4.20, u1: 4.10, v1: 5.05, h: 2.15 },
  { id: 'og_k_herd',   kind: 'kitchen-hob',  label: 'Herd',           u0: 3.43, v0: 5.05, u1: 4.10, v1: 5.92, h: 0.90 },
  { id: 'og_k_ofen',   kind: 'kitchen-tall', label: 'Backofen',       u0: 3.43, v0: 5.92, u1: 4.10, v1: 6.76, h: 2.15 },
  { id: 'og_ecktisch', kind: 'table',        label: 'Esstisch',       u0: 5.48, v0: 4.46, u1: 7.05, v1: 5.88, h: 0.76 },
  { id: 'og_bank_s',   kind: 'sofa',         label: 'Eckbank',        u0: 5.48, v0: 6.08, u1: 8.00, v1: 6.74, h: 0.84 },
  { id: 'og_bank_o',   kind: 'sofa',         label: '',               u0: 7.28, v0: 4.46, u1: 8.00, v1: 6.08, h: 0.84 },
  { id: 'og_sofa_l',   kind: 'sofa',         label: 'Wohnlandschaft', u0: 8.08, v0: 0.75, u1: 9.18, v1: 3.32, h: 0.82 },
  { id: 'og_sofa_c',   kind: 'sofa',         label: '',               u0: 9.18, v0: 2.38, u1: 9.85, v1: 3.32, h: 0.82 },
];

// Programmatische B-Plan-Fassaden- & Gestaltungsprüfung (100 % aus den echten Öffnungskoordinaten!)
function computeBPlanCheck(egOpenings, ogOpenings, gableOpenings) {
  const gableArea = 0.5 * W * GABLE_TRI_H;
  const facadeDefs = [
    { id: 'west',  siteSide: 'grenzwand',   label: 'Grenzwand 215/3',    len: L, wallArea: L * EAVE_WALL_Y },
    { id: 'east',  siteSide: 'hof',         label: 'Hof/Kanal',          len: L, wallArea: L * EAVE_WALL_Y },
    { id: 'south', siteSide: 'dautengasse', label: 'Dautengasse',        len: W, wallArea: W * EAVE_WALL_Y + gableArea },
    { id: 'north', siteSide: 'garten',      label: 'Garten (Flst. 215)', len: W, wallArea: W * EAVE_WALL_Y + gableArea },
  ];

  const allExt = [
    ...egOpenings.filter((o) => o.side).map((o) => ({ ...o, floor: 'eg' })),
    ...ogOpenings.filter((o) => o.side).map((o) => ({ ...o, floor: 'og' })),
    ...gableOpenings.map((o) => ({ ...o, floor: 'dach' })),
  ];

  let globalMinHB = Infinity;
  let globalMinPier = Infinity;
  let globalMaxShare = 0;

  const facades = facadeDefs.map((f) => {
    const ops = allExt.filter((o) => o.side === f.id);
    let openingArea = 0;
    let minHB = Infinity;
    for (const o of ops) {
      const w = o.s1 - o.s0;
      const hb = o.height / w;
      openingArea += w * o.height;
      if (hb < minHB) minHB = hb;
      if (hb < globalMinHB) globalMinHB = hb;
    }
    let minPier = Infinity;
    for (const fl of ['eg', 'og', 'dach']) {
      const flOps = ops.filter((o) => o.floor === fl).sort((a, b) => a.s0 - b.s0);
      for (let i = 0; i < flOps.length - 1; i++) {
        const pier = flOps[i + 1].s0 - flOps[i].s1;
        if (pier < minPier) minPier = pier;
        if (pier < globalMinPier) globalMinPier = pier;
      }
    }
    const share = openingArea / f.wallArea;
    if (share > globalMaxShare) globalMaxShare = share;
    const ogArea = ops.filter((o) => o.floor === 'og').reduce((s, o) => s + (o.s1 - o.s0) * o.height, 0);
    const ogShare = ogArea / (f.len * (OG_CLEAR + OG_SLAB));
    return {
      id: f.id,
      siteSide: f.siteSide,
      label: f.label,
      openingCount: ops.length,
      wallAreaM2: +f.wallArea.toFixed(2),
      openingAreaM2: +openingArea.toFixed(2),
      openingSharePct: +(share * 100).toFixed(1),
      ogOpeningSharePct: +(ogShare * 100).toFixed(1),
      minRatioHB: Number.isFinite(minHB) ? +minHB.toFixed(2) : null,
      minPierM: Number.isFinite(minPier) ? +minPier.toFixed(3) : null,
      passed: share < 0.5 && (!Number.isFinite(minHB) || minHB >= 1.25) && (!Number.isFinite(minPier) || minPier >= 0.24),
    };
  });

  return {
    sourceUrl: 'https://gis.kreis-bad-duerkheim.de/docs_bad_duerkheim_online/b_plan_Wattenheim_Ortskern/',
    legalDisclaimer: 'Geometrische Vorprüfung nach B-Plan Wattenheim „Ortskern“ – keine baurechtliche Zusicherung oder Genehmigungsprüfung.',
    roofType: 'Gleich geneigtes Satteldach (beidseits 35,0° Entwurf; Grenzwand 215/3 bündig 0,00 m mit innenliegender Rinne, Hof/Kanal 0,45 m Überstand)',
    roofPitchDeg: ROOF_PITCH_DEG,
    roofPitchMinDeg: 30,
    roofPitchProvenance: 'entwurf',
    roofPitchOk: ROOF_PITCH_DEG >= 30,
    roofCovering: 'Naturrot–rotbraune, unglasierte Tonziegel (matte Optik)',
    facadeFinish: 'Matte helle Putzfassade (freie Entwurfswahl, keine Satzungsvorgabe); farblich abgesetzte Fenstergesimse/Fensterbänke (B-Plan)',
    facadeFinishProvenance: 'entwurf',
    facadeFinishIsBPlanRule: false,
    windowSillContrastIsBPlanRule: true,
    portraitMinRatio: 1.25,
    actualMinRatioHB: +globalMinHB.toFixed(2),
    portraitOk: globalMinHB >= 1.25,
    maxOpeningSharePct: +(globalMaxShare * 100).toFixed(1),
    openingShareOk: globalMaxShare < 0.5,
    pierMinRequiredM: 0.24,
    actualMinPierM: +globalMinPier.toFixed(3),
    pierOk: globalMinPier >= 0.24,
    noPanoramaRibbons: true,
    noBoundaryOverhang: OVERHANG_WEST === 0,
    noWestOverhang: OVERHANG_WEST === 0,
    noStreetOverhang: OVERHANG_SOUTH === 0,
    noSouthOverhang: OVERHANG_SOUTH === 0,
    boundaryBuildingRule: 'Stammplan Abschnitt I.3 (abweichende Bauweise): Grenzbauten auf allen Grundstücksseiten grundsätzlich zulässig; brandschutz-/bauordnungsrechtliche Detailprüfung (LBauO RLP) vorbehalten.',
    parkingRequiredPerUnit: 2,
    facades,
    allDesignRulesPassed: ROOF_PITCH_DEG >= 30 && globalMinHB >= 1.25 && globalMaxShare < 0.5 && globalMinPier >= 0.24 && OVERHANG_WEST === 0 && OVERHANG_SOUTH === 0,
  };
}

const STAIRS = buildUStairSteps();
const BPLAN_CHECK = computeBPlanCheck(EG_OPENINGS, OG_OPENINGS, GABLE_OPENINGS);

const EG_NET_AREA_M2 = +EG_ROOMS.reduce((s, r) => s + r.areaM2, 0).toFixed(2);
const OG_STAIR_OPENING_M2 = STAIRS.slabOpening.areaM2; // 5.93 m²
const OG_NET_AREA_M2 = +OG_ROOMS.filter((r) => !r.isOpening).reduce((s, r) => s + r.areaM2, 0).toFixed(2); // 57.93 m² (OHNE Treppenloch!)

export const HOUSE_SPEC = {
  id: 'wattenheim-efh-11x715',
  title: 'Zweigeschossiges Wohnhaus (11,00 × 7,15 m)',
  axes: {
    origin: 'Grundrissmitte auf OKFF EG (y = 0,00 m)',
    localX: 'Lange Hausachse 11,00 m ([-5,50 .. +5,50], Skizze u=0 Dautengasse → u=11,00 Garten)',
    localZ: 'Hausbreite 7,15 m ([-3,575 .. +3,575], Skizze v=0 Grenzwand 215/3 → v=7,15 Hof/Kanal)',
    localY: 'Höhe über OKFF EG in Metern (Y-up)',
    recommendedOrientation: 'LVermGeo ALKIS EPSG:25832 (Welt-+Z zeigt Richtung Dautengasse ~NO 58°, nicht Süden!): Drehung um +92,23° um +Y ohne Spiegelung der Skizze → Skizze oben (v=0, fensterlos, 0,00 m Traufüberstand) = Grenzwand 215/3 (Welt −X), Skizze unten (v=7,15) = Hof/Kanal (Welt +X), Skizze links (u=0, Split-Level-Eingang) = Dautengasse (Welt +Z), Skizze rechts (u=11,00, 5 OG-Fenster) = Garten / Flst. 215 (Welt −Z).',
    baseRotationRad: Math.PI / 2,
  },
  footprint: {
    length: L,
    width: W,
    areaM2: +(L * W).toFixed(2),
    wallExt: T_EXT,
    wallIntLoad: T_INT_L,
    wallIntPart: T_INT_S,
    innerLength: +(L - 2 * T_EXT).toFixed(3),
    innerWidth: +(W - 2 * T_EXT).toFixed(3),
    cornersPlan: [[0, 0], [L, 0], [L, W], [0, W]],
    cornersLocal: [
      planToLocal(0, 0),
      planToLocal(L, 0),
      planToLocal(L, W),
      planToLocal(0, W),
    ],
    // Maximale 3D-Baukörper-/Dach-/Rinnen-Hülle (ohne Außentreppe Hof/Kanal & Gartenstufe)
    envelope3DLocal: {
      minX: -L / 2 - OVERHANG_SOUTH,       // -5.500 m (bündig an Dautengasse, 0,00 m Überbau!)
      maxX: +L / 2 + OVERHANG_NORTH,       // +5.500 m (bündig an Gartenseite / vor Baugrenze!)
      minZ: -W / 2 - OVERHANG_WEST,        // -3.575 m (EXAKT bündig an Grenzwand 215/3!)
      maxZ: +W / 2 + OVERHANG_EAST + 0.10, // +4.125 m (Hof/Kanal-Überstand 0,45 m + 0,10 m Rinne)
    },
  },
  // Sauber getrennte Gebäudehöhen (sämtlich Entwurfsannahmen, relativ zu OKFF EG = 0,00 m)
  heights: {
    provenance: 'entwurf',
    defaultPlinthDepth: 2.2,
    floorSlabEg: 0.3,
    okffEg: 0.0,
    egClear: EG_CLEAR,
    egSlab: EG_SLAB,
    okffOg: OKFF_OG,
    ogClear: OG_CLEAR,
    ogSlab: OG_SLAB,
    eaveWallY: +EAVE_WALL_Y.toFixed(3),                  // 5,900 m: Wand-Traufpunkt (OK OG-Decke)
    eaveBoundaryTopY: +EAVE_BOUNDARY_TOP_Y.toFixed(3),   // 6,217 m: Dachkante / Attika-OK Grenzwand 215/3 (0,00 m Überstand)
    eaveGrenzwandTopY: +EAVE_BOUNDARY_TOP_Y.toFixed(3),  // Alias
    eaveWestTopY: +EAVE_BOUNDARY_TOP_Y.toFixed(3),       // Kompatibilitäts-Alias
    eaveHofUnderY: +EAVE_HOF_UNDER_Y.toFixed(3),         // 5,585 m: Traufkante UK Hof/Kanal (0,45 m Überstand)
    eaveHofTopY: +EAVE_HOF_TOP_Y.toFixed(3),             // 5,902 m: Dachkante OK Ziegel Hof/Kanal (0,45 m Überstand)
    eaveEastUnderY: +EAVE_HOF_UNDER_Y.toFixed(3),        // Kompatibilitäts-Alias
    eaveEastTopY: +EAVE_HOF_TOP_Y.toFixed(3),            // Kompatibilitäts-Alias
    eaveOverhangY: +EAVE_HOF_UNDER_Y.toFixed(3),         // Kompatibilitäts-Alias
    gableTriangleH: +GABLE_TRI_H.toFixed(3),             // 2,503 m
    ridgeWallY: +RIDGE_WALL_Y.toFixed(3),                // 8,403 m: Giebelwand-Spitze (UK Dachaufbau)
    ridgeCapTopY: +(RIDGE_TOP_Y + RIDGE_CAP_LIFT + RIDGE_CAP_RADIUS).toFixed(3),
    ridgeTopY: +RIDGE_TOP_Y.toFixed(3),                  // 8,720 m: Firsthöhe OK ab OKFF EG (Entwurfsannahme!)
  },
  entrance: ENTRANCES,
  entrances: ENTRANCES,
  roof: {
    ridgeCapRadius: RIDGE_CAP_RADIUS,
    ridgeCapLift: RIDGE_CAP_LIFT,
    type: 'gable',
    pitchDeg: ROOF_PITCH_DEG,
    pitchRad: ROOF_PITCH_RAD,
    pitchProvenance: 'entwurf',
    thickness: ROOF_THICK,
    overhangWest: OVERHANG_WEST,
    overhangEast: OVERHANG_EAST,
    overhangSouth: OVERHANG_SOUTH,
    overhangNorth: OVERHANG_NORTH,
    overhangBoundary: OVERHANG_WEST,
    overhangHof: OVERHANG_EAST,
    overhangDautengasse: OVERHANG_SOUTH,
    overhangGarten: OVERHANG_NORTH,
    overhangEave: OVERHANG_EAST,
    overhangGable: OVERHANG_SOUTH,
    boundaryGutterType: 'innenliegende Kastenrinne / Attika bündig an Grenzwand 215/3 (0,00 m Überbau)',
    hofGutterType: 'vorgehängte halbrund-Rinne + Fallrohr am 0,45-m-Traufüberstand (Hof/Kanal)',
    westGutterType: 'innenliegende Kastenrinne / Attika bündig an Grenzwand 215/3 (0,00 m Überbau)',
    eastGutterType: 'vorgehängte halbrund-Rinne + Fallrohr am 0,45-m-Traufüberstand (Hof/Kanal)',
    ridgeAxis: 'localX',
    ridgePlan: [[-OVERHANG_SOUTH, W / 2], [L + OVERHANG_NORTH, W / 2]],
    ridgeLocal: [planToLocal(-OVERHANG_SOUTH, W / 2), planToLocal(L + OVERHANG_NORTH, W / 2)],
    eaveRectPlan: [-OVERHANG_SOUTH, -OVERHANG_WEST, L + OVERHANG_NORTH, W + OVERHANG_EAST],
    eaveCornersLocal: [
      planToLocal(-OVERHANG_SOUTH, -OVERHANG_WEST),
      planToLocal(L + OVERHANG_NORTH, -OVERHANG_WEST),
      planToLocal(L + OVERHANG_NORTH, W + OVERHANG_EAST),
      planToLocal(-OVERHANG_SOUTH, W + OVERHANG_EAST),
    ],
    gableOpenings: GABLE_OPENINGS,
  },
  stairs: STAIRS,
  levels: {
    eg: {
      id: 'eg',
      label: 'Erdgeschoss (EG)',
      sketchSource: 'Unterer Grundriss im Foto',
      yFloor: 0.0,
      yCeiling: EG_CLEAR,
      slabThickness: EG_SLAB,
      slabOpening: ENTRANCES.main.slabOpening,
      walls: EG_WALLS,
      openings: EG_OPENINGS,
      rooms: EG_ROOMS,
      furniture: EG_FURNITURE,
      netAreaM2: EG_NET_AREA_M2,
      areaNote: 'Innenfläche EG (Entwurf, inkl. Split-Level-Eingang; keine Wohnfläche nach WoFlV)',
    },
    og: {
      id: 'og',
      label: 'Obergeschoss (OG)',
      sketchSource: 'Oberer Grundriss im Foto',
      yFloor: OKFF_OG,
      yCeiling: OKFF_OG + OG_CLEAR,
      slabThickness: OG_SLAB,
      slabOpening: STAIRS.slabOpening,
      walls: OG_WALLS,
      openings: OG_OPENINGS,
      rooms: OG_ROOMS,
      furniture: OG_FURNITURE,
      netAreaM2: OG_NET_AREA_M2,
      netAreaWithoutStairOpeningM2: OG_NET_AREA_M2,
      stairOpeningAreaM2: OG_STAIR_OPENING_M2,
      areaNote: 'Innenfläche OG ohne offenes Treppenloch 5,93 m² (Entwurf; keine Wohnfläche nach WoFlV)',
    },
    dach: {
      id: 'dach',
      label: 'Dachaufsicht / Satteldach 35°',
      sketchSource: 'Entwurfsannahme nach B-Plan Wattenheim „Ortskern“',
      yFloor: EAVE_WALL_Y,
      yRidge: +RIDGE_TOP_Y.toFixed(3),
      gableOpenings: GABLE_OPENINGS,
    },
  },
  bplanCheck: BPLAN_CHECK,
  provenance: {
    vorgabe: [
      'Außenlänge lange Hauswand: exakt 11,00 m.',
      'Skizzenzuordnung: unterer Grundriss = EG, oberer Grundriss = OG.',
      'B-Plan Wattenheim „Ortskern“ (Satzung): beidseits gleiche Dachneigung ab 30°, naturrote bis rotbraune unglasierte Tonziegel oder Betondachsteine, Fenster/Außentüren im Hochformat (H/B ≥ 1,25), Öffnungsfläche < 50 % je Fassade, Mauerpfeiler ≥ 0,24 m, keine Panoramabänder, farblich abgesetzte Fenstergesimse, 2 Stellplätze/WE, Grenzbauten nach I.3.',
    ],
    foto: [
      'Die Umrisse ergeben bei jeweils 11,00 m Länge rund 6,4 m Tiefe im EG und 7,2 m im OG. Beide Geschosse erhalten im Entwurf 7,15 m.',
      'EG-Raumaufteilung: HWR (Handschrift), WC, Eingang/Diele (Dautengasse + Hof/Kanal), große offene Innenfläche.',
      'OG-Raumaufteilung: Bad (Dusche, G/Schrank, Sanitär), sep. WC, Flur, Zimmer (Dautengasse/Hof-Ecke), 2-teilige Küche (Handschrift: Spülmasch., Spüle | Kühlschr., Herd, Backofen), Wohn-/Essbereich (Eckgruppe + L-Sofa), U-Treppe (Garten/Hof-Ecke).',
      'Fensterverteilung: Grenzwand 215/3 fensterlos, Dautengasse-Giebel 3 OG-Fenster, Garten-Giebel 5 getrennte Fenster mit Pfeilern, Hof/Kanal-Wand 1 OG-Fenster.',
    ],
    interpretation: [
      'Längenabweichung EG (~12,15 m) vs. OG (11,00 m) auf einheitliches Zweigeschoss-Gebäude 11,00 × 7,15 m zusammengeführt (EG-Einzelproportion wäre ~6,38 m tief).',
      'Abweichende Treppenläufe (gerade EG-Skizzentreppe vs. OG-U-Treppe) auf durchgehende halbgewendelte U-Treppe EG ↔ OG mit Treppenloch (2,49 × 2,39 m = 5,93 m², aus OG-Innenfläche herausgerechnet) vereinheitlicht, um die OG-Sitzecke zu erhalten.',
      'Schmales doppelt gewendeltes Skizzenmotiv im OG-Zimmer an der Hof/Kanal-Kante nicht als Treppe ausgeführt (kollidiert mit 35°-Satteldach-Traufe ohne Gaube; kein EG-Gegenstück).',
    ],
    entwurf: [
      'Fassadenoberfläche: Matte helle Putzfassade als freie Entwurfswahl (KEINE Satzungs-/B-Plan-Vorgabe; ohne Farbcode-Bindung).',
      'Wandstärken (0,365 / 0,175 / 0,115 m) und Geschosshöhen (EG licht 2,70 m, Decke 0,30 m, OG licht 2,65 m, Decke 0,25 m, Wand-Traufpunkt 5,90 m ab OKFF EG).',
      'Gleich geneigtes Satteldach 35,0° (Entwurf ≥ 30°): bündige Traufe Grenzwand 215/3 (0,00 m Überstand, innenliegende Kastenrinne, Dachkante 6,22 m), regulärer Überstand Hof/Kanal (0,45 m, Traufkante UK 5,58 m / OK 5,90 m), bündiger Ortgang Dautengasse & Garten (0,00 m), Firsthöhe 8,72 m ab OKFF EG und je 1 Giebelfenster (0,75 × 1,05 m).',
      'Split-Level-Eingang am Hang (Dautengasse, Gelände ~−1,50 m): Haustürschwelle bündig in der Außenwand auf −1,44 m (0,00 m Überstand auf Straßenfläche), innenliegendes Eingangspodest (1,20 × 1,235 m) + Innentreppe (8 Stg. à 18,0 cm, 7 Auftr. à 26,5 cm = 1,855 m, 2s+a = 62,5 cm, Kopfhöhe ≥ 2,20 m / 2,70 m, Geländer 1,00 m) bis OKFF EG.',
      'Nebeneingang Hof/Kanal (Gelände ~−1,27 m): Außenpodest 1,05 × 1,05 m + paralleler Treppenlauf (7 Stg. à 18,1 cm, 6 Auftr. à 27,0 cm = 1,62 m, 2s+a = 63,3 cm, Geländer 1,00 m), 100 % in Flst. 214; Gartentür Garten (~−0,15 m): 1 Gartenstufe (0,30 × 1,05 m) im Unsicherheitsbereich der Baugrenze.',
      'U-Treppe EG ↔ OG nach DIN 18065 (17 Stg. × 17,65 cm, 16 Auftr. ≈ 27,1 cm, 2s+a = 62,4 cm, Durchgangshöhe ≥ 2,70 m), Hangsockel und stimmiges Mobiliar.',
    ],
  },
};
