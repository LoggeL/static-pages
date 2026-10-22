// =========================================================
// modules/protokolle.js – Protokolle des Vorstands
// Liste · Neues Protokoll aus Vorlage · Editor mit (simulierter)
// Live-Zusammenarbeit, Autosave, Versionsverlauf, Abschließen,
// In Ablage ablegen (PDF-Eintrag) und Druck mit Kolping-Kopf.
// Rechte: protocols.view (lesen), protocols.edit (schreiben),
//         protocols.approve (abschließen), files.upload+files.board (ablegen)
// Regeln & API: siehe CONVENTIONS.md
// =========================================================
import { registerRoute, navigate, rerender } from '../app.js';
import { db, log, uid, userName, prefsStore, ACTION_LABELS } from '../store.js';
import { can, currentUser } from '../auth.js';
import { h, button, badge, toast, field, formatDate, relativeTime, pageHeader, emptyState,
  visibilityBadge, todayISO } from '../ui.js';
import { notice, registerHelp } from '../admin.js';
import * as M from './protokolle/model.js';
import { renderProtocol, parseMeetingDate, statusBadge } from './protokolle/editor.js';

// Lesbare Bezeichnungen im Änderungsprotokoll ergänzen (nur falls noch nicht vorhanden)
if (!ACTION_LABELS['protocol.delete']) ACTION_LABELS['protocol.delete'] = 'hat Protokoll gelöscht';

registerHelp('/admin/protokolle', { title: 'Protokolle', steps: [
  'Auf „Neues Protokoll schreiben“ tippen und eine Vorlage wählen – Tagesordnung und Anwesenheitsliste sind schon vorbereitet.',
  'Bei jeder Person „Anwesend“ oder „Entschuldigt“ antippen. Zu jedem Tagesordnungspunkt kurz aufschreiben, was besprochen wurde.',
  'Beschlüsse mit „Beschluss hinzufügen“ eintragen und die Stimmen zählen (oder „Einstimmig“ antippen).',
  'Alles wird automatisch gespeichert („✓ Gespeichert um …“). Andere aus dem Vorstand können gleichzeitig mitschreiben.',
  'Zum Schluss „Protokoll abschließen“ – dann ist es gesperrt. Mit „In Ablage ablegen“ landet es als PDF im Ordner des Vorstands.'],
  text: '<p>Ein früherer Stand fehlt? Unten im <strong>Versionsverlauf</strong> auf „Diesen Stand wiederherstellen“ tippen.</p>' });

/* ---------------------------------------------------------
   Liste
   --------------------------------------------------------- */
function protocolRow(p) {
  const d = M.getData(p);
  const final = p.status === 'final';
  const pdf = final ? M.pdfFileOf(p) : null;
  const liveOn = !!prefsStore.get('protokolle.live', true);
  const sub = final
    ? `Abgeschlossen am ${formatDate((p.approvedAt || p.updatedAt || '').slice(0, 10), 'short')}${p.approvedBy ? ' von ' + userName(p.approvedBy) : ''}`
    : `Entwurf · zuletzt geändert ${relativeTime(p.updatedAt)}${p.updatedBy ? ' von ' + userName(p.updatedBy) : ''}`;
  const u = currentUser();
  return h('li', { class: `admin-row protokolle-row${final ? '' : ' protokolle-row--draft'}` },
    h('span', { class: 'admin-row__icon', 'aria-hidden': 'true' }, final ? '📄' : '📝'),
    h('span', { class: 'admin-row__date' }, p.date ? formatDate(p.date, 'short') : '–'),
    h('span', { class: 'admin-row__main' },
      h('b', {}, p.title),
      h('span', { class: 'admin-row__sub' }, sub),
      h('span', { class: 'protokolle-row__badges' },
        statusBadge(p),
        final ? (pdf ? badge('In der Ablage', 'info', '📁') : badge('Noch nicht in der Ablage', 'neutral', '📁')) : null,
        !final && liveOn && can('protocols.edit') ? h('span', { class: 'protokolle-row__live', style: { '--pc': M.PETRA.color } },
          h('span', { class: 'protokolle-live__dot', 'aria-hidden': 'true' }), `${M.PETRA.name} schreibt mit`) : null,
        h('span', { class: 'muted protokolle-row__meta' }, `${d.tops.length} Tagesordnungspunkte · ${M.present(d).length} anwesend`))),
    h('span', { class: 'admin-row__actions' },
      final || !can('protocols.edit')
        ? button({ label: 'Ansehen', icon: '👁', href: `#/admin/protokolle/${p.id}` })
        : button({ label: 'Weiter schreiben', icon: '✎', href: `#/admin/protokolle/${p.id}` }),
      !final && can('protocols.edit') ? button({ label: 'In den Papierkorb', icon: '🗑', variant: 'danger', onClick: () => {
        if (!can('protocols.edit')) return;
        const label = `Protokoll „${p.title}“`;
        db.remove('protocols', p.id, { by: u ? u.id : null });
        const ref = p.fileId ? db.find('files', p.fileId) : null;
        const refTrashed = ref && ref.type === 'protocol' && !ref.deletedAt;
        if (refTrashed) db.remove('files', ref.id, { by: u ? u.id : null });
        log('protocol.delete', label, 'in den Papierkorb gelegt');
        rerender();
        toast('Das Protokoll liegt jetzt im Papierkorb.', { undo: () => {
          db.restore('protocols', p.id); if (refTrashed) db.restore('files', ref.id);
          log('trash.restore', label); rerender();
        } });
      } }) : null));
}

