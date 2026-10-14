import { Group, LoadingManager, MathUtils, Raycaster, Vector3 } from 'three';
import { createAssetLoaders } from '../core/loaders.js';
import { AVAILABLE_PROPS } from './available-props.js';
import { isDoorPart, layoutFromLevel, prepareBakedDoors } from './baked-level.js';
import { accelerateShootables, isCollidable, makeCollider, sourceOfHit, surfaceOfHit } from './colliders.js';
import { anchorFromBlender, createRooms, fromBlender } from './coordinates.js';
import { createDecals, DECAL_CONFIG } from './decals.js';
import { createDoors, DOOR_CONFIG } from './doors.js';
import { createLighting } from './lighting.js';
import { bindLightmaps } from './lightmaps.js';
import { createSourceLightMask } from './source-light-mask.js';
import { LIGHTING_CONFIG } from './lighting-config.js';
import { createMaterialLibrary, MATERIAL_CONFIG } from './materials.js';

export { surfaceOf } from './surfaces.js';
export { fromBlender } from './coordinates.js';

export const WORLD_CONFIG = {
  lightmaps: true,
  propLoadConcurrency: 6,
  surfaceRayLift: 0.12,
  surfaceRayDepth: 4,
  buildShootableBVHs: true,
};

async function readJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`World data ${response.status}: ${url}`);
  return response.json();
}

async function mapLimit(values, concurrency, callback) {
  let cursor = 0;
  const results = new Array(values.length);
  const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await callback(values[index], index);
    }
  }));
  const failure = workers.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}

/**
 * Load static visual assets, colliders and metadata. No renderer/global prototype mutation.
 * onProgress receives {stage, progress: 0..1, loaded?, total?, url?}.
 * Options may override baseUrl, worldConfig, materials, lighting, doors and decals.
 */
