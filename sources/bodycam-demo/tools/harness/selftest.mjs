#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, symlink, stat } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { HARNESS_DIR, WORK_ROOT, REPO_ROOT, CHROMIUM_PATH, localPage } from './paths.mjs';
import { validateShots, parseArgs } from './config.mjs';
import { configureAudioOutput, validateAudioSink } from './audio-output.mjs';
import { summarizeFrames } from './metrics.mjs';
import { startServer } from './server.mjs';
import { LAUNCH_ARGS } from './run.mjs';
import { generateComparison } from './compare.mjs';

await mkdir(WORK_ROOT, { recursive: true });
const output = await mkdtemp(path.join(WORK_ROOT, 'selftest-'));
const fixtureRoot = path.join(HARNESS_DIR, 'fixtures');
const records = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
async function test(name, callback) {
  const start = Date.now();
  try { await callback(); records.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { records.push({ name, status: 'failed', message: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
function cli(args) {
  const child = spawn(process.execPath, [path.join(HARNESS_DIR, 'run.mjs'), ...args], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  return { child, done };
}
const basic = { version: 1, page: 'index.html', defaults: { settleMs: 0, measureSeconds: 0 }, shots: [{ name: 'basic' }] };
async function run(name, document, extra = [], expected = 0) {
  const shots = path.join(output, `${name}-shots.json`);
  await writeFile(shots, JSON.stringify(document));
  const directory = path.join(output, name);
  const result = await cli(['--root', fixtureRoot, '--shots', shots, '--out', directory, '--width', '960', '--height', '540', ...extra]).done;
  await writeFile(path.join(output, `${name}.log`), `${result.stdout}${result.stderr}`);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, expected, `${name}: ${result.stdout} ${result.stderr}`);
  const report = expected === 2 ? null : await json(path.join(directory, 'report.json'));
  if (report) assert.ok((await stat(path.join(directory, 'report.html'))).size > 100);
  return { report, directory, result };
}
async function portReleased() {
  const server = await startServer(fixtureRoot, 8969);
  await server.close();
}

await test('Schema und Perzentile', async () => {
  assert.throws(() => validateShots({ version: 1, shots: [{ name: 'a' }, { name: 'a' }] }), /Doppelter/);
  assert.throws(() => validateShots({ ...basic, shots: [{ name: 'a', actions: [{ type: 'wat' }] }] }), /unbekannte/);
  assert.throws(() => validateShots({ ...basic, shots: [{ name: 'a', teleport: [0, Infinity, 0] }] }), /endliche/);
  assert.throws(() => localPage('../outside.html'));
  assert.throws(() => localPage('%2e%2e/outside.html'));
  assert.throws(() => localPage('https://example.org/'));
  const result = summarizeFrames([10, 20, 30, 40]);
  assert.equal(result.fps, 40);
  assert.equal(result.frameTimeMs.p50, 25);
  assert.equal(result.frameTimeMs.p95, 38.5);
  assert.equal(validateAudioSink('none'), 'none');
  assert.equal(validateAudioSink('default'), 'default');
  assert.throws(() => validateAudioSink('muted'));
  assert.equal(parseArgs(['--audio-sink', 'default']).audioSink, 'default');
});

await test('Nativer Audioausgang: none/default und fehlender Kontext', async () => {
  const server = await startServer(fixtureRoot, 8969);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: LAUNCH_ARGS });
    const page = await browser.newPage();
    await page.goto(`${server.origin}/index.html`);
    assert.equal((await configureAudioOutput(page, 'none')).available, false);
    await page.evaluate(() => { window.__bodycam.dev = { audio: { context: new AudioContext() } }; });
    const silent = await configureAudioOutput(page, 'none');
    assert.equal(silent.sinkId.type, 'none');
    const time = await page.evaluate(async () => {
      const c=window.__bodycam.dev.audio.context; await c.resume(); return c.currentTime;
    });
    await page.waitForTimeout(350);
    assert.ok(await page.evaluate(t => window.__bodycam.dev.audio.context.currentTime-t > 0.1, time));
    const actual = await configureAudioOutput(page, 'default');
    assert.equal(actual.sinkId, '');
    await page.evaluate(() => window.__bodycam.dev.audio.context.close());
  } finally { await browser?.close(); await server.close(); }
});

await test('Statischer Server: MIME, Range, HEAD, Query, Symlink-Grenze', async () => {
  const root = path.join(output, 'server-root');
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await writeFile(path.join(root, 'nested', 'index.html'), '<title>static</title>');
  await writeFile(path.join(root, 'module.mjs'), 'export const n = 1;');
  await writeFile(path.join(root, 'asset.glb'), '0123456789');
  await symlink(path.join(HARNESS_DIR, 'package.json'), path.join(root, 'outside.json'));
  const server = await startServer(root, 8969);
  try {
    assert.equal((await fetch(`${server.origin}/module.mjs?v=1`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
    const redirect = await fetch(`${server.origin}/nested?q=1`, { redirect: 'manual' });
    assert.equal(redirect.headers.get('location'), '/nested/?q=1');
    const range = await fetch(`${server.origin}/asset.glb`, { headers: { Range: 'bytes=2-4' } });
    assert.equal(range.status, 206); assert.equal(await range.text(), '234');
    const suffix = await fetch(`${server.origin}/asset.glb`, { headers: { Range: 'bytes=-3' } });
    assert.equal(await suffix.text(), '789');
    assert.equal((await fetch(`${server.origin}/asset.glb`, { headers: { Range: 'bytes=99-100' } })).status, 416);
    const head = await fetch(`${server.origin}/asset.glb`, { method: 'HEAD' });
    assert.equal(head.headers.get('cache-control'), 'no-cache');
    assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
    assert.equal((await fetch(`${server.origin}/outside.json`)).status, 403);
    assert.equal((await fetch(`${server.origin}/missing`)).status, 404);
    assert.equal((await fetch(`${server.origin}/%2e%2e%2fpackage.json`)).status, 403);
  } finally { await server.close(); }
});

let before, after;
await test('CLI: GPU, PNGs, FPS, Teleport, Look, Tasten, Maus, eval', async () => {
  const doc = await json(path.join(fixtureRoot, 'shots.json'));
  before = await run('before', doc);
  assert.equal(before.report.status, 'passed');
  assert.equal(before.report.environment.gpu.hardware, true);
  assert.match(before.report.environment.gpu.renderer, /metal/i);
  assert.equal(before.report.shots.length, 2);
  for (const shot of before.report.shots) {
    const png = await readFile(path.join(before.directory, shot.screenshot));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 960); assert.equal(png.readUInt32BE(20), 540);
    assert.ok(shot.performance.fps > 0);
    assert.ok(shot.performance.elapsedMs >= 300);
    assert.equal(shot.performance.frames, shot.performance.samplesMs.length);
    assert.equal(shot.stats.renderer.info.render.triangles, 1);
  }
  assert.deepEqual(before.report.shots[1].actions.at(-1).result, { verified: true });
  await portReleased();
});
await test('Promise-ready, zweiter Lauf und CLI-Overrides', async () => {
  const doc = await json(path.join(fixtureRoot, 'shots.json'));
  after = await run('after', doc, ['--page', 'index.html?promise=1', '--measure-seconds', '0.2']);
  assert.equal(after.report.status, 'passed');
  assert.equal(after.report.shots[0].settings.measureSeconds, 0.2);
  await portReleased();
});
await test('Fehlendes stats(), BeforeReady-Start und Shot-Navigation', async () => {
  const result = await run('navigation', { ...basic, page: 'index.html?start=1', beforeReady: [{ type: 'click', selector: '#start' }], shots: [
    { name: 'started' }, { name: 'without-stats', page: 'index.html?promise=1&nostats=1' },
  ] });
  assert.equal(result.report.shots[0].stats.player.started, true);
  assert.equal(result.report.shots[1].stats, null);
  assert.equal(result.report.shots[1].performance, null);
});
await test('Konsolenfehler, JS-Ausnahme, HTTP 404 und Requestfehler => Exit 1', async () => {
  const result = await run('diagnostics', { ...basic, shots: [{ name: 'errors', settleMs: 150, actions: [
    { type: 'eval', code: "console.error('C13 intentional console error'); setTimeout(() => { throw new Error('C13 intentional page error'); }, 0); fetch('/intentional-missing').catch(()=>{}); fetch('http://127.0.0.1:1/blocked').catch(()=>{});" },
  ] }] }, [], 1);
  assert.ok(result.report.console.some(item => item.type === 'error' && item.text.includes('C13 intentional')));
  assert.ok(result.report.pageErrors.some(item => item.message.includes('intentional page error')));
  assert.ok(result.report.httpErrors.some(item => item.status === 404));
  assert.ok(result.report.failedRequests.length);
  assert.equal(result.report.shots[0].status, 'failed');
});
await test('Ready-Timeout schreibt Fehlerbericht und räumt Port auf', async () => {
  const result = await run('timeout', basic, ['--page', 'index.html?never=1', '--ready-timeout-ms', '400'], 1);
  assert.ok(result.report.fatalErrors.length);
  assert.equal(result.report.shots.length, 0);
  await portReleased();
});
await test('Fehlender Hook und eval-Timeout scheitern explizit', async () => {
  const missing = await run('missing-hook', { ...basic, page: 'index.html?missinghook=1', shots: [{ name: 'missing', teleport: [0, 0, 0] }] }, [], 1);
  assert.match(missing.report.shots[0].errors[0].message, /Debug-Hook/);
  const timeout = await run('eval-timeout', { ...basic, shots: [{ name: 'timeout', actions: [{ type: 'eval', code: 'new Promise(() => {})', durationMs: '600' }] }, { name: 'next' }] }, ['--action-timeout-ms', '300'], 1);
  assert.match(timeout.report.shots[0].errors[0].message, /Zeitlimit/);
  assert.equal(timeout.report.shots.length, 1, 'Zeitüberschreitungen müssen vor weiteren Shots abbrechen.');
  assert.ok(timeout.report.fatalErrors.length);
  await portReleased();
});
await test('Fehlender Browser und fehlende Seite räumen Server auf', async () => {
  await run('missing-browser', basic, ['--browser', path.join(output, 'no-browser')], 1);
  await portReleased();
  const missing = await run('missing-page', basic, ['--page', 'missing-page.html'], 1);
  assert.equal(missing.report.httpErrors[0].status, 404);
  await portReleased();
});
await test('Portkonflikt lässt fremden Server bestehen', async () => {
  const server = await startServer(fixtureRoot, 8969);
  try {
    const conflict = await run('port-conflict', basic, [], 1);
    assert.match(conflict.report.fatalErrors[0].message, /EADDRINUSE/);
    assert.equal((await fetch(`${server.origin}/index.html`)).status, 200);
  } finally { await server.close(); }
});
await test('Ungültige Konfiguration und Überschreiben verweigert', async () => {
  await run('invalid', { ...basic, shots: [{ name: 'bad', actions: [{ type: 'unknown' }] }] }, [], 2);
  const conflict = await cli(['--root', fixtureRoot, '--shots', path.join(fixtureRoot, 'shots.json'), '--out', before.directory]).done;
  assert.equal(conflict.code, 2);
  assert.match(conflict.stderr, /nicht leer/);
  const inRepo = await cli(['--shots', path.join(fixtureRoot, 'shots.json'), '--out', path.join(HARNESS_DIR, 'forbidden-output')]).done;
  assert.equal(inRepo.code, 2); assert.match(inRepo.stderr, /außerhalb/);
});
await test('SIGTERM: Fehlerbericht und Server-Cleanup', async () => {
  const directory = path.join(output, 'interrupted');
  const running = cli(['--root', fixtureRoot, '--page', 'index.html?never=1', '--shots', path.join(fixtureRoot, 'shots.json'), '--out', directory]);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch('http://127.0.0.1:8969/index.html')).ok; } catch { /* Startup not complete. */ }
    if (ready) break;
    await sleep(50);
  }
  assert.ok(ready);
  await sleep(500);
  running.child.kill('SIGTERM');
  const result = await running.done;
  assert.equal(result.code, 1, result.stderr);
  assert.equal((await json(path.join(directory, 'report.json'))).status, 'failed');
  await portReleased();
});

let comparison;
await test('Portabler Vorher-/Nachher-Kontaktbogen mit Referenz', async () => {
  assert.ok(before && after);
  comparison = await generateComparison({ before: before.directory, after: after.directory, out: path.join(output, 'comparison'), reference: path.join(before.directory, before.report.shots[0].screenshot) });
  assert.equal(comparison.comparison.pairs.length, 2);
  assert.equal(comparison.comparison.status, 'complete');
  for (const pair of comparison.comparison.pairs) for (const side of ['before', 'after']) assert.ok((await stat(path.join(comparison.output, pair[side].image))).size > 100);
});
await test('HTML-Berichte im echten Browser: Bilder, Layout, Fehlerfreiheit', async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: LAUNCH_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', item => { if (item.type() === 'error') errors.push(item.text()); });
    for (const [name, file] of [['report', path.join(before.directory, 'report.html')], ['compare', path.join(comparison.output, 'compare.html')]]) {
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(async () => {
        for (const image of document.images) { image.loading = 'eager'; await image.decode(); }
      });
      assert.equal(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), true);
      await page.screenshot({ path: path.join(output, `${name}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `${name}-mobile.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

const failed = records.filter(record => record.status !== 'passed');
await writeFile(path.join(output, 'selftest.json'), `${JSON.stringify({ status: failed.length ? 'failed' : 'passed', records, output }, null, 2)}\n`);
console.log(`${records.length - failed.length}/${records.length} Selbsttests bestanden. Artefakte: ${output}`);
process.exitCode = failed.length ? 1 : 0;
