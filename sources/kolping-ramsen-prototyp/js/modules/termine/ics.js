// =========================================================
// modules/termine/ics.js – iCalendar (RFC 5545) mit VTIMEZONE Europe/Berlin
// Echte .ics-Dateien als Blob-Download: einzelne Termine, Reihen,
// ganzer Kalender. Abgesagte Termine → STATUS:CANCELLED (Abos
// streichen sie dann automatisch), Entwürfe werden nie exportiert.
// =========================================================
import { downloadFile, stripHTML, slugify } from '../../ui.js';
import { eventCategory } from '../../store.js';

export const VTIMEZONE_BERLIN = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'X-LIC-LOCATION:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** TEXT-Werte escapen (RFC 5545, 3.3.11) */
export function escText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
const enc = new TextEncoder();
/** Zeilen auf 75 Oktette falten – nach UTF-8-Bytes, ohne Umlaute zu zerschneiden */
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const parts = []; let cur = ''; let bytes = 0; let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { parts.push(cur); cur = ''; bytes = 0; limit = 74; } // Folgezeilen beginnen mit Leerzeichen
    cur += ch; bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const p2 = n => String(n).padStart(2, '0');
const d8 = iso => String(iso).slice(0, 10).replace(/-/g, '');
const t6 = t => String(t).replace(':', '').slice(0, 4) + '00';
/** Wanduhr-Arithmetik (unabhängig von Sommer-/Winterzeit des Rechners) */
function wallAdd(iso, time, minutes) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const [hh, mi] = String(time).split(':').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d, hh, mi) + minutes * 60000);
  return { date: `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`, time: `${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}` };
}
const dayAdd = (iso, n) => wallAdd(iso, '12:00', n * 1440).date;
/** Lokaler Zeitstempel ohne Zone ('2026-10-22T14:32:05') → UTC 'YYYYMMDDTHHMMSSZ' */
function utcStamp(local) {
  let d = local ? new Date(local) : new Date();
  if (isNaN(d)) d = new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Öffentliche Adresse des Termins (im Prototyp: diese Seite) */
export function eventUrl(e) {
  let base = 'https://kolping-ramsen.de/';
  try { base = location.href.split('#')[0]; } catch { /* egal */ }
  return `${base}#/termine/${e.id}`;
}

/** Start/Ende als iCal-Werte. Ohne Endzeit: 2 Stunden. Endzeit vor Beginn = über Mitternacht. */
export function eventTimes(e) {
  if (!e.time) {
    return { allDay: true, start: d8(e.date), end: d8(dayAdd(e.endDate && e.endDate > e.date ? e.endDate : e.date, 1)) };
  }
  const endDate = e.endDate && e.endDate > e.date ? e.endDate : e.date;
  let end;
  if (e.endTime) {
    end = { date: endDate, time: e.endTime };
    if (`${end.date}T${end.time}` <= `${e.date}T${e.time}`) end = wallAdd(endDate, e.endTime, 1440);
  } else {
    end = wallAdd(endDate, e.time, 120);
  }
  return { allDay: false, start: `${d8(e.date)}T${t6(e.time)}`, end: `${d8(end.date)}T${t6(end.time)}` };
}

/** Ein VEVENT als Zeilen-Array */
export function vevent(e, stamp = utcStamp()) {
  const cat = eventCategory(e.category);
  const t = eventTimes(e);
  const L = ['BEGIN:VEVENT', `UID:${e.id}@kolping-ramsen.de`, `DTSTAMP:${stamp}`];
  if (e.createdAt) L.push(`CREATED:${utcStamp(e.createdAt)}`);
  if (e.updatedAt) L.push(`LAST-MODIFIED:${utcStamp(e.updatedAt)}`);
  L.push(`SEQUENCE:${Number(e.sequence) || 0}`);
  if (t.allDay) L.push(`DTSTART;VALUE=DATE:${t.start}`, `DTEND;VALUE=DATE:${t.end}`, 'TRANSP:TRANSPARENT');
  else L.push(`DTSTART;TZID=Europe/Berlin:${t.start}`, `DTEND;TZID=Europe/Berlin:${t.end}`, 'TRANSP:OPAQUE');
  L.push(`SUMMARY:${escText((e.cancelled ? 'Abgesagt: ' : '') + e.title)}`);
  if (e.location) L.push(`LOCATION:${escText(e.location)}`);
  const desc = [
    e.cancelled ? `FÄLLT AUS${e.cancelReason ? ': ' + e.cancelReason : '.'}` : '',
    stripHTML(e.description || ''),
    e.recurrence && e.recurrence.label ? `Regelmäßig: ${e.recurrence.label}` : '',
    `Bereich: ${cat.label}`,
    `Mehr Infos: ${eventUrl(e)}`,
  ].filter(Boolean).join('\n\n');
  L.push(`DESCRIPTION:${escText(desc)}`);
  L.push(`URL:${eventUrl(e)}`);
  L.push(`CATEGORIES:${escText(cat.label)}`);
  L.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  L.push(`CLASS:${(e.visibility || 'public') === 'public' ? 'PUBLIC' : 'PRIVATE'}`);
  L.push('END:VEVENT');
  return L;
}

/** Ganzer Kalender als .ics-Text (CRLF, gefaltet) */
export function buildCalendar(events, { name = 'Kolpingsfamilie Ramsen', description = 'Termine der Kolpingsfamilie Ramsen' } = {}) {
  const stamp = utcStamp();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kolpingsfamilie Ramsen//Website-Prototyp//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(name)}`, `X-WR-CALDESC:${escText(description)}`, 'X-WR-TIMEZONE:Europe/Berlin',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', ...VTIMEZONE_BERLIN];
  for (const e of events) {
    if (!e || e.deletedAt || e.status === 'draft' || !e.date) continue;
    lines.push(...vevent(e, stamp));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Als Datei herunterladen (Blob). → Anzahl exportierter Termine */
export function downloadEventsICS(events, filename = 'kolping-ramsen-termine.ics', opts) {
  const list = events.filter(e => e && !e.deletedAt && e.status !== 'draft');
  const text = buildCalendar(list, opts);
  downloadFile(filename, new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  return list.length;
}
export const icsFilename = e => `${e.date}-${slugify(e.title)}.ics`;
