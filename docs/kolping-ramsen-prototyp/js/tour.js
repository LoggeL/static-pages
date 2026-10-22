// =========================================================
// tour.js – Demo-Rundgang (Panel unten rechts) + Demo-Band
// Schritte zum Vorführen; „Hinführen“ wechselt bei Bedarf die
// Rolle und öffnet die passende Seite.
// =========================================================
import { navigate, onRouteChange } from './app.js';
import { db, prefsStore } from './store.js';
import { currentUser, login, logout } from './auth.js';
import { h, button, confirmDialog, toast } from './ui.js';

/**
 * Schritte. as: Benutzer-ID, unter der der Schritt gezeigt wird; 'logout' = abmelden; null = egal.
 * extra: zusätzlicher Knopf {label, route, as}
 */
export const TOUR_STEPS = [
  { title: 'Die neue Startseite', route: '#/', as: null,
    text: 'Großes Foto, „Als Nächstes“, nächste Termine, Neuigkeiten und Vereinsbereiche – alles kommt aus dem neuen System. Auch auf dem Handy.' },
  { title: 'Termine auf der Website', route: '#/termine', as: null,
    text: 'Liste oder Monatsansicht, Filter nach Bereich. Jeder Termin lässt sich in den eigenen Kalender holen – oder alle per Abo.' },
  { title: 'Anmelden als Maria (72)', route: '#/admin', as: 'logout',
    text: 'Kein Passwort: Maria tippt auf ihren Namen und bekommt einen Anmelde-Link per E-Mail (hier als Vorschau). Grüner Knopf → angemeldet.' },
  { title: 'Termin eintragen', route: '#/admin/termine/neu', as: 'u-maria',
    text: 'Große Felder, Datum einfach tippen: „3.11.“, „3. November“ oder „nächsten Samstag“, Uhrzeit „19 Uhr“. Dann „Auf der Website zeigen“.' },
  { title: '… erscheint sofort auf der Website', route: () => lastEventRoute(), as: 'u-maria',
    text: 'Der eben eingetragene Termin steht sofort auf der Website – mit eigener Seite und „In meinen Kalender“. Über das Kalender-Abo kommt er auch auf alle Handys.' },
  { title: 'Fotos hochladen & verkleinern', route: '#/admin/fotos/hochladen', as: 'u-maria',
    text: 'Foto vom Tablet wählen (oder das Beispielfoto). Der Browser verkleinert es: vorher mehrere MB → nachher wenige hundert KB.' },
  { title: 'Rolle wechseln: Klaus (Vorstand)', route: '#/admin/ablage', as: 'u-klaus',
    text: 'Oben die Leiste „Demo: Rolle wechseln“. Klaus sieht die Ablage wie ein Dateisystem – jeder Ordner mit Schild „🔒 Nur Vorstand“, „👥 Alle Mitglieder“ oder „🌐 Öffentlich“.' },
  { title: 'Protokoll gemeinsam schreiben', route: '#/admin/protokolle/pr-1?live=1', as: 'u-klaus',
    text: 'Vorlage mit Tagesordnung, „✓ Gespeichert um …“ – und ein zweiter Schreiber tippt live mit (simuliert).' },
  { title: 'Maria sieht die Ablage nicht', route: '#/admin/ablage', as: 'u-maria',
    text: 'Kein Menüpunkt, keine Treffer in der Suche, nicht im Foto-Auswahldialog. Selbst der Direktlink zeigt nur „Kein Zugriff“.' },
  { title: 'Admin: Rollen & Änderungsprotokoll', route: '#/admin/rollen', as: 'u-stefan',
    text: 'Welche Rolle darf was – als Tabelle. Im Änderungsprotokoll steht jeder Schritt dieser Vorführung, auch Marias abgewiesener Zugriff.',
    extra: { label: 'Änderungsprotokoll', route: '#/admin/aenderungen', as: 'u-stefan' } },
];

