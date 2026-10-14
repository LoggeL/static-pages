import * as THREE from 'three';
import { loadWorld } from '../../js/world/world.js';
import { createInput } from '../../js/core/input.js';
import { createPlayer } from '../../js/player/player.js';

// Ausschließlich Testseitenparameter, keine Abstimmung des finalen Looks.
export const TEST_CONFIG = {
  maxPixelRatio: 1.5,
  shadows: true,
  exposure: 1,
  near: 0.035,
  far: 160,
  inspectionLight: { color: 0xfff2df, intensity: 12, distance: 18, angleDeg: 30, penumbra: 0.7, decay: 1.4 },
};

const debug = new URLSearchParams(location.search).get('debug') === '1';
const canvas = document.querySelector('#view');
const metrics = document.querySelector('#metrics');
const start = document.querySelector('#start');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, TEST_CONFIG.maxPixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = TEST_CONFIG.exposure;
renderer.shadowMap.enabled = TEST_CONFIG.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(82, innerWidth / innerHeight, TEST_CONFIG.near, TEST_CONFIG.far);
scene.add(camera);
const input = createInput(canvas, { debug });
const samples = [];
const events = { steps: [], rooms: [], doors: [] };
let world;
let player;
let lastTime = performance.now();
let lastHud = 0;
let frames = 0;
let raf;
let ready = false;

const inspection = TEST_CONFIG.inspectionLight;
const light = new THREE.SpotLight(inspection.color, inspection.intensity, inspection.distance,
  THREE.MathUtils.degToRad(inspection.angleDeg), inspection.penumbra, inspection.decay);
light.visible = new URLSearchParams(location.search).get('inspect') === '1';
light.castShadow = false;
light.position.set(0.05, -0.12, 0);
light.target.position.set(0, 0, -6);
camera.add(light, light.target);
input.on('flashlight', () => { light.visible = !light.visible; });
input.on('door', event => { events.doors.push({ id: event.door.id, opening: event.opening }); });
start.addEventListener('click', () => input.requestLock());
input.on('pointerlockchange', () => {
  start.hidden = input.locked;
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function stats() {
  const ms = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
  return { ready, ...player?.stats(), fps: ms ? 1000 / ms : 0, frameMs: ms, frames,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    viewport: [canvas.width, canvas.height], inspectionLight: light.visible,
    world: typeof world?.stats === 'function' ? world.stats() : world?.stats,
    events: { steps: events.steps.length, rooms: events.rooms, doors: events.doors },
  };
}

function frame(now) {
  const dt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  player.update(dt);
  renderer.render(scene, camera);
  frames++;
  if (dt > 0 && dt < 0.25) {
    samples.push(dt * 1000);
    if (samples.length > 180) samples.shift();
  }
  if (now - lastHud > 200) {
    const state = stats();
    const pos = state.position.map(number => number.toFixed(2)).join(', ');
    metrics.textContent = `${debug ? 'Debug ohne Pointer Lock' : 'Pointer Lock'} · ${state.room} · ${state.surface}\n`
      + `Fußpunkt (${pos}) · ${state.crouched ? 'geduckt' : 'stehend'} · ${state.grounded ? 'Boden' : 'Luft'}\n`
      + `${state.fps.toFixed(1)} FPS · ${state.drawCalls} Draw-Calls · ${state.triangles.toLocaleString('de-DE')} Dreiecke\n`
      + `Schritte ${state.steps} · ${state.speed.toFixed(2)} m/s · Prüfleuchte ${light.visible ? 'an' : 'aus'}`
      + (state.interaction ? `\nE: Tür ${state.interaction} öffnen/schließen` : '');
    lastHud = now;
  }
  raf = requestAnimationFrame(frame);
}

try {
  world = await loadWorld(scene, { renderer, onProgress: progress => {
    metrics.textContent = `${progress.stage}: ${Math.round(progress.progress * 100)} %`;
  } });
  player = createPlayer({ camera, input, world,
    onStep: event => {
      events.steps.push({ surface: event.surface, speed: event.speed, position: event.position.toArray() });
      if (events.steps.length > 1000) events.steps.shift();
    },
    onRoomChange: room => { events.rooms.push(room?.id || 'OUT'); },
  });
  if (debug) {
    window.__bodycam = {
      teleport: (...args) => player.teleport(...args),
      look: (...args) => player.look(...args),
      stats,
      player,
      dev: { scene, renderer, camera, input, world, events,
        resetMetrics() { samples.length = 0; },
        inspectionLight(enabled) { light.visible = enabled; },
      },
    };
    start.textContent = 'Optional: Maus einfangen';
  }
  ready = true;
  document.documentElement.dataset.ready = 'true';
  lastTime = performance.now();
  raf = requestAnimationFrame(frame);
} catch (error) {
  console.error('[C12]', error);
  metrics.classList.add('error');
  metrics.textContent = `Laden fehlgeschlagen: ${error.message}`;
  document.documentElement.dataset.error = error.message;
}

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(raf);
  player?.dispose();
  input.dispose();
  world?.dispose();
  renderer.dispose();
}, { once: true });
