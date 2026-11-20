// Kollektion (Schnittteile), Stückliste mit Filter und Produktbogen (Dialog, Deep-Link #produkt-<id>).
import { PRODUCTS, CATEGORIES, fmtPrice, productById } from "../shared/data.js";
import { esc, img, badges, altFor, ICON, reduceMotion, partNo, catLabel, cutLabel, lengthOf, mapPoint } from "./util.js";

/* ---------- Kollektion: Schnittteile mit Maßlinien ---------- */
// Bildwahl + Anmerkungen in Foto-Koordinaten (0…1). dim = senkrechte Maßlinie, pins = Positionsnummern.
const PIECE = {
  lene: {
    file: "lene-1.webp", pos: [0.5, 0.5], alt: "Rock Lene aus hellem Karo-Leinen, knielang, mit dunkelblauem Pulli und Korbtasche",
    dim: { u: 0.05, v1: 0.18, v2: 0.83, e1: 0.29, e2: 0.12 },
    pins: [{ u: 0.5, v: 0.2, t: "Bund mit Knopf", side: "r" }],
  },
  "viola-kleid": {
    file: "viola-kleid-2.webp", pos: [0.5, 0.85], alt: "Kleid Viola aus mintgrüner Vintage-Bettwäsche mit lila Blumen, Rückansicht mit gebundenen Trägern",
    dim: { u: 0.93, v1: 0.28, v2: 0.93, e1: 0.66, e2: 0.8 },
    pins: [{ u: 0.63, v: 0.21, t: "Träger zum Binden", side: "l" }],
  },
  millie: {
    file: "millie-2.webp", pos: [0.5, 0.5], alt: "Weinroter Musselinrock Millie mit Knopfleiste, die Hand hält den Rock seitlich",
    dim: { u: 0.25, v1: 0.41, v2: 0.97, e1: 0.44, e2: 0.32 },
    pins: [{ u: 0.555, v: 0.56, t: "Zierknopfleiste", side: "r" }],
  },
  rosemary: {
    file: "rosemary-6.webp", pos: [0.5, 0.4], alt: "Cathrin trägt das graue Leinenkleid Rosemary über einem weißen Langarmshirt",
    pins: [{ u: 0.66, v: 0.86, t: "Grau: ein alter Bettbezug", side: "l" }],
  },
  stulpen: {
    file: "stulpen-13.webp", pos: [0.5, 0.5], alt: "Hände in dunkelgrauen Walk-Stulpen mit Daumenloch über buntem Herbstlaub",
    pins: [{ u: 0.46, v: 0.6, t: "Walk, 100 % Schurwolle", side: "r" }],
  },
  "kragen-frucht": {
    file: "kragen-frucht-2.webp", pos: [0.5, 0.6], alt: "Wendekragen Forbidden Fruit mit dunklem Liberty-Blütendruck, flach gelegt neben einem Kiefernzweig",
    pins: [
      { u: 0.24, v: 0.47, t: "Seite B: Vintage-Weiß", side: "r" },
      { u: 0.55, v: 0.78, t: "Seite A: Liberty", side: "l" },
    ],
  },
  "kragen-betsy": { file: "kragen-betsy-4.webp", pos: [0.5, 0.6] },
  "kragen-karo": { file: "kragen-karo-1.webp", pos: [0.5, 0.6] },
};
const FRAME = 4 / 5;

