// Einstieg: 2D-Karte sofort, 3D (three/Spark) erst auf Wunsch per dynamischem Import.
// Ansichtsunabhängige Oberfläche: Werkzeuge, Liste, Ebenen, Kalibrierung, Profil, Qualitätsmenü.
import { loadScene } from './scene.js';
import { loadGround } from './ground.js';
import { MapView2D } from './map2d.js';
import { Overlay } from './overlay.js';
import { MeasureStore, evaluate, fmtLen, fmtFactor, dist } from './measure.js';
import { HeightProfile } from './profile.js';
import { Quality } from './quality.js';
import { snapAt, unifyPlanHeights } from './snap.js';
import { COLORS, NF1, INT, MB } from './format.js';

const BASE = import.meta.env.BASE_URL;
const PATH = new URL(BASE, location.href).pathname;
const $ = (id) => document.getElementById(id);
const app = $('app');
const coarse = matchMedia('(pointer: coarse)').matches;
const WALL_H = 2.5; // Höhe der Hilfswände an Gebäudeumrissen in 3D (nicht aus dem Plan)
// Plan-Punkte tragen nur geschätzte Höhen und liegen im Planmaßstab: bei „Höhe“ und „Maßstab“ nicht einrasten
const SNAP_TOOLS = new Set(['dist', 'area']);
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const NO_WEBGL = '3D ist auf diesem Gerät nicht verfügbar (kein WebGL 2)';

const stats = { renders: 0, overlayBuilds: 0, frames2d: 0, firstMap: 0 };
const store = new MeasureStore();
const state = {
  tool: 'nav',
  draft: null,         // { type, points: [[x,y,z]...], src: [...], hover: [x,y,z] | null }
  selected: null,
  dirty: true,
  view: '2d',
  marker: null,        // Stelle, auf die das Höhenprofil gerade zeigt
  profileClosed: null, // Messung, deren Profil der Nutzer weggeklickt hat
  showBounds: true,
  showBuildings: true,
  showSewer: true,
  showBaugrenze: true,
  showHouse: true,
  houseIsolated: false,
  planLayers: { water: false, power: false, sketch: false },
  houseMode: 'full',   // full | og | eg | cutaway
  planTab: 'eg',       // eg | og | dach | section-cross | section-long
  corridor: 2,         // angenommener Schutzstreifen je Seite in m
  pickState: 'idle',   // 3D-Picker: idle | preparing | ready | failed
  pickError: null,
  tier3d: null,        // geladene Stufe in 3D
};
let cfg, ground, groundP, overlay, profile, map2d, quality, view;
let viewMod = null, loading = null;
let houseCtrl = null, houseModP = null;
const storageProblems = new Map();

