// =========================================================
// public.js – Öffentliche Website (Layout + alle Seiten)
// Liest ausschließlich aus dem Store → Änderungen im Admin
// erscheinen sofort auf der Website.
// =========================================================
import { registerRoute, registerLayout, setGuards, navigate } from './app.js';
import { db, mediaById, eventCategory, eventCategories, folderVisibility, folderPath, folderAlive } from './store.js';
import { can, currentUser, isLoggedIn, logout, canSeeVisibility, hasAdminAccess, renderLogin } from './auth.js';
import { h, html, raw, esc, frag, button, toast, modal, field, formatDate, formatTime, formatBytes, stripHTML, lightbox,
  sendMail, todayISO, fromISODate, MONTHS, WEEKDAYS, toISODate, visibilityBadge, fileIcon, emptyState } from './ui.js';
import { downloadICS } from './ical.js';

/* ---------------------------------------------------------
   Hilfsfunktionen
   --------------------------------------------------------- */
/** <img> zu einer Media-ID. size: 's' (Vorschau, 560px) | 'l' (groß) */
export function mediaImg(id, { size = 's', cls = '', alt, eager = false, sizes } = {}) {
  const m = mediaById(id);
  if (!m) return h('div', { class: `img-fallback ${cls}`, 'aria-hidden': 'true' }, h('img', { src: 'img/kolping-logo.svg', alt: '' }));
  const src = size === 's' ? (m.thumb || m.src) : m.src;
  // Vorschaubild + große Fassung als srcset: auf Retina-Bildschirmen lädt der Browser automatisch die schärfere Datei
  let srcset = null;
  if (size === 's' && m.thumb && m.thumb !== m.src && /^img\//.test(m.thumb) && m.width && m.height) {
    const tw = m.width >= m.height ? Math.min(560, m.width) : Math.round(560 * m.width / m.height);
    srcset = `${m.thumb} ${tw}w, ${m.src} ${m.width}w`;
  }
  return h('img', { src, srcset, alt: alt ?? (m.alt || ''), class: cls, loading: eager ? 'eager' : 'lazy', decoding: 'async',
    width: m.width || null, height: m.height || null, sizes: srcset ? (sizes || '(min-width: 1040px) 400px, (min-width: 720px) 50vw, 100vw') : (sizes || null) });
}
/** Termine, die der aktuelle Besucher sehen darf (veröffentlicht + Sichtbarkeit), sortiert */
export function eventsVisibleToViewer({ from, to, category } = {}) {
  return db.all('events')
    .filter(e => e.status !== 'draft' && canSeeVisibility(e.visibility || 'public'))
    .filter(e => !from || (e.endDate || e.date) >= from)
    .filter(e => !to || e.date <= to)
    .filter(e => !category || e.category === category)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
export function publishedNews() {
  return db.all('news').filter(n => n.status === 'published').sort((a, b) => b.date.localeCompare(a.date));
}
const pagesOf = section => db.all('pages').filter(p => p.section === section && p.status !== 'draft').sort((a, b) => (a.order || 0) - (b.order || 0));
const catChip = (id) => { const c = eventCategory(id); return h('span', { class: 'cat', style: { '--c': c.color } }, c.label); };

function dateBlock(e) {
  const d = fromISODate(e.date);
  return h('div', { class: 'date-block', 'aria-hidden': 'true' },
    h('span', { class: 'date-block__wd' }, WEEKDAYS[d.getDay()].slice(0, 2)),
    h('span', { class: 'date-block__day' }, d.getDate()),
    h('span', { class: 'date-block__mon' }, MONTHS[d.getMonth()].slice(0, 3)));
}
function eventWhen(e) {
  let s = formatDate(e.date, 'long');
  if (e.endDate && e.endDate !== e.date) s += ` bis ${formatDate(e.endDate, 'dayMonth')}`;
  if (e.time) s += `, ${e.time}${e.endTime ? '–' + e.endTime : ''} Uhr`;
  return s;
}
function eventRow(e, { compact = false } = {}) {
  return h('a', { class: `event-row${compact ? ' event-row--compact' : ''}`, href: `#/termine/${e.id}` },
    dateBlock(e),
    h('div', { class: 'event-row__body' },
      h('h3', { class: 'event-row__title' }, e.title),
      h('p', { class: 'event-row__meta' },
        h('span', {}, h('span', { class: 'sr-only' }, formatDate(e.date, 'long') + ', '), e.time ? `🕖 ${e.time} Uhr` : 'ganztägig'),
        e.location ? h('span', {}, `📍 ${e.location}`) : null),
      h('div', { class: 'event-row__tags' }, catChip(e.category),
        e.visibility && e.visibility !== 'public' ? visibilityBadge(e.visibility) : null)),
    h('span', { class: 'event-row__arrow', 'aria-hidden': 'true' }, '→'));
}
function newsCard(n, { large = false } = {}) {
  return h('a', { class: `news-card${large ? ' news-card--large' : ''}`, href: `#/aktuelles/${n.slug}` },
    n.image && mediaById(n.image) ? h('div', { class: 'news-card__img' }, mediaImg(n.image, { size: large ? 'l' : 's' }))
      : h('div', { class: 'news-card__img news-card__img--icon', 'aria-hidden': 'true' }, h('span', {}, n.icon || '📰')),
    h('div', { class: 'news-card__body' },
      h('time', { class: 'news-card__date', datetime: n.date }, formatDate(n.date, 'medium')),
      h('h3', { class: 'news-card__title' }, n.title),
      h('p', { class: 'news-card__teaser' }, n.teaser || stripHTML(n.body).slice(0, 140)),
      h('span', { class: 'news-card__more' }, 'Weiterlesen →')));
}
function sectionHead(kicker, title, link) {
  return h('div', { class: 'section-head' },
    h('div', {}, kicker ? h('p', { class: 'kicker' }, kicker) : null, h('h2', { class: 'section-title' }, title)),
    link ? h('a', { class: 'section-link', href: link.href }, link.label, ' →') : null);
}
function pageHero({ kicker, title, intro, image, crumbs }) {
  return h('header', { class: `page-hero${image ? ' page-hero--image' : ''}` },
    image ? h('div', { class: 'page-hero__media' }, mediaImg(image, { size: 'l', eager: true, alt: '' })) : null,
    h('div', { class: 'container page-hero__inner' },
      crumbs ? h('nav', { class: 'crumbs', 'aria-label': 'Brotkrumen' }, crumbs.map((c, i) => [i ? h('span', { 'aria-hidden': 'true' }, ' › ') : null, c.href ? h('a', { href: c.href }, c.label) : h('span', { 'aria-current': 'page' }, c.label)])) : null,
      kicker ? h('p', { class: 'kicker' }, kicker) : null,
      h('h1', { class: 'page-hero__title' }, title),
      intro ? h('p', { class: 'page-hero__intro' }, intro) : null));
}
const prose = (htmlStr) => { const d = h('div', { class: 'prose' }); d.innerHTML = htmlStr || ''; return d; };

/* ---------------------------------------------------------
   Layouts
   --------------------------------------------------------- */
const NAV = [
  { href: '#/', label: 'Start', match: p => p === '/' },
  { href: '#/aktuelles', label: 'Aktuelles', match: p => p.startsWith('/aktuelles') },
  { href: '#/termine', label: 'Termine', match: p => p.startsWith('/termine') },
  { href: '#/verein', label: 'Verein', match: p => p.startsWith('/verein') },
  { href: '#/bereiche', label: 'Bereiche', match: p => p.startsWith('/bereiche') },
  { href: '#/rueckblick', label: 'Rückblick', match: p => p.startsWith('/rueckblick') },
  { href: '#/kontakt', label: 'Kontakt', match: p => p.startsWith('/kontakt') },
];

function brand() {
  return h('a', { class: 'brand', href: '#/', 'aria-label': 'Kolpingsfamilie Ramsen – zur Startseite' },
    h('img', { class: 'brand__logo', src: 'img/kolping-logo.svg', alt: '', width: 62, height: 40 }),
    h('span', { class: 'brand__text' }, h('span', { class: 'brand__small' }, 'Kolpingsfamilie'), h('span', { class: 'brand__big' }, 'Ramsen')));
}

registerLayout('public', ({ app, path }) => {
  const u = currentUser();
  const menuId = 'pub-menu';
  const toggle = h('button', { class: 'nav-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': menuId },
    h('span', { class: 'nav-toggle__bars', 'aria-hidden': 'true' }), h('span', {}, 'Menü'));
  const nav = h('nav', { class: 'site-nav', id: menuId, 'aria-label': 'Hauptmenü' },
    h('ul', {}, NAV.map(n => h('li', {}, h('a', { href: n.href, 'aria-current': n.match(path) ? 'page' : null }, n.label)))),
    h('div', { class: 'site-nav__extra' },
      u ? h('a', { class: 'btn btn--sm', href: hasAdminAccess() ? '#/admin' : '#/mitglieder' }, h('span', { 'aria-hidden': 'true' }, '👤'), ` ${u.firstName}`)
        : h('a', { class: 'btn btn--sm', href: '#/mitglieder' }, h('span', { 'aria-hidden': 'true' }, '🔑'), ' Mitglieder')));
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('menu-open', open);
  });
  document.body.classList.remove('menu-open');
  const header = h('header', { class: 'site-header' }, h('div', { class: 'container site-header__inner' }, brand(), toggle, nav));
  const main = h('main', { id: 'main', class: 'site-main', tabindex: '-1' });
  const footer = siteFooter();
  app.className = 'layout-public';
  app.replaceChildren(h('a', { class: 'skip-link', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Zum Inhalt springen'), header, main, footer);
  return main;
});

registerLayout('bare', ({ app }) => {
  const main = h('main', { id: 'main', class: 'bare-main', tabindex: '-1' });
  app.className = 'layout-bare';
  app.replaceChildren(main);
  return main;
});

function siteFooter() {
  return h('footer', { class: 'site-footer' },
    h('div', { class: 'container site-footer__grid' },
      h('div', { class: 'site-footer__brand' },
        h('div', { class: 'site-footer__logo' }, h('img', { src: 'img/kolping-logo.svg', alt: 'Kolping', width: 80 })),
        h('p', {}, h('strong', {}, 'Kolpingsfamilie Ramsen'), h('br'), 'Pfarrheim · Klosterhof 7', h('br'), '67305 Ramsen'),
        h('p', {}, h('a', { href: 'mailto:kolping-ramsen@gmx.de' }, 'kolping-ramsen@gmx.de'))),
      h('div', {}, h('h2', { class: 'site-footer__h' }, 'Entdecken'),
        h('ul', {}, NAV.slice(1).map(n => h('li', {}, h('a', { href: n.href }, n.label))))),
      h('div', {}, h('h2', { class: 'site-footer__h' }, 'Mitmachen'),
        h('ul', {},
          h('li', {}, h('a', { href: '#/verein/mitglied-werden' }, 'Mitglied werden')),
          h('li', {}, h('a', { href: '#/bereiche/kolpingskapelle' }, 'In der Kapelle spielen')),
          h('li', {}, h('a', { href: 'https://kolpingtheater-ramsen.de/', target: '_blank', rel: 'noopener' }, 'Theatergruppe ↗')),
          h('li', {}, h('a', { href: '#/termine' }, 'Termine abonnieren')))),
      h('div', {}, h('h2', { class: 'site-footer__h' }, 'Für Mitglieder'),
        h('ul', {},
          h('li', {}, h('a', { href: '#/mitglieder' }, 'Mitgliederbereich')),
          h('li', {}, h('a', { href: '#/admin' }, 'Verwaltung (Anmelden)')),
          h('li', {}, h('a', { href: '#/impressum' }, 'Impressum')),
          h('li', {}, h('a', { href: '#/datenschutz' }, 'Datenschutz'))))),
    h('div', { class: 'container site-footer__bottom' },
      h('span', {}, '© 2026 Kolpingsfamilie Ramsen · Teil des Kolpingwerks Diözesanverband Speyer'),
      h('span', {}, 'Klickbarer Prototyp – Beispieldaten')));
}

/* ---------------------------------------------------------
   Startseite
   --------------------------------------------------------- */
registerRoute('/', ({ el }) => {
  const today = todayISO();
  const upcoming = eventsVisibleToViewer({ from: today }).slice(0, 4);
  const news = publishedNews().slice(0, 3);
  const next = upcoming[0];

  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero__media' }, mediaImg('prunksitzung-saal', { size: 'l', eager: true, alt: '' })),
    h('div', { class: 'container hero__inner' },
      h('div', { class: 'hero__copy' },
        h('p', { class: 'hero__kicker' }, h('span', { class: 'hero__bar', 'aria-hidden': 'true' }), h('span', {}, 'Kolpingsfamilie Ramsen ', h('span', { class: 'nowrap' }, '· seit 1953'))),
        h('h1', { class: 'hero__title' }, 'Gemeinsam anpacken, feiern und glauben.'),
        h('p', { class: 'hero__lead' }, 'Über 300 Mitglieder, ein Pfarrheim mit über 500 Jahren Geschichte – und immer etwas los: von der Kolpingskapelle bis zum Open-Air-Theater.'),
        h('div', { class: 'hero__cta' },
          button({ label: 'Nächste Termine', icon: '📅', variant: 'accent', size: 'lg', href: '#/termine' }),
          button({ label: 'Mitglied werden', variant: 'outline-light', size: 'lg', href: '#/verein/mitglied-werden' }))),
      next ? h('a', { class: 'hero__next', href: `#/termine/${next.id}` },
        h('span', { class: 'hero__next-label' }, 'Als Nächstes'),
        h('span', { class: 'hero__next-title' }, next.title),
        h('span', { class: 'hero__next-meta' }, `${formatDate(next.date, 'weekday')}${next.time ? ' · ' + next.time + ' Uhr' : ''}${next.location ? ' · ' + next.location : ''}`)) : null));

  const evSection = h('section', { class: 'section' }, h('div', { class: 'container' },
    sectionHead('Kalender', 'Nächste Termine', { href: '#/termine', label: 'Alle Termine' }),
    upcoming.length ? h('div', { class: 'event-list' }, upcoming.map(e => eventRow(e))) : emptyState({ icon: '📅', title: 'Gerade keine Termine eingetragen' }),
    h('div', { class: 'cluster section-actions' },
      button({ label: 'Termine in meinen Kalender', icon: '⤓', href: '#/termine?abo=1' }))));

  const newsSection = h('section', { class: 'section section--tint' }, h('div', { class: 'container' },
    sectionHead('Aus dem Vereinsleben', 'Aktuelles', { href: '#/aktuelles', label: 'Alle Neuigkeiten' }),
    h('div', { class: 'news-grid' }, news.map((n, i) => newsCard(n, { large: i === 0 })))));

  const bereiche = pagesOf('bereiche');
  const areaSection = h('section', { class: 'section' }, h('div', { class: 'container' },
    sectionHead('Mitmachen', 'Unsere Vereinsbereiche', { href: '#/bereiche', label: 'Alle Bereiche' }),
    h('div', { class: 'area-grid' }, bereiche.map(p => h('a', { class: 'area-card', href: `#/bereiche/${p.slug}` },
      mediaImg(p.image, { size: 's', alt: '', sizes: '(min-width: 900px) 380px, (min-width: 600px) 50vw, 100vw' }),
      h('span', { class: 'area-card__shade', 'aria-hidden': 'true' }),
      h('span', { class: 'area-card__text' }, h('span', { class: 'area-card__kicker' }, p.kicker), h('span', { class: 'area-card__title' }, p.title)))))));

  const stats = h('section', { class: 'stats', 'aria-label': 'Zahlen' }, h('div', { class: 'container stats__grid' },
    [['1953', 'gegründet'], ['300+', 'Mitglieder'], ['1955', 'Kolpingskapelle'], ['14', 'Theaterstücke seit 2016']].map(([n, l]) =>
      h('div', { class: 'stat' }, h('span', { class: 'stat__n' }, n), h('span', { class: 'stat__l' }, l)))));

  const albums = db.all('albums').slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const galSection = h('section', { class: 'section' }, h('div', { class: 'container' },
    sectionHead('Bilder', 'Rückblick', { href: '#/rueckblick', label: 'Alle Alben' }),
    h('div', { class: 'mosaic' }, albums.map(a => h('a', { class: 'mosaic__item', href: `#/rueckblick/${a.id}` },
      mediaImg(a.cover, { size: 's', sizes: '(min-width: 900px) 600px, 100vw' }), h('span', { class: 'mosaic__label' }, a.title))))));

  const heim = db.find('pages', 'p-pfarrheim');
  const heimSection = h('section', { class: 'section section--tint' }, h('div', { class: 'container split' },
    h('div', { class: 'split__media' }, mediaImg('pfarrheim', { size: 'l' })),
    h('div', { class: 'split__text' },
      h('p', { class: 'kicker' }, 'Klosterhof 7'),
      h('h2', { class: 'section-title' }, 'Unser Pfarrheim'),
      h('p', { class: 'lead' }, heim ? heim.intro : ''),
      h('p', {}, 'Saal mit Bühne, Gruppen- und Jugendraum, dazu die Kolpingwiese mit Bouleplatz. Mitglieder mieten günstiger.'),
      button({ label: 'Mehr über das Pfarrheim', variant: 'primary', href: '#/verein/pfarrheim' }))));

  const join = h('section', { class: 'join' }, h('div', { class: 'container join__inner' },
    h('div', {}, h('h2', { class: 'join__title' }, 'Werde Teil der Kolpingsfamilie'),
      h('p', {}, 'Gemeinschaft, Glaube, Musik, Theater und jede Menge Hände, die mit anpacken. Wir freuen uns auf dich!')),
    button({ label: 'Mitglied werden', variant: 'primary', size: 'lg', href: '#/verein/mitglied-werden' })));

  el.replaceChildren(hero, evSection, newsSection, areaSection, stats, galSection, heimSection, join);
}, { title: 'Startseite' });

/* ---------------------------------------------------------
   Aktuelles
   --------------------------------------------------------- */
registerRoute('/aktuelles', ({ el }) => {
  const list = publishedNews();
  el.replaceChildren(
    pageHero({ kicker: 'Aus dem Vereinsleben', title: 'Aktuelles', intro: 'Neuigkeiten, Einladungen und Berichte der Kolpingsfamilie Ramsen.' }),
    h('section', { class: 'section section--tight' }, h('div', { class: 'container' },
      list.length ? h('div', { class: 'news-grid news-grid--list' }, list.map((n, i) => newsCard(n, { large: i === 0 })))
        : emptyState({ icon: '📰', title: 'Noch keine Neuigkeiten' }))));
}, { title: 'Aktuelles' });

registerRoute('/aktuelles/:slug', ({ el, params, setTitle }) => {
  const n = db.findBy('news', x => x.slug === params.slug || x.id === params.slug);
  const preview = n && n.status !== 'published';
  if (!n || (preview && !can('site.news.edit'))) return notFound(el);
  setTitle(n.title);
  const others = publishedNews().filter(x => x.id !== n.id).slice(0, 3);
  el.replaceChildren(
    preview ? h('div', { class: 'preview-banner' }, '👁 Vorschau: Dieser Entwurf ist noch nicht auf der Website zu sehen.') : null,
    h('article', { class: 'article' },
      h('header', { class: 'container article__head' },
        h('nav', { class: 'crumbs', 'aria-label': 'Brotkrumen' }, h('a', { href: '#/aktuelles' }, 'Aktuelles'), h('span', { 'aria-hidden': 'true' }, ' › '), h('span', { 'aria-current': 'page' }, n.title)),
        h('time', { class: 'article__date', datetime: n.date }, formatDate(n.date, 'long')),
        h('h1', { class: 'article__title' }, n.title),
        n.teaser ? h('p', { class: 'article__lead' }, n.teaser) : null),
      n.image ? h('figure', { class: 'container article__figure' }, mediaImg(n.image, { size: 'l', eager: true })) : null,
      h('div', { class: 'container article__body' }, prose(n.body),
        h('p', { class: 'article__back' }, h('a', { href: '#/aktuelles' }, '← Alle Neuigkeiten')))),
    others.length ? h('section', { class: 'section section--tint' }, h('div', { class: 'container' },
      sectionHead('', 'Weitere Neuigkeiten'), h('div', { class: 'news-grid' }, others.map(o => newsCard(o))))) : null);
}, { title: 'Aktuelles' });

/* ---------------------------------------------------------
   Termine (Liste / Monat, Filter, iCal)
   --------------------------------------------------------- */
registerRoute('/termine', ({ el, query }) => {
  const state = { view: query.ansicht === 'monat' ? 'month' : 'list', cat: query.kat || '', past: false, month: null };
  const today = todayISO();
  { const d = new Date(); state.month = new Date(d.getFullYear(), d.getMonth(), 1); }

  const controls = h('div', { class: 'cal-controls' });
  const out = h('div', { class: 'cal-out' });

  function filtered() { return eventsVisibleToViewer({ category: state.cat || null }); }
  function draw() {
    // Steuerleiste
    const viewBtns = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Ansicht' },
      ...[['list', '☰ Liste'], ['month', '▦ Monat']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(state.view === v),
        onclick: () => { state.view = v; draw(); } }, l)));
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Nach Bereich filtern' },
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!state.cat), onclick: () => { state.cat = ''; draw(); } }, 'Alle'),
      eventCategories().filter(c => c.id !== 'vorstand' || can('files.board')).map(c => h('button', { type: 'button', class: 'chip', style: { '--c': c.color },
        'aria-pressed': String(state.cat === c.id), onclick: () => { state.cat = state.cat === c.id ? '' : c.id; draw(); } },
        h('span', { class: 'chip__dot', 'aria-hidden': 'true' }), c.label)));
    controls.replaceChildren(
      h('div', { class: 'cal-controls__row' }, viewBtns, h('div', { class: 'spacer' }),
        button({ label: 'Als Kalenderdatei speichern', icon: '⤓', size: 'sm', onClick: () => {
          const evs = filtered().filter(e => (e.endDate || e.date) >= today);
          downloadICS(evs, state.cat ? `kolping-ramsen-${state.cat}.ics` : 'kolping-ramsen-termine.ics');
          toast(`${evs.length} Termine als Kalenderdatei gespeichert.`);
        } }),
        button({ label: 'Kalender abonnieren', icon: '🔔', size: 'sm', variant: 'primary', onClick: aboDialog })),
      chips);
    // Inhalt
    if (state.view === 'list') drawList(); else drawMonth();
  }
  function drawList() {
    const all = filtered();
    const upcoming = all.filter(e => (e.endDate || e.date) >= today);
    const past = all.filter(e => (e.endDate || e.date) < today).reverse();
    const group = (evs) => {
      const by = new Map();
      for (const e of evs) { const k = e.date.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
      return Array.from(by, ([k, list]) => h('section', { class: 'month-group' },
        h('h2', { class: 'month-group__title' }, formatDate(k + '-01', 'monthYear')),
        h('div', { class: 'event-list' }, list.map(e => eventRow(e)))));
    };
    out.replaceChildren(
      upcoming.length ? h('div', {}, group(upcoming)) : emptyState({ icon: '📅', title: 'Keine kommenden Termine in diesem Bereich' }),
      past.length ? h('div', { class: 'past-toggle' },
        button({ label: state.past ? 'Vergangene Termine ausblenden' : `Vergangene Termine anzeigen (${past.length})`, icon: state.past ? '▲' : '▼', variant: 'ghost',
          onClick: () => { state.past = !state.past; drawList(); } }),
        state.past ? h('div', { class: 'past-list' }, group(past)) : null) : null);
  }
  function drawMonth() {
    const m = state.month; const y = m.getFullYear(), mo = m.getMonth();
    const first = new Date(y, mo, 1); const startOffset = (first.getDay() + 6) % 7; // Montag zuerst
    const days = new Date(y, mo + 1, 0).getDate();
    const evs = filtered();
    const byDay = new Map();
    for (const e of evs) {
      let d = fromISODate(e.date); const end = fromISODate(e.endDate || e.date);
      while (d <= end) { const k = toISODate(d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); d.setDate(d.getDate() + 1); }
    }
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(h('div', { class: 'mcal__cell mcal__cell--empty', 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d++) {
      const iso = toISODate(new Date(y, mo, d, 12));
      const list = byDay.get(iso) || [];
      cells.push(h('div', { class: `mcal__cell${iso === today ? ' is-today' : ''}${list.length ? ' has-events' : ''}` },
        h('span', { class: 'mcal__num' }, d),
        list.map(e => h('a', { class: 'mcal__ev', href: `#/termine/${e.id}`, style: { '--c': eventCategory(e.category).color } },
          h('span', { class: 'mcal__time' }, e.time || ''), ' ', e.title))));
    }
    const monthEvents = evs.filter(e => e.date.slice(0, 7) === iso7(y, mo) || (e.endDate || e.date).slice(0, 7) === iso7(y, mo));
    out.replaceChildren(
      h('div', { class: 'mcal' },
        h('div', { class: 'mcal__head' },
          button({ label: 'Voriger Monat', icon: '‹', size: 'sm', onClick: () => { state.month = new Date(y, mo - 1, 1); drawMonth(); } }),
          h('h2', { class: 'mcal__title', 'aria-live': 'polite' }, `${MONTHS[mo]} ${y}`),
          button({ label: 'Nächster Monat', icon: '›', size: 'sm', onClick: () => { state.month = new Date(y, mo + 1, 1); drawMonth(); } })),
        h('div', { class: 'mcal__grid', role: 'presentation' },
          ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => h('div', { class: 'mcal__wd', 'aria-hidden': 'true' }, d)), cells)),
      h('div', { class: 'mcal__list' }, h('h3', {}, `Alle Termine im ${MONTHS[mo]}`),
        monthEvents.length ? h('div', { class: 'event-list' }, monthEvents.map(e => eventRow(e, { compact: true }))) : h('p', { class: 'muted' }, 'Keine Termine in diesem Monat.')));
  }
  const iso7 = (y, mo) => `${y}-${String(mo + 1).padStart(2, '0')}`;

  el.replaceChildren(
    pageHero({ kicker: 'Kalender', title: 'Termine', intro: 'Alle Veranstaltungen der Kolpingsfamilie – zum Mitnehmen in den eigenen Kalender.' }),
    h('section', { class: 'section section--tight' }, h('div', { class: 'container' }, controls, out)));
  draw();
  if (query.abo) setTimeout(aboDialog, 50);
}, { title: 'Termine' });

