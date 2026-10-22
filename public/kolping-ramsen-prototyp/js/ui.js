// =========================================================
// ui.js – wiederverwendbare Bausteine (ohne Framework)
// Alle Funktionen liefern echte DOM-Elemente (außer html``).
// =========================================================
import { db, log, uid, nowIso } from './store.js';

/* Null-sicher: eingebautes append/prepend/replaceChildren würde null/undefined/false als Text „null“ schreiben.
   Diese Werte werden hier zentral übersprungen (Arrays werden aufgelöst). */
(() => {
  const clean = (args) => args.flat(Infinity).filter(x => x != null && x !== false);
  for (const P of [Element.prototype, DocumentFragment.prototype, Document.prototype]) {
    for (const name of ['append', 'prepend', 'replaceChildren']) {
      const orig = P[name];
      if (typeof orig !== 'function' || orig.__nullSafe) continue;
      const wrapped = function (...args) { return orig.apply(this, clean(args)); };
      wrapped.__nullSafe = true;
      P[name] = wrapped;
    }
  }
})();

/* ---------------------------------------------------------
   DOM-Helfer
   --------------------------------------------------------- */
/** HTML-Escaping für Text */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const RAW = Symbol('raw');
/** Markiert einen String als bereits sicheres HTML für html`` */
export function raw(s) { return { [RAW]: true, value: String(s ?? '') }; }
/** Template-Tag: html`<p>${text}</p>` escapet Werte automatisch; Arrays werden verbunden; raw() bleibt roh. Liefert STRING. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += renderVal(vals[i]);
  });
  return out;
}
function renderVal(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(renderVal).join('');
  if (typeof v === 'object' && v[RAW]) return v.value;
  return esc(v);
}
/** String → DocumentFragment */
export function frag(htmlString) {
  const t = document.createElement('template');
  t.innerHTML = htmlString;
  return t.content;
}
/**
 * Element bauen: h('button', {class:'btn', onclick: fn, 'aria-label': 'x'}, 'Text', otherNode)
 * - on…-Attribute mit Funktion werden als Event-Listener gesetzt
 * - class/className, style (String oder Objekt), dataset (Objekt), html (innerHTML) werden unterstützt
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, ms = 300) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}
export function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'eintrag';
}

/* ---------------------------------------------------------
   Buttons, Kacheln, Schilder
   --------------------------------------------------------- */
/**
 * button({label, icon, variant:'primary'|'accent'|'ok'|'danger'|'secondary'|'ghost', size:'lg'|'sm', block, href, onClick, type, attrs})
 * Mit href entsteht ein <a>, sonst ein <button>. Immer Icon + Text (nie nur Icon).
 */
