import * as THREE from 'three';
import { createAssetLoaders } from '../../js/core/loaders.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MOVING, REQUIRED, inspectWeapon, isWithin } from './checks.js';

// All tuning is confined to the inspection page, never applied to the GLB.
export const VIEWER = { exposure: 1.25, background: 0x171b20, axisLength: 0.055, allAxisLength: 0.025, fov: 32, shadowBias: -0.0001, shadowNormalBias: 0.0015 };
const viewport = document.querySelector('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = VIEWER.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(VIEWER.background);
const camera = new THREE.PerspectiveCamera(VIEWER.fov, 1, 0.005, 30);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.04;
controls.maxDistance = 4;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room).texture;
room.dispose();
pmrem.dispose();
scene.environment = environment;
scene.environmentIntensity = 1;
const studio = new THREE.Group();
const hemi = new THREE.HemisphereLight(0xe7f0ff, 0x756759, 1.3);
studio.add(hemi);
for (const [color, intensity, position] of [[0xffeddc, 3, [0.7, 1, -0.1]], [0xdce8ff, 2, [-0.8, 0.4, 0.4]]]) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(...position);
  studio.add(light);
}
scene.add(studio);
const spot = new THREE.SpotLight(0xfff2df, 24, 3, THREE.MathUtils.degToRad(24), 0.75, 2);
spot.position.set(0.65, 0.8, 0.4);
spot.target.position.set(0, 0, -0.12);
spot.castShadow = true;
spot.shadow.mapSize.set(2048, 2048);
spot.shadow.bias = VIEWER.shadowBias;
spot.shadow.normalBias = VIEWER.shadowNormalBias;
spot.visible = false;
scene.add(spot, spot.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x2e353d, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const originAxes = new THREE.AxesHelper(0.1);
scene.add(originAxes);
const axes = new THREE.Group();
scene.add(axes);
const selectedAxes = new THREE.AxesHelper(VIEWER.axisLength);
selectedAxes.material.depthTest = false;
selectedAxes.renderOrder = 5;
axes.add(selectedAxes);
const selectedBox = new THREE.Box3Helper(new THREE.Box3(), 0xe5c680);
selectedBox.visible = false;
scene.add(selectedBox);
let model, root, selected, results, lighting = 'studio', activeView = 'overview';
const baselines = new Map();
const gizmos = new Map();
const lookup = name => model?.getObjectByName(name);
const render = () => { controls.update(); renderer.render(scene, camera); };

function setLighting(mode) {
  if (!['studio', 'spot'].includes(mode)) throw new Error(`Unbekanntes Licht: ${mode}`);
  lighting = mode;
  studio.visible = mode === 'studio';
  spot.visible = mode === 'spot';
  scene.environment = mode === 'studio' ? environment : null;
  updateCaption();
  render();
}
function updateCaption() {
  const labels = { overview: 'Gesamtansicht', left: 'Links', right: 'Rechts', top: 'Oben', receiver: 'Gehäuse', muzzle: 'Mündung', magazine: 'Magazin', sight: 'Visier' };
  document.querySelector('#mode').textContent = `${lighting === 'studio' ? 'Studiolicht' : 'Spotlicht'} · ${labels[activeView]} · Maße in Metern`;
}
function setView(name) {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(root, true);
  const center = box.getCenter(new THREE.Vector3());
  const views = {
    overview: { target: center, offset: [0.97, 0.35, 0.72] },
    left: { target: center, offset: [-1.22, 0.10, 0.02] },
    right: { target: center, offset: [1.22, 0.10, 0.02] },
    top: { target: center, offset: [0.005, 1.3, 0.0] },
    receiver: { target: new THREE.Vector3(0, 0.035, -0.1), offset: [0.43, 0.13, 0.11] },
    muzzle: { target: lookup('W_Muzzle')?.getWorldPosition(new THREE.Vector3()) || center, offset: [0.15, 0.07, -0.25] },
    magazine: { target: lookup('W_Mag') ? new THREE.Box3().setFromObject(lookup('W_Mag'), true).getCenter(new THREE.Vector3()) : center, offset: [0.35, 0.07, 0.25] },
    sight: { target: lookup('W_SightEye')?.getWorldPosition(new THREE.Vector3()) || center, offset: [0.14, 0.1, 0.27] },
  };
  const view = views[name];
  if (!view) throw new Error(`Unbekannte Ansicht: ${name}`);
  controls.target.copy(view.target);
  camera.position.copy(view.target).add(new THREE.Vector3(...view.offset));
  camera.up.set(0, 1, 0);
  activeView = name;
  updateCaption();
  controls.update();
  render();
}
function refreshHelpers() {
  if (!model) return;
  model.updateMatrixWorld(true);
  // Keep the inspection floor below extracted parts as well as the rest pose.
  floor.position.y = new THREE.Box3().setFromObject(model, true).min.y - 0.025;
  for (const [name, gizmo] of gizmos) gizmo.matrix.copy(lookup(name).matrixWorld);
  if (selected) {
    selectedAxes.matrixAutoUpdate = false;
    selectedAxes.matrix.copy(selected.matrixWorld);
    selectedAxes.visible = document.querySelector('#axes').checked;
    const p = selected.getWorldPosition(new THREE.Vector3());
    const y = new THREE.Vector3(0, 1, 0).transformDirection(selected.matrixWorld);
    document.querySelector('#selected').textContent = `${selected.name}\nWelt: ${p.toArray().map(v => v.toFixed(4)).join(', ')}\n+Y: ${y.toArray().map(v => v.toFixed(3)).join(', ')}`;
    selectedBox.box.setFromObject(selected, true);
    selectedBox.visible = !selectedBox.box.isEmpty() && document.querySelector('#axes').checked;
  }
}
function select(name) {
  const node = lookup(name);
  if (!node) throw new Error(`Knoten fehlt: ${name}`);
  selected = node;
  document.querySelectorAll('#nodes button').forEach(button => { button.dataset.selected = String(button.dataset.node === name); });
  if (MOVING.includes(name)) document.querySelector('#part').value = name;
  isolate(document.querySelector('#isolate').checked);
  refreshHelpers();
  render();
  return { name, worldPosition: node.getWorldPosition(new THREE.Vector3()).toArray() };
}
function isolate(enabled) {
  if (!model) return;
  model.traverse(node => {
    if (node.isMesh) node.visible = !enabled || (selected && isWithin(node, selected));
  });
  render();
}

// Translations use world axes; local pivots follow the exported glTF basis.
function pose(name, amount) {
  const node = lookup(name), base = baselines.get(name);
  if (!node || !base) throw new Error(`Kein bewegliches Bauteil: ${name}`);
  amount = THREE.MathUtils.clamp(Number(amount), 0, 1);
  if (!Number.isFinite(amount)) throw new Error('Pose muss eine endliche Zahl sein');
  node.position.copy(base.position);
  node.quaternion.copy(base.quaternion);
  const travel = { W_Mag: [0, -0.22, 0.02], W_Bolt: [0, 0, 0.045], W_ChargingHandle: [0, 0, 0.065] }[name];
  if (travel) {
    node.parent.updateWorldMatrix(true, false);
    const inverse = node.parent.matrixWorld.clone().invert();
    const a = new THREE.Vector3(...travel).multiplyScalar(amount).applyMatrix4(inverse);
    const b = new THREE.Vector3().applyMatrix4(inverse);
    node.position.add(a.sub(b));
  } else {
    const rotation = { W_Trigger: ['x', -0.18], W_Selector: ['x', Math.PI / 2], W_BoltCatch: ['x', -0.23], W_DustCover: ['z', -Math.PI / 2] }[name];
    const axis = new THREE.Vector3(...(rotation[0] === 'x' ? [1, 0, 0] : [0, 0, 1]));
    node.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, rotation[1] * amount));
  }
  refreshHelpers();
  render();
  return { name, amount, worldPosition: node.getWorldPosition(new THREE.Vector3()).toArray(), quaternion: node.quaternion.toArray() };
}
function reset() {
  for (const [name, base] of baselines) { const node = lookup(name); node.position.copy(base.position); node.quaternion.copy(base.quaternion); }
  document.querySelector('#motion').value = '0';
  document.querySelector('#isolate').checked = false;
  isolate(false);
  refreshHelpers();
  render();
}
const ready = (async () => {
  const response = await fetch('../../models/carbine.glb', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`carbine.glb: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const loaders = createAssetLoaders({ renderer });
  let gltf;
  try {
    gltf = await loaders.gltf.parseAsync(buffer, new URL('../../models/', location.href).href);
  } finally {
    // The factory owns decoder workers; loaded scene resources remain ours.
    loaders.dispose();
  }
  model = gltf.scene;
  root = model.getObjectByName('W_Root') || model;
  results = inspectWeapon(model, gltf.parser.json, buffer.byteLength);
  results.sha256 = globalThis.crypto?.subtle ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(v => v.toString(16).padStart(2, '0')).join('') : null;
  scene.add(model);
  model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  floor.position.y = results.bounds.min[1] - 0.025;
  for (const name of MOVING) {
    const node = lookup(name);
    if (!node) continue;
    baselines.set(name, { position: node.position.clone(), quaternion: node.quaternion.clone() });
    document.querySelector('#part').add(new Option(name, name));
  }
  const buttons = document.querySelector('#nodes');
  for (const name of REQUIRED) {
    const node = lookup(name);
    const button = document.createElement('button');
    button.textContent = `${node ? '✓' : '✗'} ${name}`;
    button.dataset.node = name;
    button.disabled = !node;
    button.addEventListener('click', () => select(name));
    buttons.append(button);
    if (node) {
      const gizmo = new THREE.AxesHelper(VIEWER.allAxisLength);
      gizmo.matrixAutoUpdate = false;
      gizmo.visible = false;
      gizmo.material.depthTest = false;
      gizmo.renderOrder = 4;
      axes.add(gizmo);
      gizmos.set(name, gizmo);
    }
  }
  const summary = document.querySelector('#summary');
  summary.className = results.ok ? 'pass' : 'fail';
  summary.textContent = `${results.ok ? 'BESTANDEN' : 'NICHT BESTANDEN'} · ${results.checks.filter(c => c.passed).length}/${results.checks.length} Prüfungen\n${(results.bytes / 1e6).toFixed(3)} MB · ${results.triangles.toLocaleString('de-DE')} Dreiecke\nB × H × L: ${results.bounds.size.map(v => v.toFixed(3)).join(' × ')} m`;
  for (const check of results.checks) {
    const li = document.createElement('li');
    li.className = check.passed ? 'pass' : check.severity === 'warning' ? 'warn' : 'fail';
    li.textContent = `${check.passed ? '✓' : '✗'} ${check.detail}`;
    document.querySelector('#checks').append(li);
  }
  document.querySelector('#download').disabled = false;
  setView('overview');
  select(lookup('W_Muzzle') ? 'W_Muzzle' : root.name);
  return results;
})();
window.weaponTest = { ready, get results() { return results; }, view: setView, light: setLighting, select, pose, reset, render,
  axes(enabled, all = false) { document.querySelector('#axes').checked = enabled; document.querySelector('#allAxes').checked = all; for (const gizmo of gizmos.values()) gizmo.visible = all; originAxes.visible = enabled; refreshHelpers(); render(); },
  isolate(enabled) { document.querySelector('#isolate').checked = enabled; isolate(enabled); },
  getRendererInfo: () => ({ ...renderer.info.render, memory: { ...renderer.info.memory } }),
};
ready.catch(error => { document.querySelector('#summary').textContent = `Ladefehler: ${error.message}`; document.querySelector('#summary').className = 'fail'; console.error(error); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#studio').addEventListener('click', () => setLighting('studio'));
document.querySelector('#spot').addEventListener('click', () => setLighting('spot'));
document.querySelector('#reset').addEventListener('click', reset);
document.querySelector('#exposure').addEventListener('input', event => { renderer.toneMappingExposure = Number(event.target.value); document.querySelector('#exposureValue').value = Number(event.target.value).toLocaleString('de-DE'); render(); });
document.querySelector('#axes').addEventListener('change', event => { originAxes.visible = event.target.checked; refreshHelpers(); });
document.querySelector('#allAxes').addEventListener('change', event => { for (const gizmo of gizmos.values()) gizmo.visible = event.target.checked; });
document.querySelector('#wireframe').addEventListener('change', event => model?.traverse(node => { if (node.isMesh) for (const mat of Array.isArray(node.material) ? node.material : [node.material]) mat.wireframe = event.target.checked; }));
document.querySelector('#isolate').addEventListener('change', event => isolate(event.target.checked));
document.querySelector('#part').addEventListener('change', event => { document.querySelector('#motion').value = '0'; select(event.target.value); pose(event.target.value, 0); });
document.querySelector('#motion').addEventListener('input', event => pose(document.querySelector('#part').value, event.target.value));
document.querySelector('#download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'weapon-validation.json'; a.click(); URL.revokeObjectURL(url); });
new ResizeObserver(() => { const { width, height } = viewport.getBoundingClientRect(); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); render(); }).observe(viewport);
renderer.setAnimationLoop(render);
