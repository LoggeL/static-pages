#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArmsShots } from './arms-shots.mjs';
import { createNPCShots } from './npc-shots.mjs';

// Run from any directory. --check verifies the committed presets without writes.
const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, '../..');
const layoutPath = join(sourceRoot, 'blender/layout.json');
const layoutText = await readFile(layoutPath, 'utf8');
const layout = JSON.parse(layoutText);
const catalog = new Map();
for (const name of ['props_living', 'props_kitchenbath', 'props_clutter']) {
  for (const prop of JSON.parse(await readFile(join(sourceRoot, `blender/${name}.json`), 'utf8'))) {
    catalog.set(prop.name, prop);
  }
}
const args = process.argv.slice(2);
assert(args.every((arg) => arg === '--check'), 'Usage: node generate-shots.mjs [--check]');
const check = args.includes('--check');
const rooms = new Map(layout.rooms.map((room) => [room.id, room]));
const source = {
  layout: 'sources/bodycam-demo/blender/layout.json',
  sha256: createHash('sha256').update(layoutText).digest('hex'),
  coordinates: 'Blender [x,y,z] -> Three.js [x,z,-y], Meter. teleport verwendet die Fussposition; yaw 0 blickt nach -Z, positiv nach links; pitch -4 blickt abwaerts.',
  cameraHeight: 1.4,
  capsuleRadius: 0.3,
  validation: 'Punkte liegen im Raum-Polygon, mit mindestens 0.30 m Abstand zur Polygonkante. Konservative, gedrehte Katalog-Footprints vorhandener Bodenmoebel ueber 0.19 m werden geprueft. Geometrie, fehlende Props, Tueren und aktuelle Collider muessen im Browser geprueft werden.',
};
const round = (value) => Number(value.toFixed(6));
const toThree = ([x, y, z]) => [round(x), round(z), round(-y)];
const floor = (id) => rooms.get(id).floorZ;

// Deliberately selected circulation points. The HAL bounding-box center is in
// BED1, and the center of BED2 is too close to its mattress/wardrobe.
const points = [
  ['spawn', 'OUT', layout.playerSpawn.pos, layout.playerSpawn.yawDeg, -4, 'Spawn laut playerSpawn am Streifenwagen, Blick auf das Haus.'],
  ['porch', 'PORCH', [-0.28, -1.3, floor('PORCH')], 0, -4, 'Mittig auf der Veranda vor der Haustuer, zwischen den seitlichen Moebeln.'],
  ['hall-long', 'HAL', [-0.28, 1.6, floor('HAL')], 0, -4, 'Mitte des schmalen Laengsflurs auf dem begehbaren Laeufer; hinter dem Schwenkbereich der Haustuer.'],
  ['hall-cross', 'HAL', [1.05, 4.95, floor('HAL')], -90, -4, 'Mitte des Querflurs, Blick zur Ostseite. Kein Mittelpunkt der L-foermigen Raum-AABB.'],
  ['living', 'LIV', [-2.05, 3.1, floor('LIV')], 75, -4, 'Freier Weg zwischen Wohnzimmerdurchgang, TV und Couchtisch; umgestuerztes Regal liegt weiter suedlich.'],
  ['kitchen', 'KIT', [-2.55, 6.3, floor('KIT')], 22, -4, 'Oestlich des Esstischs und seiner Stuehle, vor dem Kuehlschrank; Blick zur Kuechenzeile.'],
  ['bedroom-1', 'BED1', [2.7, 2.6, floor('BED1')], -85, -4, 'Freie Flaeche zwischen Einbauschrank und Bett, ausserhalb der Kommode und ihrer offenen Schubladen.'],
  ['closet', 'CLO1', [0.75, 2.55, floor('CLO1')], -90, -4, 'Zwischen Karton und Muellsack, Blick durch die offene Schranktuer. Nur 0.62 m Raumbreite, 1 cm Wandreserve je Seite fuer Radius 0.30 m.'],
  ['bathroom', 'BATH', [1.15, 6.85, floor('BATH')], -90, -4, 'Freie Mitte zwischen Waschtisch, Toilette und Wanne; Blick zur Ostwand.'],
  ['bedroom-2', 'BED2', [4.4, 6.8, floor('BED2')], 0, -4, 'Suedlich der Matratze, oestlich des Kleiderschranks und westlich der Kommode.'],
  ['utility', 'UTIL', [1.4, 9, floor('UTIL')], 35, -4, 'Zwischen Muellsack, Karton und geschlossener Hintertuer; Blick zur Waschmaschine.'],
];

