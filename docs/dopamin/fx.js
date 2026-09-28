// 2D layers: razor lasers + crystal glints (with trails), the crowd, particles and the cursor trail.

const TAU = Math.PI * 2;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const WORDS = ["ich", "ICH", "genau", "ehrlich", "Startup", "Vision", "krass", "hör zu", "ich sag's dir", "Potenzial", "Bro", "im Ernst"];

export function starPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s * 0.35, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s * 0.35, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.closePath();
}

export class Fx {
  constructor(trailCanvas, crispCanvas) {
    this.tc = trailCanvas;
    this.cc = crispCanvas;
    this.t = trailCanvas.getContext("2d");
    this.c = crispCanvas.getContext("2d");
    this.parts = [];
    this.trail = [];
    this.people = [];
    this.talk = 0;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    for (const cv of [this.tc, this.cc]) {
      cv.width = Math.round(cv.clientWidth * dpr);
      cv.height = Math.round(cv.clientHeight * dpr);
    }
    this.dpr = dpr;
    this.W = this.cc.width;
    this.H = this.cc.height;
    this.makeCrowd();
  }

  makeCrowd() {
    const W = this.W;
    const unit = Math.min(Math.max(W, this.H * 0.8), this.H * 1.4) / 1100;
    this.unit = unit;
    this.people = [];
    const rows = [
      { y: this.H * 0.93, s: 0.7, gap: 58, dark: 0.55 },
      { y: this.H * 1.02, s: 0.92, gap: 74, dark: 0.8 },
      { y: this.H * 1.12, s: 1.15, gap: 96, dark: 1 },
    ];
    rows.forEach((r, ri) => {
      const gap = r.gap * unit * this.dpr * 0.9;
      for (let x = rnd(-20, 20) * unit; x < W + gap; x += gap * rnd(0.8, 1.25)) {
        this.people.push({
          row: ri, x, baseY: r.y, s: r.s * unit * this.dpr, dark: r.dark,
          phase: rnd(0, TAU), arms: Math.floor(rnd(0, 4)), hue: rnd(0, 1),
          hair: Math.floor(rnd(0, 4)), leave: rnd(0.15, 1.1), sway: rnd(0.5, 1.5), hx: 0,
          watcher: Math.random() < 0.55, look: 0,
        });
      }
    });
    this.people.sort((a, b) => a.row - b.row);
  }

  pointer(x, y) {
    this.trail.push({ x: x * this.dpr, y: y * this.dpr, age: 0 });
    if (this.trail.length > 120) this.trail.shift();
  }

