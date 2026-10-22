// =========================================================
// modules/benutzer.js – Benutzer & Rollen, Einladungen (Resend-Vorschau),
// Rollen-Matrix, Änderungsprotokoll (Audit), Postausgang,
// Infoseite „So funktioniert’s“ (auch öffentlich: #/so-funktionierts).
// Regeln & API: siehe CONVENTIONS.md
// =========================================================
import { registerRoute, navigate, rerender } from '../app.js';
import { db, log, nowIso, userName, ACTION_LABELS } from '../store.js';
import { can, currentUser, roleOf, roles, login, PERMISSIONS } from '../auth.js';
import { h, esc, button, badge, toast, modal, field, autosaveIndicator, debounce, formatDate, formatDateTime,
  relativeTime, pageHeader, emptyState, mailHTML, sendMail, showMailPreview, downloadFile, avatar, todayISO } from '../ui.js';
import { notice, registerHelp, trashItem, ADMIN_NAV } from '../admin.js';
import { technikPage } from './benutzer/technik.js';

/* =========================================================
   Grundlagen: Bereiche, Status, kleine Bausteine
   ========================================================= */

/** Verständliche „Bereiche“ (für Rollen-Karten und Matrix „Auf einen Blick“) */
export const ROLE_AREAS = [
  { id: 'website',    icon: '📰', label: 'Neuigkeiten & Seiten der Website', perms: ['site.news.edit', 'site.pages.edit'] },
  { id: 'termine',    icon: '📅', label: 'Termine eintragen',               perms: ['site.events.edit'] },
  { id: 'fotos',      icon: '📷', label: 'Fotos hochladen',                 perms: ['site.media.upload'] },
  { id: 'mitglieder', icon: '👥', label: 'Mitgliederbereich ansehen',       perms: ['members.view'] },
  { id: 'ablage',     icon: '📁', label: 'Dateiablage des Vorstands',       perms: ['files.view', 'files.board', 'files.upload', 'files.delete'] },
  { id: 'protokolle', icon: '📝', label: 'Protokolle lesen & schreiben',    perms: ['protocols.view', 'protocols.edit', 'protocols.approve'] },
  { id: 'rundmail',   icon: '📣', label: 'Rundmail an Mitglieder',          perms: ['mail.send'] },
  { id: 'benutzer',   icon: '🛡', label: 'Benutzer & Rollen verwalten',     perms: ['users.manage'] },
  { id: 'audit',      icon: '🕘', label: 'Änderungsprotokoll einsehen',     perms: ['audit.view'] },
  { id: 'loeschen',   icon: '🗑', label: 'Endgültig löschen',               perms: ['trash.purge'] },
];
/** 'yes' | 'part' | 'no' */
export function areaStatus(role, area) {
  const perms = role ? role.permissions || [] : [];
  const n = area.perms.filter(p => perms.includes(p)).length;
  return n === 0 ? 'no' : n === area.perms.length ? 'yes' : 'part';
}

/** Zusätzliche lesbare Aktions-Bezeichnungen (Kern-Liste wird nur ergänzt, nie überschrieben) */
const EXTRA_LABELS = {
  'user.delete': 'hat Zugang gelöscht', 'user.activate': 'hat Zugang wieder freigeschaltet',
  'user.sessions': 'hat Geräte abgemeldet', 'user.accept': 'hat die Einladung angenommen',
  'user.reset': 'hat Passwort-Link geschickt', 'audit.export': 'hat Änderungsprotokoll heruntergeladen',
  'page.delete': 'hat Seite gelöscht', 'album.delete': 'hat Album gelöscht', 'album.create': 'hat Album angelegt',
  'album.update': 'hat Album geändert', 'protocol.delete': 'hat Protokoll gelöscht', 'event.publish': 'hat Termin veröffentlicht',
  'page.create': 'hat Seite angelegt', 'media.restore': 'hat Foto wiederhergestellt',
};
for (const [k, v] of Object.entries(EXTRA_LABELS)) if (!(k in ACTION_LABELS)) ACTION_LABELS[k] = v;
export function actionLabel(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const verb = String(action).split('.').pop();
  return ({ create: 'hat angelegt', update: 'hat geändert', delete: 'hat gelöscht', upload: 'hat hochgeladen',
    publish: 'hat veröffentlicht', restore: 'hat wiederhergestellt', move: 'hat verschoben' })[verb] || action;
}

const ROLE_PLAIN = {
  admin: 'Technische Betreuung – darf alles, auch Benutzer einladen und endgültig löschen.',
  vorstand: 'Für den Vorstand: Dateiablage, Protokolle, Termine und Rundmails. Keine Benutzerverwaltung.',
  redakteur: 'Pflegt die Website: Neuigkeiten, Seiten, Termine und Fotos. Sieht die Ablage des Vorstands nicht.',
  mitglied: 'Sieht den Mitgliederbereich mit freigegebenen Dokumenten (z. B. Satzung, Einladungen).',
};
const rolePlain = r => (r && (ROLE_PLAIN[r.id] || r.description)) || '';

function roleTag(role) {
  if (!role) return badge('Keine Rolle', 'neutral');
  return h('span', { class: 'benutzer-role', style: { '--rc': role.color || '#57534e' } }, role.label);
}

/** Status einer Person: aktiv / eingeladen / gesperrt */
export function userStatus(u) {
  if (u.active === false) return { key: 'blocked', icon: '⛔', label: 'Gesperrt', long: `Zugang gesperrt${u.deactivatedAt ? ' ' + relativeTime(u.deactivatedAt) : ''}` };
  if (u.invitedAt && !u.lastLogin) return { key: 'invited', icon: '✉', label: 'Eingeladen', long: `Eingeladen ${relativeTime(u.invitedAt)} – noch nicht angemeldet` };
  return { key: 'active', icon: '✓', label: 'Aktiv', long: u.lastLogin ? `Zuletzt angemeldet ${relativeTime(u.lastLogin)}` : 'Noch nie angemeldet' };
}
function statusTag(u) {
  const s = userStatus(u);
  return h('span', { class: `benutzer-status benutzer-status--${s.key}` }, h('span', { 'aria-hidden': 'true' }, s.icon), s.label);
}

const isSelf = u => { const c = currentUser(); return !!(c && u && c.id === u.id); };
const activeAdmins = () => db.all('users').filter(u => u.active !== false && u.roleId === 'admin');
/** Rechte-Prüfung vor jeder Aktion (falls zwischendurch die Rolle gewechselt wurde) */
function allowed(perm = 'users.manage') {
  if (can(perm)) return true;
  toast('Dafür fehlt Ihnen das Recht. Bitte wenden Sie sich an den Administrator.', { type: 'error' });
  return false;
}
function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
const AVATAR_COLORS = ['#1e3a8a', '#9a3412', '#166534', '#6d28d9', '#9f1239', '#115e59', '#57534e', '#854d0e'];
const firstNameOf = name => String(name).trim().split(/\s+/)[0] || name;

/* =========================================================
   Zusätzliche Beispieldaten (nur wenn noch nicht vorhanden)
   ========================================================= */
