// Crownward – Audio-Engine gegen einen strikt prüfenden Fake-AudioContext (Node hat kein WebAudio).
// Der Fake wirft wie echte Browser bei ungültigen Parametern (z. B. exponentielle Rampe auf 0,
// nicht endliche Werte, doppeltes start()), damit alle Synthesepfade ohne Lautsprecher geprüft werden.
import { afterEach, describe, expect, it } from 'vitest';
import { NO_INPUT, createGame, stepGame, type GameState, type PlayerInput, type SimEvent } from '../../src/sim';
import { WebAudioEngine, HARD_VOICES, audioStats, createAudio } from '../../src/audio';
import type { CueParams, SfxId } from '../../src/audio/cues';
import { mulberry32 } from '../../src/audio/dsp';
import { volumeCurve } from '../../src/audio/mixer';
import { SFX } from '../../src/audio/sfx';
import { createSynthKit } from '../../src/audio/synth';

// ---------------------------------------------------------------- Fake-WebAudio

type ParamEvent = { kind: string; v: number; t: number };

class FakeParam {
  private _v: number;
  events: ParamEvent[] = [];
  constructor(
    v: number,
    readonly name: string,
  ) {
    this._v = v;
  }
  get value() {
    return this._v;
  }
  set value(v: number) {
    if (!Number.isFinite(v)) throw new TypeError(`${this.name}.value nicht endlich: ${v}`);
    this._v = v;
  }
  private check(v: number, t: number) {
    if (!Number.isFinite(v)) throw new TypeError(`${this.name}: Wert nicht endlich (${v})`);
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`${this.name}: Zeit ungültig (${t})`);
  }
  setValueAtTime(v: number, t: number) {
    this.check(v, t);
    this.events.push({ kind: 'set', v, t });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.check(v, t);
    this.events.push({ kind: 'lin', v, t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.check(v, t);
    if (v === 0) throw new RangeError(`${this.name}: exponentielle Rampe auf 0`);
    this.events.push({ kind: 'exp', v, t });
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    this.check(v, t);
    if (!Number.isFinite(tau) || tau < 0) throw new RangeError(`${this.name}: Zeitkonstante ungültig`);
    this.events.push({ kind: 'target', v, t });
    return this;
  }
  cancelScheduledValues(t: number) {
    this.check(0, t);
    this.events.push({ kind: 'cancel', v: 0, t });
    return this;
  }
  cancelAndHoldAtTime(t: number) {
    this.check(0, t);
    this.events.push({ kind: 'hold', v: 0, t });
    return this;
  }
  /** zuletzt geplanter Zielwert */
  lastValue(): number {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.kind !== 'cancel' && e.kind !== 'hold') return e.v;
    }
    return this._v;
  }
}

class FakeNode {
  out: (FakeNode | FakeParam)[] = [];
  constructor(readonly ctx: FakeAudioContext) {
    ctx.counts.nodes++;
  }
  connect<T extends FakeNode | FakeParam>(d: T): T {
    if (!(d instanceof FakeNode) && !(d instanceof FakeParam)) throw new TypeError('connect: kein AudioNode/AudioParam');
    if (d instanceof FakeNode && d.ctx !== this.ctx) throw new Error('connect: fremder Kontext');
    this.out.push(d);
    return d;
  }
  disconnect() {
    this.out = [];
    this.ctx.counts.disconnects++;
  }
}

class FakeScheduled extends FakeNode {
  started = -1;
  stopped = -1;
  onended: (() => void) | null = null;
  start(t = 0) {
    if (this.started >= 0) throw new Error('InvalidStateError: start() doppelt');
    if (!Number.isFinite(t) || t < 0) throw new RangeError('start: Zeit ungültig');
    this.started = t;
    this.ctx.counts.started++;
  }
  stop(t = 0) {
    if (this.started < 0) throw new Error('InvalidStateError: stop() vor start()');
    if (!Number.isFinite(t) || t < 0) throw new RangeError('stop: Zeit ungültig');
    this.stopped = t;
  }
}

const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
class FakeOscillator extends FakeScheduled {
  private _type = 'sine';
  frequency = new FakeParam(440, 'osc.frequency');
  detune = new FakeParam(0, 'osc.detune');
  get type() {
    return this._type;
  }
  set type(v: string) {
    if (!OSC_TYPES.includes(v)) throw new TypeError(`Oszillatortyp ungültig: ${v}`);
    this._type = v;
  }
}

