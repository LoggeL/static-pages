// Kleine Helfer für die Website
import { PRODUCTS, CATEGORIES } from "./shared/data.js";
import { dims } from "./dims.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export const pad2 = (n) => String(n).padStart(2, "0");
export const src = (file) => `img/${file}`;
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const smooth = () => (reduceMotion() ? "auto" : "smooth");

export const productNo = (id) => pad2(PRODUCTS.findIndex((p) => p.id === id) + 1);
export const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "";

/** <img> mit echten Maßen (gegen Layout-Sprünge) */
export function imgTag(file, alt, { cls = "", eager = false, style = "", sizes = "" } = {}) {
  const [w, h] = dims(file);
  return `<img src="${src(file)}" width="${w}" height="${h}" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ""}${style ? ` style="${style}"` : ""}${sizes ? ` sizes="${sizes}"` : ""} loading="${eager ? "eager" : "lazy"}" decoding="async">`;
}

/** Bildausschnitte, die auf den Fotos gut sitzen (object-position) */
const FOCUS = {
  "lene-1.webp": "50% 40%",
  "millie-1.webp": "50% 55%",
  "viola-kleid-3.webp": "60% 45%",
  "rosemary-2.webp": "50% 35%",
  "stulpen-4.webp": "50% 55%",
  "kragen-frucht-6.webp": "40% 70%",
  "kragen-betsy-7.webp": "40% 70%",
  "kragen-karo-4.webp": "40% 70%",
  "tuch-uni-2.webp": "50% 35%",
  "stirnband-6.webp": "60% 35%",
  "muetze-1.webp": "50% 30%",
  "eloise-2.webp": "50% 30%",
};
export const focus = (file) => FOCUS[file] || "50% 50%";

export function badges(p) {
  const b = [];
  if (p.isNew) b.push(["neu", "Neu"]);
  if (p.madeToMeasure) b.push(["mass", "Maßanfertigung"]);
  if (p.unique) b.push(["unikat", "Einzelstück"]);
  if (p.freeShipping) b.push(["versand", "Gratis-Versand"]);
  return b;
}
export const badgesHtml = (p, cls = "") => {
  const b = badges(p);
  return b.length
    ? `<ul class="tags ${cls}" aria-label="Merkmale">${b.map(([k, l]) => `<li class="tag tag--${k}">${l}</li>`).join("")}</ul>`
    : "";
};

/** Fokusfalle für Dialoge */
export function trapFocus(container, e) {
  if (e.key !== "Tab") return;
  const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', container)
    .filter((el) => el.getClientRects().length > 0);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export const addMinutes = (hhmm, min) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
};