db.seedIfMissing('users', [
  { id: 'u-gerda', name: 'Gerda Platzhalter', firstName: 'Gerda', email: 'gerda.platzhalter@example.org', roleId: 'redakteur',
    title: 'Hat früher die Website gepflegt', initials: 'GP', color: '#6d28d9', active: false,
    lastLogin: '2026-06-30T18:20:00', deactivatedAt: '2026-09-01T09:15:00', deactivatedBy: 'u-stefan', createdAt: '2026-09-01T09:00:00' },
]);
if (!db.meta('benutzer.sessions')) {
  db.meta('benutzer.sessions', {
    'u-stefan': [
      { id: 's-1', icon: '💻', device: 'Laptop', browser: 'Firefox auf Linux', place: 'Ramsen', lastSeen: '2026-10-21T20:14:00' },
      { id: 's-2', icon: '📱', device: 'Handy', browser: 'Safari auf iPhone', place: 'Ramsen', lastSeen: '2026-10-18T07:40:00' },
    ],
    'u-klaus': [
      { id: 's-3', icon: '💻', device: 'Laptop', browser: 'Edge auf Windows', place: 'Ramsen', lastSeen: '2026-10-20T19:02:00' },
      { id: 's-4', icon: '📱', device: 'iPad', browser: 'Safari auf iPad', place: 'Eisenberg (Pfalz)', lastSeen: '2026-10-14T21:20:00' },
    ],
    'u-maria': [
      { id: 's-5', icon: '📱', device: 'iPad', browser: 'Safari auf iPad', place: 'Ramsen', lastSeen: '2026-10-19T10:31:00' },
      { id: 's-6', icon: '💻', device: 'Laptop der Enkelin', browser: 'Chrome auf Windows', place: 'Kaiserslautern', lastSeen: '2026-09-20T10:12:00' },
    ],
    'u-hans': [
      { id: 's-7', icon: '📱', device: 'Handy', browser: 'Chrome auf Android', place: 'Ramsen', lastSeen: '2026-10-11T09:05:00' },
    ],
  });
}
const sessionsOf = id => (db.meta('benutzer.sessions') || {})[id] || [];
function setSessions(id, list) { db.meta('benutzer.sessions', { ...(db.meta('benutzer.sessions') || {}), [id]: list }); }
function thisDevice() {
  const ua = navigator.userAgent || '';
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const phone = /iPhone|Android.*Mobile/.test(ua);
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = ipad ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return { icon: ipad || phone ? '📱' : '💻', device: ipad ? 'iPad' : phone ? 'Handy' : 'Computer', browser: `${browser}${os ? ' auf ' + os : ''}` };
}

/* Beispiel-Mails für den Postausgang */
db.seedIfMissing('mails', [
  { id: 'ml-seed-1', to: 'stefan.beispiel@example.org', toName: 'Stefan Beispiel', kind: 'magic-link', via: 'Resend',
    subject: 'Ihr Anmelde-Link für die Kolping-Website', at: '2026-10-21T20:13:00', createdAt: '2026-10-21T20:13:00',
    html: mailHTML({ heading: 'Guten Tag, Stefan!', text: '<p>Sie möchten sich bei der Verwaltung der Kolping-Website anmelden. Tippen Sie einfach auf den grünen Knopf – ein Passwort brauchen Sie nicht.</p>', ctaLabel: 'Jetzt anmelden',
      footer: 'Der Knopf funktioniert 30 Minuten lang und nur einmal. Sie bleiben danach auf diesem Gerät 180 Tage angemeldet.' }) },
  { id: 'ml-seed-2', to: 'hans.gast@example.org', toName: 'Hans Gast', kind: 'invite', via: 'Resend',
    subject: 'Einladung: Ihr Zugang zur Kolping-Website', at: '2026-09-10T12:00:00', createdAt: '2026-09-10T12:00:00',
    html: mailHTML({ heading: 'Guten Tag, Hans!', text: '<p>Stefan Beispiel hat Sie eingeladen, den Mitgliederbereich der Kolpingsfamilie Ramsen zu nutzen.</p><p>Ihre Rolle: <strong>Mitglied</strong> – Sie sehen dort Satzung, Einladungen und Termine für Mitglieder.</p>', ctaLabel: 'Einladung annehmen',
      footer: 'Der Knopf ist 7 Tage gültig. Ein Passwort brauchen Sie nicht.' }) },
]);

/* =========================================================
   Rollen-Auswahl als große Karten (Einladen, Rolle ändern)
   ========================================================= */
function roleCard(role, { name, checked, disabled, onChange }) {
  const yes = ROLE_AREAS.filter(a => areaStatus(role, a) !== 'no');
  const no = ROLE_AREAS.filter(a => areaStatus(role, a) === 'no');
  const input = h('input', { type: 'radio', name, value: role.id, class: 'benutzer-rolecard__input' });
  input.checked = !!checked; input.disabled = !!disabled;
  input.addEventListener('change', () => { if (input.checked) onChange && onChange(role.id); });
  return h('label', { class: 'benutzer-rolecard', style: { '--rc': role.color || '#57534e' } },
    input,
    h('span', { class: 'benutzer-rolecard__body' },
      h('span', { class: 'benutzer-rolecard__head' },
        h('span', { class: 'benutzer-rolecard__radio', 'aria-hidden': 'true' }),
        h('span', { class: 'benutzer-rolecard__title' }, role.label)),
      h('span', { class: 'benutzer-rolecard__desc' }, rolePlain(role)),
      h('span', { class: 'benutzer-rolecard__lists' },
        h('span', { class: 'benutzer-rolecard__yes' }, h('b', {}, '✓ Darf: '),
          !no.length ? 'alles – in allen Bereichen' : yes.length ? yes.map(a => a.label + (areaStatus(role, a) === 'part' ? ' (teilweise)' : '')).join(' · ') : 'nur ansehen'),
        no.length ? h('span', { class: 'benutzer-rolecard__no' }, h('b', {}, '✗ Darf nicht: '),
          no.map(a => a.id === 'ablage' ? 'Dateiablage des Vorstands (sieht sie nicht einmal)' : a.label).join(' · ')) : null)));
}
function rolePicker({ legend, hint, name, value, disabled, onChange }) {
  const err = h('div', { class: 'field__error', hidden: true });
  const order = ['redakteur', 'vorstand', 'mitglied', 'admin'];
  const list = roles().slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const el = h('fieldset', { class: 'benutzer-rolepick' },
    h('legend', { class: 'field__label' }, legend),
    hint ? h('p', { class: 'field__hint' }, hint) : null,
    err,
    h('div', { class: 'benutzer-rolepick__grid' }, list.map(r => roleCard(r, { name, checked: r.id === value, disabled, onChange: (id) => { err.hidden = true; el.classList.remove('field--invalid'); onChange && onChange(id); } }))));
  return {
    el,
    value: () => { const c = el.querySelector('input:checked'); return c ? c.value : null; },
    setError(msg) { err.hidden = false; err.textContent = msg; el.classList.add('field--invalid'); },
  };
}

/* =========================================================
   Einladungs-Mail
   ========================================================= */
