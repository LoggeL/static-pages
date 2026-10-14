// Mono IR for the body-worn microphone. ConvolverNode.normalize must be false.
export function generateImpulse(context, profile, config) {
  const r = config.reverb;
  const sr = context.sampleRate;
  const rt60 = profile.rt60;
  const delay = profile.indoor ? r.preDelay : 0;
  const reflections = profile.indoor ? r.earlyReflections : r.outdoorEchoes;
  const finalEcho = reflections.reduce((max, reflection) => Math.max(max, reflection[0]), 0);
  const length = Math.max(2, Math.ceil(sr * Math.max(delay + rt60, finalEcho + r.noiseAttack)));
  const buffer = context.createBuffer(1, length, sr);
  const samples = buffer.getChannelData(0);
  const alpha = 1 - Math.exp(-2 * Math.PI * Math.min(r.dampingHz, sr / 2) / sr);
  const onset = Math.round(delay * sr);
  let seed = (Math.round(rt60 * 1000000) ^ (profile.indoor ? 0x1eaf : 0xbed)) >>> 0;
  let filtered = 0, energy = 0;
  for (let i = onset; i < length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const random = (seed >>> 0) / 4294967296 * 2 - 1;
    filtered += alpha * (random - filtered);
    const t = (i - onset) / sr;
    // -60 dB amplitude at t = RT60; sample-rate-independent energy follows below.
    samples[i] = filtered * Math.exp(-Math.log(1000) * t / rt60) * Math.min(1, t / r.noiseAttack);
    energy += samples[i] ** 2;
  }
  const normalizeDiffuse = 1 / Math.sqrt(Math.max(config.synth.normalizationFloor, energy));
  for (let i = onset; i < length; i++) samples[i] *= normalizeDiffuse;
  for (const [time, gain] of reflections) {
    const frame = Math.round(time * sr);
    if (frame < length) samples[frame] += gain;
  }
  // L2 energy is bounded independent of RT60 and browser sample rate.
  energy = 0;
  for (let i = 0; i < length; i++) energy += samples[i] ** 2;
  const gain = r.impulseEnergy / Math.sqrt(Math.max(config.synth.normalizationFloor, energy));
  for (let i = 0; i < length; i++) samples[i] *= gain;
  samples[length - 1] = 0;
  return buffer;
}
