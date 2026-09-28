import { createGL } from "./gl.js";
import { AudioEngine, BPM } from "./audio.js";
import { Fx, Rain } from "./fx.js";
import * as Art from "./art.js";
import { clamp, sm, gauss, step, newModel, project } from "./model.js";

const $ = (s) => document.querySelector(s);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const de = (v, d = 1) => v.toFixed(d).replace(".", ",");
const hm = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/* =================================================================== script */

const END = Art.END; // simulated minutes: 00:30 → 06:30
const LINE_G = 0.07; // one standard line
const REFILL_G = 1;
const REFILL_EUR = 80;

const PHASES = [
  { id: "line", from: 0, to: 3, rate: 0.22, act: "AKT I", name: "Die Line", sub: "Schnell, bevor jemand klopft.", accent: "#cfd6e4", zoom: "journey" },
  { id: "kick", from: 3, to: 15, rate: 0.5, act: "AKT II", name: "Der Kick", sub: "Null auf hundert.", accent: "#7fd8ff", zoom: "synapse" },
  { id: "peak", from: 15, to: 45, rate: 0.8, act: "AKT III", name: "König der Welt", sub: "Du hast recht. Mit allem.", accent: "#ffc94a", zoom: "brain" },
  { id: "spiral", from: 45, to: 255, rate: 1.8, act: "AKT IV", name: "Die Spirale", sub: "Nur noch eine.", accent: "#ff5a6e", zoom: "spiral" },
  { id: "crash", from: 255, to: END, rate: 3, act: "AKT V", name: "Der Absturz", sub: "Draußen wird’s hell. Drinnen nicht.", accent: "#7a8398", zoom: "crash" },
];

const LEGEND = '<span class="legend"><i style="color:#ffc94a">●</i> Dopamin <i style="color:#f4fbff">⬢</i> Kokain</span>';
const ZOOM = {
  journey: {
    title: "Durch die Nase",
    text: "Das Pulver löst sich auf der Nasenschleimhaut und ist nach <b>2–3 Minuten</b> im Gehirn. Nebenbei betäubt Kokain die Schleimhaut, es ist auch ein <b>Lokalanästhetikum</b>. Darum wird die Nase taub. Und die Zähne, wenn’s in den Rachen läuft.",
  },
  synapse: {
    title: "Der Staubsauger klemmt",
    text: LEGEND + "Kokain blockiert den <b>Dopamin-Transporter (DAT)</b>. Dopamin bleibt im Spalt und hämmert auf die Rezeptoren. Dazu Noradrenalin: Herz schneller, Adern enger, alles wach.",
  },
  brain: {
    title: "Dein Gehirn gerade",
    text: "Das <b>Belohnungssystem</b> feuert, das Stirnhirn, sonst zuständig für Selbstkritik, winkt alles durch. Ergebnis: Selbstbewusstsein, Redefluss, Größenideen. Gleichzeitig steigen <b>Puls und Blutdruck</b>.",
  },
  spiral: {
    title: "Jagd nach der ersten Line",
    text: "Jede Line bringt weniger Hoch als die davor, das nennt man <b>akute Toleranz</b>. Die Last für Herz und Gefäße stapelt sich dagegen weiter. Und weil das Hoch so kurz ist, kommt die Frage nach der nächsten immer schneller.",
  },
  crash: {
    title: "Unter null",
    text: LEGEND + "Der Spiegel sinkt, die Transporter räumen jetzt gründlich auf. Das Dopamin fällt <b>unter den Normalwert</b>: Leere, Gereiztheit und ein einziger Gedanke, mehr. Das ist <b>Craving</b>, kein Charakterfehler.",
  },
};

// [sim minute, text, condition?, class?]
const THOUGHTS = [
  [0.3, "Schnell. Bevor jemand an die Tür klopft."],
  [1.2, "Brennt. Und läuft hinten den Hals runter. Bitter."],
  [2.2, "Meine Zähne sind taub. Heißt: Das Zeug ist gut, sagt Marco."],
  [3.3, "Oh. OH. Okay. Okay okay okay."],
  [5.2, "Ich bin wach. So wach war ich noch nie."],
  [7.4, "Alles ist scharf. HD. 4K. 8K."],
  [9.8, "Ich muss sofort mit jemandem reden. Über alles."],
  [12.4, "Warum hab ich nicht schon immer so gelebt?"],
  [16.5, "Ich bin der beste Tänzer hier. Objektiv."],
  [20.5, "Ich hab eine Geschäftsidee. Eine richtig gute. Wo ist mein Handy?"],
  [25, "Montag kündige ich. Nein: Ich mach mich selbstständig."],
  [29.5, "Ich kenn den DJ. Also nicht persönlich. Aber vom Gefühl her."],
  [34, "Hab ich gerade 20 Minuten geredet? Ja. Über mich. Und?"],
  [38.5, "Hm. War das schon alles?", null, "low"],
  [42.5, "Irgendwas fehlt. Ich weiß genau, was.", null, "low"],
  [75, "Die Musik ist gut. Aber nicht mehr so gut wie vorhin."],
  [118, "Warum gehen hier alle zu zweit aufs Klo?"],
  [150, "Jemand zeigt auf meine Nase. Oh.", (S) => S.lines.length >= 3],
  [196, "Wie lang läuft dieser Track eigentlich schon?"],
  [238, "Licht an? Wer macht denn jetzt das Licht an?"],
  [258, "Rausschmiss. Draußen ist es hell. Das ist unfair.", null, "low"],
  [268, "Taxi. 34 Euro. Egal.", null, "low"],
  [282, "Im Bett. Augen zu. Herz sagt: Wir tanzen noch.", null, "low"],
  [296, "Jedes Geräusch ist laut. Der Kühlschrank. Die Vögel. Mein Puls.", null, "low"],
  [310, (S) => `${S.msgs.length} Nachrichten verschickt. Nicht nachhören. NICHT nachhören.`, (S) => S.msgs.length > 1, "low"],
  [310, "Eine Sprachnachricht. Eine. Die war bestimmt okay. Oder?", (S) => S.msgs.length === 1, "low"],
  [310, "Das Handy liegt da. Ich hab nix geschrieben. Wenigstens das.", (S) => S.msgs.length === 0, "low"],
  [324, "Wie spät? Fünf vor sechs. Schlafen? Haha.", null, "low"],
  [338, "Im Beutel ist noch ein Rest. Ich weiß genau, wo er liegt.", (S) => S.grams >= LINE_G * 0.5, "low"],
  [338, "Nie wieder. Sagen alle. Sag ich auch.", (S) => S.grams < LINE_G * 0.5, "low"],
  [352, "Die Sonne scheint. Es fühlt sich an wie eine Beleidigung.", null, "low"],
];

// thoughts that follow every line after the first
const REDOSE = {
  kick: [
    ["Da. Da ist es wieder.", "Okay. Jetzt. JETZT."],
    ["Okay. Ja. Fast wie vorhin.", "Da ist es. Oder?"],
    ["Kurz. Das war kurz.", "Nicht wie die erste. Nie wie die erste.", "Mehr Herz als Hoch.", "Mein Puls merkt es. Ich kaum."],
  ],
  peak: ["Ich hab alles im Griff. ALLES.", "Wir sollten eine Band gründen. Heute noch.", "Ich bin echt gut in Gesprächen. Richtig gut.", "Ich erklär gleich jemandem Bitcoin."],
  flat: ["Ist das jetzt der Peak? Das ist der Peak?", "Mein Herz ist weiter oben als ich.", "Ich spür’s im Kiefer. Sonst nirgends."],
  drop: ["Und weg.", "Schon wieder weg?", "Wo ist Marco?", "Nur noch eine kleine. Dann ist gut.", "Ich muss nur kurz aufs Klo."],
};

