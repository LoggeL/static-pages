// Crownward – generative, modale Musik (rein, testbar). Liefert pro Achtelschritt die zu spielenden Noten.
// Klangfarbe/Wiedergabe übernimmt music.ts; hier nur Harmonik, Melodieführung, Rhythmus.

import { MODES, degreeToMidi, type Rng } from './dsp';
import type { MusicMood } from './mood';

export type NoteVoice = 'melody' | 'bass' | 'arp' | 'drum';

export interface MusicNote {
  voice: NoteVoice;
  midi: number;
  /** Anschlagstärke 0..1 */
  vel: number;
  /** Verzögerung innerhalb des Schritts in Sekunden (Humanisierung) */
  offset: number;
}

export interface StepResult {
  notes: MusicNote[];
  /** Dauer dieses Achtelschritts in Sekunden */
  stepDur: number;
  mood: MusicMood;
  step: number;
  bar: number;
}

interface MoodSpec {
  bpm: number;
  mode: readonly number[];
  /** MIDI-Note der Stufe 0 */
  root: number;
  /** Wahrscheinlichkeit einer Melodienote auf geraden Achteln */
  density: number;
  /** Noten pro Phrase [min, max] */
  phrase: [number, number];
  /** Pausen-Achtel nach einer Phrase [min, max] */
  rest: [number, number];
  /** erlaubter Stufenbereich der Melodie */
  register: [number, number];
  bassChance: number;
  arpChance: number;
  /** Akkordfolgen als Stufen der Grundtöne (ein Akkord pro Takt) */
  progressions: number[][];
  vel: number;
}

const D4 = 62;
const D3 = 50;

export const MOOD_SPECS: Record<MusicMood, MoodSpec> = {
  title: {
    bpm: 64, mode: MODES.dorian, root: D4, density: 0, phrase: [1, 1], rest: [0, 0], register: [-3, 9],
    bassChance: 1, arpChance: 1, progressions: [[0, 6, 3, 0]], vel: 0.62,
  },
  day: {
    bpm: 76, mode: MODES.dorian, root: D4, density: 0.6, phrase: [4, 8], rest: [4, 10], register: [-2, 9],
    bassChance: 0.85, arpChance: 0.25, progressions: [[0, 6, 3, 0], [0, 3, 0, 6], [0, 4, 6, 0], [0, 6, 4, 3]], vel: 0.72,
  },
  dusk: {
    bpm: 62, mode: MODES.aeolian, root: D4, density: 0.42, phrase: [3, 6], rest: [6, 14], register: [-3, 7],
    bassChance: 0.7, arpChance: 0.15, progressions: [[0, 5, 6, 0], [0, 3, 5, 6]], vel: 0.58,
  },
  night: {
    bpm: 54, mode: MODES.phrygian, root: D3, density: 0.25, phrase: [2, 4], rest: [10, 22], register: [0, 7],
    bassChance: 0.55, arpChance: 0, progressions: [[0, 1, 0, 6], [0, 0, 1, 0]], vel: 0.5,
  },
  dawn: {
    bpm: 70, mode: MODES.dorian, root: D4, density: 0.45, phrase: [3, 6], rest: [6, 12], register: [0, 9],
    bassChance: 0.6, arpChance: 0.35, progressions: [[0, 3, 0, 6], [0, 6, 3, 0]], vel: 0.6,
  },
  victory: {
    bpm: 84, mode: MODES.mixolydian, root: D4, density: 0.75, phrase: [6, 10], rest: [2, 6], register: [0, 11],
    bassChance: 0.95, arpChance: 0.5, progressions: [[0, 3, 4, 0], [0, 6, 3, 0]], vel: 0.75,
  },
  defeat: {
    bpm: 50, mode: MODES.aeolian, root: D3, density: 0.12, phrase: [2, 3], rest: [14, 28], register: [-2, 5],
    bassChance: 0.5, arpChance: 0, progressions: [[0, 5, 3, 0]], vel: 0.45,
  },
};

/**
 * Titelthema (original): zwei Viertakt-Phrasen in D-dorisch über Harfen-Arpeggien, danach vier Takte
 * nur Arpeggien. Je Takt: Akkordstufe und Melodie als [Stufe | null, Achtel].
 */
