import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAssetLoaders } from '../../js/core/loaders.js';
import { auditSkinWeights } from './audit.js';

export const VIEWER_CONFIG = {
  modelUrl: '../../models/officer.glb', poseUrl: './poses.json', sizeLimitBytes: 12_000_000,
  background: 0x343e46, exposure: 1, pixelRatioLimit: 2,
  bodycam: { height: 1.40, position: [0, 1.40, -0.19], target: [0, 0.18, -0.48], fov: 82, near: 0.018 },
  orbit: { position: [-2.5, 1.65, -3.0], target: [0, 0.95, 0], fov: 38, near: 0.01 },
  light: { hemisphere: 1.3, key: 3, fill: 1.5 },
};

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat('de-DE');
const state = { ready: false, disposed: false, error: null, pose: 'rest', view: 'overview', skeleton: false, wireframe: false,
  weightBone: null, bytes: 0, audit: null, warnings: [], missingBones: [], boneCount: 0, skinnedMeshes: 0,
  rigidAttachments: [], bounds: null, textureSizes: [], frame: 0 };
let renderer, scene, camera, controls, model, helper, poses, resizeObserver, environmentTarget;
const sourceGeometries = new Set();
const bones = new Map(), rest = new Map(), meshes = [], originalMaterials = new Map(), originalColors = new Map();
const heatMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const vector = new THREE.Vector3(), color = new THREE.Color();

function readTransform(target, transform, basis, delta = false) {
  if (transform.quaternion) {
    const q = transform.quaternion;
    if (q.length !== 4 || !q.every(Number.isFinite) || Math.hypot(...q) < 1e-8) throw new Error(`Ungültige Rotation: ${target.name}.`);
    target.quaternion.fromArray(q).normalize();
    if (delta) target.quaternion.premultiply(basis.quaternion);
  }
  if (transform.position) {
    if (transform.position.length !== 3 || !transform.position.every(Number.isFinite)) throw new Error(`Ungültige Position: ${target.name}.`);
    target.position.fromArray(transform.position);
    if (delta) target.position.multiply(basis.scale).applyQuaternion(basis.quaternion).add(basis.position);
  }
  if (transform.scale) {
    if (transform.scale.length !== 3 || !transform.scale.every((n) => Number.isFinite(n) && n > 0)) throw new Error(`Ungültige Skalierung: ${target.name}.`);
    target.scale.fromArray(transform.scale);
    if (delta) target.scale.multiply(basis.scale);
  }
}