class FakeBuffer {
  private channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    if (!Number.isInteger(length) || length <= 0) throw new Error(`NotSupportedError: Länge ${length}`);
    if (sampleRate < 3000 || sampleRate > 768000) throw new Error(`NotSupportedError: Rate ${sampleRate}`);
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(i: number) {
    return this.channels[i];
  }
  copyToChannel(src: Float32Array, ch: number) {
    if (ch >= this.numberOfChannels) throw new Error('IndexSizeError');
    for (const v of src) if (!Number.isFinite(v)) throw new TypeError('Puffer enthält NaN/Inf');
    this.channels[ch].set(src.subarray(0, this.length));
  }
}

class FakeBufferSource extends FakeScheduled {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1, 'src.playbackRate');
  detune = new FakeParam(0, 'src.detune');
  override start(t = 0, offset = 0) {
    if (!this.buffer) throw new Error('Quelle ohne Puffer gestartet');
    if (!Number.isFinite(offset) || offset < 0) throw new RangeError('start: Offset ungültig');
    super.start(t);
  }
}

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];
class FakeBiquad extends FakeNode {
  private _type = 'lowpass';
  frequency = new FakeParam(350, 'filter.frequency');
  Q = new FakeParam(1, 'filter.Q');
  gain = new FakeParam(0, 'filter.gain');
  detune = new FakeParam(0, 'filter.detune');
  get type() {
    return this._type;
  }
  set type(v: string) {
    if (!FILTER_TYPES.includes(v)) throw new TypeError(`Filtertyp ungültig: ${v}`);
    this._type = v;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1, 'gain');
}
class FakePanner extends FakeNode {
  pan = new FakeParam(0, 'pan');
}
class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  normalize = true;
}
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24, 'threshold');
  knee = new FakeParam(30, 'knee');
  ratio = new FakeParam(12, 'ratio');
  attack = new FakeParam(0.003, 'attack');
  release = new FakeParam(0.25, 'release');
}

