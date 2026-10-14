import * as THREE from 'three';
import { loadWorld } from '../../js/world/index.js';
import { createPlayer } from '../../js/player/index.js';
import { createInput } from '../../js/core/input.js';
import { createWeapon, createWeaponBus } from '../../js/weapon/index.js';

// Neutral acceptance lighting is optional and is not part of the production weapon.
export const TEST_CONFIG = { near: 0.01, far: 160, exposure: 1, maxPixelRatio: 1,
  inspection: { intensity: 1.6, color: 0xf7eddf, weaponKey: 3 }, hall: [-0.28, 0.608, -1.6, 0, -4] };
const params = new URLSearchParams(location.search);
const canvas = document.querySelector('#view');
const metrics = document.querySelector('#metrics');
const start = document.querySelector('#start');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, TEST_CONFIG.maxPixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = TEST_CONFIG.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(82, innerWidth / innerHeight, TEST_CONFIG.near, TEST_CONFIG.far);
scene.add(camera);
const input = createInput(canvas, { debug: params.get('debug') === '1' });
const bus = createWeaponBus();
const inspection = new THREE.HemisphereLight(TEST_CONFIG.inspection.color, 0x6b6260, TEST_CONFIG.inspection.intensity);
inspection.layers.enable(1);
inspection.visible = params.get('inspect') === '1';
scene.add(inspection);
const weaponKey = new THREE.DirectionalLight(0xfff2df, TEST_CONFIG.inspection.weaponKey);
weaponKey.position.set(-1, 2, 2);
weaponKey.target.position.set(0, -0.15, -0.5);
weaponKey.layers.set(1);
weaponKey.visible = inspection.visible;
camera.add(weaponKey, weaponKey.target);
let world, player, weapon;
let ready = false;
let paused = false;
let raf;
let last = performance.now();
let frames = 0;
const samples = [];
const events = [];
const counts = {};
const baseQuaternion = new THREE.Quaternion();
const basePosition = new THREE.Vector3();
bus.on('*', event => {
  if (event.type === 'cameraRecoil') {
    // Always rebuild from the player's base transform; never accumulate recoil.
    camera.quaternion.copy(baseQuaternion).multiply(new THREE.Quaternion().setFromEuler(
      new THREE.Euler(event.pitch, event.yaw, 0, 'YXZ')));
    camera.position.copy(basePosition).add(new THREE.Vector3(0, 0, event.back).applyQuaternion(baseQuaternion));
    camera.updateMatrixWorld(true);
    return;
  }
  counts[event.type] = (counts[event.type] ?? 0) + 1;
  events.push({ ...event, position: event.position?.toArray?.() ?? event.position,
    point: event.point?.toArray?.(), normal: event.normal?.toArray?.(), object: event.object?.name,
    direction: event.direction?.toArray?.() });
  if (events.length > 400) events.shift();
});

function render() {
  renderer.info.reset();
  camera.layers.set(0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  // Clear depth and omit the world background for the separate weapon pass.
  const background = scene.background;
  const shadowUpdate = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  scene.background = null;
  camera.layers.set(1);
  renderer.render(scene, camera);
  scene.background = background;
  renderer.shadowMap.autoUpdate = shadowUpdate;
  camera.layers.set(0);
  frames++;
  updateHud();
}

function advance(dt) {
  player.update(dt);
  baseQuaternion.copy(camera.quaternion);
  basePosition.copy(camera.position);
  weapon.update(dt, { sprinting: !!player.state.sprinting && !!player.state.moving });
}

function step(seconds = 1 / 60) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new RangeError('step: 0..60 seconds');
  let remaining = seconds;
  while (remaining > 1e-10) { const dt = Math.min(1 / 120, remaining); advance(dt); remaining -= dt; }
  if (!seconds) weapon.update(0);
  render();
  return stats();
}

function stats() {
  const gl = renderer.getContext();
  const gpu = gl.getExtension('WEBGL_debug_renderer_info');
  return { ready, paused, ...player?.stats(), frames,
    fps: samples.length ? 1000 / (samples.reduce((a, b) => a + b, 0) / samples.length) : 0,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    viewport: [canvas.width, canvas.height], gpu: gpu ? gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL) : 'unknown',
    inspectionLight: inspection.visible, weapon: weapon?.state(), events: counts };
}

