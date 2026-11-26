/**
 * NPC pedestrians - the walk graph.
 *
 * Built once at load from the same OSM roads the road renderer uses:
 *  - Hauptstraße: the raised sidewalks, found by scanning `roadGroup.userData.getSurfaceLift` across the street
 *    (so they match the rendered kerbs exactly), bridged over side-street mouths;
 *  - other village streets, lanes and service roads (no sidewalks): one walking line at each road edge;
 *  - footways, paths, steps: their centre line; field tracks (vineyards) near the village: centre line, `field`;
 *  - crossings: across village streets every ~35 m and at junctions, across the Hauptstraße at fixed spacing,
 *    at side-street mouths and at the church / Rathaus; every edge that cuts a carriageway is a crossing;
 *  - destinations: house doors, the church and Rathaus doors, a bakery door, the playground, the pitch rails,
 *    the vineyard edges; gathering spots for chatting groups on the church square / in front of the Rathaus.
 * Every node and connector is checked against the building / landmark / recreation colliders and the ditches;
 * only the largest connected component is kept.
 */
import { queryActors, type ActorBody } from './actors';
import type { BuildingCollider, CollisionHit } from './collision';
import type { BuildingRecord, LanduseRecord, RoadRecord, WaterwayRecord } from './types';

const dynScratch: ActorBody[] = [];
const dynMuted: ActorBody[] = [];
/**
 * The static world only (buildings, landmark solids, recreation polygons, map edge). Since the NPC traffic hook
 * (BuildingCollider.setDynamicSolidKinds) makes car / pedestrian bodies solid inside resolveCircle(), the
 * pedestrians mute those bodies for the duration of their own wall queries - they handle each other and the
 * vehicles themselves (src/pedestrians.ts), and a walk-graph node must never move because a car was parked there.
 */
export function resolveStatic(collider: BuildingCollider, x: number, z: number, r: number): CollisionHit {
  queryActors(x, z, r + 0.6, dynScratch);
  dynMuted.length = 0;
  for (const b of dynScratch) {
    if (b.kind === 'car' || b.kind === 'pedestrian') {
      b.active = false;
      dynMuted.push(b);
    }
  }
  try {
    return collider.resolveCircle(x, z, r);
  } finally {
    for (const b of dynMuted) b.active = true;
  }
}

export type EdgeKind = 'sidewalk' | 'roadside' | 'path' | 'track' | 'link';

export interface WalkNode {
  x: number;
  z: number;
  /** field track / vineyard edge: nobody walks here at night */
  field: boolean;
  /** unit vector pointing away from the carriageway (0, 0 where there is none) - where to step aside */
  awayX: number;
  awayZ: number;
  /** how far one may step towards `away` (m) */
  room: number;
  edges: number[];
}

export interface WalkEdge {
  a: number;
  b: number;
  len: number;
  kind: EdgeKind;
  /** cuts through a carriageway: only walked when the lane is clear */
  crossing: boolean;
  field: boolean;
  /** lateral freedom (m) either side of the edge line, for passing other walkers */
  lat: number;
}

export type DestinationKind = 'door' | 'church' | 'rathaus' | 'bakery' | 'playground' | 'pitch' | 'vineyard';

export interface Destination {
  id: string;
  kind: DestinationKind;
  node: number;
  /** heading to face while dwelling there (tractor convention: forward = (sin h, cos h)) */
  facing: number;
}

export interface GatherSpot {
  id: string;
  x: number;
  z: number;
  node: number;
  label: string;
}

export interface WalkGraphInput {
  roads: RoadRecord[];
  buildings: BuildingRecord[];
  landuse: LanduseRecord[];
  waterways: WaterwayRecord[];
  collider: BuildingCollider;
  surfaceLift: (x: number, z: number) => number;
}

// ---- constants shared with src/roads.ts (kept in sync by hand; see classifyRoadBase / isInsideUrbanVillage) ----
const URBAN_BOX = { x0: -475, x1: 515, z0: -265, z1: 185 };
const isInsideUrbanVillage = (x: number, z: number): boolean =>
  x >= URBAN_BOX.x0 && x <= URBAN_BOX.x1 && z >= URBAN_BOX.z0 && z <= URBAN_BOX.z1;

type RoadBase = 'highway' | 'lane' | 'village' | 'service' | 'track' | 'path';
function classifyRoadBase(road: RoadRecord): RoadBase | null {
  const hw = (road.highway || '').toLowerCase();
  const surf = (road.surface || '').toLowerCase();
  if (hw === 'primary' || hw === 'primary_link' || hw === 'trunk' || hw === 'secondary' || hw === 'secondary_link') return 'highway';
  if (hw === 'tertiary' || hw === 'tertiary_link' || hw === 'unclassified' || hw === 'road') return 'lane';
  if (hw === 'residential' || hw === 'living_street') return 'village';
  if (hw === 'service') return 'service';
  if (hw === 'track') return surf === 'paved' || surf === 'asphalt' || surf === 'concrete' ? 'service' : 'track';
  if (hw === 'path' || hw === 'cycleway' || hw === 'footway' || hw === 'bridleway' || hw === 'steps' || hw === 'pedestrian') return 'path';
  return null;
}

/** Where walking lines are generated: the village plus a margin for the field tracks and the sports ground. */
const REGION = { x0: URBAN_BOX.x0 - 260, x1: URBAN_BOX.x1 + 260, z0: URBAN_BOX.z0 - 220, z1: URBAN_BOX.z1 + 200 };
const STREET_REGION_MARGIN = 90;
const STEP_M = 2.5;
const BODY_R = 0.32;

