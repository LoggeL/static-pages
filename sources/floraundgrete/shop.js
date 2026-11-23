// Shop auf der Website: Artikel, Detailansicht, Warenkorb, Kasse.
// Mit Worker: Kasse über Stripe (Preise rechnet der Server). Ohne Worker (GitHub Pages): Klick-Prototyp mit simulierter Kasse.
// Bewegung: ruhig und warm wie das Atelier am Abend. Alles respektiert "Bewegung reduzieren".
import { shopProducts, shopSettings, placeLocalOrder, imageSrc, activePause, update } from "./shared/store.js";
import { priceCart, availableOf, availabilityText, euro, deliveryOptions, MAX_QTY, NOTE_MAX, normalizeProduct } from "./shared/shop-core.js";
import { backend, api } from "./shared/api.js";
import { DIMS } from "./dims.js";
import { $, $$, esc, trapFocus, reduceMotion } from "./util.js";

const CART_KEY = "fg-cart-v1";
const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const EASE_IO = "cubic-bezier(0.65, 0, 0.35, 1)";

const grid = $("#wares");
const wareEl = $("#ware");
const cartEl = $("#cart");
const cartBtn = $("#cart-btn");
const live = $("#shop-live");

let filter = "alle";
let cart = readCart();
let step = "cart"; // 'cart' | 'details' | 'done'
let doneInfo = null;
let notice = "";
let busy = false;
let turnstileId = null;
let vtNames = false; // Kartennamen nur während des Filterwechsels (sonst lägen Karten beim Öffnen über dem Schleier)

// ---------- Hilfen ----------
const motion = () => !reduceMotion();
const canVT = () => motion() && typeof document.startViewTransition === "function";
const announce = (t) => { live.textContent = ""; requestAnimationFrame(() => { live.textContent = t; }); };
const productById = (id) => shopProducts().find((p) => p.id === id);
const paused = () => !!activePause();
const madeToOrder = (p) => p.stock === null;
const orderable = (p) => !(availableOf(p) === 0 || (madeToOrder(p) && paused()));
/** "ab Januar wieder" aus dem Ende der Auftragspause */
function resumeText() {
  const until = activePause()?.until;
  if (!until) return "gerade pausiert";
  const [y, m, d] = until.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `ab ${next.toLocaleDateString("de-DE", next.getDate() === 1 ? { month: "long" } : { day: "numeric", month: "long" })} wieder`;
}

function pic(file, alt, { cls = "", eager = false, sizes = "" } = {}) {
  const [w, h] = DIMS[file] || [1000, 1250];
  return `<img src="${esc(imageSrc(file))}" width="${w}" height="${h}" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ""}${sizes ? ` sizes="${sizes}"` : ""} loading="${eager ? "eager" : "lazy"}" decoding="async">`;
}

function readCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || "null");
    if (raw && Array.isArray(raw.lines)) return { lines: raw.lines.slice(0, 20), delivery: raw.delivery || "" };
  } catch { /* privat */ }
  return { lines: [], delivery: "" };
}
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* privat */ }
  syncCount();
}
const lineKey = (l) => `${l.id}|${l.option || ""}|${l.note || ""}`;
const count = () => cart.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

function chosenDelivery(settings = shopSettings()) {
  const opts = deliveryOptions(settings);
  return opts.includes(cart.delivery) ? cart.delivery : opts[0] || "";
}

// ---------- Overlays (Artikel, Warenkorb) ----------
let openStack = [];
const BACKGROUND = ["#banner-slot", ".skip", "#head", "#menu", "#main", ".foot"];

function lockPage(on) {
  const root = document.documentElement;
  if (on) {
    // Scrollleiste ausgleichen, damit nichts springt
    const sb = innerWidth - root.clientWidth;
    root.style.setProperty("--sb", `${sb}px`);
    root.classList.add("ov-open");
  } else {
    root.classList.remove("ov-open");
    root.style.removeProperty("--sb");
  }
  BACKGROUND.forEach((s) => $$(s).forEach((el) => { el.inert = on; }));
}

function showOverlay(el, { instant = false } = {}) {
  if (!openStack.includes(el)) {
    openStack.forEach((o) => { o.inert = true; });
    openStack.push(el);
  }
  lockPage(true);
  el.hidden = false;
  el.inert = false;
  el.classList.toggle("is-instant", instant);
  if (instant) el.classList.add("is-open");
  else requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-open")));
}

function hideOverlay(el, { instant = false } = {}) {
  return new Promise((resolve) => {
    if (el.hidden) return resolve();
    const done = () => {
      el.hidden = true;
      el.classList.remove("is-closing", "is-instant");
      openStack = openStack.filter((o) => o !== el);
      const top = openStack[openStack.length - 1];
      if (top) top.inert = false;
      else lockPage(false);
      resolve();
    };
    el.classList.remove("is-open");
    if (instant || !motion()) return done();
    el.classList.add("is-closing");
    setTimeout(done, 420);
  });
}

document.addEventListener("keydown", (e) => {
  const top = openStack[openStack.length - 1];
  if (!top) return;
  if (e.key === "Escape") { e.preventDefault(); top === wareEl ? closeWare() : closeCart(); return; }
  trapFocus(top, e);
});
[wareEl, cartEl].forEach((el) => el.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) el === wareEl ? closeWare() : closeCart();
}));

// ---------- Artikelliste ----------
const FILTERS = [
  { id: "alle", label: "Alle" },
  { id: "sofort", label: "Sofort lieferbar", test: (p) => !madeToOrder(p) && availableOf(p) > 0 },
  { id: "mass", label: "Auf Maß genäht", test: (p) => madeToOrder(p) },
];

