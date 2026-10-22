// =========================================================
// app.js – Hash-Router (#/…) mit Rechteprüfung und Layouts
// =========================================================
import { can, isLoggedIn, onAuthChange, onBeforeAuthChange, currentUser } from './auth.js';
import { log } from './store.js';
import { closeStaleModals, clearToasts, setToastOwner } from './ui.js';

const routes = [];
const layouts = {};
const routeListeners = new Set();
let guards = { unauthenticated: null, forbidden: null, notFound: null };
let current = null;      // {route, params, query, path}
let cleanup = null;
let started = false;

/**
 * Route registrieren.
 * @param {string} pattern  z. B. '/admin/termine/:id' (ohne '#'). Statische Teile gewinnen vor Parametern.
 * @param {(ctx) => (void|Function|Promise)} render  Füllt ctx.el. Rückgabe: optionale Aufräumfunktion.
 *        ctx = { el, params, query, path, setTitle(t), navigate(path) }
 * @param {object} [opts]
 *        permission: 'site.events.edit' | ['a','b'] (eins davon) | '@user' (nur angemeldet) | null (öffentlich)
 *        layout: 'public' | 'admin' | 'bare'   (Standard: '/admin…' → 'admin', sonst 'public')
 *        title: Seitentitel
 *        nav: ID des Menüpunkts, der aktiv markiert wird (Admin)
 */
export function registerRoute(pattern, render, opts = {}) {
  const segs = pattern.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const layout = opts.layout || (segs[0] === 'admin' ? 'admin' : 'public');
  const existing = routes.findIndex(r => r.pattern === pattern);
  const route = { pattern, segs, render, ...opts, layout };
  if (existing >= 0) routes[existing] = route; else routes.push(route);
  if (started) queueRender();
  return route;
}
/** Layout registrieren: fn(ctx) baut den Rahmen und gibt das Inhalts-Element (outlet) zurück. */
export function registerLayout(name, fn) { layouts[name] = fn; }
/** Was passiert bei fehlender Anmeldung / fehlendem Recht / unbekannter Route */
export function setGuards(g) { guards = { ...guards, ...g }; }

/** Navigieren: navigate('#/admin/termine') oder navigate('/admin/termine') */
export function navigate(path, { replace = false } = {}) {
  const h = path.startsWith('#') ? path : '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) { history.replaceState(null, '', h); render(); }
  else if (location.hash === h) render();
  else location.hash = h;
}
/** Aktuelle Route neu zeichnen (z. B. nach Rollenwechsel) */
export function rerender() { render({ keepScroll: true }); }
/** Aktueller Pfad ohne '#', z. B. '/admin/termine/e-3' */
export function currentPath() { return parseHash().path; }
export function currentRoute() { return current; }
/** Benachrichtigung bei jedem Seitenwechsel: fn(current) */
export function onRouteChange(fn) { routeListeners.add(fn); return () => routeListeners.delete(fn); }

