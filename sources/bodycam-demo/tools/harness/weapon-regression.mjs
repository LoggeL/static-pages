import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configureAudioOutput, DEFAULT_AUDIO_SINK } from './audio-output.mjs';

const fixturePath = '/bodycam-demo/__harness_weapon.html';
const fixtureHTML = `<!doctype html><html lang="de"><meta charset="utf-8">
<title>C16 Waffenträgheit</title><link rel="icon" href="data:,">
<script type="importmap">{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",
  "three-mesh-bvh":"https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/+esm"
},"scopes":{"https://cdn.jsdelivr.net/npm/":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/+esm":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"
}}}</script><canvas id="view"></canvas><script type="module">
import * as THREE from 'three';
import { createWeapon } from '/bodycam-demo/js/weapon/weapon.js';
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas') });
renderer.setSize(640, 360);
window.__weaponHarness = { THREE, createWeapon, renderer, ready: true };
</script></html>`;

async function sourceReference(relative, snippet) {
  const content = await readFile(new URL(`../../../../${relative}`, import.meta.url), 'utf8');
  const index = content.indexOf(snippet);
  return { file: relative, line: index < 0 ? null : content.slice(0, index).split('\n').length, snippet };
}

/** Real weapon module, models and effects. The caller owns page, diagnostics and server.
 * No application files or motion parameters are replaced. All clocks are explicit.
 */
