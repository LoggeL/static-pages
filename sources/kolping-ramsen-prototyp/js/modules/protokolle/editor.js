// =========================================================
// protokolle/editor.js – Protokoll bearbeiten / lesen
// Vorlage mit Kopfdaten, Anwesenheit zum Ankreuzen, TOPs mit
// WYSIWYG-Text und Beschlüssen (Abstimmungsergebnis), Autosave,
// Versionsverlauf, Abschließen (sperrt), In Ablage ablegen, Druck.
// Live-Zusammenarbeit wird simuliert (Petra Vorstand).
// =========================================================
import { rerender } from '../../app.js';
import { db, log, uid, nowIso, prefsStore, userName } from '../../store.js';
import { can, currentUser } from '../../auth.js';
import { h, button, badge, toast, modal, field, autosaveIndicator, parseDate, parseTime, formatDate, formatDateTime,
  relativeTime, createEditor, pageHeader, emptyState, avatar, debounce, stripHTML, formatBytes, fromISODate, todayISO,
  visibilityBadge } from '../../ui.js';
import { notice } from '../../admin.js';
import * as M from './model.js';
import { protocolDoc, protocolDocHTML, printProtocol, ensurePrintRoot, removePrintRoot } from './doc.js';
import * as L from './live.js';

const BACK = { href: '#/admin/protokolle', label: 'Zurück zu allen Protokollen' };
const PETRA = M.PETRA;
const uniq = a => [...new Set(a)];
const shorten = (s, n = 48) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : (s || '–'); };

/** Sitzungsdatum tolerant lesen. Sitzungen liegen meist in der Vergangenheit: ohne Jahresangabe kein Sprung ins nächste Jahr. */
export function parseMeetingDate(v) {
  const iso = parseDate(v);
  if (!iso) return null;
  const explicitYear = /\b\d{4}\b/.test(v) || /\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{2}\b/.test(v);
  const diffDays = (fromISODate(iso) - fromISODate(todayISO())) / 86400000;
  if (!explicitYear && diffDays > 60) { const d = fromISODate(iso); d.setFullYear(d.getFullYear() - 1); return `${d.getFullYear()}-${iso.slice(5)}`; }
  return iso;
}

export const statusBadge = p => p.status === 'final' ? badge('Abgeschlossen', 'ok', '🔒') : badge('Entwurf', 'draft', '✎');
export const docOpts = p => ({ status: p.status === 'final' ? 'final' : 'draft', approvedBy: p.approvedBy, approvedAt: p.approvedAt });
const pdfTitle = d => `Protokoll ${M.kindLabel(d.kind)} ${d.date || ''}`.trim();

/** Fortschritt: Entwurf → Abgeschlossen → In der Ablage */
export function statusSteps(p, pdf) {
  const step = p.status !== 'final' ? 0 : pdf ? 2 : 1;
  const items = [
    ['Entwurf', 'Alle im Vorstand können mitschreiben'],
    ['Abgeschlossen', 'Danach kann nichts mehr verändert werden'],
    ['In der Ablage', 'Als PDF im Ordner „Vorstand › Protokolle“'],
  ];
  return h('ol', { class: 'protokolle-steps', 'aria-label': 'Stand des Protokolls' }, items.map(([t, s], i) =>
    h('li', { class: `protokolle-step${i < step ? ' is-done' : ''}${i === step ? ' is-current' : ''}`, 'aria-current': i === step ? 'step' : null },
      h('span', { class: 'protokolle-step__n', 'aria-hidden': 'true' }, i < step ? '✓' : String(i + 1)),
      h('span', { class: 'protokolle-step__t' }, h('b', {}, t), h('small', {}, s)))));
}

/** Version anhängen (ohne Doppelte), max. 25 */
function addVersion(p, data, label, { by, byName } = {}) {
  const fresh = db.find('protocols', p.id);
  if (!fresh) return;
  const list = (fresh.versions || []).slice();
  const last = list[list.length - 1];
  const snap = M.clone(data);
  if (last && last.data && JSON.stringify(last.data) === JSON.stringify(snap)) return;
  const u = currentUser();
  list.push({ at: nowIso(), by: by === undefined ? (u ? u.id : null) : by, byName: byName || null, label, data: snap });
  while (list.length > 25) list.splice(1, 1); // ersten (ältesten) Vermerk behalten
  db.update('protocols', p.id, { versions: list, updatedAt: fresh.updatedAt });
}

/** Verweis-Eintrag in der Ablage (Typ „protocol“) mit Titel/Status abgleichen */
function syncFileRef(p, d, status) {
  if (!p.fileId) return;
  const f = db.find('files', p.fileId);
  if (!f || f.type !== 'protocol' || f.deletedAt) return;
  const name = `${M.kindLabel(d.kind)} ${d.date}${status === 'final' ? '' : ' (Entwurf)'}`;
  if (f.name !== name) db.update('files', f.id, { name });
}

/* ---------------------------------------------------------
   Versionsverlauf
   --------------------------------------------------------- */
function versionsCard(p, { editable, onRestore, onSnapshot } = {}) {
  const vs = M.versionsOf(p).slice().reverse();
  let showAll = false;
  const list = h('ul', { class: 'admin-list protokolle-versions' });
  const more = h('div');
  const view = (v) => {
    const actions = [{ label: 'Schließen' }];
    if (editable && onRestore) actions.push({ label: 'Diesen Stand wiederherstellen', icon: '↶', variant: 'primary', onClick: (c) => { c(); onRestore(v); } });
    modal({ title: `Stand vom ${formatDateTime(v.at)}`, body: protocolDoc(M.getData({ data: v.data }), { status: 'draft' }), wide: true, actions });
  };
  const draw = () => {
    const shown = showAll ? vs : vs.slice(0, 5);
    list.replaceChildren(
      h('li', { class: 'admin-row protokolle-version is-current' },
        h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, '●'),
        h('span', { class: 'admin-row__main' }, h('b', {}, 'Aktueller Stand'),
          h('span', { class: 'admin-row__sub' }, `zuletzt geändert ${relativeTime(p.updatedAt)}${p.updatedBy ? ' von ' + userName(p.updatedBy) : ''}`))),
      ...shown.map(v => h('li', { class: 'admin-row protokolle-version' },
        h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, v.byName ? '👥' : '🕘'),
        h('span', { class: 'admin-row__main' }, h('b', {}, v.label || 'Zwischenstand'),
          h('span', { class: 'admin-row__sub' }, `${formatDateTime(v.at)} · ${v.byName ? v.byName + ' (simuliert)' : userName(v.by)}`)),
        h('span', { class: 'admin-row__actions' },
          v.data ? button({ label: 'Ansehen', icon: '👁', onClick: () => view(v) }) : h('span', { class: 'muted' }, 'nur Vermerk'),
          editable && v.data && onRestore ? button({ label: 'Diesen Stand wiederherstellen', icon: '↶', onClick: () => onRestore(v) }) : null))));
    more.replaceChildren(vs.length > 5 && !showAll ? button({ label: `Alle ${vs.length} Stände zeigen`, icon: '▾', variant: 'ghost', onClick: () => { showAll = true; draw(); } }) : '');
  };
  draw();
  return h('section', { class: 'admin-card protokolle-card', 'aria-labelledby': 'prot-versions-h' },
    h('h2', { id: 'prot-versions-h' }, h('span', { 'aria-hidden': 'true' }, '🕘 '), 'Versionsverlauf'),
    h('p', { class: 'muted' }, 'Zwischenstände werden automatisch gemerkt. Sie können jederzeit zu einem früheren Stand zurück – nichts geht verloren.'),
    list, more,
    editable && onSnapshot ? h('p', { class: 'protokolle-card__foot' }, button({ label: 'Zwischenstand jetzt merken', icon: '📌', onClick: onSnapshot })) : null);
}

