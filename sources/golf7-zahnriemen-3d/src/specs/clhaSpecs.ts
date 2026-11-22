import type { FasteningStageId, FasteningUnit, LockableWheelId } from '../types';

export interface FasteningStageSpec {
  id: FasteningStageId;
  stageKind: 'torque' | 'angle';
  stageIndex: number;
  stageTotal: number;
  stage1PillLabel?: string;
  stage2PillLabel?: string;
  unit: FasteningUnit;
  targetValue: number;
  /** Spielhilfe-Eingabefenster für die Übungswertung (keine Werkstoleranz) */
  inputWindow: number;
  maxValue: number;
  scaleTicks: number[];
  ratePerSec: number;
  decimals: number;
  label: string;
  scoreLabel: string;
  boltLabel: string;
  specNote: string;
  targetLabel: string;
}

export interface ManualSourceRef {
  id: string;
  title: string;
  edition: string;
  section: string;
  href: string;
}

export interface DatasheetEntry {
  part: string;
  value: string;
  note?: string;
}

export const VEHICLE_SPEC = {
  model: 'VW Golf VII 1.6 TDI',
  engineFamily: 'EA288',
  engineCode: 'CLHA',
  powerKw: 77,
  badgeText: 'VW Golf VII 1.6 TDI • EA288 (MKB CLHA, 77 kW)',
} as const;

export const CLHA_TIMING_BELT = {
  teeth: 145,
  widthMm: 25,
  shortSpec: '145 Z. • 25 mm',
  specLabel: '145 Zähne • 25 mm Breite',
  vwLaySequenceText: '1. KW → 2. Spannrolle (über U-R) → 3. NW → 4. HDP (über O-R) → 5. Kühlmittelpumpe',
  catalogNote:
    'Nockenwellen-Zahnriemen CLHA (z. B. ContiTech CT1168K1 / SKF VKMA 01278); Schemadarstellung der Räder.',
} as const;

export const SIMULATED_TENSIONER_VARIANT = {
  code: 'Typ B',
  shortLabel: 'Spannrolle Typ B (T10265 + T10264)',
  summary:
    'In dieser Simulation wird Spannrolle Typ B (Absteckstift T10265, Einstellschlüssel T10264) verwendet. Bei Typ A (andere Verstellkontur) darf T10265 nicht eingesetzt werden — gespannt wird dort mit 8-mm-Winkelschraubendreher T10409 (VW 08.2015, Rep.-Gr. 15 S. 117). Welche Variante im eigenen Golf verbaut ist, muss am Fahrzeug geprüft werden.',
} as const;

export const AUX_DRIVE_SPEC = {
  vwToolNote:
    'VW Golf VII 08.2015, Rep.-Gr. 13 S. 52 nennt Ringschlüssel zum Schwenken des Federarms und Absteckstift T10060 A (ohne Angabe einer Schlüsselweite).',
  exampleWrenchNote:
    'Am gezeigten Nebenriemen-Federarm passt SW 16 (nicht 17/19 mm). Werkzeug am Zahnriemen: T10264.',
  routingOrder: '1. Schwingungsdämpfer → 2. Spannrolle → 3. Drehstromgenerator → 4. Klimakompressor',
} as const;

export const OIL_PUMP_BELT_SPEC = {
  title: 'Ölpumpen-Zahnriemen im Ölbad (separater Antrieb)',
  shortLabel: 'Im Ölbad • fester Achsabstand',
  summary:
    'Die Kurbelwelle treibt hinter dem vorderen Dichtflansch über einen eigenen Zahnriemen im Motoröl die kombinierte Öl- und Unterdruckpumpe an der Blockunterseite an. Die Riemenspannung ergibt sich geometrisch durch den festen Achsabstand — es gibt keinen einstellbaren Spanner (VW SSP 820433, gedr. S. 12 / PDF S. 16).',
  serviceNote:
    'Dieser Ölbadriemen ist baulich vom trockenen Nockenwellen-Zahnriemen getrennt und wird beim normalen Zahnriemenwechsel nicht geöffnet (Eingriff erfordert Ölablass, Ölwanne abbauen und vorderen Dichtflansch erneuern, Rep.-Gr. 17; kein unbelegtes fixes Wechselintervall).',
} as const;

