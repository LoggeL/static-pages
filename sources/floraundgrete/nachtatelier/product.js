// Produktdetail als dunkles Vollbild-Overlay: Galerie (wischen, Pfeile, Daumen), Deep-Link #produkt-<id>
import { PRODUCTS, fmtPrice, productById } from "../shared/data.js";
import { $, $$, esc, pad2, imgTag, productNo, catLabel, badgesHtml, trapFocus, reduceMotion } from "./util.js";

const pd = $("#pd");
const body = $("#pd-body");
const track = $("#pd-track");
const thumbs = $("#pd-thumbs");
const info = $("#pd-info");
const count = $("#pd-count");
const prevImg = $("#pd-img-prev");
const nextImg = $("#pd-img-next");
const BASE_TITLE = document.title;

let current = null;
let files = [];
let index = 0;
let lastFocus = null;
let pushed = false;
let onFitting = () => {};
let hideTimer = 0;

export function initProduct(opts) {
  onFitting = opts.onFitting;

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#produkt-"], [data-product]');
    if (!a || (pd.contains(a) && !a.matches("[data-product]"))) return;
    const id = a.dataset.product || a.getAttribute("href").slice(9);
    if (!productById(id)) return;
    e.preventDefault();
    open(id);
  });

  $("#pd-close").addEventListener("click", () => close());
  $("#pd-prev").addEventListener("click", () => step(-1));
  $("#pd-next").addEventListener("click", () => step(1));
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
    const typing = e.target.matches("input, textarea, select");
    if (!typing && e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
    if (!typing && e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
    trapFocus(pd, e);
  });

  info.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fit]");
    if (!b) return;
    close({ to: "#anprobe" });
    onFitting(b.dataset.fit);
  });

  addEventListener("popstate", fromHash);
  addEventListener("hashchange", fromHash);
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
    document.documentElement.classList.add("pd-open");
  }
  track.scrollLeft = 0;
  syncUi();
  requestAnimationFrame(() => $("#pd-close").focus({ preventScroll: true }));
  document.title = `${p.name} – Flora & Grete`;
}

function hide({ immediate = false, restoreFocus = true } = {}) {
  if (pd.hidden || pd.classList.contains("is-closing")) return;
  const done = () => {
    pd.hidden = true;
    pd.classList.remove("is-closing");
    document.documentElement.classList.remove("pd-open");
  };
  if (immediate || reduceMotion()) done();
  else { pd.classList.add("is-closing"); hideTimer = setTimeout(done, 260); }
  document.title = BASE_TITLE;
  if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  current = null;
}

export function close({ to } = {}) {
  if (pd.hidden) return;
  if (to) {
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
  open(PRODUCTS[(i + dir + PRODUCTS.length) % PRODUCTS.length].id);
}

function goTo(i) {
  if (!current) return;
  index = Math.max(0, Math.min(files.length - 1, i));
  track.scrollTo({ left: index * track.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" });
  syncUi();
}

function syncUi() {
  if (!current) return;
  const n = files.length;
  count.textContent = `${pad2(index + 1)} / ${pad2(n)}`;
  prevImg.disabled = index === 0;
  nextImg.disabled = index === n - 1;
  $$("button", thumbs).forEach((b, i) => {
    const on = i === index;
    b.setAttribute("aria-current", on ? "true" : "false");
    if (on) {
      const l = b.offsetLeft, r = l + b.offsetWidth;
      if (l < thumbs.scrollLeft || r > thumbs.scrollLeft + thumbs.clientWidth) thumbs.scrollTo({ left: l - 12, behavior: "auto" });
    }
  });
}

function render(p) {
  // Titelbild zuerst, danach die übrigen in Etsy-Reihenfolge
  files = [p.hero, ...p.images.filter((f) => f !== p.hero)];
  const n = files.length;
  $("#pd-crumb").innerHTML = `<span class="pd__no">${productNo(p.id)}</span> ${esc(catLabel(p.category))}`;

  track.innerHTML = files.map((f, i) => `<li>${imgTag(f, `${p.name}, Bild ${i + 1} von ${n}`, { eager: i < 2 })}</li>`).join("");
  thumbs.innerHTML = files.map((f, i) => `
    <button type="button" data-i="${i}" aria-label="Bild ${i + 1} von ${n} zeigen" aria-current="${i === 0}">${imgTag(f, "")}</button>`).join("");

  const colors = p.colors?.length
    ? `<div class="pd__sec"><h3>Farben</h3><ul class="chips">${p.colors.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : "";
  const details = p.details?.length
    ? `<div class="pd__sec"><h3>Details</h3><ul class="pd__details">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>` : "";
  const story = p.story
    ? `<blockquote class="pd__story"><p>${esc(p.story)}</p><footer>Cathrin über ${esc(p.name.split(" ").pop())}</footer></blockquote>` : "";
  const note = p.madeToMeasure
    ? "Ich nähe dieses Stück auf deine Maße. Taille und Wunschlänge gibst du bei der Bestellung an, oder wir messen bei einer Anprobe zusammen."
    : p.unique ? "Echtes Einzelstück: Den Stoff gibt es nur einmal. Ist es weg, ist es weg."
    : "Handgemacht in meinem Atelier in Ramsen und plastikfrei im Graskarton verschickt.";

  info.innerHTML = `
    <h2 class="pd__title" id="pd-title">${esc(p.name)}</h2>
    <p class="pd__sub">${esc(p.subtitle)}</p>
    ${badgesHtml(p, "pd__tags")}
    <p class="pd__price">${fmtPrice(p.price, p.priceFrom)} <small>${p.freeShipping ? "inkl. Versand" : "zzgl. Versand"}</small></p>
    <p class="pd__short">${esc(p.short)}</p>
    <div class="pd__ctas">
      <a class="btn btn--brass" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen <span class="ext" aria-hidden="true"></span></a>
      <button class="btn btn--ghost" type="button" data-fit="${esc(p.id)}">Anprobe anfragen</button>
    </div>
    <p class="pd__note">${note}</p>
    ${colors}
    <div class="pd__sec"><h3>Material</h3><p>${esc(p.material || "–")}</p></div>
    ${details}
    ${story}`;
  body.scrollTop = 0;
  info.scrollTop = 0;
}
