// Crownward – Wirtschaft: Reiten/Ausdauer, Münzen aufheben, Beutelgrenze, Halte-Bezahlung, Fallenlassen, Koop.
import { describe, expect, it } from 'vitest';
import { BALANCE, createGame, getOffer, getPlayerFocus, SIM_DT } from '../../src/sim';
import { spawnCoin } from '../../src/sim/util';
import { clearCoins, IDLE, inp, ofType, run, structureAt, tapAct } from './helpers-economy';

const P = BALANCE.player;

describe('Reiten und Ausdauer', () => {
  it('beschleunigt auf Schrittgeschwindigkeit und dreht die Blickrichtung', () => {
    const s = createGame({ seed: 1 });
    const p = s.players[0];
    run(s, 0.1, [inp({ right: true })]);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(P.walkSpeed); // noch in der Beschleunigung
    run(s, 1, [inp({ right: true })]);
    expect(p.vx).toBeCloseTo(P.walkSpeed, 5);
    expect(p.anim).toBe('walk');
    run(s, 0.5, [inp({ left: true })]);
    expect(p.facing).toBe(-1);
    expect(p.vx).toBeLessThan(0);
  });

  it('Sprint ist schneller, verbraucht Ausdauer und erschöpft; Stillstand regeneriert schneller', () => {
    const s = createGame({ seed: 1 });
    const p = s.players[0];
    run(s, 2, [inp({ right: true, sprint: true })]);
    expect(p.vx).toBeCloseTo(P.sprintSpeed, 5);
    expect(p.anim).toBe('run');
    expect(p.stamina).toBeLessThan(0.8);
    expect(p.stamina).toBeGreaterThan(0.7);

    run(s, 7, [inp({ right: true, sprint: true })]);
    expect(p.exhausted).toBe(true);
    expect(p.vx).toBeLessThanOrEqual(P.walkSpeed + 1e-9); // erschöpft: nur noch Schritt

    // Stehen regeneriert mit idleRegenMult; Erschöpfung endet bei exhaustRecover
    run(s, 1.5, [IDLE]);
    const afterIdle = p.stamina;
    expect(afterIdle).toBeGreaterThan(0.15);
    run(s, 1, [IDLE]);
    expect(p.exhausted).toBe(false);
    expect(p.stamina).toBeGreaterThanOrEqual(P.exhaustRecover);
  });

  it('grast nach einigen Sekunden Stillstand und bleibt in den Weltgrenzen', () => {
    const s = createGame({ seed: 1 });
    const p = s.players[0];
    run(s, 4.5, [IDLE]);
    expect(p.anim).toBe('graze');
    p.x = BALANCE.world.maxX - 30;
    run(s, 1, [inp({ right: true })]);
    expect(p.x).toBeLessThanOrEqual(BALANCE.world.maxX);
    expect(p.x).toBeGreaterThan(BALANCE.world.maxX - 40);
  });

  it('ohne Krone gibt es keine Steuerung mehr', () => {
    const s = createGame({ seed: 1 });
    const p = s.players[0];
    p.hasCrown = false;
    const x0 = p.x;
    const ev = run(s, 1, [inp({ right: true, act: true })]);
    expect(p.x).toBe(x0);
    expect(getPlayerFocus(s, 0)).toBeNull();
    expect(ofType(ev, 'coinPaid')).toHaveLength(0);
  });
});

