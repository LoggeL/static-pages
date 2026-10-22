// Crownward – Regressionstests für Simulationsfehler, die der Durchspiel-Bot (tests/sim/bot.ts) aufgedeckt hat.
import { describe, expect, it } from 'vitest';
import { BALANCE, getOffer } from '../../src/sim';
import type { GameState } from '../../src/sim';
import { beyondRift } from '../../src/sim/citizens';
import { spawnEnemy } from '../../src/sim/enemies';
import { addCitizen, emptyStage, newGame, ofType, parkPlayers, quietNight, runGame, setDayTime, setWall, structureAt } from './helpers-night';

const SHIP_X = -2960;
const C = BALANCE.cycle;

/** Dorf mit Steinmauern, Herrscher sicher in der Mitte, keine automatische Welle. */
function village(seed = 77): GameState {
  const s = emptyStage(newGame({ seed }));
  setWall(s, -210, 3);
  setWall(s, 210, 3);
  parkPlayers(s, 0);
  return s;
}

describe('Brut holt laufende Bürger ein (Ausholen beginnt nicht bei jedem Einholen neu)', () => {
  it('ein Bauarbeiter, der nachts durch den Wald heimläuft, wird vom Nebel-Mistling erwischt', () => {
    // Vorher: Der Mistling holte den Bauarbeiter (36 px/s) im Nebel ein, begann auszuholen, der Bauarbeiter
    // lief aus der Reichweite, der Mistling holte ihn wieder ein – und begann das Ausholen von vorn. Ewig.
    const s = village();
    quietNight(s, 158);
    const b = addCitizen(s, 'builder', -1500);
    spawnEnemy(s, 'mistling', -1, -1700);
    const ev = runGame(s, 12);
    expect(ofType(ev, 'citizenHit')).toEqual([expect.objectContaining({ citizenId: b.id, role: 'builder' })]);
    expect(b.role).toBe('vagrant');
  });

  it('ein stehendes Ziel wird weiterhin erst nach dem Ausholen getroffen', () => {
    const s = village();
    quietNight(s, 158);
    s.players[0].x = 1000;
    s.players[0].coins = 5;
    const m = spawnEnemy(s, 'mistling', 1, 1000 + BALANCE.enemies.reach - 1);
    let hitAt = -1;
    runGame(s, 2, [], (ev) => {
      if (hitAt < 0 && ofType(ev, 'playerHit').length > 0) hitAt = s.time;
    });
    const windup = BALANCE.enemies.mistling.attackInterval * 0.5;
    expect(hitAt).toBeGreaterThan(windup - 0.05);
    expect(m.carrying).toBe('coin');
  });
});

