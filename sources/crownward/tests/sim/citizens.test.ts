// Crownward – Bewohner: Rekrutierung per Münze, Werkzeuge → Rollen, Bauern ernten, Lager, Kaninchen, Flucht.
import { describe, expect, it } from 'vitest';
import { BALANCE, createGame } from '../../src/sim';
import type { GameState } from '../../src/sim';
import { demoteToVagrant } from '../../src/sim/util';
import { addCitizen, clearCoins, holdAct, IDLE, ofType, run, structureAt, tapAct } from './helpers-economy';

function setTownLevel(s: GameState, level: number): void {
  structureAt(s, 'townCenter', 0).level = level;
}

describe('Rekrutierung', () => {
  it('fallengelassene Münze → Landstreicher läuft hin, kniet, wird Dorfbewohner', () => {
    const s = createGame({ seed: 41 });
    clearCoins(s);
    const p = s.players[0];
    p.x = 90; // außerhalb aller Angebotsreichweiten
    p.facing = -1;
    const vagrants = s.citizens.filter((c) => c.role === 'vagrant');
    expect(vagrants).toHaveLength(2);
    const east = vagrants.find((c) => c.x > 0)!;

    const drop = tapAct(s);
    expect(ofType(drop, 'coinDrop')).toHaveLength(1);
    let knelt = false;
    const ev = run(s, 6, () => {
      if (east.anim === 'kneel') knelt = true;
      return [IDLE];
    });
    expect(knelt).toBe(true);
    expect(east.role).toBe('villager');
    expect(east.campId).toBeNull();
    expect(ofType(ev, 'recruit')).toEqual([expect.objectContaining({ citizenId: east.id })]);
    expect(s.stats.recruited).toBe(1);
    expect(s.coins).toHaveLength(0);
    expect(p.coins).toBe(5); // Münze ging an den Landstreicher, nicht zurück an die Spielerin
    // der andere bleibt Landstreicher am Lagerfeuer
    const west = vagrants.find((c) => c !== east)!;
    expect(west.role).toBe('vagrant');
  });

  it.each([
    { x: 88, facing: 1 as const },
    { x: -88, facing: -1 as const },
    { x: -95, facing: 1 as const },
  ])('Lagerfeuer-Landstreicher lassen sich knapp außerhalb der Angebote rekrutieren (x=$x, Blick $facing)', ({ x, facing }) => {
    const s = createGame({ seed: 40 });
    clearCoins(s);
    run(s, 3); // Landstreicher beziehen ihren Platz am Feuer
    const p = s.players[0];
    p.x = x;
    p.facing = facing;
    expect(ofType(tapAct(s), 'coinDrop')).toHaveLength(1);
    run(s, 6);
    expect(s.stats.recruited).toBe(1);
    const recruitedSide = s.citizens.find((c) => c.role === 'villager')!.side;
    expect(recruitedSide).toBe(x < 0 ? -1 : 1);
  });

  it('Landstreicher ohne Münze in Reichweite bleiben am Lagerfeuer', () => {
    const s = createGame({ seed: 42 });
    run(s, 30);
    for (const c of s.citizens.filter((c) => c.campId === null)) {
      expect(c.role).toBe('vagrant');
      expect(Math.abs(c.x)).toBeLessThanOrEqual(75);
    }
  });

  it('zwei Landstreicher streiten nicht um dieselbe Münze', () => {
    const s = createGame({ seed: 43 });
    clearCoins(s);
    const a = s.citizens[0];
    const b = s.citizens[1];
    a.x = 900;
    b.x = 960;
    // eine Münze zwischen beiden fallen lassen, dann die Spielerin weit weg teleportieren
    s.players[0].x = 940;
    s.players[0].facing = -1;
    tapAct(s);
    expect(s.coins).toHaveLength(1);
    s.players[0].x = 2500;
    run(s, 6);
    const recruited = [a, b].filter((c) => c.role === 'villager');
    expect(recruited).toHaveLength(1);
    expect(s.stats.recruited).toBe(1);
  });
});

