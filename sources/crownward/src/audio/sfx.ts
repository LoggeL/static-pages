// Crownward – synthetisierte Klangeffekte (original, keine Samples). Jede Funktion plant ihren Klang ab t
// in den Stimmeingang `out` (Lautstärke/Panorama/Hall setzt die Engine) und gibt das Ende zurück.

import type { CueParams, SfxId } from './cues';
import { midiToFreq } from './dsp';
import { BELL_PARTIALS, GONG_PARTIALS, bell, chirp, noise, pluck, tone, type SynthKit } from './synth';

export type SfxFn = (k: SynthKit, t: number, out: AudioNode, p: CueParams) => number;

/** Zufallsfaktor 1 ± amt/2 */
const vary = (k: SynthKit, amt: number) => 1 + (k.rnd() - 0.5) * amt;
const semis = (n: number) => Math.pow(2, n / 12);

// ---------- wiederverwendete Bausteine ----------

/** Holzklopfen (Hammer, Werkzeug, Truhe). */
function woodKnock(k: SynthKit, t: number, out: AudioNode, level = 1, pitch = 1): number {
  const f0 = 200 * pitch * vary(k, 0.16);
  const e1 = tone(k, { t, dest: out, freq: f0 * 1.7, to: f0, glide: 0.05, peak: 0.32 * level, decay: 0.07 });
  const e2 = noise(k, { t, dest: out, peak: 0.28 * level, decay: 0.045, filter: { type: 'bandpass', freq: 950 * pitch * vary(k, 0.2), q: 3 } });
  noise(k, { t, dest: out, peak: 0.07 * level, decay: 0.012, filter: { type: 'highpass', freq: 3200 } });
  return Math.max(e1, e2);
}

/** Metallisches Münzklingen. */
function clink(k: SynthKit, t: number, out: AudioNode, freq: number, level = 1, decay = 0.18): number {
  const e1 = tone(k, { t, dest: out, type: 'triangle', freq, peak: 0.16 * level, decay });
  tone(k, { t, dest: out, freq: freq * 2.76, peak: 0.05 * level, decay: decay * 0.35 });
  noise(k, { t, dest: out, peak: 0.06 * level, decay: 0.02, filter: { type: 'bandpass', freq: 5200, q: 2 } });
  return e1;
}

/** Blechbläser-artiger Ton: Sägezahn durch sich öffnenden Tiefpass. */
function brass(k: SynthKit, t: number, out: AudioNode, midi: number, dur: number, peak: number, bright = 1): number {
  const f = midiToFreq(midi);
  let end = t;
  for (const d of [-6, 6]) {
    end = tone(k, {
      t,
      dest: out,
      type: 'sawtooth',
      freq: f * 0.985,
      to: f,
      glide: 0.06,
      detune: d,
      peak: peak * 0.5,
      attack: 0.025,
      hold: Math.max(0, dur - 0.1),
      decay: 0.22,
      filter: { type: 'lowpass', freq: 500 * bright, to: 2200 * bright, glide: 0.12, q: 1.2 },
      vibrato: dur > 0.4 ? { rate: 5.2, depth: 9, delay: 0.25 } : undefined,
    });
  }
  return end;
}

/** Gezupfter Akkord (gebrochen). */
function strum(k: SynthKit, t: number, out: AudioNode, midis: number[], vel: number, spread = 0.025, brightness = 0.7): number {
  let end = t;
  midis.forEach((m, i) => {
    end = Math.max(end, pluck(k, { t: t + i * spread + k.rnd() * 0.006, dest: out, midi: m, vel: vel * vary(k, 0.2), brightness }));
  });
  return end;
}

function timpani(k: SynthKit, t: number, out: AudioNode, freq: number, peak: number): number {
  const e = tone(k, { t, dest: out, freq: freq * 1.25, to: freq, glide: 0.08, peak, decay: 0.6 });
  noise(k, { t, dest: out, color: 'brown', peak: peak * 0.5, decay: 0.15, filter: { type: 'lowpass', freq: 350 } });
  return e;
}

// ---------- Effekte ----------

