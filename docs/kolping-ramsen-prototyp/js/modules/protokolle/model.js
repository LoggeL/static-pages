// =========================================================
// protokolle/model.js – Datenmodell der Protokolle
// Ein Protokoll speichert seinen Inhalt strukturiert in `data`
// (Kopfdaten, Anwesenheit, Tagesordnungspunkte mit Beschlüssen).
// `body` (HTML) wird daraus erzeugt – für Suche und Kompatibilität.
// =========================================================
import { db, uid, nowIso, folderPath, log } from '../../store.js';
import { esc, sanitizeHTML, formatDate, stripHTML } from '../../ui.js';
import { currentUser, userCan, can } from '../../auth.js';

export const KINDS = [
  { id: 'vorstand', label: 'Vorstandssitzung', icon: '🗂', text: 'Die regelmäßige Sitzung des Vorstands.',
    place: 'Pfarrheim, Gruppenraum', start: '19:30',
    tops: ['Begrüßung und Genehmigung des letzten Protokolls', 'Berichte aus den Bereichen', 'Termine und Veranstaltungen', 'Verschiedenes'] },
  { id: 'mitgliederversammlung', label: 'Mitgliederversammlung', icon: '👥', text: 'Jahreshauptversammlung mit Berichten, Entlastung und Wahlen.',
    place: 'Pfarrheim, großer Saal', start: '19:30',
    tops: ['Begrüßung und Feststellung der Beschlussfähigkeit', 'Geistliches Wort', 'Bericht des Leitungsteams', 'Kassenbericht',
      'Bericht der Kassenprüfer', 'Entlastung des Vorstands', 'Wahlen', 'Anträge', 'Verschiedenes'] },
  { id: 'sonstige', label: 'Besprechung', icon: '☕', text: 'Arbeitskreis, Planungstreffen oder Leitungsteam.',
    place: 'Pfarrheim', start: '19:00',
    tops: ['Begrüßung', 'Thema des Abends', 'Verschiedenes'] },
];
export const kind = id => KINDS.find(k => k.id === id) || KINDS[2];
export const kindLabel = id => kind(id).label;

/** Simulierte Mitschreiberin (frei erfunden, kein Benutzerkonto) */
export const PETRA = { id: 'sim-petra', name: 'Petra Vorstand', firstName: 'Petra', initials: 'PV', color: '#0f5f73', title: 'Stellvertretende Vorsitzende' };

const BOARD_PLACEHOLDERS = ['Petra Vorstand', 'Teamsprecher (Platzhalter)', 'Kasse (Platzhalter)', 'Vertretung Jugend (Platzhalter)',
  'Vertretung Senioren (Platzhalter)', 'Präses (Platzhalter)', 'Beisitz (Platzhalter)'];

export const STATUS = {
  present: { label: 'Anwesend', icon: '✓' },
  excused: { label: 'Entschuldigt', icon: '✉' },
  absent: { label: 'Fehlt', icon: '–' },
};

export const clone = o => JSON.parse(JSON.stringify(o));
const pid = () => uid('t');

/** Vorstands-Liste zum Ankreuzen: Benutzer mit Protokoll-Recht + Platzhalter für weitere Vorstandsmitglieder */
export function boardPeople() {
  const users = db.all('users').filter(u => u.active !== false && userCan(u, 'protocols.view'));
  return [
    ...users.map(u => ({ id: 'pp-' + u.id, name: u.name, userId: u.id, status: null })),
    ...BOARD_PLACEHOLDERS.map((n, i) => ({ id: 'pp-x' + i, name: n, status: null })),
  ];
}
/** Weitere Personen aus der Benutzerliste, die noch nicht in der Anwesenheitsliste stehen */
export function otherUsers(data) {
  return db.all('users').filter(u => u.active !== false && !data.people.some(p => p.userId === u.id || p.name === u.name));
}

export function newTop(title = '', body = '', decisions = []) {
  return { id: pid(), title, body, decisions: decisions.map(d => ({ id: pid(), yes: '', no: '', abstain: '', ...d })) };
}
export function newDecision(text = '') { return { id: pid(), text, yes: '', no: '', abstain: '' }; }

/** Leere Vorlage */
export function templateData(kindId, date, start) {
  const k = kind(kindId);
  const u = currentUser();
  const people = boardPeople();
  if (u) { const me = people.find(p => p.userId === u.id); if (me) me.status = 'present'; }
  return {
    kind: k.id, date, start: start || k.start, end: '', place: k.place,
    people, others: '',
    tops: k.tops.map(t => newTop(t)),
    nextDate: '', nextTime: '', nextNote: '',
    recorder: u ? u.name : '',
  };
}

