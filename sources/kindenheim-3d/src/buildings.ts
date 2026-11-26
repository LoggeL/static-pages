import * as THREE from 'three';
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { TerrainSystem } from './terrain';
import type { LandmarkManifest, LandmarkManifestEntry, TimeOfDayPreset, VillageManifest } from './types';
import { dedupeModelTextures } from './sharedAssets';
import { resolveAssetUrl } from './url';

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
  /** Time-of-day contract (see .gfx/BRIEF.md): fades the lit village windows in at dusk. */
  setTimeOfDay: (preset: TimeOfDayPreset, nightFactor: number) => void;
  /**
   * Quality contract (.gfx/review/FIXROUND.md). The village chunks carry their small facade furniture
   * (shutters, gutters, downpipes, gate frames, ivy leaf cards, weathering decals) in separate
   * `*_detail` meshes: `low` hides them, `medium` keeps them but out of the shadow pass.
   */
  setQuality: (level: BuildingQualityLevel) => void;
}

export type BuildingQualityLevel = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Village windows that glow at night are exported as separate materials named
 * `…_Glass_Lit_A|B|C` (same atlas textures as the unlit `…_Window_Glass`, plus an emissive map).
 * Each group switches on at a different point of the dusk ramp and has its own brightness and
 * colour temperature, so the village lights up house by house instead of all at once.
 */
const LIT_WINDOW_GROUPS: Record<string, { on: number; full: number; intensity: number; tint: [number, number, number] }> = {
  A: { on: 0.22, full: 0.62, intensity: 2.6, tint: [1.0, 0.86, 0.66] },
  B: { on: 0.38, full: 0.8, intensity: 1.7, tint: [1.0, 0.74, 0.5] },
  C: { on: 0.55, full: 0.95, intensity: 1.15, tint: [0.92, 0.9, 1.0] },
};
const LIT_WINDOW_RE = /Glass_Lit_([A-C])/;

interface LitWindowMaterial {
  material: THREE.MeshStandardMaterial;
  group: keyof typeof LIT_WINDOW_GROUPS;
}

/**
 * Generic post-load pass for every Blender-built GLB that goes through this loader (village chunks
 * AND hero landmarks): shadows + texture filtering only. Materials are trusted to be correct PBR as
 * authored (no forced roughness / env intensity), so the lighting pass can treat everything alike.
 */
function tuneLoadedModelMaterials(root: THREE.Object3D, maxAnisotropy: number, litOut?: LitWindowMaterial[]): void {
  const seen = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    // Everything casts, the window panes included: houses are hollow shells whose window openings are real
    // holes, so the glass is what keeps low sun from shining in one side and out the other.
    // Alpha-blended decals (weathering stains) are the one exception - a stain throws no shadow.
    const isDecalOnly = mats.length > 0 && mats.every((m) => m && /Decal/i.test(m.name));
    obj.castShadow = !isDecalOnly;
    obj.receiveShadow = true;
    if (isDecalOnly) obj.renderOrder = 2;

    for (const mat of mats) {
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      if (/Decal/i.test(mat.name)) {
        // coplanar-ish overlays 8 mm in front of the plaster: never write depth, pull towards the camera
        mat.transparent = true;
        mat.depthWrite = false;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -4;
      }
      if (mat.map) mat.map.anisotropy = Math.min(8, maxAnisotropy);
      if (mat.normalMap) mat.normalMap.anisotropy = Math.min(8, maxAnisotropy);
      if (mat.roughnessMap) mat.roughnessMap.anisotropy = Math.min(4, maxAnisotropy);
      if (mat.emissiveMap) mat.emissiveMap.anisotropy = Math.min(8, maxAnisotropy);

      const lit = litOut ? LIT_WINDOW_RE.exec(mat.name) : null;
      if (lit && litOut) {
        const group = lit[1] as keyof typeof LIT_WINDOW_GROUPS;
        const cfg = LIT_WINDOW_GROUPS[group];
        mat.emissive.setRGB(cfg.tint[0], cfg.tint[1], cfg.tint[2]);
        mat.emissiveIntensity = 0; // daylight: identical to the unlit glass
        litOut.push({ material: mat, group });
      }
    }
  });
}