export const CLHA_LOCK_TOOLS: Record<
  LockableWheelId,
  { code: string; name: string; shortLabel: string; engagementDesc: string }
> = {
  crank: {
    code: 'T10490',
    name: 'Kurbelwellenstopp T10490',
    shortLabel: 'KW-Stopp T10490',
    engagementDesc: 'Greift mit 2 Stiften ins KW-Zahnrad und rastet mit Zapfen in der Bohrung des Dichtflansches ein.',
  },
  cam: {
    code: '3359',
    name: 'Absteckdorn Nockenwelle 3359',
    shortLabel: 'NW-Dorn 3359',
    engagementDesc: 'Greift durch die Gabel am Mitnehmer/Stellarm der NW-Nabe in die Bohrung dahinter im Zylinderkopf.',
  },
  pump: {
    code: 'T10492',
    name: 'Absteckdorn Hochdruckpumpe T10492',
    shortLabel: 'HDP-Dorn T10492',
    engagementDesc: 'Greift durch die Gabel an der HDP-Nabe in die Bohrung dahinter im Aggregateträger.',
  },
};

export const CLHA_SPECIAL_TOOLS = {
  engineBridge: '10-222 A (+ Schäkel 10-222 A/12)',
  auxLockPin: 'T10060 A',
  tensionerPinTypeB: 'T10265',
  tensionerWrenchTypeB: 'T10264',
  tensionerWrenchTypeA: 'T10409 (8 mm)',
  camCounterhold: 'T10172 + T10172/11',
  pumpCounterhold: 'T10051',
} as const;

export const CLHA_TIMING_CHECK = {
  crankTurns: 2,
  crankDegrees: 720,
  camDegrees: 360,
  otPlayWindowDeg: 4,
  pointerRecheckMaxOffsetMm: 5,
} as const;

export const CLHA_MONTAGE_VALUES = {
  // Rep.-Gr. 15 — Steuertrieb
  tensionerTorqueNm: 20,
  tensionerAngleDeg: 45,
  lowerTimingCoverCaptiveBoltNm: 12,
  idlerNutNm: 20,
  idlerBoltNm: 20,
  camshaftCenterPreNm: 20,
  camshaftCenterFinalNm: 100,
  camshaftFixBoltNm: 9,
  hpPumpNutPreNm: 20,
  hpPumpNutFinalNm: 95,
  // Rep.-Gr. 19 — Kühlmittelpumpe (Referenz)
  waterPumpHousingBoltsCount: 3,
  waterPumpHousingTorqueNm: 20,
  waterPumpHousingAngleDeg: 45,
  waterPumpValveBoltNm: 8,
  // Rep.-Gr. 13 — Nebenantrieb, Schwingungsdämpfer & Motorstütze (VW Golf 08.2015 S. 53–54)
  crankDamperOuterTorqueNm: 10,
  crankDamperOuterAngleDeg: 90,
  engineSupportBoltsCount: 3,
  engineSupportStage1Nm: 7,
  engineSupportStage2Nm: 40,
  engineSupportAngleDeg: 180,
  // Rep.-Gr. 10 — Aggregatelagerung / Rechtes Motorlager (VW Golf 08.2015 S. 32)
  engineMountPos4And6Nm: 40,
  engineMountPos5Nm: 20,
  engineMountPos7Nm: 60,
  engineMountAngleDeg: 90,
  engineMountGapMm: 10,
  // Karosserie / Wartung
  wheelLinerFrontScrewNm: 2,
  wheelBoltNm: 120,
} as const;

/**
 * Verifizierte Montagewerte für VW Golf VII 1.6 TDI (EA288, MKB CLHA, 77 kW).
 * Alle Werte sind Montagewerte gemäß VW-Werkstatthandbuch 08.2015 / Wartung 06.2015 / Karosserie 02.2016.
 */
