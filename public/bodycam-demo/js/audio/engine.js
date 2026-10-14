import { makeMixConfig, dbToGain } from './mix-config.js';
import { synthesize } from './synthesis.js';
import { generateImpulse } from './impulse.js';
export { attachAudio } from './events.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
const vector = (v, fallback = [0, 0, 0]) => v ?
  [finite(v.x ?? v[0], fallback[0]), finite(v.y ?? v[1], fallback[1]), finite(v.z ?? v[2], fallback[2])] : [...fallback];

/** No asset fetch lies on the event timing path. Call preload() for recorded first shots. */
export async function createAudio(options = {}) {
  const config = makeMixConfig(options.config);
  const fetcher = options.fetch || globalThis.fetch.bind(globalThis);
  const random = options.random || Math.random;
  const rand = () => clamp(finite(random(), 0.5), 0, 0.999999999);
  const range = ([lo, hi]) => lo + rand() * (hi - lo);
  const baseUrl = new URL(options.baseUrl || '../../', import.meta.url);
  // A base URL is always a directory, even when the caller omits its trailing slash.
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  const manifestUrl = new URL(options.manifestUrl || 'data/sounds.json', baseUrl);
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const context = options.context || (Context && new Context({ latencyHint: 'interactive' }));
  if (!context) throw new Error('Web Audio ist in diesem Browser nicht verfügbar.');
  const ownsContext = !options.context;
  const offline = typeof context.startRendering === 'function';
  const cache = new Map(), inFlight = new Map(), synthCache = new Map(), lastVariant = new Map();
  const voices = new Set(), banks = new Set(), specials = new Set(), graph = [], history = [];
  const diagnostics = { loaded: 0, failed: 0, synthesized: 0, played: 0, stolen: 0, manifestError: null };
  let disposed = false, unlocked = false, started = false, listenerPosition = [0, 0, 0];
  let room = null, roomId = null, currentBank = null, nextRadio = Infinity, nextSiren = Infinity;
  let ringingUntil = -Infinity, ringVoice = null, siren = null;
  const controllers = new Set();

  async function fetchWithTimeout(url) {
    const controller = new AbortController();
    controllers.add(controller);
    let timer;
    try {
      // Explicit race also bounds test/custom fetch implementations ignoring AbortSignal.
      return await Promise.race([
        fetcher(url.href, { signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('Audio-Ladezeit überschritten'));
        }, config.loading.timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  let manifest = {};
  try {
    const response = await fetchWithTimeout(manifestUrl);
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const data = await response.json();
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Ungültiges Soundmanifest');
    manifest = Object.fromEntries(Object.entries(data).filter(([, entry]) => entry && typeof entry === 'object'));
  } catch (error) { diagnostics.manifestError = String(error.message); }

  const own = node => { graph.push(node); return node; };
  function gain(value = 1) { const n = own(context.createGain()); n.gain.value = value; return n; }
  function mono(value = 1) {
    const n = gain(value); n.channelCount = 1; n.channelCountMode = 'explicit'; return n;
  }
  const now = () => context.currentTime;
  const at = value => Math.max(now(), finite(value, now()));
  function ramp(param, value, when, duration = config.master.smoothSeconds) {
    when = at(when);
    param.cancelAndHoldAtTime(when);
    if (duration > 0) param.linearRampToValueAtTime(value, when + duration);
    else param.setValueAtTime(value, when);
  }
  function record(event) {
    history.push(event);
    if (history.length > config.limits.history) history.shift();
  }
  const effects = mono(), ambientMono = mono(), ambientStereo = gain();
  const outside = gain(), inside = gain(0), rain = gain(config.ambience.rainLevel);
  const duck = gain(), hearing = gain(), masterInput = gain(), reverbInput = mono();
  outside.connect(ambientStereo); inside.connect(ambientStereo); rain.connect(ambientStereo);
  ambientMono.connect(duck);
  // M/S width: output = (1-width)*mid + width*original stereo, max 20%.
  const width = clamp(config.ambience.stereoWidth, 0, 0.2);
  const ambMid = mono(1 - width), ambSide = gain(width);
  ambientStereo.connect(ambMid).connect(duck);
  ambientStereo.connect(ambSide).connect(duck);
  effects.connect(hearing); duck.connect(hearing); hearing.connect(masterInput);
  const noiseBus = mono(dbToGain(config.master.noiseDb));
  // Calibrated before mic processing: makeup/drive must not turn -30 dB rumble into a shot.
  const handlingBus = mono(dbToGain(config.footsteps.handlingDb - config.master.makeupDb - config.master.softClipDriveDb));
  handlingBus.connect(hearing);
  const tinnitusBus = mono(); tinnitusBus.connect(masterInput);
  const hp = own(context.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = config.master.hp;
  const presence = own(context.createBiquadFilter()); presence.type = 'peaking';
  presence.frequency.value = config.master.presenceHz; presence.Q.value = config.master.presenceQ;
  presence.gain.value = config.master.presenceDb;
  const lp = own(context.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = config.master.lp;
  const compressor = own(context.createDynamicsCompressor());
  for (const [key, value] of Object.entries(config.master.comp)) compressor[key].value = value;
  const makeup = gain(dbToGain(config.master.makeupDb));
  const softclip = own(context.createWaveShaper());
  const softCurve = new Float32Array(65537), hardCurve = new Float32Array(65537);
  const ceiling = dbToGain(config.master.ceilingDb), drive = dbToGain(config.master.softClipDriveDb);
  for (let i = 0; i < softCurve.length; i++) {
    const x = 2 * i / (softCurve.length - 1) - 1;
    softCurve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    hardCurve[i] = clamp(x, -ceiling, ceiling);
  }
  softclip.curve = softCurve; softclip.oversample = '2x';
  const volume = gain(clamp(config.master.volume, 0, 1));
  noiseBus.connect(volume); // -58 dBFS RMS floor, not amplified by compressor makeup.
  const limiter = own(context.createWaveShaper()); limiter.curve = hardCurve; limiter.oversample = 'none';
  masterInput.connect(hp).connect(presence).connect(lp).connect(compressor).connect(makeup)
    .connect(softclip).connect(volume).connect(limiter).connect(context.destination);

  const entryFor = name => ({
    files: [], gain: config.defaults[name] ?? 0.5, loop: config.loops.includes(name),
    stereo: name.startsWith('ambient_') || name === 'siren_distant', ...manifest[name],
  });
  const filesFor = name => Array.isArray(entryFor(name).files) ? entryFor(name).files.filter(f => typeof f === 'string') : [];
  function category(name) {
    if (name === 'rifle_mech') return 'mechanism';
    if (name.includes('_shot_') || name.includes('_tail_')) return 'shot';
    if (name.startsWith('ambient_') || ['police_lightbar_hum', 'siren_distant', 'dog_bark_distant'].includes(name)) return 'ambience';
    if (name.startsWith('step_')) return 'step';
    if (name.startsWith('radio_')) return 'radio';
    if (name === 'ear_ringing') return 'tinnitus';
    return 'foley';
  }
  function fileUrl(file) { return new URL(file, baseUrl); }
  async function load(file) {
    const url = fileUrl(file), key = url.href;
    if (cache.has(key)) return cache.get(key);
    if (inFlight.has(key)) return inFlight.get(key);
    if (disposed) return null;
    const promise = (async () => {
      let buffer = null;
      try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        buffer = await context.decodeAudioData(await response.arrayBuffer());
        diagnostics.loaded++;
      } catch { diagnostics.failed++; }
      if (!disposed) cache.set(key, buffer); // Negative cache avoids recurring 404s.
      inFlight.delete(key);
      return buffer;
    })();
    inFlight.set(key, promise);
    return promise;
  }
  async function preload(names = [...new Set([...Object.keys(config.defaults), ...Object.keys(manifest)])]) {
    if (typeof names === 'string') names = [names];
    const files = [...new Set(names.flatMap(filesFor))];
    let index = 0;
    await Promise.all(Array.from({ length: Math.max(1, config.loading.concurrency) }, async () => {
      while (index < files.length && !disposed) await load(files[index++]);
    }));
    return getDiagnostics();
  }
  function procedural(name, variant) {
    const key = `${name}:${variant}`;
    if (!synthCache.has(key)) {
      if (synthCache.size >= config.limits.fallbackBuffers) synthCache.delete(synthCache.keys().next().value);
      synthCache.set(key, synthesize(context, name, variant, config));
    }
    return synthCache.get(key);
  }
  function choose(name) {
    const files = filesFor(name);
    // Once a failure is known, prefer any usable file. If all fail, synthesize variants.
    const candidatesFiles = files.map((file, index) => ({ file, index }))
      .filter(({ file }) => cache.get(fileUrl(file).href) !== null);
    const decoded = candidatesFiles.filter(({ file }) => cache.get(fileUrl(file).href));
    const available = decoded.length ? decoded : candidatesFiles;
    // Load the remaining variants in the background without delaying this event.
    if (files.some(file => !cache.has(fileUrl(file).href))) void preload([name]);
    const count = available.length || config.synth.variants;
    const previous = lastVariant.get(name);
    let candidates = Array.from({ length: count }, (_, i) => i);
    if (count > 1) candidates = candidates.filter(i => (available[i]?.index ?? i) !== previous);
    const pick = candidates[Math.floor(rand() * candidates.length)];
    const variant = available[pick]?.index ?? pick;
    lastVariant.set(name, variant);
    const file = available[pick]?.file;
    const buffer = file && cache.get(fileUrl(file).href);
    if (file && !buffer) void load(file);
    return { buffer: buffer || procedural(name, variant), variant, fallback: !buffer, file: buffer ? file : null };
  }
  function resolveRoom(id, profile = {}) {
    profile ||= {};
    profile = profile.reverb || profile;
    const saved = config.reverb.rooms[id] || {};
    const indoor = profile.indoor ?? (profile.outdoor != null ? !profile.outdoor : undefined) ?? saved.indoor ?? ![null, undefined, 'OUT', 'outdoor', 'outside', 'PORCH'].includes(id);
    return { ...saved, ...profile, indoor,
      rt60: indoor ? clamp(finite(profile.rt60, saved.rt60 ?? config.reverb.indoorRT60), 0.1, config.reverb.maxRT60) : config.reverb.outdoorRT60 };
  }
  function setRoom(id, profile = {}, opts = {}) {
    if (disposed) return;
    const next = resolveRoom(id, profile), when = at(opts.when);
    if (room && id === roomId && next.rt60 === room.rt60 && next.indoor === room.indoor) return;
    room = next; roomId = id;
    const node = context.createConvolver(); node.normalize = false;
    node.buffer = generateImpulse(context, next, config);
    const wet = context.createGain(); wet.gain.value = 0;
    reverbInput.connect(node).connect(wet).connect(effects);
    const bank = { node, wet, retire: Infinity };
    banks.add(bank);
    if (currentBank) {
      ramp(currentBank.wet.gain, 0, when, config.reverb.crossfade);
      currentBank.retire = when + config.reverb.crossfade + config.reverb.maxRT60;
    }
    ramp(wet.gain, config.reverb.wetGain, when, config.reverb.crossfade);
    currentBank = bank;
    ramp(outside.gain, next.indoor ? config.ambience.indoorLeak : config.ambience.outdoorLevel, when, config.ambience.crossfade);
    ramp(inside.gain, next.indoor ? config.ambience.indoorLevel : 0, when, config.ambience.crossfade);
    ramp(rain.gain, config.ambience.rainLevel * (next.indoor ? config.ambience.rainIndoor : 1), when, config.ambience.crossfade);
    record({ type: 'room', roomId: id, ...next, when });
  }
  setRoom('OUT');

  function distanceOf(position, explicit) {
    return clamp(finite(explicit, position ? Math.hypot(...position.map((v, i) => v - listenerPosition[i])) : 0), 0, config.spatial.maxDistance);
  }
  function play(name, opts = {}) {
    if (disposed) return null;
    const entry = entryFor(name), selected = choose(name), bus = category(name);
    const source = context.createBufferSource(); source.buffer = selected.buffer;
    const loop = opts.loop ?? entry.loop ?? false; source.loop = loop;
    const pitchSpread = loop ? config.variation.loopPitchCents : bus === 'shot' ? config.variation.shotPitchCents : config.variation.pitchCents;
    const cents = finite(opts.pitchCents, (rand() * 2 - 1) * pitchSpread);
    let rate = clamp(finite(opts.playbackRate, 1) * 2 ** (cents / 1200), 0.125, 4);
    if (name === 'ear_ringing' && !selected.fallback) rate *= config.tinnitus.frequency / config.tinnitus.recordedFrequency;
    source.playbackRate.value = rate;
    const when = at(opts.when), duration = selected.buffer.duration / rate;
    const spreadGain = dbToGain((rand() * 2 - 1) * config.variation.gainDb);
    const level = context.createGain(), filter = context.createBiquadFilter(); filter.type = 'lowpass';
    const delay = context.createDelay(config.spatial.maxDistance / config.spatial.speedOfSound + 0.1);
    const panner = context.createPanner(); panner.panningModel = 'equalpower'; panner.rolloffFactor = 0;
    panner.distanceModel = 'inverse'; panner.refDistance = 1; panner.maxDistance = config.spatial.maxDistance;
    const gate = context.createGain(); gate.gain.value = 1;
    let position = opts.position ? vector(opts.position) : null;
    let explicitDistance = opts.distance, occlusion = clamp(finite(opts.occlusion, 0), 0, 1);
    const rawGain = Math.max(0, finite(opts.gain, 1)) * finite(entry.gain, 1) * (config.buses[bus] ?? 1) * spreadGain *
      (selected.fallback ? config.fallbackGains[bus] ?? 1 : 1) *
      (name === 'police_lightbar_hum' ? config.ambience.lightbarGain : 1);
    let distance = distanceOf(position, explicitDistance);
    const spatial = !!position || Number.isFinite(opts.distance);
    const target = opts._target || (bus === 'tinnitus' ? tinnitusBus : bus === 'ambience' ? (entry.stereo && !spatial ? ambientStereo : ambientMono) : effects);
    source.connect(level).connect(filter).connect(delay);
    if (position) delay.connect(panner).connect(gate); else delay.connect(gate);
    gate.connect(target);
    const send = context.createGain();
    send.gain.value = finite(opts.reverb, bus === 'shot' ? (selected.fallback ? config.reverb.synthesizedShotSend : config.reverb.recordedShotSend) : bus === 'ambience' || bus === 'tinnitus' || name.startsWith('radio_') ? 0 : config.reverb.send);
    gate.connect(send).connect(reverbInput);
    function updateSpatial(t = now(), immediate = false) {
      distance = distanceOf(position, explicitDistance);
      const attenuation = 1 / (1 + config.spatial.rolloff * Math.max(0, distance - config.spatial.referenceDistance));
      const cut = config.master.lp / (1 + distance * config.spatial.distanceLowpass);
      const frequency = Math.max(config.spatial.minLowpass, cut * (config.spatial.occlusionLowpass / config.master.lp) ** occlusion);
      const smoothing = immediate ? 0 : config.spatial.smoothing;
      ramp(level.gain, rawGain * attenuation * dbToGain(config.spatial.occlusionGainDb * occlusion), t, smoothing);
      ramp(filter.frequency, frequency, t, smoothing);
      ramp(delay.delayTime, distance / config.spatial.speedOfSound, t, smoothing);
      if (position) ['X', 'Y', 'Z'].forEach((axis, i) => ramp(panner[`position${axis}`], position[i], t, smoothing));
    }
    updateSpatial(when, true);
    const offset = loop ? rand() * selected.buffer.duration : 0;
    const nodes = [source, level, filter, delay, panner, gate, send];
    let stopTime = Infinity, cleaned = false, resolveFinished;
    const finished = new Promise(resolve => { resolveFinished = resolve; });
    const voice = {
      name, variant: selected.variant, fallback: selected.fallback, file: selected.file,
      startTime: when, arrivalTime: when + distance / config.spatial.speedOfSound,
      duration, loop, offset, playbackRate: rate, finished,
      // Includes the propagation tail. BufferSource.onended alone is too early for DelayNode.
      endTime: loop ? Infinity : when + duration + config.spatial.maxDistance / config.spatial.speedOfSound + 0.1,
      stop(time = now(), fade = config.master.smoothSeconds) {
        const t = at(time);
        if (cleaned || t + fade >= stopTime) return;
        stopTime = t + fade;
        ramp(gate.gain, 0, t, fade);
        source.stop(stopTime);
        voice.endTime = t + fade + 0.05;
      },
      setPosition(value) { if (position) position = vector(value); updateSpatial(); },
      setOcclusion(value) { occlusion = clamp(finite(value, 0), 0, 1); updateSpatial(); },
      updateSpatial,
      cleanup() {
        if (cleaned) return; cleaned = true;
        for (const node of nodes) node.disconnect();
        voices.delete(voice); resolveFinished();
      },
    };
    if (voices.size >= config.limits.voices) {
      const oldest = [...voices].find(v => !v.loop) || voices.values().next().value;
      if (oldest) { oldest.stop(); oldest.cleanup(); diagnostics.stolen++; }
    }
    voices.add(voice);
    source.onended = () => {
      if (cleaned || disposed) return;
      // A silent AudioBufferSource is a context-clock cleanup timer, including offline renders.
      const timer = context.createBufferSource(); timer.buffer = context.createBuffer(1, 1, context.sampleRate);
      timer.onended = () => { timer.disconnect(); voice.cleanup(); };
      timer.start(at(voice.endTime));
    };
    source.start(when, offset);
    if (opts.duration != null) {
      const fade = Math.max(0, finite(opts.fadeOut, config.master.smoothSeconds));
      voice.stop(when + Math.max(0, opts.duration - fade), fade);
    }
    diagnostics.played++; if (selected.fallback) diagnostics.synthesized++;
    record({ type: 'play', name, variant: selected.variant, fallback: selected.fallback, file: selected.file,
      when, arrivalTime: voice.arrivalTime, gain: rawGain, rate, offset, loop, distance, occlusion });
    return voice;
  }
  function duckForShot(when, strength) {
    const c = config.ambience, value = 1 - (1 - c.duckGain) * strength;
    ramp(duck.gain, value, when, c.duckAttack);
    duck.gain.setValueAtTime(value, when + c.duckAttack + c.duckHold);
    duck.gain.linearRampToValueAtTime(1, when + c.duckAttack + c.duckHold + c.duckRelease);
  }
  function gunshot(opts = {}) {
    if (disposed) return [];
    const when = at(opts.when), weapon = opts.weapon === 'pistol' ? 'pistol' : 'rifle';
    const shotRoom = opts.roomId != null ? resolveRoom(opts.roomId, opts.profile) : room;
    const indoor = opts.indoor ?? shotRoom.indoor;
    const position = opts.position ? vector(opts.position) : null;
    const distance = distanceOf(position, opts.distance);
    const ownShot = opts.own ?? (weapon === 'rifle' && distance <= config.spatial.referenceDistance);
    const name = weapon === 'rifle' ? `rifle_shot_${indoor ? 'indoor' : 'outdoor'}` : `pistol_shot_${indoor ? 'indoor' : 'distant'}`;
    const common = { ...opts, when, distance };
    const shot = play(name, common), layers = [shot];
    // Tails already have their transient faded out, so all layers use the same timestamp.
    if (weapon === 'rifle' && (!indoor || shotRoom.rt60 >= config.reverb.tailMinIndoorRT60)) {
      layers.push(play(`rifle_tail_${indoor ? 'indoor' : 'outdoor'}`, { ...common,
        gain: finite(opts.gain, 1) * config.reverb.tailGain, reverb: 0 }));
    }
    if (weapon === 'rifle' && ownShot) layers.push(play('rifle_mech', { when, gain: finite(opts.gain, 1), reverb: 0 }));
    const arrival = when + distance / config.spatial.speedOfSound;
    const strength = (1 - clamp(finite(opts.occlusion, 0), 0, 1)) / (1 + distance / config.tinnitus.nearDistance);
    duckForShot(arrival, strength);
    if (indoor && distance <= config.tinnitus.nearDistance && strength > config.tinnitus.minStrength && arrival >= ringingUntil) {
      ringVoice?.stop(arrival, config.tinnitus.attack);
      ringVoice = play('ear_ringing', { when: arrival, pitchCents: 0, duration: config.tinnitus.duration,
        fadeOut: config.tinnitus.fadeOut, reverb: 0 });
      layers.push(ringVoice);
      ringingUntil = arrival + config.tinnitus.cooldown;
      ramp(hearing.gain, config.tinnitus.hearingGain, arrival, config.tinnitus.attack);
      hearing.gain.linearRampToValueAtTime(1, arrival + config.tinnitus.hearingRecovery);
    }
    return layers.filter(Boolean);
  }
  function specialNoise(name, target, when, loop = false) {
    const source = context.createBufferSource(); specials.add(source); source.buffer = procedural(name, 0);
    source.loop = loop; source.connect(target); source.start(when, loop ? rand() * source.buffer.duration : 0);
    source.onended = () => { source.disconnect(); specials.delete(source); };
    return source;
  }
  function footstep(surface = 'concrete', speed = config.footsteps.referenceSpeed, opts = {}) {
    if (disposed || speed <= 0) return [];
    const c = config.footsteps, when = at(opts.when);
    const factor = clamp(Math.sqrt(Math.max(0, finite(speed, c.referenceSpeed)) / c.referenceSpeed), c.minGain, c.maxGain);
    const ownStep = opts.own ?? !opts.position;
    const common = { ...opts, when, gain: finite(opts.gain, 1) * factor };
    const result = [play(`step_${c.surfaces[surface] || 'concrete'}`, common)];
    if (ownStep) {
      result.push(play('gear_rattle', { ...common, gain: common.gain * c.gearGain }));
      specialNoise('__handling', handlingBus, when);
    }
    return result;
  }
  function setListener(position, quaternion = [0, 0, 0, 1]) {
    listenerPosition = vector(position);
    const q = [...vector(quaternion), finite(quaternion.w ?? quaternion[3], 1)];
    const norm = Math.hypot(...q) || 1, [x, y, z, w] = q.map(v => v / norm);
    const forward = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
    const up = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
    const listener = context.listener;
    ['X', 'Y', 'Z'].forEach((axis, i) => {
      ramp(listener[`position${axis}`], listenerPosition[i], now());
      ramp(listener[`forward${axis}`], forward[i], now());
      ramp(listener[`up${axis}`], up[i], now());
    });
    for (const voice of voices) voice.updateSpatial();
  }
  function startBackground() {
    if (started || disposed) return;
    started = true;
    const when = now();
    specialNoise('__mic_noise', noiseBus, when, true);
    play('ambient_night_suburb', { when, _target: outside });
    play('ambient_house_room_tone', { when, _target: inside });
    play('ambient_rain_light', { when, _target: rain });
    nextRadio = when + range(config.scheduler.radioInterval);
    nextSiren = when + range(config.scheduler.sirenInitial);
  }
  async function unlock() {
    if (disposed) return false;
    // resume() must be invoked synchronously inside the caller's pointer/key handler.
    if (!offline && context.state !== 'running') await context.resume();
    unlocked = offline || context.state === 'running';
    if (unlocked && options.autoStart !== false) startBackground();
    return unlocked;
  }
  function update() {
    if (disposed) return;
    const t = now();
    for (const voice of voices) if (t >= voice.endTime) voice.cleanup();
    for (const bank of banks) if (t >= bank.retire) {
      reverbInput.disconnect(bank.node); bank.node.disconnect(); bank.wet.disconnect(); banks.delete(bank);
    }
    if (!started || (!offline && context.state !== 'running')) return;
    if (t >= nextRadio) {
      play('radio_squelch'); play('radio_chatter');
      nextRadio = t + range(config.scheduler.radioInterval);
    }
    if (t >= nextSiren && (!siren || t >= siren.endTime)) {
      siren = play('siren_distant', { loop: false });
      nextSiren = t + (siren?.duration ?? 0) + range(config.scheduler.sirenPause);
    }
  }
  function getDiagnostics() {
    return { ...diagnostics, activeVoices: voices.size, activeSpecials: specials.size, reverbBanks: banks.size,
      decodedFiles: [...cache.values()].filter(Boolean).length,
      pendingLoads: inFlight.size, roomId, room: room && { ...room }, unlocked, started, disposed,
      contextState: context.state, sampleRate: context.sampleRate, nextRadio, nextSiren,
      history: history.map(item => ({ ...item })) };
  }
  async function dispose() {
    if (disposed) return; disposed = true;
    for (const controller of controllers) controller.abort();
    for (const voice of [...voices]) { voice.stop(); voice.cleanup(); }
    for (const bank of banks) { bank.node.disconnect(); bank.wet.disconnect(); }
    banks.clear();
    for (const source of specials) { try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
    specials.clear();
    for (const node of graph) node.disconnect();
    cache.clear(); synthCache.clear();
    if (ownsContext && context.state !== 'closed') await context.close();
  }
  return { context, config, unlock, play, gunshot, footstep, setListener, setRoom, preload,
    setMasterVolume: value => ramp(volume.gain, clamp(finite(value, 1), 0, 1), now()),
    update, dispose, getDiagnostics };
}
