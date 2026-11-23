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
// Gemeinsame Bewegungssprache (siehe style.css :root): linear()-Federn, wo der Browser sie kann
const rootCss = getComputedStyle(document.documentElement);
const tok = (n, fb) => {
  const v = rootCss.getPropertyValue(n).trim();
  try { document.createElement("i").animate(null, { easing: v }).cancel(); return v; } catch { return fb; }
};
const DRAPE = tok("--drape", "cubic-bezier(0.16, 1, 0.3, 1)");
const SPRING = tok("--spring", "cubic-bezier(0.34, 1.4, 0.64, 1)");
const FOLD = "cubic-bezier(0.32, 0.72, 0, 1)";
const EXIT = "cubic-bezier(0.5, 0, 0.75, 0)";
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const T = { morph: 760, fold: 540, panel: 680, exit: 340, small: 520 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
let morph = null; // laufende View Transition Karte ⇄ Artikelansicht
let dock = null; // Abbild des Warenkorb-Knopfs über dem Schleier, solange die Artikelansicht offen ist
let dockT = 0;
let settleT = 0; // Aufräumen nach dem Entfalten ohne View Transitions

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
      el.classList.remove("is-closing", "is-instant", "is-morph", "is-late-rise", "is-folding", "is-handoff");
      if (el === wareEl) {
        dock?.remove(); dock = null; clearTimeout(dockT);
        $$(".ware.is-lifted, .ware.is-lifting", grid).forEach((li) => li.classList.remove("is-lifted", "is-lifting"));
      }
      openStack = openStack.filter((o) => o !== el);
      const top = openStack[openStack.length - 1];
      if (top) top.inert = false;
      else lockPage(false);
      resolve();
    };
    el.classList.remove("is-open");
    if (instant || !motion()) return done();
    el.classList.add("is-closing");
    setTimeout(done, el === cartEl ? 360 : 420);
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
  // Fokus und Ansage erst nach dem Neuaufbau: renderShop ersetzt die Filterknöpfe
  const after = () => {
    $(`#shop-filter [data-filter="${id}"]`)?.focus();
    const n = grid.children.length;
    announce(`${n} Artikel gezeigt`);
  };
  const apply = () => { renderShop(); after(); };
  if (canVT()) {
    vtNames = true;
    document.documentElement.classList.add("vt-filter");
    $$(".ware", grid).forEach((li) => { li.style.viewTransitionName = `ware-${li.dataset.id}`; });
    const h0 = grid.offsetHeight;
    const vt = document.startViewTransition(() => {
      apply();
      // Der Abschnitt darunter gleitet mit, statt auf die neue Höhe zu springen
      const h1 = grid.offsetHeight;
      if (h0 !== h1) grid.animate({ height: [`${h0}px`, `${h1}px`] }, { duration: 620, easing: DRAPE });
    });
    vt.finished.finally(() => { vtNames = false; document.documentElement.classList.remove("vt-filter"); $$(".ware", grid).forEach((li) => { li.style.viewTransitionName = ""; }); });
  } else apply();
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

function fillWare(p, { start = 0 } = {}) {
  current = p;
  const imgs = p.images.length ? p.images : [];
  slide = Math.min(start, Math.max(0, imgs.length - 1));
  $("#ware-slides").innerHTML = imgs.map((f, i) => `<li class="ware-view__slide${i === slide ? " is-on" : ""}" aria-hidden="${i !== slide}">${pic(f, i === 0 ? p.name : `${p.name}, Foto ${i + 1}`, { eager: i === slide, sizes: "(max-width: 760px) 100vw, 55vw" })}</li>`).join("");
  $("#ware-dots").innerHTML = imgs.length > 1 ? imgs.map((_, i) => `<button type="button" class="dot" data-slide="${i}" aria-label="Foto ${i + 1} von ${imgs.length}" aria-current="${i === slide}"></button>`).join("") : "";
  $("#ware-stage").classList.toggle("has-many", imgs.length > 1);
  $("#ware-info").innerHTML = wareInfo(p);
  $("#ware-info").scrollTop = 0;
  bindForm();
}