/* ---------------------------------------------------------
   Aktionen, die beide Ansichten brauchen
   --------------------------------------------------------- */
function fileToAblage(p) {
  if (!(can('files.upload') && can('files.board'))) { toast('Zum Ablegen fehlt Ihnen das Recht „Dateien ablegen“.', { type: 'error' }); return; }
  if (p.status !== 'final') { toast('Bitte das Protokoll zuerst abschließen.', { type: 'info' }); return; }
  const d = M.getData(p);
  const year = (d.date || p.date || todayISO()).slice(0, 4);
  const folder = M.yearFolder(year, { create: true });
  if (!folder) { toast('Der Ordner für die Protokolle wurde nicht gefunden.', { type: 'error' }); return; }
  const u = currentUser();
  const name = `${M.kindLabel(d.kind)} ${d.date}.pdf`;
  const file = db.insert('files', { id: uid('d'), folderId: folder.id, name, type: 'pdf', size: M.estimatePdfSize(d), originalSize: null,
    protocolId: p.id, note: 'Automatisch aus dem Online-Protokoll erstellt', uploadedBy: u ? u.id : null });
  db.update('protocols', p.id, { pdfFileId: file.id, updatedAt: p.updatedAt });
  const where = M.folderLabel(folder.id);
  log('file.upload', name, `Ordner ${where} · aus Protokoll „${p.title}“ erzeugt (${formatBytes(file.size)})`);
  rerender();
  toast(`Als PDF abgelegt: ${where} › ${name}`, { undo: () => {
    db.remove('files', file.id, { by: u ? u.id : null }); db.update('protocols', p.id, { pdfFileId: null, updatedAt: p.updatedAt });
    log('file.delete', name, 'Ablegen rückgängig gemacht'); rerender();
  } });
}

function reopen(p) {
  if (!can('protocols.approve')) { toast('Wieder öffnen darf nur, wer Protokolle abschließen darf.', { type: 'error' }); return; }
  const d = M.getData(p);
  addVersion(p, d, 'Abgeschlossene Fassung (vor der Korrektur)');
  const prev = { status: p.status, approvedBy: p.approvedBy, approvedAt: p.approvedAt };
  db.update('protocols', p.id, { status: 'draft', updatedBy: currentUser()?.id });
  syncFileRef(p, d, 'draft');
  log('protocol.update', `Protokoll „${p.title}“`, 'Zur Korrektur wieder geöffnet');
  rerender();
  toast('Das Protokoll ist wieder zum Bearbeiten offen.', { undo: () => {
    db.update('protocols', p.id, prev); syncFileRef(p, d, 'final');
    log('protocol.approve', `Protokoll „${p.title}“`, 'Wieder-Öffnen rückgängig gemacht'); rerender();
  } });
}

function filedNotice(pdf) {
  return notice([
    h('p', {}, h('strong', {}, 'Liegt in der Ablage: '), `${M.folderLabel(pdf.folderId)} › ${pdf.name} (${formatBytes(pdf.size)})`),
    can('files.view') ? h('p', {}, button({ label: 'In der Ablage ansehen', icon: '📁', href: `#/admin/ablage/${pdf.folderId}` })) : null,
  ], 'ok', '📁');
}

/* ---------------------------------------------------------
   Einstieg: /admin/protokolle/:id
   --------------------------------------------------------- */
export function renderProtocol(ctx) {
  const { el, params } = ctx;
  const p = db.find('protocols', params.id);
  if (!p) {
    el.replaceChildren(h('div', { class: 'admin-page' }, pageHeader({ title: 'Protokoll nicht gefunden', back: BACK }),
      emptyState({ icon: '🔎', title: 'Dieses Protokoll gibt es nicht', text: 'Vielleicht stimmt der Link nicht mehr.',
        action: button({ label: 'Zu allen Protokollen', icon: '📝', variant: 'primary', href: '#/admin/protokolle' }) })));
    return;
  }
  if (p.deletedAt) {
    el.replaceChildren(h('div', { class: 'admin-page' }, pageHeader({ title: p.title, back: BACK }),
      emptyState({ icon: '🗑', title: 'Dieses Protokoll liegt im Papierkorb',
        text: `Gelöscht ${relativeTime(p.deletedAt)}${p.deletedBy ? ' von ' + userName(p.deletedBy) : ''}. Sie können es zurückholen.`,
        action: can('protocols.edit') ? button({ label: 'Wiederherstellen', icon: '↶', variant: 'primary', onClick: () => {
          db.restore('protocols', p.id);
          if (p.fileId) { const f = db.find('files', p.fileId); if (f && f.deletedAt) db.restore('files', f.id); }
          log('trash.restore', `Protokoll „${p.title}“`); toast('Das Protokoll ist wieder da.'); rerender();
        } }) : null })));
    return;
  }
  ctx.setTitle(p.title);
  const editable = p.status !== 'final' && can('protocols.edit');
  return editable ? editorView(ctx, p) : readView(ctx, p);
}

/* ---------------------------------------------------------
   Lese-Ansicht (abgeschlossen oder ohne Schreibrecht)
   --------------------------------------------------------- */
