import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { Picker } from './picker.js';
import { Overlay } from './overlay.js';
import { MeasureStore, evaluate, fmtLen, fmtFactor, dist } from './measure.js';
import { HeightProfile } from './profile.js';

const BASE = import.meta.env.BASE_URL;
const $ = (id) => document.getElementById(id);
const app = $('app');
const canvas = $('view');
const COLORS = { dist: '#ffd23f', area: '#3ddc97', height: '#ff7ab6' };
const coarse = matchMedia('(pointer: coarse)').matches;
const MB = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function showFatal(title, detail = '', reload = false) {
  const el = $('loading');
  el.classList.remove('done');
  el.classList.add('error');
  $('loading-title').textContent = title;
  $('loading-text').textContent = detail;
  $('btn-reload').hidden = !reload;
}
$('btn-reload').addEventListener('click', () => location.reload());

let renderer, scene, camera, spark, controls, overlay, picker, profile;
const store = new MeasureStore();
const raycaster = new THREE.Raycaster();

const state = {
  tool: 'nav',
  draft: null,        // { type, points: [[x,y,z]...], hover: [x,y,z] | null }
  selected: null,
  ready: false,
  pickOk: false,
  dirty: true,
  home: null,         // { position: Vector3, target: Vector3 }
  tween: null,
  keys: new Set(),
  centerDepth: null,  // Abstand der sichtbaren Oberfläche in Bildmitte (für die Maßstabsleiste)
  marker: null,       // Stelle, auf die das Höhenprofil gerade zeigt
  profileClosed: null, // Messung, deren Profil der Nutzer weggeklickt hat
};

// Hintergrund: senkrechter Farbverlauf (Himmel -> Dunst). Der Splat selbst enthält
// keinen Himmel, weil dessen Splats von oben betrachtet als Schlieren im Raum stünden.
function skyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  stops.forEach((col, i) => grad.addColorStop(i / (stops.length - 1), col));
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function setBackground(bg) {
  if (Array.isArray(bg) && bg.length >= 2) scene.background = skyTexture(bg);
  else if (typeof bg === 'string') scene.background = new THREE.Color(bg);
}

// ---------------------------------------------------------------- Renderer
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  scene = new THREE.Scene();
  setBackground(['#141c25', '#0e1319', '#0a0d11']);
  camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
  camera.position.set(4, 3, 6);
  spark = new SparkRenderer({ renderer });
  scene.add(spark);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.zoomToCursor = true;
  controls.minDistance = 0.2;
  controls.maxDistance = 150;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.rotateSpeed = 0.7;

  overlay = new Overlay($('overlay'), $('labels'), camera);
  picker = new Picker();
  profile = new HeightProfile({
    picker, card: $('profile'), svg: $('profile-svg'), info: $('profile-info'), title: $('profile-title'),
    onMarker: (p) => { state.marker = p; state.dirty = true; },
  });
} catch (err) {
  console.error(err);
  showFatal('Die 3D-Ansicht kann nicht gestartet werden.',
    'Dieser Browser oder dieses Gerät unterstützt kein WebGL 2.');
  throw err;
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showFatal('Die 3D-Ansicht wurde vom Gerät angehalten.', 'Deine Messungen sind gespeichert.', true);
});

