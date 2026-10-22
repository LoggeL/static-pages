// Crownward – reine Audio-Logik: Raum, Drossel, Stimmenlimit, Ereigniszuordnung, Stimmung, Komposition, DSP.
import { describe, expect, it } from 'vitest';
import { createGame, type GameState, type SimEvent } from '../../src/sim';
import { Composer, MOOD_SPECS, TITLE_SCORE } from '../../src/audio/composer';
import { mapEvent, uiCue } from '../../src/audio/cues';
import {
  MODES,
  brownNoise,
  degreeToMidi,
  impulseResponse,
  karplusStrong,
  makeLoopable,
  midiToFreq,
  mulberry32,
  whiteNoise,
} from '../../src/audio/dsp';
import { busLevels, sanitizeSettings, volumeCurve } from '../../src/audio/mixer';
import { computeMood, seaProximity, threatLevel, type MusicMood } from '../../src/audio/mood';
import { FULL_RANGE, HEAR_RANGE, distanceGain, nearestListener, spatialize } from '../../src/audio/spatial';
import { PENTA, RateLimiter, budgetDecision, comboStep, type ActiveVoice } from '../../src/audio/throttle';

/** Ein Ereignis jedes Typs (Vollständigkeit der Zuordnung). */
const ALL_EVENTS: SimEvent[] = [
  { type: 'coinPickup', x: 10, playerId: 0, coins: 3 },
  { type: 'coinDrop', x: 10, playerId: 0 },
  { type: 'purseFull', x: 10, playerId: 0 },
  { type: 'coinPaid', x: 10, playerId: 0, structureId: 5, paid: 2, cost: 4 },
  { type: 'payCancelled', x: 10, playerId: 0, structureId: 5, refunded: 2 },
  { type: 'purchase', x: 10, playerId: 0, structureId: 5, action: 'buildWall', cost: 2 },
  { type: 'toolStocked', x: 10, tool: 'bow', structureId: 3 },
  { type: 'buildStart', x: 10, structureId: 5, kind: 'wall', toLevel: 1 },
  { type: 'buildComplete', x: 10, structureId: 5, kind: 'wall', level: 1 },
  { type: 'hammer', x: 10, citizenId: 9 },
  { type: 'repaired', x: 10, structureId: 5 },
  { type: 'recruit', x: 10, citizenId: 9 },
  { type: 'roleChange', x: 10, citizenId: 9, role: 'archer' },
  { type: 'vagrantSpawn', x: 10, citizenId: 9 },
  { type: 'harvest', x: 10, structureId: 7 },
  { type: 'arrowFired', x: 10, y: 20, citizenId: 9 },
  { type: 'arrowHit', x: 10, y: 0, target: 'enemy' },
  { type: 'rabbitKilled', x: 10 },
  { type: 'enemySpawn', x: 2700, side: 1, kind: 'mistling' },
  { type: 'enemyHit', x: 10, enemyId: 30, kind: 'breaker' },
  { type: 'enemyDied', x: 10, kind: 'mistling' },
  { type: 'enemyEscaped', x: 10, kind: 'mistling', carrying: 'coin' },
  { type: 'enemiesDissolved', count: 3, xs: [400, -900, 1500] },
  { type: 'wallHit', x: 10, structureId: 5, hp: 3, maxHp: 14 },
  { type: 'wallDestroyed', x: 10, structureId: 5 },
  { type: 'playerHit', x: 10, playerId: 0, coinsLost: 3 },
  { type: 'citizenHit', x: 10, citizenId: 9, role: 'builder' },
  { type: 'crownLost', x: 10, playerId: 0 },
  { type: 'phaseChange', phase: 'night', day: 1 },
  { type: 'nightWarning', day: 5, paleMoon: true },
  { type: 'chestOpened', x: 10, structureId: 11, coins: 8 },
  { type: 'shrineActivated', x: 10, structureId: 12, shrine: 'bow' },
  { type: 'shipStage', x: 10, level: 2 },
  { type: 'victory', x: 10 },
  { type: 'defeat', x: 10 },
];

