// =========================================================
// modules/ablage.js – Dateiablage des Vorstands
// „Wie ein Aktenschrank“: große Ordner-Kacheln, Brotkrumen,
// sichtbares Rechte-Schild je Ordner (vererbt), Dateiliste,
// Vorschau, Hochladen (Fotos werden verkleinert), Neuer Ordner,
// Umbenennen, Verschieben, Freigeben, Papierkorb, Speicherplatz,
// Suche. Jede Aktion prüft can() und schreibt ins Audit-Log.
// Regeln & API: siehe CONVENTIONS.md
// =========================================================
import { registerRoute, navigate, rerender } from '../app.js';
import { db, log, uid, nowIso, prefsStore, userName, folderPath, folderVisibility, folderAlive, ACTION_LABELS } from '../store.js';
import { can, currentUser, userCan, canSeeVisibility, roleOf } from '../auth.js';
import { h, button, toast, modal, confirmDialog, field, pageHeader, emptyState, visibilityBadge, badge, VISIBILITY,
  formatBytes, formatDate, formatDateTime, relativeTime, compressImage, compressResult, downloadFile, fileIcon, avatar } from '../ui.js';
import { trashItem, demoPhotoFile, notice, registerHelp, registerSearchProvider, forbiddenPage } from '../admin.js';
import { makePdf } from './ablage/pdf.js';

/* ---------------------------------------------------------
   Grundlagen: Rechte, Lebendigkeit, Sichtbarkeit
   --------------------------------------------------------- */
const BASE = '#/admin/ablage';
const QUOTA = 5 * 1024 ** 3;               // Beispiel: 5 GB Platz für die Ablage auf dem kleinen Server
const TRASH_DAYS = 30;
const MAX_DEPTH = 3;                       // mehr als drei Ebenen wird unübersichtlich
const RANK = { public: 0, members: 1, board: 2 };

// Zusätzliche lesbare Bezeichnungen fürs Änderungsprotokoll (Kern-Objekt wird nur ergänzt)
Object.assign(ACTION_LABELS, {
  'folder.rename': 'hat Ordner umbenannt', 'folder.move': 'hat Ordner verschoben',
  'folder.share': 'hat geändert, wer einen Ordner sieht', 'file.share': 'hat Datei für Mitglieder freigegeben',
  'file.download': 'hat Datei heruntergeladen',
});

const P = {
  view: () => can('files.view'),
  upload: () => can('files.upload'),
  edit: () => can('files.upload'),                       // umbenennen, verschieben
  remove: () => can('files.delete'),
  share: () => can('files.upload') && can('files.board'), // Freigeben = Vorstand (sieht „Nur Vorstand“ und darf ablegen)
  purge: () => can('trash.purge'),
};
const PERM_TEXT = {
  upload: 'Dateien ablegen und Ordner anlegen (files.upload)',
  edit: 'Dateien ablegen und Ordner anlegen (files.upload)',
  remove: 'Dateien in den Papierkorb legen (files.delete)',
  share: 'Freigeben (files.upload + files.board)',
  purge: 'Endgültig löschen (trash.purge)',
};
/** Prüft ein Recht vor einer Aktion. Ohne Recht: freundliche Meldung + Audit-Eintrag. */
function allowed(key, what) {
  if (P[key]()) return true;
  log('access.denied', what || 'Ablage', `fehlendes Recht: ${PERM_TEXT[key] || key}`);
  toast('Das dürfen Sie mit Ihrem Konto leider nicht. Bitte wenden Sie sich an den Vorstand.', { type: 'error', icon: '🔒' });
  return false;
}

function folderVisible(f) {
  return !!f && folderAlive(f.id) && canSeeVisibility(folderVisibility(f.id));
}
function fileVisible(f) {
  return !!f && !f.deletedAt && folderAlive(f.folderId) && canSeeVisibility(folderVisibility(f.folderId));
}
const childrenOf = (id) => db.all('folders').filter(f => f.parentId === id && folderVisible(f)).sort(byName);
const filesIn = (id) => db.all('files').filter(f => f.folderId === id && fileVisible(f));
/** Oberste sichtbare Ordner (Wurzeln oder Ordner, deren Elternordner man nicht sehen darf) */
function visibleRoots() {
  return db.all('folders').filter(f => folderVisible(f) && (!f.parentId || !folderVisible(db.find('folders', f.parentId))))
    .sort((a, b) => (RANK[folderVisibility(b.id)] - RANK[folderVisibility(a.id)]) || byName(a, b));
}
function descendants(id) {
  const out = []; const walk = (pid) => { for (const f of db.all('folders').filter(x => x.parentId === pid)) { out.push(f); walk(f.id); } };
  walk(id); return out;
}
function deepStats(id) {
  const ids = [id, ...descendants(id).filter(folderVisible).map(f => f.id)];
  const files = db.all('files').filter(f => ids.includes(f.folderId) && fileVisible(f));
  return { folders: ids.length - 1, files: files.length, size: files.reduce((s, f) => s + (f.size || 0), 0) };
}
const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });
const pathText = (id) => folderPath(id).map(f => f.name).join(' › ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Wer sieht eine Sichtbarkeitsstufe? (für die Anzeige am Ordner) */
function userSeesVis(u, vis) {
  if (vis === 'public') return true;
  if (vis === 'members') return userCan(u, 'members.view');
  return userCan(u, 'files.board') && userCan(u, 'files.view');
}
const activeUsers = () => db.all('users').filter(u => u.active !== false);

/* ---------------------------------------------------------
   Dateitypen, Vorschaubilder, Inhalte (nur im Speicher)
   --------------------------------------------------------- */
const BLOBS = new Map();      // fileId → Blob (nur in dieser Sitzung; localStorage wäre zu klein)
const BLOB_URLS = new Map();
function blobUrl(id) {
  if (!BLOBS.has(id)) return null;
  if (!BLOB_URLS.has(id)) BLOB_URLS.set(id, URL.createObjectURL(BLOBS.get(id)));
  return BLOB_URLS.get(id);
}
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'avif'];
const extOf = (name) => { const m = String(name).match(/\.([a-z0-9]{1,5})$/i); return m ? m[1].toLowerCase() : ''; };
function typeKey(f) {
  const t = String(f.type || '').toLowerCase();
  if (t === 'protocol') return 'protocol';
  if (t === 'image' || IMAGE_EXT.includes(t)) return 'image';
  if (t === 'pdf') return 'pdf';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(t)) return 'sheet';
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(t)) return 'text';
  return 'other';
}
const TYPE_LABEL = { protocol: 'Online-Protokoll', image: 'Foto', pdf: 'PDF-Dokument', sheet: 'Tabelle (Excel)', text: 'Text (Word)', other: 'Datei' };
const TYPE_ICON = { protocol: '📝', image: '🖼', pdf: '📄', sheet: '📊', text: '📝', other: '📎' };
function seedPreview(f) {
  return typeKey(f) === 'image' && /kassenbuch/i.test(f.name) ? 'img/ablage/kassenbuch.svg' : null;
}
function previewUrl(f, size = 's') {
  if (typeKey(f) !== 'image') return null;
  if (size === 'l') return blobUrl(f.id) || f.dataUrl || f.thumbUrl || seedPreview(f);
  return f.thumbUrl || f.dataUrl || seedPreview(f) || blobUrl(f.id);
}

/* ---------------------------------------------------------
   Kleine UI-Bausteine der Ablage
   --------------------------------------------------------- */
function crumbs(folderId) {
  const path = folderId ? folderPath(folderId) : [];
  const items = [{ name: 'Ablage', href: BASE, icon: '🗄' }, ...path.map(f => ({ name: f.name, href: `${BASE}/${f.id}`, id: f.id }))];
  return h('nav', { class: 'ablage-crumbs', 'aria-label': 'Sie sind hier' },
    h('ol', {}, items.map((it, i) => {
      const last = i === items.length - 1;
      const visible = !it.id || folderVisible(db.find('folders', it.id));
      return h('li', {},
        i > 0 ? h('span', { class: 'ablage-crumbs__sep', 'aria-hidden': 'true' }, '›') : null,
        last || !visible ? h('span', { class: 'ablage-crumbs__here', 'aria-current': last ? 'page' : null }, it.icon ? it.icon + ' ' : '📁 ', it.name)
          : h('a', { href: it.href }, it.icon ? it.icon + ' ' : '📁 ', it.name));
    })));
}

function typeBadgeIcon(f) {
  const k = typeKey(f);
  return h('span', { class: `ablage-type ablage-type--${k}`, 'aria-hidden': 'true' }, TYPE_ICON[k] || fileIcon(f.type));
}

function whoSeesLine(vis) {
  if (vis === 'public') return 'Dateien erscheinen auf der Website zum Herunterladen – ohne Anmeldung.';
  if (vis === 'members') { const n = activeUsers().filter(u => userSeesVis(u, 'members')).length; return `Derzeit ${n} Zugänge – Dateien erscheinen im Mitgliederbereich der Website.`; }
  return 'Sehen können: ' + (activeUsers().filter(u => userSeesVis(u, 'board')).map(u => u.name).join(', ') || 'niemand');
}

