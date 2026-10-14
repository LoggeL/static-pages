import * as THREE from 'three';
import { createBodycamPost } from '../../js/postfx/bodycam.js';
import { createTunePanel } from './tune.js';

// Neutrale Testparameter; Änderungen sind über window.postfxDemo.settings möglich.
export const DEMO_DEFAULTS = {
  camera: { fov: 82, height: 1.4, z: 4, pitchDownDeg: 4, yawDeg: 0 },
  motion: { spin: false, speedDeg: 90, pitchAmplitudeDeg: 2, pitchFrequency: 0.65 },
  lights: {
    roomOn: true, flashlightOn: true, ambient: 0.12, room: 46,
    darkGain: 0.006, flashlight: 55, angleDeg: 24, penumbra: 0.75,
    spillAngleDeg: 40, spillGain: 0.04, policeRed: 28, policeBlue: 35, policeHz: 1.7,
  },
  effects: { holdMuzzle: false, muzzleIntensity: 340, flashDuration: 2 / 60, damageDuration: 0.4 },
  rawExposure: 1,
};

const query = new URLSearchParams(location.search);
const settings = structuredClone(DEMO_DEFAULTS);
const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.domElement.setAttribute('aria-label', 'Raum mit Messlinien, Schärfetafel und Viewmodel');
viewport.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x12161c);
const camera = new THREE.PerspectiveCamera(settings.camera.fov, 1, 0.025, 70);
camera.rotation.order = 'YXZ';
scene.add(camera);
const resources = new Set();
function track(resource) { resources.add(resource); return resource; }
const boxGeometry = track(new THREE.BoxGeometry(1, 1, 1));
const cylinderGeometry = track(new THREE.CylinderGeometry(1, 1, 1, 12));
const grey = track(new THREE.MeshStandardMaterial({ color: 0x777a7d, roughness: 0.94 }));
const floorMaterial = track(new THREE.MeshStandardMaterial({ color: 0x555b61, roughness: 0.85 }));
const crateMaterial = track(new THREE.MeshStandardMaterial({ color: 0x897b63, roughness: 0.9 }));
const trimMaterial = track(new THREE.MeshStandardMaterial({ color: 0xc1c3c0, roughness: 0.82 }));
const metalMaterial = track(new THREE.MeshStandardMaterial({ color: 0x50565b, metalness: 0.35, roughness: 0.65 }));
function box(name, size, position, material = grey, parent = scene, layer = 0) {
  const mesh = new THREE.Mesh(boxGeometry, material);
  mesh.name = name;
  mesh.scale.set(...size);
  mesh.position.set(...position);
  mesh.layers.set(layer);
  parent.add(mesh);
  return mesh;
}

box('Boden', [10, 0.15, 13], [0, -0.075, 0], floorMaterial);
box('Decke', [10, 0.15, 13], [0, 2.675, 0]);
box('Rueckwand', [10, 2.6, 0.15], [0, 1.3, -6.4]);
box('Vorderwand', [10, 2.6, 0.15], [0, 1.3, 6.4]);
box('Wand_links', [0.15, 2.6, 13], [-5, 1.3, 0]);
box('Wand_rechts', [0.15, 2.6, 13], [5, 1.3, 0]);
for (let x = -4.5; x <= 4.5; x += 0.75) box(`Messlinie_vertikal_${x}`, [0.018, 2.55, 0.012], [x, 1.3, -6.31], trimMaterial);
for (let y = 0.25; y <= 2.5; y += 0.45) box(`Messlinie_horizontal_${y}`, [9.8, 0.014, 0.012], [0, y, -6.30], trimMaterial);
for (const side of [-1, 1]) {
  for (const y of [0.22, 1.3, 2.4]) box('Messlinie_Seitenwand', [0.016, 0.012, 12.7], [side * 4.912, y, 0], trimMaterial);
}
const grid = new THREE.GridHelper(10, 20, 0x92989e, 0x72787e);
grid.position.y = 0.003;
grid.material.opacity = 0.28;
grid.material.transparent = true;
scene.add(grid);
track(grid.geometry);
track(grid.material);

