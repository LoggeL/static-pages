// Crownward – deterministischer Heuristik-Bot für Durchspieltests.
// Der Bot spielt AUSSCHLIESSLICH über PlayerInput (links/rechts/Sprint/act halten). Den Zustand liest er nur –
// so wie ein Mensch den Bildschirm liest – und verändert ihn nie direkt. Kein Zufall: gleiche Eingabe → gleiche
// Entscheidung, damit Durchläufe reproduzierbar sind und sich mitten im Lauf speichern/laden lassen.

import { BALANCE, SIM_DT, createGame, getOffer, getPlayerFocus, safeBounds, stepGame, townLevel } from '../../src/sim';
import type { Citizen, Enemy, GameState, GroundCoin, Player, PlayerInput, SimEvent, Structure } from '../../src/sim';
import { waveSize } from '../../src/sim/waves';

export const IDLE_INPUT: PlayerInput = Object.freeze({ left: false, right: false, sprint: false, act: false });

/** Steuerung eines Spielers: bekommt den Zustand und die Ereignisse des letzten Schritts. */
export interface Controller {
  input(state: GameState, events: readonly SimEvent[]): PlayerInput;
}

// ---------- Hilfen (nur lesend) ----------

const P = BALANCE.player;
const CY = BALANCE.cycle;
/** Bremsverzögerung ohne Richtungstaste (players.ts: accel · 1,6) */
const BRAKE = P.accel * 1.6;
/** vorsichtig geschätzte Reisegeschwindigkeit mit Sprintanteil (px/s) */
const TRAVEL_SPEED = 80;

/** Uhrzeit des „Spieltags": Morgendämmerung zählt als früher Morgen des nächsten Tages (negativ). */
export function dayClock(state: GameState): number {
  return state.phase === 'dawn' ? state.dayTime - CY.length : state.dayTime;
}

function travelTime(a: number, b: number): number {
  return Math.abs(a - b) / TRAVEL_SPEED;
}

function structureById(state: GameState, id: number): Structure | undefined {
  return state.structures.find((s) => s.id === id);
}

function structureAt(state: GameState, kind: Structure['kind'], x: number): Structure | undefined {
  return state.structures.find((s) => s.kind === kind && s.x === x);
}

/** Gibt es an Position x ein Angebot in Interaktionsreichweite? (dann würde act einzahlen statt fallen lassen) */
function offerNear(state: GameState, x: number): boolean {
  for (const s of state.structures) {
    if (Math.abs(s.x - x) > P.interactRadius + s.width / 2) continue;
    if (getOffer(state, s)) return true;
  }
  return false;
}

/** Steht zwischen a und b eine Mauer (Stufe ≥ 1, hp > 0)? */
function wallBetween(state: GameState, a: number, b: number): boolean {
  for (const w of state.structures) {
    if (w.kind !== 'wall' || w.level < 1 || w.hp <= 0) continue;
    if ((a - w.x) * (b - w.x) <= 0) return true;
  }
  return false;
}

function outerWall(state: GameState, side: -1 | 1): Structure | undefined {
  let best: Structure | undefined;
  for (const s of state.structures) {
    if (s.kind !== 'wall' || s.level < 1 || s.hp <= 0 || Math.sign(s.x) !== side) continue;
    if (!best || Math.abs(s.x) > Math.abs(best.x)) best = s;
  }
  return best;
}

export interface RoleCount {
  vagrant: number;
  villager: number;
  builder: number;
  archer: number;
  farmer: number;
}

export function countRoles(state: GameState): RoleCount {
  const n: RoleCount = { vagrant: 0, villager: 0, builder: 0, archer: 0, farmer: 0 };
  for (const c of state.citizens) n[c.role]++;
  return n;
}

function stock(state: GameState, tool: 'hammer' | 'bow' | 'scythe'): { s: Structure | undefined; n: number } {
  const s = state.structures.find((q) => q.kind === 'toolStand' && q.tool === tool);
  return { s, n: s?.stock ?? 0 };
}

/** Nummer der kommenden (bzw. laufenden) Nacht. */
export function upcomingNight(state: GameState): number {
  return state.phase === 'dawn' ? state.day + 1 : state.day;
}

/** Trefferpunkte der Nebelbrut je Seite in Nacht n (die Regeln kennt auch ein Mensch nach ein paar Nächten). */
export function threatHp(night: number): number {
  let hp = 0;
  for (const side of [-1, 1] as const) {
    const w = waveSize(night, side);
    hp = Math.max(hp, w.mistlings * BALANCE.enemies.mistling.hp + w.breakers * BALANCE.enemies.breaker.hp);
  }
  return hp;
}

/** Bogenschützen (beide Seiten), um die Welle von Nacht n sicher abzuwehren. */
export function archersNeeded(night: number): number {
  return 2 * Math.max(1, Math.ceil(threatHp(night) / ARCHER_HP_PER_NIGHT));
}

/** Schaden, den ein Bogenschütze in einer Nacht verlässlich austeilt (Erfahrungswert, inkl. Fehlschüssen) */
const ARCHER_HP_PER_NIGHT = 14;

// ---------- Ziele ----------

type Goal =
  | { type: 'pay'; id: number; why: string; until: number; started: boolean }
  | { type: 'tap'; id: number; why: string; until: number }
  | { type: 'recruit'; citizenId: number; until: number; droppedAt: number }
  | { type: 'collect'; coinId: number; until: number }
  | { type: 'goto'; x: number; why: string; until: number };

