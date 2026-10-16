// Neutral night placeholders. These values are deliberately separate from loader code.
// All positions here are Three Y-up; streetlight/porch anchors come from layout.json.
export const LIGHTING_CONFIG = {
  background: '#10151e',
  fog: { enabled: true, color: '#141b26', density: 0.012 },
  hemisphere: { sky: '#b9c8df', ground: '#35302b', intensity: 0.05 },
  moon: {
    color: '#bdcce4', intensity: 0.11, position: [-12, 20, -8],
    target: [0, 0, -3], castShadow: true,
    shadow: { mapSize: 1024, extent: 22, near: 0.5, far: 65, bias: -0.00015, normalBias: 0.025 },
  },
  // Lights only dynamic objects (viewmodel, NPCs); the night exposure sits at +4 EV, so the old 75
  // turned the black rifle gold against the baked street. Matches the lightmapped ground better.
  streetlight: { color: '#ffbd72', intensity: 12, distance: 30, decay: 2, castShadow: false },
  porch: { enabled: false, color: '#ffd7a0', intensity: 8, distance: 7, decay: 2 },
  // Night balance. The camera runs at full gain (+4 EV) everywhere at night, which matches the
  // lamp-lit interior, but the bake's moon and sky came out 10–30× brighter than that interior:
  // the street read as dusk (mean Y 64 against 9–21 in ref_40–42). Until a rebake with a weaker
  // moon, the exterior atlases, the dynamic moon/fill and the sky are scaled down together.
  night: {
    sky: '#0a0c10',
    bakedScale: { 'lightmaps/ext.png': 0.3, 'lightmaps/site.png': 0.3, 'lightmaps/porch.png': 0.3, 'lightmaps/neighbors.png': 0.3 },
  },
  // Light probe for the viewmodel layer (arms, rifle). World lights cannot be occluded for it, so
  // it is lit by what the surroundings actually send towards the camera instead.
  viewmodel: { faceSize: 8, hz: 4, mobileHz: 2, smoothingSeconds: 0.2, gain: 1, near: 0.05, far: 18,
    directGain: 1, minAmbientShare: 0.2, lampFadeSeconds: 0.06,
    // Baked-only lamps, Three Y-up. Intensity = Blender watts / 4π (the street lamp's 130 W gives the
    // hand-tuned 12 above within 15 %); color is the bake's linear RGB.
    lamps: [{ name: 'KitchenBulb', position: [-4.2, 2.615, -6.2], color: [1.0, 0.64, 0.34], intensity: 1.43, radius: 0.075 }] },
};
