// Crownward – Wildnis: Landstreicherlager bringen Landstreicher hervor, Kaninchen hoppeln und fliehen.
// Eigentum: sim-economy. Abschuss der Kaninchen (Münze) macht arrows.ts (sim-night).

import { BALANCE } from './config';
import type { GameState, Rabbit, Side } from './types';
import { chance, isInsideWalls, newId, outermostWall, rand, randRange, sign, type Emit } from './util';
import { createCitizen } from './world';

/** Kaninchen erscheinen nicht direkt vor den Augen eines Spielers */
const RABBIT_SPAWN_MIN_DIST = 180;
/** Abstand der Kaninchen zum Weltrand */
const RABBIT_EDGE = 30;
/** Fluchtdauer nach dem letzten Sichtkontakt */
const RABBIT_FLEE_TIME = 0.5;

export function updateWildlife(state: GameState, dt: number, emit: Emit): void {
  updateCamps(state, dt, emit);
  burrowRabbits(state);
  spawnRabbits(state, dt);
  for (const r of state.rabbits) updateRabbit(state, r, dt);
}

// ---------- Landstreicherlager ----------

function updateCamps(state: GameState, dt: number, emit: Emit): void {
  const K = BALANCE.camps;
  const daytime = state.phase === 'day';
  for (const s of state.structures) {
    if (s.kind !== 'camp') continue;
    let count = 0;
    for (const c of state.citizens) if (c.role === 'vagrant' && c.campId === s.id) count++;
    if (count >= K.cap) {
      // Lager voll: der nächste Landstreicher folgt ein volles Intervall nach dem nächsten freien Platz
      s.spawnTimer = K.spawnInterval;
      continue;
    }
    if (!daytime) continue; // nachts ruht das Lager
    s.spawnTimer = (s.spawnTimer ?? K.spawnInterval) - dt;
    if (s.spawnTimer > 0) continue;
    s.spawnTimer = K.spawnInterval;
    const c = createCitizen(state, 'vagrant', s.x + randRange(state, -s.width / 3, s.width / 3), s.id);
    c.task = { type: 'idle' };
    c.timer = randRange(state, 0.5, 2);
    c.facing = rand(state) < 0.5 ? -1 : 1;
    emit({ type: 'vagrantSpawn', x: c.x, citizenId: c.id });
  }
}

// ---------- Kaninchen ----------

/**
 * Beginn der Kaninchenzone einer Seite (Betrag von x): mindestens zoneMin und stets wallGap vor der äußersten
 * stehenden Mauer (ohne Mauer: vor dem Lagerrand). Wächst das Dorf, weicht die Wiese mit nach außen.
 */
export function rabbitZoneMin(state: GameState, side: Side): number {
  const R = BALANCE.rabbits;
  const w = outermostWall(state, side);
  const edge = w ? Math.abs(w.x) + w.width / 2 : BALANCE.world.campRadius;
  return Math.min(R.zoneMax - R.meadowSpan, Math.max(R.zoneMin, edge + R.wallGap));
}

/**
 * Abends verkriechen sich alle Kaninchen, die kein Herrscher sieht. So füllen sie das Höchstmaß nicht dauerhaft
 * in fernen Wäldern aus, und am nächsten Tag hoppeln neue auf der Wiese vor dem Dorf.
 */
function burrowRabbits(state: GameState): void {
  if (state.phase !== 'dusk' || state.rabbits.length === 0) return;
  const reach = BALANCE.rabbits.burrowDistance;
  for (let i = state.rabbits.length - 1; i >= 0; i--) {
    const r = state.rabbits[i];
    if (!state.players.some((p) => Math.abs(p.x - r.x) <= reach)) state.rabbits.splice(i, 1);
  }
}

function spawnRabbits(state: GameState, dt: number): void {
  const R = BALANCE.rabbits;
  if (state.phase !== 'day' || state.rabbits.length >= R.max) return;
  // Poisson-Prozess: im Mittel ein Kaninchen je spawnInterval
  if (!chance(state, dt / R.spawnInterval)) return;
  const side: Side = rand(state) < 0.5 ? -1 : 1;
  // die meisten auf der Wiese direkt vor dem Dorfrand (Jagdgrund), die übrigen irgendwo in der Wildnis
  const lo = rabbitZoneMin(state, side);
  const hi = rand(state) < R.meadowShare ? Math.min(R.zoneMax, lo + R.meadowSpan) : R.zoneMax;
  const x = side * randRange(state, lo, hi);
  if (isInsideWalls(state, x)) return;
  for (const p of state.players) if (Math.abs(p.x - x) < RABBIT_SPAWN_MIN_DIST) return;
  state.rabbits.push({
    id: newId(state),
    x,
    vx: 0,
    facing: rand(state) < 0.5 ? -1 : 1,
    state: 'idle',
    timer: randRange(state, 0.5, 2),
  });
}

/** x-Position der nächstgelegenen Bedrohung (Spieler/Bürger) im Fluchtradius, sonst null. */
function nearestThreat(state: GameState, x: number, radius: number): number | null {
  let best: number | null = null;
  let bestD = radius;
  for (const p of state.players) {
    const d = Math.abs(p.x - x);
    if (d <= bestD) {
      best = p.x;
      bestD = d;
    }
  }
  for (const c of state.citizens) {
    const d = Math.abs(c.x - x);
    if (d <= bestD) {
      best = c.x;
      bestD = d;
    }
  }
  return best;
}

function updateRabbit(state: GameState, r: Rabbit, dt: number): void {
  const R = BALANCE.rabbits;
  const threat = nearestThreat(state, r.x, R.fleeRadius);
  if (threat !== null) {
    const dir: Side = threat === r.x ? r.facing : sign(r.x - threat);
    r.state = 'flee';
    r.vx = dir * R.fleeSpeed;
    r.facing = dir;
    r.timer = RABBIT_FLEE_TIME;
  }

  switch (r.state) {
    case 'flee':
    case 'hop':
      r.timer -= dt;
      if (r.timer <= 0) {
        r.state = 'idle';
        r.vx = 0;
        r.timer = randRange(state, 0.8, 3);
      }
      break;
    case 'idle': {
      r.vx = 0;
      r.timer -= dt;
      if (r.timer <= 0) {
        // zurück in die eigene Zone tendieren, sonst zufällig
        const ax = Math.abs(r.x);
        let dir: Side;
        if (ax < rabbitZoneMin(state, sign(r.x))) dir = sign(r.x);
        else if (ax > R.zoneMax) dir = r.x < 0 ? 1 : -1;
        else dir = rand(state) < 0.5 ? -1 : 1;
        r.state = 'hop';
        r.vx = dir * R.speed;
        r.facing = dir;
        r.timer = randRange(state, 0.3, 0.8);
      }
      break;
    }
  }

  r.x += r.vx * dt;
  const lo = BALANCE.world.minX + RABBIT_EDGE;
  const hi = BALANCE.world.maxX - RABBIT_EDGE;
  if (r.x < lo || r.x > hi) {
    r.x = r.x < lo ? lo : hi;
    r.vx = 0;
    r.state = 'idle';
    r.timer = randRange(state, 0.5, 1.5);
  }
}
