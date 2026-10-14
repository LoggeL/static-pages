// Sustained frame samples, as in Bulli Drive; tab gaps never lower quality.
export const QUALITY_CONFIG = Object.freeze({ warmupMs: 3000, windowMs: 3000,
  settleMs: 2000, maxFrameMs: 250, minimumScale: 0.5, scaleStep: 0.125 });
const LEVELS = ['low', 'medium', 'high'];
export function renderTier(rendererName = '', coarse = false) {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererName)
    ? 'software' : coarse ? 'mobile' : 'desktop';
}
export function createQualityController({ tier = 'desktop', mode = 'auto', onChange = () => {}, config = {} } = {}) {
  const c = { ...QUALITY_CONFIG, ...config };
  const maximum = tier === 'desktop' ? 2 : 0;
  let index = mode === 'auto' ? maximum : Math.max(0, LEVELS.indexOf(mode));
  let scale = tier === 'software' && mode === 'auto' ? 0.75 : 1;
  let warmup = c.warmupMs, elapsed = 0, total = 0, frames = 0;
  const snapshot = () => ({ mode, tier, quality: LEVELS[index], scale });
  function reset() { warmup = c.warmupMs; elapsed = total = frames = 0; }
  return {
    snapshot,
    reset,
    setMode(value) {
      if (value !== 'auto' && !LEVELS.includes(value)) throw new RangeError('Invalid graphics mode');
      mode = value; index = value === 'auto' ? maximum : LEVELS.indexOf(value);
      scale = tier === 'software' && mode === 'auto' ? 0.75 : 1;
      reset(); onChange(snapshot());
    },
    sample(ms) {
      if (mode !== 'auto' || !Number.isFinite(ms) || ms <= 0) return;
      if (ms > c.maxFrameMs) { reset(); return; }
      if (warmup > 0) { warmup -= ms; return; }
      elapsed += ms; total += ms; frames++;
      if (elapsed < c.windowMs) return;
      const average = total / frames, previous = `${index}:${scale}`;
      const slow = tier === 'desktop' ? 24 : 38;
      if (average > slow) {
        if (index > 0) index--;
        else scale = Math.max(c.minimumScale, scale - c.scaleStep);
      } else if (average < (tier === 'desktop' ? 17 : 23)) {
        if (scale < 1) scale = Math.min(1, scale + c.scaleStep);
        else if (index < maximum) index++;
      }
      elapsed = total = frames = 0;
      if (`${index}:${scale}` !== previous) { warmup = c.settleMs; onChange(snapshot()); }
    },
  };
}

export function prefersTouch(win = globalThis.window) {
  return !!win?.matchMedia?.('(pointer: coarse)').matches;
}
