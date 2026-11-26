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
  /** Vegetation LOD assets: GLB child nodes are named `<nodePrefix>_<LOD0|LOD1|LOD2|FAR>`. */
  nodePrefix?: string;
  lods?: Record<string, { node: string; triangles?: number }>;
  heightM?: number;
  crownCenter?: number[];
  crownRadius?: number[];
  bayLengthM?: number;
  rowSpacingM?: number;
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
  /** Rear cab work lamps (tractor-local): origin of the spot that lights the hitch / trailer load. */
  workLightRearOffset?: [number, number, number];
  /** Tail lamp lens centres on the trailer (trailer-local) for the glow sprites. */
  trailerTaillightOffsets?: [number, number, number][];
  /** Baked AO / cavity / edge atlases (file names next to the GLBs), sampled with the second UV set. */
  tractorBakeMap?: string;
  trailerBakeMap?: string;
  /** Visual rig helpers written by blender/tractor/build_tractor.py (tractor-local metres). */
  frontAxlePivot?: [number, number, number];
  steerArmEnds?: [number, number, number][];
  driver?: {
    shoulders: [number, number, number][];
    upperArm: number;
    foreArm: number;
    handRadius: number;
    handAnglesDeg: number[];
    hideRadius: number;
  };
  /** Hydraulic / lighting line sockets on the tractor and where the trailer's lines leave its hose rest. */
  hoseAnchors?: [number, number, number][];
  trailerHoseAnchors?: [number, number, number][];
  /** Float32 file next to the GLBs: loose grape berries on the load (x, y, z, radius, tint) * n, trailer-local. */
  grapeBerriesBin?: string;
  /** Mirror glass planes for optional planar reflections in the cab view. */
  mirrors?: { position: [number, number, number]; yawDeg: number; size: [number, number] }[];
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

export interface FieldParcelRecord {
  id?: string | number;
  crop?: string;
  cropType?: string;
  landuse?: string;
  points: [number, number][];
  rowAngleRad?: number;
  areaHa?: number;
  aerialTintHex?: string;
  meanRgb?: [number, number, number];
}

export interface FieldPropPlacement {
  id?: string | number;
  x?: number;
  y?: number;
  z?: number;
  position?: [number, number] | [number, number, number];
  rotationRad?: number;
  yawRad?: number;
  yaw?: number;
  scale?: number;
  lengthM?: number;
  points?: ([number, number] | [number, number, number])[];
}

export interface FieldsLayoutData {
  available?: boolean;
  fields: FieldParcelRecord[];
  hedgerows?: FieldPropPlacement[];
  wildflowerStrips?: FieldPropPlacement[];
  vineyardRoses?: FieldPropPlacement[];
  strawStacks?: FieldPropPlacement[];
  hochsitze?: FieldPropPlacement[];
  waysideCrosses?: FieldPropPlacement[];
}

export interface FieldsManifestModel {
  key?: string;
  name?: string;
  glbPath: string;
  bounds?: [number, number, number];
  spacingM?: number;
  alongRowM?: number;
  betweenBaysM?: number;
  windSway?: number;
  windSwayStrength?: number;
  /** Vegetation LOD assets: GLB child nodes are named `<nodePrefix>_<LOD0|LOD1|FAR>`. */
  nodePrefix?: string;
  lods?: Record<string, { node: string; triangles?: number }>;
  /** Footprint of one far/near tile in metres (along the row, across). */
  tileM?: [number, number];
  heightM?: number;
  /** Maximum view distance (m) of each detailed LOD node, nearest first. */
  lodDist?: number[];
}

export interface FieldsManifest {
  models: Record<string, FieldsManifestModel>;
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
  fieldsLayout: FieldsLayoutData | null;
  fieldsManifest: FieldsManifest | null;
}

/** data/terrain/ortho/manifest.json — streamed DOP20 aerial tiles (written by scripts/build_terrain_ortho.py). */
export interface OrthoTileManifest {
  attribution: string;
  licence?: string;
  licenceUrl?: string;
  source?: string;
  processing?: string;
  mapSizeM: number;
  base: { file: string; sizePx: number; metresPerPixel: number; bytes?: number };
  tiles: {
    perSide: number;
    tileSizeM: number;
    tilePx: number;
    gutterPx: number;
    imagePx: number;
    metresPerPixel: number;
    filePattern: string;
    rowOrder?: string;
    bytes?: number;
  };
}

/** public/assets/textures/ground/ground.json — CC0 PBR ground layers (written by scripts/fetch_ground_textures.py). */
export interface GroundTextureLayer {
  index: number;
  name: string;
  albedo: string;
  normalRoughness: string;
  tileSizeM: number;
  meanAlbedoLinear: [number, number, number];
  meanRoughness: number;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  licence?: string;
}

export interface GroundTextureManifest {
  size: number;
  normalConvention?: string;
  layers: GroundTextureLayer[];
}

/** data/terrain/far/manifest.json — aerial textures of the far terrain ring (scripts/build_terrain_far.py). */
export interface FarTerrainLayer {
  file: string;
  sizePx: number;
  sideM: number;
  metresPerPixel?: number;
  bytes?: number;
}

export interface FarTerrainManifest {
  attribution: string;
  licence?: string;
  source?: string;
  layers: { inner: FarTerrainLayer; outer: FarTerrainLayer };
}
