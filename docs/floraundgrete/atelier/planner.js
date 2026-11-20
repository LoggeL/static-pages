// Anprobe-Planer als ruhige Karte in drei Schritten: Tag → Uhrzeit → Angaben → Danke.
import { PRODUCTS, CATEGORIES, SHOP, productById } from "../shared/data.js";
import { getContent, openSlots, requestFitting, formatDate } from "../shared/store.js";
import { esc, icon, img, addMinutes, reduceMotion } from "./util.js";

const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const state = {
  date: null,
  start: null,
  done: null,
  msg: "",
  errors: {},
  form: { name: "", email: "", phone: "", product: "", note: "", consent: false },
};
let root, submitting = false;
const longDate = (d) => formatDate(d, { weekday: "long", day: "numeric", month: "long" });

export function initPlanner() {
  root = document.getElementById("planner-body");
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("submit", onSubmit);
  render(getContent());
}

export function renderPlanner(content) {
  if (!root || submitting) return;
  render(content, { keepFocus: true });
}

/** Aus den Produktdetails: Produkt vormerken und zum Planer springen. */
export function preselectProduct(id) {
  const p = productById(id);
  if (p) state.form.product = id;
  state.done = null;
  render(getContent());
  const target = document.getElementById(window.innerWidth < 900 ? "planner" : "anprobe");
  target.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  const focusEl = root.querySelector("#f-product") || root.querySelector(".day:not(:disabled)") || root;
  setTimeout(() => focusEl.focus({ preventScroll: true }), reduceMotion() ? 0 : 600);
  if (p) announce(`${p.name} ist für deine Anprobe vorgemerkt. Such dir jetzt einen Tag aus.`);
}

function announce(text) {
  const live = document.getElementById("planner-live");
  if (live) { live.textContent = ""; setTimeout(() => (live.textContent = text), 30); }
}

/* ---------------- Rendern ---------------- */

function render(content, { keepFocus = false } = {}) {
  const f = content.fitting;
  updateFacts(f);
  const active = document.activeElement;
  const focusKey = keepFocus && root.contains(active) ? active.dataset?.key : null;
  const selStart = focusKey ? active.selectionStart : null;

  let html;
  if (state.done) html = renderDone(f);
  else if (!f.enabled) html = renderEmpty("Gerade mache ich eine kleine Anprobe-Pause.", "Im Moment plane ich keine Termine im Atelier. Schreib mir gern über Etsy, Maße kannst du mir auch einfach schicken.", "sun");
  else {
    const days = openSlots();
    const day = days.find((d) => d.date === state.date);
    if (state.date && !day) {
      state.date = null; state.start = null;
      state.msg = "Der gewählte Tag ist leider nicht mehr frei. Such dir bitte einen anderen aus.";
    } else if (day && state.start && !day.slots.find((s) => s.start === state.start && s.free)) {
      state.start = null;
      state.msg = "Diese Uhrzeit wurde gerade vergeben. Such dir bitte eine andere aus.";
    }
    const hasFree = days.some((d) => d.slots.some((s) => s.free));
    html = hasFree ? renderSteps(f, days, day) : renderEmpty("Alle Termine sind vergeben.", "In den nächsten Wochen ist leider alles belegt. Schau bald wieder vorbei oder schreib mir, dann finden wir etwas.", "calendar");
  }
  root.innerHTML = html + '<p class="sr-only" aria-live="polite" id="planner-live"></p>';

  if (focusKey) {
    const el = root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof selStart === "number" && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch { /* select */ }
    }
  }
}

function updateFacts(f) {
  const wd = [...f.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD_SHORT[d]).join(", ");
  const el = document.getElementById("fitting-facts");
  if (!el) return;
  el.innerHTML = `
    <li><span class="tile tile-xs">${icon("pin")}</span><span><strong>Wo?</strong><span>${esc(f.place)}</span></span></li>
    <li><span class="tile tile-xs">${icon("clock")}</span><span><strong>Wie lange?</strong><span>etwa ${esc(f.duration)} Minuten, ganz ohne Eile</span></span></li>
    <li><span class="tile tile-xs">${icon("calendar")}</span><span><strong>Wann?</strong><span>${f.enabled ? `meist ${esc(wd)}, ab ${esc(f.leadDays)} Tagen im Voraus` : "gerade keine Termine"}</span></span></li>`;
}

function stepper(step) {
  const items = ["Tag", "Uhrzeit", "Deine Angaben"].map((l, i) => {
    const n = i + 1;
    const cls = n < step ? "is-done" : n === step ? "is-now" : "";
    return `<li class="${cls}"${n === step ? ' aria-current="step"' : ""}><span class="step-n">${n < step ? icon("check", "ico-sm") : n}</span><span class="step-l">${l}</span></li>`;
  }).join("");
  return `<ol class="stepper" aria-label="Schritt ${step} von 3">${items}</ol>`;
}