function inviteMailParts({ name, roleId, note }) {
  const inviter = currentUser();
  const r = db.find('roles', roleId);
  const first = firstNameOf(name || 'Vorname');
  return {
    subject: 'Einladung: Ihr Zugang zur Kolping-Website',
    heading: `Guten Tag, ${first}!`,
    text: `<p>${esc(inviter ? inviter.name : 'Der Vorstand')} hat Sie eingeladen, bei der Website der Kolpingsfamilie Ramsen mitzumachen.</p>`
      + (r ? `<p>Ihre Rolle: <strong>${esc(r.label)}</strong><br>${esc(rolePlain(r))}</p>` : '<p>Ihre Rolle: <em>(noch nicht gewählt)</em></p>')
      + (note ? `<blockquote style="margin:12px 0;padding:10px 14px;border-left:4px solid #eb6800;background:#fff8f0">${esc(note).replace(/\n/g, '<br>')}</blockquote>` : '')
      + '<p>Tippen Sie auf den grünen Knopf – ein Passwort brauchen Sie nicht. Beim nächsten Mal geben Sie auf der Website einfach Ihre E-Mail-Adresse ein und bekommen wieder so einen Knopf.</p>',
    cta: 'Einladung annehmen',
    footer: `Der Knopf ist 7 Tage gültig. Sie haben diese Einladung nicht erwartet? Dann löschen Sie sie einfach – es passiert nichts.<br>Bei Fragen: ${esc(inviter ? inviter.name : 'Vorstand')}, Kolpingsfamilie Ramsen.`,
  };
}
function sendInvite(u, { note = '', again = false } = {}) {
  const p = inviteMailParts({ name: u.name, roleId: u.roleId, note });
  return sendMail({
    to: u.email, toName: u.name, kind: 'invite', subject: again ? 'Erinnerung: ' + p.subject : p.subject,
    heading: p.heading, text: p.text, footer: p.footer,
    cta: { label: p.cta, onClick: () => acceptInvite(u.id) },
  });
}
function acceptInvite(id) {
  const u = db.find('users', id);
  if (!u) return;
  if (u.active === false) { toast('Dieser Zugang ist gesperrt – die Einladung gilt nicht mehr.', { type: 'error' }); return; }
  const at = nowIso();
  db.update('users', id, { lastLogin: at, acceptedAt: at });
  setSessions(id, [{ id: 's-' + Date.now().toString(36), ...thisDevice(), place: 'Ramsen', lastSeen: at }, ...sessionsOf(id)]);
  const entry = log('user.accept', u.name, 'erste Anmeldung über den Knopf in der Einladung (in der Demo simuliert)');
  if (entry) db.update('audit', entry.id, { userId: id, updatedAt: entry.at });
  toast(`${u.firstName || u.name} hat die Einladung angenommen und ist jetzt angemeldet (Demo).`, { icon: '🎉' });
  rerender();
}
function sendLoginLink(u) {
  return sendMail({
    to: u.email, toName: u.name, kind: 'magic-link', subject: 'Ihr Anmelde-Link für die Kolping-Website',
    heading: `Guten Tag, ${u.firstName || u.name}!`,
    text: `<p>${esc(currentUser()?.name || 'Der Administrator')} hat Ihnen einen neuen Anmelde-Link geschickt. Tippen Sie einfach auf den grünen Knopf – ein Passwort brauchen Sie nicht.</p>`,
    cta: { label: 'Jetzt anmelden', onClick: () => toast(`Im echten System wäre ${u.firstName || u.name} jetzt auf dem eigenen Gerät angemeldet.`, { type: 'info', icon: '🔑' }) },
    footer: 'Der Knopf funktioniert 30 Minuten lang und nur einmal. Sie bleiben danach auf diesem Gerät 180 Tage angemeldet.',
  });
}
function sendReset(u) {
  log('user.reset', u.name, 'Link zum Zurücksetzen des Passworts');
  return sendMail({
    to: u.email, toName: u.name, kind: 'reset', subject: 'Passwort neu festlegen – Kolping-Website',
    heading: `Guten Tag, ${u.firstName || u.name}!`,
    text: '<p>Für Ihr Konto wurde ein neues Passwort angefordert. Tippen Sie auf den grünen Knopf und legen Sie ein neues Passwort fest.</p><p><strong>Tipp:</strong> Eigentlich brauchen Sie gar kein Passwort – der Anmelde-Link per E-Mail funktioniert immer.</p>',
    cta: { label: 'Neues Passwort festlegen', onClick: () => toast('Im echten System öffnet sich jetzt eine Seite zum Festlegen des Passworts.', { type: 'info' }) },
    footer: 'Der Knopf ist 60 Minuten gültig. Sie haben das nicht angefordert? Dann bleibt alles, wie es ist – löschen Sie die E-Mail einfach.',
  });
}

/* =========================================================
   Benutzerliste  #/admin/benutzer
   ========================================================= */
registerRoute('/admin/benutzer', ({ el }) => {
  const draw = () => {
    const all = db.all('users').slice();
    const order = { invited: 0, active: 1, blocked: 2 };
    all.sort((a, b) => (order[userStatus(a).key] - order[userStatus(b).key]) || a.name.localeCompare(b.name, 'de'));
    const counts = { active: 0, invited: 0, blocked: 0 };
    all.forEach(u => counts[userStatus(u).key]++);
    el.replaceChildren(h('div', { class: 'admin-page benutzer-page' },
      pageHeader({ title: 'Benutzer', intro: 'Wer hat Zugang zur Verwaltung – und mit welcher Rolle? Die Rolle bestimmt, was jemand sehen und tun darf.',
        actions: [button({ label: 'Person einladen', icon: '✉', variant: 'primary', size: 'lg', href: '#/admin/benutzer/einladen' })] }),
      h('p', { class: 'benutzer-counts' },
        h('span', {}, h('b', {}, counts.active), ' aktiv'),
        h('span', {}, h('b', {}, counts.invited), ' eingeladen'),
        h('span', {}, h('b', {}, counts.blocked), ' gesperrt')),
      h('ul', { class: 'admin-list benutzer-list' }, all.map(u => {
        const r = roleOf(u); const s = userStatus(u);
        return h('li', { class: `admin-row benutzer-row benutzer-row--${s.key}` },
          avatar(u, { size: 52 }),
          h('span', { class: 'admin-row__main' },
            h('b', {}, u.name, isSelf(u) ? h('span', { class: 'benutzer-you' }, ' (Sie)') : null),
            h('span', { class: 'admin-row__sub' }, u.email),
            h('span', { class: 'benutzer-row__tags' }, roleTag(r), statusTag(u)),
            h('span', { class: 'admin-row__sub' }, s.long)),
          h('span', { class: 'admin-row__actions' },
            button({ label: 'Ansehen & ändern', icon: '→', href: `#/admin/benutzer/${u.id}` })));
      })),
      h('section', { class: 'dash-box benutzer-more' },
        h('h2', {}, 'Mehr zum Thema Zugang'),
        h('div', { class: 'cluster' },
          button({ label: 'Rollen & Rechte', icon: '🛡', href: '#/admin/rollen' }),
          can('audit.view') ? button({ label: 'Änderungsprotokoll', icon: '🕘', href: '#/admin/aenderungen' }) : null,
          button({ label: 'Postausgang (E-Mails)', icon: '✉️', href: '#/admin/postausgang' }),
          button({ label: 'So funktioniert’s', icon: 'ℹ️', href: '#/admin/technik' })))));
  };
  draw();
  const off = db.subscribe(e => { if (e.coll === 'users') draw(); });
  return off;
}, { permission: 'users.manage', title: 'Benutzer' });

/* =========================================================
   Person einladen  #/admin/benutzer/einladen
   ========================================================= */
