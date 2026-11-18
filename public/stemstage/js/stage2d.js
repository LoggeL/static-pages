// StemStage – stage2d.js: Ersatz-Bühne ohne WebGL (Canvas 2D).
// Gleiche API wie Stage3D: setSong, onMemberClick, highlight, dispose.
// Wird von main.js benutzt, wenn WebGL fehlt (oder mit ?nogl=1 erzwungen).

const ICON = { vocals: '🎤', guitar: '🎸', bass: '🎸', drums: '🥁', piano: '🎹', other: '🎛️' };
const SKIN = ['#f3d2b3', '#d9a47c', '#a86f4c', '#f0c39a', '#7c4a32', '#e8b58f'];
const HAIR = ['#2b1d16', '#f2c14e', '#7a3b1e', '#111', '#c0392b', '#4a2c7a'];

export class Stage2D {
  constructor(containerEl, engine) {
    this.container = containerEl;
    this.engine = engine || null;
    this._members = [];
    this._clickCbs = new Set();
    this._highlightId = null;
    this._hoverId = null;
    this._disposed = false;
    this._t = 0;
    this._energy = 0;

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', 'Band-Bühne: Tippe auf einen Musiker, um sein Instrument an- oder auszuschalten');
    this.canvas.style.touchAction = 'manipulation';
    containerEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D nicht verfügbar');

    // Publikum: feste Zufallswerte
    this._crowd = Array.from({ length: 34 }, (_, i) => ({
      x: (i + Math.random() * 0.8) / 34,
      s: 0.75 + Math.random() * 0.5,
      ph: Math.random() * Math.PI * 2,
      c: `hsl(${(Math.random() * 360) | 0} 45% ${18 + Math.random() * 12}%)`,
      arm: Math.random() < 0.3,
    }));

    this._onDown = (e) => {
      const m = this._hit(e);
      if (m) this._clickCbs.forEach((cb) => { try { cb(m.stem.id); } catch (err) { console.error(err); } });
    };
    this._onMove = (e) => {
      const m = this._hit(e);
      this._hoverId = m ? m.stem.id : null;
      this.canvas.style.cursor = m ? 'pointer' : '';
    };
    this._onLeave = () => { this._hoverId = null; };
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerleave', this._onLeave);

    this._resize = this._resize.bind(this);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._resize);
      this._ro.observe(containerEl);
    } else window.addEventListener('resize', this._resize);
    this._resize();

    if (engine?.song) this.setSong(engine.song);
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }

  setSong(song) {
    this._members = (song?.stems || []).filter(Boolean).map((stem, i) => ({
      stem,
      skin: SKIN[i % SKIN.length],
      hair: HAIR[(i * 3 + 1) % HAIR.length],
      level: 0,
      on: 1,
      box: null,
    }));
  }

  onMemberClick(cb) {
    if (typeof cb !== 'function') return () => {};
    this._clickCbs.add(cb);
    return () => this._clickCbs.delete(cb);
  }

  highlight(stemId) { this._highlightId = stemId == null ? null : String(stemId); }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    window.removeEventListener('resize', this._resize);
    this.canvas.remove();
  }

  /* ───────────── intern ───────────── */

  _resize() {
    const r = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return this._members.find((m) => m.box && x >= m.box.x && x <= m.box.x + m.box.w && y >= m.box.y && y <= m.box.y + m.box.h) || null;
  }

  _eng(fn, ...a) {
    try {
      const v = this.engine?.[fn];
      return typeof v === 'function' ? v.apply(this.engine, a) : v;
    } catch { return undefined; }
  }

  _loop(now) {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(this._loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this._t += dt;
    this._draw(dt);
  }

  _draw(dt) {
    const { ctx, w, h } = this;
    const playing = !!this._eng('isPlaying');
    const bpm = this.engine?.song?.bpm || 110;
    const time = playing ? +this._eng('currentTime') || 0 : this._t * 0.35;
    const beat = time * bpm / 60;
    const ph = beat % 1;
    const pulse = playing ? Math.pow(1 - ph, 3) : 0;

    // Pegel glätten
    let energy = 0;
    for (const m of this._members) {
      const audible = this._eng('isAudible', m.stem.id) !== false;
      const lvl = playing && audible ? Math.min(1, +this._eng('getLevel', m.stem.id) || 0) : 0;
      m.level += (lvl - m.level) * Math.min(1, dt * 14);
      m.on += ((audible ? 1 : 0) - m.on) * Math.min(1, dt * 8);
      energy += m.level;
    }
    energy = this._members.length ? energy / this._members.length : 0;
    this._energy += (energy - this._energy) * Math.min(1, dt * 4);

    // Hintergrund
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#120a24');
    bg.addColorStop(1, '#05060c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const n = Math.max(1, this._members.length);
    const floorY = h * 0.8;
    const slots = this._layout(n, w, h, floorY);
    const size = slots.size;

    // Lichtkegel
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this._members.forEach((m, i) => {
      const cx = slots[i].x;
      const sway = Math.sin(this._t * 0.7 + i * 1.7) * w * 0.05;
      const a = 0.05 + 0.22 * m.on * (0.3 + m.level);
      const g = ctx.createLinearGradient(0, 0, 0, floorY);
      g.addColorStop(0, hexA(m.stem.color, a));
      g.addColorStop(1, hexA(m.stem.color, a * 0.15));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx + sway - 6, -10);
      ctx.lineTo(cx + sway + 6, -10);
      ctx.lineTo(cx + size * 0.9, floorY);
      ctx.lineTo(cx - size * 0.9, floorY);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    // Bühnenboden
    const fg = ctx.createLinearGradient(0, floorY - 8, 0, h);
    fg.addColorStop(0, '#2a1c47');
    fg.addColorStop(1, '#0d0a18');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(w * 0.04, floorY - size * 0.12);
    ctx.lineTo(w * 0.96, floorY - size * 0.12);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexA('#b04dff', 0.35 + 0.4 * pulse * this._energy);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.04, floorY - size * 0.12);
    ctx.lineTo(w * 0.96, floorY - size * 0.12);
    ctx.stroke();

    // Musiker
    this._members
      .map((m, i) => [m, i])
      .sort((a, b) => slots[a[1]].y - slots[b[1]].y)
      .forEach(([m, i]) => this._drawMember(m, slots[i].x, slots[i].y, size * slots[i].s, beat, i));

    // Publikum (Vordergrund)
    this._drawCrowd(w, h, beat, playing);
  }

  /** Eine Reihe, oder bei schmaler Bühne zwei versetzte Reihen (hinten etwas kleiner). */
  _layout(n, w, h, floorY) {
    const oneRow = Math.min(h * 0.36, (w / n) * 0.7, 160);
    if (n <= 2 || oneRow >= 90) {
      const slots = Array.from({ length: n }, (_, i) => ({ x: (w * (i + 0.5)) / n, y: floorY, s: 1 }));
      slots.size = oneRow;
      return slots;
    }
    const cols = Math.ceil(n / 2);
    const size = Math.min(h * 0.3, (w / cols) * 0.75, 160);
    const slots = Array.from({ length: n }, (_, i) => {
      const back = i % 2 === 0;
      const col = Math.floor(i / 2);
      const off = back ? 0.25 : 0.75;
      return { x: (w * (col + off)) / cols, y: back ? floorY - size * 0.75 : floorY, s: back ? 0.88 : 1 };
    });
    slots.size = size;
    return slots;
  }

  _drawMember(m, cx, floorY, size, beat, i) {
    const { ctx } = this;
    const on = m.on;
    const col = mix('#5b5f6b', m.stem.color, on);
    const bounce = Math.abs(Math.sin(beat * Math.PI)) * size * 0.07 * (0.35 + m.level) * on;
    const sway = Math.sin(beat * Math.PI + i) * 0.08 * on;
    const sleepTilt = (1 - on) * 0.35;
    const baseY = floorY - bounce;
    const hl = this._hoverId === m.stem.id || this._highlightId === m.stem.id;

    // Spot am Boden
    const spot = ctx.createRadialGradient(cx, floorY, 0, cx, floorY, size * 0.8);
    spot.addColorStop(0, hexA(m.stem.color, 0.1 + 0.45 * on * (0.3 + m.level)));
    spot.addColorStop(1, hexA(m.stem.color, 0));
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.ellipse(cx, floorY, size * 0.8, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(sway + sleepTilt);
    ctx.globalAlpha = 0.55 + 0.45 * on;

    const bodyW = size * 0.42;
    const bodyH = size * 0.5;
    const headR = size * 0.2;
    // Beine
    ctx.fillStyle = '#1b1b2a';
    roundRect(ctx, -bodyW * 0.38, -size * 0.22, bodyW * 0.3, size * 0.22, 4);
    roundRect(ctx, bodyW * 0.08, -size * 0.22, bodyW * 0.3, size * 0.22, 4);
    // Körper
    ctx.fillStyle = col;
    if (hl) { ctx.shadowColor = m.stem.color; ctx.shadowBlur = 24; }
    else if (on > 0.5) { ctx.shadowColor = m.stem.color; ctx.shadowBlur = 10 + 24 * m.level; }
    roundRect(ctx, -bodyW / 2, -size * 0.22 - bodyH, bodyW, bodyH, bodyW * 0.3);
    ctx.shadowBlur = 0;
    // Kopf
    const headY = -size * 0.22 - bodyH - headR * 0.85;
    ctx.fillStyle = mix('#9aa0ad', m.skin, on);
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix('#3a3d47', m.hair, on);
    ctx.beginPath();
    ctx.arc(0, headY - headR * 0.25, headR * 1.02, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    // Augen
    ctx.strokeStyle = '#1a1a22';
    ctx.fillStyle = '#1a1a22';
    ctx.lineWidth = Math.max(1.5, size * 0.018);
    for (const ex of [-headR * 0.38, headR * 0.38]) {
      if (on < 0.5) {
        ctx.beginPath();
        ctx.moveTo(ex - headR * 0.16, headY + headR * 0.05);
        ctx.lineTo(ex + headR * 0.16, headY + headR * 0.05);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(ex, headY + headR * 0.05, headR * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Instrument
    ctx.font = `${Math.round(size * 0.3)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ICON[m.stem.instrument] || '🎵', bodyW * 0.15, -size * 0.22 - bodyH * 0.45);
    ctx.restore();

    // Zzz
    if (on < 0.6) {
      const t = this._t;
      ctx.fillStyle = `rgba(220,225,240,${0.8 * (1 - on)})`;
      ctx.font = `700 ${Math.round(size * 0.14)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      for (let k = 0; k < 3; k++) {
        const p = (t * 0.6 + k / 3) % 1;
        ctx.globalAlpha = (1 - p) * (1 - on);
        ctx.fillText('z', cx + headR + p * size * 0.35, baseY - size * 0.22 - bodyH - headR * 1.6 - p * size * 0.4);
      }
      ctx.globalAlpha = 1;
    }

    // Name
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${Math.round(Math.max(11, size * 0.11))}px system-ui, sans-serif`;
    ctx.fillStyle = on > 0.5 ? '#fff' : '#9aa0ad';
    const label = m.stem.label || m.stem.id;
    const half = ctx.measureText(label).width / 2 + 6;
    ctx.fillText(label, Math.min(this.w - half, Math.max(half, cx)), floorY + size * 0.05);

    const top = floorY - size * 0.22 - bodyH - headR * 2 - size * 0.1;
    m.box = { x: cx - size * 0.45, y: top, w: size * 0.9, h: floorY + size * 0.25 - top };
  }

  _drawCrowd(w, h, beat, playing) {
    const { ctx } = this;
    const e = playing ? 0.3 + this._energy : 0.1;
    const r0 = Math.min(w, h) * 0.04;
    for (const p of this._crowd) {
      const jump = Math.max(0, Math.sin(beat * Math.PI * 2 + p.ph)) * r0 * 0.9 * e;
      const x = p.x * w;
      const y = h - r0 * 0.6 - jump;
      const r = r0 * p.s;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(x, y - r * 1.1, r, 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, x - r * 1.1, y - r * 0.2, r * 2.2, r * 2.4, r * 0.8);
      if (p.arm && playing) {
        ctx.strokeStyle = p.c;
        ctx.lineWidth = r * 0.45;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + r * 0.8, y);
        ctx.lineTo(x + r * 1.3, y - r * (2.2 + Math.sin(beat * Math.PI) * 0.6));
        ctx.stroke();
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

function hexToRgb(hex) {
  const v = parseInt(String(hex || '#888888').replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function hexA(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
