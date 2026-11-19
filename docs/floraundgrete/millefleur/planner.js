// Anprobe-Planer im Stil einer Schnittmuster-Tüte: Tag → Uhrzeit → Angaben → Danke.
import { PRODUCTS, CATEGORIES, SHOP, productById } from "../shared/data.js";
import { getContent, openSlots, requestFitting, formatDate } from "../shared/store.js";
import { esc, addMinutes, prefersReducedMotion } from "./util.js";

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

export function initPlanner() {
  root = document.getElementById("planner-body");
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("submit", onSubmit);
  render(getContent());
}

export function renderPlanner(content) {
  if (!root) return;
  if (submitting) return;
  render(content, { keepFocus: true });
}

/** Aus dem Produktdialog: Produkt vorauswählen und zum Planer springen. */
export function preselectProduct(id) {
  if (productById(id)) state.form.product = id;
  state.done = null;
  render(getContent());
  // erst nach dem Schließen des Dialogs (popstate) scrollen
  setTimeout(() => {
    // einspaltig (Handy/Tablet) direkt zur Schnittmuster-Tüte, sonst zum Abschnitt
    const sec = document.getElementById(window.innerWidth < 960 ? "planner" : "anprobe");
    sec.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    const target = root.querySelector("#f-product") || root.querySelector(".day:not(:disabled)") || root;
    setTimeout(() => target.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 700);
  }, 60);
  const p = productById(id);
  if (p) announce(`${p.name} ist für deine Anprobe vorgemerkt. Such dir jetzt einen Tag aus.`);
}

function announce(text) {
  const live = document.getElementById("planner-live");
  if (live) { live.textContent = ""; setTimeout(() => (live.textContent = text), 30); }
}

/* ---------------- Rendern ---------------- */

function render(content, { keepFocus = false } = {}) {
  const f = content.fitting;
  updateIntro(f);
  const focusKey = keepFocus ? document.activeElement?.closest?.("#planner-body [data-key]")?.dataset.key : null;
  const selStart = keepFocus && document.activeElement?.selectionStart;

  let html = "";
  if (state.done) html = renderDone(f);
  else if (!f.enabled) html = renderClosed();
  else {
    const days = openSlots();
    // gewählter Tag/Slot noch gültig?
    const day = days.find((d) => d.date === state.date);
    if (state.date && !day) {
      state.date = null; state.start = null;
      state.msg = "Der gewählte Tag ist leider nicht mehr frei. Such dir bitte einen anderen aus.";
    } else if (day && state.start && !day.slots.find((s) => s.start === state.start && s.free)) {
      state.start = null;
      state.msg = "Schade – diese Uhrzeit wurde gerade vergeben. Such dir bitte eine andere aus.";
    }
    html = days.length ? renderSteps(f, days, day && days.find((d) => d.date === state.date)) : renderFull();
  }
  root.innerHTML = html + '<p class="visually-hidden" aria-live="polite" id="planner-live"></p>';

  if (focusKey) {
    const el = root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof selStart === "number" && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch { /* select */ }
    }
  }
}

function updateIntro(f) {
  const wd = [...f.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD_SHORT[d]).join(", ");
  const facts = document.getElementById("fitting-facts");
  if (facts) facts.innerHTML = `
    <li><span class="ff-ico" aria-hidden="true">📍</span><span><strong>Wo?</strong><br>${esc(f.place)}</span></li>
    <li><span class="ff-ico" aria-hidden="true">⏱</span><span><strong>Wie lange?</strong><br>etwa ${esc(f.duration)} Minuten, in Ruhe und ohne Eile</span></li>
    <li><span class="ff-ico" aria-hidden="true">📅</span><span><strong>Wann?</strong><br>${f.enabled ? `meist ${esc(wd)} · buchbar ab ${esc(f.leadDays)} Tagen im Voraus` : "gerade keine Termine"}</span></li>`;
  const size = document.querySelector(".env-size");
  if (size) size.textContent = `Dauer ${f.duration} Min. · Größe nach Maß`;
}

function measure(step) {
  const p = [18, 52, 86][step - 1];
  const items = ["Tag", "Uhrzeit", "Angaben"].map((l, i) => {
    const cls = i + 1 < step ? "is-done" : i + 1 === step ? "is-now" : "";
    return `<li class="${cls}"><span class="n">${i + 1 < step ? "✓" : i + 1}</span>${l}</li>`;
  }).join("");
  return `<div class="measure" aria-hidden="true"><div class="measure-band"><span class="measure-fill" style="--p:${p}%"></span></div><ol class="measure-steps">${items}</ol></div>
  <p class="visually-hidden">Schritt ${step} von 3</p>`;
}

