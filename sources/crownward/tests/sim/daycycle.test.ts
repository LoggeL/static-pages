// Tageszyklus: Phasenfolge, Nachtwarnung, Tageswechsel, Auflösen im Morgengrauen.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim';
import type { SimEvent } from '../../src/sim';
import { updateDayCycle, warningTime } from '../../src/sim/daycycle';
import { spawnEnemy } from '../../src/sim/enemies';
import { isPaleMoon } from '../../src/sim/waves';
import { emptyStage, newGame, ofType, parkPlayers, runGame, setDayTime, tickNight } from './helpers-night';

const C = BALANCE.cycle;

describe('Tageszyklus', () => {
  it('durchläuft Tag → Abend → Nacht → Morgen → Tag mit genau einer Nachtwarnung', () => {
    const s = newGame();
    expect(s.phase).toBe('day');
    expect(s.dayTime).toBe(C.startTime);
    const ev = tickNight(s, C.length);

    const phases = ofType(ev, 'phaseChange').map((e) => `${e.phase}@${e.day}`);
    expect(phases).toEqual(['dusk@1', 'night@1', 'dawn@1', 'day@2']);

    const warnings = ofType(ev, 'nightWarning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ day: 1, paleMoon: false });

    // Reihenfolge: Abend → Warnung → Nacht
    const order = ev.filter((e) => e.type === 'phaseChange' || e.type === 'nightWarning').map((e) => e.type === 'phaseChange' ? e.phase : 'warn');
    expect(order).toEqual(['dusk', 'warn', 'night', 'dawn', 'day']);

    expect(s.day).toBe(2);
    expect(s.phase).toBe('day');
    expect(s.dayTime).toBeCloseTo(C.startTime, 3);
  });

  it('meldet die Nachtwarnung warningLead Sekunden vor Nachtbeginn', () => {
    const s = newGame();
    setDayTime(s, 130);
    let warnedAt = -1;
    tickNight(s, 15, undefined, (ev) => {
      if (ev.some((e) => e.type === 'nightWarning')) warnedAt = s.dayTime;
    });
    expect(warningTime()).toBe(C.duskEnd - C.warningLead);
    expect(warnedAt).toBeGreaterThanOrEqual(C.duskEnd - C.warningLead);
    expect(warnedAt).toBeLessThan(C.duskEnd - C.warningLead + 0.05);
  });

  it('stepGame mit allen Systemen liefert dieselbe Phasenfolge über zwei Tage', () => {
    const s = newGame();
    const ev = runGame(s, 2 * C.length);
    expect(ofType(ev, 'phaseChange').map((e) => `${e.phase}@${e.day}`)).toEqual([
      'dusk@1',
      'night@1',
      'dawn@1',
      'day@2',
      'dusk@2',
      'night@2',
      'dawn@2',
      'day@3',
    ]);
    expect(ofType(ev, 'nightWarning').map((e) => e.day)).toEqual([1, 2]);
    expect(s.day).toBe(3);
  });

  it('große Zeitschritte überspringen weder Phasen noch die Warnung', () => {
    const s = newGame();
    const ev: SimEvent[] = [];
    for (let i = 0; i < 5; i++) updateDayCycle(s, 50, (e) => ev.push(e)); // 250 s in fünf Schritten
    expect(ofType(ev, 'phaseChange').map((e) => e.phase)).toEqual(['dusk', 'night', 'dawn', 'day']);
    expect(ofType(ev, 'nightWarning')).toHaveLength(1);
    expect(s.day).toBe(2);
    expect(s.dayTime).toBeCloseTo(C.startTime + 250 - C.length, 6);
  });

  it('gleicht die Phase an, wenn dayTime direkt gesetzt wurde (z. B. nach Debug-Sprung)', () => {
    const s = newGame();
    s.dayTime = 160; // Phase steht noch auf 'day'
    const ev: SimEvent[] = [];
    updateDayCycle(s, 1 / 60, (e) => ev.push(e));
    expect(s.phase).toBe('night');
    expect(ofType(ev, 'phaseChange')).toEqual([{ type: 'phaseChange', phase: 'night', day: 1 }]);
  });

  it('kennzeichnet Fahlmond-Nächte in der Warnung', () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10, 15].map(isPaleMoon)).toEqual([false, false, false, false, true, false, false, true, true]);
    const s = newGame();
    s.day = 5;
    setDayTime(s, 135);
    const ev = tickNight(s, 5);
    expect(ofType(ev, 'nightWarning')).toEqual([{ type: 'nightWarning', day: 5, paleMoon: true }]);
  });

  it('löst im Morgengrauen alle Gegner auf; getragene Münzen fallen zu Boden', () => {
    const s = emptyStage(newGame());
    parkPlayers(s, 0);
    setDayTime(s, C.nightEnd - 0.5);
    const a = spawnEnemy(s, 'mistling', 1, 1500);
    const b = spawnEnemy(s, 'breaker', -1, -1400);
    a.carrying = 'coin';
    a.state = 'flee';
    s.wave = { night: s.day, elapsed: 40, pending: [{ side: 1, kind: 'mistling', at: 99 }], paleMoon: false };

    const ev = tickNight(s, 1);
    const dissolved = ofType(ev, 'enemiesDissolved');
    expect(dissolved).toHaveLength(1);
    expect(dissolved[0].count).toBe(2);
    expect(dissolved[0].xs).toHaveLength(2);
    expect(dissolved[0].xs).toContain(b.x);
    expect(s.enemies).toHaveLength(0);
    expect(s.wave.pending).toHaveLength(0);
    expect(s.coins).toHaveLength(1);
    expect(Math.abs(s.coins[0].x - dissolved[0].xs[0])).toBeLessThan(5);
    expect(s.phase).toBe('dawn');
  });
});
