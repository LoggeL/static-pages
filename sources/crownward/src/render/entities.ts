// Crownward – Zeichnen der Weltobjekte: Deko, Bauwerke (Bauplatz, Gerüst, Beschädigung), Münzen, Bürger,
// Kaninchen, Nebelbrut, Herrscher:innen, Pfeile. Registriert Lichter und erzeugt Umgebungspartikel.

import {
  BALANCE,
  generateDecor,
  type Citizen,
  type DecorEntry,
  type Enemy,
  type GameState,
  type Player,
  type Structure,
  type ToolKind,
} from '../sim';
import { GROUND_Y, type SpriteId } from '../shared/sprites';
import { Variant, type SpriteDef } from './assets';
import type { Atmosphere } from './atmosphere';
import { applyWorld, type View } from './camera';
import type { Effects } from './effects';
import { SHORE_E, SHORE_W, WATER_Y } from './layers';
import { LightColor, type Lighting } from './lighting';
import { PC, PK, type Particles } from './particles';
import type { SpriteDrawer } from './sprites';
import { clamp01, ctx2d, hash01, makeCanvas } from './util';

const Y = (h: number) => GROUND_Y - h;

// Laufzyklus: Pixel Weg je Frame (Füße gleiten nicht)
const STRIDE_FOLK = 6;
const STRIDE_HORSE = 9;
/** Galopp: 140 px/s Sprint ÷ 14 px ≈ 10 Frames/s */
const STRIDE_GALLOP = 14;
const STRIDE_ENEMY = 6;

/** Fußhöhe des Bogenschützen im Turm und Oberkante des Geländers (Anteile der Spritehöhe) */
const TOWER_PLATFORM: Record<number, number> = { 1: 0.37, 2: 0.5 };
const TOWER_RAIL: Record<number, number> = { 1: 0.585, 2: 0.68 };
/** Fackel der Steinmauer (Anteile von Breite/Höhe, nach außen) */
const WALL3_TORCH = { dx: 0.44, dy: 0.88 };
/** Schiff: seetüchtig liegt es links am Steg im Wasser, Wrack/Reparatur stehen am Kiesufer */
const SHIP_FLOAT_DX = -80;
const SHIP_LAND_DX = 18;
/** Laternen des seetüchtigen Schiffs relativ zu Anker (x) und Unterkante (Höhe) */
const SHIP_LANTERNS = [
  [-59, 36],
  [51, 37],
] as const;

/**
 * Vordergrund-Bäume (Deko-Ebene 1, nah an der Kamera): Anteil der dunklen Silhouette über dem Bild – tagsüber
 * heller (Struktur bleibt lesbar), nachts fast schwarz wie bisher. Steht eine wichtige Figur (Herrscher:in,
 * Nebelbrut, Bürger, Bodenmünze) dahinter, blendet der Baum auf FG_MIN_ALPHA aus.
 */
export const FG_DARK_DAY = 0.6;
export const FG_DARK_NIGHT = 0.84;
export const FG_MIN_ALPHA = 0.4;
/** Halbbreite der Baumkrone im Figurenband als Anteil der gezeichneten Spritebreite (gemessen: Fichte ≈ 0,36–0,4) */
const FG_HALF = 0.4;
/** weicher Übergang (px) um die Überdeckungsgrenze */
const FG_FEATHER = 10;
/** Glättung des Ausblendens (1/s) – kein hartes Umspringen, wenn eine Figur erscheint oder verschwindet */
const FG_FADE_RATE = 12;
/** Halbbreiten der verdeckbaren Figuren (Weltpixel) */
const FG_W_PLAYER = 26;
const FG_W_BREAKER = 14;
const FG_W_MISTLING = 8;
const FG_W_CITIZEN = 6;
const FG_W_COIN = 3;

