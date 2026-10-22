// =========================================================
// auth.js – Anmeldung (Demo), Rollen & Rechte, Rollenwechsel
// Zentrale Rechteprüfung: can('files.view')
// =========================================================
import { db, log, prefsStore, setAuditUserProvider } from './store.js';
import { h, button, sendMail, showMailPreview, toast, avatar, esc } from './ui.js';
import { PERMISSIONS } from './seed.js';

export { PERMISSIONS };
const SESSION_KEY = 'kolping-proto-session';
const listeners = new Set();

function readSession() { try { return localStorage.getItem(SESSION_KEY); } catch { return memSession; } }
function writeSession(v) {
  memSession = v;
  try { if (v) localStorage.setItem(SESSION_KEY, v); else localStorage.removeItem(SESSION_KEY); } catch { /* nur im Speicher */ }
}
let memSession = null;

/** Angemeldeter Benutzer (Objekt aus db 'users') oder null */
export function currentUser() {
  const id = readSession() || memSession;
  const u = id ? db.find('users', id) : null;
  return u && u.active !== false && !u.deletedAt ? u : null;
}
export function isLoggedIn() { return !!currentUser(); }
/** Rolle eines Benutzers (Objekt aus db 'roles') */
export function roleOf(user) { return user ? db.find('roles', user.roleId) : null; }
export function currentRole() { return roleOf(currentUser()); }
/** Rollenbezeichnung passend zur Person („Redakteurin“ statt „Redakteurin / Redakteur“) */
export function roleLabel(user) {
  const r = roleOf(user); if (!r) return '';
  if (user && user.roleTitle) return user.roleTitle;
  return r.label.includes(' / ') ? r.label.split(' / ')[1] : r.label;
}
/** Alle Rollen */
export function roles() { return db.all('roles'); }

/**
 * Darf der angemeldete Benutzer das?  can('files.view')
 * Mehrere: can(['a','b']) = mindestens eins.  '@user' = irgendwer angemeldet.
 */
export function can(perm) {
  const u = currentUser();
  if (!perm) return true;
  if (!u) return false;
  if (Array.isArray(perm)) return perm.some(p => can(p));
  if (perm === '@user') return true;
  const r = roleOf(u);
  return !!(r && r.permissions.includes(perm));
}
/** Darf ein bestimmter Benutzer das? (für Rollen-Matrix, Hinweise) */
export function userCan(user, perm) { const r = roleOf(user); return !!(r && r.permissions.includes(perm)); }

/** Sichtbarkeitsstufe prüfen: 'public' | 'members' | 'board' */
export function canSeeVisibility(vis) {
  if (vis === 'public') return true;
  if (vis === 'members') return can('members.view');
  if (vis === 'board') return can('files.board') && can('files.view');
  return false;
}
/** Rechte, die den Zugang zur Verwaltung öffnen (eins reicht) – EINE Liste für Menü, Übersicht und Anmeldung. */
export const ADMIN_PERMS = ['site.news.edit', 'site.pages.edit', 'site.events.edit', 'site.media.upload', 'files.view', 'protocols.view', 'protocols.edit', 'users.manage', 'audit.view'];
/** Hat der Benutzer irgendein Verwaltungsrecht (sonst nur Mitgliederbereich)? */
export function hasAdminAccess() {
  return can(ADMIN_PERMS);
}

const beforeListeners = new Set();
/** Wird VOR jedem An-/Abmelden bzw. Rollenwechsel aufgerufen – solange noch die bisherige Person angemeldet ist
 *  (z. B. offene Eingaben speichern, „Rückgängig“-Hinweise schließen). */
export function onBeforeAuthChange(fn) { beforeListeners.add(fn); return () => beforeListeners.delete(fn); }
function emitBefore() { for (const fn of beforeListeners) { try { fn(currentUser()); } catch (e) { console.error(e); } } }

/** Anmelden (Demo). method: 'magic-link' | 'demo-switch' */
export function login(userId, { method = 'magic-link', silent = false } = {}) {
  const u = db.find('users', userId);
  if (!u) return null;
  emitBefore();
  writeSession(u.id);
  db.update('users', u.id, { lastLogin: new Date().toISOString().slice(0, 19) });
  if (method !== 'demo-switch') log('user.login', u.name, method === 'magic-link' ? 'Anmelde-Link per E-Mail' : method);
  if (!silent && method !== 'demo-switch') toast(`Willkommen, ${u.firstName || u.name}! Sie sind angemeldet.`);
  emit();
  return u;
}
export function logout() {
  const u = currentUser();
  emitBefore();
  if (u) log('user.logout', u.name);
  writeSession(null);
  emit();
}
/** Benachrichtigung bei An-/Abmeldung und Rollenwechsel */
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(currentUser()); } catch (e) { console.error(e); } } }

