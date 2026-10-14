import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

/** Body-hung weapon: the viewmodel trails camera turns and movement on a damped spring,
 * swings with the stride and breathes. update() once per frame, apply() inside updatePose().
 */
export function createSway(camera, config) {
  const previousQuaternion = new Quaternion();
  const previousPosition = new Vector3();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const delta = new Quaternion();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const local = new Vector3();
  const angle = new Vector3(); // x pitch, y yaw in radians
  const angleVelocity = new Vector3();
  const offset = new Vector3();
  const offsetVelocity = new Vector3();
  const pivot = new Vector3(...config.pivot);
  const rotation = new Quaternion();
  const applied = new Euler(0, 0, 0, 'YXZ');
  const relative = new Vector3();
  let primed = false;
  let phase = 0;
  let speed = 0;
  let time = 0;

  function reset() {
    angle.set(0, 0, 0); angleVelocity.set(0, 0, 0);
    offset.set(0, 0, 0); offsetVelocity.set(0, 0, 0);
    primed = false;
  }

  function spring(value, velocity, h) {
    const w = config.stiffness;
    velocity.addScaledVector(value, -w * w * h).multiplyScalar(Math.max(0, 1 - 2 * config.damping * w * h));
    value.addScaledVector(velocity, h);
  }

  function update(dt) {
    camera.updateWorldMatrix(true, false);
    camera.getWorldQuaternion(quaternion);
    camera.getWorldPosition(position);
    // update(0) marks a camera cut (teleport, look): settle the spring at the new pose.
    if (dt <= 0) reset();
    if (!primed) {
      previousQuaternion.copy(quaternion); previousPosition.copy(position); primed = true;
      return;
    }
    euler.setFromQuaternion(delta.copy(previousQuaternion).invert().multiply(quaternion));
    local.subVectors(position, previousPosition).applyQuaternion(delta.copy(quaternion).invert());
    previousQuaternion.copy(quaternion);
    previousPosition.copy(position);
    // Teleports and respawns reset instead of flinging the weapon across the screen.
    if (local.length() > 1 || Math.abs(euler.x) > 1 || Math.abs(euler.y) > 1) { reset(); return; }
    angle.x -= euler.x * config.turnLag;
    angle.y -= euler.y * config.turnLag;
    offset.addScaledVector(local, -config.moveLag);
    const horizontal = Math.hypot(local.x, local.z) / dt;
    speed += (horizontal - speed) * (1 - Math.exp(-dt / 0.15));
    phase += speed * dt / config.stride * Math.PI;
    time += dt;
    for (let left = Math.min(dt, 0.1); left > 1e-6; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      spring(angle, angleVelocity, h);
      spring(offset, offsetVelocity, h);
    }
    angle.clampScalar(-config.maxAngle, config.maxAngle);
    offset.clampScalar(-config.maxOffset, config.maxOffset);
  }

  function apply(viewmodel, ads = 0) {
    const k = 1 - (1 - config.adsScale) * ads;
    const bob = Math.min(1, speed / 2.2) * k;
    const stepX = Math.sin(phase);
    const stepY = Math.abs(Math.cos(phase));
    applied.set(angle.x * k, angle.y * k,
      angle.y * k * config.rollFromYaw + MathUtils.degToRad(config.bobRollDeg) * stepX * bob);
    rotation.setFromEuler(applied);
    relative.subVectors(viewmodel.position, pivot).applyQuaternion(rotation);
    viewmodel.position.copy(pivot).add(relative).addScaledVector(offset, k);
    viewmodel.quaternion.premultiply(rotation);
    viewmodel.position.x += stepX * config.bobOffset[0] * bob;
    viewmodel.position.y += (stepY - 0.6) * config.bobOffset[1] * bob
      + Math.sin(time * 2 * Math.PI * config.breathe[1]) * config.breathe[0] * k;
  }

  return { update, apply, reset, state: () => ({ angle: angle.toArray(), offset: offset.toArray(), speed, phase }) };
}
