import * as THREE from 'three';
import { createDemo } from '../../js/app/runtime.js';
import { createCapsuleInspection } from './capsules.js';

// Inspection-only parameters. Production lighting, post-FX and NPC behavior stay in their own modules.
export const TEST_CONFIG = {
  quality: 'low', neutral: true, exposure: 1, hemisphereIntensity: 2.4,
  keyIntensity: 1.8, keyOffset: [2, 5, 3], inspectDistance: 2.8,
  targetHeight: 1.1, maxFrameSeconds: 0.1, hudIntervalMs: 180,
  mouseDegreesPerPixel: 0.18, eventLimit: 80,
};
const canvas = document.querySelector('#view');
const metrics = document.querySelector('#metrics');
const loading = document.querySelector('#loading');
const eventView = document.querySelector('#events');
const url = new URL(location.href);
if (!url.searchParams.has('npcdebug')) { url.searchParams.set('npcdebug', '1'); history.replaceState(null, '', url); }
let app, inspection, capsules, paused = url.searchParams.get('pause') === '1', ready = false, disposed = false;
let raf = 0, last = performance.now(), lastHud = -Infinity, frames = 0, removeEvents = () => {};
const events = [], intervals = [];
const $ = id => document.getElementById(id);
const selected = () => app?.npcs?.npcs.find(npc => npc.id === $('npc').value) ?? app?.npcs?.npcs[0];
const error = reason => { loading.hidden = false; loading.textContent = `Prüfung fehlgeschlagen: ${reason.message ?? reason}`; console.error(reason); };

