// „Maße nehmen“: kleine Anleitung mit Schneiderpuppe (SVG), Maßzettel und Übernahme in die Anprobe-Anfrage.
import { esc } from "./util.js";

const STD = 68; // Standardlänge von Lene und Millie
const LIMITS = { taille: [50, 140], laenge: [35, 110] };
const state = { focus: "taille", taille: null, laenge: null };
let root, onApply = () => false;

const GUIDE = {
  taille: {
    title: "Taille",
    steps: [
      "Stell dich entspannt hin, am besten in dünner Kleidung.",
      "Leg das Maßband waagerecht um die schmalste Stelle deiner Taille, meist knapp über dem Bauchnabel.",
      "Nicht einziehen und nicht zu fest ziehen: Ein Finger sollte noch unter das Band passen.",
    ],
  },
  laenge: {
    title: "Rocklänge",
    steps: [
      "Setz das Maßband dort an, wo der Bund sitzen soll, also an deiner Taille.",
      "Miss senkrecht nach unten bis dahin, wo der Saum enden soll. Vor dem Spiegel oder mit Hilfe geht es leichter.",
      `Zum Vergleich: Lene und Millie sind ca. ${STD} cm lang, das endet bei vielen knapp unterm Knie.`,
    ],
  },
};

/* ---------- Figur ---------- */
const CX = 150, WAIST = 228, PX_CM = 2.1;
function skirtGeom(len) {
  const hem = WAIST + len * PX_CM;
  const hw = 74 + len * 0.25;
  const mid = hem - (hem - WAIST) * 0.5;
  const d = `M104 ${WAIST - 2} L196 ${WAIST - 2} C216 250 ${CX + hw} ${mid} ${CX + hw} ${hem} Q${CX} ${hem + 14} ${CX - hw} ${hem} C${CX - hw} ${mid} 84 250 104 ${WAIST - 2} Z`;
  return { hem, hw, d };
}

function figure() {
  return `
  <svg class="dummy" viewBox="0 0 360 520" role="img" aria-labelledby="dummy-title" data-focus="taille">
    <title id="dummy-title">Schneiderpuppe mit Rock: Taille und Rocklänge sind eingezeichnet</title>
    <g class="dummy__stand">
      <path d="M150 350 V470 M150 470 L104 500 M150 470 L196 500 M150 470 V508"/>
      <rect x="146" y="28" width="8" height="10" rx="1"/>
    </g>
    <path class="dummy__body" d="M138 42 L136 70 Q110 78 78 92 L74 100 C80 120 84 135 78 160 C74 185 90 210 106 228 C98 250 74 272 70 300 C68 320 74 336 82 344 Q150 356 218 344 C226 336 232 320 230 300 C226 272 202 250 194 228 C210 210 226 185 222 160 C216 135 220 120 226 100 L222 92 Q190 78 164 70 L162 42 Z"/>
    <ellipse class="dummy__body" cx="150" cy="42" rx="12" ry="4"/>
    <path class="dummy__seam" d="M150 46 V226"/>
    <path class="dummy__skirt" data-skirt d=""/>
    <path class="dummy__gather" d="M118 230 l-5 20 M132 230 l-2 22 M168 230 l2 22 M182 230 l5 20"/>
    <g class="m m--taille">
      <path class="m__back" d="M102 ${WAIST} A48 6 0 0 1 198 ${WAIST}"/>
      <path class="m__line" d="M102 ${WAIST} A48 6 0 0 0 198 ${WAIST}"/>
      <polyline class="m__lead" points="198,${WAIST + 2} 232,196 346,196"/>
      <text class="m__k" x="236" y="186">Taille</text>
      <text class="m__v" x="346" y="186" text-anchor="end" data-out="taille">? cm</text>
    </g>
    <g class="m m--laenge">
      <line class="m__ext" x1="202" y1="${WAIST}" x2="318" y2="${WAIST}"/>
      <line class="m__ext" data-hemext x1="0" y1="0" x2="318" y2="0"/>
      <line class="m__line" data-dim x1="310" y1="${WAIST + 2}" x2="310" y2="0"/>
      <path class="m__head" data-heads d=""/>
      <text class="m__v m__v--rot" data-out="laenge" data-rot text-anchor="middle">? cm</text>
    </g>
  </svg>`;
}