for (const [x, z, size, height] of [[-2.5, -2.8, 1.1, 0.85], [2.2, -2.2, 1.25, 1.25], [-3.3, 0.9, 0.85, 0.7], [3.25, 1.4, 0.7, 1.55], [-1.1, -4.4, 0.65, 0.6]]) {
  box('Testkiste', [size, height, size], [x, height / 2, z], crateMaterial);
  box('Kistenkante', [size + 0.025, 0.045, size + 0.025], [x, height - 0.035, z], trimMaterial);
  box('Kistenstrebe', [0.04, height + 0.008, size + 0.028], [x, height / 2, z], metalMaterial);
}

function createSharpnessBoard() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d9d9d9';
  context.fillRect(0, 0, 1024, 512);
  context.fillStyle = '#171717';
  context.font = 'bold 56px monospace';
  context.fillText('SCHAERFE / KANTEN', 38, 78);
  for (const [size, y, text] of [[36, 143, 'BWC 0123456789 ABCDEFG'], [25, 190, 'Sphinx of black quartz 0123456789'], [18, 226, 'Feine Schrift, diagonale Kanten, Tonwerte.']]) {
    context.font = `${size}px monospace`;
    context.fillText(text, 38, y);
  }
  for (let group = 0; group < 5; ++group) {
    const width = 1 << group;
    const start = 38 + group * 184;
    for (let x = 0; x < 152; x += width * 2) context.fillRect(start + x, 258, width, 82);
    context.font = '19px monospace';
    context.fillText(`${width} px`, start, 366);
  }
  for (let i = 0; i < 11; ++i) {
    const value = Math.round(i * 25.5);
    context.fillStyle = `rgb(${value},${value},${value})`;
    context.fillRect(38 + i * 85, 397, 85, 63);
  }
  context.strokeStyle = '#222';
  context.lineWidth = 4;
  context.strokeRect(10, 10, 1004, 492);
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const material = track(new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(4.1, 2.05)), material);
  mesh.name = 'Schaerfetafel';
  mesh.position.set(0, 1.37, -6.27);
  scene.add(mesh);
}
createSharpnessBoard();

const ambient = new THREE.HemisphereLight(0xdbe5ef, 0x5c5243, settings.lights.ambient);
ambient.layers.enable(1);
scene.add(ambient);
const roomLights = [];
for (const x of [-2.8, 2.8]) {
  for (const z of [-3.8, 2.8]) {
    const light = new THREE.PointLight(0xffe3c4, settings.lights.room, 12, 2);
    light.position.set(x, 2.4, z);
    light.layers.enable(1);
    scene.add(light);
    roomLights.push(light);
    const bulbMaterial = track(new THREE.MeshStandardMaterial({ color: 0xffe3c4, emissive: 0xffe3c4, emissiveIntensity: 4 }));
    const bulb = box('Testleuchte', [0.45, 0.07, 0.16], [x, 2.52, z], bulbMaterial);
    light.userData.bulb = bulb;
  }
}
const policeRed = new THREE.PointLight(0xff182b, 0, 14, 2);
policeRed.position.set(-4.45, 1.4, -1.5);
const policeBlue = new THREE.PointLight(0x2065ff, 0, 14, 2);
policeBlue.position.set(4.45, 1.4, -1.5);
for (const light of [policeRed, policeBlue]) { light.layers.enable(1); scene.add(light); }
function torch(angle, intensity) {
  const light = new THREE.SpotLight(0xeaf0ff, intensity, 25, THREE.MathUtils.degToRad(angle), settings.lights.penumbra, 2);
  light.position.set(0.18, -0.21, -1.0);
  light.target.position.set(0.07, -0.1, -7);
  light.layers.enable(1);
  camera.add(light, light.target);
  return light;
}
const flashlight = torch(settings.lights.angleDeg, settings.lights.flashlight);
const spill = torch(settings.lights.spillAngleDeg, settings.lights.flashlight * settings.lights.spillGain);

