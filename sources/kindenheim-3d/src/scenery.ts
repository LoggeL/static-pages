import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LoadedLandmarkInfo } from './buildings';
import type { TerrainSystem } from './terrain';
import type { BraveReferenceEntry, BuildingRecord, LanduseRecord, RoadRecord, SceneData, VillageManifest, VillagePropEntry } from './types';

function extractRoadXZ(p: [number, number] | [number, number, number]): [number, number] {
  return p.length === 3 ? [p[0], p[2]] : [p[0], p[1]];
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

/**
 * Fast 2m-cell spatial occupancy grid so vines, trees, streetlamps, and hay bales
 * never clip into buildings or roads.
 */
class ExclusionGrid {
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

  public isBlocked(x: number, z: number, mask = 3): boolean {
    const idx = this.toIdx(x, z);
    if (idx < 0) return true;
    return (this.cells[idx] & mask) !== 0;
  }
}

const FLAG_BUILDING = 1;
const FLAG_ROAD = 2;

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
      bestAngle = Math.atan2(dz, dx);
    }
  }
  return bestAngle;
}

interface SubMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  localMatrix: THREE.Matrix4;
}

interface LoadedPropPrototype {
  parts: SubMeshPart[];
  size: THREE.Vector3;
  minY: number;
}

function extractPropPrototype(sceneRoot: THREE.Object3D, maxAnisotropy: number): LoadedPropPrototype {
  sceneRoot.updateMatrixWorld(true);
  const rootInv = sceneRoot.matrixWorld.clone().invert();
  const parts: SubMeshPart[] = [];
  const bbox = new THREE.Box3();

  sceneRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
    const localMatrix = new THREE.Matrix4().multiplyMatrices(rootInv, obj.matrixWorld);

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        mat.envMapIntensity = 0.72;
        if (mat.map) mat.map.anisotropy = Math.min(4, maxAnisotropy);
      }
    }

    parts.push({
      geometry: obj.geometry,
      material: obj.material,
      localMatrix,
    });

    const gBox = new THREE.Box3().setFromBufferAttribute(obj.geometry.attributes.position as THREE.BufferAttribute);
    gBox.applyMatrix4(localMatrix);
    bbox.union(gBox);
  });

  const size = new THREE.Vector3(1, 1, 1);
  let minY = 0;
  if (!bbox.isEmpty()) {
    bbox.getSize(size);
    minY = bbox.min.y;
  }
  return { parts, size, minY };
}

