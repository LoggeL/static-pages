// Crownward – Partikelsystem mit festem Pool (Struktur aus Typed Arrays, keine Allokation pro Partikel).
// Arten: Pixel (beleuchtet), Rauch (weiche Blobs, beleuchtet), Funke (additiv), Nebel (nach dem Lichtpass).

import { applyWorld, type View } from './camera';
import { radial } from './sky';
import { hex } from './util';

export const PK = {
  Pixel: 0,
  Smoke: 1,
  Spark: 2,
  Mist: 3,
} as const;
export type PK = (typeof PK)[keyof typeof PK];

/** Partikelfarben (Index in PCOL) */
export const PC = {
  Gold: 0,
  PaleGold: 1,
  White: 2,
  Dust: 3,
  Wood: 4,
  WoodLight: 5,
  Stone: 6,
  Violet: 7,
  VioletDark: 8,
  Lavender: 9,
  Ember: 10,
  EmberRed: 11,
  Green: 12,
  Smoke: 13,
  Firefly: 14,
  Red: 15,
  Chaff: 16,
  Fur: 17,
  BlueWhite: 18,
  Leaf: 19,
  FogNight: 20,
} as const;
export type PC = (typeof PC)[keyof typeof PC];

const PCOL_HEX = [
  '#ffd75a',
  '#fff2b0',
  '#ffffff',
  '#a08a6a',
  '#7a4e2c',
  '#c08a50',
  '#8a8a9a',
  '#9a5ae0',
  '#2a1840',
  '#b8a8e0',
  '#ff9a3a',
  '#ff5a2a',
  '#a0f0a0',
  '#5a5a68',
  '#e8ff8a',
  '#ff4a4a',
  '#e8c870',
  '#9a7050',
  '#d0e0ff',
  '#6a8a3a',
  '#6c6aa0',
];

const MAX = 2048;

export class Particles {
  private n = 0;
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private seed = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private col = new Uint8Array(MAX);
  private kind = new Uint8Array(MAX);
  private readonly colors = PCOL_HEX;
  private blobs: HTMLCanvasElement[];

  constructor() {
    this.blobs = PCOL_HEX.map((h) => radial(16, hex(h), 4));
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  /**
   * Neues Partikel (Weltpixel: x, Bildschirm-y). vy positiv = nach unten.
   * grav in px/s², drag = Dämpfung pro Sekunde, grow = Größenzuwachs px/s, alpha = Startdeckkraft.
   */
  emit(kind: PK, x: number, y: number, vx: number, vy: number, life: number, size: number, color: PC, grav = 0, drag = 0, grow = 0, alpha = 1): void {
    let i = this.n;
    if (i >= MAX) {
      // ältestes überschreiben (Index 0 ist zufällig genug, Reihenfolge spielt keine Rolle)
      i = (Math.random() * MAX) | 0;
    } else this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.seed[i] = Math.random() * 100;
    this.alpha[i] = alpha;
    this.col[i] = color;
    this.kind[i] = kind;
  }

  /** Streuung: n Partikel um (x, y) mit zufälliger Geschwindigkeit */
  burst(
    n: number,
    kind: PK,
    x: number,
    y: number,
    spreadX: number,
    spreadY: number,
    vxRange: number,
    vyMin: number,
    vyMax: number,
    life: number,
    size: number,
    color: PC,
    grav = 0,
    drag = 0,
    grow = 0,
    alpha = 1,
  ): void {
    for (let k = 0; k < n; k++) {
      this.emit(
        kind,
        x + (Math.random() - 0.5) * 2 * spreadX,
        y + (Math.random() - 0.5) * 2 * spreadY,
        (Math.random() - 0.5) * 2 * vxRange,
        vyMin + Math.random() * (vyMax - vyMin),
        life * (0.6 + Math.random() * 0.6),
        size,
        color,
        grav,
        drag,
        grow,
        alpha,
      );
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    let i = 0;
    while (i < this.n) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.swapRemove(i);
        continue;
      }
      this.age[i] = age;
      const d = this.drag[i];
      if (d > 0) {
        const k = Math.exp(-d * dt);
        this.vx[i] *= k;
        this.vy[i] *= k;
      }
      this.vy[i] += this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.size[i] += this.grow[i] * dt;
      // Pixel bleiben am Boden liegen
      if (this.kind[i] === PK.Pixel && this.grav[i] > 0 && this.y[i] > 302) {
        this.y[i] = 302;
        this.vy[i] *= -0.25;
        this.vx[i] *= 0.6;
      }
      i++;
    }
  }

  private swapRemove(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.size[i] = this.size[j];
    this.grow[i] = this.grow[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
    this.seed[i] = this.seed[j];
    this.alpha[i] = this.alpha[j];
    this.col[i] = this.col[j];
    this.kind[i] = this.kind[j];
  }

  /** beleuchtete Partikel (Pixel, Rauch) in den Welt-Canvas */
  drawLit(g: CanvasRenderingContext2D, v: View): void {
    applyWorld(g, v);
    const l = v.left - 20;
    const r = v.left + v.w + 20;
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i];
      if (k !== PK.Pixel && k !== PK.Smoke) continue;
      const x = this.x[i];
      if (x < l || x > r) continue;
      const t = this.age[i] / this.life[i];
      if (k === PK.Pixel) {
        g.globalAlpha = this.alpha[i] * (t > 0.7 ? (1 - t) / 0.3 : 1);
        g.fillStyle = this.colors[this.col[i]];
        const s = Math.max(1, Math.round(this.size[i]));
        g.fillRect(Math.round(x), Math.round(this.y[i]), s, s);
      } else {
        const s = this.size[i];
        g.globalAlpha = this.alpha[i] * (1 - t) * Math.min(1, t * 6);
        g.drawImage(this.blobs[this.col[i]], Math.round(x - s), Math.round(this.y[i] - s), Math.round(s * 2), Math.round(s * 2));
      }
    }
    g.globalAlpha = 1;
  }

  /** leuchtende Partikel (additiv) und Nebel nach dem Lichtpass auf den Haupt-Canvas */
  drawGlow(g: CanvasRenderingContext2D, v: View, time: number): void {
    applyWorld(g, v);
    const l = v.left - 40;
    const r = v.left + v.w + 40;
    // Nebel zuerst (normal), dann Funken (additiv)
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] !== PK.Mist) continue;
      const x = this.x[i];
      if (x < l || x > r) continue;
      const t = this.age[i] / this.life[i];
      const s = this.size[i];
      g.globalAlpha = this.alpha[i] * Math.sin(t * Math.PI);
      g.drawImage(this.blobs[this.col[i]], Math.round(x - s), Math.round(this.y[i] - s * 0.35), Math.round(s * 2), Math.round(s * 0.7));
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] !== PK.Spark) continue;
      const x = this.x[i];
      if (x < l || x > r) continue;
      const t = this.age[i] / this.life[i];
      const flick = 0.75 + 0.25 * Math.sin(time * 18 + this.seed[i]);
      const a = this.alpha[i] * (t > 0.6 ? (1 - t) / 0.4 : 1) * flick;
      const s = this.size[i];
      const px = Math.round(x);
      const py = Math.round(this.y[i]);
      if (s > 1.5) {
        g.globalAlpha = a * 0.5;
        const hs = s * 2.5;
        g.drawImage(this.blobs[this.col[i]], Math.round(x - hs), Math.round(this.y[i] - hs), Math.round(hs * 2), Math.round(hs * 2));
      }
      g.globalAlpha = a;
      g.fillStyle = this.colors[this.col[i]];
      g.fillRect(px, py, 1, 1);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
}
