import { WEAPON_CONFIG } from './config.js';

const RAD = Math.PI / 180;

// Exact linear spring solution: the result does not depend on frame subdivision.
function advance(x, v, dt, omega, zeta) {
  const a = omega * zeta;
  if (Math.abs(zeta - 1) < 1e-8) {
    const b = v + omega * x;
    const decay = Math.exp(-omega * dt);
    return [(x + b * dt) * decay, (v - omega * b * dt) * decay];
  }
  if (zeta < 1) {
    const b = omega * Math.sqrt(1 - zeta * zeta);
    const sin = Math.sin(b * dt);
    const cos = Math.cos(b * dt);
    const decay = Math.exp(-a * dt);
    return [
      decay * (x * cos + (v + a * x) / b * sin),
      decay * (v * cos - (a * v + omega * omega * x) / b * sin),
    ];
  }
  const d = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = -a + d;
  const r2 = -a - d;
  const c1 = (v - r2 * x) / (r1 - r2);
  const c2 = x - c1;
  const p1 = c1 * Math.exp(r1 * dt);
  const p2 = c2 * Math.exp(r2 * dt);
  return [p1 + p2, r1 * p1 + r2 * p2];
}

// Convert STYLE's angular/linear peak displacement to an initial velocity.
function peakGain(omega, zeta) {
  if (Math.abs(zeta - 1) < 1e-8) return 1 / (omega * Math.E);
  if (zeta < 1) {
    const b = omega * Math.sqrt(1 - zeta * zeta);
    const t = Math.atan2(b, omega * zeta) / b;
    return Math.exp(-omega * zeta * t) * Math.sin(b * t) / b;
  }
  const d = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * zeta + d;
  const r2 = -omega * zeta - d;
  const t = Math.log(r2 / r1) / (r1 - r2);
  return (Math.exp(r1 * t) - Math.exp(r2 * t)) / (r1 - r2);
}

export function createRecoil(config = {}) {
  const c = { ...WEAPON_CONFIG.recoil, ...config };
  const { omega, zeta } = { ...WEAPON_CONFIG.recoil.spring, ...config.spring };
  if (!Number.isFinite(omega) || omega <= 0 || !Number.isFinite(zeta) || zeta < 0) {
    throw new RangeError('Recoil requires omega > 0 and zeta >= 0');
  }
  for (const key of ['weaponPitch', 'weaponPitchRand', 'weaponYawRand', 'weaponBack']) {
    if (!Number.isFinite(c[key]) || c[key] < 0) throw new RangeError(`Invalid recoil ${key}`);
  }
  const gain = peakGain(omega, zeta);
  let position = { pitch: 0, yaw: 0, back: 0 };
  let velocity = { pitch: 0, yaw: 0, back: 0 };

  function state() { return { ...position, velocity: { ...velocity } }; }

  function kick(random = Math.random) {
    const signedRandom = () => {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('random() must return [0,1]');
      return value * 2 - 1;
    };
    const impulse = {
      pitch: (c.weaponPitch + signedRandom() * c.weaponPitchRand) * RAD,
      yaw: signedRandom() * c.weaponYawRand * RAD,
      back: c.weaponBack,
    };
    for (const axis of Object.keys(position)) velocity[axis] += impulse[axis] / gain;
    return impulse;
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Recoil dt must be finite and non-negative');
    for (const axis of Object.keys(position)) {
      [position[axis], velocity[axis]] = advance(position[axis], velocity[axis], dt, omega, zeta);
    }
    return state();
  }

  function reset() {
    position = { pitch: 0, yaw: 0, back: 0 };
    velocity = { pitch: 0, yaw: 0, back: 0 };
  }

  return { kick, update, reset, state };
}
