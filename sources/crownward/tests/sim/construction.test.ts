// Crownward – Bauen: Mauer kaufen und bauen, Ausbau, Siedlungsstufe schaltet Bauplätze frei, Reparatur,
// Schrein des Hammers, Prioritäten und Abend-Regel der Bauleute.
import { describe, expect, it } from 'vitest';
import { BALANCE, createGame, getOffer, getPlayerFocus, SIM_DT } from '../../src/sim';
import type { GameState, Structure } from '../../src/sim';
import { addCitizen, clearCoins, holdAct, ofType, run, structureAt } from './helpers-economy';

function setTownLevel(s: GameState, level: number): void {
  structureAt(s, 'townCenter', 0).level = level;
}

/** Schritte, bis der Bauauftrag fertig ist (Bauarbeiter steht schon am Platz). */
function stepsToFinish(s: GameState, site: Structure, maxSeconds = 60): number {
  let steps = 0;
  run(s, maxSeconds, [], {
    until: () => {
      steps++;
      return site.construction === null;
    },
  });
  return steps;
}

describe('Mauer kaufen und bauen', () => {
  it('Kauf beauftragt den Bau, ein Baumeister errichtet Stufe 1 mit vollen HP', () => {
    const s = createGame({ seed: 21 });
    clearCoins(s);
    const builder = addCitizen(s, 'builder', 0);
    const wall = structureAt(s, 'wall', 210);
    const p = s.players[0];
    p.x = 205;
    expect(getPlayerFocus(s, 0)).toMatchObject({ action: 'buildWall', cost: 2, toLevel: 1, labelKey: 'offer.buildWall.1' });

    const ev = holdAct(s, 0.6);
    expect(ofType(ev, 'purchase')).toEqual([expect.objectContaining({ action: 'buildWall', cost: 2 })]);
    expect(ofType(ev, 'buildStart')).toEqual([expect.objectContaining({ structureId: wall.id, kind: 'wall', toLevel: 1 })]);
    expect(wall.construction).toMatchObject({ toLevel: 1, required: BALANCE.wall.work[1] });
    expect(wall.level).toBe(0);
    expect(getOffer(s, wall)).toMatchObject({ blockedKey: 'blocked.building' });

    const build = run(s, 25, [], { until: () => wall.construction === null });
    expect(wall.level).toBe(1);
    expect(wall.hp).toBe(BALANCE.wall.hp[1]);
    expect(wall.maxHp).toBe(BALANCE.wall.hp[1]);
    expect(ofType(build, 'buildComplete')).toEqual([expect.objectContaining({ structureId: wall.id, kind: 'wall', level: 1 })]);
    // ca. ein Hammerschlag je hammerInterval Arbeitszeit
    const hammers = ofType(build, 'hammer');
    expect(hammers.length).toBeGreaterThanOrEqual(Math.floor(BALANCE.wall.work[1] / BALANCE.builders.hammerInterval) - 1);
    expect(hammers.every((h) => h.citizenId === builder.id)).toBe(true);
    // Baumeister arbeitet auf der Innenseite der Mauer
    expect(builder.x).toBeLessThan(wall.x);
    // nach Fertigstellung: Ausbau angeboten, aber Siedlungsstufe 1 nötig
    expect(getOffer(s, wall)).toMatchObject({ action: 'upgradeWall', toLevel: 2, cost: 4, blockedKey: 'blocked.town.1' });
  });

  it('ohne Baumeister bleibt der Auftrag offen', () => {
    const s = createGame({ seed: 22 });
    const wall = structureAt(s, 'wall', -210);
    wall.construction = { toLevel: 1, progress: 0, required: 5 };
    run(s, 10);
    expect(wall.construction).not.toBeNull();
    expect(wall.level).toBe(0);
  });

  it('eine Mauer im Ausbau bleibt mit alter Stufe und HP stehen', () => {
    const s = createGame({ seed: 23 });
    clearCoins(s);
    setTownLevel(s, 1);
    const wall = structureAt(s, 'wall', 210);
    wall.level = 1;
    wall.maxHp = BALANCE.wall.hp[1];
    wall.hp = 10;
    s.players[0].x = 205;
    expect(getPlayerFocus(s, 0)).toMatchObject({ action: 'upgradeWall', toLevel: 2, cost: 4, labelKey: 'offer.upgradeWall.2' });
    holdAct(s, 1.1);
    expect(wall.construction).toMatchObject({ toLevel: 2, required: BALANCE.wall.work[2] });
    expect(wall.level).toBe(1);
    expect(wall.hp).toBe(10);

    addCitizen(s, 'builder', 150);
    run(s, 4);
    expect(wall.level).toBe(1); // noch im Bau, stehend
    expect(wall.hp).toBe(10); // während des Ausbaus keine Reparatur
    run(s, 30, [], { until: () => wall.construction === null });
    expect(wall.level).toBe(2);
    expect(wall.hp).toBe(BALANCE.wall.hp[2]);
    expect(wall.maxHp).toBe(BALANCE.wall.hp[2]);
  });

  it('ein Turm wird gebaut und erhält Turm-HP', () => {
    const s = createGame({ seed: 24 });
    setTownLevel(s, 1);
    const tower = structureAt(s, 'tower', 310);
    expect(getOffer(s, tower)).toMatchObject({ action: 'buildTower', cost: 5, labelKey: 'offer.buildTower.1', blockedKey: null });
    tower.construction = { toLevel: 1, progress: 0, required: BALANCE.tower.work[1] };
    addCitizen(s, 'builder', 280);
    run(s, 30, [], { until: () => tower.construction === null });
    expect(tower.level).toBe(1);
    expect(tower.hp).toBe(BALANCE.tower.hp[1]);
    // Steinturm braucht Siedlungsstufe 3
    expect(getOffer(s, tower)).toMatchObject({ action: 'upgradeTower', labelKey: 'offer.upgradeTower.2', blockedKey: 'blocked.town.3' });
  });
});

