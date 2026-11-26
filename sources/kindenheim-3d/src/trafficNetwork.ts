/**
 * NPC traffic - lane graph built from the OSM roads (`dataset.scene.roads`).
 *
 * - Ways are split into edges at shared OSM nodes (junctions). Every car edge gets two directed lanes (right-hand
 *   traffic) offset from the centre line by the rendered carriageway: the urban L 450 / Hauptstraße is centred
 *   between its kerbs (found through `roadGroup.userData.getSurfaceLift`, because src/roads.ts shifts that run off
 *   the OSM line), the other classes use the widths src/roads.ts draws. Offsets shrink where a facade is close.
 * - Lanes are trimmed back from each junction; Bezier connectors join an incoming lane to every outgoing lane of
 *   another edge, with a curvature speed limit and a conflict set (paths crossing or merging) for yielding.
 * - Dead-end branches are pruned from the car network (the map border counts as an exit). Field tracks are only for
 *   farm vehicles.
 */
import type { RoadRecord } from './types';

export type RoadClass = 'highway' | 'lane' | 'village' | 'service' | 'track';

export interface PathGeom {
  xs: Float64Array;
  zs: Float64Array;
  /** cumulative arc length at every point */
  s: Float64Array;
  length: number;
}

export interface TrafficNode {
  id: number;
  x: number;
  z: number;
  edges: TrafficEdge[];
  border: boolean;
  inLanes: Lane[];
  connectors: Connector[];
  /** number of car edges that are not pruned */
  carDegree: number;
}

export interface TrafficEdge {
  id: number;
  a: TrafficNode;
  b: TrafficNode;
  cls: RoadClass;
  name: string;
  /** centre line (x, z) after the urban kerb correction */
  pts: [number, number][];
  length: number;
  /** half width of the drawn carriageway (m), nominal */
  halfRoad: number;
  /** priority rank at junctions: 2 = L 450 / Hauptstrasse, 1 = K 26 / Raiffeisenstrasse, 0 = village, -1 = track */
  rank: number;
  urban: boolean;
  carPruned: boolean;
  farmPruned: boolean;
  lanes: Lane[];
  /** free distance from the centre line to the nearest facade, right / left of a -> b, per point (max 8 m) */
  gapR: number[];
  gapL: number[];
  /** half width of the carriageway per point (urban kerb-measured, else halfRoad) */
  halfs: number[];
}

/** Stretch of an edge where both lanes overlap (narrow street, parked car): one direction at a time. */
export interface NarrowSeg {
  id: number;
  edge: TrafficEdge;
  /** direction (+1 a->b / -1 b->a) currently allowed in, 0 = free */
  owner: 0 | 1 | -1;
  /** cars holding it */
  holders: Set<number>;
}

export interface Lane extends PathGeom {
  id: number;
  edge: TrafficEdge;
  /** +1: a -> b, -1: b -> a */
  dir: 1 | -1;
  from: TrafficNode;
  to: TrafficNode;
  /** speed limit (m/s) per point */
  limit: Float32Array;
  /** lateral offset of this lane right of the centre line (m) per point */
  offset: Float32Array;
  /** half width of the drivable carriageway per point (m), measured from the centre line */
  halfRoad: Float32Array;
  next: Connector[];
  opposite: Lane | null;
  /** centre line in lane order (before trimming), for rebuilding after offset changes */
  centre: [number, number][];
  /** narrow stretches in lane arc length */
  narrow: { s0: number; s1: number; seg: NarrowSeg }[];
  /** arc length cut from the lane start by the junction setback */
  trimStart: number;
}

export type Turn = 'straight' | 'left' | 'right';

export interface Connector extends PathGeom {
  id: number;
  node: TrafficNode;
  from: Lane;
  to: Lane;
  turn: Turn;
  /** signed turn angle (rad, + = left) */
  angle: number;
  limit: number;
  conflicts: Set<Connector>;
  /** turn sharper than 160 degrees (only used when there is no other way on) */
  sharp: boolean;
  /** unit approach direction into the junction */
  dirX: number;
  dirZ: number;
}

export interface NetworkDeps {
  /** height of the raised Hauptstrasse kerb / sidewalk above the terrain (0 elsewhere) */
  surfaceLift: (x: number, z: number) => number;
  /** outlines that roads keep clear of (OSM footprints + landmark boxes): getGroundObstacles() */
  obstacles: [number, number][][];
  mapHalfM: number;
  isUrban: (x: number, z: number) => boolean;
}

