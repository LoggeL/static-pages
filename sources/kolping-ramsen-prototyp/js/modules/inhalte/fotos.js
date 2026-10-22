// =========================================================
// inhalte/fotos.js – Mediathek, „Fotos hochladen“ mit echter
// Verkleinerung im Browser, Alben für den Rückblick
// Routen: #/admin/fotos (?foto=<id>), /hochladen (?album=<id>), /album/:id
// Recht: site.media.upload. Hier erscheinen NUR Website-Fotos (db 'media'),
// niemals Dateien aus der Ablage (db 'files').
// =========================================================
import { registerRoute, navigate, rerender } from '../../app.js';
import { db, log, uid, userName, mediaById } from '../../store.js';
import { can, currentUser } from '../../auth.js';
import { h, button, badge, toast, modal, field, autosaveIndicator, debounce, parseDate, formatDate, formatDateTime,
  formatBytes, compressResult, pageHeader, emptyState, todayISO } from '../../ui.js';
import { demoPhotoFile, notice, trashItem } from '../../admin.js';
import { allowed, mImg, albumsOf, storePhoto, plural } from './common.js';

const PERM = 'site.media.upload';
const BACK = { href: '#/admin/fotos', label: 'Zurück zu den Fotos' };
const GB = 1024 ** 3, MB = 1024 ** 2;
/** Beispielwerte: Fotoarchiv der alten Website (im echten System aus dem Speicher gelesen) */
const ARCHIVE = { count: 2380, bytes: 405 * MB, original: 2.7 * GB, quota: 5 * GB };

const photos = () => db.all('media').slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
const albumsSorted = () => db.all('albums').slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
const albumPhotos = a => (a.media || []).map(id => mediaById(id)).filter(m => m && !m.deletedAt);

/* ---------------------------------------------------------
   Speicheranzeige
   --------------------------------------------------------- */
function storageBox() {
  const list = db.all('media');
  const used = list.reduce((s, m) => s + (m.size || 0) + (m.thumbSize || 0), 0);
  const orig = list.reduce((s, m) => s + (m.originalSize || m.size || 0), 0);
  const total = ARCHIVE.bytes + used;
  const pct = Math.max(1, Math.round(total / ARCHIVE.quota * 100));
  const saved = Math.max(0, orig - list.reduce((s, m) => s + (m.size || 0), 0));
  return h('section', { class: 'dash-box inhalte-storage', 'aria-labelledby': 'inh-st-h' },
    h('h2', { id: 'inh-st-h' }, 'Speicherplatz'),
    h('p', { class: 'inhalte-storage__big' }, h('strong', {}, `Website-Fotos: ${formatBytes(total)}`), ` von ${formatBytes(ARCHIVE.quota)} belegt`),
    h('div', { class: 'inhalte-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': `${pct} Prozent belegt` },
      h('span', { style: { width: pct + '%' } })),
    h('p', { class: 'inhalte-storage__txt' }, `${pct} % belegt – es ist noch sehr viel Platz. `,
      `Ohne automatisches Verkleinern wären es etwa ${formatBytes(ARCHIVE.original + orig)}.`),
    h('ul', { class: 'inhalte-stats' },
      h('li', {}, h('b', {}, String(list.length)), h('span', {}, 'Fotos in diesem Prototyp')),
      h('li', {}, h('b', {}, formatBytes(used)), h('span', {}, 'belegt (mit Vorschaubildern)')),
      h('li', {}, h('b', {}, formatBytes(saved)), h('span', {}, 'gespart durch Verkleinern'))),
    h('p', { class: 'muted inhalte-small' }, `Beispielwert: enthält das Fotoarchiv der alten Website (ca. ${ARCHIVE.count.toLocaleString('de-DE')} Fotos). Im echten System liegen die Fotos auf dem kleinen Vereins-Server.`));
}

/* ---------------------------------------------------------
   Foto ändern / beschreiben (Dialog)
   --------------------------------------------------------- */
function deletePhoto(m, after) {
  if (!allowed(PERM)) return;
  const covers = db.all('albums').filter(a => a.cover === m.id);
  db.remove('media', m.id, { by: currentUser() ? currentUser().id : null });
  const coverPatch = [];
  for (const a of covers) {
    const next = albumPhotos(a).find(x => x.id !== m.id);
    coverPatch.push([a.id, a.cover]);
    db.update('albums', a.id, { cover: next ? next.id : null });
  }
  const label = `Foto „${m.alt || m.originalName || 'ohne Beschreibung'}“`;
  log('media.delete', label, 'in den Papierkorb gelegt');
  toast('Das Foto liegt jetzt im Papierkorb.', { undo: () => {
    db.restore('media', m.id);
    for (const [aid, cov] of coverPatch) db.update('albums', aid, { cover: cov });
    log('trash.restore', label); after && after();
  } });
  after && after();
}

