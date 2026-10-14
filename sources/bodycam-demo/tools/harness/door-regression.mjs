import { configureAudioOutput, DEFAULT_AUDIO_SINK } from './audio-output.mjs';

/** C16: real production door/player modules plus actual App weapon-hit routing.
 * The parent owns the browser, server, diagnostics and writing returned evidence.
 * No browser globals or production modules are replaced by test doubles.
 */
const IMPORTS = {
  three: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
  'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/',
  'three-mesh-bvh': 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/build/index.module.js',
};

export async function runDoorRegression({ page, origin, out, audioSink = DEFAULT_AUDIO_SINK }) {
  const checks = [], evidence = { outputDirectory: out, fixture: '0.90 x 2.05 x 0.045 m physical leaf; 20 m floor; production modules' };
  try {
    if (!await page.evaluate(() => !!(window.__bodycam?.ready && window.__bodycam?.dev && window.__bodycam?.weapon))) {
      await page.goto(`${origin}/bodycam-demo/?debug=1&quality=low`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => window.__bodycam?.ready === true, { timeout: 120000 });
    }
    evidence.audioOutput = await configureAudioOutput(page, audioSink);
    const app = await page.evaluate(runAppDoorHits);
    checks.push(...app.checks);
    evidence.app = app;
  } catch (error) {
    checks.push({ name: 'doors-app-projectile-routing', passed: false, details: {
      error: String(error.stack ?? error), reproduction: '/bodycam-demo/?debug=1&quality=low; await ready; real weapon.fire(1)',
      source: 'public/bodycam-demo/js/app/runtime.js:274',
    } });
  }

  const fixtureUrl = `${origin}/bodycam-demo/__harness_doors.html`;
  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><title>C16 Türregression</title>
    <link rel="icon" href="data:,"><script type="importmap">${JSON.stringify({ imports: IMPORTS })}</script>
    <body><canvas id="view" tabindex="0"></canvas><script type="module">
      import * as THREE from 'three';
      import { createDoors, DOOR_CONFIG } from './js/world/doors.js';
      import { makeCollider } from './js/world/colliders.js';
      import { createPlayer } from './js/player/player.js';
      import { createInput } from './js/core/input.js';
      window.__doorModules = { THREE, createDoors, DOOR_CONFIG, makeCollider, createPlayer, createInput };
    </script></body></html>`;
  const handler = route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  await page.route(fixtureUrl, handler);
  try {
    await page.goto(fixtureUrl, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!window.__doorModules, { timeout: 90000 });
    await page.bringToFront();
    await page.locator('#view').click();
    const fixture = await page.evaluate(runPhysicalDoorFixture);
    checks.push(...fixture.checks);
    evidence.fixtureResults = fixture;
  } catch (error) {
    checks.push({ name: 'doors-fixture-execution', passed: false, details: { error: String(error.stack ?? error), fixtureUrl } });
  } finally {
    await page.unroute(fixtureUrl, handler);
  }
  return { checks, evidence };
}

async function runAppDoorHits() {
  const THREE = await import('three');
  const api = window.__bodycam;
  if (!api?.weapon || !api.world?.doors?.length || !api.dev) throw new Error('Real App weapon/world/dev hooks unavailable');
  api.dev.freeze(true);
  const audio = api.dev.audio?.context;
  const audioSink = audio?.sinkId ?? 'unavailable';
  const camera = api.dev.camera, weapon = api.weapon;
  const originalPlayer = api.player.stats();
  const restorePlayer = () => api.teleport(...originalPlayer.position, originalPlayer.yawDeg, originalPlayer.pitchDeg);
  const originalDoors = api.world.doors.map(door => ({ door, angle: door.angle, velocity: door.velocity,
    latched: door.latched, targetAngle: door.targetAngle, blocked: door.blocked }));
  const checks = [], scenarios = [];
  const idOf = object => {
    for (let node = object; node; node = node.parent) if (node.userData.doorId !== undefined) return node.userData.doorId;
    return null;
  };
  try {
    weapon.ads(true);
    weapon.update(1.2);
    for (const latched of [true, false]) {
      const name = `doors-app-projectile-${latched ? 'latched' : 'unlatched'}`;
      try {
        let selected = null;
        const attempts = [];
        for (const door of [...api.world.doors].sort((a, b) => Number(b.exterior) - Number(a.exterior))) {
          door.setAngle(latched ? 0 : 45); door.velocity = 0; door.latched = latched;
          const heading = THREE.MathUtils.degToRad(door.leafHeading());
          const target = door.hinge.clone().add(new THREE.Vector3(Math.cos(heading) * door.width * 0.60, 1.05,
            -Math.sin(heading) * door.width * 0.60));
          const normal = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
          for (const side of [1, -1]) {
            const eye = target.clone().addScaledVector(normal, side * 1.4);
            const yaw = Math.atan2(target.x - eye.x, target.z - eye.z) + Math.PI;
            api.teleport(eye.x, door.hinge.y + 0.02, eye.z, THREE.MathUtils.radToDeg(yaw), 0);
            weapon.update(1.0);
            // Use App look/teleport: weapon.update emits cameraRecoil, which restores
            // the runtime's captured camera base and discards direct camera mutations.
            for (let i = 0; i < 12; i++) {
              const ray = weapon.raycast();
              const wanted = target.clone().sub(ray.position).normalize();
              if (ray.direction.angleTo(wanted) < 0.0002) break;
              const corrected = new THREE.Quaternion().setFromUnitVectors(ray.direction, wanted).multiply(camera.quaternion);
              const angles = new THREE.Euler().setFromQuaternion(corrected, 'YXZ');
              api.look(THREE.MathUtils.radToDeg(angles.y), THREE.MathUtils.radToDeg(angles.x));
            }
            const probe = weapon.raycast();
            attempts.push({ door: door.id, side, hit: probe.hit?.object.name ?? null,
              hitDoor: idOf(probe.hit?.object), distance: probe.hit?.distance ?? null,
              camera: camera.position.toArray(), muzzle: probe.position.toArray(), direction: probe.direction.toArray() });
            if (probe.hit && idOf(probe.hit.object) === door.id) { selected = { door, side, probe }; break; }
          }
          if (selected) break;
          const saved = originalDoors.find(entry => entry.door === door);
          door.setAngle(saved.angle); door.velocity = saved.velocity; door.latched = saved.latched;
        }
        if (!selected) throw new Error(`No actual door on muzzle ray: ${JSON.stringify(attempts)}`);
        const { door, probe } = selected;
        const before = { angle: door.angle, velocity: door.velocity, latched: door.latched, shots: weapon.state().shots };
        const impacts = [];
        const off = weapon.on('impact', hit => impacts.push({ door: idOf(hit.object), object: hit.object.name,
          point: hit.point.toArray(), normal: hit.normal.toArray(), direction: hit.direction?.toArray() ?? null }));
        let accepted;
        try { accepted = weapon.fire(1); weapon.update(0.2); } finally { off(); }
        const afterHit = { angle: door.angle, velocity: door.velocity, latched: door.latched, shots: weapon.state().shots };
        // Put the player back at the validated spawn before checking free motion;
        // the aiming position may intentionally be outside walkable floor geometry.
        restorePlayer();
        const trace = [];
        for (let tick = 0; tick < 120; tick++) {
          api.world.update(1 / 240);
          trace.push({ t: (tick + 1) / 240, angle: door.angle, velocity: door.velocity, latched: door.latched, blocked: door.blocked });
        }
        const hitRouted = impacts.some(hit => hit.door === door.id) && afterHit.shots === before.shots + 1;
        const result = latched
          ? afterHit.velocity === 0 && trace.every(row => row.angle === 0 && row.latched)
          : Math.abs(afterHit.velocity) > 1 && trace.some(row => Math.abs(row.angle - before.angle) > 0.1);
        const details = { door: door.id, latched, accepted, before, afterHit, impacts, attempts,
          muzzle: probe.position.toArray(), rayDirection: probe.direction.toArray(),
          source: 'public/bodycam-demo/js/app/runtime.js:274; public/bodycam-demo/js/weapon/weapon.js:85; public/bodycam-demo/js/world/doors.js:77',
          reproduction: 'Freeze debug App, ADS, api.teleport/api.look aim actual muzzle at door leaf, weapon.fire(1), restore spawn, update world at 240 Hz.' };
        checks.push({ name, passed: hitRouted && result, details });
        scenarios.push({ name, ...details, trace });
        for (const saved of originalDoors) {
          saved.door.setAngle(saved.angle); saved.door.velocity = saved.velocity; saved.door.latched = saved.latched;
        }
      } catch (error) {
        checks.push({ name, passed: false, details: { error: String(error.stack ?? error), source: 'public/bodycam-demo/js/app/runtime.js:274' } });
      }
    }
  } finally {
    for (const saved of originalDoors) {
      saved.door.setAngle(saved.angle); saved.door.velocity = saved.velocity; saved.door.latched = saved.latched;
      saved.door.targetAngle = saved.targetAngle; saved.door.blocked = saved.blocked;
    }
    restorePlayer();
  }
  return { checks, scenarios, audioSink, actualWorld: api.world.stats };
}

function runPhysicalDoorFixture() {
  const { THREE, createDoors, DOOR_CONFIG, makeCollider, createPlayer, createInput } = window.__doorModules;
  const checks = [], scenarios = [];
  const width = 0.9, height = 2.05, thickness = 0.045;
  const degrees = THREE.MathUtils.radToDeg;
  const tolerance = 0.002; // Metres: exceeds clear()'s 1.5 mm tolerance; never trusts clear() as the oracle.
  const run = (name, task) => {
    try {
      const result = task();
      checks.push({ name, passed: result.passed, details: result.details });
      scenarios.push({ name, ...result });
    } catch (error) { checks.push({ name, passed: false, details: { error: String(error.stack ?? error) } }); }
  };

  function setup(openDir = 1) {
    const scene = new THREE.Scene();
    const pivot = new THREE.Group(); pivot.name = 'DOOR_C16';
    pivot.userData = { hinge: [0, 0, 0], opening: 'C16', openAngle: 0, maxAngle: 105, openDir };
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), new THREE.MeshBasicMaterial());
    leaf.position.set(width / 2, height / 2, 0); leaf.userData.surface = 'wood'; pivot.add(leaf); scene.add(pivot);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 20), new THREE.MeshBasicMaterial());
    floor.position.y = -0.1; scene.add(floor); scene.updateMatrixWorld(true);
    const [door] = createDoors(scene, { doors: [{ kind: 'door', object: pivot.name, id: 'C16' }] });
    const floorCollider = makeCollider([floor], { name: 'C16_FLOOR' });
    const input = createInput(document.querySelector('#view'), { debug: true });
    window.dispatchEvent(new Event('focus'));
    const camera = new THREE.PerspectiveCamera(82, 1, 0.01, 100);
    const trace = [];
    let simTime = 0, player;
    // Fixture geometry only: all simulation, collision and input behavior is production code.
    const world = { doors: [door], colliders: { static: floorCollider, doors: [door.collider] }, rooms: [],
      spawn: { position: new THREE.Vector3(3, 0.002, 3), yawDeg: 0 },
      roomAt: () => null, surfaceAt: () => 'concrete',
      update(dt) { door.update(dt); simTime += dt; trace.push(sample('after-door-update')); } };
    player = createPlayer({ camera, input, world });
    function overlap() {
      // Independent exact capsule-vs-box distance. No BVH or CapsuleCollision methods.
      pivot.updateWorldMatrix(true, false);
      const p = player.position.clone().applyMatrix4(pivot.matrixWorld.clone().invert());
      const radius = player.config.radius;
      const dx = Math.max(0, -p.x, p.x - width);
      const dz = Math.max(0, Math.abs(p.z) - thickness / 2);
      const capsuleLow = p.y + radius, capsuleHigh = p.y + player.physics.height - radius;
      const dy = Math.max(0, -capsuleHigh, capsuleLow - height);
      return radius - Math.hypot(dx, dy, dz);
    }
    function sample(phase = 'frame') {
      return { t: simTime, phase, angle: door.angle, velocity: door.velocity, latched: door.latched,
        blocked: door.blocked, overlap: overlap(), position: player.position.toArray(), wishVelocity: player.wishVelocity.toArray() };
    }
    function key(pressed) { document.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code: 'KeyW', key: 'w', bubbles: true })); }
    function dispose() {
      key(false); player.dispose(); input.dispose();
      const geometries = new Set(), materials = new Set();
      scene.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.material) materials.add(node.material); });
      geometries.add(floorCollider.geometry); materials.add(floorCollider.material);
      for (const geometry of geometries) { geometry.boundsTree = null; geometry.dispose(); }
      for (const material of materials) material.dispose();
    }
    return { door, player, input, trace, sample, overlap, key, dispose,
      simulate(seconds, hz = 60) {
        for (let frame = 0; frame < Math.round(seconds * hz); frame++) { player.update(1 / hz); trace.push(sample('after-player-update')); }
      } };
  }

  for (const hz of [30, 60, 144]) run(`doors-toggle-bounce-close-latch-${hz}hz`, () => {
    const f = setup();
    try {
      const initial = f.sample();
      f.door.toggle(); const shove = f.sample(); f.simulate(4, hz);
      const open = f.trace.slice(); const openEnd = f.sample();
      f.door.toggle(); const closingShove = f.sample(); f.simulate(6, hz);
      const end = f.sample();
      const maxAngle = Math.max(...open.map(row => row.angle));
      const stop = open.findIndex(row => row.angle >= f.door.maxAngle - 0.02);
      const bounced = stop >= 0 && open.slice(stop).some(row => row.velocity < -0.5 && row.angle < f.door.maxAngle - 0.5);
      const finite = f.trace.every(row => Number.isFinite(row.angle) && Number.isFinite(row.velocity)
        && row.angle >= 0 && row.angle <= f.door.maxAngle);
      return { passed: initial.latched && !shove.latched && shove.velocity > 0 && maxAngle >= 104.9
          && bounced && openEnd.angle > DOOR_CONFIG.openThresholdDeg && closingShove.velocity < 0
          && end.angle === 0 && end.velocity === 0 && end.latched && finite,
        details: { hz, initial, shove, openEnd, closingShove, end, maxAngle, bounced, finite,
          reproduction: 'Closed leaf; toggle(); simulate 4 s; toggle(); simulate 6 s through production Player.update().',
          source: 'public/bodycam-demo/js/world/doors.js:70-130' }, trace: f.trace };
    } finally { f.dispose(); }
  });

  for (const openDir of [1, -1]) for (const side of [1, -1]) run(`doors-player-push-dir${openDir}-side${side}`, () => {
    const f = setup(openDir);
    try {
      const startAngle = 55;
      f.door.setAngle(startAngle); f.door.latched = false; f.door.velocity = 0;
      const h = THREE.MathUtils.degToRad(startAngle * openDir);
      const center = new THREE.Vector3(Math.cos(h) * width * 0.65, 0.002, -Math.sin(h) * width * 0.65);
      const normal = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
      const position = center.clone().addScaledVector(normal, side * (f.player.config.radius + thickness / 2 + 0.015));
      f.player.teleport(...position.toArray(), degrees(h) + (side > 0 ? 0 : 180), 0);
      const initial = f.sample();
      f.key(true); f.simulate(0.30); f.key(false);
      const end = f.sample();
      const angleDelta = end.angle - startAngle;
      const finalH = THREE.MathUtils.degToRad(end.angle * openDir);
      const finalCenter = new THREE.Vector3(Math.cos(finalH) * width * 0.65, 0.002, -Math.sin(finalH) * width * 0.65);
      const awayDistance = -finalCenter.sub(center).dot(normal.clone().multiplyScalar(side));
      const maxOverlap = Math.max(initial.overlap, ...f.trace.map(row => row.overlap));
      return { passed: initial.overlap < 0 && angleDelta * side * openDir > 0.5 && awayDistance > 0.01 && maxOverlap <= tolerance,
        details: { openDir, side, initial, end, angleDelta, awayDistance, maxOverlap, tolerance,
          inputActive: f.input.active, reproduction: '55 degree free leaf; real KeyW input from each face for 0.30 s at 60 Hz.',
          source: 'public/bodycam-demo/js/world/doors.js:87-101; public/bodycam-demo/js/player/player.js:48-52' }, trace: f.trace };
    } finally { f.dispose(); }
  });

  for (const opening of [true, false]) run(`doors-player-blocks-${opening ? 'opening' : 'closing'}`, () => {
    const f = setup();
    try {
      const startAngle = opening ? 25 : 85, blockerAngle = opening ? 75 : 35;
      f.door.setAngle(startAngle); f.door.latched = false;
      const h = THREE.MathUtils.degToRad(blockerAngle);
      f.player.teleport(Math.cos(h) * width * 0.70, 0.002, -Math.sin(h) * width * 0.70, 0, 0);
      const initial = f.sample();
      f.door.velocity = opening ? DOOR_CONFIG.impulseDegPerSecond : -DOOR_CONFIG.impulseDegPerSecond;
      f.simulate(2);
      const blockedSamples = f.trace.filter(row => row.blocked).length;
      const maxOverlap = Math.max(initial.overlap, ...f.trace.map(row => row.overlap));
      const travelled = Math.max(...f.trace.map(row => Math.abs(row.angle - startAngle)));
      const drift = new THREE.Vector3().fromArray(f.sample().position).sub(new THREE.Vector3().fromArray(initial.position)).setY(0).length();
      return { passed: initial.overlap < -0.02 && travelled > 3 && blockedSamples > 0 && maxOverlap <= tolerance && drift < 0.002,
        details: { opening, startAngle, blockerAngle, initial, end: f.sample(), blockedSamples, maxOverlap, tolerance, travelled, drift,
          reproduction: 'Stationary real player in future swept leaf volume; 190 deg/s door shove; sample independent overlap after every 240 Hz door substep and player frame.',
          source: 'public/bodycam-demo/js/world/doors.js:122-128; public/bodycam-demo/js/player/player.js:48-52' }, trace: f.trace };
    } finally { f.dispose(); }
  });

  for (const latched of [true, false]) run(`doors-raycast-impulse-${latched ? 'latched' : 'unlatched'}`, () => {
    const f = setup();
    try {
      f.door.setAngle(latched ? 0 : 45); f.door.latched = latched; f.door.velocity = 0;
      const h = THREE.MathUtils.degToRad(f.door.angle);
      const target = new THREE.Vector3(Math.cos(h) * width * 0.70, 1.0, -Math.sin(h) * width * 0.70);
      const normal = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
      const direction = normal.clone().negate();
      const hit = f.player.physics.collision.raycast(target.clone().addScaledVector(normal, 0.8), direction, 2);
      const before = f.sample();
      if (hit) f.door.impulse(hit.point, direction);
      const afterHit = f.sample(); f.simulate(0.5);
      const end = f.sample();
      const acted = latched ? afterHit.velocity === 0 && end.angle === 0 && end.latched
        : afterHit.velocity > 1 && end.angle > before.angle + 0.1;
      return { passed: hit?.object === f.door.collider && acted,
        details: { latched, before, afterHit, end, hit: hit ? { collider: hit.object.name, point: hit.point.toArray(), distance: hit.distance } : null,
          reproduction: 'Raycast into physical leaf at 70% radius; apply production impulse(hit.point, ray.direction); simulate 0.5 s.',
          source: 'public/bodycam-demo/js/world/doors.js:77-84' }, trace: f.trace };
    } finally { f.dispose(); }
  });
  return { checks, scenarios, config: { ...DOOR_CONFIG }, tolerance,
    overlapOracle: 'Exact distance between upright capsule axis and fixture box in pivot-local coordinates; independent of CapsuleCollision/BVH.' };
}
