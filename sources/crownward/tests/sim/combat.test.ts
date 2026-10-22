// Kampf: Mauern beschädigen/zerstören, Blockade, Bogenschützen (Stellung, Türme, Reichweite, Jagd), Pfeile, Bürgertreffer.
import { describe, expect, it } from 'vitest';
import { BALANCE, SIM_DT } from '../../src/sim';
import type { GameState } from '../../src/sim';
import { aimArrow, archerRange, archerReload, BOW_HEIGHT } from '../../src/sim/archers';
import { ENEMY_HEIGHT, spawnEnemy } from '../../src/sim/enemies';
import {
  addCitizen,
  emptyStage,
  newGame,
  ofType,
  parkPlayers,
  quietNight,
  setDayTime,
  setTower,
  setWall,
  structureAt,
  tickNight,
} from './helpers-night';

/** Nacht ohne automatische Welle, leere Bühne, Spieler weit im Westen. */
function arena(): GameState {
  const s = emptyStage(newGame());
  quietNight(s);
  parkPlayers(s, -1800);
  return s;
}

describe('Mauern und Nebelbrut', () => {
  it('Mistling beschädigt eine Palisade im Angriffstakt und wird von ihr aufgehalten', () => {
    const s = arena();
    const wall = setWall(s, 210, 2);
    expect(wall.hp).toBe(36);
    const m = spawnEnemy(s, 'mistling', 1, 300);
    const hitTimes: number[] = [];
    let minX = Infinity;
    tickNight(s, 10, undefined, (ev) => {
      minX = Math.min(minX, m.x);
      for (const h of ofType(ev, 'wallHit')) {
        expect(h.structureId).toBe(wall.id);
        hitTimes.push(s.time);
      }
    });
    expect(hitTimes.length).toBeGreaterThanOrEqual(10);
    expect(wall.hp).toBe(36 - hitTimes.length);
    expect(wall.level).toBe(2);
    // Takt: attackInterval
    for (let i = 1; i < hitTimes.length; i++) expect(hitTimes[i] - hitTimes[i - 1]).toBeCloseTo(BALANCE.enemies.mistling.attackInterval, 1);
    // nie durch die Mauer: bleibt vor der Mauerfront
    expect(minX).toBeGreaterThan(wall.x + wall.width / 2);
    expect(m.state).toBe('attackWall');
    expect(m.targetKind).toBe('structure');
    expect(m.anim).toBe('attack');
  });

  it('Brecher zerstört eine Mauer (Stufe → 0) und zieht dann weiter', () => {
    const s = arena();
    const wall = setWall(s, 210, 2);
    wall.construction = { toLevel: 3, progress: 2, required: 16 }; // laufender Ausbau geht mit verloren …
    const b = spawnEnemy(s, 'breaker', 1, 240);
    const ev = tickNight(s, 15);
    const destroyed = ofType(ev, 'wallDestroyed');
    expect(destroyed).toEqual([{ type: 'wallDestroyed', x: 210, structureId: wall.id }]);
    expect(wall.level).toBe(0);
    expect(wall.hp).toBe(0);
    expect(wall.construction).toBeNull();
    expect(s.stats.wallsLost).toBe(1);
    // … aber seine Münzen fallen dorfseitig in die Trümmer
    expect(s.coins).toHaveLength(BALANCE.wall.cost[3]);
    for (const c of s.coins) expect(c.x).toBeLessThan(wall.x);
    // 36 HP in Schlägen zu je wallDamage (Palisade, Brecher)
    const dmg = BALANCE.enemies.breaker.wallDamage;
    const hits = ofType(ev, 'wallHit');
    const expected: number[] = [];
    for (let hp = BALANCE.wall.hp[2] - dmg; ; hp -= dmg) {
      expected.push(Math.max(0, hp));
      if (hp <= 0) break;
    }
    expect(hits).toHaveLength(Math.ceil(BALANCE.wall.hp[2] / dmg));
    expect(hits.map((h) => h.hp)).toEqual(expected);
    // ohne Mauer weiter Richtung Zentrum
    expect(b.x).toBeLessThan(wall.x);
  });

  it('Mauern schützen Bürger und Herrscher dahinter', () => {
    const s = arena();
    setWall(s, 210, 3);
    const builder = addCitizen(s, 'builder', 204);
    s.players[0].x = 200;
    s.players[0].coins = 0;
    spawnEnemy(s, 'mistling', 1, 260);
    const ev = tickNight(s, 6);
    expect(ofType(ev, 'citizenHit')).toHaveLength(0);
    expect(ofType(ev, 'playerHit')).toHaveLength(0);
    expect(ofType(ev, 'wallHit').length).toBeGreaterThan(5);
    expect(builder.role).toBe('builder');
    expect(s.outcome).toBe('playing');
  });

  it('Mistling schlägt einen Bauarbeiter: Werkzeug gestohlen, Landstreicher, Flucht bis zum Riss', () => {
    const s = arena();
    const c = addCitizen(s, 'builder', 300);
    const m = spawnEnemy(s, 'mistling', 1, 330);
    const ev = tickNight(s, 3);
    expect(ofType(ev, 'citizenHit')).toEqual([{ type: 'citizenHit', x: c.x, citizenId: c.id, role: 'builder' }]);
    expect(c.role).toBe('vagrant');
    expect(c.task.type).toBe('flee');
    expect(s.stats.citizensLost).toBe(1);
    expect(m.carrying).toBe('tool');
    expect(m.state).toBe('flee');
    expect(m.anim).toBe('flee');
    // flieht zurück zum Ostriss und verschwindet dort
    const later = tickNight(s, 20);
    const escaped = ofType(later, 'enemyEscaped');
    expect(escaped).toHaveLength(1);
    expect(escaped[0]).toMatchObject({ kind: 'mistling', carrying: 'tool' });
    expect(Math.abs(escaped[0].x - structureAt(s, 'rift', 2700).x)).toBeLessThanOrEqual(6);
    expect(s.enemies).toHaveLength(0);
  });

  it('Dorfbewohner ohne Werkzeug: Mistling stiehlt nichts und greift weiter an; Landstreicher werden ignoriert', () => {
    const s = arena();
    const v = addCitizen(s, 'villager', 300);
    const tramp = addCitizen(s, 'vagrant', 320);
    const m = spawnEnemy(s, 'mistling', 1, 330);
    const ev = tickNight(s, 2);
    expect(ofType(ev, 'citizenHit').map((e) => e.citizenId)).toEqual([v.id]);
    expect(tramp.role).toBe('vagrant');
    expect(m.carrying).toBeNull();
    expect(m.state).not.toBe('flee');
  });
});