// ---------------------------------------------------------------- Anzeige
let toastTimer = 0, mapIntroTimer = null;
function dismissMapIntro() {
  if (mapIntroTimer === toastTimer) $('toast').classList.remove('show');
}
function toast(text, ms = 2600, warn = false, action = null) {
  const el = $('toast'), btn = $('toast-act');
  $('toast-text').textContent = text;
  btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = () => { el.classList.remove('show'); action.fn(); }; }
  el.classList.toggle('warn', warn);
  el.classList.toggle('act', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function showFatal(title, detail) {
  $('fatal-title').textContent = title;
  $('fatal-text').textContent = detail;
  $('fatal').hidden = false;
}
$('fatal-reload').addEventListener('click', () => location.reload());

// Dauerhinweis im Panel, wenn der Browser nichts speichern kann
function storageProblem(kind, err, text) {
  console.error(`Speicher (${kind}):`, err);
  storageProblems.set(kind, text);
  const el = $('storage-note');
  el.textContent = [...storageProblems.values()].join(' ');
  el.hidden = false;
}
store.onStorageError = (err, action) => storageProblem('messungen', err, `Messungen werden in diesem Browser nicht gespeichert: ${err.name} (beim ${action === 'lesen' ? 'Lesen' : action === 'sichern' ? 'Sichern' : 'Schreiben'}).`);

function markDirty() {
  state.dirty = true;
  view?.requestOverlay();
}

// ---------------------------------------------------------------- Start
async function main() {
  try {
    cfg = await loadScene(BASE);
  } catch (err) {
    console.error(err);
    if (err.name === 'SceneError') showFatal('Die Szenenbeschreibung ist fehlerhaft.', err.message);
    else showFatal('Die Szenenbeschreibung konnte nicht geladen werden.', err.message);
    return;
  }
  // Eine Höhe je Planpunkt für Einrasten und Zeichnen (Regel in snap.js, README „Maßstab, Grenzen und Kanal“)
  const plan = unifyPlanHeights(cfg);
  if (plan.merged) console.info(`Planpunkte: ${plan.merged} mehrfach eingetragene Ecken auf eine Höhe gebracht (größte Abweichung ${plan.maxSpread.toFixed(3)} m, ${plan.lineVerts} Linienpunkte angepasst).`);
  $('title').textContent = cfg.title;
  $('subtitle').textContent = cfg.subtitle;
  document.title = `${cfg.title} – Karte und 3D-Begehung`;
  // Bodenmodell und gröbste Kachel parallel laden: Die Karte braucht ground erst beim ersten
  // Messpunkt (pickAt/Profil warten darauf). Ein Fehler bleibt ein Vollbild-Fehler.
  groundP = loadGround(cfg, BASE).then((g) => { ground = g; return g; });
  groundP.catch((err) => {
    console.error(err);
    showFatal('Das Bodenmodell der Karte konnte nicht geladen werden.', err.message);
  });
  state.corridor = cfg.sewer.corridor_m;
  overlay = new Overlay($('overlay'), $('labels'));
  overlay.setStatic({ boundaries: cfg.boundaries, buildings: cfg.buildings, sewer: cfg.sewer, wallH: WALL_H });
  overlay.setCorridor(state.corridor);
  profile = new HeightProfile({
    card: $('profile'), svg: $('profile-svg'), info: $('profile-info'), title: $('profile-title'),
    onMarker: (p) => { state.marker = p; markDirty(); },
  });
  map2d = new MapView2D({
    host: $('map'), tilesEl: $('tiles'), cfg, base: BASE, ground: groundP, stats,
    hooks: {
      onFrame: drawOverlay, onFirstMap: detectDeviceLater, onTap, onDouble, onHover, onLeave, toast, fitPad,
      onResize: (w, h) => overlay.setSize(w, h),
      setOverlayTransform: (tf) => { $('overlay').style.transform = tf; $('labels').style.transform = tf; },
      gestureLayers: () => [$('overlay'), $('labels')],
    },
  });
  view = map2d;
  renderBounds();
  renderGroundText();

  // Hausentwurf, blaue Baugrenze und Live-Konfliktprüfung parallel nachladen (hält Start-Chunk ≤ 45 KB gzip)
  houseModP = Promise.all([import('./house-controller.js'), groundP]).then(([{ HouseController }, g]) => {
    houseCtrl = new HouseController(cfg, g);
    houseCtrl.recompute(state.corridor);
    overlay.setBaugrenze(houseCtrl.baugrenzeOverlay);
    overlay.setHouse(houseCtrl.getOverlayData(state.houseMode));
    $('btn-house').hidden = false;
    $('house-bar').hidden = false;
    $('house-box').hidden = false;
    renderHousePanel();
    syncHouseControls();
    if (view?.kind === '3d') {
      view.setHouse({ ...houseCtrl.get3DConfig(), visible: state.showHouse, mode: state.houseMode, isolated: state.houseIsolated, services: state.planLayers });
    }
    const { length: hL, width: hW } = houseCtrl.spec.footprint;
    const fmtFoot = `${hL.toFixed(2).replace('.', ',')} × ${hW.toFixed(2).replace('.', ',')} m`;
    const planSub = document.querySelector('#plan-dialog .plan-sub');
    if (planSub) planSub.textContent = `Modellabgeleitete Maße (${fmtFoot}) · Flurstück 214 · Entwurf, keine baurechtliche Zusicherung`;
    const sketchExp = $('sketch-explain');
    if (sketchExp) sketchExp.textContent = `Magenta zeigt die von Hand nachgezeichneten Linien der jeweiligen Fotovorlage. Jede Skizze ist an den vier Außenecken auf ${fmtFoot} eingepasst. Die Gebäudetiefe ist ein Entwurfsmaß.`;
    markDirty();
    return houseCtrl;
  }).catch((err) => {
    console.error('Hausentwurf konnte nicht geladen werden:', err);
    toast(`Hausentwurf konnte nicht geladen werden: ${err.message}`, 5000, true);
    return null;
  });

  const report = store.restore({ pathname: PATH, frame: cfg.frame, legacyIds: cfg.storage.legacy_ids });
  const msgs = [];
  if (report.migrated) msgs.push('Messungen aus der bisherigen Version übernommen.');
  if (report.broken.length) {
    const n = (kind) => report.broken.filter((x) => x.kind === kind).length;
    const parts = [];
    if (n('daten')) parts.push('Die gespeicherten Messungen waren unlesbar und wurden nicht geladen');
    if (n('messung')) parts.push(n('messung') === 1 ? '1 gespeicherte Messung war unlesbar und wurde nicht geladen'
      : `${n('messung')} gespeicherte Messungen waren unlesbar und wurden nicht geladen`);
    if (n('kalibrierung')) parts.push(n('kalibrierung') === 1 ? 'Die gespeicherte Kalibrierung war unlesbar und wurde nicht übernommen'
      : `${n('kalibrierung')} gespeicherte Kalibrierungen waren unlesbar und wurden nicht übernommen`);
    msgs.push(parts.join('; ') + (report.backupKey ? ` (Sicherung unter „${report.backupKey}“).` : ' (Sicherung nicht möglich).'));
  }

  quality = new Quality(cfg, PATH);
  quality.restore();
  if (quality.storageError) storageProblem('qualitaet', quality.storageError, `Die Qualitätswahl wird nicht gespeichert: ${quality.storageError.name} – es gilt „Automatisch“.`);
  if (quality.warning) msgs.push(quality.warning);
  const forced = new URLSearchParams(location.search).get('tier');
  if (forced !== null) {
    const t = cfg.splats.tiers.find((x) => x.id === forced);
    if (t) quality.forced = t;
    else {
      const e = new Error(`Unbekannte Qualitätsstufe „${forced}“ in ?tier= (vorhanden: ${cfg.splats.tiers.map((x) => x.id).join(', ')})`);
      console.error(e);
      state.tierError = e.message;
      msgs.push(e.message);
    }
  }
  renderQuality();
  setTool('nav');
  showPanel(wideLayout());
  updateStatus();
  if (msgs.length) toast(msgs.join(' '), 9000, report.broken.length > 0 || !!quality.warning || !!state.tierError);
  else {
    let seen = false;
    try {
      seen = !!sessionStorage.getItem('grundstueck-viewer:seen');
      sessionStorage.setItem('grundstueck-viewer:seen', '1');
    } catch (err) {
      storageProblem('sitzung', err, `Der Browser erlaubt keinen Sitzungsspeicher (${err.name}).`);
    }
    if (!seen && !location.hash) {
      toast(coarse ? 'Karte: ein Finger verschiebt, zwei Finger zoomen. Unten ein Messwerkzeug wählen; „3D laden“ öffnet das Modell.'
        : 'Karte: Ziehen verschiebt, Mausrad zoomt. „3D laden“ (V) öffnet das Modell.', 5200);
      mapIntroTimer = toastTimer;
    }
  }
  window.__app = {
    state, get view() { return view; }, store, stats, quality, cfg, get ground() { return ground; },
    get houseCtrl() { return houseCtrl; }, open3d, close3d, setTier: chooseQuality, overlay,
    setHouseMode, setHouseServices, focusHouse, openPlanDialog,
  };
  await followHouseLink();
}

async function followHouseLink() {
  const hash = location.hash;
  if (hash && !tourHash() && $('blender-dialog')?.open) $('blender-dialog').close();
  if ((tourHash() || hash.startsWith('#haus')) && $('plan-dialog').open) $('plan-dialog').close();
  if (['#leitungen', '#leitungen-og', '#planabgleich', '#planabgleich-og'].includes(location.hash)) {
    const plumbing = location.hash.startsWith('#leitungen');
    Object.assign(state.planLayers, { water: plumbing, power: plumbing, sketch: !plumbing });
    if (view?.kind === '3d') view.setHouseServices?.(state.planLayers);
    openPlanDialog(location.hash.endsWith('-og') ? 'og' : 'eg');
  } else if (tourHash()) {
    await openBlenderTour(tourHash());
  } else if (['#haus', '#haus-eg', '#haus-og', '#haus-isoliert'].includes(location.hash) && await houseModP) {
    if (location.hash !== '#haus') {
      setHouseMode(location.hash === '#haus-og' ? 'og' : location.hash === '#haus-eg' ? 'eg' : 'full');
      state.houseIsolated = true;
    }
    await open3d();
    if (view.kind === '3d') {
      for (const [key, button] of [['showBounds', 'btn-bounds'], ['showBuildings', 'btn-buildings'], ['showSewer', 'btn-sewer']]) {
        if (state[key]) toggleLayer(key, button);
      }
      if (state.showBaugrenze) toggleBaugrenze();
      showPanel(false);
      $('toast').classList.remove('show');
    }
    focusHouse(true);
  }
}

// Ränder für den Startausschnitt der Karte. Auf schmalen Bildschirmen liegt die Hinweisleiste
// über der Werkzeugleiste und wird beim Messen zweizeilig (Rückgängig/Abbrechen): Darunter darf
// nichts vom Startausschnitt liegen, sonst trifft ein Tipp dort die Leiste statt der Karte.
const HINT_RESERVE = 96; // zweizeilige Hinweisleiste mit Knöpfen (Touch) plus Abstand, gemessen bei 375 px
function fitPad() {
  if (wideLayout()) return {};
  const host = $('map').getBoundingClientRect();
  // MapView2D ruft fitPad nur mit echter Kartengröße auf (Größe 0 wartet auf den ResizeObserver).
  if (!host.height) throw new Error('fitPad ohne Kartengröße aufgerufen – MapView2D muss auf das erste Layout warten');
  const hintBottom = parseFloat(getComputedStyle($('hint')).bottom);
  if (!Number.isFinite(hintBottom)) throw new Error(`fitPad: Lage der Hinweisleiste unlesbar (${getComputedStyle($('hint')).bottom})`);
  const barBottom = $('house-bar').hidden ? 0 : $('house-bar').getBoundingClientRect().bottom;
  const top = Math.max(document.querySelector('.topbar').getBoundingClientRect().bottom, barBottom) - host.top + 10;
  return { top, bottom: hintBottom + HINT_RESERVE };
}

// ---------------------------------------------------------------- Overlay
function drawOverlay() {
  if (!overlay) return;
  const draft = state.draft && (state.draft.points.length || state.draft.hover) ? { ...state.draft, draft: true } : null;
  let grid = null;
  if (view.kind === '2d') {
    grid = { step0: cfg.map.grid_m, extent: cfg.map.extent, image: cfg.map.image.bounds, view: view.visibleRect() };
  }
  const isolated = !!view.houseIsolated;
  overlay.render({
    k: store.k, selectedId: state.selected, showBounds: !isolated && state.showBounds, showBuildings: !isolated && state.showBuildings,
    showSewer: !isolated && state.showSewer, showBaugrenze: !isolated && state.showBaugrenze, showHouse: !isolated && state.showHouse,
    services: !isolated && state.showHouse && (state.planLayers.water || state.planLayers.power) ? state.planLayers : null,
    items: isolated ? store.items.filter(it => it.src.every(source => source === 'h')) : store.items, draft, marker: state.marker, grid,
  }, view.proj);
  stats.overlayBuilds++;
  state.dirty = false;
  updateScaleBar();
}

// Die Maßstabsleiste: in 2D exakt, in 3D für die Oberfläche in der Bildmitte
const NICE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
function updateScaleBar() {
  const mPerPx = view.metersPerPixel() * store.k;
  let L = NICE[NICE.length - 1];
  for (const v of NICE) { if (v / mPerPx >= 56) { L = v; break; } }
  const el = $('scalebar');
  el.firstElementChild.style.width = `${Math.min(220, L / mPerPx).toFixed(0)}px`;
  el.lastElementChild.textContent = L < 1 ? `${Math.round(L * 100)} cm` : `${NF1.format(L).replace(',0', '')} m`;
}
function updateStatus() {
  if (state.view === '2d') $('status').textContent = '2D-Karte';
}

// ---------------------------------------------------------------- Werkzeuge
const HINTS = {
  dist: ['Ersten Punkt der Strecke antippen', 'Zweiten Punkt antippen'],
  height: ['Ersten Punkt antippen (z. B. am Boden)', 'Zweiten Punkt antippen (z. B. Oberkante)'],
  calib: ['Anfang einer bekannten Strecke antippen (z. B. eine Wegkante)', 'Ende der Strecke antippen (gegenüberliegende Wegkante)'],
};
let hoverGen = 0, hoverNext = null, hoverBusy = false;
function invalidateHover() { hoverGen++; hoverNext = null; }
const newDraft = (type) => ({ type, points: [], src: [], hover: null });

function undoPoint() {
  if (!state.draft?.points.length) return;
  state.draft.points.pop();
  state.draft.src.pop();
  state.draft.hover = null;
  invalidateHover();
  updateHint();
  markDirty();
}
function cancelDraft() {
  if (!state.draft) return;
  state.draft.points = [];
  state.draft.src = [];
  state.draft.hover = null;
  invalidateHover();
  updateHint();
  markDirty();
}
const measureBlocked = () => state.view === '3d' && !view.houseIsolated && state.pickState === 'failed';
function updateHint() {
  const el = $('hint');
  const d = state.draft;
  const n = d?.points.length || 0;
  let html = '';
  let err = false;
  if (state.tool !== 'nav' && state.view === '3d' && !view.houseIsolated && state.pickState === 'failed') {
    html = `<span>Messen in 3D nicht möglich: ${escapeHtml(state.pickError)}. In der 2D-Karte messen.</span><button data-act="to2d">Zur 2D-Karte</button>`;
    err = true;
  } else if (state.tool !== 'nav' && state.view === '3d' && !view.houseIsolated && state.pickState === 'preparing') {
    html = '<span>Messwerkzeug wird vorbereitet …</span>';
  } else if (state.tool === 'area') {
    if (n === 0) html = 'Eckpunkte der Fläche nacheinander antippen';
    else if (n < 3) html = `<span>${n} von mindestens 3 Eckpunkten gesetzt</span>`;
    else html = `<span>${n} Eckpunkte</span><button class="go" data-act="finish">Fläche schließen</button>`;
  } else if (HINTS[state.tool]) {
    html = `<span>${HINTS[state.tool][Math.min(n, 1)]}</span>`;
  }
  if (n > 0 && !err) html += '<button data-act="undo">Rückgängig</button><button data-act="cancel">Abbrechen</button>';
  el.innerHTML = html;
  el.classList.toggle('show', !!html);
  el.classList.toggle('action', n > 0 || err);
  el.classList.toggle('error', err);
  // Der schwebende Ansichtsknopf (schmale Bildschirme) steht über der Hinweisleiste – deren
  // Höhe hängt vom Umbruch ab, daher als CSS-Variable statt fester Zahl.
  app.style.setProperty('--hint-h', `${el.offsetHeight}px`);
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('hint').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'finish') queue(finishArea);
  else if (act === 'undo') undoPoint();
  else if (act === 'cancel') cancelDraft();
  else if (act === 'to2d') close3d();
});

