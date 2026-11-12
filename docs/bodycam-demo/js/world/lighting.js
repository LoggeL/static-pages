import {
  AdditiveBlending, Color, DataTexture, DirectionalLight, FogExp2, Group, HemisphereLight, LinearFilter, PointLight,
  Sprite, SpriteMaterial,
} from 'three';
import { fromBlender } from './coordinates.js';
import { LIGHTING_CONFIG } from './lighting-config.js';

export function createLighting(scene, layout, config = LIGHTING_CONFIG, { level = null } = {}) {
  const root = new Group();
  root.name = 'WorldLights';
  let glowMap = null;
  const previous = { background: scene.background, fog: scene.fog };
  const fog = level?.fog ?? config.fog;
  scene.background = new Color(config.night?.sky ?? level?.background ?? config.background);
  scene.fog = fog.enabled ? new FogExp2(config.night?.fog ?? fog.color, fog.density) : null;
  const hemisphere = new HemisphereLight(config.hemisphere.sky, config.hemisphere.ground, config.hemisphere.intensity);
  hemisphere.name = 'NightFill';
  root.add(hemisphere);
  const moon = new DirectionalLight(config.moon.color, config.moon.intensity);
  moon.name = 'Moon';
  moon.position.fromArray(config.moon.position);
  moon.target.position.fromArray(config.moon.target);
  moon.castShadow = config.moon.castShadow;
  const shadow = config.moon.shadow;
  moon.shadow.mapSize.setScalar(shadow.mapSize);
  Object.assign(moon.shadow.camera, {
    left: -shadow.extent, right: shadow.extent, top: shadow.extent, bottom: -shadow.extent,
    near: shadow.near, far: shadow.far,
  });
  moon.shadow.bias = shadow.bias;
  moon.shadow.normalBias = shadow.normalBias;
  moon.shadow.camera.updateProjectionMatrix();
  root.add(moon, moon.target);
  let streetlight = null;
  if (layout.lights?.streetlight) {
    const options = config.streetlight;
    streetlight = new PointLight(options.color, options.intensity, options.distance, options.decay);
    streetlight.name = 'Streetlight';
    fromBlender(layout.lights.streetlight.pos, streetlight.position);
    streetlight.castShadow = options.castShadow;
    root.add(streetlight);
    if (options.glow) {
      // The lamp head itself: far above white, so the lens blooms around it like around any bare source at night.
      const size = 64, data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1), i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.round(255 * Math.max(0, 1 - r) ** 2.4); data[i + 3] = 255;
      }
      glowMap = new DataTexture(data, size, size); glowMap.magFilter = glowMap.minFilter = LinearFilter; glowMap.needsUpdate = true;
      const material = new SpriteMaterial({ map: glowMap, color: new Color(options.color).multiplyScalar(options.glow.strength),
        blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
      const glow = new Sprite(material);
      glow.name = 'StreetlightGlow'; glow.scale.setScalar(options.glow.size); glow.userData.collidable = false;
      glow.position.copy(streetlight.position);
      root.add(glow);
    }
  }
  let porch = null;
  if (config.porch.enabled && layout.lights?.porchLight) {
    const options = config.porch;
    porch = new PointLight(options.color, options.intensity, options.distance, options.decay);
    porch.name = 'PorchLight';
    fromBlender(layout.lights.porchLight.pos, porch.position);
    root.add(porch);
  }
  // The existing values still light the viewmodel and unbaked moving leaves.
  // Lightmap materials exclude just these sources; dynamic light remains additive.
  if (level) root.traverse(object => { if (object.isLight) object.userData.bakedSource = true; });
  // The bake's street lamp is scaled down with the moon (night.bakedScale); the pool under it is lit live instead.
  if (streetlight && config.streetlight.dynamic) streetlight.userData.bakedSource = false;
  scene.add(root);
  return {
    root, hemisphere, moon, streetlight, porch, config,
    dispose() {
      scene.remove(root);
      moon.shadow.dispose();
      streetlight?.shadow.dispose();
      glowMap?.dispose();
      scene.background = previous.background;
      scene.fog = previous.fog;
    },
  };
}