export function button({ label, icon, variant = 'secondary', size, block, href, onClick, type = 'button', attrs = {}, disabled } = {}) {
  const cls = ['btn', variant !== 'secondary' && `btn--${variant}`, size && `btn--${size}`, block && 'btn--block', attrs.class].filter(Boolean).join(' ');
  const a = { ...attrs, class: cls };
  const kids = [icon ? h('span', { class: 'btn__icon', 'aria-hidden': 'true' }, icon) : null, h('span', { class: 'btn__label' }, label)];
  let el;
  if (href) el = h('a', { ...a, href }, kids);
  else el = h('button', { ...a, type, disabled: disabled || null }, kids);
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

/** Große Aufgaben-Kachel fürs Dashboard: tile({icon:'📅', title:'Termin eintragen', text:'…', href:'#/admin/termine/neu', color}) */
export function tile({ icon, title, text, href, color, badge, onClick }) {
  const el = h(href ? 'a' : 'button', { class: 'tile', href: href || null, type: href ? null : 'button', style: color ? { '--tile-c': color } : null },
    h('span', { class: 'tile__icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'tile__title' }, title),
    text ? h('span', { class: 'tile__text' }, text) : null,
    badge ? h('span', { class: 'tile__badge' }, badge) : null,
  );
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

/** Sichtbarkeitsstufen (Ablage-Ordner, Termine, Dateien) */
export const VISIBILITY = {
  public:  { id: 'public',  icon: '🌐', label: 'Öffentlich',      long: 'Alle – auch Besucher der Website', cls: 'badge--public' },
  members: { id: 'members', icon: '👥', label: 'Alle Mitglieder', long: 'Alle angemeldeten Mitglieder',     cls: 'badge--members' },
  board:   { id: 'board',   icon: '🔒', label: 'Nur Vorstand',    long: 'Nur Vorstand und Administrator',   cls: 'badge--board' },
};
/** Rechte-Schild: visibilityBadge('board') → „🔒 Nur Vorstand“; {long:true} → „🔒 Diesen Ordner sieht: Nur Vorstand und Administrator“ */
export function visibilityBadge(vis, { long = false, large = false } = {}) {
  const v = VISIBILITY[vis] || VISIBILITY.board;
  return h('span', { class: `badge ${v.cls}${large ? ' badge--lg' : ''}`, title: v.long },
    h('span', { 'aria-hidden': 'true' }, v.icon), long ? `Sichtbar für: ${v.long}` : v.label);
}
/** Allgemeines Schild: badge('Entwurf', 'draft'|'ok'|'info'|'neutral') */
export function badge(text, kind = 'neutral', icon) {
  return h('span', { class: `badge badge--${kind}` }, icon ? h('span', { 'aria-hidden': 'true' }, icon) : null, text);
}

/* ---------------------------------------------------------
   Toast mit „Rückgängig“
   --------------------------------------------------------- */
function toastRegion() {
  let r = document.getElementById('toast-region');
  if (!r) { r = h('div', { id: 'toast-region', class: 'toast-region', role: 'status', 'aria-live': 'polite' }); document.body.append(r); }
  return r;
}
/**
 * toast('Termin gelöscht.', {undo: () => db.restore('events', id), timeout: 10000, type: 'ok'|'info'|'error'})
 * Mit undo erscheint ein großer „Rückgängig“-Knopf (Standard 10 s sichtbar).
 */
let toastOwner = () => null;
/** Kern (app.js) meldet, wer gerade angemeldet ist – „Rückgängig“ gilt nur für diese Person. */
export function setToastOwner(fn) { toastOwner = typeof fn === 'function' ? fn : () => null; }
const liveToasts = new Set();
/** Alle Hinweise schließen (z. B. beim Rollenwechsel). */
export function clearToasts() { for (const t of [...liveToasts]) t.close(); }
export function toast(message, { undo, undoLabel = 'Rückgängig', timeout, type = 'ok', icon } = {}) {
  const owner = toastOwner();
  const ms = timeout ?? (undo ? 10000 : 4500);
  const ic = icon ?? (type === 'error' ? '⚠' : type === 'info' ? 'ℹ' : '✓');
  const bar = h('span', { class: 'toast__bar' });
  const el = h('div', { class: `toast toast--${type}` },
    h('span', { class: 'toast__icon', 'aria-hidden': 'true' }, ic),
    h('span', { class: 'toast__msg' }, message));
  const close = () => { el.remove(); clearTimeout(t); liveToasts.delete(api); };
  if (undo) {
    el.append(button({ label: undoLabel, icon: '↶', onClick: () => {
      close();
      if (toastOwner() !== owner) { toast('Das kann nur die Person rückgängig machen, die es getan hat.', { type: 'info', icon: 'ℹ' }); return; }
      undo(); toast('Rückgängig gemacht.', { type: 'info', icon: '↶' });
    } }));
  }
  el.append(h('button', { class: 'toast__close', type: 'button', 'aria-label': 'Meldung schließen', onclick: close }, '×'), bar);
  toastRegion().append(el);
  bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ms, easing: 'linear' });
  const t = setTimeout(close, ms);
  const api = { close };
  liveToasts.add(api);
  return api;
}

/* ---------------------------------------------------------
   Modal
   --------------------------------------------------------- */
/**
 * modal({title, body: Node|string(HTML), actions: [{label, icon, variant, onClick(close) }], wide, onClose, closeLabel})
 * Gibt {el, body, close} zurück. ESC und Klick auf Hintergrund schließen. Fokus wird gefangen.
 */
const openModals = new Set();
/** Schließt Dialoge, die älter als minAgeMs sind (Router ruft das beim Seitenwechsel auf). */
export function closeStaleModals(minAgeMs = 250) {
  const now = Date.now();
  for (const m of [...openModals]) if (now - m.openedAt >= minAgeMs) m.close();
}
export function modal({ title, body, actions = [], wide = false, onClose, closeLabel = 'Schließen' } = {}) {
  const prevFocus = document.activeElement;
  const titleId = uid('mt');
  const bodyEl = h('div', { class: 'modal__body' });
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  const foot = actions.length ? h('div', { class: 'modal__foot' }) : null;
  const box = h('div', { class: `modal${wide ? ' modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal__head' },
      h('h2', { class: 'modal__title', id: titleId }, title || ''),
      button({ label: closeLabel, icon: '✕', variant: 'ghost', attrs: { class: 'modal__close' }, onClick: () => close() })),
    bodyEl, foot);
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    openModals.delete(entry);
    backdrop.remove(); document.removeEventListener('keydown', onKey, true);
    if (!openModals.size) document.body.style.overflow = '';
    try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch { /* egal */ }
    onClose && onClose(result);
  }
  for (const a of actions) {
    foot.append(button({ label: a.label, icon: a.icon, variant: a.variant || 'secondary', size: a.size, onClick: () => a.onClick ? a.onClick(close) : close() }));
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const f = $$('a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]', box).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  const entry = { openedAt: Date.now(), close: () => close() };
  openModals.add(entry);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  (document.getElementById('modal-root') || document.body).append(backdrop);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const first = $('input,textarea,select,[contenteditable="true"]', bodyEl) || $('.modal__foot .btn:last-child', box) || $('.modal__close', box);
    first && first.focus();
  });
  return { el: box, body: bodyEl, close };
}

/** Nur für wirklich endgültige Aktionen (z. B. Papierkorb leeren). Liefert Promise<boolean>. */
export function confirmDialog({ title, text, confirmLabel = 'Ja, endgültig', cancelLabel = 'Abbrechen', danger = true }) {
  return new Promise(resolve => {
    let result = false;
    modal({
      title, body: h('p', {}, text),
      actions: [
        { label: cancelLabel, onClick: c => c() },
        { label: confirmLabel, variant: danger ? 'danger-solid' : 'primary', onClick: c => { result = true; c(); } },
      ],
      onClose: () => resolve(result),
    });
  });
}

/* ---------------------------------------------------------
   Formularfelder
   --------------------------------------------------------- */
/**
 * field({label, name, value, type:'text'|'email'|'date-text'|'time-text'|'textarea'|'select'|..., hint, placeholder,
 *        required, optional, rows, options:[{value,label}], inputmode, autocomplete})
 * → {el, input, value(), setValue(v), setError(msg), clearError(), setOk(msg)}
 * Fehler stehen direkt am Feld (rot + Symbol + Text). Eingaben bleiben erhalten.
 */
export function field({ label, name, value = '', type = 'text', hint, placeholder, required, optional, rows = 5, options, inputmode, autocomplete, attrs = {} } = {}) {
  const id = uid('f');
  const hintId = id + '-h', errId = id + '-e';
  let input;
  if (type === 'textarea') input = h('textarea', { id, name, rows, placeholder, ...attrs });
  else if (type === 'select') input = h('select', { id, name, ...attrs }, (options || []).map(o => h('option', { value: o.value }, o.label)));
  else input = h('input', { id, name, type: (type === 'date-text' || type === 'time-text') ? 'text' : type, placeholder, inputmode, autocomplete, ...attrs });
  if (type === 'textarea') input.value = value; else input.value = value ?? '';
  if (required) input.setAttribute('aria-required', 'true');
  const err = h('div', { class: 'field__error', id: errId, hidden: true });
  const ok = h('div', { class: 'field__ok', hidden: true });
  const hintEl = hint ? h('div', { class: 'field__hint', id: hintId }, hint) : null;
  input.setAttribute('aria-describedby', [hint ? hintId : null, errId].filter(Boolean).join(' '));
  const el = h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label, optional ? h('span', { class: 'opt' }, ' (freiwillig)') : null),
    hintEl, input, err, ok);
  const api = {
    el, input,
    value: () => input.value.trim(),
    setValue: v => { input.value = v ?? ''; },
    setError(msg) { el.classList.add('field--invalid'); err.hidden = false; err.textContent = msg; ok.hidden = true; input.setAttribute('aria-invalid', 'true'); },
    clearError() { el.classList.remove('field--invalid'); err.hidden = true; input.removeAttribute('aria-invalid'); },
    setOk(msg) { ok.hidden = !msg; ok.textContent = msg || ''; },
  };
  input.addEventListener('input', () => api.clearError());
  return api;
}

/* ---------------------------------------------------------
   Autosave-Anzeige: „✓ Gespeichert um 14:32“
   --------------------------------------------------------- */
export function autosaveIndicator({ initial } = {}) {
  const el = h('span', { class: 'autosave', role: 'status', 'aria-live': 'polite' });
  const api = {
    el,
    saving() { el.className = 'autosave autosave--saving'; el.textContent = 'Wird gespeichert …'; },
    saved(date = new Date()) {
      const d = typeof date === 'string' ? new Date(date) : date;
      el.className = 'autosave autosave--ok'; el.textContent = `✓ Gespeichert um ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
    },
    error(msg = 'Nicht gespeichert – bitte Verbindung prüfen') { el.className = 'autosave autosave--error'; el.textContent = '⚠ ' + msg; },
    idle(text = 'Noch nichts geändert') { el.className = 'autosave autosave--saving'; el.textContent = text; el.classList.remove('autosave--saving'); },
  };
  if (initial) api.saved(initial); else api.idle();
  return api;
}

/* ---------------------------------------------------------
   Datum & Uhrzeit – tolerant parsen, deutsch formatieren
   --------------------------------------------------------- */
const pad = n => String(n).padStart(2, '0');
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTH_MAP = { jan: 1, januar: 1, jän: 1, feb: 2, februar: 2, mär: 3, mar: 3, märz: 3, maerz: 3, apr: 4, april: 4, mai: 5, jun: 6, juni: 6,
  jul: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dez: 12, dezember: 12 };
const WD_MAP = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6 };

/** Date → 'YYYY-MM-DD' (lokal) */
export function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
/** 'YYYY-MM-DD' → Date (lokal, 12 Uhr, damit keine Zeitzonen-Sprünge) */
export function fromISODate(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); }
export function todayISO() { return toISODate(new Date()); }