class FakeAudioContext {
  static created = 0;
  currentTime = 0;
  sampleRate = 48000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  counts = { nodes: 0, disconnects: 0, started: 0, oscillators: 0, sources: 0, resumes: 0 };
  destination: FakeNode;
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  constructor() {
    FakeAudioContext.created++;
    this.destination = new FakeNode(this);
  }
  resume() {
    this.counts.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain() {
    const g = new FakeGain(this);
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    this.counts.oscillators++;
    const o = new FakeOscillator(this);
    this.oscillators.push(o);
    return o;
  }
  createBufferSource() {
    this.counts.sources++;
    return new FakeBufferSource(this);
  }
  createBiquadFilter() {
    return new FakeBiquad(this);
  }
  createStereoPanner() {
    return new FakePanner(this);
  }
  createConvolver() {
    return new FakeConvolver(this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }
  createBuffer(ch: number, len: number, sr: number) {
    return new FakeBuffer(ch, len, sr);
  }
}

const asCtx = (f: FakeAudioContext) => f as unknown as AudioContext;

function makeEngine(seed = 1) {
  const fake = new FakeAudioContext();
  let calls = 0;
  const engine = new WebAudioEngine({
    contextFactory: () => {
      calls++;
      return asCtx(fake);
    },
    random: mulberry32(seed),
  });
  return { fake, engine, calls: () => calls };
}

/** zeigt den Pegel des Master-Gains (erster Gain, der in den Begrenzer führt) */
function masterGain(fake: FakeAudioContext): FakeGain {
  const m = fake.gains.find((g) => g.out.some((n) => n instanceof FakeCompressor));
  if (!m) throw new Error('Master-Gain nicht gefunden');
  return m;
}

const ALL_EVENTS: SimEvent[] = [
  { type: 'coinPickup', x: 10, playerId: 0, coins: 3 },
  { type: 'coinDrop', x: 12, playerId: 0 },
  { type: 'purseFull', x: 14, playerId: 0 },
  { type: 'coinPaid', x: 16, playerId: 0, structureId: 5, paid: 2, cost: 4 },
  { type: 'payCancelled', x: 18, playerId: 0, structureId: 5, refunded: 2 },
  { type: 'purchase', x: 20, playerId: 0, structureId: 5, action: 'upgradeTown', cost: 5 },
  { type: 'toolStocked', x: 22, tool: 'bow', structureId: 3 },
  { type: 'buildStart', x: 24, structureId: 6, kind: 'wall', toLevel: 1 },
  { type: 'buildComplete', x: 26, structureId: 5, kind: 'townCenter', level: 3 },
  { type: 'hammer', x: 28, citizenId: 9 },
  { type: 'repaired', x: 30, structureId: 5 },
  { type: 'recruit', x: 32, citizenId: 9 },
  { type: 'roleChange', x: 34, citizenId: 9, role: 'archer' },
  { type: 'vagrantSpawn', x: 36, citizenId: 9 },
  { type: 'harvest', x: 38, structureId: 7 },
  { type: 'arrowFired', x: 40, y: 20, citizenId: 9 },
  { type: 'arrowHit', x: 42, y: 0, target: 'enemy' },
  { type: 'rabbitKilled', x: 44 },
  { type: 'enemySpawn', x: 2700, side: 1, kind: 'breaker' },
  { type: 'enemyHit', x: 46, enemyId: 30, kind: 'breaker' },
  { type: 'enemyDied', x: 48, kind: 'breaker' },
  { type: 'enemyEscaped', x: 50, kind: 'mistling', carrying: 'crown' },
  { type: 'enemiesDissolved', count: 3, xs: [400, -900, 1500] },
  { type: 'wallHit', x: 52, structureId: 5, hp: 3, maxHp: 14 },
  { type: 'wallDestroyed', x: 54, structureId: 5 },
  { type: 'playerHit', x: 56, playerId: 0, coinsLost: 3 },
  { type: 'citizenHit', x: 58, citizenId: 9, role: 'builder' },
  { type: 'crownLost', x: 60, playerId: 0 },
  { type: 'phaseChange', phase: 'night', day: 1 },
  { type: 'nightWarning', day: 5, paleMoon: true },
  { type: 'chestOpened', x: 62, structureId: 11, coins: 8 },
  { type: 'shrineActivated', x: 64, structureId: 12, shrine: 'hammer' },
  { type: 'shipStage', x: 66, level: 3 },
  { type: 'victory', x: 68 },
  { type: 'defeat', x: 70 },
];

function stateAt(phase: GameState['phase'], dayTime: number): GameState {
  const s = createGame({ seed: 3 });
  s.phase = phase;
  s.dayTime = dayTime;
  s.players[0].x = 0;
  return s;
}

const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
afterEach(() => {
  delete g.AudioContext;
  delete g.webkitAudioContext;
});

// ---------------------------------------------------------------- Tests

describe('ohne WebAudio (Node)', () => {
  it('createAudio wirft nicht; alles ist ein stiller No-op', () => {
    const a = createAudio();
    expect(a.unlocked).toBe(false);
    expect(() => {
      a.setSettings({ master: 0.5, music: 0.5, sfx: 0.5, muted: false });
      a.handleEvents(ALL_EVENTS, createGame());
      a.update(null, 0.016, false);
      a.update(createGame(), 0.016, true);
      a.uiSound('click');
      a.unlock();
      a.unlock();
      a.handleEvents(ALL_EVENTS, createGame());
      a.update(createGame(), 0.016, false);
    }).not.toThrow();
    expect(a.unlocked).toBe(false);
    expect((a as WebAudioEngine).stats().state).toBe('unsupported');
  });
});

describe('Freischaltung', () => {
  it('kein AudioContext vor unlock(); handleEvents/update/uiSound vorher No-ops', () => {
    const { engine, calls, fake } = makeEngine();
    engine.setSettings({ master: 1, music: 1, sfx: 1, muted: false });
    engine.handleEvents(ALL_EVENTS, createGame());
    engine.update(null, 0.016, false);
    engine.update(createGame(), 0.016, false);
    engine.uiSound('start');
    expect(calls()).toBe(0);
    expect(fake.counts.nodes).toBe(1); // nur der Ausgang des (nie benutzten) Fakes selbst
    expect(engine.unlocked).toBe(false);
  });

  it('unlock ist idempotent und setzt einen ausgesetzten Kontext fort', () => {
    const { engine, calls, fake } = makeEngine();
    engine.unlock();
    expect(calls()).toBe(1);
    expect(fake.counts.resumes).toBe(1);
    expect(engine.unlocked).toBe(true);
    engine.unlock();
    engine.unlock();
    expect(calls()).toBe(1);
    expect(fake.counts.resumes).toBe(1); // läuft bereits → kein weiteres resume
    fake.state = 'suspended';
    expect(engine.unlocked).toBe(false);
    engine.unlock();
    expect(fake.counts.resumes).toBe(2);
    expect(engine.unlocked).toBe(true);
  });

  it('Standardfabrik nutzt window.AudioContext bzw. webkitAudioContext', () => {
    FakeAudioContext.created = 0;
    g.webkitAudioContext = FakeAudioContext;
    const a = createAudio({ random: mulberry32(1) });
    expect(FakeAudioContext.created).toBe(0);
    a.unlock();
    expect(FakeAudioContext.created).toBe(1);
    expect(a.unlocked).toBe(true);
    delete g.webkitAudioContext;
    g.AudioContext = FakeAudioContext;
    const b = createAudio({ random: mulberry32(2) });
    b.unlock();
    expect(FakeAudioContext.created).toBe(2);
  });
});

describe('Effekte', () => {
  it('jede Effekt-Synthese plant gültige Parameter (alle Varianten)', () => {
    const fake = new FakeAudioContext();
    fake.state = 'running';
    const kit = createSynthKit(asCtx(fake), mulberry32(42));
    const dest = asCtx(fake).createGain();
    const variants: Partial<CueParams>[] = [
      {},
      { heavy: true, level: 3, ratio: 1 },
      { ratio: 0.2, level: 0 },
      { variant: 'enemy' },
      { variant: 'rabbit' },
      { variant: 'ground' },
      { variant: 'builder' },
      { variant: 'archer' },
      { variant: 'farmer' },
      { variant: 'vagrant' },
      { variant: 'bow' },
      { variant: 'hammer' },
      { variant: 'scythe' },
      { variant: 'crown' },
      { variant: 'upgradeTown', level: 1 },
      { variant: 'townCenter', level: 3 },
      { level: 12, semis: 16 },
    ];
    let t = 0.5;
    for (const id of Object.keys(SFX) as SfxId[]) {
      for (const v of variants) {
        const p: CueParams = { ratio: 0, level: 0, heavy: false, variant: '', semis: 0, ...v };
        const end = SFX[id](kit, t, dest, p);
        expect(Number.isFinite(end), id).toBe(true);
        expect(end, id).toBeGreaterThan(t);
        expect(end - t, id).toBeLessThan(8);
        t += 0.01;
      }
    }
    // alle Quellen wurden gestartet und haben ein Stoppdatum
    for (const o of fake.oscillators) {
      expect(o.started).toBeGreaterThanOrEqual(0);
      expect(o.stopped).toBeGreaterThan(o.started);
    }
  });

  it('jedes Simulationsereignis erzeugt Klang ohne Fehler', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    engine.setSettings({ master: 1, music: 1, sfx: 1, muted: false });
    const s = stateAt('day', 20);
    for (const e of ALL_EVENTS) {
      fake.currentTime += 0.5; // jede Gruppe frisch (keine Drossel)
      engine.handleEvents([e], s);
    }
    const st = engine.stats();
    expect(st.faults).toBe(0);
    expect(st.played).toBe(ALL_EVENTS.length);
    expect(fake.counts.oscillators).toBeGreaterThan(100);
  });

  it('UI-Klänge spielen; stumm → keine neuen Knoten, Master exakt 0', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    for (const k of ['click', 'open', 'close', 'error', 'start'] as const) {
      fake.currentTime += 0.2;
      engine.uiSound(k);
    }
    expect(engine.stats().played).toBe(5);
    engine.setSettings({ master: 0.8, music: 0.7, sfx: 0.9, muted: true });
    expect(masterGain(fake).gain.lastValue()).toBe(0);
    const before = fake.counts.nodes;
    fake.currentTime += 1;
    engine.handleEvents(ALL_EVENTS, stateAt('day', 20));
    engine.uiSound('click');
    expect(fake.counts.nodes).toBe(before);
    // wieder laut
    engine.setSettings({ master: 0.8, music: 0.7, sfx: 0.9, muted: false });
    expect(masterGain(fake).gain.lastValue()).toBeCloseTo(volumeCurve(0.8), 10);
  });

  it('Lautstärken wirken auf die Busse (weiche Rampe, Effekte 0 → keine Effekte)', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    engine.setSettings({ master: 1, music: 0.5, sfx: 0, muted: false });
    const ramps = fake.gains.filter((gn) => gn.gain.events.some((e) => e.kind === 'lin'));
    const values = ramps.map((gn) => gn.gain.lastValue());
    expect(values).toContain(volumeCurve(0.5));
    expect(values).toContain(0);
    const before = fake.counts.nodes;
    fake.currentTime += 1;
    engine.handleEvents(ALL_EVENTS, stateAt('day', 20));
    expect(fake.counts.nodes).toBe(before);
  });

