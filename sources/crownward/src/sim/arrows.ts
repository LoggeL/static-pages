// Crownward – Pfeilflug (Schwerkraft) und Treffer gegen Nebelbrut, Kaninchen und Boden.
// Eigentum: sim-night.

import { BALANCE, SIM_DT } from './config';
import { ENEMY_HEIGHT, HIT_FLASH, killEnemy } from './enemies';
import type { Arrow, Enemy, GameState, Rabbit } from './types';
import { spawnCoin, type Emit } from './util';

/** halbe Trefferbreite gegen Gegner bzw. Kaninchen */
const ENEMY_HIT_DX = 6;
const RABBIT_HIT_DX = 5;
/** Trefferhöhe eines Kaninchens */
const RABBIT_HEIGHT = 8;
/** so lange bleibt ein Pfeil sichtbar im Boden stecken */
export const STUCK_LIFE = 1.2;

function hitEnemy(state: GameState, a: Arrow): Enemy | undefined {
  let best: Enemy | undefined;
  let bestD = ENEMY_HIT_DX;
  for (const e of state.enemies) {
    if (e.hp <= 0 || a.y >= ENEMY_HEIGHT[e.kind]) continue;
    const d = Math.abs(e.x - a.x);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

function hitRabbit(state: GameState, a: Arrow): Rabbit | undefined {
  if (a.y >= RABBIT_HEIGHT) return undefined;
  let best: Rabbit | undefined;
  let bestD = RABBIT_HIT_DX;
  for (const r of state.rabbits) {
    const d = Math.abs(r.x - a.x);
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

/** Ein Pfeil, ein Teilschritt. Liefert true, wenn der Pfeil entfernt werden soll. */
function stepArrow(state: GameState, a: Arrow, h: number, emit: Emit): boolean {
  a.life -= h;
  if (a.stuck) return a.life <= 0;

  a.vy -= BALANCE.archers.arrowGravity * h;
  a.x += a.vx * h;
  a.y += a.vy * h;

  const enemy = hitEnemy(state, a);
  if (enemy) {
    enemy.hp -= a.damage;
    enemy.hitFlash = HIT_FLASH;
    emit({ type: 'enemyHit', x: enemy.x, enemyId: enemy.id, kind: enemy.kind });
    emit({ type: 'arrowHit', x: a.x, y: Math.max(0, a.y), target: 'enemy' });
    if (enemy.hp <= 0) killEnemy(state, enemy, emit);
    return true;
  }

  const rabbit = hitRabbit(state, a);
  if (rabbit) {
    state.rabbits.splice(state.rabbits.indexOf(rabbit), 1);
    spawnCoin(state, rabbit.x, { vy: 110 });
    emit({ type: 'arrowHit', x: a.x, y: Math.max(0, a.y), target: 'rabbit' });
    emit({ type: 'rabbitKilled', x: rabbit.x });
    return true;
  }

  if (a.y <= 0) {
    a.y = 0;
    a.vx = 0;
    a.vy = 0;
    a.stuck = true;
    a.life = Math.min(a.life, STUCK_LIFE);
    emit({ type: 'arrowHit', x: a.x, y: 0, target: 'ground' });
  }
  return a.life <= 0 || a.x < BALANCE.world.minX || a.x > BALANCE.world.maxX;
}

/** Pfeilflug und Treffer. Große Zeitschritte werden unterteilt, damit schnelle Pfeile nicht durchtunneln. */
export function updateArrows(state: GameState, dt: number, emit: Emit): void {
  if (state.arrows.length === 0 || !(dt > 0)) return;
  const steps = Math.max(1, Math.ceil(dt / SIM_DT - 1e-6));
  const h = dt / steps;
  for (let s = 0; s < steps && state.arrows.length > 0; s++) {
    for (let i = 0; i < state.arrows.length; ) {
      if (stepArrow(state, state.arrows[i], h, emit)) state.arrows.splice(i, 1);
      else i++;
    }
  }
}
