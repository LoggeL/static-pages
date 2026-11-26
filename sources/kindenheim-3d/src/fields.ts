import * as THREE from 'three';
import { RECREATION_EXCLUSION_POLYS } from './recreation';
import {
  FloorCarpetBuilder,
  InstancedLodLayer,
  addGroundCoverPatch,
  clearanceTo,
  excludeGroundCover,
  createInstancedPropGroup,
  extractPropPrototype,
  listLodNodes,
  loadFloorMaterial,
  loadLodAsset,
  loadVegGltf,
  registerVegLayer,
  registerFloorCull,
  setVegetationQuality,
  valueNoise,
  type QualityLevel,
  vegUniforms,
  type LodAsset,
  type VegClipConfig,
} from './scenery';
import type { TerrainSystem } from './terrain';
import type {
  BraveReferenceEntry,
  BuildingRecord,
  FieldParcelRecord,
  FieldPropPlacement,
  FieldsLayoutData,
  FieldsManifest,
  FieldsManifestModel,
  RoadRecord,
  SceneData,
} from './types';

export interface FieldsStats {
  parcelCount: number;
  wheat: number;
  stubble: number;
  corn: number;
  sugarbeet: number;
  sunflower: number;
  meadow: number;
  wildflowerStrips: number;
  hedgerows: number;
  vineyardRoses: number;
  strawStacks: number;
  hochsitze: number;
  waysideCrosses: number;
  totalCropInstances: number;
  totalPropInstances: number;
}

export interface FieldsSystemResult {
  group: THREE.Group;
  stats: FieldsStats;
  /** Advances the shared vegetation wind clock (vines, trees and crops all sway from it). */
  update: (dt: number) => void;
  /** Quality contract (FIXROUND.md): scales LOD distances of the crop layers (shared with the scenery layers). */
  setQuality: (level: QualityLevel) => void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function extractXZ(p: [number, number] | [number, number, number]): [number, number] {
  return p.length === 3 ? [p[0], p[2]] : [p[0], p[1]];
}

function pointInPolygon(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    const intersect = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToPolygonEdgesSq(px: number, pz: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    const t = lenSq > 1e-8 ? THREE.MathUtils.clamp(((px - ax) * abx + (pz - az) * abz) / lenSq, 0, 1) : 0;
    const dx = px - (ax + abx * t);
    const dz = pz - (az + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
}

/**
 * Douglas-Peucker on a closed outline. Parcels traced from the land-use raster have 4 m stair steps along oblique
 * borders; real field borders are straight survey lines.
 */
function simplifyOutline(poly: [number, number][], tolM: number): [number, number][] {
  if (poly.length < 8) return poly;
  // split the ring at its two mutually farthest-apart vertices, simplify both chains
  let a = 0;
  let b = 0;
  let best = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = (poly[i][0] - poly[0][0]) ** 2 + (poly[i][1] - poly[0][1]) ** 2;
    if (d > best) {
      best = d;
      b = i;
    }
  }
  best = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = (poly[i][0] - poly[b][0]) ** 2 + (poly[i][1] - poly[b][1]) ** 2;
    if (d > best) {
      best = d;
      a = i;
    }
  }
  const chain = (from: number, to: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = from; ; i = (i + 1) % poly.length) {
      out.push(poly[i]);
      if (i === to) break;
    }
    return out;
  };
  const dp = (pts: [number, number][]): [number, number][] => {
    if (pts.length < 3) return pts;
    const [ax, az] = pts[0];
    const [bx, bz] = pts[pts.length - 1];
    const len = Math.hypot(bx - ax, bz - az) || 1e-6;
    let worst = 0;
    let idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i][0] - ax) * (bz - az) - (pts[i][1] - az) * (bx - ax)) / len;
      if (d > worst) {
        worst = d;
        idx = i;
      }
    }
    if (worst <= tolM) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
  };
  const out = [...dp(chain(a, b)).slice(0, -1), ...dp(chain(b, a)).slice(0, -1)];
  return out.length >= 3 ? out : poly;
}

function estimateLongestEdgeAngle(poly: [number, number][]): number {
  let bestLen = 0;
  let bestAngle = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len > bestLen) {
      bestLen = len;
      bestAngle = -Math.atan2(dz, dx);
    }
  }
  return bestAngle;
}

class FieldOccupancyGrid {
  private readonly cellSize = 2.0;
  private readonly halfMap: number;
  private readonly dim: number;
  private readonly cells: Uint8Array;

  constructor(mapSizeM: number) {
    this.halfMap = mapSizeM * 0.5;
    this.dim = Math.ceil(mapSizeM / this.cellSize);
    this.cells = new Uint8Array(this.dim * this.dim);
  }

  private toIdx(x: number, z: number): number {
    const gx = Math.floor((x + this.halfMap) / this.cellSize);
    const gz = Math.floor((z + this.halfMap) / this.cellSize);
    if (gx < 0 || gx >= this.dim || gz < 0 || gz >= this.dim) return -1;
    return gz * this.dim + gx;
  }

