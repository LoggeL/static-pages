// Gemeinsame Bausteine für mehrere Bereiche
import { TODAY, formatDate } from "../../../shared/store.js";
import { SHOP } from "../../../shared/data.js";
import { h, icon } from "../ui.js";

// Die Website (liegt eine Ebene über der Verwaltung)
export const SITES = [{ href: "../", label: "Deine Website" }];

export const STATUS_MODES = [
  { id: "open", label: "Geöffnet", icon: "doorOpen", text: "Das Atelier ist zu den Zeiten unten für dich da." },
  { id: "appointment", label: "Nur nach Termin", icon: "calendar", text: "Besuch und Anprobe nur nach Absprache." },
  { id: "closed", label: "Geschlossen", icon: "lock", text: "Gerade keine Besuche möglich. Der Etsy-Shop läuft weiter." },
  { id: "vacation", label: "Im Urlaub", icon: "sun", text: "Kurze Pause. Bestellungen werden danach genäht." },
];
export const statusLabel = (id) => (STATUS_MODES.find((m) => m.id === id) || STATUS_MODES[0]).label;

export const TONES = [
  { id: "info", label: "Info", desc: "ruhig, für Neuigkeiten" },
  { id: "warn", label: "Wichtig", desc: "auffällig, für Fristen" },
  { id: "closed", label: "Geschlossen", desc: "dunkel, für Pausen" },
  { id: "sale", label: "Angebot", desc: "rosé, für Rabatte" },
];

export const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(isoStr, n) {
  const [y, m, d] = isoStr.split("-").map(Number);
  return isoOf(new Date(y, m - 1, d + n));
}
export const dayMonth = (isoStr) => formatDate(isoStr, { day: "numeric", month: "long" });

/** Vorschau des Hinweis-Streifens. compact = nur Streifen, sonst mit angedeuteter Website */
export function bannerPreview(b, { compact = false, validLink = true } = {}) {
  const off = !b.active || !b.text;
  const strip = h("div", { class: `bn bn-${b.tone || "info"}` },
    h("p", { class: "bn-text" }, b.text || "Hier steht dein Hinweis …",
      b.linkLabel && b.linkUrl && validLink ? h("span", { class: "bn-link" }, b.linkLabel, " →") : null));
  if (compact) return h("div", { class: "bn-compact" + (off ? " is-off" : "") }, strip);
  return h("div", { class: "preview" + (off ? " is-off" : ""), "aria-label": "Vorschau des Hinweises", role: "img" },
    h("div", { class: "pv-bar", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("span", { class: "pv-url" }, "cathrin-raasch-atelier.de")),
    strip,
    h("div", { class: "pv-page", "aria-hidden": "true" },
      h("div", { class: "pv-nav" }, h("span", { class: "brand-mark pv-logo" }), h("span", { class: "pv-lines" }, h("i"), h("i"), h("i"))),
      h("div", { class: "pv-hero" }, h("img", { src: "../img/viola-kleid-3.webp", alt: "" }), h("img", { src: "../img/lene-1.webp", alt: "" }), h("img", { src: "../img/rosemary-2.webp", alt: "" }))),
    off ? h("p", { class: "pv-off" }, icon("eyeOff"), h("span", {}, !b.text ? "Noch kein Text" : "Ausgeschaltet – auf der Website nicht sichtbar")) : null);
}

/** Urlaub eintragen (Atelier-Status + optional Hinweis oben) */
export function applyVacation(d, untilISO, alsoBanner) {
  const until = dayMonth(untilISO);
  const back = dayMonth(addDays(untilISO, 1));
  d.status.mode = "vacation";
  d.status.note = `Im Urlaub bis ${until}. Bestellungen über Etsy nehme ich gern an – genäht wird ab ${back}.`;
  if (alsoBanner) {
    d.banner = { ...d.banner, active: true, tone: "closed", from: "", until: untilISO,
      text: `Kleine Urlaubspause bis ${until}. Du kannst trotzdem bestellen – ab ${back} nähe ich wieder für dich.`,
      linkLabel: "Zum Etsy-Shop", linkUrl: SHOP.etsy };
  }
}

/** Datum in Worten relativ zu heute */
export function relDay(isoStr) {
  const [y, m, d] = isoStr.split("-").map(Number);
  const [ty, tm, td] = TODAY.split("-").map(Number);
  const diff = Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
  if (diff === 0) return "heute";
  if (diff === 1) return "morgen";
  if (diff === -1) return "gestern";
  if (diff > 1 && diff < 7) return `in ${diff} Tagen`;
  if (diff < 0) return `vor ${-diff} Tagen`;
  return "";
}
