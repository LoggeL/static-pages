// Crownward – autonome Bewohner: Landstreicher, Dorfbewohner, Bauleute, Bauern. Eigentum: sim-economy.
// Bogenschützen steuert archers.ts (sim-night) – sie werden hier übersprungen.

import { BALANCE } from './config';
import type { Citizen, GameState, Role, Structure, ToolKind } from './types';
import { coinResting } from './coins';
import { clamp, isNightLike, randRange, safeBounds, sign, spawnCoin, structureById, townCenter, type Emit } from './util';

const C = BALANCE.citizens;
const TOOL_ROLE: Record<ToolKind, Role> = { hammer: 'builder', bow: 'archer', scythe: 'farmer' };

/** Kniedauer beim Aufheben einer Münze */
const KNEEL_TIME = 0.7;
/** Landstreicher eilen etwas schneller zur bemerkten Münze */
const EAGER_MULT = 1.3;
/** gemächliches Bummeln */
const WANDER_MULT = 0.6;
/** Bummelradius um ein Landstreicherlager bzw. um den Platz am Lagerfeuer */
const CAMP_WANDER = 42;
const FIRE_WANDER = 10;
/**
 * Abstand der Start-Landstreicher (ohne Lager) vom Lagerfeuer: am Rand des Feuerscheins, damit eine Münze,
 * die knapp außerhalb der Angebotsreichweiten (|x| > 81) fallen gelassen wird, direkt vor ihnen landet.
 * Die Startmünzen bei ±150/−160 liegen außerhalb ihres Bemerkradius (70 px).
 */
const FIRE_SPOT = 60;
/** Bummelradius im Dorf (tags / abends und nachts) */
const VILLAGE_WANDER_DAY = 75;
const VILLAGE_WANDER_NIGHT = 48;
/** Pause zwischen zwei Bummelzielen */
const PAUSE: [number, number] = [1.2, 4.5];
/** Ankunftstoleranz */
const ARRIVE = 1.5;
/** Bauleute brechen tags nur auf, wenn bis zur Dämmerung noch so viel Arbeitszeit nach der Anreise bleibt */
const MIN_WORK_BEFORE_DUSK = 4;
/** Abstand der Bauleute zur Mauer (Arbeitsplatz auf der Innenseite) */
const WALL_WORK_GAP = 6;
/** Nachtlager jenseits des Risses: Sicherheitsabstand über den Bemerkradius der Brut hinaus */
const RIFT_SHELTER_GAP = 20;
/** Bauleute jenseits des Risses brechen nur heim auf, wenn sie so viele Sekunden vor Nachtbeginn ankommen */
const HOME_MARGIN = 5;
/** Bummelradius im Nachtlager */
const SHELTER_WANDER = 24;

interface Ctx {
  nightLike: boolean;
  safe: [number, number];
  centerX: number;
  /** Münzen, die bereits ein Landstreicher ansteuert */
  claimedCoins: Set<number>;
  /** Werkzeugständer → Anzahl Dorfbewohner auf dem Weg dorthin */
  toolClaims: Map<number, number>;
}

type Job = { kind: 'build' | 'repair'; s: Structure; x: number };

function makeCtx(state: GameState): Ctx {
  return {
    nightLike: isNightLike(state),
    safe: safeBounds(state),
    centerX: townCenter(state).x,
    claimedCoins: new Set(),
    toolClaims: new Map(),
  };
}

export function updateCitizens(state: GameState, dt: number, emit: Emit): void {
  sanitizeFarms(state);
  const ctx = makeCtx(state);
  for (const c of state.citizens) {
    if (c.task.type === 'pickupCoin') ctx.claimedCoins.add(c.task.coinId);
    if (c.task.type === 'fetchTool') ctx.toolClaims.set(c.task.structureId, (ctx.toolClaims.get(c.task.structureId) ?? 0) + 1);
  }

  for (const c of state.citizens) {
    if (c.role === 'archer') continue; // archers.ts
    if (updateStunnedOrFleeing(c, dt)) continue;
    switch (c.role) {
      case 'vagrant':
        updateVagrant(state, c, ctx, dt, emit);
        break;
      case 'villager':
        updateVillager(state, c, ctx, dt, emit);
        break;
      case 'builder':
        updateBuilder(state, c, ctx, dt, emit);
        break;
      case 'farmer':
        updateFarmer(state, c, ctx, dt, emit);
        break;
    }
  }
}

