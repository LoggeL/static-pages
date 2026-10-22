// Crownward – Canvas-2D-Renderer: logische Auflösung (Höhe 360), Offscreen-Canvas, pixelgenaues
// Hochskalieren (scharf-bilinear bei krummen Faktoren), Ansichten (voll/Splitscreen), Ebenenreihenfolge.

import type { GameState, SimEvent } from '../sim';
import { GROUND_Y, LOGICAL_HEIGHT } from '../shared/sprites';
import { SpriteBank } from './assets';
import { computeAtmosphere, makeAtmosphere } from './atmosphere';
import { Camera, cameraTarget, makeView, type View } from './camera';
import { Effects } from './effects';
import { WorldPainter } from './entities';
import { Backdrop } from './layers';
import { Lighting } from './lighting';
import { Particles } from './particles';
import { Sky } from './sky';
import { SpriteDrawer } from './sprites';
import type { AssetReport, LoadedAssets, RenderFrame, Renderer } from './types';
import { WorldUI } from './ui-world';
import { clamp, ctx2d, hex, makeCanvas, mixRGB, rgbStr, type RGB } from './util';

const MIN_W = 480;
const MAX_W = 960;
/** Splitscreen: sichtbarer Boden unter der Bodenlinie je Hälfte */
const SPLIT_GROUND = 40;
/** maximale Kantenlänge des Zwischenpuffers für das scharfe Hochskalieren */
const MAX_INTER = 4096;
/** Farbe der Erde unter dem Bodenstreifen (Ränder im Hochformat) */
const SOIL = hex('#1a120e');

export class CanvasRenderer implements Renderer {
  logicalWidth = 640;
  readonly logicalHeight = LOGICAL_HEIGHT;

  private out: CanvasRenderingContext2D;
  private main = makeCanvas(640, LOGICAL_HEIGHT);
  private mg = ctx2d(this.main);
  private world = makeCanvas(640, LOGICAL_HEIGHT);
  private wg = ctx2d(this.world);
  private inter: HTMLCanvasElement | null = null;
  private ig: CanvasRenderingContext2D | null = null;
  private interK = 1;

  private bank: SpriteBank;
  private sd: SpriteDrawer;
  private sky = new Sky();
  private backdrop: Backdrop;
  private lighting = new Lighting();
  private particles = new Particles();
  private fx: Effects;
  private painter: WorldPainter;
  private ui: WorldUI;
  private atm = makeAtmosphere();

  /** 0/1 = Spieler im Splitscreen, 2 = gemeinsame Kamera */
  private cams = [new Camera(), new Camera(), new Camera()];
  private views: View[] = [makeView(), makeView()];
  private activeViews: View[] = [];
  private target = { x: 0, facing: 1, speed: 0 };
  private wasSplit = false;
  /** nach snapCamera keine weiche Überblendung beim ersten Aufteilen */
  private justSnapped = false;

  private pixelW = 1;
  private pixelH = 1;
  private dstX = 0;
  private dstY = 0;
  private dstW = 1;
  private dstH = 1;
  private vignette: HTMLCanvasElement;
  private hurtVignette: HTMLCanvasElement;
  private near = (x: number) => this.isNear(x);
  private bandTmp: RGB = [0, 0, 0];