/**
 * Versteht: „3.11.“, „03.11.2026“, „3.11.26“, „3. November“, „3 nov 2026“, „2026-11-03“, „3/11“,
 * „heute“, „morgen“, „übermorgen“, „Samstag“, „nächsten Samstag“.
 * Ohne Jahr: liegt das Datum mehr als 30 Tage zurück, wird das nächste Jahr genommen.
 * @returns {string|null} 'YYYY-MM-DD' oder null
 */
export function parseDate(input, { ref = new Date() } = {}) {
  let s = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  s = s.replace(/^(am|den|dem)\s+/, '').replace(/^(mo|di|mi|do|fr|sa|so)[a-z]*,?\s+(?=\d)/, '');
  const base = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12);
  const add = n => { const d = new Date(base); d.setDate(d.getDate() + n); return toISODate(d); };
  if (s === 'heute') return add(0);
  if (s === 'morgen') return add(1);
  if (s === 'übermorgen' || s === 'uebermorgen') return add(2);
  let m = s.match(/^(?:nächste[nrs]?|naechste[nrs]?|kommende[nrs]?)?\s*([a-zä]+)$/);
  if (m && m[1] in WD_MAP) {
    const wd = WD_MAP[m[1]]; let diff = (wd - base.getDay() + 7) % 7; if (diff === 0) diff = 7;
    return add(diff);
  }
  let y, mo, d;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})\s*[./]\s*(\d{1,2})\s*(?:[./]\s*(\d{2,4})?)?\.?$/))) { d = +m[1]; mo = +m[2]; y = m[3] ? +m[3] : null; }
  else if ((m = s.match(/^(\d{1,2})\.?\s*([a-zäö]+)\.?\s*(\d{2,4})?$/))) {
    d = +m[1]; const key = m[2].replace(/\.$/, ''); mo = MONTH_MAP[key] || MONTH_MAP[key.slice(0, 3)]; y = m[3] ? +m[3] : null;
    if (!mo) return null;
  } else return null;
  if (y != null && y < 100) y += 2000;
  const explicitYear = y != null;
  if (!explicitYear) y = base.getFullYear();
  const dt = new Date(y, mo - 1, d, 12);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; // z. B. 31.2.
  if (!explicitYear && (base - dt) / 86400000 > 30) dt.setFullYear(y + 1);
  return toISODate(dt);
}

