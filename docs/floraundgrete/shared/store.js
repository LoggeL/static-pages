// Cathrin Raasch Atelier – Mini-CMS (Klick-Prototyp).
// Alles liegt im localStorage dieses Browsers; Website und Verwaltung
// teilen denselben Speicher. Änderungen werden live (auch tabübergreifend) verteilt.
//
// API (alle Funktionen synchron, Rückgabewerte sind Kopien):
//   getContent()                 -> vollständiger Inhalt (siehe defaults())
//   update(mutator)              -> mutator(draft) ändert eine Kopie; wird gespeichert + verteilt
//   subscribe(fn)                -> fn(content) bei jeder Änderung; gibt unsubscribe zurück
//   reset()                      -> Startinhalte wiederherstellen
//   upcomingEvents(limit?)       -> sichtbare Termine, die heute oder später enden, sortiert
//   eventsOn(iso)                -> sichtbare Märkte/Kurse, die diesen Tag belegen
//   closedDays(days?)            -> [{date, weekday, reasons:[titel], events:[{type,title,place}]}] – reguläre Öffnungstage, die wegen Markt/Kurs ausfallen
//   activeBanner()               -> Banner-Objekt oder null (berücksichtigt aktiv + Zeitraum)
//   activePause()                -> Auftragspause {active, text, until} oder null (aktiv, Text da, bis-Datum nicht vorbei)
//   openSlots(fromISO?, days?)   -> [{date:'YYYY-MM-DD', weekday, slots:[{start, end, free}]}]
//                                   (Tage mit Markt/Kurs fallen automatisch weg, wenn fitting.skipEventDays)
//   requestFitting(data)         -> legt Anfrage an {date,start,name,email,phone,product,note}; gibt Anfrage zurück
//   setBookingStatus(id, status) -> 'angefragt' | 'bestaetigt' | 'abgelehnt'
//   deleteBooking(id)
//   lookbookItems()              -> sichtbare Lookbook-Einträge in Anzeigereihenfolge
//   imageSrc(image, prefix)      -> Bildpfad: Dateiname aus img/ (prefix + "img/" + name) oder data:-URL unverändert
//   courseItems()                -> sichtbare feste Kurse in Anzeigereihenfolge
//   courseRule(course)           -> z. B. "1. und 3. Donnerstag im Monat"
//   courseDates(course, n?, days?) -> nächste n Termine (ISO), ohne Feiertage, Kurspausen und Tage mit Markt oder Nähkurs-Termin
//   courseSessions(course, n?, days?) -> nächste n Kurse als [[iso, …]]; bei sessions > 1 gehören die Termine eines Monats zusammen
//   isHoliday(iso)               -> Feiertag in RLP (inkl. 24.12. und 31.12.)
//   EVENT_TYPES, eventTypeLabel(id), eventRange(e), WEEKDAYS, formatDate, TODAY, uid
//
// Datenmodell (Version 4):
//   events[]   {id, type:'markt'|'kurs'|'atelier'|'sonstiges', date:'YYYY-MM-DD', until:'' | 'YYYY-MM-DD',
//               time, title, place, note, link, visible}
//   status     {mode, note, openWeekdays:[0..6], hours:[{day, time}], googleUrl, googleNote, autoClosed:boolean}
//   lookbook[] {id, image:'datei.webp' | 'data:image/…', title, year, note, visible, sample?:true}
//   courses[]  {id, title, subtitle, weekday:0..6, weeks:[1..5] (n-ter Wochentag im Monat), sessions:1..4 (Termine pro Kurs), time, price, audience, note, visible}
//   orderPause {active, text, until:'' | 'YYYY-MM-DD'} Hinweis bei Hero und Anprobe, wenn keine neuen Aufträge angenommen werden
//   courseNote Hinweis unter den festen Kursen; courseBreaks:[iso] Kurspausen (zusätzlich zu Feiertagen)
//   fitting    {enabled, weekdays, times:{wd:[hh:mm]}, duration, leadDays, horizonDays, blocked:[iso], skipEventDays, place, bookings[]}

