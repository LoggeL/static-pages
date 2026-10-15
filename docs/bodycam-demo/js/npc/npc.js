import { Group, MathUtils, Vector3 } from 'three';
import { createEventBus } from '../app/events.js';
import { CapsuleCollision } from '../player/collision.js';
import { NPC_CONFIG, mergeNPCConfig, validateNPCConfig } from './npc-config.js';
import { createNavigation } from './navigation.js';
import { loadNPCModel } from './model.js';
import { createNPCAnimation } from './animation.js';
import { createHitZones } from './hit-zones.js';
import { createNPCStateMachine } from './state-machine.js';
import { createNPCPerception, npcVector } from './perception.js';
import { createNPCShooting } from './shooting.js';
import { createNPCDebug } from './debug.js';

export async function createNPCs({ scene, world, player, camera, renderer, input = player?.input,
  bus = createEventBus(), baseUrl = new URL('../../', import.meta.url), config: overrides = {},
  navData, spawns = world?.suspects ?? [], random = Math.random } = {}) {
  if (!scene || !world?.colliders || !world?.shootables || !player?.position || !camera)
    throw new TypeError('NPCs require scene, C12 world/player and camera');
  const config = validateNPCConfig(mergeNPCConfig(NPC_CONFIG, overrides));
  const base = new URL(baseUrl, import.meta.url);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  if (!navData) {
    const response = await fetch(new URL('data/nav.json', base));
    if (!response.ok) throw new Error(`NPC navigation HTTP ${response.status}`);
    navData = await response.json();
  }
  const navigation = createNavigation({ world, data: navData, config: config.navigation });
  const library = await loadNPCModel({ baseUrl: base, renderer,
    modelUrl: config.model.url ?? navData.assets?.npcModel ?? config.model.fallbackUrl, config: config.model });
  const root = new Group(); root.name = 'NPCs'; scene.add(root);
  const npcs = [], removers = [], doorGuards = [], errors = [], sounds = [];
  const perception = createNPCPerception({ world, config: config.perception });
  const shooting = createNPCShooting({ world, player, camera, config: config.shooting, random });
  const fallCollision = new CapsuleCollision(world.colliders);
  const target = new Vector3(), direction = new Vector3(), candidate = new Vector3();
  let time = 0, disposed = false, debug = null, allDownSent = false, updateMs = 0;
  let api;
  const find = id => {
    const npc = typeof id === 'object' ? npcs.find(entry => entry === id || entry.id === id.id) : npcs.find(entry => entry.id === id);
    if (!npc) throw new RangeError(`Unknown NPC: ${typeof id === 'object' ? id.id : id}`);
    return npc;
  };
  const emit = (type, npc, payload = {}) => bus.emit(type, { npcId: npc?.id ?? null, time, ...payload });
  function hook(name, context) {
    const callback = config.hooks[name];
    if (typeof callback !== 'function') return undefined;
    const report = error => {
      const entry = { hook: name, time, error: String(error?.message ?? error) };
      errors.push(entry); if (errors.length > 20) errors.shift();
      emit('npc.error', context?.npc, entry);
      if (name !== 'onError') {
        try { const result = config.hooks.onError?.(entry); if (result?.then) result.catch(() => {}); } catch {}
      }
    };
    try {
      const value = callback({ manager: api, world, player, ...context });
      if (value && typeof value.then === 'function') { Promise.resolve(value).catch(report); return undefined; }
      return value;
    } catch (error) { report(error); return undefined; }
  }
  // Clip choice per state: the chosen fall for deaths, the armed variant for hits with the pistol out.
  function clipFor(npc, state) {
    const clip = config.states[state]?.clip;
    if (state === 'dead' && npc.fall) return [npc.fall.clip, npc.fall.clip === 'DeathBackward' ? 'DeathForward' : 'DeathBackward'];
    if (state === 'hit' && npc.instance.weaponDrawn && clip) return ['HitReactArmed', clip];
    return clip;
  }
  // Death clip and a small turn whose fall path is free of walls and furniture; prefers falling away from the shooter.
  function chooseFall(npc, from) {
    const facing = npc.root.rotation.y, fall = config.fall;
    const ahead = !from || (from.x - npc.position.x) * Math.sin(facing) + (from.z - npc.position.z) * Math.cos(facing) > 0;
    const order = ahead ? ['DeathBackward', 'DeathForward'] : ['DeathForward', 'DeathBackward'];
    let best = null;
    for (const turnDeg of fall.turnsDeg) for (const clip of order) {
      const yaw = facing + MathUtils.degToRad(turnDeg), sign = clip === 'DeathBackward' ? -1 : 1;
      direction.set(Math.sin(yaw) * sign, 0, Math.cos(yaw) * sign);
      let clear = fall.lengthMeters;
      for (const height of fall.probeHeights) for (const side of [-fall.halfWidth, 0, fall.halfWidth]) {
        candidate.set(npc.position.x + direction.z * side, npc.position.y + height, npc.position.z - direction.x * side);
        const hit = fallCollision.raycast(candidate, direction, fall.lengthMeters);
        if (hit) clear = Math.min(clear, hit.distance);
      }
      if (clear >= fall.lengthMeters - 1e-6) return { clip, turn: MathUtils.degToRad(turnDeg), clear };
      if (!best || clear > best.clear) best = { clip, turn: MathUtils.degToRad(turnDeg), clear };
    }
    return best;
  }
  function stop(npc) { npc.path = []; npc.pathIndex = 0; npc.pathVersion++; npc.goal = null; npc.moving = false; }
  function setState(id, state, detail = {}) {
    if (disposed) return false;
    return find(id).stateMachine.set(state, detail);
  }
  function look(id, point) {
    const npc = find(id); npcVector(point, target); direction.subVectors(target, npc.position);
    if (Math.hypot(direction.x, direction.z) < 1e-9) return false;
    npc.root.rotation.y = Math.atan2(direction.x, direction.z);
    npc.root.updateWorldMatrix(true, true); npc.hitZones.update(); debug?.update(); return true;
  }
  function moveTo(id, destination, options = {}) {
    const npc = find(id);
    if (disposed || npc.stateMachine.state === 'dead') return { status: 'dead', points: [] };
    const goal = typeof destination === 'string' ? navigation.roomGoal(destination, npc.position) : npcVector(destination);
    if (!goal) return { status: 'unreachable', points: [] };
    const allowDoorPush = options.allowDoorPush ?? config.navigation.allowDoorPush;
    const plan = navigation.plan(npc.position, goal, { allowDoorPush });
    if (plan.status !== 'ok' || !plan.points.length) {
      stop(npc); emit('npc.navigationBlocked', npc, { reason: 'unreachable', destination: typeof destination === 'string' ? destination : goal.toArray() });
      return plan;
    }
    npc.path = plan.points.map(point => point.clone()); npc.pathIndex = 0; npc.pathVersion++;
    npc.goal = goal.clone(); npc.allowDoorPush = allowDoorPush; npc.blockedTime = 0; npc.replanTime = 0;
    npc.stateMachine.set(options.state ?? 'flee', { destination: goal.clone() });
    emit('npc.path', npc, { points: npc.path.map(point => point.toArray()), doors: plan.doors });
    debug?.update(); return plan;
  }
  function teleport(id, point, yawDeg) {
    const npc = find(id); if (disposed) return false;
    stop(npc); npc.position.copy(npcVector(point));
    if (yawDeg !== undefined) {
      if (!Number.isFinite(yawDeg)) throw new TypeError('NPC yaw must be finite');
      npc.root.rotation.y = MathUtils.degToRad(yawDeg + config.spawnYawOffsetDeg);
    }
    npc.root.updateWorldMatrix(true, true); npc.hitZones.update(); npc.visible = false;
    npc.lastSeen = null; npc.lastHeard = null; npc.lastStimulus = -Infinity;
    debug?.update(); return npcSnapshot(npc);
  }
  function perceive(id) {
    const npc = find(id);
    if (npc.stateMachine.state === 'dead') return { visible: false, reason: 'dead' };
    return perception.visible(npc, camera.getWorldPosition(target));
  }
  function sense(npc) {
    const result = perceive(npc); npc.perception = result;
    if (result.visible) {
      npc.lastSeen = { time, position: result.point.clone(), roomId: result.roomId }; npc.lastStimulus = time;
      if (!npc.visible) { emit('npc.seen', npc, result); hook('onSight', { npc, perception: result }); }
      npc.stateMachine.signal('sight', result);
    } else if (time - npc.lastStimulus >= config.perception.memorySeconds) npc.stateMachine.signal('lost', result);
    npc.visible = result.visible;
  }
  function sound(event, kind) {
    if (disposed || !event?.position) return;
    for (const npc of npcs) {
      if (npc.stateMachine.state === 'dead') continue;
      const heard = perception.hear(npc, { ...event, kind });
      if (!heard) continue;
      npc.lastHeard = { ...heard, time }; npc.lastStimulus = time;
      const record = { npcId: npc.id, time, ...heard, position: heard.position.toArray() };
      sounds.push(record); if (sounds.length > config.perception.hearing.maxEvents) sounds.shift();
      emit('npc.heard', npc, heard); hook('onHear', { npc, perception: heard }); npc.stateMachine.signal('sound', heard);
    }
  }
  function hit(id, payload = {}) {
    const npc = find(id);
    if (disposed || npc.stateMachine.state === 'dead') return false;
    const zone = payload.zone ?? 'torso';
    if (!Object.hasOwn(config.health.zoneMultipliers, zone)) throw new RangeError(`Unknown NPC hit zone: ${zone}`);
    const point = payload.point ? npcVector(payload.point) : npc.position.clone();
    const normal = payload.normal ? npcVector(payload.normal).normalize() : new Vector3(0, 1, 0);
    const baseDamage = payload.damage ?? (payload.weapon === 'rifle' ? config.health.rifleDamage : config.health.defaultDamage);
    if (!Number.isFinite(baseDamage) || baseDamage < 0) throw new RangeError('NPC damage must be finite and nonnegative');
    const damage = baseDamage * config.health.zoneMultipliers[zone];
    npc.health = Math.max(0, npc.health - damage);
    const event = { zone, part: payload.part ?? null, point, normal, damage, health: npc.health,
      weapon: payload.weapon ?? null, sourceId: payload.sourceId ?? 'player' };
    npc.lastHit = { ...event, point: point.toArray(), normal: normal.toArray(), time };
    emit('npc.hit', npc, event); hook('onHit', { npc, hit: event });
    if (npc.health === 0) {
      const from = event.sourceId === 'player' ? camera.getWorldPosition(new Vector3()) : null;
      npc.fall = config.fall.enabled ? chooseFall(npc, from) : null;
      if (npc.fall) npc.fall = { ...npc.fall, fromYaw: npc.root.rotation.y, age: 0 };
      event.fall = npc.fall && { clip: npc.fall.clip, turnDeg: MathUtils.radToDeg(npc.fall.turn), clearMeters: npc.fall.clear };
      npc.stateMachine.set('dead', event, true); stop(npc);
      npc.hitZones.objects.forEach(object => { object.visible = false; });
      emit('npc.dead', npc, event);
      if (!allDownSent && npcs.length && npcs.every(entry => entry.health === 0)) {
        allDownSent = true; bus.emit('allSuspectsDown', { time, npcIds: npcs.map(entry => entry.id) });
      }
    } else npc.stateMachine.set('hit', event);
    return event;
  }
  function fire(id, aimTarget) {
    const npc = find(id);
    if (disposed || npc.stateMachine.state === 'dead' || npc.stateMachine.state === 'surrender')
      return { fired: false, reason: 'state' };
    if (time + 1e-9 < npc.nextShotTime) return { fired: false, reason: 'cooldown' };
    const shot = shooting.cast(npc, aimTarget);
    if (!shot.fired) return shot;
    npc.nextShotTime = time + config.shooting.cooldownSeconds;
    npc.lastShot = { time, position: shot.position.toArray(), direction: shot.direction.toArray(),
      hitPlayer: !!shot.playerHit, blockedBy: shot.obstruction?.object.name ?? null };
    emit('npc.shot', npc, shot); hook('onShot', { npc, shot });
    bus.emit('shot', { ...shot, time, index: ++npc.shots }); // C4 und Wahrnehmung verwenden denselben Ereignisbus.
    if (shot.playerHit) {
      const damage = { sourceId: npc.id, npcId: npc.id, player, amount: shot.playerHit.amount,
        point: shot.playerHit.point.clone(), normal: shot.playerHit.normal.clone(), time, weapon: 'pistol' };
      bus.emit('player.damage', damage);
      (player.input ?? input)?.emit?.('damage', damage);
      player.dispatchEvent?.({ type: 'damage', ...damage });
      hook('onPlayerDamage', { npc, damage });
    }
    return shot;
  }
  function move(npc, dt) {
    npc.moving = false;
    if (!npc.goal || ['dead', 'hit', 'surrender', 'aim', 'fire'].includes(npc.stateMachine.state)) return;
    let budget = (npc.stateMachine.state === 'flee' ? config.navigation.runSpeed : config.navigation.speed) * dt;
    while (budget > 1e-8 && npc.pathIndex < npc.path.length) {
      const point = npc.path[npc.pathIndex]; direction.subVectors(point, npc.position);
      const distance = direction.length();
      if (distance < config.navigation.arrivalDistance) { npc.pathIndex++; continue; }
      const amount = Math.min(budget, distance); direction.multiplyScalar(1 / distance);
      candidate.copy(npc.position).addScaledVector(direction, amount);
      if (!navigation.canMove(npc.position, candidate, { allowDoorPush: false })) {
        const door = navigation.doorAhead(npc.position, point, config.navigation.doorPushDistance);
        if (door && npc.allowDoorPush) navigation.pushDoor(door, npc.position,
          { unlatch: config.navigation.unlatchDoors, strength: config.navigation.doorPushStrength });
        npc.blockedTime += dt; npc.replanTime += dt;
        if (npc.replanTime >= config.navigation.replanSeconds) {
          npc.replanTime = 0;
          const plan = navigation.plan(npc.position, npc.goal, { allowDoorPush: npc.allowDoorPush });
          if (plan.status === 'ok' && plan.points.length) {
            npc.path = plan.points.map(value => value.clone()); npc.pathIndex = 0; npc.pathVersion++;
          }
        }
        if (npc.blockedTime >= config.navigation.stuckSeconds) {
          emit('npc.navigationBlocked', npc, { reason: 'physical-obstruction', position: npc.position.clone() });
          stop(npc); npc.stateMachine.signal('blocked');
        }
        break;
      }
      npc.position.copy(candidate); npc.moving = true; budget -= amount;
      if (Math.hypot(direction.x, direction.z) > 1e-8) npc.root.rotation.y = Math.atan2(direction.x, direction.z);
      npc.blockedTime = 0; npc.replanTime = 0;
      if (distance - amount < config.navigation.arrivalDistance) npc.pathIndex++;
    }
    if (npc.goal && npc.pathIndex >= npc.path.length) {
      const goal = npc.goal.clone(); stop(npc); emit('npc.arrived', npc, { position: npc.position.clone(), goal });
      npc.stateMachine.signal('arrived', { goal });
    }
  }
  function npcSnapshot(npc) {
    const stimulus = item => item && { ...item, position: item.position?.toArray?.() ?? item.position };
    return { id: npc.id, state: npc.stateMachine.state, health: npc.health, position: npc.position.toArray(),
      yawDeg: MathUtils.radToDeg(npc.root.rotation.y) - config.spawnYawOffsetDeg,
      roomId: world.roomAt?.(npc.position)?.id ?? 'OUT', moving: npc.moving,
      goal: npc.goal?.toArray() ?? null, path: npc.path.map(point => point.toArray()), pathIndex: npc.pathIndex,
      blockedSeconds: npc.blockedTime, visible: npc.visible, perception: npc.perception ? { visible: npc.perception.visible,
        reason: npc.perception.reason, distance: npc.perception.distance } : null,
      lastSeen: stimulus(npc.lastSeen), lastHeard: stimulus(npc.lastHeard), lastHit: npc.lastHit,
      lastShot: npc.lastShot, shots: npc.shots, animation: npc.animation.state(),
      hitZones: npc.hitZones.state(), model: npc.instance.state(), machine: npc.stateMachine.snapshot(), spawn: npc.spawn };
  }
  function dispose() {
    if (disposed) return; disposed = true;
    removers.splice(0).forEach(remove => remove()); debug?.dispose();
    for (const { door, previous, guard } of doorGuards) if (door.canMove === guard) door.canMove = previous;
    for (const npc of npcs) {
      const objects = new Set(npc.hitZones?.objects ?? []);
      for (let i = world.shootables.length - 1; i >= 0; i--) if (objects.has(world.shootables[i])) world.shootables.splice(i, 1);
      npc.stateMachine?.dispose(); npc.animation?.dispose(); npc.hitZones?.dispose(); npc.instance?.dispose();
    }
    scene.remove(root); library.dispose();
  }
  api = { npcs, root, config, navigation, perception, bus, get debug() { return debug; },
    get time() { return time; }, get disposed() { return disposed; }, setState, moveTo, teleport, look, perceive, hit, fire,
    on: (type, callback) => bus.on(type, callback),
    state: () => ({ time, disposed, count: npcs.length, alive: npcs.filter(npc => npc.health > 0).length,
      npcs: npcs.map(npcSnapshot), model: library.state(), navigation: typeof navigation.state === 'function'
        ? navigation.state() : typeof navigation.stats === 'function' ? navigation.stats() : navigation.stats ?? null,
      updateMs, errors: [...errors], sounds: [...sounds], debug: debug?.state() ?? null }),
    update(dt) {
      if (disposed) return;
      if (!Number.isFinite(dt) || dt < 0 || dt > 60) throw new RangeError('NPC update: 0..60 finite seconds');
      const started = performance.now();
      let rest = dt;
      while (!disposed && rest > 1e-10) {
        const step = Math.min(config.navigation.maxSubstepSeconds, rest); time += step; rest -= step;
        for (const npc of npcs) {
          npc.stateMachine.update(step); if (disposed) break; move(npc, step);
          if (npc.fall && npc.fall.age < config.fall.turnSeconds) { // Turn into the free fall path while buckling.
            npc.fall.age = Math.min(config.fall.turnSeconds, npc.fall.age + step);
            const t = npc.fall.age / config.fall.turnSeconds;
            npc.root.rotation.y = npc.fall.fromYaw + npc.fall.turn * t * t * (3 - 2 * t);
          }
          npc.animation.update(step, { state: npc.stateMachine.state, moving: npc.moving,
            sprinting: npc.stateMachine.state === 'flee',
            ...(!npc.moving ? { clip: clipFor(npc, npc.stateMachine.state) ?? null } : {}) });
          npc.root.updateWorldMatrix(true, true); npc.hitZones.update();
          if (npc.health > 0 && time + 1e-9 >= npc.nextSenseTime) {
            npc.nextSenseTime = time + config.perception.intervalSeconds; sense(npc);
          }
        }
      }
      if (!dt) for (const npc of npcs) { npc.root.updateWorldMatrix(true, true); npc.hitZones.update(); }
      debug?.update(); updateMs = performance.now() - started;
    }, dispose };
  try {
    const ids = new Set();
    for (const [index, spawn] of spawns.slice(0, config.maxNPCs).entries()) {
      const id = String(spawn.id ?? `S${index + 1}`);
      if (ids.has(id)) throw new Error(`Duplicate NPC id: ${id}`); ids.add(id);
      const instance = library.instantiate(id); root.add(instance.root);
      const npc = { id, instance, root: instance.root, model: instance.model, nodes: instance.nodes,
        position: instance.root.position, health: config.health.initial, path: [], pathIndex: 0, pathVersion: 0,
        goal: null, allowDoorPush: config.navigation.allowDoorPush, blockedTime: 0, replanTime: 0,
        moving: false, visible: false, perception: null, lastSeen: null, lastHeard: null, lastHit: null, lastShot: null,
        lastStimulus: -Infinity, nextSenseTime: index * config.perception.intervalSeconds / Math.max(1, spawns.length), nextShotTime: 0, shots: 0 };
      npc.position.copy(npcVector(spawn.position ?? spawn.pos));
      const raw = npc.position.clone(), bakedSpawn = navData.spawns?.find(entry => entry.id === id);
      const matching = bakedSpawn?.raw && raw.distanceTo(new Vector3().fromArray(bakedSpawn.raw)) < 1e-4;
      const projected = matching && config.spawnProjection.enabled && bakedSpawn.projected
        && bakedSpawn.projectionDistance <= config.spawnProjection.maxDistance;
      if (projected) npc.position.fromArray(bakedSpawn.projected);
      npc.spawn = { source: raw.toArray(), position: npc.position.toArray(), projected: !!projected,
        distance: npc.position.distanceTo(raw), rawCapsuleClear: matching ? bakedSpawn.rawCapsuleClear : null,
        roomId: spawn.room ?? world.roomAt?.(npc.position)?.id ?? 'OUT' };
      npc.root.rotation.y = MathUtils.degToRad((spawn.yawDeg ?? 0) + config.spawnYawOffsetDeg);
      npc.root.updateWorldMatrix(true, true);
      npcs.push(npc); // Auch ein Fehler nach diesem Punkt räumt alle bereits erzeugten Teile auf.
      npc.hitZones = createHitZones({ root: npc.root, npcId: id, config: config.hitZones });
      world.shootables.push(...npc.hitZones.objects);
      npc.animation = createNPCAnimation({ root: npc.root, clips: instance.animations,
        config: { ...config.animation, fade: config.animation.fadeSeconds,
          states: Object.fromEntries(Object.entries(config.states).map(([name, value]) => [name, value.clip ? [value.clip] : []])) } });
      npc.stateMachine = createNPCStateMachine({ config, context: () => ({ npc }),
        hook, changed(event) {
          if (['idle', 'alert', 'hide', 'surrender', 'dead'].includes(event.state)) stop(npc);
          // Drawn for aiming and firing; a hit or death keeps whatever the hand already holds.
          if (!['hit', 'dead'].includes(event.state)) npc.instance.setWeaponDrawn(['aim', 'fire'].includes(event.state));
          npc.animation.setState(event.state, { clip: clipFor(npc, event.state) });
          emit('npc.statechange', npc, { from: event.from, to: event.to, state: event.state, signal: event.payload?.signal ?? null });
          if (event.state === 'fire' && config.shooting.enabled) fire(npc);
        } });
      npc.animation.setState('idle'); npc.hitZones.update();
    }
    for (const door of world.doors ?? []) {
      const previous = door.canMove;
      const collision = new CapsuleCollision({ static: null, doors: [door.collider] });
      const guard = () => (!previous || previous()) && (disposed || npcs.every(npc => npc.health <= 0
        || collision.clear(npc.position, config.navigation.height, config.navigation.radius, 0.006)));
      door.canMove = guard; doorGuards.push({ door, previous, guard });
    }
    removers.push(bus.on('shot', event => sound(event, 'shot')), bus.on('step', event => sound(event, 'step')),
      bus.on('impact', event => {
        const metadata = event.object?.userData;
        if (!metadata?.npcHitZone || !npcs.some(npc => npc.id === metadata.npcId)) return;
        hit(metadata.npcId, { ...event, zone: metadata.zone, part: metadata.part });
      }));
    debug = createNPCDebug({ scene, camera, renderer, npcs, config: config.debug, perception: config.perception });
    api.update(0); return api;
  } catch (error) { dispose(); throw error; }
}
