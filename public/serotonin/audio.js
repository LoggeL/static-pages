// Generative 128 BPM techno whose mix follows the body: dull and muffled sober,
// wide open at the peak, thin and ringing on the comedown, rain on Tuesday.

export const BPM = 128;
const STEP = 60 / BPM / 4;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Am – F – C – G, one chord per bar
const CHORDS = [
  { root: 33, notes: [57, 60, 64, 69] },
  { root: 29, notes: [53, 57, 60, 65] },
  { root: 36, notes: [55, 60, 64, 67] },
  { root: 31, notes: [55, 59, 62, 67] },
];
const ARP = [0, 1, 2, 3, 2, 1, 3, 0, 2, 3, 1, 2, 0, 3, 2, 1];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.p = { E: 0, stim: 0, dark: 0, chill: 0, anxiety: 0, hr: 72, end: 0, tinnitus: 0, rain: 0, music: 1 };
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 4;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 900;
    this.lp.Q.value = 0.7;
    this.bus = ctx.createGain();
    this.bus.connect(this.lp).connect(this.comp).connect(this.master).connect(ctx.destination);

    // reverb
    this.rev = ctx.createConvolver();
    this.rev.buffer = this.impulse(3.2);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.08;
    this.revSend.connect(this.rev).connect(this.lp);

    // tempo-synced delay for the arp
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.38;
    this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.bus);
    this.delay.connect(this.revSend);

    // instrument buses
    this.kickG = this.gain(0.9, this.bus);
    this.hatG = this.gain(0.0, this.bus);
    this.clapG = this.gain(0.0, this.bus);
    this.bassG = this.gain(0.5, this.bus);
    this.padF = ctx.createBiquadFilter();
    this.padF.type = "lowpass";
    this.padF.frequency.value = 500;
    this.padG = this.gain(0.0, this.bus);
    this.padF.connect(this.padG);
    this.padG.connect(this.revSend);
    this.arpG = this.gain(0.0, this.bus);
    this.arpG.connect(this.delay);
    this.heartG = this.gain(0, this.master); // heartbeat bypasses the muffle: it is inside you

    this.noise = this.noiseBuffer();

    // tinnitus: a thin whine after hours of bass
    this.tin = ctx.createOscillator();
    this.tin.frequency.value = 7350;
    this.tinG = this.gain(0, this.master);
    this.tin.connect(this.tinG);
    this.tin.start();

    // rain bed
    const rn = ctx.createBufferSource();
    rn.buffer = this.noise;
    rn.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = "bandpass";
    rf.frequency.value = 1400;
    rf.Q.value = 0.4;
    this.rainG = this.gain(0, this.master);
    rn.connect(rf).connect(this.rainG);
    rn.start();

    this.t0 = ctx.currentTime + 0.1;
    this.step = 0;
    this.nextHeart = ctx.currentTime + 0.5;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  noiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  impulse(sec) {
    const sr = this.ctx.sampleRate;
    const len = sr * sec;
    const b = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    if (on && this.ctx.state === "suspended") this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  /** beats since start, aligned with the audio clock (null if no audio) */
  beatPos() {
    if (!this.ctx) return null;
    const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return ((this.ctx.currentTime - lat - this.t0) * BPM) / 60;
  }

  set(p) {
    Object.assign(this.p, p);
    if (!this.ctx) return;
    const { E, stim, dark, chill, end, tinnitus, rain, music } = this.p;
    const now = this.ctx.currentTime;
    const open = Math.max(0, Math.min(1, E * 1.15 - dark * 0.55));
    let cutoff = 700 * Math.pow(26, open); // 700 Hz … 18 kHz
    cutoff *= 1 - chill * 0.75;
    this.lp.frequency.setTargetAtTime(Math.max(260, cutoff), now, 0.3);
    this.revSend.gain.setTargetAtTime(0.06 + 0.3 * E + 0.3 * chill, now, 0.5);
    this.kickG.gain.setTargetAtTime(music * (0.85 - 0.35 * dark - 0.4 * chill), now, 0.3);
    this.hatG.gain.setTargetAtTime(music * Math.max(0, 0.05 + 0.3 * E - 0.25 * dark), now, 0.3);
    this.clapG.gain.setTargetAtTime(music * Math.max(0, E - 0.3) * 0.5, now, 0.3);
    this.bassG.gain.setTargetAtTime(music * (0.28 + 0.25 * stim - 0.15 * dark), now, 0.3);
    this.padG.gain.setTargetAtTime(music * (0.02 + 0.2 * E + 0.05 * dark), now, 0.8);
    this.padF.frequency.setTargetAtTime(400 + 3200 * E, now, 0.8);
    this.arpG.gain.setTargetAtTime(music * Math.max(0, E - 0.55) * 0.35, now, 0.6);
    this.heartG.gain.setTargetAtTime(Math.min(0.9, this.p.anxiety * 1.2 + end * 0.5), now, 0.3);
    this.tinG.gain.setTargetAtTime(tinnitus * 0.012, now, 1);
    this.rainG.gain.setTargetAtTime(rain * 0.22, now, 1.5);
  }

  schedule() {
    const ctx = this.ctx;
    while (this.t0 + this.step * STEP < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.t0 + this.step * STEP);
      this.step++;
    }
    // heartbeat on its own clock
    while (this.nextHeart < ctx.currentTime + 0.12) {
      this.heartbeat(this.nextHeart);
      this.nextHeart += 60 / Math.max(50, this.p.hr);
    }
  }

  playStep(s, t) {
    if (this.p.music <= 0.001) return;
    const i = s % 16;
    const bar = Math.floor(s / 16);
    const chord = CHORDS[bar % 4];
    const dark = this.p.dark;
    if (i % 4 === 0) this.kick(t);
    if (i % 4 === 2) this.hat(t, 0.09, 1);
    else if (this.p.E > 0.6 && i % 2 === 1) this.hat(t, 0.03, 0.4);
    if (i === 4 || i === 12) this.clap(t);
    if (i % 4 !== 0) this.bass(t, chord.root + (i % 4 === 3 ? 12 : 0), dark);
    if (i === 0) this.pad(t, chord.notes, dark);
    if (this.p.E > 0.55) this.arp(t, chord.notes[ARP[i]] + 12);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g).connect(this.kickG);
    o.start(t);
    o.stop(t + 0.4);
  }

  hat(t, dur, lvl) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(lvl * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(this.hatG);
    n.start(t, Math.random());
    n.stop(t + dur + 0.02);
  }

  clap(t) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1500;
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    [0, 0.012, 0.024].forEach((d) => {
      g.gain.setValueAtTime(0.7, t + d);
      g.gain.exponentialRampToValueAtTime(0.1, t + d + 0.01);
    });
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(f).connect(g).connect(this.clapG);
    g.connect(this.revSend);
    n.start(t, Math.random());
    n.stop(t + 0.25);
  }

  bass(t, midi, dark) {
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = mtof(midi) * (1 - dark * 0.012 * Math.sin(t * 0.7));
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 6;
    f.frequency.setValueAtTime(180 + 900 * this.p.E, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(f).connect(g).connect(this.bassG);
    o.start(t);
    o.stop(t + 0.16);
  }

  pad(t, notes, dark) {
    const dur = STEP * 16;
    notes.forEach((m) => {
      [-1, 1].forEach((side) => {
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mtof(m);
        o.detune.value = side * (7 + dark * 28); // comedown: the chords go sour
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + dur * 0.35);
        g.gain.linearRampToValueAtTime(0.0, t + dur * 1.05);
        o.connect(g).connect(this.padF);
        o.start(t);
        o.stop(t + dur * 1.1);
      });
    });
  }

  arp(t, midi) {
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = mtof(midi);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(f).connect(g).connect(this.arpG);
    o.start(t);
    o.stop(t + 0.15);
  }

  heartbeat(t) {
    [0, 0.16].forEach((d, k) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(k ? 55 : 65, t + d);
      o.frequency.exponentialRampToValueAtTime(30, t + d + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(k ? 0.5 : 0.8, t + d);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.16);
      o.connect(g).connect(this.heartG);
      o.start(t + d);
      o.stop(t + d + 0.2);
    });
  }

  /** big noise riser into the peak */
  riser(sec = 6) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 3;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + sec);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + sec);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.6);
    n.connect(f).connect(g).connect(this.master);
    g.connect(this.revSend);
    n.start(t);
    n.stop(t + sec + 0.7);
  }

  /** little one-shot sounds for UI actions */
  sfx(kind) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const tone = (freq, at, dur, type = "sine", lvl = 0.2, to) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + at);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + at + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(lvl, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(this.master);
      g.connect(this.revSend);
      o.start(t + at);
      o.stop(t + at + dur + 0.05);
    };
    if (kind === "gulp") {
      tone(420, 0, 0.12, "sine", 0.35, 160);
      tone(380, 0.22, 0.12, "sine", 0.3, 140);
    } else if (kind === "water") {
      tone(600, 0, 0.1, "sine", 0.2, 300);
      tone(500, 0.15, 0.1, "sine", 0.2, 250);
      tone(700, 0.3, 0.1, "sine", 0.15, 320);
    } else if (kind === "hug") {
      [72, 76, 79, 84, 88].forEach((m, k) => tone(mtof(m), k * 0.07, 0.9, "triangle", 0.12));
    } else if (kind === "gum") {
      tone(180, 0, 0.06, "square", 0.08);
      tone(160, 0.2, 0.06, "square", 0.08);
    } else if (kind === "chill") {
      [60, 64, 67].forEach((m) => tone(mtof(m), 0, 1.6, "sine", 0.08));
    } else if (kind === "sad") {
      [57, 60, 64].forEach((m, k) => tone(mtof(m) * 0.995, k * 0.4, 2.5, "triangle", 0.07));
    }
  }
}
