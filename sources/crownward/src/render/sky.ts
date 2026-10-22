// Crownward – Himmel: gebänderter, geditherter Verlauf nach Tageszeit, Sterne, Sonne/Mond auf einem Bogen,
// prozedurale Pixelwolken (vier vorgefärbte Tageszeit-Paletten, überblendet).

import type { Atmosphere } from './atmosphere';
import { applyScreen, type View } from './camera';
import { clamp01, ctx2d, hex, lerp, makeCanvas, makeRng, rgbStr, type RGB } from './util';

const SKY_H = 360;
/** Verlaufsstützpunkte: Mitte und Horizont liegen so, dass der warme Horizont zwischen den Gipfeln sichtbar ist */
const MID_Y = 112;
const HORIZON_Y = 208;
/** Bahnfuß von Sonne/Mond (hinter den Bergen) und Scheitelhöhe – Scheitel unterhalb der HUD-Leiste */
const ARC_BASE = 218;
const SUN_ARC = 152;
const MOON_ARC = 140;
const BANDS = 26;
/** 2×2-Bayer-Schwellen für das Dithering an Bandgrenzen */
const BAYER = [0.2, 0.7, 0.95, 0.45];

const CLOUD_PALETTES: [string, string, string][] = [
  ['#f6f8fc', '#dce3ef', '#aebad2'], // Tag
  ['#ffd09a', '#de8e98', '#77528a'], // Abend
  ['#3c406e', '#2a2e58', '#1c2042'], // Nacht
  ['#ffe0d0', '#e6a8b8', '#8a6c98'], // Morgen
];
const CLOUD_ALPHA = [0.92, 0.95, 0.7, 0.92];

interface Cloud {
  x: number;
  y: number;
  speed: number;
  depth: number;
  shape: number;
}

export class Sky {
  private col = makeCanvas(2, SKY_H);
  private colCtx = ctx2d(this.col);
  private colData = this.colCtx.createImageData(2, SKY_H);
  private pattern: CanvasPattern | null = null;
  /** Farben der ersten/letzten Musterzeile: füllen Bereiche außerhalb 0..SKY_H (Kamerawackeln) */
  private topStr = '#20203a';
  private horizonStr = '#20203a';
  private last = new Float32Array(9).fill(-1);
  private stars: HTMLCanvasElement;
  private twinkle: Float32Array;
  private sun: HTMLCanvasElement;
  /** Sonnenscheibe ganz in Abendrot (wird mit Deckkraft über die tiefe Sonne gelegt) */
  private sunLow: HTMLCanvasElement;
  private moon: HTMLCanvasElement;
  private paleMoon: HTMLCanvasElement;
  private glowWarm: HTMLCanvasElement;
  private glowCool: HTMLCanvasElement;
  private glowPale: HTMLCanvasElement;
  /** großer Abendrot-/Morgenrot-Schein um die tiefe Sonne (weich, ungebändert) */
  private glowSunset: HTMLCanvasElement;
  /** tiefe Schleierwolken am Horizont (abends/morgens angestrahlt) */
  private lowClouds: Cloud[] = [];
  /** cloudShapes[shape][palette] */
  private cloudShapes: HTMLCanvasElement[][] = [];
  private clouds: Cloud[] = [];
  private readonly fieldW = 2200;