const viewmodel = new THREE.Group();
viewmodel.name = 'FP_Testviewmodel';
viewmodel.layers.set(1);
camera.add(viewmodel);
box('Gehaeuse', [0.13, 0.13, 0.46], [0.17, -0.3, -0.49], metalMaterial, viewmodel, 1);
box('Handschutz', [0.105, 0.09, 0.27], [0.125, -0.242, -0.82], metalMaterial, viewmodel, 1);
box('Magazin', [0.067, 0.18, 0.105], [0.17, -0.437, -0.46], metalMaterial, viewmodel, 1);
box('Visier_links', [0.012, 0.058, 0.048], [0.114, -0.193, -0.54], trimMaterial, viewmodel, 1);
box('Visier_rechts', [0.012, 0.058, 0.048], [0.216, -0.193, -0.54], trimMaterial, viewmodel, 1);
box('Visier_oben', [0.114, 0.012, 0.048], [0.165, -0.158, -0.54], trimMaterial, viewmodel, 1);
const barrel = new THREE.Mesh(cylinderGeometry, metalMaterial);
barrel.name = 'Testlauf';
barrel.scale.set(0.024, 0.27, 0.024);
barrel.rotation.x = Math.PI / 2;
barrel.position.set(0.125, -0.225, -1.025);
barrel.layers.set(1);
viewmodel.add(barrel);
const flashMaterial = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(8), transparent: true, opacity: 0.95, depthWrite: false }));
const muzzle = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.12)), flashMaterial);
muzzle.name = 'Testmuendungsfeuer';
muzzle.scale.set(0.7, 0.7, 1.45);
muzzle.position.set(0.125, -0.225, -1.2);
muzzle.layers.set(1);
viewmodel.add(muzzle);
const muzzleLight = new THREE.PointLight(0xffb060, 0, 8, 2);
muzzleLight.position.copy(muzzle.position);
muzzleLight.layers.enable(1);
camera.add(muzzleLight);

const qualityNames = ['low', 'medium', 'high'];
let quality = qualityNames.includes(query.get('quality')) ? query.get('quality') : 'high';
let mode = query.get('mode') === 'raw' ? 'raw' : 'post';
let scenario = 'still';
let paused = query.get('paused') === '1';
let disposed = false;
let frameHandle = 0;
let frameNumber = 0;
let lastStamp = 0;
let flashUntil = -1;
let damageUntil = -1;
let cpuMs = 0;
let frameMs = 0;
let renderedFrames = 0;
let lastStatsStamp = -Infinity;
let width = 1;
let height = 1;
let havePreviousCamera = false;
const previousQuaternion = new THREE.Quaternion();
const previousPosition = new THREE.Vector3();
const deltaQuaternion = new THREE.Quaternion();
const cameraDelta = new THREE.Vector3();
const state = {
  time: 2, angularVelocity: new THREE.Vector3(), linearVelocity: new THREE.Vector3(),
  shake: 0, muzzleFlash: 0, damage: 0, exposureHint: 0, flashlightOn: true,
};
const post = createBodycamPost(renderer, scene, camera, { quality, params: {}, width: innerWidth, height: innerHeight });
const tune = createTunePanel(post.params, { onChange: () => { if (paused) draw(0); } });
$('tune').append(tune.element);

