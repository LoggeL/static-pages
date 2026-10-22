// =========================================================
// inhalte/seiten.js – Seiten der Website mit FESTEN Vorlagen
// Routen: #/admin/seiten, /:id   (Recht: site.pages.edit)
// =========================================================
import { registerRoute, rerender } from '../../app.js';
import { db, log } from '../../store.js';
import { can } from '../../auth.js';
import { h, button, badge, toast, field, createEditor, pageHeader, emptyState, formatDate } from '../../ui.js';
import { mediaPicker, notice } from '../../admin.js';
import { allowed, thumbOrIcon, working, hasPending, publishItem, versionsBox, saveWorking, openPreview, pageArticle,
  changedBy, stableSrc, placeholdersIn } from './common.js';
import { autosaver, statusBox, discardPending, imageChooser, numLabel } from './editing.js';

const PERM = 'site.pages.edit';
const BACK = { href: '#/admin/seiten', label: 'Zurück zu den Seiten' };
const SECTIONS = [
  { id: 'verein', label: 'Verein', icon: '🏠', text: 'Erscheinen unter „Verein“ auf der Website.' },
  { id: 'bereiche', label: 'Vereinsbereiche', icon: '🎺', text: 'Kapelle, Theater, Jugend, Familien …' },
  { id: 'static', label: 'Rechtliches', icon: '§', text: 'Impressum und Datenschutz (nur Text).' },
];
export function pagePublicHref(p) { return p.section === 'static' ? `#/${p.slug}` : `#/${p.section}/${p.slug}`; }
const pageAddress = p => `kolping-ramsen.de/${p.section === 'static' ? '' : p.section + '/'}${p.slug}`;

/* ---------------------------------------------------------
   Liste
   --------------------------------------------------------- */
registerRoute('/admin/seiten', ({ el }) => {
  const pages = db.all('pages');
  const pendingCount = pages.filter(p => hasPending('pages', p)).length;
  el.replaceChildren(h('div', { class: 'admin-page inhalte' },
    pageHeader({ title: 'Seiten der Website', intro: 'Hier ändern Sie die Texte und Bilder der festen Seiten. Jede Seite hat eine feste Vorlage – Sie füllen nur die Felder aus, das Aussehen bleibt immer einheitlich.' }),
    pendingCount ? notice(h('span', {}, h('strong', {}, `${pendingCount === 1 ? 'Eine Seite hat' : pendingCount + ' Seiten haben'} Änderungen, `), 'die noch nicht auf der Website sind.'), 'info', '✎') : null,
    SECTIONS.map(s => {
      const list = pages.filter(p => p.section === s.id).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (!list.length) return null;
      return h('section', { class: 'dash-box', 'aria-labelledby': `inh-sec-${s.id}` },
        h('h2', { id: `inh-sec-${s.id}` }, h('span', { 'aria-hidden': 'true' }, s.icon + ' '), s.label),
        h('p', { class: 'muted' }, s.text),
        h('ul', { class: 'admin-list' }, list.map(p => {
          const w = working('pages', p);
          const pend = hasPending('pages', p);
          return h('li', { class: 'admin-row inhalte-row' },
            thumbOrIcon(w.image, '📄'),
            h('span', { class: 'admin-row__main' },
              h('b', {}, w.title),
              h('span', { class: 'admin-row__sub' }, `${pageAddress(p)} · ${changedBy(p)}`),
              h('span', { class: 'cluster inhalte-row__badges' },
                pend ? badge('Änderungen noch nicht veröffentlicht', 'info', '✎') : badge('Auf der Website', 'ok', '✓'))),
            h('span', { class: 'admin-row__actions' },
              button({ label: 'Ändern', icon: '✎', href: `#/admin/seiten/${p.id}` }),
              button({ label: 'Ansehen', icon: '🌐', href: pagePublicHref(p) })));
        })));
    }),
    h('p', { class: 'muted' }, 'Neue Seiten oder eine andere Reihenfolge im Menü richtet der Administrator ein – so bleibt die Website übersichtlich.')));
}, { permission: PERM, title: 'Seiten der Website' });

/* ---------------------------------------------------------
   Vorlage als Bild: welche Nummer steht wo auf der Seite?
   --------------------------------------------------------- */