function resize() {
  const w = Math.max(1, app.clientWidth), h = Math.max(1, app.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  overlay.setSize(w, h);
  state.dirty = true;
}
new ResizeObserver(resize).observe(app);
resize();

// ---------------------------------------------------------------- Laden
async function loadScene() {
  let cfg = {};
  try {
    const r = await fetch(`${BASE}scene/scene.json`, { cache: 'no-cache' });
    if (r.ok) cfg = await r.json();
  } catch { /* ohne Beschreibung mit Standardwerten weiter */ }
  const file = new URLSearchParams(location.search).get('splat') || cfg.splat || 'garden.sog';
  if (cfg.title) { $('title').textContent = cfg.title; document.title = `${cfg.title} – 3D-Begehung`; }
  if (cfg.subtitle) $('subtitle').textContent = cfg.subtitle;
  if (cfg.background) setBackground(cfg.background);

  const mesh = new SplatMesh({
    url: `${BASE}scene/${file}`,
    extSplats: true, // Float32-Positionen: wichtig für genaue Maße
    onProgress: (e) => {
      if (e.lengthComputable && e.total > 0) {
        $('loading-bar').style.width = `${((e.loaded / e.total) * 100).toFixed(0)}%`;
        $('loading-text').textContent = `${MB.format(e.loaded / 1e6)} von ${MB.format(e.total / 1e6)} MB`;
      } else if (e.loaded) {
        $('loading-text').textContent = `${MB.format(e.loaded / 1e6)} MB`;
      }
    },
  });
  const t = cfg.transform || {};
  if (t.quaternion) mesh.quaternion.fromArray(t.quaternion);
  else mesh.quaternion.set(1, 0, 0, 0); // übliche Splat-Konvention (Y nach unten) -> Y nach oben
  if (t.position) mesh.position.fromArray(t.position);
  if (t.scale) mesh.scale.setScalar(t.scale);
  scene.add(mesh);
  await mesh.initialized;

  $('loading-title').textContent = 'Messwerkzeug wird vorbereitet …';
  $('loading-bar').style.width = '100%';
  await new Promise((r) => setTimeout(r, 30)); // Ladetext zeichnen lassen (kein rAF: steht in Hintergrund-Tabs)
  let n = mesh.extSplats?.numSplats ?? 0;
  try {
    n = await picker.init(mesh);
    if (cfg.picking?.tau) picker.tau = cfg.picking.tau;
    if (cfg.picking?.minOpacity) picker.minOpacity = cfg.picking.minOpacity;
    state.pickOk = true;
  } catch (err) {
    console.error(err);
  }

  // Startansicht: aus der Szenenbeschreibung oder aus den Szenengrenzen abgeleitet
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3();
  if (picker.localBounds) {
    const { min, max } = picker.localBounds;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
    }
  } else {
    box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 2, 5));
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(2, 0.5 * Math.hypot(size.x, size.z));
  state.sceneRadius = radius;
  state.home = cfg.view
    ? { position: new THREE.Vector3().fromArray(cfg.view.position), target: new THREE.Vector3().fromArray(cfg.view.target) }
    : { position: center.clone().add(new THREE.Vector3(radius * 0.75, radius * 0.7, radius * 0.95)), target: center.clone() };
  camera.position.copy(state.home.position);
  controls.target.copy(state.home.target);
  controls.maxDistance = Math.max(60, radius * 8);
  controls.update();

  state.cfg = cfg;
  state.mesh = mesh;
  state.ready = true;
  $('status').textContent = `${new Intl.NumberFormat('de-DE').format(n)} Splats`;
  // Messungen gehören zu genau dieser Veröffentlichung, Datei und Kalibrierung
  store.restoreFor([new URL(BASE, location.href).pathname, file, cfg.version ?? '', JSON.stringify(cfg.transform ?? null)].join('|'));
  renderCalibration();
  $('loading').classList.add('done');
  setTool('nav');
  if (!state.pickOk) {
    toast('Die Messwerkzeuge konnten nicht gestartet werden. Bitte die Seite neu laden.', 8000, true);
  } else {
    let seen = false;
    try { seen = !!sessionStorage.getItem('grundstueck-viewer:seen'); sessionStorage.setItem('grundstueck-viewer:seen', '1'); } catch { /* egal */ }
    if (!seen) {
      toast(coarse ? 'Ein Finger dreht, zwei Finger zoomen und verschieben. Unten ein Messwerkzeug wählen.'
        : 'Ziehen dreht, Mausrad zoomt, Doppelklick setzt den Drehpunkt.', 5200);
    }
  }
}

loadScene().catch((err) => {
  console.error(err);
  showFatal('Das Modell konnte nicht geladen werden.', String(err?.message || err), true);
});