describe('Bogenschützen', () => {
  it('verteilen sich ausgeglichen auf beide Seiten', () => {
    const s = emptyStage(newGame());
    parkPlayers(s, 0);
    const archers = [40, 50, 60, 70, 80].map((x) => addCitizen(s, 'archer', x, 1));
    tickNight(s, SIM_DT);
    const west = archers.filter((a) => a.side === -1).length;
    const east = archers.filter((a) => a.side === 1).length;
    expect(west + east).toBe(5);
    expect(Math.abs(west - east)).toBeLessThanOrEqual(1);
  });

  it('beziehen ab Abend Stellung: freier Turmplatz, sonst gestaffelt hinter der äußersten Mauer', () => {
    const s = emptyStage(newGame());
    parkPlayers(s, 0);
    setDayTime(s, BALANCE.cycle.dayEnd + 1); // Abend
    setWall(s, 210, 2);
    const outer = setWall(s, 390, 1);
    const tower = setTower(s, 310, 1); // 1 Platz
    const a1 = addCitizen(s, 'archer', 100, 1);
    const a2 = addCitizen(s, 'archer', 120, 1);
    const a3 = addCitizen(s, 'archer', 140, 1);
    const w1 = addCitizen(s, 'archer', -100, -1);
    const w2 = addCitizen(s, 'archer', -120, -1);
    const w3 = addCitizen(s, 'archer', -140, -1);
    tickNight(s, 12);
    expect(s.phase).toBe('dusk');
    // genau einer im Turm
    expect(tower.occupants).toHaveLength(1);
    const inTower = [a1, a2, a3].find((a) => a.id === tower.occupants![0])!;
    expect(inTower.x).toBe(tower.x);
    // die anderen hinter der äußersten Ostmauer, gestaffelt
    const posts = [a1, a2, a3].filter((a) => a !== inTower).map((a) => a.x).sort((p, q) => q - p);
    expect(posts[0]).toBeCloseTo(outer.x - BALANCE.archers.guardOffset, 5);
    expect(posts[1]).toBeLessThan(posts[0]);
    expect(posts[1]).toBeGreaterThan(posts[0] - 40);
    // Westen ohne Mauer: am Lagerrand
    for (const w of [w1, w2, w3]) {
      expect(w.x).toBeLessThan(0);
      expect(w.x).toBeGreaterThanOrEqual(-BALANCE.world.campRadius);
    }
    for (const a of [a1, a2, a3, w1, w2, w3]) expect(a.task.type).toBe('guard');
  });

  it('verlassen den Turm, wenn er nicht mehr existiert, und tagsüber zur Jagd', () => {
    const s = emptyStage(newGame());
    parkPlayers(s, 0);
    quietNight(s);
    setWall(s, 390, 2);
    const tower = setTower(s, 310, 1);
    const a = addCitizen(s, 'archer', 300, 1);
    tickNight(s, 2);
    expect(tower.occupants).toEqual([a.id]);
    tower.level = 0; // Turm weg
    tickNight(s, 4);
    expect(tower.occupants).toEqual([]);
    expect(a.task).toMatchObject({ type: 'guard', towerId: null });
    expect(a.x).toBeCloseTo(390 - BALANCE.archers.guardOffset, 5);
    // wieder aufgebaut → zurück in den Turm; am Tag wieder hinaus
    tower.level = 1;
    tickNight(s, 4);
    expect(tower.occupants).toEqual([a.id]);
    setDayTime(s, 10);
    tickNight(s, 1);
    expect(tower.occupants).toEqual([]);
    expect(a.task.type).not.toBe('guard');
  });

  it('töten einen anrückenden Mistling, bevor er die Mauer erreicht', () => {
    const s = arena();
    const wall = setWall(s, 210, 1);
    addCitizen(s, 'archer', 180, 1);
    const m = spawnEnemy(s, 'mistling', 1, 450);
    const ev = tickNight(s, 10);
    expect(ofType(ev, 'arrowFired').length).toBeGreaterThanOrEqual(2);
    expect(ofType(ev, 'enemyHit').length).toBe(2);
    expect(ofType(ev, 'enemyDied')).toEqual([{ type: 'enemyDied', x: expect.any(Number), kind: 'mistling' }]);
    expect(s.enemies).not.toContain(m);
    expect(s.stats.enemiesSlain).toBe(1);
    expect(ofType(ev, 'wallHit')).toHaveLength(0);
    expect(wall.hp).toBe(14);
  });

  it('getötete Diebe lassen die gestohlene Münze fallen', () => {
    const s = arena();
    addCitizen(s, 'archer', 180, 1);
    const m = spawnEnemy(s, 'mistling', 1, 260);
    m.carrying = 'coin';
    m.state = 'flee';
    m.hp = 1;
    const ev = tickNight(s, 4);
    expect(ofType(ev, 'enemyDied')).toHaveLength(1);
    expect(s.coins).toHaveLength(1);
  });

  it('schießen aus dem Turm weiter als vom Boden', () => {
    const range = BALANCE.archers.range;
    const bonus = BALANCE.archers.towerRangeBonus;
    const firstShotDistance = (withTower: boolean) => {
      const s = arena();
      setWall(s, 390, 3);
      if (withTower) setTower(s, 310, 1);
      const a = addCitizen(s, 'archer', 310, 1);
      if (!withTower) a.x = 372; // Bodenposten an der Mauer
      tickNight(s, 1); // Stellung beziehen
      const e = spawnEnemy(s, 'breaker', 1, a.x + range + bonus - 5);
      let dist: number | null = null;
      tickNight(s, 8, undefined, (ev) => {
        if (dist === null && ofType(ev, 'arrowFired').length > 0) dist = Math.abs(e.x - a.x);
      });
      return dist as number | null;
    };
    const fromTower = firstShotDistance(true);
    const fromGround = firstShotDistance(false);
    expect(fromTower).not.toBeNull();
    expect(fromTower!).toBeGreaterThan(range);
    expect(fromTower!).toBeLessThanOrEqual(range + bonus);
    expect(fromGround).not.toBeNull();
    expect(fromGround!).toBeLessThanOrEqual(range);
  });

  it('im Turm sind Bogenschützen für die Brut unerreichbar', () => {
    const s = arena();
    const tower = setTower(s, 310, 1);
    const a = addCitizen(s, 'archer', 310, 1);
    tickNight(s, 0.5);
    expect(tower.occupants).toEqual([a.id]);
    spawnEnemy(s, 'mistling', 1, 318);
    const ev = tickNight(s, 2);
    expect(ofType(ev, 'citizenHit')).toHaveLength(0);
    expect(a.role).toBe('archer');
  });

  it('Schrein des Bogens: +30 % Reichweite, −25 % Nachladezeit', () => {
    const s = newGame();
    expect(archerRange(s, false)).toBe(160);
    expect(archerRange(s, true)).toBe(230);
    expect(archerReload(s)).toBeCloseTo(1.4, 6);
    s.buffs.bowShrine = true;
    expect(archerRange(s, false)).toBeCloseTo(208, 6);
    expect(archerRange(s, true)).toBeCloseTo(299, 6);
    expect(archerReload(s)).toBeCloseTo(1.05, 6);
  });

  it('jagen tagsüber Kaninchen vor der Mauer: Treffer → Münze', () => {
    const s = emptyStage(newGame());
    parkPlayers(s, 0);
    setDayTime(s, 40);
    setWall(s, 210, 1);
    addCitizen(s, 'archer', 190, 1);
    s.rabbits.push({ id: 9001, x: 380, vx: 0, facing: 1, state: 'idle', timer: 5 });
    const ev = tickNight(s, 6);
    expect(ofType(ev, 'rabbitKilled')).toEqual([{ type: 'rabbitKilled', x: 380 }]);
    expect(ofType(ev, 'arrowHit').some((e) => e.target === 'rabbit')).toBe(true);
    expect(s.rabbits).toHaveLength(0);
    expect(s.coins).toHaveLength(1);
    expect(Math.abs(s.coins[0].x - 380)).toBeLessThan(5);
  });

  it('gehen zur Jagd höchstens ~300 px vor die äußerste Mauer', () => {
    const s = emptyStage(newGame());
    parkPlayers(s, 0);
    setDayTime(s, 40);
    setWall(s, 210, 1);
    const a = addCitizen(s, 'archer', 450, 1);
    s.rabbits.push({ id: 9002, x: 660, vx: 0, facing: 1, state: 'idle', timer: 5 });
    let maxX = -Infinity;
    const ev = tickNight(s, 10, undefined, () => {
      maxX = Math.max(maxX, a.x);
    });
    expect(maxX).toBeLessThanOrEqual(210 + BALANCE.archers.huntBeyond + 1e-6);
    expect(ofType(ev, 'rabbitKilled')).toHaveLength(1);
    // ohne Beute: Patrouille kurz hinter der eigenen Mauer
    tickNight(s, 20);
    expect(a.x).toBeLessThanOrEqual(210);
    expect(a.x).toBeGreaterThan(210 - 80);
  });
});

