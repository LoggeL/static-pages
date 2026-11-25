/// <reference types="vite/client" />

/**
 * Resolves app-local asset and data paths against Vite's configured `BASE_URL`
 * so the application works identically at `/` (dev/preview) and under any nested
 * deployment subpath (e.g. `/static-pages/kindenheim-3d/` on GitHub Pages).
 */
export function resolveAssetUrl(raw: string): string {
  if (!raw) return '';
  if (/^(?:https?:|data:|blob:|\/\/)/i.test(raw)) {
    return raw;
  }
  const base = import.meta.env.BASE_URL || './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const cleaned = raw.replace(/^\.\//, '').replace(/^\/+/, '');
  return `${normalizedBase}${cleaned}`;
}
