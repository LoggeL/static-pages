// =========================================================
// inhalte/common.js – gemeinsame Helfer des Moduls „inhalte“
// (Rechte, Arbeitskopie/Veröffentlichen, Vorschau, Foto-Speicher)
// =========================================================
import { db, log, nowIso, mediaById, userName, ACTION_LABELS } from '../../store.js';
import { can, currentUser } from '../../auth.js';
import { h, button, toast, modal, formatDate, formatDateTime, formatBytes, compressImage, slugify, stripHTML } from '../../ui.js';

/* ---------------------------------------------------------
   Zusätzliche Bezeichnungen fürs Änderungsprotokoll
   --------------------------------------------------------- */
const EXTRA_LABELS = {
  'album.create': 'hat Album angelegt', 'album.update': 'hat Album geändert', 'album.delete': 'hat Album gelöscht',
  'page.discard': 'hat Änderungen verworfen', 'news.discard': 'hat Änderungen verworfen',
};
for (const [k, v] of Object.entries(EXTRA_LABELS)) if (!(k in ACTION_LABELS)) ACTION_LABELS[k] = v;

/* ---------------------------------------------------------
   Rechte: jede Aktion prüft zusätzlich zum Router
   --------------------------------------------------------- */
/** Prüft ein Recht. Fehlt es, kommt eine freundliche Meldung und false zurück. */
export function allowed(perm) {
  if (can(perm)) return true;
  log('access.denied', 'Inhalte der Website', `fehlendes Recht: ${[].concat(perm).join(' / ')}`);
  toast('Dafür ist Ihr Konto nicht freigegeben. Bitte den Administrator fragen.', { type: 'error' });
  return false;
}
export const me = () => currentUser();
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------------------------------------------------------
   Bilder
   --------------------------------------------------------- */
/** <img> zu einer Media-ID ('s' = Vorschau). Gibt null zurück, wenn es das Foto nicht (mehr) gibt. */
export function mImg(id, { size = 'l', cls, alt } = {}) {
  const m = mediaById(id);
  if (!m || m.deletedAt) return null;
  return h('img', { src: size === 's' ? (m.thumb || m.src) : m.src, alt: alt ?? (m.alt || ''), class: cls || null,
    loading: 'lazy', decoding: 'async', width: m.width || null, height: m.height || null });
}
export function thumbOrIcon(id, icon = '📰') {
  const img = mImg(id, { size: 's', cls: 'admin-row__thumb', alt: '' });
  return img || h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, icon);
}
/** Alben, in denen ein Foto vorkommt */
export function albumsOf(mediaId) { return db.all('albums').filter(a => (a.media || []).includes(mediaId)); }

/* ---------------------------------------------------------
   Foto-Speicher: verkleinerte Fotos liegen in IndexedDB statt
   als dataURL im (kleinen) localStorage. Beim Laden werden sie
   wieder als blob:-Adressen eingesetzt.
   --------------------------------------------------------- */
const IDB_NAME = 'kolping-proto-media';
const IDB_STORE = 'blobs';
let idbPromise = null;
function idb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((res) => {
    try {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore(IDB_STORE); } catch { /* egal */ } };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return idbPromise;
}
async function idbOp(mode, fn) {
  const d = await idb(); if (!d) return null;
  return new Promise((res) => {
    try {
      const tx = d.transaction(IDB_STORE, mode);
      const st = tx.objectStore(IDB_STORE);
      const req = fn(st);
      tx.oncomplete = () => res(req ? req.result ?? true : true);
      tx.onerror = () => res(null); tx.onabort = () => res(null);
    } catch { res(null); }
  });
}
const idbPut = (key, blob) => idbOp('readwrite', st => st.put(blob, key));
const idbGet = (key) => idbOp('readonly', st => st.get(key));
const idbClear = () => idbOp('readwrite', st => st.clear());

async function rehydrate() {
  const list = db.all('media', { withDeleted: true }).filter(m => m.store === 'idb');
  for (const m of list) {
    const [l, s] = await Promise.all([idbGet(m.id + ':l'), idbGet(m.id + ':s')]);
    // Nur Laufzeit-Adressen (blob:) setzen – der gespeicherte Datensatz bleibt gültig, weil beim nächsten Laden neu gesetzt wird.
    if (l instanceof Blob) m.src = URL.createObjectURL(l); else m.src = 'img/kolping-logo.svg';
    if (s instanceof Blob) m.thumb = URL.createObjectURL(s); else m.thumb = m.src;
  }
}
try {
  if (db.all('media', { withDeleted: true }).some(m => m.store === 'idb')) {
    await Promise.race([rehydrate(), new Promise(r => setTimeout(r, 1500))]);
  }
} catch { /* Demo läuft trotzdem */ }
db.subscribe(evt => { if (evt.type === 'reset') idbClear(); });

