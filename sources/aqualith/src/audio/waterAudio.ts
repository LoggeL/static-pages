import type { FluidTelemetry } from '../types.ts';

const MASTER_GAIN_UNMUTED = 0.42;
const NOISE_BUFFER_SECONDS = 3.0;
const NOISE_CROSSFADE_SECONDS = 0.18;
const MAX_ACTIVE_TRANSIENT_VOICES = 24;

// Gentle crystal pentatonic pitches between ~1920 Hz and ~3080 Hz for musical ice sculpting
const ICE_CHIME_FREQS = [1975.53, 2217.46, 2489.02, 2637.02, 2959.96, 3080.0];
// Victory ascending aquatic pentatonic arpeggio: C5, E5, G5, B5, D6
const VICTORY_ARPEGGIO_FREQS = [523.25, 659.25, 783.99, 987.77, 1174.66];

type FoleyKey =
  | 'splash'
  | 'iceFreeze'
  | 'iceShatter'
  | 'wallBreak'
  | 'turbineComplete'
  | 'magmaQuench'
  | 'vortexFire'
  | 'victory'
  | 'mineExplosion'
  | 'valveClank'
  | 'portalWhoosh';

const FOLEY_COOLDOWNS_MS: Record<FoleyKey, number> = {
  splash: 75, // >= 65ms
  iceFreeze: 62, // >= 55ms
  iceShatter: 140,
  wallBreak: 220,
  turbineComplete: 350,
  magmaQuench: 300,
  vortexFire: 120,
  victory: 800,
  mineExplosion: 200,
  valveClank: 75,
  portalWhoosh: 95,
};

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function nowMs(): number {
  return typeof globalThis.performance !== 'undefined' ? globalThis.performance.now() : Date.now();
}

/**
 * Procedural Web Audio engine for AQUALITH.
 * Generates continuous stereo water/steam beds, turbine mechanical whirr,
 * and rate-limited warm crystalline/hydraulic foley with zero pre-gesture AudioContext allocation.
 */
export class WaterAudioEngine {
  private ctx: AudioContext | null = null;
  private unavailable = false;
  private muted = false;

  private masterGain: GainNode | null = null;
  private busGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private waterNoiseSource: AudioBufferSourceNode | null = null;
  private steamNoiseSource: AudioBufferSourceNode | null = null;

  private lowFlowFilter: BiquadFilterNode | null = null;
  private lowFlowGain: GainNode | null = null;
  private rushFilter: BiquadFilterNode | null = null;
  private rushGain: GainNode | null = null;
  private waterWarmthFilter: BiquadFilterNode | null = null;

  private steamHpFilter: BiquadFilterNode | null = null;
  private steamLpFilter: BiquadFilterNode | null = null;
  private steamGain: GainNode | null = null;

  private turbineSine: OscillatorNode | null = null;
  private turbineTri: OscillatorNode | null = null;
  private turbineTriFilter: BiquadFilterNode | null = null;
  private turbineTriGain: GainNode | null = null;
  private turbineGain: GainNode | null = null;

  private relayNoiseSource: AudioBufferSourceNode | null = null;
  private relayCrackleFilter: BiquadFilterNode | null = null;
  private relayCrackleGain: GainNode | null = null;
  private relayBuzzOsc: OscillatorNode | null = null;
  private relayBuzzFilter: BiquadFilterNode | null = null;
  private relayBuzzGain: GainNode | null = null;
  private relayLfo: OscillatorNode | null = null;
  private relayLfoGain: GainNode | null = null;
  private relayMasterGain: GainNode | null = null;

  private smoothFlow = 0;
  private smoothRush = 0;
  private smoothSteam = 0;
  private smoothRpm = 0;
  private smoothRelay = 0;
  private prevSplash = 0;
  private iceChimeIndex = 0;
  private readonly voiceDeadlines: number[] = [];

  private readonly prevCounters = {
    iceFreeze: 0,
    iceShatter: 0,
    wallBreak: 0,
    magmaQuench: 0,
    turbineComplete: 0,
    mineDetonate: 0,
    valveToggle: 0,
    portalPulse: 0,
  };

  private readonly lastPlayedMs: Record<FoleyKey, number> = {
    splash: -1e9,
    iceFreeze: -1e9,
    iceShatter: -1e9,
    wallBreak: -1e9,
    turbineComplete: -1e9,
    magmaQuench: -1e9,
    vortexFire: -1e9,
    victory: -1e9,
    mineExplosion: -1e9,
    valveClank: -1e9,
    portalWhoosh: -1e9,
  };