interface Want {
  /** Bauwerk, an dem gekauft wird; null = Landstreicher rekrutieren (1 Münze) */
  s: Structure | null;
  /** Sparen: ist das Ziel noch zu teuer, werden nachrangige Käufe zurückgestellt */
  save: boolean;
  why: string;
}

export interface BotOptions {
  /**
   * Koop: Zuständigkeit. 'all' (Standard) = alles; 'west'/'east' = Expeditionen, Rekrutierung und ferne Münzen
   * nur auf dieser Seite (das Schiff liegt im Westen). Im Dorf kaufen beide.
   */
  share?: 'all' | 'west' | 'east';
  /** Koop: gemeinsame Absprache, damit nicht beide dasselbe Ziel ansteuern */
  team?: Team;
  /** Nachts nicht heimkehren, sondern an dieser Stelle im Wald bleiben (Test „sorgloser Spieler") */
  nightStayX?: number | null;
  /** Höchstzahl Bogenschützen (Test „Sieg ist nicht trivial": wer an der Verteidigung spart, scheitert) */
  archerCap?: number;
  /** Diagnoseausgabe (Tests lassen sie aus) */
  log?: (msg: string) => void;
}

/** Koop-Absprache: Zielschlüssel (Bauwerk/Bürger/Münze) → Bot-ID, die es gerade verfolgt. */
export class Team {
  claims = new Map<string, number>();
  clone(): Team {
    const t = new Team();
    t.claims = new Map(this.claims);
    return t;
  }
}

function goalKey(g: Goal | null): string | null {
  if (!g) return null;
  switch (g.type) {
    case 'pay':
    case 'tap':
      return `s:${g.id}`;
    case 'recruit':
      return `c:${g.citizenId}`;
    case 'collect':
      return `k:${g.coinId}`;
    default:
      return null;
  }
}

/** Protokoll, was der Bot getan hat (für Metriken und Fehlersuche). */
export interface BotLog {
  purchases: { time: number; day: number; why: string; cost: number }[];
  recruitDrops: number;
  chestsOpened: number;
}

/**
 * Heuristischer Königreichs-Bot. Prioritäten tagsüber: nahe Münzen einsammeln → Kaufplan (mit Sparen auf
 * wichtige Ziele) → Landstreicher rekrutieren → Expeditionen (Truhen, Schreine, Schiff) → fernere Münzen.
 * Abends/nachts: innerhalb der Mauern bleiben und Gegnern ausweichen.
 */
export class KingdomBot implements Controller {
  readonly id: number;
  readonly opts: Required<Omit<BotOptions, 'log' | 'team'>> & { log?: (msg: string) => void; team?: Team };
  goal: Goal | null = null;
  /** Schritte, in denen act zwingend losgelassen wird (zwischen zwei Käufen) */
  release = 0;
  /** gescheiterte Ziele vorübergehend meiden: Bauwerk-ID → Zeit */
  avoid = new Map<number, number>();
  /** Landstreicher, denen bereits eine Münze hingeworfen wurde: Bürger-ID → Zeit */
  courted = new Map<number, number>();
  readonly log: BotLog = { purchases: [], recruitDrops: 0, chestsOpened: 0 };

  constructor(id: number, opts: BotOptions = {}) {
    this.id = id;
    this.opts = {
      share: opts.share ?? 'all',
      nightStayX: opts.nightStayX ?? null,
      archerCap: opts.archerCap ?? Infinity,
      log: opts.log,
      team: opts.team,
    };
  }

  /** Tiefe Kopie (für Speichern/Laden-Vergleiche mitten im Lauf); im Koop mit der kopierten Absprache. */
  clone(team?: Team): KingdomBot {
    const b = new KingdomBot(this.id, { ...this.opts, team: team ?? this.opts.team });
    b.goal = this.goal ? { ...this.goal } : null;
    b.release = this.release;
    b.avoid = new Map(this.avoid);
    b.courted = new Map(this.courted);
    b.log.purchases = this.log.purchases.map((p) => ({ ...p }));
    b.log.recruitDrops = this.log.recruitDrops;
    b.log.chestsOpened = this.log.chestsOpened;
    return b;
  }

  private say(state: GameState, msg: string): void {
    this.opts.log?.(`[T${state.day} ${state.dayTime.toFixed(0)}s P${this.id}] ${msg}`);
  }

  input(state: GameState, events: readonly SimEvent[]): PlayerInput {
    const p = state.players[this.id];
    if (!p || state.outcome !== 'playing' || !p.hasCrown) return IDLE_INPUT;
    this.observe(state, events);
    const inp = this.decide(state, p);
    this.syncClaim();
    return inp;
  }

  /** Koop: eigenen Anspruch auf das aktuelle Ziel eintragen, alte Ansprüche freigeben. */
  private syncClaim(): void {
    const team = this.opts.team;
    if (!team) return;
    const key = goalKey(this.goal);
    for (const [k, id] of team.claims) if (id === this.id && k !== key) team.claims.delete(k);
    if (key && !team.claims.has(key)) team.claims.set(key, this.id);
  }

  /** Verfolgt ein anderer Bot dieses Ziel? */
  private taken(key: string): boolean {
    const owner = this.opts.team?.claims.get(key);
    return owner !== undefined && owner !== this.id;
  }