function annotations(p, a, file, pos) {
  let svg = "", tags = "";
  const n = (x) => x.toFixed(2);
  if (a.dim) {
    const { u, v1, v2, e1, e2 } = a.dim;
    const [x, y1] = mapPoint(file, FRAME, pos, [u, v1]);
    const [, y2] = mapPoint(file, FRAME, pos, [u, v2]);
    const [ex1] = mapPoint(file, FRAME, pos, [e1, v1]);
    const [ex2] = mapPoint(file, FRAME, pos, [e2, v2]);
    const label = lengthOf(p);
    // Zeichnung in einem 100×125-Koordinatensystem (= Rahmen 4:5)
    const X = x, Y1 = y1 * 1.25, Y2 = y2 * 1.25, EX1 = ex1, EX2 = ex2;
    const dir = EX1 > X ? 1 : -1;
    svg += `<g class="anno__dim">
      <line x1="${n(EX1)}" y1="${n(Y1)}" x2="${n(X - dir * 1.6)}" y2="${n(Y1)}"/>
      <line x1="${n(EX2)}" y1="${n(Y2)}" x2="${n(X - dir * 1.6)}" y2="${n(Y2)}"/>
      <line class="anno__main" x1="${n(X)}" y1="${n(Y1 + 0.6)}" x2="${n(X)}" y2="${n(Y2 - 0.6)}"/>
      <path class="anno__head" d="M${n(X)} ${n(Y1)} l-1 2.6 h2 z M${n(X)} ${n(Y2)} l-1 -2.6 h2 z"/>
    </g>`;
    if (label) tags += `<span class="tag tag--v" style="left:${n(X)}%;top:${n((y1 + y2) / 2)}%">${esc(label)}</span>`;
  }
  (a.pins || []).forEach((pin, i) => {
    const [x, y] = mapPoint(file, FRAME, pos, [pin.u, pin.v]);
    svg += `<g class="anno__pin"><circle cx="${n(x)}" cy="${n(y * 1.25)}" r="1.1"/></g>`;
    tags += `<span class="tag tag--pin tag--${pin.side}" style="left:${n(x)}%;top:${n(y)}%"><b>${i + 1}</b>${esc(pin.t)}</span>`;
  });
  return svg || tags
    ? `<svg class="anno" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden="true" focusable="false">${svg}</svg>${tags}`
    : "";
}

const GRAIN = '<svg class="grain" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M2 6h196M2 6l9-5M2 6l9 5M198 6l-9-5M198 6l-9 5"/></svg>';

let lastFeatured = "";
export function renderFeatured(content) {
  const ids = (content.featured || []).filter((id) => productById(id));
  const sig = ids.join(",");
  if (sig === lastFeatured) return;
  lastFeatured = sig;
  const el = document.getElementById("featured");
  if (!ids.length) {
    el.innerHTML = `<p class="empty">Gerade liegt nichts Besonderes auf dem Tisch. In der Stückliste findest du alle Teile.</p>`;
    return;
  }
  el.innerHTML = ids.map((id, i) => {
    const p = productById(id);
    const a = PIECE[id] || {};
    const file = a.file || p.hero;
    const pos = a.pos || [0.5, 0.5];
    const colors = p.colors?.length ? `<div><dt>Farben</dt><dd>${p.colors.map(esc).join(", ")}</dd></div>` : "";
    return `
    <article class="piece" aria-labelledby="pc-${p.id}">
      <a class="piece__media" href="#produkt-${p.id}" data-product="${p.id}" aria-label="${esc(p.name)}: alle ${p.images.length} Fotos und Details">
        ${img(file, a.alt || `${p.name}, ${p.subtitle}`, { pos: `${pos[0] * 100}% ${pos[1] * 100}%` })}
        ${annotations(p, a, file, pos)}
        <span class="piece__count mono">${p.images.length} Fotos</span>
      </a>
      <div class="piece__label">
        <p class="piece__no mono"><span>Teil ${partNo(p)}</span><span>${esc(catLabel(p.category))}</span></p>
        <h3 id="pc-${p.id}">${esc(p.name)}</h3>
        <p class="piece__sub">${esc(p.subtitle)}</p>
        <div class="piece__grain">${GRAIN}<span class="mono">Fadenlauf</span></div>
        <dl class="piece__spec">
          <div><dt>Stoff</dt><dd>${esc(p.material)}</dd></div>
          <div><dt>Zuschnitt</dt><dd>${esc(cutLabel(p))}</dd></div>
          ${colors}
        </dl>
        <p class="piece__short">${esc(p.short)}</p>
        <div class="piece__foot">
          <p class="price">${esc(fmtPrice(p.price, p.priceFrom))}</p>
          ${badges(p)}
        </div>
        <div class="piece__actions">
          <a class="btn btn--ink btn--small" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen<svg class="i-ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg></a>
          <a class="btn btn--line btn--small" href="#produkt-${p.id}" data-product="${p.id}">Details</a>
        </div>
      </div>
    </article>`;
  }).join("");
}