const STEP_M = 2.5;
/** half of the widest car incl. mirrors + clearance to a wall */
const CAR_HALF_CLEAR = 1.0 + 0.3;

function classify(road: RoadRecord): RoadClass | null {
  const hw = (road.highway || '').toLowerCase();
  const surf = (road.surface || '').toLowerCase();
  if (hw === 'primary' || hw === 'primary_link' || hw === 'trunk' || hw === 'secondary' || hw === 'secondary_link') return 'highway';
  if (hw === 'tertiary' || hw === 'tertiary_link' || hw === 'unclassified' || hw === 'road') return 'lane';
  if (hw === 'residential' || hw === 'living_street') return 'village';
  if (hw === 'service') return 'service';
  if (hw === 'track') return surf === 'paved' || surf === 'asphalt' || surf === 'concrete' ? 'service' : 'track';
  return null;
}

function xz(p: [number, number] | [number, number, number]): [number, number] {
  return p.length === 3 ? [p[0], p[2]] : [p[0], p[1]];
}

function resample(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  return out;
}

export function makePath(xs: number[], zs: number[]): PathGeom {
  const n = xs.length;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  return { xs: Float64Array.from(xs), zs: Float64Array.from(zs), s, length: s[n - 1] };
}

/** Position + unit tangent at arc length `d` (clamped). Returns the segment index. */
export function samplePath(p: PathGeom, d: number, out: { x: number; z: number; tx: number; tz: number }): number {
  const n = p.xs.length;
  if (d <= 0) d = 0;
  if (d >= p.length) d = p.length;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.s[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = p.s[hi] - p.s[lo];
  const t = seg > 1e-9 ? (d - p.s[lo]) / seg : 0;
  out.x = p.xs[lo] + (p.xs[hi] - p.xs[lo]) * t;
  out.z = p.zs[lo] + (p.zs[hi] - p.zs[lo]) * t;
  const tx = p.xs[hi] - p.xs[lo];
  const tz = p.zs[hi] - p.zs[lo];
  const tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl;
  out.tz = tz / tl;
  return lo;
}

/** Segment grid of obstacle outlines for lateral ray casts. */
class SegmentGrid {
  private readonly cell = 12;
  private readonly grid = new Map<number, number[]>();
  private readonly segs: number[] = [];

  constructor(polys: [number, number][][]) {
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const idx = this.segs.length / 4;
        this.segs.push(a[0], a[1], b[0], b[1]);
        const gx0 = Math.floor(Math.min(a[0], b[0]) / this.cell);
        const gx1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
        const gz0 = Math.floor(Math.min(a[1], b[1]) / this.cell);
        const gz1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
        for (let gz = gz0; gz <= gz1; gz++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const k = (gx + 4096) * 8192 + (gz + 4096);
            let l = this.grid.get(k);
            if (!l) this.grid.set(k, (l = []));
            l.push(idx);
          }
        }
      }
    }
  }

  /** Distance along the ray (ox, oz) + t (dx, dz) to the first outline, up to maxT (returns maxT when free). */
  ray(ox: number, oz: number, dx: number, dz: number, maxT: number): number {
    let best = maxT;
    const ex = ox + dx * maxT;
    const ez = oz + dz * maxT;
    const gx0 = Math.floor(Math.min(ox, ex) / this.cell);
    const gx1 = Math.floor(Math.max(ox, ex) / this.cell);
    const gz0 = Math.floor(Math.min(oz, ez) / this.cell);
    const gz1 = Math.floor(Math.max(oz, ez) / this.cell);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const l = this.grid.get((gx + 4096) * 8192 + (gz + 4096));
        if (!l) continue;
        for (const idx of l) {
          const ax = this.segs[idx * 4];
          const az = this.segs[idx * 4 + 1];
          const bx = this.segs[idx * 4 + 2];
          const bz = this.segs[idx * 4 + 3];
          const sx = bx - ax;
          const sz = bz - az;
          const den = dx * sz - dz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((ax - ox) * sz - (az - oz) * sx) / den;
          const u = ((ax - ox) * dz - (az - oz) * dx) / den;
          if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
        }
      }
    }
    return best;
  }

  /** True when (x, z) lies within `r` of any outline. */
  near(x: number, z: number, r: number): boolean {
    const gx0 = Math.floor((x - r) / this.cell);
    const gx1 = Math.floor((x + r) / this.cell);
    const gz0 = Math.floor((z - r) / this.cell);
    const gz1 = Math.floor((z + r) / this.cell);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const l = this.grid.get((gx + 4096) * 8192 + (gz + 4096));
        if (!l) continue;
        for (const idx of l) {
          const ax = this.segs[idx * 4];
          const az = this.segs[idx * 4 + 1];
          const sx = this.segs[idx * 4 + 2] - ax;
          const sz = this.segs[idx * 4 + 3] - az;
          const ll = sx * sx + sz * sz;
          let t = ll > 1e-9 ? ((x - ax) * sx + (z - az) * sz) / ll : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ddx = ax + sx * t - x;
          const ddz = az + sz * t - z;
          if (ddx * ddx + ddz * ddz < r * r) return true;
        }
      }
    }
    return false;
  }
}

