// =========================================================
// store.js – Mock-Datenbank im Browser (localStorage)
// Alle Zugriffe über `db`. Gelöschte Einträge landen im
// Papierkorb (deletedAt), endgültiges Löschen = db.purge().
// Siehe CONVENTIONS.md für das Datenmodell.
// =========================================================
import { buildSeed, SEED_VERSION } from './seed.js';

const KEY = 'kolping-proto-db-v1';
const PREFS_KEY = 'kolping-proto-prefs-v1';

export const COLLECTIONS = ['users', 'roles', 'events', 'news', 'pages', 'albums', 'media',
  'folders', 'files', 'protocols', 'audit', 'mails'];

/** Kurze, eindeutige ID mit Präfix, z. B. uid('e') → "e-lq3k9x2a" */
export function uid(prefix = 'x') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const nowIso = () => {
  // Lokale Zeit ohne Zeitzone (wie im Seed), z. B. "2026-10-22T14:32:05"
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
export { nowIso };

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* egal */ }
}

let data = null;
let memoryOnly = false;      // true, wenn localStorage nicht geht oder voll ist
const listeners = new Set();

function load() {
  const raw = safeGet(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === SEED_VERSION) { data = parsed; ensureShape(); return; }
    } catch { /* kaputt → neu */ }
  }
  data = buildSeed();
  ensureShape();
  persist();
}
function ensureShape() {
  for (const c of COLLECTIONS) if (!Array.isArray(data[c])) data[c] = [];
  if (!data.meta) data.meta = {};
}

let saveTimer = null;
function persist() {
  const ok = safeSet(KEY, JSON.stringify(data));
  if (!ok && !memoryOnly) {
    memoryOnly = true;
    emit({ type: 'storage-full' });
  }
  return ok;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 120);
}

function emit(evt) {
  for (const fn of listeners) {
    try { fn(evt); } catch (e) { console.error(e); }
  }
}

const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

