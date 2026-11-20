// Produktdetails: Schublade von rechts (Desktop) bzw. Bottom-Sheet (Handy), mit Galerie.
import { CATEGORIES, SHOP, fmtPrice, productById } from "../shared/data.js";
import { esc, img, icon, badges, colorOf, altFor, reduceMotion } from "./util.js";

let dlg, body, opener = null, pushed = false, current = null, onFitting = () => {};
let closing = null;
// Zahl und Einheit nicht umbrechen („100 %“, „40 °C“, „68 cm“)
const nb = (t) => esc(t).replace(/(\d) (%|°C|cm|€)/g, "$1\u00a0$2");

export function initProductSheet(opts = {}) {
  onFitting = opts.onFitting || onFitting;
  dlg = document.getElementById("product-sheet");
  body = document.getElementById("sheet-body");
  try { history.scrollRestoration = "manual"; } catch { /* egal */ }

  dlg.addEventListener("cancel", (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) return requestClose(); // Klick auf den abgedunkelten Hintergrund
    if (e.target.closest("[data-close]")) return requestClose();
    const fit = e.target.closest("[data-fit]");
    if (fit) { const id = fit.dataset.fit; requestClose({ restoreFocus: false }).then(() => onFitting(id)); return; }
    const th = e.target.closest(".thumb");
    if (th) goTo(Number(th.dataset.i));
    if (e.target.closest("[data-prev]")) step(-1);
    if (e.target.closest("[data-next]")) step(1);
  });
  dlg.addEventListener("close", afterClose);

  window.addEventListener("popstate", () => {
    if (dlg.open && !location.hash.startsWith("#produkt-")) { pushed = false; requestClose({ fromHistory: true }); }
    else if (!dlg.open) fromHash();
  });
  window.addEventListener("hashchange", fromHash);
  fromHash();
}

