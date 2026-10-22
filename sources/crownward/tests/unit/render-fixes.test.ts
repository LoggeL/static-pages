// Crownward – Regressionstests für Renderer-Befunde (Node, ohne Browser): ein aufzeichnender Fake-Canvas
// protokolliert Zeichenbefehle samt Deckkraft, Compositing und Füllstil. Geprüft werden Blinken bei
// Unverwundbarkeit, Galopp-Frames westlich von x = 0, Mantelfarbe von Spieler 2, Himmel beim Kamerawackeln,
// Abendrot nur auf der Sonnenscheibe und Effekt-Alterung bei Zeitsprüngen.
import { beforeAll, describe, expect, it } from 'vitest';
import { BALANCE, createGame, type GameState, type SimEvent } from '../../src/sim';

// ---------------------------------------------------------------- Fake-Canvas

interface Op {
  op: string;
  args: unknown[];
  alpha: number;
  comp: string;
  fill: unknown;
}

class FakeImageData {
  data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class FakeCtx {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  ops: Op[] = [];
  constructor(readonly canvas: FakeCanvas) {}
  private rec(op: string, args: unknown[]) {
    this.ops.push({ op, args, alpha: this.globalAlpha, comp: this.globalCompositeOperation, fill: this.fillStyle });
  }
  fillRect(...a: number[]) {
    this.rec('fillRect', a);
  }
  clearRect(...a: number[]) {
    this.rec('clearRect', a);
  }
  drawImage(...a: unknown[]) {
    this.rec('drawImage', a);
  }
  setTransform(...a: number[]) {
    this.rec('setTransform', a);
  }
  createImageData(w: number, h: number) {
    return new FakeImageData(w, h);
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return new FakeImageData(w, h);
  }
  putImageData() {}
  createPattern(src: unknown, rep: string) {
    return { kind: 'pattern', src, rep };
  }
  save() {}
  restore() {}
  beginPath() {}
  rect() {}
  clip() {}
  translate() {}
  scale() {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  ctx = new FakeCtx(this);
  getContext() {
    return this.ctx;
  }
}

beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => new FakeCanvas(),
  };
});

const view = (over: Partial<Record<string, number>> = {}) => ({
  sx: 0,
  sy: 0,
  w: 640,
  h: 360,
  left: -320,
  camX: 0,
  top: 0,
  bgShift: 0,
  playerId: 0,
  ...over,
});

// ---------------------------------------------------------------- Herrscher:innen (entities.ts)

/** SpriteDrawer-Attrappe: protokolliert gezeichnete Herrscher-Sprites mit Deckkraft */
function fakeDrawer() {
  const drawn: { id: string; key: string; frame: number; alpha: number }[] = [];
  const edits: string[] = [];
  const sd = {
    bank: {
      has: () => true,
      sprite: (id: string) => ({ id, src: 'sheet', frames: [] }),
      edited: (id: string, key: string) => {
        edits.push(key);
        return { id, key };
      },
    },
    def: (id: string) => ({ id, key: '' }),
    drawDef: (g: FakeCtx, d: { id: string; key: string }, frame: number) => {
      drawn.push({ id: d.id, key: d.key, frame, alpha: g.globalAlpha });
    },
    draw: () => 10,
    has: () => true,
    height: () => 20,
    width: () => 20,
    frameByDistance: (_id: string, dist: number, stride: number) => (((Math.floor(dist / stride) % 4) + 4) % 4),
    frameAt: () => 0,
  };
  return { sd, drawn, edits };
}

async function painterWith(sd: unknown) {
  const { WorldPainter } = await import('../../src/render/entities');
  return new WorldPainter(sd as never, {} as never, {} as never, {} as never);
}

