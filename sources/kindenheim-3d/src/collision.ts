import * as THREE from 'three';
import type { BuildingRecord, LandmarkManifest } from './types';
import { resolveAssetUrl } from './url';
import { queryActors, type ActorBody, type ActorKind } from './actors';

interface ColliderPoly {
  points: [number, number][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Centre of the bounding box: where the ground level under the obstacle is sampled. */
  cx: number;
  cz: number;
  /** Obstacle height above the ground at (cx, cz). */
  heightM: number;
  /** World-space Y of the obstacle's top. NaN until first needed (ground + heightM) or measured from a model. */
  topY: number;
  /** OSM / LoD2 id of the building this footprint came from (null for props and landmark solids). */
  buildingId: string | null;
  /** Landmark key for solids from colliders.json (null otherwise). */
  landmarkKey: string | null;
}

export interface CollisionHit {
  hit: boolean;
  pushX: number;
  pushZ: number;
  normalX: number;
  normalZ: number;
}

/** One entry of public/assets/models/landmarks/colliders.json (contract: .gfx/review/FIXROUND.md). */
export interface LandmarkColliderEntry {
  /** true: drop the landmark's OSM footprint collider(s) and use only `solids`. */
  replaceFootprint: boolean;
  /** World-space polygons [[x, z], …] in metres. */
  solids: [number, number][][];
}

export type LandmarkColliderFile = Record<string, LandmarkColliderEntry>;

export interface LandmarkColliderSummary {
  landmarks: number;
  solids: number;
  replacedFootprints: number;
}

/** Shipped next to the landmark GLBs; written by the kirche-rathaus and estates builders. */
export const LANDMARK_COLLIDERS_URL = 'assets/models/landmarks/colliders.json';

/**
 * Height assumed for obstacles registered without one (recreation props, fences). Only the chase camera
 * uses heights; the tractor is stopped by every polygon regardless.
 */
export const DEFAULT_OBSTACLE_HEIGHT_M = 6;

/** Keys that may carry free-text documentation inside colliders.json and are ignored. */
const DOC_KEYS = new Set(['note', 'notes', 'comment']);

function pointInPoly(px: number, pz: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const zi = pts[i][1];
    const xj = pts[j][0];
    const zj = pts[j][1];
    const hit = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function closestPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): [number, number, number] {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  const t = lenSq > 1e-8 ? THREE.MathUtils.clamp(((px - ax) * abx + (pz - az) * abz) / lenSq, 0, 1) : 0;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return [cx, cz, dx * dx + dz * dz];
}

/** Squared distance from a point to a polygon outline (allocation-free; used every frame by the camera). */
function distSqToOutline(px: number, pz: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0];
    const az = pts[j][1];
    const abx = pts[i][0] - ax;
    const abz = pts[i][1] - az;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 1e-8 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = px - (ax + abx * t);
    const dz = pz - (az + abz * t);
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return best;
}

function polygonAreaM2(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a) * 0.5;
}

const SKIPPED_COLLIDER_IDS = new Set([
  'lod2/DERPLP110000QOZg',
  'lod2/DERPLP110000QPa2',
]);

/**
 * Validates the parsed colliders.json against the contract and the landmark manifest. Throws with the file
 * name, the landmark key and the offending value; never repairs or skips anything.
 */
