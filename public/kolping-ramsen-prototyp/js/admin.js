// =========================================================
// admin.js – Verwaltungs-Rahmen (Kopfzeile, Navigation,
// Übersicht mit Aufgaben-Kacheln, Hilfe, Suche, Papierkorb,
// „Kein Zugriff“) + gemeinsame Admin-Helfer für die Module.
// Module (js/modules/*.js) registrieren nur ihre Routen.
// =========================================================
import { registerRoute, registerLayout, setGuards, navigate, currentPath, rerender } from './app.js';
import { db, log, userName, uid, folderVisibility, folderPath, eventCategory } from './store.js';
import { can, currentUser, currentRole, logout, roleSwitcher, toggleFontSize, hasAdminAccess, renderLogin,
  describeRole, permissionLabel, canSeeVisibility, ADMIN_PERMS, roleLabel } from './auth.js';
import { h, button, tile, toast, modal, pageHeader, emptyState, formatDate, todayISO, visibilityBadge, badge,
  formatBytes, relativeTime, confirmDialog, compressImage, compressResult, avatar, stripHTML, fileIcon } from './ui.js';

/* ---------------------------------------------------------
   Navigation (links) – zentral definiert, Module dürfen ergänzen
   --------------------------------------------------------- */
/** „Irgendein Verwaltungsrecht“ – für Seiten, die alle Verwaltenden sehen, aber nicht reine Mitglieder. */
export const ADMIN_ANY = ADMIN_PERMS;

/** Menüpunkte der Verwaltung. permission wie bei registerRoute. group: Überschrift im Menü. */
export const ADMIN_NAV = [
  { id: 'uebersicht',  group: '',            icon: '🏠', label: 'Übersicht',            href: '#/admin',             permission: '@user' },
  { id: 'termine',     group: 'Website',     icon: '📅', label: 'Termine',              href: '#/admin/termine',     permission: 'site.events.edit' },
  { id: 'neuigkeiten', group: 'Website',     icon: '📰', label: 'Neuigkeiten',          href: '#/admin/neuigkeiten', permission: 'site.news.edit' },
  { id: 'seiten',      group: 'Website',     icon: '📄', label: 'Seiten der Website',   href: '#/admin/seiten',      permission: 'site.pages.edit' },
  { id: 'fotos',       group: 'Website',     icon: '📷', label: 'Fotos',                href: '#/admin/fotos',       permission: 'site.media.upload' },
  { id: 'ablage',      group: 'Vorstand',    icon: '📁', label: 'Ablage',               href: '#/admin/ablage',      permission: 'files.view' },
  { id: 'protokolle',  group: 'Vorstand',    icon: '📝', label: 'Protokolle',           href: '#/admin/protokolle',  permission: 'protocols.view' },
  { id: 'benutzer',    group: 'Verwaltung',  icon: '👥', label: 'Benutzer',             href: '#/admin/benutzer',    permission: 'users.manage' },
  { id: 'rollen',      group: 'Verwaltung',  icon: '🛡', label: 'Rollen & Rechte',      href: '#/admin/rollen',      permission: 'users.manage' },
  { id: 'aenderungen', group: 'Verwaltung',  icon: '🕘', label: 'Änderungsprotokoll',   href: '#/admin/aenderungen', permission: 'audit.view' },
  { id: 'postausgang', group: 'Verwaltung',  icon: '✉️', label: 'Postausgang (E-Mails)', href: '#/admin/postausgang', permission: 'users.manage' },
  { id: 'papierkorb',  group: 'Sonstiges',   icon: '🗑', label: 'Papierkorb',           href: '#/admin/papierkorb',  permission: ['site.news.edit', 'site.events.edit', 'site.media.upload', 'site.pages.edit', 'files.delete', 'protocols.edit', 'users.manage'] },
  { id: 'technik',     group: 'Sonstiges',   icon: '⚙️', label: 'So funktioniert’s',    href: '#/admin/technik',     permission: '@user' },
];
/** Menüpunkt hinzufügen/ersetzen (gleiche id ersetzt). */
export function registerAdminNav(item) {
  const i = ADMIN_NAV.findIndex(n => n.id === item.id);
  if (i >= 0) ADMIN_NAV[i] = { ...ADMIN_NAV[i], ...item }; else ADMIN_NAV.push(item);
}