setAuditUserProvider(currentUser);

/* ---------------------------------------------------------
   Magic-Link-Anmeldung (Demo)
   --------------------------------------------------------- */
/** Schickt (als Vorschau) den Anmelde-Link; Klick auf den grünen Knopf meldet an und ruft onDone(user) auf. */
export function sendMagicLink(user, { onDone } = {}) {
  return sendMail({
    to: user.email, toName: user.name, kind: 'magic-link',
    subject: 'Ihr Anmelde-Link für die Kolping-Website',
    heading: `Guten Tag, ${user.firstName || user.name}!`,
    text: `<p>Sie möchten sich bei der Verwaltung der Kolping-Website anmelden. Tippen Sie einfach auf den grünen Knopf – ein Passwort brauchen Sie nicht.</p>`,
    cta: { label: 'Jetzt anmelden', onClick: () => { const u = login(user.id); onDone && onDone(u); } },
    footer: 'Der Knopf funktioniert 30 Minuten lang und nur einmal. Sie bleiben danach auf diesem Gerät 180 Tage angemeldet.<br>Sie haben das nicht angefordert? Dann können Sie diese E-Mail einfach löschen.',
  });
}

/* ---------------------------------------------------------
   Anmeldeseite mit großen Personenkarten
   --------------------------------------------------------- */
const DEMO_HINTS = {
  'u-stefan': 'Darf alles – auch Benutzer & Rollen',
  'u-klaus': 'Ablage, Protokolle, Termine',
  'u-maria': 'Neuigkeiten, Seiten, Termine, Fotos',
  'u-hans': 'Nur Mitgliederbereich',
};
/**
 * Baut die Anmeldeseite in el. next = Route nach erfolgreicher Anmeldung (z. B. '#/admin').
 * navigate = Funktion zum Weiterleiten (aus app.js).
 */
export function renderLogin(el, { next = '#/admin', navigate, reason } = {}) {
  const users = db.all('users').filter(u => u.active !== false);
  const step1 = h('div', { class: 'login-step' });
  const go = (u) => {
    const target = next && next !== '#/admin/login' ? next : (hasAdminAccessFor(u) ? '#/admin' : '#/mitglieder');
    if (navigate) navigate(target); else location.hash = target;
  };

  const showSent = (u) => {
    let sent = null;
    const cta = { label: 'Jetzt anmelden', onClick: () => { login(u.id); go(u); } };
    step1.replaceChildren(
      h('div', { class: 'login-sent' },
        h('div', { class: 'login-sent__icon', 'aria-hidden': 'true' }, '✉️'),
        h('h2', {}, 'Wir haben Ihnen eine E-Mail geschickt.'),
        h('p', { class: 'login-sent__lead' }, 'Öffnen Sie Ihr E-Mail-Programm und tippen Sie dort auf den grünen Knopf „Jetzt anmelden“.'),
        h('p', { class: 'muted' }, `Gesendet an: ${u.email}`),
        button({ label: 'E-Mail öffnen (Demo)', icon: '📬', variant: 'ok', size: 'lg', onClick: () => (sent && sent.mail ? showMailPreview(sent.mail, cta) : (sent = sendMagicLink(u, { onDone: () => go(u) }))) }),
        h('p', {}, button({ label: 'Andere Person wählen', icon: '←', variant: 'ghost', onClick: () => render() }))));
    // Mail sofort als Vorschau zeigen
    sent = sendMagicLink(u, { onDone: () => go(u) });
  };

  function render() {
    const emailField = h('input', { type: 'email', id: 'login-mail', autocomplete: 'email', placeholder: 'name@beispiel.de', class: 'field__input' });
    const err = h('div', { class: 'field__error', hidden: true });
    step1.replaceChildren(
      h('h2', { class: 'login-h' }, 'Wer sind Sie?'),
      h('p', { class: 'muted login-sub' }, 'Demo: Tippen Sie auf eine Person. Im echten System geben Sie nur Ihre E-Mail-Adresse ein.'),
      h('div', { class: 'person-grid' }, users.map(u => {
        const r = roleOf(u);
        return h('button', { type: 'button', class: 'person-card', onclick: () => showSent(u) },
          avatar(u, { size: 64 }),
          h('span', { class: 'person-card__name' }, u.name),
          h('span', { class: 'person-card__role', style: { '--rc': r?.color || '#57534e' } }, roleLabel(u)),
          h('span', { class: 'person-card__hint' }, u.title),
          h('span', { class: 'person-card__perm' }, DEMO_HINTS[u.id] || ''),
          h('span', { class: 'person-card__cta' }, 'Anmelde-Link schicken →'));
      })),
      h('details', { class: 'login-mail' },
        h('summary', {}, 'Oder: mit E-Mail-Adresse anmelden'),
        h('form', { class: 'login-mail__form', novalidate: true, onsubmit: (e) => {
          e.preventDefault();
          const v = emailField.value.trim().toLowerCase();
          const u = users.find(x => x.email.toLowerCase() === v);
          if (!v || !v.includes('@')) { err.hidden = false; err.textContent = 'Bitte geben Sie Ihre E-Mail-Adresse ein, z. B. maria.probe@example.org'; return; }
          if (!u) { err.hidden = false; err.textContent = 'Diese Adresse kennen wir noch nicht. Bitte wenden Sie sich an den Vorstand – oder wählen Sie oben eine Demo-Person.'; return; }
          showSent(u);
        } },
          h('label', { class: 'field__label', for: 'login-mail' }, 'Ihre E-Mail-Adresse'),
          emailField, err,
          button({ label: 'Anmelde-Link schicken', icon: '✉', variant: 'primary', size: 'lg', type: 'submit' }))));
  }
  render();

  el.replaceChildren(h('section', { class: 'login' },
    h('div', { class: 'login__brand' },
      h('img', { src: 'img/kolping-logo.svg', alt: 'Kolping', width: 90 }),
      h('div', {}, h('p', { class: 'login__org' }, 'Kolpingsfamilie Ramsen'), h('h1', { class: 'login__title' }, 'Anmelden zur Verwaltung'))),
    reason ? h('div', { class: 'login__reason' }, reason) : null,
    h('div', { class: 'login__card' }, step1),
    h('p', { class: 'login__foot' }, 'Kein Passwort nötig: Sie bekommen einen Anmelde-Link per E-Mail. ',
      h('a', { href: '#/' }, '← Zurück zur Website'))));
}
function hasAdminAccessFor(u) {
  const r = roleOf(u);
  return !!r && r.permissions.some(p => ADMIN_PERMS.includes(p));
}