function parseLandmarkColliderFile(
  raw: unknown,
  url: string,
  knownKeys: ReadonlySet<string>,
  halfMapM: number
): LandmarkColliderFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Colliders: ${url} must be an object { "<landmarkKey>": { replaceFootprint, solids } }`);
  }
  const out: LandmarkColliderFile = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith('_') || DOC_KEYS.has(key)) continue;
    if (!knownKeys.has(key)) {
      throw new Error(
        `Colliders: ${url} has the key "${key}", which is not a landmark in landmarks/manifest.json ` +
          `(known: ${[...knownKeys].join(', ')})`
      );
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Colliders: ${url} → "${key}" must be an object { replaceFootprint, solids }`);
    }
    const entry = value as Record<string, unknown>;
    for (const field of Object.keys(entry)) {
      if (field === 'replaceFootprint' || field === 'solids' || field.startsWith('_') || DOC_KEYS.has(field)) continue;
      throw new Error(
        `Colliders: ${url} → "${key}" has the unknown field "${field}" (the contract only knows replaceFootprint and solids)`
      );
    }
    if (typeof entry.replaceFootprint !== 'boolean') {
      throw new Error(
        `Colliders: ${url} → "${key}".replaceFootprint must be true or false, got ${JSON.stringify(entry.replaceFootprint)}`
      );
    }
    if (!Array.isArray(entry.solids)) {
      throw new Error(`Colliders: ${url} → "${key}".solids must be an array of polygons, got ${typeof entry.solids}`);
    }
    if (entry.replaceFootprint && entry.solids.length === 0) {
      throw new Error(
        `Colliders: ${url} → "${key}" replaces its footprint with zero solids; the landmark would have no collision at all`
      );
    }
    const solids: [number, number][][] = [];
    entry.solids.forEach((solid: unknown, si: number) => {
      const where = `${url} → "${key}".solids[${si}]`;
      if (!Array.isArray(solid) || solid.length < 3) {
        throw new Error(`Colliders: ${where} must be a polygon of at least 3 [x, z] points`);
      }
      const pts: [number, number][] = solid.map((p: unknown, pi: number) => {
        if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
          throw new Error(`Colliders: ${where}[${pi}] must be [x, z] with finite numbers, got ${JSON.stringify(p)}`);
        }
        const x = p[0] as number;
        const z = p[1] as number;
        if (Math.abs(x) > halfMapM || Math.abs(z) > halfMapM) {
          throw new Error(
            `Colliders: ${where}[${pi}] = [${x}, ${z}] lies outside the ${halfMapM * 2} m map (world-space metres expected)`
          );
        }
        return [x, z];
      });
      if (polygonAreaM2(pts) < 0.01) {
        throw new Error(`Colliders: ${where} is degenerate (area below 0.01 m²)`);
      }
      solids.push(pts);
    });
    out[key] = { replaceFootprint: entry.replaceFootprint, solids };
  }
  return out;
}

export class BuildingCollider {
  private readonly cellSize = 18;
  private readonly grid = new Map<number, ColliderPoly[]>();
  private readonly halfLimit: number;
  private readonly mapSizeM: number;
  private readonly buildings: BuildingRecord[];
  private readonly landmarkSolids: ColliderPoly[] = [];
  private landmarkCollidersState: 'none' | 'loading' | 'loaded' = 'none';
  private solidHeightsMeasured = false;
  public polyCount = 0;
  /** NPC traffic: actor kinds (src/actors.ts) that resolveCircle() treats as solid. Empty = none. */
  private readonly dynamicSolidKinds = new Set<ActorKind>();
  private readonly dynamicScratch: ActorBody[] = [];

  constructor(buildings: BuildingRecord[], mapSizeM: number) {
    this.mapSizeM = mapSizeM;
    this.halfLimit = mapSizeM * 0.5 - 8;
    this.buildings = buildings;

    for (const b of buildings) {
      if (SKIPPED_COLLIDER_IDS.has(String(b.id))) continue;
      const heightM = BuildingCollider.buildingHeightM(b);
      this.insert(b.footprint, heightM, String(b.id), null);
      // Include freestanding Evangelische Martinskirche bell tower footprint!
      if (b.tower?.footprint) {
        this.insert(b.tower.footprint, Math.max(heightM, b.tower.totalHeightM ?? 0), String(b.id), null);
      }
    }
  }

  private static buildingHeightM(b: BuildingRecord): number {
    const h = (b.wallHeightM ?? 0) + (b.roofHeightM ?? 0);
    return h > 0.5 ? h : DEFAULT_OBSTACLE_HEIGHT_M;
  }

  /** True once colliders.json has been applied (landmark yards drivable, walls and monuments solid). */
  public get landmarkCollidersLoaded(): boolean {
    return this.landmarkCollidersState === 'loaded';
  }