function aboDialog() {
  const url = 'webcal://kolping-ramsen.de/termine.ics';
  modal({
    title: 'Termine im eigenen Kalender',
    body: h('div', { class: 'stack' },
      h('p', {}, 'Mit einem Abo stehen alle Termine automatisch in Ihrem Handy- oder Computer-Kalender – und Änderungen kommen von selbst nach.'),
      h('ol', { class: 'steps' },
        h('li', {}, h('strong', {}, 'iPhone / iPad: '), 'Auf „Abo hinzufügen“ tippen – der Kalender fragt, ob er abonnieren soll.'),
        h('li', {}, h('strong', {}, 'Android / Google: '), 'Adresse kopieren und unter „Weitere Kalender → Per URL“ einfügen.'),
        h('li', {}, h('strong', {}, 'Outlook / Thunderbird: '), '„Neuer Kalender aus dem Internet“ wählen und Adresse einfügen.')),
      h('div', { class: 'abo-url' }, h('code', {}, url)),
      h('p', { class: 'muted' }, 'Im Prototyp gibt es diese Adresse noch nicht – auf dem Server erzeugt das System sie automatisch aus den Terminen.')),
    actions: [
      { label: 'Adresse kopieren', icon: '📋', onClick: (c) => { try { navigator.clipboard.writeText(url); } catch { /* egal */ } toast('Adresse kopiert.'); c(); } },
      { label: 'Abo hinzufügen', icon: '🔔', variant: 'primary', onClick: (c) => { c(); toast('Im echten System öffnet sich jetzt Ihr Kalender.', { type: 'info' }); } },
    ],
  });
}