describe('Werkzeuge und Rollen', () => {
  it('Hammer kaufen → Dorfbewohner holt ihn und wird Baumeister (je Werkzeug nur einer)', () => {
    const s = createGame({ seed: 44 });
    clearCoins(s);
    const v1 = addCitizen(s, 'villager', 10);
    const v2 = addCitizen(s, 'villager', 20);
    const stand = structureAt(s, 'toolStand', -46);
    s.players[0].x = -46;
    const buy = holdAct(s, 1);
    expect(ofType(buy, 'purchase')).toEqual([expect.objectContaining({ action: 'buyTool', cost: 3 })]);
    expect(stand.stock).toBe(1);

    const ev = run(s, 5);
    expect(stand.stock).toBe(0);
    const builders = [v1, v2].filter((c) => c.role === 'builder');
    expect(builders).toHaveLength(1);
    expect([v1, v2].filter((c) => c.role === 'villager')).toHaveLength(1);
    expect(ofType(ev, 'roleChange')).toEqual([expect.objectContaining({ role: 'builder', citizenId: builders[0].id })]);
  });

  it('Bogen → Bogenschütze, Sense → Bauer', () => {
    const s = createGame({ seed: 45 });
    setTownLevel(s, 1);
    const bow = structureAt(s, 'toolStand', 46);
    const scythe = structureAt(s, 'toolStand', -82);
    bow.stock = 1;
    scythe.stock = 1;
    const a = addCitizen(s, 'villager', 40);
    const b = addCitizen(s, 'villager', -70);
    const ev = run(s, 5);
    expect(a.role).toBe('archer');
    expect(b.role).toBe('farmer');
    expect(bow.stock).toBe(0);
    expect(scythe.stock).toBe(0);
    expect(ofType(ev, 'roleChange').map((e) => e.role).sort()).toEqual(['archer', 'farmer']);
  });

  it('frisch rekrutierte Dorfbewohner gehen ins Dorf und bummeln dort', () => {
    const s = createGame({ seed: 46 });
    const v = addCitizen(s, 'villager', 600);
    run(s, 30);
    expect(Math.abs(v.x)).toBeLessThanOrEqual(80);
  });
});

describe('Bauern', () => {
  it('belegen freie Feldplätze (höchstens 2) und ernten Münzen am Feld', () => {
    const s = createGame({ seed: 47 });
    s.citizens.length = 0; // keine Landstreicher, die Erntemünzen aufsammeln
    clearCoins(s);
    setTownLevel(s, 1);
    const farm = structureAt(s, 'farm', 120);
    farm.level = 1;
    const f1 = addCitizen(s, 'farmer', 100);
    const f2 = addCitizen(s, 'farmer', 105);
    const f3 = addCitizen(s, 'farmer', 110);
    s.players[0].x = -400; // weit weg, sammelt nichts ein

    const ev = run(s, BALANCE.farmers.harvestInterval + 4);
    expect(farm.occupants).toHaveLength(BALANCE.farmers.perFarm);
    expect(farm.occupants).toEqual(expect.arrayContaining([f1.id, f2.id]));
    expect(f3.task.type).not.toBe('farm');
    expect(f1.anim).toBe('work');
    const harvests = ofType(ev, 'harvest');
    expect(harvests).toHaveLength(2);
    expect(harvests.every((h) => h.structureId === farm.id)).toBe(true);
    expect(s.coins).toHaveLength(2);
    for (const c of s.coins) expect(Math.abs(c.x - farm.x)).toBeLessThan(40);
  });

  it('ziehen sich abends ins Zentrum zurück', () => {
    const s = createGame({ seed: 48 });
    s.citizens.length = 0;
    setTownLevel(s, 1);
    const farm = structureAt(s, 'farm', 120);
    farm.level = 1;
    const f = addCitizen(s, 'farmer', 110);
    run(s, 3);
    expect(farm.occupants).toEqual([f.id]);
    s.dayTime = 132;
    s.phase = 'dusk';
    const ev = run(s, 4, [], { day: false });
    expect(farm.occupants).toEqual([]);
    expect(f.x).toBeLessThan(110);
    expect(ofType(ev, 'harvest')).toHaveLength(0);
  });
});

