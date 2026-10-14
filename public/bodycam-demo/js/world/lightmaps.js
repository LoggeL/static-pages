import { loadRgbmTexture } from './rgbm.js';
import { isDoorPart } from './baked-level.js';
import { ASSET_TIMEOUT_MS, mapWithLimit, throwIfAborted } from './load-guards.js';

const sourceName = object => object.userData.sourceNodeName ?? object.name;

/** Attach decoded irradiance to standard PBR materials; direct lights still use their normal path. */
export async function bindLightmaps(asset, level, assetUrl, onProgress = () => {}, {
  signal, timeoutMs, concurrency = 1, onWarning = () => {},
} = {}) {
  const definitions = new Map((level.meshes ?? []).map(value => [value.name, value]));
  const atlases = level.lightmaps ?? [];
  const textures = new Map(), materials = new Map(), sources = new Set(), mappedNames = new Set();
  const records = [], warnings = [], failedAtlases = [];
  const seenWarnings = new Set();
  function warn(message) {
    if (seenWarnings.has(message)) return;
    seenWarnings.add(message); warnings.push(message); onWarning(message);
  }
  const result = { textures, materials, sources, records, warnings, failedAtlases };
  if (!atlases.length || !definitions.size) {
    warn('Keine Lightmap-Zuordnung vorhanden. Das Haus verwendet normale Beleuchtung.');
    return result;
  }
  try {
    // Keep decoded and temporary atlas buffers bounded, especially on mobile Safari.
    let loaded = 0;
    const deadline = performance.now() + (timeoutMs ?? ASSET_TIMEOUT_MS);
    await mapWithLimit(atlases, concurrency, async definition => {
      try {
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new Error('Zeitlimit für optionale Beleuchtung erreicht');
        const texture = await loadRgbmTexture(assetUrl(definition.path), {
          ...definition, range: definition.range ?? level.lightmapEncoding?.range,
          multiplierExponent: definition.multiplierExponent ?? level.lightmapEncoding?.multiplierExponent ?? 1,
        }, { signal, timeoutMs: remaining, onWarning: warn });
        textures.set(definition.path, texture);
      } catch (error) {
        throwIfAborted(signal);
        failedAtlases.push(definition.path);
        warn(`Beleuchtung ${definition.path} nicht verfügbar, normale Beleuchtung aktiv: ${error.message}`);
      }
      onProgress(++loaded / atlases.length);
    }, signal);
    throwIfAborted(signal);
    asset.scene.traverse(object => {
      const association = asset.parser?.associations?.get(object);
      const name = association?.nodes !== undefined ? asset.parser.json.nodes[association.nodes]?.name : null;
      if (name) object.userData.sourceNodeName = name;
    });
    asset.scene.traverse(mesh => {
      if (mesh.isLight) {
        // Source lights are recreated by lighting.js. A malformed atlas never adds duplicates.
        mesh.visible = false;
        warn('Doppelte Lichtquelle im Modell wurde ausgeblendet.');
      }
      if (!mesh.isMesh) return;
      let owner = mesh;
      while (owner && !owner.userData.lightmap && !definitions.has(sourceName(owner))) owner = owner.parent;
      const definition = owner && definitions.get(sourceName(owner));
      const extra = owner?.userData;
      const path = extra?.lightmap ?? definition?.lightmap;
      const input = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      input.forEach(material => sources.add(material));
      if (!path) {
        if (!isDoorPart(mesh)) warn(`${mesh.name}: keine Lightmap, normale Beleuchtung aktiv.`);
        return;
      }
      const texture = textures.get(path), intensity = extra?.lightmapIntensity ?? definition?.lightmapIntensity ?? Math.PI;
      if (!texture) return; // The failed atlas was reported once; the real geometry stays visible.
      if (isDoorPart(mesh)) { warn(`${mesh.name}: bewegliche Tür verwendet normale Beleuchtung.`); return; }
      const uv = mesh.geometry.attributes.uv1;
      if (!uv || uv.count !== mesh.geometry.attributes.position.count) {
        warn(`${mesh.name}: keine gültigen Lightmap-UVs, normale Beleuchtung aktiv.`); return;
      }
      if (definition && (definition.lightmap !== path || definition.lightmapIntensity !== intensity)) {
        warn(`${mesh.name}: abweichende Lightmap-Daten, normale Beleuchtung aktiv.`); return;
      }
      const encoding = extra?.lightmapEncoding ?? definition?.lightmapEncoding ?? level.lightmapEncoding;
      if (encoding?.type !== 'RGBM' || encoding.texCoord !== 1 || encoding.colorSpace !== 'linear'
        || encoding.range !== texture.userData.range
        || (encoding.multiplierExponent ?? 1) !== texture.userData.multiplierExponent
        || !Number.isFinite(intensity) || intensity <= 0) {
        warn(`${mesh.name}: ungültige RGBM-Daten, normale Beleuchtung aktiv.`); return;
      }
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
      records.push({ mesh, lightmap: path, intensity, originalMaterial: Array.isArray(mesh.material) ? input : input[0] });
    });
    for (const definition of definitions.values()) {
      if (definition.lightmap && textures.has(definition.lightmap) && !mappedNames.has(definition.name)) {
        warn(`${definition.name}: Lightmap konnte nicht zugeordnet werden.`);
      }
    }
    return result;
  } catch (error) {
    for (const record of records) record.mesh.material = record.originalMaterial;
    for (const material of materials.values()) material.dispose();
    for (const texture of textures.values()) texture.dispose();
    throw error;
  }
}