/* ---------- Stückliste ---------- */
export function initCatalog() {
  const tabs = document.getElementById("filter");
  const body = document.getElementById("catalog");
  const panel = document.getElementById("catalog-panel");
  const status = document.getElementById("catalog-status");
  const cats = [{ id: "alle", label: "Alle Teile" }, ...CATEGORIES];

  tabs.innerHTML = cats.map((c, i) => {
    const n = c.id === "alle" ? PRODUCTS.length : PRODUCTS.filter((p) => p.category === c.id).length;
    return `<button type="button" role="tab" id="tab-${c.id}" data-cat="${c.id}" aria-controls="catalog-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(c.label)}<span class="mono">${String(n).padStart(2, "0")}</span></button>`;
  }).join("");

  body.innerHTML = PRODUCTS.map((p) => {
    const thumb = PIECE[p.id]?.file && p.category === "kragen" ? PIECE[p.id].file : p.hero;
    return `<tr data-cat="${p.category}">
      <td class="parts__no mono" data-label="Teil">${partNo(p)}</td>
      <td class="parts__thumb">${img(thumb, "")}</td>
      <td class="parts__name">
        <button type="button" data-product="${p.id}">${esc(p.name)}</button>
        <small>${esc(p.subtitle)}</small>
      </td>
      <td class="parts__mat"><span class="mono parts__k">Stoff</span>${esc(p.material)}</td>
      <td class="parts__badges">${badges(p) || '<span class="parts__none" aria-hidden="true">–</span>'}</td>
      <td class="parts__price num">${esc(fmtPrice(p.price, p.priceFrom))}<span class="parts__go" aria-hidden="true">${ICON.arrow}</span></td>
    </tr>`;
  }).join("");

  const select = (btn, focus = false) => {
    const cat = btn.dataset.cat;
    tabs.querySelectorAll("[role=tab]").forEach((b) => {
      const on = b === btn;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", btn.id);
    let shown = 0;
    body.querySelectorAll("tr").forEach((tr) => {
      const hide = cat !== "alle" && tr.dataset.cat !== cat;
      tr.hidden = hide;
      if (!hide) shown++;
    });
    status.textContent = `${shown} ${shown === 1 ? "Teil" : "Teile"} in „${btn.firstChild.textContent}“`;
    if (focus) btn.focus();
  };
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[role=tab]");
    if (btn) select(btn);
  });
  tabs.addEventListener("keydown", (e) => {
    const all = [...tabs.querySelectorAll("[role=tab]")];
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const go = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    select(all[(go + all.length) % all.length], true);
  });
}

/* ---------- Produktbogen (Dialog) ---------- */
const dialog = () => document.getElementById("product-dialog");
let lastFocus = null;
let currentId = null;
let restoreFocus = true;
let onFitting = () => {};
const BASE_TITLE = document.title;

