import { APP_CONFIG } from './config.js';

/** A failed clip never disables usable recordings. Bound startup network time. */
export function createAudioSource(baseUrl, { synthetic = false } = {}) {
  const manifestUrl = new URL('data/sounds.json', baseUrl).href;
  let mode = synthetic ? 'synthetic' : 'pending', deadline = null;
  const controller = new AbortController(), probes = new Map();
  const finish = () => { clearTimeout(deadline); deadline = null; };
  const fallback = () => {
    mode = 'synthetic'; finish();
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  function signals(options, timeout) {
    return AbortSignal.any([controller.signal, options.signal,
      timeout && AbortSignal.timeout(timeout)].filter(Boolean));
  }
  return {
    get mode() { return mode; },
    finish,
    dispose() { finish(); controller.abort(); probes.clear(); },
    async fetch(url, options = {}) {
      const href = new URL(url, baseUrl).href;
      if (href === manifestUrl) {
        let manifest;
        try {
          const response = await fetch(href, options);
          if (!response.ok) return fallback();
          manifest = await response.json();
          if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') return fallback();
        } catch { return fallback(); }
        const files = [...new Set(Object.values(manifest).flatMap(entry =>
          Array.isArray(entry?.files) ? entry.files.filter(file => typeof file === 'string') : []))];
        if (!synthetic && files.length) {
          deadline = setTimeout(() => controller.abort(), APP_CONFIG.audioLoadBudgetMs);
          const candidates = [...new Set([files[0], files[Math.floor(files.length / 2)], files.at(-1)])];
          const results = await Promise.all(candidates.map(async file => {
            const target = new URL(file, baseUrl).href;
            let response;
            try {
              const loaded = await fetch(target, { ...options, signal: signals(options, APP_CONFIG.audioProbeTimeoutMs) });
              response = new Response(await loaded.arrayBuffer(), { status: loaded.status, headers: loaded.headers });
            }
            catch { response = new Response('', { status: 503 }); }
            // The exact responses, including failures, are consumed once by the engine.
            probes.set(target, response); return response.ok;
          }));
          mode = results.some(Boolean) ? 'recorded' : 'synthetic';
        } else mode = 'synthetic';
        if (mode === 'synthetic') {
          finish(); probes.clear();
          for (const entry of Object.values(manifest)) {
            if (entry && typeof entry === 'object') entry.files = [];
          }
        }
        return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } });
      }
      if (mode === 'synthetic' || controller.signal.aborted) return new Response('', { status: 503 });
      if (probes.has(href)) { const response = probes.get(href); probes.delete(href); return response; }
      return fetch(href, { ...options, signal: signals(options) });
    },
  };
}