function renderRaw() {
  const { renderer, scene, camera } = app.dev;
  const oldExposure = renderer.toneMappingExposure, oldLayer = camera.layers.mask;
  const background = scene.background;
  try {
    renderer.info.reset(); renderer.toneMappingExposure = TEST_CONFIG.exposure;
    renderer.setRenderTarget(null); camera.layers.set(0); renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth(); camera.layers.set(1); scene.background = null;
    renderer.render(scene, camera);
  } finally {
    camera.layers.mask = oldLayer; scene.background = background;
    renderer.toneMappingExposure = oldExposure;
  }
}
function render() {
  if (!app?.ready || disposed) return;
  inspection.visible = TEST_CONFIG.neutral;
  capsules?.update();
  if (TEST_CONFIG.neutral) renderRaw();
  else app.dev.render();
  frames++;
}
function stats() {
  const mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  return { ...app?.stats(), testReady: ready, testPaused: paused, testDisposed: disposed,
    testFrames: frames, testFPS: mean ? 1000 / mean : 0, testConfig: { ...TEST_CONFIG },
    npcs: app?.npcs?.state(), events: events.slice(), selected: selected()?.id ?? null };
}
function updateHud() {
  lastHud = performance.now();
  if (!app?.ready || disposed) return;
  const a = app.stats(), state = app.npcs?.state();
  const rows = Array.isArray(state) ? state : state?.npcs ?? [];
  metrics.textContent = [
    `${ready ? 'Bereit' : 'Lädt'} · ${paused ? 'Pause' : 'Simulation läuft'} · ${a.gpu}`,
    `Echte Module: Welt ${a.modules.world} · Spieler ${a.modules.player} · Waffe ${a.modules.weapon}`,
    `NPCs: ${app.npcs?.npcs.length ?? 0} · Spielerraum ${a.room?.id ?? a.room ?? 'OUT'}`,
    `Prüfseite ${stats().testFPS.toFixed(1)} rAF-FPS · ${a.drawCalls} Draw-Calls · ${a.triangles} Dreiecke`,
    ...rows.map(npc => `${npc.id}: ${npc.state ?? npc.stateMachine?.state} · HP ${Number.isFinite(npc.health) ? Number(npc.health.toFixed(2)) : '?'} · ${npc.roomId ?? npc.room ?? '?'}\n  Position ${npc.position?.map(n => n.toFixed(2)).join(', ') ?? '?'} · Pfad ${npc.path?.length ?? npc.navigation?.points?.length ?? 0}`),
    a.issues.length ? `App-Probleme: ${JSON.stringify(a.issues)}` : 'App meldet keine Probleme.',
  ].join('\n');
  eventView.textContent = events.slice(-14).map(event => JSON.stringify(event)).join('\n');
  if (selected()) $('state').value = selected().stateMachine?.state ?? $('state').value;
  $('ads').checked = (a.weapon?.ads ?? 0) > 0.5;
}
function freeze(on = true) {
  paused = !!on; last = performance.now(); intervals.length = 0;
  $('pause').textContent = paused ? 'Weiter' : 'Pause';
  updateHud(); return paused;
}
function step(seconds = 1 / 60) {
  if (!app?.ready || disposed) return stats();
  app.dev.step(seconds); render(); updateHud(); return stats();
}
function select(id) {
  if (!app.npcs?.npcs.some(npc => npc.id === id)) throw new Error(`Unbekannter NPC: ${id}`);
  $('npc').value = id; updateHud(); return selected();
}
function setState(id, state, detail = {}) {
  const result = app.npcs.setState(id, state, detail); step(0); return result;
}
function moveTo(id, goal, options = {}) {
  const result = app.npcs.moveTo(id, goal, { state: 'flee', allowDoorPush: true, ...options });
  step(0); return result;
}
function teleportNPC(id, position, yawDeg) {
  const result = app.npcs.teleport(id, position, yawDeg); step(0); return result;
}
function inspect(id = selected()?.id) {
  const npc = app.npcs?.npcs.find(n => n.id === id);
  if (!npc) return;
  const target = npc.position.clone().add(new THREE.Vector3(0, TEST_CONFIG.targetHeight, 0));
  const nav = app.npcs.navigation;
  const roomId = app.world.roomAt(npc.position)?.id;
  let feet, best = Infinity;
  for (const distance of [TEST_CONFIG.inspectDistance, 2.2, 1.7, 1.2, 0.8]) for (let index = 0; index < 16; index++) {
    const angle = index * Math.PI * 2 / 16;
    const trial = npc.position.clone().add(new THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance));
    const candidate = nav.nearest(trial, { roomId, maxDistance: 0.3 });
    if (!candidate) continue;
    const eye = candidate.clone().add(new THREE.Vector3(0, 1.4, 0));
    const direction = target.clone().sub(eye), length = direction.length();
    if (app.player.physics.collision.raycast(eye, direction.normalize(), Math.max(0, length - 0.1))) continue;
    const score = Math.abs(length - TEST_CONFIG.inspectDistance) + Math.min(index, 16 - index) * 0.06;
    if (score < best) { best = score; feet = candidate; }
  }
  feet ??= nav.nearest(npc.position.clone().add(new THREE.Vector3(0, 0, 0.8)), { roomId }) ?? npc.position.clone();
  app.teleport(feet.x, feet.y, feet.z);
  const direction = target.sub(app.dev.camera.position).normalize();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), direction, new THREE.Vector3(0, 1, 0)));
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
  app.look(THREE.MathUtils.radToDeg(euler.y), THREE.MathUtils.radToDeg(euler.x));
  inspection.children[1].position.copy(npc.position).add(new THREE.Vector3().fromArray(TEST_CONFIG.keyOffset));
  inspection.children[1].target.position.copy(npc.position).add(new THREE.Vector3(0, 1, 0));
  step(0);
}
function debug(on = true) {
  if (app?.npcs?.debug?.setEnabled) app.npcs.debug.setEnabled(!!on);
  else if (app?.npcs?.debug) app.npcs.debug.enabled = !!on;
  capsules?.setEnabled(!!on);
  $('debug').checked = !!on; step(0);
}
function neutral(on = true) { TEST_CONFIG.neutral = !!on; $('neutral').checked = !!on; render(); }
function fillSelect(id, entries) {
  $(id).replaceChildren(...entries.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
}
function captureEvent(event) {
  if (!event.type.startsWith('npc.') && !['player.damage', 'shot', 'step'].includes(event.type)) return;
  const vector = value => value?.toArray?.() ?? value;
  const row = { type: event.type, id: event.id ?? event.npcId, zone: event.zone,
    state: event.state, previous: event.previous, roomId: event.roomId, damage: event.damage,
    position: vector(event.position), point: vector(event.point), normal: vector(event.normal) };
  events.push(row); if (events.length > TEST_CONFIG.eventLimit) events.shift();
}
async function rebuild() {
  ready = false; removeEvents(); capsules?.dispose(); await app?.dispose();
  inspection?.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
  events.length = 0; intervals.length = 0;
  loading.hidden = false; loading.textContent = 'Echte Szene und Modelle werden geladen …';
  app = await createDemo({ canvas, quality: TEST_CONFIG.quality, volume: 0, debug: true,
    onProgress: event => { loading.textContent = `${event.label} · ${Math.round(event.progress * 100)} %`; } });
  window.__bodycam = app;
  // This is the native Chromium silent output, selected before unlocking the real audio engine.
  if (app.dev.audio?.context?.setSinkId) await app.dev.audio.context.setSinkId({ type: 'none' });
  await app.resume(); app.dev.freeze(true);
  inspection = new THREE.Group(); inspection.name = 'NPCNeutralInspectionLights';
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x777777, TEST_CONFIG.hemisphereIntensity);
  const key = new THREE.DirectionalLight(0xffffff, TEST_CONFIG.keyIntensity);
  hemisphere.layers.enable(1); key.layers.enable(1);
  key.position.fromArray(TEST_CONFIG.keyOffset);
  inspection.add(hemisphere, key, key.target); app.dev.scene.add(inspection);
  capsules = createCapsuleInspection({ scene: app.dev.scene, manager: app.npcs });
  capsules.setEnabled($('debug').checked);
  fillSelect('npc', (app.npcs?.npcs ?? []).map(npc => [npc.id, npc.id]));
  fillSelect('room', app.world.rooms.filter(room => !room.outdoor).map(room => [room.id, `${room.id} · ${room.name ?? room.id}`]));
  fillSelect('door', app.world.doors.map(door => [door.id, door.id]));
  for (const id of ['npc', 'inspect', 'face', 'move', 'place', 'state-set', 'npc-fire']) $(id).disabled = !app.npcs?.npcs.length;
  removeEvents = app.bus.on('*', captureEvent);
  ready = true; loading.hidden = true;
  if (selected()) inspect();
  freeze(paused); step(0);
  return stats();
}
async function dispose() {
  if (disposed) return;
  disposed = true; ready = false; cancelAnimationFrame(raf); removeEvents(); capsules?.dispose(); await app?.dispose();
}
window.npcTest = { get ready() { return ready; }, get app() { return app; }, get config() { return TEST_CONFIG; },
  stats, freeze, step, select, setState, moveTo, teleportNPC, inspect, debug, neutral, rebuild, dispose,
};
$('pause').onclick = () => freeze(!paused);
$('step').onclick = () => { freeze(true); step(); };
$('inspect').onclick = () => inspect();
$('face').onclick = () => { if (selected()) app.npcs.look(selected().id, app.dev.camera.position); step(0); };
$('move').onclick = () => { if (selected()) { moveTo(selected().id, $('room').value); freeze(false); } };
$('place').onclick = () => { if (selected()) teleportNPC(selected().id, app.npcs.navigation.roomGoal($('room').value)); };
$('state-set').onclick = () => { if (selected()) setState(selected().id, $('state').value, { source: 'dev-page' }); };
$('npc-fire').onclick = () => { if (selected()) app.npcs.fire(selected().id); step(0); };
$('weapon-fire').onclick = () => { app.weapon?.fire(1); step(0.13); };
$('ads').onchange = event => { app.weapon?.ads(event.target.checked); step(0.3); };
for (const [id, angle] of [['open', 100], ['close', 0]]) $(id).onclick = () => {
  const door = app.world.doors.find(item => item.id === $('door').value);
  if (door) { door.setAngle(Math.min(angle, door.maxAngle)); door.velocity = 0; door.latched = !angle; step(0); }
};
$('debug').onchange = event => debug(event.target.checked);
$('neutral').onchange = event => neutral(event.target.checked);
$('npc').onchange = () => updateHud();
$('rebuild').onclick = () => { void rebuild().catch(error); };
let drag;
// Native keyboard movement stays active; this page owns mouse dragging and uses the explicit shot button.
for (const type of ['mousedown', 'mouseup', 'mousemove']) canvas.addEventListener(type, event => event.stopPropagation());
canvas.addEventListener('pointerdown', event => { if (event.button === 0) { drag = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); } });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointermove', event => {
  if (!drag || !app?.ready) return;
  const player = app.player.stats(), scale = TEST_CONFIG.mouseDegreesPerPixel;
  app.look(player.yawDeg - (event.clientX - drag[0]) * scale,
    THREE.MathUtils.clamp(player.pitchDeg - (event.clientY - drag[1]) * scale, -85, 85));
  drag = [event.clientX, event.clientY]; render();
});
function frame(now) {
  const elapsed = (now - last) / 1000; last = now;
  try {
    if (ready && !disposed) {
      if (!paused && elapsed > 0) {
        app.dev.step(Math.min(elapsed, TEST_CONFIG.maxFrameSeconds));
        intervals.push(elapsed * 1000); if (intervals.length > 240) intervals.shift();
      }
      render(); if (now - lastHud > TEST_CONFIG.hudIntervalMs) updateHud();
    }
  } catch (reason) { freeze(true); error(reason); }
  if (!disposed) raf = requestAnimationFrame(frame);
}
window.addEventListener('pagehide', () => { void dispose(); }, { once: true });
try { await rebuild(); raf = requestAnimationFrame(frame); } catch (reason) { error(reason); }