registerRoute('/termine/:id', ({ el, params, setTitle }) => {
  const e = db.find('events', params.id);
  if (!e || e.deletedAt || !canSeeVisibility(e.visibility || 'public') || (e.status === 'draft' && !can('site.events.edit'))) return notFound(el);
  setTitle(e.title);
  const cat = eventCategory(e.category);
  const more = eventsVisibleToViewer({ from: todayISO() }).filter(x => x.id !== e.id).slice(0, 3);
  el.replaceChildren(
    h('article', { class: 'event-detail' },
      h('div', { class: 'container' },
        h('nav', { class: 'crumbs', 'aria-label': 'Brotkrumen' }, h('a', { href: '#/termine' }, 'Termine'), h('span', { 'aria-hidden': 'true' }, ' › '), h('span', { 'aria-current': 'page' }, e.title)),
        h('div', { class: 'event-detail__grid' },
          h('div', {},
            h('div', { class: 'cluster' }, catChip(e.category), e.visibility && e.visibility !== 'public' ? visibilityBadge(e.visibility) : null),
            h('h1', { class: 'event-detail__title' }, e.title),
            h('dl', { class: 'facts' },
              h('div', {}, h('dt', {}, '📅 Wann'), h('dd', {}, eventWhen(e))),
              e.location ? h('div', {}, h('dt', {}, '📍 Wo'), h('dd', {}, e.location)) : null,
              h('div', {}, h('dt', {}, '🏷 Bereich'), h('dd', {}, cat.label))),
            e.description ? prose(e.description) : null,
            h('div', { class: 'cluster' },
              button({ label: 'In meinen Kalender', icon: '⤓', variant: 'primary', onClick: () => { downloadICS([e], `${e.date}-${e.id}.ics`); toast('Kalendereintrag gespeichert.'); } }),
              button({ label: 'Alle Termine', icon: '←', href: '#/termine' }))),
          e.image ? h('figure', { class: 'event-detail__img' }, mediaImg(e.image, { size: 'l', eager: true })) : h('div', { class: 'event-detail__date' }, dateBlock(e))))),
    more.length ? h('section', { class: 'section section--tint' }, h('div', { class: 'container' },
      sectionHead('', 'Weitere Termine', { href: '#/termine', label: 'Alle Termine' }),
      h('div', { class: 'event-list' }, more.map(x => eventRow(x))))) : null);
}, { title: 'Termin' });

