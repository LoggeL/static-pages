// Crownward – Speichern/Laden: Rundreise, Determinismus nach dem Laden, Format-/Versions-/Strukturfehler, Migration.
import { describe, expect, it } from 'vitest';
import { createGame, deserializeGame, SAVE_FORMAT, SAVE_VERSION, serializeGame, stepGame } from '../../src/sim';
import type { GameState, PlayerInput } from '../../src/sim';
import { migrateSave, MIGRATIONS, validateState } from '../../src/sim/save';
import { IDLE, inp, keepDay, run, snapshot } from './helpers-economy';

const SAVED_AT = '2026-10-22T21:00:00.000Z';

/** Skriptierte Eingaben: reiten, Münzen fallen lassen, in Bauwerke einzahlen (deterministisch je Schritt). */
function scripted(step: number): PlayerInput[] {
  const t = step % 900;
  if (t < 120) return [inp({ right: true })];
  if (t < 150) return [inp({ act: true })];
  if (t < 260) return [inp({ left: true, sprint: true })];
  if (t < 330) return [inp({ act: true })];
  if (t < 340) return [IDLE];
  if (t < 345) return [inp({ act: true })];
  if (t < 600) return [inp({ left: true })];
  if (t < 700) return [inp({ right: true, sprint: true })];
  return [IDLE];
}

function advance(s: GameState, from: number, steps: number): void {
  for (let i = from; i < from + steps; i++) {
    keepDay(s);
    stepGame(s, scripted(i));
  }
}