/** Großes Rechte-Schild mit Erklärung, wer den Ordner sieht (und wer nicht) */
function visibilityPanel(folder, { onChange } = {}) {
  const vis = folderVisibility(folder.id);
  const path = folderPath(folder.id);
  const source = [...path].reverse().find(f => f.visibility);
  const inherited = source && source.id !== folder.id;
  const sees = activeUsers().filter(u => userSeesVis(u, vis));
  const notSees = activeUsers().filter(u => !userSeesVis(u, vis));
  return h('section', { class: `ablage-vis ablage-vis--${vis}`, 'aria-label': 'Wer darf diesen Ordner sehen?' },
    h('div', { class: 'ablage-vis__head' },
      h('span', { class: 'ablage-vis__icon', 'aria-hidden': 'true' }, VISIBILITY[vis].icon),
      h('div', { class: 'ablage-vis__text' },
        h('p', { class: 'ablage-vis__title' }, 'Diesen Ordner sieht: ', h('strong', {}, VISIBILITY[vis].long)),
        inherited ? h('p', { class: 'ablage-vis__sub' }, `Das Schild kommt vom Ordner „${source.name}“ und gilt für alles, was hier drin liegt.`)
          : h('p', { class: 'ablage-vis__sub' }, 'Das Schild gilt für alle Dateien und Unterordner hier drin. Einzelne Dateien haben keine eigenen Rechte.'),
        vis === 'public' ? h('p', { class: 'ablage-vis__sub' }, 'Dateien hier erscheinen auf der Website zum Herunterladen.') : null,
        vis === 'members' ? h('p', { class: 'ablage-vis__sub' }, 'Mitglieder finden diese Dateien im ', h('a', { href: '#/mitglieder' }, 'Mitgliederbereich der Website'), '.') : null),
      onChange ? button({ label: 'Wer darf das sehen? ändern', icon: '👁', onClick: onChange }) : null),
    vis !== 'public' ? h('div', { class: 'ablage-vis__people' },
      h('div', { class: 'ablage-vis__group' }, h('span', { class: 'ablage-vis__label' }, '✓ Sehen den Ordner:'),
        h('ul', { class: 'ablage-people' }, sees.map(u => h('li', {}, avatar(u, { size: 32 }), h('span', {}, u.name, h('small', {}, ' · ', roleOf(u)?.short || '')))))),
      notSees.length ? h('div', { class: 'ablage-vis__group ablage-vis__group--no' }, h('span', { class: 'ablage-vis__label' }, '✕ Sehen ihn nicht – nicht im Menü, nicht in der Suche:'),
        h('ul', { class: 'ablage-people' }, notSees.map(u => h('li', {}, avatar(u, { size: 32 }), h('span', {}, u.name, h('small', {}, ' · ', roleOf(u)?.short || '')))))) : null)
      : null);
}

function folderTile(f) {
  const vis = folderVisibility(f.id);
  const st = deepStats(f.id);
  const parts = [st.folders ? plural(st.folders, 'Ordner', 'Ordner') : null, plural(st.files, 'Datei', 'Dateien'), st.size ? formatBytes(st.size) : null].filter(Boolean);
  return h('a', { class: `ablage-folder ablage-folder--${vis}`, href: `${BASE}/${f.id}` },
    h('span', { class: 'ablage-folder__icon', 'aria-hidden': 'true' }, '📁'),
    h('span', { class: 'ablage-folder__name' }, f.name),
    visibilityBadge(vis),
    h('span', { class: 'ablage-folder__meta' }, parts.join(' · ')),
    h('span', { class: 'ablage-folder__open', 'aria-hidden': 'true' }, 'Öffnen →'));
}

function fileMeta(f) {
  const k = typeKey(f);
  const bits = [TYPE_LABEL[k]];
  if (k !== 'protocol') bits.push(formatBytes(f.size || 0) + (f.originalSize && f.originalSize > (f.size || 0) ? ` (vorher ${formatBytes(f.originalSize)})` : ''));
  bits.push(formatDate((f.createdAt || '').slice(0, 10), 'short'));
  bits.push('hochgeladen von ' + userName(f.uploadedBy));
  return bits.join(' · ');
}

/** Eine Zeile der Dateiliste – alle Aktionen als beschriftete Knöpfe (keine versteckten Menüs) */
function fileRow(f, { showPath = false, highlight = false, compact = false } = {}) {
  const k = typeKey(f);
  const prot = k === 'protocol' && f.protocolId ? db.find('protocols', f.protocolId) : null;
  const thumb = previewUrl(f, 's');
  const vis = folderVisibility(f.folderId);
  const lead = thumb ? h('img', { class: 'ablage-file__thumb', src: thumb, alt: '', loading: 'lazy' }) : typeBadgeIcon(f);
  const actions = [];
  if (compact && k !== 'protocol') {
    actions.push(button({ label: 'Ansehen', icon: '👁', onClick: () => openPreview(f.id) }));
    actions.push(button({ label: 'Im Ordner zeigen', icon: '📁', href: `${BASE}/${f.folderId}?zeige=${f.id}` }));
  } else if (k === 'protocol') {
    if (can('protocols.view') && prot) actions.push(button({ label: 'Protokoll öffnen', icon: '📝', href: `#/admin/protokolle/${prot.id}` }));
  } else {
    actions.push(button({ label: 'Ansehen', icon: '👁', onClick: () => openPreview(f.id) }));
    if (P.edit()) actions.push(button({ label: 'Umbenennen', icon: '✎', onClick: () => renameDialog('file', f.id) }));
    if (P.edit()) actions.push(button({ label: 'Verschieben', icon: '↔', onClick: () => moveDialog('file', f.id) }));
    if (P.share() && vis === 'board') actions.push(button({ label: 'Für Mitglieder freigeben', icon: '👥', onClick: () => shareDialog(f.id) }));
    if (P.remove()) actions.push(button({ label: 'In den Papierkorb', icon: '🗑', variant: 'danger', onClick: () => deleteFile(f.id) }));
  }
  return h('li', { class: `ablage-file${highlight ? ' ablage-file--hl' : ''}`, id: `datei-${f.id}` },
    h('div', { class: 'ablage-file__lead' }, lead),
    h('div', { class: 'ablage-file__main' },
      k === 'protocol'
        ? h('span', { class: 'ablage-file__name' }, f.name)
        : h('button', { type: 'button', class: 'ablage-file__name ablage-file__name--btn', onclick: () => openPreview(f.id) }, f.name),
      h('span', { class: 'ablage-file__meta' }, fileMeta(f)),
      showPath ? h('span', { class: 'ablage-file__path' }, '📁 ', pathText(f.folderId), ' ', visibilityBadge(vis)) : null,
      prot ? h('span', { class: 'ablage-file__meta' }, prot.status === 'final' ? badge('abgeschlossen', 'ok', '✓') : badge('Entwurf – wird noch geschrieben', 'draft', '✎'),
        ' Wird im Bereich „Protokolle“ geschrieben und bearbeitet.') : null,
      f.note ? h('span', { class: 'ablage-file__note' }, '💬 ', f.note) : null),
    actions.length ? h('div', { class: 'ablage-file__actions' }, actions) : null);
}

const SORTS = [
  { id: 'neu', label: 'Neueste zuerst', fn: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) },
  { id: 'name', label: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }) },
  { id: 'gross', label: 'Größte zuerst', fn: (a, b) => (b.size || 0) - (a.size || 0) },
];
function sortChips(onChange) {
  const cur = prefsStore.get('ablage.sort', 'neu');
  return h('div', { class: 'chips ablage-sort', role: 'group', 'aria-label': 'Reihenfolge der Dateien' },
    h('span', { class: 'ablage-sort__label' }, 'Reihenfolge:'),
    SORTS.map(s => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.id === cur), onclick: () => { prefsStore.set('ablage.sort', s.id); onChange(); } }, s.label)));
}
const currentSort = () => (SORTS.find(s => s.id === prefsStore.get('ablage.sort', 'neu')) || SORTS[0]).fn;

/* ---------------------------------------------------------
   Speicherplatz
   --------------------------------------------------------- */
function storageBox() {
  const roots = visibleRoots();
  const areas = roots.map(r => ({ f: r, vis: folderVisibility(r.id), ...deepStats(r.id) }));
  const used = areas.reduce((s, a) => s + a.size, 0);
  const files = db.all('files').filter(fileVisible);
  const saved = files.reduce((s, f) => s + (f.originalSize && f.originalSize > f.size ? f.originalSize - f.size : 0), 0);
  const pct = used / QUOTA * 100;
  const pctText = pct < 0.1 ? 'weniger als 0,1 %' : pct.toFixed(1).replace('.', ',') + ' %';
  const max = Math.max(1, ...areas.map(a => a.size));
  const mediaSize = can('site.media.upload') || can('files.board') ? db.all('media').reduce((s, m) => s + (m.size || 0) + (m.thumbSize || 0), 0) : 0;
  return h('section', { class: 'dash-box ablage-storage', 'aria-labelledby': 'ablage-storage-h' },
    h('h2', { id: 'ablage-storage-h' }, '💾 Speicherplatz'),
    h('p', { class: 'ablage-storage__total' }, h('strong', {}, formatBytes(used)), ` von 5 GB belegt (${pctText}).`),
    h('div', { class: 'ablage-meter', role: 'img', 'aria-label': `${formatBytes(used)} von 5 GB belegt` },
      areas.map(a => h('span', { class: `ablage-meter__seg ablage-meter__seg--${a.vis}`, style: { width: Math.max(1.5, a.size / QUOTA * 100) + '%' } }))),
    h('ul', { class: 'ablage-areas' }, areas.map(a => h('li', { class: 'ablage-area' },
      h('span', { class: 'ablage-area__name' }, h('a', { href: `${BASE}/${a.f.id}` }, a.f.name), ' ', visibilityBadge(a.vis)),
      h('span', { class: 'ablage-area__bar', 'aria-hidden': 'true' }, h('span', { class: `ablage-area__fill ablage-area__fill--${a.vis}`, style: { width: Math.max(2, a.size / max * 100) + '%' } })),
      h('span', { class: 'ablage-area__size' }, `${formatBytes(a.size)} · ${plural(a.files, 'Datei', 'Dateien')}`)))),
    saved ? h('p', { class: 'ablage-storage__saved' }, h('span', { 'aria-hidden': 'true' }, '🌱 '), 'Durch automatisches Verkleinern von Fotos gespart: ', h('strong', {}, formatBytes(saved)), '.') : null,
    mediaSize ? h('p', { class: 'muted ablage-storage__note' }, `Zum Vergleich: Alle Fotos der Website zusammen brauchen ${formatBytes(mediaSize)}. Ein kleiner Server (ca. 5 € im Monat) reicht dafür viele Jahre.`) : null);
}

