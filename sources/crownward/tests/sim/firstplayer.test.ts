// Crownward – Regressionstests zu den Befunden des Erstspieler-Tests (FP-02, FP-05, FP-07, FP-08).
import { describe, expect, it } from 'vitest';
import { BALANCE, SIM_DT, constructionStatus, createGame } from '../../src/sim';
import type { GameState, SimEvent, Structure } from '../../src/sim';
import { planWave, waveSchedule } from '../../src/sim/waves';
import { rabbitZoneMin } from '../../src/sim/wildlife';
import { createCitizen } from '../../src/sim/world';
import { spawnCoin } from '../../src/sim/util';
import { IDLE, run, tapAct } from './helpers-economy';
import { emptyStage, ofType, runGame, setDayTime, setWall, structureAt } from './helpers-night';

const C = BALANCE.cycle;
const R = BALANCE.rabbits;
const W = BALANCE.waves;

/** Ein Reich ohne Felder: Mauern ±210, vier Schützen, ein Bauarbeiter, alle Truhen geöffnet. */
function wallsOnlyKingdom(seed: number): GameState {
  const s = createGame({ seed });
  s.coins = [];
  s.citizens = [];
  for (const q of s.structures) if (q.kind === 'chest') q.opened = true;
  structureAt(s, 'townCenter', 0).level = 1;
  // sehr hohe HP: gemessen wird die Jagd, nicht die Abwehr
  for (const x of [-210, 210]) setWall(s, x, 2, 9999).maxHp = 9999;
  for (let i = 0; i < 4; i++) createCitizen(s, 'archer', i % 2 ? -150 : 150).side = i % 2 ? -1 : 1;
  createCitizen(s, 'builder', -20);
  s.players[0].x = 0;
  s.players[0].coins = 1;
  return s;
}

describe('FP-02: Kaninchenwiese – Jagd bringt auch ohne Felder Münzen', () => {
  it('Kaninchen erscheinen vor dem Dorfrand, die meisten auf der Wiese; die Wiese weicht mit den Mauern nach außen', () => {
    const s = createGame({ seed: 61 });
    s.citizens = [];
    s.players[0].x = 0;
    const seen = new Set<number>();
    const spawns: number[] = [];
    const sample = (seconds: number) =>
      run(s, seconds, (st) => {
        for (const r of st.rabbits) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          spawns.push(r.x);
        }
        st.rabbits.length = 0; // Höchstmaß nie erreichen: nur Erscheinungsorte zählen
        return [IDLE];
      });

    sample(400);
    expect(spawns.length).toBeGreaterThan(12);
    for (const x of spawns) {
      const side = x < 0 ? -1 : 1;
      expect(Math.abs(x)).toBeGreaterThanOrEqual(rabbitZoneMin(s, side));
      expect(Math.abs(x)).toBeGreaterThanOrEqual(R.zoneMin);
      expect(Math.abs(x)).toBeLessThanOrEqual(R.zoneMax);
    }
    const onMeadow = spawns.filter((x) => Math.abs(x) <= rabbitZoneMin(s, x < 0 ? -1 : 1) + R.meadowSpan);
    expect(onMeadow.length / spawns.length).toBeGreaterThan(0.4);

    // äußere Mauern: die Wiese beginnt 50 px vor ihnen
    setWall(s, -390, 1);
    setWall(s, 390, 1);
    expect(rabbitZoneMin(s, 1)).toBe(390 + 7 + R.wallGap);
    spawns.length = 0;
    sample(300);
    expect(spawns.length).toBeGreaterThan(8);
    for (const x of spawns) expect(Math.abs(x)).toBeGreaterThanOrEqual(390 + 7 + R.wallGap);
  });

  it('vier Schützen hinter Mauern ±210 erjagen ohne Felder mehrere Münzen am Tag (vorher ≈ 0–1 in drei Tagen)', () => {
    const perSeed: number[] = [];
    for (const seed of [1, 2, 3]) {
      const s = wallsOnlyKingdom(seed);
      const kills: number[] = [];
      runGame(s, 2 * C.length, [], (ev) => {
        for (const e of ofType(ev, 'rabbitKilled')) kills.push(e.x);
      });
      perSeed.push(kills.length);
      // gejagt wird auf der Wiese vor der eigenen Mauer, nicht tief im Wald
      for (const x of kills) {
        expect(Math.abs(x)).toBeGreaterThan(210);
        expect(Math.abs(x)).toBeLessThanOrEqual(210 + BALANCE.archers.huntBeyond + BALANCE.archers.range + 20);
      }
      // die Beute liegt als Münze am Boden und wartet auf die Herrscherin (Landstreicher nehmen sie nicht)
      expect(s.coins.length).toBe(kills.length);
    }
    for (const n of perSeed) expect(n).toBeGreaterThanOrEqual(4);
    expect(perSeed.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(18);
  });

  it('abends verkriechen sich Kaninchen außer Sicht; Kaninchen in Sichtweite bleiben', () => {
    const s = emptyStage(createGame({ seed: 62 }));
    s.players[0].x = 250;
    setDayTime(s, C.dayEnd - 0.5);
    s.rabbits.push({ id: 9101, x: 1500, vx: 0, facing: 1, state: 'idle', timer: 5 });
    s.rabbits.push({ id: 9102, x: 520, vx: 0, facing: 1, state: 'idle', timer: 5 });
    runGame(s, 0.4);
    expect(s.phase).toBe('day');
    expect(s.rabbits.map((r) => r.id)).toEqual(expect.arrayContaining([9101, 9102]));
    runGame(s, 1);
    expect(s.phase).toBe('dusk');
    const ids = s.rabbits.map((r) => r.id);
    expect(ids).toContain(9102);
    expect(ids).not.toContain(9101);
    for (const r of s.rabbits) expect(Math.abs(r.x - s.players[0].x)).toBeLessThanOrEqual(R.burrowDistance);
  });
});