/** Fotos wechseln wie eine Stoffbahn: das neue zieht sich aus der Richtung herein, das alte weicht zurück und dunkelt ab */
function goSlide(i, dir = Math.sign(i - slide) || 1) {
  if (morph) return; // nicht während Öffnen/Schließen (die Bühne ist gerade benannt)
  const slides = $$("#ware-slides > li");
  if (slides.length < 2) return;
  const next = (i + slides.length) % slides.length;
  if (next === slide) return;
  slides.forEach((li) => { li.getAnimations({ subtree: true }).forEach((a) => a.finish()); li.classList.remove("is-leaving"); });
  const from = slides[slide];
  const to = slides[next];
  slide = next;
  slides.forEach((li, n) => { li.classList.toggle("is-on", n === slide); li.setAttribute("aria-hidden", String(n !== slide)); });
  $$("#ware-dots .dot").forEach((d, n) => d.setAttribute("aria-current", String(n === slide)));
  if (!motion()) return;
  const D = 720;
  from.classList.add("is-leaving");
  to.animate({ clipPath: [dir > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)", "inset(0 0 0 0)"] }, { duration: D, easing: DRAPE });
  $("img", to)?.animate({ transform: [`translateX(${dir * 14}%) scale(1.06)`, "none"] }, { duration: D + 220, easing: EASE_OUT });
  const leave = $("img", from)?.animate({ transform: ["none", `translateX(${-dir * 18}%)`], filter: ["sepia(.08) brightness(.96)", "sepia(.08) brightness(.5)"] }, { duration: D, easing: DRAPE });
  const clear = () => from.classList.remove("is-leaving");
  if (leave) leave.finished.then(clear, clear); else clear();
}
$("#ware-dots").addEventListener("click", (e) => { const d = e.target.closest("[data-slide]"); if (d) goSlide(+d.dataset.slide); });
$("#ware-stage").addEventListener("click", (e) => {
  if (e.target.closest(".dot") || $$("#ware-slides > li").length < 2) return;
  const r = e.currentTarget.getBoundingClientRect();
  const d = e.clientX - r.left < r.width / 3 ? -1 : 1;
  goSlide(slide + d, d);
});
// Wischen auf dem Handy
let touchX = null;
$("#ware-stage").addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$("#ware-stage").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 40) { const d = dx < 0 ? 1 : -1; goSlide(slide + d, d); }
});
wareEl.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "ArrowRight") goSlide(slide + 1, 1);
  if (e.key === "ArrowLeft") goSlide(slide - 1, -1);
});

// Rechteck r (Viewport) als clip-path relativ zum Panel
function insetFor(panel, r, rad = 6) {
  const p = panel.getBoundingClientRect();
  return `inset(${r.top - p.top}px ${p.right - r.right}px ${p.bottom - r.bottom}px ${r.left - p.left}px round ${rad}px)`;
}
const fullInset = (panel) => `inset(0px 0px 0px 0px round ${parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0}px)`;
const panelEl = () => $(".ware-view__panel", wareEl);
const veilEl = () => $(".ov__veil", wareEl);

/**
 * Karte → Artikelansicht: Der Fotorahmen der Karte wächst zur Bühne (View Transition), das Panel entfaltet sich
 * im selben Takt aus genau diesem Rahmen (clip-path), der Schleier zieht mit. Ohne View Transitions entfaltet
 * sich das Panel trotzdem aus der Karte.
 */
function openWare(id, { origin = null, push = true } = {}) {
  const p = productById(id);
  if (!p) return;
  morph?.skipTransition();
  clearTimeout(settleT);
  wareEl.classList.remove("is-folding", "is-late-rise");
  lastFocus = document.activeElement;
  originCard = origin;
  if (push && location.hash !== `#artikel-${id}`) history.pushState({ ware: id }, "", `#artikel-${id}`);
  document.title = `${p.name} · Cathrin Raasch Atelier`;
  const li = origin?.closest(".ware");
  const media = origin && $(".ware__media", origin);
  const from = media?.getBoundingClientRect();
  const onScreen = from && from.width > 0 && from.bottom > 0 && from.top < innerHeight;
  // Galerie beim Bild beginnen, das man gerade sieht (Hover zeigt das zweite)
  const alt = media && $(".ware__img--alt", media);
  const start = alt && Number(getComputedStyle(alt).opacity) > 0.5 ? 1 : 0;

  if (!onScreen || !motion()) {
    fillWare(p, { start });
    showOverlay(wareEl);
    focusTitle();
    return;
  }
  const html = document.documentElement;
  const panel = panelEl();
  const veil = veilEl();
  const stage = $("#ware-stage");
  const unfold = () => {
    panel.animate({ clipPath: [insetFor(panel, from), fullInset(panel)] }, { duration: T.morph, easing: DRAPE });
    veil.animate({ opacity: [0, 1] }, { duration: T.morph * 0.75, easing: EASE_OUT });
    // Das Motiv setzt sich im wachsenden Rahmen
    $("#ware-slides .is-on img")?.animate({ transform: ["scale(1.06)", "none"] }, { duration: 1100, easing: EASE_OUT });
  };
  const settle = () => {
    wareEl.classList.remove("is-instant");
    requestAnimationFrame(() => wareEl.classList.remove("is-morph"));
  };

  if (!canVT()) {
    fillWare(p, { start });
    showOverlay(wareEl, { instant: true });
    wareEl.classList.add("is-morph", "is-late-rise");
    panel.scrollTop = 0;
    unfold();
    focusTitle();
    settleT = setTimeout(settle, T.morph);
    return;
  }

  li?.classList.add("is-lifting"); // Etikett nicht mitwachsen lassen
  media.style.viewTransitionName = "ware-photo";
  html.classList.add("vt-ware", "vt-open");
  const t = morph = document.startViewTransition(async () => {
    media.style.viewTransitionName = "";
    li?.classList.add("is-lifted"); // leerer Platz im Raster, solange das Stück „draußen“ ist
    fillWare(p, { start });
    showOverlay(wareEl, { instant: true });
    wareEl.classList.add("is-morph", "is-late-rise");
    panel.scrollTop = 0; // mobil scrollt das Panel
    panel.style.clipPath = insetFor(panel, from);
    veil.style.opacity = "0";
    stage.style.viewTransitionName = "ware-photo";
    await Promise.race([$("#ware-slides .is-on img")?.decode().catch(() => {}), wait(150)]);
  });
  const clearInline = () => { panel.style.clipPath = ""; veil.style.opacity = ""; };
  // Bis ready wird nichts gemalt: Startwerte inline, ab dann dieselbe Uhr wie die Fotogruppe
  t.ready.then(() => { clearInline(); unfold(); }, clearInline);
  t.finished.finally(() => {
    stage.style.viewTransitionName = "";
    li?.classList.remove("is-lifting");
    html.classList.remove("vt-open");
    if (morph === t) { morph = null; html.classList.remove("vt-ware"); }
    settle();
    if (!wareEl.hidden) focusTitle();
  });
}
function focusTitle() { $("#ware-title")?.focus({ preventScroll: true }); }

