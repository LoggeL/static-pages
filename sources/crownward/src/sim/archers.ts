// Crownward – Bogenschützen: ausgeglichene Seitenzuteilung, Jagd am Tag, Stellung ab Abend, Schießen.
// Eigentum: sim-night. Bogenschützen entstehen in citizens.ts (Dorfbewohner holt Bogen → role 'archer')
// und werden ab dann nur hier gesteuert.
//
// Turmbelegung: tower.occupants enthält genau die Bogenschützen, die tatsächlich im Turm stehen
// (x == tower.x). Reserviert ist ein Platz bereits über task = { type: 'guard', towerId }.

import { BALANCE } from './config';
import { ENEMY_HEIGHT } from './enemies';
import type { Citizen, GameState, Rabbit, Side, Structure } from './types';
import { approach, clamp, isNightLike, newId, outermostWall, randRange, structureById, type Emit } from './util';

/** Abschusshöhe am Boden bzw. oben im Turm */
export const BOW_HEIGHT = 18;
export const TOWER_SHOT_HEIGHT = 60;
/** Lebensdauer eines fliegenden Pfeils (Sicherheitsgrenze) */
export const ARROW_LIFE = 4;
/** Dauer der Schuss-Animation (in dieser Zeit bleibt der Schütze stehen) */
const SHOOT_ANIM = 0.35;
/** Patrouillenband hinter der eigenen Mauer (Abstand nach innen) */
const PATROL_NEAR = 16;
const PATROL_FAR = 70;
/** Wachposten hinter der Mauer: Staffelung und Anzahl Reihenplätze */
const GUARD_STAGGER = 9;
const GUARD_ROWS = 4;
/** Abstand, ab dem ein Ziel (Turm/Posten) erreicht ist */
const ARRIVE = 1.5;
/** leichte Streuung der Schüsse (Anteil der Horizontalgeschwindigkeit, ±) */
const AIM_SPREAD = 0.02;

// ---------- Abfragen ----------

function towerUsable(t: Structure | undefined): t is Structure {
  return !!t && t.kind === 'tower' && t.level >= 1;
}

function towerSlots(t: Structure): number {
  return BALANCE.tower.slots[t.level] ?? 0;
}

/** Turm, in dem der Bogenschütze gerade steht (oder undefined). */
export function archerTower(state: GameState, a: Citizen): Structure | undefined {
  if (a.task.type !== 'guard' || a.task.towerId == null) return undefined;
  const t = structureById(state, a.task.towerId);
  return towerUsable(t) && Math.abs(a.x - t.x) < ARRIVE ? t : undefined;
}

/** Schussreichweite (Turm-Bonus, Schrein des Bogens). */
export function archerRange(state: GameState, inTower: boolean): number {
  const b = BALANCE.archers;
  return (b.range + (inTower ? b.towerRangeBonus : 0)) * (state.buffs.bowShrine ? b.bowShrineRangeMult : 1);
}

/** Nachladezeit (Schrein des Bogens verkürzt sie). */
export function archerReload(state: GameState): number {
  const b = BALANCE.archers;
  return b.reload * (state.buffs.bowShrine ? b.bowShrineReloadMult : 1);
}

/** Dorfrand der Seite: äußerste stehende Mauer oder der Lagerradius (Betrag). */
function edgeOf(state: GameState, side: Side): number {
  const w = outermostWall(state, side);
  return w ? Math.abs(w.x) : BALANCE.world.campRadius;
}

/** x auf der Seite side so begrenzen, dass side*x in [lo, hi] liegt. */
function clampOnSide(x: number, side: Side, lo: number, hi: number): number {
  return side * clamp(side * x, lo, hi);
}

// ---------- Ballistik ----------

/**
 * Abschussgeschwindigkeit für einen Pfeil von (x0, y0) auf ein Ziel (tx, ty), das sich mit tvx bewegt.
 * Flache Lösung bei fester Abschussgeschwindigkeit; liegt das Ziel außerhalb der ballistischen Reichweite,
 * wird mit fester Flugzeit gerechnet (schneller Pfeil). Vorhalt über zwei Iterationen.
 */
