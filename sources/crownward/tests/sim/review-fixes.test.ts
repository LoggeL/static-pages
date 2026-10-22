// Crownward – Regressionstests zu den Review-Befunden der Simulation (review-sim:sim-1 … sim-6).
import { describe, expect, it } from 'vitest';
import { BALANCE, SIM_DT, createGame, deserializeGame, serializeGame, stepGame } from '../../src/sim';
import type { GameState, PlayerInput, SimEvent } from '../../src/sim';
import { updateDayCycle } from '../../src/sim/daycycle';
import { spawnEnemy } from '../../src/sim/enemies';
import { MAX_DAY, validateState } from '../../src/sim/save';
import { spawnCoin } from '../../src/sim/util';
import { addCitizen, emptyStage, newGame, ofType, parkPlayers, quietNight, runGame, setDayTime, setWall, structureAt } from './helpers-night';

const IDLE: PlayerInput = Object.freeze({ left: false, right: false, sprint: false, act: false });
const ACT: PlayerInput = Object.freeze({ ...IDLE, act: true });
const P = BALANCE.player;
const C = BALANCE.cycle;

/** Heller Tag ohne Bürger, Bodenmünzen und Kaninchen. */
function dayStage(seed = 11): GameState {
  const s = emptyStage(newGame({ seed }));
  setDayTime(s, 40);
  return s;
}

function steps(s: GameState, n: number, input: PlayerInput, all: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < n; i++) all.push(...stepGame(s, [input]));
  return all;
}

/** alle Münzen im Spiel: Beutel + Kostenslots + Boden */
function coinTotal(s: GameState): number {
  const p = s.players[0];
  return p.coins + (p.payTargetId !== null ? p.payProgress : 0) + s.coins.length;
}

describe('sim-2: Mauer fällt während der Ausbauzahlung', () => {
  it('bricht ab und erstattet vollständig, statt den billigeren Wiederaufbau zu kaufen', () => {
    // Vorher: Mit 3 bezahlten Münzen für Palisade (4) fiel die Mauer, die Zahlung lief als Wiederaufbau (2)
    // weiter und schloss sofort ab – 1 Münze verschwand, gekauft wurde etwas anderes.
    const s = dayStage();
    structureAt(s, 'townCenter', 0).level = 1;
    const wall = setWall(s, 210, 1, BALANCE.enemies.breaker.wallDamage); // ein Brecherschlag genügt
    const p = s.players[0];
    p.x = 210;
    p.coins = 10;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 120 && p.payProgress < 3; i++) steps(s, 1, ACT, ev);
    expect(p.payProgress).toBe(3);
    expect(p.payOffer).toEqual({ action: 'upgradeWall', toLevel: 2, cost: BALANCE.wall.cost[2] });

    // echter Brecher vor der Mauer, holt gerade zum Schlag aus
    const b = spawnEnemy(s, 'breaker', 1, 222);
    b.state = 'attackWall';
    b.targetKind = 'structure';
    b.targetId = wall.id;
    b.attackTimer = SIM_DT / 2;
    for (let i = 0; i < 5 && ofType(ev, 'wallDestroyed').length === 0; i++) steps(s, 1, ACT, ev);
    expect(ofType(ev, 'wallDestroyed')).toHaveLength(1);
    s.enemies.length = 0; // der Brecher soll den Beutel nicht zusätzlich plündern

    steps(s, 1, ACT, ev);
    expect(ofType(ev, 'purchase')).toHaveLength(0);
    expect(ofType(ev, 'payCancelled')).toEqual([expect.objectContaining({ structureId: wall.id, refunded: 3 })]);
    expect(p.coins).toBe(10);
    expect(p.payTargetId).toBeNull();
    expect(s.stats.coinsSpent).toBe(0);
    expect(wall.construction).toBeNull();

    // weiter gehalten: kein stiller Neustart; erst ein neuer Druck kauft den Wiederaufbau
    const held = steps(s, 60, ACT);
    expect(ofType(held, 'coinPaid')).toHaveLength(0);
    steps(s, 1, IDLE);
    const again = steps(s, 90, ACT);
    expect(ofType(again, 'purchase')).toEqual([expect.objectContaining({ action: 'buildWall', cost: BALANCE.wall.cost[1] })]);
    expect(p.coins).toBe(10 - BALANCE.wall.cost[1]);
    expect(s.stats.coinsSpent).toBe(BALANCE.wall.cost[1]);
  });

  it('ältere Stände ohne payOffer setzen eine laufende Zahlung fort', () => {
    const s = dayStage();
    const p = s.players[0];
    p.x = 0;
    p.coins = 10;
    steps(s, 30, ACT);
    expect(p.payProgress).toBeGreaterThan(0);
    delete p.payOffer;
    const loaded = deserializeGame(serializeGame(s, '2026-10-22T22:00:00.000Z'));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const ev = steps(loaded.state, 90, ACT);
    expect(ofType(ev, 'purchase')).toEqual([expect.objectContaining({ action: 'upgradeTown', cost: BALANCE.townCenter.cost[1] })]);
    expect(loaded.state.players[0].coins).toBe(10 - BALANCE.townCenter.cost[1]);
  });
});

