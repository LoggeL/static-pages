export interface BoundsWGS84 {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface LatLonAffine {
  dX_dLon: number;
  dX_dLat: number;
  dZ_dLon: number;
  dZ_dLat: number;
}

export interface MetaData {
  centerLat: number;
  centerLon: number;
  mapSizeM: number;
  boundsWGS84?: BoundsWGS84;
  projection?: {
    crs?: string;
    latLonToLocalAffine?: LatLonAffine;
  };
  minElevationM: number;
  maxElevationM: number;
  gridSize: number;
  imagerySource?: string;
  demSource?: string;
  buildingsSource?: string;
  buildingCount?: number;
  roadCount?: number;
  fieldCount?: number;
  vineyardCount?: number;
  treeCount?: number;
  landuseClasses?: Record<string, unknown>;
  landuseMaskLegend?: Record<string, { classId: number; r: number; rgb: [number, number, number] }>;
}

export interface BuildingRecord {
  id: string | number;
  name?: string;
  landmarkKey?: string | null;
  footprint: [number, number][];
  center: [number, number];
  widthM?: number;
  depthM?: number;
  rotationRad?: number;
  baseElevationM?: number;
  wallHeightM?: number;
  roofHeightM?: number;
  roofShape?: string;
  levels?: number;
  category?: string;
  addr?: string | Record<string, string>;
  tower?: {
    center?: [number, number];
    footprint?: [number, number][];
    totalHeightM?: number;
  };
}

export interface RoadRecord {
  id: string | number;
  name?: string;
  ref?: string;
  highway: string;
  widthM?: number;
  surface?: string;
  points: ([number, number] | [number, number, number])[];
}

export interface LanduseRecord {
  id: string | number;
  type: string;
  name?: string;
  areaHa?: number;
  points: [number, number][];
  rowAngleRad?: number;
  centroid?: [number, number];
}

export interface TreeRecord {
  id?: string | number;
  x?: number;
  y?: number;
  z?: number;
  position?: [number, number] | [number, number, number];
  point?: [number, number];
  species?: string;
  type?: string;
  heightM?: number;
  scale?: number;
  rotationRad?: number;
}

export interface PoiRecord {
  id?: string | number;
  name?: string;
  type?: string;
  amenity?: string;
  x?: number;
  y?: number;
  z?: number;
  rotationRad?: number;
  position?: [number, number] | [number, number, number];
}

export interface WaterwayRecord {
  id: string | number;
  name?: string | null;
  waterway?: string;
  widthM?: number;
  points: ([number, number] | [number, number, number])[];
}

export interface SceneData {
  buildings: BuildingRecord[];
  roads: RoadRecord[];
  landuse: LanduseRecord[];
  waterways?: WaterwayRecord[];
  trees?: TreeRecord[];
  pois?: PoiRecord[];
}

export interface LandmarkManifestEntry {
  key?: string;
  id?: string;
  name?: string;
  osmId?: string | number;
  osmIds?: (string | number)[];
  glbPath?: string;
  glb?: string;
  file?: string;
  path?: string;
  center?: [number, number];
  position?: [number, number, number];
  baseElevationM?: number;
  rotationRad?: number;
  rotationY?: number;
  scale?: number | [number, number, number];
  footprintWidthM?: number;
  footprintDepthM?: number;
}

export interface LandmarkManifest {
  landmarks: LandmarkManifestEntry[];
  excludedOsmIds?: (string | number)[];
}

export interface VillageChunkEntry {
  name?: string;
  glbPath?: string;
  glb?: string;
  file?: string;
  path?: string;
  buildingCount?: number;
}

export interface VillagePropEntry {
  name?: string;
  key?: string;
  glbPath?: string;
  glb?: string;
  file?: string;
  path?: string;
  size?: [number, number, number] | { x: number; y: number; z: number; width?: number; height?: number; depth?: number };
  dimensions?: [number, number, number] | { width?: number; height?: number; depth?: number; length?: number };
  bbox?: { min?: number[]; max?: number[]; size?: number[] };
}

export interface VillageManifest {
  chunks: VillageChunkEntry[];
  props: Record<string, VillagePropEntry | string>;
  excludedLandmarkIds?: (string | number)[];
  buildingCount?: number;
}

export interface BraveReferenceEntry {
  id: string;
  title: string;
  file: string;
  source: string;
  lat: number;
  lon: number;
  localX?: number;
  localZ?: number;
  headingDeg: number;
  pitchDeg: number;
  cameraHeightM: number;
  fovDeg?: number;
  architecturalNotes?: string;
}

export interface BraveReferenceManifest {
  capturedAt?: string;
  references: BraveReferenceEntry[];
}

export interface TractorManifest {
  forwardAxis?: string;
  tractorGlb?: string;
  trailerGlb?: string;
  tractorBounds?: { min?: number[]; max?: number[]; size?: number[] };
  frontWheelRadius?: number;
  rearWheelRadius?: number;
  wheelPositions?: {
    FL?: [number, number, number];
    FR?: [number, number, number];
    RL?: [number, number, number];
    RR?: [number, number, number];
  };
  cabCameraOffset?: [number, number, number];
  exhaustTipOffset?: [number, number, number];
  beaconOffset?: [number, number, number];
  headlightOffsets?: [number, number, number][];
  taillightOffsets?: [number, number, number][];
  rearHitchOffset?: [number, number, number];
  trailerHitchOffset?: [number, number, number];
  trailerWheelRadius?: number;
  trailerAxleOffsetZ?: number;
}

export type TimeOfDayPreset = 'morning' | 'noon' | 'golden' | 'dusk';
export type CameraMode = 'chase' | 'cab' | 'drone';
export type BenchmarkLayout = 'pip' | 'split' | 'ghost' | 'diff';

export interface CameraBookmark {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  fovDeg?: number;
  refId?: string;
}

export type LoadStage = 'terrain' | 'orthophoto' | 'buildings' | 'scenery';

export interface LoadedDataset {
  meta: MetaData;
  heightmap: Float32Array;
  scene: SceneData;
  braveRefs: BraveReferenceManifest | null;
  landmarksManifest: LandmarkManifest | null;
  villageManifest: VillageManifest | null;
  tractorManifest: TractorManifest | null;
}
