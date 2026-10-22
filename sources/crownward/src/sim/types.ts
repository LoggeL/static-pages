// Crownward – Simulationszustand (reine Daten, JSON-serialisierbar, kein DOM).
// Koordinaten: x = Weltposition in logischen Pixeln (0 = Siedlungszentrum, West < 0 < Ost),
// y = Höhe über dem Boden (0 = Boden, positiv nach oben). Zeit in Sekunden.
// VERTRAG: Änderungen an diesen Typen nur durch den Integrations-Lead (siehe docs/DESIGN.md).

export type Side = -1 | 1; // -1 = Westen/links, +1 = Osten/rechts
export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';
export type Outcome = 'playing' | 'victory' | 'defeat';

/** Eingabe eines Spielers für einen Simulationsschritt (gehaltene Tasten). */
export interface PlayerInput {
  left: boolean;
  right: boolean;
  sprint: boolean;
  /** Münze zahlen / fallen lassen (gehalten = weiter einzahlen). */
  act: boolean;
}

export type AnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'work'
  | 'attack'
  | 'shoot'
  | 'graze'
  | 'flee'
  | 'carry'
  | 'hop'
  | 'kneel';

export interface Player {
  id: number; // 0 = Spieler 1, 1 = Spieler 2
  x: number;
  vx: number;
  facing: Side;
  coins: number;
  /** 0..1 */
  stamina: number;
  /** true nach völliger Erschöpfung, bis stamina >= BALANCE.player.exhaustRecover */
  exhausted: boolean;
  hasCrown: boolean;
  /** Restzeit der Unverwundbarkeit nach einem Treffer */
  invuln: number;
  /** Sekunden, die "act" ununterbrochen gehalten wird (0 = losgelassen) */
  actHeld: number;
  /** Bauwerk, in das gerade eingezahlt wird */
  payTargetId: number | null;
  /** bereits in die Kostenslots gelegte Münzen */
  payProgress: number;
  /** Zeit bis zur nächsten Münze in den Slot */
  payTimer: number;
  /**
   * Angebot, für das die laufende Zahlung begann (null/fehlend = keine Zahlung oder älterer Stand).
   * Ändert sich das Angebot mittendrin (z. B. Mauer fällt), wird abgebrochen und erstattet.
   */
  payOffer?: PayOffer | null;
  /** state.time der letzten purseFull-Meldung (Drosselung; im Zustand, damit Laden den Ereignisstrom nicht ändert) */
  purseFullAt?: number;
  /** Abklingzeit nach dem Fallenlassen einer Münze ins Freie */
  dropCooldown: number;
  /** Sekunden ohne Bewegung (für Grasen/Ausdauer) */
  idleTime: number;
  anim: AnimState;
}

export type Role = 'vagrant' | 'villager' | 'builder' | 'archer' | 'farmer';
export type ToolKind = 'hammer' | 'bow' | 'scythe';
export type ShrineKind = 'bow' | 'hammer';

export type CitizenTask =
  | { type: 'idle' }
  | { type: 'wander'; x: number }
  | { type: 'goto'; x: number }
  | { type: 'pickupCoin'; coinId: number }
  | { type: 'fetchTool'; structureId: number }
  | { type: 'build'; structureId: number }
  | { type: 'repair'; structureId: number }
  | { type: 'farm'; structureId: number }
  | { type: 'hunt'; rabbitId: number }
  | { type: 'guard'; x: number; towerId: number | null }
  | { type: 'flee'; x: number };

export interface Citizen {
  id: number;
  role: Role;
  x: number;
  vx: number;
  facing: Side;
  task: CitizenTask;
  /** Allzweck-Timer (Nachladen, Wandern, Erntetakt …) */
  timer: number;
  /** zweiter Timer (z. B. Hammerschlag-Takt) */
  timer2: number;
  /** Heimatlager eines Landstreichers */
  campId: number | null;
  /** bevorzugte Verteidigungsseite (Bogenschützen) bzw. Wanderseite */
  side: Side;
  /** Sekunden, in denen die Figur nach einem Treffer betäubt/fliehend ist */
  stunned: number;
  anim: AnimState;
}

export type EnemyKind = 'mistling' | 'breaker';
export type EnemyState = 'advance' | 'attackWall' | 'attackUnit' | 'flee';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  vx: number;
  facing: Side;
  /** Seite, von der der Gegner kam (sein Riss) */
  side: Side;
  hp: number;
  maxHp: number;
  state: EnemyState;
  /** angegriffenes Ziel: Bauwerk-, Bürger- oder Spieler-ID (siehe targetKind) */
  targetId: number | null;
  targetKind: 'structure' | 'citizen' | 'player' | null;
  carrying: 'coin' | 'tool' | 'crown' | null;
  attackTimer: number;
  /** >0: kurz nach Treffer (Renderer: Aufblitzen) */
  hitFlash: number;
  anim: AnimState;
}

export type StructureKind =
  | 'townCenter'
  | 'wall'
  | 'tower'
  | 'farm'
  | 'toolStand'
  | 'camp'
  | 'chest'
  | 'shrine'
  | 'ship'
  | 'rift';