/**
 * Village surface variation (material parts of the village look, see .gfx/review/POLISH.md):
 *  - roofs: the photo-scanned tile maps carry light / dark patches the size of a whole texture repeat; tiled
 *    over a roof plane they read as bands and a plaid from the drone height. The low-frequency part of the scan
 *    (coarser than a quarter repeat) is divided out against the map's mean, so only tile-scale detail repeats,
 *    and a non-repeating world-space variation (soot, lichen, replaced areas) is laid over it instead.
 *  - render: a faint world-space mottling so long walls are not one flat tone.
 * Both keep the authored mean colour (the aerial-sampled roof tone lives in the vertex colour).
 */
const VILLAGE_ROOF_RE = /^Pfalz_Roof_(Clay_Red|Clay_Weathered|Tiles_Dark|Slate)/;
const VILLAGE_PLASTER_RE = /^Pfalz_Plaster_(Smooth|Rough|Weathered)/;

const VILLAGE_VARIATION_PARS = /* glsl */ `
varying vec3 vKvWorld;
float kvHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float kvNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(kvHash(i), kvHash(i + vec2(1.0, 0.0)), u.x), mix(kvHash(i + vec2(0.0, 1.0)), kvHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const VILLAGE_ROOF_MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float kvTop = log2( float( textureSize( map, 0 ).x ) );
  vec3 kvLow = textureLod( map, vMapUv, kvTop - 2.0 ).rgb;
  vec3 kvMean = textureLod( map, vMapUv, kvTop ).rgb;
  sampledDiffuseColor.rgb *= clamp( kvMean / max( kvLow, vec3( 0.004 ) ), vec3( 0.55 ), vec3( 1.8 ) );
  diffuseColor *= sampledDiffuseColor;
#endif
{
  vec2 kvP = vKvWorld.xz;
  float kvA = kvNoise( kvP * 0.17 ) * 0.55 + kvNoise( kvP * 0.61 + 17.3 ) * 0.30 + kvNoise( kvP * 2.3 + 5.1 ) * 0.15;
  float kvB = kvNoise( kvP * 0.29 + 41.7 );
  diffuseColor.rgb *= 0.90 + 0.17 * kvA;
  float kvLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( kvLum ) * vec3( 0.95, 1.0, 0.92 ), 0.22 * smoothstep( 0.55, 0.95, kvB ) );
}
`;

const VILLAGE_PLASTER_MAP = /* glsl */ `
#include <map_fragment>
{
  vec2 kvP = vec2( vKvWorld.x + vKvWorld.z, vKvWorld.y );
  float kvA = kvNoise( kvP * vec2( 0.45, 0.8 ) ) * 0.6 + kvNoise( kvP * vec2( 1.7, 2.4 ) + 9.1 ) * 0.4;
  diffuseColor.rgb *= 0.955 + 0.075 * kvA;
}
`;

function applyVillageSurfaceVariation(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (!mat || seen.has(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue;
      seen.add(mat);
      const roof = VILLAGE_ROOF_RE.test(mat.name);
      if (!roof && !VILLAGE_PLASTER_RE.test(mat.name)) continue;
      if (roof && !mat.map) throw new Error(`[buildings] village roof material "${mat.name}" has no albedo map`);
      mat.onBeforeCompile = (shader) => {
        const vAnchor = '#include <worldpos_vertex>';
        const fAnchor = '#include <map_fragment>';
        if (!shader.vertexShader.includes(vAnchor) || !shader.fragmentShader.includes(fAnchor)) {
          throw new Error(`[buildings] three.js shader chunks changed: cannot patch village material "${mat.name}"`);
        }
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vKvWorld;')
          .replace(vAnchor, `${vAnchor}\nvKvWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${VILLAGE_VARIATION_PARS}`)
          .replace(fAnchor, roof ? VILLAGE_ROOF_MAP : VILLAGE_PLASTER_MAP);
      };
      mat.customProgramCacheKey = () => (roof ? 'kv-village-roof-v1' : 'kv-village-plaster-v1');
    }
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'target' in err) return 'network / decode error (see the browser console for the request)';
  return String(err);
}

/** URL -> texture promise, shared by every GLB parser of this page (external `uri` images only). */
const sharedExternalTextures = new Map<string, Promise<THREE.Texture>>();

/**
 * Makes a GLTFParser resolve external image URIs through one page-wide cache: the first parser that asks
 * for a URL loads it, every later one gets a clone that shares the same `Source` (one fetch, one decode,
 * one GPU upload; sampler state, colour space and texture name stay per clone).
 */
