// Crownward – gemeinsame Hilfsfunktionen für alle Simulationssysteme (Eigentum: Integrations-Lead).
// Alle Zufallswerte laufen über den gespeicherten RNG-Zustand → deterministisch und speicherbar.

import { BALANCE } from './config';
import type { SimEvent } from './events';
import type { Citizen, GameState, GroundCoin, Side, Structure, StructureKind } from './types';

export type Emit = (e: SimEvent) => void;

// ---------- Zufall (mulberry32 über state.rng) ----------
export function rand(state: GameState): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randRange = (s: GameState, a: number, b: number) => a + (b - a) * rand(s);
export const randInt = (s: GameState, a: number, bInclusive: number) => a + Math.floor(rand(s) * (bInclusive - a + 1));
export const chance = (s: GameState, p: number) => rand(s) < p;

export function newId(state: GameState): number {
  return state.nextId++;
}

// ---------- Mathe ----------
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const sign = (v: number): Side => (v < 0 ? -1 : 1);
/** bewegt v um höchstens step in Richtung target */
export function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

// ---------- Abfragen ----------
export function structureById(state: GameState, id: number | null | undefined): Structure | undefined {
  if (id == null) return undefined;
  return state.structures.find((s) => s.id === id);
}
export function citizenById(state: GameState, id: number | null | undefined): Citizen | undefined {
  if (id == null) return undefined;
  return state.citizens.find((c) => c.id === id);
}
export function structuresOf(state: GameState, kind: StructureKind): Structure[] {
  return state.structures.filter((s) => s.kind === kind);
}
export function townCenter(state: GameState): Structure {
  const tc = state.structures.find((s) => s.kind === 'townCenter');
  if (!tc) throw new Error('townCenter fehlt');
  return tc;
}
/** aktuelle Siedlungsstufe (0..3) */
export function townLevel(state: GameState): number {
  return townCenter(state).level;
}
/** Abend oder Nacht: Bürger ziehen sich zurück, Bogenschützen beziehen Stellung */
export function isNightLike(state: GameState): boolean {
  return state.phase === 'dusk' || state.phase === 'night';
}
/** Mauer steht (Stufe ≥ 1 und hp > 0) */
export function wallStanding(s: Structure): boolean {
  return s.kind === 'wall' && s.level >= 1 && s.hp > 0;
}
/** äußerste stehende Mauer auf einer Seite (oder undefined) */
export function outermostWall(state: GameState, side: Side): Structure | undefined {
  let best: Structure | undefined;
  for (const s of state.structures) {
    if (!wallStanding(s) || Math.sign(s.x) !== side) continue;
    if (!best || Math.abs(s.x) > Math.abs(best.x)) best = s;
  }
  return best;
}
/** innerste stehende Mauer auf einer Seite (oder undefined) */
export function innermostWall(state: GameState, side: Side): Structure | undefined {
  let best: Structure | undefined;
  for (const s of state.structures) {
    if (!wallStanding(s) || Math.sign(s.x) !== side) continue;
    if (!best || Math.abs(s.x) < Math.abs(best.x)) best = s;
  }
  return best;
}
/**
 * Sicherer Bereich [west, ost]: zwischen den äußersten stehenden Mauern;
 * ohne Mauer auf einer Seite gilt der Lager-Radius um das Zentrum.
 */
export function safeBounds(state: GameState): [number, number] {
  const w = outermostWall(state, -1);
  const e = outermostWall(state, 1);
  const r = BALANCE.world.campRadius;
  return [w ? w.x + w.width / 2 : -r, e ? e.x - e.width / 2 : r];
}
export function isInsideWalls(state: GameState, x: number): boolean {
  const [a, b] = safeBounds(state);
  return x >= a && x <= b;
}
/**
 * Erste stehende Mauer zwischen x und dem Zentrum in Bewegungsrichtung (für Gegner auf dem Weg zum Dorf).
 * dir = Laufrichtung (+1 nach Osten). Gibt die nächstgelegene blockierende Mauer zurück.
 */
export function wallAhead(state: GameState, x: number, dir: Side): Structure | undefined {
  let best: Structure | undefined;
  for (const s of state.structures) {
    if (!wallStanding(s)) continue;
    const d = (s.x - x) * dir;
    if (d < -s.width / 2) continue;
    if (!best || (best.x - x) * dir > d) best = s;
  }
  return best;
}

/** Setzt das Spielergebnis genau einmal (Sieg oder Niederlage) und meldet es. */
export function setOutcome(state: GameState, outcome: 'victory' | 'defeat', x: number, emit: Emit): void {
  if (state.outcome !== 'playing') return;
  state.outcome = outcome;
  state.outcomeTime = state.time;
  emit({ type: outcome, x });
}

// ---------- Erzeugen ----------
/** Lässt eine Münze an x erscheinen (mit kleinem Sprung). droppedBy = Spieler, der sie fallen ließ. */
export function spawnCoin(
  state: GameState,
  x: number,
  opts: { vx?: number; vy?: number; y?: number; droppedBy?: number | null; pickupDelay?: number } = {},
): GroundCoin {
  const coin: GroundCoin = {
    id: newId(state),
    x: clamp(x, BALANCE.world.minX + 4, BALANCE.world.maxX - 4),
    y: opts.y ?? 6,
    vx: opts.vx ?? randRange(state, -25, 25),
    vy: opts.vy ?? randRange(state, 70, 120),
    age: 0,
    droppedBy: opts.droppedBy ?? null,
    pickupDelay: opts.pickupDelay ?? 0.35,
  };
  state.coins.push(coin);
  if (state.coins.length > BALANCE.coins.maxOnGround) state.coins.shift();
  return coin;
}

/**
 * Macht aus einem Bürger (nach Treffer) einen Landstreicher, der zum nächsten Lager flieht.
 * Werkzeug geht verloren. Gemeinsam genutzt von Gegner- und Bürgerlogik.
 */
export function demoteToVagrant(state: GameState, c: Citizen): void {
  // aus Turm-/Feldbelegungen entfernen
  for (const s of state.structures) {
    if (s.occupants) s.occupants = s.occupants.filter((id) => id !== c.id);
  }
  let camp: Structure | undefined;
  for (const s of state.structures) {
    if (s.kind !== 'camp') continue;
    if (!camp || Math.abs(s.x - c.x) < Math.abs(camp.x - c.x)) camp = s;
  }
  c.role = 'vagrant';
  c.campId = camp ? camp.id : null;
  c.task = { type: 'flee', x: camp ? camp.x : c.x + c.facing * 300 };
  c.stunned = BALANCE.citizens.stunAfterHit;
  c.timer = 0;
  c.timer2 = 0;
  c.anim = 'flee';
}