function updateToolbar() {
  document.querySelectorAll('.toolbar button').forEach((b) => {
    const on = b.dataset.tool === state.tool;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    const blocked = b.dataset.tool !== 'nav' && measureBlocked();
    b.setAttribute('aria-disabled', String(blocked));
    b.classList.toggle('disabled', blocked);
  });
}
function setTool(tool) {
  state.tool = tool;
  state.draft = tool === 'nav' ? null : newDraft(tool);
  invalidateHover();
  app.dataset.tool = tool;
  updateToolbar();
  // Auf schmalen Bildschirmen würde die Liste Hinweis und Schaltflächen verdecken
  if (tool !== 'nav' && !wideLayout()) showPanel(false);
  if (tool !== 'nav' && view?.kind === '3d') view.warmPicker();
  updateHint();
  markDirty();
}
document.querySelectorAll('.toolbar button').forEach((b) => b.addEventListener('click', () => {
  if (b.getAttribute('aria-disabled') === 'true') { toast(`Messen in 3D nicht möglich: ${state.pickError}. In der 2D-Karte messen.`, 4000, true); return; }
  setTool(b.dataset.tool);
}));

function select(id) {
  state.selected = id;
  state.profileClosed = null;
  renderList();
}

// Höhenprofil gehört zur angewählten Strecke (oder Höhenmessung)
function syncProfile(force = false) {
  if (!profile) return;
  if (force) profile.key = null;
  const it = store.items.find((i) => i.id === state.selected);
  const longEnough = it && it.points.length >= 2
    && Math.hypot(it.points[1][0] - it.points[0][0], it.points[1][2] - it.points[0][2]) * store.k >= 0.5;
  if (it && longEnough && (!view.houseIsolated || it.src.every(source => source === 'h')) && !measureBlocked() && (it.type === 'dist' || it.type === 'height') && state.profileClosed !== it.id) {
    profile.show(it, store.k, view.houseIsolated ? view.houseSampler : view.sampler);
  } else {
    profile.hide();
  }
}
$('profile-close').addEventListener('click', () => { state.profileClosed = state.selected; profile.hide(); });

// Klicks werden nacheinander abgearbeitet, weil das Picking asynchron ist.
let chain = Promise.resolve();
function queue(fn) {
  chain = chain.then(fn).catch((e) => { console.error(e); toast(`Fehler: ${e.message}`, 5000, true); });
  return chain;
}

function snapLayers() {
  if (view.houseIsolated) return {};
  return {
    buildings: state.showBuildings ? cfg.buildings : null,
    boundaries: state.showBounds ? cfg.boundaries : null,
    manholes: state.showSewer ? cfg.sewer.manholes : null,
  };
}
function overlayXY(x, y) { const r = $('overlay').getBoundingClientRect(); return [x - r.left, y - r.top]; }

function onTap(x, y, touch, alt) { queue(() => handleClick(x, y, touch, alt)); }
function onDouble(x, y) {
  if (state.tool === 'area') { queue(finishArea); return; }
  if (state.tool === 'nav') queue(() => view.doubleAt(x, y));
}

async function handleClick(x, y, touch = false, noSnap = false) {
  if (state.tool === 'nav' || !state.draft) return;
  if (measureBlocked()) { toast(`Messen in 3D nicht möglich: ${state.pickError}. In der 2D-Karte messen.`, 4000, true); return; }
  const draft = state.draft;
  const [sx, sy] = overlayXY(x, y);
  let snap = !noSnap && SNAP_TOOLS.has(state.tool) ? snapAt(view.proj, snapLayers(), sx, sy, touch) : null;
  const lastPt = draft.points[draft.points.length - 1];
  if (snap && lastPt && dist(lastPt, snap) < 1e-4) snap = null; // derselbe Planpunkt noch einmal: Oberfläche nehmen
  const v = view;
  let hit;
  if (snap) hit = { point: snap.slice(), src: 'p' };
  else {
    try {
      hit = await v.pickAt(x, y, { multi: true, touch });
    } catch (err) {
      // Die Ansicht wurde während der Punktbestimmung gewechselt oder freigegeben: Punkt verwerfen, sagen warum
      if (view !== v) { console.error(err); toast('Punkt verworfen – die Ansicht wurde während der Messung gewechselt.', 3600, true); return; }
      throw err;
    }
  }
  if (view !== v) { toast('Punkt verworfen – die Ansicht wurde während der Messung gewechselt.', 3600, true); return; }
  if (state.draft !== draft) return; // Werkzeug wurde inzwischen gewechselt
  if (hit.error) { toast(hit.error, 3600, true); return; }
  const p = hit.point;
  const d = draft;
  if (d.points.length && dist(d.points[d.points.length - 1], p) < 1e-4) return;
  d.points.push(p);
  d.src.push(hit.src);
  d.hover = null;
  invalidateHover();
  if (hit.src === 'p') {
    toast('Auf Planpunkt eingerastet (Höhe dort nur geschätzt).', 1800);
  } else if (hit.src === 'e') {
    toast('Höhe hier nur aus dem Plan geschätzt.', 2200);
  } else if (hit.src === 's') {
    // Warnen nur bei wirklich dünnen Stellen; halbtransparente Flächen sind bei echten Splats normal
    if (hit.opacity < 0.25 || (hit.spread != null && hit.spread > 0.6)) {
      toast('Unscharfe Stelle (Bewuchs oder Lücke) – der Punkt ist hier weniger genau.', 2800, true);
    } else if (hit.scatter > Math.max(0.35, 0.05 * hit.dist)) {
      toast('Flacher Blickwinkel – für genauere Maße näher heran oder steiler von oben antippen.', 2800, true);
    }
  }
  if ((d.type === 'dist' || d.type === 'height') && d.points.length === 2) {
    const item = store.add(d.type, d.points, d.src);
    state.draft = newDraft(d.type);
    select(item.id);
    // auf schmalen Bildschirmen erscheint das Höhenprofil erst beim Antippen der Messung in der Liste
    if (!wideLayout()) { state.profileClosed = item.id; syncProfile(); }
    showPanel(true, true);
  } else if (d.type === 'calib' && d.points.length === 2) {
    updateHint();
    markDirty();
    await askCalibration(d.points);
    if (state.draft === d) state.draft = newDraft('calib');
  }
  updateHint();
  markDirty();
}

async function finishArea() {
  const d = state.draft;
  if (!d || d.type !== 'area') return;
  if (d.points.length >= 3) {
    const item = store.add('area', d.points, d.src);
    state.draft = newDraft('area');
    invalidateHover();
    select(item.id);
    showPanel(true, true);
  } else {
    toast('Eine Fläche braucht mindestens drei Eckpunkte.', 2200, true);
  }
  updateHint();
  markDirty();
}

