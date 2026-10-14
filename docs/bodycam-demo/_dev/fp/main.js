import * as THREE from 'three';
import { createWeapon, createWeaponBus } from '../../js/weapon/index.js';
import { createFPArms } from '../../js/fp/arms.js';

// Neutral inspection values; production lighting and weapon poses are untouched.
export const TEST_CONFIG = { near: 0.005, far: 40, fov: 82, maxPixelRatio: 1,
  cameraHeight: 1.4, pitchDeg: -4, light: 2.1, markerRadius: 0.004,
  freeTarget: [-0.15, -0.10, -0.39], maxFrameSeconds: 0.1 };
const baseUrl = new URL('../../', import.meta.url);
const canvas = document.querySelector('#view');
const metrics = document.querySelector('#metrics');
const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, TEST_CONFIG.maxPixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x293440);
const camera = new THREE.PerspectiveCamera(TEST_CONFIG.fov, innerWidth / innerHeight, TEST_CONFIG.near, TEST_CONFIG.far);
camera.position.set(0, TEST_CONFIG.cameraHeight, 0);
scene.add(camera);
const hemisphere = new THREE.HemisphereLight(0xd9e6f4, 0x665d56, TEST_CONFIG.light);
hemisphere.layers.enable(1);
scene.add(hemisphere);
const key = new THREE.DirectionalLight(0xffefe1, 3.2);
key.position.set(-0.6, 1.1, 1);
key.target.position.set(0, -0.15, -0.4);
key.layers.set(1);
camera.add(key, key.target);
const worldRoot = new THREE.Group();
worldRoot.name = 'NeutralFPInspectionWorld';
scene.add(worldRoot);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16),
  new THREE.MeshStandardMaterial({ color: 0x555c62, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.name = 'FPTestFloor';
floor.userData.surface = 'concrete';
worldRoot.add(floor);
const grid = new THREE.GridHelper(16, 32, 0xa4b2bd, 0x657483);
grid.position.y = 0.002;
worldRoot.add(grid);
for (const [x, z, width, height, depth, color] of [
  [0, -5, 12, 4, 0.12, 0x708397], [-4.2, -2, 0.12, 4, 6, 0x596d80],
  [1.9, -2.7, 0.45, 2.5, 0.5, 0x455d72], [-1.4, -3.1, 0.7, 0.7, 0.7, 0x7d6859],
]) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  box.position.set(x, height / 2, z);
  worldRoot.add(box);
}
const world = { shootables: [floor], roomAt: () => null, colliders: { static: floor, doors: [] } };
const bus = createWeaponBus();
const events = [];
const counts = {};
bus.on('*', event => {
  if (event.type === 'cameraRecoil') return;
  counts[event.type] = (counts[event.type] ?? 0) + 1;
  events.push({ type: event.type, state: event.state, previous: event.previous,
    kind: event.kind, time: event.time, on: event.on });
  if (events.length > 250) events.shift();
});

// Separate depth storage avoids clipping against the inspection world.
const viewmodelTarget = new THREE.WebGLRenderTarget(canvas.width, canvas.height, { depthBuffer: true });
viewmodelTarget.texture.name = 'FPInspectionViewmodelColor';
const compositeScene = new THREE.Scene();
const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const compositeMaterial = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { viewmodel: { value: viewmodelTarget.texture } },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader: `uniform sampler2D viewmodel; varying vec2 vUv;
    void main(){gl_FragColor=texture2D(viewmodel,vUv);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
compositeScene.add(compositeQuad);
const freeTarget = new THREE.Object3D();
freeTarget.name = 'FP_Test_FreeTarget';
freeTarget.position.fromArray(TEST_CONFIG.freeTarget);
camera.add(freeTarget);
const markers = new THREE.Group();
markers.name = 'FPTestIKMarkers';
markers.layers.set(1);
scene.add(markers);
const markerGeometry = new THREE.SphereGeometry(TEST_CONFIG.markerRadius, 12, 8);
const markerItems = {};
for (const [side, color] of [['L', 0x65ffff], ['R', 0xffbd55]]) {
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
  const hand = new THREE.Mesh(markerGeometry, material);
  hand.layers.set(1);
  hand.name = `FPTestHand_${side}`;
  const target = new THREE.Mesh(markerGeometry, material.clone());
  target.layers.set(1);
  target.scale.setScalar(1.65);
  target.material.transparent = true;
  target.material.opacity = 0.4;
  target.name = `FPTestTarget_${side}`;
  const axes = new THREE.AxesHelper(0.038);
  axes.traverse(node => { node.layers.set(1); node.material.depthTest = false; });
  axes.name = `FPTestTargetAxes_${side}`;
  markers.add(hand, target, axes);
  markerItems[side] = { hand, target, axes };
}

let weapon, arms, ready = false, paused = params.get('pause') === '1', disposed = false;
let moving = false, sprinting = false, yaw = 0, pitch = TEST_CONFIG.pitchDeg;
let last = performance.now(), raf, frames = 0, lastHud = -Infinity;
const frameSamples = [];
const updateSamples = [];
const explicitTargets = { L: undefined, R: undefined };
function handBone(side) {
  return arms?.model?.getObjectByName(side === 'L' ? 'LeftHand' : 'RightHand')
    ?? arms?.root?.getObjectByName(side === 'L' ? 'LeftHand' : 'RightHand');
}
function updateMarkers() {
  if (!markers.visible || !arms || !weapon) return;
  const state = arms.state();
  for (const side of ['L', 'R']) {
    const m = markerItems[side], bone = handBone(side);
    const name = state.hands?.[side]?.target;
    const object = explicitTargets[side] === undefined
      ? (name ? weapon.nodes[name] ?? scene.getObjectByName(name) : null)
      : explicitTargets[side];
    m.hand.visible = !!bone;
    if (bone) m.hand.position.copy(bone.getWorldPosition(new THREE.Vector3()));
    m.target.visible = m.axes.visible = !!object;
    if (object) {
      m.target.position.copy(object.getWorldPosition(new THREE.Vector3()));
      m.axes.position.copy(m.target.position);
      m.axes.quaternion.copy(object.getWorldQuaternion(new THREE.Quaternion()));
    }
  }
}
function render() {
  if (disposed) return;
  updateMarkers();
  renderer.info.reset();
  renderer.setRenderTarget(null);
  camera.layers.set(0);
  renderer.setClearColor(0x293440, 1);
  renderer.clear();
  renderer.render(scene, camera);
  const background = scene.background;
  scene.background = null;
  camera.layers.set(1);
  renderer.setRenderTarget(viewmodelTarget);
  renderer.setClearColor(0, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.background = background;
  renderer.render(compositeScene, compositeCamera);
  camera.layers.set(0);
  frames++;
  if (performance.now() - lastHud > 150) updateHud();
}
function advance(dt) {
  const start = performance.now();
  weapon.update(dt, { sprinting });
  arms.update(dt, { moving, sprinting });
  updateSamples.push(performance.now() - start);
  if (updateSamples.length > 240) updateSamples.shift();
}
function step(seconds = 1 / 60) {
  if (!ready) return stats();
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new RangeError('step: 0..60 seconds');
  let remaining = seconds;
  while (remaining > 1e-10) { const dt = Math.min(remaining, 1 / 120); advance(dt); remaining -= dt; }
  if (!seconds) { weapon.update(0, { sprinting }); arms.update(0, { moving, sprinting }); }
  render();
  updateHud();
  return stats();
}
function freeze(on = true) {
  paused = !!on;
  last = performance.now();
  document.querySelector('#pause').textContent = paused ? 'Weiter' : 'Pause';
  return paused;
}
function look(yawDeg = yaw, pitchDeg = pitch, { cut = true } = {}) {
  yaw = yawDeg; pitch = pitchDeg;
  camera.quaternion.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ'));
  camera.updateMatrixWorld(true);
  if (ready && cut) step(0);
}
function turn(degrees = 95, seconds = 0.12) {
  if (!ready) return stats();
  const count = Math.max(1, Math.ceil(seconds * 120));
  for (let i = 0; i < count; i++) {
    look(yaw + degrees / count, pitch, { cut: false });
    advance(seconds / count);
  }
  render();
  return stats();
}
function setTarget(side, target = 'grip', blend = 1) {
  const object = target === 'grip' ? undefined : target === 'release' ? null : target === 'free' ? freeTarget
    : target === 'magwell' ? weapon.nodes.W_MagWell : target === 'magazine' ? weapon.nodes.W_Mag
      : typeof target === 'string' ? weapon.nodes[target] ?? scene.getObjectByName(target) : target;
  explicitTargets[side] = object;
  if (object === undefined) arms.resetHandTarget(side);
  else arms.setHandTarget(side, object, blend);
  step(0);
  return arms.state();
}
function setArmsVisible(on = true) {
  if (arms?.root) arms.root.visible = !!on;
  else if (arms?.model) arms.model.visible = !!on;
  document.querySelector('#arms').checked = !!on;
  render();
}
function setMarkers(on = true) {
  markers.visible = !!on;
  document.querySelector('#markers').checked = !!on;
  render();
}
async function createInstances() {
  ready = false;
  arms?.dispose(); weapon?.dispose();
  explicitTargets.L = explicitTargets.R = undefined;
  // Real weapon implementation and normal effects, including real GLB assets.
  weapon = await createWeapon({ scene, camera, renderer, world, bus, baseUrl });
  arms = await createFPArms({ weapon, camera, renderer, baseUrl });
  ready = true;
  step(0);
  return stats();
}
function setPose(name) {
  sprinting = name === 'sprint';
  weapon.sprint(sprinting);
  weapon.ads(name === 'ads');
  if (name === 'reload') weapon.reload();
  if (name === 'empty') {
    weapon.fire(weapon.state().ammo);
    step(3.2);
    weapon.reload();
  }
  if (name === 'inspect') weapon.inspect();
  document.querySelector('#pose').value = name;
  render();
  return weapon.state();
}
function stats() {
  const gl = renderer.getContext();
  const gpu = gl.getExtension('WEBGL_debug_renderer_info');
  const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { ready, paused, disposed, frames, gpu: gpu ? gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL) : 'unknown',
    fps: average(frameSamples) ? 1000 / average(frameSamples) : 0, updateMilliseconds: average(updateSamples),
    viewport: [canvas.width, canvas.height], drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures, weapon: weapon?.state(), arms: arms?.state(),
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), yaw, pitch },
    moving, sprinting, events: counts, renderTarget: [viewmodelTarget.width, viewmodelTarget.height] };
}
function updateHud() {
  lastHud = performance.now();
  if (!ready) return;
  const state = stats();
  const animation = state.arms?.animation;
  const hand = side => {
    const h = state.arms?.hands?.[side];
    const d = typeof h?.distanceMeters === 'number' ? `${(h.distanceMeters * 1000).toFixed(3)} mm` : 'frei';
    return `${side}: ${h?.target ?? 'IK gelöst'} · Abstand ${d}`;
  };
  metrics.textContent = `${paused ? 'Pause' : 'Laufend'} · ${state.weapon.state} · ADS ${Math.round(state.weapon.adsProgress * 100)} %\n`
    + `${hand('L')}\n${hand('R')}\n`
    + `${state.weapon.magazine}+${state.weapon.chamber} Patronen · ${state.weapon.spareMagazines} Ersatzmagazine\n`
    + `${state.fps.toFixed(1)} FPS · ${state.updateMilliseconds.toFixed(3)} ms Update · ${state.drawCalls} Draw Calls\n`
    + `${state.triangles.toLocaleString('de-DE')} Dreiecke · ${state.gpu}\n`
    + `Clips ${animation?.availableClips?.length ?? 0} · Basis ${animation?.base ?? 'IK-Haltung'}\n`
    + `Anim-Events ${animation?.emittedEvents ?? 0} · Manifest ${animation?.manifestLoaded ? 'geladen' : 'ausstehend'}`;
}
function dispose() {
  if (disposed) return;
  disposed = true;
  ready = false;
  cancelAnimationFrame(raf);
  arms?.dispose(); weapon?.dispose(); bus.clear();
  viewmodelTarget.dispose(); compositeQuad.geometry.dispose(); compositeMaterial.dispose();
  markerGeometry.dispose();
  markers.traverse(node => {
    if (node.geometry && node.geometry !== markerGeometry) node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) material.dispose();
  });
  worldRoot.traverse(node => {
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) material.dispose();
  });
  renderer.dispose();
}
function frame(now) {
  if (disposed) return;
  const ms = now - last;
  last = now;
  if (!paused && ready) {
    advance(Math.max(0, Math.min(ms / 1000, TEST_CONFIG.maxFrameSeconds)));
    if (ms > 0) { frameSamples.push(ms); if (frameSamples.length > 180) frameSamples.shift(); }
  }
  render();
  raf = requestAnimationFrame(frame);
}

window.fpTest = { get ready() { return ready; }, get weapon() { return weapon; }, get arms() { return arms; },
  scene, camera, renderer, world, bus, freeTarget, viewmodelTarget, stats, step, freeze, look, turn,
  setTarget, setPose, setArmsVisible, setMarkers, render, createInstances, dispose, events,
  setMoving(on) { moving = !!on; document.querySelector('#moving').checked = moving; },
  clearEvents() { events.length = 0; for (const key of Object.keys(counts)) delete counts[key]; },
  async benchmark({ frames: count = 240, armsVisible = true } = {}) {
    freeze(true); setMarkers(false); setArmsVisible(armsVisible);
    const tick = () => { weapon.update(1 / 60, { sprinting }); if (armsVisible) arms.update(1 / 60, { moving, sprinting }); render(); };
    for (let i = 0; i < 30; i++) tick();
    renderer.getContext().finish();
    const started = performance.now();
    for (let i = 0; i < count; i++) tick();
    renderer.getContext().finish();
    const milliseconds = performance.now() - started;
    return { frames: count, milliseconds, perFrame: milliseconds / count,
      fps: count * 1000 / milliseconds, armsVisible, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  },
};
look(0, TEST_CONFIG.pitchDeg);
try {
  await createInstances();
  if (params.get('markers') === '0') setMarkers(false);
  freeze(paused);
  document.documentElement.dataset.ready = 'true';
  last = performance.now();
  raf = requestAnimationFrame(frame);
} catch (error) {
  console.error('[C18]', error);
  metrics.classList.add('error');
  metrics.textContent = `Laden fehlgeschlagen: ${error.message}`;
  document.documentElement.dataset.error = error.message;
}
document.querySelector('#pose').onchange = event => ready && setPose(event.target.value);
document.querySelector('#target').onchange = event => ready && setTarget('L', event.target.value);
for (const side of ['L', 'R']) document.querySelector(`#finger${side}`).onchange = event => {
  if (ready) arms.setFingerPose(side, event.target.value, 0.18);
};
document.querySelector('#fire').onclick = () => ready && weapon.fire(1);
document.querySelector('#markers').onchange = event => setMarkers(event.target.checked);
document.querySelector('#arms').onchange = event => setArmsVisible(event.target.checked);
document.querySelector('#moving').onchange = event => window.fpTest.setMoving(event.target.checked);
document.querySelector('#turn').onclick = () => turn(95, 0.12);
document.querySelector('#down').onclick = () => look(yaw, -65);
document.querySelector('#forward').onclick = () => look(0, TEST_CONFIG.pitchDeg);
document.querySelector('#pause').onclick = () => freeze(!paused);
document.querySelector('#step').onclick = () => step(1 / 60);
document.querySelector('#reload-reset').onclick = () => createInstances().catch(error => console.error('[C18]', error));
let drag;
canvas.addEventListener('pointerdown', event => { drag = [event.clientX, event.clientY, yaw, pitch]; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => {
  if (drag) {
    look(drag[2] - (event.clientX - drag[0]) * 0.14,
      THREE.MathUtils.clamp(drag[3] - (event.clientY - drag[1]) * 0.14, -85, 85), { cut: false });
    if (paused && ready) step(1 / 120);
  }
});
canvas.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); viewmodelTarget.setSize(canvas.width, canvas.height);
  if (ready) step(0);
});
window.addEventListener('pagehide', dispose, { once: true });