export function renderShop() {
  const settings = shopSettings();
  const all = shopProducts();
  const show = settings.enabled && all.length > 0;
  $("#shop").hidden = !show;
  $$("[data-shop-link]").forEach((li) => { li.hidden = !show; });
  $("#hero-shop").hidden = !show;
  cartBtn.hidden = !show && count() === 0;
  syncCount();
  if (!show) return;

  // Versandinfo
  const s = settings;
  const bits = [];
  if (s.shipping.enabled) bits.push(s.shipping.flat ? `Versand ${euro(s.shipping.flat)}${s.shipping.freeFrom ? `, ab ${euro(s.shipping.freeFrom)} kostenlos` : ""}` : "Versand kostenlos");
  if (s.pickup.enabled) bits.push("Abholung in Ramsen möglich");
  $("#shop-ship").textContent = bits.join(" · ");

  // Filter nur, wenn es beides gibt
  const kinds = FILTERS.slice(1).filter((f) => all.some(f.test));
  const fbox = $("#shop-filter");
  if (kinds.length < 2) { fbox.hidden = true; filter = "alle"; }
  else {
    fbox.hidden = false;
    if (!FILTERS.some((f) => f.id === filter)) filter = "alle";
    fbox.innerHTML = FILTERS.map((f) => `<button type="button" class="chip" role="radio" aria-checked="${f.id === filter}" data-filter="${f.id}" tabindex="${f.id === filter ? 0 : -1}">${esc(f.label)}</button>`).join("");
  }

  const f = FILTERS.find((x) => x.id === filter);
  const list = f.test ? all.filter(f.test) : all;
  const wasIn = grid.classList.contains("is-in");
  grid.innerHTML = list.map((p, i) => wareCard(p, i)).join("");
  $("#shop-empty").hidden = list.length > 0;
  if (wasIn) grid.classList.add("is-in");
}

function wareCard(p, i) {
  const [a, b] = p.images;
  const avail = paused() && madeToOrder(p) ? `Maßanfertigung ${resumeText()}` : availabilityText(p);
  const out = !orderable(p);
  const tag = p.stock === 1 && !out ? "Einzelstück" : madeToOrder(p) && !out ? "Auf Maß" : out ? (availableOf(p) === 0 ? "Ausverkauft" : "Pause") : "";
  return `<li class="ware${out ? " is-out" : ""}" data-id="${esc(p.id)}" style="--i:${Math.min(i, 8)}${vtNames ? `; view-transition-name: ware-${esc(p.id)}` : ""}">
    <a class="ware__hit" href="#artikel-${esc(p.id)}" data-ware="${esc(p.id)}">
      <figure class="ware__media">
        ${a ? pic(a, "", { cls: "ware__img", sizes: "(max-width: 760px) 50vw, 25vw" }) : ""}
        ${b ? pic(b, "", { cls: "ware__img ware__img--alt", sizes: "(max-width: 760px) 50vw, 25vw" }) : ""}
        ${tag ? `<span class="ware__tag">${esc(tag)}</span>` : ""}
      </figure>
      <span class="ware__body">
        <span class="ware__name">${esc(p.name)}</span>
        ${p.subtitle ? `<span class="ware__sub">${esc(p.subtitle)}</span>` : ""}
        <span class="ware__row"><span class="price">${euro(p.price)}</span><span class="ware__avail">${esc(avail)}</span></span>
      </span>
    </a>
  </li>`;
}

function setFilter(id) {
  if (id === filter) return;
  filter = id;
  const apply = () => renderShop();
  if (canVT()) {
    vtNames = true;
    document.documentElement.classList.add("vt-filter");
    $$(".ware", grid).forEach((li) => { li.style.viewTransitionName = `ware-${li.dataset.id}`; });
    const vt = document.startViewTransition(apply);
    vt.finished.finally(() => { vtNames = false; document.documentElement.classList.remove("vt-filter"); $$(".ware", grid).forEach((li) => { li.style.viewTransitionName = ""; }); });
  } else apply();
  $(`#shop-filter [data-filter="${id}"]`)?.focus();
  const n = grid.children.length;
  announce(`${n} ${n === 1 ? "Artikel" : "Artikel"} gezeigt`);
}

$("#shop-filter").addEventListener("click", (e) => { const b = e.target.closest("[data-filter]"); if (b) setFilter(b.dataset.filter); });
$("#shop-filter").addEventListener("keydown", (e) => {
  if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
  const ids = $$("#shop-filter [data-filter]").map((b) => b.dataset.filter);
  const i = ids.indexOf(filter);
  e.preventDefault();
  setFilter(ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]);
});

// Karten blenden nacheinander ein, sobald der Shop ins Bild kommt
function initReveal() {
  if (!motion() || !("IntersectionObserver" in window)) { grid.classList.add("is-in"); return; }
  grid.classList.add("will-reveal");
  const io = new IntersectionObserver((en) => {
    if (en.some((x) => x.isIntersecting)) { grid.classList.add("is-in"); io.disconnect(); }
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.02 });
  io.observe(grid);
}