const PARA = [
  "Der Türsteher guckt. Der guckt doch?",
  "Warum flüstern die zwei da?",
  "Hab ich was an der Nase? Ich hab was an der Nase.",
  "Die wissen es. Alle wissen es.",
  "War das eben Zivilpolizei? Das war Zivilpolizei.",
  "Mein Herz. Hört das jemand? Das muss man doch hören.",
];

const TALK_LINES = [
  "Nein, hör zu. HÖR ZU. Das ist wichtig.",
  "Ich sag dir, was dein Problem ist. Also, was DEIN Problem ist.",
  "Ich hätte Anwalt werden sollen. Oder DJ. Oder beides.",
  "Wir gründen ein Startup. Du und ich. Heute.",
  "Ich rede zu viel? Ich rede genau richtig viel.",
];

const CONTACTS = [
  { to: "Marco", tx: "…du bist echt der Beste, Mann, ehrlich, der Allerbeste, weißt du das eigentlich…", reply: "Bruder, du schuldest mir noch 40." },
  { to: "Uni-Gruppe (38)", tx: "…Leute. Leute. Hört euch das an. Wir gründen was. Ich hab schon den Namen…", reply: "wer hat den eigentlich eingeladen" },
  { to: "Chef", tx: "…und deshalb finde ich, ich sollte die Abteilung leiten. Nicht als Kritik. Als Vision…", reply: "Lass uns Montag kurz reden. In meinem Büro." },
  { to: "Ex", tx: "…ich bin dir überhaupt nicht mehr böse, ich bin ein komplett anderer Mensch, wirklich…", reply: "Es ist 3 Uhr nachts. Bitte nicht." },
  { to: "Vermieter", tx: "…wir müssen über die Dachterrasse reden, ich hab da Pläne, große Pläne…", reply: "Welche Dachterrasse?" },
  { to: "Mama", tx: "…Mama, ich hab endlich verstanden, was ich mit meinem Leben mache. Erklär ich dir morgen…", reply: "Schatz, alles gut bei dir? Ruf bitte mal an." },
];

/* =================================================================== state */

const S = {
  t: 0, running: false, paused: false, speed: 1, gentle: false,
  M: newModel(), doses: [], lines: [],
  E: 0, c: 0, kick: 0, crash: 0, anx: 0, craving: 0, dark: 0, air: 0, dance: 0.4, leave: 0,
  hr: 74, sys: 118, dia: 76, pupil: 3, numb: 0, irrit: 0, bledAt: null, ego: 0, egoBoost: 0, feltBac: 0,
  grams: 0.5, money: 40, buys: 0, pendingBuy: null,
  offerAt: 45, declines: 0, consec: 0, choiceMode: null,
  airUntil: -1, airs: 0, drinks: 0, talks: 0, talkMin: 0, msgs: [],
  events: [], samples: [], maxHr: 74, maxSys: 118, maxDia: 76, maxBac: 0, maxCe: 0, skips: 0,
  phase: -1, thoughtIdx: 0, warned: {}, heartPh: 0, heartHold: 0, pauseNext: false, flash: 0, nextPara: 60, silent: false,
};

/* =================================================================== setup */

const audio = new AudioEngine();
const gl = createGL($("#gl"));
if (!gl) $("#gl").style.background = "radial-gradient(circle at 50% 40%, #1a2230, #050608 70%)";
const fx = new Fx($("#fx"), $("#crowd"));
const rain = new Rain($("#rain"));
const root = document.documentElement;
const mouse = { x: 0.5, y: 0.5 };

$("#optGentle").checked = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- timeline graph ---------- */
const TX = (t) => (t / END) * 1000;
const TY = (e) => 56 - clamp(e, 0, 1.1) * 46;

function buildTimeline() {
  const ph = $("#tlPhases");
  const labels = $("#tlLabels");
  PHASES.forEach((p, i) => {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", TX(p.from));
    r.setAttribute("width", TX(p.to - p.from));
    r.setAttribute("y", 0);
    r.setAttribute("height", 60);
    if (i % 2) r.classList.add("alt");
    ph.appendChild(r);
    const l = document.createElement("span");
    l.style.left = (p.from / END) * 100 + "%";
    l.textContent = p.name;
    if (p.to - p.from < END * 0.12) l.classList.add("narrow"); // only labelled while active
    labels.appendChild(l);
  });
  drawCurve();
}
function drawCurve() {
  const hist = S.samples.map((s) => [s.t, s.E / 100]);
  hist.push([S.t, S.E]);
  const line = hist.map(([t, e], i) => (i ? "L" : "M") + TX(t).toFixed(1) + " " + TY(e).toFixed(1)).join(" ");
  $("#tlLine").setAttribute("d", line);
  $("#tlArea").setAttribute("d", line + ` L${TX(S.t).toFixed(1)} 60 L0 60 Z`);
  const proj = S.running ? project(S.doses, S.t, S.M, END, 160) : [];
  $("#tlProj").setAttribute("d", proj.map(([t, e], i) => (i ? "L" : "M") + TX(t).toFixed(1) + " " + TY(e).toFixed(1)).join(" "));
  $("#tlLines").innerHTML = S.doses.map((d) => `<line x1="${TX(d.t)}" x2="${TX(d.t)}" y1="0" y2="${d.amt > 1 ? 14 : 9}" vector-effect="non-scaling-stroke"/>`).join("");
}
buildTimeline();

/* ---------- iris lines ---------- */
{
  const g = $("#irisLines");
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("x1", 60 + Math.cos(a) * 8);
    l.setAttribute("y1", 35 + Math.sin(a) * 8);
    l.setAttribute("x2", 60 + Math.cos(a) * 21);
    l.setAttribute("y2", 35 + Math.sin(a) * 21);
    g.appendChild(l);
  }
}

/* =================================================================== intro: the line */

const note = $("#note");
const mirror = $("#mirror");
const BINS = 36;
const eaten = new Array(BINS).fill(false);
let drag = null;
let snorted = false;
let sniffing = false;

{
  // specks of powder around the line
  let s = "";
  for (let i = 0; i < 70; i++) {
    const x = 76 + Math.random() * 250;
    const y = 122 + (Math.random() - 0.5) * (10 + Math.random() * 14);
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + Math.random() * 1.3).toFixed(2)}" opacity="${(0.4 + Math.random() * 0.6).toFixed(2)}"/>`;
  }
  $("#specks").innerHTML = s;
}

function renderPowder() {
  // the clip region is rebuilt as the union of the uneaten bins
  const cp = $("#lineClip");
  let html = "";
  const w = 256 / BINS;
  eaten.forEach((e, i) => {
    if (!e) html += `<rect x="${(72 + i * w).toFixed(2)}" y="100" width="${(w + 0.3).toFixed(2)}" height="44"/>`;
  });
  cp.innerHTML = html;
}

function tipInMirror() {
  const tip = note.querySelector("ellipse").getBoundingClientRect();
  const m = mirror.getBoundingClientRect();
  return { x: ((tip.left + tip.width / 2 - m.left) / m.width) * 400, y: ((tip.top + tip.height / 2 - m.top) / m.height) * 240 };
}

