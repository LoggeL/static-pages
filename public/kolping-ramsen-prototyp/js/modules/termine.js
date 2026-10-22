// =========================================================
// modules/termine.js – Kalender-Verwaltung + iCal
//
// Routen (alle mit Recht site.events.edit):
//   #/admin/termine            Liste (?ansicht=monat, ?zeige=kommende|entwuerfe|abgesagt|vergangen|alle, ?kat=<bereich>)
//   #/admin/termine/neu        Termin eintragen (?datum=YYYY-MM-DD, ?von=<id> = kopieren, ?vorlage=<id>)
//   #/admin/termine/:id        Termin ändern (Autosave), absagen, kopieren, löschen, .ics (?neu=1 = Erfolgsmeldung)
// Öffentlich (überschreibt public.js, siehe termine/public-pages.js):
//   #/termine, #/termine/:id   + Absagen durchgestrichen, Reihen, iCal mit VTIMEZONE
//
// Datenfelder zusätzlich zu CONVENTIONS (alle optional, abwärtskompatibel):
//   cancelled, cancelReason, cancelledAt, cancelledBy   – Absage (bleibt öffentlich sichtbar, durchgestrichen)
//   seriesId, recurrence:{kind,label,until}             – Reihe; jede Wiederholung ist ein eigener Termin
//   sequence                                            – iCal-Versionszähler (steigt bei Datum/Zeit/Absage)
// =========================================================
import { registerRoute, navigate, rerender } from '../app.js';
import { db, log, uid, nowIso, eventCategory, eventCategories, mediaById, ACTION_LABELS, userName } from '../store.js';
import { can, currentUser, canSeeVisibility } from '../auth.js';
import { h, button, badge, toast, modal, field, autosaveIndicator, parseTime, formatDate, formatDateTime, relativeTime,
  toISODate, fromISODate, todayISO, MONTHS, WEEKDAYS, stripHTML, createEditor, pageHeader, emptyState, debounce, sendMail } from '../ui.js';
import { trashItem, mediaPicker, notice, registerHelp, forbiddenPage } from '../admin.js';
import * as R from './termine/recur.js';
import { downloadEventsICS, icsFilename } from './termine/ics.js';
import { publicEventRow, eventDetail, aboDialog, dateBlock, catTag, cancelBadge, seriesTag } from './termine/view.js';
import './termine/public-pages.js';

/** replaceChildren ohne „null“-Text für ausgelassene Teile */
const put = (target, ...kids) => target.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));

const PERM = 'site.events.edit';

Object.assign(ACTION_LABELS, {
  'event.cancel': 'hat Termin abgesagt',
  'event.uncancel': 'hat Absage zurückgenommen',
  'event.publish': 'hat Termin auf die Website gestellt',
  'event.unpublish': 'hat Termin von der Website genommen',
  'event.export': 'hat Termine als Kalenderdatei gespeichert',
});

/* ---------------------------------------------------------
   Zusätzliche Beispieldaten (einmalig): eine Reihe + eine Absage
   --------------------------------------------------------- */
(function seedExtras() {
  try {
    if (db.meta('termine.seed') === 1) return;
    const T = (d, hh = 9) => `${d}T${String(hh).padStart(2, '0')}:00:00`;
    const rec = { kind: 'monthly-nth', label: 'Jeden 1. Mittwoch im Monat', until: '2027-04-30' };
    const items = R.occurrences('2026-11-04', 'monthly-nth', '2027-04-30').map((d, i) => ({
      id: `e-sen-${i + 1}`, title: 'Seniorennachmittag der Junggebliebenen', date: d, endDate: null, time: '15:00', endTime: '17:30',
      location: 'Pfarrheim', category: 'verein', visibility: 'public',
      description: '<p>Kaffee, Kuchen und gute Gespräche – jeden ersten Mittwoch im Monat. Wer abgeholt werden möchte, meldet sich bitte vorher im Pfarrbüro.</p>',
      image: null, status: 'published', seriesId: 's-senioren', recurrence: rec, sequence: 0,
      createdBy: 'u-maria', createdAt: T('2026-10-01'), updatedAt: T('2026-10-01'),
    }));
    items.push({
      id: 'e-film', title: 'Filmabend im Pfarrheim', date: '2026-11-14', endDate: null, time: '19:30', endTime: null,
      location: 'Pfarrheim', category: 'jugend', visibility: 'public', description: '<p>Gemütlicher Kinoabend mit Popcorn für alle ab 12 Jahren.</p>',
      image: null, status: 'published', cancelled: true, cancelReason: 'Leider krankheitsbedingt abgesagt – ein Ersatztermin folgt.',
      cancelledAt: T('2026-10-20', 18), cancelledBy: 'u-maria', sequence: 1, createdBy: 'u-maria', createdAt: T('2026-09-20'), updatedAt: T('2026-10-20', 18),
    });
    db.seedIfMissing('events', items);
    db.meta('termine.seed', 1);
  } catch (err) { console.error('[termine] Beispieldaten', err); }
})();

/* ---------------------------------------------------------
   Hilfe
   --------------------------------------------------------- */
registerHelp('/admin/termine', { title: 'Termine', text: '<p>Alles, was hier steht, erscheint <strong>sofort</strong> auf der Website und in den Kalender-Abos der Mitglieder.</p>', steps: [
  'Oben auf „Termin eintragen“ tippen – oder in der Monatsansicht einen Tag antippen.',
  'Titel, Datum und Uhrzeit eintragen. Das Datum dürfen Sie tippen, wie Sie wollen: „3.11.“, „3. November“ oder „nächsten Samstag“. Darunter steht zur Kontrolle der Wochentag.',
  'Wiederholt sich der Termin (z. B. jeden 1. Montag)? Einfach die passende Wiederholung antippen.',
  'Bereich antippen, dann unten auf den grünen Knopf „Auf der Website zeigen“. Fertig.',
  'Fällt ein Termin aus? Termin öffnen → „Termin absagen“. Er bleibt durchgestrichen auf der Website stehen, damit niemand umsonst kommt.'] });
registerHelp('/admin/termine/neu', { title: 'Termin eintragen', steps: [
  'Von oben nach unten ausfüllen. Pflicht sind nur Titel, Datum und Uhrzeit (oder „Ganztägig“).',
  'Unter dem Datum steht zur Kontrolle der Wochentag – z. B. „= Dienstag, 3. November 2026“.',
  'Rechts (auf dem Tablet weiter unten) sehen Sie, wie der Termin auf der Website aussieht.',
  'Ihre Eingaben werden laufend gesichert. Wenn Sie die Seite verlassen, ist nichts verloren.',
  'Zum Schluss den grünen Knopf „Auf der Website zeigen“ antippen (oder „Nein, noch nicht“ wählen – dann wird es ein Entwurf).'] });

/* ---------------------------------------------------------
   Kleine Helfer
   --------------------------------------------------------- */
const sortAsc = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
const isVisible = e => !!e && !e.deletedAt && canSeeVisibility(e.visibility || 'public');
const label = e => `Termin „${e.title}“`;
const meId = () => (currentUser() || {}).id || null;
function mayEdit() {
  if (can(PERM)) return true;
  toast('Dafür fehlt Ihrem Konto das Recht „Termine eintragen und ändern“.', { type: 'error' });
  return false;
}
function adminEvents() { return db.all('events').filter(isVisible).sort(sortAsc); }
function seriesMembers(e) { return e && e.seriesId ? db.all('events').filter(x => x.seriesId === e.seriesId).sort(sortAsc) : (e ? [e] : []); }
function following(e) { return seriesMembers(e).filter(x => x.date >= e.date); }
const whenShort = e => `${formatDate(e.date, 'weekday')}${e.endDate && e.endDate !== e.date ? ' – ' + formatDate(e.endDate, 'weekday') : ''} · ${e.time ? e.time + (e.endTime ? '–' + e.endTime : '') + ' Uhr' : 'ganztägig'}`;
const sec = (num, title, ...kids) => {
  const id = uid('ts');
  return h('section', { class: 'termine-sec', 'aria-labelledby': id },
    h('h2', { class: 'termine-sec__title', id }, h('span', { class: 'termine-sec__num', 'aria-hidden': 'true' }, num), title), ...kids);
};
/** Auswahl-Knöpfe statt Dropdown. options() → [{value,label,sub,icon,color,disabled}] */
function choiceGroup({ label: groupLabel, options, get, set, cls = '' }) {
  const el = h('div', { class: `chips termine-choice ${cls}`, role: 'group', 'aria-label': groupLabel });
  const draw = () => put(el, ...options().map(o => h('button', {
    type: 'button', class: `chip termine-chip${o.color ? ' termine-chip--cat' : ''}`, 'aria-pressed': String(get() === o.value),
    style: o.color ? { '--c': o.color } : null, disabled: o.disabled ? true : null,
    onclick: () => { set(o.value); draw(); } },
  o.color ? h('span', { class: 'chip__dot', 'aria-hidden': 'true' }) : null,
  o.icon ? h('span', { class: 'termine-chip__icon', 'aria-hidden': 'true' }, o.icon) : null,
  h('span', { class: 'termine-chip__text' }, h('span', {}, o.label), o.sub ? h('small', {}, o.sub) : null))));
  draw();
  return { el, draw };
}
const LOCATIONS = ['Pfarrheim', 'Pfarrkirche', 'Kolpingwiese', 'Eistalhalle'];
function visOptions() {
  return [
    { value: 'public', icon: '🌐', label: 'Alle', sub: 'auch Besucher der Website' },
    { value: 'members', icon: '👥', label: 'Nur Mitglieder', sub: 'erst nach Anmeldung sichtbar' },
    ...(can('files.board') ? [{ value: 'board', icon: '🔒', label: 'Nur Vorstand', sub: 'interner Termin' }] : []),
  ];
}
const TEMPLATES = [
  { id: 'senioren', icon: '☕', label: 'Seniorennachmittag', s: { title: 'Seniorennachmittag', timeText: '15 Uhr', endTimeText: '17:30', location: 'Pfarrheim', category: 'verein',
    description: '<p>Kaffee, Kuchen und gute Gespräche. Alle Junggebliebenen sind herzlich willkommen!</p>' } },
  { id: 'andacht', icon: '🕯', label: 'Andacht / Gottesdienst', s: { title: 'Andacht', timeText: '18 Uhr', location: 'Pfarrkirche', category: 'glaube', description: '' } },
  { id: 'probe', icon: '🎺', label: 'Probe der Kapelle', s: { title: 'Probe der Kolpingskapelle', timeText: '19:30', endTimeText: '21:30', location: 'Pfarrheim', category: 'kapelle', visibility: 'members', description: '' } },
  { id: 'wanderung', icon: '🥾', label: 'Wanderung / Ausflug', s: { title: 'Wanderung', timeText: '9:30', location: 'Treffpunkt Pfarrheim', category: 'verein',
    description: '<p>Gemütliche Wanderung mit Einkehr. Bitte festes Schuhwerk mitbringen.</p>' } },
  { id: 'familie', icon: '🧒', label: 'Familiennachmittag', s: { title: 'Familiennachmittag', timeText: '14 Uhr', location: 'Pfarrheim', category: 'familie', description: '' } },
  { id: 'vorstand', icon: '🔒', label: 'Vorstandssitzung', board: true, s: { title: 'Vorstandssitzung', timeText: '19:30', location: 'Pfarrheim, Gruppenraum', category: 'vorstand', visibility: 'board',
    description: '<p>Tagesordnung siehe Ablage › Vorstand.</p>' } },
];
const FIELD_LABELS = { title: 'Titel', date: 'Datum', endDate: 'letzter Tag', time: 'Uhrzeit', endTime: 'Ende', location: 'Ort', category: 'Bereich',
  description: 'Beschreibung', image: 'Foto', visibility: 'Sichtbarkeit', status: 'Website' };

