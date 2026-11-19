// Produkt-Detail als <dialog>: Galerie (wischen, Pfeile, Daumen), Details, Etsy & Anprobe.
// Deep-Link: #produkt-<id>. Zurück-Taste schließt den Dialog.
import { PRODUCTS, CATEGORIES, SHOP, fmtPrice, productById } from "../shared/data.js";
import { esc, img, colorOf, badgesOf, prefersReducedMotion } from "./util.js";

const CAT_BG = { roecke: "var(--mint-soft)", kleider: "var(--lilac-soft)", kragen: "var(--blush-soft)", accessoires: "var(--mustard-soft)" };
const PREFIX = "#produkt-";

let dlg, box, current = null, opener = null, pushed = false, fromHistoryClose = false, afterPop = null;
let onFitting = () => {};

export function initProduct({ requestFitting }) {
  onFitting = requestFitting;
  // Beim Schließen per history.back() würde der Browser sonst die alte Scrollposition
  // wiederherstellen und den Sprung zur Anprobe wieder rückgängig machen.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  dlg = document.getElementById("product-dialog");
  box = document.getElementById("pd-content");

  // Klick auf Hintergrund schließt
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeProduct(); });
  dlg.addEventListener("close", handleClosed);

  // Alle Öffner (auch später gerenderte) per Delegation
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-product]");
    if (!t || dlg.contains(t)) return;
    e.preventDefault();
    openProduct(t.dataset.product, { trigger: t });
  });

  window.addEventListener("popstate", syncFromLocation);
  window.addEventListener("hashchange", syncFromLocation);
  syncFromLocation();
}

function syncFromLocation() {
  const id = location.hash.startsWith(PREFIX) ? decodeURIComponent(location.hash.slice(PREFIX.length)) : null;
  if (id && productById(id)) {
    if (current !== id) openProduct(id, { fromHistory: true });
  } else if (dlg.open) {
    fromHistoryClose = true;
    dlg.close();
  }
  if (!id && afterPop) { const fn = afterPop; afterPop = null; fn(); }
}

export function openProduct(id, { trigger = null, fromHistory = false } = {}) {
  const p = productById(id);
  if (!p) return;
  if (trigger) opener = trigger;
  else if (!dlg.open) opener = document.activeElement;
  current = id;
  box.innerHTML = render(p);
  wireGallery(p);
  if (!dlg.open) dlg.showModal();
  box.querySelector(".pd-info").scrollTop = 0;
  box.scrollTop = 0;
  dlg.querySelector(".pd-close").focus({ preventScroll: true });
  document.title = `${p.name} – Flora & Grete`;
  if (!fromHistory && location.hash !== PREFIX + id) {
    history.pushState({ fgProduct: id }, "", PREFIX + id);
    pushed = true;
  }
}

export function closeProduct(then) {
  if (!dlg.open) { then && then(); return; }
  if (then) afterPop = then;
  dlg.close();
}

function handleClosed() {
  current = null;
  document.title = "Flora & Grete – Handgemachte Einzelstücke aus Ramsen (Pfalz)";
  const viaHistory = fromHistoryClose;
  const hadAfter = !!afterPop;
  fromHistoryClose = false;
  if (!viaHistory && location.hash.startsWith(PREFIX)) {
    if (pushed) {
      pushed = false;
      history.back(); // afterPop läuft dann in syncFromLocation
    } else {
      history.replaceState(null, "", location.pathname + location.search);
      runAfter();
    }
  } else {
    pushed = false;
    runAfter();
  }
  if (!hadAfter && opener && document.contains(opener)) opener.focus({ preventScroll: true });
}
function runAfter() { if (afterPop) { const fn = afterPop; afterPop = null; fn(); } }

