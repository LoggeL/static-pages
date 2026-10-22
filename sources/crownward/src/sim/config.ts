// Crownward – Balancing und Layout der ersten Insel. Alle Zahlen an einer Stelle.
// Sim-Agenten dürfen Werte feinjustieren (mit Begründung in docs/DESIGN.md), aber keine Schlüssel entfernen.

import type { EnemyKind, ShrineKind, StructureKind, ToolKind } from './types';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const BALANCE = {
  world: {
    minX: -3200,
    maxX: 3200,
    /** Radius um das Zentrum, der ohne Mauern als „sicher" gilt (Rückzugsziel) */
    campRadius: 90,
  },
  cycle: {
    /** Länge eines vollen Tageszyklus in Sekunden */
    length: 210,
    /** Phasengrenzen in Sekunden innerhalb des Zyklus: [dayEnd, duskEnd, nightEnd]; danach Dämmerung bis length */
    dayEnd: 130,
    duskEnd: 150,
    nightEnd: 195,
    /** Startzeit am ersten Morgen */
    startTime: 8,
    /** Vorwarnung (Ereignis nightWarning) so viele Sekunden vor Nachtbeginn */
    warningLead: 12,
  },
  player: {
    startCoins: 6,
    purseMax: 40,
    walkSpeed: 62,
    sprintSpeed: 140,
    accel: 260,
    staminaDrain: 0.13,
    staminaRegen: 0.08,
    /** Regenerationsfaktor beim Stillstehen/Grasen */
    idleRegenMult: 2.2,
    exhaustRecover: 0.3,
    pickupRadius: 14,
    interactRadius: 26,
    /** Haltedauer bis zur ersten Münze */
    payFirstDelay: 0.15,
    /** Intervall zwischen weiteren Münzen */
    payInterval: 0.26,
    dropCooldown: 0.5,
    /** dieselbe Person kann eine selbst fallengelassene Münze erst danach wieder aufheben */
    dropPickupDelay: 2.0,
    hitInvuln: 1.4,
    /** Münzverlust pro Treffer (höchstens) */
    coinsLostPerHit: 3,
  },
  coins: {
    gravity: 520,
    bounce: 0.35,
    /** Bodenmünzen verschwinden nie; Obergrenze verhindert Ausufern */
    maxOnGround: 160,
  },
  citizens: {
    speed: { vagrant: 24, villager: 34, builder: 36, archer: 38, farmer: 32 } as Record<string, number>,
    fleeMult: 1.7,
    /** Landstreicher bemerken von einem Herrscher fallengelassene Münzen (droppedBy ≠ null) in diesem Abstand */
    coinNoticeRadius: 70,
    toolPickupRadius: 8,
    workRadius: 10,
    stunAfterHit: 3,
  },
  builders: {
    /** Arbeitssekunden pro Sekunde (Schrein des Hammers multipliziert) */
    workRate: 1,
    hammerShrineMult: 1.6,
    repairHpPerSec: 4,
    hammerInterval: 0.55,
  },
  farmers: {
    /** Sekunden pro Münze und Bauer (nur tagsüber) */
    harvestInterval: 16,
    perFarm: 2,
  },
  archers: {
    range: 160,
    towerRangeBonus: 70,
    bowShrineRangeMult: 1.3,
    reload: 1.4,
    bowShrineReloadMult: 0.75,
    arrowSpeed: 260,
    arrowGravity: 300,
    damage: 1,
    /**
     * Jagdradius um die eigene Position tagsüber. Vorher 260: Von der Patrouille hinter der Mauer aus reichte das
     * kaum über die Mauer hinaus, die Jagd brachte ohne Felder nur ≈ 1 Münze am Tag (Erstspieler-Test FP-02).
     * 440 deckt die Kaninchenwiese vor der eigenen Mauer ab (rabbits.meadowSpan); weiter als huntBeyond gehen
     * die Schützen trotzdem nicht hinaus.
     */
    huntRadius: 440,
    /** tagsüber höchstens so weit vor die äußerste Mauer (bzw. den Lagerrand) der eigenen Seite */
    huntBeyond: 300,
    /** Abstand hinter der äußersten Mauer, an dem nachts Stellung bezogen wird */
    guardOffset: 18,
  },
  rabbits: {
    max: 6,
    spawnInterval: 18,
    /**
     * Kaninchen leben mit |x| in diesem Bereich – und stets mindestens wallGap vor der äußersten stehenden Mauer
     * (bzw. dem Lagerrand) ihrer Seite. Vorher fest 420..1900: Die Kaninchen hielten sich fast nie in Reichweite
     * der Schützen auf, und weil sie nie verschwanden, blockierten die fernen das Höchstmaß (FP-02).
     */
    zoneMin: 260,
    zoneMax: 1900,
    wallGap: 50,
    /** Anteil der Kaninchen, die auf der Wiese direkt vor dem Dorfrand erscheinen (Jagdgrund der Schützen) */
    meadowShare: 0.6,
    /** Breite dieser Wiese ab dem Zonenbeginn der Seite */
    meadowSpan: 320,
    /** Abends verkriechen sich Kaninchen, die weiter als dies von jedem Herrscher entfernt sind (außer Sicht) */
    burrowDistance: 400,
    speed: 30,
    fleeSpeed: 75,
    fleeRadius: 60,
  },
  camps: {
    cap: 2,
    spawnInterval: 45,
  },
  enemies: {
    mistling: { hp: 2, speed: 34, wallDamage: 1, unitDamage: 1, attackInterval: 0.55 },
    /**
     * Brecher (Durchspiel-Balance, tests/sim/playthrough.test.ts): vorher hp 14 / wallDamage 7 / 1,1 s ≈ 6,4
     * Mauerschaden je s – damit fiel schon in Nacht 3 jede Palisade trotz 4 Schützen. Jetzt ≈ 3,3/s: Stein mit
     * 8 Schützen hält bis Nacht 7, Fahlmond (5) und ab Nacht 8 braucht es deutlich mehr Schützen.
     */
    breaker: { hp: 10, speed: 20, wallDamage: 4, unitDamage: 1, attackInterval: 1.2 },
    fleeSpeedMult: 1.5,
    /** Angriffsreichweite */
    reach: 9,
    /** In diesem Abstand bemerkt die Brut Herrscher/Bürger und verfolgt sie (solange keine Mauer dazwischen steht) */
    noticeRadius: 110,
    /**
     * Nebeldrift: Die Risse liegen rund 2000 px vor den Mauern, eine Nacht dauert nur 45 s. Fern vom Dorfrand
     * und außerhalb der Sichtweite aller Herrscher treibt die Brut schnell durch den Nebel und fällt erst
     * in Sichtweite auf ihre eigentliche, gut lesbare Geschwindigkeit zurück. So erreicht jede Welle die Mauern.
     */
    fog: {
      /** Geschwindigkeit im Nebel (px/s) */
      driftSpeed: 180,
      /** Nebel beginnt so weit jenseits der äußersten Mauer (bzw. des Lagerrands) */
      edgeMargin: 220,
      /** … und so weit von jedem Herrscher entfernt (etwas mehr als eine halbe Bildschirmbreite) */
      playerMargin: 380,
    },
  } as {
    mistling: EnemyStats;
    breaker: EnemyStats;
    fleeSpeedMult: number;
    reach: number;
    noticeRadius: number;
    fog: { driftSpeed: number; edgeMargin: number; playerMargin: number };
  },
  waves: {
    /** Nacht n (1-basiert): Mistlinge pro aktiver Seite = round(base + perNight*(n-1)) */
    mistlingBase: 2,
    /** vorher 1,25; mit 1,5 wächst der Druck spürbar, ohne die Brecherentschärfung aufzuheben */
    mistlingPerNight: 1.5,
    /** Brecher ab dieser Nacht: floor((n - breakerFrom) / 2) + 1 pro Seite */
    breakerFrom: 3,
    /**
     * Westseite greift ab dieser Nacht an (Ost ab Nacht 1). Vorher 1: Die erste Nacht kam von beiden Seiten,
     * bevor man realistisch zwei Mauern und zwei Schützen haben kann. Der erste Schütze geht nach Osten
     * (Bogenständer bei +46), also kommt auch die erste Brut aus dem Osten.
     */
    westFrom: 2,
    spawnStart: 3,
    /** größter Abstand zweier Gegner einer Seite im Strom; die Hälfte davon versetzt die Westseite */
    spawnInterval: 2.6,
    /**
     * Alle Spawns einer Seite fallen in dieses Zeitfenster (ab spawnStart). Große Wellen werden dichter
     * gestaffelt, damit auch die letzten Gegner vor dem Morgengrauen die Mauern erreichen.
     */
    spawnWindow: 14,
    /**
     * Schübe (Erstspieler-Test FP-08): Vorher kamen auch kleine Wellen als Strom im Abstand von 2,6 s ab
     * Nachtbeginn – nach einem Drittel der Nacht war alles vorbei, die Gegner fielen einzeln, und keine Mauer
     * bekam etwas ab. Wellen bis groupMaxWave Gegner je Seite (Nacht 1 und 2) kommen jetzt als Vorhut
     * (Anteil leadShare) zu Nachtbeginn und als Hauptschub am Ende des spawnWindow; innerhalb eines Schubs folgen
     * die Gegner im Abstand groupGap dicht aufeinander. So füllt die Brut die ganze Nacht, und in Nacht 2 erreicht
     * der Hauptschub eine nur von einem Schützen je Seite gehaltene Mauer. Größere Wellen bleiben der bisherige
     * Strom (Balancing ab Nacht 3 unverändert, tests/sim/playthrough.test.ts).
     */
    groupMaxWave: 4,
    leadShare: 1 / 3,
    groupGap: 0.3,
    /** jede n-te Nacht ist eine Fahlmond-Nacht */
    paleMoonEvery: 5,
    paleMoonMult: 1.7,
    paleMoonExtraBreakers: 1,
  },
  /** Kosten/Bauarbeit/Freischaltung je Bauwerk und Zielstufe (Index = Zielstufe) */
  townCenter: {
    cost: [0, 5, 10, 14],
    work: [0, 10, 18, 26],
  },
  wall: {
    cost: [0, 2, 4, 8],
    work: [0, 5, 10, 16],
    hp: [0, 14, 36, 80],
    /** benötigte Siedlungsstufe je Mauerstufe */
    townReq: [0, 0, 1, 2],
  },
  tower: {
    cost: [0, 5, 9],
    work: [0, 12, 20],
    hp: [0, 30, 70],
    townReq: [0, 1, 3],
    /** Bogenschützenplätze je Stufe */
    slots: [0, 1, 2],
  },
  farm: { cost: 6, work: 14 },
  tools: {
    cost: { hammer: 3, bow: 2, scythe: 3 } as Record<ToolKind, number>,
    maxStock: 4,
  },
  shrines: { cost: 6 },
  ship: {
    /** Stufe 1..3 Reparatur, Stufe 3 = seetüchtig */
    cost: [0, 8, 12, 14],
    work: [0, 18, 26, 34],
    townReq: [0, 1, 2, 3],
  },
};