const KEY = "cathrin-raasch-cms-v4";
const CHANNEL = "cathrin-raasch-cms";
const VERSION = 4;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const realToday = new Date();
export const TODAY = iso(realToday);
const addDays = (isoStr, n) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return iso(new Date(y, m - 1, d + n));
};
const weekdayOf = (isoStr) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};
export const uid = () => Math.random().toString(36).slice(2, 9);

export const EVENT_TYPES = [
  { id: "markt", label: "Markt", plural: "Märkte" },
  { id: "kurs", label: "Nähkurs", plural: "Nähkurse" },
  { id: "atelier", label: "Atelier", plural: "Atelier" },
  { id: "sonstiges", label: "Termin", plural: "Sonstiges" },
];
export const eventTypeLabel = (id) => (EVENT_TYPES.find((t) => t.id === id) || EVENT_TYPES[3]).label;
// Märkte und Nähkurse belegen den Tag: Atelier zu, keine Anprobe
const BLOCKING = ["markt", "kurs"];

const GOOGLE_URL = "https://www.google.com/maps/search/?api=1&query=Cathrin%20Raasch%20Schneideratelier%20Ramsen";

// Start-Termine (Cathrins echte Daten, Stand 20.11.2026)
const START_EVENTS = [
  { type: "markt", date: "2026-11-27", until: "2026-11-29", time: "", title: "Blaues Wunder", place: "Lorsch", note: "Weihnachtsmarkt" },
  { type: "markt", date: "2026-12-05", until: "2026-12-06", time: "", title: "Woinacht", place: "Weinbiethaus, Neustadt", note: "Weihnachtsmarkt" },
  { type: "markt", date: "2026-12-12", until: "2026-12-13", time: "", title: "Oppenheim", place: "Eventlocation Storch2, Oppenheim", note: "Weihnachtsmarkt" },
  { type: "kurs", date: "2027-01-09", until: "", time: "10–16 Uhr", title: "Nähtag: Outdoorpulli", place: "", note: "Ein Unisex-Outdoorpulli an einem Tag, inklusive Material und Verpflegung, 110\u00a0€. Nichts für totale Anfänger: Mit deiner Nähmaschine solltest du schon vertraut sein. Anmeldung per Nachricht." },
];

const DEMO_TIMES = { 3: ["15:00", "15:45", "16:30", "17:15"], 6: ["12:30", "13:15", "14:00", "14:45"] }; // Samstagvormittag laufen die festen Kurse
// Demo-Buchung auf einen echten Anprobe-Tag (ohne Markt/Kurs) mit einer Uhrzeit, die es an diesem Wochentag gibt
function demoSlot(fromISO, idx) {
  const busy = new Set();
  START_EVENTS.forEach((e) => { for (let d = e.date; d <= (e.until || e.date); d = addDays(d, 1)) busy.add(d); });
  let date = fromISO;
  for (let i = 0; i < 60; i++) {
    const wd = weekdayOf(date);
    if (DEMO_TIMES[wd] && !busy.has(date)) return { date, start: DEMO_TIMES[wd][idx] };
    date = addDays(date, 1);
  }
  return { date: fromISO, start: "10:00" };
}

