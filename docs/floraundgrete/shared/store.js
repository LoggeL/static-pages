// Flora & Grete – Mini-CMS (Klick-Prototyp).
// Alles liegt im localStorage dieses Browsers; alle drei Entwürfe und die Verwaltung
// teilen denselben Speicher. Änderungen werden live (auch tabübergreifend) verteilt.
//
// API (alle Funktionen synchron, Rückgabewerte sind Kopien):
//   getContent()                 -> vollständiger Inhalt (siehe DEFAULTS)
//   update(mutator)              -> mutator(draft) ändert eine Kopie; wird gespeichert + verteilt
//   subscribe(fn)                -> fn(content) bei jeder Änderung; gibt unsubscribe zurück
//   reset()                      -> Demo-Inhalte wiederherstellen
//   upcomingEvents(limit?)       -> sichtbare Termine ab heute, sortiert
//   activeBanner()               -> Banner-Objekt oder null (berücksichtigt aktiv + Zeitraum)
//   openSlots(fromISO?, days?)   -> [{date:'YYYY-MM-DD', weekday, slots:[{start:'16:00', end:'16:45', free:true}]}]
//   requestFitting(data)         -> legt Anfrage an {date,start,name,email,phone,product,note}; gibt Anfrage zurück
//   setBookingStatus(id, status) -> 'angefragt' | 'bestaetigt' | 'abgelehnt'
//   deleteBooking(id)
//   TODAY                        -> heutiges Datum (ISO); Demo-Termine werden relativ dazu erzeugt
//   uid()                        -> kurze ID

const KEY = "floraundgrete-cms-v1";
const CHANNEL = "floraundgrete-cms";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const realToday = new Date();
export const TODAY = iso(realToday);
const addDays = (isoStr, n) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return iso(new Date(y, m - 1, d + n));
};
export const uid = () => Math.random().toString(36).slice(2, 9);