registerRoute('/admin/benutzer/einladen', ({ el, query }) => {
  const fName = field({ label: 'Vor- und Nachname', name: 'name', required: true, autocomplete: 'off',
    placeholder: 'z. B. Gerda Beispiel', hint: 'So erscheint die Person in der Verwaltung und in der E-Mail.' });
  const fMail = field({ label: 'E-Mail-Adresse', name: 'email', type: 'email', required: true, autocomplete: 'off', inputmode: 'email',
    placeholder: 'name@beispiel.de', hint: 'Dorthin schicken wir die Einladung mit dem grünen Anmelde-Knopf.' });
  const fNote = field({ label: 'Persönlicher Satz in der E-Mail', name: 'note', type: 'textarea', rows: 3, optional: true,
    placeholder: 'z. B. Schön, dass Du uns bei der Website hilfst!', hint: 'Erscheint in der Einladung über dem grünen Knopf.' });
  const picker = rolePicker({ legend: 'Welche Rolle bekommt die Person?', name: 'invite-role', value: query.rolle || null,
    hint: 'Tippen Sie auf eine Karte. Darauf steht in Klartext, was die Rolle darf – und was nicht.', onChange: () => updatePreview() });

  const pvMeta = h('div', { class: 'mail-preview__meta' });
  const pvBody = h('div', { class: 'mail-preview__body' });
  const preview = h('section', { class: 'benutzer-invite__preview', 'aria-label': 'Vorschau der Einladungs-E-Mail' },
    h('h2', {}, 'So sieht die Einladung aus'),
    h('p', { class: 'muted' }, 'Die Vorschau ändert sich, während Sie tippen.'),
    h('div', { class: 'mail-preview' }, pvMeta, pvBody),
    h('p', { class: 'mail__via' }, 'Versand über Resend · Absender noreply@kolping-ramsen.de · im Prototyp wird nichts verschickt'));
  function updatePreview() {
    const name = fName.value() || 'Vorname Nachname';
    const p = inviteMailParts({ name, roleId: picker.value(), note: fNote.value() });
    pvMeta.replaceChildren(
      h('div', {}, h('b', {}, 'Von:'), ' Kolpingsfamilie Ramsen <noreply@kolping-ramsen.de>'),
      h('div', {}, h('b', {}, 'An:'), ` ${name} <${fMail.value() || 'name@beispiel.de'}>`),
      h('div', {}, h('b', {}, 'Betreff:'), ' ', h('strong', {}, p.subject)));
    pvBody.innerHTML = mailHTML({ heading: p.heading, text: p.text, ctaLabel: p.cta, footer: p.footer });
    const b = pvBody.querySelector('[data-mail-cta]'); if (b) { b.disabled = true; b.title = 'Nur Vorschau'; }
  }
  [fName, fMail, fNote].forEach(f => f.input.addEventListener('input', debounce(updatePreview, 150)));
  updatePreview();

  const submit = (e) => {
    e.preventDefault();
    if (!allowed()) return;
    const name = fName.value().replace(/\s+/g, ' ');
    const email = fMail.value().toLowerCase();
    const roleId = picker.value();
    let bad = null;
    if (name.length < 3) { fName.setError('Bitte den Namen eintragen, z. B. „Gerda Beispiel“.'); bad = bad || fName.input; }
    if (!email) { fMail.setError('Bitte die E-Mail-Adresse eintragen, z. B. gerda@beispiel.de'); bad = bad || fMail.input; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      fMail.setError(email.includes('@') ? 'Da fehlt noch etwas nach dem @ – z. B. „@web.de“ oder „@gmail.com“.' : 'In einer E-Mail-Adresse steht immer ein @, z. B. gerda@beispiel.de'); bad = bad || fMail.input;
    } else {
      const dup = db.all('users').find(u => u.email.toLowerCase() === email);
      if (dup) { fMail.setError(`Diese Adresse hat schon einen Zugang: ${dup.name}. Sie finden die Person in der Benutzerliste.`); bad = bad || fMail.input; }
    }
    if (!roleId) { picker.setError('Bitte eine Rolle antippen.'); bad = bad || picker.el; }
    if (bad) { bad.focus && bad.focus(); bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const used = new Set(db.all('users', { withDeleted: true }).map(u => u.color));
    const u = db.insert('users', {
      name, firstName: firstNameOf(name), email, roleId, title: 'Neu eingeladen', initials: initialsOf(name),
      color: AVATAR_COLORS.find(c => !used.has(c)) || AVATAR_COLORS[name.length % AVATAR_COLORS.length],
      active: true, invitedAt: nowIso(), invitedBy: currentUser()?.id || null, lastLogin: null,
    });
    const r = db.find('roles', roleId);
    log('user.invite', u.name, `Rolle: ${r ? r.label : roleId}`);
    navigate(`#/admin/benutzer/${u.id}`);
    setTimeout(() => {
      sendInvite(u, { note: fNote.value() });
      toast(`Einladung an ${u.name} verschickt (Vorschau).`, { icon: '✉' });
    }, 80);
  };

  el.replaceChildren(h('div', { class: 'admin-page benutzer-page' },
    pageHeader({ title: 'Person einladen', back: { href: '#/admin/benutzer', label: 'Zurück zur Benutzerliste' },
      intro: 'Die Person bekommt eine E-Mail mit einem grünen Knopf. Ein Passwort braucht sie nicht.' }),
    h('div', { class: 'benutzer-invite' },
      h('form', { class: 'admin-card benutzer-invite__form', novalidate: true, onsubmit: submit },
        fName.el, fMail.el, picker.el, fNote.el,
        h('div', { class: 'form-actions' },
          button({ label: 'Einladung verschicken', icon: '✉', variant: 'primary', size: 'lg', type: 'submit' }),
          button({ label: 'Abbrechen', icon: '←', variant: 'ghost', href: '#/admin/benutzer' }))),
      preview)));
}, { permission: 'users.manage', title: 'Person einladen' });

/* =========================================================
   Eine Person  #/admin/benutzer/:id
   ========================================================= */
registerRoute('/admin/benutzer/:id', ({ el, params }) => {
  const id = params.id;
  const saver = autosaveIndicator();
  let fName = null, fMail = null;

  function card(title, ...kids) { return h('section', { class: 'dash-box benutzer-card' }, h('h2', {}, title), ...kids); }

  function draw() {
    const u = db.find('users', id);
    if (!u || u.deletedAt) {
      el.replaceChildren(h('div', { class: 'admin-page' },
        pageHeader({ title: 'Person nicht gefunden', back: { href: '#/admin/benutzer', label: 'Zurück zur Benutzerliste' } }),
        emptyState({ icon: '👤', title: 'Diesen Zugang gibt es nicht (mehr).', text: u && u.deletedAt ? 'Er liegt im Papierkorb und kann dort wiederhergestellt werden.' : 'Vielleicht wurde er gelöscht.',
          action: u && u.deletedAt ? button({ label: 'Zum Papierkorb', icon: '🗑', href: '#/admin/papierkorb' }) : null })));
      return;
    }
    const self = isSelf(u);
    const s = userStatus(u);
    const r = roleOf(u);
    const lastAdmin = u.roleId === 'admin' && activeAdmins().length <= 1;

    // --- Status
    const statusActions = [];
    if (s.key === 'invited') statusActions.push(button({ label: 'Einladung noch einmal schicken', icon: '✉', variant: 'primary', onClick: () => {
      if (!allowed()) return; log('user.invite', u.name, 'Einladung erneut geschickt'); sendInvite(u, { again: true }); } }));
    if (s.key === 'blocked') statusActions.push(button({ label: 'Zugang wieder freischalten', icon: '🔓', variant: 'ok', onClick: () => setActive(u, true) }));
    if (s.key !== 'blocked' && !self) statusActions.push(button({ label: 'Zugang sperren', icon: '⛔', variant: 'danger', onClick: () => setActive(u, false) }));
    const statusCard = card('Status',
      h('p', { class: 'benutzer-statusline' }, statusTag(u), ' ', s.long),
      s.key === 'blocked' ? h('p', { class: 'muted' }, 'Gesperrte Personen können sich nicht mehr anmelden. Alles, was sie geschrieben haben, bleibt erhalten.') : null,
      s.key === 'invited' ? h('p', { class: 'muted' }, 'Die Person hat den grünen Knopf in der Einladung noch nicht angetippt.') : null,
      self ? notice('Das sind Sie selbst. Sich selbst sperren oder die eigene Rolle ändern geht nicht – damit sich niemand aus Versehen aussperrt.', 'calm', 'ℹ️') : null,
      statusActions.length ? h('div', { class: 'cluster' }, statusActions) : null);

    // --- Rolle
    const roleCardEl = card('Rolle',
      (self || lastAdmin) ? notice(self ? 'Ihre eigene Rolle kann nur ein anderer Administrator ändern.' : 'Das ist der einzige Administrator. Laden Sie zuerst einen zweiten ein.', 'calm', '🔒') : null,
      rolePicker({ legend: `Was darf ${u.firstName || u.name}?`, name: `role-${u.id}`, value: u.roleId, disabled: self || lastAdmin || u.active === false,
        hint: 'Tippen Sie auf eine andere Karte – die Änderung gilt sofort und lässt sich rückgängig machen.',
        onChange: (newRole) => changeRole(u, newRole) }).el);

    // --- Name & E-Mail
    fName = field({ label: 'Name', name: 'name', value: u.name, hint: 'Wird automatisch gespeichert.' });
    fMail = field({ label: 'E-Mail-Adresse', name: 'email', type: 'email', value: u.email, inputmode: 'email', hint: 'An diese Adresse gehen Anmelde-Links und Einladungen.' });
    const saveData = debounce(() => {
      if (!allowed()) return;
      const name = fName.value().replace(/\s+/g, ' ');
      const email = fMail.value().toLowerCase();
      if (name.length < 3) { fName.setError('Bitte den vollständigen Namen eintragen.'); saver.error('Nicht gespeichert – bitte Namen prüfen'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { fMail.setError('Das sieht nicht wie eine E-Mail-Adresse aus, z. B. name@beispiel.de'); saver.error('Nicht gespeichert – bitte E-Mail prüfen'); return; }
      const dup = db.all('users').find(x => x.id !== u.id && x.email.toLowerCase() === email);
      if (dup) { fMail.setError(`Diese Adresse gehört schon zu ${dup.name}.`); saver.error('Nicht gespeichert'); return; }
      const cur = db.find('users', id);
      if (cur.name === name && cur.email === email) { saver.saved(); return; }
      db.update('users', id, { name, firstName: firstNameOf(name), initials: initialsOf(name), email });
      saver.saved();
    }, 700);
    [fName, fMail].forEach(f => {
      f.input.addEventListener('input', () => { saver.saving(); saveData(); });
      let startVal = f.input.value;
      f.input.addEventListener('change', () => {
        saveData.flush();
        const cur = db.find('users', id);
        const stored = f === fMail ? cur.email : cur.name;
        if (stored !== startVal && stored.toLowerCase() === f.value().toLowerCase().replace(/\s+/g, ' ')) {
          log('user.update', cur.name, f === fMail ? `E-Mail-Adresse geändert (vorher: ${startVal})` : `Name geändert (vorher: ${startVal})`);
          startVal = stored;
        }
      });
    });
    const dataCard = card('Name & E-Mail', h('div', { class: 'form-grid form-grid--2' }, fName.el, fMail.el), h('div', { class: 'benutzer-saver' }, saver.el));

    // --- Anmeldung
    const loginCard = card('Anmelden',
      h('p', {}, 'Im neuen System gibt es kein Passwort, das man vergessen kann: Wer sich anmelden will, gibt die E-Mail-Adresse ein und bekommt einen grünen Knopf zugeschickt.'),
      u.active === false ? h('p', { class: 'muted' }, 'Gesperrt – es können keine Anmelde-Links verschickt werden.') :
        h('div', { class: 'cluster' },
          button({ label: 'Anmelde-Link schicken', icon: '🔑', onClick: () => { if (allowed()) sendLoginLink(u); } }),
          button({ label: 'Passwort zurücksetzen', icon: '🔁', variant: 'ghost', onClick: () => { if (allowed()) sendReset(u); } })));

    // --- Geräte
    const sess = sessionsOf(u.id);
    const rows = [];
    if (self) rows.push(h('li', { class: 'admin-row benutzer-device benutzer-device--current' },
      h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, thisDevice().icon),
      h('span', { class: 'admin-row__main' }, h('b', {}, `${thisDevice().device} · ${thisDevice().browser}`), h('span', { class: 'admin-row__sub' }, 'Dieses Gerät – gerade in Benutzung')),
      h('span', { class: 'admin-row__actions' }, badge('Dieses Gerät', 'ok', '✓'))));
    for (const d of sess) rows.push(h('li', { class: 'admin-row benutzer-device' },
      h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, d.icon),
      h('span', { class: 'admin-row__main' }, h('b', {}, `${d.device} · ${d.browser}`), h('span', { class: 'admin-row__sub' }, `Zuletzt benutzt ${relativeTime(d.lastSeen)} · ungefähr ${d.place}`)),
      h('span', { class: 'admin-row__actions' }, button({ label: 'Hier abmelden', icon: '🚪', onClick: () => revokeSession(u, d) }))));
    const devCard = card('Angemeldete Geräte',
      h('p', { class: 'muted' }, 'Man bleibt auf einem Gerät 180 Tage angemeldet. Geht ein Tablet verloren, melden Sie es hier ab.'),
      rows.length ? h('ul', { class: 'admin-list' }, rows) : h('p', {}, h('b', {}, 'Auf keinem Gerät angemeldet.')),
      sess.length > 1 ? h('div', { class: 'cluster' }, button({ label: 'Auf allen Geräten abmelden', icon: '🚪', variant: 'danger', onClick: () => revokeAll(u) })) : null);

    // --- Verlauf
    const hist = db.raw.audit.filter(a => a.userId === u.id || (a.target === u.name && /^user\./.test(a.action))).slice(0, 8);
    const histCard = card('Zuletzt gemacht',
      hist.length ? h('ul', { class: 'benutzer-mini-log' }, hist.map(a => h('li', {},
        h('span', { class: 'benutzer-mini-log__at' }, relativeTime(a.at)),
        h('span', {}, h('b', {}, a.userId ? userName(a.userId) : 'Jemand'), ' ', actionLabel(a.action), a.target ? ': ' + a.target : '')))) : h('p', { class: 'muted' }, 'Noch nichts.'),
      can('audit.view') ? button({ label: 'Alles im Änderungsprotokoll', icon: '🕘', href: `#/admin/aenderungen?person=${u.id}` }) : null);

    // --- Löschen
    const delCard = !self && !lastAdmin ? h('section', { class: 'benutzer-delete' },
      button({ label: 'Zugang löschen', icon: '🗑', variant: 'danger', onClick: () => {
        if (!allowed()) return;
        trashItem('users', u.id, `Zugang „${u.name}“`);
        navigate('#/admin/benutzer');
      } }),
      h('span', { class: 'muted' }, 'Kommt in den Papierkorb und lässt sich 30 Tage lang wiederherstellen.')) : null;

    el.replaceChildren(h('div', { class: 'admin-page benutzer-page' },
      pageHeader({ title: u.name, back: { href: '#/admin/benutzer', label: 'Zurück zur Benutzerliste' }, badge: roleTag(r),
        intro: `${u.email}${u.title ? ' · ' + u.title : ''}` }),
      h('div', { class: 'benutzer-detail' },
        h('div', { class: 'benutzer-detail__head' }, avatar(u, { size: 84 }), h('div', {}, h('b', {}, u.name), h('span', { class: 'muted' }, s.long))),
        statusCard, roleCardEl, dataCard, loginCard, devCard, histCard, delCard)));
    saver.idle('Änderungen werden automatisch gespeichert');
  }

  function setActive(u, on) {
    if (!allowed()) return;
    if (!on && isSelf(u)) return;
    if (!on && u.roleId === 'admin' && activeAdmins().length <= 1) { toast('Der einzige Administrator kann nicht gesperrt werden.', { type: 'error' }); return; }
    const prevSessions = sessionsOf(u.id);
    db.update('users', u.id, on ? { active: true, deactivatedAt: null, deactivatedBy: null } : { active: false, deactivatedAt: nowIso(), deactivatedBy: currentUser()?.id || null });
    if (!on) setSessions(u.id, []);
    log(on ? 'user.activate' : 'user.deactivate', u.name, on ? 'kann sich wieder anmelden' : 'auf allen Geräten abgemeldet');
    toast(on ? `${u.name} kann sich wieder anmelden.` : `Zugang von ${u.name} ist gesperrt.`, {
      undo: () => {
        db.update('users', u.id, on ? { active: false, deactivatedAt: nowIso() } : { active: true, deactivatedAt: null, deactivatedBy: null });
        if (!on) setSessions(u.id, prevSessions);
        log(on ? 'user.deactivate' : 'user.activate', u.name, 'Rückgängig gemacht'); draw();
      },
    });
    draw();
  }
  function changeRole(u, newRole) {
    if (!allowed()) { draw(); return; }
    const before = u.roleId;
    if (before === newRole) return;
    const rb = db.find('roles', before), ra = db.find('roles', newRole);
    db.update('users', u.id, { roleId: newRole });
    log('user.role', u.name, `${rb ? rb.label : before} → ${ra ? ra.label : newRole}`);
    const hint = newRole === 'redakteur' ? ' Die Ablage des Vorstands ist für sie/ihn ab sofort unsichtbar.' : newRole === 'vorstand' ? ' Sie/er sieht jetzt die Ablage des Vorstands.' : '';
    toast(`${u.firstName || u.name} ist jetzt „${ra ? ra.label : newRole}“.${hint}`, {
      undo: () => { db.update('users', u.id, { roleId: before }); log('user.role', u.name, `${ra ? ra.label : newRole} → ${rb ? rb.label : before} (rückgängig)`); draw(); },
    });
    draw();
  }
  function revokeSession(u, d) {
    if (!allowed()) return;
    setSessions(u.id, sessionsOf(u.id).filter(x => x.id !== d.id));
    log('user.sessions', u.name, `${d.device} (${d.browser}) abgemeldet`);
    toast(`${d.device} ist abgemeldet. ${u.firstName || u.name} kann sich dort jederzeit mit einem neuen Anmelde-Link wieder anmelden.`);
    draw();
  }
  function revokeAll(u) {
    if (!allowed()) return;
    const n = sessionsOf(u.id).length;
    setSessions(u.id, []);
    log('user.sessions', u.name, `auf allen ${n} Geräten abgemeldet`);
    toast(`${u.firstName || u.name} ist auf allen Geräten abgemeldet.`);
    draw();
  }

  draw();
  const off = db.subscribe(e => {
    // Nur von außen kommende Änderungen neu zeichnen (nicht während man tippt)
    if (e.coll === 'users' && e.id === id && document.activeElement !== fName?.input && document.activeElement !== fMail?.input) draw();
  });
  return () => { off(); };
}, { permission: 'users.manage', title: 'Benutzer' });

/* =========================================================
   Rollen & Rechte  #/admin/rollen
   ========================================================= */
function cell(st, { highlight } = {}) {
  const t = { yes: ['✓', 'Ja'], part: ['◐', 'Teilweise'], no: ['✗', 'Nein'] }[st];
  return h('td', { class: `benutzer-cell benutzer-cell--${st}${highlight ? ' benutzer-cell--hl' : ''}` },
    h('span', { class: 'benutzer-cell__in' }, h('span', { 'aria-hidden': 'true' }, t[0]), ' ', t[1]));
}
function matrixTable({ caption, rows, roleList }) {
  return h('div', { class: 'benutzer-matrix-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
    h('table', { class: 'benutzer-matrix' },
      h('caption', { class: 'sr-only' }, caption),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Bereich'),
        roleList.map(r => h('th', { scope: 'col', style: { '--rc': r.color } },
          h('span', { class: 'benutzer-matrix__role' }, r.short || r.label),
          h('span', { class: 'benutzer-matrix__count' }, `${db.all('users').filter(u => u.roleId === r.id && u.active !== false).length} Pers.`))))),
      h('tbody', {}, rows)));
}
function editRolePerms(role) {
  if (!allowed()) return;
  const groups = [...new Set(PERMISSIONS.map(p => p.group))];
  const checks = {};
  const warn = h('div', { hidden: true });
  const updWarn = () => {
    const boardOn = checks['files.board']?.checked || checks['files.view']?.checked;
    warn.hidden = !(role.id === 'redakteur' && boardOn);
    warn.replaceChildren(notice('Achtung: Damit würden alle Redakteure die Ablage des Vorstands sehen – auch Protokolle und Finanzen. Ist das wirklich gewollt?', 'warn', '⚠'));
  };
  const body = h('div', { class: 'benutzer-permedit' },
    h('p', {}, `Häkchen = die Rolle „${role.label}“ darf das. Änderungen gelten sofort für alle ${db.all('users').filter(u => u.roleId === role.id).length} Personen mit dieser Rolle.`),
    warn,
    groups.map(g => h('fieldset', { class: 'benutzer-permedit__group' },
      h('legend', {}, g),
      PERMISSIONS.filter(p => p.group === g).map(p => {
        const cb = h('input', { type: 'checkbox', value: p.id, onchange: updWarn });
        cb.checked = role.permissions.includes(p.id);
        checks[p.id] = cb;
        return h('label', { class: 'check' }, cb, h('span', {}, p.label, ' ', h('code', { class: 'benutzer-code' }, p.id)));
      }))));
  updWarn();
  modal({
    title: `Rechte der Rolle „${role.label}“ anpassen`, body, wide: true,
    actions: [
      { label: 'Abbrechen', variant: 'ghost' },
      { label: 'Rechte speichern', icon: '✓', variant: 'primary', onClick: (close) => {
        if (!allowed()) return close();
        const before = role.permissions.slice();
        const after = PERMISSIONS.map(p => p.id).filter(id => checks[id].checked);
        const added = after.filter(x => !before.includes(x)), removed = before.filter(x => !after.includes(x));
        close();
        if (!added.length && !removed.length) { toast('Nichts geändert.', { type: 'info' }); return; }
        db.update('roles', role.id, { permissions: after });
        log('role.update', `Rolle „${role.label}“`, [added.length ? '+ ' + added.join(', ') : '', removed.length ? '− ' + removed.join(', ') : ''].filter(Boolean).join(' · '));
        toast(`Rechte der Rolle „${role.label}“ gespeichert.`, { undo: () => { db.update('roles', role.id, { permissions: before }); log('role.update', `Rolle „${role.label}“`, 'Rückgängig gemacht'); rerender(); } });
        rerender();
      } },
    ],
  });
}