grid.addEventListener("click", (e) => {
  const a = e.target.closest("[data-ware]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  openWare(a.dataset.ware, { origin: a });
});

// ---------- Artikel-Ansicht ----------
let current = null;
let slide = 0;
let lastFocus = null;
let originCard = null;

function wareInfo(p) {
  const s = shopSettings();
  const pause = madeToOrder(p) && paused();
  const avail = availableOf(p);
  const kicker = pause ? `Maßanfertigung ${resumeText()}` : availabilityText(p);
  const maxQty = Math.min(MAX_QTY, avail === null ? MAX_QTY : avail);
  const opts = p.optionValues.length ? `
    <fieldset class="opts">
      <legend class="opts__label">${esc(p.optionLabel || "Variante")}</legend>
      <div class="opts__list">${p.optionValues.map((v, i) => `
        <label class="opt"><input type="radio" name="option" value="${esc(v)}"${p.optionValues.length === 1 && i === 0 ? " checked" : ""}><span>${esc(v)}</span></label>`).join("")}
      </div>
      <p class="ware-form__err" data-err="option" hidden></p>
    </fieldset>` : "";
  const note = p.noteLabel ? `
    <div class="field ware-form__note">
      <label for="ware-note">${esc(p.noteLabel)}</label>
      <input id="ware-note" name="note" maxlength="${NOTE_MAX}" autocomplete="off" placeholder="z. B. Taille 74 cm, Länge knieumspielend" aria-describedby="ware-note-err">
      <p class="ware-form__err" id="ware-note-err" data-err="note" hidden></p>
    </div>` : "";
  const qty = maxQty > 1 ? `
    <div class="qty" role="group" aria-label="Menge">
      <button type="button" class="qty__b" data-q="-1" aria-label="Eins weniger">−</button>
      <span class="qty__n" aria-live="polite"><span>1</span></span>
      <button type="button" class="qty__b" data-q="1" aria-label="Eins mehr">+</button>
    </div>` : "";
  const tax = s.smallBusiness ? "Endpreis, keine Umsatzsteuer nach § 19 UStG" : "inkl. MwSt.";
  const ship = s.shipping.enabled ? `zzgl. <button type="button" class="link-btn ware-view__shiplink" data-open-cart-info>Versand</button>` : "";
  return `
    <p class="kicker ware-view__kicker">${esc(kicker)}</p>
    <h2 class="ware-view__title" id="ware-title" tabindex="-1">${esc(p.name)}</h2>
    ${p.subtitle ? `<p class="ware-view__sub">${esc(p.subtitle)}</p>` : ""}
    <p class="ware-view__price"><span class="price">${euro(p.price)}</span> <small>${tax}${ship ? `, ${ship}` : ""}</small></p>
    ${p.description ? `<p class="ware-view__desc">${esc(p.description)}</p>` : ""}
    ${orderable(p) ? `
    <form class="ware-form" novalidate data-max="${maxQty}">
      ${opts}${note}
      <div class="ware-form__actions">
        ${qty}
        <button type="submit" class="btn btn--brass btn--lg ware-form__add">
          <span class="ware-form__label">In den Warenkorb</span>
          <span class="ware-form__added" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Im Warenkorb</span>
        </button>
      </div>
      <div class="ware-form__next" hidden>
        <button type="button" class="btn btn--brass" data-go-cart>Zum Warenkorb</button>
        <button type="button" class="btn btn--ghost" data-close>Weiter stöbern</button>
      </div>
    </form>` : `<p class="ware-view__out">${pause ? "Bis zum Ende der Auftragspause nähe ich nichts Neues auf Bestellung. Schreib mir gern auf Instagram, dann melde ich mich, sobald es wieder geht." : "Dieses Stück ist leider gerade weg. Frag mich gern, ob ich es noch einmal nähen kann."}</p>`}
    ${p.details.length ? `<ul class="ware-view__details">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
    ${madeToOrder(p) && s.legalNote ? `<p class="ware-view__legal">${esc(s.legalNote)}</p>` : ""}`;
}

function fillWare(p) {
  current = p;
  slide = 0;
  const imgs = p.images.length ? p.images : [];
  $("#ware-slides").innerHTML = imgs.map((f, i) => `<li class="ware-view__slide${i === 0 ? " is-on" : ""}" aria-hidden="${i !== 0}">${pic(f, i === 0 ? p.name : `${p.name}, Foto ${i + 1}`, { eager: i === 0, sizes: "(max-width: 760px) 100vw, 55vw" })}</li>`).join("");
  $("#ware-dots").innerHTML = imgs.length > 1 ? imgs.map((_, i) => `<button type="button" class="dot" data-slide="${i}" aria-label="Foto ${i + 1} von ${imgs.length}" aria-current="${i === 0}"></button>`).join("") : "";
  $("#ware-stage").classList.toggle("has-many", imgs.length > 1);
  $("#ware-info").innerHTML = wareInfo(p);
  $("#ware-info").scrollTop = 0;
  bindForm();
}

function goSlide(i) {
  const slides = $$("#ware-slides > li");
  if (!slides.length) return;
  slide = (i + slides.length) % slides.length;
  slides.forEach((li, n) => { li.classList.toggle("is-on", n === slide); li.setAttribute("aria-hidden", String(n !== slide)); });
  $$("#ware-dots .dot").forEach((d, n) => d.setAttribute("aria-current", String(n === slide)));
}
$("#ware-dots").addEventListener("click", (e) => { const d = e.target.closest("[data-slide]"); if (d) goSlide(+d.dataset.slide); });
$("#ware-stage").addEventListener("click", (e) => {
  if (e.target.closest(".dot") || $$("#ware-slides > li").length < 2) return;
  const r = e.currentTarget.getBoundingClientRect();
  goSlide(slide + (e.clientX - r.left < r.width / 3 ? -1 : 1));
});
// Wischen auf dem Handy
let touchX = null;
$("#ware-stage").addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$("#ware-stage").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 40) goSlide(slide + (dx < 0 ? 1 : -1));
});
wareEl.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "ArrowRight") goSlide(slide + 1);
  if (e.key === "ArrowLeft") goSlide(slide - 1);
});

function openWare(id, { origin = null, push = true } = {}) {
  const p = productById(id);
  if (!p) return;
  lastFocus = document.activeElement;
  originCard = origin;
  if (push && location.hash !== `#artikel-${id}`) history.pushState({ ware: id }, "", `#artikel-${id}`);
  const cardImg = origin && $(".ware__img", origin);
  const reveal = () => {
    fillWare(p);
    showOverlay(wareEl, { instant: !!cardImg && canVT() });
    const first = $("#ware-slides .ware-view__slide img");
    if (first && cardImg && canVT()) first.style.viewTransitionName = "ware-photo";
  };
  if (cardImg && canVT()) {
    // Das Kartenfoto gleitet in die große Ansicht
    cardImg.style.viewTransitionName = "ware-photo";
    const vt = document.startViewTransition(() => { cardImg.style.viewTransitionName = ""; reveal(); });
    vt.finished.finally(() => { const f = $("#ware-slides img"); if (f) f.style.viewTransitionName = ""; focusTitle(); });
  } else {
    reveal();
    focusTitle();
  }
  document.title = `${p.name} · Cathrin Raasch Atelier`;
}
function focusTitle() { $("#ware-title")?.focus({ preventScroll: true }); }

const BASE_TITLE = document.title;
async function closeWare({ fromHistory = false } = {}) {
  if (wareEl.hidden) return;
  if (!fromHistory && /^#artikel-/.test(location.hash)) history.replaceState(null, "", "#shop");
  document.title = BASE_TITLE;
  const id = current && current.id;
  const card = id && $(`[data-ware="${CSS.escape(id)}"] .ware__img`, grid);
  const stageImg = $("#ware-slides .is-on img");
  const visible = card && card.getBoundingClientRect().bottom > 0 && card.getBoundingClientRect().top < innerHeight;
  if (card && visible && stageImg && canVT() && !openStack.includes(cartEl)) {
    stageImg.style.viewTransitionName = "ware-photo";
    const vt = document.startViewTransition(async () => {
      stageImg.style.viewTransitionName = "";
      card.style.viewTransitionName = "ware-photo";
      await hideOverlay(wareEl, { instant: true });
    });
    await vt.finished.catch(() => {});
    card.style.viewTransitionName = "";
  } else {
    await hideOverlay(wareEl);
  }
  const back = (originCard && originCard.isConnected) ? originCard : (id && $(`[data-ware="${CSS.escape(id)}"]`, grid)) || lastFocus;
  if (back && back.isConnected && !openStack.length) back.focus({ preventScroll: true });
}

function fromHash() {
  const m = location.hash.match(/^#artikel-([\w-]+)$/);
  if (m && productById(m[1])) {
    if (wareEl.hidden || current?.id !== m[1]) openWare(m[1], { push: false });
  } else if (!wareEl.hidden) closeWare({ fromHistory: true });
}
addEventListener("popstate", fromHash);
addEventListener("hashchange", fromHash);

// ---------- In den Warenkorb ----------
function bindForm() {
  const form = $(".ware-form", wareEl);
  if (!form) return;
  const max = Number(form.dataset.max) || 1;
  let qty = 1;
  const qn = $(".qty__n", form);
  const setQty = (n, dir) => {
    const next = Math.max(1, Math.min(max, n));
    if (next === qty) { if (qn) wiggle(qn); return; }
    qty = next;
    if (qn) rollNumber(qn, String(qty), dir);
    $$(".qty__b", form).forEach((b) => { b.disabled = (b.dataset.q === "-1" && qty <= 1) || (b.dataset.q === "1" && qty >= max); });
  };
  $$(".qty__b", form).forEach((b) => b.addEventListener("click", () => setQty(qty + Number(b.dataset.q), Number(b.dataset.q))));
  setQty(1, 0);
  $$("input", form).forEach((i) => i.addEventListener("input", () => clearErr(form, i.name)));
  $("[data-go-cart]", form)?.addEventListener("click", async () => { await closeWare(); openCart(); });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const p = current;
    const option = $("input[name=option]:checked", form)?.value || "";
    const note = ($("input[name=note]", form)?.value || "").trim();
    let bad = null;
    if (p.optionValues.length && !option) { showErr(form, "option", `Bitte wähle eine ${p.optionLabel || "Variante"}.`); bad = bad || $("input[name=option]", form); }
    if (p.noteLabel && !note) { showErr(form, "note", `Bitte gib an: ${p.noteLabel}.`); bad = bad || $("input[name=note]", form); }
    if (bad) { bad.focus(); return; }
    const line = { id: p.id, option, note, qty };
    const key = lineKey(line);
    const existing = cart.lines.find((l) => lineKey(l) === key);
    const already = cart.lines.filter((l) => l.id === p.id).reduce((s, l) => s + l.qty, 0);
    const avail = availableOf(p);
    if (avail !== null && already + qty > avail) {
      showErr(form, p.noteLabel ? "note" : "option", avail === already ? "Mehr davon habe ich gerade nicht – es liegt schon alles in deinem Warenkorb." : `Es sind nur noch ${avail} da, ${already} davon liegen schon in deinem Warenkorb.`);
      return;
    }
    if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + qty);
    else cart.lines.push(line);
    saveCart();
    cartBtn.hidden = false;
    flyToCart();
    const btn = $(".ware-form__add", form);
    btn.classList.add("is-added");
    announce(`${p.name} liegt im Warenkorb. ${count()} ${count() === 1 ? "Artikel" : "Artikel"} insgesamt.`);
    setTimeout(() => {
      const next = $(".ware-form__next", form);
      if (!next || !form.isConnected) return;
      const actions = $(".ware-form__actions", form);
      swap(actions, next).then(() => $("[data-go-cart]", next).focus());
    }, motion() ? 650 : 0);
  });
}

