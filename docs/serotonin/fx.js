// 2D layers: lasers + mirror-ball specks (with trails), the crowd, particles and the cursor trail.

const TAU = Math.PI * 2;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.95, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 0.95, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
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
    this.hug = 0;
    this.hugPairs = [];
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
          phase: rnd(0, TAU), arms: Math.floor(rnd(0, 4)), hue: rnd(0, 360),
          hair: Math.floor(rnd(0, 4)), leave: rnd(0.15, 1.1), sway: rnd(0.5, 1.5), hx: 0, hugDir: 0,
        });
      }
    });
    this.people.sort((a, b) => a.row - b.row);
  }

  pointer(x, y) {
    this.trail.push({ x: x * this.dpr, y: y * this.dpr, age: 0 });
    if (this.trail.length > 160) this.trail.shift();
  }

  burst(x, y, kind = "love") {
    x *= this.dpr;
    y *= this.dpr;
    const n = kind === "love" ? 26 : 10;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(80, 360) * this.dpr;
      this.parts.push({
        type: kind === "love" ? (i % 3 ? "heart" : "spark") : "spark",
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 140, life: rnd(1.2, 2.4), max: 2.4,
        size: rnd(6, 16) * this.dpr, hue: rnd(300, 420) % 360,
      });
    }
    this.parts.push({ type: "ring", x, y, life: 1.2, max: 1.2, size: 10, hue: rnd(0, 360) });
  }

  startHug() {
    const front = this.people.filter((p) => p.row >= 1);
    this.hugPairs = [];
    for (let i = 0; i + 1 < front.length; i += 2) {
      if (front[i].row === front[i + 1].row && Math.random() < 0.7) this.hugPairs.push([front[i], front[i + 1]]);
    }
    this.hug = 4.5;
  }

  update(S, dt, time, beatPos, beat) {
    const { W, H, t: tc, c: cc } = this;
    const E = S.E, dys = S.dark, gentle = S.gentle;

    // ---------- trail layer ----------
    const fade = clamp(1 - E * 0.9 + dys * 0.4, 0.07, 1);
    tc.globalCompositeOperation = "destination-out";
    tc.fillStyle = `rgba(0,0,0,${fade})`;
    tc.fillRect(0, 0, W, H);
    tc.globalCompositeOperation = "lighter";

    // lasers
    const srcs = [0.18, 0.5, 0.82];
    const nBeams = 1 + Math.floor(E * 5 * (1 - dys * 0.8));
    const laserA = (0.18 + 0.55 * E) * (1 - dys * 0.7) * (1 - S.chill * 0.8);
    const sweep = gentle ? 0.25 : 0.6;
    srcs.forEach((sx, si) => {
      for (let b = 0; b < nBeams; b++) {
        const spread = (b - (nBeams - 1) / 2) * (0.14 + 0.1 * beat * E);
        const ang = Math.PI / 2 + spread + Math.sin(time * sweep * (0.7 + si * 0.2) + si * 2 + b * 0.3) * (0.35 + 0.35 * E);
        const hue = E < 0.25 ? 350 : (time * 40 + si * 90 + b * 25) % 360;
        const x0 = sx * W, y0 = -10;
        const x1 = x0 + Math.cos(ang) * H * 1.6, y1 = y0 + Math.sin(ang) * H * 1.6;
        tc.strokeStyle = `hsla(${hue},100%,60%,${laserA * 0.12})`;
        tc.lineWidth = 12 * this.dpr;
        tc.beginPath(); tc.moveTo(x0, y0); tc.lineTo(x1, y1); tc.stroke();
        tc.strokeStyle = `hsla(${hue},100%,70%,${laserA})`;
        tc.lineWidth = 1.6 * this.dpr;
        tc.stroke();
      }
    });

    // mirror-ball specks
    const nSpecks = Math.floor(90 * E * (1 - dys));
    for (let i = 0; i < nSpecks; i++) {
      const h1 = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const th = i * 2.399 + time * 0.22;
      const x = W * (0.5 + Math.cos(th) * (0.2 + 0.5 * Math.abs(h1)));
      const y = H * (0.42 + Math.sin(th * 1.3 + i) * (0.15 + 0.3 * Math.abs(h1)));
      tc.fillStyle = `hsla(${(i * 37 + time * 30) % 360},90%,80%,${0.5 * E})`;
      tc.fillRect(x, y, 3 * this.dpr, 3 * this.dpr);
    }

    // ---------- crisp layer ----------
    cc.clearRect(0, 0, W, H);
    this.hug = Math.max(0, this.hug - dt);
    const energy = clamp(S.dance * (0.22 + 0.78 * S.stim) * (1 - dys * 0.65), 0.08, 1.2);

    // empathy web between heads
    const heads = [];
    for (const p of this.people) {
      const gone = clamp((S.leave - p.leave) * 5);
      p.alpha = 1 - gone;
      if (p.alpha <= 0.01) continue;
      const u = p.s;
      const bounce = Math.abs(Math.sin(Math.PI * beatPos + p.phase * 0.2)) * 12 * u * energy;
      const sway = Math.sin(time * 0.8 * p.sway + p.phase) * 10 * u * energy;
      // hugging pairs lean together
      let target = 0;
      for (const [a, b] of this.hugPairs) {
        if (a === p) target = (b.x - a.x) * 0.3;
        if (b === p) target = (a.x - b.x) * 0.3;
      }
      p.hx += ((this.hug > 0.4 ? target : 0) - p.hx) * Math.min(1, dt * 4);
      const x = p.x + sway + p.hx;
      const headY = p.baseY - 250 * u - bounce;
      p._x = x; p._hy = headY;
      if (p.row >= 1) heads.push(p);
    }

    if (S.love > 0.35) {
      const la = (S.love - 0.35) * 0.9 * (1 - dys);
      cc.globalCompositeOperation = "lighter";
      cc.lineWidth = 1.2 * this.dpr;
      for (let i = 0; i < heads.length; i++) {
        for (let j = i + 1; j < Math.min(heads.length, i + 4); j++) {
          const a = heads[i], b = heads[j];
          const g = cc.createLinearGradient(a._x, a._hy, b._x, b._hy);
          g.addColorStop(0, `hsla(${(320 + time * 20) % 360},100%,70%,${la * a.alpha})`);
          g.addColorStop(1, `hsla(${(50 + time * 20) % 360},100%,70%,${la * b.alpha})`);
          cc.strokeStyle = g;
          const mx = (a._x + b._x) / 2, my = Math.min(a._hy, b._hy) - 60 * a.s;
          cc.beginPath(); cc.moveTo(a._x, a._hy); cc.quadraticCurveTo(mx, my, b._x, b._hy); cc.stroke();
          // travelling pulse
          const k = (time * 0.6 + i * 0.13) % 1;
          const px = (1 - k) * (1 - k) * a._x + 2 * (1 - k) * k * mx + k * k * b._x;
          const py = (1 - k) * (1 - k) * a._hy + 2 * (1 - k) * k * my + k * k * b._hy;
          cc.fillStyle = `rgba(255,255,255,${la})`;
          cc.beginPath(); cc.arc(px, py, 2.2 * this.dpr, 0, TAU); cc.fill();
        }
      }
      cc.globalCompositeOperation = "source-over";
    }

    for (const p of this.people) {
      if (p.alpha <= 0.01) continue;
      this.drawPerson(cc, p, beatPos, energy, E, time);
    }

    // hearts over hugging pairs
    if (this.hug > 0) {
      for (const [a, b] of this.hugPairs) {
        const x = (a._x + b._x) / 2, y = Math.min(a._hy, b._hy) - 50 * a.s;
        const s = (14 + 6 * beat) * a.s * clamp(this.hug);
        cc.fillStyle = `hsla(${330 + Math.sin(time * 3) * 20},100%,65%,${clamp(this.hug) * 0.9})`;
        heartPath(cc, x, y, s * 2);
        cc.fill();
      }
    }

    // ambient particles
    if (S.tingle > 0.05 && Math.random() < S.tingle * dt * 60) {
      const edge = Math.floor(rnd(0, 4));
      const x = edge === 0 ? rnd(0, 40) : edge === 1 ? W - rnd(0, 40) : rnd(0, W);
      const y = edge === 2 ? rnd(0, 40) : edge === 3 ? H * rnd(0.5, 1) : rnd(0, H);
      this.parts.push({ type: "tingle", x, y, vx: rnd(-40, 40), vy: rnd(-40, 40), g: 0, life: rnd(0.3, 0.8), max: 0.8, size: rnd(4, 10) * this.dpr, hue: rnd(180, 300) });
    }
    if (S.love > 0.6 && Math.random() < (S.love - 0.6) * dt * 6 && heads.length) {
      const p = heads[Math.floor(rnd(0, heads.length))];
      this.parts.push({ type: "heart", x: p._x, y: p._hy - 40 * p.s, vx: rnd(-20, 20), vy: -rnd(40, 90), g: -10, life: 2.5, max: 2.5, size: rnd(6, 12) * this.dpr, hue: rnd(310, 360) });
    }
    if (S.heat > 0.15 && Math.random() < S.heat * dt * 8) {
      this.parts.push({ type: "drop", x: rnd(0, W), y: rnd(-10, H * 0.3), vx: 0, vy: rnd(20, 60), g: 30, life: 3, max: 3, size: rnd(4, 9) * this.dpr });
    }

    // particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life -= dt;
      if (q.life <= 0) { this.parts.splice(i, 1); continue; }
      q.vy += (q.g || 0) * dt;
      q.x += (q.vx || 0) * dt;
      q.y += (q.vy || 0) * dt;
      const a = clamp(q.life / q.max);
      if (q.type === "heart") {
        cc.fillStyle = `hsla(${q.hue},100%,68%,${a})`;
        heartPath(cc, q.x, q.y, q.size * (1.2 - a * 0.2));
        cc.fill();
      } else if (q.type === "spark" || q.type === "tingle") {
        cc.globalCompositeOperation = "lighter";
        cc.strokeStyle = `hsla(${q.hue},100%,75%,${a})`;
        cc.lineWidth = 1.5 * this.dpr;
        const s = q.size * a;
        cc.beginPath();
        cc.moveTo(q.x - s, q.y); cc.lineTo(q.x + s, q.y);
        cc.moveTo(q.x, q.y - s); cc.lineTo(q.x, q.y + s);
        cc.stroke();
        cc.globalCompositeOperation = "source-over";
      } else if (q.type === "ring") {
        const r = (1 - a) * 260 * this.dpr;
        cc.strokeStyle = `hsla(${q.hue},100%,70%,${a * 0.8})`;
        cc.lineWidth = 3 * this.dpr * a;
        cc.beginPath(); cc.arc(q.x, q.y, r, 0, TAU); cc.stroke();
      } else if (q.type === "drop") {
        cc.fillStyle = `rgba(190,230,255,${a * 0.35})`;
        cc.beginPath();
        cc.moveTo(q.x, q.y - q.size * 1.6);
        cc.quadraticCurveTo(q.x + q.size, q.y, q.x, q.y + q.size * 0.6);
        cc.quadraticCurveTo(q.x - q.size, q.y, q.x, q.y - q.size * 1.6);
        cc.fill();
      }
    }

    // cursor trail — the classic tracer
    const life = 0.04 + 1.5 * E * (1 - dys * 0.7);
    for (const p of this.trail) p.age += dt;
    while (this.trail.length && this.trail[0].age > life) this.trail.shift();
    if (this.trail.length > 2 && E > 0.05) {
      cc.globalCompositeOperation = "lighter";
      cc.lineCap = "round";
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        const k = 1 - b.age / life;
        cc.strokeStyle = `hsla(${(time * 120 + i * 6) % 360},100%,65%,${k * E})`;
        cc.lineWidth = (2 + 14 * k * E) * this.dpr;
        cc.beginPath(); cc.moveTo(a.x, a.y); cc.lineTo(b.x, b.y); cc.stroke();
      }
      cc.globalCompositeOperation = "source-over";
    }
  }

  drawPerson(ctx, p, beatPos, energy, E, time) {
    const u = p.s;
    const x = p._x, hy = p._hy;
    const shY = hy + 38 * u;
    const pump = Math.sin(Math.PI * 2 * beatPos * 0.5 + p.phase);
    ctx.globalAlpha = p.alpha;

    // rim light colour follows the lasers
    const rimA = (0.12 + 0.6 * E) * (p.row === 2 ? 1 : 0.7);
    const rim = `hsla(${(p.hue + time * 30) % 360},100%,65%,${rimA})`;
    const fill = `rgb(${6 + 4 * (1 - p.dark)},${5 + 4 * (1 - p.dark)},${10 + 8 * (1 - p.dark)})`;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // arms
    ctx.strokeStyle = fill;
    ctx.lineWidth = 17 * u;
    const arm = (side, mode) => {
      const sx = x + side * 30 * u;
      let ex, ey, hx, hy2;
      if (this.hug > 0.4 && p.hx !== 0 && Math.abs(p.hx) > 4 * u) {
        const dir = Math.sign(p.hx);
        ex = sx + dir * 30 * u; ey = shY + 25 * u; hx = sx + dir * 70 * u; hy2 = shY + 5 * u;
      } else if (mode === 1 || (mode === 2 && side === 1) || (mode === 3 && side === -1)) {
        const lift = energy > 0.35 ? 1 : energy * 2.5;
        const wav = pump * 18 * u * energy;
        ex = sx + side * 22 * u; ey = shY - 45 * u * lift;
        hx = sx + side * 10 * u + wav * 0.6; hy2 = shY - (105 * lift - 10) * u + wav;
      } else {
        ex = sx + side * 16 * u; ey = shY + 60 * u; hx = sx + side * 8 * u; hy2 = shY + 120 * u;
      }
      ctx.beginPath(); ctx.moveTo(sx, shY + 6 * u); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy2); ctx.stroke();
      return [ex, ey, hx, hy2, sx, hy2 < shY];
    };
    const la = arm(-1, p.arms), ra = arm(1, p.arms);

    // torso
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x - 36 * u, shY + 10 * u);
    ctx.quadraticCurveTo(x, shY - 10 * u, x + 36 * u, shY + 10 * u);
    ctx.lineTo(x + 30 * u, shY + 220 * u);
    ctx.lineTo(x - 30 * u, shY + 220 * u);
    ctx.closePath();
    ctx.fill();

    // head + hair
    ctx.beginPath(); ctx.arc(x, hy, 24 * u, 0, TAU); ctx.fill();
    if (p.hair === 1) { ctx.beginPath(); ctx.arc(x - 6 * u, hy - 22 * u, 11 * u, 0, TAU); ctx.fill(); }
    if (p.hair === 2) { ctx.beginPath(); ctx.ellipse(x + 22 * u, hy + 6 * u, 8 * u, 22 * u, 0.3, 0, TAU); ctx.fill(); }
    if (p.hair === 3) { ctx.fillRect(x - 27 * u, hy - 12 * u, 54 * u, 9 * u); }

    // rim light
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
    ctx.globalAlpha = 1;
  }
}

/** rain for the Tuesday */
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
      while (this.drops.length < 140) this.drops.push({ x: rnd(0, cv.width * 1.2), y: rnd(-cv.height, 0), v: rnd(500, 900), l: rnd(10, 26) });
      ctx.strokeStyle = "rgba(170,185,210,.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        d.y += d.v / 60;
        d.x -= d.v / 60 * 0.15;
        if (d.y > cv.height) { d.y = rnd(-80, 0); d.x = rnd(0, cv.width * 1.2); }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.l * 0.15, d.y + d.l);
      }
      ctx.stroke();
      requestAnimationFrame(loop);
    };
    loop();
  }
  stop() { this.on = false; }
}