const BASE_TITLE = document.title;
let closingWare = false;
/**
 * Artikelansicht → Karte: Das Panel faltet sich live in den Kartenrahmen zurück, das Foto fliegt mit.
 * instant: Der Browser hat die Zurück-Geste schon selbst animiert, also ohne zweite Faltung schließen.
 */
async function closeWare({ fromHistory = false, instant = false } = {}) {
  // Synchrone Sperre: popstate und hashchange kommen bei Zurück direkt hintereinander
  if (wareEl.hidden || closingWare) return;
  closingWare = true;
  try {
    await foldWare({ fromHistory, instant });
  } finally {
    closingWare = false;
  }
  // Kam während des Faltens ein Vor-Schritt, passt die Adresse wieder zur Ansicht
  if (/^#artikel-/.test(location.hash)) fromHash();
}
async function foldWare({ fromHistory, instant }) {
  morph?.skipTransition();
  clearTimeout(settleT);
  if (!fromHistory && /^#artikel-/.test(location.hash)) history.replaceState(null, "", "#shop");
  document.title = BASE_TITLE;
  const id = current && current.id;
  const li = id && $(`.ware[data-id="${CSS.escape(id)}"]`, grid);
  const media = li && $(".ware__media", li);
  const to = media?.getBoundingClientRect();
  const vis = to && to.width > 0 && to.bottom > 0 && to.top < innerHeight;
  const stage = $("#ware-stage");
  const stageOn = stage.getBoundingClientRect().bottom > innerHeight * 0.25; // mobil weit gescrollt → normales Ausblenden
  const html = document.documentElement;
  if (instant) {
    $$(".ware.is-lifted", grid).forEach((x) => x.classList.remove("is-lifted"));
    await hideOverlay(wareEl, { instant: true });
    [panelEl(), veilEl()].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  } else if (vis && stageOn && canVT() && !openStack.includes(cartEl)) {
    const panel = panelEl();
    const veil = veilEl();
    wareEl.inert = true;
    wareEl.classList.add("is-morph"); // Punkte schon vor dem Schnappschuss weg
    stage.style.viewTransitionName = "ware-photo";
    html.classList.add("vt-ware", "vt-close");
    const t = morph = document.startViewTransition(() => {
      stage.style.viewTransitionName = "";
      media.style.viewTransitionName = "ware-photo";
      li.classList.remove("is-lifted", "is-lifting");
      if (!wareEl.hidden) wareEl.classList.add("is-folding"); // is-open bleibt, sonst spränge das Panel auf unsichtbar
    });
    t.ready.then(() => {
      panel.animate({ clipPath: [fullInset(panel), insetFor(panel, to)] }, { duration: T.fold, easing: FOLD, fill: "forwards" });
      // zum Schluss liegt nur noch das Foto auf der Karte, kein dunkles Rechteck
      panel.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: T.fold, easing: FOLD, fill: "forwards" });
      veil.animate({ opacity: [1, 0] }, { duration: T.fold * 0.9, easing: "ease-in-out", fill: "forwards" });
      $("#ware-info").animate({ opacity: [1, 0], transform: ["none", "translateY(6px)"] }, { duration: 150, easing: "ease-out", fill: "forwards" });
      dock?.animate({ opacity: [1, 0] }, { duration: 160, fill: "forwards" });
    }, () => {});
    await t.finished.catch(() => {});
    await hideOverlay(wareEl, { instant: true }); // erst verstecken …
    [panel, veil, $("#ware-info")].forEach((el) => el.getAnimations().forEach((a) => a.cancel())); // … dann aufräumen
    media.style.viewTransitionName = "";
    html.classList.remove("vt-close");
    if (morph === t) { morph = null; html.classList.remove("vt-ware"); }
  } else {
    $$(".ware.is-lifted", grid).forEach((x) => x.classList.remove("is-lifted"));
    // Läuft das Entfalten noch, den Schleier vom aktuellen Wert aus per CSS ausblenden statt weiter aufziehen zu lassen
    const veil = veilEl(), panel = panelEl();
    if (veil.getAnimations().length) veil.style.opacity = getComputedStyle(veil).opacity;
    [veil, panel].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    wareEl.classList.remove("is-instant", "is-morph");
    veil.offsetWidth;
    veil.style.opacity = "";
    await hideOverlay(wareEl);
  }
  const back = (originCard && originCard.isConnected) ? originCard : (id && $(`[data-ware="${CSS.escape(id)}"]`, grid)) || lastFocus;
  if (back && back.isConnected && !openStack.length) back.focus({ preventScroll: true });
}