/* ---------------------------------------------------------
   Suche innerhalb der Ablage (respektiert Rechte)
   --------------------------------------------------------- */
function searchAblage(q, withinId = null) {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return { folders: [], files: [] };
  const scope = withinId ? new Set([withinId, ...descendants(withinId).map(f => f.id)]) : null;
  const inScope = id => !scope || scope.has(id);
  const folders = db.all('folders').filter(f => folderVisible(f) && inScope(f.id) && f.id !== withinId && f.name.toLowerCase().includes(term)).sort(byName);
  const files = db.all('files').filter(f => fileVisible(f) && inScope(f.folderId) && [f.name, f.note].some(v => String(v || '').toLowerCase().includes(term)))
    .sort(currentSort());
  return { folders, files };
}
function searchForm(folder, q) {
  const id = 'ablage-q';
  const input = h('input', { type: 'search', id, class: 'field__input', value: q || '', placeholder: 'z. B. Satzung, Kassenbericht, 2025 …', autocomplete: 'off' });
  const base = folder ? `${BASE}/${folder.id}` : BASE;
  return h('form', { class: 'dash-search ablage-search', role: 'search', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); navigate(v ? `${base}?suche=${encodeURIComponent(v)}` : base); } },
    h('label', { for: id, class: 'field__label' }, folder ? `In „${folder.name}“ suchen` : 'In der Ablage suchen'),
    h('div', { class: 'dash-search__row' }, input, button({ label: 'Suchen', icon: '🔎', type: 'submit' })),
    h('p', { class: 'field__hint' }, 'Gesucht wird nur in Ordnern, die Sie sehen dürfen.'));
}
function searchResults(folder, q) {
  const { folders, files } = searchAblage(q, folder ? folder.id : null);
  const back = folder ? `${BASE}/${folder.id}` : BASE;
  const total = folders.length + files.length;
  return h('section', { class: 'ablage-results', 'aria-live': 'polite' },
    h('div', { class: 'ablage-results__head' },
      h('h2', {}, total ? `${plural(total, 'Treffer', 'Treffer')} für „${q}“` : `Nichts gefunden für „${q}“`),
      button({ label: 'Suche beenden', icon: '✕', href: back })),
    folders.length ? h('div', { class: 'ablage-folders' }, folders.map(folderTile)) : null,
    files.length ? h('ul', { class: 'ablage-files' }, files.map(f => fileRow(f, { showPath: true }))) : null,
    !total ? emptyState({ icon: '🔎', title: 'Keine passende Datei', text: q.trim().length < 2 ? 'Bitte mindestens zwei Buchstaben eingeben.' : 'Versuchen Sie ein anderes Wort – oder nur einen Teil davon.' }) : null);
}

/** Hinweis für die Vorführung: wer die Ablage (nicht) sieht – live aus den Rollen berechnet */
function demoNote() {
  const users = activeUsers();
  const yes = users.filter(u => userCan(u, 'files.view'));
  const no = users.filter(u => !userCan(u, 'files.view'));
  if (!no.length) return null;
  return notice(h('p', {}, h('strong', {}, '🎭 Hinweis für die Vorführung: '),
    `Die Ablage sehen nur ${yes.map(u => `${u.firstName} (${roleOf(u)?.short || ''})`).join(' und ')}. `,
    `Für ${no.map(u => `${u.firstName} (${roleOf(u)?.short || ''})`).join(', ')} gibt es sie nicht – kein Menüpunkt, keine Treffer in der Suche, keine Fotos daraus in der Foto-Auswahl, und ein direkter Link zeigt „Kein Zugriff“. Wechseln Sie oben die Rolle, um es zu prüfen.`), 'demo');
}

/* ---------------------------------------------------------
   Seite: Ablage-Übersicht
   --------------------------------------------------------- */
function renderRoot(ctx) {
  const draw = () => {
    const q = ctx.query.suche || '';
    const roots = visibleRoots();
    const recent = db.all('files').filter(fileVisible).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);
    const trashCount = trashList().length;
    // Oberste Ebene: keine Brotkrumen; Ordner direkt unter der Überschrift, Suche und Hinweis darunter
    ctx.el.replaceChildren(h('div', { class: 'admin-page ablage' },
      pageHeader({ title: 'Ablage', intro: 'Dokumente wie in einem Aktenschrank. Das farbige Schild an jedem Ordner zeigt, wer ihn sehen darf.',
        actions: [
          P.upload() ? button({ label: 'Datei hochladen', icon: '⬆', variant: 'primary', size: 'lg', onClick: () => uploadDialog(null) }) : null,
          P.upload() ? button({ label: 'Neuer Ordner', icon: '📁', size: 'lg', onClick: () => newFolderDialog(null) }) : null].filter(Boolean) }),
      q ? searchForm(null, q) : null,
      q ? searchResults(null, q) : null,
      q ? null : h('section', { 'aria-labelledby': 'ablage-areas-h' },
        h('h2', { id: 'ablage-areas-h', class: 'sr-only' }, 'Bereiche'),
        roots.length ? h('div', { class: 'ablage-folders ablage-folders--roots' }, roots.map(folderTile))
          : emptyState({ icon: '🗄', title: 'Noch keine Ordner', text: 'Legen Sie mit „Neuer Ordner“ den ersten Ordner an.' })),
      q ? null : searchForm(null, q),
      q ? null : demoNote(),
      q || !recent.length ? null : h('section', { class: 'dash-box', 'aria-labelledby': 'ablage-recent-h' },
        h('h2', { id: 'ablage-recent-h' }, '🕘 Zuletzt abgelegt'),
        h('ul', { class: 'ablage-files' }, recent.map(f => fileRow(f, { showPath: true, compact: true })))),
      q ? null : storageBox(),
      h('div', { class: 'cluster ablage-foot' },
        button({ label: `Papierkorb der Ablage${trashCount ? ` (${trashCount})` : ''}`, icon: '🗑', href: `${BASE}/papierkorb` }),
        button({ label: 'Protokolle', icon: '📝', href: '#/admin/protokolle' }),
        button({ label: 'Mitgliederbereich der Website', icon: '👥', href: '#/mitglieder' }))));
  };
  return live(draw);
}

/* ---------------------------------------------------------
   Seite: ein Ordner
   --------------------------------------------------------- */