// Vorschau unter dem Mauszeiger (nur mit Maus; auf Touch-Geräten gibt es kein Hover)
function onHover(x, y, alt) {
  if (state.tool === 'nav' || !state.draft || measureBlocked()) return;
  if (view.kind === '3d' && !view.houseIsolated && state.pickState !== 'ready') { view.warmPicker(); return; }
  hoverNext = [x, y, alt];
  if (hoverBusy) return;
  hoverBusy = true;
  const hoverView = view, hoverMesh = view.mesh; // mesh: wechselt mit der Qualitätsstufe (neuer Picker)
  (async () => {
    try {
      while (hoverNext) {
        const [hx, hy, halt] = hoverNext; hoverNext = null;
        const gen = hoverGen, draft = state.draft;
        const [sx, sy] = overlayXY(hx, hy);
        const snap = !halt && SNAP_TOOLS.has(state.tool) ? snapAt(view.proj, snapLayers(), sx, sy) : null;
        const hit = snap ? { point: snap } : await view.pickAt(hx, hy, { multi: false });
        if (gen === hoverGen && draft && state.draft === draft) {
          draft.hoverSnap = !!snap;
          draft.hover = hit.error ? null : hit.point;
          markDirty();
        }
      }
    } catch (err) {
      // Erwartet: Ansicht gewechselt oder Picker freigegeben (Qualitätswechsel, 3D geschlossen) – dann ist
      // die Vorschau ohnehin hinfällig. Alles andere sichtbar melden.
      // Ein Ausfall des Pickers selbst meldet onPickState('failed') bereits in Hinweisleiste und Werkzeugen.
      if (view !== hoverView || view.mesh !== hoverMesh) console.info('Vorschau verworfen, die Ansicht wurde gewechselt:', err.message);
      else if (state.pickState === 'failed') console.error(err);
      else { console.error(err); toast(`Vorschau unter dem Mauszeiger fehlgeschlagen: ${err.message}`, 4000, true); }
    } finally { hoverBusy = false; }
  })();
}
function onLeave() {
  invalidateHover();
  if (state.draft?.hover) { state.draft.hover = null; markDirty(); }
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
  $('calib-text').textContent = cfg.calibration.text;
  const n = store.calibPairs.length;
  $('calib-user').hidden = n === 0;
  if (n) {
    $('calib-user-text').textContent = `Eigene Kalibrierung: Faktor ${fmtFactor(store.k)} (${n} Referenz${n > 1 ? 'en' : ''})`
      + ' – Planmaße (Grenzen, Gebäude, Kanal) und das Bodenmodell bleiben im Planmaßstab.';
  }
}