const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

/**
 * Foto verkleinern und in die Mediathek legen (wie addPhotoFromFile, aber speichersparend in IndexedDB).
 * onStage(text, prozent) meldet den Fortschritt.
 * → {media, result, small}
 */
export async function storePhoto(file, { albumId = null, alt = '', onStage = () => {} } = {}) {
  onStage('Foto wird geöffnet …', 15);
  await new Promise(r => setTimeout(r, 60));
  onStage('Wird verkleinert …', 45);
  const big = await compressImage(file, { maxSize: 1600, quality: 0.75 });
  onStage('Vorschaubild wird erstellt …', 70);
  const small = await compressImage(new File([big.blob], big.name, { type: big.type }), { maxSize: 560, quality: 0.7 });
  onStage('Wird gespeichert …', 88);
  const u = me();
  const id = 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let src = big.dataUrl, thumb = small.dataUrl, store = 'local';
  const ok1 = await idbPut(id + ':l', big.blob);
  const ok2 = ok1 ? await idbPut(id + ':s', small.blob) : null;
  if (ok1 && ok2) { src = URL.createObjectURL(big.blob); thumb = URL.createObjectURL(small.blob); store = 'idb'; }
  const media = db.insert('media', {
    id, src, thumb, store, width: big.width, height: big.height, size: big.after, thumbSize: small.after,
    originalSize: big.before, originalName: file.name, originalWidth: big.originalWidth, originalHeight: big.originalHeight,
    alt, caption: '', type: big.type, albumId, uploadedBy: u ? u.id : null,
  });
  if (albumId) {
    const a = db.find('albums', albumId);
    if (a) {
      const patch = { media: [...(a.media || []), id] };
      const cover = mediaById(a.cover);
      if (!cover || cover.deletedAt) patch.cover = id;
      db.update('albums', albumId, patch);
    }
  }
  const a = albumId ? db.find('albums', albumId) : null;
  log('media.upload', `Foto „${file.name}“`, `${formatBytes(big.before)} → ${formatBytes(big.after)} (−${big.savedPercent} %)${a ? ' · Album „' + a.title + '“' : ''}`);
  onStage('Fertig', 100);
  return { media, result: big, small };
}

/** Für Bilder im Fließtext: blob:-Adressen überleben kein Neuladen → als dataURL einfügen. */
export async function stableSrc(m) {
  if (!m) return '';
  if (!String(m.src).startsWith('blob:')) return m.src;
  try { const b = await idbGet(m.id + ':l'); if (b instanceof Blob) return await blobToDataURL(b); } catch { /* weiter */ }
  return m.thumb && !String(m.thumb).startsWith('blob:') ? m.thumb : m.src;
}

/* ---------------------------------------------------------
   Arbeitskopie & Veröffentlichen (Neuigkeiten und Seiten)
   Was auf der Website steht, bleibt unverändert, bis jemand
   „Auf der Website zeigen“ tippt. Änderungen an bereits
   veröffentlichten Einträgen liegen solange in item.pending.
   --------------------------------------------------------- */