export async function runWeaponRegression({ page, origin, out, audioSink = DEFAULT_AUDIO_SINK } = {}) {
  const checks = [];
  const result = {
    checks,
    method: 'Real createWeapon with shipped carbine/casing/decal assets, then the actual debug app teleport API.',
    thresholds: { settleSeconds: 1.1, settledAngleRadians: 0.005, adsRatio: [0.2, 0.45], teleportEpsilon: 1e-9 },
    source: {
      teleportHeuristic: await sourceReference('public/bodycam-demo/js/weapon/sway.js', 'if (local.length() > 1'),
      zeroTimestep: await sourceReference('public/bodycam-demo/js/weapon/sway.js', 'if (!primed || dt <= 0)'),
      adsApplication: await sourceReference('public/bodycam-demo/js/weapon/sway.js', 'const k = 1 - (1 - config.adsScale)'),
      cameraCut: await sourceReference('public/bodycam-demo/js/app/runtime.js', 'function cameraCut()'),
    },
    bugs: [],
  };
  const fixtureURL = new URL(fixturePath, origin).href;
  const route = request => request.fulfill({ status: 200, contentType: 'text/html', body: fixtureHTML });
  await page.route(fixtureURL, route);
  try {
    await page.goto(fixtureURL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__weaponHarness?.ready);
    const moduleResult = await page.evaluate(async thresholds => {
      const { THREE, createWeapon, renderer } = window.__weaponHarness;
      const checks = [], trajectories = {}, invalidNumbers = [];
      const norm = array => Math.hypot(...array);
      function finite(value, label) {
        if (typeof value === 'number' && !Number.isFinite(value)) invalidNumbers.push({ label, value: String(value) });
        else if (Array.isArray(value)) value.forEach((item, index) => finite(item, `${label}[${index}]`));
        else if (value && typeof value === 'object')
          for (const [key, item] of Object.entries(value)) finite(item, `${label}.${key}`);
      }
      async function trial(action) {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(82, 16 / 9, 0.01, 200);
        camera.rotation.order = 'YXZ';
        scene.add(camera);
        const light = new THREE.HemisphereLight(0xffffff, 0x555555, 3);
        light.layers.enable(1); scene.add(light);
        const world = { shootables: [], colliders: { static: null, doors: [] }, roomAt: () => null };
        const weapon = await createWeapon({ scene, camera, renderer, world,
          baseUrl: new URL('/bodycam-demo/', location.href), random: () => 0.5 });
        let frame = 0;
        function sample(time) {
          const state = weapon.state();
          const value = { time, sway: state.sway, adsProgress: state.adsProgress,
            position: weapon.viewmodel.position.toArray(), quaternion: weapon.viewmodel.quaternion.toArray() };
          finite(state, `state:${frame}`); finite(value, `pose:${frame++}`);
          return value;
        }
        try {
          weapon.update(0);
          return await action({ scene, camera, weapon, sample });
        } finally { weapon.dispose(); }
      }

      // Compare the real local viewmodel quaternion, not raw spring state: ADS is
      // applied at the final pose, while state().sway.angle intentionally stays raw.
      async function turn(fps, ads = false, turnYaw = 0.35, turnPitch = -0.2) {
        return trial(({ scene, camera, weapon, sample }) => {
          if (ads) {
            weapon.ads(true);
            for (let i = 0; i < fps; i++) weapon.update(1 / fps);
          }
          const rest = weapon.viewmodel.quaternion.clone();
          const trace = [sample(0)];
          camera.rotation.set(turnPitch, turnYaw, 0, 'YXZ');
          for (let i = 1; i <= Math.ceil(1.25 * fps); i++) {
            weapon.update(1 / fps);
            const frame = sample(i / fps);
            frame.deflection = rest.angleTo(weapon.viewmodel.quaternion);
            trace.push(frame);
          }
          camera.layers.set(1); renderer.render(scene, camera);
          return { trace, adsProgress: weapon.state().adsProgress, config: weapon.poses.sway };
        });
      }
      const turns = {};
      for (const fps of [30, 60, 120]) {
        const data = await turn(fps);
        turns[fps] = data;
        trajectories[`turn-${fps}hz`] = data.trace;
        const peak = Math.max(...data.trace.map(frame => norm(frame.sway.angle)));
        const tail = data.trace.filter(frame => frame.time >= thresholds.settleSeconds);
        const residual = Math.max(...tail.map(frame => norm(frame.sway.angle)));
        checks.push({ name: `weapon-turn-${fps}hz`, passed: peak > 0.03 && data.trace[1].sway.angle[1] < -0.01,
          details: { turnRadians: [0.35, -0.2], peakAngle: peak, first: data.trace[1].sway.angle } });
        checks.push({ name: `weapon-settles-${fps}hz`, passed: tail.length > 0 && residual < thresholds.settledAngleRadians,
          details: { afterSeconds: thresholds.settleSeconds, maximumTailAngle: residual, limit: thresholds.settledAngleRadians } });
      }
      const ads = await turn(60, true);
      trajectories['turn-ads-60hz'] = ads.trace;
      const lowPeak = Math.max(...turns[60].trace.map(frame => frame.deflection ?? 0));
      const adsPeak = Math.max(...ads.trace.map(frame => frame.deflection ?? 0));
      const ratio = adsPeak / lowPeak;
      checks.push({ name: 'weapon-ads-weaker', passed: ads.adsProgress > 0.999 && adsPeak > 0.001
        && ratio >= thresholds.adsRatio[0] && ratio <= thresholds.adsRatio[1],
      details: { lowReadyDeflection: lowPeak, adsDeflection: adsPeak, ratio, configuredScale: ads.config.adsScale,
        measurement: 'Quaternion angle from the respective stationary local pose; raw spring state is unscaled.' } });

      // Module-level respawn heuristic must clear existing spring motion, too.
      const teleports = await trial(({ camera, weapon, sample }) => {
        camera.rotation.y = 0.3; weapon.update(1 / 60);
        const active = sample(0);
        camera.position.set(8, 2, -6); camera.rotation.y = 1.7;
        weapon.update(1 / 60); const after = sample(1 / 60);
        weapon.update(1 / 60); const primed = sample(2 / 60);
        camera.rotation.y += 0.1; weapon.update(1 / 60); const resumed = sample(3 / 60);
        return { active, after, primed, resumed };
      });
      trajectories.moduleTeleport = teleports;
      checks.push({ name: 'weapon-module-teleport', passed: norm(teleports.active.sway.angle) > 0.01
        && norm(teleports.after.sway.angle) < thresholds.teleportEpsilon
        && norm(teleports.after.sway.offset) < thresholds.teleportEpsilon
        && norm(teleports.primed.sway.angle) < thresholds.teleportEpsilon
        && norm(teleports.resumed.sway.angle) > 0.001, details: teleports });

      trajectories.cornerInputs = await trial(({ camera, weapon, sample }) => {
        const trace = [];
        const cases = [
          { label: 'zero-dt', dt: 0, rotation: [0.2, 0.3, 0] },
          { label: 'tiny-dt', dt: 1e-9, rotation: [0.2, 0.3, 0] },
          { label: 'positive-wrap', dt: 1 / 240, rotation: [0, Math.PI - 0.001, 0] },
          { label: 'negative-wrap', dt: 1 / 240, rotation: [0, -Math.PI + 0.001, 0] },
          { label: 'upper-pitch', dt: 1 / 60, rotation: [Math.PI / 2 - 1e-6, 0, 0] },
          { label: 'lower-pitch', dt: 1 / 60, rotation: [-Math.PI / 2 + 1e-6, 0, 0] },
          { label: 'long-frame', dt: 0.25, rotation: [0, 0.3, 0] },
          { label: 'one-second-frame', dt: 1, rotation: [0.1, -0.2, 0] },
          { label: 'large-position', dt: 0.1, position: [10000, 500, -10000] },
        ];
        for (const entry of cases) {
          if (entry.rotation) camera.rotation.set(...entry.rotation, 'YXZ');
          if (entry.position) camera.position.fromArray(entry.position);
          weapon.update(entry.dt); trace.push({ ...entry, state: sample(entry.dt) });
        }
        const rejections = [];
        for (const dt of [-1, NaN, Infinity, -Infinity]) {
          let error = null;
          try { weapon.update(dt); } catch (caught) { error = { name: caught.name, message: caught.message }; }
          rejections.push({ dt: String(dt), error });
          sample(0);
        }
        checks.push({ name: 'weapon-invalid-timesteps-rejected',
          passed: rejections.every(entry => entry.error?.name === 'RangeError'), details: rejections });
        return trace;
      });
      checks.push({ name: 'weapon-finite-states', passed: invalidNumbers.length === 0,
        details: { invalidNumbers, scope: 'Every numeric leaf of weapon.state(), position and quaternion after every sampled frame.' } });
      const gl = renderer.getContext();
      const glError = gl.getError();
      checks.push({ name: 'weapon-webgl-no-error', passed: glError === gl.NO_ERROR, details: { glError } });
      renderer.dispose();
      return { checks, trajectories, ads: { lowPeak, adsPeak, ratio }, invalidNumbers };
    }, result.thresholds);
    checks.push(...moduleResult.checks);
    result.module = moduleResult;
  } catch (error) {
    checks.push({ name: 'weapon-module-execution', passed: false, details: { error: String(error.stack ?? error) } });
  } finally {
    await page.unroute(fixtureURL, route);
  }

  try {
    await page.goto(new URL('/bodycam-demo/?debug=1&quality=low', origin).href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__bodycam?.ready || window.__bodycam?.error);
    result.audioOutput = await configureAudioOutput(page, audioSink);
    result.app = await page.evaluate(async () => {
      const app = window.__bodycam;
      if (!app?.ready || !app.dev || !app.weapon) throw new Error(`Real app not ready: ${JSON.stringify(app?.error ?? app?.stats?.())}`);
      // App resume deliberately does not await audio.unlock(). Finish that native
      // operation first, so this fast synchronous test cannot close its context
      // while the app's initial audio resume is still pending.
      const audioUnlocked = app.dev.audio ? await app.dev.audio.unlock() : null;
      if (app.dev.audio && !audioUnlocked) throw new Error('Native audio did not unlock before the app lifecycle test.');
      const resumed = await app.resume();
      if (!resumed) throw new Error('Real app did not resume.');
      app.dev.freeze(true);
      const initial = app.stats();
      const norm = array => Math.hypot(...array);
      const snap = () => {
        const stats = app.stats();
        return { position: stats.position, yawDeg: stats.yawDeg, pitchDeg: stats.pitchDeg,
          sway: stats.weapon.sway, cameraPosition: app.dev.camera.position.toArray() };
      };
      // Direct weapon ticks isolate camera-cut wiring from player bob/gravity.
      // The cut itself still runs the real public teleport -> player -> cameraCut.
      for (let i = 0; i < 240; i++) app.weapon.update(1 / 120);
      const restBefore = snap();
      const home = [...restBefore.position];
      app.teleport(home[0] + 0.25, home[1], home[2], restBefore.yawDeg + 15, restBefore.pitchDeg);
      const restImmediate = snap();
      app.weapon.update(1 / 60); const restNext = snap();
      app.teleport(...home, restBefore.yawDeg, restBefore.pitchDeg);
      for (let i = 0; i < 240; i++) app.weapon.update(1 / 120);
      app.player.look(restBefore.yawDeg + 20, restBefore.pitchDeg);
      app.weapon.update(1 / 60); const activeBefore = snap();
      app.teleport(home[0] + 3, home[1], home[2], restBefore.yawDeg + 100, restBefore.pitchDeg);
      const activeImmediate = snap();
      app.weapon.update(1 / 60); const activeNext = snap();
      const checks = [
        { name: 'weapon-app-real-modules', passed: initial.modules.world && initial.modules.player && initial.modules.weapon,
          details: { modules: initial.modules, phase: initial.phase, issues: initial.issues } },
        { name: 'weapon-app-teleport-at-rest', passed: norm(restBefore.sway.angle) < 1e-9
          && norm(restImmediate.sway.angle) < 1e-9 && norm(restImmediate.sway.offset) < 1e-9
          && norm(restNext.sway.angle) < 1e-9 && norm(restNext.sway.offset) < 1e-9,
          details: { before: restBefore, immediate: restImmediate, next: restNext } },
        { name: 'weapon-app-teleport-resets-active-sway', passed: norm(activeBefore.sway.angle) > 0.01
          && norm(activeImmediate.sway.angle) < 1e-9 && norm(activeImmediate.sway.offset) < 1e-9
          && norm(activeNext.sway.angle) < 1e-9 && norm(activeNext.sway.offset) < 1e-9,
          details: { before: activeBefore, immediate: activeImmediate, next: activeNext,
            expected: 'A teleport clears existing inertia, as the module-level teleport/respawn reset does.' } },
      ];
      await app.dispose();
      return { checks, lifecycle: { audioUnlocked, resumed },
        traces: { restBefore, restImmediate, restNext, activeBefore, activeImmediate, activeNext } };
    });
    checks.push(...result.app.checks);
    const active = result.app.checks.find(check => check.name === 'weapon-app-teleport-resets-active-sway');
    if (!active.passed) result.bugs.push({
      id: 'weapon-teleport-retains-active-inertia', check: active.name,
      source: [result.source.cameraCut, result.source.zeroTimestep, result.source.teleportHeuristic],
      summary: 'App teleport primes the new camera through update(0), retaining active spring angle/offset and bypassing the distance reset.',
      repro: 'Open ?debug=1, resume, dev.freeze(true), turn player.look(yaw+20,pitch), weapon.update(1/60), then __bodycam.teleport(x+3,y,z,yaw+100,pitch). Compare weapon.state().sway before/after.',
      details: active.details,
    });
  } catch (error) {
    checks.push({ name: 'weapon-app-execution', passed: false, details: { error: String(error.stack ?? error) } });
  }
  result.passed = checks.every(check => check.passed);
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'weapon-regression.json'), `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}
