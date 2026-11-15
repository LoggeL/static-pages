import * as THREE from 'three';
import { evaluate, fmtLen, dist } from './measure.js';

// Zeichnet Messpunkte, Linien und Maßzahlen als SVG/HTML über das 3D-Bild.
// Die Elemente liegen immer oben (keine Verdeckung durch den Splat) und
// bleiben so bei jeder Zoomstufe gestochen scharf.

const NF2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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

  // Hilfen für Plan-Überlagerungen (Grenzen, Kanal)
  polyPath(pts, closed) {
    const V = pts.map((p) => this.view(p));
    let d = '';
    const n = closed ? V.length : V.length - 1;
    for (let i = 0; i < n; i++) {
      const s = this.clip(V[i], V[(i + 1) % V.length]);
      if (s) d += `M${s[0][0].toFixed(1)},${s[0][1].toFixed(1)}L${s[1][0].toFixed(1)},${s[1][1].toFixed(1)}`;
    }
    return d;
  }
  // Bildschirmposition eines Punkts samt Entfernung zur Kamera (null, wenn nicht sichtbar)
  spot(p) {
    const v = this.view(p);
    if (v.z >= -this.camera.near * 1.01) return null;
    const s = this.screen(v);
    if (s[0] < -80 || s[0] > this.w + 80 || s[1] < -30 || s[1] > this.h + 30) return null;
    return { x: s[0], y: s[1], dist: v.length() };
  }
  tag(lab, p, text, cls, color, maxDist = Infinity) {
    const s = this.spot(p);
    if (s && s.dist <= maxDist) {
      lab.push(`<div class="mlabel ${cls}" style="left:${s.x.toFixed(1)}px;top:${s.y.toFixed(1)}px;--c:${color}">${text}</div>`);
    }
  }

  // Flurstücksgrenzen: eigenes Grundstück kräftig mit Seitenlängen und Fläche,
  // angrenzende Flurstücke dünn mit ihrer Nummer
  drawBoundary(b, svg, lab) {
    const secondary = b.style === 'secondary';
    const cls = secondary ? 'boundary secondary' : 'boundary';
    let d = '';
    if (b.points) d += this.polyPath(b.points, true);
    for (const line of b.lines || []) d += this.polyPath(line, false);
    if (d) svg.push(`${secondary ? '' : `<path class="boundary halo" d="${d}"/>`}<path class="${cls}" d="${d}"/>`);
    for (const c of b.corners || []) {
      const s = this.spot(c);
      if (s) svg.push(`<circle class="corner" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="4"/>`);
    }
    for (const sd of b.sides || []) this.tag(lab, sd.at, `${NF2.format(sd.length)} m`, 'bound', '#ff8fa0', 70);
    for (const l of b.labels || []) this.tag(lab, l.at, l.text, 'bound nb', '#d9c3c7', 90);
    if (b.center) this.tag(lab, b.center, `${b.name}${b.area_m2 ? ` · ${NF0.format(b.area_m2)} m²` : ''}`, 'bound name', '#ff8fa0');
  }

  // Kanal: Haltungen, Anschlussleitungen, Schächte und der Schutzstreifen beidseits der Achse
  drawSewer(sw, svg, lab) {
    const w = sw.corridor || 0;
    const near = -this.camera.near * 1.01;
    let axis = '', edge = '', conn = '';
    for (const p of sw.pipes || []) {
      const pts = p.points;
      axis += this.polyPath(pts, false);
      if (w > 0 && pts.length > 1) {
        const L = [], R = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          let nx = -(b[2] - a[2]), nz = b[0] - a[0];
          const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
          L.push([pts[i][0] + nx * w, pts[i][1], pts[i][2] + nz * w]);
          R.push([pts[i][0] - nx * w, pts[i][1], pts[i][2] - nz * w]);
        }
        const VL = L.map((q) => this.view(q)), VR = R.map((q) => this.view(q));
        for (let i = 0; i < pts.length - 1; i++) {
          const quad = [VL[i], VL[i + 1], VR[i + 1], VR[i]];
          if (quad.every((v) => v.z < near)) {
            svg.push(`<polygon class="corridor" points="${quad.map((v) => this.screen(v).map((c) => c.toFixed(1)).join(',')).join(' ')}"/>`);
          }
        }
        edge += this.polyPath(L, false) + this.polyPath(R, false);
      }
      const mid = pts[Math.floor(pts.length / 2)];
      this.tag(lab, mid, `${p.dn} · ${NF2.format(p.length)} m · ${NF1.format(p.slope_permille)} ‰`, 'bound sewer', '#7fd8ff', 60);
    }
    for (const c of sw.connections || []) conn += this.polyPath(c, false);
    if (edge) svg.push(`<path class="corridor-edge" d="${edge}"/>`);
    if (conn) svg.push(`<path class="sewer conn" d="${conn}"/>`);
    if (axis) svg.push(`<path class="sewer halo" d="${axis}"/><path class="sewer" d="${axis}"/>`);
    for (const m of sw.manholes || []) {
      const s = this.spot(m.at);
      if (!s) continue;
      svg.push(`<circle class="manhole" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="6"/>`);
      const depth = m.depth != null ? ` · ${NF2.format(m.depth)} m tief` : '';
      const text = s.dist < 45 ? `Schacht ${m.name}${depth}${m.note ? ` · ${m.note}` : ''}` : m.name;
      lab.push(`<div class="mlabel bound sewer above" style="left:${s.x.toFixed(1)}px;top:${s.y.toFixed(1)}px;--c:#7fd8ff">${text}</div>`);
    }
  }

  drawItem(it, k, selected, svg, lab) {
    if (it.type === 'boundary') { this.drawBoundary(it, svg, lab); return; }
    if (it.type === 'sewer') { this.drawSewer(it, svg, lab); return; }
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