/* ---------------------------------------------------------
   Großer Kalender zum Antippen (Hilfe neben dem Datumsfeld)
   --------------------------------------------------------- */
function datePicker({ value, onPick }) {
  const base = value ? fromISODate(value) : new Date();
  let cur = new Date(base.getFullYear(), base.getMonth(), 1);
  const wrap = h('div', { class: 'termine-picker' });
  const today = todayISO();
  const evDays = new Map();
  for (const e of adminEvents()) { if (!evDays.has(e.date)) evDays.set(e.date, []); evDays.get(e.date).push(e); }
  let m = null;
  const draw = () => {
    const y = cur.getFullYear(), mo = cur.getMonth();
    const offset = (new Date(y, mo, 1).getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate();
    const prev = new Date(y, mo - 1, 1), next = new Date(y, mo + 1, 1);
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'termine-picker__empty', 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d++) {
      const iso = toISODate(new Date(y, mo, d, 12)); const evs = evDays.get(iso) || [];
      cells.push(h('button', { type: 'button', class: `termine-picker__day${iso === today ? ' is-today' : ''}${evs.length ? ' has-ev' : ''}`,
        'aria-pressed': String(iso === value), 'aria-label': formatDate(iso, 'long') + (evs.length ? ` – schon ${evs.length} Termin${evs.length > 1 ? 'e' : ''}` : ''),
        onclick: () => { m.close(); onPick(iso); } }, String(d), evs.length ? h('span', { class: 'termine-picker__dot', 'aria-hidden': 'true' }) : null));
    }
    put(wrap, 
      h('div', { class: 'termine-picker__head' },
        button({ label: MONTHS[prev.getMonth()], icon: '‹', onClick: () => { cur = prev; draw(); } }),
        h('h3', { 'aria-live': 'polite' }, `${MONTHS[mo]} ${y}`),
        button({ label: MONTHS[next.getMonth()], icon: '›', onClick: () => { cur = next; draw(); } })),
      h('div', { class: 'termine-picker__grid' },
        ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => h('span', { class: 'termine-picker__wd', 'aria-hidden': 'true' }, w)), cells),
      h('p', { class: 'muted termine-picker__legend' }, h('span', { class: 'termine-picker__dot', 'aria-hidden': 'true' }), ' = an diesem Tag steht schon ein Termin'));
  };
  draw();
  m = modal({ title: 'Datum auswählen', body: wrap });
  return m;
}

/* ---------------------------------------------------------
   Das Formular (für „eintragen“ und „ändern“)
   --------------------------------------------------------- */
function blankState() {
  return { title: '', dateText: '', date: null, timeText: '', time: null, endTimeText: '', endTime: null, allDay: false, multiDay: false,
    endDateText: '', endDate: null, location: 'Pfarrheim', category: 'verein', description: '', image: null, visibility: 'public', status: 'published',
    recur: 'none', untilChoice: '6m', untilText: '', until: null, scope: 'one' };
}
function stateFromEvent(e, { keepDate = true } = {}) {
  return { ...blankState(), title: e.title || '',
    dateText: keepDate && e.date ? formatDate(e.date, 'short') : '', date: keepDate ? e.date || null : null,
    timeText: e.time || '', time: e.time || null, endTimeText: e.endTime || '', endTime: e.endTime || null,
    allDay: !e.time, multiDay: keepDate && !!(e.endDate && e.endDate !== e.date),
    endDateText: keepDate && e.endDate ? formatDate(e.endDate, 'short') : '', endDate: keepDate ? e.endDate || null : null,
    location: e.location || '', category: e.category || 'verein', description: e.description || '', image: e.image || null,
    visibility: e.visibility || 'public', status: e.status || 'published' };
}

/**
 * eventForm({mode:'new'|'edit', state, event, onChange(key)})
 * → {el, preview, s, validate({show}), patch(), previewEvent(), dates(), focusFirstError(), setStatus(v)}
 */
