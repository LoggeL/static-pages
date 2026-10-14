#!/usr/bin/env node
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml, formatNumber, htmlDocument, renderImage, renderPerformance, safeImagePath } from './report.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveProspectivePath(candidate) {
  let ancestor = path.resolve(candidate);
  const suffix = [];
  for (;;) {
    try { return path.join(await realpath(ancestor), ...suffix); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

export async function readRun(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Ein Laufordner oder report.json fehlt.');
  let reportFile = path.resolve(input);
  if ((await stat(reportFile)).isDirectory()) reportFile = path.join(reportFile, 'report.json');
  reportFile = await realpath(reportFile);
  const report = JSON.parse(await readFile(reportFile, 'utf8'));
  if (report?.version !== 1 || !Array.isArray(report.shots) || !['passed', 'failed'].includes(report.status)) {
    throw new Error(`Ungültiger Harness-Bericht: ${reportFile} (version: 1, status und shots erforderlich).`);
  }
  const names = new Set();
  for (const shot of report.shots) {
    if (!shot || typeof shot.name !== 'string' || !shot.name.trim() || names.has(shot.name)) {
      throw new Error(`Ungültiger oder doppelter Shot-Name in ${reportFile}: ${String(shot?.name)}`);
    }
    if (shot.screenshot != null && !safeImagePath(shot.screenshot)) {
      throw new Error(`Unsicherer Screenshot-Pfad in ${reportFile}: ${String(shot.screenshot)}`);
    }
    names.add(shot.name);
  }
  return { directory: path.dirname(reportFile), reportFile, report };
}

async function rasterFile(file) {
  const absolute = await realpath(file);
  if (!(await stat(absolute)).isFile()) throw new Error(`Keine Bilddatei: ${file}`);
  const data = await readFile(absolute);
  let extension = null;
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = '.png';
  else if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) extension = '.jpg';
  else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') extension = '.webp';
  if (!extension) throw new Error(`Kein unterstütztes Rasterbild (PNG, JPEG, WebP): ${file}`);
  return { absolute, extension };
}

async function inspectShot(run, name, side, warnings) {
  const shot = run.report.shots.find((entry) => entry.name === name);
  if (!shot) return { present: false, image: null, imageStatus: 'shot-missing', message: 'Shot in diesem Lauf nicht vorhanden.' };
  const result = { present: true, status: shot.status, description: shot.description ?? '',
    image: null, imageStatus: 'not-captured', performance: shot.performance ?? null, stats: shot.stats ?? null, errors: shot.errors ?? [] };
  if (!shot.screenshot) {
    result.message = 'Screenshot wurde nicht aufgenommen.';
    warnings.push({ side, shot: name, code: 'not-captured', message: result.message });
    return result;
  }
  const source = path.resolve(run.directory, shot.screenshot);
  if (!isWithin(run.directory, source)) throw new Error(`Screenshot liegt außerhalb des Laufs: ${source}`);
  try {
    const canonical = await realpath(source);
    if (!isWithin(run.directory, canonical)) throw new Error(`Screenshot-Symlink verlässt den Laufordner: ${source}`);
    result.source = await rasterFile(canonical);
    result.imageStatus = 'available';
    return result;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    result.imageStatus = 'file-missing';
    result.message = `Screenshot-Datei fehlt: ${shot.screenshot}`;
    warnings.push({ side, shot: name, code: 'file-missing', message: result.message });
    return result;
  }
}

function delta(before, after) {
  return typeof before === 'number' && Number.isFinite(before) && typeof after === 'number' && Number.isFinite(after)
    ? after - before : null;
}

function sideHtml(side, label, name) {
  return `<figure><h3>${escapeHtml(label)}</h3>${renderImage(side.image, `${label}: ${name}`, side.message)}
    <figcaption>${side.present ? `Status: ${side.status === 'passed' ? 'bestanden' : 'fehlgeschlagen'}` : 'Shot fehlt'}</figcaption>
    ${side.description ? `<p>${escapeHtml(side.description)}</p>` : ''}
    ${side.present ? renderPerformance(side.performance) : ''}
    ${side.stats != null ? `<details><summary>__bodycam.stats()</summary><pre>${escapeHtml(JSON.stringify(side.stats, null, 2))}</pre></details>` : ''}
    ${side.errors?.length ? `<details open><summary>Shot-Fehler</summary><pre>${escapeHtml(JSON.stringify(side.errors, null, 2))}</pre></details>` : ''}
  </figure>`;
}

function deltaText(value, unit) {
  return value == null ? 'nicht vergleichbar' : `${value > 0 ? '+' : ''}${formatNumber(value)} ${unit}`;
}

export function renderComparisonHtml(comparison) {
  const rows = comparison.pairs.map((pair) => `<article><h2>${escapeHtml(pair.name)}</h2>
    <div class="pairs${comparison.reference ? ' with-reference' : ''}">${sideHtml(pair.before, 'Vorher', pair.name)}${sideHtml(pair.after, 'Nachher', pair.name)}
    ${comparison.reference ? `<figure><h3>Referenz</h3>${renderImage(comparison.reference.image, 'Referenzframe')}<figcaption>${escapeHtml(comparison.reference.name)}</figcaption><p class="muted">Manuelle Bildreferenz. Keine automatische Qualitätsbewertung.</p></figure>` : ''}</div>
    <p>Änderung Nachher minus Vorher: ${escapeHtml(deltaText(pair.delta.fps, 'FPS'))} · p95-Frame-Zeit: ${escapeHtml(deltaText(pair.delta.p95Ms, 'ms'))}</p>
  </article>`).join('\n');
  return htmlDocument('Bodycam-Laufvergleich', `<header><h1>Bodycam-Laufvergleich</h1>
    <p>${comparison.pairs.length} benannte Shots · ${comparison.status === 'complete' ? 'Alle vorhandenen Shots mit Bild' : 'Bilddaten unvollständig'}</p>
    <dl><dt>Vorher</dt><dd>${escapeHtml(comparison.before.page)} · ${escapeHtml(comparison.before.startedAt)} · ${escapeHtml(comparison.before.status)}</dd>
    <dt>Nachher</dt><dd>${escapeHtml(comparison.after.page)} · ${escapeHtml(comparison.after.startedAt)} · ${escapeHtml(comparison.after.status)}</dd></dl>
    <p><a href="compare.json">Vergleichsdaten (compare.json)</a></p>
    <p class="muted">Zuordnung über identische Shot-Namen; zusätzliche oder fehlende Shots bleiben sichtbar. rAF-Abstände sind keine GPU-Zeitmessung. FPS hängen auch von VSync, Browser, Viewport und Systemlast ab. Der Vergleich setzt keine automatische Schwelle für Erfolg oder Bildqualität.</p>
    ${comparison.warnings.length ? `<details open><summary>Hinweise (${comparison.warnings.length})</summary><pre>${escapeHtml(JSON.stringify(comparison.warnings, null, 2))}</pre></details>` : ''}
    <details><summary>Messbedingungen beider Läufe</summary><pre>${escapeHtml(JSON.stringify({ before: comparison.before, after: comparison.after }, null, 2))}</pre></details>
  </header>${rows || '<p>Beide Läufe enthalten keine Shots.</p>'}`);
}

/** Create a portable comparison in a new directory. Existing output is never overwritten. */
export async function generateComparison({ before, after, out, reference } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new Error('Ausgabeordner --out fehlt.');
  const [beforeRun, afterRun] = await Promise.all([readRun(before), readRun(after)]);
  const output = await resolveProspectivePath(out);
  const repo = await realpath(REPO_ROOT);
  if ([repo, beforeRun.directory, afterRun.directory].some((root) => isWithin(root, output))) {
    throw new Error('Der Vergleichsordner muss außerhalb des Repos und der beiden Quellläufe liegen.');
  }
  try {
    await stat(output);
    throw new Error(`Ausgabeordner existiert bereits; neuen Pfad wählen: ${output}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const warnings = [];
  const names = [...new Set([...beforeRun.report.shots, ...afterRun.report.shots].map((shot) => shot.name))];
  const pairs = [];
  for (const name of names) {
    const beforeShot = await inspectShot(beforeRun, name, 'before', warnings);
    const afterShot = await inspectShot(afterRun, name, 'after', warnings);
    pairs.push({ name, before: beforeShot, after: afterShot, delta: {
      fps: delta(beforeShot.performance?.fps, afterShot.performance?.fps),
      p95Ms: delta(beforeShot.performance?.frameTimeMs?.p95, afterShot.performance?.frameTimeMs?.p95),
    } });
  }
  const referenceFile = reference ? await rasterFile(path.resolve(reference)) : null;
  const metadata = ({ directory, report }) => ({ directory, page: report.page, startedAt: report.startedAt,
    finishedAt: report.finishedAt, status: report.status, config: report.config, environment: report.environment, summary: report.summary });
  const comparison = { version: 1, createdAt: new Date().toISOString(), status: warnings.length ? 'incomplete' : 'complete',
    before: metadata(beforeRun), after: metadata(afterRun), reference: null, warnings, pairs };
  // Parent creation is non-destructive; the final mkdir claims a fresh output atomically.
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  await mkdir(path.join(output, 'images'));
  for (const [index, pair] of pairs.entries()) {
    for (const side of ['before', 'after']) {
      const shot = pair[side];
      if (shot.source) {
        shot.image = `images/${String(index + 1).padStart(3, '0')}-${side}${shot.source.extension}`;
        await copyFile(shot.source.absolute, path.join(output, shot.image), constants.COPYFILE_EXCL);
        delete shot.source;
      }
    }
  }
  if (referenceFile) {
    comparison.reference = { name: path.basename(reference), image: `images/reference${referenceFile.extension}` };
    await copyFile(referenceFile.absolute, path.join(output, comparison.reference.image), constants.COPYFILE_EXCL);
  }
  await writeFile(path.join(output, 'compare.json'), `${JSON.stringify(comparison, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(output, 'compare.html'), renderComparisonHtml(comparison), { flag: 'wx' });
  return { output, comparison };
}

export function parseCompareArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--before', '--after', '--out', '--reference'].includes(argument)) throw new Error(`Unbekanntes Argument: ${argument}`);
    const name = argument.slice(2);
    if (values[name] !== undefined) throw new Error(`Argument mehrfach angegeben: ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Wert fehlt: ${argument}`);
    values[name] = value;
  }
  for (const required of ['before', 'after', 'out']) if (!values[required]) throw new Error(`Pflichtargument fehlt: --${required}`);
  return values;
}

async function main() {
  const options = parseCompareArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node compare.mjs --before <Laufordner|report.json> --after <Laufordner|report.json> --out <neuer Ordner> [--reference <PNG|JPEG|WebP>]\n\nAusgabe: compare.html, compare.json und lokale Bildkopien. Ausgabeordner muss neu und außerhalb des Repos sowie der Quellläufe sein.\nExit-Code: 0 = vollständig, 1 = Eingabe-/Dateifehler, 2 = fehlende Bilddaten in vorhandenen Shots. Zusätzliche Shots sind erlaubt.');
    return;
  }
  const { output, comparison } = await generateComparison(options);
  console.log(`Vergleich: ${path.join(output, 'compare.html')} (${comparison.pairs.length} Shots, ${comparison.warnings.length} Hinweise)`);
  if (comparison.status === 'incomplete') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`Vergleich fehlgeschlagen: ${error.message}`); process.exitCode = 1; });
}
