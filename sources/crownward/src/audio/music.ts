// Crownward – Musikschichten: generative Zupfmelodie (Laute/Harfe), Spannungsdrone, Trommelpuls.
// Planung mit Vorlauf auf der AudioContext-Uhr; pro Frame aus update() aufgerufen.

import { Composer, type MusicNote } from './composer';
import type { MoodTargets } from './mood';
import { SmoothParam, noise, pluck, tone, type SynthKit } from './synth';

/** Vorlauf der Notenplanung in Sekunden. */
const LOOKAHEAD = 0.25;
/** höchstens so viele gleichzeitige Musikstimmen */
const MAX_MUSIC_VOICES = 18;

const VOICE_GAIN = { melody: 0.5, arp: 0.34, bass: 0.44 } as const;
const VOICE_BRIGHT = { melody: 0.75, arp: 0.5, bass: 0.25 } as const;

export class MusicLayers {
  readonly composer: Composer;
  private melodyGain: GainNode;
  private drumGain: GainNode;
  private droneGain: GainNode;
  private paleGain: GainNode;
  private melodyP: SmoothParam;
  private droneP: SmoothParam;
  private paleP: SmoothParam;
  private droneStarted = false;
  private droneNodes: AudioScheduledSourceNode[] = [];
  private nextTime = 0;
  private threat = 0;
  /** Endzeiten laufender Musikstimmen (Stimmenlimit) */
  private voiceEnds: number[] = [];

  constructor(
    private readonly k: SynthKit,
    dest: AudioNode,
  ) {
    const ctx = k.ctx;
    const g = (v: number) => {
      const n = ctx.createGain();
      n.gain.value = v;
      n.connect(dest);
      return n;
    };
    this.melodyGain = g(0);
    this.drumGain = g(0.9);
    this.droneGain = g(0);
    this.paleGain = ctx.createGain();
    this.paleGain.gain.value = 0;
    this.paleGain.connect(this.droneGain);
    this.melodyP = new SmoothParam(this.melodyGain.gain, 2.0);
    this.droneP = new SmoothParam(this.droneGain.gain, 2.5);
    this.paleP = new SmoothParam(this.paleGain.gain, 2.5);
    this.composer = new Composer(k.rnd, 'title');
  }

  /** Drone erst bei Bedarf bauen (spart Rechenzeit im Titelmenü/tagsüber). */
  private ensureDrone(now: number): void {
    if (this.droneStarted) return;
    this.droneStarted = true;
    const ctx = this.k.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 210;
    lp.Q.value = 2.2;
    lp.connect(this.droneGain);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 70;
    lfo.connect(lfoDepth);
    lfoDepth.connect(lp.frequency);
    lfo.start(now);
    this.droneNodes.push(lfo);
    // D1, A1, D2 – leicht verstimmt, langsames Schweben
    for (const [f, d, a] of [
      [36.71, 0, 0.22],
      [55.0, 4, 0.14],
      [73.42, -6, 0.1],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og);
      og.connect(lp);
      o.start(now);
      this.droneNodes.push(o);
    }
    // Fahlmond: Es-Reibung über dem D
    const plp = ctx.createBiquadFilter();
    plp.type = 'lowpass';
    plp.frequency.value = 280;
    plp.connect(this.paleGain);
    for (const [f, a] of [
      [38.89, 0.16],
      [77.78, 0.1],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og);
      og.connect(plp);
      o.start(now);
      this.droneNodes.push(o);
    }
  }

  get activeVoices(): number {
    return this.voiceEnds.length;
  }

  update(now: number, m: MoodTargets, audible: boolean): void {
    this.voiceEnds = this.voiceEnds.filter((e) => e > now);
    this.composer.setMood(m.music);
    this.threat = m.threat;
    this.melodyP.set(m.melody * 0.9, now);
    if (m.drone > 0.01 || m.paleDrone > 0.01) this.ensureDrone(now);
    if (this.droneStarted) {
      this.droneP.set(m.drone * 0.17, now);
      this.paleP.set(m.paleDrone, now);
    }

    // zurückgefallen (Tab im Hintergrund, Stummschaltung) → neu ansetzen statt nachholen
    if (this.nextTime < now - 0.1 || !audible) this.nextTime = now + 0.05;
    if (!audible) return;
    let guard = 0;
    while (this.nextTime < now + LOOKAHEAD && guard++ < 16) {
      const step = this.composer.next(this.threat);
      for (const n of step.notes) this.play(n, this.nextTime + n.offset, m);
      this.nextTime += step.stepDur;
    }
  }

  private play(n: MusicNote, t: number, m: MoodTargets): void {
    if (n.voice === 'drum') {
      if (m.threat <= 0.02) return;
      const v = n.vel;
      tone(this.k, { t, dest: this.drumGain, freq: 92, to: 46, glide: 0.18, peak: 0.3 * v, attack: 0.003, decay: 0.38 });
      noise(this.k, { t, dest: this.drumGain, color: 'brown', peak: 0.16 * v, decay: 0.09, filter: { type: 'lowpass', freq: 320 } });
      return;
    }
    if (m.melody < 0.02 || this.voiceEnds.length >= MAX_MUSIC_VOICES) return;
    const pan = n.voice === 'bass' ? 0 : n.voice === 'arp' ? -0.14 + (this.k.rnd() - 0.5) * 0.3 : 0.06 + (this.k.rnd() - 0.5) * 0.3;
    const end = pluck(this.k, {
      t,
      dest: this.melodyGain,
      midi: n.midi,
      vel: n.vel * VOICE_GAIN[n.voice],
      brightness: VOICE_BRIGHT[n.voice],
      detune: (this.k.rnd() - 0.5) * 6,
      pan,
    });
    this.voiceEnds.push(end);
  }

  /** Alle Dauerklänge beenden (beim Schließen der Engine). */
  dispose(now: number): void {
    for (const n of this.droneNodes) {
      try {
        n.stop(now + 0.05);
      } catch {
        /* schon gestoppt */
      }
    }
    this.droneNodes = [];
  }
}