function readView(ctx, p) {
  const { el } = ctx;
  const d = M.getData(p);
  const pdf = M.pdfFileOf(p);
  const canFile = can('files.upload') && can('files.board');
  const final = p.status === 'final';
  el.replaceChildren(h('div', { class: 'admin-page protokolle-page' },
    pageHeader({ title: p.title, back: BACK, badge: statusBadge(p) }),
    statusSteps(p, pdf),
    final
      ? notice([h('strong', {}, 'Abgeschlossen'), ` am ${formatDateTime(p.approvedAt)}${p.approvedBy ? ' von ' + userName(p.approvedBy) : ''}. Das Protokoll ist jetzt gesperrt – so bleibt es verbindlich.`], 'ok', '🔒')
      : notice('Sie können dieses Protokoll nur lesen. Schreiben dürfen der Vorstand und der Administrator.', 'info', 'ℹ'),
    final && !pdf && canFile ? notice('Nächster Schritt: Mit „In Ablage ablegen“ wird daraus ein PDF im Ordner „Vorstand › Protokolle“. Dort finden es alle aus dem Vorstand wieder.', 'calm', '💡') : null,
    pdf ? filedNotice(pdf) : null,
    protocolDoc(d, docOpts(p)),
    versionsCard(p, { editable: false }),
    h('div', { class: 'form-actions protokolle-actions' },
      button({ label: 'Als PDF drucken', icon: '🖨', onClick: () => printProtocol(d, docOpts(p), pdfTitle(d)) }),
      final && can('protocols.approve') ? button({ label: 'Zur Korrektur wieder öffnen', icon: '↺', variant: 'ghost', onClick: () => reopen(p) }) : null,
      h('span', { class: 'spacer' }),
      final && !pdf && canFile ? button({ label: 'In Ablage ablegen', icon: '📁', variant: 'primary', size: 'lg', onClick: () => fileToAblage(p) }) : null)));
  const onBefore = () => { ensurePrintRoot().innerHTML = protocolDocHTML(d, docOpts(p)); };
  window.addEventListener('beforeprint', onBefore);
  return () => { window.removeEventListener('beforeprint', onBefore); removePrintRoot(); };
}

/* ---------------------------------------------------------
   Bearbeiten (Entwurf)
   --------------------------------------------------------- */