describe('Raumklang (Panorama/Abstand)', () => {
  it('voll und mittig direkt am Hörer', () => {
    const s = spatialize(100, [100], 'near');
    expect(s).not.toBeNull();
    expect(s!.gain).toBe(1);
    expect(s!.pan).toBe(0);
  });

  it('Panorama folgt der Seite, Lautstärke fällt monoton mit dem Abstand', () => {
    const right = spatialize(300, [0], 'near')!;
    const left = spatialize(-300, [0], 'near')!;
    expect(right.pan).toBeGreaterThan(0.5);
    expect(left.pan).toBeLessThan(-0.5);
    expect(right.gain).toBeCloseTo(left.gain, 10);
    let prev = 2;
    for (let d = 0; d < HEAR_RANGE; d += 10) {
      const g = distanceGain(d);
      expect(g).toBeLessThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(0);
      prev = g;
    }
    expect(distanceGain(FULL_RANGE)).toBe(1);
    expect(distanceGain(HEAR_RANGE)).toBe(0);
  });

  it('jenseits von ~450 px unhörbar (kein Klang wird erzeugt)', () => {
    expect(spatialize(0, [HEAR_RANGE + 5], 'near')).toBeNull();
    expect(spatialize(0, [440], 'near')).not.toBeNull();
  });

  it('Koop: der nähere Spieler ist der Hörer', () => {
    expect(nearestListener(500, [0, 520])).toBe(520);
    const s = spatialize(500, [0, 520], 'near')!;
    expect(s.distance).toBe(20);
    expect(s.pan).toBeLessThan(0);
  });

  it('ferne Ereignisse bleiben leise hörbar, globale sind mittig und voll', () => {
    const far = spatialize(2700, [0], 'far')!;
    expect(far.gain).toBeGreaterThanOrEqual(0.2);
    expect(far.gain).toBeLessThan(0.5);
    expect(far.pan).toBeGreaterThan(0);
    expect(spatialize(2700, [0], 'global')).toEqual({ gain: 1, pan: 0, distance: 0 });
    expect(spatialize(null, [0], 'near')).toEqual({ gain: 1, pan: 0, distance: 0 });
  });
});

