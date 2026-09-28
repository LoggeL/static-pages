// Illustrations: the zoom panel scenes, the synapse animation, epilogue art, week view and recap charts.

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const de = (v, d = 0) => v.toFixed(d).replace(".", ",");
export const END = 360;
export const clock = (t) => {
  const m = (30 + Math.floor(t)) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/* ---------------------------------------------------------------- zoom: through the nose */
export function journeySVG() {
  return `
<svg viewBox="0 0 320 190" id="journey">
  <defs>
    <linearGradient id="jPath" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffc94a"/></linearGradient>
    <filter id="jGlow"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <path id="jRoute" d="M34 60 C 70 60, 80 120, 118 120 S 170 70, 206 110 S 250 150, 286 60" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="10" stroke-linecap="round"/>
  <path id="jDone" d="M34 60 C 70 60, 80 120, 118 120 S 170 70, 206 110 S 250 150, 286 60" fill="none" stroke="url(#jPath)" stroke-width="4" stroke-linecap="round" stroke-dasharray="0 999"/>
  <g transform="translate(34 60)" class="jst" data-k="0">
    <circle r="22" fill="#12161e" stroke="rgba(255,255,255,.25)"/>
    <path d="M-2 -13 C-4 -4 -9 3 -9 7 A4 4 0 0 0 -5 11 H5 A4 4 0 0 0 9 7 C9 3 4 -4 2 -13Z" fill="none" stroke="#dff4ff" stroke-width="2.2"/>
    <circle id="jNumb" r="17" fill="none" stroke="#bfe9ff" stroke-width="1.5" stroke-dasharray="2 3" opacity="0"/>
  </g>
  <g transform="translate(118 120)" class="jst" data-k="1">
    <circle r="24" fill="#12161e" stroke="rgba(255,255,255,.25)"/>
    <path d="M-14 -4 Q-7 -12 0 -4 T14 -4 M-14 6 Q-7 -2 0 6 T14 6" fill="none" stroke="#ff8aa0" stroke-width="2.2" stroke-linecap="round"/>
    <g id="jPowder" fill="#fff"><circle cx="-6" cy="-10" r="1.8"/><circle cx="4" cy="-12" r="1.5"/><circle cx="9" cy="-9" r="1.4"/><circle cx="-1" cy="-15" r="1.2"/></g>
  </g>
  <g transform="translate(206 110)" class="jst" data-k="2">
    <circle r="22" fill="#12161e" stroke="rgba(255,255,255,.25)"/>
    <path d="M0 11s-11-6.5-11-13.5C-11-7 -7-9.5-4-9.5-2-9.5-1-8.5 0-7c1-1.5 2-2.5 4-2.5 3 0 7 2.5 7 7C11 4.5 0 11 0 11z" fill="#ff3b4a"/>
  </g>
  <g transform="translate(286 60)" class="jst" data-k="3">
    <circle r="26" fill="#12161e" stroke="rgba(255,255,255,.25)"/>
    <path d="M-14 4 C-18 -6 -10 -16 0 -14 C8 -18 18 -10 15 0 C18 8 10 14 2 12 C-4 16 -12 12 -14 4Z" fill="none" stroke="#ffc94a" stroke-width="2.5"/>
    <path d="M-6 -8 C-2 -4 -8 0 -2 4 M6 -8 C2 -2 8 2 4 8" fill="none" stroke="#ffc94a" stroke-width="1.5"/>
  </g>
  <circle id="jDot" r="6" fill="#fff" filter="url(#jGlow)"/>
  <circle id="jDot2" r="3.5" fill="#fff"/>
  <g class="art-label" text-anchor="middle">
    <text x="34" y="98">Nase</text><text x="118" y="160">Schleimhaut</text><text x="206" y="148">Herz</text><text x="286" y="102">Gehirn</text>
  </g>
  <text id="jTime" x="12" y="176" class="art-label big">T+0:00</text>
  <text id="jNote" x="80" y="176" class="art-label">gezogen</text>
</svg>`;
}

export function updateJourney(root, t) {
  const route = root.querySelector("#jRoute");
  if (!route) return;
  const len = route.getTotalLength();
  const k = clamp(t / 3);
  const pt = route.getPointAtLength(len * k);
  for (const id of ["#jDot", "#jDot2"]) {
    root.querySelector(id).setAttribute("cx", pt.x);
    root.querySelector(id).setAttribute("cy", pt.y);
  }
  root.querySelector("#jDone").setAttribute("stroke-dasharray", `${len * k} 999`);
  root.querySelector("#jPowder").setAttribute("opacity", 1 - clamp(t / 1.5));
  root.querySelector("#jNumb").setAttribute("opacity", clamp(t / 1.2));
  const sec = Math.floor(t * 60);
  root.querySelector("#jTime").textContent = `T+${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const notes = ["gezogen", "löst sich auf der Schleimhaut", "über die Venen zum Herzen", "über die Arterien ins Gehirn", "angekommen. Nase taub."];
  root.querySelector("#jNote").textContent = notes[Math.min(4, Math.floor(k * 4 + (k >= 1 ? 1 : 0)))];
  root.querySelectorAll(".jst").forEach((g) => {
    g.style.opacity = k * 3 >= +g.dataset.k - 0.02 ? 1 : 0.4;
  });
}

/* ---------------------------------------------------------------- synapse (canvas) */
function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

export class Synapse {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.mols = [];
    this.coke = [];
    this.recGlow = [0, 0, 0, 0, 0];
    this.W = canvas.width = 640;
    this.H = canvas.height = 420;
  }

  // block: 0..1 share of transporters plugged, release: firing rate, low: crash (store/receptors down)
  draw(dt, time, { block, release, low }) {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // presynaptic terminal
    const g = ctx.createLinearGradient(0, 0, 0, 200);
    g.addColorStop(0, "#1c2330");
    g.addColorStop(1, "#121822");
    ctx.fillStyle = g;
    ctx.strokeStyle = "#8fb8d8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(250, 0);
    ctx.bezierCurveTo(250, 40, 90, 50, 90, 130);
    ctx.bezierCurveTo(90, 190, 170, 195, 320, 195);
    ctx.bezierCurveTo(470, 195, 550, 190, 550, 130);
    ctx.bezierCurveTo(550, 50, 390, 40, 390, 0);
    ctx.fill();
    ctx.stroke();

    // postsynaptic membrane
    ctx.fillStyle = "#1a1612";
    ctx.strokeStyle = "#ffc94a";
    ctx.beginPath();
    ctx.moveTo(60, H);
    ctx.bezierCurveTo(60, 300, 120, 290, 320, 290);
    ctx.bezierCurveTo(520, 290, 580, 300, 580, H);
    ctx.fill();
    ctx.stroke();

    // receptors
    const recX = [150, 235, 320, 405, 490];
    const recBase = low ? 0.08 : 0.25;
    recX.forEach((x, i) => {
      this.recGlow[i] = Math.max(0, this.recGlow[i] - dt * (block > 0.2 ? 0.8 : 1.8));
      const glow = this.recGlow[i];
      ctx.fillStyle = `rgba(255,201,74,${recBase + glow * 0.75})`;
      ctx.beginPath();
      ctx.moveTo(x - 14, 290); ctx.lineTo(x - 14, 272); ctx.lineTo(x - 7, 272); ctx.lineTo(x - 7, 283);
      ctx.lineTo(x + 7, 283); ctx.lineTo(x + 7, 272); ctx.lineTo(x + 14, 272); ctx.lineTo(x + 14, 290);
      ctx.fill();
      if (glow > 0.05) {
        ctx.fillStyle = `rgba(255,201,74,${glow * 0.3})`;
        ctx.beginPath();
        ctx.arc(x, 300, 26 * glow + 8, 0, TAU);
        ctx.fill();
      }
    });

    // vesicles
    const ves = [[170, 110], [240, 80], [320, 120], [400, 82], [470, 112], [260, 150], [380, 155]];
    const store = low ? 0.35 : 1;
    ves.forEach(([vx, vy], i) => {
      ctx.strokeStyle = "rgba(191,233,255,.6)";
      ctx.fillStyle = "rgba(191,233,255,.06)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(vx, vy, 22, 0, TAU);
      ctx.fill();
      ctx.stroke();
      const n = Math.round(9 * store);
      for (let k = 0; k < n; k++) {
        const a = k * 2.4 + i + time * 0.5;
        const r = 5 + (k % 3) * 5;
        ctx.fillStyle = "#ffc94a";
        ctx.beginPath();
        ctx.arc(vx + Math.cos(a) * r, vy + Math.sin(a) * r, 3, 0, TAU);
        ctx.fill();
      }
    });

    // dopamine transporters on the membrane, some plugged by cocaine
    const dat = [[140, 184], [230, 194], [410, 194], [500, 184]];
    const plugged = Math.round(clamp(block) * dat.length);
    dat.forEach(([sx, sy], k) => {
      const isBlocked = [1, 2, 0, 3][k] < plugged; // plug the inner ones first
      ctx.fillStyle = isBlocked ? "#3a2226" : "#2c4a66";
      ctx.strokeStyle = isBlocked ? "#ff3b4a" : "#8fb8d8";
      ctx.lineWidth = 2;
      ctx.fillRect(sx - 13, sy - 13, 26, 26);
      ctx.strokeRect(sx - 13, sy - 13, 26, 26);
      if (isBlocked) {
        ctx.fillStyle = "#f4fbff";
        ctx.shadowColor = "#fff";
        ctx.shadowBlur = 8;
        hexPath(ctx, sx, sy, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        // arrow: sucking dopamine back in
        const off = ((time * 30) % 12) - 6;
        ctx.strokeStyle = "#dff4ff";
        ctx.beginPath();
        ctx.moveTo(sx, sy + 8 - off * 0.3); ctx.lineTo(sx, sy - 8 - off * 0.3);
        ctx.moveTo(sx - 5, sy - 3 - off * 0.3); ctx.lineTo(sx, sy - 8 - off * 0.3); ctx.lineTo(sx + 5, sy - 3 - off * 0.3);
        ctx.stroke();
      }
      dat[k].blocked = isBlocked;
    });

    // spawn dopamine from vesicles
    const rate = (low ? 0.8 : 2.2 + release * 5) * store;
    if (Math.random() < rate * dt) {
      const from = ves[Math.floor(Math.random() * ves.length)];
      this.mols.push({ x: from[0] + (Math.random() - 0.5) * 20, y: 200, vx: (Math.random() - 0.5) * 60, vy: 30 + Math.random() * 50, back: false, life: 9 });
    }
    // cocaine drifting towards free transporters
    if (block > 0.05 && Math.random() < dt * 1.5 * block) {
      const s = dat.filter((d) => d.blocked);
      if (s.length) {
        const d = s[Math.floor(Math.random() * s.length)];
        this.coke.push({ x: d[0] + (Math.random() - 0.5) * 160, y: 250 + Math.random() * 10, tx: d[0], ty: d[1], life: 1.8 });
      }
    }

    // molecules in the cleft
    for (let i = this.mols.length - 1; i >= 0; i--) {
      const m = this.mols[i];
      m.life -= dt;
      m.vx += (Math.random() - 0.5) * 160 * dt;
      if (!m.back) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.x < 90 || m.x > 550) m.vx = -m.vx;
        if (m.y > 268) {
          const r = recX.reduce((best, x, k) => (Math.abs(x - m.x) < Math.abs(recX[best] - m.x) ? k : best), 0);
          this.recGlow[r] = Math.min(1, this.recGlow[r] + (low ? 0.15 : 0.35));
          m.vy = -Math.abs(m.vy) * 0.8;
          m.y = 266;
          m.hits = (m.hits || 0) + 1;
        }
        if (m.y < 204) {
          m.vy = Math.abs(m.vy);
          // a free transporter nearby grabs it
          const free = dat.filter((d) => !d.blocked).sort((a, b) => Math.abs(a[0] - m.x) - Math.abs(b[0] - m.x))[0];
          if (free && (m.hits || 0) >= 1 && Math.abs(free[0] - m.x) < (low ? 260 : 120)) m.back = free;
        }
      } else {
        m.x += (m.back[0] - m.x) * dt * 3;
        m.y += (m.back[1] - m.y) * dt * 3;
        if (Math.hypot(m.back[0] - m.x, m.back[1] - m.y) < 8) m.life = 0;
      }
      if (m.life <= 0 || this.mols.length > 90) { this.mols.splice(i, 1); continue; }
      ctx.fillStyle = "#ffc94a";
      ctx.shadowColor = "#ffc94a";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 4, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    for (let i = this.coke.length - 1; i >= 0; i--) {
      const m = this.coke[i];
      m.life -= dt;
      m.x += (m.tx - m.x) * dt * 1.6;
      m.y += (m.ty - m.y) * dt * 1.6;
      if (m.life <= 0) { this.coke.splice(i, 1); continue; }
      ctx.fillStyle = "#f4fbff";
      hexPath(ctx, m.x, m.y, 5);
      ctx.fill();
    }

    ctx.font = "600 20px IBM Plex Mono, monospace";
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.fillText("Präsynapse", 20, 30);
    ctx.fillText("Rezeptoren", 20, 405);
    ctx.fillStyle = low ? "rgba(255,255,255,.6)" : block > 0.2 ? "#ff8a95" : "rgba(255,255,255,.6)";
    ctx.fillText(low ? "DAT räumt gründlich auf" : block > 0.2 ? "DAT ✕ blockiert" : "DAT holt zurück", 180, 244);
  }
}

/* ---------------------------------------------------------------- brain */
export function brainSVG() {
  const regions = [
    { id: "rPfc", x: 74, y: 76, c: "#bfe9ff", label: "Stirnhirn ↓", sub: "Selbstkritik aus", lx: 4, ly: 14 },
    { id: "rAcc", x: 122, y: 120, c: "#ffc94a", label: "Belohnung ↑", sub: "Ich bin großartig", lx: 4, ly: 190 },
    { id: "rAmyg", x: 170, y: 134, c: "#ff3b4a", label: "Amygdala", sub: "später: Paranoia", lx: 128, ly: 204 },
    { id: "rStem", x: 196, y: 162, c: "#ff7a5a", label: "Hirnstamm", sub: "Puls, Druck ↑", lx: 232, ly: 190 },
    { id: "rMotor", x: 178, y: 38, c: "#8fd0ff", label: "Motorik ↑", sub: "Unruhe", lx: 226, ly: 14 },
  ];
  return `
<svg viewBox="0 0 320 226" id="brain">
  <defs><filter id="bGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9"/></filter></defs>
  <path d="M46 118 C30 78 62 36 116 30 C150 12 206 16 236 40 C272 44 296 76 288 110 C298 138 272 158 244 152 C226 166 204 168 186 160 L190 196 C190 204 176 206 174 196 L168 160 C130 170 84 166 64 150 C48 146 40 132 46 118 Z"
        fill="#10131a" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
  <path d="M244 152 C252 170 238 184 216 178 C204 176 196 168 196 160" fill="#141821" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>
  <g fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2" stroke-linecap="round">
    <path d="M80 70 C96 60 104 80 120 66 C132 56 146 72 160 58"/>
    <path d="M70 100 C88 88 100 108 118 94 C136 82 150 104 170 88 C186 76 200 96 216 82"/>
    <path d="M176 44 C186 58 204 46 214 60 C224 72 240 60 252 72"/>
    <path d="M200 110 C214 98 228 116 244 104 C256 94 270 108 278 98"/>
    <path d="M90 136 C110 126 126 142 146 132"/>
    <path d="M140 36 C136 52 150 60 144 76"/>
  </g>
  ${regions.map((r) => `<circle id="${r.id}" cx="${r.x}" cy="${r.y}" r="18" fill="${r.c}" filter="url(#bGlow)" opacity=".2"/>
  <circle cx="${r.x}" cy="${r.y}" r="3.5" fill="${r.c}"/>
  <line x1="${r.x}" y1="${r.y}" x2="${r.lx + 4}" y2="${r.ly < 100 ? r.ly + 4 : r.ly - 12}" stroke="${r.c}" stroke-width="1" opacity=".6"/>
  <text x="${r.lx}" y="${r.ly}" class="art-label big" style="fill:${r.c}">${r.label}</text>
  <text x="${r.lx}" y="${r.ly + 12}" class="art-label">${r.sub}</text>`).join("")}
</svg>`;
}

export function updateBrain(root, time, S, beat) {
  const set = (id, v, i) => {
    const el = root.querySelector("#" + id);
    if (!el) return;
    el.setAttribute("opacity", clamp(v + 0.2 * beat * S.E * (i % 2 ? 1 : 0.6)));
    el.setAttribute("r", 12 + 12 * clamp(v) + 3 * Math.sin(time * 3 + i));
  };
  set("rPfc", 0.55 - 0.45 * S.E, 0);
  set("rAcc", 0.15 + 0.85 * S.E, 1);
  set("rAmyg", 0.1 + 0.9 * S.anx, 2);
  set("rStem", 0.1 + 0.6 * clamp(S.c), 3);
  set("rMotor", 0.1 + 0.7 * clamp(S.c), 4);
}

/* ---------------------------------------------------------------- the spiral: high per line */
export function spiralSVG() {
  return `
<svg viewBox="0 0 320 200" id="spiral">
  <g class="grid" stroke="rgba(255,255,255,.08)"><line x1="30" x2="312" y1="30" y2="30"/><line x1="30" x2="312" y1="90" y2="90"/><line x1="30" x2="312" y1="150" y2="150"/></g>
  <text x="26" y="34" text-anchor="end" class="art-label">100</text>
  <text x="26" y="154" text-anchor="end" class="art-label">0</text>
  <g id="spBars"></g>
  <path id="spHr" fill="none" stroke="#ff3b4a" stroke-width="2" stroke-linejoin="round"/>
  <g id="spHrDots" fill="#ff3b4a"></g>
  <g class="art-label"><rect x="32" y="184" width="10" height="6" fill="#ffc94a"/><text x="46" y="190">Hoch pro Line</text>
  <line x1="150" x2="164" y1="187" y2="187" stroke="#ff3b4a" stroke-width="2"/><text x="168" y="190">Puls-Spitze</text></g>
</svg>`;
}

export function updateSpiral(root, lines) {
  const bars = root.querySelector("#spBars");
  if (!bars) return;
  const n = Math.max(4, lines.length);
  const slot = 280 / n;
  const w = Math.min(34, slot * 0.6);
  const y = (v) => 150 - clamp(v, 0, 1.1) * 120;
  const yh = (hr) => 150 - clamp((hr - 60) / 140) * 120;
  let html = "";
  let path = "";
  let dots = "";
  lines.forEach((l, i) => {
    const x = 32 + slot * i + (slot - w) / 2;
    const h = 150 - y(l.peak);
    html += `<rect x="${x.toFixed(1)}" y="${y(l.peak).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${l.amt > 1 ? "#ffe08a" : "#ffc94a"}" opacity="${i === lines.length - 1 ? 1 : 0.7}"/>`;
    html += `<text x="${(x + w / 2).toFixed(1)}" y="168" text-anchor="middle" class="art-label">${l.amt > 1 ? "L" + (i + 1) + "+" : "L" + (i + 1)}</text>`;
    html += `<text x="${(x + w / 2).toFixed(1)}" y="${(y(l.peak) - 4).toFixed(1)}" text-anchor="middle" class="art-label" style="fill:#ffe9b0">${Math.round(l.peak * 100)}</text>`;
    const cx = x + w / 2;
    path += `${i ? "L" : "M"}${cx.toFixed(1)} ${yh(l.hr).toFixed(1)} `;
    dots += `<circle cx="${cx.toFixed(1)}" cy="${yh(l.hr).toFixed(1)}" r="3"/>`;
  });
  bars.innerHTML = html;
  root.querySelector("#spHr").setAttribute("d", path);
  root.querySelector("#spHrDots").innerHTML = dots;
}