/** „Zum Warenkorb“: Die Artikelansicht tritt zurück, während die Schublade einfährt – ein Schleier, eine Bewegung */
async function wareToCart() {
  if (wareEl.hidden) return openCart();
  morph?.skipTransition();
  if (/^#artikel-/.test(location.hash)) history.replaceState(null, "", "#shop");
  document.title = BASE_TITLE;
  const back = (originCard?.isConnected && originCard) || (current && $(`[data-ware="${CSS.escape(current.id)}"]`, grid)) || cartBtn;
  $$(".ware.is-lifted", grid).forEach((x) => x.classList.remove("is-lifted"));
  if (!motion()) { await hideOverlay(wareEl, { instant: true }); return openCart({ focusBack: back }); }
  await openCart({ focusBack: back, onShow: () => { wareEl.classList.add("is-handoff"); cartEl.classList.add("is-handoff"); } });
  const panel = panelEl();
  await Promise.all([panel, dock].filter(Boolean).map((el) => el.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: el === panel ? "translateX(-2.5%) scale(0.975)" : "translateY(-4px)" }],
    { duration: 380, easing: EXIT, fill: "forwards" }).finished.catch(() => {})));
  await hideOverlay(wareEl, { instant: true });
  panel.getAnimations().forEach((a) => a.cancel());
  cartEl.classList.remove("is-handoff");
}