describe('Drossel und Stimmenlimit', () => {
  it('Mindestabstand je Schlüssel', () => {
    const r = new RateLimiter();
    expect(r.allow('hammer', 0, 0.07)).toBe(true);
    expect(r.allow('hammer', 0.05, 0.07)).toBe(false);
    expect(r.allow('other', 0.05, 0.07)).toBe(true);
    expect(r.allow('hammer', 0.08, 0.07)).toBe(true);
  });

  it('Burst-Fenster begrenzt Auslösungen pro Sekunde', () => {
    const r = new RateLimiter();
    let n = 0;
    for (let i = 0; i < 20; i++) if (r.allow('k', i * 0.01, 0, 3, 1)) n++;
    expect(n).toBe(3);
    expect(r.allow('k', 1.5, 0, 3, 1)).toBe(true);
  });

  it('prune vergisst alte Schlüssel', () => {
    const r = new RateLimiter();
    r.allow('a', 0, 0.1);
    r.allow('b', 9, 0.1);
    r.prune(12, 10);
    expect(r.size).toBe(1);
  });

  it('Stimmenlimit: frei, verwerfen, verdrängen', () => {
    const mk = (n: number, p: 0 | 1 | 2 | 3): ActiveVoice[] => Array.from({ length: n }, (_, i) => ({ priority: p, start: i }));
    expect(budgetDecision(mk(3, 0), 0, 4, 6)).toEqual({ kind: 'ok' });
    expect(budgetDecision(mk(4, 0), 0, 4, 6)).toEqual({ kind: 'drop' });
    expect(budgetDecision(mk(4, 0), 2, 4, 6)).toEqual({ kind: 'ok' });
    // am harten Limit: älteste Stimme niedrigster Priorität wird verdrängt
    const voices: ActiveVoice[] = [
      { priority: 1, start: 0 },
      { priority: 0, start: 5 },
      { priority: 0, start: 2 },
      { priority: 2, start: 1 },
      { priority: 1, start: 3 },
      { priority: 0, start: 4 },
    ];
    expect(budgetDecision(voices, 3, 4, 6)).toEqual({ kind: 'steal', index: 2 });
    expect(budgetDecision(mk(6, 3), 3, 4, 6)).toEqual({ kind: 'drop' });
  });

  it('Münz-Kombo steigt bei schneller Folge und fällt nach Pause zurück', () => {
    let s = 0;
    let last = -10;
    const steps: number[] = [];
    for (let i = 0; i < 10; i++) {
      s = comboStep(s, last, i * 0.1);
      last = i * 0.1;
      steps.push(s);
    }
    expect(steps.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(Math.max(...steps)).toBe(PENTA.length - 1);
    expect(comboStep(5, 0, 2)).toBe(0);
  });
});

describe('Ereignis → Klang', () => {
  it('jeder Ereignistyp hat einen gültigen Klang', () => {
    for (const e of ALL_EVENTS) {
      const c = mapEvent(e, [0]);
      expect(c, e.type).not.toBeNull();
      expect(c!.minInterval).toBeGreaterThan(0);
      expect(c!.gain).toBeGreaterThan(0);
      expect(c!.reverb).toBeGreaterThanOrEqual(0);
    }
  });

  it('Zahlklang steigt mit paid/cost; letzte Münze ist markiert', () => {
    const a = mapEvent({ type: 'coinPaid', x: 0, playerId: 0, structureId: 1, paid: 1, cost: 4 })!;
    const b = mapEvent({ type: 'coinPaid', x: 0, playerId: 0, structureId: 1, paid: 3, cost: 4 })!;
    const c = mapEvent({ type: 'coinPaid', x: 0, playerId: 0, structureId: 1, paid: 4, cost: 4 })!;
    expect(a.params.ratio).toBeLessThan(b.params.ratio);
    expect(c.params.ratio).toBe(1);
    expect(c.params.heavy).toBe(true);
    expect(a.params.heavy).toBe(false);
  });

  it('Kauf und Baubeginn teilen den Akkord-Schlüssel; Truhe/Ablegen ohne Kaufakkord', () => {
    const p = mapEvent({ type: 'purchase', x: 0, playerId: 0, structureId: 1, action: 'buildWall', cost: 2 })!;
    const b = mapEvent({ type: 'buildStart', x: 0, structureId: 1, kind: 'wall', toLevel: 1 })!;
    expect(p.key).toBe(b.key);
    expect(mapEvent({ type: 'purchase', x: 0, playerId: 0, structureId: 1, action: 'openChest', cost: 0 })).toBeNull();
    expect(mapEvent({ type: 'purchase', x: 0, playerId: 0, structureId: 1, action: 'embark', cost: 0 })).toBeNull();
  });

  it('Horn: Fahlmond-Variante; Phasen haben eigene Klänge', () => {
    expect(mapEvent({ type: 'nightWarning', day: 5, paleMoon: true })!.params.heavy).toBe(true);
    expect(mapEvent({ type: 'nightWarning', day: 2, paleMoon: false })!.params.heavy).toBe(false);
    const ids = (['day', 'dusk', 'night', 'dawn'] as const).map((phase) => mapEvent({ type: 'phaseChange', phase, day: 2 })!.id);
    expect(ids).toEqual(['dayChime', 'duskBell', 'nightGong', 'dawnBirds']);
    expect(mapEvent({ type: 'phaseChange', phase: 'night', day: 2 })!.space).toBe('global');
  });

  it('Auflösen im Morgengrauen orientiert sich am nächsten Gegner', () => {
    const c = mapEvent({ type: 'enemiesDissolved', count: 3, xs: [900, -300, 1500] }, [-100])!;
    expect(c.x).toBe(-300);
    expect(mapEvent({ type: 'enemiesDissolved', count: 0, xs: [] })).toBeNull();
  });

  it('Gegner-Spawn ist ein ferner Klang je Seite; Kronverlust global', () => {
    const w = mapEvent({ type: 'enemySpawn', x: -2600, side: -1, kind: 'breaker' })!;
    const e = mapEvent({ type: 'enemySpawn', x: 2700, side: 1, kind: 'mistling' })!;
    expect(w.space).toBe('far');
    expect(w.key).not.toBe(e.key);
    expect(w.params.heavy).toBe(true);
    expect(mapEvent({ type: 'crownLost', x: 0, playerId: 0 })!.priority).toBe(3);
  });

  it('UI-Klänge sind global und haben höchste Priorität', () => {
    for (const k of ['click', 'open', 'close', 'error', 'start'] as const) {
      const c = uiCue(k);
      expect(c.space).toBe('global');
      expect(c.priority).toBe(3);
    }
  });
});

function withPhase(s: GameState, phase: GameState['phase'], dayTime: number): GameState {
  s.phase = phase;
  s.dayTime = dayTime;
  return s;
}

describe('Stimmung', () => {
  it('Titelmenü hat eigenes Thema', () => {
    const m = computeMood(null, false);
    expect(m.music).toBe('title');
    expect(m.duck).toBe(1);
  });

  it('Tag: Melodie und Vögel, keine Drone/Grillen', () => {
    const m = computeMood(createGame({ seed: 1 }), false);
    expect(m.music).toBe('day');
    expect(m.melody).toBe(1);
    expect(m.birds).toBeGreaterThan(0);
    expect(m.crickets).toBe(0);
    expect(m.drone).toBe(0);
  });

  it('Abend wärmer/leiser, Nacht dunkel mit Drone, Fahlmond mit Reibung', () => {
    const dusk = computeMood(withPhase(createGame(), 'dusk', 140), false);
    const night = computeMood(withPhase(createGame(), 'night', 170), false);
    expect(dusk.melody).toBeLessThan(1);
    expect(dusk.musicCutoff).toBeLessThan(7000);
    expect(night.drone).toBeGreaterThan(0.5);
    expect(night.crickets).toBeGreaterThan(0);
    expect(night.paleDrone).toBe(0);
    const pale = withPhase(createGame(), 'night', 170);
    pale.wave.paleMoon = true;
    expect(computeMood(pale, false).paleDrone).toBeGreaterThan(0.5);
  });

  it('Bedrohung: nahe Gegner → Trommelpuls, ferne nicht', () => {
    const s = withPhase(createGame(), 'night', 170);
    expect(threatLevel(s)).toBe(0);
    const enemy = {
      id: 999, kind: 'mistling' as const, x: s.players[0].x + 2000, vx: 0, facing: -1 as const, side: 1 as const, hp: 2, maxHp: 2,
      state: 'advance' as const, targetId: null, targetKind: null, carrying: null, attackTimer: 0, hitFlash: 0, anim: 'walk' as const,
    };
    s.enemies.push(enemy);
    expect(threatLevel(s)).toBe(0);
    enemy.x = s.players[0].x + 60;
    expect(threatLevel(s)).toBe(1);
    expect(computeMood(s, false).threat).toBe(1);
    enemy.x = s.players[0].x + 300;
    const mid = threatLevel(s);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('Pause dämpft Musik und Ambiente', () => {
    const m = computeMood(createGame(), true);
    expect(m.duck).toBeLessThan(0.5);
    expect(m.musicCutoff).toBeLessThanOrEqual(900);
  });

  it('Sieg/Niederlage ändern die Musik; Brandung nur an den Rändern', () => {
    const v = createGame();
    v.outcome = 'victory';
    expect(computeMood(v, false).music).toBe('victory');
    const d = createGame();
    d.outcome = 'defeat';
    expect(computeMood(d, false).music).toBe('defeat');
    expect(seaProximity([0])).toBe(0);
    expect(seaProximity([-3000])).toBeGreaterThan(0.5);
  });
});

describe('Komponist', () => {
  const inMode = (midi: number, root: number, mode: readonly number[]) => mode.includes((((midi - root) % 12) + 12) % 12);

  it('deterministisch bei gleichem Startwert', () => {
    const a = new Composer(mulberry32(7), 'day');
    const b = new Composer(mulberry32(7), 'day');
    for (let i = 0; i < 200; i++) expect(a.next(0)).toEqual(b.next(0));
  });

  it('alle Töne liegen in der Kirchentonart der Stimmung', () => {
    const moods: MusicMood[] = ['title', 'day', 'dusk', 'night', 'dawn', 'victory', 'defeat'];
    for (const mood of moods) {
      const c = new Composer(mulberry32(3), mood);
      const spec = MOOD_SPECS[mood];
      let notes = 0;
      for (let i = 0; i < 800; i++) {
        const r = c.next(0);
        expect(r.mood).toBe(mood);
        expect(r.stepDur).toBeCloseTo(30 / spec.bpm, 10);
        for (const n of r.notes) {
          expect(n.voice).not.toBe('drum');
          expect(inMode(n.midi, spec.root, spec.mode), `${mood} ${n.midi}`).toBe(true);
          expect(n.vel).toBeGreaterThan(0);
          expect(n.vel).toBeLessThanOrEqual(1);
          expect(n.midi).toBeGreaterThanOrEqual(24);
          expect(n.midi).toBeLessThanOrEqual(100);
          notes++;
        }
      }
      expect(notes, mood).toBeGreaterThan(20);
    }
  });

  it('Melodie ist sparsam: Tag dichter als Nacht', () => {
    const count = (mood: MusicMood) => {
      const c = new Composer(mulberry32(11), mood);
      let n = 0;
      for (let i = 0; i < 1600; i++) n += c.next(0).notes.filter((x) => x.voice === 'melody').length;
      return n;
    };
    const day = count('day');
    const night = count('night');
    expect(day).toBeGreaterThan(night * 1.5);
    expect(day).toBeLessThan(1600 * 0.6);
  });

  it('Titelthema beginnt mit der komponierten Melodie (A4)', () => {
    const c = new Composer(mulberry32(1), 'title');
    const first = c.next(0).notes.find((n) => n.voice === 'melody');
    expect(first?.midi).toBe(degreeToMidi(62, MODES.dorian, TITLE_SCORE[0].mel[0][0] as number));
    expect(first?.midi).toBe(69);
  });

  it('Trommeln nur bei Bedrohung', () => {
    const c = new Composer(mulberry32(5), 'night');
    let calm = 0;
    for (let i = 0; i < 64; i++) calm += c.next(0).notes.filter((n) => n.voice === 'drum').length;
    expect(calm).toBe(0);
    let tense = 0;
    for (let i = 0; i < 64; i++) tense += c.next(0.9).notes.filter((n) => n.voice === 'drum').length;
    expect(tense).toBeGreaterThan(16);
  });

  it('Stimmungswechsel erst am Taktanfang', () => {
    const c = new Composer(mulberry32(2), 'day');
    for (let i = 0; i < 3; i++) c.next(0);
    c.setMood('night');
    const moods: { mood: MusicMood; step: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const r = c.next(0);
      moods.push({ mood: r.mood, step: r.step });
    }
    const firstNight = moods.find((m) => m.mood === 'night');
    expect(firstNight?.step).toBe(0);
    expect(moods.slice(0, 5).every((m) => m.mood === 'day')).toBe(true);
  });
});

describe('DSP', () => {
  it('Tonhöhen und Skalenstufen', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 10);
    expect(midiToFreq(81)).toBeCloseTo(880, 10);
    expect(degreeToMidi(62, MODES.dorian, 0)).toBe(62);
    expect(degreeToMidi(62, MODES.dorian, 7)).toBe(74);
    expect(degreeToMidi(62, MODES.dorian, -1)).toBe(60);
    expect(degreeToMidi(62, MODES.dorian, 5)).toBe(71); // dorische große Sexte (H)
  });

  it('Karplus-Strong: endlich, normiert, klingt ab, Stimmkorrektur', () => {
    const sr = 24000;
    const f = midiToFreq(69);
    const { data, actualFreq } = karplusStrong(f, sr, mulberry32(9), { brightness: 0.7, t60: 1.5, pluckPos: 0.15 });
    expect(data.length).toBeGreaterThan(sr);
    let peak = 0;
    for (const v of data) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThanOrEqual(0.9001);
    expect(peak).toBeGreaterThan(0.5);
    const rms = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += data[i] * data[i];
      return Math.sqrt(s / (b - a));
    };
    const n = data.length;
    expect(rms(Math.floor(n * 0.8), n)).toBeLessThan(rms(0, Math.floor(n * 0.1)) * 0.2);
    expect(Math.abs(data[0])).toBe(0);
    expect(Math.abs(data[n - 1])).toBeLessThan(1e-6);
    expect(Math.abs(actualFreq - f) / f).toBeLessThan(0.02);
  });

  it('Impulsantwort: stereo, abklingend', () => {
    const [l, r] = impulseResponse(8000, 1, mulberry32(4));
    expect(l.length).toBe(8000);
    expect(r.length).toBe(8000);
    const energy = (a: Float32Array, s: number, e: number) => a.slice(s, e).reduce((acc, v) => acc + v * v, 0);
    expect(energy(l, 7000, 8000)).toBeLessThan(energy(l, 100, 1100) * 0.01);
    expect(Math.abs(l[7999])).toBe(0);
  });

  it('Rauschen: Bereich, nahtlose Schleife', () => {
    const w = whiteNoise(1000, mulberry32(1));
    expect(Math.max(...w)).toBeLessThanOrEqual(1);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(-1);
    const b = brownNoise(5000, mulberry32(2));
    expect(Math.max(...b.map(Math.abs))).toBeCloseTo(0.9, 5);
    const src = new Float32Array(200).map((_, i) => i / 200);
    const loop = makeLoopable(src, 50);
    expect(loop.length).toBe(150);
    // Übergang Ende → Anfang ohne Sprung: loop[0] setzt dort fort, wo loop[149] endet
    expect(Math.abs(loop[0] - src[150])).toBeLessThan(1e-6);
    expect(Math.abs(loop[149] - src[149])).toBeLessThan(1e-6);
  });
});

describe('Lautstärke-Einstellungen', () => {
  it('Kurve, Bereinigung, Stumm = 0', () => {
    expect(volumeCurve(0)).toBe(0);
    expect(volumeCurve(1)).toBe(1);
    expect(volumeCurve(0.5)).toBeCloseTo(0.25, 10);
    expect(volumeCurve(2)).toBe(1);
    expect(volumeCurve(Number.NaN)).toBe(0);
    const s = sanitizeSettings({ master: Number.NaN, music: 3, sfx: -1, muted: true });
    expect(s.master).toBeGreaterThan(0);
    expect(s.music).toBe(1);
    expect(s.sfx).toBe(0);
    expect(busLevels(s).master).toBe(0);
    expect(busLevels({ master: 1, music: 1, sfx: 1, muted: false }).master).toBe(1);
  });
});