function renderList({ el }) {
  const all = db.all('protocols').slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const drafts = all.filter(p => p.status !== 'final');
  const finals = all.filter(p => p.status === 'final');
  el.replaceChildren(h('div', { class: 'admin-page protokolle-page' },
    pageHeader({ title: 'Protokolle', badge: visibilityBadge('board'),
      intro: 'Sitzungsprotokolle von Vorstand und Mitgliederversammlung – gemeinsam schreiben, abschließen und als PDF in der Ablage aufbewahren.',
      actions: can('protocols.edit') ? [button({ label: 'Neues Protokoll schreiben', icon: '＋', variant: 'primary', size: 'lg', href: '#/admin/protokolle/neu' })] : [] }),
    notice([h('strong', {}, 'Nur für den Vorstand. '), 'Protokolle sehen nur Vorstand und Administrator. Wer die Website pflegt (Redaktion), sieht diesen Bereich gar nicht.'], 'calm', '🔒'),
    h('section', { 'aria-labelledby': 'prot-drafts-h', class: 'stack' },
      h('h2', { id: 'prot-drafts-h' }, `In Arbeit (${drafts.length})`),
      drafts.length ? h('ul', { class: 'admin-list' }, drafts.map(protocolRow))
        : emptyState({ icon: '✅', title: 'Gerade ist kein Protokoll offen', text: 'Nach der nächsten Sitzung einfach „Neues Protokoll schreiben“ antippen.' })),
    h('section', { 'aria-labelledby': 'prot-final-h', class: 'stack' },
      h('h2', { id: 'prot-final-h' }, `Abgeschlossen (${finals.length})`),
      finals.length ? h('ul', { class: 'admin-list' }, finals.map(protocolRow))
        : emptyState({ icon: '📄', title: 'Noch keine abgeschlossenen Protokolle' })),
    h('p', { class: 'muted' }, 'Ältere Protokolle (als PDF) finden Sie in der Ablage unter „Vorstand › Protokolle 2025“.')));
}

/* ---------------------------------------------------------
   Neues Protokoll aus Vorlage
   --------------------------------------------------------- */