export const CLHA_FASTENING_STAGES: Record<FasteningStageId, FasteningStageSpec> = {
  tensioner_torque: {
    id: 'tensioner_torque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 2,
    stage1PillLabel: `Voranzug: ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm`,
    stage2PillLabel: `Drehwinkel: ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.tensionerTorqueNm,
    inputWindow: 1.5,
    maxValue: 30,
    scaleTicks: [0, 5, 10, 15, CLHA_MONTAGE_VALUES.tensionerTorqueNm, 25, 30],
    ratePerSec: 12,
    decimals: 1,
    label: 'Spannrollen-Mutter (Typ B): Voranzug',
    scoreLabel: 'Spannrollen-Mutter (Voranzug)',
    boltLabel: `Neue Mutter, kalter Motor — Exzenter gegenhalten (Mutter darf beim Einstellen nicht mitdrehen!). Danach +${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°.`,
    specNote: `Voranzug ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm`,
  },
  tensioner_angle: {
    id: 'tensioner_angle',
    stageKind: 'angle',
    stageIndex: 2,
    stageTotal: 2,
    stage1PillLabel: `Voranzug: ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm`,
    stage2PillLabel: `Drehwinkel: ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
    unit: '°',
    targetValue: CLHA_MONTAGE_VALUES.tensionerAngleDeg,
    inputWindow: 3,
    maxValue: 75,
    scaleTicks: [0, 15, 30, CLHA_MONTAGE_VALUES.tensionerAngleDeg, 60, 75],
    ratePerSec: 26,
    decimals: 0,
    label: 'Spannrollen-Mutter (Typ B): Drehwinkel',
    scoreLabel: 'Spannrollen-Mutter (Drehwinkel)',
    boltLabel: `Separate Winkelstufe: um ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}° weiterdrehen (Zeiger bleibt mittig).`,
    specNote: `Drehwinkel ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
  },
  cam_pretorque: {
    id: 'cam_pretorque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 1,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.camshaftCenterPreNm,
    inputWindow: 1.8,
    maxValue: 30,
    scaleTicks: [0, 5, 10, 15, CLHA_MONTAGE_VALUES.camshaftCenterPreNm, 25, 30],
    ratePerSec: 12,
    decimals: 1,
    label: 'Nockenwellenrad: Voranzug (20 Nm)',
    scoreLabel: 'Nockenwellenrad (Voranzug)',
    boltLabel: `Abb. A15-11412: ${CLHA_LOCK_TOOLS.cam.code}/${CLHA_LOCK_TOOLS.pump.code} stecken zur Positionierung; ${CLHA_SPECIAL_TOOLS.camCounterhold} hält Gegenzug (↺) — Dorne tragen kein Moment!`,
    specNote: `NW Voranzug ${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm`,
  },
  pump_pretorque: {
    id: 'pump_pretorque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 1,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.hpPumpNutPreNm,
    inputWindow: 1.8,
    maxValue: 30,
    scaleTicks: [0, 5, 10, 15, CLHA_MONTAGE_VALUES.hpPumpNutPreNm, 25, 30],
    ratePerSec: 12,
    decimals: 1,
    label: 'Hochdruckpumpenrad: Voranzug (20 Nm)',
    scoreLabel: 'Hochdruckpumpenrad (Voranzug)',
    boltLabel: `Abb. A15-11412: ${CLHA_SPECIAL_TOOLS.camCounterhold} hält Gegenzug (↺) am NW-Rad; HDP-Mutter auf ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm voranziehen.`,
    specNote: `HDP Voranzug ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm`,
  },
  cam_final_torque: {
    id: 'cam_final_torque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 1,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.camshaftCenterFinalNm,
    inputWindow: 5,
    maxValue: 130,
    scaleTicks: [0, 25, 50, 75, CLHA_MONTAGE_VALUES.camshaftCenterFinalNm, 130],
    ratePerSec: 48,
    decimals: 0,
    label: 'Nockenwellenrad: Endanzug',
    scoreLabel: 'Nockenwellenrad (Endanzug)',
    boltLabel: `Nur mit Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} (Dorn ${CLHA_LOCK_TOOLS.cam.code} gezogen!).`,
    specNote: `NW Endanzug ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm`,
  },
  pump_final_torque: {
    id: 'pump_final_torque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 1,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.hpPumpNutFinalNm,
    inputWindow: 5,
    maxValue: 125,
    scaleTicks: [0, 25, 50, 75, CLHA_MONTAGE_VALUES.hpPumpNutFinalNm, 125],
    ratePerSec: 46,
    decimals: 0,
    label: 'Hochdruckpumpenrad: Endanzug',
    scoreLabel: 'Hochdruckpumpenrad (Endanzug)',
    boltLabel: `Nur mit Gegenhalter ${CLHA_SPECIAL_TOOLS.pumpCounterhold} (Dorn ${CLHA_LOCK_TOOLS.pump.code} gezogen!).`,
    specNote: `HDP Endanzug ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm`,
  },
  engine_support_torque: {
    id: 'engine_support_torque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 2,
    stage1PillLabel: `Stufe 2: ${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm (nach ${CLHA_MONTAGE_VALUES.engineSupportStage1Nm} Nm)`,
    stage2PillLabel: `Stufe 3: +${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°`,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.engineSupportStage2Nm,
    inputWindow: 2.5,
    maxValue: 60,
    scaleTicks: [0, 10, 20, 30, CLHA_MONTAGE_VALUES.engineSupportStage2Nm, 50, 60],
    ratePerSec: 22,
    decimals: 0,
    label: 'Motorstütze (3 neue Schrauben): 40 Nm',
    scoreLabel: 'Motorstütze (Stufe 2)',
    boltLabel: `Nach ${CLHA_MONTAGE_VALUES.engineSupportStage1Nm} Nm Voranzug (Folge 1→2→3): jetzt ${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm, danach +${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°.`,
    specNote: `Stufe 2: ${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm`,
  },
  engine_support_angle: {
    id: 'engine_support_angle',
    stageKind: 'angle',
    stageIndex: 2,
    stageTotal: 2,
    stage1PillLabel: `Stufe 1/2: ${CLHA_MONTAGE_VALUES.engineSupportStage1Nm} → ${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm`,
    stage2PillLabel: `Stufe 3: +${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°`,
    unit: '°',
    targetValue: CLHA_MONTAGE_VALUES.engineSupportAngleDeg,
    inputWindow: 8,
    maxValue: 220,
    scaleTicks: [0, 45, 90, 135, CLHA_MONTAGE_VALUES.engineSupportAngleDeg, 220],
    ratePerSec: 78,
    decimals: 0,
    label: 'Motorstütze (3 neue Schrauben): +180°',
    scoreLabel: 'Motorstütze (Drehwinkel)',
    boltLabel: `Stufe 3 in Folge 1→2→3: um ${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}° weiterdrehen (Rep.-Gr. 13 S. 54).`,
    specNote: `Drehwinkel ${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°`,
  },
  crank_damper_torque: {
    id: 'crank_damper_torque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 2,
    stage1PillLabel: `Voranzug: ${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm`,
    stage2PillLabel: `Drehwinkel: +${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°`,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm,
    inputWindow: 1.0,
    maxValue: 20,
    scaleTicks: [0, 5, CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm, 15, 20],
    ratePerSec: 9,
    decimals: 1,
    label: 'Schwingungsdämpfer (4× außen): Voranzug',
    scoreLabel: 'Schwingungsdämpfer (Voranzug)',
    boltLabel: `4 neue äußere Schrauben (Bohrung über KW-Nocken): ${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm, dann +${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°.`,
    specNote: `Voranzug ${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm`,
  },
  crank_damper_angle: {
    id: 'crank_damper_angle',
    stageKind: 'angle',
    stageIndex: 2,
    stageTotal: 2,
    stage1PillLabel: `Voranzug: ${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm`,
    stage2PillLabel: `Drehwinkel: +${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°`,
    unit: '°',
    targetValue: CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg,
    inputWindow: 5,
    maxValue: 120,
    scaleTicks: [0, 30, 60, CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg, 120],
    ratePerSec: 46,
    decimals: 0,
    label: 'Schwingungsdämpfer (4× außen): +90°',
    scoreLabel: 'Schwingungsdämpfer (Drehwinkel)',
    boltLabel: `Separate Winkelstufe für alle 4 äußeren Schrauben: +${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}° weiterdrehen.`,
    specNote: `Drehwinkel ${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°`,
  },
  wheel: {
    id: 'wheel',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 1,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.wheelBoltNm,
    inputWindow: 6,
    maxValue: 160,
    scaleTicks: [0, 40, 80, CLHA_MONTAGE_VALUES.wheelBoltNm, 160],
    ratePerSec: 58,
    decimals: 0,
    label: `Serienrad, je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
    scoreLabel: `Serienrad, je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
    boltLabel: 'Sammelübung über Kreuz (1→3→5→2→4), einstufig.',
    specNote: `Serienrad: je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm über Kreuz`,
    targetLabel: `Soll: je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
  },
};

export const CLHA_ACTIVE_DATASHEET: DatasheetEntry[] = [
  {
    part: 'Nockenwellen-Zahnriemen (CLHA)',
    value: CLHA_TIMING_BELT.specLabel,
    note: `VW-Auflegereihenfolge (S. 118): ${CLHA_TIMING_BELT.vwLaySequenceText}. (z. B. CT1168K1 / VKMA 01278).`,
  },
  {
    part: 'Spannrollen-Mutter Typ B (erneuern)',
    value: `${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
    note: `Kalter Motor, Zeiger mittig im Spalt (T10264 / Typ B mit T10265; Typ A: T10409 ohne T10265). Nachprüfung nach ${CLHA_TIMING_CHECK.crankDegrees}°: max. ${CLHA_TIMING_CHECK.pointerRecheckMaxOffsetMm} mm seitlich.`,
  },
  {
    part: 'Nockenwellenrad (Zentralschraube)',
    value: `${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm → ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm`,
    note: `Voranzug ${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm unter Gegenzug (${CLHA_SPECIAL_TOOLS.camCounterhold}, Abb. A15-11412 bei gestecktem ${CLHA_LOCK_TOOLS.cam.code}/${CLHA_LOCK_TOOLS.pump.code}), danach alle Dorne abnehmen & 2× ${CLHA_TIMING_CHECK.crankDegrees}° prüfen. Endanzug ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm bei gezogenem Dorn ${CLHA_LOCK_TOOLS.cam.code} mit ${CLHA_SPECIAL_TOOLS.camCounterhold}; kleine Fixierschraube ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm erst nach Abschlusskontrolle (S. 123).`,
  },
  {
    part: 'Hochdruckpumpenrad (Mutter)',
    value: `${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm → ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm`,
    note: `Voranzug ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm unter Gegenzug (${CLHA_SPECIAL_TOOLS.camCounterhold}, Rest-Verstellweg prüfen). Endanzug ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm bei gezogenem Dorn ${CLHA_LOCK_TOOLS.pump.code} mit Gegenhalter ${CLHA_SPECIAL_TOOLS.pumpCounterhold}, danach Abschlusskontrolle (S. 123).`,
  },
  {
    part: 'Motorstütze am Block (3 neue Schrauben)',
    value: `${CLHA_MONTAGE_VALUES.engineSupportStage1Nm} → ${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm + ${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°`,
    note: 'VW Golf Rep.-Gr. 13 S. 53–54: Folge 1→2→3, Schraube 2 vor Einsetzen der Stütze einfädeln. Eigene Verbindung, getrennt vom Motorlager.',
  },
  {
    part: 'Motorlager an Längsträger (Pos. 4 & 6)',
    value: `${CLHA_MONTAGE_VALUES.engineMountPos4And6Nm} Nm + ${CLHA_MONTAGE_VALUES.engineMountAngleDeg}°`,
    note: `VW Golf Rep.-Gr. 10 S. 32 (Schrauben erneuern). Parallelspalt ${CLHA_MONTAGE_VALUES.engineMountGapMm} mm einstellen; Brücke 10-222 A erst nach Festzug entlasten.`,
  },
  {
    part: 'Motorlager seitl. Querschraube (Pos. 5)',
    value: `${CLHA_MONTAGE_VALUES.engineMountPos5Nm} Nm + ${CLHA_MONTAGE_VALUES.engineMountAngleDeg}°`,
    note: 'VW Golf Rep.-Gr. 10 S. 32: seitliche Schraube Pos. 5 erneuern.',
  },
  {
    part: 'Motorlager an Motorstütze (Pos. 7)',
    value: `${CLHA_MONTAGE_VALUES.engineMountPos7Nm} Nm + ${CLHA_MONTAGE_VALUES.engineMountAngleDeg}°`,
    note: 'VW Golf Rep.-Gr. 10 S. 32: Verbindung Motorlager an Motorstütze (neue Schrauben).',
  },
  {
    part: 'Schwingungsdämpfer KW (4× außen, neu)',
    value: `je ${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°`,
    note: 'Ausrichtbohrung über Nocken am KW-Zahnriemenrad setzen (getrennt von zentraler KW-Schraube).',
  },
  {
    part: 'Unterer Zahnriemenschutz (Bundschraube)',
    value: `${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm`,
    note: 'Unverlierbare Bundschraube unten (Passstift beachten); oberer Schutz ist separat geklipst.',
  },
  {
    part: 'Radhausschale vorn (6× T25)',
    value: `je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm`,
    note: 'Schrauben des Vorderteils beim Einbau (VW Karosserie Rep.-Gr. 66).',
  },
  {
    part: 'Serienrad (5× Radschrauben)',
    value: `je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
    note: 'Über Kreuz anziehen, einstufig (VW Wartung 06.2015).',
  },
  {
    part: 'TDI-Motorabdeckung',
    value: 'Gesteckt',
    note: 'Auf Gummizapfen gesteckt; Vorsicht an Kraftstoffrücklaufleitungen.',
  },
];

export const CLHA_REFERENCE_DATASHEET: DatasheetEntry[] = [
  {
    part: 'Keilrippenriemen (Nebenantrieb)',
    value: `Ringschlüssel + ${CLHA_SPECIAL_TOOLS.auxLockPin}`,
    note: `${AUX_DRIVE_SPEC.vwToolNote} ${AUX_DRIVE_SPEC.exampleWrenchNote}`,
  },
  {
    part: 'Ölpumpen-Zahnriemen im Ölbad (Rep.-Gr. 17)',
    value: 'Fester Achsabstand',
    note: `${OIL_PUMP_BELT_SPEC.summary} ${OIL_PUMP_BELT_SPEC.serviceNote}`,
  },
  {
    part: 'Umlenkrolle (Mutter / Schraube)',
    value: `je ${CLHA_MONTAGE_VALUES.idlerNutNm} Nm`,
    note: 'Referenz bei Rollenwechsel (im Spiel Sicht-/Lagerprüfung).',
  },
  {
    part: 'Schaltbare Kühlmittelpumpe (Gehäuse)',
    value: `${CLHA_MONTAGE_VALUES.waterPumpHousingBoltsCount}× ${CLHA_MONTAGE_VALUES.waterPumpHousingTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.waterPumpHousingAngleDeg}°`,
    note: `Referenz Pumpentausch (neue Schrauben); Kühlmittelventil-Schraube separat ${CLHA_MONTAGE_VALUES.waterPumpValveBoltNm} Nm. Neue Pumpe nie trocken drehen.`,
  },
  {
    part: 'Kraftstoffsystem entlüften (Rep.-Gr. 23)',
    value: 'Vor Motorstart',
    note: 'Nach Öffnen der Niederdruck-Schnellkupplungen A/B muss das Kraftstoffsystem per Diagnose (Vorförderpumpe) entlüftet werden (VW S. 281).',
  },
];

export const CLHA_SOURCES: ManualSourceRef[] = [
  {
    id: 'vw-ea288-engine',
    title: 'VW Golf ab 2013, 1.6 / 2.0 TDI (Leitfaden)',
    edition: 'Ausgabe 08.2015',
    section:
      'Rep.-Gr. 10 (S. 32–47 Motorbrücke 10-222 A & Motorlager) • Rep.-Gr. 13 (S. 52–54 Nebenriemen, Dämpfer & Motorstütze) • Rep.-Gr. 15 (S. 105–122 Schutz, Zahnriemen & Steuerzeiten) • Rep.-Gr. 23 (S. 281 Entlüften, S. 340 HDP)',
    href: 'https://www.scribd.com/document/678248525/VW-Golf-VII-Workshop-Manual',
  },
  {
    id: 'vw-ssp-820433',
    title: 'VW SSP 820433 — The EA288 Diesel Engine Family',
    edition: 'Selbststudienprogramm',
    section: 'Gedruckte S. 12 (PDF-S. 16): Kombinierte Öl-/Unterdruckpumpe, Zahnriemen im Motoröl, Spannung durch festen Achsabstand',
    href: 'https://www.vag-technique.fr/ext_files/ssp/vw/SSP_820433_The_EA288_Diesel_Engine_Family_EN.pdf#page=16',
  },
  {
    id: 'yt-repxpert-overview',
    title: 'YouTube: Schaeffler REPXPERT — EA288 Zahnriemenwechsel (09:48)',
    edition: 'Gesichtet • Motorständer',
    section:
      'CLHA gelistet (Motor ausgebaut am Ständer): 01:19 HDP-Dorn • 04:44 Spannrolle Typ B • 05:54 Riemenführung • 06:23 Exzenter spannen • 07:05 Gegenhalter & 20 Nm • 07:40 Durchdrehen • 08:40 Endanzug NW',
    href: 'https://www.youtube.com/watch?v=VgCSHP2WbCA',
  },
  {
    id: 'yt-repxpert-tension',
    title: 'REPXPERT Zeitmarke 06:23 — Exzenter spannen (Typ B)',
    edition: 'YouTube &t=383s',
    section: 'Nahaufnahme Spezialschlüssel am Exzenter & Spannzeiger mittig im Referenzspalt',
    href: 'https://www.youtube.com/watch?v=VgCSHP2WbCA&t=383s',
  },
  {
    id: 'yt-repxpert-counterhold',
    title: 'REPXPERT Zeitmarke 07:05 — Gegenhalter & 20-Nm-Voranzug',
    edition: 'YouTube &t=425s',
    section: 'Gegenhalter am NW-Rad, Voranzug NW-Zentralschraube & HDP-Mutter auf 20 Nm (Endanzug NW ab 08:40)',
    href: 'https://www.youtube.com/watch?v=VgCSHP2WbCA&t=425s',
  },
  {
    id: 'repxpert-chapters',
    title: 'Schaeffler REPXPERT — EA288 Kapitelübersicht',
    edition: 'Anbieter-Doku',
    section: 'Kapitelanfänge 00:00, 04:36, 05:58, 06:51, 07:26, 08:24',
    href: 'https://www.repxpert.us/en-us/training-information/vw-ea-288-repair-video',
  },
  {
    id: 'yt-usetool-access',
    title: 'YouTube: UseTool DE — Golf 7 1.6 / 2.0 TDI am Fahrzeug (31:37)',
    edition: 'Gesichtet • Fahrzeugzugang',
    section:
      'MKB nicht genannt; nutzt Wagenheber statt VW-Brücke 10-222 A: 02:18 Nebenantrieb • 02:55 Ausgleichsbehälter • 04:44 Kraftstofffilter & Leitungen • 08:00 rechtes Motorlager',
    href: 'https://www.youtube.com/watch?v=5sEcMyK53nI&t=175s',
  },
  {
    id: 'yt-usetool-fuel-mount',
    title: 'UseTool DE Zeitmarke 04:44 — Kraftstofffilter & Leitungen weglegen',
    edition: 'YouTube &t=284s',
    section: 'Zugang im eingebauten Golf VII rechts (08:00 Ausbau Motorlager: &t=480s)',
    href: 'https://www.youtube.com/watch?v=5sEcMyK53nI&t=284s',
  },
  {
    id: 'mister-auto-aux-sw16',
    title: 'Mister-Auto Tutorial: Golf 7 1.6 TDI Keilrippenriemen',
    edition: 'Fahrzeugbeispiel SW 16',
    section: 'Beleg für SW 16 am Federarm des Nebenantriebs im Fahrzeugbeispiel (VW S. 52 nennt nur Ringschlüssel + T10060 A)',
    href: 'https://www.mister-auto.de/tutorials/volkswagen/golf-7/wie-volkswagen-golf-7-1-6-tdi-keilrippenriemen-mit-spannrolle-wechseln/',
  },
  {
    id: 'gk-980316',
    title: 'GK Technische Information 980316',
    edition: 'DE',
    section: 'S. 1 Pumpenschrauben • S. 2 Steuertrieb/Schwingungsdämpfer • S. 5 Golf VII 77 kW CLHA',
    href: 'https://media.carooline.com/media/0181_DOC/980316-DE_SERVICE.PDF#page=2',
  },
  {
    id: 'vw-maintenance-wheels',
    title: 'VW Golf Wartung',
    edition: 'Ausgabe 06.2015',
    section: `Abschn. 4.51, Druck-S. 148 (Radschrauben: je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm)`,
    href: 'https://stefanosgarage.com/wp-content/uploads/2021/09/vw-mk-7-golf-gti-alltrack-maintenance-procedures-edition-06.2015-1.pdf#page=154',
  },
  {
    id: 'vw-body-exterior',
    title: 'VW Karosserie außen',
    edition: 'Ausgabe 02.2016',
    section: `Rep.-Gr. 66, Abschn. 8.1, Druck-S. 445 (Radhausschale vorn: je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm)`,
    href: 'https://stefanosgarage.com/wp-content/uploads/2021/09/vw-mk-7-golf-gti-alltrack-service-manual-body-exterior-edition-02.2016-1.pdf#page=453',
  },
  {
    id: 'skf-vkma01278',
    title: 'SKF Produktkatalog VKMA 01278',
    edition: 'Teilekatalog',
    section: `Nockenwellen-Zahnriemen: ${CLHA_TIMING_BELT.specLabel}`,
    href: 'https://www.skfvertevo.com/eap/en/product-catalogue/VKMA01278',
  },
  {
    id: 'contitech-tn57',
    title: 'ContiTech Technical News TN57 (CT1168K1)',
    edition: 'Buyers Guide',
    section: 'Zuordnung Golf VII 1.6 TDI 77 kW CLHA',
    href: 'https://app.continental-engineparts.com/technical-news-eu/17_57/docs/TN57_Buyers_Guide.pdf',
  },
];

export function formatMeasure(value: number, unit: FasteningUnit, decimals = 0): string {
  const num = decimals > 0 ? value.toFixed(decimals).replace('.', ',') : String(Math.round(value));
  return unit === '°' ? `${num}°` : `${num} ${unit}`;
}

export function formatSignedDelta(delta: number, unit: FasteningUnit, decimals = 0): string {
  const rounded = decimals > 0 ? Number(delta.toFixed(decimals)) : Math.round(delta);
  const sign = rounded >= 0 ? '+' : '−';
  const absFormatted =
    decimals > 0
      ? Math.abs(rounded).toFixed(decimals).replace('.', ',')
      : String(Math.abs(rounded));
  return unit === '°' ? `${sign}${absFormatted}°` : `${sign}${absFormatted} ${unit}`;
}