function roundTrip(s: GameState): GameState {
  const r = deserializeGame(serializeGame(s, SAVED_AT));
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function mutated(fn: (data: Record<string, any>) => void, base?: GameState): string {
  const data = JSON.parse(serializeGame(base ?? createGame({ seed: 5 }), SAVED_AT));
  fn(data);
  return JSON.stringify(data);
}

describe('Speichern und Laden', () => {
  it('Rundreise erhält den vollständigen Zustand und savedAt', () => {
    const s = createGame({ seed: 61, coop: true });
    run(s, 20, [inp({ right: true }), inp({ left: true, act: true })]);
    const text = serializeGame(s, SAVED_AT);
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: SAVED_AT });
    const r = deserializeGame(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.savedAt).toBe(SAVED_AT);
    expect(r.migratedFrom).toBeNull();
    expect(snapshot(r.state)).toBe(snapshot(s));
    expect(r.state).not.toBe(s);
  });

  it('Determinismus: Laden + N Schritte == ohne Speichern', () => {
    const a = createGame({ seed: 62 });
    advance(a, 0, 1500); // Rekrutierung, Käufe, Lager, Kaninchen …
    expect(a.stats.coinsSpent + a.stats.coinsCollected).toBeGreaterThan(0);
    const b = roundTrip(a);
    advance(a, 1500, 2400);
    advance(b, 1500, 2400);
    expect(snapshot(b)).toBe(snapshot(a));
    expect(b.rng).toBe(a.rng);
    expect(b.nextId).toBe(a.nextId);
  });

  it('auch mitten in einer Zahlung und mit laufenden Bauaufträgen', () => {
    const a = createGame({ seed: 63 });
    a.players[0].x = 0;
    a.citizens[0].role = 'builder';
    for (let i = 0; i < 30; i++) stepGame(a, [inp({ act: true })]);
    expect(a.players[0].payTargetId).not.toBeNull();
    const b = roundTrip(a);
    for (let i = 0; i < 1200; i++) {
      keepDay(a);
      keepDay(b);
      stepGame(a, [inp({ act: i < 120 })]);
      stepGame(b, [inp({ act: i < 120 })]);
    }
    expect(a.structures.find((s) => s.kind === 'townCenter')!.level).toBe(1);
    expect(snapshot(b)).toBe(snapshot(a));
  });

  it('lehnt kaputtes JSON, leere Eingaben und fremde Formate ab', () => {
    for (const text of ['{nicht json', '', '   ', '42', 'null', '[]']) {
      const r = deserializeGame(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
    const r1 = deserializeGame('{nicht json');
    expect(!r1.ok && r1.error).toMatch(/beschädigt/);
    const r2 = deserializeGame(mutated((d) => (d.format = 'andere-app')));
    expect(!r2.ok && r2.error).toMatch(/Dateiformat/);
  });

  it('lehnt neuere und ungültige Versionen ab', () => {
    const newer = deserializeGame(mutated((d) => (d.version = SAVE_VERSION + 1)));
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.error).toMatch(/neueren Spielversion/);
    for (const v of [0, -1, 1.5, '1', null]) {
      const r = deserializeGame(mutated((d) => (d.version = v)));
      expect(r.ok).toBe(false);
    }
  });

  it('prüft die Struktur des Zustands', () => {
    const cases: [string, (d: Record<string, any>) => void][] = [
      ['state fehlt', (d) => delete d.state],
      ['players fehlt', (d) => delete d.state.players],
      ['Münzzahl ist Text', (d) => (d.state.players[0].coins = 'viele')],
      ['NaN-Position (als null)', (d) => (d.state.players[0].x = null)],
      ['unbekannte Rolle', (d) => (d.state.citizens[0].role = 'zauberer')],
      ['kaputte Aufgabe', (d) => (d.state.citizens[0].task = { type: 'build' })],
      ['unbekanntes Bauwerk', (d) => (d.state.structures[3].kind = 'burg')],
      ['Bauauftrag ohne Werte', (d) => (d.state.structures[0].construction = { toLevel: 1 })],
      ['Münzen keine Liste', (d) => (d.state.coins = {})],
      ['Phase unbekannt', (d) => (d.state.phase = 'mittag')],
      ['Welle fehlt', (d) => delete d.state.wave],
      ['Statistik fehlt', (d) => delete d.state.stats.coinsSpent],
      ['Koop ohne zweite Figur', (d) => (d.state.coop = true)],
      ['kein Siedlungszentrum', (d) => (d.state.structures = d.state.structures.filter((s: any) => s.kind !== 'townCenter'))],
      ['doppelte Kennung', (d) => (d.state.coins[1].id = d.state.coins[0].id)],
      ['falsche Zustandsversion', (d) => (d.state.schema = 7)],
    ];
    for (const [name, fn] of cases) {
      const r = deserializeGame(mutated(fn));
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error, name).toMatch(/Spielstand/);
    }
    // gültiger Stand besteht die Prüfung
    expect(validateState(createGame({ seed: 1 }))).toBeNull();
    expect(validateState(createGame({ seed: 1, coop: true }))).toBeNull();
  });

  it('nennt das fehlerhafte Feld in der Meldung', () => {
    const r = deserializeGame(mutated((d) => (d.state.players[0].coins = 'viele')));
    expect(!r.ok && r.error).toContain('players[0].coins');
  });

  it('nextId wird repariert, falls er hinter vorhandenen Kennungen liegt', () => {
    const r = deserializeGame(mutated((d) => (d.state.nextId = 1)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = [...r.state.structures, ...r.state.coins, ...r.state.citizens].map((e) => e.id);
    expect(r.state.nextId).toBeGreaterThan(Math.max(...ids));
  });
});

describe('Migrationstabelle', () => {
  it('Version 1 braucht keine Migration', () => {
    expect(Object.keys(MIGRATIONS)).toHaveLength(0);
    const m = migrateSave({ a: 1 }, SAVE_VERSION);
    expect(m).toEqual({ ok: true, data: { a: 1 } });
  });

  it('wendet Migrationen der Reihe nach an und meldet Lücken', () => {
    const table = {
      1: (d: Record<string, unknown>) => ({ ...d, version: 2, trail: [...((d.trail as string[]) ?? []), '1→2'] }),
      2: (d: Record<string, unknown>) => ({ ...d, version: 3, trail: [...(d.trail as string[]), '2→3'] }),
    };
    const ok = migrateSave({ version: 1 }, 1, table, 3);
    expect(ok).toEqual({ ok: true, data: { version: 3, trail: ['1→2', '2→3'] } });
    const gap = migrateSave({ version: 1 }, 1, { 1: table[1] }, 3);
    expect(gap.ok).toBe(false);
    expect(!gap.ok && gap.error).toMatch(/Version 2/);
    const broken = migrateSave({}, 1, {
      1: () => {
        throw new Error('x');
      },
    }, 2);
    expect(broken.ok).toBe(false);
  });
});