export interface EnemyStats {
  hp: number;
  speed: number;
  wallDamage: number;
  unitDamage: number;
  attackInterval: number;
}

export type EnemyStatsMap = Record<EnemyKind, EnemyStats>;

/** Bauplatz-Definition für das Insellayout. */
export interface LayoutEntry {
  kind: StructureKind;
  x: number;
  width: number;
  level?: number;
  unlockLevel?: number;
  tool?: ToolKind;
  shrine?: ShrineKind;
  reward?: number;
}

/** Erste Insel „Morgenrand". Westen = links. Schiffswrack ganz im Westen hinter dem Westriss. */
export const ISLAND_1: { name: string; layout: LayoutEntry[]; startCoinsOnGround: number[]; startVagrantsX: number[]; playerStartX: number[] } = {
  name: 'Morgenrand',
  layout: [
    { kind: 'townCenter', x: 0, width: 56, level: 0 },
    { kind: 'toolStand', x: -46, width: 18, tool: 'hammer', unlockLevel: 0 },
    { kind: 'toolStand', x: 46, width: 18, tool: 'bow', unlockLevel: 0 },
    { kind: 'toolStand', x: -82, width: 18, tool: 'scythe', unlockLevel: 1 },
    { kind: 'farm', x: 120, width: 70, unlockLevel: 1 },
    { kind: 'farm', x: -140, width: 70, unlockLevel: 2 },
    // Mauerplätze: innen (Stufe 0), Mitte (Stufe 1), außen (Stufe 2)
    { kind: 'wall', x: -210, width: 14, unlockLevel: 0 },
    { kind: 'wall', x: 210, width: 14, unlockLevel: 0 },
    { kind: 'wall', x: -390, width: 14, unlockLevel: 1 },
    { kind: 'wall', x: 390, width: 14, unlockLevel: 1 },
    { kind: 'wall', x: -610, width: 14, unlockLevel: 2 },
    { kind: 'wall', x: 610, width: 14, unlockLevel: 2 },
    // Turmplätze
    { kind: 'tower', x: -310, width: 26, unlockLevel: 1 },
    { kind: 'tower', x: 310, width: 26, unlockLevel: 1 },
    { kind: 'tower', x: -530, width: 26, unlockLevel: 2 },
    { kind: 'tower', x: 530, width: 26, unlockLevel: 2 },
    // Wildnis
    { kind: 'chest', x: 820, width: 14, reward: 8 },
    { kind: 'camp', x: -1150, width: 40 },
    { kind: 'camp', x: 1250, width: 40 },
    { kind: 'chest', x: -1500, width: 14, reward: 12 },
    { kind: 'shrine', x: 1650, width: 30, shrine: 'bow' },
    { kind: 'shrine', x: -1780, width: 30, shrine: 'hammer' },
    { kind: 'camp', x: -2050, width: 40 },
    { kind: 'camp', x: 2150, width: 40 },
    { kind: 'chest', x: 2050, width: 14, reward: 16 },
    { kind: 'chest', x: -2350, width: 14, reward: 18 },
    { kind: 'rift', x: -2600, width: 60 },
    { kind: 'rift', x: 2700, width: 60 },
    { kind: 'ship', x: -2960, width: 120, level: 0 },
  ],
  startCoinsOnGround: [-160, 150, 270, -330, 470, -560, 700],
  startVagrantsX: [-60, 60],
  playerStartX: [70, 100],
};

