// Crownward – Stereo-Panorama und Abstandsdämpfung (rein, testbar).
// Hörer ist jeweils der dem Ereignis nächstgelegene Spieler (Koop: zwei Hörpositionen).

import { clamp } from './dsp';

/** Ab diesem Abstand (px) ist ein naher Klang nicht mehr hörbar. */
export const HEAR_RANGE = 450;
/** Bis zu diesem Abstand volle Lautstärke. */
export const FULL_RANGE = 60;
/** Versatz, bei dem das Panorama voll ausschlägt. */
export const PAN_SPAN = 340;
export const MAX_PAN = 0.85;

/**
 * near   – normale Weltklänge, hörbar bis HEAR_RANGE
 * far    – ferne Ereignisse (Grollen aus den Rissen): immer leise hörbar, Richtung erkennbar
 * global – Signale ohne Ort (Horn, Gong, Sieg): Mitte, volle Lautstärke
 */
export type SpaceMode = 'near' | 'far' | 'global';

export interface Spatial {
  gain: number;
  pan: number;
  /** Abstand zum Hörer in px (global: 0) */
  distance: number;
}

/** x-Position des nächstgelegenen Hörers oder null (keine Spieler). */
export function nearestListener(x: number, listeners: readonly number[]): number | null {
  let best: number | null = null;
  for (const lx of listeners) {
    if (best === null || Math.abs(lx - x) < Math.abs(best - x)) best = lx;
  }
  return best;
}

/** Abstandskurve 0..1: 1 bis FULL_RANGE, danach weich fallend bis 0 bei range (am Rand noch leise hörbar). */
export function distanceGain(d: number, range = HEAR_RANGE, full = FULL_RANGE): number {
  if (d <= full) return 1;
  if (d >= range) return 0;
  const u = (d - full) / (range - full);
  return (1 - u) * (1 - 0.5 * u);
}

export function panFor(dx: number): number {
  return clamp(dx / PAN_SPAN, -1, 1) * MAX_PAN;
}

/**
 * Raumparameter eines Klangs bei x. Liefert null, wenn er unhörbar ist (Klang wird dann gar nicht erzeugt).
 * Ohne Ort (x = null) oder ohne Hörer wird mittig mit voller Lautstärke gespielt.
 */
export function spatialize(x: number | null, listeners: readonly number[], mode: SpaceMode): Spatial | null {
  if (mode === 'global' || x === null) return { gain: 1, pan: 0, distance: 0 };
  const lx = nearestListener(x, listeners);
  if (lx === null) return { gain: 1, pan: 0, distance: 0 };
  const dx = x - lx;
  const d = Math.abs(dx);
  if (mode === 'far') {
    // nah wie normal, fern gedämpft bis Mindestpegel; Richtung bleibt deutlich
    const near = distanceGain(d, 900, 120);
    return { gain: 0.22 + 0.78 * near, pan: clamp(dx / 600, -1, 1) * 0.75, distance: d };
  }
  const g = distanceGain(d);
  if (g <= 0.004) return null;
  return { gain: g, pan: panFor(dx), distance: d };
}

/** Hörerpositionen aus dem Spielzustand (alle Spieler). */
export function listenerXs(players: readonly { x: number }[]): number[] {
  return players.map((p) => p.x);
}