function eatAt(p) {
  if (Math.abs(p.y - 122) > 36 || p.x < 60 || p.x > 340) return;
  const i = Math.floor(((p.x - 72) / 256) * BINS);
  let changed = false;
  for (let k = i - 1; k <= i + 1; k++) {
    if (k >= 0 && k < BINS && !eaten[k]) { eaten[k] = changed = true; }
  }
  if (!changed) return;
  if (!sniffing) { sniffing = true; startAudio(); audio.sfx("sniff"); }
  renderPowder();
  if (eaten.filter(Boolean).length >= BINS * 0.85) finishLine();
}

function startAudio() {
  audio.enabled = $("#optSound").checked;
  audio.start();
  audio.setEnabled(audio.enabled);
}

note.addEventListener("pointerdown", (e) => {
  if (snorted) return;
  startAudio();
  drag = { x0: e.clientX, y0: e.clientY, moved: 0 };
  note.setPointerCapture(e.pointerId);
  note.classList.add("dragging");
});
note.addEventListener("pointermove", (e) => {
  if (!drag || snorted) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  note.style.transform = `translate(${dx}px, ${dy}px) rotate(-8deg)`;
  eatAt(tipInMirror());
});
note.addEventListener("pointerup", () => {
  if (!drag || snorted) return;
  const tap = drag.moved < 8;
  drag = null;
  note.classList.remove("dragging");
  if (tap) autoSnort();
  else if (!snorted) {
    note.style.transition = "transform .5s cubic-bezier(.3,1.6,.5,1)";
    note.style.transform = "";
    setTimeout(() => (note.style.transition = ""), 500);
  }
});
note.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startAudio(); autoSnort(); }
});
note.addEventListener("click", (e) => e.preventDefault());

function autoSnort() {
  if (snorted) return;
  const m = mirror.getBoundingClientRect();
  const start = tipInMirror();
  const sx = m.width / 400, sy = m.height / 240;
  const t0 = performance.now();
  note.classList.add("dragging");
  const run = (now) => {
    if (snorted) return;
    const k = Math.min(1, (now - t0) / 1100);
    // dive onto the right end of the line, then sweep left
    const tx = k < 0.25 ? start.x + (326 - start.x) * (k / 0.25) : 326 - 254 * ((k - 0.25) / 0.75);
    const ty = k < 0.25 ? start.y + (122 - start.y) * (k / 0.25) : 122 + Math.sin(k * 20) * 2;
    note.style.transform = `translate(${(tx - start.x) * sx}px, ${(ty - start.y) * sy}px) rotate(-8deg)`;
    eatAt({ x: tx, y: ty });
    if (k < 1) requestAnimationFrame(run);
    else finishLine();
  };
  requestAnimationFrame(run);
}

function finishLine() {
  if (snorted) return;
  snorted = true;
  eaten.fill(true);
  renderPowder();
  note.classList.add("done");
  $("#snortGuide").style.display = "none";
  S.gentle = $("#optGentle").checked;
  $("#soundBtn").classList.toggle("off", !audio.enabled);
  takeLine(1, true);
  setTimeout(() => {
    document.body.classList.remove("phase-intro");
    S.running = true;
    last = performance.now();
  }, 700);
  if (innerWidth < 860) $("#zoom").classList.add("collapsed");
}

/* =================================================================== UI helpers */

function thought(text, cls) {
  if (S.silent) return;
  if (cls === undefined) cls = S.E > 0.55 ? "high" : S.t > 36 && S.E < 0.3 ? "low" : "";
  const box = $("#thoughts");
  while (box.children.length >= 2) box.firstChild.remove();
  const el = document.createElement("div");
  el.className = "thought " + cls;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 6400);
}

