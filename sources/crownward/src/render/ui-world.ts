// Crownward – Weltbezogene Anzeige ohne Text: Münzslots über dem Bauwerk im Fokus, gesperrte Angebote
// (Schloss), kostenlose Aktionen (Funke/Pfeil), kleine Beutelanzeige über der Herrscherfigur.

import { BALANCE, getPlayerFocus, type GameState, type Offer, type Structure } from '../sim';
import { GROUND_Y, type SpriteId } from '../shared/sprites';
import type { SpriteDrawer } from './sprites';
import { applyWorld, type View } from './camera';
import type { Effects } from './effects';
import { ctx2d, makeCanvas } from './util';

const SLOT_PITCH = 10;
/** Kantenlänge eines Münzslots (Münze 9 px) */
const SLOT = 9;
/** höchstens so viele Slots je Reihe; Reihen werden gleichmäßig gefüllt */
const PER_ROW = 10;
/** Höhe der Slotreihe über dem Boden (über dem Kopf der Reiterfigur) */
const SLOT_H = 70;

function ring(fill: string, edge: string, edgeHi: string): HTMLCanvasElement {
  const c = makeCanvas(SLOT, SLOT);
  const g = ctx2d(c);
  // 9×9-Pixelkreis
  const rows = ['..#####..', '.#.....#.', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '.#.....#.', '..#####..'];
  for (let y = 0; y < SLOT; y++) {
    const row = rows[y];
    const a = row.indexOf('#');
    const b = row.lastIndexOf('#');
    for (let x = 0; x < SLOT; x++) {
      if (row[x] === '#') {
        g.fillStyle = y < 4 ? edgeHi : edge;
        g.fillRect(x, y, 1, 1);
      } else if (x > a && x < b) {
        g.fillStyle = fill;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

function lockIcon(): HTMLCanvasElement {
  const c = makeCanvas(7, 8);
  const g = ctx2d(c);
  g.fillStyle = '#1a1420';
  g.fillRect(0, 3, 7, 5);
  g.fillRect(1, 0, 5, 4);
  g.fillStyle = '#c8c0b0';
  g.fillRect(2, 1, 1, 3);
  g.fillRect(4, 1, 1, 3);
  g.fillRect(2, 1, 3, 1);
  g.fillStyle = '#e8b858';
  g.fillRect(1, 4, 5, 3);
  g.fillStyle = '#5a3a1a';
  g.fillRect(3, 5, 1, 1);
  return c;
}

/** Hammer statt Schloss über einem Bau im Gange – das Angebot ist nicht verschlossen, nur schon bezahlt */
function hammerIcon(): HTMLCanvasElement {
  const c = makeCanvas(7, 8);
  const g = ctx2d(c);
  g.fillStyle = '#1a1420';
  g.fillRect(0, 0, 7, 4);
  g.fillRect(2, 3, 3, 5);
  g.fillStyle = '#c8c0b0';
  g.fillRect(1, 1, 5, 2);
  g.fillStyle = '#b07a3a';
  g.fillRect(3, 3, 1, 4);
  return c;
}

/** Sprite eines Bauwerks auf Stufe `level` (für Höhe/Breite der Zustandsbalken) */
const TOWN: SpriteId[] = ['town.0', 'town.1', 'town.2', 'town.3'];
const WALL: SpriteId[] = ['wall.1', 'wall.1', 'wall.2', 'wall.3'];
const TOWER: SpriteId[] = ['tower.1', 'tower.1', 'tower.2'];

function spriteFor(s: Structure, level: number): SpriteId | null {
  switch (s.kind) {
    case 'townCenter':
      return TOWN[Math.min(3, level)];
    case 'wall':
      return WALL[Math.min(3, level)];
    case 'tower':
      return TOWER[Math.min(2, level)];
    case 'farm':
      return 'farm';
    case 'ship':
      return level >= 3 ? 'ship.ready' : 'ship.repair';
    default:
      return null;
  }
}

export class WorldUI {
  private empty = ring('rgba(14,10,24,0.72)', '#b49c6c', '#f2e2b2');
  private blocked = ring('rgba(40,16,20,0.75)', '#6a4a50', '#9a7078');
  private lock = lockIcon();
  private hammer = hammerIcon();
  /** Einblendung je Spieler: [Bauwerks-ID, Alpha] */
  private fade = new Map<number, { id: number; a: number }>();
  private seen = new Set<number>();
  private warned = false;

  constructor(
    private sd: SpriteDrawer,
    private fx: Effects,
  ) {}

  private focus(state: GameState, playerId: number): Offer | null {
    try {
      return getPlayerFocus(state, playerId);
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[render] getPlayerFocus fehlgeschlagen', err);
      }
      return null;
    }
  }

  update(state: GameState, dt: number): void {
    for (const p of state.players) {
      const o = this.focus(state, p.id);
      let f = this.fade.get(p.id);
      if (!f) {
        f = { id: -1, a: 0 };
        this.fade.set(p.id, f);
      }
      if (o && o.structureId === f.id) f.a = Math.min(1, f.a + dt * 7);
      else if (o) {
        f.id = o.structureId;
        f.a = 0.2;
      } else {
        f.a = Math.max(0, f.a - dt * 6);
        if (f.a === 0) f.id = -1;
      }
    }
  }

  draw(g: CanvasRenderingContext2D, v: View, state: GameState, time: number): void {
    applyWorld(g, v);
    this.drawStatusBars(g, v, state);
    this.seen.clear();
    for (const p of state.players) {
      const o = this.focus(state, p.id);
      if (!o) {
        this.drawPurse(g, v, state, p.id, time);
        continue;
      }
      if (this.seen.has(o.structureId)) continue;
      this.seen.add(o.structureId);
      let s: Structure | undefined;
      for (const st of state.structures) if (st.id === o.structureId) s = st;
      if (!s) continue;
      if (s.x < v.left - 40 || s.x > v.left + v.w + 40) continue;
      // Fortschritt: wer gerade einzahlt
      let paid = 0;
      for (const q of state.players) if (q.payTargetId === o.structureId) paid = Math.max(paid, q.payProgress);
      const a = this.fade.get(p.id)?.a ?? 1;
      this.drawSlots(g, o, s.x, paid, a, time);
    }
    g.globalAlpha = 1;
  }

  private blockIcon(o: Offer): HTMLCanvasElement {
    return o.blockedKey === 'blocked.building' ? this.hammer : this.lock;
  }

  private drawSlots(g: CanvasRenderingContext2D, o: Offer, x: number, paid: number, alpha: number, time: number) {
    const baseY = GROUND_Y - SLOT_H;
    g.globalAlpha = alpha;
    if (o.cost <= 0) {
      // kostenlose Aktion: pulsierender Pfeil nach unten mit Funke
      const bounce = Math.round(Math.abs(Math.sin(time * 4)) * 2);
      const cx = Math.round(x);
      const y = baseY + bounce;
      g.fillStyle = o.blockedKey ? '#8a6a70' : '#ffe08a';
      for (let i = 0; i < 4; i++) g.fillRect(cx - 3 + i, y + i, 7 - i * 2, 1);
      g.fillStyle = o.blockedKey ? '#4a3038' : '#a8782a';
      g.fillRect(cx - 3, y - 1, 7, 1);
      if (!o.blockedKey && Math.sin(time * 6) > 0.3) {
        g.fillStyle = '#fffbe6';
        g.fillRect(cx + 5, y - 4, 1, 3);
        g.fillRect(cx + 4, y - 3, 3, 1);
      }
      if (o.blockedKey) g.drawImage(this.blockIcon(o), cx - 3, y - 11);
      g.globalAlpha = 1;
      return;
    }
    const n = o.cost;
    const rows = Math.ceil(n / PER_ROW);
    const perRow = Math.ceil(n / rows);
    const blocked = !!o.blockedKey;
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(perRow, n - r * perRow);
      const rowW = inRow * SLOT_PITCH - 1;
      const left = Math.round(x - rowW / 2);
      const y = baseY - r * SLOT_PITCH;
      // dezente Hinterlegung für Lesbarkeit
      g.globalAlpha = alpha * 0.4;
      g.fillStyle = '#0a0812';
      g.fillRect(left - 2, y - 2, rowW + 4, SLOT + 4);
      g.globalAlpha = alpha;
      for (let i = 0; i < inRow; i++) {
        const k = r * perRow + i;
        const sx = left + i * SLOT_PITCH;
        if (blocked) {
          g.drawImage(this.blocked, sx, y);
        } else if (k < paid) {
          const pop = k === paid - 1 ? -1 : 0;
          this.sd.draw(g, 'coin', 0, sx + SLOT / 2, y + SLOT + pop);
        } else {
          g.drawImage(this.empty, sx, y);
        }
      }
    }
    if (blocked) {
      g.drawImage(this.blockIcon(o), Math.round(x - 3), baseY - (rows - 1) * SLOT_PITCH - 12);
    }
    g.globalAlpha = 1;
  }

  /**
   * Zustandsbalken ohne Text: Baufortschritt (gold) über Baustellen, Trefferpunkte (gelb → orange → rot)
   * über beschädigten Mauern/Türmen. Schmal (2 px), nur solange es etwas zu zeigen gibt.
   */
  private drawStatusBars(g: CanvasRenderingContext2D, v: View, state: GameState) {
    for (const s of state.structures) {
      if (s.x < v.left - 40 || s.x > v.left + v.w + 40) continue;
      const c = s.construction;
      if (c && c.required > 0) {
        const id = spriteFor(s, Math.max(1, c.toLevel));
        if (!id) continue;
        const h = this.sd.height(id);
        this.bar(g, s.x, GROUND_Y - h - 7, Math.min(32, Math.max(18, this.sd.width(id) * 0.5)), c.progress / c.required, '#fecd6e', '#a5732f');
        continue;
      }
      if ((s.kind === 'wall' || s.kind === 'tower') && s.level >= 1 && s.maxHp > 0 && s.hp < s.maxHp) {
        const id = spriteFor(s, s.level);
        if (!id) continue;
        const r = Math.max(0, s.hp / s.maxHp);
        const col = r > 0.5 ? '#e8c050' : r > 0.25 ? '#e56d1f' : '#d23a2a';
        const top = s.kind === 'tower' ? GROUND_Y - 30 : GROUND_Y - this.sd.height(id) - 6;
        this.bar(g, s.x, top, s.kind === 'tower' ? 22 : 18, r, col, '#521810');
      }
    }
    g.globalAlpha = 1;
  }

  private bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, fill: string, shade: string) {
    const left = Math.round(x - w / 2);
    const yy = Math.round(y);
    g.globalAlpha = 0.75;
    g.fillStyle = '#0a0812';
    g.fillRect(left - 1, yy - 1, w + 2, 4);
    g.globalAlpha = 1;
    const fw = Math.round(w * Math.min(1, Math.max(0, frac)));
    if (fw <= 0) return;
    g.fillStyle = fill;
    g.fillRect(left, yy, fw, 1);
    g.fillStyle = shade;
    g.fillRect(left, yy + 1, fw, 1);
  }

  /** Beutel: kleine Münzpunkte über der Figur (beim Halten ohne Angebot / nach dem Aufheben) */
  private drawPurse(g: CanvasRenderingContext2D, v: View, state: GameState, playerId: number, time: number) {
    const p = state.players[playerId];
    if (!p) return;
    const show = this.fx.purseShow.get(playerId) ?? 0;
    const holding = p.actHeld > 0.12 && p.dropCooldown <= 0 ? 1 : 0;
    const a = Math.max(Math.min(1, show * 2), holding);
    if (a <= 0.01) return;
    if (p.x < v.left - 30 || p.x > v.left + v.w + 30) return;
    const n = Math.min(BALANCE.player.purseMax, p.coins);
    const perRow = 10;
    const rows = Math.max(1, Math.ceil(n / perRow));
    const baseY = GROUND_Y - 66;
    g.globalAlpha = a * 0.4;
    g.fillStyle = '#0a0812';
    g.fillRect(Math.round(p.x - 16), baseY - rows * 3 - 1, 32, rows * 3 + 3);
    g.globalAlpha = a;
    for (let k = 0; k < n; k++) {
      const r = Math.floor(k / perRow);
      const i = k % perRow;
      const x = Math.round(p.x - 14 + i * 3);
      const y = baseY - r * 3;
      g.fillStyle = (k + Math.floor(time * 8)) % 13 === 0 ? '#fff4c0' : '#f0c040';
      g.fillRect(x, y, 2, 2);
    }
    if (n === 0) {
      g.fillStyle = '#6a5a70';
      g.fillRect(Math.round(p.x - 3), baseY, 7, 1);
    }
    g.globalAlpha = 1;
  }
}