/* ---------------------------------------------------------
   Verein & Vereinsbereiche (Seiten aus dem Store)
   --------------------------------------------------------- */
function sectionOverview(section, { title, kicker, intro, base }) {
  return ({ el }) => {
    const list = pagesOf(section);
    el.replaceChildren(
      pageHero({ kicker, title, intro }),
      h('section', { class: 'section section--tight' }, h('div', { class: 'container' },
        h('div', { class: 'tile-grid' }, list.map(p => h('a', { class: 'page-card', href: `#/${base}/${p.slug}` },
          h('div', { class: 'page-card__img' }, p.image ? mediaImg(p.image, { size: 's' }) : h('div', { class: 'page-card__ph', 'aria-hidden': 'true' }, h('img', { src: 'img/kolping-logo.svg', alt: '' }))),
          h('div', { class: 'page-card__body' },
            p.kicker ? h('p', { class: 'kicker' }, p.kicker) : null,
            h('h2', { class: 'page-card__title' }, p.title),
            h('p', {}, p.intro),
            h('span', { class: 'news-card__more' }, 'Mehr erfahren →'))))))));
  };
}
function pageView(section, base, label) {
  return ({ el, params, setTitle }) => {
    const p = db.findBy('pages', x => x.section === section && x.slug === params.slug);
    if (!p || (p.status === 'draft' && !can('site.pages.edit'))) return notFound(el);
    setTitle(p.title);
    const siblings = pagesOf(section);
    el.replaceChildren(
      pageHero({ kicker: p.kicker, title: p.title, intro: p.intro, image: p.image, crumbs: [{ href: `#/${base}`, label }, { label: p.title }] }),
      h('section', { class: 'section section--tight' }, h('div', { class: 'container with-aside' },
        h('div', { class: 'with-aside__main' },
          prose(p.body),
          p.external ? h('p', {}, button({ label: p.external.label + ' ↗', variant: 'primary', size: 'lg', href: p.external.url, attrs: { target: '_blank', rel: 'noopener' } })) : null,
          p.slug === 'mitglied-werden' ? publicDownloads() : null,
          relatedGallery(p)),
        h('aside', { class: 'with-aside__aside', 'aria-label': `Weitere Seiten: ${label}` },
          h('h2', { class: 'aside-title' }, label),
          h('ul', { class: 'aside-nav' }, siblings.map(s => h('li', {}, h('a', { href: `#/${base}/${s.slug}`, 'aria-current': s.id === p.id ? 'page' : null }, s.title)))),
          h('div', { class: 'aside-box' }, h('p', {}, h('strong', {}, 'Fragen?'), h('br'), 'Schreiben Sie uns – wir melden uns.'), button({ label: 'Kontakt', icon: '✉', size: 'sm', href: '#/kontakt' }))))));
  };
}
function relatedGallery(p) {
  const map = { kolpingskapelle: 'a-konzert-2026', theater: 'a-theater-2026', familienkreis: 'a-familie-2025', pfarrheim: 'a-pfarrheim' };
  const a = map[p.slug] ? db.find('albums', map[p.slug]) : null;
  if (!a || a.deletedAt) return null;
  return h('div', { class: 'related-gallery' }, h('h2', {}, 'Bilder'), galleryGrid(a));
}
function publicDownloads() {
  const files = db.all('files').filter(f => folderAlive(f.folderId) && folderVisibility(f.folderId) === 'public' && f.type !== 'protocol');
  if (!files.length) return null;
  return h('div', { class: 'downloads' }, h('h2', {}, 'Formulare zum Herunterladen'),
    h('ul', { class: 'file-list' }, files.map(f => h('li', {}, fileRow(f)))));
}
function fileRow(f) {
  return h('button', { type: 'button', class: 'file-row', onclick: () => toast(`„${f.name}“ – im Prototyp gibt es keine echten Dateien.`, { type: 'info' }) },
    h('span', { class: 'file-row__icon', 'aria-hidden': 'true' }, fileIcon(f.type)),
    h('span', { class: 'file-row__name' }, f.name),
    h('span', { class: 'file-row__size' }, f.size ? formatBytes(f.size) : 'Online-Protokoll'),
    h('span', { class: 'file-row__dl', 'aria-hidden': 'true' }, '⤓'));
}

