// Illustrations: the zoom panel scenes, the synapse animation, epilogue art, week view and recap charts.

const NS = "http://www.w3.org/2000/svg";
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- zoom: pill journey */
export function journeySVG() {
  return `
<svg viewBox="0 0 320 190" id="journey">
  <defs>
    <linearGradient id="jPath" x1="0" x2="1"><stop offset="0" stop-color="#ff86c4"/><stop offset="1" stop-color="#8a5cff"/></linearGradient>
    <filter id="jGlow"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <path id="jRoute" d="M34 150 C 70 150, 80 104, 118 110 S 170 150, 206 118 S 250 50, 286 46" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="10" stroke-linecap="round"/>
  <path id="jDone" d="M34 150 C 70 150, 80 104, 118 110 S 170 150, 206 118 S 250 50, 286 46" fill="none" stroke="url(#jPath)" stroke-width="4" stroke-linecap="round" stroke-dasharray="0 999"/>
  <!-- mouth -->
  <g transform="translate(34 150)" class="jst" data-k="0">
    <circle r="22" fill="#1b1624" stroke="rgba(255,255,255,.25)"/>
    <path d="M-12 -2 Q0 -9 12 -2 Q0 10 -12 -2Z" fill="#e0709a"/>
  </g>
  <!-- stomach -->
  <g transform="translate(118 110)" class="jst" data-k="1">
    <circle r="26" fill="#1b1624" stroke="rgba(255,255,255,.25)"/>
    <path d="M-6 -16 C-6 -6 -14 -8 -16 2 C-18 14 -4 20 6 16 C18 12 18 -2 10 -6 C4 -9 2 -12 2 -18" fill="none" stroke="#9dff5c" stroke-width="3" stroke-linecap="round"/>
    <circle id="jPill" cx="2" cy="6" r="5" fill="#ff86c4"/>
  </g>
  <!-- blood -->
  <g transform="translate(206 118)" class="jst" data-k="2">
    <circle r="22" fill="#1b1624" stroke="rgba(255,255,255,.25)"/>
    <path d="M0 -13 C6 -4 10 1 10 6 A10 10 0 0 1 -10 6 C-10 1 -6 -4 0 -13Z" fill="#ff4d5e"/>
  </g>
  <!-- brain -->
  <g transform="translate(286 46)" class="jst" data-k="3">
    <circle r="26" fill="#1b1624" stroke="rgba(255,255,255,.25)"/>
    <path d="M-14 4 C-18 -6 -10 -16 0 -14 C8 -18 18 -10 15 0 C18 8 10 14 2 12 C-4 16 -12 12 -14 4Z" fill="none" stroke="#ff4fd8" stroke-width="2.5"/>
    <path d="M-6 -8 C-2 -4 -8 0 -2 4 M6 -8 C2 -2 8 2 4 8" fill="none" stroke="#ff4fd8" stroke-width="1.5"/>
  </g>
  <circle id="jDot" r="6" fill="#fff" filter="url(#jGlow)"/>
  <circle id="jDot2" r="3.5" fill="#fff"/>
  <g class="art-label" text-anchor="middle">
    <text x="34" y="186">Mund</text><text x="118" y="152">Magen</text><text x="206" y="156">Blut</text><text x="286" y="88">Gehirn</text>
  </g>
  <text id="jTime" x="12" y="22" class="art-label big">T+0 min</text>
  <text id="jNote" x="12" y="40" class="art-label">löst sich auf …</text>
</svg>`;
}