  it('Abstand: ferne Ereignisse werden gar nicht erst erzeugt; Risse grollen aus der Ferne', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    const s = stateAt('night', 170);
    fake.currentTime = 1;
    engine.handleEvents([{ type: 'hammer', x: 1500, citizenId: 1 }], s);
    expect(engine.stats().played).toBe(0);
    expect(engine.stats().inaudible).toBe(1);
    engine.handleEvents([{ type: 'enemySpawn', x: 2700, side: 1, kind: 'mistling' }], s);
    expect(engine.stats().played).toBe(1);
  });

  it('Drossel: viele gleiche Ereignisse im selben Moment → ein Klang', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    fake.currentTime = 2;
    const hammers: SimEvent[] = Array.from({ length: 12 }, (_, i) => ({ type: 'hammer', x: i, citizenId: i }));
    engine.handleEvents(hammers, stateAt('day', 20));
    expect(engine.stats().played).toBe(1);
    expect(engine.stats().throttled).toBe(11);
  });

  it('Burst-Grenze: Dauerfeuer vieler Bogenschützen höchstens 8 Sehnenklänge pro Sekunde', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    const s = stateAt('night', 170);
    fake.currentTime = 3;
    for (let f = 0; f < 60; f++) {
      fake.currentTime += 1 / 60;
      engine.handleEvents([{ type: 'arrowFired', x: 20, y: 10, citizenId: f }], s);
    }
    expect(engine.stats().played).toBeLessThanOrEqual(8);
    expect(engine.stats().played).toBeGreaterThanOrEqual(6);
  });

  it('close() beendet die Engine sauber; audioStats liefert Diagnose', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    expect(audioStats(engine)?.state).toBe('running');
    engine.close();
    expect(fake.state).toBe('closed');
    expect(() => {
      engine.update(stateAt('day', 30), 0.016, false);
      engine.handleEvents(ALL_EVENTS, stateAt('day', 30));
    }).not.toThrow();
    expect(audioStats({ unlocked: false, unlock() {}, setSettings() {}, handleEvents() {}, update() {}, uiSound() {} })).toBeNull();
  });

  it('Stimmenlimit hält auch bei Ereignisflut, Stimmen werden nach Ende freigegeben', () => {
    const { engine, fake } = makeEngine();
    engine.unlock();
    const s = stateAt('night', 170);
    fake.currentTime = 1;
    let max = 0;
    for (let frame = 0; frame < 200; frame++) {
      fake.currentTime += 0.016;
      const burst: SimEvent[] = [];
      for (let i = 0; i < 6; i++) {
        burst.push({ type: 'wallHit', x: i * 5, structureId: 100 + ((frame * 6 + i) % 400), hp: 5, maxHp: 14 });
        burst.push({ type: 'enemyDied', x: i * 7, kind: 'mistling' });
        burst.push({ type: 'arrowFired', x: i * 3, y: 10, citizenId: i });
      }
      engine.handleEvents(burst, s);
      max = Math.max(max, engine.stats().sfxVoices);
    }
    expect(max).toBeLessThanOrEqual(HARD_VOICES + 1);
    expect(engine.stats().dropped + engine.stats().throttled).toBeGreaterThan(0);
    const disconnectsBefore = fake.counts.disconnects;
    fake.currentTime += 20;
    engine.update(s, 0.016, false);
    expect(engine.stats().sfxVoices).toBe(0);
    expect(fake.counts.disconnects).toBeGreaterThan(disconnectsBefore);
    expect(engine.stats().faults).toBe(0);
  });
});

