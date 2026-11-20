// Anprobe-Planer als „Maßblatt“: Tag → Uhrzeit → Angaben. Daten kommen live aus dem gemeinsamen Store.
import { PRODUCTS, CATEGORIES, SHOP, productById } from "../shared/data.js";
import { getContent, openSlots, requestFitting, formatDate, subscribe, WEEKDAYS } from "../shared/store.js";
import { esc, reduceMotion } from "./util.js";

const state = { date: null, start: null, sent: null, notice: "" };
let root, mode = null;

const long = (iso) => formatDate(iso, { weekday: "long", day: "numeric", month: "long" });
const dmy = (iso) => { const [, m, d] = iso.split("-"); return `${d}.${m}.`; };

function weekdayList(wds) {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => wds.includes(d)).map((n) => WEEKDAYS[n]);
  return order.length > 1 ? `${order.slice(0, -1).join(", ")} und ${order.at(-1)}` : order.join("");
}

function renderIntro(f) {
  document.getElementById("planner-intro").innerHTML = `
    <p>Wir nehmen in Ruhe Maß, du fühlst die Stoffe und probierst an. Such dir einen freien Termin aus, ich melde mich dann persönlich bei dir.</p>
    <dl class="intro-facts">
      <div><dt>Wo</dt><dd>${esc(f.place)}</dd></div>
      <div><dt>Dauer</dt><dd>ca. ${esc(f.duration)} Minuten</dd></div>
      ${f.enabled && f.weekdays?.length ? `<div><dt>Wann</dt><dd>${esc(weekdayList(f.weekdays))}</dd></div>` : ""}
    </dl>`;
}

function productOptions() {
  return CATEGORIES.map((c) => {
    const opts = PRODUCTS.filter((p) => p.category === c.id).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    return `<optgroup label="${esc(c.label)}">${opts}</optgroup>`;
  }).join("");
}

function shell() {
  root.innerHTML = `
  <div class="order">
    <div class="order__head mono" aria-hidden="true"><span>Maßblatt · Anprobe</span><span>Flora &amp; Grete, Ramsen</span></div>
    <div class="order__grid">
      <div class="order__col">
        <fieldset class="step">
          <legend><b class="step__no">A</b>Tag wählen</legend>
          <div data-notice></div>
          <div class="days" data-days></div>
        </fieldset>
        <fieldset class="step" data-slots-step>
          <legend><b class="step__no">B</b>Uhrzeit <span class="step__aside" data-daylabel></span></legend>
          <div data-slots></div>
        </fieldset>
      </div>
      <div class="order__col order__col--form" data-right></div>
    </div>
  </div>`;
  renderForm();
}

function renderForm() {
  const right = root.querySelector("[data-right]");
  right.innerHTML = `
    <fieldset class="step">
      <legend><b class="step__no">C</b>Deine Angaben</legend>
      <div class="choice" data-choice aria-live="polite"></div>
      <form class="form" novalidate data-form>
        <div class="field"><label for="f-name">Name *</label><input id="f-name" name="name" autocomplete="name" required aria-describedby="e-name"><p class="field__error" id="e-name"></p></div>
        <div class="field"><label for="f-email">E-Mail *</label><input id="f-email" name="email" type="email" autocomplete="email" required aria-describedby="e-email"><p class="field__error" id="e-email"></p></div>
        <div class="field"><label for="f-phone">Telefon <span class="opt">optional</span></label><input id="f-phone" name="phone" type="tel" autocomplete="tel"></div>
        <div class="field"><label for="f-product">Produkt <span class="opt">optional</span></label>
          <select id="f-product" name="product"><option value="">Noch offen / mehrere</option>${productOptions()}</select></div>
        <div class="field field--full"><label for="f-note">Nachricht &amp; Maße <span class="opt">optional</span></label>
          <textarea id="f-note" name="note" rows="4" placeholder="z. B. Taillenumfang, Wunschlänge, Lieblingsfarbe"></textarea></div>
        <label class="check field--full"><input type="checkbox" name="consent" required aria-describedby="e-consent">
          <span>Ich bin einverstanden, dass meine Angaben zur Terminabsprache gespeichert werden. Mehr dazu in der <a href="#">Datenschutzerklärung</a>. *</span></label>
        <p class="field__error field--full" id="e-consent"></p>
        <div class="form__submit field--full">
          <button class="btn btn--ink" type="submit">Anprobe anfragen</button>
          <p class="mono form__fine">* Pflichtfeld. Der Termin gilt, sobald ich ihn dir bestätige.</p>
        </div>
      </form>
    </fieldset>`;
  right.querySelector("[data-form]").addEventListener("submit", onSubmit);
  right.querySelectorAll("input, textarea").forEach((el) =>
    el.addEventListener("input", () => { if (el.getAttribute("aria-invalid") === "true") validate(el.form, el.name); }));
  renderChoice();
}