export function updateJourney(root, t) {
  const route = root.querySelector("#jRoute");
  if (!route) return;
  const len = route.getTotalLength();
  const k = clamp(t / 45);
  const pt = route.getPointAtLength(len * k);
  root.querySelector("#jDot").setAttribute("cx", pt.x);
  root.querySelector("#jDot").setAttribute("cy", pt.y);
  root.querySelector("#jDot2").setAttribute("cx", pt.x);
  root.querySelector("#jDot2").setAttribute("cy", pt.y);
  root.querySelector("#jDone").setAttribute("stroke-dasharray", `${len * k} 999`);
  const pill = root.querySelector("#jPill");
  pill.setAttribute("r", Math.max(0, 5 * (1 - clamp((t - 3) / 20))));
  root.querySelector("#jTime").textContent = `T+${Math.floor(t)} min`;
  const notes = ["runtergeschluckt", "löst sich im Magen auf …", "Wirkstoff geht ins Blut", "passiert die Blut-Hirn-Schranke", "angekommen."];
  root.querySelector("#jNote").textContent = notes[Math.min(4, Math.floor(k * 4 + (k >= 1 ? 1 : 0)))];
  root.querySelectorAll(".jst").forEach((g) => {
    const on = k * 3 >= +g.dataset.k - 0.02;
    g.style.opacity = on ? 1 : 0.4;
  });
}

/* ---------------------------------------------------------------- synapse (canvas) */
export class Synapse {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.mols = [];
    this.mdma = [];
    this.recGlow = [0, 0, 0, 0, 0];
    this.W = canvas.width = 640;
    this.H = canvas.height = 420;
  }

  // release: 0..1 flood strength, store: 0..1 vesicle content, reversed: SERT pumps out
  draw(dt, time, { release, store, reversed }) {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // presynaptic terminal
    const g = ctx.createLinearGradient(0, 0, 0, 200);
    g.addColorStop(0, "#2a1f44");
    g.addColorStop(1, "#1a1330");
    ctx.fillStyle = g;
    ctx.strokeStyle = "#8a5cff";
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
    ctx.fillStyle = "#16202c";
    ctx.strokeStyle = "#3ff0ff";
    ctx.beginPath();
    ctx.moveTo(60, H);
    ctx.bezierCurveTo(60, 300, 120, 290, 320, 290);
    ctx.bezierCurveTo(520, 290, 580, 300, 580, H);
    ctx.fill();
    ctx.stroke();

    // receptors
    const recX = [150, 235, 320, 405, 490];
    recX.forEach((x, i) => {
      this.recGlow[i] = Math.max(0, this.recGlow[i] - dt * 1.8);
      const glow = this.recGlow[i];
      ctx.fillStyle = `rgba(63,240,255,${0.25 + glow * 0.75})`;
      ctx.beginPath();
      ctx.moveTo(x - 14, 290);
      ctx.lineTo(x - 14, 272);
      ctx.lineTo(x - 7, 272);
      ctx.lineTo(x - 7, 283);
      ctx.lineTo(x + 7, 283);
      ctx.lineTo(x + 7, 272);
      ctx.lineTo(x + 14, 272);
      ctx.lineTo(x + 14, 290);
      ctx.fill();
      if (glow > 0.05) {
        ctx.fillStyle = `rgba(63,240,255,${glow * 0.3})`;
        ctx.beginPath();
        ctx.arc(x, 300, 26 * glow + 8, 0, TAU);
        ctx.fill();
      }
    });

    // vesicles
    const ves = [[170, 110], [240, 80], [320, 120], [400, 82], [470, 112], [260, 150], [380, 155]];
    ves.forEach(([vx, vy], i) => {
      ctx.strokeStyle = "rgba(255,134,196,.7)";
      ctx.fillStyle = "rgba(255,134,196,.08)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(vx, vy, 22, 0, TAU);
      ctx.fill();
      ctx.stroke();
      const n = Math.round(9 * store);
      for (let k = 0; k < n; k++) {
        const a = k * 2.4 + i + time * 0.5;
        const r = 5 + (k % 3) * 5;
        ctx.fillStyle = "#ffd23f";
        ctx.beginPath();
        ctx.arc(vx + Math.cos(a) * r, vy + Math.sin(a) * r, 3, 0, TAU);
        ctx.fill();
      }
    });

    // SERT transporters on the membrane
    const sert = [[150, 186], [490, 186]];
    sert.forEach(([sx, sy]) => {
      ctx.fillStyle = reversed ? "#ff3fb4" : "#5a4a8a";
      ctx.fillRect(sx - 12, sy - 12, 24, 24);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      const dir = reversed ? 1 : -1;
      const off = ((time * 40) % 16) * dir;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 8 + off * 0.3);
      ctx.lineTo(sx, sy + 8 + off * 0.3);
      ctx.moveTo(sx - 5, sy + dir * 3 + off * 0.3);
      ctx.lineTo(sx, sy + dir * 8 + off * 0.3);
      ctx.lineTo(sx + 5, sy + dir * 3 + off * 0.3);
      ctx.stroke();
    });

    // spawn serotonin
    const rate = (0.6 + release * 16) * (0.15 + store * 0.85);
    if (Math.random() < rate * dt) {
      const from = reversed && Math.random() < 0.6 ? sert[Math.floor(Math.random() * 2)] : ves[Math.floor(Math.random() * ves.length)];
      this.mols.push({ x: from[0] + (Math.random() - 0.5) * 20, y: Math.max(from[1], 196), vx: (Math.random() - 0.5) * 60, vy: 30 + Math.random() * 50, back: false, life: 6 });
    }
    // spawn MDMA molecules being pulled into the transporters
    if (reversed && Math.random() < dt * 2.2) {
      const s = sert[Math.floor(Math.random() * 2)];
      this.mdma.push({ x: s[0] + (Math.random() - 0.5) * 140, y: 250, tx: s[0], ty: s[1], life: 2 });
    }

    // molecules in the cleft
    for (let i = this.mols.length - 1; i >= 0; i--) {
      const m = this.mols[i];
      m.life -= dt;
      m.vx += (Math.random() - 0.5) * 140 * dt;
      if (!m.back) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.y > 268) {
          const r = recX.reduce((best, x, k) => (Math.abs(x - m.x) < Math.abs(recX[best] - m.x) ? k : best), 0);
          this.recGlow[r] = Math.min(1, this.recGlow[r] + 0.35);
          m.vy = -m.vy * 0.6;
          m.back = !reversed; // normal: reuptake; MDMA: it just bounces around
          if (reversed) m.y = 266;
        }
        if (m.y < 200) m.vy = Math.abs(m.vy);
      } else {
        const s = sert[m.x < 320 ? 0 : 1];
        m.x += (s[0] - m.x) * dt * 2;
        m.y += (s[1] - m.y) * dt * 2;
        if (Math.hypot(s[0] - m.x, s[1] - m.y) < 8) m.life = 0;
      }
      if (m.life <= 0) { this.mols.splice(i, 1); continue; }
      ctx.fillStyle = "#ffd23f";
      ctx.shadowColor = "#ffd23f";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 4, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    for (let i = this.mdma.length - 1; i >= 0; i--) {
      const m = this.mdma[i];
      m.life -= dt;
      m.x += (m.tx - m.x) * dt * 1.5;
      m.y += (m.ty - m.y) * dt * 1.5;
      if (m.life <= 0) { this.mdma.splice(i, 1); continue; }
      ctx.fillStyle = "#ff3fb4";
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }

    // labels
    ctx.font = "600 20px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.fillText("Präsynapse", 20, 30);
    ctx.fillText("Rezeptoren", 20, 405);
    ctx.fillStyle = reversed ? "#ff86c4" : "rgba(255,255,255,.6)";
    ctx.fillText(reversed ? "SERT ⟲ umgedreht" : "SERT holt zurück", 190, 240);
  }
}

