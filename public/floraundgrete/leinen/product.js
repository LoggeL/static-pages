// Katalog mit Filter und Produktdetail (Dialog mit Galerie, Deep-Link #produkt-<id>).
import { PRODUCTS, CATEGORIES, SHOP, fmtPrice, productById } from "../shared/data.js";
import { esc, img, badges, altFor, ICON, reduceMotion } from "./util.js";

const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "";
let onFitting = () => {};

// Katalogbild + Hover-Bild: bei den Kragen zuerst das Flatlay, beim Drüberfahren getragen
// (sonst stehen drei fast gleiche Gesichts-Ausschnitte nebeneinander).
const CARD = {
  "kragen-betsy": ["kragen-betsy-4.webp", "kragen-betsy-7.webp"],
  "kragen-karo": ["kragen-karo-1.webp", "kragen-karo-4.webp"],
};

/* ---------- Katalog ---------- */
export function initCatalog() {
  const filter = document.getElementById("filter");
  const list = document.getElementById("catalog");
  const status = document.getElementById("catalog-status");

  const cats = [{ id: "alle", label: "Alle Stücke" }, ...CATEGORIES];
  filter.innerHTML = cats
    .map((c) => {
      const n = c.id === "alle" ? PRODUCTS.length : PRODUCTS.filter((p) => p.category === c.id).length;
      return `<button type="button" data-cat="${c.id}" aria-pressed="${c.id === "alle"}">${esc(c.label)}<sup>${n}</sup></button>`;
    })
    .join("");

  list.innerHTML = PRODUCTS.map((p) => {
    const [hero, second] = CARD[p.id] || [p.hero, p.images.find((f) => f !== p.hero)];
    return `<li data-cat="${p.category}">
      <a class="card__link" href="#produkt-${p.id}" data-product="${p.id}">
        <div class="card__media">
          <div class="card__img-wrap">
            ${img(hero, `${p.name}, ${p.subtitle}`)}
            ${second ? img(second, "", {}) : ""}
          </div>
          <div class="card__badges">${badges(p)}</div>
        </div>
        <div class="card__body">
          <p class="card__cat">${esc(catLabel(p.category))}</p>
          <h3 class="card__name">${esc(p.name)}</h3>
          <p class="card__sub">${esc(p.subtitle)}</p>
          <p class="card__price">${esc(fmtPrice(p.price, p.priceFrom))}</p>
        </div>
      </a>
    </li>`;
  }).join("") + `
    <li class="catalog__tile">
      <div class="tile">
        <p class="eyebrow">Auf Wunsch</p>
        <p class="tile__title">Dein Lieblingsstück ist nicht dabei?</p>
        <p class="tile__text">Viele Teile nähe ich auch in anderen Farben, Längen und Größen. Schreib mir einfach, was du dir vorstellst.</p>
        <div class="tile__actions">
          <a class="btn btn--primary btn--small" href="${SHOP.etsy}" target="_blank" rel="noopener">Zum Etsy-Shop <span aria-hidden="true">↗</span></a>
          <a class="link-arrow" href="#anprobe">Anprobe anfragen</a>
        </div>
      </div>
    </li>`;

  // Die Abschluss-Kachel füllt immer die letzte Reihe auf (oder bekommt eine eigene, volle Reihe).
  const tile = list.querySelector(".catalog__tile");
  const layoutTile = () => {
    const cols = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const shown = list.querySelectorAll("li[data-cat]:not(.is-hidden)").length;
    const rest = shown % cols;
    const span = rest ? cols - rest : cols;
    tile.style.gridColumn = `span ${span}`;
    tile.classList.toggle("is-wide", span >= 2);
    tile.classList.toggle("is-full", span === cols && cols > 1);
  };
  layoutTile();
  window.addEventListener("resize", layoutTile, { passive: true });

  filter.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cat]");
    if (!btn) return;
    const cat = btn.dataset.cat;
    filter.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    let shown = 0;
    list.querySelectorAll("li[data-cat]").forEach((li) => {
      const hide = cat !== "alle" && li.dataset.cat !== cat;
      li.classList.toggle("is-hidden", hide);
      if (!hide) {
        shown++;
        // Karten-Animation neu starten
        li.style.animation = "none"; void li.offsetWidth; li.style.animation = "";
        li.style.animationDelay = `${(shown - 1) * 45}ms`;
      }
    });
    layoutTile();
    status.textContent = `${shown} ${shown === 1 ? "Stück" : "Stücke"} in „${btn.firstChild.textContent}“`;
  });
}