function segmentDistance([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function inPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function validatePoint([name, roomId, position]) {
  assert(position.length === 3 && position.every(Number.isFinite), `${name}: invalid position`);
  const room = rooms.get(roomId);
  assert(room, `${name}: unknown room ${roomId}`);
  if (!room.polygon) return;
  assert(inPolygon(position, room.polygon), `${name}: outside ${roomId} polygon`);
  const clearance = Math.min(...room.polygon.map((p, i) => segmentDistance(position, p, room.polygon[(i + 1) % room.polygon.length])));
  assert(clearance >= source.capsuleRadius - 1e-6, `${name}: capsule intersects room boundary (${clearance} m)`);
  assert.equal(position[2], room.floorZ, `${name}: not on room floor`);
  for (const furniture of layout.furniture[roomId] ?? []) {
    const dimensions = catalog.get(furniture.prop)?.dims;
    if (furniture.anchor !== 'floor' || !dimensions || dimensions[2] <= 0.19) continue;
    if (furniture.pos[2] >= position[2] + 1.8) continue;
    const angle = -furniture.rotZ * Math.PI / 180;
    const dx = position[0] - furniture.pos[0];
    const dy = position[1] - furniture.pos[1];
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
    const distance = Math.hypot(Math.max(0, Math.abs(localX) - dimensions[0] / 2), Math.max(0, Math.abs(localY) - dimensions[1] / 2));
    assert(distance >= source.capsuleRadius, `${name}: intersects catalog footprint of ${furniture.name} (${distance} m)`);
  }
}
points.forEach(validatePoint);
for (const room of layout.rooms) assert(points.some((point) => point[1] === room.id), `Missing shot for room ${room.id}`);

function cameraShot(point) {
  const [name, room, blenderPosition, yawDeg, pitchDeg, rationale] = point;
  return {
    name,
    description: `${rooms.get(room).name}: ${rationale}`,
    teleport: [...toThree(blenderPosition), yawDeg, pitchDeg],
    source: { room, blenderPosition, rationale },
  };
}

const cameraShots = points.map(cameraShot);
function suite(page, description, shots, extra = {}) {
  return { version: 1, page, description, source, defaults: { settleMs: 500, measureSeconds: 2 }, ...extra, shots };
}

// Adapters run before waitForReady without blocking module initialization. They
// forward the actual page readiness signal and never synthesize success.
const worldBeforeReady = {
  type: 'eval',
  code: `(${function installWorldReadiness() {
    let timer;
    function attach() {
      const api = window.__bodycam;
      if (!api || (!('ready' in api) && typeof api.stats !== 'function')) return false;
      if (!('ready' in api)) Object.defineProperty(api, 'ready', { configurable: true, get() { return api.stats().ready; } });
      clearInterval(timer);
      return true;
    }
    if (!attach()) {
      timer = setInterval(attach, 25);
      window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }
    return { adapter: 'C12 stats().ready -> __bodycam.ready' };
  }.toString()})()`,
};
const postfxBeforeReady = {
  type: 'eval',
  code: `(${function installPostfxAdapter() {
    if (!window.__bodycam) window.__bodycam = {
      get ready() { return window.postfxDemo?.ready ?? false; },
      stats() {
        const demo = window.postfxDemo;
        if (!demo) throw new Error('C5 postfxDemo is not initialized');
        return {
          ...demo.stats,
          scenario: demo.scenario, mode: demo.mode, quality: demo.quality,
          renderer: { info: {
            render: { ...demo.renderer.info.render },
            memory: { ...demo.renderer.info.memory },
            programs: demo.renderer.info.programs?.length,
          } },
        };
      },
    };
    return { adapter: 'C5 postfxDemo.ready Promise and renderer.info -> __bodycam' };
  }.toString()})()`,
};
function postfxScenario(name, mode = 'post') {
  return {
    type: 'eval',
    code: `(() => { const d = window.postfxDemo; if (!d) throw new Error('C5 postfxDemo is not initialized'); d.setQuality('high'); d.setMode(${JSON.stringify(mode)}); d.setScenario(${JSON.stringify(name)}); d.resume(); return { scenario: d.scenario, mode: d.mode, quality: d.quality }; })()`,
  };
}
function weapon(method, ...values) {
  return { type: 'eval', code: `(() => { const w = window.__bodycam?.weapon; if (typeof w?.${method} !== 'function') throw new Error('C3 debug API required: window.__bodycam.weapon.${method}()'); return w.${method}(${values.map((value) => JSON.stringify(value)).join(',')}); })()` };
}
const appSilent = { type: 'eval', code: `(async () => {
  const a = window.__bodycam; const c = a.dev.audio.context;
  const stats = a.stats();
  if (stats.issues.length || Object.values(stats.modules).some(v => !v)) throw new Error('App module fallback: ' + JSON.stringify(stats.issues));
  return { audioSink: c.sinkId, audio: stats.audio };
})()` };
const appResume = { type: 'eval', code: `(async () => {
  await window.__bodycam.resume();
  if (window.__bodycam.stats().phase !== 'playing') throw new Error('App did not start');
  return { phase: window.__bodycam.stats().phase };
})()` };
const phaseCheck = phase => ({ type: 'eval', code: `(() => {
  const actual = window.__bodycam.stats().phase;
  if (actual !== ${JSON.stringify(phase)}) throw new Error('Expected phase ${phase}, got ' + actual);
  return { phase: actual };
})()` });
const modelBeforeReady = { type: 'eval', code: `(() => {
  window.__bodycam = {
    get ready() { return window.weaponTest?.ready ?? false; },
    stats() { return { results: window.weaponTest.results, renderer: { info: window.weaponTest.getRendererInfo() } }; }
  };
  return { adapter: 'weaponTest.ready/results' };
})()` };
const reloadFrame = { type: 'eval', code: `(() => {
  const a = window.__bodycam;
  a.dev.freeze(true);
  if (!a.weapon.reload()) throw new Error('Reload did not start');
  a.dev.step(1.3);
  const s = a.weapon.state();
  if (s.state !== 'reload' || Math.abs(s.reloadProgress - 1.3 / 3.7) > 0.001) throw new Error('Wrong reload frame: ' + JSON.stringify(s));
  return { state: s.state, reloadProgress: s.reloadProgress, magazine: s.magazine };
})()` };
const unfreeze = { type: 'eval', code: 'window.__bodycam.dev.freeze(false)' };
const wait = (ms) => ({ type: 'wait', ms });
const hall = cameraShots.find((shot) => shot.name === 'hall-long');
const hallCross = cameraShots.find((shot) => shot.name === 'hall-cross');
const plasterPoint = ['plaster-impact', 'HAL', [-0.28, 3.9, floor('HAL')], 90, 0, 'Verputzte Westwand des Flurs, noerdlich der Wohnzimmeroeffnung.'];
validatePoint(plasterPoint);
const weaponShots = [
  { ...hall, name: 'low-ready', description: 'Low-Ready im Flur, Waffenlicht aus.', actions: [weapon('ads', false), weapon('light', false)] },
  { ...hall, name: 'ads', description: 'ADS nach abgeschlossenem 0.28-s-Uebergang, Waffenlicht an.', actions: [weapon('light', true), weapon('ads', true)] },
  { ...hall, name: 'fire-flash', description: 'Einzelschuss ohne Wartezeit. Das reale 2-Frame-Muendungsfeuer ist unter Playwright zeitkritisch; ein fehlender Lichtframe beweist keinen Defekt.', settleMs: 0, measureSeconds: 0, actions: [weapon('ads', false), wait(300), weapon('fire', 1)] },
  { ...hallCross, name: 'wood-impact', description: 'Schuesse steil abwaerts in Richtung des Holzbodens im Querflur, ausserhalb des Teppichlaeufers. Getroffene Oberflaeche im Waffen-Event pruefen.', look: [-90, -65], actions: [weapon('fire', 3), wait(500)] },
  { ...cameraShot(plasterPoint), description: 'Schuss links auf die verputzte Flurwand, noerdlich des Wohnzimmerdurchgangs. Getroffene Oberflaeche im Waffen-Event pruefen.', actions: [weapon('fire', 1), wait(300)] },
  { name: 'metal-impact', description: 'Von der freien Flaeche vor der Kuechenzeile auf den Metallherd zielen. Getroffene Oberflaeche im Waffen-Event pruefen.', teleport: [-2.7, floor('KIT'), -8.15, 0, -25], actions: [weapon('fire', 1), wait(300)], source: { room: 'KIT', blenderPosition: [-2.7, 8.15, floor('KIT')], rationale: 'Vor dem Herd, westlich von Kuehlschrank und Muellsaecken.' } },
  { ...hall, name: 'casings', description: 'Drei Schuesse im Flur, danach Blick auf Boden und Huelsenpool.', actions: [weapon('fire', 3), wait(1200), { type: 'look', yawDeg: 0, pitchDeg: -75 }] },
  { ...hall, name: 'reload-middle', description: 'Nachladen exakt 1.3 s nach Ausloesen, nach magOut und vor magIn. Echter Debug-Schritt mit eingefrorener rAF, damit der PNG-Readback die Pose nicht verschiebt.', settleMs: 0, measureSeconds: 0, actions: [reloadFrame] },
];
validatePoint(['metal-impact', 'KIT', [-2.7, 8.15, floor('KIT')]]);

const lightmapShots = cameraShots.map(({ teleport, ...shot }) => {
  const [x, feetY, z, yaw, pitch] = teleport;
  const camera = [x, round(feetY + source.cameraHeight), z, yaw, pitch];
  return {
    ...shot,
    actions: [{ type: 'eval', code: `window.__lightmaps.setCamera(${JSON.stringify(camera)})` }],
    description: `${shot.description} C6-Kamera-Query: absolute Kameraposition, 1.40 m ueber Boden.`,
    source: { ...shot.source, cameraPosition: camera.slice(0, 3) },
  };
});
const appShots = [
  { name: 'start', description: 'Geladene App mit sichtbarem Startdialog.', actions: [phaseCheck('start')] },
  ...cameraShots.map((shot, index) => ({ ...shot, actions: index === 0 ? [appResume] : [] })),
  { ...hall, name: 'hall-light', description: 'App im Flur mit eingeschaltetem Waffenlicht.', actions: [weapon('light', true)] },
  { ...hall, name: 'ads', description: 'App-ADS im Flur nach abgeschlossenem Uebergang.', actions: [weapon('ads', true)] },
  { ...hall, name: 'fire', description: 'App-Einzelschuss mit direktem Screenshot. Das sehr kurze Muendungsfeuer ist unter Playwright nicht garantiert.', settleMs: 0, measureSeconds: 0, actions: [weapon('fire', 1)] },
  { ...hall, name: 'reload-middle', description: 'App-Nachladen bei exakt 1.3 s, vor magIn; eingefrorener Debug-Schritt, keine FPS-Messung.', settleMs: 0, measureSeconds: 0, actions: [weapon('ads', false), wait(250), reloadFrame] },
  { ...hall, name: 'look-down', description: 'Blick auf Waffe und Boden nach abgeschlossenem Nachladen.', look: [0, -70], actions: [unfreeze, wait(2600)] },
  { name: 'pause', description: 'Sichtbarer Pausendialog nach Escape.', actions: [{ type: 'keys', keys: ['Escape'] }, phaseCheck('paused')] },
];

const suites = {
  world: suite('bodycam-demo/_dev/world/index.html?debug=1', 'Welt: Spawn, Veranda, beide Flurabschnitte und jeder Innenraum.', cameraShots, {
    beforeReady: [worldBeforeReady],
    integration: 'C12 liefert Bereitschaft ueber stats().ready. beforeReady ergaenzt nur bei fehlendem ready einen Getter auf dieses echte Signal; kein UI- oder Licht-Eingriff.',
  }),
  'world-legacy': suite('bodycam-demo/_dev/world/index.html?debug=1&lightmaps=0', 'Welt-Einzelmontage: Reproduktion des urspruenglichen C13-Ladepfads.', cameraShots, { beforeReady: [worldBeforeReady] }),
  'weapon-model': suite('bodycam-demo/_dev/weapon_model/index.html', 'Reale C9-Modellpruefseite, ohne Decoder-Patch im Harness.', ['overview','left','right','top','muzzle','receiver','sight','magazine'].map(view => ({ name: view, actions: [{ type: 'eval', code: `(() => { window.weaponTest.view(${JSON.stringify(view)}); if (!window.weaponTest.results.ok) throw new Error('Weapon model audit failed'); return window.weaponTest.results; })()` }] })), { beforeReady: [modelBeforeReady] }),
  character: suite('bodycam-demo/_dev/character/index.html', 'C10: roher Gewichts-Audit und alle statischen Prüfposen.',
    ['rest','fist','grip','arms-forward','squat','look-down'].map(pose => ({ name: pose, actions: [{ type: 'eval', code: `(() => {
      const c=window.characterTest; c.setPose('${pose}'); const s=c.snapshot();
      if(!s.ready || s.error || s.missingBones.length || ['nonNormalized','zeroWeights','invalidWeights','invalidJoints','overFour'].some(k=>s.audit[k])) throw new Error('Raw character audit failed: '+JSON.stringify(s.audit));
      return s;
    })()` }] })), { beforeReady: [{ type:'eval', code:`(() => {
      window.__bodycam={get ready(){return window.characterTest?.ready ?? false;}, stats(){return window.characterTest.snapshot();}};
    })()` }] }),
  weapon: suite('bodycam-demo/index.html?debug=1', 'App-Viewmodel: Low-Ready, ADS, Schuss, Oberflaechen, Huelsen und Nachladen.', weaponShots, { setup: [appSilent, appResume] }),
  postfx: suite('bodycam-demo/_dev/postfx/index.html', 'C5-Testszene: echte still/spin/dark/muzzle-Szenarien auf high, plus Raw-Vergleich.', [
    { name: 'scene-overview', description: 'C5 still: Startkamera fuer Maskenprofil, OSD, Schaerfetafel und gerade Linien; PostFX high.', actions: [postfxScenario('still')], settleMs: 1500, measureSeconds: 3 },
    { name: 'spin', description: 'C5 spin: echte Drehung fuer Bewegungsunschaerfe und Makrobloecke; eigene Testszene, keine Hauskoordinaten.', actions: [postfxScenario('spin')], settleMs: 1500, measureSeconds: 3 },
    { name: 'dark', description: 'C5 dark: Raumlicht auf darkGain reduziert, Waffenlicht an; Belichtung kann sich vor der Aufnahme anpassen.', actions: [postfxScenario('dark')], settleMs: 1500, measureSeconds: 3 },
    { name: 'muzzle', description: 'C5 muzzle: dauerhaftes Test-Muendungsfeuer via holdMuzzle. Reproduzierbarer Effektvergleich, keine Aussage ueber Dauer eines echten Schusses.', actions: [postfxScenario('muzzle')], settleMs: 1500, measureSeconds: 3 },
    { name: 'raw-overview', description: 'C5 still im echten Raw-Modus (ACES), gleiche Startkamera fuer den Vergleich mit scene-overview.', actions: [postfxScenario('still', 'raw')], settleMs: 1500, measureSeconds: 3 },
  ], {
    beforeReady: [postfxBeforeReady],
    integration: 'Harness-Adapter reicht das echte postfxDemo.ready-Promise und postfxDemo.stats samt renderer.info weiter. Szenarien verwenden setScenario(), setMode(), setQuality() und resume() aus _dev/postfx/demo.js. Keine Aenderung an C5-Dateien.',
  }),
  lightmaps: suite('bodycam-demo/_dev/lightmaps/index.html', 'C6: elf Kamerapunkte ueber die echte setCamera-API.', lightmapShots, { integration: 'C6 exportiert __bodycam.ready und __lightmaps.setCamera. Kamerahoehe absolut, Fussposition plus 1.40 m.' }),
  app: suite('bodycam-demo/index.html?debug=1', 'App: alle Layout-Raeume sowie Licht, ADS, Schuss, Nachladen und Blick nach unten.', appShots, { setup: [appSilent], integration: 'Echte resume/pause-Hooks und Escape; natives Audio-Sink none vor Start, kein Mock. Start und Pause bleiben sichtbar.' }),
};
suites['arms-shots'] = createArmsShots();
suites['npc-shots'] = createNPCShots();
suites['app-lightmaps'] = suite('bodycam-demo/index.html?debug=1&lightmaps=1', 'Identische App-Kamerapunkte mit Lightmaps an/aus.', [1, 0].flatMap(lightmaps => ['spawn','hall-long','bathroom','utility'].map((name,index) => {
  const shot = cameraShots.find(s => s.name === name);
  return { ...shot, name: `${name}-lightmaps-${lightmaps}`, ...(index === 0 && lightmaps === 0 ? { page: 'bodycam-demo/index.html?debug=1&lightmaps=0' } : {}), actions: [{ type: 'eval', code: `(() => { const s=window.__bodycam.world.stats; if (s.lightmaps !== ${Boolean(lightmaps)}) throw new Error('Wrong lightmap path'); return s; })()` }] };
})), { setup: [appSilent, appResume] });
if (!check) await mkdir(join(here, 'shots'), { recursive: true });
for (const [name, data] of Object.entries(suites)) {
  assert.equal(new Set(data.shots.map((shot) => shot.name)).size, data.shots.length, `${name}: duplicate shot names`);
  const file = join(here, 'shots', `${name}.json`);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (check) assert.equal(await readFile(file, 'utf8'), text, `${file} is stale; rerun generate-shots.mjs`);
  else await writeFile(file, text);
  console.log(`${check ? 'Checked' : 'Wrote'} ${name}.json (${data.shots.length} shots)`);
}
