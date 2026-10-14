import { Quaternion, Ray, Vector3 } from 'three';
import { CapsuleCollision } from '../player/collision.js';
import { intersectRayCapsule } from './hit-zones.js';
import { npcVector } from './perception.js';

export function createNPCShooting({ world, player, camera, config, random = Math.random }) {
  const collision = new CapsuleCollision(world.colliders), ray = new Ray();
  const origin = new Vector3(), direction = new Vector3(), right = new Vector3(), up = new Vector3();
  const target = new Vector3(), bottom = new Vector3(), top = new Vector3(), quaternion = new Quaternion();
  function cast(npc, aimTarget) {
    npc.root.updateWorldMatrix(true, true);
    npc.nodes.S_Muzzle.getWorldPosition(origin);
    if (config.aimDirection === 'socket')
      direction.fromArray(config.socketForward).applyQuaternion(npc.nodes.S_Muzzle.getWorldQuaternion(quaternion));
    else {
      npcVector(aimTarget ?? camera?.position ?? player.position, target);
      direction.subVectors(target, origin);
    }
    if (direction.lengthSq() < 1e-12) return { fired: false, reason: 'zero-direction' };
    direction.normalize();
    // Gleichmäßige Abtastung des konfigurierten Raumwinkels, keine FPS-abhängige Streuung.
    const cosTheta = 1 - Math.max(0, Math.min(1, random())) * (1 - Math.cos(config.spreadDeg * Math.PI / 180));
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.max(0, Math.min(1, random())) * Math.PI * 2;
    right.set(0, Math.abs(direction.y) > 0.99 ? 0 : 1, Math.abs(direction.y) > 0.99 ? 1 : 0).cross(direction).normalize();
    up.crossVectors(direction, right).normalize();
    direction.multiplyScalar(cosTheta).addScaledVector(right, sinTheta * Math.cos(phi))
      .addScaledVector(up, sinTheta * Math.sin(phi)).normalize();
    ray.set(origin, direction);
    const wall = collision.raycast(origin, direction, config.range);
    const radius = player.config?.radius ?? config.playerRadius;
    const height = player.physics?.height ?? player.config?.height ?? config.playerHeight;
    bottom.copy(player.position).y += radius;
    top.copy(player.position).y += Math.max(radius, height - radius);
    const hit = intersectRayCapsule(ray, bottom, top, radius, 0, config.range);
    const playerHit = hit && (!wall || hit.distance < wall.distance - 1e-6) ? hit : null;
    const room = world.roomAt?.(origin);
    return { fired: true, weapon: 'pistol', npcId: npc.id, sourceId: npc.id,
      position: origin.clone(), direction: direction.clone(), roomId: room?.id ?? 'OUT',
      indoor: !!room && !['OUT', 'PORCH'].includes(room.id),
      playerHit: playerHit ? { ...playerHit, amount: config.damage } : null,
      obstruction: wall ? { point: wall.point, normal: wall.normal, distance: wall.distance, object: wall.object } : null };
  }
  return { cast };
}
