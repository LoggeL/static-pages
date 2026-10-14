import { loadRgbmTexture } from './rgbm.js';
import { isDoorPart } from './baked-level.js';

const sourceName = object => object.userData.sourceNodeName ?? object.name;

/** Attach decoded irradiance to standard PBR materials; direct lights still use their normal path. */
export async function bindLightmaps(asset, level, assetUrl, onProgress = () => {}) {
  const definitions = new Map((level.meshes ?? []).map(value => [value.name, value]));
  const atlases = level.lightmaps ?? [];
  if (!atlases.length || !definitions.size) throw new Error('Level has no lightmap assignments');
  const textures = new Map(), materials = new Map(), sources = new Set(), mappedNames = new Set();
  const records = [];
  try {
    // Decode two at a time to bound temporary CPU memory and HTTP concurrency.
    for (let i = 0; i < atlases.length; i += 2) {
      const batch = await Promise.allSettled(atlases.slice(i, i + 2).map(async definition => {
        const texture = await loadRgbmTexture(assetUrl(definition.path), {
          ...definition, range: definition.range ?? level.lightmapEncoding.range,
          multiplierExponent: definition.multiplierExponent ?? level.lightmapEncoding.multiplierExponent ?? 1,
        });
        textures.set(definition.path, texture);
      }));
      const failure = batch.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      onProgress(Math.min(i + 2, atlases.length) / atlases.length);
    }
    asset.scene.traverse(object => {
      const association = asset.parser.associations.get(object);
      const name = association?.nodes !== undefined ? asset.parser.json.nodes[association.nodes]?.name : null;
      if (name) object.userData.sourceNodeName = name;
    });
    asset.scene.traverse(mesh => {
      if (mesh.isLight) throw new Error('Baked GLB must not contain duplicated source lights');
      if (!mesh.isMesh) return;
      let owner = mesh;
      while (owner && !owner.userData.lightmap && !definitions.has(sourceName(owner))) owner = owner.parent;
      const definition = owner && definitions.get(sourceName(owner));
      const extra = owner?.userData;
      const path = extra?.lightmap ?? definition?.lightmap;
      const input = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      input.forEach(material => sources.add(material));
      if (!path) {
        if (!isDoorPart(mesh)) throw new Error(`${mesh.name}: static mesh has no lightmap`);
        return;
      }
      const texture = textures.get(path), intensity = extra?.lightmapIntensity ?? definition?.lightmapIntensity ?? Math.PI;
      if (!texture || isDoorPart(mesh)) throw new Error(`${mesh.name}: invalid lightmap/door assignment`);
      const uv = mesh.geometry.attributes.uv1;
      if (!uv || uv.count !== mesh.geometry.attributes.position.count) throw new Error(`${mesh.name}: missing TEXCOORD_1`);
      if (definition && (definition.lightmap !== path || definition.lightmapIntensity !== intensity)) {
        throw new Error(`${mesh.name}: GLB and level lightmap metadata disagree`);
      }
      const encoding = extra?.lightmapEncoding ?? definition?.lightmapEncoding ?? level.lightmapEncoding;
      if (encoding.type !== 'RGBM' || encoding.texCoord !== 1 || encoding.colorSpace !== 'linear'
        || encoding.range !== texture.userData.range
        || (encoding.multiplierExponent ?? 1) !== texture.userData.multiplierExponent
        || !Number.isFinite(intensity) || intensity <= 0) throw new Error(`${mesh.name}: invalid RGBM metadata`);
      const decal = Boolean(extra?.decal || mesh.userData.decal);
      const output = input.map(material => {
        const key = `${material.uuid}|${path}|${intensity}|${decal}`;
        if (!materials.has(key)) {
          const copy = material.clone();
          copy.lightMap = texture;
          copy.lightMapIntensity = intensity;
          copy.userData = { ...material.userData, lightmap: path, lightmapIntensity: intensity };
          if (decal) {
            copy.transparent = true; copy.depthWrite = false;
            copy.polygonOffset = true; copy.polygonOffsetFactor = -1; copy.polygonOffsetUnits = -1;
          }
          copy.needsUpdate = true;
          materials.set(key, copy);
        }
        return materials.get(key);
      });
      mesh.material = Array.isArray(mesh.material) ? output : output[0];
      if (decal) { mesh.renderOrder = 1; mesh.userData.decal = true; }
      // Dynamic weapon lights and moving leaves keep standard PBR/shadow reception.
      mesh.castShadow = !decal;
      mesh.receiveShadow = true;
      mappedNames.add(sourceName(owner));
      records.push({ mesh, lightmap: path, intensity });
    });
    for (const definition of definitions.values()) {
      if (definition.lightmap && !mappedNames.has(definition.name)) throw new Error(`Lightmapped mesh missing: ${definition.name}`);
    }
    return { textures, materials, sources, records };
  } catch (error) {
    for (const material of materials.values()) material.dispose();
    for (const texture of textures.values()) texture.dispose();
    throw error;
  }
}
