// Treffer am Herrscher: Münzverlust, Diebstahl, Unverwundbarkeit, Kronverlust → Niederlage (auch im Koop).
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim';
import type { GameState } from '../../src/sim';
import { spawnEnemy } from '../../src/sim/enemies';
import { emptyStage, newGame, ofType, parkPlayers, quietNight, runGame, setDayTime, tickNight } from './helpers-night';

function arena(coop = false): GameState {
  const s = emptyStage(newGame({ coop }));
  quietNight(s);
  parkPlayers(s, 400);
  return s;
}

describe('Herrscher getroffen', () => {
  it('mit Münzen: verliert bis zu 3, zwei fallen verstreut, eine trägt der Mistling davon', () => {
    const s = arena();
    const p = s.players[0];
    p.coins = 5;
    const m = spawnEnemy(s, 'mistling', 1, 420);
    const ev = tickNight(s, 1);
    expect(ofType(ev, 'playerHit')).toEqual([{ type: 'playerHit', x: 400, playerId: 0, coinsLost: 3 }]);
    expect(p.coins).toBe(2);
    expect(p.hasCrown).toBe(true);
    expect(p.invuln).toBeGreaterThan(0);
    expect(p.invuln).toBeLessThanOrEqual(BALANCE.player.hitInvuln);
    expect(s.coins).toHaveLength(2);
    expect(m.carrying).toBe('coin');
    expect(m.state).toBe('flee');
    expect(s.outcome).toBe('playing');
    // Münzen + Beute: nichts geht verloren außer der gestohlenen
    expect(p.coins + s.coins.length + 1).toBe(5);
  });

  it('mit einer Münze: die Münze ist weg, nichts fällt zu Boden', () => {
    const s = arena();
    s.players[0].coins = 1;
    const m = spawnEnemy(s, 'mistling', 1, 420);
    const ev = tickNight(s, 1);
    expect(ofType(ev, 'playerHit')[0].coinsLost).toBe(1);
    expect(s.players[0].coins).toBe(0);
    expect(s.coins).toHaveLength(0);
    expect(m.carrying).toBe('coin');
  });

  it('Brecher stehlen nicht, sie stoßen die Münzen weg', () => {
    const s = arena();
    s.players[0].coins = 10;
    const b = spawnEnemy(s, 'breaker', 1, 415);
    const ev = tickNight(s, 1.5);
    expect(ofType(ev, 'playerHit')).toHaveLength(1);
    expect(s.players[0].coins).toBe(7);
    expect(s.coins).toHaveLength(3);
    expect(b.carrying).toBeNull();
    expect(b.state).not.toBe('flee');
    // vom Brecher (Osten) weg nach Westen gestoßen
    for (const c of s.coins) expect(c.vx).toBeLessThan(0);
  });

  it('unverwundbare Herrscher werden nicht getroffen', () => {
    const s = arena();
    s.players[0].coins = 0;
    s.players[0].invuln = 5; // tickNight lässt players.ts aus → bleibt gesetzt
    spawnEnemy(s, 'mistling', 1, 410);
    const ev = tickNight(s, 3);
    expect(ofType(ev, 'playerHit')).toHaveLength(0);
    expect(s.players[0].hasCrown).toBe(true);
  });

  it('ohne Münzen: Krone verloren → Niederlage; der Mistling trägt die Krone davon', () => {
    const s = arena();
    s.players[0].coins = 0;
    const m = spawnEnemy(s, 'mistling', 1, 420);
    const ev = tickNight(s, 1);
    const kinds = ev.map((e) => e.type).filter((t) => t === 'playerHit' || t === 'crownLost' || t === 'defeat');
    expect(kinds).toEqual(['playerHit', 'crownLost', 'defeat']);
    expect(ofType(ev, 'crownLost')).toEqual([{ type: 'crownLost', x: 400, playerId: 0 }]);
    expect(s.players[0].hasCrown).toBe(false);
    expect(s.outcome).toBe('defeat');
    // Ausholen (halber Angriffstakt) nach dem Herankommen
    expect(s.outcomeTime).toBeGreaterThan(BALANCE.enemies.mistling.attackInterval * 0.5);
    expect(s.outcomeTime).toBeLessThan(1);
    expect(m.carrying).toBe('crown');
    // Herrscher ohne Krone ist kein Ziel mehr; die Niederlage wird nur einmal gemeldet
    const more = tickNight(s, 30);
    expect(ofType(more, 'defeat')).toHaveLength(0);
    expect(ofType(more, 'enemyEscaped')).toEqual([{ type: 'enemyEscaped', x: expect.any(Number), kind: 'mistling', carrying: 'crown' }]);
  });

  it('Koop: verliert Spieler 2 die Krone, ist das Spiel verloren', () => {
    const s = arena(true);
    expect(s.players).toHaveLength(2);
    const [p1, p2] = s.players;
    p1.x = -400;
    p1.coins = 20;
    p2.x = 400;
    p2.coins = 0;
    spawnEnemy(s, 'mistling', 1, 420);
    const ev = tickNight(s, 1);
    expect(ofType(ev, 'crownLost')).toEqual([{ type: 'crownLost', x: 400, playerId: 1 }]);
    expect(p1.hasCrown).toBe(true);
    expect(p2.hasCrown).toBe(false);
    expect(s.outcome).toBe('defeat');
  });

  it('Koop: Herrscher haben Vorrang vor Bürgern, der nähere wird angegriffen', () => {
    const s = arena(true);
    const [p1, p2] = s.players;
    p1.x = 395;
    p1.coins = 4;
    p2.x = 405;
    p2.coins = 4;
    const ev = (spawnEnemy(s, 'mistling', 1, 425), tickNight(s, 1));
    expect(ofType(ev, 'playerHit').map((e) => e.playerId)).toEqual([1]);
    expect(p1.coins).toBe(4);
  });

  it('volle Integration (stepGame): ungeschützt ohne Münzen geht die Krone in der ersten Nacht verloren', () => {
    const s = emptyStage(newGame({ seed: 99 }));
    s.players[0].coins = 0;
    setDayTime(s, BALANCE.cycle.duskEnd - 5);
    let defeatAt: number | null = null;
    runGame(s, 60, [], (ev) => {
      if (defeatAt === null && ev.some((e) => e.type === 'defeat')) defeatAt = s.dayTime;
    });
    expect(defeatAt).not.toBeNull();
    expect(defeatAt!).toBeGreaterThan(BALANCE.cycle.duskEnd);
    expect(defeatAt!).toBeLessThan(BALANCE.cycle.nightEnd);
    expect(s.outcome).toBe('defeat');
    expect(s.players[0].hasCrown).toBe(false);
    // Welt läuft nach der Niederlage weiter (Darstellung), ohne erneute Meldung
    const after = runGame(s, 5);
    expect(ofType(after, 'defeat')).toHaveLength(0);
    expect(s.outcome).toBe('defeat');
  });
});