// Recreation sites (src/recreation.ts constants: PITCH_CX/CZ/ROT, the playground site centre).
const PITCH = { cx: 56.5, cz: -314.5, rot: 0.376 };
const PLAYGROUND = { x: 74.0, z: -245.0 };
const CHURCH_ID = 'way/734605159';
const RATHAUS_ID = 'way/889544793';
const MEMORIAL = { x: -34.41, z: -59.77 };

type P2 = [number, number];

function extractXZ(pt: [number, number] | [number, number, number]): P2 {
  return pt.length === 3 ? [pt[0], pt[2]] : [pt[0], pt[1]];
}

function resample(pts: P2[], step: number): P2[] {
  if (pts.length < 2) return pts.slice();
  const out: P2[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= n; s++) out.push([x0 + ((x1 - x0) * s) / n, z0 + ((z1 - z0) * s) / n]);
  }
  return out;
}

function tangents(pts: P2[]): P2[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  });
}

function segIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1x = bx - ax;
  const d1z = bz - az;
  const d2x = dx - cx;
  const d2z = dz - cz;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
  const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

function distToSegSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const l = abx * abx + abz * abz;
  let t = l > 1e-12 ? ((px - ax) * abx + (pz - az) * abz) / l : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return dx * dx + dz * dz;
}

/** Segments in a uniform grid (carriageway centre lines, ditches). */
class SegmentGrid {
  private readonly cell: number;
  private readonly cells = new Map<number, number[]>();
  /** ax, az, bx, bz, halfWidth, owner */
  public readonly data: number[] = [];

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(gx: number, gz: number): number {
    return (gx + 4096) * 8192 + (gz + 4096);
  }

  public add(ax: number, az: number, bx: number, bz: number, halfWidth: number, owner: number): void {
    const id = this.data.length / 6;
    this.data.push(ax, az, bx, bz, halfWidth, owner);
    const pad = halfWidth + 1;
    const gx0 = Math.floor((Math.min(ax, bx) - pad) / this.cell);
    const gx1 = Math.floor((Math.max(ax, bx) + pad) / this.cell);
    const gz0 = Math.floor((Math.min(az, bz) - pad) / this.cell);
    const gz1 = Math.floor((Math.max(az, bz) + pad) / this.cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const k = this.key(gx, gz);
        let l = this.cells.get(k);
        if (!l) {
          l = [];
          this.cells.set(k, l);
        }
        l.push(id);
      }
    }
  }

  public addPolyline(pts: P2[], halfWidth: number, owner: number): void {
    for (let i = 0; i < pts.length - 1; i++) this.add(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], halfWidth, owner);
  }

  /** Owner of a segment whose band (distance < halfWidth + pad) contains (x, z), excluding `exclude`; -1 if none. */
  public inside(x: number, z: number, pad: number, exclude: number): number {
    const l = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!l) return -1;
    for (const id of l) {
      const o = id * 6;
      if (this.data[o + 5] === exclude) continue;
      const hw = this.data[o + 4] + pad;
      if (distToSegSq(x, z, this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]) < hw * hw) return this.data[o + 5];
    }
    return -1;
  }

  /** Whether segment a-b crosses any centre line (other than owner `exclude`). */
  public crosses(ax: number, az: number, bx: number, bz: number, exclude = -1): boolean {
    const seen = new Set<number>();
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (this.cell * 0.5)));
    for (let s = 0; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n;
      const z = az + ((bz - az) * s) / n;
      const l = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
      if (!l) continue;
      for (const id of l) {
        if (seen.has(id)) continue;
        seen.add(id);
        const o = id * 6;
        if (this.data[o + 5] === exclude) continue;
        if (segIntersect(ax, az, bx, bz, this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3])) return true;
      }
    }
    return false;
  }
}

/** Uniform grid of node indices for nearest-node queries. */
class NodeGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly cell: number) {}
  private key(gx: number, gz: number): number {
    return (gx + 4096) * 8192 + (gz + 4096);
  }
  public add(i: number, x: number, z: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let l = this.cells.get(k);
    if (!l) {
      l = [];
      this.cells.set(k, l);
    }
    l.push(i);
  }
  public query(x: number, z: number, r: number, out: number[]): number[] {
    out.length = 0;
    const gx0 = Math.floor((x - r) / this.cell);
    const gx1 = Math.floor((x + r) / this.cell);
    const gz0 = Math.floor((z - r) / this.cell);
    const gz1 = Math.floor((z + r) / this.cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const l = this.cells.get(this.key(gx, gz));
        if (l) for (const i of l) out.push(i);
      }
    }
    return out;
  }
}

interface ChainPoint {
  x: number;
  z: number;
  awayX: number;
  awayZ: number;
  room: number;
}

interface Chain {
  pts: ChainPoint[];
  kind: EdgeKind;
  field: boolean;
  lat: number;
  road: number;
  /** pairs of chains on both sides of one street get crossings between them */
  pairKey: string | null;
}

export class WalkGraph {
  public readonly nodes: WalkNode[] = [];
  public readonly edges: WalkEdge[] = [];
  public readonly destinations: Destination[] = [];
  public readonly spots: GatherSpot[] = [];
  public readonly stats: Record<string, number> = {};
  private grid = new NodeGrid(10);
  private readonly tmp: number[] = [];

  public addNode(x: number, z: number, field: boolean, awayX = 0, awayZ = 0, room = 0): number {
    const i = this.nodes.length;
    this.nodes.push({ x, z, field, awayX, awayZ, room, edges: [] });
    this.grid.add(i, x, z);
    return i;
  }