function defaults() {
  return {
    version: VERSION,
    updatedAt: new Date().toISOString(),
    // Hinweisbanner oben auf der Seite
    banner: {
      active: true,
      tone: "info", // 'info' | 'warn' | 'closed' | 'sale'
      text: "Diesen Winter findest du mich auf drei Weihnachtsmärkten: in Lorsch, Neustadt und Oppenheim.",
      linkLabel: "Zu den Terminen",
      linkUrl: "#termine",
      from: "",
      until: "2026-12-13",
    },
    // Auftragspause (Cathrins Instagram-Post vom 12.11.2026); verschwindet nach "until" von selbst
    orderPause: {
      active: true,
      text: "Bis Ende des Jahres nehme ich keine neuen Sonderanfertigungen, Änderungen und Reparaturen an. Fertige Stücke findest du weiter im Etsy-Shop und auf den Märkten.",
      until: "2026-12-31",
    },
    // Atelier: Grundregel + Hinweis auf Google (dort pflegt Cathrin die aktuellen Zeiten)
    status: {
      mode: "open", // 'open' | 'appointment' | 'closed' | 'vacation'
      note: "Die aktuellen Öffnungszeiten stehen immer bei Google Maps – die halte ich aktuell.",
      openWeekdays: [3, 6], // Mi, Sa
      hours: [
        { day: "Mittwoch", time: "geöffnet" },
        { day: "Samstag", time: "geöffnet, außer an Markt- und Nähkurstagen" },
      ],
      googleUrl: GOOGLE_URL,
      googleNote: "Aktuelle Öffnungszeiten bei Google Maps",
      autoClosed: true, // reguläre Öffnungstage mit Markt oder Nähkurs automatisch als geschlossen zeigen
    },
    // Termine: Märkte, Nähkurse, Atelier
    events: START_EVENTS.map((e) => ({ id: uid(), link: "", visible: true, ...e })),
    // Aktuelle Links (Linkliste, z. B. für Instagram-Bio)
    links: [
      { id: uid(), label: "Einzelstücke im Etsy-Shop", url: "https://www.etsy.com/de/shop/FloraundGrete", note: "", highlight: true, visible: true },
      { id: uid(), label: "Instagram @cathrinraasch.atelier", url: "https://www.instagram.com/cathrinraasch.atelier/", note: "Blick ins Atelier", highlight: false, visible: true },
    ],
    // Lookbook: vergangene Projekte, nicht nachbestellbar. Startbilder stammen von Cathrins Instagram (@cathrinraasch.atelier).
    lookbook: [
      { id: uid(), image: "lb-outdoorpulli-leo.webp", title: "Outdoorpulli aus Teddystoff", year: "2026", note: "", visible: true, sample: false },
      { id: uid(), image: "lb-kinderdirndl.webp", title: "Kinderdirndl mit Bluse", year: "2026", note: "", visible: true, sample: false },
      { id: uid(), image: "lb-tuellkleid.webp", title: "Tüllkleid mit Perlen und Blüten", year: "2026", note: "", visible: true, sample: false },
      { id: uid(), image: "lb-steppjacke.webp", title: "Steppjacke in Altrosa", year: "2026", note: "", visible: true, sample: false },
      { id: uid(), image: "lb-kinderbluse.webp", title: "Weiße Kinderbluse", year: "2026", note: "", visible: true, sample: false },
      { id: uid(), image: "lb-jacken.webp", title: "Teddy- und Steppjacken", year: "2026", note: "", visible: true, sample: false },
    ],
    // Feste Nähkurse (Stand: Cathrins Kreidetafel, Instagram September 2026)
    courses: [
      { id: uid(), title: "Trag’s weiter", subtitle: "Reparatur-Kurs", weekday: 4, weeks: [1, 3], time: "18–20 Uhr", price: "24\u00a0€ pro Termin", audience: "Für alle, auch absolute Einsteiger", note: "Hosen kürzen, Knöpfe austauschen, Jeans flicken. Material inklusive.", visible: true },
      { id: uid(), title: "Offenes Nähen", subtitle: "Freie Projekte nach Wunsch", weekday: 4, weeks: [2, 4], time: "18–21 Uhr", price: "35\u00a0€ pro Termin", audience: "Für Anfänger und Fortgeschrittene", note: "Taschen, Kleidung und was du sonst nähen möchtest.", visible: true },
      { id: uid(), title: "Kinderkurs", subtitle: "Kleinere Projekte", weekday: 6, weeks: [1, 3], time: "9–12 Uhr", price: "36\u00a0€ inklusive Material", audience: "Ab 8 Jahren", note: "", visible: true },
      { id: uid(), title: "Nähmaschinen-Führerschein", subtitle: "Nähen lernen von Anfang an", weekday: 6, weeks: [2, 4], sessions: 2, time: "9–12 Uhr", price: "60\u00a0€ für 2 Termine, inklusive Material", audience: "Für Einsteiger", note: "Basics, die Maschine kennenlernen und erste kleine Projekte.", visible: true },
    ],
    courseNote: "Bring nach Möglichkeit deine eigene Nähmaschine mit.",
    courseBreaks: [], // Tage, an denen keine festen Kurse stattfinden (ISO)
    // Über-mich-Kurztext (überschreibt ABOUT.intro, wenn gesetzt)
    aboutIntro: "",
    // Anprobe-Planer
    fitting: {
      enabled: true,
      weekdays: [3, 6], // 0=So … 6=Sa – wie das Atelier
      times: structuredClone(DEMO_TIMES),
      duration: 45,
      leadDays: 2, // frühestens in X Tagen buchbar
      horizonDays: 35,
      blocked: [], // zusätzlich gesperrte Tage (Urlaub …)
      skipEventDays: true, // Tage mit Markt oder Nähkurs automatisch sperren
      place: "Atelier in Ramsen – genaue Adresse kommt mit der Bestätigung",
      bookings: [
        { id: uid(), ...demoSlot(addDays(TODAY, 2), 1), name: "Janne M.", email: "janne@example.de", phone: "", product: "", note: "Rock in Flaschengrün wie in der Galerie, Taille 74 cm", status: "bestaetigt", createdAt: new Date().toISOString() },
        { id: uid(), ...demoSlot(addDays(TODAY, 5), 0), name: "Laura K.", email: "laura@example.de", phone: "0170 1234567", product: "", note: "Kleid in Flieder, Länge besprechen", status: "angefragt", createdAt: new Date().toISOString() },
      ],
    },
  };
}