registerRoute('/verein', sectionOverview('verein', { title: 'Der Verein', kicker: 'Über uns', intro: 'Geschichte, Pfarrheim, Vorstand und alles rund um die Mitgliedschaft.', base: 'verein' }), { title: 'Verein' });
registerRoute('/verein/:slug', pageView('verein', 'verein', 'Verein'), { title: 'Verein' });
registerRoute('/bereiche', sectionOverview('bereiche', { title: 'Vereinsbereiche', kicker: 'Mitmachen', intro: 'Musik, Theater, Jugend, Familien und Junggebliebene – bei uns findet jede Generation ihren Platz.', base: 'bereiche' }), { title: 'Vereinsbereiche' });
registerRoute('/bereiche/:slug', pageView('bereiche', 'bereiche', 'Vereinsbereiche'), { title: 'Vereinsbereiche' });

/* ---------------------------------------------------------
   Rückblick / Galerie
   --------------------------------------------------------- */
function albumMedia(a) { return (a.media || []).map(id => mediaById(id)).filter(m => m && !m.deletedAt); }
function galleryGrid(a) {
  const items = albumMedia(a);
  const lb = items.map(m => ({ src: m.src, alt: m.alt, caption: m.caption || m.alt }));
  return h('div', { class: 'gallery' }, items.map((m, i) => h('button', { type: 'button', class: 'gallery__item', 'aria-label': `Bild vergrößern: ${m.alt || ''}`, onclick: () => lightbox(lb, i) },
    h('img', { src: m.thumb || m.src, alt: m.alt || '', loading: 'lazy', width: m.width, height: m.height }))));
}
registerRoute('/rueckblick', ({ el }) => {
  const albums = db.all('albums').slice().sort((a, b) => b.date.localeCompare(a.date));
  el.replaceChildren(
    pageHero({ kicker: 'Bilder & Berichte', title: 'Rückblick', intro: 'Prunksitzung, Konzert, Theater, Kerwe und vieles mehr – so war es.' }),
    h('section', { class: 'section section--tight' }, h('div', { class: 'container' },
      h('div', { class: 'album-grid' }, albums.map(a => {
        const n = albumMedia(a).length;
        return h('a', { class: 'album-card', href: `#/rueckblick/${a.id}` },
          h('div', { class: 'album-card__img' }, mediaImg(a.cover, { size: 's' }), h('span', { class: 'album-card__count' }, `🖼 ${n} Bilder`)),
          h('div', { class: 'album-card__body' },
            h('time', { class: 'news-card__date', datetime: a.date }, formatDate(a.date, 'monthYear')),
            h('h2', { class: 'album-card__title' }, a.title)));
      })))));
}, { title: 'Rückblick' });
registerRoute('/rueckblick/:id', ({ el, params, setTitle }) => {
  const a = db.find('albums', params.id);
  if (!a || a.deletedAt) return notFound(el);
  setTitle(a.title);
  el.replaceChildren(
    pageHero({ kicker: formatDate(a.date, 'medium'), title: a.title, intro: a.text, crumbs: [{ href: '#/rueckblick', label: 'Rückblick' }, { label: a.title }] }),
    h('section', { class: 'section section--tight' }, h('div', { class: 'container' },
      galleryGrid(a),
      h('p', { class: 'muted gallery-note' }, 'Tipp: Auf ein Bild tippen, um es groß zu sehen. Mit den Pfeiltasten oder Wischen blättern.'),
      h('p', {}, h('a', { href: '#/rueckblick' }, '← Alle Alben')))));
}, { title: 'Rückblick' });