/* ---------------------------------------------------------
   Demo-Leiste „Rolle wechseln“
   --------------------------------------------------------- */
/** Liefert die Leiste; onSwitch(user) wird nach dem Wechsel aufgerufen (z. B. neu rendern). */
export function roleSwitcher({ onSwitch } = {}) {
  const cur = currentUser();
  const bar = h('div', { class: 'role-switch', role: 'group', 'aria-label': 'Demo: Rolle wechseln' },
    h('span', { class: 'role-switch__label' }, h('span', { 'aria-hidden': 'true' }, '🎭'), ' Demo: Rolle wechseln'),
    h('div', { class: 'role-switch__list' }, db.all('users').filter(u => u.active !== false).map(u => {
      const r = roleOf(u);
      const active = cur && cur.id === u.id;
      return h('button', {
        type: 'button', class: 'role-switch__btn', 'aria-pressed': String(!!active),
        title: `${u.name} – ${roleLabel(u)}`,
        onclick: () => {
          if (active) return;
          login(u.id, { method: 'demo-switch' });
          toast(`Sie sehen die Verwaltung jetzt als ${u.firstName} (${roleLabel(u)}).`, { type: 'info', icon: '🎭' });
          onSwitch && onSwitch(u);
        },
      }, avatar(u, { size: 30 }), h('span', {}, h('b', {}, u.firstName), ' · ', r ? r.short : ''));
    })));
  return bar;
}

/** Kurztext: Was darf diese Rolle? (für Hinweise auf der Kein-Zugriff-Seite) */
export function describeRole(role) {
  if (!role) return '';
  return PERMISSIONS.filter(p => role.permissions.includes(p.id)).map(p => p.label).join(' · ');
}
/** Lesbares Label einer Berechtigung */
export function permissionLabel(id) { const p = PERMISSIONS.find(x => x.id === id); return p ? p.label : id; }

/** Schriftgröße (A+) – global, pro Gerät */
export function applyFontPref() {
  document.documentElement.classList.toggle('font-lg', !!prefsStore.get('fontLarge', false));
}
export function toggleFontSize() {
  const v = !prefsStore.get('fontLarge', false);
  prefsStore.set('fontLarge', v); applyFontPref(); return v;
}
applyFontPref();
export { esc };
