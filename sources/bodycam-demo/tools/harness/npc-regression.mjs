import path from 'node:path';
import { measureFrames } from './metrics.mjs';
import { configureAudioOutput, DEFAULT_AUDIO_SINK } from './audio-output.mjs';

/** Standalone C19 group. All acceptance scenes use the real App world, player,
 * weapon and officer skins. Controlled stimuli are sent to the real event bus.
 * No HTTP responses, WebGL calls, constructors or production methods are mocked.
 */
export async function runNPCRegression({ page, origin, out, audioSink = DEFAULT_AUDIO_SINK }) {
  const checks = [], evidence = { outputDirectory: out, screenshots: [], performance: [] };
  const run = async (name, fn) => {
    try {
      const result = await page.evaluate(fn);
      checks.push(...result.checks); evidence[name] = result.evidence;
    } catch (error) { checks.push({ name: `npc-${name}-execution`, passed: false, details: { error: String(error.stack ?? error) } }); }
  };
  const shot = async (file, description) => {
    await page.screenshot({ path: path.join(out, file), fullPage: false });
    evidence.screenshots.push({ file, description });
  };
  if (!await page.evaluate(() => window.npcTest?.ready === true))
    await page.goto(`${origin}/bodycam-demo/_dev/npc/?npcdebug=1&pause=1&behavior=0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.npcTest?.ready === true, { timeout: 120000 });
  evidence.audioOutput = await configureAudioOutput(page, audioSink);
  await run('startup', setup);
  await shot('npc-debug-overview.png', 'Echte Haus-Szene mit Officer-Platzhalter, Sichtkegel und Zustandsanzeige');
  await run('perception', sightTests);
  await run('hearing', hearingTests);
  await run('navigation-setup', prepareNavigation);
  await shot('npc-door-path.png', 'A*-Pfad vom Flur ins Schlafzimmer bei geschlossener echter Tür');
  await run('navigation', navigationTests);
  await shot('npc-door-arrived.png', 'NPC nach eigenem Türimpuls im Zielraum');
  await run('navigation-network', navigationNetworkTests);
  await run('zones', hitZoneTests);
  await shot('npc-capsules.png', 'Trefferkapseln am echten Officer-Skelett und tatsächlicher Karabiner-Treffer');
  await run('shooting', shootingTests);
  await run('states', stateTests);
  await shot('npc-states.png', 'Zustandsgerüst, fehlende Contract-Clips und terminaler Tod');
  await run('factory-cleanup', factoryCleanupTests);
  await run('disposal', disposalTests);
  await page.evaluate(() => window.npcTest.rebuild());
  evidence.rebuiltAudioOutput = await configureAudioOutput(page, audioSink);
  await run('rebuild', rebuildTests);
  await shot('npc-rebuilt.png', 'Neu geladene Welt und drei unabhängige NPC-Instanzen');
  try {
    const performance = await performanceTests({ page, origin, shot, audioSink });
    checks.push(...performance.checks); evidence.performance = performance.evidence;
  } catch (error) { checks.push({ name: 'npc-performance-execution', passed: false, details: { error: String(error.stack ?? error) } }); }
  return { checks, evidence };
}

async function setup() {
  const T = await import('three');
  const app = window.__bodycam, m = app?.npcs;
  if (!m?.npcs?.length || !app.dev) throw new Error('Real App NPC/world/debug hooks unavailable');
  window.npcTest.freeze(true); app.dev.freeze(true);
  const checks = [], events = [];
  const copy = event => {
    const row = { type: event.type, npcId: event.npcId, zone: event.zone, part: event.part,
      from: event.from, to: event.to, state: event.state, amount: event.amount, damage: event.damage,
      kind: event.kind, sourceRoom: event.sourceRoom, listenerRoom: event.listenerRoom,
      distance: event.distance, loudness: event.loudness, gain: event.gain, hops: event.hops, route: event.route,
      position: event.position?.toArray?.() ?? event.position, point: event.point?.toArray?.() ?? event.point,
      normal: event.normal?.toArray?.() ?? event.normal };
    if (event.type !== 'cameraRecoil') events.push(row);
  };
  const off = app.bus.on('*', copy);
  const vec = value => value?.isVector3 ? value.clone() : new T.Vector3().fromArray(value);
  const npc = m.npcs[0];
  const originalDoors = app.world.doors.map(door => ({ door, angle: door.angle, velocity: door.velocity,
    latched: door.latched, targetAngle: door.targetAngle }));
  function doorsRestore() {
    for (const saved of originalDoors) {
      saved.door.setAngle(saved.angle); saved.door.velocity = saved.velocity;
      saved.door.latched = saved.latched; saved.door.targetAngle = saved.targetAngle;
    }
  }
  function doorSet(door, angle) { door.setAngle(angle); door.velocity = 0; door.latched = angle === 0; }
  const capsulePenetration = position => {
    const radius = m.config.navigation.radius, height = m.config.navigation.height;
    let maximum = 0, object = null;
    for (const collider of [app.world.colliders.static, ...app.world.colliders.doors]) {
      collider.updateWorldMatrix(true, false);
      const inverse = collider.matrixWorld.clone().invert(), scale = collider.matrixWorld.getMaxScaleOnAxis();
      const segment = new T.Line3(position.clone().add(new T.Vector3(0, radius, 0)).applyMatrix4(inverse),
        position.clone().add(new T.Vector3(0, height - radius, 0)).applyMatrix4(inverse));
      const bounds = new T.Box3().setFromPoints([segment.start, segment.end]).expandByScalar(radius / scale);
      collider.geometry.boundsTree.shapecast({
        intersectsBounds: box => box.intersectsBox(bounds),
        intersectsTriangle: triangle => {
          const distance = triangle.closestPointToSegment(segment, new T.Vector3(), new T.Vector3()) * scale;
          if (radius - distance > maximum) { maximum = radius - distance; object = collider.name; }
          return false;
        },
      });
    }
    return { maximum, object };
  };
  window.__npcChecks = { T, app, m, npc, events, off, vec, doorsRestore, doorSet, capsulePenetration, originalDoors,
    push(name, passed, details) { checks.push({ name: `npc-${name}`, passed: !!passed, details }); },
    restoreSpawns() {
      for (const record of m.npcs) {
        const spawn = app.world.suspects.find(entry => entry.id === record.id);
        if (spawn) m.teleport(record.id, spawn.position ?? spawn.pos, spawn.yawDeg);
        if (record.stateMachine.state !== 'dead') m.setState(record.id, 'idle');
      }
      doorsRestore(); app.dev.step(0);
    },
  };
  const state = m.state(), a = app.stats();
  const skins = m.npcs.map(record => {
    const meshes = []; record.model.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); }); return meshes;
  });
  checks.push({ name: 'npc-real-app-and-three-models', passed: a.modules.world && a.modules.player && a.modules.weapon
    && a.modules.npcs && m.npcs.length === 3 && !a.issues.length && state.npcs.every(record => record.model.bones > 30
      && record.model.placeholder && record.model.sourceUrl.endsWith('/models/officer.glb')),
    details: { modules: a.modules, issues: a.issues, models: state.npcs.map(record => record.model) } });
  checks.push({ name: 'npc-independent-skins-and-shared-assets', passed: skins.every(list => list.length > 0)
    && skins[0][0].skeleton !== skins[1][0].skeleton && skins[0][0].geometry === skins[1][0].geometry
    // Costumes give each suspect its own colours; the clones stay derived from the one shared atlas material.
    && (skins[0][0].material === skins[1][0].material || [skins[0][0], skins[1][0]].every(mesh => mesh.material.name.startsWith('MU_OfficerAtlas'))),
    details: { skins: skins.map(list => list.length), skeletonIndependent: skins[0][0]?.skeleton !== skins[1][0]?.skeleton,
      geometryShared: skins[0][0]?.geometry === skins[1][0]?.geometry } });
  checks.push({ name: 'npc-fourteen-bone-hit-capsules-per-instance', passed: state.npcs.every(record => record.hitZones.count === 14
    && record.hitZones.active === 14 && record.hitZones.capsules.every(capsule => capsule.bones.every(Boolean))),
    details: { zones: state.npcs.map(record => record.hitZones) } });
  const spawns = m.npcs.map(record => ({ id: record.id, position: record.position.toArray(), spawn: record.spawn,
    actualRoom: app.world.roomAt(record.position.clone().add(new T.Vector3(0, 0.08, 0)))?.id,
    penetration: capsulePenetration(record.position) }));
  checks.push({ name: 'npc-projected-spawns-clear-and-in-declared-room', passed: spawns.every(record => record.penetration.maximum <= 0.006
    && record.actualRoom === record.spawn.roomId && record.spawn.distance <= m.config.spawnProjection.maxDistance), details: { spawns } });
  checks.push({ name: 'npc-real-audio-engine', passed: a.audioMode !== 'synthetic' && a.modules.audio && !a.audio.failed,
    details: { audioMode: a.audioMode, diagnostics: a.audio, sink: app.dev.audio.context.sinkId } });
  return { checks, evidence: { initial: state, app: a } };
}

function sightTests() {
  const { app, m, npc, T, doorSet, doorsRestore } = window.__npcChecks;
  const checks = [], cases = [];
  const sample = (name, position, playerPosition, expected, reason, doorAngle) => {
    m.teleport(npc.id, position); m.setState(npc.id, 'idle');
    app.teleport(...playerPosition, 0, 0); m.look(npc.id, app.dev.camera.position);
    if (doorAngle !== undefined) doorSet(app.world.doors.find(door => door.id === 'bed1'), doorAngle);
    const result = m.perceive(npc.id); cases.push({ name, position: npc.position.toArray(), player: app.player.position.toArray(), result });
    checks.push({ name: `npc-sight-${name}`, passed: result.visible === expected && (!reason || result.reason === reason), details: cases.at(-1) });
    return result;
  };
  try {
    sample('free-line', [-0.28, 0.603, -2.4], [-0.28, 0.603, -4.5], true, 'clear');
    npc.root.rotation.y += Math.PI; npc.root.updateWorldMatrix(true, true);
    const behind = m.perceive(npc.id);
    checks.push({ name: 'npc-sight-cone-rejects-behind', passed: !behind.visible && behind.reason === 'cone', details: behind });
    const originalRange = m.config.perception.range;
    m.config.perception.range = 0.5;
    const far = m.perceive(npc.id);
    m.config.perception.range = originalRange;
    checks.push({ name: 'npc-sight-range-is-live-parameter', passed: !far.visible && far.reason === 'range', details: far });
    sample('wall-bvh', [-0.28, 0.603, -2.4], [2.0, 0.603, -2.4], false, 'occluded');
    sample('closed-door-bvh', [4.3, 0.603, -3.55], [4.3, 0.603, -4.95], false, 'occluded', 0);
    sample('open-door-live-transform', [4.3, 0.603, -3.55], [4.3, 0.603, -4.95], true, 'clear', 100);
    doorSet(app.world.doors.find(door => door.id === 'bed1'), 0);
    const reclosed = m.perceive(npc.id);
    checks.push({ name: 'npc-sight-reclosed-door-no-stale-bvh', passed: !reclosed.visible && reclosed.reason === 'occluded', details: reclosed });
    m.teleport(npc.id, [-0.28, 0.603, -2.4]); app.teleport(-0.28, 0.603, -4.5, 0, 0);
    m.look(npc.id, app.dev.camera.position); m.setState(npc.id, 'idle');
    const seen = []; const off = app.bus.on('npc.seen', event => seen.push({ npcId: event.npcId, visible: event.visible, roomId: event.roomId }));
    try { m.update(m.config.perception.intervalSeconds + 0.01); } finally { off(); }
    checks.push({ name: 'npc-sight-event-and-config-transition', passed: seen.some(event => event.npcId === npc.id)
      && npc.stateMachine.state === m.config.transitions.idle.sight, details: { seen, state: npc.stateMachine.state } });
  } finally { doorsRestore(); }
  return { checks, evidence: { cases } };
}

function hearingTests() {
  const { app, m, npc, events, doorSet, doorsRestore } = window.__npcChecks;
  const checks = [], stimuli = [];
  const config = m.config.perception.hearing, threshold = config.threshold;
  config.threshold = 0;
  const stimulate = (name, source, kind = 'shot') => {
    const start = events.length;
    app.bus.emit(kind, { weapon: 'rifle', position: new window.__npcChecks.T.Vector3(...source),
      roomId: 'INTENTIONALLY_WRONG_TEST_ROOM', loudness: 1 });
    const heard = events.slice(start).find(event => event.type === 'npc.heard' && event.npcId === npc.id);
    const item = { name, source, heard: heard ?? null }; stimuli.push(item); return heard;
  };
  try {
    m.teleport(npc.id, [4.3, 0.603, -4.95]); m.setState(npc.id, 'idle');
    const same = stimulate('same-room', [3.0, 0.8, -4.95]);
    doorSet(app.world.doors.find(door => door.id === 'bed1'), 0);
    const closed = stimulate('adjacent-closed', [4.3, 0.8, -3.55]);
    doorSet(app.world.doors.find(door => door.id === 'bed1'), 100);
    const open = stimulate('adjacent-open', [4.3, 0.8, -3.55]);
    checks.push({ name: 'npc-hearing-roomAt-overrides-input-roomId', passed: same?.sourceRoom === 'HAL'
      && same.listenerRoom === 'HAL' && closed?.sourceRoom === 'BED1' && closed.listenerRoom === 'HAL', details: { same, closed } });
    checks.push({ name: 'npc-hearing-same-and-adjacent-door-attenuation', passed: same?.gain === config.sameRoomGain
      && Math.abs((closed?.gain ?? NaN) - config.closedDoorGain) < 1e-8 && Math.abs((open?.gain ?? NaN) - config.openRoomGain) < 1e-8
      && open.loudness > closed.loudness && closed.hops === 1, details: { same, closed, open, config } });
    const closeStep = stimulate('near-step', [4.3, 0.8, -4.0], 'step');
    const farStep = stimulate('out-of-step-range', [-6, 0.8, -1], 'step');
    checks.push({ name: 'npc-hearing-step-kind-and-range', passed: closeStep?.kind === 'step' && !farStep,
      details: { closeStep, farStep: farStep ?? null, range: config.stepRange } });
    app.teleport(3.0, 0.603, -4.95, 90, 0); app.weapon.update(1);
    const before = events.length, count = app.weapon.state().shots;
    app.weapon.fire(1); app.dev.step(0.2);
    const rifle = events.slice(before).filter(event => event.type === 'npc.heard' && event.npcId === npc.id);
    checks.push({ name: 'npc-hearing-real-rifle-bus', passed: app.weapon.state().shots === count + 1
      && rifle.some(event => event.kind === 'shot' && event.sourceRoom === 'HAL'), details: { rifle, shotsBefore: count, shotsAfter: app.weapon.state().shots } });
    m.teleport(npc.id, [-0.28, 0.603, -5.8]); app.teleport(-0.28, 0.603, -3.8, 0, 0);
    canvasFocus();
    const beforeSteps = app.player.stats().steps, offset = events.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    try { app.dev.step(1.1); } finally { document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })); }
    const actualStep = events.slice(offset).filter(event => event.type === 'step');
    const npcStep = events.slice(offset).filter(event => event.type === 'npc.heard' && event.npcId === npc.id && event.kind === 'step');
    checks.push({ name: 'npc-hearing-real-player-step-bridge', passed: app.player.stats().steps > beforeSteps && actualStep.length > 0
      && npcStep.length > 0 && npcStep.every(event => event.sourceRoom === 'HAL'), details: { beforeSteps, after: app.player.stats().steps, actualStep, npcStep } });
  } finally { config.threshold = threshold; doorsRestore(); }
  return { checks, evidence: { stimuli } };
  function canvasFocus() { document.querySelector('#view').focus(); window.dispatchEvent(new Event('focus')); }
}

function prepareNavigation() {
  const { app, m, npc, doorSet, T } = window.__npcChecks;
  for (const door of app.world.doors) doorSet(door, door.maxAngle);
  const door = app.world.doors.find(item => item.id === 'bed1'); doorSet(door, 0);
  app.teleport(5.65, 0.603, -4.95, 122, -7);
  const start = m.navigation.nearest(new T.Vector3(4.3, 0.603, -4.95), { roomId: 'HAL' });
  const goal = m.navigation.roomGoal('BED1');
  if (!start || !goal) throw new Error('Baked HAL/BED1 navigation goals absent');
  m.teleport(npc.id, start); m.setState(npc.id, 'idle');
  const blocked = m.navigation.plan(start, goal, { allowDoorPush: false });
  const allowed = m.moveTo(npc.id, 'BED1', { state: 'flee', allowDoorPush: true });
  window.npcTest.select(npc.id); window.npcTest.debug(true); app.dev.step(0);
  window.__npcChecks.navCase = { start, goal, door, allowed };
  return { checks: [{ name: 'npc-navigation-closed-door-path-policy', passed: blocked.status === 'unreachable'
    && allowed.status === 'ok' && allowed.doors.includes('bed1') && allowed.points.length > 1,
    details: { start: start.toArray(), goal: goal.toArray(), blocked, allowed } }],
    evidence: { start: start.toArray(), goal: goal.toArray(), blocked, allowed } };
}

function navigationTests() {
  const { app, m, npc, T, capsulePenetration, events, navCase } = window.__npcChecks;
  if (!navCase) throw new Error('Navigation setup failed');
  const checks = [], trace = [], { door, goal } = navCase;
  const offset = events.length;
  const advance = () => { app.player.update(1 / 120); m.update(1 / 120); };
  let maxPenetration = 0, maxStep = 0, room, previous = npc.position.clone(), doorOpened = false;
  for (let frame = 0; frame < 3600; frame++) {
    advance();
    maxStep = Math.max(maxStep, npc.position.distanceTo(previous)); previous.copy(npc.position);
    if (frame % 12 === 0) {
      const penetration = capsulePenetration(npc.position);
      maxPenetration = Math.max(maxPenetration, penetration.maximum);
      room = app.world.roomAt(npc.position.clone().add(new T.Vector3(0, 0.08, 0)))?.id;
      trace.push({ time: (frame + 1) / 120, position: npc.position.toArray(), room, state: npc.stateMachine.state,
        pathIndex: npc.pathIndex, pathLength: npc.path.length, doorAngle: door.angle, doorLatched: door.latched, penetration });
    }
    doorOpened ||= door.angle > 55;
    if (events.slice(offset).some(event => event.type === 'npc.arrived' && event.npcId === npc.id) || !npc.goal) break;
  }
  const arrived = events.slice(offset).filter(event => event.type === 'npc.arrived' && event.npcId === npc.id);
  checks.push({ name: 'npc-navigation-pushes-and-passes-real-door', passed: arrived.length === 1 && doorOpened
    && !door.latched && room === 'BED1' && npc.position.distanceTo(goal) < 0.2,
    details: { arrived, doorOpened, doorAngle: door.angle, room, distanceToGoal: npc.position.distanceTo(goal), final: m.state().npcs[0] } });
  window.__npcChecks.initialNavigation = { maxPenetration, maxStep };
  window.npcTest.inspect(npc.id); app.dev.step(0);
  return { checks, evidence: { trace, events: events.slice(offset) } };
}

function navigationNetworkTests() {
  const { app, m, npc, T, capsulePenetration, events, initialNavigation } = window.__npcChecks;
  const checks = [], routes = [], offset = events.length;
  const advance = () => { app.player.update(1 / 120); m.update(1 / 120); };
  let maxPenetration = initialNavigation?.maxPenetration ?? 0, maxStep = initialNavigation?.maxStep ?? 0;
  const previous = npc.position.clone();
  for (const roomId of ['HAL', 'LIV', 'KIT', 'BATH', 'BED2', 'HAL', 'BED1', 'CLO1', 'BED1', 'HAL', 'PORCH', 'OUT', 'PORCH', 'HAL']) {
    const plan = m.moveTo(npc.id, roomId, { state: 'flee', allowDoorPush: true });
    const began = m.time, before = events.length;
    let routePenetration = 0;
    previous.copy(npc.position);
    for (let tick = 0; tick < 3600 && npc.goal; tick++) {
      advance(); maxStep = Math.max(maxStep, npc.position.distanceTo(previous)); previous.copy(npc.position);
      if (tick % 12 === 0) routePenetration = Math.max(routePenetration, capsulePenetration(npc.position).maximum);
    }
    maxPenetration = Math.max(maxPenetration, routePenetration);
    const actualRoom = app.world.roomAt(npc.position.clone().add(new T.Vector3(0, 0.08, 0)))?.id;
    const ended = events.slice(before).some(event => event.type === 'npc.arrived' && event.npcId === npc.id);
    routes.push({ roomId, actualRoom, planStatus: plan.status, doors: plan.doors, elapsed: m.time - began, arrived: ended,
      position: npc.position.toArray(), maxPenetrationMeters: routePenetration, penetration: capsulePenetration(npc.position) });
  }
  checks.push({ name: 'npc-navigation-no-wall-or-leaf-phasing', passed: maxPenetration <= 0.006 && maxStep <= m.config.navigation.runSpeed / 120 + 0.001,
    details: { maxPenetrationMeters: maxPenetration, maxStepMeters: maxStep, thresholdMeters: 0.006,
      method: 'Independent shortest segment/triangle distance against real static and live door BVHs throughout all traversals; no collision resolve() or navigation.canMove() as oracle.' } });
  checks.push({ name: 'npc-navigation-debug-room-to-room-network', passed: routes.every(route => route.planStatus === 'ok'
    && route.arrived && route.actualRoom === route.roomId && route.penetration.maximum <= 0.006), details: { routes } });
  const utilityGoal = m.navigation.roomGoal('UTIL'), utilityPosition = npc.position.clone();
  const utilityPlan = m.moveTo(npc.id, 'UTIL', { state: 'flee', allowDoorPush: true });
  const utilityData = m.navigation.data.rooms.find(room => room.id === 'UTIL');
  checks.push({ name: 'npc-navigation-blocked-utility-room-remains-unreachable', passed: utilityData.reachable === false
    && utilityPlan.status === 'unreachable' && !npc.goal && npc.position.distanceTo(utilityPosition) < 1e-9,
    details: { utilityGoal, utilityData, utilityPlan, position: npc.position.toArray(),
      reason: 'Existing shelf/fridge collision splits utility floor from the main connected component. No obstacle or capsule is disabled.' } });
  const impossible = m.navigation.plan(npc.position, new T.Vector3(1000, 0.603, 1000), { allowDoorPush: true });
  const wallStart = new T.Vector3(-0.28, 0.603, -2.4), wallEnd = new T.Vector3(2, 0.603, -2.4);
  checks.push({ name: 'npc-navigation-off-grid-and-wall-rejection', passed: impossible.status === 'unreachable'
    && !m.navigation.canMove(wallStart, wallEnd, { allowDoorPush: true }), details: { impossible, wallStart, wallEnd } });
  window.npcTest.inspect(npc.id); app.dev.step(0);
  return { checks, evidence: { routes, events: events.slice(offset) } };
}

async function hitZoneTests() {
  const { app, m, npc, T, events, doorSet } = window.__npcChecks;
  const checks = [], hits = [];
  for (const door of app.world.doors) doorSet(door, door.maxAngle);
  m.teleport(npc.id, [-3.2, 0.603, -2.4]); m.setState(npc.id, 'idle');
  m.look(npc.id, new T.Vector3(-3.2, 1.7, 0));
  for (const other of m.npcs) if (other !== npc) other.root.visible = false;
  const damage = m.config.health.rifleDamage;
  m.config.health.rifleDamage = 1;
  try {
    const original = npc.hitZones.state().capsules;
    const headBefore = original.find(zone => zone.zone === 'head');
    npc.root.rotation.y += Math.PI / 3; npc.root.updateWorldMatrix(true, true); npc.hitZones.update();
    const headAfter = npc.hitZones.state().capsules.find(zone => zone.zone === 'head');
    const armBefore = original.find(zone => zone.id === 'arms.R.lower'), armAfter = npc.hitZones.state().capsules.find(zone => zone.id === 'arms.R.lower');
    checks.push({ name: 'npc-hit-capsules-follow-bones-and-root-transform', passed: new T.Vector3().fromArray(armBefore.start).distanceTo(new T.Vector3().fromArray(armAfter.start)) > 0.05
      && Math.abs(headBefore.radius - headAfter.radius) < 1e-8, details: { armBefore, armAfter, headBefore, headAfter } });
    m.look(npc.id, new T.Vector3(-3.2, 1.7, 0));
    for (const zoneName of ['head', 'torso', 'arms', 'legs']) {
      const attempt = [];
      let chosen;
      const capsules = npc.hitZones.state().capsules.filter(capsule => capsule.zone === zoneName && capsule.active);
      for (const capsule of capsules) {
        for (const fraction of [0.50, 0.75, 0.25]) {
          const target = new T.Vector3().fromArray(capsule.start).lerp(new T.Vector3().fromArray(capsule.end), fraction);
          for (const direction of [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 0, -1]]) {
            const eye = target.clone().addScaledVector(new T.Vector3(...direction), 2.5);
            // The real App eye height is fixed to its player. Pitch aligns the actual muzzle afterward.
            app.teleport(eye.x, 0.603, eye.z, 0, 0); app.weapon.ads(true); app.weapon.update(1);
            for (let iteration = 0; iteration < 20; iteration++) {
              const ray = app.weapon.raycast(), wanted = target.clone().sub(ray.position).normalize();
              if (ray.direction.angleTo(wanted) < 0.00002) break;
              const corrected = new T.Quaternion().setFromUnitVectors(ray.direction, wanted).multiply(app.dev.camera.quaternion);
              const euler = new T.Euler().setFromQuaternion(corrected, 'YXZ');
              app.look(T.MathUtils.radToDeg(euler.y), T.MathUtils.radToDeg(euler.x));
            }
            const ray = app.weapon.raycast();
            attempt.push({ capsule: capsule.id, fraction, direction, object: ray.hit?.object.name ?? null,
              npcId: ray.hit?.object.userData.npcId, zone: ray.hit?.object.userData.zone,
              muzzle: ray.position.toArray(), shotDirection: ray.direction.toArray(), target: target.toArray() });
            if (ray.hit?.object.userData.npcId === npc.id && ray.hit.object.userData.zone === zoneName) {
              chosen = { ray, capsule, target }; break;
            }
          }
          if (chosen) break;
        }
        if (chosen) break;
      }
      if (!chosen) {
        checks.push({ name: `npc-rifle-hit-${zoneName}`, passed: false, details: { attempts: attempt } }); continue;
      }
      const before = events.length, health = npc.health, count = app.weapon.state().shots;
      app.weapon.fire(1); app.dev.step(0.35);
      const hit = events.slice(before).find(event => event.type === 'npc.hit' && event.npcId === npc.id);
      const normal = hit?.normal ? new T.Vector3().fromArray(hit.normal) : null;
      const details = { zoneName, selectedCapsule: chosen.capsule.id, hit, healthBefore: health, healthAfter: npc.health,
        shotsBefore: count, shotsAfter: app.weapon.state().shots, ray: attempt.at(-1), attempts: attempt };
      hits.push(details);
      checks.push({ name: `npc-rifle-hit-${zoneName}`, passed: app.weapon.state().shots === count + 1 && hit?.zone === zoneName
        && npc.health < health && hit.point?.every(Number.isFinite) && normal && Math.abs(normal.length() - 1) < 1e-6
        && normal.dot(chosen.ray.direction) < 0.001, details });
    }
    const before = events.length, health = npc.health;
    app.teleport(3.2, 0.603, -2.4, 90, 0); app.weapon.ads(true); app.weapon.update(1);
    const target = npc.nodes.S_Head.getWorldPosition(new T.Vector3());
    for (let i = 0; i < 12; i++) {
      const ray = app.weapon.raycast(), wanted = target.clone().sub(ray.position).normalize();
      const q = new T.Quaternion().setFromUnitVectors(ray.direction, wanted).multiply(app.dev.camera.quaternion);
      const e = new T.Euler().setFromQuaternion(q, 'YXZ'); app.look(T.MathUtils.radToDeg(e.y), T.MathUtils.radToDeg(e.x));
    }
    const blocker = app.weapon.raycast(); app.weapon.fire(1); app.dev.step(0.35);
    const newHits = events.slice(before).filter(event => event.type === 'npc.hit' && event.npcId === npc.id);
    checks.push({ name: 'npc-rifle-wall-stops-hit-routing', passed: !!blocker.hit && !blocker.hit.object.userData.npcId
      && !newHits.length && npc.health === health, details: { blocker: blocker.hit?.object.name, newHits, healthBefore: health, healthAfter: npc.health } });
    window.npcTest.inspect(npc.id); app.dev.step(0);
  } finally {
    m.config.health.rifleDamage = damage;
    for (const other of m.npcs) other.root.visible = true;
  }
  return { checks, evidence: { hits, zones: npc.hitZones.state() } };
}

function shootingTests() {
  const { app, m, T, doorSet } = window.__npcChecks;
  const npc = m.npcs[1], checks = [], shots = [], damages = [], inputDamage = [];
  const config = m.config.shooting, old = { ...config };
  config.spreadDeg = 0; config.cooldownSeconds = 0.001;
  const offBus = app.bus.on('player.damage', event => damages.push({ npcId: event.npcId, amount: event.amount, point: event.point.toArray(), normal: event.normal.toArray() }));
  const offInput = app.player.input.on('damage', event => inputDamage.push({ npcId: event.npcId, amount: event.amount }));
  try {
    m.teleport(npc.id, [-0.28, 0.603, -2.4]); m.setState(npc.id, 'aim');
    app.teleport(-0.28, 0.603, -4.5, 0, 0); m.look(npc.id, app.dev.camera.position); m.update(0.01);
    const origin = npc.nodes.S_Muzzle.getWorldPosition(new T.Vector3()), aim = app.dev.camera.position.clone();
    const clear = m.fire(npc.id, aim);
    shots.push({ kind: 'clear', position: clear.position?.toArray(), direction: clear.direction?.toArray(), playerHit: !!clear.playerHit,
      obstruction: clear.obstruction?.object.name ?? null });
    checks.push({ name: 'npc-shot-muzzle-origin-and-player-damage-events', passed: clear.fired && clear.playerHit
      && clear.position.distanceTo(origin) < 1e-7 && Math.abs(clear.direction.length() - 1) < 1e-8
      && clear.direction.angleTo(aim.clone().sub(origin).normalize()) < 1e-7
      && damages.length === 1 && inputDamage.length === 1 && damages[0].amount === config.damage,
      details: { origin: origin.toArray(), clear: shots.at(-1), damages: damages.slice(), inputDamage: inputDamage.slice() } });
    const immediate = m.fire(npc.id, aim);
    checks.push({ name: 'npc-shot-cooldown-is-simulation-time', passed: !immediate.fired && immediate.reason === 'cooldown', details: immediate });
    m.update(0.01); app.teleport(2.0, 0.603, -2.4, 0, 0); m.look(npc.id, app.dev.camera.position);
    const before = damages.length, wall = m.fire(npc.id);
    shots.push({ kind: 'wall', playerHit: !!wall.playerHit, obstruction: wall.obstruction?.object.name ?? null });
    checks.push({ name: 'npc-shot-world-wall-stops-player-damage', passed: wall.fired && !!wall.obstruction && !wall.playerHit && damages.length === before,
      details: { wall: shots.at(-1), damageEventsBefore: before, damageEventsAfter: damages.length } });
    m.teleport(npc.id, [4.3, 0.603, -3.55]); app.teleport(4.3, 0.603, -4.95, 0, 0); m.look(npc.id, app.dev.camera.position);
    const door = app.world.doors.find(item => item.id === 'bed1'); doorSet(door, 0); m.update(0.01);
    const closed = m.fire(npc.id); doorSet(door, 100); m.update(0.01); const open = m.fire(npc.id);
    checks.push({ name: 'npc-shot-live-door-blocks-and-releases', passed: closed.fired && !closed.playerHit
      && closed.obstruction?.object.userData.doorId === 'bed1' && open.fired && !!open.playerHit,
      details: { closed: { playerHit: !!closed.playerHit, object: closed.obstruction?.object.name },
        open: { playerHit: !!open.playerHit, object: open.obstruction?.object.name } } });
    m.teleport(npc.id, [-0.28, 0.603, -2.4]); app.teleport(-0.28, 0.603, -4.5, 0, 0); m.look(npc.id, app.dev.camera.position);
    config.spreadDeg = 8;
    const angles = [];
    for (let i = 0; i < 24; i++) {
      m.update(0.002); const result = m.fire(npc.id);
      const intended = app.dev.camera.position.clone().sub(result.position).normalize();
      angles.push(T.MathUtils.radToDeg(result.direction.angleTo(intended)));
    }
    checks.push({ name: 'npc-shot-spread-respects-configured-cone', passed: Math.max(...angles) <= config.spreadDeg + 1e-5
      && Math.max(...angles) > 1 && new Set(angles.map(angle => angle.toFixed(5))).size > 12,
      details: { spreadDeg: config.spreadDeg, angles, method: '24 actual world raycasts; bounded angular deviation, no seeded/mock trajectory.' } });
    m.setState(npc.id, 'surrender'); m.update(0.002); const surrender = m.fire(npc.id);
    checks.push({ name: 'npc-surrender-blocks-manual-fire', passed: !surrender.fired && surrender.reason === 'state', details: surrender });
  } finally { Object.assign(config, old); offBus(); offInput(); }
  return { checks, evidence: { shots, damages, inputDamage } };
}

async function stateTests() {
  const { app, m, npc, events } = window.__npcChecks;
  const checks = [], states = [], hooks = [], oldHooks = { ...m.config.hooks };
  for (const name of ['onEnter', 'onExit', 'onTransition', 'onUpdate']) m.config.hooks[name] = event => hooks.push({ name, from: event.from, to: event.to, state: event.state, dt: event.dt });
  try {
    for (const state of ['idle', 'alert', 'flee', 'hide', 'aim', 'fire', 'surrender', 'hit']) {
      m.setState(npc.id, state, { source: 'regression' });
      const snapshot = m.state().npcs.find(record => record.id === npc.id);
      states.push({ requested: state, state: snapshot.state, animation: snapshot.animation, weapon: snapshot.model.weapon });
    }
    // officer.glb has no authored clips; procedural-clips.js builds the full contract set at load.
    const expected = { idle: 'Idle', alert: 'IdleNervous', flee: 'Run', hide: 'Crouch', aim: 'AimPistol',
      fire: 'FirePistol', surrender: 'Surrender', hit: 'HitReact' };
    checks.push({ name: 'npc-all-nonterminal-states-select-procedural-clips', passed: states.every(record => record.requested === record.state
      && !record.animation.restPose && record.animation.selected === expected[record.state] && record.animation.missingClips.length === 0
      && record.weapon === (['aim', 'fire'].includes(record.state) ? 'hand' : 'holster')), details: { states } });
    m.setState(npc.id, 'aim');
    const health = npc.health;
    m.hit(npc.id, { damage: 1, zone: 'arms' });
    const armed = m.state().npcs.find(record => record.id === npc.id);
    npc.health = health;
    checks.push({ name: 'npc-hit-with-drawn-pistol-uses-armed-reaction', passed: armed.state === 'hit'
      && armed.animation.selected === 'HitReactArmed' && armed.model.weapon === 'hand',
      details: { state: armed.state, selected: armed.animation.selected, weapon: armed.model.weapon } });
    m.setState(npc.id, 'idle');
    m.config.hooks.beforeTransition = event => event.to === 'aim' ? false : undefined;
    const prevented = m.setState(npc.id, 'aim');
    checks.push({ name: 'npc-state-beforeTransition-can-veto', passed: prevented === false && npc.stateMachine.state === 'idle', details: { prevented, state: npc.stateMachine.state } });
    m.config.hooks.beforeTransition = oldHooks.beforeTransition;
    m.config.hooks.decideTransition = event => event.signal === 'sound' ? 'surrender' : undefined;
    const callbackTransition = npc.stateMachine.signal('sound', { source: 'regression' });
    checks.push({ name: 'npc-state-callback-selects-transition', passed: callbackTransition && npc.stateMachine.state === 'surrender', details: { callbackTransition, state: npc.stateMachine.state } });
    m.config.hooks.decideTransition = oldHooks.decideTransition;
    const originalSound = m.config.transitions.idle.sound;
    m.config.transitions.idle.sound = 'hide'; m.setState(npc.id, 'idle'); npc.stateMachine.signal('sound');
    m.config.transitions.idle.sound = originalSound;
    checks.push({ name: 'npc-state-transition-table-is-live-parameter', passed: npc.stateMachine.state === 'hide', details: { state: npc.stateMachine.state } });
    m.setState(npc.id, 'surrender'); m.setState(npc.id, 'hit'); npc.stateMachine.update(m.config.states.hit.duration + 0.01);
    checks.push({ name: 'npc-hit-timeout-returns-to-previous-state', passed: npc.stateMachine.state === 'surrender', details: npc.stateMachine.snapshot() });
    m.setState(npc.id, 'fire'); npc.stateMachine.update(m.config.states.fire.duration + 0.01);
    checks.push({ name: 'npc-fire-timeout-uses-config-transition', passed: npc.stateMachine.state === 'aim', details: npc.stateMachine.snapshot() });
    checks.push({ name: 'npc-state-hooks-enter-exit-update', passed: hooks.some(event => event.name === 'onEnter') && hooks.some(event => event.name === 'onExit')
      && hooks.some(event => event.name === 'onTransition') && hooks.some(event => event.name === 'onUpdate'), details: { hooks } });
    m.config.hooks.onEnter = async () => { throw new Error('C19 controlled async hook error'); };
    m.config.hooks.onError = async () => { throw new Error('C19 controlled error-hook rejection'); };
    const errorOffset = m.state().errors.length; m.setState(npc.id, 'alert');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const hookErrors = m.state().errors.slice(errorOffset);
    checks.push({ name: 'npc-hook-rejections-are-recorded-and-contained', passed: hookErrors.some(error => error.hook === 'onEnter'
      && error.error === 'C19 controlled async hook error') && npc.stateMachine.state === 'alert', details: { hookErrors, state: npc.stateMachine.state } });
    m.config.hooks.onEnter = oldHooks.onEnter; m.config.hooks.onError = oldHooks.onError;
    const { NPC_CONFIG, mergeNPCConfig, validateNPCConfig } = await import('/bodycam-demo/js/npc/npc-config.js');
    const badConfig = [];
    for (const [name, override] of [
      ['too-many-npcs', { maxNPCs: 33 }], ['nan-radius', { navigation: { radius: NaN } }],
      ['nan-hearing-threshold', { perception: { hearing: { threshold: NaN } } }],
      ['zero-cooldown', { shooting: { cooldownSeconds: 0 } }],
      ['negative-state-duration', { states: { aim: { duration: -1 } } }],
      ['unknown-transition-state', { transitions: { idle: { sound: 'invented' } } }],
    ]) {
      try { validateNPCConfig(mergeNPCConfig(NPC_CONFIG, override)); badConfig.push({ name, rejected: false }); }
      catch (error) { badConfig.push({ name, rejected: true, error: error.message }); }
    }
    checks.push({ name: 'npc-invalid-configuration-rejected-before-loading', passed: badConfig.every(record => record.rejected), details: { badConfig } });
    const doomed = m.npcs[2], before = events.length;
    m.hit(doomed.id, { zone: 'torso', damage: 1000 });
    const resurrection = m.setState(doomed.id, 'idle');
    checks.push({ name: 'npc-dead-is-terminal-and-hit-zones-disabled', passed: doomed.health === 0 && doomed.stateMachine.state === 'dead'
      && resurrection === false && doomed.hitZones.objects.every(object => !object.visible)
      && events.slice(before).some(event => event.type === 'npc.dead' && event.npcId === doomed.id),
      details: { state: m.state().npcs.find(record => record.id === doomed.id), resurrection, events: events.slice(before) } });
    const invalid = [];
    for (const [name, action] of [['unknown-state', () => m.setState(npc.id, 'invented')], ['nan-dt', () => m.update(NaN)],
      ['negative-dt', () => m.update(-1)], ['nonfinite-position', () => m.teleport(npc.id, [0, Infinity, 0])]]) {
      try { action(); invalid.push({ name, rejected: false }); } catch (error) { invalid.push({ name, rejected: true, error: error.message }); }
    }
    checks.push({ name: 'npc-invalid-input-rejection', passed: invalid.every(item => item.rejected), details: { invalid } });
    m.setState(npc.id, 'surrender'); window.npcTest.inspect(npc.id); app.dev.step(0);
  } finally { Object.assign(m.config.hooks, oldHooks); }
  return { checks, evidence: { states, hooks } };
}

function disposalTests() {
  const { app, m, events, off, T } = window.__npcChecks;
  const checks = [], oldCount = app.world.shootables.length;
  const targets = m.npcs.flatMap(record => record.hitZones.objects);
  const roots = m.npcs.map(record => record.root), originalGuard = window.__npcChecks.originalDoors.map(saved => saved.door.canMove);
  const before = events.length;
  m.dispose(); m.dispose();
  app.bus.emit('shot', { weapon: 'rifle', position: new T.Vector3(4.3, 0.8, -4.95) });
  app.bus.emit('step', { position: new T.Vector3(4.3, 0.8, -4.95) });
  m.update(1); app.dev.step(0);
  const npcEvents = events.slice(before).filter(event => event.type.startsWith('npc.'));
  checks.push({ name: 'npc-idempotent-dispose-removes-targets-scene-and-listeners', passed: m.disposed && roots.every(root => !root.parent)
    && targets.every(target => !app.world.shootables.includes(target) && !target.parent)
    && app.world.shootables.length === oldCount - targets.length && !npcEvents.length
    && !document.querySelector('[data-npc-debug]') && originalGuard.every((guard, index) => guard !== app.world.doors[index].canMove), details: { oldShootables: oldCount, afterShootables: app.world.shootables.length,
      targets: targets.length, npcEvents, disposed: m.disposed, model: m.state().model,
      guardsChanged: originalGuard.map((guard, i) => guard !== app.world.doors[i].canMove) } });
  checks.push({ name: 'npc-disposal-retains-player-world-weapon', passed: app.stats().modules.world && app.stats().modules.player
    && app.stats().modules.weapon && !!app.weapon.raycast().direction && !app.stats().issues.length, details: app.stats().modules });
  window.__npcChecks.disposeStats = { targets: targets.length, shootables: app.world.shootables.length };
  off();
  return { checks, evidence: { state: m.state(), targets: targets.length } };
}

async function factoryCleanupTests() {
  const { app, m } = window.__npcChecks;
  const { createNPCs } = await import('/bodycam-demo/js/npc/index.js');
  const countRoots = () => {
    let count = 0; app.dev.scene.traverse(node => { if (node.name === 'NPCs' || node.name === 'NPCDebug') count++; }); return count;
  };
  const before = { shootables: app.world.shootables.length, roots: countRoots(), guards: app.world.doors.map(door => door.canMove) };
  let failure = null, unexpected;
  try {
    unexpected = await createNPCs({ scene: app.dev.scene, world: app.world, player: app.player,
      camera: app.dev.camera, renderer: app.dev.renderer, input: app.player.input, bus: app.bus,
      baseUrl: new URL('/bodycam-demo/', location.href), navData: m.navigation.data,
      config: { states: { idle: { clip: 'INVALID' } } } });
  } catch (error) { failure = String(error.message); }
  finally { unexpected?.dispose(); }
  const after = { shootables: app.world.shootables.length, roots: countRoots(),
    guardsUnchanged: app.world.doors.every((door, i) => door.canMove === before.guards[i]), existingManagerAlive: !m.disposed };
  app.dev.step(0);
  return { checks: [{ name: 'npc-factory-failure-cleans-partial-instance-and-proxies', passed: !!failure
    && /Invalid NPC animation clips/.test(failure) && before.shootables === after.shootables && before.roots === after.roots
    && after.guardsUnchanged && after.existingManagerAlive && !app.stats().issues.length,
    details: { failure, before: { shootables: before.shootables, roots: before.roots }, after,
      stimulus: 'Real model library load followed by invalid idle clip, after skin and hit proxy construction.' } }], evidence: { failure, after } };
}

function rebuildTests() {
  const old = window.__npcChecks, app = window.__bodycam, m = app.npcs;
  const targets = m.npcs.flatMap(record => record.hitZones.objects);
  const deadZones = old.m.npcs.flatMap(record => record.hitZones.objects);
  const result = { count: m.npcs.length, active: m.state().npcs.map(record => record.hitZones.active),
    targets: targets.length, overlayCount: document.querySelectorAll('[data-npc-debug]').length,
    oldTargetsInNewWorld: deadZones.filter(target => app.world.shootables.includes(target)).length,
    issues: app.stats().issues };
  return { checks: [{ name: 'npc-rebuild-has-three-fresh-independent-instances', passed: m !== old.m && result.count === 3
    && result.targets === 42 && result.active.every(count => count === 14) && result.overlayCount === 1
    && !result.oldTargetsInNewWorld && !result.issues.length, details: result }], evidence: result };
}

async function performanceTests({ page, origin, shot, audioSink }) {
  const cases = [], checks = [];
  for (let round = 0; round < 3; round++) {
    for (const enabled of round % 2 ? [true, false] : [false, true]) {
      await page.goto(`${origin}/bodycam-demo/?debug=1&quality=high&npcdebug=0&behavior=0&npcs=${enabled ? '1' : '0'}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__bodycam?.ready === true, { timeout: 120000 });
      await configureAudioOutput(page, audioSink);
      const setup = await page.evaluate(async enabled => {
        const app = window.__bodycam;
        await app.resume(); app.teleport(-3.6, 0.603, -1.1, 0, -4);
        if (enabled) {
          for (const [index, npc] of app.npcs.npcs.entries()) {
            app.npcs.teleport(npc.id, [-4.7 + index * 1.2, 0.603, -3.8], 180); app.npcs.setState(npc.id, 'idle');
          }
        }
        return { enabled, modules: app.stats().modules, npcs: app.npcs?.npcs.length ?? 0, viewport: app.stats().viewport,
          position: app.player.position.toArray(), issues: app.stats().issues };
      }, enabled);
      await page.waitForTimeout(1500);
      const performance = await measureFrames(page, 3);
      const stats = await page.evaluate(() => window.__bodycam.stats());
      cases.push({ round, enabled, setup, performance, stats });
      if (round === 0) await shot(`npc-performance-${enabled ? 'three' : 'baseline'}.png`,
        enabled ? 'Produktionsansicht mit drei sichtbaren NPCs für denselben Leistungstest' : 'Identische Produktionsansicht ohne NPCs als Leistungsbasis');
    }
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const baseline = cases.filter(item => !item.enabled), npcCases = cases.filter(item => item.enabled);
  const baseFPS = median(baseline.map(item => item.performance.fps)), npcFPS = median(npcCases.map(item => item.performance.fps));
  const baseP95 = median(baseline.map(item => item.performance.frameTimeMs.p95)), npcP95 = median(npcCases.map(item => item.performance.frameTimeMs.p95));
  const baseCalls = median(baseline.map(item => item.stats.drawCalls)), npcCalls = median(npcCases.map(item => item.stats.drawCalls));
  checks.push({ name: 'npc-performance-comparable-real-app-baseline', passed: cases.every(item => !item.setup.issues.length
    && item.setup.modules.world && item.setup.modules.player && item.setup.modules.weapon && item.setup.viewport[0] === 1920
    && item.setup.viewport[1] === 1080 && item.setup.npcs === (item.enabled ? 3 : 0)) && npcCalls > baseCalls,
    details: { baseCalls, npcCalls, cases: cases.map(item => ({ round: item.round, setup: item.setup, drawCalls: item.stats.drawCalls, triangles: item.stats.triangles })) } });
  checks.push({ name: 'npc-performance-three-npcs-retain-frame-rate', passed: npcFPS / baseFPS >= 0.9
    && npcP95 <= baseP95 + 3, details: { baseFPS, npcFPS, fpsRatio: npcFPS / baseFPS, baseP95, npcP95,
      allowedRatio: 0.9, allowedP95IncreaseMs: 3, rounds: 3, secondsPerCase: 3,
      method: 'Alternating same-scene App runs, same high quality, viewport and player. rAF intervals, not isolated GPU render time.' } });
  return { checks, evidence: { cases, baseFPS, npcFPS, baseP95, npcP95 } };
}
