export const NPC_STATES = Object.freeze(['idle', 'alert', 'flee', 'hide', 'aim', 'fire', 'surrender', 'hit', 'dead']);

// Technische Setzungen, keine Persönlichkeit oder Inszenierung. Meter, Sekunden, Grad.
export const NPC_CONFIG = {
  maxNPCs: 3,
  model: { url: null, fallbackUrl: 'models/officer.glb', placeholderYaw: Math.PI },
  spawnYawOffsetDeg: 180, // Layout-Yaw blickt nach -Z; der NPC-Vertrag verlangt +Z.
  spawnProjection: { enabled: true, maxDistance: 2.5 },
  navigation: { radius: 0.24, height: 1.75, speed: 1.25, runSpeed: 2.0,
    arrivalDistance: 0.025, maxSubstepSeconds: 1 / 60, allowDoorPush: true,
    unlatchDoors: true, doorPushStrength: 120, doorPushDistance: 1.2,
    replanSeconds: 0.8, stuckSeconds: 6 },
  perception: { range: 18, fovDeg: 100, intervalSeconds: 0.1,
    sightMargin: 0.02, memorySeconds: 8,
    hearing: { shotRange: 30, stepRange: 7, threshold: 0.08,
      referenceDistance: 1, sameRoomGain: 1, openRoomGain: 0.7,
      closedDoorGain: 0.25, wallGain: 0.12, maxRoomHops: 4, maxEvents: 64 } },
  health: { initial: 100, rifleDamage: 40, defaultDamage: 20,
    zoneMultipliers: { head: 2.5, torso: 1, arms: 0.65, legs: 0.65 } },
  shooting: { enabled: false, range: 80, spreadDeg: 1.5, damage: 20,
    cooldownSeconds: 0.5, aimDirection: 'target', socketForward: [0, 0, 1],
    playerRadius: 0.30, playerHeight: 1.80 },
  animation: { fadeSeconds: 0.12 },
  hitZones: {},
  states: {
    idle: { clip: 'Idle', duration: null },
    alert: { clip: 'IdleNervous', duration: null },
    flee: { clip: 'Run', duration: null },
    hide: { clip: 'Crouch', duration: null },
    aim: { clip: 'AimPistol', duration: null },
    fire: { clip: 'FirePistol', duration: 0.1 },
    surrender: { clip: 'Idle', duration: null },
    hit: { clip: 'HitReact', duration: 0.25 },
    dead: { clip: 'DeathBackward', duration: null },
  },
  transitions: {
    idle: { sight: 'alert', sound: 'alert' },
    alert: { lost: 'idle' },
    flee: { arrived: 'hide' },
    hide: { sight: 'alert' },
    aim: { lost: 'alert' },
    fire: { complete: 'aim' },
    surrender: {}, hit: { complete: 'previous' }, dead: {},
  },
  hooks: { decideTransition: null, beforeTransition: null, onTransition: null,
    onEnter: null, onExit: null, onUpdate: null, onSight: null, onHear: null,
    onHit: null, onShot: null, onPlayerDamage: null, onError: null },
  debug: { enabled: false, pathColor: 0x39d8b1, coneColor: 0xd1b348,
    zoneColor: 0x7bbcff, fontSize: 12, coneSegments: 20, showZones: false },
};

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function mergeNPCConfig(base = NPC_CONFIG, overrides = {}) {
  const result = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(overrides)])) {
    const value = Object.hasOwn(overrides, key) ? overrides[key] : base[key];
    result[key] = plain(value) ? mergeNPCConfig(plain(base[key]) ? base[key] : {}, value)
      : Array.isArray(value) ? value.map(item => plain(item) ? mergeNPCConfig(item, {}) : item) : value;
  }
  return result;
}

export function validateNPCConfig(config) {
  const positive = (value, label, zero = false) => {
    if (!Number.isFinite(value) || value < 0 || (!zero && value === 0))
      throw new RangeError(`NPC ${label}: ${zero ? 'nonnegative' : 'positive'} finite number required`);
  };
  if (!Number.isInteger(config.maxNPCs) || config.maxNPCs < 0 || config.maxNPCs > 32)
    throw new RangeError('NPC maxNPCs: 0..32');
  for (const key of ['radius', 'height', 'speed', 'runSpeed', 'arrivalDistance', 'maxSubstepSeconds', 'replanSeconds', 'stuckSeconds'])
    positive(config.navigation[key], `navigation.${key}`);
  if (config.navigation.height < 2 * config.navigation.radius) throw new RangeError('NPC capsule height < diameter');
  for (const key of ['range', 'intervalSeconds', 'memorySeconds']) positive(config.perception[key], `perception.${key}`);
  positive(config.spawnProjection.maxDistance, 'spawnProjection.maxDistance', true);
  if (!Number.isFinite(config.spawnYawOffsetDeg)) throw new RangeError('NPC spawnYawOffsetDeg must be finite');
  if (!(config.perception.fovDeg > 0 && config.perception.fovDeg <= 360)) throw new RangeError('NPC fovDeg: 0..360');
  for (const key of ['range', 'damage', 'cooldownSeconds']) positive(config.shooting[key], `shooting.${key}`);
  positive(config.shooting.spreadDeg, 'shooting.spreadDeg', true);
  if (config.shooting.spreadDeg >= 90) throw new RangeError('NPC spreadDeg must be < 90');
  positive(config.health.initial, 'health.initial');
  for (const key of ['rifleDamage', 'defaultDamage']) positive(config.health[key], `health.${key}`, true);
  for (const [zone, multiplier] of Object.entries(config.health.zoneMultipliers)) positive(multiplier, `health.${zone}`, true);
  for (const key of ['shotRange', 'stepRange', 'referenceDistance']) positive(config.perception.hearing[key], `hearing.${key}`);
  for (const key of ['threshold', 'sameRoomGain', 'openRoomGain', 'closedDoorGain', 'wallGain']) positive(config.perception.hearing[key], `hearing.${key}`, true);
  if (!Number.isInteger(config.perception.hearing.maxEvents) || config.perception.hearing.maxEvents < 1
    || config.perception.hearing.maxEvents > 1024) throw new RangeError('NPC hearing.maxEvents: 1..1024');
  if (!Number.isInteger(config.perception.hearing.maxRoomHops) || config.perception.hearing.maxRoomHops < 0
    || config.perception.hearing.maxRoomHops > 32) throw new RangeError('NPC hearing.maxRoomHops: 0..32');
  if (!['target', 'socket'].includes(config.shooting.aimDirection)) throw new RangeError('NPC aimDirection: target|socket');
  if (!Array.isArray(config.shooting.socketForward) || config.shooting.socketForward.length !== 3
    || !config.shooting.socketForward.every(Number.isFinite) || !config.shooting.socketForward.some(value => value !== 0))
    throw new RangeError('NPC socketForward requires a nonzero finite vector');
  if (!Number.isInteger(config.debug.coneSegments) || config.debug.coneSegments < 2 || config.debug.coneSegments > 256)
    throw new RangeError('NPC debug.coneSegments: 2..256');
  for (const state of NPC_STATES) {
    const duration = config.states[state]?.duration;
    if (duration !== null && duration !== undefined) positive(duration, `states.${state}.duration`);
    for (const target of Object.values(config.transitions[state] ?? {})) {
      if (target !== null && target !== 'previous' && !NPC_STATES.includes(target))
        throw new RangeError(`NPC invalid transition target: ${target}`);
    }
  }
  return config;
}
