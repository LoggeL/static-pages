// Crownward – versioniertes Speicherformat { format: 'crownward-save', version, savedAt, state }.
// Eigentum: sim-economy. Laden prüft Format, Version und Struktur; ältere Versionen laufen über MIGRATIONS.

import { BALANCE } from './config';
import type { GameState } from './types';

export const SAVE_FORMAT = 'crownward-save';
export const SAVE_VERSION = 1;
/**
 * Höchster ladbarer Tag. Weit jenseits jedes echten Spiels (9999 Tage ≈ 24 Tage Spielzeit), verhindert aber,
 * dass ein beschädigter Stand eine Welle mit Millionen Gegnern plant und den Tab aufhängt.
 */
export const MAX_DAY = 9999;

export type LoadResult =
  | {
      ok: true;
      state: GameState;
      /** Zeitstempel aus dem Speicherstand (ISO-String, vom Aufrufer beim Speichern gesetzt) */
      savedAt: string;
      /** ursprüngliche Version, falls migriert wurde, sonst null */
      migratedFrom: number | null;
    }
  | { ok: false; error: string };

type Data = Record<string, unknown>;
/** Hebt die Rohdaten eines Speicherstands von Version v auf v + 1 an. */
export type Migration = (data: Data) => Data;

/**
 * Migrationstabelle: MIGRATIONS[v] wandelt Version v in v + 1 um.
 * Version 1 ist die erste veröffentlichte Fassung – noch keine Einträge. Beispiel für künftige Versionen:
 *   2: (d) => ({ ...d, state: { ...(d.state as Data), neuesFeld: 0 } })
 */
export const MIGRATIONS: Record<number, Migration> = {};

/** Serialisiert den Spielstand als JSON-Text. savedAt wird vom Aufrufer übergeben (ISO-String). */
export function serializeGame(state: GameState, savedAt: string): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, savedAt, state });
}

/**
 * Wendet die Migrationen von fromVersion bis target nacheinander an.
 * Exportiert, damit die Kette auch mit einer Testtabelle geprüft werden kann.
 */
export function migrateSave(
  data: Data,
  fromVersion: number,
  table: Record<number, Migration> = MIGRATIONS,
  target: number = SAVE_VERSION,
): { ok: true; data: Data } | { ok: false; error: string } {
  let d = data;
  for (let v = fromVersion; v < target; v++) {
    const m = table[v];
    if (!m) return { ok: false, error: `Für Speicherstände der Version ${v} gibt es keine Umwandlung.` };
    try {
      d = m(d);
    } catch {
      return { ok: false, error: `Die Umwandlung des Speicherstands von Version ${v} ist fehlgeschlagen.` };
    }
    if (!isObj(d)) return { ok: false, error: `Die Umwandlung von Version ${v} lieferte keine gültigen Daten.` };
  }
  return { ok: true, data: d };
}

/** Liest einen Speicherstand, migriert ältere Versionen und validiert die Struktur. */
export function deserializeGame(text: string): LoadResult {
  if (typeof text !== 'string' || text.trim() === '') return fail('Kein Spielstand vorhanden.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('Der Spielstand ist beschädigt und kann nicht gelesen werden.');
  }
  if (!isObj(raw)) return fail('Der Spielstand ist beschädigt und kann nicht gelesen werden.');
  if (raw.format !== SAVE_FORMAT) return fail('Unbekanntes Dateiformat – das ist kein Crownward-Spielstand.');

  const version = raw.version;
  if (!isInt(version) || version < 1) return fail('Der Spielstand hat eine ungültige Versionsnummer.');
  if (version > SAVE_VERSION) {
    return fail(
      `Dieser Spielstand stammt aus einer neueren Spielversion (Version ${version}) und kann hier nicht geladen werden.`,
    );
  }

  let data: Data = raw;
  if (version < SAVE_VERSION) {
    const m = migrateSave(raw, version);
    if (!m.ok) return fail(m.error);
    data = m.data;
  }

  const savedAt = typeof data.savedAt === 'string' ? data.savedAt : '';
  const problem = validateState(data.state);
  if (problem) return fail(`Der Spielstand ist beschädigt: ${problem}`);
  const state = data.state as GameState;
  repairIds(state);
  return { ok: true, state, savedAt, migratedFrom: version < SAVE_VERSION ? version : null };
}

function fail(error: string): LoadResult {
  return { ok: false, error };
}

// ---------- strukturelle Prüfung ----------

const isObj = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

