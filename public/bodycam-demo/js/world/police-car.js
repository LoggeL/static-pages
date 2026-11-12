import {
  AdditiveBlending, BoxGeometry, DataTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, Object3D,
  PointLight, SpotLight, Sprite, SpriteMaterial,
} from 'three';

// Car-local space after export: +Z is the front, Y up, metres. Intensities assume the night camera (+2 EV cap).
export const POLICE_CAR_CONFIG = {
  model: 'models/police_suv.glb',
  // Half extents and centre of the player/bullet-free collision box.
  collision: { size: [2.05, 1.75, 5.2], center: [0, 0.875, 0] },
  lightbar: {
    period: 0.56, pulses: 3, duty: 0.55,
    on: 70, off: 0.015, // emissive strength; "on" is far above white so the bar blooms and clips like LEDs do
    red: { color: '#ff1a0d', position: [-0.42, 2.0, 0.05], intensity: 22 },
    blue: { color: '#1436ff', position: [0.42, 2.0, 0.05], intensity: 38 },
    distance: 19,
    // The lights cast no shadows. Inside the house they would shine through the walls, so they fade out there.
    interiorFadeSeconds: 0.35,
  },
  headlights: { emissive: 30, color: '#fff1dc', intensity: 90, distance: 34, angleDeg: 30, penumbra: 0.7,
    position: [0, 0.95, 2.45], target: [0, 0.1, 16] },
  taillights: { emissive: 1.6 },
  glow: { size: 0.55, strength: 1.4 },
};

function softDisc(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    const v = Math.max(0, 1 - r) ** 2.4, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(255 * v); data[i + 3] = 255;
  }
  const texture = new DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = LinearFilter; texture.needsUpdate = true;
  return texture;
}

/** Invisible box in the collision scene, so the player and casings do not pass through the car. */
export function addPoliceCarCollision(collisionSource, anchor, config = POLICE_CAR_CONFIG) {
  if (!collisionSource || !anchor) return null;
  const holder = new Object3D();
  holder.position.copy(anchor.position); holder.rotation.y = anchor.rotationY ?? 0;
  const box = new Mesh(new BoxGeometry(...config.collision.size), new MeshBasicMaterial());
  box.position.fromArray(config.collision.center);
  box.name = 'PoliceCar_collision'; box.userData.surface = 'metal';
  holder.add(box); holder.updateWorldMatrix(true, true);
  // The collision scene may carry its own transform: express the box in its space.
  collisionSource.updateWorldMatrix(true, false);
  box.matrix.copy(collisionSource.matrixWorld).invert().multiply(box.matrixWorld);
  box.matrix.decompose(box.position, box.quaternion, box.scale);
  collisionSource.add(box); box.updateWorldMatrix(true, false);
  return box;
}

/** Parked patrol car with a running light bar. Owns its lights; the caller owns the loaded scene. */
export function createPoliceCar(model, anchor, config = POLICE_CAR_CONFIG) {
  const root = new Group();
  root.name = 'PoliceCar';
  root.position.copy(anchor.position); root.rotation.y = anchor.rotationY ?? 0;
  root.add(model);
  const groups = {}, owned = [];
  model.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true; node.receiveShadow = true;
    node.userData.surface = 'metal';
    for (const material of [node.material].flat()) {
      const match = material.name.match(/^ME_LB_(red|blue)_([AB])$/);
      if (match) { groups[match[1] + match[2]] = material; material.emissive.set(config.lightbar[match[1]].color); }
      else if (material.name === 'ME_LB_white' || material.name === 'ME_spotlight') material.emissiveIntensity = 0;
      else if (material.name === 'ME_headlight') { material.emissive.set(config.headlights.color); material.emissiveIntensity = config.headlights.emissive; }
      else if (material.name === 'ME_taillight') material.emissiveIntensity = config.taillights.emissive;
      else if (material.name === 'M_glass' || material.name === 'M_plastic_clear') { material.transparent = true; material.depthWrite = false; }
    }
  });
  const disc = softDisc(); owned.push(disc);
  const lamps = {};
  for (const name of ['red', 'blue']) {
    const options = config.lightbar[name];
    const light = new PointLight(options.color, 0, config.lightbar.distance, 2);
    light.name = `PoliceLightbar_${name}`; light.position.fromArray(options.position);
    // Lens glare: the bar is a few pixels wide, the camera sees a bloom-sized blob.
    const material = new SpriteMaterial({ map: disc, color: options.color, blending: AdditiveBlending,
      depthWrite: false, transparent: true, fog: false, toneMapped: false });
    owned.push(material);
    const glow = new Sprite(material);
    glow.scale.setScalar(config.glow.size); glow.position.fromArray(options.position); glow.position.y -= 0.12;
    glow.userData.collidable = false;
    root.add(light, glow);
    lamps[name] = { light, glow, material, options };
  }
  const beam = new SpotLight(config.headlights.color, config.headlights.intensity, config.headlights.distance,
    config.headlights.angleDeg * Math.PI / 180, config.headlights.penumbra, 2);
  beam.name = 'PoliceHeadlights'; beam.position.fromArray(config.headlights.position);
  beam.target.position.fromArray(config.headlights.target);
  root.add(beam, beam.target);
  let time = 0, dynamic = true, inside = false, outdoor = 1;
  function update(dt) {
    time += dt;
    outdoor += ((inside ? 0 : 1) - outdoor) * (1 - Math.exp(-dt / Math.max(0.001, config.lightbar.interiorFadeSeconds)));
    const bar = config.lightbar, phase = time % bar.period / bar.period;
    const side = phase < 0.5 ? 'red' : 'blue', within = (phase % 0.5) * 2 * bar.pulses;
    const pulse = Math.floor(within), lit = within - pulse < bar.duty;
    for (const name of ['red', 'blue']) {
      const on = lit && name === side;
      // Alternate the two halves of the bar from flash to flash.
      if (groups[name + 'A']) groups[name + 'A'].emissiveIntensity = on && pulse % 2 === 0 ? bar.on : bar.off;
      if (groups[name + 'B']) groups[name + 'B'].emissiveIntensity = on && pulse % 2 === 1 ? bar.on : bar.off;
      lamps[name].light.intensity = on && dynamic ? lamps[name].options.intensity * outdoor : 0;
      lamps[name].material.opacity = on ? 1 : 0;
      lamps[name].material.color.set(lamps[name].options.color).multiplyScalar(on ? config.glow.strength : 0);
    }
  }
  update(0);
  return {
    root, update, config, lights: { red: lamps.red.light, blue: lamps.blue.light, headlights: beam },
    setViewerInside(value) { inside = !!value; },
    /** Low tiers keep the blinking bar and drop the three dynamic lights. */
    setDynamicLights(enabled) { dynamic = !!enabled; beam.visible = lamps.red.light.visible = lamps.blue.light.visible = dynamic; },
    stats: () => ({ time, dynamic, inside, outdoor, red: lamps.red.light.intensity, blue: lamps.blue.light.intensity, groups: Object.keys(groups).sort() }),
    dispose() { root.removeFromParent(); for (const item of owned) item.dispose(); },
  };
}
