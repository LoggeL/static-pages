#!/usr/bin/env node
// node public/bodycam-demo/_dev/audio/run.mjs [http://127.0.0.1:8952/bodycam-demo/_dev/audio/]
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright');
const target = process.argv[2] || 'http://127.0.0.1:8952/bodycam-demo/_dev/audio/';
const output = process.env.C4_OUTPUT || '/Users/logge/Documents/Projects/bodycam-work/codex/C4';
const executablePath = process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const report = { target, at: new Date().toISOString(), results: [], consoleErrors: [], pageErrors: [] };
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  let fallbackMode = false;
  const network = { files: [], fallback404: [] };
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => {
    // Chromium logs missing resources; the 404 pass deliberately exercises those.
    if (message.type() === 'error' && !(fallbackMode && message.text().includes('404'))) report.consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (/\/audio\/.*\.(?:ogg|mp3|wav)(?:[?#]|$)/.test(response.url()))
      network[fallbackMode ? 'fallback404' : 'files'].push({ url: response.url(), status: response.status() });
  });
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.audioTest?.ready, { timeout: 20000 });
  report.adapter = await page.evaluate(() => window.audioTest.validateAdapter());
  await page.click('#unlock');
  await page.waitForFunction(() => window.audioTest.getLiveDiagnostics() !== null, { timeout: 60000 });
  for (const event of await page.evaluate(() => window.audioTest.events)) await page.click(`[data-event="${event}"]`);
  report.live = await page.evaluate(() => window.audioTest.getLiveDiagnostics());
  await page.click('#stop');
  await page.waitForFunction(() => window.audioTest.getLiveDiagnostics() === null);
  for (const fallback of [false, true]) {
    fallbackMode = fallback;
    if (fallback) await page.route('**/audio/*.ogg', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Deliberate C4 missing-audio test' }));
    const result = await page.evaluate(async (missing) => {
      const result = await window.audioTest.runOffline({ fallback: missing, simulate404: false, includeWav: true });
      window.audioTest.showResult(result);
      return result;
    }, fallback);
    const { wavBase64, downloadUrl, ...summary } = result;
    const stem = fallback ? 'fallback-404' : 'files';
    await writeFile(path.join(output, `bodycam-c4-${stem}.wav`), Buffer.from(wavBase64, 'base64'));
    await writeFile(path.join(output, `bodycam-c4-${stem}.json`), JSON.stringify(summary, null, 2) + '\n');
    await page.screenshot({ path: path.join(output, `bodycam-c4-${stem}.png`), fullPage: true });
    if (summary.metrics.nonFinite || !summary.metrics.rms || summary.metrics.peak > 10 ** (summary.ceilingDb / 20) + 0.001 || summary.metrics.clippingRatio !== 0)
      throw new Error(`${stem}: nicht-endliche, stumme oder übersteuernde Ausgabe: ${JSON.stringify(summary.metrics)}`);
    const covered = new Set(summary.events.map(event => event.event));
    if (await page.evaluate(events => window.audioTest.events.some(event => !events.includes(event)), [...covered])) throw new Error(`${stem}: Bus-Ereignis fehlt in der Sequenz.`);
    report.results.push(summary);
    console.log(`${stem}: Peak ${summary.metrics.peakDbfs.toFixed(2)} dBFS, RMS ${summary.metrics.rmsDbfs.toFixed(2)} dBFS, Clipping ${summary.metrics.clippingRatio}`);
  }
  report.network = network;
  if (!network.files.length || network.files.some(item => item.status !== 200)) throw new Error('Dateitest hat fehlgeschlagene oder keine Audioantworten.');
  if (!network.fallback404.length || network.fallback404.some(item => item.status !== 404)) throw new Error('Fallbacktest hat keine konsistenten echten HTTP-404-Antworten.');
  if (report.pageErrors.length || report.consoleErrors.length) throw new Error('Unerwartete Browserfehler.');
  report.passed = true;
} catch (error) {
  failed = true; report.passed = false; report.error = error.stack || String(error); console.error(report.error);
} finally {
  await writeFile(path.join(output, 'audio-report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
if (failed) process.exitCode = 1;
