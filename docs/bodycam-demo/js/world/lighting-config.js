// Neutral night placeholders. These values are deliberately separate from loader code.
// All positions here are Three Y-up; streetlight/porch anchors come from layout.json.
export const LIGHTING_CONFIG = {
  background: '#10151e',
  fog: { enabled: true, color: '#141b26', density: 0.012 },
  hemisphere: { sky: '#b9c8df', ground: '#35302b', intensity: 0.16 },
  moon: {
    color: '#bdcce4', intensity: 0.35, position: [-12, 20, -8],
    target: [0, 0, -3], castShadow: true,
    shadow: { mapSize: 1024, extent: 22, near: 0.5, far: 65, bias: -0.00015, normalBias: 0.025 },
  },
  // Lights only dynamic objects (viewmodel, NPCs); the night exposure sits at +4 EV, so the old 75
  // turned the black rifle gold against the baked street. Matches the lightmapped ground better.
  streetlight: { color: '#ffbd72', intensity: 12, distance: 30, decay: 2, castShadow: false },
  porch: { enabled: false, color: '#ffd7a0', intensity: 8, distance: 7, decay: 2 },
};