function eventForm({ mode, state, event = null, onChange = () => {}, recurSlot = null }) {
  const s = state;
  const isSeries = !!(event && event.seriesId);
  const changed = (key) => { updatePreview(); onChange(key); };

  /* 1 – Was? */
  const fTitle = field({ label: 'Was findet statt?', name: 'title', value: s.title, required: true,
    hint: 'Kurz und klar, z. B. „Seniorennachmittag“ oder „Probe der Kolpingskapelle“.', attrs: { autocomplete: 'off', maxlength: '120' } });
  fTitle.input.addEventListener('input', () => { s.title = fTitle.value(); changed('title'); });

  /* 2 – Wann? */
  const fDate = field({ label: 'Datum', name: 'date', type: 'date-text', value: s.dateText, required: true,
    hint: 'Einfach tippen: „3.11.“, „3. November“ oder „nächsten Samstag“. Auch „3.11. 19 Uhr“ geht.', attrs: { autocomplete: 'off', enterkeyhint: 'next' } });
  const dateConfirm = h('div', { class: 'termine-confirm', id: uid('tc'), role: 'status', 'aria-live': 'polite' });
  fDate.input.after(dateConfirm);
  fDate.input.setAttribute('aria-describedby', `${fDate.input.getAttribute('aria-describedby') || ''} ${dateConfirm.id}`.trim());
  const dateTools = h('div', { class: 'termine-datetools' },
    button({ label: 'Im Kalender auswählen', icon: '📅', onClick: () => datePicker({ value: s.date, onPick: iso => setDateText(formatDate(iso, 'short')) }) }),
    h('div', { class: 'chips termine-quick', role: 'group', 'aria-label': 'Schnell-Auswahl Datum' },
      [['Heute', 'heute'], ['Morgen', 'morgen'], ['Nächsten Samstag', 'nächsten samstag'], ['Nächsten Sonntag', 'nächsten sonntag']].map(([l, v]) =>
        h('button', { type: 'button', class: 'chip termine-chip termine-chip--small', onclick: () => { const iso = R.parseDateInput(v).iso; if (iso) setDateText(formatDate(iso, 'short')); } }, l))));

  const fTime = field({ label: 'Uhrzeit (Beginn)', name: 'time', type: 'time-text', value: s.timeText,
    hint: 'z. B. „19“, „19 Uhr“, „19:30“ oder „halb 8 abends“.', attrs: { autocomplete: 'off', inputmode: 'text' } });
  const timeConfirm = h('div', { class: 'termine-confirm', role: 'status', 'aria-live': 'polite' }); fTime.input.after(timeConfirm);
  const fEnd = field({ label: 'Ende', name: 'endTime', type: 'time-text', value: s.endTimeText, optional: true,
    hint: 'Wenn bekannt, z. B. „22 Uhr“.', attrs: { autocomplete: 'off' } });
  const endConfirm = h('div', { class: 'termine-confirm', role: 'status', 'aria-live': 'polite' }); fEnd.input.after(endConfirm);
  const allDayBox = h('input', { type: 'checkbox', checked: s.allDay ? true : null });
  const multiBox = h('input', { type: 'checkbox', checked: s.multiDay ? true : null });
  const fEndDate = field({ label: 'Letzter Tag', name: 'endDate', type: 'date-text', value: s.endDateText, hint: 'Bis wann geht es? z. B. „27.12.“', attrs: { autocomplete: 'off' } });
  const endDateConfirm = h('div', { class: 'termine-confirm', role: 'status', 'aria-live': 'polite' }); fEndDate.input.after(endDateConfirm);
  const endDateWrap = h('div', { class: 'termine-enddate', hidden: s.multiDay ? null : true }, fEndDate.el);
  const timeRow = h('div', { class: 'form-grid form-grid--2 termine-timerow' }, fTime.el, fEnd.el);

  function setDateText(t) { fDate.setValue(t); onDateInput(); fDate.input.focus(); }
  function onDateInput({ blur = false } = {}) {
    const txt = fDate.value(); s.dateText = txt;
    const r = R.parseDateInput(txt);
    s.date = r.iso;
    if (r.iso && r.time && !fTime.value()) { fTime.setValue(r.time); onTimeInput(); }
    renderDateConfirm(r, blur);
    s.recur = R.fixKind(s.recur, s.date);
    drawRecur();
    changed('date');
  }
  function renderDateConfirm(r, blur) {
    const txt = fDate.value();
    dateConfirm.replaceChildren();
    if (!txt) return;
    if (!r.iso) {
      if (blur) fDate.setError('Dieses Datum verstehe ich nicht. Bitte so: „3.11.“, „3.11.2026“ oder „3. November“.');
      else dateConfirm.append(h('span', { class: 'termine-confirm__wait' }, '… tippen Sie weiter'));
      return;
    }
    fDate.clearError();
    const today = todayISO();
    dateConfirm.append(h('span', { class: 'termine-confirm__ok' }, '= ', formatDate(r.iso, 'long')),
      h('span', { class: 'termine-confirm__rel' }, ` (${R.relativeDays(r.iso, today)})`));
    if (r.time) dateConfirm.append(h('span', { class: 'termine-confirm__note' }, `Uhrzeit ${r.time} Uhr übernommen.`));
    if (r.weekdayMismatch) dateConfirm.append(h('span', { class: 'termine-confirm__warn' }, `⚠ Achtung: Das ist ein ${r.weekdayMismatch.actual}, kein ${r.weekdayMismatch.typed}.`));
    if (r.iso < today) dateConfirm.append(h('span', { class: 'termine-confirm__warn' }, '⚠ Dieses Datum liegt in der Vergangenheit.'));
    const same = adminEvents().filter(x => x.date === r.iso && (!event || x.id !== event.id) && !x.cancelled);
    if (same.length) dateConfirm.append(h('span', { class: 'termine-confirm__info' }, `ℹ An diesem Tag steht schon: ${same.map(x => `${x.title}${x.time ? ' (' + x.time + ' Uhr)' : ''}`).join(', ')}`));
  }
  function timeFeedback(f, confirmEl, blur, { start = false } = {}) {
    const txt = f.value(); confirmEl.replaceChildren();
    if (!txt) { f.clearError(); return null; }
    const t = parseTime(txt);
    if (!t) { if (blur) f.setError('Diese Uhrzeit verstehe ich nicht. Bitte so: „19 Uhr“ oder „19:30“.'); return null; }
    f.clearError();
    confirmEl.append(h('span', { class: 'termine-confirm__ok' }, `= ${t} Uhr`));
    if (!start && s.time && t <= s.time && !s.multiDay) confirmEl.append(h('span', { class: 'termine-confirm__note' }, 'Endet am nächsten Tag (nach Mitternacht).'));
    return t;
  }
  function onTimeInput({ blur = false } = {}) {
    s.timeText = fTime.value(); s.time = timeFeedback(fTime, timeConfirm, blur, { start: true });
    if (s.time && s.allDay) { s.allDay = false; allDayBox.checked = false; syncAllDay(); }
    changed('time');
  }
  function onEndInput({ blur = false } = {}) { s.endTimeText = fEnd.value(); s.endTime = timeFeedback(fEnd, endConfirm, blur); changed('endTime'); }
  function onEndDateInput({ blur = false } = {}) {
    s.endDateText = fEndDate.value(); const r = R.parseDateInput(s.endDateText); s.endDate = r.iso; endDateConfirm.replaceChildren();
    if (!s.endDateText) { /* Fehler erst beim Speichern */ }
    else if (!r.iso) { if (blur) fEndDate.setError('Dieses Datum verstehe ich nicht. Bitte so: „27.12.“'); }
    else if (s.date && r.iso <= s.date) { if (blur) fEndDate.setError('Der letzte Tag muss nach dem ersten Tag liegen.'); }
    else { fEndDate.clearError(); endDateConfirm.append(h('span', { class: 'termine-confirm__ok' }, '= ', formatDate(r.iso, 'long'))); }
    changed('endDate');
  }
  function syncAllDay() {
    timeRow.classList.toggle('termine-is-off', s.allDay);
    fTime.input.disabled = s.allDay; fEnd.input.disabled = s.allDay;
    if (s.allDay) { fTime.clearError(); fEnd.clearError(); }
  }
  fDate.input.addEventListener('input', () => onDateInput());
  fDate.input.addEventListener('blur', () => onDateInput({ blur: true }));
  fTime.input.addEventListener('input', () => onTimeInput());
  fTime.input.addEventListener('blur', () => onTimeInput({ blur: true }));
  fEnd.input.addEventListener('input', () => onEndInput());
  fEnd.input.addEventListener('blur', () => onEndInput({ blur: true }));
  fEndDate.input.addEventListener('input', () => onEndDateInput());
  fEndDate.input.addEventListener('blur', () => onEndDateInput({ blur: true }));
  allDayBox.addEventListener('change', () => { s.allDay = allDayBox.checked; syncAllDay(); changed('time'); });
  multiBox.addEventListener('change', () => { s.multiDay = multiBox.checked; endDateWrap.hidden = !s.multiDay; if (s.multiDay) fEndDate.input.focus(); changed('endDate'); });

  /* 3 – Wiederholen */
  const recurWrap = h('div', { class: 'termine-recur' });
  const recurChoice = choiceGroup({ label: 'Wie oft findet der Termin statt?', cls: 'termine-choice--recur',
    options: () => R.kindsFor(s.date).map(k => ({ value: k, label: R.kindLabel(k, s.date), icon: k === 'none' ? '1×' : '🔁' })),
    get: () => s.recur, set: v => { s.recur = v; if (v !== 'none' && !s._untilTouched) s.untilChoice = R.defaultUntil(v); drawRecur(); changed('recur'); } });
  const untilChoice = choiceGroup({ label: 'Wie lange wiederholen?', options: () => R.UNTIL_CHOICES.map(c => ({ value: c.id, label: c.label })),
    get: () => s.untilChoice, set: v => { s.untilChoice = v; s._untilTouched = true; drawRecur(); changed('recur'); if (v === 'date') fUntil.input.focus(); } });
  const fUntil = field({ label: 'Bis wann?', type: 'date-text', value: s.untilText, hint: 'z. B. „30.6.2027“ oder „30. Juni 2027“.', attrs: { autocomplete: 'off' } });
  fUntil.input.addEventListener('input', () => { s.untilText = fUntil.value(); drawRecurPreview(); changed('recur'); });
  fUntil.input.addEventListener('blur', () => { if (s.untilChoice === 'date' && s.untilText && !R.parseDateInput(s.untilText).iso) fUntil.setError('Dieses Datum verstehe ich nicht. Bitte so: „30.6.2027“.'); });
  const recurPreview = h('div', { class: 'termine-recur__preview', role: 'status', 'aria-live': 'polite' });
  const untilWrap = h('div', { class: 'termine-recur__until' }, h('p', { class: 'termine-sub' }, 'Wie lange?'), untilChoice.el, h('div', { class: 'termine-until-date' }, fUntil.el), recurPreview);
  function recurDates() {
    if (!s.date || s.recur === 'none') return s.date ? [s.date] : [];
    const customIso = s.untilChoice === 'date' ? R.parseDateInput(s.untilText).iso : null;
    s.until = R.untilFor(s.date, s.untilChoice, customIso);
    return R.occurrences(s.date, s.recur, s.until, 60);
  }
  function drawRecurPreview() {
    recurPreview.replaceChildren();
    if (s.recur === 'none') return;
    if (!s.date) { recurPreview.append(h('p', { class: 'muted' }, 'Tragen Sie oben zuerst das Datum ein.')); return; }
    const list = recurDates();
    if (s.untilChoice === 'date' && !s.until) { recurPreview.append(h('p', { class: 'muted' }, 'Bitte tragen Sie ein, bis wann der Termin wiederholt wird.')); return; }
    recurPreview.append(
      h('p', { class: 'termine-recur__count' }, h('strong', {}, `Das ergibt ${list.length} Termin${list.length === 1 ? '' : 'e'}`), s.until ? ` bis ${formatDate(s.until, 'medium')}:` : ':'),
      h('p', { class: 'termine-recur__dates' }, R.shortDates(list, 10)),
      list.length >= 60 ? h('p', { class: 'muted' }, 'Höchstens 60 Termine auf einmal – später können Sie die Reihe verlängern.') : null);
  }
  function drawRecur() {
    recurChoice.draw();
    untilWrap.hidden = s.recur === 'none';
    untilChoice.draw();
    fUntil.el.parentElement && (fUntil.el.parentElement.hidden = s.untilChoice !== 'date');
    drawRecurPreview();
  }
  recurWrap.append(h('p', { class: 'termine-sub' }, 'Wie oft findet der Termin statt?'), recurChoice.el, untilWrap);

  /* Reihe (beim Ändern) */
  let scopeBox = null;
  if (isSeries) {
    const members = seriesMembers(event); const fol = following(event);
    const scopeChoice = choiceGroup({ label: 'Für welche Termine gilt die Änderung?',
      options: () => [
        { value: 'one', label: 'Nur dieser Termin', sub: formatDate(event.date, 'weekday') },
        ...(fol.length > 1 ? [{ value: 'following', label: `Dieser und alle folgenden`, sub: `${fol.length} Termine (Datum bleibt je Termin)` }] : []),
      ],
      get: () => s.scope, set: v => { s.scope = v; onChange('scope'); } });
    scopeBox = h('div', { class: 'termine-seriesbox' },
      h('p', {}, h('span', { 'aria-hidden': 'true' }, '🔁 '), 'Dieser Termin gehört zu einer Reihe: ', h('strong', {}, (event.recurrence && event.recurrence.label) || 'regelmäßig'),
        ` – ${members.length} Termine, ${formatDate(members[0].date, 'dayMonth')} bis ${formatDate(members[members.length - 1].date, 'medium')}.`),
      h('p', { class: 'termine-sub' }, 'Änderungen gelten für:'), scopeChoice.el);
  }

  /* 4 – Wo? */
  const fLoc = field({ label: 'Wo?', name: 'location', value: s.location, optional: true, hint: 'Ort oder Treffpunkt. Häufige Orte einfach unten antippen.', attrs: { autocomplete: 'off' } });
  fLoc.input.addEventListener('input', () => { s.location = fLoc.value(); drawLocChips(); changed('location'); });
  const locChips = h('div', { class: 'chips termine-quick', role: 'group', 'aria-label': 'Häufige Orte' });
  const drawLocChips = () => put(locChips, ...LOCATIONS.map(l => h('button', { type: 'button', class: 'chip termine-chip termine-chip--small', 'aria-pressed': String(s.location === l),
    onclick: () => { fLoc.setValue(l); s.location = l; drawLocChips(); changed('location'); } }, '📍 ', l)));
  drawLocChips();

  /* 5 – Bereich */
  const catChoice = choiceGroup({ label: 'Bereich', cls: 'termine-choice--cats',
    options: () => eventCategories().filter(c => c.id !== 'vorstand' || can('files.board')).map(c => ({ value: c.id, label: c.label, color: c.color })),
    get: () => s.category, set: v => {
      s.category = v;
      if (v === 'vorstand' && s.visibility !== 'board' && can('files.board')) { s.visibility = 'board'; visChoice.draw(); toast('Vorstands-Termine sind automatisch „🔒 Nur Vorstand“.', { type: 'info' }); }
      changed('category');
    } });

  /* 6 – Beschreibung */
  const editorBox = h('div', { class: 'termine-editor' });
  const editor = createEditor(editorBox, { value: s.description, toolbar: ['bold', 'list', 'link', 'undo'], label: 'Beschreibung',
    placeholder: 'Was erwartet die Besucher? Muss man etwas mitbringen? Kostet es etwas?',
    onChange: (v) => { s.description = v; changed('description'); } });

  /* 7 – Foto */
  const photoBox = h('div', { class: 'termine-photo' });
  const drawPhoto = () => {
    const m = s.image ? mediaById(s.image) : null;
    put(photoBox, 
      m ? h('img', { src: m.thumb || m.src, alt: m.alt || '', class: 'termine-photo__img' }) : h('div', { class: 'termine-photo__none' }, 'Kein Foto – auf der Website steht dann groß das Datum.'),
      h('div', { class: 'cluster' },
        button({ label: m ? 'Anderes Foto' : 'Foto auswählen', icon: '🖼', onClick: () => mediaPicker({ title: 'Foto für den Termin', onPick: (x) => { s.image = x.id; drawPhoto(); changed('image'); } }) }),
        m ? button({ label: 'Foto entfernen', icon: '✕', variant: 'ghost', onClick: () => { s.image = null; drawPhoto(); changed('image'); } }) : null));
  };
  drawPhoto();

  /* 8 – Sichtbarkeit */
  const visChoice = choiceGroup({ label: 'Wer darf den Termin sehen?', cls: 'termine-choice--vis', options: visOptions,
    get: () => s.visibility, set: v => { s.visibility = v; changed('visibility'); } });
  const statusChoice = choiceGroup({ label: 'Auf der Website zeigen?', cls: 'termine-choice--status',
    options: () => [{ value: 'published', icon: '✓', label: 'Ja, zeigen' }, { value: 'draft', icon: '✎', label: 'Nein, noch nicht', sub: 'als Entwurf aufheben' }],
    get: () => s.status, set: v => { s.status = v; changed('status'); } });

  /* Vorschau */
  const previewSlot = h('div', { class: 'termine-preview__slot' });
  const preview = h('aside', { class: 'termine-preview', 'aria-label': 'Vorschau' },
    h('h2', { class: 'termine-preview__title' }, '👁 So sieht es auf der Website aus'),
    previewSlot,
    button({ label: 'Ganze Seite ansehen', icon: '🔍', block: true, onClick: () => {
      modal({ title: 'Vorschau: So sieht es auf der Website aus', wide: true, body: h('div', { class: 'termine-preview-modal' }, eventDetail(previewEvent(), { preview: true })),
        actions: [{ label: 'Zurück zum Formular', icon: '←', variant: 'primary' }] });
    } }),
  );
  function previewEvent() {
    const p = patch();
    const base = event || { id: 'vorschau', createdAt: nowIso() };
    const ev = { ...base, ...p, title: p.title || 'Titel fehlt noch', date: p.date || todayISO() };
    if (!event && s.recur !== 'none' && s.date) { ev.seriesId = 'vorschau'; ev.recurrence = { label: R.kindLabel(s.recur, s.date) }; }
    return ev;
  }
  function updatePreview() {
    const ev = previewEvent();
    const note = [];
    if (ev.status === 'draft') note.push('✎ Entwurf: Besucher sehen den Termin noch nicht.');
    if (ev.visibility === 'members') note.push('👥 Nur angemeldete Mitglieder sehen diesen Termin.');
    if (ev.visibility === 'board') note.push('🔒 Nur Vorstand und Administrator sehen diesen Termin.');
    put(previewSlot, publicEventRow(ev, { linkable: false }), ...note.map(n => h('p', { class: 'termine-preview__hint' }, n)));
  }

  /* Zusammenbauen */
  const el = h('div', { class: 'termine-form' },
    sec('1', 'Was?', fTitle.el),
    sec('2', 'Wann?', fDate.el, dateTools,
      h('label', { class: 'check termine-check' }, allDayBox, h('span', {}, 'Ganztägig – ohne Uhrzeit')),
      timeRow,
      h('label', { class: 'check termine-check' }, multiBox, h('span', {}, 'Geht über mehrere Tage (z. B. Theater am 26. und 27.12.)')),
      endDateWrap),
    isSeries ? sec('3', 'Regelmäßiger Termin', scopeBox) : recurSlot ? sec('3', 'Wiederholen?', recurSlot) : sec('3', 'Wiederholen?', recurWrap),
    sec('4', 'Wo?', fLoc.el, locChips),
    sec('5', 'Bereich', h('p', { class: 'termine-sub' }, 'Das farbige Schild auf der Website und der Filter „nach Bereich“.'), catChoice.el),
    sec('6', 'Beschreibung', h('p', { class: 'termine-sub' }, 'Freiwillig – ein, zwei Sätze reichen.'), editorBox),
    sec('7', 'Foto', h('p', { class: 'termine-sub' }, 'Freiwillig. Es werden nur Fotos der Website angeboten.'), photoBox),
    sec('8', 'Wer sieht den Termin?', visChoice.el, h('p', { class: 'termine-sub' }, 'Auf der Website zeigen?'), statusChoice.el));

  // Anfangszustand
  syncAllDay();
  if (s.dateText) renderDateConfirm(R.parseDateInput(s.dateText), false);
  if (s.timeText) s.time = timeFeedback(fTime, timeConfirm, false, { start: true });
  if (s.endTimeText) s.endTime = timeFeedback(fEnd, endConfirm, false);
  if (s.endDateText) { const r = R.parseDateInput(s.endDateText); s.endDate = r.iso; if (r.iso) endDateConfirm.append(h('span', { class: 'termine-confirm__ok' }, '= ', formatDate(r.iso, 'long'))); }
  if (!isSeries) drawRecur();
  updatePreview();

  function validate({ show = true } = {}) {
    const errs = [];
    const bad = (f, msg) => { errs.push(f); if (show) f.setError(msg); };
    if (!s.title) bad(fTitle, 'Bitte einen Titel eintragen, z. B. „Seniorennachmittag“.');
    if (!s.dateText) bad(fDate, 'Bitte ein Datum eintragen, z. B. „3.11.“ oder „3. November“.');
    else if (!s.date) bad(fDate, 'Dieses Datum verstehe ich nicht. Bitte so: „3.11.“, „3.11.2026“ oder „3. November“.');
    if (!s.allDay) {
      if (!s.timeText) bad(fTime, 'Bitte eine Uhrzeit eintragen – oder oben „Ganztägig“ ankreuzen.');
      else if (!s.time) bad(fTime, 'Diese Uhrzeit verstehe ich nicht. Bitte so: „19 Uhr“ oder „19:30“.');
      if (s.endTimeText && !s.endTime) bad(fEnd, 'Diese Uhrzeit verstehe ich nicht. Bitte so: „22 Uhr“.');
    }
    if (s.multiDay) {
      if (!s.endDate) bad(fEndDate, 'Bitte den letzten Tag eintragen – oder das Häkchen „mehrere Tage“ wegnehmen.');
      else if (s.date && s.endDate <= s.date) bad(fEndDate, 'Der letzte Tag muss nach dem ersten Tag liegen.');
    }
    if (!isSeries && s.recur !== 'none' && s.untilChoice === 'date' && !R.parseDateInput(s.untilText).iso) bad(fUntil, 'Bitte eintragen, bis wann wiederholt wird, z. B. „30.6.2027“.');
    return errs;
  }
  function patch() {
    return { title: s.title, date: s.date, endDate: s.multiDay && s.endDate && s.date && s.endDate > s.date ? s.endDate : null,
      time: s.allDay ? null : s.time, endTime: s.allDay ? null : (s.endTime || null), location: s.location, category: s.category,
      description: s.description, image: s.image, visibility: s.visibility, status: s.status };
  }
  return {
    el, preview, s, validate, patch, previewEvent, dates: recurDates, updatePreview,
    focusFirstError(errs) { const f = errs[0]; if (f) { f.input.focus(); f.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } },
    setStatus(v) { s.status = v; statusChoice.draw(); changed('status'); },
    applyTemplate(t) {
      const x = t.s;
      if (x.title != null) { fTitle.setValue(x.title); s.title = x.title; }
      if (x.timeText != null) { fTime.setValue(x.timeText); s.allDay = false; allDayBox.checked = false; syncAllDay(); onTimeInput(); }
      fEnd.setValue(x.endTimeText || ''); onEndInput();
      if (x.location != null) { fLoc.setValue(x.location); s.location = x.location; drawLocChips(); }
      if (x.category) { s.category = x.category; catChoice.draw(); }
      if (x.visibility && visOptions().some(o => o.value === x.visibility)) { s.visibility = x.visibility; visChoice.draw(); }
      else { s.visibility = 'public'; visChoice.draw(); }
      if (x.description != null) { editor.setHTML(x.description); s.description = x.description; }
      changed('template');
    },
    destroy() { try { editor.destroy(); } catch { /* egal */ } },
  };
}

