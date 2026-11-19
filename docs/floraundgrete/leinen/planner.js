// Anprobe-Planer: Tag → Uhrzeit → Angaben. Daten kommen live aus dem gemeinsamen Store.
import { PRODUCTS, CATEGORIES, SHOP, productById } from "../shared/data.js";
import { getContent, openSlots, requestFitting, formatDate, subscribe, WEEKDAYS } from "../shared/store.js";
import { esc, ICON } from "./util.js";

const state = { date: null, start: null, sent: null, notice: "" };
let root, mode = null;

const short = (iso) => formatDate(iso, { weekday: "short", day: "numeric", month: "long" });
const long = (iso) => formatDate(iso, { weekday: "long", day: "numeric", month: "long" });
const shortWd = (n) => WEEKDAYS[n].slice(0, 2);

function weekdayList(wds) {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => wds.includes(d)).map(shortWd);
  return order.length > 1 ? `${order.slice(0, -1).join(", ")} & ${order.at(-1)}` : order.join("");
}

function renderIntro(f) {
  const el = document.getElementById("planner-intro");
  el.innerHTML = `
    <p>Bei einer Anprobe nehmen wir in Ruhe Maß, du fühlst die Stoffe und probierst Röcke und Kleider an. Such dir einen freien Termin aus, ich melde mich dann persönlich bei dir.</p>
    <ul>
      <li><b>Wo</b> ${esc(f.place)}</li>
      <li><b>Dauer</b> ca. ${esc(f.duration)} Minuten</li>
      ${f.enabled ? `<li><b>Wann</b> ${esc(weekdayList(f.weekdays))}</li>` : ""}
    </ul>`;
}

function productOptions() {
  return CATEGORIES.map((c) => {
    const opts = PRODUCTS.filter((p) => p.category === c.id).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    return `<optgroup label="${esc(c.label)}">${opts}</optgroup>`;
  }).join("");
}

function shell() {
  root.innerHTML = `
  <div class="book">
    <div class="book__page">
      <div class="book__step"><b>1</b><h3>Tag wählen</h3><span data-wd></span></div>
      <div data-notice></div>
      <div class="days" data-days role="group" aria-label="Verfügbare Tage"></div>
      <div class="slots-block">
        <div class="book__step"><b>2</b><h3>Uhrzeit</h3><span data-daylabel></span></div>
        <div data-slots></div>
      </div>
    </div>
    <div class="book__page" data-right></div>
  </div>`;
  renderForm();
}

function renderForm() {
  const right = root.querySelector("[data-right]");
  right.innerHTML = `
    <div class="book__step"><b>3</b><h3>Deine Angaben</h3></div>
    <div class="choice" data-choice aria-live="polite"></div>
    <form class="form" novalidate data-form>
      <div class="field"><label for="f-name">Name *</label><input id="f-name" name="name" autocomplete="name" required aria-describedby="e-name"><p class="field__error" id="e-name"></p></div>
      <div class="field"><label for="f-email">E-Mail *</label><input id="f-email" name="email" type="email" autocomplete="email" required aria-describedby="e-email"><p class="field__error" id="e-email"></p></div>
      <div class="field"><label for="f-phone">Telefon <span class="opt">(optional)</span></label><input id="f-phone" name="phone" type="tel" autocomplete="tel"></div>
      <div class="field"><label for="f-product">Produkt <span class="opt">(optional)</span></label>
        <select id="f-product" name="product"><option value="">Noch offen / mehrere</option>${productOptions()}</select></div>
      <div class="field field--full"><label for="f-note">Nachricht &amp; Maße <span class="opt">(optional)</span></label>
        <textarea id="f-note" name="note" rows="3" placeholder="z. B. Taillenumfang, Wunschlänge, Lieblingsfarbe …"></textarea></div>
      <label class="check"><input type="checkbox" name="consent" required aria-describedby="e-consent">
        <span>Ich bin einverstanden, dass meine Angaben zur Terminabsprache gespeichert werden. Mehr dazu in der <a href="#">Datenschutzerklärung</a>. *<span class="field__error" id="e-consent" style="display:block"></span></span></label>
      <div class="form__submit">
        <button class="btn btn--terra" type="submit">Anprobe anfragen</button>
        <small>* Pflichtfeld · Der Termin ist erst fest, wenn ich ihn dir bestätige.</small>
      </div>
    </form>`;
  right.querySelector("[data-form]").addEventListener("submit", onSubmit);
  right.querySelectorAll("input, textarea").forEach((el) =>
    el.addEventListener("input", () => { if (el.getAttribute("aria-invalid") === "true") validate(el.form, el.name); }));
  renderChoice();
}

function renderSuccess(b) {
  const right = root.querySelector("[data-right]");
  const p = b.product ? productById(b.product) : null;
  const end = slotEnd(b.date, b.start);
  right.innerHTML = `
    <div class="success" tabindex="-1" data-success>
      <div class="success__seal">${ICON.check}</div>
      <p class="eyebrow">Anfrage verschickt</p>
      <h3>Danke, ${esc(b.name.split(" ")[0])}!</h3>
      <p>Deine Anfrage ist bei Cathrin. Sie bestätigt dir den Termin per E-Mail.</p>
      <p class="success__ticket"><span class="nowrap">${esc(long(b.date))}</span> · <span class="nowrap">${esc(b.start)}${end ? `–${esc(end)}` : ""} Uhr</span>${p ? `<br><small>${esc(p.name)}</small>` : ""}</p>
      <button type="button" class="btn btn--ghost" data-again>Weitere Anfrage stellen</button>
    </div>`;
  right.querySelector("[data-again]").addEventListener("click", () => {
    state.sent = null;
    renderForm();
    root.querySelector(".day:not([disabled])")?.focus();
  });
  right.querySelector("[data-success]").focus({ preventScroll: true });
}