  constructor() {
    const rnd = makeRng(4711);
    // Sternenfeld (kachelbar)
    this.stars = makeCanvas(1024, 240);
    const sg = ctx2d(this.stars);
    for (let i = 0; i < 260; i++) {
      const x = Math.floor(rnd() * 1024);
      const y = Math.floor(Math.pow(rnd(), 1.4) * 236);
      const b = rnd();
      sg.fillStyle = b > 0.92 ? '#fff6dc' : b > 0.6 ? '#c8d0f0' : '#7c84b4';
      sg.fillRect(x, y, 1, 1);
      if (b > 0.97) {
        sg.globalAlpha = 0.5;
        sg.fillRect(x - 1, y, 3, 1);
        sg.fillRect(x, y - 1, 1, 3);
        sg.globalAlpha = 1;
      }
    }
    this.twinkle = new Float32Array(3 * 28);
    for (let i = 0; i < 28; i++) {
      this.twinkle[i * 3] = rnd() * 1024;
      this.twinkle[i * 3 + 1] = Math.pow(rnd(), 1.3) * 200;
      this.twinkle[i * 3 + 2] = rnd() * 10;
    }
    this.sun = disc(14, '#fff2c8', '#ffd890', null);
    // auf eigenem Canvas: source-atop färbt nur die Scheibe (auf dem deckenden Himmel wäre es ein Quadrat)
    this.sunLow = disc(14, '#fff2c8', '#ffd890', null);
    const lg = ctx2d(this.sunLow);
    lg.globalCompositeOperation = 'source-atop';
    lg.fillStyle = '#ff9a50';
    lg.fillRect(0, 0, 14, 14);
    this.moon = disc(12, '#e8ecf6', '#b4bcd4', rnd);
    this.paleMoon = disc(20, '#e4f6ea', '#a8c8b8', rnd);
    this.glowWarm = radial(64, [255, 214, 140]);
    this.glowCool = radial(64, [170, 190, 255]);
    this.glowPale = radial(64, [190, 255, 220]);
    this.glowSunset = radial(96, [255, 132, 70], 0, 1.6);
    for (let s = 0; s < 9; s++) this.cloudShapes.push(makeCloud(rnd, s));
    for (let i = 0; i < 20; i++) {
      this.clouds.push({
        x: rnd() * this.fieldW,
        y: 40 + rnd() * 120,
        speed: 1.5 + rnd() * 3,
        depth: 0.02 + rnd() * 0.05,
        shape: Math.floor(rnd() * 9),
      });
    }
    // Schleierwolken (Formen 0, 3, 6 sind Streifen) knapp über den Gipfeln
    for (let i = 0; i < 12; i++) {
      this.lowClouds.push({
        x: rnd() * this.fieldW,
        y: 104 + rnd() * 52,
        speed: 1 + rnd() * 1.5,
        depth: 0.03 + rnd() * 0.03,
        shape: [0, 3, 6][Math.floor(rnd() * 3)],
      });
    }
  }

  private updateColumn(atm: Atmosphere, g: CanvasRenderingContext2D) {
    // nur neu rechnen, wenn sich eine Farbe merklich geändert hat
    const L = this.last;
    let changed = !this.pattern;
    for (let i = 0; i < 3 && !changed; i++) {
      if (
        Math.abs(L[i] - atm.skyTop[i]) > 0.6 ||
        Math.abs(L[3 + i] - atm.skyMid[i]) > 0.6 ||
        Math.abs(L[6 + i] - atm.skyHorizon[i]) > 0.6
      )
        changed = true;
    }
    if (!changed) return;
    for (let i = 0; i < 3; i++) {
      L[i] = atm.skyTop[i];
      L[3 + i] = atm.skyMid[i];
      L[6 + i] = atm.skyHorizon[i];
    }
    const d = this.colData.data;
    const tmp: RGB = [0, 0, 0];
    for (let y = 0; y < SKY_H; y++) {
      // Parameter 0..2 über die beiden Verlaufsabschnitte
      const v = y < MID_Y ? y / MID_Y : 1 + clamp01((y - MID_Y) / (HORIZON_Y - MID_Y));
      const scaled = (v / 2) * BANDS;
      const band = Math.floor(scaled);
      const frac = scaled - band;
      for (let x = 0; x < 2; x++) {
        const b = band + (frac > BAYER[(y & 1) * 2 + x] ? 1 : 0);
        const q = Math.min(2, (b / BANDS) * 2);
        if (q <= 1) mixCol(atm.skyTop, atm.skyMid, q, tmp);
        else mixCol(atm.skyMid, atm.skyHorizon, q - 1, tmp);
        const o = (y * 2 + x) * 4;
        d[o] = tmp[0];
        d[o + 1] = tmp[1];
        d[o + 2] = tmp[2];
        d[o + 3] = 255;
      }
    }
    this.colCtx.putImageData(this.colData, 0, 0);
    this.pattern = g.createPattern(this.col, 'repeat');
    this.topStr = rgbStr(atm.skyTop);
    this.horizonStr = rgbStr(atm.skyHorizon);
  }

