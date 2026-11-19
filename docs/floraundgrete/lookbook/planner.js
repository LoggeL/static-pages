// Anprobe-Planer: 1 Tag → 2 Uhrzeit → 3 Daten
import { PRODUCTS, productById } from "../shared/data.js";
import { getContent, openSlots, requestFitting, formatDate } from "../shared/store.js";
import { $, $$, esc } from "./util.js";

const root = $("#planner");
const state = { date: null, time: null, done: null, notice: "" };
let built = false;
let els = {};

const longDate = (d) => formatDate(d, { weekday: "long", day: "numeric", month: "long" });

export function initPlanner() {
  render(getContent());
}

/** Produkt vorauswählen und zum Planer springen */
export function preselect(id) {
  if (state.done) { state.done = null; render(getContent()); }
  if (els.product && productById(id)) els.product.value = id;
  const target = $("#anprobe");
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  const firstDay = root.querySelector(".day:not([disabled])");
  setTimeout(() => (firstDay || root).focus({ preventScroll: true }), 450);
}

export function render(content) {
  const f = content.fitting;
  $("#fit-place").textContent = f.place || "Atelier in Ramsen";
  $("#fit-duration").textContent = `${f.duration} Minuten`;

  if (!f.enabled) {
    built = false;
    root.innerHTML = `
      <div class="closed-msg">
        <p class="closed-tag">Gerade keine Termine</p>
        <h3>Die Anprobe macht gerade Pause.</h3>
        <p>Im Moment nehme ich keine neuen Anprobe-Termine an. Schau bald wieder vorbei, oder schreib mir einfach über Etsy, dann finden wir eine Lösung.</p>
        <a class="btn btn--solid" href="https://www.etsy.com/de/shop/FloraundGrete" target="_blank" rel="noopener">Nachricht über Etsy <span aria-hidden="true">↗</span></a>
      </div>`;
    return;
  }

  if (state.done) { renderSuccess(); return; }
  if (!built) build();

  const days = openSlots();
  // Auswahl prüfen: Tag / Uhrzeit noch verfügbar?
  const day = days.find((d) => d.date === state.date);
  if (state.date && !day) { state.date = null; state.time = null; state.notice = "Dieser Tag ist leider nicht mehr verfügbar. Bitte wähl einen anderen."; }
  else if (day && state.time && !day.slots.find((s) => s.start === state.time && s.free)) {
    state.time = null; state.notice = "Diese Uhrzeit wurde gerade vergeben. Bitte wähl eine andere.";
  }

  renderStepper();
  renderDays(days);
  renderTimes(day);
  renderForm();
}