registerRoute('/admin/rollen', ({ el }) => {
  const order = ['admin', 'vorstand', 'redakteur', 'mitglied'];
  const roleList = roles().slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const red = roleList.find(r => r.id === 'redakteur');
  const redSeesBoard = red && (red.permissions.includes('files.view') || red.permissions.includes('files.board'));

  const areaRows = ROLE_AREAS.map(a => h('tr', { class: a.id === 'ablage' ? 'benutzer-matrix__hl-row' : null },
    h('th', { scope: 'row' }, h('span', { 'aria-hidden': 'true' }, a.icon, ' '), a.label),
    roleList.map(r => cell(areaStatus(r, a), { highlight: a.id === 'ablage' && r.id === 'redakteur' }))));

  const groups = [...new Set(PERMISSIONS.map(p => p.group))];
  const detailRows = groups.flatMap(g => [
    h('tr', { class: 'benutzer-matrix__group' }, h('th', { colspan: String(roleList.length + 1), scope: 'colgroup' }, g)),
    ...PERMISSIONS.filter(p => p.group === g).map(p => h('tr', { class: p.id.startsWith('files.') ? 'benutzer-matrix__hl-row' : null },
      h('th', { scope: 'row' }, p.label, h('code', { class: 'benutzer-code' }, p.id)),
      roleList.map(r => cell(r.permissions.includes(p.id) ? 'yes' : 'no', { highlight: p.id.startsWith('files.') && r.id === 'redakteur' })))),
  ]);

  const tryAsMaria = () => {
    const maria = db.find('users', 'u-maria');
    if (!maria || maria.active === false) { toast('Maria ist in dieser Demo gerade gesperrt.', { type: 'error' }); return; }
    login('u-maria', { method: 'demo-switch' });
    toast('Demo: Sie sind jetzt Maria Probe (Redaktion).', { type: 'info', icon: '🎭' });
    navigate('#/admin/ablage');
  };

  el.replaceChildren(h('div', { class: 'admin-page benutzer-page' },
    pageHeader({ title: 'Rollen & Rechte', intro: 'Jede Person hat genau eine Rolle. Eine Rolle ist ein Bündel von Rechten. Bei jedem Klick – und im echten System bei jeder Anfrage an den Server – wird geprüft: Darf diese Rolle das?' }),
    h('section', { class: `benutzer-highlight${redSeesBoard ? ' benutzer-highlight--warn' : ''}` },
      h('div', { class: 'benutzer-highlight__icon', 'aria-hidden': 'true' }, '🔒'),
      h('div', {},
        h('h2', {}, redSeesBoard ? 'Achtung: Redakteure sehen gerade die Vorstandsablage!' : 'Redakteure sehen die Vorstandsablage nicht.'),
        h('p', {}, redSeesBoard ? 'Die Rechte der Rolle „Redaktion“ wurden in dieser Demo geändert. Mit „Rechte anpassen“ oder „Demo zurücksetzen“ stellen Sie das wieder her.'
          : 'Nicht nur „gesperrt“, sondern unsichtbar: kein Menüpunkt, keine Treffer in der Suche, nichts im Foto-Auswahldialog. Selbst ein Direktlink zeigt nur „Kein Zugriff“ – und der Versuch landet im Änderungsprotokoll.'),
        h('div', { class: 'cluster' },
          button({ label: 'Selbst ausprobieren: als Maria ansehen', icon: '🎭', onClick: tryAsMaria })))),
    h('section', { class: 'dash-box' },
      h('h2', {}, 'Auf einen Blick: Wer darf was?'),
      matrixTable({ caption: 'Rollen und Bereiche – Übersicht', rows: areaRows, roleList }),
      h('p', { class: 'benutzer-legend muted' }, '✓ Ja = darf das · ◐ Teilweise = darf einen Teil davon · ✗ Nein = sieht den Bereich gar nicht')),
    h('section', { class: 'benutzer-rolecards' }, roleList.map(r => {
      const people = db.all('users').filter(u => u.roleId === r.id && u.active !== false);
      return h('article', { class: 'admin-card benutzer-roleinfo', style: { '--rc': r.color } },
        h('h3', {}, r.label),
        h('p', {}, rolePlain(r)),
        h('p', { class: 'benutzer-roleinfo__people' },
          people.length ? people.map(u => h('a', { href: `#/admin/benutzer/${u.id}`, class: 'benutzer-person' }, avatar(u, { size: 32 }), u.name)) : h('span', { class: 'muted' }, 'Niemand')),
        r.id === 'admin'
          ? h('p', { class: 'muted benutzer-roleinfo__lock' }, '🔒 Der Administrator darf immer alles – sonst könnte sich niemand mehr um Zugänge kümmern.')
          : button({ label: 'Rechte anpassen', icon: '✏️', onClick: () => editRolePerms(db.find('roles', r.id)) }));
    })),
    h('details', { class: 'dash-box benutzer-details' },
      h('summary', {}, 'Alle Einzelrechte anzeigen (für Technik-Interessierte)'),
      h('p', { class: 'muted' }, 'So steht es im Programm: Jedes Recht hat einen Namen wie „files.view“. Eine einzige Prüf-Funktion can("files.view") entscheidet überall – Menü, Suche, Seiten, Downloads.'),
      matrixTable({ caption: 'Alle Rechte je Rolle', rows: detailRows, roleList }))));
}, { permission: 'users.manage', title: 'Rollen & Rechte' });