export function aimArrow(
  x0: number,
  y0: number,
  tx: number,
  ty: number,
  tvx: number,
  speed: number = BALANCE.archers.arrowSpeed,
  g: number = BALANCE.archers.arrowGravity,
): { vx: number; vy: number; t: number } {
  const solve = (dx: number, dy: number) => {
    const adx = Math.max(1, Math.abs(dx));
    const dir = dx < 0 ? -1 : 1;
    const v2 = speed * speed;
    const disc = v2 * v2 - g * (g * adx * adx + 2 * dy * v2);
    if (disc >= 0) {
      const tan = (v2 - Math.sqrt(disc)) / (g * adx);
      const cos = 1 / Math.sqrt(1 + tan * tan);
      const t = adx / (speed * cos);
      return { vx: dir * speed * cos, vy: speed * tan * cos, t };
    }
    const t = adx / (speed * 0.7);
    return { vx: dir * (adx / t), vy: (dy + 0.5 * g * t * t) / t, t };
  };
  let sol = solve(tx - x0, ty - y0);
  for (let k = 0; k < 2; k++) sol = solve(tx + tvx * sol.t - x0, ty - y0);
  return sol;
}

// ---------- Zuteilung ----------

/** Seiten ausgleichen (Unterschied höchstens 1); bevorzugt werden Schützen, die nicht im Turm stehen. */
function balanceSides(state: GameState, archers: Citizen[]): void {
  for (let guard = 0; guard < archers.length; guard++) {
    const west = archers.filter((a) => a.side === -1);
    const east = archers.filter((a) => a.side === 1);
    if (Math.abs(west.length - east.length) <= 1) return;
    const from = west.length > east.length ? west : east;
    const to: Side = west.length > east.length ? 1 : -1;
    // Kandidat: nicht im Turm, möglichst nah an der Zielseite
    let pick: Citizen | undefined;
    for (const a of from) {
      if (!pick) {
        pick = a;
        continue;
      }
      const aT = archerTower(state, a) ? 1 : 0;
      const pT = archerTower(state, pick) ? 1 : 0;
      if (aT !== pT ? aT < pT : a.x * to > pick.x * to || (a.x * to === pick.x * to && a.id > pick.id)) pick = a;
    }
    if (!pick) return;
    pick.side = to;
    pick.task = { type: 'idle' };
  }
}

/** Nachtposten zuweisen: freier Turmplatz der eigenen Seite, sonst gestaffelt hinter der äußersten Mauer. */
function assignGuardPosts(state: GameState, archers: Citizen[]): void {
  const towers = state.structures.filter((s) => towerUsable(s));
  const reserved = (t: Structure, except: Citizen) =>
    archers.filter((o) => o !== except && o.task.type === 'guard' && o.task.towerId === t.id).length;

  // 1) Türme (bestehende gültige Zuweisungen behalten)
  for (const a of archers) {
    if (a.task.type === 'guard' && a.task.towerId != null) {
      const t = structureById(state, a.task.towerId);
      if (towerUsable(t) && Math.sign(t.x) === a.side && reserved(t, a) < towerSlots(t)) continue;
    }
    const outer = outermostWall(state, a.side);
    const candidates = towers
      .filter((t) => Math.sign(t.x) === a.side && reserved(t, a) < towerSlots(t))
      .sort((p, q) => {
        // innerhalb der äußersten Mauer zuerst, dann der äußerste Turm
        const pi = !outer || Math.abs(p.x) <= Math.abs(outer.x) ? 0 : 1;
        const qi = !outer || Math.abs(q.x) <= Math.abs(outer.x) ? 0 : 1;
        return pi - qi || Math.abs(q.x) - Math.abs(p.x);
      });
    const t = candidates[0];
    a.task = t ? { type: 'guard', x: t.x, towerId: t.id } : { type: 'guard', x: a.x, towerId: null };
  }

  // 2) Mauer- bzw. Lagerposten, gestaffelt nach ID
  for (const side of [-1, 1] as const) {
    const onWall = archers
      .filter((a) => a.side === side && a.task.type === 'guard' && a.task.towerId == null)
      .sort((p, q) => p.id - q.id);
    const wall = outermostWall(state, side);
    onWall.forEach((a, i) => {
      const stagger = (i % GUARD_ROWS) * GUARD_STAGGER;
      const x = wall
        ? wall.x - side * (BALANCE.archers.guardOffset + stagger)
        : side * (BALANCE.world.campRadius - 10 - stagger);
      a.task = { type: 'guard', x, towerId: null };
    });
  }
}

