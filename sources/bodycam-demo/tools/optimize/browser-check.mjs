#!/usr/bin/env node
// Real-page C7 acceptance. No request routing, asset substitutes, or runtime mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, list) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), list[i + 1]]);
  return pairs;
}, []));
const directory = path.dirname(fileURLToPath(import.meta.url));
const label = args.label || 'after';
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error('Invalid --label');
const out = path.resolve(args.out || '/Users/logge/Documents/Projects/bodycam-work/codex/C7/browser', label);
const base = args.base || 'http://127.0.0.1:8957/bodycam-demo/';
const repeats = Number(args.repeats || 3);
if (!Number.isInteger(repeats) || repeats < 3) throw new Error('--repeats must be at least 3');
const executablePath = process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const modulePath = process.env.PLAYWRIGHT_MODULE || path.join(directory, '../harness/node_modules/playwright-core/index.mjs');
const { chromium } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { label, createdAt: new Date().toISOString(), base, repeats, viewport: [1280, 720],
  browser: await browser.version(), executablePath, launchArgs: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  methodology: 'Each sample uses a fresh browser context (cold HTTP cache). Navigation-to-ready is captured by polling the real ready signal from document start. loadMs is the original world-loader timer, excluding imports and first render. Local assets are actual model/texture/lightmap responses. No request interception. Screenshots use existing debug controls, fixed poses, and deterministic stepping where provided.',
  runs: [], summaries: {}, passed: false };
const pages = [
  ['world', '_dev/world/?debug=1'],
  ['weapon', '_dev/weapon/?debug=1&hall=1&inspect=1'],
  ['lightmaps', '_dev/lightmaps/'],
  ['app', '?debug=1&audio=synthetic'],
];
const poses = { exterior: [4.6, -0.22, 11, 26, -4], interior: [-0.28, 0.6, -1.6, 0, -4] };

async function stats(page) {
  return page.evaluate(() => {
    const api = window.__bodycam, state = api.stats();
    const world = api.dev?.world;
    const worldState = world ? (typeof world.stats === 'function' ? world.stats() : world.stats) : state.world;
    const gl = (api.dev?.renderer ?? window.__lightmaps?.renderer).getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { ...state, world: worldState, gpu: { version: gl.getParameter(gl.VERSION),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) },
      readyMs: window.__c7ReadyMs, browserNowMs: performance.now(),
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON() };
  });
}

async function screenshots(page, kind, run) {
  run.screenshots = [];
  async function shot(name) {
    const filename = `${kind}-${name}.png`;
    await page.screenshot({ path: path.join(out, filename) });
    run.screenshots.push({ filename, state: await stats(page) });
  }
  if (kind === 'app') {
    const start = page.locator('button[data-action="start"]');
    if (await start.count()) await start.click();
    else await page.getByRole('button', { name: /Starten|Fortsetzen/ }).first().click();
    await page.waitForFunction(() => window.__bodycam.stats().phase === 'playing');
    await page.evaluate(() => { __bodycam.setVolume(0); __bodycam.dev.freeze(true); });
  }
  if (kind === 'weapon') await page.evaluate(() => __bodycam.dev.pause(true));
  for (const [name, pose] of Object.entries(poses)) {
    await page.evaluate(({ kind, pose, name }) => {
      const api = window.__bodycam;
      if (kind === 'lightmaps') {
        window.__lightmaps.setCamera(pose[0], pose[1] + 1.4, ...pose.slice(2));
        window.__lightmaps.setInspection(name === 'interior');
        window.__lightmaps.setMode('baked');
      } else {
        api.teleport(...pose);
        if (kind === 'world') api.dev.inspectionLight(name === 'interior');
        if (api.weapon) { api.weapon.ads(false); api.weapon.light(name === 'interior'); }
        if (api.dev.step) api.dev.step(1);
      }
    }, { kind, pose, name });
    await page.waitForTimeout(400);
    await shot(name);
  }
  if (kind === 'weapon' || kind === 'app') {
    await page.evaluate(() => { __bodycam.weapon.ads(true); __bodycam.dev.step(0.5); });
    await shot('ads');
    await page.evaluate(() => {
      __bodycam.weapon.ads(false); __bodycam.dev.step(0.5);
      __bodycam.weapon.fire(1); __bodycam.dev.step(0.5);
      if (!__bodycam.weapon.reload()) throw new Error('Reload did not start');
      __bodycam.dev.step(1.3);
    });
    await shot('reload');
    await page.evaluate(() => __bodycam.dev.step(5));
    run.finalWeapon = await page.evaluate(() => __bodycam.weapon.state());
    if (/^reload/i.test(run.finalWeapon.state)) throw new Error('Reload did not finish');
  }
  if (kind === 'lightmaps') {
    await page.evaluate(() => { __lightmaps.setInspection(false); __lightmaps.setMode('lighting'); });
    await page.waitForTimeout(200);
    await shot('lighting');
  }
}