  /** Zeichnet den Himmel einer Ansicht (Bildschirmkoordinaten, Welt-y). */
  draw(g: CanvasRenderingContext2D, v: View, atm: Atmosphere, time: number): void {
    this.updateColumn(atm, g);
    applyScreen(g, v);
    // Verlauf nur über 0..SKY_H: das Muster ist am Ursprung verankert und bräche beim Wackeln (v.top < 0)
    // um – oben erschiene sonst eine helle Horizontzeile. Darüber Himmelsfarbe oben, darunter Horizont.
    const top = v.top;
    const bottom = v.top + v.h;
    if (top < 0) {
      g.fillStyle = this.topStr;
      g.fillRect(0, top, v.w, -top);
    }
    const y0 = Math.max(0, top);
    const y1 = Math.min(SKY_H, bottom);
    if (y1 > y0) {
      g.fillStyle = this.pattern ?? this.topStr;
      g.fillRect(0, y0, v.w, y1 - y0);
    }
    if (bottom > SKY_H) {
      g.fillStyle = this.horizonStr;
      g.fillRect(0, SKY_H, v.w, bottom - SKY_H);
    }
    const shift = v.bgShift;

    // Sterne
    if (atm.stars > 0.01) {
      const sx = -((v.camX * 0.02) % 1024) - 1024;
      g.globalAlpha = atm.stars * 0.9;
      for (let x = sx; x < v.w; x += 1024) g.drawImage(this.stars, Math.round(x), shift * 0.3);
      for (let i = 0; i < 28; i++) {
        const tx = (((this.twinkle[i * 3] + sx) % 1024) + 1024) % 1024;
        if (tx > v.w) continue;
        const ph = this.twinkle[i * 3 + 2];
        const a = 0.5 + 0.5 * Math.sin(time * (1.3 + (ph % 1.7)) + ph);
        g.globalAlpha = atm.stars * a;
        g.fillStyle = '#fffbe8';
        g.fillRect(Math.round(tx), Math.round(this.twinkle[i * 3 + 1] + shift * 0.3), 1, 1);
      }
      g.globalAlpha = 1;
    }

    // Abend-/Morgenrot: großer warmer Schein über dem Horizont an der Seite der (tiefen) Sonne
    if (atm.warmth > 0.02) {
      const west = atm.sunU >= 0 ? atm.sunU > 0.5 : atm.phase === 'dusk' || atm.phase === 'night';
      const sx = atm.sunU >= 0 ? lerp(v.w * 0.9, v.w * 0.1, atm.sunU) : west ? v.w * 0.1 : v.w * 0.9;
      const k = atm.warmth;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.62 * k;
      g.drawImage(this.glowSunset, Math.round(sx - 260), Math.round(ARC_BASE - 150 + shift), 520, 260);
      g.globalAlpha = 0.34 * k;
      g.drawImage(this.glowSunset, Math.round(sx - v.w * 0.9), Math.round(ARC_BASE - 120 + shift), Math.round(v.w * 1.8), 200);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }

    // Sonne
    if (atm.sunU >= 0) {
      const u = atm.sunU;
      const x = lerp(v.w * 0.9, v.w * 0.1, u);
      const y = ARC_BASE - Math.sin(u * Math.PI) * SUN_ARC + shift;
      const low = 1 - Math.sin(u * Math.PI);
      g.globalCompositeOperation = 'lighter';
      // weiter, schwacher Lichthof (Tagesstimmung), dann der engere helle Hof
      g.globalAlpha = 0.18 + 0.12 * low;
      g.drawImage(this.glowWarm, Math.round(x - 110), Math.round(y - 90), 220, 180);
      g.globalAlpha = 0.35 + 0.35 * low;
      const r = 26 + 18 * low;
      g.drawImage(this.glowWarm, Math.round(x - r), Math.round(y - r), r * 2, r * 2);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.drawImage(this.sun, Math.round(x - 7), Math.round(y - 7));
      if (low > 0.4) {
        // tiefstehende Sonne rötlich überlagern (nur die Scheibe)
        g.globalAlpha = (low - 0.4) * 1.1;
        g.drawImage(this.sunLow, Math.round(x - 7), Math.round(y - 7));
        g.globalAlpha = 1;
      }
    }

    // Mond
    if (atm.moonU >= 0) {
      const u = atm.moonU;
      const x = lerp(v.w * 0.86, v.w * 0.16, u);
      const y = ARC_BASE - 12 - Math.sin(u * Math.PI) * MOON_ARC + shift;
      const img = atm.paleMoon ? this.paleMoon : this.moon;
      const fade = clamp01(Math.min(u, 1 - u) * 8) * clamp01(atm.night * 1.4);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (atm.paleMoon ? 0.55 : 0.32) * fade;
      const r = atm.paleMoon ? 52 : 34;
      g.drawImage(atm.paleMoon ? this.glowPale : this.glowCool, Math.round(x - r), Math.round(y - r), r * 2, r * 2);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = fade;
      g.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
      g.globalAlpha = 1;
    }

    // Schleierwolken am Horizont: abends/morgens kräftig angestrahlt, tagsüber kaum sichtbar
    const lowK = 0.06 + 0.94 * atm.warmth;
    for (let i = 0; i < this.lowClouds.length; i++) {
      const c = this.lowClouds[i];
      const span = this.fieldW;
      let x = (c.x + time * c.speed - v.camX * c.depth) % span;
      if (x < 0) x += span;
      x -= 160;
      if (x > v.w + 10) continue;
      const y = Math.round(c.y + shift * 0.6);
      const shapes = this.cloudShapes[c.shape];
      const ix = Math.round(x);
      g.globalAlpha = CLOUD_ALPHA[atm.tintA] * lowK * (1 - (atm.tintF > 0.01 && atm.tintB !== atm.tintA ? atm.tintF : 0));
      g.drawImage(shapes[atm.tintA], ix, y);
      if (atm.tintF > 0.01 && atm.tintB !== atm.tintA) {
        g.globalAlpha = CLOUD_ALPHA[atm.tintB] * lowK * atm.tintF;
        g.drawImage(shapes[atm.tintB], ix, y);
      }
    }

    // Wolken (zwei Paletten überblendet)
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const span = this.fieldW;
      let x = (c.x + time * c.speed - v.camX * c.depth) % span;
      if (x < 0) x += span;
      x -= 160;
      if (x > v.w + 10) continue;
      const y = Math.round(c.y + shift * 0.6);
      const shapes = this.cloudShapes[c.shape];
      const a = shapes[atm.tintA];
      const ix = Math.round(x);
      g.globalAlpha = CLOUD_ALPHA[atm.tintA];
      g.drawImage(a, ix, y);
      if (atm.tintF > 0.01 && atm.tintB !== atm.tintA) {
        g.globalAlpha = CLOUD_ALPHA[atm.tintB] * atm.tintF;
        g.drawImage(shapes[atm.tintB], ix, y);
      }
    }
    g.globalAlpha = 1;
  }
}

