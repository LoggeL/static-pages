import { LoadingManager, TextureLoader } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const ASSET_LOADER_CONFIG = Object.freeze({
  transcoderPath: 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/',
  workerLimit: 2,
});

const decalIndexes = new Map();

/** Resolve the older weapon caller's logical decal URL before making an image request. */
export async function resolveDecalTextureUrl(url) {
  const source = new URL(url, import.meta.url);
  const match = source.pathname.match(/\/textures\/decals\/([^/]+)\.(?:png|jpe?g|webp)$/i);
  if (!match) return url;
  const indexUrl = new URL('../index.json', source).href;
  if (!decalIndexes.has(indexUrl)) {
    const pending = fetch(indexUrl).then(async response => {
      if (!response.ok) throw new Error(`Texture index HTTP ${response.status}: ${indexUrl}`);
      return (await response.json()).decals;
    }).catch(error => { decalIndexes.delete(indexUrl); throw error; });
    decalIndexes.set(indexUrl, pending);
  }
  const decals = await decalIndexes.get(indexUrl), name = match[1];
  const filename = decals?.[name]?.file
    ?? (name.endsWith('_normal') ? decals?.[name.slice(0, -7)]?.normal : null);
  if (!filename) throw new Error(`Missing decal filename: ${name}`);
  const resolved = new URL(`../${filename}`, source);
  resolved.search = source.search;
  resolved.hash = source.hash;
  return resolved.href;
}

class ManifestTextureLoader extends TextureLoader {
  async loadAsync(url, onProgress) {
    return super.loadAsync(await resolveDecalTextureUrl(url), onProgress);
  }
}

/**
 * Explicit factory for integration. Importing this module has no global side effects.
 * Supply the active renderer to enable KTX2; WebP works without a transcoder.
 * Call dispose() after pending loads finish. Loaded scenes/textures belong to the caller.
 * Meshopt is always available, including callers without a renderer.
 */
export function createAssetLoaders({
  renderer,
  manager = new LoadingManager(),
  transcoderPath = ASSET_LOADER_CONFIG.transcoderPath,
  workerLimit = ASSET_LOADER_CONFIG.workerLimit,
} = {}) {
  if (!Number.isInteger(workerLimit) || workerLimit < 1) {
    throw new RangeError('workerLimit must be a positive integer');
  }
  const ktx2 = renderer
    ? new KTX2Loader(manager).setTranscoderPath(transcoderPath)
      .setWorkerLimit(workerLimit).detectSupport(renderer)
    : null;
  const gltf = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  if (ktx2) gltf.setKTX2Loader(ktx2);
  let disposed = false;
  return {
    manager, gltf, ktx2, texture: new ManifestTextureLoader(manager),
    dispose() {
      if (disposed) return;
      disposed = true;
      ktx2?.dispose();
    },
  };
}