function showErr(form, name, msg) {
  const el = $(`[data-err="${name}"]`, form);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (motion()) el.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE });
  $$(`input[name="${name}"]`, form).forEach((i) => i.setAttribute("aria-invalid", "true"));
}
function clearErr(form, name) {
  const el = $(`[data-err="${name}"]`, form);
  if (el) el.hidden = true;
  $$(`input[name="${name}"]`, form).forEach((i) => i.removeAttribute("aria-invalid"));
}

/** Zwei Bereiche weich tauschen (alter fällt weg, neuer steigt auf) */
async function swap(oldEl, newEl) {
  if (motion()) await oldEl.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-8px)" }], { duration: 200, easing: EASE, fill: "forwards" }).finished;
  oldEl.hidden = true;
  newEl.hidden = false;
  if (motion()) await newEl.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE }).finished;
}

function rollNumber(box, value, dir = 1) {
  const old = box.firstElementChild;
  const nu = document.createElement("span");
  nu.textContent = value;
  if (!motion() || !old || !dir) { box.replaceChildren(nu); return; }
  box.append(nu);
  const d = dir > 0 ? 1 : -1;
  old.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-70 * d}%)`, opacity: 0 }], { duration: 260, easing: EASE, fill: "forwards" }).finished.then(() => old.remove());
  nu.animate([{ transform: `translateY(${70 * d}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 320, easing: EASE });
}
function wiggle(el) {
  if (motion()) el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], { duration: 240, easing: "ease-in-out" });
}

