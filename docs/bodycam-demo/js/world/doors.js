import { MathUtils, Quaternion, Vector3 } from 'three';
import { isCollidable, makeCollider } from './colliders.js';
import { fromBlender } from './coordinates.js';

// Hinged rigid leaf: angular velocity in deg/s, exponential hinge friction, bounces at frame and stop.
export const DOOR_CONFIG = { openThresholdDeg: 55, impulseDegPerSecond: 190, damping: 1.6, restitution: 0.3,
  latchDeg: 2, latchSpeed: 25, pushDegPerSecond: 120, contactMargin: 0.06, thickness: 0.045,
  bulletDegPerSecond: 35, blockedBounce: 0.25 };

const wrapDeg = value => ((value + 540) % 360) - 180;
const headingDeg = (dx, dz) => MathUtils.radToDeg(Math.atan2(-dz, dx));

export function createDoors(house, layout, config = DOOR_CONFIG) {
  const doors = [];
  const definitions = new Map(layout.doors.filter(door => door.kind === 'door')
    .map(door => [door.object, door]));
  const roots = [];
  house.traverse(object => {
    if (object.name.startsWith('DOOR_') && object.userData.hinge) roots.push(object);
  });
  for (const object of roots) {
    const source = definitions.get(object.name) ?? {};
    const extra = { ...source, ...object.userData };
    const meshes = [];
    object.traverse(child => { if (isCollidable(child)) meshes.push(child); });
    const collider = makeCollider(meshes, { name: `COLLIDER_${object.name}`, relativeTo: object });
    object.add(collider);
    const initialAngle = Number(extra.openAngle ?? 0);
    const initialQuaternion = object.quaternion.clone();
    const parentQuaternion = new Quaternion();
    object.parent?.getWorldQuaternion(parentQuaternion);
    const axis = new Vector3(0, 1, 0).applyQuaternion(parentQuaternion.invert()).normalize();
    const rotation = new Quaternion();
    const hinge = fromBlender(extra.hinge);
    // Leaf width and heading at the imported angle, from its farthest vertex around the hinge.
    let width = 0, heading = 0;
    const vertex = new Vector3();
    object.updateWorldMatrix(true, true);
    for (const mesh of meshes) {
      const positions = mesh.geometry?.attributes.position;
      for (let i = 0; positions && i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        const distance = Math.hypot(vertex.x - hinge.x, vertex.z - hinge.z);
        if (distance > width) { width = distance; heading = headingDeg(vertex.x - hinge.x, vertex.z - hinge.z); }
      }
    }
    const door = {
      id: extra.opening ?? source.id ?? object.name.slice(5),
      object,
      collider,
      meshes,
      source,
      hinge,
      width,
      rooms: typeof extra.rooms === 'string' ? extra.rooms.split('|') : extra.rooms ?? [],
      exterior: Boolean(extra.exterior),
      angle: initialAngle,
      targetAngle: initialAngle,
      velocity: 0,
      latched: initialAngle < config.latchDeg,
      pusher: null,
      maxAngle: Number(extra.maxAngle ?? 105),
      openDir: Number(extra.openDir ?? 1),
      closedRotZ: Number(extra.closedRotZ ?? 0),
      blocked: false,
      canMove: null,
      get isOpen() { return this.angle >= config.openThresholdDeg; },
      leafHeading() { return heading + (this.angle - initialAngle) * this.openDir; },
      /** A shove on the handle: opens a closed door, swings an open one shut. */
      setOpen(open) {
        this.targetAngle = open ? this.maxAngle : 0;
        this.latched = false;
        this.velocity = (open ? 1 : -1) * config.impulseDegPerSecond;
      },
      toggle() { this.setOpen(this.angle < config.openThresholdDeg); },
      /** Linear push (m/s scale) at a world point, e.g. a bullet; latched doors stay shut. */
      impulse(point, direction, strength = config.bulletDegPerSecond) {
        if (this.latched || !width) return;
        const dx = point.x - hinge.x, dz = point.z - hinge.z;
        const r = Math.hypot(dx, dz);
        if (r < 1e-3) return;
        // Tangent of increasing angle at the point (rotation about +Y, scaled by openDir).
        const along = (direction.x * dz - direction.z * dx) / r * this.openDir;
        this.velocity += along * strength * Math.min(1, r / width);
      },
      /** pusher: { position, velocity (intended, m/s), radius }. Pressing against the leaf swings it away. */
      push(pusher) {
        const dx = pusher.position.x - hinge.x, dz = pusher.position.z - hinge.z;
        const r = Math.hypot(dx, dz);
        if (r < 0.12 || r > width + pusher.radius * 0.5) return;
        const gap = wrapDeg(headingDeg(dx, dz) - this.leafHeading());
        if (Math.abs(gap) > 90) return;
        const distance = r * Math.sin(MathUtils.degToRad(Math.abs(gap)));
        if (distance > pusher.radius + config.thickness / 2 + config.contactMargin) return;
        const h = MathUtils.degToRad(this.leafHeading());
        const side = Math.sign(gap);
        const pressing = side * (pusher.velocity.x * Math.sin(h) + pusher.velocity.z * Math.cos(h));
        if (pressing < 0.15) return;
        const away = -side * this.openDir;
        const wanted = config.pushDegPerSecond * Math.min(1, pressing / 1.6) * Math.min(1, width / Math.max(r, 0.3));
        if (away * this.velocity < wanted) this.velocity = away * wanted;
      },
      setAngle(angle) {
        this.angle = MathUtils.clamp(angle, 0, this.maxAngle);
        // Preserve the imported glTF basis, including any exporter corrections.
        rotation.setFromAxisAngle(axis, MathUtils.degToRad((this.angle - initialAngle) * this.openDir));
        object.quaternion.copy(initialQuaternion).premultiply(rotation);
        object.updateWorldMatrix(true, true);
      },
      update(dt) {
        if (!(dt > 0)) return;
        const pusher = !this.latched && this.pusher?.();
        if (pusher) this.push(pusher);
        if (this.latched && this.velocity === 0) { this.blocked = false; return; }
        this.velocity *= Math.exp(-config.damping * dt);
        let next = this.angle + this.velocity * dt;
        if (next <= 0) { next = 0; this.velocity = -this.velocity * config.restitution; }
        if (next >= this.maxAngle) { next = this.maxAngle; this.velocity = -this.velocity * config.restitution; }
        if (next < config.latchDeg && Math.abs(this.velocity) < config.latchSpeed && this.velocity <= config.latchSpeed / 2) {
          next = 0; this.velocity = 0; this.latched = true;
        }
        const previousAngle = this.angle;
        this.setAngle(next);
        this.blocked = this.canMove ? !this.canMove() : false;
        if (this.blocked) {
          this.setAngle(previousAngle);
          this.velocity *= -config.blockedBounce;
          this.latched = false;
        }
        this.targetAngle = this.angle;
      },
    };
    // Only IDs go into userData; storing the record here would create a clone cycle.
    object.userData.doorId = door.id;
    collider.userData.doorId = door.id;
    object.updateWorldMatrix(true, true);
    doors.push(door);
  }
  return doors;
}