  public markCircle(x: number, z: number, radiusM: number, flag: number): void {
    const rCells = Math.ceil(radiusM / this.cellSize);
    const cx = Math.floor((x + this.halfMap) / this.cellSize);
    const cz = Math.floor((z + this.halfMap) / this.cellSize);
    const r2 = radiusM * radiusM;
    for (let dz = -rCells; dz <= rCells; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= this.dim) continue;
      for (let dx = -rCells; dx <= rCells; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= this.dim) continue;
        const wx = (gx + 0.5) * this.cellSize - this.halfMap;
        const wz = (gz + 0.5) * this.cellSize - this.halfMap;
        if ((wx - x) * (wx - x) + (wz - z) * (wz - z) <= r2) {
          this.cells[gz * this.dim + gx] |= flag;
        }
      }
    }
  }

  public markPolygon(pts: [number, number][], padM: number, flag: number): void {
    if (pts.length < 3) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const x0 = Math.max(0, Math.floor((minX - padM + this.halfMap) / this.cellSize));
    const x1 = Math.min(this.dim - 1, Math.ceil((maxX + padM + this.halfMap) / this.cellSize));
    const z0 = Math.max(0, Math.floor((minZ - padM + this.halfMap) / this.cellSize));
    const z1 = Math.min(this.dim - 1, Math.ceil((maxZ + padM + this.halfMap) / this.cellSize));

    for (let gz = z0; gz <= z1; gz++) {
      const wz = (gz + 0.5) * this.cellSize - this.halfMap;
      for (let gx = x0; gx <= x1; gx++) {
        const wx = (gx + 0.5) * this.cellSize - this.halfMap;
        if (pointInPolygon(wx, wz, pts) || distanceToPolygonEdgesSq(wx, wz, pts) <= padM * padM) {
          this.cells[gz * this.dim + gx] |= flag;
        }
      }
    }
  }

  public markPolyline(pts: [number, number][], halfWidthM: number, flag: number): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const dist = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1.5, halfWidthM * 0.6)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        this.markCircle(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, halfWidthM, flag);
      }
    }
  }

  public isBlocked(x: number, z: number, mask = 7): boolean {
    const idx = this.toIdx(x, z);
    if (idx < 0) return true;
    return (this.cells[idx] & mask) !== 0;
  }
}

const FLAG_BUILDING = 1;
const FLAG_ROAD = 2;
const FLAG_VINEYARD = 4;
const FLAG_ROAD_CORE = 8;

/**
 * CPU side of the crop clip map (VegClipConfig in src/scenery.ts): one texel per metre with the signed distance to
 * the outline of the parcel that owns it (inside: also capped by the clearance to roads / buildings / vineyards, the
 * same edge the floor carpet uses) and the owner's id. Texels within 4 m outside a parcel belong to it with a
 * negative distance, so the linear-filtered distance gives a straight cut along free borders.
 */
class ParcelClipMap {
  public readonly res: number;
  private readonly cell: number;
  private readonly half: number;
  private readonly sd: Float32Array;
  private readonly owner: Uint8Array;

  constructor(mapSizeM: number) {
    this.res = Math.round(mapSizeM);
    this.cell = mapSizeM / this.res;
    this.half = mapSizeM * 0.5;
    this.sd = new Float32Array(this.res * this.res).fill(-4);
    this.owner = new Uint8Array(this.res * this.res);
  }

  public addParcel(id: number, poly: [number, number][], isBlocked: (x: number, z: number) => boolean): void {
    if (!(id >= 1 && id <= 255)) throw new Error(`[fields] clip map holds parcel ids 1..255, got ${id}`);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const ix0 = Math.max(0, Math.floor((minX - 4.5 + this.half) / this.cell));
    const ix1 = Math.min(this.res - 1, Math.floor((maxX + 4.5 + this.half) / this.cell));
    const iz0 = Math.max(0, Math.floor((minZ - 4.5 + this.half) / this.cell));
    const iz1 = Math.min(this.res - 1, Math.floor((maxZ + 4.5 + this.half) / this.cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = -this.half + (iz + 0.5) * this.cell;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -this.half + (ix + 0.5) * this.cell;
        const d = Math.min(4, Math.sqrt(distanceToPolygonEdgesSq(x, z, poly)));
        const s = pointInPolygon(x, z, poly) ? Math.min(d, clearanceTo(isBlocked, x, z)) : -d;
        const i = iz * this.res + ix;
        if (s > this.sd[i]) {
          this.sd[i] = s;
          this.owner[i] = id;
        }
      }
    }
  }