function renderDetail(p) {
  const n = p.images.length;
  const slides = p.images.map((f, i) => `<li class="gal__slide" aria-roledescription="Folie" aria-label="Abbildung ${i + 1} von ${n}">${img(f, altFor(p, i), { eager: i < 2 })}</li>`).join("");
  const thumbs = p.images.map((f, i) => `<button type="button" class="gal__thumb" data-go="${i}" aria-label="Abbildung ${i + 1} zeigen"${i === 0 ? ' aria-current="true"' : ""}>${img(f, "")}<span class="mono">${String(i + 1).padStart(2, "0")}</span></button>`).join("");
  const colors = p.colors?.length ? `<div><dt>Farben</dt><dd><ul class="colors">${p.colors.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></dd></div>` : "";
  const len = lengthOf(p);
  return `
    <div class="sheet__bar">
      <p class="mono"><span>Teil ${partNo(p)}</span> ${esc(catLabel(p.category))}</p>
      <button type="button" class="sheet__close" data-close><span>Schließen</span>${ICON.close}</button>
    </div>
    <div class="sheet__body">
      <div class="gal" aria-roledescription="Karussell" aria-label="Fotos: ${esc(p.name)}">
        <div class="gal__stage">
          <ul class="gal__track" tabindex="0" aria-label="Fotos wischen oder mit den Pfeiltasten blättern">${slides}</ul>
          <button type="button" class="gal__nav gal__nav--prev" data-step="-1" aria-label="Vorheriges Foto" disabled>${ICON.prev}</button>
          <button type="button" class="gal__nav gal__nav--next" data-step="1" aria-label="Nächstes Foto"${n < 2 ? " disabled" : ""}>${ICON.next}</button>
          <p class="gal__count mono" aria-live="polite">Abb. <span data-count>1</span> / ${n}</p>
        </div>
        <div class="gal__thumbs">${thumbs}</div>
      </div>
      <div class="pd">
        <h2 id="pd-title" tabindex="-1">${esc(p.name)}</h2>
        <p class="pd__sub">${esc(p.subtitle)}</p>
        <div class="pd__price"><p class="price">${esc(fmtPrice(p.price, p.priceFrom))}</p>${badges(p)}</div>
        <p class="pd__short">${esc(p.short)}</p>
        <dl class="pd__spec">
          <div><dt>Stoff</dt><dd>${esc(p.material)}</dd></div>
          <div><dt>Zuschnitt</dt><dd>${esc(cutLabel(p))}</dd></div>
          ${len ? `<div><dt>Maß</dt><dd>${esc(len)}</dd></div>` : ""}
          ${colors}
        </dl>
        ${p.details?.length ? `<h3 class="mono pd__h">Details</h3><ul class="pd__details">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
        ${p.story ? `<blockquote class="pd__story"><p>${esc(p.story)}</p><footer class="mono">Cathrin</footer></blockquote>` : ""}
        <div class="pd__actions">
          <a class="btn btn--ink" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen<svg class="i-ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg></a>
          <button type="button" class="btn btn--line" data-fitting="${p.id}">Anprobe anfragen</button>
        </div>
        <p class="pd__fine">Bestellung, Bezahlung und Versand laufen sicher über Etsy. Ich verpacke alles in Graskarton, so plastikfrei wie möglich.${p.madeToMeasure ? " Deine Maße gibst du bei der Bestellung an, wie du misst, zeige ich dir unten unter „Maße nehmen“." : ""}</p>
      </div>
    </div>`;
}

function wireGallery(root) {
  const track = root.querySelector(".gal__track");
  const slides = [...track.children];
  const prev = root.querySelector(".gal__nav--prev");
  const next = root.querySelector(".gal__nav--next");
  const count = root.querySelector("[data-count]");
  const thumbs = [...root.querySelectorAll(".gal__thumb")];
  let index = 0;
  const go = (i) => {
    i = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: slides[i].offsetLeft, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const sync = () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (i === index) return;
    index = i;
    count.textContent = String(i + 1);
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
    thumbs.forEach((t, k) => (k === i ? t.setAttribute("aria-current", "true") : t.removeAttribute("aria-current")));
    const t = thumbs[i];
    if (t) t.parentElement.scrollTo({ left: t.offsetLeft - t.parentElement.clientWidth / 2 + t.clientWidth / 2, behavior: "auto" });
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
  inner.querySelector(".gal__track").scrollLeft = 0;
  inner.scrollTop = 0;
  inner.querySelector(".sheet__body").scrollTop = 0;
  document.getElementById("pd-title").focus({ preventScroll: true });
  document.documentElement.classList.add("is-locked");
  const hash = `#produkt-${id}`;
  if (!fromHash && location.hash !== hash) history.pushState(null, "", hash);
  document.title = `${p.name} – Cathrin Raasch Atelier`;
}

function cleanup() {
  document.documentElement.classList.remove("is-locked");
  document.title = BASE_TITLE;
  if (location.hash.startsWith("#produkt-")) history.replaceState(null, "", location.pathname + location.search);
  const id = currentId;
  currentId = null;
  if (restoreFocus) {
    // Direkt per Link geöffnet: Es gab vorher keinen Fokus, also zur Zeile in der Stückliste zurück.
    const had = lastFocus && lastFocus !== document.body && document.contains(lastFocus);
    const back = had ? lastFocus : document.querySelector(`#catalog [data-product="${id}"]`);
    if (back) {
      back.focus({ preventScroll: true });
      if (!had) back.closest("tr")?.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }
  restoreFocus = true;
}

export function initProductDialog({ onFittingRequest }) {
  onFitting = onFittingRequest;
  const dlg = dialog();
  dlg.addEventListener("close", cleanup);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) { dlg.close(); return; }
    if (e.target.closest("[data-close]")) { dlg.close(); return; }
    const fit = e.target.closest("[data-fitting]");
    if (fit) {
      restoreFocus = false;
      dlg.close();
      requestAnimationFrame(() => onFitting(fit.dataset.fitting));
    }
  });
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
