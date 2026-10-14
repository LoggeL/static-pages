#!/usr/bin/env node
// Real Chromium touch contacts, production assets and controlled network failures.
import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './server.mjs';
import { CHROMIUM_PATH, PUBLIC_ROOT, prepareOutput } from './paths.mjs';
import { LAUNCH_ARGS } from './run.mjs';
import { createQualityController, renderTier } from '../../../../public/bodycam-demo/js/app/quality.js';

const out = await prepareOutput(process.argv[2]);
const remote = process.argv[3];
const report = { checks: [], scenarios: [], startedAt: new Date().toISOString() };
let browser, server;
function check(name, passed, details) {
  report.checks.push({ name, passed, details }); assert.ok(passed, `${name}: ${JSON.stringify(details)}`);
}
async function scenario(name, task) {
  console.log(`RUN ${name}`);
  try { await task(); report.scenarios.push({ name, passed: true }); }
  catch (error) { report.scenarios.push({ name, passed: false, error: error.stack }); console.log(error.stack); }
  console.log(`${report.scenarios.at(-1).passed ? 'PASS' : 'FAIL'} ${name}`);
}
async function ready(page) {
  await page.waitForFunction(() => window.__bodycam?.ready === true, { timeout: 120000 });
  await page.evaluate(() => window.__bodycam.setVolume(0));
}
async function begin(page) {
  await page.locator('.app-start').tap();
  await page.waitForFunction(() => window.__bodycam.stats().phase === 'playing');
  await page.waitForTimeout(1500);
}
const stats = page => page.evaluate(() => window.__bodycam.stats());
async function touchSession(page) {
  const cdp = await page.context().newCDPSession(page), points = new Map();
  return {
    async start(id, x, y) { points.set(id, { id, x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...points.values()] }); },
    async move(id, x, y) { points.set(id, { id, x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...points.values()] }); },
    async end(id) { points.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...points.values()] }); },
    async cancel() { if (!points.size) return; points.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); },
    async close() { await cdp.detach(); },
  };
}
async function center(page, selector) {
  const b = await page.locator(selector).boundingBox(); assert.ok(b, selector);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width, height: b.height };
}
try {
  if (!remote) server = await startServer(PUBLIC_ROOT, 8974);
  const base = remote ?? `${server.origin}/bodycam-demo/`;
  report.url = base;
  browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH, args: LAUNCH_ARGS });
  await scenario('quality-controller', async () => {
    check('software-renderer-detected', renderTier('Google SwiftShader') === 'software');
    const q = createQualityController({ config: { warmupMs: 100, windowMs: 100, settleMs: 100 } });
    for (let n = 0; n < 20; n++) q.sample(50);
    check('sustained-slow-frames-reduce-cost', q.snapshot().quality === 'low' && q.snapshot().scale < 1, q.snapshot());
    const before = JSON.stringify(q.snapshot()); q.sample(2000);
    check('tab-gap-ignored', JSON.stringify(q.snapshot()) === before);
    for (let n = 0; n < 400; n++) q.sample(16);
    check('headroom-recovers-quality', q.snapshot().quality === 'high' && q.snapshot().scale === 1);
    q.setMode('medium'); for (let n = 0; n < 100; n++) q.sample(100);
    check('manual-quality-preserved', q.snapshot().quality === 'medium' && q.snapshot().scale === 1);
  });
  for (const [name, size] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }], ['tablet', { width: 1024, height: 768 }]]) {
    await scenario(`touch-${name}`, async () => {
      const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors = [];
      const moduleUrls = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        const url = new URL(request.url());
        if (request.url().startsWith(base) && url.pathname.includes('/js/') && url.pathname.endsWith('.js')) moduleUrls.push(url.href);
      });
      let contacts;
      try {
        await page.goto(`${base}?debug=1`); await ready(page);
        const initial = await stats(page);
        check(`${name}-auto-touch-and-light-graphics`, initial.controls === 'touch' && initial.graphics.tier === 'mobile' && initial.quality === 'low', initial.graphics);
        check(`${name}-versioned-modules`, moduleUrls.length > 30 && moduleUrls.every(url => /^[a-f0-9]{12}$/.test(new URL(url).searchParams.get('v'))), moduleUrls);
        await begin(page);
        if (name === 'portrait') {
          const osd = await page.evaluate(() => window.__bodycam.dev.post.overlay.metrics);
          check('portrait-osd-fits', osd.left.x >= 0 && osd.right.right <= size.width && osd.left.right < osd.right.x, { left: osd.left, right: osd.right });
        }
        const targets = await page.locator('.touch-button:visible').evaluateAll(nodes => nodes.map(node => {
          const r = node.getBoundingClientRect();
          return { label: node.textContent, width: r.width, height: r.height,
            inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
            hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node };
        }));
        check(`${name}-usable-targets`, targets.every(t => t.width >= 44 && t.height >= 44 && t.inside && t.hit), targets);
        contacts = await touchSession(page);
        const move = await center(page, '.touch-move'), fire = await center(page, '[data-touch="fire"]');
        const look = { x: size.width * 0.6, y: size.height * 0.4 };
        const before = await stats(page);
        await contacts.start(1, move.x, move.y); await contacts.move(1, move.x, move.y - move.width * 0.32);
        await contacts.start(2, look.x, look.y); await contacts.move(2, look.x + 45, look.y - 8);
        await contacts.start(3, fire.x, fire.y);
        await page.waitForTimeout(650);
        const after = await stats(page);
        check(`${name}-simultaneous-move-look-fire`, Math.hypot(after.position[0] - before.position[0], after.position[2] - before.position[2]) > 0.2 && Math.abs(after.yawDeg - before.yawDeg) > 5 && after.weapon.shots > before.weapon.shots && after.weapon.triggerHeld,
          { before: { position: before.position, yaw: before.yawDeg, shots: before.weapon.shots }, after: { position: after.position, yaw: after.yawDeg, shots: after.weapon.shots, held: after.weapon.triggerHeld } });
        await contacts.cancel(); await page.waitForTimeout(150);
        check(`${name}-cancel-releases`, !(await stats(page)).weapon.triggerHeld && await page.evaluate(() => window.__bodycam.dev.input.getMoveAxes() === null));
        if (name === 'landscape') {
          const distance = async fraction => {
            await page.evaluate(() => window.__bodycam.teleport(4.6, -0.22, 11, 0, -4));
            const before = await stats(page);
            await contacts.start(8, move.x, move.y); await contacts.move(8, move.x, move.y - move.width * fraction);
            await page.waitForTimeout(450); await contacts.end(8);
            const after = await stats(page);
            return Math.hypot(after.position[0] - before.position[0], after.position[2] - before.position[2]);
          };
          const partial = await distance(0.18), full = await distance(0.36);
          check('analog-stick-speed', partial > 0.05 && full > partial * 1.6, { partial, full });
          await page.evaluate(() => window.__bodycam.teleport(4.6, -0.22, 11, 90, -4));
          await contacts.start(9, move.x, move.y); await contacts.move(9, move.x, move.y - move.width * 0.36);
          await page.waitForTimeout(450); await contacts.end(9);
          const heading = await stats(page);
          check('heading-relative-forward', heading.position[0] < 4.3 && Math.abs(heading.position[2] - 11) < 0.08, heading.position);
        }
        await page.locator('[data-touch="aim"]').tap(); await page.waitForTimeout(200);
        check(`${name}-aim-toggle`, (await stats(page)).weapon.ads === true);
        await page.locator('[data-touch="crouch"]').tap(); await page.waitForTimeout(200);
        check(`${name}-crouch-toggle`, (await stats(page)).crouched === true);
        await page.locator('[data-touch="light"]').tap();
        check(`${name}-flashlight`, (await stats(page)).weapon.light === true);
        await page.locator('[data-touch="reload"]').tap(); await page.waitForTimeout(150);
        check(`${name}-reload`, (await stats(page)).weapon.state === 'reload');
        await page.locator('[data-touch="more"]').tap();
        check(`${name}-extra-actions`, await page.locator('[data-touch="lean-left"]').isVisible() && await page.locator('[data-touch="firemode"]').isVisible());
        await page.locator('[data-touch="more"]').tap();
        await page.screenshot({ path: path.join(out, `${name}.png`) });
        await contacts.start(4, fire.x, fire.y);
        await page.evaluate(() => window.__bodycam.pause()); await contacts.cancel();
        check(`${name}-pause-resets-input`, (await stats(page)).phase === 'paused' && !(await stats(page)).weapon.triggerHeld && await page.locator('.touch-controls').isHidden());
        await begin(page);
        check(`${name}-resume-clears-toggles`, await page.locator('[data-touch="aim"]').getAttribute('aria-pressed') === 'false' && await page.locator('[data-touch="crouch"]').getAttribute('aria-pressed') === 'false');
        if (name === 'portrait') {
          await page.evaluate(() => window.__bodycam.dev.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
          await page.waitForSelector('#ui[data-state="error"]'); await contacts.cancel();
          check('context-loss-clears-touch-layer', await page.locator('.touch-controls').count() === 0);
          await Promise.all([page.waitForNavigation(), page.locator('.app-simple-restart').tap()]);
          await ready(page);
          const recovered = await stats(page);
          check('context-loss-simple-restart', recovered.ready && recovered.modules.world && recovered.modules.player && !recovered.modules.post && recovered.quality === 'low', { ready: recovered.ready, modules: recovered.modules, quality: recovered.quality });
        }
        await page.evaluate(() => window.__bodycam.dispose());
        check(`${name}-dispose-removes-controls`, await page.locator('.touch-controls').count() === 0);
        check(`${name}-no-page-errors`, errors.length === 0, errors);
      } finally { await contacts?.close(); await context.close(); }
    });
  }
  const manifest = JSON.parse(await readFile(path.join(PUBLIC_ROOT, 'bodycam-demo/data/sounds.json'), 'utf8'));
  const first = Object.values(manifest).find(x => x.files?.length).files[0];
  for (const kind of ['first-missing', 'first-corrupt', 'all-missing', 'manifest-missing', 'simple-graphics']) {
    await scenario(kind, async () => {
      const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
      const page = await context.newPage(); let oggRequests = 0;
      page.on('request', request => { if (new URL(request.url()).pathname.endsWith('.ogg')) oggRequests++; });
      try {
        if (kind === 'first-missing') await page.route(`${base}${first}`, route => route.fulfill({ status: 404, body: 'Missing' }));
        if (kind === 'first-corrupt') await page.route(`${base}${first}`, route => route.fulfill({ contentType: 'audio/ogg', body: 'Corrupt OGG' }));
        if (kind === 'all-missing') await page.route('**/audio/*.ogg', route => route.fulfill({ status: 404, body: 'Missing' }));
        if (kind === 'manifest-missing') await page.route('**/data/sounds.json', route => route.fulfill({ status: 404, body: 'Missing' }));
        await page.goto(`${base}?debug=1${kind === 'simple-graphics' ? '&postfx=0' : ''}`); await ready(page);
        await page.waitForFunction(() => { const a = window.__bodycam?.stats().audio; return a && a.pendingLoads === 0; }, null, { timeout: 30000 });
        const initial = await stats(page);
        if (kind.startsWith('first-')) check(`${kind}-other-recordings-preserved`, initial.audioMode === 'mixed' && initial.audio.decodedFiles > 0 && initial.audio.failed >= 1 && initial.audio.decodedBytes <= initial.audio.memoryBudgetBytes, { mode: initial.audioMode, decoded: initial.audio.decodedFiles, failed: initial.audio.failed });
        if (kind === 'all-missing' || kind === 'manifest-missing') check(`${kind}-bounded-synthesis`, initial.audioMode === 'synthetic' && initial.modules.audio && oggRequests <= 3, { mode: initial.audioMode, oggRequests });
        if (kind === 'simple-graphics') check('simple-graphics-world-still-playable', !initial.modules.post && initial.modules.world && initial.modules.player);
        await begin(page); await page.locator('[data-touch="fire"]').tap(); await page.waitForTimeout(250);
        const final = await stats(page);
        check(`${kind}-playable`, final.phase === 'playing' && final.weapon.shots > 0, { phase: final.phase, shots: final.weapon.shots });
        if (kind === 'all-missing' || kind === 'manifest-missing') check(`${kind}-replacement-sound-plays`, final.audio.synthesized > 0 && final.audio.history.some(x => x.name === 'rifle_shot_outdoor' && x.fallback), final.audio);
        await page.screenshot({ path: path.join(out, `${kind}.png`) });
      } finally { await context.close(); }
    });
  }
  if (!remote) await scenario('pointer-lock-denied', async () => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await context.newPage();
    try {
      await page.route(`${server.origin}/sandbox.html`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe style="position:fixed;inset:0;width:100%;height:100%;border:0" sandbox="allow-scripts allow-same-origin" src="${base}"></iframe>` }));
      await page.goto(`${server.origin}/sandbox.html`);
      const frame = page.frames().find(f => f.url().startsWith(base));
      await ready(frame); await frame.locator('.app-start').click();
      await frame.waitForFunction(() => window.__bodycam.stats().phase === 'playing');
      const s = await stats(frame);
      check('real-sandbox-denial-starts-screen-controls', s.controls === 'touch' && s.issues.some(x => x.id === 'pointer-lock') && await frame.locator('.touch-controls').isVisible(), { phase: s.phase, controls: s.controls, issues: s.issues });
    } finally { await context.close(); }
  });
} finally {
  await browser?.close(); await server?.close();
  report.finishedAt = new Date().toISOString();
  report.status = report.scenarios.every(s => s.passed) && report.checks.every(c => c.passed) ? 'passed' : 'failed';
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.scenarios.filter(s => !s.passed) }));
  if (report.status !== 'passed') process.exitCode = 1;
}
