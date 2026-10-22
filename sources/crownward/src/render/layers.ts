// Crownward – Parallaxe-Ebenen (Berge, Wald fern/nah) mit gecachten Tageszeit-Tönungen, Bodenstreifen,
// Inselufer mit Wasser an beiden Weltenden.

import { BALANCE } from '../sim';
import { GROUND_Y, LAYER_SPECS, type LayerId } from '../shared/sprites';
import type { LayerDef, SpriteBank } from './assets';
import type { Atmosphere } from './atmosphere';
import { applyScreen, applyWorld, type View } from './camera';
import { ctx2d, hex, makeCanvas, makeRng, mixRGB, rgbStr, type RGB } from './util';

/** Oberkante des Bodenstreifens über der Bodenlinie (Grasspitzen) */
export const GROUND_TOP = 18;
/** Uferlinien der Insel (Welt-x) */
export const SHORE_W = BALANCE.world.minX + 210;
export const SHORE_E = BALANCE.world.maxX - 90;
/** Wasseroberfläche (Bildschirm-y) */
export const WATER_Y = GROUND_Y + 12;

interface TintSpec {
  mul: string;
  haze: string;
  hazeA: number;
  /** zusätzlicher Dunst am unteren Rand (See-/Bodennebel) */
  hazeLow: number;
}

// Index: 0 Tag, 1 Abend, 2 Nacht, 3 Morgen
const TINTS: Record<'mountains' | 'forest' | 'forestNear', TintSpec[]> = {
  mountains: [
    { mul: '#f2f6ff', haze: '#a6c2dc', hazeA: 0.28, hazeLow: 0.25 },
    { mul: '#d6a6c6', haze: '#a46a98', hazeA: 0.32, hazeLow: 0.3 },
    { mul: '#4c5490', haze: '#1c2048', hazeA: 0.5, hazeLow: 0.25 },
    { mul: '#e6bccc', haze: '#c890aa', hazeA: 0.32, hazeLow: 0.3 },
  ],
  forest: [
    { mul: '#f4fbff', haze: '#8eacc4', hazeA: 0.12, hazeLow: 0.18 },
    { mul: '#b892b8', haze: '#5c3c6e', hazeA: 0.18, hazeLow: 0.2 },
    { mul: '#3a4278', haze: '#10142e', hazeA: 0.4, hazeLow: 0.15 },
    { mul: '#d2b2c4', haze: '#8a6284', hazeA: 0.16, hazeLow: 0.2 },
  ],
  forestNear: [
    { mul: '#9eb2b4', haze: '#16242a', hazeA: 0.18, hazeLow: 0.1 },
    { mul: '#7e6488', haze: '#24182e', hazeA: 0.22, hazeLow: 0.1 },
    { mul: '#262c58', haze: '#070a1a', hazeA: 0.45, hazeLow: 0.1 },
    { mul: '#9a7e94', haze: '#2e2236', hazeA: 0.2, hazeLow: 0.1 },
  ],
};

class TintedLayer {
  readonly variants: HTMLCanvasElement[];
  constructor(
    readonly def: LayerDef,
    specs: TintSpec[],
  ) {
    this.variants = specs.map((s) => tint(def, s));
  }
}

function tint(def: LayerDef, s: TintSpec): HTMLCanvasElement {
  const c = makeCanvas(def.w, def.h);
  const g = ctx2d(c);
  g.drawImage(def.src, 0, 0, def.srcW, def.srcH, 0, 0, def.w, def.h);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = s.mul;
  g.fillRect(0, 0, def.w, def.h);
  // Alpha der Vorlage wiederherstellen
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(def.src, 0, 0, def.srcW, def.srcH, 0, 0, def.w, def.h);
  g.globalCompositeOperation = 'source-atop';
  const grad = g.createLinearGradient(0, 0, 0, def.h);
  const [r, gg, b] = hex(s.haze);
  grad.addColorStop(0, `rgba(${r},${gg},${b},${s.hazeA})`);
  grad.addColorStop(0.6, `rgba(${r},${gg},${b},${s.hazeA})`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},${Math.min(1, s.hazeA + s.hazeLow)})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, def.w, def.h);
  g.globalCompositeOperation = 'source-over';
  return c;
}

/**
 * Dunstband (Luftperspektive zwischen den Ebenen): senkrechter Alphaverlauf 1×64, Farbe je Tageszeit;
 * neu eingefärbt nur bei merklicher Farbänderung (keine Allokation je Frame).
 */