/* ---------- Strukturierte Fassung der drei Beispiel-Protokolle ---------- */
function seedPeople(statusByIndex) {
  // Reihenfolge wie boardPeople(): Stefan, Klaus, dann die Platzhalter
  const fixed = [
    { id: 'pp-u-stefan', name: 'Stefan Beispiel', userId: 'u-stefan' },
    { id: 'pp-u-klaus', name: 'Klaus Muster', userId: 'u-klaus' },
    ...BOARD_PLACEHOLDERS.map((n, i) => ({ id: 'pp-x' + i, name: n })),
  ];
  return fixed.map((p, i) => ({ ...p, status: statusByIndex[i] || null }));
}
const T = (id, title, body, decisions = []) => ({ id, title, body, decisions });
const D = (id, text, yes = '', no = '', abstain = '') => ({ id, text, yes, no, abstain });

const SEED_DATA = {
  'pr-1': () => ({
    kind: 'vorstand', date: '2026-10-14', start: '19:30', end: '21:15', place: 'Pfarrheim, Gruppenraum',
    people: seedPeople(['present', 'present', 'present', 'present', 'present', 'present', 'excused', 'present', 'excused']),
    others: '',
    tops: [
      T('t-p1-1', 'Begrüßung und Genehmigung des letzten Protokolls',
        '<p>Der Teamsprecher begrüßt die Anwesenden und stellt die Beschlussfähigkeit fest. Das Protokoll vom 9. September wird ohne Änderungen genehmigt.</p>',
        [D('b-p1-1', 'Das Protokoll der Vorstandssitzung vom 9. September 2026 wird genehmigt.', '7', '0', '0')]),
      T('t-p1-2', 'Lieblings-Weinprobe am 7. November',
        '<p>Anmeldungen bisher: <strong>34</strong>. Brot und Käse besorgt das Leitungsteam. Der Saal wird am Freitagabend gestellt.</p>',
        [D('b-p1-2', 'Der Kostenbeitrag für die Weinprobe beträgt 5 € pro Person.', '7', '0', '0')]),
      T('t-p1-3', 'Neue Website',
        '<p>Der Prototyp für die neue Website wurde vorgestellt. Offene Fragen: Wer bekommt welche Rechte? Wer schreibt künftig die Neuigkeiten?</p>'),
      T('t-p1-4', 'Arbeitseinsatz auf der Kolpingwiese',
        '<p>Vor dem Winter müssen die Hecke geschnitten und die Pavillons eingelagert werden.</p>',
        [D('b-p1-4', 'Der Arbeitseinsatz findet am Samstag, 28. November, ab 9 Uhr statt.')]),
      T('t-p1-5', 'Verschiedenes', ''),
    ],
    nextDate: '2026-11-11', nextTime: '19:30', nextNote: 'Pfarrheim, Gruppenraum',
    recorder: 'Klaus Muster',
  }),
  'pr-2': () => ({
    kind: 'vorstand', date: '2026-09-09', start: '19:30', end: '21:40', place: 'Pfarrheim, Gruppenraum',
    people: seedPeople(['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'excused']),
    others: '',
    tops: [
      T('t-p2-1', 'Begrüßung und Genehmigung des letzten Protokolls', '<p>Begrüßung durch den Teamsprecher. Das Protokoll vom 8. Juli wird genehmigt.</p>'),
      T('t-p2-2', 'Rückblick Open-Air-Theater', '<p>Vier Vorstellungen, alle ausverkauft. Dank an die Theatergruppe und alle Helferinnen und Helfer.</p>'),
      T('t-p2-3', 'Herbstprogramm', '<p>Geplant sind Rosenkranzandacht (2.10.), Oktoberfest (17.10.), Herbstwanderung (24.10.) und die Lieblings-Weinprobe (7.11.).</p>'),
      T('t-p2-4', 'Anschaffungen und neue Website', '<p>Für die Kolpingwiese fehlen Unterstände bei Regen. Die alte Website ist schwer zu pflegen.</p>',
        [D('b-p2-1', 'Anschaffung von zwei Pavillons für die Kolpingwiese (bis 600 €).', '8', '0', '0'),
          D('b-p2-2', 'Für die neue Website wird ein Angebot für einen Prototyp eingeholt.', '7', '0', '1')]),
      T('t-p2-5', 'Verschiedenes', '<p>Keine weiteren Punkte.</p>'),
    ],
    nextDate: '2026-10-14', nextTime: '19:30', nextNote: '',
    recorder: 'Klaus Muster',
  }),
  'pr-3': () => ({
    kind: 'mitgliederversammlung', date: '2026-03-19', start: '20:00', end: '22:05', place: 'Pfarrheim, großer Saal',
    people: seedPeople(['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present']),
    others: '62 Mitglieder laut Anwesenheitsliste',
    tops: [
      T('t-p3-1', 'Bericht des Leitungsteams', '<p>Rückblick auf ein volles Jahr mit Prunksitzung, Theater, Zeltlager und 49 Neuaufnahmen beim Kolpinggedenktag.</p>'),
      T('t-p3-2', 'Kassenbericht und Bericht der Kassenprüfer', '<p>Die Kasse wurde geprüft und ohne Beanstandungen bestätigt.</p>'),
      T('t-p3-3', 'Entlastung des Vorstands', '<p>Die Kassenprüfer beantragen die Entlastung.</p>',
        [D('b-p3-1', 'Der Vorstand wird entlastet.', '53', '0', '9')]),
      T('t-p3-4', 'Mitgliedsbeiträge', '<p>Das Leitungsteam schlägt vor, die Beiträge nicht zu erhöhen.</p>',
        [D('b-p3-2', 'Die Mitgliedsbeiträge bleiben unverändert.', '60', '0', '2')]),
    ],
    nextDate: '', nextTime: '', nextNote: 'Nächste Mitgliederversammlung im Frühjahr 2027',
    recorder: 'Klaus Muster',
  }),
};
/** Früherer Zwischenstand von pr-1 (für „Diesen Stand wiederherstellen“ im Versionsverlauf) */
function pr1Early() {
  const d = SEED_DATA['pr-1']();
  d.end = '';
  d.tops = d.tops.filter(t => t.id !== 't-p1-4');
  d.tops.find(t => t.id === 't-p1-3').body = '<p>Der Prototyp für die neue Website wurde vorgestellt.</p>';
  d.tops.find(t => t.id === 't-p1-2').decisions = [];
  return d;
}

/** Aus altem HTML (ohne `data`) eine Struktur ableiten */
function deriveFromBody(p) {
  const doc = new DOMParser().parseFromString(`<body>${p.body || ''}</body>`, 'text/html');
  const tops = []; let cur = null; let mode = 'top';
  for (const n of Array.from(doc.body.children)) {
    if (n.tagName === 'H3') {
      const t = n.textContent.trim();
      if (/^beschl/i.test(t)) { mode = 'decisions'; continue; }
      mode = 'top';
      cur = newTop(t.replace(/^TOP\s*\d+\s*[–-]\s*/i, ''), '');
      tops.push(cur);
    } else if (mode === 'decisions' && /^(UL|OL)$/.test(n.tagName)) {
      const target = cur || (tops[0] = tops[0] || newTop('Beschlüsse'));
      for (const li of n.querySelectorAll('li')) target.decisions.push(newDecision(li.textContent.trim()));
    } else if (cur) {
      cur.body += n.outerHTML;
    }
  }
  const people = boardPeople();
  for (const name of p.attendees || []) {
    const hit = people.find(x => x.name === name);
    if (hit) hit.status = 'present';
  }
  return {
    kind: p.kind || 'vorstand', date: p.date || '', start: '', end: '', place: '',
    people, others: '', tops: tops.length ? tops : [newTop('Inhalt', p.body || '')],
    nextDate: '', nextTime: '', nextNote: '', recorder: '',
  };
}

/** Strukturierte Daten eines Protokolls (immer eine Kopie) */
export function getData(p) {
  if (p.data) return normalize(clone(p.data));
  if (SEED_DATA[p.id]) return normalize(SEED_DATA[p.id]());
  return normalize(deriveFromBody(p));
}
function normalize(d) {
  d.people = Array.isArray(d.people) ? d.people : [];
  d.tops = Array.isArray(d.tops) ? d.tops : [];
  for (const t of d.tops) { t.decisions = Array.isArray(t.decisions) ? t.decisions : []; t.body = t.body || ''; }
  for (const k of ['others', 'nextDate', 'nextTime', 'nextNote', 'recorder', 'start', 'end', 'place']) d[k] = d[k] || '';
  return d;
}

/** Versionen mit Daten (die Beispiel-Version von pr-1 bekommt ihren früheren Stand) */
export function versionsOf(p) {
  return (p.versions || []).map((v, i) => ({ ...v, index: i,
    data: v.data || (p.id === 'pr-1' && i === 0 && !v.data ? pr1Early() : null) }));
}

/* ---------- Abgeleitete Werte ---------- */
export const titleOf = d => `${kindLabel(d.kind)} ${d.date ? formatDate(d.date, 'short') : '(ohne Datum)'}`;
export const present = d => d.people.filter(p => p.status === 'present');
export const excused = d => d.people.filter(p => p.status === 'excused');

const num = v => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return isNaN(n) ? null : n; };
/** Abstimmungsergebnis als Text, z. B. „Ja 7 · Nein 0 · Enthaltung 0 – einstimmig angenommen“ */
export function voteResult(dec) {
  const y = num(dec.yes), n = num(dec.no), a = num(dec.abstain);
  if (y == null && n == null && a == null) return { text: 'Abstimmung noch nicht eingetragen', short: '', state: 'open' };
  const yy = y || 0, nn = n || 0, aa = a || 0;
  const parts = `Ja ${yy} · Nein ${nn} · Enthaltung ${aa}`;
  if (yy > nn) {
    const uni = nn === 0 && aa === 0;
    return { text: `${parts} – ${uni ? 'einstimmig angenommen' : 'angenommen'}`, short: uni ? 'einstimmig angenommen' : 'angenommen', state: 'ok' };
  }
  return { text: `${parts} – abgelehnt`, short: 'abgelehnt', state: 'no' };
}

/** HTML-Fassung (body) für Suche und ältere Ansichten – nur sanitizeHTML-Tags */
export function toBodyHTML(d) {
  const pres = present(d).map(p => p.name), exc = excused(d).map(p => p.name);
  let out = `<h2>${esc(kindLabel(d.kind))} am ${esc(d.date ? formatDate(d.date, 'medium') : '–')}</h2>`;
  out += `<p><strong>Ort:</strong> ${esc(d.place || '–')} · <strong>Beginn:</strong> ${esc(d.start ? d.start + ' Uhr' : '–')} · <strong>Ende:</strong> ${esc(d.end ? d.end + ' Uhr' : '–')}</p>`;
  out += `<p><strong>Anwesend:</strong> ${esc(pres.join(', ') || '–')}${d.others ? ' · ' + esc(d.others) : ''}</p>`;
  if (exc.length) out += `<p><strong>Entschuldigt:</strong> ${esc(exc.join(', '))}</p>`;
  out += `<p><strong>Protokoll:</strong> ${esc(d.recorder || '–')}</p>`;
  d.tops.forEach((t, i) => {
    out += `<h3>TOP ${i + 1} – ${esc(t.title || 'ohne Überschrift')}</h3>${sanitizeHTML(t.body || '')}`;
    if (t.decisions.length) out += `<ul>${t.decisions.map(dec => `<li><strong>Beschluss:</strong> ${esc(dec.text || '–')} (${esc(voteResult(dec).text)})</li>`).join('')}</ul>`;
  });
  if (d.nextDate || d.nextNote) out += `<h3>Nächste Sitzung</h3><p>${esc(nextText(d))}</p>`;
  return out;
}
export function nextText(d) {
  return [d.nextDate ? formatDate(d.nextDate, 'long') : '', d.nextTime ? d.nextTime + ' Uhr' : '', d.nextNote].filter(Boolean).join(', ');
}

/** Ist das Protokoll schon als PDF in der Ablage? → Datei oder null */
export function pdfFileOf(p) {
  if (p.pdfFileId) { const f = db.find('files', p.pdfFileId); if (f && !f.deletedAt) return f; }
  return db.findBy('files', f => f.protocolId === p.id && f.type === 'pdf') || null;
}
/** Ordner „Vorstand › Protokolle <Jahr>“ (legt ihn bei Bedarf an) */
export function yearFolder(year, { create = false } = {}) {
  const name = `Protokolle ${year}`;
  const board = db.find('folders', 'f-vorstand');
  let f = db.findBy('folders', x => x.name === name && (board ? x.parentId === board.id : true));
  if (!f && create && can('files.upload')) {
    const u = currentUser();
    f = db.insert('folders', { id: uid('f'), name, parentId: board ? board.id : null, visibility: board ? undefined : 'board',
      icon: board ? undefined : '🔒', createdBy: u ? u.id : null });
    log('folder.create', `Ordner „${name}“`, 'automatisch für Protokolle angelegt');
  }
  return f;
}
export const folderLabel = id => folderPath(id).map(f => f.name).join(' › ');

/** Ungefähre PDF-Größe (Text-PDF mit Logo) */
export function estimatePdfSize(d) {
  return 41000 + Math.round(stripHTML(toBodyHTML(d)).length * 1.6);
}

export function ts() { return nowIso(); }