/* ---------------------------------------------------------
   #/admin/termine/neu
   --------------------------------------------------------- */
function renderNew(ctx) {
  const { el, query } = ctx;
  const u = currentUser();
  const draftKey = `termine.entwurf.${u ? u.id : 'x'}`;
  let state = blankState(); let restored = null; let dupOf = null;
  if (query.von) {
    const src = db.find('events', query.von);
    if (src && isVisible(src)) { dupOf = src; state = { ...stateFromEvent(src, { keepDate: false }), status: src.status }; state.title = src.title; }
  } else if (query.datum && /^\d{4}-\d{2}-\d{2}$/.test(query.datum)) {
    state.dateText = formatDate(query.datum, 'short'); state.date = query.datum;
  } else {
    const d = db.meta(draftKey);
    if (d && d.state && (d.state.title || d.state.dateText)) { state = { ...blankState(), ...d.state }; restored = d; }
  }
  const indicator = autosaveIndicator();
  indicator.idle('Noch nichts eingetragen');
  let pending = false, done = false;
  const saveDraft = debounce(() => {
    pending = false; if (done) return;
    const { _untilTouched, ...plain } = form.s;
    db.meta(draftKey, { state: { ...plain, _untilTouched }, savedAt: nowIso() });
    indicator.saved(new Date());
  }, 700);
  const primary = button({ label: 'Termin speichern', icon: '✓', variant: 'ok', size: 'lg', onClick: () => save() });
  const syncPrimary = () => {
    const n = form.s.recur !== 'none' && form.s.date ? form.dates().length : 1;
    const lbl = form.s.status === 'draft' ? (n > 1 ? `${n} Termine als Entwurf speichern` : 'Als Entwurf speichern') : (n > 1 ? `${n} Termine auf der Website zeigen` : 'Auf der Website zeigen');
    primary.querySelector('.btn__label').textContent = lbl;
    primary.className = `btn btn--lg ${form.s.status === 'draft' ? 'btn--primary' : 'btn--ok'}`;
  };
  const form = eventForm({ mode: 'new', state, onChange: (key) => {
    window.__kolpingDirty = false; // wird ohnehin zwischengespeichert
    pending = true; indicator.saving(); saveDraft(); syncPrimary();
  } });

  function discard() {
    const before = db.meta(draftKey);
    done = true; saveDraft.cancel(); db.meta(draftKey, null);
    navigate('#/admin/termine');
    if (before && before.state && (before.state.title || before.state.dateText)) {
      toast('Angefangener Termin verworfen.', { undo: () => { db.meta(draftKey, before); navigate('#/admin/termine/neu'); } });
    }
  }
  function save() {
    if (!mayEdit()) return;
    const errs = form.validate({ show: true });
    if (errs.length) { toast('Bitte die rot markierten Felder prüfen.', { type: 'error' }); form.focusFirstError(errs); return; }
    const p = form.patch();
    if (p.visibility === 'board' && !can('files.board')) p.visibility = 'members';
    const dates = form.s.recur !== 'none' ? form.dates() : [p.date];
    const seriesId = dates.length > 1 ? uid('s') : null;
    const rec = seriesId ? { kind: form.s.recur, label: R.kindLabel(form.s.recur, p.date), until: form.s.until } : null;
    const span = p.endDate ? Math.round((fromISODate(p.endDate) - fromISODate(p.date)) / 86400000) : 0;
    const created = dates.map((d, i) => db.insert('events', {
      ...p, id: uid('e'), date: d, endDate: span ? toISODate(new Date(fromISODate(d).getTime() + span * 86400000)) : null,
      seriesId, recurrence: rec, sequence: 0, createdBy: meId(),
    }));
    const where = p.status === 'draft' ? 'als Entwurf' : (p.visibility === 'public' ? 'auf der Website' : `sichtbar: ${p.visibility === 'members' ? 'nur Mitglieder' : 'nur Vorstand'}`);
    log('event.create', `Termin „${p.title}“`, seriesId ? `Reihe „${rec.label}“, ${created.length} Termine ab ${formatDate(p.date, 'short')} · ${where}` : `${formatDate(p.date, 'short')}${p.time ? ', ' + p.time + ' Uhr' : ''} · ${where}`
      + (dupOf ? ` · Kopie von „${dupOf.title}“` : ''));
    done = true; saveDraft.cancel(); db.meta(draftKey, null); window.__kolpingDirty = false;
    const ids = created.map(x => x.id);
    toast(created.length > 1 ? `${created.length} Termine gespeichert.` : 'Termin gespeichert.', { undo: () => {
      const by = meId(); ids.forEach(id => db.remove('events', id, { by }));
      log('event.delete', `Termin „${p.title}“`, 'Eintragen rückgängig gemacht – im Papierkorb'); rerender();
    } });
    navigate(`#/admin/termine/${created[0].id}?neu=${created.length}`);
  }

  const templates = !dupOf ? h('div', { class: 'termine-templates' },
    h('p', { class: 'termine-sub' }, h('strong', {}, 'Schneller mit einer Vorlage'), ' (freiwillig) – füllt Titel, Uhrzeit, Ort und Bereich vor:'),
    h('div', { class: 'chips' }, TEMPLATES.filter(t => !t.board || can('files.board')).map(t => h('button', { type: 'button', class: 'chip termine-chip',
      onclick: () => { form.applyTemplate(t); toast(`Vorlage „${t.label}“ eingesetzt – bitte noch das Datum eintragen.`, { type: 'info' }); } },
    h('span', { 'aria-hidden': 'true' }, t.icon), ' ', t.label)))) : null;

  put(el, h('div', { class: 'admin-page termine-page' },
    pageHeader({ title: dupOf ? 'Termin kopieren' : 'Termin eintragen', back: { href: '#/admin/termine', label: 'Zurück zu allen Terminen' },
      intro: 'Von oben nach unten ausfüllen. Pflicht sind nur Titel, Datum und Uhrzeit.' }),
    restored ? notice(h('div', { class: 'termine-notice-row' },
      h('span', {}, h('strong', {}, 'Ihr angefangener Termin ist noch da'), ` („${restored.state.title || 'ohne Titel'}“, zuletzt ${relativeTime(restored.savedAt)}).`),
      button({ label: 'Neu anfangen', icon: '↺', variant: 'ghost', onClick: () => { done = true; saveDraft.cancel(); db.meta(draftKey, null); navigate('#/admin/termine/neu', { replace: true }); } })), 'calm', '📝') : null,
    dupOf ? notice(h('span', {}, 'Kopie von „', h('strong', {}, dupOf.title), `“ (${formatDate(dupOf.date, 'medium')}). Alles ist übernommen – bitte tragen Sie nur noch das `, h('strong', {}, 'neue Datum'), ' ein.'), 'info', '⧉') : null,
    templates,
    h('div', { class: 'termine-layout' }, form.el, form.preview),
    h('div', { class: 'form-actions termine-actions' }, primary, indicator.el, h('span', { class: 'spacer' }),
      button({ label: 'Verwerfen', icon: '✕', variant: 'ghost', onClick: discard }))));
  syncPrimary();
  if (dupOf) setTimeout(() => form.el.querySelector('input[name="date"]')?.focus(), 60);
  else if (!restored && !query.datum) setTimeout(() => form.el.querySelector('input[name="title"]')?.focus({ preventScroll: true }), 60);
  return () => { if (pending && !done) saveDraft.flush(); else saveDraft.cancel(); form.destroy(); };
}