function mixCol(a: RGB, b: RGB, t: number, out: RGB) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** Pixel-Scheibe (Sonne/Mond) mit Randschattierung und optionalen Kratern */
function disc(d: number, light: string, shade: string, craters: (() => number) | null): HTMLCanvasElement {
  const c = makeCanvas(d, d);
  const g = ctx2d(c);
  const r = d / 2;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const q = (dx * dx + dy * dy) / (r * r);
      if (q > 1) continue;
      g.fillStyle = q > 0.62 && dx + dy > 0 ? shade : light;
      g.fillRect(x, y, 1, 1);
    }
  }
  if (craters) {
    g.fillStyle = shade;
    for (let i = 0; i < Math.round(d / 3); i++) {
      const cx = Math.floor(r * 0.5 + craters() * r);
      const cy = Math.floor(r * 0.5 + craters() * r);
      g.fillRect(cx, cy, 1 + Math.floor(craters() * 2), 1 + Math.floor(craters() * 2));
    }
  }
  return c;
}

/** weicher Radialverlauf (für additive Halos) */
export function radial(size: number, rgb: [number, number, number], bands = 0, power = 2): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      let q = 1 - Math.sqrt(dx * dx + dy * dy) / r;
      if (q <= 0) continue;
      q = Math.pow(q, power);
      if (bands > 0) q = Math.floor(q * bands + 0.35) / bands;
      const o = (y * size + x) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = Math.round(q * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Prozedurale Pixelwolke in vier Paletten (gleiche Form) */
function makeCloud(rnd: () => number, seed: number): HTMLCanvasElement[] {
  const streak = seed % 3 === 0;
  const w = streak ? 70 + Math.floor(rnd() * 90) : 46 + Math.floor(rnd() * 70);
  const h = streak ? 8 + Math.floor(rnd() * 4) : 16 + Math.floor(rnd() * 14);
  const mask = new Uint8Array(w * h); // 0 leer, 1 Schatten, 2 Mitte, 3 Licht
  if (streak) {
    // Schleierwolke: versetzte, 2–3 px dicke waagrechte Bänder mit hellerer Oberkante und ausgefransten Enden
    const lines = 3 + Math.floor(rnd() * 3);
    for (let l = 0; l < lines; l++) {
      const y = Math.min(h - 3, 1 + l * 2 + Math.floor(rnd() * 2));
      const len = Math.floor(w * (0.35 + rnd() * 0.6));
      const x0 = Math.floor(rnd() * (w - len));
      const thick = 2 + (rnd() < 0.4 ? 1 : 0);
      for (let x = x0; x < x0 + len; x++) {
        // Enden verjüngen
        const e = Math.min(x - x0, x0 + len - 1 - x);
        const t = e < 3 ? 1 : thick;
        for (let k = 0; k < t; k++) {
          const level = k === 0 ? (l === 0 ? 3 : 2) : k === t - 1 ? 1 : 2;
          const i = (y + k) * w + x;
          mask[i] = Math.max(mask[i], level);
        }
      }
    }
  } else {
    // Haufenwolke: flache Basis + mehrere Wölbungen, Licht von oben links, Dither an den Grenzen
    const puffs: [number, number, number][] = [];
    const baseRy = Math.max(3, h * 0.2);
    puffs.push([w * 0.5, h - baseRy - 1, w * 0.46]);
    const n = 3 + Math.floor(rnd() * 4);
    for (let p = 0; p < n; p++) {
      const r = 4 + rnd() * (h * 0.48 - 3);
      const cx = w * (0.18 + 0.64 * (p / Math.max(1, n - 1))) + (rnd() - 0.5) * 8;
      puffs.push([cx, h - baseRy - r * 0.55, r]);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = 0;
        for (let k = 0; k < puffs.length; k++) {
          const [cx, cy, r] = puffs[k];
          const ry = k === 0 ? baseRy : r;
          const dx = (x + 0.5 - cx) / r;
          const dy = (y + 0.5 - cy) / ry;
          const q = dx * dx + dy * dy;
          if (q > 1) continue;
          const lightTerm = -dy * 0.85 - dx * 0.25;
          const dither = (x + y) & 1 ? 0.06 : -0.06;
          const level = lightTerm + dither > 0.3 ? 3 : lightTerm + dither > -0.35 ? 2 : 1;
          if (level > best) best = level;
        }
        if (best) mask[y * w + x] = best;
      }
    }
    // flache, schattige Unterkante
    for (let x = 0; x < w; x++) {
      for (let y = h - 2; y < h; y++) if (mask[y * w + x]) mask[y * w + x] = 1;
    }
  }
  return CLOUD_PALETTES.map((pal) => {
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    const cols = pal.map(hex);
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const m = mask[i];
      if (!m) continue;
      const col = cols[3 - m];
      img.data[i * 4] = col[0];
      img.data[i * 4 + 1] = col[1];
      img.data[i * 4 + 2] = col[2];
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  });
}