describe('Herrscher:innen zeichnen', () => {
  it('Unverwundbarkeit: Herrscher-Sprite wird in der Blinkphase halbtransparent gezeichnet, Schatten unverändert', async () => {
    const { sd, drawn } = fakeDrawer();
    const painter = await painterWith(sd);
    const state = createGame({ seed: 1 });
    state.players[0].x = 0;
    state.players[0].invuln = 1;
    const g = new FakeCanvas().ctx;
    // time = 0 → Math.floor(0 * 14) % 2 === 0 → durchsichtige Phase
    painter.drawPlayers(g as never, view() as never, state, 0);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].alpha).toBeCloseTo(0.35, 5);
    // sichtbare Phase: voll deckend
    drawn.length = 0;
    painter.drawPlayers(g as never, view() as never, state, 1 / 14 + 0.001);
    expect(drawn[0].alpha).toBe(1);
    // ohne Unverwundbarkeit nie durchsichtig; danach ist globalAlpha wieder 1
    state.players[0].invuln = 0;
    drawn.length = 0;
    painter.drawPlayers(g as never, view() as never, state, 0);
    expect(drawn[0].alpha).toBe(1);
    expect(g.globalAlpha).toBe(1);
  });

  it('Galopp durchläuft auf beiden Inselseiten alle vier Galopp-Frames gleich oft (kein Schrittframe mehr)', async () => {
    const { sd, drawn } = fakeDrawer();
    const painter = await painterWith(sd);
    const state = createGame({ seed: 1 });
    const p = state.players[0];
    p.anim = 'run';
    p.vx = BALANCE.player.sprintSpeed;
    const g = new FakeCanvas().ctx;
    const counts = (from: number) => {
      const n = [0, 0, 0, 0];
      for (let x = from; x < from + 448; x++) {
        p.x = x;
        drawn.length = 0;
        painter.drawPlayers(g as never, view({ left: x - 320 }) as never, state, 0);
        expect(drawn[0].id).toBe('monarch.gallop');
        n[drawn[0].frame]++;
      }
      return n.map((c) => c / 448);
    };
    const west = counts(-2900);
    const east = counts(2400);
    for (const share of [...west, ...east]) expect(share).toBeCloseTo(0.25, 2);
  });

  it('Koop: Spieler 2 nutzt den umgefärbten Mantel, auch ohne Krone', async () => {
    const { sd, drawn, edits } = fakeDrawer();
    const painter = await painterWith(sd);
    const state = createGame({ seed: 1, coop: true });
    expect(state.players).toHaveLength(2);
    state.players[0].x = -10;
    state.players[1].x = 10;
    const g = new FakeCanvas().ctx;
    painter.drawPlayers(g as never, view() as never, state, 0);
    expect(drawn.map((d) => d.key)).toEqual(['', 'p2']);
    state.players[0].hasCrown = false;
    state.players[1].hasCrown = false;
    drawn.length = 0;
    painter.drawPlayers(g as never, view() as never, state, 0);
    expect(drawn.map((d) => d.key)).toEqual(['crownless', 'crownless+p2']);
    expect(edits).toContain('crownless+p2');
  });

  it('recolorCloak färbt nur Mantelrot und angrenzende dunkle Rottöne blau', async () => {
    const { recolorCloak } = await import('../../src/render/entities');
    const img = new FakeImageData(6, 1);
    const px = [
      [137, 28, 26], // Mantel
      [73, 28, 15], // Mantelkante (grenzt an Mantel)
      [244, 227, 211], // Pferd (weiß)
      [144, 71, 32], // Leder (braun)
      [30, 19, 15], // Umriss (dunkel)
      [73, 28, 15], // gleiche dunkle Farbe im Zaumzeug, ohne Mantel daneben
    ];
    px.forEach((c, i) => img.data.set([...c, 255], i * 4));
    recolorCloak(img as unknown as ImageData, [{ x: 0, y: 0, w: 6, h: 1 }]);
    const at = (i: number) => Array.from(img.data.slice(i * 4, i * 4 + 3));
    const [r0, g0, b0] = at(0);
    expect(b0).toBeGreaterThan(140);
    expect(b0).toBeGreaterThan(r0 * 3);
    expect(b0).toBeGreaterThan(g0);
    const [r1, , b1] = at(1);
    expect(b1).toBeGreaterThan(r1 * 3);
    expect(at(2)).toEqual([244, 227, 211]);
    expect(at(3)).toEqual([144, 71, 32]);
    expect(at(4)).toEqual([30, 19, 15]);
    expect(at(5)).toEqual([73, 28, 15]);
  });
});

// ---------------------------------------------------------------- Himmel (sky.ts)

async function skySetup(dayTime: number) {
  const { Sky } = await import('../../src/render/sky');
  const { computeAtmosphere, makeAtmosphere } = await import('../../src/render/atmosphere');
  const { rgbStr } = await import('../../src/render/util');
  const state = createGame({ seed: 1 });
  state.dayTime = dayTime;
  const atm = computeAtmosphere(state, makeAtmosphere());
  return { sky: new Sky(), atm, rgbStr };
}