function renderSteps(f, days, day) {
  const step = !state.date ? 1 : !state.start ? 2 : 3;
  let html = measure(step);
  if (state.msg) html += `<p class="planner-msg" role="status">${esc(state.msg)}</p>`;
  const pre = step < 3 && productById(state.form.product);
  if (pre) html += `<p class="planner-pre"><img src="../img/${esc(pre.hero)}" alt="" width="44" height="44" loading="lazy"><span><span class="hand">vorgemerkt:</span> ${esc(pre.name)}</span><button type="button" class="planner-pre-x" data-action="unpick" aria-label="${esc(pre.name)} nicht mehr vormerken">×</button></p>`;

  // Schritt 1: Tag
  html += `<div class="step"><h3 class="step-title"><span class="hand">1</span> Such dir einen Tag aus</h3>
    <div class="days" role="group" aria-label="Verfügbare Tage">${days.map((d) => {
      const free = d.slots.filter((s) => s.free).length;
      const [y, m, dd] = d.date.split("-").map(Number);
      const dt = new Date(y, m - 1, dd);
      const sel = d.date === state.date;
      const label = `${formatDate(d.date, { weekday: "long", day: "numeric", month: "long" })} – ${free ? `${free} ${free === 1 ? "Termin" : "Termine"} frei` : "ausgebucht"}`;
      return `<button type="button" class="day" data-key="day-${d.date}" data-date="${d.date}" aria-pressed="${sel}" aria-label="${esc(label)}"${free ? "" : " disabled"}>
        <span class="day-wd">${WD_SHORT[dt.getDay()]}</span>
        <span class="day-n">${dd}</span>
        <span class="day-m">${dt.toLocaleDateString("de-DE", { month: "short" })}</span>
        <span class="day-free">${free ? `${free} frei` : "voll"}</span>
      </button>`;
    }).join("")}</div></div>`;

  // Schritt 2: Uhrzeit
  if (day) {
    html += `<div class="step"><h3 class="step-title"><span class="hand">2</span> Wann passt es dir?</h3>
      <p class="step-hint">${esc(formatDate(day.date, { weekday: "long", day: "numeric", month: "long" }))} – jeweils ${esc(f.duration)} Minuten.</p>
      <div class="slots" role="group" aria-label="Uhrzeiten">${day.slots.map((s) => {
        const sel = s.start === state.start;
        return `<button type="button" class="slot" data-key="slot-${s.start}" data-start="${s.start}" aria-pressed="${sel}"${s.free ? "" : " disabled"}
          aria-label="${esc(`${s.start} bis ${s.end} Uhr${s.free ? "" : " – schon vergeben"}`)}">
          <span class="slot-time">${s.start} Uhr</span><small>${s.free ? `bis ${s.end}` : "schon vergeben"}</small></button>`;
      }).join("")}</div></div>`;
  }

  // Schritt 3: Formular
  if (day && state.start) html += renderForm(f, day);
  return html;
}