function editorView(ctx, p) {
  const { el } = ctx;
  const me = currentUser();
  let data = M.getData(p);
  const initial = M.clone(data);
  let alive = true, pending = false, firstSaveDone = false, lastAutoVersion = Date.now(), lastLog = 0;
  const refs = new Map(); // top.id → { card, editor, presence, decisions: Map(dec.id → {box, yes, no, abstain}) }

  // --- Autosave-Anzeigen (oben in der Live-Leiste und unten in der Aktionsleiste) ---
  const savers = [autosaveIndicator(), autosaveIndicator()];
  const saver = {
    saving: () => savers.forEach(s => s.saving()),
    saved: (d) => savers.forEach(s => s.saved(d)),
    error: (m) => savers.forEach(s => s.error(m)),
    idle: (t) => savers.forEach(s => s.idle(t)),
  };
  saver.idle(`✓ Gespeichert ${relativeTime(p.updatedAt)}`);
  const titleText = h('span', {}, p.title);

  function collect() {
    for (const t of data.tops) { const r = refs.get(t.id); if (r && r.editor && r.editor.area.isConnected) t.body = r.editor.getHTML(); }
  }
  function persist(reason) {
    pending = false; saveSoon.cancel();
    if (!can('protocols.edit')) { saver.error('Nicht gespeichert – keine Berechtigung'); return false; }
    const fresh = db.find('protocols', p.id);
    if (!fresh || fresh.deletedAt || fresh.status === 'final') { saver.error('Nicht gespeichert – das Protokoll ist gesperrt'); return false; }
    collect();
    if (!firstSaveDone) { firstSaveDone = true; addVersion(p, initial, 'Stand beim Öffnen'); lastAutoVersion = Date.now(); }
    else if (Date.now() - lastAutoVersion > 5 * 60e3) { addVersion(p, data, 'Automatisch gemerkt'); lastAutoVersion = Date.now(); }
    const title = M.titleOf(data);
    const u = currentUser();
    db.update('protocols', p.id, { data: M.clone(data), body: M.toBodyHTML(data), title, date: data.date, kind: data.kind,
      attendees: M.present(data).map(x => x.name), updatedBy: u ? u.id : null,
      editors: uniq([...(fresh.editors || []), u && u.id].filter(Boolean)) });
    syncFileRef(p, data, 'draft');
    titleText.textContent = title; ctx.setTitle(title);
    if (reason || Date.now() - lastLog > 60e3) { log('protocol.update', `Protokoll „${title}“`, reason || 'Automatisch gespeichert'); lastLog = Date.now(); }
    saver.saved(new Date()); lastSavedAt = Date.now();
    window.__kolpingDirty = false;
    return true;
  }
  const saveSoon = debounce(() => { firstChangeAt = 0; if (alive) persist(); }, 900);
  let firstChangeAt = 0;   // spätestens alle 3 s wirklich speichern – auch wenn ununterbrochen getippt wird
  let lastSavedAt = 0, remoteTyping = false;
  function changed() {
    if (!alive) return; pending = true; window.__kolpingDirty = true;
    // Nur EIGENE Eingaben zeigen kurz „Wird gespeichert …“; „✓ Gespeichert um …“ bleibt mindestens 2 s stehen.
    if (!remoteTyping && Date.now() - lastSavedAt > 2000) saver.saving();
    saveSoon();
    const now = Date.now();
    if (!firstChangeAt) firstChangeAt = now;
    else if (now - firstChangeAt > 3000) { firstChangeAt = 0; persist(); }
  }

  /* ---------- Live-Leiste ---------- */
  const live = { on: !!prefsStore.get('protokolle.live', true), ctrl: null };
  const petraStatus = h('span', { class: 'protokolle-live__status' }, 'öffnet das Protokoll …');
  const petraBox = h('div', { class: 'protokolle-live__person protokolle-live__person--remote', style: { '--pc': PETRA.color } },
    h('span', { class: 'protokolle-live__av' }, avatar(PETRA, { size: 44 })),
    h('span', { class: 'protokolle-live__text' }, h('b', {}, PETRA.name), petraStatus));
  const meBox = h('div', { class: 'protokolle-live__person' },
    h('span', { class: 'protokolle-live__av' }, avatar(me, { size: 44 })),
    h('span', { class: 'protokolle-live__text' }, h('b', {}, `${me ? me.name : 'Sie'} (Sie)`), h('span', { class: 'protokolle-live__status' }, 'schreiben gerade')));
  const liveAnnounce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const jumpBtn = button({ label: 'Zu Petra springen', icon: '👁', onClick: () => {
    const t = el.querySelector('.protokolle-caret, .protokolle-top.is-remote, .protokolle-decision.is-remote');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } });
  jumpBtn.hidden = true;
  const toggleBtn = button({ label: '', icon: '🎭', attrs: { class: 'protokolle-live__toggle' }, onClick: () => {
    live.on = !live.on; prefsStore.set('protokolle.live', live.on); updateToggle();
    if (live.on) { liveStart(); toast('Live-Demo an: Petra schreibt gleich mit.', { type: 'info', icon: '🎭' }); }
    else { liveStop(); petraBox.hidden = true; toast('Live-Demo aus: Sie schreiben allein.', { type: 'info', icon: '🎭' }); }
  } });
  const updateToggle = () => {
    toggleBtn.setAttribute('aria-pressed', String(live.on));
    toggleBtn.querySelector('.btn__label').textContent = live.on ? 'Live-Demo: an' : 'Live-Demo: aus';
  };
  updateToggle();
  const liveBar = h('section', { class: 'protokolle-live', 'aria-label': 'Wer schreibt gerade mit?' },
    h('div', { class: 'protokolle-live__people' },
      h('span', { class: 'protokolle-live__h' }, h('span', { class: 'protokolle-live__dot', 'aria-hidden': 'true' }), 'Gerade im Protokoll:'),
      meBox, petraBox),
    h('div', { class: 'protokolle-live__tools' }, savers[0].el, jumpBtn, toggleBtn),
    liveAnnounce);

  function setPetra(text, { typing = false, announce = false } = {}) {
    petraStatus.textContent = text;
    petraBox.classList.toggle('is-typing', typing);
    if (announce) liveAnnounce.textContent = `${PETRA.name} ${text}`;
  }
  function showOnTop(top, text) {
    for (const r of refs.values()) { r.presence.hidden = true; r.card.classList.remove('is-remote'); }
    const r = top && refs.get(top.id); if (!r) return;
    r.presence.hidden = false; r.presence.querySelector('.protokolle-top__ptext').textContent = text;
    r.card.classList.add('is-remote');
  }
  function clearPresence() {
    for (const r of refs.values()) {
      r.presence.hidden = true; r.card.classList.remove('is-remote');
      for (const dr of r.decisions.values()) dr.box.classList.remove('is-remote');
    }
  }
  const topNo = top => data.tops.indexOf(top) + 1;
  const userIsIn = (node) => node && node.contains(document.activeElement);

  async function waitUntilFree(getNode, signal) {
    for (let i = 0; i < 12; i++) { if (!userIsIn(getNode())) return true; await L.sleep(1500, signal); }
    return false;
  }
  function typingPlan() {
    const texts = {
      'pr-1': { topId: 't-p1-3', text: 'Ergebnis der Vorstellung: Die Verwaltung soll so einfach sein, dass alle sie ohne Schulung bedienen können. Ein Probelauf mit drei Mitgliedern ist für November geplant.' },
    };
    let plan = texts[p.id];
    if (plan && !data.tops.some(t => t.id === plan.topId)) plan = null;
    if (!plan) {
      const generic = {
        vorstand: 'Bis zur nächsten Sitzung klären, wer die Adventsfeier vorbereitet.',
        mitgliederversammlung: 'Die Anwesenheitsliste liegt dem Protokoll bei.',
        sonstige: 'Die Ergebnisse werden in der nächsten Vorstandssitzung vorgestellt.',
      };
      const top = data.tops[data.tops.length - 1];
      if (!top) return null;
      plan = { topId: top.id, text: generic[data.kind] || generic.sonstige };
    }
    const top = data.tops.find(t => t.id === plan.topId);
    const r = refs.get(plan.topId);
    const already = stripHTML(r ? r.editor.getHTML() : top.body).includes(plan.text.slice(0, 40));
    return already ? null : { ...plan, top };
  }

  // Aus dem Demo-Rundgang geöffnet (?live=1): automatisch dorthin scrollen, wo Petra gerade ist –
  // aber nur, solange die Person nicht selbst etwas tippt.
  const followMode = !!(ctx.query && ctx.query.live);
  function follow(node) {
    if (!followMode || !node || !node.isConnected) return;
    const a = document.activeElement;
    if (a && a !== document.body && el.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName))) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function runScript(signal) {
    await L.sleep(2500, signal);
    setPetra('liest mit');
    // 1) Cursor taucht in einem Tagesordnungspunkt auf
    const readTop = data.tops[Math.min(1, data.tops.length - 1)];
    const rr = readTop && refs.get(readTop.id);
    if (rr) {
      L.placeCaretAtEnd(rr.editor.area, PETRA);
      showOnTop(readTop, 'Petra liest hier');
      follow(rr.card);
      setPetra(`liest gerade TOP ${topNo(readTop)}`, { announce: true });
      jumpBtn.hidden = false;
      await L.sleep(3500, signal);
      L.removeCarets(rr.editor.area);
    }
    // 2) Petra tippt Text in einen TOP
    const plan = typingPlan();
    if (plan) {
      const free = await waitUntilFree(() => refs.get(plan.topId)?.card, signal);
      const r = refs.get(plan.topId);
      if (free && r) {
        const n = topNo(plan.top);
        showOnTop(plan.top, 'Petra schreibt hier …');
        setPetra(`schreibt gerade in TOP ${n} …`, { typing: true, announce: true });
        jumpBtn.hidden = false;
        follow(r.card);
        remoteTyping = true;
        try { await L.typeInto(r.editor.area, plan.text, PETRA, { signal, onTick: changed }); } finally { remoteTyping = false; }
        clearPresence();
        setPetra(`hat TOP ${n} ergänzt`, { announce: true });
        collect(); persist(`${PETRA.name} (simuliert) hat TOP ${n} ergänzt`);
        addVersion(p, data, `Ergänzung in TOP ${n}`, { by: null, byName: PETRA.name });
        refreshVersions();
        await L.sleep(3500, signal);
      }
    }
    // 3) Petra trägt ein Abstimmungsergebnis ein
    const topWithOpen = data.tops.find(t => t.decisions.some(d => M.voteResult(d).state === 'open'));
    if (topWithOpen) {
      const dec = topWithOpen.decisions.find(d => M.voteResult(d).state === 'open');
      const r = refs.get(topWithOpen.id);
      const dr = r && r.decisions.get(dec.id);
      if (dr) {
        const free = await waitUntilFree(() => dr.box, signal);
        if (free) {
          const n = topNo(topWithOpen);
          const cnt = Math.max(1, M.present(data).length);
          const vals = cnt > 2 ? [cnt - 1, 0, 1] : [cnt, 0, 0];
          dr.box.classList.add('is-remote');
          showOnTop(topWithOpen, 'Petra trägt das Ergebnis ein …');
          setPetra(`trägt in TOP ${n} das Abstimmungsergebnis ein …`, { typing: true, announce: true });
          jumpBtn.hidden = false;
          follow(dr.box);
          remoteTyping = true;
          try { await L.typeIntoInputs([{ input: dr.yes, value: vals[0] }, { input: dr.no, value: vals[1] }, { input: dr.abstain, value: vals[2] }], PETRA, { signal }); } finally { remoteTyping = false; }
          clearPresence();
          setPetra(`hat in TOP ${n} das Ergebnis eingetragen`, { announce: true });
          persist(`${PETRA.name} (simuliert) hat ein Abstimmungsergebnis eingetragen`);
          await L.sleep(3000, signal);
        }
      }
    }
    setPetra('liest mit');
    jumpBtn.hidden = true;
  }
  function liveStart() {
    liveStop();
    if (!live.on) { petraBox.hidden = true; return; }
    petraBox.hidden = false; setPetra('öffnet das Protokoll …');
    const ctrl = new AbortController(); live.ctrl = ctrl;
    runScript(ctrl.signal).catch(e => { if (!(e instanceof L.Aborted)) console.error(e); });
  }
  function liveStop() {
    if (live.ctrl) live.ctrl.abort();
    live.ctrl = null;
    L.removeCarets(el);
    clearPresence();
    jumpBtn.hidden = true;
    petraBox.classList.remove('is-typing');
  }

  /* ---------- Formular-Bausteine ---------- */
  function timeField(label, key, hint) {
    const f = field({ label, type: 'time-text', value: data[key] ? data[key] + ' Uhr' : '', hint, placeholder: 'z. B. 19:30', inputmode: 'text', optional: key === 'end' || key === 'nextTime' });
    f.input.addEventListener('input', () => { const t = parseTime(f.value()); if (t) { data[key] = t; changed(); } else if (!f.value()) { data[key] = ''; changed(); } });
    f.input.addEventListener('blur', () => {
      const v = f.value(); if (!v) return;
      const t = parseTime(v);
      if (!t) f.setError('Diese Uhrzeit verstehe ich nicht. Bitte so schreiben: 19:30 oder „19 Uhr“.');
      else { f.setValue(t + ' Uhr'); data[key] = t; }
    });
    return f;
  }
  function textField(label, key, { hint, placeholder, type = 'text', rows, optional } = {}) {
    const f = field({ label, type, value: data[key], hint, placeholder, rows, optional });
    f.input.addEventListener('input', () => { data[key] = f.value(); changed(); });
    return f;
  }

  /* ---------- Anwesenheit ---------- */
  const peopleList = h('ul', { class: 'protokolle-people' });
  const countEl = h('p', { class: 'protokolle-count', 'aria-live': 'polite' });
  const addPeopleWrap = h('div', { class: 'protokolle-addpeople' });
  function updateCount() {
    const pr = M.present(data).length, ex = M.excused(data).length, open = data.people.filter(x => !x.status).length;
    countEl.replaceChildren(h('b', {}, `${pr} anwesend`), ` · ${ex} entschuldigt`, open ? ` · ${open} noch nicht angekreuzt` : '');
  }
  function personRow(person) {
    const btns = {};
    const sync = () => { for (const [s, b] of Object.entries(btns)) b.setAttribute('aria-pressed', String(person.status === s)); };
    const isMe = me && person.userId === me.id;
    const row = h('li', { class: 'protokolle-person' },
      h('span', { class: 'protokolle-person__name' }, person.name, isMe ? h('span', { class: 'muted' }, ' (Sie)') : null),
      h('span', { class: 'protokolle-person__choices', role: 'group', 'aria-label': `${person.name}: anwesend, entschuldigt oder fehlt?` },
        ['present', 'excused', 'absent'].map(s => (btns[s] = h('button', { type: 'button', class: `protokolle-att protokolle-att--${s}`, 'aria-pressed': 'false',
          onclick: () => { person.status = person.status === s ? null : s; sync(); updateCount(); changed(); } },
          h('span', { 'aria-hidden': 'true' }, M.STATUS[s].icon), M.STATUS[s].label)))),
      person.added ? button({ label: 'Entfernen', icon: '✕', variant: 'ghost', onClick: () => {
        const i = data.people.indexOf(person); if (i < 0) return;
        data.people.splice(i, 1); renderPeople(); changed();
        toast(`${person.name} steht nicht mehr auf der Liste.`, { undo: () => { if (!alive) return; data.people.splice(i, 0, person); renderPeople(); changed(); } });
      } }) : null);
    sync();
    return row;
  }
  function renderPeople() {
    peopleList.replaceChildren(...data.people.map(personRow));
    updateCount();
    const others = M.otherUsers(data);
    const nameField = h('input', { type: 'text', id: 'prot-add-name', class: 'field__input', placeholder: 'Vorname Nachname', autocomplete: 'off' });
    const addByName = () => {
      const v = nameField.value.trim(); if (!v) { nameField.focus(); return; }
      data.people.push({ id: uid('pp'), name: v, status: 'present', added: true }); renderPeople(); changed();
      addPeopleWrap.querySelector('#prot-add-name')?.focus();
    };
    nameField.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addByName(); } });
    addPeopleWrap.replaceChildren(
      others.length ? h('div', { class: 'protokolle-addpeople__users' },
        h('p', { class: 'field__label' }, 'Weitere Person aus der Benutzerliste'),
        h('div', { class: 'chips' }, others.map(u => h('button', { type: 'button', class: 'chip protokolle-choice', onclick: () => {
          data.people.push({ id: 'pp-' + u.id, name: u.name, userId: u.id, status: 'present', added: true }); renderPeople(); changed();
        } }, h('span', { 'aria-hidden': 'true' }, '＋'), u.name)))) : null,
      h('div', { class: 'protokolle-addpeople__name' },
        h('label', { class: 'field__label', for: 'prot-add-name' }, 'Andere Person hinzufügen'),
        h('div', { class: 'protokolle-inline' }, nameField, button({ label: 'Hinzufügen', icon: '＋', onClick: addByName }))));
  }

  /* ---------- Tagesordnungspunkte ---------- */
  const topsWrap = h('div', { class: 'protokolle-tops' });
  function decisionEl(t, dec, n, j, r) {
    const fText = field({ label: `Beschluss ${n}.${j + 1}`, type: 'textarea', rows: 2, value: dec.text,
      hint: 'Kurz und eindeutig, z. B. „Der Kostenbeitrag beträgt 5 € pro Person.“' });
    fText.input.addEventListener('input', () => { dec.text = fText.value(); changed(); });
    const resultId = uid('vr');
    const result = h('p', { class: 'protokolle-vote__result', id: resultId, role: 'status' });
    const updateResult = () => {
      const res = M.voteResult(dec);
      result.className = `protokolle-vote__result protokolle-vote__result--${res.state}`;
      result.textContent = res.state === 'open' ? 'Noch kein Ergebnis eingetragen' : (res.state === 'ok' ? '✓ ' : '✕ ') + res.text;
    };
    const mk = (key, label) => {
      const id = uid('v');
      const inp = h('input', { id, type: 'text', inputmode: 'numeric', class: 'protokolle-vote__input', autocomplete: 'off', 'aria-describedby': resultId });
      inp.value = dec[key] ?? '';
      inp.addEventListener('input', () => { const clean = inp.value.replace(/\D/g, '').slice(0, 4); if (clean !== inp.value) inp.value = clean; dec[key] = clean; updateResult(); changed(); });
      return { inp, el: h('div', { class: `protokolle-vote__f protokolle-vote__f--${key}` }, h('label', { for: id }, label), inp) };
    };
    const yes = mk('yes', 'Ja'), no = mk('no', 'Nein'), abst = mk('abstain', 'Enthaltung');
    updateResult();
    const box = h('div', { class: 'protokolle-decision', style: { '--pc': PETRA.color } },
      fText.el,
      h('fieldset', { class: 'protokolle-vote' },
        h('legend', {}, 'Abstimmungsergebnis'),
        h('div', { class: 'protokolle-vote__row' }, yes.el, no.el, abst.el,
          button({ label: 'Einstimmig', icon: '✓', attrs: { class: 'protokolle-vote__uni' }, onClick: () => {
            const c = M.present(data).length || 1;
            dec.yes = String(c); dec.no = '0'; dec.abstain = '0';
            yes.inp.value = dec.yes; no.inp.value = '0'; abst.inp.value = '0'; updateResult(); changed();
          } })),
        h('p', { class: 'field__hint' }, '„Einstimmig“ trägt alle Anwesenden als Ja-Stimmen ein.'),
        result),
      h('p', { class: 'protokolle-decision__tools' }, button({ label: 'Beschluss entfernen', icon: '✕', variant: 'ghost', onClick: () => {
        collect();
        const i = t.decisions.indexOf(dec); if (i < 0) return;
        t.decisions.splice(i, 1); renderTops(); changed();
        toast('Beschluss entfernt.', { undo: () => { if (!alive) return; t.decisions.splice(i, 0, dec); renderTops(); changed(); } });
      } })));
    r.decisions.set(dec.id, { box, yes: yes.inp, no: no.inp, abstain: abst.inp });
    return box;
  }
  function topCard(t, i) {
    const n = i + 1;
    const presence = h('span', { class: 'protokolle-top__presence', hidden: true, style: { '--pc': PETRA.color } },
      avatar(PETRA, { size: 30 }), h('span', { class: 'protokolle-top__ptext' }, 'Petra schreibt hier …'));
    const fTitle = field({ label: `Überschrift von TOP ${n}`, value: t.title, placeholder: 'z. B. Planung der Adventsfeier' });
    fTitle.input.addEventListener('input', () => { t.title = fTitle.value(); changed(); });
    fTitle.input.dataset.topTitle = t.id;
    const edWrap = h('div', { class: 'protokolle-top__editor' });
    const r = { card: null, editor: null, presence, decisions: new Map() };
    const decWrap = h('div', { class: 'protokolle-top__decisions' });
    const move = (dir) => {
      collect();
      const a = data.tops.indexOf(t), b = a + dir;
      if (b < 0 || b >= data.tops.length) return;
      [data.tops[a], data.tops[b]] = [data.tops[b], data.tops[a]];
      renderTops(); changed();
      const btn = topsWrap.querySelector(`#top-${t.id} [data-move="${dir}"]`) || topsWrap.querySelector(`#top-${t.id} [data-move="${-dir}"]`);
      if (btn) btn.focus(); else topsWrap.querySelector(`#top-${t.id}`)?.scrollIntoView({ block: 'center' });
      toast(`TOP „${shorten(t.title, 40)}“ ist jetzt TOP ${b + 1}.`, { type: 'info', icon: dir < 0 ? '↑' : '↓' });
    };
    const up = button({ label: 'Nach oben', icon: '↑', attrs: { 'data-move': '-1' }, disabled: i === 0, onClick: () => move(-1) });
    const down = button({ label: 'Nach unten', icon: '↓', attrs: { 'data-move': '1' }, disabled: i === data.tops.length - 1, onClick: () => move(1) });
    const card = h('section', { class: 'protokolle-top', id: `top-${t.id}`, 'aria-label': `Tagesordnungspunkt ${n}` },
      h('div', { class: 'protokolle-top__head' }, h('span', { class: 'protokolle-top__num' }, `TOP ${n}`), presence),
      fTitle.el,
      h('p', { class: 'field__label protokolle-top__label' }, 'Was wurde besprochen?'),
      h('p', { class: 'field__hint' }, 'Stichworte reichen. Fett und Liste finden Sie in der Leiste über dem Text.'),
      edWrap,
      decWrap,
      h('div', { class: 'protokolle-top__tools' },
        button({ label: 'Beschluss hinzufügen', icon: '＋', onClick: () => {
          collect(); const d = M.newDecision(); t.decisions.push(d); renderTops(); changed();
          topsWrap.querySelector(`#top-${t.id} .protokolle-decision:last-of-type textarea`)?.focus();
        } }),
        h('span', { class: 'spacer' }),
        up, down,
        button({ label: 'TOP entfernen', icon: '🗑', variant: 'danger', onClick: () => {
          collect();
          const idx = data.tops.indexOf(t); if (idx < 0) return;
          data.tops.splice(idx, 1); renderTops(); changed();
          toast(`TOP „${shorten(t.title, 40)}“ entfernt.`, { undo: () => { if (!alive) return; data.tops.splice(idx, 0, t); renderTops(); changed(); } });
        } })));
    r.card = card;
    r.editor = createEditor(edWrap, { value: t.body, toolbar: ['bold', 'list', 'link', 'undo'], label: `Text zu TOP ${n}`,
      placeholder: 'Hier schreiben … z. B. wer berichtet hat und was vereinbart wurde.', onChange: () => changed() });
    refs.set(t.id, r);
    t.decisions.forEach((d, j) => decWrap.append(decisionEl(t, d, n, j, r)));
    return card;
  }
  function renderTops() {
    collect();
    if (live.ctrl) { L.removeCarets(topsWrap); }
    for (const r of refs.values()) r.editor && r.editor.destroy();
    refs.clear();
    topsWrap.replaceChildren(...(data.tops.length ? data.tops.map(topCard)
      : [emptyState({ icon: '📋', title: 'Noch keine Tagesordnungspunkte', text: 'Fügen Sie unten den ersten Punkt hinzu.' })]));
  }
  function addTop() {
    collect();
    const t = M.newTop('');
    const last = data.tops[data.tops.length - 1];
    const idx = last && /^verschiedenes$/i.test(last.title.trim()) ? data.tops.length - 1 : data.tops.length;
    data.tops.splice(idx, 0, t);
    renderTops(); changed();
    const inp = topsWrap.querySelector(`[data-top-title="${t.id}"]`);
    if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus({ preventScroll: true }); }
  }

  /* ---------- Abschließen ---------- */
  function finalize(fDate) {
    if (!can('protocols.approve')) { toast('Abschließen darf nur der Vorstand.', { type: 'error' }); return; }
    collect();
    if (!data.date) { fDate.setError('Bitte zuerst das Datum der Sitzung eintragen, z. B. 14.10.2026.'); fDate.input.focus(); return; }
    const gaps = [];
    if (!M.present(data).length) gaps.push('Niemand ist als „Anwesend“ angekreuzt.');
    const open = data.people.filter(x => !x.status).length;
    if (open) gaps.push(`${open === 1 ? '1 Person ist' : open + ' Personen sind'} weder als anwesend noch als entschuldigt angekreuzt.`);
    data.tops.forEach((t, i) => {
      if (!t.title.trim()) gaps.push(`TOP ${i + 1} hat keine Überschrift.`);
      t.decisions.forEach(d => { if (M.voteResult(d).state === 'open') gaps.push(`TOP ${i + 1}: Beim Beschluss „${shorten(d.text, 50)}“ fehlt das Abstimmungsergebnis.`); });
    });
    const doIt = () => {
      if (!alive) return;
      liveStop();
      if (!persist('Vor dem Abschließen gespeichert')) return;
      addVersion(p, data, 'Abgeschlossene Fassung');
      const u = currentUser();
      db.update('protocols', p.id, { status: 'final', approvedBy: u ? u.id : null, approvedAt: nowIso() });
      syncFileRef(p, data, 'final');
      log('protocol.approve', `Protokoll „${p.title}“`, 'abgeschlossen, Bearbeitung gesperrt');
      rerender();
      toast('Protokoll abgeschlossen und gesperrt. Jetzt können Sie es in der Ablage ablegen.', { undo: () => {
        db.update('protocols', p.id, { status: 'draft', approvedBy: null, approvedAt: null }); syncFileRef(p, M.getData(p), 'draft');
        log('protocol.update', `Protokoll „${p.title}“`, 'Abschließen rückgängig gemacht'); rerender();
      } });
    };
    if (!gaps.length) { doIt(); return; }
    modal({ title: 'Fast fertig – bitte kurz prüfen',
      body: h('div', { class: 'stack' },
        h('ul', { class: 'protokolle-gaps' }, gaps.map(g => h('li', {}, g))),
        h('p', {}, 'Sie können trotzdem abschließen. Danach ist das Protokoll gesperrt und kann nur noch zur Korrektur wieder geöffnet werden.')),
      actions: [{ label: 'Weiter bearbeiten', icon: '✎' }, { label: 'Trotzdem abschließen', icon: '✓', variant: 'primary', onClick: (c) => { c(); doIt(); } }] });
  }

  /* ---------- Versionen ---------- */
  const versionsSlot = h('div');
  function refreshVersions() {
    if (!alive) return;
    versionsSlot.replaceChildren(versionsCard(p, { editable: true, onRestore: restoreVersion, onSnapshot: () => {
      collect(); persist(); addVersion(p, data, 'Von Hand gemerkt'); refreshVersions();
      toast('Zwischenstand gemerkt. Sie finden ihn im Versionsverlauf.');
    } }));
  }
  function restoreVersion(v) {
    if (!can('protocols.edit') || !v.data) return;
    collect();
    const before = M.clone(data);
    addVersion(p, before, 'Vor dem Wiederherstellen');
    liveStop();
    data = M.getData({ data: v.data });
    build();
    persist(`Stand vom ${formatDateTime(v.at)} wiederhergestellt`);
    refreshVersions();
    setPetra('liest mit');
    toast(`Der Stand vom ${formatDateTime(v.at)} ist wiederhergestellt.`, { undo: () => {
      if (!alive) return;
      data = M.clone(before); build(); persist('Wiederherstellen rückgängig gemacht'); refreshVersions();
    } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Vorschau & Druck ---------- */
  const doPrint = () => { collect(); printProtocol(data, { status: 'draft' }, pdfTitle(data)); };
  const preview = () => { collect(); modal({ title: 'Vorschau: So sieht das Protokoll aus', body: protocolDoc(data, { status: 'draft' }), wide: true,
    actions: [{ label: 'Schließen' }, { label: 'Als PDF drucken', icon: '🖨', onClick: (c) => { c(); doPrint(); } }] }); };
  const onBefore = () => { collect(); ensurePrintRoot().innerHTML = protocolDocHTML(data, { status: 'draft' }); };
  window.addEventListener('beforeprint', onBefore);

  /* ---------- Seite aufbauen ---------- */
  function build() {
    const fDate = field({ label: 'Datum der Sitzung', type: 'date-text', value: data.date ? formatDate(data.date, 'short') : '',
      hint: 'Einfach tippen, z. B. „14.10.“, „14. Oktober“ oder „heute“.', placeholder: 'z. B. 14.10.2026', required: true });
    if (data.date) fDate.setOk(formatDate(data.date, 'long'));
    fDate.input.addEventListener('input', () => { const iso = parseMeetingDate(fDate.value()); fDate.setOk(''); if (iso) { data.date = iso; fDate.setOk(formatDate(iso, 'long')); changed(); } });
    fDate.input.addEventListener('blur', () => {
      const v = fDate.value();
      if (!v) { fDate.setError('Bitte das Datum der Sitzung eintragen, z. B. 14.10.2026.'); return; }
      const iso = parseMeetingDate(v);
      if (!iso) fDate.setError('Dieses Datum verstehe ich nicht. Bitte so schreiben: 14.10.2026 oder „14. Oktober“.');
      else { data.date = iso; fDate.setValue(formatDate(iso, 'short')); fDate.setOk(formatDate(iso, 'long')); }
    });
    const kindBtns = M.KINDS.map(k => h('button', { type: 'button', class: 'chip protokolle-choice', 'aria-pressed': String(data.kind === k.id),
      onclick: () => { data.kind = k.id; kindBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(M.KINDS[i].id === k.id))); changed(); } },
      h('span', { 'aria-hidden': 'true' }, k.icon), k.label));
    const fNext = field({ label: 'Datum der nächsten Sitzung', type: 'date-text', value: data.nextDate ? formatDate(data.nextDate, 'short') : '',
      hint: 'Zum Beispiel „11.11.“ oder „nächsten Mittwoch“.', optional: true, placeholder: 'z. B. 11.11.2026' });
    if (data.nextDate) fNext.setOk(formatDate(data.nextDate, 'long'));
    fNext.input.addEventListener('input', () => { const iso = parseDate(fNext.value()); fNext.setOk(''); if (iso) { data.nextDate = iso; fNext.setOk(formatDate(iso, 'long')); changed(); } else if (!fNext.value()) { data.nextDate = ''; changed(); } });
    fNext.input.addEventListener('blur', () => { const v = fNext.value(); if (v && !parseDate(v)) fNext.setError('Dieses Datum verstehe ich nicht. Bitte so schreiben: 11.11.2026.'); else if (data.nextDate) fNext.setValue(formatDate(data.nextDate, 'short')); });

    const page = h('div', { class: 'admin-page protokolle-page' },
      pageHeader({ title: titleText, back: BACK, badge: statusBadge(p) }),
      statusSteps(p, null),
      liveBar,
      live.on ? notice([h('strong', {}, 'Hinweis für die Vorführung: '),
        'Petra Vorstand ist simuliert. Im echten System sehen alle, die das Protokoll gleichzeitig offen haben, jede Änderung sofort – mit Namen und Farbe. Niemand muss warten, nichts wird überschrieben.'], 'demo', '🎭') : null,

      h('section', { class: 'admin-card protokolle-card', 'aria-labelledby': 'prot-s1' },
        h('h2', { id: 'prot-s1' }, h('span', { class: 'protokolle-card__n', 'aria-hidden': 'true' }, '1'), 'Sitzung'),
        h('div', { class: 'field' }, h('span', { class: 'field__label', id: 'prot-kind-l' }, 'Art der Sitzung'),
          h('div', { class: 'chips protokolle-choices', role: 'group', 'aria-labelledby': 'prot-kind-l' }, kindBtns)),
        h('div', { class: 'form-grid form-grid--2' },
          fDate.el,
          textField('Ort', 'place', { hint: 'Zum Beispiel „Pfarrheim, Gruppenraum“.' }).el,
          timeField('Beginn', 'start', 'Zum Beispiel „19:30“ oder „halb 8 abends“.').el,
          timeField('Ende', 'end', 'Kann auch später eingetragen werden.').el)),

      h('section', { class: 'admin-card protokolle-card', 'aria-labelledby': 'prot-s2' },
        h('div', { class: 'protokolle-card__head' },
          h('h2', { id: 'prot-s2' }, h('span', { class: 'protokolle-card__n', 'aria-hidden': 'true' }, '2'), 'Wer war da?'),
          button({ label: 'Alle übrigen als anwesend', icon: '✓', onClick: () => {
            const changedPeople = data.people.filter(x => !x.status);
            if (!changedPeople.length) { toast('Es sind schon alle angekreuzt.', { type: 'info' }); return; }
            changedPeople.forEach(x => { x.status = 'present'; }); renderPeople(); changed();
            toast(`${changedPeople.length} als anwesend angekreuzt.`, { undo: () => { if (!alive) return; changedPeople.forEach(x => { x.status = null; }); renderPeople(); changed(); } });
          } })),
        h('p', { class: 'field__hint' }, 'Tippen Sie bei jeder Person auf „Anwesend“, „Entschuldigt“ oder „Fehlt“. Nochmal tippen nimmt das Kreuz wieder weg.'),
        countEl, peopleList, addPeopleWrap,
        textField('Gäste und weitere Anwesende', 'others', { type: 'textarea', rows: 2, optional: true,
          hint: 'Zum Beispiel „62 Mitglieder laut Anwesenheitsliste“ oder Namen von Gästen.' }).el),

      h('section', { class: 'admin-card protokolle-card', 'aria-labelledby': 'prot-s3' },
        h('h2', { id: 'prot-s3' }, h('span', { class: 'protokolle-card__n', 'aria-hidden': 'true' }, '3'), 'Tagesordnung'),
        h('p', { class: 'field__hint' }, 'Jeder Punkt hat eine Überschrift, einen Text und – falls abgestimmt wurde – Beschlüsse mit Ergebnis. Die Nummern passen sich von selbst an.'),
        topsWrap,
        h('p', { class: 'protokolle-card__foot' }, button({ label: 'Tagesordnungspunkt hinzufügen', icon: '＋', onClick: addTop }))),

      h('section', { class: 'admin-card protokolle-card', 'aria-labelledby': 'prot-s4' },
        h('h2', { id: 'prot-s4' }, h('span', { class: 'protokolle-card__n', 'aria-hidden': 'true' }, '4'), 'Abschluss'),
        h('div', { class: 'form-grid form-grid--2' },
          fNext.el,
          timeField('Uhrzeit der nächsten Sitzung', 'nextTime', 'Zum Beispiel „19:30“.').el),
        textField('Hinweis zur nächsten Sitzung', 'nextNote', { optional: true, hint: 'Zum Beispiel der Ort, falls er sich ändert.' }).el,
        textField('Schriftführung', 'recorder', { hint: 'Wer hat das Protokoll geschrieben? Steht unten im Dokument bei der Unterschrift.' }).el),

      versionsSlot,

      h('div', { class: 'form-actions protokolle-actions' },
        savers[1].el,
        h('span', { class: 'spacer' }),
        button({ label: 'Vorschau', icon: '👁', onClick: preview }),
        button({ label: 'Drucken', icon: '🖨', onClick: doPrint }),
        can('protocols.approve') ? button({ label: 'Protokoll abschließen', icon: '✓', variant: 'primary', size: 'lg', onClick: () => finalize(fDate) }) : null));

    for (const r of refs.values()) r.editor && r.editor.destroy();
    refs.clear();
    el.replaceChildren(page);
    renderPeople();
    renderTops();
    refreshVersions();
  }

  build();
  liveStart();

  return () => {
    alive = false;
    liveStop();
    if (pending) { saveSoon.cancel(); alive = true; persist(); alive = false; }
    for (const r of refs.values()) r.editor && r.editor.destroy();
    refs.clear();
    window.removeEventListener('beforeprint', onBefore);
    removePrintRoot();
    window.__kolpingDirty = false;
  };
}