let cache = null;
const listeners = new Set();
let bc = null;
try { bc = new BroadcastChannel(CHANNEL); } catch { /* ältere Browser */ }

// Teilweise Daten auffüllen, damit neue Felder nie fehlen
function normalize(c) {
  const d = defaults();
  const out = { ...d, ...c };
  out.status = { ...d.status, ...(c.status || {}) };
  out.fitting = { ...d.fitting, ...(c.fitting || {}) };
  out.banner = { ...d.banner, ...(c.banner || {}) };
  out.orderPause = { ...d.orderPause, ...(c.orderPause || {}) };
  out.events = (Array.isArray(c.events) ? c.events : d.events).map((e) => ({ type: "sonstiges", until: "", link: "", time: "", place: "", note: "", visible: true, ...e }));
  out.lookbook = Array.isArray(c.lookbook) ? c.lookbook : d.lookbook;
  out.courses = (Array.isArray(c.courses) ? c.courses : d.courses).map((k) => ({ title: "", subtitle: "", weekday: 4, weeks: [1, 3], time: "", price: "", audience: "", note: "", visible: true, ...k, weeks: Array.isArray(k.weeks) ? k.weeks.filter((w) => w >= 1 && w <= 5).sort() : [1, 3], sessions: Math.min(4, Math.max(1, Math.round(Number(k.sessions) || 1))) }));
  if (typeof out.courseNote !== "string") out.courseNote = d.courseNote;
  out.courseBreaks = Array.isArray(c.courseBreaks) ? c.courseBreaks : [];
  return out;
}

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === VERSION) { cache = normalize(parsed); return cache; }
    }
  } catch { /* privates Fenster etc. */ }
  cache = defaults();
  return cache;
}

function persist() {
  cache.updatedAt = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {
    // Speicher voll (z. B. zu viele hochgeladene Fotos) – Änderung bleibt in diesem Tab erhalten
    console.warn("Speichern nicht möglich:", e && e.name);
  }
  emit();
  try { bc && bc.postMessage("changed"); } catch { /* ignorieren */ }
}