let toastTimer;
function toast(html, cls = "", ms = 5600) {
  if (S.silent) return;
  const el = $("#toast");
  el.className = cls;
  el.innerHTML = html;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function showCard(act, name, sub, mini = false) {
  const c = $("#card");
  $("#cardAct").textContent = act;
  $("#cardName").textContent = name;
  $("#cardSub").textContent = sub;
  c.classList.toggle("mini", mini);
  c.classList.remove("show");
  void c.offsetWidth;
  c.classList.add("show");
}

let synapse = null;
let zoomKind = null;
function setZoom(kind) {
  zoomKind = kind;
  const art = $("#zoomArt");
  const z = ZOOM[kind];
  $("#zoomTitle").textContent = z.title;
  $("#zoomText").innerHTML = z.text;
  synapse = null;
  if (kind === "journey") art.innerHTML = Art.journeySVG();
  else if (kind === "brain") art.innerHTML = Art.brainSVG();
  else if (kind === "spiral") { art.innerHTML = Art.spiralSVG(); Art.updateSpiral(art, S.lines); }
  else {
    art.innerHTML = "<canvas></canvas>";
    synapse = new Art.Synapse(art.querySelector("canvas"));
  }
  art.classList.remove("zoom-fade");
  void art.offsetWidth;
  art.classList.add("zoom-fade");
}

function onPhase(i) {
  const p = PHASES[i];
  document.body.className = "phase-" + p.id;
  root.style.setProperty("--accent", p.accent);
  $("#phaseName").textContent = `${p.act} · ${p.name}`;
  [...$("#tlPhases").children].forEach((r, k) => r.classList.toggle("on", k === i));
  [...$("#tlLabels").children].forEach((l, k) => l.classList.toggle("on", k === i));
  if (!S.silent) showCard(p.act, p.name, p.sub);
  setZoom(p.zoom);
  if (p.id === "kick" && !S.silent) audio.riser(2.2);
}

/* =================================================================== the lines */

function takeLine(amt, first = false) {
  const need = LINE_G * amt;
  if (S.grams < need) amt = S.grams / LINE_G;
  S.grams = Math.max(0, S.grams - LINE_G * amt);
  S.doses.push({ t: S.t, amt });
  S.lines.push({ t: S.t, amt, peak: 0, hr: S.hr });
  S.events.push({ t: S.t, kind: "line", amt });
  S.irrit += 0.17 * amt;
  S.flash = 1;
  fx.shockwave();
  audio.sfx("sniff");
  if (!first) {
    const n = S.lines.length;
    showCard(`${Art.clock(S.t)} · T+${hm(S.t)}`, `Line ${n}`, amt > 1 ? "Eine fette. Damit’s diesmal richtig kommt." : pick(["Nur noch eine.", "Die letzte. Wirklich.", "Dann ist gut."]), true);
    if (S.irrit > 0.75 && S.bledAt === null) {
      S.bledAt = S.t;
      setTimeout(() => {
        fx.nosebleed();
        thought("Warm. Nase. Blut.", "alert red");
        toast("<b>Nasenbluten.</b> Kokain verengt die Gefäße der Nasenschleimhaut, sie wird trocken und rissig. Über geteilte Röhrchen wird so auch <b>Hepatitis C</b> übertragen.", "red", 7000);
      }, 2200);
    }
  }
  drawCurve();
  if (zoomKind === "spiral") Art.updateSpiral($("#zoomArt"), S.lines);
}

const LINE_TITLES = ["„Noch ’ne Line?“", "„Nur noch eine.“", "„Eine geht noch.“", "„Die letzte. Wirklich.“", "„Ist eh schon egal.“"];

function openChoice() {
  const mode = S.grams >= LINE_G * 0.6 ? "line" : S.buys < 2 ? "buy" : null;
  if (!mode) {
    S.offerAt = Infinity;
    thought("Der Beutel ist leer. Marco geht nicht mehr ran.", "low");
    return;
  }
  S.choiceMode = mode;
  S.paused = true;
  $("#toast").classList.remove("show");
  const n = S.lines.length;
  $("#choiceKicker").textContent = `SO · ${Art.clock(S.t)} · T+${hm(S.t)} · ${n} ${n === 1 ? "LINE" : "LINES"}`;
  if (mode === "buy") {
    $("#choiceTitle").textContent = S.buys ? "„Ich ruf ihn nochmal an.“" : "„Soll ich den Typen anrufen?“";
    $("#choiceText").textContent = S.buys
      ? "Das zweite Gramm ist auch weg. Wo ist das hin? Marco hat die Nummer noch. Der Automat nebenan spuckt noch Geld aus."
      : "Der Beutel ist leer. Marco hat eine Nummer. Ein Gramm, 80 Euro, „in zwanzig Minuten da“.";
    $("#choiceNo").textContent = "Nein. Heim.";
    $("#choiceSmall").textContent = `Ruf an. (${REFILL_EUR} €)`;
    $("#choiceBig").hidden = true;
  } else {
    $("#choiceTitle").textContent = LINE_TITLES[Math.min(LINE_TITLES.length - 1, n - 1)];
    $("#choiceText").textContent =
      n === 1 ? "Das Hoch ist weg. Das Wissen, wie es sich angefühlt hat, nicht. Marco hält dir den Beutel hin."
      : n === 2 ? "Die zweite war gut. Nicht so gut wie die erste, aber gut. Und jetzt ist auch die weg."
      : "Das Hoch wird kürzer, der Puls nicht langsamer. Aber aufhören heißt: jetzt runterkommen. Mit allem.";
    $("#choiceNo").textContent = S.consec ? "Nein. Diesmal wirklich nicht." : "Nee, lass mal.";
    $("#choiceSmall").textContent = "Eine kleine.";
    $("#choiceBig").textContent = "Eine fette.";
    $("#choiceBig").hidden = false;
  }
  $("#choiceArt").innerHTML = Art.choiceArt({ grams: S.grams, money: S.money, lines: S.lines, hr: S.hr, mode });
  $("#choice").classList.add("show");
  $("#choiceNo").focus();
}

function decide(kind) {
  $("#choice").classList.remove("show");
  S.paused = false;
  last = performance.now();
  const mode = S.choiceMode;
  S.choiceMode = null;
  if (kind === "no") {
    S.declines++;
    S.consec++;
    S.events.push({ t: S.t, kind: "no" });
    audio.sfx("no");
    S.offerAt = S.t + 34;
    thought(S.consec >= 2 ? "Nein. Ich geh tanzen. Einfach nur tanzen." : mode === "buy" ? "Nein. Kein Anruf. Heim ist auch schön." : "Nee. Ich lass es. Glaub ich.", "");
    if (mode === "buy") S.offerAt = Infinity;
    return;
  }
  S.consec = 0;
  if (mode === "buy") {
    S.buys++;
    S.money += REFILL_EUR;
    S.pendingBuy = S.t + 35;
    S.events.push({ t: S.t, kind: "buy" });
    audio.sfx("ring");
    thought("„Zwanzig Minuten.“ Okay. Zwanzig Minuten. Das schaff ich.");
    return;
  }
  takeLine(kind === "big" ? 1.6 : 1);
  S.offerAt = S.t + 26;
}
$("#choiceNo").addEventListener("click", () => decide("no"));
$("#choiceSmall").addEventListener("click", () => decide(S.choiceMode === "buy" ? "buy" : "small"));
$("#choiceBig").addEventListener("click", () => decide("big"));

/* =================================================================== actions */

const cooldown = (btn, sec) => {
  btn.disabled = true;
  const cd = btn.querySelector(".cd");
  cd.style.transition = "none";
  cd.style.width = "100%";
  void cd.offsetWidth;
  cd.style.transition = `width ${sec}s linear`;
  cd.style.width = "0%";
  setTimeout(() => (btn.disabled = false), sec * 1000);
};

const ACTIONS = {
  air(btn) {
    S.airUntil = S.t + 18;
    S.airs++;
    S.events.push({ t: S.t, kind: "air" });
    audio.sfx("air");
    thought(S.E > 0.5 ? "Raucherbereich. Ich erklär drei Fremden meine Geschäftsidee." : S.anx > 0.4 ? "Draußen. Kalte Luft. Das Herz wird langsamer. Ein bisschen." : "Frische Luft. Kalt. Gut.");
    cooldown(btn, 18 / (PHASES[S.phase]?.rate || 1) / S.speed);
  },
  drink(btn) {
    S.M.gut += 0.22;
    S.drinks++;
    S.events.push({ t: S.t, kind: "drink" });
    audio.sfx("drink");
    if (S.c > 0.25 && !S.warned.ce) {
      S.warned.ce = true;
      toast("<b>Kokain + Alkohol:</b> Die Leber baut daraus <b>Kokaethylen</b>. Das wirkt länger und belastet das Herz stärker als beides allein. Und Kokain versteckt, wie betrunken du bist.", "violet", 8000);
    }
    thought(S.c > 0.3 ? pick(["Ich merk den Alkohol gar nicht. Praktisch.", "Vodka-Mate. Schmeckt wie Wasser.", "Ich könnte die ganze Bar austrinken. Merk nix."]) : S.t > 60 ? "Ein Bier. Zum Runterkommen." : "Ein Bier. Warum nicht.");
    cooldown(btn, 6);
  },
  talk(btn) {
    if (S.E < 0.35) {
      thought(S.t > 250 ? "Keiner mehr da zum Reden. Nur der Kühlschrank." : "Mir fällt nichts mehr ein. Allen anderen auch nicht.", "low");
      cooldown(btn, 3);
      return;
    }
    S.talks++;
    S.talkMin += Math.round(8 + 14 * S.E);
    S.egoBoost = 1;
    S.events.push({ t: S.t, kind: "talk" });
    fx.startTalk();
    audio.sfx("talk");
    thought(pick(TALK_LINES), "high");
    cooldown(btn, 5);
  },
  phone(btn) {
    const c = CONTACTS[S.msgs.length % CONTACTS.length];
    const voice = S.E > 0.35;
    const dur = voice ? Math.round(60 + 240 * S.E + Math.random() * 60) : 0;
    S.msgs.push({ t: S.t, to: c.to, voice, dur, tx: voice ? c.tx : pick(["sorry wegen vorhin", "bist du wach?", "vergiss was ich gesagt hab", "hey"]), reply: voice ? c.reply : "??" });
    S.events.push({ t: S.t, kind: "phone" });
    audio.sfx("phone");
    thought(voice ? `Sprachnachricht an ${c.to}. ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")} Minuten. Die ist gut geworden.` : `„${S.msgs.at(-1).tx}“ an ${c.to}. Gesendet. Warum?`, voice ? "high" : "low");
    cooldown(btn, 5);
  },
};
document.querySelectorAll(".act").forEach((b) => b.addEventListener("click", () => ACTIONS[b.dataset.act](b)));

/* ---------- controls ---------- */
$("#speedBtn").addEventListener("click", (e) => {
  S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : 1;
  e.currentTarget.textContent = S.speed + "×";
});
$("#soundBtn").addEventListener("click", (e) => {
  audio.setEnabled(!audio.enabled);
  e.currentTarget.classList.toggle("off", !audio.enabled);
});
$("#skipBtn").addEventListener("click", () => {
  if (!S.running || S.paused) return;
  const p = PHASES[S.phase];
  if (p) fastForward(Math.min(END, p.to + 0.01));
});
$("#zoomToggle").addEventListener("click", () => {
  const z = $("#zoom");
  z.classList.toggle("collapsed");
  $("#zoomToggle").textContent = z.classList.contains("collapsed") ? "+" : "–";
});
$("#restartBtn").addEventListener("click", () => location.reload());

addEventListener("pointermove", (e) => {
  mouse.x = e.clientX / innerWidth;
  mouse.y = 1 - e.clientY / innerHeight;
  if (S.running) fx.pointer(e.clientX + 24, e.clientY + 24);
});
addEventListener("pointerdown", (e) => {
  if (!S.running || S.paused) return;
  if (e.target.closest("button, a, #hud, #zoom, #actions, #timeline, #choice, #epilogue")) return;
  if (S.E > 0.4) fx.burst(e.clientX + 24, e.clientY + 24, "star");
  else if (S.E > 0.1) fx.burst(e.clientX + 24, e.clientY + 24, "spark");
});
document.addEventListener("visibilitychange", () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else if (audio.enabled) audio.ctx.resume();
});

