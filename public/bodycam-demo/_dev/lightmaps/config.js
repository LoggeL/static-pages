// Neutral test parameters. Final lighting and post-processing belong to integration.
export const VIEWER_CONFIG = {
  camera: { fov: 82, height: 1.40, pitchDeg: -4, near: 0.035, far: 180 },
  renderer: { maxPixelRatio: 1, exposure: 1, maxExposure: 64 },
  movement: { speed: 2.5, fastMultiplier: 3, sensitivity: 0.002 },
  inspectionLight: { color: 0xfff2df, intensity: 12, distance: 18, angleDeg: 30, penumbra: 0.7, decay: 1.4 },
  collision: { color: 0x66e5ff, opacity: 0.38 },
};

// Absolute camera positions, metres, Y-up. Yaw 0 looks toward -Z, positive left.
// Same positions as sources/bodycam-demo/tools/harness/shots/lightmaps.json.
export const CAMERA_PRESETS = [
  { id: 'spawn', label: 'Straße / Spawn', room: 'OUT', pose: [4.6, 1.18, 11, 26, -4] },
  { id: 'porch', label: 'Veranda', room: 'PORCH', pose: [-0.28, 1.97, 1.3, 0, -4] },
  { id: 'hall-long', label: 'Flur längs', room: 'HAL', pose: [-0.28, 2, -1.6, 0, -4] },
  { id: 'hall-cross', label: 'Flur quer', room: 'HAL', pose: [1.05, 2, -4.95, -90, -4] },
  { id: 'living', label: 'Wohnzimmer', room: 'LIV', pose: [-2.05, 2, -3.1, 75, -4] },
  { id: 'kitchen', label: 'Küche', room: 'KIT', pose: [-2.55, 2, -6.3, 22, -4] },
  { id: 'bedroom-1', label: 'Schlafzimmer 1', room: 'BED1', pose: [2.7, 2, -2.6, -85, -4] },
  { id: 'closet', label: 'Einbauschrank', room: 'CLO1', pose: [0.75, 2, -2.55, -90, -4] },
  { id: 'bathroom', label: 'Bad', room: 'BATH', pose: [1.15, 2, -6.85, -90, -4] },
  { id: 'bedroom-2', label: 'Schlafzimmer 2', room: 'BED2', pose: [4.4, 2, -6.8, 0, -4] },
  { id: 'utility', label: 'Waschküche', room: 'UTIL', pose: [1.4, 2, -9, 35, -4] },
];