export interface Construction {
  toLevel: number;
  /** geleistete Bauarbeit in Arbeitssekunden */
  progress: number;
  /** benötigte Bauarbeit in Arbeitssekunden */
  required: number;
}

export interface Structure {
  id: number;
  kind: StructureKind;
  x: number;
  /** Breite der Grundfläche (Interaktion/Blockade) */
  width: number;
  /** 0 = Bauplatz/unbebaut (wall/tower/farm), Stufe (townCenter 0..3, ship 0..3) */
  level: number;
  /** Trefferpunkte (Mauern, Türme). Andere Bauwerke: 0 */
  hp: number;
  maxHp: number;
  construction: Construction | null;
  /** -1 West, 1 Ost, 0 Zentrum */
  side: -1 | 0 | 1;
  /** benötigte Siedlungsstufe, damit dieser Bauplatz erscheint/angeboten wird */
  unlockLevel: number;
  // --- art-spezifisch (optional) ---
  tool?: ToolKind; // toolStand
  stock?: number; // toolStand: bereitliegende Werkzeuge
  opened?: boolean; // chest
  reward?: number; // chest: Münzen
  shrine?: ShrineKind; // shrine
  activated?: boolean; // shrine
  /** Bürger-IDs: Bauern auf dem Feld (farm) bzw. Bogenschützen im Turm (tower) */
  occupants?: number[];
  /** camp: Zeit bis zum nächsten Landstreicher */
  spawnTimer?: number;
}

export interface GroundCoin {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Sekunden seit Erscheinen */
  age: number;
  /** Spieler-ID, die diese Münze gerade fallen ließ (darf sie erst nach pickupDelay aufheben) */
  droppedBy: number | null;
  pickupDelay: number;
}

export interface Arrow {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  /** Sekunden bis zum Verschwinden */
  life: number;
  /** steckt im Boden (nur noch Optik bis life abläuft) */
  stuck: boolean;
}

export interface Rabbit {
  id: number;
  x: number;
  vx: number;
  facing: Side;
  state: 'idle' | 'hop' | 'flee';
  timer: number;
}

export interface WaveSpawn {
  side: Side;
  kind: EnemyKind;
  /** Sekunden nach Nachtbeginn */
  at: number;
}

export interface WaveState {
  /** Nacht-Nummer, zu der diese Welle gehört (1-basiert), 0 = keine */
  night: number;
  /** Sekunden seit Beginn der aktuellen Nacht/Welle */
  elapsed: number;
  pending: WaveSpawn[];
  /** Fahlmond-Nacht (verstärkte Welle) */
  paleMoon: boolean;
}

export interface Buffs {
  /** Schrein des Bogens aktiviert */
  bowShrine: boolean;
  /** Schrein des Hammers aktiviert */
  hammerShrine: boolean;
}

export interface GameStats {
  coinsCollected: number;
  coinsSpent: number;
  enemiesSlain: number;
  recruited: number;
  wallsLost: number;
  citizensLost: number;
  chestsOpened: number;
}

export interface GameState {
  /** Schema-Version des Zustands (für Speicherstände) */
  schema: 1;
  seed: number;
  /** aktueller RNG-Zustand (mulberry32) */
  rng: number;
  nextId: number;
  /** gesamte Simulationszeit */
  time: number;
  /** aktueller Tag, 1-basiert */
  day: number;
  /** Sekunden innerhalb des aktuellen Tageszyklus */
  dayTime: number;
  phase: DayPhase;
  coop: boolean;
  players: Player[];
  citizens: Citizen[];
  enemies: Enemy[];
  structures: Structure[];
  coins: GroundCoin[];
  arrows: Arrow[];
  rabbits: Rabbit[];
  wave: WaveState;
  buffs: Buffs;
  outcome: Outcome;
  /** Simulationszeit, zu der das Ergebnis feststand */
  outcomeTime: number;
  stats: GameStats;
}

export type OfferAction =
  | 'upgradeTown'
  | 'buildWall'
  | 'upgradeWall'
  | 'buildTower'
  | 'upgradeTower'
  | 'buildFarm'
  | 'buyTool'
  | 'openChest'
  | 'activateShrine'
  | 'repairShip'
  | 'embark';

/** Kennzeichen des Angebots, in das gerade eingezahlt wird (Player.payOffer). */
export interface PayOffer {
  action: OfferAction;
  toLevel: number;
  cost: number;
}

/** Kaufangebot eines Bauwerks für einen Spieler in Reichweite. */
export interface Offer {
  structureId: number;
  action: OfferAction;
  /** Münzkosten (0 = kostenlos, z. B. Truhe öffnen, Ablegen) */
  cost: number;
  /** Zielstufe nach dem Kauf (falls zutreffend) */
  toLevel: number;
  /** i18n-Schlüssel für die Beschriftung, z. B. 'offer.buildWall.1' (siehe src/ui/i18n.ts) */
  labelKey: string;
  /** gesetzt, wenn das Angebot sichtbar, aber gesperrt ist (i18n-Schlüssel, z. B. 'blocked.building') */
  blockedKey: string | null;
}
