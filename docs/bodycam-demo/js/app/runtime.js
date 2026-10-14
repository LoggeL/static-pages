import * as THREE from 'three';
import { APP_CONFIG } from './config.js';
import { STRINGS } from './strings.js';
import { createEventBus, gateInput, bridgePlayerEvents } from './events.js';
import { createAudioSource } from './audio-source.js';
import { createFallbackWorld, createFallbackPlayer, createFallbackInput } from './fallbacks.js';
import { createTouchControls } from './touch.js';
import { createQualityController, renderTier, prefersTouch } from './quality.js';

const noop = () => {};

export async function createDemo({ canvas, quality = 'auto', controls = 'auto', volume = 0.65, onProgress = noop,
  ui = {}, debug = false, syntheticAudio = false, hooks = {}, npcConfig = {} } = {}) {
  if (!canvas?.getContext) throw new TypeError('startDemo requires a canvas');
  const view = Object.fromEntries(['setState', 'setProgress', 'notice', 'clearNotice', 'subtitle', 'setInputMode', 'setSettings']
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
  const removers = [], issues = [], samples = [], eventCounts = {};
  const basePosition = new THREE.Vector3(), baseQuaternion = new THREE.Quaternion();
  const recoilQuaternion = new THREE.Quaternion(), recoilEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const recoilBack = new THREE.Vector3(), recoilAngular = new THREE.Vector3(), drawingSize = new THREE.Vector2();
  const inverseRecoil = new THREE.Quaternion();
  const state = { time: 0, angularVelocity: new THREE.Vector3(), linearVelocity: new THREE.Vector3(),
    shake: 0, muzzleFlash: 0, damage: 0, exposureHint: 0, flashlightOn: false };
  let world, player, weapon = null, arms = null, npcs = null, input, rawInput, audio = null, post = null, audioSource, touchControls;
  let phase = 'loading', ready = false, disposed = false, contextLost = false;
  let introCalled = false, firstRoomSent = false, starting = false, frameFrozen = false, humStarted = false;
  let raf = 0, frames = 0, last = performance.now(), progress = 0;
  let currentQuality = qualityController.snapshot().quality;
  let currentControls = controls;
  let currentVolume = Number.isFinite(volume) ? THREE.MathUtils.clamp(volume, 0, 1) : 0.65;
  const activeHooks = { onIntro: noop, onRoomEnter: noop, onAllSuspectsDown: noop, onPlayerDeath: noop, ...hooks };

  function report(stage, value, label) {
    progress = Math.max(progress, Math.min(1, value));
    const event = { stage, progress, label };
    view.setProgress(event); onProgress(event);
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
  removers.push(bus.on('allSuspectsDown', payload => invokeHook('onAllSuspectsDown', payload)));
  removers.push(bus.on('playerDeath', payload => { pause(); invokeHook('onPlayerDeath', payload); }));
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
    frames++;
  }
  function advance(dt) {
    player.update(dt); // C12 advances the world in physics substeps.
    captureBase();
    npcs?.update(dt);
    weapon?.update(dt, { sprinting: !!player.state.sprinting && !!player.state.moving });
    arms?.update(dt, { moving: !!player.state.moving, sprinting: !!player.state.sprinting });
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
  async function resume() {
    if (!ready || disposed || contextLost || phase === 'error' || starting) return false;
    if (phase === 'playing') return true;
    starting = true;
    input.exitLock();
    // Both calls run before the first await to preserve transient user activation.
    const audioStart = audio ? audio.unlock().catch(error => {
      issue('audio-unlock', STRINGS.audioUnavailable, error); return false;
    }) : Promise.resolve(false);
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
    if (audio && !humStarted && world.policeCar) {
      humStarted = true; audio.play('police_lightbar_hum', { position: world.policeCar.position, loop: true });
    }
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
      ...player?.stats(), frames, fps: mean ? 1000 / mean : 0, frameMs: { mean, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, samples: samples.length },
      viewport: [canvas.width, canvas.height], pixelRatio: renderer.getPixelRatio(),
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown',
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      modules: { world: !world?.fallback, player: !player?.fallback, input: !!rawInput?.available,
        weapon: !!weapon, arms: !!arms, npcs: !!npcs, audio: !!audio, post: !!post },
      audioMode: audioMode(), audio: audio?.getDiagnostics(),
      weapon: weapon?.state(), arms: arms?.state(), npcs: npcs?.state(), post: post ? { renderSize: [post.diagnostics.renderWidth, post.diagnostics.renderHeight], quality: post.diagnostics.quality,
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
  function cameraCut() { captureBase(); weapon?.update(0); arms?.update(0); npcs?.update(0); post?.resetHistory(); render(); }
  function teleport(...args) { player.teleport(...args); cameraCut(); return player.stats(); }
  function look(...args) { player.look(...args); cameraCut(); return player.stats(); }
  async function dispose() {
    if (disposed) return;
    disposed = true; ready = false; cancelAnimationFrame(raf);
    removers.splice(0).forEach(off => off());
    touchControls?.dispose(); npcs?.dispose(); input?.dispose(); arms?.dispose(); weapon?.dispose(); player?.dispose(); post?.dispose(); world?.dispose();
    bus.clear(); renderer.dispose(); audioSource?.dispose(); await audio?.dispose();
  }
  const api = { get ready() { return ready; }, get player() { return player; }, get weapon() { return weapon; }, get arms() { return arms; }, get npcs() { return npcs; },
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

  try {
    view.setState('loading'); report('modules', 0.01, STRINGS.progressModules); resize();
    const paths = ['../world/index.js', '../player/index.js', '../core/input.js', '../weapon/index.js', '../audio/engine.js', '../postfx/bodycam.js'];
    const loaded = await Promise.allSettled(paths.map(path => import(path)));
    const modules = loaded.map(result => result.status === 'fulfilled' ? result.value : null);
    const moduleError = index => loaded[index].status === 'rejected' ? loaded[index].reason : null;
    rawInput = modules[2]?.createInput(canvas, { debug }) ?? createFallbackInput();
    rawInput.available = !!modules[2]; input = gateInput(rawInput, () => phase === 'playing');
    if (rawInput.available && document.querySelector('#ui')) {
      touchControls = createTouchControls({ root: document.querySelector('#ui'), input: rawInput, onPause: pause });
      setControls(currentControls);
    }
    if (!rawInput.available) issue('input', STRINGS.inputUnavailable, moduleError(2));
    try {
      if (!modules[0]) throw moduleError(0);
      world = await modules[0].loadWorld(scene, { renderer, baseUrl, onProgress: event =>
        report('world', 0.08 + event.progress * 0.57, STRINGS.progressWorld) });
    } catch (error) { issue('world', STRINGS.worldUnavailable, error); world = createFallbackWorld(scene); }
    if (world.missingProps.length) issue('props', STRINGS.missingProps(world.missingProps.length));
    scene.traverse(node => { if (node.isLight) node.layers.enable(1); });
    try {
      if (!modules[1] || world.fallback) throw moduleError(1) ?? new Error('World unavailable');
      player = modules[1].createPlayer({ camera, input, world });
    } catch (error) { issue('player', STRINGS.playerUnavailable, error); player = createFallbackPlayer(camera, world); }
    captureBase(); removers.push(bridgePlayerEvents(input, bus, roomEnter));
    report('weapon', 0.67, STRINGS.progressWeapon);
    try {
      if (!modules[3]) throw moduleError(3);
      weapon = await modules[3].createWeapon({ scene, camera, renderer, world, input, bus, baseUrl });
      // Hits shove unlatched doors around their hinge.
      removers.push(weapon.on('impact', hit => {
        let node = hit.object;
        while (node && node.userData.doorId === undefined) node = node.parent;
        const door = node && world.doors?.find(entry => entry.id === node.userData.doorId);
        door?.impulse?.(hit.point, hit.direction ?? hit.normal.clone().negate());
      }));
    } catch (error) { issue('weapon', STRINGS.weaponUnavailable, error); }
    if (weapon && new URLSearchParams(location.search).get('arms') !== '0') {
      try {
        const { createFPArms } = await import('../fp/arms.js');
        arms = await createFPArms({ weapon, camera, renderer, baseUrl });
      } catch (error) { issue('arms', 'Arme konnten nicht geladen werden.', error); }
    }
    if (!world.fallback && !player.fallback && new URLSearchParams(location.search).get('npcs') !== '0') {
      try {
        const { createNPCs } = await import('../npc/index.js');
        const npcDebug = new URLSearchParams(location.search).get('npcdebug') === '1';
        npcs = await createNPCs({ scene, world, player, camera, renderer, input, bus, baseUrl,
          config: { ...npcConfig, debug: { ...npcConfig.debug, enabled: npcDebug || !!npcConfig.debug?.enabled } } });
      } catch (error) { issue('npcs', 'NPC-Technik konnte nicht geladen werden.', error); }
    }
    report('audio', 0.78, STRINGS.progressAudio);
    try {
      if (!modules[4]) throw moduleError(4);
      audioSource = createAudioSource(baseUrl, { synthetic: syntheticAudio });
      audio = await modules[4].createAudio({ baseUrl, manifestUrl: 'data/sounds.json', fetch: audioSource.fetch });
      audio.setMasterVolume(0); await audio.preload();
      audioSource.finish();
      await audio.context.suspend();
      removers.push(modules[4].attachAudio(audio, bus));
      bus.emit('roomChange', { roomId: player.room?.id ?? 'OUT', profile: player.room?.reverb ?? {} });
      audio.setListener(camera.position, camera.quaternion);
      const diagnostics = audio.getDiagnostics();
      if (audioMode() === 'synthetic' || diagnostics.failed || diagnostics.manifestError)
        issue('audio-files', audioMode() === 'mixed' ? STRINGS.audioPartial : STRINGS.audioFallback);
    } catch (error) { audioSource?.dispose(); await audio?.dispose(); audio = null; issue('audio', STRINGS.audioUnavailable, error); }
    arms?.setAudio(audio);
    report('post', 0.93, STRINGS.progressPost);
    try {
      if (new URLSearchParams(location.search).get('postfx') === '0') throw new Error('Simple graphics selected');
      if (!modules[5]) throw moduleError(5);
      const params = tier === 'desktop' ? undefined : { quality: { low: { msaa: 0 }, medium: { msaa: 0 }, high: { msaa: 2 } }, exposure: { readHz: 2 } };
      post = modules[5].createBodycamPost(renderer, scene, camera, { quality: currentQuality, params });
      resize(); await post.overlay.ready;
    } catch (error) { post?.dispose(); post = null; issue('post', STRINGS.postUnavailable, error); }
    if (tier !== 'desktop') scene.traverse(node => {
      if (!node.isLight || !node.shadow) return;
      if (tier === 'software') node.castShadow = false;
      node.shadow.mapSize.setScalar(Math.min(node.shadow.mapSize.x, tier === 'software' ? 256 : 512));
    });
    removers.push(input.on('pause', pause));
    removers.push(input.on('reset', event => { if (['blur', 'hidden'].includes(event.reason)) pause(); }));
    removers.push(input.on('respawn', () => post?.resetHistory()));
    const listen = (target, type, callback) => {
      target.addEventListener(type, callback); removers.push(() => target.removeEventListener(type, callback));
    };
    listen(window, 'resize', resize);
    listen(window, 'blur', pause);
    listen(document, 'visibilitychange', () => { if (document.hidden) pause(); });
    listen(window, 'pagehide', event => { if (event.persisted) pause(); else void dispose(); });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault(); pause(); contextLost = true; issue('context', STRINGS.contextLost); setPhase('error');
      // Tear down while the context is lost. Restoring these module-owned GPU
      // objects leaves stale disposal handles in r170; the visible reload action
      // creates a fresh renderer, world, post pipeline and audio context together.
      void dispose();
    });
    report('ready', 1, STRINGS.progressReady);
    ready = true; setPhase('start'); render(); last = performance.now(); raf = requestAnimationFrame(frame);
    return api;
  } catch (error) { await dispose(); throw error; }
}