describe('Siedlungsausbau', () => {
  it('Stufe 1 schaltet neue Bauplätze, Feld, Sense und Mauerausbau frei', () => {
    const s = createGame({ seed: 25 });
    clearCoins(s);
    const tc = structureAt(s, 'townCenter', 0);
    const wall2 = structureAt(s, 'wall', 390);
    const tower = structureAt(s, 'tower', 310);
    const farm = structureAt(s, 'farm', 120);
    const scythe = structureAt(s, 'toolStand', -82);
    const outer = structureAt(s, 'wall', 610);
    const inner = structureAt(s, 'wall', -210);
    inner.level = 1;
    inner.hp = inner.maxHp = BALANCE.wall.hp[1];

    for (const st of [wall2, tower, farm, scythe, outer]) expect(getOffer(s, st)).toBeNull();
    expect(getOffer(s, inner)).toMatchObject({ blockedKey: 'blocked.town.1' });
    expect(getOffer(s, structureAt(s, 'ship', -2960))).toMatchObject({ action: 'repairShip', blockedKey: 'blocked.town.1' });

    addCitizen(s, 'builder', 10);
    s.players[0].x = 0;
    const ev = holdAct(s, 1.4); // 5 Münzen
    expect(ofType(ev, 'purchase')).toEqual([expect.objectContaining({ action: 'upgradeTown', cost: 5 })]);
    expect(tc.construction).toMatchObject({ toLevel: 1, required: BALANCE.townCenter.work[1] });
    expect(getOffer(s, tc)).toMatchObject({ blockedKey: 'blocked.building' });
    expect(tc.level).toBe(0);

    const ev2 = run(s, 30, [], { until: () => tc.construction === null });
    expect(tc.level).toBe(1);
    expect(ofType(ev2, 'buildComplete')).toEqual([expect.objectContaining({ kind: 'townCenter', level: 1 })]);

    expect(getOffer(s, wall2)).toMatchObject({ action: 'buildWall', blockedKey: null });
    expect(getOffer(s, tower)).toMatchObject({ action: 'buildTower', blockedKey: null });
    expect(getOffer(s, farm)).toMatchObject({ action: 'buildFarm', cost: 6, labelKey: 'offer.buildFarm', blockedKey: null });
    expect(getOffer(s, scythe)).toMatchObject({ action: 'buyTool', labelKey: 'offer.buyTool.scythe', cost: 3 });
    expect(getOffer(s, inner)).toMatchObject({ action: 'upgradeWall', blockedKey: null });
    expect(getOffer(s, outer)).toBeNull(); // äußere Mauer erst ab Stufe 2
    expect(getOffer(s, tc)).toMatchObject({ action: 'upgradeTown', toLevel: 2, cost: 10, labelKey: 'offer.upgradeTown.2' });
  });

  it('Feld kaufen → Bauleute legen es an', () => {
    const s = createGame({ seed: 26 });
    setTownLevel(s, 1);
    const farm = structureAt(s, 'farm', 120);
    s.players[0].x = 120;
    s.players[0].coins = 10;
    holdAct(s, 1.7); // 6 Münzen
    expect(farm.construction).toMatchObject({ toLevel: 1, required: BALANCE.farm.work });
    addCitizen(s, 'builder', 100);
    run(s, 30, [], { until: () => farm.construction === null });
    expect(farm.level).toBe(1);
    expect(getOffer(s, farm)).toBeNull();
  });
});