function refreshBounds() {
  model.updateMatrixWorld(true);
  for (const mesh of meshes) if (mesh.isSkinnedMesh) {
    mesh.skeleton.update();
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  const box = new THREE.Box3().setFromObject(model, true);
  state.bounds = { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(vector).toArray() };
}

function setPose(name, { updateView = true } = {}) {
  if (!model || !poses?.poses[name]) throw new Error(`Testpose fehlt: ${name}.`);
  const pose = poses.poses[name];
  for (const [object, transform] of rest) {
    object.position.copy(transform.position); object.quaternion.copy(transform.quaternion); object.scale.copy(transform.scale);
  }
  state.missingBones = [];
  for (const [boneName, transform] of Object.entries(pose.bones || {})) {
    const bone = bones.get(boneName);
    if (!bone) { state.missingBones.push(boneName); continue; }
    readTransform(bone, transform, rest.get(bone), (pose.space || poses.space) === 'bone-delta');
  }
  for (const [nodeName, transform] of Object.entries(pose.nodes || {})) {
    const node = model.getObjectByName(nodeName);
    if (!node || !rest.has(node)) throw new Error(`Pose-Knoten fehlt: ${nodeName}.`);
    readTransform(node, transform, rest.get(node), (pose.space || poses.space) === 'bone-delta');
  }
  if (state.missingBones.length) throw new Error(`Pose verweist auf fehlende Knochen: ${state.missingBones.join(', ')}.`);
  state.pose = name; $('pose').value = name;
  refreshBounds();
  if (updateView) setView(name === 'look-down' ? 'bodycam' : state.view === 'bodycam' ? 'overview' : state.view);
  $('pose-note').textContent = pose.note || (name === 'look-down' ? 'Brustkamera: Höhe 1,40 m, Blick nach unten.' : 'Statische Prüfpose, keine Animation im Export.');
  renderStats();
  return snapshot();
}

function setView(name) {
  const center = new THREE.Vector3(0, 0.95, 0), position = new THREE.Vector3();
  camera.near = VIEWER_CONFIG.orbit.near; camera.fov = VIEWER_CONFIG.orbit.fov;
  controls.enabled = true;
  switch (name) {
    case 'overview': position.fromArray(VIEWER_CONFIG.orbit.position); center.fromArray(VIEWER_CONFIG.orbit.target); break;
    case 'front': position.set(0, 1.0, -3.8); break;
    case 'side': position.set(-3.8, 1.0, 0); break;
    case 'back': position.set(0, 1.0, 3.8); break;
    case 'hand': {
      const hand = bones.get('LeftHandMiddle1') || bones.get('LeftHand');
      if (hand) hand.getWorldPosition(center);
      position.copy(center).add(new THREE.Vector3(-0.32, 0.10, -0.38));
      break;
    }
    case 'bodycam': {
      const settings = poses?.poses[state.pose]?.camera || VIEWER_CONFIG.bodycam;
      position.fromArray(settings.position || VIEWER_CONFIG.bodycam.position);
      // The fixed height makes screenshot comparisons between poses reproducible.
      position.y = VIEWER_CONFIG.bodycam.height;
      center.fromArray(settings.target || VIEWER_CONFIG.bodycam.target);
      camera.fov = settings.fov || VIEWER_CONFIG.bodycam.fov; camera.near = VIEWER_CONFIG.bodycam.near;
      controls.enabled = false;
      break;
    }
    default: throw new Error(`Unbekannte Ansicht: ${name}.`);
  }
  camera.position.copy(position); controls.target.copy(center); camera.lookAt(center);
  camera.updateProjectionMatrix(); controls.update();
  state.view = name; $('view').value = name;
  $('view-label').textContent = name === 'bodycam'
    ? 'Brustkamera · Höhe 1,40 m · FOV ' + camera.fov + '° · feste Prüfposition'
    : 'Freie Ansicht · Ziehen: drehen · Mausrad: zoomen · Rechte Maustaste: verschieben';
  return snapshot();
}

function setSkeleton(visible) {
  state.skeleton = Boolean(visible); helper.visible = state.skeleton; $('skeleton').checked = state.skeleton;
  return snapshot();
}

function setWireframe(visible) {
  state.wireframe = Boolean(visible); $('wireframe').checked = state.wireframe;
  for (const materials of originalMaterials.values()) for (const material of Array.isArray(materials) ? materials : [materials]) material.wireframe = state.wireframe;
  heatMaterial.wireframe = state.wireframe;
  return snapshot();
}

function setWeightBone(name) {
  if (name !== null && !bones.has(name)) throw new Error(`Unbekannter Knochen: ${name}.`);
  state.weightBone = name; $('weights').checked = name !== null;
  if (name) $('bone').value = name;
  for (const mesh of meshes) {
    if (!mesh.isSkinnedMesh) continue;
    if (name === null) {
      mesh.material = originalMaterials.get(mesh);
      const original = originalColors.get(mesh);
      if (original) mesh.geometry.setAttribute('color', original); else mesh.geometry.deleteAttribute('color');
      continue;
    }
    const boneIndex = mesh.skeleton.bones.findIndex((b) => b.name === name);
    const weights = mesh.geometry.getAttribute('skinWeight'), indices = mesh.geometry.getAttribute('skinIndex');
    const colors = new Float32Array(weights.count * 3);
    for (let vertex = 0; vertex < weights.count; vertex++) {
      let weight = 0;
      for (let i = 0; i < 4; i++) if (indices.getComponent(vertex, i) === boneIndex) weight += weights.getComponent(vertex, i);
      color.setHSL((1 - Math.min(1, weight)) * 2 / 3, 0.85, 0.48);
      color.toArray(colors, vertex * 3);
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); mesh.material = heatMaterial;
  }
  return snapshot();
}

function snapshot() {
  return JSON.parse(JSON.stringify({ ...state, camera: camera ? { position: camera.position.toArray(),
    target: controls.target.toArray(), fov: camera.fov, near: camera.near } : null,
    poseNames: poses ? Object.keys(poses.poses) : [], boneNames: [...bones.keys()], meshNames: meshes.map((mesh) => mesh.name),
    renderer: renderer ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } : null }));
}

