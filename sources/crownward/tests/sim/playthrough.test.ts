// Crownward – Durchspieltests: Ein deterministischer Bot (tests/sim/bot.ts) spielt die erste Insel nur über
// PlayerInput. Belegt werden Gewinnbarkeit, Verlierbarkeit, steigende Herausforderung, Koop und Invarianten.
import { describe, expect, it } from 'vitest';
import { BALANCE, SIM_DT, createGame, deserializeGame, serializeGame, stepGame } from '../../src/sim';
import type { GameState, PlayerInput, SimEvent } from '../../src/sim';
import { createCitizen } from '../../src/sim/world';
import { waveSize } from '../../src/sim/waves';
import { CampfireIdler, InvariantChecker, KingdomBot, Team, playGame, steer } from './bot';
import type { Controller, PlayResult } from './bot';
import { setDayTime } from './helpers-night';

// Seed 10 ist ein langsamerer Verlauf (Sieg an Tag 11, übersteht auch die zweite Fahlmondnacht mit 64 Gegnern)
const WIN_SEEDS = [1, 2, 3, 4, 5, 6, 10];
const LONG = 120_000;
// Messwerte ausgeben: PLAYTEST_REPORT=1 npx vitest run tests/sim/playthrough.test.ts (Node-Typen sind nicht eingebunden)
const node = (globalThis as { process?: { env: Record<string, string | undefined>; stdout: { write(s: string): void } } }).process;
const out = (s: string) => {
  if (node?.env.PLAYTEST_REPORT === '1') node.stdout.write(s + '\n');
};

/** Siegläufe werden von mehreren Tests ausgewertet – einmal spielen, mehrfach prüfen. */
const wins = new Map<number, PlayResult>();
function winRun(seed: number): PlayResult {
  let r = wins.get(seed);
  if (!r) {
    r = playGame({ seed, controllers: [new KingdomBot(0)], maxDays: 14, checkInvariants: true });
    wins.set(seed, r);
  }
  return r;
}

function summary(r: PlayResult): string {
  const st = r.stats;
  return (
    `${r.outcome} an Tag ${r.day}; Münzen gesammelt ${st.coinsCollected}, ausgegeben ${st.coinsSpent}; ` +
    `Gegner besiegt ${st.enemiesSlain}; Mauern verloren ${st.wallsLost}; Bürger verloren ${st.citizensLost}; ` +
    `Schiff ${r.shipStages.map((x) => `S${x.level}@T${x.day}`).join(' ')}; max. Untertanen ${r.maxCitizens}`
  );
}

describe('(a) Die erste Insel ist gewinnbar', () => {
  it.each(WIN_SEEDS)(
    'Seed %i: Sieg in 7–12 Tagen, ohne Kronverlust und ohne Invariantenverletzung',
    (seed) => {
      const r = winRun(seed);
      out(`Seed ${seed}: ${summary(r)}`);
      expect(r.violations).toEqual([]);
      expect(r.outcome).toBe('victory');
      expect(r.crownLost).toBeNull();
      expect(r.day).toBeGreaterThanOrEqual(7);
      expect(r.day).toBeLessThanOrEqual(12);
      // der Weg zum Sieg führt über alle drei Schiffsstufen und echte Nächte
      expect(r.shipStages.map((x) => x.level)).toEqual([1, 2, 3]);
      expect(r.stats.enemiesSlain).toBeGreaterThan(50);
      expect(r.stats.coinsSpent).toBeGreaterThan(120);
      expect(r.stats.coinsSpent).toBeLessThanOrEqual(r.stats.coinsCollected + BALANCE.player.startCoins);
    },
    LONG,
  );
});

