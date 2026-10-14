#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { parseArgs, loadConfig, HELP } from './config.mjs';
import { prepareOutput, localPage } from './paths.mjs';
import { startServer } from './server.mjs';
import { deadline, executeAction, readStats, waitForReady } from './actions.mjs';
import { gpuInfo, measureFrames } from './metrics.mjs';
import { writeReportHtml } from './report.mjs';
import { configureAudioOutput } from './audio-output.mjs';

export const LAUNCH_ARGS = [
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
];
const errorInfo = error => ({ message: error?.message ?? String(error), stack: error?.stack ?? null });
const slug = name => name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'shot';

export async function runHarness(options) {
  const { config, doc, overrides } = await loadConfig(options);
  const output = await prepareOutput(config.out);
  config.out = output;
  const report = {
    version: 1, status: 'failed', startedAt: new Date().toISOString(), finishedAt: null,
    page: config.page, url: null, config: { ...config, viewport: { width: config.width, height: config.height } },
    environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), launchArgs: LAUNCH_ARGS },
    input: { shotsFile: config.shots, sha256: createHash('sha256').update(await readFile(config.shots)).digest('hex'), document: doc },
    console: [], pageErrors: [], responses: [], completedRequests: [], failedRequests: [], httpErrors: [], fatalErrors: [], shots: [], summary: {},
  };
  let server, browser, page, currentShot = null, phase = 'startup', closing = false, interrupted = null;
  const diagnostic = data => ({ time: new Date().toISOString(), shot: currentShot, phase, ...data });
  const signalHandler = signal => {
    interrupted = signal;
    void browser?.close().catch(() => {});
  };
  const onInt = () => signalHandler('SIGINT');
  const onTerm = () => signalHandler('SIGTERM');
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  const ensureActive = () => { if (interrupted) throw new Error(`Lauf abgebrochen: ${interrupted}`); };
  try {
    await writeFile(path.join(output, 'shots.json'), `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx' });
    server = await startServer(config.root, config.port);
    ensureActive();
    report.url = `${server.origin}${config.page}`;
    browser = await chromium.launch({ headless: true, executablePath: config.browser, args: LAUNCH_ARGS, timeout: config.readyTimeoutMs, handleSIGINT: false, handleSIGTERM: false });
    ensureActive();
    report.environment.browserVersion = browser.version();
    const context = await browser.newContext({
      viewport: report.config.viewport, deviceScaleFactor: config.deviceScaleFactor,
      locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block',
    });
    page = await context.newPage();
    page.setDefaultTimeout(config.actionTimeoutMs);
    page.setDefaultNavigationTimeout(config.readyTimeoutMs);
    page.on('console', message => report.console.push(diagnostic({ type: message.type(), text: message.text(), location: message.location() })));
    page.on('pageerror', error => report.pageErrors.push(diagnostic(errorInfo(error))));
    page.on('requestfailed', request => {
      if (!closing) report.failedRequests.push(diagnostic({ url: request.url(), method: request.method(), error: request.failure()?.errorText ?? 'unknown' }));
    });
    page.on('requestfinished', request => report.completedRequests.push(diagnostic({ url: request.url(), method: request.method(), resourceType: request.resourceType() })));
    page.on('response', response => {
      report.responses.push(diagnostic({ url: response.url(), status: response.status(), contentLength: response.headers()['content-length'] ?? null }));
      if (response.status() >= 400) report.httpErrors.push(diagnostic({ url: response.url(), status: response.status(), statusText: response.statusText() }));
    });
    page.on('crash', () => report.fatalErrors.push(diagnostic({ message: 'Chromium-Tab abgestürzt.' })));

    const performActions = async (actions, results) => {
      for (const action of actions ?? []) {
        ensureActive();
        const record = { ...action, status: 'running' };
        results.push(record);
        try {
          const result = await executeAction(page, action, config.actionTimeoutMs);
          // Hooks may return browser objects; evaluate results are diagnostic only.
          try { record.result = result === undefined ? null : JSON.parse(JSON.stringify(result)); }
          catch { record.result = '[Not JSON serializable]'; }
          record.status = 'passed';
        } catch (error) { record.status = 'failed'; record.error = errorInfo(error); throw error; }
      }
    };
    const navigate = async relative => {
      phase = 'navigation';
      const target = `${server.origin}${localPage(relative)}`;
      const response = await page.goto(target, { waitUntil: 'load' });
      if (!response?.ok()) throw new Error(`Seite nicht ladbar: HTTP ${response?.status() ?? 'keine Antwort'} (${target})`);
      phase = 'beforeReady';
      const startupActions = [];
      report.startupActions ??= [];
      report.startupActions.push({ url: target, actions: startupActions });
      await performActions(doc.beforeReady, startupActions);
      phase = 'ready';
      await waitForReady(page, config.readyTimeoutMs);
      report.audioOutputs ??= [];
      report.audioOutputs.push({ url: target, ...await configureAudioOutput(page, config.audioSink) });
      phase = 'setup';
      await performActions(doc.setup, startupActions);
    };
    await navigate(config.page);
    phase = 'gpu';
    report.environment.gpu = await deadline(gpuInfo(page), config.actionTimeoutMs, 'GPU-Prüfung');
    const session = await browser.newBrowserCDPSession();
    try {
      const { gpu } = await session.send('SystemInfo.getInfo');
      report.environment.gpu.cdp = { devices: gpu.devices, featureStatus: gpu.featureStatus, auxAttributes: gpu.auxAttributes };
    } finally { await session.detach(); }
    if (!report.environment.gpu.hardware) throw new Error(`Echte ANGLE/Metal-GPU nicht bestätigt: ${JSON.stringify(report.environment.gpu)}`);

    for (const [index, shot] of doc.shots.entries()) {
      ensureActive();
      currentShot = shot.name;
      const entry = { name: shot.name, description: shot.description ?? '', status: 'failed', screenshot: null, actions: [], performance: null, stats: null, errors: [], source: shot.source ?? null };
      report.shots.push(entry);
      try {
        if (shot.page) await navigate(shot.page);
        entry.url = page.url();
        phase = 'actions';
        const actions = [];
        if (shot.teleport) actions.push({ type: 'teleport', position: shot.teleport.slice(0, 3), yawDeg: shot.teleport[3] ?? 0, pitchDeg: shot.teleport[4] ?? -4 });
        if (shot.look) actions.push({ type: 'look', yawDeg: shot.look[0], pitchDeg: shot.look[1] });
        actions.push(...shot.actions ?? []);
        await performActions(actions, entry.actions);
        const settleMs = overrides.settleMs ?? shot.settleMs ?? config.settleMs;
        const measureSeconds = overrides.measureSeconds ?? shot.measureSeconds ?? config.measureSeconds;
        entry.settings = { settleMs, measureSeconds };
        phase = 'settle';
        await page.waitForTimeout(settleMs);
        phase = 'screenshot';
        const filename = `${String(index + 1).padStart(3, '0')}-${slug(shot.name)}.png`;
        await page.screenshot({ path: path.join(output, filename), type: 'png', fullPage: false, timeout: config.actionTimeoutMs });
        entry.screenshot = filename;
        phase = 'stats';
        entry.stats = await readStats(page, config.actionTimeoutMs);
        if (entry.stats?.issues?.length) throw new Error(`App reports issues: ${JSON.stringify(entry.stats.issues)}`);
        const actualRoom = entry.stats?.room?.id ?? entry.stats?.room;
        if (shot.source?.room && actualRoom !== shot.source.room) throw new Error(`Expected room ${shot.source.room}, got ${JSON.stringify(actualRoom)}`);
        phase = 'measurement';
        entry.performance = await deadline(measureFrames(page, measureSeconds), measureSeconds * 1000 + config.actionTimeoutMs + 5000, 'rAF-Messung');
        entry.statsAfterMeasurement = await readStats(page, config.actionTimeoutMs);
        entry.status = 'passed';
      } catch (error) {
        entry.errors.push(diagnostic(errorInfo(error)));
        // Promise.race cannot cancel JavaScript inside the tab. Discard that tab
        // instead of letting late mutations contaminate later measurements.
        if (error.code === 'HARNESS_TIMEOUT' || error.name === 'TimeoutError') throw error;
      }
    }
    phase = 'drain';
    // Give deferred diagnostics a bounded final observation window.
    await page.waitForTimeout(200);
    ensureActive();
  } catch (error) {
    report.fatalErrors.push(diagnostic(errorInfo(error)));
    if (page && !page.isClosed()) {
      try { await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }); report.failureScreenshot = 'failure.png'; } catch { /* Browser itself may have failed. */ }
    }
  }
  finally {
    closing = true;
    phase = 'cleanup';
    for (const cleanup of [() => browser?.close(), () => server?.close()]) {
      try { await cleanup(); } catch (error) {
    report.fatalErrors.push(diagnostic(errorInfo(error)));
    if (page && !page.isClosed()) {
      try { await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }); report.failureScreenshot = 'failure.png'; } catch { /* Browser itself may have failed. */ }
    }
  }
    }
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
  // Async console/request failures are attributed after the entire observation window.
  for (const shot of report.shots) {
    const errors = [report.console.filter(item => item.type === 'error'), report.pageErrors, report.failedRequests, report.httpErrors];
    if (errors.some(items => items.some(item => item.shot === shot.name))) shot.status = 'failed';
  }
  report.summary = {
    consoleErrors: report.console.filter(item => item.type === 'error').length,
    pageErrors: report.pageErrors.length, failedRequests: report.failedRequests.length,
    httpErrors: report.httpErrors.length, shotErrors: report.shots.filter(shot => shot.status !== 'passed').length,
    fatalErrors: report.fatalErrors.length, shotsPlanned: doc.shots.length, shotsCaptured: report.shots.filter(shot => shot.screenshot).length,
  };
  report.status = Object.entries(report.summary).some(([key, value]) => !key.startsWith('shots') && value > 0) || report.shots.length !== doc.shots.length ? 'failed' : 'passed';
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await writeReportHtml(report, output);
  return { report, output, exitCode: report.status === 'passed' ? 0 : 1 };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) { console.log(HELP); return 0; }
    const { report, output, exitCode } = await runHarness(options);
    console.log(`${report.status}: ${report.summary.shotsCaptured}/${report.summary.shotsPlanned} PNGs, ${report.summary.consoleErrors} Konsolenfehler, ${report.summary.pageErrors} JS-Fehler, ${report.summary.failedRequests + report.summary.httpErrors} Request-/HTTP-Fehler.\n${path.join(output, 'report.html')}`);
    for (const error of report.fatalErrors) console.error(error.message);
    return exitCode;
  } catch (error) { console.error(`Harness: ${error.message}`); return 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
