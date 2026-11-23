// Shop-Kern: läuft im Browser (Website, Verwaltung) und im Cloudflare Worker.
// Eine Quelle für Preise, Versand und Prüfregeln: Der Worker rechnet mit genau diesem Code,
// Preise aus dem Browser werden nie übernommen. Alle Beträge in Cent (Ganzzahl).
import { PRODUCTS } from "./data.js";

export const MAX_QTY = 10; // pro Artikel und Bestellung
export const MAX_LINES = 20;
export const NOTE_MAX = 200;
export const RESERVE_MINUTES = 30; // so lange hält der Warenkorb Stücke an der Kasse fest

export const ORDER_STATUS = [
  { id: "offen", label: "Wartet auf Zahlung", tone: "muted" },
  { id: "in_zahlung", label: "Zahlung läuft", tone: "muted" },
  { id: "bezahlt", label: "Bezahlt, bitte verschicken", tone: "warn" },
  { id: "abholbereit", label: "Bezahlt, wird abgeholt", tone: "warn" },
  { id: "verschickt", label: "Verschickt", tone: "ok" },
  { id: "abgeholt", label: "Abgeholt", tone: "ok" },
  { id: "erstattet", label: "Erstattet", tone: "muted" },
  { id: "abgebrochen", label: "Abgebrochen", tone: "muted" },
];
export const statusLabel = (id) => (ORDER_STATUS.find((s) => s.id === id) || { label: id }).label;
/** Bestellungen, um die sich Cathrin kümmern muss */
export const isTodo = (o) => o && (o.status === "bezahlt" || o.status === "abholbereit" || !!o.dispute);
export const isPaid = (o) => ["bezahlt", "abholbereit", "verschickt", "abgeholt"].includes(o.status);