  public addEdge(a: number, b: number, kind: EdgeKind, crossing: boolean, field: boolean, lat: number): number {
    if (a === b) throw new Error('[pedestrians] walk graph: self edge');
    const na = this.nodes[a];
    const nb = this.nodes[b];
    for (const e of na.edges) {
      const ed = this.edges[e];
      if ((ed.a === a && ed.b === b) || (ed.a === b && ed.b === a)) return e;
    }
    const id = this.edges.length;
    this.edges.push({ a, b, len: Math.max(0.05, Math.hypot(nb.x - na.x, nb.z - na.z)), kind, crossing, field, lat });
    na.edges.push(id);
    nb.edges.push(id);
    return id;
  }

  public other(edge: number, node: number): number {
    const e = this.edges[edge];
    return e.a === node ? e.b : e.a;
  }

  /** Nearest node within maxDist (or -1). `filter` may reject nodes. */
  public nearestNode(x: number, z: number, maxDist: number, filter?: (i: number) => boolean): number {
    let best = -1;
    let bestD = maxDist * maxDist;
    for (const i of this.grid.query(x, z, maxDist, this.tmp)) {
      const n = this.nodes[i];
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD && (!filter || filter(i))) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  public nodesNear(x: number, z: number, r: number, out: number[]): number[] {
    this.grid.query(x, z, r, out);
    let w = 0;
    for (let k = 0; k < out.length; k++) {
      const n = this.nodes[out[k]];
      if ((n.x - x) ** 2 + (n.z - z) ** 2 <= r * r) out[w++] = out[k];
    }
    out.length = w;
    return out;
  }

  /**
   * A* over the graph. Crossings cost extra (people prefer to stay on their side), field edges are closed at night.
   * Returns node ids from `from` to `to` (inclusive) or null when unreachable within `maxExpand` nodes.
   */
  /** A* over the walk graph; `avoid` = edge ids that are temporarily impassable for this walker. */
  public findPath(from: number, to: number, night: boolean, maxExpand = 6000, avoid?: ReadonlySet<number>): number[] | null {
    if (from === to) return [from];
    const tn = this.nodes[to];
    if (night && tn.field) return null;
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const open = new MinHeap();
    g.set(from, 0);
    open.push(from, Math.hypot(this.nodes[from].x - tn.x, this.nodes[from].z - tn.z));
    let expanded = 0;
    while (open.size > 0) {
      const cur = open.pop();
      if (cur === to) {
        const path = [cur];
        let c = cur;
        while (came.has(c)) {
          c = came.get(c)!;
          path.push(c);
        }
        return path.reverse();
      }
      if (++expanded > maxExpand) return null;
      const gc = g.get(cur)!;
      for (const eid of this.nodes[cur].edges) {
        const e = this.edges[eid];
        if (night && e.field) continue;
        if (avoid && avoid.has(eid)) continue;
        const nb = e.a === cur ? e.b : e.a;
        const cost = gc + e.len * (e.crossing ? 1.6 : 1) + (e.crossing ? 6 : 0);
        const prev = g.get(nb);
        if (prev !== undefined && prev <= cost) continue;
        g.set(nb, cost);
        came.set(nb, cur);
        const n = this.nodes[nb];
        open.push(nb, cost + Math.hypot(n.x - tn.x, n.z - tn.z));
      }
    }
    return null;
  }

  public edgeBetween(a: number, b: number): number {
    for (const e of this.nodes[a].edges) {
      const ed = this.edges[e];
      if ((ed.a === a && ed.b === b) || (ed.a === b && ed.b === a)) return e;
    }
    return -1;
  }

  /** Keeps only the largest connected component; rebuilds indices. */
  public keepLargestComponent(): void {
    const comp = new Int32Array(this.nodes.length).fill(-1);
    const sizes: number[] = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (comp[s] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [s];
      comp[s] = id;
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        for (const e of this.nodes[c].edges) {
          const o = this.other(e, c);
          if (comp[o] < 0) {
            comp[o] = id;
            stack.push(o);
          }
        }
      }
      sizes.push(size);
    }
    let best = 0;
    sizes.forEach((sz, i) => {
      if (sz > sizes[best]) best = i;
    });
    const remap = new Int32Array(this.nodes.length).fill(-1);
    const nodes: WalkNode[] = [];
    this.nodes.forEach((n, i) => {
      if (comp[i] !== best) return;
      remap[i] = nodes.length;
      nodes.push({ ...n, edges: [] });
    });
    const edges: WalkEdge[] = [];
    for (const e of this.edges) {
      const a = remap[e.a];
      const b = remap[e.b];
      if (a < 0 || b < 0) continue;
      const id = edges.length;
      edges.push({ ...e, a, b });
      nodes[a].edges.push(id);
      nodes[b].edges.push(id);
    }
    this.stats.droppedComponents = sizes.length - 1;
    this.stats.droppedNodes = this.nodes.length - nodes.length;
    this.nodes.length = 0;
    this.nodes.push(...nodes);
    this.edges.length = 0;
    this.edges.push(...edges);
    this.grid = new NodeGrid(10);
    this.nodes.forEach((n, i) => this.grid.add(i, n.x, n.z));
    const keepDest = this.destinations.filter((d) => remap[d.node] >= 0).map((d) => ({ ...d, node: remap[d.node] }));
    this.stats.droppedDestinations = this.destinations.length - keepDest.length;
    this.destinations.length = 0;
    this.destinations.push(...keepDest);
    const keepSpots = this.spots.filter((s) => remap[s.node] >= 0).map((s) => ({ ...s, node: remap[s.node] }));
    this.spots.length = 0;
    this.spots.push(...keepSpots);
  }
}

class MinHeap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];
  public get size(): number {
    return this.ids.length;
  }
  public push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  public pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------------------------------------------

