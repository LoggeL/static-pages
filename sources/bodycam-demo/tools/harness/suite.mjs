#!/usr/bin/env node
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { HARNESS_DIR, WORK_ROOT, PUBLIC_ROOT, CHROMIUM_PATH, REPO_ROOT, prepareOutput } from './paths.mjs';
import { runHarness, LAUNCH_ARGS } from './run.mjs';
import { startServer } from './server.mjs';
import { runNetworkRegression } from './network-regression.mjs';
import { runDoorRegression } from './door-regression.mjs';
import { runWeaponRegression } from './weapon-regression.mjs';
import { runPostfxRegression } from './postfx-regression.mjs';
import { runNPCRegression } from './npc-regression.mjs';
import { runArmsRegression } from './arms-regression.mjs';
import { configureAudioOutput, DEFAULT_AUDIO_SINK, validateAudioSink } from './audio-output.mjs';
import { deadline } from './actions.mjs';
import { gpuInfo } from './metrics.mjs';

export const AUDIO_CLOCK_CONFIG = Object.freeze({ observationMs: 6000, minimumProgressRatio: 0.5 });

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--out','--only','--audio-sink'].includes(args[i]) || !args[i+1]) throw new Error('Usage: node suite.mjs [--out /new/output] [--only selftest,world,arms,npc,...] [--audio-sink none|default]');
  options[args[i].slice(2)] = args[i+1];
}
await mkdir(WORK_ROOT, { recursive: true });
const out = options.out ? await prepareOutput(options.out) : await mkdtemp(path.join(WORK_ROOT, 'suite-'));
const only = options.only?.split(','), records = [];
const audioSink = validateAudioSink(options['audio-sink'] ?? DEFAULT_AUDIO_SINK);
const suites = ['world', 'world-legacy', 'weapon-model', 'character', 'weapon', 'postfx', 'lightmaps', 'app', 'app-lightmaps', 'arms-shots', 'npc-shots'];
const names = ['presets', 'selftest', ...suites, 'mobile', 'doors', 'inertia', 'postfx-regression', 'arms', 'npc', 'network', 'audio', 'source-integrity'];
const allowedNames = [...names, 'audio-default'];
if (only?.some(name => !allowedNames.includes(name))) throw new Error(`Unknown group: ${only.filter(name => !allowedNames.includes(name))}`);
const selected = name => !only || only.includes(name);
const writeJSON = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const report = { status: 'running', startedAt: new Date().toISOString(), out, completeSuite: !only,
  selection: only ?? names, records, environment: { platform: process.platform, arch: process.arch, node: process.version, port: 8969, audioSink }, sourceHashes: {} };