class HazeBand {
  private c = makeCanvas(1, 64);
  private g = ctx2d(this.c);
  private img = this.g.createImageData(1, 64);
  private profile = new Float32Array(64);
  private last: RGB = [-1, -1, -1];
  constructor(shape: (t: number) => number) {
    for (let y = 0; y < 64; y++) this.profile[y] = shape((y + 0.5) / 64);
  }
  draw(g: CanvasRenderingContext2D, y: number, w: number, h: number, color: RGB, alpha: number): void {
    if (alpha < 0.01) return;
    const L = this.last;
    if (Math.abs(L[0] - color[0]) + Math.abs(L[1] - color[1]) + Math.abs(L[2] - color[2]) > 2) {
      L[0] = color[0];
      L[1] = color[1];
      L[2] = color[2];
      const d = this.img.data;
      for (let i = 0; i < 64; i++) {
        d[i * 4] = color[0];
        d[i * 4 + 1] = color[1];
        d[i * 4 + 2] = color[2];
        // in 8 Stufen (Pixelstil) quantisiert
        d[i * 4 + 3] = Math.round(Math.round(this.profile[i] * 8) * 31.875);
      }
      this.g.putImageData(this.img, 0, 0);
    }
    g.globalAlpha = alpha;
    g.drawImage(this.c, 0, 0, 1, 64, 0, Math.round(y), w, h);
    g.globalAlpha = 1;
  }
}

const rise = (t: number, a: number) => (t >= a ? 1 : (t / a) * (t / a) * (3 - (2 * t) / a));

function drawTiled(g: CanvasRenderingContext2D, img: CanvasImageSource, tileW: number, scroll: number, y: number, viewW: number) {
  let x = -(((scroll % tileW) + tileW) % tileW);
  for (; x < viewW; x += tileW) g.drawImage(img, Math.round(x), y);
}

export class Backdrop {
  private mountains: TintedLayer;
  private forest: TintedLayer;
  private forestNear: TintedLayer;
  private ground: LayerDef;
  private beachW = makeBeach(true);
  private beachE = makeBeach(false);
  private waterTmp: RGB = [0, 0, 0];
  private waterDeep: RGB = hex('#0e1a30');
  private waterLight: RGB = [0, 0, 0];
  /** Talnebel am Fuß der Berge und zwischen fernem und nahem Wald */
  private hazeFar = new HazeBand((t) => rise(t, 0.75));
  private hazeNear = new HazeBand((t) => rise(t, 0.6) * (1 - 0.35 * t));
  private hazeCol: RGB = [0, 0, 0];

  constructor(bank: SpriteBank) {
    this.mountains = new TintedLayer(bank.layer('layer.mountains'), TINTS.mountains);
    const forestDef = bank.layer('layer.forest');
    this.forest = new TintedLayer(forestDef, TINTS.forest);
    this.forestNear = new TintedLayer(forestDef, TINTS.forestNear);
    this.ground = bank.layer('layer.ground');
  }

  private drawLayer(g: CanvasRenderingContext2D, v: View, L: TintedLayer, id: LayerId, parallax: number, bottom: number, scrollOffset: number, atm: Atmosphere) {
    const y = Math.round(bottom - L.def.h + v.bgShift);
    if (y > v.top + v.h || y + L.def.h < v.top) return;
    const scroll = v.camX * parallax + scrollOffset;
    g.globalAlpha = 1;
    drawTiled(g, L.variants[atm.tintA], L.def.w, scroll, y, v.w);
    if (atm.tintF > 0.01 && atm.tintB !== atm.tintA) {
      g.globalAlpha = atm.tintF;
      drawTiled(g, L.variants[atm.tintB], L.def.w, scroll, y, v.w);
      g.globalAlpha = 1;
    }
    void id;
  }

  /** Ferne Ebenen (direkt auf den Haupt-Canvas, nicht vom Lichtpass betroffen). */
  drawFar(g: CanvasRenderingContext2D, v: View, atm: Atmosphere): void {
    applyScreen(g, v);
    this.drawLayer(g, v, this.mountains, 'layer.mountains', LAYER_SPECS['layer.mountains'].parallax, GROUND_Y - 36, 0, atm);
    // Dunst: Horizontfarbe, etwas zur Mitte gezogen; morgens/nachts (Nebel) dichter
    mixRGB(atm.skyHorizon, atm.skyMid, 0.35, this.hazeCol);
    const fog = atm.fog;
    this.hazeFar.draw(g, GROUND_Y - 132 + v.bgShift, v.w, 76, this.hazeCol, 0.34 + 0.22 * fog);
    this.drawLayer(g, v, this.forest, 'layer.forest', LAYER_SPECS['layer.forest'].parallax, GROUND_Y - 6, 0, atm);
    mixRGB(this.hazeCol, atm.ambient, 0.25 * atm.night, this.hazeCol);
    this.hazeNear.draw(g, GROUND_Y - 84 + v.bgShift, v.w, 64, this.hazeCol, 0.2 + 0.2 * fog);
    this.drawLayer(g, v, this.forestNear, 'layer.forest', 0.6, GROUND_Y + 14, this.forest.def.w * 0.47, atm);
  }