/* ---------------------------------------------------------------- choice art: the bag */
export function choiceArt({ grams, money, lines, hr, mode }) {
  const lvl = clamp(grams / 1);
  const top = 100 - lvl * 70;
  const last = lines.at(-1);
  const rows = mode === "buy"
    ? [["Beutel", "leer", "#ff8a95"], ["Ausgegeben", `${money} €`, "#ffc94a"], ["Nachschub", "1 g · 80 €", "#dff4ff"], ["Lieferzeit", "„20 min“", "#8c93a3"]]
    : [["Beutel", `${de(grams, 2)} g`, "#dff4ff"], ["Letztes Hoch", last ? `${Math.round(last.peak * 100)} %` : "–", "#ffc94a"], ["Puls jetzt", `${Math.round(hr)} bpm`, hr > 130 ? "#ff8a95" : "#dff4ff"], ["Ausgegeben", `${money} €`, "#8c93a3"]];
  return `<svg viewBox="0 0 440 120">
    <path d="M24 10 H84 V104 Q84 112 76 112 H32 Q24 112 24 104Z" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
    <rect x="24" y="10" width="60" height="9" fill="rgba(255,59,74,.6)"/>
    ${mode !== "buy" && lvl > 0.02 ? `<path d="M27 ${top + 6} Q54 ${top - 6} 81 ${top + 6} V104 Q81 109 76 109 H32 Q27 109 27 104Z" fill="#eef4fa"/>` : `<text x="54" y="72" text-anchor="middle" font-family="IBM Plex Mono" font-size="11" fill="#ff8a95">LEER</text>`}
    ${rows.map(([k, v, c], i) => `<text x="110" y="${30 + i * 24}" font-family="IBM Plex Mono" font-size="12" fill="#6d7285">${k}</text><text x="250" y="${30 + i * 24}" font-family="IBM Plex Mono" font-size="13" font-weight="700" fill="${c}">${v}</text>`).join("")}
  </svg>`;
}

