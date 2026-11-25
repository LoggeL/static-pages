import * as THREE from 'three';
import type { BuildingRecord } from './types';

interface ColliderPoly {
  points: [number, number][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CollisionHit {
  hit: boolean;
  pushX: number;
  pushZ: number;
  normalX: number;
  normalZ: number;
}

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

const SKIPPED_COLLIDER_IDS = new Set([
  'lod2/DERPLP110000QOZg',
  'lod2/DERPLP110000QPa2',
]);

export class BuildingCollider {
  private readonly cellSize = 18;
  private readonly grid = new Map<number, ColliderPoly[]>();
  private readonly halfLimit: number;
  public polyCount = 0;

  constructor(buildings: BuildingRecord[], mapSizeM: number) {
    this.halfLimit = mapSizeM * 0.5 - 8;

    for (const b of buildings) {
      if (SKIPPED_COLLIDER_IDS.has(String(b.id))) continue;
      this.addPolygon(b.footprint);
      // Include freestanding Evangelische Martinskirche bell tower footprint!
      if (b.tower?.footprint) {
        this.addPolygon(b.tower.footprint);
      }
    }
  }

  public addPolygon(pts: [number, number][] | undefined): void {
    if (!pts || pts.length < 3) return;
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
    if (!Number.isFinite(minX)) return;
    const poly: ColliderPoly = { points: pts, minX, maxX, minZ, maxZ };
    this.polyCount++;

    const gx0 = Math.floor((minX - 2) / this.cellSize);
    const gx1 = Math.floor((maxX + 2) / this.cellSize);
    const gz0 = Math.floor((minZ - 2) / this.cellSize);
    const gz1 = Math.floor((maxZ + 2) / this.cellSize);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const key = ((gx + 2048) << 16) | ((gz + 2048) & 0xffff);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(poly);
      }
    }
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
        const key = ((gx + 2048) << 16) | ((gz + 2048) & 0xffff);
        const list = this.grid.get(key);
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
