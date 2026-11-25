import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
  update: (dt: number) => void;
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

interface SubMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  localMatrix: THREE.Matrix4;
}

interface FieldPrototype {
  parts: SubMeshPart[];
  size: THREE.Vector3;
  minY: number;
  maxY: number;
  meta: FieldsManifestModel;
}

function attachWindSway(
  mat: THREE.Material,
  windTimeUniform: { value: number },
  strength: number,
  maxH: number
): void {
  if (strength <= 0.001) return;
  if (!(mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial)) return;
  const key = `field-wind-${strength.toFixed(3)}-${maxH.toFixed(2)}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFieldWindTime = windTimeUniform;
    shader.uniforms.uFieldWindStrength = { value: strength };
    shader.uniforms.uFieldWindMaxH = { value: Math.max(0.25, maxH) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFieldWindTime;
        uniform float uFieldWindStrength;
        uniform float uFieldWindMaxH;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 fwPos = instanceMatrix[3].xz;
        #else
          vec2 fwPos = vec2(0.0);
        #endif
        float fwH = smoothstep(0.06, uFieldWindMaxH, transformed.y);
        float fwPhase = uFieldWindTime * 1.45 + fwPos.x * 0.085 + fwPos.y * 0.062 + transformed.x * 0.42;
        float fwGust = sin(fwPhase) * 0.65 + sin(fwPhase * 1.83 + 1.3) * 0.35;
        transformed.x += fwGust * uFieldWindStrength * fwH * fwH;
        transformed.z += cos(fwPhase * 0.87 + 0.6) * uFieldWindStrength * 0.55 * fwH * fwH;`
      );
  };
  mat.needsUpdate = true;
}

function extractFieldPrototype(
  sceneRoot: THREE.Object3D,
  meta: FieldsManifestModel,
  maxAnisotropy: number,
  windTimeUniform: { value: number },
  windStrength: number
): FieldPrototype {
  sceneRoot.updateMatrixWorld(true);
  const rootInv = sceneRoot.matrixWorld.clone().invert();
  const parts: SubMeshPart[] = [];
  const bbox = new THREE.Box3();
  const patchedMats = new Set<THREE.Material>();

  sceneRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
    const localMatrix = new THREE.Matrix4().multiplyMatrices(rootInv, obj.matrixWorld);
    const gBox = new THREE.Box3().setFromBufferAttribute(obj.geometry.attributes.position as THREE.BufferAttribute);
    gBox.applyMatrix4(localMatrix);
    bbox.union(gBox);
    parts.push({ geometry: obj.geometry, material: obj.material, localMatrix });
  });

  const size = new THREE.Vector3(1, 1, 1);
  let minY = 0;
  let maxY = 1;
  if (!bbox.isEmpty()) {
    bbox.getSize(size);
    minY = bbox.min.y;
    maxY = Math.max(0.25, bbox.max.y);
  }

  for (const part of parts) {
    const mats = Array.isArray(part.material) ? part.material : [part.material];
    for (const mat of mats) {
      if (patchedMats.has(mat)) continue;
      patchedMats.add(mat);
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        mat.envMapIntensity = 0.62;
        if (mat.map) mat.map.anisotropy = Math.min(4, maxAnisotropy);
        if (windStrength > 0.001) {
          attachWindSway(mat, windTimeUniform, windStrength, maxY);
        }
      }
    }
  }

  return { parts, size, minY, maxY, meta };
}