// ---------------------------------------------------------------- Grenzen, Gebäude, Kanal
const M1 = NF1;
function renderBounds() {
  const bounds = cfg.boundaries, buildings = cfg.buildings, sw = cfg.sewer;
  const own = bounds.filter((b) => b.style !== 'secondary');
  const has = bounds.length > 0;
  $('btn-bounds').hidden = !has;
  $('bounds-box').hidden = !has;
  if (has) {
    const parts = own.map((b) => `${b.name}${b.area_m2 ? ` (${M1.format(b.area_m2)} m²)` : ''}`);
    const total = own.reduce((s, b) => s + (b.area_m2 || 0), 0);
    const acc = cfg.plan.accuracy_m;
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}` : parts[0];
    $('bounds-text').textContent = `${list}${own.length > 1 && total ? `, zusammen ${M1.format(total)} m²` : ''} laut Katasterplan.`
      + ` Lage auf etwa ±${M1.format(acc)} m eingepasst und nur an Flurstück 214 geprüft.`
      + ' Hinweis Flurstück 214: Viewer-Polygon 206,5 m² (digitalisiert); amtliches ALKIS-Attribut 200 m², amtliches Polygon geometrisch 205,9 m². Flurstück 215 (447,7 m²): laut B-Plan private Grünfläche. Kein amtlicher Grenznachweis.';
  }
  const nb = buildings.length;
  $('btn-buildings').hidden = !nb;
  $('buildings-box').hidden = !nb;
  if (nb) {
    const named = buildings.filter((b) => b.name).map((b) => b.name.replace('Haus ', ''))
      .sort((x, y) => x.localeCompare(y, 'de', { numeric: true })).join(', ');
    $('buildings-text').textContent = `${nb} ${nb === 1 ? 'Gebäudeumriss' : 'Gebäudeumrisse'} laut Katasterplan${named ? ` (${named})` : ''}, in 3D gezeichnet als ${M1.format(WALL_H)} m hohe Hilfswände, in der Karte als Grundriss.`
      + ' Die wahre Gebäudehöhe steht nicht im Plan; außerhalb der Aufnahme ist auch die Geländehöhe nur geschätzt.'
      + ' Bei Strecke und Fläche rastet der Punkt auf Gebäudeecken, Grenzpunkte und Schächte der eingeblendeten Ebenen ein.';
  }
  const n = sw.pipes.length;
  const onOwn = sw.pipes.filter((p) => p.own_m > 0);
  $('btn-sewer').hidden = false;
  $('sewer-box').hidden = false;
  $('sewer-text').textContent = `${n} Haltung${n === 1 ? '' : 'en'} laut Kanalplan (${[...new Set(sw.pipes.map((p) => p.dn))].join(', ')})`
    + (onOwn.length ? `, davon ${M1.format(onOwn.reduce((s, p) => s + p.own_m, 0))} m auf dem Grundstück.` : '.')
    + ' Die Lage erbt die Unsicherheit der Einpassung; vor Erdarbeiten orten lassen. Schächte außerhalb der Aufnahme sind nur der Lage nach eingetragen.'
    + ' Die Breite des Schutzstreifens ist eine Annahme: Verbindlich ist die Vorgabe des Kanalbetreibers (Satzung oder Grunddienstbarkeit).';
  renderCorridor();
}
function renderGroundText() {
  const a = cfg.map.ground.accuracy_m;
  const f = (v) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  $('ground-text').textContent = `Punkte in der Karte bekommen ihre Höhe aus dem Bodenmodell (${NF1.format(cfg.map.ground.cell)}-m-Raster):`
    + ` Boden gemessen ±${f(a.measured)} m, außerhalb der Aufnahme aus Planhöhen geschätzt ±${f(a.estimated)} m (90 % der Prüfpunkte).`
    + ' Geschätzte Höhen sind in Liste, Profil und CSV gekennzeichnet. Für Höhen von Mauern, Bäumen und Dächern in 3D messen.';
}
function renderCorridor() {
  $('corr-minus').disabled = state.corridor <= 0;
  $('corr-plus').disabled = state.corridor >= 6;
  $('corr-value').textContent = `${M1.format(state.corridor)} m`;
}
function toggleLayer(key, btn) {
  state[key] = !state[key];
  $(btn).classList.toggle('on', state[key]);
  $(btn).setAttribute('aria-pressed', String(state[key]));
  markDirty();
}
function stepCorridor(delta) {
  state.corridor = Math.min(6, Math.max(0, Math.round((state.corridor + delta) * 2) / 2));
  overlay.setCorridor(state.corridor);
  renderCorridor();
  if (houseCtrl) {
    houseCtrl.recompute(state.corridor);
    overlay.setHouse(houseCtrl.getOverlayData(state.houseMode));
    renderHousePanel();
  }
  markDirty();
}
$('btn-bounds').addEventListener('click', () => toggleLayer('showBounds', 'btn-bounds'));
$('btn-sewer').addEventListener('click', () => toggleLayer('showSewer', 'btn-sewer'));
$('btn-buildings').addEventListener('click', () => toggleLayer('showBuildings', 'btn-buildings'));
$('corr-minus').addEventListener('click', () => stepCorridor(-0.5));
$('corr-plus').addEventListener('click', () => stepCorridor(0.5));

// ---------------------------------------------------------------- Hausentwurf & Grundrissdialog
function renderHousePanel() {
  if (!houseCtrl) return;
  $('house-content').innerHTML = houseCtrl.renderPanelHtml();
}
function syncHouseControls() {
  const isolated = !!view?.houseIsolated;
  app.dataset.isolated = String(isolated);
  const iso = $('btn-house-isolate');
  iso.classList.toggle('on', isolated);
  iso.setAttribute('aria-pressed', String(isolated));
  iso.title = isolated ? 'Grundstück und Vegetation wieder einblenden' : 'Haus ohne Grundstück und Vegetation zeigen';
  $('btn-house').classList.toggle('on', state.showHouse);
  $('btn-house').setAttribute('aria-pressed', String(state.showHouse));
  $('btn-baugrenze').classList.toggle('on', state.showBaugrenze);
  $('btn-baugrenze').setAttribute('aria-pressed', String(state.showBaugrenze));
  document.querySelectorAll('.hb-mode').forEach((b) => {
    const on = b.dataset.hmode === state.houseMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
function toggleHouse() {
  if (!houseCtrl) return;
  if (view?.houseIsolated) { returnToSite(true); return; }
  state.showHouse = !state.showHouse;
  if (!state.showHouse) state.houseIsolated = false;
  if (view?.kind === '3d') {
    view.setHouseVisible(state.showHouse);
    syncProfile(true);
  }
  syncHouseControls();
  markDirty();
}
function toggleBaugrenze() {
  if (!houseCtrl) return;
  state.showBaugrenze = !state.showBaugrenze;
  syncHouseControls();
  markDirty();
}
function setHouseMode(mode) {
  if (!houseCtrl) return;
  state.houseMode = mode;
  if (view?.siteRequest) view.siteRequest = null;
  if (mode !== 'full') state.houseIsolated = true;
  state.showHouse = true;
  overlay.setHouse(houseCtrl.getOverlayData(mode));
  if (view?.kind === '3d') {
    view.setHouseMode(mode);
    view.setHouseVisible(true);
    applyIsolation();
    if (state.houseIsolated) focusHouse();
  }
  syncHouseControls();
  markDirty();
}
function finishSiteView(hideHouse) {
  state.houseIsolated = false;
  if (hideHouse) {
    state.showHouse = false;
    view.setHouseVisible(false);
  }
  applyIsolation();
}
async function returnToSite(hideHouse = false) {
  if (!view?.houseIsolated) return;
  if (view.mesh) { finishSiteView(hideHouse); return; }
  if (loading) return;
  view.siteRequest = { hideHouse };
  await switchTier(quality.tier, null);
}
function applyIsolation() {
  if (view?.kind !== '3d') return;
  view.setHouseIsolated(state.houseIsolated);
  invalidateHover();
  if (state.draft) state.draft.hover = null;
  syncHouseControls();
  syncProfile(true);
  updateToolbar();
  updateHint();
  markDirty();
}
async function enterIsolated(mode) {
  if (!houseCtrl) await houseModP;
  if (!houseCtrl) return;
  state.houseIsolated = true;
  setHouseMode(mode);
  showPanel(false);
  if (view.kind !== '3d') await open3d();
}
function focusHouse(closePanelOnNarrow = false) {
  if (!houseCtrl || !view) return;
  if (!state.showHouse) {
    state.showHouse = true;
    syncHouseControls();
    if (view.kind === '3d') view.setHouseVisible(true);
  }
  if (closePanelOnNarrow && !wideLayout()) showPanel(false);
  const points = houseCtrl.getFocusPoints();
  if (view.kind === '3d') view.focusHouse(points, state.houseMode);
  else view.focusOn(points);
  markDirty();
}
let planReqGen = 0;
async function renderPlanTab(tab) {
  state.planTab = tab;
  document.querySelectorAll('#plan-dialog [data-ptab]').forEach((b) => {
    const on = b.dataset.ptab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  refreshLayerControls();
  const gen = ++planReqGen;
  const ctrl = houseCtrl ?? (houseModP ? await houseModP : null);
  if (!ctrl || gen !== planReqGen) return;
  try {
    const canvas = document.createElement('div'), meta = document.createElement('div');
    await ctrl.renderPlanDialog(tab, { canvas, meta }, { ...state.planLayers });
    if (gen !== planReqGen) return;
    $('plan-stage').replaceChildren(...canvas.childNodes);
    $('plan-meta').replaceChildren(...meta.childNodes);
  } catch (err) {
    console.error('Planansicht fehlgeschlagen:', err);
    if (gen === planReqGen) $('plan-stage').innerHTML = `<p class="plan-loading">Planansicht konnte nicht geladen werden: ${escapeHtml(err.message)}</p>`;
  }
}
function openPlanDialog(tab = state.planTab) {
  const dlg = $('plan-dialog');
  if (!dlg.open) dlg.showModal();
  renderPlanTab(tab);
}
function tourHash() {
  return ({ '#innen': 'eg', '#innen-og': 'og', '#blender': 'aussen' })[location.hash];
}
async function openBlenderTour(room = 'eg') {
  dismissMapIntro();
  try {
    const { openTour } = await import('./house/tour.js');
    view?.clearKeys?.();
    openTour(room, enterIsolated);
  } catch (error) {
    toast('Blender-Ansichten konnten nicht geladen werden: ' + error.message, 5000, true);
  }
}
window.addEventListener('hashchange', () => { if (houseModP) followHouseLink(); });
$('btn-house-tour').addEventListener('click', () => openBlenderTour(state.houseMode === 'og' ? 'og' : 'eg'));
$('btn-house-isolate').addEventListener('click', () => {
  if (view?.houseIsolated) returnToSite();
  else enterIsolated(state.houseMode);
});
$('btn-house').addEventListener('click', toggleHouse);
$('btn-baugrenze').addEventListener('click', toggleBaugrenze);
$('btn-house-focus').addEventListener('click', () => focusHouse(false));
$('btn-house-focus-panel').addEventListener('click', () => focusHouse(true));
function refreshLayerControls() {
  document.querySelectorAll('[data-service-switch]').forEach(input => {
    input.checked = state.planLayers[input.dataset.serviceSwitch];
  });
  const floor = ['eg','og'].includes(state.planTab);
  $('plan-layers').hidden = !floor;
  $('sketch-switch').checked = state.planLayers.sketch;
  $('service-explain').hidden = !floor || !(state.planLayers.water || state.planLayers.power);
  $('sketch-explain').hidden = !floor || !state.planLayers.sketch;
  $('btn-services').classList.toggle('on', state.planLayers.water || state.planLayers.power);
}
function setServiceMenu(open) {
  const menu = $('service-menu'), btn = $('btn-services');
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  refreshLayerControls();
  const pos = btn.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(pos.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = (pos.bottom + 6) + 'px';
}
$('btn-services').addEventListener('click', () => setServiceMenu($('service-menu').hidden));
document.addEventListener('pointerdown', e => {
  if (!$('service-menu').hidden && !e.target.closest('#service-menu, #btn-services')) setServiceMenu(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('service-menu').hidden) { setServiceMenu(false); $('btn-services').focus(); }
});
window.addEventListener('resize', () => { if (!$('service-menu').hidden) setServiceMenu(true); });
function setHouseServices(next = {}) {
  if ('water' in next) state.planLayers.water = !!next.water;
  if ('power' in next) state.planLayers.power = !!next.power;
  if ('sketch' in next) state.planLayers.sketch = !!next.sketch;
  refreshLayerControls();
  if (view?.kind === '3d') view.setHouseServices?.(state.planLayers);
  if ($('plan-dialog').open) renderPlanTab(state.planTab);
  markDirty();
}
document.querySelectorAll('[data-service-switch], #sketch-switch').forEach(input => {
  input.addEventListener('change', () => {
    const key = input.dataset.serviceSwitch || 'sketch';
    setHouseServices({ [key]: input.checked });
  });
});
$('service-plans').addEventListener('click', () => {
  setServiceMenu(false);
  if (!state.planLayers.water && !state.planLayers.power)
    setHouseServices({ water: true, power: true });
  openPlanDialog(state.houseMode === 'og' ? 'og' : 'eg');
});
$('btn-house-plan').addEventListener('click', () => openPlanDialog());
$('btn-house-plan-panel').addEventListener('click', () => openPlanDialog());
document.querySelectorAll('.hb-mode').forEach((b) => b.addEventListener('click', () => setHouseMode(b.dataset.hmode)));
document.querySelectorAll('#plan-dialog [data-ptab]').forEach((b) => b.addEventListener('click', () => renderPlanTab(b.dataset.ptab)));
$('plan-zoom').addEventListener('click', () => {
  const zoomed = $('plan-stage').classList.toggle('zoomed');
  $('plan-zoom').setAttribute('aria-pressed', String(zoomed));
  $('plan-zoom').textContent = zoomed ? 'Ganze Zeichnung' : 'Zeichnung vergrößern';
});
$('plan-close').addEventListener('click', () => $('plan-dialog').close());
$('plan-dialog').addEventListener('click', (e) => { if (e.target === $('plan-dialog')) $('plan-dialog').close(); });

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
    return `<li data-id="${escapeHtml(it.id)}" tabindex="0" role="button" aria-label="${escapeHtml(it.name)}: ${e.primary}" class="${it.id === state.selected ? 'sel' : ''}">
      <span class="swatch" style="background:${COLORS[it.type]}"></span>
      <span class="name">${escapeHtml(it.name)}</span>
      <button class="del" data-del="${escapeHtml(it.id)}" title="Messung löschen" aria-label="${escapeHtml(it.name)} löschen">×</button>
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
  if (cfg) renderCalibration();
  syncProfile();
  markDirty();
}
store.addEventListener('change', renderList);
function activateRow(li) {
  const it = store.items.find((i) => i.id === li.dataset.id);
  if (!it) return;
  select(it.id);
  view.focusOn(it.points);
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
$('btn-home').addEventListener('click', () => view?.home());
$('btn-top').addEventListener('click', () => { if (view?.kind === '3d') view.goTop(); });

// ---------------------------------------------------------------- Qualität
// Geräteprobe erst, wenn das erste Kartenbild wirklich gemalt ist (rAF, dann Task nach
// dem Malen) und der Browser Luft hat. Ein WebGL-Kontext im Hauptthread blockiert bei
// Software-Rendering (SwiftShader) 1–3 s, deshalb läuft die frühe Probe im Worker.
// Safari kennt requestIdleCallback nicht; dort nach kurzer Pause.
function detectDeviceLater() {
  // Im Worker (OffscreenCanvas), damit die Karte auch bei Software-Rendering nicht hängt. Kann der
  // Browser das nicht, folgt die Probe im Hauptthread beim Öffnen des Qualitätsmenüs oder bei „3D laden“.
  const run = () => {
    if (quality.detected) return;
    quality.detectEarly().then(() => { if (quality.detected) renderQuality(); }, (err) => {
      console.error(err);
      toast(`Geräteprüfung fehlgeschlagen: ${err.message}. Sie wird beim Laden von 3D wiederholt.`, 6000, true);
    });
  };
  requestAnimationFrame(() => setTimeout(() => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 300);
  }, 0));
}
function renderQuality() {
  const auto = quality.choice === 'auto' && !quality.forced;
  // Vor der Geräteprobe (läuft nach dem ersten Kartenbild) ist die Auto-Stufe noch offen.
  const t = auto && !quality.detected ? null : quality.tier;
  $('quality-label').textContent = t ? t.label : 'Auto';
  $('btn-quality').title = t ? `Qualität der 3D-Ansicht: ${t.label}${auto ? ` (automatisch: ${quality.autoReason})` : ''}`
    : 'Qualität der 3D-Ansicht: automatisch (Gerät wird noch geprüft)';
  const item = (choice, label, sub, checked) => `<button role="menuitemradio" aria-checked="${checked}" data-choice="${choice}" tabindex="-1">`
    + `<span class="q-check" aria-hidden="true">${checked ? '✓' : ''}</span><span class="q-main">${label}</span><small>${sub}</small></button>`;
  const rows = [quality.detected ? item('auto', `Automatisch – ${quality.autoTier.label}`, escapeHtml(quality.autoReason), auto)
    : item('auto', 'Automatisch', 'Gerät wird geprüft …', auto)];
  for (const x of cfg.splats.tiers) {
    rows.push(item(x.id, x.label, `${escapeHtml(x.hint)}<br>${MB(x.bytes)} MB · ${INT.format(x.count)} Splats`, !auto && x.id === t.id));
  }
  // Rundung der 16-Bit-Positionen kommt aus scene.json (build_splat_tiers.py: pos_round_mm)
  const packed = cfg.splats.tiers.filter((x) => !x.ext);
  let note = '';
  if (packed.length) {
    const mm = Math.max(...packed.map((x) => x.pos_round_mm));
    const amount = mm >= 10 ? `${NF1.format(mm / 10)} cm` : `${NF1.format(mm)} mm`;
    note = `<p class="q-note">${packed.map((x) => x.label).join('/')}: Positionen mit 16 Bit gespeichert (zusätzliche Rundung bis etwa ±${amount} am Rand der Aufnahme, zur Mitte hin weniger).</p>`;
  }
  $('quality-menu').innerHTML = `<div role="menu" aria-label="Qualität der 3D-Ansicht" id="quality-items">${rows.join('')}</div>${note}`;
  updateViewButton();
}
function updateViewButton() {
  const b = $('btn-view');
  if (state.view === '3d') {
    $('btn-view-text').textContent = '2D-Karte';
    b.title = 'Zur 2D-Karte (V) – gibt den 3D-Speicher frei';
    b.setAttribute('aria-disabled', 'false');
    b.classList.remove('accent');
    return;
  }
  b.classList.add('accent');
  if (quality.detected && !quality.device.webgl2) {
    $('btn-view-text').textContent = '3D nicht verfügbar';
    b.title = NO_WEBGL;
    b.setAttribute('aria-disabled', 'true');
    return;
  }
  if (state.tierError) {
    $('btn-view-text').textContent = '3D: Stufe unbekannt';
    b.title = state.tierError;
    b.setAttribute('aria-disabled', 'true');
    return;
  }
  b.setAttribute('aria-disabled', 'false');
  if (quality.choice === 'auto' && !quality.forced && !quality.detected) {
    $('btn-view-text').textContent = '3D laden';
    b.title = '3D-Ansicht laden (V)';
    return;
  }
  $('btn-view-text').textContent = `3D laden · ${MB(quality.tier.bytes)} MB`;
  b.title = `3D-Ansicht laden (V): Stufe „${quality.tier.label}“, ${MB(quality.tier.bytes)} MB`;
}
function toggleQualityMenu(open = $('quality-menu').hidden) {
  const m = $('quality-menu');
  if (open && !quality.detected) { quality.detect(); renderQuality(); }
  m.hidden = !open;
  $('btn-quality').setAttribute('aria-expanded', String(open));
  if (open) (m.querySelector('[aria-checked="true"]') || m.querySelector('button')).focus();
}
$('btn-quality').addEventListener('click', (e) => { e.stopPropagation(); toggleQualityMenu(); });
$('quality-menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-choice]');
  if (!b) return;
  toggleQualityMenu(false);
  chooseQuality(b.dataset.choice);
});
$('quality-menu').addEventListener('keydown', (e) => {
  const items = [...$('quality-menu').querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); toggleQualityMenu(false); $('btn-quality').focus(); }
  else if (e.key === 'Tab') { toggleQualityMenu(false); return; } // Fokus wandert normal weiter, Tastenkürzel gelten wieder
  e.stopPropagation();
});
// Fokus verlässt Menü und Knopf (Tab, Klick woanders): Menü schließen, sonst blieben die Tastenkürzel gesperrt
$('quality-menu').parentElement.addEventListener('focusout', (e) => {
  if (!$('quality-menu').hidden && e.relatedTarget && !e.relatedTarget.closest('.quality-wrap')) toggleQualityMenu(false);
});
document.addEventListener('pointerdown', (e) => { if (!$('quality-menu').hidden && !e.target.closest('.quality-wrap')) toggleQualityMenu(false); });