/** Zuletzt in dieser Demo angelegter (öffentlicher) Termin → seine Seite auf der Website; sonst die Terminliste. */
function lastEventRoute() {
  const id = prefsStore.get('tour.lastEvent', null);
  const e = id ? db.find('events', id) : null;
  if (e && !e.deletedAt && e.status !== 'draft' && (e.visibility || 'public') === 'public') return `#/termine/${e.id}`;
  return '#/termine';
}
db.subscribe((ev) => {
  if (!ev) return;
  if (ev.type === 'reset') { prefsStore.set('tour.lastEvent', null); return; }
  if (ev.type !== 'insert' || ev.coll !== 'events' || !ev.id) return;
  // Bei einer Terminreihe zählt der erste (eingetippte) Termin, nicht der letzte der Reihe
  const prev = db.find('events', prefsStore.get('tour.lastEvent', null));
  if (prev && ev.item && ev.item.seriesId && prev.seriesId === ev.item.seriesId) return;
  prefsStore.set('tour.lastEvent', ev.id);
});

const st = {
  get open() { return prefsStore.get('tour.open', window.innerWidth >= 900); },
  set open(v) { prefsStore.set('tour.open', v); },
  get step() { return prefsStore.get('tour.step', 0); },
  set step(v) { prefsStore.set('tour.step', v); },
  get done() { return prefsStore.get('tour.done', []); },
  set done(v) { prefsStore.set('tour.done', v); },
};

function goTo(step) {
  const route = typeof step.route === 'function' ? step.route() : step.route;
  const u = currentUser();
  const needLogout = step.as === 'logout' && !!u;
  const needLogin = !!step.as && step.as !== 'logout' && (!u || u.id !== step.as);
  if (!needLogout && !needLogin) { navigate(route); return; }
  // Erst die Zieladresse setzen, dann die Rolle wechseln: So wird nur EINMAL gezeichnet – direkt die Zielseite
  // (keine falschen „abgewiesen“-Einträge für die alte Seite unter der neuen Rolle).
  history.replaceState(null, '', route);
  if (needLogout) { logout(); return; }
  const target = db.find('users', step.as);
  login(step.as, { method: 'demo-switch' });
  if (target) toast(`Demo: Sie sind jetzt ${target.name}.`, { type: 'info', icon: '🎭' });
}