/* ---------------------------------------------------------------- brain */
export function brainSVG() {
  const regions = [
    { id: "rReward", x: 108, y: 112, c: "#ffd23f", label: "Dopamin ↑", sub: "Energie", lx: 4, ly: 176 },
    { id: "rHypo", x: 150, y: 118, c: "#ff4fd8", label: "Oxytocin ↑", sub: "Nähe", lx: 84, ly: 204 },
    { id: "rAmyg", x: 172, y: 132, c: "#3ff0ff", label: "Amygdala ↓", sub: "Angst leiser", lx: 232, ly: 176 },
    { id: "rStem", x: 196, y: 162, c: "#ff4d5e", label: "Hirnstamm", sub: "Puls, Hitze ↑", lx: 232, ly: 208 },
    { id: "rVis", x: 262, y: 88, c: "#9dff5c", label: "Sehrinde", sub: "Farben, Licht", lx: 226, ly: 14 },
  ];
  return `
<svg viewBox="0 0 320 222" id="brain">
  <defs><filter id="bGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9"/></filter></defs>
  <path d="M46 118 C30 78 62 36 116 30 C150 12 206 16 236 40 C272 44 296 76 288 110 C298 138 272 158 244 152 C226 166 204 168 186 160 L190 196 C190 204 176 206 174 196 L168 160 C130 170 84 166 64 150 C48 146 40 132 46 118 Z"
        fill="#17121f" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
  <path d="M244 152 C252 170 238 184 216 178 C204 176 196 168 196 160" fill="#1c1626" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>
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
  <line x1="${r.x}" y1="${r.y}" x2="${r.lx + 4}" y2="${r.ly - 12}" stroke="${r.c}" stroke-width="1" opacity=".6"/>
  <text x="${r.lx}" y="${r.ly}" class="art-label big" fill="${r.c}" style="fill:${r.c}">${r.label}</text>
  <text x="${r.lx}" y="${r.ly + 12}" class="art-label">${r.sub}</text>`).join("")}
