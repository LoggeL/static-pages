import * as THREE from 'three';
import { APP_CONFIG } from './config.js';
import { STRINGS } from './strings.js';
import { createEventBus, gateInput, bridgePlayerEvents } from './events.js';
import { createAudioSource } from './audio-source.js';
import { createFallbackInput } from './fallbacks.js';
import { createTouchControls } from './touch.js';
import { createQualityController, renderTier, prefersTouch } from './quality.js';
import { createPlayerHealth } from './player-health.js';

const noop = () => {};

export async function createDemo({ canvas, quality = 'auto', controls = 'auto', volume = 0.65, onProgress = noop,
  ui = {}, debug = false, syntheticAudio = false, hooks = {}, npcConfig = {} } = {}) {
  if (!canvas?.getContext) throw new TypeError('startDemo requires a canvas');
  const view = Object.fromEntries(['setState', 'setProgress', 'notice', 'clearNotice', 'subtitle', 'setInputMode', 'setSettings', 'end']
    .map(name => [name, typeof ui[name] === 'function' ? ui[name].bind(ui) : noop]));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = APP_CONFIG.fallbackExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // One shadow update in the world pass, never overwrite it in the weapon pass.
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  const gl = renderer.getContext(), gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const tier = renderTier(String(gl.getParameter(gpuInfo ? gpuInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), prefersTouch());
  const qualityController = createQualityController({ tier, mode: quality, onChange: value => {
    currentQuality = value.quality; post?.setQuality(currentQuality); resize();
  } });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(APP_CONFIG.camera.fov, 1, APP_CONFIG.camera.near, APP_CONFIG.camera.far);
  scene.add(camera);
  const bus = createEventBus();
  const baseUrl = new URL('../../', import.meta.url);
  const query = new URLSearchParams(location.search);
  const requestedAssets = query.get('assets');
  const mobileDevice = prefersTouch() || controls === 'touch' || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4) || tier === 'software';
  let assetProfile = ['mobile', 'safe'].includes(requestedAssets) ? requestedAssets
    : requestedAssets === 'full' ? 'full' : mobileDevice ? 'mobile' : 'full';
  let assetBaseUrl = assetProfile === 'full' ? baseUrl : new URL('mobile/', baseUrl);
  const bootAbort = new AbortController();
  const bootStarted = performance.now();
  let bootStage = 'modules';
  // Small images must be chosen before GLTF decoding; render resolution alone saves no texture memory.
  renderer.shadowMap.enabled = assetProfile === 'full';
  const removers = [], issues = [], samples = [], eventCounts = {};
  const basePosition = new THREE.Vector3(), baseQuaternion = new THREE.Quaternion();
  const recoilQuaternion = new THREE.Quaternion(), recoilEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const recoilBack = new THREE.Vector3(), recoilAngular = new THREE.Vector3(), drawingSize = new THREE.Vector2();
  const inverseRecoil = new THREE.Quaternion();
  const state = { time: 0, angularVelocity: new THREE.Vector3(), linearVelocity: new THREE.Vector3(),
    shake: 0, muzzleFlash: 0, damage: 0, exposureHint: 0, flashlightOn: false };
  let world, player, weapon = null, arms = null, npcs = null, behavior = null, viewmodelLight = null, input, rawInput, audio = null, post = null, audioSource, audioContext, touchControls;
  let phase = 'loading', ready = false, disposed = false, contextLost = false;
  let introCalled = false, firstRoomSent = false, starting = false, frameFrozen = false, humStarted = false;
  let raf = 0, frames = 0, last = performance.now(), progress = 0;
  let ended = null, endTimer = 0, deathTime = 0;
  const health = createPlayerHealth({ bus, state, camera });
  let currentQuality = qualityController.snapshot().quality;
  let currentControls = controls;
  let currentVolume = Number.isFinite(volume) ? THREE.MathUtils.clamp(volume, 0, 1) : 0.65;
  const activeHooks = { onIntro: noop, onRoomEnter: noop, onAllSuspectsDown: noop, onPlayerDeath: noop, ...hooks };

  function report(stage, value, label) {
    progress = Math.max(progress, Math.min(1, value));
    bootStage = stage;
    const event = { stage, progress, label };
    view.setProgress(event); onProgress(event);
  }
  function checkActive() {
    if (disposed || contextLost || bootAbort.signal.aborted) throw new Error(STRINGS.contextLost);
  }
  async function bounded(promise, label, timeoutMs = APP_CONFIG.assetTimeoutMs) {
    let timer, expired = false;
    const pending = Promise.resolve(promise);
    pending.then(value => { if (expired || disposed) value?.dispose?.(); }, noop);
    try {
      const result = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error(`${label}: Zeitlimit nach ${timeoutMs / 1000} Sekunden`)); }, timeoutMs);
      })]);
      checkActive(); return result;
    } finally { clearTimeout(timer); }
  }
  function issue(id, message, error) {
    if (!issues.some(entry => entry.id === id)) {
      issues.push({ id, message, detail: error ? String(error.message ?? error) : null });
      console.info(`[bodycam/app] ${message}`, error?.message ?? '');
    }
    view.notice(id, message);
  }
  function setPhase(value) {
    phase = value; qualityController.reset(); touchControls?.setPlaying(value === 'playing'); view.setState(value);
  }
  function invokeHook(name, payload = {}) {
    try {
      const result = activeHooks[name]?.({ ...payload, app: api, bus, ui: view });
      if (result && typeof result.then === 'function')
        return Promise.resolve(result).catch(error => issue(`hook:${name}`, STRINGS.hookError, error));
      return result;
    }
    catch (error) { issue(`hook:${name}`, STRINGS.hookError, error); }
  }
  function roomEnter(event) {
    if (introCalled) invokeHook('onRoomEnter', event);
  }
  function captureBase() { basePosition.copy(camera.position); baseQuaternion.copy(camera.quaternion); }
  removers.push(bus.on('cameraRecoil', event => {
    recoilQuaternion.setFromEuler(recoilEuler.set(event.pitch, event.yaw, 0));
    camera.quaternion.copy(baseQuaternion).multiply(recoilQuaternion);
    camera.position.copy(basePosition).add(recoilBack.set(0, 0, event.back).applyQuaternion(baseQuaternion));
    camera.updateMatrixWorld(true);
    recoilAngular.set(event.angularVelocity?.x ?? 0, event.angularVelocity?.y ?? 0, event.angularVelocity?.z ?? 0);
  }));
  removers.push(bus.on('*', event => {
    if (event.type !== 'cameraRecoil') eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
  }));
  removers.push(bus.on('allSuspectsDown', payload => { invokeHook('onAllSuspectsDown', payload); endGame('cleared', payload); }));
  removers.push(bus.on('playerDeath', payload => { invokeHook('onPlayerDeath', payload); endGame('dead', payload); }));
  removers.push(bus.on('sound', event => { if (event.name === 'suspect_shout') view.subtitle(STRINGS.suspectShoutSubtitle, 2500); }));
  // Death: the camera drops and disconnects before the end card; a cleared house holds a moment longer.
  function endGame(kind, payload = {}) {
    if (ended || disposed) return;
    ended = kind; deathTime = 0;
    weapon?.trigger(false); weapon?.ads(false);
    if (kind === 'dead') post?.overlay.disconnected(APP_CONFIG.end.deadSeconds);
    const card = kind === 'dead' ? STRINGS.endDead(payload)
      : STRINGS.endCleared({ down: (payload.npcIds?.length ?? 0) - (payload.surrendered?.length ?? 0), surrendered: payload.surrendered?.length ?? 0 });
    endTimer = setTimeout(() => {
      if (disposed) return;
      pause(); phase = 'ended'; touchControls?.setPlaying(false); view.end(card);
    }, (kind === 'dead' ? APP_CONFIG.end.deadSeconds : APP_CONFIG.end.clearedSeconds) * 1000);
  }
  function deathFall(dt) {
    const fall = APP_CONFIG.end.fall, t = Math.min(1, (deathTime += dt) / fall.seconds), ease = t * t * (3 - 2 * t);
    camera.position.y -= fall.drop * ease;
    camera.rotateZ(THREE.MathUtils.degToRad(fall.rollDeg) * ease); camera.rotateX(THREE.MathUtils.degToRad(fall.pitchDeg) * ease);
    camera.updateMatrixWorld(true);
  }
  removers.push(bus.on('subtitle', payload => view.subtitle(payload.text, payload.ms ?? APP_CONFIG.subtitleMs)));

  function setQuality(value) {
    qualityController.setMode(value);
    samples.length = 0;
    return value;
  }
  function setControls(value) {
    if (!['auto', 'touch', 'mouse'].includes(value)) throw new RangeError('controls: auto, touch, mouse');
    if (phase === 'playing') pause();
    currentControls = value;
    const touch = value === 'touch' || value === 'auto' && prefersTouch();
    rawInput?.setMode?.(touch ? 'touch' : 'pointer');
    touchControls?.setEnabled(touch); view.setInputMode(touch ? 'touch' : 'pointer');
    return value;
  }
  function setVolume(value) {
    if (!Number.isFinite(value)) throw new TypeError('Finite volume required');
    currentVolume = THREE.MathUtils.clamp(value, 0, 1);
    audio?.setMasterVolume(phase === 'playing' ? currentVolume : 0);
    return currentVolume;
  }
  function resize() {
    if (disposed || contextLost) return;
    const width = Math.max(1, canvas.clientWidth || innerWidth);
    const height = Math.max(1, canvas.clientHeight || innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, APP_CONFIG.maxPixelRatio) * qualityController.snapshot().scale);
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(drawingSize);
    post?.setSize(drawingSize.x, drawingSize.y);
    weapon?.update(0); arms?.update(0); npcs?.update(0); post?.resetHistory();
  }
  function rawRender() {
    const layers = camera.layers.mask, background = scene.background;
    try {
      renderer.setRenderTarget(null); camera.layers.set(0); renderer.clear(); renderer.render(scene, camera);
      renderer.clearDepth(); camera.layers.set(1); scene.background = null; renderer.render(scene, camera);
    } finally { camera.layers.mask = layers; scene.background = background; }
  }
  function render(dt = 0) {
    if (disposed || contextLost) return;
    renderer.info.reset(); renderer.shadowMap.needsUpdate = true;
    if (post) {
      try { post.render(dt, state); }
      catch (error) {
        post.dispose(); post = null; issue('post', STRINGS.postUnavailable, error); rawRender();
      }
    } else rawRender();
    viewmodelLight?.update(dt);
    frames++;
  }
  function advance(dt) {
    player.update(dt); // C12 advances the world in physics substeps.
    if (ended === 'dead') deathFall(dt);
    captureBase();
    npcs?.update(dt);
    behavior?.update(dt);
    health.update(dt);
    weapon?.update(dt, { sprinting: !!player.state.sprinting && !!player.state.moving });
    arms?.update(dt, { moving: !!player.state.moving, sprinting: !!player.state.sprinting, floorY: player.position.y });
    state.time += dt;
    state.angularVelocity.copy(player.angularVelocity).applyQuaternion(inverseRecoil.copy(recoilQuaternion).invert()).add(recoilAngular);
    state.linearVelocity.copy(player.velocity);
    const weaponState = weapon?.state();
    state.shake = weaponState?.shake ?? 0;
    state.muzzleFlash = weapon?.effects?.stats().flash.gain ?? 0;
    state.flashlightOn = weaponState?.light ?? false;
    if (audio) {
      audio.setListener(camera.position, camera.quaternion); audio.update(dt);
    }
  }
  function frame(now) {
    if (disposed) return;
    const elapsed = Math.max(0, (now - last) / 1000); last = now;
    const dt = Math.min(elapsed, APP_CONFIG.maxFrameSeconds);
    try {
      if (!contextLost && !frameFrozen) {
        if (phase === 'playing') {
          advance(dt);
          // Measure real rAF intervals, never the clamped simulation timestep.
          if (elapsed > 0) { samples.push(elapsed * 1000); if (samples.length > APP_CONFIG.measurementFrames) samples.shift(); }
          qualityController.sample(elapsed * 1000);
        }
        render(phase === 'playing' ? dt : 0);
      }
    } catch (error) {
      pause(); frameFrozen = true; issue('runtime', STRINGS.runtimeError, error); setPhase('error');
    }
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    if (disposed || phase !== 'playing') return false;
    setPhase('paused'); input.exitLock(); weapon?.trigger(false); weapon?.ads(false);
    audio?.setMasterVolume(0);
    // Suspend the actual clock, preventing queued reload sounds/schedulers during pause.
    audio?.context?.suspend().catch(error => issue('audio-pause', STRINGS.audioUnavailable, error));
    post?.resetHistory(); last = performance.now();
    return true;
  }
  function activateAudio() {
    if (!audio || phase !== 'playing' || disposed) return;
    audio.setMasterVolume(currentVolume);
    if (!humStarted && world.policeCar) {
      humStarted = true; audio.play('police_lightbar_hum', { position: world.policeCar.position, loop: true });
    }
  }
  async function resume() {
    if (!ready || disposed || contextLost || phase === 'error' || phase === 'ended' || starting) return false;
    if (phase === 'playing') return true;
    starting = true;
    input.exitLock();
    // Both calls run before the first await to preserve transient user activation.
    const audioStart = audio ? audio.unlock().catch(error => {
      issue('audio-unlock', STRINGS.audioUnavailable, error); return false;
    }) : audioContext ? Promise.resolve(audioContext.resume()).then(() => true, () => false) : Promise.resolve(false);
    const lock = debug || !rawInput.available ? Promise.resolve(true) : input.requestLock();
    let locked = await lock;
    if (!locked && !disposed && !contextLost && !document.hidden && rawInput.setMode) {
      setControls('touch'); view.setSettings({ controls: 'touch' });
      issue('pointer-lock', STRINGS.pointerLockUnavailable); locked = true;
    }
    if (!locked || disposed || contextLost || document.hidden) {
      audio?.setMasterVolume(0); void audio?.context?.suspend().catch(noop);
      if (!locked) issue('pointer-lock', STRINGS.pointerLockUnavailable);
      starting = false; return false;
    }
    // Lock acquisition is the input gate. Audio may unlock independently.
    void audioStart.then(ok => {
      if (disposed) return;
      if (!ok && audio) issue('audio-unlock', STRINGS.audioUnavailable);
      if (phase !== 'playing') { audio?.setMasterVolume(0); void audio?.context?.suspend().catch(noop); }
    });
    if (rawInput.mode !== 'touch') view.clearNotice('pointer-lock');
    setPhase('playing'); frameFrozen = false; canvas.focus({ preventScroll: true });
    audio?.setMasterVolume(currentVolume); samples.length = 0; last = performance.now(); post?.resetHistory();
    activateAudio();
    if (!introCalled) { introCalled = true; post?.overlay.connected(); invokeHook('onIntro'); }
    if (!firstRoomSent) { firstRoomSent = true; roomEnter({ room: player.room, previous: null }); }
    starting = false; return true;
  }
  function stats() {
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.length ? samples.reduce((sum, ms) => sum + ms, 0) / samples.length : 0;
    const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { ready, phase, paused: phase !== 'playing', quality: currentQuality, graphics: qualityController.snapshot(),
      controls: rawInput?.mode ?? 'unavailable', volume: currentVolume,
      assets: assetProfile, world: world?.stats,
      startup: { stage: bootStage, elapsedMs: Math.round(performance.now() - bootStarted) },
      ...player?.stats(), frames, fps: mean ? 1000 / mean : 0, frameMs: { mean, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, samples: samples.length },
      viewport: [canvas.width, canvas.height], pixelRatio: renderer.getPixelRatio(),
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown',
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      modules: { world: !world?.fallback, player: !player?.fallback, input: !!rawInput?.available,
        weapon: !!weapon, arms: !!arms, npcs: !!npcs, audio: !!audio, post: !!post },
      audioMode: audioMode(), audio: audio?.getDiagnostics(),
      weapon: weapon?.state(), arms: arms?.state(), npcs: npcs?.state(), behavior: behavior?.state() ?? null, health: health.state(), ended, viewmodelLight: viewmodelLight?.stats() ?? null, post: post ? { renderSize: [post.diagnostics.renderWidth, post.diagnostics.renderHeight], quality: post.diagnostics.quality,
        gpu: post.diagnostics.gpu.snapshot() } : null,
      time: state.time, events: { ...eventCounts }, issues: [...issues],
    };
  }
  function audioMode() {
    if (!audio) return 'unavailable';
    const diagnostics = audio.getDiagnostics();
    return diagnostics.failed || diagnostics.manifestError
      ? diagnostics.decodedFiles ? 'mixed' : 'synthetic' : audioSource?.mode ?? 'unavailable';
  }
  function cameraCut() { viewmodelLight?.reset(); captureBase(); weapon?.update(0); arms?.update(0); npcs?.update(0); post?.resetHistory(); render(); }
  function teleport(...args) { player.teleport(...args); cameraCut(); return player.stats(); }
  function look(...args) { player.look(...args); cameraCut(); return player.stats(); }
  async function dispose() {
    if (disposed) return;
    disposed = true; ready = false; bootAbort.abort(); cancelAnimationFrame(raf);
    removers.splice(0).forEach(off => off()); clearTimeout(endTimer);
    touchControls?.dispose(); behavior?.dispose(); health.dispose(); npcs?.dispose(); input?.dispose(); arms?.dispose(); weapon?.dispose(); player?.dispose(); post?.dispose(); viewmodelLight?.dispose(); world?.dispose();
    bus.clear(); renderer.dispose(); audioSource?.dispose();
    if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(noop);
    await audio?.dispose();
  }
  const api = { get ready() { return ready; }, get player() { return player; }, get weapon() { return weapon; }, get arms() { return arms; }, get npcs() { return npcs; }, get behavior() { return behavior; }, get health() { return health; },
    bus, hooks: activeHooks, ui: view, stats, pause, resume, setQuality, setControls, setVolume, teleport, look, dispose, get world() { return world; },
    onIntro: payload => invokeHook('onIntro', payload), onRoomEnter: payload => invokeHook('onRoomEnter', payload),
    onAllSuspectsDown: payload => bus.emit('allSuspectsDown', payload),
    onPlayerDeath: payload => bus.emit('playerDeath', payload),
  };
  if (debug) api.dev = {
    scene, camera, renderer, state,
    get input() { return input; }, get world() { return world; }, get audio() { return audio; }, get post() { return post; },
    freeze(on = true) { frameFrozen = !!on; last = performance.now(); },
    step(seconds = 1 / 60) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new RangeError('step: 0..60 seconds');
      let rest = seconds;
      while (rest > 1e-10) { const dt = Math.min(1 / 120, rest); advance(dt); rest -= dt; }
      if (!seconds) { weapon?.update(0); arms?.update(0); npcs?.update(0); state.muzzleFlash = weapon?.effects?.stats().flash.gain ?? 0; }
      render(seconds); return stats();
    },
    render, resetMeasurements() { samples.length = 0; },
  };

  const listen = (target, type, callback) => {
    target.addEventListener(type, callback); removers.push(() => target.removeEventListener(type, callback));
  };
  // Watch context loss during decoding/upload too, before the first frame exists.
  listen(canvas, 'webglcontextlost', event => {
    event.preventDefault(); pause(); contextLost = true; bootAbort.abort();
    issue('context', STRINGS.contextLost); setPhase('error'); void dispose();
  });
  listen(window, 'pagehide', event => { if (event.persisted) pause(); else void dispose(); });

  try {
    view.setState('loading'); report('modules', 0.01, STRINGS.progressModules); resize();
    const paths = ['../world/index.js', '../player/index.js', '../core/input.js', '../weapon/index.js', '../audio/engine.js', '../postfx/bodycam.js'];
    const loaded = await Promise.allSettled(paths.map(path => bounded(import(path), path, 20000)));
    checkActive();
    const modules = loaded.map(result => result.status === 'fulfilled' ? result.value : null);
    const moduleError = index => loaded[index].status === 'rejected' ? loaded[index].reason : null;
    rawInput = modules[2]?.createInput(canvas, { debug }) ?? createFallbackInput();
    rawInput.available = !!modules[2]; input = gateInput(rawInput, () => phase === 'playing' && ended !== 'dead');
    if (rawInput.available && document.querySelector('#ui')) {
      touchControls = createTouchControls({ root: document.querySelector('#ui'), input: rawInput, onPause: pause });
      setControls(currentControls);
    }
    if (!rawInput.available) issue('input', STRINGS.inputUnavailable, moduleError(2));
    if (!modules[0]) throw moduleError(0);
    const loadMap = () => modules[0].loadWorld(scene, { renderer, baseUrl: assetBaseUrl,
      signal: bootAbort.signal,
      worldConfig: { baked: true, loadTimeoutMs: APP_CONFIG.assetTimeoutMs, bindLightmaps: assetProfile !== 'safe' }, onProgress: event => {
        if (event.warning) issue('world-detail', STRINGS.worldPartial);
        if (Number.isFinite(event.progress)) report('world', 0.08 + event.progress * 0.57, STRINGS.progressWorld);
      } });
    try { world = await loadMap(); }
    catch (error) {
      checkActive();
      if (assetProfile === 'safe') throw error;
      issue('world-retry', STRINGS.worldRetry, error);
      assetProfile = 'safe'; assetBaseUrl = new URL('mobile/', baseUrl); renderer.shadowMap.enabled = false;
      world = await loadMap();
    }
    checkActive();
    if (world.missingProps?.length) issue('props', STRINGS.missingProps(world.missingProps.length));
    scene.traverse(node => { if (node.isLight) node.layers.enable(1); });
    if (world.lighting?.config.viewmodel && modules[0].createViewmodelLight) {
      try {
        viewmodelLight = modules[0].createViewmodelLight({ renderer, scene, camera, lighting: world.lighting, colliders: world.colliders,
          config: world.lighting.config.viewmodel, mobile: tier !== 'desktop' || assetProfile !== 'full' });
      } catch (error) { // Without the probe the viewmodel keeps the unoccluded world lights.
        console.warn('Viewmodel light probe unavailable', error);
        scene.traverse(node => { if (node.isLight) node.layers.enable(1); });
      }
    }
    if (!modules[1]) throw moduleError(1) ?? new Error(STRINGS.playerUnavailable);
    player = modules[1].createPlayer({ camera, input, world });
    captureBase(); removers.push(bridgePlayerEvents(input, bus, roomEnter));
    report('weapon', 0.67, STRINGS.progressWeapon);
    try {
      if (!modules[3]) throw moduleError(3);
      weapon = await bounded(modules[3].createWeapon({ scene, camera, renderer, world, input, bus, baseUrl: assetBaseUrl }), 'Waffe');
      // Hits shove unlatched doors around their hinge.
      removers.push(weapon.on('impact', hit => {
        let node = hit.object;
        while (node && node.userData.doorId === undefined) node = node.parent;
        const door = node && world.doors?.find(entry => entry.id === node.userData.doorId);
        door?.impulse?.(hit.point, hit.direction ?? hit.normal.clone().negate());
      }));
    } catch (error) { issue('weapon', STRINGS.weaponUnavailable, error); }
    checkActive();
    if (weapon && new URLSearchParams(location.search).get('arms') !== '0') {
      try {
        const { createFPArms } = await bounded(import('../fp/arms.js'), 'Arme');
        arms = await bounded(createFPArms({ weapon, camera, renderer, baseUrl: assetBaseUrl }), 'Arme');
      } catch (error) { issue('arms', 'Arme konnten nicht geladen werden.', error); }
    }
    checkActive();
    if (!world.fallback && !player.fallback && new URLSearchParams(location.search).get('npcs') !== '0') {
      try {
        const { createNPCs } = await bounded(import('../npc/index.js'), 'Figuren');
        const npcDebug = new URLSearchParams(location.search).get('npcdebug') === '1';
        const { createSuspectBehavior, BEHAVIOR_NPC_OVERRIDES } = await bounded(import('../npc/behavior.js'), 'Figuren');
        // ?behavior=0 keeps the bare C19 technology (config transitions, no suspect minds) for the regression tests.
        const minds = query.get('behavior') !== '0';
        npcs = await bounded(createNPCs({ scene, world, player, camera, renderer, input, bus, baseUrl: assetBaseUrl,
          config: { ...(minds ? BEHAVIOR_NPC_OVERRIDES : {}), ...npcConfig, debug: { ...npcConfig.debug, enabled: npcDebug || !!npcConfig.debug?.enabled } } }), 'Figuren');
        if (minds) behavior = createSuspectBehavior({ manager: npcs, player, camera, bus, weapon });
      } catch (error) { issue('npcs', 'NPC-Technik konnte nicht geladen werden.', error); }
    }
    checkActive();
    report('audio', 0.78, STRINGS.progressAudio);
    // Recorded clips decode in the background. Interrupted/suspended Web Audio never gates the map.
    const prepareAudio = async () => {
      try {
        if (!modules[4]) throw moduleError(4);
        audioSource = createAudioSource(baseUrl, { synthetic: syntheticAudio });
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) throw new Error('Web Audio ist nicht verfügbar');
        // Retain the context while the manifest loads so the very first Start tap can unlock it.
        audioContext = new Context({ latencyHint: 'interactive' });
        const loadedAudio = await bounded(modules[4].createAudio({ baseUrl, manifestUrl: 'data/sounds.json',
          fetch: audioSource.fetch, context: audioContext, mobile: assetProfile !== 'full' }), 'Audio', 12000);
        audio = loadedAudio;
        audio.setMasterVolume(phase === 'playing' ? currentVolume : 0);
        removers.push(modules[4].attachAudio(audio, bus));
        bus.emit('roomChange', { roomId: player.room?.id ?? 'OUT', profile: player.room?.reverb ?? {} });
        audio.setListener(camera.position, camera.quaternion); arms?.setAudio(audio);
        if (phase === 'playing') { void audio.unlock().catch(noop); activateAudio(); }
        // Audio unlock remains in resume(), inside the user's tap.
        const preload = assetProfile === 'full' ? audio.preload() : audio.preloadEssentials();
        void preload.then(() => {
          if (disposed) return;
          audioSource.finish();
          const diagnostics = audio.getDiagnostics();
          if (audioMode() === 'synthetic' || diagnostics.failed || diagnostics.manifestError)
            issue('audio-files', audioMode() === 'mixed' ? STRINGS.audioPartial : STRINGS.audioFallback);
        }).catch(error => issue('audio-files', STRINGS.audioPartial, error));
      } catch (error) {
        audioSource?.dispose(); void audio?.dispose(); audio = null;
        if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(noop);
        if (!disposed) issue('audio', STRINGS.audioUnavailable, error);
      }
    };
    // Usually graph+manifest is ready before the start screen, but it has no blocking dependency.
    void prepareAudio();
    report('post', 0.93, STRINGS.progressPost);
    try {
      if (query.get('postfx') === '0' || assetProfile === 'safe') throw new Error('Simple graphics selected');
      if (!modules[5]) throw moduleError(5);
      const params = tier === 'desktop' ? undefined : { quality: { low: { msaa: 0 }, medium: { msaa: 0 }, high: { msaa: 2 } }, exposure: { readHz: 2 } };
      post = modules[5].createBodycamPost(renderer, scene, camera, { quality: currentQuality, params });
      resize(); await bounded(post.overlay.ready, 'Kameraeffekte');
    } catch (error) {
      post?.dispose(); post = null;
      if (query.get('postfx') !== '0' && assetProfile !== 'safe') issue('post', STRINGS.postUnavailable, error);
    }
    checkActive();
    if (tier !== 'desktop' || assetProfile !== 'full') scene.traverse(node => {
      if (!node.isLight || !node.shadow) return;
      if (tier === 'software' || assetProfile !== 'full') node.castShadow = false;
      node.shadow.mapSize.setScalar(Math.min(node.shadow.mapSize.x, tier === 'software' ? 256 : 512));
    });
    removers.push(input.on('pause', pause));
    removers.push(input.on('shout', () => {
      const position = camera.getWorldPosition(new THREE.Vector3()).toArray();
      bus.emit('sound', { name: 'officer_shout_police', position }); bus.emit('shout', { position });
      view.subtitle(STRINGS.shoutSubtitle, 2200);
    }));
    removers.push(bus.on('npc.statechange', event => { if (event.state === 'surrender') view.subtitle(STRINGS.surrenderSubtitle, 2500); }));
    removers.push(input.on('reset', event => { if (['blur', 'hidden'].includes(event.reason)) pause(); }));
    removers.push(input.on('respawn', () => post?.resetHistory()));
    const unlockAudio = () => {
      if (phase === 'playing' && audio && audio.context.state !== 'running') void audio.unlock().catch(noop);
    };
    listen(document, 'pointerdown', unlockAudio);
    listen(document, 'keydown', unlockAudio);
    listen(window, 'resize', resize);
    listen(window, 'blur', pause);
    listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
    report('ready', 1, STRINGS.progressReady);
    ready = true; setPhase('start'); render(); last = performance.now(); raf = requestAnimationFrame(frame);
    return api;
  } catch (error) {
    error.stage = bootStage; error.userMessage = bootStage === 'world' ? STRINGS.worldUnavailable : STRINGS.graphicsUnavailable;
    void dispose(); throw error;
  }
}
