// =========================================================
// ical.js – iCalendar (.ics) erzeugen, Zeitzone Europe/Berlin
// buildICS(events) → String;  downloadICS(events, filename)
// =========================================================
import { downloadFile, stripHTML } from './ui.js';
import { eventCategory } from './store.js';

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const escText = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
function fold(line) {
  // Zeilen nach RFC 5545 auf 75 Oktette falten (vereinfacht: Zeichen)
  const out = []; let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
  out.push(s); return out.join('\r\n');
}
const d8 = iso => iso.replace(/-/g, '');
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function addHours(time, n) { const [h, m] = time.split(':').map(Number); const t = Math.min(23 * 60 + 59, h * 60 + m + n * 60); return `${String(Math.floor(t / 60)).padStart(2, '0')}${String(t % 60).padStart(2, '0')}00`; }

/** Termine (aus db 'events') → .ics-Text */
export function buildICS(events, { name = 'Kolpingsfamilie Ramsen' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kolpingsfamilie Ramsen//Prototyp//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(name)}`, 'X-WR-TIMEZONE:Europe/Berlin', ...VTIMEZONE];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@kolping-ramsen.de`, `DTSTAMP:${stamp}`);
    if (e.time) {
      lines.push(`DTSTART;TZID=Europe/Berlin:${d8(e.date)}T${e.time.replace(':', '')}00`);
      const endDate = e.endDate || e.date;
      lines.push(`DTEND;TZID=Europe/Berlin:${d8(endDate)}T${e.endTime ? e.endTime.replace(':', '') + '00' : addHours(e.time, 2)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d8(e.date)}`, `DTEND;VALUE=DATE:${d8(addDays(e.endDate || e.date, 1))}`);
    }
    lines.push(`SUMMARY:${escText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escText(e.location)}`);
    const desc = stripHTML(e.description || '');
    lines.push(`DESCRIPTION:${escText((desc ? desc + '\n\n' : '') + 'Kategorie: ' + eventCategory(e.category).label)}`);
    lines.push(`CATEGORIES:${escText(eventCategory(e.category).label)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
/** Termine als .ics-Datei herunterladen */
export function downloadICS(events, filename = 'kolping-ramsen-termine.ics', opts) {
  downloadFile(filename, buildICS(events, opts), 'text/calendar;charset=utf-8');
}
