export function summarizeFrames(samplesMs) {
  if (!samplesMs.length || samplesMs.some(x => !Number.isFinite(x) || x <= 0)) throw new Error('Keine gültigen rAF-Frame-Abstände.');
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const percentile = fraction => {
    const rank = (sorted.length - 1) * fraction;
    const lower = Math.floor(rank);
    return sorted[lower] + (sorted[Math.ceil(rank)] - sorted[lower]) * (rank - lower);
  };
  const elapsedMs = samplesMs.reduce((a, b) => a + b, 0);
  return {
    fps: samplesMs.length * 1000 / elapsedMs, frames: samplesMs.length, elapsedMs,
    frameTimeMs: {
      min: sorted[0], max: sorted.at(-1), mean: elapsedMs / samplesMs.length,
      p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), p99: percentile(0.99),
    },
    samplesMs,
    method: 'requestAnimationFrame intervals; interpolated percentiles; not GPU render time',
  };
}

export async function measureFrames(page, seconds) {
  if (seconds === 0) return null;
  const samples = await page.evaluate(milliseconds => new Promise((resolve, reject) => {
    let first, previous, frame;
    const samples = [];
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      reject(new Error('rAF-Messung hat zu wenige Frames geliefert.'));
    }, milliseconds + 5000);
    function tick(now) {
      if (first === undefined) first = now;
      if (previous !== undefined && now > previous) samples.push(now - previous);
      previous = now;
      if (now - first >= milliseconds && samples.length >= 2) {
        clearTimeout(timer);
        resolve(samples);
      } else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }), seconds * 1000);
  return summarizeFrames(samples);
}

export async function gpuInfo(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return { webgl2: false, hardware: false, reason: 'WebGL2 hardware context unavailable' };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    const vendor = gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
    const software = /swiftshader|llvmpipe|softpipe|software|lavapipe|microsoft basic render/i.test(renderer);
    const metal = /metal/i.test(renderer);
    const result = { webgl2: true, renderer, vendor, version: gl.getParameter(gl.VERSION), hardware: !!debug && metal && !software, metal };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return result;
  });
}