function pointInPoly(px: number, pz: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const zi = pts[i][1];
    const xj = pts[j][0];
    const zj = pts[j][1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function smooth(v: number[], r: number): number[] {
  return v.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(v.length - 1, Math.max(0, i + k));
      s += v[j];
      n++;
    }
    return s / n;
  });
}

function erodeMin(v: number[], r: number): number[] {
  return v.map((_, i) => {
    let m = Infinity;
    for (let k = -r; k <= r; k++) m = Math.min(m, v[Math.min(v.length - 1, Math.max(0, i + k))]);
    return m;
  });
}

export class TrafficNetwork {
  public readonly nodes: TrafficNode[] = [];
  public readonly edges: TrafficEdge[] = [];
  public readonly lanes: Lane[] = [];
  public readonly connectors: Connector[] = [];
  public readonly narrowSegs: NarrowSeg[] = [];
  public readonly obstacleGrid: SegmentGrid;
  private finalized = false;
  private readonly obstacles: [number, number][][];
  public stats = { edges: 0, carEdges: 0, prunedCarEdges: 0, lanes: 0, connectors: 0, kerbCentred: 0, narrowedSamples: 0, laneKm: 0, narrowSegs: 0 };

  constructor(roads: RoadRecord[], private readonly deps: NetworkDeps) {
    this.obstacles = deps.obstacles;
    this.obstacleGrid = new SegmentGrid(deps.obstacles);
    this.buildGraph(roads);
    this.prune();
    this.buildLanes();
  }

  /**
   * Second phase, after parked cars have narrowed lanes (setLaneOffsets): narrow stretches, junction setbacks,
   * connectors, conflicts, validation.
   */
  public finalize(): void {
    if (this.finalized) throw new Error('[traffic] TrafficNetwork.finalize() called twice');
    this.finalized = true;
    this.buildNarrow();
    this.buildConnectors();
    this.validate();
    this.stats.edges = this.edges.length;
    this.stats.carEdges = this.edges.filter((e) => e.cls !== 'track').length;
    this.stats.prunedCarEdges = this.edges.filter((e) => e.cls !== 'track' && e.carPruned).length;
    this.stats.lanes = this.lanes.length;
    this.stats.connectors = this.connectors.length;
    this.stats.laneKm = Math.round(this.lanes.reduce((a, l) => a + l.length, 0)) / 1000;
    if (this.stats.carEdges - this.stats.prunedCarEdges < 10) {
      throw new Error(`[traffic] lane graph has only ${this.stats.carEdges - this.stats.prunedCarEdges} usable car edges - road data or classification broken`);
    }
  }

  public insideObstacle(x: number, z: number): boolean {
    for (const poly of this.obstacles) {
      if (pointInPoly(x, z, poly)) return true;
    }
    return false;
  }

  public nearObstacle(x: number, z: number, r: number): boolean {
    return this.obstacleGrid.near(x, z, r);
  }

