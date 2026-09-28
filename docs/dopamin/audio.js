// Generative 132 BPM tech-house that follows the body: flat and far away sober, razor-sharp
// and loud on the high, thin and repetitive on the drop, a whine when paranoia creeps in,
// then birds, a fridge and your own heartbeat at dawn.

export const BPM = 132;
const STEP = 60 / BPM / 4;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Dm – Dm – Bb – A: cold, tense, never resolving
const CHORDS = [
  { root: 38, notes: [62, 65, 69, 72] },
  { root: 38, notes: [62, 65, 69, 74] },
  { root: 34, notes: [58, 62, 65, 69] },
  { root: 33, notes: [57, 61, 64, 67] },
];
const BASSLINE = [0, 0, 12, 0, 0, 7, 0, 12, 0, 0, 12, 0, 10, 0, 7, 0];
const STABS = [3, 6, 11, 14];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.p = { E: 0, c: 0, dark: 0, air: 0, anx: 0, hr: 74, music: 1, birds: 0, room: 0, rain: 0 };
    this.skipNext = false;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 5;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 1200;
    this.lp.Q.value = 0.8;
    this.hp = ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = 20;
    this.bus = ctx.createGain();
    this.bus.connect(this.hp).connect(this.lp).connect(this.comp).connect(this.master).connect(ctx.destination);

    this.rev = ctx.createConvolver();
    this.rev.buffer = this.impulse(2.2);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.05;
    this.revSend.connect(this.rev).connect(this.lp);

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.32;
    this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.bus);

    this.kickG = this.gain(0.9, this.bus);
    this.hatG = this.gain(0.1, this.bus);
    this.rideG = this.gain(0, this.bus);
    this.clapG = this.gain(0, this.bus);
    this.bassG = this.gain(0.4, this.bus);
    this.stabG = this.gain(0, this.bus);
    this.stabG.connect(this.delay);
    this.heartG = this.gain(0, this.master); // the heartbeat is inside you: no club filter

    this.noise = this.noiseBuffer();

    // paranoia: two close sines beating against each other
    this.whine = [1174, 1181].map((f) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.start();
      return o;
    });
    this.whineG = this.gain(0, this.master);
    this.whine.forEach((o) => o.connect(this.whineG));

    // dawn room: fridge hum
    const hum = ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 50;
    const humF = ctx.createBiquadFilter();
    humF.type = "lowpass";
    humF.frequency.value = 160;
    this.humG = this.gain(0, this.master);
    hum.connect(humF).connect(this.humG);
    hum.start();

    // Sunday rain
    const rn = ctx.createBufferSource();
    rn.buffer = this.noise;
    rn.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = "bandpass";
    rf.frequency.value = 1500;
    rf.Q.value = 0.4;
    this.rainG = this.gain(0, this.master);
    rn.connect(rf).connect(this.rainG);
    rn.start();

    this.t0 = ctx.currentTime + 0.1;
    this.step = 0;
    this.nextHeart = ctx.currentTime + 0.5;
    this.nextBird = ctx.currentTime + 2;
    this.nextTick = ctx.currentTime + 1;
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
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
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
    const { E, c, dark, air, anx, music, birds, room, rain } = this.p;
    const now = this.ctx.currentTime;
    // the high makes everything crisp: highs open up, sober it's a wall of mud
    const open = Math.max(0, Math.min(1, E * 1.2 + c * 0.2 - dark * 0.5));
    let cutoff = 900 * Math.pow(20, open);
    cutoff *= 1 - air * 0.8;
    this.lp.frequency.setTargetAtTime(Math.max(240, cutoff), now, 0.25);
    // on the crash the bass drops out of the mix: it all gets thin
    this.hp.frequency.setTargetAtTime(20 + 260 * dark * (1 - E), now, 0.8);
    this.revSend.gain.setTargetAtTime(0.04 + 0.12 * dark + 0.25 * air, now, 0.5);
    this.kickG.gain.setTargetAtTime(music * (0.9 - 0.3 * dark - 0.5 * air), now, 0.3);
    this.hatG.gain.setTargetAtTime(music * Math.max(0, 0.08 + 0.45 * E + 0.15 * c - 0.2 * dark), now, 0.2);
    this.rideG.gain.setTargetAtTime(music * Math.max(0, E - 0.45) * 0.5, now, 0.3);
    this.clapG.gain.setTargetAtTime(music * Math.max(0, E - 0.2) * 0.55, now, 0.3);
    this.bassG.gain.setTargetAtTime(music * (0.3 + 0.25 * c), now, 0.3);
    this.stabG.gain.setTargetAtTime(music * Math.max(0, E - 0.3) * 0.5 + music * 0.08 * dark, now, 0.4);
    this.fb.gain.setTargetAtTime(0.25 + 0.3 * anx, now, 0.5);
    this.heartG.gain.setTargetAtTime(Math.min(0.95, anx * 0.9 + room * 0.7 + Math.max(0, (this.p.hr - 120) / 80)), now, 0.3);
    this.whineG.gain.setTargetAtTime(Math.pow(anx, 2) * 0.018, now, 0.8);
    this.humG.gain.setTargetAtTime(room * 0.035, now, 1.5);
    this.rainG.gain.setTargetAtTime(rain * 0.2, now, 1.5);
  }

  schedule() {
    const ctx = this.ctx;
    while (this.t0 + this.step * STEP < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.t0 + this.step * STEP);
      this.step++;
    }
    while (this.nextHeart < ctx.currentTime + 0.12) {
      const ibi = 60 / Math.max(50, this.p.hr);
      if (this.skipNext) {
        // extrasystole: an early, weak beat, then a compensatory pause
        this.skipNext = false;
        this.heartbeat(this.nextHeart - ibi * 0.45, 0.55);
        this.nextHeart += ibi * 1.6;
      } else {
        this.heartbeat(this.nextHeart, 1);
        this.nextHeart += ibi;
      }
    }
    if (this.p.birds > 0.05) {
      while (this.nextBird < ctx.currentTime + 0.12) {
        this.bird(this.nextBird, this.p.birds);
        this.nextBird += 0.4 + Math.random() * (3.2 - this.p.birds * 2);
      }
    } else this.nextBird = ctx.currentTime + 1;
    if (this.p.room > 0.05) {
      while (this.nextTick < ctx.currentTime + 0.12) {
        this.tick(this.nextTick, this.p.room);
        this.nextTick += 1;
      }
    } else this.nextTick = ctx.currentTime + 1;
  }

  playStep(s, t) {
    if (this.p.music <= 0.001) return;
    const i = s % 16;
    const bar = Math.floor(s / 16);
    const chord = CHORDS[bar % 4];
    const { E, c, dark } = this.p;
    if (i % 4 === 0) this.kick(t);
    if (i % 4 === 2) this.hat(t, 0.16, 1, this.hatG); // open hat on the offbeat
    else if (E + c * 0.4 > 0.35) this.hat(t, 0.025, i % 2 ? 0.35 : 0.6, this.hatG);
    if (i % 4 === 2) this.hat(t, 0.4, 0.5, this.rideG, 5200);
    if (i === 4 || i === 12) this.clap(t);
    // bassline gets stuck on one note on the crash
    const off = dark > 0.55 ? 0 : BASSLINE[i];
    if (i % 4 !== 0) this.bass(t, chord.root + off);
    if (STABS.includes(i) && (i !== 14 || E > 0.6)) this.stab(t, chord.notes, dark);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.08);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.kickG);
    o.start(t);
    o.stop(t + 0.32);
    // click
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    n.connect(ng).connect(this.kickG);
    n.start(t, Math.random());
    n.stop(t + 0.02);
  }

  hat(t, dur, lvl, dest, freq = 8000) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(lvl * 0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random());
    n.stop(t + dur + 0.02);
  }

  clap(t) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1800;
    f.Q.value = 1.1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    [0, 0.01, 0.02].forEach((d) => {
      g.gain.setValueAtTime(0.75, t + d);
      g.gain.exponentialRampToValueAtTime(0.1, t + d + 0.008);
    });
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(f).connect(g).connect(this.clapG);
    g.connect(this.revSend);
    n.start(t, Math.random());
    n.stop(t + 0.2);
  }

  bass(t, midi) {
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = mtof(midi);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 9;
    f.frequency.setValueAtTime(220 + 1400 * this.p.c * 0.6 + 500 * this.p.E, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(f).connect(g).connect(this.bassG);
    o.start(t);
    o.stop(t + 0.12);
  }

  stab(t, notes, dark) {
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1400 + 1200 * this.p.E;
    f.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    f.connect(g).connect(this.stabG);
    notes.forEach((m, k) => {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(m);
      o.detune.value = (k % 2 ? 1 : -1) * (4 + dark * 30); // the chords sour on the crash
      o.connect(f);
      o.start(t);
      o.stop(t + 0.13);
    });
  }

  heartbeat(t, lvl) {
    [0, 0.15].forEach((d, k) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(k ? 55 : 66, t + d);
      o.frequency.exponentialRampToValueAtTime(30, t + d + 0.11);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime((k ? 0.5 : 0.85) * lvl, t + d);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.15);
      o.connect(g).connect(this.heartG);
      o.start(t + d);
      o.stop(t + d + 0.18);
    });
  }

  /** schedule one skipped beat */
  skip() { this.skipNext = true; }

  bird(t, lvl) {
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 2200;
    for (let k = 0; k < n; k++) {
      const at = t + k * (0.07 + Math.random() * 0.05);
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), at);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.4), at + 0.05);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.05 * lvl, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      o.connect(g).connect(this.master);
      o.start(at);
      o.stop(at + 0.08);
    }
  }

  tick(t, lvl) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 3200;
    f.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35 * lvl, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.03);
  }

  /** a sharp riser into the first high */
  riser(sec = 3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(11000, t + sec);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + sec);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.3);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + sec + 0.4);
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
      o.start(t + at);
      o.stop(t + at + dur + 0.05);
    };
    const hiss = (at, dur, f0, f1, lvl, q = 2) => {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, t + at);
      f.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(lvl, t + at + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      n.connect(f).connect(g).connect(this.master);
      n.start(t + at, Math.random());
      n.stop(t + at + dur + 0.05);
    };
    if (kind === "sniff") {
      hiss(0, 0.55, 700, 4200, 0.5, 1.5);
      hiss(0.62, 0.22, 900, 3000, 0.3, 1.5);
    } else if (kind === "drink") {
      tone(2400, 0, 0.35, "sine", 0.12);
      tone(3150, 0.01, 0.3, "sine", 0.08);
      hiss(0.1, 0.8, 6000, 9000, 0.05, 0.6);
    } else if (kind === "air") {
      tone(90, 0, 0.25, "sine", 0.3, 50);
      hiss(0.05, 2.2, 300, 700, 0.18, 0.5);
    } else if (kind === "talk") {
      for (let k = 0; k < 8; k++) tone(180 + Math.random() * 160, k * 0.09, 0.07, "square", 0.05);
    } else if (kind === "phone") {
      tone(1320, 0, 0.08, "sine", 0.15);
      tone(1760, 0.1, 0.12, "sine", 0.15);
    } else if (kind === "ring") {
      [0, 0.5].forEach((d) => { tone(440, d, 0.35, "sine", 0.08); tone(480, d, 0.35, "sine", 0.08); });
    } else if (kind === "no") {
      tone(330, 0, 0.3, "triangle", 0.1);
      tone(262, 0.18, 0.5, "triangle", 0.1);
    } else if (kind === "sad") {
      [50, 53, 57].forEach((m, k) => tone(mtof(m) * 0.995, k * 0.45, 2.6, "triangle", 0.07));
    }
  }
}