async function loaderFactoryCheck() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const result = { errors: [], requestErrors: [], httpErrors: [], passed: false };
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  page.on('requestfailed', request => result.requestErrors.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) result.httpErrors.push({ url: response.url(), status: response.status() }); });
  try {
    await page.goto(new URL('_dev/world/?debug=1', base).href);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 90000 });
    result.details = await page.evaluate(async () => {
      const { createAssetLoaders } = await import('/bodycam-demo/js/core/loaders.js');
      const THREE = await import('three');
      const renderer = __bodycam.dev.renderer;
      const factory = createAssetLoaders({ renderer });
      const details = { ktx2Detected: !!factory.ktx2, ktx2WorkerConfig: factory.ktx2?.workerConfig,
        glbs: [], decodedImages: [], materialColorSpaces: [] };
      if (!details.ktx2Detected || !details.ktx2WorkerConfig) throw new Error('KTX2 support detection missing');
      for (const filename of ['house.glb', 'house_collision.glb', 'house_shell.glb', 'carbine.glb', 'officer.glb']) {
        const asset = await factory.gltf.loadAsync(`/bodycam-demo/models/${filename}`);
        let meshes = 0, vertices = 0, skinCount = 0;
        const textures = new Set(), materials = new Set(), geometries = new Set();
        asset.scene.traverse(node => {
          if (!node.isMesh) return;
          meshes++; vertices += node.geometry.attributes.position.count;
          if (node.isSkinnedMesh) skinCount++;
          geometries.add(node.geometry);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            materials.add(material);
            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
          }
        });
        if (!meshes || !vertices) throw new Error(`${filename}: no geometry`);
        details.glbs.push({ filename, meshes, vertices, skinCount, animationCount: asset.animations.length,
          extensionsUsed: asset.parser.json.extensionsUsed, extensionsRequired: asset.parser.json.extensionsRequired,
          textures: [...textures].map(t => ({ width: t.image?.width, height: t.image?.height, colorSpace: t.colorSpace, flipY: t.flipY })) });
        textures.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); geometries.forEach(item => item.dispose());
      }
      const textureIndex = await (await fetch('/bodycam-demo/textures/index.json')).json();
      for (const kind of ['albedo', 'normal', 'orm']) {
        const filename = textureIndex.plaster_painted_dirty.files?.[kind] || kind + '.jpg';
        const url = `/bodycam-demo/textures/plaster_painted_dirty/${filename}`;
        const response = await fetch(url), blob = await response.blob();
        const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        const magic = String.fromCharCode(...header);
        const expectedType = magic.startsWith('RIFF') && magic.slice(8, 12) === 'WEBP' ? 'image/webp'
          : header[0] === 255 && header[1] === 216 && header[2] === 255 ? 'image/jpeg'
          : header[0] === 137 && magic.slice(1, 4) === 'PNG' ? 'image/png' : null;
        if (!response.ok || !expectedType || response.headers.get('content-type')?.split(';')[0] !== expectedType)
          throw new Error(`${url}: image content/MIME mismatch`);
        const bitmap = await createImageBitmap(blob);
        const image = new Image(); image.src = url; await image.decode();
        details.decodedImages.push({ url, contentType: response.headers.get('content-type'), magic: [...header],
          image: [image.width, image.height], bitmap: [bitmap.width, bitmap.height] });
        if (image.width !== bitmap.width || image.height !== bitmap.height || image.width < 1) throw new Error(`${url}: image decoder mismatch`);
        bitmap.close();
      }
      for (const [id, material] of __bodycam.dev.world.materialLibrary.materials) {
        const row = { id, albedo: material.map?.colorSpace, normal: material.normalMap?.colorSpace,
          orm: material.roughnessMap?.colorSpace };
        if (material.map && row.albedo !== THREE.SRGBColorSpace) throw new Error(`${id}: albedo color space`);
        if (material.normalMap && row.normal !== THREE.NoColorSpace) throw new Error(`${id}: normal color space`);
        if (material.roughnessMap && row.orm !== THREE.NoColorSpace) throw new Error(`${id}: ORM color space`);
        details.materialColorSpaces.push(row);
      }
      factory.dispose(); factory.dispose();
      const plain = createAssetLoaders();
      if (plain.ktx2 !== null) throw new Error('KTX2 must require renderer');
      plain.dispose(); plain.dispose();
      let invalidRejected = false;
      try { createAssetLoaders({ workerLimit: 0 }); } catch (error) { invalidRejected = error instanceof RangeError; }
      if (!invalidRejected) throw new Error('Invalid worker limit accepted');
      details.disposeTwice = true; details.noRendererKtx2Null = true; details.invalidWorkerLimitRejected = true;
      return details;
    });
    result.passed = ![result.errors, result.requestErrors, result.httpErrors].some(list => list.length);
  } catch (error) { result.failure = String(error.stack || error); }
  finally { await context.close(); }
  return result;
}