// ---------------------------------------------------------------- Picking
function raysAt(clientX, clientY, multi) {
  const r = canvas.getBoundingClientRect();
  const offsets = multi ? [[0, 0], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]] : [[0, 0]];
  camera.updateMatrixWorld();
  return offsets.map(([ox, oy]) => {
    const ndc = new THREE.Vector2(
      ((clientX + ox - r.left) / r.width) * 2 - 1,
      -((clientY + oy - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.clone();
  });
}
async function pickAt(clientX, clientY, multi = true) {
  if (!state.ready || !state.pickOk) return null;
  return picker.pick(raysAt(clientX, clientY, multi));
}

// ---------------------------------------------------------------- Werkzeuge
const HINTS = {
  dist: ['Ersten Punkt der Strecke antippen', 'Zweiten Punkt antippen'],
  height: ['Ersten Punkt antippen (z. B. am Boden)', 'Zweiten Punkt antippen (z. B. Oberkante)'],
  calib: ['Anfang einer bekannten Strecke antippen (z. B. eine Wegkante)', 'Ende der Strecke antippen (gegenüberliegende Wegkante)'],
};
let hoverGen = 0, hoverNext = null;
function invalidateHover() { hoverGen++; hoverNext = null; }

function undoPoint() {
  if (!state.draft?.points.length) return;
  state.draft.points.pop();
  state.draft.hover = null;
  invalidateHover();
  updateHint();
  state.dirty = true;
}
function cancelDraft() {
  if (!state.draft) return;
  state.draft.points = [];
  state.draft.hover = null;
  invalidateHover();
  updateHint();
  state.dirty = true;
}
function updateHint() {
  const el = $('hint');
  const d = state.draft;
  const n = d?.points.length || 0;
  let html = '';
  if (state.tool === 'area') {
    if (n === 0) html = 'Eckpunkte der Fläche nacheinander antippen';
    else if (n < 3) html = `<span>${n} von mindestens 3 Eckpunkten gesetzt</span>`;
    else html = `<span>${n} Eckpunkte</span><button class="go" data-act="finish">Fläche schließen</button>`;
  } else if (HINTS[state.tool]) {
    html = `<span>${HINTS[state.tool][Math.min(n, 1)]}</span>`;
  }
  if (n > 0) html += '<button data-act="undo">Rückgängig</button><button data-act="cancel">Abbrechen</button>';
  el.innerHTML = html;
  el.classList.toggle('show', !!html);
  el.classList.toggle('action', n > 0);
}
$('hint').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'finish') queue(finishArea);
  else if (act === 'undo') undoPoint();
  else if (act === 'cancel') cancelDraft();
});