function drawFigure() {
  const svg = root.querySelector(".dummy");
  const len = state.laenge ?? STD;
  const { hem, hw, d } = skirtGeom(Math.min(Math.max(len, LIMITS.laenge[0]), LIMITS.laenge[1]));
  svg.dataset.focus = state.focus;
  svg.querySelector("[data-skirt]").setAttribute("d", d);
  const ext = svg.querySelector("[data-hemext]");
  ext.setAttribute("x1", CX + hw + 6); ext.setAttribute("y1", hem); ext.setAttribute("y2", hem);
  const dim = svg.querySelector("[data-dim]");
  dim.setAttribute("y2", hem - 2);
  svg.querySelector("[data-heads]").setAttribute("d", `M310 ${WAIST} l-4 11 h8 z M310 ${hem} l-4 -11 h8 z`);
  const rot = svg.querySelector("[data-rot]");
  const my = (WAIST + hem) / 2;
  rot.setAttribute("x", 330); rot.setAttribute("y", my);
  rot.setAttribute("transform", `rotate(-90 330 ${my})`);
  svg.querySelector('[data-out="taille"]').textContent = state.taille ? `${state.taille} cm` : "? cm";
  rot.textContent = state.laenge ? `Länge ${state.laenge} cm` : `Länge ? cm`;
}

/* ---------- Hinweise ---------- */
function hints() {
  const out = [];
  const { taille: w, laenge: l } = state;
  if (w) {
    out.push(`Lene, Millie und Rosemary nähe ich genau auf ${w} cm Taille.`);
    out.push(w >= 75 && w <= 91
      ? "Rock Viola (Einzelstück mit Gummibund) passt bei 75–91 cm, also auch dir."
      : "Rock Viola passt bei 75–91 cm Taille. Für dich nähe ich lieber auf Maß.");
  }
  if (l) {
    const diff = l - STD;
    out.push(diff === 0
      ? `${l} cm ist genau die Standardlänge von Lene und Millie.`
      : `${Math.abs(diff) === 1 ? "Das ist" : "Das sind"} ${Math.abs(diff)} cm ${diff > 0 ? "länger" : "kürzer"} als die Standardlänge von ${STD} cm. Kein Problem.`);
  }
  return out;
}

const line = () => {
  const parts = [];
  if (state.taille) parts.push(`Taille ${state.taille} cm`);
  if (state.laenge) parts.push(`Länge ${state.laenge} cm`);
  return parts.length ? `Meine Maße: ${parts.join(", ")}` : "";
};

function renderOut() {
  drawFigure();
  const h = hints();
  root.querySelector("[data-hints]").innerHTML = h.length
    ? h.map((t) => `<li>${esc(t)}</li>`).join("")
    : `<li>Trag deine Maße ein, dann sage ich dir, was passt.</li>`;
  const l = line();
  root.querySelector("[data-preview]").textContent = l || "Meine Maße: …";
  root.querySelector("[data-apply]").disabled = !l;
}

function setFocus(key, moveFocus = false) {
  state.focus = key;
  root.querySelectorAll("[role=tab]").forEach((t) => {
    const on = t.dataset.key === key;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && moveFocus) t.focus();
  });
  root.querySelectorAll("[role=tabpanel]").forEach((p) => { p.hidden = p.dataset.key !== key; });
  root.querySelectorAll(".slip__field").forEach((f) => f.classList.toggle("is-focus", f.dataset.key === key));
  drawFigure();
}

