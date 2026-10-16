#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { PUBLIC_ROOT, REPO_ROOT, CHROMIUM_PATH, prepareOutput } from './paths.mjs';
import { startServer } from './server.mjs';
import { LAUNCH_ARGS } from './run.mjs';
import { gpuInfo } from './metrics.mjs';
import { runNPCRegression } from './npc-regression.mjs';
import { DEFAULT_AUDIO_SINK } from './audio-output.mjs';

const WORK_ROOT = '/Users/logge/Documents/Projects/bodycam-work/codex/C20';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function sourceManifest() {
  const files = ['public/bodycam-demo/js/app/runtime.js', 'public/bodycam-demo/data/nav.json', 'public/bodycam-demo/data/level.json',
    'public/bodycam-demo/models/house_collision.glb', 'public/bodycam-demo/models/officer.glb',
    'public/bodycam-demo/models/carbine.glb', 'public/bodycam-demo/models/officer_fp.glb',
    'sources/bodycam-demo/tools/harness/npc-regression.mjs', 'sources/bodycam-demo/tools/harness/npc-suite.mjs'];
  async function walk(relative) {
    for (const entry of await readdir(path.join(REPO_ROOT, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (/\.(?:js|mjs|html|css|md|py|json)$/.test(entry.name)) files.push(child);
    }
  }
  for (const dir of ['public/bodycam-demo/js/npc', 'public/bodycam-demo/_dev/npc', 'sources/bodycam-demo/tools/nav']) await walk(dir);
  const manifest = {};
  for (const relative of files.sort()) manifest[relative] = createHash('sha256').update(await readFile(path.join(REPO_ROOT, relative))).digest('hex');
  return manifest;
}

export async function runNPCSuite({ out = path.join(WORK_ROOT, `npc-${new Date().toISOString().replace(/[:.]/g, '-')}`) } = {}) {
  const output = await prepareOutput(out);
  const report = { version: 1, group: 'npc', status: 'failed', startedAt: new Date().toISOString(),
    output, source: {}, environment: { node: process.version, launchArgs: LAUNCH_ARGS, viewport: [1920, 1080], port: 8969, audioSink: DEFAULT_AUDIO_SINK },
    checks: [], evidence: {}, console: [], pageErrors: [], failedRequests: [], httpErrors: [], fatalErrors: [] };
  let browser, server, phase = 'startup', closing = false;
  const onSignal = () => { void browser?.close().catch(() => {}); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  const record = value => ({ phase, time: new Date().toISOString(), ...value });
  try {
    report.source = await sourceManifest();
    server = await startServer(PUBLIC_ROOT, 8969);
    report.origin = server.origin;
    browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH, args: LAUNCH_ARGS,
      handleSIGINT: false, handleSIGTERM: false, timeout: 120000 });
    report.environment.browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
      locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
    page.on('console', message => report.console.push(record({ type: message.type(), text: message.text(), location: message.location() })));
    page.on('pageerror', error => report.pageErrors.push(record({ message: error.message, stack: error.stack })));
    page.on('requestfailed', request => { if (!closing) report.failedRequests.push(record({ url: request.url(), error: request.failure()?.errorText })); });
    page.on('response', response => { if (response.status() >= 400) report.httpErrors.push(record({ url: response.url(), status: response.status() })); });
    page.on('crash', () => report.fatalErrors.push(record({ error: 'Chromium-Tab abgestürzt' })));
    await page.goto(`${server.origin}/bodycam-demo/_dev/npc/?npcdebug=1&pause=1&behavior=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.npcTest?.ready === true, { timeout: 120000 });
    phase = 'gpu'; report.environment.gpu = await gpuInfo(page);
    const cdp = await browser.newBrowserCDPSession();
    try { const { gpu } = await cdp.send('SystemInfo.getInfo'); report.environment.gpu.cdp = { devices: gpu.devices, featureStatus: gpu.featureStatus }; }
    finally { await cdp.detach(); }
    report.checks.push({ name: 'npc-hardware-webgl2-metal', passed: report.environment.gpu.hardware, details: report.environment.gpu });
    if (!report.environment.gpu.hardware) throw new Error('Hardware-WebGL2 mit ANGLE Metal fehlt');
    phase = 'npc';
    const result = await runNPCRegression({ page, origin: server.origin, out: output, audioSink: DEFAULT_AUDIO_SINK });
    report.checks.push(...result.checks); report.evidence = result.evidence;
    phase = 'drain'; await page.waitForTimeout(300);
    report.checks.push({ name: 'npc-browser-and-network', passed: !report.pageErrors.length && !report.failedRequests.length
      && !report.httpErrors.length && !report.console.some(item => item.type === 'error'), details: {
      consoleErrors: report.console.filter(item => item.type === 'error'), pageErrors: report.pageErrors,
      failedRequests: report.failedRequests, httpErrors: report.httpErrors,
    } });
    report.sourceAfter = await sourceManifest();
    const changed = [...new Set([...Object.keys(report.source), ...Object.keys(report.sourceAfter)])]
      .filter(file => report.source[file] !== report.sourceAfter[file]);
    report.checks.push({ name: 'npc-sources-stable-during-run', passed: !changed.length, details: { changed, files: Object.keys(report.source).length } });
  } catch (error) { report.fatalErrors.push(record({ message: error.message, stack: error.stack })); }
  finally {
    closing = true; phase = 'cleanup';
    for (const cleanup of [() => browser?.close(), () => server?.close()]) {
      try { await cleanup(); } catch (error) { report.fatalErrors.push(record({ message: error.message, stack: error.stack })); }
    }
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
  }
  report.status = report.checks.length && report.checks.every(check => check.passed) && !report.fatalErrors.length ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString();
  report.summary = { checks: report.checks.length, passed: report.checks.filter(check => check.passed).length,
    failed: report.checks.filter(check => !check.passed).length, fatal: report.fatalErrors.length };
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(output, 'report.html'), htmlReport(report), { flag: 'wx' });
  return { report, output, exitCode: report.status === 'passed' ? 0 : 1 };
}

function htmlReport(report) {
  const shots = report.evidence.screenshots ?? [];
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C19 NPC-Regression</title>
  <style>body{font:15px system-ui,sans-serif;background:#181d24;color:#e8edf4;margin:32px;max-width:1500px}a{color:#b9d6ff}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #58636f;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}img{max-width:100%;height:auto;border:1px solid #58636f}.ok{color:#93dfa6}.bad{color:#ffafaa}</style>
  <h1>C19 NPC-Regression: ${escape(report.status)}</h1><p>${report.summary.passed}/${report.summary.checks} Prüfungen bestanden. Port 8969. 1920 × 1080. Echte App, echte Modelle und native Audio-Engine mit stummem Sink.</p>
  <p><a href="report.json">Vollständige Rohdaten</a></p><table><thead><tr><th>Prüfung</th><th>Ergebnis und Nachweis</th></tr></thead><tbody>${report.checks.map(check => `<tr><td>${escape(check.name)}</td><td><span class="${check.passed ? 'ok' : 'bad'}">${check.passed ? 'Bestanden' : 'Fehlgeschlagen'}</span><details><summary>Messwerte</summary><pre>${escape(JSON.stringify(check.details, null, 2))}</pre></details></td></tr>`).join('')}</tbody></table>
  ${report.fatalErrors.length ? `<pre>${escape(JSON.stringify(report.fatalErrors, null, 2))}</pre>` : ''}
  ${shots.map(shot => `<figure><figcaption>${escape(shot.description)}</figcaption><a href="${escape(shot.file)}"><img src="${escape(shot.file)}" alt="${escape(shot.description)}"></a></figure>`).join('')}</html>`;
}

export async function main(argv = process.argv.slice(2)) {
  let out;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { console.log('node npc-suite.mjs [--out /absoluter/neuer/WORK-Ordner] [--only npc]\nSeparate C19-Gruppe; eigener Port 8969, echte ANGLE-Metal-GPU.'); return 0; }
    if (argv[i] === '--out' && argv[i + 1]) { out = argv[++i]; continue; }
    if (argv[i] === '--only' && argv[i + 1] === 'npc') { i++; continue; }
    throw new Error(`Unbekannte oder unvollständige Option: ${argv[i]}`);
  }
  const result = await runNPCSuite({ out });
  console.log(`${result.report.status}: npc ${result.report.summary.passed}/${result.report.summary.checks}\n${path.join(result.output, 'report.html')}`);
  for (const check of result.report.checks.filter(item => !item.passed)) console.error(`${check.name}: ${JSON.stringify(check.details)}`);
  for (const error of result.report.fatalErrors) console.error(error.message);
  return result.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); } catch (error) { console.error(error.stack ?? error); process.exitCode = 2; }
}