// Demo-Inhalte. Termine werden relativ zu "heute" erzeugt, damit sie nie veralten.
function defaults() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    // Hinweisbanner oben auf der Seite
    banner: {
      active: true,
      tone: "info", // 'info' | 'warn' | 'closed' | 'sale'
      text: "Weihnachtsbestellungen bitte bis 10. Dezember – danach nähe ich erst wieder ab dem 7. Januar ♡",
      linkLabel: "Zum Etsy-Shop",
      linkUrl: "https://www.etsy.com/de/shop/FloraundGrete",
      from: "", // optional 'YYYY-MM-DD'
      until: "", // optional 'YYYY-MM-DD'
    },
    // Atelier-Status (die Website zeigt ihn; Google-Öffnungszeiten pflegt Cathrin im Google-Unternehmensprofil)
    status: {
      mode: "open", // 'open' | 'appointment' | 'closed' | 'vacation'
      note: "Anprobe & Abholung nur nach Termin",
      hours: [
        { day: "Dienstag", time: "16:00–19:00 (Anprobe nach Termin)" },
        { day: "Donnerstag", time: "16:00–19:00 (Anprobe nach Termin)" },
        { day: "Samstag", time: "10:00–13:00 (nach Absprache)" },
      ],
    },
    // Termine: Märkte, Workshops, Atelier-Pausen
    events: [
      { id: uid(), date: nextWeekday(addDays(TODAY, 8), [6]), time: "11:00–18:00", title: "Adventsmarkt Ramsen", place: "Ramsen, Ortsmitte", note: "Mit Stulpen, Tüchern und Stirnbändern zum Anprobieren.", visible: true },
      { id: uid(), date: nextWeekday(addDays(TODAY, 15), [5]), time: "15:00–18:00", title: "Offenes Atelier", place: "Atelier Flora & Grete, Ramsen", note: "Stoffe fühlen, Röcke probieren, Kaffee trinken.", visible: true },
      { id: uid(), date: nextWeekday(addDays(TODAY, 22), [1, 2, 3, 4, 5]), time: "", title: "Letzter Versand vor Weihnachten", place: "Etsy-Shop", note: "Bestellungen bis heute kommen noch vor dem Fest an.", visible: true },
      { id: uid(), date: nextWeekday(addDays(TODAY, 50), [6]), time: "10:00–16:00", title: "Nähkurs: Dein erster Musselinrock", place: "Atelier, max. 4 Personen", note: "Beispieltermin – Anmeldung per Nachricht.", visible: true },
    ],
    // Aktuelle Links (Linkliste, z. B. für Instagram-Bio)
    links: [
      { id: uid(), label: "Etsy-Shop: alle Einzelstücke", url: "https://www.etsy.com/de/shop/FloraundGrete", note: "", highlight: true, visible: true },
      { id: uid(), label: "Neu: Walk-Stulpen mit Daumenloch", url: "https://www.etsy.com/de/listing/4396882148", note: "Für kalte Hände", highlight: false, visible: true },
      { id: uid(), label: "Instagram @floraundgrete", url: "https://www.instagram.com/floraundgrete/", note: "Blick ins Atelier", highlight: false, visible: true },
      { id: uid(), label: "Rock Lene auf Maß bestellen", url: "https://www.etsy.com/de/listing/1111578564", note: "", highlight: false, visible: true },
    ],
    // Hervorgehobene Produkte (IDs aus data.js), Reihenfolge = Anzeige
    featured: ["lene", "viola-kleid", "millie", "rosemary", "stulpen", "kragen-frucht"],
    // Über-mich-Kurztext (überschreibt ABOUT.intro, wenn gesetzt)
    aboutIntro: "",
    // Anprobe-Planer
    fitting: {
      enabled: true,
      weekdays: [2, 4, 6], // 0=So … 6=Sa
      times: structuredClone(DEMO_TIMES),
      duration: 45,
      leadDays: 2, // frühestens in X Tagen buchbar
      horizonDays: 28,
      blocked: [nextWeekday(addDays(TODAY, 12), [4])], // gesperrte Tage (Urlaub, Markt …)
      place: "Atelier in Ramsen – genaue Adresse kommt mit der Bestätigung",
      bookings: [
        { id: uid(), ...demoSlot(addDays(TODAY, 2), 1), name: "Janne M.", email: "janne@example.de", phone: "", product: "lene", note: "Zweiter Lene-Rock in Flaschengrün, Taille 74 cm", status: "bestaetigt", createdAt: new Date().toISOString() },
        { id: uid(), ...demoSlot(addDays(TODAY, 5), 0), name: "Laura K.", email: "laura@example.de", phone: "0170 1234567", product: "rosemary", note: "Rosemary in Flieder, Länge besprechen", status: "angefragt", createdAt: new Date().toISOString() },
      ],
    },
  };
}

const DEMO_TIMES = { 2: ["16:00", "16:45", "17:30", "18:15"], 4: ["16:00", "16:45", "17:30", "18:15"], 6: ["10:00", "10:45", "11:30", "12:15"] };
// Demo-Buchung auf einen echten Anprobe-Tag mit einer Uhrzeit, die es an diesem Wochentag gibt
function demoSlot(fromISO, idx) {
  const date = nextWeekday(fromISO, [2, 4, 6]);
  const [y, m, d] = date.split("-").map(Number);
  return { date, start: DEMO_TIMES[new Date(y, m - 1, d).getDay()][idx] };
}

function nextWeekday(isoStr, weekdays) {
  let d = isoStr;
  for (let i = 0; i < 14; i++) {
    const [y, m, dd] = d.split("-").map(Number);
    if (weekdays.includes(new Date(y, m - 1, dd).getDay())) return d;
    d = addDays(d, 1);
  }
  return isoStr;
}

let cache = null;
const listeners = new Set();
let bc = null;
try { bc = new BroadcastChannel(CHANNEL); } catch { /* ältere Browser */ }

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) { cache = { ...defaults(), ...parsed }; return cache; }
    }
  } catch { /* privates Fenster etc. */ }
  cache = defaults();
  return cache;
}

function persist() {
  cache.updatedAt = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignorieren */ }
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
  cache = draft;
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

export function upcomingEvents(limit = 99) {
  return load().events
    .filter((e) => e.visible !== false && e.date >= TODAY)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, limit)
    .map((e) => ({ ...e }));
}

const WD = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
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
    const [y, m, d] = date.split("-").map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    if (!f.weekdays.includes(wd) || f.blocked.includes(date)) continue;
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

export const WEEKDAYS = WD;
export const formatDate = (isoStr, opts = { weekday: "short", day: "numeric", month: "long" }) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", opts);
};