/**
 * Versteht: „19“, „19 Uhr“, „19:30“, „19.30“, „1930“, „7 Uhr abends“, „halb 8 abends“ (=19:30).
 * @returns {string|null} 'HH:MM' oder null
 */
export function parseTime(input) {
  let s = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  const evening = /abends|nachmittags|pm/.test(s);
  s = s.replace(/uhr|abends|morgens|nachmittags|vormittags|mittags|am|pm|ca\.?|gegen/g, '').trim();
  let hh, mm = 0, m;
  if ((m = s.match(/^halb\s*(\d{1,2})$/))) { hh = +m[1] - 1; mm = 30; }
  else if ((m = s.match(/^(\d{1,2})\s*[:.h]\s*(\d{2})$/))) { hh = +m[1]; mm = +m[2]; }
  else if ((m = s.match(/^(\d{3,4})$/))) { const v = m[1].padStart(4, '0'); hh = +v.slice(0, 2); mm = +v.slice(2); }
  else if ((m = s.match(/^(\d{1,2})$/))) { hh = +m[1]; }
  else return null;
  if (evening && hh < 12) hh += 12;
  if (hh > 23 || mm > 59 || hh < 0) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

/**
 * formatDate('2026-11-07', style)
 * 'long'     → „Samstag, 7. November 2026“ (Standard)
 * 'medium'   → „7. November 2026“
 * 'short'    → „07.11.2026“
 * 'weekday'  → „Sa, 7. Nov.“
 * 'dayMonth' → „7. November“
 * 'monthYear'→ „November 2026“
 */
export function formatDate(iso, style = 'long') {
  if (!iso) return '';
  const d = fromISODate(iso);
  if (isNaN(d)) return String(iso);
  const day = d.getDate(), mon = MONTHS[d.getMonth()], y = d.getFullYear(), wd = WEEKDAYS[d.getDay()];
  switch (style) {
    case 'short': return `${pad(day)}.${pad(d.getMonth() + 1)}.${y}`;
    case 'medium': return `${day}. ${mon} ${y}`;
    case 'weekday': return `${wd.slice(0, 2)}, ${day}. ${mon.length > 4 ? mon.slice(0, 3) + '.' : mon}`;
    case 'dayMonth': return `${day}. ${mon}`;
    case 'monthYear': return `${mon} ${y}`;
    default: return `${wd}, ${day}. ${mon} ${y}`;
  }
}
/** '19:00' → „19:00 Uhr“ */
export function formatTime(t) { return t ? `${t} Uhr` : ''; }
/** ISO-Zeitstempel → „21.10.2026, 20:14 Uhr“ */
export function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
}
/** „gerade eben“, „vor 5 Minuten“, „gestern, 20:14 Uhr“, „am 03.10.2026“ */
export function relativeTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const s = (now - d) / 1000;
  if (s < 45) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Minute${Math.round(s / 60) === 1 ? '' : 'n'}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `heute, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `gestern, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  return `am ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** 4404019 → „4,2 MB“, 186368 → „182 KB“ */
export function formatBytes(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return `${n} Byte`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

/* ---------------------------------------------------------
   Bildkompression im Browser (Canvas)
   --------------------------------------------------------- */
/**
 * compressImage(file, {maxSize: 1600, quality: 0.75, type: 'image/webp'})
 * → Promise<{blob, dataUrl, type, name, before, after, width, height, originalWidth, originalHeight, savedPercent}>
 * Fällt auf JPEG zurück, wenn der Browser kein WebP erzeugen kann (älteres Safari).
 */
export async function compressImage(file, { maxSize = 1600, quality = 0.75, type = 'image/webp' } = {}) {
  const before = file.size;
  let source, ow, oh;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    ow = source.width; oh = source.height;
  } catch {
    source = await new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Dieses Bildformat kann der Browser nicht öffnen.')); };
      img.src = url;
    });
    ow = source.naturalWidth; oh = source.naturalHeight;
  }
  const scale = Math.min(1, maxSize / Math.max(ow, oh));
  const w = Math.max(1, Math.round(ow * scale)), hgt = Math.max(1, Math.round(oh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, hgt);
  if (source.close) source.close();
  const toBlob = (t, q) => new Promise(res => canvas.toBlob(res, t, q));
  let blob = await toBlob(type, quality);
  if (!blob || blob.type !== type) blob = await toBlob('image/jpeg', Math.min(0.85, quality + 0.07));
  const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const name = String(file.name || 'foto').replace(/\.[^.]+$/, '') + '.' + ext;
  const after = blob.size;
  return { blob, dataUrl, type: blob.type, name, before, after, width: w, height: hgt, originalWidth: ow, originalHeight: oh,
    savedPercent: before ? Math.max(0, Math.round((1 - after / before) * 100)) : 0 };
}
/** Anzeige „vorher 4,2 MB → nachher 310 KB (−93 %)“ als Element */
export function compressResult({ before, after, savedPercent }) {
  return h('div', { class: 'compress-result' },
    h('span', { class: 'compress-result__before' }, 'vorher ' + formatBytes(before)),
    h('span', { 'aria-hidden': 'true' }, '→'),
    h('span', { class: 'compress-result__after' }, 'nachher ' + formatBytes(after)),
    h('span', { class: 'compress-result__pct' }, `−${savedPercent} %`));
}

/* ---------------------------------------------------------
   HTML säubern (Einfügen aus Word/E-Mail, Editor-Ausgabe)
   --------------------------------------------------------- */
const ALLOWED = { P: [], H2: [], H3: [], STRONG: [], B: [], EM: [], I: [], UL: [], OL: [], LI: [], BR: [], A: ['href'], IMG: ['src', 'alt'], BLOCKQUOTE: [] };
/** Lässt nur p, h2, h3, strong/b, em/i, ul/ol/li, br, a[href], img[src,alt], blockquote übrig. Wandelt h1→h2, h4-6→h3, div→p. */
export function sanitizeHTML(dirty) {
  const doc = new DOMParser().parseFromString(`<body>${dirty || ''}</body>`, 'text/html');
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      let tag = child.tagName;
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT', 'SVG', 'XML'].includes(tag)) { child.remove(); continue; }
      const map = { H1: 'H2', H4: 'H3', H5: 'H3', H6: 'H3', DIV: 'P', SECTION: 'P', ARTICLE: 'P' };
      if (map[tag]) {
        const n = doc.createElement(map[tag]); while (child.firstChild) n.append(child.firstChild); child.replaceWith(n);
        walk(n); continue;
      }
      if (!ALLOWED[tag]) { walk(child); child.replaceWith(...child.childNodes); continue; }
      for (const at of Array.from(child.attributes)) {
        if (!ALLOWED[tag].includes(at.name)) child.removeAttribute(at.name);
      }
      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (/^\s*javascript:/i.test(href)) child.removeAttribute('href');
        if (/^https?:/i.test(href)) { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener'); }
      }
      if (tag === 'IMG' && /^\s*javascript:/i.test(child.getAttribute('src') || '')) { child.remove(); continue; }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML.replace(/<p>\s*(<br>)?\s*<\/p>/g, '').trim();
}
/** HTML → reiner Text (z. B. für Vorschautexte, Suche) */
export function stripHTML(s) {
  const d = document.createElement('div'); d.innerHTML = s || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

/* ---------------------------------------------------------
   Platzhalter aus Vorlagen: „[Datum]“
   --------------------------------------------------------- */
const PH_RE = /\[[^\]\n]{1,40}\]/g;
const PH_ONE = /\[[^\]\n]{1,40}\]/;
/** Platzhalter im Editor als <mark class="ph"> hervorheben (wird beim Speichern von sanitizeHTML wieder entfernt). */
function decoratePlaceholders(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentNode.closest && n.parentNode.closest('mark.ph')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (walker.nextNode()) if (PH_ONE.test(walker.currentNode.data)) nodes.push(walker.currentNode);
  for (const tn of nodes) {
    PH_RE.lastIndex = 0;
    const text = tn.data; const frag = document.createDocumentFragment(); let last = 0, m;
    while ((m = PH_RE.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(h('mark', { class: 'ph', title: 'Antippen und einfach Ihren Text schreiben' }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    tn.replaceWith(frag);
  }
  PH_RE.lastIndex = 0;
}
/** Markierung entfernen, sobald der Platzhalter überschrieben ist (Schreibmarke bleibt, wo sie war). */
function tidyPlaceholders(root) {
  const marks = Array.from(root.querySelectorAll('mark.ph')).filter(m => !/^\[[^\]\n]{1,40}\]$/.test(m.textContent));
  if (!marks.length) return;
  const s = getSelection(); const node = s.anchorNode, off = s.anchorOffset;
  for (const m of marks) m.replaceWith(...m.childNodes);
  if (node && node.isConnected && root.contains(node)) { try { s.collapse(node, Math.min(off, node.nodeType === 3 ? node.length : node.childNodes.length)); } catch { /* egal */ } }
}
/** Eingabefeld/Textbereich: Antippen eines „[Platzhalters]“ markiert ihn ganz → Tippen ersetzt ihn. */
export function selectPlaceholderOnTap(input) {
  const pick = () => {
    const v = input.value, pos = input.selectionStart;
    if (pos == null || input.selectionEnd !== pos) return;
    PH_RE.lastIndex = 0; let m;
    while ((m = PH_RE.exec(v))) { if (pos >= m.index && pos <= m.index + m[0].length) { input.setSelectionRange(m.index, m.index + m[0].length); break; } }
    PH_RE.lastIndex = 0;
  };
  input.addEventListener('click', () => setTimeout(pick, 0));
  return input;
}

/* ---------------------------------------------------------
   WYSIWYG-Editor (contenteditable + feste kleine Leiste)
   --------------------------------------------------------- */
const TOOLS = {
  heading: { icon: 'Ü', label: 'Überschrift', title: 'Zwischenüberschrift ein/aus' },
  bold:    { icon: 'F', label: 'Fett', title: 'Markierten Text fett' },
  list:    { icon: '•', label: 'Liste', title: 'Aufzählung ein/aus' },
  link:    { icon: '🔗', label: 'Link', title: 'Markierten Text verlinken' },
  image:   { icon: '🖼', label: 'Bild', title: 'Bild einfügen' },
  undo:    { icon: '↶', label: 'Rückgängig', title: 'Letzte Änderung zurücknehmen' },
};
/**
 * createEditor(container, {value, toolbar:['heading','bold','list','link','image','undo'], placeholder, label,
 *                          onChange(html), onImage(insert)})
 * onImage(insert): eigener Bild-Auswahldialog; insert({src, alt}) fügt ein. Ohne onImage: Dateiauswahl + compressImage.
 * → {el, area, getHTML(), setHTML(html), insertHTML(html), focus(), destroy()}
 */
export function createEditor(container, { value = '', toolbar = ['heading', 'bold', 'list', 'link', 'image', 'undo'], placeholder = 'Hier schreiben …', label = 'Text', onChange, onImage } = {}) {
  const area = h('div', { class: 'editor__area', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, 'data-placeholder': placeholder });
  area.innerHTML = sanitizeHTML(value);
  const bar = h('div', { class: 'editor__toolbar', role: 'toolbar', 'aria-label': 'Werkzeuge für den Text' });
  const btns = {};
  for (const t of toolbar) {
    const def = TOOLS[t]; if (!def) continue;
    const b = h('button', { type: 'button', class: 'editor__btn', title: def.title, 'aria-pressed': ['heading', 'bold', 'list'].includes(t) ? 'false' : null },
      h('b', { 'aria-hidden': 'true' }, def.icon), def.label);
    b.addEventListener('mousedown', e => e.preventDefault()); // Auswahl im Text behalten
    b.addEventListener('click', () => run(t));
    btns[t] = b; bar.append(b);
  }
  const el = h('div', { class: 'editor' }, bar, area);
  container.append(el);

  const exec = (cmd, val = null) => { area.focus(); document.execCommand(cmd, false, val); changed(); };
  function run(t) {
    if (t === 'bold') exec('bold');
    if (t === 'list') exec('insertUnorderedList');
    if (t === 'undo') exec('undo');
    if (t === 'heading') {
      const block = currentBlock();
      exec('formatBlock', block && block.tagName === 'H2' ? 'p' : 'h2');
    }
    if (t === 'link') linkDialog();
    if (t === 'image') imageDialog();
  }
  function currentBlock() {
    const sel = getSelection(); if (!sel.rangeCount) return null;
    let n = sel.anchorNode; while (n && n !== area) { if (n.nodeType === 1 && /^(P|H2|H3|LI|DIV)$/.test(n.tagName)) return n; n = n.parentNode; }
    return null;
  }
  function saveRange() { const s = getSelection(); return s.rangeCount && area.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; }
  function restoreRange(r) { area.focus(); if (!r) return; const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  function linkDialog() {
    const r = saveRange();
    const text = r ? r.toString() : '';
    const fUrl = field({ label: 'Webadresse', value: 'https://', hint: 'Zum Beispiel https://www.kolping.de – oder eine Seite dieser Website.', type: 'url' });
    const fText = field({ label: 'Angezeigter Text', value: text, hint: 'Was soll im Text anklickbar sein?' });
    modal({
      title: 'Link einfügen', body: h('div', {}, fText.el, fUrl.el),
      actions: [{ label: 'Abbrechen' }, { label: 'Link einfügen', icon: '🔗', variant: 'primary', onClick: (close) => {
        const url = fUrl.value();
        if (!url || url === 'https://') { fUrl.setError('Bitte eine Webadresse eingeben, z. B. https://www.kolping.de'); return; }
        close(); restoreRange(r);
        const t = fText.value() || url;
        document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(t)}</a>`); changed();
      } }],
    });
  }
  function imageDialog() {
    const r = saveRange();
    const insert = ({ src, alt = '' }) => { restoreRange(r); document.execCommand('insertHTML', false, `<img src="${esc(src)}" alt="${esc(alt)}">`); changed(); };
    if (onImage) { onImage(insert); return; }
    const inp = h('input', { type: 'file', accept: 'image/*', hidden: true });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; inp.remove(); if (!f) return;
      try { const c = await compressImage(f); insert({ src: c.dataUrl, alt: '' }); toast(`Bild eingefügt und verkleinert: ${formatBytes(c.before)} → ${formatBytes(c.after)}`); }
      catch (e) { toast(e.message || 'Bild konnte nicht geladen werden', { type: 'error' }); }
    });
    document.body.append(inp); inp.click();
  }
  // Einfügen aus Word/E-Mail: Formatierung bereinigen
  area.addEventListener('paste', e => {
    const cd = e.clipboardData; if (!cd) return;
    e.preventDefault();
    const htmlData = cd.getData('text/html');
    const clean = htmlData ? sanitizeHTML(htmlData) : esc(cd.getData('text/plain')).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, clean);
    changed();
  });
  area.addEventListener('input', () => { tidyPlaceholders(area); changed(); });
  // Platzhalter aus Vorlagen („[Datum]“) gelb markieren; Antippen markiert den ganzen Platzhalter → einfach lostippen
  decoratePlaceholders(area);
  area.addEventListener('click', (e) => {
    const m = e.target.closest && e.target.closest('mark.ph');
    if (!m || !area.contains(m)) return;
    const r = document.createRange(); r.selectNodeContents(m);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const updateState = () => {
    if (!area.contains(getSelection().anchorNode)) return;
    btns.bold && btns.bold.setAttribute('aria-pressed', String(document.queryCommandState('bold')));
    btns.list && btns.list.setAttribute('aria-pressed', String(document.queryCommandState('insertUnorderedList')));
    const b = currentBlock(); btns.heading && btns.heading.setAttribute('aria-pressed', String(!!b && b.tagName === 'H2'));
  };
  document.addEventListener('selectionchange', updateState);
  function changed() { onChange && onChange(api.getHTML()); updateState(); }
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* egal */ }

  const api = {
    el, area,
    getHTML: () => sanitizeHTML(area.innerHTML),
    setHTML: (v) => { area.innerHTML = sanitizeHTML(v); decoratePlaceholders(area); },
    insertHTML: (v) => { area.focus(); document.execCommand('insertHTML', false, sanitizeHTML(v)); changed(); },
    focus: () => area.focus(),
    destroy: () => { document.removeEventListener('selectionchange', updateState); el.remove(); },
  };
  return api;
}

