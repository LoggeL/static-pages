import * as THREE from 'three';
import { CapsuleCollision } from '../player/collision.js';

// Lights the viewmodel layer (arms, rifle) with what the surroundings send towards the camera.
// World lights reach layer 1 without walls in between, so a dark bathroom still lit the sleeve
// with full moon and sky fill. Six tiny world-axis views of layer 0 are read back asynchronously,
// projected to SH and fed to a LightProbe that only layer 1 sees. Baked light, lamps, NPCs and the
// own weapon light on a nearby wall all arrive as they look. Direct moon and street lamp copies
// are kept for shape but scaled by how much sky the camera sees. Baked-only lamps (the kitchen bulb)
// are too small for the probe to catch their direct light; they get point lights gated by line of sight.
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const UPS = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]];

export function createViewmodelLight({ renderer, scene, camera, lighting, colliders, config, mobile = false }) {
  const size = config.faceSize, texels = 6 * size * size;
  const target = new THREE.WebGLRenderTarget(6 * size, size, { type: THREE.HalfFloatType, depthBuffer: true });
  target.texture.generateMipmaps = false;
  const probeCamera = new THREE.PerspectiveCamera(90, 1, config.near, config.far);
  probeCamera.layers.set(0);
  const faces = AXES.map((axis, index) => {
    const object = new THREE.Object3D();
    object.up.fromArray(UPS[index]); object.lookAt(...axis);
    // Object3D.lookAt points +Z; cameras look down -Z.
    return new THREE.Quaternion().copy(object.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  });
  // Per texel: world direction, solid-angle weight and SH basis (rows bottom-up as readPixels returns them).
  const directions = new Float32Array(texels * 3), weights = new Float32Array(texels), basis = new Float32Array(texels * 9);
  const direction = new THREE.Vector3(), shBasis = new Array(9);
  for (let face = 0; face < 6; face++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const index = (y * 6 * size) + face * size + x;
    direction.set(u, v, -1).normalize().applyQuaternion(faces[face]);
    directions.set([direction.x, direction.y, direction.z], index * 3);
    weights[index] = 1 / Math.pow(1 + u * u + v * v, 1.5);
    THREE.SphericalHarmonics3.getBasisAt(direction, shBasis);
    basis.set(shBasis, index * 9);
  }
  const pixels = new Uint16Array(texels * 4), fromHalf = THREE.DataUtils.fromHalfFloat;
  const probe = new THREE.LightProbe(); probe.name = 'ViewmodelProbe'; probe.layers.set(1);
  probe.intensity = config.gain;
  const root = new THREE.Group(); root.name = 'ViewmodelLights';
  root.add(probe);
  // World lights stop reaching the viewmodel; their sky-gated copies take over the direct part.
  const directs = [];
  lighting?.root.traverse(light => { if (light.isLight) light.layers.disable(1); });
  for (const source of [lighting?.moon, lighting?.streetlight]) {
    if (!source) continue;
    const copy = source.isDirectionalLight ? new THREE.DirectionalLight(source.color, 0) : new THREE.PointLight(source.color, 0, source.distance, source.decay);
    copy.name = `${source.name}Viewmodel`; copy.layers.set(1); copy.position.copy(source.position);
    if (source.isDirectionalLight) copy.target = source.target;
    (source.parent ?? root).add(copy);
    directs.push({ copy, base: source.intensity });
  }
  const collision = colliders ? new CapsuleCollision(colliders) : null, eye = new THREE.Vector3(), toLamp = new THREE.Vector3();
  const lamps = (config.lamps ?? []).map(lamp => {
    const light = new THREE.PointLight(0xffffff, 0, 0, 2);
    light.name = `${lamp.name}Viewmodel`; light.layers.set(1); light.position.fromArray(lamp.position);
    light.color.setRGB(...lamp.color, THREE.LinearSRGBColorSpace);
    root.add(light);
    return { light, lamp, seen: 0 };
  });
  scene.add(root);
  const background = new THREE.Color(), current = new Float32Array(27), wanted = new Float32Array(27);
  const savedClear = new THREE.Color();
  let sky = 0, skyWanted = 0, pending = false, nextRender = 0, elapsed = 0, primed = false, disposed = false, face = 0, epoch = 0;
  const stats = { updates: 0, readbackErrors: 0, sky: 0, irradiance: 0, ms: 0, calls: 0 };

  // One face per call keeps the cost per frame to a single small scene pass.
  function capture() {
    const started = performance.now();
    const savedTarget = renderer.getRenderTarget(), savedAutoClear = renderer.autoClear, savedTone = renderer.toneMapping;
    const savedScissorTest = renderer.getScissorTest(), savedAlpha = renderer.getClearAlpha(), savedBackground = scene.background;
    const savedShadow = renderer.shadowMap.autoUpdate, savedNeeds = renderer.shadowMap.needsUpdate;
    renderer.getClearColor(savedClear);
    if (scene.background?.isColor) background.copy(scene.background); else background.setRGB(0, 0, 0);
    try {
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false; scene.background = null;
      // Target viewport/scissor are in target pixels; the renderer's own ones carry the pixel ratio.
      target.viewport.set(face * size, 0, size, size); target.scissor.copy(target.viewport); target.scissorTest = true;
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear();
      camera.getWorldPosition(probeCamera.position);
      probeCamera.quaternion.copy(faces[face]); probeCamera.updateMatrixWorld(true);
      // The frame statistics describe the main view; the probe pass is counted separately.
      const info = renderer.info.render, calls = info.calls, triangles = info.triangles, points = info.points, lines = info.lines;
      renderer.render(scene, probeCamera);
      stats.calls = info.calls - calls; info.calls = calls; info.triangles = triangles; info.points = points; info.lines = lines;
    } finally {
      renderer.setRenderTarget(savedTarget);
      renderer.setScissorTest(savedScissorTest); renderer.setClearColor(savedClear, savedAlpha);
      renderer.autoClear = savedAutoClear; renderer.toneMapping = savedTone; scene.background = savedBackground;
      renderer.shadowMap.autoUpdate = savedShadow; renderer.shadowMap.needsUpdate = savedNeeds;
    }
    stats.ms = performance.now() - started;
    face = (face + 1) % 6;
    if (face) return;
    pending = true;
    const issued = epoch;
    renderer.readRenderTargetPixelsAsync(target, 0, 0, 6 * size, size, pixels).then(() => {
      if (issued === epoch) project(); else pending = false; // Faces from before a camera cut.
    }, () => { pending = false; stats.readbackErrors++; });
  }
  function project() {
    pending = false;
    if (disposed) return;
    wanted.fill(0);
    let total = 0, open = 0, upper = 0;
    for (let i = 0; i < texels; i++) {
      const alpha = Math.min(1, Math.max(0, fromHalf(pixels[i * 4 + 3]))), clear = 1 - alpha;
      const r = fromHalf(pixels[i * 4]) + background.r * clear, g = fromHalf(pixels[i * 4 + 1]) + background.g * clear;
      const b = fromHalf(pixels[i * 4 + 2]) + background.b * clear, w = weights[i];
      if (!Number.isFinite(r + g + b)) continue;
      for (let j = 0; j < 9; j++) {
        const k = basis[i * 9 + j] * w;
        wanted[j * 3] += r * k; wanted[j * 3 + 1] += g * k; wanted[j * 3 + 2] += b * k;
      }
      total += w;
      const up = directions[i * 3 + 1];
      if (up > 0) { open += clear * w * up; upper += w * up; }
    }
    if (total > 0) for (let j = 0; j < 27; j++) wanted[j] *= 4 * Math.PI / total;
    // A bare bulb in one face rings through L2 into negative irradiance on the far side (black arms
    // in a lit kitchen). Keep L0/L1 and limit L1 so every direction keeps a share of the ambient.
    wanted.fill(0, 12);
    for (let c = 0; c < 3; c++) {
      const ambient = 0.886227 * wanted[c], lobe = 1.023328 * Math.hypot(wanted[3 + c], wanted[6 + c], wanted[9 + c]);
      const limit = (1 - config.minAmbientShare) * ambient;
      if (lobe > limit) for (const j of [3, 6, 9]) wanted[j + c] *= limit / lobe;
    }
    skyWanted = upper > 0 ? open / upper : 0;
    if (!primed) { current.set(wanted); sky = skyWanted; primed = true; }
    stats.updates++;
  }
  function apply(k) {
    for (let j = 0; j < 27; j++) current[j] += (wanted[j] - current[j]) * k;
    sky += (skyWanted - sky) * k;
    probe.sh.coefficients.forEach((coefficient, j) => coefficient.set(current[j * 3], current[j * 3 + 1], current[j * 3 + 2]));
    for (const { copy, base } of directs) copy.intensity = base * sky * config.directGain;
    for (const entry of lamps) entry.light.intensity = entry.lamp.intensity * entry.seen * config.directGain;
    stats.sky = sky; stats.irradiance = 0.2126 * current[0] + 0.7152 * current[1] + 0.0722 * current[2];
  }
  return {
    probe, root,
    /** Call after the frame is rendered; captures at a fixed rate and eases towards the last readback. */
    update(dt = 0) {
      if (disposed) return;
      elapsed += dt;
      if (!pending && elapsed >= nextRender) {
        capture(); if (!face) nextRender = elapsed + 1 / (mobile ? config.mobileHz : config.hz);
      }
      if (lamps.length) camera.getWorldPosition(eye);
      for (const entry of lamps) {
        toLamp.subVectors(entry.light.position, eye); const distance = toLamp.length();
        const blocked = collision && distance > entry.lamp.radius
          && collision.raycast(eye, toLamp.multiplyScalar(1 / distance), distance - entry.lamp.radius);
        const wanted = blocked ? 0 : 1;
        entry.seen = !primed || !dt ? wanted : entry.seen + (wanted - entry.seen) * (1 - Math.exp(-dt / config.lampFadeSeconds));
      }
      apply(primed ? 1 - Math.exp(-dt / Math.max(0.001, config.smoothingSeconds)) : 0);
    },
    /** Camera cut: take the next readback as is. */
    reset() { primed = false; face = 0; epoch++; nextRender = elapsed; },
    stats: () => ({ ...stats }),
    dispose() {
      disposed = true; scene.remove(root); target.dispose();
      for (const { copy } of directs) copy.removeFromParent();
      lighting?.root.traverse(light => { if (light.isLight) light.layers.enable(1); });
    },
  };
}
