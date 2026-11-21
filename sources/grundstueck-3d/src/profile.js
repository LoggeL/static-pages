import { fmtLen } from './measure.js';

// Höhenprofil entlang einer gemessenen Strecke. Die Höhen liefert der `sampler` der aktiven
// Ansicht:
//   2D: Bodenraster (gemessen q2, geschätzt q1 – gestrichelt, keine Höhe q0 – Lücke)
//   3D: lotrechte Strahlen von oben auf das Modell (sichtbare Oberfläche, unter Bäumen deren Krone)
// sampler = { kind, title, sampleMany(points[[x,z]]) → Promise<({y, q} | null)[]> }

const W = 440, H = 150, PL = 60, // PL: Platz für „−100,0 cm“ links der Achse
  PR = 10, PT = 10, PB = 22;
const SAMPLES = 120;
const PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (m) => (Math.abs(m) < 0.0005 ? '±0' : `${m < 0 ? '−' : '+'}${fmtLen(Math.abs(m))}`);

export class HeightProfile {
  constructor({ card, svg, info, title, onMarker, onError }) {
    Object.assign(this, { card, svg, info, title, onMarker, onError });
    this.key = null;     // Messung + Sampler, für die das Profil gilt
    this.data = null;    // { a, b, ys: (number|null)[], qs: number[] } in Weltkoordinaten
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

  async show(item, k, sampler) {
    const key = `${sampler.kind}|${item.id}|${item.points.flat().join(',')}`;
    this.k = k;
    this.title.textContent = `${sampler.title} · ${item.name}`;
    this.card.hidden = false;
    if (key === this.key) { if (this.data) this.draw(); return; }
    this.key = key;
    this.data = null;
    this.scale = null;
    this.summary = '';
    const token = ++this.token;
    const [a, b] = item.points;
    const pts = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      pts.push([a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    this.svg.innerHTML = '';
    this.info.textContent = 'Profil wird berechnet …';
    let res;
    try {
      res = await sampler.sampleMany(pts, Math.max(a[1], b[1]) + 40); // 3D: Strahlen von 40 m über der Strecke
    } catch (err) {
      if (token !== this.token) return;
      console.error(err);
      this.summary = `Höhenprofil nicht möglich: ${err.message}`;
      this.info.textContent = this.summary;
      this.onError?.(err);
      return;
    }
    if (token !== this.token) return; // inzwischen andere Messung gewählt
    const ys = res.map((r) => (r ? r.y : null));
    const qs = res.map((r) => (r ? r.q : 0));
    // einzelne Ausreißer glätten (Median über drei Nachbarn, nur bei gemessenen Werten;
    // an Enden, Lücken und geschätzten Stellen bleibt der Wert stehen)
    const sm = ys.map((y, i) => (y == null || ys[i - 1] == null || ys[i + 1] == null || qs[i] !== 2
      ? y : [ys[i - 1], y, ys[i + 1]].sort((p, q) => p - q)[1]));
    this.data = { a, b, ys: sm, qs };
    this.draw();
  }

  draw() {
    const { a, b, ys, qs } = this.data;
    const k = this.k;
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]) * k;
    if (!ys.some((y) => y != null) || !(L > 0)) {
      this.svg.innerHTML = '';
      this.scale = null;
      this.summary = 'Entlang dieser Strecke gibt es keine Höhenwerte.';
      this.info.textContent = this.summary;
      return;
    }
    // Nullpunkt ist der angeklickte Startpunkt (wie beim Werkzeug „Höhe“), nicht die erste Profilprobe
    const ref = a[1];
    const hs = ys.map((y) => (y == null ? null : (y - ref) * k));
    const valid = hs.filter((h) => h != null);
    const lo = Math.min(...valid), hi = Math.max(...valid);
    const span = Math.max(0.2, hi - lo);
    const mid = (hi + lo) / 2;
    const y0 = mid - span * 0.56, y1 = mid + span * 0.56;
    const pw = W - PL - PR, ph = H - PT - PB;
    const X = (i) => PL + (i / (hs.length - 1)) * pw;
    const Y = (h) => PT + (1 - (h - y0) / (y1 - y0)) * ph;
    this.scale = { hs, L, X, Y, pw };

    // Linie: Abschnitt zwischen zwei Proben ist gestrichelt, sobald eine davon nur geschätzt ist
    let solid = '', dashed = '', area = '', run = [];
    const flush = () => {
      if (!run.length) return;
      const pts = run.map((i) => `${X(i).toFixed(1)},${Y(hs[i]).toFixed(1)}`);
      area += `M${X(run[0]).toFixed(1)},${PT + ph}L${pts.join('L')}L${X(run[run.length - 1]).toFixed(1)},${PT + ph}Z`;
      if (run.length === 1) solid += `M${pts[0]}h0.1`;
      for (let j = 1; j < run.length; j++) {
        const seg = `M${pts[j - 1]}L${pts[j]}`;
        if (qs[run[j - 1]] === 2 && qs[run[j]] === 2) solid += seg; else dashed += seg;
      }
      run = [];
    };
    hs.forEach((h, i) => { if (h == null) flush(); else run.push(i); });
    flush();
    const hasEst = qs.some((q) => q === 1);

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
      <path d="${area}" class="area"/><path d="${solid}" class="line"/><path d="${dashed}" class="line est"/>
      <line x1="${PL}" y1="${PT + ph}" x2="${W - PR}" y2="${PT + ph}" class="axis"/>
      <text x="${PL}" y="${H - 6}">0</text>
      <text x="${W - PR}" y="${H - 6}" text-anchor="end">${fmtLen(L)}</text>
      <text x="${PL + pw / 2}" y="${H - 6}" text-anchor="middle" class="dim">Strecke (horizontal)</text>
      ${hasEst ? `<g class="legend"><line x1="${W - PR - 70}" y1="${PT + 4}" x2="${W - PR - 52}" y2="${PT + 4}" class="line est"/><text x="${W - PR - 48}" y="${PT + 7.5}">geschätzt</text></g>` : ''}
      <g id="profile-cursor" visibility="hidden"><line y1="${PT}" y2="${PT + ph}" class="cursor"/><circle r="4" class="cursor-dot"/></g>`;

    const dh = (b[1] - a[1]) * k; // zwischen den beiden angeklickten Punkten
    const exagg = (ph / (y1 - y0)) / (pw / L);
    const gaps = qs.filter((q) => q === 0).length;
    this.summary = `Länge (horizontal) ${fmtLen(L)} · Höhenunterschied ${signed(dh)} · Ø ${dh < -0.0005 ? '−' : '+'}${PCT.format(Math.abs(dh / L) * 100)} %`
      + ` · höchster Punkt ${signed(hi)}, tiefster ${signed(lo)}`
      + (exagg > 1.5 ? ` · Höhen ${PCT.format(exagg)}-fach überhöht` : '')
      + (gaps ? ` · ${gaps} von ${qs.length} Stellen ohne Höhe` : '');
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

  // Stelle unter dem Zeiger: Marke in Karte bzw. 3D-Bild und Zahlenwerte anzeigen
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
    const { a, b, ys, qs } = this.data;
    const u = i / (hs.length - 1);
    this.onMarker([a[0] + (b[0] - a[0]) * u, ys[i], a[2] + (b[2] - a[2]) * u]);
    this.setCursor([X(i).toFixed(1), Y(hs[i]).toFixed(1)]);
    this.info.textContent = `bei ${fmtLen(u * L)}: Höhe ${signed(hs[i])} gegenüber dem Startpunkt${qs[i] === 1 ? ' (geschätzt)' : ''}`;
  }
}
