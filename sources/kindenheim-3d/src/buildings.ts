import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TerrainSystem } from './terrain';
import type { LandmarkManifest, LandmarkManifestEntry, VillageManifest } from './types';

export interface LoadedLandmarkInfo {
  key: string;
  name: string;
  position: THREE.Vector3;
  rotationY: number;
  size: THREE.Vector3;
  object: THREE.Object3D;
}

export interface BuildingLoadResult {
  group: THREE.Group;
  landmarks: Map<string, LoadedLandmarkInfo>;
  landmarkCount: number;
  villageChunkCount: number;
}

function tuneLoadedModelMaterials(root: THREE.Object3D, maxAnisotropy: number): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        mat.envMapIntensity = 0.78;
        if (mat.map) {
          mat.map.anisotropy = Math.min(8, maxAnisotropy);
        }
        if (mat.normalMap) {
          mat.normalMap.anisotropy = Math.min(4, maxAnisotropy);
        }
        if (mat.roughnessMap) {
          mat.roughnessMap.anisotropy = Math.min(4, maxAnisotropy);
        }
        // Keep roofs & stonework natural, avoid overly shiny plastic defaults
        if (!mat.roughnessMap && mat.roughness < 0.45 && mat.metalness < 0.25) {
          mat.roughness = 0.75;
        }
      }
    }
  });
}

function resolveLandmarkPosition(entry: LandmarkManifestEntry, terrain: TerrainSystem): THREE.Vector3 {
  let x = 0;
  let z = 0;
  let rawY: number | undefined;

  if (Array.isArray(entry.position) && entry.position.length >= 3) {
    x = entry.position[0];
    rawY = entry.position[1];
    z = entry.position[2];
  } else if (Array.isArray(entry.center) && entry.center.length >= 2) {
    x = entry.center[0];
    z = entry.center[1];
    rawY = entry.baseElevationM;
  }

  const terrainY = terrain.getTerrainHeight(x, z);
  let y = terrainY;

  if (typeof rawY === 'number' && Number.isFinite(rawY)) {
    // Use manifest baseElevationM when it's in relative terrain space (within 6m of terrain sample).
    // Guard against absolute NHN elevation if rawY is close to terrainY + minElevationM.
    if (Math.abs(rawY - terrainY) <= 6.0) {
      y = rawY;
    } else if (Math.abs(rawY - terrain.meta.minElevationM - terrainY) <= 6.0) {
      y = rawY - terrain.meta.minElevationM;
    }
  }

  return new THREE.Vector3(x, y, z);
}

export async function loadAllBuildings(
  landmarksManifest: LandmarkManifest | null,
  villageManifest: VillageManifest | null,
  terrain: TerrainSystem,
  maxAnisotropy: number,
  onSubProgress?: (done: number, total: number, label: string) => void
): Promise<BuildingLoadResult> {
  const group = new THREE.Group();
  group.name = 'KindenheimBuildings';

  const landmarksGroup = new THREE.Group();
  landmarksGroup.name = 'HeroLandmarks';
  group.add(landmarksGroup);

  const villageGroup = new THREE.Group();
  villageGroup.name = 'VillageChunks';
  group.add(villageGroup);

  const loader = new GLTFLoader();
  const landmarks = new Map<string, LoadedLandmarkInfo>();

  const landmarkEntries = landmarksManifest?.landmarks ?? [];
  const chunkEntries = villageManifest?.chunks ?? [];
  const totalJobs = landmarkEntries.length + chunkEntries.length;
  let finishedJobs = 0;
  let landmarkCount = 0;
  let villageChunkCount = 0;

  const landmarkTasks = landmarkEntries.map(async (entry, idx) => {
    const url = entry.glbPath;
    if (!url) return;
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      tuneLoadedModelMaterials(model, maxAnisotropy);

      const pos = resolveLandmarkPosition(entry, terrain);
      const rotY = entry.rotationRad ?? entry.rotationY ?? 0;

      model.position.copy(pos);
      model.rotation.y = rotY;
      if (typeof entry.scale === 'number') {
        model.scale.setScalar(entry.scale);
      } else if (Array.isArray(entry.scale) && entry.scale.length === 3) {
        model.scale.set(entry.scale[0], entry.scale[1], entry.scale[2]);
      }

      const key = (entry.key ?? entry.id ?? `landmark_${idx}`).toLowerCase();
      const name = entry.name ?? entry.key ?? `Wahrzeichen ${idx + 1}`;
      model.name = `Landmark_${key}`;
      model.userData = { landmarkKey: key, name, osmId: entry.osmId, osmIds: entry.osmIds };

      landmarksGroup.add(model);
      model.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      landmarks.set(key, {
        key,
        name,
        position: pos,
        rotationY: rotY,
        size,
        object: model,
      });
      landmarkCount++;
    } catch (err) {
      console.warn(`[buildings] Could not load landmark ${url}:`, err);
    } finally {
      finishedJobs++;
      onSubProgress?.(finishedJobs, totalJobs, `Lade Wahrzeichen (${finishedJobs}/${totalJobs})…`);
    }
  });

  const villageTasks = chunkEntries.map(async (chunk, idx) => {
    const url = chunk.glbPath;
    if (!url) return;
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      tuneLoadedModelMaterials(model, maxAnisotropy);
      model.name = chunk.name ? `Village_${chunk.name}` : `VillageChunk_${idx}`;
      villageGroup.add(model);
      villageChunkCount++;
    } catch (err) {
      console.warn(`[buildings] Could not load village chunk ${url}:`, err);
    } finally {
      finishedJobs++;
      onSubProgress?.(finishedJobs, totalJobs, `Lade Ortskern-Gebäude (${finishedJobs}/${totalJobs})…`);
    }
  });

  await Promise.all([...landmarkTasks, ...villageTasks]);

  return {
    group,
    landmarks,
    landmarkCount,
    villageChunkCount,
  };
}