function installSharedExternalTextures(parser: GLTFParser): void {
  const original = parser.loadTextureImage.bind(parser);
  // GLTFLoader turns a texture that fails to fetch / decode into `null` (material silently loses its map).
  // Fail loud instead: the error reaches the chunk / landmark catch below, which names the GLB.
  const required = (p: Promise<THREE.Texture | null>, what: string, url?: string): Promise<THREE.Texture> =>
    p.then(async (tex) => {
      if (tex) return tex;
      if (!url) throw new Error(`texture ${what} could not be decoded`);
      // GLTFLoader drops the cause; one diagnostic request names it (network error, HTTP status or decode).
      let cause: string;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        cause = res.ok ? `the file loads (HTTP ${res.status}) but could not be decoded` : `HTTP ${res.status}`;
      } catch (err) {
        cause = `network error: ${describeError(err)}`;
      }
      throw new Error(`texture ${what} could not be loaded (${cause})`);
    });
  parser.loadTextureImage = (textureIndex: number, sourceIndex: number, texLoader: THREE.Loader): Promise<THREE.Texture> => {
    const sourceDef = (parser.json.images as Array<{ uri?: string; name?: string }> | undefined)?.[sourceIndex];
    const uri = sourceDef?.uri;
    if (typeof uri !== 'string' || uri.startsWith('data:')) {
      return required(original(textureIndex, sourceIndex, texLoader), `embedded image #${sourceIndex} "${sourceDef?.name ?? ''}"`);
    }
    const basePath = (parser.options as { path?: string }).path ?? '';
    const url = THREE.LoaderUtils.resolveURL(uri, basePath);
    const cached = sharedExternalTextures.get(url);
    if (!cached) {
      const first = required(original(textureIndex, sourceIndex, texLoader), url, url);
      sharedExternalTextures.set(url, first);
      return first;
    }
    return cached.then((base) => {
      const tex = base.clone();
      tex.name = base.name;
      parser.associations.set(tex, { textures: textureIndex });
      return tex;
    });
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
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

/** Night multiplier for landmark `Emissive` / `Lamp` materials (authored dim so they stay dark by day). */
const LANDMARK_NIGHT_GLOW_GAIN = 7;

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
  // Village chunks are Draco-compressed (≈300k triangles would otherwise be ~30 MB of vertex data).
  // The decoder (three's own build) is served next to the chunks; non-Draco GLBs are unaffected.
  const draco = new DRACOLoader();
  draco.setDecoderPath(resolveAssetUrl('assets/models/village/draco/'));
  loader.setDRACOLoader(draco);
  // The four village chunks reference the same external texture files. Without this each chunk's parser
  // fetches and decodes all of them again (the copies are then thrown away by the de-duplication).
  loader.register((parser: GLTFParser) => {
    installSharedExternalTextures(parser);
    return { name: 'KINDENHEIM_shared_external_textures' };
  });
  const litWindows: LitWindowMaterial[] = [];
  const villageDetailMeshes: THREE.Mesh[] = [];
  // Hero landmarks author their night-glow materials (leaded glass, clock dials, lanterns) dim, with
  // `Emissive` / `Lamp` in the name; they are ramped up with nightFactor in setTimeOfDay below.
  const landmarkGlow: { material: THREE.MeshStandardMaterial; dayIntensity: number }[] = [];
  // Dev hook for the village builder: `?villageDir=_wip` loads work-in-progress chunks from a sub-folder.
  const wipDir = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('villageDir') : null;
  const landmarks = new Map<string, LoadedLandmarkInfo>();

  // Both manifests are required data: a missing one must stop the load with a clear message.
  if (!landmarksManifest) throw new Error('[buildings] landmarks manifest missing (assets/models/landmarks/manifest.json did not load)');
  if (!villageManifest) throw new Error('[buildings] village manifest missing (assets/models/village/manifest.json did not load)');
  const landmarkEntries = landmarksManifest.landmarks;
  const chunkEntries = villageManifest.chunks;
  if (!Array.isArray(chunkEntries) || chunkEntries.length === 0) {
    throw new Error('[buildings] village manifest lists no chunks - the village cannot be built');
  }
  if (!Array.isArray(landmarkEntries)) throw new Error('[buildings] landmarks manifest has no "landmarks" array');
  const totalJobs = landmarkEntries.length + chunkEntries.length;
  let finishedJobs = 0;
  let loadFailed = false;
  let landmarkCount = 0;
  let villageChunkCount = 0;

  const landmarkTasks = landmarkEntries.map(async (entry, idx) => {
    const url = entry.glbPath;
    if (!url) throw new Error(`[buildings] landmark #${idx} (${entry.key ?? entry.id ?? '?'}) has no glbPath in the landmarks manifest`);
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      dedupeModelTextures(model);
      tuneLoadedModelMaterials(model, maxAnisotropy);
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshStandardMaterial;
          if (!std || !std.isMeshStandardMaterial || !/Emissive|Lamp/i.test(std.name)) continue;
          if (landmarkGlow.some((g) => g.material === std)) continue;
          landmarkGlow.push({ material: std, dayIntensity: std.emissiveIntensity });
        }
      });

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
      loadFailed = true;
      throw new Error(`[buildings] Failed to load landmark ${url}: ${describeError(err)}`, { cause: err });
    } finally {
      finishedJobs++;
      // After the first failure no more progress: the load is lost and the error is what the player must see.
      if (!loadFailed) onSubProgress?.(finishedJobs, totalJobs, `Lade Wahrzeichen (${finishedJobs}/${totalJobs})…`);
    }
  });

  const villageTasks = chunkEntries.map(async (chunk, idx) => {
    let url = chunk.glbPath;
    if (!url) throw new Error(`[buildings] village chunk #${idx} has no glbPath in the village manifest`);
    if (wipDir && /^[\w-]+$/.test(wipDir)) url = url.replace(/\/(village_[^/]+\.glb)$/, `/${wipDir}/$1`);
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      dedupeModelTextures(model);
      tuneLoadedModelMaterials(model, maxAnisotropy, litWindows);
      applyVillageSurfaceVariation(model);
      // `<chunk>_detail` node = small facade furniture; its meshes are the quality lever (see setQuality)
      model.traverse((obj) => {
        if (!/_detail$/.test(obj.name)) return;
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) villageDetailMeshes.push(child as THREE.Mesh);
        });
      });
      model.name = chunk.name ? `Village_${chunk.name}` : `VillageChunk_${idx}`;
      villageGroup.add(model);
      villageChunkCount++;
    } catch (err) {
      loadFailed = true;
      throw new Error(`[buildings] Failed to load village chunk ${url}: ${describeError(err)}`, { cause: err });
    } finally {
      finishedJobs++;
      if (!loadFailed) onSubProgress?.(finishedJobs, totalJobs, `Lade Ortskern-Gebäude (${finishedJobs}/${totalJobs})…`);
    }
  });

  // Every job is waited for (no decoder disposed under a running parse) and every failure is reported, not
  // only the first one.
  const settled = await Promise.allSettled([...landmarkTasks, ...villageTasks]);
  draco.dispose();
  const failures = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
  if (failures.length > 0) {
    const lines = failures.map((reason) => `- ${reason instanceof Error ? reason.message : String(reason)}`);
    throw new AggregateError(
      failures,
      `${failures.length} von ${totalJobs} Gebäudemodellen konnten nicht geladen werden:\n${lines.join('\n')}`
    );
  }

  const detailCastsShadow = villageDetailMeshes.map((m) => m.castShadow);
  const setQuality = (level: BuildingQualityLevel): void => {
    villageDetailMeshes.forEach((mesh, i) => {
      mesh.visible = level !== 'low';
      mesh.castShadow = detailCastsShadow[i] && (level === 'high' || level === 'ultra');
    });
  };

  // The same material name exists once per chunk GLB; all of them follow the same ramp.
  const setTimeOfDay = (_preset: TimeOfDayPreset, nightFactor: number): void => {
    const n = Number.isFinite(nightFactor) ? Math.min(1, Math.max(0, nightFactor)) : 0;
    for (const { material, group: g } of litWindows) {
      const cfg = LIT_WINDOW_GROUPS[g];
      material.emissiveIntensity = cfg.intensity * smoothstep(cfg.on, cfg.full, n);
    }
    for (const { material, dayIntensity } of landmarkGlow) {
      material.emissiveIntensity = dayIntensity * (1 + LANDMARK_NIGHT_GLOW_GAIN * n);
    }
  };

  return {
    group,
    landmarks,
    landmarkCount,
    villageChunkCount,
    setTimeOfDay,
    setQuality,
  };
}
