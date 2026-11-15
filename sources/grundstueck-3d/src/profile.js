import * as THREE from 'three';
import { fmtLen } from './measure.js';

// Höhenprofil entlang einer gemessenen Strecke: Zwischen den beiden Endpunkten
// werden lotrechte Strahlen von oben auf das Modell geschickt; die getroffenen
// Höhen ergeben das Profil der sichtbaren Oberfläche (unter Bäumen oder
// Überhängen also deren Oberkante, nicht der Boden darunter).

const W = 440, H = 150, PL = 50, PR = 10, PT = 10, PB = 22;
const SAMPLES = 120;
const PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (m) => (Math.abs(m) < 0.0005 ? '±0' : `${m < 0 ? '−' : '+'}${fmtLen(Math.abs(m))}`);

export class HeightProfile {
  constructor({ picker, card, svg, info, title, onMarker }) {
    Object.assign(this, { picker, card, svg, info, title, onMarker });
    this.key = null;     // Messung, für die das Profil gilt
    this.data = null;    // { a, b, ys: (number|null)[] } in Weltkoordinaten
    this.k = 1;
    this.token = 0;
    this.summary = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const move = (e) => this.hover(e);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { this.onMarker(null); if (this.data) this.info.textContent = this.summary; this.setCursor(null); });
  }

  hide() {
    this.token++;
    this.key = null;
    this.data = null;
    this.scale = null;
    this.summary = '';
    this.card.hidden = true;
    this.onMarker(null);
  }

  async show(item, k) {
    const key = `${item.id}|${item.points.flat().join(',')}`;
    this.k = k;
    this.title.textContent = `Höhenprofil · ${item.name}`;
    this.card.hidden = false;
    if (key === this.key) { if (this.data) this.draw(); return; }
    this.key = key;
    this.data = null;
    this.scale = null;
    this.summary = '';
    const token = ++this.token;
    const [a, b] = item.points;
    const top = Math.max(a[1], b[1]) + 40;
    const down = new THREE.Vector3(0, -1, 0);
    const ys = [];
    this.svg.innerHTML = '';
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const origin = new THREE.Vector3(a[0] + (b[0] - a[0]) * t, top, a[2] + (b[2] - a[2]) * t);
      const hit = await this.picker.pick([new THREE.Ray(origin, down)]);
      if (token !== this.token) return; // inzwischen andere Messung gewählt
      ys.push(hit ? hit.point.y : null);
      if (i % 12 === 0) this.info.textContent = `Profil wird berechnet … ${Math.round(t * 100)} %`;
    }
    // einzelne Ausreißer glätten (Median über drei Nachbarn)
    // (nur wo beide Nachbarn vorhanden sind: an Enden und Lücken bleibt der Messwert stehen)
    const sm = ys.map((y, i) => (y == null || ys[i - 1] == null || ys[i + 1] == null
      ? y : [ys[i - 1], y, ys[i + 1]].sort((p, q) => p - q)[1]));
    this.data = { a, b, ys: sm };
    this.draw();
  }

  draw() {
    const { a, b, ys } = this.data;
    const k = this.k;
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]) * k;
    if (!ys.some((y) => y != null) || !(L > 0)) {
      this.svg.innerHTML = '';
      this.scale = null;
      this.summary = 'Entlang dieser Strecke ist keine Oberfläche erkennbar.';
      this.info.textContent = this.summary;
      return;
    }
    // Nullpunkt ist der angeklickte Startpunkt (wie beim Werkzeug „Höhe“), nicht die erste Profilprobe
    const ref = a[1];
    const hs = ys.map((y) => (y == null ? null : (y - ref) * k));
    const valid = hs.filter((h) => h != null);
    let lo = Math.min(...valid), hi = Math.max(...valid);
    const span = Math.max(0.2, hi - lo);
    const mid = (hi + lo) / 2;
    const y0 = mid - span * 0.56, y1 = mid + span * 0.56;
    const pw = W - PL - PR, ph = H - PT - PB;
    const X = (i) => PL + (i / (hs.length - 1)) * pw;
    const Y = (h) => PT + (1 - (h - y0) / (y1 - y0)) * ph;
    this.scale = { hs, L, X, Y, pw };

    let line = '', area = '', run = [];
    const flush = () => {
      if (!run.length) return;
      const pts = run.map(([i, h]) => `${X(i).toFixed(1)},${Y(h).toFixed(1)}`);
      line += `M${pts.join('L')}`;
      area += `M${X(run[0][0]).toFixed(1)},${PT + ph}L${pts.join('L')}L${X(run[run.length - 1][0]).toFixed(1)},${PT + ph}Z`;
      run = [];
    };
    hs.forEach((h, i) => { if (h == null) flush(); else run.push([i, h]); });
    flush();

    const grid = [];
    const label = (h, text) => {
      const y = Y(h);
      grid.push(`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" class="grid"/>`
        + `<text x="${PL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${text}</text>`);
    };
    label(hi, signed(hi));
    if (Y(lo) - Y(hi) >= 12) label(lo, signed(lo));
    if (0 > lo + span * 0.18 && 0 < hi - span * 0.18) label(0, '±0');
    this.svg.innerHTML = `${grid.join('')}
      <path d="${area}" class="area"/><path d="${line}" class="line"/>
      <line x1="${PL}" y1="${PT + ph}" x2="${W - PR}" y2="${PT + ph}" class="axis"/>
      <text x="${PL}" y="${H - 6}">0</text>
      <text x="${W - PR}" y="${H - 6}" text-anchor="end">${fmtLen(L)}</text>
      <text x="${PL + pw / 2}" y="${H - 6}" text-anchor="middle" class="dim">Strecke (horizontal)</text>
      <g id="profile-cursor" visibility="hidden"><line y1="${PT}" y2="${PT + ph}" class="cursor"/><circle r="4" class="cursor-dot"/></g>`;

    const dh = (b[1] - a[1]) * k; // zwischen den beiden angeklickten Punkten
    const exagg = (ph / (y1 - y0)) / (pw / L);
    this.summary = `Länge (horizontal) ${fmtLen(L)} · Höhenunterschied ${signed(dh)} · Ø ${dh < -0.0005 ? '−' : '+'}${PCT.format(Math.abs(dh / L) * 100)} %`
      + ` · höchster Punkt ${signed(hi)}, tiefster ${signed(lo)}`
      + (exagg > 1.5 ? ` · Höhen ${PCT.format(exagg)}-fach überhöht` : '');
    this.info.textContent = this.summary;
  }

  setCursor(pos) {
    const g = this.svg.querySelector('#profile-cursor');
    if (!g) return;
    if (!pos) { g.setAttribute('visibility', 'hidden'); return; }
    g.setAttribute('visibility', 'visible');
    g.firstElementChild.setAttribute('x1', pos[0]); g.firstElementChild.setAttribute('x2', pos[0]);
    g.lastElementChild.setAttribute('cx', pos[0]); g.lastElementChild.setAttribute('cy', pos[1]);
  }

  // Stelle unter dem Zeiger: Marke im 3D-Bild und Zahlenwerte anzeigen
  hover(e) {
    if (!this.data || !this.scale) return;
    const r = this.svg.getBoundingClientRect();
    if (!r.width) return;
    const { hs, L, X, Y, pw } = this.scale;
    const t = Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width * W - PL) / pw));
    let i = Math.round(t * (hs.length - 1));
    for (let d = 0; d < hs.length && hs[i] == null; d++) {
      if (hs[i + d] != null) { i += d; break; }
      if (hs[i - d] != null) { i -= d; break; }
    }
    if (hs[i] == null) return;
    const { a, b, ys } = this.data;
    const u = i / (hs.length - 1);
    this.onMarker([a[0] + (b[0] - a[0]) * u, ys[i], a[2] + (b[2] - a[2]) * u]);
    this.setCursor([X(i).toFixed(1), Y(hs[i]).toFixed(1)]);
    this.info.textContent = `bei ${fmtLen(u * L)}: Höhe ${signed(hs[i])} gegenüber dem Startpunkt`;
  }
}