/* ---------------------------------------------------------
   Seitenkopf für Admin-Unterseiten, Leerzustand
   --------------------------------------------------------- */
/** pageHeader({title, intro, back: {href:'#/admin', label:'Zurück zur Übersicht'}, actions:[Node], badge: Node}) */
export function pageHeader({ title, intro, back = { href: '#/admin', label: 'Zurück zur Übersicht' }, actions = [], badge: b } = {}) {
  return h('header', { class: 'page-head' },
    back ? h('a', { class: 'back-link', href: back.href }, h('span', { 'aria-hidden': 'true' }, '←'), ' ', back.label) : null,
    h('div', { class: 'page-head__row' },
      h('h1', { class: 'page-head__title' }, title, b ? ' ' : null, b || null),
      actions.length ? h('div', { class: 'page-head__actions' }, actions) : null),
    intro ? h('p', { class: 'page-head__intro' }, intro) : null);
}
/** emptyState({icon:'📭', title:'Noch nichts da', text:'…', action: Node}) */
export function emptyState({ icon = '📭', title, text, action } = {}) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state__icon', 'aria-hidden': 'true' }, icon),
    title ? h('h3', {}, title) : null, text ? h('p', {}, text) : null, action || null);
}

/* ---------------------------------------------------------
   E-Mail (Resend) – im Prototyp nur Vorschau
   --------------------------------------------------------- */