function setTool(tool) {
  state.tool = tool;
  state.draft = tool === 'nav' ? null : { type: tool, points: [], hover: null };
  invalidateHover();
  app.dataset.tool = tool;
  document.querySelectorAll('.toolbar button').forEach((b) => {
    const on = b.dataset.tool === tool;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // Auf schmalen Bildschirmen würde die Liste Hinweis und Schaltflächen verdecken
  if (tool !== 'nav' && !wideLayout()) showPanel(false);
  updateHint();
  state.dirty = true;
}
document.querySelectorAll('.toolbar button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

function select(id) {
  state.selected = id;
  state.profileClosed = null;
  renderList();
}

// Höhenprofil gehört zur angewählten Strecke (oder Höhenmessung)
function syncProfile() {
  const it = store.items.find((i) => i.id === state.selected);
  if (it && state.pickOk && (it.type === 'dist' || it.type === 'height') && state.profileClosed !== it.id) {
    profile.show(it, store.k);
  } else {
    profile.hide();
  }
}
$('profile-close').addEventListener('click', () => { state.profileClosed = state.selected; profile.hide(); });

// Klicks werden nacheinander abgearbeitet, weil das Picking asynchron ist.
let chain = Promise.resolve();
function queue(fn) { chain = chain.then(fn).catch((e) => console.error(e)); return chain; }

async function handleClick(x, y) {
  if (state.tool === 'nav' || !state.draft) return;
  const draft = state.draft;
  const hit = await pickAt(x, y, true);
  if (state.draft !== draft) return; // Werkzeug wurde inzwischen gewechselt
  if (!hit) { toast('An dieser Stelle ist keine Oberfläche erkennbar.', 2200, true); return; }
  const p = [hit.point.x, hit.point.y, hit.point.z];
  const d = draft;
  if (d.points.length && dist(d.points[d.points.length - 1], p) < 1e-4) return;
  d.points.push(p);
  d.hover = null;
  invalidateHover();
  // Warnen nur bei wirklich dünnen Stellen; halbtransparente Flächen sind bei echten Splats normal
  if (hit.opacity < 0.25 || (hit.spread != null && hit.spread > 0.6)) {
    toast('Unscharfe Stelle (Bewuchs oder Lücke) – der Punkt ist hier weniger genau.', 2800, true);
  } else if (hit.scatter > Math.max(0.35, 0.05 * hit.point.distanceTo(camera.position))) {
    toast('Flacher Blickwinkel – für genauere Maße näher heran oder steiler von oben antippen.', 2800, true);
  }
  if ((d.type === 'dist' || d.type === 'height') && d.points.length === 2) {
    const item = store.add(d.type, d.points);
    state.draft = { type: d.type, points: [], hover: null };
    select(item.id);
    showPanel(true, true);
  } else if (d.type === 'calib' && d.points.length === 2) {
    updateHint();
    state.dirty = true;
    await askCalibration(d.points);
    if (state.draft === d) state.draft = { type: 'calib', points: [], hover: null };
  }
  updateHint();
  state.dirty = true;
}

async function finishArea() {
  const d = state.draft;
  if (!d || d.type !== 'area') return;
  if (d.points.length >= 3) {
    const item = store.add('area', d.points);
    state.draft = { type: 'area', points: [], hover: null };
    invalidateHover();
    select(item.id);
    showPanel(true, true);
  } else {
    toast('Eine Fläche braucht mindestens drei Eckpunkte.', 2200, true);
  }
  updateHint();
  state.dirty = true;
}

// ---------------------------------------------------------------- Kalibrierung
function parseNumber(s) {
  const v = Number(String(s).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}
function askCalibration(points) {
  return new Promise((resolve) => {
    const dlg = $('calib-dialog'), input = $('calib-input');
    const raw = dist(points[0], points[1]);
    const measured = raw * store.k;
    if (!(measured >= 0.05)) {
      toast('Die Referenzstrecke ist zu kurz – bitte zwei deutlich getrennte Punkte wählen.', 3200, true);
      resolve();
      return;
    }
    $('calib-measured').textContent = fmtLen(measured);
    input.classList.remove('invalid');
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      if (dlg.returnValue === 'ok') {
        const known = parseNumber(input.value);
        const ratio = known / measured;
        const plausible = ratio > 0.5 && ratio < 2;
        if (known > 0 && (plausible || confirm(
          `Die eingegebene Länge (${fmtLen(known)}) weicht stark vom gemessenen Abstand (${fmtLen(measured)}) ab. Trotzdem als Maßstab übernehmen?`))) {
          store.addCalibration(raw, known);
          const n = store.calibPairs.length;
          toast(`Maßstab angepasst: Faktor ${fmtFactor(store.k)} (${n} Referenz${n > 1 ? 'en' : ''}).`, 3600);
        }
      }
      resolve();
    };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = 'cancel';
    dlg.showModal();
    input.select();
  });
}
// „Übernehmen“ ist die Standardschaltfläche des Formulars: Enter im Eingabefeld löst sie aus.
$('calib-ok').addEventListener('click', (e) => {
  const input = $('calib-input');
  if (!(parseNumber(input.value) > 0)) { e.preventDefault(); input.classList.add('invalid'); input.focus(); }
});
$('calib-cancel').addEventListener('click', () => $('calib-dialog').close('cancel'));
$('calib-input').addEventListener('input', (e) => e.target.classList.remove('invalid'));
$('btn-calib-reset').addEventListener('click', () => { store.resetCalibration(); toast('Eigene Kalibrierung entfernt.'); });

function renderCalibration() {
  const c = state.cfg?.calibration;
  $('calib-text').textContent = c?.text
    || 'Der Maßstab stammt aus der Aufnahme. Mit dem Werkzeug „Maßstab“ lässt er sich über eine bekannte Strecke nachjustieren.';
  const n = store.calibPairs.length;
  $('calib-user').hidden = n === 0;
  if (n) $('calib-user-text').textContent = `Eigene Kalibrierung: Faktor ${fmtFactor(store.k)} (${n} Referenz${n > 1 ? 'en' : ''})`;
}

// ---------------------------------------------------------------- Liste
function wideLayout() { return matchMedia('(min-width: 721px) and (min-height: 520px)').matches; }
function showPanel(show, onlyIfWide = false) {
  if (onlyIfWide && !wideLayout()) return;
  const panel = $('panel');
  panel.classList.toggle('hidden', !show);
  panel.inert = !show;
  $('btn-panel').classList.toggle('on', show);
  $('btn-panel').setAttribute('aria-expanded', String(show));
}
function renderList() {
  const k = store.k;
  if (state.selected && !store.items.some((i) => i.id === state.selected)) state.selected = null;
  $('list').innerHTML = store.items.map((it) => {
    const e = evaluate(it, k);
    const extra = e.secondary ? `<span class="extra">${e.secondary}</span>` : '';
    return `<li data-id="${it.id}" tabindex="0" role="button" aria-label="${it.name}: ${e.primary}" class="${it.id === state.selected ? 'sel' : ''}">
      <span class="swatch" style="background:${COLORS[it.type]}"></span>
      <span class="name">${it.name}</span>
      <button class="del" data-del="${it.id}" title="Messung löschen" aria-label="${it.name} löschen">×</button>
      <span class="value">${e.primary}</span>${extra}
    </li>`;
  }).join('');
  const n = store.items.length;
  $('empty').hidden = n > 0;
  $('btn-export').disabled = n === 0;
  $('btn-clear').disabled = n === 0;
  const badge = $('count-badge');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  renderCalibration();
  syncProfile();
  state.dirty = true;
}
store.addEventListener('change', renderList);
function activateRow(li) {
  const it = store.items.find((i) => i.id === li.dataset.id);
  if (!it) return;
  select(it.id);
  focusOn(it.points);
}
$('list').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { store.remove(del.dataset.del); return; }
  const li = e.target.closest('li[data-id]');
  if (li) activateRow(li);
});
$('list').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li[data-id]')) { e.preventDefault(); activateRow(e.target); }
});
$('btn-clear').addEventListener('click', () => {
  if (store.items.length && confirm('Alle Messungen löschen?')) { state.selected = null; store.clear(); }
});
$('btn-export').addEventListener('click', () => {
  const blob = new Blob([store.toCSV()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grundstueck-messungen.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('btn-panel').addEventListener('click', () => showPanel($('panel').classList.contains('hidden')));
$('btn-help').addEventListener('click', () => $('help-dialog').showModal());
showPanel(wideLayout());

// ---------------------------------------------------------------- Kamera
function animateTo(position, target, ms = 650) {
  state.tween = {
    t0: performance.now(), ms,
    p0: camera.position.clone(), p1: position.clone(),
    q0: controls.target.clone(), q1: target.clone(),
  };
}
function focusOn(points) {
  const box = new THREE.Box3();
  points.forEach((p) => box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2])));
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(0.6, box.getSize(new THREE.Vector3()).length());
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.45) { dir.y = 0.45; dir.normalize(); }
  animateTo(c.clone().addScaledVector(dir, r * 1.6 + 0.8), c);
}
function goHome() { if (state.home) animateTo(state.home.position, state.home.target); }
function goTop() {
  const t = controls.target.clone();
  const d = Math.max(camera.position.distanceTo(t), (state.sceneRadius || 5) * 1.6);
  const back = camera.position.clone().sub(t).setY(0);
  if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
  back.normalize().multiplyScalar(d * 0.002); // minimaler Versatz hält die Blickrichtung stabil
  animateTo(t.clone().add(new THREE.Vector3(0, d, 0)).add(back), t);
}
$('btn-home').addEventListener('click', goHome);
$('btn-top').addEventListener('click', goTop);

