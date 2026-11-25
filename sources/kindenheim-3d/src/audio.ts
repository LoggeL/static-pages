/**
 * Synthesized Web Audio agricultural diesel engine + two-tone tractor horn + checkpoint chime.
 * Unlocks cleanly on first user gesture and never throws in headless/muted environments.
 */
export class TractorAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private mainOsc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private chugLfo: OscillatorNode | null = null;
  private chugDepth: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  private hornOscA: OscillatorNode | null = null;
  private hornOscB: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;

  public muted = false;
  private initialized = false;
  private hornActive = false;

  constructor() {
    const unlock = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private ensureContext(): void {
    if (this.initialized) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.24;
      master.connect(ctx.destination);

      // Diesel engine filter & gain chain
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 210;
      filter.Q.value = 3.2;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.22;

      // Primary 4-cylinder diesel sawtooth + deep sub-octave thump
      const mainOsc = ctx.createOscillator();
      mainOsc.type = 'sawtooth';
      mainOsc.frequency.value = 38;

      const subOsc = ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.value = 19;

      const subGain = ctx.createGain();
      subGain.gain.value = 0.72;

      // Cylinder chug LFO modulating filter cutoff for authentic agricultural diesel throb
      const chugLfo = ctx.createOscillator();
      chugLfo.type = 'sine';
      chugLfo.frequency.value = 8.5;

      const chugDepth = ctx.createGain();
      chugDepth.gain.value = 72;

      chugLfo.connect(chugDepth);
      chugDepth.connect(filter.frequency);

      mainOsc.connect(filter);
      subOsc.connect(subGain);
      subGain.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(master);

      mainOsc.start();
      subOsc.start();
      chugLfo.start();

      // Classic two-tone tractor horn
      const hornFilter = ctx.createBiquadFilter();
      hornFilter.type = 'bandpass';
      hornFilter.frequency.value = 880;
      hornFilter.Q.value = 1.6;

      const hornGain = ctx.createGain();
      hornGain.gain.value = 0;

      const hornOscA = ctx.createOscillator();
      hornOscA.type = 'sawtooth';
      hornOscA.frequency.value = 335;

      const hornOscB = ctx.createOscillator();
      hornOscB.type = 'sawtooth';
      hornOscB.frequency.value = 422;

      hornOscA.connect(hornFilter);
      hornOscB.connect(hornFilter);
      hornFilter.connect(hornGain);
      hornGain.connect(master);

      hornOscA.start();
      hornOscB.start();

      this.ctx = ctx;
      this.masterGain = master;
      this.engineGain = engineGain;
      this.mainOsc = mainOsc;
      this.subOsc = subOsc;
      this.chugLfo = chugLfo;
      this.chugDepth = chugDepth;
      this.filter = filter;
      this.hornOscA = hornOscA;
      this.hornOscB = hornOscB;
      this.hornGain = hornGain;
      this.initialized = true;
    } catch {
      // Ignore if AudioContext cannot start in restricted browser context
    }
  }

  public updateEngine(rpmNorm: number, throttleLoad: number, isActiveDriveMode: boolean): void {
    if (!this.ctx || !this.mainOsc || !this.subOsc || !this.chugLfo || !this.filter || !this.engineGain || !this.chugDepth) {
      return;
    }
    const t = this.ctx.currentTime;
    const clampedRpm = Math.max(0, Math.min(1, rpmNorm));
    const clampedLoad = Math.max(0, Math.min(1, throttleLoad));

    const baseFreq = 35 + clampedRpm * 62;
    this.mainOsc.frequency.setTargetAtTime(baseFreq, t, 0.07);
    this.subOsc.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.07);
    this.chugLfo.frequency.setTargetAtTime(7.5 + clampedRpm * 16.5, t, 0.08);
    this.chugDepth.gain.setTargetAtTime(55 + clampedLoad * 85, t, 0.08);
    this.filter.frequency.setTargetAtTime(185 + clampedRpm * 340 + clampedLoad * 180, t, 0.08);

    const vol = isActiveDriveMode ? 0.16 + clampedLoad * 0.16 + clampedRpm * 0.08 : 0.04;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.12);
  }

  public setHorn(pressed: boolean): void {
    if (pressed) {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
    }
    if (this.hornActive === pressed) return;
    this.hornActive = pressed;
    if (!this.ctx || !this.hornGain || !this.hornOscA || !this.hornOscB) return;
    const t = this.ctx.currentTime;
    this.hornGain.gain.setTargetAtTime(pressed ? 0.55 : 0.0, t, pressed ? 0.02 : 0.06);
  }

  public playCheckpointChime(isTourComplete = false): void {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const t0 = this.ctx.currentTime;
    const notes = isTourComplete ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = t0 + i * 0.09;
      g.gain.setValueAtTime(0.001, start);
      g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.36);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.38);
    });
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.24, this.ctx.currentTime, 0.04);
    }
  }
}
