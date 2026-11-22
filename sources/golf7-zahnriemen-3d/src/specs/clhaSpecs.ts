import type { FasteningUnit, LockableWheelId } from '../types';

export interface FasteningStageSpec {
  id: 'tensioner_torque' | 'tensioner_angle' | 'wheel';
  stageKind: 'torque' | 'angle';
  stageIndex: number;
  stageTotal: number;
  unit: FasteningUnit;
  targetValue: number;
  /** Spielhilfe-Eingabefenster für die Übungswertung */
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
  catalogNote: 'Nockenwellen-Zahnriemen CLHA (z. B. ContiTech CT1168K1 / SKF VKMA 01278); Schemadarstellung der Räder.',
} as const;

export const CLHA_LOCK_TOOLS: Record<
  LockableWheelId,
  { code: string; name: string; shortLabel: string }
> = {
  crank: {
    code: 'T10490',
    name: 'Kurbelwellenstopp T10490',
    shortLabel: 'KW-Stopp T10490',
  },
  cam: {
    code: '3359',
    name: 'Absteckdorn Nockenwelle 3359',
    shortLabel: 'NW-Dorn 3359',
  },
  pump: {
    code: 'T10492',
    name: 'Absteckdorn Hochdruckpumpe T10492',
    shortLabel: 'HDP-Dorn T10492',
  },
};

export const CLHA_TIMING_CHECK = {
  crankTurns: 2,
  crankDegrees: 720,
  camDegrees: 360,
  otPlayWindowDeg: 4,
  pointerRecheckMaxOffsetMm: 5,
} as const;

export const CLHA_MONTAGE_VALUES = {
  tensionerTorqueNm: 20,
  tensionerAngleDeg: 45,
  wheelBoltNm: 120,
  wheelLinerFrontScrewNm: 2,
  lowerTimingCoverCaptiveBoltNm: 12,
  idlerNutNm: 20,
  idlerBoltNm: 20,
  camshaftCenterPreNm: 20,
  camshaftCenterFinalNm: 100,
  camshaftFixBoltNm: 9,
  hpPumpNutPreNm: 20,
  hpPumpNutFinalNm: 95,
  waterPumpHousingBoltsCount: 3,
  waterPumpHousingTorqueNm: 20,
  waterPumpHousingAngleDeg: 45,
  waterPumpValveBoltNm: 8,
  crankDamperOuterTorqueNm: 10,
  crankDamperOuterAngleDeg: 90,
} as const;

/**
 * Verifizierte Montagewerte für VW Golf VII 1.6 TDI (EA288, MKB CLHA, 77 kW).
 * Alle Werte sind Montagewerte.
 */