/** Das Foto fliegt in einem weichen Bogen in den Warenkorb */
function flyToCart() {
  const src = $("#ware-slides .is-on img");
  const target = cartBtn.getBoundingClientRect();
  bump();
  if (!src || !motion() || !target.width) return;
  const r = src.getBoundingClientRect();
  const size = Math.min(r.width, r.height, 220);
  const ghost = src.cloneNode();
  ghost.removeAttribute("style");
  ghost.className = "fly";
  Object.assign(ghost.style, { left: `${r.left + r.width / 2 - size / 2}px`, top: `${r.top + r.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
  document.body.append(ghost);
  const dx = target.left + target.width / 2 - (r.left + r.width / 2);
  const dy = target.top + target.height / 2 - (r.top + r.height / 2);
  ghost.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 0.95, borderRadius: "10px" },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 70}px) scale(0.42) rotate(-6deg)`, opacity: 0.9, borderRadius: "40%", offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.08) rotate(-10deg)`, opacity: 0.15, borderRadius: "50%" },
  ], { duration: 820, easing: EASE_IO, fill: "forwards" }).finished.then(() => { ghost.remove(); bump(true); });
}

function bump(land = false) {
  const c = $("#cart-count");
  if (!motion() || cartBtn.hidden) return;
  if (land) {
    cartBtn.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 420, easing: EASE });
    if (!c.hidden) c.animate([{ transform: "scale(1)" }, { transform: "scale(1.45)", offset: 0.35 }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }
}

function syncCount() {
  const n = count();
  const c = $("#cart-count");
  c.textContent = String(n);
  c.hidden = n === 0;
  $("#cart-count-sr").textContent = n ? `, ${n} ${n === 1 ? "Artikel" : "Artikel"}` : ", leer";
  if (n > 0) cartBtn.hidden = false;
}

// ---------- Warenkorb ----------
cartBtn.addEventListener("click", () => openCart());
wareEl.addEventListener("click", (e) => { if (e.target.closest("[data-open-cart-info]")) { closeWare().then(() => openCart()); } });

function openCart({ at = "cart" } = {}) {
  if (cartEl.hidden) lastFocus = document.activeElement;
  step = at;
  renderCart({ animate: false });
  showOverlay(cartEl);
  // Inhalte steigen nur beim Öffnen gestaffelt auf, nicht bei jeder Mengenänderung
  cartEl.classList.add("is-entering");
  clearTimeout(openCart.t);
  openCart.t = setTimeout(() => cartEl.classList.remove("is-entering"), 1100);
  setTimeout(() => $("#cart-title").focus({ preventScroll: true }), motion() ? 80 : 0);
}

async function closeCart() {
  await hideOverlay(cartEl);
  if (step === "done") { step = "cart"; doneInfo = null; }
  notice = "";
  if (!openStack.length && lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
}

function priced() {
  const settings = shopSettings();
  const delivery = chosenDelivery(settings);
  return { settings, delivery, res: priceCart(cart.lines, shopSettingsProducts(), settings, delivery, { madeToOrderPaused: paused() }) };
}
// Für die Berechnung auch unsichtbare Artikel kennen, damit "gibt es nicht mehr" sauber angezeigt wird
const shopSettingsProducts = () => shopProducts();

const STEPS = [
  { id: "cart", label: "Warenkorb" },
  { id: "details", label: "Angaben" },
  { id: "done", label: "Fertig" },
];

async function renderCart({ animate = true, dir = 1 } = {}) {
  const body = $("#cart-body");
  const foot = $("#cart-foot");
  const demo = !(await backend());
  const steps = demo ? STEPS : STEPS.filter((s) => s.id !== "details");
  $("#cart-title").textContent = step === "done" ? "Danke!" : step === "details" ? "Deine Angaben" : "Warenkorb";
  $("#cart-steps").innerHTML = count() || step === "done" ? steps.map((s, i) => {
    const idx = steps.findIndex((x) => x.id === step);
    return `<li class="${i < idx ? "is-done" : i === idx ? "is-now" : ""}"${i === idx ? ' aria-current="step"' : ""}><span>${i + 1}</span>${esc(s.label)}</li>`;
  }).join("") : "";
  const html = step === "done" ? doneHtml() : step === "details" ? detailsHtml() : cartHtml();
  const footHtml = step === "done" ? "" : step === "details" ? "" : cartFootHtml(demo);
  let outs = [];
  if (animate && motion() && body.firstElementChild) {
    outs = [body, foot].map((el) => el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-18 * dir}px)` }], { duration: 180, easing: EASE, fill: "forwards" }));
    await Promise.all(outs.map((a) => a.finished));
  }
  body.innerHTML = html;
  outs.forEach((a) => a.cancel());
  foot.innerHTML = footHtml;
  foot.hidden = !footHtml;
  body.scrollTop = 0;
  if (animate && motion()) {
    [body, foot].forEach((el) => el.animate([{ opacity: 0, transform: `translateX(${22 * dir}px)` }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE }));
  }
  bindCart(demo);
}

