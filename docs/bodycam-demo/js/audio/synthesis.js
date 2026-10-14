// Deterministic, dependency-free substitutes. No prerecorded or synthesized speech.
const TAU = 2 * Math.PI;

function randomFor(text) {
  let state = 2166136261;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619);
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return ((state >>> 0) / 4294967296) * 2 - 1;
  };
}

function lowpass(frequency, sampleRate) {
  const alpha = 1 - Math.exp(-TAU * Math.min(frequency, sampleRate / 2) / sampleRate);
  let state = 0;
  return input => (state += alpha * (input - state));
}

function pinkNoise(random, rows) {
  const values = Float64Array.from({ length: rows }, random);
  let sum = values.reduce((a, b) => a + b, 0);
  let counter = 0;
  return () => {
    counter = (counter + 1) >>> 0;
    let row = 0, count = counter;
    while (!(count & 1) && row < rows - 1) { row++; count >>>= 1; }
    const next = random();
    sum += next - values[row]; values[row] = next;
    return (sum + random()) / (rows + 1);
  };
}

function finish(samples, target, unitRMS, loop, fadeFrames, floor) {
  // Weighted DC removal preserves the zero endpoints of one-shot envelopes.
  let sum = 0, weightSum = 0;
  const weight = i => loop ? 1 : Math.min(1, i / fadeFrames, (samples.length - 1 - i) / fadeFrames);
  for (let i = 0; i < samples.length; i++) {
    const w = weight(i);
    samples[i] *= w; sum += samples[i]; weightSum += w;
  }
  const dc = sum / Math.max(floor, weightSum);
  let peak = 0, energy = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] -= dc * weight(i);
    peak = Math.max(peak, Math.abs(samples[i])); energy += samples[i] ** 2;
  }
  const divisor = unitRMS ? Math.sqrt(energy / samples.length) : peak;
  const gain = (unitRMS ? 1 : target) / Math.max(floor, divisor);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

