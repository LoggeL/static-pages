// Crownward – Stimmung nach Tageszeit: Himmelsfarben, Ebenentönung, Umgebungsdunkel, Sterne, Sonne/Mond.
// Schlüsselzeiten hängen an den Phasengrenzen aus BALANCE.cycle, damit Balancing-Änderungen mitwandern.

import { BALANCE, type DayPhase, type GameState } from '../sim';
import { clamp01, hex, lerp, mixRGB, smooth, Timeline, type RGB } from './util';

const C = BALANCE.cycle;
const PHASE_START: Record<DayPhase, number> = { day: 0, dusk: C.dayEnd, night: C.duskEnd, dawn: C.nightEnd };
const PHASE_END: Record<DayPhase, number> = { day: C.dayEnd, dusk: C.duskEnd, night: C.nightEnd, dawn: C.length };
/** Zeitpunkt im Zyklus: Phase + Anteil */
const T = (p: DayPhase, f: number) => PHASE_START[p] + (PHASE_END[p] - PHASE_START[p]) * f;

// ---------- Himmel: [Zeit, oben, Mitte, Horizont] ----------
const SKY: [number, string, string, string][] = [
  [T('day', 0), '#3d4f92', '#9a8cbc', '#f0c0a8'],
  [T('day', 0.1), '#4474b8', '#88aed8', '#dce6e6'],
  [T('day', 0.82), '#4474b8', '#8aaed6', '#e2e2da'],
  [T('day', 0.95), '#4a66a6', '#a49ec2', '#f4c88e'],
  [T('dusk', 0.35), '#363880', '#a0628e', '#f8a05c'],
  [T('dusk', 0.85), '#25265e', '#6a3e7e', '#dc7450'],
  [T('night', 0.12), '#121436', '#262456', '#4c3466'],
  [T('night', 0.3), '#090b22', '#121838', '#232850'],
  [T('night', 0.88), '#090b22', '#121838', '#232850'],
  [T('dawn', 0.35), '#1c2050', '#4a3a72', '#a46c8a'],
  [T('dawn', 0.8), '#2e3a78', '#8a6aa2', '#f0a492'],
];

// ---------- Ebenentönung: 0 Tag, 1 Abend, 2 Nacht, 3 Morgen ----------
export const TINT_DAY = 0;
export const TINT_DUSK = 1;
export const TINT_NIGHT = 2;
export const TINT_DAWN = 3;
const TINT: [number, number][] = [
  [T('day', 0), TINT_DAWN],
  [T('day', 0.12), TINT_DAY],
  [T('day', 0.9), TINT_DAY],
  [T('dusk', 0.3), TINT_DUSK],
  [T('dusk', 0.75), TINT_DUSK],
  [T('night', 0.18), TINT_NIGHT],
  [T('night', 0.9), TINT_NIGHT],
  [T('dawn', 0.5), TINT_DAWN],
];

// ---------- Umgebungsdunkel (Licht-Pass): [Zeit, Farbe, Deckkraft] ----------
const AMBIENT: [number, string, number][] = [
  [T('day', 0), '#2c2250', 0.2],
  [T('day', 0.1), '#2c2250', 0],
  [T('day', 0.88), '#3c2440', 0],
  [T('day', 0.98), '#4a2a58', 0.12],
  [T('dusk', 0.5), '#2e1c52', 0.34],
  [T('dusk', 0.95), '#161640', 0.52],
  [T('night', 0.2), '#0a0c28', 0.7],
  [T('night', 0.9), '#0a0c28', 0.7],
  [T('dawn', 0.4), '#241c4c', 0.46],
  [T('dawn', 0.85), '#3a2450', 0.28],
];

const skyTL = new Timeline(
  SKY.map((k) => k[0]),
  C.length,
);
const skyCols = SKY.map((k) => [hex(k[1]), hex(k[2]), hex(k[3])] as [RGB, RGB, RGB]);
const tintTL = new Timeline(
  TINT.map((k) => k[0]),
  C.length,
);
const ambTL = new Timeline(
  AMBIENT.map((k) => k[0]),
  C.length,
);
const ambCols = AMBIENT.map((k) => hex(k[1]));

/** Rampe: 0 vor a, 1 zwischen b und c, 0 nach d (zyklisch nicht nötig, da innerhalb eines Zyklus) */
function plateau(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) return smooth((t - a) / (b - a));
  if (t <= c) return 1;
  return smooth(1 - (t - c) / (d - c));
}

