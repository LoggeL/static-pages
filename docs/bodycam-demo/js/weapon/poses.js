import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

// Position is solved from the projection; these are the remaining free parameters.
export const WEAPON_POSES = {
  // STYLE §5.1 compact ready: muzzle just below centre, rifle rising out of the lower right, stock at chest height.
  lowReady: { muzzleUV: [0.52, 0.6], muzzleDepth: 0.78, rotationDeg: [9, 9, -6] },
  ads: { positionOffset: [0, 0, 0], rotationDeg: [0, 0, 0] },
  sprint: { positionOffset: [0.08, -0.12, 0.05], rotationDeg: [-24, 25, -30], tau: 0.1 },
  reload: { positionOffset: [-0.10, 0.10, -0.20], rotationDeg: [0, -8, -22],
    raiseSeconds: 0.28, returnSeconds: 0.42, magTravel: [-0.10, -0.34, 0.035],
    magOutSeconds: 0.40, magInSeconds: 0.44, magRotationDeg: [0, 0, -16] },
  inspect: { positionOffset: [-0.025, 0.01, 0.015], rotationDeg: [5, 18, 24] },
  // Inertia: radians/metres of lag per camera rotation/translation, spring in rad/s, pivot near the chest.
  sway: { turnLag: 0.45, moveLag: 0.25, stiffness: 9, damping: 0.5, maxAngle: 0.16, maxOffset: 0.06,
    pivot: [0.06, -0.22, 0.1], rollFromYaw: 0.7, stride: 0.78, bobOffset: [0.009, 0.012], bobRollDeg: 1.4,
    breathe: [0.0022, 0.24], adsScale: 0.35 },
  boltTravel: 0.028,
  maxSubstep: 1 / 120,
};

export function rotationQuaternion(degrees) {
  return new Quaternion().setFromEuler(new Euler(...degrees.map(MathUtils.degToRad), 'YXZ'));
}

/** Coordinates relative to the loaded model, independent of camera/player transforms. */
export function readAnchor(model, node) {
  model.updateWorldMatrix(true, true);
  const position = model.worldToLocal(node.getWorldPosition(new Vector3()));
  const quaternion = model.getWorldQuaternion(new Quaternion()).invert()
    .multiply(node.getWorldQuaternion(new Quaternion()));
  return { position, quaternion };
}

export function solveWeaponPoses(camera, anchors, config = WEAPON_POSES) {
  const low = config.lowReady;
  const halfHeight = low.muzzleDepth * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
  const target = new Vector3((2 * low.muzzleUV[0] - 1) * halfHeight * camera.aspect,
    (1 - 2 * low.muzzleUV[1]) * halfHeight, -low.muzzleDepth);
  const quaternion = rotationQuaternion(low.rotationDeg);
  const position = target.clone().sub(anchors.muzzle.position.clone().applyQuaternion(quaternion));
  const adsQuaternion = rotationQuaternion(config.ads.rotationDeg).multiply(anchors.eye.quaternion.clone().invert());
  const adsPosition = anchors.eye.position.clone().applyQuaternion(adsQuaternion).negate()
    .add(new Vector3(...config.ads.positionOffset));
  return {
    lowReady: { position, quaternion },
    ads: { position: adsPosition, quaternion: adsQuaternion },
    sprint: { position: position.clone().add(new Vector3(...config.sprint.positionOffset)),
      quaternion: quaternion.clone().multiply(rotationQuaternion(config.sprint.rotationDeg)) },
    calculation: { fov: camera.getEffectiveFOV(), aspect: camera.aspect, muzzleCamera: target.toArray(),
      lowReadyPosition: position.toArray(), sightEye: anchors.eye.position.toArray(), adsPosition: adsPosition.toArray() },
  };
}