function emit() {
  const snap = getContent();
  listeners.forEach((fn) => { try { fn(snap); } catch (e) { console.error(e); } });
}

function reloadFromStorage() { cache = null; load(); emit(); }
if (bc) bc.onmessage = reloadFromStorage;
window.addEventListener("storage", (e) => { if (e.key === KEY) reloadFromStorage(); });

export const getContent = () => structuredClone(load());

export function update(mutator) {
  const draft = structuredClone(load());
  mutator(draft);
  cache = normalize(draft);
  persist();
  return getContent();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reset() {
  cache = defaults();
  persist();
}

export function activeBanner() {
  const b = load().banner;
  if (!b || !b.active || !b.text) return null;
  if (b.from && TODAY < b.from) return null;
  if (b.until && TODAY > b.until) return null;
  return structuredClone(b);
}

export function activePause() {
  const p = load().orderPause;
  if (!p || !p.active || !String(p.text || "").trim()) return null;
  if (p.until && TODAY > p.until) return null;
  return structuredClone(p);
}

// Zeitraum eines Termins (mehrtägig über "until")
export const eventRange = (e) => ({ from: e.date, to: e.until && e.until > e.date ? e.until : e.date });

export function upcomingEvents(limit = 99) {
  return load().events
    .filter((e) => e.visible !== false && e.date && eventRange(e).to >= TODAY)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
    .slice(0, limit)
    .map((e) => ({ ...e }));
}

export function eventsOn(isoStr) {
  return load().events
    .filter((e) => e.visible !== false && BLOCKING.includes(e.type) && e.date)
    .filter((e) => { const r = eventRange(e); return r.from <= isoStr && isoStr <= r.to; })
    .map((e) => ({ ...e }));
}

const WD = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function closedDays(days = 70) {
  const s = load().status;
  if (s.autoClosed === false) return [];
  const open = s.openWeekdays || [];
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(TODAY, i);
    const wd = weekdayOf(date);
    if (!open.includes(wd)) continue;
    const ev = eventsOn(date);
    if (ev.length) out.push({ date, weekday: WD[wd], reasons: ev.map((e) => e.title), events: ev.map((e) => ({ type: e.type, title: e.title, place: e.place })) });
  }
  return out;
}

const addMin = (hhmm, min) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

export function openSlots(fromISO, days) {
  const f = load().fitting;
  if (!f.enabled) return [];
  const start = fromISO || addDays(TODAY, f.leadDays);
  const n = days || f.horizonDays;
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    const wd = weekdayOf(date);
    if (!f.weekdays.includes(wd) || (f.blocked || []).includes(date)) continue;
    if (f.skipEventDays !== false && eventsOn(date).length) continue;
    const times = f.times[wd] || [];
    const taken = f.bookings.filter((b) => b.date === date && b.status !== "abgelehnt").map((b) => b.start);
    out.push({
      date, weekday: WD[wd],
      slots: times.map((t) => ({ start: t, end: addMin(t, f.duration), free: !taken.includes(t) })),
    });
  }
  return out;
}

export function requestFitting(data) {
  const booking = {
    id: uid(), status: "angefragt", createdAt: new Date().toISOString(),
    date: data.date, start: data.start, name: data.name || "", email: data.email || "",
    phone: data.phone || "", product: data.product || "", note: data.note || "",
  };
  update((c) => { c.fitting.bookings.push(booking); });
  return { ...booking };
}

export function setBookingStatus(id, status) {
  update((c) => { const b = c.fitting.bookings.find((x) => x.id === id); if (b) b.status = status; });
}

export function deleteBooking(id) {
  update((c) => { c.fitting.bookings = c.fitting.bookings.filter((x) => x.id !== id); });
}