function fromHash() {
  const m = location.hash.match(/^#produkt-([\w-]+)$/);
  if (m && productById(m[1]) && (!dlg.open || current !== m[1])) openProduct(m[1], null, { push: false });
}

export function openProduct(id, from, { push = true } = {}) {
  const p = productById(id);
  if (!p) return;
  if (!dlg.open) opener = from || document.activeElement;
  current = id;
  render(p);
  if (!dlg.open) {
    dlg.classList.remove("is-closing");
    dlg.showModal();
  }
  body.querySelector(".sheet-close").focus({ preventScroll: true });
  body.querySelector(".sheet-scroll").scrollTop = 0;
  if (push && location.hash !== `#produkt-${id}`) {
    history.pushState({ fgProduct: id }, "", `#produkt-${id}`);
    pushed = true;
  }
}

function requestClose({ restoreFocus = true, fromHistory = false } = {}) {
  if (!dlg.open) return Promise.resolve();
  if (closing) return closing;
  dlg.dataset.restore = restoreFocus ? "1" : "";
  closing = new Promise((resolve) => {
    const done = () => {
      dlg.close();
      // Adresse wieder aufräumen (ohne Seitensprung)
      if (!fromHistory && location.hash.startsWith("#produkt-")) {
        if (pushed) {
          pushed = false;
          const t = setTimeout(resolve, 250);
          window.addEventListener("popstate", () => { clearTimeout(t); setTimeout(resolve, 0); }, { once: true });
          history.back();
          return;
        }
        history.replaceState(null, "", location.pathname + location.search);
      }
      resolve();
    };
    if (reduceMotion()) return done();
    dlg.classList.add("is-closing");
    setTimeout(done, 200);
  }).finally(() => { closing = null; dlg.classList.remove("is-closing"); });
  return closing;
}

function afterClose() {
  current = null;
  if (dlg.dataset.restore && opener && document.contains(opener)) opener.focus({ preventScroll: true });
  opener = null;
}

/* ---------- Galerie ---------- */
function track() { return body.querySelector(".gal-track"); }
function idx() { const t = track(); return t ? Math.round(t.scrollLeft / t.clientWidth) : 0; }
function goTo(i) {
  const t = track();
  if (!t) return;
  const n = t.children.length;
  const k = (i + n) % n;
  t.scrollTo({ left: k * t.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" });
  sync(k);
}
function step(d) { goTo(idx() + d); }
function sync(k = idx()) {
  const n = track().children.length;
  body.querySelector(".gal-count").textContent = `${k + 1} / ${n}`;
  body.querySelectorAll(".thumb").forEach((b, i) => b.setAttribute("aria-current", String(i === k)));
  const th = body.querySelector(`.thumb[data-i="${k}"]`);
  if (th) {
    const row = th.parentElement;
    const l = th.offsetLeft - row.clientWidth / 2 + th.clientWidth / 2;
    row.scrollTo({ left: l, behavior: "auto" });
  }
}

function render(p) {
  const cat = CATEGORIES.find((c) => c.id === p.category)?.label || "";
  const many = p.images.length > 1;
  body.innerHTML = `
    <span class="sheet-handle" aria-hidden="true"></span>
    <header class="sheet-top">
      <p class="sheet-cat">${icon("bag", "ico-sm")}${esc(cat)}</p>
      <button type="button" class="icon-btn sheet-close" data-close aria-label="Details schließen">${icon("x")}</button>
    </header>
    <div class="sheet-scroll">
      <div class="gallery">
        <div class="gal-track" tabindex="0" role="region" aria-roledescription="Bildergalerie" aria-label="Fotos von ${esc(p.name)}, mit Pfeiltasten oder Wischen blättern">
          ${p.images.map((f, i) => `<figure class="gal-slide">${img(f, altFor(p, i), { eager: i === 0, sizes: "(min-width: 900px) 560px, 100vw" }).replace(/ style="[^"]*"/, "")}</figure>`).join("")}
        </div>
        ${many ? `<button type="button" class="gal-btn gal-prev" data-prev aria-label="Vorheriges Foto">${icon("chevronLeft")}</button>
        <button type="button" class="gal-btn gal-next" data-next aria-label="Nächstes Foto">${icon("chevronRight")}</button>` : ""}
        <p class="gal-count" aria-live="polite">1 / ${p.images.length}</p>
      </div>
      ${many ? `<div class="thumbs" role="group" aria-label="Foto auswählen">${p.images.map((f, i) => `<button type="button" class="thumb" data-i="${i}" aria-label="Foto ${i + 1} zeigen" aria-current="${i === 0}">${img(f, "").replace(' loading="lazy"', "")}</button>`).join("")}</div>` : ""}

      <div class="sheet-content">
        ${badges(p)}
        <h2 class="sheet-title" id="sheet-title">${esc(p.name)}</h2>
        <p class="sheet-sub">${esc(p.subtitle)}</p>
        <p class="sheet-price">${esc(fmtPrice(p.price, p.priceFrom))}${p.freeShipping ? '<span class="muted small"> · versandkostenfrei</span>' : ""}</p>
        <p class="sheet-short">${nb(p.short)}</p>

        ${p.details?.length ? `<div class="info-block"><h3 class="info-title">Details</h3>
          <ul class="checks">${p.details.map((d) => `<li>${icon("check", "ico-sm")}<span>${nb(d)}</span></li>`).join("")}</ul></div>` : ""}

        <div class="info-grid">
          ${p.colors?.length ? `<div class="info-block"><h3 class="info-title">Farben</h3>
            <ul class="swatches">${p.colors.map((c) => `<li><span class="sw" style="background:${colorOf(c)}" aria-hidden="true"></span>${esc(c)}</li>`).join("")}</ul></div>` : ""}
          <div class="info-block"><h3 class="info-title">Material</h3><p>${esc(p.material)}</p>
            ${p.madeToMeasure ? `<p class="muted small mt">Auf deine Maße genäht. Die Maße gibst du bei der Bestellung an oder wir nehmen sie bei der Anprobe.</p>` : ""}
            ${p.unique ? `<p class="muted small mt">Echtes Einzelstück: Wenn es weg ist, ist es weg.</p>` : ""}
          </div>
        </div>

        ${p.story ? `<figure class="story">
          <img src="../img/${SHOP.portraitSmall}" alt="" width="1400" height="1400" loading="lazy" decoding="async">
          <blockquote><p>${nb(p.story)}</p></blockquote>
          <figcaption>Cathrin über ${esc(p.name.replace(/^(Rock|Kleid|Musselinrock|Crop-Top|Wendekragen)\s+/, ""))}</figcaption>
        </figure>` : ""}
      </div>
    </div>
    <footer class="sheet-actions">
      <a class="btn btn-primary" href="${esc(p.url)}" target="_blank" rel="noopener"><span>Auf Etsy ansehen</span>${icon("external")}</a>
      <button type="button" class="btn btn-soft" data-fit="${esc(p.id)}">${icon("calendar")}<span>Anprobe anfragen</span></button>
    </footer>`;

  const t = track();
  let raf = 0;
  t.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => sync()); }, { passive: true });
  t.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  });
}
