// =========================================================
// inhalte/neuigkeiten.js – Neuigkeiten: Liste, Vorlagen, Editor
// Routen: #/admin/neuigkeiten, /neu, /:id   (Recht: site.news.edit)
// =========================================================
import { registerRoute, navigate, rerender } from '../../app.js';
import { db, log, uid, userName } from '../../store.js';
import { can, currentUser, canSeeVisibility } from '../../auth.js';
import { h, esc, selectPlaceholderOnTap, button, tile, badge, toast, modal, field, parseDate, formatDate, todayISO, sanitizeHTML, stripHTML,
  createEditor, pageHeader, emptyState, relativeTime } from '../../ui.js';
import { mediaPicker, trashItem, notice } from '../../admin.js';
import { allowed, thumbOrIcon, working, hasPending, isLive, publishItem, uniqueSlug, placeholdersIn, versionsBox,
  saveWorking, openPreview, newsArticle, newsCardPreview, changedBy, stableSrc } from './common.js';
import { autosaver, statusBox, discardPending, imageChooser } from './editing.js';

const PERM = 'site.news.edit';
const BACK = { href: '#/admin/neuigkeiten', label: 'Zurück zu den Neuigkeiten' };
const publicHref = n => `#/aktuelles/${n.slug || n.id}`;

/* ---------------------------------------------------------
   Liste
   --------------------------------------------------------- */
registerRoute('/admin/neuigkeiten', ({ el, query }) => {
  let show = ['alle', 'website', 'entwurf'].includes(query.zeige) ? query.zeige : 'alle';
  const draw = () => {
    const all = db.all('news').slice().sort((a, b) => {
      // Entwürfe zuerst (die warten auf jemanden), dann nach Datum
      const da = a.status === 'draft' ? 1 : 0, dbb = b.status === 'draft' ? 1 : 0;
      return dbb - da || String(b.date).localeCompare(String(a.date));
    });
    const drafts = all.filter(n => !isLive('news', n));
    const lives = all.filter(n => isLive('news', n));
    const list = show === 'website' ? lives : show === 'entwurf' ? drafts : all;
    const deleted = db.all('news', { withDeleted: true }).filter(n => n.deletedAt);
    const chip = (id, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(show === id), onclick: () => { show = id; draw(); } }, label);
    el.replaceChildren(h('div', { class: 'admin-page inhalte' },
      pageHeader({ title: 'Neuigkeiten', intro: 'Berichte und Einladungen für die Website. Entwürfe sieht nur die Redaktion – erst „Auf der Website zeigen“ macht sie öffentlich.',
        actions: [button({ label: 'Neuigkeit schreiben', icon: '✎', variant: 'primary', size: 'lg', href: '#/admin/neuigkeiten/neu' })] }),
      h('div', { class: 'chips inhalte-chips', role: 'group', 'aria-label': 'Welche Neuigkeiten anzeigen?' },
        chip('alle', `Alle (${all.length})`), chip('website', `✓ Auf der Website (${lives.length})`), chip('entwurf', `✎ Entwürfe (${drafts.length})`)),
      list.length ? h('ul', { class: 'admin-list', 'aria-label': 'Neuigkeiten' }, list.map(n => newsRow(n, draw)))
        : emptyState({ icon: '📰', title: show === 'entwurf' ? 'Keine Entwürfe' : 'Noch keine Neuigkeiten', text: 'Mit „Neuigkeit schreiben“ legen Sie los – mit einer fertigen Vorlage.' }),
      deleted.length ? h('section', { class: 'dash-box' },
        h('h2', {}, `Kürzlich gelöscht (${deleted.length})`),
        h('p', { class: 'muted' }, 'Gelöschte Neuigkeiten liegen 30 Tage im Papierkorb und lassen sich mit einem Tipp zurückholen.'),
        h('ul', { class: 'admin-list' }, deleted.map(n => h('li', { class: 'admin-row' },
          thumbOrIcon(n.image, '🗑'),
          h('span', { class: 'admin-row__main' }, h('b', {}, n.title), h('span', { class: 'admin-row__sub' }, `gelöscht ${relativeTime(n.deletedAt)}${n.deletedBy ? ' von ' + userName(n.deletedBy) : ''}`)),
          h('span', { class: 'admin-row__actions' }, button({ label: 'Wiederherstellen', icon: '↶', onClick: () => {
            if (!allowed(PERM)) return;
            db.restore('news', n.id); log('trash.restore', `Neuigkeit „${n.title}“`); toast(`„${n.title}“ ist wieder da.`); draw();
          } })))) ),
        h('p', {}, button({ label: 'Zum Papierkorb', icon: '🗑', href: '#/admin/papierkorb' }))) : null));
  };
  draw();
}, { permission: PERM, title: 'Neuigkeiten' });