/* =================================================================== simulation */

function simulate(dm) {
  const t = S.t;
  const r = step(S.M, S.doses, t, dm);
  S.c = r.c;
  S.kick = r.kick;
  S.crash = r.crash;
  S.craving = r.craving;
  S.air += ((t < S.airUntil ? 1 : 0) - S.air) * Math.min(1, dm * 0.35);
  S.anx = clamp(r.anx * (1 - 0.45 * S.air));
  S.egoBoost = Math.max(0, S.egoBoost - dm / 12);
  S.E = clamp(r.E + S.egoBoost * 0.05, 0, 1.1);
  S.dark = clamp(Math.max(r.crash, 0.55 * sm((t - 255) / 60)));
  S.dance = (S.air > 0.5 ? 0.15 : t < 3 ? 0.3 : 1) * (1 - S.dark * 0.5) * (t > 256 ? 0.1 : 1);
  S.leave = sm((t - 225) / 35);

  const cs = S.c / (1 + 0.15 * S.M.tol);
  S.hr = clamp(74 + 48 * cs + 20 * S.anx + 25 * S.M.ce + 10 * S.dance * Math.min(1, S.c) - 8 * S.air + 5 * S.M.bac + 8 * gauss(t, 300, 25), 55, 198);
  S.sys = 118 + 42 * cs + 18 * S.M.ce + 12 * S.anx - 6 * S.air;
  S.dia = 76 + 22 * cs + 10 * S.M.ce + 6 * S.anx;
  S.pupil = 3 + 4 * clamp(S.c);
  S.numb = clamp(S.c * 1.1);
  S.irrit = Math.max(0, S.irrit - dm / 500);
  S.feltBac = S.M.bac * (1 - 0.65 * clamp(S.c));
  S.ego = clamp(S.E * 0.95 + S.egoBoost * 0.25 - S.dark * 0.2);

  const L = S.lines.at(-1);
  if (L) { L.peak = Math.max(L.peak, Math.min(1, S.E)); L.hr = Math.max(L.hr, S.hr); }
  S.maxHr = Math.max(S.maxHr, S.hr);
  S.maxSys = Math.max(S.maxSys, S.sys);
  S.maxDia = Math.max(S.maxDia, S.dia);
  S.maxBac = Math.max(S.maxBac, S.M.bac);
  S.maxCe = Math.max(S.maxCe, S.M.ce);

  if (t - (S.samples.at(-1)?.t ?? -99) >= 2) {
    S.samples.push({ t, E: Math.min(100, S.E * 100), hr: S.hr, sys: S.sys, dia: S.dia, c: S.c * 100, ce: S.M.ce * 100 });
  }

  // the dealer arrives, late
  if (S.pendingBuy !== null && t >= S.pendingBuy) {
    S.pendingBuy = null;
    S.grams += REFILL_G;
    S.offerAt = t;
    thought("Er ist da. Nach 35 statt 20 Minuten. Egal.");
  }

  // thoughts that follow each extra line
  S.lines.forEach((l, i) => {
    if (i === 0) return;
    const tau = t - l.t;
    l.said = l.said || {};
    if (tau >= 2.5 && !l.said.kick) { l.said.kick = true; thought(pick(REDOSE.kick[Math.min(2, i - 1)])); }
    if (tau >= 12 && !l.said.peak) { l.said.peak = true; thought(S.E > 0.62 ? pick(REDOSE.peak) : pick(REDOSE.flat)); }
    if (tau >= 30 && !l.said.drop && S.lines.at(-1) === l) { l.said.drop = true; thought(pick(REDOSE.drop), "low"); }
  });

  if (S.silent) return;
  const w = S.warned;
  if (S.anx > 0.45 && t >= S.nextPara) {
    S.nextPara = t + 14 + Math.random() * 12;
    thought(pick(PARA), "para");
  }
  if (S.hr > 140 && (!w.hr || t - w.hr > 45)) {
    w.hr = t;
    toast(`Puls <b>${Math.round(S.hr)}</b>. Kokain treibt Herzfrequenz und Blutdruck hoch und verengt gleichzeitig die Herzkranzgefäße. Frische Luft senkt beides ein wenig. Nachlegen nicht.`, "", 6500);
  }
  if (S.sys > 168 && (!w.bp || t - w.bp > 60)) {
    w.bp = t;
    toast(`Blutdruck <b>${Math.round(S.sys)}/${Math.round(S.dia)}</b>. Plötzliche, starke Kopfschmerzen wären jetzt ein Notfall: Hirnblutungen gehören zu den seltenen, aber realen Kokain-Folgen.`, "red", 7000);
  }
  const strain = clamp((S.hr - 128) / 50) + 0.6 * S.M.ce * clamp(S.c);
  if (Math.random() < strain * dm * 0.18) {
    audio.skip();
    S.heartPh = 0; // premature beat now, compensatory pause after it
    S.pauseNext = true;
    S.skips++;
    if (!w.skip) {
      w.skip = t;
      thought("Mein Herz hat gerade gestolpert.", "alert red");
      toast("<b>Herzstolpern.</b> Brustschmerz, Engegefühl, Atemnot oder ein taubes Gefühl im Arm: In echt sofort <b>112</b>. In der Stunde nach Kokain ist das Herzinfarktrisiko stark erhöht, auch bei jungen Menschen.", "red", 8000);
    }
  }
  if (S.M.bac > 1 && S.feltBac < 0.5 && !w.drunk) {
    w.drunk = t;
    toast(`Echt: <b>${de(S.M.bac)} ‰</b>. Gefühlt: ${de(S.feltBac)} ‰. Kokain überdeckt die Trunkenheit, aber nicht ihre Folgen. Wenn es nachlässt, kommt alles auf einmal.`, "violet", 7000);
  }
}

function fastForward(target) {
  S.silent = true;
  while (S.t < target) {
    const dm = Math.min(0.5, target - S.t);
    S.t += dm;
    simulate(dm);
  }
  S.silent = false;
  S.thoughtIdx = THOUGHTS.findIndex((th) => th[0] >= S.t);
  if (S.thoughtIdx < 0) S.thoughtIdx = THOUGHTS.length;
  S.lines.forEach((l) => { l.said = { kick: true, peak: true, drop: true }; });
  S.offerAt = Math.max(S.offerAt, S.t);
  S.nextPara = S.t + 8;
  drawCurve();
}

/* =================================================================== render loop */

let last = performance.now();
let uiTick = 0;
let curveTick = 0;
const ecg = $("#ecg").getContext("2d");
const ecgBuf = new Array(180).fill(13);

