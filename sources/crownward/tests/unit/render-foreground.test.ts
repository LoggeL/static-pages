// Crownward – Vordergrund-Bäume (Deko-Ebene 1) dürfen wichtige Figuren nicht verdecken (Erstspieler-Befund
// FP-03): Steht ein:e Herrscher:in, Nebelbrut, ein Bürger oder eine Bodenmünze dahinter, blendet der Baum
// geglättet auf FG_MIN_ALPHA aus. Tagsüber ist die Silhouette heller als nachts. Node, ohne Browser: ein
// aufzeichnender Fake-Canvas protokolliert die Deckkraft beider Zeichendurchgänge (Bild, dunkle Silhouette).
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Enemy, type GameState, type GroundCoin } from '../../src/sim';

// ---------------------------------------------------------------- Fake-Canvas

class FakeCtx {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  imageSmoothingEnabled = true;
  fillRect() {}
  clearRect() {}
  drawImage() {}
  setTransform() {}
  save() {}
  restore() {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  ctx = new FakeCtx();
  getContext() {
    return this.ctx;
  }
}

beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = { createElement: () => new FakeCanvas() };
});

const view = (left: number) => ({ sx: 0, sy: 0, w: 640, h: 360, left, camX: left + 320, top: 0, bgShift: 0, playerId: 0 });
const DAY = { night: 0 };
const NIGHT = { night: 1 };

/** Variant-Werte wie in src/render/assets.ts (Normal = 0, Dark = 2) */
const NORMAL = 0;
const DARK = 2;

/** SpriteDrawer-Attrappe: protokolliert Vordergrund-Zeichnungen (drawScaled) mit Deckkraft und Variante */
function fakeDrawer() {
  const drawn: { x: number; variant: number; alpha: number }[] = [];
  const sd = {
    bank: { has: () => true, sprite: (id: string) => ({ id, frames: [] }) },
    def: (id: string) => ({ id }),
    draw: () => 10,
    drawDef: () => {},
    drawScaled: (g: FakeCtx, _id: string, x: number, _y: number, _k: number, _flip: boolean, variant: number) => {
      drawn.push({ x, variant, alpha: g.globalAlpha });
    },
    has: () => true,
    height: () => 150,
    // Fichte im Atlas: 78 px breit
    width: () => 78,
    frameByDistance: () => 0,
    frameAt: () => 0,
  };
  return { sd, drawn };
}

async function setup() {
  const { WorldPainter, FG_DARK_DAY, FG_DARK_NIGHT, FG_MIN_ALPHA } = await import('../../src/render/entities');
  const { sd, drawn } = fakeDrawer();
  const painter = new WorldPainter(sd as never, {} as never, {} as never, {} as never);
  const state = createGame({ seed: 1 });
  // leere Szene: niemand in der Nähe der Bäume, die Herrscherin im Dorf
  state.enemies = [];
  state.citizens = [];
  state.coins = [];
  state.players[0].x = 0;
  painter.prepare(state);
  const trees = painter.foregroundDecor().filter((t) => !t.skipped);
  const g = new FakeCanvas().ctx;
  /** zeichnet die Ansicht um Baum x und liefert Deckkraft beider Durchgänge sowie die Gesamtdeckung */
  const drawTree = (x: number, atm: { night: number } = DAY) => {
    drawn.length = 0;
    painter.drawForeground(g as never, view(x - 320) as never, atm as never);
    const normal = drawn.find((d) => d.x === x && d.variant === NORMAL);
    const dark = drawn.find((d) => d.x === x && d.variant === DARK);
    if (!normal || !dark) throw new Error(`Baum bei ${x} nicht gezeichnet`);
    return { normal: normal.alpha, dark: dark.alpha, coverage: 1 - (1 - normal.alpha) * (1 - dark.alpha) };
  };
  return { painter, state, trees, drawTree, g, FG_DARK_DAY, FG_DARK_NIGHT, FG_MIN_ALPHA };
}

function enemyAt(state: GameState, x: number, kind: Enemy['kind'] = 'mistling'): Enemy {
  // vorhandenes Objekt nicht nötig: der Renderer liest nur x und kind
  return { id: 9001, kind, x, vx: 0, facing: -1, side: 1, hp: 1, maxHp: 1, state: 'walk', targetId: null } as unknown as Enemy;
}

