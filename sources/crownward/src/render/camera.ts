// Crownward – Kamera: weiches Folgen mit Vorausschau in Blickrichtung, Klemmen an die Weltgrenzen,
// Kamerawackeln. Eine Ansicht (View) beschreibt einen Bildschirmbereich (voll oder Splitscreen-Hälfte).

import { BALANCE, type GameState } from '../sim';
import { GROUND_Y } from '../shared/sprites';
import { clamp } from './util';

export interface View {
  /** Bildschirmbereich in logischen Pixeln */
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** linke Weltkante (ganzzahlig, inkl. Wackeln) */
  left: number;
  /** Kameramitte in Weltpixeln (ungerundet, für Parallaxe) */
  camX: number;
  /** Welt-y (Bildschirmsystem, GROUND_Y = Boden) am oberen Rand der Ansicht */
  top: number;
  /** vertikaler Versatz der Hintergrundebenen (Splitscreen zeigt den unteren Himmel) */
  bgShift: number;
  /** Spieler, dem die Ansicht folgt (-1 = Mitte aller Spieler) */
  playerId: number;
}

export function makeView(): View {
  return { sx: 0, sy: 0, w: 640, h: 360, left: 0, camX: 0, top: 0, bgShift: 0, playerId: 0 };
}

/** Setzt die Transformation so, dass in Weltpixeln gezeichnet werden kann (x Welt, y = GROUND_Y - Höhe). */
export function applyWorld(g: CanvasRenderingContext2D, v: View): void {
  g.setTransform(1, 0, 0, 1, v.sx - v.left, v.sy - v.top);
}

/** Transformation für Bildschirmkoordinaten innerhalb der Ansicht (0..w, Welt-y). */
export function applyScreen(g: CanvasRenderingContext2D, v: View): void {
  g.setTransform(1, 0, 0, 1, v.sx, v.sy - v.top);
}

export function clipView(g: CanvasRenderingContext2D, v: View): void {
  g.beginPath();
  g.rect(v.sx, v.sy, v.w, v.h);
  g.clip();
}

/** Bildschirm-y einer Höhe über dem Boden */
export const wy = (height: number) => GROUND_Y - height;

export class Camera {
  x = 0;
  /** geglättete Vorausschau */
  lead = 0;
  initialized = false;

  /** Ziel: Mittelpunkt + Blickrichtung; viewW = Breite der Ansicht */
  update(targetX: number, facing: number, speed: number, viewW: number, dt: number): void {
    const P = BALANCE.player;
    const run = clamp(Math.abs(speed) / P.sprintSpeed, 0, 1);
    const leadTarget = facing * viewW * (0.08 + 0.12 * run);
    if (!this.initialized) {
      this.snap(targetX, facing, viewW);
      return;
    }
    // Vorausschau dreht langsam (kein Ruck beim Wenden), Kamera folgt zügig
    this.lead += (leadTarget - this.lead) * (1 - Math.exp(-dt * 1.4));
    const goal = this.clampX(targetX + this.lead, viewW);
    this.x += (goal - this.x) * (1 - Math.exp(-dt * 4.2));
    this.x = this.clampX(this.x, viewW);
  }

  snap(targetX: number, facing: number, viewW: number): void {
    this.lead = facing * viewW * 0.08;
    this.x = this.clampX(targetX + this.lead, viewW);
    this.initialized = true;
  }

  clampX(x: number, viewW: number): number {
    const W = BALANCE.world;
    return clamp(x, W.minX + viewW / 2, W.maxX - viewW / 2);
  }
}

/** Mittelpunkt und Blickrichtung des Kameraziels (ein Spieler oder alle). */
export function cameraTarget(state: GameState, playerId: number, out: { x: number; facing: number; speed: number }) {
  const ps = state.players;
  if (ps.length === 0) {
    out.x = 0;
    out.facing = 1;
    out.speed = 0;
    return out;
  }
  if (playerId >= 0 && playerId < ps.length) {
    const p = ps[playerId];
    out.x = p.x;
    out.facing = p.facing;
    out.speed = p.vx;
    return out;
  }
  let sx = 0;
  let sv = 0;
  for (const p of ps) {
    sx += p.x;
    sv += p.vx;
  }
  out.x = sx / ps.length;
  out.speed = sv / ps.length;
  out.facing = out.speed < -1 ? -1 : out.speed > 1 ? 1 : ps[0].facing;
  return out;
}
