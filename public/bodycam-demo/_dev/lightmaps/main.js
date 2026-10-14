import * as THREE from 'three';
import { VIEWER_CONFIG, CAMERA_PRESETS } from './config.js';
import { loadBakedWorld } from './world.js';

const query = new URLSearchParams(location.search);
const canvas = document.querySelector('#view');
const metrics = document.querySelector('#metrics');
const errorPanel = document.querySelector('#error');
const controls = Object.fromEntries(['preset', 'mode', 'inspection', 'collision', 'fog', 'exposure', 'door', 'door-toggle', 'start', 'copy']
  .map(id => [id, document.getElementById(id)]));
for (const control of Object.values(controls)) control.disabled = true;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, VIEWER_CONFIG.renderer.maxPixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = VIEWER_CONFIG.renderer.exposure;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VIEWER_CONFIG.camera.fov, innerWidth / innerHeight,
  VIEWER_CONFIG.camera.near, VIEWER_CONFIG.camera.far);
camera.rotation.order = 'YXZ';
scene.add(camera);
const lamp = VIEWER_CONFIG.inspectionLight;
const inspection = new THREE.SpotLight(lamp.color, lamp.intensity, lamp.distance,
  THREE.MathUtils.degToRad(lamp.angleDeg), lamp.penumbra, lamp.decay);
inspection.name = 'C6_INSPECTION_ONLY';
inspection.position.set(0.05, -0.12, 0);
inspection.target.position.set(0, 0, -6);
inspection.visible = false;
camera.add(inspection, inspection.target);
const keys = new Set(), samples = [];
let world, level, ready = false, lastTime = 0, hudTime = 0, frames = 0, raf, fog;
const api = window.__lightmaps = { ready: false, error: null, scene, renderer, camera,
  presets: CAMERA_PRESETS, config: VIEWER_CONFIG };
// C13's generic harness can wait for this signal without a bespoke adapter.
window.__bodycam = { ready: false, stats, dev: { scene, renderer, camera } };

function setCamera(...values) {
  const pose = Array.isArray(values[0]) ? values[0] : values;
  if (pose.length !== 5 || !pose.every(Number.isFinite)) throw new Error('Kamera benötigt x,y,z,yaw,pitch');
  camera.position.set(...pose.slice(0, 3));
  camera.rotation.set(THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pose[4], -89.8, 89.8)),
    THREE.MathUtils.degToRad(pose[3]), 0, 'YXZ');
  camera.updateMatrixWorld(true);
  return getCamera();
}

function getCamera() {
  return [...camera.position.toArray(), THREE.MathUtils.radToDeg(camera.rotation.y), THREE.MathUtils.radToDeg(camera.rotation.x)];
}

function setInspection(value) { inspection.visible = Boolean(value); controls.inspection.checked = inspection.visible; }
function setCollision(value) { world.collision.visible = Boolean(value); controls.collision.checked = world.collision.visible; }
function setFog(value) { scene.fog = value ? fog : null; controls.fog.checked = Boolean(scene.fog); }
function setMode(value) { world.setMode(value); controls.mode.value = value; }
function setExposure(value) {
  const exposure = Number(value);
  if (!(exposure > 0 && exposure <= VIEWER_CONFIG.renderer.maxExposure)) throw new Error(`Belichtung muss zwischen 0 und ${VIEWER_CONFIG.renderer.maxExposure} liegen`);
  renderer.toneMappingExposure = exposure; controls.exposure.value = exposure;
}

function stats() {
  const frameMs = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
  return { ready, frames, camera: getCamera(), cameraPosition: camera.position.toArray(),
    room: world?.roomAt(camera.position.toArray()) ?? 'OUT', fps: frameMs ? 1000 / frameMs : 0, frameMs,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    viewport: [canvas.width, canvas.height], textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries, exposure: renderer.toneMappingExposure,
    inspectionLight: inspection.visible, collision: world?.collision.visible ?? false,
    fog: Boolean(scene.fog), world: world?.stats() };
}

function sampleFrame() {
  renderer.render(scene, camera);
  const gl = renderer.getContext(), pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let sum = 0, black = 0, clipped = 0, peak = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const maximum = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    if (maximum <= 2) black++;
    if (maximum >= 254) clipped++;
    peak = Math.max(peak, maximum);
  }
  const count = pixels.length / 4;
  return { meanLuma: sum / count, blackFraction: black / count, clippedFraction: clipped / count, peak };
}

function updateMovement(dt) {
  if (document.pointerLockElement !== canvas && query.get('debug') !== '1') return;
  const direction = new THREE.Vector3(Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    Number(keys.has('Space')) - Number(keys.has('KeyC')),
    Number(keys.has('KeyS')) - Number(keys.has('KeyW')));
  if (!direction.lengthSq()) return;
  direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), camera.rotation.y);
  const speed = VIEWER_CONFIG.movement.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? VIEWER_CONFIG.movement.fastMultiplier : 1);
  camera.position.addScaledVector(direction, speed * dt);
}