function newsRow(n, redraw) {
  const live = isLive('news', n);
  const pending = hasPending('news', n);
  const w = working('news', n);
  return h('li', { class: 'admin-row inhalte-row' },
    thumbOrIcon(w.image),
    h('span', { class: 'admin-row__main' },
      h('b', {}, w.title || '(ohne Überschrift)'),
      h('span', { class: 'admin-row__sub' }, `${formatDate(w.date, 'medium')} · ${changedBy(n)}`),
      h('span', { class: 'cluster inhalte-row__badges' },
        live ? badge('Auf der Website', 'ok', '✓') : badge('Entwurf – noch nicht sichtbar', 'draft', '✎'),
        pending ? badge('Änderungen noch nicht veröffentlicht', 'info', '✎') : null)),
    h('span', { class: 'admin-row__actions' },
      button({ label: live ? 'Bearbeiten' : 'Weiter schreiben', icon: '✎', href: `#/admin/neuigkeiten/${n.id}` }),
      live ? button({ label: 'Ansehen', icon: '🌐', href: publicHref(n) }) : null,
      button({ label: 'Löschen', icon: '🗑', variant: 'danger', onClick: () => { if (!allowed(PERM)) return; trashItem('news', n.id, `Neuigkeit „${n.title}“`); redraw(); } })));
}

/* ---------------------------------------------------------
   Neu: Vorlage wählen
   --------------------------------------------------------- */
const TEMPLATES = {
  einladung: {
    icon: '💌', title: 'Einladung (frei schreiben)', text: 'Zu etwas einladen, das noch nicht im Kalender steht.',
    make: () => ({
      title: '', titleHint: 'z. B. Einladung zum Kolpinggedenktag',
      teaser: 'Wir laden herzlich ein zu [Veranstaltung] am [Datum] im Pfarrheim.',
      body: '<p>Liebe Mitglieder, liebe Freunde der Kolpingsfamilie,</p><p>wir laden Sie herzlich ein zu [Veranstaltung].</p><h2>Das Wichtigste auf einen Blick</h2><ul><li><strong>Wann:</strong> [Datum und Uhrzeit]</li><li><strong>Wo:</strong> Pfarrheim Ramsen, Klosterhof 7</li><li><strong>Anmeldung:</strong> [bis wann und bei wem]</li></ul><p>Wir freuen uns auf Sie!</p>',
    }),
  },
  bericht: {
    icon: '📸', title: 'Bericht / Rückblick', text: 'Erzählen, wie es war – am besten mit Foto.',
    make: () => ({
      title: '', titleHint: 'z. B. Rückblick: So schön war das Pfarrfest',
      teaser: '[Ein Satz: Was war das Schönste?]',
      body: '<p>Am [Datum] trafen sich [wie viele] Mitglieder und Gäste zu [Veranstaltung].</p><h2>So war es</h2><p>[Ein paar Sätze, was passiert ist.]</p><p>Ein herzliches Dankeschön an alle Helferinnen und Helfer!</p>',
    }),
  },
  kurz: {
    icon: '📣', title: 'Kurze Mitteilung', text: 'Ein Hinweis in zwei, drei Sätzen.',
    make: () => ({ title: '', titleHint: 'z. B. Pfarrheim am 3. Oktober geschlossen', teaser: '', body: '<p>[Ihre Mitteilung]</p>' }),
  },
  leer: {
    icon: '📄', title: 'Leeres Blatt', text: 'Ohne Vorlage, ganz frei schreiben.',
    make: () => ({ title: '', teaser: '', body: '' }),
  },
};