type Check = (v: unknown) => boolean;
const num: Check = isNum;
const int: Check = isInt;
const bool: Check = isBool;
const intOrNull: Check = (v) => v === null || isInt(v);
const side: Check = (v) => v === -1 || v === 1;
const oneOf =
  (...values: readonly unknown[]): Check =>
  (v) =>
    values.includes(v);
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v);

const ANIMS = ['idle', 'walk', 'run', 'work', 'attack', 'shoot', 'graze', 'flee', 'carry', 'hop', 'kneel'] as const;
const anim = oneOf(...ANIMS);
const ROLES = ['vagrant', 'villager', 'builder', 'archer', 'farmer'] as const;
const STRUCTURE_KINDS = ['townCenter', 'wall', 'tower', 'farm', 'toolStand', 'camp', 'chest', 'shrine', 'ship', 'rift'] as const;
const TOOLS = ['hammer', 'bow', 'scythe'] as const;

const OFFER_ACTIONS = [
  'upgradeTown',
  'buildWall',
  'upgradeWall',
  'buildTower',
  'upgradeTower',
  'buildFarm',
  'buyTool',
  'openChest',
  'activateShrine',
  'repairShip',
  'embark',
] as const;
const offerAction = oneOf(...OFFER_ACTIONS);
const payOffer: Check = (v) => v === null || (isObj(v) && offerAction(v.action) && isInt(v.toLevel) && isInt(v.cost));

const PLAYER: Record<string, Check> = {
  id: int,
  x: num,
  vx: num,
  facing: side,
  coins: (v) => isInt(v) && v >= 0,
  stamina: num,
  exhausted: bool,
  hasCrown: bool,
  invuln: num,
  actHeld: num,
  payTargetId: intOrNull,
  payProgress: int,
  payTimer: num,
  payOffer: optional(payOffer),
  purseFullAt: optional(num),
  dropCooldown: num,
  idleTime: num,
  anim,
};

const CITIZEN: Record<string, Check> = {
  id: int,
  role: oneOf(...ROLES),
  x: num,
  vx: num,
  facing: side,
  task: validTask,
  timer: num,
  timer2: num,
  campId: intOrNull,
  side,
  stunned: num,
  anim,
};

function validTask(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v.type) {
    case 'idle':
      return true;
    case 'wander':
    case 'goto':
    case 'flee':
      return isNum(v.x);
    case 'pickupCoin':
      return isInt(v.coinId);
    case 'fetchTool':
    case 'build':
    case 'repair':
    case 'farm':
      return isInt(v.structureId);
    case 'hunt':
      return isInt(v.rabbitId);
    case 'guard':
      return isNum(v.x) && intOrNull(v.towerId);
    default:
      return false;
  }
}

const ENEMY: Record<string, Check> = {
  id: int,
  kind: oneOf('mistling', 'breaker'),
  x: num,
  vx: num,
  facing: side,
  side,
  hp: num,
  maxHp: num,
  state: oneOf('advance', 'attackWall', 'attackUnit', 'flee'),
  targetId: intOrNull,
  targetKind: oneOf('structure', 'citizen', 'player', null),
  carrying: oneOf('coin', 'tool', 'crown', null),
  attackTimer: num,
  hitFlash: num,
  anim,
};

const STRUCTURE: Record<string, Check> = {
  id: int,
  kind: oneOf(...STRUCTURE_KINDS),
  x: num,
  width: (v) => isNum(v) && v > 0,
  level: (v) => isInt(v) && v >= 0,
  hp: num,
  maxHp: num,
  construction: (v) => v === null || (isObj(v) && isInt(v.toLevel) && isNum(v.progress) && isNum(v.required)),
  side: oneOf(-1, 0, 1),
  unlockLevel: int,
  tool: optional(oneOf(...TOOLS)),
  stock: optional((v) => isInt(v) && v >= 0),
  opened: optional(bool),
  reward: optional(int),
  shrine: optional(oneOf('bow', 'hammer')),
  activated: optional(bool),
  occupants: optional((v) => Array.isArray(v) && v.every(isInt)),
  spawnTimer: optional(num),
};

const COIN: Record<string, Check> = {
  id: int,
  x: num,
  y: num,
  vx: num,
  vy: num,
  age: num,
  droppedBy: intOrNull,
  pickupDelay: num,
};

const ARROW: Record<string, Check> = {
  id: int,
  x: num,
  y: num,
  vx: num,
  vy: num,
  damage: num,
  life: num,
  stuck: bool,
};

const RABBIT: Record<string, Check> = {
  id: int,
  x: num,
  vx: num,
  facing: side,
  state: oneOf('idle', 'hop', 'flee'),
  timer: num,
};

