// Galerie: Projekte aus dem Atelier mit Großansicht (Dialog, Tastatur, Wischen)
import { lookbookItems, imageSrc } from "./shared/store.js";
import { DIMS } from "./dims.js";
import { $, $$, esc, pad2, trapFocus, reduceMotion } from "./util.js";

const section = $("#galerie");
const grid = $("#lb-grid");
const box = $("#lbx");
const img = $("#lbx-img");
const title = $("#lbx-title");
const meta = $("#lbx-meta");
const count = $("#lbx-count");
const live = $("#lbx-live");
const BASE_TITLE = document.title;

let items = [];
let index = 0;
let lastFocus = null;
let hideTimer = 0;

// Breite/Höhe nur für Dateien aus img/ bekannt; hochgeladene Fotos (data:-URL) bringen ihre Maße selbst mit
const sizeAttrs = (image) => {
  const d = DIMS[image];
  return d ? ` width="${d[0]}" height="${d[1]}"` : "";
};
const label = (it) => (it.year ? `${it.title || "Projekt"} (${it.year})` : it.title || "Projekt");

/** Galerie zeichnen; Sektion und Menüpunkte verschwinden, wenn nichts zu zeigen ist */
export function renderLookbook() {
  const openId = items[index] && items[index].id;
  items = lookbookItems();
  const empty = !items.length;
  section.hidden = empty;
  $$('a[href="#galerie"]').forEach((a) => { const li = a.closest("li"); if (li) li.hidden = empty; else a.hidden = empty; });
  grid.innerHTML = items.map((it, i) => `
    <li class="lb__item">
      <button type="button" class="lb__btn" data-i="${i}" aria-haspopup="dialog">
        <span class="lb__img glow"><img src="${esc(imageSrc(it.image, ""))}"${sizeAttrs(it.image)} alt="" loading="lazy" decoding="async"></span>
        <span class="lb__cap"><span class="lb__title">${esc(it.title || "Projekt")}</span>${it.year ? `<span class="lb__year">${esc(it.year)}</span>` : ""}</span>
      </button>
    </li>`).join("");

  // offene Großansicht an neue Daten anpassen
  if (!box.hidden && !box.classList.contains("is-closing")) {
    if (empty) close();
    else {
      const k = items.findIndex((x) => x.id === openId);
      index = k >= 0 ? k : Math.min(index, items.length - 1);
      show();
    }
  }
  return !empty;
}

function show() {
  const it = items[index];
  if (!it) return;
  const d = DIMS[it.image];
  if (d) { img.width = d[0]; img.height = d[1]; } else { img.removeAttribute("width"); img.removeAttribute("height"); }
  img.src = imageSrc(it.image, "");
  img.alt = it.title || "Projekt aus der Galerie";
  title.textContent = it.title || "Projekt";
  meta.innerHTML = [it.year ? `<span class="lbx__year">${esc(it.year)}</span>` : "", it.note ? `<span>${esc(it.note)}</span>` : ""].filter(Boolean).join(" ");
  meta.hidden = !it.year && !it.note;
  count.textContent = `${pad2(index + 1)} / ${pad2(items.length)}`;
  live.textContent = `Bild ${index + 1} von ${items.length}: ${label(it)}`;
  if (!box.hidden && !box.classList.contains("is-closing")) document.title = `${it.title || "Galerie"} – Cathrin Raasch Atelier`;
  const single = items.length < 2;
  $("#lbx-prev").hidden = single;
  $("#lbx-next").hidden = single;
  // Nachbarbilder vorladen
  [index - 1, index + 1].forEach((k) => {
    const n = items[(k + items.length) % items.length];
    if (n && !/^data:/.test(n.image)) { const p = new Image(); p.src = imageSrc(n.image, ""); }
  });
}

function open(i) {
  if (!items[i]) return;
  clearTimeout(hideTimer);
  box.classList.remove("is-closing");
  if (box.hidden) lastFocus = document.activeElement;
  index = i;
  box.hidden = false;
  show();
  document.documentElement.classList.add("lbx-open");
  requestAnimationFrame(() => $("#lbx-close").focus({ preventScroll: true }));
}

function close() {
  if (box.hidden || box.classList.contains("is-closing")) return;
  const done = () => {
    box.hidden = true;
    box.classList.remove("is-closing");
    document.documentElement.classList.remove("lbx-open");
  };
  if (reduceMotion()) done();
  else { box.classList.add("is-closing"); hideTimer = setTimeout(done, 240); }
  document.title = BASE_TITLE;
  // Fokus zurück auf das angeklickte Bild (auch wenn die Galerie inzwischen neu gezeichnet wurde)
  const back = lastFocus && document.contains(lastFocus) ? lastFocus : $(`.lb__btn[data-i="${index}"]`) || $(".lb__btn");
  if (back && !section.hidden) back.focus({ preventScroll: true });
  else {
    // Galerie wurde während der Großansicht geleert: Fokus auf die nächste Sektion
    const next = $("#termine");
    next.setAttribute("tabindex", "-1");
    next.focus({ preventScroll: true });
  }
}

function go(dir) {
  if (items.length < 2) return;
  index = (index + dir + items.length) % items.length;
  show();
}

export function initLookbook() {
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".lb__btn");
    if (b) open(+b.dataset.i);
  });
  $("#lbx-close").addEventListener("click", close);
  $("#lbx-prev").addEventListener("click", () => go(-1));
  $("#lbx-next").addEventListener("click", () => go(1));
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    trapFocus(box, e);
  });
  // Klick neben das Bild schließt (nicht direkt nach einer Wischgeste)
  let swiped = false;
  box.addEventListener("click", (e) => {
    if (swiped) { swiped = false; return; }
    if (e.target === box || e.target.classList.contains("lbx__stage")) close();
  });

  // Wischen auf Touch-Geräten
  let x0 = null, y0 = 0;
  const fig = $("#lbx-fig");
  fig.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { x0 = e.clientX; y0 = e.clientY; } });
  fig.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiped = true;
      setTimeout(() => { swiped = false; }, 400);
      go(dx < 0 ? 1 : -1);
    }
  });
  fig.addEventListener("pointercancel", () => { x0 = null; });
}