describe('FP-07: Landstreicher nehmen nur Münzen, die ihnen ein Herrscher hinwirft', () => {
  it('Truhe bei +2050: Bewohner des Lagers bei +2150 sammeln die Truhenmünzen nicht auf', () => {
    const s = createGame({ seed: 71 });
    s.coins = [];
    const camp = structureAt(s, 'camp', 2150);
    const chest = structureAt(s, 'chest', 2050);
    s.citizens = [];
    const a = createCitizen(s, 'vagrant', 2110, camp.id);
    const b = createCitizen(s, 'vagrant', 2125, camp.id);
    const p = s.players[0];
    p.x = chest.x;
    const ev: SimEvent[] = tapAct(s);
    expect(ofType(ev, 'chestOpened')).toHaveLength(1);
    // Herrscherin reitet sofort weiter, die Münzen bleiben liegen
    p.x = 1700;
    ev.push(...run(s, 20, [IDLE]));
    expect(ofType(ev, 'recruit')).toEqual([]);
    expect(a.role).toBe('vagrant');
    expect(b.role).toBe('vagrant');
    expect(s.coins).toHaveLength(chest.reward ?? 16);
    // Gegenprobe: eine hingeworfene Münze wirbt wie gewohnt an
    p.x = 2080;
    p.facing = 1;
    expect(ofType(tapAct(s), 'coinDrop')).toHaveLength(1);
    p.x = 1700;
    const later = run(s, 8, [IDLE]);
    expect(ofType(later, 'recruit')).toHaveLength(1);
  });

  it('Ernte-, Jagd- und verstreute Münzen direkt neben einem Landstreicher bleiben für die Herrscherin liegen', () => {
    const s = createGame({ seed: 72 });
    s.coins = [];
    s.players[0].x = -900;
    const v = s.citizens.find((c) => c.role === 'vagrant' && c.x > 0)!;
    run(s, 2, [IDLE]);
    spawnCoin(s, v.x + 25, { vx: 0, vy: 0, y: 0, pickupDelay: 0 });
    const ev = run(s, 6, [IDLE]);
    expect(ofType(ev, 'recruit')).toEqual([]);
    expect(v.role).toBe('vagrant');
    expect(s.coins).toHaveLength(1);
  });
});

/** Zeiten (Sekunden nach Nachtbeginn) der geplanten Spawns einer Seite. */
function plannedTimes(night: number, side: -1 | 1, seed = 4242): number[] {
  return planWave(createGame({ seed }), night)
    .pending.filter((p) => p.side === side)
    .map((p) => p.at);
}

