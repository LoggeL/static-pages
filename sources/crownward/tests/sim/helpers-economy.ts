// Crownward – Testhilfen für Wirtschafts-/Bürgertests (sim-economy).
import { SIM_DT, stepGame } from '../../src/sim';
import type { Citizen, GameState, PlayerInput, Role, SimEvent, Structure, StructureKind } from '../../src/sim';
import { createCitizen } from '../../src/sim/world';

export const IDLE: PlayerInput = Object.freeze({ left: false, right: false, sprint: false, act: false });

export function inp(p: Partial<PlayerInput> = {}): PlayerInput {
  return { ...IDLE, ...p };
}

/** Hält die Welt im hellen Tag (unabhängig von der Nachtlogik). */
export function keepDay(state: GameState, at = 30): void {
  if (state.dayTime > 110 || state.phase !== 'day') state.dayTime = at;
  state.phase = 'day';
}

export type InputSource = readonly PlayerInput[] | ((state: GameState, t: number) => readonly PlayerInput[]);

/**
 * Simuliert `seconds` Sekunden in festen Schritten und sammelt alle Ereignisse.
 * Standard: Tag wird festgehalten, damit Tests nicht von der Nacht abhängen.
 */
export function run(
  state: GameState,
  seconds: number,
  inputs: InputSource = [],
  opts: { day?: boolean; until?: (s: GameState, events: SimEvent[]) => boolean } = {},
): SimEvent[] {
  const steps = Math.round(seconds / SIM_DT);
  const all: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    if (opts.day !== false) keepDay(state);
    const inp = typeof inputs === 'function' ? inputs(state, i * SIM_DT) : inputs;
    const ev = stepGame(state, inp);
    for (const e of ev) all.push(e);
    if (opts.until && opts.until(state, ev)) break;
  }
  return all;
}

export function ofType<T extends SimEvent['type']>(events: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

export function structureAt(state: GameState, kind: StructureKind, x: number): Structure {
  const s = state.structures.find((st) => st.kind === kind && st.x === x);
  if (!s) throw new Error(`Bauwerk ${kind} bei x=${x} fehlt`);
  return s;
}

export function firstOf(state: GameState, kind: StructureKind): Structure {
  const s = state.structures.find((st) => st.kind === kind);
  if (!s) throw new Error(`Bauwerk ${kind} fehlt`);
  return s;
}

export function addCitizen(state: GameState, role: Role, x: number, campId: number | null = null): Citizen {
  return createCitizen(state, role, x, campId);
}

/** Entfernt alle Bodenmünzen (z. B. die Startmünzen), damit Tests eindeutig zählen. */
export function clearCoins(state: GameState): void {
  state.coins.length = 0;
}

/** Hält act für `seconds` gedrückt und lässt dann einen Schritt los. */
export function holdAct(state: GameState, seconds: number, player = 0): SimEvent[] {
  const pressed = state.players.map((_, i) => (i === player ? inp({ act: true }) : IDLE));
  const ev = run(state, seconds, pressed);
  return ev.concat(run(state, SIM_DT, []));
}

/** Kurzer Tastendruck (ein Schritt act, dann loslassen). */
export function tapAct(state: GameState, player = 0): SimEvent[] {
  const pressed = state.players.map((_, i) => (i === player ? inp({ act: true }) : IDLE));
  return run(state, SIM_DT, pressed).concat(run(state, SIM_DT, []));
}

/** Zustand als normalisierter JSON-Text (für Gleichheitsvergleiche). */
export function snapshot(state: GameState): string {
  return JSON.stringify(state);
}