describe('Nachtlager jenseits des Nebelrisses (Schiffswerft)', () => {
  function shipyard(dayTime: number): { s: GameState; ship: ReturnType<typeof structureAt> } {
    const s = village(78);
    s.day = 4;
    setDayTime(s, dayTime);
    structureAt(s, 'townCenter', 0).level = 2;
    const ship = structureAt(s, 'ship', SHIP_X);
    ship.level = 1;
    return { s, ship };
  }

  it('die Werft gilt als sicher, der Wald davor nicht', () => {
    const { s } = shipyard(50);
    expect(beyondRift(s, SHIP_X)).toBe(true);
    expect(beyondRift(s, -2650)).toBe(false); // direkt hinter dem Riss: in Bemerkweite der erscheinenden Brut
    expect(beyondRift(s, -1500)).toBe(false);
    expect(beyondRift(s, 2780)).toBe(false); // Ostriss bei +2700: dort erscheint die Brut
    expect(beyondRift(s, 2900)).toBe(true);
  });

  it('Bauleute an der Werft arbeiten über Nacht weiter, statt durch den Wald heimzulaufen', () => {
    // Vorher: In der Dämmerung brachen sie zum Dorf auf und liefen nachts der Brut in die Arme.
    const { s, ship } = shipyard(110);
    ship.construction = { toLevel: 2, progress: 0, required: 5000 };
    const bs = [addCitizen(s, 'builder', SHIP_X + 10), addCitizen(s, 'builder', SHIP_X + 20)];
    let maxX = -Infinity;
    const ev = runGame(s, C.length - 110 + 5, [], () => {
      for (const b of bs) maxX = Math.max(maxX, b.x);
    });
    expect(ofType(ev, 'enemySpawn').length).toBeGreaterThan(0); // es war wirklich Nacht mit Welle
    expect(ofType(ev, 'citizenHit')).toHaveLength(0);
    expect(bs.every((b) => b.role === 'builder')).toBe(true);
    expect(maxX).toBeLessThan(-2600 - BALANCE.enemies.noticeRadius);
    // Fortschritt auch nachts (jenseits des Risses ist es sicher)
    expect(ship.construction!.progress).toBeGreaterThan(2 * BALANCE.builders.workRate * (C.length - 110) * 0.9);
  });

  it('ohne Arbeit: nachmittags bleiben sie im Nachtlager, morgens kehren sie heim', () => {
    const late = shipyard(100).s;
    const b = addCitizen(late, 'builder', SHIP_X + 15);
    runGame(late, 30);
    expect(late.phase).toBe('dusk');
    expect(Math.abs(b.x - SHIP_X)).toBeLessThanOrEqual(40);

    const early = shipyard(10).s;
    const e = addCitizen(early, 'builder', SHIP_X + 15);
    runGame(early, 30);
    expect(e.x).toBeGreaterThan(SHIP_X + 15 + 30 * BALANCE.citizens.speed.builder * 0.9);
  });

  it('fertig gewordene Stufe: am nächsten Morgen geht es heim zur Reparatur', () => {
    const { s, ship } = shipyard(150);
    s.wave = { night: s.day, elapsed: 0, pending: [], paleMoon: false }; // stille Nacht: die Mauer soll stehen bleiben
    ship.construction = { toLevel: 2, progress: BALANCE.ship.work[2] - 1, required: BALANCE.ship.work[2] };
    const wall = structureAt(s, 'wall', -210);
    wall.hp = 30; // beschädigt → Arbeit im Dorf
    const b = addCitizen(s, 'builder', SHIP_X + 10);
    runGame(s, 30);
    expect(ship.level).toBe(2);
    expect(Math.abs(b.x - SHIP_X)).toBeLessThanOrEqual(40); // nachts bleibt er dort
    runGame(s, C.length - s.dayTime + 40); // bis in den nächsten Vormittag
    expect(b.task).toEqual({ type: 'repair', structureId: wall.id });
    expect(b.x).toBeGreaterThan(SHIP_X + 1000);
  });
});

describe('Keine Zuflucht für die Krone hinter dem Riss', () => {
  it('wer sich nachts beim Schiffswrack versteckt, wird gewittert und verliert ohne Münzen die Krone', () => {
    // Vorher: Hinter dem Westriss war der Herrscher jede Nacht unerreichbar – das Spiel war nie verlierbar.
    const s = village(79);
    s.day = 3;
    setDayTime(s, C.duskEnd - 1);
    const p = s.players[0];
    p.x = SHIP_X;
    p.coins = 0;
    const ev = runGame(s, C.nightEnd - C.duskEnd);
    expect(ofType(ev, 'crownLost')).toEqual([expect.objectContaining({ playerId: 0 })]);
    expect(s.outcome).toBe('defeat');
  });

  it('Bürger an der Werft bleiben dagegen unbehelligt, solange kein Herrscher dort ist', () => {
    const s = village(80);
    s.day = 3;
    setDayTime(s, C.duskEnd - 1);
    const b = addCitizen(s, 'builder', SHIP_X);
    structureAt(s, 'ship', SHIP_X).construction = { toLevel: 1, progress: 0, required: 500 };
    const ev = runGame(s, C.nightEnd - C.duskEnd);
    expect(ofType(ev, 'enemySpawn').some((e) => e.side === -1)).toBe(true);
    expect(ofType(ev, 'citizenHit')).toHaveLength(0);
    expect(b.role).toBe('builder');
  });
});

describe('Bezahlter Mauerausbau verfällt nicht', () => {
  it('fällt die Mauer während des Ausbaus, liegen die Münzen am Morgen in den Trümmern', () => {
    // Vorher: Der Bauauftrag wurde gelöscht, die bezahlten Münzen waren spurlos verloren.
    const s = village(81);
    quietNight(s, 158);
    const wall = setWall(s, 210, 1, 3);
    wall.construction = { toLevel: 2, progress: 1, required: BALANCE.wall.work[2] };
    spawnEnemy(s, 'breaker', 1, 240);
    const ev = runGame(s, 6);
    expect(ofType(ev, 'wallDestroyed')).toHaveLength(1);
    const refund = s.coins.filter((c) => c.x < wall.x && c.x > wall.x - 120);
    expect(refund).toHaveLength(BALANCE.wall.cost[2]);
    // der Bauplatz ist wieder kaufbar
    expect(getOffer(s, wall)).toMatchObject({ action: 'buildWall', toLevel: 1 });
  });
});