// ---------- Hilfen ----------

function speedOf(c: Citizen): number {
  return C.speed[c.role] ?? 30;
}

/** Bewegt den Bürger auf tx zu; true bei Ankunft. */
function moveToward(c: Citizen, tx: number, speed: number, dt: number): boolean {
  const dx = tx - c.x;
  const step = speed * dt;
  if (Math.abs(dx) <= Math.max(step, ARRIVE)) {
    c.x = tx;
    c.vx = 0;
    return true;
  }
  const d = sign(dx);
  c.x += d * step;
  c.vx = d * speed;
  c.facing = d;
  return false;
}

function setIdle(c: Citizen, pause: number): void {
  c.task = { type: 'idle' };
  c.timer = pause;
  c.timer2 = 0;
  c.vx = 0;
  c.anim = 'idle';
}

function worldClamp(x: number): number {
  return clamp(x, BALANCE.world.minX + 20, BALANCE.world.maxX - 20);
}

function insideSafe(ctx: Ctx, x: number): boolean {
  return x >= ctx.safe[0] && x <= ctx.safe[1];
}

/** Bummeln um homeX im Radius r; wer weit weg ist, geht zügig zurück. */
function wander(state: GameState, c: Citizen, homeX: number, r: number, dt: number): void {
  const speed = speedOf(c);
  const t = c.task;
  if (t.type === 'goto' || t.type === 'wander') {
    if (Math.abs(t.x - homeX) <= r + 2) {
      if (moveToward(c, t.x, t.type === 'goto' ? speed : speed * WANDER_MULT, dt)) {
        setIdle(c, randRange(state, PAUSE[0], PAUSE[1]));
      } else {
        c.anim = 'walk';
      }
      return;
    }
    setIdle(c, 0); // Ziel passt nicht mehr (z. B. Abend) → neu wählen
  } else if (t.type !== 'idle') {
    setIdle(c, 0);
  }
  c.vx = 0;
  c.anim = 'idle';
  if (Math.abs(c.x - homeX) > r) {
    c.task = { type: 'goto', x: worldClamp(homeX + randRange(state, -r * 0.6, r * 0.6)) };
    return;
  }
  c.timer -= dt;
  if (c.timer <= 0) c.task = { type: 'wander', x: worldClamp(homeX + randRange(state, -r, r)) };
}

/** Bummeln im Dorf; abends/nachts enger um das Zentrum (Rückzug). */
function villageWander(state: GameState, c: Citizen, ctx: Ctx, dt: number): void {
  wander(state, c, ctx.centerX, ctx.nightLike ? VILLAGE_WANDER_NIGHT : VILLAGE_WANDER_DAY, dt);
}

/**
 * Betäubte bzw. fliehende Bürger: laufen mit fleeMult zu ihrem Lager und werden dort normale Landstreicher.
 * true = Bürger ist in diesem Schritt damit beschäftigt.
 */
function updateStunnedOrFleeing(c: Citizen, dt: number): boolean {
  if (c.stunned > 0) c.stunned = Math.max(0, c.stunned - dt);
  if (c.task.type === 'flee') {
    const arrived = moveToward(c, worldClamp(c.task.x), speedOf(c) * C.fleeMult, dt);
    c.anim = 'flee';
    if (arrived) {
      c.stunned = 0;
      setIdle(c, 1);
    }
    return true;
  }
  if (c.stunned > 0) {
    c.vx = 0;
    c.anim = 'idle';
    return true;
  }
  return false;
}

// ---------- Landstreicher ----------