function ecgShape(p) {
  if (p < 0.08) return -Math.sin((p / 0.08) * Math.PI) * 2;
  if (p < 0.14) return 0;
  if (p < 0.16) return 3;
  if (p < 0.19) return -11;
  if (p < 0.22) return 5;
  if (p < 0.34) return 0;
  if (p < 0.46) return -Math.sin(((p - 0.34) / 0.12) * Math.PI) * 3.5;
  return 0;
}

function frame(now) {
  requestAnimationFrame(frame);
  const frameMs = now - last;
  const dt = Math.min(0.1, frameMs / 1000);
  last = now;
  const time = now / 1000;

  if (document.body.classList.contains("phase-epilogue")) return;

  if (S.running && !S.paused) {
    const pi = PHASES.findIndex((p) => S.t >= p.from && S.t < p.to);
    if (pi !== -1 && pi !== S.phase) { S.phase = pi; onPhase(pi); }
    const P = PHASES[Math.max(0, S.phase)];
    // the highs in the spiral stretch out a little: that's where the time goes
    const rate = P.rate * (P.id === "spiral" ? 1 - 0.4 * clamp(S.E) : 1);
    const dm = dt * rate * S.speed;
    S.t += dm;
    simulate(dm);

    while (S.thoughtIdx < THOUGHTS.length && THOUGHTS[S.thoughtIdx][0] <= S.t) {
      const [, text, cond, cls] = THOUGHTS[S.thoughtIdx++];
      if (!cond || cond(S)) thought(typeof text === "function" ? text(S) : text, cls ?? undefined);
    }
    if (P.id === "spiral" && S.t >= S.offerAt && S.t < 240 && S.pendingBuy === null && S.consec < 2 && S.lines.length < 12) {
      if (S.E < 0.42 && S.t - (S.doses.at(-1)?.t ?? 0) > 22) openChoice();
    }
    if (S.t >= END) { endNight(); return; }
    if ((curveTick += dm) > 4) { curveTick = 0; drawCurve(); }
  }

  const bp = audio.beatPos() ?? (time * BPM) / 60;
  const beat = Math.exp(-((bp % 1 + 1) % 1) * 6);
  S.flash = Math.max(0, S.flash - dt * 1.6);

  // strobe on the high, a white-out after every line
  const barIdx = Math.floor(bp / 4);
  let flash = S.gentle ? 0 : S.flash * 0.8;
  if (!S.gentle && S.E > 0.8 && S.dark < 0.2 && barIdx % 8 === 0 && bp % 4 < 1) flash = Math.max(flash, bp % 0.25 < 0.07 ? 0.5 : 0);
  $("#flash").style.opacity = flash.toFixed(2);

  // the body: tremor on high levels, a jolt with every kick
  let jx = 0, jy = 0, rot = 0, sc = 1;
  if (S.running) {
    const g = S.gentle ? 0 : 1;
    const trem = clamp(S.c - 0.7) * 2.2 + S.anx * 0.8;
    jx = Math.sin(time * 67) * trem * g + Math.sin(time * 0.7) * S.dark * 4 * g;
    jy = Math.cos(time * 59) * trem * 0.7 * g;
    rot = Math.sin(time * 0.5) * S.dark * 0.6 * g;
    sc = 1 + (beat * S.E * 0.012 + S.kick * 0.05) * (S.gentle ? 0.3 : 1);
  }
  root.style.setProperty("--jx", jx.toFixed(2) + "px");
  root.style.setProperty("--jy", jy.toFixed(2) + "px");
  root.style.setProperty("--rot", rot.toFixed(3) + "deg");
  root.style.setProperty("--scale", sc.toFixed(4));

  S.heartHold = Math.max(0, S.heartHold - dt);
  if (S.heartHold <= 0) {
    S.heartPh += dt * (S.hr / 60);
    if (S.heartPh >= 1) {
      S.heartPh %= 1;
      if (S.pauseNext) { S.pauseNext = false; S.heartHold = 0.45; S.heartPh = 0.6; }
    }
  }
  const heart = Math.exp(-S.heartPh * 6);

  const sat = Math.max(0.1, 0.3 + 1.1 * S.E - 0.2 * S.dark);
  gl?.render({
    time, E: S.E, sat, beat, c: Math.min(1.5, S.c), kick: S.gentle ? S.kick * 0.3 : S.kick, anx: S.anx, dark: S.dark, air: S.air, heart,
    mx: mouse.x, my: mouse.y,
  }, frameMs);
  fx.update(S, dt, time, bp, beat);

  audio.set({
    E: S.E, c: S.c, dark: S.dark, air: S.air, anx: S.anx, hr: S.hr,
    music: S.t < 256 ? 1 : S.t < 282 ? 0.12 : 0,
    birds: sm((S.t - 262) / 30), room: sm((S.t - 280) / 8),
  });

  // heart icon + ECG
  $(".vicon.heart").style.transform = `scale(${1 + 0.35 * heart})`;
  for (let k = 0; k < 2; k++) {
    ecgBuf.shift();
    ecgBuf.push(13 + (S.heartHold > 0 ? 0 : ecgShape(S.heartPh)));
  }
  ecg.clearRect(0, 0, 180, 26);
  ecg.strokeStyle = S.hr > 130 ? "#ff3b4a" : "#bfe9ff";
  ecg.lineWidth = 1.5;
  ecg.beginPath();
  ecgBuf.forEach((v, i) => (i ? ecg.lineTo(i, v) : ecg.moveTo(i, v)));
  ecg.stroke();

  // zoom panel animation
  if (zoomKind === "journey") Art.updateJourney($("#zoomArt"), S.t);
  else if (zoomKind === "brain") Art.updateBrain($("#zoomArt"), time, S, beat);
  else if (synapse) {
    const low = zoomKind === "crash";
    synapse.draw(dt, time, { block: low ? clamp(S.c * 0.8) : clamp(S.c * 1.2), release: S.E, low: low && S.c < 0.4 });
  }

  // timeline cursor
  $("#tlCursor").setAttribute("x1", TX(S.t));
  $("#tlCursor").setAttribute("x2", TX(S.t));
  const dot = $("#tlDot");
  dot.style.left = (S.t / END) * 100 + "%";
  dot.style.top = (TY(S.E) / 60) * 100 + "%";
  dot.querySelector("span").style.display = S.t > END * 0.85 ? "none" : "";
  dot.classList.toggle("low", S.E < 0.5);

  if ((uiTick = (uiTick + 1) % 4) === 0) updateHud();
}

function vitalClass(id, warn, danger) {
  $(id).className = "vital" + (danger ? " danger" : warn ? " warn" : "");
}