/** HTML einer Vereins-E-Mail im Kolping-Stil */
export function mailHTML({ heading, text, ctaLabel, footer }) {
  return html`<div class="mail"><div class="mail__top"></div>
    <div class="mail__head"><img src="img/kolping-logo.svg" alt=""><span>Kolpingsfamilie Ramsen</span></div>
    <div class="mail__content">${heading ? raw(`<h2>${esc(heading)}</h2>`) : ''}${raw(text || '')}
      ${ctaLabel ? raw(`<p><button type="button" class="mail__cta" data-mail-cta>${esc(ctaLabel)}</button></p>`) : ''}</div>
    <div class="mail__foot">${raw(footer || 'Bei Fragen: Stefan Beispiel (technische Hilfe), Tel. 0000 / 000 000 · Diese E-Mail wurde automatisch verschickt.')}</div></div>`;
}
/**
 * sendMail({to, toName, subject, kind:'magic-link'|'invite'|'reset'|'contact'|'rundmail'|..., heading, text (HTML),
 *           cta: {label, onClick}, footer, silent})
 * Legt die Mail im Postausgang (db 'mails') ab, schreibt ins Änderungsprotokoll und zeigt die Vorschau
 * „Diese E-Mail würde jetzt verschickt“. Klick auf den grünen Knopf in der Mail ruft cta.onClick() auf.
 * → {close, mail}
 */