function frame(now) {
  const elapsed = lastTime ? (now - lastTime) / 1000 : 0;
  lastTime = now;
  updateMovement(Math.min(elapsed, 0.05));
  renderer.render(scene, camera);
  frames++;
  if (elapsed > 0 && elapsed < 0.5) { samples.push(elapsed * 1000); if (samples.length > 180) samples.shift(); }
  if (now - hudTime > 250) {
    const value = stats();
    const modeLabel = { baked: 'Material + Bake', lighting: 'Nur Lichtkarte', atlases: 'Atlas-Zuordnung', unlit: 'Unbeleuchtetes Material' }[value.world.mode];
    metrics.textContent = `${value.room} · ${value.fps.toFixed(1)} FPS · ${value.drawCalls} Draw-Calls · ${value.triangles.toLocaleString('de-DE')} Dreiecke\n`
      + `Kamera ${value.camera.map(number => number.toFixed(2)).join(', ')}\n`
      + `${value.world.mappedMeshes} Meshes / ${value.world.atlases.length} Atlanten · ${(value.world.downloadBytes / 1048576).toFixed(2)} MiB PNG\n`
      + `${modeLabel} · Prüfleuchte ${value.inspectionLight ? 'an' : 'aus'} · Türen ohne Lightmap`;
    hudTime = now;
  }
  raf = requestAnimationFrame(frame);
}

for (const preset of CAMERA_PRESETS) controls.preset.add(new Option(preset.label, preset.id));
controls.preset.addEventListener('change', () => setCamera(CAMERA_PRESETS.find(preset => preset.id === controls.preset.value).pose));
controls.mode.addEventListener('change', () => setMode(controls.mode.value));
controls.inspection.addEventListener('change', () => setInspection(controls.inspection.checked));
controls.collision.addEventListener('change', () => setCollision(controls.collision.checked));
controls.fog.addEventListener('change', () => setFog(controls.fog.checked));
controls.exposure.addEventListener('change', () => {
  try { setExposure(controls.exposure.value); } catch (error) { controls.exposure.value = renderer.toneMappingExposure; }
});
controls['door-toggle'].addEventListener('click', () => {
  const door = world.doors.find(entry => entry.id === controls.door.value);
  door?.setAngle(door.angle > 30 ? 0 : door.definition.maxAngle ?? 105);
});
controls.start.addEventListener('click', async () => {
  try { canvas.focus(); await canvas.requestPointerLock(); } catch (error) { errorPanel.textContent = `Maussteuerung: ${error.message}`; }
});
controls.copy.addEventListener('click', async () => {
  const url = new URL(location.href);
  url.searchParams.set('cam', getCamera().map(number => number.toFixed(3)).join(','));
  try { await navigator.clipboard.writeText(url.href); controls.copy.textContent = 'Kamera-URL kopiert'; }
  catch { history.replaceState(null, '', url); controls.copy.textContent = 'Kamera-URL in Adresszeile'; }
});
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
  if (!event.repeat && event.code === 'KeyF') setInspection(!inspection.visible);
  keys.add(event.code);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC'].includes(event.code)) event.preventDefault();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
document.addEventListener('pointerlockchange', () => {
  keys.clear(); controls.start.hidden = document.pointerLockElement === canvas;
});
document.addEventListener('mousemove', event => {
  if (document.pointerLockElement !== canvas) return;
  camera.rotation.y -= event.movementX * VIEWER_CONFIG.movement.sensitivity;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - event.movementY * VIEWER_CONFIG.movement.sensitivity, -1.567, 1.567);
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

try {
  world = await loadBakedWorld(renderer, text => { metrics.textContent = text; });
  level = world.level;
  scene.add(world.house, world.collision);
  scene.background = new THREE.Color(level.background ?? '#10151e');
  if (level.fog?.enabled !== false && level.fog?.density > 0) {
    fog = new THREE.FogExp2(level.fog.color ?? '#141b26', level.fog.density);
  }
  setFog(query.get('fog') !== '0');
  const spawn = level.playerSpawn;
  setCamera(...spawn.position.map((value, index) => value + (index === 1 ? VIEWER_CONFIG.camera.height : 0)),
    spawn.yawDeg ?? 0, spawn.pitchDeg ?? VIEWER_CONFIG.camera.pitchDeg);
  if (query.has('cam')) setCamera(query.get('cam').split(',').map(Number));
  if (query.has('mode')) setMode(query.get('mode'));
  if (query.has('exposure')) setExposure(Number(query.get('exposure')));
  setInspection(query.get('inspect') === '1');
  setCollision(query.get('collision') === '1');
  for (const door of world.doors) controls.door.add(new Option(door.id, door.id));
  Object.assign(api, { world, level, setCamera, getCamera, setInspection, setCollision, setFog, setMode, setExposure,
    stats, sampleFrame, resetMetrics: () => { samples.length = 0; },
    setDoor: (id, angle) => {
      const door = world.doors.find(entry => entry.id === id);
      if (!door) throw new Error(`Unbekannte Tür ${id}`);
      door.setAngle(angle);
      return door.angle;
    },
  });
  await renderer.compileAsync(scene, camera);
  for (const control of Object.values(controls)) control.disabled = false;
  ready = api.ready = window.__bodycam.ready = true;
  document.documentElement.dataset.ready = 'true';
  raf = requestAnimationFrame(frame);
} catch (error) {
  api.error = error.message;
  document.documentElement.dataset.error = error.message;
  metrics.textContent = 'Laden fehlgeschlagen';
  errorPanel.textContent = error.message;
  console.error('[C6]', error);
}

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(raf); world?.dispose(); renderer.dispose();
}, { once: true });