function parseHash() {
  const raw = decodeURI(location.hash.replace(/^#/, '') || '/');
  const [p, q = ''] = raw.split('?');
  const path = '/' + p.replace(/^\/+|\/+$/g, '');
  const query = Object.fromEntries(new URLSearchParams(q));
  return { path, query, full: raw };
}

function match(path) {
  const segs = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  let best = null, bestScore = -1;
  for (const r of routes) {
    if (r.segs.length !== segs.length && !(r.segs[r.segs.length - 1] === '*' && segs.length >= r.segs.length - 1)) continue;
    const params = {}; let score = 0, ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      const rs = r.segs[i], s = segs[i];
      if (rs === '*') { params.rest = segs.slice(i).join('/'); score += 0; break; }
      if (rs.startsWith(':')) { if (s == null) { ok = false; break; } params[rs.slice(1)] = decodeURIComponent(s); score += 1; }
      else if (rs === s) score += 3;
      else { ok = false; break; }
    }
    if (ok && score > bestScore) { best = { route: r, params }; bestScore = score; }
  }
  return best;
}

let lastDenied = { key: '', at: 0 };
let pending = false;
function queueRender() { if (pending) return; pending = true; queueMicrotask(() => { pending = false; render({ keepScroll: true }); }); }

async function render({ keepScroll = false } = {}) {
  const { path, query, full } = parseHash();
  const prevPath = current && current.path;
  // Offene Dialoge gehören zur alten Seite → beim Seitenwechsel schließen
  if (prevPath && prevPath !== path) closeStaleModals();
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
  cleanup = null;
  const m = match(path);
  const app = document.getElementById('app');
  let route = m ? m.route : null;
  const params = m ? m.params : {};
  const ctxBase = { params, query, path, full, navigate };

  // Rechteprüfung
  let mode = 'ok';
  if (!route) mode = 'notfound';
  else if (route.permission && !isLoggedIn()) mode = 'login';
  else if (route.permission && !can(route.permission)) mode = 'forbidden';

  current = { route, params, query, path, mode };
  const layoutName = mode === 'login' ? 'bare' : (route ? route.layout : (path.startsWith('/admin') ? 'admin' : 'public'));
  const layout = layouts[layoutName] || layouts.public || ((c) => { app.replaceChildren(); return app; });
  const outlet = layout({ ...ctxBase, route, app, mode });
  const setTitle = (t) => { document.title = t ? `${t} – Kolpingsfamilie Ramsen` : 'Kolpingsfamilie Ramsen'; };
  setTitle(route && route.title);
  const ctx = { ...ctxBase, el: outlet, setTitle };

  try {
    if (mode === 'notfound') guards.notFound ? guards.notFound(ctx) : (outlet.textContent = 'Seite nicht gefunden.');
    else if (mode === 'login') guards.unauthenticated ? guards.unauthenticated({ ...ctx, next: '#' + full }) : null;
    else if (mode === 'forbidden') {
      // Doppelte Einträge vermeiden (gleiche Person + gleicher Pfad kurz hintereinander, z. B. beim Neuzeichnen)
      const key = `${currentUser()?.id || '-'}|${path}`;
      if (!(lastDenied.key === key && Date.now() - lastDenied.at < 5000))
        log('access.denied', '#' + path, `fehlendes Recht: ${[].concat(route.permission).join(' / ')}`);
      lastDenied = { key, at: Date.now() };
      guards.forbidden ? guards.forbidden({ ...ctx, permission: route.permission }) : (outlet.textContent = 'Kein Zugriff.');
    } else {
      const res = await route.render(ctx);
      if (typeof res === 'function') cleanup = res;
    }
  } catch (e) {
    console.error(e);
    outlet.replaceChildren();
    const box = document.createElement('div');
    box.className = 'error-box';
    box.innerHTML = `<h2>Hier ist etwas schiefgegangen</h2><p>Das ist ein Fehler im Prototyp, nicht Ihre Schuld.</p><pre>${String(e && e.message || e).replace(/</g, '&lt;')}</pre>`;
    outlet.append(box);
  }
  if (!keepScroll || prevPath !== path) {
    window.scrollTo(0, 0);
  }
  // Fokus für Screenreader auf den Hauptinhalt, wenn sich der Pfad ändert
  if (prevPath && prevPath !== path) {
    const h1 = outlet.querySelector('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  for (const fn of routeListeners) { try { fn(current); } catch (e) { console.error(e); } }
}

/** Startet den Router (wird in index.html nach allen Modulen aufgerufen) */
export function start() {
  if (started) return; started = true;
  window.addEventListener('hashchange', () => render());
  setToastOwner(() => currentUser()?.id || null);
  // Vor dem Wechsel: offene Eingaben der Seite noch unter der BISHERIGEN Person speichern, alte Hinweise schließen
  onBeforeAuthChange(() => {
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
    cleanup = null;
    clearToasts();
    closeStaleModals(0);   // offene Dialoge (z. B. Datei-Vorschau) gehören der bisherigen Person
  });
  onAuthChange(() => render({ keepScroll: true }));
  if (!location.hash) history.replaceState(null, '', '#/');
  render();
}
