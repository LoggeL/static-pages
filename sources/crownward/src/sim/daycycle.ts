// Crownward – Tageszyklus: Zeit vorrücken, Phasenwechsel, Nachtwarnung, Auflösen der Nebelbrut im Morgengrauen.
// Eigentum: sim-night. Phasengrenzen in BALANCE.cycle, Phasenabfrage in daycycle-query.ts.

import { BALANCE } from './config';
import { phaseAt } from './daycycle-query';
import { dissolveEnemies } from './enemies';
import type { GameState } from './types';
import type { Emit } from './util';
import { isPaleMoon } from './waves';

/** Zeitpunkt der Nachtwarnung innerhalb des Zyklus (warningLead s vor Nachtbeginn). */
export function warningTime(): number {
  const c = BALANCE.cycle;
  return Math.max(0, c.duskEnd - c.warningLead);
}

/** Phase an dayTime angleichen; bei Wechsel melden, im Morgengrauen die Brut auflösen. */
function syncPhase(state: GameState, emit: Emit): void {
  const phase = phaseAt(state.dayTime);
  if (phase === state.phase) return;
  state.phase = phase;
  emit({ type: 'phaseChange', phase, day: state.day });
  if (phase === 'dawn' || phase === 'day') {
    dissolveEnemies(state, emit);
    state.wave.pending = []; // offene Spawns dieser Nacht verfallen
  }
}

/**
 * Rückt die Tageszeit vor. Arbeitet Grenze für Grenze ab, damit auch große Schritte (Tests, Debug-Zeitraffer)
 * jede Phase, die Nachtwarnung und den Tageswechsel genau einmal und in richtiger Reihenfolge melden.
 */
export function updateDayCycle(state: GameState, dt: number, emit: Emit): void {
  const c = BALANCE.cycle;
  if (!(state.dayTime >= 0) || !Number.isFinite(state.dayTime)) state.dayTime = 0;
  if (state.dayTime >= c.length) {
    // in einem Zug normalisieren (keine Schleife je Tag: ein beschädigter Wert wie 1e11 hinge sonst lange)
    const rest = state.dayTime % c.length;
    state.day += Math.round((state.dayTime - rest) / c.length);
    state.dayTime = rest;
  }
  const warnAt = warningTime();
  const bounds = [c.dayEnd, warnAt, c.duskEnd, c.nightEnd, c.length];
  let remaining = dt > 0 ? dt : 0;
  for (let guard = 0; guard < 1000; guard++) {
    const t = state.dayTime;
    let next = c.length;
    for (const b of bounds) if (b > t && b < next) next = b;
    if (t + remaining < next) {
      state.dayTime = t + remaining;
      break;
    }
    remaining -= next - t;
    if (next >= c.length) {
      // Zyklusende: neuer Tag beginnt
      state.dayTime = 0;
      state.day++;
    } else {
      state.dayTime = next;
    }
    if (next === warnAt) emit({ type: 'nightWarning', day: state.day, paleMoon: isPaleMoon(state.day) });
    syncPhase(state, emit);
  }
  syncPhase(state, emit);
}