function build() {
  built = true;
  root.innerHTML = `
    <ol class="stepper" id="stepper" aria-label="Fortschritt">
      <li><span class="s-no">1</span>Tag</li>
      <li><span class="s-no">2</span>Uhrzeit</li>
      <li><span class="s-no">3</span>Daten</li>
    </ol>
    <div class="p-block" id="p-day">
      <div class="p-head">
        <h3 id="day-h"><span>01</span>Tag wählen</h3>
        <div class="days-nav">
          <button type="button" id="days-prev" aria-label="Frühere Tage">←</button>
          <button type="button" id="days-next" aria-label="Spätere Tage">→</button>
        </div>
      </div>
      <div class="days" id="days" role="group" aria-labelledby="day-h"></div>
    </div>
    <div class="p-block" id="p-time">
      <div class="p-head"><h3 id="time-h"><span>02</span>Uhrzeit</h3><p class="p-sel" id="time-sel"></p></div>
      <div id="times"></div>
    </div>
    <div class="p-block" id="p-form">
      <div class="p-head"><h3><span>03</span>Deine Daten</h3></div>
      <form class="form" id="fit-form" novalidate>
        <fieldset id="fit-fields">
          <div class="summary" id="fit-summary"></div>
          <div class="field">
            <label for="f-name">Name *</label>
            <input id="f-name" name="name" autocomplete="name" required aria-describedby="e-name">
            <p class="err" id="e-name"></p>
          </div>
          <div class="field">
            <label for="f-email">E-Mail *</label>
            <input id="f-email" name="email" type="email" autocomplete="email" required aria-describedby="e-email">
            <p class="err" id="e-email"></p>
          </div>
          <div class="field">
            <label for="f-phone">Telefon <span class="opt">optional</span></label>
            <input id="f-phone" name="phone" type="tel" autocomplete="tel">
          </div>
          <div class="field">
            <label for="f-product">Produkt <span class="opt">optional</span></label>
            <select id="f-product" name="product">
              <option value="">Noch offen / nur schauen</option>
              ${PRODUCTS.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field field--full">
            <label for="f-note">Nachricht / Maße <span class="opt">optional</span></label>
            <textarea id="f-note" name="note" placeholder="z. B. Taille 74 cm, Wunschlänge knieumspielend, Farbe Flaschengrün"></textarea>
          </div>
          <label class="consent">
            <input type="checkbox" id="f-consent" name="consent" required aria-describedby="e-consent">
            <span>Ich bin einverstanden, dass Cathrin meine Angaben nutzt, um den Termin mit mir abzustimmen. Mehr dazu im <a href="#">Datenschutz</a>. *
              <span class="err" id="e-consent" style="display:block"></span></span>
          </label>
          <div class="form-foot">
            <p>Das ist eine Anfrage. Cathrin bestätigt dir den Termin persönlich per E-Mail.</p>
            <button class="btn btn--accent" type="submit">Anprobe anfragen</button>
          </div>
        </fieldset>
      </form>
    </div>`;

  els = {
    stepper: $("#stepper", root), days: $("#days", root), times: $("#times", root), timeSel: $("#time-sel", root),
    form: $("#fit-form", root), fields: $("#fit-fields", root), summary: $("#fit-summary", root),
    product: $("#f-product", root), pTime: $("#p-time", root), pForm: $("#p-form", root),
    prev: $("#days-prev", root), next: $("#days-next", root),
  };

  els.days.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-date]");
    if (!b || b.disabled) return;
    state.date = b.dataset.date; state.time = null; state.notice = "";
    render(getContent());
    const firstFree = $(".time:not([disabled])", els.times);
    firstFree && firstFree.focus({ preventScroll: true });
    if (matchMedia("(max-width: 960px)").matches) els.pTime.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  els.times.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-time]");
    if (!b || b.disabled) return;
    state.time = b.dataset.time; state.notice = "";
    render(getContent());
    $("#f-name", root).focus({ preventScroll: true });
    els.pForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  els.summary.addEventListener("click", (e) => {
    if (!e.target.closest("button")) return;
    state.time = null; render(getContent());
    ($('.time[aria-pressed="false"]:not([disabled])', els.times) || els.days).focus();
  });
  const scrollDays = (dir) => els.days.scrollBy({ left: dir * els.days.clientWidth * 0.8, behavior: "smooth" });
  els.prev.addEventListener("click", () => scrollDays(-1));
  els.next.addEventListener("click", () => scrollDays(1));
  els.days.addEventListener("scroll", syncDayNav, { passive: true });
  els.form.addEventListener("submit", submit);
  $$("input, textarea", els.form).forEach((i) => i.addEventListener("input", () => {
    if (i.getAttribute("aria-invalid") === "true") validateField(i);
  }));
}

function syncDayNav() {
  const d = els.days;
  els.prev.disabled = d.scrollLeft < 4;
  els.next.disabled = d.scrollLeft + d.clientWidth >= d.scrollWidth - 4;
}

