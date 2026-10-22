// =========================================================
// inhalte/editing.js – Bausteine für die Bearbeiten-Seiten
// (automatisches Speichern, Status-Kasten, Titelbild-Wahl)
// =========================================================
import { db, log } from '../../store.js';
import { can } from '../../auth.js';
import { h, button, autosaveIndicator, debounce, toast, formatDateTime, relativeTime } from '../../ui.js';
import { mediaPicker } from '../../admin.js';
import { MODEL, saveWorking, hasPending, isLive, mImg, working } from './common.js';

/**
 * Automatisches Speichern mit sichtbarer Anzeige.
 * autosaver(coll, id, {onSaved}) → {indicator, queue(key, value), flush(), destroy()}
 * Das Änderungsprotokoll bekommt pro Bearbeitung nur einen Eintrag (nicht pro Tastendruck).
 */
export function autosaver(coll, id, { onSaved, label } = {}) {
  const M = MODEL[coll];
  const item = db.find(coll, id);
  const indicator = autosaveIndicator();
  const last = item && (item.pendingAt || item.updatedAt);
  indicator.idle(last ? `✓ Gespeichert ${relativeTime(last)}` : '✓ Alles gespeichert');
  let patch = {};
  let logged = false;
  let mayWrite = false; // Recht zum Zeitpunkt der Eingabe (Rollenwechsel mitten im Tippen verliert nichts)
  const flush = () => {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const p = patch; patch = {};
    window.__kolpingDirty = false;
    if (!mayWrite && !can(M.perm)) { indicator.error('Nicht gespeichert – keine Berechtigung'); return; }
    mayWrite = false;
    const before = db.find(coll, id);
    const live = before && isLive(coll, before);
    const wBefore = JSON.stringify(working(coll, before));
    saveWorking(coll, id, p);
    indicator.saved(new Date());
    const changed = wBefore !== JSON.stringify(working(coll, db.find(coll, id)));
    if (!logged && changed) {
      const cur = db.find(coll, id);
      log(`${M.act}.update`, `${M.label} „${(cur.pending && cur.pending.title) || cur.title}“`,
        live ? 'Änderung vorbereitet – noch nicht auf der Website' : 'Entwurf gespeichert');
      logged = true;
    }
    onSaved && onSaved(db.find(coll, id));
  };
  const deb = debounce(flush, 700);
  return {
    indicator,
    queue(key, value) { if (!can(M.perm)) { indicator.error('Nicht gespeichert – keine Berechtigung'); return; } mayWrite = true; patch[key] = value; window.__kolpingDirty = true; indicator.saving(); deb(); },
    flush() { deb.cancel(); flush(); },
    destroy() { deb.cancel(); flush(); window.__kolpingDirty = false; },
  };
}

/** Status-Kasten oben im Editor: Entwurf / auf der Website / Änderungen noch nicht veröffentlicht */
export function statusBox(coll, item, { publicHref, onDiscard, liveLabel = 'Steht auf der Website' }) {
  const live = isLive(coll, item);
  const pending = hasPending(coll, item);
  if (!live) {
    return h('div', { class: 'notice notice--warn inhalte-status', role: 'status' },
      h('span', { class: 'inhalte-status__icon', 'aria-hidden': 'true' }, '✎'),
      h('div', {}, h('strong', {}, 'Entwurf – noch nicht auf der Website. '),
        'Besucher sehen ihn erst, wenn Sie unten auf „Auf der Website zeigen“ tippen. Bis dahin können Sie in Ruhe schreiben – alles wird automatisch gespeichert.'));
  }
  if (pending) {
    return h('div', { class: 'notice notice--info inhalte-status', role: 'status' },
      h('span', { class: 'inhalte-status__icon', 'aria-hidden': 'true' }, '✎'),
      h('div', {},
        h('p', {}, h('strong', {}, 'Ihre Änderungen sind gespeichert, aber noch nicht auf der Website. '),
          'Besucher sehen noch die bisherige Fassung. Tippen Sie unten auf „Änderungen auf der Website zeigen“.'),
        h('div', { class: 'cluster' },
          publicHref ? button({ label: 'Bisherige Fassung ansehen', icon: '🌐', size: 'sm', href: publicHref }) : null,
          button({ label: 'Änderungen verwerfen', icon: '↶', size: 'sm', onClick: onDiscard }))));
  }
  return h('div', { class: 'notice notice--ok inhalte-status', role: 'status' },
    h('span', { class: 'inhalte-status__icon', 'aria-hidden': 'true' }, '✓'),
    h('div', {}, h('strong', {}, `${liveLabel}`), item.publishedAt ? ` – seit ${formatDateTime(item.publishedAt)}.` : '.',
      ' Wenn Sie etwas ändern, bleibt die Website-Fassung, bis Sie die Änderungen veröffentlichen.',
      publicHref ? h('div', { class: 'cluster inhalte-status__links' }, button({ label: 'Jetzt auf der Website ansehen', icon: '🌐', size: 'sm', href: publicHref })) : null));
}