function fromHash(e) {
  if (closingWare) return; // closeWare gleicht die Adresse am Ende selbst ab
  const m = location.hash.match(/^#artikel-([\w-]+)$/);
  if (m && productById(m[1])) {
    if (wareEl.hidden || current?.id !== m[1]) openWare(m[1], { push: false });
  } else if (!wareEl.hidden) closeWare({ fromHistory: true, instant: !!e?.hasUAVisualTransition });
}
addEventListener("popstate", fromHash);
addEventListener("hashchange", fromHash);

// ---------- In den Warenkorb ----------
function bindForm() {
  const form = $(".ware-form", wareEl);
  if (!form) return;
  const max = Number(form.dataset.max) || 1;
  let qty = 1;
  let sending = false; // Doppelklick / zweimal Enter legt nicht doppelt ab
  const qn = $(".qty__n", form);
  const syncBtns = () => $$(".qty__b", form).forEach((b) => { b.disabled = (b.dataset.q === "-1" && qty <= 1) || (b.dataset.q === "1" && qty >= max); });
  const setQty = (n, dir) => {
    const next = Math.max(1, Math.min(max, n));
    if (next === qty) { wiggle($(".qty", form)); return; }
    qty = next;
    if (qn) rollNumber(qn, String(qty), dir);
    syncBtns();
  };
  $$(".qty__b", form).forEach((b) => b.addEventListener("click", () => setQty(qty + Number(b.dataset.q), Number(b.dataset.q))));
  syncBtns();
  $$("input", form).forEach((i) => i.addEventListener("input", () => clearErr(form, i.name)));
  $("[data-go-cart]", form)?.addEventListener("click", () => wareToCart());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (sending) return;
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
    sending = true;
    const before = count();
    if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + qty);
    else cart.lines.push(line);
    saveCart();
    cartBtn.hidden = false;
    const btn = $(".ware-form__add", form);
    btn.setAttribute("aria-disabled", "true"); // nicht disabled: der Fokus soll bis zum Tausch auf dem Knopf bleiben
    const landAt = flyToCart(before, count(), btn);
    // Der Haken zeichnet sich genau dann, wenn das Muster in die Tasche fällt
    btn.style.setProperty("--land", `${Math.max(0, landAt - 40)}ms`);
    btn.classList.add("is-added");
    announce(`${p.name} liegt im Warenkorb. ${count()} ${count() === 1 ? "Artikel" : "Artikel"} insgesamt.`);
    setTimeout(() => {
      const next = $(".ware-form__next", form);
      if (!next || !form.isConnected || wareEl.hidden) return;
      const actions = $(".ware-form__actions", form);
      swap(actions, next).then(() => { if (!wareEl.hidden) $("[data-go-cart]", next).focus({ preventScroll: true }); });
    }, motion() ? landAt + 380 : 0);
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

/** Ziffer rollt wie ein Zählwerk: die alte fällt weg, die neue federt herein (auch bei schnellem Klicken nie doppelt) */
function rollNumber(box, value, dir = 1) {
  [...box.children].slice(0, -1).forEach((s) => s.remove());
  const old = box.lastElementChild;
  const nu = document.createElement("span");
  nu.textContent = value;
  if (!motion() || !old || !dir) { box.replaceChildren(nu); return; }
  old.getAnimations().forEach((a) => a.finish());
  old.setAttribute("aria-hidden", "true");
  box.append(nu);
  const d = dir > 0 ? 1 : -1;
  old.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${-65 * d}%)`, opacity: 0 }], { duration: 200, easing: EXIT, fill: "forwards" })
    .finished.then(() => old.remove(), () => {});
  nu.animate({ transform: [`translateY(${80 * d}%)`, "none"] }, { duration: T.small, easing: SPRING });
  nu.animate({ opacity: [0, 1] }, { duration: 180, easing: "linear" });
}
/** Sanftes, gedämpftes Kopfschütteln (Grenze erreicht) */
function wiggle(el) {
  if (motion() && el) el.animate({ transform: ["none", "translateX(-5px)", "translateX(4px)", "translateX(-2.5px)", "translateX(1px)", "none"] }, { duration: 420, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" });
}

// ---------- Warenkorb-Dock ----------
// Der echte Knopf sitzt im Seitenkopf unter dem Schleier (und ist inert). Solange die Artikelansicht offen ist,
// schwebt deshalb ein Abbild genau an seiner Stelle über dem Schleier und nimmt die Landung auf.
// Bewusst ein <div> (inert, aria-hidden): kein zweites Fokusziel, keine doppelten IDs.
function cartDock(n) {
  clearTimeout(dockT);
  if (dock?.isConnected) { dock.getAnimations({ subtree: true }).forEach((a) => a.cancel()); return dock; }
  const r = cartBtn.getBoundingClientRect();
  const d = document.createElement("div");
  d.className = "head__cart cart-dock";
  d.setAttribute("aria-hidden", "true");
  d.dataset.openCartInfo = ""; // ein Klick aufs Abbild öffnet den Warenkorb wie der echte Knopf
  d.innerHTML = `${$(".ico-bag", cartBtn).outerHTML}<span class="head__cart-label">Warenkorb</span><span class="head__count cart-dock__n"${n ? "" : " hidden"}><span>${n}</span></span><i class="cart-dock__ring"></i>`;
  if (r.width) {
    let left = r.left;
    const top = Math.max(8, r.top);
    // nie unter das Schließen-X der Ansicht
    const x = $(".ov__x", wareEl).getBoundingClientRect();
    if (left < x.right + 8 && left + r.width > x.left - 8 && top < x.bottom + 8 && top + r.height > x.top - 8) left = x.left - r.width - 12;
    Object.assign(d.style, { left: `${left}px`, top: `${top}px`, width: `${r.width}px`, height: `${r.height}px` });
  } else Object.assign(d.style, { right: "16px", top: "12px" });
  wareEl.append(d);
  return (dock = d);
}
function dockOut(after) {
  clearTimeout(dockT);
  dockT = setTimeout(() => {
    const d = dock;
    if (!d) return;
    const done = () => { d.remove(); if (dock === d) dock = null; };
    if (!motion()) return done();
    d.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px) scale(0.97)" }], { duration: 320, easing: EXIT, fill: "forwards" }).finished.then(done, done);
  }, after);
}

/** Landung: Tasche gibt nach, Zähler rollt von alt auf neu, ein Messingring breitet sich aus */
function land(el, to) {
  const n = $(".head__count", el);
  if (el === dock) {
    if (n.hidden) {
      n.hidden = false;
      if (motion()) n.animate([{ transform: "scale(0)" }, { transform: "none" }], { duration: T.small, easing: SPRING });
    }
    n.style.minWidth = String(to).length > 1 ? "28px" : "21px";
    rollNumber(n, String(to), 1);
  }
  if (!motion()) return;
  $(".ico-bag", el).animate([
    { transform: "none" },
    { transform: "translateY(1.5px) scale(1.2, 0.8)", offset: 0.18 },
    { transform: "translateY(-1px) scale(0.94, 1.07)", offset: 0.46 },
    { transform: "none" },
  ], { duration: 600, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" });
  if (el !== dock) { n.animate([{ transform: "none" }, { transform: "scale(1.35)", offset: 0.3 }, { transform: "none" }], { duration: T.small, easing: EASE_OUT }); return; }
  $(".cart-dock__ring", el).animate([{ opacity: 0.95, transform: "none" }, { opacity: 0, transform: "scale(1.14, 1.6)" }], { duration: 700, easing: EASE_OUT });
  el.animate([{ boxShadow: "0 14px 34px -14px rgba(0,0,0,.85), 0 0 0 0 rgba(220,189,136,0)" }, { boxShadow: "0 14px 34px -14px rgba(0,0,0,.85), 0 0 26px 2px rgba(220,189,136,.32)", offset: 0.25 }, { boxShadow: "0 14px 34px -14px rgba(0,0,0,.85), 0 0 0 0 rgba(220,189,136,0)" }], { duration: 900, easing: "ease-out" });
}

/**
 * Ein rundes Stoffmuster wird aus dem Foto gestanzt und fliegt in einem Bogen in die Tasche.
 * Jede Achse hat ihre eigene Kurve (verschachtelte Ebenen): X gleichmäßig, Y steigt, überschießt und fällt von oben hinein.
 * Gibt zurück, wann es landet (ms).
 */
function flyToCart(from, to, btn) {
  const d = cartDock(from);
  if (!motion()) { land(d, to); dockOut(1400); return 0; }
  d.animate([{ opacity: 0, transform: "translateY(-6px) scale(0.94)" }, { opacity: 1, transform: "none" }], { duration: 340, easing: EASE_OUT, fill: "both" });
  const bag = $(".ico-bag", d).getBoundingClientRect();
  const tx = bag.left + bag.width / 2;
  const ty = bag.top + bag.height / 2;

  const img = $("#ware-slides .is-on img");
  const r = img?.getBoundingClientRect();
  const vTop = r ? Math.max(r.top, 0) : 0;
  const vBot = r ? Math.min(r.bottom, innerHeight) : 0;
  const fromBtn = !r || vBot - vTop < r.height * 0.4; // mobil: Panel zum Formular gescrollt, Foto kaum zu sehen
  let cx, cy, D;
  if (fromBtn) {
    const b = btn.getBoundingClientRect();
    D = 72; cx = b.left + b.width / 2; cy = b.top + b.height / 2;
  } else {
    const vh = vBot - vTop;
    D = Math.round(Math.max(96, Math.min(180, 0.42 * Math.min(r.width, vh))));
    cx = r.left + r.width / 2; cy = vTop + vh / 2;
  }
  const L = cx - D / 2;
  const Tp = cy - D / 2;

  const g = document.createElement("div");
  g.className = "fly";
  g.setAttribute("aria-hidden", "true");
  Object.assign(g.style, { left: `${L}px`, top: `${Tp}px`, width: `${D}px`, height: `${D}px` });
  g.innerHTML = `<div class="fly__y"><div class="fly__s"><div class="fly__img"></div><i class="fly__ring"></i></div></div>`;
  const box = $(".fly__img", g);
  if (img) {
    const ghost = img.cloneNode();
    ghost.removeAttribute("style");
    ghost.removeAttribute("loading");
    ghost.alt = "";
    // Im Stanzmodus liegt das Foto deckungsgleich über dem Original, sonst füllt es den Kreis
    if (!fromBtn) Object.assign(ghost.style, { position: "absolute", left: `${r.left - L}px`, top: `${r.top - Tp}px`, width: `${r.width}px`, height: `${r.height}px` });
    box.append(ghost);
  }
  document.body.append(g);

  const P = fromBtn ? 0 : 240; // Stanzen
  const dx = tx - cx;
  const dy = ty - cy;
  const Tf = Math.round(Math.min(860, Math.max(600, 320 + Math.hypot(dx, dy) * 0.42)));
  // Überhöhung, um von oben in die Tasche zu fallen – aber nie über den Bildschirmrand hinaus
  const lift = Math.max(6, Math.min(46, Math.abs(dy) * 0.16 + 14, ty - 24));
  const total = P + Tf;

  if (fromBtn) {
    box.style.clipPath = `inset(0 round ${D / 2}px)`;
    $(".fly__ring", g).style.opacity = "1";
  } else {
    // 1) Stanzen: vom sichtbaren Foto zum runden Muster
    const ins = `inset(${vTop - Tp}px ${L + D - r.right}px ${Tp + D - vBot}px ${r.left - L}px round 10px)`;
    box.animate({ clipPath: [ins, `inset(0px 0px 0px 0px round ${D / 2}px)`] }, { duration: P, easing: EASE_IO, fill: "both" });
    $(".fly__ring", g).animate({ opacity: [0, 1] }, { duration: 160, delay: P - 120, easing: "ease-out", fill: "both" });
    // Ursache sichtbar: das Foto gibt kurz nach, wo das Muster herauskommt
    img.animate({ filter: ["sepia(.08) brightness(.96)", "sepia(.08) brightness(.8)", "sepia(.08) brightness(.96)"] }, { duration: 760, easing: "ease-out" });
  }
  // 2) Bahn
  g.animate({ transform: ["none", `translateX(${dx}px)`] }, { duration: Tf, delay: P, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "both" });
  const fall = $(".fly__y", g).animate([
    { transform: "none", easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
    { transform: `translateY(${dy - lift}px)`, offset: 0.72, easing: "cubic-bezier(0.5, 0, 0.8, 0.4)" },
    { transform: `translateY(${dy}px)` },
  ], { duration: Tf, delay: P, fill: "both" });
  // 3) Größe: hebt sich ab, schrumpft im Flug, taucht in die Tasche
  $(".fly__s", g).animate([
    ...(fromBtn
      ? [{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1.06)", opacity: 1, offset: 0.18 }]
      : [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1)", opacity: 1, offset: P / total }, { transform: "scale(1.08)", opacity: 1, offset: (P + 110) / total }]),
    { transform: `scale(${30 / D}) rotate(-10deg)`, opacity: 1, offset: 0.9 },
    { transform: `scale(${14 / D}) rotate(-12deg)`, opacity: 0 },
  ], { duration: total, easing: EASE_IO, fill: "forwards" });

  // Landung genau dann, wenn das Muster in die Tasche taucht (letzte gut 10 % des Flugs)
  const landAt = Math.round(total * 0.88);
  setTimeout(() => {
    // Ansicht inzwischen zu? Dann landet es auf dem echten, jetzt sichtbaren Knopf
    if (dock?.isConnected && !wareEl.hidden && !wareEl.classList.contains("is-handoff")) { land(dock, to); dockOut(1200); }
    else if (!cartBtn.hidden) land(cartBtn, to);
  }, landAt);
  const finish = () => g.remove();
  fall.finished.then(finish, finish);
  return landAt;
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
wareEl.addEventListener("click", (e) => { if (e.target.closest("[data-open-cart-info]")) wareToCart(); });

async function openCart({ at = "cart", focusBack = null, onShow = null } = {}) {
  if (cartEl.hidden) lastFocus = focusBack || document.activeElement;
  step = at;
  // Nie eine leere Schublade einfahren lassen: kurz (höchstens 160 ms) auf den Inhalt warten
  await Promise.race([renderCart({ animate: false }), wait(160)]);
  showOverlay(cartEl);
  onShow?.();
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
    return `<li class="line${byIndex.has(i) ? " has-err" : ""}" data-line="${i}" style="--n:${Math.min(i, 4)}">
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
      <p class="line__price price" data-v="${p ? p.price * l.qty : 0}" data-shown="${p ? p.price * l.qty : 0}">${p ? euro(p.price * l.qty) : ""}</p>
    </li>`;
  }).join("");
  const opts = deliveryOptions(settings);
  const deliveryHtml = opts.length > 1 ? `
    <fieldset class="deliv">
      <legend class="deliv__l">Wie kommt es zu dir?</legend>
      ${opts.map((o) => `<label class="deliv__o"><input type="radio" name="delivery" value="${o}"${o === delivery ? " checked" : ""}>
        <span class="deliv__box"><span class="deliv__t">${o === "versand" ? "Versand" : "Abholung in Ramsen"}</span>
        <span class="deliv__s">${o === "versand" ? esc(`${settings.shipping.label}${settings.shipping.days ? `, ${settings.shipping.days}` : ""}`) : esc(settings.pickup.note)}</span></span>
        <span class="deliv__p"${o === "versand" ? " data-ship-price" : ""}>${o === "versand" ? shipPriceText(settings, res.subtotal) : "kostenlos"}</span></label>`).join("")}
    </fieldset>` : "";
  return `${notice ? `<p class="cart__notice" role="status">${esc(notice)}</p>` : ""}
    ${top.length ? `<p class="cart__alert" role="alert">${esc(top[0])}</p>` : ""}
    <ul class="lines">${lines}</ul>${deliveryHtml}`;
}

/** Preis auf der Versand-Karte (kostenlos ab der Grenze) */
function shipPriceText(settings, subtotal) {
  const s = settings.shipping;
  return !s.flat || (s.freeFrom && subtotal >= s.freeFrom) ? "kostenlos" : euro(s.flat);
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

// Zeilen-Knöpfe einmal am Körper delegiert: Der Index wird beim Klick gelesen (nach dem Entfernen neu nummeriert)
$("#cart-body").addEventListener("click", (e) => {
  const li = e.target.closest("[data-line]");
  if (!li) return;
  const i = Number(li.dataset.line);
  const q = e.target.closest("[data-lq]");
  if (q && !q.disabled) changeQty(i, Number(q.dataset.lq), li);
  else if (e.target.closest("[data-rm]")) removeLine(i, li);
});

function bindCart(demo) {
  const body = $("#cart-body");
  const foot = $("#cart-foot");
  $("[data-to-shop]", body)?.addEventListener("click", async () => { await closeCart(); $("#shop").scrollIntoView({ behavior: motion() ? "smooth" : "auto" }); });
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
  const price = $(".line__price", li);
  if (p) countTo(price, p.price * next); else price.textContent = "";
  refreshTotals();
}

// Zeilen nach dem Entfernen neu durchzählen (Index = Position in cart.lines)
function renumber() { $$("#cart-body [data-line]").forEach((x, n) => { x.dataset.line = String(n); x.style.setProperty("--n", String(Math.min(n, 4))); }); }

/** Zeile gleitet nach rechts hinaus, die anderen rücken weich nach – ohne Neuaufbau (Bilder blitzen nicht) */
async function removeLine(i, li) {
  if (li.dataset.gone || !cart.lines[i]) return;
  li.dataset.gone = "1";
  const name = $(".line__name", li)?.textContent || "Artikel";
  cart.lines.splice(i, 1);
  saveCart();
  announce(`${name} entfernt.`);
  li.removeAttribute("data-line");
  renumber();
  const last = !cart.lines.length;
  if (!last) refreshTotals(); // Summe zählt schon herunter, während die Zeile geht
  if (motion()) {
    const parts = [".line__img", ".line__main", ".line__price"].map((s) => $(s, li)).filter(Boolean);
    await Promise.all(parts.map((el, k) => el.animate({ opacity: [1, 0], transform: ["none", "translateX(28px)"] }, { duration: 220, delay: k * 30, easing: EXIT, fill: "forwards" }).finished));
    if (!last) {
      const h = li.offsetHeight;
      li.style.overflow = "hidden";
      await li.animate([
        { height: `${h}px`, paddingTop: getComputedStyle(li).paddingTop, paddingBottom: getComputedStyle(li).paddingBottom, borderBottomWidth: "1px" },
        { height: "0px", paddingTop: "0px", paddingBottom: "0px", borderBottomWidth: "0px" },
      ], { duration: 380, easing: DRAPE, fill: "forwards" }).finished;
    }
  }
  if (last) {
    // Der fokussierte Knopf verschwindet mit dem Neuaufbau, also Fokus bewusst im Dialog halten
    await renderCart({ dir: 0 });
    if (!cartEl.hidden) ($("[data-to-shop]", $("#cart-body")) || $("#cart-title")).focus({ preventScroll: true });
    return;
  }
  li.remove();
  const next = $$("#cart-body [data-rm]")[Math.min(i, cart.lines.length - 1)];
  (next || $("#cart-title")).focus({ preventScroll: true });
}

/** Betrag weich hoch- oder runterzählen; startet beim gerade angezeigten Wert (kein Flackern bei schnellem Klicken) */
function countTo(el, cents) {
  cancelAnimationFrame(el._raf);
  const from = Number(el.dataset.shown ?? el.dataset.v ?? NaN);
  el.dataset.v = cents;
  const show = (v) => { el.dataset.shown = v; el.textContent = euro(v); };
  if (!motion() || !Number.isFinite(from) || from === cents) { show(cents); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 460);
    const e = 1 - Math.pow(1 - k, 4);
    show(Math.round(from + (cents - from) * e));
    if (k < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

/** Summen nachziehen; die Gesamtsumme glimmt kurz in Messing */
function refreshTotals() {
  const { res, delivery, settings } = priced();
  const foot = $("#cart-foot");
  const sub = $('[data-sum="sub"]', foot);
  const ship = $('[data-sum="ship"]', foot);
  const tot = $('[data-sum="total"]', foot);
  if (sub) countTo(sub, res.subtotal);
  if (ship) {
    const wasFree = ship.textContent === "kostenlos";
    if (!res.shipping) {
      cancelAnimationFrame(ship._raf);
      ship.dataset.v = 0; ship.dataset.shown = 0; ship.textContent = "kostenlos";
      if (!wasFree && motion()) ship.animate([{ opacity: 0, transform: "translateY(6px)", color: "#dcbd88" }, { opacity: 1, transform: "none", color: "#dcbd88", offset: 0.5 }, { color: "" }], { duration: 900, easing: EASE_OUT });
    } else {
      if (wasFree) ship.dataset.shown = 0;
      countTo(ship, res.shipping);
    }
  }
  if (tot) {
    const changed = Number(tot.dataset.v) !== res.total;
    countTo(tot, res.total);
    if (changed && motion()) {
      tot._glow?.cancel();
      tot._glow = tot.animate([{ transform: "none" }, { transform: "scale(1.045)", color: "#dcbd88", offset: 0.3 }, { transform: "none" }], { duration: 640, easing: EASE_OUT });
    }
  }
  const sp = $("#cart-body [data-ship-price]");
  if (sp) sp.textContent = shipPriceText(settings, res.subtotal);
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