/* ---------------------------------------------------------
   Absagen / Löschen / Reihe verlängern
   --------------------------------------------------------- */
function cancelDialog(e, onDone) {
  if (!mayEdit()) return;
  const fReason = field({ label: 'Was sollen die Besucher lesen?', type: 'textarea', rows: 3, optional: true,
    hint: 'Erscheint auf der Website unter dem durchgestrichenen Termin.', value: '' });
  const quick = ['Leider krankheitsbedingt abgesagt.', 'Fällt wegen des Wetters aus.', 'Zu wenige Anmeldungen – leider abgesagt.', 'Ein Ersatztermin folgt.'];
  const quickChips = h('div', { class: 'chips termine-quick' }, quick.map(q => h('button', { type: 'button', class: 'chip termine-chip termine-chip--small',
    onclick: () => { const v = fReason.input.value.trim(); fReason.setValue(v ? `${v} ${q}` : q); fReason.input.focus(); } }, q)));
  const mailBox = can('mail.send') && e.visibility !== 'board' ? h('input', { type: 'checkbox' }) : null;
  modal({
    title: `„${e.title}“ absagen`,
    body: h('div', { class: 'stack' },
      h('p', {}, `${formatDate(e.date, 'long')}${e.time ? ', ' + e.time + ' Uhr' : ''}. Der Termin bleibt auf der Website stehen – `, h('strong', {}, 'durchgestrichen und mit „Abgesagt“'), ', damit niemand umsonst kommt. Wer den Kalender abonniert hat, bekommt die Absage automatisch.'),
      fReason.el, h('p', { class: 'termine-sub' }, 'Oder antippen:'), quickChips,
      mailBox ? h('label', { class: 'check' }, mailBox, h('span', {}, 'Zusätzlich eine Rundmail an alle Mitglieder schicken (Vorschau)')) : null),
    actions: [
      { label: 'Doch nicht', icon: '←' },
      { label: 'Termin absagen', icon: '✕', variant: 'danger-solid', onClick: (close) => {
        const reason = fReason.value();
        db.update('events', e.id, { cancelled: true, cancelReason: reason, cancelledAt: nowIso(), cancelledBy: meId(), sequence: (Number(e.sequence) || 0) + 1 });
        log('event.cancel', label(e), `${formatDate(e.date, 'short')}${reason ? ' · „' + reason + '“' : ''}`);
        close();
        toast('Termin abgesagt – auf der Website steht er jetzt durchgestrichen.', { undo: () => {
          db.update('events', e.id, { cancelled: false, cancelReason: '', sequence: (Number(e.sequence) || 0) + 1 }); log('event.uncancel', label(e), 'Rückgängig gemacht'); rerender();
        } });
        if (mailBox && mailBox.checked) {
          sendMail({ to: 'mitglieder@kolping-ramsen.de', toName: 'Alle Mitglieder (Verteiler)', kind: 'rundmail',
            subject: `Abgesagt: ${e.title} am ${formatDate(e.date, 'medium')}`, heading: 'Leider müssen wir absagen',
            text: `<p><strong>${e.title}</strong> am ${formatDate(e.date, 'long')}${e.time ? ', ' + e.time + ' Uhr' : ''} fällt aus.</p>${reason ? `<p>${reason.replace(/</g, '&lt;')}</p>` : ''}<p>Alle weiteren Termine finden Sie wie immer auf unserer Website.</p>` });
        }
        onDone && onDone();
      } },
    ],
  });
}
function uncancel(e, onDone) {
  if (!mayEdit()) return;
  const before = { cancelled: e.cancelled, cancelReason: e.cancelReason, cancelledAt: e.cancelledAt, cancelledBy: e.cancelledBy };
  db.update('events', e.id, { cancelled: false, cancelReason: '', cancelledAt: null, cancelledBy: null, sequence: (Number(e.sequence) || 0) + 1 });
  log('event.uncancel', label(e), formatDate(e.date, 'short'));
  toast('Absage zurückgenommen – der Termin findet wieder statt.', { undo: () => { db.update('events', e.id, before); log('event.cancel', label(e), 'Rückgängig gemacht (wieder abgesagt)'); rerender(); } });
  onDone && onDone();
}
function deleteEvent(e) {
  if (!mayEdit()) return;
  const fol = following(e);
  const doOne = () => { trashItem('events', e.id, label(e)); navigate('#/admin/termine'); };
  if (!e.seriesId || fol.length <= 1) { doOne(); return; }
  modal({
    title: 'Was soll in den Papierkorb?',
    body: h('div', { class: 'stack' }, h('p', {}, `„${e.title}“ gehört zu einer Reihe (${(e.recurrence && e.recurrence.label) || 'regelmäßig'}).`),
      h('p', { class: 'muted' }, 'Gelöschtes liegt 30 Tage im Papierkorb und lässt sich zurückholen.')),
    actions: [
      { label: `Nur diesen Termin (${formatDate(e.date, 'dayMonth')})`, icon: '🗑', onClick: (c) => { c(); doOne(); } },
      { label: `Diesen und alle folgenden (${fol.length})`, icon: '🗑', variant: 'danger', onClick: (c) => {
        c();
        const by = meId(); const ids = fol.map(x => x.id);
        ids.forEach(id => db.remove('events', id, { by }));
        log('event.delete', `Terminreihe „${e.title}“`, `${ids.length} Termine ab ${formatDate(e.date, 'short')} in den Papierkorb gelegt`);
        navigate('#/admin/termine');
        toast(`${ids.length} Termine liegen jetzt im Papierkorb.`, { undo: () => { ids.forEach(id => db.restore('events', id)); log('trash.restore', `Terminreihe „${e.title}“`); rerender(); } });
      } },
    ],
  });
}