describe('(b, c) Die erste Insel ist verlierbar', () => {
  it.each([1, 2, 3, 4, 5])(
    'Seed %i: wer nur am Lagerfeuer steht, verliert die Krone spätestens in der dritten Nacht',
    (seed) => {
      const r = playGame({ seed, controllers: [new CampfireIdler(0)], maxDays: 5 });
      out(`Untätig Seed ${seed}: Kronverlust ${JSON.stringify(r.crownLost)}; Nächte ${r.nights.map((n) => `N${n.night}: ${n.playerHits} Treffer/${n.coinsLostToHits} Münzen`).join(', ')}`);
      expect(r.outcome).toBe('defeat');
      expect(r.crownLost).not.toBeNull();
      expect(r.crownLost!.day).toBeLessThanOrEqual(3);
      expect(['night', 'dawn']).toContain(r.crownLost!.phase);
      // schon die erste Nacht kostet Münzen (deutliche Warnung, noch kein Kronverlust)
      expect(r.nights[0].playerHits).toBeGreaterThan(0);
      expect(r.crownLost!.day).toBeGreaterThan(1);
    },
    LONG,
  );

  it.each([1, 2, 3, 4])(
    'Seed %i: wer nachts draußen im Wald bleibt, verliert trotz gut geführten Dorfs',
    (seed) => {
      const r = playGame({ seed, controllers: [new KingdomBot(0, { nightStayX: 1500 })], maxDays: 8 });
      out(`Sorglos Seed ${seed}: ${r.outcome} Kronverlust ${JSON.stringify(r.crownLost)}`);
      expect(r.outcome).toBe('defeat');
      expect(r.crownLost!.day).toBeLessThanOrEqual(4);
    },
    LONG,
  );

  it('wer sich nachts hinter dem Nebelriss beim Schiff versteckt, findet keine Zuflucht', () => {
    const hider: Controller = { input: (s: GameState): PlayerInput => steer(s.players[0], -2960, 4, true) };
    for (const seed of [1, 2]) {
      const r = playGame({ seed, controllers: [hider], maxDays: 6 });
      expect(r.outcome).toBe('defeat');
      expect(r.crownLost!.day).toBeLessThanOrEqual(4);
    }
  });

  it.each([1, 2])(
    'Seed %i: wer an Bogenschützen spart (höchstens 4), überlebt die Insel nicht',
    (seed) => {
      const r = playGame({ seed, controllers: [new KingdomBot(0, { archerCap: 4 })], maxDays: 14 });
      out(`Sparsam Seed ${seed}: ${r.outcome} Tag ${r.day} Kronverlust ${JSON.stringify(r.crownLost)}`);
      expect(r.outcome).toBe('defeat');
    },
    LONG,
  );
});

/** Feste Verteidigung (Steinmauern ±210, Schützen je Seite) eine Nacht lang: Mauerschaden und Verluste. */
function fixedDefense(night: number, archers: number, seed: number): { damage: number; wallsLost: number; spawned: number } {
  const s = createGame({ seed });
  s.citizens = [];
  s.coins = [];
  s.rabbits = [];
  s.day = night;
  setDayTime(s, BALANCE.cycle.duskEnd - 1);
  for (const w of s.structures) {
    if (w.kind === 'wall' && Math.abs(w.x) === 210) {
      w.level = 3;
      w.maxHp = BALANCE.wall.hp[3];
      w.hp = w.maxHp;
    }
  }
  for (let i = 0; i < archers; i++) createCitizen(s, 'archer', i % 2 ? -150 : 150).side = i % 2 ? -1 : 1;
  s.players[0].x = 0;
  s.players[0].coins = 20;
  const hp = new Map(s.structures.map((q) => [q.id, q.hp]));
  const r = { damage: 0, wallsLost: 0, spawned: 0 };
  const steps = Math.round((BALANCE.cycle.length - BALANCE.cycle.duskEnd) / SIM_DT);
  for (let i = 0; i < steps; i++) {
    for (const e of stepGame(s, [], SIM_DT)) {
      if (e.type === 'wallHit') {
        r.damage += (hp.get(e.structureId) ?? e.hp) - e.hp;
        hp.set(e.structureId, e.hp);
      } else if (e.type === 'wallDestroyed') r.wallsLost++;
      else if (e.type === 'enemySpawn') r.spawned++;
    }
  }
  return r;
}