function updateScene(dt) {
  const t = state.time;
  const spinSpeed = settings.motion.spin ? THREE.MathUtils.degToRad(settings.motion.speedDeg) : 0;
  const pitchMotion = settings.motion.spin ? Math.sin((t - 2) * settings.motion.pitchFrequency) * THREE.MathUtils.degToRad(settings.motion.pitchAmplitudeDeg) : 0;
  camera.position.set(0, settings.camera.height, settings.camera.z);
  camera.rotation.set(-THREE.MathUtils.degToRad(settings.camera.pitchDownDeg) + pitchMotion, THREE.MathUtils.degToRad(settings.camera.yawDeg) + (t - 2) * spinSpeed, 0, 'YXZ');
  if (camera.fov !== settings.camera.fov) {
    camera.fov = settings.camera.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  if (havePreviousCamera && dt > 0) {
    deltaQuaternion.copy(previousQuaternion).invert().multiply(camera.quaternion);
    if (deltaQuaternion.w < 0) deltaQuaternion.set(-deltaQuaternion.x, -deltaQuaternion.y, -deltaQuaternion.z, -deltaQuaternion.w);
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(deltaQuaternion.w, -1, 1));
    const sinHalf = Math.sqrt(Math.max(0, 1 - deltaQuaternion.w * deltaQuaternion.w));
    if (sinHalf > 1e-7) state.angularVelocity.set(deltaQuaternion.x, deltaQuaternion.y, deltaQuaternion.z).multiplyScalar(angle / (sinHalf * dt));
    else state.angularVelocity.set(0, 0, 0);
    state.linearVelocity.copy(camera.position).sub(previousPosition).divideScalar(dt);
    cameraDelta.copy(state.linearVelocity).applyQuaternion(previousQuaternion.copy(camera.quaternion).invert());
    state.linearVelocity.copy(cameraDelta);
  } else {
    state.angularVelocity.set(0, spinSpeed, 0);
    state.linearVelocity.set(0, 0, 0);
  }
  previousQuaternion.copy(camera.quaternion);
  previousPosition.copy(camera.position);
  havePreviousCamera = true;
  state.muzzleFlash = settings.effects.holdMuzzle || t < flashUntil ? 1 : 0;
  state.damage = t < damageUntil ? Math.min(1, (damageUntil - t) / Math.max(settings.effects.damageDuration, 0.001)) : 0;
  state.shake = state.damage * 0.25;
  state.flashlightOn = settings.lights.flashlightOn;
  const roomGain = settings.lights.roomOn ? 1 : settings.lights.darkGain;
  ambient.intensity = settings.lights.ambient * roomGain;
  for (const light of roomLights) {
    light.intensity = settings.lights.room * roomGain;
    light.userData.bulb.material.emissiveIntensity = settings.lights.roomOn ? 4 : 0;
  }
  const pulse = Math.sin(t * Math.PI * 2 * settings.lights.policeHz);
  policeRed.intensity = settings.lights.policeRed * Math.max(0, pulse) ** 6;
  policeBlue.intensity = settings.lights.policeBlue * Math.max(0, -pulse) ** 6;
  flashlight.intensity = settings.lights.flashlightOn ? settings.lights.flashlight : 0;
  flashlight.angle = THREE.MathUtils.degToRad(settings.lights.angleDeg);
  flashlight.penumbra = settings.lights.penumbra;
  spill.intensity = flashlight.intensity * settings.lights.spillGain;
  spill.angle = THREE.MathUtils.degToRad(settings.lights.spillAngleDeg);
  spill.penumbra = settings.lights.penumbra;
  muzzle.visible = state.muzzleFlash > 0;
  muzzleLight.intensity = settings.effects.muzzleIntensity * state.muzzleFlash;
}