describe('Musik und Ambiente', () => {
  function run(engine: WebAudioEngine, fake: FakeAudioContext, state: GameState | null, seconds: number, paused = false) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      fake.currentTime += dt;
      engine.update(state, dt, paused);
    }
  }

  it('Titelmenü spielt eigenes Thema, Tag/Abend/Nacht/Morgen wechseln fehlerfrei', () => {
    const { engine, fake } = makeEngine(5);
    engine.unlock();
    run(engine, fake, null, 6);
    expect(engine.stats().mood).toBe('title');
    expect(fake.counts.sources).toBeGreaterThan(10); // gezupfte Noten (Puffer-Quellen)
    for (const [phase, dt] of [
      ['day', 30],
      ['dusk', 140],
      ['night', 170],
      ['dawn', 200],
    ] as const) {
      run(engine, fake, stateAt(phase, dt), 6);
      expect(engine.stats().mood).toBe(phase);
    }
    expect(engine.stats().faults).toBe(0);
  });

  it('Nacht baut die Spannungsdrone; nahe Gegner erzeugen Trommelpuls', () => {
    const { engine, fake } = makeEngine(6);
    engine.unlock();
    run(engine, fake, stateAt('day', 30), 2);
    const sawsDay = fake.oscillators.filter((o) => o.type === 'sawtooth' && o.stopped < 0).length;
    expect(sawsDay).toBe(0);
    const s = stateAt('night', 170);
    run(engine, fake, s, 2);
    const saws = fake.oscillators.filter((o) => o.type === 'sawtooth' && o.stopped < 0).length;
    expect(saws).toBeGreaterThanOrEqual(3);
    // Trommel: Sinus mit Tonhöhenfall 92 → 46 Hz
    const drums = () => fake.oscillators.filter((o) => o.frequency.events.some((e) => e.v === 92)).length;
    expect(drums()).toBe(0);
    s.enemies.push({
      id: 500, kind: 'breaker', x: 80, vx: 0, facing: -1, side: 1, hp: 14, maxHp: 14, state: 'advance',
      targetId: null, targetKind: null, carrying: null, attackTimer: 0, hitFlash: 0, anim: 'walk',
    });
    run(engine, fake, s, 4);
    expect(drums()).toBeGreaterThan(2);
    expect(engine.stats().faults).toBe(0);
  });

  it('Pause dämpft (Duck-Ziel < 0,5), danach wieder normal', () => {
    const { engine, fake } = makeEngine(7);
    engine.unlock();
    const s = stateAt('day', 30);
    run(engine, fake, s, 1);
    run(engine, fake, s, 0.5, true);
    const duckTargets = fake.gains.flatMap((gn) => gn.gain.events.filter((e) => e.kind === 'target').map((e) => e.v));
    expect(duckTargets).toContain(0.35);
    run(engine, fake, s, 0.5, false);
    expect(engine.stats().faults).toBe(0);
  });

  it('stumm → keine Noten/Einzelklänge werden geplant', () => {
    const { engine, fake } = makeEngine(8);
    engine.unlock();
    engine.setSettings({ master: 1, music: 1, sfx: 1, muted: true });
    run(engine, fake, stateAt('dawn', 200), 0.1);
    const before = fake.counts.started;
    run(engine, fake, stateAt('dawn', 200), 8);
    expect(fake.counts.started).toBe(before);
  });

  it('läuft zusammen mit der echten Simulation (Tag → Nacht) ohne Fehler', () => {
    const { engine, fake } = makeEngine(9);
    engine.unlock();
    const s = createGame({ seed: 77 });
    const dt = 1 / 60;
    let events = 0;
    // zwei Minuten: Münzen sammeln/zahlen am Lagerfeuer, dann bis in die Nacht
    const steps = 60 * 160;
    for (let i = 0; i < steps; i++) {
      const input: PlayerInput = i % 600 < 200 ? { ...NO_INPUT, act: true } : i % 600 < 400 ? { ...NO_INPUT, right: true } : { ...NO_INPUT, left: true };
      const ev = stepGame(s, [input], dt);
      events += ev.length;
      fake.currentTime += dt;
      engine.handleEvents(ev, s);
      engine.update(s, dt, false);
    }
    expect(events).toBeGreaterThan(0);
    const st = engine.stats();
    expect(st.faults).toBe(0);
    expect(st.played).toBeGreaterThan(0);
  });
});
