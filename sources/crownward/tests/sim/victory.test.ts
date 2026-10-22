// Crownward – Siegbedingung: Schiffswrack in drei Stufen reparieren und ablegen.
import { describe, expect, it } from 'vitest';
import { BALANCE, createGame, getOffer, getPlayerFocus, stepGame } from '../../src/sim';
import type { GameState, SimEvent } from '../../src/sim';
import { addCitizen, clearCoins, holdAct, inp, ofType, run, structureAt, tapAct } from './helpers-economy';

const SHIP_X = -2960;

function setup(townLevel: number): { s: GameState; ship: ReturnType<typeof structureAt> } {
  const s = createGame({ seed: 71 });
  clearCoins(s);
  structureAt(s, 'townCenter', 0).level = townLevel;
  const ship = structureAt(s, 'ship', SHIP_X);
  const p = s.players[0];
  p.x = SHIP_X + 20;
  p.coins = BALANCE.player.purseMax;
  return { s, ship };
}

describe('Schiffswrack', () => {
  it('Reparaturstufen verlangen die passende Siedlungsstufe', () => {
    const { s, ship } = setup(0);
    expect(getOffer(s, ship)).toMatchObject({ action: 'repairShip', toLevel: 1, cost: 8, blockedKey: 'blocked.town.1' });
    const ev = run(s, 2, [inp({ act: true })]);
    expect(ofType(ev, 'coinPaid')).toHaveLength(0);
    structureAt(s, 'townCenter', 0).level = 1;
    expect(getOffer(s, ship)).toMatchObject({ labelKey: 'offer.repairShip.1', blockedKey: null });
    ship.level = 1;
    expect(getOffer(s, ship)).toMatchObject({ toLevel: 2, cost: 12, blockedKey: 'blocked.town.2' });
    ship.level = 2;
    expect(getOffer(s, ship)).toMatchObject({ toLevel: 3, cost: 14, blockedKey: 'blocked.town.3' });
  });

  it('drei Stufen reparieren und ablegen → Sieg', () => {
    const { s, ship } = setup(3);
    for (let i = 0; i < 4; i++) addCitizen(s, 'builder', SHIP_X + 40 + i * 5);
    const p = s.players[0];
    const all: SimEvent[] = [];

    for (let stage = 1; stage <= 3; stage++) {
      const offer = getPlayerFocus(s, 0);
      expect(offer).toMatchObject({
        action: 'repairShip',
        toLevel: stage,
        cost: BALANCE.ship.cost[stage],
        labelKey: `offer.repairShip.${stage}`,
        blockedKey: null,
      });
      const pay = holdAct(s, 0.2 + BALANCE.ship.cost[stage] * BALANCE.player.payInterval);
      all.push(...pay);
      expect(ofType(pay, 'purchase')).toEqual([expect.objectContaining({ action: 'repairShip', cost: BALANCE.ship.cost[stage] })]);
      expect(ship.construction).toMatchObject({ toLevel: stage, required: BALANCE.ship.work[stage] });
      expect(getPlayerFocus(s, 0)).toMatchObject({ blockedKey: 'blocked.building' });
      all.push(...run(s, 60, [], { until: () => ship.construction === null }));
      expect(ship.level).toBe(stage);
    }
    const stages = ofType(all, 'shipStage').map((e) => e.level);
    expect(stages).toEqual([1, 2, 3]);
    expect(p.coins).toBe(BALANCE.player.purseMax - (8 + 12 + 14));

    // seetüchtig: Ablegen kostet nichts
    expect(getPlayerFocus(s, 0)).toMatchObject({ action: 'embark', cost: 0, labelKey: 'offer.embark', blockedKey: null });
    expect(s.outcome).toBe('playing');
    const ev = tapAct(s);
    expect(s.outcome).toBe('victory');
    expect(s.outcomeTime).toBeGreaterThan(0);
    expect(ofType(ev, 'victory')).toEqual([expect.objectContaining({ x: SHIP_X })]);
    expect(ofType(ev, 'purchase')).toEqual([expect.objectContaining({ action: 'embark', cost: 0 })]);

    // nach dem Sieg: keine Angebote und keine Steuerung mehr, Ergebnis bleibt bestehen
    expect(getPlayerFocus(s, 0)).toBeNull();
    const x = p.x;
    const after = run(s, 2, [inp({ right: true, act: true })]);
    expect(p.x).toBe(x);
    expect(ofType(after, 'victory')).toHaveLength(0);
    expect(s.outcome).toBe('victory');
  });

  it('Sieg wird genau einmal gemeldet, auch im Koop', () => {
    const s = createGame({ seed: 72, coop: true });
    const ship = structureAt(s, 'ship', SHIP_X);
    ship.level = 3;
    s.players[0].x = SHIP_X;
    s.players[1].x = SHIP_X + 10;
    const ev = stepGame(s, [inp({ act: true }), inp({ act: true })]);
    expect(ofType(ev, 'victory')).toHaveLength(1);
    expect(ofType(ev, 'purchase')).toHaveLength(1);
    expect(s.outcome).toBe('victory');
  });
});
