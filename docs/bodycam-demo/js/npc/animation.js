import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, PropertyBinding } from 'three';

export const NPC_CLIP_NAMES = Object.freeze(['Idle', 'IdleNervous', 'Walk', 'Run', 'AimPistol',
  'FirePistol', 'HitReact', 'DeathForward', 'DeathBackward', 'Crouch', 'Surrender', 'HitReactArmed']);

export const NPC_ANIMATION_CONFIG = Object.freeze({
  fade: 0.12,
  timeScale: 1,
  maxStep: 1 / 30,
  maxSteps: 8,
  states: Object.freeze({
    idle: ['Idle'], alert: ['IdleNervous', 'Idle'], flee: ['Run', 'Walk'],
    hide: ['Crouch'], aim: ['AimPistol'], fire: ['FirePistol'], surrender: ['Surrender'],
    hit: ['HitReact'], dead: ['DeathForward', 'DeathBackward'],
  }),
});

const LOOPS = new Set(['Idle', 'IdleNervous', 'Walk', 'Run', 'AimPistol', 'Crouch', 'Surrender']);
const PROPERTIES = new Map([['position', 3], ['quaternion', 4], ['scale', 3]]);

/** Bone-only, event-free visual mixer. State timings and damage stay with the NPC manager.
 * Missing or invalid clips use the unmodified rest pose, without binding warnings.
 */
