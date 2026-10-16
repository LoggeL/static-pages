import { Color, DirectionalLight, FogExp2, Group, HemisphereLight, PointLight } from 'three';
import { fromBlender } from './coordinates.js';
import { LIGHTING_CONFIG } from './lighting-config.js';

export function createLighting(scene, layout, config = LIGHTING_CONFIG, { level = null } = {}) {
  const root = new Group();
  root.name = 'WorldLights';
  const previous = { background: scene.background, fog: scene.fog };
  const fog = level?.fog ?? config.fog;
  scene.background = new Color(config.night?.sky ?? level?.background ?? config.background);
  scene.fog = fog.enabled ? new FogExp2(fog.color, fog.density) : null;
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
  scene.add(root);
  return {
    root, hemisphere, moon, streetlight, porch, config,
    dispose() {
      scene.remove(root);
      moon.shadow.dispose();
      streetlight?.shadow.dispose();
      scene.background = previous.background;
      scene.fog = previous.fog;
    },
  };
}