/** Tagesziel: Kaninchen jagen (im erlaubten Band vor der Mauer), sonst kurz hinter der Mauer patrouillieren. */
function dayGoal(state: GameState, a: Citizen, dt: number): { x: number; speedMul: number } {
  const b = BALANCE.archers;
  const edge = edgeOf(state, a.side);
  const maxOut = edge + b.huntBeyond;
  const range = archerRange(state, false);
  const huntable = (r: Rabbit, radius: number) =>
    Math.sign(r.x) === a.side &&
    Math.abs(r.x) > edge &&
    Math.abs(r.x) <= maxOut + range &&
    Math.abs(r.x - a.x) <= radius;

  let rabbit: Rabbit | undefined;
  if (a.task.type === 'hunt') {
    const id = a.task.rabbitId;
    rabbit = state.rabbits.find((r) => r.id === id);
    if (rabbit && !huntable(rabbit, b.huntRadius * 1.3)) rabbit = undefined;
  }
  if (!rabbit) {
    let bestD = Infinity;
    for (const r of state.rabbits) {
      const d = Math.abs(r.x - a.x);
      if (d < bestD && huntable(r, b.huntRadius)) {
        rabbit = r;
        bestD = d;
      }
    }
  }
  if (rabbit) {
    a.task = { type: 'hunt', rabbitId: rabbit.id };
    // Schussposition: dorfseitig, gut in Reichweite, aber nicht weiter als erlaubt hinaus
    const want = rabbit.x - a.side * range * 0.6;
    return { x: clampOnSide(want, a.side, edge - PATROL_FAR, maxOut), speedMul: 1 };
  }

  // Patrouille kurz hinter der eigenen Mauer (ohne Mauer: am Lagerrand der eigenen Seite)
  a.timer2 -= dt;
  const inBand = (x: number) => Math.sign(x) === a.side && Math.abs(x) <= edge && Math.abs(x) >= edge - PATROL_FAR - 1;
  if (a.task.type !== 'wander' || a.timer2 <= 0 || !inBand(a.task.x)) {
    const x = a.side * Math.max(8, edge - randRange(state, PATROL_NEAR, PATROL_FAR));
    a.task = { type: 'wander', x };
    a.timer2 = randRange(state, 3, 7);
  }
  // gemächlich patrouillieren; wer noch weit weg ist (z. B. nach Seitenwechsel), geht zügig
  return { x: a.task.x, speedMul: Math.abs(a.task.x - a.x) > 120 ? 1 : 0.55 };
}

// ---------- Schießen ----------

/** Nächstes Schussziel: Gegner in Reichweite, tagsüber sonst das gejagte Kaninchen. */
function pickShot(
  state: GameState,
  a: Citizen,
  range: number,
  night: boolean,
): { x: number; y: number; vx: number } | null {
  let best: { x: number; y: number; vx: number } | null = null;
  let bestD = Infinity;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.abs(e.x - a.x);
    if (d <= range && d < bestD) {
      best = { x: e.x, y: ENEMY_HEIGHT[e.kind] * 0.45, vx: e.vx };
      bestD = d;
    }
  }
  if (best || night || a.task.type !== 'hunt') return best;
  const id = a.task.rabbitId;
  const r = state.rabbits.find((q) => q.id === id);
  if (r && Math.abs(r.x - a.x) <= range) return { x: r.x, y: 3, vx: r.vx };
  return null;
}

