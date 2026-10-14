import { AdditiveAnimationBlendMode, AnimationClip, AnimationMixer, AnimationUtils,
  LoopOnce, LoopRepeat, PropertyBinding } from 'three';

export const FP_CLIP_NAMES = Object.freeze(['Idle', 'Walk', 'Sprint', 'Fire', 'FireADS', 'Reload',
  'ReloadEmpty', 'Inspect', 'Draw', 'ADS_In', 'ADS_Idle', 'ADS_Out', 'LowReady', 'LightToggle']);

const LOOPS = new Set(['Idle', 'Walk', 'Sprint', 'ADS_Idle', 'LowReady']);
const ADDITIVE = new Set(['Fire', 'FireADS', 'LightToggle']);
const BUS_EVENTS = new Set(['shot', 'dryFire', 'magOut', 'magIn', 'boltRelease', 'casingHit',
  'impact', 'step', 'door', 'roomChange', 'lightToggle', 'magDrop', 'chargingHandle']);
const BUS_SOUNDS = new Set(['dry_fire', 'mag_out', 'mag_in', 'bolt_release', 'mag_drop',
  'charging_handle', 'light_click', 'rifle_mech', 'ear_ringing']);
const EPS = 1e-9;

/** fp_anim.json v1: {version:1, events:{Clip:[{time,sound,event?,options?,owner?}]}}.
 * time is seconds inside the clip. owner:'weaponBus' stays on C4's existing bus adapter.
 * Other rows call audio.play(sound, options); simulation time is metadata, never AudioContext.when.
 * Clips modify bone locals only; weapon/socket/camera transforms remain owned by C3.
 */