export function openPhotoDialog(m0, { onDone } = {}) {
  const id = m0.id;
  const ind = autosaveIndicator({ initial: null });
  let logged = false;
  const save = debounce((patch) => {
    if (!can(PERM)) { ind.error('Keine Berechtigung'); return; }
    db.update('media', id, patch); ind.saved(new Date());
    if (!logged) { log('media.update', `Foto „${patch.alt || m0.alt || m0.originalName}“`, 'Beschreibung geändert'); logged = true; }
  }, 600);
  const pending = {};
  const q = (k, v) => { pending[k] = v; ind.saving(); save({ ...pending }); };
  const fAlt = field({ label: 'Was ist auf dem Bild zu sehen?', value: m0.alt || '', optional: true,
    hint: 'Ein kurzer Satz genügt, z. B. „Die Kapelle beim Konzert in der Eistalhalle“. Das hilft Menschen, die schlecht sehen – und beim Suchen.' });
  fAlt.input.addEventListener('input', () => q('alt', fAlt.input.value.trim()));
  const fCap = field({ label: 'Bildunterschrift im Rückblick', value: m0.caption || '', optional: true,
    hint: 'Steht unter dem großen Bild. Leer lassen = wie oben.' });
  fCap.input.addEventListener('input', () => q('caption', fCap.input.value.trim()));

  const albumChips = h('div', { class: 'chips inhalte-chips', role: 'group', 'aria-labelledby': 'inh-pd-alb' });
  const drawChips = () => {
    albumChips.replaceChildren(...albumsSorted().map(a => {
      const on = (a.media || []).includes(id);
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), onclick: () => {
        if (!allowed(PERM)) return;
        const cur = db.find('albums', a.id);
        const list = on ? (cur.media || []).filter(x => x !== id) : [...(cur.media || []), id];
        const patch = { media: list };
        if (!on && !mediaById(cur.cover)) patch.cover = id;
        db.update('albums', a.id, patch);
        log('album.update', `Album „${a.title}“`, on ? 'Foto herausgenommen' : 'Foto hinzugefügt');
        ind.saved(new Date()); drawChips();
      } }, on ? '✓ ' : '', a.title);
    }));
  };
  drawChips();

  const m = mediaById(id);
  const info = h('dl', { class: 'inhalte-facts' },
    h('dt', {}, 'Größe jetzt'), h('dd', {}, formatBytes(m.size), m.width ? ` · ${m.width} × ${m.height} Pixel` : ''),
    m.originalSize ? [h('dt', {}, 'Vor dem Verkleinern'), h('dd', {}, formatBytes(m.originalSize), m.originalWidth ? ` · ${m.originalWidth} × ${m.originalHeight} Pixel` : '')] : null,
    h('dt', {}, 'Dateiname'), h('dd', {}, m.originalName || '–'),
    h('dt', {}, 'Hochgeladen'), h('dd', {}, `${formatDateTime(m.createdAt)}${m.uploadedBy ? ' von ' + userName(m.uploadedBy) : ''}`));

  const body = h('div', { class: 'inhalte-pd' },
    h('div', { class: 'inhalte-pd__img' }, mImg(id, { size: 'l', alt: '' })),
    h('div', { class: 'inhalte-pd__form' },
      fAlt.el, fCap.el,
      h('div', { class: 'field' }, h('span', { class: 'field__label', id: 'inh-pd-alb' }, 'In welchen Alben erscheint das Foto?'),
        h('div', { class: 'field__hint' }, 'Antippen zum An- oder Abwählen. Alben erscheinen im „Rückblick“ auf der Website.'), albumChips),
      info, h('p', {}, ind.el)));
  modal({ title: 'Foto beschreiben & ändern', body, wide: true,
    actions: [
      { label: 'Foto löschen', icon: '🗑', variant: 'danger', onClick: (c) => { save.flush({ ...pending }); c(); deletePhoto(mediaById(id), onDone); } },
      { label: 'Fertig', icon: '✓', variant: 'primary', onClick: (c) => c() },
    ],
    onClose: () => { if (Object.keys(pending).length) save.flush({ ...pending }); onDone && onDone(); } });
}

