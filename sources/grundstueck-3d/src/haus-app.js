// Eigenständige 3D-Hausansicht (ohne Gaussian-Splat / ohne @sparkjsdev/spark / ohne .sog-Download).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HOUSE_SPEC } from './house/spec.js';
import { deriveDimensions } from './house/dimensions.js';
import { designServices } from './house/services.js';
import { loadBlenderHouse, createStudioLight } from './house/blender-model.js';
import { computeSitePlacement } from './site.js';
import { OFFICIAL_BAUGRENZE } from './baugrenze.js';

const $ = (id) => document.getElementById(id);
const NF1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = (v) => `${NF2.format(v)} m`;
const area2 = (v) => `${NF2.format(v)} m²`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PLINTH_DEPTH = 1.95;
const FALLBACK_PARCEL = [[-0.35, -0.5], [12.0, -0.5], [12.0, 9.0], [-0.35, 9.0]];

const PRESETS = {
  garden: { position: [14.8, 8.2, 13.2], target: [0.6, 2.6, 0.2] },
  street: { position: [-14.2, 7.6, 13.2], target: [-0.2, 2.5, 0.2] },
  top: { position: [0.0, 21.0, 6.2], target: [0.0, 2.1, 0.0] },
  cutaway: { position: [-11.8, 6.8, 12.6], target: [-0.3, 2.4, 0.0] },
};

function framedPosition(preset) {
  const tgt = new THREE.Vector3(...preset.target);
  const pos = new THREE.Vector3(...preset.position);
  const aspect = camera.aspect || (window.innerWidth / Math.max(1, window.innerHeight));
  const scale = aspect < 1 ? Math.min(2.15, 1.08 / aspect) : 1;
  if (scale !== 1) {
    pos.sub(tgt).multiplyScalar(scale).add(tgt);
  }
  return [pos.x, pos.y, pos.z];
}

const state = {
  mode: 'full',
  preset: 'garden',
  services: { water: false, power: false },
  sketch: false,
  planTab: 'eg',
  infoOpen: window.innerWidth >= 1180,
};

let servicesDesign = designServices(HOUSE_SPEC, FALLBACK_PARCEL);
let activeModel = null;
let modelKind = 'loading';
let planMod = null;
let planReqGen = 0;

