import * as THREE from 'three';
import { evaluate, fmtLen, dist } from './measure.js';

// Zeichnet Messpunkte, Linien und Maßzahlen als SVG/HTML über das 3D-Bild.
// Die Elemente liegen immer oben (keine Verdeckung durch den Splat) und
// bleiben so bei jeder Zoomstufe gestochen scharf.

const COLORS = { dist: '#ffd23f', area: '#3ddc97', height: '#ff7ab6', calib: '#7cc4ff' };

export class Overlay {
  constructor(svg, labels, camera) {
    this.svg = svg;
    this.labels = labels;
    this.camera = camera;
    this._v = new THREE.Vector3();
    this.w = 1; this.h = 1;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  // Weltpunkt -> Kameraraum
  view(p) {
    return this._v.set(p[0], p[1], p[2]).applyMatrix4(this.camera.matrixWorldInverse).clone();
  }
  // Kameraraum -> Bildschirm (Pixel)
  screen(v) {
    const c = v.clone().applyMatrix4(this.camera.projectionMatrix);
    return [(c.x * 0.5 + 0.5) * this.w, (1 - (c.y * 0.5 + 0.5)) * this.h];
  }
  // Strecke an der Near-Plane kappen; null, wenn komplett hinter der Kamera
  clip(a, b) {
    const near = -(this.camera.near * 1.01);
    const ain = a.z < near, bin = b.z < near;
    if (!ain && !bin) return null;
    let p = a, q = b;
    if (!ain) p = a.clone().lerp(b, (near - a.z) / (b.z - a.z));
    if (!bin) q = b.clone().lerp(a, (near - b.z) / (a.z - b.z));
    return [this.screen(p), this.screen(q)];
  }

  render(items, k, selectedId) {
    const svg = [], lab = [];
    for (const it of items) this.drawItem(it, k, it.id && it.id === selectedId, svg, lab);
    this.svg.innerHTML = svg.join('');
    this.labels.innerHTML = lab.join('');
  }

  drawItem(it, k, selected, svg, lab) {
    if (it.type === 'marker') { // Stelle, auf die das Höhenprofil gerade zeigt
      const v = this.view(it.points[0]);
      if (v.z < -this.camera.near * 1.01) {
        const [x, y] = this.screen(v);
        svg.push(`<circle class="marker" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`);
      }
      return;
    }
    const color = COLORS[it.type] || '#fff';
    const pts = it.points.slice();
    const hover = it.draft && it.hover ? it.hover : null;
    const all = hover ? [...pts, hover] : pts;
    if (!all.length) return;
    const V = all.map((p) => this.view(p));
    const cls = `m ${it.draft ? 'draft' : ''} ${selected ? 'sel' : ''}`;

    const line = (a, b, opt = {}) => {
      const s = this.clip(a, b);
      if (!s) return null;
      const [[x1, y1], [x2, y2]] = s;
      const d = `x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"`;
      svg.push(`<line class="${cls} halo" ${d}/>`);
      svg.push(`<line class="${cls}" ${d} stroke="${color}"${opt.dash ? ' stroke-dasharray="6 5"' : ''}/>`);
      return { mid: [(x1 + x2) / 2, (y1 + y2) / 2], px: Math.hypot(x2 - x1, y2 - y1) };
    };
    const label = (pos, text, kind = '') => {
      if (!pos) return;
      lab.push(`<div class="mlabel ${kind} ${it.draft ? 'draft' : ''}" style="left:${pos[0].toFixed(1)}px;top:${pos[1].toFixed(1)}px;--c:${color}">${text}</div>`);
    };

    if (it.type === 'dist' || it.type === 'calib') {
      for (let i = 1; i < V.length; i++) {
        const s = line(V[i - 1], V[i], { dash: it.draft && hover && i === V.length - 1 });
        const d = dist(all[i - 1], all[i]) * k;
        if (s) label(s.mid, fmtLen(d), 'main');
      }
    } else if (it.type === 'height' && V.length >= 2) {
      const a = all[0], b = all[1];
      const hpt = [b[0], a[1], b[2]]; // lotrecht unter/über B auf Höhe von A
      const H = this.view(hpt);
      line(V[0], V[1], { dash: true });
      const sh = line(V[0], H);
      const sv = line(H, V[1]);
      const dh = (b[1] - a[1]) * k;
      const horiz = Math.hypot(b[0] - a[0], b[2] - a[2]) * k;
      if (sv) label(sv.mid, `${dh >= 0 ? '↑' : '↓'} ${fmtLen(Math.abs(dh))}`, 'main');
      if (sh && sh.px > 46) label(sh.mid, fmtLen(horiz), 'seg');
    } else if (it.type === 'area') {
      const n = V.length;
      const front = V.every((v) => v.z < -this.camera.near * 1.01);
      if (n >= 3 && front) {
        const poly = V.map((v) => this.screen(v).map((c) => c.toFixed(1)).join(',')).join(' ');
        svg.push(`<polygon class="${cls} fill" points="${poly}" fill="${color}"/>`);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (j === 0 && n < 3) break;
        const closing = j === 0 && it.draft;
        const s = line(V[i], V[j], { dash: closing || (it.draft && hover && j === n - 1) });
        if (s && s.px > 46 && !closing) label(s.mid, fmtLen(dist(all[i], all[j]) * k), 'seg');
      }
      if (n >= 3) {
        const e = evaluate({ type: 'area', points: all, closed: true }, k);
        if (front) {
          const c = V.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / n);
          label(this.screen(c), e.primary, 'main');
        }
      }
    }

    // Punkte zuletzt, damit sie über den Linien liegen
    V.forEach((v, i) => {
      if (v.z >= -this.camera.near * 1.01) return;
      const [x, y] = this.screen(v);
      const isHover = hover && i === V.length - 1;
      svg.push(`<circle class="${cls} dot ${isHover ? 'hover' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isHover ? 4 : 5}" fill="${color}"/>`);
    });
  }
}