export interface Atmosphere {
  dayTime: number;
  phase: DayPhase;
  skyTop: RGB;
  skyMid: RGB;
  skyHorizon: RGB;
  /** Ebenentönung: Schlüssel a/b und Mischfaktor */
  tintA: number;
  tintB: number;
  tintF: number;
  ambient: RGB;
  /** Deckkraft des Umgebungsdunkels 0..~0.75 */
  ambientAlpha: number;
  /** 0 = Tag … 1 = tiefe Nacht */
  night: number;
  stars: number;
  fireflies: number;
  fog: number;
  /** Sonne: Bahnparameter 0..1 (Aufgang→Untergang), sichtbar wenn ≥ 0 */
  sunU: number;
  moonU: number;
  paleMoon: boolean;
  /** Wärme des Sonnenlichts (Abendrot) 0..1 */
  warmth: number;
}

export function makeAtmosphere(): Atmosphere {
  return {
    dayTime: 0,
    phase: 'day',
    skyTop: [0, 0, 0],
    skyMid: [0, 0, 0],
    skyHorizon: [0, 0, 0],
    tintA: 0,
    tintB: 0,
    tintF: 0,
    ambient: [0, 0, 0],
    ambientAlpha: 0,
    night: 0,
    stars: 0,
    fireflies: 0,
    fog: 0,
    sunU: -1,
    moonU: -1,
    paleMoon: false,
    warmth: 0,
  };
}

/** Füllt `out` für den aktuellen Zustand (keine Allokation). */
export function computeAtmosphere(state: GameState, out: Atmosphere): Atmosphere {
  const t = ((state.dayTime % C.length) + C.length) % C.length;
  out.dayTime = t;
  out.phase = state.phase;

  skyTL.sample(t);
  const A = skyCols[skyTL.a];
  const B = skyCols[skyTL.b];
  mixRGB(A[0], B[0], skyTL.f, out.skyTop);
  mixRGB(A[1], B[1], skyTL.f, out.skyMid);
  mixRGB(A[2], B[2], skyTL.f, out.skyHorizon);

  tintTL.sample(t);
  out.tintA = TINT[tintTL.a][1];
  out.tintB = TINT[tintTL.b][1];
  out.tintF = tintTL.f;

  ambTL.sample(t);
  mixRGB(ambCols[ambTL.a], ambCols[ambTL.b], ambTL.f, out.ambient);
  out.ambientAlpha = lerp(AMBIENT[ambTL.a][2], AMBIENT[ambTL.b][2], ambTL.f);
  out.night = clamp01(out.ambientAlpha / 0.7);

  out.stars = plateau(t, T('dusk', 0.45), T('night', 0.15), T('night', 0.95), T('dawn', 0.6));
  out.fireflies = plateau(t, T('day', 0.97), T('dusk', 0.5), T('night', 0.3), T('night', 0.65));
  out.fog = Math.max(
    plateau(t, T('dusk', 0.6), T('night', 0.2), T('night', 0.9), T('dawn', 0.95)),
    plateau(t, -1, 0, T('day', 0.02), T('day', 0.1)) * 0.6,
  );
  out.paleMoon = state.wave.paleMoon && (state.phase === 'night' || state.phase === 'dusk');

  // Sonne: Aufgang Mitte Morgen → Untergang Mitte Abend
  const rise = T('dawn', 0.25) - C.length;
  const set = T('dusk', 0.6);
  const tt = t > T('dawn', 0) ? t - C.length : t;
  out.sunU = tt >= rise && tt <= set ? (tt - rise) / (set - rise) : -1;
  // Mond: Aufgang am Abend, Untergang im Morgengrauen
  const mRise = T('dusk', 0.4);
  const mSet = T('dawn', 0.7);
  out.moonU = t >= mRise && t <= mSet ? (t - mRise) / (mSet - mRise) : -1;
  out.warmth = Math.max(
    plateau(t, T('day', 0.85), T('dusk', 0.2), T('dusk', 0.7), T('night', 0.15)),
    plateau(t, T('dawn', 0.2), T('dawn', 0.6), T('dawn', 1), T('dawn', 1) + 1) * 0.7,
    t < T('day', 0.08) ? 0.7 * (1 - t / T('day', 0.08)) : 0,
  );
  return out;
}