/* ---------- Produktdetail ---------- */
const dialog = () => document.getElementById("product-dialog");
let lastFocus = null;
let currentId = null;
let restoreFocus = true;
const BASE_TITLE = document.title;
function renderDetail(p) {
  const n = p.images.length;
  const slides = p.images
    .map((f, i) => `<li class="gallery__slide" id="pd-slide-${i}" aria-roledescription="Folie" aria-label="${i + 1} von ${n}">${img(f, altFor(p, i), { eager: i < 2 })}</li>`)
    .join("");
  const thumbs = p.images
    .map((f, i) => `<button type="button" class="thumb" data-go="${i}" aria-label="Foto ${i + 1} zeigen"${i === 0 ? ' aria-current="true"' : ""}>${img(f, "")}</button>`)
    .join("");
  const colors = p.colors?.length ? `<div class="pd__section"><h3>Farben</h3><ul class="swatches">${p.colors.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : "";
  const details = p.details?.length ? `<div class="pd__section"><h3>Details</h3><ul class="pd__details">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>` : "";
  const story = p.story ? `<blockquote class="pd__story"><p>${esc(p.story)}</p></blockquote>` : "";
  return `
    <button type="button" class="pd__close" data-close aria-label="Schließen">${ICON.close}</button>
    <div class="gallery" aria-roledescription="Karussell" aria-label="Fotos: ${esc(p.name)}">
      <ul class="gallery__track" tabindex="0" aria-label="Fotos wischen oder mit Pfeiltasten blättern">${slides}</ul>
      <button type="button" class="gallery__nav gallery__nav--prev" data-step="-1" aria-label="Vorheriges Foto" disabled>${ICON.prev}</button>
      <button type="button" class="gallery__nav gallery__nav--next" data-step="1" aria-label="Nächstes Foto"${n < 2 ? " disabled" : ""}>${ICON.next}</button>
      <div class="gallery__foot">
        <p class="gallery__count" aria-live="polite"><span data-count>1</span> / ${n}</p>
        <div class="thumbs">${thumbs}</div>
      </div>
    </div>
    <div class="pd__info">
      <p class="eyebrow">${esc(catLabel(p.category))}</p>
      <h2 id="pd-title" tabindex="-1">${esc(p.name)}</h2>
      <p class="pd__sub">${esc(p.subtitle)}</p>
      <div class="pd__price"><span class="price">${esc(fmtPrice(p.price, p.priceFrom))}</span>${badges(p)}</div>
      <p class="pd__short">${esc(p.short)}</p>
      ${story}
      <div class="pd__section"><h3>Material</h3><p>${esc(p.material)}</p></div>
      ${colors}
      ${details}
      <div class="pd__actions">
        <a class="btn btn--primary" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen <span aria-hidden="true">↗</span></a>
        <button type="button" class="btn btn--ghost" data-fitting="${p.id}">Anprobe anfragen</button>
      </div>
      <p class="pd__fine">Bestellung, Maße und Versand laufen sicher über Etsy. Verpackt in Graskartons, so plastikfrei wie möglich.</p>
    </div>`;
}

function wireGallery(root) {
  const track = root.querySelector(".gallery__track");
  const slides = [...track.children];
  const prev = root.querySelector(".gallery__nav--prev");
  const next = root.querySelector(".gallery__nav--next");
  const count = root.querySelector("[data-count]");
  const thumbs = [...root.querySelectorAll(".thumb")];
  let index = 0;

  const go = (i) => {
    i = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const sync = () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (i === index) return;
    index = i;
    count.textContent = String(i + 1);
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
    thumbs.forEach((t, k) => (k === i ? t.setAttribute("aria-current", "true") : t.removeAttribute("aria-current")));
    thumbs[i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  let raf = 0;
  track.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); }, { passive: true });
  root.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => go(index + Number(b.dataset.step))));
  thumbs.forEach((t) => t.addEventListener("click", () => go(Number(t.dataset.go))));
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
  });
}

export function openProduct(id, { fromHash = false } = {}) {
  const p = productById(id);
  const dlg = dialog();
  if (!p || !dlg) return;
  if (!dlg.open) lastFocus = document.activeElement;
  currentId = id;
  const inner = document.getElementById("pd-inner");
  inner.innerHTML = renderDetail(p);
  wireGallery(inner);
  if (!dlg.open) dlg.showModal();
  inner.querySelector(".gallery__track").scrollLeft = 0;
  inner.querySelector(".pd__info").scrollTop = 0;
  inner.scrollTop = 0;
  document.getElementById("pd-title").focus({ preventScroll: true });
  document.documentElement.style.overflow = "hidden";
  const hash = `#produkt-${id}`;
  if (!fromHash && location.hash !== hash) history.pushState(null, "", hash);
  document.title = `${p.name} – Cathrin Raasch Atelier`;
}

function cleanup() {
  document.documentElement.style.overflow = "";
  document.title = BASE_TITLE;
  if (location.hash.startsWith("#produkt-")) history.replaceState(null, "", location.pathname + location.search);
  currentId = null;
  if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  restoreFocus = true;
}

export function closeProduct() {
  const dlg = dialog();
  if (dlg?.open) dlg.close();
}

export function initProductDialog({ onFittingRequest }) {
  onFitting = onFittingRequest;
  const dlg = dialog();
  dlg.addEventListener("close", cleanup);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) { dlg.close(); return; } // Klick auf den Hintergrund
    if (e.target.closest("[data-close]")) { dlg.close(); return; }
    const fit = e.target.closest("[data-fitting]");
    if (fit) {
      const id = fit.dataset.fitting;
      restoreFocus = false;
      dlg.close();
      document.documentElement.style.overflow = "";
      requestAnimationFrame(() => onFitting(id));
    }
  });

  // Alle Links/Buttons, die ein Produkt öffnen
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-product]");
    if (!t || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    openProduct(t.dataset.product);
  });

  const fromHash = () => {
    const m = location.hash.match(/^#produkt-([\w-]+)$/);
    if (m && productById(m[1])) { if (currentId !== m[1]) openProduct(m[1], { fromHash: true }); }
    else if (dlg.open) dlg.close();
  };
  window.addEventListener("hashchange", fromHash);
  window.addEventListener("popstate", fromHash);
  fromHash();
}
