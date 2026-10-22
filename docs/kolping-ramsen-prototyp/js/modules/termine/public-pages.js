// =========================================================
// modules/termine/public-pages.js – öffentliche Termine-Seiten
// Ersetzt per registerRoute() die Fassung aus public.js (Module
// laden danach; gleiche Route = wird überschrieben). Gleiches
// Aussehen, zusätzlich: Absagen durchgestrichen, Reihen, echter
// iCal-Export mit Zeitzone, Abo-Erklärung je Bereich.
// Außerdem: kleine „Absage“-Markierung für Termin-Zeilen anderer
// Seiten (Startseite, Mitgliederbereich, Übersicht im Admin).
// =========================================================
import { registerRoute } from '../../app.js';
import { db, eventCategory, eventCategories } from '../../store.js';
import { can, canSeeVisibility } from '../../auth.js';
import { h, button, toast, emptyState, todayISO, fromISODate, toISODate, MONTHS } from '../../ui.js';
import { eventsVisibleToViewer, notFound } from '../../public.js';
import { downloadEventsICS } from './ics.js';
import { publicEventRow, eventDetail, aboDialog, seriesSiblings, cancelBadge } from './view.js';

/** replaceChildren ohne „null“-Text für ausgelassene Teile */
const put = (target, ...kids) => target.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));

function pageHero({ kicker, title, intro }) {
  return h('header', { class: 'page-hero' },
    h('div', { class: 'container page-hero__inner' },
      kicker ? h('p', { class: 'kicker' }, kicker) : null,
      h('h1', { class: 'page-hero__title' }, title),
      intro ? h('p', { class: 'page-hero__intro' }, intro) : null));
}
function sectionHead(title, link) {
  return h('div', { class: 'section-head' },
    h('div', {}, h('h2', { class: 'section-title' }, title)),
    link ? h('a', { class: 'section-link', href: link.href }, link.label, ' →') : null);
}
const iso7 = (y, mo) => `${y}-${String(mo + 1).padStart(2, '0')}`;

/* ---------------------------------------------------------
   #/termine  (?ansicht=monat, ?kat=<bereich>, ?abo=1)
   --------------------------------------------------------- */