/* ---------------------------------------------------------
   Neues Album (kleiner Dialog)
   --------------------------------------------------------- */
function newAlbumDialog({ onCreated } = {}) {
  if (!allowed(PERM)) return;
  const fT = field({ label: 'Name des Albums', hint: 'z. B. „Kolpinggedenktag 2026“.', required: true });
  const fD = field({ label: 'Datum', type: 'date-text', value: formatDate(todayISO(), 'short'), hint: 'Wann war es? „7.12.“ oder „heute“ genügt.' });
  modal({ title: 'Neues Album anlegen', body: h('div', {}, fT.el, fD.el,
    h('p', { class: 'muted' }, 'Das Album erscheint im „Rückblick“, sobald Fotos darin sind.')),
  actions: [{ label: 'Abbrechen' }, { label: 'Album anlegen', icon: '＋', variant: 'primary', onClick: (close) => {
    const t = fT.value(); const d = parseDate(fD.value());
    if (!t) { fT.setError('Bitte einen Namen eintragen.'); fT.input.focus(); return; }
    if (!d) { fD.setError('Dieses Datum verstehe ich nicht. Bitte so: 7.12.2026'); fD.input.focus(); return; }
    const a = db.insert('albums', { id: uid('a'), title: t, date: d, cover: null, text: '', media: [] });
    log('album.create', `Album „${t}“`, formatDate(d, 'medium'));
    close(); toast(`Album „${t}“ angelegt.`);
    onCreated && onCreated(a);
  } }] });
}

/* ---------------------------------------------------------
   Mediathek
   --------------------------------------------------------- */
registerRoute('/admin/fotos', ({ el, query }) => {
  let show = 'alle';
  const highlight = query.foto || null;
  const draw = () => {
    const all = photos();
    const noAlt = all.filter(m => !m.alt);
    const noAlbum = all.filter(m => !albumsOf(m.id).length);
    const list = show === 'ohne-text' ? noAlt : show === 'ohne-album' ? noAlbum : all;
    const chip = (id, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(show === id), onclick: () => { show = id; draw(); } }, label);
    const albums = albumsSorted();
    el.replaceChildren(h('div', { class: 'admin-page inhalte' },
      pageHeader({ title: 'Fotos', intro: 'Alle Fotos der Website und die Alben im Rückblick. Fotos werden beim Hochladen automatisch verkleinert.',
        actions: [button({ label: 'Fotos hochladen', icon: '📷', variant: 'primary', size: 'lg', href: '#/admin/fotos/hochladen' })] }),
      can('files.view') ? notice(h('span', {}, h('strong', {}, 'Hinweis für die Vorführung: '), 'Hier erscheinen nur Fotos der Website. Dateien aus der Vorstands-Ablage tauchen nie auf – auch nicht im Foto-Auswahldialog beim Schreiben.'), 'demo', '🎭') : null,
      storageBox(),
      h('section', { 'aria-labelledby': 'inh-alb-h', class: 'stack' },
        h('div', { class: 'inhalte-sechead' }, h('h2', { id: 'inh-alb-h' }, `Alben im Rückblick (${albums.length})`),
          button({ label: 'Neues Album anlegen', icon: '＋', onClick: () => newAlbumDialog({ onCreated: (a) => navigate(`#/admin/fotos/album/${a.id}`) }) })),
        h('ul', { class: 'inhalte-albums' }, albums.map(a => {
          const n = albumPhotos(a).length;
          return h('li', { class: 'inhalte-album' },
            h('div', { class: 'inhalte-album__img' }, mImg(a.cover, { size: 's', alt: '' }) || mImg((a.media || [])[0], { size: 's', alt: '' }) || h('span', { class: 'inhalte-album__empty', 'aria-hidden': 'true' }, '🖼')),
            h('div', { class: 'inhalte-album__body' },
              h('b', {}, a.title), h('span', { class: 'muted' }, `${formatDate(a.date, 'monthYear')} · ${plural(n, 'Foto', 'Fotos')}`),
              h('div', { class: 'cluster' },
                button({ label: 'Album bearbeiten', icon: '✎', size: 'sm', href: `#/admin/fotos/album/${a.id}` }),
                n ? button({ label: 'Ansehen', icon: '🌐', size: 'sm', href: `#/rueckblick/${a.id}` }) : null)));
        }))),
      h('section', { 'aria-labelledby': 'inh-all-h', class: 'stack' },
        h('h2', { id: 'inh-all-h' }, `Alle Fotos (${all.length})`),
        h('div', { class: 'chips inhalte-chips', role: 'group', 'aria-label': 'Welche Fotos anzeigen?' },
          chip('alle', `Alle (${all.length})`), chip('ohne-text', `Noch ohne Beschreibung (${noAlt.length})`), chip('ohne-album', `In keinem Album (${noAlbum.length})`)),
        list.length ? h('ul', { class: 'inhalte-grid' }, list.map(m => photoCard(m, { highlight: m.id === highlight, redraw: draw })))
          : emptyState({ icon: '🖼', title: 'Keine Fotos in dieser Auswahl' }))));
    if (highlight) requestAnimationFrame(() => {
      const card = el.querySelector(`[data-photo="${CSS.escape(highlight)}"]`);
      if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); const b = card.querySelector('button'); b && b.focus({ preventScroll: true }); }
    });
  };
  draw();
}, { permission: PERM, title: 'Fotos' });

