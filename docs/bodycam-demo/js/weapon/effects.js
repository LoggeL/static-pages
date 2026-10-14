import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DataTexture, DynamicDrawUsage,
  Euler, Group, MathUtils, Matrix3, Matrix4, Mesh, MeshStandardMaterial, NormalBlending,
  Object3D, PointLight, Points, Quaternion, Raycaster, ShaderMaterial, SpotLight,
  Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';
import { createAssetLoaders } from '../core/loaders.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { surfaceOfHit } from '../world/colliders.js';
import { weaponEffectsConfig } from './effects-config.js';

const UP = new Vector3(0, 1, 0);
const DECAL_AXIS = new Vector3(0, 0, 1);
const DECAL_SURFACES = ['wood', 'plaster', 'metal', 'concrete'];

function flashTexture(size, variant) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const lobes = 0.66 + 0.34 * Math.pow(Math.abs(Math.cos(angle * (3 + variant) + variant)), 8);
      const glow = Math.max(0, 1 - radius / lobes);
      const alpha = Math.pow(glow, 1.7);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = Math.round(170 + 85 * glow);
      data[offset + 2] = Math.round(75 + 180 * glow * glow);
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createParticles(root, capacity, additive, pixelScale) {
  capacity = Math.max(0, Math.floor(capacity));
  const geometry = new BufferGeometry();
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const opacities = new Float32Array(capacity);
  for (const [name, array, size] of [
    ['position', positions, 3], ['color', colors, 3], ['particleSize', sizes, 1], ['opacity', opacities, 1],
  ]) geometry.setAttribute(name, new BufferAttribute(array, size).setUsage(DynamicDrawUsage));
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending,
    uniforms: { pixelScale: { value: pixelScale } },
    vertexShader: `
      attribute vec3 color;
      attribute float particleSize;
      attribute float opacity;
      varying vec3 vColor;
      varying float vOpacity;
      uniform float pixelScale;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_PointSize = clamp(particleSize * pixelScale / max(0.1, -p.z), 1.0, 64.0);
        vColor = color; vOpacity = opacity;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = vOpacity * pow(max(0.0, 1.0 - radius), 1.5);
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(vColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Points(geometry, material);
  mesh.name = additive ? 'WeaponSparks' : 'WeaponDust';
  mesh.frustumCulled = false;
  mesh.layers.set(0);
  root.add(mesh);
  const slots = Array.from({ length: capacity }, () => ({
    active: false, position: new Vector3(), velocity: new Vector3(), age: 0, life: 0, size: 0,
  }));
  let cursor = 0;
  return {
    mesh, slots,
    spawn(position, velocity, color, life, size) {
      if (!capacity) return;
      const index = cursor++ % capacity;
      const slot = slots[index];
      slot.active = true;
      slot.position.copy(position);
      slot.velocity.copy(velocity);
      slot.age = 0; slot.life = life; slot.size = size;
      color.toArray(colors, index * 3);
    },
    update(dt, gravity, drag) {
      let active = 0;
      slots.forEach((slot, index) => {
        if (!slot.active) { opacities[index] = 0; return; }
        slot.age += dt;
        if (slot.age >= slot.life) { slot.active = false; opacities[index] = 0; return; }
        slot.velocity.multiplyScalar(Math.exp(-drag * dt));
        slot.velocity.y -= gravity * dt;
        slot.position.addScaledVector(slot.velocity, dt);
        slot.position.toArray(positions, index * 3);
        const progress = slot.age / slot.life;
        opacities[index] = (1 - progress) * (additive ? 1 : 0.42);
        sizes[index] = slot.size * (additive ? 1 : 1 + progress * 1.5);
        active++;
      });
      mesh.visible = active > 0;
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    },
    dispose() {
      slots.forEach(slot => { slot.active = false; });
      mesh.removeFromParent(); geometry.dispose(); material.dispose();
    },
  };
}

/** Replace any hook in createWeapon with an application implementation using the same payloads.
 * All positions/directions/hit normals are world-space; update receives elapsed seconds.
 * Loaded assets, pools, GPU resources and lights are exclusively owned by this instance.
 */
export async function createWeaponEffects({
  scene, camera, renderer, nodes, world, baseUrl = new URL('../../', import.meta.url),
  emit = () => {}, random = Math.random, config: overrides = {},
}) {
  if (!scene || !camera || !nodes?.W_Muzzle || !nodes?.W_Ejection || !nodes?.W_LightEmitter) {
    throw new Error('Weapon effects require scene, camera and W_Muzzle/W_Ejection/W_LightEmitter.');
  }
  const config = weaponEffectsConfig(overrides);
  const rootUrl = new URL(baseUrl, import.meta.url);
  if (!rootUrl.pathname.endsWith('/')) rootUrl.pathname += '/';
  const assetUrl = path => new URL(path, rootUrl).href;
  const root = new Group();
  root.name = 'WeaponWorldEffects';
  root.userData.collidable = false;
  root.layers.set(0);
  const textures = new Set();
  const decalMaterials = new Map();
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  const assets = createAssetLoaders({ renderer });
  let casingSource;
  // Collect successful loads before propagating failure, so a rejected creation leaks no assets.
  const loads = await Promise.allSettled([
    assets.gltf.loadAsync(assetUrl('models/casing_556.glb')).then(gltf => {
      casingSource = gltf.scene;
      casingSource.traverse(node => {
        if (!node.isMesh) return;
        ownedGeometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          ownedMaterials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
    }),
    ...DECAL_SURFACES.map(async surface => {
      const texture = await assets.texture.loadAsync(assetUrl(`textures/decals/bullet_hole_${surface}.png`));
      texture.colorSpace = SRGBColorSpace;
      textures.add(texture);
      const material = new MeshStandardMaterial({
        name: `WeaponDecal_${surface}`, map: texture, roughness: surface === 'metal' ? 0.7 : 0.95,
        metalness: 0, transparent: true, depthWrite: false, alphaTest: config.decals.alphaTest,
        polygonOffset: true, polygonOffsetFactor: config.decals.polygonOffsetFactor,
        polygonOffsetUnits: config.decals.polygonOffsetUnits,
      });
      decalMaterials.set(surface, material);
      ownedMaterials.add(material);
    }),
  ]).finally(() => assets.dispose());
  const failed = loads.find(result => result.status === 'rejected');
  if (failed) {
    ownedGeometries.forEach(geometry => geometry.dispose());
    ownedMaterials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    throw failed.reason;
  }
  scene.add(root);
  const flashMaps = Array.from({ length: Math.max(1, config.flash.variants) }, (_, variant) => {
    const map = flashTexture(config.flash.textureSize, variant); textures.add(map); return map;
  });
  const flashMaterial = new SpriteMaterial({
    map: flashMaps[0], transparent: true, depthWrite: false, blending: AdditiveBlending,
    toneMapped: false, opacity: 0,
  });
  ownedMaterials.add(flashMaterial);
  const flashSprite = new Sprite(flashMaterial);
  flashSprite.name = 'WeaponMuzzleFlash';
  flashSprite.layers.set(1);
  flashSprite.scale.setScalar(config.flash.size);
  flashSprite.visible = false;
  nodes.W_Muzzle.add(flashSprite);
  const flashLight = new PointLight(config.flash.color, 0, config.flash.distance, config.flash.decay);
  flashLight.name = 'WeaponMuzzleLight';
  flashLight.layers.enable(1);
  nodes.W_Muzzle.add(flashLight);

  const target = new Object3D();
  target.name = 'WeaponFlashlightTarget';
  target.position.set(0, 0, -1);
  nodes.W_LightEmitter.add(target);
  const lightConfig = config.light;
  const spot = new SpotLight(lightConfig.color, lightConfig.intensity, lightConfig.distance,
    MathUtils.degToRad(lightConfig.angleDeg), lightConfig.penumbra, lightConfig.decay);
  spot.name = 'WeaponFlashlight';
  spot.target = target;
  spot.layers.enable(1);
  spot.castShadow = true;
  spot.shadow.mapSize.set(lightConfig.shadowSize, lightConfig.shadowSize);
  spot.shadow.camera.near = lightConfig.shadowNear;
  spot.shadow.camera.far = lightConfig.shadowFar;
  spot.shadow.camera.layers.set(0);
  spot.shadow.bias = lightConfig.shadowBias;
  spot.shadow.normalBias = lightConfig.shadowNormalBias;
  const spill = new SpotLight(lightConfig.color, lightConfig.intensity * lightConfig.spillGain,
    lightConfig.distance, MathUtils.degToRad(lightConfig.spillAngleDeg), lightConfig.penumbra, lightConfig.decay);
  spill.name = 'WeaponFlashlightSpill';
  spill.target = target;
  spill.layers.enable(1);
  spot.visible = spill.visible = false;
  nodes.W_LightEmitter.add(spot, spill);

  const casings = Array.from({ length: Math.max(0, Math.floor(config.casing.pool)) }, () => {
    const object = casingSource.clone(true);
    object.name = 'WeaponCasing';
    object.visible = false;
    object.traverse(node => {
      node.layers.set(0);
      if (node.isMesh) { node.castShadow = false; node.receiveShadow = true; }
    });
    root.add(object);
    return { object, active: false, settled: false, age: 0, bounces: 0,
      velocity: new Vector3(), spin: new Vector3(), surface: null };
  });
  const dust = createParticles(root, config.particles.dustPool, false, config.particles.pixelScale);
  const sparks = createParticles(root, config.particles.sparkPool, true, config.particles.pixelScale);
  const decals = [];
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const rayHits = [];
  const normalMatrix = new Matrix3();
  const normal = new Vector3();
  const stepDelta = new Vector3();
  const rayDirection = new Vector3();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const velocity = new Vector3();
  const color = new Color();
  const inverse = new Matrix4();
  const orientation = new Euler();
  let casingCursor = 0;
  let flashAge = Infinity;
  let flashGain = 0;
  let elapsed = 0;
  let disposed = false;
  let lightOn = false;
  let shots = 0;
  let impactCount = 0;
  let casingHits = 0;
  let decalEvictions = 0;
  const range = values => MathUtils.lerp(values[0], values[1], random());

  function shot(payload = {}) {
    if (disposed) return;
    shots++;
    flashAge = 0;
    flashGain = 1;
    flashLight.intensity = config.flash.intensity;
    flashSprite.visible = true;
    flashMaterial.opacity = config.flash.spriteOpacity;
    flashMaterial.rotation = random() * Math.PI * 2;
    flashMaterial.map = flashMaps[Math.min(flashMaps.length - 1, Math.floor(random() * flashMaps.length))];
    if (!casings.length) return;
    const slot = casings[casingCursor++ % casings.length];
    nodes.W_Ejection.updateWorldMatrix(true, false);
    nodes.W_Ejection.getWorldPosition(slot.object.position);
    nodes.W_Ejection.getWorldQuaternion(quaternion);
    slot.object.quaternion.copy(quaternion);
    slot.object.rotateX(random() * Math.PI);
    slot.velocity.set(range(config.casing.speed), range(config.casing.up), range(config.casing.forward));
    slot.velocity.applyQuaternion(quaternion);
    if (payload.velocity?.isVector3) slot.velocity.add(payload.velocity);
    slot.spin.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(config.casing.spin);
    slot.active = true; slot.settled = false; slot.age = 0; slot.bounces = 0; slot.surface = null;
    slot.object.visible = true;
  }

  function impact(payload) {
    if (disposed || !payload?.point || !payload?.normal) return;
    impactCount++;
    const surface = payload.surface ?? 'concrete';
    normal.copy(payload.normal).normalize();
    if (normal.lengthSq() < 0.5) normal.copy(UP);
    position.copy(payload.point).addScaledVector(normal, 0.003);
    const particleConfig = config.particles;
    const metal = surface === 'metal';
    const pool = metal ? sparks : dust;
    color.set(metal ? particleConfig.sparkColor : particleConfig.dustColors[surface] ?? particleConfig.dustColors.default);
    const count = metal ? particleConfig.sparksPerHit : particleConfig.dustPerHit;
    for (let i = 0; i < count; i++) {
      velocity.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
      if (velocity.dot(normal) < 0) velocity.negate();
      velocity.addScaledVector(normal, 0.5).normalize().multiplyScalar(range(metal ? particleConfig.sparkSpeed : particleConfig.dustSpeed));
      pool.spawn(position, velocity, color, range(metal ? particleConfig.sparkLife : particleConfig.dustLife),
        (metal ? particleConfig.sparkSize : particleConfig.dustSize) * (0.7 + random() * 0.6));
    }
    // Avoid stale zero-alpha particle attributes in the same rendered frame as the impact.
    pool.update(0, 0, 0);
    const object = payload.object;
    if (!object?.isMesh || !object.geometry?.attributes?.normal || config.decals.pool <= 0) return;
    const decalSurface = DECAL_SURFACES.includes(surface) ? surface : null;
    if (!decalSurface) return;
    object.updateWorldMatrix(true, false);
    quaternion.setFromUnitVectors(DECAL_AXIS, normal);
    quaternion.multiply(new Quaternion().setFromAxisAngle(DECAL_AXIS, random() * Math.PI * 2));
    orientation.setFromQuaternion(quaternion);
    const size = config.decals.size[decalSurface];
    const geometry = new DecalGeometry(object, payload.point, orientation, new Vector3(size, size, config.decals.depth));
    if (geometry.attributes.position.count === 0) { geometry.dispose(); return; }
    // DecalGeometry emits world vertices. Rebase to the hit mesh so moving doors carry their marks.
    geometry.applyMatrix4(inverse.copy(object.matrixWorld).invert());
    const decal = new Mesh(geometry, decalMaterials.get(decalSurface));
    decal.name = `WeaponImpact_${decalSurface}`;
    decal.layers.set(0);
    decal.renderOrder = 2;
    decal.userData.decal = true;
    decal.userData.collidable = false;
    object.add(decal);
    decals.push(decal);
    while (decals.length > config.decals.pool) {
      const oldest = decals.shift(); oldest.removeFromParent(); oldest.geometry.dispose(); decalEvictions++;
    }
  }

  function integrateCasing(slot, dt, colliders) {
    const casingConfig = config.casing;
    slot.velocity.y -= casingConfig.gravity * dt;
    stepDelta.copy(slot.velocity).multiplyScalar(dt);
    const distance = stepDelta.length();
    if (distance < 1e-8) return;
    rayDirection.copy(stepDelta).multiplyScalar(1 / distance);
    raycaster.set(slot.object.position, rayDirection);
    raycaster.near = 0;
    raycaster.far = distance + casingConfig.radius;
    rayHits.length = 0;
    raycaster.intersectObjects(colliders, false, rayHits);
    const hit = rayHits[0];
    if (hit) {
      normal.copy(hit.face?.normal ?? UP).applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
      if (normal.dot(rayDirection) > 0) normal.negate();
      slot.object.position.copy(hit.point).addScaledVector(normal, casingConfig.radius + 0.0002);
      const incoming = Math.max(0, -slot.velocity.dot(normal));
      slot.velocity.addScaledVector(normal, incoming * (1 + casingConfig.restitution));
      const normalSpeed = slot.velocity.dot(normal);
      slot.velocity.addScaledVector(normal, -normalSpeed).multiplyScalar(casingConfig.friction)
        .addScaledVector(normal, normalSpeed);
      slot.spin.multiplyScalar(casingConfig.friction);
      slot.surface = surfaceOfHit(hit) ?? world?.surfaceAt?.(hit.point) ?? 'concrete';
      slot.bounces++;
      if (incoming >= casingConfig.minSoundSpeed) {
        casingHits++;
        emit('casingHit', { surface: slot.surface, position: hit.point.clone(), point: hit.point.clone(),
          speed: incoming, time: elapsed, bounce: slot.bounces });
      }
      if (normal.y > 0.5 && (slot.velocity.length() < casingConfig.settleSpeed || slot.bounces >= casingConfig.maxBounces)) {
        slot.settled = true;
        slot.velocity.set(0, 0, 0);
        // The casing asset's long axis is local Z. Put that axis tangent to the contacted floor.
        slot.object.quaternion.setFromUnitVectors(UP, normal);
        slot.object.rotateY(random() * Math.PI * 2);
      }
    } else slot.object.position.add(stepDelta);
    if (!slot.settled) {
      slot.object.rotateX(slot.spin.x * dt);
      slot.object.rotateY(slot.spin.y * dt);
      slot.object.rotateZ(slot.spin.z * dt);
    }
  }

  function update(dt) {
    if (disposed || !Number.isFinite(dt) || dt < 0) return;
    elapsed += dt;
    flashAge += dt;
    flashGain = flashAge <= config.flash.hold ? 1 : Math.exp(-(flashAge - config.flash.hold) / config.flash.decayTau);
    if (flashGain < config.flash.cutoff) flashGain = 0;
    flashLight.intensity = config.flash.intensity * flashGain;
    flashMaterial.opacity = config.flash.spriteOpacity * flashGain;
    flashSprite.visible = flashGain > 0;
    const colliders = world?.colliders
      ? [world.colliders.static, ...(world.colliders.doors ?? [])].filter(Boolean) : [];
    casings.forEach(slot => {
      if (!slot.active) return;
      slot.age += dt;
      if (slot.age >= config.casing.lifetime) {
        slot.active = false; slot.object.visible = false; return;
      }
      if (slot.settled) return;
      let remaining = Math.min(dt, config.casing.maxFrameStep);
      while (remaining > 1e-8) {
        const step = Math.min(remaining, config.casing.step);
        integrateCasing(slot, step, colliders);
        remaining -= step;
        if (slot.settled) break;
      }
    });
    dust.update(dt, -0.12, config.particles.dustDrag);
    sparks.update(dt, config.particles.sparkGravity, 0.3);
  }

  function light(on) {
    if (disposed) return false;
    lightOn = !!on;
    spot.visible = spill.visible = lightOn;
    return lightOn;
  }

  function stats() {
    const liveCasings = casings.filter(slot => slot.active);
    return {
      time: elapsed, disposed, shots, impacts: impactCount, casingHits, lightOn,
      flash: { age: Number.isFinite(flashAge) ? flashAge : null, gain: flashGain,
        intensity: flashLight.intensity, visible: flashSprite.visible, layer: flashSprite.layers.mask },
      casings: { capacity: casings.length, active: liveCasings.length,
        settled: liveCasings.filter(slot => slot.settled).length,
        positions: liveCasings.map(slot => ({ position: slot.object.position.toArray(),
          settled: slot.settled, surface: slot.surface, age: slot.age, bounces: slot.bounces })) },
      particles: { dust: dust.slots.filter(slot => slot.active).length,
        sparks: sparks.slots.filter(slot => slot.active).length,
        dustCapacity: dust.slots.length, sparkCapacity: sparks.slots.length },
      decals: { active: decals.length, capacity: config.decals.pool, evictions: decalEvictions,
        surfaces: decals.map(decal => decal.name.replace('WeaponImpact_', '')) },
      lights: { flashLayers: flashLight.layers.mask, spotLayers: spot.layers.mask,
        spillLayers: spill.layers.mask, angleDeg: MathUtils.radToDeg(spot.angle),
        penumbra: spot.penumbra, shadowSize: spot.shadow.mapSize.toArray(),
        spillAngleDeg: MathUtils.radToDeg(spill.angle), spillGain: spill.intensity / spot.intensity },
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    lightOn = false;
    flashGain = 0;
    flashLight.intensity = 0;
    flashSprite.visible = spot.visible = spill.visible = false;
    root.removeFromParent();
    for (const object of [flashSprite, flashLight, spot, spill, target]) object.removeFromParent();
    spot.shadow.dispose();
    for (const decal of decals) { decal.removeFromParent(); decal.geometry.dispose(); }
    decals.length = 0;
    casings.forEach(slot => { slot.active = false; slot.object.visible = false; });
    dust.dispose(); sparks.dispose();
    ownedGeometries.forEach(geometry => geometry.dispose());
    ownedMaterials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
  }

  return { shot, impact, light, update, stats, dispose, config, root,
    lights: { flash: flashLight, spot, spill }, flashSprite };
}