/* ---------------------------------------------------------------- epilogue mini-art */
export function chemArt(kind) {
  const bg = `<rect width="200" height="150" fill="#07080c"/>`;
  const hex = (x, y, r, fill = "#f4fbff") => {
    let p = "";
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + Math.PI / 6; p += `${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)} `; }
    return `<polygon points="${p}" fill="${fill}"/>`;
  };
  if (kind === "block") {
    let dots = "";
    for (let i = 0; i < 40; i++) dots += `<circle cx="${28 + ((i * 53) % 144)}" cy="${82 + ((i * 29) % 36)}" r="3" fill="#ffc94a" opacity="${0.5 + (i % 5) / 10}"/>`;
    return `<svg viewBox="0 0 200 150">${bg}<path d="M20 0 C20 40 40 70 100 70 C160 70 180 40 180 0Z" fill="#161c26" stroke="#8fb8d8" stroke-width="2"/>
      <rect x="40" y="56" width="18" height="18" fill="#3a2226" stroke="#ff3b4a" stroke-width="1.5"/>${hex(49, 65, 5.5)}
      <rect x="142" y="56" width="18" height="18" fill="#3a2226" stroke="#ff3b4a" stroke-width="1.5"/>${hex(151, 65, 5.5)}
      <path d="M20 150 C20 128 40 124 100 124 C160 124 180 128 180 150Z" fill="#1a1612" stroke="#ffc94a" stroke-width="2"/>${dots}</svg>`;
  }
  if (kind === "reward") {
    const node = (x, y, label, c) => `<circle cx="${x}" cy="${y}" r="17" fill="#10131a" stroke="${c}" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9.5" fill="${c}">${label}</text>`;
    return `<svg viewBox="0 0 200 150">${bg}
      <defs><marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#8c93a3"/></marker></defs>
      <g fill="none" stroke="#8c93a3" stroke-width="1.5" marker-end="url(#arw)">
        <path d="M116 30 Q150 34 154 64"/><path d="M146 100 Q126 124 92 118"/><path d="M60 104 Q40 76 76 38"/>
      </g>
      ${node(100, 30, "LINE", "#f4fbff")}${node(158, 86, "KICK", "#ffc94a")}${node(70, 116, "CRASH", "#8fb8d8")}
      <text x="100" y="80" text-anchor="middle" font-family="IBM Plex Mono" font-size="10" fill="#ff8a95">LERNEN:</text>
      <text x="100" y="93" text-anchor="middle" font-family="IBM Plex Mono" font-size="10" fill="#ff8a95">MEHR</text></svg>`;
  }
  if (kind === "vessel") {
    return `<svg viewBox="0 0 200 150">${bg}
      <text x="50" y="22" text-anchor="middle" font-family="IBM Plex Mono" font-size="10" fill="#8c93a3">NÜCHTERN</text>
      <text x="150" y="22" text-anchor="middle" font-family="IBM Plex Mono" font-size="10" fill="#ff8a95">KOKAIN</text>
      <circle cx="50" cy="72" r="34" fill="#2a0d12" stroke="#ff6070" stroke-width="5"/><circle cx="50" cy="72" r="24" fill="#b3202f"/>
      <circle cx="150" cy="72" r="34" fill="#2a0d12" stroke="#ff6070" stroke-width="13"/><circle cx="150" cy="72" r="11" fill="#b3202f"/>
      <path d="M22 132 h20 l6 -12 l8 22 l6 -10 h20" fill="none" stroke="#8fb8d8" stroke-width="1.8"/>
      <path d="M118 132 h8 l4 -14 l5 24 l4 -10 h5 l4 -14 l5 24 l4 -10 h5 l4 -14 l5 24 l4 -10 h8" fill="none" stroke="#ff3b4a" stroke-width="1.8"/></svg>`;
  }
  // tolerance
  const hs = [96, 78, 64, 56, 50];
  let bars = "";
  hs.forEach((h, i) => (bars += `<rect x="${30 + i * 30}" y="${122 - h}" width="18" height="${h}" rx="2" fill="#ffc94a" opacity="${1 - i * 0.12}"/>`));
  return `<svg viewBox="0 0 200 150">${bg}${bars}
    <path d="M39 78 L69 70 L99 62 L129 55 L159 46" fill="none" stroke="#ff3b4a" stroke-width="2.5"/>
    <g fill="#ff3b4a"><circle cx="39" cy="78" r="3"/><circle cx="69" cy="70" r="3"/><circle cx="99" cy="62" r="3"/><circle cx="129" cy="55" r="3"/><circle cx="159" cy="46" r="3"/></g>
    <text x="100" y="140" text-anchor="middle" font-family="IBM Plex Mono" font-size="10" fill="#8c93a3">HOCH ↓ · HERZ ↑</text></svg>`;
}