/* ---------------------------------------------------------
   #/admin/termine/:id – ändern (automatisch gespeichert)
   --------------------------------------------------------- */
function renderEdit(ctx) {
  const { el, params, query } = ctx;
  let cleanupFns = [];
  let firstDraw = true;
  const runCleanup = () => { cleanupFns.forEach(f => { try { f(); } catch (err) { console.error(err); } }); cleanupFns = []; };

  function draw({ flash = null } = {}) {
    runCleanup();
    let e = db.find('events', params.id);
    // Nicht sichtbare (interne Vorstands-)Termine: gleiche Seite wie „gibt es nicht“ – verrät nichts. Versuch wird protokolliert.
    if (e && !isVisible(e)) {
      log('access.denied', `#/admin/termine/${e.id}`, 'fehlendes Recht: files.board (interner Vorstands-Termin)');
      e = null;
    }
    if (!e || e.deletedAt) {
      put(el, h('div', { class: 'admin-page' },
        pageHeader({ title: 'Termin nicht gefunden', back: { href: '#/admin/termine', label: 'Zurück zu allen Terminen' } }),
        emptyState({ icon: '📅', title: e ? 'Dieser Termin liegt im Papierkorb' : 'Diesen Termin gibt es nicht (mehr)',
          text: e ? 'Im Papierkorb können Sie ihn mit einem Tipp zurückholen.' : 'Vielleicht wurde er gelöscht.',
          action: e ? button({ label: 'Zum Papierkorb', icon: '🗑', variant: 'primary', href: '#/admin/papierkorb' }) : button({ label: 'Alle Termine', icon: '←', variant: 'primary', href: '#/admin/termine' }) })));
      return;
    }
    ctx.setTitle(`${e.title} – Termin ändern`);
    const indicator = autosaveIndicator({ initial: e.updatedAt });
    let pendingLog = new Set();
    const flushLog = () => {
      if (!pendingLog.size) return;
      const cur = db.find('events', e.id) || e;
      log('event.update', label(cur), `geändert: ${[...pendingLog].map(k => FIELD_LABELS[k] || k).join(', ')}${form.s.scope === 'following' ? ' (auch alle folgenden Termine der Reihe)' : ''}`);
      pendingLog = new Set();
    };
    const logLater = debounce(flushLog, 4000);
    let lastStatus = e.status;

    const save = () => {
      if (!can(PERM)) { indicator.error('Keine Berechtigung'); return; }
      const errs = form.validate({ show: false });
      if (errs.length) { indicator.idle('⚠ Noch nicht gespeichert – bitte die Angaben prüfen'); return; }
      const cur = db.find('events', e.id); if (!cur || cur.deletedAt) return;
      const p = form.patch();
      if (p.visibility === 'board' && !can('files.board')) p.visibility = cur.visibility;
      const differs = (x, k, v) => JSON.stringify(v ?? null) !== JSON.stringify(x[k] ?? null);
      const bumps = keys => keys.some(k => ['date', 'endDate', 'time', 'endTime', 'location', 'title'].includes(k));
      const diff = Object.keys(p).filter(k => differs(cur, k, p[k]));
      // „Dieser und alle folgenden“: jede folgende Wiederholung auf denselben Stand bringen (Datum bleibt je Termin)
      let followerKeys = new Set();
      if (form.s.scope === 'following' && cur.seriesId) {
        const { date, endDate, ...rest } = p;
        for (const x of following(cur)) if (x.id !== cur.id) {
          const keys = Object.keys(rest).filter(k => differs(x, k, rest[k]));
          if (!keys.length) continue;
          const sub = {}; keys.forEach(k => { sub[k] = rest[k]; followerKeys.add(k); });
          db.update('events', x.id, { ...sub, sequence: (Number(x.sequence) || 0) + (bumps(keys) ? 1 : 0) });
        }
      }
      if (!diff.length && !followerKeys.size) { indicator.saved(cur.updatedAt); return; }
      if (diff.length) db.update('events', e.id, { ...p, sequence: (Number(cur.sequence) || 0) + (bumps(diff) ? 1 : 0) });
      followerKeys.forEach(k => { if (k !== 'status') pendingLog.add(k); });
      if (diff.includes('status') && p.status !== lastStatus) {
        log(p.status === 'draft' ? 'event.unpublish' : 'event.publish', label(cur), p.status === 'draft' ? 'zurück zu Entwurf' : 'steht jetzt auf der Website');
        lastStatus = p.status;
      }
      diff.filter(k => k !== 'status').forEach(k => pendingLog.add(k));
      if (pendingLog.size) logLater();
      indicator.saved(new Date());
      put(headBadge, statusBadge(db.find('events', e.id)));
      window.__kolpingDirty = false;
    };
    const saveSoon = debounce(save, 800);

    const form = eventForm({ mode: 'edit', state: stateFromEvent(e), event: e, recurSlot: e.seriesId ? null : extendBox(e, () => { saveSoon.flush(); draw(); }), onChange: (key) => {
      if (key === 'scope') { save(); return; }
      window.__kolpingDirty = true; indicator.saving();
      if (key === 'status') { saveSoon.cancel(); save(); syncPrimary(); return; }
      saveSoon();
    } });

    const headBadge = h('span', {}, statusBadge(e));
    const primary = h('span', { class: 'termine-primary-slot' });
    const syncPrimary = () => {
      const cur = db.find('events', e.id) || e;
      put(primary, cur.status === 'draft'
        ? button({ label: 'Auf der Website zeigen', icon: '✓', variant: 'ok', size: 'lg', onClick: () => {
          if (!mayEdit()) return;
          const errs = form.validate({ show: true });
          if (errs.length) { toast('Bitte erst die rot markierten Felder prüfen.', { type: 'error' }); form.focusFirstError(errs); return; }
          form.setStatus('published'); flushLog();
          draw({ flash: 'published' });
        } })
        : button({ label: 'Fertig', icon: '✓', variant: 'primary', size: 'lg', onClick: () => { saveSoon.flush(); navigate('#/admin/termine'); } }));
    };
    syncPrimary();

    const n = firstDraw ? (Number(query.neu) || 0) : 0;
    firstDraw = false;
    const flashBox = (n || flash) ? notice(h('div', { class: 'stack termine-flash' },
      h('p', {}, h('strong', {}, e.status === 'draft' ? (n > 1 ? `${n} Termine als Entwurf gespeichert.` : 'Als Entwurf gespeichert.') :
        n > 1 ? `Gespeichert! ${n} Termine stehen jetzt auf der Website.` : 'Gespeichert! Der Termin steht jetzt auf der Website.'),
      e.status !== 'draft' && e.visibility !== 'public' ? ` (sichtbar nur für ${e.visibility === 'members' ? 'angemeldete Mitglieder' : 'den Vorstand'})` : ''),
      h('div', { class: 'cluster' },
        e.status !== 'draft' ? button({ label: 'Jetzt auf der Website ansehen', icon: '🌐', href: `#/termine/${e.id}` }) : null,
        button({ label: 'Noch einen Termin eintragen', icon: '➕', href: '#/admin/termine/neu' }))), 'ok', '✓') : null;
    if (n) { try { history.replaceState(null, '', `#/admin/termine/${e.id}`); } catch { /* egal */ } }

    const cancelBox = e.cancelled ? h('div', { class: 'termine-cancelled-box', role: 'status' },
      h('div', {}, h('strong', {}, '✕ Dieser Termin ist abgesagt.'),
        h('p', {}, 'Auf der Website steht er durchgestrichen', e.cancelReason ? [' mit dem Hinweis: „', e.cancelReason, '“'] : '', '.',
          e.cancelledBy ? ` Abgesagt von ${userName(e.cancelledBy)}, ${formatDateTime(e.cancelledAt)}.` : '')),
      button({ label: 'Absage zurücknehmen', icon: '↶', onClick: () => uncancel(db.find('events', e.id), () => draw()) })) : null;

    const more = h('section', { class: 'admin-card termine-more' },
      h('h2', {}, 'Was möchten Sie noch tun?'),
      h('div', { class: 'termine-more__grid' },
        e.status !== 'draft' ? button({ label: 'Auf der Website ansehen', icon: '🌐', href: `#/termine/${e.id}` }) : null,
        button({ label: 'Kopieren (z. B. für nächstes Jahr)', icon: '⧉', href: `#/admin/termine/neu?von=${e.id}` }),
        !e.cancelled ? button({ label: 'Termin absagen', icon: '✕', variant: 'danger', onClick: () => { saveSoon.flush(); cancelDialog(db.find('events', e.id), () => draw()); } }) : null,
        e.status !== 'draft' ? button({ label: 'Als Kalenderdatei speichern', icon: '⤓', onClick: () => {
          saveSoon.flush(); const cur = db.find('events', e.id);
          downloadEventsICS([cur], icsFilename(cur)); log('event.export', label(cur), 'einzelner Termin (.ics)'); toast('Kalenderdatei gespeichert.');
        } }) : null,
        e.status !== 'draft' ? button({ label: 'Von der Website nehmen', icon: '✎', onClick: () => { form.setStatus('draft'); flushLog(); draw(); } }) : null,
        button({ label: 'In den Papierkorb', icon: '🗑', variant: 'danger', onClick: () => { saveSoon.flush(); flushLog(); deleteEvent(db.find('events', e.id)); } })),
      h('p', { class: 'termine-meta' }, `Eingetragen von ${userName(e.createdBy)}${e.createdAt ? ' am ' + formatDate(e.createdAt.slice(0, 10), 'short') : ''} · zuletzt geändert ${relativeTime(e.updatedAt)}`));

    put(el, h('div', { class: 'admin-page termine-page' },
      pageHeader({ title: 'Termin ändern', badge: headBadge, back: { href: '#/admin/termine', label: 'Zurück zu allen Terminen' },
        intro: 'Jede Änderung wird automatisch gespeichert und steht sofort auf der Website.' }),
      flashBox, cancelBox,
      h('div', { class: 'termine-layout' }, form.el, form.preview),
      more,
      h('div', { class: 'form-actions termine-actions' }, primary, indicator.el)));
    cleanupFns.push(() => { saveSoon.flush(); logLater.cancel(); flushLog(); form.destroy(); window.__kolpingDirty = false; });
  }
  draw();
  return runCleanup;
}