describe('sim-3: Erstattung überschreitet nie purseMax', () => {
  it('während einer Zahlung belegen die Münzen in den Slots Platz im Beutel', () => {
    // Vorher: 20 Münzen, 4 eingezahlt, Beutel per Aufheben auf 40 gefüllt, losgelassen → 44 Münzen.
    const s = dayStage();
    const p = s.players[0];
    p.x = 0;
    p.coins = 20;
    const ev = steps(s, 70, ACT);
    expect(p.payProgress).toBe(4);
    for (let i = 0; i < 30; i++) spawnCoin(s, 0, { vx: 0, vy: 0, y: 0, pickupDelay: 0 });
    const total = coinTotal(s);
    steps(s, 1, ACT, ev); // ein Schritt: die fünfte Münze (Kauf) fiele erst etwas später
    expect(p.payProgress).toBe(4);
    expect(p.coins + p.payProgress).toBe(P.purseMax);
    expect(ofType(ev, 'purseFull').length).toBeGreaterThan(0);
    steps(s, 1, IDLE, ev);
    expect(ofType(ev, 'payCancelled')).toEqual([expect.objectContaining({ refunded: 4 })]);
    expect(p.coins).toBe(P.purseMax);
    expect(coinTotal(s)).toBe(total); // nichts verschwindet, nichts entsteht
  });

  it('nach einem Kauf wird der frei gewordene Platz wieder befüllt', () => {
    const s = dayStage();
    const p = s.players[0];
    p.x = 0;
    p.coins = 38;
    for (let i = 0; i < 10; i++) spawnCoin(s, 0, { vx: 0, vy: 0, y: 0, pickupDelay: 0 });
    let maxHeld = 0;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      steps(s, 1, ACT, ev);
      maxHeld = Math.max(maxHeld, p.coins + (p.payTargetId !== null ? p.payProgress : 0));
    }
    expect(ofType(ev, 'purchase')).toHaveLength(1);
    expect(maxHeld).toBeLessThanOrEqual(P.purseMax);
    expect(p.coins).toBe(P.purseMax);
  });

  it('inkonsistent geladener Stand: Überschuss springt zu Boden statt verloren zu gehen', () => {
    const s = dayStage();
    const p = s.players[0];
    p.x = 0;
    steps(s, 30, ACT);
    expect(p.payProgress).toBeGreaterThan(0);
    const paid = p.payProgress;
    p.coins = P.purseMax; // z. B. von Hand bearbeiteter Spielstand
    const ground = s.coins.length;
    const ev = steps(s, 1, IDLE);
    expect(ofType(ev, 'payCancelled')).toEqual([expect.objectContaining({ refunded: paid })]);
    expect(p.coins).toBe(P.purseMax);
    expect(s.coins.length).toBe(ground + paid);
  });
});

describe('sim-4: beschädigte Tageszeit hängt das Spiel nicht auf', () => {
  it('Validierung verlangt 0 ≤ dayTime < Zykluslänge und 1 ≤ day ≤ MAX_DAY', () => {
    const base = createGame({ seed: 3 });
    const check = (patch: Partial<GameState>) => validateState(JSON.parse(JSON.stringify({ ...base, ...patch })));
    expect(check({})).toBeNull();
    expect(check({ dayTime: 0 })).toBeNull();
    expect(check({ dayTime: C.length - 0.001 })).toBeNull();
    expect(check({ day: MAX_DAY })).toBeNull();
    for (const dayTime of [C.length, 1e11, -1]) expect(check({ dayTime })).toMatch(/dayTime/);
    expect(check({ day: MAX_DAY + 1 })).toMatch(/state\.day/);
    const r = deserializeGame(serializeGame({ ...base, dayTime: 1e11 }, 'x'));
    expect(r.ok).toBe(false);
  });

  it('updateDayCycle normalisiert übergroße Werte in einem Zug', () => {
    const s = emptyStage(newGame());
    s.dayTime = 3 * C.length + 5;
    const day = s.day;
    updateDayCycle(s, SIM_DT, () => {});
    expect(s.day).toBe(day + 3);
    expect(s.dayTime).toBeCloseTo(5 + SIM_DT, 9);

    const huge = emptyStage(newGame());
    huge.dayTime = 1e13; // mit der alten Schleife rund 30 s
    const t0 = performance.now();
    updateDayCycle(huge, SIM_DT, () => {});
    expect(performance.now() - t0).toBeLessThan(50);
    expect(huge.dayTime).toBeGreaterThanOrEqual(0);
    expect(huge.dayTime).toBeLessThan(C.length);
  });
});

