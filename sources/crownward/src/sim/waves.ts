// Crownward – Wellen der Nebelbrut: Planung bei Nachtbeginn, Spawns aus den Rissen während der Nacht.
// Eigentum: sim-night. Der Plan liegt vollständig in state.wave (speicherbar); Zufall nur über rand(state).

import { BALANCE } from './config';
import { riftX, spawnEnemy } from './enemies';
import type { EnemyKind, GameState, Side, WaveSpawn, WaveState } from './types';
import { randRange, type Emit } from './util';

/** zufällige Streuung je Spawn (Anteil des Intervalls, ±) */
const JITTER = 0.25;
/** Gegner erscheinen bis zu so weit vor ihrem Riss (Richtung Dorf) */
const SPAWN_SPREAD = 14;

export interface WaveSize {
  mistlings: number;
  breakers: number;
}

/** Fahlmond-Nacht (jede paleMoonEvery-te Nacht, 1-basiert). */
export function isPaleMoon(night: number): boolean {
  const every = BALANCE.waves.paleMoonEvery;
  return every > 0 && night > 0 && night % every === 0;
}

/** Wellenstärke einer Seite in Nacht n (siehe docs/DESIGN.md §4). */
export function waveSize(night: number, side: Side): WaveSize {
  const w = BALANCE.waves;
  if (night < 1 || (side === -1 && night < w.westFrom)) return { mistlings: 0, breakers: 0 };
  let mistlings = Math.round(w.mistlingBase + w.mistlingPerNight * (night - 1));
  let breakers = night >= w.breakerFrom ? Math.floor((night - w.breakerFrom) / 2) + 1 : 0;
  if (isPaleMoon(night)) {
    mistlings = Math.round(mistlings * w.paleMoonMult);
    breakers += w.paleMoonExtraBreakers;
  }
  return { mistlings, breakers };
}

/** Spawn-Reihenfolge einer Seite: ein Mistling voran, dann Brecher (langsam) früh im Wechsel mit Mistlingen. */
export function waveSequence(size: WaveSize): EnemyKind[] {
  const seq: EnemyKind[] = [];
  let m = size.mistlings;
  let b = size.breakers;
  if (m > 0) {
    seq.push('mistling');
    m--;
  }
  while (m > 0 || b > 0) {
    if (b > 0) {
      seq.push('breaker');
      b--;
    }
    if (m > 0) {
      seq.push('mistling');
      m--;
    }
  }
  return seq;
}

/** Abstand zweier Gegner derselben Seite innerhalb eines Schubs bzw. im Strom. */
function spawnGap(n: number): number {
  const w = BALANCE.waves;
  if (n <= 1) return w.groupGap;
  const stream = w.spawnWindow / (n - 1);
  return n > w.groupMaxWave ? Math.min(w.spawnInterval, stream) : Math.min(w.groupGap, stream);
}

/**
 * Zeitplan einer Seite (Sekunden ab spawnStart, ohne Streuung).
 * - Kleine Wellen (2..groupMaxWave Gegner) kommen in zwei Schüben: eine Vorhut (Anteil leadShare, mindestens
 *   einer) gleich zu Nachtbeginn und der Hauptschub am Ende des spawnWindow – die Nacht bleibt bis kurz vor dem
 *   Morgengrauen belebt und steigert sich. Innerhalb eines Schubs liegen groupGap Sekunden zwischen zwei Gegnern.
 * - Größere Wellen kommen als Strom über das spawnWindow (Abstand höchstens spawnInterval).
 */
export function waveSchedule(n: number): number[] {
  const w = BALANCE.waves;
  if (n <= 0) return [];
  if (n === 1) return [0];
  const gap = spawnGap(n);
  if (n > w.groupMaxWave) return Array.from({ length: n }, (_, i) => i * gap);
  const lead = Math.max(1, Math.floor(n * w.leadShare));
  const main = n - lead;
  const out: number[] = [];
  for (let i = 0; i < lead; i++) out.push(i * gap);
  for (let j = 0; j < main; j++) out.push(w.spawnWindow - (main - 1 - j) * gap);
  return out;
}

/** Plant die Welle für Nacht n: Spawns beider Risse, nach Zeit sortiert (Sekunden nach Nachtbeginn). */
export function planWave(state: GameState, night: number): WaveState {
  const w = BALANCE.waves;
  const pending: WaveSpawn[] = [];
  for (const side of [1, -1] as const) {
    const seq = waveSequence(waveSize(night, side));
    if (seq.length === 0) continue;
    const times = waveSchedule(seq.length);
    const gap = spawnGap(seq.length);
    // Westen leicht versetzt, damit beide Seiten nicht im Gleichschritt kommen
    const offset = side === -1 ? (seq.length > w.groupMaxWave ? gap : w.spawnInterval) * 0.5 : 0;
    for (let i = 0; i < seq.length; i++) {
      const jitter = randRange(state, -JITTER, JITTER) * gap;
      pending.push({ side, kind: seq[i], at: Math.max(0, w.spawnStart + offset + times[i] + jitter) });
    }
  }
  pending.sort((a, b) => a.at - b.at);
  return { night, elapsed: 0, pending, paleMoon: isPaleMoon(night) };
}

/** Plant bei Nachtbeginn die Welle (einmal je Nacht) und lässt fällige Gegner an den Rissen erscheinen. */
export function updateWaves(state: GameState, dt: number, emit: Emit): void {
  if (state.phase !== 'night') return;
  if (state.wave.night !== state.day) state.wave = planWave(state, state.day);
  const wave = state.wave;
  wave.elapsed += dt;
  while (wave.pending.length > 0 && wave.pending[0].at <= wave.elapsed) {
    const sp = wave.pending.shift() as WaveSpawn;
    const x = riftX(state, sp.side) - sp.side * randRange(state, 0, SPAWN_SPREAD);
    spawnEnemy(state, sp.kind, sp.side, x, emit);
  }
}