registerRoute('/termine', ({ el, query }) => {
  const today = todayISO();
  const state = { view: query.ansicht === 'monat' ? 'month' : 'list', cat: query.kat && eventCategory(query.kat) ? query.kat : '', past: false };
  { const d = new Date(); state.month = new Date(d.getFullYear(), d.getMonth(), 1); }
  const controls = h('div', { class: 'cal-controls' });
  const out = h('div', { class: 'cal-out' });
  const filtered = () => eventsVisibleToViewer({ category: state.cat || null });

  function draw() {
    const viewBtns = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Ansicht' },
      ...[['list', '☰ Liste'], ['month', '▦ Monat']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(state.view === v),
        onclick: () => { state.view = v; draw(); } }, l)));
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Nach Bereich filtern' },
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!state.cat), onclick: () => { state.cat = ''; draw(); } }, 'Alle'),
      eventCategories().filter(c => c.id !== 'vorstand' || can('files.board')).map(c => h('button', { type: 'button', class: 'chip', style: { '--c': c.color },
        'aria-pressed': String(state.cat === c.id), onclick: () => { state.cat = state.cat === c.id ? '' : c.id; draw(); } },
        h('span', { class: 'chip__dot', 'aria-hidden': 'true' }), c.label)));
    put(controls, 
      h('div', { class: 'cal-controls__row' }, viewBtns, h('div', { class: 'spacer' }),
        button({ label: 'Als Kalenderdatei speichern', icon: '⤓', size: 'sm', onClick: () => {
          const evs = filtered().filter(e => (e.endDate || e.date) >= today);
          const n = downloadEventsICS(evs, state.cat ? `kolping-ramsen-${state.cat}.ics` : 'kolping-ramsen-termine.ics',
            { name: state.cat ? `Kolping Ramsen – ${eventCategory(state.cat).label}` : 'Kolpingsfamilie Ramsen' });
          toast(`${n} Termine als Kalenderdatei gespeichert.`);
        } }),
        button({ label: 'Kalender abonnieren', icon: '🔔', size: 'sm', variant: 'primary', onClick: () => aboDialog({ cat: state.cat }) })),
      chips);
    if (state.view === 'list') drawList(); else drawMonth();
  }
  function group(evs) {
    const by = new Map();
    for (const e of evs) { const k = e.date.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
    return Array.from(by, ([k, list]) => h('section', { class: 'month-group' },
      h('h2', { class: 'month-group__title' }, `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`),
      h('div', { class: 'event-list' }, list.map(e => publicEventRow(e)))));
  }
  function drawList() {
    const all = filtered();
    const upcoming = all.filter(e => (e.endDate || e.date) >= today);
    const past = all.filter(e => (e.endDate || e.date) < today).reverse();
    put(out, 
      upcoming.length ? h('div', {}, group(upcoming)) : emptyState({ icon: '📅', title: 'Keine kommenden Termine in diesem Bereich' }),
      past.length ? h('div', { class: 'past-toggle' },
        button({ label: state.past ? 'Vergangene Termine ausblenden' : `Vergangene Termine anzeigen (${past.length})`, icon: state.past ? '▲' : '▼', variant: 'ghost',
          onClick: () => { state.past = !state.past; drawList(); } }),
        state.past ? h('div', { class: 'past-list' }, group(past)) : null) : null);
  }
  function drawMonth() {
    const m = state.month; const y = m.getFullYear(), mo = m.getMonth();
    const first = new Date(y, mo, 1); const startOffset = (first.getDay() + 6) % 7;
    const days = new Date(y, mo + 1, 0).getDate();
    const evs = filtered();
    const byDay = new Map();
    for (const e of evs) {
      const d = fromISODate(e.date); const end = fromISODate(e.endDate && e.endDate > e.date ? e.endDate : e.date);
      for (let g = 0; d <= end && g < 40; g++) { const k = toISODate(d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); d.setDate(d.getDate() + 1); }
    }
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(h('div', { class: 'mcal__cell mcal__cell--empty', 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d++) {
      const iso = toISODate(new Date(y, mo, d, 12));
      const list = byDay.get(iso) || [];
      cells.push(h('div', { class: `mcal__cell${iso === today ? ' is-today' : ''}${list.length ? ' has-events' : ''}` },
        h('span', { class: 'mcal__num' }, d),
        list.map(e => h('a', { class: `mcal__ev${e.cancelled ? ' termine-mev--cancelled' : ''}`, href: `#/termine/${e.id}`, 'data-tdec': '1', style: { '--c': eventCategory(e.category).color } },
          h('span', { class: 'mcal__time' }, e.time || ''), ' ', e.cancelled ? [h('span', { class: 'sr-only' }, 'Abgesagt: '), h('s', {}, e.title)] : e.title))));
    }
    const ym = iso7(y, mo);
    const monthEvents = evs.filter(e => e.date.slice(0, 7) === ym || (e.endDate || e.date).slice(0, 7) === ym);
    put(out, 
      h('div', { class: 'mcal' },
        h('div', { class: 'mcal__head' },
          button({ label: 'Voriger Monat', icon: '‹', size: 'sm', onClick: () => { state.month = new Date(y, mo - 1, 1); drawMonth(); } }),
          h('h2', { class: 'mcal__title', 'aria-live': 'polite' }, `${MONTHS[mo]} ${y}`),
          button({ label: 'Nächster Monat', icon: '›', size: 'sm', onClick: () => { state.month = new Date(y, mo + 1, 1); drawMonth(); } })),
        h('div', { class: 'mcal__grid', role: 'presentation' },
          ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => h('div', { class: 'mcal__wd', 'aria-hidden': 'true' }, d)), cells)),
      h('div', { class: 'mcal__list' }, h('h3', {}, `Alle Termine im ${MONTHS[mo]}`),
        monthEvents.length ? h('div', { class: 'event-list' }, monthEvents.map(e => publicEventRow(e, { compact: true }))) : h('p', { class: 'muted' }, 'Keine Termine in diesem Monat.')));
  }

  put(el, 
    pageHero({ kicker: 'Kalender', title: 'Termine', intro: 'Alle Veranstaltungen der Kolpingsfamilie – zum Mitnehmen in den eigenen Kalender.' }),
    h('section', { class: 'section section--tight' }, h('div', { class: 'container' }, controls, out)));
  draw();
  if (query.abo) setTimeout(() => aboDialog({ cat: state.cat }), 50);
}, { title: 'Termine' });