function photoCard(m, { highlight, redraw }) {
  const albums = albumsOf(m.id);
  return h('li', { class: `inhalte-photo${highlight ? ' inhalte-photo--hl' : ''}`, dataset: { photo: m.id } },
    h('div', { class: 'inhalte-photo__img' }, mImg(m.id, { size: 's', alt: '' })),
    h('div', { class: 'inhalte-photo__body' },
      m.alt ? h('b', { class: 'inhalte-photo__alt' }, m.alt) : h('span', { class: 'inhalte-photo__alt inhalte-photo__alt--none' }, 'Noch ohne Beschreibung'),
      h('span', { class: 'inhalte-photo__meta' }, formatBytes(m.size),
        m.originalSize && m.originalSize > m.size ? h('span', { class: 'muted' }, ` (vorher ${formatBytes(m.originalSize)})`) : null),
      albums.length ? h('span', { class: 'inhalte-photo__meta muted' }, '🖼 ', albums.map(a => a.title).join(', ')) : null,
      button({ label: m.alt ? 'Ändern' : 'Beschreiben', icon: '✎', size: 'sm', block: true, onClick: () => openPhotoDialog(m, { onDone: redraw }) })));
}

/* ---------------------------------------------------------
   Fotos hochladen
   --------------------------------------------------------- */