// ---------------------------------------------------------------- Toast
let toastTimer = 0;
function showToast(text, ms = 3200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- Studio Sky Texture
function createSkyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  stops.forEach((col, i) => grad.addColorStop(i / (stops.length - 1), col));
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- Three.js Scene
const canvas = $('scene-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const skyTex = createSkyTexture(['#8fa4b3', '#dbe1dc', '#b7bbb2']);
scene.background = skyTex;

const studioLight = createStudioLight(renderer);
scene.environment = studioLight.texture;
scene.environmentIntensity = 0.48;

const hemi = new THREE.HemisphereLight(0xf4f8ff, 0x7d7569, 0.95);
hemi.position.set(0, 28, 0);
const sun = new THREE.DirectionalLight(0xfff4e0, 1.45);
sun.position.set(14, 21, 13);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 55 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias = 0.018;
sun.shadow.bias = -0.00015;
const fill = new THREE.DirectionalLight(0xd4e6ff, 0.42);
fill.position.set(-14, 12, -12);
scene.add(hemi, sun, fill);

// Ground studio plate + soft shadow catcher positioned right under the plinth (-1.96 m)
const groundGroup = new THREE.Group();
groundGroup.name = 'studio-ground';
const groundPlate = new THREE.Mesh(
  new THREE.CircleGeometry(26, 64),
  new THREE.MeshStandardMaterial({ color: 0xbcb8ad, roughness: 0.94, metalness: 0.0 })
);
groundPlate.rotation.x = -Math.PI / 2;
groundPlate.position.y = -PLINTH_DEPTH - 0.02;
groundPlate.receiveShadow = true;

const shadowCatcher = new THREE.Mesh(
  new THREE.CircleGeometry(26, 64),
  new THREE.ShadowMaterial({ opacity: 0.24 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = -PLINTH_DEPTH - 0.015;
shadowCatcher.receiveShadow = true;
groundGroup.add(groundPlate, shadowCatcher);
scene.add(groundGroup);

const houseRoot = new THREE.Group();
houseRoot.name = 'haus-root';
scene.add(houseRoot);

const camera = new THREE.PerspectiveCamera(48, 1, 0.08, 220);
camera.position.fromArray(PRESETS.garden.position);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.zoomToCursor = true;
controls.minDistance = 2.2;
controls.maxDistance = 42;
controls.maxPolarAngle = Math.PI * 0.51;
controls.rotateSpeed = 0.75;
controls.target.fromArray(PRESETS.garden.target);
controls.update();

// ---------------------------------------------------------------- On-Demand Render Loop & Tween
let rafId = 0;
let needsRender = true;
let tween = null;

function requestRender() {
  needsRender = true;
  if (!rafId && !document.hidden) rafId = requestAnimationFrame(renderFrame);
}

function animateCamera(posArr, tgtArr, durationMs = 560) {
  tween = {
    t0: performance.now(),
    ms: durationMs,
    p0: camera.position.clone(),
    p1: new THREE.Vector3(...posArr),
    q0: controls.target.clone(),
    q1: new THREE.Vector3(...tgtArr),
  };
  requestRender();
}

function renderFrame(now) {
  rafId = 0;
  let active = false;
  if (tween) {
    const u = Math.min(1, (now - tween.t0) / tween.ms);
    const s = u * u * (3 - 2 * u);
    camera.position.lerpVectors(tween.p0, tween.p1, s);
    controls.target.lerpVectors(tween.q0, tween.q1, s);
    if (u >= 1) tween = null;
    else active = true;
  }
  if (controls.update()) active = true;
  if (needsRender || active) {
    needsRender = false;
    renderer.render(scene, camera);
  }
  if (active) rafId = requestAnimationFrame(renderFrame);
}

controls.addEventListener('change', requestRender);
controls.addEventListener('start', () => {
  tween = null;
  requestRender();
});

function handleResize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(handleResize).observe(canvas);
window.addEventListener('resize', handleResize);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) requestRender();
});
handleResize();

// ---------------------------------------------------------------- State & Controls
function updateStatusPill() {
  const modeLabels = { full: 'Dach', og: 'OG', eg: 'EG', cutaway: 'Schnitt' };
  const svc = [];
  if (state.services.water) svc.push('Wasser');
  if (state.services.power) svc.push('Strom');
  const prefix = modelKind === 'blender' ? 'Blender PBR' : modelKind === 'fallback' ? 'Basismodell 3D' : 'Lädt …';
  $('status-pill').textContent = `${prefix} · ${modeLabels[state.mode] || state.mode}${svc.length ? ` · ${svc.join(' + ')}` : ''}`;
}

function syncUI() {
  $('app').dataset.mode = state.mode;
  document.querySelectorAll('.mode-btn').forEach((b) => {
    const on = b.dataset.mode === state.mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.svc-btn').forEach((b) => {
    const on = Boolean(state.services[b.dataset.service]);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.cam-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.cam === state.preset);
  });
  document.querySelectorAll('[data-plan-service]').forEach((el) => {
    el.checked = Boolean(state.services[el.dataset.planService]);
  });
  $('sketch-switch').checked = state.sketch;
  const isFloor = state.planTab === 'eg' || state.planTab === 'og';
  $('plan-layers').hidden = !isFloor;
  $('service-explain').hidden = !isFloor || !(state.services.water || state.services.power);
  $('sketch-explain').hidden = !isFloor || !state.sketch;

  const panel = $('info-panel');
  panel.classList.toggle('hidden', !state.infoOpen);
  panel.inert = !state.infoOpen;
  $('btn-info').classList.toggle('on', state.infoOpen);
  $('btn-info').setAttribute('aria-expanded', String(state.infoOpen));
  updateStatusPill();
}

function setMode(mode) {
  if (!['full', 'og', 'eg', 'cutaway'].includes(mode)) return;
  state.mode = mode;
  activeModel?.setMode?.(mode);
  activeModel?.setServices?.(state.services);
  syncUI();
  requestRender();
}

function setServices(next = {}) {
  if ('water' in next) state.services.water = Boolean(next.water);
  if ('power' in next) state.services.power = Boolean(next.power);
  activeModel?.setServices?.(state.services);
  syncUI();
  if ($('plan-dialog').open) renderPlanTab(state.planTab);
  requestRender();
}

function setPreset(name, instant = false) {
  const p = PRESETS[name];
  if (!p) return;
  state.preset = name;
  syncUI();
  const pos = framedPosition(p);
  if (instant) {
    tween = null;
    camera.position.fromArray(pos);
    controls.target.fromArray(p.target);
    controls.update();
    requestRender();
  } else {
    animateCamera(pos, p.target);
  }
}

function setInfoOpen(open) {
  state.infoOpen = Boolean(open);
  syncUI();
}

// ---------------------------------------------------------------- Info Drawer Content
function renderInfoPanel() {
  const dims = deriveDimensions(HOUSE_SPEC);
  const egRooms = HOUSE_SPEC.levels.eg.rooms || [];
  const ogRooms = HOUSE_SPEC.levels.og.rooms || [];
  const egArea = HOUSE_SPEC.levels.eg.netAreaM2;
  const ogArea = HOUSE_SPEC.levels.og.netAreaWithoutStairOpeningM2 ?? HOUSE_SPEC.levels.og.netAreaM2;
  const stairHole = HOUSE_SPEC.levels.og.stairOpeningAreaM2 ?? HOUSE_SPEC.stairs.slabOpening.areaM2;

  const waterRoutes = servicesDesign.routes.filter((r) => r.system === 'water');
  const powerRoutes = servicesDesign.routes.filter((r) => r.system === 'power');
  const wOutlets = waterRoutes.filter((r) => r.mark === 'outlet').length;
  const pOutlets = powerRoutes.filter((r) => r.mark === 'outlet').length;

  const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const roomList = (list) => list.map((r) => kv(r.name, area2(r.areaM2))).join('');

  $('info-content').innerHTML = `
    <section class="info-sec">
      <h3>Außenmaße &amp; Flächen</h3>
      ${kv('Außenmaße', `${m2(dims.outer.lengthM)} × ${m2(dims.outer.widthM)}`)}
      ${kv('BGF je Geschoss', area2(dims.outer.bgfPerFloorM2))}
      ${kv('EG Innenfläche', area2(egArea))}
      ${kv('OG ohne Treppenloch', area2(ogArea))}
      ${kv('Treppenloch OG', area2(stairHole))}
      ${kv('Firsthöhe ab OKFF EG', m2(HOUSE_SPEC.heights.ridgeTopY))}
      ${kv('Dachneigung', `${NF1.format(HOUSE_SPEC.roof.pitchDeg)}° Satteldach`)}
      <p class="info-note">Modellabgeleitete Entwurfsflächen (keine WoFlV-Berechnung). B-Plan-Regeln: Hochformat ≥ 1,25, Pfeiler ≥ 0,24 m, Öffnungen &lt; 50 %.</p>
    </section>

    <section class="info-sec">
      <h3>Räume Erdgeschoss (${area2(egArea)})</h3>
      ${roomList(egRooms)}
    </section>

    <section class="info-sec">
      <h3>Räume Obergeschoss (${area2(ogArea)})</h3>
      ${roomList(ogRooms)}
    </section>

    <section class="info-sec">
      <h3>Haustechnik (Entwurf)</h3>
      ${kv('Trinkwasser (W)', `${waterRoutes.length} Trassen · ${wOutlets} Abgänge`)}
      ${kv('Strom (E)', `${powerRoutes.length} Trassen · ${pOutlets} Abgänge`)}
      <p class="info-note">Leitungen direkt unten im 3D-Modell (W / E) oder im 2D-Grundriss schaltbar. Übergabepunkte enden an der Straßengrenze Flst. 214.</p>
    </section>

    <section class="info-sec">
      <h3>Downloads</h3>
      <div class="dl-row">
        <a href="./blender/haus.glb" download="Wohnhaus-214.glb">3D-Modell (.glb)</a>
        <a href="./blender/Wohnhaus-214.blend" download="Wohnhaus-214.blend">Blender (.blend)</a>
        <a href="./Hausentwurf-Wattenheim.pdf" target="_blank" rel="noopener">Planheft (PDF)</a>
      </div>
    </section>

    <section class="info-sec">
      <h3>Tastaturkürzel</h3>
      <ul class="keys-list">
        <li><kbd>1</kbd>–<kbd>4</kbd> Dach / OG / EG / Schnitt</li>
        <li><kbd>W</kbd> / <kbd>E</kbd> Trinkwasser / Strom</li>
        <li><kbd>L</kbd> Grundriss &amp; Schnitt · <kbd>R</kbd> Kamera</li>
      </ul>
    </section>
  `;
}

// ---------------------------------------------------------------- 2D Plan Dialog
async function renderPlanTab(tab) {
  state.planTab = tab;
  document.querySelectorAll('#plan-dialog [data-ptab]').forEach((b) => {
    const on = b.dataset.ptab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  syncUI();
  const gen = ++planReqGen;
  if (!planMod) {
    $('plan-stage').innerHTML = '<p class="plan-loading">Grundriss- und Schnittzeichnung wird geladen …</p>';
    planMod = await import('./house/plan2d.js');
  }
  if (gen !== planReqGen) return;

  const dims = deriveDimensions(HOUSE_SPEC);
  let svgHtml = '';
  if (tab === 'eg' || tab === 'og' || tab === 'dach') {
    svgHtml = planMod.renderFloorPlanSvg(HOUSE_SPEC, tab, { dimensions: dims });
  } else {
    const axis = tab === 'section-long' ? 'long' : 'cross';
    svgHtml = planMod.renderSectionSvg(HOUSE_SPEC, { plinthBottomLocalY: -PLINTH_DEPTH }, { axis, dimensions: dims });
  }

  if ((tab === 'eg' || tab === 'og') && (state.services.water || state.services.power || state.sketch)) {
    const [{ servicePlanMarkup }, { referenceMarkup }] = await Promise.all([
      import('./house/services-plan.js'),
      import('./house/sketch-overlay.js'),
    ]);
    if (gen !== planReqGen) return;
    const extra =
      (state.sketch ? referenceMarkup(tab, HOUSE_SPEC.footprint) : '') +
      servicePlanMarkup(servicesDesign, tab, state.services);
    svgHtml = svgHtml.replace('</svg>', extra + '</svg>');
  }

  $('plan-stage').innerHTML = svgHtml;

  const bp = HOUSE_SPEC.bplanCheck;
  const facadeRows = bp.facades
    .map(
      (f) => `<tr>
      <td>${esc(f.label)}</td>
      <td>${f.openingCount}</td>
      <td>${NF1.format(f.openingSharePct)} %</td>
      <td>${f.minRatioHB != null ? NF2.format(f.minRatioHB) : '–'}</td>
      <td>${f.minPierM != null ? m2(f.minPierM) : '–'}</td>
    </tr>`
    )
    .join('');

  $('plan-meta').innerHTML = `
    <div class="plan-grid">
      <section>
        <h3>Maße &amp; Flächen</h3>
        <ul>
          <li><b>Außenmaße:</b> ${m2(dims.outer.lengthM)} × ${m2(dims.outer.widthM)} · BGF ${area2(dims.outer.bgfPerFloorM2)}/Gesch.</li>
          <li><b>Innenflächen:</b> EG ${area2(HOUSE_SPEC.levels.eg.netAreaM2)} · OG ${area2(HOUSE_SPEC.levels.og.netAreaWithoutStairOpeningM2)} (+ ${area2(HOUSE_SPEC.levels.og.stairOpeningAreaM2)} Treppenloch)</li>
          <li><b>U-Treppe EG ↔ OG:</b> ${dims.stairs.risers} Steigungen · Schrittmaß ${NF1.format(dims.stairs.stepFormulaCm)} cm (DIN OK)</li>
          <li><b>Höhen ab OKFF EG:</b> Wand-Traufe ${m2(HOUSE_SPEC.heights.eaveWallY)} · First ${m2(HOUSE_SPEC.heights.ridgeTopY)} (Satteldach ${NF1.format(bp.roofPitchDeg)}°)</li>
        </ul>
      </section>
      <section>
        <h3>Fassadenbilanz (B-Plan Wattenheim „Ortskern“)</h3>
        <table class="plan-tbl">
          <thead><tr><th>Fassade</th><th>Öffn.</th><th>Anteil (&lt;50%)</th><th>min H/B</th><th>Pfeiler</th></tr></thead>
          <tbody>${facadeRows}</tbody>
        </table>
      </section>
    </div>
  `;
}

function openPlanDialog(tab = state.planTab) {
  const dlg = $('plan-dialog');
  if (!dlg.open) dlg.showModal();
  renderPlanTab(tab);
}

// ---------------------------------------------------------------- 360° Blender Tour
async function openTourDialog(room = 'eg') {
  try {
    const { openTour } = await import('./house/tour.js');
    openTour(room, (mode) => {
      setMode(mode);
      if (mode === 'eg' || mode === 'og') setPreset('top');
      else setPreset('garden');
    });
  } catch (err) {
    console.error('360°-Tour konnte nicht geladen werden:', err);
    showToast('360°-Innenräume konnten nicht geladen werden.');
  }
}

// ---------------------------------------------------------------- Hash Routing
function applyHash(instant = false) {
  const h = location.hash.toLowerCase();
  if (!h) return;
  if ($('blender-dialog')?.open && !['#innen', '#innen-og', '#aussen', '#blender'].includes(h)) {
    $('blender-dialog').close();
  }
  if ($('plan-dialog').open && h !== '#grundriss') {
    $('plan-dialog').close();
  }
  if (h === '#eg') {
    setMode('eg');
    setPreset('top', instant);
  } else if (h === '#og') {
    setMode('og');
    setPreset('top', instant);
  } else if (h === '#schnitt') {
    setMode('cutaway');
    setPreset('cutaway', instant);
  } else if (h === '#leitungen') {
    setMode('cutaway');
    setServices({ water: true, power: true });
    setPreset('cutaway', instant);
  } else if (h === '#grundriss') {
    openPlanDialog('eg');
  } else if (h === '#innen') {
    openTourDialog('eg');
  } else if (h === '#innen-og') {
    openTourDialog('og');
  } else if (h === '#aussen' || h === '#blender') {
    openTourDialog('aussen');
  }
}

// ---------------------------------------------------------------- Lightweight Site Parcel for 2D Service Boundary
async function refineParcelServices() {
  try {
    const res = await fetch('./scene/scene.json');
    if (!res.ok) return;
    const cfg = await res.json();
    const parcel = cfg.boundaries?.find((b) => b.name === 'Flurstück 214');
    if (!parcel?.points?.length) return;
    const placement = computeSitePlacement(cfg, null, HOUSE_SPEC, cfg.sewer?.corridor_m ?? 2.0, OFFICIAL_BAUGRENZE);
    const { length, width } = HOUSE_SPEC.footprint;
    const outline = parcel.points.map(([x, , z]) => {
      const [u, v] = placement.transform.toLocalXZ(x, z);
      return [u + length / 2, v + width / 2];
    });
    servicesDesign = designServices(HOUSE_SPEC, outline);
    renderInfoPanel();
    if ($('plan-dialog').open) renderPlanTab(state.planTab);
  } catch {
    // Fallback rectangle remains active cleanly
  }
}

// ---------------------------------------------------------------- Load Blender GLB (Fallback: createHouse3D)
const loadAc = new AbortController();

async function loadModel() {
  try {
    const detail = await loadBlenderHouse('./', loadAc.signal);
    if (loadAc.signal.aborted) {
      detail.dispose();
      return;
    }
    activeModel = detail;
    modelKind = 'blender';
    houseRoot.add(detail.group);
    detail.setMode(state.mode);
    detail.setServices(state.services);
    $('loader').hidden = true;
    syncUI();
    requestRender();
  } catch (err) {
    if (loadAc.signal.aborted) return;
    console.warn('Blender-GLB nicht ladbar, nutze Basismodell:', err);
    try {
      const { createHouse3D } = await import('./house/model3d.js');
      const fallback = createHouse3D(HOUSE_SPEC, { plinthDepth: PLINTH_DEPTH, services: servicesDesign });
      fallback.group.traverse((o) => {
        if (!o.isMesh || o.material.transparent) return;
        o.castShadow = !o.isInstancedMesh && !o.userData?.service;
        o.receiveShadow = !o.userData?.service;
      });
      activeModel = fallback;
      modelKind = 'fallback';
      houseRoot.add(fallback.group);
      fallback.setMode(state.mode);
      fallback.setServices(state.services);
      $('loader').hidden = true;
      showToast('Blender-Modell nicht verfügbar – 3D-Basismodell geladen.');
      syncUI();
      requestRender();
    } catch (fbErr) {
      console.error('Hausmodell konnte nicht geladen werden:', fbErr);
      $('loader-title').textContent = '3D-Modell konnte nicht geladen werden.';
      $('loader-sub').textContent = String(fbErr?.message || fbErr);
    }
  }
}

// ---------------------------------------------------------------- Events
document.querySelectorAll('.mode-btn').forEach((b) => {
  b.addEventListener('click', () => {
    const mode = b.dataset.mode;
    setMode(mode);
    if (mode === 'cutaway') setPreset('cutaway');
    else if (mode === 'eg' || mode === 'og') setPreset('top');
  });
});

document.querySelectorAll('.svc-btn').forEach((b) => {
  b.addEventListener('click', () => {
    const key = b.dataset.service;
    setServices({ [key]: !state.services[key] });
  });
});

document.querySelectorAll('.cam-btn').forEach((b) => {
  b.addEventListener('click', () => setPreset(b.dataset.cam));
});

$('btn-tour').addEventListener('click', () => openTourDialog(state.mode === 'og' ? 'og' : 'eg'));
$('btn-plan').addEventListener('click', () => openPlanDialog(state.mode === 'og' ? 'og' : 'eg'));
$('btn-info').addEventListener('click', () => setInfoOpen(!state.infoOpen));
$('btn-info-close').addEventListener('click', () => setInfoOpen(false));

document.querySelectorAll('#plan-dialog [data-ptab]').forEach((b) => {
  b.addEventListener('click', () => renderPlanTab(b.dataset.ptab));
});
document.querySelectorAll('[data-plan-service]').forEach((el) => {
  el.addEventListener('change', () => setServices({ [el.dataset.planService]: el.checked }));
});
$('sketch-switch').addEventListener('change', (e) => {
  state.sketch = e.target.checked;
  syncUI();
  if ($('plan-dialog').open) renderPlanTab(state.planTab);
});
$('plan-zoom').addEventListener('click', () => {
  const zoomed = $('plan-stage').classList.toggle('zoomed');
  $('plan-zoom').setAttribute('aria-pressed', String(zoomed));
  $('plan-zoom').textContent = zoomed ? 'Ganze Zeichnung' : 'Zeichnung vergrößern';
});
$('plan-close').addEventListener('click', () => $('plan-dialog').close());
$('plan-dialog').addEventListener('click', (e) => {
  if (e.target === $('plan-dialog')) $('plan-dialog').close();
});

window.addEventListener('hashchange', () => applyHash(false));

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]') || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === '1') setMode('full');
  else if (k === '2') { setMode('og'); setPreset('top'); }
  else if (k === '3') { setMode('eg'); setPreset('top'); }
  else if (k === '4') { setMode('cutaway'); setPreset('cutaway'); }
  else if (k === 'w') setServices({ water: !state.services.water });
  else if (k === 'e') setServices({ power: !state.services.power });
  else if (k === 'l') openPlanDialog(state.mode === 'og' ? 'og' : 'eg');
  else if (k === 'r') setPreset(state.mode === 'cutaway' ? 'cutaway' : 'garden');
});

window.addEventListener('beforeunload', () => {
  loadAc.abort();
  activeModel?.dispose?.();
  studioLight?.dispose?.();
  skyTex?.dispose?.();
  renderer.dispose();
});

window.__haus = {
  THREE,
  scene,
  camera,
  controls,
  renderer,
  state,
  get model() { return activeModel; },
  get modelKind() { return modelKind; },
  get servicesDesign() { return servicesDesign; },
  setMode,
  setServices,
  setPreset,
  openPlanDialog,
  openTourDialog,
};

renderInfoPanel();
syncUI();
setPreset('garden', true);
applyHash(true);
loadModel();
refineParcelServices();