/** Überdeckungsgrad 0..1 einer Figur im Abstand dx zur Baummitte (reach = Baum- plus Figurhalbbreite) */
function cover(dx: number, reach: number): number {
  const t = (reach + FG_FEATHER - Math.abs(dx)) / (2 * FG_FEATHER);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

const TOWN_IDS: SpriteId[] = ['town.0', 'town.1', 'town.2', 'town.3'];
const WALL_IDS: SpriteId[] = ['wall.rubble', 'wall.1', 'wall.2', 'wall.3'];
const TOWER_IDS: SpriteId[] = ['buildsite', 'tower.1', 'tower.2'];
const COIN_SEQ = [0, 1, 2, 1];
const MONARCH_IDS: SpriteId[] = ['monarch.walk', 'monarch.gallop', 'monarch.graze'];

export function shipSprite(level: number): SpriteId {
  return level >= 3 ? 'ship.ready' : level >= 1 ? 'ship.repair' : 'ship.wreck';
}

function citizenSprite(c: Citizen): SpriteId {
  const r = c.role;
  switch (c.anim) {
    case 'work':
      if (r === 'builder') return 'builder.work';
      if (r === 'farmer') return 'farmer.work';
      return `${r}.idle` as SpriteId;
    case 'shoot':
      return r === 'archer' ? 'archer.shoot' : (`${r}.idle` as SpriteId);
    case 'kneel':
      return r === 'vagrant' ? 'vagrant.kneel' : (`${r}.idle` as SpriteId);
    case 'walk':
    case 'run':
    case 'flee':
    case 'carry':
      return `${r}.walk` as SpriteId;
    default:
      return `${r}.idle` as SpriteId;
  }
}

/** kleine Werkzeug-Symbole für Ständer (5×11 Pixel) */
function makeToolIcon(kind: ToolKind): HTMLCanvasElement {
  const c = makeCanvas(5, 11);
  const g = ctx2d(c);
  const wood = '#8a5e34';
  const metal = '#b8bcc8';
  if (kind === 'hammer') {
    g.fillStyle = wood;
    g.fillRect(2, 3, 1, 8);
    g.fillStyle = metal;
    g.fillRect(0, 1, 5, 3);
    g.fillStyle = '#6e7280';
    g.fillRect(0, 3, 5, 1);
  } else if (kind === 'bow') {
    g.fillStyle = wood;
    g.fillRect(1, 0, 1, 1);
    g.fillRect(2, 1, 1, 2);
    g.fillRect(3, 3, 1, 5);
    g.fillRect(2, 8, 1, 2);
    g.fillRect(1, 10, 1, 1);
    g.fillStyle = '#e8e0c8';
    g.fillRect(1, 1, 1, 9);
  } else {
    g.fillStyle = wood;
    g.fillRect(2, 1, 1, 10);
    g.fillStyle = metal;
    g.fillRect(0, 0, 3, 1);
    g.fillRect(0, 1, 1, 2);
  }
  return c;
}

export class WorldPainter {
  private decor: DecorEntry[];
  private decorX: Float64Array;
  /** Bürger-ID → Plattformhöhe (Bogenschütze steht im Turm) */
  private elevated = new Map<number, { h: number; tower: Structure }>();
  private elevPool: { h: number; tower: Structure }[] = [];
  /** Zeit des aktuellen Frames (für flick) */
  private now = 0;
  /** Münzhaufen: nur die erste Münze je Haufen leuchtet (additive Glows sättigen sonst zu Weiß) */
  private coinLead = new Uint8Array(64);
  private coinLeadN = 0;
  private toolIcons: Record<ToolKind, HTMLCanvasElement>;
  private shadow: HTMLCanvasElement;
  private townLvl = 0;
  /** Vordergrund-Deko: Indizes in decor (nur Ebene 1, nach x sortiert) und geglättete Deckkraft je Baum */
  private fgIdx: number[] = [];
  private fgAlpha: Float32Array;

  constructor(
    private sd: SpriteDrawer,
    private L: Lighting,
    private P: Particles,
    private fx: Effects,
  ) {
    this.decor = generateDecor();
    this.decorX = Float64Array.from(this.decor.map((d) => d.x));
    for (let i = 0; i < this.decor.length; i++) if (this.decor[i].layer === 1) this.fgIdx.push(i);
    this.fgAlpha = new Float32Array(this.fgIdx.length).fill(1);
    this.toolIcons = { hammer: makeToolIcon('hammer'), bow: makeToolIcon('bow'), scythe: makeToolIcon('scythe') };
    this.shadow = makeCanvas(16, 4);
    const g = ctx2d(this.shadow);
    g.fillStyle = 'rgba(8,10,20,0.55)';
    g.fillRect(2, 0, 12, 4);
    g.fillRect(0, 1, 16, 2);
  }

  /** Vorbereitung je Frame: Siedlungsstufe, Bogenschützen in Türmen, Trümmerliste pflegen */
  prepare(state: GameState): void {
    if (!this.decorSkip) this.decorSkip = this.computeDecorSkip(state);
    let tl = 0;
    for (const s of state.structures) if (s.kind === 'townCenter') tl = s.level;
    this.townLvl = tl;
    // Plattform-Einträge wiederverwenden (keine Allokation je Frame)
    for (const e of this.elevated.values()) this.elevPool.push(e);
    this.elevated.clear();
    for (const s of state.structures) {
      if (s.kind !== 'tower' || s.level < 1 || !s.occupants || s.occupants.length === 0) continue;
      const th = this.sd.height(TOWER_IDS[Math.min(2, s.level)]);
      const ph = Math.round(th * (TOWER_PLATFORM[s.level] ?? 0.45));
      for (const id of s.occupants) {
        const c = citizenById(state, id);
        if (!c || Math.abs(c.x - s.x) >= 16) continue;
        const e = this.elevPool.pop() ?? { h: 0, tower: s };
        e.h = ph;
        e.tower = s;
        this.elevated.set(id, e);
      }
    }
  }

  private visible(v: View, x: number, margin: number): boolean {
    return x > v.left - margin && x < v.left + v.w + margin;
  }

  private firstDecor(x: number): number {
    let lo = 0;
    let hi = this.decorX.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.decorX[m] < x) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  // ------------------------------------------------------------------ Lichter & Umgebung

  /** Flackern einer Flamme (deterministisch je Ort) */
  private flick(x: number, a: number): number {
    const t = this.now;
    return 1 + a * (Math.sin(t * 11 + x * 0.37) * 0.6 + Math.sin(t * 23.7 + x) * 0.4);
  }

  collectLights(state: GameState, atm: Atmosphere, time: number): void {
    const L = this.L;
    this.now = time;
    for (const s of state.structures) {
      switch (s.kind) {
        case 'townCenter': {
          const h = this.sd.height(TOWN_IDS[s.level] ?? 'town.0');
          if (s.level <= 1) L.add(s.x, Y(10), 100 * this.flick(s.x, 0.06), 1, LightColor.Fire, 0.62);
          else L.add(s.x, Y(h * 0.32), 125 * this.flick(s.x, 0.04), 1, LightColor.Warm, 0.4); // schwächerer Halo: Reiter:in davor nicht überstrahlen
          break;
        }
        case 'camp':
          L.add(s.x + (s.x > 0 ? -12 : 12), Y(6), 58 * this.flick(s.x, 0.08), 0.9, LightColor.Fire, 0.55);
          break;
        case 'wall':
          if (s.level >= 2) {
            const p = this.wallTorch(s);
            L.add(p.x, Y(p.h), 62 * this.flick(s.x, 0.08), 0.95, LightColor.Fire, 0.6);
          }
          break;
        case 'tower':
          if (s.level >= 1) {
            const th = this.sd.height(TOWER_IDS[Math.min(2, s.level)]);
            const side = s.x < 0 ? -1 : 1;
            L.add(s.x + side * 10, Y(th * 0.62), (s.level >= 2 ? 72 : 50) * this.flick(s.x, 0.07), 0.85, LightColor.Fire, s.level >= 2 ? 0.55 : 0.3);
          }
          break;
        case 'rift': {
          const pulse = 0.85 + 0.15 * Math.sin(time * 1.7 + s.x);
          L.add(s.x, Y(48), 120 * pulse, 0.55 + 0.25 * atm.night, LightColor.Violet, 0.6 + 0.4 * atm.night);
          break;
        }
        case 'shrine':
          if (s.activated) L.add(s.x, Y(24), 70, 0.6, s.shrine === 'bow' ? LightColor.Green : LightColor.Gold, 0.6);
          break;
        case 'chest':
          if (s.opened) L.add(s.x, Y(6), 26, 0.5, LightColor.Gold, 0.3);
          break;
        case 'ship':
          if (s.level >= 3) {
            const x = this.shipX(state, s, time);
            const base = this.shipBase(s, time, state);
            for (const [dx, h] of SHIP_LANTERNS) L.add(x + dx, base - h, 44 * this.flick(x + dx, 0.05), 0.85, LightColor.Warm, 0.55);
          }
          break;
        default:
          break;
      }
    }
    // Wegfackeln aus der Deko
    for (const d of this.decor) if (d.kind === 'torch') L.add(d.x, Y(18), 58 * this.flick(d.x, 0.08), 0.9, LightColor.Fire, 0.55);
    // Laterne an den Spieler:innen
    if (atm.night > 0.05) {
      for (const p of state.players) {
        if (this.playerHidden(state, p, time)) continue;
        L.add(p.x + p.facing * 6, Y(30), 50, 0.85 * atm.night, LightColor.Warm, 0.22 * atm.night);
      }
    }
    // Bodenmünzen schimmern leicht (ein Licht je Haufen)
    this.markCoinLeads(state);
    if (atm.night > 0.2) {
      const cs = state.coins;
      for (let i = 0; i < cs.length; i++) if (this.coinLead[i]) L.add(cs[i].x, Y(cs[i].y + 3), 12, 0.6, LightColor.Gold, 0.25);
    }
    this.fx.addLights(L);
    // Nebelbrut: schwaches Eigenleuchten spart sie nachts teilweise aus dem Dunkel aus (sonst fast schwarz
    // auf schwarzem Wald). Ohne Farbhalo – Kontur und Augen tragen das Leuchten. Zuletzt: niedrigste Priorität.
    if (atm.night > 0.05) {
      for (const e of state.enemies) {
        const big = e.kind === 'breaker';
        L.add(e.x, Y(big ? 22 : 10), big ? 30 : 18, 0.5 * atm.night, LightColor.Violet, 0);
      }
    }
  }

  /** markiert je Münzhaufen (±12 px) die erste Münze; einmal pro Frame vor den Glows */
  private markCoinLeads(state: GameState): void {
    const cs = state.coins;
    const n = cs.length;
    if (this.coinLead.length < n) this.coinLead = new Uint8Array(n * 2);
    const lead = this.coinLead;
    for (let i = 0; i < n; i++) {
      const ci = cs[i];
      let first = 1;
      for (let j = 0; j < i; j++) {
        if (lead[j] && Math.abs(cs[j].x - ci.x) < 12 && Math.abs(cs[j].y - ci.y) < 8) {
          first = 0;
          break;
        }
      }
      lead[i] = first;
    }
    this.coinLeadN = n;
  }

  private torchPos = { x: 0, h: 0 };
  /** Fackelposition einer Mauer (geteiltes Ergebnisobjekt – sofort auslesen) */
  private wallTorch(s: Structure): { x: number; h: number } {
    const side = s.x < 0 ? -1 : 1;
    const o = this.torchPos;
    if (s.level >= 3) {
      const d = this.sd.def('wall.3');
      o.x = s.x + side * d.w * WALL3_TORCH.dx;
      o.h = d.h * WALL3_TORCH.dy;
      return o;
    }
    // Stufe 2: freistehende Fackel an der Innenseite
    o.x = s.x - side * (this.sd.width('wall.2') / 2 + 4);
    o.h = this.sd.height('torch') - 2;
    return o;
  }

  /** Umgebungspartikel (Funken, Rauch, Nebel, Staub, Glühwürmchen) – einmal je Frame */
  emitAmbient(state: GameState, atm: Atmosphere, dt: number, near: (x: number) => boolean, views: readonly View[]): void {
    if (dt <= 0) return;
    const P = this.P;
    this.dtA = dt;
    const chance = this.chanceFn;
    for (const s of state.structures) {
      if (!near(s.x)) continue;
      switch (s.kind) {
        case 'townCenter':
          if (s.level <= 1 && chance(7)) P.emit(PK.Spark, s.x + (Math.random() - 0.5) * 8, Y(8), (Math.random() - 0.5) * 10, -22 - Math.random() * 26, 1.4, 1, Math.random() < 0.5 ? PC.Ember : PC.EmberRed, -4, 0.4);
          if (s.level >= 1 && chance(2.2)) {
            const h = this.sd.height(TOWN_IDS[s.level]);
            P.emit(PK.Smoke, s.x + (s.level >= 2 ? -h * 0.18 : 0), Y(h * 0.9), 4 + Math.random() * 4, -10, 3.5, 3, PC.Smoke, -1, 0.1, 3, 0.35);
          }
          break;
        case 'camp':
          if (chance(1.5)) P.emit(PK.Smoke, s.x + (s.x > 0 ? -12 : 12), Y(8), 3 + Math.random() * 3, -12, 3, 2, PC.Smoke, -1, 0.1, 3, 0.35);
          if (chance(2.5)) P.emit(PK.Spark, s.x + (s.x > 0 ? -12 : 12), Y(5), (Math.random() - 0.5) * 8, -18 - Math.random() * 14, 1, 1, PC.Ember, 0, 0.5);
          break;
        case 'wall':
          if (s.level >= 2 && chance(1.6)) {
            const p = this.wallTorch(s);
            P.emit(PK.Spark, p.x + (Math.random() - 0.5) * 2, Y(p.h + 2), (Math.random() - 0.5) * 6, -18 - Math.random() * 14, 0.8, 1, PC.Ember, 0, 0.5);
          }
          break;
        case 'rift': {
          const k = 0.4 + 0.6 * atm.night;
          if (chance(10 * k)) P.emit(PK.Spark, s.x + (Math.random() - 0.5) * 30, Y(10 + Math.random() * 80), (Math.random() - 0.5) * 10, -10 - Math.random() * 20, 2.2, 1, Math.random() < 0.6 ? PC.Violet : PC.Lavender, 0, 0.3);
          if (chance(4 * k)) P.emit(PK.Smoke, s.x + (Math.random() - 0.5) * 30, Y(Math.random() * 60), (Math.random() - 0.5) * 8, -6, 3, 5, PC.VioletDark, 0, 0.2, 5, 0.6);
          if (chance(1.5 * k)) P.emit(PK.Mist, s.x + (Math.random() - 0.5) * 40, Y(2), (Math.random() - 0.5) * 12, 0, 6, 26, PC.Violet, 0, 0, 4, 0.18);
          break;
        }
        case 'shrine':
          if (s.activated && chance(4)) P.emit(PK.Spark, s.x + (Math.random() - 0.5) * 18, Y(Math.random() * 30), 0, -12 - Math.random() * 10, 2, 1, s.shrine === 'bow' ? PC.Green : PC.Gold, 0, 0.2);
          break;
        default:
          break;
      }
    }
    for (const d of this.decor) {
      if (d.kind === 'torch' && near(d.x) && chance(1.4)) P.emit(PK.Spark, d.x, Y(20), (Math.random() - 0.5) * 6, -18 - Math.random() * 12, 0.8, 1, PC.Ember, 0, 0.5);
    }
    for (const e of state.enemies) {
      if (!near(e.x)) continue;
      const big = e.kind === 'breaker';
      if (chance(big ? 6 : 3.5)) {
        const h = big ? 30 : 12;
        P.emit(PK.Smoke, e.x - e.facing * (big ? 8 : 3) + (Math.random() - 0.5) * 6, Y(Math.random() * h), -e.facing * 6, -8, 0.9, big ? 4 : 2.5, PC.VioletDark, -2, 0.5, 4, 0.55);
      }
    }
    for (const p of state.players) {
      if (this.playerHidden(state, p, 0)) continue;
      const fast = Math.abs(p.vx) > BALANCE.player.walkSpeed * 1.2;
      if (fast && chance(18)) P.emit(PK.Smoke, p.x - p.facing * 16 + (Math.random() - 0.5) * 8, Y(1), -p.facing * (10 + Math.random() * 12), -6 - Math.random() * 6, 0.7, 2.5, PC.Dust, 0, 2, 6, 0.45);
      if (p.exhausted && chance(1.6)) P.emit(PK.Smoke, p.x + p.facing * 24, Y(36), p.facing * 6, -4, 0.8, 1.5, PC.BlueWhite, 0, 1, 3, 0.4);
    }
    // Glühwürmchen und Bodennebel je Ansicht
    for (const v of views) {
      const span = v.w + 80;
      if (atm.fireflies > 0.02 && chance(6 * atm.fireflies)) {
        P.emit(PK.Spark, v.left - 40 + Math.random() * span, Y(4 + Math.random() * 50), (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, 3 + Math.random() * 3, 1, PC.Firefly, 0, 0, 0, 0.9);
      }
      if (atm.fog > 0.02 && chance(2.2 * atm.fog)) {
        const x = v.left - 60 + Math.random() * (span + 40);
        if (x > SHORE_W - 30) P.emit(PK.Mist, x, Y(-2 + Math.random() * 10), (Math.random() - 0.5) * 10 + 3, 0, 9 + Math.random() * 5, 40 + Math.random() * 40, PC.FogNight, 0, 0, 3, 0.26 * atm.fog);
      }
    }
  }

  private dtA = 0;
  /** Zufallsereignis mit Rate (1/s) im aktuellen Frame – einmal gebunden, keine Closure je Frame */
  private chanceFn = (rate: number) => Math.random() < rate * this.dtA;

  // ------------------------------------------------------------------ Deko

  /** Deko nicht über Wasser, Schiff oder Riss zeichnen (Lage der Bauwerke ist je Insel fest) */
  private decorSkip: Uint8Array | null = null;

  private computeDecorSkip(state: GameState): Uint8Array {
    const skip = new Uint8Array(this.decor.length);
    for (let i = 0; i < this.decor.length; i++) {
      const d = this.decor[i];
      if (d.x < SHORE_W + 10 || d.x > SHORE_E - 10) skip[i] = 1;
      for (const s of state.structures) {
        if (s.kind === 'ship' && d.x > s.x - 90 && d.x < s.x + 90) skip[i] = 1;
        if (s.kind === 'rift' && Math.abs(d.x - s.x) < 40) skip[i] = 1;
        // Vordergrund-Bäume nie vor Bauwerken, Truhen, Schreinen, Lagern (Interaktion bleibt sichtbar)
        if (d.layer === 1 && s.kind !== 'rift' && s.kind !== 'ship' && Math.abs(d.x - s.x) < 60 + s.width / 2) skip[i] = 1;
      }
    }
    return skip;
  }

  drawBackDecor(g: CanvasRenderingContext2D, v: View): void {
    applyWorld(g, v);
    const margin = 80;
    const skip = this.decorSkip;
    for (let i = this.firstDecor(v.left - margin); i < this.decor.length; i++) {
      const d = this.decor[i];
      if (d.x > v.left + v.w + margin) break;
      if (d.layer !== 0 || (skip && skip[i])) continue;
      const id = d.kind as SpriteId;
      const flip = hash01(Math.round(d.x * 13)) < 0.5;
      const isTree = d.kind.startsWith('tree.');
      // Bäume stehen etwas hinter dem Weg (Stamm im Gras)
      const y = isTree ? GROUND_Y - 5 : GROUND_Y - 1;
      this.sd.draw(g, id, 0, d.x, y, flip);
      if (isTree && d.scale < 0.95) {
        // Tiefe: hintere Bäume leicht abdunkeln
        g.globalAlpha = 0.28;
        this.sd.draw(g, id, 0, d.x, y, flip, Variant.Dark);
        g.globalAlpha = 1;
      }
    }
  }

  /** Zusatzmaßstab der Vordergrund-Deko (nah an der Kamera) */
  private fgScale(d: DecorEntry): number {
    return Math.min(1.12, Math.max(1, d.scale * 0.9));
  }

  /** Wie stark steht eine wichtige Figur hinter dem Vordergrundbaum bei x (Halbbreite half)? 0 = frei, 1 = ganz */
  private occlusion(state: GameState, x: number, half: number): number {
    let o = 0;
    for (const p of state.players) {
      if (this.playerHidden(state, p, 0)) continue;
      o = Math.max(o, cover(p.x - x, half + FG_W_PLAYER));
    }
    if (o >= 1) return 1;
    for (const e of state.enemies) {
      o = Math.max(o, cover(e.x - x, half + (e.kind === 'breaker' ? FG_W_BREAKER : FG_W_MISTLING)));
      if (o >= 1) return 1;
    }
    for (const c of state.citizens) {
      o = Math.max(o, cover(c.x - x, half + FG_W_CITIZEN));
      if (o >= 1) return 1;
    }
    for (const c of state.coins) {
      o = Math.max(o, cover(c.x - x, half + FG_W_COIN));
      if (o >= 1) return 1;
    }
    return o;
  }

  /**
   * Einmal je Frame (vor dem Zeichnen der Ansichten): Ziel-Deckkraft jedes Vordergrundbaums aus der Überdeckung
   * wichtiger Figuren, zeitlich geglättet. dt ≥ 1 s springt direkt auf das Ziel.
   */
  updateForeground(state: GameState, dt: number): void {
    const skip = this.decorSkip;
    const blend = dt >= 1 ? 1 : 1 - Math.exp(-Math.max(0, dt) * FG_FADE_RATE);
    for (let j = 0; j < this.fgIdx.length; j++) {
      const i = this.fgIdx[j];
      if (skip && skip[i]) continue;
      const d = this.decor[i];
      const half = this.sd.width(d.kind as SpriteId) * this.fgScale(d) * FG_HALF;
      const target = 1 - (1 - FG_MIN_ALPHA) * this.occlusion(state, d.x, half);
      this.fgAlpha[j] += (target - this.fgAlpha[j]) * blend;
    }
  }

  /** aktuelle (geglättete) Deckkraft des Vordergrundbaums an Deko-Position i – für Tests/Diagnose */
  foregroundAlphaAt(decorIndex: number): number {
    const j = this.fgIdx.indexOf(decorIndex);
    return j < 0 ? 1 : this.fgAlpha[j];
  }

  /** Deko-Indizes der Vordergrundbäume (Ebene 1) – für Tests/Diagnose */
  foregroundDecor(): readonly { index: number; x: number; skipped: boolean }[] {
    return this.fgIdx.map((i) => ({ index: i, x: this.decor[i].x, skipped: !!(this.decorSkip && this.decorSkip[i]) }));
  }

  drawForeground(g: CanvasRenderingContext2D, v: View, atm: Atmosphere): void {
    applyWorld(g, v);
    const margin = 140;
    // Silhouettenanteil: tagsüber heller (Struktur sichtbar), nachts fast schwarz
    const m = FG_DARK_DAY + (FG_DARK_NIGHT - FG_DARK_DAY) * clamp01(atm.night);
    for (let j = 0; j < this.fgIdx.length; j++) {
      const i = this.fgIdx[j];
      const d = this.decor[i];
      if (d.x < v.left - margin) continue;
      if (d.x > v.left + v.w + margin) break;
      if (this.decorSkip && this.decorSkip[i]) continue;
      const flip = hash01(Math.round(d.x * 7)) < 0.5;
      // nah an der Kamera: Fuß unterhalb des Bildrands, abgedunkelt (Silhouette mit etwas Struktur)
      const k = this.fgScale(d);
      const a = this.fgAlpha[j];
      // Gesamtdeckung a für „Bild, darüber Silhouette mit Anteil m“ (Baumpixel sind deckend):
      // Bild mit a·(1−m)/(1−m·a), danach Silhouette mit m·a → Hintergrund bleibt zu (1−a) sichtbar.
      g.globalAlpha = a >= 1 ? 1 : (a * (1 - m)) / (1 - m * a);
      this.sd.drawScaled(g, d.kind as SpriteId, d.x, GROUND_Y + 66, k, flip, Variant.Normal);
      g.globalAlpha = m * a;
      this.sd.drawScaled(g, d.kind as SpriteId, d.x, GROUND_Y + 66, k, flip, Variant.Dark);
      g.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ Bauwerke

  drawStructures(g: CanvasRenderingContext2D, v: View, state: GameState, time: number): void {
    applyWorld(g, v);
    for (const s of state.structures) {
      const margin = s.kind === 'ship' ? 260 : s.kind === 'rift' || s.kind === 'townCenter' ? 120 : 80;
      if (!this.visible(v, s.x, margin)) continue;
      this.drawStructure(g, s, state, time);
    }
  }

  private shakeX(s: Structure, time: number): number {
    const t = this.fx.shake.get(s.id);
    if (!t) return 0;
    return Math.round(Math.sin(time * 70) * Math.min(2, t * 10));
  }

  private drawStructure(g: CanvasRenderingContext2D, s: Structure, state: GameState, time: number) {
    const sd = this.sd;
    const x = s.x + this.shakeX(s, time);
    const unlocked = s.unlockLevel <= this.townLvl;
    const c = s.construction;
    switch (s.kind) {
      case 'townCenter': {
        const id = TOWN_IDS[Math.min(3, s.level)];
        sd.draw(g, id, 0, x, GROUND_Y);
        this.builtFlash(g, s, id, x);
        if (c) this.drawConstruction(g, x, TOWN_IDS[Math.min(3, c.toLevel)], c.progress / c.required, false);
        break;
      }
      case 'wall': {
        const flip = s.x < 0;
        if (s.level >= 1) {
          const id = WALL_IDS[Math.min(3, s.level)];
          sd.draw(g, id, 0, x, GROUND_Y, flip);
          this.drawDamage(g, s, id, x, flip);
          this.builtFlash(g, s, id, x, flip);
          if (s.level === 2) sd.draw(g, 'torch', 0, this.wallTorch(s).x, GROUND_Y, flip);
        } else if (s.maxHp > 0) {
          // zerstört (Stufe 0, maxHp bleibt als Hinweis) – auch nach dem Laden sichtbar
          sd.draw(g, 'wall.rubble', 0, x, GROUND_Y, flip);
        } else if (unlocked && !c) {
          sd.draw(g, 'buildsite', 0, x, GROUND_Y, flip);
        }
        if (c) this.drawConstruction(g, x, WALL_IDS[Math.min(3, c.toLevel)], c.progress / c.required, flip);
        break;
      }
      case 'tower': {
        const flip = s.x < 0;
        if (s.level >= 1) {
          const id = TOWER_IDS[Math.min(2, s.level)];
          sd.draw(g, id, 0, x, GROUND_Y, flip);
          // Bogenschützen stehen hinter dem Geländer: Figur über den Turm, dann den unteren
          // Turmteil bis zur Geländeroberkante erneut darüber
          if (s.occupants && s.occupants.length > 0) {
            let k = 0;
            for (const cid of s.occupants) {
              const e = this.elevated.get(cid);
              if (!e) continue;
              const cit = citizenById(state, cid);
              if (!cit) continue;
              const ox = s.occupants.length > 1 ? (k === 0 ? -8 : 8) : 0;
              this.drawCitizenAt(g, cit, x + ox, Y(e.h), time, true);
              k++;
            }
            if (k > 0) sd.drawDef(g, sd.def(id), 0, x, GROUND_Y, flip, Variant.Normal, TOWER_RAIL[s.level] ?? 0.6);
          }
          this.drawDamage(g, s, id, x, flip);
          this.builtFlash(g, s, id, x, flip);
        } else if (unlocked && !c) {
          sd.draw(g, 'buildsite', 0, x, GROUND_Y, flip);
        }
        if (c) this.drawConstruction(g, x, TOWER_IDS[Math.min(2, Math.max(1, c.toLevel))], c.progress / c.required, flip);
        break;
      }
      case 'farm': {
        if (s.level >= 1) {
          sd.draw(g, 'farm', 0, x, GROUND_Y);
          this.builtFlash(g, s, 'farm', x);
        } else if (unlocked && !c) {
          sd.draw(g, 'buildsite', 0, x - 16, GROUND_Y);
          sd.draw(g, 'buildsite', 0, x + 16, GROUND_Y, true);
        }
        if (c) this.drawConstruction(g, x, 'farm', c.progress / c.required, false);
        break;
      }
      case 'toolStand': {
        if (!unlocked) break;
        const id = (s.tool === 'bow' ? 'stand.bow' : s.tool === 'scythe' ? 'stand.scythe' : 'stand.hammer') as SpriteId;
        sd.draw(g, id, 0, x, GROUND_Y);
        const n = Math.min(4, s.stock ?? 0);
        const icon = this.toolIcons[s.tool ?? 'hammer'];
        for (let i = 0; i < n; i++) g.drawImage(icon, Math.round(x - 9 + i * 5), GROUND_Y - 11);
        break;
      }
      case 'camp':
        sd.draw(g, 'camp', 0, x, GROUND_Y, s.x > 0);
        break;
      case 'chest':
        sd.draw(g, s.opened ? 'chest.open' : 'chest.closed', 0, x, GROUND_Y);
        break;
      case 'shrine':
        sd.draw(g, s.shrine === 'hammer' ? 'shrine.hammer' : 'shrine.bow', 0, x, GROUND_Y);
        break;
      case 'rift':
        sd.draw(g, 'rift', 0, x, GROUND_Y + 1, s.x < 0);
        break;
      case 'ship': {
        const id = shipSprite(s.level);
        const sx = this.shipX(state, s, time);
        const base = this.shipBase(s, time, state);
        if (state.outcome === 'victory' && s.level >= 3) {
          // ablegend: Steg bleibt am Ufer zurück, Schiff gleitet nach links (unterhalb der Wasserlinie abgeschnitten)
          this.drawPier(g, s.x + SHIP_FLOAT_DX);
          g.save();
          g.beginPath();
          g.rect(sx - 200, base - 200, 400, WATER_Y + 3 - (base - 200));
          g.clip();
          sd.draw(g, id, 0, sx, base + 8);
          g.restore();
        } else sd.draw(g, id, 0, sx, base);
        if (c && c.toLevel > s.level) {
          const next = shipSprite(c.toLevel);
          const p = c.progress / c.required;
          // Wrack → Reparatur wird von unten enthüllt; danach nur Gerüststangen mit wanderndem Brett
          if (next !== id && c.toLevel < 3) this.drawConstruction(g, sx, next, p, false);
          else this.drawShipWork(g, sx, sd.width(id), sd.height(id), p);
        }
        break;
      }
    }
  }

  /** x-Position des Schiffs (seetüchtig: am Steg im Wasser; nach dem Sieg legt es ab) */
  shipX(state: GameState, s: Structure, time: number): number {
    void time;
    let x = s.x + (s.level >= 3 ? SHIP_FLOAT_DX : SHIP_LAND_DX);
    if (state.outcome === 'victory' && s.level >= 3) {
      const t = Math.max(0, state.time - state.outcomeTime - 0.8);
      x -= t * t * 4 + t * 6;
    }
    return x;
  }

  /** Unterkante des Schiffs (Bildschirm-y): schwimmend leicht wippend, sonst am Ufer */
  private shipBase(s: Structure, time: number, state: GameState): number {
    if (s.level < 3) return GROUND_Y + 2;
    const sway = state.outcome === 'victory' ? 1.6 : 1;
    return WATER_Y + 9 + Math.round(Math.sin(time * 1.4) * sway);
  }

  /** zurückbleibender Steg nach dem Ablegen */
  private drawPier(g: CanvasRenderingContext2D, x: number) {
    const l = Math.round(x + 4);
    const r = Math.round(x + 66);
    g.fillStyle = '#4a3220';
    for (let px = l; px <= r; px += 12) g.fillRect(px, WATER_Y - 8, 3, 18);
    g.fillStyle = '#8a6440';
    g.fillRect(l - 2, WATER_Y - 9, r - l + 6, 2);
    g.fillStyle = '#5e4028';
    g.fillRect(l - 2, WATER_Y - 7, r - l + 6, 1);
  }

  /** Arbeit am Schiff: zwei Gerüststangen und ein mit dem Fortschritt steigendes Brett */
  private drawShipWork(g: CanvasRenderingContext2D, x: number, w: number, h: number, p: number) {
    const l = Math.round(x - w * 0.36);
    const r = Math.round(x + w * 0.3);
    const top = Math.round(h * 0.75);
    g.fillStyle = '#4a3220';
    g.fillRect(l, GROUND_Y - top, 2, top);
    g.fillRect(r, GROUND_Y - top, 2, top);
    const yy = GROUND_Y - Math.round(8 + (top - 14) * clamp01(p));
    g.fillStyle = '#8a6440';
    g.fillRect(l - 2, yy, r - l + 6, 1);
    g.fillStyle = '#5e4028';
    g.fillRect(l - 2, yy + 1, r - l + 6, 1);
  }

  private playerHidden(state: GameState, p: Player, time: number): boolean {
    void time;
    if (state.outcome !== 'victory') return false;
    // nach dem Ablegen sind die Herrscher:innen an Bord
    for (const s of state.structures) {
      if (s.kind === 'ship' && Math.abs(p.x - s.x) < 90 && state.time - state.outcomeTime > 0.5) return true;
    }
    return false;
  }

  private builtFlash(g: CanvasRenderingContext2D, s: Structure, id: SpriteId, x: number, flip = false) {
    const t = this.fx.built.get(s.id);
    if (!t) return;
    g.globalAlpha = clamp01(t / 0.7) * 0.85;
    this.sd.draw(g, id, 0, x, GROUND_Y, flip, Variant.White);
    g.globalAlpha = 1;
  }

  /** Beschädigung: Abdunkeln und Risse nach hp/maxHp */
  private drawDamage(g: CanvasRenderingContext2D, s: Structure, id: SpriteId, x: number, flip: boolean) {
    if (s.maxHp <= 0) return;
    const ratio = clamp01(s.hp / s.maxHp);
    if (ratio >= 0.98) return;
    const dmg = 1 - ratio;
    g.globalAlpha = dmg * 0.55;
    this.sd.draw(g, id, 0, x, GROUND_Y, flip, Variant.Dark);
    g.globalAlpha = 1;
    // Risse (deterministisch je Bauwerk)
    const d = this.sd.def(id);
    const cracks = Math.ceil(dmg * 4);
    g.fillStyle = '#0c0a10';
    for (let k = 0; k < cracks; k++) {
      let cx = x + (hash01(s.id * 31 + k) - 0.5) * d.w * 0.6;
      let cy = GROUND_Y - d.h * (0.2 + 0.6 * hash01(s.id * 17 + k * 5));
      const len = 4 + Math.floor(hash01(s.id + k * 13) * 6 * dmg + 2);
      for (let j = 0; j < len; j++) {
        g.fillRect(Math.round(cx), Math.round(cy), 1, 1);
        cx += hash01(s.id * 7 + k * 3 + j) < 0.5 ? -1 : 1;
        cy += 1;
      }
    }
  }

  /** Bau im Gange: Blaupausen-Schatten, Enthüllung von unten, Gerüst */
  private drawConstruction(g: CanvasRenderingContext2D, x: number, id: SpriteId, progress: number, flip: boolean) {
    const p = clamp01(progress);
    const d = this.sd.def(id);
    g.globalAlpha = 0.16;
    this.sd.drawDef(g, d, 0, x, GROUND_Y, flip, Variant.White, 1);
    g.globalAlpha = 1;
    this.sd.drawDef(g, d, 0, x, GROUND_Y, flip, Variant.Normal, Math.max(0.04, p));
    this.drawScaffold(g, x, d.w, d.h, p);
  }

  private drawScaffold(g: CanvasRenderingContext2D, x: number, w: number, h: number, p: number) {
    const top = Math.round(Math.min(h, h * p + 10));
    const l = Math.round(x - w / 2 - 1);
    const r = Math.round(x + w / 2);
    g.fillStyle = '#4a3220';
    g.fillRect(l, GROUND_Y - top, 2, top);
    g.fillRect(r, GROUND_Y - top, 2, top);
    g.fillStyle = '#8a6440';
    for (let yy = 9; yy <= top; yy += 10) {
      g.fillRect(l - 1, GROUND_Y - yy, r - l + 4, 1);
      g.fillStyle = '#5e4028';
      g.fillRect(l - 1, GROUND_Y - yy + 1, r - l + 4, 1);
      g.fillStyle = '#8a6440';
    }
    // Seilknoten
    g.fillStyle = '#c8b080';
    g.fillRect(l, GROUND_Y - top, 2, 1);
    g.fillRect(r, GROUND_Y - top, 2, 1);
  }

  // ------------------------------------------------------------------ Münzen, Tiere, Figuren

  drawCoins(g: CanvasRenderingContext2D, v: View, state: GameState, time: number): void {
    applyWorld(g, v);
    for (const c of state.coins) {
      if (!this.visible(v, c.x, 10)) continue;
      const air = c.y > 0.5;
      let idx = 0;
      if (air) idx = Math.floor(time * 12 + c.id) % 4;
      else {
        const ph = (time * 0.5 + hash01(c.id)) % 1;
        if (ph < 0.18) idx = Math.floor((ph / 0.18) * 4) % 4;
      }
      const frame = COIN_SEQ[idx];
      this.sd.draw(g, 'coin', frame, c.x, Y(c.y) + 1, idx === 3);
    }
  }

  drawRabbits(g: CanvasRenderingContext2D, v: View, state: GameState, time: number): void {
    applyWorld(g, v);
    for (const r of state.rabbits) {
      if (!this.visible(v, r.x, 12)) continue;
      const moving = r.state !== 'idle';
      const hop = moving ? Math.abs(Math.sin(time * (r.state === 'flee' ? 12 : 8) + r.id)) * (r.state === 'flee' ? 5 : 3) : 0;
      const id: SpriteId = moving && hop > 1 ? 'rabbit.hop' : 'rabbit.idle';
      this.drawShadow(g, r.x, 7);
      this.sd.draw(g, id, 0, r.x, GROUND_Y - Math.round(hop), r.facing < 0);
    }
  }

  private drawShadow(g: CanvasRenderingContext2D, x: number, w: number) {
    g.globalAlpha = 0.5;
    g.drawImage(this.shadow, Math.round(x - w / 2), GROUND_Y - 2, Math.round(w), 3);
    g.globalAlpha = 1;
  }

  drawCitizens(g: CanvasRenderingContext2D, v: View, state: GameState, time: number): void {
    applyWorld(g, v);
    for (const c of state.citizens) {
      if (this.elevated.has(c.id)) continue;
      if (!this.visible(v, c.x, 20)) continue;
      this.drawShadow(g, c.x, 10);
      this.drawCitizenAt(g, c, c.x, GROUND_Y, time, false);
    }
  }

  private drawCitizenAt(g: CanvasRenderingContext2D, c: Citizen, x: number, y: number, time: number, elevated: boolean) {
    const id = citizenSprite(c);
    const sd = this.sd;
    let frame = 0;
    let bob = 0;
    if (id.endsWith('.walk')) {
      frame = sd.frameByDistance(id, c.x, STRIDE_FOLK);
      bob = frame % 2 === 1 ? -1 : 0;
    } else if (id === 'builder.work') {
      frame = Math.floor((time + c.id * 0.13) / (BALANCE.builders.hammerInterval / 2)) % 2;
    } else if (id === 'archer.shoot') {
      frame = c.timer > 0.4 ? 0 : 1;
    } else {
      frame = sd.frameAt(id, time + c.id * 0.31);
    }
    // betäubt/fliehend: Flackern
    if (c.stunned > 0 && Math.floor(time * 12) % 2 === 0) g.globalAlpha = 0.55;
    sd.draw(g, id, frame, x, y + bob, c.facing < 0);
    g.globalAlpha = 1;
    void elevated;
  }

  drawEnemies(g: CanvasRenderingContext2D, v: View, state: GameState, time: number): void {
    applyWorld(g, v);
    for (const e of state.enemies) {
      if (!this.visible(v, e.x, 30)) continue;
      const id = enemySprite(e);
      let frame = 0;
      if (id.endsWith('.walk')) frame = this.sd.frameByDistance(id, e.x, STRIDE_ENEMY);
      else if (id === 'breaker.attack') frame = e.attackTimer < 0.3 ? 1 : 0;
      const flip = e.facing < 0;
      // leichtes Schweben/Wabern
      const sway = e.kind === 'mistling' ? Math.round(Math.sin(time * 9 + e.id) * 0.6) : 0;
      this.drawShadow(g, e.x, e.kind === 'breaker' ? 22 : 10);
      this.sd.draw(g, id, frame, e.x, GROUND_Y + sway, flip);
      if (e.hitFlash > 0) {
        g.globalAlpha = clamp01(e.hitFlash / 0.12);
        this.sd.draw(g, id, frame, e.x, GROUND_Y + sway, flip, Variant.White);
        g.globalAlpha = 1;
      }
      if (e.carrying && e.carrying !== 'coin') {
        const h = this.sd.height(id);
        if (e.carrying === 'crown') {
          if (!this.fx.crownFlyingTo(e.id)) this.sd.draw(g, 'crown', 0, e.x, Y(h + 2));
        }
        else g.drawImage(this.toolIcons.hammer, Math.round(e.x - 2), Y(h + 12));
      } else if (e.carrying === 'coin' && id !== 'mistling.flee') {
        this.sd.draw(g, 'coin', 0, e.x, Y(this.sd.height(id) + 2));
      }
    }
  }

  drawPlayers(g: CanvasRenderingContext2D, v: View, state: GameState, time: number): void {
    applyWorld(g, v);
    const ps = state.players;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!this.visible(v, p.x, 50)) continue;
      if (this.playerHidden(state, p, time)) continue;
      let id: SpriteId = 'monarch.walk';
      let frame = 0;
      let bob = 0;
      const speed = Math.abs(p.vx);
      if (p.anim === 'graze') id = 'monarch.graze';
      else if (p.anim === 'run' || speed > BALANCE.player.walkSpeed * 1.25) {
        id = 'monarch.gallop';
        // Galoppzyklus (4 Frames: gesammelt, Abstoß, Streckung, Landung) über die Strecke; gesammelt = Schwebephase
        frame = this.sd.frameByDistance(id, p.x, STRIDE_GALLOP);
        bob = frame === 0 ? -1 : 0;
      } else if (speed > 4) {
        frame = this.sd.frameByDistance('monarch.walk', p.x, STRIDE_HORSE);
        bob = frame % 2 === 1 ? -1 : 0;
      } else {
        frame = 0;
        bob = Math.sin(time * 1.6 + p.id) > 0.92 ? -1 : 0;
      }
      // Schatten zuerst: drawShadow setzt globalAlpha auf 1 zurück, das Blinken gilt nur der Figur
      this.drawShadow(g, p.x, 38);
      if (p.invuln > 0 && Math.floor(time * 14) % 2 === 0) g.globalAlpha = 0.35;
      const def = this.monarchDef(id, p.hasCrown, i > 0);
      this.sd.drawDef(g, def, frame, p.x, GROUND_Y + bob, p.facing < 0, Variant.Normal, 1);
      g.globalAlpha = 1;
    }
  }

  /**
   * Herrscher-Sprite je Zustand: ohne Krone dieselben Frames mit ausmaskierter Krone; Spieler 2 trägt einen
   * blauen Mantel (Koop: beide Reiter unterscheidbar, passend zur Spieler-2-Farbe im HUD).
   */
  private monarchDef(id: SpriteId, crown: boolean, second: boolean): SpriteDef {
    if (crown && !second) return this.sd.def(id);
    const bank = this.sd.bank;
    const key = second ? (crown ? 'p2' : 'crownless+p2') : 'crownless';
    return bank.edited(id, key, (img) => {
      // alle Herrscher-Sprites teilen sich den Bogen: Frames aller drei Posen bearbeiten (nur desselben Bilds)
      const src = bank.sprite(id).src;
      for (const m of MONARCH_IDS) {
        if (!bank.has(m) || bank.sprite(m).src !== src) continue;
        const frames = bank.sprite(m).frames;
        if (!crown) maskCrown(img, frames);
        if (second) recolorCloak(img, frames);
      }
    });
  }

  drawArrows(g: CanvasRenderingContext2D, v: View, state: GameState): void {
    applyWorld(g, v);
    for (const a of state.arrows) {
      if (!this.visible(v, a.x, 10)) continue;
      let dx = a.vx;
      let dy = -a.vy;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) {
        dx = 0.7;
        dy = 0.7;
      } else {
        dx /= len;
        dy /= len;
      }
      const x0 = a.x;
      const y0 = Y(a.y);
      if (a.stuck) g.globalAlpha = Math.min(1, a.life * 2);
      for (let k = 0; k < 7; k++) {
        g.fillStyle = k === 0 ? '#d4d8e0' : k < 5 ? '#8a6a42' : '#ece4d0';
        g.fillRect(Math.round(x0 - dx * k), Math.round(y0 - dy * k), 1, 1);
      }
      g.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ Glows nach dem Lichtpass

  drawGlowExtras(g: CanvasRenderingContext2D, v: View, state: GameState, atm: Atmosphere, time: number): void {
    applyWorld(g, v);
    const L = this.L;
    const night = atm.night;
    g.globalCompositeOperation = 'lighter';
    // Augen der Nebelbrut
    const eye = L.glowSprite(LightColor.Gold);
    // nachts: leuchtende 1-px-Kontur, damit die dunklen Gestalten vor dem Wald lesbar bleiben
    const rimA = clamp01((night - 0.1) * 1.5) * 0.55;
    for (const e of state.enemies) {
      if (!this.visible(v, e.x, 20)) continue;
      const id = enemySprite(e);
      if (rimA > 0.01) {
        const sway = e.kind === 'mistling' ? Math.round(Math.sin(time * 9 + e.id) * 0.6) : 0;
        let frame = 0;
        if (id.endsWith('.walk')) frame = this.sd.frameByDistance(id, e.x, STRIDE_ENEMY);
        else if (id === 'breaker.attack') frame = e.attackTimer < 0.3 ? 1 : 0;
        g.globalAlpha = rimA * (0.75 + 0.25 * Math.sin(time * 3 + e.id));
        this.sd.drawRim(g, this.sd.def(id), frame, e.x, GROUND_Y + sway, e.facing < 0);
      }
      const h = this.sd.height(id);
      const w = this.sd.width(id);
      const big = e.kind === 'breaker';
      // Augenposition aus den generierten Bögen gemessen (Anteile von Breite/Höhe)
      const ex = Math.round(e.x + e.facing * w * (big ? 0.27 : 0.19));
      const ey = Math.round(Y(h * (big ? 0.68 : 0.55)));
      const r = big ? 7 : 5;
      g.globalAlpha = Math.min(1, 0.25 + 0.75 * night);
      g.drawImage(eye, ex - r, ey - r, r * 2, r * 2);
      g.globalAlpha = 0.55 + 0.45 * night;
      g.fillStyle = '#ffe9b0';
      g.fillRect(ex, ey, 1, 1);
      if (big) g.fillRect(ex - e.facing * 3, ey, 1, 1);
    }
    // Münzglanz
    const gold = L.glowSprite(LightColor.Gold);
    const coins = state.coins;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (!this.visible(v, c.x, 8)) continue;
      const cx = Math.round(c.x);
      const cy = Math.round(Y(c.y + 3));
      if (i >= this.coinLeadN || this.coinLead[i]) {
        g.globalAlpha = 0.12 + 0.4 * night;
        g.drawImage(gold, cx - 6, cy - 6, 12, 12);
      }
      const ph = (time * 0.45 + hash01(c.id * 3)) % 1;
      if (ph < 0.06) {
        const a = Math.sin((ph / 0.06) * Math.PI);
        g.globalAlpha = a;
        g.fillStyle = '#fff8d0';
        g.fillRect(cx - 2, cy - 1, 5, 1);
        g.fillRect(cx, cy - 3, 1, 5);
      }
    }
    // Schreine, Truhen, Risse
    for (const s of state.structures) {
      if (!this.visible(v, s.x, 80)) continue;
      if (s.kind === 'rift') {
        const pulse = 0.8 + 0.2 * Math.sin(time * 2.1 + s.x);
        const k = (0.35 + 0.5 * night) * pulse;
        const vio = L.glowSprite(LightColor.Violet);
        g.globalAlpha = k * 0.7;
        g.drawImage(vio, Math.round(s.x - 46), Math.round(Y(96)), 92, 96);
        g.globalAlpha = k;
        g.drawImage(vio, Math.round(s.x - 16), Math.round(Y(78)), 32, 64);
      } else if (s.kind === 'shrine') {
        const col = s.shrine === 'bow' ? LightColor.Green : LightColor.Gold;
        const h = this.sd.height(s.shrine === 'hammer' ? 'shrine.hammer' : 'shrine.bow');
        const pulse = 0.75 + 0.25 * Math.sin(time * 1.8 + s.x);
        g.globalAlpha = (s.activated ? 0.55 : 0.14) * pulse;
        const r = s.activated ? 40 : 22;
        g.drawImage(L.glowSprite(col), Math.round(s.x - r), Math.round(Y(h * 0.55) - r), r * 2, r * 2);
      } else if (s.kind === 'chest' && !s.opened) {
        const ph = (time * 0.33 + hash01(s.id)) % 1;
        if (ph < 0.08) {
          const a = Math.sin((ph / 0.08) * Math.PI);
          const cx = Math.round(s.x + 3);
          const cy = Y(10);
          g.globalAlpha = a;
          g.fillStyle = '#fff6d0';
          g.fillRect(cx - 3, cy, 7, 1);
          g.fillRect(cx, cy - 3, 1, 7);
          g.globalAlpha = a * 0.6;
          g.drawImage(gold, cx - 8, cy - 8, 16, 16);
        }
      }
    }
    // Lichtsäulen der Schreine
    for (const pl of this.fx.pillars) {
      if (!this.visible(v, pl.x, 40)) continue;
      const k = Math.sin((pl.t / pl.life) * Math.PI);
      const spr = L.glowSprite(pl.color);
      g.globalAlpha = k * 0.8;
      g.drawImage(spr, Math.round(pl.x - 14), v.top - 20, 28, GROUND_Y - v.top + 24);
      g.globalAlpha = k;
      g.drawImage(spr, Math.round(pl.x - 5), v.top - 20, 10, GROUND_Y - v.top + 24);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // fliegende Krone (normal gezeichnet, damit sie auch nachts klar sichtbar ist)
    for (const c of this.fx.crowns) {
      if (!this.visible(v, c.x, 20)) continue;
      const spin = c.landed ? 0 : Math.floor(c.t * 10) % 2;
      this.sd.draw(g, 'crown', 0, c.x, c.y, spin === 1);
    }
  }
}

function citizenById(state: GameState, id: number): Citizen | undefined {
  const cs = state.citizens;
  for (let i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i];
  return undefined;
}

/**
 * Krone aus den Herrscher-Frames ausmaskieren (Kronverlust): in den obersten 3 Zeilen jedes Frames werden
 * die Pixel der Krone transparent – Startpunkte sind alle Pixel der obersten Zeile (Kronenzacken), von dort
 * 8-zusammenhängend über helle Gold-/Messingtöne. Dunkles Haar darunter bleibt stehen.
 */
function maskCrown(img: ImageData, frames: readonly { x: number; y: number; w: number; h: number }[]): void {
  const W = img.width;
  const d = img.data;
  const ROWS = 3;
  for (const f of frames) {
    let top = -1;
    for (let y = f.y; y < f.y + f.h && top < 0; y++)
      for (let x = f.x; x < f.x + f.w; x++)
        if (d[(y * W + x) * 4 + 3] > 0) {
          top = y;
          break;
        }
    if (top < 0) continue;
    const stack: number[] = [];
    for (let x = f.x; x < f.x + f.w; x++) if (d[(top * W + x) * 4 + 3] > 0) stack.push(x, top);
    while (stack.length) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      const i = (y * W + x) * 4;
      if (d[i + 3] === 0) continue;
      if (y > top && d[i] + d[i + 1] + d[i + 2] < 240) continue;
      d[i + 3] = 0;
      for (let dy = 0; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if ((dx || dy) && xx >= f.x && xx < f.x + f.w && yy < top + ROWS) stack.push(xx, yy);
        }
    }
  }
}

/** Farbton (Grad, −60..60) eines rot dominierten Pixels mit Sättigung ≥ 0,6, sonst NaN */
function redHue(r: number, g: number, b: number): number {
  const mn = Math.min(g, b);
  if (r <= g || r <= b || (r - mn) / r < 0.6) return NaN;
  return ((g - b) / (r - mn)) * 60;
}

/** Zielfarbton des Mantels von Spieler 2 (Königsblau) */
const P2_HUE = 220;

/**
 * Mantel blau färben (Spieler 2). Mantel = kräftige Rottöne (Farbton −15..12°, Helligkeit ≥ 100); dunkle
 * Rottöne (bis 16°) nur als Mantelkante, wenn sie an Mantelrot grenzen – dieselbe Farbe steckt sonst auch
 * im Zaumzeug. Sättigung bleibt, Helligkeit +15 % (Blau wirkt bei gleichem Wert dunkler als Rot).
 */
export function recolorCloak(img: ImageData, frames: readonly { x: number; y: number; w: number; h: number }[]): void {
  const W = img.width;
  const d = img.data;
  for (const f of frames) {
    // 1 = Mantel, 2 = Mantelkante
    const mark = new Uint8Array(f.w * f.h);
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = ((f.y + y) * W + f.x + x) * 4;
        if (d[i + 3] === 0 || d[i] < 100) continue;
        const h = redHue(d[i], d[i + 1], d[i + 2]);
        if (h >= -15 && h <= 12) mark[y * f.w + x] = 1;
      }
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        if (mark[y * f.w + x]) continue;
        const i = ((f.y + y) * W + f.x + x) * 4;
        if (d[i + 3] === 0 || d[i] < 40) continue;
        const h = redHue(d[i], d[i + 1], d[i + 2]);
        if (!(h >= -15 && h <= 16)) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < f.w && yy < f.h && mark[yy * f.w + xx] === 1) {
              near = true;
              break;
            }
          }
        if (near) mark[y * f.w + x] = 2;
      }
    for (let k = 0; k < mark.length; k++) {
      if (!mark[k]) continue;
      const i = ((f.y + Math.floor(k / f.w)) * W + f.x + (k % f.w)) * 4;
      const r = d[i];
      const s = (r - Math.min(d[i + 1], d[i + 2])) / r;
      const v = Math.min(255, r * 1.15);
      const lo = v * (1 - s);
      // HSV → RGB im Sektor 180..240° (Blau maximal, Rot minimal)
      d[i] = Math.round(lo);
      d[i + 1] = Math.round(lo + ((v - lo) * (240 - P2_HUE)) / 60);
      d[i + 2] = Math.round(v);
    }
  }
}

function enemySprite(e: Enemy): SpriteId {
  if (e.kind === 'breaker') return e.state === 'attackWall' || e.state === 'attackUnit' || e.anim === 'attack' ? 'breaker.attack' : 'breaker.walk';
  if (e.state === 'flee' || e.anim === 'flee') return 'mistling.flee';
  if (e.state === 'attackWall' || e.state === 'attackUnit' || e.anim === 'attack') return 'mistling.attack';
  return 'mistling.walk';
}