let root = null;
function render() {
  if (!root) return;
  const cur = Math.min(st.step, TOUR_STEPS.length - 1);
  const done = new Set(st.done);
  const open = st.open;
  const allDone = done.size >= TOUR_STEPS.length;
  const toggle = h('button', { type: 'button', class: 'tour__toggle', 'aria-expanded': String(open), 'aria-controls': 'tour-panel',
    'aria-label': open ? 'Rundgang einklappen' : `Demo-Rundgang öffnen (Schritt ${cur + 1} von ${TOUR_STEPS.length})`,
    onclick: () => { st.open = !open; render(); } },
    h('span', { 'aria-hidden': 'true' }, '🧭'), h('span', { class: 'tour__label' }, open ? 'Rundgang einklappen' : 'Demo-Rundgang'),
    h('span', { class: 'num' }, `${cur + 1}/${TOUR_STEPS.length}`));
  // Eingeklappt: ein Klick führt direkt zum nächsten Schritt
  const next = !open && !allDone ? h('button', { type: 'button', class: 'tour__next', onclick: () => go(cur) },
    h('span', { class: 'tour__next-k' }, `Weiter (${cur + 1}/${TOUR_STEPS.length}):`), h('span', { class: 'tour__next-t' }, TOUR_STEPS[cur].title), h('span', { 'aria-hidden': 'true' }, ' ➜')) : null;
  const panel = open ? h('section', { class: 'tour__panel', id: 'tour-panel', 'aria-label': 'Demo-Rundgang' },
    h('div', { class: 'tour__head' }, h('h2', {}, 'Demo-Rundgang für die Vorführung'),
      h('button', { type: 'button', onclick: () => { st.open = false; render(); }, 'aria-label': 'Rundgang einklappen' }, '▾ Zu')),
    h('ol', { class: 'tour__list' }, TOUR_STEPS.map((s, i) => h('li', {
      class: `tour__step${i === cur ? ' is-current' : ''}${done.has(i) ? ' is-done' : ''}`,
      onclick: (e) => { if (i !== cur && !e.target.closest('button')) { st.step = i; render(); } },
    },
      h('span', { class: 'n', 'aria-hidden': 'true' }, done.has(i) ? '✓' : i + 1),
      h('h3', {}, i !== cur ? h('button', { type: 'button', class: 'tour__pick', onclick: () => { st.step = i; render(); } }, s.title) : s.title),
      h('p', {}, s.text),
      i === cur ? h('div', { class: 'tour__go cluster' },
        button({ label: 'Hinführen', icon: '➜', variant: 'primary', size: 'sm', onClick: () => go(i) }),
        s.extra ? button({ label: s.extra.label, size: 'sm', onClick: () => { st.open = false; goTo(s.extra); render(); } }) : null,
        i < TOUR_STEPS.length - 1 ? button({ label: 'Nächster Schritt', icon: '↓', size: 'sm', variant: 'ghost', onClick: () => { st.done = [...new Set([...st.done, i])]; st.step = i + 1; render(); } }) : null) : null))),
    h('div', { class: 'tour__info' },
      h('span', {}, 'Fragen zur Technik?'),
      h('a', { class: 'btn btn--sm', href: '#/so-funktionierts', onclick: () => { st.open = false; } },
        h('span', { class: 'btn__icon', 'aria-hidden': 'true' }, 'ℹ️'), h('span', { class: 'btn__label' }, 'So funktioniert das System'))),
    h('div', { class: 'tour__foot' },
      button({ label: 'Von vorn', icon: '⟲', size: 'sm', variant: 'ghost', onClick: () => { st.step = 0; st.done = []; render(); } }),
      h('span', { class: 'spacer' }),
      button({ label: 'Demo zurücksetzen', icon: '↺', size: 'sm', onClick: resetDemo }))) : null;
  root.replaceChildren(...[panel, next, toggle].filter(Boolean));
  root.classList.toggle('tour--open', open);
}
/** Schritt i vorführen: erledigt markieren, Zeiger auf den nächsten Schritt, Panel zu, hinführen. */
function go(i) {
  st.done = [...new Set([...st.done, i])];
  st.step = Math.min(i + 1, TOUR_STEPS.length - 1);
  st.open = false;
  goTo(TOUR_STEPS[i]);
  render();
}

export async function resetDemo() {
  const ok = await confirmDialog({ title: 'Demo zurücksetzen?', text: 'Alle Änderungen in diesem Prototyp (neue Termine, Fotos, Protokolle …) werden gelöscht und die Beispieldaten wiederhergestellt. Sie werden abgemeldet.', confirmLabel: 'Ja, zurücksetzen', danger: false });
  if (ok) db.reset();
}

/** Panel & Demo-Band einhängen (einmal beim Start) */
export function initTour() {
  root = document.getElementById('tour-root');
  if (!root) { root = h('div', { id: 'tour-root', class: 'tour' }); document.body.append(root); }
  render();
  const band = document.getElementById('demo-band');
  if (band) {
    band.querySelector('[data-demo-reset]')?.addEventListener('click', resetDemo);
    band.querySelector('[data-demo-tour]')?.addEventListener('click', () => { st.open = !st.open; render(); });
  }
  onRouteChange(() => render());
  watchActionBar();
}

/* Klebende Aktionsleiste (.form-actions) messen → --actions-h + Klasse has-actions am <body>.
   Damit liegen Hinweise und der Rundgang-Knopf immer ÜBER der Leiste und verdecken den Hauptknopf nicht. */
function watchActionBar() {
  let bar = null, raf = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
  function measure() {
    const b = document.querySelector('#app .form-actions');
    const has = !!(b && b.offsetParent !== null && getComputedStyle(b).position === 'sticky');
    document.body.classList.toggle('has-actions', has);
    if (has) document.documentElement.style.setProperty('--actions-h', Math.ceil(b.getBoundingClientRect().height) + 'px');
    if (b !== bar) { if (ro && bar) ro.unobserve(bar); bar = b; if (ro && bar) ro.observe(bar); }
  }
  const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  schedule();
}
initTour();
