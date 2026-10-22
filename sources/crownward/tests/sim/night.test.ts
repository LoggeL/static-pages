// Wellen der Nebelbrut: Stärke je Nacht, Fahlmond, Spawns an beiden Rissen, Ankunft vor dem Morgengrauen, Speicherbarkeit.
import { describe, expect, it } from 'vitest';
import { BALANCE, deserializeGame, serializeGame } from '../../src/sim';
import type { GameState } from '../../src/sim';
import { enemyInFog, riftX, spawnEnemy } from '../../src/sim/enemies';
import { planWave, waveSequence, waveSize } from '../../src/sim/waves';
import { emptyStage, newGame, ofType, parkPlayers, runGame, setDayTime, setWall, tickNight } from './helpers-night';

const C = BALANCE.cycle;
const NIGHT = C.nightEnd - C.duskEnd;
const total = (n: number) => {
  const e = waveSize(n, 1);
  const w = waveSize(n, -1);
  return e.mistlings + e.breakers + w.mistlings + w.breakers;
};

/** Spielstand kurz vor Nachtbeginn von Nacht n. */
function beforeNight(n: number, seed = 4242): GameState {
  const s = emptyStage(newGame({ seed }));
  s.day = n;
  setDayTime(s, C.duskEnd - 0.5);
  return s;
}