function moveByKeys(dt) {
  const k = state.keys;
  if (!k.size) return;
  const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  if (!f && !s && !u) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const fast = k.has('ShiftLeft') || k.has('ShiftRight');
  const speed = Math.max(1.2, camera.position.distanceTo(controls.target) * 0.6) * (fast ? 3 : 1);
  const delta = fwd.multiplyScalar(f).add(right.multiplyScalar(s)).add(new THREE.Vector3(0, u, 0)).multiplyScalar(speed * dt);
  camera.position.add(delta);
  controls.target.add(delta);
  state.tween = null;
}

// ---------------------------------------------------------------- Eingaben
const pointers = new Map();
let gestureMulti = false;
let lastClick = { t: 0, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button });
  if (pointers.size > 1) gestureMulti = true;
  state.tween = null;
});
function endPointer(e, cancelled) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  const multi = gestureMulti;
  if (pointers.size === 0) gestureMulti = false;
  if (!p || cancelled || multi || p.button !== 0) return;
  const now = performance.now();
  const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
  const touch = e.pointerType !== 'mouse';
  // Finger zittern stärker und tippen langsamer als eine Maus
  if (moved > (touch ? 12 : 6) || now - p.t > (touch ? 1500 : 700)) return;
  // Der zweite Klick eines Doppelklicks setzt keinen weiteren Punkt
  const dbl = now - lastClick.t < 400 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8;
  lastClick = { t: now, x: e.clientX, y: e.clientY };
  if (dbl) return;
  queue(() => handleClick(e.clientX, e.clientY));
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('dblclick', (e) => {
  if (state.tool === 'area') { queue(finishArea); return; }
  if (state.tool !== 'nav') return;
  queue(async () => {
    const hit = await pickAt(e.clientX, e.clientY, true);
    if (!hit) return;
    // Drehpunkt nicht höher legen, als es die Neigungsgrenze der Kamera zulässt
    const t = hit.point.clone();
    const h = Math.hypot(camera.position.x - t.x, camera.position.z - t.z);
    const maxY = camera.position.y + h * Math.tan(controls.maxPolarAngle - Math.PI / 2);
    if (t.y > maxY) t.y = maxY;
    animateTo(camera.position.clone(), t, 350);
  });
});