export const MODEL = {
  news: { fields: ['title', 'date', 'teaser', 'body', 'image'], label: 'Neuigkeit', act: 'news', perm: 'site.news.edit' },
  pages: { fields: ['title', 'kicker', 'intro', 'body', 'image', 'external'], label: 'Seite', act: 'page', perm: 'site.pages.edit' },
};
const emptyOf = f => (f === 'image' || f === 'external') ? null : '';
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function pick(item, fields) { return Object.fromEntries(fields.map(f => [f, item[f] ?? emptyOf(f)])); }
/** Steht der Eintrag (in irgendeiner Fassung) auf der Website? */
export function isLive(coll, item) { return coll === 'pages' ? item.status !== 'draft' : item.status === 'published'; }
/** Aktuelle Arbeitsfassung (Website-Fassung + noch nicht veröffentlichte Änderungen) */
export function working(coll, item) { return { ...pick(item, MODEL[coll].fields), ...(item.pending || {}) }; }
export function hasPending(coll, item) {
  if (!item || !item.pending) return false;
  return Object.entries(item.pending).some(([k, v]) => !same(v, item[k] ?? emptyOf(k)));
}
/** Änderungen speichern: bei Entwürfen direkt, bei veröffentlichten Einträgen in die Arbeitskopie. */
export function saveWorking(coll, id, patch) {
  const item = db.find(coll, id); if (!item) return null;
  const u = me();
  if (isLive(coll, item)) {
    const next = { ...(item.pending || {}), ...patch };
    for (const k of Object.keys(next)) if (same(next[k], item[k] ?? emptyOf(k))) delete next[k];
    return db.update(coll, id, { pending: Object.keys(next).length ? next : null, pendingBy: u ? u.id : null, pendingAt: nowIso() });
  }
  return db.update(coll, id, { ...patch, updatedBy: u ? u.id : null });
}
/** Eindeutige Webadresse für eine Neuigkeit */
export function uniqueSlug(title, selfId) {
  const base = slugify(title); let s = base, i = 2;
  while (db.all('news', { withDeleted: true }).some(x => x.slug === s && x.id !== selfId)) s = `${base}-${i++}`;
  return s;
}
/** Veröffentlichen: Arbeitsfassung wird zur Website-Fassung, die alte Fassung kommt in den Verlauf. */
export function publishItem(coll, id) {
  const item = db.find(coll, id); if (!item) return null;
  const M = MODEL[coll]; const u = me();
  const w = working(coll, item);
  const wasLive = isLive(coll, item);
  const versions = wasLive
    ? [{ at: item.publishedAt || item.updatedAt, by: item.updatedBy || item.author || null, data: pick(item, M.fields) }, ...(item.versions || [])].slice(0, 5)
    : (item.versions || []);
  const patch = { ...w, pending: null, pendingBy: null, pendingAt: null, status: 'published', publishedAt: nowIso(), updatedBy: u ? u.id : null, versions };
  if (coll === 'news' && !wasLive && !item.publishedAt) patch.slug = uniqueSlug(w.title, id);
  db.update(coll, id, patch);
  log(`${M.act}.publish`, `${M.label} „${w.title}“`, wasLive ? 'Änderungen auf der Website gezeigt' : 'Auf der Website gezeigt');
  return db.find(coll, id);
}
/** Text enthält noch Platzhalter aus der Vorlage, z. B. „[Ort]“? */
export function placeholdersIn(...vals) {
  const txt = vals.map(v => stripHTML(v || '')).join(' ');
  return txt.match(/\[[^\]\n]{1,40}\]/g) || [];
}

/** Liste „Frühere Fassungen“ mit Zurückholen-Knopf */
export function versionsBox(coll, item, { onRestore }) {
  const vs = item.versions || [];
  if (!vs.length) return null;
  return h('section', { class: 'dash-box inhalte-versions', 'aria-labelledby': 'inh-vers-h' },
    h('h2', { id: 'inh-vers-h' }, 'Frühere Fassungen'),
    h('p', { class: 'muted' }, 'Jedes Veröffentlichen hebt die vorherige Fassung auf. Zurückholen ändert die Website erst, wenn Sie danach wieder auf „Auf der Website zeigen“ tippen.'),
    h('ul', { class: 'admin-list' }, vs.map((v, i) => h('li', { class: 'admin-row' },
      h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, '🕘'),
      h('span', { class: 'admin-row__main' }, h('b', {}, `Fassung vom ${formatDateTime(v.at)}`),
        h('span', { class: 'admin-row__sub' }, `${v.by ? userName(v.by) : 'Unbekannt'} · „${v.data.title}“`)),
      h('span', { class: 'admin-row__actions' }, button({ label: 'Diese Fassung zurückholen', icon: '↶', onClick: () => onRestore(v, i) }))))));
}

/* ---------------------------------------------------------
   Vorschau „So sieht es auf der Website aus“
   --------------------------------------------------------- */