function fromEvent(e) {
  const when = `${formatDate(e.date, 'long')}${e.time ? ', ' + e.time + ' Uhr' : ''}`;
  return {
    title: `Einladung: ${e.title}`,
    teaser: `Am ${when}${e.location ? ' – ' + e.location : ''}. Wir freuen uns auf Sie!`,
    body: `<p>Liebe Mitglieder, liebe Freunde der Kolpingsfamilie,</p><p>herzliche Einladung zu <strong>${esc(e.title)}</strong>!</p>${e.description ? sanitizeHTML(e.description) : ''}<h2>Das Wichtigste auf einen Blick</h2><ul><li><strong>Wann:</strong> ${esc(when)}</li>${e.location ? `<li><strong>Wo:</strong> ${esc(e.location)}</li>` : ''}</ul><p>Den Termin finden Sie auch im <a href="#/termine/${esc(e.id)}">Kalender auf der Website</a>.</p><p>Wir freuen uns auf Sie!</p>`,
    image: e.image || null,
    eventId: e.id,
  };
}

function createNews(data, how) {
  if (!allowed(PERM)) return;
  const u = currentUser();
  const n = db.insert('news', {
    id: uid('n'), slug: uniqueSlug(data.title || 'neuigkeit'), title: data.title || '', date: todayISO(),
    teaser: data.teaser || '', body: data.body || '', image: data.image || null, eventId: data.eventId || null, titleHint: data.titleHint || null,
    status: 'draft', author: u ? u.id : null, updatedBy: u ? u.id : null,
  });
  log('news.create', `Neuigkeit „${n.title && !/\[/.test(n.title) ? n.title : 'noch ohne Überschrift'}“`, `Vorlage: ${how}`);
  navigate(`#/admin/neuigkeiten/${n.id}`, { replace: true });
}

function upcomingEvents() {
  const today = todayISO();
  return db.all('events').filter(e => e.status !== 'draft' && (e.endDate || e.date) >= today && canSeeVisibility(e.visibility || 'public') && (e.visibility || 'public') === 'public')
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 8);
}

function pickEvent() {
  const evs = upcomingEvents();
  let m;
  const body = h('div', { class: 'stack' },
    h('p', {}, 'Tippen Sie auf den Termin – Datum, Uhrzeit, Ort und Beschreibung werden übernommen.'),
    h('ul', { class: 'admin-list inhalte-evpick' }, evs.map(e => h('li', {},
      h('button', { type: 'button', class: 'inhalte-evpick__btn', onclick: () => { m.close(); createNews(fromEvent(e), `Einladung zu Termin „${e.title}“`); } },
        h('span', { class: 'admin-row__date' }, formatDate(e.date, 'weekday')),
        h('span', { class: 'admin-row__main' }, h('b', {}, e.title), h('span', { class: 'admin-row__sub' }, [e.time ? e.time + ' Uhr' : 'ganztägig', e.location].filter(Boolean).join(' · '))),
        h('span', { 'aria-hidden': 'true', class: 'inhalte-evpick__go' }, '→'))))),
    !evs.length ? emptyState({ icon: '📅', title: 'Keine kommenden öffentlichen Termine' }) : null);
  m = modal({ title: 'Zu welchem Termin laden Sie ein?', body, wide: true,
    actions: [{ label: 'Ohne Termin – selbst ausfüllen', icon: '✎', onClick: (c) => { c(); createNews(TEMPLATES.einladung.make(), 'Einladung (frei schreiben)'); } }] });
}

