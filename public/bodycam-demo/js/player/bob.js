// Exact BODYCAM_STYLE.bob values (STYLE.md §10). Angles here are degrees.
export const BOB_CONFIG = Object.freeze({
  walk: Object.freeze({ stepHz: 1.8, pitch: 2.4, yaw: 3.5, roll: 1.8, posY: 0.015 }),
  sneak: Object.freeze({ stepHz: 1.3, pitch: 1.6, yaw: 2.2, roll: 1.2, posY: 0.01 }),
  sprint: Object.freeze({ stepHz: 2.6, pitch: 4.0, yaw: 6.0, roll: 3.0, posY: 0.03 }),
});

// Timing/interpolation choices are separate from the measured profile values.
export const BOB_TUNING = Object.freeze({
  sneakSpeed: 1.0,
  walkSpeed: 1.5,
  sprintSpeed: 4.5,
  stopSpeed: 0.03,
  responseSeconds: 0.12,
  settleSeconds: 0.18,
  adsScale: 1.0,
  sprintNoiseDeg: 1.0,
  noiseBaseHz: 0.8,
  noiseOctaves: 4,
  noiseSeed: 27,
});

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const FIELDS = ['pitch', 'yaw', 'roll', 'posY'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;

function hash(index, seed) {
  let value = Math.imul(index ^ seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}

function valueNoise(time, seed) {
  const index = Math.floor(time);
  const t = time - index;
  const smooth = t * t * (3 - 2 * t);
  return mix(hash(index, seed), hash(index + 1, seed), smooth);
}

function pinkNoise(time, seed, octaves) {
  // Equal power per octave approximates bounded 1/f motion, independent of FPS.
  let sum = 0;
  for (let i = 0; i < octaves; i++) sum += valueNoise(time * 2 ** i, seed + i * 1013);
  return sum / octaves;
}

/**
 * createBob({ walk: { pitch: 2.4 }, ...BOB_TUNING }) permits partial overrides.
 * update(dt, { speed, grounded, crouched, sprinting, ads }) returns additive
 * { pitch, yaw, roll, y, steps }: radians, metres, and an integer step count.
 * speed is actual horizontal speed in m/s. ads accepts a boolean or 0..1.
 * A full pitch cycle is one footstep; yaw/roll take two steps per cycle.
 */
export function createBob(config = {}) {
  const tuning = { ...BOB_TUNING, ...config };
  const profiles = {};
  for (const name of ['walk', 'sneak', 'sprint']) {
    profiles[name] = { ...BOB_CONFIG[name], ...config[name] };
    for (const field of ['stepHz', ...FIELDS]) {
      const value = profiles[name][field];
      if (!Number.isFinite(value) || value < 0 || (field === 'stepHz' && value === 0)) {
        throw new RangeError(`Invalid bob parameter ${name}.${field}.`);
      }
    }
  }
  for (const name of Object.keys(BOB_TUNING)) {
    if (!Number.isFinite(tuning[name]) || tuning[name] < 0) {
      throw new RangeError(`Invalid bob parameter ${name}.`);
    }
  }
  if (!(tuning.sneakSpeed > 0 && tuning.walkSpeed > tuning.sneakSpeed
    && tuning.sprintSpeed > tuning.walkSpeed && tuning.stopSpeed < tuning.sneakSpeed)) {
    throw new RangeError('Bob speed anchors must be positive and ascending.');
  }
  if (!Number.isInteger(tuning.noiseOctaves) || tuning.noiseOctaves < 1 || tuning.noiseOctaves > 8) {
    throw new RangeError('Bob noiseOctaves must be an integer from 1 to 8.');
  }

  let phase = 0; // Wrapped over two steps, preserving the half-frequency wave.
  let noiseTime = 0;
  let noiseAmount = 0;
  const amplitude = { pitch: 0, yaw: 0, roll: 0, posY: 0 };

  function selectProfile(speed, crouched, sprinting) {
    let from = profiles.sneak;
    let to = profiles.sneak;
    let blend = 0;
    let sprintBlend = 0;
    if (!crouched && speed > tuning.sneakSpeed) {
      from = profiles.sneak;
      to = profiles.walk;
      blend = clamp((speed - tuning.sneakSpeed) / (tuning.walkSpeed - tuning.sneakSpeed), 0, 1);
      if (sprinting && speed > tuning.walkSpeed) {
        from = profiles.walk;
        to = profiles.sprint;
        blend = clamp((speed - tuning.walkSpeed) / (tuning.sprintSpeed - tuning.walkSpeed), 0, 1);
        sprintBlend = blend;
      }
    }
    const speedScale = clamp(speed / tuning.sneakSpeed, 0, 1);
    const profile = { stepHz: mix(from.stepHz, to.stepHz, blend) * speedScale, sprintBlend };
    for (const field of FIELDS) profile[field] = mix(from[field], to[field], blend) * speedScale;
    return profile;
  }

  function output(steps) {
    const noise = noiseTime * tuning.noiseBaseHz;
    const jitter = (offset) => noiseAmount * pinkNoise(noise, tuning.noiseSeed + offset, tuning.noiseOctaves);
    return {
      pitch: (Math.sin(phase * TAU) * amplitude.pitch + jitter(0)) * RAD,
      yaw: (Math.sin(phase * Math.PI) * amplitude.yaw + jitter(10007)) * RAD,
      roll: (Math.sin(phase * Math.PI) * amplitude.roll + jitter(20011)) * RAD,
      y: -Math.cos(phase * TAU) * amplitude.posY,
      steps,
    };
  }

  return {
    update(dt, { speed = 0, grounded = true, crouched = false, sprinting = false, ads = false } = {}) {
      dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      if (dt === 0) return output(0);
      speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
      const moving = grounded && speed > tuning.stopSpeed;
      const profile = selectProfile(speed, crouched, sprinting);
      const adsAmount = typeof ads === 'boolean' ? Number(ads) : (Number.isFinite(ads) ? clamp(ads, 0, 1) : 0);
      const scale = moving ? mix(1, tuning.adsScale, adsAmount) : 0;
      const response = moving ? tuning.responseSeconds : tuning.settleSeconds;
      const ease = response > 0 ? -Math.expm1(-dt / response) : 1;
      for (const field of FIELDS) amplitude[field] = mix(amplitude[field], profile[field] * scale, ease);
      noiseAmount = mix(noiseAmount, tuning.sprintNoiseDeg * profile.sprintBlend * scale, ease);

      let steps = 0;
      if (moving) {
        const nextPhase = phase + profile.stepHz * dt;
        // Tolerance prevents one-frame delays at exact cycle boundaries.
        steps = Math.floor(nextPhase + 1e-10) - Math.floor(phase + 1e-10);
        phase = nextPhase % 2;
        noiseTime += dt;
      }
      return output(steps);
    },
    reset() {
      phase = 0;
      noiseTime = 0;
      noiseAmount = 0;
      for (const field of FIELDS) amplitude[field] = 0;
    },
  };
}
