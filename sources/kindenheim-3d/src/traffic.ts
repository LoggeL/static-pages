/**
 * NPC traffic: cars that drive through Kindenheim and on the country roads, a farm tractor on the field tracks,
 * and parked cars along the village streets and at the ends of yard driveways.
 *
 * - Lane graph: src/trafficNetwork.ts (right-hand traffic on the OSM roads, junction connectors + conflicts).
 * - Rendering: src/trafficRender.ts (two BatchedMeshes, LODs, lamps from the time-of-day contract).
 * - Behaviour: intelligent-driver-model car following on the planned path, braking curves for speed limits and
 *   bends, yielding at junctions (L 450 > K 26 / Raiffeisenstrasse > village streets, right before left between
 *   equals, left turners wait for oncoming traffic), one direction at a time through narrow stretches, overtaking
 *   a slow tractor only on long straight country roads with a clear opposite lane, passing a stopped tractor
 *   slowly after a while. Every car, parked car, the player's tractor and trailer are bodies in src/actors.ts;
 *   cars stop for any body in their path (tractor, cars, pedestrians), and the tractor collides with cars and
 *   pedestrians through BuildingCollider.setDynamicSolidKinds().
 * - Spawning in a ring around the camera, outside the view where possible; despawning out of view.
 */
import * as THREE from 'three';
import { allActors, queryActors, registerActor, unregisterActor, type ActorBody } from './actors';
import type { BuildingCollider } from './collision';
import { getGroundObstacles } from './dataLoader';
import { WEINLESE_CHECKPOINTS } from './game';
import { RECREATION_EXCLUSION_POLYS } from './recreation';
import type { QualityLevel } from './renderQuality';
import { getBridgeDeckSurfaceHeight } from './roads';
import type { TerrainSystem } from './terrain';
import type { TractorController } from './tractor';
import { CAR_FLAG, CarFleetRenderer, type CarType } from './trafficRender';
import { TrafficNetwork, samplePath, type Connector, type Lane, type NarrowSeg, type PathGeom, type TrafficEdge } from './trafficNetwork';
import type { RoadRecord, TimeOfDayPreset } from './types';

// ------------------------------------------------------------------------------------------------ tuning
const MAX_SLOTS = 96;
const SAMPLE_STEP = 1.5;
const IDM_A = 1.6;
const IDM_B = 2.4;
const IDM_T = 1.3;
const MAX_DECEL = 7.5;
const COMFORT_DECEL = 1.9;
const LAT_ACC = 2.3;
const ROAD_DECAL_LIFT = 0.03;
const FARM_SPEED = 25 / 3.6;
const DRIVING_TARGET: Record<QualityLevel, number> = { low: 7, medium: 10, high: 14, ultra: 18 };
const FARM_ENABLED: Record<QualityLevel, boolean> = { low: false, medium: true, high: true, ultra: true };
const RING_MAX: Record<QualityLevel, number> = { low: 230, medium: 290, high: 340, ultra: 400 };
const PARKED_STREET = 46;
/** half width of the widest NPC vehicle body incl. mirrors (van / Pritsche) */
const CAR_MAX_HALF = 1.03;
/** lateral margin of the path scan for cars (scanObstacles) */
const CAR_SCAN_MARGIN = 0.22;
const PARKED_DRIVEWAY = 10;

/** sRGB paint, weight, metallic share */
const PAINTS: [string, number, number][] = [
  ['#4b5056', 14, 0.9], // dark grey
  ['#70757b', 12, 0.8], // mid grey
  ['#15171a', 20, 0.5], // black
  ['#e6e7e8', 16, 0.15], // white
  ['#a8acb1', 14, 1.0], // silver
  ['#1e3354', 7, 0.9], // dark blue
  ['#2f5f8f', 4, 0.6], // blue
  ['#9a1c1c', 6, 0.4], // red
  ['#24422f', 3, 0.8], // dark green
  ['#6a5843', 2, 0.6], // beige brown
  ['#d4a020', 1, 0.0], // yellow
  ['#5a1b20', 1, 0.8], // dark red
];
const TRACTOR_PAINTS: [string, number][] = [
  ['#2f6b2a', 45],
  ['#a3201b', 25],
  ['#cf621b', 15],
  ['#24508f', 15],
];
const DRIVING_TYPES: [string, number][] = [
  ['hatch', 22],
  ['small', 14],
  ['estate', 18],
  ['suv', 16],
  ['van', 10],
  ['sedan_old', 8],
  ['pritsche', 6],
];
const PARKED_TYPES: [string, number][] = [
  ['hatch', 24],
  ['small', 16],
  ['estate', 20],
  ['suv', 16],
  ['van', 8],
  ['sedan_old', 11],
  ['pritsche', 5],
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, items: [T, number][]): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = rng() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function smoothstep01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

// ------------------------------------------------------------------------------------------------ types
interface Seg {
  path: PathGeom;
  lane: Lane | null;
  conn: Connector | null;
}

interface PassPlan {
  startOdo: number;
  endOdo: number;
  shift: number;
  ramp: number;
  targets: Set<string>;
  slow: boolean;
  /** creeping past villagers in the road */
  pedestrians: boolean;
}

interface Car {
  id: number;
  slot: number;
  type: CarType;
  farm: boolean;
  body: ActorBody;
  route: Seg[];
  routeEnds: boolean;
  /** arc length of the rear axle on route[0] */
  s: number;
  odo: number;
  v: number;
  acc: number;
  pass: PassPlan | null;
  /** seconds spent (almost) stopped */
  stopT: number;
  /** time spent held up by a pedestrian in the road (creep forward so they step aside, then creep past) */
  pedWaitT: number;
  /** seconds spent waiting at a junction line */
  waitT: number;
  yieldingAt: Connector | null;
  committed: Connector | null;
  held: { seg: NarrowSeg; lane: Lane; s0: number; s1: number }[];
  baseFlags: number;
  lightThreshold: number;
  // geometry (model metres)
  zf: number;
  zr: number;
  wb: number;
  halfW: number;
  front: number; // front bumper ahead of the rear axle
  overhang: number; // rear bumper behind the rear axle
  // pose
  x: number;
  y: number;
  z: number;
  yaw: number;
  steer: number;
  pitchDyn: number;
  pitchVel: number;
  rollDyn: number;
  rollVel: number;
  spinF: number;
  spinR: number;
  dist: number;
  blocker: string;
  indicator: number;
  passNote: string;
}

interface Parked {
  slot: number;
  body: ActorBody;
  type: CarType;
  x: number;
  z: number;
  heading: number;
  kind: 'street' | 'driveway' | 'showroom';
}

export interface TrafficOptions {
  roads: RoadRecord[];
  terrain: TerrainSystem;
  /** the group from buildRoadNetwork(): userData.getSurfaceLift(x, z) = kerb / sidewalk lift */
  roadGroup: THREE.Object3D;
  collider: BuildingCollider;
  tractor: TractorController;
  maxAnisotropy: number;
}

interface TrafficDeps extends TrafficOptions {
  surfaceLift: (x: number, z: number) => number;
  obstacles: [number, number][][];
  isUrban: (x: number, z: number) => boolean;
}

/** Built-up area of the village: the same box src/roads.ts (isInsideUrbanVillage) gives kerbs and sidewalks. */
function isInsideVillage(x: number, z: number): boolean {
  return x >= -475 && x <= 515 && z >= -265 && z <= 185;
}

interface Sample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** distance ahead of the car front */
  d: number;
  limit: number;
  lat: number;
}

const tmpP = { x: 0, z: 0, tx: 0, tz: 0 };

export class TrafficSystem {
  public readonly group = new THREE.Group();
  public readonly network: TrafficNetwork;
  private readonly renderer: CarFleetRenderer;
  private readonly deps: TrafficDeps;
  private readonly cars: Car[] = [];
  private readonly parked: Parked[] = [];
  private readonly carById = new Map<string, Car>();
  private readonly laneCars = new Map<Lane, Car[]>();
  private readonly rng = mulberry32(0x6b696e64);
  private nextId = 1;
  private quality: QualityLevel = 'high';
  private nightFactor = 0;
  private frozen = false;
  private hidden = false;
  private targetOverride: number | null = null;
  private spawnTimer = 0;
  private initialFill = true;
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private focusX = 0;
  private focusZ = 0;
  private readonly carLanes: Lane[];
  private readonly farmLanes: Lane[];
  private readonly playerTractor: ActorBody;
  private readonly playerTrailer: ActorBody;
  private readonly tractorBox: { cz: number; cx: number };
  private readonly trailerBox: { cz: number; cx: number };
  private readonly scratch: ActorBody[] = [];
  private readonly samples: Sample[] = [];
  private cpuMs = 0;
  public stats = {
    driving: 0,
    farm: 0,
    parked: 0,
    spawned: 0,
    despawned: 0,
    stuckDespawns: 0,
    passes: 0,
    pedestrianPasses: 0,
    cpuMs: 0,
  };

  private constructor(renderer: CarFleetRenderer, deps: TrafficDeps) {
    this.renderer = renderer;
    this.deps = deps;
    this.group.name = 'NpcTrafficSystem';
    this.group.add(renderer.group);
    this.network = new TrafficNetwork(deps.roads, {
      surfaceLift: deps.surfaceLift,
      obstacles: deps.obstacles,
      mapHalfM: deps.terrain.halfSizeM,
      isUrban: deps.isUrban,
    });
    // player bodies
    const t = deps.tractor;
    const tb = this.localBox(t.tractorRoot, 'tractorRoot');
    const rb = this.localBox(t.trailerRoot, 'trailerRoot');
    this.tractorBox = { cz: (tb.min.z + tb.max.z) / 2, cx: (tb.min.x + tb.max.x) / 2 };
    this.trailerBox = { cz: (rb.min.z + rb.max.z) / 2, cx: (rb.min.x + rb.max.x) / 2 };
    this.playerTractor = registerActor({
      id: 'player-tractor',
      kind: 'tractor',
      x: t.x,
      z: t.z,
      heading: t.headingRad,
      halfLength: (tb.max.z - tb.min.z) / 2,
      halfWidth: (tb.max.x - tb.min.x) / 2,
      speed: 0,
      active: true,
    });
    this.playerTrailer = registerActor({
      id: 'player-trailer',
      kind: 'trailer',
      x: t.trailerX,
      z: t.trailerZ,
      heading: t.trailerYawRad,
      halfLength: (rb.max.z - rb.min.z) / 2,
      halfWidth: (rb.max.x - rb.min.x) / 2,
      speed: 0,
      active: t.trailerAttached,
    });
    this.updatePlayerBodies();
    // parked cars narrow the lanes, then the network is finalised
    this.placeParkedCars();
    this.network.finalize();
    this.removeBlockingParked();
    this.carLanes = this.network.lanes.filter((l) => !l.edge.carPruned && l.length > 20);
    this.farmLanes = this.network.lanes.filter((l) => !l.edge.farmPruned && l.length > 20);
    if (this.carLanes.length < 10) throw new Error(`[traffic] only ${this.carLanes.length} car lanes long enough to spawn on`);
    deps.collider.setDynamicSolidKinds(['car', 'pedestrian']);
  }