function createInstancedFieldGroup(
  name: string,
  proto: FieldPrototype,
  matrices: THREE.Matrix4[],
  options?: { castShadow?: boolean; receiveShadow?: boolean; colors?: THREE.Color[] }
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  if (matrices.length === 0 || proto.parts.length === 0) return group;

  const castShadow = options?.castShadow ?? false;
  const receiveShadow = options?.receiveShadow ?? true;
  const tmpMat = new THREE.Matrix4();

  for (let p = 0; p < proto.parts.length; p++) {
    const part = proto.parts[p];
    const inst = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    inst.name = `${name}_p${p}`;
    inst.castShadow = castShadow;
    inst.receiveShadow = receiveShadow;

    for (let i = 0; i < matrices.length; i++) {
      tmpMat.multiplyMatrices(matrices[i], part.localMatrix);
      inst.setMatrixAt(i, tmpMat);
      if (options?.colors && options.colors[i]) {
        inst.setColorAt(i, options.colors[i]);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}

function findModelEntry(manifest: FieldsManifest, ...keywords: string[]): FieldsManifestModel | null {
  for (const kw of keywords) {
    if (manifest.models[kw]) return manifest.models[kw];
  }
  for (const [k, entry] of Object.entries(manifest.models)) {
    const kl = k.toLowerCase();
    const ul = (entry.glbPath ?? '').toLowerCase();
    for (const kw of keywords) {
      if (kl.includes(kw) || ul.includes(kw)) return entry;
    }
  }
  return null;
}

function makeAerialTintColor(hex: string | undefined, bucket: string, rand: () => number): THREE.Color {
  // Keep sunlit golden sunflowers radiant rather than multiplying blooms by dark-green soil aerial tint
  if (bucket === 'sunflower') {
    const base = new THREE.Color(0xfffce8);
    if (hex && /^#?[0-9a-f]{6}$/i.test(hex)) {
      const tint = new THREE.Color(hex.startsWith('#') ? hex : `#${hex}`);
      base.lerp(tint, 0.05);
    }
    const jitter = 0.96 + rand() * 0.1;
    base.multiplyScalar(jitter);
    return base;
  }

  const base = new THREE.Color(0xffffff);
  if (hex && /^#?[0-9a-f]{6}$/i.test(hex)) {
    const tint = new THREE.Color(hex.startsWith('#') ? hex : `#${hex}`);
    // Subtle 18% blend toward sampled DOP20 field tint keeps close-up crops vivid while matching satellite imagery
    base.lerp(tint, 0.18);
  }
  const jitter = 0.94 + rand() * 0.12;
  base.multiplyScalar(jitter);
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
    typeof item.rotationRad === 'number'
      ? item.rotationRad
      : typeof item.yawRad === 'number'
        ? item.yawRad
        : typeof item.yaw === 'number'
          ? item.yaw
          : 0;
  const scale = typeof item.scale === 'number' && Number.isFinite(item.scale) ? THREE.MathUtils.clamp(item.scale, 0.65, 1.55) : 1.0;
  return { x, z, yaw, scale };
}

function buildOccupancy(
  mapSizeM: number,
  buildings: BuildingRecord[],
  roads: RoadRecord[],
  sceneData: SceneData
): FieldOccupancyGrid {
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
  return grid;
}

const DEFAULT_WIND: Record<string, number> = {
  wheat: 0.11,
  stubble: 0.0,
  corn: 0.15,
  sugarbeet: 0.05,
  sunflower: 0.12,
  meadow: 0.09,
  wildflower: 0.1,
  hedgerow: 0.04,
};

const CROP_BUDGETS: Record<string, number> = {
  wheat: 9500,
  stubble: 7500,
  corn: 7500,
  sugarbeet: 8500,
  sunflower: 5000,
  meadow: 5500,
};

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

  const windTimeUniform = { value: 0 };
  const update = (dt: number) => {
    windTimeUniform.value += dt;
  };

  if (!layout || !manifest || Object.keys(manifest.models).length === 0) {
    return { group, stats, update };
  }

  const loader = new GLTFLoader();
  const loadModel = async (defaultWindKey: string, ...keywords: string[]): Promise<FieldPrototype | null> => {
    const entry = findModelEntry(manifest, ...keywords);
    if (!entry?.glbPath) return null;
    try {
      const gltf = await loader.loadAsync(entry.glbPath);
      const windStr =
        typeof entry.windSway === 'number'
          ? entry.windSway
          : typeof entry.windSwayStrength === 'number'
            ? entry.windSwayStrength
            : DEFAULT_WIND[defaultWindKey] ?? 0;
      return extractFieldPrototype(gltf.scene, entry, maxAnisotropy, windTimeUniform, windStr);
    } catch (err) {
      console.warn(`[fields] Failed to load ${entry.glbPath}:`, err);
      return null;
    }
  };

  const [
    wheatProto,
    stubbleProto,
    cornProto,
    sugarbeetProto,
    sunflowerProto,
    meadowProto,
    wildflowerProto,
    hedgerowProto,
    roseProto,
    strawStackProto,
    hochsitzProto,
    wegekreuzProto,
  ] = await Promise.all([
    loadModel('wheat', 'crop_wheat_patch', 'wheat'),
    loadModel('stubble', 'crop_stubble_patch', 'stubble'),
    loadModel('corn', 'crop_corn_row', 'corn', 'maize'),
    loadModel('sugarbeet', 'crop_sugarbeet_row', 'sugarbeet', 'beet'),
    loadModel('sunflower', 'crop_sunflower_patch', 'sunflower'),
    loadModel('meadow', 'meadow_grass_patch', 'meadow'),
    loadModel('wildflower', 'wildflower_strip', 'wildflower'),
    loadModel('hedgerow', 'hedgerow_bay', 'hedgerow'),
    loadModel('none', 'vineyard_rose_post', 'rose_post', 'rose'),
    loadModel('none', 'straw_bale_stack', 'straw_stack', 'straw'),
    loadModel('none', 'hochsitz', 'high_seat'),
    loadModel('none', 'wegekreuz', 'wayside_cross'),
  ]);

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

  const groundOffset = (proto: FieldPrototype): number => (proto.minY > 0.04 ? -proto.minY : 0);
  const rand = mulberry32(6727102);
  const halfBound = terrain.halfSizeM - 10;
  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  const tiltQuat = new THREE.Quaternion();
  const yawQuat = new THREE.Quaternion();

  // ---------------------------------------------------------------------------
  // 1. CLASSIFIED AGRICULTURAL FIELD PARCELS (wheat, stubble, corn, sugarbeet, sunflower, meadow)
  // ---------------------------------------------------------------------------
  const cropProtos: Record<string, FieldPrototype | null> = {
    wheat: wheatProto,
    stubble: stubbleProto,
    corn: cornProto,
    sugarbeet: sugarbeetProto,
    sunflower: sunflowerProto,
    meadow: meadowProto,
    orchard: meadowProto,
  };

  const cropMatrices: Record<string, THREE.Matrix4[]> = {
    wheat: [],
    stubble: [],
    corn: [],
    sugarbeet: [],
    sunflower: [],
    meadow: [],
  };
  const cropColors: Record<string, THREE.Color[]> = {
    wheat: [],
    stubble: [],
    corn: [],
    sugarbeet: [],
    sunflower: [],
    meadow: [],
  };

  const parcels = Array.isArray(layout.fields) ? layout.fields : [];
  stats.parcelCount = parcels.length;

  // Prioritize fields closer to the village, L450, Triftstraße, Am Kirchrain & Judenberg first
  const priorityCenters: [number, number][] = [
    [0, -40],
    [-460, 40],
    [-315, 160],
    [520, -200],
    [315, 80],
  ];

  const sortedParcels = parcels
    .filter((f): f is FieldParcelRecord => Boolean(f && Array.isArray(f.points) && f.points.length >= 3))
    .map((f) => {
      let cx = 0;
      let cz = 0;
      for (const [x, z] of f.points) {
        cx += x;
        cz += z;
      }
      cx /= f.points.length;
      cz /= f.points.length;
      let minD = Infinity;
      for (const [px, pz] of priorityCenters) {
        const d = Math.hypot(cx - px, cz - pz);
        if (d < minD) minD = d;
      }
      return { f, cx, cz, minD };
    })
    .sort((a, b) => a.minD - b.minD);

  // Estimate total area per crop class so budgets distribute cleanly edge-to-edge across EVERY field!
  const totalAreaByBucket: Record<string, number> = {};
  for (const { f } of sortedParcels) {
    const rawCrop = (f.crop ?? f.cropType ?? '').toLowerCase();
    if (!rawCrop || rawCrop === 'plowed' || rawCrop === 'vineyard' || rawCrop === 'bare') continue;
    const bucket = rawCrop === 'orchard' || rawCrop === 'grass' ? 'meadow' : rawCrop;
    if (!(bucket in cropMatrices)) continue;
    totalAreaByBucket[bucket] = (totalAreaByBucket[bucket] ?? 0) + Math.max(0.08, f.areaHa ?? 0.5);
  }

  for (const { f } of sortedParcels) {
    const rawCrop = (f.crop ?? f.cropType ?? '').toLowerCase();
    if (!rawCrop || rawCrop === 'plowed' || rawCrop === 'vineyard' || rawCrop === 'bare') continue;
    const bucket = rawCrop === 'orchard' || rawCrop === 'grass' ? 'meadow' : rawCrop;
    const proto = cropProtos[bucket];
    if (!proto || !(bucket in cropMatrices)) continue;

    const targetMats = cropMatrices[bucket];
    const targetCols = cropColors[bucket];
    const budget = CROP_BUDGETS[bucket] ?? 4000;
    if (targetMats.length >= budget) continue;

    const pts = f.points;
    const isRowCrop = bucket === 'corn' || bucket === 'sugarbeet';
    const rotY =
      typeof f.rowAngleRad === 'number' && Number.isFinite(f.rowAngleRad)
        ? f.rowAngleRad
        : estimateLongestEdgeAngle(pts);

    const dirX = Math.cos(rotY);
    const dirZ = -Math.sin(rotY);
    const perpX = -dirZ;
    const perpZ = dirX;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of pts) {
      const u = x * dirX + z * dirZ;
      const v = x * perpX + z * perpZ;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    // Nominal tile/row dimensions from manifest metadata or measured GLB bounds
    const baseStepU =
      proto.meta.alongRowM ??
      proto.meta.spacingM ??
      Math.max(2.4, Math.min(8.0, proto.size.x * 0.94));
    const baseStepV =
      proto.meta.betweenBaysM ??
      proto.meta.spacingM ??
      Math.max(2.0, Math.min(8.0, proto.size.z * 0.94));

    // Scale grid spacing gently across all parcels of this crop class so every parcel fills 100% seamlessly within GPU budget
    const totalAreaM2 = (totalAreaByBucket[bucket] ?? 1.0) * 10000;
    const idealTileArea = baseStepU * baseStepV;
    const estTotalTiles = totalAreaM2 / Math.max(4, idealTileArea);
    const densityScale = estTotalTiles > budget * 0.92 ? Math.sqrt(estTotalTiles / (budget * 0.92)) : 1.0;
    const clampedScale = THREE.MathUtils.clamp(densityScale, 1.0, 2.25);
    const stepU = baseStepU * clampedScale;
    const stepV = baseStepV * clampedScale;
    // Match horizontal XZ footprint to step spacing (zero checkerboard gaps!) while keeping botanical Y height realistic
    const overlapPad = bucket === 'stubble' ? 1.14 : 1.04;
    const scaleBoostXZ = clampedScale > 1.01 ? clampedScale * overlapPad : bucket === 'stubble' ? 1.06 : 1.0;

    const gOff = groundOffset(proto) - 0.03;
    const margin = Math.min(1.6, Math.min(stepU, stepV) * 0.25);
    const runsAlongX = proto.size.x >= proto.size.z;
    const segLen = Math.max(2.5, runsAlongX ? proto.size.x : proto.size.z);

    let rowIdx = 0;
    for (let v = minV + margin; v <= maxV - margin; v += stepV) {
      const stagger = isRowCrop ? 0 : (rowIdx % 2) * (stepU * 0.48);
      rowIdx++;
      for (let u = minU + margin + stagger; u <= maxU - margin; u += stepU) {
        if (targetMats.length >= budget) break;

        const jU = isRowCrop ? 0 : (rand() - 0.5) * stepU * 0.22;
        const jV = isRowCrop ? 0 : (rand() - 0.5) * stepV * 0.22;
        const wx = (u + jU) * dirX + (v + jV) * perpX;
        const wz = (u + jU) * dirZ + (v + jV) * perpZ;

        if (Math.abs(wx) > halfBound || Math.abs(wz) > halfBound) continue;
        if (!pointInPolygon(wx, wz, pts)) continue;
        if (occupancy.isBlocked(wx, wz, FLAG_BUILDING | FLAG_ROAD | FLAG_VINEYARD)) continue;
        if (isNearSvCam(wx, wz, 5.2)) continue;

        const hMid = terrain.getTerrainHeight(wx, wz);

        if (isRowCrop) {
          const halfS = segLen * 0.42;
          const ax = wx - dirX * halfS;
          const az = wz - dirZ * halfS;
          const bx = wx + dirX * halfS;
          const bz = wz + dirZ * halfS;
          if (!pointInPolygon(ax, az, pts) || !pointInPolygon(bx, bz, pts)) continue;
          if (occupancy.isBlocked(ax, az, FLAG_BUILDING | FLAG_ROAD) || occupancy.isBlocked(bx, bz, FLAG_BUILDING | FLAG_ROAD)) continue;
          const hA = terrain.getTerrainHeight(ax, az);
          const hB = terrain.getTerrainHeight(bx, bz);
          const slopePitch = Math.atan2(hB - hA, segLen * 0.84);

          dummy.position.set(wx, hMid + gOff, wz);
          dummy.rotation.order = 'YXZ';
          if (runsAlongX) {
            dummy.rotation.set(0, rotY, slopePitch);
          } else {
            dummy.rotation.set(-slopePitch, Math.atan2(dirX, dirZ), 0);
          }
          const hVar = 0.92 + rand() * 0.16;
          dummy.scale.set(scaleBoostXZ, hVar, scaleBoostXZ);
          dummy.updateMatrix();
        } else {
          // Patch crop: gently follow hillside terrain normal so wide 5-6m patches hug slopes without floating
          const n = terrain.getTerrainNormal(wx, wz, 3.0);
          n.lerp(upVec, 0.28).normalize();
          tiltQuat.setFromUnitVectors(upVec, n);

          let yaw = rotY;
          if (bucket === 'sunflower') {
            // Pfalz sunflowers orient mostly southward with gentle organic spread
            yaw = (rand() - 0.5) * 0.45;
          } else if (bucket === 'meadow' || bucket === 'wheat' || bucket === 'stubble') {
            yaw = rotY + Math.floor(rand() * 4) * (Math.PI * 0.5) + (rand() - 0.5) * 0.3;
          }
          yawQuat.setFromAxisAngle(upVec, yaw);

          dummy.position.set(wx, hMid + gOff, wz);
          dummy.quaternion.copy(tiltQuat).multiply(yawQuat);
          const hVar = 0.88 + rand() * 0.24;
          dummy.scale.set(scaleBoostXZ * (0.94 + rand() * 0.14), hVar, scaleBoostXZ * (0.94 + rand() * 0.14));
          dummy.updateMatrix();
        }

        targetMats.push(dummy.matrix.clone());
        targetCols.push(makeAerialTintColor(f.aerialTintHex, bucket, rand));
      }
      if (targetMats.length >= budget) break;
    }
  }

  for (const key of ['wheat', 'stubble', 'corn', 'sugarbeet', 'sunflower', 'meadow'] as const) {
    const proto = cropProtos[key];
    const mats = cropMatrices[key];
    if (proto && mats.length > 0) {
      group.add(
        createInstancedFieldGroup(`FieldCrop_${key}`, proto, mats, {
          castShadow: key === 'corn',
          receiveShadow: true,
          colors: cropColors[key],
        })
      );
      stats[key] = mats.length;
      stats.totalCropInstances += mats.length;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. LINEAR FIELD MARGINS: HEDGEROWS (Windschutzhecken) & WILDFLOWER STRIPS (Blühstreifen)
  // ---------------------------------------------------------------------------
  const populateLinearProp = (
    name: string,
    items: FieldPropPlacement[] | undefined,
    proto: FieldPrototype | null,
    defaultBayLenM: number,
    maxCount: number,
    castShadow: boolean
  ): number => {
    if (!proto || !Array.isArray(items) || items.length === 0) return 0;
    const matrices: THREE.Matrix4[] = [];
    const gOff = groundOffset(proto) - 0.04;
    const bayLen = Math.max(2.2, proto.meta.alongRowM ?? proto.meta.spacingM ?? (proto.size.x > 1.5 ? proto.size.x * 0.94 : defaultBayLenM));
    const runsAlongX = proto.size.x >= proto.size.z;

    const pushBay = (cx: number, cz: number, dirX: number, dirZ: number, scale = 1.0) => {
      if (matrices.length >= maxCount) return;
      if (Math.abs(cx) > halfBound || Math.abs(cz) > halfBound) return;
      if (occupancy.isBlocked(cx, cz, FLAG_BUILDING | FLAG_ROAD_CORE)) return;
      if (isNearSvCam(cx, cz, 4.8)) return;

      const halfB = bayLen * 0.42;
      const hA = terrain.getTerrainHeight(cx - dirX * halfB, cz - dirZ * halfB);
      const hB = terrain.getTerrainHeight(cx + dirX * halfB, cz + dirZ * halfB);
      const hM = terrain.getTerrainHeight(cx, cz);
      const slopePitch = Math.atan2(hB - hA, bayLen * 0.84);
      const rotY = Math.atan2(-dirZ, dirX);

      dummy.position.set(cx, hM + gOff, cz);
      dummy.rotation.order = 'YXZ';
      if (runsAlongX) {
        dummy.rotation.set(0, rotY, slopePitch);
      } else {
        dummy.rotation.set(-slopePitch, Math.atan2(dirX, dirZ), 0);
      }
      const sVar = scale * (0.92 + rand() * 0.16);
      dummy.scale.set(scale, sVar, scale * (0.92 + rand() * 0.16));
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    };

    for (const item of items) {
      if (matrices.length >= maxCount) break;
      if (Array.isArray(item.points) && item.points.length >= 2) {
        const poly = item.points.map(extractXZ);
        for (let i = 0; i < poly.length - 1; i++) {
          const [x0, z0] = poly[i];
          const [x1, z1] = poly[i + 1];
          const segLen = Math.hypot(x1 - x0, z1 - z0);
          if (segLen < 1.2) continue;
          const dx = (x1 - x0) / segLen;
          const dz = (z1 - z0) / segLen;
          const count = Math.max(1, Math.round(segLen / bayLen));
          for (let k = 0; k < count; k++) {
            const t = (k + 0.5) / count;
            pushBay(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, dx, dz, item.scale ?? 1.0);
          }
        }
      } else {
        const pt = extractPropCoords(item);
        if (!pt) continue;
        const dx = Math.cos(pt.yaw);
        const dz = -Math.sin(pt.yaw);
        pushBay(pt.x, pt.z, dx, dz, pt.scale);
      }
    }

    if (matrices.length > 0) {
      group.add(createInstancedFieldGroup(name, proto, matrices, { castShadow, receiveShadow: true }));
    }
    return matrices.length;
  };

  stats.hedgerows = populateLinearProp('FieldHedgerows', layout.hedgerows, hedgerowProto, 5.0, 1400, true);
  stats.wildflowerStrips = populateLinearProp(
    'FieldWildflowerStrips',
    layout.wildflowerStrips,
    wildflowerProto,
    5.0,
    1800,
    false
  );

  // ---------------------------------------------------------------------------
  // 3. RURAL LANDMARKS & FIELD PROPS (Vineyard Roses, Straw Stacks, Hochsitze, Wegekreuze)
  // ---------------------------------------------------------------------------
  const populatePointProp = (
    name: string,
    items: FieldPropPlacement[] | undefined,
    proto: FieldPrototype | null,
    maxCount: number,
    allowInsideVineyard: boolean,
    castShadow: boolean
  ): number => {
    if (!proto || !Array.isArray(items) || items.length === 0) return 0;
    const matrices: THREE.Matrix4[] = [];
    const gOff = groundOffset(proto) - 0.02;
    const blockMask = allowInsideVineyard ? FLAG_BUILDING | FLAG_ROAD_CORE : FLAG_BUILDING | FLAG_ROAD_CORE;

    for (const item of items) {
      if (matrices.length >= maxCount) break;
      const pt = extractPropCoords(item);
      if (!pt) continue;
      if (Math.abs(pt.x) > halfBound || Math.abs(pt.z) > halfBound) continue;
      if (occupancy.isBlocked(pt.x, pt.z, blockMask)) continue;
      if (isNearSvCam(pt.x, pt.z, 4.5)) continue;

      const y = terrain.getTerrainHeight(pt.x, pt.z) + gOff;
      dummy.position.set(pt.x, y, pt.z);
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set(0, pt.yaw, 0);
      dummy.scale.setScalar(pt.scale);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }

    if (matrices.length > 0) {
      group.add(createInstancedFieldGroup(name, proto, matrices, { castShadow, receiveShadow: true }));
    }
    return matrices.length;
  };

  stats.vineyardRoses = populatePointProp('VineyardRosePosts', layout.vineyardRoses, roseProto, 800, true, true);
  stats.strawStacks = populatePointProp('StrawBaleStacks', layout.strawStacks, strawStackProto, 120, false, true);
  stats.hochsitze = populatePointProp('Hochsitze', layout.hochsitze, hochsitzProto, 24, false, true);
  stats.waysideCrosses = populatePointProp('WaysideCrosses', layout.waysideCrosses, wegekreuzProto, 16, false, true);

  stats.totalPropInstances =
    stats.hedgerows +
    stats.wildflowerStrips +
    stats.vineyardRoses +
    stats.strawStacks +
    stats.hochsitze +
    stats.waysideCrosses;

  return { group, stats, update };
}
