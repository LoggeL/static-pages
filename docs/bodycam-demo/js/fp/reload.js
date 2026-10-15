import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

// Left-hand choreography in weapon-model space (metres, degrees, seconds in the weapon timeline).
// 'mag' keys place a virtual magazine frame relative to the seated magazine; the hand holds it
// with the grab pose below. 'weapon' keys place the palm directly. Marker times live in weapon/config.js.
export const RELOAD_GRAB = { point: [-0.012, -0.074, -0.128], fingers: [0, 0.35, -1], palm: [1, 0, 0],
  contact: [0, 0.056, 0.02] };
const POUCH = { offset: [-0.13, -0.42, 0.15], rotation: [-35, 0, 42] };
const BELOW = { offset: [-0.07, -0.27, 0.07], rotation: [-20, 0, 20] };
const PRE_INSERT = { offset: [-0.004, -0.085, 0.004], rotation: [11, 0, -4] };
const ENTRY = { offset: [0, -0.028, 0], rotation: [3, 0, 0] };
const SEATED = { offset: [0, 0, 0], rotation: [0, 0, 0] };

export const RELOAD_CHOREOGRAPHY = {
  // Tactical: partial magazine goes back into the vest, a fresh one comes up.
  Reload: {
    keys: [
      { t: 0, kind: 'grip', finger: 'grip', stop: true },
      { t: 0.28, kind: 'mag', offset: [-0.06, -0.10, -0.015], rotation: [0, 0, -18], finger: 'open' },
      { t: 0.47, kind: 'mag', ...SEATED, finger: 'mag', stop: true },
      { t: 0.58, kind: 'mag', ...SEATED, stop: true },
      { t: 0.78, kind: 'mag', offset: [-0.008, -0.12, 0.012], rotation: [-8, 0, -4] },
      { t: 1.04, kind: 'mag', ...BELOW },
      { t: 1.33, kind: 'mag', ...POUCH, stop: true },
      { t: 1.62, kind: 'mag', ...POUCH, stop: true },
      { t: 1.95, kind: 'mag', ...BELOW },
      { t: 2.26, kind: 'mag', ...PRE_INSERT },
      { t: 2.50, kind: 'mag', ...ENTRY },
      { t: 2.67, kind: 'mag', ...SEATED, stop: true },
      { t: 2.74, kind: 'mag', offset: [0, 0.006, 0], rotation: [0, 0, 0], stop: true },
      { t: 2.90, kind: 'mag', offset: [-0.035, -0.05, 0], rotation: [0, 0, -12], finger: 'open' },
      { t: 3.28, kind: 'grip', finger: 'grip', stop: true },
      { t: 3.70, kind: 'grip', stop: true },
    ],
    magazine: [[0, 'well'], [0.56, 'hand'], [1.30, 'hidden'], [1.50, 'hand'], [2.67, 'well']],
  },
  // Empty: release, let the empty magazine fall, fresh one in, slap the bolt catch.
  ReloadEmpty: {
    keys: [
      { t: 0, kind: 'grip', finger: 'grip', stop: true },
      { t: 0.17, kind: 'mag', offset: [-0.06, -0.11, -0.01], rotation: [0, 0, -20], finger: 'open' },
      { t: 0.42, kind: 'mag', ...BELOW },
      { t: 0.66, kind: 'mag', ...POUCH, finger: 'mag', stop: true },
      { t: 0.76, kind: 'mag', ...POUCH, stop: true },
      { t: 1.03, kind: 'mag', ...BELOW },
      { t: 1.31, kind: 'mag', ...PRE_INSERT },
      { t: 1.52, kind: 'mag', ...ENTRY },
      { t: 1.66, kind: 'mag', ...SEATED, stop: true },
      { t: 1.74, kind: 'mag', offset: [0, 0.006, 0], rotation: [0, 0, 0], stop: true },
      { t: 1.98, kind: 'weapon', point: [-0.075, -0.01, -0.10], fingers: [0, 0.6, -0.8], palm: [1, 0, 0], finger: 'flat' },
      { t: 2.36, kind: 'weapon', point: [-0.052, 0.03, -0.088], fingers: [0, 0.55, -0.84], palm: [1, 0, 0] },
      { t: 2.55, kind: 'weapon', point: [-0.03, 0.034, -0.084], fingers: [0, 0.55, -0.84], palm: [1, 0, 0], stop: true },
      { t: 2.63, kind: 'weapon', point: [-0.058, 0.026, -0.10], fingers: [0, 0.5, -0.87], palm: [1, 0, 0] },
      { t: 2.90, kind: 'grip', finger: 'grip', stop: true },
    ],
    magazine: [[0, 'well'], [0.26, 'drop'], [0.70, 'hand'], [1.66, 'well']],
  },
};