registerRoute('/admin/fotos/hochladen', ({ el, query }) => {
  // Vorschlag: das neueste Album – sonst landen Fotos nicht im „Rückblick“ auf der Website
  let albumId = query.album && db.find('albums', query.album) && !db.find('albums', query.album).deletedAt ? query.album
    : (query.album === 'keins' ? null : (albumsSorted()[0] || {}).id || null);
  const done = []; // {before, after}
  const queue = [];
  let running = false;
  let alive = true;
  const objectUrls = [];

  const albumChips = h('div', { class: 'chips inhalte-chips', role: 'group', 'aria-labelledby': 'inh-up-alb' });
  const drawAlbums = () => {
    const mk = (id, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(albumId === id), onclick: () => { albumId = id; drawAlbums(); } }, albumId === id ? '✓ ' : '', label);
    albumChips.replaceChildren(
      ...albumsSorted().map(a => mk(a.id, a.title)),
      mk(null, 'Kein Album – nur für Neuigkeiten und Seiten'),
      h('button', { type: 'button', class: 'chip inhalte-chip-new', onclick: () => newAlbumDialog({ onCreated: (a) => { albumId = a.id; drawAlbums(); } }) }, '＋ Neues Album'));
  };
  drawAlbums();

  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'inh-up-input', tabindex: '-1', 'aria-hidden': 'true',
    onchange: () => { addFiles([...input.files]); input.value = ''; } });
  const results = h('ol', { class: 'inhalte-up-list', 'aria-label': 'Hochgeladene Fotos' });
  const summary = h('div', { class: 'inhalte-up-sum', role: 'status', 'aria-live': 'polite', hidden: true });

  const drop = h('div', { class: 'inhalte-drop' },
    h('span', { class: 'inhalte-drop__icon', 'aria-hidden': 'true' }, '📷'),
    button({ label: 'Fotos auswählen', icon: '＋', variant: 'primary', size: 'lg', onClick: () => { if (allowed(PERM)) input.click(); } }),
    h('p', { class: 'inhalte-drop__txt' }, 'Auf dem iPad oder Handy öffnet sich Ihre Fotosammlung. Sie können mehrere Fotos auf einmal antippen.'),
    h('p', { class: 'muted inhalte-drop__txt' }, 'Am Computer können Sie Fotos auch einfach hierher ziehen.'),
    h('div', { class: 'inhalte-drop__demo' },
      button({ label: 'Beispielfoto vom Handy verwenden (IMG_2041.JPG)', icon: '🧪', onClick: async (e) => {
        if (!allowed(PERM)) return;
        const b = e.currentTarget; b.disabled = true;
        try { addFiles([await demoPhotoFile()]); } catch { toast('Das Beispielfoto konnte nicht geladen werden.', { type: 'error' }); }
        b.disabled = false;
      } }),
      h('span', { class: 'muted inhalte-small' }, 'Für die Vorführung ohne eigene Fotos: ein echtes Handyfoto (4032 × 3024 Pixel).')),
    input);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('inhalte-drop--over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('inhalte-drop--over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('inhalte-drop--over');
    if (!allowed(PERM)) return;
    addFiles([...(e.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)));
  });

  function addFiles(files) {
    if (!files.length) return;
    for (const f of files) queue.push({ file: f, row: makeRow(f) });
    drawSummary();
    run();
  }
  function makeRow(f) {
    let url = null; try { url = URL.createObjectURL(f); objectUrls.push(url); } catch { /* egal */ }
    const thumb = h('img', { class: 'inhalte-up__thumb', alt: '', src: url || 'img/kolping-logo.svg' });
    const stage = h('span', { class: 'inhalte-up__stage' }, 'Wartet …');
    const barIn = h('span', { style: { width: '4%' } });
    const bar = h('div', { class: 'inhalte-up__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '4', 'aria-label': `Fortschritt ${f.name}` }, barIn);
    const out = h('div', { class: 'inhalte-up__out' });
    const li = h('li', { class: 'inhalte-up' }, thumb,
      h('div', { class: 'inhalte-up__main' },
        h('div', { class: 'inhalte-up__head' }, h('b', {}, f.name), h('span', { class: 'muted' }, formatBytes(f.size))),
        stage, bar, out));
    results.prepend(li);
    return {
      li, thumb, out,
      setStage(text, pct) { stage.textContent = text; barIn.style.width = pct + '%'; bar.setAttribute('aria-valuenow', String(pct)); },
      fail(msg) { li.classList.add('inhalte-up--err'); stage.textContent = '⚠ ' + msg; bar.hidden = true; },
      ok() { li.classList.add('inhalte-up--ok'); bar.hidden = true; },
    };
  }
  async function run() {
    if (running) return; running = true;
    while (queue.length && alive) {
      const { file, row } = queue.shift();
      try {
        const { media, result } = await storePhoto(file, { albumId, onStage: (t, p) => row.setStage(t, p) });
        if (!alive) break;
        row.ok();
        row.setStage('✓ Fertig verkleinert und gespeichert', 100);
        row.thumb.src = media.thumb;
        done.push({ before: result.before, after: result.after });
        const fAlt = field({ label: 'Was ist auf dem Bild zu sehen?', optional: true,
          hint: 'Ein kurzer Satz genügt. Sie können das auch später machen.', placeholder: 'z. B. Kinder beim Kürbisschnitzen im Pfarrheim' });
        const savedNote = h('span', { class: 'inhalte-up__saved', role: 'status' });
        let altLogged = false;
        const saveAlt = debounce(() => {
          if (!can(PERM)) return;
          db.update('media', media.id, { alt: fAlt.input.value.trim() });
          savedNote.textContent = '✓ Beschreibung gespeichert';
          if (!altLogged) { log('media.update', `Foto „${file.name}“`, 'Beschreibung ergänzt'); altLogged = true; }
        }, 600);
        fAlt.input.addEventListener('input', () => { savedNote.textContent = ''; saveAlt(); });
        row.out.replaceChildren(
          compressResult(result),
          h('p', { class: 'inhalte-up__dims muted' }, result.width < result.originalWidth || result.height < result.originalHeight
            ? `Bildgröße vorher ${result.originalWidth} × ${result.originalHeight}, jetzt ${result.width} × ${result.height} Bildpunkte – scharf genug für jeden Bildschirm.`
            : 'Das Foto war schon klein genug.'),
          fAlt.el, savedNote);
      } catch (e) {
        row.fail(/HEIC|heic/.test(file.name) || /Bildformat/.test(e && e.message)
          ? 'Dieses Foto kann der Browser nicht öffnen. Tipp fürs iPad: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“.'
          : 'Das hat nicht geklappt. Bitte noch einmal versuchen – Ihre anderen Fotos sind nicht betroffen.');
      }
      drawSummary();
    }
    running = false;
    drawSummary();
  }
  function drawSummary() {
    const waiting = queue.length + (running ? 1 : 0);
    if (!done.length && !waiting) { summary.hidden = true; return; }
    summary.hidden = false;
    const before = done.reduce((s, d) => s + d.before, 0), after = done.reduce((s, d) => s + d.after, 0);
    const pct = before ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
    const a = albumId ? db.find('albums', albumId) : null;
    summary.replaceChildren(
      h('p', { class: 'inhalte-up-sum__big' },
        waiting ? h('span', {}, `⏳ ${plural(done.length, 'Foto', 'Fotos')} fertig, ${waiting} ${waiting === 1 ? 'wird' : 'werden'} noch verkleinert …`)
          : h('span', {}, `✓ Fertig! ${plural(done.length, 'Foto', 'Fotos')} hochgeladen${a ? ` ins Album „${a.title}“` : ''}.`)),
      done.length ? h('p', {}, `Vorher zusammen ${formatBytes(before)}, jetzt ${formatBytes(after)}. `, h('strong', {}, `Gespart: ${formatBytes(before - after)} (−${pct} %).`)) : null,
      !waiting && done.length && !a ? h('p', {}, 'Diese Fotos stehen in keinem Album. Sie können sie in Neuigkeiten und Seiten verwenden – im „Rückblick“ erscheinen sie erst, wenn Sie sie einem Album zuordnen.') : null,
      !waiting && done.length ? h('div', { class: 'cluster' },
        a ? button({ label: 'Im Rückblick auf der Website ansehen', icon: '🌐', variant: 'ok', href: `#/rueckblick/${a.id}` }) : null,
        a ? button({ label: 'Album bearbeiten', icon: '✎', href: `#/admin/fotos/album/${a.id}` }) : null,
        button({ label: 'Alle Fotos ansehen', icon: '🖼', href: '#/admin/fotos' })) : null);
  }

  el.replaceChildren(h('div', { class: 'admin-page inhalte' },
    pageHeader({ title: 'Fotos hochladen', back: BACK, intro: 'Fotos vom Tablet, Handy oder Computer. Sie werden automatisch verkleinert – so laden sie schnell und brauchen wenig Platz.' }),
    h('section', { class: 'admin-card stack', 'aria-labelledby': 'inh-up-alb' },
      h('h2', { class: 'inhalte-step', id: 'inh-up-alb' }, h('span', { class: 'inhalte-num', 'aria-hidden': 'true' }, '1'), 'In welches Album? ', h('span', { class: 'opt muted' }, '(freiwillig)')),
      h('p', { class: 'muted' }, 'Alben erscheinen im „Rückblick“ auf der Website. Vorgeschlagen ist das neueste Album – tippen Sie ein anderes an, wenn es woanders hingehört.'),
      albumChips),
    h('section', { class: 'stack', 'aria-labelledby': 'inh-up-2' },
      h('h2', { class: 'inhalte-step', id: 'inh-up-2' }, h('span', { class: 'inhalte-num', 'aria-hidden': 'true' }, '2'), 'Fotos auswählen'),
      drop),
    summary,
    results,
    notice(h('span', {}, h('strong', {}, 'Hinweis für die Vorführung: '), 'Die Verkleinerung passiert hier wirklich – im Browser auf höchstens 1600 Pixel als WebP. Im echten System prüft der Server das zusätzlich und entfernt Standort-Daten (GPS) aus den Fotos.'), 'demo', '🎭')));

  return () => { alive = false; queue.length = 0; setTimeout(() => objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch { /* egal */ } }), 1000); };
}, { permission: PERM, title: 'Fotos hochladen' });

