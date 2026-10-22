// =========================================================
// modules/termine/recur.js – Wiederkehrende Termine & Datums-Helfer
// Reine Funktionen (kein DOM). Eine Reihe wird beim Speichern in
// einzelne Termine aufgelöst (gleiche seriesId), damit Website,
// Startseite und Kalender-Abo ohne Sonderlogik funktionieren.
// =========================================================
import { fromISODate, toISODate, WEEKDAYS, MONTHS, parseDate, parseTime, formatDate } from '../../ui.js';

const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

/** Wochentag, Tag, n-ter Wochentag im Monat, ist es der letzte? */
export function weekdayInfo(iso) {
  const d = fromISODate(iso);
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  return { wd: d.getDay(), day, month: m, year: y, nth: Math.ceil(day / 7), isLast: day + 7 > daysIn(y, m) };
}
const adverb = wd => WEEKDAYS[wd].toLowerCase() + 's'; // dienstags

/** Arten der Wiederholung (Auswahl-Knöpfe, kein Dropdown) */
export const KINDS = ['none', 'weekly', 'biweekly', 'monthly-nth', 'monthly-last', 'monthly-day', 'yearly'];

/** Beschriftung, z. B. „Jeden 1. Dienstag im Monat“ – ohne Datum allgemein */
export function kindLabel(kind, iso) {
  if (kind === 'none') return 'Nur einmal';
  if (!iso) {
    return ({ weekly: 'Jede Woche', biweekly: 'Alle 14 Tage', 'monthly-nth': 'Jeden Monat am gleichen Wochentag',
      'monthly-last': 'Jeden Monat am letzten Wochentag', 'monthly-day': 'Jeden Monat am gleichen Tag', yearly: 'Jedes Jahr' })[kind] || kind;
  }
  const i = weekdayInfo(iso); const wdn = WEEKDAYS[i.wd];
  switch (kind) {
    case 'weekly': return `Jeden ${wdn}`;
    case 'biweekly': return `Alle 14 Tage ${adverb(i.wd)}`;
    case 'monthly-nth': return `Jeden ${i.nth}. ${wdn} im Monat`;
    case 'monthly-last': return `Jeden letzten ${wdn} im Monat`;
    case 'monthly-day': return `Jeden Monat am ${i.day}.`;
    case 'yearly': return `Jedes Jahr am ${i.day}. ${MONTHS[i.month]}`;
    default: return kind;
  }
}

/** Welche Wiederholungen passen zu diesem Datum? (z. B. „5. Montag“ gibt es nicht jeden Monat → nur „letzter Montag“) */
export function kindsFor(iso) {
  if (!iso) return ['none', 'weekly', 'biweekly', 'monthly-nth', 'monthly-day', 'yearly'];
  const i = weekdayInfo(iso);
  const list = ['none', 'weekly', 'biweekly'];
  if (i.nth <= 4) list.push('monthly-nth');
  if (i.isLast) list.push('monthly-last');
  list.push('monthly-day', 'yearly');
  return list;
}
/** Passt die gewählte Art nicht mehr (Datum geändert), sinnvoll ersetzen */
export function fixKind(kind, iso) {
  const ok = kindsFor(iso);
  if (ok.includes(kind)) return kind;
  if (kind === 'monthly-nth' && ok.includes('monthly-last')) return 'monthly-last';
  if (kind === 'monthly-last' && ok.includes('monthly-nth')) return 'monthly-nth';
  return 'none';
}

/** „Wie lange?“-Auswahl */
export const UNTIL_CHOICES = [
  { id: '3m', label: '3 Monate', months: 3 },
  { id: '6m', label: '6 Monate', months: 6 },
  { id: '12m', label: '1 Jahr', months: 12 },
  { id: '24m', label: '2 Jahre', months: 24 },
  { id: 'date', label: 'Bis zu einem Datum …' },
];
export function defaultUntil(kind) { return kind === 'yearly' ? '24m' : (kind === 'weekly' || kind === 'biweekly') ? '3m' : '6m'; }
export function untilFor(startIso, choice, customIso) {
  if (!startIso) return null;
  if (choice === 'date') return customIso || null;
  const c = UNTIL_CHOICES.find(x => x.id === choice) || UNTIL_CHOICES[1];
  const s = fromISODate(startIso);
  const d = new Date(s.getFullYear(), s.getMonth() + c.months, s.getDate(), 12);
  return toISODate(d);
}

