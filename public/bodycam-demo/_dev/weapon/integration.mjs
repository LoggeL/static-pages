import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Run against the C3 server. Math tests use the real GLB with recording effect hooks.
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE
  || '/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright/index.mjs'));
const out = process.env.C3_WORK || '/Users/logge/Documents/Projects/bodycam-work/codex/C3';
await mkdir(`${out}/reports`, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [], warnings: [], requests: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
page.on('requestfailed', request => report.requests.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('response', response => { if (response.status() >= 400) report.requests.push(`${response.status()}: ${response.url()}`); });
const check = (name, predicate, detail) => {
  report.checks.push({ name, passed: !!predicate, ...(detail === undefined ? {} : { detail }) });
};
const near = (a, b, tolerance = 1e-10) => Math.abs(a - b) < tolerance;

try {
  await page.goto(process.env.C3_URL || 'http://127.0.0.1:8955/bodycam-demo/_dev/weapon/?debug=1&inspect=1&hall=1');
  await page.waitForFunction(() => window.__bodycam?.ready === true, null, { timeout: 60000 });
  await page.evaluate(() => __bodycam.dev.pause(true));
  report.gpu = await page.evaluate(() => __bodycam.stats().gpu);
  check('Actual WebGL renderer uses Metal, no software renderer', /Metal/.test(report.gpu) && !/SwiftShader|llvmpipe/i.test(report.gpu));

  report.isolated = await page.evaluate(async () => {
    const T = await import('three');
    const { createWeapon, createWeaponBus } = await import('../../js/weapon/index.js');
    const { attachAudio } = await import('../../js/audio/events.js');
    const forward = new T.Vector3(0, 0, -1);
    const packVector = value => value?.toArray?.() ?? value;
    const packEvent = event => ({
      ...event, position: packVector(event.position), point: packVector(event.point),
      normal: packVector(event.normal), direction: packVector(event.direction), object: event.object?.name,
    });

    async function fixture({ hooksMode = 'default', throwingFactory = false } = {}) {
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(82, 16 / 9, 0.01, 160);
      camera.position.set(0, 1.4, 0);
      scene.add(camera);
      const wall = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshBasicMaterial({ side: T.DoubleSide }));
      wall.position.set(0, 1.4, -10);
      wall.name = 'IntegrationWoodTarget';
      wall.userData.surface = 'wood';
      scene.add(wall);
      scene.updateMatrixWorld(true);
      const world = { shootables: [wall], roomAt: () => ({ id: 'TEST_ROOM' }) };
      const bus = createWeaponBus();
      const defaults = { shot: 0, impact: 0, update: 0, dt: 0, light: [], dispose: 0 };
      const overrides = { shot: 0, impact: 0, update: 0, dt: 0, light: [], dispose: 0 };
      const audio = [];
      const events = [];
      const observations = [];
      let weapon;
      let lastCameraEvent;
      const basePosition = camera.position.clone();
      const baseQuaternion = camera.quaternion.clone();
      bus.on('cameraRecoil', event => {
        lastCameraEvent = event;
        camera.quaternion.copy(baseQuaternion).multiply(new T.Quaternion().setFromEuler(
          new T.Euler(event.pitch, event.yaw, 0, 'YXZ')));
        camera.position.copy(basePosition).add(new T.Vector3(0, 0, event.back).applyQuaternion(baseQuaternion));
        camera.updateMatrixWorld(true);
      });
      bus.on('shot', event => {
        const spring = weapon.recoil.state();
        const expectedCamera = baseQuaternion.clone().multiply(new T.Quaternion().setFromEuler(
          new T.Euler(spring.pitch * 0.35, spring.yaw * 0.35, 0, 'YXZ')));
        const expectedPosition = basePosition.clone().add(new T.Vector3(0, 0, spring.back * 0.35).applyQuaternion(baseQuaternion));
        const expectedMuzzleQuaternion = expectedCamera.clone().multiply(weapon.viewmodel.quaternion)
          .multiply(weapon.model.quaternion).multiply(weapon.nodes.W_Muzzle.quaternion);
        const expectedDirection = forward.clone().applyQuaternion(expectedMuzzleQuaternion).normalize();
        observations.push({ index: event.index, time: event.time, spring,
          cameraEventTime: lastCameraEvent?.time,
          cameraPitchError: Math.abs((lastCameraEvent?.pitch ?? NaN) - spring.pitch * 0.35),
          cameraYawError: Math.abs((lastCameraEvent?.yaw ?? NaN) - spring.yaw * 0.35),
          cameraRotationError: 1 - Math.abs(camera.quaternion.dot(expectedCamera)),
          cameraPositionError: camera.position.distanceTo(expectedPosition),
          directionError: event.direction.distanceTo(expectedDirection),
          direction: event.direction.toArray(), position: event.position.toArray(),
        });
      });
      bus.on('*', event => events.push(packEvent(event)));
      const detachAudio = attachAudio({
        gunshot: data => audio.push({ name: 'gunshot', ...packEvent(data) }),
        play: (name, data) => audio.push({ name, ...packEvent(data) }),
        footstep() {}, setRoom() {},
      }, bus);
      const hooks = hooksMode === 'override' ? {
        shot: () => overrides.shot++, impact: () => overrides.impact++,
        update: dt => { overrides.update++; overrides.dt += dt; },
        light: on => overrides.light.push(on), dispose: () => overrides.dispose++,
      } : hooksMode === 'null' ? { shot: null, impact: null, update: null, light: null } : {};
      const effectsFactory = async () => {
        if (throwingFactory) throw new Error('EXPECTED_EFFECTS_FACTORY_FAILURE');
        return {
          shot: () => defaults.shot++, impact: () => defaults.impact++,
          update: dt => { defaults.update++; defaults.dt += dt; },
          light: on => defaults.light.push(on), dispose: () => defaults.dispose++, stats: () => ({ recording: true }),
        };
      };
      try {
        weapon = await createWeapon({ scene, camera, world, bus, effectsFactory, hooks, random: () => 0.5,
          config: { initialMode: 'auto' } });
      } catch (error) {
        const result = { message: error.message, cameraChildren: camera.children.map(node => node.name),
          sceneChildren: scene.children.map(node => node.name) };
        detachAudio(); bus.clear(); wall.geometry.dispose(); wall.material.dispose();
        return { failure: result };
      }
      const close = () => {
        weapon.dispose(); weapon.dispose(); detachAudio(); bus.clear();
        wall.geometry.dispose(); wall.material.dispose();
      };
      return { scene, camera, wall, world, weapon, bus, defaults, overrides, audio, events, observations, detachAudio, close };
    }

    async function auto(durations) {
      const f = await fixture();
      try {
        f.weapon.ads(true);
        f.weapon.update(0.28);
        f.weapon.trigger(true);
        for (const dt of durations) f.weapon.update(dt);
        f.weapon.trigger(false);
        return { state: f.weapon.state(), observations: f.observations, events: f.events,
          defaults: { ...f.defaults }, audio: f.audio };
      } finally { f.close(); }
    }

    const one = await auto([0.1]);
    const partitioned = await auto(Array(100).fill(0.001));
    const hooks = {};
    for (const hooksMode of ['default', 'override', 'null']) {
      const f = await fixture({ hooksMode });
      try {
        f.weapon.ads(true); f.weapon.update(0.28);
        f.weapon.light(true);
        f.weapon.fire(2); f.weapon.update(0.2);
        f.weapon.light(false);
        f.weapon.reload(); f.weapon.update(3.7);
        f.weapon.fire(31); f.weapon.update(3.0);
        f.weapon.fire(); f.weapon.update(0.1);
        f.weapon.reload(); f.weapon.update(2.9);
        const beforeDetach = f.audio.length;
        f.detachAudio();
        f.weapon.light(true);
        const afterDetach = f.audio.length;
        f.close();
        hooks[hooksMode] = { defaults: f.defaults, overrides: f.overrides, audio: f.audio,
          events: f.events.filter(event => event.type !== 'cameraRecoil'), beforeDetach, afterDetach,
          cameraChildrenAfterDispose: f.camera.children.length };
      } catch (error) { f.close(); throw error; }
    }
    const rejected = await fixture({ throwingFactory: true });
    return { one, partitioned, hooks, rejected: rejected.failure };
  });

  const { one, partitioned, hooks, rejected } = report.isolated;
  check('Both frame partitions produce two real GLB shots', one.observations.length === 2 && partitioned.observations.length === 2);
  check('Actual weapon recoil is frame-partition invariant', ['pitch', 'yaw', 'back'].every(axis =>
    near(one.state.recoil[axis], partitioned.state.recoil[axis], 1e-12)
      && near(one.state.recoil.velocity[axis], partitioned.state.recoil.velocity[axis], 1e-12)));
  check('Shot positions, directions and timestamps are frame-partition invariant', one.observations.every((shot, index) => {
    const other = partitioned.observations[index];
    return near(shot.time, other?.time) && shot.direction.every((v, i) => near(v, other.direction[i]))
      && shot.position.every((v, i) => near(v, other.position[i]));
  }));
  check('Every shot receives current 35% absolute camera recoil before raycast', [...one.observations, ...partitioned.observations].every(shot =>
    near(shot.time, shot.cameraEventTime) && ['cameraPitchError', 'cameraYawError', 'cameraRotationError',
      'cameraPositionError', 'directionError'].every(key => Math.abs(shot[key]) < 1e-10)));
  check('Second auto shot has nonzero camera recoil', one.observations[1].spring.pitch > 0.01);
  for (const mode of ['default', 'override', 'null']) {
    const h = hooks[mode];
    const active = mode === 'override' ? h.overrides : h.defaults;
    const suppressed = mode === 'override' ? h.defaults : mode === 'null' ? active : null;
    if (mode !== 'null') check(`${mode}: shot, impact, light and update hooks execute`,
      active.shot === 33 && active.impact === 33 && active.light.join(',') === 'true,false,true'
      && active.update > 0 && near(active.dt, 10.18));
    if (suppressed) check(`${mode}: replaced hooks never fall through to default effects`,
      suppressed.shot === 0 && suppressed.impact === 0 && suppressed.light.length === 0 && suppressed.update === 0);
    check(`${mode}: dispose is idempotent and detaches camera children`, h.defaults.dispose === 1
      && h.overrides.dispose === (mode === 'override' ? 1 : 0) && h.cameraChildrenAfterDispose === 0);
    check(`${mode}: C4 detachAudio stops delivery`, h.beforeDetach === h.afterDetach);
  }
  const emitted = hooks.default.events;
  check('Shot schema carries rifle, indoor room, ammo, time and unit world direction', emitted.filter(e => e.type === 'shot').every(e =>
    e.weapon === 'rifle' && e.roomId === 'TEST_ROOM' && e.indoor === true && Number.isInteger(e.index)
    && Number.isInteger(e.ammo) && Number.isFinite(e.time) && e.position.every(Number.isFinite)
    && near(Math.hypot(...e.direction), 1)));
  check('Impact schema contains actual target, surface, world point and unit normal', emitted.filter(e => e.type === 'impact').every(e =>
    e.surface === 'wood' && e.object === 'IntegrationWoodTarget' && e.point.every(Number.isFinite)
    && near(Math.hypot(...e.normal), 1) && Number.isInteger(e.shotIndex)));
  const audioNames = hooks.default.audio.map(call => call.name);
  check('Actual C4 attachAudio accepts shot/impact/reload/empty/light bus events', ['gunshot', 'impact_wood', 'mag_out',
    'mag_in', 'mag_drop', 'bolt_release', 'dry_fire', 'light_click'].every(name => audioNames.includes(name)));
  check('effectsFactory rejection detaches partially initialized GLB', rejected?.message === 'EXPECTED_EFFECTS_FACTORY_FAILURE'
    && rejected.cameraChildren.length === 0);

  report.dispose = await page.evaluate(async () => {
    const { createWeapon } = await import('../../js/weapon/index.js');
    const b = __bodycam;
    const snapshot = () => {
      b.dev.render();
      const nodes = []; const lights = [];
      b.dev.scene.traverse(node => {
        if (node.name.startsWith('Weapon')) nodes.push(node.name);
        if (node.isLight && node.name.startsWith('Weapon')) lights.push(node.name);
      });
      return { cameraChildren: b.dev.camera.children.map(node => ({ name: node.name, uuid: node.uuid })), weaponNodes: nodes,
        weaponLights: lights, memory: { ...b.dev.renderer.info.memory } };
    };
    b.weapon.ads(true); b.dev.step(0.28); b.weapon.fire(); b.weapon.light(true); b.dev.step(0.02);
    const before = snapshot();
    b.weapon.dispose(); b.weapon.dispose();
    const after = snapshot();
    const replacement = await createWeapon({ scene: b.dev.scene, camera: b.dev.camera, world: b.dev.world });
    replacement.light(true); replacement.fire(); replacement.update(0.02);
    const secondLive = snapshot();
    replacement.dispose(); replacement.dispose();
    const afterSecond = snapshot();
    return { before, after, secondLive, afterSecond, disposed: b.weapon.state().disposed,
      effectsDisposed: b.weapon.state().effects.disposed };
  });
  const d = report.dispose;
  const unrelatedCameraChildren = d.before.cameraChildren.filter(node => node.name !== 'WeaponViewmodel');
  const sameCameraChildren = children => children.length === unrelatedCameraChildren.length
    && children.every((node, index) => node.uuid === unrelatedCameraChildren[index].uuid);
  check('Standard demo weapon actually allocated model/effect geometry, textures and three lights',
    d.before.cameraChildren.some(node => node.name === 'WeaponViewmodel') && d.before.weaponLights.length === 3
    && d.before.memory.geometries > d.after.memory.geometries && d.before.memory.textures > d.after.memory.textures);
  check('Standard dispose removes viewmodel, world effects, impact decals and weapon lights',
    d.disposed && d.effectsDisposed && sameCameraChildren(d.after.cameraChildren)
    && d.after.weaponNodes.length === 0 && d.after.weaponLights.length === 0);
  check('Second standard GLB/FX load and dispose returns renderer memory to same baseline',
    d.secondLive.memory.geometries > d.after.memory.geometries
    && d.afterSecond.memory.geometries === d.after.memory.geometries
    && d.afterSecond.memory.textures === d.after.memory.textures
    && sameCameraChildren(d.afterSecond.cameraChildren) && d.afterSecond.weaponNodes.length === 0);
  check('No browser errors or warnings', report.errors.length === 0 && report.warnings.length === 0);
  check('No failed model, texture or module requests', report.requests.length === 0);
  assert.ok(report.checks.every(check => check.passed), report.checks.filter(check => !check.passed).map(check => check.name).join('\n'));
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/reports/integration.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, passed: report.checks.filter(check => check.passed).length,
    checks: report.checks.length, failed: report.checks.filter(check => !check.passed), failure: report.failure,
    errors: report.errors, warnings: report.warnings, requests: report.requests }, null, 2));
  await browser.close();
}
