// Testhilfen für Tageszyklus, Wellen, Kampf und Niederlage (sim-night).
// tickNight() lässt NUR die Nacht-Systeme laufen (Vertragsreihenfolge, ohne Wirtschaft) – so bleiben diese
// Tests unabhängig von sim-economy. runGame() nutzt stepGame mit allen Systemen (Integration).

import { BALANCE, SIM_DT, createGame, stepGame } from '../../src/sim';
import type { Citizen, GameState, PlayerInput, Role, SimEvent, Side, Structure } from '../../src/sim';
import { updateArchers } from '../../src/sim/archers';
import { updateArrows } from '../../src/sim/arrows';
import { updateDayCycle } from '../../src/sim/daycycle';
import { phaseAt } from '../../src/sim/daycycle-query';
import { updateEnemies } from '../../src/sim/enemies';
import { updateWaves } from '../../src/sim/waves';
import { createCitizen } from '../../src/sim/world';

export type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

export function newGame(opts: { seed?: number; coop?: boolean } = {}): GameState {
  return createGame({ seed: 4242, ...opts });
}

/** Leere Bühne: keine Bürger, keine Bodenmünzen, keine Kaninchen. */
export function emptyStage(state: GameState): GameState {
  state.citizens = [];
  state.coins = [];
  state.rabbits = [];
  return state;
}

/** Tageszeit setzen und Phase passend angleichen (ohne Ereignisse). */
export function setDayTime(state: GameState, t: number): void {
  state.dayTime = t;
  state.phase = phaseAt(t);
}

/** Mitten in der Nacht, aber ohne automatische Welle (Gegner setzt der Test selbst). */
export function quietNight(state: GameState, dayTime = 160): void {
  setDayTime(state, dayTime);
  state.wave = { night: state.day, elapsed: 0, pending: [], paleMoon: false };
}

/** Nur Nacht-Systeme in Vertragsreihenfolge. */
export function tickNight(state: GameState, seconds: number, dt = SIM_DT, onStep?: (ev: SimEvent[]) => void): SimEvent[] {
  const all: SimEvent[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const ev: SimEvent[] = [];
    const emit = (e: SimEvent) => {
      ev.push(e);
    };
    state.time += dt;
    updateDayCycle(state, dt, emit);
    updateWaves(state, dt, emit);
    updateArchers(state, dt, emit);
    updateEnemies(state, dt, emit);
    updateArrows(state, dt, emit);
    all.push(...ev);
    onStep?.(ev);
  }
  return all;
}

/** Alle Systeme über stepGame. */
export function runGame(
  state: GameState,
  seconds: number,
  inputs: PlayerInput[] = [],
  onStep?: (ev: SimEvent[]) => void,
): SimEvent[] {
  const all: SimEvent[] = [];
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    const ev = stepGame(state, inputs, SIM_DT);
    all.push(...ev);
    onStep?.(ev);
  }
  return all;
}

export function ofType<T extends SimEvent['type']>(events: SimEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

export function structureAt(state: GameState, kind: Structure['kind'], x: number): Structure {
  const s = state.structures.find((q) => q.kind === kind && q.x === x);
  if (!s) throw new Error(`kein ${kind} bei x=${x}`);
  return s;
}

/** Mauer direkt in den Zustand schreiben (Stufe 0 = Bauplatz). */
export function setWall(state: GameState, x: number, level: number, hp?: number): Structure {
  const w = structureAt(state, 'wall', x);
  w.level = level;
  w.maxHp = BALANCE.wall.hp[level] ?? 0;
  w.hp = hp ?? w.maxHp;
  w.construction = null;
  return w;
}

export function setTower(state: GameState, x: number, level: number): Structure {
  const t = structureAt(state, 'tower', x);
  t.level = level;
  t.maxHp = BALANCE.tower.hp[level] ?? 0;
  t.hp = t.maxHp;
  t.construction = null;
  t.occupants = [];
  return t;
}

export function addCitizen(state: GameState, role: Role, x: number, side?: Side): Citizen {
  const c = createCitizen(state, role, x, null);
  if (side) c.side = side;
  return c;
}

/** Spieler weit weg parken (kein Ziel, beeinflusst den Nebel nicht). */
export function parkPlayers(state: GameState, x = -1800): void {
  for (const p of state.players) {
    p.x = x;
    p.vx = 0;
  }
}
