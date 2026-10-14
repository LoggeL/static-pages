// STYLE.md v1, sections 1–3, 6, 9, 10. Extra technical choices are explicit.
export const POSTFX_DEFAULTS = {
  lens: { enabled: true, k1: 0.06, k2: 0.01, overscan: 1.06, caR: 0.0012, caB: -0.0015,
    mask: { enabled: true, a: 0.5375, b: 0.7335, rimInner: 0.94, rimOuter: 1.05,
      outside: [0.17, 0.19, 0.20], innerVignette: 0.08, outsideBlurPx1080: 8,
      radii: [0.90, 0.94, 0.97, 0.99, 1.01, 1.03, 1.05, 1.08],
      profile: [[1, 1, 1], [0.99, 0.98, 0.97], [0.95, 0.90, 0.81],
        [0.83, 0.69, 0.53], [0.55, 0.41, 0.32], [0.32, 0.26, 0.26], [0.22, 0.22, 0.23]] } },
  osd: { enabled: true, capPx1080: 24, left: [100, 95], rightEdge: 1790,
    color: '#edf0eb', shadow: [3, 3, 0.65], skewDeg: 12, arcDeg: 3,
    textLeft: 'BWC-4 X60A1972 ▶', dateFmt: 'M/D/YYYY', showTime: true, rec: 'REC',
    fontFamily: 'Share Tech Mono', startTime: '2026-10-14T23:14:07', connectedDuration: 1,
    disconnectedDuration: 0, connectedColor: '#50ee72', disconnectedColor: '#ff4040', effectCapPx1080: 24,
    shadowBlurPx1080: 1, connectedText: 'CAM CONNECTED', disconnectedText: 'CAM DISCONNECTED' },
  grade: { saturation: 0.8, warmIndoor: 0.06, toeCrush: 0.012, whiteClip: 0.97,
    highlightsKnee: 0.9, toePower: 1.05 },
  exposure: { enabled: true, tauDarken: 0.9, tauBrighten: 0.35, overshoot: 0.15,
    minEV: -2, maxEV: 4, compensationEV: 0, manualEV: 0, key: 0.18,
    meterSize: 64, readHz: 8, centerWeight: 0.85, centerSigma: 0.32, floorEV: -16, flashHoldSec: 0.08, retrySec: 1 },
  bloom: { enabled: true, strength: 0.16, threshold: 1.0, softKnee: 0.5,
    flashThreshold: 0.35, radius: 1.0 },
  noise: { enabled: true, lumaDark: 2 / 255, lumaMid: 0.8 / 255,
    lumaHigh: 0.3 / 255, chroma: 0.4, rateHz: 30 },
  sharpen: { amount: 0.5, radiusPx1080: 1.2, haloClamp: 0.1 },
  blocks: { enabled: true, sizePx1080: 48, lumaMax: 0.08, minAngVel: 30,
    mix: [0.35, 0.6], holdFrames: [2, 4], rateHz: 60, ringing: 0.012,
    // Display-space safeguards: only average compatible, low-detail current surfaces.
    detailReject: 0.04, historyReject: 0.02, maxDelta: 0.02 },
  motionBlur: { enabled: true, exposureSec: 0.025, maxPx1080: 160, samples: 10,
    depthReject: 0.02, resetGapSec: 0.25, cutDistance: 2, cutAngleDeg: 45 },
  rollingShutter: { enabled: false, readoutSec: 0.018 },
  damage: { durationSec: 0.4, color: [1, 0.25098, 0.25098], shakePx1080: 12,
    dropout: 0.65, saturation: 1.25, shakeHz: 30 },
  shake: { pixels1080: 3, rateHz: 30 },
  glitch: { stripePx1080: 7, stripeRateHz: 30, syncSpeed: 0.7, amount: 0.85 },
  quality: {
    low: { scale: 0.6, samples: 4, msaa: 2, bloomLevels: 2 },
    medium: { scale: 0.8, samples: 8, msaa: 2, bloomLevels: 3 },
    high: { scale: 1, samples: 12, msaa: 4, bloomLevels: 4 },
  },
  debug: { mode: 0, gpuTiming: true },
};

export function mergeParams(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    if (!(key in target) || key === '__proto__' || key === 'constructor') continue;
    if (Array.isArray(target[key])) {
      if (Array.isArray(source[key])) target[key] = structuredClone(source[key]);
    } else if (target[key] && typeof target[key] === 'object') mergeParams(target[key], source[key]);
    else if (typeof target[key] === typeof source[key]) target[key] = source[key];
  }
  return target;
}

export function createParams(overrides) {
  return mergeParams(structuredClone(POSTFX_DEFAULTS), overrides);
}
