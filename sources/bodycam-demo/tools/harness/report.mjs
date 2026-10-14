import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function formatNumber(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('de-DE', { maximumFractionDigits: digits }) : 'nicht erfasst';
}

export const reportStyles = `
  :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #17212b; background: #eef1f4; }
  * { box-sizing: border-box; } body { margin: 0; padding: 24px; } main { max-width: 1600px; margin: auto; }
  h1 { font-size: 1.9rem; margin: 0 0 10px; } h2 { font-size: 1.35rem; } h3 { font-size: 1.1rem; }
  p { margin: 10px 0; } a { color: #075a9c; overflow-wrap: anywhere; }
  header, .panel, article { background: white; border: 1px solid #ced5dc; border-radius: 8px; padding: 20px; margin: 0 0 20px; }
  .muted { color: #52616e; } .passed { color: #126338; } .failed, .warning { color: #922e21; }
  .status { display: inline-block; padding: 3px 9px; border: 1px solid currentColor; border-radius: 4px; }
  .contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr)); gap: 20px; }
  .contact article { margin: 0; min-width: 0; } figure { margin: 0; min-width: 0; }
  img { display: block; width: 100%; height: auto; background: #111; border: 1px solid #ced5dc; }
  figcaption { margin: 8px 0; } .missing { padding: 40px 12px; border: 1px dashed #8b98a5; text-align: center; }
  .table-wrap { overflow-x: auto; } table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #dce1e6; vertical-align: top; overflow-wrap: anywhere; }
  .table-wrap th, .table-wrap td { white-space: nowrap; overflow-wrap: normal; }
  th { font-weight: 600; } dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 18px; }
  dt { font-weight: 600; } dd { margin: 0; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.45 ui-monospace, monospace; background: #f4f6f8; padding: 12px; }
  summary { cursor: pointer; margin: 9px 0; } details { margin-top: 10px; } .diagnostic { border-top: 1px solid #dce1e6; padding-top: 8px; }
  .pairs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .pairs.with-reference { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @media (max-width: 800px) { body { padding: 12px; } .pairs, .pairs.with-reference { grid-template-columns: 1fr; } dl { grid-template-columns: 1fr; gap: 0; } dd { margin-bottom: 8px; } }
  @media print { body { background: white; padding: 0; } article, figure { break-inside: avoid; } details { display: block; } }
`;