registerRoute('/admin/neuigkeiten/neu', ({ el, query }) => {
  if (query.termin) {
    const e = db.find('events', query.termin);
    if (e && !e.deletedAt) { createNews(fromEvent(e), `Einladung zu Termin „${e.title}“`); return; }
  }
  const evs = upcomingEvents();
  el.replaceChildren(h('div', { class: 'admin-page inhalte' },
    pageHeader({ title: 'Neuigkeit schreiben', back: BACK, intro: 'Womit möchten Sie anfangen? Jede Vorlage lässt sich frei ändern. Nichts erscheint auf der Website, bevor Sie es ausdrücklich freigeben.' }),
    h('h2', { class: 'inhalte-step' }, h('span', { class: 'inhalte-num', 'aria-hidden': 'true' }, '1'), 'Vorlage wählen'),
    h('div', { class: 'tile-grid-admin' },
      evs.length ? tile({ icon: '📅', title: 'Aus einem Termin übernehmen', text: `Einladung mit Datum und Ort aus dem Kalender – z. B. ‚${evs[0].title}‘.`, color: '#eb6800', onClick: pickEvent }) : null,
      Object.entries(TEMPLATES).map(([id, t]) => tile({ icon: t.icon, title: t.title, text: t.text,
        color: { einladung: '#1d4ed8', bericht: '#15803d', kurz: '#6d28d9', leer: '#57534e' }[id],
        onClick: () => createNews(t.make(), t.title) }))),
    notice(h('span', {}, h('strong', {}, 'Tipp: '), 'Gelb markierte Stellen wie „[Datum]“ einmal antippen – dann sind sie ganz markiert und Sie schreiben einfach Ihren Text darüber. Vorher lässt sich die Neuigkeit nicht veröffentlichen – damit nichts Halbfertiges auf die Website kommt.'), 'calm', '💡')));
}, { permission: PERM, title: 'Neuigkeit schreiben' });

/* ---------------------------------------------------------
   Editor
   --------------------------------------------------------- */
