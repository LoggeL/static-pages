// Crownward – Regressionstests der App-/UI-/Eingabeschicht (ohne DOM): Speicherstand-Auswahl, Ereignisfilter nach
// Spielende, Gamepad-Sperre beim Wechsel Menü → Spiel, Pad-/Tastenzuordnung im Koop, deutsche Einzahl-Texte.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE, NO_INPUT, SIM_DT, createGame, serializeGame, stepGame, type GameState, type Offer, type SimEvent } from '../../src/sim';
import { blockedSave, listSaves, newestSave, readMeta } from '../../src/app/storage';
import { GameLoop, liveEvents, type LoopHost } from '../../src/app/loop';
import { GamepadInput, padPlayer } from '../../src/input/gamepad';
import { BINDINGS, keyPlayer, keySide } from '../../src/input/keyboard';
import type { MenuAction } from '../../src/input/types';
import { describeOffer, holdLabel } from '../../src/ui/hints';
import { feedEvents, nightSubKey } from '../../src/ui/feed';
import type { Toasts } from '../../src/ui/toasts';
import type { AudioEngine } from '../../src/audio';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- Speicherstände (APP-1, APP-2) ----------

function memoryStorage(data: Record<string, string>): Storage {
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear: () => {
      for (const k of Object.keys(data)) delete data[k];
    },
    getItem: (k: string) => (k in data ? data[k] : null),
    key: (i: number) => Object.keys(data)[i] ?? null,
    removeItem: (k: string) => {
      delete data[k];
    },
    setItem: (k: string, v: string) => {
      data[k] = String(v);
    },
  };
}

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function validSave(day: number, minutesAgo: number): string {
  const s = createGame({ seed: 3, coop: false });
  s.day = day;
  return serializeGame(s, iso(minutesAgo));
}

const newerVersion = (minutesAgo: number) =>
  JSON.stringify({ format: 'crownward-save', version: 2, savedAt: iso(minutesAgo), state: { day: 4, coop: false } });

function withSaves(slots: { slot1?: string; auto?: string }): void {
  const data: Record<string, string> = {};
  if (slots.slot1) data['crownward.save.slot1'] = slots.slot1;
  if (slots.auto) data['crownward.save.auto'] = slots.auto;
  vi.stubGlobal('window', { localStorage: memoryStorage(data) });
}

describe('Speicherstand-Auswahl', () => {
  it('neuester ladbarer Stand gewinnt – auch gegen einen älteren Schnellspeicherstand (F9 = Pausemenü „Laden")', () => {
    withSaves({ slot1: validSave(2, 30), auto: validSave(3, 1) });
    expect(newestSave()?.slot).toBe('auto');
    expect(newestSave()?.day).toBe(3);
    expect(blockedSave()).toBeNull();
    expect(listSaves().map((m) => m.slot)).toEqual(['auto', 'slot1']);
  });

  it('ein neuerer, aber unladbarer Stand verdrängt den ladbaren Autosave nicht', () => {
    withSaves({ slot1: newerVersion(0), auto: validSave(3, 60) });
    const meta = readMeta('slot1');
    expect(meta?.error).toMatch(/neueren Spielversion \(Version 2\)/);
    expect(newestSave()?.slot).toBe('auto');
    // … wird aber als Hinweis gemeldet, weil er neuer ist
    expect(blockedSave()?.slot).toBe('slot1');
  });

  it('nur unladbare Stände: kein „Fortsetzen", aber ein Grund', () => {
    withSaves({ slot1: newerVersion(0), auto: '{kaputt' });
    expect(newestSave()).toBeNull();
    expect(blockedSave()?.slot).toBe('slot1');
    expect(readMeta('auto')?.error).toMatch(/beschädigt/);
  });

  it('ein älterer kaputter Stand neben einem neueren gültigen erzeugt keinen Hinweis', () => {
    withSaves({ slot1: validSave(5, 0), auto: '{"format":"crownward-save","version":1,"savedAt":"2020-01-01T00:00:00Z","state":{}}' });
    expect(newestSave()?.slot).toBe('slot1');
    expect(blockedSave()).toBeNull();
  });

  it('leerer Speicher', () => {
    withSaves({});
    expect(newestSave()).toBeNull();
    expect(blockedSave()).toBeNull();
    expect(readMeta('slot1')).toBeNull();
  });
});

