import {
  DoubleSide, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader,
} from 'three';
import { fetchAsset, mapWithLimit, throwIfAborted, withLoadDeadline } from './load-guards.js';

export const MATERIAL_CONFIG = {
  maxAnisotropy: 8,
  aoIntensity: 1,
  normalScale: 1,
  chainlinkAlphaTest: 0.45,
  glassOpacity: 0.35,
  textureLoadConcurrency: 2,
  materialLoadConcurrency: 4,
  loadTimeoutMs: 15000,
};

export function createMaterialLibrary(textureIndex, assetUrl, {
  renderer, manager, config = MATERIAL_CONFIG, signal, onWarning = () => {},
} = {}) {
  const loader = new TextureLoader(manager);
  const materialPromises = new Map();
  const mapPromises = new Map();
  const materials = new Map();
  const textures = new Set();
  const sources = new Set();
  const adapted = new WeakSet();
  const maxAnisotropy = Math.min(config.maxAnisotropy, renderer?.capabilities.getMaxAnisotropy() ?? 4);
  const warnings = [];
  let activeLoads = 0;
  let textureDeadline = null;
  const waitingLoads = [];

  async function limitedLoad(work) {
    if (activeLoads >= Math.max(1, config.textureLoadConcurrency ?? 2)) {
      await new Promise(resolve => waitingLoads.push(resolve));
    } else activeLoads++;
    try { throwIfAborted(signal); return await work(); }
    finally {
      if (waitingLoads.length) waitingLoads.shift()(); else activeLoads--;
    }
  }

  async function imageTexture(url, { deadline, abort = signal } = {}) {
    if (deadline === undefined) deadline = textureDeadline ??= performance.now() + config.loadTimeoutMs;
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error('Zeitlimit für optionale Texturen erreicht');
    const options = { signal: abort, timeoutMs: remaining, label: url };
    // Fetch is abortable. Decode only two images at a time, with no burst of large ImageBitmaps.
    const blob = await fetchAsset(url, { ...options, type: 'blob' });
    if (typeof createImageBitmap === 'function') {
      const bitmap = await withLoadDeadline(() => createImageBitmap(blob, {
        imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      }), { ...options, disposeLate: value => value.close() });
      return new Texture(bitmap);
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await withLoadDeadline(() => loader.loadAsync(objectUrl), {
        ...options, disposeLate: texture => texture.dispose(),
      });
    } finally { URL.revokeObjectURL(objectUrl); }
  }

  async function loadTileMap(id, kind, tileMeters) {
    const file = textureIndex[id]?.files?.[kind];
    if (!file) throw new Error(`Missing texture filename: ${id}/${kind}`);
    const texture = await limitedLoad(() => imageTexture(assetUrl(`textures/${id}/${file}`)));
    textures.add(texture);
    throwIfAborted(signal);
    texture.name = `${id}/${kind}`;
    texture.userData.tile = { id, kind };
    texture.colorSpace = kind === 'albedo' ? SRGBColorSpace : NoColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.setScalar(1 / tileMeters);
    texture.anisotropy = maxAnisotropy;
    texture.channel = 0;
    texture.needsUpdate = true;
    return texture;
  }

  function tileMap(id, kind, tileMeters) {
    const key = `${id}/${kind}/${tileMeters}`;
    if (!mapPromises.has(key)) mapPromises.set(key, loadTileMap(id, kind, tileMeters).catch(error => {
      throwIfAborted(signal);
      const warning = `Textur ${id}/${kind} fehlt, Materialfarbe bleibt erhalten: ${error.message}`;
      warnings.push(warning); onWarning(warning);
      return null;
    }));
    return mapPromises.get(key);
  }

  async function tiledMaterial(id, source, key) {
    const definition = textureIndex[id];
    const maps = new Set(definition.maps);
    const tileMeters = definition.tileMeters > 0 ? definition.tileMeters : 1;
    const [map, normalMap, orm] = await Promise.all([
      maps.has('albedo') ? tileMap(id, 'albedo', tileMeters) : null,
      maps.has('normal') ? tileMap(id, 'normal', tileMeters) : null,
      maps.has('orm') ? tileMap(id, 'orm', tileMeters) : null,
    ]);
    throwIfAborted(signal);
    const material = new MeshStandardMaterial({
      name: `M_${id}`,
      color: map ? 0xffffff : source.color,
      side: source.side,
      map,
      normalMap,
      aoMap: orm,
      roughnessMap: orm,
      metalnessMap: orm,
      // ORM channels are complete factors; glTF placeholder values must not mute them.
      roughness: orm ? 1 : source.roughness,
      metalness: orm ? 1 : source.metalness,
      aoMapIntensity: config.aoIntensity,
      vertexColors: source.vertexColors,
    });
    material.normalScale.setScalar(config.normalScale);
    material.userData = { ...source.userData, textureId: id };
    materials.set(key, material);
    return material;
  }

  function adaptUnique(source) {
    if (adapted.has(source)) return source;
    adapted.add(source);
    // GLTFLoader already decodes embedded MU textures and emissive strength correctly.
    if (source.name.startsWith('M_glass')) {
      source.transparent = true;
      source.opacity = source.opacity < 1 ? source.opacity : config.glassOpacity;
      source.depthWrite = false;
      source.forceSinglePass = true;
    }
    if (source.name === 'MU_chainlink') {
      source.transparent = false;
      source.alphaTest = config.chainlinkAlphaTest;
      source.depthWrite = true;
      source.side = DoubleSide;
    }
    for (const key of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
      const texture = source[key];
      if (texture) texture.anisotropy = maxAnisotropy;
    }
    source.needsUpdate = true;
    return source;
  }

  async function resolve(source) {
    if (!source) return source;
    const id = source.name.startsWith('M_') ? source.userData.textureId ?? source.name.slice(2) : null;
    if (!id || !textureIndex[id]?.maps) return adaptUnique(source);
    // COLOR_0 is mesh-specific: the first shell material must not disable prop wear.
    const key = `${id}|colors:${Boolean(source.vertexColors)}|side:${source.side}`;
    if (!materialPromises.has(key)) materialPromises.set(key, tiledMaterial(id, source, key));
    return materialPromises.get(key);
  }

  // Progressive loading: tile maps came from the small preview set; swap in the full-resolution images.
  // A size change needs fresh GPU storage, so each texture is disposed before its new image uploads.
  async function upgrade(index, urlOf, { signal: abort, timeoutMs = config.loadTimeoutMs, concurrency = 1 } = {}) {
    const deadline = performance.now() + timeoutMs, failed = [];
    let upgraded = 0;
    await mapWithLimit([...textures].filter(texture => texture.userData.tile), concurrency, async texture => {
      const { id, kind } = texture.userData.tile, file = index[id]?.files?.[kind];
      if (!file) return;
      try {
        const loaded = await imageTexture(urlOf(`textures/${id}/${file}`), { deadline, abort });
        if (abort?.aborted || !textures.has(texture)) { loaded.image?.close?.(); return; }
        const previous = texture.image;
        texture.dispose(); texture.image = loaded.image; texture.needsUpdate = true;
        previous?.close?.(); upgraded++;
      } catch (error) {
        throwIfAborted(abort);
        failed.push(`${id}/${kind}: ${error.message}`);
      }
    }, abort);
    return { upgraded, failed };
  }

  return {
    materials,
    textures,
    sources,
    warnings,
    upgrade,
    async apply(root) {
      const meshes = [];
      root.traverse(object => { if (object.isMesh) meshes.push(object); });
      await mapWithLimit(meshes, config.materialLoadConcurrency ?? 4, async mesh => {
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => sources.add(material));
        mesh.material = Array.isArray(mesh.material)
          ? await Promise.all(mesh.material.map(resolve)) : await resolve(mesh.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }, signal);
    },
  };
}