  /** Bodenstreifen (kachelt mit Parallaxe 1), Kiesufer und Wasser an den Inselenden. */
  drawGround(g: CanvasRenderingContext2D, v: View, atm: Atmosphere, time: number): void {
    applyWorld(g, v);
    const d = this.ground;
    const top = GROUND_Y - GROUND_TOP;
    const a = Math.max(v.left - 2, SHORE_W);
    const b = Math.min(v.left + v.w + 2, SHORE_E);
    if (b > a) {
      g.save();
      g.beginPath();
      g.rect(a, top - 40, b - a, d.h + 80);
      g.clip();
      let x = Math.floor(a / d.w) * d.w;
      for (; x < b; x += d.w) g.drawImage(d.src, 0, 0, d.srcW, d.srcH, x, top, d.w, d.h);
      g.restore();
      // Füllung unter dem Streifen, falls die Ansicht tiefer reicht
      const below = top + d.h;
      if (v.top + v.h > below) {
        g.fillStyle = '#140e0b';
        g.fillRect(a, below, b - a, v.top + v.h - below);
      }
    }
    const west = v.left < SHORE_W + BEACH_OVERLAP + 2;
    const east = v.left + v.w > SHORE_E - BEACH_OVERLAP - 2;
    // Wasser hinter dem Ufer, dann der Uferhang darüber (unter Wasser später halbtransparent überdeckt)
    if (west || east) this.drawWater(g, v, atm, time, west, east, false);
    if (west) g.drawImage(this.beachW, SHORE_W - BEACH_W, GROUND_Y - BEACH_TOP);
    if (east) g.drawImage(this.beachE, SHORE_E - BEACH_OVERLAP, GROUND_Y - BEACH_TOP);
  }

  /** Wasserlinie vor Schiff und Figuren (nur an den Inselenden sichtbar). */
  drawWaterFront(g: CanvasRenderingContext2D, v: View, atm: Atmosphere, time: number): void {
    const west = v.left < SHORE_W;
    const east = v.left + v.w > SHORE_E;
    if (west || east) this.drawWater(g, v, atm, time, west, east, true);
  }

  /**
   * Wasserfläche. front = false: deckend hinter allem (nach dem Ufer gezeichnet);
   * front = true: halbtransparente Wasserlinie vor Schiff/Figuren (wirken eingetaucht).
   */
  drawWater(g: CanvasRenderingContext2D, v: View, atm: Atmosphere, time: number, west: boolean, east: boolean, front: boolean): void {
    applyWorld(g, v);
    const bottom = v.top + v.h + 2;
    mixRGB(this.waterDeep, atm.skyHorizon, 0.42, this.waterTmp);
    const surface = rgbStr(this.waterTmp);
    mixRGB(this.waterDeep, atm.skyMid, 0.22, this.waterTmp);
    const mid = rgbStr(this.waterTmp);
    const deep = rgbStr(this.waterDeep);
    mixRGB(atm.skyHorizon, [255, 255, 255], 0.25, this.waterLight);
    const shine = rgbStr(this.waterLight);
    for (let side = 0; side < 2; side++) {
      if (side === 0 && !west) continue;
      if (side === 1 && !east) continue;
      // Fläche reicht unter den Uferhang; Schaum und Wellen nur bis zur Wasserkante
      const a = side === 0 ? v.left - 2 : SHORE_E - 2;
      const b = side === 0 ? SHORE_W + 2 : v.left + v.w + 2;
      if (b <= a) continue;
      if (front) {
        // zeilenweise bis zum Uferhang (rechts davon ist Erde, kein Wasser)
        g.globalAlpha = 0.7;
        g.fillStyle = surface;
        for (let y = WATER_Y; y < bottom; y += 3) {
          if (y === WATER_Y + 3) {
            g.globalAlpha = 0.55;
            g.fillStyle = mid;
          }
          const depth = y + 3 - (GROUND_Y + 1);
          const reach = Math.floor(Math.sqrt(Math.max(0, depth) * BEACH_K));
          if (side === 0) {
            const r = Math.min(b, SHORE_W - reach);
            if (r > a) g.fillRect(a, y, r - a, 3);
          } else {
            const l = Math.max(a, SHORE_E + reach);
            if (b > l) g.fillRect(l, y, b - l, 3);
          }
        }
        g.globalAlpha = 1;
        continue;
      }
      g.fillStyle = surface;
      g.fillRect(a, WATER_Y, b - a, 3);
      g.fillStyle = mid;
      g.fillRect(a, WATER_Y + 3, b - a, 9);
      g.fillStyle = deep;
      g.fillRect(a, WATER_Y + 12, b - a, bottom - WATER_Y - 12);
      // Lichtstreifen der Wellen (wandern langsam)
      g.fillStyle = shine;
      const wa = side === 0 ? a : SHORE_E + BEACH_MEET;
      const wb = side === 0 ? SHORE_W - BEACH_MEET : b;
      for (let i = 0; i < 24; i++) {
        const row = i % 6;
        const yy = WATER_Y + 1 + row * 3 + (row > 2 ? row * 2 : 0);
        const speed = (2 + row) * (i % 2 ? 1 : -1);
        const len = 3 + ((i * 7) % 8);
        const period = 173;
        const off = (((i * 97 + time * speed) % period) + period) % period;
        for (let x = Math.floor(wa / period) * period + off; x < wb - len; x += period) {
          if (x < wa) continue;
          g.globalAlpha = row < 2 ? 0.7 : 0.28;
          g.fillRect(Math.round(x), yy, len, 1);
        }
      }
      // Schaum am Ufer
      const meet = side === 0 ? SHORE_W - BEACH_MEET : SHORE_E + BEACH_MEET;
      const wash = Math.round(Math.sin(time * 1.3 + side) * 2);
      g.globalAlpha = 0.75;
      g.fillStyle = '#e6eef2';
      g.fillRect(meet + (side === 0 ? -6 : 1) + wash, WATER_Y, 5, 1);
      g.fillRect(meet + (side === 0 ? -10 : 5) - wash, WATER_Y + 1, 3, 1);
      g.globalAlpha = 1;
    }
  }
}