  /** Creates or resumes AudioContext strictly on a user gesture; never throws in headless environments. */
  public unlock(): void {
    if (this.unavailable) return;

    try {
      if (!this.ctx) {
        const AudioCtx =
          globalThis.AudioContext ??
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) {
          this.unavailable = true;
          return;
        }
        this.ctx = new AudioCtx();
        this.initGraph(this.ctx);
      }

      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {
          // Ignore autoplay/headless resume rejections cleanly
        });
      }

      if (this.masterGain) {
        const t = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(t);
        this.masterGain.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN_UNMUTED, t, 0.025);
      }
    } catch {
      this.ctx = null;
      this.unavailable = true;
    }
  }

  public setMuted(m: boolean): void {
    this.muted = Boolean(m);
    if (!this.ctx || !this.masterGain) return;
    try {
      const t = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN_UNMUTED, t, 0.03);
    } catch {
      // Ignore if context is closed/unavailable
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  /**
   * Smoothly modulates continuous water bed filters, steam hiss, and turbine mechanical whirr,
   * while rate-limit triggering transient foley from simulation telemetry.
   */
  public update(telemetry: FluidTelemetry, dt: number): void {
    if (!this.ctx || this.unavailable || this.ctx.state === 'closed') return;

    const safeDt = Number.isFinite(dt) ? clamp(dt, 0.001, 0.25) : 0.016;
    const alpha = 1 - Math.exp(-safeDt * 8.5);
    const t = this.ctx.currentTime;

    const presence = clamp(telemetry.particleCount / 420, 0, 1);
    const avgSpeed = Math.max(0, telemetry.avgSpeed || 0);
    const ke = Math.max(0, telemetry.kineticEnergy || 0);

    const speedNorm = 1 - Math.exp(-avgSpeed * 0.42);
    const keNorm = clamp(Math.log1p(ke) / 9.2, 0, 1);

    const targetFlow = presence * clamp(0.18 + 0.52 * speedNorm + 0.35 * keNorm, 0, 1);
    const targetRush = presence * clamp(0.62 * speedNorm + 0.38 * keNorm, 0, 1);
    const targetSteam = clamp(telemetry.magmaSteamIntensity || 0, 0, 1.4);
    const rpmRaw = Math.max(0, telemetry.maxTurbineRpm || 0);
    const targetRpm = rpmRaw < 0.05 ? 0 : clamp(Math.pow(rpmRaw / 95, 0.72), 0, 1.15);
    const targetRelay = clamp(telemetry.relayActiveIntensity || 0, 0, 1.2);

    this.smoothFlow += (targetFlow - this.smoothFlow) * alpha;
    this.smoothRush += (targetRush - this.smoothRush) * alpha;
    this.smoothSteam += (Math.min(1, targetSteam) - this.smoothSteam) * alpha;
    this.smoothRpm += (targetRpm - this.smoothRpm) * alpha;
    this.smoothRelay += (Math.min(1, targetRelay) - this.smoothRelay) * alpha;

    try {
      if (this.lowFlowFilter && this.lowFlowGain) {
        const lowFreq = 250 + this.smoothFlow * 210; // centers ~320 Hz during gentle flow
        const lowGain = presence * (0.04 + this.smoothFlow * 0.24);
        this.lowFlowFilter.frequency.setTargetAtTime(lowFreq, t, 0.06);
        this.lowFlowGain.gain.setTargetAtTime(lowGain, t, 0.06);
      }

      if (this.rushFilter && this.rushGain) {
        const rushFreq = 860 + this.smoothRush * 760; // centers ~1150 Hz during lively rush
        const rushGain = presence * (0.005 + Math.pow(this.smoothRush, 1.35) * 0.27);
        this.rushFilter.frequency.setTargetAtTime(rushFreq, t, 0.06);
        this.rushGain.gain.setTargetAtTime(rushGain, t, 0.06);
      }

      if (this.waterWarmthFilter) {
        const warmthCutoff = 1850 + this.smoothRush * 3100;
        this.waterWarmthFilter.frequency.setTargetAtTime(warmthCutoff, t, 0.07);
      }

      if (this.steamGain && this.steamHpFilter) {
        this.steamGain.gain.setTargetAtTime(this.smoothSteam * 0.22, t, 0.06);
        this.steamHpFilter.frequency.setTargetAtTime(2650 - this.smoothSteam * 700, t, 0.08);
      }

      if (this.turbineSine && this.turbineTri && this.turbineGain) {
        const fundamental = 74 + this.smoothRpm * 112;
        this.turbineSine.frequency.setTargetAtTime(fundamental, t, 0.07);
        this.turbineTri.frequency.setTargetAtTime(fundamental * 2.0, t, 0.07);
        const humGain = this.smoothRpm < 0.01 ? 0 : clamp(this.smoothRpm * 0.062, 0, 0.072);
        this.turbineGain.gain.setTargetAtTime(humGain, t, 0.07);
      }

      if (this.relayMasterGain && this.relayBuzzFilter && this.relayCrackleFilter) {
        const relayLevel = this.smoothRelay < 0.008 ? 0 : clamp(this.smoothRelay * 0.14, 0, 0.16);
        this.relayMasterGain.gain.setTargetAtTime(relayLevel, t, 0.05);
        this.relayBuzzFilter.frequency.setTargetAtTime(450 + this.smoothRelay * 240, t, 0.07);
        this.relayCrackleFilter.frequency.setTargetAtTime(2450 + this.smoothRelay * 1250, t, 0.07);
      }
    } catch {
      return;
    }

    const iceFreezeTriggered = this.consumeCounterEdge('iceFreeze', telemetry.iceFreezeCount);
    const iceShatterTriggered = this.consumeCounterEdge('iceShatter', telemetry.iceShatterCount);
    const wallBreakTriggered = this.consumeCounterEdge('wallBreak', telemetry.wallBreakCount);
    const magmaQuenchTriggered = this.consumeCounterEdge('magmaQuench', telemetry.magmaQuenchCount);
    const turbineCompleteTriggered = this.consumeCounterEdge(
      'turbineComplete',
      telemetry.turbineCompletePulseCount
    );
    const mineDetonateTriggered = this.consumeCounterEdge('mineDetonate', telemetry.mineDetonateCount);
    const valveToggleTriggered = this.consumeCounterEdge('valveToggle', telemetry.valveToggleCount);
    const portalPulseTriggered = this.consumeCounterEdge('portalPulse', telemetry.portalPulseCount);

    // Only emit transient telemetry-driven foley when simulation is actively running
    if (dt <= 0 || this.muted || this.ctx.state !== 'running') {
      this.prevSplash = telemetry.splashIntensity || 0;
      return;
    }

    const splash = Math.max(0, telemetry.splashIntensity || 0);
    const splashBurst = splash - this.prevSplash;
    this.prevSplash = splash;
    if (splash > 0.22 || (splash > 0.14 && splashBurst > 0.09)) {
      this.playSplash(clamp(splash, 0.25, 1));
    }

    if (iceFreezeTriggered) this.playIceFreeze();
    if (iceShatterTriggered) this.playIceShatter();
    if (wallBreakTriggered) this.playWallBreak();
    if (magmaQuenchTriggered) this.playMagmaQuench();
    if (turbineCompleteTriggered) this.playTurbineComplete();
    if (mineDetonateTriggered) this.playMineExplosion();
    if (valveToggleTriggered) this.playValveClank();
    if (portalPulseTriggered) this.playPortalWhoosh();
  }

  /** Bubbly upward sine sweep (350 -> 950 Hz over 45ms) + filtered splash noise puff. */
  public playSplash(intensity = 0.65): void {
    const ctx = this.readyForFoley('splash');
    if (!ctx || !this.busGain) return;

    const amp = clamp(intensity, 0.2, 1.0);
    const t = ctx.currentTime;

    try {
      // 1. Bubbly upward sine sweep
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      const startHz = 330 + Math.random() * 65; // ~350 Hz
      const endHz = 890 + Math.random() * 140; // ~950 Hz
      osc.frequency.setValueAtTime(startHz, t);
      osc.frequency.exponentialRampToValueAtTime(endHz, t + 0.045);

      oscGain.gain.setValueAtTime(0.0001, t);
      oscGain.gain.linearRampToValueAtTime(0.075 * amp, t + 0.006);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.068);

      osc.connect(oscGain);
      oscGain.connect(this.busGain);
      this.scheduleStop(osc, [oscGain], t + 0.075);
      osc.start(t);

      // 2. Filtered splash noise puff
      if (this.noiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(920 + Math.random() * 520, t);
        bp.Q.setValueAtTime(1.5, t);

        const nGain = ctx.createGain();
        nGain.gain.setValueAtTime(0.0001, t);
        nGain.gain.linearRampToValueAtTime(0.11 * amp, t + 0.007);
        nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);

        src.connect(bp);
        bp.connect(nGain);
        nGain.connect(this.busGain);
        this.scheduleStop(src, [bp, nGain], t + 0.105);
        src.start(t, Math.random() * (NOISE_BUFFER_SECONDS - 0.3));
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Delicate crystalline high chime (1900–3100 Hz triangle/sine). */
  public playIceFreeze(): void {
    const ctx = this.readyForFoley('iceFreeze');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;
    const baseFreq =
      ICE_CHIME_FREQS[this.iceChimeIndex % ICE_CHIME_FREQS.length] * (0.985 + Math.random() * 0.03);
    this.iceChimeIndex = (this.iceChimeIndex + 1 + Math.floor(Math.random() * 2)) % ICE_CHIME_FREQS.length;

    try {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4800, t);

      const sine = ctx.createOscillator();
      sine.type = 'sine';
      sine.frequency.setValueAtTime(baseFreq, t);

      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.setValueAtTime(Math.min(3100, baseFreq * 1.004), t);

      const sineGain = ctx.createGain();
      sineGain.gain.setValueAtTime(0.0001, t);
      sineGain.gain.linearRampToValueAtTime(0.068, t + 0.004);
      sineGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

      const triGain = ctx.createGain();
      triGain.gain.setValueAtTime(0.0001, t);
      triGain.gain.linearRampToValueAtTime(0.026, t + 0.004);
      triGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

      sine.connect(sineGain);
      tri.connect(triGain);
      sineGain.connect(lp);
      triGain.connect(lp);
      lp.connect(this.busGain);

      this.scheduleStop(sine, [sineGain, lp], t + 0.175);
      this.scheduleStop(tri, [triGain], t + 0.125);
      sine.start(t);
      tri.start(t);
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Sparkling glass/crystal burst: 4 staggered high chimes + soft low sub-thump. */
  public playIceShatter(): void {
    const ctx = this.readyForFoley('iceShatter');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;
    const shardOffsets = [0, 0.022, 0.048, 0.078];
    const shardFreqs = [2420, 3140, 2760, 3580];

    try {
      // 4 staggered high crystal chimes
      for (let i = 0; i < shardOffsets.length; i++) {
        const start = t + shardOffsets[i];
        const freq = shardFreqs[i] * (0.96 + Math.random() * 0.08);

        const osc = ctx.createOscillator();
        osc.type = i % 2 === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.94, start + 0.19);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(5200, start);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.068 - i * 0.008, start + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.21);

        osc.connect(lp);
        lp.connect(g);
        g.connect(this.busGain);
        this.scheduleStop(osc, [lp, g], start + 0.22);
        osc.start(start);
      }

      // Soft low sub-thump
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(140, t);
      thump.frequency.exponentialRampToValueAtTime(46, t + 0.12);

      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.0001, t);
      thumpGain.gain.linearRampToValueAtTime(0.18, t + 0.006);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);

      thump.connect(thumpGain);
      thumpGain.connect(this.busGain);
      this.scheduleStop(thump, [thumpGain], t + 0.165);
      thump.start(t);

      // Brief high crystal crack noise
      if (this.noiseBuffer) {
        const crack = ctx.createBufferSource();
        crack.buffer = this.noiseBuffer;
        crack.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(3800, t);
        bp.Q.setValueAtTime(1.8, t);

        const cGain = ctx.createGain();
        cGain.gain.setValueAtTime(0.0001, t);
        cGain.gain.linearRampToValueAtTime(0.11, t + 0.003);
        cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);

        crack.connect(bp);
        bp.connect(cGain);
        cGain.connect(this.busGain);
        this.scheduleStop(crack, [bp, cGain], t + 0.075);
        crack.start(t, Math.random() * (NOISE_BUFFER_SECONDS - 0.3));
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Deep seismic lowpass boom + stone crumble crackle. */
  public playWallBreak(): void {
    const ctx = this.readyForFoley('wallBreak');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;

    try {
      // Deep seismic boom
      const boom = ctx.createOscillator();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(118, t);
      boom.frequency.exponentialRampToValueAtTime(32, t + 0.36);

      const boomSub = ctx.createOscillator();
      boomSub.type = 'triangle';
      boomSub.frequency.setValueAtTime(155, t);
      boomSub.frequency.exponentialRampToValueAtTime(44, t + 0.28);

      const boomLp = ctx.createBiquadFilter();
      boomLp.type = 'lowpass';
      boomLp.frequency.setValueAtTime(240, t);

      const boomGain = ctx.createGain();
      boomGain.gain.setValueAtTime(0.0001, t);
      boomGain.gain.linearRampToValueAtTime(0.36, t + 0.01);
      boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0001, t);
      subGain.gain.linearRampToValueAtTime(0.16, t + 0.008);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);

      boom.connect(boomGain);
      boomSub.connect(boomLp);
      boomLp.connect(subGain);
      boomGain.connect(this.busGain);
      subGain.connect(this.busGain);

      this.scheduleStop(boom, [boomGain], t + 0.46);
      this.scheduleStop(boomSub, [boomLp, subGain], t + 0.34);
      boom.start(t);
      boomSub.start(t);

      // Stone crumble crackle bursts
      if (this.noiseBuffer) {
        const bursts = [
          { offset: 0, freq: 380, q: 0.9, gain: 0.3, dur: 0.34 },
          { offset: 0.05, freq: 920, q: 1.5, gain: 0.16, dur: 0.28 },
          { offset: 0.13, freq: 1380, q: 1.8, gain: 0.11, dur: 0.25 },
        ];
        for (const b of bursts) {
          const st = t + b.offset;
          const src = ctx.createBufferSource();
          src.buffer = this.noiseBuffer;
          src.loop = true;

          const flt = ctx.createBiquadFilter();
          flt.type = b.offset === 0 ? 'lowpass' : 'bandpass';
          flt.frequency.setValueAtTime(b.freq, st);
          flt.Q.setValueAtTime(b.q, st);

          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, st);
          g.gain.linearRampToValueAtTime(b.gain, st + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, st + b.dur);

          src.connect(flt);
          flt.connect(g);
          g.connect(this.busGain);
          this.scheduleStop(src, [flt, g], st + b.dur + 0.02);
          src.start(st, Math.random() * (NOISE_BUFFER_SECONDS - 0.5));
        }
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Resonant harmonic brass-bell fifth chord on turbine completion. */
  public playTurbineComplete(): void {
    const ctx = this.readyForFoley('turbineComplete');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;
    // Warm bronze fifth chord (D4, A4, D5)
    const notes = [
      { freq: 293.66, delay: 0, amp: 0.14, dur: 0.95 },
      { freq: 440.0, delay: 0.035, amp: 0.12, dur: 0.92 },
      { freq: 587.33, delay: 0.075, amp: 0.1, dur: 1.05 },
    ];

    try {
      for (const n of notes) {
        const st = t + n.delay;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2500, st);
        lp.frequency.exponentialRampToValueAtTime(820, st + n.dur * 0.7);
        lp.Q.setValueAtTime(1.2, st);

        const fundamental = ctx.createOscillator();
        fundamental.type = 'sine';
        fundamental.frequency.setValueAtTime(n.freq, st);

        const brass = ctx.createOscillator();
        brass.type = 'triangle';
        brass.frequency.setValueAtTime(n.freq * 1.002, st);

        const fundGain = ctx.createGain();
        fundGain.gain.setValueAtTime(0.0001, st);
        fundGain.gain.linearRampToValueAtTime(n.amp, st + 0.014);
        fundGain.gain.exponentialRampToValueAtTime(0.0001, st + n.dur);

        const brassGain = ctx.createGain();
        brassGain.gain.setValueAtTime(0.0001, st);
        brassGain.gain.linearRampToValueAtTime(n.amp * 0.65, st + 0.018);
        brassGain.gain.exponentialRampToValueAtTime(0.0001, st + n.dur * 0.78);

        fundamental.connect(fundGain);
        brass.connect(brassGain);
        fundGain.connect(lp);
        brassGain.connect(lp);
        lp.connect(this.busGain);

        this.scheduleStop(fundamental, [fundGain, lp], st + n.dur + 0.03);
        this.scheduleStop(brass, [brassGain], st + n.dur + 0.03);
        fundamental.start(st);
        brass.start(st);
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Dramatic pressurized steam hiss + dark obsidian chime. */
  public playMagmaQuench(): void {
    const ctx = this.readyForFoley('magmaQuench');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;

    try {
      // 1. Dramatic pressurized steam hiss
      if (this.noiseBuffer) {
        const steam = ctx.createBufferSource();
        steam.buffer = this.noiseBuffer;
        steam.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(3400, t);
        bp.frequency.exponentialRampToValueAtTime(1350, t + 0.58);
        bp.Q.setValueAtTime(1.1, t);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(1600, t);

        const sGain = ctx.createGain();
        sGain.gain.setValueAtTime(0.0001, t);
        sGain.gain.linearRampToValueAtTime(0.26, t + 0.02);
        sGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.64);

        steam.connect(hp);
        hp.connect(bp);
        bp.connect(sGain);
        sGain.connect(this.busGain);
        this.scheduleStop(steam, [hp, bp, sGain], t + 0.66);
        steam.start(t, Math.random() * (NOISE_BUFFER_SECONDS - 0.8));
      }

      // 2. Dark obsidian metallic chime (D3 + A3 + Eb4 glassy obsidian partial)
      const partials = [
        { freq: 146.83, amp: 0.16, dur: 0.82 },
        { freq: 220.0, amp: 0.11, dur: 0.74 },
        { freq: 311.13, amp: 0.065, dur: 0.56 },
      ];
      for (const p of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(p.freq, t + 0.02);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1350, t + 0.02);
        lp.frequency.exponentialRampToValueAtTime(420, t + 0.02 + p.dur);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + 0.02);
        g.gain.linearRampToValueAtTime(p.amp, t + 0.032);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + p.dur);

        osc.connect(lp);
        lp.connect(g);
        g.connect(this.busGain);
        this.scheduleStop(osc, [lp, g], t + 0.04 + p.dur);
        osc.start(t + 0.02);
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Deep sub-whoosh + hydro-cannon punch. */
  public playVortexFire(): void {
    const ctx = this.readyForFoley('vortexFire');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;

    try {
      // Hydro-cannon low punch
      const punch = ctx.createOscillator();
      punch.type = 'sine';
      punch.frequency.setValueAtTime(215, t);
      punch.frequency.exponentialRampToValueAtTime(44, t + 0.14);

      const pGain = ctx.createGain();
      pGain.gain.setValueAtTime(0.0001, t);
      pGain.gain.linearRampToValueAtTime(0.34, t + 0.007);
      pGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.21);

      punch.connect(pGain);
      pGain.connect(this.busGain);
      this.scheduleStop(punch, [pGain], t + 0.23);
      punch.start(t);

      // Deep pressurized sub-whoosh
      if (this.noiseBuffer) {
        const whoosh = ctx.createBufferSource();
        whoosh.buffer = this.noiseBuffer;
        whoosh.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(280, t);
        bp.frequency.exponentialRampToValueAtTime(1420, t + 0.075);
        bp.frequency.exponentialRampToValueAtTime(340, t + 0.29);
        bp.Q.setValueAtTime(2.0, t);

        const wGain = ctx.createGain();
        wGain.gain.setValueAtTime(0.0001, t);
        wGain.gain.linearRampToValueAtTime(0.28, t + 0.018);
        wGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

        whoosh.connect(bp);
        bp.connect(wGain);
        wGain.connect(this.busGain);
        this.scheduleStop(whoosh, [bp, wGain], t + 0.32);
        whoosh.start(t, Math.random() * (NOISE_BUFFER_SECONDS - 0.4));
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Radiant ascending aquatic pentatonic arpeggio (C5, E5, G5, B5, D6). */
  public playVictory(): void {
    const ctx = this.readyForFoley('victory');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;

    try {
      for (let i = 0; i < VICTORY_ARPEGGIO_FREQS.length; i++) {
        const freq = VICTORY_ARPEGGIO_FREQS[i];
        const st = t + i * 0.095;
        const isCrown = i === VICTORY_ARPEGGIO_FREQS.length - 1;
        const dur = isCrown ? 1.35 : 0.9;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3600, st);
        lp.frequency.exponentialRampToValueAtTime(1400, st + dur);

        const bell = ctx.createOscillator();
        bell.type = 'sine';
        bell.frequency.setValueAtTime(freq, st);

        const shimmer = ctx.createOscillator();
        shimmer.type = 'triangle';
        shimmer.frequency.setValueAtTime(freq * 1.003, st);

        const bGain = ctx.createGain();
        bGain.gain.setValueAtTime(0.0001, st);
        bGain.gain.linearRampToValueAtTime(isCrown ? 0.15 : 0.115, st + 0.012);
        bGain.gain.exponentialRampToValueAtTime(0.0001, st + dur);

        const sGain = ctx.createGain();
        sGain.gain.setValueAtTime(0.0001, st);
        sGain.gain.linearRampToValueAtTime(isCrown ? 0.055 : 0.04, st + 0.015);
        sGain.gain.exponentialRampToValueAtTime(0.0001, st + dur * 0.72);

        bell.connect(bGain);
        shimmer.connect(sGain);
        bGain.connect(lp);
        sGain.connect(lp);
        lp.connect(this.busGain);

        this.scheduleStop(bell, [bGain, lp], st + dur + 0.04);
        this.scheduleStop(shimmer, [sGain], st + dur + 0.04);
        bell.start(st);
        shimmer.start(st);
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Punchy deep sub-bass blast + metallic hydro-ring + bubbling splash cascade. */
  public playMineExplosion(): void {
    const ctx = this.readyForFoley('mineExplosion');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;

    try {
      // 1. Punchy deep sub-bass blast
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(148, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.36);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0001, t);
      subGain.gain.linearRampToValueAtTime(0.42, t + 0.006);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

      sub.connect(subGain);
      subGain.connect(this.busGain);
      this.scheduleStop(sub, [subGain], t + 0.48);
      sub.start(t);

      // 2. Metallic hydro-ring shell resonance
      const shellPartials = [
        { freq: 392, amp: 0.11, dur: 0.42 },
        { freq: 622, amp: 0.075, dur: 0.34 },
      ];
      for (const p of shellPartials) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(p.freq, t);
        osc.frequency.exponentialRampToValueAtTime(p.freq * 0.88, t + p.dur);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1800, t);
        lp.frequency.exponentialRampToValueAtTime(620, t + p.dur);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(p.amp, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);

        osc.connect(lp);
        lp.connect(g);
        g.connect(this.busGain);
        this.scheduleStop(osc, [lp, g], t + p.dur + 0.03);
        osc.start(t);
      }

      // 3. Lowpass blast pressure thump + bubbling splash cascade
      if (this.noiseBuffer) {
        const thump = ctx.createBufferSource();
        thump.buffer = this.noiseBuffer;
        thump.loop = true;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(680, t);
        lp.frequency.exponentialRampToValueAtTime(130, t + 0.36);

        const tGain = ctx.createGain();
        tGain.gain.setValueAtTime(0.0001, t);
        tGain.gain.linearRampToValueAtTime(0.32, t + 0.007);
        tGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);

        thump.connect(lp);
        lp.connect(tGain);
        tGain.connect(this.busGain);
        this.scheduleStop(thump, [lp, tGain], t + 0.41);
        thump.start(t, Math.random() * (NOISE_BUFFER_SECONDS - 0.6));

        const cascade = ctx.createBufferSource();
        cascade.buffer = this.noiseBuffer;
        cascade.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1180, t + 0.05);
        bp.frequency.exponentialRampToValueAtTime(780, t + 0.38);
        bp.Q.setValueAtTime(1.3, t + 0.05);

        const cGain = ctx.createGain();
        cGain.gain.setValueAtTime(0.0001, t + 0.05);
        cGain.gain.linearRampToValueAtTime(0.16, t + 0.08);
        cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);

        cascade.connect(bp);
        bp.connect(cGain);
        cGain.connect(this.busGain);
        this.scheduleStop(cascade, [bp, cGain], t + 0.45);
        cascade.start(t + 0.05, Math.random() * (NOISE_BUFFER_SECONDS - 0.6));
      }

      // Staggered bubbling cascade pops
      const bubbles = [
        { delay: 0.065, f0: 320, f1: 870 },
        { delay: 0.125, f0: 410, f1: 1090 },
        { delay: 0.195, f0: 365, f1: 940 },
      ];
      for (const b of bubbles) {
        const st = t + b.delay;
        const pop = ctx.createOscillator();
        pop.type = 'sine';
        pop.frequency.setValueAtTime(b.f0, st);
        pop.frequency.exponentialRampToValueAtTime(b.f1, st + 0.05);

        const pGain = ctx.createGain();
        pGain.gain.setValueAtTime(0.0001, st);
        pGain.gain.linearRampToValueAtTime(0.07, st + 0.006);
        pGain.gain.exponentialRampToValueAtTime(0.0001, st + 0.075);

        pop.connect(pGain);
        pGain.connect(this.busGain);
        this.scheduleStop(pop, [pGain], st + 0.085);
        pop.start(st);
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Tactile heavy brass latch clank (280Hz -> 140Hz metallic transient + high mechanical click). */
  public playValveClank(): void {
    const ctx = this.readyForFoley('valveClank');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;

    try {
      // Heavy brass body thud (280Hz -> 140Hz)
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(280, t);
      body.frequency.exponentialRampToValueAtTime(140, t + 0.085);

      const brassOver = ctx.createOscillator();
      brassOver.type = 'sine';
      brassOver.frequency.setValueAtTime(495, t);
      brassOver.frequency.exponentialRampToValueAtTime(380, t + 0.09);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1450, t);
      lp.frequency.exponentialRampToValueAtTime(520, t + 0.12);

      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.linearRampToValueAtTime(0.24, t + 0.004);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

      const overGain = ctx.createGain();
      overGain.gain.setValueAtTime(0.0001, t);
      overGain.gain.linearRampToValueAtTime(0.095, t + 0.003);
      overGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

      body.connect(lp);
      lp.connect(bodyGain);
      bodyGain.connect(this.busGain);

      brassOver.connect(overGain);
      overGain.connect(this.busGain);

      this.scheduleStop(body, [lp, bodyGain], t + 0.15);
      this.scheduleStop(brassOver, [overGain], t + 0.12);
      body.start(t);
      brassOver.start(t);

      // High mechanical latch click
      const clickOsc = ctx.createOscillator();
      clickOsc.type = 'sine';
      clickOsc.frequency.setValueAtTime(1750, t + 0.014);
      clickOsc.frequency.exponentialRampToValueAtTime(980, t + 0.036);

      const cGain = ctx.createGain();
      cGain.gain.setValueAtTime(0.0001, t + 0.014);
      cGain.gain.linearRampToValueAtTime(0.085, t + 0.017);
      cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);

      clickOsc.connect(cGain);
      cGain.connect(this.busGain);
      this.scheduleStop(clickOsc, [cGain], t + 0.055);
      clickOsc.start(t + 0.014);

      if (this.noiseBuffer) {
        const snap = ctx.createBufferSource();
        snap.buffer = this.noiseBuffer;
        snap.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2600, t);
        bp.Q.setValueAtTime(2.6, t);

        const sGain = ctx.createGain();
        sGain.gain.setValueAtTime(0.0001, t);
        sGain.gain.linearRampToValueAtTime(0.11, t + 0.002);
        sGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);

        snap.connect(bp);
        bp.connect(sGain);
        sGain.connect(this.busGain);
        this.scheduleStop(snap, [bp, sGain], t + 0.04);
        snap.start(t, Math.random() * (NOISE_BUFFER_SECONDS - 0.2));
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  /** Shimmering liquid-warp frequency sweep (360Hz -> 1120Hz -> 540Hz) with airy filtered noise. */
  public playPortalWhoosh(): void {
    const ctx = this.readyForFoley('portalWhoosh');
    if (!ctx || !this.busGain) return;

    const t = ctx.currentTime;

    try {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2500, t);

      const warpSine = ctx.createOscillator();
      warpSine.type = 'sine';
      warpSine.frequency.setValueAtTime(360, t);
      warpSine.frequency.exponentialRampToValueAtTime(1120, t + 0.11);
      warpSine.frequency.exponentialRampToValueAtTime(540, t + 0.32);

      const warpTri = ctx.createOscillator();
      warpTri.type = 'triangle';
      warpTri.frequency.setValueAtTime(362, t);
      warpTri.frequency.exponentialRampToValueAtTime(1127, t + 0.11);
      warpTri.frequency.exponentialRampToValueAtTime(543, t + 0.32);

      const sGain = ctx.createGain();
      sGain.gain.setValueAtTime(0.0001, t);
      sGain.gain.linearRampToValueAtTime(0.135, t + 0.045);
      sGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

      const tGain = ctx.createGain();
      tGain.gain.setValueAtTime(0.0001, t);
      tGain.gain.linearRampToValueAtTime(0.05, t + 0.05);
      tGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);

      warpSine.connect(sGain);
      warpTri.connect(tGain);
      sGain.connect(lp);
      tGain.connect(lp);
      lp.connect(this.busGain);

      this.scheduleStop(warpSine, [sGain, lp], t + 0.37);
      this.scheduleStop(warpTri, [tGain], t + 0.36);
      warpSine.start(t);
      warpTri.start(t);

      // Airy filtered liquid-warp noise
      if (this.noiseBuffer) {
        const airy = ctx.createBufferSource();
        airy.buffer = this.noiseBuffer;
        airy.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(760, t);
        bp.frequency.exponentialRampToValueAtTime(2200, t + 0.11);
        bp.frequency.exponentialRampToValueAtTime(1020, t + 0.33);
        bp.Q.setValueAtTime(1.85, t);

        const aGain = ctx.createGain();
        aGain.gain.setValueAtTime(0.0001, t);
        aGain.gain.linearRampToValueAtTime(0.19, t + 0.04);
        aGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

        airy.connect(bp);
        bp.connect(aGain);
        aGain.connect(this.busGain);
        this.scheduleStop(airy, [bp, aGain], t + 0.37);
        airy.start(t, Math.random() * (NOISE_BUFFER_SECONDS - 0.5));
      }
    } catch {
      // Ignore transient audio failure
    }
  }

  private initGraph(ctx: AudioContext): void {
    const t = ctx.currentTime;

    this.busGain = ctx.createGain();
    this.busGain.gain.setValueAtTime(1.0, t);

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-11, t);
    this.compressor.knee.setValueAtTime(18, t);
    this.compressor.ratio.setValueAtTime(4, t);
    this.compressor.attack.setValueAtTime(0.004, t);
    this.compressor.release.setValueAtTime(0.15, t);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.muted ? 0 : MASTER_GAIN_UNMUTED, t);

    this.busGain.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // 3-second seamless stereo pink+brown noise bed
    this.noiseBuffer = this.buildPinkBrownNoiseBuffer(ctx);

    this.waterNoiseSource = ctx.createBufferSource();
    this.waterNoiseSource.buffer = this.noiseBuffer;
    this.waterNoiseSource.loop = true;

    this.lowFlowFilter = ctx.createBiquadFilter();
    this.lowFlowFilter.type = 'bandpass';
    this.lowFlowFilter.frequency.setValueAtTime(320, t);
    this.lowFlowFilter.Q.setValueAtTime(0.9, t);

    this.lowFlowGain = ctx.createGain();
    this.lowFlowGain.gain.setValueAtTime(0, t);

    this.rushFilter = ctx.createBiquadFilter();
    this.rushFilter.type = 'bandpass';
    this.rushFilter.frequency.setValueAtTime(1150, t);
    this.rushFilter.Q.setValueAtTime(1.15, t);

    this.rushGain = ctx.createGain();
    this.rushGain.gain.setValueAtTime(0, t);

    this.waterWarmthFilter = ctx.createBiquadFilter();
    this.waterWarmthFilter.type = 'lowpass';
    this.waterWarmthFilter.frequency.setValueAtTime(2600, t);
    this.waterWarmthFilter.Q.setValueAtTime(0.65, t);

    this.waterNoiseSource.connect(this.lowFlowFilter);
    this.lowFlowFilter.connect(this.lowFlowGain);
    this.lowFlowGain.connect(this.waterWarmthFilter);

    this.waterNoiseSource.connect(this.rushFilter);
    this.rushFilter.connect(this.rushGain);
    this.rushGain.connect(this.waterWarmthFilter);

    this.waterWarmthFilter.connect(this.busGain);
    this.waterNoiseSource.start(t);

    // Continuous steam bed (high-pass filtered noise smoothed gently at the top)
    this.steamNoiseSource = ctx.createBufferSource();
    this.steamNoiseSource.buffer = this.noiseBuffer;
    this.steamNoiseSource.loop = true;

    this.steamHpFilter = ctx.createBiquadFilter();
    this.steamHpFilter.type = 'highpass';
    this.steamHpFilter.frequency.setValueAtTime(2400, t);
    this.steamHpFilter.Q.setValueAtTime(0.7, t);

    this.steamLpFilter = ctx.createBiquadFilter();
    this.steamLpFilter.type = 'lowpass';
    this.steamLpFilter.frequency.setValueAtTime(7200, t);

    this.steamGain = ctx.createGain();
    this.steamGain.gain.setValueAtTime(0, t);

    this.steamNoiseSource.connect(this.steamHpFilter);
    this.steamHpFilter.connect(this.steamLpFilter);
    this.steamLpFilter.connect(this.steamGain);
    this.steamGain.connect(this.busGain);
    this.steamNoiseSource.start(t, 0.9);

    // Subtle mechanical turbine whirr (warm sine + low-passed triangle harmonic)
    this.turbineSine = ctx.createOscillator();
    this.turbineSine.type = 'sine';
    this.turbineSine.frequency.setValueAtTime(78, t);

    this.turbineTri = ctx.createOscillator();
    this.turbineTri.type = 'triangle';
    this.turbineTri.frequency.setValueAtTime(156, t);

    this.turbineTriFilter = ctx.createBiquadFilter();
    this.turbineTriFilter.type = 'lowpass';
    this.turbineTriFilter.frequency.setValueAtTime(640, t);

    this.turbineTriGain = ctx.createGain();
    this.turbineTriGain.gain.setValueAtTime(0.28, t);

    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.setValueAtTime(0, t);

    this.turbineSine.connect(this.turbineGain);
    this.turbineTri.connect(this.turbineTriFilter);
    this.turbineTriFilter.connect(this.turbineTriGain);
    this.turbineTriGain.connect(this.turbineGain);
    this.turbineGain.connect(this.busGain);

    this.turbineSine.start(t);
    this.turbineTri.start(t);

    // Continuous subtle crackling electric relay hum (bandpass crackle + modulated buzz)
    this.relayMasterGain = ctx.createGain();
    this.relayMasterGain.gain.setValueAtTime(0, t);

    this.relayNoiseSource = ctx.createBufferSource();
    this.relayNoiseSource.buffer = this.noiseBuffer;
    this.relayNoiseSource.loop = true;

    this.relayCrackleFilter = ctx.createBiquadFilter();
    this.relayCrackleFilter.type = 'bandpass';
    this.relayCrackleFilter.frequency.setValueAtTime(2800, t);
    this.relayCrackleFilter.Q.setValueAtTime(3.2, t);

    this.relayCrackleGain = ctx.createGain();
    this.relayCrackleGain.gain.setValueAtTime(0.58, t);

    this.relayBuzzOsc = ctx.createOscillator();
    this.relayBuzzOsc.type = 'sawtooth';
    this.relayBuzzOsc.frequency.setValueAtTime(120, t);

    this.relayBuzzFilter = ctx.createBiquadFilter();
    this.relayBuzzFilter.type = 'bandpass';
    this.relayBuzzFilter.frequency.setValueAtTime(520, t);
    this.relayBuzzFilter.Q.setValueAtTime(2.4, t);

    this.relayBuzzGain = ctx.createGain();
    this.relayBuzzGain.gain.setValueAtTime(0.28, t);

    this.relayLfo = ctx.createOscillator();
    this.relayLfo.type = 'sine';
    this.relayLfo.frequency.setValueAtTime(18, t);

    this.relayLfoGain = ctx.createGain();
    this.relayLfoGain.gain.setValueAtTime(620, t);
    this.relayLfo.connect(this.relayLfoGain);
    this.relayLfoGain.connect(this.relayCrackleFilter.frequency);

    this.relayNoiseSource.connect(this.relayCrackleFilter);
    this.relayCrackleFilter.connect(this.relayCrackleGain);
    this.relayCrackleGain.connect(this.relayMasterGain);

    this.relayBuzzOsc.connect(this.relayBuzzFilter);
    this.relayBuzzFilter.connect(this.relayBuzzGain);
    this.relayBuzzGain.connect(this.relayMasterGain);

    this.relayMasterGain.connect(this.busGain);
    this.relayNoiseSource.start(t, 1.55);
    this.relayBuzzOsc.start(t);
    this.relayLfo.start(t);
  }

  private consumeCounterEdge(key: keyof WaterAudioEngine['prevCounters'], rawValue: number | undefined): boolean {
    const val = rawValue || 0;
    const prev = this.prevCounters[key];
    this.prevCounters[key] = val;
    return val > prev;
  }

  private buildPinkBrownNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * NOISE_BUFFER_SECONDS));
    const fadeSamples = Math.min(Math.floor(sampleRate * NOISE_CROSSFADE_SECONDS), Math.floor(length * 0.25));
    const totalSamples = length + fadeSamples;
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const temp = new Float32Array(totalSamples);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      let brown = 0;

      for (let i = 0; i < totalSamples; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.065;
        b6 = white * 0.115926;

        brown = brown * 0.986 + white * 0.095;
        temp[i] = clamp(pink * 0.72 + brown * 0.42, -0.85, 0.85);
      }

      // Raised-cosine equal-power crossfade tail into head for a seamless loop
      const out = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        if (i < fadeSamples) {
          const u = i / fadeSamples;
          const fadeIn = Math.sin(u * Math.PI * 0.5);
          const fadeOut = Math.cos(u * Math.PI * 0.5);
          out[i] = temp[i] * fadeIn + temp[length + i] * fadeOut;
        } else {
          out[i] = temp[i];
        }
      }
    }

    return buffer;
  }

  private readyForFoley(key: FoleyKey): AudioContext | null {
    if (!this.ctx || this.unavailable || this.muted || this.ctx.state !== 'running') {
      return null;
    }
    const audioNow = this.ctx.currentTime;
    for (let i = this.voiceDeadlines.length - 1; i >= 0; i--) {
      if (this.voiceDeadlines[i] <= audioNow) {
        this.voiceDeadlines.splice(i, 1);
      }
    }
    if (this.voiceDeadlines.length >= MAX_ACTIVE_TRANSIENT_VOICES) {
      return null;
    }
    const tMs = nowMs();
    if (tMs - this.lastPlayedMs[key] < FOLEY_COOLDOWNS_MS[key]) {
      return null;
    }
    this.lastPlayedMs[key] = tMs;
    return this.ctx;
  }

  private scheduleStop(source: AudioScheduledSourceNode, nodes: AudioNode[], stopAt: number): void {
    this.voiceDeadlines.push(stopAt);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      const idx = this.voiceDeadlines.indexOf(stopAt);
      if (idx !== -1) this.voiceDeadlines.splice(idx, 1);
      try {
        source.disconnect();
        for (const n of nodes) {
          n.disconnect();
        }
      } catch {
        // Already disconnected
      }
    };
    source.onended = cleanup;
    source.stop(stopAt);
  }
}