export const TITLE_SCORE: { chord: number; mel: [number | null, number][] }[] = [
  { chord: 0, mel: [[4, 4], [3, 2], [2, 2]] },
  { chord: 6, mel: [[1, 3], [2, 1], [-1, 4]] },
  { chord: 3, mel: [[3, 2], [4, 2], [5, 2], [4, 2]] },
  { chord: 0, mel: [[2, 2], [1, 2], [0, 4]] },
  { chord: 0, mel: [[7, 4], [6, 2], [4, 2]] },
  { chord: 3, mel: [[5, 3], [4, 1], [3, 4]] },
  { chord: 6, mel: [[6, 2], [4, 2], [1, 2], [2, 2]] },
  { chord: 0, mel: [[0, 8]] },
  { chord: 0, mel: [[null, 8]] },
  { chord: 6, mel: [[null, 8]] },
  { chord: 3, mel: [[null, 8]] },
  { chord: 0, mel: [[null, 8]] },
];

/** Arpeggio-Muster relativ zur Akkordstufe (8 Achtel). */
const TITLE_ARP = [-7, -3, 0, 2, 4, 2, 0, -3];
const PLAIN_ARP = [0, 2, 4, 7, 4, 2, 0, 2];

/** Herzschlag-Trommel je Achtel: [Grundmuster, Zusatz bei hoher Bedrohung] */
const DRUM_BASE = [1, 0.55, 0, 0, 0.85, 0.45, 0, 0];
const DRUM_HIGH = [0, 0, 0.35, 0, 0, 0, 0.35, 0.25];

const isChordTone = (deg: number, chordRoot: number) => {
  const rel = (((deg - chordRoot) % 7) + 7) % 7;
  return rel === 0 || rel === 2 || rel === 4;
};

export class Composer {
  mood: MusicMood;
  private pending: MusicMood | null = null;
  private step = 0;
  private bar = -1;
  private prog: number[] = [0];
  private chord = 0;
  private lastDeg = 4;
  private phraseLeft = 0;
  private rest = 2;
  private arpBar = false;
  private titleBar = 0;
  private titleRound = 0;
  /** Titel: verbleibende Achtel der aktuellen Melodienote und Index im Takt */
  private titleNoteIdx = 0;
  private titleNoteLeft = 0;

  constructor(
    private rnd: Rng,
    mood: MusicMood = 'title',
  ) {
    this.mood = mood;
  }

  /** Neue Stimmung wird am nächsten Taktanfang wirksam (musikalischer Übergang statt Bruch). */
  setMood(m: MusicMood): void {
    this.pending = m === this.mood ? null : m;
  }

  get spec(): MoodSpec {
    return MOOD_SPECS[this.mood];
  }

  private randInt([a, b]: [number, number]): number {
    return a + Math.floor(this.rnd() * (b - a + 1));
  }

  /** Einen Achtelschritt erzeugen. threat 0..1 steuert die Trommeln. */
  next(threat = 0): StepResult {
    const notes: MusicNote[] = [];
    if (this.step === 0) this.startBar(notes);
    const spec = this.spec;

    if (this.mood === 'title') this.titleStep(notes);
    else {
      if (this.arpBar) this.arpStep(notes, PLAIN_ARP, -7, 0.26);
      this.melodyStep(notes);
    }

    if (threat > 0.04) {
      let v = DRUM_BASE[this.step];
      if (threat > 0.55) v = Math.max(v, DRUM_HIGH[this.step]);
      if (v > 0) notes.push({ voice: 'drum', midi: 38, vel: v * Math.min(1, threat * 1.15), offset: 0 });
    }

    const res: StepResult = { notes, stepDur: 30 / spec.bpm, mood: this.mood, step: this.step, bar: this.bar };
    this.step = (this.step + 1) % 8;
    return res;
  }

  private startBar(notes: MusicNote[]): void {
    if (this.pending) {
      this.mood = this.pending;
      this.pending = null;
      this.bar = -1;
      this.phraseLeft = 0;
      this.rest = 2 + Math.floor(this.rnd() * 4);
      this.titleBar = 0;
      this.titleRound = 0;
    }
    this.bar++;
    const spec = this.spec;
    if (this.mood === 'title') {
      const b = TITLE_SCORE[this.titleBar];
      this.chord = b.chord;
      this.titleNoteIdx = 0;
      this.titleNoteLeft = 0;
    } else {
      if (this.bar % this.prog.length === 0 || this.bar === 0) {
        this.prog = spec.progressions[Math.floor(this.rnd() * spec.progressions.length)];
      }
      this.chord = this.prog[this.bar % this.prog.length];
      this.arpBar = this.rnd() < spec.arpChance;
    }
    if (this.rnd() < spec.bassChance) {
      notes.push({ voice: 'bass', midi: degreeToMidi(spec.root - 12, spec.mode, this.chord), vel: 0.55, offset: 0 });
    }
  }