/* ---------------------------------------------------------------- weather icons for the days after */
export function weather(kind) {
  const sun = (cx, cy, r, op = 1) => {
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      rays += `<line x1="${cx + Math.cos(a) * (r + 5)}" y1="${cy + Math.sin(a) * (r + 5)}" x2="${cx + Math.cos(a) * (r + 11)}" y2="${cy + Math.sin(a) * (r + 11)}"/>`;
    }
    return `<g opacity="${op}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc94a"/><g stroke="#ffc94a" stroke-width="3" stroke-linecap="round">${rays}</g></g>`;
  };
  const cloud = (x, y, s, c = "#8a90a6") =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M-24 10 H26 A12 12 0 0 0 22 -12 A18 18 0 0 0 -12 -14 A14 14 0 0 0 -24 10Z" fill="${c}"/>`;
  const rain = (x, y, n = 4) => {
    let s = "";
    for (let i = 0; i < n; i++) s += `<line x1="${x - 18 + i * 12}" y1="${y}" x2="${x - 22 + i * 12}" y2="${y + 12}"/>`;
    return `<g stroke="#6fa8ff" stroke-width="2.5" stroke-linecap="round">${s}</g>`;
  };
  const wrap = (inner) => `<svg class="wx" viewBox="0 0 100 64">${inner}</svg>`;
  switch (kind) {
    case "strobe": {
      let rays = "";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        rays += `<line x1="50" y1="32" x2="${50 + Math.cos(a) * 30}" y2="${32 + Math.sin(a) * 30}" stroke="${i % 3 ? "#dff4ff" : "#ffc94a"}" stroke-width="${i % 2 ? 1 : 2}"/>`;
      }
      return wrap(`${rays}<circle cx="50" cy="32" r="7" fill="#fff"/>`);
    }
    case "moon": return wrap(`<path d="M58 12 A20 20 0 1 0 64 50 A16 16 0 1 1 58 12Z" fill="#c9d3e3"/><g fill="#dff4ff"><circle cx="24" cy="16" r="1.5"/><circle cx="80" cy="22" r="1.2"/><circle cx="74" cy="48" r="1.4"/></g>`);
    case "cloud": return wrap(cloud(50, 34, 1.05));
    case "rain": return wrap(`${cloud(50, 26, 1.05, "#5d6378")}${rain(52, 42)}`);
    case "storm": return wrap(`${cloud(50, 24, 1.1, "#454a5c")}${rain(50, 40, 3)}<path d="M54 30 L44 46 H52 L46 62 L62 40 H54 L60 30Z" fill="#ffc94a"/>`);
    case "fog": return wrap(`<g stroke="#8a90a6" stroke-width="4" stroke-linecap="round"><line x1="16" y1="20" x2="84" y2="20"/><line x1="24" y1="32" x2="76" y2="32" opacity=".7"/><line x1="12" y1="44" x2="70" y2="44" opacity=".5"/></g>`);
    case "partly": return wrap(`${sun(36, 26, 11)}${cloud(58, 38, 0.95)}`);
    default: return wrap(sun(50, 32, 14));
  }
}

