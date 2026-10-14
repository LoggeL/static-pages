import { APP_CONFIG } from './config.js';
import { runAudioTask } from '../audio/loading.js';

/** A failed clip never disables usable recordings. Bound startup network time. */
export function createAudioSource(baseUrl, { synthetic = false } = {}) {
  const manifestUrl = new URL('data/sounds.json', baseUrl).href;
  let mode = synthetic ? 'synthetic' : 'pending';
  const controller = new AbortController(), probes = new Map();
  // Loading continues lazily during play. A startup deadline must not abort future clips.
  const finish = () => { probes.clear(); };
  const fallback = () => {
    mode = 'synthetic'; finish();
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  function request(href, options, consume, timeoutMs = APP_CONFIG.audioLoadBudgetMs) {
    return runAudioTask(async signal => consume(await fetch(href, { ...options, signal })),
      { signals: [controller.signal, options.signal], timeoutMs });
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
          manifest = await request(href, options, async response => response.ok ? response.json() : null);
          if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') return fallback();
        } catch { return fallback(); }
        const files = [...new Set(Object.values(manifest).flatMap(entry =>
          Array.isArray(entry?.files) ? entry.files.filter(file => typeof file === 'string') : []))];
        if (!synthetic && files.length) {
          const candidates = [...new Set([files[0], files[Math.floor(files.length / 2)], files[files.length - 1]])];
          const results = await Promise.all(candidates.map(async file => {
            const target = new URL(file, baseUrl).href;
            let response;
            try {
              response = await request(target, options, async loaded =>
                new Response(await loaded.arrayBuffer(), { status: loaded.status, headers: loaded.headers }),
              APP_CONFIG.audioProbeTimeoutMs);
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
      return request(href, options, response => response);
    },
  };
}