function renderStats() {
  const a = state.audit;
  if (!a) return;
  const rows = [
    ['Dateigröße', (state.bytes / 1_000_000).toFixed(2) + ' MB / 12 MB'], ['Dreiecke', number.format(a.triangles)],
    ['Vertices', number.format(a.vertices)], ['Skinned Vertices', number.format(a.skinnedVertices)],
    ['Skinned Meshes / Skins', state.skinnedMeshes + ' / ' + a.skins], ['Knochen', state.boneCount],
    ['Starre Knochenteile', state.rigidAttachments.length], ['Materialien / Bilder', a.materials + ' / ' + a.images],
    ['Texturgrößen', [...new Set(state.textureSizes)].join(', ') || 'keine'], ['Animationsclips', a.animations],
    ['Dekodierte Meshopt-Views', a.meshoptBufferViews],
    ['Max. Einflüsse', a.maxInfluences], ['Max. Summenfehler', a.maxWeightError.toExponential(2)],
    ['Nicht normalisiert', a.nonNormalized], ['Nullgewichte / > 4', a.zeroWeights + ' / ' + a.overFour],
    ['Ungültige Gewichte / Joints', a.invalidWeights + ' / ' + a.invalidJoints],
    ['Maße X/Y/Z', state.bounds ? state.bounds.size.map((n) => n.toFixed(3)).join(' / ') + ' m' : '–'],
  ];
  $('stats').replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement('dt'), definition = document.createElement('dd');
    term.textContent = label; definition.textContent = String(value); return [term, definition];
  }));
  const passed = a.valid && state.bytes <= VIEWER_CONFIG.sizeLimitBytes && a.animations === 0;
  $('check-status').textContent = passed ? 'Gewichte, Dateigröße und Animationsfreiheit geprüft.' : 'Exportdaten prüfen: Abweichungen in den Messwerten.';
  $('check-status').className = passed ? 'pass' : 'warn';
  $('weight-report').textContent = a.meshes.map((mesh) => `${mesh.name}: ${number.format(mesh.vertices)} Vertices, max. ${mesh.maxInfluences} Einflüsse, Δ ${mesh.maxWeightError.toExponential(2)}${mesh.overFour || mesh.nonNormalized || mesh.invalidWeights || mesh.invalidJoints ? ' · FEHLER' : ''}`).join('\n');
}

function showError(error) {
  state.error = error instanceof Error ? error.message : String(error);
  $('loading').hidden = false; $('loading').className = 'error';
  $('loading').textContent = 'Charakterprüfung konnte nicht starten: ' + state.error;
  $('check-status').textContent = 'Lade- oder Datenfehler'; $('check-status').className = 'warn';
  console.error(error);
}

function resize() {
  const viewport = $('viewport'), w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}

function disposeScene(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  root?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) if (material) materials.add(material);
  });
  if (root === scene) {
    for (const geometry of sourceGeometries) geometries.add(geometry);
    for (const value of originalMaterials.values()) for (const material of (Array.isArray(value) ? value : [value])) materials.add(material);
    materials.add(heatMaterial);
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  const images = new Set();
  for (const texture of textures) { images.add(texture.image); texture.dispose(); }
  for (const image of images) image?.close?.();
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}

function dispose() {
  if (state.disposed) return snapshot();
  state.disposed = true; state.ready = false;
  renderer?.setAnimationLoop(null); resizeObserver?.disconnect(); controls?.dispose();
  disposeScene(scene); environmentTarget?.dispose(); scene?.clear(); renderer?.dispose();
  sourceGeometries.clear(); bones.clear(); rest.clear(); meshes.length = 0; originalMaterials.clear(); originalColors.clear();
  $('controls').disabled = true;
  return snapshot();
}

