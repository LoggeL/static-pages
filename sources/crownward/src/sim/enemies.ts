// Crownward – Nebelbrut: Vorrücken aus den Rissen, Angriffe auf Herrscher, Bürger und Mauern, Stehlen, Flucht.
// Eigentum: sim-night. Reine Simulation (kein DOM, Zufall nur über rand(state)).
//
// Zielwahl je Schritt (nur Ziele in Reichweite, keine stehende Mauer dazwischen):
//   Herrscher mit Krone (nicht unverwundbar) > Bürger (kein Landstreicher, nicht betäubt, nicht im Turm)
//   > stehende Mauer auf dem Weg. Mauern blockieren den Durchgang vollständig.
// Ohne Ziel in Reichweite: verfolgen, was in Sichtweite ist, sonst Richtung Zentrum vorrücken.

import { BALANCE, type EnemyStats } from './config';
import type { Citizen, Enemy, EnemyKind, GameState, Player, Side, Structure } from './types';
import {
  approach,
  clamp,
  demoteToVagrant,
  newId,
  outermostWall,
  randRange,
  setOutcome,
  spawnCoin,
  wallAhead,
  wallStanding,
  type Emit,
} from './util';

/** Trefferhöhe je Gegnerart: Pfeile treffen unterhalb dieser Höhe */
export const ENEMY_HEIGHT: Record<EnemyKind, number> = { mistling: 16, breaker: 40 };

/** Dauer des Aufblitzens nach einem Treffer */
export const HIT_FLASH = 0.15;

/** zusätzliche Treffweite gegen berittene Herrscher (der Pferdekörper reicht über den Mittelpunkt hinaus) */
const PLAYER_BODY = 8;
/** Haltabstand vor der Mauerfront; je Gegner leicht gestaffelt, damit sie sich nicht exakt überdecken */
const WALL_GAP = 2;
const WALL_STAGGER = 1.5;
/** Anteil des Angriffstakts bis zum ersten Schlag nach einem Zielwechsel (Ausholen) */
const WINDUP = 0.5;
/** Abstand, ab dem ein fliehender Gegner seinen Riss erreicht hat */
const RIFT_REACH = 6;

type UnitTarget = { kind: 'player'; p: Player; x: number; id: number } | { kind: 'citizen'; c: Citizen; x: number; id: number };

/** Einmal je Schritt vorberechnet: Mauern (Stand bei jeder Nutzung erneut geprüft) und Bogenschützen in Türmen. */
interface StepCtx {
  walls: Structure[];
  towerArchers: Set<number>;
}

function makeCtx(state: GameState): StepCtx {
  const walls: Structure[] = [];
  const towerArchers = new Set<number>();
  for (const s of state.structures) {
    if (s.kind === 'wall') walls.push(s);
    else if (s.kind === 'tower' && s.occupants) for (const id of s.occupants) towerArchers.add(id);
  }
  return { walls, towerArchers };
}

// ---------- Abfragen ----------

/** x-Position des Nebelrisses einer Seite (Fallback: nahe dem Weltrand). */
export function riftX(state: GameState, side: Side): number {
  for (const s of state.structures) if (s.kind === 'rift' && Math.sign(s.x) === side) return s.x;
  return side === 1 ? BALANCE.world.maxX - 60 : BALANCE.world.minX + 60;
}

/**
 * Steht zwischen a (Angreifer) und b (Ziel) eine stehende Mauer? Ein Ziel genau auf der Mauerlinie gilt
 * als geschützt.
 */
export function wallBetween(state: GameState, a: number, b: number): boolean {
  return blockedByWall(state.structures, a, b);
}

function blockedByWall(walls: readonly Structure[], a: number, b: number): boolean {
  for (const w of walls) {
    if (!wallStanding(w)) continue;
    const da = a - w.x;
    const db = b - w.x;
    if (da === 0) continue;
    if (db === 0 || da > 0 !== db > 0) return true;
  }
  return false;
}

