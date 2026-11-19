// Kleine Helfer für Entwurf „Millefleur“.
import { dims } from "./dims.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Nur sichere Link-Ziele zulassen (Inhalte kommen aus der Verwaltung). */
export const safeUrl = (u) => {
  const s = String(u || "").trim();
  if (/^(https?:|mailto:|tel:)/i.test(s) || s.startsWith("#") || s.startsWith("../") || s.startsWith("./")) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return "https://" + s;
  return "#";
};
export const isExternal = (u) => /^https?:/i.test(u);
export const extAttrs = (u) => (isExternal(u) ? ' target="_blank" rel="noopener"' : "");

/** <img> mit festen Maßen gegen Layout-Sprünge. */
export function img(file, alt, { cls = "", eager = false, pos = "", sizes = "" } = {}) {
  const [w, h] = dims(file);
  return `<img src="../img/${esc(file)}" alt="${esc(alt)}" width="${w}" height="${h}"${cls ? ` class="${cls}"` : ""}${
    eager ? ' fetchpriority="high"' : ' loading="lazy"'
  } decoding="async"${pos ? ` style="object-position:${pos}"` : ""}${sizes ? ` sizes="${sizes}"` : ""}>`;
}

/** Bildausschnitte für Karten (object-position). */
export const FOCUS = {
  "lene-1.webp": "50% 60%",
  "millie-1.webp": "50% 45%",
  "viola-kleid-3.webp": "50% 35%",
  "rosemary-2.webp": "50% 40%",
  "rosemary-6.webp": "50% 20%",
  "stulpen-4.webp": "50% 55%",
  "kragen-frucht-6.webp": "50% 40%",
  "kragen-betsy-7.webp": "50% 40%",
  "kragen-karo-4.webp": "50% 45%",
  "tuch-uni-2.webp": "50% 35%",
  "stirnband-6.webp": "50% 30%",
  "muetze-1.webp": "50% 35%",
  "eloise-2.webp": "50% 40%",
  "viola-rock-1.webp": "50% 55%",
  "tuch-blumen-1.webp": "50% 40%",
};

/** Stofffarben grob als Farbtupfer. */
const COLOR_MAP = [
  [/mint mit blumen/i, "conic-gradient(#a8dccb 0 25%, #b9a3d6 0 45%, #a8dccb 0 70%, #f2cfc4 0)"],
  [/weiß mit rosen/i, "radial-gradient(circle at 40% 40%, #e8a3b0 30%, #fff 32%)"],
  [/natur|weiß/i, "#efe8d8"],
  [/weinrot/i, "#8e1f3a"],
  [/flaschengrün|dunkelgrün/i, "#1f4d3a"],
  [/petrol/i, "#1f5f66"],
  [/grün/i, "#4f7a5a"],
  [/flieder|lila|heide/i, "#b9a3d6"],
  [/navy|dunkelblau/i, "#1f2a44"],
  [/blau/i, "#4a6a9a"],
  [/senf|gelb/i, "#d9a520"],
  [/grau/i, "#8c8a88"],
  [/schwarz/i, "#222"],
  [/rosa/i, "#ecb2bb"],
  [/mint/i, "#a8dccb"],
];
export const colorOf = (name) => (COLOR_MAP.find(([re]) => re.test(name)) || [0, "#ccc"])[1];

export function badgesOf(p) {
  const out = [];
  if (p.isNew) out.push({ cls: "new", label: "Neu", sticker: "wine", stickerLabel: "Neu!" });
  if (p.madeToMeasure) out.push({ cls: "mass", label: "Maßanfertigung", sticker: "mint", stickerLabel: "auf Maß genäht" });
  if (p.unique) out.push({ cls: "unique", label: "Einzelstück", sticker: "lilac", stickerLabel: "Einzelstück" });
  if (p.freeShipping) out.push({ cls: "ship", label: "Gratis-Versand", sticker: "mustard", stickerLabel: "Gratis-Versand" });
  return out;
}
export const hasPockets = (p) => /tasche/i.test([p.short, ...(p.details || [])].join(" "));

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const addMinutes = (hhmm, min) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export const hash = (s) => {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h >>> 0);
};

export const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* privat */ } },
};
