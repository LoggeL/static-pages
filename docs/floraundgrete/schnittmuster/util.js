// Kleine Helfer für Entwurf 4 „Schnittmuster“.
import { DIMS } from "./dims.js";
import { PRODUCTS, CATEGORIES } from "../shared/data.js";

export const IMG = "../img/";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const dims = (file) => DIMS[file] || [1050, 1400];

/** <img> mit width/height (gegen Layout-Sprünge) und Lazy-Loading. */
export function img(file, alt, { cls = "", eager = false, pos = "" } = {}) {
  const [w, h] = dims(file);
  return `<img src="${IMG}${esc(file)}" alt="${esc(alt)}" width="${w}" height="${h}"${eager ? "" : ' loading="lazy"'} decoding="async"${cls ? ` class="${cls}"` : ""}${pos ? ` style="object-position:${pos}"` : ""}>`;
}

export const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Teil-Nummer wie auf einem Schnittbogen: Reihenfolge im Katalog, zweistellig. */
export const partNo = (p) => String(PRODUCTS.indexOf(p) + 1).padStart(2, "0");
export const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "";

/** Zuschnitt-Angabe für das Schnittteil-Etikett. */
export const cutLabel = (p) => (p.madeToMeasure ? "nach Maß" : p.unique ? "Einzelstück, 1 ×" : "Kleinserie");

/** Längenangabe aus den Details („Länge ca. 68 cm“). */
export function lengthOf(p) {
  for (const d of p.details || []) {
    const m = d.match(/(?:Rock)?[Ll]änge (ca\. )?(\d+) cm( ab Ausschnitt)?/);
    if (m) return `Länge ${m[1] || ""}${m[2]} cm${m[3] || ""}`;
  }
  return "";
}

export const ICON = {
  close: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
  scissors: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-scissors"/></svg>',
};

/** Badges eines Produkts (Maßanfertigung, Einzelstück, Neu, Gratis-Versand). */
export function badges(p, cls = "") {
  const out = [];
  if (p.isNew) out.push('<li class="badge badge--new">Neu</li>');
  if (p.madeToMeasure) out.push('<li class="badge badge--mass">Maßanfertigung</li>');
  if (p.unique) out.push('<li class="badge">Einzelstück</li>');
  if (p.freeShipping) out.push('<li class="badge">Gratis-Versand</li>');
  return out.length ? `<ul class="badges ${cls}">${out.join("")}</ul>` : "";
}

/** Kurze Bildbeschreibung für Galerie-Fotos. */
export const altFor = (p, i) =>
  i === 0 ? `${p.name}, ${p.subtitle}` : `${p.name}, Foto ${i + 1} von ${p.images.length}`;

/**
 * Rechnet einen Punkt im Foto (u, v in 0…1) in Prozent des Rahmens um,
 * wenn das Foto mit object-fit: cover und object-position (px, py in 0…1) im Rahmen mit
 * Seitenverhältnis `frame` (Breite/Höhe) sitzt. So bleiben Maßlinien auf jeder Breite am Stoff.
 */
export function mapPoint(file, frame, [px, py], [u, v]) {
  const [w, h] = dims(file);
  const a = w / h;
  if (a > frame) {
    const sw = a / frame; // Bildbreite in Rahmenbreiten
    return [((1 - sw) * px + u * sw) * 100, v * 100];
  }
  const sh = frame / a;
  return [u * 100, ((1 - sh) * py + v * sh) * 100];
}