  burst(x, y, kind = "star") {
    x *= this.dpr;
    y *= this.dpr;
    const n = kind === "star" ? 18 : 8;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(120, 520) * this.dpr;
      this.parts.push({
        type: kind === "star" && i % 3 === 0 ? "star" : "spark",
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0, drag: 3.2, life: rnd(0.5, 1.1), max: 1.1,
        size: rnd(6, 16) * this.dpr, gold: kind === "star" && Math.random() < 0.4,
      });
    }
    this.parts.push({ type: "ring", x, y, life: 0.6, max: 0.6, size: 10 });
  }

  /** the white-out of a fresh line */
  shockwave() {
    this.parts.push({ type: "ring", x: this.W / 2, y: this.H / 2, life: 1.1, max: 1.1, size: 30, big: true });
  }

  startTalk() { this.talk = 6; }

  nosebleed() {
    for (let i = 0; i < 3; i++) {
      this.parts.push({ type: "blood", x: this.W * rnd(0.46, 0.54), y: -10 - i * 60 * this.dpr, vx: 0, vy: rnd(30, 60), g: 40, life: 6, max: 6, size: rnd(7, 11) * this.dpr });
    }
  }

  update(S, dt, time, beatPos, beat) {
    const { W, H, t: tc, c: cc } = this;
    const E = S.E, dys = S.dark, gentle = S.gentle, lvl = S.c;

    // ---------- trail layer ----------
    const fade = clamp(1 - E * 0.8 + dys * 0.4, 0.12, 1);
    tc.globalCompositeOperation = "destination-out";
    tc.fillStyle = `rgba(0,0,0,${fade})`;
    tc.fillRect(0, 0, W, H);
    tc.globalCompositeOperation = "lighter";

    // lasers: thin, white, fast
    const srcs = [0.12, 0.5, 0.88];
    const nBeams = 1 + Math.floor(E * 6 * (1 - dys * 0.8));
    const laserA = (0.12 + 0.6 * E) * (1 - dys * 0.75) * (1 - S.air * 0.9);
    const sweep = (gentle ? 0.25 : 0.7) * (1 + lvl * 0.8);
    srcs.forEach((sx, si) => {
      for (let b = 0; b < nBeams; b++) {
        const spread = (b - (nBeams - 1) / 2) * (0.1 + 0.06 * beat * E);
        const ang = Math.PI / 2 + spread + Math.sin(time * sweep * (0.8 + si * 0.25) + si * 2 + b * 0.25) * (0.3 + 0.4 * E);
        const gold = E > 0.7 && (b + si) % 3 === 0;
        const col = gold ? "255,201,74" : E < 0.25 ? "150,170,200" : "215,240,255";
        const x0 = sx * W, y0 = -10;
        const x1 = x0 + Math.cos(ang) * H * 1.6, y1 = y0 + Math.sin(ang) * H * 1.6;
        tc.strokeStyle = `rgba(${col},${laserA * 0.1})`;
        tc.lineWidth = 9 * this.dpr;
        tc.beginPath(); tc.moveTo(x0, y0); tc.lineTo(x1, y1); tc.stroke();
        tc.strokeStyle = `rgba(${col},${laserA})`;
        tc.lineWidth = 1.1 * this.dpr;
        tc.stroke();
      }
    });

    // crystal glints
    const nGlints = Math.floor(70 * E * (1 - dys));
    for (let i = 0; i < nGlints; i++) {
      const h1 = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
      const tw = Math.pow(Math.max(0, Math.sin(time * (2 + h1 * 3) + i)), 12);
      if (tw < 0.05) continue;
      const x = W * ((i * 0.618 + h1 * 0.3) % 1);
      const y = H * (0.08 + ((i * 0.377 + h1) % 1) * 0.6);
      tc.fillStyle = h1 > 0.8 ? `rgba(255,210,110,${tw * E})` : `rgba(235,248,255,${tw * E})`;
      starPath(tc, x, y, (4 + 8 * h1) * this.dpr * tw);
      tc.fill();
    }

    // ---------- crisp layer ----------
    cc.clearRect(0, 0, W, H);
    this.talk = Math.max(0, this.talk - dt);
    const energy = clamp(S.dance * (0.25 + 0.9 * lvl) * (1 - dys * 0.6), 0.08, 1.3);
    const cx = W / 2;

    for (const p of this.people) {
      const gone = clamp((S.leave - p.leave) * 5);
      p.alpha = 1 - gone;
      if (p.alpha <= 0.01) continue;
      const u = p.s;
      // stimulant dancing: faster, twitchier, on every 16th when high
      const bounce = Math.abs(Math.sin(Math.PI * beatPos + p.phase * 0.2)) * 12 * u * energy;
      const sway = Math.sin(time * (0.8 + lvl) * p.sway + p.phase) * 8 * u * energy;
      // talking at them: the people in front of you drift away
      let target = 0;
      if (this.talk > 0.5 && p.row >= 1 && Math.abs(p.x - cx) < W * 0.28) target = Math.sign(p.x - cx || 1) * W * 0.12;
      p.hx += (target - p.hx) * Math.min(1, dt * (target ? 1.4 : 0.4));
      p._x = p.x + sway + p.hx;
      p._hy = p.baseY - 250 * u - bounce;
    }

    for (const p of this.people) {
      if (p.alpha <= 0.01) continue;
      this.drawPerson(cc, p, beatPos, energy, E, time, S.anx);
    }

    // the monologue: your words float up and nobody catches them
    if (this.talk > 0.5 && Math.random() < dt * 5) {
      this.parts.push({ type: "word", text: WORDS[Math.floor(rnd(0, WORDS.length))], x: cx + rnd(-60, 60) * this.dpr, y: H * 0.72, vx: rnd(-30, 30), vy: -rnd(50, 90), g: 0, life: 2.4, max: 2.4, size: rnd(14, 22) * this.dpr });
    }
    if (S.kick > 0.3 && Math.random() < S.kick * dt * 30) {
      const a = rnd(0, TAU), d = rnd(0.35, 0.6) * Math.max(W, H);
      this.parts.push({ type: "streak", x: cx + Math.cos(a) * d, y: H / 2 + Math.sin(a) * d, vx: -Math.cos(a) * 1400 * this.dpr, vy: -Math.sin(a) * 1400 * this.dpr, g: 0, life: 0.35, max: 0.35, size: rnd(40, 110) * this.dpr });
    }

    // particles
    cc.textAlign = "center";
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life -= dt;
      if (q.life <= 0) { this.parts.splice(i, 1); continue; }
      if (q.drag) { q.vx *= Math.exp(-q.drag * dt); q.vy *= Math.exp(-q.drag * dt); }
      q.vy += (q.g || 0) * dt;
      q.x += (q.vx || 0) * dt;
      q.y += (q.vy || 0) * dt;
      const a = clamp(q.life / q.max);
      if (q.type === "star") {
        cc.fillStyle = q.gold ? `rgba(255,201,74,${a})` : `rgba(240,250,255,${a})`;
        starPath(cc, q.x, q.y, q.size * (0.6 + a * 0.6));
        cc.fill();
      } else if (q.type === "spark") {
        cc.strokeStyle = `rgba(220,240,255,${a})`;
        cc.lineWidth = 1.2 * this.dpr;
        cc.beginPath(); cc.moveTo(q.x, q.y); cc.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); cc.stroke();
      } else if (q.type === "streak") {
        const n = Math.hypot(q.vx, q.vy) || 1;
        cc.strokeStyle = `rgba(235,248,255,${a * 0.8})`;
        cc.lineWidth = 1.4 * this.dpr;
        cc.beginPath(); cc.moveTo(q.x, q.y); cc.lineTo(q.x - (q.vx / n) * q.size, q.y - (q.vy / n) * q.size); cc.stroke();
      } else if (q.type === "ring") {
        const r = (1 - a) * (q.big ? Math.max(W, H) * 0.8 : 200 * this.dpr) + q.size;
        cc.strokeStyle = `rgba(235,248,255,${a * 0.8})`;
        cc.lineWidth = (q.big ? 6 : 2) * this.dpr * a;
        cc.beginPath(); cc.arc(q.x, q.y, r, 0, TAU); cc.stroke();
      } else if (q.type === "word") {
        cc.font = `700 ${q.size}px Archivo, sans-serif`;
        cc.fillStyle = `rgba(255,220,140,${a * 0.9})`;
        cc.fillText(q.text, q.x, q.y);
      } else if (q.type === "blood") {
        cc.fillStyle = `rgba(200,10,30,${Math.min(1, a * 1.5) * 0.85})`;
        cc.beginPath();
        cc.moveTo(q.x, q.y - q.size * 1.7);
        cc.quadraticCurveTo(q.x + q.size, q.y, q.x, q.y + q.size * 0.6);
        cc.quadraticCurveTo(q.x - q.size, q.y, q.x, q.y - q.size * 1.7);
        cc.fill();
      }
    }

    // cursor trail: a thin, hyper-sharp afterimage
    const life = 0.04 + 0.6 * E * (1 - dys * 0.7);
    for (const p of this.trail) p.age += dt;
    while (this.trail.length && this.trail[0].age > life) this.trail.shift();
    if (this.trail.length > 2 && E > 0.05) {
      cc.globalCompositeOperation = "lighter";
      cc.lineCap = "round";
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        const k = 1 - b.age / life;
        cc.strokeStyle = `rgba(210,240,255,${k * E})`;
        cc.lineWidth = (1 + 4 * k * E) * this.dpr;
        cc.beginPath(); cc.moveTo(a.x, a.y); cc.lineTo(b.x, b.y); cc.stroke();
      }
      cc.globalCompositeOperation = "source-over";
    }
  }

  drawPerson(ctx, p, beatPos, energy, E, time, anx) {
    const u = p.s;
    const x = p._x, hy = p._hy;
    const shY = hy + 38 * u;
    const pump = Math.sin(Math.PI * 2 * beatPos * 0.5 + p.phase);
    ctx.globalAlpha = p.alpha;

    const rimA = (0.1 + 0.55 * E) * (p.row === 2 ? 1 : 0.7);
    const rim = E > 0.65 && p.hue > 0.7 ? `rgba(255,201,74,${rimA})` : `rgba(210,235,255,${rimA})`;
    const fill = `rgb(${5 + 4 * (1 - p.dark)},${6 + 4 * (1 - p.dark)},${9 + 7 * (1 - p.dark)})`;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = fill;
    ctx.lineWidth = 17 * u;
    const arm = (side, mode) => {
      const sx = x + side * 30 * u;
      let ex, ey, hx, hy2;
      if (mode === 1 || (mode === 2 && side === 1) || (mode === 3 && side === -1)) {
        const lift = energy > 0.35 ? 1 : energy * 2.5;
        const wav = pump * 16 * u * energy;
        ex = sx + side * 22 * u; ey = shY - 45 * u * lift;
        hx = sx + side * 10 * u + wav * 0.6; hy2 = shY - (105 * lift - 10) * u + wav;
      } else {
        ex = sx + side * 16 * u; ey = shY + 60 * u; hx = sx + side * 8 * u; hy2 = shY + 120 * u;
      }
      ctx.beginPath(); ctx.moveTo(sx, shY + 6 * u); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy2); ctx.stroke();
      return [ex, ey, hx, hy2, sx, hy2 < shY];
    };
    const la = arm(-1, p.arms), ra = arm(1, p.arms);

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x - 36 * u, shY + 10 * u);
    ctx.quadraticCurveTo(x, shY - 10 * u, x + 36 * u, shY + 10 * u);
    ctx.lineTo(x + 30 * u, shY + 220 * u);
    ctx.lineTo(x - 30 * u, shY + 220 * u);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath(); ctx.arc(x, hy, 24 * u, 0, TAU); ctx.fill();
    if (p.hair === 1) { ctx.beginPath(); ctx.arc(x - 6 * u, hy - 22 * u, 11 * u, 0, TAU); ctx.fill(); }
    if (p.hair === 2) { ctx.beginPath(); ctx.ellipse(x + 22 * u, hy + 6 * u, 8 * u, 22 * u, 0.3, 0, TAU); ctx.fill(); }
    if (p.hair === 3) { ctx.fillRect(x - 27 * u, hy - 12 * u, 54 * u, 9 * u); }

    ctx.strokeStyle = rim;
    ctx.lineWidth = 2 * u;
    ctx.beginPath(); ctx.arc(x, hy, 24 * u, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 36 * u, shY + 10 * u);
    ctx.quadraticCurveTo(x, shY - 10 * u, x + 36 * u, shY + 10 * u);
    ctx.stroke();
    for (const a of [la, ra]) {
      if (!a[5]) continue;
      ctx.beginPath(); ctx.moveTo(a[4], shY + 6 * u); ctx.lineTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.stroke();
    }

    // paranoia: some of them turn around and look straight at you
    const want = p.watcher && anx > 0.3 ? clamp((anx - 0.3) * 2.2) : 0;
    p.look += (want - p.look) * 0.04;
    if (p.look > 0.03) {
      const blink = Math.sin(time * 0.7 + p.phase * 5) > 0.97 ? 0.1 : 1;
      ctx.fillStyle = `rgba(255,236,236,${p.look * blink})`;
      ctx.shadowColor = "rgba(255,40,60,.9)";
      ctx.shadowBlur = 10 * u;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(x + s * 8 * u, hy + 2 * u, 3.4 * u, 2.2 * u, 0, 0, TAU); ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}

/** grey drizzle for the Sunday */
export class Rain {
  constructor(cv) {
    this.cv = cv;
    this.ctx = cv.getContext("2d");
    this.drops = [];
    this.on = false;
  }
  start() {
    if (this.on) return;
    this.on = true;
    const loop = () => {
      if (!this.on) return;
      const cv = this.cv, ctx = this.ctx;
      if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) {
        cv.width = cv.clientWidth;
        cv.height = cv.clientHeight;
      }
      ctx.clearRect(0, 0, cv.width, cv.height);
      while (this.drops.length < 110) this.drops.push({ x: rnd(0, cv.width * 1.2), y: rnd(-cv.height, 0), v: rnd(420, 760), l: rnd(8, 22) });
      ctx.strokeStyle = "rgba(170,185,210,.32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        d.y += d.v / 60;
        d.x -= (d.v / 60) * 0.12;
        if (d.y > cv.height) { d.y = rnd(-80, 0); d.x = rnd(0, cv.width * 1.2); }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.l * 0.12, d.y + d.l);
      }
      ctx.stroke();
      requestAnimationFrame(loop);
    };
    loop();
  }
  stop() { this.on = false; }
}