  private decide(state: GameState, p: Player): PlayerInput {
    const shelter = this.mustShelter(state, p);
    if (shelter) {
      // Laufende Zahlung im sicheren Bereich darf abgeschlossen werden
      if (!(this.goal?.type === 'pay' && this.goal.started && this.noThreat(state, p, 90))) this.goal = null;
      if (!this.goal) return this.shelter(state, p);
    }
    if (this.release > 0) {
      this.release--;
      return IDLE_INPUT;
    }
    if (this.goal && !this.goalValid(state, p, this.goal)) {
      this.goal = null;
      this.release = 1;
      return IDLE_INPUT;
    }
    if (!this.goal) this.goal = this.chooseGoal(state, p);
    if (!this.goal) return this.idle(state, p);
    return this.execute(state, p, this.goal);
  }

  // ---------- Ereignisse ----------

  private observe(state: GameState, events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'purchase' && e.playerId === this.id) {
        this.log.purchases.push({ time: state.time, day: state.day, why: this.goal && 'why' in this.goal ? this.goal.why : e.action, cost: e.cost });
        if (e.action === 'openChest') this.log.chestsOpened++;
        this.say(state, `Kauf ${e.action} (${e.cost})`);
        if (this.goal && (this.goal.type === 'pay' || this.goal.type === 'tap') && this.goal.id === e.structureId) {
          this.goal = null;
          this.release = 2;
        }
      } else if (e.type === 'payCancelled' && e.playerId === this.id) {
        if (this.goal && this.goal.type === 'pay' && this.goal.id === e.structureId) {
          this.avoid.set(e.structureId, state.time + 5);
          this.goal = null;
          this.release = 2;
        }
      } else if (e.type === 'coinDrop' && e.playerId === this.id) {
        this.log.recruitDrops++;
      }
    }
  }

  // ---------- Nacht ----------

  /** Muss der Bot heim (bzw. bleibt er im Dorf)? */
  private mustShelter(state: GameState, p: Player): boolean {
    if (state.phase === 'night' || state.phase === 'dusk') return true;
    const clock = dayClock(state);
    const home = this.homeX(state);
    return clock + travelTime(p.x, home) + 4 > CY.dayEnd;
  }

  private homeX(state: GameState): number {
    void state;
    return this.opts.nightStayX ?? 0;
  }

  /** Bedrohungen: angreifende Gegner ohne Mauer dazwischen. */
  private threats(state: GameState, p: Player, radius: number): Enemy[] {
    return state.enemies.filter(
      (e) => e.state !== 'flee' && !e.carrying && Math.abs(e.x - p.x) < radius && !wallBetween(state, e.x, p.x),
    );
  }

  private noThreat(state: GameState, p: Player, radius: number): boolean {
    return this.threats(state, p, radius).length === 0;
  }

  /** Abends/nachts: heim, im sicheren Bereich bleiben, Gegnern ausweichen. */
  private shelter(state: GameState, p: Player): PlayerInput {
    if (this.opts.nightStayX !== null) return steer(p, this.opts.nightStayX, 4, true);
    const west = outerWall(state, -1);
    const east = outerWall(state, 1);
    const lo = west ? west.x + 14 : -260;
    const hi = east ? east.x - 14 : 260;
    const near = this.threats(state, p, 150);
    if (near.length === 0) {
      // ruhig: in der Mitte des sicheren Bereichs warten, dabei nahe Münzen aufsammeln
      const [a, b] = safeBounds(state);
      const coin = this.nearestCoin(state, p, (c) => c.x > a + 6 && c.x < b - 6 && Math.abs(c.x - p.x) < 120);
      if (coin && this.noThreat(state, p, 260)) return steer(p, coin.x, 3, false);
      const mid = clamp((lo + hi) / 2, lo, hi);
      return steer(p, Math.abs(p.x - mid) > 60 ? mid : p.x, 30, false);
    }
    // Ausweichen: in die Richtung mit dem größten Abstand zur nächsten Bedrohung
    let best = p.x;
    let bestScore = -Infinity;
    for (const cand of [lo, hi, (lo + hi) / 2]) {
      let score = Infinity;
      for (const e of near) {
        const between = (e.x - p.x) * (cand - p.x) > 0 && Math.abs(e.x - p.x) < Math.abs(cand - p.x) + 10;
        const d = Math.abs(e.x - cand) - (between ? 400 : 0);
        score = Math.min(score, d);
      }
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    const closest = Math.min(...near.map((e) => Math.abs(e.x - p.x)));
    return steer(p, best, 4, closest < 70);
  }

  // ---------- Zielwahl ----------

  private reserve(state: GameState): number {
    const clock = dayClock(state);
    return clock > CY.dayEnd - 30 ? 4 : clock > CY.dayEnd - 60 ? 2 : 0;
  }

  /** Erreichbar und rechtzeitig vor der Dämmerung zurück? */
  private canTrip(state: GameState, p: Player, x: number, dwell: number): boolean {
    if (state.phase === 'dusk' || state.phase === 'night') return Math.abs(x) < 200 && this.insideWalls(state, x);
    const clock = dayClock(state);
    return clock + travelTime(p.x, x) + dwell + travelTime(x, this.homeX(state)) + 6 < CY.dayEnd;
  }

  private insideWalls(state: GameState, x: number): boolean {
    const [a, b] = safeBounds(state);
    return x >= a && x <= b;
  }

  private mine(state: GameState, x: number): boolean {
    const share = this.opts.share;
    if (share === 'all' || Math.abs(x) < 700) return true;
    // fällt der Partner aus, übernimmt dieser Bot auch dessen Seite
    if (!state.players.some((q, i) => i !== this.id && q.hasCrown)) return true;
    return share === 'west' ? x < 0 : x > 0;
  }

  private chooseGoal(state: GameState, p: Player): Goal | null {
    const t = state.time;
    // 1) nahe Münzen
    const near = this.nearestCoin(state, p, (c) => Math.abs(c.x - p.x) < 160 && this.canTrip(state, p, c.x, 1));
    if (near) return { type: 'collect', coinId: near.id, until: t + 12 };

    // 2) Kaufplan (inkl. Rekrutieren)
    const reserve = this.reserve(state);
    /** gespart wird auf ein wichtiges Ziel: danach nur noch Kostenloses (Truhen, Ablegen) */
    let saving = false;
    for (const w of this.plan(state)) {
      if (w.s === null) {
        if (saving) continue;
        if (p.coins - reserve < 1) {
          if (w.save) saving = true;
          continue;
        }
        const v = this.bestVagrant(state, p);
        if (v) {
          this.say(state, `Rekrutiere ${v.id} bei x=${v.x.toFixed(0)} (${w.why})`);
          return { type: 'recruit', citizenId: v.id, until: t + 60, droppedAt: -1 };
        }
        continue;
      }
      if (!this.mine(state, w.s.x) || this.taken(`s:${w.s.id}`)) continue;
      if ((this.avoid.get(w.s.id) ?? -1) > t) continue;
      const o = getOffer(state, w.s);
      if (!o || o.blockedKey !== null) continue;
      if (o.cost > 0 && saving) continue;
      if (!this.canTrip(state, p, w.s.x, 2 + o.cost * P.payInterval)) continue;
      if (o.cost > 0 && o.cost > p.coins - reserve) {
        if (w.save) saving = true;
        continue;
      }
      this.say(state, `Ziel: ${w.why} (${o.cost})`);
      if (o.cost === 0) return { type: 'tap', id: w.s.id, why: w.why, until: t + 90 };
      return { type: 'pay', id: w.s.id, why: w.why, until: t + 90, started: false };
    }

    // 3) fernere Münzen
    const far = this.nearestCoin(state, p, (c) => this.canTrip(state, p, c.x, 1) && this.mine(state, c.x));
    if (far) return { type: 'collect', coinId: far.id, until: t + 40 };
    return null;
  }

  /** Kaufplan in Prioritätsreihenfolge (nur Bauwerke, deren Angebot gerade sinnvoll ist). */
  private plan(state: GameState): Want[] {
    const W: Want[] = [];
    const tl = townLevel(state);
    const roles = countRoles(state);
    const hammer = stock(state, 'hammer');
    const bow = stock(state, 'bow');
    const scythe = stock(state, 'scythe');
    const tc = state.structures.find((s) => s.kind === 'townCenter')!;
    const ship = state.structures.find((s) => s.kind === 'ship')!;
    const farms = state.structures.filter((s) => s.kind === 'farm' && (s.level >= 1 || s.construction));
    const tools = hammer.n + bow.n + scythe.n;
    const freeVillagers = roles.villager - tools;
    const builders = roles.builder + hammer.n;
    const archers = roles.archer + bow.n;
    const farmers = roles.farmer + scythe.n;
    const T = this.targets(state);
    const add = (s: Structure | undefined, save: boolean, why: string) => {
      if (s) W.push({ s, save, why });
    };
    /** Werkzeug nur kaufen, wenn ein freier Dorfbewohner es holen kann – sonst erst rekrutieren */
    const tool = (s: Structure | undefined, save: boolean, why: string) => {
      if (freeVillagers > 0) add(s, save, why);
      else W.push({ s: null, save, why: `Rekrut für ${why}` });
    };
    const wall = (x: number) => structureAt(state, 'wall', x);
    const wallBelow = (x: number, level: number, save: boolean, why: string) => {
      for (const sx of [-x, x]) {
        const w = wall(sx);
        if (w && w.level < level && !w.construction) add(w, save, why);
      }
    };

    const tonight = upcomingNight(state);
    const cap = this.opts.archerCap;
    const needNow = Math.min(cap, archersNeeded(tonight));
    const needNext = Math.min(cap, archersNeeded(tonight + 1));

    // seetüchtig: sofort ablegen
    if (ship.level >= 3 && !ship.construction) add(ship, true, 'Ablegen');
    // Grundschutz und erste Arbeitskräfte
    if (builders < 1) tool(hammer.s, true, 'Hammer (1. Baumeister)');
    if (archers < Math.min(1, cap)) tool(bow.s, true, 'Bogen (1. Schütze)');
    wallBelow(210, 1, true, 'Pfahlwerk innen');
    if (archers < Math.min(2, cap)) tool(bow.s, true, 'Bogen (2. Schütze)');
    // Truhen sind kostenlos
    for (const s of state.structures) if (s.kind === 'chest' && !s.opened) add(s, false, 'Truhe');
    if (archers < needNow) tool(bow.s, true, 'Bogen (heute Nacht)');
    if (tl < 1 && !tc.construction) add(tc, true, 'Siedlung 1');
    if (tl >= 1 && tonight >= BALANCE.waves.breakerFrom - 1) wallBelow(210, 2, true, 'Palisade innen');
    if (builders < 2) tool(hammer.s, false, 'Hammer (2. Baumeister)');
    if (tl >= 1) {
      const farmE = structureAt(state, 'farm', 120);
      if (farmE && farmE.level < 1 && !farmE.construction) add(farmE, true, 'Feld Ost');
    }
    if (farmers < 2 * farms.length) tool(scythe.s, false, 'Sense');
    if (tl < 2 && tl >= 1 && !tc.construction) add(tc, true, 'Siedlung 2');
    if (archers < needNext) tool(bow.s, false, 'Bogen (morgen Nacht)');
    if (tl >= 1) wallBelow(210, 2, true, 'Palisade innen');
    if (tl >= 1 && ship.level < 1 && !ship.construction) add(ship, true, 'Schiff 1');
    if (tl >= 2) {
      const farmW = structureAt(state, 'farm', -140);
      if (farmW && farmW.level < 1 && !farmW.construction) add(farmW, true, 'Feld West');
    }
    const paleSoon = [tonight, tonight + 1].some((n) => n % BALANCE.waves.paleMoonEvery === 0) || tonight >= 6;
    if (tl >= 2 && paleSoon) wallBelow(210, 3, true, 'Steinmauer innen');
    if (tl >= 2 && ship.level === 1 && !ship.construction) add(ship, true, 'Schiff 2');
    if (tl < 3 && tl >= 2 && !tc.construction) add(tc, true, 'Siedlung 3');
    if (tl >= 3 && ship.level === 2 && !ship.construction) add(ship, true, 'Schiff 3');
    if (tl >= 2) wallBelow(210, 3, false, 'Steinmauer innen');
    if (builders < T.builders) tool(hammer.s, false, 'Hammer');
    const hammerShrine = state.structures.find((s) => s.kind === 'shrine' && s.shrine === 'hammer');
    if (tl >= 1 && hammerShrine && !hammerShrine.activated) add(hammerShrine, false, 'Schrein des Hammers');
    const bowShrine = state.structures.find((s) => s.kind === 'shrine' && s.shrine === 'bow');
    if (tl >= 1 && bowShrine && !bowShrine.activated) add(bowShrine, false, 'Schrein des Bogens');
    if (archers < Math.min(cap, T.archers)) tool(bow.s, false, 'Bogen (Reserve)');
    if (tl >= 2) {
      for (const sx of [-310, 310]) {
        const t = structureAt(state, 'tower', sx);
        if (t && t.level < 1 && !t.construction) add(t, false, 'Holzturm');
      }
    }
    return W;
  }

  /** Sollstärken je Rolle */
  private targets(state: GameState): { builders: number; archers: number } {
    const tl = townLevel(state);
    const n = upcomingNight(state);
    return { builders: tl >= 2 ? 4 : tl >= 1 ? 3 : 2, archers: Math.min(16, archersNeeded(n + 1) + 2) };
  }

  private bestVagrant(state: GameState, p: Player): Citizen | null {
    let best: Citizen | null = null;
    let bestD = Infinity;
    for (const c of state.citizens) {
      if (c.role !== 'vagrant' || c.task.type === 'flee' || c.stunned > 0) continue;
      if ((this.courted.get(c.id) ?? -1) > state.time) continue;
      if (!this.mine(state, c.x) || this.taken(`c:${c.id}`)) continue;
      const d = Math.abs(c.x - p.x) + (c.campId === null ? 0 : 200);
      if (d >= bestD || !this.canTrip(state, p, c.x, 8)) continue;
      best = c;
      bestD = d;
    }
    return best;
  }

  /** Nächste aufhebbare Münze, die kein Landstreicher ansteuert. */
  private nearestCoin(state: GameState, p: Player, ok: (c: GroundCoin) => boolean): GroundCoin | null {
    if (p.coins >= P.purseMax) return null; // volle Börse: Münzen bleiben liegen
    const claimed = new Set<number>();
    for (const c of state.citizens) if (c.task.type === 'pickupCoin') claimed.add(c.task.coinId);
    let best: GroundCoin | null = null;
    let bestD = Infinity;
    for (const c of state.coins) {
      if (claimed.has(c.id) || this.taken(`k:${c.id}`)) continue;
      // frisch fallengelassene Münzen sind für Landstreicher gedacht (auch die des Koop-Partners)
      if (c.droppedBy !== null && c.age < (c.droppedBy === p.id ? P.dropPickupDelay + 0.5 : 6)) continue;
      const d = Math.abs(c.x - p.x);
      if (d >= bestD || !ok(c)) continue;
      best = c;
      bestD = d;
    }
    return best;
  }

  // ---------- Ausführung ----------

  private goalValid(state: GameState, p: Player, g: Goal): boolean {
    if (state.time > g.until) return false;
    switch (g.type) {
      case 'pay':
      case 'tap': {
        const s = structureById(state, g.id);
        const o = s ? getOffer(state, s) : null;
        if (!s || !o || o.blockedKey !== null) return false;
        if (g.type === 'pay' && !g.started && o.cost > p.coins) return false;
        return true;
      }
      case 'recruit': {
        const c = state.citizens.find((q) => q.id === g.citizenId);
        if (!c || c.role !== 'vagrant' || c.task.type === 'flee') return false;
        if (g.droppedAt >= 0 && state.time - g.droppedAt > 6) {
          this.courted.set(c.id, state.time + 20);
          return false;
        }
        return g.droppedAt >= 0 || p.coins >= 1;
      }
      case 'collect': {
        const c = state.coins.find((q) => q.id === g.coinId);
        if (!c || p.coins >= P.purseMax) return false;
        return !state.citizens.some((q) => q.task.type === 'pickupCoin' && q.task.coinId === g.coinId);
      }
      case 'goto':
        return Math.abs(p.x - g.x) > 4;
    }
  }

  private execute(state: GameState, p: Player, g: Goal): PlayerInput {
    switch (g.type) {
      case 'collect': {
        const c = state.coins.find((q) => q.id === g.coinId)!;
        return steer(p, c.x, 2, true);
      }
      case 'goto':
        return steer(p, g.x, 4, true);
      case 'pay':
      case 'tap': {
        const s = structureById(state, g.id)!;
        const focus = getPlayerFocus(state, p.id);
        const dx = s.x - p.x;
        if (Math.abs(dx) <= Math.min(10, s.width / 2 + 4) && focus?.structureId === s.id) {
          if (g.type === 'tap') {
            // Flanke: einen Schritt drücken
            this.release = 1;
            return { ...IDLE_INPUT, act: true };
          }
          g.started = true;
          return { ...IDLE_INPUT, act: true };
        }
        if (g.type === 'pay' && g.started && p.payTargetId === null && Math.abs(dx) > 12) g.started = false;
        return steer(p, s.x, 2, true);
      }
      case 'recruit': {
        const c = state.citizens.find((q) => q.id === g.citizenId)!;
        if (g.droppedAt >= 0) {
          // Abstand halten, damit die eigene Münze liegen bleibt
          return steer(p, p.x, 30, false);
        }
        const dx = c.x - p.x;
        const dir: -1 | 1 = dx < 0 ? -1 : 1;
        const dist = Math.abs(dx);
        const canDrop = p.dropCooldown <= 0 && !offerNear(state, p.x) && getPlayerFocus(state, p.id) === null;
        if (dist <= 48 && dist >= 14 && p.facing === dir && canDrop && Math.abs(p.vx) < 30) {
          g.droppedAt = state.time;
          this.courted.set(c.id, state.time + 8);
          this.release = 1;
          return { ...IDLE_INPUT, act: true };
        }
        if (dist < 14 || (dist <= 48 && p.facing !== dir)) {
          // zu nah oder falsch herum: ein Stück zurück und neu anreiten
          return steer(p, c.x - dir * 40, 3, false);
        }
        // Abwurfstelle vor dem Landstreicher (ohne Angebot in Reichweite)
        let spot = c.x - dir * 32;
        if (offerNear(state, spot)) spot = c.x - dir * 46;
        if (offerNear(state, spot)) spot = c.x + dir * 32;
        return steer(p, spot, 4, dist > 200);
      }
    }
  }

  private idle(state: GameState, p: Player): PlayerInput {
    // Auf Einkommen warten: an einem Feld (Ernte einsammeln), sonst im Zentrum
    const farm = state.structures.find((s) => s.kind === 'farm' && s.level >= 1 && (s.occupants?.length ?? 0) > 0);
    const x = farm ? farm.x : 0;
    return steer(p, Math.abs(p.x - x) > 30 ? x : p.x, 20, false);
  }
}