/** Aufgaben-Kacheln der Übersicht (max. 6 sichtbar, nach order). */
export const DASHBOARD_TILES = [
  { id: 'termin',     order: 10, icon: '📅', title: 'Termin eintragen',     text: 'Neue Veranstaltung für die Website',    href: '#/admin/termine/neu',       permission: 'site.events.edit', color: '#eb6800' },
  { id: 'neuigkeit',  order: 20, icon: '📰', title: 'Neuigkeit schreiben',  text: 'Bericht oder Einladung veröffentlichen', href: '#/admin/neuigkeiten/neu',   permission: 'site.news.edit',   color: '#1d4ed8' },
  { id: 'fotos',      order: 30, icon: '📷', title: 'Fotos hochladen',      text: 'Vom Handy oder Tablet – wird verkleinert', href: '#/admin/fotos/hochladen', permission: 'site.media.upload', color: '#15803d' },
  { id: 'protokoll',  order: 15, icon: '📝', title: 'Protokoll schreiben',  text: 'Mit Vorlage, auch gemeinsam',           href: '#/admin/protokolle/neu',    permission: 'protocols.edit',   color: '#7c2d12' },
  { id: 'ablage',     order: 25, icon: '📁', title: 'Dokumente ablegen',    text: 'Ablage des Vorstands öffnen',           href: '#/admin/ablage',            permission: 'files.view',       color: '#57534e' },
  { id: 'seite',      order: 40, icon: '📄', title: 'Seite ändern',         text: 'Texte der Website anpassen',            href: '#/admin/seiten',            permission: 'site.pages.edit',  color: '#6d28d9' },
  { id: 'benutzer',   order: 35, icon: '👥', title: 'Person einladen',      text: 'Zugang per E-Mail verschicken',         href: '#/admin/benutzer/einladen', permission: 'users.manage',     color: '#1e3a8a' },
];
export function registerDashboardTile(t) {
  const i = DASHBOARD_TILES.findIndex(x => x.id === t.id);
  if (i >= 0) DASHBOARD_TILES[i] = { ...DASHBOARD_TILES[i], ...t }; else DASHBOARD_TILES.push(t);
}

/* ---------------------------------------------------------
   Hilfe („❓ Hilfe“ immer oben rechts)
   --------------------------------------------------------- */
const HELP = [];
/**
 * Hilfe-Text für einen Bereich: registerHelp('/admin/termine', {title:'Termine', steps:['…','…'], text:'<p>…</p>'})
 * Es gilt der längste passende Pfad-Anfang.
 */
export function registerHelp(prefix, { title, steps = [], text = '' }) {
  const i = HELP.findIndex(x => x.prefix === prefix);
  const item = { prefix, title, steps, text };
  if (i >= 0) HELP[i] = item; else HELP.push(item);
}
registerHelp('/admin', { title: 'Übersicht', steps: [
  'Tippen Sie auf eine der großen Kacheln – jede Kachel ist genau eine Aufgabe.',
  'Links (bzw. oben auf dem Handy) finden Sie alle Bereiche, die Sie benutzen dürfen.',
  'Alles wird automatisch gespeichert. Gelöschtes liegt 30 Tage im Papierkorb.',
  'Zu klein? Oben auf „A+ Größere Schrift“ tippen.'] });
registerHelp('/admin/termine', { title: 'Termine', steps: [
  'Auf „Termin eintragen“ tippen.', 'Titel, Datum und Uhrzeit eintragen – z. B. „3.11.“ und „19 Uhr“.',
  'Auf „Auf der Website zeigen“ tippen. Fertig – der Termin steht sofort im Kalender.'] });
registerHelp('/admin/neuigkeiten', { title: 'Neuigkeiten', steps: [
  'Auf „Neuigkeit schreiben“ tippen und eine Vorlage wählen.', 'Text schreiben – wie in einem Brief. Mit „Bild“ fügen Sie ein Foto ein.',
  'Mit „So sieht es auf der Website aus“ prüfen, dann „Auf der Website zeigen“.'] });
registerHelp('/admin/seiten', { title: 'Seiten der Website', steps: ['Seite antippen, Text ändern, automatisch gespeichert.', 'Erst „Auf der Website zeigen“ macht die Änderung öffentlich.'] });
registerHelp('/admin/fotos', { title: 'Fotos', steps: [
  'Auf „Fotos auswählen“ tippen – auf dem iPad öffnet sich die Fotomediathek.',
  'Die Fotos werden automatisch verkleinert, damit sie wenig Platz brauchen.',
  'Optional: kurz beschreiben, was auf dem Bild zu sehen ist.'] });
registerHelp('/admin/ablage', { title: 'Ablage', steps: [
  'Ordner antippen, um ihn zu öffnen. Oben sehen Sie immer, wo Sie gerade sind.',
  'Das farbige Schild zeigt, wer den Ordner sehen darf (z. B. „🔒 Nur Vorstand“).',
  'Mit „Datei hochladen“ legen Sie Dokumente ab. Fotos werden automatisch verkleinert.'] });
registerHelp('/admin/protokolle', { title: 'Protokolle', steps: [
  '„Protokoll schreiben“ öffnet eine fertige Vorlage mit Datum, Anwesenden und Tagesordnung.',
  'Andere können gleichzeitig mitschreiben – Sie sehen ihren Namen am Text.',
  'Alles wird automatisch gespeichert. Am Ende auf „Protokoll abschließen“ tippen.'] });
registerHelp('/admin/benutzer', { title: 'Benutzer', steps: ['Mit „Person einladen“ bekommt jemand eine E-Mail mit Anmelde-Knopf.', 'Die Rolle bestimmt, was die Person sehen und tun darf.'] });
registerHelp('/admin/papierkorb', { title: 'Papierkorb', steps: ['Hier liegt alles, was gelöscht wurde – 30 Tage lang.', 'Mit „Wiederherstellen“ ist es wieder da, wo es vorher war.'] });