  // ------------------------------------------------------------------------------------------ graph
  private buildGraph(roads: RoadRecord[]): void {
    interface Way {
      road: RoadRecord;
      cls: RoadClass;
      pts: [number, number][];
    }
    const ways: Way[] = [];
    const keyCount = new Map<string, number>();
    const key = (p: [number, number]): string => `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)}`;
    for (const road of roads) {
      if (!road.points || road.points.length < 2) continue;
      const cls = classify(road);
      if (!cls) continue;
      const pts: [number, number][] = [];
      for (const raw of road.points) {
        const p = xz(raw as [number, number, number]);
        if (pts.length && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) < 0.05) continue;
        pts.push(p);
      }
      if (pts.length < 2) continue;
      ways.push({ road, cls, pts });
      const seen = new Set<string>();
      for (const p of pts) {
        const k = key(p);
        if (seen.has(k)) continue;
        seen.add(k);
        keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
      }
    }
    const nodeByKey = new Map<string, TrafficNode>();
    const nodeAt = (p: [number, number]): TrafficNode => {
      const k = key(p);
      let n = nodeByKey.get(k);
      if (!n) {
        const lim = this.deps.mapHalfM - 30;
        n = { id: this.nodes.length, x: p[0], z: p[1], edges: [], border: Math.abs(p[0]) > lim || Math.abs(p[1]) > lim, inLanes: [], connectors: [], carDegree: 0 };
        this.nodes.push(n);
        nodeByKey.set(k, n);
      }
      return n;
    };
    for (const w of ways) {
      let start = 0;
      for (let i = 1; i < w.pts.length; i++) {
        const isNode = i === w.pts.length - 1 || (keyCount.get(key(w.pts[i])) ?? 0) >= 2;
        if (!isNode) continue;
        const seg = w.pts.slice(start, i + 1);
        start = i;
        let len = 0;
        for (let k = 1; k < seg.length; k++) len += Math.hypot(seg[k][0] - seg[k - 1][0], seg[k][1] - seg[k - 1][1]);
        if (len < 0.5) continue;
        const a = nodeAt(seg[0]);
        const b = nodeAt(seg[seg.length - 1]);
        if (a === b) continue; // closed loop way without a junction: skip (none drivable in the data)
        const pts = resample(seg, STEP_M);
        const mid = pts[pts.length >> 1];
        const urban = this.deps.isUrban(mid[0], mid[1]);
        const w0 = w.road.widthM && w.road.widthM > 1 ? w.road.widthM : 0;
        let halfRoad: number;
        let rank: number;
        switch (w.cls) {
          case 'highway':
            halfRoad = urban ? 2.55 : Math.min(3.6, Math.max(2.6, (w0 || 7.2) * 0.5 - 0.45));
            rank = 2;
            break;
          case 'lane':
            halfRoad = Math.min(8, Math.max(4, w0 || 5.8)) * 0.5 - 0.2;
            rank = 1;
            break;
          case 'village':
            halfRoad = Math.min(7.5, Math.max(3.8, w0 || 5.0)) * 0.5;
            rank = 0;
            break;
          case 'service':
            halfRoad = Math.min(6, Math.max(2.4, w0 || 3.4)) * 0.5 - 0.1;
            rank = 0;
            break;
          default:
            halfRoad = Math.min(4, Math.max(2.6, w0 || 3.2)) * 0.5;
            rank = -1;
        }
        const e: TrafficEdge = {
          id: this.edges.length,
          a,
          b,
          cls: w.cls,
          name: w.road.name ?? w.road.ref ?? '',
          pts,
          length: len,
          halfRoad,
          rank,
          urban,
          carPruned: w.cls === 'track',
          farmPruned: false,
          lanes: [],
          gapR: [],
          gapL: [],
          halfs: [],
        };
        this.edges.push(e);
        a.edges.push(e);
        b.edges.push(e);
      }
    }
  }

  private prune(): void {
    // car network: drop dead-end chains (the map border is an exit)
    const carDeg = (n: TrafficNode): number => n.edges.filter((e) => !e.carPruned).length;
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of this.nodes) {
        if (n.border) continue;
        const live = n.edges.filter((e) => !e.carPruned);
        if (live.length === 1) {
          live[0].carPruned = true;
          changed = true;
        }
      }
    }
    for (const n of this.nodes) n.carDegree = carDeg(n);
    changed = true;
    while (changed) {
      changed = false;
      for (const n of this.nodes) {
        if (n.border) continue;
        const live = n.edges.filter((e) => !e.farmPruned);
        if (live.length === 1) {
          live[0].farmPruned = true;
          changed = true;
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------------ lanes
  /** Urban L 450: re-centre the line between the kerbs drawn by src/roads.ts. */
  private kerbCentre(pts: [number, number][]): { pts: [number, number][]; half: number[] } {
    const lift = this.deps.surfaceLift;
    const n = pts.length;
    const shifts: (number | null)[] = [];
    const halves: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const [tx, tz] = this.tangent(pts, i);
      const rx = -tz;
      const rz = tx;
      const [x, z] = pts[i];
      let dr: number | null = null;
      let dl: number | null = null;
      for (let d = 0.2; d <= 6.0; d += 0.1) {
        if (dr === null && lift(x + rx * d, z + rz * d) > 0.03) dr = d;
        if (dl === null && lift(x - rx * d, z - rz * d) > 0.03) dl = d;
        if (dr !== null && dl !== null) break;
      }
      if (dr !== null && dl !== null && dr + dl > 3.6 && dr + dl < 8.5) {
        shifts.push((dr - dl) / 2);
        halves.push((dr + dl) / 2);
        this.stats.kerbCentred++;
      } else {
        shifts.push(null);
        halves.push(null);
      }
    }
    // fill gaps (junction mouths, where the kerb drops) by linear interpolation
    const fill = (v: (number | null)[], dflt: number): number[] => {
      const out: number[] = new Array(v.length);
      let last = -1;
      for (let i = 0; i < v.length; i++) {
        if (v[i] === null) continue;
        if (last < 0) for (let k = 0; k < i; k++) out[k] = v[i]!;
        else for (let k = last + 1; k < i; k++) out[k] = v[last]! + ((v[i]! - v[last]!) * (k - last)) / (i - last);
        out[i] = v[i]!;
        last = i;
      }
      if (last < 0) return v.map(() => dflt);
      for (let k = last + 1; k < v.length; k++) out[k] = v[last]!;
      return out;
    };
    const sh = smooth(fill(shifts, 0), 2);
    const hv = smooth(fill(halves, 2.55), 2);
    const out: [number, number][] = pts.map((p, i) => {
      const [tx, tz] = this.tangent(pts, i);
      return [p[0] - tz * sh[i], p[1] + tx * sh[i]];
    });
    return { pts: out, half: hv };
  }

  private tangent(pts: [number, number][], i: number): [number, number] {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  private nominalOffset(e: TrafficEdge, half: number): number {
    switch (e.cls) {
      case 'highway':
        return e.urban ? half * 0.5 : Math.min(1.75, half * 0.5);
      case 'lane':
        return Math.min(1.5, half * 0.5);
      case 'village':
        return Math.min(1.35, half * 0.5);
      case 'service':
        return Math.max(0, half - 1.15);
      default:
        return 0;
    }
  }

  private buildLanes(): void {
    for (const e of this.edges) {
      let pts = e.pts;
      let halfs = pts.map(() => e.halfRoad);
      if (e.cls === 'highway' && e.urban) {
        const k = this.kerbCentre(pts);
        pts = k.pts;
        halfs = k.half;
        e.pts = pts;
      }
      e.halfs = halfs;
      // free width to the facades on both sides
      const gapR: number[] = [];
      const gapL: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [tx, tz] = this.tangent(pts, i);
        gapR.push(this.obstacleGrid.ray(pts[i][0], pts[i][1], -tz, tx, 8));
        gapL.push(this.obstacleGrid.ray(pts[i][0], pts[i][1], tz, -tx, 8));
      }
      e.gapR = gapR;
      e.gapL = gapL;
      if (e.carPruned && e.farmPruned) continue;
      const gR = erodeMin(gapR, 2);
      const gL = erodeMin(gapL, 2);
      for (const dir of [1, -1] as const) {
        const order = dir === 1 ? pts : [...pts].reverse();
        const half = dir === 1 ? halfs : [...halfs].reverse();
        const gapSide = dir === 1 ? gR : [...gL].reverse();
        const gapOther = dir === 1 ? gL : [...gR].reverse();
        const offs: number[] = [];
        const floors: number[] = [];
        for (let i = 0; i < order.length; i++) {
          const nominal = this.nominalOffset(e, half[i]);
          // a wall close on the right: the lane moves towards (or past) the centre line
          const room = gapSide[i] - CAR_HALF_CLEAR;
          if (room < nominal) this.stats.narrowedSamples++;
          offs.push(Math.min(nominal, room));
          floors.push(-(gapOther[i] - CAR_HALF_CLEAR));
        }
        const cap = smooth(erodeMin(offs, 2), 2);
        const floor = erodeMin(floors.map((f) => -f), 2).map((f) => -f);
        // both walls close: drive in the middle of the gap
        const off = cap.map((c, i) => (floor[i] <= c ? Math.max(c, floor[i]) : (c + floor[i]) / 2));
        const xs: number[] = [];
        const zs: number[] = [];
        for (let i = 0; i < order.length; i++) {
          const [tx, tz] = this.tangent(order, i);
          xs.push(order[i][0] - tz * off[i]);
          zs.push(order[i][1] + tx * off[i]);
        }
        const geom = makePath(xs, zs);
        const limit = new Float32Array(order.length);
        for (let i = 0; i < order.length; i++) limit[i] = this.speedLimit(e, order[i][0], order[i][1]);
        const lane: Lane = {
          ...geom,
          id: this.lanes.length,
          edge: e,
          dir,
          from: dir === 1 ? e.a : e.b,
          to: dir === 1 ? e.b : e.a,
          limit,
          offset: Float32Array.from(off),
          halfRoad: Float32Array.from(half),
          next: [],
          opposite: null,
          centre: order,
          narrow: [],
          trimStart: 0,
        };
        this.lanes.push(lane);
        e.lanes.push(lane);
        lane.to.inLanes.push(lane);
      }
      e.lanes[0].opposite = e.lanes[1];
      e.lanes[1].opposite = e.lanes[0];
    }
  }

  /**
   * Caps the lane offset (m right of the centre line) per point, e.g. to drive around parked cars, and rebuilds
   * the lane geometry. Only before finalize().
   */
  public capLaneOffsets(lane: Lane, cap: (i: number, x: number, z: number) => number): void {
    if (this.finalized) throw new Error('[traffic] capLaneOffsets() after finalize()');
    const c = lane.centre;
    const off = Array.from(lane.offset);
    let changed = false;
    for (let i = 0; i < c.length; i++) {
      const m = cap(i, c[i][0], c[i][1]);
      if (m < off[i]) {
        off[i] = m;
        changed = true;
      }
    }
    if (!changed) return;
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < c.length; i++) {
      const [tx, tz] = this.tangent(c, i);
      xs.push(c[i][0] - tz * off[i]);
      zs.push(c[i][1] + tx * off[i]);
    }
    const g = makePath(xs, zs);
    lane.xs = g.xs;
    lane.zs = g.zs;
    lane.s = g.s;
    lane.length = g.length;
    lane.offset = Float32Array.from(off);
  }

  /** Stretches where the two lanes of an edge come closer than two car widths: one direction at a time. */
  private buildNarrow(): void {
    const NEED = 2 * 0.95 + 0.3;
    for (const e of this.edges) {
      if (e.lanes.length !== 2) continue;
      const [la, lb] = e.lanes[0].dir === 1 ? [e.lanes[0], e.lanes[1]] : [e.lanes[1], e.lanes[0]];
      const n = la.offset.length;
      const narrow: boolean[] = [];
      for (let i = 0; i < n; i++) narrow.push(la.offset[i] + lb.offset[n - 1 - i] < NEED);
      // pad by 3 points (7.5 m) both sides
      const padded = narrow.map((_, i) => {
        for (let k = -3; k <= 3; k++) if (narrow[Math.min(n - 1, Math.max(0, i + k))]) return true;
        return false;
      });
      // stretches less than 60 m apart become one: queues in a short gap could otherwise block both ends
      let lastEnd = -1;
      for (let k = 0; k < n; k++) {
        if (!padded[k]) continue;
        if (lastEnd >= 0 && k - lastEnd > 1 && (k - lastEnd) * STEP_M < 60) for (let q = lastEnd + 1; q < k; q++) padded[q] = true;
        lastEnd = k;
      }
      let i = 0;
      while (i < n) {
        if (!padded[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < n && padded[j + 1]) j++;
        const seg: NarrowSeg = { id: this.narrowSegs.length, edge: e, owner: 0, holders: new Set() };
        this.narrowSegs.push(seg);
        la.narrow.push({ s0: la.s[i], s1: la.s[j], seg });
        lb.narrow.push({ s0: lb.s[n - 1 - j], s1: lb.s[n - 1 - i], seg });
        i = j + 1;
      }
      lb.narrow.sort((p, q) => p.s0 - q.s0);
    }
    this.stats.narrowSegs = this.narrowSegs.length;
  }

  private validate(): void {
    const bad: string[] = [];
    for (const l of this.lanes) {
      if (l.to.border) continue;
      const carLane = !l.edge.carPruned;
      const ok = l.next.some((c) => (carLane ? !c.to.edge.carPruned : !c.to.edge.farmPruned));
      if (!ok) bad.push(`lane ${l.id} (${l.edge.cls} "${l.edge.name}") ends at node ${l.to.id} (${l.to.x.toFixed(1)}, ${l.to.z.toFixed(1)}) with no way on`);
    }
    if (bad.length) throw new Error(`[traffic] lane graph has ${bad.length} dead lane end(s):\n${bad.slice(0, 12).join('\n')}`);
  }

  /** Speed limits (m/s): 30 in the village streets, 50 on the through road in the village, 70-100 outside. */
  private speedLimit(e: TrafficEdge, x: number, z: number): number {
    const urban = this.deps.isUrban(x, z);
    switch (e.cls) {
      case 'highway':
        return (urban ? 50 : 100) / 3.6;
      case 'lane':
        return (urban ? 50 : 80) / 3.6;
      case 'village':
        return 30 / 3.6;
      case 'service':
        return 20 / 3.6;
      default:
        return 25 / 3.6;
    }
  }

  // ------------------------------------------------------------------------------------------ junctions
  private setback(node: TrafficNode, e: TrafficEdge): number {
    const others = node.edges.filter((o) => o !== e && !(o.carPruned && o.farmPruned));
    if (others.length === 0) return 0.5;
    if (others.length === 1) {
      // a plain continuation (way split) or a bend: small gap, the connector rounds the corner
      const o = others[0];
      const da = this.edgeDirAt(e, node);
      const db = this.edgeDirAt(o, node);
      const cos = -(da[0] * db[0] + da[1] * db[1]);
      return cos > 0.85 ? 1.0 : Math.max(e.halfRoad, o.halfRoad) + 1.0;
    }
    // stop far enough back that a waiting car stays clear of every other road's carriageway; acute junctions
    // need more room (distance along e at which the other road's edge is passed)
    const de = this.edgeDirAt(e, node);
    let s = 0;
    for (const o of others) {
      const extra = o.cls === 'highway' && o.urban ? 1.6 : 0.6;
      const dOther = this.edgeDirAt(o, node);
      const sin = Math.abs(de[0] * dOther[1] - de[1] * dOther[0]);
      s = Math.max(s, (o.halfRoad + extra) / Math.max(sin, 0.4));
    }
    return s + 1.2;
  }

  /** Unit direction of edge e leaving node n. */
  private edgeDirAt(e: TrafficEdge, n: TrafficNode): [number, number] {
    const pts = e.pts;
    const fromA = e.a === n;
    const p0 = fromA ? pts[0] : pts[pts.length - 1];
    let p1 = p0;
    for (let i = 1; i < pts.length; i++) {
      p1 = fromA ? pts[i] : pts[pts.length - 1 - i];
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 6) break;
    }
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  /** Trims a lane at both ends (junction setbacks) in place. */
  private trimLane(l: Lane, s0: number, s1: number): void {
    const len = l.length;
    if (s0 + s1 > len - 1) {
      const k = Math.max(0, (len - 1) / Math.max(s0 + s1, 1e-3));
      s0 *= k;
      s1 *= k;
    }
    const keepXs: number[] = [];
    const keepZs: number[] = [];
    const keepLim: number[] = [];
    const keepOff: number[] = [];
    const keepHalf: number[] = [];
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    const push = (d: number) => {
      const i = samplePath(l, d, tmp);
      keepXs.push(tmp.x);
      keepZs.push(tmp.z);
      keepLim.push(l.limit[i]);
      keepOff.push(l.offset[i]);
      keepHalf.push(l.halfRoad[i]);
    };
    push(s0);
    for (let i = 0; i < l.xs.length; i++) {
      if (l.s[i] > s0 + 0.3 && l.s[i] < len - s1 - 0.3) {
        keepXs.push(l.xs[i]);
        keepZs.push(l.zs[i]);
        keepLim.push(l.limit[i]);
        keepOff.push(l.offset[i]);
        keepHalf.push(l.halfRoad[i]);
      }
    }
    push(len - s1);
    const g = makePath(keepXs, keepZs);
    l.xs = g.xs;
    l.zs = g.zs;
    l.s = g.s;
    l.length = g.length;
    l.limit = Float32Array.from(keepLim);
    l.offset = Float32Array.from(keepOff);
    l.halfRoad = Float32Array.from(keepHalf);
    l.trimStart = s0;
    for (const nw of l.narrow) {
      nw.s0 = Math.max(0, nw.s0 - s0);
      nw.s1 = Math.min(l.length, nw.s1 - s0);
    }
    l.narrow = l.narrow.filter((nw) => nw.s1 > nw.s0 + 0.5);
  }

  private buildConnectors(): void {
    for (const l of this.lanes) {
      this.trimLane(l, this.setback(l.from, l.edge), this.setback(l.to, l.edge));
    }
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    for (const node of this.nodes) {
      const ins = node.inLanes;
      const outs = this.lanes.filter((l) => l.from === node);
      for (const a of ins) {
        samplePath(a, a.length, tmp);
        const p0x = tmp.x;
        const p0z = tmp.z;
        const d0x = tmp.tx;
        const d0z = tmp.tz;
        for (const b of outs) {
          if (b.edge === a.edge) continue; // no U-turns
          samplePath(b, 0, tmp);
          const p3x = tmp.x;
          const p3z = tmp.z;
          const d1x = tmp.tx;
          const d1z = tmp.tz;
          const angle = Math.atan2(d0x * d1z - d0z * d1x, d0x * d1x + d0z * d1z);
          // atan2(cross, dot) with +X east / +Z south: positive cross = clockwise seen from above = RIGHT turn
          const signed = -angle; // + = left
          const sharp = Math.abs(signed) > (160 * Math.PI) / 180;
          const dist = Math.hypot(p3x - p0x, p3z - p0z);
          const k = Math.max(0.5, dist * 0.42);
          const p1x = p0x + d0x * k;
          const p1z = p0z + d0z * k;
          const p2x = p3x - d1x * k;
          const p2z = p3z - d1z * k;
          const n = Math.max(4, Math.ceil(dist / 1.2));
          const xs: number[] = [];
          const zs: number[] = [];
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const u = 1 - t;
            xs.push(u * u * u * p0x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x);
            zs.push(u * u * u * p0z + 3 * u * u * t * p1z + 3 * u * t * t * p2z + t * t * t * p3z);
          }
          const geom = makePath(xs, zs);
          // curvature speed limit (lateral 2.2 m/s^2)
          let maxK = 0;
          for (let i = 1; i < xs.length - 1; i++) {
            const ax = xs[i] - xs[i - 1];
            const az = zs[i] - zs[i - 1];
            const bx = xs[i + 1] - xs[i];
            const bz = zs[i + 1] - zs[i];
            const la = Math.hypot(ax, az);
            const lb = Math.hypot(bx, bz);
            if (la < 1e-6 || lb < 1e-6) continue;
            const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
            maxK = Math.max(maxK, turn / ((la + lb) / 2));
          }
          const curveLimit = maxK > 1e-4 ? Math.sqrt(2.2 / maxK) : 99;
          const roadLimit = Math.min(a.limit[a.limit.length - 1], b.limit[0]);
          const turn: Turn = Math.abs(signed) < (35 * Math.PI) / 180 ? 'straight' : signed > 0 ? 'left' : 'right';
          const c: Connector = {
            ...geom,
            id: this.connectors.length,
            node,
            from: a,
            to: b,
            turn,
            angle: signed,
            limit: Math.max(2.5, Math.min(roadLimit, curveLimit, turn === 'straight' ? 99 : 7.5)),
            conflicts: new Set(),
            sharp,
            dirX: d0x,
            dirZ: d0z,
          };
          this.connectors.push(c);
          a.next.push(c);
          node.connectors.push(c);
        }
      }
      // conflicts: paths that cross / come closer than 2.2 m, or merge into the same lane
      const cs = node.connectors;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          const A = cs[i];
          const B = cs[j];
          if (A.from === B.from) continue; // same queue: car following handles it
          let conflict = A.to === B.to;
          if (!conflict) {
            outer: for (let p = 0; p < A.xs.length; p++) {
              for (let q = 0; q < B.xs.length; q++) {
                const dx = A.xs[p] - B.xs[q];
                const dz = A.zs[p] - B.zs[q];
                if (dx * dx + dz * dz < 2.2 * 2.2) {
                  conflict = true;
                  break outer;
                }
              }
            }
          }
          if (conflict) {
            A.conflicts.add(B);
            B.conflicts.add(A);
          }
        }
      }
    }
  }
}
