import { createGL } from "./gl.js";
import { AudioEngine, BPM } from "./audio.js";
import { Fx, Rain } from "./fx.js";
import * as Art from "./art.js";

const $ = (s) => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const gauss = (t, mu, w) => Math.exp(-(((t - mu) / w) ** 2));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const de = (v, d = 1) => v.toFixed(d).replace(".", ",");

/* =================================================================== script */

const END = 420; // simulated minutes: 23:30 → 06:30

const PHASES = [
  { id: "wait", from: 0, to: 30, rate: 1.15, act: "AKT I", name: "Das Warten", sub: "Eingeworfen. Und jetzt: warten.", accent: "#9a9ab4", zoom: "journey" },
  { id: "comeup", from: 30, to: 80, rate: 1.2, act: "AKT II", name: "Come-up", sub: "Irgendwas kribbelt.", accent: "#8a5cff", zoom: "synapse" },
  { id: "peak", from: 80, to: 180, rate: 1.05, act: "AKT III", name: "Peak", sub: "Alles. Ist. Perfekt.", accent: "#ff3fb4", zoom: "brain" },
  { id: "plateau", from: 180, to: 240, rate: 1.6, act: "AKT IV", name: "Plateau", sub: "Tiefe Gespräche mit Fremden.", accent: "#3ff0ff", zoom: "talk" },
  { id: "comedown", from: 240, to: END, rate: 3.6, act: "AKT V", name: "Comedown", sub: "Das Licht wird grell.", accent: "#7a8098", zoom: "depleted" },
];

const ZOOM = {
  journey: {
    title: "Der Weg der Pille",
    text: "Die Pille löst sich im Magen auf. Nach <b>20–60 Minuten</b> ist MDMA im Blut und passiert die Blut-Hirn-Schranke. Genau hier legen Ungeduldige nach, eine der häufigsten Überdosis-Fallen.",
  },
  synapse: {
    title: "Die Schleusen öffnen sich",
    text: '<span class="legend"><i style="color:#ffd23f">●</i> Serotonin <i style="color:#ff3fb4">◆</i> MDMA</span>MDMA dreht den <b>Serotonin-Transporter (SERT)</b> um. Statt Serotonin zurückzuholen, pumpt er es in den Spalt. Dazu Noradrenalin und Dopamin: Herzklopfen, Kribbeln, flauer Magen.',
  },
  brain: {
    title: "Dein Gehirn gerade",
    text: "Serotonin flutet die Rezeptoren. Der Hypothalamus schüttet <b>Oxytocin</b> aus, die Amygdala wird leiser. Ergebnis: Nähe, Offenheit, Euphorie. Gleichzeitig steigen <b>Puls und Körpertemperatur</b>.",
  },
  talk: {
    title: "Oxytocin-Modus",
    text: "Die Euphorie flacht ab, die Wärme bleibt. Jedes Gespräch fühlt sich bedeutend an. Das Gefühl ist echt. Die lebenslange Freundschaft mit Kevin vielleicht weniger.",
  },
  depleted: {
    title: "Leere Speicher",
    text: '<span class="legend"><i style="color:#ffd23f">●</i> Serotonin <i style="color:#ff3fb4">◆</i> MDMA</span>Die Vesikel sind leer. Neues Serotonin muss erst aus Tryptophan gebaut werden, und das Enzym dafür ist gerade <b>gehemmt</b>. Mehr MDMA kann nichts ausschütten, was nicht da ist.',
  },
};

