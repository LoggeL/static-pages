// Start the C6 static server on port 8956 first. All evidence stays outside Git.
// PLAYWRIGHT_MODULE can point to an existing installation's index.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CAMERA_PRESETS } from './config.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.C6_WORK || '/Users/logge/Documents/Projects/bodycam-work/codex/C6/viewer';
const url = process.env.C6_URL || 'http://127.0.0.1:8956/bodycam-demo/_dev/lightmaps/';
await fs.mkdir(path.join(output, 'screenshots'), { recursive: true });
const report = { date: new Date().toISOString(), url, errors: [], warnings: [], requests: [], assets: [], views: [], visualFlags: [], checks: [] };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0); chunk.write(type, 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function codecFixture() {
  const width = 5, height = 5, stride = width * 4;
  const rgba = Buffer.from(Array.from({ length: stride * height }, (_, i) => i % 4 === 3 ? 1 + i % 7 : (i * 47 + 13) & 255));
  const filtered = Buffer.alloc((stride + 1) * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = y;
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= 4 ? rgba[at - 4] : 0;
      const b = y ? rgba[at - stride] : 0, c = y && x >= 4 ? rgba[at - stride - 4] : 0;
      const predictor = y === 0 ? 0 : y === 1 ? a : y === 2 ? b : y === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      filtered[y * (stride + 1) + 1 + x] = (rgba[at] - predictor) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(filtered)), pngChunk('IEND', Buffer.alloc(0))]);
  return { png: [...png], rgba: [...rgba], width, height, range: 0.125 };
}

