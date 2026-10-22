// =========================================================
// protokolle/doc.js – Protokoll als sauberes Dokument
// (Vorschau, Lese-Ansicht und Druck/PDF mit Kolping-Kopf)
// =========================================================
import { esc, sanitizeHTML, formatDate, formatDateTime, h } from '../../ui.js';
import { userName } from '../../store.js';
import { kindLabel, present, excused, voteResult, nextText } from './model.js';

/** Protokoll-Dokument als HTML-String. opts: {status:'draft'|'final', approvedBy, approvedAt} */
export function protocolDocHTML(d, { status = 'draft', approvedBy, approvedAt } = {}) {
  const pres = present(d), exc = excused(d);
  const time = [d.start, d.end].filter(Boolean).join(' – ');
  const tops = d.tops.map((t, i) => `
    <section class="protokolle-doc__top">
      <h2><span class="protokolle-doc__topnum">TOP ${i + 1}</span> ${esc(t.title || 'ohne Überschrift')}</h2>
      <div class="protokolle-doc__body">${sanitizeHTML(t.body || '') || '<p class="protokolle-doc__empty">(kein Text)</p>'}</div>
      ${t.decisions.map(dec => {
        const r = voteResult(dec);
        return `<div class="protokolle-doc__decision protokolle-doc__decision--${r.state}">
          <p><strong>Beschluss:</strong> ${esc(dec.text || '–')}</p>
          <p class="protokolle-doc__vote">${esc(r.text)}</p></div>`;
      }).join('')}
    </section>`).join('');
  const final = status === 'final';
  return `
  <article class="protokolle-doc${final ? '' : ' protokolle-doc--draft'}" aria-label="Protokoll">
    ${final ? '' : '<div class="protokolle-doc__watermark" aria-hidden="true">ENTWURF</div>'}
    <header class="protokolle-doc__head">
      <img src="img/kolping-logo.svg" alt="Kolping" class="protokolle-doc__logo" width="96" height="62">
      <div class="protokolle-doc__org">
        <strong>Kolpingsfamilie Ramsen</strong>
        <span>Pfarrheim · Klosterhof 7 · 67305 Ramsen</span>
      </div>
      <div class="protokolle-doc__kind">Protokoll</div>
    </header>
    <h1 class="protokolle-doc__title">${esc(kindLabel(d.kind))}<br><span>${esc(d.date ? formatDate(d.date, 'long') : 'ohne Datum')}</span></h1>
    <dl class="protokolle-doc__meta">
      <div><dt>Ort</dt><dd>${esc(d.place || '–')}</dd></div>
      <div><dt>Zeit</dt><dd>${esc(time ? time + ' Uhr' : '–')}</dd></div>
      <div><dt>Schriftführung</dt><dd>${esc(d.recorder || '–')}</dd></div>
      <div><dt>Status</dt><dd>${final ? 'Abgeschlossen' + (approvedAt ? ' am ' + esc(formatDateTime(approvedAt)) : '') : 'Entwurf – noch nicht abgeschlossen'}</dd></div>
    </dl>
    <div class="protokolle-doc__people">
      <p><strong>Anwesend (${pres.length}):</strong> ${esc(pres.map(p => p.name).join(', ') || '–')}</p>
      ${exc.length ? `<p><strong>Entschuldigt (${exc.length}):</strong> ${esc(exc.map(p => p.name).join(', '))}</p>` : ''}
      ${d.others ? `<p><strong>Weitere Anwesende / Gäste:</strong> ${esc(d.others)}</p>` : ''}
    </div>
    ${tops || '<p>(Keine Tagesordnungspunkte)</p>'}
    ${d.nextDate || d.nextNote ? `<p class="protokolle-doc__next"><strong>Nächste Sitzung:</strong> ${esc(nextText(d))}</p>` : ''}
    <div class="protokolle-doc__sign">
      <div><span class="protokolle-doc__line"></span>${esc(d.recorder || 'Schriftführung')}<br><small>Schriftführung</small></div>
      <div><span class="protokolle-doc__line"></span>Vorsitz / Teamsprecher<br><small>Ort, Datum, Unterschrift</small></div>
    </div>
    <footer class="protokolle-doc__foot">
      ${final && approvedBy ? `Digital abgeschlossen von ${esc(userName(approvedBy))}${approvedAt ? ', ' + esc(formatDateTime(approvedAt)) : ''} · ` : ''}
      Erstellt mit der Verwaltung der Kolpingsfamilie Ramsen · 🔒 Nur für den Vorstand
    </footer>
  </article>`;
}

/** Dokument als Element (für Vorschau und Lese-Ansicht) */
export function protocolDoc(d, opts) {
  return h('div', { class: 'protokolle-paper', html: protocolDocHTML(d, opts) });
}

/** Druck-Bereich anlegen (liegt außerhalb von #app; die Druck-CSS zeigt nur ihn) */
export function ensurePrintRoot() {
  let root = document.querySelector('body > .protokolle-print');
  if (!root) { root = h('div', { class: 'protokolle-print', 'aria-hidden': 'true' }); document.body.append(root); }
  return root;
}
export function removePrintRoot() {
  const root = document.querySelector('body > .protokolle-print');
  if (root) root.remove();
}
/** Druckdialog öffnen („Als PDF sichern“ ist dort auswählbar) */
export function printProtocol(d, opts, filename) {
  const root = ensurePrintRoot();
  root.innerHTML = protocolDocHTML(d, opts);
  const prevTitle = document.title;
  if (filename) document.title = filename; // wird vom Browser als PDF-Dateiname vorgeschlagen
  const restore = () => { document.title = prevTitle; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  const img = root.querySelector('img');
  const go = () => { window.print(); };
  if (img && !img.complete) { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); }
  else go();
}
