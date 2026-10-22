// Crownward – WebAudio-Bausteine: Hüllkurven, Oszillatoren, gefiltertes Rauschen, Zupfsaite, Glocke, Vogelruf.
// Alle Bausteine planen auf Zeitpunkt t, stoppen sich selbst und trennen ihre Knoten nach dem Ende.
// Hüllkurven enden exponentiell bei EPS (−80 dB) → kein Knacken beim Stoppen.

import { brownNoise, clamp, karplusStrong, makeLoopable, midiToFreq, whiteNoise, type Rng } from './dsp';

export const EPS = 0.0001;

/** Gemeinsame Ressourcen der Synthese (ein Satz pro AudioContext). */
export interface SynthKit {
  ctx: BaseAudioContext;
  rnd: Rng;
  white: AudioBuffer;
  brown: AudioBuffer;
  /** Zupfsaiten-Puffer (Cache) + Wiedergaberate für exakte Stimmung */
  pluckBuffer(midi: number, brightness: number): { buffer: AudioBuffer; rate: number };
  /** spätestes Hüllkurvenende aller Quellen seit dem letzten Zurücksetzen (Stimmende für die Engine) */
  horizon: number;
}

const PLUCK_RATE = 24000;
const PLUCK_CACHE_MAX = 56;

export function createSynthKit(ctx: BaseAudioContext, rnd: Rng): SynthKit {
  const sr = ctx.sampleRate;
  const mk = (data: Float32Array, rate = sr): AudioBuffer => {
    const b = ctx.createBuffer(1, data.length, rate);
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    return b;
  };
  const white = mk(makeLoopable(whiteNoise(Math.floor(sr * 2.1), rnd), Math.floor(sr * 0.05)));
  const brown = mk(makeLoopable(brownNoise(Math.floor(sr * 3.1), rnd), Math.floor(sr * 0.1)));
  const cache = new Map<string, { buffer: AudioBuffer; rate: number }>();
  return {
    ctx,
    rnd,
    white,
    brown,
    horizon: 0,
    pluckBuffer(midi, brightness) {
      const m = Math.round(clamp(midi, 24, 108));
      const b = Math.round(clamp(brightness, 0, 1) * 4) / 4;
      const key = `${m}|${b}`;
      let hit = cache.get(key);
      if (hit) {
        // LRU: zuletzt benutzt ans Ende
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const f = midiToFreq(m);
      const t60 = clamp(3.4 - (m - 38) * 0.05, 0.9, 3.4);
      const { data, actualFreq } = karplusStrong(f, PLUCK_RATE, rnd, { brightness: b, t60, pluckPos: 0.12 + 0.1 * b, maxDuration: 1.9 });
      hit = { buffer: mk(data, PLUCK_RATE), rate: f / actualFreq };
      cache.set(key, hit);
      if (cache.size > PLUCK_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return hit;
    },
  };
}

// ---------- Parameter-Helfer ----------

/** Lineare Rampe vom aktuellen Wert (ohne Sprung) – für Lautstärkeregler und Stummschaltung. */
export function rampTo(p: AudioParam, value: number, now: number, time: number): void {
  const withHold = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof withHold.cancelAndHoldAtTime === 'function') {
    withHold.cancelAndHoldAtTime(now);
  } else {
    const cur = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(cur, now);
  }
  p.linearRampToValueAtTime(value, now + Math.max(0.005, time));
}

/** Weich nachgeführter Parameter (setTargetAtTime); neue Ziele nur bei echter Änderung. */
export class SmoothParam {
  private last = Number.NaN;
  constructor(
    private readonly p: AudioParam,
    private readonly tau: number,
  ) {}
  set(v: number, now: number, tau = this.tau): void {
    if (!Number.isFinite(v)) return;
    if (Math.abs(v - this.last) <= Math.max(1e-4, Math.abs(this.last) * 0.01)) return;
    this.p.setTargetAtTime(v, now, Math.max(0.01, tau));
    this.last = v;
  }
  get target(): number {
    return this.last;
  }
}

/** Attack (linear) – optional Halten – Abklingen (exponentiell bis EPS). Gibt das Ende zurück. */
export function envelope(p: AudioParam, t: number, peak: number, attack: number, decay: number, hold = 0): number {
  const pk = Math.max(peak, EPS * 2);
  const a = Math.max(0.001, attack);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  if (hold > 0) p.setValueAtTime(pk, t + a + hold);
  const end = t + a + hold + Math.max(0.005, decay);
  p.exponentialRampToValueAtTime(EPS, end);
  return end;
}

function cleanup(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    src.disconnect();
    for (const n of nodes) n.disconnect();
  };
}

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  /** Zielfrequenz (exponentieller Verlauf über glide bzw. die Klangdauer) */
  to?: number;
  q?: number;
  glide?: number;
}