function field(key, label) {
  const [min, max] = LIMITS[key];
  return `<div class="slip__field" data-key="${key}">
    <label for="m-${key}">${label}</label>
    <div class="stepper">
      <button type="button" data-step="-1" data-for="${key}" aria-label="${label} um 1 cm verringern">−</button>
      <input id="m-${key}" name="${key}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" placeholder="${key === "taille" ? "z. B. 74" : `z. B. ${STD}`}" aria-describedby="m-${key}-err">
      <span class="stepper__unit" aria-hidden="true">cm</span>
      <button type="button" data-step="1" data-for="${key}" aria-label="${label} um 1 cm erhöhen">+</button>
    </div>
    <p class="field__error" id="m-${key}-err"></p>
  </div>`;
}

function readValue(key) {
  const input = root.querySelector(`#m-${key}`);
  const err = root.querySelector(`#m-${key}-err`);
  const [min, max] = LIMITS[key];
  const raw = input.value.trim();
  if (!raw) { state[key] = null; err.textContent = ""; input.removeAttribute("aria-invalid"); return; }
  const v = Math.round(Number(raw.replace(",", ".")));
  if (!Number.isFinite(v) || v < min || v > max) {
    state[key] = null;
    err.textContent = `Bitte eine Zahl zwischen ${min} und ${max} cm.`;
    input.setAttribute("aria-invalid", "true");
    return;
  }
  state[key] = v; err.textContent = ""; input.removeAttribute("aria-invalid");
}

export function initMeasure({ apply }) {
  onApply = apply;
  root = document.getElementById("measure");
  const tabs = Object.entries(GUIDE).map(([key, g], i) =>
    `<button type="button" role="tab" id="mt-${key}" data-key="${key}" aria-controls="mp-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="mono">${i + 1}</span>${g.title}</button>`).join("");
  const panels = Object.entries(GUIDE).map(([key, g], i) =>
    `<div role="tabpanel" id="mp-${key}" data-key="${key}" aria-labelledby="mt-${key}"${i ? " hidden" : ""}><ol class="howto">${g.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("");

  root.innerHTML = `
    <figure class="measure__fig">
      ${figure()}
      <figcaption class="mono"><span>Abb. 4</span> Blau eingezeichnet: das Maß, um das es gerade geht</figcaption>
    </figure>
    <div class="measure__guide">
      <div class="measure__tabs" role="tablist" aria-label="Welches Maß?">${tabs}</div>
      ${panels}
      <p class="measure__tip">Unsicher? Dann messen wir einfach zusammen bei der Anprobe.</p>
      <div class="slip">
        <p class="slip__head mono"><span>Mein Maßzettel</span><span>Angaben in cm</span></p>
        <div class="slip__fields">${field("taille", "Taille")}${field("laenge", "Rocklänge")}</div>
        <ul class="slip__hints" data-hints aria-live="polite"></ul>
        <p class="slip__preview mono" data-preview></p>
        <button type="button" class="btn btn--ink" data-apply disabled>In die Anprobe-Anfrage übernehmen</button>
      </div>
    </div>`;

  root.querySelector(".measure__tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[role=tab]");
    if (t) setFocus(t.dataset.key);
  });
  root.querySelector(".measure__tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    setFocus(state.focus === "taille" ? "laenge" : "taille", true);
  });
  root.querySelectorAll(".slip input").forEach((input) => {
    input.addEventListener("input", () => { readValue(input.name); renderOut(); });
    input.addEventListener("focus", () => { if (state.focus !== input.name) setFocus(input.name); });
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const key = b.dataset.for;
    const input = root.querySelector(`#m-${key}`);
    const [min, max] = LIMITS[key];
    const base = state[key] ?? (key === "taille" ? 74 : STD) - Number(b.dataset.step);
    input.value = String(Math.min(max, Math.max(min, base + Number(b.dataset.step))));
    readValue(key);
    if (state.focus !== key) setFocus(key);
    renderOut();
  });
  root.querySelector("[data-apply]").addEventListener("click", () => {
    const l = line();
    if (l) onApply(l);
  });
  renderOut();
}