function updateHud() {
  const clockMin = 30 + Math.floor(S.t);
  $("#clockTime").textContent = Art.clock(S.t);
  $("#clockDay").textContent = clockMin >= 1440 ? "MO" : "SO";
  $("#clockT").textContent = `T+${hm(S.t)}`;

  $("#hrVal").textContent = Math.round(S.hr);
  vitalClass("#vHr", S.hr > 120, S.hr > 150);

  $("#bpVal").textContent = `${Math.round(S.sys)}/${Math.round(S.dia)}`;
  $("#bpBar").style.width = clamp((S.sys - 100) / 90) * 100 + "%";
  $("#bpBar").style.background = S.sys < 145 ? "var(--ice)" : S.sys < 165 ? "var(--gold)" : "var(--red)";
  vitalClass("#vBp", S.sys > 145, S.sys > 168);

  const bleeding = S.bledAt !== null && S.t - S.bledAt < 50;
  $("#noseVal").textContent = bleeding ? "blutet" : S.numb > 0.55 ? "taub" : S.irrit > 0.4 ? "zu & wund" : S.irrit > 0.12 ? "läuft" : "frei";
  $("#noseBar").style.width = clamp(Math.max(S.numb * 0.6, S.irrit)) * 100 + "%";
  $("#noseBar").style.background = bleeding ? "var(--red)" : S.irrit > 0.45 ? "var(--gold)" : "var(--ice)";
  vitalClass("#vNose", S.irrit > 0.45, bleeding);

  $("#bacVal").textContent = de(S.M.bac);
  $("#bacFelt").textContent = S.c > 0.25 && S.M.bac > 0.15 ? `‰ · gefühlt ${de(S.feltBac)}` : "‰";
  $("#bacBar").style.width = clamp(S.M.bac / 1.6) * 100 + "%";
  $("#bacBar").style.background = S.M.ce > 0.15 ? "var(--violet)" : "var(--ice)";
  vitalClass("#vBac", S.M.bac > 0.8, S.M.bac > 1.3);

  $("#egoVal").textContent = Math.round(S.ego * 100);
  $("#egoBar").style.width = S.ego * 100 + "%";
  $("#craveVal").textContent = Math.round(S.craving * 100);
  $("#craveBar").style.width = S.craving * 100 + "%";
  vitalClass("#vCrave", S.craving > 0.55, false);

  // the bag
  const lvl = clamp(S.grams / 1);
  const top = 116 - lvl * 86;
  $("#bagFill").setAttribute("d", lvl > 0.005 ? `M13 ${top + 5} Q30 ${top - 5} 47 ${top + 5} V118 H13Z` : "");
  $("#bagVal").textContent = de(S.grams, 2) + " g";
  $("#moneyVal").textContent = S.money + " €";

  $("#pupil").setAttribute("r", (S.pupil * 1.75).toFixed(2));
  $("#pupilVal").textContent = de(S.pupil) + " mm";
  $("#veins").setAttribute("opacity", (0.1 * S.c + 0.75 * S.dark).toFixed(2));

  const pulse = 0.6 + 0.4 * Math.exp(-S.heartPh * 6);
  $("#zBrain").setAttribute("opacity", (S.E * 0.9).toFixed(2));
  $("#zNose").setAttribute("opacity", (S.numb * 0.9 * (bleeding ? 0 : 1)).toFixed(2));
  $("#zBleed").setAttribute("opacity", (bleeding ? 0.95 : S.irrit * 0.4).toFixed(2));
  $("#zHeart").setAttribute("opacity", (clamp((S.hr - 80) / 70) * pulse).toFixed(2));
  $("#zHandL").setAttribute("opacity", (clamp(S.c - 0.3) * 0.9).toFixed(2));
  $("#zHandR").setAttribute("opacity", (clamp(S.c - 0.3) * 0.9).toFixed(2));
  $("#zLiver").setAttribute("opacity", clamp(S.M.ce * 1.4).toFixed(2));
  $("#bodyLabel").textContent =
    S.t < 1.5 && S.c < 0.2 ? "Körper: nüchtern" :
    bleeding ? "Nasenbluten" :
    S.t < 3 ? "Nase und Zähne taub" :
    S.hr > 150 ? "Herz rast" :
    S.anx > 0.5 ? "Unruhig, verspannt" :
    S.M.ce > 0.3 ? "Leber: Kokaethylen" :
    S.t > 282 ? "Liegt wach" :
    S.c > 0.6 ? "Hellwach, Finger kalt" :
    S.dark > 0.5 ? "Leer, gereizt" :
    S.E > 0.5 ? "Unverwundbar" :
    S.c > 0.2 ? "Zappelig" : "Müde, aber wach";

  root.style.setProperty("--uisat", (0.55 + 0.7 * S.E - 0.4 * S.dark).toFixed(2));
  root.style.setProperty("--vig", (0.62 - 0.2 * S.E + 0.28 * S.dark + 0.25 * S.anx).toFixed(2));
  root.style.setProperty("--focus", clamp(0.35 * S.c + 0.8 * S.kick + 0.5 * S.anx).toFixed(2));
  root.style.setProperty("--grain", (0.05 + 0.16 * S.dark + 0.06 * S.anx).toFixed(3));
  root.style.setProperty("--air", S.air.toFixed(2));

  if (zoomKind === "spiral") Art.updateSpiral($("#zoomArt"), S.lines);

  document.querySelector('[data-act="air"]').classList.toggle("nudge", (S.hr > 135 || S.anx > 0.5) && S.air < 0.5);
}

requestAnimationFrame(frame);

/* =================================================================== epilogue */

function endNight() {
  S.running = false;
  document.body.className = "phase-epilogue";
  audio.set({ music: 0, rain: 1, birds: 0, room: 0, anx: 0, E: 0, dark: 1, hr: 70 });
  setTimeout(() => audio.sfx("sad"), 1200);
  rain.start();
  $("#epilogue").scrollTop = 0;
  buildEpilogue();
}