</svg>`;
}

export function updateBrain(root, time, E, beat) {
  const ids = ["rReward", "rHypo", "rAmyg", "rStem", "rVis"];
  ids.forEach((id, i) => {
    const el = root.querySelector("#" + id);
    if (!el) return;
    const base = id === "rAmyg" ? 0.5 - 0.35 * E : 0.2 + 0.7 * E;
    el.setAttribute("opacity", clamp(base + 0.25 * beat * E * (i % 2 ? 1 : 0.6)));
    el.setAttribute("r", 14 + 10 * E + 4 * Math.sin(time * 2 + i));
  });
}

/* ---------------------------------------------------------------- plateau: two people talking */
export function talkSVG() {
  return `
<svg viewBox="0 0 320 190" id="talk">
  <defs>
    <linearGradient id="tW" x1="0" x2="1"><stop offset="0" stop-color="#ff3fb4"/><stop offset=".5" stop-color="#ffd23f"/><stop offset="1" stop-color="#3ff0ff"/></linearGradient>
  </defs>
  <g fill="#1c1626" stroke="rgba(255,255,255,.35)" stroke-width="2">
    <path d="M40 190 L40 150 C40 128 56 118 70 118 C58 108 52 92 56 76 C60 58 78 48 96 52 C114 56 124 72 122 90 L132 100 L122 104 C122 112 118 118 112 120 C126 124 136 136 136 150 L136 190Z"/>
    <path d="M280 190 L280 150 C280 128 264 118 250 118 C262 108 268 92 264 76 C260 58 242 48 224 52 C206 56 196 72 198 90 L188 100 L198 104 C198 112 202 118 208 120 C194 124 184 136 184 150 L184 190Z"/>
  </g>
  <path id="tWave" d="" fill="none" stroke="url(#tW)" stroke-width="3" stroke-linecap="round"/>
  <path id="tWave2" d="" fill="none" stroke="url(#tW)" stroke-width="1.5" opacity=".5"/>
  <text x="160" y="30" text-anchor="middle" class="art-label big">„Deine Oma klingt so toll.“</text>
  <text x="160" y="46" text-anchor="middle" class="art-label">— Minute 41 des Gesprächs</text>
  <g class="art-label" text-anchor="middle"><text x="88" y="182">du</text><text x="232" y="182">Kevin (?)</text></g>
