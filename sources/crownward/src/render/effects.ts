// Crownward – Rückmeldung auf Simulationsereignisse: Partikel, Kamerawackeln, Lichtblitze, Lichtsäulen,
// fliegende Krone, rote Trefferblende. Hält nur Darstellungszustand (nie Spielzustand).

import type { Enemy, GameState, SimEvent, Structure } from '../sim';
import { GROUND_Y } from '../shared/sprites';
import { LightColor, type Lighting } from './lighting';
import { PC, PK, type Particles } from './particles';

export interface Flash {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  color: LightColor;
}

export interface Pillar {
  x: number;
  t: number;
  life: number;
  color: LightColor;
}

export interface FlyingCrown {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  landed: boolean;
  /** Gegner, der die Krone stiehlt (-1 = keiner): die Krone fliegt im Bogen zu ihm und verschwindet dort */
  thiefId: number;
  /** Startpunkt des Bogens zum Dieb */
  x0: number;
  y0: number;
}

/** Flugdauer der Krone zum Dieb (s) */
const CROWN_TO_THIEF = 0.55;
/** größter Integrationsschritt der fallenden Krone (s) – stabil auch bei großen Zeitsprüngen */
const CROWN_STEP = 1 / 30;
/**
 * Spielraum (s), um den die Simulationszeit der Echtzeit vorauslaufen darf, bevor Effekte nachziehen:
 * schluckt das Ruckeln des festen Simulationsschritts (0/1/2 Schritte je Bild), damit Effekte bei 1× und
 * hoher Bildrate nicht schneller altern.
 */
const SIM_SLACK = 0.1;

/** Bildschirm-y aus Höhe über dem Boden */
const Y = (h: number) => GROUND_Y - h;

export class Effects {
  /** Kamerawackeln 0..1 (quadratisch abklingend) */
  trauma = 0;
  /** rote Trefferblende 0..1 */
  hurt = 0;
  /** Wackeln einzelner Bauwerke (Sekunden) */
  readonly shake = new Map<number, number>();
  /** Bauwerke, die gerade fertig wurden (weißes Aufleuchten, Sekunden) */
  readonly built = new Map<number, number>();
  readonly flashes: Flash[] = [];
  readonly pillars: Pillar[] = [];
  readonly crowns: FlyingCrown[] = [];
  /** zuletzt gesehene Münzzahl je Spieler (Beutelanzeige nach Aufheben) */
  readonly purseShow = new Map<number, number>();
  /** Zustand und Simulationszeit beim letzten update (Effekte altern mindestens mit der Spielzeit) */
  private lastState: GameState | null = null;
  private lastSimTime = 0;
  /** Vorsprung der Simulationszeit vor der Echtzeit, der noch nicht nachgezogen wurde (≤ SIM_SLACK) */
  private simAhead = 0;

  constructor(private p: Particles) {}

  reset(): void {
    this.trauma = 0;
    this.hurt = 0;
    this.shake.clear();
    this.built.clear();
    this.flashes.length = 0;
    this.pillars.length = 0;
    this.crowns.length = 0;
    this.purseShow.clear();
    this.p.clear();
    this.lastState = null;
    this.simAhead = 0;
  }

  /** true, solange eine Krone noch zu diesem Dieb fliegt (seine getragene Krone erscheint erst bei Ankunft) */
  crownFlyingTo(enemyId: number): boolean {
    for (const c of this.crowns) if (c.thiefId === enemyId) return true;
    return false;
  }

  addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a);
  }

  flash(x: number, y: number, r: number, life: number, color: LightColor): void {
    if (this.flashes.length > 40) this.flashes.shift();
    this.flashes.push({ x, y, r, t: 0, life, color });
  }

  /**
   * Lässt Effekte altern. realDt = Echtzeit; läuft die Simulation deutlich voraus (Zeitraffer, Debug-advance()),
   * ziehen die Effekte nach – Blitze, Wackeln und Trefferblende gehören zu Spielereignissen und dürfen einen
   * Zeitsprung nicht überdauern. In der Pause (Simulation steht) laufen sie in Echtzeit aus wie bisher.
   */
  update(realDt: number, state: GameState): void {
    let simDt = 0;
    if (state === this.lastState) simDt = Math.max(0, state.time - this.lastSimTime);
    else this.simAhead = 0;
    this.lastState = state;
    this.lastSimTime = state.time;
    let dt = realDt;
    this.simAhead = Math.max(0, this.simAhead + simDt - realDt);
    if (this.simAhead > SIM_SLACK) {
      dt += this.simAhead - SIM_SLACK;
      this.simAhead = SIM_SLACK;
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    for (const [id, t] of this.shake) {
      if (t - dt <= 0) this.shake.delete(id);
      else this.shake.set(id, t - dt);
    }
    for (const [id, t] of this.built) {
      if (t - dt <= 0) this.built.delete(id);
      else this.built.set(id, t - dt);
    }
    for (const [id, t] of this.purseShow) {
      if (t - dt <= 0) this.purseShow.delete(id);
      else this.purseShow.set(id, t - dt);
    }
    let w = 0;
    for (const f of this.flashes) {
      f.t += dt;
      if (f.t < f.life) this.flashes[w++] = f;
    }
    this.flashes.length = w;
    w = 0;
    for (const pl of this.pillars) {
      pl.t += dt;
      if (pl.t < pl.life) {
        this.pillars[w++] = pl;
        if (Math.random() < dt * 30) {
          this.p.emit(PK.Spark, pl.x + (Math.random() - 0.5) * 16, Y(Math.random() * 30), (Math.random() - 0.5) * 6, -30 - Math.random() * 50, 1.6, 2, pl.color === LightColor.Green ? PC.Green : PC.PaleGold, 0, 0.5);
        }
      }
    }
    this.pillars.length = w;
    w = 0;
    for (const c of this.crowns) {
      c.t += dt;
      if (c.thiefId >= 0) {
        // Bogen vom Kopf der Herrscherfigur zum Kopf des Diebs (folgt ihm, falls er schon flieht)
        const e = enemyById(state, c.thiefId);
        const u = Math.min(1, c.t / CROWN_TO_THIEF);
        if (!e || u >= 1) continue;
        const tx = e.x;
        const ty = Y(e.kind === 'breaker' ? 50 : 22);
        c.x = c.x0 + (tx - c.x0) * u;
        c.y = c.y0 + (ty - c.y0) * u - Math.sin(u * Math.PI) * 26;
        this.crowns[w++] = c;
        continue;
      }
      // fallende Krone in kleinen Schritten (ein großer Zeitsprung ließe sie sonst durch den Boden schnellen)
      for (let left = dt; left > 0 && !c.landed; left -= CROWN_STEP) {
        const h = Math.min(left, CROWN_STEP);
        c.vy += 420 * h;
        c.x += c.vx * h;
        c.y += c.vy * h;
        if (c.y >= GROUND_Y - 1 && c.vy > 0) {
          c.y = GROUND_Y - 1;
          if (c.vy > 80) {
            c.vy *= -0.35;
            c.vx *= 0.5;
            this.p.burst(4, PK.Pixel, c.x, GROUND_Y - 1, 3, 1, 25, -40, -10, 0.6, 1, PC.Dust, 200, 1);
          } else {
            c.landed = true;
            c.vy = 0;
            c.vx = 0;
          }
        }
      }
      if (c.t < 12) this.crowns[w++] = c;
    }
    this.crowns.length = w;
  }

  /** Lichtblitze/Lichtsäulen als Lichter registrieren */
  addLights(L: Lighting): void {
    for (const f of this.flashes) {
      const k = 1 - f.t / f.life;
      L.add(f.x, f.y, f.r * (0.6 + 0.4 * k), k, f.color, k * 0.9);
    }
    for (const pl of this.pillars) {
      const k = Math.sin((pl.t / pl.life) * Math.PI);
      L.add(pl.x, Y(30), 90, k, pl.color, k * 0.8);
    }
    for (const c of this.crowns) {
      L.add(c.x, c.y - 4, 26, 0.8, LightColor.Gold, 0.5);
    }
  }

  handle(events: readonly SimEvent[], state: GameState): void {
    const p = this.p;
    for (const e of events) {
      switch (e.type) {
        case 'coinPickup':
          p.burst(5, PK.Spark, e.x, Y(14), 4, 4, 18, -40, -10, 0.6, 1, PC.PaleGold, 30, 1);
          this.purseShow.set(e.playerId, 1.4);
          break;
        case 'coinDrop':
          p.burst(2, PK.Spark, e.x, Y(20), 2, 2, 10, -20, 0, 0.4, 1, PC.Gold, 0, 1);
          break;
        case 'purseFull':
          p.burst(3, PK.Pixel, e.x, Y(40), 4, 2, 10, -30, -10, 0.5, 1, PC.Gold, 120, 1);
          this.purseShow.set(e.playerId, 1.2);
          break;
        case 'coinPaid':
          p.burst(4, PK.Spark, e.x, Y(66), 4, 3, 14, -24, 6, 0.5, 1, PC.PaleGold, 0, 2);
          break;
        case 'payCancelled':
          p.burst(3, PK.Spark, e.x, Y(60), 6, 3, 10, 10, 30, 0.4, 1, PC.Gold, 0, 2);
          break;
        case 'purchase':
          p.burst(14, PK.Spark, e.x, Y(60), 10, 6, 40, -60, -5, 0.9, 2, PC.Gold, 40, 2);
          this.flash(e.x, Y(40), 70, 0.6, LightColor.Gold);
          break;
        case 'toolStocked':
          p.burst(6, PK.Smoke, e.x, Y(8), 6, 2, 12, -10, -2, 0.7, 4, PC.Dust, 0, 1, 6, 0.6);
          break;
        case 'buildStart':
          p.burst(8, PK.Smoke, e.x, Y(4), 10, 2, 18, -12, -2, 0.9, 4, PC.Dust, 0, 1, 7, 0.6);
          break;
        case 'buildComplete': {
          const h = heightOf(state, e.structureId);
          p.burst(18, PK.Spark, e.x, Y(h * 0.5), 14, h * 0.4, 30, -50, -5, 1.2, 2, PC.PaleGold, 0, 1.5);
          p.burst(10, PK.Smoke, e.x, Y(4), 16, 2, 26, -14, -2, 1.1, 5, PC.Dust, 0, 1, 8, 0.55);
          this.built.set(e.structureId, 0.7);
          this.flash(e.x, Y(h * 0.5), 90, 0.9, LightColor.Warm);
          break;
        }
        case 'hammer':
          p.burst(3, PK.Pixel, e.x + 4 * (Math.random() < 0.5 ? -1 : 1), Y(10), 3, 3, 40, -70, -30, 0.7, 1, Math.random() < 0.5 ? PC.Wood : PC.WoodLight, 260, 0.5);
          p.burst(1, PK.Spark, e.x, Y(12), 2, 2, 20, -30, -10, 0.25, 1, PC.Ember, 0, 2);
          break;
        case 'repaired':
          p.burst(6, PK.Spark, e.x, Y(16), 6, 10, 12, -30, -10, 0.8, 1, PC.PaleGold, 0, 1);
          break;
        case 'recruit':
        case 'roleChange':
          p.burst(10, PK.Spark, e.x, Y(16), 6, 10, 16, -40, -10, 0.9, 1, PC.PaleGold, 0, 1);
          this.flash(e.x, Y(16), 30, 0.5, LightColor.Gold);
          break;
        case 'vagrantSpawn':
          p.burst(5, PK.Smoke, e.x, Y(6), 8, 2, 10, -10, -2, 0.8, 4, PC.Dust, 0, 1, 5, 0.5);
          break;
        case 'harvest':
          p.burst(8, PK.Pixel, e.x, Y(14), 14, 4, 26, -60, -20, 0.9, 1, PC.Chaff, 160, 0.5);
          p.burst(3, PK.Spark, e.x, Y(18), 6, 4, 10, -30, -10, 0.6, 1, PC.Gold, 0, 1);
          break;
        case 'arrowFired':
          break;
        case 'arrowHit':
          if (e.target === 'enemy') {
            p.burst(6, PK.Smoke, e.x, Y(e.y), 2, 2, 24, -20, 10, 0.5, 3, PC.Violet, 0, 2, 5, 0.8);
            p.burst(3, PK.Spark, e.x, Y(e.y), 2, 2, 30, -30, 10, 0.3, 1, PC.Lavender, 0, 2);
          } else if (e.target === 'rabbit') {
            p.burst(6, PK.Pixel, e.x, Y(Math.max(3, e.y)), 2, 2, 30, -50, -10, 0.6, 1, PC.Fur, 220, 0.5);
          } else {
            p.burst(3, PK.Pixel, e.x, Y(0), 2, 0, 16, -30, -10, 0.5, 1, PC.Dust, 200, 0.5);
          }
          break;
        case 'rabbitKilled':
          p.burst(5, PK.Spark, e.x, Y(8), 4, 4, 12, -30, -10, 0.7, 1, PC.Gold, 0, 1);
          break;
        case 'enemySpawn':
          p.burst(14, PK.Smoke, e.x, Y(20), 10, 16, 16, -26, 4, 1.2, 5, PC.VioletDark, 0, 1, 6, 0.8);
          p.burst(6, PK.Spark, e.x, Y(30), 8, 18, 10, -20, 0, 0.9, 1, PC.Violet, 0, 1);
          break;
        case 'enemyHit':
          p.burst(4, PK.Smoke, e.x, Y(e.kind === 'breaker' ? 26 : 10), 3, 4, 20, -24, 4, 0.5, 3, PC.VioletDark, 0, 2, 5, 0.8);
          break;
        case 'enemyDied': {
          const big = e.kind === 'breaker';
          const n = big ? 26 : 12;
          const h = big ? 24 : 9;
          p.burst(n, PK.Smoke, e.x, Y(h), big ? 10 : 5, h * 0.6, 22, -40, -6, 1.3, big ? 6 : 4, PC.VioletDark, 0, 1.2, 7, 0.85);
          p.burst(n, PK.Spark, e.x, Y(h), big ? 10 : 5, h * 0.6, 26, -60, -10, 1.1, 1, PC.Violet, 0, 1.4);
          this.flash(e.x, Y(h), big ? 50 : 30, 0.4, LightColor.Violet);
          if (big) this.addTrauma(0.25);
          break;
        }
        case 'enemyEscaped':
          p.burst(10, PK.Smoke, e.x, Y(14), 6, 10, 12, -20, 0, 0.9, 4, PC.VioletDark, 0, 1, 6, 0.7);
          break;
        case 'enemiesDissolved':
          for (const x of e.xs) {
            p.burst(10, PK.Smoke, x, Y(12), 6, 10, 10, -30, -10, 1.6, 5, PC.Lavender, 0, 0.8, 6, 0.5);
            p.burst(8, PK.Spark, x, Y(12), 6, 10, 8, -40, -14, 1.4, 1, PC.PaleGold, 0, 1);
          }
          break;
        case 'wallHit': {
          const s = byId(state, e.structureId);
          const h = s ? Math.max(10, 10 + s.level * 12) : 14;
          const stone = s ? s.level >= 3 : false;
          p.burst(3, PK.Pixel, e.x, Y(h * 0.5), 3, h * 0.3, 40, -60, -10, 0.8, 1, stone ? PC.Stone : PC.Wood, 280, 0.5);
          this.shake.set(e.structureId, 0.22);
          break;
        }
        case 'wallDestroyed': {
          const s = byId(state, e.structureId);
          p.burst(26, PK.Pixel, e.x, Y(20), 8, 14, 80, -140, -20, 1.4, 2, PC.Wood, 340, 0.4);
          p.burst(14, PK.Pixel, e.x, Y(14), 8, 10, 70, -110, -20, 1.4, 1, PC.Stone, 340, 0.4);
          p.burst(16, PK.Smoke, e.x, Y(10), 14, 8, 30, -20, -2, 1.6, 7, PC.Dust, 0, 1, 9, 0.6);
          if (s) this.shake.set(s.id, 0.5);
          this.addTrauma(0.55);
          break;
        }
        case 'playerHit':
          this.addTrauma(0.45);
          this.hurt = 1;
          p.burst(8, PK.Smoke, e.x, Y(22), 6, 8, 20, -20, 0, 0.6, 4, PC.VioletDark, 0, 2, 5, 0.7);
          break;
        case 'citizenHit':
          p.burst(6, PK.Smoke, e.x, Y(14), 3, 6, 18, -18, 0, 0.6, 3, PC.Dust, 0, 2, 5, 0.6);
          break;
        case 'crownLost': {
          // stiehlt ein Gegner die Krone, fliegt sie zu ihm (danach trägt er sie sichtbar), sonst fällt sie
          let thief = -1;
          let best = Infinity;
          for (const en of state.enemies) {
            if (en.carrying !== 'crown') continue;
            const d = Math.abs(en.x - e.x);
            if (d < best) {
              best = d;
              thief = en.id;
            }
          }
          this.crowns.push({ x: e.x, y: Y(52), vx: (Math.random() < 0.5 ? -1 : 1) * 40, vy: -220, t: 0, landed: false, thiefId: thief, x0: e.x, y0: Y(52) });
          this.addTrauma(0.8);
          this.hurt = 1;
          p.burst(14, PK.Spark, e.x, Y(50), 4, 4, 40, -80, -10, 1, 1, PC.Gold, 60, 1);
          break;
        }
        case 'chestOpened':
          p.burst(26, PK.Spark, e.x, Y(10), 4, 2, 30, -120, -40, 1.4, 1, PC.Gold, 120, 0.6);
          p.burst(10, PK.Spark, e.x, Y(12), 6, 6, 12, -30, -10, 1.6, 2, PC.PaleGold, 0, 1);
          this.flash(e.x, Y(14), 60, 1.4, LightColor.Gold);
          break;
        case 'shrineActivated':
          this.pillars.push({ x: e.x, t: 0, life: 2.8, color: e.shrine === 'bow' ? LightColor.Green : LightColor.Gold });
          this.flash(e.x, Y(30), 120, 1.6, e.shrine === 'bow' ? LightColor.Green : LightColor.Gold);
          this.addTrauma(0.15);
          break;
        case 'shipStage':
          p.burst(20, PK.Spark, e.x, Y(40), 40, 24, 20, -40, -10, 1.4, 2, PC.PaleGold, 0, 1);
          p.burst(12, PK.Smoke, e.x, Y(4), 40, 2, 20, -12, -2, 1.2, 6, PC.Dust, 0, 1, 7, 0.5);
          this.flash(e.x, Y(40), 120, 1, LightColor.Warm);
          break;
        case 'victory':
          p.burst(40, PK.Spark, e.x, Y(50), 60, 30, 30, -60, -10, 2.4, 2, PC.PaleGold, 0, 0.6);
          this.flash(e.x, Y(50), 160, 2.5, LightColor.Gold);
          break;
        case 'defeat':
          this.addTrauma(0.3);
          break;
        default:
          break;
      }
    }
  }
}

function enemyById(state: GameState, id: number): Enemy | undefined {
  for (const e of state.enemies) if (e.id === id) return e;
  return undefined;
}

function byId(state: GameState, id: number): Structure | undefined {
  for (const s of state.structures) if (s.id === id) return s;
  return undefined;
}

/** ungefähre Höhe eines Bauwerks für Effektpositionen */
function heightOf(state: GameState, id: number): number {
  const s = byId(state, id);
  if (!s) return 30;
  switch (s.kind) {
    case 'townCenter':
      return [44, 64, 92, 124][s.level] ?? 60;
    case 'wall':
      return [14, 22, 44, 52][s.level] ?? 30;
    case 'tower':
      return s.level >= 2 ? 104 : 92;
    case 'ship':
      return 70;
    default:
      return 26;
  }
}