function slotEnd(date, start) {
  const s = openSlots(date, 1)[0]?.slots.find((x) => x.start === start);
  if (s) return s.end;
  const f = getContent().fitting;
  const [h, m] = start.split(":").map(Number);
  const t = h * 60 + m + Number(f.duration || 45);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function renderSuccess(b) {
  const right = root.querySelector("[data-right]");
  const p = b.product ? productById(b.product) : null;
  right.innerHTML = `
    <div class="receipt" tabindex="-1" data-success>
      <p class="receipt__stamp mono">Angefragt</p>
      <h3>Danke, ${esc(b.name.split(" ")[0])}!</h3>
      <p>Deine Anfrage liegt bei mir. Ich schaue in meinen Kalender und bestätige dir den Termin per E-Mail.</p>
      <dl class="receipt__rows">
        <div><dt>Tag</dt><dd>${esc(long(b.date))}</dd></div>
        <div><dt>Zeit</dt><dd>${esc(b.start)}–${esc(slotEnd(b.date, b.start))} Uhr</dd></div>
        ${p ? `<div><dt>Teil</dt><dd>${esc(p.name)}</dd></div>` : ""}
        ${b.note ? `<div><dt>Notiz</dt><dd>${esc(b.note)}</dd></div>` : ""}
      </dl>
      <button type="button" class="btn btn--line" data-again>Weitere Anfrage stellen</button>
    </div>`;
  right.querySelector("[data-again]").addEventListener("click", () => {
    state.sent = null;
    renderForm();
    root.querySelector(".day:not([disabled])")?.focus();
  });
  right.querySelector("[data-success]").focus({ preventScroll: true });
}

function renderDays(days) {
  const wrap = root.querySelector("[data-days]");
  if (!days.length) {
    wrap.innerHTML = `<p class="empty">Gerade sind alle Termine vergeben. Schreib mir gern, dann finden wir einen anderen Weg.</p>`;
    return;
  }
  wrap.innerHTML = days.map((d) => {
    const free = d.slots.filter((s) => s.free).length;
    const label = `${long(d.date)}, ${free ? `${free} ${free === 1 ? "Termin" : "Termine"} frei` : "ausgebucht"}`;
    return `<button type="button" class="day" data-date="${d.date}" aria-pressed="${d.date === state.date}" aria-label="${esc(label)}"${free ? "" : " disabled"}>
      <span class="day__wd">${esc(d.weekday.slice(0, 2))}</span>
      <span class="day__num">${esc(dmy(d.date))}</span>
      <span class="day__free">${free ? `${free} frei` : "voll"}</span>
    </button>`;
  }).join("");
}

function renderSlots(days) {
  const box = root.querySelector("[data-slots]");
  const label = root.querySelector("[data-daylabel]");
  const day = days.find((d) => d.date === state.date);
  if (!day) {
    label.textContent = "";
    box.innerHTML = `<p class="hint">Wähle zuerst einen Tag, dann zeige ich dir die freien Zeiten.</p>`;
    return;
  }
  label.textContent = long(day.date);
  box.innerHTML = `<div class="slots" role="group" aria-label="Uhrzeiten am ${esc(long(day.date))}">${day.slots.map((s) => `
    <button type="button" class="slot" data-start="${s.start}" aria-pressed="${s.start === state.start}"${s.free ? "" : " disabled"}
      aria-label="${esc(`${s.start} bis ${s.end} Uhr, ${s.free ? "frei" : "schon vergeben"}`)}">
      <span class="slot__time">${s.start}</span><span class="slot__end">–${s.end}</span>
      <span class="slot__state">${s.free ? (s.start === state.start ? "gewählt" : "frei") : "vergeben"}</span>
    </button>`).join("")}</div>`;
}

function renderChoice() {
  const el = root.querySelector("[data-choice]");
  if (!el) return;
  const set = state.date && state.start;
  el.classList.toggle("is-set", !!set);
  el.innerHTML = set
    ? `<span class="mono">Wunschtermin</span><strong>${esc(long(state.date))}, ${esc(state.start)}–${esc(slotEnd(state.date, state.start))} Uhr</strong>`
    : `<span class="mono">Wunschtermin</span><strong>noch offen</strong><small>Such dir zuerst einen Tag und eine freie Uhrzeit aus.</small>`;
}

function renderDynamic() {
  const days = openSlots();
  if (state.date) {
    const d = days.find((x) => x.date === state.date);
    const s = d?.slots.find((x) => x.start === state.start);
    if (!d) { state.date = null; state.start = null; state.notice = "Dieser Tag ist leider nicht mehr verfügbar. Such dir bitte einen anderen aus."; }
    else if (state.start && !s?.free) { state.start = null; state.notice = "Die gewählte Uhrzeit wurde gerade vergeben. Such dir bitte eine andere aus."; }
  }
  root.querySelector("[data-notice]").innerHTML = state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : "";
  renderDays(days);
  renderSlots(days);
  renderChoice();
}

function renderClosed() {
  root.innerHTML = `
    <div class="order order--closed">
      <div class="order__head mono" aria-hidden="true"><span>Maßblatt · Anprobe</span><span>pausiert</span></div>
      <div class="closed">
        <h3>Gerade nehme ich keine Anprobe-Termine an.</h3>
        <p>Schreib mir trotzdem gern über Etsy oder Instagram. Deine Maße kannst du mir auch einfach bei der Bestellung mitschicken, dann nähe ich alles passend für dich.</p>
        <div class="row">
          <a class="btn btn--ink" href="${SHOP.etsy}" target="_blank" rel="noopener">Nachricht über Etsy<svg class="i-ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg></a>
          <a class="btn btn--line" href="${SHOP.instagram}" target="_blank" rel="noopener">Instagram</a>
        </div>
      </div>
    </div>`;
}

function render(content) {
  const f = content.fitting;
  renderIntro(f);
  const next = f.enabled ? "open" : "closed";
  if (next !== mode) {
    mode = next;
    if (mode === "closed") { renderClosed(); return; }
    shell();
  }
  if (mode === "open") renderDynamic();
}

/* ---------- Validierung & Absenden ---------- */
const RX_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validate(form, only) {
  const errs = {};
  const v = (n) => form.elements[n].value.trim();
  if (!v("name")) errs.name = "Bitte gib deinen Namen an.";
  if (!v("email")) errs.email = "Bitte gib deine E-Mail-Adresse an.";
  else if (!RX_MAIL.test(v("email"))) errs.email = "Diese E-Mail-Adresse sieht nicht ganz richtig aus.";
  if (!form.elements.consent.checked) errs.consent = "Bitte bestätige kurz den Datenschutz-Hinweis.";
  for (const n of ["name", "email", "consent"]) {
    if (only && only !== n) continue;
    form.elements[n].setAttribute("aria-invalid", errs[n] ? "true" : "false");
    root.querySelector(`#e-${n}`).textContent = errs[n] || "";
  }
  return errs;
}

function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const errs = validate(form);
  if (!state.date || !state.start) {
    state.notice = "Bitte wähle zuerst einen Tag und eine freie Uhrzeit.";
    renderDynamic();
    const target = root.querySelector(state.date ? ".slot:not([disabled])" : ".day:not([disabled])");
    target?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    target?.focus({ preventScroll: true });
    return;
  }
  const first = Object.keys(errs)[0];
  if (first) { form.elements[first].focus(); return; }
  const still = openSlots(state.date, 1)[0]?.slots.find((s) => s.start === state.start)?.free;
  if (!still) { renderDynamic(); return; }
  const fd = new FormData(form);
  const booking = requestFitting({
    date: state.date, start: state.start,
    name: fd.get("name").trim(), email: fd.get("email").trim(), phone: fd.get("phone").trim(),
    product: fd.get("product"), note: fd.get("note").trim(),
  });
  state.sent = booking; state.date = null; state.start = null; state.notice = "";
  renderDynamic();
  renderSuccess(booking);
}

