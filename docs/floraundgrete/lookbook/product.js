// Produktdetail als Vollbild-Overlay: Karussell, Daumen-Leiste, Deep-Link #produkt-<id>
import { PRODUCTS, fmtPrice, productById } from "../shared/data.js";
import { $, $$, esc, img, pad2, productNo, catLabel, badgesHtml, trapFocus, reduceMotion } from "./util.js";

const pd = $("#pd");
const track = $("#pd-track");
const thumbs = $("#pd-thumbs");
const info = $("#pd-info");
const count = $("#pd-count");
const prevImg = $("#pd-img-prev");
const nextImg = $("#pd-img-next");

let current = null;      // aktuelles Produkt
let index = 0;           // aktuelles Bild
let lastFocus = null;
let pushed = false;      // wurde ein History-Eintrag von uns angelegt?
let onFitting = () => {};
let hideTimer = 0;

export function initProduct({ requestFitting }) {
  onFitting = requestFitting;

  // Alle Links auf #produkt-<id> abfangen
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#produkt-"], [data-product]');
    if (!a || pd.contains(a) && !a.matches("[data-product]")) return;
    const id = a.dataset.product || a.getAttribute("href").slice(9);
    if (!productById(id)) return;
    e.preventDefault();
    open(id);
    const start = Number(a.dataset.img || 0);
    if (start > 0) requestAnimationFrame(() => { index = start; track.scrollLeft = start * track.clientWidth; syncUi(); });
  });

  $("#pd-close").addEventListener("click", () => close());
  $("#pd-prev-product").addEventListener("click", () => step(-1));
  $("#pd-next-product").addEventListener("click", () => step(1));
  prevImg.addEventListener("click", () => goTo(index - 1));
  nextImg.addEventListener("click", () => goTo(index + 1));

  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) goTo(+b.dataset.i);
  });

  let raf = 0;
  track.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== index) { index = i; syncUi(); }
    });
  }, { passive: true });

  pd.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowRight" && !e.target.matches("input, textarea, select")) { e.preventDefault(); goTo(index + 1); }
    if (e.key === "ArrowLeft" && !e.target.matches("input, textarea, select")) { e.preventDefault(); goTo(index - 1); }
    trapFocus(pd, e);
  });

  info.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fit]");
    if (!b) return;
    const id = b.dataset.fit;
    close({ to: "#anprobe" });
    onFitting(id);
  });

  window.addEventListener("popstate", fromHash);
  window.addEventListener("hashchange", fromHash);
  fromHash();
}

