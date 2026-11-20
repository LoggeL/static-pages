// Kleine Helfer für Entwurf 2 „Atelier“ (Geschwister der Verwaltung).
import { DIMS } from "./dims.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Nur sichere Link-Ziele zulassen (Inhalte kommen aus der Verwaltung). */
export const safeUrl = (u) => {
  const s = String(u || "").trim();
  if (/^(https?:|mailto:|tel:)/i.test(s) || s.startsWith("#") || s.startsWith("../") || s.startsWith("./")) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return "https://" + s;
  return "#";
};
export const extAttrs = (u) => (/^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : "");

/** Bildausschnitte (object-position) für Karten mit festem Seitenverhältnis. */
export const FOCUS = {
  "lene-1.webp": "50% 62%",
  "millie-1.webp": "50% 55%",
  "viola-kleid-3.webp": "50% 30%",
  "rosemary-2.webp": "50% 40%",
  "rosemary-6.webp": "50% 22%",
  "stulpen-4.webp": "50% 45%",
  "kragen-frucht-6.webp": "50% 85%",
  "kragen-betsy-7.webp": "50% 85%",
  "kragen-karo-4.webp": "40% 85%",
  "tuch-uni-2.webp": "50% 40%",
  "stirnband-6.webp": "50% 35%",
  "muetze-1.webp": "50% 30%",
  "eloise-2.webp": "50% 35%",
  "viola-rock-1.webp": "50% 70%",
  "tuch-blumen-1.webp": "50% 40%",
  "member-1.webp": "62% 40%",
  "member-2.webp": "50% 45%",
  "lene-8.webp": "50% 45%",
};

/** <img> mit festen Maßen gegen Layout-Sprünge. */
export function img(file, alt, { cls = "", eager = false, sizes = "" } = {}) {
  const [w, h] = DIMS[file] || [1050, 1400];
  const pos = FOCUS[file];
  return `<img src="../img/${esc(file)}" alt="${esc(alt)}" width="${w}" height="${h}"${cls ? ` class="${cls}"` : ""}${
    eager ? ' fetchpriority="high"' : ' loading="lazy"'
  } decoding="async"${pos ? ` style="object-position:${pos}"` : ""}${sizes ? ` sizes="${sizes}"` : ""}>`;
}

/* ---------- Icons: dünne Linien im 24er-Raster, wie in der Verwaltung ---------- */
const P = {
  bag: '<path d="M5 8h14l-1 12.5H6L5 8Z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  scissors: '<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M8.3 8.2 20 18M8.3 15.8 20 6"/>',
  door: '<path d="M3 21h18"/><path d="M6 21V4h9"/><path d="M15 4l4 1.5V21"/><path d="M15 4v17"/><circle cx="12.5" cy="12.5" r=".9" fill="currentColor"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10C19.5 15.6 12 20 12 20Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  sparkle: '<path d="M12 3.5c.6 4.4 2.6 6.9 7 8.5-4.4 1.6-6.4 4.1-7 8.5-.6-4.4-2.6-6.9-7-8.5 4.4-1.6 6.4-4.1 7-8.5Z"/>',
  dog: '<path d="M6 9.5 4 4l4.5 2.5"/><path d="M18 9.5 20 4l-4.5 2.5"/><path d="M8.5 6.5h7A3.5 3.5 0 0 1 19 10v3a7 7 0 0 1-14 0v-3a3.5 3.5 0 0 1 3.5-3.5Z"/><circle cx="9.5" cy="11.5" r=".8" fill="currentColor"/><circle cx="14.5" cy="11.5" r=".8" fill="currentColor"/><path d="M11 15h2l-1 1.2-1-1.2Z" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  quote: '<path d="M9.5 7.5C6.5 8.4 5 10.6 5 13.5V17h4.5v-4.5H7c0-2 .9-3.3 2.9-4"/><path d="M18.5 7.5c-3 .9-4.5 3.1-4.5 6V17h4.5v-4.5H16c0-2 .9-3.3 2.9-4"/>',
  ruler: '<rect x="2.8" y="8" width="18.4" height="8" rx="1.5" transform="rotate(-30 12 12)"/><path d="m7.6 13.3-1-1.7M10.4 11.7l-1.4-2.4M13.2 10.1l-1-1.7M16 8.5l-1.4-2.4"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 15-14-0.5 10-6 15-14 15"/><path d="M5 19 13 11"/>',
  box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9Z"/><path d="m3.5 7.5 8.5 4 8.5-4M12 11.5v9"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor"/>',
  shop: '<path d="M4 9.5V20h16V9.5"/><path d="M3 9.5 4.8 4h14.4L21 9.5a2.6 2.6 0 0 1-4.5 1.6 2.6 2.6 0 0 1-4.5 0 2.6 2.6 0 0 1-4.5 0A2.6 2.6 0 0 1 3 9.5Z"/><path d="M10 20v-5h4v5"/>',
  chat: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H10l-4.5 3.5V17h-1a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 16.6v.3"/>',
  map: '<path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5l-6-2Z"/><path d="M9 4.5v13M15 6.5v13"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  thread: '<circle cx="12" cy="12" r="7.5"/><path d="M6.5 7.5c3 1 8 1 11 0M5 12c4 1.2 10 1.2 14 0M6.5 16.5c3-1 8-1 11 0"/>',
};

export function icon(name, cls = "") {
  return `<span class="ico${cls ? " " + cls : ""}" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">${P[name] || ""}</svg></span>`;
}

/** Badges eines Produkts (Maßanfertigung, Einzelstück, Neu, Gratis-Versand). */
export function badgeList(p) {
  const out = [];
  if (p.isNew) out.push(["neu", "Neu"]);
  if (p.madeToMeasure) out.push(["mass", "Maßanfertigung"]);
  if (p.unique) out.push(["unikat", "Einzelstück"]);
  if (p.freeShipping) out.push(["versand", "Gratis-Versand"]);
  return out;
}
export const badges = (p, max = 9) => {
  const list = badgeList(p).slice(0, max);
  return list.length ? `<ul class="tags" aria-label="Merkmale">${list.map(([c, l]) => `<li class="tag tag-${c}">${l}</li>`).join("")}</ul>` : "";
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

export const altFor = (p, i) => (i === 0 ? `${p.name} – ${p.subtitle}` : `${p.name}, Foto ${i + 1} von ${p.images.length}`);

export const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

/** Atelier-Status: Beschriftung + Farbe (wie in der Verwaltung). */
export const STATUS = {
  open: { label: "Atelier geöffnet", short: "Geöffnet", icon: "door" },
  appointment: { label: "Nur nach Termin", short: "Nach Termin", icon: "calendar" },
  closed: { label: "Atelier geschlossen", short: "Geschlossen", icon: "lock" },
  vacation: { label: "Gerade im Urlaub", short: "Im Urlaub", icon: "sun" },
};
export const statusOf = (mode) => STATUS[mode] || STATUS.open;