const proseEl = (html) => { const d = h('div', { class: 'prose' }); d.innerHTML = html || ''; return d; };
function siteBar() {
  return h('div', { class: 'inhalte-pv__site', 'aria-hidden': 'true' },
    h('img', { src: 'img/kolping-logo.svg', alt: '', width: 44, height: 28 }),
    h('span', {}, h('small', {}, 'Kolpingsfamilie'), h('b', {}, 'Ramsen')),
    h('span', { class: 'inhalte-pv__nav' }, 'Start · Aktuelles · Termine · Verein · Bereiche · Rückblick · Kontakt'));
}
/** Website-Darstellung einer Neuigkeit (wie #/aktuelles/…) */
export function newsArticle(w) {
  return h('article', { class: 'article' },
    h('header', { class: 'container article__head' },
      h('nav', { class: 'crumbs', 'aria-label': 'Brotkrumen' }, h('a', { href: '#/aktuelles' }, 'Aktuelles'), h('span', { 'aria-hidden': 'true' }, ' › '), h('span', {}, w.title || 'Neuigkeit')),
      h('time', { class: 'article__date', datetime: w.date }, formatDate(w.date, 'long')),
      h('h1', { class: 'article__title' }, w.title || '(noch ohne Überschrift)'),
      w.teaser ? h('p', { class: 'article__lead' }, w.teaser) : null),
    w.image && mImg(w.image) ? h('figure', { class: 'container article__figure' }, mImg(w.image)) : null,
    h('div', { class: 'container article__body' }, proseEl(w.body)));
}
/** Karte, wie sie auf der Startseite / unter „Aktuelles“ erscheint */
export function newsCardPreview(w) {
  return h('div', { class: 'news-card inhalte-pv__card' },
    h('div', { class: 'news-card__img' }, mImg(w.image, { size: 's' }) || h('div', { class: 'img-fallback' }, h('img', { src: 'img/kolping-logo.svg', alt: '' }))),
    h('div', { class: 'news-card__body' },
      h('time', { class: 'news-card__date' }, formatDate(w.date, 'medium')),
      h('h3', { class: 'news-card__title' }, w.title || '(noch ohne Überschrift)'),
      h('p', { class: 'news-card__teaser' }, w.teaser || stripHTML(w.body).slice(0, 140)),
      h('span', { class: 'news-card__more' }, 'Weiterlesen →')));
}
/** Website-Darstellung einer Seite (wie #/verein/…) */
export function pageArticle(w, page) {
  const img = w.image ? mImg(w.image, { alt: '' }) : null;
  const label = page.section === 'verein' ? 'Verein' : page.section === 'bereiche' ? 'Vereinsbereiche' : '';
  const hero = h('header', { class: `page-hero${img ? ' page-hero--image' : ''}` },
    img ? h('div', { class: 'page-hero__media' }, img) : null,
    h('div', { class: 'container page-hero__inner' },
      label ? h('nav', { class: 'crumbs', 'aria-label': 'Brotkrumen' }, h('a', { href: '#/' + page.section }, label), h('span', { 'aria-hidden': 'true' }, ' › '), h('span', {}, w.title)) : null,
      w.kicker ? h('p', { class: 'kicker' }, w.kicker) : null,
      h('h1', { class: 'page-hero__title' }, w.title || '(ohne Titel)'),
      w.intro ? h('p', { class: 'page-hero__intro' }, w.intro) : null));
  return h('div', {}, hero,
    h('section', { class: 'section section--tight' }, h('div', { class: `container${page.section === 'static' ? ' narrow' : ''}` },
      proseEl(w.body),
      w.external && w.external.url ? h('p', {}, button({ label: (w.external.label || 'Zur Website') + ' ↗', variant: 'primary', size: 'lg', href: w.external.url })) : null)));
}
/**
 * Große Vorschau im Website-Design, umschaltbar Computer/Handy.
 * openPreview({address, render: () => Node, extra: Node, note})
 */
export function openPreview({ address, render, extra, note }) {
  const frame = h('div', { class: 'inhalte-pv__frame' });
  const page = h('div', { class: 'inhalte-pv__page' }, siteBar(), render());
  frame.append(page);
  frame.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) { e.preventDefault(); toast('In der Vorschau führen Links nirgendwohin.', { type: 'info' }); }
  });
  const mk = (label, icon, mode) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(mode === 'desk'),
    onclick: (e) => { frame.classList.toggle('inhalte-pv__frame--phone', mode === 'phone'); for (const b of chips.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } },
    h('span', { 'aria-hidden': 'true' }, icon), label);
  const chips = h('div', { class: 'chips inhalte-chips', role: 'group', 'aria-label': 'Ansicht' }, mk('Computer / Tablet', '💻', 'desk'), mk('Handy', '📱', 'phone'));
  const body = h('div', { class: 'inhalte-pv' },
    note ? h('div', { class: 'notice notice--info' }, h('span', { 'aria-hidden': 'true' }, '👁'), h('div', {}, note)) : null,
    h('div', { class: 'inhalte-pv__tools' }, chips),
    h('div', { class: 'inhalte-pv__browser' },
      h('div', { class: 'inhalte-pv__url' }, h('span', { 'aria-hidden': 'true' }, '🔒'), ' ', address)),
    frame,
    extra || null);
  const m = modal({ title: 'So sieht es auf der Website aus', body, wide: true,
    actions: [{ label: 'Zurück zum Bearbeiten', icon: '←', variant: 'primary' }] });
  m.el.classList.add('inhalte-pv-modal');
  return m;
}

/** Kleine Info-Zeile „zuletzt geändert …“ */
export function changedBy(item) {
  const who = item.pendingBy || item.updatedBy || item.author || item.uploadedBy;
  return `zuletzt geändert ${formatDateTime(item.pendingAt || item.updatedAt)}${who ? ' von ' + userName(who) : ''}`;
}