function updateVagrant(state: GameState, c: Citizen, ctx: Ctx, dt: number, emit: Emit): void {
  if (c.task.type === 'pickupCoin') {
    const coinId = c.task.coinId;
    const coin = state.coins.find((k) => k.id === coinId);
    if (!coin) {
      setIdle(c, randRange(state, 0.5, 1.5)); // Münze ist weg (aufgehoben/verschwunden)
    } else if (Math.abs(coin.x - c.x) > 3 || !coinResting(coin)) {
      c.timer2 = 0;
      if (moveToward(c, coin.x, speedOf(c) * EAGER_MULT, dt)) c.anim = 'idle';
      else c.anim = 'walk';
      return;
    } else {
      // knien und aufheben
      c.vx = 0;
      c.anim = 'kneel';
      c.timer2 += dt;
      if (c.timer2 >= KNEEL_TIME) {
        state.coins.splice(state.coins.indexOf(coin), 1);
        recruit(state, c, emit);
      }
      return;
    }
  }

  // Eine Münze in der Nähe bemerken, die ihm ein Herrscher hingeworfen hat. Truhen-, Ernte-, Jagd- und
  // verstreute Münzen gehören dem Reich: Sonst sammelten Lagerbewohner nahe einer Truhe (Truhe +2050,
  // Lager +2150) die Truhenmünzen auf und schlössen sich ungewollt an (Erstspieler-Test FP-07).
  let target: { id: number; d: number } | null = null;
  for (const k of state.coins) {
    if (k.droppedBy === null || !coinResting(k) || ctx.claimedCoins.has(k.id)) continue;
    const d = Math.abs(k.x - c.x);
    if (d <= C.coinNoticeRadius && (!target || d < target.d)) target = { id: k.id, d };
  }
  if (target) {
    ctx.claimedCoins.add(target.id);
    c.task = { type: 'pickupCoin', coinId: target.id };
    c.timer2 = 0;
    c.anim = 'walk';
    return;
  }

  // um das eigene Lager bzw. am Lagerfeuer bummeln
  const camp = structureById(state, c.campId);
  if (camp) wander(state, c, camp.x, CAMP_WANDER, dt);
  else wander(state, c, ctx.centerX + c.side * FIRE_SPOT, FIRE_WANDER, dt);
}

function recruit(state: GameState, c: Citizen, emit: Emit): void {
  c.role = 'villager';
  c.campId = null;
  setIdle(c, 0);
  state.stats.recruited++;
  emit({ type: 'recruit', x: c.x, citizenId: c.id });
}

// ---------- Dorfbewohner ----------

function updateVillager(state: GameState, c: Citizen, ctx: Ctx, dt: number, emit: Emit): void {
  if (c.task.type === 'fetchTool') {
    const stand = structureById(state, c.task.structureId);
    if (!stand || (stand.stock ?? 0) <= 0) {
      setIdle(c, 0);
    } else {
      const arrived = moveToward(c, stand.x, speedOf(c), dt);
      if (arrived || Math.abs(stand.x - c.x) <= C.toolPickupRadius) {
        stand.stock = (stand.stock ?? 0) - 1;
        takeRole(state, c, TOOL_ROLE[stand.tool ?? 'hammer'], emit);
      } else {
        c.anim = 'walk';
      }
      return;
    }
  }

  // freies Werkzeug suchen (je Werkzeug nur ein Abholer)
  let best: Structure | null = null;
  for (const s of state.structures) {
    if (s.kind !== 'toolStand' || (s.stock ?? 0) <= (ctx.toolClaims.get(s.id) ?? 0)) continue;
    if (!best || Math.abs(s.x - c.x) < Math.abs(best.x - c.x)) best = s;
  }
  if (best) {
    ctx.toolClaims.set(best.id, (ctx.toolClaims.get(best.id) ?? 0) + 1);
    c.task = { type: 'fetchTool', structureId: best.id };
    c.timer = 0;
    c.anim = 'walk';
    return;
  }

  villageWander(state, c, ctx, dt);
}

function takeRole(state: GameState, c: Citizen, role: Role, emit: Emit): void {
  c.role = role;
  setIdle(c, 0);
  if (role === 'archer') {
    // Bogenschützen ausgeglichen auf beide Seiten verteilen (archers.ts darf neu zuordnen)
    let west = 0;
    let east = 0;
    for (const o of state.citizens) {
      if (o === c || o.role !== 'archer') continue;
      if (o.side < 0) west++;
      else east++;
    }
    c.side = west < east ? -1 : east < west ? 1 : c.x < 0 ? -1 : 1;
  }
  emit({ type: 'roleChange', x: c.x, citizenId: c.id, role });
}

// ---------- Bauleute ----------