/* =========================================================
   Änderungsprotokoll  #/admin/aenderungen
   ========================================================= */
const AUDIT_AREAS = [
  { id: 'all',      label: 'Alles' },
  { id: 'login',    label: 'An- & Abmelden',      icon: '🔑', test: a => a === 'user.login' || a === 'user.logout' },
  { id: 'website',  label: 'Website',             icon: '🌐', test: a => /^(news|page|event|media|album)\./.test(a) },
  { id: 'ablage',   label: 'Ablage & Protokolle', icon: '📁', test: a => /^(file|folder|protocol)\./.test(a) },
  { id: 'benutzer', label: 'Benutzer & Rechte',   icon: '🛡', test: a => /^(user|role)\./.test(a) && a !== 'user.login' && a !== 'user.logout' },
  { id: 'mail',     label: 'E-Mails',             icon: '✉️', test: a => a.startsWith('mail.') },
  { id: 'trash',    label: 'Papierkorb',          icon: '🗑', test: a => a.startsWith('trash.') || a.endsWith('.delete') },
  { id: 'denied',   label: 'Abgewiesen',          icon: '🔒', test: a => a === 'access.denied' },
];
const RANGES = [{ id: 'today', label: 'Heute', days: 0 }, { id: '7', label: 'Letzte 7 Tage', days: 7 }, { id: '30', label: 'Letzte 30 Tage', days: 30 }, { id: 'all', label: 'Alles', days: null }];
function auditIcon(a) {
  if (a === 'access.denied') return '🔒';
  const area = AUDIT_AREAS.find(x => x.test && x.test(a));
  return area ? area.icon : '•';
}
function deniedTarget(target) {
  const path = String(target || '').replace(/^#/, '');
  let best = null;
  for (const n of ADMIN_NAV) { const p = n.href.replace(/^#/, ''); if ((path === p || path.startsWith(p + '/')) && (!best || p.length > best.href.length - 1)) best = n; }
  return best ? `Bereich „${best.label}“ (${target})` : target;
}
function dayHeading(day) {
  const today = todayISO();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  return (day === today ? 'Heute · ' : day === yIso ? 'Gestern · ' : '') + formatDate(day, 'long');
}

registerRoute('/admin/aenderungen', ({ el, query }) => {
  const st = { person: query.person || 'all', area: query.bereich || 'all', range: 'all', q: '', limit: 60 };
  const listEl = h('div', { class: 'benutzer-audit', 'aria-live': 'polite' });
  const countEl = h('p', { class: 'benutzer-audit__count' });
  const filtersEl = h('div', { class: 'benutzer-filters' });

  const qField = field({ label: 'Suchen', name: 'q', type: 'search', placeholder: 'z. B. Weinprobe, Maria, Ablage …', hint: 'Sucht in Name, Aktion und Beschreibung.' });
  qField.input.addEventListener('input', debounce(() => { st.q = qField.value().toLowerCase(); st.limit = 60; drawList(); }, 200));

  function chipRow(label, items, key) {
    return h('div', { class: 'benutzer-filter' },
      h('span', { class: 'benutzer-filter__label', id: `flt-${key}` }, label),
      h('div', { class: 'chips', role: 'group', 'aria-labelledby': `flt-${key}` }, items.map(it => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(st[key] === it.id),
        onclick: () => { st[key] = it.id; st.limit = 60; drawFilters(); drawList(); },
      }, it.avatar || (it.icon ? h('span', { 'aria-hidden': 'true' }, it.icon) : null), it.label))));
  }
  function drawFilters() {
    const people = db.all('users', { withDeleted: true }).filter(u => db.raw.audit.some(a => a.userId === u.id));
    filtersEl.replaceChildren(
      chipRow('Wer?', [{ id: 'all', label: 'Alle' }, ...people.map(u => ({ id: u.id, label: u.firstName || u.name, avatar: avatar(u, { size: 26 }) }))], 'person'),
      chipRow('Was?', AUDIT_AREAS, 'area'),
      chipRow('Wann?', RANGES, 'range'));
  }
  function filtered() {
    const area = AUDIT_AREAS.find(a => a.id === st.area);
    const range = RANGES.find(r => r.id === st.range);
    let since = null;
    if (range && range.days != null) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - range.days); since = d; }
    return db.raw.audit.filter(e => {
      if (st.person !== 'all' && e.userId !== st.person) return false;
      if (area && area.test && !area.test(e.action)) return false;
      if (since && new Date(e.at) < since) return false;
      if (st.q) {
        const hay = [e.userId ? userName(e.userId) : '', actionLabel(e.action), e.action, e.target, e.details].join(' ').toLowerCase();
        if (!hay.includes(st.q)) return false;
      }
      return true;
    }).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  function row(e) {
    const u = e.userId ? db.find('users', e.userId) : null;
    const denied = e.action === 'access.denied';
    return h('li', { class: `benutzer-audit__row${denied ? ' benutzer-audit__row--denied' : ''}` },
      h('span', { class: 'benutzer-audit__time' }, String(e.at).slice(11, 16)),
      u ? avatar(u, { size: 40 }) : h('span', { class: 'benutzer-audit__noone', 'aria-hidden': 'true' }, '?'),
      h('span', { class: 'benutzer-audit__main' },
        h('span', {}, h('b', {}, u ? u.name : 'Jemand (nicht angemeldet)'), ' ',
          h('span', { class: 'benutzer-audit__icon', 'aria-hidden': 'true' }, auditIcon(e.action)), ' ',
          actionLabel(e.action), e.target ? ': ' : '', e.target ? h('span', { class: 'benutzer-audit__target' }, denied ? deniedTarget(e.target) : e.target) : null),
        e.details ? h('span', { class: 'benutzer-audit__details' }, e.details) : null));
  }
  function drawList() {
    const list = filtered();
    const denied = list.filter(e => e.action === 'access.denied').length;
    countEl.replaceChildren(h('b', {}, `${list.length} Einträge`), denied ? ` · davon ${denied} abgewiesene Zugriffe` : '');
    if (!list.length) { listEl.replaceChildren(emptyState({ icon: '🕘', title: 'Keine passenden Einträge', text: 'Wählen Sie oben „Alle“ bzw. „Alles“ oder ein anderes Suchwort.' })); return; }
    const shown = list.slice(0, st.limit);
    const days = [];
    for (const e of shown) { const d = String(e.at).slice(0, 10); let g = days.find(x => x.day === d); if (!g) days.push(g = { day: d, items: [] }); g.items.push(e); }
    listEl.replaceChildren(...[
      ...days.map(g => h('section', { class: 'benutzer-audit__day' },
        h('h2', { class: 'benutzer-audit__dayhead' }, dayHeading(g.day)),
        h('ul', { class: 'benutzer-audit__list' }, g.items.map(row)))),
      list.length > shown.length ? h('div', { class: 'benutzer-audit__more' },
        button({ label: `Ältere Einträge anzeigen (${list.length - shown.length} weitere)`, icon: '↓', onClick: () => { st.limit += 60; drawList(); } })) : null].filter(Boolean));
  }
  function exportCsv() {
    if (!allowed('audit.view')) return;
    const list = filtered();
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Zeitpunkt', 'Person', 'Aktion', 'Was', 'Details', 'Technischer Name'].map(q).join(';'),
      ...list.map(e => [formatDateTime(e.at), e.userId ? userName(e.userId) : 'nicht angemeldet', actionLabel(e.action), e.target, e.details, e.action].map(q).join(';'))];
    downloadFile(`aenderungsprotokoll-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    log('audit.export', 'Änderungsprotokoll', `${list.length} Einträge als Tabelle (CSV)`);
    toast('Die Tabelle wurde heruntergeladen – sie lässt sich mit Excel oder LibreOffice öffnen.');
  }

  drawFilters(); drawList();
  el.replaceChildren(h('div', { class: 'admin-page benutzer-page' },
    pageHeader({ title: 'Änderungsprotokoll', intro: 'Wer hat wann was gemacht? Jede Änderung, jede Anmeldung und jeder abgewiesene Zugriff steht hier – automatisch, niemand kann Einträge löschen.' }),
    notice(h('span', {}, 'Das Protokoll füllt sich live: Alles, was Sie in dieser Vorführung tun, erscheint sofort hier. Im echten System werden Einträge 12 Monate aufbewahrt und dann automatisch gelöscht (Datenschutz).'), 'calm', 'ℹ️'),
    h('section', { class: 'dash-box benutzer-audit__filters' }, filtersEl, qField.el,
      h('div', { class: 'cluster' }, countEl, h('span', { class: 'spacer' }), button({ label: 'Als Tabelle herunterladen', icon: '⬇', onClick: exportCsv }))),
    listEl));
  const redraw = debounce(() => { drawFilters(); drawList(); }, 120);
  const off = db.subscribe(e => { if (e.coll === 'audit' || e.type === 'reset') redraw(); });
  return () => { off(); redraw.cancel(); };
}, { permission: 'audit.view', title: 'Änderungsprotokoll' });

/* =========================================================
   Postausgang  #/admin/postausgang
   ========================================================= */
const MAIL_KINDS = {
  'magic-link': { icon: '🔑', label: 'Anmelde-Links' },
  invite:       { icon: '✉️', label: 'Einladungen' },
  reset:        { icon: '🔁', label: 'Passwort' },
  contact:      { icon: '📨', label: 'Kontaktformular' },
  rundmail:     { icon: '📣', label: 'Rundmails' },
};
registerRoute('/admin/postausgang', ({ el }) => {
  let kind = 'all';
  const listEl = h('div', {});
  const chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Art der E-Mail' });
  function draw() {
    const mails = db.all('mails').slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const kinds = ['all', ...Object.keys(MAIL_KINDS).filter(k => mails.some(m => m.kind === k)), ...[...new Set(mails.map(m => m.kind))].filter(k => !MAIL_KINDS[k])];
    if (!kinds.includes(kind)) kind = 'all';
    chipsEl.replaceChildren(...kinds.map(k => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(kind === k), onclick: () => { kind = k; draw(); } },
      k === 'all' ? `Alle (${mails.length})` : [h('span', { 'aria-hidden': 'true' }, MAIL_KINDS[k]?.icon || '✉'), ` ${MAIL_KINDS[k]?.label || k} (${mails.filter(m => m.kind === k).length})`])));
    const list = mails.filter(m => kind === 'all' || m.kind === kind);
    listEl.replaceChildren(list.length ? h('ul', { class: 'admin-list' }, list.map(m => h('li', { class: 'admin-row benutzer-mailrow' },
      h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, MAIL_KINDS[m.kind]?.icon || '✉'),
      h('span', { class: 'admin-row__main' },
        h('b', {}, m.subject),
        h('span', { class: 'admin-row__sub' }, `an ${m.toName ? m.toName + ' <' + m.to + '>' : m.to}`),
        h('span', { class: 'admin-row__sub' }, `${relativeTime(m.at)} · über ${m.via || 'Resend'} · `, h('span', { class: 'benutzer-mailrow__demo' }, 'Vorschau – nicht wirklich verschickt'))),
      h('span', { class: 'admin-row__actions' }, button({ label: 'E-Mail ansehen', icon: '👁', onClick: () => showMailPreview(m) })))))
      : emptyState({ icon: '📭', title: 'Noch keine E-Mails', text: 'Sobald jemand eingeladen wird oder sich anmeldet, erscheint die E-Mail hier.',
        action: button({ label: 'Person einladen', icon: '✉', href: '#/admin/benutzer/einladen' }) }));
  }
  draw();
  el.replaceChildren(h('div', { class: 'admin-page benutzer-page' },
    pageHeader({ title: 'Postausgang', intro: 'Alle E-Mails, die das System verschickt hätte: Einladungen, Anmelde-Links, Passwort-Links, Kontaktanfragen.' }),
    notice(h('div', {},
      h('p', {}, h('b', {}, 'So läuft es im echten System: '), 'Die E-Mails gehen über den Versanddienst Resend raus – Absender ', h('b', {}, 'noreply@kolping-ramsen.de'),
        ', mit SPF- und DKIM-Signatur, damit sie nicht im Spam landen. Hier sieht man dann auch, ob eine E-Mail angekommen ist.'),
      h('p', {}, 'Im Prototyp wird nichts verschickt – Sie sehen nur, was ankommen würde.')), 'info', '✉️'),
    h('section', { class: 'benutzer-mailfilter' }, h('span', { class: 'benutzer-filter__label' }, 'Zeigen:'), chipsEl),
    listEl));
  const off = db.subscribe(e => { if (e.coll === 'mails') draw(); });
  return off;
}, { permission: 'users.manage', title: 'Postausgang' });

/* =========================================================
   So funktioniert’s – in der Verwaltung und öffentlich
   ========================================================= */
registerRoute('/admin/technik', ({ el }) => technikPage(el, { mode: 'admin', roleAreas: ROLE_AREAS, areaStatus, rolePlain }), { permission: '@user', title: 'So funktioniert’s' });
registerRoute('/so-funktionierts', ({ el }) => technikPage(el, { mode: 'public', roleAreas: ROLE_AREAS, areaStatus, rolePlain }), { layout: 'public', title: 'So funktioniert das neue System' });

/* =========================================================
   Hilfe-Texte
   ========================================================= */
registerHelp('/admin/benutzer', { title: 'Benutzer', steps: [
  'Mit „Person einladen“ bekommt jemand eine E-Mail mit grünem Anmelde-Knopf – ohne Passwort.',
  'Die Rolle bestimmt, was die Person sehen und tun darf. Auf jeder Rollen-Karte steht es in Klartext.',
  'Tablet verloren? Person öffnen und bei „Angemeldete Geräte“ auf „Hier abmelden“ tippen.',
  'Wer nicht mehr mitmacht, wird gesperrt – alles, was sie oder er geschrieben hat, bleibt erhalten.'] });
registerHelp('/admin/benutzer/einladen', { title: 'Person einladen', steps: [
  'Namen und E-Mail-Adresse eintragen.', 'Eine Rolle antippen – die Karte sagt, was die Rolle darf und was nicht.',
  'Rechts (bzw. unten) sehen Sie die E-Mail, so wie sie ankommt.', 'Auf „Einladung verschicken“ tippen. Fertig.'] });
registerHelp('/admin/rollen', { title: 'Rollen & Rechte', steps: [
  'Die Tabelle zeigt, welche Rolle welchen Bereich benutzen darf.',
  '„✗ Nein“ heißt: Der Bereich ist für diese Rolle unsichtbar – nicht nur gesperrt.',
  'Mit „Rechte anpassen“ ändern Sie eine Rolle. Das gilt sofort für alle Personen mit dieser Rolle und lässt sich rückgängig machen.'] });
registerHelp('/admin/aenderungen', { title: 'Änderungsprotokoll', steps: [
  'Hier steht automatisch, wer wann was gemacht hat.',
  'Oben auf eine Person, einen Bereich oder einen Zeitraum tippen, um die Liste einzugrenzen.',
  'Rot markiert sind abgewiesene Zugriffe – z. B. wenn jemand einen Link auf die Vorstandsablage öffnet, ohne Vorstand zu sein.'] });
registerHelp('/admin/postausgang', { title: 'Postausgang', steps: [
  'Jede E-Mail, die das System verschickt, steht hier.', 'Mit „E-Mail ansehen“ sehen Sie genau, was angekommen ist.'] });
registerHelp('/admin/technik', { title: 'So funktioniert’s', steps: [
  'Diese Seite erklärt die Technik hinter dem neuen System – für alle, die es genauer wissen wollen.',
  'Für die tägliche Arbeit müssen Sie davon nichts wissen.'] });
