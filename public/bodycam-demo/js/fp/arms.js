import { Euler, Group, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { createAssetLoaders } from '../core/loaders.js';
import { createFPAnimation } from './animation.js';
import { resolveArmsConfig } from './arms-config.js';
import { createTwoBoneIK } from './ik.js';

const SIDES = { L: 'Left', R: 'Right' };
const smooth = t => { t = MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rotation = degrees => new Quaternion().setFromEuler(new Euler(...degrees.map(MathUtils.degToRad), 'YXZ'));

/** Call once after weapon creation, update after weapon.update(), dispose before weapon. */
export async function createFPArms({ weapon, camera, renderer, baseUrl = new URL('../../', import.meta.url),
  config = {}, audio = null } = {}) {
  if (!camera || !weapon?.viewmodel || !weapon.nodes?.W_Grip_R || !weapon.nodes?.W_Grip_L)
    throw new TypeError('FP arms require camera and weapon grip nodes');
  const settings = resolveArmsConfig(config);
  for (const value of [settings.handBlendSeconds, settings.fingerBlendSeconds, settings.reachEpsilon])
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('FP blend times and epsilon must be positive');
  for (const value of [settings.shoulderOffset, settings.shoulderOffsets.L, settings.shoulderOffsets.R,
    settings.poles.L, settings.poles.R])
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
      throw new TypeError('FP offsets/poles must have three finite coordinates');
  const base = new URL(baseUrl, import.meta.url);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const assets = createAssetLoaders({ renderer });
  let gltf;
  try { gltf = await assets.gltf.loadAsync(new URL(settings.model, base).href); }
  finally { assets.dispose(); }
  const model = gltf.scene, mount = new Group(), bones = {}, rest = new Map(), chains = {};
  let animation, weaponSocket, weaponParent, disposed = false;
  function restoreWeaponParent() {
    if (weaponSocket && weapon.model.parent === weaponSocket) weaponParent.add(weapon.model);
    weaponSocket?.removeFromParent();
  }
  try {
    mount.name = 'FP_ArmsViewmodel'; mount.layers.set(1);
    mount.add(model); camera.add(mount);
    model.traverse(node => {
      node.layers.set(1);
      if (node.isBone) {
        bones[node.name] = node;
        rest.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() });
      }
      if (node.isMesh) {
        node.castShadow = false; node.receiveShadow = false;
        // Animated skinned bounds are not the exported A-pose bounds.
        node.frustumCulled = false;
      }
    });
    for (const name of ['FP_Root', 'FP_Camera', 'FP_WeaponSocket'])
      if (!model.getObjectByName(name)) throw new Error(`Missing FP node: ${name}`);
    // Instantiate the authored socket in C3's existing pose/inertia group.
    // Its identity transform preserves every W_* world coordinate and shot ray.
    weaponSocket = model.getObjectByName('FP_WeaponSocket').clone(false);
    weaponSocket.position.set(0, 0, 0); weaponSocket.quaternion.identity(); weaponSocket.scale.set(1, 1, 1);
    weaponSocket.layers.set(1); weaponParent = weapon.model.parent;
    weapon.viewmodel.add(weaponSocket); weaponSocket.add(weapon.model);
    const cameraAnchor = model.getObjectByName('FP_Camera');
    model.updateWorldMatrix(true, true);
    const cameraOrigin = model.worldToLocal(cameraAnchor.getWorldPosition(new Vector3()));
    model.position.sub(cameraOrigin);
    model.updateWorldMatrix(true, true);
    const basis = weapon.state().pose;
    const referencePosition = new Vector3(...(basis?.lowReadyPosition ?? weapon.viewmodel.position.toArray()));
    const referenceRotation = rotation(weapon.poses.lowReady.rotationDeg);
    const inverseReference = referenceRotation.clone().invert();
    const position = new Vector3(), pole = new Vector3(), worldQ = new Quaternion(), deltaQ = new Quaternion();
    const euler = new Euler(), identity = new Quaternion();
    const targets = {}, fingers = {}, metrics = {};
    let lastReload = null;
    for (const [side, prefix] of Object.entries(SIDES)) {
      const upper = bones[`${prefix}Arm`], lower = bones[`${prefix}ForeArm`], hand = bones[`${prefix}Hand`];
      if (!upper || !lower || !hand) throw new Error(`Missing FP arm chain: ${prefix}`);
      chains[side] = createTwoBoneIK({ upper, lower, hand, epsilon: settings.reachEpsilon });
      const axes = settings.handAxes[side];
      const y = new Vector3(...axes.fingers).normalize(), z = new Vector3(...axes.back).normalize();
      const x = new Vector3().crossVectors(y, z).normalize();
      z.crossVectors(x, y).normalize();
      if (x.lengthSq() < 0.5) throw new Error(`Invalid FP hand axes: ${side}`);
      const offset = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
      targets[side] = { mode: 'auto', object: weapon.nodes[`W_Grip_${side}`], current: null,
        blend: 1, age: 0, seconds: settings.handBlendSeconds, fromPosition: new Vector3(),
        fromQuaternion: new Quaternion(), localPosition: new Vector3(), localQuaternion: new Quaternion(),
        position: new Vector3(), quaternion: new Quaternion(), offset };
      const pose = side === 'R' ? 'trigger' : 'grip';
      fingers[side] = { pose, age: settings.fingerBlendSeconds, seconds: settings.fingerBlendSeconds,
        from: new Map(), values: new Map() };
    }
    animation = await createFPAnimation({ root: model, clips: gltf.animations, weapon, audio,
      baseUrl: base, config: settings.animation });

    function checkSide(side) {
      if (!Object.hasOwn(SIDES, side)) throw new RangeError('FP hand side must be L or R');
    }
    function setHandTarget(side, object, blend = 1) {
      checkSide(side);
      if (object !== null && !object?.isObject3D) throw new TypeError('Hand target must be Object3D or null');
      if (!Number.isFinite(blend) || blend < 0 || blend > 1) throw new RangeError('Hand blend: 0..1');
      const hand = targets[side];
      hand.mode = 'custom'; hand.object = object; hand.blend = blend;
      return api;
    }
    function resetHandTarget(side) {
      checkSide(side); targets[side].mode = 'auto'; targets[side].blend = 1; return api;
    }
    function setFingerPose(side, preset, seconds = settings.fingerBlendSeconds) {
      checkSide(side);
      if (!Object.hasOwn(settings.fingerPoses, preset)) throw new RangeError(`Unknown FP finger preset: ${preset}`);
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('FP finger transition must be non-negative');
      const hand = fingers[side];
      hand.from = new Map([...hand.values].map(([bone, q]) => [bone, q.clone()]));
      hand.pose = preset; hand.age = 0; hand.seconds = seconds;
      return api;
    }
    function applyFingers(side, dt) {
      const hand = fingers[side], preset = settings.fingerPoses[hand.pose];
      hand.age += dt;
      const amount = hand.seconds ? smooth(hand.age / hand.seconds) : 1;
      for (const [finger, values] of Object.entries(preset)) {
        for (let index = 0; index < 3; index++) {
          const bone = bones[`${SIDES[side]}Hand${finger}${index + 1}`];
          if (!bone) continue;
          const value = values[index];
          const angles = Array.isArray(value) ? [...value] : [value, 0, 0];
          if (side === 'R') { angles[1] = -angles[1]; angles[2] = -angles[2]; }
          const desired = new Quaternion().setFromEuler(euler.set(...angles.map(MathUtils.degToRad), 'XYZ'));
          const q = (hand.from.get(bone) ?? desired).clone().slerp(desired, amount);
          hand.values.set(bone, q);
          bone.quaternion.multiply(q);
        }
      }
    }
    function update(dt, locomotion = {}) {
      if (disposed) return;
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('FP dt must be finite and non-negative');
      const state = weapon.state();
      for (const [bone, transform] of rest) {
        bone.position.copy(transform.position); bone.quaternion.copy(transform.quaternion); bone.scale.copy(transform.scale);
      }
      animation.update(dt, { ...state, ...locomotion });
      mount.position.fromArray(settings.shoulderOffset)
        .addScaledVector(position.copy(weapon.viewmodel.position).sub(referencePosition), settings.shoulderFollow.translation);
      deltaQ.copy(weapon.viewmodel.quaternion).multiply(inverseReference);
      mount.quaternion.slerpQuaternions(identity, deltaQ, settings.shoulderFollow.rotation);
      mount.updateWorldMatrix(true, true);
      for (const [side, prefix] of Object.entries(SIDES)) {
        const shoulder = bones[`${prefix}Shoulder`];
        if (!shoulder) continue;
        // Side-specific anatomical placement, expressed in camera-space metres.
        const parentInverse = shoulder.parent.getWorldQuaternion(new Quaternion()).invert();
        const toParent = parentInverse.multiply(camera.getWorldQuaternion(new Quaternion()));
        shoulder.position.add(position.fromArray(settings.shoulderOffsets[side]).applyQuaternion(toParent));
        shoulder.updateWorldMatrix(false, true);
      }
      if (state.reloadKind !== lastReload && targets.L.mode === 'auto') {
        setFingerPose('L', state.reloadKind ? 'open' : 'grip');
        lastReload = state.reloadKind;
      }
      for (const side of Object.keys(SIDES)) {
        const hand = targets[side];
        let object = hand.object;
        if (hand.mode === 'auto') {
          object = weapon.nodes[`W_Grip_${side}`];
          if (side === 'L' && state.reloadKind && settings.reload.enabled)
            object = weapon.nodes.W_MagWell ?? object;
        }
        applyFingers(side, dt);
        if (object && hand.blend > 0) {
          object.updateWorldMatrix(true, false);
          object.getWorldPosition(position);
          object.getWorldQuaternion(worldQ).multiply(hand.offset);
          if (object !== hand.current) {
            const initial = hand.current === null;
            hand.fromPosition.copy(initial ? camera.worldToLocal(position.clone()) : hand.localPosition);
            hand.fromQuaternion.copy(initial
              ? camera.getWorldQuaternion(new Quaternion()).invert().multiply(worldQ) : hand.localQuaternion);
            hand.current = object; hand.age = initial ? settings.handBlendSeconds : 0;
            hand.seconds = side === 'L' && hand.mode === 'auto'
              ? state.reloadKind ? settings.reload.enterSeconds : settings.reload.returnSeconds : settings.handBlendSeconds;
          }
          hand.age += dt;
          const t = hand.seconds > 0 ? smooth(hand.age / hand.seconds) : 1;
          // The outgoing hand pose moves with the body during a turn or step.
          // The incoming Object3D can still intentionally be fixed in world space.
          hand.position.lerpVectors(camera.localToWorld(hand.fromPosition.clone()), position, t);
          hand.quaternion.slerpQuaternions(camera.getWorldQuaternion(new Quaternion())
            .multiply(hand.fromQuaternion), worldQ, t);
          hand.localPosition.copy(camera.worldToLocal(hand.position.clone()));
          hand.localQuaternion.copy(camera.getWorldQuaternion(new Quaternion()).invert()).multiply(hand.quaternion);
          camera.localToWorld(pole.fromArray(settings.poles[side]));
          const result = chains[side].solve(hand.position, pole, hand.quaternion, hand.blend);
          metrics[side] = { ...result, target: object.name || object.uuid, blend: hand.blend,
            transitioning: t < 1, targetDistanceMeters: bones[`${SIDES[side]}Hand`].getWorldPosition(position)
              .distanceTo(object.getWorldPosition(pole)), fingerPose: fingers[side].pose };
        } else {
          hand.current = null;
          metrics[side] = { target: null, blend: 0, reachable: null, distanceMeters: null,
            quaternionError: null, fingerPose: fingers[side].pose };
        }
      }
      mount.updateWorldMatrix(false, true);
      // updateMatrixWorld propagates bone transforms; renderer uploads the skin once.
    }
    function dispose() {
      if (disposed) return;
      disposed = true; animation.dispose(); restoreWeaponParent(); mount.removeFromParent(); disposeModel(model);
    }
    const api = { model, root: mount, bones, animation, config: settings, update,
      setHandTarget, resetHandTarget, setFingerPose, setAudio: value => animation.setAudio(value), dispose,
      state: () => ({ disposed, hands: structuredClone(metrics), animation: animation.state(),
        layer: mount.layers.mask, lengths: Object.fromEntries(Object.entries(chains).map(([side, chain]) => [side, chain.lengths])) }),
    };
    update(0);
    return api;
  } catch (error) {
    animation?.dispose(); restoreWeaponParent(); mount.removeFromParent(); disposeModel(model); throw error;
  }
}

function disposeModel(model) {
  const resources = new Set();
  model.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    if (node.isSkinnedMesh) resources.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}