/** Arbeitsplatz eines Bauarbeiters an einem Bauwerk (Mauern: Innenseite; leicht gestaffelt). */
function workSpot(c: Citizen, s: Structure): number {
  const lane = c.id % 3;
  if (s.kind === 'wall') {
    const inward = s.x > 0 ? -1 : 1;
    return s.x + inward * (s.width / 2 + WALL_WORK_GAP + lane * 4);
  }
  const spread = Math.min(10, s.width / 6);
  return s.x + ((c.id % 5) - 2) * spread;
}

/**
 * Liegt x (vom Dorf aus gesehen) so weit hinter dem Nebelriss seiner Seite, dass die Brut dort nie hinkommt?
 * Sie erscheint vor dem Riss und zieht zum Dorf; jenseits davon (Schiffswerft) ist es auch nachts sicher.
 */
export function beyondRift(state: GameState, x: number): boolean {
  const side = x < 0 ? -1 : 1;
  for (const s of state.structures) {
    if (s.kind === 'rift' && Math.sign(s.x) === side) {
      return Math.abs(x) > Math.abs(s.x) + BALANCE.enemies.noticeRadius + RIFT_SHELTER_GAP;
    }
  }
  return false;
}

function sameSideBeyondRift(state: GameState, a: number, b: number): boolean {
  return Math.sign(a) === Math.sign(b) && beyondRift(state, a) && beyondRift(state, b);
}

/**
 * Nachtlager jenseits des Risses: Bauleute an der Schiffswerft bleiben abends und nachts dort – und schon am
 * Nachmittag, wenn sie das Dorf vor Nachtbeginn nicht mehr erreichen würden. Durch den nächtlichen Wald
 * zurückzulaufen hieße, der Brut in die Arme zu laufen.
 */
function shelterBeyondRift(state: GameState, c: Citizen, ctx: Ctx): boolean {
  if (!beyondRift(state, c.x)) return false;
  if (ctx.nightLike) return true;
  if (state.phase !== 'day') return false; // Morgengrauen: die Brut ist fort, heimkehren
  const edge = c.x < 0 ? ctx.safe[0] : ctx.safe[1];
  const travel = Math.abs(c.x - edge) / speedOf(c);
  return state.dayTime + travel + HOME_MARGIN > BALANCE.cycle.duskEnd;
}

/**
 * Darf der Bauarbeiter dort arbeiten? Abends/nachts nur, wenn Bauwerk und Arbeitsplatz im sicheren Bereich
 * liegen – die äußerste Mauer (Frontlinie) wird nachts also nicht repariert – oder wenn beide (wie die
 * Schiffswerft) sicher jenseits des Nebelrisses liegen und der Bauarbeiter schon dort ist.
 */
function jobAllowed(state: GameState, c: Citizen, ctx: Ctx, s: Structure, x: number, picking: boolean): boolean {
  if (ctx.nightLike) {
    return (insideSafe(ctx, s.x) && insideSafe(ctx, x)) || (sameSideBeyondRift(state, c.x, x) && sameSideBeyondRift(state, s.x, x));
  }
  if (insideSafe(ctx, x)) return true;
  if (picking && state.phase === 'day') {
    // nicht mehr zu fernen Baustellen aufbrechen, wenn es vor der Dämmerung nicht mehr lohnt
    const travel = Math.abs(x - c.x) / speedOf(c);
    return travel + MIN_WORK_BEFORE_DUSK < BALANCE.cycle.dayEnd - state.dayTime;
  }
  return true;
}

/** Rastplatz im Nachtlager: am Bauwerk jenseits des Risses (Schiff), sonst an Ort und Stelle. */
function shelterSpot(state: GameState, c: Citizen): number {
  for (const s of state.structures) {
    if (s.kind === 'ship' && sameSideBeyondRift(state, s.x, c.x)) return s.x;
  }
  return c.x;
}

function needsRepair(s: Structure): boolean {
  return (s.kind === 'wall' || s.kind === 'tower') && s.level >= 1 && s.hp > 0 && s.hp < s.maxHp && !s.construction;
}

function currentJob(state: GameState, c: Citizen, ctx: Ctx): Job | null {
  const t = c.task;
  if (t.type !== 'build' && t.type !== 'repair') return null;
  const s = structureById(state, t.structureId);
  if (!s) return null;
  const x = workSpot(c, s);
  if (!jobAllowed(state, c, ctx, s, x, false)) return null;
  if (t.type === 'build') return s.construction ? { kind: 'build', s, x } : null;
  return needsRepair(s) ? { kind: 'repair', s, x } : null;
}