export function lookbookItems() {
  return (load().lookbook || []).filter((x) => x.visible !== false && x.image).map((x) => ({ ...x }));
}

// ---------- Feste Kurse ----------
export function courseItems() {
  return (load().courses || []).filter((k) => k.visible !== false && k.title).map((k) => ({ ...k, weeks: [...k.weeks] }));
}
const ORD = ["", "1.", "2.", "3.", "4.", "5."];
export function courseRule(k) {
  const wd = WD[k.weekday] || "";
  const ws = [...(k.weeks || [])].sort();
  if (!ws.length || [1, 2, 3, 4, 5].every((w) => ws.includes(w))) return `jeden ${wd}`;
  const parts = ws.map((w) => ORD[w]);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}` : parts[0];
  return `${list} ${wd} im Monat`;
}
// Gesetzliche Feiertage in Rheinland-Pfalz plus Heiligabend und Silvester
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}
const holidayCache = {};
export function isHoliday(isoStr) {
  const y = Number(isoStr.slice(0, 4));
  if (!holidayCache[y]) {
    const e = easter(y);
    holidayCache[y] = new Set([
      ...["01-01", "05-01", "10-03", "11-01", "12-24", "12-25", "12-26", "12-31"].map((md) => `${y}-${md}`),
      ...[-2, 1, 39, 50, 60].map((n) => addDays(e, n)),
    ]);
  }
  return holidayCache[y].has(isoStr);
}
/** Nächste Kurstage ab heute; Feiertage, Kurspausen und Tage mit Markt oder Nähkurs-Termin fallen weg */
export function courseDates(k, count = 2, days = 120) {
  const out = [];
  const ws = k.weeks && k.weeks.length ? k.weeks : [1, 2, 3, 4, 5];
  for (let i = 0; i <= days && out.length < count; i++) {
    const date = addDays(TODAY, i);
    if (weekdayOf(date) !== Number(k.weekday)) continue;
    const nth = Math.ceil(Number(date.slice(8, 10)) / 7);
    if (!ws.includes(nth)) continue;
    if (isHoliday(date) || (load().courseBreaks || []).includes(date) || eventsOn(date).length) continue;
    out.push(date);
  }
  return out;
}

// Kurse mit mehreren Terminen (z. B. Führerschein = 2. und 4. Samstag): Die Termine eines Monats gehören zusammen.
// Fällt einer davon aus (Feiertag, Markt, Kurspause) oder liegt schon zurück, findet der Kurs in dem Monat nicht statt.
export function courseSessions(k, count = 2, days = 240) {
  const n = Math.min(4, Math.max(1, Math.round(Number(k.sessions) || 1)));
  if (n === 1) return courseDates(k, count, days).map((d) => [d]);
  const ws = k.weeks && k.weeks.length ? k.weeks : [1, 2, 3, 4, 5];
  const all = courseDates(k, 999, days);
  const ok = new Set(all);
  const out = [];
  const months = [...new Set(all.map((d) => d.slice(0, 7)))];
  for (const ym of months) {
    // alle Regel-Termine des Monats (auch ausgefallene), damit ein Ausfall den ganzen Kurs absagt
    const [y, m] = ym.split("-").map(Number);
    const rule = [];
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(y, m - 1, d);
      if (dt.getMonth() !== m - 1) break;
      if (dt.getDay() === Number(k.weekday) && ws.includes(Math.ceil(d / 7))) rule.push(iso(dt));
    }
    for (let i = 0; i + n <= rule.length && out.length < count; i += n) {
      const g = rule.slice(i, i + n);
      if (g.every((d) => ok.has(d))) out.push(g);
    }
    if (out.length >= count) break;
  }
  return out;
}

export const imageSrc = (image, prefix = "") => (/^data:image\//.test(image || "") ? image : `${prefix}img/${image}`);

export const WEEKDAYS = WD;
export const formatDate = (isoStr, opts = { weekday: "short", day: "numeric", month: "long" }) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", opts);
};
