// Kleine Helfer für Entwurf 1 „Leinen & Licht“.
import { DIMS } from "./dims.js";

export const IMG = "../img/";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** <img> mit width/height (gegen Layout-Sprünge) und Lazy-Loading. */
export function img(file, alt, { cls = "", eager = false, pos = "", sizes = "" } = {}) {
  const [w, h] = DIMS[file] || [1050, 1400];
  return `<img src="${IMG}${esc(file)}" alt="${esc(alt)}" width="${w}" height="${h}"${eager ? "" : ' loading="lazy"'} decoding="async"${cls ? ` class="${cls}"` : ""}${pos ? ` style="object-position:${pos}"` : ""}${sizes ? ` sizes="${sizes}"` : ""}>`;
}

export const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const ICON = {
  close: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10.5 2.5L5 8l5.5 5.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.5 2.5L11 8l-5.5 5.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  check: '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path d="M10 21l7 7 14-15" stroke="#3A2E26" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Badges eines Produkts (Maßanfertigung, Einzelstück, Neu, Gratis-Versand). */
export function badges(p) {
  const out = [];
  if (p.isNew) out.push('<li class="badge badge--neu">Neu</li>');
  if (p.madeToMeasure) out.push('<li class="badge badge--mass">Maßanfertigung</li>');
  if (p.unique) out.push('<li class="badge badge--einzel">Einzelstück</li>');
  if (p.freeShipping) out.push('<li class="badge">Gratis-Versand</li>');
  return out.length ? `<ul class="badges">${out.join("")}</ul>` : "";
}

/** Kurze Bildbeschreibung für Galerie-Fotos. */
export const altFor = (p, i) =>
  i === 0 ? `${p.name}, ${p.subtitle}` : `${p.name}, Foto ${i + 1} von ${p.images.length}`;