describe('Wellen', () => {
  it('folgt der Formel aus dem Design (pro Seite)', () => {
    // Mistlinge round(2 + 1,5·(n−1)), Brecher ab Nacht 3: floor((n−3)/2)+1; Westen ab Nacht 2
    expect(waveSize(1, 1)).toEqual({ mistlings: 2, breakers: 0 });
    expect(waveSize(1, -1)).toEqual({ mistlings: 0, breakers: 0 });
    expect(waveSize(2, 1)).toEqual({ mistlings: 4, breakers: 0 });
    expect(waveSize(2, -1)).toEqual({ mistlings: 4, breakers: 0 });
    expect(waveSize(3, 1)).toEqual({ mistlings: 5, breakers: 1 });
    expect(waveSize(4, -1)).toEqual({ mistlings: 7, breakers: 1 });
    // Fahlmond: round(8 · 1,7) = 14 Mistlinge, 2 + 1 Brecher
    expect(waveSize(5, 1)).toEqual({ mistlings: 14, breakers: 3 });
    expect(waveSize(6, 1)).toEqual({ mistlings: 10, breakers: 2 });
    expect(waveSize(0, 1)).toEqual({ mistlings: 0, breakers: 0 });
  });

  it('wird von Nacht zu Nacht stärker; Fahlmond übertrifft die Nachbarnächte', () => {
    for (let n = 1; n < 12; n++) {
      if (n % BALANCE.waves.paleMoonEvery === 0 || (n + 1) % BALANCE.waves.paleMoonEvery === 0) continue;
      expect(total(n + 1)).toBeGreaterThan(total(n));
    }
    expect(total(5)).toBeGreaterThan(total(4));
    expect(total(5)).toBeGreaterThan(total(6));
    expect(total(10)).toBeGreaterThan(total(11));
  });

  it('greift im Westen erst ab westFrom an', () => {
    const old = BALANCE.waves.westFrom;
    try {
      BALANCE.waves.westFrom = 3;
      expect(waveSize(2, -1)).toEqual({ mistlings: 0, breakers: 0 });
      expect(waveSize(2, 1).mistlings).toBe(4);
      expect(waveSize(3, -1).mistlings).toBe(5);
    } finally {
      BALANCE.waves.westFrom = old;
    }
  });

  it('stellt Brecher früh in die Reihenfolge (sie sind langsam)', () => {
    expect(waveSequence({ mistlings: 2, breakers: 1 })).toEqual(['mistling', 'breaker', 'mistling']);
    const seq = waveSequence({ mistlings: 12, breakers: 3 });
    expect(seq).toHaveLength(15);
    expect(seq.lastIndexOf('breaker')).toBeLessThan(seq.length / 2);
  });

  it('plant beide Risse, sortiert, innerhalb der Nacht und deterministisch', () => {
    const a = planWave(newGame({ seed: 7 }), 5);
    const b = planWave(newGame({ seed: 7 }), 5);
    expect(a).toEqual(b);
    expect(a.night).toBe(5);
    expect(a.paleMoon).toBe(true);
    expect(a.pending).toHaveLength(total(5));
    expect(a.pending.filter((p) => p.side === 1)).toHaveLength(17);
    expect(a.pending.filter((p) => p.side === -1)).toHaveLength(17);
    for (let i = 1; i < a.pending.length; i++) expect(a.pending[i].at).toBeGreaterThanOrEqual(a.pending[i - 1].at);
    const last = a.pending[a.pending.length - 1].at;
    expect(a.pending[0].at).toBeGreaterThanOrEqual(BALANCE.waves.spawnStart - 1);
    expect(last).toBeLessThanOrEqual(BALANCE.waves.spawnStart + BALANCE.waves.spawnWindow + BALANCE.waves.spawnInterval);
    expect(last).toBeLessThan(NIGHT);
    // anderer Seed → andere Streuung
    expect(planWave(newGame({ seed: 8 }), 5)).not.toEqual(a);
  });

  it('lässt die Welle bei Nachtbeginn an beiden Rissen erscheinen (einmal je Nacht)', () => {
    const s = beforeNight(3);
    parkPlayers(s, 0);
    const ev = tickNight(s, 25);
    const spawns = ofType(ev, 'enemySpawn');
    expect(s.wave.night).toBe(3);
    expect(spawns).toHaveLength(total(3));
    expect(s.wave.pending).toHaveLength(0);
    const east = spawns.filter((e) => e.side === 1);
    const west = spawns.filter((e) => e.side === -1);
    expect(east).toHaveLength(6);
    expect(west).toHaveLength(6);
    expect(east.filter((e) => e.kind === 'breaker')).toHaveLength(1);
    for (const e of east) expect(Math.abs(e.x - riftX(s, 1))).toBeLessThanOrEqual(15);
    for (const e of west) expect(Math.abs(e.x - riftX(s, -1))).toBeLessThanOrEqual(15);
    // weiterlaufen in derselben Nacht plant nicht neu
    const more = tickNight(s, 10);
    expect(ofType(more, 'enemySpawn')).toHaveLength(0);
  });

  it('Gegner erreichen die Mauern beider Seiten vor dem Morgengrauen, Mauern halten sie auf', () => {
    const s = beforeNight(BALANCE.waves.westFrom); // erste Nacht mit Angriffen von beiden Seiten
    parkPlayers(s, 0);
    // sehr hohe HP: hier geht es ums Aufhalten, Zerstören prüft combat.test.ts
    const west = setWall(s, -210, 3, 9999);
    const east = setWall(s, 210, 3, 9999);
    let breached = false;
    const firstHit: Record<string, number> = {};
    const ev = tickNight(s, NIGHT + 1, undefined, (step) => {
      for (const e of s.enemies) if (Math.abs(e.x) < 210 + 7) breached = true;
      for (const h of ofType(step, 'wallHit')) firstHit[h.structureId] ??= s.dayTime;
    });
    expect(breached).toBe(false);
    expect(firstHit[east.id]).toBeDefined();
    expect(firstHit[west.id]).toBeDefined();
    // genug Zeit für einen echten Kampf: erste Treffer deutlich vor dem Morgengrauen
    expect(firstHit[east.id]).toBeLessThan(C.nightEnd - 10);
    expect(firstHit[west.id]).toBeLessThan(C.nightEnd - 10);
    expect(ofType(ev, 'wallHit').length).toBeGreaterThan(10);
    expect(s.phase).toBe('dawn');
    expect(s.enemies).toHaveLength(0);
  });

  it('ohne Mauern dringt die Brut bis ins Zentrum vor', () => {
    const s = beforeNight(1);
    parkPlayers(s, 0);
    s.players[0].hasCrown = false; // kein Ziel – geprüft wird nur das Vorrücken
    let reached = 0;
    tickNight(s, NIGHT - 1, undefined, () => {
      reached = Math.max(reached, s.enemies.filter((e) => Math.abs(e.x) < 120).length);
    });
    expect(reached).toBeGreaterThan(0);
  });

  it('Brecher der dritten Nacht erreichen noch vor dem Morgengrauen die Mauer', () => {
    const s = beforeNight(3);
    parkPlayers(s, 205); // Herrscher steht an der Ostmauer (schlechtester Fall für den Nebel)
    const walls = [setWall(s, 210, 3, 9999), setWall(s, -210, 3, 9999)];
    const prev = new Map(walls.map((w) => [w.id, w.hp]));
    const breakerHits = new Set<number>();
    tickNight(s, NIGHT - 0.5, undefined, (step) => {
      for (const h of ofType(step, 'wallHit')) {
        // Brecher erkennt man am Mauerschaden je Schlag
        if ((prev.get(h.structureId) ?? 0) - h.hp === BALANCE.enemies.breaker.wallDamage) breakerHits.add(h.structureId);
        prev.set(h.structureId, h.hp);
      }
    });
    expect([...breakerHits].sort()).toEqual(walls.map((w) => w.id).sort());
  });

  it('Nebeldrift: fern von allem schnell, in Sichtweite normal schnell', () => {
    const s = emptyStage(newGame());
    setDayTime(s, 160);
    s.wave = { night: s.day, elapsed: 0, pending: [], paleMoon: false };
    parkPlayers(s, 1000);
    const far = spawnEnemy(s, 'mistling', 1, 2400);
    const near = spawnEnemy(s, 'mistling', 1, 1200);
    expect(enemyInFog(s, far)).toBe(true);
    expect(enemyInFog(s, near)).toBe(false);
    const x0 = far.x;
    const x1 = near.x;
    tickNight(s, 0.5);
    expect(x0 - far.x).toBeCloseTo(BALANCE.enemies.fog.driftSpeed * 0.5, 0);
    expect(x1 - near.x).toBeCloseTo(BALANCE.enemies.mistling.speed * 0.5, 0);
  });

  it('Speichern/Laden mitten im Angriff (serializeGame/deserializeGame) setzt die Nacht identisch fort', () => {
    const s = emptyStage(newGame({ seed: 31 }));
    s.day = 3;
    setDayTime(s, C.duskEnd - 0.5);
    setWall(s, 210, 2);
    setWall(s, -210, 2);
    runGame(s, 26);
    expect(s.phase).toBe('night');
    expect(s.enemies.length).toBeGreaterThan(0);
    const loaded = deserializeGame(serializeGame(s, '2026-10-22T21:00:00.000Z'));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const evA = runGame(s, 15);
    const evB = runGame(loaded.state, 15);
    expect(evB).toEqual(evA);
    expect(loaded.state.enemies).toEqual(s.enemies);
    expect(loaded.state.wave).toEqual(s.wave);
  });

  it('Dauerlauf über fünf Tage (alle Systeme): Gegner nur nachts, jede Nacht eine Welle, keine ungültigen Werte', () => {
    for (const coop of [false, true]) {
      const s = newGame({ seed: 5, coop });
      const spawnsPerNight = new Map<number, number>();
      let bad = '';
      runGame(s, 5 * C.length, [], (ev) => {
        const n = ofType(ev, 'enemySpawn').length;
        if (n > 0) spawnsPerNight.set(s.day, (spawnsPerNight.get(s.day) ?? 0) + n);
        if (s.enemies.length > 0 && (s.phase === 'day' || s.phase === 'dawn')) bad ||= `Gegner bei ${s.phase} Tag ${s.day}`;
        for (const e of s.enemies) if (!Number.isFinite(e.x) || !Number.isFinite(e.vx)) bad ||= `Gegner-x ungültig`;
        for (const c of s.citizens) if (!Number.isFinite(c.x)) bad ||= `Bürger-x ungültig`;
        for (const a of s.arrows) if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) bad ||= `Pfeil ungültig`;
      });
      expect(bad).toBe('');
      expect(s.day).toBe(6);
      for (let n = 1; n <= 5; n++) expect(spawnsPerNight.get(n)).toBe(total(n));
    }
  });

  it('ist mitten in der Nacht vollständig speicherbar (JSON-Rundreise läuft identisch weiter)', () => {
    const s = beforeNight(4);
    parkPlayers(s, 0);
    setWall(s, 210, 2);
    setWall(s, -210, 1);
    tickNight(s, 12);
    expect(s.enemies.length).toBeGreaterThan(0);
    expect(s.wave.pending.length).toBeGreaterThan(0);
    const copy: GameState = JSON.parse(JSON.stringify(s));
    const evA = tickNight(s, 20);
    const evB = tickNight(copy, 20);
    expect(evB).toEqual(evA);
    expect(copy).toEqual(s);
  });
});
