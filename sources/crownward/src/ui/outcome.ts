// Crownward – Untertitel des Endbildschirms je nach Ursache (reine Funktion, testbar ohne DOM).

import type { GameState } from '../sim';
import { t } from './i18n';

/** Wo und wem die Krone verloren ging (aus dem Ereignis 'crownLost'). */
export interface CrownLoss {
  playerId: number;
  x: number;
}

export type DefeatCause = 'outside' | 'noWall' | 'overrun' | 'hit';

/**
 * Ursache einer Niederlage aus der Position des Kronverlusts:
 * - 'noWall':  auf dieser Inselseite wurde nie eine Mauer gebaut,
 * - 'outside': jenseits der äußersten (je gebauten) Mauer dieser Seite getroffen,
 * - 'overrun': hinter der Mauerlinie getroffen, nachdem Mauern gefallen sind,
 * - 'hit':     sonst (hinter intakten Mauern getroffen).
 * Mauern, die je standen, behalten maxHp > 0 – auch als Trümmer.
 */
export function defeatCause(state: GameState, loss: CrownLoss | null): DefeatCause {
  const lost = loss ?? fallbackLoss(state);
  if (!lost) return state.stats.wallsLost > 0 ? 'overrun' : 'hit';
  const center = state.structures.find((s) => s.kind === 'townCenter')?.x ?? 0;
  const side = lost.x >= center ? 1 : -1;
  let outer: number | null = null;
  for (const s of state.structures) {
    if (s.kind !== 'wall' || s.maxHp <= 0) continue;
    const d = (s.x - center) * side;
    if (d > 0 && (outer === null || d > outer)) outer = d;
  }
  if (outer === null) return 'noWall';
  if ((lost.x - center) * side > outer) return 'outside';
  return state.stats.wallsLost > 0 ? 'overrun' : 'hit';
}

function fallbackLoss(state: GameState): CrownLoss | null {
  const p = state.players.find((pl) => !pl.hasCrown);
  return p ? { playerId: p.id, x: p.x } : null;
}

/** Untertitel des Endbildschirms. Im Koop nennt er, wer die Krone verlor. */
export function endSubtitle(outcome: 'victory' | 'defeat', state: GameState, loss: CrownLoss | null): string {
  if (outcome === 'victory') return t('end.victorySub');
  const cause = defeatCause(state, loss);
  if (cause === 'overrun') return t('end.defeatSub');
  const lost = loss ?? fallbackLoss(state);
  const key = `end.defeatSub.${cause}`;
  if (state.coop && lost) {
    const index = state.players.findIndex((p) => p.id === lost.playerId);
    return t(`${key}Coop`, { n: (index >= 0 ? index : lost.playerId) + 1 });
  }
  return t(key);
}