function schema(p, focusers) {
  const zone = (num, label, cls) => h('button', { type: 'button', class: `inhalte-schema__zone ${cls}`,
    onclick: () => focusers[num] && focusers[num]() },
    h('span', { class: 'inhalte-num', 'aria-hidden': 'true' }, num), h('span', {}, label));
  const isStatic = p.section === 'static';
  return h('figure', { class: 'inhalte-schema', 'aria-label': 'Aufbau der Seite' },
    h('figcaption', {}, h('strong', {}, 'So ist die Seite aufgebaut'), h('br'), h('span', { class: 'muted' }, 'Tippen Sie auf einen Bereich, um ihn zu bearbeiten.')),
    h('div', { class: 'inhalte-schema__page' },
      isStatic ? zone('3', 'Titel', 'inhalte-schema__title') : h('div', { class: 'inhalte-schema__hero' },
        zone('1', 'Großes Bild', 'inhalte-schema__img'),
        zone('2', 'Kleine Zeile', 'inhalte-schema__kicker'),
        zone('3', 'Titel', 'inhalte-schema__title'),
        zone('4', 'Einleitung', 'inhalte-schema__intro')),
      h('div', { class: 'inhalte-schema__row' },
        zone('5', 'Haupttext', 'inhalte-schema__body'),
        isStatic ? null : h('div', { class: 'inhalte-schema__aside', 'aria-hidden': 'true' }, 'Menü (automatisch)')),
      p.section === 'bereiche' || (p.external && p.external.url) ? zone('6', 'Knopf zu anderer Website', 'inhalte-schema__btn') : null));
}

/* ---------------------------------------------------------
   Editor
   --------------------------------------------------------- */