</svg>`;
}

export function updateTalk(root, time, E) {
  const w = root.querySelector("#tWave");
  if (!w) return;
  const mk = (amp, ph) => {
    let d = "M136 96";
    for (let x = 136; x <= 184; x += 2) {
      const k = (x - 136) / 48;
      const env = Math.sin(k * Math.PI);
      d += ` L${x} ${96 + Math.sin(x * 0.35 + time * 5 + ph) * amp * env}`;
    }
    return d;
  };
  w.setAttribute("d", mk(10 * E + 2, 0));
  root.querySelector("#tWave2").setAttribute("d", mk(16 * E + 3, 2));
}

/* ---------------------------------------------------------------- epilogue mini-art */
export function chemArt(kind) {
  const bg = `<rect width="200" height="150" fill="#07080c"/>`;
  if (kind === "release") {
    let dots = "";
    for (let i = 0; i < 46; i++) dots += `<circle cx="${30 + ((i * 53) % 140)}" cy="${80 + ((i * 29) % 40)}" r="3" fill="#ffd23f" opacity="${0.5 + (i % 5) / 10}"/>`;
    return `<svg viewBox="0 0 200 150">${bg}<path d="M20 0 C20 40 40 70 100 70 C160 70 180 40 180 0Z" fill="#231a3a" stroke="#8a5cff" stroke-width="2"/>
      <rect x="44" y="52" width="16" height="16" fill="#ff3fb4"/><rect x="140" y="52" width="16" height="16" fill="#ff3fb4"/>
      <path d="M20 150 C20 128 40 124 100 124 C160 124 180 128 180 150Z" fill="#16202c" stroke="#3ff0ff" stroke-width="2"/>${dots}</svg>`;
  }
  if (kind === "oxy") {
    return `<svg viewBox="0 0 200 150">${bg}
      <circle cx="62" cy="62" r="18" fill="#1c1626" stroke="rgba(255,255,255,.4)" stroke-width="2"/><path d="M36 150 C36 104 88 104 88 150" fill="#1c1626" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
      <circle cx="138" cy="62" r="18" fill="#1c1626" stroke="rgba(255,255,255,.4)" stroke-width="2"/><path d="M112 150 C112 104 164 104 164 150" fill="#1c1626" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
      <path d="M100 58 C84 44 86 30 96 30 C100 30 100 34 100 36 C100 34 100 30 104 30 C114 30 116 44 100 58Z" fill="#ff3fb4"/>
      <path d="M80 70 Q100 90 120 70" fill="none" stroke="#ffd23f" stroke-width="2" stroke-dasharray="3 4"/></svg>`;
  }
  if (kind === "amyg") {
    return `<svg viewBox="0 0 200 150">${bg}
      <circle cx="100" cy="75" r="46" fill="#3ff0ff" opacity=".08"/>
      <path d="M100 42 C124 48 130 78 116 98 C106 112 88 110 82 96 C74 78 80 48 100 42Z" fill="#12262c" stroke="#3ff0ff" stroke-width="2"/>
      <g stroke="#3ff0ff" stroke-width="2" opacity=".35"><path d="M34 40 l10 6 M30 75 h12 M34 110 l10 -6 M166 40 l-10 6 M170 75 h-12 M166 110 l-10 -6"/></g>
      <text x="100" y="140" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#3ff0ff">ALARM: LEISE</text></svg>`;
  }
  // empty
  let ves = "";
  [[50, 70], [100, 50], [150, 70], [75, 105], [125, 105]].forEach(([x, y], i) => {
    ves += `<circle cx="${x}" cy="${y}" r="17" fill="none" stroke="rgba(255,134,196,.45)" stroke-width="2" stroke-dasharray="${i % 2 ? "4 3" : "none"}"/>`;
  });
  return `<svg viewBox="0 0 200 150">${bg}${ves}<circle cx="100" cy="50" r="3" fill="#ffd23f"/>
    <text x="100" y="142" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#8c91a3">VORRAT: FAST LEER</text></svg>`;
}