describe('(d) Die Herausforderung steigt messbar', () => {
  it('die Brut wird von Nacht zu Nacht zahlreicher; Fahlmondnächte überragen ihre Nachbarn', () => {
    const r = winRun(1);
    const spawned = r.nights.map((n) => n.spawned);
    out(`Gegner je Nacht (Seed 1): ${r.nights.map((n) => `N${n.night}${n.paleMoon ? '*' : ''} ${n.spawned}`).join(', ')}`);
    // jede Nacht kommt mindestens so viel Brut wie geplant – und mehr als in der normalen Nacht davor
    for (const n of r.nights) {
      const planned = [1, -1].reduce((a, side) => {
        const w = waveSize(n.night, side as 1 | -1);
        return a + w.mistlings + w.breakers;
      }, 0);
      expect(n.spawned).toBe(planned);
    }
    const normal = r.nights.filter((n) => !n.paleMoon).map((n) => n.spawned);
    for (let i = 1; i < normal.length; i++) expect(normal[i]).toBeGreaterThan(normal[i - 1]);
    for (const n of r.nights.filter((x) => x.paleMoon)) {
      const prev = spawned[n.night - 2];
      const next = spawned[n.night];
      expect(n.spawned).toBeGreaterThan(prev);
      if (next !== undefined) expect(n.spawned).toBeGreaterThan(next);
    }
    expect(r.nights[0].spawned).toBeLessThanOrEqual(3); // sanfter Einstieg
  });

  it('bei gleicher Verteidigung (Stein, 8 Schützen) wächst der Mauerschaden – bis die Mauern fallen', () => {
    const avg = (night: number) => {
      const rs = [1, 2, 3].map((seed) => fixedDefense(night, 8, seed));
      return { damage: rs.reduce((a, x) => a + x.damage, 0) / rs.length, lost: rs.reduce((a, x) => a + x.wallsLost, 0) };
    };
    const n = Object.fromEntries([2, 4, 5, 6, 7, 8, 10].map((k) => [k, avg(k)]));
    out(`Mauerschaden Stein/8 Schützen: ${Object.entries(n).map(([k, v]) => `N${k} ${v.damage.toFixed(0)}${v.lost ? ` (${v.lost} Mauern fielen)` : ''}`).join(', ')}`);
    expect(n[2].damage).toBe(0);
    expect(n[4].damage).toBeLessThan(n[7].damage);
    expect(n[6].damage).toBeLessThan(n[7].damage);
    expect(n[7].damage).toBeLessThan(n[8].damage);
    expect(n[5].damage).toBeGreaterThan(n[4].damage); // Fahlmond
    expect(n[5].damage).toBeGreaterThan(n[6].damage);
    expect(n[10].lost).toBeGreaterThan(0); // was Nacht 4 mühelos hält, reicht in Nacht 10 nicht mehr
  });
});

describe('(e) Lokaler Koop', () => {
  it.each([1, 2])(
    'Seed %i: zwei Bots mit Absprache (West/Ost) gewinnen gemeinsam',
    (seed) => {
      const team = new Team();
      const r = playGame({
        seed,
        coop: true,
        controllers: [new KingdomBot(0, { share: 'west', team }), new KingdomBot(1, { share: 'east', team })],
        maxDays: 14,
        checkInvariants: true,
      });
      out(`Koop Seed ${seed}: ${summary(r)}`);
      expect(r.state.players).toHaveLength(2);
      expect(r.violations).toEqual([]);
      expect(r.outcome).toBe('victory');
      expect(r.crownLost).toBeNull();
      expect(r.day).toBeLessThanOrEqual(12);
    },
    LONG,
  );

  it('ein Bot mit untätigem Partner am Feuer: stabil und gewinnbar', () => {
    const r = playGame({ seed: 3, coop: true, controllers: [new KingdomBot(0), new CampfireIdler(1)], maxDays: 14, checkInvariants: true });
    out(`Koop mit untätigem Partner: ${summary(r)}`);
    expect(r.violations).toEqual([]);
    expect(r.outcome).toBe('victory');
    expect(r.state.players.every((p) => p.hasCrown)).toBe(true);
  }, LONG);
});