describe('Münzen aufheben', () => {
  it('sammelt Bodenmünzen im Vorbeireiten ein', () => {
    const s = createGame({ seed: 2 });
    const p = s.players[0];
    expect(p.coins).toBe(P.startCoins);
    const before = s.coins.length;
    const ev = run(s, 2, [inp({ right: true })]); // Startmünze bei x=150
    expect(p.coins).toBe(P.startCoins + 1);
    expect(s.coins.length).toBe(before - 1);
    expect(s.stats.coinsCollected).toBe(1);
    const pick = ofType(ev, 'coinPickup');
    expect(pick).toHaveLength(1);
    expect(pick[0]).toMatchObject({ playerId: 0, coins: P.startCoins + 1 });
  });

  it('volle Börse: Münze bleibt liegen, purseFull wird gedrosselt gemeldet', () => {
    const s = createGame({ seed: 3 });
    clearCoins(s);
    const p = s.players[0];
    p.x = 900;
    spawnCoin(s, 900, { vx: 0, vy: 0, y: 0, pickupDelay: 0 });
    p.coins = P.purseMax;
    const ev = run(s, 1.5, [IDLE]);
    expect(p.coins).toBe(P.purseMax);
    expect(s.coins).toHaveLength(1);
    expect(ofType(ev, 'purseFull')).toHaveLength(1);
    p.coins = P.purseMax - 1;
    run(s, 0.1, [IDLE]);
    expect(p.coins).toBe(P.purseMax);
    expect(s.coins).toHaveLength(0);
  });

  it('fliegende Münzen und Münzen mit Aufhebesperre werden nicht eingesammelt', () => {
    const s = createGame({ seed: 3 });
    clearCoins(s);
    const p = s.players[0];
    p.x = 900;
    spawnCoin(s, 900, { vx: 0, vy: 0, y: 30, pickupDelay: 0 }); // hoch in der Luft
    spawnCoin(s, 901, { vx: 0, vy: 0, y: 0, pickupDelay: 1 }); // gesperrt
    run(s, SIM_DT, [IDLE]);
    expect(p.coins).toBe(P.startCoins);
    run(s, 1.2, [IDLE]); // beide sind inzwischen gelandet bzw. frei
    expect(p.coins).toBe(P.startCoins + 2);
  });
});