/** Änderungen verwerfen mit Rückgängig */
export function discardPending(coll, id, after) {
  const M = MODEL[coll];
  if (!can(M.perm)) return;
  const item = db.find(coll, id);
  const prev = item.pending;
  db.update(coll, id, { pending: null, pendingAt: null, pendingBy: null });
  log(`${M.act}.discard`, `${M.label} „${item.title}“`, 'Änderungen verworfen – Website-Fassung bleibt');
  toast('Änderungen verworfen – es gilt wieder die Website-Fassung.', {
    undo: () => { db.update(coll, id, { pending: prev }); log(`${M.act}.update`, `${M.label} „${item.title}“`, 'Rückgängig gemacht: Änderungen wiederhergestellt'); after && after(); } });
  after && after();
}

/**
 * Titelbild-Auswahl (nur Website-Fotos, nie Ablage-Dateien).
 * imageChooser({value, label, hint, onChange(mediaId|null)}) → {el, set(id)}
 */
export function imageChooser({ value, label = 'Titelbild', hint, onChange, num }) {
  const preview = h('div', { class: 'inhalte-img__preview' });
  const buttons = h('div', { class: 'cluster' });
  const labelId = 'inh-img-' + Math.random().toString(36).slice(2, 7);
  let cur = value || null;
  const draw = () => {
    const img = cur ? mImg(cur, { size: 's', alt: '' }) : null;
    preview.replaceChildren(img || h('div', { class: 'inhalte-img__none' }, h('span', { 'aria-hidden': 'true' }, '🖼'), h('span', {}, 'Noch kein Bild gewählt')));
    const m = cur ? db.find('media', cur) : null;
    preview.append(m && img ? h('p', { class: 'inhalte-img__alt' }, m.alt || m.originalName || '') : '');
    buttons.replaceChildren(
      button({ label: cur ? 'Anderes Foto wählen' : 'Foto auswählen', icon: '🖼', onClick: () => {
        if (!can('site.media.upload') && !can('site.news.edit') && !can('site.pages.edit')) return;
        mediaPicker({ title: `${label}: Foto auswählen`, allowUpload: can('site.media.upload'), onPick: (mm) => { cur = mm.id; draw(); onChange && onChange(cur); } });
      } }),
      cur ? button({ label: 'Kein Bild', icon: '✕', onClick: () => { const old = cur; cur = null; draw(); onChange && onChange(null);
        toast('Bild entfernt.', { undo: () => { cur = old; draw(); onChange && onChange(old); } }); } }) : null);
  };
  draw();
  const el = h('div', { class: 'field inhalte-img', role: 'group', 'aria-labelledby': labelId },
    h('span', { class: 'field__label', id: labelId }, num ? h('span', { class: 'inhalte-num', 'aria-hidden': 'true' }, num) : null, label),
    hint ? h('div', { class: 'field__hint' }, hint) : null,
    h('div', { class: 'inhalte-img__row' }, preview, buttons));
  return { el, set(id) { cur = id; draw(); } };
}

/** Überschrift mit Nummer für feste Vorlagen: „③ Titel der Seite“ */
export function numLabel(num, text) { return [h('span', { class: 'inhalte-num', 'aria-hidden': 'true' }, num), text]; }
