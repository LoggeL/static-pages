import type {
  BraveReferenceEntry,
  BraveReferenceManifest,
  FieldsLayoutData,
  FieldsManifest,
  FieldsManifestModel,
  LandmarkManifest,
  LandmarkManifestEntry,
  LoadedDataset,
  LoadStage,
  MetaData,
  SceneData,
  TractorManifest,
  VillageChunkEntry,
  VillageManifest,
  VillagePropEntry,
} from './types';
import { resolveAssetUrl } from './url';

export type ProgressCallback = (stage: LoadStage, percent: number, statusText: string) => void;

/** A static host or SPA fallback that answers a missing path with its index page (HTTP 200, text/html). */
function isHtmlFallback(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('text/html');
}

/** Required data the world cannot be built without: a missing or broken file aborts start-up with its name. */
async function fetchRequired(url: string): Promise<Response> {
  const resolved = resolveAssetUrl(url);
  let res: Response;
  try {
    res = await fetch(resolved);
  } catch (err) {
    throw new Error(`Data: network error while loading ${resolved}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Data: ${resolved} answered HTTP ${res.status}`);
  if (isHtmlFallback(res)) {
    throw new Error(`Data: ${resolved} is missing (the server answered with an HTML page instead of the file)`);
  }
  return res;
}

async function fetchJsonRequired<T>(url: string): Promise<T> {
  const text = await (await fetchRequired(url)).text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Data: ${url} is not valid JSON (starts with "${text.slice(0, 40).replace(/\s+/g, ' ')}")`);
  }
}

function requireManifest<T>(value: T | null, url: string, what: string): T {
  if (value === null) throw new Error(`Data: ${url} was loaded but contains no usable ${what}`);
  return value;
}

/** Ground obstacles for the road builder: building footprints (scene JSON) + landmark model boxes (manifest). */
let loadedObstacles: [number, number][][] | null = null;

/**
 * Outlines (world x, z, metres) that roads and sidewalks must keep clear of. Available once
 * `loadAllDatasetMetadata` has resolved; throws before that instead of handing out an empty list.
 */
export function getGroundObstacles(): [number, number][][] {
  if (!loadedObstacles) throw new Error('getGroundObstacles: loadAllDatasetMetadata() has not finished yet');
  return loadedObstacles;
}

function normalizeUrlPath(raw: string | undefined, basePrefix: string): string {
  if (!raw) return '';
  if (/^(?:https?:|data:|blob:|\/\/)/i.test(raw)) {
    return raw;
  }
  const cleaned = raw.replace(/^\.\//, '').replace(/^\/+/, '').replace(/^public\//, '');
  if (cleaned.startsWith('assets/') || cleaned.startsWith('data/')) {
    return resolveAssetUrl(cleaned);
  }
  const cleanPrefix = basePrefix.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return resolveAssetUrl(`${cleanPrefix}/${cleaned}`);
}

export function normalizeLandmarkManifest(raw: unknown): LandmarkManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  let list: LandmarkManifestEntry[] = [];
  if (Array.isArray(raw)) {
    list = raw as LandmarkManifestEntry[];
  } else if (Array.isArray(obj.landmarks)) {
    list = obj.landmarks as LandmarkManifestEntry[];
  } else if (Array.isArray(obj.models)) {
    list = obj.models as LandmarkManifestEntry[];
  } else if (obj.landmarks && typeof obj.landmarks === 'object') {
    list = Object.entries(obj.landmarks as Record<string, Record<string, unknown>>).map(([key, val]) => ({
      key,
      ...(val as LandmarkManifestEntry),
    }));
  }

  const normalized = list.map((item) => {
    const glbRaw = item.glbPath ?? item.glb ?? item.path ?? item.file ?? '';
    return {
      ...item,
      glbPath: normalizeUrlPath(glbRaw, '/assets/models/landmarks'),
    };
  });

  const excluded = Array.isArray(obj.excludedOsmIds)
    ? (obj.excludedOsmIds as (string | number)[])
    : Array.isArray(obj.excluded_osm_ids)
      ? (obj.excluded_osm_ids as (string | number)[])
      : undefined;

  return {
    landmarks: normalized.filter((l) => Boolean(l.glbPath)),
    excludedOsmIds: excluded,
  };
}

export function normalizeVillageManifest(raw: unknown): VillageManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const rawChunks = (obj.chunks ?? obj.buildingChunks ?? obj.villageChunks ?? obj.buildings ?? []) as unknown[];
  const chunks: VillageChunkEntry[] = [];

  if (Array.isArray(rawChunks)) {
    for (const c of rawChunks) {
      if (typeof c === 'string') {
        chunks.push({ glbPath: normalizeUrlPath(c, '/assets/models/village') });
      } else if (c && typeof c === 'object') {
        const ce = c as VillageChunkEntry;
        const p = ce.glbPath ?? ce.glb ?? ce.path ?? ce.file ?? '';
        if (p) {
          chunks.push({ ...ce, glbPath: normalizeUrlPath(p, '/assets/models/village') });
        }
      }
    }
  }

  const props: Record<string, VillagePropEntry> = {};
  const rawProps = obj.props;
  if (Array.isArray(rawProps)) {
    for (const item of rawProps) {
      if (typeof item === 'string') {
        const baseName = item.split('/').pop()?.replace(/\.glb$/i, '') ?? item;
        props[baseName] = { name: baseName, glbPath: normalizeUrlPath(item, '/assets/models/village/props') };
      } else if (item && typeof item === 'object') {
        const pe = item as VillagePropEntry;
        const p = pe.glbPath ?? pe.glb ?? pe.path ?? pe.file ?? '';
        const key = pe.key ?? pe.name ?? p.split('/').pop()?.replace(/\.glb$/i, '') ?? '';
        if (key && p) {
          props[key] = { ...pe, name: key, glbPath: normalizeUrlPath(p, '/assets/models/village/props') };
        }
      }
    }
  } else if (rawProps && typeof rawProps === 'object') {
    for (const [k, v] of Object.entries(rawProps as Record<string, unknown>)) {
      if (typeof v === 'string') {
        props[k] = { name: k, glbPath: normalizeUrlPath(v, '/assets/models/village/props') };
      } else if (v && typeof v === 'object') {
        const pe = v as VillagePropEntry;
        const p = pe.glbPath ?? pe.glb ?? pe.path ?? pe.file ?? '';
        if (p) {
          props[k] = { ...pe, name: pe.name ?? k, glbPath: normalizeUrlPath(p, '/assets/models/village/props') };
        }
      }
    }
  }

  return {
    chunks,
    props,
    excludedLandmarkIds: (obj.excludedLandmarkIds ?? obj.excluded_landmark_ids) as (string | number)[] | undefined,
    buildingCount:
      typeof obj.totalVillageBuildings === 'number'
        ? obj.totalVillageBuildings
        : typeof obj.buildingCount === 'number'
          ? obj.buildingCount
          : undefined,
  };
}

export function normalizeBraveReferences(raw: unknown): BraveReferenceManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawList = Array.isArray(raw)
    ? raw
    : Array.isArray(obj.references)
      ? obj.references
      : Array.isArray(obj.shots)
        ? obj.shots
        : Array.isArray(obj.views)
          ? obj.views
          : Array.isArray(obj.items)
            ? obj.items
            : [];

  const refs: BraveReferenceEntry[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const r = rawList[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object') continue;
    const rawFile = String(r.file ?? r.image ?? r.path ?? r.url ?? '');
    if (!rawFile) continue;
    const lat = Number(r.lat ?? r.latitude ?? 49.6108);
    const lon = Number(r.lon ?? r.lng ?? r.longitude ?? 8.1636);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    refs.push({
      id: String(r.id ?? `ref_${i + 1}`),
      title: String(r.title ?? r.name ?? r.label ?? `Referenz ${i + 1}`),
      file: normalizeUrlPath(rawFile, '/data/references/brave'),
      source: String(r.source ?? 'Google Street View'),
      lat,
      lon,
      localX: typeof r.localX === 'number' && Number.isFinite(r.localX) ? r.localX : undefined,
      localZ: typeof r.localZ === 'number' && Number.isFinite(r.localZ) ? r.localZ : undefined,
      headingDeg: Number(r.headingDeg ?? r.heading ?? r.yawDeg ?? 0),
      pitchDeg: Number(r.pitchDeg ?? r.pitch ?? -4),
      cameraHeightM: Number(r.cameraHeightM ?? r.heightM ?? r.altitudeM ?? 2.5),
      fovDeg: typeof r.fovDeg === 'number' ? r.fovDeg : undefined,
      architecturalNotes:
        typeof r.architecturalNotes === 'string'
          ? r.architecturalNotes
          : typeof r.notes === 'string'
            ? r.notes
            : undefined,
    });
  }

  return {
    capturedAt: typeof obj.capturedAt === 'string' ? obj.capturedAt : undefined,
    references: refs,
  };
}

export function normalizeTractorManifest(raw: unknown): TractorManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const tractorRaw =
    typeof obj.tractorGlbPath === 'string'
      ? obj.tractorGlbPath
      : typeof obj.tractorGlb === 'string'
        ? obj.tractorGlb
        : typeof (obj.tractor as Record<string, unknown> | undefined)?.glbPath === 'string'
          ? String((obj.tractor as Record<string, unknown>).glbPath)
          : '/assets/models/tractor/tractor.glb';
  const trailerRaw =
    typeof obj.trailerGlbPath === 'string'
      ? obj.trailerGlbPath
      : typeof obj.trailerGlb === 'string'
        ? obj.trailerGlb
        : typeof (obj.trailer as Record<string, unknown> | undefined)?.glbPath === 'string'
          ? String((obj.trailer as Record<string, unknown>).glbPath)
          : '/assets/models/tractor/trailer.glb';

  return {
    ...(obj as TractorManifest),
    tractorGlb: normalizeUrlPath(tractorRaw, '/assets/models/tractor'),
    trailerGlb: normalizeUrlPath(trailerRaw, '/assets/models/tractor'),
  };
}

export function normalizeFieldsManifest(raw: unknown): FieldsManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.available === false) return null;

  const models: Record<string, FieldsManifestModel> = {};
  const addEntry = (keyHint: string, val: unknown) => {
    if (typeof val === 'string') {
      const k = keyHint || val.split('/').pop()?.replace(/\.glb$/i, '') || '';
      if (k) models[k] = { key: k, name: k, glbPath: normalizeUrlPath(val, 'assets/models/fields') };
      return;
    }
    if (!val || typeof val !== 'object') return;
    const e = val as Record<string, unknown>;
    const rawPath = String(e.glbPath ?? e.glb ?? e.path ?? e.file ?? '');
    if (!rawPath) return;
    const k = String(e.key ?? e.id ?? e.name ?? keyHint ?? rawPath.split('/').pop()?.replace(/\.glb$/i, '') ?? '');
    if (!k) return;
    const sp = (e.spacing ?? e.instancing ?? (e.recommendedSpacing && !Array.isArray(e.recommendedSpacing) ? e.recommendedSpacing : {})) as Record<string, unknown>;
    const recArr = Array.isArray(e.recommendedSpacing) ? (e.recommendedSpacing as number[]) : null;
    models[k] = {
      key: k,
      name: String(e.name ?? k),
      glbPath: normalizeUrlPath(rawPath, 'assets/models/fields'),
      bounds: Array.isArray(e.bounds) ? (e.bounds as [number, number, number]) : undefined,
      spacingM:
        typeof e.spacingM === 'number'
          ? e.spacingM
          : typeof e.recommendedGridSpacingM === 'number'
            ? e.recommendedGridSpacingM
            : typeof sp.gridM === 'number'
              ? sp.gridM
              : typeof sp.gridSpacingM === 'number'
                ? sp.gridSpacingM
                : typeof sp.spacingM === 'number'
                  ? sp.spacingM
                  : recArr && typeof recArr[0] === 'number'
                    ? recArr[0]
                    : undefined,
      alongRowM:
        typeof e.alongRowM === 'number'
          ? e.alongRowM
          : typeof sp.alongRowM === 'number'
            ? sp.alongRowM
            : typeof sp.alongStripM === 'number'
              ? sp.alongStripM
              : undefined,
      betweenBaysM:
        typeof e.betweenBaysM === 'number'
          ? e.betweenBaysM
          : typeof sp.betweenBaysM === 'number'
            ? sp.betweenBaysM
            : typeof sp.betweenRowsM === 'number'
              ? sp.betweenRowsM
              : undefined,
      windSway: typeof e.windSway === 'number' ? e.windSway : typeof e.windSwayStrength === 'number' ? e.windSwayStrength : undefined,
    };
  };

  for (const bucketKey of ['models', 'crops', 'props', 'assets']) {
    const bucket = obj[bucketKey];
    if (Array.isArray(bucket)) {
      for (const item of bucket) addEntry('', item);
    } else if (bucket && typeof bucket === 'object') {
      for (const [k, v] of Object.entries(bucket as Record<string, unknown>)) {
        addEntry(k, v);
      }
    }
  }

  // Also check top-level entries in case manifest directly maps model keys -> entries
  if (Object.keys(models).length === 0) {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && ('glbPath' in v || 'glb' in v || 'path' in v || 'file' in v)) {
        addEntry(k, v);
      }
    }
  }

  return Object.keys(models).length > 0 ? { models } : null;
}

export async function loadAllDatasetMetadata(onProgress?: ProgressCallback): Promise<LoadedDataset> {
  onProgress?.('terrain', 8, 'Lade Geodaten & Höhenmodell…');

  const [metaRaw, hmBuf, sceneRaw, braveRaw, landmarksRaw, villageRaw, tractorRaw, fieldsLayoutRaw] = await Promise.all([
    fetchJsonRequired<MetaData>('/data/meta.json'),
    fetchRequired('/data/terrain/heightmap.bin').then((r) => r.arrayBuffer()),
    fetchJsonRequired<SceneData>('/data/osm/kindenheim_scene.json'),
    fetchJsonRequired<unknown>('/data/references/brave/manifest.json'),
    fetchJsonRequired<unknown>('/assets/models/landmarks/manifest.json'),
    fetchJsonRequired<unknown>('/assets/models/village/manifest.json'),
    fetchJsonRequired<unknown>('/assets/models/tractor/manifest.json'),
    fetchJsonRequired<FieldsLayoutData>('/data/osm/fields_layout.json'),
  ]);

  if (fieldsLayoutRaw.available === false || !Array.isArray(fieldsLayoutRaw.fields)) {
    throw new Error('Data: data/osm/fields_layout.json has no "fields" array (run scripts/build_fields_layout.py)');
  }
  const fieldsLayout = fieldsLayoutRaw;
  const fieldsManifestRaw = await fetchJsonRequired<unknown>('/assets/models/fields/manifest.json');

  const meta: MetaData = metaRaw;
  if (!(meta.mapSizeM > 0) || !Number.isFinite(meta.minElevationM)) {
    throw new Error('Geodata: data/meta.json lacks mapSizeM / minElevationM');
  }
  if (hmBuf.byteLength % 4 !== 0) {
    throw new Error(`Geodata: data/terrain/heightmap.bin has ${hmBuf.byteLength} bytes, not a Float32 array`);
  }
  const heightmap = new Float32Array(hmBuf);
  const grid = Math.round(Math.sqrt(heightmap.length));
  if (grid < 2 || grid * grid !== heightmap.length) {
    throw new Error(`Geodata: data/terrain/heightmap.bin holds ${heightmap.length} samples, which is not a square grid`);
  }
  if (meta.gridSize && meta.gridSize !== grid) {
    throw new Error(`Geodata: heightmap.bin is ${grid} x ${grid} but data/meta.json says gridSize ${meta.gridSize}`);
  }
  meta.gridSize = grid;
  if (!Array.isArray(sceneRaw.roads) || !Array.isArray(sceneRaw.buildings)) {
    throw new Error('Geodata: data/osm/kindenheim_scene.json has no roads / buildings arrays');
  }

  const scene: SceneData = {
    buildings: Array.isArray(sceneRaw?.buildings) ? sceneRaw.buildings : [],
    roads: Array.isArray(sceneRaw?.roads) ? sceneRaw.roads : [],
    landuse: Array.isArray(sceneRaw?.landuse) ? sceneRaw.landuse : [],
    waterways: Array.isArray(sceneRaw?.waterways) ? sceneRaw.waterways : [],
    trees: Array.isArray(sceneRaw?.trees) ? sceneRaw.trees : [],
    pois: Array.isArray(sceneRaw?.pois) ? sceneRaw.pois : [],
  };

  const braveRefs = normalizeBraveReferences(braveRaw);
  const landmarksManifest = requireManifest(normalizeLandmarkManifest(landmarksRaw), 'assets/models/landmarks/manifest.json', 'landmark list');
  const villageManifest = requireManifest(normalizeVillageManifest(villageRaw), 'assets/models/village/manifest.json', 'chunk list');
  const tractorManifest = requireManifest(normalizeTractorManifest(tractorRaw), 'assets/models/tractor/manifest.json', 'tractor entry');
  const fieldsManifest = requireManifest(normalizeFieldsManifest(fieldsManifestRaw), 'assets/models/fields/manifest.json', 'model list');
  if (landmarksManifest.landmarks.length === 0) throw new Error('Data: assets/models/landmarks/manifest.json lists no landmarks');
  if (villageManifest.chunks.length === 0) throw new Error('Data: assets/models/village/manifest.json lists no village chunks');

  // Obstacles for roads / sidewalks: every building footprint (towers included) and each landmark model's box.
  const obstacles: [number, number][][] = [];
  for (const b of sceneRaw.buildings) {
    if (Array.isArray(b.footprint) && b.footprint.length >= 3) obstacles.push(b.footprint);
    if (b.tower?.footprint && b.tower.footprint.length >= 3) obstacles.push(b.tower.footprint);
  }
  for (const lm of landmarksManifest.landmarks) {
    if (!lm.center || !(lm.footprintWidthM && lm.footprintDepthM) || typeof lm.rotationRad !== 'number') continue;
    const c = Math.cos(lm.rotationRad);
    const sn = Math.sin(lm.rotationRad);
    const hw = lm.footprintWidthM / 2;
    const hd = lm.footprintDepthM / 2;
    // rotation.y = r: local +X -> (cos r, -sin r), local +Z -> (sin r, cos r) in world (x, z)
    obstacles.push(
      ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as [number, number][]).map(
        ([lx, lz]) => [lm.center![0] + lx * c + lz * sn, lm.center![1] - lx * sn + lz * c] as [number, number]
      )
    );
  }
  loadedObstacles = obstacles;

  onProgress?.('terrain', 22, 'Höhenmodell bereit, erstelle Gelände…');

  return {
    meta,
    heightmap,
    scene,
    braveRefs,
    landmarksManifest,
    villageManifest,
    tractorManifest,
    fieldsLayout,
    fieldsManifest,
  };
}