/** Angreifbarer Bürger: kein Landstreicher, nicht betäubt, nicht oben im Turm (dort unerreichbar). */
function isCitizenTarget(ctx: StepCtx, c: Citizen): boolean {
  return c.role !== 'vagrant' && c.stunned <= 0 && !(c.role === 'archer' && ctx.towerArchers.has(c.id));
}

/**
 * Nächstes Einheiten-Ziel im Radius. Herrscher haben Vorrang vor Bürgern.
 * hittable = true: nur tatsächlich angreifbare Ziele (Herrscher nicht unverwundbar).
 */
function findUnit(state: GameState, ctx: StepCtx, e: Enemy, radius: number, hittable: boolean): UnitTarget | null {
  let best: UnitTarget | null = null;
  let bestD = Infinity;
  // Nach Sieg/Niederlage sind Herrscher kein Ziel mehr (die Welt läuft nur noch zur Darstellung weiter)
  for (const p of state.outcome === 'playing' ? state.players : []) {
    if (!p.hasCrown || (hittable && p.invuln > 0)) continue;
    const d = Math.abs(p.x - e.x);
    if (d > radius + PLAYER_BODY || d >= bestD) continue;
    if (blockedByWall(ctx.walls, e.x, p.x)) continue;
    best = { kind: 'player', p, x: p.x, id: p.id };
    bestD = d;
  }
  if (best) return best;
  for (const c of state.citizens) {
    if (!isCitizenTarget(ctx, c)) continue;
    const d = Math.abs(c.x - e.x);
    if (d > radius || d >= bestD) continue;
    if (blockedByWall(ctx.walls, e.x, c.x)) continue;
    best = { kind: 'citizen', c, x: c.x, id: c.id };
    bestD = d;
  }
  return best;
}

/**
 * Hinter ihrem eigenen Riss duldet die Brut keine Krone: Wer sich nachts dort versteckt (z. B. beim Schiffswrack),
 * wird gewittert und gejagt. Ohne diese Regel wäre die Werft ein sicheres Versteck und die Krone nie in Gefahr.
 */
function crownBeyondRift(state: GameState, e: Enemy): UnitTarget | null {
  if (state.outcome !== 'playing') return null;
  const rift = Math.abs(riftX(state, e.side));
  let best: UnitTarget | null = null;
  for (const p of state.players) {
    if (!p.hasCrown || Math.sign(p.x) !== e.side || Math.abs(p.x) <= rift) continue;
    if (!best || Math.abs(p.x - e.x) < Math.abs(best.x - e.x)) best = { kind: 'player', p, x: p.x, id: p.id };
  }
  return best;
}

/** Treibt der Gegner gerade im Nebel (fern vom Dorfrand und von allen Herrschern)? */
export function enemyInFog(state: GameState, e: Enemy): boolean {
  const side: Side = e.x < 0 ? -1 : 1;
  const wall = outermostWall(state, side);
  const edge = Math.max(wall ? Math.abs(wall.x) : 0, BALANCE.world.campRadius);
  const fog = BALANCE.enemies.fog;
  if (Math.abs(e.x) < edge + fog.edgeMargin) return false;
  for (const p of state.players) if (Math.abs(p.x - e.x) < fog.playerMargin) return false;
  return true;
}

/** Ruheziel im Zentrum, wenn nichts mehr im Weg ist (deterministisches Umherstreifen ohne Zufall). */
function hoverX(state: GameState, e: Enemy): number {
  return Math.sin(state.time * 0.5 + e.id * 1.3) * BALANCE.world.campRadius * 0.6;
}

// ---------- Erzeugen / Entfernen ----------