function renderFolder(ctx) {
  const id = ctx.params.folderId;
  let previewOpened = false;
  const draw = () => {
    const folder = db.find('folders', id);
    if (!folder || !folderAlive(id)) {
      ctx.el.replaceChildren(h('div', { class: 'admin-page ablage' }, crumbs(null),
        pageHeader({ title: 'Ordner nicht gefunden', back: { href: BASE, label: 'Zurück zur Ablage' } }),
        emptyState({ icon: '📂', title: folder ? 'Dieser Ordner liegt im Papierkorb' : 'Diesen Ordner gibt es nicht (mehr)',
          text: folder ? 'Im Papierkorb der Ablage können Sie ihn mit einem Tipp zurückholen.' : 'Vielleicht wurde er umbenannt oder verschoben.',
          action: button({ label: folder ? 'Zum Papierkorb der Ablage' : 'Zur Ablage', icon: '→', variant: 'primary', href: folder ? `${BASE}/papierkorb` : BASE }) })));
      return;
    }
    const vis = folderVisibility(id);
    if (!canSeeVisibility(vis)) {
      // „Nur Vorstand“ ohne files.board → wie jede andere gesperrte Seite: freundlich, nichts verraten
      log('access.denied', `#/admin/ablage/${id}`, 'fehlendes Recht: files.board');
      forbiddenPage({ el: ctx.el, permission: 'files.board' });
      return;
    }
    ctx.setTitle(`${folder.name} – Ablage`);
    const q = ctx.query.suche || '';
    const path = folderPath(id);
    const parent = path.length > 1 ? path[path.length - 2] : null;
    const subs = childrenOf(id);
    const files = filesIn(id).sort(currentSort());
    const isProtFolder = /protokoll/i.test(folder.name) && can('protocols.edit');
    const canNewFolder = P.upload() && path.length < MAX_DEPTH;
    const st = deepStats(id);
    const hl = ctx.query.datei || ctx.query.zeige;

    const dropzone = P.upload() ? h('div', { class: 'ablage-drop' },
      h('span', { class: 'ablage-drop__icon', 'aria-hidden': 'true' }, '⬆'),
      h('span', {}, h('strong', {}, 'Dateien einfach hierher ziehen'), ' – oder oben auf „Datei hochladen“ tippen. Fotos werden automatisch verkleinert.')) : null;
    if (dropzone) wireDrop(dropzone, folder.id);

    ctx.el.replaceChildren(h('div', { class: 'admin-page ablage' },
      crumbs(id),
      pageHeader({ title: h('span', { class: 'ablage-title' }, h('span', { 'aria-hidden': 'true' }, '📁 '), folder.name),
        back: parent && folderVisible(parent) ? { href: `${BASE}/${parent.id}`, label: `Zurück zu „${parent.name}“` } : { href: BASE, label: 'Zurück zur Ablage' },
        badge: visibilityBadge(vis),
        actions: [
          P.upload() ? button({ label: 'Datei hochladen', icon: '⬆', variant: 'primary', size: 'lg', onClick: () => uploadDialog(folder.id) }) : null,
          canNewFolder ? button({ label: 'Neuer Ordner', icon: '📁', size: 'lg', onClick: () => newFolderDialog(folder.id) }) : null,
          isProtFolder ? button({ label: 'Neues Protokoll schreiben', icon: '📝', size: 'lg', href: `#/admin/protokolle/neu?ordner=${folder.id}` }) : null].filter(Boolean) }),
      visibilityPanel(folder, { onChange: P.share() ? () => visibilityDialog(folder.id) : null }),
      searchForm(folder, q),
      q ? searchResults(folder, q) : null,
      q || !subs.length ? null : h('section', { 'aria-labelledby': 'ablage-sub-h' },
        h('h2', { id: 'ablage-sub-h' }, `Ordner in „${folder.name}“`),
        h('div', { class: 'ablage-folders' }, subs.map(folderTile))),
      q ? null : h('section', { 'aria-labelledby': 'ablage-files-h' },
        h('div', { class: 'ablage-files-head' },
          h('h2', { id: 'ablage-files-h' }, files.length ? `Dateien (${files.length})` : 'Dateien'),
          files.length > 1 ? sortChips(draw) : null),
        files.length ? h('ul', { class: 'ablage-files' }, files.map(f => fileRow(f, { highlight: f.id === hl })))
          : emptyState({ icon: '📂', title: subs.length ? 'Hier liegen nur Ordner' : 'Dieser Ordner ist noch leer',
            text: P.upload() ? 'Mit „Datei hochladen“ legen Sie das erste Dokument ab.' : '' }),
        dropzone),
      q ? null : h('section', { class: 'admin-card ablage-this', 'aria-labelledby': 'ablage-this-h' },
        h('h2', { id: 'ablage-this-h' }, 'Dieser Ordner'),
        h('p', { class: 'muted' }, [plural(st.folders, 'Unterordner', 'Unterordner'), plural(st.files, 'Datei', 'Dateien'), formatBytes(st.size)].join(' · '),
          ` · angelegt ${relativeTime(folder.createdAt)} von ${userName(folder.createdBy)}`),
        h('div', { class: 'cluster' },
          P.edit() ? button({ label: 'Ordner umbenennen', icon: '✎', onClick: () => renameDialog('folder', folder.id) }) : null,
          P.edit() && folder.parentId ? button({ label: 'Ordner verschieben', icon: '↔', onClick: () => moveDialog('folder', folder.id) }) : null,
          P.share() ? button({ label: 'Wer darf das sehen?', icon: '👁', onClick: () => visibilityDialog(folder.id) }) : null,
          P.remove() ? button({ label: 'Ordner in den Papierkorb', icon: '🗑', variant: 'danger', onClick: () => deleteFolder(folder.id) }) : null),
        !P.upload() && !P.remove() ? h('p', { class: 'muted' }, 'Sie dürfen hier nur lesen.') : null)));

    if (hl && !previewOpened) {
      previewOpened = true;
      const row = document.getElementById(`datei-${hl}`);
      if (row) requestAnimationFrame(() => row.scrollIntoView({ block: 'center' }));
      const f = db.find('files', hl);
      if (ctx.query.datei && f && fileVisible(f) && typeKey(f) !== 'protocol') setTimeout(() => openPreview(hl), 50);
    }
  };
  return live(draw);
}

/** Neu zeichnen, wenn sich Ordner/Dateien ändern (auch durch andere Module) */
function live(draw) {
  draw();
  let t = null;
  const off = db.subscribe(evt => {
    if (!['files', 'folders', 'protocols', 'users', 'roles'].includes(evt.coll) && evt.type !== 'reset') return;
    clearTimeout(t); t = setTimeout(draw, 30);
  });
  return () => { off(); clearTimeout(t); };
}

/* ---------------------------------------------------------
   Seite: Papierkorb der Ablage
   --------------------------------------------------------- */
function trashList() {
  return [
    ...db.all('folders', { withDeleted: true }).filter(f => f.deletedAt).map(item => ({ coll: 'folders', item })),
    ...db.all('files', { withDeleted: true }).filter(f => f.deletedAt).map(item => ({ coll: 'files', item })),
  ].filter(({ coll, item }) => canSeeVisibility(folderVisibility(coll === 'folders' ? item.id : item.folderId)))
    .sort((a, b) => String(b.item.deletedAt).localeCompare(String(a.item.deletedAt)));
}
function daysLeft(deletedAt) {
  const d = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000);
  return Math.max(0, TRASH_DAYS - d);
}
function restoreEntry(coll, id) {
  if (!P.remove() && !P.upload()) return allowed('remove', 'Ablage-Papierkorb');
  const item = db.find(coll, id); if (!item) return;
  // liegt der Ordner darüber auch im Papierkorb, kommt er mit zurück
  const restoredParents = folderPath(coll === 'folders' ? item.parentId : item.folderId).filter(f => f.deletedAt);
  for (const f of restoredParents) db.restore('folders', f.id);
  db.restore(coll, id);
  const label = coll === 'folders' ? `Ordner „${item.name}“` : `Datei „${item.name}“`;
  log('trash.restore', label, restoredParents.length ? `mit Ordner ${restoredParents.map(f => '„' + f.name + '“').join(', ')}` : 'Ablage');
  toast(`${label} ist wieder da – in ${pathText(coll === 'folders' ? (item.parentId || item.id) : item.folderId)}.`);
}
async function purgeEntry(coll, id) {
  if (!allowed('purge', 'Ablage-Papierkorb')) return;
  const item = db.find(coll, id); if (!item) return;
  const label = coll === 'folders' ? `Ordner „${item.name}“` : `Datei „${item.name}“`;
  const ok = await confirmDialog({ title: 'Endgültig löschen?', text: `${label} wird für immer gelöscht${coll === 'folders' ? ' – mit allem, was darin liegt' : ''}. Das lässt sich nicht rückgängig machen.`, confirmLabel: 'Ja, endgültig löschen' });
  if (!ok) return;
  if (coll === 'folders') {
    const ids = [id, ...descendants(id).map(f => f.id)];
    for (const f of db.all('files', { withDeleted: true }).filter(x => ids.includes(x.folderId))) { db.purge('files', f.id); BLOBS.delete(f.id); }
    for (const fid of ids.slice(1)) db.purge('folders', fid);
  } else BLOBS.delete(id);
  db.purge(coll, id);
  log('trash.purge', label, 'Ablage');
  toast('Endgültig gelöscht.', { type: 'info' });
}
function renderTrash(ctx) {
  const draw = () => {
    const list = trashList();
    ctx.el.replaceChildren(h('div', { class: 'admin-page ablage' },
      crumbs(null),
      pageHeader({ title: 'Papierkorb der Ablage', back: { href: BASE, label: 'Zurück zur Ablage' },
        intro: `Gelöschte Dateien und Ordner bleiben hier ${TRASH_DAYS} Tage liegen. Mit „Wiederherstellen“ sind sie wieder genau dort, wo sie vorher waren.` }),
      list.length ? h('ul', { class: 'ablage-files' }, list.map(({ coll, item }) => {
        const isFolder = coll === 'folders';
        const left = daysLeft(item.deletedAt);
        return h('li', { class: 'ablage-file ablage-file--trash' },
          h('div', { class: 'ablage-file__lead' }, isFolder ? h('span', { class: 'ablage-type ablage-type--folder', 'aria-hidden': 'true' }, '📁') : typeBadgeIcon(item)),
          h('div', { class: 'ablage-file__main' },
            h('span', { class: 'ablage-file__name' }, item.name),
            h('span', { class: 'ablage-file__meta' }, `${isFolder ? 'Ordner' : TYPE_LABEL[typeKey(item)]} · war in: ${pathText(isFolder ? item.parentId : item.folderId) || 'Ablage'}`),
            h('span', { class: 'ablage-file__meta' }, `Gelöscht ${relativeTime(item.deletedAt)}${item.deletedBy ? ' von ' + userName(item.deletedBy) : ''} · `,
              h('strong', {}, left ? `wird in ${plural(left, 'Tag', 'Tagen')} automatisch entfernt` : 'wird heute automatisch entfernt'))),
          h('div', { class: 'ablage-file__actions' },
            button({ label: 'Wiederherstellen', icon: '↶', variant: 'primary', onClick: () => restoreEntry(coll, item.id) }),
            P.purge() ? button({ label: 'Endgültig löschen', icon: '✕', variant: 'danger', onClick: () => purgeEntry(coll, item.id) }) : null));
      })) : emptyState({ icon: '🗑', title: 'Der Papierkorb der Ablage ist leer', text: 'Wenn Sie eine Datei löschen, landet sie zuerst hier.' }),
      list.length && !P.purge() ? h('p', { class: 'muted' }, 'Endgültig löschen darf nur der Administrator. Nach 30 Tagen wird automatisch aufgeräumt.') : null,
      h('p', {}, button({ label: 'Gesamter Papierkorb (alle Bereiche)', icon: '🗑', href: '#/admin/papierkorb' }))));
  };
  return live(draw);
}

