interface DieselVoice {
  oscSub: OscillatorNode;
  oscHarm: OscillatorNode;
  oscClatter: OscillatorNode;
  lfoFiring: OscillatorNode;
  noiseSrc: AudioBufferSourceNode;
  starterOsc: OscillatorNode;
  subGain: GainNode;
  clatterGate: GainNode;
  dieselMaster: GainNode;
}

/**
 * 100% procedural Web Audio API sound effects & EA288 1.6 TDI diesel engine synthesizer.
 * Lazily creates/resumes AudioContext on user gesture and respects global mute state.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private diesel: DieselVoice | null = null;
  private stopTimeoutId: number | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;

      this.ctx = new AudioCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx, 2.0);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Subtle pink-weighted noise floor mixed with crisp white transient texture
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2) * 0.6 + white * 0.45));
    }
    return buffer;
  }

  private spawnNoiseBurst(
    ctx: AudioContext,
    startTime: number,
    durationSec: number,
    filterType: BiquadFilterType,
    freqHz: number,
    q: number,
    peakGain: number
  ): void {
    if (!this.masterGain || !this.noiseBuffer) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freqHz, startTime);
    filter.Q.setValueAtTime(q, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.006, durationSec * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);

    const offset = Math.random() * 1.2;
    src.start(startTime, offset);
    src.stop(startTime + durationSec + 0.02);
  }

  private spawnTone(
    ctx: AudioContext,
    startTime: number,
    durationSec: number,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    peakGain: number
  ): void {
    if (!this.masterGain) return;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + durationSec);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.008, durationSec * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(env);
    env.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);
  }

  public setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(m ? 0 : 0.72, now, 0.03);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public playClick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.spawnTone(ctx, t, 0.038, 'triangle', 1250, 520, 0.14);
    this.spawnNoiseBurst(ctx, t, 0.025, 'bandpass', 2400, 2.2, 0.11);
  }

  public playSuccess(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.spawnTone(ctx, t, 0.16, 'sine', 523.25, 523.25, 0.16);
    this.spawnTone(ctx, t + 0.085, 0.24, 'sine', 659.25, 659.25, 0.18);
    this.spawnTone(ctx, t + 0.085, 0.24, 'triangle', 1318.5, 1318.5, 0.04);
  }

  public playError(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.spawnTone(ctx, t, 0.11, 'sawtooth', 165, 135, 0.11);
    this.spawnTone(ctx, t + 0.12, 0.14, 'sawtooth', 138, 108, 0.12);
  }

  public playStepComplete(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      this.spawnTone(ctx, t + idx * 0.065, 0.28, 'triangle', freq, freq, 0.13);
    });
  }

  /** Pneumatic 17mm impact gun rat-tat-tat burst */
  public playImpactWrench(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // 6 rapid pneumatic hammer impacts
    for (let i = 0; i < 6; i++) {
      const hitT = t + i * 0.044;
      this.spawnTone(ctx, hitT, 0.032, 'square', 220, 95, 0.16);
      this.spawnTone(ctx, hitT, 0.028, 'triangle', 1850, 920, 0.14);
      this.spawnNoiseBurst(ctx, hitT, 0.036, 'bandpass', 2700, 1.8, 0.22);
    }
    // Brief air exhaust hiss tail
    this.spawnNoiseBurst(ctx, t + 0.23, 0.12, 'highpass', 3200, 0.9, 0.09);
  }

  /** Crisp 72-tooth mechanical ratchet clicks */
  public playRatchet(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    for (let i = 0; i < 5; i++) {
      const clickT = t + i * 0.055;
      this.spawnTone(ctx, clickT, 0.018, 'triangle', 2950 + (i % 2) * 220, 1400, 0.14);
      this.spawnTone(ctx, clickT, 0.025, 'sine', 780, 420, 0.1);
      this.spawnNoiseBurst(ctx, clickT, 0.018, 'bandpass', 4200, 3.0, 0.15);
    }
  }

  /** Quick Torx T25 screwdriver spin & thread engagement */
  public playScrewdriver(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    this.spawnTone(ctx, t, 0.18, 'triangle', 260, 420, 0.08);
    this.spawnNoiseBurst(ctx, t, 0.17, 'bandpass', 1800, 2.2, 0.09);
    for (let i = 0; i < 3; i++) {
      this.spawnTone(ctx, t + 0.04 + i * 0.048, 0.016, 'sine', 2100, 1100, 0.09);
    }
  }

  /** Unmistakable metallic dual-snap of a calibrated click-type torque wrench */
  public playTorqueClick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Dual-click mechanism snap (trip + return pawl)
    for (const offset of [0, 0.028]) {
      this.spawnTone(ctx, t + offset, 0.045, 'triangle', 2480, 1650, 0.24);
      this.spawnTone(ctx, t + offset, 0.06, 'sine', 3920, 2900, 0.16);
      this.spawnTone(ctx, t + offset, 0.08, 'sine', 1120, 740, 0.14);
      this.spawnNoiseBurst(ctx, t + offset, 0.022, 'bandpass', 4800, 4.0, 0.22);
    }
  }

  /** Metallic T10060A detent slide & locking click */
  public playPinLock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Precision steel pin sliding into 4mm bore
    this.spawnNoiseBurst(ctx, t, 0.085, 'bandpass', 2200, 3.5, 0.1);
    // Crisp seated detent click
    this.spawnTone(ctx, t + 0.075, 0.045, 'triangle', 3100, 1500, 0.2);
    this.spawnTone(ctx, t + 0.075, 0.06, 'sine', 890, 540, 0.16);
    this.spawnNoiseBurst(ctx, t + 0.075, 0.024, 'bandpass', 3600, 3.2, 0.16);
  }

  /** Rubber EPDM belt tension slap */
  public playBeltSnap(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    this.spawnTone(ctx, t, 0.095, 'sine', 165, 58, 0.26);
    this.spawnNoiseBurst(ctx, t, 0.085, 'bandpass', 520, 1.4, 0.22);
  }

  /** Smooth metallic ball-bearing spin & coast-down whir */
  public playBearingSpin(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    if (!this.masterGain || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2100, t);
    filter.frequency.exponentialRampToValueAtTime(520, t + 0.95);
    filter.Q.setValueAtTime(4.2, t);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.14, t + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.98);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);

    src.start(t);
    src.stop(t + 1.0);

    // Subtle smooth bearing race harmonic
    this.spawnTone(ctx, t, 0.92, 'sine', 640, 180, 0.035);
  }

  /** Electric low-pressure in-tank fuel pump priming hum (Rep.-Gr. 23 S. 281) */
  public playFuelPrime(durationSec = 1.5): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const t = ctx.currentTime;
    const dur = Math.max(0.6, durationSec);
    this.spawnTone(ctx, t, dur, 'sine', 290, 325, 0.09);
    this.spawnTone(ctx, t, dur, 'triangle', 580, 645, 0.045);
    this.spawnNoiseBurst(ctx, t, dur * 0.9, 'bandpass', 1450, 2.2, 0.04);
  }

  /** Electric-hydraulic 2-post car lift hum + safety latch clicks */
  public playLiftMotor(durationSec = 2.2): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = Math.max(0.6, durationSec);

    if (!this.masterGain) return;

    // Electric hydraulic pump hum (50Hz + 100Hz + 150Hz)
    const pumpGain = ctx.createGain();
    pumpGain.gain.setValueAtTime(0.0001, t);
    pumpGain.gain.linearRampToValueAtTime(0.14, t + 0.14);
    pumpGain.gain.setValueAtTime(0.14, Math.max(t + 0.15, t + dur - 0.18));
    pumpGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    pumpGain.connect(this.masterGain);

    for (const [freq, type, weight] of [
      [52, 'sawtooth', 0.45],
      [104, 'triangle', 0.55],
      [208, 'sine', 0.22],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(340, t);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(weight, t);
      osc.connect(lp);
      lp.connect(subG);
      subG.connect(pumpGain);
      osc.start(t);
      osc.stop(t + dur + 0.04);
    }

    // Hydraulic fluid bypass hiss
    this.spawnNoiseBurst(ctx, t, dur * 0.95, 'bandpass', 950, 1.1, 0.055);

    // Safety rack latch clacks along lift stroke
    const latchCount = Math.max(2, Math.floor(dur / 0.55));
    for (let i = 1; i <= latchCount; i++) {
      const latchT = t + (dur * i) / (latchCount + 0.5);
      this.spawnTone(ctx, latchT, 0.035, 'square', 460, 180, 0.1);
      this.spawnNoiseBurst(ctx, latchT, 0.03, 'bandpass', 2100, 2.5, 0.12);
    }
  }

  /**
   * Authentic 1.6 TDI EA288 diesel engine sound:
   * Starter cranking pulses (0..0.8s) transitioning smoothly into 4-cylinder
   * ~820 RPM diesel idle rumble (~27.3 Hz firing pulse) + soft belt whisper.
   */
  public startDieselEngine(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;

    if (this.stopTimeoutId !== null) {
      window.clearTimeout(this.stopTimeoutId);
      this.stopTimeoutId = null;
    }

    if (this.diesel) {
      return;
    }

    const t = ctx.currentTime;
    const dieselMaster = ctx.createGain();
    dieselMaster.gain.setValueAtTime(0.0001, t);
    dieselMaster.gain.linearRampToValueAtTime(0.85, t + 0.08);
    dieselMaster.connect(this.masterGain);

    // 1. Starter motor whine & compression cranking pulses (0..0.78s)
    const starterOsc = ctx.createOscillator();
    starterOsc.type = 'sawtooth';
    starterOsc.frequency.setValueAtTime(240, t);
    starterOsc.frequency.linearRampToValueAtTime(295, t + 0.35);
    starterOsc.frequency.linearRampToValueAtTime(345, t + 0.72);

    const starterFilter = ctx.createBiquadFilter();
    starterFilter.type = 'bandpass';
    starterFilter.frequency.setValueAtTime(520, t);
    starterFilter.Q.setValueAtTime(1.8, t);

    const starterEnv = ctx.createGain();
    starterEnv.gain.setValueAtTime(0.0001, t);
    for (let p = 0; p < 4; p++) {
      const pt = t + p * 0.175;
      starterEnv.gain.linearRampToValueAtTime(0.14, pt + 0.04);
      starterEnv.gain.linearRampToValueAtTime(0.055, pt + 0.15);
    }
    starterEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);

    starterOsc.connect(starterFilter);
    starterFilter.connect(starterEnv);
    starterEnv.connect(dieselMaster);
    starterOsc.start(t);
    starterOsc.stop(t + 0.88);

    // 2. 4-Cylinder TDI Firing Frequency (820 RPM -> 27.33 Hz)
    const oscSub = ctx.createOscillator();
    oscSub.type = 'sawtooth';
    oscSub.frequency.setValueAtTime(14, t);
    oscSub.frequency.linearRampToValueAtTime(34, t + 0.78);
    oscSub.frequency.exponentialRampToValueAtTime(27.33, t + 1.25);

    const oscHarm = ctx.createOscillator();
    oscHarm.type = 'triangle';
    oscHarm.frequency.setValueAtTime(28, t);
    oscHarm.frequency.linearRampToValueAtTime(68, t + 0.78);
    oscHarm.frequency.exponentialRampToValueAtTime(54.66, t + 1.25);

    const subLP = ctx.createBiquadFilter();
    subLP.type = 'lowpass';
    subLP.frequency.setValueAtTime(165, t);
    subLP.Q.setValueAtTime(1.4, t);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.04, t);
    subGain.gain.linearRampToValueAtTime(0.32, t + 0.74);
    subGain.gain.linearRampToValueAtTime(0.24, t + 1.25);

    oscSub.connect(subLP);
    oscHarm.connect(subLP);
    subLP.connect(subGain);
    subGain.connect(dieselMaster);

    // 3. Common-rail TDI combustion clatter ("Nageln") modulated at firing pulse
    const oscClatter = ctx.createOscillator();
    oscClatter.type = 'triangle';
    oscClatter.frequency.setValueAtTime(760, t);

    const clatterBP = ctx.createBiquadFilter();
    clatterBP.type = 'bandpass';
    clatterBP.frequency.setValueAtTime(1280, t);
    clatterBP.Q.setValueAtTime(2.6, t);

    const clatterGate = ctx.createGain();
    clatterGate.gain.setValueAtTime(0.032, t);

    const lfoFiring = ctx.createOscillator();
    lfoFiring.type = 'sine';
    lfoFiring.frequency.setValueAtTime(14, t);
    lfoFiring.frequency.linearRampToValueAtTime(34, t + 0.78);
    lfoFiring.frequency.exponentialRampToValueAtTime(27.33, t + 1.25);

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(0.025, t);
    lfoFiring.connect(lfoDepth);
    lfoDepth.connect(clatterGate.gain);

    const clatterEnvelope = ctx.createGain();
    clatterEnvelope.gain.setValueAtTime(0.0001, t);
    clatterEnvelope.gain.setValueAtTime(0.0001, t + 0.65);
    clatterEnvelope.gain.linearRampToValueAtTime(1.0, t + 0.85);

    oscClatter.connect(clatterBP);
    clatterBP.connect(clatterGate);
    clatterGate.connect(clatterEnvelope);
    clatterEnvelope.connect(dieselMaster);

    // 4. Soft auxiliary belt & alternator airflow whisper
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;
    noiseSrc.loop = true;

    const beltBP = ctx.createBiquadFilter();
    beltBP.type = 'bandpass';
    beltBP.frequency.setValueAtTime(2600, t);
    beltBP.Q.setValueAtTime(0.9, t);

    const beltGain = ctx.createGain();
    beltGain.gain.setValueAtTime(0.0001, t);
    beltGain.gain.setValueAtTime(0.0001, t + 0.65);
    beltGain.gain.linearRampToValueAtTime(0.032, t + 0.9);

    noiseSrc.connect(beltBP);
    beltBP.connect(beltGain);
    beltGain.connect(dieselMaster);

    oscSub.start(t);
    oscHarm.start(t);
    oscClatter.start(t);
    lfoFiring.start(t);
    noiseSrc.start(t);

    this.diesel = {
      oscSub,
      oscHarm,
      oscClatter,
      lfoFiring,
      noiseSrc,
      starterOsc,
      subGain,
      clatterGate,
      dieselMaster,
    };
  }

  public stopDieselEngine(): void {
    if (!this.ctx || !this.diesel) return;
    const voice = this.diesel;
    this.diesel = null;

    const t = this.ctx.currentTime;
    // Compression deceleration & clean shutoff
    voice.oscSub.frequency.cancelScheduledValues(t);
    voice.oscSub.frequency.setValueAtTime(voice.oscSub.frequency.value, t);
    voice.oscSub.frequency.exponentialRampToValueAtTime(9, t + 0.38);

    voice.oscHarm.frequency.cancelScheduledValues(t);
    voice.oscHarm.frequency.setValueAtTime(voice.oscHarm.frequency.value, t);
    voice.oscHarm.frequency.exponentialRampToValueAtTime(18, t + 0.38);

    voice.lfoFiring.frequency.cancelScheduledValues(t);
    voice.lfoFiring.frequency.setValueAtTime(voice.lfoFiring.frequency.value, t);
    voice.lfoFiring.frequency.exponentialRampToValueAtTime(9, t + 0.38);

    voice.dieselMaster.gain.cancelScheduledValues(t);
    voice.dieselMaster.gain.setValueAtTime(voice.dieselMaster.gain.value, t);
    voice.dieselMaster.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);

    this.stopTimeoutId = window.setTimeout(() => {
      try {
        voice.oscSub.stop();
        voice.oscHarm.stop();
        voice.oscClatter.stop();
        voice.lfoFiring.stop();
        voice.noiseSrc.stop();
        voice.dieselMaster.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
      this.stopTimeoutId = null;
    }, 460);
  }
}
