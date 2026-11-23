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
  //    Haustür bündig in Dautengasse-Außenwand (u=0..0,365, v=4,28..5,33, Mitte 4,805 m exakt auf Türpfeil im Foto!)
  //    mit Schwelle auf y=-1,44 m (Δ ≈ 5–6 cm zur Straßenböschung, 0,00 m Überstand vor Fassade / 0,00 m auf Straßenfläche!),
  //    dahinter innenliegendes Eingangspodest (1,20 × 1,235 m auf y=-1,44 m) + gerader, voll begehbarer
  //    Innentreppe-Lauf (8 Steigungen × 18,0 cm = 1,44 m, 7 Auftritte × 26,5 cm = 1,855 m, 2s+a = 62,5 cm,
  //    Laufbreite licht 1,175 m ≥ 0,95 m, Kopfhöhe ≥ 2,20 m an Tür / 2,70 m über gesamtem Lauf) bis OKFF EG = 0,00 m.
  const mainDoorV0 = 4.28;
  const mainDoorV1 = 5.33; // Breite 1,05 m, Höhe 2,20 m (H/B = 2,10 >= 1,25)
  const mainDoorMidV = +((mainDoorV0 + mainDoorV1) / 2).toFixed(4); // 4.805
  const mainSillY = -1.44;
  const mainDoorH = 2.20;
  const mainPitV0 = 4.165;
  const mainPitV1 = 5.40;
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
      { id: 'split_wall_wc',   u0: T_EXT,       v0: 4.05,      u1: mainStairU1, v1: mainPitV0, yBottom: mainSillY, yTop: 0.0 },
      { id: 'split_wall_hof',  u0: T_EXT,       v0: mainPitV1, u1: mainStairU1, v1: +(mainPitV1 + T_INT_S).toFixed(3), yBottom: mainSillY, yTop: 0.0 },
      { id: 'split_wall_back', u0: mainStairU1, v0: mainPitV0, u1: +(mainStairU1 + T_INT_S).toFixed(3), v1: mainPitV1, yBottom: mainSillY, yTop: 0.0 },
    ],
    railingHeightM: 1.0,
    railingSegments: [
      { id: 'split_rail_hof', u0: T_EXT,       v0: mainPitV1, y0: 0.0,       u1: mainStairU1, v1: mainPitV1, y1: 0.0, heightM: 1.0, kind: 'level-guardrail' },
      { id: 'split_rail_wc',  u0: 2.165,       v0: mainPitV0, y0: 0.0,       u1: mainStairU1, v1: mainPitV0, y1: 0.0, heightM: 1.0, kind: 'level-guardrail' },
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
  //    1 Gartenstufe (0,30 m tief × 1,03 m breit, Δ ≈ 0,15 m), exakt unter OG-Fenster F_og_n2 (v = 2,25..3,18),
  //    100 % innerhalb Flurstück 214 UND vor der Baugrenze!
  const gStepU0 = L;
  const gStepU1 = +(L + 0.30).toFixed(3); // 11.30 (bleibt an allen 4 Ecken vor der blauen Baugrenze!)
  const gStepV0 = 2.20;
  const gStepV1 = 3.23; // Breite 1,03 m (Tür T_terr bei v = 2,25..3,18)
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
    accessSummary: '1 Gartenstufe (0,30 × 1,03 m, Δ ≈ 0,15 m), bündig unter F_og_n2, im eingepassten Plan vor der Baugrenze (Lagegenauigkeit etwa ±0,5 m)',
    provenance: 'entwurf',
    recessed: false,
    plan: [L, 2.715],
    local: [planToLocal(L, 2.715)[0], 0, planToLocal(L, 2.715)[1]],
    sampleLocal: [planToLocal(L + 0.30, 2.715)[0], 0, planToLocal(L + 0.30, 2.715)[1]],
    outwardLocal: [1, 0, 0],
    width: 0.93,
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
// Exakt an die gezeichnete OG-U-Treppe (u = 8,22..10,635 m, v = 4,37..6,785 m, Pfeil aufwärts Richtung −v) angeglichen.
function buildUStairSteps() {
  const u0 = 8.22, u1 = 10.635, v0 = 4.37, v1 = 6.785;
  const spU0 = 9.34, spU1 = 9.48; // Spindel / Auge (0,14 m, Fotomitte 9,41 m)
  const pivotU = (spU0 + spU1) / 2; // 9.41
  const pivotV = 5.65;
  const risers = 17;
  const rise = OKFF_OG / risers;
  const straightN = 5;
  const treadStraight = (pivotV - v0) / straightN; // 0.256 m
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
      { u0: 8.16, v0: 4.37, u1: 8.16, v1: 6.785, kind: 'parapet-rail' }, // Seite Wohnbereich/Eckbank (u=8,16)
      { u0: spU0, v0: 4.37, u1: u1,   v1: 4.37,  kind: 'open-rail' },    // Seite über Antritt (Austritt u0..spU0 bleibt offen!)
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

// EG-Wände (unten im Foto) – statisch & haustechnisch exakt unter OG gestapelt, abgestimmt auf Split-Level-Eingang
const EG_WALLS = [
  ...makeOuterWalls('eg'),
  { id: 'eg_hwr_east',   ext: false, axis: 'v', u0: 3.24,  v0: T_EXT, u1: 3.24 + T_INT_L, v1: 3.055 },
  { id: 'eg_hwr_south',  ext: false, axis: 'u', u0: T_EXT, v0: 2.94,  u1: 3.24,           v1: 3.055 },
  { id: 'eg_wc_east',    ext: false, axis: 'v', u0: 2.05,  v0: 3.055, u1: 2.05 + T_INT_S, v1: 4.05 },
  { id: 'eg_wc_south',   ext: false, axis: 'u', u0: T_EXT, v0: 4.05,  u1: 2.05 + T_INT_S, v1: 4.165 },
  { id: 'eg_entry_stub', ext: false, axis: 'v', u0: 3.24,  v0: 6.35,  u1: 3.24 + T_INT_L, v1: W - T_EXT },
  { id: 'eg_stair_west', ext: false, axis: 'v', u0: 8.105, v0: 4.37,  u1: 8.22,           v1: W - T_EXT },
];

// OG-Wände (oben im Foto) – exakt an entzerrter OG-Skizze ausgerichtet & statisch über EG gestapelt
const OG_WALLS = [
  ...makeOuterWalls('og'),
  { id: 'og_bath_east',  ext: false, axis: 'v', u0: 3.24,  v0: T_EXT, u1: 3.24 + T_INT_L, v1: 3.055 },
  { id: 'og_bath_south', ext: false, axis: 'u', u0: T_EXT, v0: 2.94,  u1: 3.24,           v1: 3.055 },
  { id: 'og_wc_east',    ext: false, axis: 'v', u0: 2.05,  v0: 3.055, u1: 2.05 + T_INT_S, v1: 4.05 },
  { id: 'og_room_north', ext: false, axis: 'u', u0: T_EXT, v0: 4.05,  u1: 3.24,           v1: 4.165 },
  { id: 'og_room_east',  ext: false, axis: 'v', u0: 3.24,  v0: 4.05,  u1: 3.24 + T_INT_L, v1: W - T_EXT },
];

const ENTRANCES = buildEntrances();

// Öffnungen (Türen & Fenster) – JEDE Außenöffnung im Hochformat H/B >= 1,25 (B-Plan Wattenheim „Ortskern“)
const EG_OPENINGS = [
  // Giebel Dautengasse (u = 0) – vertikal bündig unter OG-Fenstern; Haupteingang exakt auf Foto-Türpfeil
  { id: 'F_eg_s1',  wallId: 'eg_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 1.35, s1: 2.20, sillY: 0.95,  height: 1.25, label: 'Fenster HWR (Dautengasse)', provenance: 'entwurf' },
  { id: 'F_eg_s2',  wallId: 'eg_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 3.25, s1: 3.85, sillY: 1.15,  height: 1.05, label: 'Fenster WC EG (Dautengasse)', provenance: 'foto' },
  { id: 'T_haupt',  wallId: 'eg_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'door',   s0: 4.28, s1: 5.33, sillY: -1.44, height: 2.20, swing: 'in-left', mainEntrance: true, splitLevel: true, label: 'Haupteingang (Dautengasse · Split-Level)', provenance: 'entwurf' },
  // Längswand Hof/Kanal (v = 7,15) – F_eg_o1 bündig unter F_og_o1
  { id: 'T_ost',    wallId: 'eg_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'door',   s0: 2.20, s1: 3.15, sillY: 0.00,  height: 2.20, swing: 'in-right', sideEntrance: true, label: 'Nebeneingang (Hof/Kanal)', provenance: 'foto' },
  { id: 'F_eg_o1',  wallId: 'eg_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'window', s0: 4.53, s1: 5.42, sillY: 0.90,  height: 1.35, label: 'Fenster EG Hof/Kanal 1', provenance: 'entwurf' },
  { id: 'F_eg_o2',  wallId: 'eg_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'window', s0: 6.32, s1: 7.21, sillY: 0.90,  height: 1.35, label: 'Fenster EG Hof/Kanal 2', provenance: 'entwurf' },
  // Giebel Garten / Flurstück 215 (u = 11,00) – alle 4 Öffnungen exakt bündig unter OG-Fenstern (Pfeiler 0,26 m)
  { id: 'F_eg_n1',  wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 1.06, s1: 1.99, sillY: 0.90, height: 1.35, label: 'Fenster EG Garten 1', provenance: 'entwurf' },
  { id: 'T_terr',   wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'door',   s0: 2.25, s1: 3.18, sillY: 0.00, height: 2.20, swing: 'in-left', glazed: true, gardenEntrance: true, label: 'Gartentür (Garten)', provenance: 'entwurf' },
  { id: 'F_eg_n2',  wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 3.44, s1: 4.37, sillY: 0.90, height: 1.35, label: 'Fenster EG Garten 2', provenance: 'entwurf' },
  { id: 'F_eg_n3',  wallId: 'eg_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 4.63, s1: 5.56, sillY: 1.00, height: 1.35, label: 'Fenster Treppe EG (Garten)', provenance: 'entwurf' },
  // Innentüren EG
  { id: 'T_eg_hwr', wallId: 'eg_hwr_east',  kind: 'interior-door', s0: 1.88, s1: 2.76, sillY: 0.00, height: 2.10, swing: 'in-neg', label: 'Tür HWR', provenance: 'entwurf' },
  { id: 'T_eg_wc',  wallId: 'eg_wc_east',   kind: 'interior-door', s0: 3.18, s1: 3.94, sillY: 0.00, height: 2.10, swing: 'in-neg-right', label: 'Tür WC EG', provenance: 'foto' },
];

const OG_OPENINGS = [
  // Giebel Dautengasse (u = 0) – exakt 3 Fenster wie in OG-Skizze
  { id: 'F_og_s1',  wallId: 'og_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 1.35, s1: 2.20, sillY: 0.95, height: 1.25, label: 'Fenster Bad (Dautengasse)', provenance: 'foto' },
  { id: 'F_og_s2',  wallId: 'og_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 3.25, s1: 3.85, sillY: 1.15, height: 1.05, label: 'Fenster WC OG (Dautengasse)', provenance: 'foto' },
  { id: 'F_og_s3',  wallId: 'og_ext_south', side: 'south', siteSide: 'dautengasse', kind: 'window', s0: 5.09, s1: 5.90, sillY: 0.95, height: 1.25, label: 'Fenster Zimmer OG (Dautengasse)', provenance: 'foto' },
  // Längswand Hof/Kanal (v = 7,15) – exakt 1 Fenster wie in OG-Skizze (4,53..5,42 m)
  { id: 'F_og_o1',  wallId: 'og_ext_east',  side: 'east',  siteSide: 'hof',         kind: 'window', s0: 4.53, s1: 5.42, sillY: 0.90, height: 1.35, label: 'Fenster OG Hof/Kanal', provenance: 'foto' },
  // Giebel Garten (u = 11,00) – exakt 5 diskrete Hochformatfenster (je 0,93 × 1,35 m, H/B=1,45, Pfeiler 0,26 m ≥ 0,24 m)
  { id: 'F_og_n1',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 1.06, s1: 1.99, sillY: 0.90, height: 1.35, label: 'Fenster Wohnen 1 (Garten)', provenance: 'foto' },
  { id: 'F_og_n2',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 2.25, s1: 3.18, sillY: 0.90, height: 1.35, label: 'Fenster Wohnen 2 (Garten)', provenance: 'foto' },
  { id: 'F_og_n3',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 3.44, s1: 4.37, sillY: 0.90, height: 1.35, label: 'Fenster Wohnen 3 (Garten)', provenance: 'foto' },
  { id: 'F_og_n4',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 4.63, s1: 5.56, sillY: 0.90, height: 1.35, label: 'Fenster Treppe OG 1 (Garten)', provenance: 'foto' },
  { id: 'F_og_n5',  wallId: 'og_ext_north', side: 'north', siteSide: 'garten',      kind: 'window', s0: 5.82, s1: 6.75, sillY: 0.90, height: 1.35, label: 'Fenster Treppe OG 2 (Garten)', provenance: 'foto' },
  // Innentüren OG – Anschlag & Aufschlagrichtung exakt wie in OG-Skizze
  { id: 'T_og_bath', wallId: 'og_bath_south', kind: 'interior-door', s0: 2.28, s1: 3.16, sillY: 0.00, height: 2.10, swing: 'in-neg-right', label: 'Tür Bad', provenance: 'foto' },
  { id: 'T_og_wc',   wallId: 'og_wc_east',    kind: 'interior-door', s0: 3.18, s1: 3.94, sillY: 0.00, height: 2.10, swing: 'in-neg-right', label: 'Tür WC OG', provenance: 'foto' },
  { id: 'T_og_room', wallId: 'og_room_north', kind: 'interior-door', s0: 2.30, s1: 3.16, sillY: 0.00, height: 2.10, swing: 'in-pos-right', label: 'Tür Zimmer OG', provenance: 'foto' },
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
  makeRoom('eg_hwr',     'HWR / Technik',       [[T_EXT, T_EXT, 3.24, 2.94]], [1.80, 1.62], 'foto', 'Handschrift „HWR“ in EG-Skizze; direkt unter OG-Bad gestapelt'),
  makeRoom('eg_wc',      'WC',                  [[T_EXT, 3.055, 2.05, 4.05]], [1.40, 3.68], 'foto', 'Deckungsgleich unter OG-WC'),
  makeRoom('eg_eingang', 'Split-Level Eingang', [[T_EXT, 4.165, 1.565, 5.40], [1.565, 4.165, 3.420, 5.40]], [1.88, 4.78], 'entwurf', 'Entwurfsannahme am Hang: Innenpodest auf −1,44 m + 8-stufiger Treppenlauf bis OKFF EG (0,00 m auf Straßenfläche)'),
  makeRoom('eg_diele',   'Diele / Hofzugang',   [[T_EXT, 5.40, 3.24, W - T_EXT], [2.165, 3.055, 3.24, 4.165]], [2.15, 5.92], 'foto', 'Verbindung Nebeneingang (Hof/Kanal), Garderobe, WC & offene EG-Fläche'),
  makeRoom('eg_halle',   'Offener Bereich EG',  [[3.415, T_EXT, L - T_EXT, 4.37], [3.415, 4.37, 8.105, W - T_EXT]], [6.55, 2.55], 'foto', 'Große offene, unmöblierte Innenfläche laut EG-Skizze (Entwurf, keine WoFlV-Berechnung)'),
  makeRoom('eg_treppe',  'Treppe',              [[8.22, 4.37, L - T_EXT, W - T_EXT]], [9.43, 5.58], 'interpretation', 'Zusammengeführte U-Treppe EG ↔ OG im Eckkern Garten / Hof-Kanal'),
];

const OG_ROOMS = [
  makeRoom('og_bad',    'Bad',                    [[T_EXT, T_EXT, 3.24, 2.94]], [1.72, 1.80], 'foto', 'G-Schrank, Schrank, Dusche mit Ablauf, WT, WC, WT laut OG-Skizze'),
  makeRoom('og_wc',     'WC',                     [[T_EXT, 3.055, 2.05, 4.05]], [1.40, 3.68], 'foto', 'Separates WC + Handwaschbecken'),
  makeRoom('og_flur',   'Flur',                   [[2.165, 3.055, 3.415, 4.05]], [2.79, 3.56], 'foto', 'Verteiler Bad / WC / Zimmer (lichte Breite 1,00 m)'),
  makeRoom('og_zimmer', 'Zimmer',                 [[T_EXT, 4.165, 3.24, W - T_EXT]], [1.75, 5.46], 'foto', 'Arbeits-/Gästezimmer (Skizzenmotiv an Hof/Kanal-Kante als Stauraum-Zone ausgeführt)'),
  makeRoom('og_wohnen', 'Wohnen / Essen / Küche', [[3.415, T_EXT, L - T_EXT, 4.37], [3.415, 4.37, 8.105, W - T_EXT]], [6.25, 2.35], 'foto', '2-teilige Küchenzeile (Spülmasch./Spüle/Arbeitsfl. | Kühlschr./Herd/Backofen), Esstisch/Eckbank & L-Sofa'),
  makeRoom('og_treppe', 'Treppenloch',            [[8.22, 4.37, L - T_EXT, W - T_EXT]], [9.43, 5.58], 'interpretation', 'Offenes Treppenloch 2,42 × 2,42 m (5,83 m²) – aus OG-Innenfläche herausgerechnet', { isOpening: true }),
];

// Mobiliar (sämtliche EG-Möbel auf y = 0,00 m, frei von Split-Level-Ausschnitt & Türschwenkbereichen;
// offene EG-Fläche entsprechend der Handskizze ohne erfundene Tische/Sideboards belassen!)
const EG_FURNITURE = [
  { id: 'eg_wm',      kind: 'appliance', label: 'WM / TR',   u0: 0.42, v0: 0.42, u1: 1.65, v1: 1.05, h: 0.85 },
  { id: 'eg_wp',      kind: 'cabinet',   label: 'Technik',   u0: 1.80, v0: 0.42, u1: 3.18, v1: 1.08, h: 1.95 },
  { id: 'eg_regal',   kind: 'shelf',     label: 'Regal',     u0: 0.40, v0: 2.46, u1: 2.45, v1: 2.92, h: 1.80 },
  { id: 'eg_wc_pan',  kind: 'wc',        label: 'WC',        u0: 0.38, v0: 3.30, u1: 0.98, v1: 3.88, h: 0.42 },
  { id: 'eg_wc_sink', kind: 'sink',      label: 'WB',        u0: 1.36, v0: 3.065, u1: 1.80, v1: 3.40, h: 0.84 },
  { id: 'eg_gard',    kind: 'cabinet',   label: 'Garderobe', u0: 0.45, v0: 6.22, u1: 1.85, v1: 6.74, h: 2.00 },
];

const OG_FURNITURE = [
  { id: 'og_g_box',    kind: 'cabinet',      label: 'G',              u0: 0.38, v0: 0.38,  u1: 1.21, v1: 1.22, h: 1.95 },
  { id: 'og_bad_sch',  kind: 'cabinet',      label: 'Schrank',        u0: 1.23, v0: 0.38,  u1: 2.11, v1: 1.22, h: 0.90 },
  { id: 'og_dusche',   kind: 'shower',       label: 'Dusche',         u0: 2.13, v0: 0.38,  u1: 3.23, v1: 1.43, h: 2.05 },
  { id: 'og_bad_wb1',  kind: 'sink',         label: 'WT',             u0: 0.38, v0: 1.50,  u1: 0.84, v1: 1.99, h: 0.85 },
  { id: 'og_bad_wc',   kind: 'wc',           label: 'WC',             u0: 0.38, v0: 2.25,  u1: 0.95, v1: 2.75, h: 0.42 },
  { id: 'og_bad_wb2',  kind: 'sink',         label: 'WT',             u0: 1.36, v0: 2.55,  u1: 1.82, v1: 2.93, h: 0.85 },
  { id: 'og_wc_pan',   kind: 'wc',           label: 'WC',             u0: 0.38, v0: 3.30,  u1: 0.98, v1: 3.88, h: 0.42 },
  { id: 'og_wc_sink',  kind: 'sink',         label: 'WB',             u0: 1.36, v0: 3.065, u1: 1.80, v1: 3.40, h: 0.84 },
  { id: 'og_desk',     kind: 'bed-desk',     label: 'Tisch/Bett',     u0: 0.38, v0: 4.18,  u1: 2.31, v1: 5.00, h: 0.75 },
  { id: 'og_lowb',     kind: 'shelf',        label: 'Stauraum',       u0: 0.38, v0: 5.98,  u1: 3.22, v1: 6.77, h: 0.90 },
  { id: 'og_k_spuelm', kind: 'kitchen',      label: 'Spülmasch.',     u0: 3.42, v0: 0.38,  u1: 4.28, v1: 1.20, h: 0.90 },
  { id: 'og_k_spuele', kind: 'kitchen-sink', label: 'Spüle',          u0: 3.42, v0: 1.20,  u1: 4.28, v1: 2.06, h: 0.90 },
  { id: 'og_k_arbp',   kind: 'kitchen',      label: 'Arbeitsfl.',     u0: 3.42, v0: 2.06,  u1: 4.28, v1: 3.05, h: 0.90 },
  { id: 'og_k_kuehl',  kind: 'kitchen-tall', label: 'Kühlschr.',      u0: 3.42, v0: 4.06,  u1: 4.32, v1: 4.96, h: 2.15 },
  { id: 'og_k_herd',   kind: 'kitchen-hob',  label: 'Herd',           u0: 3.42, v0: 4.96,  u1: 4.32, v1: 5.90, h: 0.90 },
  { id: 'og_k_ofen',   kind: 'kitchen-tall', label: 'Backofen',       u0: 3.42, v0: 5.90,  u1: 4.32, v1: 6.77, h: 2.15 },
  { id: 'og_ecktisch', kind: 'table',        label: 'Esstisch',       u0: 5.51, v0: 4.37,  u1: 7.13, v1: 5.82, h: 0.76 },
  { id: 'og_bank_s',   kind: 'sofa',         label: 'Eckbank',        u0: 5.54, v0: 5.98,  u1: 8.10, v1: 6.77, h: 0.84, back: 'bottom' },
  { id: 'og_bank_o',   kind: 'sofa',         label: '',               u0: 7.26, v0: 4.37,  u1: 8.10, v1: 5.98, h: 0.84, back: 'right' },
  { id: 'og_sofa_l',   kind: 'sofa',         label: 'Wohnlandschaft', u0: 8.11, v0: 0.70,  u1: 9.34, v1: 2.36, h: 0.82, back: 'left' },
  { id: 'og_sofa_c',   kind: 'sofa',         label: '',               u0: 8.11, v0: 2.36,  u1: 9.91, v1: 3.29, h: 0.82, back: 'bottom' },
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
const OG_STAIR_OPENING_M2 = STAIRS.slabOpening.areaM2; // 5.83 m²
const OG_NET_AREA_M2 = +OG_ROOMS.filter((r) => !r.isOpening).reduce((s, r) => s + r.areaM2, 0).toFixed(2); // 58.09 m² (OHNE Treppenloch!)

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
      areaNote: `Innenfläche OG ohne offenes Treppenloch ${OG_STAIR_OPENING_M2.toFixed(2).replace('.', ',')} m² (Entwurf; keine Wohnfläche nach WoFlV)`,
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
      'Lineal-kalibrierte Entzerrung des Maßstabsfotos: OG ergibt bei 11,00 m Außenlänge ca. 7,16–7,19 m Tiefe (Entwurfsmaß 7,15 m); EG ist auf dem Blatt ca. 9 % länger gezeichnet (Einzelproportion ~6,25 m), wobei HWR- und WC-Breite in physischen cm exakt unter OG-Bad und OG-WC liegen.',
      'EG-Raumaufteilung: HWR (Handschrift, Regalwand v=2,46 m), WC + WB, Eingang/Diele (Türpfeile Dautengasse v≈4,80 m & Hof/Kanal), große offene unmöblierte Innenfläche.',
      'OG-Raumaufteilung: Bad (G-Schrank, Schrank, Dusche mit Ablauf, WT/WC/WT), sep. WC + WB, Flur (1,00 m), Zimmer (Tisch/Bett + Stauraumzone), 2-teilige Küche (Handschrift: Spülmasch./Spüle/Arbeitsfl. | Kühlschr./Herd/Backofen), Esstisch + Eckbank, L-Sofa (Schenkel zu Gartenfenstern geöffnet), U-Treppe mit Pfeil aufwärts Richtung −v.',
      'Fensterverteilung: Grenzwand 215/3 fensterlos, Dautengasse-Giebel 3 OG-Fenster, Garten-Giebel 5 getrennte Hochformatfenster (je 0,93 × 1,35 m, Pfeiler 0,26 m ≥ 0,24 m), Hof/Kanal-Wand 1 OG-Fenster (4,53..5,42 m).',
    ],
    interpretation: [
      'Längenabweichung EG (~11,26 cm auf Blatt) vs. OG (~10,30 cm auf Blatt) auf einheitliches Zweigeschoss-Gebäude 11,00 × 7,15 m mit exakt übereinander gestapelten Nasskern-/Tragwänden (u=3,24..3,415 m, u=2,05..2,165 m, v=2,94..3,055 m, v=4,05..4,165 m) zusammengeführt.',
      'Abweichende Treppenläufe (gerade EG-Skizzentreppe u≈4,58..9,13 m an Hof/Kanal-Kante + Eckpodest vs. OG-U-Treppe u=8,22..10,635 m, v=4,37..6,785 m) baulich schlüssig auf die durchgehende halbgewendelte U-Treppe EG ↔ OG (Treppenloch 2,42 × 2,42 m = 5,83 m², aus OG-Innenfläche herausgerechnet) im gemeinsamen Eckkern Garten/Hof vereinheitlicht, da die gerade EG-Treppe sonst OG-Eckbank und Esstisch durchschneiden würde.',
      'Schmales doppelt gewendeltes Skizzenmotiv im OG-Zimmer (u=0,38..3,22 m, v=5,98..6,77 m) nicht als Treppe ausgeführt (nur ~0,55 m lichte Höhe unter der 35°-Traufe ohne Gaube; kein EG-Gegenstück), sondern als Stauraum-/Lowboard-Zone ausgebildet; im Skizzenoverlay weiterhin vollständig sichtbar.',
    ],
    entwurf: [
      'Fassadenoberfläche: Matte helle Putzfassade als freie Entwurfswahl (KEINE Satzungs-/B-Plan-Vorgabe; ohne Farbcode-Bindung).',
      'Wandstärken (0,365 / 0,175 / 0,115 m) und Geschosshöhen (EG licht 2,70 m, Decke 0,30 m, OG licht 2,65 m, Decke 0,25 m, Wand-Traufpunkt 5,90 m ab OKFF EG).',
      'Gleich geneigtes Satteldach 35,0° (Entwurf ≥ 30°): bündige Traufe Grenzwand 215/3 (0,00 m Überstand, innenliegende Kastenrinne, Dachkante 6,22 m), regulärer Überstand Hof/Kanal (0,45 m, Traufkante UK 5,58 m / OK 5,90 m), bündiger Ortgang Dautengasse & Garten (0,00 m), Firsthöhe 8,72 m ab OKFF EG und je 1 Giebelfenster (0,75 × 1,05 m).',
      'Split-Level-Eingang am Hang (Dautengasse, Gelände ~−1,50 m): Haustürschwelle bündig in der Außenwand auf −1,44 m (v=4,28..5,33 m, 0,00 m Überstand auf Straßenfläche), innenliegendes Eingangspodest (1,20 × 1,235 m) + Innentreppe (8 Stg. à 18,0 cm, 7 Auftr. à 26,5 cm = 1,855 m, 2s+a = 62,5 cm, Kopfhöhe ≥ 2,20 m / 2,70 m, Geländer 1,00 m) bis OKFF EG.',
      'Nebeneingang Hof/Kanal (Gelände ~−1,27 m): Außenpodest 1,05 × 1,05 m + paralleler Treppenlauf (7 Stg. à 18,1 cm, 6 Auftr. à 27,0 cm = 1,62 m, 2s+a = 63,3 cm, Geländer 1,00 m), 100 % in Flst. 214; Gartentür Garten (~−0,15 m, bündig unter F_og_n2): 1 Gartenstufe (0,30 × 1,03 m) vor der eingepassten Baugrenze.',
      'U-Treppe EG ↔ OG nach DIN 18065 (17 Stg. × 17,65 cm, 16 Auftr. ≈ 27,0 cm, 2s+a = 62,3 cm, Durchgangshöhe ≥ 2,70 m), Hangsockel und plangetreues Mobiliar.',
    ],
  },
};
