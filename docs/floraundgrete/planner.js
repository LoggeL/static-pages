// Anprobe-Planer: Tag → Uhrzeit → Angaben → Danke. Zustand lebt hier, damit Eingaben jedes Neuzeichnen überstehen.
import { PRODUCTS, CATEGORIES, SHOP, productById } from "./shared/data.js";
import { getContent, openSlots, requestFitting, formatDate } from "./shared/store.js";
import { $, esc, src, addMinutes, smooth, reduceMotion } from "./util.js";

const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const longDate = (d) => formatDate(d, { weekday: "long", day: "numeric", month: "long" });
const state = {
  date: null, start: null, done: null, msg: "", errors: {},
  form: { name: "", email: "", phone: "", product: "", note: "", consent: false },
};
let root;

export function initPlanner() {
  root = $("#planner");
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("submit", onSubmit);
  render(getContent());
}

export function renderPlanner(content) {
  if (root) render(content, { keepFocus: true });
}

/** Aus dem Produktdetail: Stück vormerken und zum Planer springen */
export function preselectProduct(id) {
  const p = productById(id);
  if (p) state.form.product = id;
  state.done = null;
  render(getContent());
  requestAnimationFrame(() => {
    const narrow = innerWidth < 1000;
    (narrow ? root : $("#anprobe")).scrollIntoView({ behavior: smooth(), block: "start" });
    const target = root.querySelector(".day:not(:disabled)") || root;
    setTimeout(() => target.focus({ preventScroll: true }), reduceMotion() ? 0 : 600);
  });
  if (p) announce(`${p.name} ist für deine Anprobe vorgemerkt. Such dir jetzt einen Tag aus.`);
}

function announce(text) {
  const live = $("#planner-live");
  if (live) { live.textContent = ""; setTimeout(() => (live.textContent = text), 40); }
}

/* ---------- Rendern ---------- */
function render(content, { keepFocus = false } = {}) {
  const f = content.fitting;
  const act = document.activeElement;
  const focusKey = keepFocus && root.contains(act) ? act.closest("[data-key]")?.dataset.key : null;
  const sel = focusKey && typeof act.selectionStart === "number" ? [act.selectionStart, act.selectionEnd] : null;

  let html;
  if (state.done) html = renderDone(f);
  else if (!f.enabled) html = renderPause("Die Anprobe macht gerade Pause.", "Im Moment plane ich keine Termine im Atelier. Schreib mir gern über Etsy, wir finden bestimmt eine Lösung. Maße kannst du mir auch einfach schicken.");
  else {
    const days = openSlots();
    const day = days.find((d) => d.date === state.date);
    if (state.date && !day) {
      state.date = null; state.start = null;
      state.msg = "Der gewählte Tag ist leider nicht mehr frei. Such dir bitte einen anderen aus.";
    } else if (day && state.start && !day.slots.find((s) => s.start === state.start && s.free)) {
      state.start = null;
      state.msg = "Schade, diese Uhrzeit wurde gerade vergeben. Such dir bitte eine andere aus.";
    }
    html = days.some((d) => d.slots.some((s) => s.free))
      ? renderSteps(f, days, days.find((d) => d.date === state.date))
      : renderPause("Gerade ist alles ausgebucht.", "In den nächsten Wochen ist jeder Termin vergeben. Schau bald wieder vorbei oder schreib mir, dann finden wir etwas.");
  }
  root.innerHTML = `<div class="card">${html}</div><p class="visually-hidden" aria-live="polite" id="planner-live"></p>`;

  if (focusKey) {
    const el = root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* select, checkbox */ }
    }
  }
}

function stepper(step) {
  const items = ["Tag", "Uhrzeit", "Angaben"].map((l, i) => {
    const n = i + 1;
    const cls = n < step ? "is-done" : n === step ? "is-now" : "";
    return `<li class="${cls}"${n === step ? ' aria-current="step"' : ""}><span class="stepper__n">${n < step ? "✓" : n}</span><span class="stepper__l">${l}</span></li>`;
  }).join("");
  return `<ol class="stepper" aria-label="Schritt ${step} von 3" style="--p:${(step - 1) / 2}">${items}</ol>`;
}