  /** Signed distance (m) of (x, z) to the outline of parcel `id`; -4 where another parcel owns the texel. */
  public ownSd(id: number, x: number, z: number): number {
    const ix = Math.floor((x + this.half) / this.cell);
    const iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.res || iz >= this.res) return -4;
    const i = iz * this.res + ix;
    return this.owner[i] === id ? this.sd[i] : -4;
  }

  public toTexture(): THREE.DataTexture {
    const data = new Uint8Array(this.res * this.res * 2);
    for (let i = 0; i < this.sd.length; i++) {
      data[i * 2] = Math.round(((THREE.MathUtils.clamp(this.sd[i], -4, 4) + 4) / 8) * 255);
      data[i * 2 + 1] = this.owner[i];
    }
    const tex = new THREE.DataTexture(data, this.res, this.res, THREE.RGFormat, THREE.UnsignedByteType);
    tex.name = 'FieldCropClipMap';
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
}

function makeAerialTintColor(hex: string | undefined, bucket: string, rand: () => number): THREE.Color {
  // Sunflower heads must stay yellow: only a hint of the orthophoto tint
  const blend = bucket === 'sunflower' ? 0.05 : 0.16;
  const base = new THREE.Color(0xffffff);
  if (hex && /^#?[0-9a-f]{6}$/i.test(hex)) {
    const tint = new THREE.Color(hex.startsWith('#') ? hex : `#${hex}`);
    // normalise the tint's brightness so it shifts hue between parcels without darkening the crop
    const lum = Math.max(0.05, tint.r * 0.3 + tint.g * 0.59 + tint.b * 0.11);
    tint.multiplyScalar(Math.min(2.5, 0.75 / lum));
    base.lerp(tint, blend);
  }
  base.multiplyScalar(0.95 + rand() * 0.1);
  return base;
}

function extractPropCoords(item: FieldPropPlacement): { x: number; z: number; yaw: number; scale: number } | null {
  let x = item.x;
  let z = item.z;
  if ((x === undefined || z === undefined) && Array.isArray(item.position)) {
    x = item.position[0];
    z = item.position.length >= 3 ? item.position[2] : item.position[1];
  }
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }
  const yaw =
    typeof item.rotationRad === 'number' ? item.rotationRad : typeof item.yawRad === 'number' ? item.yawRad : typeof item.yaw === 'number' ? item.yaw : 0;
  const scale = typeof item.scale === 'number' && Number.isFinite(item.scale) ? THREE.MathUtils.clamp(item.scale, 0.65, 1.55) : 1.0;
  return { x, z, yaw, scale };
}

function buildOccupancy(mapSizeM: number, buildings: BuildingRecord[], roads: RoadRecord[], sceneData: SceneData): FieldOccupancyGrid {
  const grid = new FieldOccupancyGrid(mapSizeM);
  for (const b of buildings) {
    if (b.footprint && b.footprint.length >= 3) {
      grid.markPolygon(b.footprint, 3.0, FLAG_BUILDING);
    } else if (b.center) {
      grid.markCircle(b.center[0], b.center[1], Math.max(b.widthM ?? 10, b.depthM ?? 10) * 0.6 + 2.5, FLAG_BUILDING);
    }
  }
  for (const r of roads) {
    if (!r.points || r.points.length < 2) continue;
    const pts = r.points.map(extractXZ);
    const w = r.widthM ?? (r.highway === 'primary' || r.highway === 'secondary' ? 7.4 : r.highway === 'track' ? 3.2 : 5.0);
    const pad = r.highway === 'track' || r.highway === 'path' ? 1.4 : 2.2;
    grid.markPolyline(pts, w * 0.5 + pad, FLAG_ROAD);
    grid.markPolyline(pts, w * 0.5 + 0.55, FLAG_ROAD_CORE);
  }
  for (const lu of sceneData.landuse) {
    if (lu.type === 'vineyard' && lu.points && lu.points.length >= 3) {
      grid.markPolygon(lu.points, 0.5, FLAG_VINEYARD);
    }
  }
  for (const poly of RECREATION_EXCLUSION_POLYS) {
    grid.markPolygon(poly, 1.5, FLAG_BUILDING);
  }
  return grid;
}

type CropBucket = 'wheat' | 'stubble' | 'corn' | 'sugarbeet' | 'sunflower' | 'meadow';
const CROP_KEYS: Record<CropBucket, string> = {
  wheat: 'crop_wheat_patch',
  stubble: 'crop_stubble_patch',
  corn: 'crop_corn_row',
  sugarbeet: 'crop_sugarbeet_row',
  sunflower: 'crop_sunflower_patch',
  meadow: 'meadow_grass_patch',
};
const CROP_BUCKETS = Object.keys(CROP_KEYS) as CropBucket[];
/** Tall crops throw visible shadows; the low ones only receive them. */
const CROP_CASTS_SHADOW: Record<CropBucket, boolean> = { wheat: false, stubble: false, corn: true, sugarbeet: false, sunflower: true, meadow: false };

/** Sprayer tramlines in the floor carpet (strength 0..1); meadows have none. */
const FLOOR_TRAMLINES: Record<CropBucket, number> = { wheat: 1.0, stubble: 0.7, corn: 0.6, sugarbeet: 0.8, sunflower: 0.6, meadow: 0 };
/** Metres one repeat of the floor texture covers across the rows (matches tileM[1] of the crop assets). */
const FLOOR_TILE_ACROSS_M: Record<CropBucket, number> = { wheat: 6, stubble: 6, corn: 2.4, sugarbeet: 2.5, sunflower: 6, meadow: 8.3 };