export function createNPCAnimation({ root, clips = [], config = {} } = {}) {
  if (!root?.isObject3D) throw new TypeError('NPC animation requires an Object3D root');
  const settings = { ...NPC_ANIMATION_CONFIG, ...config, fade: config.fade ?? config.fadeSeconds ?? NPC_ANIMATION_CONFIG.fade,
    states: { ...NPC_ANIMATION_CONFIG.states, ...config.states } };
  if (!Number.isFinite(settings.fade) || settings.fade < 0 || !Number.isFinite(settings.timeScale) ||
      settings.timeScale < 0 || !Number.isFinite(settings.maxStep) || settings.maxStep <= 0 ||
      !Number.isSafeInteger(settings.maxSteps) || settings.maxSteps < 1 || settings.maxSteps > 256)
    throw new RangeError('Invalid NPC animation configuration');
  for (const [state, selection] of Object.entries(settings.states))
    if (!Array.isArray(selection) || !selection.every(name => NPC_CLIP_NAMES.includes(name)))
      throw new RangeError(`Invalid NPC animation clips for ${state}`);
  const mixer = new AnimationMixer(root), library = new Map(), actions = new Map(), rest = new Map();
  root.traverse(node => {
    if (node.isBone) rest.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() });
  });
  let filteredTracks = 0, discardedClips = 0;
  for (const source of clips) {
    if (!NPC_CLIP_NAMES.includes(source?.name) || library.has(source.name) ||
        !Number.isFinite(source.duration) || source.duration <= 0) { discardedClips++; continue; }
    const tracks = [];
    for (const track of source.tracks ?? []) {
      let parsed, bone;
      try {
        parsed = PropertyBinding.parseTrackName(track.name);
        const node = PropertyBinding.findNode(root, parsed.nodeName);
        bone = parsed.objectName === 'bones' ? node?.skeleton?.getBoneByName(parsed.objectIndex) : node;
      } catch { /* Invalid tracks never reach Three.js bindings. */ }
      const size = PROPERTIES.get(parsed?.propertyName);
      const cubic = track?.createInterpolant?.isInterpolantFactoryMethodGLTFCubicSpline;
      const validTimes = track.times?.length && [...track.times].every((time, index, times) =>
        Number.isFinite(time) && time >= 0 && time <= source.duration + 1e-6 && (index === 0 || time > times[index - 1]));
      if (!bone?.isBone || !size || parsed.propertyIndex !== undefined ||
          (parsed.objectName !== undefined && parsed.objectName !== 'bones') ||
          typeof track.clone !== 'function' || track.getValueSize?.() !== size * (cubic ? 3 : 1) ||
          !validTimes || !track.values?.length || ![...track.values].every(Number.isFinite)) { filteredTracks++; continue; }
      const copy = track.clone();
      // UUID bindings are instance-specific, including skins with duplicate bone names.
      copy.name = `${bone.uuid}.${parsed.propertyName}`;
      tracks.push(copy);
    }
    if (tracks.length) library.set(source.name, new AnimationClip(source.name, source.duration, tracks));
    else discardedClips++;
  }
  let disposed = false, logicalState = 'idle', current = null, outgoing = null;
  let requested = [], missing = [], elapsed = 0, visualTime = 0, droppedTime = 0;

  function restore() {
    for (const [bone, pose] of rest) {
      bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale);
    }
  }
  function desired(state, options) {
    // A clip list is tried in order, so a preferred variant can fall back to the plain clip.
    if (options.clip !== undefined) return options.clip === null ? [] : [options.clip].flat();
    if (state === 'dead' && options.deathBackward) return ['DeathBackward', 'DeathForward'];
    if (options.moving && !['dead', 'hit', 'fire', 'surrender'].includes(state))
      return options.sprinting ? ['Run', 'Walk'] : ['Walk'];
    return settings.states[state] ?? [];
  }
  function selection() {
    return { state: logicalState, requested: [...requested], selected: current?.name ?? null,
      missing: [...missing], restPose: !current };
  }
  function setState(state, options = {}) {
    if (disposed) return selection();
    if (!Object.hasOwn(settings.states, state)) throw new RangeError(`Unknown NPC animation state: ${state}`);
    const candidates = desired(state, options);
    if (!candidates.every(name => NPC_CLIP_NAMES.includes(name))) throw new RangeError('NPC clip must match Contract');
    const fade = options.fade ?? settings.fade;
    if (!Number.isFinite(fade) || fade < 0) throw new RangeError('Invalid NPC animation fade');
    const name = candidates.find(candidate => library.has(candidate));
    logicalState = state; requested = candidates; missing = candidates.filter(candidate => !library.has(candidate));
    if (current?.name === name && !options.restart) return selection();
    if (outgoing) { outgoing.action.stop(); outgoing = null; }
    if (!name) {
      mixer.stopAllAction(); current = null; restore();
      root.updateWorldMatrix(true, true);
      return selection();
    }
    const previous = current;
    let action = actions.get(name);
    if (!action) { action = mixer.clipAction(library.get(name)); actions.set(name, action); }
    const loop = options.loop ?? LOOPS.has(name);
    if (previous?.action === action) previous.action.stop();
    action.reset().setEffectiveTimeScale(settings.timeScale).setEffectiveWeight(1);
    action.enabled = true; action.clampWhenFinished = true;
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1).play();
    current = { name, action, loop };
    if (previous && previous.action !== action && fade > 0) {
      previous.action.crossFadeTo(action, fade, false);
      outgoing = { ...previous, age: 0, duration: fade };
    } else {
      if (previous && previous.action !== action) previous.action.stop();
      if (fade > 0) action.fadeIn(fade);
    }
    mixer.update(0);
    return selection();
  }
  function update(dt, options) {
    if (disposed) return;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('NPC animation dt must be finite and nonnegative');
    if (options) setState(options.state ?? logicalState, options);
    elapsed += dt;
    const accepted = Math.min(dt, settings.maxStep * settings.maxSteps);
    droppedTime += dt - accepted;
    let remaining = accepted;
    while (remaining > 1e-12) {
      const step = Math.min(remaining, settings.maxStep);
      mixer.update(step);
      if (outgoing) {
        outgoing.age += step;
        if (outgoing.age >= outgoing.duration - 1e-9) { outgoing.action.stop(); outgoing = null; }
      }
      remaining -= step;
    }
    if (!accepted) mixer.update(0);
    visualTime += accepted;
    root.updateWorldMatrix(true, true);
  }
  function state() {
    return { ...selection(), disposed, elapsed, visualTime, droppedTime,
      available: [...library.keys()], missingClips: NPC_CLIP_NAMES.filter(name => !library.has(name)),
      filteredTracks, discardedClips,
      active: [outgoing, current].filter(Boolean).map(record => ({ name: record.name, loop: record.loop,
        time: record.action.time, weight: record.action.getEffectiveWeight(), paused: record.action.paused })) };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    restore(); current = outgoing = null;
    actions.clear(); library.clear();
  }
  setState('idle');
  return { setState, update, state, dispose, config: settings };
}