function render(p) {
  const cat = CATEGORIES.find((c) => c.id === p.category);
  const n = p.images.length;
  const slides = p.images.map((f, i) => `
    <figure class="pd-slide" aria-label="Foto ${i + 1} von ${n}">
      ${img(f, `${p.name} – ${p.subtitle}, Foto ${i + 1} von ${n}`, { eager: i === 0 })}
    </figure>`).join("");
  const thumbs = n > 1 ? `<div class="pd-thumbs" role="group" aria-label="Fotos auswählen">${p.images.map((f, i) => `
      <button class="pd-thumb" type="button" data-i="${i}" aria-label="Foto ${i + 1} zeigen"${i === 0 ? ' aria-current="true"' : ""}>${img(f, "")}</button>`).join("")}</div>` : "";
  const badges = badgesOf(p).map((b) => `<span class="badge badge--${b.cls}">${esc(b.label)}</span>`).join("");
  const colors = p.colors?.length ? `
      <div class="pd-block"><h3>Farben</h3><ul class="colors">${p.colors.map((c) => `<li><i style="--c:${colorOf(c)}" aria-hidden="true"></i>${esc(c)}</li>`).join("")}</ul></div>` : "";
  const details = p.details?.length ? `
      <div class="pd-block"><h3>Details</h3><ul class="details">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>` : "";
  const story = p.story ? `<div class="pd-story"><b>Cathrin erzählt</b><p>${esc(p.story)}</p></div>` : "";

  return `
  <button class="pd-close" type="button" aria-label="Schließen" data-close>×</button>
  <div class="pd-gallery" style="--pd-bg:${CAT_BG[p.category] || "var(--mint-soft)"}">
    ${n > 1 ? `<span class="pd-count" aria-hidden="true"><span data-count>1</span> / ${n}</span>` : ""}
    <div class="pd-track" tabindex="0" role="region" aria-roledescription="Bildergalerie" aria-label="Fotos: ${esc(p.name)} (mit Pfeiltasten blättern)">${slides}</div>
    ${n > 1 ? `<button class="pd-nav pd-prev" type="button" aria-label="Vorheriges Foto" disabled>←</button>
    <button class="pd-nav pd-next" type="button" aria-label="Nächstes Foto">→</button>` : ""}
    ${thumbs}
    <p class="visually-hidden" aria-live="polite" data-live></p>
  </div>
  <div class="pd-info">
    <p class="pd-kicker">${esc(cat ? cat.label : "")}</p>
    <h2 id="pd-title">${esc(p.name)}</h2>
    <p class="pd-sub">${esc(p.subtitle)}</p>
    <div class="pd-price-row"><span class="price-tag">${esc(fmtPrice(p.price, p.priceFrom))}</span>${badges}</div>
    <p class="pd-short">${esc(p.short)}</p>
    ${colors}
    <div class="pd-block"><h3>Material</h3><p>${esc(p.material || "")}</p></div>
    ${details}
    ${story}
    <p class="pd-pack"><span aria-hidden="true">🌱</span><span>${esc(SHOP.packaging)}</span></p>
    <div class="pd-actions">
      <a class="btn btn-wine btn-lg" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen <span aria-hidden="true">↗</span></a>
      <button class="btn btn-ghost btn-lg" type="button" data-fit="${esc(p.id)}">Anprobe anfragen</button>
    </div>
  </div>`;
}

function wireGallery(p) {
  const track = box.querySelector(".pd-track");
  const prev = box.querySelector(".pd-prev");
  const next = box.querySelector(".pd-next");
  const thumbs = [...box.querySelectorAll(".pd-thumb")];
  const count = box.querySelector("[data-count]");
  const live = box.querySelector("[data-live]");
  const n = p.images.length;
  let idx = 0;

  const go = (i) => {
    i = Math.max(0, Math.min(n - 1, i));
    track.scrollTo({ left: i * track.clientWidth, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const setIdx = (i) => {
    if (i === idx) return;
    idx = i;
    if (count) count.textContent = i + 1;
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === n - 1;
    thumbs.forEach((t, k) => (k === i ? t.setAttribute("aria-current", "true") : t.removeAttribute("aria-current")));
    const t = thumbs[i], strip = t?.parentElement;
    if (t && strip) strip.scrollTo({ left: t.offsetLeft - strip.clientWidth / 2 + t.clientWidth / 2, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    if (live) live.textContent = `Foto ${i + 1} von ${n}`;
  };
  let raf = 0;
  track.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setIdx(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  }, { passive: true });
  prev?.addEventListener("click", () => go(idx - 1));
  next?.addEventListener("click", () => go(idx + 1));
  thumbs.forEach((t) => t.addEventListener("click", () => go(Number(t.dataset.i))));
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
  });

  box.querySelector("[data-close]").addEventListener("click", () => closeProduct());
  box.querySelector("[data-fit]").addEventListener("click", (e) => {
    const id = e.currentTarget.dataset.fit;
    closeProduct(() => onFitting(id));
  });
}

export { PRODUCTS };