/** Erzeugt einen Gegner (Standard: am Riss seiner Seite) und meldet enemySpawn, falls emit übergeben wird. */
export function spawnEnemy(state: GameState, kind: EnemyKind, side: Side, x?: number, emit?: Emit): Enemy {
  const st = BALANCE.enemies[kind];
  const e: Enemy = {
    id: newId(state),
    kind,
    x: x ?? riftX(state, side),
    vx: 0,
    facing: side === 1 ? -1 : 1,
    side,
    hp: st.hp,
    maxHp: st.hp,
    state: 'advance',
    targetId: null,
    targetKind: null,
    carrying: null,
    attackTimer: 0,
    hitFlash: 0,
    anim: 'walk',
  };
  state.enemies.push(e);
  emit?.({ type: 'enemySpawn', x: e.x, side, kind });
  return e;
}

/** Erlegt einen Gegner sofort: entfernen, Statistik, getragene Münze fällt zu Boden. */
export function killEnemy(state: GameState, e: Enemy, emit: Emit): void {
  const i = state.enemies.indexOf(e);
  if (i < 0) return;
  state.enemies.splice(i, 1);
  if (e.carrying === 'coin') spawnCoin(state, e.x, { vy: 110 });
  state.stats.enemiesSlain++;
  emit({ type: 'enemyDied', x: e.x, kind: e.kind });
}

/** Morgengrauen: alle Gegner lösen sich auf; getragene Münzen fallen als Bodenmünzen. Liefert die Anzahl. */
export function dissolveEnemies(state: GameState, emit: Emit): number {
  const count = state.enemies.length;
  if (count === 0) return 0;
  const xs: number[] = [];
  for (const e of state.enemies) {
    xs.push(e.x);
    if (e.carrying === 'coin') spawnCoin(state, e.x, { vy: 90 });
  }
  state.enemies.length = 0;
  emit({ type: 'enemiesDissolved', count, xs });
  return count;
}

// ---------- Treffer ----------

function startFlee(e: Enemy, carrying: 'coin' | 'tool' | 'crown'): void {
  e.carrying = carrying;
  e.state = 'flee';
  e.targetId = null;
  e.targetKind = null;
}

function hitPlayer(state: GameState, e: Enemy, p: Player, emit: Emit): void {
  const bal = BALANCE.player;
  const steals = e.kind === 'mistling'; // Brecher stehlen nicht, sie stoßen nur Münzen weg
  p.invuln = bal.hitInvuln;
  if (p.coins > 0) {
    const lost = Math.min(p.coins, bal.coinsLostPerHit);
    p.coins -= lost;
    const scatter = steals ? lost - 1 : lost;
    const away: Side = p.x < e.x ? -1 : 1;
    for (let i = 0; i < scatter; i++) {
      const vx = steals ? randRange(state, -70, 70) : away * randRange(state, 50, 130);
      spawnCoin(state, p.x, { vx, vy: randRange(state, 90, 150), y: 16, pickupDelay: 0.6 });
    }
    emit({ type: 'playerHit', x: p.x, playerId: p.id, coinsLost: lost });
    if (steals) startFlee(e, 'coin');
    return;
  }
  // ohne Münzen fällt die Krone → Niederlage (im Koop genügt ein Kronverlust)
  p.hasCrown = false;
  emit({ type: 'playerHit', x: p.x, playerId: p.id, coinsLost: 0 });
  emit({ type: 'crownLost', x: p.x, playerId: p.id });
  if (steals) startFlee(e, 'crown');
  setOutcome(state, 'defeat', p.x, emit);
}

function hitCitizen(state: GameState, e: Enemy, c: Citizen, emit: Emit): void {
  const role = c.role;
  const hadTool = role === 'builder' || role === 'archer' || role === 'farmer';
  demoteToVagrant(state, c);
  state.stats.citizensLost++;
  emit({ type: 'citizenHit', x: c.x, citizenId: c.id, role });
  if (e.kind === 'mistling' && hadTool) startFlee(e, 'tool');
}