/* ---------------------------------------------------------
   #/termine/:id
   --------------------------------------------------------- */
registerRoute('/termine/:id', ({ el, params, setTitle }) => {
  const e = db.find('events', params.id);
  if (!e || e.deletedAt || !canSeeVisibility(e.visibility || 'public') || (e.status === 'draft' && !can('site.events.edit'))) return notFound(el);
  setTitle((e.cancelled ? 'Abgesagt: ' : '') + e.title);
  const series = seriesSiblings(e);
  const more = eventsVisibleToViewer({ from: todayISO() }).filter(x => x.id !== e.id && (!e.seriesId || x.seriesId !== e.seriesId)).slice(0, 3);
  put(el, 
    e.status === 'draft' ? h('div', { class: 'termine-preview-band', role: 'note' }, '✎ Vorschau: Dieser Termin ist ein Entwurf und für Besucher noch nicht sichtbar.') : null,
    eventDetail(e),
    series.length ? h('section', { class: 'section' }, h('div', { class: 'container' },
      sectionHead(`Nächste Termine dieser Reihe`, null),
      h('div', { class: 'event-list' }, series.slice(0, 4).map(x => publicEventRow(x, { compact: true }))))) : null,
    more.length ? h('section', { class: 'section section--tint' }, h('div', { class: 'container' },
      sectionHead('Weitere Termine', { href: '#/termine', label: 'Alle Termine' }),
      h('div', { class: 'event-list' }, more.map(x => publicEventRow(x))))) : null);
}, { title: 'Termin' });

/* ---------------------------------------------------------
   Absagen auch auf fremden Seiten kenntlich machen
   (Startseite, Mitgliederbereich, Admin-Übersicht) – nur DOM-Zusatz,
   die Seiten selbst gehören anderen Modulen.
   --------------------------------------------------------- */
function decorate(root) {
  for (const a of root.querySelectorAll('a.event-row[href^="#/termine/"]:not([data-tdec]), a.hero__next[href^="#/termine/"]:not([data-tdec]), a.mcal__ev[href^="#/termine/"]:not([data-tdec])')) {
    a.setAttribute('data-tdec', '1');
    const e = db.find('events', a.getAttribute('href').split('/').pop());
    if (!e || !e.cancelled) continue;
    if (a.classList.contains('event-row')) {
      a.classList.add('termine-row--cancelled');
      const t = a.querySelector('.event-row__title'); if (t) { put(t, h('span', { class: 'sr-only' }, 'Abgesagt: '), h('s', {}, e.title)); }
      const tags = a.querySelector('.event-row__tags'); if (tags) tags.prepend(cancelBadge());
    } else if (a.classList.contains('hero__next')) {
      const t = a.querySelector('.hero__next-title'); if (t) { put(t, h('s', {}, e.title)); t.after(h('span', { class: 'termine-cancel-badge termine-cancel-badge--hero' }, '✕ Fällt aus')); }
    } else {
      a.classList.add('termine-mev--cancelled');
    }
  }
  for (const a of root.querySelectorAll('.admin-row a[href^="#/admin/termine/e"]:not([data-tdec])')) {
    a.setAttribute('data-tdec', '1');
    const e = db.find('events', a.getAttribute('href').split('/').pop());
    if (!e || !e.cancelled) continue;
    const row = a.closest('.admin-row'); const b = row && row.querySelector('.admin-row__main b');
    if (b && !row.querySelector('.termine-cancel-badge')) b.after(cancelBadge());
  }
}
try {
  const app = document.getElementById('app');
  if (app && 'MutationObserver' in window) {
    let pending = false;
    new MutationObserver(() => {
      if (pending) return; pending = true;
      requestAnimationFrame(() => { pending = false; try { decorate(app); } catch (err) { console.error(err); } });
    }).observe(app, { childList: true, subtree: true });
  }
} catch (err) { console.error(err); }
