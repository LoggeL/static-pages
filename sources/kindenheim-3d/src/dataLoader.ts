import type {
  BraveReferenceEntry,
  BraveReferenceManifest,
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

async function fetchJsonOptional<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(resolveAssetUrl(url));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchBinaryOptional(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(resolveAssetUrl(url));
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
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

function createSyntheticFallbackHeightmap(gridSize: number): Float32Array {
  const arr = new Float32Array(gridSize * gridSize);
  for (let r = 0; r < gridSize; r++) {
    const nz = r / (gridSize - 1) - 0.5;
    for (let c = 0; c < gridSize; c++) {
      const nx = c / (gridSize - 1) - 0.5;
      const h = 28 + (-nx * 26 - nz * 14) + Math.sin(nx * 5.2) * 5.0 + Math.cos(nz * 4.7) * 4.0;
      arr[r * gridSize + c] = Math.max(0, h);
    }
  }
  return arr;
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

export async function loadAllDatasetMetadata(onProgress?: ProgressCallback): Promise<LoadedDataset> {
  onProgress?.('terrain', 8, 'Lade Geodaten & Höhenmodell…');

  const [metaRaw, hmBuf, sceneRaw, braveRaw, landmarksRaw, villageRaw, tractorRaw] = await Promise.all([
    fetchJsonOptional<MetaData>('/data/meta.json'),
    fetchBinaryOptional('/data/terrain/heightmap.bin'),
    fetchJsonOptional<SceneData>('/data/osm/kindenheim_scene.json'),
    fetchJsonOptional<unknown>('/data/references/brave/manifest.json'),
    fetchJsonOptional<unknown>('/assets/models/landmarks/manifest.json'),
    fetchJsonOptional<unknown>('/assets/models/village/manifest.json'),
    fetchJsonOptional<unknown>('/assets/models/tractor/manifest.json'),
  ]);

  const meta: MetaData = metaRaw ?? {
    centerLat: 49.6108,
    centerLon: 8.1636,
    mapSizeM: 2048,
    minElevationM: 155,
    maxElevationM: 245,
    gridSize: 513,
    imagerySource: 'Fallback',
    demSource: 'Fallback',
  };

  let heightmap: Float32Array;
  if (hmBuf && hmBuf.byteLength >= 16) {
    const floats = new Float32Array(hmBuf);
    const inferredGrid = Math.round(Math.sqrt(floats.length));
    if (inferredGrid * inferredGrid === floats.length) {
      meta.gridSize = inferredGrid;
    }
    heightmap = floats;
  } else {
    meta.gridSize = meta.gridSize || 257;
    heightmap = createSyntheticFallbackHeightmap(meta.gridSize);
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
  const landmarksManifest = normalizeLandmarkManifest(landmarksRaw);
  const villageManifest = normalizeVillageManifest(villageRaw);
  const tractorManifest = normalizeTractorManifest(tractorRaw);

  onProgress?.('terrain', 22, 'Höhenmodell bereit, erstelle Gelände…');

  return {
    meta,
    heightmap,
    scene,
    braveRefs,
    landmarksManifest,
    villageManifest,
    tractorManifest,
  };
}