function hitWall(state: GameState, e: Enemy, w: Structure, emit: Emit): void {
  w.hp = Math.max(0, w.hp - BALANCE.enemies[e.kind].wallDamage);
  emit({ type: 'wallHit', x: w.x, structureId: w.id, hp: w.hp, maxHp: w.maxHp });
  if (w.hp > 0) return;
  // Trümmer: Bauplatz wird wieder kaufbar. maxHp bleibt als Hinweis „zerstört" erhalten.
  // Ein bezahlter, noch nicht fertiger Ausbau verfällt nicht stillschweigend: seine Münzen fallen dorfseitig
  // in die Trümmer und können am Morgen wieder eingesammelt werden.
  const refund = w.construction ? (BALANCE.wall.cost[w.construction.toLevel] ?? 0) : 0;
  const inward: Side = w.x > 0 ? -1 : 1;
  for (let i = 0; i < refund; i++) {
    spawnCoin(state, w.x + inward * 4, { vx: inward * randRange(state, 15, 60), vy: randRange(state, 80, 130), y: 12 });
  }
  w.level = 0;
  w.hp = 0;
  w.construction = null;
  state.stats.wallsLost++;
  emit({ type: 'wallDestroyed', x: w.x, structureId: w.id });
}

// ---------- Bewegung ----------

/** Begrenzt eine Bewegung von e.x nach nx so, dass keine stehende Mauer durchquert wird. */
function clampByWalls(ctx: StepCtx, e: Enemy, nx: number): number {
  const stop = WALL_GAP + (e.id % 4) * WALL_STAGGER;
  for (const w of ctx.walls) {
    if (!wallStanding(w)) continue;
    const rel = e.x - w.x;
    if (rel === 0) continue;
    const s = rel > 0 ? 1 : -1;
    const limit = w.width / 2 + stop;
    const relN = (nx - w.x) * s;
    if (relN >= limit) continue;
    // nicht über die Haltelinie hinaus; wer schon näher steht, kommt nicht weiter heran
    const allowed = Math.min(rel * s, limit);
    if (relN < allowed) nx = w.x + s * allowed;
  }
  return nx;
}

function moveTo(e: Enemy, nx: number, dt: number): void {
  nx = clamp(nx, BALANCE.world.minX, BALANCE.world.maxX);
  e.vx = dt > 0 ? (nx - e.x) / dt : 0;
  if (Math.abs(nx - e.x) > 1e-6) e.facing = nx < e.x ? -1 : 1;
  e.x = nx;
}

/** Flucht zum eigenen Riss. Liefert true, wenn der Gegner entkommen (und entfernt) ist. */
function updateFlee(state: GameState, e: Enemy, st: EnemyStats, dt: number, emit: Emit): boolean {
  e.state = 'flee';
  e.targetId = null;
  e.targetKind = null;
  e.anim = e.kind === 'mistling' ? 'flee' : 'walk';
  const goal = riftX(state, e.side);
  let speed = st.speed * BALANCE.enemies.fleeSpeedMult;
  if (enemyInFog(state, e)) speed = Math.max(speed, BALANCE.enemies.fog.driftSpeed);
  // Fliehende schlüpfen durch (Mauern halten nur Angreifer auf)
  moveTo(e, approach(e.x, goal, speed * dt), dt);
  if (Math.abs(goal - e.x) > RIFT_REACH) return false;
  const i = state.enemies.indexOf(e);
  if (i >= 0) state.enemies.splice(i, 1);
  emit({ type: 'enemyEscaped', x: e.x, kind: e.kind, carrying: e.carrying });
  return true;
}

