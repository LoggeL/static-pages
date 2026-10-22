// =========================================================
// modules/termine/view.js – Darstellung eines Termins (Website-Stil)
// Wird von der öffentlichen Termine-Seite UND der Admin-Vorschau
// „So sieht es auf der Website aus“ benutzt → beides sieht gleich aus.
// =========================================================
import { db, eventCategory, eventCategories } from '../../store.js';
import { can, canSeeVisibility } from '../../auth.js';
import { h, button, toast, modal, visibilityBadge, formatDate, fromISODate, todayISO, MONTHS, WEEKDAYS } from '../../ui.js';
import { mediaImg, eventsVisibleToViewer } from '../../public.js';
import { downloadEventsICS, icsFilename } from './ics.js';

/** replaceChildren ohne „null“-Text für ausgelassene Teile */
const put = (target, ...kids) => target.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));

export function dateBlock(e) {
  const d = fromISODate(e.date);
  return h('div', { class: 'date-block', 'aria-hidden': 'true' },
    h('span', { class: 'date-block__wd' }, WEEKDAYS[d.getDay()].slice(0, 2)),
    h('span', { class: 'date-block__day' }, d.getDate()),
    h('span', { class: 'date-block__mon' }, MONTHS[d.getMonth()].slice(0, 3)));
}
export function catTag(id) {
  const c = eventCategory(id);
  return h('span', { class: 'cat', style: { '--c': c.color } }, c.label);
}
export function eventWhen(e) {
  let s = formatDate(e.date, 'long');
  if (e.endDate && e.endDate !== e.date) s += ` bis ${formatDate(e.endDate, 'long')}`;
  if (e.time) s += `, ${e.time}${e.endTime ? '–' + e.endTime : ''} Uhr`;
  else s += ' (ganztägig)';
  return s;
}
export function cancelBadge() {
  return h('span', { class: 'termine-cancel-badge' }, h('span', { 'aria-hidden': 'true' }, '✕'), ' Abgesagt');
}
export function seriesTag(e) {
  if (!e.seriesId) return null;
  return h('span', { class: 'termine-series-tag' }, h('span', { 'aria-hidden': 'true' }, '🔁'), ' ', (e.recurrence && e.recurrence.label) || 'Regelmäßig');
}
export function draftBadge() {
  return h('span', { class: 'badge badge--draft' }, h('span', { 'aria-hidden': 'true' }, '✎'), 'Entwurf – noch nicht auf der Website');
}

/** Termin-Zeile wie auf der Website (mit Absage + Reihe). linkable:false für die Vorschau */
export function publicEventRow(e, { compact = false, linkable = true } = {}) {
  const tag = linkable ? 'a' : 'div';
  return h(tag, { class: `event-row${compact ? ' event-row--compact' : ''}${e.cancelled ? ' termine-row--cancelled' : ''}`,
    href: linkable ? `#/termine/${e.id}` : null, 'data-tdec': '1' },
    dateBlock(e),
    h('div', { class: 'event-row__body' },
      h('h3', { class: 'event-row__title' }, e.cancelled ? [h('span', { class: 'sr-only' }, 'Abgesagt: '), h('s', {}, e.title)] : e.title),
      h('p', { class: 'event-row__meta' },
        h('span', {}, h('span', { class: 'sr-only' }, formatDate(e.date, 'long') + ', '), e.time ? `🕖 ${e.time} Uhr` : 'ganztägig'),
        e.location ? h('span', {}, `📍 ${e.location}`) : null),
      e.cancelled && e.cancelReason ? h('p', { class: 'termine-cancel-reason' }, e.cancelReason) : null,
      h('div', { class: 'event-row__tags' },
        e.cancelled ? cancelBadge() : null,
        catTag(e.category),
        e.visibility && e.visibility !== 'public' ? visibilityBadge(e.visibility) : null,
        seriesTag(e),
        e.status === 'draft' ? draftBadge() : null)),
    h('span', { class: 'event-row__arrow', 'aria-hidden': 'true' }, '→'));
}