export async function createFPAnimation({ root, clips = [], weapon, bus = weapon?.bus, audio = null,
  baseUrl = new URL('../../', import.meta.url), config = {}, fetch: fetcher = globalThis.fetch } = {}) {
  if (!root?.isObject3D) throw new TypeError('FP animation requires an Object3D root');
  const settings = { baseFade: 0.16, additiveFade: 0.06, loopSpeedThreshold: 0.05, maxEventCatchUp: 256, ...config };
  for (const key of ['baseFade', 'additiveFade', 'loopSpeedThreshold'])
    if (!Number.isFinite(settings[key]) || settings[key] < 0) throw new RangeError(`Invalid FP animation ${key}`);
  if (!Number.isSafeInteger(settings.maxEventCatchUp) || settings.maxEventCatchUp < 1)
    throw new RangeError('FP animation maxEventCatchUp must be a positive safe integer');
  const mixer = new AnimationMixer(root), library = new Map(), actions = new Map(), active = new Set();
  const queue = [], unsubscribers = [], pose = new Map();
  let disposed = false, base = null, serial = 0, emitted = 0, skipped = 0, invalidEvents = 0;
  let manifestLoaded = false, manifestError = null;
  let latest = weapon?.state?.() ?? {}, clock = Number.isFinite(latest.time) ? latest.time : 0;
  let aim = Boolean(latest.ads), automatic = true, filteredTracks = 0, completedOneShot = null;
  let eventBudget = settings.maxEventCatchUp, droppedEvents = 0;

  // Accept only verified arm bones. A future clip cannot move the weapon or the camera.
  for (const source of clips) {
    if (!FP_CLIP_NAMES.includes(source?.name) || library.has(source.name)) continue;
    const tracks = [];
    for (const track of source.tracks ?? []) {
      let parsed, bone;
      try {
        parsed = PropertyBinding.parseTrackName(track.name);
        const node = PropertyBinding.findNode(root, parsed.nodeName);
        bone = parsed.objectName === 'bones' ? node?.skeleton?.getBoneByName(parsed.objectIndex) : node;
      } catch { /* Unknown bindings remain inactive, without console warnings. */ }
      if (!bone?.isBone || !['position', 'quaternion', 'scale'].includes(parsed?.propertyName) ||
          parsed?.propertyIndex !== undefined || /^(FP_|W_)/.test(bone.name)) { filteredTracks++; continue; }
      tracks.push(track.clone());
      if (!pose.has(bone)) pose.set(bone, { position: bone.position.clone(),
        quaternion: bone.quaternion.clone(), scale: bone.scale.clone() });
    }
    if (!tracks.length || !Number.isFinite(source.duration) || source.duration <= 0) continue;
    library.set(source.name, new AnimationClip(source.name, source.duration, tracks, source.blendMode));
  }

  const events = Object.fromEntries(FP_CLIP_NAMES.map(name => [name, []]));
  if (typeof fetcher === 'function') {
    try {
      const url = new URL(baseUrl, import.meta.url);
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      const response = await fetcher(new URL('data/fp_anim.json', url).href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.version !== 1 || !data.events || typeof data.events !== 'object') throw new Error('Expected fp_anim.json v1');
      for (const name of FP_CLIP_NAMES) {
        if (data.events[name] === undefined) continue;
        if (!Array.isArray(data.events[name])) { invalidEvents++; continue; }
        for (const row of data.events[name]) {
          if (!row || !Number.isFinite(row.time) || row.time < 0 || typeof row.sound !== 'string' ||
              !row.sound || (row.options !== undefined && (!row.options || Array.isArray(row.options) ||
              typeof row.options !== 'object'))) { invalidEvents++; continue; }
          const clip = library.get(name);
          if (clip && row.time > clip.duration + EPS) { invalidEvents++; continue; }
          events[name].push({ ...row, options: { ...row.options } });
        }
        events[name].sort((a, b) => a.time - b.time);
      }
      manifestLoaded = true;
    } catch (error) { manifestError = error.message; }
  }

  function routeSound(record, row, at) {
    const event = String(row.event ?? '').split('.').at(-1);
    const busOwnedSound = BUS_SOUNDS.has(row.sound) || /^(rifle_(shot|tail)_|casing_|impact_|step_)/.test(row.sound);
    if (row.owner === 'weaponBus' || (bus && (BUS_EVENTS.has(event) || busOwnedSound))) { skipped++; return; }
    if (typeof audio?.play !== 'function') return;
    if (eventBudget <= 0) { droppedEvents++; return; }
    eventBudget--;
    const options = { ...row.options, clip: record.name, event: row.event ?? row.sound, time: at };
    delete options.when;
    audio.play(row.sound, options); emitted++;
  }

  function markerEvents(record, from, to, includeStart = false, pending = null) {
    if (!record.ownsEvents) return;
    const duration = record.clip.duration;
    const emit = (row, at) => pending ? pending.push({ record, row, at }) : routeSound(record, row, at);
    for (const row of events[record.name]) {
      if (record.loop) {
        // Walk every crossed loop, including zero markers at the next loop boundary.
        const first = Math.max(0, Math.ceil((from - row.time + (includeStart ? -EPS : EPS)) / duration));
        const last = Math.floor((to - row.time + EPS) / duration);
        const count = Math.max(0, last - first + 1), caught = Math.min(count, settings.maxEventCatchUp);
        // Bound audio catch-up after unusually large dt; the mixer still advances the full interval.
        for (let index = 0; index < caught; index++)
          emit(row, record.started + (first + index) * duration + row.time);
        droppedEvents += count - caught;
      } else if ((includeStart ? row.time >= from - EPS : row.time > from + EPS) && row.time <= to + EPS)
        emit(row, record.started + row.time);
    }
  }

  function fade(record, target, seconds) {
    record.fadeFrom = record.weight; record.fadeTo = target; record.fadeAge = 0; record.fadeDuration = seconds;
    if (!seconds) record.weight = target;
    record.action.setEffectiveWeight(record.weight);
  }
  function remove(record) {
    record.action.stop(); active.delete(record);
    if (base === record) base = null;
  }

  function play(name, { layer = ADDITIVE.has(name) ? 'additive' : 'base', fade: seconds,
    weight = 1, loop = LOOPS.has(name), restart = true, autoReturn = true } = {}) {
    if (disposed || !library.has(name)) return false;
    if (!['base', 'additive'].includes(layer)) throw new RangeError('FP animation layer must be base or additive');
    seconds ??= layer === 'base' ? settings.baseFade : settings.additiveFade;
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(weight) || weight < 0 || weight > 1)
      throw new RangeError('FP animation fade/weight must be non-negative; weight <= 1');
    const key = `${layer}:${name}`;
    const existing = [...active].find(record => record.key === key);
    if (existing && !restart) return true;
    if (existing) remove(existing);
    if (layer === 'base') for (const old of [...active]) if (old.layer === 'base') {
      old.ownsEvents = false; fade(old, 0, seconds); if (!seconds) remove(old);
    }
    let entry = actions.get(key);
    if (!entry) {
      const clip = library.get(name).clone();
      if (layer === 'additive' && clip.blendMode !== AdditiveAnimationBlendMode)
        AnimationUtils.makeClipAdditive(clip, 0, clip, 30);
      const action = mixer.clipAction(clip);
      entry = { clip, action }; actions.set(key, entry);
    }
    const { clip, action } = entry;
    const record = { key, name, layer, clip, action, age: 0, started: clock, loop, weight: seconds ? 0 : weight,
      ownsEvents: true, autoReturn, fadeFrom: 0, fadeTo: weight, fadeAge: 0, fadeDuration: seconds };
    action.reset(); action.enabled = true; action.clampWhenFinished = true;
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    action.setEffectiveTimeScale(1); action.setEffectiveWeight(record.weight); action.play();
    active.add(record); if (layer === 'base') base = record;
    markerEvents(record, 0, 0, true);
    return true;
  }

  function desiredLoop(state) {
    if (state.state === 'sprint' || state.sprint || state.sprinting) return 'Sprint';
    if (state.ads || state.state === 'ads') return 'ADS_Idle';
    if (state.moving || (state.sway?.speed ?? state.speed ?? 0) > settings.loopSpeedThreshold) return 'Walk';
    return state.state === 'idle' ? 'Idle' : 'LowReady';
  }
  function syncBase(state, force = false) {
    if (!automatic && !force) return;
    const oneShot = state.reloadKind ?? ({ reload: 'Reload', reloadEmpty: 'ReloadEmpty', inspect: 'Inspect' })[state.state];
    if (!oneShot || completedOneShot !== oneShot) completedOneShot = null;
    const desired = oneShot && completedOneShot !== oneShot ? oneShot : desiredLoop(state);
    if (base?.name === desired || (!force && base && !base.loop && base.age < base.clip.duration - EPS)) return;
    // Neutral fallback if a supplied library is incomplete. No clip is a valid state.
    const fallback = [desired, desiredLoop(state), 'LowReady', 'Idle'].find(name => library.has(name));
    if (fallback && base?.name !== fallback) play(fallback);
  }

  function handle(type, data) {
    if (type === 'shot') play(Number(data.ads) >= 0.5 || data.ads === true ? 'FireADS' : 'Fire');
    else if (type === 'lightToggle') play('LightToggle');
    else if (type === 'adschange') {
      automatic = true;
      aim = Boolean(data.on); latest = { ...latest, ads: aim };
      play(aim ? 'ADS_In' : 'ADS_Out', { layer: 'base' });
    } else if (type === 'draw') { automatic = true; play('Draw', { layer: 'base' }); }
    else if (type === 'statechange') {
      latest = { ...latest, state: data.state, sprint: data.state === 'sprint', ads: aim,
        reloadKind: data.state === 'reloadEmpty' ? 'ReloadEmpty' : data.state === 'reload' ? 'Reload' : null };
      automatic = true; syncBase(latest, true);
    }
  }

  const register = type => {
    const listener = event => {
      if (disposed) return;
      const data = event?.detail ?? event ?? {};
      queue.push({ type, data, time: Number.isFinite(data.time) ? data.time : clock, order: serial++ });
    };
    if (typeof bus?.addEventListener === 'function') {
      bus.addEventListener(type, listener); unsubscribers.push(() => bus.removeEventListener(type, listener));
    } else if (typeof bus?.on === 'function') {
      const off = bus.on(type, listener);
      unsubscribers.push(typeof off === 'function' ? off : () => (bus.off ?? bus.removeListener)?.call(bus, type, listener));
    }
  };
  for (const type of ['shot', 'statechange', 'adschange', 'lightToggle', 'draw']) register(type);

  function advance(dt) {
    let remaining = dt;
    while (remaining > EPS) {
      let step = remaining;
      for (const record of active) {
        if (!record.loop) step = Math.min(step, Math.max(EPS, record.clip.duration - record.age));
        if (!record.fadeTo) step = Math.min(step, Math.max(EPS, record.fadeDuration - record.fadeAge));
      }
      for (const record of active) {
        record.fadeAge += step;
        const t = record.fadeDuration ? Math.min(1, record.fadeAge / record.fadeDuration) : 1;
        record.weight = record.fadeFrom + (record.fadeTo - record.fadeFrom) * t;
        record.action.setEffectiveWeight(record.weight);
      }
      mixer.update(step);
      clock += step; remaining -= step;
      const pending = [];
      for (const record of active) {
        const before = record.age; record.age += step;
        markerEvents(record, before, record.loop ? record.age : Math.min(record.age, record.clip.duration), false, pending);
      }
      pending.sort((a, b) => a.at - b.at);
      for (const { record, row, at } of pending) routeSound(record, row, at);
      for (const record of [...active]) {
        if ((!record.fadeTo && record.fadeAge >= record.fadeDuration - EPS) ||
            (!record.loop && record.age >= record.clip.duration - EPS)) {
          const resume = record === base && record.autoReturn;
          if (resume) completedOneShot = record.name;
          remove(record);
          if (resume) syncBase(latest, true);
        }
      }
    }
  }

  function update(dt, state = weapon?.state?.() ?? latest) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('FP animation dt must be finite and non-negative');
    if (disposed) return;
    eventBudget = settings.maxEventCatchUp;
    const end = clock + dt;
    if (!Number.isFinite(end)) throw new RangeError('FP animation clock overflow');
    // C18 resets bones before this call and applies IK afterwards. Restore the last mixer pose:
    // PropertyMixer can skip a constant/paused property write even after the caller reset that bone.
    for (const [bone, value] of pose) {
      bone.position.copy(value.position); bone.quaternion.copy(value.quaternion); bone.scale.copy(value.scale);
    }
    queue.sort((a, b) => a.time - b.time || a.order - b.order);
    while (queue.length && queue[0].time <= end + EPS) {
      const event = queue.shift();
      advance(Math.max(0, event.time - clock)); handle(event.type, event.data);
    }
    latest = state ?? latest; aim = Boolean(latest.ads); syncBase(latest);
    advance(Math.max(0, end - clock));
    mixer.update(0);
    for (const [bone, value] of pose) {
      value.position.copy(bone.position); value.quaternion.copy(bone.quaternion); value.scale.copy(bone.scale);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
    queue.length = 0; mixer.stopAllAction(); mixer.uncacheRoot(root);
    active.clear(); actions.clear(); pose.clear(); base = null; audio = null;
  }
  // Draw is optional; a clipless rig stays entirely on the procedural IK path.
  if (!play('Draw')) syncBase(latest);
  return { mixer, update, play(name, options = {}) {
    const result = play(name, options);
    if (result && (options.layer ?? (ADDITIVE.has(name) ? 'additive' : 'base')) === 'base') automatic = false;
    return result;
  }, setAudio(value) { if (!disposed) audio = value; }, dispose,
    state: () => ({ disposed, time: clock, base: base?.name ?? null,
      availableClips: [...library.keys()], missingClips: FP_CLIP_NAMES.filter(name => !library.has(name)),
      active: [...active].map(record => ({ name: record.name, layer: record.layer, time: record.action.time,
        weight: record.weight, loop: record.loop })), manifestLoaded, manifestError,
      emittedEvents: emitted, skippedEvents: skipped, droppedEvents, invalidEvents, filteredTracks, queuedEvents: queue.length }) };
}
