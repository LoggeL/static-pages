import { Vector3 } from 'three';
import { CapsuleCollision } from '../player/collision.js';

export function npcVector(value, target = new Vector3()) {
  if (Array.isArray(value)) target.fromArray(value);
  else if (value && ['x', 'y', 'z'].every(key => Number.isFinite(value[key]))) target.set(value.x, value.y, value.z);
  else throw new TypeError('NPC requires a world point with three finite coordinates');
  if (![target.x, target.y, target.z].every(Number.isFinite)) throw new TypeError('NPC requires finite coordinates');
  return target;
}

export function createNPCPerception({ world, config }) {
  const collision = new CapsuleCollision(world.colliders);
  const origin = new Vector3(), target = new Vector3(), direction = new Vector3(), forward = new Vector3();
  const roomId = point => world.roomAt?.(point)?.id ?? 'OUT';
  const outdoor = id => ['EXT', 'OUT', 'PORCH'].includes(id);
  const canonical = id => ['EXT', 'PORCH'].includes(id) ? 'OUT' : id;
  const openings = world.level?.doors ?? world.layout?.doors ?? [];
  function visible(npc, point) {
    npc.root.updateWorldMatrix(true, true);
    npc.nodes.S_Head.getWorldPosition(origin); npcVector(point, target);
    direction.subVectors(target, origin);
    const distance = direction.length();
    if (distance > config.range) return { visible: false, reason: 'range', distance, roomId: roomId(target) };
    direction.normalize();
    forward.set(0, 0, 1).applyQuaternion(npc.root.quaternion).normalize();
    const cosine = direction.dot(forward);
    if (distance > 1e-6 && cosine + 1e-9 < Math.cos(config.fovDeg * Math.PI / 360))
      return { visible: false, reason: 'cone', distance, cosine, roomId: roomId(target) };
    const obstruction = distance > config.sightMargin
      ? collision.raycast(origin, direction, distance - config.sightMargin) : null;
    return { visible: !obstruction, reason: obstruction ? 'occluded' : 'clear', distance, cosine,
      roomId: roomId(target), point: target.clone(), origin: origin.clone(),
      obstruction: obstruction ? { distance: obstruction.distance, point: obstruction.point.clone(),
        object: obstruction.object.name, doorId: obstruction.object.userData.doorId ?? null } : null };
  }
  function roomTransmission(source, listener) {
    const hearing = config.hearing;
    source = canonical(source); listener = canonical(listener);
    if (source === listener) return { gain: hearing.sameRoomGain, hops: 0, route: [source] };
    if (outdoor(source) && outdoor(listener)) return { gain: hearing.openRoomGain, hops: 1, route: [source, listener] };
    const queue = [{ room: source, gain: 1, hops: 0, route: [source] }], best = new Map([[source, 1]]);
    let found = null;
    while (queue.length) {
      queue.sort((a, b) => b.gain - a.gain);
      const item = queue.shift();
      if (item.room === listener) { found = item; break; }
      if (item.hops >= hearing.maxRoomHops) continue;
      for (const opening of openings) {
        const rooms = (typeof opening.rooms === 'string' ? opening.rooms.split('|') : opening.rooms ?? []).map(canonical);
        if (!rooms.includes(item.room)) continue;
        const door = world.doors?.find(entry => entry.id === opening.id);
        const gain = item.gain * (door && !door.isOpen ? hearing.closedDoorGain : hearing.openRoomGain);
        for (const next of rooms) {
          if (next === item.room || gain <= (best.get(next) ?? 0)) continue;
          best.set(next, gain); queue.push({ room: next, gain, hops: item.hops + 1, route: [...item.route, next] });
        }
      }
    }
    return found ? { gain: found.gain, hops: found.hops, route: found.route }
      : { gain: hearing.wallGain, hops: null, route: [] };
  }
  function hear(npc, event) {
    if (!event?.position || event.npcId === npc.id || event.sourceId === npc.id) return null;
    npcVector(event.position, origin);
    const sourceRoom = roomId(origin), listenerRoom = roomId(npc.position);
    const distance = origin.distanceTo(npc.position), hearing = config.hearing;
    const range = event.kind === 'step' ? hearing.stepRange : hearing.shotRange;
    if (distance > range) return null;
    const transmission = roomTransmission(sourceRoom, listenerRoom);
    const loudness = (Number.isFinite(event.loudness) ? Math.max(0, event.loudness) : 1)
      * transmission.gain / Math.max(1, distance / hearing.referenceDistance);
    if (loudness + 1e-10 < hearing.threshold) return null;
    return { kind: event.kind, position: origin.clone(), sourceRoom, listenerRoom,
      sourceId: event.sourceId ?? event.npcId ?? 'player', distance, loudness, ...transmission };
  }
  return { visible, hear, roomTransmission, stats: () => ({ queries: collision.queryCount }) };
}