/* ---------------------------------------------------------------- weather icons for the week */
export function weather(kind) {
  const sun = (cx, cy, r, op = 1) => {
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      rays += `<line x1="${cx + Math.cos(a) * (r + 5)}" y1="${cy + Math.sin(a) * (r + 5)}" x2="${cx + Math.cos(a) * (r + 11)}" y2="${cy + Math.sin(a) * (r + 11)}"/>`;
    }
    return `<g opacity="${op}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffd23f"/><g stroke="#ffd23f" stroke-width="3" stroke-linecap="round">${rays}</g></g>`;
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
    case "disco": {
      let tiles = "";
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) tiles += `<rect x="${36 + i * 6}" y="${16 + j * 6}" width="5" height="5" fill="hsl(${(i * 60 + j * 40) % 360},90%,${55 + ((i + j) % 2) * 20}%)"/>`;
      return wrap(`<line x1="50" y1="0" x2="50" y2="16" stroke="#aaa"/><clipPath id="dc"><circle cx="50" cy="31" r="15"/></clipPath><g clip-path="url(#dc)">${tiles}</g>
        <g stroke="#ff3fb4" stroke-width="1.5"><line x1="50" y1="31" x2="8" y2="60"/><line x1="50" y1="31" x2="92" y2="58"/></g>`);
    }
    case "sunset": return wrap(`${sun(50, 42, 14, 0.85)}<rect x="0" y="44" width="100" height="20" fill="#101219"/><line x1="10" y1="44" x2="90" y2="44" stroke="#ff9a5a" stroke-width="2"/>`);
    case "cloud": return wrap(cloud(50, 34, 1.05));
    case "rain": return wrap(`${cloud(50, 26, 1.05, "#5d6378")}${rain(52, 42)}`);
    case "storm": return wrap(`${cloud(50, 24, 1.1, "#454a5c")}${rain(50, 40, 3)}<path d="M54 30 L44 46 H52 L46 62 L62 40 H54 L60 30Z" fill="#ffd23f"/>`);
    case "partly": return wrap(`${sun(36, 26, 11)}${cloud(58, 38, 0.95)}`);
    default: return wrap(sun(50, 32, 14));
  }
}

/* ---------------------------------------------------------------- recap charts (small multiples) */
export function lineChart(el, { title, unit, color, data, key, min, max, fmt, band, events }) {
  const W = 520, H = 150, pl = 36, pr = 8, pt = 6, pb = 20;
  const x = (t) => pl + (t / 420) * (W - pl - pr);
  const y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  const pts = data.map((d) => [x(d.t), y(d[key])]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const ticks = [0, 90, 180, 270, 360];
  const clock = (t) => {
    const m = (23 * 60 + 30 + t) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const ys = [min, (min + max) / 2, max];
  const peak = data.reduce((a, d) => (d[key] > a[key] ? d : a), data[0]);
  el.innerHTML = `
    <h4>${title}<small>max ${fmt(peak[key])}${unit}</small></h4>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${title} über die Nacht">
      ${band ? `<rect class="band" x="${pl}" y="${y(band[1])}" width="${W - pl - pr}" height="${y(band[0]) - y(band[1])}" fill="${band[2]}"/>` : ""}
      <g class="grid">${ys.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>
      <g class="axis">
        ${ys.map((v) => `<text x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join("")}
        ${ticks.map((t) => `<text x="${x(t)}" y="${H - 4}" text-anchor="middle">${clock(t)}</text>`).join("")}
      </g>
      ${events.map((e) => `<line x1="${x(e.t)}" x2="${x(e.t)}" y1="${pt}" y2="${H - pb}" stroke="${e.c}" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/>`).join("")}
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line class="xh" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="rgba(255,255,255,.4)" opacity="0" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="tip"></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = el.querySelector(".xh");
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = clamp(((px - pl) / (W - pl - pr)) * 420, 0, 420);
    const d = data.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    xh.setAttribute("x1", x(d.t)); xh.setAttribute("x2", x(d.t)); xh.setAttribute("opacity", 1);
    const ev2 = events.filter((e) => Math.abs(e.t - d.t) < 6).map((e) => e.label).join(", ");
    tip.innerHTML = `${fmt(d[key])}${unit}<small>${clock(d.t)} · T+${Math.floor(d.t / 60)}:${String(Math.floor(d.t % 60)).padStart(2, "0")}${ev2 ? " · " + ev2 : ""}</small>`;
    tip.style.left = ((x(d.t) / W) * r.width + (r.left - el.getBoundingClientRect().left)) + "px";
    tip.style.top = ((y(d[key]) / H) * r.height + (r.top - el.getBoundingClientRect().top)) + "px";
    tip.style.opacity = 1;
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", () => { tip.style.opacity = 0; xh.setAttribute("opacity", 0); });
}