function cartHtml() {
  const { settings, delivery, res } = priced();
  if (!cart.lines.length) {
    return `<div class="cart__empty">
      <svg class="thread" viewBox="0 0 200 90" aria-hidden="true"><path d="M8 60 C 40 10, 70 90, 100 45 S 160 10, 192 40" /><circle cx="192" cy="40" r="3.2"/></svg>
      <p class="cart__empty-t">Dein Warenkorb ist noch leer.</p>
      <p class="cart__empty-s">Stöber in Ruhe durch die fertigen Stücke oder lass dir etwas auf Maß nähen.</p>
      <button type="button" class="btn btn--ghost" data-to-shop>Zum Shop</button>
    </div>`;
  }
  const byIndex = new Map(res.errors.filter((e) => e.index >= 0).map((e) => [e.index, e.msg]));
  const top = res.errors.filter((e) => e.index < 0 && !/leer/.test(e.msg)).map((e) => e.msg);
  const products = new Map(shopProducts().map((p) => [p.id, p]));
  const lines = cart.lines.map((l, i) => {
    const p = products.get(l.id);
    const name = p ? p.name : "Nicht mehr verfügbar";
    const img = p && p.images[0];
    const avail = p ? availableOf(p) : 0;
    const max = Math.min(MAX_QTY, avail === null ? MAX_QTY : avail);
    const meta = [l.option, l.note && `„${l.note}“`].filter(Boolean).map(esc).join(" · ");
    return `<li class="line${byIndex.has(i) ? " has-err" : ""}" data-line="${i}">
      <div class="line__img">${img ? pic(img, "", { sizes: "80px" }) : ""}</div>
      <div class="line__main">
        <p class="line__name">${esc(name)}</p>
        ${meta ? `<p class="line__meta">${meta}</p>` : ""}
        <div class="line__ctl">
          ${max > 1 || l.qty > 1 ? `<div class="qty qty--s" role="group" aria-label="Menge ${esc(name)}">
            <button type="button" class="qty__b" data-lq="-1" aria-label="Eins weniger"${l.qty <= 1 ? " disabled" : ""}>−</button>
            <span class="qty__n"><span>${l.qty}</span></span>
            <button type="button" class="qty__b" data-lq="1" aria-label="Eins mehr"${l.qty >= max ? " disabled" : ""}>+</button>
          </div>` : `<span class="line__one">1 Stück</span>`}
          <button type="button" class="link-btn line__rm" data-rm aria-label="${esc(name)} entfernen">Entfernen</button>
        </div>
        ${byIndex.has(i) ? `<p class="line__err" role="alert">${esc(byIndex.get(i))}</p>` : ""}
      </div>
      <p class="line__price price">${p ? euro(p.price * l.qty) : ""}</p>
    </li>`;
  }).join("");
  const opts = deliveryOptions(settings);
  const deliveryHtml = opts.length > 1 ? `
    <fieldset class="deliv">
      <legend class="deliv__l">Wie kommt es zu dir?</legend>
      ${opts.map((o) => `<label class="deliv__o"><input type="radio" name="delivery" value="${o}"${o === delivery ? " checked" : ""}>
        <span class="deliv__box"><span class="deliv__t">${o === "versand" ? "Versand" : "Abholung in Ramsen"}</span>
        <span class="deliv__s">${o === "versand" ? esc(`${settings.shipping.label}${settings.shipping.days ? `, ${settings.shipping.days}` : ""}`) : esc(settings.pickup.note)}</span></span>
        <span class="deliv__p">${o === "versand" ? (res.shipping || delivery !== "versand" ? euro(settings.shipping.freeFrom && res.subtotal >= settings.shipping.freeFrom ? 0 : settings.shipping.flat) : "kostenlos") : "kostenlos"}</span></label>`).join("")}
    </fieldset>` : "";
  return `${notice ? `<p class="cart__notice" role="status">${esc(notice)}</p>` : ""}
    ${top.length ? `<p class="cart__alert" role="alert">${esc(top[0])}</p>` : ""}
    <ul class="lines">${lines}</ul>${deliveryHtml}`;
}

function cartFootHtml(demo) {
  if (!cart.lines.length) return "";
  const { settings, delivery, res } = priced();
  const tax = settings.smallBusiness ? "Endpreis, keine Umsatzsteuer nach § 19 UStG" : "inkl. MwSt.";
  return `<dl class="sum">
      <div><dt>Zwischensumme</dt><dd class="price" data-sum="sub" data-v="${res.subtotal}">${euro(res.subtotal)}</dd></div>
      <div><dt>${delivery === "abholung" ? "Abholung" : "Versand"}</dt><dd class="price" data-sum="ship" data-v="${res.shipping}">${res.shipping ? euro(res.shipping) : "kostenlos"}</dd></div>
      <div class="sum__total"><dt>Gesamt</dt><dd class="price" data-sum="total" data-v="${res.total}">${euro(res.total)}</dd></div>
    </dl>
    <p class="sum__tax">${tax}</p>
    <div class="cart__ts" id="cart-ts" hidden></div>
    <p class="cart__err" id="cart-err" role="alert" hidden></p>
    <button type="button" class="btn btn--brass btn--lg cart__go" data-checkout${res.ok ? "" : " disabled"}>
      <span class="cart__go-t">${demo ? "Weiter zu deinen Angaben" : "Sicher bezahlen"}</span>
      <span class="stitch" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <p class="cart__pay">${demo
      ? "Klick-Prototyp: Hier geht es später zur sicheren Bezahlseite von Stripe. Es wird nichts bezahlt."
      : "Weiter zur sicheren Bezahlseite von Stripe: Karte, PayPal, Apple Pay oder Google Pay. Deine Zahlungsdaten sehe ich nie."}</p>`;
}

function detailsHtml() {
  const { delivery, res } = priced();
  return `<form class="cform" id="cform" novalidate>
    <p class="cform__intro">Wohin soll es gehen? Im echten Shop fragt das die Bezahlseite ab.</p>
    <div class="field"><label for="cf-name">Name</label><input id="cf-name" name="name" autocomplete="name" required maxlength="80"><p class="field__err" hidden></p></div>
    <div class="field"><label for="cf-mail">E-Mail</label><input id="cf-mail" name="email" type="email" autocomplete="email" required maxlength="120"><p class="field__err" hidden></p></div>
    ${delivery === "versand" ? `<div class="field"><label for="cf-addr">Adresse</label><textarea id="cf-addr" name="address" rows="3" autocomplete="street-address" required maxlength="240" placeholder="Straße und Hausnummer, PLZ und Ort"></textarea><p class="field__err" hidden></p></div>` : ""}
    <div class="field"><label for="cf-tel">Telefon (freiwillig)</label><input id="cf-tel" name="phone" type="tel" autocomplete="tel" maxlength="40"></div>
    <div class="cform__sum"><span>${count()} ${count() === 1 ? "Artikel" : "Artikel"}, ${delivery === "abholung" ? "Abholung" : "Versand"}</span><strong class="price">${euro(res.total)}</strong></div>
    <div class="cform__actions">
      <button type="button" class="btn btn--ghost" data-back>Zurück</button>
      <button type="submit" class="btn btn--brass">Zahlungspflichtig bestellen</button>
    </div>
    <p class="cart__pay">Klick-Prototyp: Es wird nichts bezahlt und nichts verschickt.</p>
  </form>`;
}