function renderSteps(f, days, day) {
  const step = !state.date ? 1 : !state.start ? 2 : 3;
  let html = `<div class="planner-head"><h3 class="card-title">Wunschtermin anfragen</h3><p class="card-sub">Unverbindlich, ich bestätige dir jeden Termin persönlich.</p></div>`;
  html += stepper(step);
  if (state.msg) html += `<p class="note note-warn" role="status">${icon("info")}<span>${esc(state.msg)}</span></p>`;
  const pre = step < 3 && productById(state.form.product);
  if (pre) html += `<p class="pre">${img(pre.hero, "", { cls: "pre-img" })}<span><span class="muted small">Vorgemerkt</span><strong>${esc(pre.name)}</strong></span>
    <button type="button" class="icon-btn icon-btn-sm" data-action="unpick" aria-label="${esc(pre.name)} nicht mehr vormerken">${icon("x")}</button></p>`;

  html += `<fieldset class="step">
    <legend class="step-title"><span class="step-badge">1</span>Welcher Tag passt dir?</legend>
    <div class="days" role="group" aria-label="Verfügbare Tage">${days.map((d) => {
      const free = d.slots.filter((s) => s.free).length;
      const [y, m, dd] = d.date.split("-").map(Number);
      const dt = new Date(y, m - 1, dd);
      const label = `${longDate(d.date)}, ${free ? `${free} ${free === 1 ? "Termin" : "Termine"} frei` : "ausgebucht"}`;
      return `<button type="button" class="day" data-key="day-${d.date}" data-date="${d.date}" aria-pressed="${d.date === state.date}" aria-label="${esc(label)}"${free ? "" : " disabled"}>
        <span class="day-wd">${WD_SHORT[dt.getDay()]}</span><span class="day-n">${dd}</span><span class="day-m">${esc(dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", ""))}</span>
        <span class="day-free">${free ? `${free} frei` : "voll"}</span></button>`;
    }).join("")}</div></fieldset>`;

  if (day) {
    html += `<fieldset class="step">
      <legend class="step-title"><span class="step-badge">2</span>Um wie viel Uhr?</legend>
      <p class="step-hint">${esc(longDate(day.date))} · jeweils ${esc(f.duration)} Minuten</p>
      <div class="slots" role="group" aria-label="Uhrzeiten">${day.slots.map((s) => `
        <button type="button" class="slot" data-key="slot-${s.start}" data-start="${s.start}" aria-pressed="${s.start === state.start}"${s.free ? "" : " disabled"}
          aria-label="${esc(`${s.start} bis ${s.end} Uhr${s.free ? "" : ", schon vergeben"}`)}">
          <strong>${s.start} Uhr</strong><span>${s.free ? `bis ${s.end}` : "vergeben"}</span></button>`).join("")}</div>
    </fieldset>`;
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
function field(id, label, input, { req = false, opt = false, full = false } = {}) {
  const err = state.errors[id];
  return `<div class="field${full ? " field-full" : ""}">
    <label for="f-${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ""}${opt ? ' <span class="opt">optional</span>' : ""}</label>
    ${input}
    ${err ? `<p class="field-error" id="e-${id}">${icon("info", "ico-xs")}${esc(err)}</p>` : ""}
  </div>`;
}

function renderForm(f, day) {
  const v = state.form;
  const end = addMinutes(state.start, f.duration);
  return `<form class="step" novalidate>
    <h4 class="step-title"><span class="step-badge">3</span>Erzähl mir kurz von dir</h4>
    <p class="summary">${icon("calendar")}<span><strong>${esc(longDate(day.date))}</strong><span>${esc(state.start)}–${esc(end)} Uhr · Atelier in Ramsen</span></span>
      <button type="button" class="text-link" data-action="change">Ändern</button></p>
    <div class="form-grid">
      ${field("name", "Name", `<input id="f-name" data-key="f-name" name="name" autocomplete="name" required value="${esc(v.name)}"${inv("name")}>`, { req: true })}
      ${field("email", "E-Mail", `<input id="f-email" data-key="f-email" name="email" type="email" autocomplete="email" required value="${esc(v.email)}"${inv("email")}>`, { req: true })}
      ${field("phone", "Telefon", `<input id="f-phone" data-key="f-phone" name="phone" type="tel" autocomplete="tel" value="${esc(v.phone)}">`, { opt: true })}
      ${field("product", "Um welches Stück geht es?", `<select id="f-product" data-key="f-product" name="product">${productOptions(v.product)}</select>`, { opt: true })}
      ${field("note", "Nachricht &amp; Maße", `<textarea id="f-note" data-key="f-note" name="note" rows="4" placeholder="z. B. Taillenumfang, Wunschlänge, Lieblingsfarbe">${esc(v.note)}</textarea>`, { opt: true, full: true })}
      <div class="field-full consent">
        <label class="check"><input type="checkbox" id="f-consent" data-key="f-consent" name="consent"${v.consent ? " checked" : ""}${inv("consent")}>
          <span>Ich bin einverstanden, dass Cathrin meine Angaben speichert, um den Termin mit mir abzusprechen. Mehr dazu im <a href="#">Datenschutz</a>. <span class="req" aria-hidden="true">*</span></span></label>
        ${state.errors.consent ? `<p class="field-error" id="e-consent">${icon("info", "ico-xs")}${esc(state.errors.consent)}</p>` : ""}
      </div>
      <div class="field-full form-actions">
        <button class="btn btn-primary btn-lg" type="submit" data-key="submit">${icon("check")}<span>Anprobe anfragen</span></button>
        <p class="muted small"><span aria-hidden="true">*</span> Pflichtfelder · Die Anfrage ist unverbindlich.</p>
      </div>
    </div>
  </form>`;
}

function renderDone(f) {
  const b = state.done;
  const p = productById(b.product);
  return `<div class="success" tabindex="-1" id="planner-success">
    <span class="success-ico">${icon("check")}</span>
    <h3 class="success-title">Danke, ${esc(b.name.split(" ")[0])}!</h3>
    <p class="muted">Deine Anfrage ist bei mir angekommen. Ich schaue sie mir an und bestätige dir den Termin per E-Mail an <strong>${esc(b.email)}</strong>.</p>
    <p class="summary">${icon("calendar")}<span><strong>${esc(longDate(b.date))}</strong><span>${esc(b.start)}–${esc(addMinutes(b.start, f.duration))} Uhr${p ? ` · ${esc(p.name)}` : ""}</span></span><span class="tag tag-amber">angefragt</span></p>
    <p class="success-dog"><img src="../img/${SHOP.dog}" alt="" width="1120" height="1400" loading="lazy" decoding="async"><span>Struppi hält schon mal den Platz am Stofftisch warm.</span></p>
    <button class="btn btn-soft" type="button" data-action="again">${icon("calendar")}<span>Weitere Anfrage stellen</span></button>
  </div>`;
}

function renderEmpty(title, text, ic) {
  return `<div class="empty empty-lg">${icon(ic, "empty-ico")}<p class="empty-title">${esc(title)}</p><p class="muted">${esc(text)}</p>
    <a class="btn btn-primary" href="${esc(SHOP.etsy)}" target="_blank" rel="noopener"><span>Nachricht über Etsy</span>${icon("external")}</a></div>`;
}

/* ---------------- Ereignisse ---------------- */

function onClick(e) {
  const day = e.target.closest(".day");
  const slot = e.target.closest(".slot");
  const act = e.target.closest("[data-action]")?.dataset.action;
  if (act === "unpick") {
    state.form.product = "";
    render(getContent());
    root.querySelector(".day:not(:disabled)")?.focus({ preventScroll: true });
    return;
  }
  if (act === "change") {
    state.start = null;
    render(getContent());
    root.querySelector(".slot:not(:disabled)")?.focus();
    return;
  }
  if (act === "again") {
    state.done = null; state.date = null; state.start = null; state.errors = {};
    state.form = { ...state.form, note: "", product: "", consent: false };
    render(getContent());
    root.querySelector(".day:not(:disabled)")?.focus();
    return;
  }
  if (day && !day.disabled) {
    const same = state.date === day.dataset.date;
    state.date = day.dataset.date;
    if (!same) state.start = null;
    state.msg = "";
    render(getContent());
    root.querySelector(`[data-key="day-${state.date}"]`)?.focus({ preventScroll: true });
    announce(`${longDate(state.date)} gewählt. Jetzt eine Uhrzeit aussuchen.`);
    const s2 = root.querySelectorAll(".step")[1];
    if (s2) s2.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "nearest" });
  } else if (slot && !slot.disabled) {
    state.start = slot.dataset.start;
    state.msg = "";
    render(getContent());
    root.querySelector(`[data-key="slot-${state.start}"]`)?.focus({ preventScroll: true });
    announce(`${state.start} Uhr gewählt. Jetzt noch deine Angaben eintragen.`);
    root.querySelector("form")?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "nearest" });
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
    t.closest(".field, .consent")?.querySelector(".field-error")?.remove();
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
  const v = state.form;
  submitting = true;
  try {
    state.done = requestFitting({
      date: state.date, start: state.start, name: v.name.trim(), email: v.email.trim(),
      phone: v.phone.trim(), product: v.product, note: v.note.trim(),
    });
  } finally { submitting = false; }
  state.date = null; state.start = null; state.msg = "";
  render(getContent());
  document.getElementById("planner").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  root.querySelector("#planner-success")?.focus({ preventScroll: true });
}
