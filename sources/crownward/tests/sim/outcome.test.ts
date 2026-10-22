// Crownward – nach Sieg/Niederlage läuft die Welt weiter, darf das Ergebnis aber nicht mehr verändern.
import { describe, expect, it } from 'vitest';
import { spawnEnemy } from '../../src/sim/enemies';
import { setOutcome } from '../../src/sim/util';
import { emptyStage, newGame, ofType, quietNight, runGame } from './helpers-night';

describe('Ergebnis ist endgültig', () => {
  it('nach dem Sieg trifft die Brut den Herrscher nicht mehr (keine Münz-/Kronverluste)', () => {
    const s = emptyStage(newGame({ seed: 5 }));
    quietNight(s, 158);
    const p = s.players[0];
    p.x = 1000;
    p.coins = 0;
    setOutcome(s, 'victory', p.x, () => {});
    spawnEnemy(s, 'mistling', 1, 1004);
    spawnEnemy(s, 'mistling', 1, 1040);
    const ev = runGame(s, 8);
    expect(ofType(ev, 'playerHit')).toEqual([]);
    expect(ofType(ev, 'crownLost')).toEqual([]);
    expect(p.hasCrown).toBe(true);
    expect(s.outcome).toBe('victory');
  });

  it('während des Spiels kostet derselbe Angriff ohne Münzen die Krone (Gegenprobe)', () => {
    const s = emptyStage(newGame({ seed: 5 }));
    quietNight(s, 158);
    const p = s.players[0];
    p.x = 1000;
    p.coins = 0;
    spawnEnemy(s, 'mistling', 1, 1004);
    const ev = runGame(s, 8);
    expect(ofType(ev, 'crownLost').length).toBe(1);
    expect(s.outcome).toBe('defeat');
  });
});