export const db = {
  /** Alle (nicht gelöschten) Einträge einer Sammlung. Liefert die echten Objekte – NICHT direkt ändern, sondern db.update() nutzen. */
  all(coll, { withDeleted = false } = {}) {
    const arr = data[coll] || [];
    return withDeleted ? arr.slice() : arr.filter(x => !x.deletedAt);
  },
  /** Ein Eintrag per id (auch gelöschte, damit „Rückgängig“ funktioniert) */
  find(coll, id) { return (data[coll] || []).find(x => x.id === id) || null; },
  /** Erster Eintrag, für den fn(x) true liefert */
  findBy(coll, fn) { return db.all(coll).find(fn) || null; },
  /** Gefilterte Liste (ohne gelöschte) */
  where(coll, fn) { return db.all(coll).filter(fn); },

  /** Neuen Eintrag anlegen. id/createdAt/updatedAt werden ergänzt, falls nicht gesetzt. Gibt den Eintrag zurück. */
  insert(coll, obj) {
    const item = { ...obj };
    if (!item.id) item.id = uid(coll.slice(0, 2));
    item.createdAt = item.createdAt || nowIso();
    item.updatedAt = item.updatedAt || item.createdAt;
    data[coll].unshift(item);
    scheduleSave();
    emit({ type: 'insert', coll, id: item.id, item });
    return item;
  },
  /** Felder eines Eintrags ändern (flaches Merge). Gibt den Eintrag zurück. */
  update(coll, id, patch) {
    const item = db.find(coll, id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: patch.updatedAt || nowIso() });
    scheduleSave();
    emit({ type: 'update', coll, id, item });
    return item;
  },
  /** In den Papierkorb legen (weiches Löschen). Gibt den Eintrag zurück. */
  remove(coll, id, { by = null } = {}) {
    const item = db.find(coll, id);
    if (!item) return null;
    item.deletedAt = nowIso();
    item.deletedBy = by;
    scheduleSave();
    emit({ type: 'remove', coll, id, item });
    return item;
  },
  /** Aus dem Papierkorb zurückholen */
  restore(coll, id) {
    const item = db.find(coll, id);
    if (!item) return null;
    delete item.deletedAt; delete item.deletedBy;
    scheduleSave();
    emit({ type: 'restore', coll, id, item });
    return item;
  },
  /** Endgültig löschen (nur Admin – Rechteprüfung macht der Aufrufer mit can('trash.purge')) */
  purge(coll, id) {
    const arr = data[coll] || [];
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return false;
    const [item] = arr.splice(i, 1);
    scheduleSave();
    emit({ type: 'purge', coll, id, item });
    return true;
  },
  /** Alle Einträge im Papierkorb, sammlungsübergreifend: [{coll, item}] (neueste zuerst) */
  trash() {
    const out = [];
    for (const c of COLLECTIONS) for (const item of data[c]) if (item.deletedAt) out.push({ coll: c, item });
    return out.sort((a, b) => (b.item.deletedAt || '').localeCompare(a.item.deletedAt || ''));
  },
  /** Fügt Einträge hinzu, deren id noch nicht existiert (für Module, die eigene Beispieldaten brauchen) */
  seedIfMissing(coll, items) {
    if (!data[coll]) data[coll] = [];
    let n = 0;
    for (const it of items) if (!data[coll].some(x => x.id === it.id)) { data[coll].push(clone(it)); n++; }
    if (n) scheduleSave();
    return n;
  },
  /** Freier Key-Value-Speicher für Module: db.meta('protokolle.lastOpen') / db.meta(key, value) */
  meta(key, value) {
    if (arguments.length === 1) return data.meta[key];
    data.meta[key] = value; scheduleSave(); emit({ type: 'meta', key }); return value;
  },
  /** Änderungen abonnieren. fn({type, coll, id, item}). Gibt Abmeldefunktion zurück. */
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Sofort speichern (normalerweise automatisch) */
  save() { clearTimeout(saveTimer); return persist(); },
  /** true, wenn nichts im Browser gespeichert werden kann (privates Fenster / Speicher voll) */
  get memoryOnly() { return memoryOnly; },
  /** Alles auf Beispieldaten zurücksetzen (inkl. Anmeldung & Rundgang) und Seite neu laden */
  reset({ reload = true } = {}) {
    safeRemove(KEY);
    safeRemove(PREFS_KEY);
    safeRemove('kolping-proto-session');
    data = buildSeed(); ensureShape(); memoryOnly = false; persist();
    emit({ type: 'reset' });
    if (reload) { location.hash = '#/'; location.reload(); }
  },
  /** Direkter Zugriff (nur lesen/debuggen) */
  get raw() { return data; },
};

// ---------- Audit-Log ----------
let currentUserProvider = () => null;
/** Wird von auth.js gesetzt, damit log() weiß, wer gerade angemeldet ist. */
export function setAuditUserProvider(fn) { currentUserProvider = fn; }

/**
 * Eintrag ins Änderungsprotokoll.
 * @param {string} action  z. B. 'news.create', 'event.update', 'file.upload', 'file.delete', 'protocol.approve'
 * @param {string} target  Lesbarer Text, z. B. 'Termin „Herbstwanderung“'
 * @param {string} [details] Zusatz, z. B. 'Ordner Vorstand › Finanzen'
 */
export function log(action, target, details = '') {
  const u = currentUserProvider();
  const entry = { id: uid('l'), at: nowIso(), userId: u ? u.id : null, action, target, details };
  data.audit.unshift(entry);
  if (data.audit.length > 500) data.audit.length = 500;
  scheduleSave();
  emit({ type: 'insert', coll: 'audit', id: entry.id, item: entry });
  return entry;
}