describe('Himmel', () => {
  it('Kamerawackeln nach oben: Verlauf bricht nicht um, oben steht die Himmelsfarbe', async () => {
    const { sky, atm, rgbStr } = await skySetup(60);
    for (const top of [-4, -1, 0, 3]) {
      const g = new FakeCanvas().ctx;
      sky.draw(g as never, view({ top }) as never, atm, 1);
      const fills = g.ops.filter((o) => o.op === 'fillRect' && o.alpha === 1 && o.comp === 'source-over');
      const pat = fills.filter((o) => (o.fill as { kind?: string })?.kind === 'pattern');
      expect(pat.length).toBeGreaterThan(0);
      for (const o of pat) {
        const [, y, , h] = o.args as number[];
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y + h).toBeLessThanOrEqual(360);
      }
      // gesamte Ansicht lückenlos gefüllt (oberste Zeile = Welt-y top)
      const covered = fills.filter((o) => {
        const [, y, , h] = o.args as number[];
        return y <= top && y + h > top;
      });
      expect(covered.length).toBeGreaterThan(0);
      if (top < 0) expect(covered[0].fill).toBe(rgbStr(atm.skyTop));
    }
  });

  it('tiefstehende Sonne: Abendrot nur auf der Scheibe (kein Quadrat per source-atop auf dem Himmel)', async () => {
    const { sky, atm } = await skySetup(60);
    atm.sunU = 0.05; // low = 1 − sin(0,05π) ≈ 0,84
    const low = 1 - Math.sin(0.05 * Math.PI);
    const g = new FakeCanvas().ctx;
    sky.draw(g as never, view() as never, atm, 1);
    expect(g.ops.some((o) => o.op === 'fillRect' && o.comp === 'source-atop')).toBe(false);
    const tint = g.ops.filter(
      (o) => o.op === 'drawImage' && (o.args[0] as FakeCanvas).width === 14 && Math.abs(o.alpha - (low - 0.4) * 1.1) < 1e-9,
    );
    expect(tint).toHaveLength(1);
    // die getönte Scheibe entsteht auf eigenem Canvas: source-atop dort färbt nur deckende Pixel
    const disc = (tint[0].args[0] as FakeCanvas).ctx.ops;
    expect(disc.some((o) => o.op === 'fillRect' && o.comp === 'source-atop' && o.fill === '#ff9a50')).toBe(true);
  });
});

// ---------------------------------------------------------------- Effekte (effects.ts)

async function effects() {
  const { Effects } = await import('../../src/render/effects');
  const { Particles } = await import('../../src/render/particles');
  return new Effects(new Particles());
}

function builtEvent(state: GameState): SimEvent[] {
  const s = state.structures.find((x) => x.kind === 'wall')!;
  return [{ type: 'buildComplete', x: s.x, structureId: s.id, kind: 'wall', level: 1 }];
}

describe('Effekte altern mit der Spielzeit', () => {
  it('nach einem Zeitsprung (Debug-advance) sind Bau-Aufleuchten und Blitz verschwunden', async () => {
    const fx = await effects();
    const state = createGame({ seed: 1 });
    fx.update(1 / 60, state);
    fx.handle(builtEvent(state), state);
    expect(fx.built.size).toBe(1);
    expect(fx.flashes.length).toBe(1);
    state.time += 5;
    fx.update(1 / 60, state);
    expect(fx.built.size).toBe(0);
    expect(fx.flashes.length).toBe(0);
  });

  it('Pause (Simulation steht): Effekte laufen in Echtzeit aus wie bisher', async () => {
    const fx = await effects();
    const state = createGame({ seed: 1 });
    fx.update(1 / 60, state);
    fx.handle(builtEvent(state), state);
    for (let i = 0; i < 30; i++) fx.update(1 / 60, state);
    expect(fx.built.size).toBe(1);
    for (let i = 0; i < 20; i++) fx.update(1 / 60, state);
    expect(fx.built.size).toBe(0);
  });

  it('1× bei 144 Hz: das Ruckeln des festen Simulationsschritts beschleunigt Effekte nicht', async () => {
    const fx = await effects();
    const state = createGame({ seed: 1 });
    const real = 1 / 144;
    let acc = 0;
    const frame = () => {
      acc += real;
      while (acc >= 1 / 60) {
        acc -= 1 / 60;
        state.time += 1 / 60;
      }
      fx.update(real, state);
    };
    frame();
    fx.handle(builtEvent(state), state);
    // 0,6 s Echtzeit: Aufleuchten (0,7 s) muss noch da sein, mit ≈ 0,1 s Rest
    for (let i = 0; i < Math.round(0.6 * 144); i++) frame();
    expect(fx.built.size).toBe(1);
    const left = [...fx.built.values()][0];
    expect(left).toBeGreaterThan(0.08);
    expect(left).toBeLessThan(0.12);
  });

  it('fallende Krone landet auch bei einem großen Zeitsprung sauber am Boden', async () => {
    const { GROUND_Y } = await import('../../src/shared/sprites');
    const fx = await effects();
    const state = createGame({ seed: 1 });
    state.enemies.length = 0;
    fx.update(1 / 60, state);
    fx.handle([{ type: 'crownLost', x: 0, playerId: 0 }], state);
    expect(fx.crowns).toHaveLength(1);
    state.time += 3;
    fx.update(1 / 60, state);
    const c = fx.crowns[0];
    expect(c.landed).toBe(true);
    expect(c.y).toBe(GROUND_Y - 1);
    expect(Math.abs(c.x)).toBeLessThan(200);
  });
});