/* ---------------------------------------------------------
   Kontakt (Formular nur Demo → Mail-Vorschau)
   --------------------------------------------------------- */
registerRoute('/kontakt', ({ el }) => {
  const fName = field({ label: 'Ihr Name', name: 'name', autocomplete: 'name' });
  const fMail = field({ label: 'Ihre E-Mail-Adresse', name: 'email', type: 'email', autocomplete: 'email', hint: 'Damit wir Ihnen antworten können.' });
  const fMsg = field({ label: 'Ihre Nachricht', name: 'msg', type: 'textarea', rows: 6 });
  const topics = ['Allgemeine Frage', 'Saal mieten', 'Mitglied werden', 'Kapelle / Theater'];
  let topic = topics[0];
  const topicChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Worum geht es?' }, topics.map(t => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(t === topic),
    onclick: (e) => { topic = t; topicChips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget))); } }, t)));
  const form = h('form', { class: 'contact-form card card--pad', novalidate: true },
    h('p', { class: 'field__label' }, 'Worum geht es?'), topicChips, h('div', { style: { height: '20px' } }),
    fName.el, fMail.el, fMsg.el,
    button({ label: 'Nachricht senden', icon: '✉', variant: 'primary', size: 'lg', type: 'submit' }),
    h('p', { class: 'muted form-note' }, 'Demo: Es wird nichts verschickt. Sie sehen, welche E-Mail beim Verein ankäme.'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    if (!fName.value()) { fName.setError('Bitte geben Sie Ihren Namen ein.'); ok = false; }
    if (!/^\S+@\S+\.\S+$/.test(fMail.value())) { fMail.setError('Bitte prüfen Sie die E-Mail-Adresse – z. B. name@beispiel.de'); ok = false; }
    if (fMsg.value().length < 5) { fMsg.setError('Bitte schreiben Sie uns kurz, worum es geht.'); ok = false; }
    if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
    sendMail({ to: 'kolping-ramsen@gmx.de', toName: 'Kolpingsfamilie Ramsen', kind: 'contact', subject: `Kontaktformular: ${topic}`,
      heading: 'Neue Nachricht über die Website',
      text: html`<p><strong>Von:</strong> ${fName.value()} &lt;${fMail.value()}&gt;<br><strong>Thema:</strong> ${topic}</p><blockquote style="border-left:4px solid #eb6800;margin:0;padding:8px 14px;background:#fff8f0">${raw(esc(fMsg.value()).replace(/\n/g, '<br>'))}</blockquote>`,
      footer: 'Antworten Sie einfach auf diese E-Mail – die Antwort geht direkt an den Absender.' });
    form.replaceChildren(h('div', { class: 'success-box' }, h('div', { class: 'success-box__icon', 'aria-hidden': 'true' }, '✓'),
      h('h2', {}, 'Danke für Ihre Nachricht!'), h('p', {}, 'Wir melden uns so bald wie möglich.'), button({ label: 'Zur Startseite', href: '#/' })));
  });
  el.replaceChildren(
    pageHero({ kicker: 'Wir freuen uns auf Sie', title: 'Kontakt', intro: 'Fragen zum Verein, zur Saalmiete oder zur Mitgliedschaft? Schreiben Sie uns.' }),
    h('section', { class: 'section section--tight' }, h('div', { class: 'container contact' },
      form,
      h('aside', { class: 'contact__aside' },
        h('div', { class: 'card card--pad' },
          h('h2', { class: 'aside-title' }, 'Pfarrheim Ramsen'),
          h('p', {}, 'Klosterhof 7', h('br'), '67305 Ramsen'),
          h('p', {}, '✉ ', h('a', { href: 'mailto:kolping-ramsen@gmx.de' }, 'kolping-ramsen@gmx.de')),
          button({ label: 'Route planen ↗', size: 'sm', href: 'https://www.openstreetmap.org/search?query=Klosterhof%207%2C%2067305%20Ramsen', attrs: { target: '_blank', rel: 'noopener' } })),
        h('div', { class: 'contact__img' }, mediaImg('pfarrheim', { size: 's' })),
        h('div', { class: 'card card--pad' },
          h('h2', { class: 'aside-title' }, 'Ansprechpartner'),
          h('p', {}, 'Leitungsteam, Saalvermietung, Kapelle, Jugend – die Namen stehen im echten System unter ', h('a', { href: '#/verein/vorstand' }, 'Vorstand'), '.'))))));
}, { title: 'Kontakt' });

