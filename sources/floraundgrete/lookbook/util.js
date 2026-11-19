// Kleine Helfer für Entwurf 3 · Lookbook
import { PRODUCTS, CATEGORIES } from "../shared/data.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export const pad2 = (n) => String(n).padStart(2, "0");
export const img = (file) => `../img/${file}`;
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const productNo = (id) => pad2(PRODUCTS.findIndex((p) => p.id === id) + 1);
export const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "";

/** Zweites Bild für Hover-Wechsel / Detail: erstes Bild, das nicht das Hero-Bild ist */
export const altImage = (p) => p.images.find((f) => f !== p.hero) || p.hero;

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
    ? `<ul class="badges ${cls}" aria-label="Merkmale">${b.map(([k, l]) => `<li class="badge badge--${k}">${l}</li>`).join("")}</ul>`
    : "";
};

/** Fokusfalle für Dialoge */
export function trapFocus(container, e) {
  if (e.key !== "Tab") return;
  const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', container)
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