function fire(state: GameState, a: Citizen, inTower: boolean, target: { x: number; y: number; vx: number }, emit: Emit): void {
  const b = BALANCE.archers;
  const y0 = inTower ? TOWER_SHOT_HEIGHT : BOW_HEIGHT;
  const x0 = a.x;
  const aim = aimArrow(x0, y0, target.x, target.y, target.vx, b.arrowSpeed, b.arrowGravity);
  const spread = 1 + randRange(state, -AIM_SPREAD, AIM_SPREAD);
  state.arrows.push({
    id: newId(state),
    x: x0,
    y: y0,
    vx: aim.vx * spread,
    vy: aim.vy,
    damage: b.damage,
    life: ARROW_LIFE,
    stuck: false,
  });
  a.facing = target.x < a.x ? -1 : 1;
  a.timer = archerReload(state);
  emit({ type: 'arrowFired', x: x0, y: y0, citizenId: a.id });
}

// ---------- Schritt ----------

/** Turmbelegungen neu bestimmen: nur Schützen, die mit gültiger Zuweisung tatsächlich im Turm stehen. */
function syncTowerOccupants(state: GameState, archers: Citizen[]): void {
  for (const t of state.structures) {
    if (t.kind !== 'tower') continue;
    const ids: number[] = [];
    if (t.level >= 1) {
      for (const a of archers) {
        if (a.task.type === 'guard' && a.task.towerId === t.id && Math.abs(a.x - t.x) < ARRIVE) ids.push(a.id);
      }
    }
    t.occupants = ids.slice(0, towerSlots(t));
  }
}

export function updateArchers(state: GameState, dt: number, emit: Emit): void {
  const archers = state.citizens.filter((c) => c.role === 'archer');
  balanceSides(state, archers);
  const night = isNightLike(state);
  if (night) assignGuardPosts(state, archers);
  const reload = archerReload(state);

  for (const a of archers) {
    a.timer = Math.max(0, a.timer - dt);
    const shooting = a.timer > reload - SHOOT_ANIM;

    // Bewegung (nicht während der Schuss-Animation)
    let goalX = a.x;
    let speedMul = 1;
    if (night) {
      goalX = a.task.type === 'guard' ? a.task.x : a.x;
    } else {
      const g = dayGoal(state, a, dt);
      goalX = g.x;
      speedMul = g.speedMul;
    }
    if (!shooting) {
      const sp = (BALANCE.citizens.speed.archer ?? 38) * speedMul;
      const nx = clamp(approach(a.x, goalX, sp * dt), BALANCE.world.minX, BALANCE.world.maxX);
      a.vx = dt > 0 ? (nx - a.x) / dt : 0;
      a.x = nx;
      if (Math.abs(a.vx) > 0.5) a.facing = a.vx < 0 ? -1 : 1;
      else if (night) a.facing = a.side; // auf Posten nach außen blicken
    } else {
      a.vx = 0;
    }

    // Im Turm: exakt auf den Turm setzen
    if (night && a.task.type === 'guard' && a.task.towerId != null) {
      const t = structureById(state, a.task.towerId);
      if (towerUsable(t) && Math.abs(a.x - t.x) < ARRIVE) a.x = t.x;
    }

    // Schießen
    const inTower = !!archerTower(state, a);
    const target = pickShot(state, a, archerRange(state, inTower), night);
    if (target && a.timer <= 0) fire(state, a, inTower, target, emit);

    a.anim = a.timer > reload - SHOOT_ANIM ? 'shoot' : Math.abs(a.vx) > 0.5 ? 'walk' : 'idle';
  }

  syncTowerOccupants(state, archers);
}