/* ---------------------------------------------------------
   Album bearbeiten
   --------------------------------------------------------- */
function pickPhotosDialog(a, onAdd) {
  const chosen = new Set();
  const avail = photos().filter(m => !(a.media || []).includes(m.id));
  const countBtn = { el: null };
  const grid = h('div', { class: 'picker-grid' }, avail.map(m => {
    const b = h('button', { type: 'button', class: 'picker-item inhalte-pick', 'aria-pressed': 'false', onclick: () => {
      if (chosen.has(m.id)) chosen.delete(m.id); else chosen.add(m.id);
      b.setAttribute('aria-pressed', String(chosen.has(m.id)));
      if (countBtn.el) countBtn.el.querySelector('.btn__label').textContent = `Ausgewählte hinzufügen (${chosen.size})`;
    } },
    h('img', { src: m.thumb || m.src, alt: '' }),
    h('span', { class: 'picker-item__alt' }, m.alt || m.originalName || 'Foto'),
    h('span', { class: 'picker-item__size' }, formatBytes(m.size)),
    h('span', { class: 'inhalte-pick__mark', 'aria-hidden': 'true' }, '✓'));
    return b;
  }));
  const md = modal({ title: `Fotos zu „${a.title}“ hinzufügen`, wide: true,
    body: h('div', {}, h('p', {}, 'Tippen Sie die Fotos an, die ins Album sollen. Ein Häkchen zeigt die Auswahl.'), avail.length ? grid : emptyState({ icon: '🖼', title: 'Alle Fotos sind schon in diesem Album' })),
    actions: [{ label: 'Abbrechen' }, { label: 'Ausgewählte hinzufügen (0)', icon: '＋', variant: 'primary', onClick: (c) => { c(); if (chosen.size) onAdd([...chosen]); } }] });
  countBtn.el = md.el.querySelector('.modal__foot .btn:last-child');
}

