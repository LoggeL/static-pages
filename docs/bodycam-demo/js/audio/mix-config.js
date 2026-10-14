// STYLE.md §8/§10. Amplituden linear, Zeiten in Sekunden, Entfernungen in Metern.
// Manifest-gain wird genau einmal angewendet; Werte hier sind zusätzliche Buspegel.
export const MIX_CONFIG = {
  master: {
    volume: 1, hp: 60, lp: 12000, presenceHz: 2500, presenceDb: 3, presenceQ: 1,
    comp: { threshold: -24, ratio: 6, attack: 0.001, release: 0.25, knee: 6 },
    makeupDb: 12, softClipDriveDb: 6, ceilingDb: -0.3, noiseDb: -58,
    smoothSeconds: 0.02,
  },
  buses: { shot: 1, mechanism: 1, foley: 0.08, step: 0.13, ambience: 0.018, radio: 0.08, tinnitus: 0.065 },
  fallbackGains: { shot: 1, mechanism: 1, foley: 0.75, step: 0.5, ambience: 0.25, radio: 0.5, tinnitus: 1 },
  variation: { pitchCents: 45, gainDb: 1.2, shotPitchCents: 25, loopPitchCents: 0 },
  spatial: {
    speedOfSound: 343, referenceDistance: 1, rolloff: 0.7, maxDistance: 350,
    minLowpass: 650, distanceLowpass: 0.012, occlusionGainDb: -18,
    occlusionLowpass: 1000, smoothing: 0.04,
  },
  reverb: {
    indoorRT60: 0.9, outdoorRT60: 2, maxRT60: 6, preDelay: 0.008,
    crossfade: 0.35, send: 0.22, recordedShotSend: 0.045, synthesizedShotSend: 0.65,
    dampingHz: 4800, wetGain: 0.6, impulseEnergy: 0.55, noiseAttack: 0.003,
    earlyReflections: [[0.021, 0.4], [0.047, 0.25], [0.083, 0.12]],
    outdoorEchoes: [[0.27, 0.52], [0.43, 0.31], [0.59, 0.19]],
    tailMinIndoorRT60: 0.95, tailGain: 1,
    // Kopie aus blender/layout.json; setRoom(id, room.reverb) hat innen Vorrang.
    rooms: {
      LIV: { rt60: 0.55 }, KIT: { rt60: 0.8 }, HAL: { rt60: 0.65 }, BED1: { rt60: 0.75 },
      CLO1: { rt60: 0.25 }, BATH: { rt60: 1 }, BED2: { rt60: 0.5 }, UTIL: { rt60: 0.9 },
      PORCH: { indoor: false, rt60: 2 }, OUT: { indoor: false, rt60: 2 },
    },
  },
  ambience: {
    stereoWidth: 0.2, crossfade: 0.65, indoorLeak: 0.12, rainIndoor: 0.16,
    outdoorLevel: 1, indoorLevel: 2, rainLevel: 0.65,
    duckGain: 0.16, duckAttack: 0.004, duckHold: 0.06, duckRelease: 0.65,
    lightbarGain: 0.24,
  },
  tinnitus: {
    frequency: 4078, duration: 7, attack: 0.04, cooldown: 1.5,
    nearDistance: 5, minStrength: 0.3, hearingGain: 0.68, hearingRecovery: 1.5, fadeOut: 1.5,
    // Vorhandener Clip ist laut SOUNDS-Manifest ca. 7,5 kHz; STYLE verlangt 4078 Hz.
    recordedFrequency: 7500,
  },
  scheduler: { radioInterval: [40, 90], sirenPause: [45, 100], sirenInitial: [12, 30] },
  footsteps: {
    referenceSpeed: 1.5, minGain: 0.35, maxGain: 1.4, gearGain: 1,
    handlingDb: -30, handlingLowpass: 150,
    surfaces: { concrete: 'concrete', wood: 'wood', carpet: 'carpet', tile: 'tile', grass: 'grass',
      asphalt: 'asphalt', metal: 'tile', plaster: 'concrete', glass: 'tile', dirt: 'grass',
      fabric: 'carpet', cardboard: 'wood', flesh: 'carpet' },
  },
  loading: { concurrency: 4, timeoutMs: 8000 },
  limits: { voices: 96, history: 300, fallbackBuffers: 160 },
  synth: {
    peak: 0.89, loopCrossfade: 0.08, normalizationFloor: 1e-8, noiseHighpass: 24,
    tailDecay: 0.29, tailLowpass: 1600, shotToneMix: 0.8, shotNoiseMix: 0.6,
    shotPitchDrop: 2.2, pistolPitch: 1.6, stepToneMix: 0.72, stepNoiseMix: 0.35,
    stepScuffDelay: 0.085, stepScuffMix: 0.25, clickToneMix: 0.72, clickNoiseMix: 0.4,
    clickSecondDelay: 0.04, clickSecondMix: 0.35, creakDuration: 0.9, creakHz: 210,
    creakRate: 7, creakDepth: 0.09, burstDuration: 0.7,
    sirenDuration: 6, sirenHz: 700, sirenDepth: 190, sirenRate: 0.5,
    barkDuration: 0.65, barkHz: 185, barkModHz: 37, shoutDuration: 0.9, shoutHz: 240,
    breathRateCalm: 0.25, breathRateHeavy: 0.5, breathLowpass: 1400,
    rainLowpass: 8000, roomLowpass: 450, nightLowpass: 1300,
    handlingDuration: 0.18, handlingToneHz: 65, handlingToneMix: 0.25,
    humHarmonicMix: 0.2, radioLowpass: 2800, radioHighpass: 400, radioModHz: 4.5,
    tinnitusHarmonic: 0.025, tinnitusDecay: 2.1, secondaryToneRatio: 1.47,
    secondaryToneMix: 0.18, clothLowpass: 950, whizHz: 1100, whizSweep: 2400,
    glassHz: 4500, glassDecay: 0.22, radioGateDepth: 0.7, noiseFloorPinkRows: 12,
    // Frequenz-, Rausch-, Dauer-, Abklingfaktor je prozeduralem Klang.
    eventProfiles: {
      rifle_mech: [1.1, 0.5, 1.2, 1], dry_fire: [1.2, 0.35, 0.7, 0.65],
      mag_out: [0.65, 0.8, 1.8, 1.5], mag_in: [0.85, 0.6, 1.4, 1], mag_drop: [0.6, 0.9, 2, 2.1],
      bolt_release: [1.4, 0.8, 1.4, 1.1], charging_handle: [0.8, 1, 2, 1.6],
      selector: [1.6, 0.25, 0.55, 0.5], light_click: [1.3, 0.2, 0.6, 0.5],
      casing_concrete: [2.8, 0.15, 1.5, 2.3], casing_wood: [1.5, 0.4, 1.2, 1.2],
      gear_rattle: [1.7, 0.5, 1.6, 0.8], impact_wood: [0.17, 0.8, 1.8, 1.4],
      impact_plaster: [0.3, 1.5, 1.6, 1], impact_concrete: [0.55, 1, 1.5, 1],
      impact_metal: [2.3, 0.15, 2.8, 4], impact_glass: [3.8, 0.6, 2.5, 2.5],
      impact_flesh: [0.055, 0.8, 1.8, 2], door_kick: [0.06, 1, 3, 3],
      door_close: [0.09, 0.7, 2.5, 2], body_fall: [0.045, 1, 3.4, 4],
    },
    variants: 5, loopDuration: 4, fadeSeconds: 0.003,
    shotDuration: 0.45, shotDecay: 0.045, shotLowHz: 110, shotNoiseHz: 2400,
    tailDuration: 2, tailAttack: 0.025, stepDuration: 0.27, stepDecay: 0.052,
    clickDuration: 0.16, clickDecay: 0.018, clickHz: 1700, noiseDuration: 4,
    humHz: 90, radioDuration: 2.4,
    stepTones: { concrete: [130, 1600], wood: [95, 950], carpet: [75, 280],
      tile: [180, 2500], grass: [65, 3700], asphalt: [115, 1800] },
  },
  // Auch ein fehlendes Manifest bleibt spielbar. Kein Pfad wird hier erfunden.
  defaults: {
    rifle_shot_indoor: 1, rifle_shot_outdoor: 1, rifle_tail_indoor: 1, rifle_tail_outdoor: 1,
    rifle_mech: 0.25, pistol_shot_indoor: 0.9, pistol_shot_distant: 0.6,
    dry_fire: 0.6, mag_out: 0.6, mag_in: 0.7, mag_drop: 0.6, bolt_release: 0.7,
    charging_handle: 0.7, selector: 0.4, light_click: 0.4, casing_concrete: 0.35, casing_wood: 0.35,
    step_concrete: 0.45, step_wood: 0.5, step_carpet: 0.35, step_tile: 0.45, step_grass: 0.4, step_asphalt: 0.45,
    gear_rattle: 0.25, cloth_move: 0.3, breath_calm: 0.25, breath_heavy: 0.35,
    door_open_creak: 0.6, door_kick: 0.9, door_close: 0.6, impact_wood: 0.6, impact_plaster: 0.55,
    impact_concrete: 0.6, impact_metal: 0.6, impact_glass: 0.6, impact_flesh: 0.55,
    glass_break: 0.7, bullet_whiz: 0.6, radio_chatter: 0.45, radio_squelch: 0.4,
    ambient_night_suburb: 0.5, ambient_rain_light: 0.45, ambient_house_room_tone: 0.5,
    siren_distant: 0.35, dog_bark_distant: 0.3, police_lightbar_hum: 0.3,
    suspect_shout: 0.8, officer_shout_police: 0.9, body_fall: 0.7, ear_ringing: 0.25,
  },
  loops: ['ambient_night_suburb', 'ambient_rain_light', 'ambient_house_room_tone',
    'police_lightbar_hum', 'breath_calm', 'breath_heavy'],
};

export const dbToGain = db => 10 ** (db / 20);

export function makeMixConfig(overrides = {}) {
  const merge = (base, patch) => Object.fromEntries(Object.entries({ ...base, ...patch }).map(([k, v]) =>
    [k, v && typeof v === 'object' && !Array.isArray(v) ? merge(base?.[k] || {}, patch?.[k] || {}) : v]));
  return merge(MIX_CONFIG, overrides);
}