/** Einzelnen Termin nachträglich zur Reihe machen */
function extendBox(e, onDone) {
  const s = { recur: 'none', untilChoice: '6m' };
  const out = h('div', { class: 'termine-extend__preview', role: 'status', 'aria-live': 'polite' });
  const go = h('span', {});
  const dates = () => (s.recur === 'none' ? [] : R.occurrences(e.date, s.recur, R.untilFor(e.date, s.untilChoice), 60).slice(1));
  const kinds = R.kindsFor(e.date).filter(k => k !== 'none');
  const until = choiceGroup({ label: 'Wie lange?', options: () => R.UNTIL_CHOICES.filter(c => c.id !== 'date').map(c => ({ value: c.id, label: c.label })), get: () => s.untilChoice, set: v => { s.untilChoice = v; draw(); } });
  const kind = choiceGroup({ label: 'Wiederholung', options: () => kinds.map(k => ({ value: k, label: R.kindLabel(k, e.date), icon: '🔁' })), get: () => s.recur, set: v => { s.recur = v; draw(); } });
  const draw = () => {
    until.draw(); kind.draw();
    const list = dates();
    put(out, list.length ? h('p', {}, h('strong', {}, `${list.length} weitere Termine: `), R.shortDates(list, 8)) : h('p', { class: 'muted' }, 'Erst oben die Wiederholung antippen.'));
    put(go, list.length ? button({ label: `${list.length} weitere Termine anlegen`, icon: '🔁', onClick: () => {
      if (!mayEdit()) return;
      const sid = uid('s'); const rec = { kind: s.recur, label: R.kindLabel(s.recur, e.date), until: R.untilFor(e.date, s.untilChoice) };
      const cur = db.find('events', e.id);
      const { id, createdAt, updatedAt, ...copy } = cur;
      const span = cur.endDate ? Math.round((fromISODate(cur.endDate) - fromISODate(cur.date)) / 86400000) : 0;
      const ids = list.map(d => db.insert('events', { ...copy, id: uid('e'), date: d, endDate: span ? toISODate(new Date(fromISODate(d).getTime() + span * 86400000)) : null,
        seriesId: sid, recurrence: rec, sequence: 0, cancelled: false, cancelReason: '', createdBy: meId() }).id);
      db.update('events', e.id, { seriesId: sid, recurrence: rec });
      log('event.create', label(cur), `zur Reihe gemacht: „${rec.label}“, ${ids.length} weitere Termine`);
      toast(`${ids.length} weitere Termine angelegt.`, { undo: () => {
        const by = meId(); ids.forEach(x => db.remove('events', x, { by })); db.update('events', e.id, { seriesId: null, recurrence: null });
        log('event.delete', label(cur), `Rückgängig gemacht: ${ids.length} Termine der Reihe in den Papierkorb`); rerender();
      } });
      onDone && onDone();
    } }) : null);
  };
  draw();
  return h('div', { class: 'termine-extend' },
    h('p', { class: 'termine-sub' }, 'Nur nötig, wenn der Termin regelmäßig stattfindet. Ab diesem Termin werden weitere angelegt:'),
    kind.el, h('p', { class: 'termine-sub' }, 'Wie lange?'), until.el, out, go);
}

function statusBadge(e) {
  if (!e) return null;
  if (e.cancelled) return cancelBadge();
  if (e.status === 'draft') return badge('Entwurf – noch nicht auf der Website', 'draft', '✎');
  return badge('Steht auf der Website', 'ok', '🌐');
}

/* ---------------------------------------------------------
   #/admin/termine – Liste & Monat
   --------------------------------------------------------- */
const FILTERS = [
  { id: 'kommende', label: 'Kommende', test: (e, t) => (e.endDate || e.date) >= t },
  { id: 'entwuerfe', label: 'Entwürfe', test: e => e.status === 'draft' },
  { id: 'abgesagt', label: 'Abgesagte', test: e => !!e.cancelled },
  { id: 'vergangen', label: 'Vergangene', test: (e, t) => (e.endDate || e.date) < t },
  { id: 'alle', label: 'Alle', test: () => true },
];
function adminRow(e) {
  return h('li', { class: `admin-row termine-row${e.cancelled ? ' termine-row--cancelled' : ''}${e.status === 'draft' ? ' termine-row--draft' : ''}` },
    h('div', { class: 'termine-row__date' }, dateBlock(e)),
    h('span', { class: 'admin-row__main' },
      h('b', { class: 'termine-row__title' }, e.cancelled ? [h('span', { class: 'sr-only' }, 'Abgesagt: '), h('s', {}, e.title)] : e.title),
      h('span', { class: 'admin-row__sub' }, whenShort(e), e.location ? ` · 📍 ${e.location}` : ''),
      h('span', { class: 'termine-row__tags' },
        e.cancelled ? cancelBadge() : null,
        e.status === 'draft' ? badge('Entwurf', 'draft', '✎') : null,
        catTag(e.category),
        e.visibility && e.visibility !== 'public' ? (e.visibility === 'members' ? badge('Nur Mitglieder', 'info', '👥') : h('span', { class: 'badge badge--board' }, h('span', { 'aria-hidden': 'true' }, '🔒'), 'Nur Vorstand')) : null,
        seriesTag(e))),
    h('span', { class: 'admin-row__actions' },
      button({ label: 'Ändern', icon: '✎', href: `#/admin/termine/${e.id}`, attrs: { 'aria-label': `„${e.title}“ am ${formatDate(e.date, 'medium')} ändern` } }),
      button({ label: 'Kopieren', icon: '⧉', variant: 'ghost', href: `#/admin/termine/neu?von=${e.id}`, attrs: { 'aria-label': `„${e.title}“ kopieren` } })));
}

