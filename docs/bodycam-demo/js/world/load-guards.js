// Bound each network/decode stage and dispose results that arrive after cancellation.
export const ASSET_TIMEOUT_MS = 15000;

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Laden abgebrochen', 'AbortError');
}

export function withLoadDeadline(work, {
  signal, timeoutMs = ASSET_TIMEOUT_MS, label = 'Asset', disposeLate,
} = {}) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (error, value) => {
      if (settled) {
        if (!error) disposeLate?.(value);
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const cancel = reason => { controller.abort(reason); finish(reason); };
    const onAbort = () => cancel(signal.reason ?? new DOMException('Laden abgebrochen', 'AbortError'));
    const timer = setTimeout(() => {
      const error = new Error(`${label}: Zeitlimit nach ${Math.round(timeoutMs / 1000)} s`);
      error.name = 'TimeoutError';
      cancel(error);
    }, Math.max(1, timeoutMs));
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => {
      throwIfAborted(controller.signal);
      return work(controller.signal);
    }).then(value => finish(null, value), error => finish(error));
  });
}

export function fetchAsset(url, { signal, timeoutMs, type = 'arrayBuffer' } = {}) {
  return withLoadDeadline(async activeSignal => {
    const response = await fetch(url, { signal: activeSignal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const result = await response[type]();
    throwIfAborted(activeSignal);
    return result;
  }, { signal, timeoutMs, label: url });
}

export function disposeObjectResources(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root?.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const geometry of geometries) { geometry.boundsTree = null; geometry.dispose(); }
  for (const texture of textures) { texture.dispose(); texture.image?.close?.(); }
}

export async function loadGltfAsset(loader, url, options = {}) {
  const buffer = await fetchAsset(url, options);
  return withLoadDeadline(() => loader.parseAsync(buffer, new URL('.', url).href), {
    ...options, label: url, disposeLate: asset => disposeObjectResources(asset.scene),
  });
}

export async function mapWithLimit(values, concurrency, callback, signal) {
  const results = new Array(values.length);
  let cursor = 0, failure = null;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (!failure && cursor < values.length) {
      const index = cursor++;
      try { throwIfAborted(signal); results[index] = await callback(values[index], index); }
      catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}