export function sendMail({ to, toName, subject, kind = 'info', heading, text, cta, footer, silent = false } = {}) {
  const bodyHtml = mailHTML({ heading, text, ctaLabel: cta && cta.label, footer });
  const mail = db.insert('mails', { to, toName: toName || '', subject, kind, html: bodyHtml, at: nowIso(), via: 'Resend' });
  log('mail.send', `E-Mail „${subject}“`, `an ${toName ? toName + ' <' + to + '>' : to}`);
  if (silent) return { mail, close: () => {} };
  return { mail, ...showMailPreview(mail, cta) };
}
/** Zeigt eine gespeicherte Mail als Vorschau (z. B. aus dem Postausgang) */
export function showMailPreview(mail, cta) {
  const wrap = h('div', {},
    h('div', { class: 'mail-note' }, h('span', { 'aria-hidden': 'true' }, '✉'),
      h('span', {}, 'Im echten System würde diese E-Mail jetzt über Resend verschickt. Im Prototyp sehen Sie hier, was ankommt.')),
    h('div', { class: 'mail-preview' },
      h('div', { class: 'mail-preview__meta' },
        h('div', {}, h('b', {}, 'Von:'), ' Kolpingsfamilie Ramsen <noreply@kolping-ramsen.de>'),
        h('div', {}, h('b', {}, 'An:'), ` ${mail.toName ? mail.toName + ' <' + mail.to + '>' : mail.to}`),
        h('div', {}, h('b', {}, 'Betreff:'), ' ', h('strong', {}, mail.subject))),
      h('div', { class: 'mail-preview__body', html: mail.html })),
    h('p', { class: 'mail__via' }, 'Versand über Resend · kein echter Versand im Prototyp'));
  const m = modal({ title: 'Diese E-Mail würde verschickt', body: wrap, wide: false,
    actions: cta ? [] : [{ label: 'Verstanden', variant: 'primary' }] });
  const btn = m.body.querySelector('[data-mail-cta]');
  if (btn) {
    if (cta && cta.onClick) btn.addEventListener('click', () => { m.close(); cta.onClick(); });
    else btn.addEventListener('click', () => toast('Im Prototyp führt dieser Knopf nirgendwohin.', { type: 'info' }));
  }
  return m;
}