/** Kleiner, schneller Hash über die Ereignisfolge (Vergleich zweier Verläufe ohne Riesen-Strings). */
function hashEvents(h: number, events: readonly SimEvent[]): number {
  const text = JSON.stringify(events);
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * Spielt durchgehend und lädt an der Stelle `at` einen Speicherstand in eine zweite Partie, die mit geklonten
 * Bots weiterläuft. Ergebnis: Endzustand und Ereignisfolge nach dem Speicherpunkt – beider Verläufe.
 */
function saveLoadBranches(seed: number, coop: boolean, at: (s: GameState) => boolean) {
  const team = coop ? new Team() : undefined;
  const bots = coop ? [new KingdomBot(0, { share: 'west', team }), new KingdomBot(1, { share: 'east', team })] : [new KingdomBot(0)];
  let saved: { text: string; bots: KingdomBot[]; events: SimEvent[]; enemies: number; day: number } | null = null;
  let hashA = 2166136261;
  const a = playGame({
    seed,
    coop,
    controllers: bots,
    maxDays: 14,
    onStep: (s, ev) => {
      if (saved) hashA = hashEvents(hashA, ev);
      else if (at(s)) {
        const t = team?.clone();
        saved = { text: serializeGame(s, '2026-10-22T12:00:00.000Z'), bots: bots.map((b) => b.clone(t)), events: [...ev], enemies: s.enemies.length, day: s.day };
      }
    },
  });
  if (!saved) throw new Error('Speicherpunkt nie erreicht');
  const sv = saved as { text: string; bots: KingdomBot[]; events: SimEvent[]; enemies: number; day: number };
  const loaded = deserializeGame(sv.text);
  if (!loaded.ok) throw new Error(loaded.error);
  let hashB = 2166136261;
  const b = playGame({ seed, state: loaded.state, controllers: sv.bots, events: sv.events, maxDays: 14, onStep: (_s, ev) => (hashB = hashEvents(hashB, ev)) });
  return { a, b, hashA, hashB, saved: sv };
}

describe('(f) Invarianten und Speichern/Laden mitten im Lauf', () => {
  it('Speichern und Laden am Vormittag von Tag 4 ändert den weiteren Verlauf nicht', () => {
    const { a, b, hashA, hashB } = saveLoadBranches(3, false, (s) => s.day === 4 && s.phase === 'day' && s.dayTime >= 60);
    expect(b.outcome).toBe(a.outcome);
    expect(b.day).toBe(a.day);
    expect(b.stats).toEqual(a.stats);
    expect(hashB).toBe(hashA);
    expect(serializeGame(b.state, '')).toBe(serializeGame(a.state, ''));
    expect(a.outcome).toBe('victory');
  }, LONG);

  it('Speichern und Laden mitten in der Fahlmondnacht (Brut auf dem Feld, Koop) ändert nichts', () => {
    const { a, b, hashA, hashB, saved } = saveLoadBranches(
      2,
      true,
      (s) => s.day === BALANCE.waves.paleMoonEvery && s.phase === 'night' && s.enemies.length >= 10,
    );
    expect(saved.enemies).toBeGreaterThanOrEqual(10);
    expect(b.outcome).toBe(a.outcome);
    expect(hashB).toBe(hashA);
    expect(serializeGame(b.state, '')).toBe(serializeGame(a.state, ''));
  }, LONG);

  it('der Invariantenprüfer schlägt bei kaputten Zuständen an', () => {
    const s = createGame({ seed: 9 });
    const ok = new InvariantChecker();
    ok.check(s, []);
    expect(ok.violations).toEqual([]);

    const bad = createGame({ seed: 9 });
    bad.players[0].coins = -1;
    bad.citizens[0].x = Number.NaN;
    bad.coins.push({ ...bad.coins[0], id: bad.citizens[1].id });
    const inv = new InvariantChecker();
    inv.check(bad, []);
    expect(inv.violations.join('\n')).toMatch(/Münzen -1/);
    expect(inv.violations.join('\n')).toMatch(/NaN-Position/);
    expect(inv.violations.join('\n')).toMatch(/doppelte ID/);
  });

  it('festhängende Bürger werden erkannt', () => {
    const s = createGame({ seed: 9 });
    const c = s.citizens[0];
    c.task = { type: 'goto', x: c.x + 500 };
    const inv = new InvariantChecker();
    for (let t = 0; t < 45; t += 0.5) {
      s.time = t;
      inv.check(s, []); // die Simulation läuft nicht: der Bürger kommt nie voran
    }
    expect(inv.violations.some((v) => v.includes('hängt fest'))).toBe(true);
  });
});