function makeFilter(ctx: BaseAudioContext, f: FilterSpec, t: number, dur: number): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = f.type;
  node.Q.value = f.q ?? 0.8;
  node.frequency.setValueAtTime(clamp(f.freq, 20, 20000), t);
  if (f.to !== undefined) node.frequency.exponentialRampToValueAtTime(clamp(f.to, 20, 20000), t + Math.max(0.01, f.glide ?? dur));
  return node;
}

// ---------- Klangquellen ----------

export interface ToneOpts {
  t: number;
  dest: AudioNode;
  type?: OscillatorType;
  freq: number;
  /** Zielfrequenz (Tonhöhenverlauf) */
  to?: number;
  glide?: number;
  peak: number;
  attack?: number;
  hold?: number;
  decay: number;
  detune?: number;
  filter?: FilterSpec;
  /** Vibrato: Rate in Hz, Tiefe in Cent, Einsatz nach delay s */
  vibrato?: { rate: number; depth: number; delay?: number };
}

export function tone(k: SynthKit, o: ToneOpts): number {
  const { ctx } = k;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  const attack = o.attack ?? 0.004;
  const total = attack + (o.hold ?? 0) + o.decay;
  osc.frequency.setValueAtTime(clamp(o.freq, 10, 20000), o.t);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(clamp(o.to, 10, 20000), o.t + Math.max(0.005, o.glide ?? total));
  if (o.detune) osc.detune.setValueAtTime(o.detune, o.t);
  const g = ctx.createGain();
  g.gain.value = 0;
  const nodes: AudioNode[] = [g];
  let head: AudioNode = osc;
  if (o.filter) {
    const f = makeFilter(ctx, o.filter, o.t, total);
    head.connect(f);
    head = f;
    nodes.push(f);
  }
  head.connect(g);
  g.connect(o.dest);
  const end = envelope(g.gain, o.t, o.peak, attack, o.decay, o.hold ?? 0);
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibrato.rate;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, o.t);
    depth.gain.linearRampToValueAtTime(o.vibrato.depth, o.t + (o.vibrato.delay ?? 0) + 0.05);
    lfo.connect(depth);
    depth.connect(osc.detune);
    lfo.start(o.t);
    lfo.stop(end + 0.02);
    cleanup(lfo, [depth]);
  }
  osc.start(o.t);
  osc.stop(end + 0.02);
  cleanup(osc, nodes);
  if (end > k.horizon) k.horizon = end;
  return end;
}

export interface NoiseOpts {
  t: number;
  dest: AudioNode;
  color?: 'white' | 'brown';
  peak: number;
  attack?: number;
  hold?: number;
  decay: number;
  filter?: FilterSpec;
  filter2?: FilterSpec;
  /** Wiedergaberate (tiefer/höher gefärbt) */
  rate?: number;
}

export function noise(k: SynthKit, o: NoiseOpts): number {
  const { ctx } = k;
  const src = ctx.createBufferSource();
  const buf = o.color === 'brown' ? k.brown : k.white;
  src.buffer = buf;
  src.loop = true;
  if (o.rate) src.playbackRate.setValueAtTime(o.rate, o.t);
  const attack = o.attack ?? 0.002;
  const total = attack + (o.hold ?? 0) + o.decay;
  const g = ctx.createGain();
  g.gain.value = 0;
  const nodes: AudioNode[] = [g];
  let head: AudioNode = src;
  for (const spec of [o.filter, o.filter2]) {
    if (!spec) continue;
    const f = makeFilter(ctx, spec, o.t, total);
    head.connect(f);
    head = f;
    nodes.push(f);
  }
  head.connect(g);
  g.connect(o.dest);
  const end = envelope(g.gain, o.t, o.peak, attack, o.decay, o.hold ?? 0);
  src.start(o.t, k.rnd() * Math.max(0, buf.duration - 0.1));
  src.stop(end + 0.02);
  cleanup(src, nodes);
  if (end > k.horizon) k.horizon = end;
  return end;
}

export interface PluckOpts {
  t: number;
  dest: AudioNode;
  midi: number;
  vel: number;
  brightness?: number;
  /** Feinverstimmung in Cent */
  detune?: number;
  /** Stereo-Position (nur wenn StereoPanner verfügbar) */
  pan?: number;
}