export const euro = (cents) => (Number(cents || 0) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/** "65", "65,00", "49,9", "1.250,50 €" -> Cent; ungültig -> NaN */
export function parseEuro(raw) {
  const s = String(raw ?? "").replace(/[€\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s.replace(",", ".")) * 100);
}
export const centsToInput = (c) => (Number(c) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function defaultShopSettings() {
  return {
    enabled: true,
    shipping: { enabled: true, flat: 590, freeFrom: 0, label: "Versand mit DHL, versichert und mit Sendungsnummer", days: "3–5 Werktage" },
    pickup: { enabled: true, note: "Abholung im Atelier in Ramsen nach Absprache" },
    smallBusiness: true, // Kleinunternehmerin nach § 19 UStG: keine Umsatzsteuer ausweisen
    legalNote: "Auf Maß genähte Stücke sind vom Widerruf ausgeschlossen. Fertige Stücke kannst du innerhalb von 14 Tagen zurückschicken.",
  };
}

export function normalizeShopSettings(s = {}) {
  const d = defaultShopSettings();
  const int = (v, fb) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : fb);
  return {
    ...d, ...s,
    enabled: s.enabled !== false,
    shipping: { ...d.shipping, ...(s.shipping || {}), flat: int(s.shipping?.flat, d.shipping.flat), freeFrom: int(s.shipping?.freeFrom, 0), enabled: s.shipping?.enabled !== false },
    pickup: { ...d.pickup, ...(s.pickup || {}), enabled: s.pickup?.enabled !== false },
    smallBusiness: s.smallBusiness !== false,
  };
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const strList = (v, max, n) => (Array.isArray(v) ? v : String(v || "").split(/\n|,/)).map((x) => str(x, max)).filter(Boolean).slice(0, n);

/** Artikel in eine saubere Form bringen (Verwaltung, Worker, Startdaten) */
export function normalizeProduct(p = {}) {
  const stock = p.stock === null || p.stock === undefined || p.stock === "" ? null : Math.max(0, Math.min(999, Math.round(Number(p.stock) || 0)));
  return {
    id: str(p.id, 40).replace(/[^\w-]/g, "") || "a" + Math.random().toString(36).slice(2, 9),
    name: str(p.name, 80),
    subtitle: str(p.subtitle, 120),
    description: str(p.description, 1200),
    details: strList(p.details, 160, 12),
    price: Math.max(0, Math.round(Number(p.price) || 0)),
    stock, // null = wird für dich genäht (keine feste Stückzahl)
    images: (Array.isArray(p.images) ? p.images : []).filter((x) => typeof x === "string" && x).slice(0, 12),
    optionLabel: str(p.optionLabel, 40),
    optionValues: strList(p.optionValues, 60, 20),
    noteLabel: str(p.noteLabel, 80), // gesetzt = Pflichtangabe (z. B. Taillenumfang)
    leadTime: str(p.leadTime, 60),
    visible: p.visible !== false,
    sort: Number.isFinite(Number(p.sort)) ? Number(p.sort) : 0,
    ...(p.available !== undefined ? { available: p.available } : {}),
    // nur mit Worker: Stand-Nummer gegen Überschreiben und gerade an der Kasse reservierte Menge
    ...(Number.isInteger(p.rev) ? { rev: p.rev } : {}),
    ...(p.reserved ? { reserved: Number(p.reserved) || 0 } : {}),
  };
}

/** Startsortiment aus den bisherigen Etsy-Daten */
export function defaultProducts() {
  return PRODUCTS.map((p, i) => normalizeProduct({
    id: p.id,
    name: p.name,
    subtitle: p.subtitle,
    description: p.short,
    details: p.details,
    price: Math.round(p.price * 100),
    stock: p.unique ? 1 : p.madeToMeasure ? null : 3,
    images: p.images.includes(p.hero) ? [p.hero, ...p.images.filter((x) => x !== p.hero)] : p.images,
    optionLabel: p.colors && p.colors.length > 1 ? "Farbe" : "",
    optionValues: p.colors && p.colors.length > 1 ? p.colors : [],
    noteLabel: p.madeToMeasure ? "Taillenumfang und Wunschlänge" : "",
    leadTime: p.madeToMeasure ? "Nähzeit 1–2 Wochen" : "",
    visible: true,
    sort: i,
  }));
}

/** Auftragspause aktiv? Dann keine Stücke, die erst genäht werden (stock null) */
export function pauseActive(orderPause, todayIso) {
  const p = orderPause;
  return !!(p && p.active && String(p.text || "").trim() && !(p.until && todayIso > p.until));
}

/** Wie viele Stück gerade zu haben sind (null = wird genäht, unbegrenzt) */
export const availableOf = (p) => (p.stock === null ? null : Math.max(0, p.available ?? p.stock));
export const soldOut = (p) => availableOf(p) === 0;

export function availabilityText(p) {
  const a = availableOf(p);
  if (a === null) return p.leadTime ? `Wird für dich genäht · ${p.leadTime}` : "Wird für dich genäht";
  if (a === 0) return "Ausverkauft";
  if (p.stock === 1) return "Einzelstück";
  return a === 1 ? "Nur noch 1 da" : `Noch ${a} da`;
}

export function shippingFor(subtotal, settings, delivery) {
  if (delivery !== "versand") return 0;
  const s = settings.shipping;
  if (s.freeFrom > 0 && subtotal >= s.freeFrom) return 0;
  return s.flat;
}

export function deliveryOptions(settings) {
  const out = [];
  if (settings.shipping.enabled) out.push("versand");
  if (settings.pickup.enabled) out.push("abholung");
  return out;
}

/**
 * Warenkorb prüfen und berechnen.
 * lines: [{id, option, note, qty}] · products: normalisierte Artikel (mit available) · delivery: 'versand' | 'abholung'
 * -> {ok, errors:[{index, msg}], items:[{productId, name, option, note, qty, unit, amount}], subtotal, shipping, total}
 */
export function priceCart(lines, products, settingsRaw, delivery, { madeToOrderPaused = false } = {}) {
  const settings = normalizeShopSettings(settingsRaw);
  const errors = [];
  const items = [];
  if (!settings.enabled) errors.push({ index: -1, msg: "Der Shop ist gerade geschlossen." });
  if (!Array.isArray(lines) || !lines.length) errors.push({ index: -1, msg: "Dein Warenkorb ist leer." });
  if (Array.isArray(lines) && lines.length > MAX_LINES) errors.push({ index: -1, msg: `Bitte höchstens ${MAX_LINES} Positionen auf einmal bestellen.` });
  if (!deliveryOptions(settings).includes(delivery)) errors.push({ index: -1, msg: "Bitte wähle Versand oder Abholung." });
  const byId = new Map(products.map((p) => [p.id, p]));
  const wanted = new Map(); // Gesamtmenge pro Artikel (gleiches Stück in zwei Farben)
  (Array.isArray(lines) ? lines.slice(0, MAX_LINES) : []).forEach((l, index) => {
    const p = byId.get(String(l && l.id));
    if (!p || !p.visible || !p.price) { errors.push({ index, msg: "Diesen Artikel gibt es nicht mehr." }); return; }
    if (madeToOrderPaused && p.stock === null) { errors.push({ index, msg: `„${p.name}“ nähe ich gerade nicht auf Bestellung.` }); return; }
    const qty = Math.round(Number(l.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) { errors.push({ index, msg: `Bitte eine Menge zwischen 1 und ${MAX_QTY} wählen.` }); return; }
    const option = str(l.option, 60);
    if (p.optionValues.length && !p.optionValues.includes(option)) { errors.push({ index, msg: `Bitte wähle bei „${p.name}“ eine ${p.optionLabel || "Variante"}.` }); return; }
    const note = str(l.note, NOTE_MAX);
    if (p.noteLabel && !note) { errors.push({ index, msg: `Bitte gib bei „${p.name}“ an: ${p.noteLabel}.` }); return; }
    wanted.set(p.id, (wanted.get(p.id) || 0) + qty);
    items.push({ productId: p.id, name: p.name, option: p.optionValues.length ? option : "", note, qty, unit: p.price, amount: p.price * qty });
  });
  for (const [id, qty] of wanted) {
    const p = byId.get(id);
    const a = availableOf(p);
    if (a !== null && qty > a) errors.push({ index: (lines || []).findIndex((l) => l && l.id === id), msg: a === 0 ? `„${p.name}“ ist leider gerade weg.` : `Von „${p.name}“ sind nur noch ${a} da.` });
  }
  const subtotal = items.reduce((s, x) => s + x.amount, 0);
  const shipping = shippingFor(subtotal, settings, delivery);
  return { ok: errors.length === 0, errors, items, subtotal, shipping, total: subtotal + shipping, delivery };
}

/** Menge pro Artikel (für Reservierung und Lagerabzug) */
export function qtyByProduct(items) {
  const m = new Map();
  for (const x of items) m.set(x.productId, (m.get(x.productId) || 0) + x.qty);
  return m;
}

export const trackingUrl = (carrier, code) => {
  const c = encodeURIComponent(code || "");
  if (!c) return "";
  if (carrier === "hermes") return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${c}`;
  if (carrier === "dpd") return `https://tracking.dpd.de/status/de_DE/parcel/${c}`;
  return `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${c}`;
};