describe('Halte-Bezahlung', () => {
  it('Werkzeugkauf: Münzen fallen nacheinander in die Slots, dann Kauf', () => {
    const s = createGame({ seed: 4 });
    const p = s.players[0];
    const stand = structureAt(s, 'toolStand', 46);
    const focus = getPlayerFocus(s, 0);
    expect(focus).toMatchObject({ action: 'buyTool', cost: 2, labelKey: 'offer.buyTool.bow', blockedKey: null });

    // nach payFirstDelay die erste Münze, danach im payInterval-Takt
    let ev = run(s, P.payFirstDelay + 0.05, [inp({ act: true })]);
    expect(ofType(ev, 'coinPaid')).toHaveLength(1);
    expect(p.payProgress).toBe(1);
    expect(p.coins).toBe(5);
    ev = run(s, P.payInterval, [inp({ act: true })]);
    const paid = ofType(ev, 'coinPaid');
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ paid: 2, cost: 2, structureId: stand.id });
    const purchase = ofType(ev, 'purchase');
    expect(purchase).toHaveLength(1);
    expect(purchase[0]).toMatchObject({ action: 'buyTool', cost: 2, playerId: 0 });
    expect(ofType(ev, 'toolStocked')).toHaveLength(1);
    expect(stand.stock).toBe(1);
    expect(p.coins).toBe(4);
    expect(p.payTargetId).toBeNull();
    expect(s.stats.coinsSpent).toBe(2);

    // weiter gehalten: kein automatischer Folgekauf
    ev = run(s, 1, [inp({ act: true })]);
    expect(ofType(ev, 'coinPaid')).toHaveLength(0);
    expect(stand.stock).toBe(1);
  });

  it('Loslassen vor dem letzten Slot bricht ab und erstattet die Münzen', () => {
    const s = createGame({ seed: 5 });
    const p = s.players[0];
    p.x = 0;
    expect(getPlayerFocus(s, 0)).toMatchObject({ action: 'upgradeTown', cost: 5, labelKey: 'offer.upgradeTown.1' });
    run(s, 0.3, [inp({ act: true })]);
    expect(p.payProgress).toBe(1);
    expect(p.coins).toBe(5);
    const ev = run(s, SIM_DT, [IDLE]);
    const cancel = ofType(ev, 'payCancelled');
    expect(cancel).toHaveLength(1);
    expect(cancel[0]).toMatchObject({ refunded: 1, playerId: 0 });
    expect(p.coins).toBe(6);
    expect(p.payTargetId).toBeNull();
    expect(structureAt(s, 'townCenter', 0).construction).toBeNull();
  });

  it('nicht genug Münzen: Abbruch mit voller Rückgabe, kein Neustart bei weiter gehaltener Taste', () => {
    const s = createGame({ seed: 6 });
    const p = s.players[0];
    p.x = 0;
    p.coins = 3;
    const ev = run(s, 2.5, [inp({ act: true })]);
    expect(ofType(ev, 'coinPaid')).toHaveLength(3);
    const cancel = ofType(ev, 'payCancelled');
    expect(cancel).toHaveLength(1);
    expect(cancel[0].refunded).toBe(3);
    expect(ofType(ev, 'purchase')).toHaveLength(0);
    expect(p.coins).toBe(3);
    expect(structureAt(s, 'townCenter', 0).construction).toBeNull();
  });

  it('leerer Beutel: sofortige Rückmeldung ohne Zahlung', () => {
    const s = createGame({ seed: 6 });
    const p = s.players[0];
    p.x = 0;
    p.coins = 0;
    const ev = tapAct(s);
    expect(ofType(ev, 'payCancelled')).toEqual([expect.objectContaining({ refunded: 0 })]);
    expect(p.payTargetId).toBeNull();
  });

  it('Wegreiten aus der Reichweite bricht die Zahlung ab', () => {
    const s = createGame({ seed: 7 });
    clearCoins(s); // Startmünze bei −160 liegt auf dem Weg
    const p = s.players[0];
    p.x = -190; // Mauerplatz bei −210 (Reichweite bis −177)
    expect(getPlayerFocus(s, 0)).toMatchObject({ action: 'buildWall', cost: 2, labelKey: 'offer.buildWall.1' });
    const ev = run(s, 0.6, [inp({ act: true, right: true })]);
    expect(ofType(ev, 'coinPaid')).toHaveLength(1);
    expect(ofType(ev, 'payCancelled')).toEqual([expect.objectContaining({ refunded: 1 })]);
    expect(ofType(ev, 'purchase')).toHaveLength(0);
    expect(p.coins).toBe(6);
    expect(structureAt(s, 'wall', -210).construction).toBeNull();
  });

  it('gesperrte Angebote nehmen keine Münzen an', () => {
    const s = createGame({ seed: 7 });
    const p = s.players[0];
    p.x = 0;
    const tc = structureAt(s, 'townCenter', 0);
    tc.construction = { toLevel: 1, progress: 0, required: 10 };
    expect(getPlayerFocus(s, 0)).toMatchObject({ blockedKey: 'blocked.building' });
    const ev = run(s, 1, [inp({ act: true })]);
    expect(ofType(ev, 'coinPaid')).toHaveLength(0);
    expect(ofType(ev, 'coinDrop')).toHaveLength(0);
    expect(p.coins).toBe(6);
  });

  it('volle Werkzeugständer sind gesperrt', () => {
    const s = createGame({ seed: 7 });
    const stand = structureAt(s, 'toolStand', 46);
    stand.stock = BALANCE.tools.maxStock;
    expect(getOffer(s, stand)).toMatchObject({ blockedKey: 'blocked.stockFull' });
  });
});

describe('Münze fallen lassen', () => {
  it('ohne Angebot fällt eine Münze vor das Pferd; eigene erst nach dropPickupDelay wieder aufhebbar', () => {
    const s = createGame({ seed: 8 });
    clearCoins(s);
    const p = s.players[0];
    p.x = 900;
    expect(getPlayerFocus(s, 0)).toBeNull();
    const ev = tapAct(s);
    expect(ofType(ev, 'coinDrop')).toHaveLength(1);
    expect(p.coins).toBe(5);
    expect(s.coins).toHaveLength(1);
    const coin = s.coins[0];
    expect(coin.droppedBy).toBe(0);
    expect(coin.x).toBeGreaterThan(p.x); // vor dem Pferd (Blickrichtung Osten)

    run(s, 1, [IDLE]);
    expect(coin.y).toBe(0); // gelandet
    p.x = coin.x;
    run(s, 0.4, [IDLE]);
    expect(p.coins).toBe(5); // noch gesperrt
    run(s, P.dropPickupDelay, [IDLE]);
    expect(p.coins).toBe(6);
    expect(s.coins).toHaveLength(0);
  });

  it('Abklingzeit begrenzt schnelles Fallenlassen', () => {
    const s = createGame({ seed: 8 });
    clearCoins(s);
    const p = s.players[0];
    p.x = 900;
    tapAct(s);
    tapAct(s);
    expect(s.coins).toHaveLength(1);
    run(s, P.dropCooldown, [IDLE]);
    tapAct(s);
    expect(s.coins).toHaveLength(2);
    expect(p.coins).toBe(4);
  });
});