registerRoute('/admin/seiten/:id', ({ el, params }) => {
  const p0 = db.find('pages', params.id);
  if (!p0 || p0.deletedAt) {
    el.replaceChildren(h('div', { class: 'admin-page' }, pageHeader({ title: 'Seite nicht gefunden', back: BACK }),
      emptyState({ icon: '📄', title: 'Diese Seite gibt es nicht (mehr)' })));
    return;
  }
  const id = p0.id;
  const cur = () => db.find('pages', id);
  const isStatic = p0.section === 'static';
  const hasButton = p0.section === 'bereiche' || !!(p0.external && p0.external.url);
  let w = working('pages', p0);
  const saver = autosaver('pages', id, { onSaved: () => { w = working('pages', cur()); refresh(); } });
  const focusers = {};

  const img = imageChooser({ value: w.image, label: 'Großes Bild oben', num: '1',
    hint: 'Liegt hinter dem Titel. Am besten ein Foto im Querformat.', onChange: (mid) => { saver.queue('image', mid); saver.flush(); } });
  focusers['1'] = () => { const b = img.el.querySelector('button'); b && (b.focus(), b.scrollIntoView({ block: 'center', behavior: 'smooth' })); };

  const mk = (num, key, opts) => {
    const f = field({ ...opts, label: numLabel(num, opts.label), value: w[key] || '' });
    f.input.addEventListener('input', () => saver.queue(key, f.input.value.trim()));
    focusers[num] = () => { f.input.focus(); f.input.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    return f;
  };
  const fKicker = isStatic ? null : mk('2', 'kicker', { label: 'Kleine Zeile über dem Titel', optional: true, hint: 'Zwei, drei Wörter, z. B. „Seit 1955“ oder „Klosterhof 7“.' });
  const fTitle = mk('3', 'title', { label: 'Titel der Seite', required: true, hint: 'Steht groß oben und im Menü.' });
  const fIntro = isStatic ? null : mk('4', 'intro', { label: 'Einleitung', type: 'textarea', rows: 3, hint: 'Ein bis zwei Sätze. Erscheint unter dem Titel und auf der Übersichtsseite.' });

  const editorWrap = h('div');
  const editorErr = h('div', { class: 'field__error', hidden: true });
  const editor = createEditor(editorWrap, { value: w.body, label: 'Haupttext der Seite',
    onChange: (html) => { editorErr.hidden = true; saver.queue('body', html); },
    onImage: (insert) => mediaPicker({ title: 'Bild in den Text einfügen', allowUpload: can('site.media.upload'),
      onPick: async (m) => insert({ src: await stableSrc(m), alt: m.alt || '' }) }) });
  focusers['5'] = () => { editor.focus(); editor.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

  let fBtnLabel = null, fBtnUrl = null;
  if (hasButton) {
    const ext = w.external || {};
    fBtnLabel = field({ label: 'Beschriftung des Knopfs', value: ext.label || '', optional: true, hint: 'z. B. „Zur Website des Kolpingtheaters“.' });
    fBtnUrl = field({ label: 'Webadresse', type: 'url', value: ext.url || '', optional: true, inputmode: 'url', hint: 'Beginnt mit https:// – leer lassen, wenn es keinen Knopf geben soll.' });
    const q = () => {
      const label = fBtnLabel.input.value.trim(), url = fBtnUrl.input.value.trim();
      saver.queue('external', label || url ? { label: label || 'Mehr erfahren', url } : null);
    };
    fBtnLabel.input.addEventListener('input', q); fBtnUrl.input.addEventListener('input', q);
    focusers['6'] = () => { fBtnLabel.input.focus(); fBtnLabel.input.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  }

  const statusSlot = h('div');
  const actionsSlot = h('div', { class: 'form-actions inhalte-actions' });
  const versionsSlot = h('div');

  function validate() {
    let first = null;
    if (!fTitle.value()) { fTitle.setError('Bitte einen Titel eintragen.'); first = first || fTitle.input; }
    if (fBtnUrl) {
      const url = fBtnUrl.value();
      if (url && !/^https?:\/\/[^\s.]+\.[^\s]+/i.test(url)) { fBtnUrl.setError('Die Webadresse sollte so aussehen: https://www.beispiel.de'); first = first || fBtnUrl.input; }
    }
    const ph = placeholdersIn(fTitle.value(), editor.getHTML());
    if (ph.length) { editorErr.hidden = false; editorErr.textContent = `Hier stehen noch Platzhalter: ${[...new Set(ph)].slice(0, 4).join(', ')}.`; first = first || editor.area; }
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast('Bitte die markierten Stellen ansehen.', { type: 'error' }); return false; }
    return true;
  }
  function publish() {
    if (!allowed(PERM)) return;
    saver.flush();
    if (!validate()) return;
    publishItem('pages', id);
    toast('Die Änderungen stehen jetzt auf der Website.');
    rerender();
  }
  function preview() {
    saver.flush();
    const p = cur(); const ww = working('pages', p);
    openPreview({ address: pageAddress(p), render: () => pageArticle(ww, p),
      note: hasPending('pages', p) ? 'Vorschau mit Ihren Änderungen – Besucher sehen noch die bisherige Fassung.' : 'So steht die Seite gerade auf der Website.' });
  }
  function refresh() {
    const p = cur(); if (!p) return;
    const pend = hasPending('pages', p);
    statusSlot.replaceChildren(statusBox('pages', p, { publicHref: pagePublicHref(p), onDiscard: () => discardPending('pages', id, () => rerender()) }));
    actionsSlot.replaceChildren(
      saver.indicator.el,
      h('span', { class: 'spacer' }),
      button({ label: 'Vorschau ansehen', icon: '👁', size: 'lg', onClick: preview }),
      pend ? button({ label: 'Änderungen auf der Website zeigen', icon: '✓', variant: 'ok', size: 'lg', onClick: publish })
        : button({ label: 'Auf der Website ansehen', icon: '🌐', variant: 'ok', size: 'lg', href: pagePublicHref(p) }));
    versionsSlot.replaceChildren(versionsBox('pages', p, { onRestore: (v) => {
      if (!allowed(PERM)) return;
      saveWorking('pages', id, v.data);
      log('page.update', `Seite „${v.data.title}“`, `frühere Fassung vom ${formatDate(String(v.at).slice(0, 10), 'short')} zurückgeholt`);
      toast('Die frühere Fassung ist geladen. Erst „Änderungen auf der Website zeigen“ macht sie öffentlich.');
      rerender();
    } }) || '');
  }
  refresh();

  el.replaceChildren(h('div', { class: 'admin-page inhalte inhalte-edit' },
    pageHeader({ title: `Seite „${w.title}“ ändern`, back: BACK,
      intro: `Webadresse: ${pageAddress(p0)} · Feste Vorlage „${isStatic ? 'Nur Text' : p0.section === 'bereiche' ? 'Vereinsbereich' : 'Vereinsseite'}“` }),
    statusSlot,
    h('div', { class: 'inhalte-edit__grid inhalte-edit__grid--page' },
      h('div', { class: 'inhalte-edit__main' },
        isStatic ? null : h('div', { class: 'admin-card' }, img.el),
        fKicker ? fKicker.el : null, fTitle.el, fIntro ? fIntro.el : null,
        h('div', { class: 'field' },
          h('span', { class: 'field__label' }, numLabel('5', 'Haupttext')),
          h('div', { class: 'field__hint' }, 'Der eigentliche Inhalt. Mit „Überschrift“ gliedern Sie ihn in Abschnitte.'),
          editorWrap, editorErr),
        hasButton ? h('fieldset', { class: 'admin-card inhalte-fieldset' },
          h('legend', {}, numLabel('6', 'Knopf zu einer anderen Website'), h('span', { class: 'opt' }, ' (freiwillig)')),
          fBtnLabel.el, fBtnUrl.el) : null),
      h('aside', { class: 'inhalte-edit__aside' }, schema(p0, focusers),
        notice('Das Aussehen (Schrift, Farben, Anordnung) ist fest vorgegeben. So sieht jede Seite gleich ordentlich aus – egal wer sie pflegt.', 'calm', '💡'))),
    versionsSlot,
    actionsSlot));

  return () => { saver.destroy(); editor.destroy(); };
}, { permission: PERM, title: 'Seite bearbeiten' });