function helpFor(path) {
  let best = null;
  for (const x of HELP) if ((path === x.prefix || path.startsWith(x.prefix + '/')) && (!best || x.prefix.length > best.prefix.length)) best = x;
  return best;
}
/** Hilfe zum aktuellen Bereich anzeigen */
export function showHelp() {
  const hlp = helpFor(currentPath()) || helpFor('/admin');
  modal({
    title: `Hilfe: ${hlp.title}`,
    body: h('div', { class: 'help' },
      hlp.text ? h('div', { html: hlp.text }) : null,
      hlp.steps.length ? h('ol', { class: 'help__steps' }, hlp.steps.map(s => h('li', {}, s))) : null,
      h('div', { class: 'help__video', 'aria-label': 'Platzhalter für Video-Anleitung' },
        h('span', { class: 'help__play', 'aria-hidden': 'true' }, '▶'),
        h('span', {}, h('strong', {}, 'Kurzes Video (1 Minute)'), h('br'), 'Im echten System zeigt hier ein Video jeden Schritt – mit Untertiteln.')),
      h('div', { class: 'help__contact' },
        h('span', { 'aria-hidden': 'true' }, '☎'),
        h('span', {}, h('strong', {}, 'Bei Fragen: Stefan Beispiel'), ' (technische Hilfe)', h('br'), 'Tel. 0000 / 000 000 – oder einfach beim nächsten Treffen ansprechen.')),
      h('p', { class: 'help__calm' }, '💡 Sie können nichts kaputt machen – alles lässt sich wiederherstellen.')),
    actions: [{ label: 'Verstanden', variant: 'primary' }],
  });
}

/* ---------------------------------------------------------
   Admin-Layout
   --------------------------------------------------------- */