export async function loadWorld(scene, {
  onProgress,
  renderer,
  baseUrl = new URL('../../', import.meta.url),
  worldConfig = {},
  materials: materialOptions = {},
  lighting: lightingOptions = {},
  doors: doorOptions = {},
  decals: decalOptions = {},
  lightmaps,
} = {}) {
  const started = performance.now();
  const config = { ...WORLD_CONFIG, ...worldConfig };
  const useLightmaps = lightmaps ?? (config.lightmaps
    && new URLSearchParams(globalThis.location?.search ?? '').get('lightmaps') !== '0');
  const rootUrl = new URL(baseUrl, import.meta.url);
  if (!rootUrl.pathname.endsWith('/')) rootUrl.pathname += '/';
  const assetUrl = path => new URL(path, rootUrl).href;
  const report = (stage, progress, details = {}) => onProgress?.({ stage, progress, ...details });
  report('Daten', 0);
  const [metadata, textureIndex, placementConfig] = await Promise.all([
    readJSON(assetUrl(useLightmaps ? 'data/level.json' : 'data/layout.json')),
    readJSON(assetUrl('textures/index.json')),
    useLightmaps ? null : readJSON(assetUrl('js/world/placement-config.json')),
  ]);
  const level = useLightmaps ? metadata : null;
  const layout = level ? layoutFromLevel(level) : metadata;
  const manager = new LoadingManager();
  const assets = createAssetLoaders({ renderer, manager });
  const loader = assets.gltf;
  const materialConfig = { ...MATERIAL_CONFIG, ...materialOptions };
  const materialLibrary = createMaterialLibrary(textureIndex, assetUrl, { renderer, manager, config: materialConfig });
  const root = new Group();
  root.name = 'BodycamWorld';
  const furnitureRoot = new Group();
  furnitureRoot.name = 'Furniture';
  const resourceRoots = [root];
  let lightmapData = null, lighting = null, collider = null, disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(root);
    lighting?.dispose();
    const geometries = new Set();
    const materials = new Set([...materialLibrary.materials.values(), ...materialLibrary.sources]);
    const textures = new Set(materialLibrary.textures);
    for (const material of lightmapData?.sources ?? []) materials.add(material);
    for (const texture of lightmapData?.textures.values() ?? []) textures.add(texture);
    const collect = object => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    };
    for (const resource of resourceRoots) resource.traverse(collect);
    if (collider) collect(collider);
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
    for (const geometry of geometries) { geometry.boundsTree = null; geometry.dispose(); }
    for (const texture of textures) texture.dispose();
  }
  try {
    const placements = level?.propInstances ?? Object.entries(layout.furniture ?? {})
      .flatMap(([room, entries]) => entries.map(entry => ({ ...entry, room })));
    const neededProps = [...new Set(placements.map(entry => entry.prop))].sort();
    const missingProps = level ? [...new Set((level.missingProps ?? []).map(entry => entry.prop ?? entry))]
      : neededProps.filter(id => !AVAILABLE_PROPS.has(id));
    if (missingProps.length) console.info('[bodycam/world] Fehlende Props, ausgelassen:', missingProps.join(', '));
    const available = neededProps.filter(id => AVAILABLE_PROPS.has(id));
    report('Haus', 0.04);
    const houseAsset = await loader.loadAsync(assetUrl(level?.model ?? 'models/house_shell.glb'));
    const house = houseAsset.scene;
    house.name = level ? 'BakedHouse' : 'HouseShell';
    root.add(house, furnitureRoot);
    report('Möbel', 0.18, { loaded: 0, total: available.length });
    let loaded = 0;
    const prototypeEntries = await mapLimit(level?.staticPropsIncluded ? [] : available, Math.max(1, config.propLoadConcurrency), async id => {
      const gltf = await loader.loadAsync(assetUrl(`models/props/${id}.glb`));
      resourceRoots.push(gltf.scene);
      loaded++;
      report('Möbel', 0.18 + loaded / available.length * 0.4, { loaded, total: available.length, url: id });
      return [id, gltf.scene];
    });
    const prototypes = new Map(prototypeEntries);
    const collisionSource = level?.collisionModel ? (await loader.loadAsync(assetUrl(level.collisionModel))).scene : null;
    if (collisionSource) resourceRoots.push(collisionSource);
    report('Materialien', 0.6);
    const materialResults = await Promise.allSettled([house, ...prototypes.values()].map(object => materialLibrary.apply(object)));
    const materialFailure = materialResults.find(result => result.status === 'rejected');
    if (materialFailure) throw materialFailure.reason;
    lightmapData = level ? await bindLightmaps(houseAsset, level, assetUrl,
      fraction => report('Lightmaps', 0.62 + fraction * 0.12)) : null;
    for (const placement of level?.staticPropsIncluded ? [] : placements) {
      const prototype = prototypes.get(placement.prop);
      if (!prototype) continue;
      const instance = prototype.clone(true);
      instance.name = `PROP_${placement.room}_${placement.name}`;
      instance.userData = { ...instance.userData, prop: placement.prop, room: placement.room, anchor: placement.anchor };
      fromBlender(placement.pos, instance.position);
      instance.rotation.y = MathUtils.degToRad(((placement.rotZ ?? 0)
        + (placementConfig?.rotationsByPropDegrees?.[placement.prop] ?? 0)) % 360);
      if (typeof placement.scale === 'number') instance.scale.setScalar(placement.scale);
      else if (Array.isArray(placement.scale)) instance.scale.set(placement.scale[0], placement.scale[2], placement.scale[1]);
      furnitureRoot.add(instance);
    }
    report('Decals', 0.74);
    const decals = level?.staticDecalsIncluded ? new Group()
      : await createDecals(layout, textureIndex, assetUrl, manager, { ...DECAL_CONFIG, ...decalOptions });
    decals.name = 'LayoutDecals';
    root.add(decals);
    scene.add(root);
    root.updateWorldMatrix(true, true);
    report('Kollision', 0.82);
    if (level) prepareBakedDoors(house, level);
    const doors = createDoors(house, layout, { ...DOOR_CONFIG, ...doorOptions });
    const doorMeshes = new Set(doors.flatMap(door => door.meshes));
    const shootables = [];
    root.traverse(object => { if (isCollidable(object)) shootables.push(object); });
    const staticMeshes = [];
    if (collisionSource) {
      collisionSource.updateWorldMatrix(true, true);
      collisionSource.traverse(object => {
        if (isCollidable(object) && !isDoorPart(object)) staticMeshes.push(object);
      });
    } else staticMeshes.push(...shootables.filter(object => !doorMeshes.has(object)));
    collider = makeCollider(staticMeshes, { name: 'StaticWorldCollider' });
    const colliders = { static: collider, doors: doors.map(door => door.collider) };
    if (config.buildShootableBVHs) accelerateShootables(shootables);
    const lightingConfig = Object.fromEntries(Object.entries(LIGHTING_CONFIG).map(([key, value]) => [
      key, typeof value === 'object' ? { ...value, ...lightingOptions[key] } : lightingOptions[key] ?? value,
    ]));
    lightingConfig.moon.shadow = { ...LIGHTING_CONFIG.moon.shadow, ...lightingOptions.moon?.shadow };
    lighting = createLighting(scene, layout, lightingConfig, { level });
    if (lightmapData) {
      const mask = createSourceLightMask(scene);
      for (const material of lightmapData.materials.values()) mask.apply(material);
    }
    const rooms = createRooms(layout);
    const outside = rooms.find(room => room.id === 'OUT') ?? null;
    const roomAt = point => rooms.find(room => room.contains(point)) ?? outside;
    const raycaster = new Raycaster();
    raycaster.firstHitOnly = true;
    const down = new Vector3(0, -1, 0);
    const origin = new Vector3();
    const hits = [];
    const rayTargets = [collider, ...colliders.doors];
    function floorHit(point) {
      origin.copy(point);
      origin.y += config.surfaceRayLift;
      raycaster.set(origin, down);
      raycaster.near = 0;
      raycaster.far = config.surfaceRayDepth;
      hits.length = 0;
      raycaster.intersectObjects(rayTargets, false, hits);
      return hits[0] ?? null;
    }
    const statistics = {
      lightmaps: useLightmaps,
      model: level?.model ?? 'models/house_shell.glb',
      collisionModel: level?.collisionModel ?? null,
      loadMs: performance.now() - started,
      furniturePlacements: placements.length,
      furnitureLoaded: level?.staticPropsIncluded ? placements.length : furnitureRoot.children.length,
      uniquePropsLoaded: level?.staticPropsIncluded ? neededProps.length : prototypes.size,
      missingProps,
      doors: doors.length,
      decals: level?.staticDecalsIncluded ? level.staticDecalInstances ?? null : decals.children.length,
      lightmappedMeshes: lightmapData?.records.length ?? 0,
      atlases: lightmapData?.textures.size ?? 0,
      lightmapBytes: lightmapData ? [...lightmapData.textures.values()].reduce((sum, texture) => sum + texture.userData.downloadBytes, 0) : 0,
      lightmapDecodedBytes: lightmapData ? [...lightmapData.textures.values()].reduce((sum, texture) => sum + texture.userData.decodedBytes, 0) : 0,
      shootables: shootables.length,
      staticTriangles: collider.userData.triangles,
      doorTriangles: colliders.doors.reduce((sum, mesh) => sum + mesh.userData.triangles, 0),
      sharedTiledMaterials: materialLibrary.materials.size,
    };
    report('Fertig', 1);
    return {
      root, house, furniture: furnitureRoot, decals, colliders, shootables, doors, rooms, roomAt,
      spawn: { ...anchorFromBlender(layout.playerSpawn), pitchDeg: layout.playerSpawn.pitchDeg ?? -4 },
      policeCar: anchorFromBlender(layout.policeCar),
      suspects: (layout.suspects ?? []).map(anchorFromBlender),
      suspectsAlt: (layout.suspectsAlt ?? []).map(anchorFromBlender),
      layout, level, textureIndex, lighting, materialLibrary, lightmapData, missingProps, stats: statistics,
      floorHit,
      surfaceAt(point) {
        const hit = floorHit(point);
        return hit ? surfaceOfHit(hit) : roomAt(point)?.floorSurface ?? 'concrete';
      },
      sourceOfHit,
      update(dt) {
        if (disposed) return;
        for (const door of doors) door.update(dt);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    // All loads settle before releasing worker/transcoder infrastructure.
    assets.dispose();
  }
}