// Vorschau unter dem Mauszeiger (nur mit Maus; auf Touch-Geräten gibt es kein Hover)
let hoverBusy = false;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || state.tool === 'nav' || !state.draft || e.buttons) return;
  hoverNext = [e.clientX, e.clientY];
  if (hoverBusy) return;
  hoverBusy = true;
  (async () => {
    try {
      while (hoverNext) {
        const [x, y] = hoverNext; hoverNext = null;
        const gen = hoverGen, draft = state.draft;
        const hit = await pickAt(x, y, false);
        if (gen === hoverGen && draft && state.draft === draft) {
          draft.hover = hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
          state.dirty = true;
        }
      }
    } finally { hoverBusy = false; }
  })();
});
canvas.addEventListener('pointerleave', () => {
  invalidateHover();
  if (state.draft) { state.draft.hover = null; state.dirty = true; }
});

const TOOL_KEYS = { 1: 'nav', 2: 'dist', 3: 'area', 4: 'height', 5: 'calib' };
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.target instanceof HTMLInputElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) { state.keys.clear(); return; }
  if (MOVE_CODES.has(e.code)) {
    state.keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
    return;
  }
  const key = e.key.toLowerCase();
  if (TOOL_KEYS[key]) { setTool(TOOL_KEYS[key]); return; }
  if (key === 'escape') { if (state.draft?.points.length) cancelDraft(); else setTool('nav'); return; }
  if (key === 'backspace' && state.draft?.points.length) { undoPoint(); e.preventDefault(); return; }
  if (key === 'enter' && state.tool === 'area' && !(e.target instanceof HTMLButtonElement) && !e.target.closest?.('li')) { queue(finishArea); return; }
  if (key === 'h') { goHome(); return; }
  if (key === 't') { goTop(); return; }
  if (key === 'm') { showPanel($('panel').classList.contains('hidden')); return; }
  if (key === '?') { $('help-dialog').showModal(); }
});
window.addEventListener('keyup', (e) => state.keys.delete(e.code));
window.addEventListener('blur', () => state.keys.clear());
document.addEventListener('visibilitychange', () => state.keys.clear());