  constructor(
    private canvas: HTMLCanvasElement,
    assets: LoadedAssets,
  ) {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Canvas 2D nicht verfügbar');
    this.out = g;
    this.bank = new SpriteBank(assets);
    this.sd = new SpriteDrawer(this.bank);
    this.backdrop = new Backdrop(this.bank);
    this.fx = new Effects(this.particles);
    this.painter = new WorldPainter(this.sd, this.lighting, this.particles, this.fx);
    this.ui = new WorldUI(this.sd, this.fx);
    this.vignette = makeVignette([6, 4, 16], 0.55);
    this.hurtVignette = makeVignette([170, 16, 24], 0.9);
    this.resize(canvas.clientWidth || canvas.width || 1280, canvas.clientHeight || canvas.height || 720, 1);
    (globalThis as { __crownwardRender?: unknown }).__crownwardRender = this.stats;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const pw = Math.max(1, Math.round(cssWidth * dpr));
    const ph = Math.max(1, Math.round(cssHeight * dpr));
    this.pixelW = pw;
    this.pixelH = ph;
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    const H = LOGICAL_HEIGHT;
    let scale = ph / H;
    let W = Math.ceil(pw / scale - 0.001);
    if (W > MAX_W) W = MAX_W;
    if (W < MIN_W) {
      W = MIN_W;
      scale = pw / W;
    }
    // fast ganzzahlige Faktoren einrasten (gleichmäßige Pixel)
    if (Math.abs(scale - Math.round(scale)) < 0.015 && Math.round(scale) >= 1) scale = Math.round(scale);
    this.logicalWidth = W;
    this.dstW = W * scale;
    this.dstH = H * scale;
    this.dstX = Math.floor((pw - this.dstW) / 2);
    // bei Hochformat etwas über der Mitte (Platz für Touch-Bedienung darunter)
    this.dstY = Math.floor((ph - this.dstH) * (this.dstH < ph - 2 ? 0.4 : 0.5));
    for (const c of [this.main, this.world]) {
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
    }
    this.mg = ctx2d(this.main);
    this.wg = ctx2d(this.world);
    this.lighting.resize(W, H);
    // Zwischenpuffer für scharf-bilineares Skalieren bei krummem Faktor
    const integer = Math.abs(scale - Math.round(scale)) < 1e-6;
    if (integer || scale < 1) {
      this.inter = null;
      this.ig = null;
      this.interK = 1;
    } else {
      let k = scale < 3 ? Math.ceil(scale) : Math.floor(scale);
      while (k > 1 && (k * W > MAX_INTER || k * H > MAX_INTER)) k--;
      if (k <= 1) {
        this.inter = null;
        this.ig = null;
        this.interK = 1;
      } else {
        if (!this.inter) this.inter = makeCanvas(W * k, H * k);
        if (this.inter.width !== W * k) this.inter.width = W * k;
        if (this.inter.height !== H * k) this.inter.height = H * k;
        this.ig = ctx2d(this.inter);
        this.interK = k;
      }
    }
  }

  handleEvents(events: readonly SimEvent[], state: GameState): void {
    this.fx.handle(events, state);
  }

  snapCamera(state: GameState): void {
    const W = this.logicalWidth;
    this.fx.reset();
    this.justSnapped = true;
    for (let i = 0; i < 3; i++) {
      const pid = i === 2 ? -1 : i;
      cameraTarget(state, pid, this.target);
      this.cams[i].snap(this.target.x, this.target.facing, W);
    }
  }

  assetReport(): AssetReport {
    return this.bank.report();
  }

  /** Diagnose für Tests/Debug (nicht Teil des Vertrags) */
  debugInfo(): { particles: number; logicalWidth: number; views: number; camX: number[] } {
    return {
      particles: this.particles.count,
      logicalWidth: this.logicalWidth,
      views: this.activeViews.length,
      camX: this.activeViews.map((v) => v.camX),
    };
  }

  private isNear(x: number): boolean {
    // Indexschleife: kein Iterator-Objekt in nicht optimiertem Code (sehr häufiger Aufruf)
    const vs = this.activeViews;
    for (let i = 0; i < vs.length; i++) if (x > vs[i].left - 160 && x < vs[i].left + vs[i].w + 160) return true;
    return false;
  }

  private setupViews(state: GameState, split: boolean, dt: number): void {
    const W = this.logicalWidth;
    const H = LOGICAL_HEIGHT;
    const tr = this.fx.trauma;
    const shakeX = tr > 0.01 ? Math.round((Math.random() * 2 - 1) * tr * tr * 7) : 0;
    const shakeY = tr > 0.01 ? Math.round((Math.random() * 2 - 1) * tr * tr * 4) : 0;
    this.activeViews.length = 0;
    if (split) {
      if (!this.wasSplit && !this.justSnapped) {
        // beim Aufteilen von der gemeinsamen Kamera aus weich übergehen
        this.cams[0].x = this.cams[2].x;
        this.cams[1].x = this.cams[2].x;
      }
      const hh = H / 2;
      for (let i = 0; i < 2; i++) {
        cameraTarget(state, i, this.target);
        const cam = this.cams[i];
        cam.update(this.target.x, this.target.facing, this.target.speed, W, dt);
        const v = this.views[i];
        v.sx = 0;
        v.sy = i * hh;
        v.w = W;
        v.h = hh;
        v.camX = cam.x;
        v.left = Math.round(cam.x - W / 2) + shakeX;
        v.top = GROUND_Y + SPLIT_GROUND - hh + shakeY;
        v.bgShift = 54;
        v.playerId = i;
        this.activeViews.push(v);
      }
    } else {
      const shared = state.players.length > 1;
      const cam = shared ? this.cams[2] : this.cams[0];
      if (this.wasSplit && shared && !this.justSnapped) cam.x = (this.cams[0].x + this.cams[1].x) / 2;
      cameraTarget(state, shared ? -1 : 0, this.target);
      cam.update(this.target.x, this.target.facing, this.target.speed, W, dt);
      // gemeinsame Kamera auch für Einzelspieler synchron halten
      if (!shared) this.cams[2].x = cam.x;
      const v = this.views[0];
      v.sx = 0;
      v.sy = 0;
      v.w = W;
      v.h = H;
      v.camX = cam.x;
      v.left = Math.round(cam.x - W / 2) + shakeX;
      v.top = shakeY;
      v.bgShift = 0;
      v.playerId = shared ? -1 : 0;
      this.activeViews.push(v);
    }
    this.wasSplit = split;
    this.justSnapped = false;
  }