function nearestJob(state: GameState, c: Citizen, ctx: Ctx, kind: Job['kind']): Job | null {
  let best: Job | null = null;
  let bestD = Infinity;
  for (const s of state.structures) {
    if (kind === 'build' ? !s.construction : !needsRepair(s)) continue;
    const x = workSpot(c, s);
    const d = Math.abs(x - c.x);
    if (d >= bestD || !jobAllowed(state, c, ctx, s, x, true)) continue;
    best = { kind, s, x };
    bestD = d;
  }
  return best;
}

export type ConstructionStatus = 'working' | 'noBuilders' | 'waitingForDay' | 'queued';

/**
 * Stand eines Bauauftrags aus Sicht der Bauleute (reine Abfrage, verändert nichts, kein RNG) – damit HUD und
 * Renderer einen stillstehenden Bau erklären können statt nur „Wird gerade gebaut" (Erstspieler-Test FP-05):
 * - 'working': ein Bauarbeiter ist dorthin unterwegs oder hämmert,
 * - 'noBuilders': es gibt keine Bauleute (Hammer kaufen; ein Dorfbewohner holt ihn),
 * - 'waitingForDay': derzeit darf niemand dort arbeiten – abends/nachts an der Front bzw. außerhalb der Mauern,
 *   oder tagsüber zu spät für den Weg; die Bauleute beginnen im Morgengrauen bzw. am nächsten Morgen,
 * - 'queued': Bauleute könnten, sind aber mit anderen Aufträgen beschäftigt.
 * null, wenn an dem Bauwerk kein Auftrag läuft.
 */
export function constructionStatus(state: GameState, s: Structure): ConstructionStatus | null {
  if (!s.construction) return null;
  const ctx = makeCtx(state);
  let allowed = false;
  let builders = 0;
  for (const c of state.citizens) {
    if (c.role !== 'builder') continue;
    builders++;
    const x = workSpot(c, s);
    const t = c.task;
    if (t.type === 'build' && t.structureId === s.id && jobAllowed(state, c, ctx, s, x, false)) return 'working';
    if (!jobAllowed(state, c, ctx, s, x, true)) continue;
    // im Nachtlager jenseits des Risses nur Arbeit, die ebenfalls dort liegt (wie updateBuilder)
    if (shelterBeyondRift(state, c, ctx) && !sameSideBeyondRift(state, c.x, x)) continue;
    allowed = true;
  }
  if (builders === 0) return 'noBuilders';
  return allowed ? 'queued' : 'waitingForDay';
}

function updateBuilder(state: GameState, c: Citizen, ctx: Ctx, dt: number, emit: Emit): void {
  const B = BALANCE.builders;
  // Priorität: Bauaufträge (nächstgelegene zuerst) > Reparaturen > Bummeln
  let job = currentJob(state, c, ctx);
  if (!job || job.kind === 'repair') job = nearestJob(state, c, ctx, 'build') ?? job;
  if (!job) job = nearestJob(state, c, ctx, 'repair');
  const shelter = shelterBeyondRift(state, c, ctx);
  // im Nachtlager nur Arbeit, die ebenfalls jenseits des Risses liegt
  if (shelter && job && !sameSideBeyondRift(state, c.x, job.x)) job = null;
  if (!job) {
    if (shelter) wander(state, c, shelterSpot(state, c), SHELTER_WANDER, dt);
    else villageWander(state, c, ctx, dt);
    return;
  }

  const t = c.task;
  const same = (t.type === 'build' || t.type === 'repair') && t.type === job.kind && t.structureId === job.s.id;
  if (!same) {
    c.task = job.kind === 'build' ? { type: 'build', structureId: job.s.id } : { type: 'repair', structureId: job.s.id };
    c.timer2 = 0;
  }
  if (!moveToward(c, job.x, speedOf(c), dt)) {
    c.anim = 'walk';
    return;
  }

  // am Arbeitsplatz: hämmern
  const s = job.s;
  if (s.x !== c.x) c.facing = sign(s.x - c.x);
  c.vx = 0;
  c.anim = 'work';
  // Schrein des Hammers beschleunigt Bau und Reparatur
  const mult = state.buffs.hammerShrine ? B.hammerShrineMult : 1;
  c.timer2 += dt;
  if (c.timer2 >= B.hammerInterval) {
    c.timer2 -= B.hammerInterval;
    emit({ type: 'hammer', x: s.x, citizenId: c.id });
  }

  if (job.kind === 'build' && s.construction) {
    s.construction.progress += B.workRate * mult * dt;
    if (s.construction.progress >= s.construction.required) completeConstruction(s, emit);
  } else if (job.kind === 'repair') {
    s.hp = Math.min(s.maxHp, s.hp + B.repairHpPerSec * mult * dt);
    if (s.hp >= s.maxHp) {
      emit({ type: 'repaired', x: s.x, structureId: s.id });
      setIdle(c, 0);
    }
  }
}

