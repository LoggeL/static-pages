// Crownward – reine Abfragen zum Tageszyklus (für Renderer/UI/Audio). Eigentum: Integrations-Lead.
import { BALANCE } from './config';
import type { DayPhase, GameState } from './types';

/** Phase für eine Zeit innerhalb des Zyklus. */
export function phaseAt(dayTime: number): DayPhase {
  const c = BALANCE.cycle;
  if (dayTime < c.dayEnd) return 'day';
  if (dayTime < c.duskEnd) return 'dusk';
  if (dayTime < c.nightEnd) return 'night';
  return 'dawn';
}

/** Anteil des aktuellen Zyklus 0..1 (0 = Tagesbeginn). */
export function cycleFraction(state: GameState): number {
  return state.dayTime / BALANCE.cycle.length;
}

/** Aktuelle Phase und Fortschritt 0..1 innerhalb dieser Phase. */
export function phaseProgress(state: GameState): { phase: DayPhase; t: number; remaining: number } {
  const c = BALANCE.cycle;
  const bounds: Record<DayPhase, [number, number]> = {
    day: [0, c.dayEnd],
    dusk: [c.dayEnd, c.duskEnd],
    night: [c.duskEnd, c.nightEnd],
    dawn: [c.nightEnd, c.length],
  };
  const phase = phaseAt(state.dayTime);
  const [a, b] = bounds[phase];
  return { phase, t: (state.dayTime - a) / (b - a), remaining: b - state.dayTime };
}
