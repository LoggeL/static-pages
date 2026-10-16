#!/usr/bin/env node
// Real WebKit, production mobile assets, native taps and explicit failure injection.
// Usage: node phone-check.mjs OUT [URL] [--case=normal-mobile]
// Owns one browser and port 8979 when URL is omitted. Run GPU checks sequentially.
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { access, readdir, writeFile } from 'node:fs/promises';
import { webkit, devices } from 'playwright-core';
import { PUBLIC_ROOT, prepareOutput } from './paths.mjs';
import { startServer } from './server.mjs';

const args = process.argv.slice(2);
const out = await prepareOutput(args[0]);
const remote = args.find((value, index) => index > 0 && !value.startsWith('--'));
const selected = args.filter(value => value.startsWith('--case=')).map(value => value.slice(7));
const report = { startedAt: new Date().toISOString(), checks: [], scenarios: [],
  method: 'Actual desktop WebKit with an iPhone touch context; native taps for start/fire/aim/pause. Stick drag is synthetic PointerEvents. GPU speed and memory limits of a physical phone are not emulated.' };
let browser, server;
function check(name, passed, details) {
  report.checks.push({ name, passed: Boolean(passed), details });
  assert.ok(passed, `${name}: ${JSON.stringify(details)}`);
}
async function executablePath() {
  if (process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;
  try { await access(webkit.executablePath()); return webkit.executablePath(); } catch {}
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  const candidates = (await readdir(cache)).filter(name => /^webkit-\d+$/.test(name)).sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)));
  for (const candidate of candidates) {
    const file = path.join(cache, candidate, process.platform === 'win32' ? 'Playwright.exe' : 'pw_run.sh');
    try { await access(file); return file; } catch {}
  }
  throw new Error('No installed WebKit runtime. Set PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH.');
}
const getStats = page => page.evaluate(() => window.__bodycam.stats());
async function ready(page, timeout = 20000) {
  await page.waitForFunction(() => window.__bodycam?.ready || window.__bodycam?.error, null, { timeout });
  const state = await page.evaluate(() => window.__bodycam?.error ?? null);
  assert.equal(state, null, state);
  await page.evaluate(() => window.__bodycam.setVolume(0));
}
async function begin(page) {
  await page.locator('.app-start').tap();
  await page.waitForFunction(() => window.__bodycam.stats().phase === 'playing', null, { timeout: 4000 });
  await page.waitForTimeout(500);
}
async function move(page) {
  const before = await getStats(page);
  await page.locator('.touch-move').evaluate(node => {
    const r = node.getBoundingClientRect(), common = { bubbles: true, cancelable: true, pointerId: 701, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    node.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    node.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 - r.width * 0.36 }));
  });
  await page.waitForTimeout(650);
  await page.locator('.touch-move').evaluate(node => node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 701, pointerType: 'touch', button: 0, buttons: 0 })));
  const after = await getStats(page);
  return { distance: Math.hypot(after.position[0] - before.position[0], after.position[2] - before.position[2]), before: before.position, after: after.position, grounded: after.grounded, collisionQueries: after.collisionQueries };
}
async function mapAndCollision(page, name) {
  const stats = await getStats(page);
  check(`${name}-real-baked-map`, stats.assets === 'mobile' && stats.modules.world && stats.modules.player && stats.world?.baked && stats.world.model === 'models/house.glb', { assets: stats.assets, modules: stats.modules, world: stats.world });
  check(`${name}-real-collision`, stats.world.collisionModel === 'models/house_collision.glb' && stats.world.staticTriangles > 20000 && stats.world.doors === 7, stats.world);
  return stats;
}
async function textureBudget(page) {
  return page.evaluate(() => {
    const textures = new Map();
    // Scene includes the camera's weapon/arms and all NPC instances. Shared textures count once.
    window.__bodycam.dev.scene.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) for (const value of Object.values(material || {})) {
        if (!value?.isTexture || textures.has(value.uuid)) continue;
        const image = value.image, baseBytes = image?.data?.byteLength ?? (image?.width || 0) * (image?.height || 0) * 4;
        textures.set(value.uuid, { name: value.name || value.userData?.path || image?.src || value.uuid, width: image?.width, height: image?.height, baseBytes, gpuBytes: Math.ceil(baseBytes * (value.generateMipmaps ? 4 / 3 : 1)) });
      }
    });
    const values = [...textures.values()];
    return { method: 'Deduplicated textures referenced by world, weapon, arms and NPC materials. Retained image/data bytes plus estimated GPU storage including mipmaps; excludes geometry, audio, post targets and process overhead.', count: values.length, decodedBytes: values.reduce((sum, texture) => sum + texture.baseBytes, 0), gpuBytes: values.reduce((sum, texture) => sum + texture.gpuBytes, 0), textures: values };
  });
}
async function scenario(name, setup, run) {
  if (selected.length && !selected.includes(name)) return;
  console.log(`RUN ${name}`);
  const entry = { name, checks: [], console: [], pageErrors: [], failedRequests: [], responses: [], requests: [], status: 'failed' };
  report.scenarios.push(entry);
  const context = await browser.newContext({ ...devices['iPhone 13 landscape'], deviceScaleFactor: 1, locale: 'de-DE', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('console', message => entry.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => entry.pageErrors.push(error.message));
  page.on('request', request => entry.requests.push(request.url()));
  page.on('requestfailed', request => entry.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => entry.responses.push({ url: response.url(), status: response.status() }));
  const started = Date.now();
  try {
    await setup?.(context, page, entry);
    const target = new URL(report.url); target.searchParams.set('debug', '1');
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await run(page, entry);
    check(`${name}-no-unhandled-errors`, !entry.pageErrors.length, entry.pageErrors);
    entry.status = 'passed';
  } catch (error) {
    entry.error = error.stack;
    try { await page.screenshot({ path: path.join(out, `${name}-failure.png`), timeout: 5000 }); } catch {}
    console.error(`${name}: ${error.message}`);
  } finally {
    entry.durationMs = Date.now() - started;
    try { entry.final = await page.evaluate(() => ({ text: document.body.innerText, stats: window.__bodycam?.stats ? window.__bodycam.stats() : window.__bodycam, probe: window.__phoneProbe, resources: performance.getEntriesByType('resource').map(value => ({ name: value.name, transferSize: value.transferSize, decodedBodySize: value.decodedBodySize })) })); } catch {}
    await context.close();
    console.log(`${entry.status.toUpperCase()} ${name} (${entry.durationMs} ms)`);
  }
}
function forceAudioState(state) {
    window.__phoneProbe = { created: 0, resumes: 0, suspends: 0, state };
    const Original = globalThis.AudioContext || globalThis.webkitAudioContext;
    class InterruptedContext extends Original {
      constructor(...options) { super(...options); window.__phoneProbe.created++; }
      get state() { return state; }
      resume() { window.__phoneProbe.resumes++; return new Promise(() => {}); }
      suspend() { window.__phoneProbe.suspends++; return new Promise(() => {}); }
    }
    globalThis.AudioContext = InterruptedContext;
}
try {
  if (!remote) server = await startServer(PUBLIC_ROOT, 8979);
  report.url = remote || `${server.origin}/bodycam-demo/`;
  report.executablePath = await executablePath();
  browser = await webkit.launch({ headless: true, executablePath: report.executablePath });
  report.browserVersion = browser.version();
  await scenario('normal-mobile', null, async (page, entry) => {
    await ready(page); entry.readyMs = await page.evaluate(() => performance.now());
    entry.initial = await mapAndCollision(page, 'normal');
    await begin(page);
    const budget = await textureBudget(page); entry.textureBudget = budget;
    check('scene-texture-cpu-plus-gpu-under-200MiB', budget.decodedBytes > 0 && budget.decodedBytes + budget.gpuBytes < 200 * 1024 ** 2, budget);
    const desktop = entry.requests.filter(value => { const url = new URL(value), root = new URL(report.url).pathname.replace(/\/?$/, '/'); return url.pathname.startsWith(root) && /^(models|textures|lightmaps)\//.test(url.pathname.slice(root.length)); });
    check('mobile-never-fetches-desktop-visual-assets', !desktop.length, desktop);
    const before = await getStats(page);
    await page.locator('[data-touch="fire"]').tap(); await page.waitForTimeout(200);
    check('native-webkit-touch-fire', (await getStats(page)).weapon.shots > before.weapon.shots);
    await page.locator('[data-touch="aim"]').tap(); await page.waitForTimeout(200);
    check('native-webkit-touch-aim', (await getStats(page)).weapon.ads === true);
    const movement = await move(page); check('mobile-stick-moves-real-player', movement.distance > 0.2 && movement.grounded, movement);
    await page.screenshot({ path: path.join(out, 'normal-mobile-playing.png') });
    check('touch-does-not-acquire-pointer-lock', await page.evaluate(() => !document.pointerLockElement));
    await page.locator('[data-touch="pause"]').tap();
    check('native-webkit-touch-pause', (await getStats(page)).phase === 'paused');
    check('normal-clean-browser', !entry.console.some(value => value.type === 'error') && !entry.failedRequests.length && !entry.responses.some(value => value.status >= 400), { console: entry.console, failed: entry.failedRequests });
  });
  await scenario('atlas-404', async (context, page, entry) => {
    await page.route('**/mobile/lightmaps/liv.{png,webp}', route => { entry.injected = route.request().url(); return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Intentional phone regression: absent atlas' }); });
  }, async (page, entry) => {
    await ready(page); const stats = await mapAndCollision(page, 'atlas404');
    check('single-missing-atlas-keeps-actual-map', Boolean(entry.injected) && stats.world.failedAtlases.length === 1 && stats.world.ordinaryLightingFallback, stats.world);
    await begin(page); const movement = await move(page);
    check('missing-atlas-player-still-moves', movement.distance > 0.2 && movement.grounded, movement);
    await page.screenshot({ path: path.join(out, 'atlas-404-playing.png') });
  });
  await scenario('no-decompression-stream', context => context.addInitScript(() => { window.__phoneNativeDS = globalThis.DecompressionStream; Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, writable: true, value: undefined }); }), async (page, entry) => {
    await ready(page); const stats = await mapAndCollision(page, 'noDS');
    check('noDS-still-has-all-lightmaps', stats.world.lightmapsActive && stats.world.atlases === 12 && stats.world.failedAtlases.length === 0, stats.world);
    entry.decoder = await page.evaluate(async () => {
      const { decodePngRgba8, rgbmToTexture, loadRgbmTexture } = await import(new URL('./js/world/rgbm.js', location.href));
      const level = window.__bodycam.world.level, definition = { ...level.lightmaps[0], range: level.lightmaps[0].range ?? level.lightmapEncoding.range, multiplierExponent: level.lightmaps[0].multiplierExponent ?? level.lightmapEncoding.multiplierExponent ?? 1 };
      const buffer = await (await fetch(new URL(`./mobile/${definition.path}`, location.href))).arrayBuffer();
      globalThis.DecompressionStream = window.__phoneNativeDS;
      const native = await decodePngRgba8(buffer);
      globalThis.DecompressionStream = undefined;
      const fallback = await decodePngRgba8(buffer);
      const a = rgbmToTexture(native, definition), b = rgbmToTexture(fallback, definition);
      const rgbaExact = native.rgba.length === fallback.rgba.length && native.rgba.every((value, index) => value === fallback.rgba[index]);
      const radianceExact = a.image.data.length === b.image.data.length && a.image.data.every((value, index) => value === b.image.data[index]);
      // Lossless WebP sibling (read back through WebGL2 where exact) must give the same radiance as the PNG.
      const c = await loadRgbmTexture(new URL(`./mobile/${definition.path}`, location.href).href, definition);
      const webpFormat = c.userData.format, webpExact = c.image.data.length === a.image.data.length && c.image.data.every((value, index) => value === a.image.data[index]);
      a.dispose(); b.dispose(); c.dispose();
      return { path: definition.path, width: native.width, height: native.height, bytes: native.rgba.length, rgbaExact, radianceExact, webpFormat, webpExact };
    });
    check('noDS-exact-RGBA-and-linear-radiance', entry.decoder.rgbaExact && entry.decoder.radianceExact, entry.decoder);
    check('webp-lightmap-matches-png', entry.decoder.webpExact, entry.decoder);
    await begin(page);
  });
  for (const state of ['suspended', 'interrupted']) await scenario(`audio-${state}-never-resolves`, context => context.addInitScript(forceAudioState, state), async (page, entry) => {
    await ready(page); await mapAndCollision(page, state);
    await page.waitForFunction(() => window.__phoneProbe.created > 0, null, { timeout: 10000 });
    await begin(page);
    entry.audioState = await page.evaluate(() => window.__phoneProbe);
    check(`${state}-audio-does-not-gate-start`, (await getStats(page)).phase === 'playing' && entry.audioState.created > 0, entry.audioState);
  });
  await scenario('audio-decode-never-resolves', context => context.addInitScript(() => {
    window.__phoneProbe = { decodeCalls: 0 };
    const Original = globalThis.AudioContext || globalThis.webkitAudioContext;
    Original.prototype.decodeAudioData = function () { window.__phoneProbe.decodeCalls++; return new Promise(() => {}); };
  }), async (page, entry) => {
    await ready(page); await mapAndCollision(page, 'decode');
    await page.waitForFunction(() => window.__phoneProbe.decodeCalls > 0, null, { timeout: 10000 });
    await begin(page); entry.audioProbe = await page.evaluate(() => window.__phoneProbe);
    check('unresolved-decode-does-not-gate-start', entry.audioProbe.decodeCalls > 0 && (await getStats(page)).phase === 'playing', entry.audioProbe);
  });
  await scenario('delayed-manifest-first-tap', async (context, page, entry) => {
    await context.addInitScript(() => {
      window.__phoneProbe = { resumes: 0 };
      const Original = globalThis.AudioContext || globalThis.webkitAudioContext, resume = Original.prototype.resume;
      Original.prototype.resume = function (...args) { window.__phoneProbe.resumes++; return resume.apply(this, args); };
    });
    await page.route('**/data/sounds.json', async route => {
      entry.manifestRequested = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000));
      entry.manifestReleased = Date.now();
      await route.continue();
    });
  }, async (page, entry) => {
    await ready(page); await mapAndCollision(page, 'delayed-audio');
    check('delayed-manifest-ready-before-download', Boolean(entry.manifestRequested) && !entry.manifestReleased);
    await begin(page);
    entry.firstTap = await page.evaluate(() => window.__phoneProbe);
    check('first-tap-resumes-retained-context', entry.firstTap.resumes > 0 && !entry.manifestReleased, entry.firstTap);
    await page.waitForFunction(() => window.__bodycam.stats().audio?.contextState === 'running', null, { timeout: 12000 });
    check('late-audio-starts-without-second-tap', (await getStats(page)).audio.unlocked === true);
  });
  await scenario('stalled-mobile-house', async (context, page, entry) => {
    entry.stalled = [];
    await page.route('**/mobile/models/house.glb', route => { entry.stalled.push(route.request().url()); });
  }, async (page, entry) => {
    await page.waitForFunction(() => window.__bodycam?.ready || document.querySelector('#ui')?.dataset.state === 'error', null, { timeout: 40000 });
    entry.outcome = await page.evaluate(() => ({ ready: window.__bodycam?.ready, error: window.__bodycam?.error, state: document.querySelector('#ui')?.dataset.state, retry: !document.querySelector('.app-simple-restart')?.hidden }));
    check('stalled-house-has-finite-recovery', entry.stalled.length > 0 && (entry.outcome.state === 'error' || entry.outcome.ready), entry.outcome);
    if (entry.outcome.ready) await mapAndCollision(page, 'stalled-retry');
    else check('stalled-house-error-offers-recovery', await page.locator('.app-simple-restart').isVisible());
    await page.screenshot({ path: path.join(out, 'stalled-mobile-house.png') });
  });
} catch (error) {
  report.error = error.stack;
  console.error(error.stack);
} finally {
  await browser?.close();
  await server?.close();
  report.finishedAt = new Date().toISOString();
  report.status = !report.error && report.scenarios.length > 0 && report.scenarios.every(value => value.status === 'passed') && report.checks.every(value => value.passed) ? 'passed' : 'failed';
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`${report.status}: ${report.checks.filter(value => value.passed).length}/${report.checks.length} checks, ${report.scenarios.filter(value => value.status === 'passed').length}/${report.scenarios.length} scenarios. ${path.join(out, 'report.json')}`);
process.exitCode = report.status === 'passed' ? 0 : 1;
