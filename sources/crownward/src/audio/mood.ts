// Crownward – Stimmung aus dem Spielzustand: Zielpegel für Musik und Ambiente (rein, testbar).

import { phaseProgress, type GameState } from '../sim';
import { clamp01 } from './dsp';

export type MusicMood = 'title' | 'day' | 'dusk' | 'night' | 'dawn' | 'victory' | 'defeat';

export interface MoodTargets {
  music: MusicMood;
  /** Pegel der gezupften Instrumente 0..1 */
  melody: number;
  /** tiefer Spannungsdrone 0..1 */
  drone: number;
  /** zusätzliche dissonante Fahlmond-Schicht 0..1 */
  paleDrone: number;
  /** Bedrohung durch nahe Gegner 0..1 → Trommelpuls */
  threat: number;
  /** Wind 0..1 */
  wind: number;
  /** Brandung an den Inselrändern 0..1 */
  sea: number;
  /** Vogelrufe pro Sekunde */
  birds: number;
  /** Grillenzirpen pro Sekunde */
  crickets: number;
  /** Tiefpass der Musik (Hz): abends wärmer, pausiert gedämpft */
  musicCutoff: number;
  /** 1 = normal, < 1 = gedämpft (Pause) */
  duck: number;
}

/** Bedrohung: nächster Gegner zu irgendeinem Spieler; Brecher wiegen schwerer, Gruppen verstärken. */
export function threatLevel(state: GameState): number {
  if (state.enemies.length === 0 || state.players.length === 0) return 0;
  let top = 0;
  let near = 0;
  for (const e of state.enemies) {
    let d = Infinity;
    for (const p of state.players) d = Math.min(d, Math.abs(e.x - p.x));
    let t = clamp01(1 - (d - 100) / 360);
    if (e.kind === 'breaker') t *= 1.2;
    if (e.state === 'flee') t *= 0.5;
    if (t > 0.05) near++;
    if (t > top) top = t;
  }
  return clamp01(top + 0.06 * Math.max(0, near - 1));
}

/** Nähe zum Meer an den Inselrändern (0 = Inland, 1 = Ufer). */
export function seaProximity(xs: readonly number[]): number {
  let m = 0;
  for (const x of xs) m = Math.max(m, clamp01((Math.abs(x) - 2650) / 400));
  return m;
}

/** Nähe zu einem Nebelriss (0..1). */
export function riftProximity(state: GameState): number {
  let best = 0;
  for (const s of state.structures) {
    if (s.kind !== 'rift') continue;
    for (const p of state.players) best = Math.max(best, clamp01(1 - (Math.abs(p.x - s.x) - 80) / 420));
  }
  return best;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function computeMood(state: GameState | null, paused: boolean): MoodTargets {
  let m: MoodTargets;
  if (!state) {
    m = { music: 'title', melody: 0.9, drone: 0, paleDrone: 0, threat: 0, wind: 0.32, sea: 0.4, birds: 0.1, crickets: 0, musicCutoff: 5200, duck: 1 };
  } else {
    const { phase, t } = phaseProgress(state);
    const pale = state.wave.paleMoon && (phase === 'night' || phase === 'dusk');
    const xs = state.players.map((p) => p.x);
    const sea = seaProximity(xs);
    const rift = riftProximity(state);
    switch (phase) {
      case 'day':
        m = { music: 'day', melody: 1, drone: 0, paleDrone: 0, threat: 0, wind: 0.42, sea, birds: 0.32, crickets: 0, musicCutoff: 7000, duck: 1 };
        break;
      case 'dusk':
        m = {
          music: 'dusk',
          melody: lerp(0.75, 0.5, t),
          drone: lerp(0.2, 0.65, t),
          paleDrone: pale ? t * 0.7 : 0,
          threat: 0,
          wind: 0.52,
          sea,
          birds: 0.12 * (1 - t),
          crickets: lerp(0.25, 1, t),
          musicCutoff: 2600,
          duck: 1,
        };
        break;
      case 'night':
        m = {
          music: 'night',
          melody: pale ? 0.3 : 0.45,
          drone: 0.9,
          paleDrone: pale ? 0.85 : 0,
          threat: 0,
          wind: 0.68,
          sea,
          birds: 0,
          crickets: pale ? 0.7 : 1.4,
          musicCutoff: 1500,
          duck: 1,
        };
        break;
      case 'dawn':
        m = {
          music: 'dawn',
          melody: 0.8,
          drone: 0.3 * (1 - t),
          paleDrone: 0,
          threat: 0,
          wind: 0.42,
          sea,
          birds: 1.1,
          crickets: 0.3 * (1 - t),
          musicCutoff: 5000,
          duck: 1,
        };
        break;
    }
    // Gegner in der Nähe → Trommelpuls (unabhängig von der Phase, solange Nebelbrut unterwegs ist)
    m.threat = threatLevel(state);
    // Nähe zu den Rissen: unheimliches Brummen auch tagsüber
    m.drone = Math.max(m.drone, rift * 0.5);
    if (state.outcome === 'victory') {
      m = { ...m, music: 'victory', melody: 1, drone: 0, paleDrone: 0, threat: 0, musicCutoff: 7000 };
    } else if (state.outcome === 'defeat') {
      m = { ...m, music: 'defeat', melody: 0.6, drone: 0.6, paleDrone: 0, threat: 0, birds: 0, musicCutoff: 1800 };
    }
  }
  if (paused) {
    m.duck = 0.35;
    m.musicCutoff = Math.min(m.musicCutoff, 900);
    m.birds *= 0.3;
    m.crickets *= 0.3;
    m.threat *= 0.3;
  }
  return m;
}