function renderRaw() {
  const mask = camera.layers.mask;
  const background = scene.background;
  const toneMapping = renderer.toneMapping;
  const exposure = renderer.toneMappingExposure;
  const outputColorSpace = renderer.outputColorSpace;
  const autoClear = renderer.autoClear;
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissorTest(false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.rawExposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  renderer.clear(true, true, true);
  camera.layers.set(0);
  renderer.render(scene, camera);
  renderer.clearDepth();
  scene.background = null;
  camera.layers.set(1);
  renderer.render(scene, camera);
  scene.background = background;
  camera.layers.mask = mask;
  renderer.toneMapping = toneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.outputColorSpace = outputColorSpace;
  renderer.autoClear = autoClear;
}

function draw(dt) {
  if (disposed) return;
  updateScene(dt);
  const start = performance.now();
  if (mode === 'raw') renderRaw();
  else post.render(dt, state);
  const elapsed = performance.now() - start;
  cpuMs = renderedFrames ? cpuMs * 0.9 + elapsed * 0.1 : elapsed;
  ++renderedFrames;
  ++frameNumber;
  updateStats(paused);
}

function updateStats(force = false) {
  const stamp = performance.now();
  if (!force && stamp - lastStatsStamp < 400) return;
  lastStatsStamp = stamp;
  const values = [`${width} × ${height} px · ${quality} · ${mode === 'post' ? 'PostFX' : 'ACES'} · t ${state.time.toFixed(3)} s · Frame ${frameNumber}`,
    `CPU-Aufruf ${cpuMs.toFixed(2)} ms · Bildabstand ${frameMs.toFixed(2)} ms · ${paused ? 'pausiert' : 'läuft'}`];
  const diagnostics = post.diagnostics;
  if (diagnostics && typeof diagnostics === 'object') {
    const parts = [];
    function collect(object, path = '', depth = 0) {
      if (depth > 2) return;
      for (const key of Object.keys(object)) {
        const value = object[key];
        const name = path ? `${path}.${key}` : key;
        if (typeof value === 'number') parts.push(`${name} ${Number.isInteger(value) ? value : value.toFixed(3)}`);
        else if (typeof value === 'boolean' || typeof value === 'string') parts.push(`${name} ${value}`);
        else if (value && typeof value === 'object' && !Array.isArray(value)) collect(value, name, depth + 1);
      }
    }
    collect(diagnostics);
    values.push(parts.join(' · '));
  }
  $('stats').textContent = values.join('\n');
  tune.refresh();
}

function syncControls() {
  $('mode').value = mode;
  $('quality').value = quality;
  $('scenario').value = scenario;
  $('room-light').checked = settings.lights.roomOn;
  $('flashlight').checked = settings.lights.flashlightOn;
  $('spin').checked = settings.motion.spin;
  $('pause').textContent = paused ? 'Weiter (P)' : 'Pause (P)';
}

function resetHistory() {
  havePreviousCamera = false;
  post.resetHistory?.();
}

function step(dt = 1 / 60) {
  if (!Number.isFinite(dt) || dt < 0) throw new TypeError('step(dt) erwartet eine endliche Zeit >= 0.');
  state.time += dt;
  draw(dt);
  return state.time;
}

function frame(stamp) {
  if (disposed || paused) return;
  const interval = lastStamp ? (stamp - lastStamp) / 1000 : 1 / 60;
  lastStamp = stamp;
  frameMs = frameMs ? frameMs * 0.9 + interval * 1000 * 0.1 : interval * 1000;
  step(Math.min(interval, 0.1));
  frameHandle = requestAnimationFrame(frame);
}

function pause() {
  paused = true;
  cancelAnimationFrame(frameHandle);
  lastStamp = 0;
  syncControls();
  updateStats(true);
}

function resume() {
  if (disposed) return;
  if (!paused && frameHandle) return;
  paused = false;
  lastStamp = 0;
  syncControls();
  frameHandle = requestAnimationFrame(frame);
}

function setTime(time, { render = true, reset = true } = {}) {
  if (!Number.isFinite(time) || time < 0) throw new TypeError('setTime(t) erwartet eine endliche Zeit >= 0.');
  state.time = time;
  flashUntil = -1;
  damageUntil = -1;
  if (reset) resetHistory();
  if (render) draw(0);
  return state.time;
}

function setScenario(name, { render = true, time = 2 } = {}) {
  if (!['still', 'spin', 'dark', 'muzzle'].includes(name)) throw new TypeError(`Unbekanntes Szenario: ${name}`);
  scenario = name;
  settings.motion.spin = name === 'spin';
  settings.lights.roomOn = name !== 'dark';
  settings.lights.flashlightOn = true;
  settings.effects.holdMuzzle = name === 'muzzle';
  settings.camera.yawDeg = 0;
  settings.camera.pitchDownDeg = DEMO_DEFAULTS.camera.pitchDownDeg;
  post.overlay?.reset?.();
  setTime(time, { render: false });
  syncControls();
  if (render) draw(0);
  return name;
}

function setMode(name) {
  if (!['raw', 'post'].includes(name)) throw new TypeError('setMode: raw oder post erwartet.');
  mode = name;
  resetHistory();
  syncControls();
  if (paused) draw(0);
  return mode;
}

function setQuality(value) {
  if (!qualityNames.includes(value)) throw new TypeError('Qualität muss low, medium oder high sein.');
  quality = value;
  post.setQuality(value);
  resetHistory();
  syncControls();
  tune.refresh();
  if (paused) draw(0);
  return quality;
}

function setSize(w = viewport.clientWidth, h = viewport.clientHeight) {
  width = Math.max(1, Math.round(w));
  height = Math.max(1, Math.round(h));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  post.setSize(width, height);
  resetHistory();
  if (paused) draw(0);
  return { width, height };
}

function fire() {
  settings.effects.holdMuzzle = false;
  flashUntil = state.time + settings.effects.flashDuration;
  if (paused) draw(0);
}

function damage() {
  damageUntil = state.time + settings.effects.damageDuration;
  if (paused) draw(0);
}

function connection(connected) {
  if (connected) post.overlay?.connected?.();
  else post.overlay?.disconnected?.();
  if (paused) draw(0);
}

function showTune(show = $('tune').hidden) {
  $('tune').hidden = !show;
  $('tune-toggle').setAttribute('aria-expanded', String(show));
  return show;
}

function inputSetting(callback) {
  callback();
  syncControls();
  if (paused) draw(0);
}

$('mode').addEventListener('change', (event) => setMode(event.target.value));
$('quality').addEventListener('change', (event) => setQuality(event.target.value));
$('scenario').addEventListener('change', (event) => setScenario(event.target.value));
$('room-light').addEventListener('change', (event) => inputSetting(() => { settings.lights.roomOn = event.target.checked; }));
$('flashlight').addEventListener('change', (event) => inputSetting(() => { settings.lights.flashlightOn = event.target.checked; }));
$('spin').addEventListener('change', (event) => inputSetting(() => { settings.motion.spin = event.target.checked; resetHistory(); }));
$('fire').addEventListener('click', fire);
$('damage').addEventListener('click', damage);
$('connect').addEventListener('click', () => connection(true));
$('disconnect').addEventListener('click', () => connection(false));
$('pause').addEventListener('click', () => paused ? resume() : pause());
$('tune-toggle').addEventListener('click', () => showTune());
function onKey(event) {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  switch (event.code) {
    case 'KeyF': inputSetting(() => { settings.lights.flashlightOn = !settings.lights.flashlightOn; }); break;
    case 'KeyM': fire(); break;
    case 'KeyX': damage(); break;
    case 'KeyB': setMode(mode === 'post' ? 'raw' : 'post'); break;
    case 'KeyP': paused ? resume() : pause(); break;
    case 'KeyT': showTune(); break;
    case 'Digit1': setQuality('low'); break;
    case 'Digit2': setQuality('medium'); break;
    case 'Digit3': setQuality('high'); break;
    default: return;
  }
  event.preventDefault();
}
window.addEventListener('keydown', onKey);
let drag = false;
let pointerX = 0;
let pointerY = 0;
renderer.domElement.addEventListener('pointerdown', (event) => {
  drag = true;
  pointerX = event.clientX;
  pointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!drag) return;
  settings.camera.yawDeg -= (event.clientX - pointerX) * 0.13;
  settings.camera.pitchDownDeg = THREE.MathUtils.clamp(settings.camera.pitchDownDeg + (event.clientY - pointerY) * 0.13, -75, 75);
  pointerX = event.clientX;
  pointerY = event.clientY;
  if (paused) draw(0);
});
renderer.domElement.addEventListener('pointerup', () => { drag = false; });
renderer.domElement.addEventListener('pointercancel', () => { drag = false; });
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  pause();
  $('error').hidden = false;
  $('error').textContent = 'WebGL-Kontext verloren. Die Testseite muss neu geladen werden.';
});
function onResize() { setSize(); }
window.addEventListener('resize', onResize);