registerRoute('/admin/fotos/album/:id', ({ el, params }) => {
  const a0 = db.find('albums', params.id);
  if (!a0 || a0.deletedAt) {
    el.replaceChildren(h('div', { class: 'admin-page' }, pageHeader({ title: 'Album nicht gefunden', back: BACK }),
      emptyState({ icon: '🖼', title: a0 ? 'Dieses Album liegt im Papierkorb' : 'Dieses Album gibt es nicht (mehr)',
        action: a0 ? button({ label: 'Wiederherstellen', icon: '↶', variant: 'primary', onClick: () => { if (!allowed(PERM)) return; db.restore('albums', a0.id); log('trash.restore', `Album „${a0.title}“`); rerender(); } }) : null })));
    return;
  }
  const id = a0.id;
  const cur = () => db.find('albums', id);
  const ind = autosaveIndicator(); ind.idle('✓ Alles gespeichert');
  let logged = false;
  const pending = {};
  const save = debounce(() => {
    if (!can(PERM)) { ind.error('Keine Berechtigung'); return; }
    db.update('albums', id, { ...pending }); ind.saved(new Date()); window.__kolpingDirty = false;
    if (!logged) { log('album.update', `Album „${cur().title}“`, 'Angaben geändert'); logged = true; }
  }, 700);
  const q = (k, v) => { pending[k] = v; window.__kolpingDirty = true; ind.saving(); save(); };

  const fT = field({ label: 'Name des Albums', value: a0.title, hint: 'Steht im Rückblick über den Fotos.' });
  fT.input.addEventListener('input', () => { const v = fT.value(); if (v) { fT.clearError(); q('title', v); } else fT.setError('Bitte einen Namen eintragen.'); });
  const fD = field({ label: 'Datum', type: 'date-text', value: formatDate(a0.date, 'short'), hint: 'Wann war es? z. B. „7.12.2025“.' });
  fD.setOk(formatDate(a0.date, 'medium'));
  fD.input.addEventListener('input', () => { const d = parseDate(fD.value()); if (d) { fD.clearError(); fD.setOk(formatDate(d, 'medium')); q('date', d); } else fD.setOk(''); });
  fD.input.addEventListener('blur', () => { if (!parseDate(fD.value())) fD.setError('Dieses Datum verstehe ich nicht. Bitte so eingeben: 7.12.2025'); });
  const fX = field({ label: 'Ein paar Sätze zum Album', type: 'textarea', rows: 3, value: a0.text || '', optional: true, hint: 'Erscheint im Rückblick über den Fotos.' });
  fX.input.addEventListener('input', () => q('text', fX.value()));

  const gridSlot = h('div');
  const headSlot = h('div');
  const drawGrid = () => {
    const a = cur(); const list = albumPhotos(a);
    headSlot.replaceChildren(h('div', { class: 'inhalte-sechead' },
      h('h2', { id: 'inh-ag-h' }, `Fotos in diesem Album (${list.length})`),
      h('div', { class: 'cluster' },
        button({ label: 'Fotos in dieses Album hochladen', icon: '📷', variant: 'primary', href: `#/admin/fotos/hochladen?album=${id}` }),
        button({ label: 'Vorhandene Fotos hinzufügen', icon: '＋', onClick: () => pickPhotosDialog(a, (ids) => {
          if (!allowed(PERM)) return;
          const c = cur(); const patch = { media: [...(c.media || []), ...ids] };
          if (!mediaById(c.cover) || mediaById(c.cover).deletedAt) patch.cover = ids[0];
          db.update('albums', id, patch);
          log('album.update', `Album „${c.title}“`, `${plural(ids.length, 'Foto', 'Fotos')} hinzugefügt`);
          toast(`${plural(ids.length, 'Foto', 'Fotos')} hinzugefügt.`); drawGrid();
        }) }))));
    gridSlot.replaceChildren(list.length ? h('ul', { class: 'inhalte-grid', 'aria-labelledby': 'inh-ag-h' }, list.map(m => {
      const isCover = a.cover === m.id;
      return h('li', { class: `inhalte-photo${isCover ? ' inhalte-photo--cover' : ''}` },
        h('div', { class: 'inhalte-photo__img' }, mImg(m.id, { size: 's', alt: '' }), isCover ? h('span', { class: 'inhalte-photo__flag' }, '★ Titelbild') : null),
        h('div', { class: 'inhalte-photo__body' },
          m.alt ? h('b', { class: 'inhalte-photo__alt' }, m.alt) : h('span', { class: 'inhalte-photo__alt inhalte-photo__alt--none' }, 'Noch ohne Beschreibung'),
          h('span', { class: 'inhalte-photo__meta' }, formatBytes(m.size)),
          h('div', { class: 'stack inhalte-photo__btns' },
            isCover ? null : button({ label: 'Als Titelbild', icon: '★', size: 'sm', block: true, onClick: () => {
              if (!allowed(PERM)) return;
              const old = cur().cover; db.update('albums', id, { cover: m.id });
              log('album.update', `Album „${cur().title}“`, 'Titelbild geändert');
              toast('Titelbild geändert.', { undo: () => { db.update('albums', id, { cover: old }); log('album.update', `Album „${cur().title}“`, 'Rückgängig gemacht: Titelbild'); drawGrid(); } }); drawGrid();
            } }),
            button({ label: m.alt ? 'Beschreibung ändern' : 'Beschreiben', icon: '✎', size: 'sm', block: true, onClick: () => openPhotoDialog(m, { onDone: drawGrid }) }),
            button({ label: 'Aus dem Album nehmen', icon: '−', size: 'sm', block: true, onClick: () => {
              if (!allowed(PERM)) return;
              const c = cur(); const before = { media: c.media.slice(), cover: c.cover };
              const rest = (c.media || []).filter(x => x !== m.id);
              db.update('albums', id, { media: rest, cover: c.cover === m.id ? (rest.find(x => mediaById(x) && !mediaById(x).deletedAt) || null) : c.cover });
              log('album.update', `Album „${c.title}“`, 'Foto herausgenommen');
              toast('Das Foto ist nicht mehr im Album. Es bleibt aber bei allen Fotos erhalten.', { undo: () => { db.update('albums', id, before); log('album.update', `Album „${c.title}“`, 'Rückgängig gemacht: Foto wieder im Album'); drawGrid(); } });
              drawGrid();
            } }))));
    })) : emptyState({ icon: '🖼', title: 'Noch keine Fotos im Album', text: 'Laden Sie neue Fotos hoch oder fügen Sie vorhandene hinzu.' }));
  };
  drawGrid();

  el.replaceChildren(h('div', { class: 'admin-page inhalte' },
    pageHeader({ title: `Album „${a0.title}“`, back: BACK }),
    notice(h('span', {}, 'Dieses Album steht im „Rückblick“ auf der Website. Änderungen erscheinen dort sofort. ',
      button({ label: 'Im Rückblick ansehen', icon: '🌐', size: 'sm', href: `#/rueckblick/${id}` })), 'ok', '✓'),
    h('div', { class: 'admin-card' }, h('div', { class: 'form-grid form-grid--2' }, fT.el, fD.el), fX.el, h('p', {}, ind.el)),
    h('section', { class: 'stack' }, headSlot, gridSlot),
    h('div', { class: 'cluster inhalte-danger-zone' },
      button({ label: 'Album löschen', icon: '🗑', variant: 'danger', onClick: () => {
        if (!allowed(PERM)) return;
        save.flush();
        trashItem('albums', id, `Album „${cur().title}“`); navigate('#/admin/fotos');
      } }),
      h('span', { class: 'muted' }, 'Die Fotos selbst bleiben erhalten. Das Album liegt 30 Tage im Papierkorb.'))));

  return () => { if (Object.keys(pending).length) save.flush(); window.__kolpingDirty = false; };
}, { permission: PERM, title: 'Album bearbeiten' });