export const CLHA_FASTENING_STAGES: Record<FasteningStageSpec['id'], FasteningStageSpec> = {
  tensioner_torque: {
    id: 'tensioner_torque',
    stageKind: 'torque',
    stageIndex: 1,
    stageTotal: 2,
    unit: 'Nm',
    targetValue: CLHA_MONTAGE_VALUES.tensionerTorqueNm,
    inputWindow: 1.5,
    maxValue: 30,
    scaleTicks: [0, 5, 10, 15, CLHA_MONTAGE_VALUES.tensionerTorqueNm, 25, 30],
    ratePerSec: 12,
    decimals: 1,
    label: 'Spannrollen-Mutter: Voranzug',
    scoreLabel: 'Spannrollen-Mutter (Voranzug)',
    boltLabel: `Mutter erneuern, Motor kalt. Danach separat ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°.`,
    specNote: `Voranzug ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm`,
  },
  tensioner_angle: {
    id: 'tensioner_angle',
    stageKind: 'angle',
    stageIndex: 2,
    stageTotal: 2,
    unit: '°',
    targetValue: CLHA_MONTAGE_VALUES.tensionerAngleDeg,
    inputWindow: 3,
    maxValue: 75,
    scaleTicks: [0, 15, 30, CLHA_MONTAGE_VALUES.tensionerAngleDeg, 60, 75],
    ratePerSec: 26,
    decimals: 0,
    label: 'Spannrollen-Mutter: Drehwinkel',
    scoreLabel: 'Spannrollen-Mutter (Drehwinkel)',
    boltLabel: `Separate Winkelstufe: um ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}° weiterdrehen.`,
    specNote: `Drehwinkel ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
    targetLabel: `Soll: ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
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
    part: 'Nockenwellen-Zahnriemen',
    value: CLHA_TIMING_BELT.specLabel,
    note: 'Schematische Raddarstellung im 3D-Modell (z. B. CT1168K1 / VKMA 01278).',
  },
  {
    part: 'Spannrollen-Mutter (erneuern)',
    value: `${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
    note: `Kalter Motor, Zeiger auf Mitte: Voranzug ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm, dann Drehwinkel ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°. Nach ${CLHA_TIMING_CHECK.crankDegrees}° Ziel Mitte (Nachprüfung max. ${CLHA_TIMING_CHECK.pointerRecheckMaxOffsetMm} mm seitlich).`,
  },
  {
    part: 'Serienrad (5× Radschrauben)',
    value: `je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
    note: 'Über Kreuz anziehen, einstufig.',
  },
  {
    part: 'Radhausschale vorn (6× T25)',
    value: `je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm`,
    note: 'Schrauben des Vorderteils beim Einbau.',
  },
  {
    part: 'Unterer Zahnriemenschutz (Bundschraube)',
    value: `${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm`,
    note: 'Unverlierbare Bundschraube unten; Gehäuseteile im Modell zusammengefasst.',
  },
  {
    part: 'TDI-Motorabdeckung',
    value: 'Gesteckt',
    note: 'Auf Gummilagerzapfen gesteckt.',
  },
];

export const CLHA_REFERENCE_DATASHEET: DatasheetEntry[] = [
  {
    part: 'Umlenkrolle (Mutter / Schraube)',
    value: `je ${CLHA_MONTAGE_VALUES.idlerNutNm} Nm`,
    note: 'Ansicht bei reiner Lagerprüfung (Umlenkrolle mit Mutter 20 Nm, mit Schraube 20 Nm).',
  },
  {
    part: 'Schaltbare Kühlmittelpumpe (Gehäuse)',
    value: `${CLHA_MONTAGE_VALUES.waterPumpHousingBoltsCount}× ${CLHA_MONTAGE_VALUES.waterPumpHousingTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.waterPumpHousingAngleDeg}°`,
    note: `Referenz Pumpentausch (neue Schrauben). Schraube Kühlmittelventil separat ${CLHA_MONTAGE_VALUES.waterPumpValveBoltNm} Nm. Im Spiel nur Lagerprüfung.`,
  },
  {
    part: 'Nockenwellenrad (Zentralschraube)',
    value: `${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm → ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm`,
    note: `Vor ${CLHA_TIMING_CHECK.crankDegrees}°-Kontrolle Voranzug ${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm, danach Endanzug ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm mit Gegenhalter. Kleine Fixierschraube separat ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm.`,
  },
  {
    part: 'Hochdruckpumpenrad (Mutter)',
    value: `${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm → ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm`,
    note: `Vor ${CLHA_TIMING_CHECK.crankDegrees}°-Kontrolle Voranzug ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm, danach Endanzug ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm mit Gegenhalter (Dorn ${CLHA_LOCK_TOOLS.pump.code} nur zum Abstecken).`,
  },
  {
    part: 'Schwingungsdämpfer KW (äußere Schrauben)',
    value: `je ${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°`,
    note: 'Optionale Zugangs-Referenz: neue äußere Befestigungsschrauben am Kurbelwellenrad (getrennt von der zentralen KW-Schraube).',
  },
];

export const CLHA_SOURCES: ManualSourceRef[] = [
  {
    id: 'vw-ea288-engine',
    title: 'VW Golf ab 2013, 1.6 / 2.0 TDI',
    edition: 'Ausgabe 08.2015',
    section:
      'Rep.-Gr. 15, Abschn. 2.1/2.2 & 2.4 (S. 105–106, 119–122) • HDP Rep.-Gr. 23, Abschn. 8.1 (S. 340)',
    href: 'https://www.scribd.com/document/678248525/VW-Golf-VII-Workshop-Manual',
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