describe('Bauleute', () => {
  it('reparieren beschädigte Mauern', () => {
    const s = createGame({ seed: 27 });
    const wall = structureAt(s, 'wall', 210);
    wall.level = 1;
    wall.maxHp = BALANCE.wall.hp[1];
    wall.hp = 5;
    addCitizen(s, 'builder', 100);
    const ev = run(s, 20, [], { until: (_st, e) => e.some((x) => x.type === 'repaired') });
    expect(wall.hp).toBe(wall.maxHp);
    expect(ofType(ev, 'repaired')).toEqual([expect.objectContaining({ structureId: wall.id })]);
    expect(ofType(ev, 'hammer').length).toBeGreaterThan(0);
  });

  it('Bauaufträge haben Vorrang vor Reparaturen', () => {
    const s = createGame({ seed: 28 });
    setTownLevel(s, 1);
    const damaged = structureAt(s, 'wall', 210);
    damaged.level = 1;
    damaged.maxHp = BALANCE.wall.hp[1];
    damaged.hp = 5;
    const site = structureAt(s, 'wall', -390);
    site.construction = { toLevel: 1, progress: 0, required: BALANCE.wall.work[1] };
    const b = addCitizen(s, 'builder', 150);
    run(s, 1);
    expect(b.task).toEqual({ type: 'build', structureId: site.id });
    expect(b.x).toBeLessThan(150);
    run(s, 40, [], { until: () => site.construction === null });
    expect(site.level).toBe(1);
    // danach wird repariert
    run(s, 30, [], { until: () => damaged.hp >= damaged.maxHp });
    expect(damaged.hp).toBe(damaged.maxHp);
  });

  it('mehrere Bauleute arbeiten gemeinsam am selben Bau', () => {
    const single = createGame({ seed: 29 });
    const duo = createGame({ seed: 29 });
    for (const s of [single, duo]) {
      setTownLevel(s, 1);
      structureAt(s, 'townCenter', 0).construction = { toLevel: 2, progress: 0, required: BALANCE.townCenter.work[2] };
    }
    addCitizen(single, 'builder', 0);
    addCitizen(duo, 'builder', 0);
    addCitizen(duo, 'builder', 0);
    const t1 = stepsToFinish(single, structureAt(single, 'townCenter', 0));
    const t2 = stepsToFinish(duo, structureAt(duo, 'townCenter', 0));
    expect(t2).toBeLessThan(t1 * 0.6);
  });

  it('Schrein des Hammers: Kauf aktiviert den Bonus, Bauleute arbeiten ×1,6', () => {
    const s = createGame({ seed: 30 });
    clearCoins(s);
    const shrine = structureAt(s, 'shrine', -1780);
    s.players[0].x = -1780;
    expect(getPlayerFocus(s, 0)).toMatchObject({ action: 'activateShrine', cost: 6, labelKey: 'offer.activateShrine.hammer' });
    const ev = holdAct(s, 1.7);
    expect(ofType(ev, 'shrineActivated')).toEqual([expect.objectContaining({ shrine: 'hammer', structureId: shrine.id })]);
    expect(s.buffs.hammerShrine).toBe(true);
    expect(s.buffs.bowShrine).toBe(false);
    expect(shrine.activated).toBe(true);
    expect(getOffer(s, shrine)).toBeNull();
    expect(s.players[0].coins).toBe(0);

    // Vergleich der Bauzeit mit und ohne Bonus (Bauarbeiter startet am Arbeitsplatz)
    const plain = createGame({ seed: 31 });
    const buffed = createGame({ seed: 31 });
    buffed.buffs.hammerShrine = true;
    const times = [plain, buffed].map((g) => {
      const wall = structureAt(g, 'wall', 210);
      wall.construction = { toLevel: 1, progress: 0, required: BALANCE.wall.work[1] };
      const b = addCitizen(g, 'builder', 0);
      b.x = 210 - 7 - 6 - (b.id % 3) * 4;
      return stepsToFinish(g, wall) * SIM_DT;
    });
    expect(times[0] / times[1]).toBeGreaterThan(1.45);
    expect(times[0] / times[1]).toBeLessThan(1.75);
  });

  it('abends nur Arbeit innerhalb der Mauern, sonst Rückzug ins Dorf', () => {
    const s = createGame({ seed: 32 });
    const outside = structureAt(s, 'wall', 210);
    outside.construction = { toLevel: 1, progress: 0, required: BALANCE.wall.work[1] };
    const b = addCitizen(s, 'builder', 195);
    s.dayTime = 135;
    s.phase = 'dusk';
    run(s, 2, [], { day: false });
    expect(outside.construction?.progress).toBe(0);
    expect(b.x).toBeLessThan(195);

    // Arbeit im Dorf (Siedlungszentrum) ist abends erlaubt
    const tc = structureAt(s, 'townCenter', 0);
    tc.construction = { toLevel: 1, progress: 0, required: BALANCE.townCenter.work[1] };
    run(s, 8, [], { day: false });
    expect(tc.construction?.progress ?? tc.level).toBeGreaterThan(0);
    expect(outside.construction?.progress).toBe(0);
  });

  it('nachts wird die äußerste Mauer (Frontlinie) nicht repariert, innere Mauern schon', () => {
    const s = createGame({ seed: 34 });
    setTownLevel(s, 1);
    const inner = structureAt(s, 'wall', 210);
    const outer = structureAt(s, 'wall', 390);
    for (const w of [inner, outer]) {
      w.level = 1;
      w.maxHp = BALANCE.wall.hp[1];
      w.hp = 6;
    }
    addCitizen(s, 'builder', 250);
    s.dayTime = 152;
    s.phase = 'night';
    s.enemies.length = 0;
    run(s, 12, [], { day: false });
    expect(inner.hp).toBe(inner.maxHp);
    expect(outer.hp).toBe(6);
  });

  it('brechen spät am Tag nicht mehr zu weit entfernten Baustellen auf', () => {
    const s = createGame({ seed: 33 });
    setTownLevel(s, 1);
    const ship = structureAt(s, 'ship', -2960);
    ship.construction = { toLevel: 1, progress: 0, required: BALANCE.ship.work[1] };
    const b = addCitizen(s, 'builder', 0);
    s.dayTime = 100; // nur noch 30 s Tag, Anreise > 80 s
    run(s, 1, [], { day: false });
    expect(b.task.type).not.toBe('build');
    s.dayTime = 10; // früh am Morgen: los geht's
    run(s, 1, [], { day: false });
    expect(b.task).toEqual({ type: 'build', structureId: ship.id });
  });
});