function slotEnd(date, start) {
  const d = openSlots(date, 1)[0];
  const s = d?.slots.find((x) => x.start === start);
  if (s) return s.end;
  const f = getContent().fitting;
  const [h, m] = start.split(":").map(Number);
  const t = h * 60 + m + Number(f.duration || 45);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function renderDays(days) {
  const wrap = root.querySelector("[data-days]");
  if (!days.length) {
    wrap.innerHTML = `<p class="empty" style="grid-column:1/-1">Gerade sind alle Termine vergeben. Schreib mir gern, dann finden wir einen anderen Weg.</p>`;
    return;
  }
  wrap.innerHTML = days.map((d) => {
    const free = d.slots.filter((s) => s.free).length;
    const [, , dd] = d.date.split("-");
    const mon = formatDate(d.date, { month: "short" });
    const label = `${long(d.date)}, ${free ? `${free} ${free === 1 ? "Termin" : "Termine"} frei` : "ausgebucht"}`;
    return `<button type="button" class="day" data-date="${d.date}" aria-pressed="${d.date === state.date}" aria-label="${esc(label)}"${free ? "" : " disabled"}>
      <span class="day__wd">${esc(d.weekday.slice(0, 2))}</span>
      <span class="day__num">${Number(dd)}</span>
      <span class="day__mon">${esc(mon)}</span>
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
      <span class="slot__time">${s.start}</span>
      <span class="slot__line">bis ${s.end} Uhr</span>
      <span class="slot__state">${s.free ? (s.start === state.start ? "gewählt" : "frei") : "vergeben"}</span>
    </button>`).join("")}</div>`;
}

function renderChoice() {
  const el = root.querySelector("[data-choice]");
  if (!el) return;
  if (state.date && state.start) {
    el.classList.add("is-set");
    el.innerHTML = `<span class="choice__icon" aria-hidden="true">✓</span><p><small>Dein Wunschtermin</small><strong>${esc(short(state.date))} · ${esc(state.start)}–${esc(slotEnd(state.date, state.start))} Uhr</strong></p>`;
  } else {
    el.classList.remove("is-set");
    el.innerHTML = `<span class="choice__icon" aria-hidden="true">?</span><p><small>Noch kein Termin gewählt</small>Such dir zuerst einen Tag und eine freie Uhrzeit aus.</p>`;
  }
}

function renderDynamic() {
  const f = getContent().fitting;
  root.querySelector("[data-wd]").textContent = weekdayList(f.weekdays);
  const days = openSlots();
  // Ist die Auswahl noch frei? (Kann sich durch Buchungen in anderen Tabs ändern.)
  if (state.date) {
    const d = days.find((x) => x.date === state.date);
    const s = d?.slots.find((x) => x.start === state.start);
    if (!d) { state.date = null; state.start = null; state.notice = "Dieser Tag ist leider nicht mehr verfügbar. Such dir bitte einen anderen aus."; }
    else if (state.start && !s?.free) { state.start = null; state.notice = "Die gewählte Uhrzeit wurde gerade vergeben. Such dir bitte eine andere aus."; }
  }
  const noticeEl = root.querySelector("[data-notice]");
  noticeEl.innerHTML = state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : "";
  renderDays(days);
  renderSlots(days);
  renderChoice();
}

function renderClosed() {
  root.innerHTML = `
    <div class="closed-card">
      <p class="eyebrow">Anprobe pausiert</p>
      <h3>Gerade nehme ich keine Anprobe-Termine an.</h3>
      <p>Schreib mir trotzdem gern über Etsy oder Instagram. Maße kannst du mir auch einfach bei der Bestellung mitschicken, dann nähe ich alles passend für dich.</p>
      <div class="row">
        <a class="btn btn--primary" href="${SHOP.etsy}" target="_blank" rel="noopener">Nachricht über Etsy <span aria-hidden="true">↗</span></a>
        <a class="btn btn--ghost" href="${SHOP.instagram}" target="_blank" rel="noopener">Instagram</a>
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
    const el = form.elements[n];
    el.setAttribute("aria-invalid", errs[n] ? "true" : "false");
    form.querySelector(`#e-${n}`).textContent = errs[n] || "";
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
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
    return;
  }
  const first = Object.keys(errs)[0];
  if (first) { form.elements[first].focus(); return; }
  // Letzter Check, ob der Slot noch frei ist
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
      if (window.innerWidth < 960) root.querySelector(".slots-block")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

/** Aus der Produktansicht: Produkt vorauswählen und zum Planer springen. */
export function preselectProduct(id) {
  const section = document.getElementById("anprobe");
  if (mode === "open" && state.sent) { state.sent = null; renderForm(); }
  const sel = document.getElementById("f-product");
  if (sel && productById(id)) {
    sel.value = id;
    sel.closest(".field")?.animate?.([{ backgroundColor: "#EFDDD2" }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
  }
  section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  const target = root.querySelector(".day[aria-pressed='true']") || root.querySelector(".day:not([disabled])");
  setTimeout(() => target?.focus({ preventScroll: true }), 50);
}
