import { Euler, Group, MathUtils, Matrix3, Quaternion, Raycaster, Vector3 } from 'three';
import { createAssetLoaders } from '../core/loaders.js';
import { accelerateShootables } from '../world/colliders.js';
import { surfaceOf } from '../world/surfaces.js';
import { createWeaponBus } from './events.js';
import { createWeaponState } from './state.js';
import { resolveWeaponConfig } from './config.js';
import { createRecoil } from './recoil.js';
import { createWeaponEffects } from './effects.js';
import { createSway } from './sway.js';
import { WEAPON_POSES, readAnchor, rotationQuaternion, solveWeaponPoses } from './poses.js';

const FORWARD = new Vector3(0, 0, -1);
const smooth = x => { x = MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** Hooks replace individual standard effects; null explicitly disables a hook.
 * Call after player.update(dt). Camera recoil is an absolute, nonaccumulating event.
 */
export async function createWeapon({ scene, camera, renderer, world, input, bus = createWeaponBus(),
  baseUrl = new URL('../../', import.meta.url), config = {}, poses = {}, effects = {},
  hooks = {}, effectsFactory = createWeaponEffects, random = Math.random } = {}) {
  if (!scene || !camera || !world?.shootables) throw new TypeError('Weapon requires scene, camera and C12 world');
  const settings = resolveWeaponConfig(config);
  const poseConfig = { ...WEAPON_POSES, ...poses };
  for (const key of ['lowReady', 'ads', 'sprint', 'reload', 'inspect', 'sway']) {
    poseConfig[key] = { ...WEAPON_POSES[key], ...poses[key] };
  }
  for (const value of [poseConfig.maxSubstep, poseConfig.lowReady.muzzleDepth, poseConfig.sprint.tau]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Pose depth and timesteps must be positive');
  }
  const recoil = createRecoil(settings.recoil);
  const url = new URL(baseUrl, import.meta.url);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const assets = createAssetLoaders({ renderer });
  let model;
  try {
    model = (await assets.gltf.loadAsync(new URL('models/carbine.glb', url).href)).scene;
  } finally {
    assets.dispose();
  }
  const viewmodel = new Group();
  let defaults;
  const unsubscribe = [];
  try {
    const nodes = {};
    model.traverse(node => { if (node.name.startsWith('W_')) nodes[node.name] = node; node.layers.set(1); });
    for (const name of ['W_Root', 'W_Muzzle', 'W_SightEye', 'W_Ejection', 'W_LightEmitter', 'W_Mag']) {
      if (!nodes[name]) throw new Error(`Missing weapon anchor: ${name}`);
    }
    const anchors = { muzzle: readAnchor(model, nodes.W_Muzzle), eye: readAnchor(model, nodes.W_SightEye) };
    viewmodel.name = 'WeaponViewmodel';
    viewmodel.layers.set(1);
    viewmodel.add(model);
    camera.add(viewmodel);
    const restMag = { position: nodes.W_Mag.position.clone(), quaternion: nodes.W_Mag.quaternion.clone() };
    const restBolt = nodes.W_Bolt?.position.clone();
    let disposed = false;
    let lightOn = false;
    let sprintBlend = 0;
    let shotAge = Infinity;
    let lastHit = null;
    let shake = 0;
    let poseSet = solveWeaponPoses(camera, anchors, poseConfig);
    const sway = createSway(camera, poseConfig.sway);
    let machine;
    const raycaster = new Raycaster();
    raycaster.firstHitOnly = true;
    raycaster.far = config.range ?? 200;
    accelerateShootables(world.shootables);
    const normalMatrix = new Matrix3();
    const results = [];
    const context = () => {
      const position = nodes.W_Muzzle.getWorldPosition(new Vector3());
      const room = world.roomAt?.(position);
      return { weapon: 'rifle', position, roomId: room?.id ?? 'OUT',
        indoor: !!room && !['OUT', 'PORCH'].includes(room.id), time: machine?.state().time ?? 0 };
    };
    const emit = (type, payload) => bus.emit(type, { ...context(), ...payload });
    defaults = await effectsFactory({ scene, camera, renderer, nodes, world, baseUrl: url, emit, random, config: effects });
    const hook = (name, ...args) => {
      if (Object.hasOwn(hooks, name)) return hooks[name]?.(...args);
      return defaults[name]?.(...args);
    };

    function raycast() {
      scene.updateMatrixWorld(true);
      const position = nodes.W_Muzzle.getWorldPosition(new Vector3());
      const direction = FORWARD.clone().applyQuaternion(nodes.W_Muzzle.getWorldQuaternion(new Quaternion())).normalize();
      raycaster.set(position, direction);
      results.length = 0;
      const candidates = world.shootables.filter(object => {
        for (let node = object; node; node = node.parent) if (!node.visible) return false;
        return true;
      });
      raycaster.intersectObjects(candidates, false, results);
      const hit = results[0];
      if (!hit) return { position, direction, hit: null };
      const normal = hit.face.normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
      if (normal.dot(direction) > 0) normal.negate();
      return { position, direction, hit: { point: hit.point.clone(), normal,
        surface: surfaceOf(hit.object, hit.face.materialIndex), object: hit.object, distance: hit.distance } };
    }

    function handleEvent(type, payload) {
      if (type !== 'shot') { emit(type, payload); return; }
      publishCameraRecoil();
      updatePose(0);
      const shot = raycast();
      const data = { ...context(), ...payload, position: shot.position, direction: shot.direction };
      lastHit = shot.hit;
      bus.emit('shot', data);
      hook('shot', data);
      if (shot.hit) {
        const impact = { ...context(), ...shot.hit, position: shot.hit.point, time: payload.time, shotIndex: payload.index };
        bus.emit('impact', impact);
        hook('impact', impact);
      }
      const impulse = recoil.kick(random);
      emit('recoil', { ...payload, impulse, cameraShare: settings.recoil.cameraShare, shake: 0.25 });
      shotAge = 0;
      shake = Math.min(1, shake + 0.25);
    }
    machine = createWeaponState({ emit: handleEvent, config: settings, random, onAdvance: advanceEffects });

    function advanceEffects(dt) {
      recoil.update(dt);
      hook('update', dt);
      shotAge += dt;
      shake *= Math.exp(-dt / 0.12);
      publishCameraRecoil();
      updatePose(dt);
    }

    function updatePose(dt) {
      const state = machine.state();
      poseSet = solveWeaponPoses(camera, anchors, poseConfig);
      const amount = state.adsProgress;
      viewmodel.position.lerpVectors(poseSet.lowReady.position, poseSet.ads.position, amount);
      viewmodel.quaternion.slerpQuaternions(poseSet.lowReady.quaternion, poseSet.ads.quaternion, amount);
      sprintBlend += (Number(state.state === 'sprint') - sprintBlend) * (1 - Math.exp(-dt / poseConfig.sprint.tau));
      viewmodel.position.lerp(poseSet.sprint.position, sprintBlend);
      viewmodel.quaternion.slerp(poseSet.sprint.quaternion, sprintBlend);
      nodes.W_Mag.position.copy(restMag.position);
      nodes.W_Mag.quaternion.copy(restMag.quaternion);
      nodes.W_Mag.visible = true;
      if (state.reloadKind) {
        const timeline = settings.reload[state.reloadKind];
        const t = state.reloadProgress * timeline.dur;
        const r = poseConfig.reload;
        const envelope = smooth(t / r.raiseSeconds) * smooth((timeline.dur - t) / r.returnSeconds);
        viewmodel.position.addScaledVector(new Vector3(...r.positionOffset), envelope);
        viewmodel.quaternion.multiply(new Quaternion().slerp(rotationQuaternion(r.rotationDeg), envelope));
        for (const [marker, kick] of Object.entries(r.kicks ?? {})) {
          const x = (t - (timeline[marker] ?? Infinity)) / kick.seconds;
          if (!(x > 0)) continue;
          const amount = x * Math.exp(1 - x);
          viewmodel.position.addScaledVector(new Vector3(...kick.offset), amount);
          viewmodel.quaternion.multiply(new Quaternion().slerp(rotationQuaternion(kick.rotationDeg), amount));
        }
        if (t >= timeline.magOut && t < timeline.magIn) {
          const outward = smooth((t - timeline.magOut) / r.magOutSeconds);
          const inward = smooth((timeline.magIn - t) / r.magInSeconds);
          const travel = Math.min(outward, inward);
          nodes.W_Mag.position.addScaledVector(new Vector3(...r.magTravel), travel);
          nodes.W_Mag.quaternion.multiply(new Quaternion().slerp(rotationQuaternion(r.magRotationDeg), travel));
          nodes.W_Mag.visible = travel < 0.995;
        }
      } else if (state.state === 'inspect') {
        const envelope = Math.sin(Math.PI * (state.inspectProgress ?? 0.5));
        viewmodel.position.addScaledVector(new Vector3(...poseConfig.inspect.positionOffset), envelope);
        viewmodel.quaternion.multiply(new Quaternion().slerp(rotationQuaternion(poseConfig.inspect.rotationDeg), envelope));
      }
      const offset = recoil.state();
      viewmodel.position.z += offset.back;
      viewmodel.quaternion.premultiply(new Quaternion().setFromEuler(new Euler(offset.pitch, offset.yaw, 0, 'YXZ')));
      sway.apply(viewmodel, state.adsProgress);
      if (restBolt) {
        nodes.W_Bolt.position.copy(restBolt);
        const empty = state.chamber === 0;
        nodes.W_Bolt.position.z += poseConfig.boltTravel * (empty ? 1 : Math.max(0, 1 - shotAge / 0.055));
      }
      viewmodel.updateWorldMatrix(true, true);
    }
    updatePose(0);
    if (input) {
      unsubscribe.push(input.on('fire', event => machine.trigger(event.pressed)),
        input.on('aim', event => machine.ads(event.pressed)), input.on('reload', () => machine.reload()),
        input.on('inspect', () => machine.inspect()), input.on('firemode', () => machine.toggleMode()),
        input.on('flashlight', () => light(!lightOn)), input.on('pause', () => machine.trigger(false)));
    }

    function light(on = !lightOn) {
      if (disposed) return false;
      const changed = lightOn !== !!on;
      lightOn = !!on;
      hook('light', lightOn);
      if (changed) emit('lightToggle', { on: lightOn });
      return lightOn;
    }
    function update(dt, { sprinting } = {}) {
      if (disposed) return;
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Weapon dt must be finite and non-negative');
      if (sprinting !== undefined) machine.sprint(sprinting);
      sway.update(dt);
      // Bounded substeps keep shot/effect physics at the same simulation time.
      let remaining = dt;
      while (remaining > 1e-10) {
        const step = Math.min(remaining, poseConfig.maxSubstep);
        machine.update(step); // Integrates the pose through onAdvance.
        remaining -= step;
      }
      // Final pose after the last state events of this frame.
      updatePose(0);
      publishCameraRecoil();
    }
    function publishCameraRecoil() {
      const offset = recoil.state();
      emit('cameraRecoil', { pitch: offset.pitch * settings.recoil.cameraShare,
        yaw: offset.yaw * settings.recoil.cameraShare, back: offset.back * settings.recoil.cameraShare,
        angularVelocity: { x: offset.velocity.pitch * settings.recoil.cameraShare,
          y: offset.velocity.yaw * settings.recoil.cameraShare, z: 0 }, shake });
    }
    return {
      update, light, on: bus.on, bus, viewmodel, model, nodes, config: settings, poses: poseConfig,
      effects: defaults, recoil,
      fire: n => !disposed && machine.fire(n), reload: () => !disposed && machine.reload(),
      ads: on => !disposed && machine.ads(on), trigger: on => !disposed && machine.trigger(on),
      sprint: on => !disposed && machine.sprint(on), inspect: () => !disposed && machine.inspect(),
      toggleMode: () => !disposed && machine.toggleMode(), raycast,
      state() {
        const hit = lastHit ? { point: lastHit.point.toArray(), normal: lastHit.normal.toArray(),
          surface: lastHit.surface, object: lastHit.object.name, distance: lastHit.distance } : null;
        return { ...machine.state(), light: lightOn, shake, recoil: recoil.state(), lastHit: hit,
          pose: poseSet.calculation, sway: sway.state(), effects: defaults.stats?.(), disposed };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribe.forEach(off => off());
        machine.dispose();
        defaults.dispose?.();
        hooks.dispose?.();
        viewmodel.removeFromParent();
        disposeModel(model);
      },
    };
  } catch (error) {
    unsubscribe.forEach(off => off());
    defaults?.dispose?.();
    viewmodel.removeFromParent();
    disposeModel(model);
    throw error;
  }
}

function disposeModel(model) {
  const resources = new Set();
  model.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}
