// Crownward – Mischpult: master → (Musik | Effekte) mit Hall-Rückweg, Kompressor als Begrenzer.
//
//   Musikschichten → musicIn (Tiefpass) → musicDuck → musicBus(Lautstärke) ─┐
//                                       └→ musicSend → musicWet(Lautstärke) → Hall ─┐
//   Ambiente → ambienceDuck → sfxBus(Lautstärke) ───────────────────────────────────┤→ master → Begrenzer → Ausgang
//   Effektstimmen → sfxBus;  Stimme → Send → sfxWet(Lautstärke) → Hall ─────────────┘
//
// Stumm = master auf exakt 0 (lineare Rampe), damit auch Ambiente, Hallfahnen und UI-Klänge verstummen.

import type { AudioSettings } from './types';
import { clamp01, impulseResponse, type Rng } from './dsp';
import { SmoothParam, rampTo } from './synth';

export const DEFAULT_SETTINGS: AudioSettings = { master: 0.8, music: 0.7, sfx: 0.85, muted: false };

/** Reglerwert 0..1 → Verstärkung (quadratisch, wirkt gleichmäßiger als linear). */
export function volumeCurve(v: number): number {
  const c = clamp01(Number.isFinite(v) ? v : 0);
  return c * c;
}

export function sanitizeSettings(s: Partial<AudioSettings> | null | undefined): AudioSettings {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : d);
  return {
    master: num(s?.master, DEFAULT_SETTINGS.master),
    music: num(s?.music, DEFAULT_SETTINGS.music),
    sfx: num(s?.sfx, DEFAULT_SETTINGS.sfx),
    muted: !!s?.muted,
  };
}

/** Effektiver Ausgangspegel je Bus (0 = stumm). */
export function busLevels(s: AudioSettings): { master: number; music: number; sfx: number } {
  return {
    master: s.muted ? 0 : volumeCurve(s.master),
    music: volumeCurve(s.music),
    sfx: volumeCurve(s.sfx),
  };
}

export class Mixer {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly musicBus: GainNode;
  readonly musicWet: GainNode;
  readonly sfxBus: GainNode;
  readonly sfxWet: GainNode;
  readonly reverb: ConvolverNode;
  /** Eingang für Musikschichten (Tiefpass für warme/gedämpfte Färbung) */
  readonly musicIn: BiquadFilterNode;
  readonly musicDuck: GainNode;
  /** Eingang für Ambiente */
  readonly ambienceIn: GainNode;
  readonly ambienceDuck: GainNode;
  private cutoff: SmoothParam;
  private musicDuckP: SmoothParam;
  private ambDuckP: SmoothParam;

  constructor(
    readonly ctx: AudioContext,
    rnd: Rng,
    settings: AudioSettings,
  ) {
    const g = (v: number) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const lv = busLevels(settings);
    this.master = g(0);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.25;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    const [l, r] = impulseResponse(ctx.sampleRate, 2.2, rnd);
    const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
    ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    this.reverb.buffer = ir;
    const reverbReturn = g(0.7);
    this.reverb.connect(reverbReturn);
    reverbReturn.connect(this.master);

    this.musicBus = g(lv.music);
    this.musicWet = g(lv.music);
    this.sfxBus = g(lv.sfx);
    this.sfxWet = g(lv.sfx);
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.musicWet.connect(this.reverb);
    this.sfxWet.connect(this.reverb);

    this.musicIn = ctx.createBiquadFilter();
    this.musicIn.type = 'lowpass';
    this.musicIn.Q.value = 0.5;
    this.musicIn.frequency.value = 6000;
    this.musicDuck = g(1);
    this.musicIn.connect(this.musicDuck);
    this.musicDuck.connect(this.musicBus);
    const musicSend = g(0.34);
    this.musicDuck.connect(musicSend);
    musicSend.connect(this.musicWet);

    this.ambienceIn = g(1);
    this.ambienceDuck = g(1);
    this.ambienceIn.connect(this.ambienceDuck);
    this.ambienceDuck.connect(this.sfxBus);
    const ambSend = g(0.12);
    this.ambienceDuck.connect(ambSend);
    ambSend.connect(this.sfxWet);

    this.cutoff = new SmoothParam(this.musicIn.frequency, 1.2);
    this.musicDuckP = new SmoothParam(this.musicDuck.gain, 0.25);
    this.ambDuckP = new SmoothParam(this.ambienceDuck.gain, 0.25);

    // sanft einblenden statt hart einschalten
    this.apply(settings, ctx.currentTime, 0.4);
  }

  /** Lautstärken/Stummschaltung mit kurzer linearer Rampe (kein Knacken, exakt 0 bei stumm). */
  apply(s: AudioSettings, now: number, time = 0.08): void {
    const lv = busLevels(s);
    rampTo(this.master.gain, lv.master, now, s.muted ? 0.05 : time);
    rampTo(this.musicBus.gain, lv.music, now, time);
    rampTo(this.musicWet.gain, lv.music, now, time);
    rampTo(this.sfxBus.gain, lv.sfx, now, time);
    rampTo(this.sfxWet.gain, lv.sfx, now, time);
  }

  /** Stimmungsabhängige Färbung: Tiefpass der Musik und Pausen-Dämpfung. */
  setMood(cutoff: number, duck: number, now: number): void {
    this.cutoff.set(cutoff, now, duck < 1 ? 0.3 : 1.6);
    this.musicDuckP.set(duck, now);
    this.ambDuckP.set(Math.min(1, duck * 1.15), now);
  }
}