const WAVE_SPAWN: Record<string, Check> = {
  side,
  kind: oneOf('mistling', 'breaker'),
  at: num,
};

const STATS_KEYS = ['coinsCollected', 'coinsSpent', 'enemiesSlain', 'recruited', 'wallsLost', 'citizensLost', 'chestsOpened'];

/** Prüft ein Objekt gegen eine Feldspezifikation; liefert die erste Beanstandung oder null. */
function checkFields(o: unknown, spec: Record<string, Check>, where: string): string | null {
  if (!isObj(o)) return `„${where}“ fehlt oder ist kein Objekt.`;
  for (const key of Object.keys(spec)) {
    if (!spec[key](o[key])) return `Feld „${where}.${key}“ fehlt oder hat einen ungültigen Wert.`;
  }
  return null;
}

function checkArray(v: unknown, spec: Record<string, Check>, where: string): string | null {
  if (!Array.isArray(v)) return `Liste „${where}“ fehlt.`;
  for (let i = 0; i < v.length; i++) {
    const e = checkFields(v[i], spec, `${where}[${i}]`);
    if (e) return e;
  }
  return null;
}

/** Validiert die Struktur des Spielzustands. Gibt eine deutsche Fehlerbeschreibung oder null zurück. */
export function validateState(s: unknown): string | null {
  if (!isObj(s)) return 'Spielzustand fehlt.';
  if (s.schema !== 1) return 'Unbekannte Zustandsversion.';
  const top = checkFields(
    s,
    {
      seed: int,
      rng: int,
      nextId: (v) => isInt(v) && v >= 1,
      time: num,
      day: (v) => isInt(v) && v >= 1 && v <= MAX_DAY,
      // innerhalb eines Zyklus: sonst müsste der erste Schritt Millionen Tage nachholen
      dayTime: (v) => isNum(v) && v >= 0 && v < BALANCE.cycle.length,
      phase: oneOf('day', 'dusk', 'night', 'dawn'),
      coop: bool,
      outcome: oneOf('playing', 'victory', 'defeat'),
      outcomeTime: num,
    },
    'state',
  );
  if (top) return top;

  const lists: [string, Record<string, Check>][] = [
    ['players', PLAYER],
    ['citizens', CITIZEN],
    ['enemies', ENEMY],
    ['structures', STRUCTURE],
    ['coins', COIN],
    ['arrows', ARROW],
    ['rabbits', RABBIT],
  ];
  for (const [key, spec] of lists) {
    const e = checkArray(s[key], spec, key);
    if (e) return e;
  }

  const players = s.players as Data[];
  const expected = s.coop ? 2 : 1;
  if (players.length !== expected) return `Erwartet ${expected} Spielfigur(en), gefunden ${players.length}.`;
  for (let i = 0; i < players.length; i++) {
    if (players[i].id !== i) return `Spielfigur ${i + 1} hat eine ungültige Kennung.`;
  }
  const structures = s.structures as Data[];
  if (structures.filter((st) => st.kind === 'townCenter').length !== 1) return 'Das Siedlungszentrum fehlt.';

  const wave = s.wave;
  const we = checkFields(wave, { night: int, elapsed: num, paleMoon: bool }, 'wave');
  if (we) return we;
  const pe = checkArray((wave as Data).pending, WAVE_SPAWN, 'wave.pending');
  if (pe) return pe;

  const be = checkFields(s.buffs, { bowShrine: bool, hammerShrine: bool }, 'buffs');
  if (be) return be;

  const stats: Record<string, Check> = {};
  for (const k of STATS_KEYS) stats[k] = num;
  const se = checkFields(s.stats, stats, 'stats');
  if (se) return se;

  // Kennungen müssen je Liste eindeutig sein
  for (const [key] of lists) {
    const ids = new Set<number>();
    for (const e of s[key] as Data[]) {
      if (ids.has(e.id as number)) return `Doppelte Kennung ${String(e.id)} in „${key}“.`;
      ids.add(e.id as number);
    }
  }
  return null;
}

/** Sorgt dafür, dass neue Kennungen nicht mit vorhandenen kollidieren (ändert gültige Stände nicht). */
function repairIds(state: GameState): void {
  let max = 0;
  const lists: { id: number }[][] = [
    state.citizens,
    state.enemies,
    state.structures,
    state.coins,
    state.arrows,
    state.rabbits,
  ];
  for (const list of lists) for (const e of list) if (e.id > max) max = e.id;
  if (state.nextId <= max) state.nextId = max + 1;
}