/** Ein Gegner, ein Schritt. Liefert true, wenn er entfernt wurde. */
function updateEnemy(state: GameState, ctx: StepCtx, e: Enemy, dt: number, emit: Emit): boolean {
  if (e.hp <= 0) {
    killEnemy(state, e, emit);
    return true;
  }
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  const st = BALANCE.enemies[e.kind];
  if (e.carrying || e.state === 'flee') return updateFlee(state, e, st, dt, emit);

  const reach = BALANCE.enemies.reach;

  // 1) Einheit in Reichweite angreifen
  const unit = findUnit(state, ctx, e, reach, true);
  if (unit) {
    if (e.state !== 'attackUnit' || e.targetKind !== unit.kind || e.targetId !== unit.id) {
      // Dasselbe Ziel nur kurz aus der Reichweite gelaufen und wieder eingeholt: das Ausholen läuft weiter.
      // (Sonst entkäme jede Figur, die sich bewegt, weil das Ausholen bei jedem Einholen neu begänne.)
      const resume = e.state === 'advance' && e.targetKind === unit.kind && e.targetId === unit.id && e.attackTimer > 0;
      e.state = 'attackUnit';
      e.targetKind = unit.kind;
      e.targetId = unit.id;
      const windup = st.attackInterval * WINDUP;
      e.attackTimer = resume ? Math.min(e.attackTimer, windup) : windup;
    }
    e.vx = 0;
    e.facing = unit.x < e.x ? -1 : 1;
    e.anim = 'attack';
    e.attackTimer -= dt;
    if (e.attackTimer <= 0) {
      e.attackTimer += st.attackInterval;
      if (e.attackTimer <= 0) e.attackTimer = st.attackInterval;
      if (unit.kind === 'player') hitPlayer(state, e, unit.p, emit);
      else hitCitizen(state, e, unit.c, emit);
    }
    return false;
  }

  // 2) Bewegungsziel: Sichtkontakt verfolgen, eine Krone hinter dem eigenen Riss wittern, sonst Richtung Zentrum
  const chase = findUnit(state, ctx, e, BALANCE.enemies.noticeRadius, false) ?? crownBeyondRift(state, e);
  const goalX = chase ? chase.x : hoverX(state, e);
  const dx = goalX - e.x;
  const dir: Side = dx < 0 ? -1 : 1;

  // 3) Mauer zwischen Gegner und Ziel in Reichweite → angreifen
  const w = Math.abs(dx) > 0.5 ? wallAhead(state, e.x, dir) : undefined;
  if (w && (goalX - w.x) * dir >= 0 && Math.abs(e.x - w.x) - w.width / 2 <= reach) {
    if (e.state !== 'attackWall' || e.targetId !== w.id) {
      e.state = 'attackWall';
      e.targetKind = 'structure';
      e.targetId = w.id;
      e.attackTimer = st.attackInterval * WINDUP;
    }
    e.vx = 0;
    e.facing = dir;
    e.anim = 'attack';
    e.attackTimer -= dt;
    if (e.attackTimer <= 0) {
      e.attackTimer += st.attackInterval;
      if (e.attackTimer <= 0) e.attackTimer = st.attackInterval;
      hitWall(state, e, w, emit);
    }
    return false;
  }

  // 4) Vorrücken (im Nebel schnell), Mauern nicht durchqueren. Ein verfolgtes Ziel bleibt gemerkt; wurde es
  // eben noch angegriffen, ruht der Angriffstakt, bis es wieder eingeholt ist.
  const pursuing = !!chase && e.targetKind === chase.kind && e.targetId === chase.id;
  if (!pursuing || (e.state !== 'attackUnit' && e.state !== 'advance')) e.attackTimer = Math.max(0, e.attackTimer - dt);
  e.state = 'advance';
  e.targetId = chase ? chase.id : null;
  e.targetKind = chase ? chase.kind : null;
  e.anim = 'walk';
  const speed = enemyInFog(state, e) ? Math.max(st.speed, BALANCE.enemies.fog.driftSpeed) : st.speed;
  moveTo(e, clampByWalls(ctx, e, approach(e.x, goalX, speed * dt)), dt);
  return false;
}

/** Nebelbrut: Vorrücken, Angriffe auf Mauern/Bürger/Herrscher, Stehlen, Flucht, Tod. */
export function updateEnemies(state: GameState, dt: number, emit: Emit): void {
  if (state.enemies.length === 0) return;
  const ctx = makeCtx(state);
  for (let i = 0; i < state.enemies.length; ) {
    const e = state.enemies[i];
    if (!updateEnemy(state, ctx, e, dt, emit)) i++;
  }
}
