// Metres, seconds and bone-local degrees. Technical defaults, artistic tuning stays here.
export const FP_ARMS_CONFIG = {
  model: 'models/officer_fp.glb',
  shoulderOffset: [0, -0.40, -0.43],
  shoulderOffsets: { R: [0, -0.16, 0.10], L: [0, 0, 0] },
  shoulderFollow: { translation: 0.35, rotation: 0.20 },
  poles: { R: [0.55, -0.48, 0.05], L: [-0.55, -0.48, -0.10] },
  // Columns: finger direction (local Y), back-of-hand (local Z), relative to target.
  handAxes: { R: { fingers: [0, -1, 0], back: [1, 0, 0] },
    L: { fingers: [1, 0, 0], back: [0, -1, 0] } },
  reachEpsilon: 0.000001,
  handBlendSeconds: 0.16,
  fingerBlendSeconds: 0.12,
  reload: { enabled: true, enterSeconds: 0.20, returnSeconds: 0.30 },
  animation: { baseFade: 0.16, additiveFade: 0.06 },
  fingerPoses: {
    open: { Thumb: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      Index: [0, 0, 0], Middle: [0, 0, 0], Ring: [0, 0, 0], Pinky: [0, 0, 0] },
    grip: { Thumb: [[30, 0, 20], [30, 0, 0], [25, 0, 0]],
      Index: [65, 75, 35], Middle: [75, 85, 35], Ring: [80, 85, 35], Pinky: [85, 80, 35] },
    trigger: { Thumb: [[30, 0, 20], [30, 0, 0], [25, 0, 0]],
      Index: [20, 25, 10], Middle: [75, 85, 35], Ring: [80, 85, 35], Pinky: [85, 80, 35] },
  },
};

export function resolveArmsConfig(overrides = {}) {
  const result = { ...FP_ARMS_CONFIG, ...overrides };
  for (const key of ['shoulderFollow', 'shoulderOffsets', 'poles', 'handAxes', 'reload', 'animation', 'fingerPoses'])
    result[key] = { ...FP_ARMS_CONFIG[key], ...overrides[key] };
  return result;
}