/* ---------------------------------------------------------
   Mitgliederbereich
   --------------------------------------------------------- */
registerRoute('/mitglieder', ({ el }) => {
  const u = currentUser();
  const visibleFolders = db.all('folders').filter(f => folderAlive(f.id) && ['members', 'public'].includes(folderVisibility(f.id)));
  const files = db.all('files').filter(f => visibleFolders.some(v => v.id === f.folderId) && f.type !== 'protocol');
  const byFolder = new Map();
  for (const f of files) { if (!byFolder.has(f.folderId)) byFolder.set(f.folderId, []); byFolder.get(f.folderId).push(f); }
  const memberEvents = eventsVisibleToViewer({ from: todayISO() }).filter(e => e.visibility === 'members');
  el.replaceChildren(
    pageHero({ kicker: 'Mitgliederbereich', title: `Hallo ${u.firstName}!`, intro: 'Hier finden Sie Dokumente und Termine, die nur für Mitglieder bestimmt sind.' }),
    h('section', { class: 'section section--tight' }, h('div', { class: 'container with-aside' },
      h('div', { class: 'with-aside__main stack-lg' },
        h('div', {}, h('h2', {}, 'Dokumente für Mitglieder'),
          byFolder.size ? Array.from(byFolder, ([fid, list]) => {
            const path = folderPath(fid);
            return h('div', { class: 'member-folder' },
              h('div', { class: 'member-folder__head' }, h('h3', {}, '📁 ', path.map(p => p.name).join(' › ')), visibilityBadge(folderVisibility(fid))),
              h('ul', { class: 'file-list' }, list.map(f => h('li', {}, fileRow(f)))));
          }) : emptyState({ icon: '📂', title: 'Noch keine Dokumente freigegeben' })),
        memberEvents.length ? h('div', {}, h('h2', {}, 'Termine nur für Mitglieder'), h('div', { class: 'event-list' }, memberEvents.map(e => eventRow(e)))) : null),
      h('aside', { class: 'with-aside__aside' },
        h('div', { class: 'aside-box' },
          h('p', {}, h('strong', {}, u.name), h('br'), h('span', { class: 'muted' }, u.email)),
          hasAdminAccess() ? button({ label: 'Zur Verwaltung', icon: '⚙', variant: 'primary', href: '#/admin', block: true }) : null,
          h('div', { style: { height: '10px' } }),
          button({ label: 'Abmelden', icon: '⎋', block: true, onClick: () => { logout(); navigate('#/'); toast('Sie sind abgemeldet.'); } })),
        h('div', { class: 'aside-box' }, h('p', {}, '🔒 Vorstands-Unterlagen (Protokolle, Finanzen) sind hier bewusst nicht sichtbar – die liegen in der geschützten Ablage des Vorstands.'))))));
}, { title: 'Mitgliederbereich', permission: 'members.view', layout: 'public' });