/* ---------------------------------------------------------
   Lightbox (Galerie)
   --------------------------------------------------------- */
/** lightbox([{src, alt, caption}], startIndex) */
export function lightbox(items, start = 0) {
  let i = start;
  const img = h('img', { alt: '' });
  const cap = h('div', { class: 'lightbox__caption' });
  const count = h('div', { class: 'lightbox__count', 'aria-live': 'polite' });
  const prev = h('button', { class: 'lightbox__nav lightbox__prev', type: 'button', 'aria-label': 'Vorheriges Bild' }, '‹');
  const next = h('button', { class: 'lightbox__nav lightbox__next', type: 'button', 'aria-label': 'Nächstes Bild' }, '›');
  const closeBtn = h('button', { class: 'lightbox__close', type: 'button' }, '✕ Schließen');
  const stage = h('div', { class: 'lightbox__stage' }, img, items.length > 1 ? prev : null, items.length > 1 ? next : null);
  const el = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bildergalerie' },
    h('div', { class: 'lightbox__bar' }, count, closeBtn), stage, cap);
  const show = () => {
    const it = items[i]; img.src = it.src; img.alt = it.alt || ''; cap.textContent = it.caption || it.alt || '';
    count.textContent = `Bild ${i + 1} von ${items.length}`;
  };
  const go = d => { i = (i + d + items.length) % items.length; show(); };
  const prevFocus = document.activeElement;
  const close = () => { el.remove(); document.removeEventListener('keydown', key); document.body.style.overflow = ''; prevFocus && prevFocus.focus && prevFocus.focus(); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
  prev.onclick = () => go(-1); next.onclick = () => go(1); closeBtn.onclick = close;
  el.addEventListener('click', e => { if (e.target === stage) close(); });
  let sx = null;
  stage.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); sx = null; });
  document.addEventListener('keydown', key);
  document.body.append(el); document.body.style.overflow = 'hidden';
  show(); closeBtn.focus();
  return { close };
}

/* ---------------------------------------------------------
   Sonstiges
   --------------------------------------------------------- */
/** Datei zum Herunterladen anbieten */
export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Dateityp → Symbol */
export function fileIcon(type) {
  return ({ pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', image: '🖼', jpg: '🖼', jpeg: '🖼', png: '🖼', webp: '🖼', protocol: '📝', zip: '🗜' })[String(type).toLowerCase()] || '📄';
}
/** Avatar-Kreis mit Initialen */
export function avatar(user, { size = 44 } = {}) {
  return h('span', { class: 'avatar', style: { '--av': user?.color || '#57534e', width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px' }, 'aria-hidden': 'true' }, user?.initials || '?');
}
