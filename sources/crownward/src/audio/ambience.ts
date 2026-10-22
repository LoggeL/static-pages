// Crownward – Ambiente: Wind (gefiltertes Rauschen mit Böen), Brandung an den Rändern, Vögel, Grillen.
// Dauerschichten laufen geloopt mit weich nachgeführten Pegeln; Vögel/Grillen sind zufällige Einzelklänge.

import type { MoodTargets } from './mood';
import { SmoothParam, chirp, pulseTrain, type SynthKit } from './synth';

const MAX_AMBIENT_VOICES = 6;

export class Ambience {
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private windLevel: SmoothParam;
  private windFreq: SmoothParam;
  private seaGain: GainNode;
  private seaLevel: SmoothParam;
  private sources: AudioScheduledSourceNode[] = [];
  private gustTimer = 0;
  private gust = 1;
  private voiceEnds: number[] = [];
  /** Panorama-Knoten der Einzelklänge (nach Ende trennen) */
  private pending: { end: number; nodes: AudioNode[] }[] = [];

  constructor(
    private readonly k: SynthKit,
    private readonly dest: AudioNode,
    now: number,
  ) {
    const ctx = k.ctx;
    // Wind: braunes + weißes Rauschen → Bandpass mit wandernder Mitte → Pegel
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter.connect(this.windGain);
    this.windGain.connect(dest);
    const brown = ctx.createBufferSource();
    brown.buffer = k.brown;
    brown.loop = true;
    const white = ctx.createBufferSource();
    white.buffer = k.white;
    white.loop = true;
    const whiteG = ctx.createGain();
    whiteG.gain.value = 0.18;
    brown.connect(this.windFilter);
    white.connect(whiteG);
    whiteG.connect(this.windFilter);
    brown.start(now);
    white.start(now, 0.7);
    this.sources.push(brown, white);
    this.windLevel = new SmoothParam(this.windGain.gain, 1.4);
    this.windFreq = new SmoothParam(this.windFilter.frequency, 1.6);

    // Brandung: tiefes Rauschen mit langsamem Wellen-LFO
    const seaSrc = ctx.createBufferSource();
    seaSrc.buffer = k.brown;
    seaSrc.loop = true;
    seaSrc.playbackRate.value = 0.8;
    const seaLp = ctx.createBiquadFilter();
    seaLp.type = 'lowpass';
    seaLp.frequency.value = 620;
    const swell = ctx.createGain();
    swell.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth);
    lfoDepth.connect(swell.gain);
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0;
    seaSrc.connect(seaLp);
    seaLp.connect(swell);
    swell.connect(this.seaGain);
    this.seaGain.connect(dest);
    seaSrc.start(now, 1.3);
    lfo.start(now);
    this.sources.push(seaSrc, lfo);
    this.seaLevel = new SmoothParam(this.seaGain.gain, 1.5);
  }

  get activeVoices(): number {
    return this.voiceEnds.length;
  }

  update(now: number, dt: number, m: MoodTargets, audible: boolean): void {
    const d = Math.min(0.1, Math.max(0, dt));
    this.voiceEnds = this.voiceEnds.filter((e) => e > now);
    this.pending = this.pending.filter((p) => {
      if (p.end + 0.1 > now) return true;
      for (const n of p.nodes) n.disconnect();
      return false;
    });

    // Böen: alle paar Sekunden neues Ziel für Pegel und Filtermitte
    this.gustTimer -= d;
    if (this.gustTimer <= 0) {
      this.gustTimer = 1.5 + this.k.rnd() * 3;
      this.gust = 0.65 + this.k.rnd() * 0.6;
      const night = m.music === 'night' || m.music === 'defeat';
      const lo = night ? 220 : 320;
      const hi = night ? 700 : 1100;
      this.windFreq.set(lo + this.k.rnd() * (hi - lo), now);
    }
    this.windLevel.set(m.wind * 0.2 * this.gust, now);
    this.seaLevel.set(m.sea * 0.14, now);

    if (!audible) return;
    if (m.birds > 0 && this.k.rnd() < m.birds * d) this.oneShot(now, 'bird');
    if (m.crickets > 0 && this.k.rnd() < m.crickets * d) this.oneShot(now, 'cricket');
  }

  private oneShot(now: number, kind: 'bird' | 'cricket'): void {
    if (this.voiceEnds.length >= MAX_AMBIENT_VOICES) return;
    const ctx = this.k.ctx;
    const g = ctx.createGain();
    // Pausen-Dämpfung übernimmt der Ambiente-Bus (Mixer), hier nur Zufallspegel
    g.gain.value = 0.5 + this.k.rnd() * 0.5;
    let out: AudioNode = g;
    const nodes: AudioNode[] = [g];
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = (this.k.rnd() * 2 - 1) * 0.8;
      g.connect(p);
      out = p;
      nodes.push(p);
    }
    out.connect(this.dest);
    const t = now + 0.02;
    let end: number;
    if (kind === 'bird') {
      end = chirp(this.k, { t, dest: g, base: 2500 + this.k.rnd() * 1900, syllables: 1 + Math.floor(this.k.rnd() * 4), peak: 0.045 });
    } else {
      // Grille: kurze Pulszüge um 4,5 kHz, zwei bis drei Züge
      const f = 4300 + this.k.rnd() * 700;
      const trains = 2 + Math.floor(this.k.rnd() * 2);
      const pulses = 5 + Math.floor(this.k.rnd() * 5);
      const offs: number[] = [];
      for (let tr = 0; tr < trains; tr++) for (let i = 0; i < pulses; i++) offs.push(tr * 0.32 + i * 0.034);
      end = pulseTrain(this.k, { t, dest: g, freq: f, peak: 0.02, pulses: offs, pulseLen: 0.026 });
    }
    this.voiceEnds.push(end);
    this.pending.push({ end, nodes });
  }

  dispose(now: number): void {
    for (const s of this.sources) {
      try {
        s.stop(now + 0.05);
      } catch {
        /* schon gestoppt */
      }
    }
    this.sources = [];
  }
}
