import { Color, MathUtils, PointLight, Vector3 } from 'three';
import { BEHAVIOR_CONFIG } from './behavior-config.js';

// The behaviour drives sight/sound/lost reactions itself; C19's default table only keeps the
// mechanical follow-ups (fire → aim, hit → previous, flee arrival → hide).
export const BEHAVIOR_NPC_OVERRIDES = {
  transitions: { idle: { sight: null, sound: null }, alert: { lost: null }, hide: { sight: null }, aim: { lost: null } },
  shooting: { cooldownSeconds: BEHAVIOR_CONFIG.fire.cooldownSeconds },
};

// Decides what each suspect does; createNPCs supplies senses, movement, animation and the gun.
// Modes: waiting (opening posture) → reacting (spotted the officer) → engaging (bursts while in
// view, holds on the last sighting) → back to waiting after their patience runs out. Side exits:
// surrendered, fleeing (wounded), bursting (hider leaves the closet), dead.
export function createSuspectBehavior({ manager, player, camera, bus, weapon = null, config = BEHAVIOR_CONFIG, random = Math.random }) {
  const range = ([low, high]) => low + (high - low) * random();
  const eye = new Vector3(), side = new Vector3(), lift = new Vector3(), muzzle = new Vector3(), toNpc = new Vector3(), forward = new Vector3(), point = new Vector3();
  const removers = [];
  let time = 0, lastShout = -Infinity, disposed = false, standDown = false;
  const minds = new Map();

  // One shared muzzle light: every extra point light costs each lit pixel, flashes rarely overlap.
  const flash = new PointLight(new Color(config.muzzleFlash.color), 0, config.muzzleFlash.distance, 2);
  flash.name = 'SuspectMuzzleFlash'; flash.layers.enable(1); manager.root.add(flash);
  let flashLeft = 0;
  for (const npc of manager.npcs) {
    const profile = { ...config.defaults, ...config.profiles[npc.id] };
    const posture = config.postures[npc.spawnStance] ?? (profile.temper === 'barricaded' ? 'aim' : 'idle');
    minds.set(npc.id, { npc, profile, posture, mode: 'waiting', timer: 0, nextShot: 0, burstLeft: 0, seenFor: 0,
      unseenFor: 0, glare: false, barked: false, shoutCheck: -Infinity, firedAt: -Infinity, wounded: false,
      fallAt: null, shots: 0 });
    manager.setState(npc.id, posture);
  }

  const mind = id => minds.get(id);
  const sound = (name, position) => bus.emit('sound', { name, position: position?.toArray?.() ?? position });
  const alive = m => m.npc.health > 0 && m.mode !== 'dead';
  function chestPoint(target) {
    camera.getWorldPosition(target); target.y -= config.fire.chestDrop; return target;
  }
  function headOf(m, target) { return m.npc.nodes.S_Head?.getWorldPosition(target) ?? target.copy(m.npc.position).setY(m.npc.position.y + 1.6); }
  function turnTowards(m, target, dt) {
    const npc = m.npc, want = Math.atan2(target.x - npc.position.x, target.z - npc.position.z);
    if (!Number.isFinite(want)) return false;
    const delta = MathUtils.euclideanModulo(want - npc.root.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    const step = MathUtils.degToRad(config.turnDegPerSecond) * dt;
    npc.root.rotation.y += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
    return Math.abs(delta) <= step;
  }
  // Is the officer's flashlight in this suspect's face?
  function glared(m) {
    if (!weapon?.state().light) return false;
    camera.getWorldPosition(eye); headOf(m, toNpc).sub(eye);
    const distance = toNpc.length();
    if (distance > config.glare.range) return false;
    camera.getWorldDirection(forward);
    return forward.angleTo(toNpc) < MathUtils.degToRad(config.glare.coneDeg);
  }
  function aimedAt(m, degrees) {
    camera.getWorldPosition(eye); camera.getWorldDirection(forward);
    toNpc.copy(m.npc.position).setY(m.npc.position.y + 1.2).sub(eye);
    return forward.angleTo(toNpc) < MathUtils.degToRad(degrees);
  }
  function setMode(m, mode, timer = 0) { m.mode = mode; m.timer = timer; }

  function spotted(m) {
    m.glare = glared(m);
    setMode(m, 'reacting', range(m.profile.reaction) + (m.glare ? config.glare.reaction : 0));
    m.seenFor = 0;
    if (!m.barked && random() < config.bark.spotted) { m.barked = true; sound('suspect_shout', headOf(m, point)); }
  }
  function engage(m) {
    setMode(m, 'engaging'); m.unseenFor = 0;
    m.burstLeft = Math.round(range(config.fire.burst)); m.nextShot = time;
    m.aimError = range(config.fire.aimError) / m.profile.skill; m.kick = 0;
    // Mostly wide of the body (left or right, a little high or low): the capsule spans the whole height.
    m.aimAngle = (random() < 0.5 ? 0 : Math.PI) + range([-0.45, 0.45]);
    manager.setState(m.npc.id, 'aim');
  }
  // Chest point displaced across the line of fire by the shooter's current aim error.
  function aimPoint(m, target) {
    const fire = config.fire;
    chestPoint(target);
    m.npc.nodes.S_Muzzle?.getWorldPosition(muzzle) ?? muzzle.copy(m.npc.position).setY(m.npc.position.y + 1.3);
    side.subVectors(target, muzzle).cross(lift.set(0, 1, 0)).normalize(); lift.crossVectors(side, toNpc.subVectors(target, muzzle).normalize());
    const error = m.aimError * Math.exp(-m.seenFor / fire.aimSettleSeconds) + m.kick;
    return target.addScaledVector(side, Math.cos(m.aimAngle) * error).addScaledVector(lift, Math.sin(m.aimAngle) * error * 0.7 + m.kick * 0.5);
  }
  function shoot(m) {
    const fire = config.fire, speed = Math.hypot(player.velocity?.x ?? 0, player.velocity?.z ?? 0);
    const settle = MathUtils.clamp(m.seenFor / fire.settleSeconds, 0, 1);
    const spreadDeg = (MathUtils.lerp(fire.spreadFirst, fire.spreadSettled, settle)
      + fire.moveSpread * MathUtils.clamp(speed / fire.moveSpeed, 0, 1) + (m.glare ? config.glare.spread : 0)) / m.profile.skill;
    manager.setState(m.npc.id, 'fire');
    const shot = manager.fire(m.npc.id, aimPoint(m, point).toArray(), { spreadDeg });
    if (!shot?.fired) return;
    m.kick = config.fire.recoilError * range([0.5, 1.2]); m.aimAngle += range([-0.6, 0.6]);
    m.firedAt = time; m.shots++; flashLeft = config.muzzleFlash.seconds;
    m.npc.nodes.S_Muzzle?.getWorldPosition(flash.position); flash.intensity = config.muzzleFlash.intensity;
    if (!shot.playerHit) nearMiss(shot);
  }
  // Closest pass of a missed round to the camera; a crack and whiz when it is close enough to hear.
  function nearMiss(shot) {
    camera.getWorldPosition(eye);
    const along = toNpc.subVectors(eye, shot.position).dot(shot.direction);
    if (along <= 0 || (shot.obstruction && shot.obstruction.distance < along)) return;
    point.copy(shot.position).addScaledVector(shot.direction, along);
    if (point.distanceTo(eye) < config.whiz.distance) sound('bullet_whiz', point);
  }
  function fleeFrom(m) {
    const navigation = manager.navigation, rooms = ['LIV', 'KIT', 'BED1', 'BED2', 'UTIL', 'BATH', 'HAL'];
    const here = manager.state().npcs.find(entry => entry.id === m.npc.id)?.roomId;
    let best = null, bestDistance = -1;
    for (const room of rooms) {
      if (room === here) continue;
      const goal = navigation.roomGoal?.(room, m.npc.position);
      if (!goal) continue;
      const distance = goal.distanceTo(player.position);
      if (distance > bestDistance) { best = room; bestDistance = distance; }
    }
    if (!best) return false;
    const plan = manager.moveTo(m.npc.id, best, { state: 'flee' });
    if (plan.status !== 'ok') return false;
    setMode(m, 'fleeing'); return true;
  }

  removers.push(
    manager.on('npc.hit', event => {
      const m = mind(event.npcId); if (!m || !alive(m)) return;
      m.wounded = true; m.nextShot = Math.max(m.nextShot, time + config.fire.flinchSeconds);
      if (m.mode === 'surrendered') return;
      if (m.mode === 'waiting' || m.mode === 'reacting') { engage(m); m.nextShot = time + config.fire.flinchSeconds; }
      if (event.health < 50 && random() < m.profile.flee) fleeFrom(m);
    }),
    manager.on('npc.dead', event => {
      const m = mind(event.npcId); if (!m) return;
      setMode(m, 'dead'); m.fallAt = time + config.bodyFallDelay;
    }),
    manager.on('npc.arrived', event => {
      const m = mind(event.npcId); if (!m || !alive(m)) return;
      if (m.mode === 'bursting') engage(m);
      else if (m.mode === 'fleeing') { setMode(m, 'waiting'); m.posture = 'hide'; m.profile = { ...m.profile, temper: 'ambush' }; }
    }),
    bus.on('playerDeath', () => { standDown = true; }),
    bus.on('shout', () => {
      if (time - lastShout < config.shout.cooldown) return;
      lastShout = time; camera.getWorldPosition(eye);
      for (const m of minds.values()) {
        if (!alive(m) || m.mode === 'surrendered' || time - m.shoutCheck < config.shout.recheck) continue;
        const distance = m.npc.position.distanceTo(eye);
        if (distance > config.shout.range) continue;
        m.shoutCheck = time;
        const s = config.shout;
        const chance = m.profile.comply + (aimedAt(m, s.aimedDeg) ? s.aimedBonus : 0) + (m.wounded ? s.woundedBonus : 0)
          - (time - m.firedAt < 1 ? s.firedPenalty : 0) - (m.npc.visible ? 0 : s.unseenPenalty);
        if (random() < chance) { setMode(m, 'complying', range(s.delay)); manager.setState(m.npc.id, 'alert'); }
        else {
          if (random() < config.bark.refused) sound('suspect_shout', headOf(m, point));
          if (m.npc.visible && (m.mode === 'waiting' || m.mode === 'reacting')) engage(m);
        }
      }
    }),
  );

  function think(m, dt) {
    const npc = m.npc;
    if (m.mode === 'dead') {
      if (m.fallAt !== null && time >= m.fallAt) { m.fallAt = null; sound('body_fall', npc.position); }
      return;
    }
    if (npc.health <= 0) { setMode(m, 'dead'); return; }
    const visible = npc.visible;
    m.seenFor = visible ? m.seenFor + dt : 0;
    switch (m.mode) {
      case 'waiting': {
        if (visible) { spotted(m); break; }
        if (m.profile.temper === 'hider') {
          const room = player.room?.id;
          if ((m.profile.triggerRooms ?? []).includes(room) && npc.position.distanceTo(player.position) < m.profile.triggerDistance) {
            forward.set(Math.sin(npc.root.rotation.y), 0, Math.cos(npc.root.rotation.y));
            const plan = manager.moveTo(npc.id, point.copy(npc.position).addScaledVector(forward, m.profile.burstOut).toArray(), { state: 'flee' });
            if (plan.status === 'ok') setMode(m, 'bursting'); else engage(m);
          }
          break;
        }
        // Heard something recently: turn towards it, keep the posture.
        if (npc.lastHeard && time - (npc.lastHeard.time ?? -Infinity) < 3 && m.profile.temper !== 'barricaded')
          turnTowards(m, point.copy(npc.lastHeard.position), dt);
        break;
      }
      case 'reacting':
        if (visible) turnTowards(m, player.position, dt);
        if ((m.timer -= dt) <= 0) engage(m);
        break;
      case 'engaging': {
        const target = visible ? player.position : npc.lastSeen?.position;
        if (target) turnTowards(m, point.copy(target), dt);
        if (visible) {
          m.unseenFor = 0;
          m.kick = Math.max(0, m.kick - dt * config.fire.recoilError * 2.5);
          if (!standDown && time >= m.nextShot && npc.stateMachine.state !== 'hit') {
            shoot(m);
            if (--m.burstLeft > 0) m.nextShot = time + range(config.fire.interval);
            else { m.burstLeft = Math.round(range(config.fire.burst)); m.nextShot = time + range(config.fire.pause); }
          }
        } else if ((m.unseenFor += dt) > m.profile.patience) {
          setMode(m, 'waiting'); manager.setState(npc.id, m.posture);
        }
        break;
      }
      case 'complying':
        if ((m.timer -= dt) <= 0) { setMode(m, 'surrendered'); manager.setState(npc.id, 'surrender'); }
        break;
      case 'bursting': case 'fleeing': case 'surrendered': break;
    }
    if (m.mode !== 'bursting' && m.mode !== 'fleeing') { npc.root.updateWorldMatrix(true, true); npc.hitZones.update(); }
  }

  return {
    minds,
    update(dt) {
      if (disposed || !dt) return;
      time += dt;
      if (flashLeft > 0 && (flashLeft -= dt) <= 0) flash.intensity = 0;
      for (const m of minds.values()) think(m, dt);
    },
    state: () => ({ time, npcs: [...minds.values()].map(m => ({ id: m.npc.id, mode: m.mode, temper: m.profile.temper,
      posture: m.posture, shots: m.shots, wounded: m.wounded, glare: m.glare })) }),
    dispose() {
      disposed = true; removers.splice(0).forEach(off => off?.());
      flash.removeFromParent();
    },
  };
}