function navActive(item, path) {
  const p = item.href.replace(/^#/, '');
  if (p === '/admin') return path === '/admin';
  return path === p || path.startsWith(p + '/');
}
function adminNav(path) {
  const items = ADMIN_NAV.filter(n => can(n.permission));
  const groups = [];
  for (const it of items) {
    let g = groups.find(x => x.name === it.group);
    if (!g) { g = { name: it.group, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return h('nav', { class: 'admin-nav', 'aria-label': 'Bereiche der Verwaltung' },
    groups.map(g => h('div', { class: 'admin-nav__group' },
      g.name ? h('h2', { class: 'admin-nav__h' }, g.name) : null,
      h('ul', {}, g.items.map(it => h('li', {},
        h('a', { href: it.href, class: 'admin-nav__link', 'aria-current': navActive(it, path) ? 'page' : null },
          h('span', { class: 'admin-nav__icon', 'aria-hidden': 'true' }, it.icon), h('span', {}, it.label))))))));
}

registerLayout('admin', ({ app, path }) => {
  const u = currentUser();
  const role = currentRole();
  const fontBtn = button({ label: document.documentElement.classList.contains('font-lg') ? 'A– Normale Schrift' : 'A+ Größere Schrift',
    attrs: { class: 'admin-tool', 'aria-pressed': String(document.documentElement.classList.contains('font-lg')) },
    onClick: () => { const on = toggleFontSize(); fontBtn.setAttribute('aria-pressed', String(on)); fontBtn.querySelector('.btn__label').textContent = on ? 'A– Normale Schrift' : 'A+ Größere Schrift'; } });
  const header = h('header', { class: 'admin-header' },
    h('div', { class: 'admin-header__inner' },
      h('a', { class: 'admin-brand', href: '#/admin', 'aria-label': 'Zur Übersicht der Verwaltung' },
        h('img', { src: 'img/kolping-logo.svg', alt: '', width: 54, height: 35 }),
        h('span', { class: 'admin-brand__text' }, h('span', {}, 'Kolping Ramsen'), h('b', {}, 'Verwaltung'))),
      u ? h('div', { class: 'admin-user' }, avatar(u, { size: 44 }),
        h('span', { class: 'admin-user__text' }, h('b', {}, u.name), h('span', { class: 'admin-user__role', style: { '--rc': role?.color || '#57534e' } }, roleLabel(u)))) : null,
      h('div', { class: 'admin-tools' },
        fontBtn,
        button({ label: 'Hilfe', icon: '❓', attrs: { class: 'admin-tool admin-tool--help' }, onClick: showHelp }),
        button({ label: 'Zur Website', icon: '🌐', href: '#/', attrs: { class: 'admin-tool' } }),
        u ? button({ label: 'Abmelden', icon: '🚪', attrs: { class: 'admin-tool' }, onClick: () => { logout(); navigate('#/'); toast('Sie sind abgemeldet. Bis bald!'); } }) : null)));
  const main = h('main', { id: 'main', class: 'admin-main', tabindex: '-1' });
  app.className = 'layout-admin';
  app.replaceChildren(
    h('a', { class: 'skip-link', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Zum Inhalt springen'),
    u ? h('div', { class: 'role-switch-wrap' }, h('div', { class: 'admin-container' }, roleSwitcher())) : null,
    header,
    h('div', { class: `admin-body admin-container${path === '/admin' ? ' admin-body--home' : ''}` }, u ? adminNav(path) : null, main));
  // Handy: aktive Person in der (waagrecht scrollbaren) Rollenleiste sichtbar machen
  requestAnimationFrame(() => {
    const list = app.querySelector('.role-switch__list');
    const act = list && list.querySelector('[aria-pressed="true"]');
    if (list && act && list.scrollWidth > list.clientWidth) list.scrollLeft = Math.max(0, act.offsetLeft - list.offsetLeft - 16);
  });
  return main;
});

/* ---------------------------------------------------------
   Anmeldung, Kein Zugriff
   --------------------------------------------------------- */
registerRoute('/admin/login', ({ el, query }) => {
  renderLogin(el, { next: query.next || '#/admin', navigate });
}, { layout: 'bare', title: 'Anmelden' });

/** „Kein Zugriff“-Seite (freundlich, verrät nichts über den Inhalt) */
export function forbiddenPage({ el, permission }) {
  const u = currentUser(); const r = currentRole();
  const perms = [].concat(permission || []);
  el.replaceChildren(h('section', { class: 'forbidden' },
    h('div', { class: 'forbidden__icon', 'aria-hidden': 'true' }, '🔒'),
    h('h1', {}, 'Kein Zugriff'),
    h('p', { class: 'forbidden__lead' }, 'Diese Seite ist für Ihr Konto nicht freigegeben.'),
    u ? h('p', {}, `Sie sind angemeldet als ${u.name} (${roleLabel(u)}). Damit können Sie: `, h('strong', {}, describeRole(r) || '–'), '.') : null,
    h('p', {}, 'Wenn Sie glauben, dass Sie diesen Bereich brauchen, sprechen Sie bitte den Administrator an.'),
    h('div', { class: 'cluster forbidden__actions' },
      button({ label: 'Zurück zur Übersicht', icon: '←', variant: 'primary', size: 'lg', href: '#/admin' }),
      button({ label: 'Zur Website', icon: '🌐', size: 'lg', href: '#/' })),
    h('aside', { class: 'demo-note' },
      h('strong', {}, '🎭 Hinweis für die Vorführung: '),
      `Geprüft wurde das Recht „${perms.map(permissionLabel).join(' / ')}“ (${perms.join(', ')}). `,
      'Der Versuch steht im Änderungsprotokoll. Im echten System prüft der Server jede Anfrage – auch Direktlinks, Suche und Downloads.')));
}

setGuards({
  forbidden: (ctx) => {
    if (ctx.path.startsWith('/admin')) return forbiddenPage(ctx);
    ctx.el.replaceChildren(h('section', { class: 'section' }, h('div', { class: 'container narrow' }, h('div', { class: 'forbidden' },
      h('div', { class: 'forbidden__icon', 'aria-hidden': 'true' }, '🔒'), h('h1', {}, 'Kein Zugriff'),
      h('p', {}, 'Dieser Bereich ist für Ihr Konto nicht freigegeben.'), button({ label: 'Zur Startseite', variant: 'primary', href: '#/' })))));
  },
});

/* ---------------------------------------------------------
   Übersicht (Dashboard)
   --------------------------------------------------------- */
/** Titel in „…“ setzen; innere Anführungszeichen werden zu ‚…‘ (keine doppelten „„) */
const quoted = (s) => `„${String(s || '').replace(/„/g, '‚').replace(/[“”]/g, '‘')}“`;
function greeting() {
  const hr = new Date().getHours();
  return hr < 11 ? 'Guten Morgen' : hr < 18 ? 'Guten Tag' : 'Guten Abend';
}
registerRoute('/admin', ({ el }) => {
  const u = currentUser();
  if (!hasAdminAccess()) {
    el.replaceChildren(h('section', { class: 'admin-page' },
      h('h1', {}, `${greeting()}, ${u.firstName}!`),
      h('div', { class: 'notice notice--info' }, h('p', {}, 'Ihr Zugang ist für den Mitgliederbereich gedacht. Dort finden Sie Dokumente und Termine für Mitglieder.')),
      button({ label: 'Zum Mitgliederbereich', icon: '👥', variant: 'primary', size: 'lg', href: '#/mitglieder' })));
    return;
  }
  const tiles = DASHBOARD_TILES.filter(t => can(t.permission)).sort((a, b) => a.order - b.order).slice(0, 6);

  // „Das wartet auf Sie“
  const todo = [];
  if (can('site.news.edit')) for (const n of db.all('news').filter(n => n.status === 'draft'))
    todo.push({ icon: '📰', text: `Neuigkeit ${quoted(n.title || 'ohne Überschrift')} – Entwurf`, sub: `zuletzt geändert ${relativeTime(n.updatedAt)}`, href: `#/admin/neuigkeiten/${n.id}`, label: 'Weiter schreiben' });
  if (can('protocols.edit')) for (const p of db.all('protocols').filter(p => p.status === 'draft'))
    todo.push({ icon: '📝', text: `Protokoll ${quoted(p.title)} – Entwurf`, sub: (p.editors || []).filter(id => id !== u.id).length ? `${(p.editors || []).filter(id => id !== u.id).map(userName).join(', ')} schreibt mit` : `zuletzt geändert ${relativeTime(p.updatedAt)}`, href: `#/admin/protokolle/${p.id}`, label: 'Weiter schreiben' });
  if (can('site.events.edit')) for (const e of db.all('events').filter(e => e.status === 'draft'))
    todo.push({ icon: '📅', text: `Termin ${quoted(e.title)} – noch nicht auf der Website`, sub: formatDate(e.date, 'long'), href: `#/admin/termine/${e.id}`, label: 'Ansehen' });

  const today = todayISO();
  const upcoming = db.all('events').filter(e => (e.endDate || e.date) >= today && canSeeVisibility(e.visibility || 'public'))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 4);

  const q = h('input', { type: 'search', id: 'dash-search', class: 'field__input', placeholder: 'z. B. Weinprobe, Satzung, Kapelle …', autocomplete: 'off' });
  const searchForm = h('form', { class: 'dash-search', role: 'search', onsubmit: (e) => { e.preventDefault(); navigate(`#/admin/suche?q=${encodeURIComponent(q.value.trim())}`); } },
    h('label', { for: 'dash-search', class: 'field__label' }, 'Etwas suchen'),
    h('div', { class: 'dash-search__row' }, q, button({ label: 'Suchen', icon: '🔎', type: 'submit', variant: 'primary' })));

  el.replaceChildren(h('div', { class: 'admin-page dashboard' },
    h('header', { class: 'dash-head' },
      h('h1', {}, `${greeting()}, ${u.firstName}!`),
      h('p', { class: 'dash-head__sub' }, 'Was möchten Sie tun?')),
    h('div', { class: 'tile-grid-admin' }, tiles.map(t => tile(t))),
    todo.length ? h('section', { class: 'dash-box' },
      h('h2', {}, 'Das wartet auf Sie'),
      h('ul', { class: 'admin-list' }, todo.map(t => h('li', { class: 'admin-row' },
        h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, t.icon),
        h('span', { class: 'admin-row__main' }, h('b', {}, t.text), h('span', { class: 'admin-row__sub' }, t.sub)),
        h('span', { class: 'admin-row__actions' }, button({ label: t.label, icon: '→', href: t.href }))))))
      : null,
    h('section', { class: 'dash-box' },
      h('h2', {}, 'Nächste Termine auf der Website'),
      upcoming.length ? h('ul', { class: 'admin-list' }, upcoming.map(e => h('li', { class: 'admin-row' },
        h('span', { class: 'admin-row__date' }, formatDate(e.date, 'weekday')),
        h('span', { class: 'admin-row__main' }, h('b', {}, e.title),
          h('span', { class: 'admin-row__sub' }, [e.time ? e.time + ' Uhr' : 'ganztägig', e.location].filter(Boolean).join(' · '))),
        h('span', { class: 'admin-row__actions' }, visibilityBadge(e.visibility || 'public'),
          can('site.events.edit') ? button({ label: 'Ändern', icon: '✎', href: `#/admin/termine/${e.id}` }) : null))))
        : emptyState({ icon: '📅', title: 'Keine kommenden Termine' }),
      h('p', {}, can('site.events.edit') ? button({ label: 'Alle Termine anzeigen', icon: '→', href: '#/admin/termine' }) : button({ label: 'Termine auf der Website', icon: '🌐', href: '#/termine' }))),
    searchForm,
    h('div', { class: 'notice notice--calm' }, h('span', { 'aria-hidden': 'true' }, '💡'),
      h('span', {}, h('strong', {}, 'Keine Sorge: '), 'Alles wird automatisch gespeichert, und Gelöschtes liegt 30 Tage im Papierkorb. Sie können nichts kaputt machen.')),
    h('div', { class: 'cluster dash-foot' },
      button({ label: 'Website ansehen', icon: '🌐', href: '#/' }),
      can(ADMIN_NAV.find(n => n.id === 'papierkorb').permission) ? button({ label: 'Papierkorb', icon: '🗑', href: '#/admin/papierkorb' }) : null,
      button({ label: 'So funktioniert’s', icon: '⚙️', href: '#/admin/technik' }))));
}, { permission: '@user', title: 'Verwaltung' });

/* ---------------------------------------------------------
   Suche (zeigt nur, was die Rolle sehen darf)
   --------------------------------------------------------- */
const SEARCH = [];
/**
 * Suchquelle registrieren: registerSearchProvider({id, label, permission, search(q) → [{icon, title, sub, href}]})
 * q ist bereits kleingeschrieben. Quellen ohne Recht werden nicht durchsucht – und nicht genannt.
 */
export function registerSearchProvider(p) {
  const i = SEARCH.findIndex(x => x.id === p.id);
  if (i >= 0) SEARCH[i] = p; else SEARCH.push(p);
}
const has = (q, ...vals) => vals.some(v => String(v || '').toLowerCase().includes(q));
registerSearchProvider({ id: 'events', label: 'Termine', permission: 'site.events.edit',
  search: q => db.all('events').filter(e => canSeeVisibility(e.visibility || 'public') && has(q, e.title, e.location, stripHTML(e.description)))
    .map(e => ({ icon: '📅', title: e.title, sub: formatDate(e.date, 'long'), href: `#/admin/termine/${e.id}` })) });
registerSearchProvider({ id: 'news', label: 'Neuigkeiten', permission: 'site.news.edit',
  search: q => db.all('news').filter(n => has(q, n.title, n.teaser, stripHTML(n.body)))
    .map(n => ({ icon: '📰', title: n.title, sub: (n.status === 'draft' ? 'Entwurf · ' : '') + formatDate(n.date, 'medium'), href: `#/admin/neuigkeiten/${n.id}` })) });
registerSearchProvider({ id: 'pages', label: 'Seiten', permission: 'site.pages.edit',
  search: q => db.all('pages').filter(p => has(q, p.title, p.intro, stripHTML(p.body)))
    .map(p => ({ icon: '📄', title: p.title, sub: 'Seite der Website', href: `#/admin/seiten/${p.id}` })) });
registerSearchProvider({ id: 'media', label: 'Fotos', permission: 'site.media.upload',
  search: q => db.all('media').filter(m => has(q, m.alt, m.caption, m.originalName))
    .map(m => ({ icon: '🖼', title: m.alt || m.originalName, sub: formatBytes(m.size), href: `#/admin/fotos?foto=${m.id}`, thumb: m.thumb || m.src })) });
registerSearchProvider({ id: 'files', label: 'Ablage', permission: 'files.view',
  search: q => db.all('files').filter(f => canSeeVisibility(folderVisibility(f.folderId)) && has(q, f.name, f.note))
    .map(f => ({ icon: fileIcon(f.type), title: f.name, sub: folderPath(f.folderId).map(x => x.name).join(' › '), href: `#/admin/ablage/${f.folderId}` })) });
registerSearchProvider({ id: 'protocols', label: 'Protokolle', permission: 'protocols.view',
  search: q => db.all('protocols').filter(p => has(q, p.title, stripHTML(p.body)))
    .map(p => ({ icon: '📝', title: p.title, sub: p.status === 'draft' ? 'Entwurf' : 'abgeschlossen', href: `#/admin/protokolle/${p.id}` })) });
registerSearchProvider({ id: 'users', label: 'Benutzer', permission: 'users.manage',
  search: q => db.all('users').filter(u => has(q, u.name, u.email))
    .map(u => ({ icon: '👤', title: u.name, sub: u.email, href: `#/admin/benutzer/${u.id}` })) });

registerRoute('/admin/suche', ({ el, query }) => {
  const term = (query.q || '').trim();
  const providers = SEARCH.filter(p => can(p.permission));
  const input = h('input', { type: 'search', id: 'search-q', class: 'field__input', value: term, placeholder: 'Suchbegriff' });
  const form = h('form', { class: 'dash-search', role: 'search', onsubmit: (e) => { e.preventDefault(); navigate(`#/admin/suche?q=${encodeURIComponent(input.value.trim())}`); } },
    h('label', { for: 'search-q', class: 'field__label' }, 'Suchbegriff'),
    h('div', { class: 'dash-search__row' }, input, button({ label: 'Suchen', icon: '🔎', type: 'submit', variant: 'primary' })),
    h('p', { class: 'field__hint' }, `Gesucht wird in: ${providers.map(p => p.label).join(', ')}.`));
  const groups = term.length >= 2 ? providers.map(p => ({ p, items: p.search(term.toLowerCase()) })).filter(g => g.items.length) : [];
  el.replaceChildren(h('div', { class: 'admin-page' },
    pageHeader({ title: 'Suchen' }), form,
    term.length < 2 ? h('p', { class: 'muted' }, 'Bitte mindestens zwei Buchstaben eingeben.')
      : groups.length ? groups.map(g => h('section', { class: 'dash-box' }, h('h2', {}, `${g.p.label} (${g.items.length})`),
        h('ul', { class: 'admin-list' }, g.items.slice(0, 20).map(it => h('li', { class: 'admin-row' },
          it.thumb ? h('img', { class: 'admin-row__thumb', src: it.thumb, alt: '' }) : h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, it.icon),
          h('span', { class: 'admin-row__main' }, h('b', {}, it.title), h('span', { class: 'admin-row__sub' }, it.sub)),
          h('span', { class: 'admin-row__actions' }, button({ label: 'Öffnen', icon: '→', href: it.href })))))))
        : emptyState({ icon: '🔎', title: `Nichts gefunden für „${term}“`, text: 'Versuchen Sie ein anderes Wort – oder nur einen Teil davon.' })));
}, { permission: ADMIN_ANY, title: 'Suchen' });

/* ---------------------------------------------------------
   Papierkorb (alle Bereiche, nach Rechten gefiltert)
   --------------------------------------------------------- */
/** Welche Sammlung braucht welches Recht im Papierkorb, und wie heißt ein Eintrag? */
export const TRASH_TYPES = {
  news:      { label: 'Neuigkeit',  icon: '📰', permission: 'site.news.edit',    title: x => x.title },
  pages:     { label: 'Seite',      icon: '📄', permission: 'site.pages.edit',   title: x => x.title },
  events:    { label: 'Termin',     icon: '📅', permission: 'site.events.edit',  title: x => `${x.title} (${formatDate(x.date, 'short')})`, visible: x => canSeeVisibility(x.visibility || 'public') },
  media:     { label: 'Foto',       icon: '🖼', permission: 'site.media.upload', title: x => x.alt || x.originalName || 'Foto' },
  albums:    { label: 'Album',      icon: '🖼', permission: 'site.media.upload', title: x => x.title },
  files:     { label: 'Datei',      icon: '📄', permission: 'files.delete',      title: x => x.name, visible: x => canSeeVisibility(folderVisibility(x.folderId)) },
  folders:   { label: 'Ordner',     icon: '📁', permission: 'files.delete',      title: x => x.name, visible: x => canSeeVisibility(folderVisibility(x.id)) },
  protocols: { label: 'Protokoll',  icon: '📝', permission: 'protocols.edit',    title: x => x.title },
  users:     { label: 'Benutzer',   icon: '👤', permission: 'users.manage',      title: x => x.name },
};
/** Einheitliches Löschen mit „Rückgängig“-Toast: trashItem('events', id, 'Termin „…“') */
export function trashItem(coll, id, label) {
  const u = currentUser();
  const item = db.remove(coll, id, { by: u ? u.id : null });
  if (!item) return null;
  const t = TRASH_TYPES[coll];
  log(`${coll === 'news' ? 'news' : coll.replace(/s$/, '')}.delete`, label || (t ? `${t.label} „${t.title(item)}“` : id), 'in den Papierkorb gelegt');
  toast(`${label || (t ? t.label : 'Eintrag')} liegt jetzt im Papierkorb.`, { undo: () => { db.restore(coll, id); log('trash.restore', label || id); rerender(); } });
  return item;
}

registerRoute('/admin/papierkorb', ({ el }) => {
  const draw = () => {
    const list = db.trash().filter(({ coll, item }) => {
      const t = TRASH_TYPES[coll]; if (!t || !can(t.permission)) return false;
      return t.visible ? t.visible(item) : true;
    });
    el.replaceChildren(h('div', { class: 'admin-page' },
      pageHeader({ title: 'Papierkorb', intro: 'Gelöschtes bleibt hier 30 Tage liegen und kann jederzeit zurückgeholt werden. Danach wird es automatisch entfernt.' }),
      list.length ? h('ul', { class: 'admin-list' }, list.map(({ coll, item }) => {
        const t = TRASH_TYPES[coll];
        return h('li', { class: 'admin-row' },
          h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, t.icon),
          h('span', { class: 'admin-row__main' }, h('b', {}, t.title(item)),
            h('span', { class: 'admin-row__sub' }, `${t.label} · gelöscht ${relativeTime(item.deletedAt)}${item.deletedBy ? ' von ' + userName(item.deletedBy) : ''}`)),
          h('span', { class: 'admin-row__actions' },
            button({ label: 'Wiederherstellen', icon: '↶', variant: 'primary', onClick: () => {
              // Rechte vor der Aktion erneut prüfen (Rollenwechsel, veraltete Ansicht)
              if (!can(t.permission) || (t.visible && !t.visible(item))) {
                log('access.denied', `Papierkorb: ${t.label}`, `fehlendes Recht: ${t.permission}`);
                toast('Das dürfen Sie mit Ihrem Konto leider nicht.', { type: 'error', icon: '🔒' }); draw(); return;
              }
              // Liegt der Ordner darüber auch im Papierkorb, kommt er mit zurück (sonst wäre die Datei unsichtbar)
              let parents = [];
              if (coll === 'files' || coll === 'folders') {
                parents = folderPath(coll === 'folders' ? item.parentId : item.folderId).filter(f => f.deletedAt);
                for (const f of parents) db.restore('folders', f.id);
              }
              db.restore(coll, item.id);
              log('trash.restore', `${t.label} „${t.title(item)}“`, parents.length ? `mit Ordner ${parents.map(f => '„' + f.name + '“').join(', ')}` : '');
              toast(`${t.label} ist wieder da${parents.length ? ' – samt Ordner „' + parents.map(f => f.name).join('“, „') + '“' : ''}.`); draw();
            } }),
            can('trash.purge') ? button({ label: 'Endgültig löschen', icon: '✕', variant: 'danger', onClick: async () => {
              const ok = await confirmDialog({ title: 'Endgültig löschen?', text: `„${t.title(item)}“ wird für immer gelöscht. Das lässt sich nicht rückgängig machen.`, confirmLabel: 'Ja, endgültig löschen' });
              if (!ok) return;
              db.purge(coll, item.id); log('trash.purge', `${t.label} „${t.title(item)}“`); toast('Endgültig gelöscht.', { type: 'info' }); draw();
            } }) : null));
      })) : emptyState({ icon: '🗑', title: 'Der Papierkorb ist leer', text: 'Wenn Sie etwas löschen, landet es zuerst hier.' }),
      !can('trash.purge') && list.length ? h('p', { class: 'muted' }, 'Endgültig löschen darf nur der Administrator.') : null));
  };
  draw();
}, { permission: ADMIN_NAV.find(n => n.id === 'papierkorb').permission, title: 'Papierkorb' });

/* ---------------------------------------------------------
   Gemeinsame Helfer für Module
   --------------------------------------------------------- */
/** Platzhalter-Seite für noch nicht gebaute Bereiche (nur Stubs) */
export function adminPlaceholder({ el }, { title, intro, module }) {
  el.replaceChildren(h('div', { class: 'admin-page' },
    pageHeader({ title, intro }),
    emptyState({ icon: '🚧', title: 'Dieser Bereich wird gerade gebaut', text: module ? `Modul: ${module}` : '' })));
}

/** Beispielfoto „vom Handy“ als File (für Demos ohne eigene Fotos) */
let demoPhotoBlob = null;
export async function demoPhotoFile() {
  if (!demoPhotoBlob) demoPhotoBlob = makeDemoPhotoBlob();
  const blob = await demoPhotoBlob;
  return new File([blob], 'IMG_2041.JPG', { type: 'image/jpeg', lastModified: Date.now() });
}
/* Die Datei im Ordner img/ ist klein gehalten (1,5 MB, damit die Seite schnell lädt).
   Ein echtes Handyfoto (12 MP, mit Bildrauschen) hat eher 4 MB – das erzeugen wir hier
   einmalig im Browser, damit „vorher → nachher“ realistisch aussieht. */
async function makeDemoPhotoBlob() {
  const res = await fetch('img/demo-handyfoto.jpg');
  const orig = await res.blob();
  try {
    const bm = await createImageBitmap(orig);
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const g = c.getContext('2d'); g.drawImage(bm, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height); const d = id.data; let seed = 2041;
    for (let i = 0; i < d.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const n = ((seed >>> 16) % 17) - 8;          // leichtes Sensorrauschen ±8
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(id, 0, 0);
    const big = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
    return big && big.size > orig.size ? big : orig;
  } catch { return orig; }
}

/**
 * Foto im Browser verkleinern und in die Mediathek (db 'media') legen.
 * addPhotoFromFile(file, {alt, caption, albumId}) → Promise<{media, result}>  (result = compressImage-Ergebnis der großen Fassung)
 */
export async function addPhotoFromFile(file, { alt = '', caption = '', albumId = null } = {}) {
  const big = await compressImage(file, { maxSize: 1600, quality: 0.75 });
  const small = await compressImage(file, { maxSize: 560, quality: 0.7 });
  const u = currentUser();
  const media = db.insert('media', {
    id: uid('m'), src: big.dataUrl, thumb: small.dataUrl, width: big.width, height: big.height,
    size: big.after, thumbSize: small.after, originalSize: big.before, originalName: file.name,
    originalWidth: big.originalWidth, originalHeight: big.originalHeight,
    alt, caption, type: big.type, albumId, uploadedBy: u ? u.id : null,
  });
  if (albumId) { const a = db.find('albums', albumId); if (a) db.update('albums', albumId, { media: [...(a.media || []), media.id] }); }
  log('media.upload', `Foto „${file.name}“`, `${formatBytes(big.before)} → ${formatBytes(big.after)} (−${big.savedPercent} %)`);
  return { media, result: big };
}

/**
 * Foto-Auswahl (nur Website-Fotos aus db 'media' – NIE Dateien der Ablage).
 * mediaPicker({title, onPick(media), allowUpload}) → {close}
 */
export function mediaPicker({ title = 'Foto auswählen', onPick, allowUpload = true } = {}) {
  const grid = h('div', { class: 'picker-grid' });
  const status = h('div', { class: 'picker-status', role: 'status', 'aria-live': 'polite' });
  let m;
  const draw = () => {
    const list = db.all('media').slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    grid.replaceChildren(...list.map(x => h('button', { type: 'button', class: 'picker-item', onclick: () => { m.close(); onPick && onPick(x); } },
      h('img', { src: x.thumb || x.src, alt: '' }),
      h('span', { class: 'picker-item__alt' }, x.alt || x.originalName || 'Foto'),
      h('span', { class: 'picker-item__size' }, formatBytes(x.size)))));
  };
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = input.files[0]; if (!f) return;
    status.replaceChildren('Foto wird verkleinert …');
    try {
      const { media, result } = await addPhotoFromFile(f);
      status.replaceChildren(h('span', {}, '✓ Hochgeladen: '), compressResult(result));
      m.close(); onPick && onPick(media);
      toast(`Foto verkleinert: ${formatBytes(result.before)} → ${formatBytes(result.after)}`);
    } catch (e) { status.textContent = '⚠ ' + (e.message || 'Das Foto konnte nicht geöffnet werden.'); }
  } });
  const body = h('div', {},
    allowUpload && can('site.media.upload') ? h('div', { class: 'picker-upload' },
      button({ label: 'Neues Foto auswählen', icon: '📷', variant: 'primary', onClick: () => input.click() }), input, status) : null,
    grid);
  draw();
  m = modal({ title, body, wide: true });
  return m;
}

/** Kleiner Hinweis-Kasten: notice('Text', 'info'|'ok'|'warn'|'calm'|'demo') */
export function notice(content, kind = 'info', icon) {
  return h('div', { class: `notice notice--${kind}` }, icon ? h('span', { 'aria-hidden': 'true' }, icon) : null, h('div', {}, content));
}

/* ---------------------------------------------------------
   Globale Reaktionen
   --------------------------------------------------------- */
db.subscribe((evt) => {
  if (evt.type === 'storage-full') toast('Der Speicher dieses Browsers ist voll. Die Demo läuft weiter, Änderungen gehen beim Neuladen aber verloren.', { type: 'error', timeout: 9000 });
});
// Ungespeicherte-Änderungen-Warnung: Module setzen window.__kolpingDirty = true/false
window.addEventListener('beforeunload', (e) => { if (window.__kolpingDirty) { e.preventDefault(); e.returnValue = ''; } });

export { eventCategory, visibilityBadge, badge };