function renderNew({ el }) {
  let kindId = 'vorstand';
  const cards = M.KINDS.map(k => h('button', { type: 'button', class: 'protokolle-tpl', 'aria-pressed': String(k.id === kindId),
    onclick: () => { kindId = k.id; cards.forEach((c, i) => c.setAttribute('aria-pressed', String(M.KINDS[i].id === kindId))); } },
    h('span', { class: 'protokolle-tpl__icon', 'aria-hidden': 'true' }, k.icon),
    h('span', { class: 'protokolle-tpl__title' }, k.label),
    h('span', { class: 'protokolle-tpl__text' }, k.text),
    h('span', { class: 'protokolle-tpl__tops' }, h('b', {}, 'Tagesordnung: '), k.tops.join(' · ')),
    h('span', { class: 'protokolle-tpl__check', 'aria-hidden': 'true' }, '✓ Ausgewählt')));
  const fDate = field({ label: 'Datum der Sitzung', type: 'date-text', value: formatDate(todayISO(), 'short'), required: true,
    hint: 'Einfach tippen, z. B. „heute“, „14.10.“ oder „14. Oktober“.' });
  fDate.setOk(formatDate(todayISO(), 'long'));
  fDate.input.addEventListener('input', () => { const iso = parseMeetingDate(fDate.value()); fDate.setOk(iso ? formatDate(iso, 'long') : ''); });
  const create = () => {
    if (!can('protocols.edit')) { toast('Protokolle schreiben darf nur der Vorstand.', { type: 'error' }); return; }
    const v = fDate.value();
    const iso = parseMeetingDate(v);
    if (!v) { fDate.setError('Bitte das Datum der Sitzung eintragen, z. B. 14.10.2026.'); fDate.input.focus(); return; }
    if (!iso) { fDate.setError('Dieses Datum verstehe ich nicht. Bitte so schreiben: 14.10.2026 oder „14. Oktober“.'); fDate.input.focus(); return; }
    const u = currentUser();
    const data = M.templateData(kindId, iso);
    const title = M.titleOf(data);
    const id = uid('pr');
    let fileId = null, where = '';
    const folder = can('files.upload') && can('files.board') ? M.yearFolder(iso.slice(0, 4), { create: true }) : null;
    if (folder) {
      const ref = db.insert('files', { id: uid('d'), folderId: folder.id, name: `${M.kindLabel(kindId)} ${iso} (Entwurf)`, type: 'protocol', size: 0,
        originalSize: null, protocolId: id, note: 'Online-Protokoll (wird gemeinsam geschrieben)', uploadedBy: u ? u.id : null });
      fileId = ref.id; where = M.folderLabel(folder.id);
    }
    db.insert('protocols', { id, title, date: iso, kind: kindId, folderId: folder ? folder.id : null, fileId, status: 'draft',
      author: u ? u.id : null, editors: u ? [u.id] : [], attendees: M.present(data).map(x => x.name),
      data, body: M.toBodyHTML(data), updatedBy: u ? u.id : null, versions: [] });
    log('protocol.create', `Protokoll „${title}“`, `Vorlage „${M.kindLabel(kindId)}“${where ? ' · Verweis in ' + where : ''}`);
    navigate(`#/admin/protokolle/${id}`, { replace: true });
    toast('Die Vorlage ist offen. Alles wird automatisch gespeichert.');
  };
  el.replaceChildren(h('div', { class: 'admin-page protokolle-page' },
    pageHeader({ title: 'Protokoll schreiben', back: { href: '#/admin/protokolle', label: 'Zurück zu allen Protokollen' },
      intro: 'Wählen Sie eine Vorlage. Tagesordnung, Anwesenheitsliste und Unterschrift sind schon vorbereitet – Sie füllen nur noch aus.' }),
    h('section', { class: 'admin-card protokolle-card', 'aria-labelledby': 'prot-new-1' },
      h('h2', { id: 'prot-new-1' }, h('span', { class: 'protokolle-card__n', 'aria-hidden': 'true' }, '1'), 'Welche Sitzung war es?'),
      h('div', { class: 'protokolle-tpls', role: 'group', 'aria-labelledby': 'prot-new-1' }, cards)),
    h('section', { class: 'admin-card protokolle-card', 'aria-labelledby': 'prot-new-2' },
      h('h2', { id: 'prot-new-2' }, h('span', { class: 'protokolle-card__n', 'aria-hidden': 'true' }, '2'), 'Wann war die Sitzung?'),
      h('div', { class: 'protokolle-narrow' }, fDate.el)),
    notice('Das neue Protokoll ist ein Entwurf und nur für den Vorstand sichtbar. Ein Verweis darauf erscheint in der Ablage unter „Vorstand › Protokolle“.', 'info', '🔒'),
    h('div', { class: 'form-actions' },
      button({ label: 'Abbrechen', icon: '←', variant: 'ghost', href: '#/admin/protokolle' }),
      h('span', { class: 'spacer' }),
      button({ label: 'Vorlage öffnen und losschreiben', icon: '✎', variant: 'primary', size: 'lg', onClick: create }))));
  fDate.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
}

registerRoute('/admin/protokolle', renderList, { permission: 'protocols.view', title: 'Protokolle' });
registerRoute('/admin/protokolle/neu', renderNew, { permission: 'protocols.edit', title: 'Protokoll schreiben' });
registerRoute('/admin/protokolle/:id', renderProtocol, { permission: 'protocols.view', title: 'Protokoll' });