/* ---------------------------------------------------------------- recap charts (small multiples) */
export function lineChart(el, { title, unit, color, data, key, key2, color2, label, label2, min, max, fmt, band, events }) {
  const W = 520, H = 150, pl = 36, pr = 8, pt = 6, pb = 20;
  const x = (t) => pl + (t / END) * (W - pl - pr);
  const y = (v) => pt + (1 - (clamp(v, min, max) - min) / (max - min)) * (H - pt - pb);
  const mk = (k) => data.map((d, i) => (i ? "L" : "M") + x(d.t).toFixed(1) + " " + y(d[k]).toFixed(1)).join(" ");
  const ticks = [0, 90, 180, 270, 360];
  const ys = [min, (min + max) / 2, max];
  const peak = data.reduce((a, d) => (d[key] > a[key] ? d : a), data[0]);
  el.innerHTML = `
    <h4>${title}<small>max ${fmt(peak[key])}${unit}</small></h4>
    ${key2 ? `<div class="key"><span><i style="background:${color}"></i>${label}</span><span><i style="background:${color2}"></i>${label2}</span></div>` : ""}
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${title} über die Nacht">
      ${band ? `<rect class="band" x="${pl}" y="${y(band[1])}" width="${W - pl - pr}" height="${y(band[0]) - y(band[1])}" fill="${band[2]}"/>` : ""}
      <g class="grid">${ys.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>
      <g class="axis">
        ${ys.map((v) => `<text x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join("")}
        ${ticks.map((t) => `<text x="${x(t)}" y="${H - 4}" text-anchor="middle">${clock(t)}</text>`).join("")}
      </g>
      ${events.map((e) => `<line x1="${x(e.t)}" x2="${x(e.t)}" y1="${pt}" y2="${H - pb}" stroke="${e.c}" stroke-width="1" stroke-dasharray="2 3" opacity=".75"/>`).join("")}
      ${key2 ? `<path d="${mk(key2)}" fill="none" stroke="${color2}" stroke-width="2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>` : ""}
      <path d="${mk(key)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line class="xh" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="rgba(255,255,255,.4)" opacity="0" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="tip"></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = el.querySelector(".xh");
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = clamp(((px - pl) / (W - pl - pr)) * END, 0, END);
    const d = data.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    xh.setAttribute("x1", x(d.t)); xh.setAttribute("x2", x(d.t)); xh.setAttribute("opacity", 1);
    const ev2 = events.filter((e) => Math.abs(e.t - d.t) < 5).map((e) => e.label).join(", ");
    const v2 = key2 ? ` / ${fmt(d[key2])}${unit}` : "";
    tip.innerHTML = `${fmt(d[key])}${unit}${v2}<small>${clock(d.t)} · T+${Math.floor(d.t / 60)}:${String(Math.floor(d.t % 60)).padStart(2, "0")}${ev2 ? " · " + ev2 : ""}</small>`;
    tip.style.left = ((x(d.t) / W) * r.width + (r.left - el.getBoundingClientRect().left)) + "px";
    tip.style.top = ((y(d[key]) / H) * r.height + (r.top - el.getBoundingClientRect().top)) + "px";
    tip.style.opacity = 1;
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", () => { tip.style.opacity = 0; xh.setAttribute("opacity", 0); });
}