/** Returns an AudioBuffer at context.sampleRate; no AudioNodes or side effects. */
export function synthesize(context, name, variant = 0, config) {
  const s = config.synth;
  const sr = context.sampleRate;
  const loop = config.loops.includes(name) || name === '__mic_noise';
  const shot = name.includes('_shot_');
  const tail = name.startsWith('rifle_tail_');
  const step = name.startsWith('step_');
  const breath = name.startsWith('breath_');
  const radio = name.startsWith('radio_');
  const profile = s.eventProfiles[name] || [1, 1, 1, 1];
  let duration = s.clickDuration * profile[2];
  if (loop) duration = name === '__mic_noise' ? s.noiseDuration : s.loopDuration;
  else if (shot) duration = s.shotDuration;
  else if (tail) duration = s.tailDuration;
  else if (step) duration = s.stepDuration;
  else if (name === 'ear_ringing') duration = config.tinnitus.duration;
  else if (name === '__handling') duration = s.handlingDuration;
  else if (name === 'door_open_creak') duration = s.creakDuration;
  else if (name === 'siren_distant') duration = s.sirenDuration;
  else if (name === 'dog_bark_distant') duration = s.barkDuration;
  else if (name.includes('_shout')) duration = s.shoutDuration;
  else if (name === 'radio_chatter') duration = s.radioDuration;
  else if (['glass_break', 'bullet_whiz', 'cloth_move'].includes(name)) duration = s.burstDuration;
  const frames = Math.max(2, Math.ceil(sr * duration));
  const overlap = loop ? Math.min(frames >> 1, Math.max(1, Math.round(sr * s.loopCrossfade))) : 0;
  const channels = name.startsWith('ambient_') || name === 'siren_distant' ? 2 : 1;
  const buffer = context.createBuffer(channels, frames, sr);
  const tones = s.stepTones[name.slice(5)] || s.stepTones.concrete;
  const frequency = s.clickHz * profile[0];
  const decay = s.clickDecay * profile[3];
  const pistolPitch = name.startsWith('pistol_') ? s.pistolPitch : 1;

  for (let channel = 0; channel < channels; channel++) {
    const random = randomFor(`${name}:${variant}:${channel}`);
    const pink = pinkNoise(random, s.noiseFloorPinkRows);
    const lpShot = lowpass(s.shotNoiseHz * pistolPitch, sr);
    const lpStep = lowpass(tones[1], sr);
    const lpTail = lowpass(s.tailLowpass, sr);
    const lpClick = lowpass(frequency, sr);
    const lpRadio = lowpass(s.radioLowpass, sr);
    const lpRadioBass = lowpass(s.radioHighpass, sr);
    const lpHandling = lowpass(config.footsteps.handlingLowpass, sr);
    const lpBreath = lowpass(s.breathLowpass, sr);
    const lpRain = lowpass(s.rainLowpass, sr);
    const lpRoom = lowpass(s.roomLowpass, sr);
    const lpNight = lowpass(s.nightLowpass, sr);
    const lpCloth = lowpass(s.clothLowpass, sr);
    const lpDC = lowpass(s.noiseHighpass, sr);
    const data = new Float32Array(frames + overlap);
    const click = (time, noise) => time < 0 ? 0 : Math.exp(-time / decay) *
      (s.clickToneMix * (Math.sin(TAU * frequency * time) +
       s.secondaryToneMix * Math.sin(TAU * frequency * s.secondaryToneRatio * time)) +
       s.clickNoiseMix * profile[1] * noise);

    for (let i = 0; i < data.length; i++) {
      const t = i / sr, n = random();
      let value;
      if (name === '__mic_noise') {
        const p = pink(); value = p - lpDC(p);
      } else if (name === '__handling') {
        const source = n + s.handlingToneMix * Math.sin(TAU * s.handlingToneHz * t);
        value = lpHandling(source) * Math.exp(-t / s.stepDecay);
      } else if (shot) {
        const phase = TAU * s.shotLowHz * pistolPitch *
          (t + s.shotPitchDrop * s.shotDecay * (1 - Math.exp(-t / s.shotDecay)));
        value = (s.shotToneMix * Math.sin(phase) + s.shotNoiseMix * lpShot(n)) * Math.exp(-t / s.shotDecay);
      } else if (tail) {
        value = lpTail(n) * Math.min(1, t / s.tailAttack) * Math.exp(-t / s.tailDecay);
      } else if (step) {
        const noise = lpStep(n);
        const scuffT = Math.max(0, t - s.stepScuffDelay);
        value = (s.stepToneMix * Math.sin(TAU * tones[0] * t) + s.stepNoiseMix * noise) * Math.exp(-t / s.stepDecay);
        if (t > s.stepScuffDelay) value += s.stepScuffMix * noise * Math.exp(-scuffT / s.stepDecay);
      } else if (name === 'ear_ringing') {
        value = Math.min(1, t / config.tinnitus.attack) * Math.exp(-t / s.tinnitusDecay) *
          (Math.sin(TAU * config.tinnitus.frequency * t) + s.tinnitusHarmonic * Math.sin(TAU * config.tinnitus.frequency * 2 * t));
      } else if (name === 'ambient_rain_light') {
        value = lpRain(n);
      } else if (name === 'ambient_house_room_tone') {
        value = lpRoom(pink()) + s.humHarmonicMix * Math.sin(TAU * s.humHz * t);
      } else if (name === 'ambient_night_suburb') {
        value = lpNight(pink());
      } else if (name === 'police_lightbar_hum') {
        value = Math.sin(TAU * s.humHz * t) + s.humHarmonicMix * Math.sin(TAU * s.humHz * 2 * t);
      } else if (breath) {
        const rate = name === 'breath_heavy' ? s.breathRateHeavy : s.breathRateCalm;
        value = lpBreath(n) * (1 - Math.cos(TAU * rate * t)) / 2;
      } else if (radio) {
        const band = lpRadio(n) - lpRadioBass(n);
        const gate = (1 - s.radioGateDepth) + s.radioGateDepth * Math.sin(Math.PI * s.radioModHz * t) ** 2;
        value = band * (name === 'radio_chatter' ? gate : Math.exp(-t / s.clickDecay));
      } else if (name === 'door_open_creak') {
        const phase = TAU * s.creakHz * t + s.creakDepth * s.creakHz / s.creakRate * Math.sin(TAU * s.creakRate * t);
        value = Math.sin(Math.PI * t / duration) * (Math.sin(phase) + s.secondaryToneMix * Math.sin(s.secondaryToneRatio * phase));
      } else if (name === 'siren_distant') {
        const phase = TAU * s.sirenHz * t - s.sirenDepth / s.sirenRate * Math.cos(TAU * s.sirenRate * t);
        value = Math.sin(Math.PI * t / duration) * Math.sin(phase);
      } else if (name === 'dog_bark_distant') {
        value = Math.sin(Math.PI * t / duration) ** 2 * Math.exp(-t / s.stepDecay) *
          (Math.sin(TAU * s.barkHz * t) * Math.sin(TAU * s.barkModHz * t) + lpCloth(n));
      } else if (name.includes('_shout')) {
        // An abstract breath/grunt cue, intentionally no claimed spoken wording.
        value = Math.sin(Math.PI * t / duration) ** 2 * lpBreath(n) * Math.sin(TAU * s.shoutHz * t);
      } else if (name === 'glass_break') {
        value = (n + s.secondaryToneMix * Math.sin(TAU * s.glassHz * t)) * Math.exp(-t / s.glassDecay);
      } else if (name === 'bullet_whiz') {
        value = Math.sin(Math.PI * t / duration) ** 2 *
          (Math.sin(TAU * (s.whizHz * t + s.whizSweep * t * t / (2 * duration))) + s.clickNoiseMix * lpCloth(n));
      } else if (name === 'cloth_move') {
        value = lpCloth(n) * Math.sin(Math.PI * t / duration) ** 2;
      } else {
        const noise = lpClick(n);
        value = click(t, noise) + s.clickSecondMix * click(t - s.clickSecondDelay, noise);
        if (name === 'gear_rattle') {
          // Repeating small impacts contain no low-frequency footfall thump.
          for (let hit = 2; hit * s.clickSecondDelay < duration; hit++) {
            value += s.clickSecondMix ** hit * click(t - hit * s.clickSecondDelay, noise);
          }
        }
      }
      data[i] = value;
    }
    const output = buffer.getChannelData(channel);
    output.set(data.subarray(0, frames));
    for (let i = 0; i < overlap; i++) {
      const w = (1 - Math.cos(Math.PI * i / overlap)) / 2;
      output[i] = data[frames + i] * (1 - w) + data[i] * w;
    }
    finish(output, s.peak, name === '__mic_noise' || name === '__handling', loop,
      Math.max(1, Math.round(sr * s.fadeSeconds)), s.normalizationFloor);
  }
  return buffer;
}