/* ---------------------------------------------------------
   Aktionen
   --------------------------------------------------------- */
function deleteFile(id) {
  const f = db.find('files', id);
  if (!f || !allowed('remove', `Datei „${f && f.name}“`)) return;
  trashItem('files', id, `Datei „${f.name}“`);
}
function deleteFolder(id) {
  const f = db.find('folders', id);
  if (!f || !allowed('remove', `Ordner „${f && f.name}“`)) return;
  const st = deepStats(id);
  const parentId = f.parentId;
  trashItem('folders', id, `Ordner „${f.name}“${st.files ? ` (mit ${plural(st.files, 'Datei', 'Dateien')})` : ''}`);
  navigate(parentId ? `${BASE}/${parentId}` : BASE);
}

/** Datei herunterladen: hochgeladene Datei aus dieser Sitzung, sonst ein Beispiel-PDF / Beispielbild */
async function downloadEntry(f) {
  if (!fileVisible(f)) return;
  const k = typeKey(f);
  let blob = BLOBS.get(f.id) || null;
  if (!blob && f.dataUrl) { try { blob = await (await fetch(f.dataUrl)).blob(); } catch { blob = null; } }
  if (!blob && seedPreview(f)) { try { blob = await (await fetch(seedPreview(f))).blob(); } catch { blob = null; } }
  let name = f.name;
  if (!blob && k === 'pdf') {
    blob = makePdf(f.name.replace(/\.pdf$/i, ''), [
      `Ordner: ${pathText(f.folderId)}`, `Hochgeladen von ${userName(f.uploadedBy)} am ${formatDate((f.createdAt || '').slice(0, 10), 'medium')}`,
      `Sichtbar für: ${VISIBILITY[folderVisibility(f.folderId)].long}`, '', 'Im echten System liegt hier das Original-Dokument.',
      'Der Server prüft vor jedem Herunterladen, ob Sie es sehen dürfen.']);
  }
  if (!blob) {
    toast(`„${f.name}“ ist eine Beispieldatei ohne Inhalt. Im echten System wird hier das Original heruntergeladen.`, { type: 'info', icon: 'ℹ' });
    log('file.download', `Datei „${f.name}“`, `${pathText(f.folderId)} (Beispiel ohne Inhalt)`);
    return;
  }
  if (seedPreview(f) && !BLOBS.get(f.id) && !f.dataUrl) name = f.name.replace(/\.[^.]+$/, '') + '.svg';
  downloadFile(name, blob);
  log('file.download', `Datei „${f.name}“`, pathText(f.folderId));
}

/** Vorschau einer Datei (Bild groß, PDF/Word/Excel als Platzhalter-Seite) */
function openPreview(id) {
  const f = db.find('files', id);
  if (!f || !fileVisible(f)) { toast('Diese Datei gibt es nicht mehr – oder Sie dürfen sie nicht sehen.', { type: 'error' }); return; }
  const k = typeKey(f);
  const vis = folderVisibility(f.folderId);
  const big = previewUrl(f, 'l');
  let stage;
  if (k === 'image' && big) stage = h('figure', { class: 'ablage-preview__img' }, h('img', { src: big, alt: `Vorschau: ${f.name}` }));
  else stage = paperPreview(f);
  const rows = [
    ['Art', TYPE_LABEL[k]],
    ['Größe', formatBytes(f.size || 0)],
    f.originalSize && f.originalSize > f.size ? ['Verkleinert', compressResult({ before: f.originalSize, after: f.size, savedPercent: Math.round((1 - f.size / f.originalSize) * 100) })] : null,
    f.width ? ['Bildgröße', `${f.width} × ${f.height} Pixel`] : null,
    ['Ordner', pathText(f.folderId)],
    ['Sichtbar für', h('span', { class: 'ablage-preview__vis' }, visibilityBadge(vis), ' ', VISIBILITY[vis].long)],
    ['Hochgeladen', `${formatDateTime(f.createdAt)} von ${userName(f.uploadedBy)}`],
    f.updatedAt && f.updatedAt !== f.createdAt ? ['Zuletzt geändert', formatDateTime(f.updatedAt)] : null,
    f.note ? ['Notiz', f.note] : null,
  ].filter(Boolean);
  const actions = [];
  if (P.remove()) actions.push({ label: 'In den Papierkorb', icon: '🗑', variant: 'danger', onClick: (c) => { c(); deleteFile(f.id); } });
  if (P.edit()) actions.push({ label: 'Verschieben', icon: '↔', onClick: (c) => { c(); moveDialog('file', f.id); } });
  if (P.edit()) actions.push({ label: 'Umbenennen', icon: '✎', onClick: (c) => { c(); renameDialog('file', f.id); } });
  if (P.share() && vis === 'board') actions.push({ label: 'Für Mitglieder freigeben', icon: '👥', onClick: (c) => { c(); shareDialog(f.id); } });
  actions.push({ label: 'Herunterladen', icon: '⤓', variant: 'primary', onClick: () => downloadEntry(f) });
  modal({
    title: f.name, wide: true,
    body: h('div', { class: 'ablage-preview' },
      h('div', { class: 'ablage-preview__stage' }, stage),
      h('dl', { class: 'ablage-preview__facts' }, rows.map(([dt, dd]) => [h('dt', {}, dt), h('dd', {}, dd)]))),
    actions,
  });
}
function paperPreview(f) {
  const k = typeKey(f);
  const title = f.name.replace(/\.[^.]+$/, '');
  const lines = (n, cls = '') => Array.from({ length: n }, (_, i) => h('span', { class: `ablage-paper__line ${cls}`, style: { width: `${62 + ((i * 37) % 36)}%` } }));
  let content;
  if (k === 'sheet') {
    content = h('div', { class: 'ablage-paper__sheet', 'aria-hidden': 'true' },
      Array.from({ length: 8 }, (_, r) => h('div', { class: 'ablage-paper__tr' }, Array.from({ length: 4 }, (_, c) => h('span', { class: r === 0 ? 'th' : '' }, r === 0 ? ['Datum', 'Posten', 'Ein', 'Aus'][c] : c === 0 ? `${String(r * 3).padStart(2, '0')}.10.` : c === 1 ? '▬▬▬▬' : c === 2 && r % 2 ? `${r * 40},00` : c === 3 && !(r % 2) ? `${r * 12},50` : '')))));
  } else content = h('div', { 'aria-hidden': 'true' }, lines(4), h('span', { class: 'ablage-paper__h' }), lines(5), h('span', { class: 'ablage-paper__h' }), lines(3));
  return h('div', { class: `ablage-paper ablage-paper--${k}` },
    h('div', { class: 'ablage-paper__page' },
      h('div', { class: 'ablage-paper__top' }, h('img', { src: 'img/kolping-logo.svg', alt: '', width: 40 }), h('span', {}, 'Kolpingsfamilie Ramsen')),
      h('p', { class: 'ablage-paper__title' }, title),
      content),
    h('p', { class: 'ablage-paper__note' }, k === 'pdf' ? '📄 Vorschau der ersten Seite. Im echten System sehen Sie hier das PDF und können darin blättern.'
      : '📄 Im echten System sehen Sie hier eine Vorschau des Dokuments.'));
}

/* ---------- Wer-darf-das-sehen-Auswahl (Pflichtwahl) ---------- */
/**
 * Große Auswahlkarten (Radio-Knöpfe) für die Sichtbarkeit.
 * parentId: bei Unterordnern gibt es zusätzlich „Wie der übergeordnete Ordner“.
 * value: vorausgewählter Wert (oder null = Pflichtwahl ohne Vorauswahl)
 */
function visChoice({ parentId = null, value = null, reference = null }) {
  const name = uid('vis');
  const parentVis = parentId ? folderVisibility(parentId) : null;
  const parent = parentId ? db.find('folders', parentId) : null;
  const ref = reference ?? parentVis ?? 'board';
  const opts = [];
  if (parent) opts.push({ value: 'inherit', vis: parentVis, title: `Wie der Ordner „${parent.name}“`, text: VISIBILITY[parentVis].long });
  for (const v of ['board', 'members', 'public']) opts.push({ value: v, vis: v, title: VISIBILITY[v].label, text: VISIBILITY[v].long });
  const err = h('div', { class: 'field__error', hidden: true, id: name + '-e' });
  const group = h('fieldset', { class: 'ablage-choices', 'aria-describedby': name + '-e' },
    h('legend', { class: 'field__label' }, 'Wer darf das sehen? ', h('span', { class: 'ablage-req' }, '(bitte auswählen)')),
    opts.map(o => {
      const opener = RANK[o.vis] < RANK[ref];
      const disabled = (o.vis === 'board' && !can('files.board')) || (opener && !P.share());
      const input = h('input', { type: 'radio', name, value: o.value, disabled: disabled || null });
      if (value && value === o.value) input.checked = true;
      input.addEventListener('change', () => { err.hidden = true; group.classList.remove('ablage-choices--invalid'); });
      return h('label', { class: `ablage-choice ablage-choice--${o.vis}${disabled ? ' ablage-choice--off' : ''}` },
        input,
        h('span', { class: 'ablage-choice__body' },
          h('span', { class: 'ablage-choice__title' }, h('span', { 'aria-hidden': 'true' }, VISIBILITY[o.vis].icon + ' '), o.title),
          h('span', { class: 'ablage-choice__text' }, o.text),
          h('span', { class: 'ablage-choice__who' }, whoSeesLine(o.vis)),
          opener && !disabled ? h('span', { class: 'ablage-choice__warn' }, '⚠ Damit sehen mehr Menschen die Dateien als bisher.') : null,
          disabled ? h('span', { class: 'ablage-choice__warn' }, '🔒 Diese Freigabe darf nur der Vorstand einstellen.') : null));
    }),
    err);
  return {
    el: group,
    value() { const c = group.querySelector('input:checked'); return c ? c.value : null; },
    resolved() { const v = this.value(); return v === 'inherit' ? null : v; },     // null = erben
    effective() { const v = this.value(); return v === 'inherit' ? parentVis : v; },
    setError(msg) { err.hidden = false; err.textContent = msg; group.classList.add('ablage-choices--invalid'); const first = group.querySelector('input:not([disabled])'); first && first.focus(); },
  };
}