registerRoute('/admin/neuigkeiten/:id', ({ el, params }) => {
  const n0 = db.find('news', params.id);
  if (!n0 || n0.deletedAt) {
    el.replaceChildren(h('div', { class: 'admin-page' }, pageHeader({ title: 'Neuigkeit nicht gefunden', back: BACK }),
      emptyState({ icon: '📰', title: n0 ? 'Diese Neuigkeit liegt im Papierkorb' : 'Diese Neuigkeit gibt es nicht (mehr)',
        action: n0 ? button({ label: 'Wiederherstellen', icon: '↶', variant: 'primary', onClick: () => { if (!allowed(PERM)) return; db.restore('news', n0.id); log('trash.restore', `Neuigkeit „${n0.title}“`); rerender(); } }) : null })));
    return;
  }
  const id = n0.id;
  const cur = () => db.find('news', id);
  let w = working('news', n0);

  const saver = autosaver('news', id, { onSaved: () => { w = working('news', cur()); refresh(); } });

  // --- Felder
  const fTitle = field({ label: 'Überschrift', value: w.title, required: true, placeholder: n0.titleHint || null,
    hint: 'Kurz und klar, z. B. „Lieblings-Weinprobe am 7. November“.' });
  selectPlaceholderOnTap(fTitle.input);
  fTitle.input.addEventListener('input', () => { saver.queue('title', fTitle.input.value.trim()); updateAddress(); });

  const fDate = field({ label: 'Datum der Neuigkeit', type: 'date-text', value: formatDate(w.date, 'short'), inputmode: 'text',
    hint: 'Steht über der Überschrift. Einfach tippen: „14.10.“, „3. November“ oder „heute“.' });
  fDate.setOk(formatDate(w.date, 'long'));
  const onDate = (strict) => {
    const v = fDate.value();
    const iso = parseDate(v);
    if (iso) { fDate.clearError(); fDate.setOk(formatDate(iso, 'long')); if (iso !== working('news', cur()).date) saver.queue('date', iso); return iso; }
    fDate.setOk('');
    if (strict) fDate.setError(v ? `„${v}“ verstehe ich nicht als Datum. Bitte so eingeben: 14.10. oder 14. Oktober.` : 'Bitte ein Datum eintragen, z. B. „heute“.');
    return null;
  };
  fDate.input.addEventListener('input', () => onDate(false));
  fDate.input.addEventListener('blur', () => onDate(true));

  const fTeaser = field({ label: 'Kurzer Vorspann', type: 'textarea', rows: 3, value: w.teaser, optional: true,
    hint: 'Ein bis zwei Sätze. Erscheint auf der Startseite unter der Überschrift. Leer lassen = Anfang des Textes.' });
  fTeaser.input.addEventListener('input', () => saver.queue('teaser', fTeaser.input.value.trim()));
  selectPlaceholderOnTap(fTeaser.input);

  const img = imageChooser({ value: w.image, label: 'Titelbild',
    hint: 'Das große Foto über dem Text. Sie wählen aus den Fotos der Website.',
    onChange: (mid) => { saver.queue('image', mid); saver.flush(); } });

  const editorWrap = h('div', { class: 'inhalte-editor-wrap' });
  const editorErr = h('div', { class: 'field__error', hidden: true, id: 'inh-ed-err' });
  const editor = createEditor(editorWrap, { value: w.body, label: 'Text der Neuigkeit', placeholder: 'Hier schreiben – wie in einem Brief …',
    onChange: (html) => { editorErr.hidden = true; saver.queue('body', html); },
    onImage: (insert) => mediaPicker({ title: 'Bild in den Text einfügen', allowUpload: can('site.media.upload'),
      onPick: async (m) => insert({ src: await stableSrc(m), alt: m.alt || '' }) }) });
  editor.area.setAttribute('aria-describedby', 'inh-ed-hint inh-ed-err');

  const address = h('code', { class: 'inhalte-address' });
  const updateAddress = () => {
    const n = cur();
    const slug = isLive('news', n) || n.publishedAt ? n.slug : uniqueSlug(fTitle.input.value.trim() || 'neuigkeit', id);
    address.textContent = `kolping-ramsen.de/aktuelles/${slug}`;
  };
  updateAddress();

  // --- Status + Aktionen (werden nach jeder Änderung neu gezeichnet)
  const statusSlot = h('div');
  const actionsSlot = h('div', { class: 'form-actions inhalte-actions' });
  const versionsSlot = h('div');

  function validate() {
    let ok = true; let first = null;
    const t = fTitle.value();
    if (!t) { fTitle.setError('Bitte eine Überschrift eintragen – zum Beispiel „Einladung zum Kolpinggedenktag“.'); ok = false; first = first || fTitle.input; }
    if (!onDate(true)) { ok = false; first = first || fDate.input; }
    const html = editor.getHTML();
    if (!stripHTML(html) && !/<img/i.test(html)) {
      editorErr.hidden = false; editorErr.textContent = 'Bitte noch ein paar Sätze schreiben – sonst ist die Neuigkeit leer.'; ok = false; first = first || editor.area;
    }
    const ph = placeholdersIn(t, fTeaser.value(), html);
    if (ph.length) {
      editorErr.hidden = false; editorErr.textContent = `Hier stehen noch Platzhalter aus der Vorlage: ${[...new Set(ph)].slice(0, 4).join(', ')}. Bitte durch Ihren Text ersetzen.`;
      if (placeholdersIn(t).length) fTitle.setError('In der Überschrift steht noch ein Platzhalter in eckigen Klammern.');
      ok = false; first = first || (placeholdersIn(t).length ? fTitle.input : editor.area);
    }
    if (!ok && first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast('Fast fertig – bitte die markierten Stellen ansehen.', { type: 'error' }); }
    return ok;
  }

  function publish() {
    if (!allowed(PERM)) return;
    saver.flush();
    if (!validate()) return;
    const wasLive = isLive('news', cur());
    const n = publishItem('news', id);
    toast(wasLive ? 'Die Änderungen stehen jetzt auf der Website.' : `„${n.title}“ steht jetzt auf der Website.`);
    rerender();
  }
  function unpublish() {
    if (!allowed(PERM)) return;
    saver.flush();
    const n = cur();
    const before = { status: n.status, pending: n.pending, ...working('news', n) };
    db.update('news', id, { ...working('news', n), pending: null, status: 'draft' });
    log('news.unpublish', `Neuigkeit „${n.title}“`, 'wieder Entwurf');
    toast('Die Neuigkeit ist nicht mehr auf der Website. Sie bleibt als Entwurf erhalten.', {
      undo: () => { db.update('news', id, { status: 'published', pending: before.pending }); log('news.publish', `Neuigkeit „${n.title}“`, 'Rückgängig: wieder auf der Website'); } });
    rerender();
  }
  function remove() {
    if (!allowed(PERM)) return;
    saver.flush();
    const n = cur();
    trashItem('news', id, `Neuigkeit „${working('news', n).title || 'ohne Überschrift'}“`);
    navigate('#/admin/neuigkeiten');
  }
  function preview() {
    saver.flush();
    const n = cur(); const ww = working('news', n);
    openPreview({
      address: `kolping-ramsen.de/aktuelles/${n.slug}`,
      note: isLive('news', n) && !hasPending('news', n) ? 'So steht die Neuigkeit gerade auf der Website.' : 'Nur Vorschau – Besucher sehen das erst nach „Auf der Website zeigen“.',
      render: () => newsArticle(ww),
      extra: h('div', { class: 'inhalte-pv__extra' }, h('h3', {}, 'So erscheint sie auf der Startseite und unter „Aktuelles“:'), newsCardPreview(ww)),
    });
  }

  function refresh() {
    const n = cur(); if (!n) return;
    const live = isLive('news', n), pending = hasPending('news', n);
    statusSlot.replaceChildren(statusBox('news', n, { publicHref: live ? publicHref(n) : null,
      onDiscard: () => discardPending('news', id, () => rerender()) }));
    const primary = !live
      ? button({ label: 'Auf der Website zeigen', icon: '✓', variant: 'ok', size: 'lg', onClick: publish })
      : pending ? button({ label: 'Änderungen auf der Website zeigen', icon: '✓', variant: 'ok', size: 'lg', onClick: publish })
        : button({ label: 'Auf der Website ansehen', icon: '🌐', variant: 'ok', size: 'lg', href: publicHref(n) });
    actionsSlot.replaceChildren(
      saver.indicator.el,
      h('span', { class: 'spacer' }),
      button({ label: 'Vorschau ansehen', icon: '👁', size: 'lg', onClick: preview }),
      primary);
    versionsSlot.replaceChildren(versionsBox('news', n, { onRestore: (v) => {
      if (!allowed(PERM)) return;
      saveWorking('news', id, v.data);
      log('news.update', `Neuigkeit „${v.data.title}“`, `frühere Fassung vom ${formatDate(String(v.at).slice(0, 10), 'short')} zurückgeholt`);
      toast('Die frühere Fassung ist geladen. Erst „Änderungen auf der Website zeigen“ macht sie öffentlich.');
      rerender();
    } }) || '');
  }
  refresh();

  const n = cur();
  el.replaceChildren(h('div', { class: 'admin-page inhalte inhalte-edit' },
    pageHeader({ title: isLive('news', n) ? 'Neuigkeit bearbeiten' : 'Neuigkeit schreiben', back: BACK }),
    statusSlot,
    h('div', { class: 'inhalte-edit__grid' },
      h('div', { class: 'inhalte-edit__main' },
        fTitle.el,
        // Webadresse nur für den Administrator (Redakteure müssen sich darum nicht kümmern – sie entsteht von selbst)
        can('users.manage') ? h('div', { class: 'form-grid form-grid--2' }, fDate.el, h('div', { class: 'field' },
          h('span', { class: 'field__label' }, 'Webadresse'),
          h('div', { class: 'field__hint' }, 'Wird automatisch aus der Überschrift erzeugt – müssen Sie nicht ändern.'), address)) : fDate.el,
        fTeaser.el,
        h('div', { class: 'field' },
          h('span', { class: 'field__label', id: 'inh-ed-label' }, 'Text'),
          h('div', { class: 'field__hint', id: 'inh-ed-hint' }, 'Schreiben Sie wie in einem Brief. Die Leiste darüber: Zwischenüberschrift, Fett, Liste, Link, Bild, Rückgängig. Aus Word Eingefügtes wird automatisch aufgeräumt.'),
          editorWrap, editorErr)),
      h('aside', { class: 'inhalte-edit__aside', 'aria-label': 'Titelbild und Löschen' },
        h('div', { class: 'admin-card' }, img.el),
        h('div', { class: 'admin-card inhalte-edit__more' },
          h('h2', {}, 'Weitere Möglichkeiten'),
          h('p', { class: 'muted' }, `Angelegt von ${userName(n.author)}. ${changedBy(n)}.`),
          h('div', { class: 'stack' },
            isLive('news', n) ? button({ label: 'Von der Website nehmen', icon: '⏸', block: true, onClick: unpublish }) : null,
            button({ label: 'In den Papierkorb legen', icon: '🗑', variant: 'danger', block: true, onClick: remove }),
            h('p', { class: 'muted inhalte-small' }, 'Gelöschtes bleibt 30 Tage im Papierkorb und lässt sich zurückholen.'))))),
    versionsSlot,
    actionsSlot));

  return () => { saver.destroy(); editor.destroy(); };
}, { permission: PERM, title: 'Neuigkeit bearbeiten' });