const sameFile = (a, b) => a.file === b.file && a.ext === b.ext;
// Ladeauftrag mit Abschluss-Promise: Wer nach einem Abbruch neu laden will, wartet auf `done`
// (sonst träfe open3d noch auf den alten Auftrag und würde nur einen Hinweis zeigen).
function newJob(tier) {
  let finish;
  const done = new Promise((r) => { finish = r; });
  return { ac: new AbortController(), tier, next: null, retarget: false, done, finish };
}
const settled = () => (loading ? loading.done : Promise.resolve());

// Laufender Ladevorgang (3D öffnen oder Stufe wechseln): { ac, tier, next, retarget }.
// Eine Qualitätswahl währenddessen wird nie still verworfen: Andere Datei → Laden abbrechen und
// mit der neuen Stufe neu starten; gleiche Datei (gleiche `file` und `ext`) → nach dem Laden
// anwenden. Mit den heutigen Daten teilen sich keine zwei Stufen eine Datei (auch „hoch“ hat eine
// eigene), der Zweig greift also nur bei so eingetragenen Stufen.
async function chooseQuality(choice) {
  const before = { choice: quality.choice, forced: quality.forced };
  quality.forced = null;
  const err = quality.set(choice);
  if (err) storageProblem('qualitaet', err, `Die Qualitätswahl wird nicht gespeichert: ${err.name} – nach dem Neuladen gilt wieder „Automatisch“.`);
  renderQuality();
  const tier = quality.tier;
  if (loading) { retarget(tier); return; }
  if (state.view !== '3d' || (view.houseIsolated && !view.mesh)) return;
  if (tier === state.tier3d && view.mesh) return;
  await switchTier(tier, state.tier3d, before);
}

function retarget(tier) {
  const job = loading;
  if (tier === job.tier) { job.next = null; toast(`Qualität „${tier.label}“ wird bereits geladen.`, 2200); return; }
  job.next = tier;
  if (sameFile(tier, job.tier)) { toast(`Qualität „${tier.label}“ wird nach dem Laden angewendet (gleiche Datei).`, 2600); return; }
  toast(`Qualität „${tier.label}“: Laden wird mit dieser Stufe neu gestartet.`, 3000);
  job.retarget = true;
  job.ac.abort();
}

// Gemerkte Wahl auf die tatsächlich geladene Stufe zurücksetzen („Vorherige Stufe laden“)
function restoreChoice(before) {
  quality.forced = before.forced;
  const err = quality.set(before.choice);
  if (err) storageProblem('qualitaet', err, `Die Qualitätswahl wird nicht gespeichert: ${err.name} – nach dem Neuladen gilt wieder „Automatisch“.`);
  renderQuality();
}