// ---------- Ereignisse nach Spielende (APP-3) ----------

describe('liveEvents nach Sieg/Niederlage', () => {
  const ev = (type: string): SimEvent => ({ type, x: 0 }) as unknown as SimEvent;

  it('während des Spiels alles, danach nur bis einschließlich des Ausgangsereignisses', () => {
    const g = createGame({ seed: 1, coop: false });
    const batch = [ev('coinPaid'), ev('victory'), ev('phaseChange'), ev('nightWarning')];
    expect(liveEvents(batch, g)).toBe(batch);
    g.outcome = 'victory';
    expect(liveEvents(batch, g).map((e) => e.type)).toEqual(['coinPaid', 'victory']);
    expect(liveEvents([ev('playerHit'), ev('crownLost'), ev('defeat')], g).map((e) => e.type)).toEqual(['playerHit', 'crownLost', 'defeat']);
    // spätere Schritte: nichts mehr
    expect(liveEvents([ev('phaseChange'), ev('playerHit'), ev('crownLost')], g)).toEqual([]);
  });

  function runLoop(outcome: GameState['outcome']) {
    const game = createGame({ seed: 5, coop: false });
    game.outcome = outcome;
    const audioEvents: SimEvent[] = [];
    const appEvents: SimEvent[] = [];
    const audio = { handleEvents: (e: readonly SimEvent[]) => audioEvents.push(...e), update: () => undefined } as unknown as AudioEngine;
    const host: LoopHost = {
      renderer: () => null,
      audio,
      game: () => game,
      simulating: () => true,
      paused: () => false,
      inputs: (n) => Array.from({ length: n }, () => NO_INPUT),
      beginFrame: () => undefined,
      onEvents: (e) => appEvents.push(...e),
      endFrame: () => undefined,
    };
    const loop = new GameLoop(host);
    loop.timeScale = 64;
    // bis in die Dämmerung: Phasenwechsel und Nachtwarnung entstehen
    for (let i = 0; i < 400 && game.phase === 'day'; i++) loop.tick(0.1);
    return { game, audioEvents, appEvents };
  }

  it('Audio erhält nach Spielende keine Ereignisse mehr, die App-Schicht weiterhin alle (Debug)', () => {
    const after = runLoop('victory');
    expect(after.game.phase).not.toBe('day');
    expect(after.appEvents.some((e) => e.type === 'phaseChange')).toBe(true);
    expect(after.audioEvents).toEqual([]);
    const during = runLoop('playing');
    expect(during.audioEvents.some((e) => e.type === 'phaseChange')).toBe(true);
  });
});

// ---------- Gamepad (INP-1, INP-2) ----------