function productOptions(sel) {
  return `<option value="">– noch offen / einfach beraten lassen –</option>` + CATEGORIES.map((c) => `
    <optgroup label="${esc(c.label)}">${PRODUCTS.filter((p) => p.category === c.id).map((p) =>
      `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
}

function field(id, label, input, { req = false, opt = false, full = false } = {}) {
  const err = state.errors[id];
  return `<div class="field${full ? " field--full" : ""}">
    <label for="f-${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ""}${opt ? ' <span class="opt">(optional)</span>' : ""}</label>
    ${input}
    ${err ? `<p class="field-error" id="e-${id}">${esc(err)}</p>` : ""}
  </div>`;
}
const inv = (id) => (state.errors[id] ? ` aria-invalid="true" aria-describedby="e-${id}"` : "");

function renderForm(f, day) {
  const v = state.form;
  const end = addMinutes(state.start, f.duration);
  return `<form class="step" novalidate>
    <h3 class="step-title"><span class="hand">3</span> Erzähl mir kurz von dir</h3>
    <div class="form-grid">
      <p class="summary"><span class="hand">Dein Wunschtermin:</span> ${esc(formatDate(day.date, { weekday: "long", day: "numeric", month: "long" }))} · ${esc(state.start)}–${esc(end)} Uhr</p>
      ${field("name", "Name", `<input id="f-name" data-key="f-name" name="name" autocomplete="name" required value="${esc(v.name)}"${inv("name")}>`, { req: true })}
      ${field("email", "E-Mail", `<input id="f-email" data-key="f-email" name="email" type="email" autocomplete="email" required value="${esc(v.email)}"${inv("email")}>`, { req: true })}
      ${field("phone", "Telefon", `<input id="f-phone" data-key="f-phone" name="phone" type="tel" autocomplete="tel" value="${esc(v.phone)}">`, { opt: true })}
      ${field("product", "Um welches Stück geht es?", `<select id="f-product" data-key="f-product" name="product">${productOptions(v.product)}</select>`, { opt: true })}
      ${field("note", "Nachricht &amp; Maße", `<textarea id="f-note" data-key="f-note" name="note" rows="4" placeholder="z. B. Taillenumfang, Wunschlänge, Lieblingsfarbe …">${esc(v.note)}</textarea>`, { opt: true, full: true })}
      <div class="check-wrap">
        <label class="check"><input type="checkbox" id="f-consent" data-key="f-consent" name="consent"${v.consent ? " checked" : ""}${inv("consent")}>
          <span>Ich bin einverstanden, dass Cathrin meine Angaben speichert, um den Termin mit mir abzusprechen. Mehr dazu in der <a href="#">Datenschutzerklärung</a>. <span class="req" aria-hidden="true">*</span></span></label>
        ${state.errors.consent ? `<p class="field-error" id="e-consent">${esc(state.errors.consent)}</p>` : ""}
      </div>
      <div class="form-actions">
        <button class="btn btn-wine btn-lg" type="submit" data-key="submit">Anprobe anfragen</button>
        <p><span aria-hidden="true">*</span> Pflichtfelder · unverbindlich</p>
      </div>
    </div>
  </form>`;
}

function renderDone(f) {
  const b = state.done;
  const p = productById(b.product);
  return `<div class="success" tabindex="-1" id="planner-success">
    <img class="success-dog" src="../img/member-2.webp" alt="Struppi freut sich mit" width="1120" height="1400">
    <h3>Danke, ${esc(b.name.split(" ")[0])}!</h3>
    <p>Deine Anfrage ist bei Cathrin. Sie bestätigt dir den Termin per E-Mail.</p>
    <p class="summary"><span class="hand">Angefragt:</span> ${esc(formatDate(b.date, { weekday: "long", day: "numeric", month: "long" }))} · ${esc(b.start)}–${esc(addMinutes(b.start, f.duration))} Uhr${p ? ` · ${esc(p.name)}` : ""}</p>
    <p class="hand-note">Struppi hält schon mal den Platz warm. ♡</p>
    <p style="margin-top:22px"><button class="btn btn-ghost" type="button" data-action="again">Noch einen Termin anfragen</button></p>
  </div>`;
}

function renderClosed() {
  return `<div class="closed-note">
    <span class="hand">Gerade mache ich eine kleine Anprobe-Pause.</span>
    <p>Im Moment plane ich keine Termine im Atelier. Schreib mir gern über Etsy oder Instagram – wir finden bestimmt eine Lösung, und Maße kannst du mir auch einfach schicken.</p>
    <a class="btn btn-wine" href="${esc(SHOP.etsy)}" target="_blank" rel="noopener">Nachricht über Etsy <span aria-hidden="true">↗</span></a>
  </div>`;
}

function renderFull() {
  return `<div class="closed-note">
    <span class="hand">Alles ausgebucht – das freut mich und tut mir leid.</span>
    <p>In den nächsten Wochen ist leider jeder Termin vergeben. Schau bald wieder vorbei oder schreib mir, dann finden wir etwas.</p>
    <a class="btn btn-wine" href="${esc(SHOP.etsy)}" target="_blank" rel="noopener">Nachricht über Etsy <span aria-hidden="true">↗</span></a>
  </div>`;
}

/* ---------------- Ereignisse ---------------- */

function onClick(e) {
  const day = e.target.closest(".day");
  const slot = e.target.closest(".slot");
  const again = e.target.closest('[data-action="again"]');
  if (e.target.closest('[data-action="unpick"]')) {
    state.form.product = "";
    render(getContent());
    root.querySelector(".day:not(:disabled)")?.focus({ preventScroll: true });
    return;
  }
  if (day && !day.disabled) {
    const same = state.date === day.dataset.date;
    state.date = day.dataset.date;
    if (!same) state.start = null;
    state.msg = "";
    render(getContent());
    root.querySelector(`[data-key="day-${state.date}"]`)?.focus({ preventScroll: true });
    announce(`${formatDate(state.date, { weekday: "long", day: "numeric", month: "long" })} gewählt. Jetzt eine Uhrzeit aussuchen.`);
    const step2 = root.querySelectorAll(".step")[1];
    if (step2 && window.innerWidth < 960) step2.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
  } else if (slot && !slot.disabled) {
    state.start = slot.dataset.start;
    state.msg = "";
    render(getContent());
    root.querySelector(`[data-key="slot-${state.start}"]`)?.focus({ preventScroll: true });
    announce(`${state.start} Uhr gewählt. Jetzt noch deine Angaben eintragen.`);
    const form = root.querySelector("form");
    if (form) form.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
  } else if (again) {
    state.done = null; state.date = null; state.start = null; state.errors = {};
    state.form = { ...state.form, note: "", product: "", consent: false };
    render(getContent());
    root.querySelector(".day:not(:disabled)")?.focus();
  }
}

function onInput(e) {
  const t = e.target;
  if (!t.name || !(t.name in state.form)) return;
  state.form[t.name] = t.type === "checkbox" ? t.checked : t.value;
  if (state.errors[t.name]) {
    delete state.errors[t.name];
    t.removeAttribute("aria-invalid");
    t.closest(".field, .check-wrap")?.querySelector(".field-error")?.remove();
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
    const first = Object.keys(state.errors)[0];
    root.querySelector(`#f-${first}`)?.focus();
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
  const ok = root.querySelector("#planner-success");
  document.getElementById("planner").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  ok?.focus({ preventScroll: true });
}