function nameTaken(name, { parentId, folderId, exceptId }) {
  const n = name.trim().toLowerCase();
  if (folderId !== undefined) return db.all('files').some(f => f.folderId === folderId && f.id !== exceptId && f.name.trim().toLowerCase() === n);
  return db.all('folders').some(f => (f.parentId || null) === (parentId || null) && f.id !== exceptId && f.name.trim().toLowerCase() === n);
}
function validName(fld, name) {
  if (!name) { fld.setError('Bitte geben Sie einen Namen ein, z. B. „Protokolle 2027“.'); return false; }
  if (/[\\/:*?"<>|]/.test(name)) { fld.setError('Bitte ohne diese Zeichen: \\ / : * ? " < > |'); return false; }
  if (name.length > 120) { fld.setError('Der Name ist sehr lang – bitte kürzer (höchstens 120 Zeichen).'); return false; }
  return true;
}

function newFolderDialog(parentId) {
  if (!allowed('upload', 'Neuer Ordner')) return;
  const parent = parentId ? db.find('folders', parentId) : null;
  if (parent && folderPath(parentId).length >= MAX_DEPTH) { toast('Mehr als drei Ebenen machen es unübersichtlich. Bitte legen Sie den Ordner eine Ebene höher an.', { type: 'info' }); return; }
  const fName = field({ label: 'Name des Ordners', hint: parent ? `Wird angelegt in: ${pathText(parentId)}` : 'Wird als neuer Bereich ganz oben in der Ablage angelegt.', placeholder: 'z. B. Protokolle 2027', required: true });
  const choice = visChoice({ parentId });
  modal({
    title: parent ? `Neuer Ordner in „${parent.name}“` : 'Neuer Bereich in der Ablage',
    body: h('div', { class: 'stack' }, fName.el, choice.el),
    actions: [{ label: 'Abbrechen' }, { label: 'Ordner anlegen', icon: '📁', variant: 'primary', onClick: (close) => {
      const name = fName.value();
      let ok = validName(fName, name);
      if (ok && nameTaken(name, { parentId })) { fName.setError(`Einen Ordner „${name}“ gibt es hier schon. Bitte einen anderen Namen wählen.`); ok = false; }
      if (!choice.value()) { choice.setError('Bitte wählen Sie aus, wer den Ordner sehen darf.'); ok = false; }
      if (!ok) return;
      const vis = choice.resolved();
      const eff = choice.effective();
      if (RANK[eff] < RANK[parent ? folderVisibility(parentId) : 'board'] && !allowed('share', `Ordner „${name}“ freigeben`)) return;
      const u = currentUser();
      const f = db.insert('folders', { id: uid('f'), name, parentId: parentId || null, ...(vis || !parent ? { visibility: vis || eff, icon: VISIBILITY[vis || eff].icon } : {}), createdBy: u ? u.id : null });
      log('folder.create', `Ordner „${name}“`, `${parent ? pathText(parentId) + ' · ' : ''}Sichtbar für: ${VISIBILITY[eff].label}`);
      close();
      toast(`Ordner „${name}“ ist angelegt. Schild: ${VISIBILITY[eff].icon} ${VISIBILITY[eff].label}.`, {
        undo: () => { db.remove('folders', f.id, { by: u ? u.id : null }); log('folder.delete', `Ordner „${name}“`, 'Anlegen rückgängig gemacht'); } });
      navigate(`${BASE}/${f.id}`);
    } }],
  });
}

function visibilityDialog(folderId) {
  if (!allowed('share', 'Sichtbarkeit ändern')) return;
  const f = db.find('folders', folderId); if (!f) return;
  const before = folderVisibility(folderId);
  const choice = visChoice({ parentId: f.parentId, value: f.parentId ? (f.visibility || 'inherit') : f.visibility, reference: before });
  const st = deepStats(folderId);
  modal({
    title: `Wer darf „${f.name}“ sehen?`,
    body: h('div', { class: 'stack' },
      h('p', {}, `Das gilt für den ganzen Ordner – ${plural(st.files, 'Datei', 'Dateien')}${st.folders ? ' und ' + plural(st.folders, 'Unterordner', 'Unterordner') : ''}.`),
      choice.el),
    actions: [{ label: 'Abbrechen' }, { label: 'So einstellen', icon: '✓', variant: 'primary', onClick: (close) => {
      if (!choice.value()) { choice.setError('Bitte wählen Sie aus, wer den Ordner sehen darf.'); return; }
      const after = choice.effective();
      const own = choice.resolved();
      close();
      if (after === before && (own || null) === (f.visibility || null)) { toast('Nichts geändert.', { type: 'info' }); return; }
      const prev = { visibility: f.visibility ?? null, icon: f.icon ?? null };
      db.update('folders', folderId, own ? { visibility: own, icon: VISIBILITY[own].icon } : { visibility: null, icon: null });
      const gained = activeUsers().filter(u => userSeesVis(u, after) && !userSeesVis(u, before));
      log('folder.share', `Ordner „${f.name}“`, `${VISIBILITY[before].label} → ${VISIBILITY[after].label}`);
      toast(`„${f.name}“ sehen jetzt: ${VISIBILITY[after].long}.${gained.length && after !== 'public' ? ' Neu dabei: ' + gained.map(u => u.firstName).join(', ') + '.' : ''}`, {
        undo: () => { db.update('folders', folderId, prev); log('folder.share', `Ordner „${f.name}“`, `rückgängig: ${VISIBILITY[after].label} → ${VISIBILITY[before].label}`); } });
    } }],
  });
}

function renameDialog(kind, id) {
  if (!allowed('edit', 'Umbenennen')) return;
  const isFile = kind === 'file';
  const item = db.find(isFile ? 'files' : 'folders', id); if (!item) return;
  const ext = isFile && typeKey(item) !== 'protocol' ? extOf(item.name) : '';
  const baseName = ext ? item.name.slice(0, -(ext.length + 1)) : item.name;
  const fName = field({ label: isFile ? 'Neuer Dateiname' : 'Neuer Name des Ordners', value: baseName, required: true,
    hint: ext ? `Die Endung „.${ext}“ bleibt automatisch erhalten.` : 'Kurz und eindeutig, z. B. mit Jahreszahl.' });
  const wrap = ext ? h('div', { class: 'ablage-rename' }, fName.el, h('span', { class: 'ablage-rename__ext', 'aria-hidden': 'true' }, '.' + ext)) : fName.el;
  modal({
    title: isFile ? 'Datei umbenennen' : 'Ordner umbenennen',
    body: wrap,
    actions: [{ label: 'Abbrechen' }, { label: 'Umbenennen', icon: '✎', variant: 'primary', onClick: (close) => {
      const raw = fName.value();
      if (!validName(fName, raw)) return;
      const name = ext && !raw.toLowerCase().endsWith('.' + ext) ? `${raw}.${ext}` : raw;
      if (name === item.name) { close(); return; }
      if (isFile ? nameTaken(name, { folderId: item.folderId, exceptId: id }) : nameTaken(name, { parentId: item.parentId, exceptId: id })) {
        fName.setError(`„${name}“ gibt es in diesem Ordner schon.`); return;
      }
      const old = item.name;
      db.update(isFile ? 'files' : 'folders', id, { name });
      log(isFile ? 'file.rename' : 'folder.rename', `${isFile ? 'Datei' : 'Ordner'} „${name}“`, `vorher „${old}“`);
      close();
      toast(`Umbenannt in „${name}“.`, { undo: () => { db.update(isFile ? 'files' : 'folders', id, { name: old }); log(isFile ? 'file.rename' : 'folder.rename', `${isFile ? 'Datei' : 'Ordner'} „${old}“`, 'Umbenennen rückgängig gemacht'); } });
    } }],
  });
}

/** Ordner-Auswahl als große Radio-Liste (mit Einrückung und Schild) */
function folderPicker({ exclude = new Set(), filter = () => true, current = null, label = 'Wohin?' }) {
  const name = uid('dest');
  const err = h('div', { class: 'field__error', hidden: true });
  const rows = [];
  const walk = (pid, depth) => {
    for (const f of (pid ? childrenOf(pid) : visibleRoots())) {
      if (exclude.has(f.id)) continue;
      if (filter(f)) rows.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  const group = h('fieldset', { class: 'ablage-choices ablage-dest' },
    h('legend', { class: 'field__label' }, label),
    rows.length ? rows.map(({ f, depth }) => {
      const input = h('input', { type: 'radio', name, value: f.id, disabled: f.id === current || null });
      input.addEventListener('change', () => { err.hidden = true; });
      return h('label', { class: `ablage-choice ablage-choice--row${f.id === current ? ' ablage-choice--off' : ''}`, style: { '--depth': depth } },
        input,
        h('span', { class: 'ablage-choice__body' },
          h('span', { class: 'ablage-choice__title' }, '📁 ', f.name, f.id === current ? h('small', {}, ' (liegt schon hier)') : null),
          h('span', { class: 'ablage-choice__text' }, pathText(f.id)),
          visibilityBadge(folderVisibility(f.id))));
    }) : h('p', { class: 'muted' }, 'Es gibt keinen passenden Ordner.'),
    err);
  return {
    el: group,
    value: () => { const c = group.querySelector('input:checked'); return c ? c.value : null; },
    setError(msg) { err.hidden = false; err.textContent = msg; },
  };
}

function moveDialog(kind, id) {
  if (!allowed('edit', 'Verschieben')) return;
  const isFile = kind === 'file';
  const item = db.find(isFile ? 'files' : 'folders', id); if (!item) return;
  const fromId = isFile ? item.folderId : item.parentId;
  const before = folderVisibility(isFile ? item.folderId : item.id);
  const exclude = isFile ? new Set() : new Set([item.id, ...descendants(item.id).map(f => f.id)]);
  const depthOf = (fid) => folderPath(fid).length;
  const subDepth = isFile ? 0 : 1 + Math.max(0, ...descendants(item.id).map(d => depthOf(d.id) - depthOf(item.id)));
  const picker = folderPicker({ exclude, current: fromId, label: isFile ? 'In welchen Ordner soll die Datei?' : 'In welchen Ordner soll der Ordner?',
    filter: f => isFile || depthOf(f.id) + subDepth <= MAX_DEPTH });
  const warn = h('div', { class: 'ablage-move-warn', 'aria-live': 'polite' });
  picker.el.addEventListener('change', () => {
    const dest = picker.value(); if (!dest) return;
    const after = item.visibility && !isFile ? item.visibility : folderVisibility(dest);
    warn.replaceChildren(after !== before ? notice(h('p', {}, h('strong', {}, 'Achtung: '), `Danach sehen das: ${VISIBILITY[after].long} (bisher: ${VISIBILITY[before].label}).`), RANK[after] < RANK[before] ? 'warn' : 'info', '⚠') : '');
  });
  modal({
    title: `„${item.name}“ verschieben`,
    body: h('div', { class: 'stack' }, h('p', {}, `Liegt jetzt in: ${pathText(fromId)}`), picker.el, warn),
    actions: [{ label: 'Abbrechen' }, { label: 'Hierhin verschieben', icon: '↔', variant: 'primary', onClick: (close) => {
      const dest = picker.value();
      if (!dest) { picker.setError('Bitte tippen Sie auf den Ordner, in den es soll.'); return; }
      const after = item.visibility && !isFile ? item.visibility : folderVisibility(dest);
      if (RANK[after] < RANK[before] && !allowed('share', `„${item.name}“ für mehr Personen sichtbar machen`)) return;
      if (isFile ? nameTaken(item.name, { folderId: dest, exceptId: id }) : nameTaken(item.name, { parentId: dest, exceptId: id })) {
        picker.setError(`Im Ziel gibt es schon „${item.name}“. Bitte vorher umbenennen.`); return;
      }
      db.update(isFile ? 'files' : 'folders', id, isFile ? { folderId: dest } : { parentId: dest });
      log(isFile ? 'file.move' : 'folder.move', `${isFile ? 'Datei' : 'Ordner'} „${item.name}“`, `${pathText(fromId)} → ${pathText(dest)}${after !== before ? ` · jetzt ${VISIBILITY[after].label}` : ''}`);
      close();
      toast(`„${item.name}“ liegt jetzt in ${db.find('folders', dest).name}.`, {
        undo: () => { db.update(isFile ? 'files' : 'folders', id, isFile ? { folderId: fromId } : { parentId: fromId }); log(isFile ? 'file.move' : 'folder.move', `${isFile ? 'Datei' : 'Ordner'} „${item.name}“`, 'Verschieben rückgängig gemacht'); } });
    } }],
  });
}

/** „Für alle Mitglieder sichtbar machen“: Datei (oder Kopie) kommt in einen Mitglieder-Ordner */
function shareDialog(fileId) {
  if (!allowed('share', 'Für Mitglieder freigeben')) return;
  const f = db.find('files', fileId); if (!f) return;
  const picker = folderPicker({ filter: x => folderVisibility(x.id) === 'members', label: 'In welchen Mitglieder-Ordner?' });
  const keep = h('input', { type: 'checkbox', checked: true });
  modal({
    title: 'Für alle Mitglieder sichtbar machen',
    body: h('div', { class: 'stack' },
      notice(h('p', {}, 'Dateien haben keine eigenen Rechte – sie bekommen das Schild ihres Ordners. Deshalb kommt die Datei in einen Ordner mit dem Schild ', visibilityBadge('members'), '.'), 'info', 'ℹ'),
      h('p', {}, h('strong', {}, f.name), h('br'), h('span', { class: 'muted' }, `liegt jetzt in ${pathText(f.folderId)} (${VISIBILITY.board.label})`)),
      picker.el,
      h('label', { class: 'check' }, keep, h('span', {}, 'Original im Vorstands-Ordner behalten (Kopie freigeben)'))),
    actions: [{ label: 'Abbrechen' }, { label: 'Freigeben', icon: '👥', variant: 'primary', onClick: (close) => {
      const dest = picker.value();
      if (!dest) { picker.setError('Bitte wählen Sie einen Mitglieder-Ordner.'); return; }
      if (nameTaken(f.name, { folderId: dest, exceptId: keep.checked ? null : fileId })) { picker.setError(`Dort gibt es schon „${f.name}“.`); return; }
      const destName = db.find('folders', dest).name;
      let undo;
      if (keep.checked) {
        const { id, createdAt, updatedAt, deletedAt, deletedBy, ...rest } = f;
        const copy = db.insert('files', { ...rest, id: uid('d'), folderId: dest, note: `Freigegeben aus „${pathText(f.folderId)}“` });
        if (BLOBS.has(fileId)) BLOBS.set(copy.id, BLOBS.get(fileId));
        undo = () => { db.remove('files', copy.id, { by: currentUser()?.id }); log('file.delete', `Datei „${f.name}“`, 'Freigabe rückgängig gemacht'); };
      } else {
        const from = f.folderId;
        db.update('files', fileId, { folderId: dest });
        undo = () => { db.update('files', fileId, { folderId: from }); log('file.move', `Datei „${f.name}“`, 'Freigabe rückgängig gemacht'); };
      }
      log('file.share', `Datei „${f.name}“`, `${keep.checked ? 'Kopie' : 'verschoben'} nach ${pathText(dest)} · jetzt ${VISIBILITY.members.label}`);
      close();
      toast(`„${f.name}“ ist jetzt für alle Mitglieder sichtbar (Ordner „${destName}“, auch im Mitgliederbereich der Website).`, { undo });
    } }],
  });
}

/* ---------------------------------------------------------
   Hochladen (Fotos werden verkleinert, andere Dateien bleiben unverändert)
   --------------------------------------------------------- */
const MAX_FILE = 25 * 1024 * 1024;
const PERSIST_LIMIT = 320 * 1024;    // größere Inhalte nur im Speicher dieser Sitzung (localStorage ist klein)

function isCompressible(file) {
  return /^image\/(jpeg|png|webp|heic|heif|bmp|avif)$/i.test(file.type || '') || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'bmp', 'avif'].includes(extOf(file.name));
}
function uniqueName(name, folderId) {
  if (!nameTaken(name, { folderId })) return name;
  const ext = extOf(name); const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  for (let i = 2; i < 100; i++) { const n = `${base} (${i})${ext ? '.' + ext : ''}`; if (!nameTaken(n, { folderId })) return n; }
  return `${base} (${Date.now()})${ext ? '.' + ext : ''}`;
}

/** Eine Datei verarbeiten und ablegen → {file, result|null, error|null} */
async function storeUpload(file, folderId) {
  if (!P.upload()) throw new Error('Keine Berechtigung zum Ablegen.');
  if (file.size > MAX_FILE) throw new Error(`Die Datei ist größer als ${formatBytes(MAX_FILE)}. Bitte verkleinern oder aufteilen.`);
  const u = currentUser();
  const id = uid('d');
  let rec, result = null, blob = file, compressFail = null;
  if (isCompressible(file)) {
    try {
      const big = await compressImage(file, { maxSize: 1600, quality: 0.75 });
      const small = await compressImage(file, { maxSize: 420, quality: 0.7 });
      result = big; blob = big.blob;
      rec = { type: 'image', size: big.after, originalSize: big.before, width: big.width, height: big.height,
        thumbUrl: small.dataUrl, dataUrl: big.after <= PERSIST_LIMIT ? big.dataUrl : undefined, name: uniqueName(big.name, folderId),
        note: `Automatisch verkleinert: ${big.originalWidth} × ${big.originalHeight} → ${big.width} × ${big.height} Pixel` };
    } catch (e) {
      compressFail = 'Dieses Bildformat kann der Browser nicht verkleinern – es wurde unverändert abgelegt.';
    }
  }
  if (!rec) {
    const ext = extOf(file.name);
    rec = { type: IMAGE_EXT.includes(ext) ? 'image' : (ext || 'datei'), size: file.size, originalSize: null, name: uniqueName(file.name, folderId), note: compressFail || '' };
  }
  const saved = db.insert('files', { id, folderId, protocolId: null, uploadedBy: u ? u.id : null, ...rec });
  BLOBS.set(id, blob);
  log('file.upload', `Datei „${saved.name}“`, `${pathText(folderId)} · ${result ? `${formatBytes(result.before)} → ${formatBytes(result.after)} (−${result.savedPercent} %)` : formatBytes(file.size) + ' unverändert'}`);
  return { file: saved, result, warning: compressFail };
}

/** Dialog „Datei hochladen“ (folderId null → erst Ordner wählen). files: optional schon gewählte Dateien (Ziehen & Ablegen) */
function uploadDialog(folderId, preset = null) {
  if (!allowed('upload', 'Datei hochladen')) return;
  let target = folderId;
  const body = h('div', { class: 'stack ablage-upload' });
  const list = h('ul', { class: 'ablage-up-list', 'aria-live': 'polite' });
  const summary = h('div', { class: 'ablage-up-summary', role: 'status', 'aria-live': 'polite' });
  const input = h('input', { type: 'file', multiple: true, hidden: true });
  let done = 0, before = 0, after = 0;
  let m;

  const process = async (files) => {
    if (!target) return;
    for (const file of files) {
      const row = h('li', { class: 'ablage-up' },
        h('span', { class: 'ablage-up__icon', 'aria-hidden': 'true' }, isCompressible(file) ? '🖼' : '📄'),
        h('span', { class: 'ablage-up__main' }, h('b', {}, file.name), h('span', { class: 'ablage-up__status' }, isCompressible(file) ? 'Foto wird verkleinert …' : 'Wird abgelegt …')));
      list.append(row);
      try {
        const { file: rec, result, warning } = await storeUpload(file, target);
        const thumb = rec.thumbUrl ? h('img', { class: 'ablage-up__thumb', src: rec.thumbUrl, alt: '' }) : null;
        if (thumb) row.firstChild.replaceWith(thumb);
        row.querySelector('.ablage-up__status').replaceWith(h('span', { class: 'ablage-up__status' },
          result ? [h('span', { class: 'ablage-up__ok' }, `✓ Abgelegt als „${rec.name}“ · ${result.originalWidth} × ${result.originalHeight} → ${result.width} × ${result.height} Pixel`), compressResult(result)]
            : h('span', { class: 'ablage-up__ok' }, `✓ Abgelegt · ${formatBytes(rec.size)} · ${warning || 'unverändert (Dokumente werden nicht verkleinert)'}`)));
        row.classList.add('ablage-up--ok');
        done++; before += result ? result.before : rec.size; after += rec.size;
      } catch (e) {
        row.classList.add('ablage-up--err');
        row.querySelector('.ablage-up__status').textContent = '⚠ ' + (e.message || 'Konnte nicht abgelegt werden.');
      }
    }
    if (done) {
      const pct = before ? Math.round((1 - after / before) * 100) : 0;
      summary.replaceChildren(h('p', {}, h('strong', {}, `✓ ${plural(done, 'Datei', 'Dateien')} abgelegt in „${db.find('folders', target).name}“.`),
        before > after ? ` Zusammen ${formatBytes(before)} → ${formatBytes(after)} (−${pct} %).` : ''));
      requestAnimationFrame(() => summary.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  };
  input.addEventListener('change', () => { const fs = Array.from(input.files || []); input.value = ''; process(fs); });

  const drawBody = () => {
    if (!target) {
      const picker = folderPicker({ label: 'Wohin soll die Datei?' });
      body.replaceChildren(h('p', {}, 'Wählen Sie zuerst den Ordner. Das Schild am Ordner bestimmt, wer die Datei sehen darf.'), picker.el,
        button({ label: 'Weiter', icon: '→', variant: 'primary', size: 'lg', onClick: () => {
          const v = picker.value(); if (!v) { picker.setError('Bitte tippen Sie auf einen Ordner.'); return; }
          target = v; drawBody(); } }));
      return;
    }
    const vis = folderVisibility(target);
    body.replaceChildren(
      h('p', { class: 'ablage-upload__dest' }, 'Ablegen in: ', h('strong', {}, '📁 ', pathText(target))),
      h('div', { class: `ablage-upload__vis ablage-vis--${vis}` }, h('span', { 'aria-hidden': 'true' }, VISIBILITY[vis].icon), h('span', {}, 'Diese Datei sehen: ', h('strong', {}, VISIBILITY[vis].long))),
      h('div', { class: 'cluster' },
        button({ label: 'Dateien auswählen', icon: '📂', variant: 'primary', size: 'lg', onClick: () => input.click() })),
      h('div', { class: 'ablage-upload__demo' },
        h('p', { class: 'ablage-upload__demo-h' }, '🎭 Für die Vorführung ohne eigene Dateien:'),
        h('div', { class: 'cluster' },
          button({ label: 'Beispielfoto vom Handy (4032 × 3024)', icon: '📷', onClick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try { process([await demoPhotoFile()]); } catch { toast('Das Beispielfoto konnte nicht geladen werden.', { type: 'error' }); } finally { b.disabled = false; }
          } }),
          button({ label: 'Beispiel-PDF', icon: '📄', onClick: () => {
            const blob = makePdf('Kostenvoranschlag Heizung Pfarrheim', ['Beispiel: Angebot einer Heizungsfirma', 'Betrag: 4.850,00 € (Beispiel)', `Abgelegt von ${currentUser()?.name || ''}`]);
            process([new File([blob], 'Kostenvoranschlag Heizung Pfarrheim.pdf', { type: 'application/pdf' })]);
          } }))),
      notice(h('p', {}, 'Fotos werden automatisch verkleinert (höchstens 1600 Pixel, WebP-Format) – das spart meist über 80 % Speicher. PDFs und andere Dokumente bleiben unverändert.'), 'calm', '💡'),
      list, summary);
  };
  drawBody();
  document.body.append(input);
  m = modal({ title: 'Datei hochladen', body, wide: true, closeLabel: 'Schließen', onClose: () => input.remove(),
    actions: [{ label: 'Fertig', icon: '✓', variant: 'primary', onClick: (close) => close() }] });
  if (preset && preset.length && target) process(preset);
  return m;
}

function wireDrop(zone, folderId) {
  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  zone.addEventListener('dragenter', e => { stop(e); zone.classList.add('ablage-drop--over'); });
  zone.addEventListener('dragover', e => { stop(e); zone.classList.add('ablage-drop--over'); });
  zone.addEventListener('dragleave', e => { stop(e); zone.classList.remove('ablage-drop--over'); });
  zone.addEventListener('drop', e => {
    stop(e); zone.classList.remove('ablage-drop--over');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadDialog(folderId, files);
  });
}

/* ---------------------------------------------------------
   Suche (globale Verwaltungs-Suche) – ersetzt die Standard-Quelle „files“
   --------------------------------------------------------- */
registerSearchProvider({
  id: 'files', label: 'Ablage', permission: 'files.view',
  search: (q) => {
    const { folders, files } = searchAblage(q);
    return [
      ...folders.map(f => ({ icon: '📁', title: f.name, sub: `Ordner · ${pathText(f.id)} · ${VISIBILITY[folderVisibility(f.id)].label}`, href: `${BASE}/${f.id}` })),
      ...files.map(f => ({ icon: TYPE_ICON[typeKey(f)], title: f.name, sub: `${pathText(f.folderId)} · ${VISIBILITY[folderVisibility(f.folderId)].label}`,
        href: `${BASE}/${f.folderId}?datei=${f.id}`, thumb: previewUrl(f, 's') || undefined })),
    ];
  },
});

/* ---------------------------------------------------------
   Hilfe
   --------------------------------------------------------- */
registerHelp('/admin/ablage', { title: 'Ablage', steps: [
  'Tippen Sie auf einen Ordner, um ihn zu öffnen. Ganz oben steht immer, wo Sie gerade sind (z. B. „Ablage › Vorstand › Finanzen“).',
  'Das farbige Schild zeigt, wer den Ordner sehen darf: „🔒 Nur Vorstand“, „👥 Alle Mitglieder“ oder „🌐 Öffentlich“. Dateien bekommen immer das Schild ihres Ordners.',
  'Mit „Datei hochladen“ legen Sie Dokumente ab. Fotos vom Handy werden dabei automatisch verkleinert.',
  'Bei jeder Datei stehen die Knöpfe „Ansehen“, „Umbenennen“, „Verschieben“ und „In den Papierkorb“.',
  'Aus Versehen gelöscht? Unten erscheint „Rückgängig“ – oder Sie holen die Datei 30 Tage lang aus dem Papierkorb zurück.'] });
registerHelp('/admin/ablage/papierkorb', { title: 'Papierkorb der Ablage', steps: [
  'Hier liegt alles, was in der Ablage gelöscht wurde – 30 Tage lang.',
  'Mit „Wiederherstellen“ ist die Datei wieder im selben Ordner wie vorher.',
  'Endgültig löschen darf nur der Administrator.'] });

/* ---------------------------------------------------------
   Routen
   --------------------------------------------------------- */
registerRoute('/admin/ablage', renderRoot, { permission: 'files.view', title: 'Ablage', nav: 'ablage' });
registerRoute('/admin/ablage/papierkorb', renderTrash, { permission: 'files.view', title: 'Papierkorb der Ablage', nav: 'ablage' });
registerRoute('/admin/ablage/:folderId', renderFolder, { permission: 'files.view', title: 'Ablage', nav: 'ablage' });

// für Tests in der Konsole
try { window.__kolpingAblage = { searchAblage, visibleRoots, storeUpload }; } catch { /* egal */ }
export { searchAblage, visibleRoots };