describe('Lager und Flucht', () => {
  it('Lager bringen tagsüber Landstreicher hervor – bis zur Obergrenze', () => {
    const s = createGame({ seed: 49 });
    const camps = s.structures.filter((st) => st.kind === 'camp');
    expect(camps).toHaveLength(4);
    const first = run(s, 6);
    expect(ofType(first, 'vagrantSpawn')).toHaveLength(camps.length);
    run(s, 100);
    for (const camp of camps) {
      const own = s.citizens.filter((c) => c.campId === camp.id);
      expect(own).toHaveLength(BALANCE.camps.cap);
      for (const c of own) {
        expect(c.role).toBe('vagrant');
        expect(Math.abs(c.x - camp.x)).toBeLessThanOrEqual(50);
      }
    }
  });

  it('nachts ruhen die Lager', () => {
    const s = createGame({ seed: 50 });
    s.dayTime = 160;
    s.phase = 'night';
    const ev = run(s, 20, [], { day: false });
    expect(ofType(ev, 'vagrantSpawn')).toHaveLength(0);
  });

  it('getroffene Bürger fliehen als Landstreicher zum nächsten Lager und bleiben dort', () => {
    const s = createGame({ seed: 51 });
    const b = addCitizen(s, 'builder', 300);
    demoteToVagrant(s, b);
    expect(b.role).toBe('vagrant');
    expect(b.task.type).toBe('flee');
    const camp = s.structures.find((st) => st.id === b.campId)!;
    expect(camp.x).toBe(1250);
    run(s, 0.5);
    expect(b.anim).toBe('flee');
    expect(b.vx).toBeCloseTo(BALANCE.citizens.speed.vagrant * BALANCE.citizens.fleeMult, 5);
    run(s, 40, [], { until: () => b.task.type !== 'flee' });
    expect(b.task.type).not.toBe('flee');
    expect(b.stunned).toBe(0);
    expect(Math.abs(b.x - camp.x)).toBeLessThan(2);
    run(s, 20);
    expect(b.role).toBe('vagrant');
    expect(Math.abs(b.x - camp.x)).toBeLessThanOrEqual(50);
  });
});

describe('Kaninchen', () => {
  it('erscheinen tagsüber außerhalb der Mauern in ihren Zonen, höchstens rabbits.max', () => {
    const s = createGame({ seed: 52 });
    const R = BALANCE.rabbits;
    const seen = new Set<number>();
    const spawnX: number[] = [];
    run(s, 200, (st) => {
      for (const r of st.rabbits) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          spawnX.push(r.x);
        }
      }
      expect(st.rabbits.length).toBeLessThanOrEqual(R.max);
      return [IDLE];
    });
    expect(spawnX.length).toBeGreaterThanOrEqual(3);
    for (const x of spawnX) {
      expect(Math.abs(x)).toBeGreaterThanOrEqual(R.zoneMin);
      expect(Math.abs(x)).toBeLessThanOrEqual(R.zoneMax);
    }
  });

  it('fliehen vor der Herrscherin und vor Bürgern', () => {
    const s = createGame({ seed: 53 });
    s.rabbits.push({ id: 9999, x: 1000, vx: 0, facing: 1, state: 'idle', timer: 5 });
    s.players[0].x = 970;
    run(s, 0.1);
    const r = s.rabbits.find((k) => k.id === 9999)!;
    expect(r.state).toBe('flee');
    expect(r.vx).toBeGreaterThan(0);
    expect(r.x).toBeGreaterThan(1000);

    s.players[0].x = -1500;
    const c = addCitizen(s, 'villager', r.x + 30);
    c.stunned = 10; // steht still
    run(s, 0.1);
    expect(r.vx).toBeLessThan(0);
  });

  it('nachts entstehen keine neuen Kaninchen, vorhandene bleiben', () => {
    const s = createGame({ seed: 54 });
    s.rabbits.push({ id: 9998, x: 1500, vx: 0, facing: 1, state: 'idle', timer: 1 });
    s.dayTime = 152;
    s.phase = 'night';
    run(s, 30, [], { day: false });
    expect(s.rabbits.map((r) => r.id)).toEqual([9998]);
  });
});
