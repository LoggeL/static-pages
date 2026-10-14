import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createMaterialLibrary } from '../../js/world/materials.js';
import { loadRgbmTexture } from './rgbm.js';
import { VIEWER_CONFIG } from './config.js';

const assetUrl = value => new URL(`../../${value}`, import.meta.url).href;
const materialsOf = object => Array.isArray(object.material) ? object.material : [object.material];
const sourceName = object => object.userData.sourceNodeName ?? object.userData.name ?? object.name;

async function json(path) {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function metadataFor(mesh, definitions) {
  for (let object = mesh; object; object = object.parent) {
    if (object.userData.lightmap || definitions.has(sourceName(object))) {
      return { owner: object, name: sourceName(object), definition: definitions.get(sourceName(object)), extra: object.userData };
    }
  }
  return null;
}

function doorAncestor(object) {
  for (; object; object = object.parent) if (object.name.startsWith('DOOR_')) return object;
  return null;
}

function insidePolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export async function loadBakedWorld(renderer, onProgress = () => {}) {
  const started = performance.now();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [level, textureIndex, houseAsset, collisionAsset] = await Promise.all([
    json('data/level.json'), json('textures/index.json'),
    loader.loadAsync(assetUrl('models/house.glb')), loader.loadAsync(assetUrl('models/house_collision.glb')),
  ]);
  const house = houseAsset.scene, collision = collisionAsset.scene;
  house.traverse(object => {
    const association = houseAsset.parser.associations.get(object);
    const name = association?.nodes !== undefined ? houseAsset.parser.json.nodes[association.nodes]?.name : null;
    if (name) object.userData.sourceNodeName = name;
  });
  house.name = 'C6_HOUSE'; collision.name = 'C6_COLLISION';
  const definitions = new Map((level.meshes ?? []).map(definition => [definition.name, definition]));
  const atlasDefinitions = (level.lightmaps ?? []).map(definition => ({
    ...definition, range: definition.range ?? level.lightmapEncoding?.range,
    multiplierExponent: definition.multiplierExponent ?? level.lightmapEncoding?.multiplierExponent ?? 1,
  }));
  if (!atlasDefinitions.length || !definitions.size) throw new Error('level.json enthält keine Lightmap-Zuordnung');
  const textures = new Map();
  // Bound CPU decode memory and avoid saturating small static HTTP servers.
  for (let i = 0; i < atlasDefinitions.length; i += 2) {
    await Promise.all(atlasDefinitions.slice(i, i + 2).map(async definition => {
      const texture = await loadRgbmTexture(assetUrl(definition.path), definition);
      textures.set(definition.path, texture);
    }));
    onProgress(`Lightmaps ${Math.min(i + 2, atlasDefinitions.length)} / ${atlasDefinitions.length}`);
  }
  const materialLibrary = createMaterialLibrary(textureIndex, assetUrl, { renderer });
  await materialLibrary.apply(house);
  const materialCache = new Map(), alternateCache = new Map();
  const records = [], problems = [];
  let unmappedMeshes = 0, sourceLights = 0;
  house.traverse(mesh => {
    if (mesh.isLight) sourceLights++;
    if (!mesh.isMesh) return;
    mesh.castShadow = false; mesh.receiveShadow = false;
    const source = metadataFor(mesh, definitions);
    const definition = source?.definition;
    const extra = source?.extra;
    const lightmapPath = extra?.lightmap ?? definition?.lightmap;
    const intensity = Number(extra?.lightmapIntensity ?? definition?.lightmapIntensity ?? Math.PI);
    const texture = lightmapPath ? textures.get(lightmapPath) : null;
    if (lightmapPath && !texture) problems.push(`${mesh.name}: Atlas fehlt (${lightmapPath})`);
    if (lightmapPath && doorAncestor(mesh)) problems.push(`${mesh.name}: bewegliche Tür hat Lightmap`);
    if (definition && extra?.lightmap !== definition.lightmap) problems.push(`${mesh.name}: glTF-Extras/level.json Atlas verschieden`);
    if (definition && extra?.lightmapIntensity !== definition.lightmapIntensity) problems.push(`${mesh.name}: glTF-Extras/level.json Intensität verschieden`);
    if (definition && JSON.stringify(extra?.lightmapEncoding) !== JSON.stringify(definition.lightmapEncoding)) {
      // Key order is irrelevant; compare the defined interface explicitly.
      for (const key of ['type', 'range', 'multiplierExponent', 'colorSpace', 'texCoord']) {
        if (extra?.lightmapEncoding?.[key] !== definition.lightmapEncoding?.[key]) problems.push(`${mesh.name}: Encoding.${key} verschieden`);
      }
    }
    if (texture) {
      const uv = mesh.geometry.attributes.uv1, positions = mesh.geometry.attributes.position;
      if (!uv || uv.count !== positions.count) problems.push(`${mesh.name}: TEXCOORD_1 fehlt oder ist unvollständig`);
      else {
        let invalid = 0;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i);
          if (!Number.isFinite(u + v) || u < -1e-5 || v < -1e-5 || u > 1.00001 || v > 1.00001) invalid++;
        }
        if (invalid) problems.push(`${mesh.name}: ${invalid} UV1 außerhalb [0,1]`);
      }
      if (!mesh.geometry.attributes.uv) problems.push(`${mesh.name}: TEXCOORD_0 fehlt`);
      const encoding = extra?.lightmapEncoding ?? definition?.lightmapEncoding ?? level.lightmapEncoding;
      if (encoding?.type !== 'RGBM' || encoding?.colorSpace !== 'linear' || encoding?.texCoord !== 1 ||
          !Number.isFinite(encoding?.range) ||
          Math.abs(encoding?.range - texture.userData.range) > 1e-6 ||
          Math.abs((encoding?.multiplierExponent ?? 1) - texture.userData.multiplierExponent) > 1e-6) problems.push(`${mesh.name}: falsches Encoding`);
      if (!(intensity > 0 && Number.isFinite(intensity))) problems.push(`${mesh.name}: ungültige Intensität`);
    } else unmappedMeshes++;
    const sources = materialsOf(mesh);
    if (extra?.decal || mesh.userData.decal) {
      mesh.renderOrder = 1;
      for (const material of sources) {
        material.transparent = true;
        material.depthWrite = false;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;
      }
    }
    const baked = sources.map(material => {
      if (!texture) return material;
      const key = `${material.uuid}|${lightmapPath}|${intensity}`;
      if (!materialCache.has(key)) {
        const cloned = material.clone();
        cloned.lightMap = texture;
        cloned.lightMapIntensity = intensity;
        cloned.userData = { ...material.userData, lightmap: lightmapPath, lightmapIntensity: intensity };
        cloned.needsUpdate = true;
        materialCache.set(key, cloned);
      }
      return materialCache.get(key);
    });
    mesh.material = Array.isArray(mesh.material) ? baked : baked[0];
    records.push({ mesh, owner: source?.owner, sourceName: source?.name, definition, extra, texture, sources, baked,
      visible: mesh.visible, decal: Boolean(extra?.decal || mesh.userData.decal),
      array: Array.isArray(mesh.material), lightmap: lightmapPath ?? null, intensity });
  });
  if (sourceLights) problems.push(`${sourceLights} zusätzliche Lichter im exportierten GLB`);
  for (const definition of definitions.values()) {
    if (definition.lightmap && !records.some(record => record.sourceName === definition.name)) problems.push(`${definition.name}: level.json Mesh fehlt im GLB`);
  }
  if (problems.length) throw new Error(`Lightmap-Prüfung fehlgeschlagen:\n${problems.join('\n')}`);

  const collisionMaterial = new THREE.MeshBasicMaterial({ color: VIEWER_CONFIG.collision.color,
    wireframe: true, transparent: true, opacity: VIEWER_CONFIG.collision.opacity,
    depthTest: false, depthWrite: false, toneMapped: false });
  let collisionMeshes = 0, collisionTriangles = 0;
  collision.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.material = collisionMaterial; mesh.renderOrder = 10;
    collisionMeshes++;
    collisionTriangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
  });
  collision.visible = false;
  const doors = [];
  const axisWorld = new THREE.Vector3(0, 1, 0);
  for (const definition of level.doors ?? []) {
    if (definition.kind !== 'door' && !definition.object?.startsWith('DOOR_')) continue;
    const object = house.getObjectByName(definition.object ?? `DOOR_${definition.id}`);
    const collider = collision.getObjectByName(definition.object ?? `DOOR_${definition.id}`);
    if (!object) throw new Error(`Tür fehlt im GLB: ${definition.id}`);
    const targets = [object, collider].filter(Boolean).map(target => {
      const parentRotation = new THREE.Quaternion();
      target.parent?.getWorldQuaternion(parentRotation);
      return { object: target, initial: target.quaternion.clone(),
        axis: axisWorld.clone().applyQuaternion(parentRotation.invert()) };
    });
    const initialAngle = Number(definition.openAngle ?? 0);
    doors.push({ id: definition.id, object, collider, definition, angle: initialAngle,
      setAngle(angle) {
        this.angle = THREE.MathUtils.clamp(angle, 0, definition.maxAngle ?? 105);
        const radians = THREE.MathUtils.degToRad((this.angle - initialAngle) * (definition.openDir ?? 1));
        for (const target of targets) {
          target.object.quaternion.copy(target.initial).premultiply(new THREE.Quaternion().setFromAxisAngle(target.axis, radians));
          target.object.updateWorldMatrix(true, true);
        }
      },
    });
  }

  let mode = 'baked';
  function alternate(record, material, index, targetMode) {
    const key = `${material.uuid}|${record.lightmap}|${targetMode}`;
    if (!alternateCache.has(key)) {
      let color = 0xffffff, map = null;
      if (targetMode === 'unlit') { color = material.color; map = material.map; }
      if (targetMode === 'lighting') { map = record.texture; if (!map) color = 0x222222; }
      if (targetMode === 'atlases') {
        const atlasIndex = atlasDefinitions.findIndex(atlas => atlas.path === record.lightmap);
        color = atlasIndex < 0 ? new THREE.Color(0x333333) : new THREE.Color().setHSL((atlasIndex * 0.61803398875) % 1, 0.6, 0.48);
      }
      alternateCache.set(key, new THREE.MeshBasicMaterial({ name: `debug-${targetMode}-${index}`,
        color, map, side: material.side, transparent: material.transparent, opacity: material.opacity,
        alphaMap: material.alphaMap, alphaTest: material.alphaTest, depthWrite: material.depthWrite,
        polygonOffset: material.polygonOffset, polygonOffsetFactor: material.polygonOffsetFactor,
        polygonOffsetUnits: material.polygonOffsetUnits, toneMapped: targetMode !== 'atlases' }));
    }
    return alternateCache.get(key);
  }
  const loadMs = performance.now() - started;
  return { level, house, collision, doors, records, atlases: textures, materialLibrary,
    setMode(value) {
      if (!['baked', 'lighting', 'atlases', 'unlit'].includes(value)) throw new Error(`Unbekannter Modus: ${value}`);
      mode = value;
      for (const record of records) {
        // A lightmap is opaque data, so it cannot replace a decal's coverage alpha.
        record.mesh.visible = record.visible && !(mode === 'lighting' && record.decal);
        const materials = mode === 'baked' ? record.baked : record.sources.map((material, index) => alternate(record, material, index, mode));
        record.mesh.material = record.array ? materials : materials[0];
      }
    },
    roomAt(position) {
      const [x, y, z] = position;
      const rooms = (level.rooms ?? []).filter(room => {
        const a = room.aabb;
        if (!a || x < a[0] || y < a[1] || z < a[2] || x > a[3] || y > a[4] || z > a[5]) return false;
        return room.polygon ? insidePolygon(x, z, room.polygon) : true;
      }).sort((a, b) => {
        const area = room => (room.aabb[3] - room.aabb[0]) * (room.aabb[5] - room.aabb[2]);
        return area(a) - area(b);
      });
      return rooms[0]?.id ?? 'OUT';
    },
    stats() {
      return { mode, meshes: records.length, mappedMeshes: records.filter(record => record.texture).length,
        unmappedMeshes, materials: materialCache.size, atlases: [...textures.values()].map(texture => texture.userData),
        downloadBytes: [...textures.values()].reduce((sum, texture) => sum + texture.userData.downloadBytes, 0),
        decodedBytes: [...textures.values()].reduce((sum, texture) => sum + texture.userData.decodedBytes, 0),
        collisionMeshes, collisionTriangles, doors: doors.map(door => ({ id: door.id, angle: door.angle })),
        loadMs, problems, sourceLights };
    },
    dispose() {
      const geometries = new Set(), materials = new Set(), allTextures = new Set(textures.values());
      for (const root of [house, collision]) root.traverse(object => {
        if (!object.isMesh) return;
        geometries.add(object.geometry);
        materialsOf(object).forEach(material => materials.add(material));
      });
      for (const record of records) record.sources.forEach(material => materials.add(material));
      for (const cache of [materialCache, alternateCache, materialLibrary.materials]) for (const material of cache.values()) materials.add(material);
      for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) allTextures.add(value);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of allTextures) texture.dispose();
    },
  };
}
