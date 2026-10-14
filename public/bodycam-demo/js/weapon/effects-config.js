// Measured timings/colors follow STYLE §5.3/6.1; neutral effect values stay tunable here.
export const WEAPON_EFFECTS_CONFIG = {
  flash: {
    color: '#ffb060', intensity: 2, distance: 8, decay: 2,
    hold: 2 / 60, decayTau: 0.015, cutoff: 0.002,
    size: 0.19, spriteOpacity: 0.95, textureSize: 64, variants: 3,
  },
  casing: {
    pool: 64, lifetime: 30, gravity: 9.81, radius: 0.005,
    speed: [1.8, 2.8], up: [0.7, 1.4], forward: [-0.45, 0.25],
    spin: 22, restitution: 0.34, friction: 0.58,
    settleSpeed: 0.38, maxBounces: 12, minSoundSpeed: 0.22,
    step: 1 / 120, maxFrameStep: 0.15,
  },
  particles: {
    dustPool: 128, sparkPool: 64, dustPerHit: 10, sparksPerHit: 12,
    dustLife: [0.28, 0.65], sparkLife: [0.08, 0.24],
    dustSpeed: [0.15, 0.7], sparkSpeed: [0.8, 2.7],
    dustSize: 0.07, sparkSize: 0.012, dustDrag: 2.8, sparkGravity: 5,
    pixelScale: 420,
    dustColors: { wood: '#9e8665', plaster: '#c5bcb0', concrete: '#969590', default: '#a6a099' },
    sparkColor: '#ffd18c',
  },
  decals: {
    pool: 96, size: { wood: 0.095, plaster: 0.11, metal: 0.065, concrete: 0.09 },
    depth: 0.065, alphaTest: 0.025, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  },
  light: {
    color: '#fff4df', intensity: 2.5, distance: 24, decay: 2,
    angleDeg: 24, penumbra: 0.75, spillAngleDeg: 40, spillGain: 0.04,
    shadowSize: 1024, shadowNear: 0.05, shadowFar: 24,
    shadowBias: -0.00015, shadowNormalBias: 0.015,
  },
};

export function weaponEffectsConfig(overrides = {}) {
  const result = {};
  for (const [name, defaults] of Object.entries(WEAPON_EFFECTS_CONFIG)) {
    result[name] = { ...defaults, ...overrides[name] };
  }
  result.decals.size = { ...WEAPON_EFFECTS_CONFIG.decals.size, ...overrides.decals?.size };
  result.particles.dustColors = { ...WEAPON_EFFECTS_CONFIG.particles.dustColors, ...overrides.particles?.dustColors };
  return result;
}
