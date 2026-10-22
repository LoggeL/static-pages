// Crownward – Münzphysik am Boden: Schwerkraft, Abprallen, Gleitreibung, Alter und Aufhebesperre.
// Eigentum: sim-economy. Aufheben übernehmen players.ts (Herrscher) und citizens.ts (Landstreicher).

import { BALANCE } from './config';
import type { GameState } from './types';
import { approach, type Emit } from './util';

/** Gleitreibung am Boden (px/s²) – Münzen rutschen nach dem Aufprall kurz nach */
const GROUND_FRICTION = 220;
/** unterhalb dieser Aufprallgeschwindigkeit bleibt die Münze liegen statt erneut zu springen */
const MIN_BOUNCE_VY = 35;
/** horizontale Dämpfung bei jedem Aufprall */
const BOUNCE_VX_KEEP = 0.7;
/** Abstand zum Weltrand */
const EDGE = 4;

export function updateCoins(state: GameState, dt: number, emit: Emit): void {
  void emit; // Münzen erzeugen keine eigenen Ereignisse (Aufheben meldet players.ts)
  const K = BALANCE.coins;
  const lo = BALANCE.world.minX + EDGE;
  const hi = BALANCE.world.maxX - EDGE;

  for (const c of state.coins) {
    c.age += dt;
    if (c.pickupDelay > 0) c.pickupDelay = Math.max(0, c.pickupDelay - dt);

    // Flugphase: Schwerkraft und Abprallen
    if (c.y > 0 || c.vy !== 0) {
      c.vy -= K.gravity * dt;
      c.y += c.vy * dt;
      if (c.y <= 0) {
        c.y = 0;
        if (-c.vy > MIN_BOUNCE_VY) {
          c.vy = -c.vy * K.bounce;
          c.vx *= BOUNCE_VX_KEEP;
        } else {
          c.vy = 0;
        }
      }
    }

    // horizontale Bewegung, am Boden mit Reibung
    if (c.vx !== 0) {
      c.x += c.vx * dt;
      if (c.y <= 0 && c.vy === 0) c.vx = approach(c.vx, 0, GROUND_FRICTION * dt);
    }

    if (c.x < lo) {
      c.x = lo;
      c.vx = 0;
    } else if (c.x > hi) {
      c.x = hi;
      c.vx = 0;
    }
  }
}

/** Münze liegt ruhig am Boden (für Landstreicher, die sie bemerken). */
export function coinResting(c: { y: number; vy: number }): boolean {
  return c.y <= 0.01 && c.vy === 0;
}