describe('sim-5: stepGame ist auch mit großem dt zeittreu', () => {
  it('stepGame(dt = 1) liefert dieselbe Welt und dieselben Ereignisse wie 60 Schritte à 1/60 s', () => {
    const a = createGame({ seed: 21 });
    const b = createGame({ seed: 21 });
    const input = [{ ...IDLE, right: true, act: true }];
    const evA: SimEvent[] = [];
    const evB: SimEvent[] = [];
    for (let i = 0; i < 20 * 60; i++) evA.push(...stepGame(a, input, SIM_DT));
    for (let i = 0; i < 20; i++) evB.push(...stepGame(b, input, 1));
    expect(evB).toEqual(evA);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('Münzen kommen bei dt = 0,25 und 0,5 zur Ruhe', () => {
    // Vorher: vy pendelte bei 33,7 bzw. 67,4 – Landstreicher bemerkten die Münze nie.
    for (const dt of [0.25, 0.5]) {
      const s = dayStage();
      parkPlayers(s, -1800);
      const c = spawnCoin(s, 500, { vx: 0, vy: 50, y: 16 });
      for (let t = 0; t < 3; t += dt) stepGame(s, [], dt);
      expect(c.y).toBe(0);
      expect(c.vy).toBe(0);
    }
  });

  it('Angriffstakte: drei Mistlinge richten bei dt = 1 denselben Mauerschaden an wie bei 1/60', () => {
    const damage = (dt: number) => {
      const s = emptyStage(newGame({ seed: 77 }));
      setWall(s, -210, 3);
      parkPlayers(s, 0);
      quietNight(s, C.duskEnd + 2);
      const w = setWall(s, 210, 3);
      for (let i = 0; i < 3; i++) spawnEnemy(s, 'mistling', 1, 225 + i);
      const n = Math.round(10 / dt);
      for (let i = 0; i < n; i++) stepGame(s, [], dt);
      return w.maxHp - w.hp;
    };
    const fine = damage(SIM_DT);
    expect(fine).toBeGreaterThan(40); // gemessen 54
    expect(damage(1)).toBe(fine); // vorher 27–29
  });

  it('lehnt ungültige Zeitschritte ab, statt endlos zu rechnen', () => {
    const s = createGame({ seed: 1 });
    for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(() => stepGame(s, [], dt)).toThrow(RangeError);
    expect(() => stepGame(s, [], 0)).not.toThrow();
  });
});

describe('sim-6: purseFull-Drosselung gehört zum Zustand', () => {
  it('nach Speichern/Laden kommt dieselbe Ereignisfolge wie im ununterbrochenen Lauf', () => {
    // Vorher: Die Drosselung lag in einer modulweiten WeakMap; nach dem Laden kam purseFull sofort erneut.
    const s = dayStage();
    const p = s.players[0];
    p.x = 900;
    p.coins = P.purseMax;
    for (let i = 0; i < 4; i++) spawnCoin(s, 900, { vx: 0, vy: 0, y: 0, pickupDelay: 0 });
    expect(ofType(stepGame(s, []), 'purseFull')).toHaveLength(1);
    runGame(s, 0.5);
    const loaded = deserializeGame(serializeGame(s, '2026-10-22T22:00:00.000Z'));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const evA = runGame(s, 3);
    const evB = runGame(loaded.state, 3);
    expect(evB).toEqual(evA);
    expect(ofType(evA, 'purseFull')).toHaveLength(1); // gedrosselt: erst 2 s nach der ersten Meldung
  });
});

describe('sim-1 (Absicherung): auch Brecher erwischen laufende Bürger', () => {
  for (const role of ['villager', 'farmer', 'archer'] as const) {
    it(`Brecher gegen ${role} auf dem nächtlichen Heimweg`, () => {
      const s = emptyStage(newGame({ seed: 77 }));
      setWall(s, -210, 3);
      setWall(s, 210, 3);
      parkPlayers(s, 0);
      quietNight(s, 158);
      const c = addCitizen(s, role, -1500);
      spawnEnemy(s, 'breaker', -1, -1700);
      const ev = runGame(s, 12);
      expect(ofType(ev, 'citizenHit')).toEqual([expect.objectContaining({ citizenId: c.id, role })]);
    });
  }
});