// tier: Ziel; prev: zuletzt erfolgreich geladene Stufe; before: Qualitätswahl vor dem Wechsel;
// restore: nach Erfolg die gemerkte Wahl auf `restore` zurücksetzen.
async function switchTier(tier, prev, before = null, restore = null) {
  if (state.view !== '3d') throw new Error(`switchTier(${tier.id}) außerhalb der 3D-Ansicht`);
  if (loading) throw new Error(`switchTier(${tier.id}) während eines laufenden Ladevorgangs`);
  const v = view;
  // Toter Kontext: kein Wechsel möglich, die Karte mit „Zur 2D-Karte“/„… neu laden“ wieder zeigen
  if (v.lost) { contextLostCard(); return; }
  // Abkürzung nur, wenn das geladene Modell wirklich die zuletzt erfolgreich geladene Stufe ist
  if (v.mesh && v.tier === state.tier3d && sameFile(state.tier3d, tier)) {
    card.hide();
    await v.setTier(tier);
    state.tier3d = tier;
    if (restore) restoreChoice(restore);
    toast(`Qualität „${tier.label}“.`, 1800);
    return;
  }
  const job = loading = newJob(tier);
  const { ac } = job;
  card.show(v.siteRequest ? 'Grundstück wird geladen …' : 'Qualität wird gewechselt …', { cancel: () => ac.abort() });
  card.phase2(tier);
  let restart = null, after = null;
  try {
    await v.setTier(tier, { signal: ac.signal, onProgress: (ph, got, total) => card.progress(ph, got, total, tier) });
    if (view !== v) throw new Error('3D-Ansicht wurde während des Wechsels geschlossen');
    state.tier3d = tier;
    if (restore) restoreChoice(restore);
    card.hide();
    if (v.siteRequest) {
      const { hideHouse } = v.siteRequest;
      v.siteRequest = null;
      finishSiteView(hideHouse);
    }
    syncProfile(true);
    markDirty();
    updateHint();
    if (coarse && prev && tier.count < prev.count) {
      toast(`Qualität „${tier.label}“ geladen.`, 9000, false, { label: 'Für vollständige Speicherfreigabe Seite neu laden', fn: () => location.reload() });
    }
    after = job.next;
  } catch (err) {
    if (view !== v || state.view !== '3d') {
      // 3D wurde währenddessen geschlossen (close3d bricht den Download ab): keine Fehlerkarte über der 2D-Karte
      if (err.name === 'AbortError') console.info(`Qualitätswechsel auf „${tier.id}“ abgebrochen, weil 3D geschlossen wurde.`);
      else console.error(err);
      return;
    }
    // Kontextverlust der aktiven Ansicht: hooks3d.onContextLost zeigt bereits die Fehlerkarte mit
    // „Zur 2D-Karte“ und „Mit Stufe … neu laden“; ein Neuversuch auf dem toten Kontext wäre sinnlos.
    if (err.name === 'ContextLostError') { console.error(err); $('status').textContent = '3D · vom Gerät beendet'; contextLostCard(); return; }
    if (err.name === 'AbortError' && job.retarget && job.next) restart = job.next;
    else if (v.houseIsolated && !prev) {
      const hideHouse = !!v.siteRequest?.hideHouse;
      v.siteRequest = null;
      if (err.name === 'AbortError') card.hide();
      else card.error(err.message, { title: 'Das Grundstück konnte nicht geladen werden.', retry: () => returnToSite(hideHouse), stay: ['Beim Haus bleiben', () => {}] });
      v.updateSceneStatus();
    } else {
      console.error(err);
      $('status').textContent = '3D · kein Modell geladen';
      const msg = err.name === 'AbortError' ? 'Qualitätswechsel abgebrochen – die vorherige Stufe ist bereits freigegeben.' : err.message;
      card.error(msg, {
        retry: () => switchTier(tier, prev, before, restore),
        prev: prev && prev !== tier ? () => switchTier(prev, prev, null, before ?? { choice: prev.id, forced: null }) : null,
        stay: ['Zur 2D-Karte', close3d],
      });
    }
  } finally {
    loading = null;
    job.finish();
  }
  if (restart) { card.hide(); return switchTier(restart, prev, before, restore); }
  if (after && after !== state.tier3d) return switchTier(after, state.tier3d);
}

// ---------------------------------------------------------------- Ladekarte 3D
// Bildschirmleser: Die Karte selbst ist keine Live-Region (Fortschritt ändert sich je Datenblock).
// Angesagt werden nur Phasenwechsel und Fortschritt in 25-%-Schritten über #load3d-live; ein Fehler
// macht die Karte zur role="alert".
let liveStep = -1;
function announce(text) { $('load3d-live').textContent = text; }
const card = {
  show(title, { cancel = null } = {}) {
    const el = $('load3d');
    el.hidden = false;
    el.classList.remove('error');
    el.removeAttribute('role');
    liveStep = -1;
    announce(title);
    $('load3d-title').textContent = title;
    $('load3d-text').textContent = '';
    $('load3d-barbox').hidden = true;
    $('load3d-bar').style.width = '0%';
    for (const id of ['load3d-retry', 'load3d-prev', 'load3d-low', 'load3d-stay']) $(id).hidden = true;
    $('load3d-cancel').hidden = !cancel;
    $('load3d-cancel').onclick = cancel;
  },
  phase2(tier) {
    $('load3d-barbox').hidden = false;
    $('load3d-text').textContent = `Modell: 0,0 von ${MB(tier.bytes)} MB`;
  },
  progress(phase, got, total, tier) {
    // Eine Fehlerkarte (z. B. Kontextverlust während des Ladens) nie mit Fortschritt überschreiben
    if ($('load3d').hidden || $('load3d').classList.contains('error')) return;
    if (phase === 'download') {
      $('load3d-title').textContent = `Modell „${tier.label}“ wird geladen …`;
      $('load3d-barbox').hidden = false;
      $('load3d-bar').style.width = `${((got / total) * 100).toFixed(0)}%`;
      $('load3d-text').textContent = `Modell: ${MB(got)} von ${MB(total)} MB`;
      const step = Math.floor((got / total) * 4);
      if (step !== liveStep) { liveStep = step; announce(`Modell „${tier.label}“: ${step * 25} % von ${MB(total)} MB geladen`); }
    } else if (phase === 'decode') {
      $('load3d-title').textContent = 'Modell wird entpackt …';
      $('load3d-bar').style.width = '100%';
      $('load3d-cancel').hidden = true;
      announce('Modell wird entpackt');
    }
  },
  error(msg, { retry = null, prev = null, low = null, stay = null, title = 'Die 3D-Ansicht konnte nicht geladen werden.' }) {
    const el = $('load3d');
    el.hidden = false;
    el.classList.add('error');
    announce('');
    el.setAttribute('role', 'alert');
    $('load3d-title').textContent = title;
    $('load3d-text').textContent = msg;
    $('load3d-barbox').hidden = true;
    $('load3d-cancel').hidden = true;
    const set = (id, fn, label) => { const b = $(id); b.hidden = !fn; b.onclick = fn ? () => { card.hide(); fn(); } : null; if (label) b.textContent = label; };
    set('load3d-retry', retry);
    set('load3d-prev', prev);
    set('load3d-low', low);
    set('load3d-stay', stay?.[1] ?? null, stay?.[0]);
  },
  hide() { $('load3d').hidden = true; $('load3d').removeAttribute('role'); announce(''); },
};

// ---------------------------------------------------------------- Wechsel 2D ↔ 3D
const planMedianY = () => {
  // Median der Planhöhen im Startausschnitt (für die 3D-Kamera, wenn die Kartenmitte keine Bodenhöhe hat)
  const [x0, x1, z0, z1] = cfg.map.start;
  const ys = [...cfg.boundaries.flatMap((b) => b.points || []), ...cfg.buildings.flatMap((b) => b.points), ...cfg.sewer.manholes.map((m) => m.at)]
    .filter((p) => p[0] >= x0 && p[0] <= x1 && p[2] >= z0 && p[2] <= z1).map((p) => p[1]).sort((a, b) => a - b);
  if (!ys.length) throw new Error('Keine Planpunkte im Startausschnitt (map.start) – Kamerahöhe nicht bestimmbar');
  return ys[ys.length >> 1];
};
function cameraFrom2D() {
  if (!map2d.moved) return { position: cfg.view.position, target: cfg.view.target };
  const { cx, cz, mpp } = map2d.getViewState();
  const g = ground.sample(cx, cz);
  // Definierte Regel (kein stiller Ersatz): ohne Bodenhöhe an der Kartenmitte gilt der Median der Planhöhen im Startausschnitt.
  const y = g.error ? planMedianY() : g.y;
  const v = cfg.view;
  const d = [0, 1, 2].map((i) => v.position[i] - v.target[i]);
  const len = Math.hypot(...d);
  const distance = (mpp * map2d.h) / (2 * Math.tan(Math.PI / 6));
  const target = [cx, y, cz];
  return { target, position: target.map((t, i) => t + (d[i] / len) * distance) };
}

const hooks3d = {
  onFrame: () => drawOverlay(),
  onTap, onDouble, onHover, onLeave, toast,
  onResize: (w, h) => overlay.setSize(w, h),
  setStatus: (t) => { $('status').textContent = t; },
  onScaleChanged: () => updateScaleBar(),
  onPickState: (s, err) => {
    state.pickState = s;
    state.pickError = err ? err.message : null;
    updateToolbar();
    updateHint();
    if (s === 'failed') syncProfile();
  },
  // Nur für die aktive (sichtbare) Ansicht; ein Verlust während des Ladens lässt View3D.create()
  // mit ContextLostError scheitern (Fehlerkarte in open3d).
  onContextLost: (v) => {
    if (v !== view) throw new Error('onContextLost für eine nicht mehr aktive 3D-Ansicht');
    // Laufenden Qualitätswechsel abbrechen; er endet still (switchTier: ContextLostError)
    if (loading) loading.ac.abort();
    $('status').textContent = '3D · vom Gerät beendet';
    contextLostCard();
  },
};
function contextLostCard() {
  const low = cfg.splats.tiers[0];
  card.error('Die 3D-Ansicht wurde vom Gerät beendet (WebGL-Kontext verloren, vermutlich zu wenig Grafikspeicher).', {
    title: 'Die 3D-Ansicht wurde beendet.',
    stay: ['Zur 2D-Karte', close3d],
    // Die Wahl „Niedrig“ wird gemerkt, damit Knopf und nächstes Laden dazu passen
    low: () => reopenLow(low),
  });
  $('load3d-low').textContent = `Mit Stufe „${low.label}“ neu laden`;
}
// 3D schließen bzw. abgebrochenes Laden abwarten, dann mit der niedrigsten Stufe neu öffnen
async function reopenLow(low) {
  close3d();
  await settled();
  quality.forced = null;
  restoreChoice({ choice: low.id, forced: null });
  await open3d();
}