const handBasis = (fingers, palm) => {
  const y = new Vector3(...fingers).normalize(), z = new Vector3(...palm);
  const x = new Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
};
const degrees = values => new Quaternion().setFromEuler(new Euler(...values.map(MathUtils.degToRad), 'XYZ'));
const GRAVITY = 9.81;

/** Samples the left-hand reload pose and owns the magazine visibility/transform while reloading. */
export function createReloadMotion({ weapon, camera, config = {}, choreography = RELOAD_CHOREOGRAPHY, grab = RELOAD_GRAB }) {
  const settings = { fingerLead: 0.09, dropLifetime: 9, maxDropped: 4, ...config };
  const model = weapon.model, mag = weapon.nodes.W_Mag;
  model.updateWorldMatrix(true, true);
  const modelInverse = new Matrix4().copy(model.matrixWorld).invert();
  const magRest = new Matrix4().multiplyMatrices(modelInverse, mag.matrixWorld);
  const magLocal = { position: mag.position.clone(), quaternion: mag.quaternion.clone() };
  const magRestPosition = new Vector3().setFromMatrixPosition(magRest);
  const magRestQuaternion = new Quaternion().setFromRotationMatrix(magRest);
  // Hand frame relative to the magazine, fixed by the grab pose.
  const grabQuaternion = handBasis(grab.fingers, grab.palm);
  const grabWrist = new Vector3(...grab.point).sub(new Vector3(...grab.contact).applyQuaternion(grabQuaternion));
  const handInMag = new Matrix4().copy(magRest).invert()
    .multiply(new Matrix4().compose(grabWrist, grabQuaternion, new Vector3(1, 1, 1)));
  const magInHand = handInMag.clone().invert();
  for (const timeline of Object.values(choreography))
    for (const key of timeline.keys) {
      if (key.kind === 'mag') key.matrix = new Matrix4().compose(
        magRestPosition.clone().add(new Vector3(...key.offset)),
        degrees(key.rotation).multiply(magRestQuaternion), new Vector3(1, 1, 1)).multiply(handInMag);
      if (key.kind === 'weapon') {
        const q = handBasis(key.fingers, key.palm);
        const wrist = new Vector3(...key.point).sub(new Vector3(...(key.contact ?? grab.contact)).applyQuaternion(q));
        key.matrix = new Matrix4().compose(wrist, q, new Vector3(1, 1, 1));
      }
    }

  let scene = camera;
  while (scene.parent) scene = scene.parent;
  const dropped = [];
  let active = null, lastTime = 0, magState = null;
  const tmp = new Matrix4(), scale = new Vector3(), points = [], rotations = [];
  for (let i = 0; i < 4; i++) { points.push(new Vector3()); rotations.push(new Quaternion()); }

  function keyPose(key, gripPose, position, quaternion) {
    if (key.kind === 'grip') return gripPose(position, quaternion);
    tmp.multiplyMatrices(model.matrixWorld, key.matrix).decompose(position, quaternion, scale);
  }

  /** Returns null outside a reload, otherwise the wrist target and finger preset. */
  function sample(state, gripPose, out) {
    const timeline = state.reloadKind ? choreography[state.reloadKind] : null;
    if (!timeline) { active = null; return null; }
    const duration = weapon.config.reload[state.reloadKind].dur;
    const time = state.reloadProgress * duration;
    if (active !== state.reloadKind || time + 1e-6 < lastTime) { active = state.reloadKind; lastTime = -1; }
    for (const [at, value] of timeline.magazine)
      if (value === 'drop' && at > lastTime && at <= time) drop();
    lastTime = time;
    magState = timeline.magazine.filter(([at]) => at <= time).at(-1)?.[1] ?? 'well';
    const keys = timeline.keys;
    let index = keys.findIndex(key => key.t > time) - 1;
    if (index < 0) index = index === -2 ? keys.length - 2 : 0;
    const a = keys[index], b = keys[index + 1] ?? a;
    const span = Math.max(1e-6, b.t - a.t), u = MathUtils.clamp((time - a.t) / span, 0, 1);
    const window = [keys[index - 1] ?? a, a, b, keys[index + 2] ?? b];
    window.forEach((key, i) => keyPose(key, gripPose, points[i], rotations[i]));
    // Non-uniform Catmull-Rom; 'stop' keys and the timeline ends have zero velocity.
    const tangent = (i, key, prev, next) => key.stop || prev === key || next === key ? null
      : points[i + 1].clone().sub(points[i - 1]).multiplyScalar(span / Math.max(1e-6, next.t - prev.t));
    const m0 = tangent(1, a, window[0], b), m1 = tangent(2, b, a, window[3]);
    const u2 = u * u, u3 = u2 * u;
    out.position.copy(points[1]).multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(points[2], -2 * u3 + 3 * u2);
    if (m0) out.position.addScaledVector(m0, u3 - 2 * u2 + u);
    if (m1) out.position.addScaledVector(m1, u3 - u2);
    // Hermite from 0 to 1 with unit slope at moving keys, so rotations do not pause there.
    const ease = -2 * u3 + 3 * u2 + (a.stop ? 0 : u3 - 2 * u2 + u) + (b.stop ? 0 : u3 - u2);
    out.quaternion.slerpQuaternions(rotations[1], rotations[2], MathUtils.clamp(ease, 0, 1));
    out.finger = keys.filter(key => key.finger && key.t - settings.fingerLead <= time).at(-1)?.finger ?? 'grip';
    out.key = `reload:${state.reloadKind}`;
    return out;
  }

  /** Call after the hand IK; places the magazine in the hand or hides it. */
  function applyMagazine(hand) {
    if (!active || !magState) return;
    mag.position.copy(magLocal.position); mag.quaternion.copy(magLocal.quaternion);
    mag.visible = magState === 'well' || magState === 'hand';
    if (magState === 'hand') {
      tmp.multiplyMatrices(hand.matrixWorld, magInHand);
      tmp.premultiply(new Matrix4().copy(mag.parent.matrixWorld).invert()).decompose(mag.position, mag.quaternion, scale);
    }
    mag.updateWorldMatrix(false, true);
  }
  function release() {
    if (!active) return;
    active = null; magState = null;
    mag.position.copy(magLocal.position); mag.quaternion.copy(magLocal.quaternion); mag.visible = true;
  }

  function drop() {
    mag.updateWorldMatrix(true, true);
    const copy = mag.clone(true);
    copy.traverse(node => { node.layers.set(0); node.castShadow = true; });
    mag.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    scene.add(copy);
    const down = new Vector3(0, -1, 0).applyQuaternion(copy.quaternion);
    dropped.push({ object: copy, age: 0, bounces: 0, resting: false,
      velocity: down.multiplyScalar(0.9).add(new Vector3(0, -0.2, 0)),
      spin: new Vector3(3.2, 1.1, -2.4).applyQuaternion(camera.getWorldQuaternion(new Quaternion())) });
    while (dropped.length > settings.maxDropped) remove(dropped[0]);
  }
  function remove(item) {
    item.object.removeFromParent();
    dropped.splice(dropped.indexOf(item), 1);
  }
  const spinQ = new Quaternion(), axis = new Vector3();
  function updateDropped(dt, floorY) {
    for (const item of [...dropped]) {
      item.age += dt;
      if (item.age > settings.dropLifetime) { remove(item); continue; }
      if (item.resting) continue;
      const body = item.object;
      item.velocity.y -= GRAVITY * dt;
      body.position.addScaledVector(item.velocity, dt);
      const speed = item.spin.length();
      if (speed > 1e-6) body.quaternion.premultiply(spinQ.setFromAxisAngle(axis.copy(item.spin).divideScalar(speed), speed * dt));
      // Lowest point of a 20 cm magazine, roughly its half length when tumbling.
      const floor = (floorY ?? camera.getWorldPosition(axis).y - 1.4) + 0.012;
      if (body.position.y < floor + 0.06) {
        body.position.y = floor + 0.06;
        if (item.bounces++ >= 1 || Math.abs(item.velocity.y) < 0.6) {
          item.resting = true;
          // Lie on the broad side.
          const side = new Vector3(1, 0, 0).applyQuaternion(body.quaternion);
          body.quaternion.premultiply(new Quaternion().setFromUnitVectors(side, new Vector3(0, Math.sign(side.y) || 1, 0)));
          body.position.y = floor;
        } else {
          item.velocity.set(item.velocity.x * 0.45, -item.velocity.y * 0.28, item.velocity.z * 0.45);
          item.spin.multiplyScalar(0.4);
        }
      }
    }
  }

  return { sample, applyMagazine, release, updateDropped, state: () => ({ active, magazine: magState, time: lastTime,
    dropped: dropped.length }), dispose() { release(); for (const item of [...dropped]) remove(item); } };
}