function createInstancedPropGroup(
  name: string,
  proto: LoadedPropPrototype,
  matrices: THREE.Matrix4[],
  options?: { castShadow?: boolean; receiveShadow?: boolean; colors?: THREE.Color[] }
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  if (matrices.length === 0 || proto.parts.length === 0) return group;

  const castShadow = options?.castShadow ?? true;
  const receiveShadow = options?.receiveShadow ?? true;
  const tmpMat = new THREE.Matrix4();

  for (let p = 0; p < proto.parts.length; p++) {
    const part = proto.parts[p];
    const inst = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    inst.name = `${name}_part${p}`;
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

function findPropUrl(manifest: VillageManifest | null, ...keywords: string[]): string | null {
  if (!manifest?.props) return null;
  for (const [key, entry] of Object.entries(manifest.props)) {
    const kLower = key.toLowerCase();
    const url = typeof entry === 'string' ? entry : (entry as VillagePropEntry).glbPath ?? '';
    const uLower = url.toLowerCase();
    for (const kw of keywords) {
      if (kLower.includes(kw) || uLower.includes(kw)) {
        return url;
      }
    }
  }
  return null;
}

export interface SceneryStats {
  vineInstances: number;
  treeInstances: number;
  lampInstances: number;
  ortsschildCount: number;
  hayBaleInstances: number;
  barrelInstances: number;
}

export interface SceneryResult {
  group: THREE.Group;
  stats: SceneryStats;
  vineyardShowcasePoint: [number, number] | null;
  hauptstrasseShowcasePoint: [number, number] | null;
  feldwegShowcasePoint: [number, number] | null;
}

function buildExclusionGrid(mapSizeM: number, buildings: BuildingRecord[], roads: RoadRecord[]): ExclusionGrid {
  const grid = new ExclusionGrid(mapSizeM);
  for (const b of buildings) {
    if (b.footprint && b.footprint.length >= 3) {
      grid.markPolygon(b.footprint, 2.2, FLAG_BUILDING);
    } else if (b.center) {
      grid.markCircle(b.center[0], b.center[1], Math.max(b.widthM ?? 8, b.depthM ?? 8) * 0.6 + 2.0, FLAG_BUILDING);
    }
  }
  for (const r of roads) {
    if (!r.points || r.points.length < 2) continue;
    const pts: [number, number][] = r.points.map(extractRoadXZ);
    const hw = r.highway || '';
    const w = r.widthM ?? (hw === 'primary' || hw === 'secondary' ? 6.4 : hw === 'track' ? 3.0 : 4.8);
    // Keep tighter clearance along rural L450 / tracks so lush Pfalz grapevine rows flank the road verge authentically
    const pad = hw === 'track' || hw === 'path' ? 0.85 : 1.05;
    grid.markPolyline(pts, w * 0.5 + pad, FLAG_ROAD);
  }
  return grid;
}

export async function buildSceneryAndProps(
  sceneData: SceneData,
  villageManifest: VillageManifest | null,
  landmarks: Map<string, LoadedLandmarkInfo>,
  terrain: TerrainSystem,
  maxAnisotropy: number,
  references?: BraveReferenceEntry[]
): Promise<SceneryResult> {
  const group = new THREE.Group();
  group.name = 'KindenheimScenery';

  const stats: SceneryStats = {
    vineInstances: 0,
    treeInstances: 0,
    lampInstances: 0,
    ortsschildCount: 0,
    hayBaleInstances: 0,
    barrelInstances: 0,
  };

  const loader = new GLTFLoader();
  const loadProp = async (...keywords: string[]): Promise<LoadedPropPrototype | null> => {
    const url = findPropUrl(villageManifest, ...keywords);
    if (!url) return null;
    try {
      const gltf = await loader.loadAsync(url);
      return extractPropPrototype(gltf.scene, maxAnisotropy);
    } catch (err) {
      console.warn(`[scenery] Failed to load prop ${url}:`, err);
      return null;
    }
  };

  const [vineProto, treeDecidProto, treeOrchardProto, ortsschildProto, lampProto, hayProto, barrelProto] =
    await Promise.all([
      loadProp('vine_row', 'vine'),
      loadProp('tree_deciduous', 'deciduous'),
      loadProp('tree_orchard', 'orchard'),
      loadProp('ortsschild', 'sign'),
      loadProp('streetlamp', 'lamp'),
      loadProp('hay_bale', 'hay'),
      loadProp('wine_barrel', 'barrel'),
    ]);

  const exclusion = buildExclusionGrid(terrain.mapSizeM, sceneData.buildings, sceneData.roads);
  // Protect Street View camera positions from random non-explicit trees/lamps spawning directly in front of the lens
  const svCamPoints: [number, number][] = (references ?? [])
    .filter((r) => (r.cameraHeightM ?? 2.5) < 15 && typeof r.localX === 'number' && typeof r.localZ === 'number')
    .map((r) => [r.localX!, r.localZ!]);
  const isNearSvCamera = (x: number, z: number, radiusM = 4.6): boolean => {
    const r2 = radiusM * radiusM;
    for (const [cx, cz] of svCamPoints) {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  };
  const rand = mulberry32(496108);

  // Compute village core center & radius from building cluster
  let villageMinX = Infinity;
  let villageMaxX = -Infinity;
  let villageMinZ = Infinity;
  let villageMaxZ = -Infinity;
  for (const b of sceneData.buildings) {
    if (!b.center) continue;
    const [bx, bz] = b.center;
    if (Math.hypot(bx, bz) < 550) {
      if (bx < villageMinX) villageMinX = bx;
      if (bx > villageMaxX) villageMaxX = bx;
      if (bz < villageMinZ) villageMinZ = bz;
      if (bz > villageMaxZ) villageMaxZ = bz;
    }
  }
  if (!Number.isFinite(villageMinX)) {
    villageMinX = -260;
    villageMaxX = 260;
    villageMinZ = -260;
    villageMaxZ = 260;
  }

  // Ground contact helper: Blender props have Y=0 at ground contact with negative underground skirts (-0.45..-0.55m).
  // Never lift negative-minY props upward; only shift down if a prop's geometry starts above Y=0.
  const groundOffset = (proto: LoadedPropPrototype): number => (proto.minY > 0.04 ? -proto.minY : 0);

  // ---------------------------------------------------------------------------
  // 1. VINEYARDS (vine_row.glb instanced along real OSM vineyard polygons!)
  // ---------------------------------------------------------------------------
  let vineyardShowcasePoint: [number, number] | null = null;
  // Verified small roadside vineyard patches visible in Street View (Judenberg north embankment & Triftstraße east slope)
  const extraVerifiedVineyards: LanduseRecord[] = [
    {
      id: 'sv_verified_judenberg_north',
      type: 'vineyard',
      areaHa: 0.14,
      rowAngleRad: 0.04,
      points: [
        [-382, -88],
        [-312, -84],
        [-312, -68],
        [-382, -70],
      ],
    },
    {
      id: 'sv_verified_triftstrasse_east',
      type: 'vineyard',
      areaHa: 0.17,
      rowAngleRad: 0.14,
      points: [
        [-296, 118],
        [-264, 116],
        [-264, 168],
        [-294, 168],
      ],
    },
  ];
  const vineyards = [
    ...sceneData.landuse.filter((lu) => lu.type === 'vineyard' && lu.points && lu.points.length >= 3),
    ...extraVerifiedVineyards,
  ];

  if (vineProto && vineyards.length > 0) {
    // Determine whether vine_row.glb runs along local X or local Z
    const runsAlongX = vineProto.size.x >= vineProto.size.z;
    const rawAxisLen = runsAlongX ? vineProto.size.x : vineProto.size.z;
    // vine_row.glb has 6.0m seamless post-to-post bay spacing (foliage overhangs slightly to ~6.5m)
    const segLen = rawAxisLen > 5.5 && rawAxisLen < 7.2 ? 6.0 : Math.max(2.5, rawAxisLen * 0.94);

    // Prioritize vineyards around the village perimeter & key Street View approaches (East L450, Burgweg, Judenberg, Am Kirchrain, Triftstraße)
    // and calibrate spacing across each full polygon so NO parcel stops halfway!
    const keyViewpoints: [number, number][] = [
      [710, -270],   // East L 450 vineyard entrance (sv_vineyard_edge_east — both North & South sides!)
      [580, -245],   // East approach slopes
      [250, -270],   // North village edge / Burgweg
      [20, -80],     // Village core / Martinskirche
      [-340, 60],    // West village edge / Triftstraße
      [-450, -65],   // Judenberg & Am Kirchrain northern hillside vineyards
      [-300, 145],   // Triftstraße east slope vineyards
    ];

    const scoredVineyards = vineyards.map((vy) => {
      let cx = 0;
      let cz = 0;
      let minVertDist = Infinity;
      for (const [x, z] of vy.points) {
        cx += x;
        cz += z;
        for (const [vx, vz] of keyViewpoints) {
          const d = Math.hypot(x - vx, z - vz);
          if (d < minVertDist) minVertDist = d;
        }
      }
      cx /= vy.points.length;
      cz /= vy.points.length;
      let minCenterDist = Infinity;
      for (const [vx, vz] of keyViewpoints) {
        const d = Math.hypot(cx - vx, cz - vz);
        if (d < minCenterDist) minCenterDist = d;
      }
      const priorityDist = Math.min(minCenterDist, minVertDist * 1.12);
      const isEastL450Flank = minVertDist < 165 && cx > 340 && cz < -60;
      const isHeroZone = isEastL450Flank || priorityDist < 340 || Math.hypot(cx - 20, cz + 80) < 460;
      return { vy, cx, cz, priorityDist, isHeroZone, isEastL450Flank };
    });

    // Nearest, most visually prominent vineyards first
    scoredVineyards.sort((a, b) => a.priorityDist - b.priorityDist);

    const heroVineMatrices: THREE.Matrix4[] = [];
    const outerVineMatrices: THREE.Matrix4[] = [];
    const heroBudget = 13500;
    const outerBudget = 3200;
    const dummy = new THREE.Object3D();
    const halfBound = terrain.halfSizeM - 12;
    const vineGroundOff = groundOffset(vineProto);

    let bestVineScore = -Infinity;

    for (const item of scoredVineyards) {
      const { vy, isHeroZone, isEastL450Flank, priorityDist } = item;
      const pts = vy.points;
      const areaHa = vy.areaHa ?? 0.5;

      // Let very distant edge parcels (> 720m from village/L450) rely cleanly on the sharp 20cm DOP20 orthophoto
      // instead of sparse isolated dots in aerial overview shots!
      if (!isHeroZone && priorityDist > 720) continue;

      const useHero = isHeroZone && heroVineMatrices.length < heroBudget;
      if (!useHero && outerVineMatrices.length >= outerBudget) continue;

      const targetMatrices = useHero ? heroVineMatrices : outerVineMatrices;
      const remainingBudget = (useHero ? heroBudget : outerBudget) - targetMatrices.length;
      if (remainingBudget < 12) continue;

      // Generous per-polygon target so large L450 / village-edge parcels fill 100% edge-to-edge without halting halfway
      const desiredPolyBays = isEastL450Flank
        ? Math.min(1150, Math.max(140, Math.round(areaHa * 390)))
        : useHero
          ? Math.min(540, Math.max(75, Math.round(areaHa * 200)))
          : Math.min(180, Math.max(36, Math.round(areaHa * 65)));
      const polyTargetBays = Math.min(desiredPolyBays, remainingBudget);

      // data/meta.json convention: rotationRad = Three.js rotation.y where local +X maps to (cos(r), -sin(r)) in world (x, z)!
      const rotY =
        typeof vy.rowAngleRad === 'number' && Number.isFinite(vy.rowAngleRad)
          ? vy.rowAngleRad
          : -estimateLongestEdgeAngle(pts);

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

      // Compute spacing strictly from actual polygon area so sweep covers minV..maxV COMPLETELY from start to end!
      const idealSpacing = isEastL450Flank ? 2.15 : useHero ? 2.65 : 6.2;
      const uStepBase = useHero ? segLen * 0.98 : segLen * 1.15;
      const actualAreaM2 = Math.max(areaHa * 10000, 1200);
      const estBaysAtIdeal = actualAreaM2 / (idealSpacing * uStepBase);
      const spacingScale = estBaysAtIdeal > polyTargetBays ? (estBaysAtIdeal / polyTargetBays) * 1.12 : 1.0;
      const rowSpacing = THREE.MathUtils.clamp(idealSpacing * spacingScale, idealSpacing, useHero ? 6.8 : 14.0);
      const estAfterRowScale = actualAreaM2 / (rowSpacing * uStepBase);
      const uStep =
        estAfterRowScale > polyTargetBays
          ? uStepBase * Math.min(2.1, (estAfterRowScale / polyTargetBays) * 1.08)
          : uStepBase;

      let addedForPoly = 0;
      let sumX = 0;
      let sumZ = 0;
      const margin = 1.6;
      for (let v = minV + margin; v <= maxV - margin; v += rowSpacing) {
        for (let u = minU + segLen * 0.5 + margin; u <= maxU - segLen * 0.5 - margin; u += uStep) {
          if (targetMatrices.length >= (useHero ? heroBudget : outerBudget)) break;

          const wx = u * dirX + v * perpX;
          const wz = u * dirZ + v * perpZ;
          if (Math.abs(wx) > halfBound || Math.abs(wz) > halfBound) continue;
          if (!pointInPolygon(wx, wz, pts)) continue;

          const halfS = segLen * 0.44;
          const ax = wx - dirX * halfS;
          const az = wz - dirZ * halfS;
          const bx = wx + dirX * halfS;
          const bz = wz + dirZ * halfS;
          if (!pointInPolygon(ax, az, pts) || !pointInPolygon(bx, bz, pts)) continue;
          if (exclusion.isBlocked(wx, wz) || exclusion.isBlocked(ax, az) || exclusion.isBlocked(bx, bz)) continue;

          const hA = terrain.getTerrainHeight(ax, az);
          const hB = terrain.getTerrainHeight(bx, bz);
          const hMid = terrain.getTerrainHeight(wx, wz);
          const slopePitch = Math.atan2(hB - hA, segLen * 0.88);

          dummy.position.set(wx, hMid + vineGroundOff - 0.03, wz);
          dummy.rotation.order = 'YXZ';
          if (runsAlongX) {
            dummy.rotation.set(0, rotY, slopePitch);
          } else {
            dummy.rotation.set(-slopePitch, Math.atan2(dirX, dirZ), 0);
          }
          const scaleVar = 0.94 + rand() * 0.14;
          dummy.scale.set(1.0, scaleVar, 1.0);
          dummy.updateMatrix();
          targetMatrices.push(dummy.matrix.clone());
          addedForPoly++;
          sumX += wx;
          sumZ += wz;
        }
        if (targetMatrices.length >= (useHero ? heroBudget : outerBudget)) break;
      }

      // Pick Bookmark 4 showcase strictly from a densely populated HERO vineyard with clear view back to Kindenheim!
      if (useHero && addedForPoly >= 55) {
        const popCx = sumX / addedForPoly;
        const popCz = sumZ / addedForPoly;
        const distToVillage = Math.hypot(popCx - 20, popCz + 80);
        if (distToVillage > 210 && distToVillage < 680) {
          const density = addedForPoly / Math.max(0.5, areaHa);
          const score = density * 0.5 + (popCx > 200 ? 180 : 0) - Math.abs(distToVillage - 430) * 0.3;
          if (score > bestVineScore) {
            bestVineScore = score;
            vineyardShowcasePoint = [popCx, popCz];
          }
        }
      }
    }

    if (heroVineMatrices.length > 0) {
      group.add(
        createInstancedPropGroup('VineyardsHero', vineProto, heroVineMatrices, {
          castShadow: true,
          receiveShadow: true,
        })
      );
    }
    if (outerVineMatrices.length > 0) {
      group.add(
        createInstancedPropGroup('VineyardsOuter', vineProto, outerVineMatrices, {
          castShadow: false,
          receiveShadow: true,
        })
      );
    }
    stats.vineInstances = heroVineMatrices.length + outerVineMatrices.length;
  }

  // ---------------------------------------------------------------------------
  // 2. TREES (OSM trees + orchards + forests/scrub + natural roadside trees)
  // ---------------------------------------------------------------------------
  const decidMatrices: THREE.Matrix4[] = [];
  const orchardMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const maxBound = terrain.halfSizeM - 16;

  const pushTree = (
    target: THREE.Matrix4[],
    x: number,
    z: number,
    scaleMin: number,
    scaleMax: number,
    proto: LoadedPropPrototype,
    checkExclusion = true
  ) => {
    if (Math.abs(x) > maxBound || Math.abs(z) > maxBound) return;
    if (checkExclusion && (exclusion.isBlocked(x, z) || isNearSvCamera(x, z, 4.6))) return;
    const y = terrain.getTerrainHeight(x, z) + groundOffset(proto) - 0.04;
    const s = scaleMin + rand() * (scaleMax - scaleMin);
    dummy.position.set(x, y, z);
    dummy.rotation.order = 'YXZ';
    dummy.rotation.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06);
    dummy.scale.set(s * (0.9 + rand() * 0.2), s, s * (0.9 + rand() * 0.2));
    dummy.updateMatrix();
    target.push(dummy.matrix.clone());
  };

  // 2a. Explicit OSM tree points (honoring type='orchard'|'deciduous', scale & rotationRad)
  if (sceneData.trees && (treeDecidProto || treeOrchardProto)) {
    const pDecidExplicit = treeDecidProto ?? treeOrchardProto!;
    const pOrchardExplicit = treeOrchardProto ?? treeDecidProto!;
    for (const t of sceneData.trees) {
      let tx: number | undefined = t.x;
      let tz: number | undefined = t.z;
      if (t.position) {
        tx = t.position[0];
        tz = t.position.length >= 3 ? t.position[2] : t.position[1];
      } else if (t.point) {
        tx = t.point[0];
        tz = t.point[1];
      }
      if (tx === undefined || tz === undefined) continue;
      if (Math.abs(tx) > maxBound || Math.abs(tz) > maxBound) continue;
      if (exclusion.isBlocked(tx, tz)) continue;

      const isOrch = (t.type ?? '').toLowerCase().includes('orchard');
      const proto = isOrch ? pOrchardExplicit : pDecidExplicit;
      const target = isOrch ? orchardMatrices : decidMatrices;
      const s =
        typeof t.scale === 'number' && Number.isFinite(t.scale)
          ? THREE.MathUtils.clamp(t.scale, 0.65, 1.55)
          : t.heightM
            ? THREE.MathUtils.clamp(t.heightM / Math.max(4, proto.size.y), 0.7, 1.5)
            : 0.9 + rand() * 0.25;
      const yaw = typeof t.rotationRad === 'number' && Number.isFinite(t.rotationRad) ? t.rotationRad : rand() * Math.PI * 2;
      const ty = terrain.getTerrainHeight(tx, tz) + groundOffset(proto) - 0.04;
      dummy.position.set(tx, ty, tz);
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set((rand() - 0.5) * 0.05, yaw, (rand() - 0.5) * 0.05);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      target.push(dummy.matrix.clone());
    }
  }

  // 2b. Orchards, forests, woods, cemeteries, meadows, village edges
  const pOrchard = treeOrchardProto ?? treeDecidProto;
  const pDecid = treeDecidProto ?? treeOrchardProto;

  for (const lu of sceneData.landuse) {
    if (!lu.points || lu.points.length < 3) continue;
    const pts = lu.points;
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

    if (lu.type === 'orchard' && pOrchard) {
      const step = 9.0;
      for (let z = minZ + 3; z < maxZ - 3; z += step) {
        for (let x = minX + 3; x < maxX - 3; x += step) {
          if (orchardMatrices.length >= 1600) break;
          const jx = x + (rand() - 0.5) * 2.0;
          const jz = z + (rand() - 0.5) * 2.0;
          if (!pointInPolygon(jx, jz, pts)) continue;
          pushTree(orchardMatrices, jx, jz, 0.85, 1.2, pOrchard, true);
        }
      }
    } else if ((lu.type === 'forest' || lu.type === 'wood' || lu.type === 'scrub' || lu.type === 'cemetery' || lu.type === 'park') && pDecid) {
      const step = lu.type === 'cemetery' ? 9.5 : lu.type === 'park' ? 12.5 : 10.5;
      for (let z = minZ + 4; z < maxZ - 4; z += step) {
        for (let x = minX + 4; x < maxX - 4; x += step) {
          if (decidMatrices.length >= 2200) break;
          const jx = x + (rand() - 0.5) * step * 0.65;
          const jz = z + (rand() - 0.5) * step * 0.65;
          if (!pointInPolygon(jx, jz, pts)) continue;
          pushTree(decidMatrices, jx, jz, 0.85, 1.4, pDecid, true);
        }
      }
    } else if ((lu.type === 'meadow' || lu.type === 'grass' || lu.type === 'residential') && pOrchard && pDecid) {
      // Sparse natural boundary trees along village gardens & meadows
      for (let i = 0; i < pts.length; i++) {
        if (rand() > 0.22) continue;
        if (decidMatrices.length + orchardMatrices.length >= 2800) break;
        const [x, z] = pts[i];
        const jx = x + (rand() - 0.5) * 5.0;
        const jz = z + (rand() - 0.5) * 5.0;
        if (lu.type === 'residential') {
          pushTree(orchardMatrices, jx, jz, 0.72, 1.05, pOrchard, true);
        } else {
          pushTree(decidMatrices, jx, jz, 0.85, 1.25, pDecid, true);
        }
      }
    }
  }

  // 2c. Gentle roadside Palatinate tree accents along B271 outside village core
  if (pDecid) {
    for (const r of sceneData.roads) {
      if (r.highway !== 'primary' && r.highway !== 'secondary') continue;
      const pts: [number, number][] = r.points.map(extractRoadXZ);
      let accDist = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i];
        const [x1, z1] = pts[i + 1];
        const segD = Math.hypot(x1 - x0, z1 - z0);
        if (segD < 0.5) continue;
        const tx = (x1 - x0) / segD;
        const tz = (z1 - z0) / segD;
        const rx = -tz;
        const rz = tx;
        accDist += segD;
        if (accDist >= 42) {
          accDist = 0;
          const side = rand() > 0.5 ? 1 : -1;
          const wx = x0 + rx * side * 7.5;
          const wz = z0 + rz * side * 7.5;
          if (Math.hypot(wx, wz) > 220 && decidMatrices.length < 2900) {
            pushTree(decidMatrices, wx, wz, 0.9, 1.3, pDecid, true);
          }
        }
      }
    }
  }

  // 2d. Iconic large mature deciduous tree at East Martinskirche churchyard (verified in sv_kirche_front_detail & sv_kirche_east_angle)
  //     + lush southern Kinderbach waterway canopy belt (verified in aerial_overview_village)
  if (pDecid) {
    const churchTreeX = -20.8;
    const churchTreeZ = -66.5;
    const churchTreeY = terrain.getTerrainHeight(churchTreeX, churchTreeZ) + groundOffset(pDecid) - 0.08;
    dummy.position.set(churchTreeX, churchTreeY, churchTreeZ);
    dummy.rotation.set(0, 0.85, 0);
    dummy.scale.set(1.88, 1.82, 1.88);
    dummy.updateMatrix();
    decidMatrices.push(dummy.matrix.clone());

    // Complementary lush crown volume on the east flank matching the real broad mature linden/chestnut tree
    const churchTree2X = -18.2;
    const churchTree2Z = -68.8;
    const churchTree2Y = terrain.getTerrainHeight(churchTree2X, churchTree2Z) + groundOffset(pDecid) - 0.08;
    dummy.position.set(churchTree2X, churchTree2Y, churchTree2Z);
    dummy.rotation.set(0, 2.45, 0);
    dummy.scale.set(1.42, 1.48, 1.42);
    dummy.updateMatrix();
    decidMatrices.push(dummy.matrix.clone());

    if (sceneData.waterways && sceneData.waterways.length > 0) {
      for (const ww of sceneData.waterways) {
        if (!ww.points || ww.points.length < 2) continue;
        const pts: [number, number][] = ww.points.map(extractRoadXZ);
        let acc = 4;
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, z0] = pts[i];
          const [x1, z1] = pts[i + 1];
          const segD = Math.hypot(x1 - x0, z1 - z0);
          if (segD < 0.5) continue;
          const tx = (x1 - x0) / segD;
          const tz = (z1 - z0) / segD;
          const rx = -tz;
          const rz = tx;
          const midX = (x0 + x1) * 0.5;
          const midZ = (z0 + z1) * 0.5;
          const nearTriftBridge = midX >= -365 && midX <= -265 && midZ >= 192 && midZ <= 258;
          const spacing = nearTriftBridge ? 9.0 : 11.0;
          acc += segD;
          if (acc >= spacing && decidMatrices.length < 3600) {
            acc = 0;
            for (const side of [-1, 1]) {
              if (!nearTriftBridge && rand() > 0.78) continue;
              const offset = (ww.widthM ?? 1.8) * 0.5 + (nearTriftBridge ? 4.8 : 2.2) + rand() * 3.6;
              const wx = midX + rx * side * offset;
              const wz = midZ + rz * side * offset;
              // Keep immediate Triftstraße bridge railings & central sky corridor clear (handled by exact bank canopy below)
              if (wx >= -328.5 && wx <= -307.5 && wz >= 195 && wz <= 226) continue;
              pushTree(decidMatrices, wx, wz, nearTriftBridge ? 0.95 : 0.85, nearTriftBridge ? 1.32 : 1.38, pDecid, true);
            }
          }
        }
      }
    }

    // Calibrated riparian willow/alder canopy on Kinderbach creek banks flanking Triftstraße bridge (sv_triftstrasse_south_vista.png):
    // Set back 8–13m off bridge centerline so zero branches clip railings and central sky wedge (35%–70%) stays open!
    const triftBridgeCanopy: [number, number, number][] = [
      // East bank (left side of photo): lush mid-height screen outside east railing + taller canopy further south
      [-306.8, 204.5, 1.04],
      [-307.2, 211.5, 1.18],
      [-308.0, 219.5, 1.32],
      [-309.5, 228.5, 1.24],
      [-311.5, 237.5, 1.18],
      // West bank (right side of photo): open foreground grass verge by concrete pillars; lush canopy set back 10–14m on bank!
      [-331.5, 214.0, 1.26],
      [-330.5, 222.5, 1.34],
      [-329.8, 231.5, 1.28],
      [-331.0, 240.0, 1.22],
      // Triftstraße #3 southern garden deciduous foliage border (sv_triftstrasse_south_house3.png right side)
      [-305.8, 190.5, 0.82],
      [-304.2, 183.0, 0.92],
      // Am Kirchrain #18 garden tree masking upper-right cream facade behind stone-pillar fence (sv_kirchrain_mid_westbound.png)
      [-541.2, 60.8, 0.88],
    ];
    for (const [bx, bz, sc] of triftBridgeCanopy) {
      if (exclusion.isBlocked(bx, bz, FLAG_ROAD)) continue;
      const by = terrain.getTerrainHeight(bx, bz) + groundOffset(pDecid) - 0.08;
      dummy.position.set(bx, by, bz);
      dummy.rotation.set((rand() - 0.5) * 0.05, rand() * Math.PI * 2, (rand() - 0.5) * 0.05);
      dummy.scale.set(sc, sc * (0.96 + rand() * 0.12), sc);
      dummy.updateMatrix();
      decidMatrices.push(dummy.matrix.clone());
    }
  }

  if (treeDecidProto && decidMatrices.length > 0) {
    group.add(createInstancedPropGroup('TreesDeciduous', treeDecidProto, decidMatrices));
  }
  if (treeOrchardProto && orchardMatrices.length > 0) {
    group.add(createInstancedPropGroup('TreesOrchard', treeOrchardProto, orchardMatrices));
  }
  stats.treeInstances = decidMatrices.length + orchardMatrices.length;

  // ---------------------------------------------------------------------------
  // 3. ORTSSCHILD ("Kindenheim") at North & South B271/Hauptstraße entrances
  //    + STREETLAMPS along village streets
  // ---------------------------------------------------------------------------
  let hauptstrasseShowcasePoint: [number, number] | null = null;
  let feldwegShowcasePoint: [number, number] | null = null;

  const ortsschildMatrices: THREE.Matrix4[] = [];
  const lampMatrices: THREE.Matrix4[] = [];
  const placedLamps: [number, number][] = [];

  // Identify main road points for Hauptstraße showcase + Ortsschild entrances
  const mainRoadCandidates: { x: number; z: number; tx: number; tz: number; width: number }[] = [];

  for (const r of sceneData.roads) {
    if (!r.points || r.points.length < 2) continue;
    const pts: [number, number][] = r.points.map(extractRoadXZ);
    const hw = r.highway || '';
    const isMain = hw === 'primary' || hw === 'secondary' || (r.name ?? '').toLowerCase().includes('hauptstra');
    const isVillageStreet = isMain || hw === 'tertiary' || hw === 'residential' || hw === 'living_street';

    if (hw === 'track' && !feldwegShowcasePoint) {
      for (const [px, pz] of pts) {
        const d = Math.hypot(px, pz);
        if (d > 260 && d < 620) {
          feldwegShowcasePoint = [px, pz];
          break;
        }
      }
    }

    let lampDist = 14;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const segD = Math.hypot(x1 - x0, z1 - z0);
      if (segD < 0.5) continue;
      const tx = (x1 - x0) / segD;
      const tz = (z1 - z0) / segD;
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      const width = r.widthM ?? (isMain ? 7.4 : 5.2);

      if (isMain) {
        mainRoadCandidates.push({ x: mx, z: mz, tx, tz, width });
      }

      // Streetlamps inside village bounding box
      if (lampProto && isVillageStreet) {
        const inVillage =
          mx >= villageMinX - 25 &&
          mx <= villageMaxX + 25 &&
          mz >= villageMinZ - 25 &&
          mz <= villageMaxZ + 25;
        if (inVillage) {
          lampDist += segD;
          if (lampDist >= 38 && lampMatrices.length < 180) {
            lampDist = 0;
            const rx = -tz;
            const rz = tx;
            const offset = width * 0.5 + 1.05;
            const lx = mx + rx * offset;
            const lz = mz + rz * offset;
            const tooClose = placedLamps.some(([px, pz]) => Math.hypot(px - lx, pz - lz) < 26);
            if (!tooClose && !exclusion.isBlocked(lx, lz, FLAG_BUILDING) && !isNearSvCamera(lx, lz, 4.2)) {
              const y = terrain.getTerrainHeight(lx, lz) + groundOffset(lampProto) - 0.02;
              // Face lamp arm (+Z in streetlamp.glb) inward toward road (-rx, -rz)
              const yaw = Math.atan2(-rx, -rz);
              dummy.position.set(lx, y, lz);
              dummy.rotation.set(0, yaw, 0);
              dummy.scale.setScalar(1.0);
              dummy.updateMatrix();
              lampMatrices.push(dummy.matrix.clone());
              placedLamps.push([lx, lz]);
            }
          }
        }
      }
    }
  }

  if (mainRoadCandidates.length > 0) {
    // Pick Hauptstraße showcase point closest to village center
    let bestCenterDist = Infinity;
    for (const c of mainRoadCandidates) {
      const d = Math.hypot(c.x, c.z);
      if (d < bestCenterDist) {
        bestCenterDist = d;
        hauptstrasseShowcasePoint = [c.x, c.z];
      }
    }

    // Place Ortsschilder: prefer exact OSM/geodata POIs (type === 'ortsschild'), fallback to L 450 road entries
    if (ortsschildProto) {
      const explicitSigns = (sceneData.pois ?? []).filter(
        (p) => (p.type ?? '').toLowerCase() === 'ortsschild' && typeof p.x === 'number' && typeof p.z === 'number'
      );

      if (explicitSigns.length > 0) {
        for (const sign of explicitSigns) {
          const sx = sign.x!;
          const sz = sign.z!;
          const sy = terrain.getTerrainHeight(sx, sz) + groundOffset(ortsschildProto) - 0.02;
          // sign.rotationRad aligns local +X along the L 450 road direction;
          // rotate by ±PI/2 so the +Z yellow "Kindenheim" front face points perpendicular to L 450 toward incoming traffic!
          const roadRot = typeof sign.rotationRad === 'number' && Number.isFinite(sign.rotationRad) ? sign.rotationRad : 0;
          const isEast = String(sign.id ?? '').includes('east') || sx > 0;
          const yaw = isEast ? roadRot + Math.PI * 0.5 : roadRot - Math.PI * 0.5;
          dummy.position.set(sx, sy, sz);
          dummy.rotation.set(0, yaw, 0);
          dummy.scale.setScalar(1.0);
          dummy.updateMatrix();
          ortsschildMatrices.push(dummy.matrix.clone());
        }
      } else {
        const villageMain = mainRoadCandidates.filter(
          (c) =>
            c.x >= villageMinX - 80 &&
            c.x <= villageMaxX + 80 &&
            c.z >= villageMinZ - 80 &&
            c.z <= villageMaxZ + 80
        );
        if (villageMain.length >= 2) {
          villageMain.sort((a, b) => a.x - b.x);
          const westEntry = villageMain[0];
          const eastEntry = villageMain[villageMain.length - 1];

          const placeSign = (pt: typeof westEntry, enteringEastward: boolean) => {
            let dirX = pt.tx;
            let dirZ = pt.tz;
            if ((enteringEastward && dirX < 0) || (!enteringEastward && dirX > 0)) {
              dirX = -dirX;
              dirZ = -dirZ;
            }
            const rightX = -dirZ;
            const rightZ = dirX;
            const sx = pt.x + rightX * (pt.width * 0.5 + 1.45);
            const sz = pt.z + rightZ * (pt.width * 0.5 + 1.45);
            const sy = terrain.getTerrainHeight(sx, sz) + groundOffset(ortsschildProto) - 0.02;
            const yaw = Math.atan2(-dirX, -dirZ);
            dummy.position.set(sx, sy, sz);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.setScalar(1.0);
            dummy.updateMatrix();
            ortsschildMatrices.push(dummy.matrix.clone());
          };

          placeSign(westEntry, true);
          placeSign(eastEntry, false);
        }
      }
    }
  }

  if (ortsschildProto && ortsschildMatrices.length > 0) {
    group.add(createInstancedPropGroup('Ortsschilder', ortsschildProto, ortsschildMatrices));
    stats.ortsschildCount = ortsschildMatrices.length;
  }
  if (lampProto && lampMatrices.length > 0) {
    group.add(createInstancedPropGroup('Streetlamps', lampProto, lampMatrices));
    stats.lampInstances = lampMatrices.length;
  }

  // ---------------------------------------------------------------------------
  // 4. HAY BALES in meadows / farmland / farmyards & WINE BARRELS near wineries
  // ---------------------------------------------------------------------------
  const hayMatrices: THREE.Matrix4[] = [];
  if (hayProto) {
    const baleZones = sceneData.landuse.filter(
      (lu) =>
        (lu.type === 'meadow' || lu.type === 'farmland' || lu.type === 'farmyard') &&
        lu.points &&
        lu.points.length >= 3
    );

    for (const lu of baleZones) {
      if (hayMatrices.length >= 95) break;
      let cx = 0;
      let cz = 0;
      for (const [x, z] of lu.points) {
        cx += x;
        cz += z;
      }
      cx /= lu.points.length;
      cz /= lu.points.length;

      // Place clusters of 3-5 bales near edges of meadows/fields
      if (Math.hypot(cx, cz) > 880) continue;
      if (rand() > (lu.type === 'meadow' || lu.type === 'farmyard' ? 0.65 : 0.25)) continue;

      const clusterSize = 2 + Math.floor(rand() * 4);
      const baseAngle = rand() * Math.PI * 2;
      for (let k = 0; k < clusterSize; k++) {
        const bx = cx + Math.cos(baseAngle) * k * 2.1 + (rand() - 0.5) * 1.4;
        const bz = cz + Math.sin(baseAngle) * k * 2.1 + (rand() - 0.5) * 1.4;
        if (!pointInPolygon(bx, bz, lu.points)) continue;
        if (exclusion.isBlocked(bx, bz)) continue;
        const by = terrain.getTerrainHeight(bx, bz) + groundOffset(hayProto) - 0.02;
        dummy.position.set(bx, by, bz);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.setScalar(0.95 + rand() * 0.12);
        dummy.updateMatrix();
        hayMatrices.push(dummy.matrix.clone());
      }
    }

    if (hayMatrices.length > 0) {
      group.add(createInstancedPropGroup('HayBales', hayProto, hayMatrices));
      stats.hayBaleInstances = hayMatrices.length;
    }
  }

  const barrelMatrices: THREE.Matrix4[] = [];
  if (barrelProto) {
    for (const [key, info] of landmarks.entries()) {
      // Only place wine barrels near winery/winzerhof landmarks — never near Rathaus or Martinskirche!
      if (!key.includes('weingut') && !key.includes('winzer')) continue;
      const radius = Math.max(info.size.x, info.size.z) * 0.55 + 2.4;
      for (let k = 0; k < 4; k++) {
        const a = info.rotationY + k * 0.38 - 0.6;
        const bx = info.position.x + Math.cos(a) * radius;
        const bz = info.position.z + Math.sin(a) * radius;
        if (exclusion.isBlocked(bx, bz, FLAG_BUILDING | FLAG_ROAD)) continue;
        const by = terrain.getTerrainHeight(bx, bz) + groundOffset(barrelProto) - 0.01;
        dummy.position.set(bx, by, bz);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.setScalar(1.0);
        dummy.updateMatrix();
        barrelMatrices.push(dummy.matrix.clone());
      }
    }
    if (barrelMatrices.length > 0) {
      group.add(createInstancedPropGroup('WineBarrels', barrelProto, barrelMatrices));
      stats.barrelInstances = barrelMatrices.length;
    }
  }

  return {
    group,
    stats,
    vineyardShowcasePoint,
    hauptstrasseShowcasePoint,
    feldwegShowcasePoint,
  };
}