describe('Vordergrund-Bäume', () => {
  it('es gibt sichtbare Vordergrundbäume außerhalb des Dorfs (Voraussetzung der übrigen Prüfungen)', async () => {
    const { trees } = await setup();
    expect(trees.length).toBeGreaterThan(3);
    for (const t of trees) expect(Math.abs(t.x)).toBeGreaterThan(700);
  });

  it('ohne Figur dahinter: voll deckend, nachts fast schwarz, tagsüber heller', async () => {
    const { painter, state, trees, drawTree, FG_DARK_DAY, FG_DARK_NIGHT } = await setup();
    painter.updateForeground(state, 1);
    const x = trees[0].x;
    const day = drawTree(x, DAY);
    expect(day.normal).toBe(1);
    expect(day.dark).toBeCloseTo(FG_DARK_DAY, 5);
    expect(day.coverage).toBeCloseTo(1, 5);
    const night = drawTree(x, NIGHT);
    expect(night.normal).toBe(1);
    expect(night.dark).toBeCloseTo(FG_DARK_NIGHT, 5);
    expect(FG_DARK_DAY).toBeLessThan(FG_DARK_NIGHT);
  });

  it('Herrscherin hinter dem Baum: Baum blendet auf FG_MIN_ALPHA aus, Silhouettenanteil bleibt erhalten', async () => {
    const { painter, state, trees, drawTree, FG_MIN_ALPHA, FG_DARK_DAY } = await setup();
    const x = trees[0].x;
    state.players[0].x = x + 12;
    painter.updateForeground(state, 1);
    const a = drawTree(x, DAY);
    // Gesamtdeckung = FG_MIN_ALPHA → Hintergrund (Figur) zu 1 − FG_MIN_ALPHA sichtbar
    expect(a.coverage).toBeCloseTo(FG_MIN_ALPHA, 4);
    // Mischung Bild : Silhouette wie im deckenden Fall (1 − m) : m
    const imgPart = (1 - a.dark) * a.normal;
    expect(a.dark / (a.dark + imgPart)).toBeCloseTo(FG_DARK_DAY, 4);
    // andere, weit entfernte Bäume bleiben deckend
    const far = trees.find((t) => Math.abs(t.x - x) > 200)!;
    expect(drawTree(far.x).coverage).toBeCloseTo(1, 5);
    // Herrscherin reitet weiter → Baum wieder deckend; globalAlpha zurückgesetzt
    state.players[0].x = x + 200;
    painter.updateForeground(state, 1);
    expect(drawTree(x).coverage).toBeCloseTo(1, 5);
    expect(painter.foregroundAlphaAt(trees[0].index)).toBeCloseTo(1, 5);
  });

  it('Nebelbrut, Bürger und Bodenmünzen hinter dem Baum lassen ihn ebenfalls ausblenden', async () => {
    const { painter, state, trees, drawTree, FG_MIN_ALPHA } = await setup();
    const x = trees[1].x;
    const fresh = () => {
      state.enemies = [];
      state.citizens = [];
      state.coins = [];
      painter.updateForeground(state, 1);
      expect(drawTree(x).coverage).toBeCloseTo(1, 5);
    };
    fresh();
    state.enemies = [enemyAt(state, x - 5)];
    painter.updateForeground(state, 1);
    expect(drawTree(x, NIGHT).coverage).toBeCloseTo(FG_MIN_ALPHA, 4);

    fresh();
    state.enemies = [enemyAt(state, x + 20, 'breaker')];
    painter.updateForeground(state, 1);
    expect(drawTree(x, NIGHT).coverage).toBeLessThan(0.5);

    fresh();
    const base = createGame({ seed: 1 }).citizens[0];
    state.citizens = [{ ...base, x: x + 3 }];
    painter.updateForeground(state, 1);
    expect(drawTree(x).coverage).toBeCloseTo(FG_MIN_ALPHA, 4);

    fresh();
    state.coins = [{ id: 1, x: x - 8, y: 0, vx: 0, vy: 0, age: 3 } as GroundCoin];
    painter.updateForeground(state, 1);
    expect(drawTree(x).coverage).toBeCloseTo(FG_MIN_ALPHA, 4);
  });

  it('weicher Rand: knapp außerhalb der Krone kein Ausblenden, am Rand teilweise', async () => {
    const { painter, state, trees, drawTree, FG_MIN_ALPHA } = await setup();
    const x = trees[0].x;
    state.players[0].x = x + 90;
    painter.updateForeground(state, 1);
    expect(drawTree(x).coverage).toBeCloseTo(1, 5);
    // Kronenhalbbreite ≈ 78 · 1,12 · 0,4 ≈ 35 px + 26 px Pferd → Rand bei ≈ 61 px
    state.players[0].x = x + 61;
    painter.updateForeground(state, 1);
    const edge = drawTree(x).coverage;
    expect(edge).toBeGreaterThan(FG_MIN_ALPHA + 0.05);
    expect(edge).toBeLessThan(0.95);
  });

  it('Ausblenden ist zeitlich geglättet: kein Umspringen in einem Frame, nach ≈ 0,5 s am Ziel', async () => {
    const { painter, state, trees, FG_MIN_ALPHA } = await setup();
    const t = trees[0];
    painter.updateForeground(state, 1);
    state.players[0].x = t.x;
    painter.updateForeground(state, 1 / 60);
    const first = painter.foregroundAlphaAt(t.index);
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThan(0.8);
    for (let i = 0; i < 30; i++) painter.updateForeground(state, 1 / 60);
    expect(painter.foregroundAlphaAt(t.index)).toBeCloseTo(FG_MIN_ALPHA, 2);
    // Pause/Zeitsprung ohne Bewegung (dt = 0) verändert nichts
    const before = painter.foregroundAlphaAt(t.index);
    painter.updateForeground(state, 0);
    expect(painter.foregroundAlphaAt(t.index)).toBe(before);
  });

  it('Sieg: Herrscher:innen an Bord zählen nicht als verdeckte Figur', async () => {
    const { painter, state, trees } = await setup();
    const x = trees[0].x;
    const ship = state.structures.find((s) => s.kind === 'ship')!;
    // künstlich: Schiff an den Baum legen, Sieg seit 1 s → Herrscherin gilt als an Bord (unsichtbar)
    ship.x = x;
    state.players[0].x = x;
    state.outcome = 'victory';
    state.outcomeTime = state.time - 1;
    painter.updateForeground(state, 1);
    expect(painter.foregroundAlphaAt(trees[0].index)).toBeCloseTo(1, 5);
  });
});
