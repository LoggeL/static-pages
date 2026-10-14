import { APP_CONFIG } from './config.js';

/** Probe one manifest sample before preloading a gitignored directory.
 * A missing probe selects synthesis for this session, avoiding 198 known 404s.
 * In recorded mode individual missing files still use the C4 negative cache.
 */
export function createAudioSource(baseUrl, { synthetic = false } = {}) {
  const manifestUrl = new URL('data/sounds.json', baseUrl).href;
  let mode = synthetic ? 'synthetic' : 'pending';
  let probeUrl = null, probeResponse = null;
  return {
    get mode() { return mode; },
    async fetch(url, options = {}) {
      const href = new URL(url, baseUrl).href;
      if (href === manifestUrl) {
        const response = await fetch(href, options);
        if (!response.ok) { mode = 'synthetic'; return response; }
        const manifest = await response.json();
        const file = Object.values(manifest).find(entry => entry?.files?.length)?.files[0];
        if (!synthetic && file) {
          probeUrl = new URL(file, baseUrl).href;
          const timeout = AbortSignal.timeout(APP_CONFIG.assetTimeoutMs);
          try {
            probeResponse = await fetch(probeUrl, { signal: options.signal
              ? AbortSignal.any([options.signal, timeout]) : timeout });
            mode = probeResponse.ok ? 'recorded' : 'synthetic';
          } catch { mode = 'synthetic'; }
        } else mode = 'synthetic';
        if (mode === 'synthetic') {
          for (const entry of Object.values(manifest)) {
            if (entry && typeof entry === 'object') entry.files = [];
          }
        }
        return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } });
      }
      if (mode === 'synthetic') return new Response('', { status: 404 });
      if (href === probeUrl && probeResponse) {
        const response = probeResponse; probeResponse = null; return response;
      }
      return fetch(href, options);
    },
  };
}