export function htmlDocument(title, content) {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<link rel="icon" href="data:,">
<title>${escapeHtml(title)}</title><style>${reportStyles}</style></head><body><main>${content}</main></body></html>\n`;
}

// Generated reports use local raster images only, including when viewed via file://.
export function safeImagePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')
    || path.posix.isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..')
    || !/\.(png|jpe?g|webp)$/i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return value.split('/').map(encodeURIComponent).join('/');
}

export function renderImage(screenshot, label, missing = 'Kein Screenshot vorhanden.') {
  const source = safeImagePath(screenshot);
  return source ? `<a href="${escapeHtml(source)}"><img loading="lazy" src="${escapeHtml(source)}" alt="${escapeHtml(label)}"></a>`
    : `<div class="missing">${escapeHtml(missing)}</div>`;
}

export function renderPerformance(performance) {
  if (!performance) return '<p class="muted">Keine rAF-Messung vorhanden.</p>';
  const timing = performance.frameTimeMs ?? {};
  return `<p>${formatNumber(performance.fps)} FPS · ${formatNumber(performance.frames, 0)} Frame-Intervalle · ${formatNumber(performance.elapsedMs / 1000)} s</p>
  <div class="table-wrap"><table><thead><tr><th>Frame-Zeit (ms)</th><th>Min.</th><th>Mittel</th><th>p50</th><th>p90</th><th>p95</th><th>p99</th><th>Max.</th></tr></thead>
  <tbody><tr><th>rAF-Abstände</th>${['min', 'mean', 'p50', 'p90', 'p95', 'p99', 'max'].map((key) => `<td>${formatNumber(timing[key])}</td>`).join('')}</tr></tbody></table></div>`;
}

function jsonDetails(title, value, open = false) {
  return `<details${open ? ' open' : ''}><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`;
}

function diagnostics(title, entries = []) {
  return `<details${entries.length ? ' open' : ''}><summary>${escapeHtml(title)} (${entries.length})</summary>${entries.length
    ? entries.map((entry) => `<div class="diagnostic"><pre>${escapeHtml(JSON.stringify(entry, null, 2))}</pre></div>`).join('')
    : '<p class="muted">Keine Einträge.</p>'}</details>`;
}

export function renderReportHtml(report) {
  const shots = report.shots ?? [];
  const status = report.status === 'passed' ? 'passed' : 'failed';
  const summary = report.summary ?? {};
  const viewport = report.config?.viewport;
  const gpu = report.environment?.gpu;
  const shotCards = shots.map((shot, index) => `<article id="shot-${index + 1}">
    <h3>${index + 1}. ${escapeHtml(shot.name)} <span class="status ${shot.status === 'passed' ? 'passed' : 'failed'}">${shot.status === 'passed' ? 'bestanden' : 'fehlgeschlagen'}</span></h3>
    ${shot.description ? `<p>${escapeHtml(shot.description)}</p>` : ''}
    <figure>${renderImage(shot.screenshot, shot.name)}<figcaption>${escapeHtml(shot.screenshot ?? 'Screenshot nicht aufgenommen')}</figcaption></figure>
    ${renderPerformance(shot.performance)}
    ${shot.stats == null ? '<p class="muted">__bodycam.stats() nicht verfügbar oder ohne Ergebnis.</p>' : jsonDetails('__bodycam.stats() / renderer.info', shot.stats)}
    ${jsonDetails('Ausgeführte Aktionen', shot.actions ?? [])}
    ${(shot.errors ?? []).length ? diagnostics('Shot-Fehler', shot.errors) : ''}
  </article>`).join('\n');
  return htmlDocument('Bodycam-Testbericht', `<header>
    <h1>Bodycam-Testbericht</h1><p><span class="status ${status}">${status === 'passed' ? 'Bestanden' : 'Fehlgeschlagen'}</span></p>
    <dl><dt>Seite</dt><dd>${escapeHtml(report.page)}</dd><dt>URL</dt><dd>${escapeHtml(report.url)}</dd>
    <dt>Start</dt><dd>${escapeHtml(report.startedAt)}</dd><dt>Ende</dt><dd>${escapeHtml(report.finishedAt)}</dd>
    <dt>Viewport</dt><dd>${viewport ? `${escapeHtml(viewport.width)} × ${escapeHtml(viewport.height)}` : 'nicht erfasst'}</dd>
    <dt>Chromium</dt><dd>${escapeHtml(report.environment?.browserVersion ?? 'nicht erfasst')}</dd>
    <dt>GPU</dt><dd>${escapeHtml(gpu?.renderer ?? 'nicht erfasst')}</dd>
    <dt>GPU-Nachweis</dt><dd>WebGL2: ${gpu?.webgl2 === true ? 'ja' : gpu?.webgl2 === false ? 'nein' : 'nicht erfasst'} · Hardware: ${gpu?.hardware === true ? 'bestätigt' : gpu?.hardware === false ? 'nicht bestätigt' : 'nicht erfasst'}</dd>
    <dt>Standard-Messdauer</dt><dd>${formatNumber(report.config?.measureSeconds)} s (Shots können abweichen)</dd></dl>
    <p><a href="report.json">Vollständige Messdaten (report.json)</a></p>
    <p>Shots: ${shots.length} · Konsolenfehler: ${escapeHtml(summary.consoleErrors ?? 0)} · Seitenfehler: ${escapeHtml(summary.pageErrors ?? 0)} · Fehlgeschlagene Requests: ${escapeHtml(summary.failedRequests ?? 0)} · HTTP-Fehler: ${escapeHtml(summary.httpErrors ?? 0)} · Shot-Fehler: ${escapeHtml(summary.shotErrors ?? 0)}</p>
    <p class="muted">FPS und Frame-Zeiten beschreiben die Abstände von requestAnimationFrame-Aufrufen im Browser. Sie sind keine GPU-Zeitmessung und können durch VSync, Systemlast und Headless-Ausführung begrenzt sein. renderer.info wird nur angezeigt, wenn die Seite diese Daten tatsächlich bereitstellt.</p>
  </header>
  ${report.failureScreenshot ? `<section><h2>Zustand beim Abbruch</h2>${renderImage(report.failureScreenshot, "Fehlerzustand")}</section>` : ''}
  <section><h2>Kontaktbogen (${shots.length})</h2><div class="contact">${shotCards || '<p>Keine Shots ausgeführt.</p>'}</div></section>
  <section class="panel" style="margin-top:20px"><h2>Umgebung und Konfiguration</h2>${jsonDetails('Vollständige Browser- und GPU-Daten', report.environment ?? {})}${jsonDetails('Konfiguration', report.config ?? {})}</section>
  <section class="panel" style="margin-top:20px"><h2>Diagnostik</h2>
    ${diagnostics('Abbruchfehler', report.fatalErrors)}${diagnostics('Konsolenmeldungen', report.console)}
    ${diagnostics('Seitenfehler', report.pageErrors)}${diagnostics('Fehlgeschlagene Requests', report.failedRequests)}${diagnostics('HTTP-Fehler', report.httpErrors)}
  </section>`);
}

export async function writeReportHtml(report, outDir) {
  const file = path.join(outDir, 'report.html');
  await writeFile(file, renderReportHtml(report), { flag: 'wx' });
  return file;
}