describe('kostenlose Angebote und Truhen', () => {
  it('Truhe öffnet sich per Tastendruck und spuckt ihre Münzen aus', () => {
    const s = createGame({ seed: 9 });
    clearCoins(s);
    const p = s.players[0];
    const chest = structureAt(s, 'chest', 820);
    p.x = 820;
    expect(getPlayerFocus(s, 0)).toMatchObject({ action: 'openChest', cost: 0, labelKey: 'offer.openChest' });
    const ev = tapAct(s);
    expect(chest.opened).toBe(true);
    expect(ofType(ev, 'chestOpened')).toEqual([expect.objectContaining({ coins: 8, structureId: chest.id })]);
    expect(ofType(ev, 'purchase')).toEqual([expect.objectContaining({ action: 'openChest', cost: 0 })]);
    expect(s.coins).toHaveLength(8);
    expect(s.stats.chestsOpened).toBe(1);
    expect(getOffer(s, chest)).toBeNull();

    // Münzen fliegen verstreut heraus und landen; im Hin- und Herreiten einsammeln
    run(s, 2, [IDLE]);
    expect(s.coins.every((c) => c.y === 0)).toBe(true);
    run(s, 2.2, [inp({ left: true })]);
    run(s, 4.4, [inp({ right: true })]);
    expect(p.coins).toBe(6 + 8);
  });
});

describe('lokaler Koop', () => {
  it('beide zahlen gleichzeitig in denselben Ständer – je eigener Fortschritt', () => {
    const s = createGame({ seed: 10, coop: true });
    const [p1, p2] = s.players;
    p1.x = 70;
    p2.x = 50;
    const stand = structureAt(s, 'toolStand', 46);
    const ev = run(s, 0.6, [inp({ act: true }), inp({ act: true })]);
    expect(ofType(ev, 'purchase')).toHaveLength(2);
    expect(stand.stock).toBe(2);
    expect(p1.coins).toBe(4);
    expect(p2.coins).toBe(4);
    expect(s.stats.coinsSpent).toBe(4);
  });

  it('wer zuerst fertig zahlt, beauftragt den Bau; der andere bekommt alles zurück', () => {
    const s = createGame({ seed: 11, coop: true });
    const [p1, p2] = s.players;
    p1.x = 0;
    p2.x = 5;
    const ev = run(s, 2, [inp({ act: true }), inp({ act: true })]);
    const tc = structureAt(s, 'townCenter', 0);
    expect(tc.construction).toMatchObject({ toLevel: 1, progress: expect.any(Number) });
    expect(ofType(ev, 'purchase')).toEqual([expect.objectContaining({ playerId: 0, action: 'upgradeTown' })]);
    expect(ofType(ev, 'payCancelled')).toEqual([expect.objectContaining({ playerId: 1, refunded: 4 })]);
    expect(p1.coins).toBe(1);
    expect(p2.coins).toBe(6);
  });

  it('beide Spieler bewegen sich unabhängig', () => {
    const s = createGame({ seed: 12, coop: true });
    const [p1, p2] = s.players;
    const x1 = p1.x;
    const x2 = p2.x;
    run(s, 1, [inp({ left: true }), inp({ right: true, sprint: true })]);
    expect(p1.x).toBeLessThan(x1);
    expect(p2.x - x2).toBeGreaterThan(x1 - p1.x);
  });
});
