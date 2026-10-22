// Crownward – Regressionstest: Das Ende, das eine Effektfunktion zurückgibt, muss alle von ihr geplanten
// Quellen abdecken. Die Engine trennt Gain/Panner/Hall-Send einer Stimme kurz nach diesem Ende (sweep);
// endet eine Zupfsaite oder Glocke später, würde sie hart abgeschnitten (Knacksen, Hall reißt ab).
import { describe, expect, it } from 'vitest';
import type { CueParams, SfxId } from '../../src/audio/cues';
import { mulberry32 } from '../../src/audio/dsp';
import { SFX, playSfx } from '../../src/audio/sfx';
import { createSynthKit } from '../../src/audio/synth';

class P {
  value = 0;
  setValueAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  setTargetAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class N {
  connect<T>(d: T): T {
    return d;
  }
  disconnect() {}
}
/** geplante Stoppzeiten aller Quellen (Oszillatoren, Puffer) */
const stops: number[] = [];
class Src extends N {
  onended: (() => void) | null = null;
  buffer: unknown = null;
  loop = false;
  type = 'sine';
  playbackRate = new P();
  detune = new P();
  frequency = new P();
  start() {}
  stop(t: number) {
    stops.push(t);
  }
}
class G extends N {
  gain = new P();
}
class F extends N {
  type = 'lowpass';
  frequency = new P();
  Q = new P();
  gain = new P();
}
class Pan extends N {
  pan = new P();
}
class Buf {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  get duration() {
    return this.length / this.sampleRate;
  }
  copyToChannel() {}
}
const ctx = {
  sampleRate: 48000,
  currentTime: 0,
  createBuffer: (c: number, l: number, r: number) => new Buf(c, l, r),
  createOscillator: () => new Src(),
  createBufferSource: () => new Src(),
  createGain: () => new G(),
  createBiquadFilter: () => new F(),
  createStereoPanner: () => new Pan(),
} as unknown as BaseAudioContext;

const VARIANTS: Partial<CueParams>[] = [
  {},
  { heavy: true, level: 3, ratio: 1 },
  { ratio: 0.2, level: 0 },
  { level: 12, semis: 16 },
  ...['enemy', 'rabbit', 'ground', 'builder', 'archer', 'farmer', 'vagrant', 'bow', 'hammer', 'scythe', 'crown', 'wall'].map((variant) => ({ variant })),
  { variant: 'upgradeTown', level: 1 },
  { variant: 'repairShip', level: 2 },
  { variant: 'townCenter', level: 3 },
];

describe('Effekt-Ende deckt alle Quellen ab', () => {
  it('kein Effekt plant eine Quelle, die nach seinem gemeldeten Ende weiterklingt', () => {
    const kit = createSynthKit(ctx, mulberry32(7));
    const late: string[] = [];
    let checked = 0;
    for (const id of Object.keys(SFX) as SfxId[]) {
      for (const v of VARIANTS) {
        // mehrere Zufallsläufe: Zeitversätze (k.rnd) variieren je Aufruf
        for (let rep = 0; rep < 4; rep++) {
          stops.length = 0;
          const t = 1;
          const p: CueParams = { ratio: 0, level: 0, heavy: false, variant: '', semis: 0, ...v };
          const end = playSfx(id, kit, t, new G() as unknown as AudioNode, p);
          // Quellen stoppen 10–20 ms nach dem Ende ihrer Hüllkurve
          const last = Math.max(...stops) - 0.02;
          checked++;
          if (last > end + 1e-6) late.push(`${id} ${JSON.stringify(v)}: Ende ${(end - t).toFixed(3)} s, letzte Quelle ${(last - t).toFixed(3)} s`);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(late, late.slice(0, 12).join('\n')).toEqual([]);
  });

  it('Rolle Bauarbeiter: die Zupfsaite klingt länger als die Glocke und wird ins Ende eingerechnet', () => {
    const kit = createSynthKit(ctx, mulberry32(3));
    const p: CueParams = { ratio: 0, level: 0, heavy: false, variant: 'builder', semis: 0 };
    stops.length = 0;
    const raw = SFX.roleChange(kit, 1, new G() as unknown as AudioNode, p);
    const last = Math.max(...stops);
    // Ausgangslage des Befunds: Glocke endet nach ~1,1 s, die Saite erst deutlich später
    expect(last - raw).toBeGreaterThan(0.3);
    stops.length = 0;
    const end = playSfx('roleChange', kit, 1, new G() as unknown as AudioNode, p);
    expect(end).toBeGreaterThanOrEqual(Math.max(...stops) - 0.02 - 1e-9);
  });
});