async function initialize() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, VIEWER_CONFIG.pixelRatioLimit));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = VIEWER_CONFIG.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('viewport').append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Geriggter Charakter mit Testposen');
  renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); showError(new Error('WebGL-Kontext verloren. Seite neu laden.')); });
  scene = new THREE.Scene(); scene.background = new THREE.Color(VIEWER_CONFIG.background);
  camera = new THREE.PerspectiveCamera(VIEWER_CONFIG.orbit.fov, 1, 0.01, 100);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
  controls.minDistance = 0.05; controls.maxDistance = 12;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x46505a, VIEWER_CONFIG.light.hemisphere));
  for (const [position, intensity] of [[[2, 4, -3], VIEWER_CONFIG.light.key], [[-3, 2, 1], VIEWER_CONFIG.light.fill]]) {
    const light = new THREE.DirectionalLight(0xffffff, intensity); light.position.fromArray(position); scene.add(light);
  }
  const environment = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmrem.fromScene(environment, 0.04); scene.environment = environmentTarget.texture; environment.dispose(); pmrem.dispose();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x414b53, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.003; scene.add(floor);
  const grid = new THREE.GridHelper(6, 24, 0x8a949d, 0x5a666f); grid.position.y = -0.001; scene.add(grid);
  setView('overview'); resize(); resizeObserver = new ResizeObserver(resize); resizeObserver.observe($('viewport'));
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); state.frame++; });

  const [modelResponse, poseResponse] = await Promise.all([
    fetch(VIEWER_CONFIG.modelUrl, { cache: 'no-store' }), fetch(VIEWER_CONFIG.poseUrl, { cache: 'no-store' }),
  ]);
  if (!modelResponse.ok) throw new Error(`officer.glb: HTTP ${modelResponse.status}.`);
  if (!poseResponse.ok) throw new Error(`poses.json: HTTP ${poseResponse.status}.`);
  const [buffer, poseData] = await Promise.all([modelResponse.arrayBuffer(), poseResponse.json()]);
  if (!poseData.poses || !['gltf-local', 'bone-delta'].includes(poseData.space)) throw new Error('poses.json: unbekanntes Format oder Koordinatensystem.');
  for (const option of $('pose').options) if (!poseData.poses[option.value]) throw new Error(`Pflichtpose fehlt: ${option.value}.`);
  if (state.disposed) return null;
  poses = poseData; state.bytes = buffer.byteLength; state.audit = await auditSkinWeights(buffer);
  if (state.disposed) return null;
  const loaders = createAssetLoaders({ renderer });
  let gltf;
  try { gltf = await loaders.gltf.parseAsync(buffer, new URL('.', new URL(VIEWER_CONFIG.modelUrl, location.href)).href); }
  finally { loaders.dispose(); }
  if (state.disposed) { disposeScene(gltf.scene); return null; }
  model = gltf.scene; scene.add(model);
  const textures = new Set();
  model.traverse((object) => {
    rest.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
    if (object.isBone) {
      if (bones.has(object.name)) throw new Error(`Doppelter Knochenname: ${object.name}.`);
      bones.set(object.name, object);
    }
    if (!object.isMesh) return;
    meshes.push(object); originalMaterials.set(object, object.material);
    // The debug colors must not alter another mesh sharing the same geometry.
    if (object.isSkinnedMesh) { sourceGeometries.add(object.geometry); object.geometry = object.geometry.clone(); state.skinnedMeshes++; }
    originalColors.set(object, object.geometry.getAttribute('color'));
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (!object.isSkinnedMesh) {
      for (let parent = object.parent; parent; parent = parent.parent) {
        if (parent.isBone) { state.rigidAttachments.push({ name: object.name, bone: parent.name }); break; }
      }
    }
  });
  state.boneCount = bones.size;
  state.textureSizes = [...textures].map((texture) => `${texture.image.width}×${texture.image.height}`);
  helper = new THREE.SkeletonHelper(model); helper.visible = false; helper.material.depthTest = false; helper.renderOrder = 10; scene.add(helper);
  for (const name of [...bones.keys()].sort()) $('bone').add(new Option(name, name));
  $('bone').value = bones.has('LeftForeArm') ? 'LeftForeArm' : bones.keys().next().value;
  $('controls').disabled = false;
  const run = (callback) => { try { callback(); } catch (error) { showError(error); } };
  $('pose').addEventListener('change', () => run(() => setPose($('pose').value)));
  $('view').addEventListener('change', () => run(() => setView($('view').value)));
  $('skeleton').addEventListener('change', () => setSkeleton($('skeleton').checked));
  $('wireframe').addEventListener('change', () => setWireframe($('wireframe').checked));
  $('weights').addEventListener('change', () => run(() => setWeightBone($('weights').checked ? $('bone').value : null)));
  $('bone').addEventListener('change', () => { if ($('weights').checked) run(() => setWeightBone($('bone').value)); });
  const params = new URLSearchParams(location.search);
  setPose(params.get('pose') || 'rest');
  if (params.has('view')) setView(params.get('view'));
  setSkeleton(params.get('skeleton') === '1');
  if (params.has('bone')) setWeightBone(params.get('bone'));
  state.ready = true; $('loading').hidden = true;
  return snapshot();
}

window.characterTest = { snapshot, setPose, setView, setSkeleton, setWireframe, setWeightBone, dispose,
  getBoneTransform(name) {
    const bone = bones.get(name);
    return bone ? { position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), worldPosition: bone.getWorldPosition(new THREE.Vector3()).toArray() } : null;
  },
  getMeshVertices(name, { step = 1, limit = 100000, world = true } = {}) {
    const mesh = meshes.find((candidate) => candidate.name === name);
    if (!mesh) throw new Error(`Unbekanntes Mesh: ${name}.`);
    if (!Number.isInteger(step) || step < 1 || !Number.isInteger(limit) || limit < 1) throw new Error('step und limit müssen positive Ganzzahlen sein.');
    const result = [], point = new THREE.Vector3();
    for (let index = 0; index < mesh.geometry.attributes.position.count && result.length < limit; index += step) {
      mesh.getVertexPosition(index, point);
      if (world) point.applyMatrix4(mesh.matrixWorld);
      result.push(point.toArray());
    }
    return result;
  },
  config: VIEWER_CONFIG,
};
window.characterTest.ready = initialize().catch((error) => {
  if (!state.disposed) { showError(error); dispose(); }
  return null;
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