describe('FP-08: Nacht 1 und 2 – Vorhut und Hauptschub füllen die Nacht', () => {
  it('waveSchedule: kleine Wellen als Vorhut + Hauptschub am Fensterende, größere als bisheriger Strom', () => {
    const end = W.spawnWindow;
    expect(waveSchedule(0)).toEqual([]);
    expect(waveSchedule(1)).toEqual([0]);
    expect(waveSchedule(2)).toEqual([0, end]);
    const four = waveSchedule(4);
    expect(four[0]).toBe(0);
    expect(four.slice(1)).toEqual([end - 2 * W.groupGap, end - W.groupGap, end].map((x) => expect.closeTo(x, 9)));
    // ab groupMaxWave + 1 Gegnern: gleichmäßiger Strom wie vor der Änderung (Abstand ≤ spawnInterval)
    const six = waveSchedule(6);
    const step = Math.min(W.spawnInterval, W.spawnWindow / 5);
    six.forEach((t, i) => expect(t).toBeCloseTo(i * step, 9));
    const big = waveSchedule(17);
    expect(big[16]).toBeCloseTo(W.spawnWindow, 9);
  });

  it('planWave: in Nacht 1 und 2 erscheint der letzte Gegner jeder Seite erst gegen Ende des Fensters', () => {
    const late = W.spawnStart + W.spawnWindow - 1;
    const n1 = plannedTimes(1, 1);
    expect(n1).toHaveLength(2);
    expect(n1[0]).toBeLessThan(W.spawnStart + 1);
    expect(n1[1]).toBeGreaterThan(late);
    for (const side of [1, -1] as const) {
      const n2 = plannedTimes(2, side);
      expect(n2).toHaveLength(4);
      expect(n2[0]).toBeLessThan(W.spawnStart + W.spawnInterval);
      // Hauptschub: drei Gegner dicht beieinander am Fensterende
      expect(n2[1]).toBeGreaterThan(late - 1);
      expect(n2[3] - n2[1]).toBeLessThan(1.2);
      expect(n2[3]).toBeLessThan(BALANCE.cycle.nightEnd - BALANCE.cycle.duskEnd - 20);
    }
  });

  /** Nacht n mit Pfahlwerk/Palisade ±210 und `perSide` Schützen je Seite; liefert Messwerte der Nacht. */
  function playNight(night: number, perSide: number, wallLevel: number, seed: number) {
    const s = emptyStage(createGame({ seed }));
    s.day = night;
    setDayTime(s, C.duskEnd - 0.5);
    const walls = [-210, 210].map((x) => setWall(s, x, wallLevel));
    for (const side of [-1, 1] as const) for (let i = 0; i < perSide; i++) createCitizen(s, 'archer', side * (150 + i * 9)).side = side;
    s.players[0].x = 0;
    s.players[0].coins = 5;
    const start = s.time + 0.5;
    let aliveLate = 0;
    const ev = runGame(s, C.length - C.duskEnd + 1, [], () => {
      if (s.phase === 'night' && s.time - start >= 30) aliveLate = Math.max(aliveLate, s.enemies.length);
    });
    return { s, walls, ev, aliveLate };
  }

  it('Nacht 1: die Brut ist auch in der zweiten Nachthälfte noch unterwegs (vorher nach ≈ 21 s vorbei)', () => {
    for (const seed of [1, 2]) {
      const { aliveLate, ev } = playNight(1, 1, 1, seed);
      expect(aliveLate).toBeGreaterThan(0);
      expect(ofType(ev, 'enemyDied')).toHaveLength(2);
    }
  });

  it('Nacht 2: der Hauptschub erreicht ein nur von einem Schützen je Seite gehaltenes Pfahlwerk – es hält', () => {
    for (const seed of [1, 2, 3]) {
      const { ev, walls, s } = playNight(2, 1, 1, seed);
      const hit = new Set(ofType(ev, 'wallHit').map((e) => e.structureId));
      expect(hit.size).toBeGreaterThan(0);
      expect(ofType(ev, 'wallDestroyed')).toEqual([]);
      expect(walls.every((w: Structure) => w.hp > 0)).toBe(true);
      expect(ofType(ev, 'citizenHit')).toEqual([]);
      expect(ofType(ev, 'enemyDied')).toHaveLength(8);
      expect(s.enemies).toHaveLength(0);
    }
  });

  it('Nacht 2 mit zwei Schützen je Seite hinter Palisaden: keine Mauer wird getroffen', () => {
    for (const seed of [1, 2]) {
      const { ev } = playNight(2, 2, 2, seed);
      expect(ofType(ev, 'wallHit')).toEqual([]);
      expect(ofType(ev, 'enemyDied')).toHaveLength(8);
    }
  });
});

