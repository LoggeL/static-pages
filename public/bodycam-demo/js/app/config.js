// Technical defaults; visual parameters remain in the owning C3/C5/C12 modules.
export const APP_CONFIG = {
  camera: { fov: 82, near: 0.01, far: 160 },
  maxPixelRatio: 1,
  maxFrameSeconds: 0.1,
  measurementFrames: 240,
  fallbackExposure: 1,
  subtitleMs: 4000,
  assetTimeoutMs: 15000,
  audioProbeTimeoutMs: 1800,
  audioLoadBudgetMs: 10000,
  fallback: { color: 0x30343a, light: 0.8, groundSize: 40, cameraHeight: 1.4 },
  // End sequences: the body cam drops sideways to the floor and disconnects; a cleared house holds briefly.
  end: { deadSeconds: 2.6, clearedSeconds: 3.5, fall: { seconds: 0.9, drop: 1.05, rollDeg: 68, pitchDeg: 18 } },
};