  /**
   * Registers an extra solid obstacle (world-space [x, z] polygon). `heightM` is its height above the ground
   * and only matters for the chase camera, which may look over low obstacles.
   */
  public addPolygon(pts: [number, number][] | undefined, heightM: number = DEFAULT_OBSTACLE_HEIGHT_M): void {
    this.insert(pts, heightM, null, null);
  }

  private cellKey(gx: number, gz: number): number {
    return ((gx + 2048) << 16) | ((gz + 2048) & 0xffff);
  }

  private insert(
    pts: [number, number][] | undefined,
    heightM: number,
    buildingId: string | null,
    landmarkKey: string | null
  ): ColliderPoly | null {
    if (!pts || pts.length < 3) return null;
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
    if (!Number.isFinite(minX)) return null;
    const poly: ColliderPoly = {
      points: pts,
      minX,
      maxX,
      minZ,
      maxZ,
      cx: (minX + maxX) * 0.5,
      cz: (minZ + maxZ) * 0.5,
      heightM,
      topY: Number.NaN,
      buildingId,
      landmarkKey,
    };
    this.polyCount++;

    const gx0 = Math.floor((minX - 2) / this.cellSize);
    const gx1 = Math.floor((maxX + 2) / this.cellSize);
    const gz0 = Math.floor((minZ - 2) / this.cellSize);
    const gz1 = Math.floor((maxZ + 2) / this.cellSize);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const key = this.cellKey(gx, gz);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(poly);
      }
    }
    return poly;
  }

  private removeBuildingFootprints(ids: ReadonlySet<string>): number {
    const removed = new Set<ColliderPoly>();
    for (const [key, list] of this.grid) {
      const kept = list.filter((poly) => {
        if (poly.buildingId === null || !ids.has(poly.buildingId)) return true;
        removed.add(poly);
        return false;
      });
      if (kept.length === 0) this.grid.delete(key);
      else if (kept.length !== list.length) this.grid.set(key, kept);
    }
    this.polyCount -= removed.size;
    return removed.size;
  }

  /**
   * Loads and applies public/assets/models/landmarks/colliders.json:
   * `{ "<landmarkKey>": { "replaceFootprint": bool, "solids": [ [[x, z], …], … ] } }`.
   *
   * Required data: a missing, unreadable or malformed file throws with the URL and the cause, so the
   * loading overlay shows it. `replaceFootprint: true` drops the OSM footprint(s) listed under the landmark's
   * `osmIds` in the landmark manifest; every solid is added as a collision polygon.
   */
  public async loadLandmarkColliders(
    landmarksManifest: LandmarkManifest | null,
    url: string = LANDMARK_COLLIDERS_URL
  ): Promise<LandmarkColliderSummary> {
    if (this.landmarkCollidersState !== 'none') {
      throw new Error('Colliders: loadLandmarkColliders() was called twice');
    }
    if (!landmarksManifest || landmarksManifest.landmarks.length === 0) {
      throw new Error('Colliders: the landmark manifest is missing or empty, so colliders.json cannot be matched to landmarks');
    }
    this.landmarkCollidersState = 'loading';

    const resolved = resolveAssetUrl(url);
    let res: Response;
    try {
      res = await fetch(resolved);
    } catch (err) {
      throw new Error(`Colliders: network error while loading ${resolved}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new Error(`Colliders: ${resolved} answered HTTP ${res.status}`);
    const text = await res.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      const head = text.slice(0, 40).replace(/\s+/g, ' ');
      const hint = /^\s*</.test(text) ? ' — the server answered with an HTML page, so the file is missing' : '';
      throw new Error(`Colliders: ${resolved} is not valid JSON (starts with "${head}")${hint}`);
    }

    const osmIdsByKey = new Map<string, Set<string>>();
    for (const entry of landmarksManifest.landmarks) {
      const key = entry.key ?? entry.id;
      if (!key) continue;
      const ids = new Set<string>((entry.osmIds ?? []).map(String));
      if (entry.osmId !== undefined) ids.add(String(entry.osmId));
      osmIdsByKey.set(key, ids);
    }

    const file = parseLandmarkColliderFile(raw, resolved, new Set(osmIdsByKey.keys()), this.mapSizeM * 0.5);

    let solidCount = 0;
    let replaced = 0;
    for (const [key, entry] of Object.entries(file)) {
      const ids = osmIdsByKey.get(key)!;
      // Until measureLandmarkSolidHeights() has looked at the model, every solid of a landmark is assumed
      // to be as tall as the landmark building itself (keeps the chase camera out of the church roof).
      let landmarkHeightM = 0;
      for (const b of this.buildings) {
        if (!ids.has(String(b.id))) continue;
        landmarkHeightM = Math.max(landmarkHeightM, BuildingCollider.buildingHeightM(b), b.tower?.totalHeightM ?? 0);
      }
      if (entry.replaceFootprint) {
        const removed = this.removeBuildingFootprints(ids);
        if (removed === 0) {
          throw new Error(
            `Colliders: ${resolved} → "${key}".replaceFootprint is true, but none of its osmIds ` +
              `(${[...ids].join(', ') || 'none listed in the landmark manifest'}) has a footprint collider to replace`
          );
        }
        replaced += removed;
      }
      const heightM = landmarkHeightM > 0 ? landmarkHeightM : DEFAULT_OBSTACLE_HEIGHT_M;
      for (const solid of entry.solids) {
        const poly = this.insert(solid, heightM, null, key);
        if (!poly) throw new Error(`Colliders: ${resolved} → "${key}": a validated solid could not be inserted`);
        this.landmarkSolids.push(poly);
        solidCount++;
      }
    }

    this.landmarkCollidersState = 'loaded';
    return { landmarks: Object.keys(file).length, solids: solidCount, replacedFootprints: replaced };
  }

  /**
   * Measures how tall each landmark solid really is from the loaded landmark model (highest vertex inside
   * the polygon), so the chase camera can look over a terrace wall or the war memorial instead of treating
   * them like the church nave. Call once after the landmark GLBs are in the scene.
   *
   * A solid without any model geometry inside it would be an invisible wall: that is reported as an error.
   */
  public measureLandmarkSolidHeights(landmarks: ReadonlyMap<string, { object: THREE.Object3D }>): void {
    if (this.landmarkCollidersState !== 'loaded') {
      throw new Error('Colliders: measureLandmarkSolidHeights() needs loadLandmarkColliders() to have finished first');
    }
    if (this.solidHeightsMeasured) throw new Error('Colliders: measureLandmarkSolidHeights() was called twice');

    const byKey = new Map<string, ColliderPoly[]>();
    for (const poly of this.landmarkSolids) {
      const list = byKey.get(poly.landmarkKey!);
      if (list) list.push(poly);
      else byKey.set(poly.landmarkKey!, [poly]);
    }

    const EDGE_TOLERANCE_M = 0.08;
    const edgeTolSq = EDGE_TOLERANCE_M * EDGE_TOLERANCE_M;
    const v = new THREE.Vector3();
    const empty: string[] = [];

    for (const [key, solids] of byKey) {
      const info = landmarks.get(key) ?? landmarks.get(key.toLowerCase());
      if (!info) {
        throw new Error(
          `Colliders: colliders.json has solids for "${key}", but that landmark model was not loaded ` +
            `(loaded: ${[...landmarks.keys()].join(', ') || 'none'})`
        );
      }
      const tops = solids.map(() => -Infinity);
      info.object.updateWorldMatrix(true, true);
      info.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.getAttribute('position');
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          for (let s = 0; s < solids.length; s++) {
            const poly = solids[s];
            if (
              v.x < poly.minX - EDGE_TOLERANCE_M ||
              v.x > poly.maxX + EDGE_TOLERANCE_M ||
              v.z < poly.minZ - EDGE_TOLERANCE_M ||
              v.z > poly.maxZ + EDGE_TOLERANCE_M ||
              v.y <= tops[s]
            ) {
              continue;
            }
            if (pointInPoly(v.x, v.z, poly.points) || distSqToOutline(v.x, v.z, poly.points) <= edgeTolSq) {
              tops[s] = v.y;
            }
          }
        }
      });
      solids.forEach((poly, s) => {
        if (tops[s] === -Infinity) {
          empty.push(`"${key}" solid at x=${poly.cx.toFixed(1)} z=${poly.cz.toFixed(1)}`);
          return;
        }
        poly.topY = tops[s];
      });
    }

    if (empty.length > 0) {
      throw new Error(
        `Colliders: ${empty.length} solid(s) in colliders.json contain no geometry of their landmark model ` +
          `(an invisible wall): ${empty.join('; ')}`
      );
    }
    this.solidHeightsMeasured = true;
  }

  /**
   * World-space Y of the highest obstacle within `radius` of (x, z), or -Infinity where the ground is free.
   * `groundHeightAt` supplies the terrain height (obstacle tops are cached after the first lookup).
   */
  public obstacleTopAt(x: number, z: number, radius: number, groundHeightAt: (x: number, z: number) => number): number {
    const gx0 = Math.floor((x - radius) / this.cellSize);
    const gx1 = Math.floor((x + radius) / this.cellSize);
    const gz0 = Math.floor((z - radius) / this.cellSize);
    const gz1 = Math.floor((z + radius) / this.cellSize);
    const rSq = radius * radius;
    let top = -Infinity;

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const list = this.grid.get(this.cellKey(gx, gz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const poly = list[i];
          if (x + radius < poly.minX || x - radius > poly.maxX || z + radius < poly.minZ || z - radius > poly.maxZ) {
            continue;
          }
          if (Number.isNaN(poly.topY)) poly.topY = groundHeightAt(poly.cx, poly.cz) + poly.heightM;
          if (poly.topY <= top) continue;
          if (pointInPoly(x, z, poly.points) || distSqToOutline(x, z, poly.points) < rSq) top = poly.topY;
        }
      }
    }
    return top;
  }

  /**
   * NPC traffic hook: from now on resolveCircle() also pushes out of the active actor bodies of these kinds
   * (src/actors.ts oriented boxes). Called by src/traffic.ts with ['car', 'pedestrian']; the player's own
   * 'tractor' / 'trailer' bodies must not be listed (the tractor would collide with itself).
   */
  public setDynamicSolidKinds(kinds: readonly ActorKind[]): void {
    for (const k of kinds) {
      if (k === 'tractor' || k === 'trailer') {
        throw new Error(`[collision] setDynamicSolidKinds: "${k}" is the player's own body and cannot be solid for itself`);
      }
    }
    this.dynamicSolidKinds.clear();
    for (const k of kinds) this.dynamicSolidKinds.add(k);
  }

  public resolveCircle(x: number, z: number, radius: number): CollisionHit {
    let curX = x;
    let curZ = z;
    let hit = false;
    let totalNormalX = 0;
    let totalNormalZ = 0;

    // 1. World boundary clamping (2048m Kindenheim map)
    if (curX < -this.halfLimit + radius) {
      curX = -this.halfLimit + radius;
      hit = true;
      totalNormalX += 1;
    } else if (curX > this.halfLimit - radius) {
      curX = this.halfLimit - radius;
      hit = true;
      totalNormalX -= 1;
    }
    if (curZ < -this.halfLimit + radius) {
      curZ = -this.halfLimit + radius;
      hit = true;
      totalNormalZ += 1;
    } else if (curZ > this.halfLimit - radius) {
      curZ = this.halfLimit - radius;
      hit = true;
      totalNormalZ -= 1;
    }

    // 2. Gather nearby unique building polygons from spatial hash
    const gx0 = Math.floor((curX - radius - 1) / this.cellSize);
    const gx1 = Math.floor((curX + radius + 1) / this.cellSize);
    const gz0 = Math.floor((curZ - radius - 1) / this.cellSize);
    const gz1 = Math.floor((curZ + radius + 1) / this.cellSize);

    const visited = new Set<ColliderPoly>();
    const rSq = radius * radius;

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const list = this.grid.get(this.cellKey(gx, gz));
        if (!list) continue;

        for (const poly of list) {
          if (visited.has(poly)) continue;
          visited.add(poly);

          if (
            curX + radius < poly.minX ||
            curX - radius > poly.maxX ||
            curZ + radius < poly.minZ ||
            curZ - radius > poly.maxZ
          ) {
            continue;
          }

          const pts = poly.points;
          let bestDistSq = Infinity;
          let bestCx = curX;
          let bestCz = curZ;

          for (let i = 0; i < pts.length; i++) {
            const [ax, az] = pts[i];
            const [bx, bz] = pts[(i + 1) % pts.length];
            const [cx, cz, dSq] = closestPointOnSegment(curX, curZ, ax, az, bx, bz);
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              bestCx = cx;
              bestCz = cz;
            }
          }

          const inside = pointInPoly(curX, curZ, pts);
          if (inside || bestDistSq < rSq) {
            const dist = Math.sqrt(bestDistSq);
            let nx: number;
            let nz: number;
            let pushDist: number;

            if (inside) {
              // Push outward from inside the footprint past the nearest edge
              if (dist > 1e-4) {
                nx = (bestCx - curX) / dist;
                nz = (bestCz - curZ) / dist;
              } else {
                nx = 1;
                nz = 0;
              }
              pushDist = dist + radius + 0.02;
            } else {
              if (dist > 1e-4) {
                nx = (curX - bestCx) / dist;
                nz = (curZ - bestCz) / dist;
              } else {
                nx = 1;
                nz = 0;
              }
              pushDist = radius - dist + 0.01;
            }

            curX += nx * pushDist;
            curZ += nz * pushDist;
            totalNormalX += nx;
            totalNormalZ += nz;
            hit = true;
          }
        }
      }
    }

    // 3. NPC traffic: moving actor bodies (oriented boxes from src/actors.ts) of the kinds set through
    //    setDynamicSolidKinds() are solid too, so the tractor cannot drive through cars / pedestrians.
    if (this.dynamicSolidKinds.size > 0) {
      const near = queryActors(curX, curZ, radius + 0.5, this.dynamicScratch);
      for (const b of near) {
        if (!this.dynamicSolidKinds.has(b.kind)) continue;
        const fx = Math.sin(b.heading);
        const fz = Math.cos(b.heading);
        // box frame: u along the heading, v to the right (-fz, fx)
        const dx = curX - b.x;
        const dz = curZ - b.z;
        const u = dx * fx + dz * fz;
        const v = -dx * fz + dz * fx;
        const cu = Math.max(-b.halfLength, Math.min(b.halfLength, u));
        const cv = Math.max(-b.halfWidth, Math.min(b.halfWidth, v));
        const du = u - cu;
        const dv = v - cv;
        const dSq = du * du + dv * dv;
        if (dSq >= rSq) continue;
        let nu: number;
        let nv: number;
        let pushDist: number;
        if (dSq > 1e-8) {
          const d = Math.sqrt(dSq);
          nu = du / d;
          nv = dv / d;
          pushDist = radius - d + 0.01;
        } else {
          // centre inside the box: leave through the nearest face
          const penU = b.halfLength - Math.abs(u);
          const penV = b.halfWidth - Math.abs(v);
          if (penU < penV) {
            nu = u >= 0 ? 1 : -1;
            nv = 0;
            pushDist = penU + radius + 0.01;
          } else {
            nu = 0;
            nv = v >= 0 ? 1 : -1;
            pushDist = penV + radius + 0.01;
          }
        }
        const nx = nu * fx - nv * fz;
        const nz = nu * fz + nv * fx;
        curX += nx * pushDist;
        curZ += nz * pushDist;
        totalNormalX += nx;
        totalNormalZ += nz;
        hit = true;
      }
    }

    const nLen = Math.hypot(totalNormalX, totalNormalZ);
    return {
      hit,
      pushX: curX - x,
      pushZ: curZ - z,
      normalX: nLen > 1e-4 ? totalNormalX / nLen : 0,
      normalZ: nLen > 1e-4 ? totalNormalZ / nLen : 0,
    };
  }
}