export function buildWalkGraph(input: WalkGraphInput): WalkGraph {
  const { roads, collider, surfaceLift } = input;
  const graph = new WalkGraph();
  const inRegion = (x: number, z: number, margin = 0): boolean =>
    x >= REGION.x0 - margin && x <= REGION.x1 + margin && z >= REGION.z0 - margin && z <= REGION.z1 + margin;
  const inStreetRegion = (x: number, z: number): boolean =>
    x >= URBAN_BOX.x0 - STREET_REGION_MARGIN &&
    x <= URBAN_BOX.x1 + STREET_REGION_MARGIN &&
    z >= URBAN_BOX.z0 - STREET_REGION_MARGIN &&
    z <= URBAN_BOX.z1 + STREET_REGION_MARGIN;

  // ---- carriageways (cars drive there) and ditches -----------------------------------------------------------
  interface Prep {
    road: RoadRecord;
    base: RoadBase;
    pts: P2[];
    hw: number;
    idx: number;
  }
  const prepared: Prep[] = [];
  const carriage = new SegmentGrid(12);
  roads.forEach((road) => {
    if (!road.points || road.points.length < 2) return;
    const base = classifyRoadBase(road);
    if (!base) return;
    const pts = resample(road.points.map(extractXZ), 2.0);
    if (pts.length < 2) return;
    const fallback = base === 'highway' ? 7.2 : base === 'lane' ? 5.8 : base === 'village' ? 5.0 : base === 'service' ? 3.4 : base === 'track' ? 3.2 : 1.8;
    const w = road.widthM && road.widthM > 1 ? road.widthM : fallback;
    let hw: number;
    if (base === 'highway') hw = 3.2;
    else if (base === 'village') hw = Math.min(Math.max(w, 3.8), 7.5) * 0.5;
    else if (base === 'lane') hw = Math.min(Math.max(w, 4), 8) * 0.5 - 0.2;
    else if (base === 'service') hw = Math.min(Math.max(w, 2.4), 6) * 0.5 - 0.1;
    else if (base === 'track') hw = Math.min(Math.max(w, 2.6), 4) * 0.5;
    else hw = Math.min(w, 2.1) * 0.5;
    const idx = prepared.length;
    prepared.push({ road, base, pts, hw, idx });
    if (base === 'highway' || base === 'lane' || base === 'village' || base === 'service') carriage.addPolyline(pts, hw, idx);
  });
  const ditches = new SegmentGrid(12);
  for (const w of input.waterways) {
    if (!w.points || w.points.length < 2) continue;
    const pts = w.points.map(extractXZ);
    ditches.addPolyline(pts, (w.widthM ?? 1.4) * 0.5, -2);
  }

  const blocked = (x: number, z: number, r: number): boolean => resolveStatic(collider, x, z, r).hit;
  const wet = (x: number, z: number): boolean => ditches.inside(x, z, 0.35, -99) !== -1;
  /** Validates a chain point: pushes it out of a wall if the push is small. Returns null when unusable. */
  const settle = (x: number, z: number, maxPush: number): P2 | null => {
    const hit = resolveStatic(collider, x, z, BODY_R);
    let px = x;
    let pz = z;
    if (hit.hit) {
      if (Math.hypot(hit.pushX, hit.pushZ) > maxPush) return null;
      px += hit.pushX;
      pz += hit.pushZ;
      if (blocked(px, pz, BODY_R - 0.02)) return null;
    }
    if (wet(px, pz)) return null;
    return [px, pz];
  };
  const clearLine = (ax: number, az: number, bx: number, bz: number, r = BODY_R - 0.06): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
    for (let s = 0; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n;
      const z = az + ((bz - az) * s) / n;
      if (blocked(x, z, r) || wet(x, z)) return false;
    }
    return true;
  };

  const chains: Chain[] = [];
  /** Splits a list of (possibly null) points into chains of >= 2 consecutive valid points. */
  const pushChains = (pts: (ChainPoint | null)[], base: Omit<Chain, 'pts'>): void => {
    let cur: ChainPoint[] = [];
    const flush = (): void => {
      if (cur.length >= 2) chains.push({ ...base, pts: cur });
      cur = [];
    };
    for (const p of pts) {
      if (!p) {
        flush();
        continue;
      }
      if (cur.length > 0) {
        const q = cur[cur.length - 1];
        if (Math.hypot(p.x - q.x, p.z - q.z) > STEP_M * 2.2 || !clearLine(q.x, q.z, p.x, p.z)) {
          flush();
        }
      }
      cur.push(p);
    }
    flush();
  };

  let sidewalkSamples = 0;
  let sidewalkBridged = 0;
  for (const pr of prepared) {
    const { base, idx } = pr;
    if (base === 'highway') {
      // ---- Hauptstraße sidewalks: where the rendered kerb is raised ----
      const pts = resample(pr.pts, STEP_M);
      const tans = tangents(pts);
      const sides: ({ off: number; width: number } | null)[][] = [[], []];
      pts.forEach(([x, z], i) => {
        if (!isInsideUrbanVillage(x, z)) {
          sides[0].push(null);
          sides[1].push(null);
          return;
        }
        const [tx, tz] = tans[i];
        const nx = -tz;
        const nz = tx;
        const lifted: boolean[] = [];
        const offs: number[] = [];
        for (let o = -9; o <= 9.0001; o += 0.1) {
          offs.push(o);
          lifted.push(surfaceLift(x + nx * o, z + nz * o) > 0.02);
        }
        // the carriageway: the unlifted run that contains (or is nearest to) the centre line
        const c0 = Math.round(9 / 0.1);
        let lo = c0;
        let hi = c0;
        if (lifted[c0]) {
          sides[0].push(null);
          sides[1].push(null);
          return;
        }
        while (lo > 0 && !lifted[lo - 1]) lo--;
        while (hi < offs.length - 1 && !lifted[hi + 1]) hi++;
        const band = (from: number, dir: number): { off: number; width: number } | null => {
          let a = from + dir;
          if (a < 0 || a >= offs.length || !lifted[a]) return null;
          let b = a;
          while (b + dir >= 0 && b + dir < offs.length && lifted[b + dir]) b += dir;
          const o0 = offs[a];
          const o1 = offs[b];
          return { off: (o0 + o1) * 0.5, width: Math.abs(o1 - o0) + 0.1 };
        };
        sides[0].push(band(lo, -1));
        sides[1].push(band(hi, 1));
        sidewalkSamples++;
      });
      for (let k = 0; k < 2; k++) {
        const s = sides[k];
        // bridge side-street mouths (the kerb drops there): interpolate gaps of up to 26 m between sidewalk samples
        let i = 0;
        while (i < s.length) {
          if (s[i] !== null) {
            i++;
            continue;
          }
          let j = i;
          while (j < s.length && s[j] === null) j++;
          const prev = i > 0 ? s[i - 1] : null;
          const next = j < s.length ? s[j] : null;
          if (prev && next && (j - i) * STEP_M <= 26 && isInsideUrbanVillage(pts[i][0], pts[i][1])) {
            for (let m = i; m < j; m++) {
              const t = (m - i + 1) / (j - i + 1);
              s[m] = { off: prev.off + (next.off - prev.off) * t, width: Math.min(prev.width, next.width) };
              sidewalkBridged++;
            }
          }
          i = j;
        }
        const chainPts: (ChainPoint | null)[] = pts.map(([x, z], m) => {
          const b = s[m];
          if (!b) return null;
          const [tx, tz] = tans[m];
          const nx = -tz;
          const nz = tx;
          const px = x + nx * b.off;
          const pz = z + nz * b.off;
          const settled = settle(px, pz, 0.45);
          if (!settled) return null;
          const sgn = b.off < 0 ? -1 : 1;
          return { x: settled[0], z: settled[1], awayX: nx * sgn, awayZ: nz * sgn, room: Math.max(0, b.width * 0.5 - 0.3) };
        });
        pushChains(chainPts, {
          kind: 'sidewalk',
          field: false,
          lat: 0.35,
          road: idx,
          pairKey: `hw${idx}`,
        });
      }
      continue;
    }
    if (base === 'lane' || base === 'village' || base === 'service') {
      const pts = resample(pr.pts, STEP_M);
      if (!pts.some(([x, z]) => inStreetRegion(x, z))) continue;
      const field = (pr.road.highway || '').toLowerCase() === 'track';
      const tans = tangents(pts);
      const single = pr.hw < 1.55;
      const sideList = single ? [0] : [-1, 1];
      for (const sgn of sideList) {
        const off = single ? 0 : sgn * Math.max(pr.hw - 0.5, 0.9);
        const chainPts: (ChainPoint | null)[] = pts.map(([x, z], m) => {
          if (!inStreetRegion(x, z)) return null;
          const [tx, tz] = tans[m];
          const nx = -tz;
          const nz = tx;
          let px = x + nx * off;
          let pz = z + nz * off;
          // a wall at the road edge (street narrowed against a facade): walk a little further in
          let settled = settle(px, pz, 0.35);
          if (!settled && off !== 0) {
            px = x + nx * (off - sgn * 0.7);
            pz = z + nz * (off - sgn * 0.7);
            settled = settle(px, pz, 0.35);
          }
          if (!settled) return null;
          // not inside another, wider carriageway (junction ends) or on the Hauptstraße
          if (carriage.inside(settled[0], settled[1], -0.3, idx) !== -1) return null;
          if (surfaceLift(settled[0], settled[1]) > 0.02) return null;
          return {
            x: settled[0],
            z: settled[1],
            awayX: single ? 0 : nx * sgn,
            awayZ: single ? 0 : nz * sgn,
            room: single ? 0 : 0.6,
          };
        });
        pushChains(chainPts, {
          kind: 'roadside',
          field,
          lat: single ? 0.6 : 0.45,
          road: idx,
          pairKey: single ? null : `st${idx}`,
        });
      }
      continue;
    }
    // paths, steps, field tracks: centre line
    const pts = resample(pr.pts, STEP_M);
    if (!pts.some(([x, z]) => inRegion(x, z))) continue;
    const field = base === 'track';
    if (field && !pts.some(([x, z]) => inRegion(x, z, -60))) continue;
    const chainPts: (ChainPoint | null)[] = pts.map(([x, z]) => {
      if (!inRegion(x, z)) return null;
      const settled = settle(x, z, 0.5);
      if (!settled) return null;
      if (carriage.inside(settled[0], settled[1], -0.4, -1) !== -1) return null;
      return { x: settled[0], z: settled[1], awayX: 0, awayZ: 0, room: 0 };
    });
    pushChains(chainPts, { kind: base === 'track' ? 'track' : 'path', field, lat: field ? 0.8 : 0.35, road: idx, pairKey: null });
  }
  graph.stats.sidewalkSamples = sidewalkSamples;
  graph.stats.sidewalkBridged = sidewalkBridged;

  // ---- chains -> nodes + edges --------------------------------------------------------------------------------
  const chainNodes: number[][] = [];
  const nodeChain: number[] = [];
  chains.forEach((ch, ci) => {
    const ids: number[] = [];
    for (const p of ch.pts) {
      const id = graph.addNode(p.x, p.z, ch.field, p.awayX, p.awayZ, p.room);
      nodeChain[id] = ci;
      if (ids.length > 0) {
        const a = ids[ids.length - 1];
        const na = graph.nodes[a];
        graph.addEdge(a, id, ch.kind, carriage.crosses(na.x, na.z, p.x, p.z, ch.road), ch.field, ch.lat);
      }
      ids.push(id);
    }
    chainNodes.push(ids);
  });

  const linkKind = (a: number, b: number): EdgeKind => {
    const ka = chains[nodeChain[a]]?.kind;
    const kb = chains[nodeChain[b]]?.kind;
    return ka === 'sidewalk' && kb === 'sidewalk' ? 'sidewalk' : 'link';
  };
  const connect = (a: number, b: number, lat = 0.35): boolean => {
    const na = graph.nodes[a];
    const nb = graph.nodes[b];
    if (!clearLine(na.x, na.z, nb.x, nb.z)) return false;
    const crossing = carriage.crosses(na.x, na.z, nb.x, nb.z, -1);
    graph.addEdge(a, b, linkKind(a, b), crossing, na.field && nb.field, lat);
    return true;
  };

  // ---- stitch chain ends to the network ----------------------------------------------------------------------
  const near: number[] = [];
  let stitches = 0;
  chainNodes.forEach((ids, ci) => {
    for (const end of [ids[0], ids[ids.length - 1]]) {
      const n = graph.nodes[end];
      graph.nodesNear(n.x, n.z, 7, near);
      const cand = near
        .filter((i) => nodeChain[i] !== ci)
        .sort((p, q) => Math.hypot(graph.nodes[p].x - n.x, graph.nodes[p].z - n.z) - Math.hypot(graph.nodes[q].x - n.x, graph.nodes[q].z - n.z));
      // connect to the nearest node of up to two other chains
      const usedChains = new Set<number>();
      for (const c of cand) {
        if (usedChains.has(nodeChain[c]) || usedChains.size >= 2) continue;
        if (connect(end, c)) {
          usedChains.add(nodeChain[c]);
          stitches++;
        }
      }
    }
  });
  graph.stats.stitches = stitches;

  // ---- crossings between the two sides of a street ------------------------------------------------------------
  const byPair = new Map<string, number[]>();
  chains.forEach((ch, ci) => {
    if (!ch.pairKey) return;
    const l = byPair.get(ch.pairKey) ?? [];
    l.push(ci);
    byPair.set(ch.pairKey, l);
  });
  let crossings = 0;
  for (const [key, cis] of byPair) {
    const hauptstrasse = key.startsWith('hw');
    const spacing = hauptstrasse ? 70 : 36;
    for (const ci of cis) {
      const ids = chainNodes[ci];
      let since = spacing * 0.5;
      ids.forEach((id, k) => {
        since += k > 0 ? Math.hypot(graph.nodes[id].x - graph.nodes[ids[k - 1]].x, graph.nodes[id].z - graph.nodes[ids[k - 1]].z) : 0;
        const isEnd = k === 0 || k === ids.length - 1;
        if (!isEnd && since < spacing) return;
        const n = graph.nodes[id];
        // the node straight across: in another chain of the same street, roughly opposite (away vectors opposed)
        graph.nodesNear(n.x, n.z, hauptstrasse ? 13 : 9, near);
        let best = -1;
        let bestScore = Infinity;
        for (const c of near) {
          const ch = nodeChain[c];
          if (ch === ci || !cis.includes(ch)) continue;
          const m = graph.nodes[c];
          if (m.awayX * n.awayX + m.awayZ * n.awayZ > -0.7) continue;
          const dx = m.x - n.x;
          const dz = m.z - n.z;
          const d = Math.hypot(dx, dz);
          // prefer straight across (along the away axis)
          const across = Math.abs(dx * n.awayX + dz * n.awayZ) / Math.max(d, 1e-6);
          const score = d * (2 - across);
          if (score < bestScore) {
            bestScore = score;
            best = c;
          }
        }
        if (best >= 0 && graph.edgeBetween(id, best) < 0) {
          const nb = graph.nodes[best];
          if (clearLine(n.x, n.z, nb.x, nb.z)) {
            graph.addEdge(id, best, 'link', true, false, 0.6);
            crossings++;
            since = 0;
          }
        }
      });
    }
  }
  graph.stats.crossings = crossings;

  // ---- destinations -----------------------------------------------------------------------------------------
  const isWalkable = (i: number): boolean => !graph.nodes[i].field;
  /** Why the last attach() failed (for loud, specific errors). */
  let attachWhy = '';
  /** Adds a destination node at (x, z), connected to up to two nearby graph nodes. */
  // Destinations and gathering spots hang off the network on ONE link (dead-end stubs): nobody's route passes
  // through a door someone is standing at, or through a chatting group.
  const attach = (x: number, z: number, maxDist: number, allowField = false, maxLinks = 1): number => {
    const settled = settle(x, z, 0.4);
    if (!settled) {
      attachWhy = `(${x.toFixed(1)}, ${z.toFixed(1)}) lies inside a wall / solid`;
      return -1;
    }
    const [px, pz] = settled;
    graph.nodesNear(px, pz, maxDist, near);
    const cand = near
      .filter((i) => allowField || isWalkable(i))
      .sort((p, q) => Math.hypot(graph.nodes[p].x - px, graph.nodes[p].z - pz) - Math.hypot(graph.nodes[q].x - px, graph.nodes[q].z - pz));
    if (cand.length === 0) {
      attachWhy = `(${px.toFixed(1)}, ${pz.toFixed(1)}): no walk node within ${maxDist} m`;
      return -1;
    }
    let id = -1;
    let links = 0;
    let wall = 0;
    let road = 0;
    for (const c of cand) {
      if (links >= maxLinks) break;
      const n = graph.nodes[c];
      if (!clearLine(px, pz, n.x, n.z)) {
        wall++;
        continue;
      }
      if (carriage.crosses(px, pz, n.x, n.z, -1)) {
        road++;
        continue;
      }
      if (id < 0) id = graph.addNode(px, pz, allowField && graph.nodes[c].field);
      graph.addEdge(id, c, 'link', false, graph.nodes[id].field, 0.3);
      links++;
    }
    if (id < 0) attachWhy = `(${px.toFixed(1)}, ${pz.toFixed(1)}): ${cand.length} nodes in reach, ${wall} behind walls / ditches, ${road} across a carriageway`;
    return id;
  };

  interface DoorSpot {
    x: number;
    z: number;
    facing: number;
    d: number;
  }
  /** Candidate door spots in front of every wall of a footprint, nearest to the walk graph first. */
  const doorsOf = (b: BuildingRecord, reach: number): DoorSpot[] => {
    const fp = b.footprint;
    if (!fp || fp.length < 3) return [];
    let area = 0;
    for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) area += fp[j][0] * fp[i][1] - fp[i][0] * fp[j][1];
    const ccw = area > 0;
    const out: DoorSpot[] = [];
    for (let i = 0; i < fp.length; i++) {
      const [ax, az] = fp[i];
      const [bx, bz] = fp[(i + 1) % fp.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2.2) continue;
      // outward normal
      let nx = (bz - az) / len;
      let nz = -(bx - ax) / len;
      if (ccw) {
        nx = -nx;
        nz = -nz;
      }
      // march out from the wall to the first free spot (landmark solids can be larger than the OSM footprint:
      // steps, porches, the churchyard wall)
      let first = -1;
      for (let off = 0.6; off <= 14; off += 0.4) {
        if (!blocked((ax + bx) / 2 + nx * off, (az + bz) / 2 + nz * off, BODY_R + 0.05)) {
          first = off;
          break;
        }
      }
      if (first < 0) continue;
      for (const off of [first, first + 0.8]) {
        const mx = (ax + bx) / 2 + nx * off;
        const mz = (az + bz) / 2 + nz * off;
        const nn = graph.nearestNode(mx, mz, reach, isWalkable);
        if (nn < 0) continue;
        out.push({ x: mx, z: mz, facing: Math.atan2(-nx, -nz), d: Math.hypot(graph.nodes[nn].x - mx, graph.nodes[nn].z - mz) + off * 0.3 });
      }
    }
    return out.sort((p, q) => p.d - q.d);
  };
  const doorOf = (b: BuildingRecord): DoorSpot | null => doorsOf(b, 16)[0] ?? null;

  const buildingsById = new Map(input.buildings.map((b) => [String(b.id), b]));
  const addDest = (id: string, kind: DestinationKind, x: number, z: number, facing: number, maxDist = 16, field = false): boolean => {
    const node = attach(x, z, maxDist, field);
    if (node < 0) return false;
    graph.destinations.push({ id, kind, node, facing });
    return true;
  };
  /** A landmark door: tries every wall of the footprint; fails loudly with the reason for each candidate. */
  const requireDest = (id: string, kind: DestinationKind, b: BuildingRecord): void => {
    const spots = doorsOf(b, 26);
    // Landmarks can sit on terraces / behind churchyard walls (their collider solids are larger than the OSM
    // footprint): the forecourt is then the first free, reachable ground around the building - the nearest wins.
    const [cx, cz] = b.center;
    for (let k = 0; k < 36; k++) {
      const ang = (k / 36) * Math.PI * 2;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      for (let r = 4; r <= 34; r += 0.5) {
        const x = cx + dx * r;
        const z = cz + dz * r;
        if (blocked(x, z, BODY_R + 0.05) || wet(x, z)) continue;
        const nn = graph.nearestNode(x, z, 26, isWalkable);
        if (nn >= 0) spots.push({ x, z, facing: Math.atan2(-dx, -dz), d: r + 6 });
        break;
      }
    }
    spots.sort((p, q) => p.d - q.d);
    const why: string[] = [];
    for (const spot of spots.slice(0, 60)) {
      if (addDest(id, kind, spot.x, spot.z, spot.facing, 26)) return;
      why.push(attachWhy);
    }
    throw new Error(
      `[pedestrians] walk graph: the ${kind} door (${id}) could not be connected to the footpaths - ${
        spots.length === 0 ? 'no wall within 26 m of a walk node' : why.slice(0, 8).join('; ')
      }`
    );
  };
  const church = buildingsById.get(CHURCH_ID);
  const rathaus = buildingsById.get(RATHAUS_ID);
  if (!church || !rathaus) throw new Error(`[pedestrians] walk graph: church (${CHURCH_ID}) or Rathaus (${RATHAUS_ID}) missing in the scene data`);
  requireDest('church', 'church', church);
  requireDest('rathaus', 'rathaus', rathaus);

  // house doors (residential / farm / winery buildings close to a walkable line)
  let doors = 0;
  let bakeryDone = false;
  const BAKERY_NEAR = { x: 30, z: -75 }; // a shop front on the Hauptstraße east of the church
  const residential = input.buildings
    .filter((b) => ['residential', 'winery', 'civic'].includes(b.category ?? '') && b.footprint && b.footprint.length >= 3)
    .filter((b) => isInsideUrbanVillage(b.center[0], b.center[1]))
    .sort((a, b) => Math.hypot(a.center[0] - BAKERY_NEAR.x, a.center[1] - BAKERY_NEAR.z) - Math.hypot(b.center[0] - BAKERY_NEAR.x, b.center[1] - BAKERY_NEAR.z));
  for (const b of residential) {
    if (String(b.id) === CHURCH_ID || String(b.id) === RATHAUS_ID) continue;
    const door = doorOf(b);
    if (!door || door.facing === undefined) continue;
    if (!bakeryDone) {
      // the nearest shop front to BAKERY_NEAR that faces a sidewalk becomes the bakery
      const nn = graph.nearestNode(door.x, door.z, 6, (i) => nodeChain[i] !== undefined && chains[nodeChain[i]].kind === 'sidewalk');
      if (nn >= 0 && addDest('bakery', 'bakery', door.x, door.z, door.facing, 8)) {
        bakeryDone = true;
        continue;
      }
    }
    if (addDest(`door:${b.id}`, 'door', door.x, door.z, door.facing, 14)) doors++;
  }
  if (!bakeryDone) throw new Error('[pedestrians] walk graph: no shop front on the Hauptstraße sidewalk for the bakery');
  graph.stats.doors = doors;

  // playground: a ring of spots around the play equipment
  let play = 0;
  for (let k = 0; k < 10 && play < 4; k++) {
    const a = (k / 10) * Math.PI * 2;
    for (const r of [13, 17, 21]) {
      const x = PLAYGROUND.x + Math.cos(a) * r;
      const z = PLAYGROUND.z + Math.sin(a) * r;
      if (blocked(x, z, 0.9)) continue;
      if (addDest(`playground:${k}`, 'playground', x, z, Math.atan2(PLAYGROUND.x - x, PLAYGROUND.z - z), 40)) {
        play++;
        break;
      }
    }
  }
  if (play === 0) throw new Error('[pedestrians] walk graph: no reachable spot at the playground');
  graph.stats.playground = play;

  // pitch: spectators along the long-side rails
  let pitch = 0;
  const dirX = Math.cos(PITCH.rot);
  const dirZ = -Math.sin(PITCH.rot);
  const perpX = Math.sin(PITCH.rot);
  const perpZ = Math.cos(PITCH.rot);
  for (const v of [-30.5, 30.5]) {
    for (const u of [-28, -8, 12, 30]) {
      const x = PITCH.cx + dirX * u + perpX * v;
      const z = PITCH.cz + dirZ * u + perpZ * v;
      if (blocked(x, z, 0.6)) continue;
      const face = Math.atan2(PITCH.cx + dirX * u - x, PITCH.cz + dirZ * u - z);
      if (addDest(`pitch:${u}:${v}`, 'pitch', x, z, face, 45, true)) pitch++;
    }
  }
  graph.stats.pitch = pitch;

  // vineyard edges: field-track nodes next to a vineyard, spread out
  const vineyards = input.landuse.filter((l) => l.type === 'vineyard' && l.points && l.points.length >= 3);
  const vineGrid = new SegmentGrid(20);
  vineyards.forEach((v) => vineGrid.addPolyline([...v.points, v.points[0]] as P2[], 0, -3));
  const vineSpots: P2[] = [];
  graph.nodes.forEach((n, i) => {
    if (!n.field || vineSpots.length >= 28) return;
    if (!inRegion(n.x, n.z, -120)) return;
    if (vineGrid.inside(n.x, n.z, 7, -99) === -1) return;
    if (vineSpots.some(([x, z]) => Math.hypot(x - n.x, z - n.z) < 45)) return;
    vineSpots.push([n.x, n.z]);
    graph.destinations.push({ id: `vineyard:${i}`, kind: 'vineyard', node: i, facing: 0 });
  });
  graph.stats.vineyard = vineSpots.length;

  /** Distance from (x, z) to the nearest walk-graph edge. */
  const distToEdges = (x: number, z: number): number => {
    graph.nodesNear(x, z, 30, near);
    let best = Infinity;
    for (const i of near) {
      for (const eid of graph.nodes[i].edges) {
        const e = graph.edges[eid];
        const A = graph.nodes[e.a];
        const B = graph.nodes[e.b];
        const vx = B.x - A.x;
        const vz = B.z - A.z;
        const l2 = vx * vx + vz * vz;
        const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - A.x) * vx + (z - A.z) * vz) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - (A.x + vx * t), z - (A.z + vz * t)));
      }
    }
    return best;
  };
  // gathering spots: free ground near the war memorial / church tower and in front of the Rathaus
  const spotNear = (label: string, cx: number, cz: number, maxR: number, want: number, required: boolean): void => {
    let found = 0;
    const cands: P2[] = [];
    for (let r = 2; r <= maxR; r += 1.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        cands.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    }
    for (const [x, z] of cands) {
      if (found >= want) break;
      if (blocked(x, z, 1.35) || wet(x, z)) continue;
      if (carriage.inside(x, z, 1.2, -1) !== -1) continue;
      if (graph.spots.some((s) => Math.hypot(s.x - x, s.z - z) < 6)) continue;
      // a chatting group stands beside the walking lines, never on them
      if (distToEdges(x, z) < 2.1) continue;
      const node = attach(x, z, 14);
      if (node < 0) continue;
      graph.spots.push({ id: `${label}:${found}`, x, z, node, label });
      found++;
    }
    if (found === 0 && required) throw new Error(`[pedestrians] walk graph: no free gathering spot near the ${label}`);
  };
  spotNear('kirchplatz', MEMORIAL.x, MEMORIAL.z, 16, 2, true);
  spotNear('rathaus', rathaus.center[0], rathaus.center[1], 22, 1, true);
  spotNear('spielplatz', PLAYGROUND.x, PLAYGROUND.z, 24, 1, false);

  graph.keepLargestComponent();
  for (const kind of ['church', 'rathaus', 'bakery'] as DestinationKind[]) {
    if (!graph.destinations.some((d) => d.kind === kind)) {
      throw new Error(`[pedestrians] walk graph: the ${kind} is not connected to the main footpath network`);
    }
  }
  graph.stats.nodes = graph.nodes.length;
  graph.stats.edges = graph.edges.length;
  graph.stats.destinations = graph.destinations.length;
  graph.stats.spots = graph.spots.length;
  return graph;
}