const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const assetReads = [], assetHashes = new Map();
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
page.on('requestfailed', request => report.requests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', response => {
  if (response.url().includes('/bodycam-demo/')) report.assets.push({ url: response.url(), status: response.status() });
  if (response.status() >= 400) report.requests.push({ url: response.url(), status: response.status() });
  if (/\/(?:models\/(?:props\/[^?]+|house(?:_collision)?)\.glb|lightmaps\/[^?]+\.png|data\/level\.json)(?:$|\?)/.test(response.url()) && response.ok()) {
    assetReads.push(response.body().then(bytes => {
      assetHashes.set(response.url(), { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }).catch(error => { report.requests.push({ url: response.url(), error: error.message }); }));
  }
});

try {
  const firstUrl = new URL(url);
  firstUrl.searchParams.set('cam', CAMERA_PRESETS[0].pose.join(','));
  await page.goto(firstUrl.href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lightmaps?.ready || window.__lightmaps?.error, null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.__lightmaps.error), null);
  await Promise.all(assetReads);
  report.deliveredAssets = [...assetHashes].map(([url, value]) => ({ url, ...value }));
  const expectedAssets = await page.evaluate(() => ['models/house.glb', 'models/house_collision.glb', 'data/level.json',
    ...window.__lightmaps.level.lightmaps.map(atlas => atlas.path)]);
  for (const relative of expectedAssets) {
    assert(assetHashes.has(new URL(`../../${relative}`, url).href), `Delivered C6 asset has byte hash: ${relative}`);
  }
  report.checks.push({ name: 'browser-delivered-C6-asset-hashes', passed: true });
  report.sharedImageBuffers = await page.evaluate(() => window.__lightmaps.level.bake?.compression?.sharedImageBuffers ?? []);
  for (const dependency of report.sharedImageBuffers) {
    const dependencyUrl = new URL(`../../models/${dependency.uri}`, url).href;
    const observed = assetHashes.get(dependencyUrl);
    assert(observed, `Shared image buffer requested by GLTFLoader: ${dependency.uri}`);
    assert.equal(observed.bytes, dependency.bytes, `${dependency.uri}: byte length`);
    assert.equal(observed.sha256, dependency.sha256, `${dependency.uri}: immutable byte offsets / hash`);
  }
  report.uniqueImages = await page.evaluate(() => {
    const maps = new Map();
    for (const record of window.__lightmaps.world.records) for (const material of record.sources) {
      if (material.name.startsWith('MU_') && material.map) maps.set(material.map.uuid, material.map);
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    return [...maps.values()].map(texture => {
      context.clearRect(0, 0, 8, 8); context.drawImage(texture.image, 0, 0, 8, 8);
      const pixels = context.getImageData(0, 0, 8, 8).data;
      return { name: texture.name, width: texture.image.width, height: texture.image.height,
        min: Math.min(...pixels), max: Math.max(...pixels), distinct: new Set(pixels).size };
    });
  });
  assert(report.uniqueImages.every(image => image.width > 0 && image.height > 0), 'MU image buffers decode into pixels');
  report.checks.push({ name: 'shared-MU-image-buffers-hashes-and-decoded-pixels', passed: true });
  assert(await page.evaluate(() => window.__bodycam.ready), 'C13 ready hook');
  const queryCamera = await page.evaluate(() => window.__lightmaps.getCamera());
  assert(queryCamera.every((value, index) => Math.abs(value - CAMERA_PRESETS[0].pose[index]) < 1e-8), '?cam absolute metre/degree semantics');
  report.checks.push({ name: 'camera-query-and-ready', passed: true, queryCamera });
  report.gpu = await page.evaluate(() => {
    const gl = window.__lightmaps.renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { version: gl.getParameter(gl.VERSION), vendor: extension && gl.getParameter(extension.UNMASKED_VENDOR_WEBGL),
      renderer: extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) };
  });
  assert.match(report.gpu.version, /WebGL 2/i);
  assert.match(report.gpu.renderer, /Metal/i);
  assert.doesNotMatch(report.gpu.renderer, /SwiftShader|llvmpipe|software/i);

  report.codec = await page.evaluate(async fixture => {
    const { decodePngRgba8, rgbmToTexture } = await import('./rgbm.js');
    const THREE = await import('three');
    const decoded = await decodePngRgba8(new Uint8Array(fixture.png).buffer);
    const exact = decoded.rgba.every((value, index) => value === fixture.rgba[index]);
    const texture = rgbmToTexture(decoded, { path: 'fixture', range: fixture.range });
    let maxError = 0;
    for (let i = 0; i < fixture.rgba.length; i += 4) for (let channel = 0; channel < 3; channel++) {
      const expected = fixture.rgba[i + channel] * fixture.rgba[i + 3] * fixture.range / (255 * 255);
      maxError = Math.max(maxError, Math.abs(THREE.DataUtils.fromHalfFloat(texture.image.data[i + channel]) - expected));
    }
    const result = { exact, maxError, width: decoded.width, height: decoded.height, channel: texture.channel,
      colorSpace: texture.colorSpace, flipY: texture.flipY, type: texture.type, minFilter: texture.minFilter };
    texture.dispose();
    const adaptive = rgbmToTexture(decoded, { path: 'adaptive-fixture', range: 256, multiplierExponent: 2 });
    result.adaptiveMaxError = 0;
    for (let i = 0; i < fixture.rgba.length; i += 4) for (let channel = 0; channel < 3; channel++) {
      const expected = fixture.rgba[i + channel] / 255 * (fixture.rgba[i + 3] / 255) ** 2 * 256;
      result.adaptiveMaxError = Math.max(result.adaptiveMaxError,
        Math.abs(THREE.DataUtils.fromHalfFloat(adaptive.image.data[i + channel]) - expected));
    }
    result.adaptiveExponent = adaptive.userData.multiplierExponent;
    adaptive.dispose();
    return result;
  }, codecFixture());
  assert(report.codec.exact, 'PNG filter types 0..4 retain straight-alpha bytes exactly');
  assert(report.codec.maxError < 0.000004, 'HalfFloat decode precision');
  assert.equal(report.codec.adaptiveExponent, 2);
  assert(report.codec.adaptiveMaxError < 0.00013, 'Adaptive RGBM exponent decode precision at range 256');
  report.checks.push({ name: 'straight-alpha-RGBM-decode', passed: true });

  report.gpuCalibration = await page.evaluate(async () => {
    const THREE = await import('three');
    const { rgbmToTexture } = await import('./rgbm.js');
    const renderer = window.__lightmaps.renderer;
    const texture = rgbmToTexture({ width: 2, height: 1,
      rgba: new Uint8Array([64, 128, 255, 128, 255, 32, 16, 64]) }, { path: 'gpu-calibration', range: 1 });
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.setAttribute('uv1', new THREE.Float32BufferAttribute([0.25, 0.5, 0.25, 0.5, 0.25, 0.5, 0.25, 0.5], 2));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0.75, 0.5, 0.75, 0.5, 0.75, 0.5, 0.75, 0.5], 2));
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0,
      lightMap: texture, lightMapIntensity: Math.PI, toneMapped: false });
    const testScene = new THREE.Scene();
    testScene.add(new THREE.Mesh(geometry, material));
    const testCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
    testCamera.position.z = 1;
    const target = new THREE.WebGLRenderTarget(8, 8, { colorSpace: THREE.LinearSRGBColorSpace });
    const previousTarget = renderer.getRenderTarget();
    const pixels = new Uint8Array(4), adaptivePixels = new Uint8Array(4);
    const adaptiveTexture = rgbmToTexture({ width: 2, height: 1,
      rgba: new Uint8Array([64, 128, 255, 16, 255, 32, 16, 64]) },
    { path: 'gpu-adaptive-calibration', range: 128, multiplierExponent: 2 });
    try {
      renderer.setRenderTarget(target);
      renderer.render(testScene, testCamera);
      renderer.readRenderTargetPixels(target, 4, 4, 1, 1, pixels);
      material.lightMap = adaptiveTexture;
      renderer.render(testScene, testCamera);
      renderer.readRenderTargetPixels(target, 4, 4, 1, 1, adaptivePixels);
    } finally {
      renderer.setRenderTarget(previousTarget);
      texture.dispose(); adaptiveTexture.dispose(); geometry.dispose(); material.dispose(); target.dispose();
    }
    const expected = [64, 128, 255].map(value => value * 128 / 255);
    const adaptiveExpected = [64, 128, 255].map(value => value * (16 / 255) ** 2 * 128);
    return { actual: [...pixels], expected, maxByteError: Math.max(...expected.map((value, index) => Math.abs(value - pixels[index]))),
      adaptive: { actual: [...adaptivePixels], expected: adaptiveExpected,
        maxByteError: Math.max(...adaptiveExpected.map((value, index) => Math.abs(value - adaptivePixels[index]))) } };
  });
  assert(report.gpuCalibration.maxByteError <= 1.1, 'Actual shader: linear RGBM, uv1, Lambert PI conversion');
  assert(report.gpuCalibration.adaptive.maxByteError <= 1.1, 'Actual shader: adaptive RGBM exponent before filtering');
  report.checks.push({ name: 'GPU-lightmap-uv1-and-Lambert-calibration', passed: true });

  report.sanity = await page.evaluate(async () => {
    const THREE = await import('three');
    const { world, level, scene } = window.__lightmaps;
    const failures = [], mapped = [], activeLights = [];
    const byOriginal = new Map();
    for (const record of world.records) {
      if (!record.texture) continue;
      const uv = record.mesh.geometry.getAttribute('uv1');
      if (!uv) failures.push(`${record.mesh.name}: no uv1`);
      for (const material of record.baked) {
        const texture = material.lightMap;
        if (texture !== record.texture || texture.channel !== 1 || texture.flipY || texture.colorSpace !== THREE.NoColorSpace ||
            texture.type !== THREE.HalfFloatType || texture.minFilter !== THREE.LinearFilter || texture.generateMipmaps) failures.push(`${record.mesh.name}: wrong texture binding`);
        if (Math.abs(material.lightMapIntensity - Math.PI) > 1e-6) failures.push(`${record.mesh.name}: radiance-to-irradiance intensity`);
      }
      record.sources.forEach((source, index) => {
        const list = byOriginal.get(source.uuid) ?? [];
        list.push({ atlas: record.lightmap, material: record.baked[index] }); byOriginal.set(source.uuid, list);
      });
      mapped.push({ name: record.mesh.name, owner: record.sourceName, atlas: record.lightmap,
        room: record.extra?.room, surface: record.extra?.surface, uvVertices: uv?.count });
    }
    let crossAtlasPairs = 0;
    for (const list of byOriginal.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      if (list[a].atlas === list[b].atlas) continue;
      crossAtlasPairs++;
      if (list[a].material === list[b].material) failures.push('Material shared across different atlases');
    }
    for (const door of world.doors) door.object.traverse(mesh => {
      if (mesh.isMesh) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (material.lightMap) failures.push(`${door.id}: baked moving door`);
      }
    });
    scene.traverse(object => { if (object.isLight && object.visible) activeLights.push(object.name); });
    return { failures, mapped, crossAtlasPairs, activeLights,
      expectedMapped: level.meshes.filter(mesh => mesh.lightmap).length, state: window.__lightmaps.stats() };
  });
  assert.deepEqual(report.sanity.failures, []);
  assert.deepEqual(report.sanity.activeLights, [], 'Default must contain only baked illumination');
  assert(report.sanity.crossAtlasPairs > 0, 'Shared tiling materials must be isolated per atlas');
  assert.equal(new Set(report.sanity.mapped.map(mesh => mesh.owner)).size, report.sanity.expectedMapped);
  assert(report.sanity.state.world.downloadBytes <= 40 * 1000 * 1000, 'Lightmaps <= 40 MB');
  assert(report.sanity.state.world.atlases.every(atlas => atlas.width === 2048 && atlas.height === 2048), '2048 atlases');
  report.checks.push({ name: 'atlas-bindings-uv1-material-isolation-budget', passed: true });

  // Regression: imported MU materials used black vertex colors / the bake UV
  // for albedo until the bake pipeline explicitly retained UV0 and active Color.
  report.uniqueMaterialReceivers = await page.evaluate(async () => {
    const THREE = await import('three');
    const api = window.__lightmaps;
    api.setCamera(api.presets.find(preset => preset.id === 'kitchen').pose);
    api.scene.updateMatrixWorld(true);
    const rays = [ ['LM_KIT_MU_range_hood', 790, 285], ['LM_KIT_MU_stove', 785, 430],
      ['LM_KIT_MU_fridge', 975, 650], ['LM_KIT_MU_pizza_box.001', 611, 592] ];
    const raycaster = new THREE.Raycaster();
    return rays.map(([expected, x, y]) => {
      raycaster.setFromCamera(new THREE.Vector2(x / 1280 * 2 - 1, 1 - y / 720 * 2), api.camera);
      const hit = raycaster.intersectObject(api.world.house, true)[0];
      const record = api.world.records.find(record => record.mesh === hit?.object);
      const texture = record?.texture, uv = hit?.uv1;
      if (!texture || !uv) return { expected, actual: record?.sourceName, rgb: null };
      const ix = Math.min(texture.image.width - 1, Math.max(0, Math.floor(uv.x * texture.image.width)));
      const iy = Math.min(texture.image.height - 1, Math.max(0, Math.floor(uv.y * texture.image.height)));
      const at = (iy * texture.image.width + ix) * 4;
      return { expected, actual: record.sourceName, uv1: uv.toArray(),
        rgb: Array.from(texture.image.data.subarray(at, at + 3), THREE.DataUtils.fromHalfFloat) };
    });
  });
  for (const sample of report.uniqueMaterialReceivers) {
    assert.equal(sample.actual, sample.expected, 'Known kitchen MU surface is still visible');
    assert(sample.rgb?.every(value => value > 0.002), `${sample.expected}: MU diffuse bake must not be black`);
  }
  report.checks.push({ name: 'MU-material-bake-UV0-and-vertex-color-regression', passed: true });

  await page.addStyleTag({ content: 'body.evidence #panel,body.evidence #hint{display:none}' });
  await page.evaluate(() => document.body.classList.add('evidence'));
  for (const [index, preset] of CAMERA_PRESETS.entries()) {
    await page.evaluate(pose => {
      const api = window.__lightmaps;
      api.setCamera(pose); api.setMode('baked'); api.setInspection(false); api.setCollision(false);
      api.setExposure(1); api.resetMetrics();
    }, preset.pose);
    await page.waitForTimeout(650);
    const state = await page.evaluate(() => window.__lightmaps.stats());
    assert.equal(state.room, preset.room, `${preset.id}: room`);
    const basename = `${String(index + 1).padStart(2, '0')}-${preset.id}`;
    const pixels = await page.evaluate(() => window.__lightmaps.sampleFrame());
    if (pixels.peak <= 3) report.visualFlags.push(`${preset.id}: peak <= 3/255 in bake-only view`);
    await page.screenshot({ path: path.join(output, 'screenshots', `${basename}.png`) });
    await page.evaluate(() => window.__lightmaps.setMode('lighting'));
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(output, 'screenshots', `${basename}-lighting.png`) });
    await page.evaluate(() => window.__lightmaps.setExposure(16));
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(output, 'screenshots', `${basename}-lighting-exposure16.png`) });
    await page.evaluate(() => {
      window.__lightmaps.setExposure(1); window.__lightmaps.setMode('baked'); window.__lightmaps.setInspection(true);
    });
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(output, 'screenshots', `${basename}-inspection.png`) });
    report.views.push({ id: preset.id, expectedRoom: preset.room, state, pixels, screenshot: `${basename}.png`,
      lightingScreenshot: `${basename}-lighting.png`, lightingDiagnosticScreenshot: `${basename}-lighting-exposure16.png`,
      inspectionScreenshot: `${basename}-inspection.png` });
  }

  report.doors = await page.evaluate(() => {
    const api = window.__lightmaps;
    return api.world.doors.map(door => {
      const initial = door.angle, start = door.object.quaternion.clone();
      api.setDoor(door.id, 0); const closed = door.object.quaternion.clone();
      api.setDoor(door.id, door.definition.maxAngle ?? 105); const open = door.object.quaternion.clone();
      api.setDoor(door.id, initial);
      const pivot = door.object.getWorldPosition(door.object.position.clone());
      const collisionPivot = door.collider?.getWorldPosition(door.object.position.clone());
      return { id: door.id, hasCollider: Boolean(door.collider), angularDelta: closed.normalize().angleTo(open.normalize()),
        expected: (door.definition.maxAngle ?? 105) * Math.PI / 180,
        pivot: pivot.toArray(), hingeError: pivot.distanceTo(pivot.clone().fromArray(door.definition.hinge)),
        colliderPivotError: collisionPivot ? pivot.distanceTo(collisionPivot) : null,
        restoredComponentError: Math.max(...start.toArray().map((value, index) => Math.abs(value - door.object.quaternion.toArray()[index]))) };
    });
  });
  assert(report.doors.length >= 7);
  for (const door of report.doors) {
    assert(door.hasCollider, `${door.id}: separate collision door`);
    assert(Math.abs(door.angularDelta - door.expected) < 1e-5, `${door.id}: angular range`);
    assert(door.restoredComponentError < 1e-7, `${door.id}: original pose restored`);
    assert(door.hingeError < 1e-5, `${door.id}: visual pivot matches Y-up hinge`);
    assert(door.colliderPivotError < 1e-5, `${door.id}: collision pivot matches visual pivot`);
  }
  report.checks.push({ name: 'seven-moving-unbaked-doors-and-colliders', passed: true });

  for (const [mode, file] of [['atlases', 'atlas-assignment'], ['unlit', 'unlit-materials'], ['baked', 'inspection']]) {
    await page.evaluate(({ mode, pose }) => {
      const api = window.__lightmaps; api.setCamera(pose); api.setMode(mode); api.setInspection(mode === 'baked');
    }, { mode, pose: CAMERA_PRESETS.find(preset => preset.id === 'kitchen').pose });
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(output, 'screenshots', `${file}.png`) });
  }
  await page.evaluate(() => {
    window.__lightmaps.setInspection(false); window.__lightmaps.setCollision(true);
    window.__lightmaps.setCamera(window.__lightmaps.presets[0].pose);
  });
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, 'screenshots', 'collision-overlay.png') });
  for (const [name, field] of [['baked', 'screenshot'], ['lighting', 'lightingScreenshot'],
    ['diagnostic', 'lightingDiagnosticScreenshot'], ['inspection', 'inspectionScreenshot']]) {
    const images = await Promise.all(report.views.map(async view => ({ label: view.id,
      base64: (await fs.readFile(path.join(output, 'screenshots', view[field]))).toString('base64') })));
    const jpeg = await page.evaluate(async entries => {
      const canvas = document.createElement('canvas');
      canvas.width = 1440; canvas.height = Math.ceil(entries.length / 3) * 294;
      const context = canvas.getContext('2d');
      context.fillStyle = '#181b1e'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = '14px monospace'; context.fillStyle = '#ffffff';
      for (const [index, entry] of entries.entries()) {
        const bytes = Uint8Array.from(atob(entry.base64), value => value.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const x = index % 3 * 480, y = Math.floor(index / 3) * 294;
        context.drawImage(bitmap, x, y, 480, 270); context.fillText(entry.label, x + 8, y + 287); bitmap.close();
      }
      return canvas.toDataURL('image/jpeg', 0.91).split(',')[1];
    }, images);
    await fs.writeFile(path.join(output, 'screenshots', `contact-${name}.jpg`), Buffer.from(jpeg, 'base64'));
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert.equal(report.warnings.length, 0, JSON.stringify(report.warnings));
  assert.equal(report.requests.length, 0, JSON.stringify(report.requests));
  report.passed = true;
  console.log(`C6 PASS: ${report.views.length} positions, ${report.sanity.mapped.length} mapped meshes, ${report.gpu.renderer}`);
} catch (error) {
  report.passed = false; report.failure = error.stack;
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'acceptance.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