/**
 * Albedo scale per crop (floor carpet and plant cards). Ripe straw scans are close to white; real stubble / wheat
 * reflect about 0.25-0.3, otherwise the fields are the brightest thing in the scene and glow at dusk.
 */
/**
 * Mean tone that the plant cards add to the carpet near the camera (rendered floor+plants / floor alone, noon, 45 m
 * top-down, linear RGB; a little stronger for oblique views). Applied to the carpet beyond the last plant LOD.
 */
const FLOOR_FAR_TINT: Partial<Record<CropBucket, { color: THREE.Color; grazing: THREE.Color }>> = {
  // wheat ears cover the carpet from any angle: about the same tone top-down and at 30 m / 150 m (measured)
  wheat: { color: new THREE.Color(0.81, 0.78, 0.71), grazing: new THREE.Color(0.79, 0.77, 0.7) },
  // beet rows hide the soil at oblique angles: 60 m drone view at ~42 deg darkens the carpet to (0.39, 0.61, 0.32)
  sugarbeet: { color: new THREE.Color(0.88, 0.91, 0.84), grazing: new THREE.Color(0.26, 0.54, 0.19) },
};
const CROP_ALBEDO: Record<CropBucket, number> = { wheat: 0.8, stubble: 0.72, corn: 1.0, sugarbeet: 1.0, sunflower: 1.0, meadow: 0.92 };
/** Extra scale for the plant cards relative to the floor (cards face the sky and catch more light than the carpet). */
const CARD_ALBEDO: Record<CropBucket, number> = { wheat: 0.78, stubble: 0.9, corn: 1.0, sugarbeet: 1.12, sunflower: 1.0, meadow: 1.0 };

interface LoadedFieldAsset {
  key: string;
  entry: FieldsManifestModel;
  asset: LodAsset;
  /** Tile metadata carried by the GLB itself (glTF extras on the LOD0 node). */
  tileM: [number, number] | null;
  lodDist: number[];
  heightM: number;
  windSway: number;
  alongRowM: number | null;
}

function numArray(v: unknown, len?: number): number[] | null {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
  if (len !== undefined && v.length !== len) return null;
  return v as number[];
}

function manifestEntry(manifest: FieldsManifest, key: string): FieldsManifestModel {
  const entry = manifest.models[key];
  if (!entry?.glbPath) throw new Error(`[fields] fields manifest has no model "${key}" (run blender/fields/build_fields.py + assemble_manifest.py)`);
  return entry;
}