function updateHud() {
  if (!weapon) return;
  const state = weapon.state();
  metrics.textContent = `${paused ? 'Pause' : 'Laufend'} · ${player.room?.id ?? 'OUT'} · ${state.state}\n`
    + `${state.magazine}+${state.chamber} Patronen · ${state.spareMagazines} Ersatzmagazine · ${state.mode === 'auto' ? 'Auto' : 'Einzel'}\n`
    + `ADS ${Math.round(state.adsProgress * 100)} % · Waffenlicht ${state.light ? 'an' : 'aus'} · Prüflicht ${inspection.visible ? 'an' : 'aus'}\n`
    + `${state.shots} Schüsse · Treffer ${state.lastHit?.surface ?? 'keiner'} · ${state.lastHit?.object ?? ''}`;
}

function setPaused(on) {
  paused = !!on;
  if (paused) weapon?.trigger(false);
  document.querySelector('#pause').textContent = paused ? 'Weiter' : 'Pause';
  last = performance.now();
  return paused;
}
function teleport(...args) {
  player.teleport(...args);
  baseQuaternion.copy(camera.quaternion);
  basePosition.copy(camera.position);
  weapon.update(0);
  render();
  return player.stats();
}
function frame(now) {
  const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
  last = now;
  if (!paused) {
    advance(dt);
    if (dt > 0) { samples.push(dt * 1000); if (samples.length > 180) samples.shift(); }
  }
  render();
  raf = requestAnimationFrame(frame);
}

window.__bodycam = { get ready() { return ready; }, stats };
try {
  world = await loadWorld(scene, { renderer, onProgress: p => {
    metrics.textContent = `${p.stage}: ${Math.round(p.progress * 100)} %`;
  } });
  world.lighting.root.traverse(node => { if (node.isLight) node.layers.enable(1); });
  player = createPlayer({ camera, input, world });
  baseQuaternion.copy(camera.quaternion);
  basePosition.copy(camera.position);
  weapon = await createWeapon({ scene, camera, world, input, bus });
  if (params.get('hall') === '1') teleport(...TEST_CONFIG.hall);
  Object.assign(window.__bodycam, {
    weapon, teleport, look: (...args) => {
      player.look(...args); baseQuaternion.copy(camera.quaternion); basePosition.copy(camera.position);
      weapon.update(0); render();
    },
    dev: { scene, camera, renderer, input, player, world, bus, events, counts,
      pause: setPaused, step, render,
      inspectionLight(on) { inspection.visible = weaponKey.visible = !!on; render(); },
      clearEvents() { events.length = 0; for (const key of Object.keys(counts)) delete counts[key]; },
      projectNode(name) {
        const point = weapon.nodes[name].getWorldPosition(new THREE.Vector3()).project(camera);
        return [(point.x + 1) / 2, (1 - point.y) / 2, point.z];
      },
    },
  });
  ready = true;
  document.documentElement.dataset.ready = 'true';
  last = performance.now();
  raf = requestAnimationFrame(frame);
} catch (error) {
  console.error('[C3]', error);
  metrics.classList.add('error');
  metrics.textContent = `Laden fehlgeschlagen: ${error.message}`;
  document.documentElement.dataset.error = error.message;
}
start.onclick = () => input.requestLock();
input.on('pointerlockchange', () => { start.hidden = input.locked; });
document.querySelector('#hall').onclick = () => ready && teleport(...TEST_CONFIG.hall);
document.querySelector('#pause').onclick = () => setPaused(!paused);
document.querySelector('#inspection').onclick = event => {
  inspection.visible = !inspection.visible;
  weaponKey.visible = inspection.visible;
  event.target.textContent = `Prüflicht ${inspection.visible ? 'an' : 'aus'}`;
};
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  weapon?.update(0);
});
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(raf);
  weapon?.dispose(); player?.dispose(); input.dispose(); world?.dispose(); bus.clear(); renderer.dispose();
}, { once: true });
