import {
  BELT_TEETH,
  CRANK_RADIUS,
  TAU,
  lockable,
  loopLength,
  pointOnBelt,
  sections,
  toothPitch,
  wheelRotation,
  wheels,
} from './drive';
import type { View, VisualState } from './drive';
import type { Pick, Viewer } from './viewer';

export class Schematic implements Viewer {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private dirty = true;

  constructor(
    private host: HTMLElement,
    onPick: (part: Pick) => void,
  ) {
    host.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => {
      this.dirty = true;
    }).observe(host);
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) / this.scale;
      const y = (r.height / 2 - e.clientY + r.top) / this.scale + 0.1;
      const w = wheels.find((w) => Math.hypot(w.x - x, w.y - y) <= w.r + 0.06);
      if (w) onPick(w.id);
    });
  }

  setView(_view: View) {
    this.dirty = true;
  }
  setHoodOpen(_open: boolean) {}

  draw(s: VisualState, changed: boolean) {
    if (!changed && !this.dirty) return;
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.scale = Math.min(w / 4.3, h / 4.35);
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.translate(w / 2, h / 2 + this.scale * 0.1);
    c.scale(this.scale, -this.scale);

    const circle = (x: number, y: number, r: number, fill: string) => {
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fillStyle = fill;
      c.fill();
    };

    for (const wheel of wheels) {
      c.save();
      c.translate(wheel.x, wheel.y);
      c.rotate(wheelRotation(wheel, s.angle));
      const r = wheel.r;
      circle(0, 0, r - 0.01, '#b4c2c2');
      circle(0, 0, r * 0.88, '#4d595b');
      if (wheel.teeth) {
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          circle(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.145, '#192120');
        }
      }
      circle(0, 0, r * 0.24, '#c5ceca');
      if (lockable.includes(wheel.id)) {
        c.fillStyle = '#ffb45d';
        c.fillRect(-0.016, r * 0.72, 0.032, r * 0.25);
      }
      c.restore();

      if (lockable.includes(wheel.id)) {
        circle(wheel.x, wheel.y + r + 0.08, 0.025, s.otAligned ? '#c0ff52' : '#ffb45d');
      }
      if (s.locks.includes(wheel.id))
        circle(wheel.x + r * 0.44, wheel.y + r * 0.26, 0.046, '#ffb45d');
      if (s.selected === wheel.id && !s.routingActive) {
        c.beginPath();
        c.arc(wheel.x, wheel.y, r + 0.055, 0, TAU);
        c.strokeStyle = '#b8ffea';
        c.lineWidth = 0.018;
        c.stroke();
      }
      if (wheel.id === 'tensioner') {
        c.strokeStyle = '#c5ceca';
        c.lineWidth = 0.02;
        c.strokeRect(wheel.x - 0.05, wheel.y + 0.22, 0.1, 0.06);
        c.save();
        c.translate(wheel.x, wheel.y);
        c.rotate((0.5 - s.tension) * 1.9);
        c.fillStyle = Math.abs(s.tension - 0.5) <= 0.04 ? '#c0ff52' : '#ffb45d';
        c.fillRect(-0.012, 0.04, 0.024, 0.21);
        c.restore();
      }
    }

    const covered = s.belt ? loopLength : s.routing ? sections[s.routing - 1].end : 0;
    const isPartial = covered > 0 && covered < loopLength - 0.001;

    if (s.routingActive && s.routing < wheels.length) {
      c.save();
      c.setLineDash([0.09, 0.09]);
      c.beginPath();
      for (let i = 0; i <= 240; i++) {
        const p = pointOnBelt(covered + ((loopLength - covered) * i) / 240);
        const x = p.x + p.nx * 0.02,
          y = p.y + p.ny * 0.02;
        if (!i) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.lineWidth = 0.024;
      c.strokeStyle = 'rgba(190,238,100,0.65)';
      c.stroke();
      c.restore();

      const nextW = wheels[s.routing];
      c.beginPath();
      c.arc(nextW.x, nextW.y, nextW.r + 0.068, 0, TAU);
      c.strokeStyle = '#c0ff52';
      c.lineWidth = 0.022;
      c.stroke();
    }

    if (covered) {
      c.beginPath();
      for (let i = 0; i <= 400; i++) {
        const p = pointOnBelt((covered * i) / 400);
        const x = p.x + p.nx * 0.02,
          y = p.y + p.ny * 0.02;
        if (!i) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.lineWidth = 0.065;
      c.strokeStyle = '#70817b';
      c.stroke();
      if (s.neon) {
        c.lineWidth = 0.022;
        c.strokeStyle = '#c2ff54';
        c.stroke();
      }

      const dist = ((s.angle * Math.PI) / 180) * CRANK_RADIUS;
      if (!isPartial) {
        for (let i = 0; i < BELT_TEETH; i++) {
          const p = pointOnBelt(i * toothPitch + dist);
          c.save();
          c.translate(p.x, p.y);
          c.rotate(Math.atan2(p.ty, p.tx));
          c.fillStyle = '#7c8985';
          c.fillRect(-0.017, -0.024, 0.034, 0.026);
          c.restore();
        }
      } else {
        const phase = ((dist % toothPitch) + toothPitch) % toothPitch;
        for (let sPos = phase; sPos <= covered - toothPitch * 0.2; sPos += toothPitch) {
          if (sPos < toothPitch * 0.15) continue;
          const p = pointOnBelt(sPos);
          c.save();
          c.translate(p.x, p.y);
          c.rotate(Math.atan2(p.ty, p.tx));
          c.fillStyle = '#7c8985';
          c.fillRect(-0.017, -0.024, 0.034, 0.026);
          c.restore();
        }
      }
    }

    if (s.cover) {
      c.fillStyle = '#34403d';
      c.beginPath();
      c.moveTo(-1.3, 1.85);
      c.lineTo(1.55, 1.72);
      c.lineTo(1.5, 1);
      c.lineTo(0.29, -1.58);
      c.lineTo(-0.4, -1.51);
      c.lineTo(-1.28, 1.02);
      c.closePath();
      c.fill();
    }
    this.dirty = false;
  }
}
