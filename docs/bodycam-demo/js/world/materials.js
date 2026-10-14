import {
  DoubleSide, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader,
} from 'three';

export const MATERIAL_CONFIG = {
  maxAnisotropy: 8,
  aoIntensity: 1,
  normalScale: 1,
  chainlinkAlphaTest: 0.45,
  glassOpacity: 0.35,
};

export function createMaterialLibrary(textureIndex, assetUrl, { renderer, manager, config = MATERIAL_CONFIG } = {}) {
  const loader = new TextureLoader(manager);
  const materialPromises = new Map();
  const mapPromises = new Map();
  const materials = new Map();
  const textures = new Set();
  const sources = new Set();
  const adapted = new WeakSet();
  const maxAnisotropy = Math.min(config.maxAnisotropy, renderer?.capabilities.getMaxAnisotropy() ?? 4);

  async function loadTileMap(id, kind, tileMeters) {
    const file = textureIndex[id]?.files?.[kind];
    if (!file) throw new Error(`Missing texture filename: ${id}/${kind}`);
    const texture = await loader.loadAsync(assetUrl(`textures/${id}/${file}`));
    textures.add(texture);
    texture.name = `${id}/${kind}`;
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
    if (!mapPromises.has(key)) mapPromises.set(key, loadTileMap(id, kind, tileMeters));
    return mapPromises.get(key);
  }

  async function tiledMaterial(id, source, key) {
    const definition = textureIndex[id];
    const maps = new Set(definition.maps);
    const tileMeters = definition.tileMeters > 0 ? definition.tileMeters : 1;
    const results = await Promise.allSettled([
      maps.has('albedo') ? tileMap(id, 'albedo', tileMeters) : null,
      maps.has('normal') ? tileMap(id, 'normal', tileMeters) : null,
      maps.has('orm') ? tileMap(id, 'orm', tileMeters) : null,
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [map, normalMap, orm] = results.map(result => result.value);
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

  return {
    materials,
    textures,
    sources,
    async apply(root) {
      const meshes = [];
      root.traverse(object => { if (object.isMesh) meshes.push(object); });
      const results = await Promise.allSettled(meshes.map(async mesh => {
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => sources.add(material));
        mesh.material = Array.isArray(mesh.material)
          ? await Promise.all(mesh.material.map(resolve)) : await resolve(mesh.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    },
  };
}