function dispose() {
  pause();
  disposed = true;
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  post.dispose?.();
  tune.dispose();
  for (const resource of resources) resource.dispose();
  renderer.dispose();
  renderer.domElement.remove();
}

window.postfxDemo = {
  post, renderer, scene, camera, state, settings, tune, viewmodel,
  pause, resume, step, setTime, setScenario, setMode, setQuality, setSize, resetHistory,
  fire, damage, connection, showTune, dispose,
  render: () => draw(0),
  get mode() { return mode; },
  get quality() { return quality; },
  get scenario() { return scenario; },
  get paused() { return paused; },
  get frameNumber() { return frameNumber; },
  get stats() { return { cpuMs, frameMs, frameNumber, width, height, diagnostics: post.diagnostics }; },
};

document.body.classList.toggle('clean', query.get('clean') === '1');
showTune(query.get('tune') === '1');
setSize();
const requestedScenario = query.get('scenario') || (query.get('spin') === '1' ? 'spin' : 'still');
setScenario(requestedScenario, { render: false, time: Number.isFinite(Number(query.get('time'))) && query.has('time') ? Math.max(0, Number(query.get('time'))) : 2 });
if (query.has('debug') && post.params.debug) post.params.debug.mode = Number(query.get('debug')) || 0;
window.postfxDemo.ready = Promise.resolve(post.overlay?.ready).then(() => {
  draw(0);
  $('status').textContent = 'Bereit. Messszene und Viewmodel verwenden getrennte Ebenen.';
  if (!paused) resume();
  return window.postfxDemo;
});
