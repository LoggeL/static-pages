// Crownward – Zeichnen einzelner Sprites aus dem Atlas: Fußpunkt-Anker, Spiegelung, Frames, Teil-Enthüllung.

import type { SpriteId } from '../shared/sprites';
import { Variant, type SpriteBank, type SpriteDef } from './assets';

export class SpriteDrawer {
  constructor(readonly bank: SpriteBank) {}

  def(id: SpriteId): SpriteDef {
    return this.bank.sprite(id);
  }

  /**
   * Zeichnet Frame `frame` von `id` mit Fußpunkt (x, y) in Weltpixeln.
   * flip = true spiegelt (Quellbilder schauen nach rechts). Rückgabe: gezeichnete Höhe.
   */
  draw(
    g: CanvasRenderingContext2D,
    id: SpriteId,
    frame: number,
    x: number,
    y: number,
    flip = false,
    variant: Variant = Variant.Normal,
  ): number {
    const d = this.bank.sprite(id);
    this.drawDef(g, d, frame, x, y, flip, variant, 1);
    return d.h;
  }

  drawDef(
    g: CanvasRenderingContext2D,
    d: SpriteDef,
    frame: number,
    x: number,
    y: number,
    flip: boolean,
    variant: Variant,
    reveal: number,
  ): void {
    const n = d.frames.length;
    const f = d.frames[((frame % n) + n) % n];
    const img = this.bank.image(d, flip, variant);
    const s = d.scale;
    const sx = flip ? d.srcW - f.x - f.w : f.x;
    const offX = flip ? -d.offX : d.offX;
    const dw = f.w * s;
    const dh = f.h * s;
    const left = Math.round(x - dw / 2 - offX * s);
    const top = Math.round(y - dh - d.offY * s);
    if (reveal >= 1) {
      g.drawImage(img, sx, f.y, f.w, f.h, left, top, dw, dh);
      return;
    }
    if (reveal <= 0) return;
    // nur den unteren Anteil zeigen (Bau-Fortschritt)
    const shSrc = Math.max(1, Math.round(f.h * reveal));
    const shDst = shSrc * s;
    g.drawImage(img, sx, f.y + f.h - shSrc, f.w, shSrc, left, top + dh - shDst, dw, shDst);
  }

  /**
   * 1-px-Kontur eines Frames (Variant.Rim, liegt außerhalb der Figur): Quellrechteck um 1 px erweitert
   * (Atlas-Frames haben 2 px Abstand). Farbe/Deckkraft bestimmt der Aufrufer (globalAlpha, Compositing).
   */
  drawRim(g: CanvasRenderingContext2D, d: SpriteDef, frame: number, x: number, y: number, flip: boolean): void {
    const n = d.frames.length;
    const f = d.frames[((frame % n) + n) % n];
    const img = this.bank.image(d, flip, Variant.Rim);
    const s = d.scale;
    const sx = flip ? d.srcW - f.x - f.w : f.x;
    const offX = flip ? -d.offX : d.offX;
    const dw = f.w * s;
    const dh = f.h * s;
    const left = Math.round(x - dw / 2 - offX * s);
    const top = Math.round(y - dh - d.offY * s);
    const x0 = Math.max(0, sx - 1);
    const y0 = Math.max(0, f.y - 1);
    const x1 = Math.min(d.srcW, sx + f.w + 1);
    const y1 = Math.min(d.srcH, f.y + f.h + 1);
    g.drawImage(img, x0, y0, x1 - x0, y1 - y0, left + (x0 - sx) * s, top + (y0 - f.y) * s, (x1 - x0) * s, (y1 - y0) * s);
  }

  /** Frame 0 mit zusätzlichem Maßstab (Vordergrund-Deko); Fußpunkt (x, y). */
  drawScaled(g: CanvasRenderingContext2D, id: SpriteId, x: number, y: number, k: number, flip: boolean, variant: Variant): void {
    const d = this.bank.sprite(id);
    const f = d.frames[0];
    const img = this.bank.image(d, flip, variant);
    const s = d.scale * k;
    const sx = flip ? d.srcW - f.x - f.w : f.x;
    const offX = flip ? -d.offX : d.offX;
    const dw = Math.round(f.w * s);
    const dh = Math.round(f.h * s);
    g.drawImage(img, sx, f.y, f.w, f.h, Math.round(x - dw / 2 - offX * s), Math.round(y - dh - d.offY * s), dw, dh);
  }

  /** Frame-Index aus Zeit (zyklisch nach fps des Sprites) */
  frameAt(id: SpriteId, time: number, speed = 1): number {
    const d = this.bank.sprite(id);
    return Math.floor(time * d.fps * speed) % d.frames.length;
  }

  /** Frame-Index aus zurückgelegter Strecke (Füße gleiten nicht) */
  frameByDistance(id: SpriteId, dist: number, stride: number): number {
    const d = this.bank.sprite(id);
    const n = d.frames.length;
    return ((Math.floor(dist / stride) % n) + n) % n;
  }

  /** true, wenn ein echtes Atlas-Sprite (kein Platzhalter) vorliegt */
  has(id: SpriteId): boolean {
    return this.bank.has(id);
  }

  height(id: SpriteId): number {
    return this.bank.sprite(id).h;
  }

  width(id: SpriteId): number {
    return this.bank.sprite(id).w;
  }
}