/* ---------- öffentlich ---------- */
export function initPlanner() {
  root = document.getElementById("planner");
  root.addEventListener("click", (e) => {
    const day = e.target.closest(".day");
    if (day && !day.disabled) {
      state.date = day.dataset.date; state.start = null; state.notice = "";
      renderDynamic();
      if (window.innerWidth < 900) root.querySelector("[data-slots-step]")?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
      root.querySelector(`.day[data-date="${state.date}"]`)?.focus({ preventScroll: true });
      return;
    }
    const slot = e.target.closest(".slot");
    if (slot && !slot.disabled) {
      state.start = slot.dataset.start; state.notice = "";
      renderDynamic();
      root.querySelector(`.slot[data-start="${state.start}"]`)?.focus({ preventScroll: true });
    }
  });
  render(getContent());
  subscribe(render);
}

function ensureForm() {
  if (mode === "open" && state.sent) { state.sent = null; renderForm(); }
}
const flash = (el) => el?.animate?.([{ backgroundColor: "rgba(54,89,143,.16)" }, { backgroundColor: "rgba(54,89,143,0)" }], { duration: 1600, easing: "ease-out" });
const toPlanner = () => document.getElementById("anprobe").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });

/** Aus dem Produktbogen: Produkt vorauswählen und zum Planer springen. */
export function preselectProduct(id) {
  ensureForm();
  const sel = document.getElementById("f-product");
  if (sel && productById(id)) { sel.value = id; flash(sel.closest(".field")); }
  toPlanner();
  const target = root.querySelector(".day[aria-pressed='true']") || root.querySelector(".day:not([disabled])");
  setTimeout(() => target?.focus({ preventScroll: true }), 60);
}

/** Aus „Maße nehmen“: Maßzeile in die Nachricht übernehmen (ersetzt eine frühere Maßzeile). */
export function applyMeasurements(line) {
  ensureForm();
  const note = document.getElementById("f-note");
  toPlanner();
  if (!note) return false;
  const rest = note.value.split("\n").filter((l) => !/^Meine Maße:/.test(l)).join("\n").trim();
  note.value = rest ? `${line}\n${rest}` : line;
  flash(note.closest(".field"));
  setTimeout(() => note.focus({ preventScroll: true }), 60);
  return true;
}