  render(state: GameState, frame: RenderFrame): void {
    const t0 = performance.now();
    this.renderInner(state, frame);
    // Messwerte für Profiling (globalThis.__crownwardRender): letzte Dauer, gleitendes Mittel, Maximum
    const ms = performance.now() - t0;
    const st = this.stats;
    st.last = ms;
    st.avg = st.frames === 0 ? ms : st.avg * 0.95 + ms * 0.05;
    if (ms > st.max) st.max = ms;
    st.frames++;
  }

  /** Renderzeit-Statistik (ms); max lässt sich über resetStats() zurücksetzen */
  readonly stats = { last: 0, avg: 0, max: 0, frames: 0, resetStats: () => this.resetStats() };

  private resetStats(): void {
    this.stats.max = 0;
    this.stats.frames = 0;
    this.stats.avg = 0;
  }

  private renderInner(state: GameState, frame: RenderFrame): void {
    const dt = clamp(frame.dt, 0, 0.1);
    const time = frame.time;
    const atm = computeAtmosphere(state, this.atm);
    const split = frame.split && state.players.length > 1;

    this.painter.prepare(state);
    this.painter.updateForeground(state, dt);
    this.setupViews(state, split, dt);
    this.fx.update(dt, state);
    this.particles.update(dt);
    this.ui.update(state, dt);
    this.painter.emitAmbient(state, atm, frame.paused ? dt * 0.5 : dt, this.near, this.activeViews);
    this.lighting.begin();
    this.painter.collectLights(state, atm, time);

    const mg = this.mg;
    const wg = this.wg;
    const painter = this.painter;
    for (const v of this.activeViews) {
      // Himmel und ferne Ebenen
      mg.save();
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.beginPath();
      mg.rect(v.sx, v.sy, v.w, v.h);
      mg.clip();
      this.sky.draw(mg, v, atm, time);
      this.backdrop.drawFar(mg, v, atm);

      // Welt (beleuchtet)
      wg.save();
      wg.setTransform(1, 0, 0, 1, 0, 0);
      wg.beginPath();
      wg.rect(v.sx, v.sy, v.w, v.h);
      wg.clip();
      wg.clearRect(v.sx, v.sy, v.w, v.h);
      painter.drawBackDecor(wg, v);
      this.lighting.dimBackground(wg, v, atm, 0.55);
      this.backdrop.drawGround(wg, v, atm, time);
      painter.drawStructures(wg, v, state, time);
      painter.drawCoins(wg, v, state, time);
      painter.drawRabbits(wg, v, state, time);
      painter.drawCitizens(wg, v, state, time);
      painter.drawEnemies(wg, v, state, time);
      painter.drawPlayers(wg, v, state, time);
      painter.drawArrows(wg, v, state);
      this.backdrop.drawWaterFront(wg, v, atm, time);
      this.particles.drawLit(wg, v);
      painter.drawForeground(wg, v, atm);
      this.lighting.applyDarkness(wg, v, atm);
      wg.restore();

      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.drawImage(this.world, v.sx, v.sy, v.w, v.h, v.sx, v.sy, v.w, v.h);

      // Leuchten, Nebel, Funken, Kostenslots
      this.lighting.drawGlows(mg, v, atm);
      painter.drawGlowExtras(mg, v, state, atm, time);
      this.particles.drawGlow(mg, v, time);
      this.ui.draw(mg, v, state, time);
      mg.restore();
    }

    this.drawScreenEffects(split, frame.paused, time);
    this.present();
  }