function buildEpilogue() {
  const n = S.lines.length;
  const used = S.doses.reduce((a, d) => a + d.amt * LINE_G, 0);
  $("#epiLede").textContent =
    n === 1 ? "Eine Line. Ein kurzes Hoch, eine lange Nacht ohne Schlaf. Aber immerhin nur eine."
    : n <= 3 ? `${n} Lines. Jede kürzer als die davor. Die Rechnung kommt jetzt.`
    : `${n} Lines, ${S.money} Euro, null Stunden Schlaf. Die Rechnung kommt jetzt, mit Zinsen.`;

  // ---- the days after ----
  const s0 = Math.round(100 - Math.min(72, 18 + n * 7 + (S.maxCe > 0.2 ? 8 : 0) + (S.bledAt !== null ? 4 : 0)));
  const rec = n >= 4 ? 9 : n >= 2 ? 12 : 22;
  const night = ["SA", "strobe", "Die Nacht.", "Party"];
  const days = n >= 4
    ? [night,
        ["SO", "moon", "Nicht geschlafen. Dann 14 Stunden am Stück.", "Crash"],
        ["MO", "storm", "Leer. Gereizt. Montag.", "Tief"],
        ["DI", "rain", "Alles grau. Kurz der Gedanke: ein bisschen würde helfen.", "Craving"],
        ["MI", "rain", "Zäh.", "Tief"],
        ["DO", "cloud", "Etwas besser.", "Erholung"],
        ["FR", "partly", "Marco schreibt: „Samstag?“", "Craving"]]
    : n >= 2
      ? [night,
          ["SO", "moon", "Bis neun wach gelegen. Dann Nebel.", "Crash"],
          ["MO", "rain", "Müde, gereizt, leer.", "Tief"],
          ["DI", "cloud", "Grundlos schlecht drauf. Ach ja.", "Tief"],
          ["MI", "partly", "Wird besser.", "Erholung"],
          ["DO", "partly", "Fast wieder du.", "Erholung"],
          ["FR", "sun", "Marco schreibt: „Samstag?“", "Normal"]]
      : [night,
          ["SO", "fog", "Schlecht geschlafen. Kopf wie Watte.", "Kater"],
          ["MO", "cloud", "Etwas leer.", "Tief"],
          ["DI", "partly", "Geht wieder.", "Erholung"],
          ["MI", "sun", "Wieder du.", "Normal"],
          ["DO", "sun", "Wieder du.", "Normal"],
          ["FR", "sun", "Die erste war die beste. Das bleibt so.", "Normal"]];
  const grid = $("#weekGrid");
  grid.innerHTML = "";
  days.forEach(([d, wx, mood, lab], i) => {
    const level = i === 0 ? 100 : Math.min(100, s0 + rec * (i - 1));
    const el = document.createElement("div");
    el.className = "day";
    el.innerHTML = `<span class="d-name">${d}</span>${Art.weather(wx)}<span class="d-mood">${mood}</span>
      <b class="d-pct">${i === 0 ? "100 → " + s0 : Math.round(level)} %</b><div class="d-bar"><i></i></div><span class="d-label">Antrieb · ${lab}</span>`;
    grid.appendChild(el);
    setTimeout(() => {
      el.classList.add("in");
      el.querySelector("i").style.height = level + "%";
    }, 900 + i * 260);
  });

  // ---- recap ----
  Art.peakChart($("#peaks"), S.lines);
  const COL = { line: "#ffc94a", drink: "#b86bff", air: "#4fa3ff", buy: "#ff3b4a", no: "#8fd08f" };
  const LAB = { line: "Line", drink: "Drink", air: "frische Luft", buy: "Nachschub", no: "abgelehnt" };
  const ev = S.events.filter((e) => COL[e.kind]).map((e) => ({ t: e.t, c: COL[e.kind], label: e.kind === "line" && e.amt > 1 ? "fette Line" : LAB[e.kind] }));
  const data = S.samples;
  const rg = $("#recapGrid");
  rg.innerHTML = "";
  const specs = [
    { title: "Euphorie", unit: " %", color: "#ffc94a", key: "E", min: 0, max: 100, fmt: (v) => Math.round(v) },
    { title: "Puls", unit: " bpm", color: "#ff5a6e", key: "hr", min: 60, max: 200, fmt: (v) => Math.round(v), band: [150, 200, "#ff3b4a"] },
    { title: "Blutdruck", unit: " mmHg", color: "#bfe9ff", key: "sys", key2: "dia", color2: "#4fa3ff", label: "systolisch", label2: "diastolisch", min: 60, max: 200, fmt: (v) => Math.round(v), band: [160, 200, "#ff3b4a"] },
    { title: "Im Blut (relativ)", unit: "", color: "#f4fbff", key: "c", key2: "ce", color2: "#b86bff", label: "Kokain (100 = eine Line)", label2: "Kokaethylen", min: 0, max: 200, fmt: (v) => Math.round(v) },
  ];
  specs.forEach((sp) => {
    const el = document.createElement("div");
    el.className = "chart";
    rg.appendChild(el);
    Art.lineChart(el, { ...sp, data, events: ev });
  });

  const first = S.lines[0]?.peak || 0, lastP = S.lines.at(-1)?.peak || 0;
  $("#verdict").innerHTML = `
    <div><b>${n} ${n === 1 ? "Line" : "Lines"} · ${de(used, 2)} g</b>${n === 1 ? "Eine Line, kein Nachlegen. Das Hoch war kurz, das Risiko auch vergleichsweise." : `Die erste brachte ${Math.round(first * 100)} % Hoch, die letzte ${Math.round(lastP * 100)} %. ${S.declines ? `${S.declines}× Nein gesagt.` : "Kein einziges Nein."}`}</div>
    <div><b>${S.money} €</b>${S.buys ? `Davon ${S.buys * REFILL_EUR} € für Nachschub um ${Art.clock(S.events.find((e) => e.kind === "buy").t)} Uhr.` : "Plus Taxi. Plus Sonntag."}</div>
    <div><b>${Math.round(S.maxHr)} bpm · ${Math.round(S.maxSys)}/${Math.round(S.maxDia)}</b>${S.maxHr > 150 ? `Puls und Blutdruck im roten Bereich${S.skips ? `, ${S.skips}× Herzstolpern` : ""}. Das ist die Zone, in der Infarkte passieren.` : S.maxHr > 120 ? "Deutlich erhöht. Für ein gesundes Herz meist verkraftbar, für ein unerkannt krankes nicht." : "Moderat. Eine Line macht keinen Marathon."}</div>
    <div><b>${de(S.maxBac)} ‰</b>${S.drinks === 0 ? "Kein Alkohol. Damit auch kein Kokaethylen." : S.maxCe > 0.2 ? `${S.drinks} Drinks, gefühlt kaum was. Die Leber hat Kokaethylen gebaut, das Herz hat es gemerkt.` : `${S.drinks} ${S.drinks === 1 ? "Drink" : "Drinks"}. Wenig Kokaethylen, aber: Kokain versteckt den Rausch.`}</div>
    <div><b>${S.talkMin} min Monolog</b>${S.talkMin ? "Über dich. Die Leute um dich herum haben irgendwann einfach weitergetanzt." : "Du hast zugehört. Auf Kokain eine seltene Gabe."}</div>`;

  // ---- phone ----
  const phone = $("#phone");
  const msgs = S.msgs;
  const wave = () => Array.from({ length: 22 }, () => `<i style="height:${3 + Math.random() * 15}px"></i>`).join("");
  let body = `<div class="ph-day">LETZTE NACHT, 00:30 – 06:30</div>`;
  msgs.forEach((m) => {
    body += m.voice
      ? `<div class="bubble me voice"><span class="play">▶</span><span class="wave">${wave()}</span><span class="dur">${Math.floor(m.dur / 60)}:${String(m.dur % 60).padStart(2, "0")}</span><span class="tx">An ${m.to}: „${m.tx}“</span><span class="meta">${Art.clock(m.t)} ✓✓</span></div>`
      : `<div class="bubble me">${m.tx}<span class="meta">An ${m.to} · ${Art.clock(m.t)} ✓✓</span></div>`;
  });
  if (msgs.length) {
    body += `<div class="ph-day">SONNTAG, 14:12</div>`;
    msgs.forEach((m, i) => (body += `<div class="bubble them"><b style="font-size:10.5px;color:#8fb8d8">${m.to}</b><br>${m.reply}<span class="meta">${14 + Math.floor(i / 3)}:${String(12 + ((i * 7) % 40)).padStart(2, "0")}</span></div>`));
  } else body += `<div class="bubble them">Keine neuen Nachrichten.<span class="meta">Sonntag, 14:12</span></div>`;
  phone.innerHTML = `<div class="ph-top"><span class="ph-avatar">ich</span><span class="ph-name">Gesendet<small>${msgs.length} ${msgs.length === 1 ? "Nachricht" : "Nachrichten"} letzte Nacht</small></span></div><div class="ph-body">${body}</div>`;
  phone.querySelectorAll(".bubble").forEach((b, i) => setTimeout(() => b.classList.add("in"), 1200 + i * 220));
  const talkSec = msgs.reduce((a, m) => a + m.dur, 0);
  $("#phoneNote").textContent = msgs.length
    ? `${msgs.length} ${msgs.length === 1 ? "Nachricht" : "Nachrichten"}, davon ${Math.floor(talkSec / 60)} Minuten Sprachnachricht. Kokain macht nicht klüger, nur lauter: Das Stirnhirn, das sonst „lieber nicht“ sagt, ist leiser gestellt. Die Antworten kommen trotzdem, nüchtern.`
    : "Das Handy blieb in der Tasche. Grandiose Ideen bleiben so, wo sie hingehören: im Club. Probier ruhig mal den Handy-Knopf, wenn du nochmal durchläufst.";

  document.querySelectorAll(".chem-art").forEach((el) => (el.innerHTML = Art.chemArt(el.dataset.art)));
}