/** Gezupfte Saite (Laute/Harfe) aus vorberechnetem Karplus-Strong-Puffer. */
export function pluck(k: SynthKit, o: PluckOpts): number {
  const { ctx } = k;
  const { buffer, rate } = k.pluckBuffer(o.midi, o.brightness ?? 0.6);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.setValueAtTime(rate, o.t);
  if (o.detune) src.detune.setValueAtTime(o.detune, o.t);
  const g = ctx.createGain();
  g.gain.value = clamp(o.vel, 0, 1.5);
  const nodes: AudioNode[] = [g];
  src.connect(g);
  let out: AudioNode = g;
  if (o.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o.pan, -1, 1);
    g.connect(p);
    out = p;
    nodes.push(p);
  }
  out.connect(o.dest);
  const end = o.t + buffer.duration / rate;
  src.start(o.t);
  src.stop(end + 0.01);
  cleanup(src, nodes);
  if (end > k.horizon) k.horizon = end;
  return end;
}

/** Glocke aus unharmonischen Teiltönen: [Verhältnis, Amplitude, Abklingfaktor]. */
export const BELL_PARTIALS: [number, number, number][] = [
  [1, 1, 1],
  [2.0, 0.45, 0.7],
  [2.76, 0.32, 0.5],
  [5.4, 0.14, 0.3],
  [8.93, 0.06, 0.18],
];
export const GONG_PARTIALS: [number, number, number][] = [
  [1, 1, 1],
  [1.47, 0.6, 0.8],
  [1.98, 0.5, 0.7],
  [2.52, 0.34, 0.55],
  [2.99, 0.24, 0.45],
  [3.83, 0.16, 0.35],
  [4.95, 0.1, 0.25],
];

export function bell(
  k: SynthKit,
  o: { t: number; dest: AudioNode; freq: number; peak: number; decay: number; partials?: [number, number, number][]; attack?: number; wobble?: number },
): number {
  let end = o.t;
  const parts = o.partials ?? BELL_PARTIALS;
  let sum = 0;
  for (const [, a] of parts) sum += a;
  for (const [ratio, amp, dm] of parts) {
    const f = o.freq * ratio;
    if (f > 16000) continue;
    end = Math.max(
      end,
      tone(k, {
        t: o.t,
        dest: o.dest,
        freq: f,
        peak: (o.peak * amp) / sum,
        attack: o.attack ?? 0.003,
        decay: o.decay * dm,
        detune: (k.rnd() - 0.5) * 6,
        vibrato: o.wobble ? { rate: 0.6 + k.rnd() * 0.8, depth: o.wobble } : undefined,
      }),
    );
  }
  return end;
}

/** Vogelruf: einige schnelle Frequenzbögen. */
export function chirp(k: SynthKit, o: { t: number; dest: AudioNode; base: number; syllables: number; peak: number }): number {
  let t = o.t;
  let end = t;
  for (let i = 0; i < o.syllables; i++) {
    const f0 = o.base * (0.9 + k.rnd() * 0.25);
    const up = k.rnd() < 0.6;
    const len = 0.04 + k.rnd() * 0.05;
    end = tone(k, {
      t,
      dest: o.dest,
      freq: up ? f0 * 0.75 : f0 * 1.3,
      to: up ? f0 * 1.35 : f0 * 0.8,
      glide: len,
      peak: o.peak * (0.7 + k.rnd() * 0.3),
      attack: 0.006,
      decay: len,
    });
    t += len + 0.02 + k.rnd() * 0.06;
  }
  return end;
}

/** Pulszug eines einzelnen Oszillators (Grillenzirpen): ein Knoten, viele kurze Hüllkurven. */
export function pulseTrain(
  k: SynthKit,
  o: { t: number; dest: AudioNode; freq: number; peak: number; pulses: number[]; pulseLen: number },
): number {
  const { ctx } = k;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(clamp(o.freq, 10, 20000), o.t);
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0, o.t);
  let end = o.t;
  const len = Math.max(0.006, o.pulseLen);
  for (const off of o.pulses) {
    const s = o.t + Math.max(0, off);
    if (s < end) continue; // überlappende Pulse auslassen
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(o.peak, s + len * 0.2);
    g.gain.linearRampToValueAtTime(0, s + len);
    end = s + len;
  }
  osc.connect(g);
  g.connect(o.dest);
  osc.start(o.t);
  osc.stop(end + 0.02);
  cleanup(osc, [g]);
  if (end > k.horizon) k.horizon = end;
  return end;
}
