/**
 * Absolute URL for a file served out of `public/`.
 *
 * The build uses a relative base so the same artifact works from the dev root,
 * from a static subdirectory like `/static-pages/veil/`, or off the filesystem.
 * That makes `import.meta.env.BASE_URL` a relative string such as `"./"`, which
 * cannot be handed straight to `fetch` or to a WASM loader — it has to be
 * resolved against the document first, and it must not be allowed to escape to
 * the origin root. Pass paths without caring about a leading slash.
 */
export function assetUrl(path: string): string {
  const configured = import.meta.env.BASE_URL || './'
  const relative = path.replace(/^\/+/, '')
  try {
    return new URL(relative, new URL(configured, document.baseURI)).href
  } catch {
    // No document (SSR or a worker): fall back to the configured base.
    return `${configured}${relative}`
  }
}