/** epilogue: every line's high next to the pulse it cost */
export function peakChart(el, lines) {
  const W = 1000, H = 220, pl = 44, pb = 30, pt = 24;
  const n = Math.max(lines.length, 1);
  const slot = (W - pl - 10) / Math.max(n, 5);
  const bw = Math.min(70, slot * 0.55);
  const y = (v) => pt + (1 - clamp(v)) * (H - pt - pb);
  const yh = (hr) => pt + (1 - clamp((hr - 60) / 140)) * (H - pt - pb);
  let bars = "", path = "", dots = "";
  lines.forEach((l, i) => {
    const x = pl + slot * i + (slot - bw) / 2;
    bars += `<rect x="${x}" y="${y(l.peak)}" width="${bw}" height="${H - pb - y(l.peak)}" rx="4" fill="${l.amt > 1 ? "#ffe08a" : "#ffc94a"}" opacity="${0.95 - i * 0.05}"/>
      <text x="${x + bw / 2}" y="${H - pb - 10}" text-anchor="middle" font-family="IBM Plex Mono" font-size="14" font-weight="700" fill="#2a1d00">${Math.round(l.peak * 100)} %</text>
      <text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" font-family="IBM Plex Mono" font-size="12" fill="#8c91a3">${clock(l.t)}${l.amt > 1 ? " · fett" : ""}</text>`;
    path += `${i ? "L" : "M"}${x + bw / 2} ${yh(l.hr)} `;
    dots += `<circle cx="${x + bw / 2}" cy="${yh(l.hr)}" r="5"/><text x="${x + bw / 2}" y="${yh(l.hr) - 10}" text-anchor="middle" font-family="IBM Plex Mono" font-size="12" font-weight="700" fill="#ff8a95" stroke="#111318" stroke-width="4" paint-order="stroke">${Math.round(l.hr)}</text>`;
  });
  const first = lines[0]?.peak || 1, lastP = lines.at(-1)?.peak || 1;
  el.innerHTML = `<h4>Hoch pro Line und was es gekostet hat<small>${lines.length > 1 ? `letzte Line: ${Math.round((lastP / first) * 100)} % der ersten` : "nur eine Line"}</small></h4>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hoch und Puls-Spitze pro Line">
      <g stroke="rgba(255,255,255,.07)">${[0, 0.5, 1].map((v) => `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>
      <g font-family="IBM Plex Mono" font-size="12" fill="#6d7285" text-anchor="end">${[0, 0.5, 1].map((v) => `<text x="${pl - 8}" y="${y(v) + 4}">${v * 100}</text>`).join("")}</g>
      ${bars}
      <path d="${path}" fill="none" stroke="#ff3b4a" stroke-width="2.5"/><g fill="#ff3b4a">${dots}</g>
    </svg>
    <div class="key" style="display:flex;gap:16px;font-size:11px;color:#8c91a3"><span><i style="display:inline-block;width:12px;height:8px;background:#ffc94a;margin-right:6px"></i>Hoch (Euphorie-Spitze)</span><span><i style="display:inline-block;width:14px;height:2px;background:#ff3b4a;margin-right:6px;vertical-align:middle"></i>Puls-Spitze (bpm)</span></div>`;
}