// ---------------------------------------------------------------- Anzeige
let toastTimer = 0;
function toast(text, ms = 2600, warn = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('warn', warn);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Die Maßstabsleiste gilt für die Oberfläche in der Bildmitte. Deren Abstand wird
// gemessen, sobald die Kamera kurz stillsteht; solange gilt der Abstand zum Drehpunkt.
const NICE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
function updateScaleBar() {
  const d = state.centerDepth ?? camera.position.distanceTo(controls.target);
  const mPerPx = (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / overlay.h) * store.k;
  let L = NICE[NICE.length - 1];
  for (const v of NICE) { if (v / mPerPx >= 56) { L = v; break; } }
  const el = $('scalebar');
  el.firstElementChild.style.width = `${Math.min(220, L / mPerPx).toFixed(0)}px`;
  el.lastElementChild.textContent = L < 1 ? `${Math.round(L * 100)} cm` : `${L} m`;
}
let depthTimer = 0, depthGen = 0;
function scheduleCenterDepth() {
  clearTimeout(depthTimer);
  const gen = ++depthGen;
  depthTimer = setTimeout(async () => {
    const r = canvas.getBoundingClientRect();
    const hit = await pickAt(r.left + r.width / 2, r.top + r.height / 2, false);
    if (gen !== depthGen) return;
    state.centerDepth = hit ? -hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z : null;
    updateScaleBar();
  }, 180);
}

const lastCam = new Float64Array(32);
function cameraChanged() {
  const a = camera.matrixWorld.elements, b = camera.projectionMatrix.elements;
  let changed = false;
  for (let i = 0; i < 16; i++) {
    if (lastCam[i] !== a[i] || lastCam[16 + i] !== b[i]) { changed = true; lastCam[i] = a[i]; lastCam[16 + i] = b[i]; }
  }
  return changed;
}

let lastT = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  moveByKeys(dt);
  if (state.tween) {
    const tw = state.tween;
    const u = Math.min(1, (now - tw.t0) / tw.ms);
    const s = u * u * (3 - 2 * u);
    camera.position.lerpVectors(tw.p0, tw.p1, s);
    controls.target.lerpVectors(tw.q0, tw.q1, s);
    if (u >= 1) state.tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
  const moved = cameraChanged();
  if (moved && state.ready) scheduleCenterDepth();
  if (moved || state.dirty) {
    state.dirty = false;
    try {
      camera.updateMatrixWorld();
      const items = store.items.slice();
      if (state.draft && (state.draft.points.length || state.draft.hover)) items.push({ ...state.draft, draft: true });
      if (state.marker) items.push({ type: 'marker', points: [state.marker] });
      overlay.render(items, store.k, state.selected);
      updateScaleBar();
    } catch (err) { console.error(err); }
  }
});

// Für Tests und zur Fehlersuche in der Konsole
window.__viewer = { THREE, scene, camera, controls, picker, store, state, pickAt, setTool, renderer };