function renderStepper() {
  const stepNow = !state.date ? 1 : !state.time ? 2 : 3;
  $$("li", els.stepper).forEach((li, i) => {
    li.classList.toggle("is-done", i + 1 < stepNow);
    if (i + 1 === stepNow) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
}

function renderDays(days) {
  const keep = els.days.scrollLeft;
  if (!days.length) {
    els.days.innerHTML = `<p class="p-hint">In den nächsten Wochen sind leider keine Termine frei. Schreib mir gern direkt.</p>`;
    return;
  }
  els.days.innerHTML = days.map((d) => {
    const free = d.slots.filter((s) => s.free).length;
    const [y, m, dd] = d.date.split("-").map(Number);
    const dt = new Date(y, m - 1, dd);
    const wd = dt.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
    const mon = dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", "");
    const label = `${longDate(d.date)}, ${free ? `${free} ${free === 1 ? "Termin" : "Termine"} frei` : "ausgebucht"}`;
    return `<button type="button" class="day" data-date="${d.date}" aria-pressed="${d.date === state.date}" aria-label="${esc(label)}" ${free ? "" : "disabled"}>
      <span class="d-wd">${esc(wd)}</span><span class="d-num">${dd}</span><span class="d-mon">${esc(mon)}</span>
      <span class="d-free">${free ? `${free} frei` : "voll"}</span></button>`;
  }).join("");
  els.days.scrollLeft = keep;
  requestAnimationFrame(syncDayNav);
}

function renderTimes(day) {
  els.pTime.classList.toggle("is-locked", !day);
  if (!day) {
    els.timeSel.textContent = "";
    els.times.innerHTML = `<p class="p-hint">Wähl zuerst einen Tag, dann zeige ich dir die freien Uhrzeiten.</p>${state.notice ? `<p class="p-notice" role="status">${esc(state.notice)}</p>` : ""}`;
    return;
  }
  els.timeSel.textContent = longDate(day.date);
  els.times.innerHTML = `<div class="times" role="group" aria-labelledby="time-h">${day.slots.map((s) => `
      <button type="button" class="time" data-time="${s.start}" aria-pressed="${s.start === state.time}" ${s.free ? "" : 'disabled aria-label="' + s.start + ' Uhr, schon vergeben"'}>
        <strong>${s.start}</strong><small>${s.free ? `bis ${s.end}` : "vergeben"}</small>
      </button>`).join("")}</div>${state.notice ? `<p class="p-notice" role="status">${esc(state.notice)}</p>` : ""}`;
}

function renderForm() {
  const ready = !!(state.date && state.time);
  els.fields.disabled = !ready;
  els.form.classList.toggle("is-locked", !ready);
  els.pForm.classList.toggle("is-locked", !ready);
  els.summary.innerHTML = ready
    ? `<span>Dein Wunschtermin:</span> <strong>${esc(longDate(state.date))}, ${state.time} Uhr</strong><button type="button">Ändern</button>`
    : `<span>Wähl oben einen Tag und eine Uhrzeit, dann kannst du hier deine Daten eintragen.</span>`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validateField(i) {
  let msg = "";
  if (i.name === "name" && i.value.trim().length < 2) msg = "Bitte gib deinen Namen an.";
  if (i.name === "email" && !EMAIL.test(i.value.trim())) msg = i.value.trim() ? "Diese E-Mail-Adresse sieht nicht ganz richtig aus." : "Bitte gib deine E-Mail-Adresse an, damit Cathrin dir antworten kann.";
  if (i.name === "consent" && !i.checked) msg = "Bitte bestätige kurz, dass Cathrin deine Angaben dafür nutzen darf.";
  const err = $(`#e-${i.name}`, root);
  if (err) err.textContent = msg;
  if (msg) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid");
  return !msg;
}

function submit(e) {
  e.preventDefault();
  if (!state.date || !state.time) return;
  const f = els.form;
  const fields = [f.elements.name, f.elements.email, f.elements.consent];
  const bad = fields.filter((i) => !validateField(i));
  if (bad.length) { bad[0].focus(); return; }

  // Slot noch frei? (könnte in einem anderen Tab vergeben worden sein)
  const day = openSlots().find((d) => d.date === state.date);
  if (!day || !day.slots.find((s) => s.start === state.time && s.free)) {
    state.time = null; state.notice = "Diese Uhrzeit wurde gerade vergeben. Bitte wähl eine andere.";
    render(getContent()); return;
  }

  const booking = requestFitting({
    date: state.date, start: state.time,
    name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), phone: f.elements.phone.value.trim(),
    product: f.elements.product.value, note: f.elements.note.value.trim(),
  });
  state.done = booking;
  f.reset();
  render(getContent());
  const h = $("#success-h", root);
  h && h.focus();
}

function renderSuccess() {
  built = false;
  const b = state.done;
  const p = b.product ? productById(b.product) : null;
  root.innerHTML = `
    <div class="success">
      <span class="success-mark" aria-hidden="true">✓</span>
      <h3 id="success-h" tabindex="-1">Danke, ${esc(b.name.split(" ")[0])}!</h3>
      <p>Deine Anfrage ist bei Cathrin. Sie bestätigt dir den Termin per E-Mail.</p>
      <dl>
        <div><dt>Termin</dt><dd>${esc(longDate(b.date))}, ${esc(b.start)} Uhr</dd></div>
        <div><dt>Wo</dt><dd>${esc(getContent().fitting.place)}</dd></div>
        ${p ? `<div><dt>Produkt</dt><dd>${esc(p.name)}</dd></div>` : ""}
        <div><dt>Antwort an</dt><dd>${esc(b.email)}</dd></div>
      </dl>
      <button class="btn btn--line" type="button" id="again">Weitere Anfrage stellen</button>
    </div>`;
  $("#again", root).addEventListener("click", () => {
    state.done = null; state.date = null; state.time = null; state.notice = "";
    render(getContent());
    const d = root.querySelector(".day:not([disabled])");
    d && d.focus();
  });
}