/* ---------------------------------------------------------
   Rechtliches, 404, Guards
   --------------------------------------------------------- */
for (const slug of ['impressum', 'datenschutz']) {
  registerRoute('/' + slug, ({ el, setTitle }) => {
    const p = db.findBy('pages', x => x.section === 'static' && x.slug === slug);
    if (!p) return notFound(el);
    setTitle(p.title);
    el.replaceChildren(pageHero({ title: p.title }), h('section', { class: 'section section--tight' }, h('div', { class: 'container narrow' }, prose(p.body))));
  }, { title: slug === 'impressum' ? 'Impressum' : 'Datenschutz' });
}

export function notFound(el) {
  el.replaceChildren(h('section', { class: 'section' }, h('div', { class: 'container narrow notfound' },
    h('p', { class: 'notfound__code', 'aria-hidden': 'true' }, '404'),
    h('h1', {}, 'Diese Seite gibt es nicht (mehr).'),
    h('p', {}, 'Vielleicht wurde sie verschoben oder in den Papierkorb gelegt.'),
    h('div', { class: 'cluster' }, button({ label: 'Zur Startseite', variant: 'primary', href: '#/' }), button({ label: 'Termine', href: '#/termine' })))));
}

setGuards({
  notFound: ({ el }) => notFound(el),
  unauthenticated: ({ el, next, path }) => {
    const reason = path.startsWith('/mitglieder') ? 'Der Mitgliederbereich ist nur für angemeldete Mitglieder.' : null;
    renderLogin(el, { next, navigate, reason });
  },
});