describe('Pfeile', () => {
  it('ballistische Zielberechnung trifft auch bewegte Ziele (mit Vorhalt)', () => {
    const g = BALANCE.archers.arrowGravity;
    for (const [x0, y0, tx, ty, tvx] of [
      [0, BOW_HEIGHT, 150, 7, -34],
      [0, BOW_HEIGHT, -120, 7, 20],
      [0, 60, 220, 18, -20],
      [0, 60, 290, 7, -34], // außerhalb der ballistischen Reichweite → schneller Pfeil
      [0, BOW_HEIGHT, 12, 7, 0],
    ]) {
      const { vx, vy } = aimArrow(x0, y0, tx, ty, tvx);
      let x = x0;
      let y = y0;
      let vyy = vy;
      let ex = tx;
      let best = Infinity;
      for (let t = 0; t < 3; t += SIM_DT) {
        vyy -= g * SIM_DT;
        x += vx * SIM_DT;
        y += vyy * SIM_DT;
        ex += tvx * SIM_DT;
        best = Math.min(best, Math.hypot(x - ex, y - ty));
        if (y < 0) break;
      }
      expect(best).toBeLessThan(4);
    }
  });

  it('Pfeile stecken im Boden und verschwinden kurz danach', () => {
    const s = emptyStage(newGame());
    s.arrows.push({ id: 1, x: 0, y: 10, vx: 50, vy: 0, damage: 1, life: 4, stuck: false });
    const ev = tickNight(s, 0.5);
    expect(ofType(ev, 'arrowHit')).toEqual([{ type: 'arrowHit', x: expect.any(Number), y: 0, target: 'ground' }]);
    expect(s.arrows[0].stuck).toBe(true);
    tickNight(s, 2);
    expect(s.arrows).toHaveLength(0);
  });

  it('treffen Brecher höher als Mistlinge', () => {
    const s = arena();
    const b = spawnEnemy(s, 'breaker', 1, 500);
    const m = spawnEnemy(s, 'mistling', 1, 600);
    const y = (ENEMY_HEIGHT.mistling + ENEMY_HEIGHT.breaker) / 2; // über dem Mistling, im Brecher
    s.arrows.push({ id: 1, x: 497, y, vx: 0, vy: 0, damage: 1, life: 4, stuck: false });
    s.arrows.push({ id: 2, x: 597, y, vx: 0, vy: 0, damage: 1, life: 4, stuck: false });
    const ev = tickNight(s, SIM_DT);
    expect(ofType(ev, 'enemyHit').map((e) => e.enemyId)).toEqual([b.id]);
    expect(b.hp).toBe(BALANCE.enemies.breaker.hp - 1);
    expect(b.hitFlash).toBeGreaterThan(0);
    expect(m.hp).toBe(BALANCE.enemies.mistling.hp);
  });
});