/** Weitere (sichtbare, veröffentlichte, kommende) Termine derselben Reihe */
export function seriesSiblings(e, { from = todayISO() } = {}) {
  if (!e.seriesId) return [];
  return db.all('events').filter(x => x.seriesId === e.seriesId && x.id !== e.id && x.status !== 'draft' && !x.cancelled
    && canSeeVisibility(x.visibility || 'public') && (x.endDate || x.date) >= from)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const prose = (htmlStr) => { const d = h('div', { class: 'prose' }); d.innerHTML = htmlStr || ''; return d; };

/** Detailansicht eines Termins (Website). preview:true → ohne Knöpfe/Links (Admin-Vorschau) */
export function eventDetail(e, { preview = false } = {}) {
  const cat = eventCategory(e.category);
  const series = preview ? [] : seriesSiblings(e);
  const titleEl = h('h1', { class: `event-detail__title${e.cancelled ? ' termine-struck' : ''}` },
    e.cancelled ? [h('span', { class: 'sr-only' }, 'Abgesagt: '), h('s', {}, e.title || 'Titel fehlt noch')] : (e.title || 'Titel fehlt noch'));
  const actions = preview ? null : h('div', { class: 'cluster' },
    !e.cancelled ? button({ label: 'In meinen Kalender', icon: '⤓', variant: 'primary', onClick: () => {
      downloadEventsICS([e], icsFilename(e));
      toast('Kalendereintrag gespeichert. Öffnen Sie die Datei – dann fragt Ihr Kalender, ob er den Termin übernehmen soll.');
    } }) : null,
    series.length && !e.cancelled ? button({ label: `Ganze Reihe in meinen Kalender (${series.length + 1} Termine)`, icon: '🔁', onClick: () => {
      const n = downloadEventsICS([e, ...series], `reihe-${icsFilename(e)}`);
      toast(`${n} Termine der Reihe als Kalenderdatei gespeichert.`);
    } }) : null,
    button({ label: 'Alle Termine', icon: '←', href: '#/termine' }));
  return h('article', { class: `event-detail${preview ? ' termine-detail--preview' : ''}` },
    h('div', { class: 'container' },
      preview ? null : h('nav', { class: 'crumbs', 'aria-label': 'Brotkrumen' }, h('a', { href: '#/termine' }, 'Termine'), h('span', { 'aria-hidden': 'true' }, ' › '), h('span', { 'aria-current': 'page' }, e.title)),
      h('div', { class: 'event-detail__grid' },
        h('div', {},
          e.cancelled ? h('div', { class: 'termine-cancel-banner', role: 'status' },
            h('span', { class: 'termine-cancel-banner__icon', 'aria-hidden': 'true' }, '✕'),
            h('div', {}, h('strong', {}, 'Dieser Termin fällt aus.'), e.cancelReason ? h('p', {}, e.cancelReason) : null)) : null,
          h('div', { class: 'cluster' }, catTag(e.category), e.visibility && e.visibility !== 'public' ? visibilityBadge(e.visibility) : null, seriesTag(e),
            e.status === 'draft' ? draftBadge() : null),
          titleEl,
          h('dl', { class: 'facts' },
            h('div', {}, h('dt', {}, '📅 Wann'), h('dd', {}, e.cancelled ? h('s', {}, eventWhen(e)) : eventWhen(e))),
            e.location ? h('div', {}, h('dt', {}, '📍 Wo'), h('dd', {}, e.location)) : null,
            h('div', {}, h('dt', {}, '🏷 Bereich'), h('dd', {}, cat.label)),
            e.seriesId && e.recurrence ? h('div', {}, h('dt', {}, '🔁 Regelmäßig'), h('dd', {}, e.recurrence.label,
              series.length ? h('span', { class: 'termine-series-next' }, ' · nächste: ',
                series.slice(0, 3).map((x, i) => [i ? ', ' : '', h('a', { href: `#/termine/${x.id}` }, formatDate(x.date, 'dayMonth'))])) : null)) : null),
          e.description ? prose(e.description) : null,
          actions),
        e.image ? h('figure', { class: 'event-detail__img' }, mediaImg(e.image, { size: 'l', eager: true })) : h('div', { class: 'event-detail__date' }, dateBlock(e)))));
}

/* ---------------------------------------------------------
   „Kalender abonnieren“ – Erklärung (Website + Verwaltung)
   --------------------------------------------------------- */
const FEED_BASE = 'webcal://kolping-ramsen.de/kalender/';
export function aboDialog({ cat = '' } = {}) {
  let sel = cat && eventCategory(cat) ? cat : '';
  const urlBox = h('code', {});
  const chips = h('div', { class: 'chips termine-abo-chips', role: 'group', 'aria-label': 'Welche Termine abonnieren?' });
  const cats = eventCategories().filter(c => c.id !== 'vorstand' || can('files.board'));
  const url = () => `${FEED_BASE}${sel || 'alle'}.ics`;
  const draw = () => {
    urlBox.textContent = url();
    put(chips, 
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!sel), onclick: () => { sel = ''; draw(); } }, 'Alle Termine'),
      ...cats.map(c => h('button', { type: 'button', class: 'chip', style: { '--c': c.color }, 'aria-pressed': String(sel === c.id), onclick: () => { sel = c.id; draw(); } },
        h('span', { class: 'chip__dot', 'aria-hidden': 'true' }), c.label)));
  };
  draw();
  modal({
    title: 'Termine im eigenen Kalender',
    wide: true,
    body: h('div', { class: 'stack termine-abo' },
      h('p', {}, 'Mit einem ', h('strong', {}, 'Abo'), ' stehen alle Termine automatisch in Ihrem Handy- oder Computer-Kalender. Neue Termine, Änderungen und Absagen kommen von selbst nach – Sie müssen nichts mehr tun.'),
      h('div', {}, h('p', { class: 'termine-abo__q' }, 'Welche Termine möchten Sie bekommen?'), chips),
      h('div', { class: 'abo-url' }, urlBox),
      h('ol', { class: 'steps' },
        h('li', {}, h('strong', {}, 'iPhone / iPad: '), 'Auf „Abo hinzufügen“ tippen – der Kalender fragt, ob er abonnieren soll. „Abonnieren“ antippen, fertig.'),
        h('li', {}, h('strong', {}, 'Android / Google Kalender: '), '„Adresse kopieren“, dann am Computer in Google Kalender „Weitere Kalender → Per URL“ wählen und einfügen.'),
        h('li', {}, h('strong', {}, 'Outlook / Thunderbird: '), '„Neuer Kalender aus dem Internet“ (bzw. „Im Netzwerk“) wählen und die Adresse einfügen.')),
      h('p', { class: 'muted' }, 'Lieber nur einmal speichern statt abonnieren? Dann „Als Datei herunterladen“ – das ist eine .ics-Datei, die jeder Kalender öffnen kann. Später geänderte Termine kommen dann aber nicht automatisch nach.'),
      can('members.view') ? h('p', { class: 'muted' }, '👥 Als angemeldetes Mitglied bekommen Sie im echten System eine persönliche Abo-Adresse, die zusätzlich die Mitglieder-Termine enthält.') : null,
      h('p', { class: 'muted' }, 'Im Prototyp gibt es diese Abo-Adresse noch nicht – auf dem Server erzeugt das System sie automatisch aus den Terminen.')),
    actions: [
      { label: 'Als Datei herunterladen', icon: '⤓', onClick: (c) => {
        const evs = eventsVisibleToViewer({ from: todayISO(), category: sel || null });
        const n = downloadEventsICS(evs, sel ? `kolping-ramsen-${sel}.ics` : 'kolping-ramsen-termine.ics', { name: sel ? `Kolping Ramsen – ${eventCategory(sel).label}` : 'Kolpingsfamilie Ramsen' });
        toast(`${n} Termine als Kalenderdatei gespeichert.`); c();
      } },
      { label: 'Adresse kopieren', icon: '📋', onClick: (c) => {
        try { navigator.clipboard && navigator.clipboard.writeText(url()).catch(() => {}); } catch { /* egal */ }
        toast('Adresse kopiert.'); c();
      } },
      { label: 'Abo hinzufügen', icon: '🔔', variant: 'primary', onClick: (c) => { c(); toast('Im echten System öffnet sich jetzt Ihr Kalender und fragt nach dem Abo.', { type: 'info' }); } },
    ],
  });
}