// [sim minute, text, condition?]
const THOUGHTS = [
  [1, "Okay. Runter damit."],
  [5, "Schmeckt wie Waschpulver mit Bitterstoff."],
  [10, "Die Schlange am Klo ist länger als die am Einlass."],
  [15, "Merk nix."],
  [20, "Merk. Immer. Noch. Nix. Fake-Pille?"],
  [25, "Nicht nachlegen. Einfach warten. Geduld, Kollege."],
  [32, "Moment. Warum sind meine Hände so warm?"],
  [38, "Mir ist kurz ein bisschen übel …"],
  [44, "Mein Herz klopft. Ist das normal? Ist das normal?!"],
  [50, "Wellen. Da kommen Wellen. Vom Nacken aus."],
  [57, "Oh. Oh oh oh. OH."],
  [64, "Der Bass geht direkt in die Wirbelsäule."],
  [71, "Ich muss mich bewegen. JETZT."],
  [82, "ALLES. IST. PERFEKT."],
  [90, "Ich liebe diesen Track. Ich liebe DICH. Wer bist du eigentlich?"],
  [99, "Deine Jacke ist so weich. Darf ich die kurz anfassen? Nur kurz."],
  [108, "Warum reden Menschen nicht öfter so ehrlich miteinander?"],
  [117, "Die Lichter haben Geschmack. Pink schmeckt nach Erdbeere."],
  [126, "Ich schreib meiner Ex, dass ich ihr alles verzeihe. – Nein. Handy weg."],
  [136, "Wir sollten alle zusammen in den Urlaub fahren. Alle 400."],
  [146, "Mein Kiefer kaut übrigens Kaugummi. Ohne Kaugummi."],
  [158, "Der DJ ist ein Gott. Die Klofrau ist eine Göttin."],
  [170, "Ich hab noch nie so gut getanzt. (Doch. Sah genauso aus.)"],
  [184, "Hab grad 40 Minuten mit Kevin über seine Oma geredet. Tolle Frau."],
  [196, "Wasser ist das beste Getränk der Welt. Eiskalt. Wahnsinn."],
  [207, "Wir haben uns alle so lieb. Das bleibt jetzt so, oder?"],
  [220, "Irgendwie … ist es leiser geworden. Oder bin das ich?"],
  [232, "Ich sollte mehr fühlen. Mehr als jetzt. Hm."],
  [248, "Warum ist das Licht plötzlich so grell?"],
  [263, "Hm. Kommt nicht richtig. Nur … zittrig.", (S) => S.redose],
  [263, "Gut, dass ich nicht nachgelegt hab. Glaub ich.", (S) => !S.redose],
  [278, "Die Musik klingt wie Presslufthammer auf Blech."],
  [292, "Kevin ist weg. Wer war Kevin?"],
  [305, "Warum ist mir so heiß und trotzdem nicht schön?", (S) => S.redose],
  [312, "Ich will ins Bett. Mein Körper will ins Bett. Mein Kopf nicht."],
  [330, "Draußen wird’s hell. Die Vögel klingen verurteilend."],
  [348, "Kiefer tut weh. Zunge zerbissen."],
  [364, "Taxi. 38 Euro. Egal."],
  [384, "Im Bett. Augen zu. Herz sagt: nö."],
  [404, "Um 11 aufstehen oder um 16? Tja."],
];

const HUG_LINES = [
  "Das ist die beste Umarmung meines Lebens.",
  "Wir kennen uns nicht, aber: Ich kenn dich.",
  "Du riechst nach Zuhause. Und nach Nebelmaschine.",
  "Ich lass dich nie wieder los. (Lässt nach 4 Sekunden los.)",
  "Wir sind jetzt Familie. Wie heißt du?",
];

/* =================================================================== pharmacology (heavily simplified) */

function baseEuph(t) {
  if (t < 22) return 0;
  if (t < 85) return sm((t - 22) / 63);
  if (t < 165) return 1;
  if (t < 240) return 1 - 0.3 * sm((t - 165) / 75);
  return 0.7 * (1 - sm((t - 240) / 150));
}
function baseStim(t) {
  if (t < 25) return 0;
  if (t < 80) return sm((t - 25) / 55);
  if (t < 210) return 1;
  return 1 - 0.72 * sm((t - 210) / 210);
}
function euphAt(t, redose) {
  return clamp(baseEuph(t) + (redose ? 0.2 * gauss(t, 305, 35) : 0), 0, 1.1);
}

/* =================================================================== state */

const S = {
  t: 0, running: false, paused: false, speed: 1, gentle: false,
  E: 0, stim: 0, nausea: 0, anxiety: 0, dark: 0, rush: 0, tingle: 0, heat: 0, chill: 0, leave: 0,
  temp: 36.8, hydration: 70, hr: 72, pupil: 3, jaw: 0, sero: 100, love: 0, dance: 0.5,
  chillUntil: -1, gumRelief: 0, hugBoost: 0, redose: null,
  drinks: [], events: [], samples: [], hugs: 0, chills: 0, maxTemp: 36.8, minHyd: 70, maxHyd: 70,
  phase: -1, thoughtIdx: 0, warned: {}, nyst: 0, nystNext: 8, heartPh: 0,
};

/* =================================================================== setup */

const audio = new AudioEngine();
const gl = createGL($("#gl"));
if (!gl) $("#gl").style.background = "radial-gradient(circle at 50% 40%, #2a1640, #07060b 70%)";
const fx = new Fx($("#fx"), $("#crowd"));
const rain = new Rain($("#rain"));
const root = document.documentElement;
const mouse = { x: 0.5, y: 0.5 };

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
$("#optGentle").checked = reduce;