  private drawScreenEffects(split: boolean, paused: boolean, time: number): void {
    const g = this.mg;
    const W = this.logicalWidth;
    const H = LOGICAL_HEIGHT;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    if (split) {
      for (const v of this.activeViews) {
        g.globalAlpha = 0.5 + 0.3 * this.atm.night;
        g.drawImage(this.vignette, v.sx, v.sy, v.w, v.h);
      }
    } else if (this.dstY > 0) {
      // Hochformat mit Rändern: nur seitlich abdunkeln, damit Himmel/Erde nahtlos in die Ränder übergehen
      g.globalAlpha = 0.45 + 0.35 * this.atm.night;
      g.drawImage(this.vignette, 0, -H * 0.6, W, H * 2.2);
    } else {
      g.globalAlpha = 0.45 + 0.35 * this.atm.night;
      g.drawImage(this.vignette, 0, 0, W, H);
    }
    if (this.fx.hurt > 0.01) {
      g.globalAlpha = this.fx.hurt * (0.75 + 0.25 * Math.sin(time * 20));
      g.drawImage(this.hurtVignette, 0, 0, W, H);
    }
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    if (split) {
      // Trennleiste: dunkles Band mit feiner Goldkante oben und unten
      const y = H / 2;
      g.fillStyle = '#07060c';
      g.fillRect(0, y - 2, W, 4);
      g.fillStyle = 'rgba(232,206,150,0.55)';
      g.fillRect(0, y - 3, W, 1);
      g.fillStyle = 'rgba(232,206,150,0.3)';
      g.fillRect(0, y + 2, W, 1);
    }
    if (paused) {
      g.fillStyle = 'rgba(10,8,20,0.28)';
      g.fillRect(0, 0, W, H);
    }
  }

  private present(): void {
    const o = this.out;
    o.setTransform(1, 0, 0, 1, 0, 0);
    const W = this.logicalWidth;
    const H = LOGICAL_HEIGHT;
    // Ränder (Hoch-/Breitformat): oben Himmel, unten Erde
    if (this.dstY > 0) {
      o.fillStyle = rgbStr(this.atm.skyTop);
      o.fillRect(0, 0, this.pixelW, this.dstY + 1);
      // Erde unten: Bodenfarbe, nachts wie die Welt abgedunkelt
      mixRGB(SOIL, this.atm.ambient, this.atm.ambientAlpha, this.bandTmp);
      o.fillStyle = rgbStr(this.bandTmp);
      o.fillRect(0, this.dstY + this.dstH - 1, this.pixelW, this.pixelH - this.dstY - this.dstH + 1);
    }
    if (this.dstX > 0) {
      o.fillStyle = '#07060c';
      o.fillRect(0, 0, this.dstX + 1, this.pixelH);
      o.fillRect(this.dstX + this.dstW - 1, 0, this.pixelW - this.dstX - this.dstW + 1, this.pixelH);
    }
    if (this.inter && this.ig) {
      const k = this.interK;
      this.ig.imageSmoothingEnabled = false;
      this.ig.drawImage(this.main, 0, 0, W, H, 0, 0, W * k, H * k);
      o.imageSmoothingEnabled = true;
      o.imageSmoothingQuality = 'medium';
      o.drawImage(this.inter, 0, 0, W * k, H * k, this.dstX, this.dstY, this.dstW, this.dstH);
    } else {
      // Verkleinern (schmale Fenster bei dpr 1): geglättet, sonst fallen ganze Pixelzeilen/-spalten weg
      const down = this.dstW < W - 0.5;
      o.imageSmoothingEnabled = down;
      if (down) o.imageSmoothingQuality = 'high';
      o.drawImage(this.main, 0, 0, W, H, this.dstX, this.dstY, this.dstW, this.dstH);
    }
  }
}

/** weiche Randabdunklung (wird geglättet auf die Ansicht skaliert) */
function makeVignette(rgb: [number, number, number], strength: number): HTMLCanvasElement {
  const w = 96;
  const h = 54;
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) / w - 0.5;
      const dy = (y + 0.5) / h - 0.5;
      const d = Math.sqrt(dx * dx * 1.1 + dy * dy * 1.6);
      const a = Math.max(0, Math.min(1, (d - 0.32) / 0.4));
      const o = (y * w + x) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = Math.round(a * a * strength * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