/** Alle Daten einer Reihe (inkl. Starttag), höchstens max Stück */
export function occurrences(startIso, kind, untilIso, max = 60) {
  if (!startIso) return [];
  if (!kind || kind === 'none') return [startIso];
  const out = [startIso];
  const s = fromISODate(startIso); const i = weekdayInfo(startIso);
  const until = untilIso && untilIso > startIso ? untilIso : startIso;
  for (let k = 1, guard = 0; out.length < max && guard < 1200; k++, guard++) {
    let d = null;
    if (kind === 'weekly' || kind === 'biweekly') {
      d = new Date(s); d.setDate(s.getDate() + k * (kind === 'weekly' ? 7 : 14));
    } else if (kind === 'yearly') {
      d = new Date(s.getFullYear() + k, s.getMonth(), s.getDate(), 12);
      if (d.getMonth() !== s.getMonth()) d = null; // 29. Februar
      if (toISODate(new Date(s.getFullYear() + k, s.getMonth(), 1, 12)) > until) break;
    } else {
      const first = new Date(s.getFullYear(), s.getMonth() + k, 1, 12);
      if (toISODate(first) > until) break;
      const yy = first.getFullYear(), mm = first.getMonth(), dim = daysIn(yy, mm);
      if (kind === 'monthly-day') { if (i.day <= dim) d = new Date(yy, mm, i.day, 12); }
      else if (kind === 'monthly-nth') {
        const day = 1 + ((i.wd - first.getDay() + 7) % 7) + (i.nth - 1) * 7;
        if (day <= dim) d = new Date(yy, mm, day, 12);
      } else if (kind === 'monthly-last') {
        const last = new Date(yy, mm, dim, 12);
        d = new Date(yy, mm, dim - ((last.getDay() - i.wd + 7) % 7), 12);
      }
    }
    if (!d) continue;
    const iso = toISODate(d);
    if (iso > until) break;
    out.push(iso);
  }
  return out;
}

/* ---------------------------------------------------------
   Tolerante Eingabe – ergänzt parseDate/parseTime aus ui.js
   --------------------------------------------------------- */
const WD_PREFIX = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 0 };

/**
 * Versteht zusätzlich „3.11. 19 Uhr“, „3. November um halb 8 abends“, „Samstag, 7.11.“.
 * → { iso, time, weekdayMismatch: {typed, actual} | null }
 */
export function parseDateInput(text) {
  const s = String(text || '').trim();
  if (!s) return { iso: null, time: null, weekdayMismatch: null };
  let iso = parseDate(s), time = null;
  if (!iso) {
    // Datum + Uhrzeit in einem Feld
    const m = s.match(/^(.*?)(?:\s*,\s*|\s+um\s+|\s+ab\s+|\s+gegen\s+|\s+)((?:halb\s+)?\d{1,2}(?:[:]\d{2})?\s*uhr.*|halb\s+\d{1,2}.*|\d{1,2}:\d{2}.*)$/i);
    if (m) {
      const d2 = parseDate(m[1].replace(/[,\s]+$/, '')); const t2 = parseTime(m[2]);
      if (d2 && t2) { iso = d2; time = t2; }
    }
  }
  let weekdayMismatch = null;
  const wm = s.toLowerCase().match(/^(?:am\s+)?(mo|di|mi|do|fr|sa|so)[a-zä]*\.?,?\s+\d/);
  if (iso && wm) {
    const typed = WD_PREFIX[wm[1]]; const actual = fromISODate(iso).getDay();
    if (typed !== actual) weekdayMismatch = { typed: WEEKDAYS[typed], actual: WEEKDAYS[actual] };
  }
  return { iso, time, weekdayMismatch };
}

/** „heute“, „morgen“, „in 12 Tagen“, „in 3 Wochen“, „vor 5 Tagen“ */
export function relativeDays(iso, today) {
  const a = fromISODate(today), b = fromISODate(iso);
  const n = Math.round((b - a) / 86400000);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  if (n < 0) return `vor ${-n} Tagen`;
  if (n < 21) return `in ${n} Tagen`;
  if (n < 70) return `in ${Math.round(n / 7)} Wochen`;
  return `in ${Math.round(n / 30.4)} Monaten`;
}

/** Kurze Liste der Daten: „4. Nov., 2. Dez., 6. Jan. …“ */
export function shortDates(list, max = 8) {
  const parts = list.slice(0, max).map(iso => formatDate(iso, 'weekday'));
  return parts.join(' · ') + (list.length > max ? ` · … (+${list.length - max})` : '');
}