/** Rein dekorative Weltobjekte (nur Renderer). Deterministisch, damit Szene stabil bleibt. */
export type DecorKind =
  | 'tree.spruce'
  | 'tree.fir'
  | 'tree.pine'
  | 'tree.dead'
  | 'tree.birch'
  | 'bush'
  | 'fern'
  | 'rock'
  | 'waymarker'
  | 'torch';

export interface DecorEntry {
  kind: DecorKind;
  x: number;
  /** 0 = hinter den Figuren, 1 = vor den Figuren (Vordergrund) */
  layer: 0 | 1;
  scale: number;
}

/** Erzeugt die Dekoration der ersten Insel deterministisch (eigener kleiner RNG, unabhängig vom Spielzustand). */
export function generateDecor(seed = 1337): DecorEntry[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: DecorEntry[] = [];
  const trees: DecorKind[] = ['tree.spruce', 'tree.fir', 'tree.pine', 'tree.spruce', 'tree.dead', 'tree.birch'];
  for (let x = BALANCE.world.minX + 40; x < BALANCE.world.maxX - 40; x += 26 + rnd() * 70) {
    const ax = Math.abs(x);
    // Dorfkern frei halten, Wald wird nach außen dichter
    if (ax < 260) {
      if (rnd() < 0.18) out.push({ kind: rnd() < 0.5 ? 'bush' : 'fern', x, layer: 0, scale: 1 });
      continue;
    }
    const density = Math.min(1, (ax - 260) / 900);
    if (rnd() < 0.25 + 0.6 * density) {
      out.push({ kind: trees[Math.floor(rnd() * trees.length)], x, layer: 0, scale: 0.8 + rnd() * 0.45 });
    }
    if (rnd() < 0.3) out.push({ kind: rnd() < 0.4 ? 'rock' : rnd() < 0.5 ? 'bush' : 'fern', x: x + 12, layer: 0, scale: 1 });
    if (ax > 700 && rnd() < 0.08) out.push({ kind: 'tree.spruce', x: x + 30, layer: 1, scale: 1.25 });
  }
  out.push({ kind: 'waymarker', x: -980, layer: 0, scale: 1 });
  out.push({ kind: 'waymarker', x: 1060, layer: 0, scale: 1 });
  return out.sort((a, b) => a.x - b.x);
}