describe('FP-05: constructionStatus erklärt stillstehende Bauten', () => {
  function stage(seed = 51): GameState {
    const s = emptyStage(createGame({ seed }));
    s.players[0].x = 0;
    return s;
  }
  const step = (s: GameState, seconds = SIM_DT) => runGame(s, seconds);

  it('ohne Bauauftrag null, ohne Bauleute „noBuilders", mit Bauarbeiter „working" – und die Abfrage ändert nichts', () => {
    const s = stage();
    setDayTime(s, 40);
    const wall = structureAt(s, 'wall', 210);
    expect(constructionStatus(s, wall)).toBeNull();
    wall.construction = { toLevel: 1, progress: 0, required: BALANCE.wall.work[1] };
    const before = JSON.stringify(s);
    expect(constructionStatus(s, wall)).toBe('noBuilders');
    expect(JSON.stringify(s)).toBe(before);
    createCitizen(s, 'builder', -20);
    step(s);
    expect(constructionStatus(s, wall)).toBe('working');
  });

  it('Ausbau der Frontmauer kurz vor dem Abend: abends und nachts „waitingForDay", im Morgengrauen geht es weiter', () => {
    const s = stage();
    const wall = setWall(s, 210, 1);
    createCitizen(s, 'builder', 150);
    setDayTime(s, C.dayEnd - 3);
    wall.construction = { toLevel: 2, progress: 0, required: BALANCE.wall.work[2] };
    step(s, 1);
    expect(constructionStatus(s, wall)).toBe('working');
    step(s, 3);
    expect(s.phase).toBe('dusk');
    expect(constructionStatus(s, wall)).toBe('waitingForDay');
    const frozen = wall.construction!.progress;
    // Abend und Nacht: kein Fortschritt, Status bleibt erklärend
    s.wave = { night: s.day, elapsed: 0, pending: [], paleMoon: false };
    const phase = (): string => s.phase;
    while (phase() !== 'dawn') {
      step(s, 0.5);
      if (phase() === 'night') s.wave.pending = [];
      if (phase() !== 'dawn') expect(constructionStatus(s, wall)).toBe('waitingForDay');
    }
    expect(wall.construction!.progress).toBe(frozen);
    step(s, 0.5);
    expect(constructionStatus(s, wall)).toBe('working');
  });

  it('Schiffsreparatur spät am Tag: „waitingForDay", niemand bricht auf; am nächsten Morgen „working"', () => {
    const s = stage();
    const ship = structureAt(s, 'ship', -2960);
    const b = createCitizen(s, 'builder', -20);
    setDayTime(s, 66); // wie im Erstspieler-Test: Bezahlt an Tag 2 bei t = 268
    ship.construction = { toLevel: 1, progress: 0, required: BALANCE.ship.work[1] };
    step(s, 1);
    expect(constructionStatus(s, ship)).toBe('waitingForDay');
    expect(b.task.type).not.toBe('build');
    setDayTime(s, 2); // nächster Morgen
    step(s, 0.1);
    expect(constructionStatus(s, ship)).toBe('working');
    expect(b.task).toMatchObject({ type: 'build', structureId: ship.id });
  });

  it('ein Bauarbeiter, zwei Aufträge: der nähere „working", der andere „queued"', () => {
    const s = stage();
    setDayTime(s, 30);
    createCitizen(s, 'builder', 100);
    const east = structureAt(s, 'wall', 210);
    const west = structureAt(s, 'wall', -210);
    east.construction = { toLevel: 1, progress: 0, required: BALANCE.wall.work[1] };
    west.construction = { toLevel: 1, progress: 0, required: BALANCE.wall.work[1] };
    step(s, 0.2);
    expect(constructionStatus(s, east)).toBe('working');
    expect(constructionStatus(s, west)).toBe('queued');
  });
});