function renderSteps(f, days, day) {
  const step = !state.date ? 1 : !state.start ? 2 : 3;
  let html = stepper(step);
  if (state.msg) html += `<p class="planner__msg" role="status">${esc(state.msg)}</p>`;
  const pre = productById(state.form.product);
  if (pre && step < 3) html += `<p class="planner__pre"><img src="${src(pre.hero)}" alt="" width="40" height="50" loading="lazy"><span><small>Vorgemerkt</small>${esc(pre.name)}</span><button type="button" class="planner__pre-x" data-action="unpick" data-key="unpick" aria-label="${esc(pre.name)} nicht mehr vormerken"><span aria-hidden="true">×</span></button></p>`;

  html += `<div class="pstep${step > 1 ? " is-set" : ""}">
    <h3 class="pstep__title" id="ps-day"><span class="pstep__n">1</span>Such dir einen Tag aus</h3>
    <div class="days" role="group" aria-labelledby="ps-day">${days.map((d) => {
      const free = d.slots.filter((s) => s.free).length;
      const [y, m, dd] = d.date.split("-").map(Number);
      const dt = new Date(y, m - 1, dd);
      const label = `${longDate(d.date)}, ${free ? `${free} ${free === 1 ? "Termin" : "Termine"} frei` : "ausgebucht"}`;
      return `<button type="button" class="day" data-key="day-${d.date}" data-date="${d.date}" aria-pressed="${d.date === state.date}" aria-label="${esc(label)}"${free ? "" : " disabled"}>
        <span class="day__wd">${WD_SHORT[dt.getDay()]}</span><span class="day__n">${dd}</span><span class="day__m">${esc(dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", ""))}</span>
        <span class="day__free">${free ? `${free} frei` : "voll"}</span></button>`;
    }).join("")}</div></div>`;

  if (day) {
    html += `<div class="pstep${step > 2 ? " is-set" : ""}">
      <h3 class="pstep__title" id="ps-time"><span class="pstep__n">2</span>Wann passt es dir?</h3>
      <p class="pstep__hint">${esc(longDate(day.date))}, jeweils ${esc(f.duration)} Minuten</p>
      <div class="slots" role="group" aria-labelledby="ps-time">${day.slots.map((s) => `
        <button type="button" class="slot" data-key="slot-${s.start}" data-start="${s.start}" aria-pressed="${s.start === state.start}"${s.free ? "" : " disabled"}
          aria-label="${esc(`${s.start} bis ${s.end} Uhr${s.free ? "" : ", schon vergeben"}`)}">
          <span class="slot__t">${s.start}</span><small>${s.free ? `bis ${s.end}` : "vergeben"}</small></button>`).join("")}</div></div>`;
  }
  if (day && state.start) html += renderForm(f, day);
  return html;
}

function productOptions(sel) {
  return `<option value="">Noch offen, ich lasse mich beraten</option>` + CATEGORIES.map((c) => `
    <optgroup label="${esc(c.label)}">${PRODUCTS.filter((p) => p.category === c.id).map((p) =>
      `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
}

const inv = (id) => (state.errors[id] ? ` aria-invalid="true" aria-describedby="e-${id}"` : "");
const errP = (id) => (state.errors[id] ? `<p class="field__err" id="e-${id}">${esc(state.errors[id])}</p>` : "");
function field(id, label, input, { req = false, full = false } = {}) {
  return `<div class="field${full ? " field--full" : ""}">
    <label for="f-${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="opt">optional</span>'}</label>
    ${input}${errP(id)}</div>`;
}

function renderForm(f, day) {
  const v = state.form;
  return `<form class="pstep pform" novalidate>
    <h3 class="pstep__title"><span class="pstep__n">3</span>Erzähl mir kurz von dir</h3>
    <p class="pform__sum"><span>Dein Wunschtermin</span><strong>${esc(longDate(day.date))}, ${esc(state.start)}–${esc(addMinutes(state.start, f.duration))} Uhr</strong>
      <button type="button" class="link-btn" data-action="change" data-key="change">Ändern</button></p>
    <div class="pform__grid">
      ${field("name", "Name", `<input id="f-name" data-key="f-name" name="name" autocomplete="name" required value="${esc(v.name)}"${inv("name")}>`, { req: true })}
      ${field("email", "E-Mail", `<input id="f-email" data-key="f-email" name="email" type="email" autocomplete="email" required value="${esc(v.email)}"${inv("email")}>`, { req: true })}
      ${field("phone", "Telefon", `<input id="f-phone" data-key="f-phone" name="phone" type="tel" autocomplete="tel" value="${esc(v.phone)}">`)}
      ${field("product", "Um welches Stück geht es?", `<select id="f-product" data-key="f-product" name="product">${productOptions(v.product)}</select>`)}
      ${field("note", "Nachricht &amp; Maße", `<textarea id="f-note" data-key="f-note" name="note" rows="4" placeholder="z. B. Taille 74 cm, Wunschlänge knieumspielend, Lieblingsfarbe">${esc(v.note)}</textarea>`, { full: true })}
      <div class="check field--full">
        <label class="check__l"><input type="checkbox" id="f-consent" data-key="f-consent" name="consent"${v.consent ? " checked" : ""}${inv("consent")}>
          <span>Ich bin einverstanden, dass Cathrin meine Angaben speichert, um den Termin mit mir abzusprechen. Mehr dazu im <a href="#">Datenschutz</a>. <span class="req" aria-hidden="true">*</span></span></label>
        ${errP("consent")}
      </div>
      <div class="pform__foot field--full">
        <button class="btn btn--brass btn--lg" type="submit" data-key="submit">Anprobe anfragen</button>
        <p>Unverbindliche Anfrage. Ich bestätige dir den Termin persönlich per E-Mail. <span aria-hidden="true">*</span> Pflichtfeld</p>
      </div>
    </div>
  </form>`;
}

function renderDone(f) {
  const b = state.done;
  const p = productById(b.product);
  return `<div class="done" tabindex="-1" id="planner-done">
    <p class="done__mark" aria-hidden="true">✓</p>
    <h3 class="done__title">Danke, ${esc(b.name.split(" ")[0])}!</h3>
    <p>Deine Anfrage ist bei mir angekommen. Ich melde mich in den nächsten Tagen per E-Mail und bestätige dir den Termin.</p>
    <dl class="done__list">
      <div><dt>Termin</dt><dd>${esc(longDate(b.date))}, ${esc(b.start)}–${esc(addMinutes(b.start, f.duration))} Uhr</dd></div>
      <div><dt>Wo</dt><dd>${esc(f.place)}</dd></div>
      ${p ? `<div><dt>Stück</dt><dd>${esc(p.name)}</dd></div>` : ""}
      <div><dt>Antwort an</dt><dd>${esc(b.email)}</dd></div>
    </dl>
    <button class="btn btn--ghost" type="button" data-action="again" data-key="again">Weitere Anfrage stellen</button>
  </div>`;
}

function renderPause(title, text) {
  return `<div class="done done--pause">
    <p class="done__tag">Gerade keine Termine</p>
    <h3 class="done__title">${esc(title)}</h3>
    <p>${esc(text)}</p>
    <a class="btn btn--brass" href="${esc(SHOP.etsy)}" target="_blank" rel="noopener">Nachricht über Etsy <span class="ext" aria-hidden="true"></span></a>
  </div>`;
}

/* ---------- Ereignisse ---------- */
function onClick(e) {
  const t = e.target;
  const day = t.closest(".day");
  const slot = t.closest(".slot");
  const action = t.closest("[data-action]")?.dataset.action;
  if (action === "unpick") {
    state.form.product = "";
    render(getContent());
    root.querySelector(".day:not(:disabled)")?.focus({ preventScroll: true });
  } else if (action === "change") {
    state.start = null;
    render(getContent());
    root.querySelector(".slot:not(:disabled)")?.focus({ preventScroll: true });
  } else if (action === "again") {
    state.done = null; state.date = null; state.start = null; state.errors = {};
    state.form = { ...state.form, product: "", note: "", consent: false };
    render(getContent());
    root.querySelector(".day:not(:disabled)")?.focus();
  } else if (day && !day.disabled) {
    if (state.date !== day.dataset.date) state.start = null;
    state.date = day.dataset.date;
    state.msg = "";
    render(getContent());
    root.querySelector(`[data-key="day-${state.date}"]`)?.focus({ preventScroll: true });
    announce(`${longDate(state.date)} gewählt. Jetzt eine Uhrzeit aussuchen.`);
    root.querySelectorAll(".pstep")[1]?.scrollIntoView({ behavior: smooth(), block: "nearest" });
  } else if (slot && !slot.disabled) {
    state.start = slot.dataset.start;
    state.msg = "";
    render(getContent());
    root.querySelector(`[data-key="slot-${state.start}"]`)?.focus({ preventScroll: true });
    announce(`${state.start} Uhr gewählt. Jetzt noch deine Angaben eintragen.`);
    root.querySelector("form")?.scrollIntoView({ behavior: smooth(), block: "nearest" });
  }
}

function onInput(e) {
  const t = e.target;
  if (!t.name || !(t.name in state.form)) return;
  state.form[t.name] = t.type === "checkbox" ? t.checked : t.value;
  if (state.errors[t.name]) {
    delete state.errors[t.name];
    t.removeAttribute("aria-invalid");
    t.removeAttribute("aria-describedby");
    t.closest(".field, .check")?.querySelector(".field__err")?.remove();
  }
}

function validate() {
  const v = state.form, err = {};
  if (v.name.trim().length < 2) err.name = "Bitte gib deinen Namen an.";
  if (!v.email.trim()) err.email = "Bitte gib deine E-Mail-Adresse an, damit ich dir antworten kann.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) err.email = "Diese E-Mail-Adresse sieht noch nicht ganz richtig aus.";
  if (!v.consent) err.consent = "Bitte bestätige kurz den Datenschutz-Hinweis.";
  return err;
}

function onSubmit(e) {
  e.preventDefault();
  state.errors = validate();
  if (Object.keys(state.errors).length) {
    render(getContent());
    root.querySelector(`#f-${Object.keys(state.errors)[0]}`)?.focus();
    announce("Da fehlt noch etwas. Bitte schau dir die markierten Felder an.");
    return;
  }
  // Termin noch frei? (könnte gerade in einem anderen Tab vergeben worden sein)
  const day = openSlots().find((d) => d.date === state.date);
  if (!day || !day.slots.find((s) => s.start === state.start && s.free)) { render(getContent()); return; }
  const v = state.form;
  const booking = {
    date: state.date, start: state.start, name: v.name.trim(), email: v.email.trim(),
    phone: v.phone.trim(), product: v.product, note: v.note.trim(),
  };
  state.done = { ...booking }; // vor requestFitting setzen: dessen subscribe-Neuzeichnen zeigt schon den Dank
  state.date = null; state.start = null; state.msg = "";
  state.done = requestFitting(booking);
  render(getContent());
  root.scrollIntoView({ behavior: smooth(), block: "start" });
  $("#planner-done")?.focus({ preventScroll: true });
}