async function open3d(tierId) {
  if (state.view === '3d') return;
  if (loading) { toast('3D wird gerade geladen – „Abbrechen“ in der Ladekarte beendet das.', 3000); return; }
  if (!quality.detected) { quality.detect(); renderQuality(); }
  if (!quality.device.webgl2) { toast(NO_WEBGL, 4000, true); return; }
  if (state.tierError && !tierId) { toast(state.tierError, 6000, true); return; }
  const tier = tierId ? quality.byId(tierId) : quality.tier;
  const conn = navigator.connection;
  if ((conn?.saveData || /^(slow-2g|2g|3g)$/.test(conn?.effectiveType ?? '')) && !confirm(state.houseIsolated ? 'Das isolierte Hausmodell herunterladen?' : `3D lädt ${MB(tier.bytes)} MB herunter. Fortfahren?`)) return;
  if (quality.cls === 'software') toast('Kein Grafikprozessor erkannt (Software-Rendering) – 3D wird sehr langsam sein.', 6000, true);
  const job = loading = newJob(tier);
  const { ac } = job;
  card.show('3D-Programm wird geladen …', { cancel: () => ac.abort() });
  let restart = null, after = null;
  try {
    viewMod ??= await import('./view3d.js');
    await groundP; // Kamerahöhe aus dem Bodenmodell (cameraFrom2D)
    if (houseModP) await houseModP;
    if (ac.signal.aborted) throw new DOMException('abgebrochen', 'AbortError');
    if (!state.houseIsolated) card.phase2(tier);
    const initial = cameraFrom2D();
    const house = houseCtrl ? { ...houseCtrl.get3DConfig(), visible: state.showHouse, mode: state.houseMode, isolated: state.houseIsolated, services: state.planLayers } : null;
    // Der Canvas bleibt bis activate() unsichtbar und ohne Eingaben: 2D bleibt während des Downloads bedienbar.
    const v = await viewMod.View3D.create({
      host: app, before: $('overlay'), cfg, base: BASE, tier, hooks: hooks3d, stats, initial, view2d: map2d.getViewState(), house, signal: ac.signal,
      onProgress: (ph, got, total) => card.progress(ph, got, total, tier),
    });
    map2d.suspend();
    $('overlay').style.transform = ''; $('labels').style.transform = '';
    view = v;
    v.activate(); // übernimmt das Overlay (Größe, Neuaufbau)
    state.view = '3d';
    dismissMapIntro();
    state.tier3d = v.mesh ? tier : null;
    state.marker = null;
    app.dataset.view = '3d';
    onLeave();
    card.hide();
    updateViewButton();
    updateToolbar();
    updateHint();
    syncProfile(true);
    v.setHouseMode(state.houseMode);
    v.setHouseVisible(state.showHouse);
    v.setHouseServices?.(state.planLayers);
    applyIsolation();
    if (v.houseIsolated) focusHouse();
    if (state.tool !== 'nav') v.warmPicker();
    v.canvas.focus({ preventScroll: true });
    markDirty();
    after = job.next;
  } catch (err) {
    if (err.name === 'AbortError') {
      card.hide();
      if (job.retarget && job.next) restart = job.next;
      else toast('3D-Laden abgebrochen.');
    } else {
      console.error(err);
      // Kontextverlust während des Ladens: View3D.create hat alles freigegeben, 2D bleibt aktiv.
      // Neuversuch mit derselben Stufe oder (falls höher) mit der niedrigsten.
      const low = cfg.splats.tiers[0];
      const lost = err.name === 'ContextLostError';
      card.error(err.message, {
        title: lost ? 'Die 3D-Ansicht wurde beim Laden vom Gerät beendet.' : undefined,
        retry: () => open3d(tierId),
        low: lost && tier.id !== low.id ? () => reopenLow(low) : null,
        stay: ['In 2D bleiben', () => {}],
      });
      if (lost) $('load3d-low').textContent = `Mit Stufe „${low.label}“ laden`;
    }
  } finally {
    loading = null;
    job.finish();
  }
  if (restart) return open3d(restart.id);
  if (after && after !== state.tier3d && state.view === '3d') return switchTier(after, state.tier3d);
}

function close3d() {
  if (state.view !== '3d') return;
  if (loading) loading.ac.abort();
  const vs = view.getViewState();
  const errors = view.dispose();
  view = map2d;
  state.view = '2d';
  state.tier3d = null;
  state.pickState = 'idle';
  state.pickError = null;
  state.marker = null;
  app.dataset.view = '2d';
  syncHouseControls();
  card.hide();
  map2d.resume();
  map2d.moved = true;
  map2d.setViewState(vs);
  onLeave();
  updateStatus();
  updateViewButton();
  updateToolbar();
  updateHint();
  syncProfile(true);
  markDirty();
  if (errors.length) toast(`3D-Speicher nicht vollständig freigegeben: ${errors.join('; ')}`, 8000, true);
  // Das 3D-Programm (Spark-Worker, WASM-Speicher) bleibt bis zum Neuladen geladen – auf Handys spürbar
  else if (coarse) toast('3D geschlossen. Ein Teil des Speichers bleibt bis zum Neuladen belegt.', 7000, false, { label: 'Seite neu laden', fn: () => location.reload() });
  else toast('3D-Speicher freigegeben.', 2000);
}
function toggleView() {
  if (state.view === '3d') close3d();
  else if ($('btn-view').getAttribute('aria-disabled') === 'true') toast($('btn-view').title, 4000, true);
  else open3d();
}
$('btn-view').addEventListener('click', toggleView);

// ---------------------------------------------------------------- Tasten
const TOOL_KEYS = { 1: 'nav', 2: 'dist', 3: 'area', 4: 'height', 5: 'calib' };
const PAN = { ArrowLeft: [-0.15, 0], KeyA: [-0.15, 0], ArrowRight: [0.15, 0], KeyD: [0.15, 0], ArrowUp: [0, -0.15], KeyW: [0, -0.15], ArrowDown: [0, 0.15], KeyS: [0, 0.15] };
window.addEventListener('keydown', (e) => {
  if (!view || document.querySelector('dialog[open]') || e.target instanceof HTMLInputElement) return;
  if (!$('quality-menu').hidden) return;
  if (e.metaKey || e.ctrlKey || e.altKey) { if (view.kind === '3d') view.clearKeys(); return; }
  if (view.kind === '3d' && MOVE_CODES.has(e.code)) {
    view.keyDown(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
    return;
  }
  if (view.kind === '2d' && PAN[e.code]) { view.panBy(...PAN[e.code]); if (e.code.startsWith('Arrow')) e.preventDefault(); return; }
  const key = e.key.toLowerCase();
  if (view.kind === '2d' && (key === '+' || key === '=')) { view.zoomBy(1 / 1.5); return; }
  if (view.kind === '2d' && (key === '-' || key === '_')) { view.zoomBy(1.5); return; }
  if (TOOL_KEYS[key]) {
    if (TOOL_KEYS[key] !== 'nav' && measureBlocked()) { toast(`Messen in 3D nicht möglich: ${state.pickError}. In der 2D-Karte messen.`, 4000, true); return; }
    setTool(TOOL_KEYS[key]); return;
  }
  if (key === 'escape') { if (state.draft?.points.length) cancelDraft(); else setTool('nav'); return; }
  if (key === 'backspace' && state.draft?.points.length) { undoPoint(); e.preventDefault(); return; }
  if (key === 'enter' && state.tool === 'area' && !(e.target instanceof HTMLButtonElement) && !e.target.closest?.('li')) { queue(finishArea); return; }
  if (key === 'h') { view.home(); return; }
  if (key === 't' && view.kind === '3d') { view.goTop(); return; }
  if (key === 'v' && !e.repeat) { toggleView(); return; }
  if (key === 'm') { showPanel($('panel').classList.contains('hidden')); return; }
  if (key === 'g' && !e.repeat && cfg.boundaries.length) { toggleLayer('showBounds', 'btn-bounds'); return; }
  if (key === 'k' && !e.repeat) { toggleLayer('showSewer', 'btn-sewer'); return; }
  if (key === 'b' && !e.repeat && cfg.buildings.length) { toggleLayer('showBuildings', 'btn-buildings'); return; }
  if (key === 'p' && !e.repeat && houseCtrl) { toggleHouse(); return; }
  if (key === 'r' && !e.repeat && houseCtrl) { toggleBaugrenze(); return; }
  if (key === 'f' && !e.repeat && houseCtrl) { focusHouse(false); return; }
  if (key === 'l' && !e.repeat && houseCtrl) { openPlanDialog(); return; }
  if (key === '?') { $('help-dialog').showModal(); }
});
window.addEventListener('keyup', (e) => { if (view?.kind === '3d') view.keyUp(e.code); });
window.addEventListener('blur', () => { if (view?.kind === '3d') view.clearKeys(); });

main().catch((err) => {
  console.error(err);
  showFatal('Die Seite konnte nicht gestartet werden.', String(err?.message || err));
});