/** Reitet auf x zu (mit Bremsweg); Sprint auf langen Strecken, solange die Ausdauer reicht. */
export function steer(p: Player, x: number, tol: number, allowSprint: boolean): PlayerInput {
  const dx = x - p.x;
  const adx = Math.abs(dx);
  if (adx <= tol) return IDLE_INPUT;
  const toward = p.vx * dx > 0;
  const stopDist = (p.vx * p.vx) / (2 * BRAKE);
  if (toward && adx <= stopDist + tol * 0.5) return IDLE_INPUT;
  const sprint = allowSprint && adx > 120 && !p.exhausted && p.stamina > (Math.abs(p.vx) > P.walkSpeed + 2 ? 0.2 : 0.55);
  return { left: dx < 0, right: dx > 0, sprint, act: false };
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

// ---------- Einfache Steuerungen für Vergleichstests ----------

/** Steht nur am Lagerfeuer (x = 0) und tut sonst nichts. */
export class CampfireIdler implements Controller {
  constructor(readonly id = 0) {}
  input(state: GameState): PlayerInput {
    const p = state.players[this.id];
    return p ? steer(p, 0, 3, false) : IDLE_INPUT;
  }
}

/** Passiver Koop-Partner: folgt dem anderen Spieler in festem Abstand, kauft nichts. */
export class Follower implements Controller {
  constructor(
    readonly id: number,
    readonly leader: number,
    readonly offset = -30,
  ) {}
  input(state: GameState): PlayerInput {
    const p = state.players[this.id];
    const l = state.players[this.leader];
    if (!p || !l) return IDLE_INPUT;
    return steer(p, l.x + this.offset, 12, true);
  }
}

// ---------- Durchlauf mit Messwerten ----------

export interface NightLog {
  night: number;
  paleMoon: boolean;
  spawned: number;
  slain: number;
  wallDamage: number;
  wallsLost: number;
  citizensHit: number;
  playerHits: number;
  coinsLostToHits: number;
}

export interface Invariants {
  /** erste Verletzung (leer = alles in Ordnung) */
  violations: string[];
}

export interface PlayResult {
  outcome: GameState['outcome'];
  /** Tag beim Ende (bzw. bei Abbruch) */
  day: number;
  /** Phase beim Ende */
  phase: GameState['phase'];
  time: number;
  stats: GameState['stats'];
  nights: NightLog[];
  crownLost: { day: number; phase: string; dayTime: number } | null;
  shipStages: { level: number; day: number }[];
  townLevels: { level: number; day: number }[];
  maxCitizens: number;
  violations: string[];
  state: GameState;
}

export interface PlayOptions {
  seed: number;
  coop?: boolean;
  /** Steuerungen je Spieler (Standard: KingdomBot) */
  controllers?: Controller[];
  maxDays?: number;
  /** Invarianten in jedem Schritt prüfen (langsamer) */
  checkInvariants?: boolean;
  /** nach jedem Schritt aufgerufen */
  onStep?: (state: GameState, events: SimEvent[]) => void;
  /** Fortsetzung eines Laufs (z. B. nach dem Laden) */
  state?: GameState;
  /** Ereignisse des letzten Schritts vor der Fortsetzung (gehen an die Steuerungen wie im durchgehenden Lauf) */
  events?: readonly SimEvent[];
}

/** Lässt ein Spiel mit den Steuerungen laufen, bis es entschieden ist oder maxDays verstrichen sind. */
export function playGame(opts: PlayOptions): PlayResult {
  const state = opts.state ?? createGame({ seed: opts.seed, coop: !!opts.coop });
  const controllers = opts.controllers ?? state.players.map((_, i) => new KingdomBot(i));
  const maxDays = opts.maxDays ?? 16;
  const nights = new Map<number, NightLog>();
  const night = (n: number): NightLog => {
    let l = nights.get(n);
    if (!l) {
      l = { night: n, paleMoon: false, spawned: 0, slain: 0, wallDamage: 0, wallsLost: 0, citizensHit: 0, playerHits: 0, coinsLostToHits: 0 };
      nights.set(n, l);
    }
    return l;
  };
  const wallHp = new Map<number, number>();
  for (const s of state.structures) if (s.kind === 'wall') wallHp.set(s.id, s.hp);
  let crownLost: PlayResult['crownLost'] = null;
  const shipStages: PlayResult['shipStages'] = [];
  const townLevels: PlayResult['townLevels'] = [];
  let maxCitizens = 0;
  const inv = opts.checkInvariants ? new InvariantChecker() : null;
  let events: SimEvent[] = opts.events ? [...opts.events] : [];
  let afterEnd = 0;

  while (state.day <= maxDays) {
    const inputs = controllers.map((c) => c.input(state, events));
    events = stepGame(state, inputs, SIM_DT);
    const n = state.phase === 'dawn' || state.phase === 'night' || state.phase === 'dusk' ? state.day : state.day - 1;
    for (const e of events) {
      switch (e.type) {
        case 'enemySpawn':
          night(state.day).spawned++;
          night(state.day).paleMoon = state.wave.paleMoon;
          break;
        case 'enemyDied':
          night(n).slain++;
          break;
        case 'wallHit': {
          const before = wallHp.get(e.structureId) ?? e.hp;
          night(n).wallDamage += Math.max(0, before - e.hp);
          break;
        }
        case 'wallDestroyed':
          night(n).wallsLost++;
          break;
        case 'citizenHit':
          night(n).citizensHit++;
          break;
        case 'playerHit':
          night(n).playerHits++;
          night(n).coinsLostToHits += e.coinsLost;
          break;
        case 'crownLost':
          crownLost ??= { day: state.day, phase: state.phase, dayTime: state.dayTime };
          break;
        case 'shipStage':
          shipStages.push({ level: e.level, day: state.day });
          break;
        case 'buildComplete':
          if (e.kind === 'townCenter') townLevels.push({ level: e.level, day: state.day });
          break;
      }
    }
    for (const s of state.structures) if (s.kind === 'wall') wallHp.set(s.id, s.hp);
    maxCitizens = Math.max(maxCitizens, state.citizens.filter((c) => c.role !== 'vagrant').length);
    inv?.check(state, events);
    opts.onStep?.(state, events);
    if (state.outcome !== 'playing' && ++afterEnd > 1) break;
  }

  return {
    outcome: state.outcome,
    day: state.day,
    phase: state.phase,
    time: state.time,
    stats: { ...state.stats },
    nights: [...nights.values()].sort((a, b) => a.night - b.night),
    crownLost,
    shipStages,
    townLevels,
    maxCitizens,
    violations: inv ? inv.violations : [],
    state,
  };
}

// ---------- Invarianten ----------

/**
 * Prüft je Schritt: endliche Zahlen, keine negativen Münzen, eindeutige IDs, Bürger machen Fortschritt
 * (niemand hängt dauerhaft mit einem Bewegungs- oder Bauauftrag fest), Werkzeuge werden abgeholt.
 */
export class InvariantChecker {
  readonly violations: string[] = [];
  /** Bürger-ID → { Auftragssignatur, seit, Abstand zum Ziel beim Start } */
  private track = new Map<number, { sig: string; since: number; bestDist: number; progressAt: number }>();
  private buildProgress = new Map<number, { progress: number; at: number }>();
  private toolWait = new Map<number, number>();
  /** Gegner-ID → x im letzten Schritt (nur Angreifer, nicht Fliehende) */
  private enemyX = new Map<number, number>();

  private fail(state: GameState, msg: string): void {
    if (this.violations.length < 20) this.violations.push(`Tag ${state.day} ${state.phase} t=${state.time.toFixed(1)}: ${msg}`);
  }

  check(state: GameState, events: readonly SimEvent[]): void {
    void events;
    const t = state.time;
    // endliche Zahlen, Münzen ≥ 0
    for (const p of state.players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.vx) || !Number.isFinite(p.stamina)) this.fail(state, `Spieler ${p.id} ungültig`);
      if (p.coins < 0 || !Number.isInteger(p.coins)) this.fail(state, `Spieler ${p.id} Münzen ${p.coins}`);
      if (p.coins > P.purseMax) this.fail(state, `Spieler ${p.id} Beutel übervoll (${p.coins})`);
    }
    for (const list of [state.citizens, state.enemies, state.coins, state.arrows, state.rabbits] as { id: number; x: number }[][]) {
      for (const e of list) if (!Number.isFinite(e.x)) this.fail(state, `NaN-Position bei ID ${e.id}`);
    }
    for (const e of state.enemies) if (!Number.isFinite(e.hp)) this.fail(state, `Gegner ${e.id} hp ungültig`);
    // Angreifer durchqueren keine stehende Mauer (Fliehende mit Beute dürfen hindurchschlüpfen)
    const nextX = new Map<number, number>();
    for (const e of state.enemies) {
      if (e.state === 'flee' || e.carrying) continue;
      const prev = this.enemyX.get(e.id);
      if (prev !== undefined) {
        for (const w of state.structures) {
          if (w.kind !== 'wall' || w.level < 1 || w.hp <= 0) continue;
          if ((prev - w.x) * (e.x - w.x) < 0) this.fail(state, `Gegner ${e.id} (${e.kind}) lief durch Mauer @${w.x}: ${prev.toFixed(1)} → ${e.x.toFixed(1)}`);
        }
      }
      nextX.set(e.id, e.x);
    }
    this.enemyX = nextX;
    for (const s of state.structures) {
      if (!Number.isFinite(s.hp) || s.hp < 0 || s.hp > Math.max(s.maxHp, 0) + 1e-9) this.fail(state, `Bauwerk ${s.id} hp ${s.hp}/${s.maxHp}`);
      if ((s.stock ?? 0) < 0) this.fail(state, `Ständer ${s.id} Bestand negativ`);
    }
    // IDs eindeutig (über alle Listen) und kleiner als nextId
    const seen = new Set<number>();
    for (const list of [state.citizens, state.enemies, state.structures, state.coins, state.arrows, state.rabbits] as { id: number }[][]) {
      for (const e of list) {
        if (seen.has(e.id)) this.fail(state, `doppelte ID ${e.id}`);
        seen.add(e.id);
        if (e.id >= state.nextId) this.fail(state, `ID ${e.id} ≥ nextId`);
      }
    }
    // Fortschritt der Bürger
    const alive = new Set<number>();
    for (const c of state.citizens) {
      alive.add(c.id);
      const goal = taskTarget(state, c);
      const sig = `${c.role}:${JSON.stringify(c.task)}`;
      const tr = this.track.get(c.id);
      if (goal === null) {
        this.track.delete(c.id);
        continue;
      }
      const dist = Math.abs(goal - c.x);
      if (!tr || tr.sig !== sig) {
        this.track.set(c.id, { sig, since: t, bestDist: dist, progressAt: t });
        continue;
      }
      if (dist < tr.bestDist - 0.5 || dist <= 3 || c.anim === 'work' || c.anim === 'kneel') {
        tr.bestDist = Math.min(dist, tr.bestDist);
        tr.progressAt = t;
      } else if (t - tr.progressAt > 40 && c.stunned <= 0) {
        this.fail(state, `Bürger ${c.id} (${c.role}) hängt fest: ${sig} bei x=${c.x.toFixed(1)}, Ziel ${goal.toFixed(1)}`);
        tr.progressAt = t; // nur einmal je 40 s melden
      }
    }
    for (const id of [...this.track.keys()]) if (!alive.has(id)) this.track.delete(id);
    // Bauaufträge mit Bauleuten vor Ort kommen voran
    for (const s of state.structures) {
      if (!s.construction) {
        this.buildProgress.delete(s.id);
        continue;
      }
      const bp = this.buildProgress.get(s.id);
      if (!bp || s.construction.progress > bp.progress + 1e-9) {
        this.buildProgress.set(s.id, { progress: s.construction.progress, at: t });
        continue;
      }
      const workersThere = state.citizens.some((c) => c.role === 'builder' && c.task.type === 'build' && c.task.structureId === s.id && c.anim === 'work');
      if (workersThere && t - bp.at > 2) this.fail(state, `Bau ${s.kind}@${s.x} ohne Fortschritt trotz Bauleuten`);
    }
    // Werkzeuge im Ständer werden abgeholt, wenn freie Dorfbewohner da sind
    const villagers = state.citizens.filter((c) => c.role === 'villager' && c.stunned <= 0 && c.task.type !== 'flee').length;
    for (const s of state.structures) {
      if (s.kind !== 'toolStand') continue;
      if ((s.stock ?? 0) > 0 && villagers > 0) {
        const since = this.toolWait.get(s.id) ?? t;
        this.toolWait.set(s.id, since);
        if (t - since > 90) {
          this.fail(state, `Werkzeug ${s.tool} liegt seit 90 s trotz ${villagers} Dorfbewohnern`);
          this.toolWait.set(s.id, t);
        }
      } else {
        this.toolWait.delete(s.id);
      }
    }
  }
}

/** Ziel-x eines Bewegungs-/Arbeitsauftrags (null = Auftrag ohne festes Ziel). */
function taskTarget(state: GameState, c: Citizen): number | null {
  const t = c.task;
  switch (t.type) {
    case 'goto':
    case 'wander':
    case 'flee':
      return Math.max(BALANCE.world.minX + 20, Math.min(BALANCE.world.maxX - 20, t.x));
    case 'guard':
      return c.role === 'archer' && state.phase !== 'day' ? t.x : null;
    case 'fetchTool':
    case 'build':
    case 'repair':
    case 'farm': {
      const s = structureById(state, t.structureId);
      return s ? s.x : null;
    }
    case 'pickupCoin': {
      const coin = state.coins.find((k) => k.id === t.coinId);
      return coin ? coin.x : null;
    }
    default:
      return null;
  }
}
