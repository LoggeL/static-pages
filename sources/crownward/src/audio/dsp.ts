// Crownward – reine DSP-/Musiktheorie-Hilfen ohne WebAudio (in Node testbar).
// Erzeugt Rohdaten (Float32Array), die engine-seitig in AudioBuffer kopiert werden.

/** Zufallsquelle 0..1 (Audio darf eigenen RNG nutzen; Simulation bleibt unberührt). */
export type Rng = () => number;

/** Kleiner, deterministischer RNG (mulberry32) für Komposition und Tests. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Kirchentonarten als Halbtonschritte ab Grundton. */
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
} as const;
export type ModeName = keyof typeof MODES;

/** Skalenstufe (0 = Grundton, negativ = darunter, 7 = Oktave) → MIDI-Note. */
export function degreeToMidi(root: number, mode: readonly number[], degree: number): number {
  const n = mode.length;
  const oct = Math.floor(degree / n);
  const idx = degree - oct * n;
  return root + oct * 12 + mode[idx];
}

export interface PluckOptions {
  /** 0..1: Helligkeit der Anregung (Laute hell, Harfe weich) */
  brightness: number;
  /** Nachklingzeit (−60 dB) des Grundtons in Sekunden */
  t60: number;
  /** Anschlagposition 0..0,5 (Kammfilter, klangfärbend); 0 = aus */
  pluckPos?: number;
  /** maximale Pufferlänge in Sekunden */
  maxDuration?: number;
}

export interface PluckData {
  data: Float32Array;
  /** tatsächliche Grundfrequenz (ganzzahlige Verzögerung) → playbackRate-Korrektur */
  actualFreq: number;
}

/**
 * Karplus-Strong-Zupfsaite: gefiltertes Rauschen in einer Verzögerungsleitung mit Mittelwertfilter.
 * Ergebnis ist auf Spitze 0,9 normiert, mit kurzem Ein- und Ausblenden (keine Knackser).
 */
export function karplusStrong(freq: number, sampleRate: number, rnd: Rng, opts: PluckOptions): PluckData {
  const f = clamp(freq, 20, sampleRate / 4);
  const n = Math.max(2, Math.round(sampleRate / f - 0.5));
  const actualFreq = sampleRate / (n + 0.5);
  const t60 = Math.max(0.05, opts.t60);
  const duration = Math.min(opts.maxDuration ?? 2.4, t60 * 0.85);
  const len = Math.max(n * 4, Math.floor(duration * sampleRate));

  // Verlustfaktor pro Umlauf so, dass der Grundton nach t60 um 60 dB gefallen ist
  const loopLoss = Math.cos((Math.PI * actualFreq) / sampleRate);
  const damping = Math.min(0.99995, Math.pow(10, -3 / (t60 * actualFreq)) / Math.max(0.5, loopLoss));

  // Anregung: Rauschen, Einpol-Tiefpass je nach Helligkeit, optional Anschlagposition
  const buf = new Float32Array(n);
  const a = 0.15 + 0.85 * clamp01(opts.brightness);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += a * (rnd() * 2 - 1 - lp);
    buf[i] = lp;
  }
  const pos = opts.pluckPos ?? 0;
  if (pos > 0) {
    const d = Math.max(1, Math.floor(n * pos));
    const copy = buf.slice();
    for (let i = 0; i < n; i++) buf[i] = copy[i] - 0.9 * copy[(i + n - d) % n];
  }
  // Gleichanteil entfernen
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  for (let i = 0; i < n; i++) buf[i] -= mean;

  const out = new Float32Array(len);
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    const nxt = buf[idx + 1 === n ? 0 : idx + 1];
    out[i] = cur;
    buf[idx] = damping * 0.5 * (cur + nxt);
    idx = idx + 1 === n ? 0 : idx + 1;
  }

  let peak = 0;
  for (let i = 0; i < len; i++) {
    const v = Math.abs(out[i]);
    if (v > peak) peak = v;
  }
  const g = peak > 1e-9 ? 0.9 / peak : 0;
  const fadeIn = Math.min(len, Math.floor(sampleRate * 0.0015));
  const fadeOut = Math.min(len, Math.floor(sampleRate * 0.06));
  for (let i = 0; i < len; i++) {
    let w = g;
    if (i < fadeIn) w *= i / fadeIn;
    const fromEnd = len - 1 - i;
    if (fromEnd < fadeOut) w *= fromEnd / fadeOut;
    out[i] *= w;
  }
  return { data: out, actualFreq };
}

/** Stereo-Impulsantwort für den Hall: zerfallendes Rauschen, Ende dunkler als Anfang. */
export function impulseResponse(sampleRate: number, seconds: number, rnd: Rng, predelay = 0.012): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const pre = Math.floor(sampleRate * predelay);
  const channels: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  const tau = seconds / 6.9; // −60 dB am Ende
  for (const ch of channels) {
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      // Tiefpass wird mit der Zeit enger → dunkler Nachhall
      const a = 0.9 - 0.75 * Math.min(1, t / seconds);
      lp += a * (rnd() * 2 - 1 - lp);
      ch[i] = lp * Math.exp(-t / tau);
    }
    // weiches Ausblenden der letzten 20 ms
    const fade = Math.min(len - pre, Math.floor(sampleRate * 0.02));
    for (let i = 0; i < fade; i++) ch[len - 1 - i] *= i / fade;
  }
  return channels;
}

/** Weißes Rauschen. */
export function whiteNoise(length: number, rnd: Rng): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rnd() * 2 - 1;
  return out;
}

/** Braunes Rauschen (integriert, mit Leck) – für Grollen, Brandung, Wind. Normiert auf Spitze ~0,9. */
export function brownNoise(length: number, rnd: Rng): Float32Array {
  const out = new Float32Array(length);
  let b = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02;
    out[i] = b;
    const v = Math.abs(b);
    if (v > peak) peak = v;
  }
  const g = peak > 0 ? 0.9 / peak : 0;
  for (let i = 0; i < length; i++) out[i] *= g;
  return out;
}

/** Nahtlose Schleife: Anfang und Ende werden über `fade` Samples überblendet. */
export function makeLoopable(data: Float32Array, fade: number): Float32Array {
  const f = Math.min(fade, Math.floor(data.length / 2));
  const len = data.length - f;
  const out = new Float32Array(len);
  out.set(data.subarray(0, len));
  for (let i = 0; i < f; i++) {
    const w = i / f;
    out[i] = data[i] * w + data[len + i] * (1 - w);
  }
  return out;
}