  private arpStep(notes: MusicNote[], pattern: readonly number[], shift: number, vel: number): void {
    const spec = this.spec;
    const deg = this.chord + pattern[this.step] + shift;
    notes.push({
      voice: 'arp',
      midi: degreeToMidi(spec.root, spec.mode, deg),
      vel: vel * (0.85 + 0.3 * this.rnd()) * (this.step === 0 ? 1.15 : 1),
      offset: this.rnd() * 0.01,
    });
  }

  private titleStep(notes: MusicNote[]): void {
    const spec = this.spec;
    this.arpStep(notes, TITLE_ARP, 0, 0.3);
    const bar = TITLE_SCORE[this.titleBar];
    if (this.titleNoteLeft <= 0 && this.titleNoteIdx < bar.mel.length) {
      const [deg, len] = bar.mel[this.titleNoteIdx++];
      this.titleNoteLeft = len;
      if (deg !== null) {
        // zweiter Durchgang eine Oktave tiefer: wärmer, Abwechslung
        const d = this.titleRound % 2 === 1 ? deg - 7 : deg;
        notes.push({ voice: 'melody', midi: degreeToMidi(spec.root, spec.mode, d), vel: spec.vel * (0.9 + 0.1 * this.rnd()), offset: 0.004 });
      }
    }
    this.titleNoteLeft--;
    if (this.step === 7) {
      this.titleBar++;
      if (this.titleBar >= TITLE_SCORE.length) {
        this.titleBar = 0;
        this.titleRound++;
      }
    }
  }

  private chooseDegree(strongBeat: boolean): number {
    const spec = this.spec;
    const [lo, hi] = spec.register;
    let total = 0;
    const cands: [number, number][] = [];
    for (let d = lo; d <= hi; d++) {
      const iv = Math.abs(d - this.lastDeg);
      let w = iv === 0 ? 0.5 : iv === 1 ? 4 : iv === 2 ? 2.2 : iv === 3 ? 0.9 : iv === 4 ? 0.6 : iv === 7 ? 0.25 : 0.05;
      if (strongBeat && isChordTone(d, this.chord)) w *= 2.5;
      // sanfter Zug zur Mitte des Registers
      const mid = (lo + hi) / 2;
      w *= 1 - Math.min(0.6, Math.abs(d - mid) / (hi - lo + 1));
      cands.push([d, w]);
      total += w;
    }
    let r = this.rnd() * total;
    for (const [d, w] of cands) {
      r -= w;
      if (r <= 0) return d;
    }
    return cands[cands.length - 1][0];
  }

  private nearestChordTone(deg: number): number {
    const [lo, hi] = this.spec.register;
    for (const off of [0, -1, 1, -2, 2, -3, 3]) {
      const d = deg + off;
      if (d >= lo && d <= hi && isChordTone(d, this.chord)) return d;
    }
    return deg;
  }

  private melodyStep(notes: MusicNote[]): void {
    if (this.rest > 0) {
      this.rest--;
      return;
    }
    const spec = this.spec;
    const strong = this.step % 2 === 0;
    const p = strong ? spec.density : spec.density * 0.25;
    if (this.rnd() >= p) return;
    if (this.phraseLeft <= 0) this.phraseLeft = this.randInt(spec.phrase);
    let deg = this.chooseDegree(this.step % 4 === 0);
    this.phraseLeft--;
    if (this.phraseLeft === 0) {
      deg = this.nearestChordTone(deg);
      this.rest = this.randInt(spec.rest);
    }
    this.lastDeg = deg;
    notes.push({
      voice: 'melody',
      midi: degreeToMidi(spec.root, spec.mode, deg),
      vel: spec.vel * (0.75 + 0.25 * this.rnd()) * (strong ? 1 : 0.8),
      offset: this.rnd() * 0.012,
    });
  }
}