try {
  for (const [kind, relative] of pages) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const run = { kind, repeat, url: new URL(relative, base).href, errors: [], warnings: [],
        pageErrors: [], requestErrors: [], httpErrors: [], localResponses: [], passed: false };
      report.runs.push(run);
      const pending = [];
      page.on('console', message => {
        if (message.type() === 'error') run.errors.push(message.text());
        if (message.type() === 'warning') run.warnings.push(message.text());
      });
      page.on('pageerror', error => run.pageErrors.push(error.message));
      page.on('requestfailed', request => run.requestErrors.push({ url: request.url(), error: request.failure()?.errorText }));
      page.on('response', response => pending.push((async () => {
        const url = new URL(response.url());
        if (response.status() >= 400) run.httpErrors.push({ url: url.href, status: response.status() });
        if (url.origin === new URL(base).origin) {
          const headers = await response.allHeaders();
          run.localResponses.push({ path: url.pathname, status: response.status(),
            contentType: headers['content-type'], contentLength: Number(headers['content-length'] || 0),
            asset: /\/bodycam-demo\/(models|textures|lightmaps)\//.test(url.pathname) });
        }
      })()));
      await page.addInitScript(() => {
        const timer = setInterval(() => {
          const api = window.__bodycam;
          const ready = api?.ready === true || document.documentElement?.dataset.ready === 'true';
          if (ready) { window.__c7ReadyMs = performance.now(); clearInterval(timer); }
        }, 5);
      });
      try {
        await page.goto(run.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => Number.isFinite(window.__c7ReadyMs), null, { timeout: 90000 });
        run.loaded = await stats(page);
        run.navigationReadyMs = run.loaded.readyMs;
        run.internalLoadMs = run.loaded.world?.loadMs ?? null;
        if (!/Metal/.test(run.loaded.gpu.renderer) || /SwiftShader/i.test(run.loaded.gpu.renderer)) throw new Error(`Hardware Metal renderer required: ${run.loaded.gpu.renderer}`);
        if (kind === 'app' && Object.values(run.loaded.modules).some(value => !value)) throw new Error('Application module fallback detected');
        if (run.loaded.world?.problems?.length) throw new Error(`Lightmap problems: ${JSON.stringify(run.loaded.world.problems)}`);
        if (repeat === 1) await screenshots(page, kind, run);
        else await page.waitForTimeout(300);
        await Promise.all(pending);
        run.resources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({ name: e.name,
          duration: e.duration, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize })));
        run.localAssetBytes = run.localResponses.filter(response => response.asset).reduce((sum, response) => sum + response.contentLength, 0);
        run.localAllResponseBytes = run.localResponses.reduce((sum, response) => sum + response.contentLength, 0);
        run.passed = ![run.errors, run.pageErrors, run.requestErrors, run.httpErrors].some(list => list.length);
      } catch (error) {
        run.failure = String(error.stack || error);
        await page.screenshot({ path: path.join(out, `${kind}-${repeat}-failure.png`) }).catch(() => {});
      } finally {
        await Promise.allSettled(pending);
        await context.close();
        await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ kind, repeat, passed: run.passed, readyMs: run.navigationReadyMs,
          loadMs: run.internalLoadMs, localAssetBytes: run.localAssetBytes, errors: run.errors.length,
          httpErrors: run.httpErrors, failure: run.failure }));
      }
    }
    const runs = report.runs.filter(run => run.kind === kind);
    const summarize = property => {
      const values = runs.map(run => run[property]).filter(Number.isFinite).sort((a, b) => a - b);
      return { min: values[0] ?? null, median: values[Math.floor(values.length / 2)] ?? null,
        max: values.at(-1) ?? null, samples: values.length };
    };
    report.summaries[kind] = { passed: runs.every(run => run.passed), navigationReadyMs: summarize('navigationReadyMs'),
      internalLoadMs: summarize('internalLoadMs'), localAssetBytes: summarize('localAssetBytes') };
  }
  if (label !== 'before' && args.factory !== 'false') report.loaderFactory = await loaderFactoryCheck();
  report.passed = report.runs.every(run => run.passed) && report.loaderFactory?.passed !== false;
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ passed: report.passed, summaries: report.summaries, report: path.join(out, 'report.json') }, null, 2));
if (!report.passed) process.exitCode = 1;