/** Lesbare deutsche Bezeichnung für eine Audit-Aktion */
export const ACTION_LABELS = {
  'user.login': 'hat sich angemeldet', 'user.logout': 'hat sich abgemeldet', 'user.invite': 'hat eingeladen',
  'user.update': 'hat Benutzer geändert', 'user.role': 'hat Rolle geändert', 'user.deactivate': 'hat Zugang gesperrt',
  'role.update': 'hat Rechte geändert',
  'news.create': 'hat Neuigkeit angelegt', 'news.update': 'hat Neuigkeit geändert', 'news.publish': 'hat veröffentlicht',
  'news.unpublish': 'hat von der Website genommen', 'news.delete': 'hat Neuigkeit gelöscht',
  'page.update': 'hat Seite geändert', 'page.publish': 'hat Seite veröffentlicht',
  'event.create': 'hat Termin eingetragen', 'event.update': 'hat Termin geändert', 'event.delete': 'hat Termin gelöscht',
  'media.upload': 'hat Fotos hochgeladen', 'media.delete': 'hat Foto gelöscht', 'media.update': 'hat Foto geändert',
  'file.upload': 'hat Datei abgelegt', 'file.delete': 'hat Datei gelöscht', 'file.move': 'hat Datei verschoben',
  'file.rename': 'hat Datei umbenannt', 'folder.create': 'hat Ordner angelegt', 'folder.delete': 'hat Ordner gelöscht',
  'protocol.create': 'hat Protokoll begonnen', 'protocol.update': 'hat Protokoll bearbeitet', 'protocol.approve': 'hat Protokoll abgeschlossen',
  'mail.send': 'hat E-Mail verschickt', 'trash.restore': 'hat wiederhergestellt', 'trash.purge': 'hat endgültig gelöscht',
  'access.denied': 'wurde abgewiesen',
};

// ---------- Persönliche Einstellungen (pro Browser) ----------
let prefs = {};
try { prefs = JSON.parse(safeGet(PREFS_KEY) || '{}') || {}; } catch { prefs = {}; }
/** Pro-Gerät-Einstellungen (Schriftgröße, Rundgang offen …): prefs.get(key, fallback) / prefs.set(key, value) */
export const prefsStore = {
  get(key, fallback = null) { return key in prefs ? prefs[key] : fallback; },
  set(key, value) { prefs[key] = value; safeSet(PREFS_KEY, JSON.stringify(prefs)); },
};

// ---------- Kleine Abfrage-Helfer, die mehrere Module brauchen ----------
/** Bild-Datensatz zu einer Media-ID (oder null) */
export function mediaById(id) { return id ? db.find('media', id) : null; }
/** URL eines Bildes; size 's' = Vorschaubild */
export function mediaUrl(id, size = 'l') {
  const m = mediaById(id);
  if (!m) return '';
  return size === 's' ? (m.thumb || m.src) : m.src;
}
/** Benutzername zu ID */
export function userName(id) { const u = id ? db.find('users', id) : null; return u ? u.name : 'Unbekannt'; }

/** Termin-Kategorie {id,label,color} */
export function eventCategory(id) {
  return (data.eventCategories || []).find(c => c.id === id) || { id, label: id, color: '#57534e' };
}
export function eventCategories() { return data.eventCategories || []; }

/** Ordnerpfad als Array (Wurzel zuerst) */
export function folderPath(folderId) {
  const out = []; let f = db.find('folders', folderId); let guard = 0;
  while (f && guard++ < 20) { out.unshift(f); f = f.parentId ? db.find('folders', f.parentId) : null; }
  return out;
}
/** Ordner und alle übergeordneten Ordner existieren und liegen nicht im Papierkorb */
export function folderAlive(folderId) {
  const path = folderPath(folderId);
  return path.length > 0 && path.every(f => !f.deletedAt);
}
/** Effektive Sichtbarkeit eines Ordners ('public' | 'members' | 'board') – erbt vom obersten Ordner */
export function folderVisibility(folderId) {
  const path = folderPath(folderId);
  for (let i = path.length - 1; i >= 0; i--) if (path[i].visibility) return path[i].visibility;
  return 'board';
}

load();

// Für die Browser-Konsole (Debuggen in der Demo)
try { window.__kolpingDb = db; } catch { /* egal */ }