  public static async create(opts: TrafficOptions): Promise<TrafficSystem> {
    const lift = (opts.roadGroup.userData as { getSurfaceLift?: unknown }).getSurfaceLift;
    if (typeof lift !== 'function') {
      throw new Error('[traffic] roadGroup.userData.getSurfaceLift is missing - pass the group from buildRoadNetwork()');
    }
    if (!opts.collider.landmarkCollidersLoaded) {
      throw new Error('[traffic] create the traffic after collider.loadLandmarkColliders() (parking must avoid estate walls)');
    }
    const renderer = await CarFleetRenderer.load(MAX_SLOTS, opts.maxAnisotropy);
    return new TrafficSystem(renderer, {
      ...opts,
      surfaceLift: lift as (x: number, z: number) => number,
      obstacles: getGroundObstacles(),
      isUrban: isInsideVillage,
    });
  }

  /** Footprint box of an object in its own frame (+Z forward). */
  private localBox(root: THREE.Object3D, label: string): THREE.Box3 {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const box = new THREE.Box3();
    const m = new THREE.Matrix4();
    const b = new THREE.Box3();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      m.multiplyMatrices(inv, mesh.matrixWorld);
      b.copy(mesh.geometry.boundingBox!).applyMatrix4(m);
      box.union(b);
    });
    if (box.isEmpty() || box.max.z - box.min.z < 1 || box.max.x - box.min.x < 0.5) {
      throw new Error(`[traffic] cannot measure the player's ${label} footprint (models not loaded?)`);
    }
    return box;
  }

  private updatePlayerBodies(): void {
    const t = this.deps.tractor;
    const visible = t.group.visible;
    const fx = Math.sin(t.headingRad);
    const fz = Math.cos(t.headingRad);
    // +X model = left = (cos h, -sin h)
    this.playerTractor.x = t.x + fx * this.tractorBox.cz + fz * this.tractorBox.cx;
    this.playerTractor.z = t.z + fz * this.tractorBox.cz - fx * this.tractorBox.cx;
    this.playerTractor.heading = t.headingRad;
    this.playerTractor.speed = t.speedMps;
    this.playerTractor.active = visible;
    const ry = t.trailerYawRad;
    const gx = Math.sin(ry);
    const gz = Math.cos(ry);
    this.playerTrailer.x = t.trailerX + gx * this.trailerBox.cz + gz * this.trailerBox.cx;
    this.playerTrailer.z = t.trailerZ + gz * this.trailerBox.cz - gx * this.trailerBox.cx;
    this.playerTrailer.heading = ry;
    this.playerTrailer.speed = t.speedMps;
    this.playerTrailer.active = visible && t.trailerAttached;
  }

  // ---------------------------------------------------------------------------------------------- heights
  private groundAt(x: number, z: number): number {
    const terrain = this.deps.terrain;
    const bridge = getBridgeDeckSurfaceHeight(x, z, terrain);
    if (bridge !== null) return bridge + 0.02;
    return terrain.getRenderedSurfaceHeight(x, z) + this.deps.surfaceLift(x, z) + ROAD_DECAL_LIFT;
  }

  // ---------------------------------------------------------------------------------------------- colours
  private paintFor(type: CarType, rng: () => number): { color: THREE.Color; metallic: boolean } {
    if (type.name === 'tractor') {
      return { color: new THREE.Color(pickWeighted(rng, TRACTOR_PAINTS)), metallic: false };
    }
    if ((type.name === 'van' || type.name === 'pritsche') && rng() < 0.62) {
      return { color: new THREE.Color('#e8e9ea'), metallic: false };
    }
    let total = 0;
    for (const p of PAINTS) total += p[1];
    let r = rng() * total;
    let pick = PAINTS[0];
    for (const p of PAINTS) {
      r -= p[1];
      if (r <= 0) {
        pick = p;
        break;
      }
    }
    const c = new THREE.Color(pick[0]);
    // small per-car variation in value
    const k = 0.94 + rng() * 0.1;
    c.multiplyScalar(k);
    return { color: c, metallic: rng() < pick[2] };
  }

  private makeFlags(metallic: boolean, rng: () => number): number {
    const plate = Math.floor(rng() * 16) & 15;
    return (metallic ? CAR_FLAG.metallic : 0) | (plate << CAR_FLAG.plateShift);
  }

  // ---------------------------------------------------------------------------------------------- parking
  private placeParkedCars(): void {
    const net = this.network;
    const rng = mulberry32(0x70617263);
    const terrain = this.deps.terrain;
    const collider = this.deps.collider;
    const groundH = (x: number, z: number): number => terrain.getTerrainHeight(x, z);
    const recBoxes = RECREATION_EXCLUSION_POLYS.map((poly) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const [x, z] of poly) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      return [x0 - 15, x1 + 15, z0 - 15, z1 + 15];
    });
    const excluded = (x: number, z: number): boolean => {
      for (const cp of WEINLESE_CHECKPOINTS) if (Math.hypot(x - cp.x, z - cp.z) < cp.radiusM + 15) return true;
      for (const [x0, x1, z0, z1] of recBoxes) if (x > x0 && x < x1 && z > z0 && z < z1) return true;
      const t = this.deps.tractor;
      if (Math.hypot(x - t.x, z - t.z) < 25) return true;
      return false;
    };
    const footprintFree = (x: number, z: number, fx: number, fz: number, type: CarType): boolean => {
      const half = (type.frontZ - type.rearZ) / 2;
      const mid = (type.frontZ + type.rearZ) / 2;
      for (let k = -2; k <= 2; k++) {
        const a = mid + (k / 2) * (half - type.width / 2);
        const px = x + fx * a;
        const pz = z + fz * a;
        if (collider.obstacleTopAt(px, pz, type.width / 2 + 0.15, groundH) !== -Infinity) return false;
        if (net.insideObstacle(px, pz) || net.nearObstacle(px, pz, type.width / 2 + 0.12)) return false;
      }
      // level enough to stand on
      const hf = terrain.getTerrainHeight(x + fx * type.frontZ, z + fz * type.frontZ);
      const hr = terrain.getTerrainHeight(x + fx * type.rearZ, z + fz * type.rearZ);
      const lx = fz;
      const lz = -fx;
      const hl = terrain.getTerrainHeight(x + lx * type.width * 0.5, z + lz * type.width * 0.5);
      const hrt = terrain.getTerrainHeight(x - lx * type.width * 0.5, z - lz * type.width * 0.5);
      if (Math.abs(hf - hr) > 0.7 || Math.abs(hl - hrt) > 0.3) return false;
      if (getBridgeDeckSurfaceHeight(x, z, terrain) !== null) return false;
      return true;
    };
    const junctionNear = (x: number, z: number): boolean => {
      for (const n of net.nodes) {
        const deg = n.edges.length;
        if (deg < 2) continue;
        const r = deg >= 3 ? 16 : 6;
        if (Math.abs(n.x - x) < r && Math.abs(n.z - z) < r && Math.hypot(n.x - x, n.z - z) < r) return true;
      }
      return false;
    };
    interface Spot {
      edge: TrafficEdge;
      i: number;
      side: 1 | -1;
      x: number;
      z: number;
      fx: number;
      fz: number;
      lat: number;
      type: CarType;
    }
    const placed: Spot[] = [];
    // ---- street parking (village streets, the K 26 / Raiffeisenstrasse inside the village, service lanes)
    const candidates: { edge: TrafficEdge; i: number; side: 1 | -1 }[] = [];
    for (const e of net.edges) {
      if (e.cls === 'track' || e.cls === 'highway') continue;
      if (e.cls === 'lane' && !e.urban) continue;
      if (e.length < 30) continue;
      for (let i = 3; i < e.pts.length - 3; i += 2) {
        candidates.push({ edge: e, i, side: 1 });
        candidates.push({ edge: e, i, side: -1 });
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const parkedTypes = PARKED_TYPES.map(([n, w]) => [this.renderer.getType(n), w] as [CarType, number]);
    let street = 0;
    const why: Record<string, number> = {};
    const reject = (r: string): void => {
      why[r] = (why[r] ?? 0) + 1;
    };
    for (const c of candidates) {
      if (street >= PARKED_STREET) break;
      const e = c.edge;
      const pts = e.pts;
      const i = c.i;
      const a = pts[i - 1];
      const b = pts[i + 1];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz);
      if (tl < 1e-3) continue;
      tx /= tl;
      tz /= tl;
      const [px, pz] = pts[i];
      if (!this.deps.isUrban(px, pz) && e.cls !== 'service') {
        reject('outside village');
        continue;
      }
      if (excluded(px, pz)) {
        reject('checkpoint / pitch / tractor');
        continue;
      }
      if (junctionNear(px, pz)) {
        reject('junction');
        continue;
      }
      const type = pickWeighted(rng, parkedTypes);
      const halfW = type.width / 2;
      const halfL = (type.frontZ - type.rearZ) / 2;
      const gapSide = c.side === 1 ? e.gapR : e.gapL;
      const gapOther = c.side === 1 ? e.gapL : e.gapR;
      const half = e.halfs[i];
      // wall-backed or open along the whole car (+1.5 m): never in front of a gate / driveway gap
      const span = Math.ceil((halfL + 1.5) / 2.5);
      let wallBacked = true;
      let open = true;
      let minGap = Infinity;
      let minOther = Infinity;
      for (let k = i - span; k <= i + span; k++) {
        if (k < 0 || k >= pts.length) {
          wallBacked = false;
          open = false;
          break;
        }
        const g = gapSide[k];
        minGap = Math.min(minGap, g);
        minOther = Math.min(minOther, gapOther[k]);
        if (g > half + 3.2) wallBacked = false;
        if (g < 7.5) open = false;
      }
      if (!wallBacked && !open) {
        reject('gate / driveway gap');
        continue;
      }
      // the outer wheels may stand a little on the verge, as village parking does
      const edgeLat = Math.min(half + 0.3, minGap - 0.35);
      const lat = edgeLat - halfW;
      if (lat < 0.9) {
        reject('street too narrow');
        continue;
      }
      // the street must stay passable for the tractor (about 2.5 m wide) and a car
      const remaining = lat - halfW + Math.min(half, minOther - 0.3);
      if (remaining < 3.2) {
        reject('remaining width');
        continue;
      }
      // driving direction of that side: right of a->b drives a->b
      const fx = c.side === 1 ? tx : -tx;
      const fz = c.side === 1 ? tz : -tz;
      // right of a->b is (-tz, tx)
      const x = px + -tz * lat * c.side;
      const z = pz + tx * lat * c.side;
      // spacing: same side >= 6.4 m, nothing opposite within 18 m (no chicanes)
      let clash = false;
      for (const p of placed) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < 6.4) {
          clash = true;
          break;
        }
        if (p.edge === e && p.side !== c.side && d < 18) {
          clash = true;
          break;
        }
      }
      if (clash) {
        reject('spacing');
        continue;
      }
      // reference point = model origin; the car centre sits at (frontZ + rearZ) / 2 ahead of it
      const mid = (type.frontZ + type.rearZ) / 2;
      const ox = x - fx * mid;
      const oz = z - fz * mid;
      if (!footprintFree(ox, oz, fx, fz, type)) {
        reject('footprint (solid / slope / bridge)');
        continue;
      }
      placed.push({ edge: e, i, side: c.side, x, z, fx, fz, lat, type });
      street++;
    }
    // narrow every lane that passes a parked car on its right (also lanes of the neighbouring edges)
    for (const lane of net.lanes) {
      const c = lane.centre;
      let near = false;
      for (const p of placed) {
        const dx = p.x - c[c.length >> 1][0];
        const dz = p.z - c[c.length >> 1][1];
        if (dx * dx + dz * dz < (lane.length / 2 + 15) * (lane.length / 2 + 15)) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      this.network.capLaneOffsets(lane, (i, x, z) => {
        const a = c[Math.max(0, i - 1)];
        const b = c[Math.min(c.length - 1, i + 1)];
        let tx = b[0] - a[0];
        let tz = b[1] - a[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        let cap = Infinity;
        for (const p of placed) {
          const dx = p.x - x;
          const dz = p.z - z;
          if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
          const along = Math.abs(dx * tx + dz * tz);
          const right = -dx * tz + dz * tx; // + = right of the centre line
          if (right < 0.2 || right > 5) continue;
          const halfL = (p.type.frontZ - p.type.rearZ) / 2;
          const inner = right - p.type.width / 2;
          const base = inner - CAR_MAX_HALF - CAR_SCAN_MARGIN - 0.12;
          const lim = along < halfL + 1.5 ? base : base + (along - halfL - 1.5) * 0.45;
          cap = Math.min(cap, lim);
        }
        return cap;
      });
    }
    // ---- driveways: nose-in at the end of dead-end yard / service lanes
    let driveways = 0;
    const dEdges = net.edges.filter((e) => (e.cls === 'service' || e.cls === 'village') && e.carPruned && e.length > 14);
    for (let i = dEdges.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [dEdges[i], dEdges[j]] = [dEdges[j], dEdges[i]];
    }
    for (const e of dEdges) {
      if (driveways >= PARKED_DRIVEWAY) break;
      const endNode = e.a.edges.length === 1 && !e.a.border ? e.a : e.b.edges.length === 1 && !e.b.border ? e.b : null;
      if (!endNode) continue;
      const pts = endNode === e.b ? e.pts : [...e.pts].reverse();
      const type = pickWeighted(rng, parkedTypes);
      // walk back from the end until the car fits
      const n = pts.length;
      const [ex, ez] = pts[n - 1];
      let ok = false;
      for (let back = 3.2; back < 12 && !ok; back += 1.5) {
        let acc = 0;
        let k = n - 1;
        while (k > 0 && acc < back) {
          acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
          k--;
        }
        const [cx, cz] = pts[k];
        let fx = ex - cx;
        let fz = ez - cz;
        const fl = Math.hypot(fx, fz);
        if (fl < 1) continue;
        fx /= fl;
        fz /= fl;
        if (excluded(cx, cz)) break;
        if (placed.some((p) => Math.hypot(p.x - cx, p.z - cz) < 7)) break;
        const mid = (type.frontZ + type.rearZ) / 2;
        const ox = cx - fx * mid;
        const oz = cz - fz * mid;
        if (!footprintFree(ox, oz, fx, fz, type)) continue;
        placed.push({ edge: e, i: k, side: 1, x: cx, z: cz, fx, fz, lat: 0, type });
        ok = true;
        driveways++;
      }
    }
    // allocate render slots + actor bodies
    for (let k = 0; k < placed.length; k++) {
      const p = placed[k];
      const heading = Math.atan2(p.fx, p.fz);
      const mid = (p.type.frontZ + p.type.rearZ) / 2;
      const ox = p.x - p.fx * mid;
      const oz = p.z - p.fz * mid;
      this.addStaticCar(p.type, ox, oz, heading, rng, k < street ? 'street' : 'driveway');
    }
    this.stats.parked = this.parked.length;
    if (street < PARKED_STREET * 0.5) {
      throw new Error(
        `[traffic] only ${street} of ${PARKED_STREET} street parking spots passed the checks (${candidates.length} candidates; rejected: ${JSON.stringify(why)}) - parking rules broken`
      );
    }
  }

  /**
   * After the lanes are final: a parked car that a car lane or junction connector still passes too closely
   * (a car body would touch it) is taken away again, so parked cars never block traffic.
   */
  private removeBlockingParked(): void {
    const CLEAR = CAR_MAX_HALF + CAR_SCAN_MARGIN + 0.06;
    const paths: PathGeom[] = [
      ...this.network.lanes.filter((l) => !l.edge.carPruned || !l.edge.farmPruned),
      ...this.network.connectors.filter((c) => !c.to.edge.carPruned || !c.to.edge.farmPruned),
    ];
    let removed = 0;
    for (const p of [...this.parked]) {
      const b = p.body;
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      let hit = false;
      for (const path of paths) {
        const n = path.xs.length;
        // quick reject on the path's end points + length
        const mx = (path.xs[0] + path.xs[n - 1]) / 2;
        const mz = (path.zs[0] + path.zs[n - 1]) / 2;
        if (Math.hypot(mx - b.x, mz - b.z) > path.length / 2 + 12) continue;
        for (let i = 0; i < n - 1 && !hit; i++) {
          // sample every ~0.5 m
          const sx = path.xs[i + 1] - path.xs[i];
          const sz = path.zs[i + 1] - path.zs[i];
          const k = Math.max(1, Math.ceil(Math.hypot(sx, sz) / 0.5));
          for (let j = 0; j <= k; j++) {
            const x = path.xs[i] + (sx * j) / k - b.x;
            const z = path.zs[i] + (sz * j) / k - b.z;
            const u = Math.abs(x * fx + z * fz) - b.halfLength;
            const v = Math.abs(-x * fz + z * fx) - b.halfWidth;
            const d = Math.hypot(Math.max(0, u), Math.max(0, v));
            if (d < CLEAR) {
              hit = true;
              break;
            }
          }
        }
        if (hit) break;
      }
      if (!hit) continue;
      this.renderer.free(p.slot);
      unregisterActor(b.id);
      this.parked.splice(this.parked.indexOf(p), 1);
      removed++;
    }
    this.stats.parked = this.parked.length;
    this.parkedRemoved = removed;
    if (this.parked.length < PARKED_STREET * 0.4) {
      throw new Error(`[traffic] ${removed} parked cars stood in a lane, only ${this.parked.length} left - parking / lane geometry broken`);
    }
  }

  private parkedRemoved = 0;

  private addStaticCar(type: CarType, ox: number, oz: number, heading: number, rng: () => number, kind: Parked['kind']): Parked {
    const paint = this.paintFor(type, rng);
    const slot = this.renderer.allocate(type, paint.color, this.makeFlags(paint.metallic, rng), true);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const pose = this.renderer.pose(slot);
    this.poseStatic(type, ox, oz, heading, pose);
    const mid = (type.frontZ + type.rearZ) / 2;
    const body = registerActor({
      id: `npc-parked-${this.nextId++}`,
      kind: 'car',
      x: ox + fx * mid,
      z: oz + fz * mid,
      heading,
      halfLength: (type.frontZ - type.rearZ) / 2,
      halfWidth: type.width / 2 + 0.04,
      speed: 0,
      active: true,
    });
    const p: Parked = { slot, body, type, x: ox, z: oz, heading, kind };
    this.parked.push(p);
    return p;
  }

  private poseStatic(type: CarType, ox: number, oz: number, heading: number, pose: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; steer: number; spinF: number; spinR: number }): void {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const lx = fz;
    const lz = -fx;
    const w = type.wheels;
    const h = w.map((wh) => this.groundAt(ox + fx * wh.z + lx * wh.x, oz + fz * wh.z + lz * wh.x));
    const hf = (h[0] + h[1]) / 2;
    const hr = (h[2] + h[3]) / 2;
    const zf = w[0].z;
    const zr = w[2].z;
    pose.x = ox;
    pose.z = oz;
    pose.y = hr + ((hf - hr) * -zr) / (zf - zr);
    pose.yaw = heading;
    pose.pitch = Math.atan2(hf - hr, zf - zr);
    pose.roll = Math.atan2((h[0] + h[2]) / 2 - (h[1] + h[3]) / 2, Math.abs(w[0].x - w[1].x));
    pose.steer = 0;
    pose.spinF = 0;
    pose.spinR = 0;
  }

  // ---------------------------------------------------------------------------------------------- contracts
  public setQuality(level: QualityLevel): void {
    this.quality = level;
    this.renderer.setQuality(level);
    if (!FARM_ENABLED[level]) {
      for (const c of [...this.cars]) if (c.farm) this.despawn(c, false);
    }
  }

  public setTimeOfDay(_preset: TimeOfDayPreset, nightFactor: number): void {
    this.nightFactor = nightFactor;
    this.renderer.setNightFactor(nightFactor);
    // parked cars: lamps off
  }

  /** Benchmark clean capture: hides every NPC car (bodies stay solid). */
  public setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.group.visible = !hidden;
  }

  /** True while a moving car is close enough to cast a near shadow (the near cascade must re-render). */
  public get hasMovingNearCasters(): boolean {
    if (this.hidden || !this.renderer.shadowsEnabled) return false;
    for (const c of this.cars) if (c.v > 0.05 && c.dist < 80) return true;
    return false;
  }

  private get drivingTarget(): number {
    return this.targetOverride ?? DRIVING_TARGET[this.quality];
  }

  // ---------------------------------------------------------------------------------------------- route
  private segOf(lane: Lane): Seg {
    return { path: lane, lane, conn: null };
  }

  private extendRoute(car: Car): void {
    let total = -car.s;
    for (const seg of car.route) total += seg.path.length;
    let guard = 0;
    while (total < 170 && !car.routeEnds) {
      if (++guard > 64) throw new Error(`[traffic] route extension runaway for car ${car.id}`);
      const last = car.route[car.route.length - 1];
      if (last.conn) {
        car.route.push(this.segOf(last.conn.to));
        total += last.conn.to.length;
        continue;
      }
      const lane = last.lane!;
      const usable = lane.next.filter((c) => (car.farm ? !c.to.edge.farmPruned : !c.to.edge.carPruned));
      if (usable.length === 0) {
        if (lane.to.border) {
          car.routeEnds = true;
          return;
        }
        throw new Error(`[traffic] lane ${lane.id} (${lane.edge.name}) has no way on for ${car.farm ? 'farm' : 'car'} traffic`);
      }
      const gentle = usable.filter((c) => !c.sharp);
      const opts = gentle.length ? gentle : usable;
      const weights: [Connector, number][] = opts.map((c) => {
        let w = c.turn === 'straight' ? 3 : c.turn === 'right' ? 1.5 : 1.2;
        const cls = c.to.edge.cls;
        if (car.farm) {
          if (cls === 'track') w *= 3;
        } else if (cls === 'service') w *= 0.35;
        // keep traffic around the camera
        const dNow = Math.hypot(lane.to.x - this.focusX, lane.to.z - this.focusZ);
        const dNext = Math.hypot(c.to.to.x - this.focusX, c.to.to.z - this.focusZ);
        if (dNow > 120 && dNext < dNow) w *= 2.2;
        return [c, w];
      });
      const c = pickWeighted(this.rng, weights);
      car.route.push({ path: c, lane: null, conn: c });
      total += c.length;
    }
  }

  /** Point on the planned route `d` metres from the start of route[0] (beyond the end: extrapolated). */
  private routePoint(car: Car, d: number, out: { x: number; z: number; tx: number; tz: number }): { seg: Seg; local: number } {
    let rem = d;
    for (const seg of car.route) {
      if (rem <= seg.path.length) {
        samplePath(seg.path, rem, out);
        return { seg, local: rem };
      }
      rem -= seg.path.length;
    }
    const last = car.route[car.route.length - 1];
    samplePath(last.path, last.path.length, out);
    const extra = rem - last.path.length;
    out.x += out.tx * extra;
    out.z += out.tz * extra;
    return { seg: last, local: last.path.length };
  }

  private limitAt(car: Car, seg: Seg, local: number): number {
    let lim: number;
    if (seg.conn) lim = seg.conn.limit;
    else {
      const lane = seg.lane!;
      const i = samplePath(lane, local, tmpP);
      lim = lane.limit[i];
    }
    return car.farm ? Math.min(lim, FARM_SPEED) : lim;
  }

  /** Lateral shift (m, + = right) of the planned path at odometer `o` (overtaking / passing). */
  private latAt(car: Car, o: number): number {
    const p = car.pass;
    if (!p) return 0;
    if (o <= p.startOdo) return 0;
    if (o < p.endOdo - p.ramp) return p.shift * smoothstep01((o - p.startOdo) / p.ramp);
    return p.shift * (1 - smoothstep01((o - (p.endOdo - p.ramp)) / p.ramp));
  }

  // ---------------------------------------------------------------------------------------------- spawn
  private spawnCar(lane: Lane, s: number, type: CarType, farm: boolean, speed: number): Car | null {
    const rng = this.rng;
    const paint = this.paintFor(type, rng);
    const baseFlags = this.makeFlags(paint.metallic, rng) | (type.name === 'sedan_old' || farm ? 0 : CAR_FLAG.running);
    const zf = type.wheels[0].z;
    const zr = type.wheels[2].z;
    const car: Car = {
      id: this.nextId++,
      slot: -1,
      type,
      farm,
      body: null as unknown as ActorBody,
      route: [this.segOf(lane)],
      routeEnds: false,
      s,
      odo: 0,
      v: speed,
      acc: 0,
      pass: null,
      stopT: 0,
      pedWaitT: 0,
      waitT: 0,
      yieldingAt: null,
      committed: null,
      held: [],
      baseFlags,
      lightThreshold: 0.3 + rng() * 0.25,
      zf,
      zr,
      wb: zf - zr,
      halfW: type.width / 2 + 0.05,
      front: type.frontZ - zr,
      overhang: zr - type.rearZ,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      steer: 0,
      pitchDyn: 0,
      pitchVel: 0,
      rollDyn: 0,
      rollVel: 0,
      spinF: rng() * 6,
      spinR: rng() * 6,
      dist: 0,
      blocker: '',
      indicator: 0,
      passNote: '',
    };
    this.extendRoute(car);
    // narrow stretches the car stands in must be free for its direction
    for (const nw of lane.narrow) {
      if (s - car.overhang < nw.s1 && s + car.front > nw.s0 - 3) {
        if (nw.seg.owner !== 0 && nw.seg.owner !== lane.dir) return null;
      }
    }
    for (const nw of lane.narrow) {
      if (s - car.overhang < nw.s1 && s + car.front > nw.s0 - 3) this.acquire(car, nw, lane);
    }
    car.slot = this.renderer.allocate(type, paint.color, baseFlags, false);
    car.body = registerActor({
      id: `npc-car-${car.id}`,
      kind: 'car',
      x: 0,
      z: 0,
      heading: 0,
      halfLength: (type.frontZ - type.rearZ) / 2,
      halfWidth: car.halfW,
      speed,
      active: true,
    });
    this.cars.push(car);
    this.carById.set(car.body.id, car);
    this.updatePose(car, 0, true);
    this.stats.spawned++;
    return car;
  }

  private despawn(car: Car, stuck: boolean): void {
    for (const h of car.held) this.releaseSeg(car, h.seg);
    car.held.length = 0;
    this.renderer.free(car.slot);
    unregisterActor(car.body.id);
    this.carById.delete(car.body.id);
    const i = this.cars.indexOf(car);
    if (i < 0) throw new Error(`[traffic] despawn: car ${car.id} not in the list`);
    this.cars.splice(i, 1);
    this.stats.despawned++;
    if (stuck) this.stats.stuckDespawns++;
  }

  private readonly viewSphere = new THREE.Sphere();

  private inView(x: number, y: number, z: number, r: number): boolean {
    this.viewSphere.center.set(x, y, z);
    this.viewSphere.radius = r;
    return this.frustum.intersectsSphere(this.viewSphere);
  }

  private trySpawn(farm: boolean): boolean {
    const lanes = farm ? this.farmLanes : this.carLanes;
    const rMax = RING_MAX[this.quality];
    const rMin = this.initialFill ? 30 : 90;
    for (let attempt = 0; attempt < 14; attempt++) {
      let lane: Lane;
      if (farm) {
        const tracks = lanes.filter((l) => l.edge.cls === 'track');
        const pool = tracks.length && this.rng() < 0.8 ? tracks : lanes;
        lane = pool[Math.floor(this.rng() * pool.length)];
      } else {
        lane = lanes[Math.floor(this.rng() * lanes.length)];
      }
      if (lane.length < 24) continue;
      const s = 10 + this.rng() * (lane.length - 20);
      samplePath(lane, s, tmpP);
      const d = Math.hypot(tmpP.x - this.focusX, tmpP.z - this.focusZ);
      if (d > rMax || d < rMin) continue;
      const y = this.groundAt(tmpP.x, tmpP.z);
      if (!this.initialFill && d < rMax * 0.8 && this.inView(tmpP.x, y + 1, tmpP.z, 3)) continue;
      // free road around the spot
      const near = queryActors(tmpP.x, tmpP.z, 22, this.scratch);
      let blocked = false;
      for (const b of near) {
        const dd = Math.hypot(b.x - tmpP.x, b.z - tmpP.z);
        if (b.kind === 'tractor' || b.kind === 'trailer') {
          if (dd < 40) blocked = true;
        } else if (b.kind === 'pedestrian') {
          if (dd < 6) blocked = true;
        } else {
          const lat = Math.abs(-(b.x - tmpP.x) * tmpP.tz + (b.z - tmpP.z) * tmpP.tx);
          if (this.carById.has(b.id) ? dd < 20 : lat < 2.3 && dd < 8) blocked = true;
        }
        if (blocked) break;
      }
      if (blocked) continue;
      const typeName = farm ? 'tractor' : pickWeighted(this.rng, DRIVING_TYPES);
      const type = this.renderer.getType(typeName);
      const v0 = Math.min(lane.limit[samplePath(lane, s, tmpP)], farm ? FARM_SPEED : 99) * (0.6 + this.rng() * 0.3);
      if (this.spawnCar(lane, s, type, farm, v0)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------- narrow
  private acquire(car: Car, nw: { s0: number; s1: number; seg: NarrowSeg }, lane: Lane): boolean {
    if (car.held.some((h) => h.seg === nw.seg && h.lane === lane)) return true;
    const seg = nw.seg;
    if (seg.owner !== 0 && seg.owner !== lane.dir) return false;
    seg.owner = lane.dir;
    seg.holders.add(car.id);
    car.held.push({ seg, lane, s0: nw.s0, s1: nw.s1 });
    return true;
  }

  private releaseSeg(car: Car, seg: NarrowSeg): void {
    seg.holders.delete(car.id);
    if (seg.holders.size === 0) seg.owner = 0;
  }

  // ---------------------------------------------------------------------------------------------- yielding
  /** Does connector `o` have priority over `c` (same junction)? */
  private hasPriority(o: Connector, c: Connector): boolean {
    const ra = c.from.edge.rank;
    const rb = o.from.edge.rank;
    if (ra !== rb) return rb > ra;
    const cross = c.dirX * o.dirZ - c.dirZ * o.dirX;
    const dot = c.dirX * o.dirX + c.dirZ * o.dirZ;
    if (dot < -0.6) return c.turn === 'left' && o.turn !== 'left';
    // cross < 0: o comes from my right (+X east, +Z south)
    return cross < -0.25;
  }

  private mustYield(car: Car, c: Connector, myDist: number): string | null {
    const myEta = myDist / Math.max(car.v, 2.5);
    for (const o of this.cars) {
      if (o === car) continue;
      const r0 = o.route[0];
      if (r0.conn && c.conflicts.has(r0.conn)) {
        // already in the junction: wait until it has (nearly) cleared it
        if (o.s - o.overhang < r0.conn.length * 0.85 + 1) return `in junction ${o.body.id}`;
        continue;
      }
      const r1 = o.route[1];
      if (!r0.lane || !r1 || !r1.conn || !c.conflicts.has(r1.conn)) continue;
      const dO = r0.lane.length - (o.s + o.front);
      if (dO > 55) continue;
      if (o.v < 0.5 && dO > 7) continue;
      if (!this.hasPriority(r1.conn, c)) continue;
      const etaO = dO / Math.max(o.v, 0.5);
      if (etaO > myEta + 4.5 && dO > 7) continue;
      // a priority car that has been standing at its line for a while, held up by something other than me
      // (a narrow stretch, a queue, a third car), does not stop me
      if (o.yieldingAt === r1.conn && o.v < 0.3 && o.waitT > 2.5 && !o.blocker.includes(car.body.id)) continue;
      // deadlock breaker between cars that all wait for each other
      if (o.yieldingAt === r1.conn && o.v < 0.3 && car.waitT > 3.5 && car.waitT > o.waitT + 0.01) continue;
      return `priority ${o.body.id}`;
    }
    // the player's tractor / trailer or a pedestrian on the junction
    const near = queryActors(c.node.x, c.node.z, 26, this.scratch);
    const lift = this.deps.surfaceLift;
    for (const b of near) {
      if (b.kind === 'car') continue;
      if (b.kind === 'pedestrian' && lift(b.x, b.z) > 0.05) continue; // on the sidewalk
      // walking pedestrians near the turn path / the tractor: wait; a standing pedestrian only when on it
      const standing = b.kind === 'pedestrian' && Math.abs(b.speed) < 0.25;
      // villagers who stay on the junction (held up by this very car, a jam of walkers): after a while leave
      // them to the path scan, which creeps up so they step aside
      if (b.kind === 'pedestrian' && car.waitT > 4 && (standing || car.waitT > 8)) continue;
      const rb = Math.hypot(b.halfLength, b.halfWidth) + (standing ? car.halfW + 0.3 : 1.2);
      for (let i = 0; i < c.xs.length; i++) {
        const dx = c.xs[i] - b.x;
        const dz = c.zs[i] - b.z;
        if (dx * dx + dz * dz < rb * rb) return `body ${b.id}`;
      }
    }
    return null;
  }

  /** The target lane begins with a stopped queue: do not block the junction. */
  private exitBlocked(car: Car, c: Connector): boolean {
    const list = this.laneCars.get(c.to);
    if (!list) return false;
    for (const o of list) {
      if (o.s - o.overhang < car.front + car.overhang + 2 && o.v < 2) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------- simulate
  private buildSamples(car: Car): number {
    const len = Math.min(75, Math.max(20, (car.v * car.v) / (2 * COMFORT_DECEL) + car.v * 2 + 14));
    const n = Math.ceil(len / SAMPLE_STEP) + 1;
    while (this.samples.length < n) this.samples.push({ x: 0, z: 0, tx: 0, tz: 0, d: 0, limit: 0, lat: 0 });
    const base = car.s + car.front;
    for (let i = 0; i < n; i++) {
      const sm = this.samples[i];
      const d = i * SAMPLE_STEP;
      const r = this.routePoint(car, base + d, tmpP);
      const lat = this.latAt(car, car.odo + car.front + d);
      sm.tx = tmpP.tx;
      sm.tz = tmpP.tz;
      sm.x = tmpP.x - tmpP.tz * lat;
      sm.z = tmpP.z + tmpP.tx * lat;
      sm.d = d;
      sm.lat = lat;
      sm.limit = this.limitAt(car, r.seg, r.local);
    }
    // bend speed from the heading change over 3 samples
    for (let i = 0; i < n; i++) {
      const a = this.samples[Math.max(0, i - 2)];
      const b = this.samples[Math.min(n - 1, i + 2)];
      const ang = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
      const span = b.d - a.d;
      if (span > 0 && ang > 0.01) {
        const k = ang / span;
        this.samples[i].limit = Math.min(this.samples[i].limit, Math.sqrt(LAT_ACC / k));
      }
    }
    return n;
  }

  /** Nearest body in the swept path: gap (m from my front), its speed along my path, id. */
  private scanObstacles(car: Car, n: number, ignore: Set<string> | null): { gap: number; speed: number; id: string; kind: string } {
    const res = { gap: Infinity, speed: 0, id: '', kind: '' };
    const reach = this.samples[n - 1].d + car.front + 6;
    const near = queryActors(car.x, car.z, reach, this.scratch, car.body.id);
    const lift = this.deps.surfaceLift;
    for (const b of near) {
      if (ignore && ignore.has(b.id)) continue;
      if (b.kind === 'pedestrian' && lift(b.x, b.z) > 0.05) continue; // on the sidewalk
      const r = Math.hypot(b.halfLength, b.halfWidth);
      const bfx = Math.sin(b.heading);
      const bfz = Math.cos(b.heading);
      const margin = b.kind === 'pedestrian' ? 0.3 : CAR_SCAN_MARGIN;
      const lim = r + car.halfW + margin + SAMPLE_STEP;
      for (let i = 0; i < n; i++) {
        const sm = this.samples[i];
        if (sm.d > res.gap) break;
        const dx = b.x - sm.x;
        const dz = b.z - sm.z;
        if (dx * dx + dz * dz > lim * lim) continue;
        const u = dx * sm.tx + dz * sm.tz;
        const v = -dx * sm.tz + dz * sm.tx;
        const cos = bfx * sm.tx + bfz * sm.tz;
        const sin = bfx * sm.tz - bfz * sm.tx;
        const extU = Math.abs(b.halfLength * cos) + Math.abs(b.halfWidth * sin);
        const extV = Math.abs(b.halfLength * sin) + Math.abs(b.halfWidth * cos);
        if (Math.abs(u) > extU + SAMPLE_STEP * 0.5 + 0.05) continue;
        if (Math.abs(v) >= car.halfW + extV + margin) continue;
        // a standing car / tractor that is not in my direction of travel (oncoming, crossing): the projected
        // extent is conservative, check the exact swept footprint before treating it as a block
        if (b.kind !== 'pedestrian' && Math.abs(b.speed) < 0.4 && cos < 0.5 && this.sweepClear(car, b, n, 0.12)) break;
        // someone standing at the roadside (waiting to cross, chatting) only stops me when really in the way
        if (b.kind === 'pedestrian' && Math.abs(b.speed) < 0.25 && this.sweepClear(car, b, n, 0.35)) break;
        const gap = Math.max(0, sm.d + u - extU);
        if (gap < res.gap) {
          res.gap = gap;
          res.speed = Math.max(0, b.speed * cos);
          res.id = b.id;
          res.kind = b.kind;
        }
        break;
      }
    }
    return res;
  }

  private readonly sweepBody: ActorBody = { id: 'sweep', kind: 'car', x: 0, z: 0, heading: 0, halfLength: 1, halfWidth: 1, speed: 0, active: false };

  /** True when my footprint moved along the planned samples keeps 12 cm away from body b. */
  private sweepClear(car: Car, b: ActorBody, n: number, clearance: number): boolean {
    const t = this.sweepBody;
    t.halfLength = car.body.halfLength;
    t.halfWidth = car.halfW;
    const back = car.body.halfLength;
    for (let i = 0; i < n; i++) {
      const sm = this.samples[i];
      t.x = sm.x - sm.tx * back;
      t.z = sm.z - sm.tz * back;
      t.heading = Math.atan2(sm.tx, sm.tz);
      if (TrafficSystem.obbOverlap(t, b, -clearance)) return false;
    }
    return true;
  }

  private idm(v: number, vDes: number, gap: number, vLead: number, s0: number): number {
    const sStar = s0 + Math.max(0, v * IDM_T + (v * (v - vLead)) / (2 * Math.sqrt(IDM_A * IDM_B)));
    const g = Math.max(gap, 0.05);
    return IDM_A * (1 - Math.pow(v / Math.max(vDes, 0.1), 4) - (sStar / g) * (sStar / g));
  }

  private stepCar(car: Car, dt: number): void {
    const n = this.buildSamples(car);
    // desired speed: braking curves towards every upcoming limit
    let vDes = this.samples[0].limit;
    for (let i = 1; i < n; i++) {
      const sm = this.samples[i];
      const allowed = Math.sqrt(sm.limit * sm.limit + 2 * COMFORT_DECEL * sm.d);
      if (allowed < vDes) vDes = allowed;
    }
    if (car.pass && !car.pass.slow) vDes = Math.min(vDes, (car.pass.pedestrians ? 8 : 15) / 3.6);
    let acc = vDes > 0.1 ? IDM_A * (1 - Math.pow(car.v / vDes, 4)) : -MAX_DECEL;
    car.blocker = '';
    // ---- virtual stops: junction yielding, narrow stretches, end of route
    let stopDist = Infinity;
    let stopWhy = '';
    let distAcc = -car.s - car.front; // distance from my front to the start of route[k]
    let decidedJunction = false;
    let failedNarrow = false;
    car.yieldingAt = null;
    // narrow stretches ahead: a chain of stretches with less than 20 m between them (also across a junction)
    // is claimed all at once, so a car never waits inside one stretch for the next
    let narrowStop = Infinity;
    let narrowWhy = '';
    {
      const items: { startD: number; endD: number; nw: Lane['narrow'][number]; lane: Lane; k: number }[] = [];
      let dAcc = -car.s - car.front;
      for (let k = 0; k < car.route.length && dAcc < 260; k++) {
        const sg = car.route[k];
        if (sg.lane) {
          for (const nw of sg.lane.narrow) {
            const startD = dAcc + nw.s0;
            const endD = dAcc + nw.s1;
            if (endD < -car.front - car.overhang) continue;
            items.push({ startD, endD, nw, lane: sg.lane, k });
          }
        }
        dAcc += sg.path.length;
      }
      const reach = Math.max(28, (car.v * car.v) / (2 * COMFORT_DECEL) + 14);
      const isHeld = (it: (typeof items)[number]): boolean => car.held.some((h) => h.seg === it.nw.seg && h.lane === it.lane);
      const first = items.findIndex((it) => !isHeld(it));
      if (first >= 0 && items[first].startD <= reach) {
        // chain: back to the held stretch it continues, forward while the gaps are short
        let last = first;
        while (last + 1 < items.length && items[last + 1].startD - items[last].endD < 20) last++;
        const chain = items.slice(first, last + 1).filter((it) => !isHeld(it));
        const ok = chain.every((it) => it.nw.seg.owner === 0 || it.nw.seg.owner === it.lane.dir);
        if (ok) {
          for (const it of chain) this.acquire(car, it.nw, it.lane);
        } else {
          failedNarrow = true;
          const it = items[first];
          let d = it.startD - 1.0;
          const before = it.k > 0 ? car.route[it.k - 1].conn : null;
          if (it.nw.s0 < 15 && before && car.committed !== before) {
            let segStart = -car.s - car.front;
            for (let k = 0; k < it.k - 1; k++) segStart += car.route[k].path.length;
            d = segStart - 0.3;
          }
          const blocked = chain.find((c) => !(c.nw.seg.owner === 0 || c.nw.seg.owner === c.lane.dir));
          narrowStop = d;
          narrowWhy = `narrow ${blocked ? blocked.nw.seg.id : '?'}`;
        }
      }
    }
    if (narrowStop < stopDist) {
      stopDist = narrowStop;
      stopWhy = narrowWhy;
    }
    for (let k = 0; k < car.route.length; k++) {
      const seg = car.route[k];
      const segStart = distAcc;
      distAcc += seg.path.length;
      if (segStart > 80) break;
      if (seg.conn && !decidedJunction && car.committed !== seg.conn && segStart >= -0.5) {
        decidedJunction = true;
        const brakeD = (car.v * car.v) / (2 * 4.5) + 1.0;
        let why: string | null = null;
        if (segStart < 60) {
          why = this.mustYield(car, seg.conn, Math.max(0, segStart));
          if (!why && this.exitBlocked(car, seg.conn)) why = 'exit blocked';
          // two junctions joined by a lane shorter than a car: decide both at once (never stop in between)
          const mid = car.route[k + 1];
          const next = car.route[k + 2];
          if (!why && mid && mid.lane && mid.lane.length < 14 && next && next.conn) {
            const d2 = segStart + seg.path.length + mid.lane.length;
            why = this.mustYield(car, next.conn, Math.max(0, d2));
            if (!why && this.exitBlocked(car, next.conn)) why = 'exit blocked';
            if (why) why = `next junction: ${why}`;
          }
          if (!why && narrowStop <= segStart + 0.5) why = narrowWhy;
        }
        if (why) {
          if (segStart < stopDist) {
            stopDist = segStart - 0.3;
            stopWhy = `junction: ${why}`;
          }
          car.yieldingAt = seg.conn;
        } else if (segStart <= brakeD) {
          car.committed = seg.conn;
        }
      }
    }
    // no hold-and-wait: while blocked by a narrow stretch, give back the ones not entered yet
    if (failedNarrow) {
      const brake = (car.v * car.v) / (2 * 4.5) + 2;
      for (let i = car.held.length - 1; i >= 0; i--) {
        const h = car.held[i];
        const idx = car.route.findIndex((sg) => sg.lane === h.lane);
        if (idx < 0) continue;
        let d = h.s0 - car.s - car.front;
        for (let k = 0; k < idx; k++) d += car.route[k].path.length;
        const before = idx > 0 ? car.route[idx - 1].conn : null;
        // keep what the car can no longer stop in front of (or has committed to through the junction)
        const committed = before !== null && car.committed === before && h.s0 < 15;
        if (d > brake && !committed) {
          this.releaseSeg(car, h.seg);
          car.held.splice(i, 1);
        }
      }
    }
    if (stopDist < Infinity) {
      const a = this.idm(car.v, vDes, Math.max(0.05, stopDist), 0, 0.5);
      if (a < acc) {
        acc = a;
        car.blocker = stopWhy;
      }
      if (stopDist < 0.3 && car.v < 1.5) {
        acc = Math.min(acc, -MAX_DECEL);
      }
    }
    // ---- bodies in the path
    const ob = this.scanObstacles(car, n, null);
    if (ob.gap === Infinity) car.pedWaitT = 0;
    if (ob.gap < Infinity) {
      const s0 = ob.kind === 'tractor' || ob.kind === 'trailer' ? 5.0 : ob.kind === 'pedestrian' ? 3.0 : 2.4;
      let a = this.idm(car.v, vDes, ob.gap, ob.speed, s0);
      if (ob.kind === 'pedestrian') {
        // a villager who stays in the road: a waiting car is an obstacle to them, a creeping one makes them step
        // aside (pedestrians.ts vehicleThreat) - so after a moment roll on at walking pace up to ~1 m
        if (car.v < 0.8) car.pedWaitT += dt;
        if (car.pedWaitT > 2.5) a = ob.gap > 1.1 ? Math.min(0.8, (0.55 - car.v) * 2) : -MAX_DECEL * 2;
      } else car.pedWaitT = 0;
      if (a < acc) {
        acc = a;
        car.blocker = ob.id;
      }
      if (ob.gap < 0.6) acc = Math.min(acc, -MAX_DECEL * 2);
      // overtaking / passing the tractor
      if (!car.pass && (ob.kind === 'tractor' || ob.kind === 'trailer' || this.isFarmBody(ob.id)) && ob.gap < 26) {
        this.considerPass(car, ob.speed, vDes, false);
      }
      // a pedestrian who stays in the road (no room to step aside, walking around the waiting car):
      // after a few seconds at a standstill creep past at walking distance, like a driver would
      if (!car.pass && ob.kind === 'pedestrian' && ob.gap < 12 && car.pedWaitT >= 6) {
        this.considerPass(car, 0, vDes, true);
      }
    }
    acc = Math.max(-MAX_DECEL * 2, Math.min(IDM_A, acc));
    car.acc = acc;
    let v = car.v + acc * dt;
    if (v < 0) v = 0;
    if (ob.gap < 0.25) v = 0;
    const ds = ((car.v + v) / 2) * dt;
    car.v = v;
    car.s += ds;
    car.odo += ds;
    if (v < 0.2) car.stopT += dt;
    else car.stopT = 0;
    // waiting time at a junction line (whatever stops the car meanwhile) for the deadlock breaker
    if (car.yieldingAt && v < 0.3) car.waitT += dt;
    else if (!car.yieldingAt) car.waitT = 0;
    if (car.pass && car.odo >= car.pass.endOdo) car.pass = null;
    // advance along the route
    while (car.route.length > 1 && car.s > car.route[0].path.length) {
      car.s -= car.route[0].path.length;
      const left = car.route.shift()!;
      if (left.conn && car.committed === left.conn) car.committed = null;
    }
    this.extendRoute(car);
    // release narrow stretches that are behind
    for (let i = car.held.length - 1; i >= 0; i--) {
      const h = car.held[i];
      const idx = car.route.findIndex((sg) => sg.lane === h.lane);
      const passed = idx < 0 || (idx === 0 && car.s - car.overhang > h.s1);
      if (passed) {
        this.releaseSeg(car, h.seg);
        car.held.splice(i, 1);
      }
    }
    this.updatePose(car, dt, false);
  }

  private isFarmBody(id: string): boolean {
    const c = this.carById.get(id);
    return !!c && c.farm;
  }

  /** Tractor ahead: overtake on a long straight country road, or creep past it when it has stopped. */
  private passNote(car: Car, why: string): void {
    car.passNote = why;
  }

  private considerPass(car: Car, obSpeed: number, vDes: number, pedestrians: boolean): void {
    const lane = car.route[0].lane;
    if (!lane) return this.passNote(car, 'no lane');
    if (!pedestrians && car.farm) return this.passNote(car, 'farm');
    if (!pedestrians && lane.edge.cls === 'track') return this.passNote(car, 'track');
    const stopped = obSpeed < 0.3;
    if (pedestrians) {
      if (!stopped) throw new Error(`considerPass: pedestrian pass for ${car.body.id} must use the creep-pass mode (obSpeed ${obSpeed})`);
    } else if (stopped) {
      if (car.stopT < 4) return this.passNote(car, 'waiting');
    } else {
      if (obSpeed > vDes * 0.7) return this.passNote(car, 'not slow');
      if (lane.edge.urban || !(lane.edge.cls === 'highway' || lane.edge.cls === 'lane')) return this.passNote(car, 'village road');
      if (this.deps.isUrban(car.x, car.z)) return this.passNote(car, 'in village');
    }
    // bodies to pass: tractor + trailer (or the farm vehicle) within 30 m ahead
    const n = this.buildSamples(car);
    const targets = new Set<string>();
    let lo = Infinity;
    let farEnd = 0;
    const near = queryActors(car.x, car.z, 45, this.scratch, car.body.id);
    for (const b of near) {
      const passable = pedestrians ? b.kind === 'pedestrian' : b.kind === 'tractor' || b.kind === 'trailer' || this.isFarmBody(b.id);
      const bfx = Math.sin(b.heading);
      const bfz = Math.cos(b.heading);
      for (let i = 0; i < n; i++) {
        const sm = this.samples[i];
        const dx = b.x - sm.x;
        const dz = b.z - sm.z;
        const u = dx * sm.tx + dz * sm.tz;
        if (Math.abs(u) > SAMPLE_STEP * 0.5 + 0.05) continue;
        const v = -dx * sm.tz + dz * sm.tx;
        const cos = bfx * sm.tx + bfz * sm.tz;
        const sin = bfx * sm.tz - bfz * sm.tx;
        const extU = Math.abs(b.halfLength * cos) + Math.abs(b.halfWidth * sin);
        const extV = Math.abs(b.halfLength * sin) + Math.abs(b.halfWidth * cos);
        if (Math.abs(v) > car.halfW + extV + 1.5) break;
        if (!passable) return this.passNote(car, 'other body'); // something else in the way (queue, pedestrian): no pass
        if (sm.d > 32) break;
        targets.add(b.id);
        lo = Math.min(lo, v - extV);
        farEnd = Math.max(farEnd, sm.d + extU);
        break;
      }
    }
    if (targets.size === 0) return this.passNote(car, 'no target');
    // pedestrians: at least a small swerve, the path scan keeps 0.3 m to them
    const shift = pedestrians ? Math.min(-0.35, lo - 0.45 - car.halfW) : lo - 0.55 - car.halfW;
    if (shift > -0.3) return this.passNote(car, 'no shift needed');
    // stay on the carriageway
    const i0 = samplePath(lane, Math.min(lane.length, car.s), tmpP);
    const offset = lane.offset[i0];
    const half = lane.halfRoad[i0];
    // the left wheels may use the verge of the opposite side, as one does passing a tractor
    if (offset + shift - car.halfW < -(half + 0.6)) return this.passNote(car, `road too narrow: offset ${offset.toFixed(2)} shift ${shift.toFixed(2)} half ${half.toFixed(2)} lo ${lo.toFixed(2)}`);
    // a pedestrian is passed at walking pace: a short swerve
    const ramp = pedestrians ? Math.max(4, Math.abs(shift) * 2.5) : stopped ? Math.max(7, Math.abs(shift) * 3.2) : Math.max(25, car.v * 3);
    const passLen = car.front + farEnd + car.overhang + (pedestrians ? 3 : 8) + (stopped ? 0 : (farEnd + 30) * (obSpeed / Math.max(1, vDes - obSpeed)));
    const total = passLen + ramp * 2;
    // the route ahead must have no junction with another car road (field-track crossings are fine), and
    // (moving pass) be straight
    let remaining = -car.s;
    for (const sg of car.route) {
      if (sg.conn && (sg.conn.turn !== 'straight' || sg.conn.node.carDegree > 2)) break;
      remaining += sg.path.length;
    }
    if (remaining < total + (pedestrians ? 3 : 10)) return this.passNote(car, 'junction ahead');
    let turn = 0;
    this.routePoint(car, car.s, tmpP);
    let prev = Math.atan2(tmpP.tx, tmpP.tz);
    for (let d = 0; d <= total; d += 6) {
      this.routePoint(car, car.s + d, tmpP);
      const h = Math.atan2(tmpP.tx, tmpP.tz);
      turn += Math.abs(wrapAngle(h - prev));
      prev = h;
      // corridor free of walls
      const px = tmpP.x - tmpP.tz * shift;
      const pz = tmpP.z + tmpP.tx * shift;
      if (this.network.nearObstacle(px, pz, car.halfW + 0.25)) return this.passNote(car, 'wall');
    }
    if (!stopped && turn > 0.22) return this.passNote(car, 'bend');
    // oncoming traffic: nothing coming within the sight distance needed
    const sight = stopped ? 90 : 330;
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    for (const o of this.cars) {
      if (o === car) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const u = dx * fx + dz * fz;
      if (u < -5 || u > sight) continue;
      const along = Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz;
      if (along < -0.3 && Math.abs(-dx * fz + dz * fx) < 14) return this.passNote(car, 'oncoming');
      // a car already passing ahead of us: wait
      if (o.pass && u < 60) return this.passNote(car, 'other passing');
    }
    const startOdo = car.odo;
    car.pass = { startOdo, endOdo: startOdo + total, shift, ramp, targets, slow: !stopped, pedestrians };
    this.stats.passes++;
    if (pedestrians) this.stats.pedestrianPasses++;
    car.passNote = 'passing';
  }

  /** Extends an active pass while the targets are still beside / ahead of us. */
  private updatePass(car: Car): void {
    const p = car.pass;
    if (!p) return;
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    for (const id of p.targets) {
      const b = this.playerTractor.id === id ? this.playerTractor : this.playerTrailer.id === id ? this.playerTrailer : this.carById.get(id)?.body;
      if (!b || !b.active) continue;
      const u = (b.x - car.x) * fx + (b.z - car.z) * fz; // from my origin
      // far end of the body in path coordinates (+ margin), then the ramp back into the lane
      const need = car.odo - car.zr + u + Math.hypot(b.halfLength, b.halfWidth) + 5 + p.ramp;
      if (need > p.endOdo && car.odo < p.endOdo - p.ramp) p.endOdo = need;
    }
  }

  private updatePose(car: Car, dt: number, snap: boolean): void {
    this.routePoint(car, car.s, tmpP);
    const latR = this.latAt(car, car.odo);
    const rx = tmpP.x - tmpP.tz * latR;
    const rz = tmpP.z + tmpP.tx * latR;
    this.routePoint(car, car.s + car.wb, tmpP);
    const latF = this.latAt(car, car.odo + car.wb);
    const fxp = tmpP.x - tmpP.tz * latF;
    const fzp = tmpP.z + tmpP.tx * latF;
    const yawPrev = car.yaw;
    const yaw = Math.atan2(fxp - rx, fzp - rz);
    car.yaw = yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const ox = rx - fx * car.zr;
    const oz = rz - fz * car.zr;
    const dist = car.v * dt;
    // steering from the yaw rate along the path
    const dYaw = snap ? 0 : wrapAngle(yaw - yawPrev);
    const kappa = dist > 1e-3 ? dYaw / dist : 0;
    const steerT = THREE.MathUtils.clamp(Math.atan(car.wb * kappa), -0.6, 0.6);
    if (snap) car.steer = 0;
    else if (dist > 1e-3) car.steer += (steerT - car.steer) * Math.min(1, dt * 8);
    // suspension: braking dips the nose, cornering rolls outwards
    const yawRate = dt > 0 ? dYaw / dt : 0;
    const aLatLeft = car.v * yawRate;
    const pitchT = THREE.MathUtils.clamp(car.acc * 0.0065, -0.035, 0.02);
    const rollT = THREE.MathUtils.clamp(aLatLeft * 0.006, -0.03, 0.03);
    if (snap) {
      car.pitchDyn = pitchT;
      car.rollDyn = rollT;
      car.pitchVel = 0;
      car.rollVel = 0;
    } else if (dt > 0) {
      const k = 55;
      const c = 9;
      const h = Math.min(dt, 1 / 30);
      let steps = Math.ceil(dt / h);
      while (steps-- > 0) {
        car.pitchVel += (k * (pitchT - car.pitchDyn) - c * car.pitchVel) * h;
        car.pitchDyn += car.pitchVel * h;
        car.rollVel += (k * (rollT - car.rollDyn) - c * car.rollVel) * h;
        car.rollDyn += car.rollVel * h;
      }
    }
    car.spinF += dist / car.type.wheels[0].radius;
    car.spinR += dist / car.type.wheels[2].radius;
    // ground contacts
    const lx = fz;
    const lz = -fx;
    const w = car.type.wheels;
    const h0 = this.groundAt(ox + fx * w[0].z + lx * w[0].x, oz + fz * w[0].z + lz * w[0].x);
    const h1 = this.groundAt(ox + fx * w[1].z + lx * w[1].x, oz + fz * w[1].z + lz * w[1].x);
    const h2 = this.groundAt(ox + fx * w[2].z + lx * w[2].x, oz + fz * w[2].z + lz * w[2].x);
    const h3 = this.groundAt(ox + fx * w[3].z + lx * w[3].x, oz + fz * w[3].z + lz * w[3].x);
    const hf = (h0 + h1) / 2;
    const hr = (h2 + h3) / 2;
    const pitchG = Math.atan2(hf - hr, car.wb);
    const rollG = Math.atan2((h0 + h2) / 2 - (h1 + h3) / 2, Math.abs(w[0].x - w[1].x));
    const y = hr + ((hf - hr) * -car.zr) / car.wb;
    car.x = ox;
    car.z = oz;
    car.y = y;
    const pose = this.renderer.pose(car.slot);
    pose.x = ox;
    pose.y = y;
    pose.z = oz;
    pose.yaw = yaw;
    pose.pitch = pitchG + car.pitchDyn;
    pose.roll = rollG + car.rollDyn;
    pose.steer = car.steer;
    pose.spinF = car.spinF;
    pose.spinR = car.spinR;
    // actor body (box centre)
    const mid = (car.type.frontZ + car.type.rearZ) / 2;
    car.body.x = ox + fx * mid;
    car.body.z = oz + fz * mid;
    car.body.heading = yaw;
    car.body.speed = car.v;
    // lamps
    let flags = car.baseFlags;
    if (this.nightFactor > car.lightThreshold) flags |= CAR_FLAG.headlights;
    if (car.acc < -0.9 || (car.v < 0.3 && car.blocker !== '')) flags |= CAR_FLAG.brake;
    let ind = 0;
    if (car.pass) {
      const o = car.odo;
      if (o < car.pass.startOdo + car.pass.ramp) ind = -1;
      else if (o > car.pass.endOdo - car.pass.ramp) ind = 1;
    } else {
      let d = -car.s - car.front;
      for (const seg of car.route) {
        if (seg.conn) {
          if (d < 38 && d + seg.path.length > -car.front) {
            if (seg.conn.turn === 'left') ind = -1;
            else if (seg.conn.turn === 'right') ind = 1;
          }
          break;
        }
        d += seg.path.length;
        if (d > 38) break;
      }
    }
    car.indicator = ind;
    if (ind < 0) flags |= CAR_FLAG.indicatorLeft;
    else if (ind > 0) flags |= CAR_FLAG.indicatorRight;
    this.renderer.setFlags(car.slot, flags);
  }

  private simulate(dt: number, camera: THREE.Camera): void {
    camera.getWorldPosition(this.tmpCam);
    this.focusX = this.tmpCam.x;
    this.focusZ = this.tmpCam.z;
    camera.updateMatrixWorld();
    const cam = camera as THREE.PerspectiveCamera;
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    // lane index
    this.laneCars.clear();
    for (const c of this.cars) {
      const l = c.route[0].lane;
      if (!l) continue;
      let list = this.laneCars.get(l);
      if (!list) this.laneCars.set(l, (list = []));
      list.push(c);
    }
    for (const c of this.cars) this.updatePass(c);
    for (const c of this.cars) this.stepCar(c, dt);
    // despawn
    const rMax = RING_MAX[this.quality];
    for (const c of [...this.cars]) {
      c.dist = Math.hypot(c.x - this.focusX, c.z - this.focusZ);
      const visible = this.inView(c.x, c.y + 1, c.z, 3);
      const atEnd = c.routeEnds && c.route.length === 1 && c.s > c.route[0].path.length - 0.5;
      if (atEnd) this.despawn(c, false);
      else if ((c.dist > rMax + 80 && !visible) || c.dist > 700) this.despawn(c, false);
      // safety valve for a car that cannot get on (a jam of villagers in a lane, a deadlock nobody resolves):
      // gone while unseen, or - after a long wait - far away even in view
      else if (c.stopT > 45 && ((c.dist > 60 && !visible) || (c.stopT > 90 && c.dist > 120))) this.despawn(c, true);
    }
    // spawn
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 || this.initialFill) {
      this.spawnTimer = 0.3;
      const target = this.drivingTarget;
      let tries = this.initialFill ? target * 3 : 2;
      while (this.cars.filter((c) => !c.farm).length < target && tries-- > 0) this.trySpawn(false);
      if (FARM_ENABLED[this.quality] && !this.cars.some((c) => c.farm)) this.trySpawn(true);
      this.initialFill = false;
    }
    this.stats.driving = this.cars.filter((c) => !c.farm).length;
    this.stats.farm = this.cars.length - this.stats.driving;
  }

  private readonly tmpCam = new THREE.Vector3();

  /** Per-frame update: simulation (unless frozen), actor bodies, rendering. */
  public update(dt: number, camera: THREE.Camera): void {
    const t0 = performance.now();
    this.updatePlayerBodies();
    if (!this.frozen && dt > 0) {
      const step = Math.min(dt, 0.1);
      this.simulate(step, camera);
    }
    this.renderer.commit(camera, this.frozen ? 0 : dt);
    const ms = performance.now() - t0;
    this.cpuMs = this.cpuMs * 0.95 + ms * 0.05;
    this.stats.cpuMs = Math.round(this.cpuMs * 1000) / 1000;
  }

  /** Fixed-step advance for deterministic shots (also while frozen). */
  private advance(seconds: number, camera: THREE.Camera): void {
    const steps = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < steps; i++) {
      this.updatePlayerBodies();
      this.simulate(1 / 30, camera);
    }
    this.renderer.commit(camera, 1 / 30);
  }

  // ---------------------------------------------------------------------------------------------- debug
  /** window.__KINDENHEIM__.npc.traffic */
  public debugApi(camera: THREE.Camera): Record<string, unknown> {
    const nearestLane = (x: number, z: number, heading?: number): { lane: Lane; s: number } => {
      let best: { lane: Lane; s: number } | null = null;
      let bestD = Infinity;
      for (const l of this.network.lanes) {
        if (l.edge.carPruned) continue;
        for (let i = 0; i < l.xs.length; i++) {
          const d = Math.hypot(l.xs[i] - x, l.zs[i] - z);
          if (d >= bestD) continue;
          if (heading !== undefined) {
            const j = Math.min(l.xs.length - 1, i + 1);
            const k = Math.max(0, j - 1);
            const h = Math.atan2(l.xs[j] - l.xs[k], l.zs[j] - l.zs[k]);
            if (Math.abs(wrapAngle(h - heading)) > Math.PI / 2) continue;
          }
          bestD = d;
          best = { lane: l, s: l.s[i] };
        }
      }
      if (!best) throw new Error(`[traffic] spawnAt: no car lane near (${x}, ${z})`);
      return best;
    };
    return {
      counts: () => ({
        ...this.stats,
        render: { ...this.renderer.stats },
        quality: this.quality,
        target: this.drivingTarget,
        frozen: this.frozen,
        network: { ...this.network.stats },
        parkedRemovedFromLanes: this.parkedRemoved,
      }),
      list: () =>
        this.cars.map((c) => ({
          id: c.body.id,
          type: c.type.name,
          x: Math.round(c.x * 10) / 10,
          z: Math.round(c.z * 10) / 10,
          heading: Math.round(c.yaw * 1000) / 1000,
          kmh: Math.round(c.v * 36) / 10,
          road: c.route[0].lane ? `${c.route[0].lane.edge.cls}:${c.route[0].lane.edge.name}` : `junction:${c.route[0].conn!.turn}`,
          blocker: c.blocker,
          pass: c.pass ? true : c.passNote,
          indicator: c.indicator,
        })),
      parked: () => this.parked.map((p) => ({ id: p.body.id, type: p.type.name, kind: p.kind, x: Math.round(p.body.x * 10) / 10, z: Math.round(p.body.z * 10) / 10, heading: Math.round(p.heading * 1000) / 1000 })),
      spawnAt: (x: number, z: number, opts: { type?: string; heading?: number; kmh?: number } = {}) => {
        const { lane, s } = nearestLane(x, z, opts.heading);
        const type = this.renderer.getType(opts.type ?? 'hatch');
        const sClamped = Math.max(2, Math.min(lane.length - 2, s));
        const car = this.spawnCar(lane, sClamped, type, type.name === 'tractor', (opts.kmh ?? 30) / 3.6);
        if (!car) throw new Error('[traffic] spawnAt: narrow stretch held by oncoming traffic, pick another spot');
        this.renderer.commit(camera, 0);
        return car.body.id;
      },
      remove: (id: string) => {
        const c = this.carById.get(id);
        if (!c) throw new Error(`[traffic] remove: no driving car "${id}"`);
        this.despawn(c, false);
      },
      clear: () => {
        for (const c of [...this.cars]) this.despawn(c, false);
      },
      setTarget: (n: number | null) => {
        this.targetOverride = n;
      },
      freeze: () => {
        this.frozen = true;
      },
      unfreeze: () => {
        this.frozen = false;
      },
      advance: (seconds: number) => {
        this.advance(seconds, camera);
        return this.cars.length;
      },
      /** places one of every type in a row (static, solid) for model close-ups; returns their ids */
      /** the longest car lanes (for test set-ups): id, road, length, middle point, heading there */
      longLanes: (count = 12) =>
        this.network.lanes
          .filter((l) => !l.edge.carPruned)
          .sort((a, b) => b.length - a.length)
          .slice(0, count)
          .map((l) => {
            const i = samplePath(l, l.length / 2, tmpP);
            return { id: l.id, road: `${l.edge.cls}:${l.edge.name}`, urban: l.edge.urban, length: Math.round(l.length), x: Math.round(tmpP.x), z: Math.round(tmpP.z), heading: Math.round(Math.atan2(tmpP.tx, tmpP.tz) * 1000) / 1000, offset: l.offset[i] };
          }),
      /** nearest car-lane point: centre line position + driving heading of that lane */
      roadPoint: (x: number, z: number) => {
        const { lane, s } = nearestLane(x, z);
        const i = samplePath(lane, s, tmpP);
        const off = lane.offset[i];
        return { x: tmpP.x + tmpP.tz * off, z: tmpP.z - tmpP.tx * off, laneX: tmpP.x, laneZ: tmpP.z, heading: Math.atan2(tmpP.tx, tmpP.tz), road: lane.edge.name, cls: lane.edge.cls };
      },
      showroom: (x: number, z: number, heading = 0, spacing = 6.5, along = false) => {
        const rng = mulberry32(7);
        const ids: string[] = [];
        // side by side (to the car's right) or in a column (one behind the other)
        const rx = along ? -Math.sin(heading) : -Math.cos(heading);
        const rz = along ? -Math.cos(heading) : Math.sin(heading);
        let k = 0;
        for (const name of this.renderer.typeNames()) {
          const t = this.renderer.getType(name);
          const p = this.addStaticCar(t, x + rx * spacing * k, z + rz * spacing * k, heading, rng, 'showroom');
          ids.push(p.body.id);
          k++;
        }
        this.renderer.commit(camera, 0);
        return ids;
      },
      clearShowroom: () => {
        for (const p of [...this.parked]) {
          if (p.kind !== 'showroom') continue;
          this.renderer.free(p.slot);
          unregisterActor(p.body.id);
          this.parked.splice(this.parked.indexOf(p), 1);
        }
      },
      setCarFlags: (id: string, flags: number) => {
        const p = this.parked.find((q) => q.body.id === id);
        if (!p) throw new Error(`[traffic] setCarFlags: no static car "${id}"`);
        this.renderer.setFlags(p.slot, flags);
      },
      flags: { ...CAR_FLAG },
      /**
       * Runs the simulation for `seconds` (fixed 1/30 s steps) and checks after every step that no driving car
       * overlaps another body (cars, parked cars, tractor, trailer, pedestrians) or a building outline.
       */
      selfTest: (seconds: number, coStep?: (dt: number) => void) => this.selfTest(seconds, camera, coStep),
      overlaps: () => this.findOverlaps(),
      car: (id: string) => {
        const c = this.carById.get(id);
        if (!c) throw new Error(`[traffic] car: no driving car "${id}"`);
        const n = this.buildSamples(c);
        return {
          id,
          s: c.s,
          x: c.x,
          z: c.z,
          yaw: c.yaw,
          body: { x: c.body.x, z: c.body.z, h: c.body.heading, hl: c.body.halfLength, hw: c.body.halfWidth },
          route: c.route.map((sg) => (sg.lane ? `lane ${sg.lane.id} ${sg.lane.edge.cls}:${sg.lane.edge.name} len ${sg.lane.length.toFixed(1)}` : `conn ${sg.conn!.id} ${sg.conn!.turn}`)),
          samples: this.samples.slice(0, n).map((sm) => [Math.round(sm.x * 100) / 100, Math.round(sm.z * 100) / 100, Math.round(sm.d * 10) / 10]),
          blocker: c.blocker,
          held: c.held.map((h) => `seg ${h.seg.id} owner ${h.seg.owner} holders ${[...h.seg.holders].join('/')} lane ${h.lane.id} ${h.s0.toFixed(1)}-${h.s1.toFixed(1)}`),
          narrowAhead: c.route.flatMap((sg) => (sg.lane ? sg.lane.narrow.map((n) => `lane ${sg.lane!.id} seg ${n.seg.id} ${n.s0.toFixed(1)}-${n.s1.toFixed(1)} owner ${n.seg.owner} holders ${[...n.seg.holders].join('/')}`) : [])),
        };
      },
      /** lanes / connectors / parked cars / outlines around (x, z) for plotting */
      dump: (x: number, z: number, r: number) => {
        const inR = (px: number, pz: number) => Math.abs(px - x) < r && Math.abs(pz - z) < r;
        const poly = (p: PathGeom) => Array.from(p.xs, (vx, i) => [Math.round(vx * 100) / 100, Math.round(p.zs[i] * 100) / 100]);
        return {
          center: [x, z, r],
          lanes: this.network.lanes.filter((l) => Array.from(l.xs).some((vx, i) => inR(vx, l.zs[i]))).map((l) => ({ id: l.id, cls: l.edge.cls, pruned: l.edge.carPruned, pts: poly(l), narrow: l.narrow.map((n) => [n.s0, n.s1]) })),
          conns: this.network.connectors.filter((c) => inR(c.node.x, c.node.z)).map((c) => ({ id: c.id, turn: c.turn, pts: poly(c) })),
          edges: this.network.edges.filter((e) => e.pts.some((p) => inR(p[0], p[1]))).map((e) => ({ cls: e.cls, name: e.name, pts: e.pts })),
          obstacles: this.deps.obstacles.filter((o) => o.some((p) => inR(p[0], p[1]))),
          parked: this.parked.filter((p) => inR(p.body.x, p.body.z)).map((p) => ({ x: p.body.x, z: p.body.z, h: p.heading, hl: p.body.halfLength, hw: p.body.halfWidth })),
          cars: this.cars.filter((c) => inR(c.x, c.z)).map((c) => ({ id: c.body.id, x: c.body.x, z: c.body.z, h: c.yaw, hl: c.body.halfLength, hw: c.body.halfWidth, blocker: c.blocker })),
        };
      },
    };
  }

  private static obbOverlap(a: ActorBody, b: ActorBody, shrink: number): boolean {
    const axes: [number, number][] = [
      [Math.sin(a.heading), Math.cos(a.heading)],
      [-Math.cos(a.heading), Math.sin(a.heading)],
      [Math.sin(b.heading), Math.cos(b.heading)],
      [-Math.cos(b.heading), Math.sin(b.heading)],
    ];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    for (const [ax, az] of axes) {
      const ra =
        Math.abs((Math.sin(a.heading) * ax + Math.cos(a.heading) * az) * (a.halfLength - shrink)) +
        Math.abs((-Math.cos(a.heading) * ax + Math.sin(a.heading) * az) * (a.halfWidth - shrink));
      const rb =
        Math.abs((Math.sin(b.heading) * ax + Math.cos(b.heading) * az) * (b.halfLength - shrink)) +
        Math.abs((-Math.cos(b.heading) * ax + Math.sin(b.heading) * az) * (b.halfWidth - shrink));
      if (Math.abs(dx * ax + dz * az) > ra + rb) return false;
    }
    return true;
  }

  /** Driving cars that overlap another body (5 cm tolerance) or stand in a building outline. */
  private findOverlaps(): string[] {
    const out: string[] = [];
    const bodies = [...allActors()].filter((b) => b.active);
    for (const c of this.cars) {
      for (const b of bodies) {
        if (b === c.body) continue;
        if (this.carById.has(b.id) && b.id < c.body.id) continue; // each car pair once
        if (TrafficSystem.obbOverlap(c.body, b, 0.05)) out.push(`${c.body.id} x ${b.id} at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) car ${c.v.toFixed(2)} m/s${c.pass ? ' passing' : ''}, other ${b.speed.toFixed(2)} m/s`);
      }
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      const hl = c.body.halfLength - 0.1;
      const hw = c.halfW - 0.15;
      for (const [u, v] of [
        [hl, hw],
        [hl, -hw],
        [-hl, hw],
        [-hl, -hw],
      ]) {
        const px = c.body.x + fx * u - fz * v;
        const pz = c.body.z + fz * u + fx * v;
        if (this.network.insideObstacle(px, pz)) {
          out.push(`${c.body.id} corner in a building at (${px.toFixed(1)}, ${pz.toFixed(1)})`);
          break;
        }
      }
    }
    return out;
  }

  /** `coStep(dt)` advances other systems in lock-step (e.g. the pedestrians' debug step). */
  private selfTest(seconds: number, camera: THREE.Camera, coStep?: (dt: number) => void): Record<string, unknown> {
    const steps = Math.round(seconds * 30);
    const seen = new Map<string, number>();
    const firstAt = new Map<string, string>();
    const stuckEvents = new Map<string, string>();
    let driven = 0;
    let overlapSteps = 0;
    let moved = 0;
    const start = new Map(this.cars.map((c) => [c.id, c.odo]));
    let maxMs = 0;
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      coStep?.(1 / 30);
      this.updatePlayerBodies();
      this.simulate(1 / 30, camera);
      maxMs = Math.max(maxMs, performance.now() - t0);
      for (const c of this.cars) {
        if (c.stopT > 30 && !stuckEvents.has(c.body.id)) stuckEvents.set(c.body.id, `${(i / 30).toFixed(0)}s ${c.body.id} at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) by ${c.blocker}`);
        driven += c.v / 30;
      }
      const o = this.findOverlaps();
      if (o.length) overlapSteps++;
      for (const k of o) {
        const key = k.replace(/ at \(.*$/, '');
        if (!seen.has(key)) seen.set(key, i / 30);
        if (!firstAt.has(key)) firstAt.set(key, k);
      }
    }
    for (const c of this.cars) {
      const s0 = start.get(c.id);
      if (s0 !== undefined && c.odo - s0 > 5) moved++;
    }
    this.renderer.commit(camera, 1 / 30);
    return {
      seconds,
      overlapSteps,
      overlaps: [...seen.entries()].slice(0, 30).map(([k, t]) => `${t.toFixed(1)}s ${firstAt.get(k)}`),
      stuck: this.cars.filter((c) => c.stopT > 20).map((c) => `${c.body.id} ${c.stopT.toFixed(0)}s at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) blocked by ${c.blocker}`),
      carsMovedOver5m: moved,
      kmDriven: Math.round(driven) / 1000,
      stuckOver30s: [...stuckEvents.values()],
      maxStepMs: Math.round(maxMs * 100) / 100,
      ...this.stats,
    };
  }

  public dispose(): void {
    for (const c of [...this.cars]) this.despawn(c, false);
    for (const p of this.parked) unregisterActor(p.body.id);
    unregisterActor(this.playerTractor.id);
    unregisterActor(this.playerTrailer.id);
    this.deps.collider.setDynamicSolidKinds([]);
    this.renderer.dispose();
  }
}
