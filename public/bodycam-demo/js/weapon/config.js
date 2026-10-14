// STYLE.md §5–7, §10. Seconds, degrees and metres unless named otherwise.
export const WEAPON_CONFIG = Object.freeze({
  magazineSize: 30,
  initialMagazine: 30,
  initialChamber: 1,
  spareMagazines: 4,
  initialMode: 'semi',
  rpm: 650,
  idleAfter: 6,
  inspectDuration: 4,
  sprintRecoverDuration: 0.18,
  fireDuration: 0.06,
  ads: Object.freeze({ in: 0.28, out: 0.22 }),
  reload: Object.freeze({
    Reload: Object.freeze({ dur: 3.7, magOut: 0.56, magStow: 1.33, magIn: 2.67, settle: 3.62 }),
    ReloadEmpty: Object.freeze({ dur: 2.9, magOut: 0.26, magDrop: 1.28, magIn: 1.66, boltRelease: 2.55 }),
  }),
  recoil: Object.freeze({
    weaponPitch: 2.2, weaponPitchRand: 0.8, weaponYawRand: 0.9, weaponBack: 0.025,
    cameraShare: 0.35, spring: Object.freeze({ omega: 18, zeta: 0.55 }),
  }),
});

export function resolveWeaponConfig(overrides = {}) {
  const result = {
    ...WEAPON_CONFIG, ...overrides,
    ads: { ...WEAPON_CONFIG.ads, ...overrides.ads },
    reload: {
      Reload: { ...WEAPON_CONFIG.reload.Reload, ...overrides.reload?.Reload },
      ReloadEmpty: { ...WEAPON_CONFIG.reload.ReloadEmpty, ...overrides.reload?.ReloadEmpty },
    },
    recoil: {
      ...WEAPON_CONFIG.recoil, ...overrides.recoil,
      spring: { ...WEAPON_CONFIG.recoil.spring, ...overrides.recoil?.spring },
    },
  };
  for (const key of ['magazineSize', 'initialMagazine', 'initialChamber', 'spareMagazines']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) throw new RangeError(`${key} must be a non-negative integer`);
  }
  if (result.magazineSize < 1 || result.initialMagazine > result.magazineSize || result.initialChamber > 1) {
    throw new RangeError('Invalid magazine/chamber capacity');
  }
  if (!['semi', 'auto'].includes(result.initialMode)) throw new RangeError('initialMode must be semi or auto');
  for (const value of [result.rpm, result.idleAfter, result.inspectDuration, result.fireDuration, result.ads.in, result.ads.out]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Weapon rates and durations must be positive');
  }
  if (!Number.isFinite(result.sprintRecoverDuration) || result.sprintRecoverDuration < 0) {
    throw new RangeError('sprintRecoverDuration must be non-negative');
  }
  for (const [kind, markers] of Object.entries(result.reload)) {
    if (!Number.isFinite(markers.dur) || markers.dur <= 0) throw new RangeError(`${kind}.dur must be positive`);
    for (const [key, value] of Object.entries(markers)) {
      if (!Number.isFinite(value) || value < 0 || value > markers.dur) throw new RangeError(`Invalid ${kind}.${key}`);
    }
    if (markers.magOut >= markers.magIn || (kind === 'ReloadEmpty' && markers.magIn >= markers.boltRelease)) {
      throw new RangeError(`${kind} magazine/bolt markers must be in chronological order`);
    }
  }
  return result;
}