function doneHtml() {
  const d = doneInfo || {};
  const name = (d.name || "").split(/\s+/)[0];
  const waiting = d.status === "offen" || d.status === "in_zahlung";
  return `<div class="done-o">
    <svg class="seam" viewBox="0 0 240 120" aria-hidden="true">
      <path class="seam__line" d="M20 70 C 60 20, 100 110, 140 60 S 200 30, 220 64"/>
      <path class="seam__stitch" d="M20 70 C 60 20, 100 110, 140 60 S 200 30, 220 64"/>
      <circle class="seam__knot" cx="220" cy="64" r="4"/>
    </svg>
    <p class="done-o__t">${name ? `Danke, ${esc(name)}!` : "Danke für deine Bestellung!"}</p>
    <p class="done-o__s">${d.number ? `Bestellnummer <strong>${esc(d.number)}</strong>. ` : ""}${waiting
      ? "Deine Zahlung wird gerade noch bestätigt. Sobald sie da ist, bekommst du eine E-Mail."
      : d.delivery === "abholung" ? "Ich melde mich bei dir, sobald alles bereitliegt, und wir machen einen Abholtermin aus." : "Ich packe alles mit Liebe ein und schicke dir die Sendungsnummer, sobald es unterwegs ist."}</p>
    ${d.demo ? `<p class="cart__pay">Klick-Prototyp: Die Bestellung steht jetzt in der Verwaltung unter „Shop“.</p>` : ""}
    <button type="button" class="btn btn--ghost" data-close>Weiter stöbern</button>
  </div>`;
}

function bindCart(demo) {
  const body = $("#cart-body");
  const foot = $("#cart-foot");
  $("[data-to-shop]", body)?.addEventListener("click", async () => { await closeCart(); $("#shop").scrollIntoView({ behavior: motion() ? "smooth" : "auto" }); });
  $$("[data-line]", body).forEach((li) => {
    const i = Number(li.dataset.line);
    $$("[data-lq]", li).forEach((b) => b.addEventListener("click", () => changeQty(i, Number(b.dataset.lq), li)));
    $("[data-rm]", li)?.addEventListener("click", () => removeLine(i, li));
  });
  $$("input[name=delivery]", body).forEach((r) => r.addEventListener("change", () => { cart.delivery = r.value; saveCart(); refreshTotals(); }));
  $("[data-checkout]", foot)?.addEventListener("click", () => checkout(demo));
  $("[data-back]", body)?.addEventListener("click", () => { step = "cart"; renderCart({ dir: -1 }); });
  $("#cform", body)?.addEventListener("submit", submitDemo);
}

function changeQty(i, d, li) {
  const l = cart.lines[i];
  if (!l) return;
  const p = productById(l.id);
  const avail = p ? availableOf(p) : 0;
  const max = Math.min(MAX_QTY, avail === null ? MAX_QTY : avail);
  const next = Math.max(1, Math.min(max, l.qty + d));
  if (next === l.qty) return wiggle($(".qty__n", li));
  l.qty = next;
  saveCart();
  rollNumber($(".qty__n", li), String(next), d);
  $$("[data-lq]", li).forEach((b) => { b.disabled = (b.dataset.lq === "-1" && next <= 1) || (b.dataset.lq === "1" && next >= max); });
  $(".line__price", li).textContent = p ? euro(p.price * next) : "";
  refreshTotals();
}

async function removeLine(i, li) {
  const name = $(".line__name", li)?.textContent || "Artikel";
  if (motion()) {
    const h = li.offsetHeight;
    li.style.overflow = "hidden";
    await li.animate([
      { opacity: 1, transform: "none", height: `${h}px` },
      { opacity: 0, transform: "translateX(24px)", height: `${h}px`, offset: 0.45 },
      { opacity: 0, transform: "translateX(24px)", height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px" },
    ], { duration: 460, easing: EASE, fill: "forwards" }).finished;
  }
  cart.lines.splice(i, 1);
  saveCart();
  announce(`${name} entfernt.`);
  if (!cart.lines.length) { renderCart(); return; }
  renderCart({ animate: false });
  const next = $$("#cart-body [data-rm]")[Math.min(i, cart.lines.length - 1)];
  (next || $("#cart-title")).focus({ preventScroll: true });
}

/** Summen weich hoch- oder runterzählen */
function refreshTotals() {
  const { res, delivery } = priced();
  const foot = $("#cart-foot");
  const set = (key, cents, freeText) => {
    const el = $(`[data-sum="${key}"]`, foot);
    if (!el) return;
    const from = Number(el.dataset.v ?? NaN);
    el.dataset.v = cents;
    if (freeText && !cents) { el.textContent = freeText; return; }
    if (!motion() || !Number.isFinite(from) || from === cents) { el.textContent = euro(cents); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 420);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = euro(Math.round(from + (cents - from) * e));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  set("sub", res.subtotal);
  set("ship", res.shipping, "kostenlos");
  set("total", res.total);
  const label = $(".sum div:nth-child(2) dt", foot);
  if (label) label.textContent = delivery === "abholung" ? "Abholung" : "Versand";
  const go = $("[data-checkout]", foot);
  if (go) go.disabled = !res.ok;
  // Fehler je Zeile neu zeigen (z. B. Menge jetzt wieder passend)
  $$("#cart-body [data-line]").forEach((li) => {
    const err = res.errors.find((e) => e.index === Number(li.dataset.line));
    li.classList.toggle("has-err", !!err);
    const p = $(".line__err", li);
    if (err && !p) $(".line__main", li).insertAdjacentHTML("beforeend", `<p class="line__err" role="alert">${esc(err.msg)}</p>`);
    else if (!err && p) p.remove();
  });
}

function setBusy(on) {
  busy = on;
  const go = $("[data-checkout]", cartEl);
  if (!go) return;
  go.classList.toggle("is-busy", on);
  go.disabled = on;
  $(".cart__go-t", go).textContent = on ? "Einen Moment …" : go.dataset.label || $(".cart__go-t", go).textContent;
}

function cartError(msg) {
  const el = $("#cart-err");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (motion()) el.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: EASE });
}