interface FakePad {
  index: number;
  connected: boolean;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

function fakePads(count: number): FakePad[] {
  const pads = Array.from({ length: count }, (_, index) => ({
    index,
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  }));
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  return pads;
}

const press = (pad: FakePad, i: number, down: boolean) => {
  pad.buttons[i] = { pressed: down, value: down ? 1 : 0 };
};

describe('Gamepad: Bestätigen im Menü wirkt nicht ins Spiel hinein', () => {
  const A = 0;
  const B = 1;

  it('A bestätigt im Menü, bleibt gehalten → im Spiel erst nach erneutem Drücken „act"', () => {
    const [pad] = fakePads(1);
    const gp = new GamepadInput();
    const actions: MenuAction[] = [];
    const emit = (a: MenuAction) => actions.push(a);
    press(pad, A, true);
    gp.poll('menu', emit, () => undefined);
    expect(actions).toEqual(['confirm']);
    // App wechselt in den Spielmodus (InputManager.setMode('game') → latchHeld)
    gp.latchHeld();
    gp.poll('game', emit, () => undefined);
    expect(gp.input(0)?.act).toBe(false);
    gp.poll('game', emit, () => undefined);
    expect(gp.input(0)?.act).toBe(false);
    // andere Tasten sind nicht gesperrt
    press(pad, B, true);
    gp.poll('game', emit, () => undefined);
    expect(gp.input(0)?.sprint).toBe(true);
    // loslassen, erneut drücken → wirkt
    press(pad, A, false);
    gp.poll('game', emit, () => undefined);
    expect(gp.input(0)?.act).toBe(false);
    press(pad, A, true);
    gp.poll('game', emit, () => undefined);
    expect(gp.input(0)?.act).toBe(true);
  });

  it('gehaltene Stickrichtung bleibt bis zur Mittelstellung gesperrt', () => {
    const [pad] = fakePads(1);
    const gp = new GamepadInput();
    pad.axes[0] = 1;
    gp.poll('menu', () => undefined, () => undefined);
    gp.latchHeld();
    gp.poll('game', () => undefined, () => undefined);
    expect(gp.input(0)?.right).toBe(false);
    pad.axes[0] = 0;
    gp.poll('game', () => undefined, () => undefined);
    pad.axes[0] = 1;
    gp.poll('game', () => undefined, () => undefined);
    expect(gp.input(0)?.right).toBe(true);
  });

  it('ohne Sperre wirkt gehaltenes A sofort (Kontrolle)', () => {
    const [pad] = fakePads(1);
    const gp = new GamepadInput();
    press(pad, A, true);
    gp.poll('game', () => undefined, () => undefined);
    expect(gp.input(0)?.act).toBe(true);
  });

  it('onActive meldet Slot und Anzahl der Pads', () => {
    const pads = fakePads(2);
    const gp = new GamepadInput();
    const seen: [number, number][] = [];
    press(pads[1], A, true);
    gp.poll('game', () => undefined, (slot, count) => seen.push([slot, count]));
    expect(seen).toEqual([[1, 2]]);
  });
});

describe('Koop-Zuordnung von Pads und Tastaturhälften', () => {
  it('ein einziges Pad im Koop gehört Spieler 2, zwei Pads je einem Spieler', () => {
    expect(padPlayer(0, 1, true)).toBe(1);
    expect(padPlayer(0, 2, true)).toBe(0);
    expect(padPlayer(1, 2, true)).toBe(1);
    expect(padPlayer(2, 3, true)).toBeNull();
    // Einzelspiel: jedes Pad steuert Spieler 1
    expect(padPlayer(0, 1, false)).toBe(0);
    expect(padPlayer(1, 2, false)).toBe(0);
  });

  it('Tastendruck wechselt nur das Gerät des Spielers, dem die Tastaturhälfte gehört', () => {
    expect(keyPlayer('KeyA', true)).toBe(0);
    expect(keyPlayer('ShiftLeft', true)).toBe(0);
    expect(keyPlayer('ArrowLeft', true)).toBe(1);
    expect(keyPlayer('ShiftRight', true)).toBe(1);
    expect(keyPlayer('ArrowDown', false)).toBe(0);
    expect(keySide('KeyS')).toBe('wasd');
    expect(keySide('ArrowDown')).toBe('arrows');
    expect(keySide('ShiftLeft')).toBeNull();
  });

  it('keine Strg-Taste als Spieltaste (macOS-Systemkürzel ⌃+Pfeil)', () => {
    const all = [BINDINGS.solo, BINDINGS.coop1, BINDINGS.coop2].flatMap((b) => [...b.left, ...b.right, ...b.sprint, ...b.act]);
    expect(all.filter((c) => c.startsWith('Control'))).toEqual([]);
    expect(BINDINGS.coop2.sprint).toEqual(['ShiftRight']);
  });
});

// ---------- Hinweistexte (UI-1, UI-2) ----------

describe('Tastenhinweis „… halten"', () => {
  it('Einzelspiel nennt die benutzte Tastaturhälfte, vor der ersten Taste beide', () => {
    expect(holdLabel('keyboard', 0, false)).toBe('S / ↓ halten');
    expect(holdLabel('keyboard', 0, false, 'wasd')).toBe('S halten');
    expect(holdLabel('keyboard', 0, false, 'arrows')).toBe('↓ halten');
  });

  it('Koop: feste Hälften je Spieler, Geräte-Hinweise unverändert', () => {
    expect(holdLabel('keyboard', 0, true, 'arrows')).toBe('S halten');
    expect(holdLabel('keyboard', 1, true, 'wasd')).toBe('↓ halten');
    expect(holdLabel('gamepad', 1, true)).toBe('A halten');
    expect(holdLabel('touch', 0, false)).toBe('Münze halten');
  });
});

describe('deutsche Einzahl', () => {
  const offer: Offer = { structureId: 5, action: 'buildWall', cost: 4, toLevel: 1, labelKey: 'offer.buildWall.1', blockedKey: null };

  it('„Dir fehlt 1 Münze" / „Dir fehlen 3 Münzen"', () => {
    const g = createGame({ seed: 1, coop: false });
    const p = g.players[0];
    p.coins = 3;
    expect(describeOffer(offer, p, 'S halten')?.detail).toBe('4 Münzen · Dir fehlt 1 Münze');
    p.coins = 1;
    expect(describeOffer(offer, p, 'S halten')?.detail).toBe('4 Münzen · Dir fehlen 3 Münzen');
  });

  function fakeToasts() {
    const pushed: string[] = [];
    const banners: string[] = [];
    const toasts = {
      push: (text: string) => pushed.push(text),
      banner: (title: string, sub = '') => banners.push(sub ? `${title} – ${sub}` : title),
      hidePhaseBanner: () => undefined,
    } as unknown as Toasts;
    return { toasts, pushed, banners };
  }

  it('Treffer-Hinweis: „Getroffen! −1 Münze", Koop mit Spielernummer', () => {
    const g = createGame({ seed: 1, coop: false });
    const f = fakeToasts();
    feedEvents(
      [
        { type: 'playerHit', x: 0, playerId: 0, coinsLost: 1 },
        { type: 'playerHit', x: 0, playerId: 0, coinsLost: 3 },
        { type: 'chestOpened', x: 0, structureId: 9, coins: 1 } as SimEvent,
      ],
      g,
      f.toasts,
    );
    expect(f.pushed).toEqual(['Getroffen! −1 Münze', 'Getroffen! −3 Münzen', 'Truhe geöffnet: +1 Münze']);
    const c = createGame({ seed: 1, coop: true });
    const fc = fakeToasts();
    feedEvents([{ type: 'playerHit', x: 0, playerId: 1, coinsLost: 1 }], c, fc.toasts);
    expect(fc.pushed).toEqual(['Spieler 2 getroffen! −1 Münze']);
  });
});

// ---------- Nachtbanner (sim-playtest:bug1) ----------

describe('Nachtbanner nennt die tatsächlichen Angriffsseiten', () => {
  it(`Nacht 1 nur aus dem Osten (westFrom = ${BALANCE.waves.westFrom}), Nacht 2 von beiden Seiten`, () => {
    const g = createGame({ seed: 4, coop: false });
    g.players[0].coins = 40; // Testaufbau: Treffer kosten Münzen statt der Krone
    const f = fakeToasts();
    for (let i = 0; i < 60 * 60 * 12 && g.day < 3; i++) {
      const events = stepGame(g, [NO_INPUT], SIM_DT);
      feedEvents(events, g, f.toasts);
      if (events.some((e) => e.type === 'phaseChange' && e.phase === 'night')) {
        expect(nightSubKey(g)).toBe(g.day < BALANCE.waves.westFrom ? 'toast.nightBeginsEast' : 'toast.nightBeginsSub');
      }
    }
    const nights = f.banners.filter((b) => b.startsWith('Nacht'));
    expect(nights[0]).toBe('Nacht 1 beginnt – Die Nebelbrut kommt aus dem Osten');
    expect(nights[1]).toBe('Nacht 2 beginnt – Die Nebelbrut kommt von beiden Seiten');
  });

  function fakeToasts() {
    const banners: string[] = [];
    const toasts = {
      push: () => undefined,
      banner: (title: string, sub = '') => banners.push(sub ? `${title} – ${sub}` : title),
      hidePhaseBanner: () => undefined,
    } as unknown as Toasts;
    return { toasts, banners };
  }
});
