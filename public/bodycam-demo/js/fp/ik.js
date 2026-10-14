import { MathUtils, Quaternion, Vector3 } from 'three';

const v = () => new Vector3();

/** Rest lengths are never stretched. Unreachable targets return an explicit error. */
export function createTwoBoneIK({ upper, lower, hand, epsilon = 1e-6 }) {
  const shoulder = v(), elbow = v(), wrist = v(), direction = v(), bend = v(), desiredElbow = v();
  const reached = v(), from = v(), to = v(), fallback = v();
  const worldQ = new Quaternion(), parentQ = new Quaternion(), swing = new Quaternion();
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder); lower.getWorldPosition(elbow); hand.getWorldPosition(wrist);
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
  if (Math.min(a, b) < epsilon) throw new Error(`Invalid FP arm lengths: ${upper.name}`);

  function point(bone, child, target) {
    bone.getWorldPosition(from); child.getWorldPosition(to);
    to.sub(from).normalize(); from.copy(target).sub(bone.getWorldPosition(fallback)).normalize();
    swing.setFromUnitVectors(to, from);
    worldQ.copy(bone.getWorldQuaternion(parentQ)).premultiply(swing);
    parentQ.copy(bone.parent.getWorldQuaternion(new Quaternion())).invert();
    bone.quaternion.copy(parentQ.multiply(worldQ));
    bone.updateWorldMatrix(false, true);
  }

  return {
    lengths: [a, b],
    solve(target, pole, rotation, blend = 1) {
      upper.updateWorldMatrix(true, true); upper.getWorldPosition(shoulder);
      direction.copy(target).sub(shoulder);
      const distance = direction.length();
      if (distance < epsilon) direction.set(0, 0, -1); else direction.multiplyScalar(1 / distance);
      const length = MathUtils.clamp(distance, Math.abs(a - b) + epsilon, a + b - epsilon);
      const along = (a * a - b * b + length * length) / (2 * length);
      const height = Math.sqrt(Math.max(0, a * a - along * along));
      bend.copy(pole).sub(shoulder);
      bend.addScaledVector(direction, -bend.dot(direction));
      if (bend.lengthSq() < epsilon * epsilon) {
        fallback.set(Math.abs(direction.y) < 0.9 ? 0 : 1, Math.abs(direction.y) < 0.9 ? -1 : 0, 0);
        bend.copy(fallback).addScaledVector(direction, -fallback.dot(direction));
      }
      bend.normalize();
      desiredElbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(bend, height);
      reached.copy(shoulder).addScaledVector(direction, length);
      const initialUpper = upper.quaternion.clone(), initialLower = lower.quaternion.clone(), initialHand = hand.quaternion.clone();
      point(upper, lower, desiredElbow); point(lower, hand, reached);
      if (rotation) {
        parentQ.copy(hand.parent.getWorldQuaternion(worldQ)).invert();
        hand.quaternion.copy(parentQ.multiply(rotation));
      }
      const amount = MathUtils.clamp(blend, 0, 1);
      upper.quaternion.slerpQuaternions(initialUpper, upper.quaternion.clone(), amount);
      lower.quaternion.slerpQuaternions(initialLower, lower.quaternion.clone(), amount);
      hand.quaternion.slerpQuaternions(initialHand, hand.quaternion.clone(), amount);
      upper.updateWorldMatrix(false, true);
      hand.getWorldPosition(wrist);
      return { reachable: Math.abs(distance - length) < epsilon * 2,
        distanceMeters: wrist.distanceTo(target), reachErrorMeters: Math.abs(distance - length),
        quaternionError: rotation ? hand.getWorldQuaternion(worldQ).angleTo(rotation) : 0,
        position: wrist.toArray(), targetPosition: target.toArray(), elbow: desiredElbow.toArray() };
    },
  };
}