export const SFX: Record<SfxId, SfxFn> = {
  coinPickup(k, t, out, p) {
    const f = 1760 * semis(p.semis) * vary(k, 0.03);
    const e1 = tone(k, { t, dest: out, freq: f, peak: 0.2, decay: 0.2 });
    tone(k, { t, dest: out, freq: f * 2.01, peak: 0.06, decay: 0.1 });
    const e2 = tone(k, { t: t + 0.045, dest: out, type: 'triangle', freq: f * 1.5, peak: 0.11, decay: 0.2 });
    noise(k, { t, dest: out, peak: 0.04, decay: 0.015, filter: { type: 'highpass', freq: 6000 } });
    return Math.max(e1, e2);
  },

  coinDrop(k, t, out) {
    const f = 1180 * vary(k, 0.05);
    clink(k, t, out, f, 0.9, 0.14);
    const e = clink(k, t + 0.11 + k.rnd() * 0.03, out, f * 1.02, 0.45, 0.1);
    noise(k, { t, dest: out, color: 'brown', peak: 0.1, decay: 0.04, filter: { type: 'lowpass', freq: 900 } });
    return e;
  },

  coinPaid(k, t, out, p) {
    // steigende Tonhöhe mit dem Zahlfortschritt (Durtonleiter über eine Oktave)
    const steps = [0, 2, 4, 5, 7, 9, 11, 12];
    const idx = Math.round(Math.min(1, Math.max(0, p.ratio)) * (steps.length - 1));
    const f = 1046.5 * semis(steps[idx]) * vary(k, 0.01);
    let end = clink(k, t, out, f, 1.5, 0.16);
    if (p.heavy) end = Math.max(end, tone(k, { t: t + 0.03, dest: out, freq: f * 1.5, peak: 0.13, decay: 0.32 }));
    return end;
  },

  payCancelled(k, t, out, p) {
    tone(k, { t, dest: out, type: 'triangle', freq: 880, peak: 0.1, decay: 0.12 });
    let end = tone(k, { t: t + 0.09, dest: out, type: 'triangle', freq: 659, peak: 0.1, decay: 0.16 });
    const n = Math.min(4, Math.max(1, p.level));
    for (let i = 0; i < n; i++) {
      end = Math.max(end, noise(k, { t: t + 0.05 + i * 0.045, dest: out, peak: 0.05, decay: 0.03, filter: { type: 'bandpass', freq: 3600 * vary(k, 0.2), q: 3 } }));
    }
    return end;
  },

  purchase(k, t, out, p) {
    // G-Dur-Zupfakkord; Siedlungsausbau erhält zusätzlich eine Glocke
    let end = strum(k, t, out, [67, 71, 74, 79], 0.42, 0.028, 0.75);
    if (p.variant === 'upgradeTown' || p.variant === 'repairShip') {
      end = Math.max(end, bell(k, { t: t + 0.1, dest: out, freq: 784, peak: 0.07, decay: 1.4 }));
    }
    return end;
  },

  buildStart(k, t, out) {
    woodKnock(k, t, out, 0.6, 0.9);
    return strum(k, t + 0.02, out, [50, 57, 62], 0.22, 0.035, 0.4);
  },

  toolStocked(k, t, out, p) {
    let end = woodKnock(k, t, out, 0.8, 1.3);
    if (p.variant === 'bow') end = Math.max(end, tone(k, { t: t + 0.01, dest: out, type: 'triangle', freq: 196, to: 180, peak: 0.07, decay: 0.3 }));
    else if (p.variant === 'hammer') end = Math.max(end, tone(k, { t: t + 0.01, dest: out, freq: 2200, peak: 0.04, decay: 0.22 }));
    else {
      tone(k, { t: t + 0.01, dest: out, freq: 3100, peak: 0.035, decay: 0.4 });
      end = Math.max(end, tone(k, { t: t + 0.01, dest: out, freq: 4700, peak: 0.02, decay: 0.3 }));
    }
    return end;
  },

  hammer(k, t, out) {
    return woodKnock(k, t, out, 1, 1);
  },

  buildComplete(k, t, out, p) {
    // kleine Fanfare: A4 D5 F#5 A5
    const seq: [number, number, number][] = [
      [69, 0, 0.1],
      [74, 0.11, 0.1],
      [78, 0.22, 0.12],
      [81, 0.36, 0.55],
    ];
    let end = t;
    for (const [m, dt, dur] of seq) {
      end = Math.max(end, brass(k, t + dt, out, m, dur, 0.09));
      pluck(k, { t: t + dt, dest: out, midi: m, vel: 0.22, brightness: 0.75 });
    }
    if (p.variant === 'townCenter' || p.level >= 3) {
      end = Math.max(end, bell(k, { t: t + 0.36, dest: out, freq: 587, peak: 0.08, decay: 1.8 }));
      pluck(k, { t: t + 0.36, dest: out, midi: 50, vel: 0.4, brightness: 0.5 });
    }
    return end;
  },

  repaired(k, t, out) {
    woodKnock(k, t, out, 0.6, 1.1);
    woodKnock(k, t + 0.1, out, 0.45, 1.15);
    return bell(k, { t: t + 0.18, dest: out, freq: 1318, peak: 0.045, decay: 0.6 });
  },

  recruit(k, t, out) {
    bell(k, { t, dest: out, freq: 880, peak: 0.07, decay: 1.0 });
    return bell(k, { t: t + 0.12, dest: out, freq: 1174.7, peak: 0.07, decay: 1.2 });
  },

  roleChange(k, t, out, p) {
    const f = p.variant === 'builder' ? 659.3 : p.variant === 'archer' ? 987.8 : p.variant === 'farmer' ? 784 : p.variant === 'vagrant' ? 587.3 : 880;
    const e = bell(k, { t, dest: out, freq: f, peak: 0.08, decay: 1.1 });
    pluck(k, { t, dest: out, midi: Math.round(69 + 12 * Math.log2(f / 440)) - 12, vel: 0.3, brightness: 0.6 });
    return e;
  },

  vagrantSpawn(k, t, out) {
    noise(k, { t, dest: out, peak: 0.08, attack: 0.05, decay: 0.25, filter: { type: 'bandpass', freq: 2500, q: 0.8 } });
    return noise(k, { t: t + 0.25, dest: out, peak: 0.07, attack: 0.05, decay: 0.2, filter: { type: 'bandpass', freq: 2100, q: 0.8 } });
  },

  harvest(k, t, out) {
    noise(k, { t, dest: out, peak: 0.09, attack: 0.03, decay: 0.22, filter: { type: 'bandpass', freq: 3200, to: 1500, q: 1.2 } });
    return clink(k, t + 0.16, out, 1568 * vary(k, 0.04), 0.6, 0.15);
  },

  arrowFired(k, t, out) {
    const f = 250 * vary(k, 0.12);
    tone(k, { t, dest: out, type: 'triangle', freq: f, to: f * 0.6, glide: 0.12, peak: 0.14, decay: 0.18, filter: { type: 'lowpass', freq: 1600 } });
    noise(k, { t, dest: out, peak: 0.1, decay: 0.015, filter: { type: 'highpass', freq: 2500 } });
    return noise(k, { t: t + 0.02, dest: out, peak: 0.045, attack: 0.04, decay: 0.28, filter: { type: 'bandpass', freq: 2400, to: 700, q: 1.2 } });
  },

  arrowHit(k, t, out, p) {
    if (p.variant === 'enemy') {
      noise(k, { t, dest: out, peak: 0.2, decay: 0.06, filter: { type: 'lowpass', freq: 1200 } });
      noise(k, { t, dest: out, peak: 0.07, decay: 0.08, filter: { type: 'bandpass', freq: 700, q: 5 } });
      return tone(k, { t, dest: out, freq: 160, to: 90, peak: 0.18, decay: 0.08 });
    }
    if (p.variant === 'rabbit') return tone(k, { t, dest: out, freq: 180, to: 110, peak: 0.11, decay: 0.06 });
    noise(k, { t, dest: out, peak: 0.11, decay: 0.03, filter: { type: 'bandpass', freq: 1800 * vary(k, 0.2), q: 2 } });
    return tone(k, { t, dest: out, freq: 400, to: 250, peak: 0.05, decay: 0.04 });
  },

  coinPop(k, t, out) {
    return tone(k, { t, dest: out, freq: 1318, to: 1760, glide: 0.05, peak: 0.11, decay: 0.18 });
  },

  enemySpawn(k, t, out, p) {
    // fernes Grollen aus dem Nebelriss
    const lp = p.heavy ? 110 : 160;
    const e1 = noise(k, { t, dest: out, color: 'brown', peak: 0.42, attack: 0.5, hold: 0.4, decay: p.heavy ? 1.6 : 1.2, filter: { type: 'lowpass', freq: lp, q: 0.9 } });
    const e2 = tone(k, { t, dest: out, freq: p.heavy ? 33 : 41, to: p.heavy ? 29 : 37, peak: 0.16, attack: 0.4, decay: 1.5, vibrato: { rate: 3.5, depth: 30 } });
    return Math.max(e1, e2);
  },

  enemyHit(k, t, out, p) {
    if (p.heavy) {
      noise(k, { t, dest: out, peak: 0.22, decay: 0.12, filter: { type: 'bandpass', freq: 900, to: 400, q: 2.5 } });
      return tone(k, { t, dest: out, type: 'triangle', freq: 220, to: 120, peak: 0.18, decay: 0.12 });
    }
    noise(k, { t, dest: out, peak: 0.21, decay: 0.08, filter: { type: 'bandpass', freq: 2200 * vary(k, 0.2), to: 900, q: 3 } });
    return tone(k, { t, dest: out, freq: 620 * vary(k, 0.15), to: 300, peak: 0.09, decay: 0.07 });
  },

  enemyDied(k, t, out, p) {
    // Zischen/Puff: Nebel löst sich
    const len = p.heavy ? 0.9 : 0.5;
    let end = noise(k, { t, dest: out, peak: p.heavy ? 0.3 : 0.24, decay: len, filter: { type: 'lowpass', freq: 3600, to: 240, glide: len * 0.9, q: 0.7 } });
    noise(k, { t, dest: out, color: 'brown', peak: 0.2, decay: len * 0.8, filter: { type: 'lowpass', freq: 400 } });
    tone(k, { t, dest: out, freq: 340 * vary(k, 0.2), to: 80, peak: 0.07, decay: len * 0.6 });
    if (p.heavy) end = Math.max(end, tone(k, { t, dest: out, freq: 70, to: 35, peak: 0.24, decay: 0.6 }));
    return end;
  },

  enemyEscaped(k, t, out, p) {
    // höhnisches Quieken, das sich entfernt
    const base = p.variant === 'crown' ? 620 : 900;
    tone(k, { t, dest: out, type: 'sawtooth', freq: base, to: base * 0.66, peak: 0.2, decay: 0.32, filter: { type: 'bandpass', freq: 1300, q: 3 }, vibrato: { rate: 9, depth: 60 } });
    return tone(k, { t: t + 0.2, dest: out, type: 'sawtooth', freq: base * 1.12, to: base * 0.7, peak: 0.17, decay: 0.38, filter: { type: 'bandpass', freq: 1300, q: 3 }, vibrato: { rate: 9, depth: 60 } });
  },

  enemiesDissolved(k, t, out, p) {
    let end = noise(k, { t, dest: out, peak: 0.08, attack: 0.4, decay: 1.3, filter: { type: 'highpass', freq: 3000, to: 1100, q: 0.7 } });
    const n = Math.min(6, Math.max(2, p.level));
    const penta = [86, 88, 91, 93, 95, 98];
    for (let i = 0; i < n; i++) {
      end = Math.max(end, tone(k, { t: t + 0.25 + i * 0.11 + k.rnd() * 0.04, dest: out, freq: midiToFreq(penta[Math.floor(k.rnd() * penta.length)]), peak: 0.03, decay: 0.45 }));
    }
    return end;
  },

  wallHit(k, t, out, p) {
    const e = tone(k, { t, dest: out, freq: 95 * vary(k, 0.1), to: 52, peak: 0.38, decay: 0.18 });
    noise(k, { t, dest: out, color: 'brown', peak: 0.32, decay: 0.12, filter: { type: 'lowpass', freq: 500 } });
    if (p.ratio < 0.35) {
      noise(k, { t: t + 0.01, dest: out, peak: 0.12, decay: 0.05, filter: { type: 'bandpass', freq: 1600 * vary(k, 0.3), q: 2 } });
      tone(k, { t: t + 0.02, dest: out, type: 'sawtooth', freq: 110, to: 140, peak: 0.03, decay: 0.15, filter: { type: 'bandpass', freq: 700, q: 6 } });
    }
    return e;
  },

  wallDestroyed(k, t, out) {
    let end = noise(k, { t, dest: out, peak: 0.38, decay: 1.2, filter: { type: 'lowpass', freq: 5000, to: 300, glide: 1.0 } });
    end = Math.max(end, noise(k, { t, dest: out, color: 'brown', peak: 0.48, decay: 1.4, filter: { type: 'lowpass', freq: 260 } }));
    tone(k, { t, dest: out, freq: 70, to: 32, peak: 0.38, decay: 0.8 });
    for (let i = 0; i < 5; i++) {
      noise(k, { t: t + k.rnd() * 0.6, dest: out, peak: 0.14, decay: 0.04 + k.rnd() * 0.05, filter: { type: 'bandpass', freq: 800 + k.rnd() * 1700, q: 2 } });
    }
    return end;
  },

  playerHit(k, t, out, p) {
    // Aufprall + Alarm (kleine Sekunde, abwärts) + verstreute Münzen
    noise(k, { t, dest: out, peak: 0.28, decay: 0.08, filter: { type: 'lowpass', freq: 2000 } });
    tone(k, { t, dest: out, freq: 180, to: 90, peak: 0.28, decay: 0.12 });
    const lp = { type: 'lowpass' as BiquadFilterType, freq: 2400 };
    tone(k, { t: t + 0.02, dest: out, type: 'square', freq: 740, peak: 0.045, decay: 0.2, hold: 0.06, filter: lp });
    tone(k, { t: t + 0.02, dest: out, type: 'square', freq: 784, peak: 0.045, decay: 0.2, hold: 0.06, filter: lp });
    tone(k, { t: t + 0.16, dest: out, type: 'square', freq: 698, peak: 0.04, decay: 0.25, hold: 0.06, filter: lp });
    let end = tone(k, { t: t + 0.16, dest: out, type: 'square', freq: 740, peak: 0.04, decay: 0.25, hold: 0.06, filter: lp });
    const n = Math.min(3, Math.max(0, p.level));
    for (let i = 0; i < n; i++) end = Math.max(end, clink(k, t + 0.05 + i * 0.06, out, 1500 + k.rnd() * 600, 0.45, 0.12));
    return end;
  },

  citizenHit(k, t, out) {
    tone(k, { t, dest: out, freq: 150, to: 80, peak: 0.2, decay: 0.1 });
    return tone(k, { t, dest: out, type: 'sawtooth', freq: 260 * vary(k, 0.15), to: 170, glide: 0.15, peak: 0.08, attack: 0.01, decay: 0.18, filter: { type: 'bandpass', freq: 700, q: 2 } });
  },

  crownLost(k, t, out) {
    // tiefer, dissonanter Cluster + Klirren der fallenden Krone
    let end = t;
    for (const f of [55, 58.27, 77.78]) {
      end = Math.max(end, tone(k, { t, dest: out, type: 'sawtooth', freq: f, peak: 0.1, attack: 0.05, hold: 0.5, decay: 3, filter: { type: 'lowpass', freq: 600, to: 150, glide: 3 } }));
    }
    bell(k, { t, dest: out, freq: 523, peak: 0.12, decay: 2, partials: BELL_PARTIALS });
    bell(k, { t: t + 0.35, dest: out, freq: 540, peak: 0.06, decay: 1.2 });
    noise(k, { t, dest: out, color: 'brown', peak: 0.3, decay: 0.8, filter: { type: 'lowpass', freq: 200 } });
    return end;
  },

  nightWarning(k, t, out, p) {
    // Horn: verstimmte Sägezähne durch sich öffnenden Tiefpass; Fahlmond tiefer und mit Reibung
    const f = p.heavy ? 110 : 146.83;
    const call = (start: number, freq: number, dur: number, peak: number) => {
      let e = start;
      for (const d of [-7, 7]) {
        e = tone(k, {
          t: start,
          dest: out,
          type: 'sawtooth',
          freq: freq * 0.96,
          to: freq,
          glide: 0.15,
          detune: d,
          peak,
          attack: 0.25,
          hold: dur,
          decay: 0.8,
          filter: { type: 'lowpass', freq: 280, to: 1300, glide: 0.5, q: 1.5 },
          vibrato: { rate: 4.6, depth: 7, delay: 0.5 },
        });
      }
      return e;
    };
    call(t, f, 1.0, 0.11);
    let end = call(t + 1.7, f * 0.749, 1.4, 0.1);
    if (p.heavy) {
      tone(k, { t: t + 1.7, dest: out, type: 'sawtooth', freq: f * 0.749 * semis(1), peak: 0.05, attack: 0.4, hold: 1.2, decay: 0.9, filter: { type: 'lowpass', freq: 600 } });
      end = Math.max(end, tone(k, { t, dest: out, freq: f / 2, peak: 0.16, attack: 0.6, hold: 2.2, decay: 1.2 }));
    }
    return end;
  },

  dawnBirds(k, t, out) {
    let end = t;
    for (let i = 0; i < 8; i++) {
      end = Math.max(end, chirp(k, { t: t + i * 0.27 + k.rnd() * 0.15, dest: out, base: 2600 + k.rnd() * 1600, syllables: 2 + Math.floor(k.rnd() * 3), peak: 0.09 }));
    }
    return end;
  },

  nightGong(k, t, out) {
    noise(k, { t, dest: out, color: 'brown', peak: 0.12, decay: 0.1, filter: { type: 'lowpass', freq: 400 } });
    return bell(k, { t, dest: out, freq: 65, peak: 0.34, decay: 4.5, partials: GONG_PARTIALS, attack: 0.012, wobble: 6 });
  },

  dayChime(k, t, out) {
    const end = strum(k, t, out, [74, 78, 81, 86], 0.32, 0.12, 0.8);
    return Math.max(end, bell(k, { t: t + 0.36, dest: out, freq: 1174.7, peak: 0.05, decay: 1.6 }));
  },

  duskBell(k, t, out) {
    bell(k, { t, dest: out, freq: 196, peak: 0.12, decay: 2.6 });
    return bell(k, { t: t + 1.2, dest: out, freq: 146.8, peak: 0.08, decay: 2.8 });
  },

  chestOpened(k, t, out, p) {
    tone(k, { t, dest: out, type: 'sawtooth', freq: 90, to: 140, peak: 0.045, attack: 0.05, decay: 0.32, filter: { type: 'bandpass', freq: 600, q: 6 } });
    woodKnock(k, t + 0.32, out, 0.7, 0.8);
    const n = 8 + Math.min(10, Math.max(0, p.level));
    const penta = [84, 86, 88, 91, 93, 96, 98, 100];
    let end = t;
    for (let i = 0; i < n; i++) {
      end = Math.max(
        end,
        tone(k, { t: t + 0.35 + i * 0.045 + k.rnd() * 0.02, dest: out, freq: midiToFreq(penta[Math.floor(k.rnd() * penta.length)]), peak: 0.045, decay: 0.25 }),
      );
    }
    noise(k, { t: t + 0.35, dest: out, peak: 0.03, attack: 0.1, decay: 0.8, filter: { type: 'highpass', freq: 6000 } });
    return end;
  },

  shrineActivated(k, t, out, p) {
    const shift = p.variant === 'hammer' ? -5 : 0;
    let end = t;
    for (const m of [74, 78, 81, 85]) {
      for (const d of [-8, 8]) {
        end = Math.max(end, tone(k, { t, dest: out, type: 'triangle', freq: midiToFreq(m + shift), detune: d, peak: 0.028, attack: 0.6, decay: 2.2 }));
      }
    }
    tone(k, { t, dest: out, freq: midiToFreq(38 + shift), peak: 0.08, attack: 0.5, decay: 2 });
    const top = p.variant === 'bow' ? 96 : 91;
    for (let i = 0; i < 7; i++) {
      tone(k, { t: t + 0.3 + i * 0.16, dest: out, freq: midiToFreq(top - (i % 3) * 3 + shift), peak: 0.03, decay: 0.5 });
    }
    return end;
  },

  shipStage(k, t, out, p) {
    tone(k, { t, dest: out, type: 'sawtooth', freq: 70, to: 95, peak: 0.04, attack: 0.08, decay: 0.5, filter: { type: 'bandpass', freq: 450, q: 7 } });
    for (let i = 0; i < 3; i++) woodKnock(k, t + 0.15 + i * 0.17, out, 0.8, 0.85);
    const lvl = Math.max(1, Math.min(3, p.level));
    const midi = [0, 50, 52, 55][lvl];
    let end = brass(k, t + 0.7, out, midi, 0.8 + lvl * 0.2, 0.12, 0.8);
    if (lvl >= 3) end = Math.max(end, strum(k, t + 0.7, out, [50, 57, 62, 66, 69], 0.4, 0.04, 0.7));
    return end;
  },

  victory(k, t, out) {
    // eigene Siegesfanfare in D-mixolydisch
    const seq: [number, number, number][] = [
      [62, 0, 0.14],
      [66, 0.18, 0.14],
      [69, 0.36, 0.14],
      [74, 0.54, 0.55],
      [72, 1.2, 0.18],
      [74, 1.42, 1.2],
    ];
    let end = t;
    for (const [m, dt, dur] of seq) end = Math.max(end, brass(k, t + dt, out, m, dur, 0.13));
    strum(k, t + 0.54, out, [50, 57, 62, 66, 69, 74], 0.38, 0.03, 0.75);
    end = Math.max(end, strum(k, t + 1.42, out, [50, 57, 62, 66, 69, 74, 78], 0.42, 0.035, 0.8));
    for (const dt of [0, 0.54, 1.42]) timpani(k, t + dt, out, 73.4, 0.3);
    end = Math.max(end, bell(k, { t: t + 1.42, dest: out, freq: 1174.7, peak: 0.07, decay: 2.2 }));
    return end;
  },

  defeat(k, t, out) {
    const seq: [number, number, number][] = [
      [62, 0, 0.45],
      [60, 0.55, 0.45],
      [58, 1.1, 0.45],
      [57, 1.65, 1.5],
    ];
    let end = t;
    for (const [m, dt, dur] of seq) end = Math.max(end, brass(k, t + dt, out, m - 12, dur, 0.1, 0.55));
    for (const f of [36.71, 55]) {
      end = Math.max(end, tone(k, { t, dest: out, type: 'sawtooth', freq: f, peak: 0.07, attack: 0.5, hold: 1.5, decay: 2.5, filter: { type: 'lowpass', freq: 300 } }));
    }
    bell(k, { t: t + 1.65, dest: out, freq: 55, peak: 0.16, decay: 3.5, partials: GONG_PARTIALS, wobble: 5 });
    return end;
  },

  purseFull(k, t, out) {
    let tt = t;
    let end = t;
    for (let i = 0; i < 5; i++) {
      end = Math.max(end, noise(k, { t: tt, dest: out, color: 'brown', peak: 0.2, decay: 0.03, filter: { type: 'lowpass', freq: 900, q: 1 } }));
      tt += 0.03 + k.rnd() * 0.04;
    }
    tone(k, { t, dest: out, freq: 300, to: 220, peak: 0.1, decay: 0.05 });
    return end;
  },

  // ---------- Menü ----------
  uiClick(k, t, out) {
    noise(k, { t, dest: out, peak: 0.22, decay: 0.02, filter: { type: 'bandpass', freq: 2400, q: 4 } });
    return tone(k, { t, dest: out, freq: 1200, peak: 0.12, decay: 0.04 });
  },
  uiOpen(k, t, out) {
    pluck(k, { t, dest: out, midi: 74, vel: 0.32, brightness: 0.75 });
    return pluck(k, { t: t + 0.06, dest: out, midi: 81, vel: 0.32, brightness: 0.75 });
  },
  uiClose(k, t, out) {
    pluck(k, { t, dest: out, midi: 81, vel: 0.3, brightness: 0.6 });
    return pluck(k, { t: t + 0.06, dest: out, midi: 74, vel: 0.3, brightness: 0.6 });
  },
  uiError(k, t, out) {
    const lp = { type: 'lowpass' as BiquadFilterType, freq: 900 };
    let end = t;
    for (const dt of [0, 0.12]) {
      tone(k, { t: t + dt, dest: out, type: 'square', freq: 180, peak: 0.05, decay: 0.1, hold: 0.04, filter: lp });
      end = tone(k, { t: t + dt, dest: out, type: 'square', freq: 190, peak: 0.05, decay: 0.1, hold: 0.04, filter: lp });
    }
    return end;
  },
  uiStart(k, t, out) {
    const end = strum(k, t, out, [62, 66, 69, 74, 78], 0.36, 0.04, 0.75);
    return Math.max(end, bell(k, { t: t + 0.2, dest: out, freq: 1174.7, peak: 0.05, decay: 1.4 }));
  },
};

/**
 * Spielt einen Effekt und liefert sein tatsächliches Ende: das Maximum aus dem Rückgabewert und dem
 * spätesten Hüllkurvenende aller dabei geplanten Quellen (k.horizon). So klingen Zupfsaiten und Glocken,
 * die eine Effektfunktion nicht in ihr Ende einrechnet, aus, bevor die Engine die Stimme trennt.
 */
export function playSfx(id: SfxId, k: SynthKit, t: number, out: AudioNode, p: CueParams): number {
  k.horizon = t;
  const end = SFX[id](k, t, out, p);
  return Math.max(end, k.horizon);
}