function fromHash() {
  const m = location.hash.match(/^#produkt-([\w-]+)$/);
  if (m && productById(m[1])) {
    if (!current || current.id !== m[1] || pd.hidden) open(m[1], { push: false });
  } else if (!pd.hidden) {
    hide();
  }
}

export function open(id, { push = true } = {}) {
  const p = productById(id);
  if (!p) return;
  clearTimeout(hideTimer);
  const wasOpen = !pd.hidden && !pd.classList.contains("is-closing");
  pd.classList.remove("is-closing");
  if (!wasOpen) lastFocus = document.activeElement;
  current = p;
  index = 0;
  render(p);
  if (push && location.hash !== `#produkt-${id}`) {
    if (wasOpen && pushed) history.replaceState(null, "", `#produkt-${id}`);
    else { history.pushState(null, "", `#produkt-${id}`); pushed = true; }
  }
  if (!wasOpen) {
    pd.hidden = false;
    pd.classList.remove("is-closing");
    document.documentElement.classList.add("pd-open");
    document.documentElement.style.overflow = "hidden";
  }
  track.scrollLeft = 0;
  syncUi();
  requestAnimationFrame(() => $("#pd-close").focus({ preventScroll: true }));
  document.title = `${p.name} – Cathrin Raasch Atelier`;
}

function hide({ immediate = false, restoreFocus = true } = {}) {
  if (pd.hidden || pd.classList.contains("is-closing")) return;
  const done = () => {
    pd.hidden = true;
    pd.classList.remove("is-closing");
    document.documentElement.classList.remove("pd-open");
    document.documentElement.style.overflow = "";
  };
  if (immediate || reduceMotion()) done();
  else { pd.classList.add("is-closing"); hideTimer = setTimeout(done, 220); }
  document.title = "Cathrin Raasch Atelier – Handgemachte Einzelstücke aus Ramsen (Pfalz)";
  if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  current = null;
}

export function close({ to } = {}) {
  if (pd.hidden) return;
  if (to) {
    // direkt zu einem anderen Abschnitt (z. B. Anprobe): History-Eintrag ersetzen statt zurückspringen
    history.replaceState(null, "", to);
    pushed = false;
    hide({ immediate: true, restoreFocus: false });
    return;
  }
  if (pushed) { pushed = false; hide(); history.back(); }
  else { hide(); history.replaceState(null, "", location.pathname + location.search); }
}

function step(dir) {
  if (!current) return;
  const i = PRODUCTS.findIndex((p) => p.id === current.id);
  const next = PRODUCTS[(i + dir + PRODUCTS.length) % PRODUCTS.length];
  open(next.id);
}

function goTo(i) {
  if (!current) return;
  const n = current.images.length;
  index = Math.max(0, Math.min(n - 1, i));
  track.scrollTo({ left: index * track.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" });
  syncUi();
}

function syncUi() {
  if (!current) return;
  const n = current.images.length;
  count.textContent = `${pad2(index + 1)} / ${pad2(n)}`;
  prevImg.disabled = index === 0;
  nextImg.disabled = index === n - 1;
  $$("button", thumbs).forEach((b, i) => {
    const on = i === index;
    b.setAttribute("aria-current", on ? "true" : "false");
    if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function render(p) {
  const n = p.images.length;
  const no = productNo(p.id);
  $("#pd-crumb").innerHTML = `<span class="c-path">Kollektion · ${esc(catLabel(p.category))} · </span><b>${no} ${esc(p.name)}</b>`;

  // Hero-Bild zuerst, danach die übrigen in Etsy-Reihenfolge
  const files = [p.hero, ...p.images.filter((f) => f !== p.hero)];
  p = { ...p, images: files };
  current = p;

  track.innerHTML = files.map((f, i) => `
    <li><img src="${img(f)}" alt="${esc(p.name)}, Ansicht ${i + 1} von ${n}" ${i < 2 ? 'loading="eager"' : 'loading="lazy"'} decoding="async" width="1050" height="1400"></li>`).join("");
  thumbs.innerHTML = files.map((f, i) => `
    <button type="button" data-i="${i}" aria-label="Bild ${i + 1} von ${n} zeigen" aria-current="${i === 0}"><img src="${img(f)}" alt="" loading="lazy" decoding="async" width="80" height="100"></button>`).join("");

  const colors = p.colors?.length
    ? `<div class="pd-sec"><h3>Farben</h3><ul class="swatches">${p.colors.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : "";
  const details = p.details?.length
    ? `<div class="pd-sec"><h3>Details</h3><ul class="pd-details">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>` : "";
  const story = p.story
    ? `<blockquote class="pd-story"><p>„${esc(p.story)}“</p><footer>Cathrin über ${esc(p.name.split(" ").pop())}</footer></blockquote>` : "";
  const ship = p.freeShipping ? "<small>inkl. kostenlosem Versand</small>" : "<small>zzgl. Versand</small>";

  info.innerHTML = `
    <p class="pd-no">${no}<small>/ ${pad2(PRODUCTS.length)}</small></p>
    <div>
      <h2 id="pd-title">${esc(p.name)}</h2>
    </div>
    <p class="pd-sub">${esc(p.subtitle)}</p>
    ${badgesHtml(p)}
    <p class="pd-price">${fmtPrice(p.price, p.priceFrom)} ${ship}</p>
    <p class="pd-short">${esc(p.short)}</p>
    <div class="pd-ctas">
      <a class="btn btn--solid" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen <span aria-hidden="true">↗</span></a>
      <button class="btn btn--line" type="button" data-fit="${esc(p.id)}">Anprobe anfragen</button>
    </div>
    ${colors}
    <div class="pd-sec"><h3>Material</h3><p>${esc(p.material || "–")}</p></div>
    ${details}
    ${story}
    <p class="pd-note">${p.madeToMeasure ? "Ich nähe dieses Stück auf deine Maße. Taille und Wunschlänge gibst du bei der Bestellung an, oder wir messen bei einer Anprobe zusammen." : p.unique ? "Echtes Einzelstück: Den Stoff gibt es nur einmal. Ist es weg, ist es weg." : "Handgemacht in meinem Atelier in Ramsen und plastikfrei im Graskarton verschickt."}</p>
  `;
  info.scrollTop = 0;
  pd.querySelector(".pd-body").scrollTop = 0;
}
