// Metres, seconds and bone-local degrees. Technical defaults, artistic tuning stays here.
// Hand bone axes (officer_fp.glb): +Y wrist → knuckles, +Z palm side (thumb and finger curl),
// +X towards the index finger on the right hand and towards the pinky on the left hand.
export const FP_ARMS_CONFIG = {
  model: 'models/officer_fp.glb',
  shoulderOffset: [0, -0.40, -0.43],
  // Left shoulder back and up so the support arm reaches the handguard nearly straight, elbow down.
  shoulderOffsets: { R: [0, -0.16, 0.10], L: [-0.012, 0.022, 0.04] },
  shoulderFollow: { translation: 0.35, rotation: 0.20 },
  poles: { R: [0.55, -0.48, 0.05], L: [-0.30, -0.90, -0.05] },
  // Grip frames relative to W_Grip_*: finger and palm directions, the hand-local palm point
  // that touches the weapon and that point's position in anchor space.
  grips: {
    // Pistol grip: knuckle line along the grip, palm on the right side, index finger on top.
    R: { fingers: [-0.25, 0, -1], palm: [-1, 0, 0.25], contact: [0.004, 0.066, 0.026], anchor: [0, -0.036, 0.016] },
    // Handguard: palm under the rail, fingers wrapping up the right side, thumb along the left.
    L: { fingers: [1, 0.42, -0.08], palm: [-0.42, 1, 0], contact: [0.006, 0.064, 0.034], anchor: [0, 0.028, 0] },
  },
  // Share of the hand's roll around the forearm that the ForeArmTwist bone takes over.
  forearmTwist: 0.55,
  reachEpsilon: 0.000001,
  handBlendSeconds: 0.16,
  fingerBlendSeconds: 0.12,
  reload: { enabled: true, blendSeconds: 0.06, fingerLead: 0.09, dropLifetime: 9, maxDropped: 4 },
  animation: { baseFade: 0.16, additiveFade: 0.06 },
  fingerPoses: {
    open: { Thumb: [[10, 0, 10], [10, 0, 0], [5, 0, 0]],
      Index: [8, 8, 4], Middle: [10, 10, 5], Ring: [12, 12, 6], Pinky: [14, 12, 6] },
    flat: { Thumb: [[-5, 0, 0], [0, 0, 0], [0, 0, 0]],
      Index: [0, 0, 0], Middle: [0, 0, 0], Ring: [0, 0, 0], Pinky: [0, 0, 0] },
    // Left handguard grip: thumb stretched forward along the left side of the rail.
    grip: { Thumb: [[30, 0, -25], [20, 0, 0], [10, 0, 0]],
      Index: [65, 75, 35], Middle: [75, 85, 35], Ring: [80, 85, 35], Pinky: [85, 80, 35] },
    trigger: { Thumb: [[30, 0, 20], [30, 0, 0], [25, 0, 0]],
      Index: [20, 25, 10], Middle: [75, 85, 35], Ring: [80, 85, 35], Pinky: [85, 80, 35] },
    // Magazine body between palm and fingers, thumb on the opposite face.
    mag: { Thumb: [[35, 0, 30], [25, 0, 0], [20, 0, 0]],
      Index: [50, 55, 25], Middle: [55, 60, 25], Ring: [60, 60, 25], Pinky: [65, 60, 25] },
  },
};

export function resolveArmsConfig(overrides = {}) {
  const result = { ...FP_ARMS_CONFIG, ...overrides };
  for (const key of ['shoulderFollow', 'shoulderOffsets', 'poles', 'grips', 'reload', 'animation', 'fingerPoses'])
    result[key] = { ...FP_ARMS_CONFIG[key], ...overrides[key] };
  return result;
}