async function checkout(demo) {
  if (busy) return;
  const { res, delivery } = priced();
  if (!res.ok) return;
  if (demo) { step = "details"; renderCart(); setTimeout(() => $("#cf-name")?.focus(), motion() ? 420 : 0); return; }
  const go = $("[data-checkout]", cartEl);
  go.dataset.label = $(".cart__go-t", go).textContent;
  const health = await backend();
  let token;
  if (health && health.turnstileSiteKey) {
    token = await turnstileToken(health.turnstileSiteKey);
    if (!token) return;
  }
  setBusy(true);
  try {
    const out = await api("checkout", { method: "POST", body: { lines: cart.lines, delivery, turnstile: token } });
    // Leichtes Ausblenden, dann zur Bezahlseite
    if (motion()) await cartEl.querySelector(".cart__panel").animate([{ opacity: 1 }, { opacity: 0.55 }], { duration: 240, fill: "forwards" }).finished;
    location.assign(out.url);
  } catch (e) {
    setBusy(false);
    if (e.status === 409 && e.data && e.data.errors) await refreshProducts();
    cartError(e.message || "Das hat nicht geklappt. Bitte versuch es nochmal.");
    if (window.turnstile && turnstileId !== null) window.turnstile.reset(turnstileId);
  }
}

// Bestand neu laden (z. B. wenn jemand anderes schneller war)
async function refreshProducts() {
  try {
    const out = await api("shop");
    update((c) => { c.shop.products = out.products.map(normalizeProduct); c.shop.settings = out.settings; });
    renderShop();
    const err = $("#cart-err")?.textContent;
    renderCart({ animate: false });
    if (err) cartError(err);
  } catch { /* still */ }
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}
async function turnstileToken(siteKey) {
  const box = $("#cart-ts");
  if (!box) return null;
  try { await loadTurnstile(); } catch { cartError("Der Bot-Schutz lädt gerade nicht. Bitte versuch es gleich nochmal."); return null; }
  box.hidden = false;
  return new Promise((resolve) => {
    turnstileId = window.turnstile.render(box, { sitekey: siteKey, language: "de", theme: "dark", callback: (t) => resolve(t), "error-callback": () => resolve(null) });
  });
}

function submitDemo(e) {
  e.preventDefault();
  const form = e.currentTarget;
  let first = null;
  $$("[required]", form).forEach((i) => {
    const err = i.parentElement.querySelector(".field__err");
    const bad = !i.value.trim() || (i.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.value.trim()));
    i.setAttribute("aria-invalid", String(bad));
    if (err) { err.hidden = !bad; err.textContent = bad ? (i.type === "email" && i.value.trim() ? "Bitte prüf die E-Mail-Adresse." : "Bitte ausfüllen.") : ""; }
    if (bad && !first) first = i;
  });
  if (first) { first.focus(); return; }
  const data = Object.fromEntries(new FormData(form));
  const { delivery } = priced();
  const out = placeLocalOrder({ lines: cart.lines, delivery, customer: data });
  if (!out.ok) { step = "cart"; renderCart({ dir: -1 }); return; }
  cart.lines = [];
  saveCart();
  doneInfo = { number: out.order.number, status: out.order.status, delivery, name: data.name, demo: true };
  step = "done";
  renderCart();
  announce(`Danke! Bestellung ${out.order.number} ist angekommen.`);
  setTimeout(() => $("#cart-title").focus({ preventScroll: true }), motion() ? 420 : 0);
}

// ---------- Rückkehr von Stripe ----------
async function handleReturn() {
  const q = new URLSearchParams(location.search);
  const state = q.get("bestellung");
  if (!state) return;
  const token = q.get("t") || "";
  q.delete("bestellung");
  q.delete("t");
  history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + (state === "abgebrochen" ? "#shop" : ""));
  if (state === "abgebrochen") {
    notice = "Die Bezahlung wurde abgebrochen. Dein Warenkorb ist noch da.";
    openCart();
    return;
  }
  if (state !== "danke") return;
  cart.lines = [];
  saveCart();
  doneInfo = { status: "offen" };
  openCart({ at: "done" });
  for (let i = 0; i < 6; i++) {
    try {
      const o = await api(`order?t=${encodeURIComponent(token)}`);
      doneInfo = { number: o.number, status: o.status, delivery: o.delivery };
      if (o.status !== "offen") break;
    } catch { break; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (step === "done" && !cartEl.hidden) {
    $(".done-o__s", cartEl).outerHTML = $(".done-o__s", new DOMParser().parseFromString(`<div>${doneHtml()}</div>`, "text/html")).outerHTML;
  }
}

// Warenkorb in anderen Tabs aktuell halten
addEventListener("storage", (e) => {
  if (e.key !== CART_KEY) return;
  cart = readCart();
  syncCount();
  if (!cartEl.hidden && step === "cart") renderCart({ animate: false });
});

export function initShop() {
  renderShop();
  initReveal();
  syncCount();
  fromHash();
  handleReturn();
}

/** Inhalte haben sich geändert (Verwaltung im anderen Tab) */
export function refreshShop() {
  renderShop();
  if (!cartEl.hidden && step === "cart") renderCart({ animate: false });
}