/** Bauauftrag abschließen: Stufe übernehmen, Mauern/Türme erhalten volle HP der neuen Stufe. */
function completeConstruction(s: Structure, emit: Emit): void {
  const k = s.construction;
  if (!k) return;
  s.level = k.toLevel;
  s.construction = null;
  if (s.kind === 'wall') {
    s.maxHp = BALANCE.wall.hp[s.level] ?? s.maxHp;
    s.hp = s.maxHp;
  } else if (s.kind === 'tower') {
    s.maxHp = BALANCE.tower.hp[s.level] ?? s.maxHp;
    s.hp = s.maxHp;
  }
  if ((s.kind === 'farm' || s.kind === 'tower') && !s.occupants) s.occupants = [];
  emit({ type: 'buildComplete', x: s.x, structureId: s.id, kind: s.kind, level: s.level });
  if (s.kind === 'ship') emit({ type: 'shipStage', x: s.x, level: s.level });
}

// ---------- Bauern ----------

/** Feldbelegungen bereinigen: nur Bauern, die wirklich auf diesem Feld arbeiten. */
function sanitizeFarms(state: GameState): void {
  for (const s of state.structures) {
    if (s.kind !== 'farm' || !s.occupants || s.occupants.length === 0) continue;
    s.occupants = s.occupants.filter((id) => {
      const c = state.citizens.find((o) => o.id === id);
      return !!c && c.role === 'farmer' && c.task.type === 'farm' && c.task.structureId === s.id;
    });
  }
}

function leaveFarm(state: GameState, c: Citizen): void {
  if (c.task.type !== 'farm') return;
  const farm = structureById(state, c.task.structureId);
  if (farm?.occupants) farm.occupants = farm.occupants.filter((id) => id !== c.id);
  setIdle(c, 0);
}

function updateFarmer(state: GameState, c: Citizen, ctx: Ctx, dt: number, emit: Emit): void {
  const F = BALANCE.farmers;
  // abends und nachts ins Zentrum
  if (ctx.nightLike) {
    leaveFarm(state, c);
    villageWander(state, c, ctx, dt);
    return;
  }

  let farm = c.task.type === 'farm' ? structureById(state, c.task.structureId) : undefined;
  if (!farm || farm.level < 1) {
    leaveFarm(state, c);
    farm = undefined;
    for (const s of state.structures) {
      if (s.kind !== 'farm' || s.level < 1 || (s.occupants?.length ?? 0) >= F.perFarm) continue;
      if (!farm || Math.abs(s.x - c.x) < Math.abs(farm.x - c.x)) farm = s;
    }
    if (farm) {
      farm.occupants = [...(farm.occupants ?? []), c.id];
      c.task = { type: 'farm', structureId: farm.id };
      c.timer = 0;
      c.timer2 = 0;
    }
  }
  if (!farm) {
    villageWander(state, c, ctx, dt);
    return;
  }

  const slot = Math.max(0, farm.occupants?.indexOf(c.id) ?? 0);
  const spotX = farm.x + (slot % 2 === 0 ? -1 : 1) * farm.width * 0.22;
  if (!moveToward(c, spotX, speedOf(c), dt)) {
    c.anim = 'walk';
    return;
  }
  c.vx = 0;
  c.anim = 'work';
  if (state.phase !== 'day') return; // Ernte nur am Tag
  c.timer += dt;
  if (c.timer >= F.harvestInterval) {
    c.timer -= F.harvestInterval;
    spawnCoin(state, farm.x + randRange(state, -10, 10), { vy: randRange(state, 90, 130) });
    emit({ type: 'harvest', x: farm.x, structureId: farm.id });
  }
}