export async function buildAgriculturalFields(
  layout: FieldsLayoutData | null,
  manifest: FieldsManifest | null,
  sceneData: SceneData,
  terrain: TerrainSystem,
  maxAnisotropy: number,
  references?: BraveReferenceEntry[]
): Promise<FieldsSystemResult> {
  const group = new THREE.Group();
  group.name = 'KindenheimAgriculturalFields';

  const stats: FieldsStats = {
    parcelCount: 0,
    wheat: 0,
    stubble: 0,
    corn: 0,
    sugarbeet: 0,
    sunflower: 0,
    meadow: 0,
    wildflowerStrips: 0,
    hedgerows: 0,
    vineyardRoses: 0,
    strawStacks: 0,
    hochsitze: 0,
    waysideCrosses: 0,
    totalCropInstances: 0,
    totalPropInstances: 0,
  };

  const update = (dt: number) => {
    vegUniforms.uVegTime.value += dt;
  };

  // Field layout / models are optional data sets (the dev server answers {available:false} until they are generated)
  if (!layout || !manifest || Object.keys(manifest.models).length === 0) {
    return { group, stats, update, setQuality: setVegetationQuality };
  }

  const loadLod = async (key: string): Promise<LoadedFieldAsset> => {
    const entry = manifestEntry(manifest, key);
    const nodes = await listLodNodes(entry.glbPath, key, maxAnisotropy);
    if (!nodes.includes('LOD0')) throw new Error(`[fields] ${entry.glbPath} has no node "${key}_LOD0"; rebuild the field assets`);
    const levels = ['LOD0', 'LOD1'].filter((n) => nodes.includes(n));
    const asset = await loadLodAsset(entry.glbPath, key, levels, nodes.includes('FAR') ? 'FAR' : null, maxAnisotropy);
    const lodDist = numArray(asset.meta.lodDist, levels.length);
    if (!lodDist) throw new Error(`[fields] node "${key}_LOD0" in ${entry.glbPath} lacks a lodDist extra with ${levels.length} entries`);
    const tile = numArray(asset.meta.tileM, 2);
    return {
      key,
      entry,
      asset,
      tileM: tile ? [tile[0], tile[1]] : null,
      lodDist,
      heightM: typeof asset.meta.heightM === 'number' ? asset.meta.heightM : asset.maxY,
      windSway: typeof asset.meta.windSway === 'number' ? asset.meta.windSway : 0,
      alongRowM: typeof asset.meta.alongRowM === 'number' ? asset.meta.alongRowM : null,
    };
  };
  const loadSimple = async (key: string) => extractPropPrototype(await loadVegGltf(manifestEntry(manifest, key).glbPath, maxAnisotropy));

  const cropAssetsP = Promise.all(CROP_BUCKETS.map((b) => loadLod(CROP_KEYS[b])));
  const [cropAssets, cropFloorMats, wildflower, hedgerow, rose, strawStackProto, hochsitzProto, wegekreuzProto] = await Promise.all([
    cropAssetsP,
    cropAssetsP.then((assets) =>
      Promise.all(
        CROP_BUCKETS.map((b, i) => {
          const tint = FLOOR_FAR_TINT[b];
          // crops without a far mesh: the carpet beyond the last plant LOD takes the tone the plants add near the camera
          if (tint && assets[i].asset.far) throw new Error(`[fields] ${CROP_KEYS[b]} has a far mesh now: drop its FLOOR_FAR_TINT entry`);
          return loadFloorMaterial(manifestEntry(manifest, CROP_KEYS[b]).glbPath, CROP_KEYS[b], maxAnisotropy, {
            tramlines: { strength: FLOOR_TRAMLINES[b], tileAcrossM: FLOOR_TILE_ACROSS_M[b] },
            farTint: tint ? { ...tint, baseM: assets[i].lodDist[assets[i].lodDist.length - 1] } : undefined,
            // harvested fields read as combine passes from the drone (aerial: 7.5 m light / dark bands along the rows)
            swaths: b === 'stubble' ? { strength: 0.55, widthM: 7.5, tileAlongM: 6, tileAcrossM: FLOOR_TILE_ACROSS_M[b] } : undefined,
          });
        })
      )
    ),
    loadLod('wildflower_strip'),
    loadLod('hedgerow_bay'),
    loadLod('vineyard_rose_post'),
    loadSimple('straw_bale_stack'),
    loadSimple('hochsitz'),
    loadSimple('wegekreuz'),
  ]);

  const makeLayer = (name: string, la: LoadedFieldAsset, opts: { cast: boolean; farCast?: boolean; sway?: number; clip?: VegClipConfig }): InstancedLodLayer => {
    const dist = la.lodDist;
    const sway = opts.sway ?? la.windSway;
    return new InstancedLodLayer({
      name,
      asset: la.asset,
      levelDist: dist,
      band: 4,
      // far field tiles are only 2-12 triangles each: large chunks keep the draw-call count low
      chunkM: 512,
      mapSizeM: terrain.mapSizeM,
      castShadow: la.asset.levels.map((_, i) => opts.cast && i === 0),
      farCastShadow: opts.farCast ?? false,
      farCullM: 600,
      wind: new THREE.Vector3(sway, sway > 0 ? 0.012 : 0, Math.max(0.3, la.heightM)),
      translucency: new THREE.Color(0.9, 0.9, 0.35),
      clip: opts.clip,
    });
  };

  const occupancy = buildOccupancy(terrain.mapSizeM, sceneData.buildings, sceneData.roads, sceneData);
  const svCamPoints: [number, number][] = (references ?? [])
    .filter((r) => (r.cameraHeightM ?? 2.5) < 15 && typeof r.localX === 'number' && typeof r.localZ === 'number')
    .map((r) => [r.localX!, r.localZ!]);
  const isNearSvCam = (x: number, z: number, rM = 5.0): boolean => {
    const r2 = rM * rM;
    for (const [cx, cz] of svCamPoints) {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  };

  const rand = mulberry32(6727102);
  const halfBound = terrain.halfSizeM - 8;
  const dummy = new THREE.Object3D();
  const m4 = new THREE.Matrix4();

  // ---------------------------------------------------------------------------
  // 1. CROP PARCELS: every parcel is carpeted with tiles on its row grid; detail comes from the LOD pools
  // ---------------------------------------------------------------------------
  const cropLayers = {} as Record<CropBucket, InstancedLodLayer>;
  const cropTile = {} as Record<CropBucket, [number, number]>;
  CROP_BUCKETS.forEach((bucket, i) => {
    const la = cropAssets[i];
    if (!la.tileM) throw new Error(`[fields] node "${la.key}_LOD0" lacks the tileM extra; rebuild the field assets`);
    if (bucket !== 'meadow' && Math.abs(la.tileM[1] - FLOOR_TILE_ACROSS_M[bucket]) > 1e-3) {
      throw new Error(`[fields] ${la.key}: tile is ${la.tileM[1]} m across but FLOOR_TILE_ACROSS_M says ${FLOOR_TILE_ACROSS_M[bucket]} m`);
    }
    cropTile[bucket] = la.tileM;
  });

  const floors = new FloorCarpetBuilder(terrain, 512);
  const parcels = (Array.isArray(layout.fields) ? layout.fields : []).filter(
    (f): f is FieldParcelRecord => Boolean(f && Array.isArray(f.points) && f.points.length >= 3)
  );
  stats.parcelCount = Array.isArray(layout.fields) ? layout.fields.length : 0;
  const cropBlocked = (x: number, z: number): boolean => occupancy.isBlocked(x, z, FLAG_BUILDING | FLAG_ROAD | FLAG_VINEYARD);

  // Parcels that get crop cards, with their simplified outline and clip-map id. The cards are cut per fragment at the
  // outline (ParcelClipMap / VegClipConfig): tile strips run past oblique borders instead of stopping a whole tile
  // short, which left a staircase of tile ends above a bare wedge of floor carpet (review: "raised straw slab").
  const cropParcels: { f: FieldParcelRecord; bucket: CropBucket; pts: [number, number][]; clipId: number }[] = [];
  const meadowParcels: { f: FieldParcelRecord; pts: [number, number][] }[] = [];
  for (const f of parcels) {
    const rawCrop = (f.crop ?? f.cropType ?? '').toLowerCase();
    if (rawCrop === 'plowed' || rawCrop === 'bare') excludeGroundCover(f.points);
    if (!rawCrop || rawCrop === 'plowed' || rawCrop === 'vineyard' || rawCrop === 'bare') continue;
    const bucket = (rawCrop === 'orchard' || rawCrop === 'grass' ? 'meadow' : rawCrop) as CropBucket;
    if (!CROP_BUCKETS.includes(bucket)) throw new Error(`[fields] parcel ${f.id ?? '?'} has unknown crop "${rawCrop}" (data/osm/fields_layout.json)`);
    const pts = simplifyOutline(f.points, 4.5);
    if (bucket === 'meadow') meadowParcels.push({ f, pts });
    else cropParcels.push({ f, bucket, pts, clipId: cropParcels.length + 1 });
  }
  if (cropParcels.length > 255) throw new Error(`[fields] ${cropParcels.length} crop parcels exceed the 255 ids of the clip map`);
  const clipMap = new ParcelClipMap(terrain.mapSizeM);
  for (const cp of cropParcels) clipMap.addParcel(cp.clipId, cp.pts, cropBlocked);
  const clip: VegClipConfig = { texture: clipMap.toTexture(), mapSizeM: terrain.mapSizeM };
  CROP_BUCKETS.forEach((bucket, i) => {
    cropLayers[bucket] = makeLayer(`FieldCrop_${bucket}`, cropAssets[i], { cast: CROP_CASTS_SHADOW[bucket], clip: bucket === 'meadow' ? undefined : clip });
  });

  const rowFrame = (f: FieldParcelRecord, pts: [number, number][]) => {
    const rotY = typeof f.rowAngleRad === 'number' && Number.isFinite(f.rowAngleRad) ? f.rowAngleRad : estimateLongestEdgeAngle(pts);
    const dirX = Math.cos(rotY);
    const dirZ = -Math.sin(rotY);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of pts) {
      const u = x * dirX + z * dirZ;
      const v = x * -dirZ + z * dirX;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    return { dirX, dirZ, perpX: -dirZ, perpZ: dirX, minU, maxU, minV, maxV };
  };

  // meadows: floor carpet + near-camera ground cover only (cards on a 6 m lattice read as dark hash marks from the air)
  for (const { f, pts } of meadowParcels) {
    const { dirX, dirZ } = rowFrame(f, pts);
    const parcelTint = makeAerialTintColor(f.aerialTintHex, 'meadow', rand).multiplyScalar(CROP_ALBEDO.meadow);
    // no drill rows: an odd repeat length hides the 6 m tile rhythm
    floors.addParcel('meadow', pts, dirX, dirZ, 9.7, 8.3, 0.5, 0.5, parcelTint, cropBlocked, 0.26);
    addGroundCoverPatch(pts, 'tall_grass');
    const area = Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) * 0.5;
    stats.meadow += Math.round(area / 36);
  }

  for (const { f, bucket, pts, clipId } of cropParcels) {
    const layer = cropLayers[bucket];
    const [tileU, tileV] = cropTile[bucket];
    const isRowCrop = bucket === 'corn' || bucket === 'sugarbeet';
    const { dirX, dirZ, perpX, perpZ, minU, maxU, minV, maxV } = rowFrame(f, pts);
    const halfV = tileV * 0.5;
    // one tint per parcel: tiles of a field must not form a checkerboard from the air
    const parcelTint = makeAerialTintColor(f.aerialTintHex, bucket, rand).multiplyScalar(CROP_ALBEDO[bucket]);
    // ground carpet on the terrain grid; tile centres sit on the global (tileU, tileV) grid -> texture offset 0.5;
    // all floors get cloud-like tonal variation, stubble also greener weed patches (aerial: volunteer cereal)
    floors.addParcel(bucket, pts, dirX, dirZ, tileU, tileV, 0.5, 0.5, parcelTint, cropBlocked,
      bucket === 'sugarbeet' || bucket === 'corn' || bucket === 'sunflower' ? 0.1 : bucket === 'stubble' ? 0.34 : 0.26,
      bucket === 'stubble' ? { tint: new THREE.Color(0.8, 0.9, 0.7), cover: 0.22, cellM: 26 } : undefined);
    // near-camera ground cover (src/scenery.ts): nothing inside the crops
    excludeGroundCover(pts);
    const cardTint = parcelTint.clone().multiplyScalar(CARD_ALBEDO[bucket]);
    const STEP = 0.5;
    const nU = Math.ceil((maxU - minU + 2) / STEP);
    // every strip of the global tile grid that touches the parcel; occupied = some point across the strip is inside
    for (let v = Math.floor((minV - halfV) / tileV) * tileV + tileV; v - halfV < maxV; v += tileV) {
      let runStart = NaN; // u is a world coordinate along the rows (may be negative)
      const runs: [number, number][] = [];
      for (let k = 0; k <= nU; k++) {
        const u = minU - 1 + k * STEP;
        let occ = false;
        if (k < nU) {
          for (let s = -2; s <= 2 && !occ; s++) {
            const vv = v + s * halfV * 0.45;
            occ = clipMap.ownSd(clipId, u * dirX + vv * perpX, u * dirZ + vv * perpZ) > 0.1;
          }
        }
        if (occ && Number.isNaN(runStart)) runStart = u;
        if (!occ && !Number.isNaN(runStart)) {
          // half a step of slack on both ends: the clip map makes the exact cut
          runs.push([runStart - STEP * 0.5, u + STEP * 0.5]);
          runStart = NaN;
        }
      }
      for (const [u0, u1] of runs) {
        const span = u1 - u0;
        if (span < tileU * 0.3) continue;
        const nTiles = Math.max(1, Math.round(span / tileU));
        const len = span / nTiles;
        const sx = len / tileU;
        const halfLen = len * 0.5;
        for (let t = 0; t < nTiles; t++) {
          const u = u0 + len * (t + 0.5);
          const wx = u * dirX + v * perpX;
          const wz = u * dirZ + v * perpZ;
          if (Math.abs(wx) > halfBound || Math.abs(wz) > halfBound) continue;
          if (isNearSvCam(wx, wz, 5.2)) continue;
          const ax = wx - dirX * halfLen;
          const az = wz - dirZ * halfLen;
          const bx = wx + dirX * halfLen;
          const bz = wz + dirZ * halfLen;
          const hA = terrain.getTerrainHeight(ax, az);
          const hB = terrain.getTerrainHeight(bx, bz);
          const hL = terrain.getTerrainHeight(wx - perpX * halfV, wz - perpZ * halfV);
          const hR = terrain.getTerrainHeight(wx + perpX * halfV, wz + perpZ * halfV);
          const slopeAlong = (hB - hA) / len;
          const slopeCross = (hR - hL) / tileV;
          // height varies smoothly over the field (not per tile): neighbouring canopy lids must meet without steps
          const sy = 0.9 + 0.2 * valueNoise(wx, wz, 45);
          const mx = rand() < 0.5 ? 1 : -1;
          const mz = !isRowCrop && rand() < 0.5 ? -1 : 1;
          // sheared basis: plants stay upright while the tile follows the slope in both directions
          m4.set(
            dirX * mx * sx, 0, perpX * mz, wx,
            slopeAlong * mx * sx, sy, slopeCross * mz, (hA + hB) * 0.5 + 0.02,
            dirZ * mx * sx, 0, perpZ * mz, wz,
            0, 0, 0, 1
          );
          layer.add(m4, cardTint, clipId);
        }
      }
    }
  }

  const fieldFloorGroup = floors.build('FieldFloors', Object.fromEntries(CROP_BUCKETS.map((b, i) => [b, cropFloorMats[i]])));
  // low quality: floor chunks far away are dropped, the terrain's aerial (same parcels) shows instead
  registerFloorCull(fieldFloorGroup, 650);
  group.add(fieldFloorGroup);
  for (const bucket of CROP_BUCKETS) {
    const layer = cropLayers[bucket];
    group.add(layer.build());
    registerVegLayer(layer);
    if (bucket !== 'meadow') stats[bucket] = layer.count;
    stats.totalCropInstances += layer.count;
  }

  // ---------------------------------------------------------------------------
  // 2. FIELD MARGINS: hedgerows (Windschutzhecken) & wildflower strips (Bluehstreifen), one bay per placement
  // ---------------------------------------------------------------------------
  const populateLinear = (
    name: string,
    items: FieldPropPlacement[] | undefined,
    la: LoadedFieldAsset,
    cast: boolean
  ): number => {
    const layer = makeLayer(name, la, { cast, farCast: cast });
    const bayLen = la.alongRowM ?? la.tileM?.[0];
    if (!bayLen) throw new Error(`[fields] node "${la.key}_LOD0" lacks the alongRowM extra; rebuild the field assets`);
    const pushBay = (cx: number, cz: number, dirX: number, dirZ: number, scale: number) => {
      if (Math.abs(cx) > halfBound || Math.abs(cz) > halfBound) return;
      if (occupancy.isBlocked(cx, cz, FLAG_BUILDING | FLAG_ROAD_CORE)) return;
      if (isNearSvCam(cx, cz, 4.8)) return;
      const halfB = bayLen * 0.5;
      const hA = terrain.getTerrainHeight(cx - dirX * halfB, cz - dirZ * halfB);
      const hB = terrain.getTerrainHeight(cx + dirX * halfB, cz + dirZ * halfB);
      const perpX = -dirZ;
      const perpZ = dirX;
      const sy = scale * (0.9 + rand() * 0.2);
      const mx = rand() < 0.5 ? 1 : -1;
      m4.set(
        dirX * mx * scale, 0, perpX * scale, cx,
        ((hB - hA) / bayLen) * mx * scale, sy, 0, (hA + hB) * 0.5 - 0.03,
        dirZ * mx * scale, 0, perpZ * scale, cz,
        0, 0, 0, 1
      );
      layer.add(m4);
    };
    for (const item of items ?? []) {
      if (Array.isArray(item.points) && item.points.length >= 2) {
        const poly = item.points.map(extractXZ);
        for (let i = 0; i < poly.length - 1; i++) {
          const [x0, z0] = poly[i];
          const [x1, z1] = poly[i + 1];
          const segLen = Math.hypot(x1 - x0, z1 - z0);
          if (segLen < 1.2) continue;
          const count = Math.max(1, Math.round(segLen / bayLen));
          for (let k = 0; k < count; k++) {
            const t = (k + 0.5) / count;
            pushBay(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, (x1 - x0) / segLen, (z1 - z0) / segLen, item.scale ?? 1.0);
          }
        }
      } else {
        const pt = extractPropCoords(item);
        if (!pt) continue;
        pushBay(pt.x, pt.z, Math.cos(pt.yaw), -Math.sin(pt.yaw), pt.scale);
      }
    }
    group.add(layer.build());
    registerVegLayer(layer);
    return layer.count;
  };

  stats.hedgerows = populateLinear('FieldHedgerows', layout.hedgerows, hedgerow, true);
  stats.wildflowerStrips = populateLinear('FieldWildflowerStrips', layout.wildflowerStrips, wildflower, false);

  // ---------------------------------------------------------------------------
  // 3. POINT PROPS: vineyard rose posts (LOD layer), straw stacks, hunting stands, wayside crosses
  // ---------------------------------------------------------------------------
  const placePoints = (items: FieldPropPlacement[] | undefined, maxCount: number, minY: number, sink: (m: THREE.Matrix4) => void): number => {
    let n = 0;
    const gOff = (minY > 0.04 ? -minY : 0) - 0.02;
    for (const item of items ?? []) {
      if (n >= maxCount) break;
      const pt = extractPropCoords(item);
      if (!pt) continue;
      if (Math.abs(pt.x) > halfBound || Math.abs(pt.z) > halfBound) continue;
      if (occupancy.isBlocked(pt.x, pt.z, FLAG_BUILDING | FLAG_ROAD_CORE)) continue;
      if (isNearSvCam(pt.x, pt.z, 4.5)) continue;
      dummy.position.set(pt.x, terrain.getTerrainHeight(pt.x, pt.z) + gOff, pt.z);
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set(0, pt.yaw, 0);
      dummy.scale.setScalar(pt.scale);
      dummy.updateMatrix();
      sink(dummy.matrix);
      n++;
    }
    return n;
  };

  const roseLayer = makeLayer('VineyardRosePosts', rose, { cast: true, sway: 0 });
  stats.vineyardRoses = placePoints(layout.vineyardRoses, 800, rose.asset.minY, (m) => roseLayer.add(m));
  group.add(roseLayer.build());
  registerVegLayer(roseLayer);

  const simple = (name: string, items: FieldPropPlacement[] | undefined, proto: Awaited<ReturnType<typeof loadSimple>>, maxCount: number): number => {
    const matrices: THREE.Matrix4[] = [];
    const n = placePoints(items, maxCount, proto.minY, (m) => matrices.push(m.clone()));
    if (matrices.length > 0) group.add(createInstancedPropGroup(name, proto, matrices));
    return n;
  };
  stats.strawStacks = simple('StrawBaleStacks', layout.strawStacks, strawStackProto, 120);
  stats.hochsitze = simple('Hochsitze', layout.hochsitze, hochsitzProto, 24);
  stats.waysideCrosses = simple('WaysideCrosses', layout.waysideCrosses, wegekreuzProto, 16);

  stats.totalPropInstances =
    stats.hedgerows + stats.wildflowerStrips + stats.vineyardRoses + stats.strawStacks + stats.hochsitze + stats.waysideCrosses;

  return { group, stats, update, setQuality: setVegetationQuality };
}