/* ---------- timeline graph ---------- */
function buildTimeline() {
  const ph = $("#tlPhases");
  const labels = $("#tlLabels");
  ph.innerHTML = "";
  labels.innerHTML = "";
  PHASES.forEach((p, i) => {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", (p.from / END) * 1000);
    r.setAttribute("width", ((p.to - p.from) / END) * 1000);
    r.setAttribute("y", 0);
    r.setAttribute("height", 60);
    if (i % 2) r.classList.add("alt");
    ph.appendChild(r);
    const l = document.createElement("span");
    l.style.left = (p.from / END) * 100 + "%";
    l.textContent = p.name;
    labels.appendChild(l);
  });
  drawCurve();
}
function curvePath(redose, area) {
  let d = "";
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * END;
    const y = 56 - euphAt(t, redose) * 46;
    d += (i ? "L" : "M") + ((t / END) * 1000).toFixed(1) + " " + y.toFixed(1) + " ";
  }
  return area ? d + "L1000 60 L0 60 Z" : d;
}
function drawCurve() {
  $("#tlLine").setAttribute("d", curvePath(false));
  $("#tlArea").setAttribute("d", curvePath(false, true));
  if (S.redose) {
    $("#tlRedose").setAttribute("d", curvePath(true));
    $("#tlRedose").setAttribute("opacity", 1);
  }
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

/* =================================================================== intro: the pill */

const pill = $("#pill");
const mouth = $("#mouth");
let drag = null;

function mouthCenter() {
  const r = mouth.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
pill.addEventListener("pointerdown", (e) => {
  if (S.running) return;
  drag = { x0: e.clientX, y0: e.clientY, moved: 0 };
  pill.setPointerCapture(e.pointerId);
  pill.classList.add("dragging");
});
pill.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  pill.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.2}deg)`;
  const pr = pill.getBoundingClientRect();
  const m = mouthCenter();
  const near = Math.hypot(pr.left + pr.width / 2 - m.x, pr.top + pr.height / 2 - m.y) < 110;
  mouth.classList.toggle("open", near);
  drag.near = near;
});
pill.addEventListener("pointerup", () => {
  if (!drag) return;
  const ok = drag.near || drag.moved < 8;
  drag = null;
  pill.classList.remove("dragging");
  if (ok) swallow();
  else {
    pill.style.transition = "transform .5s cubic-bezier(.3,1.6,.5,1)";
    pill.style.transform = "";
    setTimeout(() => (pill.style.transition = ""), 500);
    mouth.classList.remove("open");
  }
});
pill.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); swallow(); }
});
pill.addEventListener("click", (e) => e.preventDefault());

function swallow() {
  if (S.running) return;
  S.running = true;
  S.gentle = $("#optGentle").checked;
  audio.enabled = $("#optSound").checked;
  audio.start();
  audio.setEnabled(audio.enabled);
  $("#soundBtn").classList.toggle("off", !audio.enabled);
  mouth.classList.add("open");
  const pr = pill.getBoundingClientRect();
  const m = mouthCenter();
  pill.classList.add("swallowed");
  pill.style.transform = `translate(${m.x - (pr.left + pr.width / 2)}px, ${m.y - (pr.top + pr.height / 2)}px) scale(.15) rotate(200deg)`;
  setTimeout(() => {
    mouth.classList.remove("open");
    audio.sfx("gulp");
  }, 650);
  setTimeout(() => {
    document.body.classList.remove("phase-intro");
    last = performance.now();
  }, 1100);
  if (innerWidth < 860) $("#zoom").classList.add("collapsed");
}

/* =================================================================== UI helpers */

function thought(text, cls = "") {
  const box = $("#thoughts");
  while (box.children.length >= 2) box.firstChild.remove();
  const el = document.createElement("div");
  el.className = "thought " + cls;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 6600);
}

let toastTimer;
function toast(html, cls = "", ms = 5200) {
  const el = $("#toast");
  el.className = cls;
  el.innerHTML = html;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function showCard(p) {
  const c = $("#card");
  $("#cardAct").textContent = p.act;
  $("#cardName").textContent = p.name;
  $("#cardSub").textContent = p.sub;
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
  else if (kind === "talk") art.innerHTML = Art.talkSVG();
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
  showCard(p);
  setZoom(p.zoom);
  if (p.id === "peak") audio.riser(0.1);
  if (p.id === "comeup") setTimeout(() => audio.riser(9), 800);
}

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
  water(btn) {
    S.hydration = Math.min(125, S.hydration + 22);
    S.drinks.push(S.t);
    S.events.push({ t: S.t, kind: "water" });
    audio.sfx("water");
    const lastHour = S.drinks.filter((d) => S.t - d < 60).length;
    if (S.hydration > 100) {
      toast("<b>Stopp.</b> Zu viel Wasser ist mit MDMA gefährlich: Der Körper hält Flüssigkeit zurück, der Natriumspiegel kippt (<b>Hyponatriämie</b>).", "red", 7000);
      thought("Mein Bauch schwappt.", "alert red");
    } else if (lastHour >= 3) {
      toast("Langsam. Etwa <b>0,5 L pro Stunde</b> beim Tanzen reicht, also 1–2 Becher. Mehr ist nicht besser.", "blue", 6000);
    } else {
      thought(S.E > 0.5 ? pick(["Wasser. WASSER. Das beste Getränk der Welt.", "Eiskalt. Ich spür jeden Tropfen.", "Schluck für Schluck. Wie im Werbespot."]) : "Schluck Wasser. Gut.");
    }
    cooldown(btn, 5);
  },
  chill(btn) {
    S.chillUntil = S.t + 25;
    S.chills++;
    S.events.push({ t: S.t, kind: "chill" });
    audio.sfx("chill");
    thought(S.E > 0.5 ? "Chill-out-Area. Sofas. Alle hier sind so weich." : "Kurz raus aus der Hitze. Sitzen. Atmen.");
    cooldown(btn, 25 / (PHASES[S.phase]?.rate || 1) / S.speed);
  },
  gum(btn) {
    S.gumRelief = 1;
    audio.sfx("gum");
    thought(S.jaw > 0.4 ? "Endlich was zu tun für den Kiefer." : "Kaugummi. Man weiß ja nie.");
    cooldown(btn, 10);
  },
  hug(btn) {
    if (S.E < 0.3) {
      thought(S.phase >= 4 ? "Umarmung fühlt sich an wie … eine Umarmung. Normal. Leider." : "Noch nicht so kuschelig. Später.");
      cooldown(btn, 3);
      return;
    }
    S.hugBoost = 1;
    S.hugs++;
    fx.startHug();
    fx.burst(innerWidth / 2, innerHeight * 0.55);
    audio.sfx("hug");
    thought(pick(HUG_LINES));
    cooldown(btn, 4);
  },
};
document.querySelectorAll(".act").forEach((b) => b.addEventListener("click", () => ACTIONS[b.dataset.act](b)));

/* ---------- choice ---------- */
function decide(yes) {
  S.redose = yes;
  $("#choice").classList.remove("show");
  S.paused = false;
  last = performance.now();
  if (yes) {
    S.events.push({ t: S.t, kind: "redose" });
    audio.sfx("gulp");
    thought("Okay, noch ’ne Halbe. Das wird jetzt wieder wie vorhin. Oder?");
  } else {
    thought("Nee. Die Nacht war schön. Das reicht.");
  }
  drawCurve();
}
$("#choiceYes").addEventListener("click", () => decide(true));
$("#choiceNo").addEventListener("click", () => decide(false));

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
  if (!p) return;
  if (p.id === "plateau" && S.redose === null) S.t = 239.9;
  else S.t = p.to + 0.01;
  S.thoughtIdx = THOUGHTS.findIndex((th) => th[0] >= S.t);
  if (S.thoughtIdx < 0) S.thoughtIdx = THOUGHTS.length;
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
  if (S.E > 0.4) {
    fx.burst(e.clientX + 24, e.clientY + 24, "love");
    S.hugBoost = Math.max(S.hugBoost, 0.4);
  } else if (S.E > 0.1) fx.burst(e.clientX + 24, e.clientY + 24, "spark");
});
document.addEventListener("visibilitychange", () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else if (audio.enabled) audio.ctx.resume();
});

/* =================================================================== simulation */

function simulate(dm) {
  const t = S.t;
  const R = !!S.redose;
  S.E = clamp(euphAt(t, R) + S.hugBoost * 0.08, 0, 1.1);
  let stim = baseStim(t);
  if (R) stim += 0.35 * sm((t - 250) / 40) * (1 - sm((t - 380) / 60));
  S.stim = stim;
  S.nausea = 0.85 * gauss(t, 52, 13);
  S.anxiety = 0.75 * gauss(t, 45, 12) + (R ? 0.3 * gauss(t, 300, 40) : 0);
  S.tingle = 0.9 * gauss(t, 55, 20) + S.E * 0.12;
  S.dark = sm((t - 265) / 130) * (R ? 1 : 0.85);
  S.rush = gauss(t, 77, 3.2);
  const chillTarget = t < S.chillUntil ? 1 : 0;
  S.chill += (chillTarget - S.chill) * Math.min(1, dm * 0.4);
  S.dance = (S.chill > 0.5 ? 0.2 : t < 25 ? 0.45 : 1) * (1 - S.dark * 0.5);

  // body temperature relaxes towards a dance/drug dependent set point
  const hydrated = S.hydration > 40;
  const setOff = (0.15 + 1.35 * stim * S.dance) * (hydrated ? 0.82 : 1.15);
  S.temp += (36.8 + setOff - S.temp) * 0.035 * dm;
  S.hydration = clamp(S.hydration - (0.1 + 0.45 * stim * S.dance) * dm, 0, 125);
  S.hr = 72 + 36 * stim + 18 * stim * S.dance + 14 * S.anxiety + (S.temp - 36.8) * 8 + 22 * gauss(t, 395, 18);
  S.pupil = 3 + 4.3 * Math.min(1, stim);
  S.gumRelief = Math.max(0, S.gumRelief - dm / 40);
  S.hugBoost = Math.max(0, S.hugBoost - dm / 15);
  S.jaw = clamp(stim * 0.9 + (R ? 0.15 : 0) - S.gumRelief * 0.55);
  S.love = clamp(S.E * 0.95 + S.hugBoost * 0.3);
  S.sero = 100 - 66 * sm((t - 35) / 150) - (R ? 14 * sm((t - 260) / 90) : 0);
  S.heat = clamp((S.temp - 37.9) / 0.7);
  S.leave = sm((t - 250) / 170);
  S.maxTemp = Math.max(S.maxTemp, S.temp);
  S.minHyd = Math.min(S.minHyd, S.hydration);
  S.maxHyd = Math.max(S.maxHyd, S.hydration);

  if (t - (S.samples.at(-1)?.t ?? -99) >= 3) {
    S.samples.push({ t, E: Math.min(100, S.E * 100), sero: S.sero, temp: S.temp, hr: S.hr });
  }

  // reactive body warnings
  const w = S.warned;
  if (S.temp > 38.2 && S.chill < 0.5 && (!w.hot || t - w.hot > 25)) {
    w.hot = t;
    thought("Mir ist heiß. Richtig heiß.", "alert");
    toast(`Körpertemperatur <b>${de(S.temp)} °C</b>. Pause in der Chill-out-Area und ein Becher Wasser. In echt ist Überhitzung die gefährlichste akute MDMA-Nebenwirkung.`, "", 6500);
  }
  if (S.temp > 38.6 && (!w.veryhot || t - w.veryhot > 30)) {
    w.veryhot = t;
    toast("<b>Überhitzung.</b> Kopfschmerz, Verwirrung, kein Schweiß mehr: In der echten Welt ist das ein Fall für die <b>112</b>.", "red", 7000);
  }
  if (S.hydration < 22 && (!w.dry || t - w.dry > 30)) {
    w.dry = t;
    thought("Mund trocken wie Schmirgelpapier.", "alert");
  }
  if (S.stim > 0.8 && !w.nyst && S.nyst > 0) {
    w.nyst = t;
    thought("Meine Augen zittern. Das Bild wackelt. Lustig. Glaub ich.");
  }
}

/* =================================================================== render loop */

let last = performance.now();
let uiTick = 0;
let tankPhase = 0;
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
  const rawDt = Math.min(0.1, (now - last) / 1000);
  const frameMs = now - last;
  last = now;
  const dt = Math.min(0.1, rawDt);
  const time = now / 1000;

  if (document.body.classList.contains("phase-epilogue")) return;

  if (S.running && !S.paused) {
    const pi = PHASES.findIndex((p) => S.t >= p.from && S.t < p.to);
    if (pi !== -1 && pi !== S.phase) { S.phase = pi; onPhase(pi); }
    const rate = PHASES[Math.max(0, S.phase)].rate;
    const dm = dt * rate * S.speed;
    S.t += dm;
    simulate(dm);

    while (S.thoughtIdx < THOUGHTS.length && THOUGHTS[S.thoughtIdx][0] <= S.t) {
      const [, text, cond] = THOUGHTS[S.thoughtIdx++];
      if (!cond || cond(S)) thought(text);
    }
    if (S.t >= 240 && S.redose === null) {
      S.paused = true;
      $("#choice").classList.add("show");
      $("#choiceNo").focus();
    }
    if (S.t >= END) { endNight(); return; }

    // nystagmus episodes
    S.nystNext -= dt;
    if (S.stim > 0.75 && S.nystNext <= 0) { S.nyst = 1.3; S.nystNext = 9 + Math.random() * 10; }
    S.nyst = Math.max(0, S.nyst - dt);
  }

  // beat clock (audio-locked when possible)
  const bp = audio.beatPos() ?? (time * BPM) / 60;
  const beat = Math.exp(-((bp % 1 + 1) % 1) * 5);

  // strobe at the top of every 8 bars during the peak
  const barIdx = Math.floor(bp / 4);
  if (!S.gentle && S.E > 0.85 && S.dark < 0.2 && barIdx % 8 === 0 && bp % 4 < 1) {
    $("#flash").style.opacity = (bp % 0.5 < 0.12 ? 0.45 : 0).toString();
  } else $("#flash").style.opacity = (S.gentle ? 0 : S.rush * 0.5).toString();

  // stage body sensations
  let jx = 0, jy = 0, rot = 0, sc = 1;
  if (S.running) {
    const g = S.gentle ? 0.15 : 1;
    rot = Math.sin(time * 0.9) * S.nausea * 1.6 * g;
    jx = Math.sin(time * 1.3) * S.nausea * 10 * g;
    jy = Math.cos(time * 1.1) * S.nausea * 6 * g;
    if (!S.gentle && S.nyst > 0) jx += Math.sin(time * 75) * 3.5 * Math.min(1, S.nyst);
    sc = 1 + (beat * S.E * 0.012 + S.rush * 0.05) * (S.gentle ? 0.3 : 1);
  }
  root.style.setProperty("--jx", jx.toFixed(2) + "px");
  root.style.setProperty("--jy", jy.toFixed(2) + "px");
  root.style.setProperty("--rot", rot.toFixed(3) + "deg");
  root.style.setProperty("--scale", sc.toFixed(4));

  const sat = Math.max(0.12, 0.32 + 1.25 * S.E + 0.1 * S.nausea - 0.15 * S.dark);
  gl?.render({
    time, E: S.E, sat, beat, nausea: S.nausea, dark: S.dark, chill: S.chill, heat: S.heat, rush: S.gentle ? S.rush * 0.3 : S.rush,
    stim: S.stim, mx: mouse.x, my: mouse.y,
  }, frameMs);
  fx.update(S, dt, time, bp, beat);

  audio.set({
    E: S.E, stim: S.stim, dark: S.dark, chill: S.chill, anxiety: S.anxiety, hr: S.hr,
    end: gauss(S.t, 395, 18), tinnitus: sm((S.t - 330) / 60) * 0.8, music: 1 - sm((S.t - 380) / 40) * 0.85,
  });

  // heart icon + ECG every frame
  S.heartPh = (S.heartPh + dt * (S.hr / 60)) % 1;
  $(".vicon.heart").style.transform = `scale(${1 + 0.35 * Math.exp(-S.heartPh * 8)})`;
  for (let k = 0; k < 2; k++) {
    ecgBuf.shift();
    ecgBuf.push(13 + ecgShape(S.heartPh));
  }
  ecg.clearRect(0, 0, 180, 26);
  ecg.strokeStyle = S.hr > 125 ? "#ff4d5e" : "#3ff0ff";
  ecg.lineWidth = 1.5;
  ecg.beginPath();
  ecgBuf.forEach((v, i) => (i ? ecg.lineTo(i, v) : ecg.moveTo(i, v)));
  ecg.stroke();

  // zoom panel animation
  if (zoomKind === "journey") Art.updateJourney($("#zoomArt"), S.t);
  else if (zoomKind === "brain") Art.updateBrain($("#zoomArt"), time, S.E, beat);
  else if (zoomKind === "talk") Art.updateTalk($("#zoomArt"), time, S.E);
  else if (synapse) {
    const depl = zoomKind === "depleted";
    synapse.draw(dt, time, {
      release: depl ? 0.1 + S.E * 0.3 : clamp((S.t - 28) / 40),
      store: S.sero / 100,
      reversed: S.stim > 0.15,
    });
  }

  // tank wave
  tankPhase += dt * (1 + S.E * 3);
  const lvl = 12 + 108 * (1 - S.sero / 100);
  let wave = `M10 ${lvl} `;
  for (let x = 10; x <= 50; x += 2) wave += `L${x} ${lvl + Math.sin(x * 0.35 + tankPhase * 3) * 2.2} `;
  $("#tankWave").setAttribute("d", wave + `L50 ${lvl + 6} L10 ${lvl + 6}Z`);
  $("#tankFill").setAttribute("y", lvl);

  // timeline cursor
  const tx = (S.t / END) * 1000;
  $("#tlCursor").setAttribute("x1", tx);
  $("#tlCursor").setAttribute("x2", tx);
  const dot = $("#tlDot");
  dot.style.left = (S.t / END) * 100 + "%";
  dot.style.top = ((56 - euphAt(S.t, !!S.redose) * 46) / 60) * 100 + "%";
  dot.querySelector("span").style.display = S.t > END * 0.85 ? "none" : "";
  dot.classList.toggle("low", euphAt(S.t, !!S.redose) < 0.5);

  // throttled DOM text
  if ((uiTick = (uiTick + 1) % 4) === 0) updateHud();
}

function updateHud() {
  const clockMin = 23 * 60 + 30 + Math.floor(S.t);
  $("#clockDay").textContent = clockMin >= 1440 ? "SO" : "SA";
  const m = clockMin % 1440;
  $("#clockTime").textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  $("#clockT").textContent = `T+${Math.floor(S.t / 60)}:${String(Math.floor(S.t % 60)).padStart(2, "0")}`;

  $("#hrVal").textContent = Math.round(S.hr);
  $("#tempVal").textContent = de(S.temp);
  $("#tempBar").style.width = clamp((S.temp - 36) / 3) * 100 + "%";
  $("#tempBar").style.background = S.temp < 37.8 ? "var(--cyan)" : S.temp < 38.3 ? "var(--yellow)" : "var(--red)";
  $("#vTemp").className = "vital" + (S.temp >= 38.5 ? " danger" : S.temp >= 38 ? " warn" : "");

  $("#waterBar").style.width = clamp(S.hydration / 100) * 100 + "%";
  $("#waterBar").style.background = S.hydration > 100 ? "var(--red)" : S.hydration < 25 ? "var(--yellow)" : "var(--cyan)";
  $("#waterVal").textContent = S.hydration > 100 ? "zu viel!" : S.hydration < 25 ? "durstig" : S.hydration < 45 ? "geht so" : "OK";
  $("#vWater").className = "vital" + (S.hydration > 100 ? " danger" : S.hydration < 25 ? " warn" : "");

  $("#jawBar").style.width = S.jaw * 100 + "%";
  $("#jawBar").style.background = S.jaw > 0.7 ? "var(--yellow)" : "var(--cyan)";
  $("#jawVal").textContent = S.jaw < 0.2 ? "locker" : S.jaw < 0.5 ? "mahlt" : S.jaw < 0.8 ? "Kaugummi-Modus" : "Schraubstock";

  $("#loveVal").textContent = Math.round(S.love * 100);
  $("#loveBar").style.width = S.love * 100 + "%";
  $("#seroVal").textContent = Math.round(S.sero) + "%";

  $("#pupil").setAttribute("r", (S.pupil * 1.75).toFixed(2));
  $("#pupilVal").textContent = de(S.pupil) + " mm";
  $("#veins").setAttribute("opacity", (0.15 * S.stim + 0.7 * S.dark).toFixed(2));

  const pulse = 0.6 + 0.4 * Math.exp(-S.heartPh * 6);
  $("#zBrain").setAttribute("opacity", (S.E * 0.9).toFixed(2));
  $("#zJaw").setAttribute("opacity", (S.jaw * 0.9).toFixed(2));
  $("#zHeart").setAttribute("opacity", (clamp((S.hr - 75) / 55) * pulse).toFixed(2));
  $("#zGut").setAttribute("opacity", (S.nausea).toFixed(2));
  $("#zHandL").setAttribute("opacity", (S.tingle * 0.9).toFixed(2));
  $("#zHandR").setAttribute("opacity", (S.tingle * 0.9).toFixed(2));
  $("#zSkin").setAttribute("opacity", (S.E * 0.8 * (1 - S.dark)).toFixed(2));
  const label =
    S.t < 25 ? "Körper: nüchtern" :
    S.nausea > 0.5 ? "Magen flau" :
    S.tingle > 0.6 ? "Kribbeln in den Händen" :
    S.heat > 0.4 ? "Überhitzt" :
    S.dark > 0.5 ? "Körper müde, Kopf wach" :
    S.jaw > 0.8 ? "Kiefer mahlt" :
    S.E > 0.7 ? "Alles fühlt sich an wie Samt" : "Leicht zittrig";
  $("#bodyLabel").textContent = label;

  root.style.setProperty("--uisat", (0.5 + 0.8 * S.E - 0.35 * S.dark).toFixed(2));
  root.style.setProperty("--vig", (0.75 - 0.35 * S.E + 0.25 * S.dark + 0.2 * S.heat).toFixed(2));
  root.style.setProperty("--grain", (0.05 + 0.14 * S.dark + 0.04 * (1 - S.E)).toFixed(3));
  root.style.setProperty("--chill", S.chill.toFixed(2));

  // nudge the right buttons
  document.querySelector('[data-act="water"]').classList.toggle("nudge", S.hydration < 30);
  document.querySelector('[data-act="chill"]').classList.toggle("nudge", S.temp > 38.2 && S.chill < 0.5);
  document.querySelector('[data-act="gum"]').classList.toggle("nudge", S.jaw > 0.85 && S.gumRelief < 0.1);
}

requestAnimationFrame(frame);

/* =================================================================== epilogue */

function endNight() {
  S.running = false;
  document.body.className = "phase-epilogue";
  audio.set({ music: 0, rain: 1, tinnitus: 0, end: 0, anxiety: 0, E: 0, dark: 1 });
  setTimeout(() => audio.sfx("sad"), 1200);
  rain.start();
  $("#epilogue").scrollTop = 0;
  buildEpilogue();
}

function buildEpilogue() {
  const R = !!S.redose;
  $("#epiLede").textContent = R
    ? "Die halbe Pille um vier hat die Nacht nicht verlängert. Sie hat nur den Dienstag vorverlegt, auf Sonntag."
    : "Die Nacht ist vorbei. Dein Serotonin-Speicher ist es noch lange nicht.";

  // ---- week ----
  const s0 = S.sero;
  const rec = R ? 9 : 12;
  const days = R
    ? [
        ["SA", "disco", "Die Nacht", "Party"],
        ["SO", "cloud", "Kein Afterglow. Nur Kater.", "Kater"],
        ["MO", "rain", "Zäh. Alles zäh.", "Tief"],
        ["DI", "storm", "Alles ist sinnlos. (Ist es nicht.)", "Crash"],
        ["MI", "rain", "Immer noch grau.", "Tief"],
        ["DO", "partly", "Ein bisschen Licht.", "Erholung"],
        ["FR", "partly", "Fast wieder du.", "Erholung"],
      ]
    : [
        ["SA", "disco", "Beste Nacht ever.", "Party"],
        ["SO", "sunset", "Afterglow. Alles weich.", "Nachglühen"],
        ["MO", "cloud", "Müde. Leer. Montag halt.", "Tief"],
        ["DI", "rain", "Grundlos traurig. Ach ja: Serotonin.", "Crash"],
        ["MI", "partly", "Wird besser.", "Erholung"],
        ["DO", "sun", "Fast wieder du.", "Erholung"],
        ["FR", "sun", "Wieder du.", "Normal"],
      ];
  const grid = $("#weekGrid");
  grid.innerHTML = "";
  days.forEach(([d, wx, mood, lab], i) => {
    const level = i === 0 ? 100 : Math.min(100, s0 + rec * i);
    const el = document.createElement("div");
    el.className = "day";
    el.innerHTML = `<span class="d-name">${d}</span>${Art.weather(wx)}<span class="d-mood">${mood}</span>
      <b class="d-pct">${i === 0 ? "100 → " + Math.round(s0) : Math.round(level)} %</b><div class="d-bar"><i></i></div><span class="d-label">5-HT · ${lab}</span>`;
    grid.appendChild(el);
    setTimeout(() => {
      el.classList.add("in");
      el.querySelector("i").style.height = level + "%";
    }, 900 + i * 260);
  });

  // ---- recap charts ----
  const ev = S.events.map((e) => ({
    t: e.t,
    c: e.kind === "water" ? "#3ff0ff" : e.kind === "chill" ? "#6fa8ff" : "#ff4d5e",
    label: e.kind === "water" ? "Wasser" : e.kind === "chill" ? "Chill-out" : "nachgelegt",
  }));
  const data = S.samples;
  const rg = $("#recapGrid");
  rg.innerHTML = "";
  const specs = [
    { title: "Euphorie", unit: " %", color: "#d55181", key: "E", min: 0, max: 100, fmt: (v) => Math.round(v) },
    { title: "Serotonin-Speicher", unit: " %", color: "#9085e9", key: "sero", min: 0, max: 100, fmt: (v) => Math.round(v) },
    { title: "Körpertemperatur", unit: " °C", color: "#d95926", key: "temp", min: 36.5, max: 39, fmt: (v) => de(v), band: [38, 39, "#ff4d5e"] },
    { title: "Puls", unit: " bpm", color: "#3987e5", key: "hr", min: 60, max: 160, fmt: (v) => Math.round(v) },
  ];
  specs.forEach((sp) => {
    const el = document.createElement("div");
    el.className = "chart";
    rg.appendChild(el);
    Art.lineChart(el, { ...sp, data, events: ev });
  });

  const waters = S.events.filter((e) => e.kind === "water").length;
  $("#verdict").innerHTML = `
    <div><b>${de(S.maxTemp)} °C</b>${S.maxTemp >= 38.5 ? "Maximale Körpertemperatur. Deutlich zu heiß. Pausen retten Leben." : S.maxTemp >= 38 ? "Maximale Körpertemperatur. Grenzwertig warm." : (S.chills ? "Maximale Körpertemperatur. Du hast dich gut gekühlt." : "Maximale Körpertemperatur. Im grünen Bereich, diesmal.")}</div>
    <div><b>${waters} × 250 ml</b>${S.maxHyd > 100 ? "Zu viel auf einmal: Hyponatriämie-Risiko." : S.minHyd < 22 ? "Zwischendurch ziemlich ausgetrocknet." : "Wasser mit Maß. Genau richtig."}</div>
    <div><b>${S.chills} × Chill-out</b>${S.chills === 0 ? "Keine einzige Pause. Dein Körper hat das anders gesehen." : "Pausen gemacht. Sehr gut."}</div>
    <div><b>${R ? "Nachgelegt" : "Nicht nachgelegt"}</b>${R ? "Kaum mehr Euphorie, dafür mehr Hitze, Kiefer und ein Speicher bei " + Math.round(S.sero) + " %." : "Gute Entscheidung. Speicher bei " + Math.round(S.sero) + " % statt " + Math.round(S.sero - 14) + " %."}</div>`;

  document.querySelectorAll(".chem-art").forEach((el) => (el.innerHTML = Art.chemArt(el.dataset.art)));
}