async function hashes(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '__pycache__'].includes(entry.name) || dir === path.join(PUBLIC_ROOT, 'bodycam-demo') && entry.name === 'audio') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await hashes(file);
    else report.sourceHashes[path.relative(REPO_ROOT, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
}
await hashes(HARNESS_DIR); await hashes(path.join(PUBLIC_ROOT, 'bodycam-demo'));
const initialHashes = { ...report.sourceHashes };
const save = () => writeJSON(path.join(out, 'suite.json'), report);
async function group(name, action) {
  if (!selected(name)) return;
  const entry = { name, status: 'running', startedAt: new Date().toISOString() };
  records.push(entry); await save(); console.log(`RUN ${name}`);
  try { Object.assign(entry, await action()); }
  catch (error) { entry.status = 'failed'; entry.error = error.stack; }
  entry.finishedAt = new Date().toISOString();
  console.log(`${entry.status.toUpperCase()} ${name}${entry.summary ? ': ' + entry.summary : ''}`); await save();
}
async function command(name, argv) {
  const child = spawn(process.execPath, argv, { cwd: REPO_ROOT, stdio: ['ignore','pipe','pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  await writeFile(path.join(out, `${name}.log`), stdout + stderr);
  return { status: code === 0 ? 'passed' : 'failed', exitCode: code, log: `${name}.log` };
}
await group('presets', () => command('presets', [path.join(HARNESS_DIR, 'generate-shots.mjs'), '--check']));
await group('selftest', () => command('selftest', [path.join(HARNESS_DIR, 'selftest.mjs')]));
for (const name of suites) await group(name, async () => {
  const result = await runHarness({ shots: path.join(HARNESS_DIR, 'shots', `${name}.json`), out: path.join(out, name), port: 8969, audioSink, readyTimeoutMs: 120000 });
  return { status: result.report.status, report: `${name}/report.json`, summary: JSON.stringify(result.report.summary), exitCode: result.exitCode };
});
await group('mobile', () => command('mobile', [path.join(HARNESS_DIR, 'mobile-check.mjs'), path.join(out, 'mobile')]));

async function regression(name, callback) {
  return group(name, async () => {
    const dir = path.join(out, name); await mkdir(dir);
    let server, browser, page, closing = false;
    const diagnostics = { console: [], pageErrors: [], failedRequests: [], httpErrors: [] };
    let result = { checks: [] };
    try {
      server = await startServer(PUBLIC_ROOT, 8969);
      browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH, args: LAUNCH_ARGS });
      page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
      page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(120000);
      page.on('console', message => diagnostics.console.push({ type: message.type(), text: message.text() }));
      page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
      // Background downloads (all sounds, full-resolution textures and lightmaps after ready) still in flight
      // when a test navigates away are aborted by the browser, not failed.
      const navigationAbort = request => request.failure()?.errorText === 'net::ERR_ABORTED'
        && /\/bodycam-demo\/(audio\/[^/]+\.ogg|lightmaps\/[^/]+\.(png|webp)|textures\/.+\.(jpg|webp))$/.test(new URL(request.url()).pathname);
      page.on('requestfailed', request => { if (!closing && !navigationAbort(request)) diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }); });
      page.on('response', response => { if (response.status() >= 400) diagnostics.httpErrors.push({ url: response.url(), status: response.status() }); });
      result = await deadline(callback({ page, origin: server.origin, out: dir, audioSink }), 600000, name);
      result.environment = { browser: browser.version(), gpu: await gpuInfo(page), launchArgs: LAUNCH_ARGS };
      if (!result.environment.gpu.hardware) result.checks.push({ name: 'hardware-gpu', passed: false, details: result.environment.gpu });
      await page.waitForTimeout(200);
    } catch (error) { result.checks.push({ name: 'uncaught', passed: false, details: error.stack }); }
    finally {
      closing = true;
      if (page && !page.isClosed()) await page.screenshot({ path: path.join(dir, 'final.png'), timeout: 5000 }).catch(() => {});
      for (const cleanup of [() => browser?.close(), () => server?.close()]) {
        try { await cleanup(); }
        catch (error) { result.checks.push({ name: 'cleanup', passed: false, details: error.stack }); }
      }
    }
    const errorCount = diagnostics.console.filter(item => item.type === 'error').length + diagnostics.pageErrors.length + diagnostics.failedRequests.length + diagnostics.httpErrors.length;
    result.checks.push({ name: 'browser-diagnostics', passed: errorCount === 0, details: diagnostics });
    result.status = result.checks.every(check => check.passed) ? 'passed' : 'failed';
    await writeJSON(path.join(dir, 'report.json'), result);
    return { status: result.status, report: `${name}/report.json`, summary: `${result.checks.filter(c => c.passed).length}/${result.checks.length} checks`, failures: result.checks.filter(c => !c.passed) };
  });
}
await regression('doors', runDoorRegression);
await regression('inertia', runWeaponRegression);
await regression('postfx-regression', runPostfxRegression);
await regression('arms', runArmsRegression);
await regression('npc', runNPCRegression);
await group('network', async () => {
  const dir = path.join(out, 'network'); await mkdir(dir);
  const result = await runNetworkRegression({ out: dir });
  const status = result.checks.every(c => c.passed) ? 'passed' : 'failed';
  await writeJSON(path.join(dir, 'report.json'), result);
  return { status, report: 'network/report.json', summary: `${result.checks.filter(c => c.passed).length}/${result.checks.length} checks`, failures: result.checks.filter(c => !c.passed) };
});
async function audioClock({ page, origin }, sink) {
  await page.goto(`${origin}/bodycam-demo/?debug=1&quality=low`);
  await page.waitForFunction(() => window.__bodycam?.ready === true);
  const output = await configureAudioOutput(page, sink);
  const before = await page.evaluate(async () => {
    const a=window.__bodycam; await a.resume();
    const c=a.dev.audio.context;
    return { time: c.currentTime, sinkId:typeof c.sinkId==='string' ? c.sinkId : {type:c.sinkId.type}, state:c.state };
  });
  await page.waitForTimeout(AUDIO_CLOCK_CONFIG.observationMs);
  const after = await page.evaluate(() => ({ time: window.__bodycam.dev.audio.context.currentTime, audio:window.__bodycam.stats().audio }));
  const elapsedSeconds = after.time - before.time;
  return { checks:[{ name:`${sink}-device-audio-clock`, passed:elapsedSeconds > AUDIO_CLOCK_CONFIG.observationMs / 1000 * AUDIO_CLOCK_CONFIG.minimumProgressRatio,
    details:{output,before,after,elapsedSeconds,...AUDIO_CLOCK_CONFIG} }] };
}
await regression('audio', context => audioClock(context, audioSink));
if (only?.includes('audio-default')) await regression('audio-default', context => audioClock(context, 'default'));
await group('source-integrity', async () => {
  report.sourceHashes = {};
  await hashes(HARNESS_DIR); await hashes(path.join(PUBLIC_ROOT, 'bodycam-demo'));
  report.sourceHashesAfter = report.sourceHashes;
  report.sourceHashes = initialHashes;
  const changed = [...new Set([...Object.keys(initialHashes), ...Object.keys(report.sourceHashesAfter)])]
    .filter(file => initialHashes[file] !== report.sourceHashesAfter[file]);
  return { status: changed.length ? 'failed' : 'passed', summary: `${Object.keys(initialHashes).length} files, ${changed.length} changed`, changed };
});
report.status = records.every(r => r.status === 'passed') ? 'passed' : 'failed';
report.finishedAt = new Date().toISOString();
await save();
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await writeFile(path.join(out,'index.html'), `<!doctype html><meta charset="utf-8"><title>C20 Regression</title><style>body{font:16px system-ui;margin:30px;background:#171b20;color:#eee}a{color:#a9d3ff}td,th{text-align:left;padding:10px;border-bottom:1px solid #555}table{border-collapse:collapse}pre{white-space:pre-wrap}</style><h1>C20: ${report.status}</h1><p>${escape(report.startedAt)}; complete suite: ${report.completeSuite}; audio: ${escape(audioSink)}</p><table><tr><th>Group</th><th>Status</th><th>Evidence</th></tr>${records.map(r=>`<tr><td>${escape(r.name)}</td><td>${r.status}</td><td><a href="${escape(r.report ?? r.log ?? 'suite.json')}">${escape(r.summary ?? 'Report')}</a>${r.report?.endsWith('/report.json') && suites.includes(r.name)?` <a href="${r.name}/report.html">Images</a>`:''}</td></tr>`).join('')}</table><p><a href="suite.json">Raw suite report and source SHA-256</a></p>`);
console.log(`${report.status}: ${records.filter(r => r.status === 'passed').length}/${records.length} groups. ${out}/index.html`);
process.exitCode = report.status === 'passed' ? 0 : 1;