/** Breite des Kiesufers, Überlappung mit dem Bodenstreifen, Punkt, an dem es ins Wasser taucht */
const BEACH_W = 46;
const BEACH_OVERLAP = 6;
const BEACH_TOP = GROUND_TOP + 2;
/** Hangprofil: Tiefe unter dem Weg in Abhängigkeit vom Abstand i zum Ufer */
const BEACH_K = 34;
const BEACH_MEET = Math.round(Math.sqrt((WATER_Y - GROUND_Y - 1) * BEACH_K));

/** Kiesufer als Pixelbild (Richtung West: Land rechts, Wasser links). */
function makeBeach(dirWest: boolean): HTMLCanvasElement {
  const w = BEACH_W + BEACH_OVERLAP;
  const h = BEACH_TOP + 80;
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  const rnd = makeRng(dirWest ? 91 : 92);
  const sand = hex('#8c7a5e');
  const wet = hex('#4e4034');
  const soil = hex('#1c140f');
  const tmp: RGB = [0, 0, 0];
  for (let col = 0; col < w; col++) {
    // i = Abstand vom Ufer (negativ = über dem Bodenstreifen)
    const i = dirWest ? BEACH_W - col : col - BEACH_OVERLAP;
    const surf = BEACH_TOP + 1 + (i > 0 ? Math.round((i * i) / BEACH_K) : 0);
    // Grasbüschel laufen zum Ufer hin aus
    if (i < 12 && rnd() < 0.55 - i * 0.04) {
      const gh = 1 + Math.floor(rnd() * (6 - Math.max(0, i) * 0.4));
      g.fillStyle = rnd() < 0.5 ? '#4a6a36' : '#36522c';
      g.fillRect(col, surf - gh, 1, gh);
    }
    for (let y = surf; y < h; y++) {
      const depth = y - surf;
      if (i <= 0 && y < BEACH_TOP + 4) continue; // Weg des Bodenstreifens bleibt sichtbar
      if (depth < 3) mixRGB(sand, [210, 196, 160], depth === 0 ? 0.4 : depth === 1 ? 0.12 : 0, tmp);
      else mixRGB(wet, soil, Math.min(1, (depth - 3) / 20), tmp);
      if (i <= 0) {
        // Übergang in den Bodenstreifen: nur dunkle Erde, ausfransend
        if (rnd() < (-i + 1) / (BEACH_OVERLAP + 2)) continue;
        mixRGB(wet, soil, 0.7, tmp);
      }
      g.fillStyle = `rgb(${tmp[0] | 0},${tmp[1] | 0},${tmp[2] | 0})`;
      g.fillRect(col, y, 1, 1);
    }
  }
  // Kiesel auf und im Hang
  for (let k = 0; k < 26; k++) {
    const i = Math.floor(rnd() * BEACH_W);
    const col = dirWest ? BEACH_W - i : i + BEACH_OVERLAP;
    const surf = BEACH_TOP + 1 + Math.round((i * i) / BEACH_K);
    const y = surf + Math.floor(rnd() * rnd() * 10);
    g.fillStyle = rnd() < 0.5 ? '#8e8c88' : '#6c6a6a';
    g.fillRect(col, y, 2, 1);
    g.fillStyle = '#4a4646';
    g.fillRect(col, y + 1, 2, 1);
  }
  return c;
}
