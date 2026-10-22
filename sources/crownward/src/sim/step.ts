// Crownward – ein fester Simulationsschritt. Reihenfolge der Systeme ist Teil des Vertrags (docs/DESIGN.md).

import { SIM_DT } from './config';
import type { SimEvent } from './events';
import type { GameState, PlayerInput } from './types';
import type { Emit } from './util';
import { updateDayCycle } from './daycycle';
import { updateWaves } from './waves';
import { updatePlayers } from './players';
import { updateCoins } from './coins';
import { updateWildlife } from './wildlife';
import { updateCitizens } from './citizens';
import { updateArchers } from './archers';
import { updateEnemies } from './enemies';
import { updateArrows } from './arrows';

export const NO_INPUT: PlayerInput = Object.freeze({ left: false, right: false, sprint: false, act: false });

/** Rundungstoleranz: ein dt, das nur durch Gleitkommafehler über SIM_DT liegt, bleibt ein einzelner Schritt */
const SUBSTEP_EPS = 1e-6;

/**
 * Rückt die Simulation um dt Sekunden vor (Standard: 1/60 s) und liefert die Ereignisse dieses Schritts.
 * inputs[i] gehört zu state.players[i]; fehlende Einträge gelten als „keine Eingabe".
 * Nach Sieg/Niederlage läuft die Welt weiter (für die Darstellung), Eingaben werden ignoriert.
 *
 * dt > SIM_DT wird in gleich lange Teilschritte ≤ SIM_DT zerlegt (Eingaben gelten für alle Teilschritte).
 * Münzphysik, Angriffstakte und Wellen sind auf den festen Schritt ausgelegt; so liefert stepGame(s, i, 1)
 * dieselbe Welt wie 60 × stepGame(s, i, 1/60). Die Rechenzeit wächst entsprechend linear mit dt.
 */
export function stepGame(state: GameState, inputs: readonly PlayerInput[], dt: number = SIM_DT): SimEvent[] {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError(`stepGame: ungültiger Zeitschritt ${dt}`);
  const events: SimEvent[] = [];
  const emit = (e: SimEvent) => {
    events.push(e);
  };
  const n = dt > SIM_DT ? Math.ceil(dt / SIM_DT - SUBSTEP_EPS) : 1;
  const h = n > 1 ? dt / n : dt;
  for (let i = 0; i < n; i++) substep(state, inputs, h, emit);
  return events;
}

function substep(state: GameState, inputs: readonly PlayerInput[], dt: number, emit: Emit): void {
  const effectiveInputs = state.outcome === 'playing' ? inputs : [];
  state.time += dt;

  updateDayCycle(state, dt, emit); // Tageszeit, Phasenwechsel, Nachtwarnung, Auflösen bei Dämmerung
  updateWaves(state, dt, emit); // Wellenplanung und Gegner-Spawns aus den Rissen
  updatePlayers(state, effectiveInputs, dt, emit); // Reiten, Ausdauer, Münzen aufheben/zahlen, Käufe
  updateCoins(state, dt, emit); // Münzphysik
  updateWildlife(state, dt, emit); // Landstreicherlager, Kaninchen
  updateCitizens(state, dt, emit); // Landstreicher, Dorfbewohner, Bauleute, Bauern (nicht Bogenschützen)
  updateArchers(state, dt, emit); // Bogenschützen: Jagd, Stellung, Schießen
  updateEnemies(state, dt, emit); // Nebelbrut: Vorrücken, Mauern/Einheiten angreifen, Stehlen, Flucht
  updateArrows(state, dt, emit); // Pfeilflug und Treffer
}