function renderList(ctx) {
  const { el, query } = ctx;
  const today = todayISO();
  const st = {
    view: query.ansicht === 'monat' ? 'month' : 'list',
    filter: FILTERS.some(f => f.id === query.zeige) ? query.zeige : 'kommende',
    cat: query.kat && eventCategory(query.kat) ? query.kat : '',
    month: null, day: null,
  };
  { const m = /^(\d{4})-(\d{2})$/.exec(query.monat || ''); const d = m ? new Date(+m[1], +m[2] - 1, 1) : new Date(); st.month = new Date(d.getFullYear(), d.getMonth(), 1); }
  const controls = h('div', { class: 'termine-controls admin-card' });
  const out = h('div', { class: 'termine-out' });
  const syncUrl = () => {
    const q = new URLSearchParams();
    if (st.view === 'month') { q.set('ansicht', 'monat'); q.set('monat', `${st.month.getFullYear()}-${String(st.month.getMonth() + 1).padStart(2, '0')}`); }
    if (st.filter !== 'kommende' && st.view === 'list') q.set('zeige', st.filter);
    if (st.cat) q.set('kat', st.cat);
    const qs = q.toString();
    try { history.replaceState(null, '', `#/admin/termine${qs ? '?' + qs : ''}`); } catch { /* egal */ }
  };
  const base = () => adminEvents().filter(e => !st.cat || e.category === st.cat);

  function drawControls() {
    const all = base();
    const views = h('div', { class: 'segmented termine-seg', role: 'group', 'aria-label': 'Ansicht' },
      [['list', '☰ Liste'], ['month', '▦ Monat']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(st.view === v), onclick: () => { st.view = v; draw(); } }, l)));
    const filters = st.view === 'list' ? h('div', { class: 'chips termine-choice', role: 'group', 'aria-label': 'Welche Termine zeigen?' },
      FILTERS.map(f => { const n = all.filter(e => f.test(e, today)).length; return h('button', { type: 'button', class: 'chip termine-chip', 'aria-pressed': String(st.filter === f.id), onclick: () => { st.filter = f.id; draw(); } }, `${f.label} (${n})`); })) : null;
    const cats = h('div', { class: 'chips termine-choice', role: 'group', 'aria-label': 'Nach Bereich filtern' },
      h('button', { type: 'button', class: 'chip termine-chip', 'aria-pressed': String(!st.cat), onclick: () => { st.cat = ''; draw(); } }, 'Alle Bereiche'),
      eventCategories().filter(c => c.id !== 'vorstand' || can('files.board')).map(c => h('button', { type: 'button', class: 'chip termine-chip termine-chip--cat', style: { '--c': c.color },
        'aria-pressed': String(st.cat === c.id), onclick: () => { st.cat = st.cat === c.id ? '' : c.id; draw(); } }, h('span', { class: 'chip__dot', 'aria-hidden': 'true' }), c.label)));
    put(controls, 
      h('div', { class: 'termine-controls__row' }, h('span', { class: 'termine-sub' }, 'Ansicht:'), views),
      filters ? h('div', { class: 'termine-controls__row' }, h('span', { class: 'termine-sub' }, 'Zeigen:'), filters) : null,
      h('div', { class: 'termine-controls__row' }, h('span', { class: 'termine-sub' }, 'Bereich:'), cats));
  }
  function drawList() {
    const f = FILTERS.find(x => x.id === st.filter);
    let list = base().filter(e => f.test(e, today));
    if (st.filter === 'vergangen') list = list.reverse();
    if (!list.length) {
      put(out, emptyState({ icon: '📅', title: st.filter === 'entwuerfe' ? 'Keine Entwürfe' : st.filter === 'abgesagt' ? 'Keine abgesagten Termine' : 'Keine Termine gefunden',
        text: st.cat ? 'Tippen Sie oben auf „Alle Bereiche“, um alle zu sehen.' : '', action: button({ label: 'Termin eintragen', icon: '➕', href: '#/admin/termine/neu' }) }));
      return;
    }
    const by = new Map();
    for (const e of list) { const k = e.date.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
    put(out, ...Array.from(by, ([k, evs]) => h('section', { class: 'termine-month' },
      h('h2', { class: 'termine-month__title' }, `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`, h('span', { class: 'termine-month__n' }, ` · ${evs.length} Termin${evs.length > 1 ? 'e' : ''}`)),
      h('ul', { class: 'admin-list' }, evs.map(adminRow)))));
  }
  function drawMonth() {
    const y = st.month.getFullYear(), mo = st.month.getMonth();
    const offset = (new Date(y, mo, 1).getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate();
    const evs = base();
    const byDay = new Map();
    for (const e of evs) {
      const d = fromISODate(e.date), end = fromISODate(e.endDate && e.endDate > e.date ? e.endDate : e.date);
      for (let g = 0; d <= end && g < 40; g++) { const k = toISODate(d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); d.setDate(d.getDate() + 1); }
    }
    const ym = `${y}-${String(mo + 1).padStart(2, '0')}`;
    if (!st.day || st.day.slice(0, 7) !== ym) st.day = today.slice(0, 7) === ym ? today : `${ym}-01`;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'termine-cal__empty', 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d++) {
      const iso = toISODate(new Date(y, mo, d, 12)); const list = byDay.get(iso) || [];
      cells.push(h('button', { type: 'button', class: `termine-cal__day${iso === today ? ' is-today' : ''}${list.length ? ' has-ev' : ''}`,
        'aria-pressed': String(iso === st.day), 'aria-label': `${formatDate(iso, 'long')}${list.length ? `, ${list.length} Termin${list.length > 1 ? 'e' : ''}` : ', frei'}`,
        onclick: () => {
          st.day = iso; drawMonth();
          out.querySelector('.termine-cal__day[aria-pressed="true"]')?.focus({ preventScroll: true });
          out.querySelector('.termine-daypanel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } },
      h('span', { class: 'termine-cal__num' }, d),
      h('span', { class: 'termine-cal__evs', 'aria-hidden': 'true' }, list.slice(0, 3).map(e => h('span', { class: `termine-cal__ev${e.cancelled ? ' is-cancelled' : ''}${e.status === 'draft' ? ' is-draft' : ''}`, style: { '--c': eventCategory(e.category).color } },
        h('b', {}, e.time || ''), ' ', e.title)), list.length > 3 ? h('span', { class: 'termine-cal__more' }, `+${list.length - 3}`) : null)));
    }
    const dayList = byDay.get(st.day) || [];
    const dayPanel = h('section', { class: 'admin-card termine-daypanel', 'aria-live': 'polite' },
      h('h2', {}, formatDate(st.day, 'long')),
      dayList.length ? h('ul', { class: 'admin-list' }, dayList.map(adminRow)) : h('p', { class: 'muted' }, 'An diesem Tag ist noch nichts eingetragen.'),
      button({ label: 'Termin an diesem Tag eintragen', icon: '➕', href: `#/admin/termine/neu?datum=${st.day}` }));
    const monthList = evs.filter(e => e.date.slice(0, 7) === ym || (e.endDate || e.date).slice(0, 7) === ym);
    const prev = new Date(y, mo - 1, 1), next = new Date(y, mo + 1, 1);
    put(out, 
      h('div', { class: 'admin-card termine-cal' },
        h('div', { class: 'termine-cal__head' },
          button({ label: MONTHS[prev.getMonth()], icon: '‹', onClick: () => { st.month = prev; st.day = null; draw(); } }),
          h('h2', { class: 'termine-cal__title', 'aria-live': 'polite' }, `${MONTHS[mo]} ${y}`),
          button({ label: MONTHS[next.getMonth()], icon: '›', onClick: () => { st.month = next; st.day = null; draw(); } })),
        h('p', { class: 'termine-sub' }, 'Tippen Sie auf einen Tag – darunter sehen Sie seine Termine und können dort einen neuen eintragen.'),
        h('div', { class: 'termine-cal__grid' }, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => h('span', { class: 'termine-cal__wd', 'aria-hidden': 'true' }, w)), cells)),
      dayPanel,
      h('section', { class: 'termine-month' }, h('h2', { class: 'termine-month__title' }, `Alle Termine im ${MONTHS[mo]}`, h('span', { class: 'termine-month__n' }, ` · ${monthList.length}`)),
        monthList.length ? h('ul', { class: 'admin-list' }, monthList.map(adminRow)) : h('p', { class: 'muted' }, 'Keine Termine in diesem Monat.')));
  }
  function draw() { drawControls(); if (st.view === 'list') drawList(); else drawMonth(); syncUrl(); }

  const hiddenBoard = !can('files.board') ? db.all('events').filter(e => (e.visibility || 'public') === 'board' && (e.endDate || e.date) >= today).length : 0;
  const exportBox = h('section', { class: 'dash-box termine-export' },
    h('h2', {}, '📲 Termine in den Kalender holen'),
    h('p', {}, 'Mitglieder können den Vereinskalender auf Handy, Tablet oder Computer ', h('strong', {}, 'abonnieren'), '. Dann kommen neue Termine, Änderungen und Absagen von selbst – ohne dass jemand etwas verschicken muss.'),
    h('div', { class: 'cluster' },
      button({ label: 'So funktioniert das Abo', icon: '🔔', onClick: () => aboDialog({ cat: st.cat }) }),
      button({ label: 'Alle kommenden Termine als Kalenderdatei', icon: '⤓', onClick: () => {
        const evs = adminEvents().filter(e => (e.endDate || e.date) >= today && (!st.cat || e.category === st.cat));
        const n = downloadEventsICS(evs, st.cat ? `kolping-ramsen-${st.cat}.ics` : 'kolping-ramsen-termine.ics', { name: 'Kolpingsfamilie Ramsen (Verwaltung)' });
        log('event.export', `${n} Termine`, 'ganzer Kalender (.ics) aus der Verwaltung'); toast(`${n} Termine als Kalenderdatei gespeichert. Entwürfe sind nicht dabei.`);
      } }),
      button({ label: 'Termine auf der Website', icon: '🌐', variant: 'ghost', href: '#/termine' })));

  put(el, h('div', { class: 'admin-page termine-page' },
    pageHeader({ title: 'Termine', intro: 'Alle Veranstaltungen der Kolpingsfamilie. Was hier steht, erscheint sofort auf der Website und in den Kalender-Abos.',
      actions: [button({ label: 'Termin eintragen', icon: '➕', variant: 'primary', size: 'lg', href: '#/admin/termine/neu' })] }),
    hiddenBoard ? notice(h('span', {}, h('strong', {}, '🎭 Hinweis für die Vorführung: '), `${hiddenBoard} interne Vorstands-Termine sind für ${(currentUser() || {}).firstName || 'diese Rolle'} ausgeblendet – nicht in der Liste, nicht im Kalender, nicht in der Suche.`), 'demo') : null,
    controls, out, exportBox));
  draw();
}

/* ---------------------------------------------------------
   Routen
   --------------------------------------------------------- */
registerRoute('/admin/termine', renderList, { permission: PERM, title: 'Termine' });
registerRoute('/admin/termine/neu', renderNew, { permission: PERM, title: 'Termin eintragen' });
registerRoute('/admin/termine/:id', renderEdit, { permission: PERM, title: 'Termin ändern' });
