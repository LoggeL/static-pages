// Crownward – Licht-Pass: Umgebungsdunkel auf einem Licht-Canvas, ausgestanzte radiale Lichter
// (gebänderte Pixelverläufe), Anwendung nur auf Welt-Pixel (source-atop), additive farbige Glows.

import type { Atmosphere } from './atmosphere';
import { GROUND_Y } from '../shared/sprites';
import { applyWorld, type View } from './camera';
import { radial } from './sky';
import { ctx2d, makeCanvas, rgbStr } from './util';

export const LightColor = {
  Warm: 0,
  Fire: 1,
  Violet: 2,
  Green: 3,
  Gold: 4,
  Cool: 5,
  Red: 6,
  White: 7,
} as const;
export type LightColor = (typeof LightColor)[keyof typeof LightColor];

const GLOW_RGB: [number, number, number][] = [
  [255, 190, 110], // warm
  [255, 150, 60], // Feuer
  [170, 90, 255], // violett
  [130, 255, 150], // grün
  [255, 220, 110], // gold
  [150, 180, 255], // kühl
  [255, 70, 60], // rot
  [255, 250, 235], // weiß
];

const MAX_LIGHTS = 256;

export class Lighting {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private cut: HTMLCanvasElement;
  /** senkrechter Verlauf: Erdreich unter dem Weg bleibt nachts dunkel (Licht dringt nicht ein) */
  private soilShade: HTMLCanvasElement;
  private glows: HTMLCanvasElement[];
  private n = 0;
  private lx = new Float32Array(MAX_LIGHTS);
  private ly = new Float32Array(MAX_LIGHTS);
  private lr = new Float32Array(MAX_LIGHTS);
  private li = new Float32Array(MAX_LIGHTS);
  /** Glow-Stärke (0 = nur ausstanzen) */
  private lg = new Float32Array(MAX_LIGHTS);
  private lc = new Uint8Array(MAX_LIGHTS);
  private ambientStr = '';
  private ambientKey = -1;

  constructor() {
    this.canvas = makeCanvas(640, 360);
    this.g = ctx2d(this.canvas);
    // weichere Kante (mehr Stufen), damit Lichtkreise nicht als harte Blasen wirken
    this.cut = radial(128, [255, 255, 255], 20, 1.7);
    this.glows = GLOW_RGB.map((c) => radial(64, c, 16, 2.2));
    this.soilShade = makeCanvas(1, 64);
    const sg = ctx2d(this.soilShade);
    for (let y = 0; y < 64; y++) {
      sg.fillStyle = `rgba(4,5,16,${Math.min(1, y / 22).toFixed(3)})`;
      sg.fillRect(0, y, 1, 1);
    }
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.g = ctx2d(this.canvas);
    }
  }

  begin(): void {
    this.n = 0;
  }

  /**
   * Licht in Weltpixeln (x, Bildschirm-y). r = Radius, intensity = Ausstanzstärke 0..1,
   * glow = Stärke des additiven Farbhalos.
   */
  add(x: number, y: number, r: number, intensity: number, color: LightColor, glow = 0.5): void {
    if (this.n >= MAX_LIGHTS) return;
    const i = this.n++;
    this.lx[i] = x;
    this.ly[i] = y;
    this.lr[i] = r;
    this.li[i] = intensity;
    this.lg[i] = glow;
    this.lc[i] = color;
  }

  /** Dunkelt die Welt-Pixel der Ansicht ab (Lichter ausgestanzt). */
  applyDarkness(world: CanvasRenderingContext2D, v: View, atm: Atmosphere): void {
    const a = atm.ambientAlpha;
    if (a < 0.01) return;
    const g = this.g;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.beginPath();
    g.rect(v.sx, v.sy, v.w, v.h);
    g.clip();
    g.clearRect(v.sx, v.sy, v.w, v.h);
    const key = Math.round(atm.ambient[0]) * 65536 + Math.round(atm.ambient[1]) * 256 + Math.round(atm.ambient[2]);
    if (key !== this.ambientKey) {
      this.ambientKey = key;
      this.ambientStr = rgbStr(atm.ambient);
    }
    g.globalAlpha = a;
    g.fillStyle = this.ambientStr;
    g.fillRect(v.sx, v.sy, v.w, v.h);
    applyWorld(g, v);
    g.globalCompositeOperation = 'destination-out';
    const strength = Math.min(1, 0.35 + a * 1.1);
    const left = v.left - 120;
    const right = v.left + v.w + 120;
    for (let i = 0; i < this.n; i++) {
      const x = this.lx[i];
      if (x < left || x > right) continue;
      const r = this.lr[i];
      g.globalAlpha = Math.min(0.92, this.li[i] * strength);
      // Lichtkegel etwas breiter als hoch (Licht fällt am Boden entlang)
      const rx = r * 1.2;
      const ry = r * 0.78;
      g.drawImage(this.cut, Math.round(x - rx), Math.round(this.ly[i] - ry), Math.round(rx * 2), Math.round(ry * 2));
    }
    g.restore();
    world.save();
    world.setTransform(1, 0, 0, 1, 0, 0);
    world.globalCompositeOperation = 'source-atop';
    world.drawImage(this.canvas, v.sx, v.sy, v.w, v.h, v.sx, v.sy, v.w, v.h);
    applyWorld(world, v);
    world.globalAlpha = Math.min(1, a * 1.1);
    world.drawImage(this.soilShade, v.left, GROUND_Y + 8, v.w, 64);
    world.restore();
  }

  /**
   * Zusätzliches Umgebungsdunkel nur für die bis jetzt gezeichneten Welt-Pixel (Bäume hinter dem Weg):
   * so werden sie von Fackeln schwächer erhellt als Figuren und Bauwerke davor.
   */
  dimBackground(world: CanvasRenderingContext2D, v: View, atm: Atmosphere, amount: number): void {
    const a = atm.ambientAlpha * amount;
    if (a < 0.01) return;
    world.save();
    world.setTransform(1, 0, 0, 1, 0, 0);
    world.globalCompositeOperation = 'source-atop';
    world.globalAlpha = a;
    world.fillStyle = this.ambientStr || rgbStr(atm.ambient);
    world.fillRect(v.sx, v.sy, v.w, v.h);
    world.restore();
  }

  /** Additive Farbhalos auf den Haupt-Canvas (nach dem Welt-Composite). */
  drawGlows(g: CanvasRenderingContext2D, v: View, atm: Atmosphere): void {
    applyWorld(g, v);
    g.globalCompositeOperation = 'lighter';
    const nightBoost = 0.25 + 0.75 * atm.night;
    const left = v.left - 120;
    const right = v.left + v.w + 120;
    for (let i = 0; i < this.n; i++) {
      const gl = this.lg[i];
      if (gl <= 0) continue;
      const x = this.lx[i];
      if (x < left || x > right) continue;
      const r = this.lr[i] * 0.75;
      g.globalAlpha = Math.min(1, gl * nightBoost);
      g.drawImage(this.glows[this.lc[i]], Math.round(x - r), Math.round(this.ly[i] - r), Math.round(r * 2), Math.round(r * 2));
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** einzelner Glow sofort zeichnen (Weltpixel), z. B. Augen, Münzglanz, Lichtsäule */
  glowSprite(color: LightColor): HTMLCanvasElement {
    return this.glows[color];
  }
}
