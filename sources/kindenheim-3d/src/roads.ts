import * as THREE from 'three';
import { getGroundObstacles } from './dataLoader';
import { GROUND_LAYER, KDH_GROUND_GLSL, type GroundMaterialLibrary, type TerrainSystem } from './terrain';
import type { RoadRecord } from './types';

/**
 * Road network of Kindenheim.
 *
 * Every road is a decal draped on the RENDERED terrain surface (dense cross-sections, 3.5 cm lift, no depth
 * write), shaded with the same CC0 PBR ground layers as the terrain: real asphalt with normal/roughness,
 * patches, tar seams, cracks and wheel-polished lanes; white edge lines on the rural L 450, worn centre dashes
 * on Hauptstraße; sett gutters; flush paver bands and the Am Kirchrain centre channel on village streets;
 * gravel field tracks as two wheel ruts with the field's own grass between them. Edges are feathered into the
 * terrain instead of ending in a hard ribbon. Hauptstraße additionally gets real raised kerbs and herringbone
 * paver sidewalks (opaque mesh), dropped to road level wherever a side street or lane joins.
 *
 * Roads and sidewalks keep clear of buildings: per cross-section the free width to the nearest building footprint
 * (OSM footprints + landmark boxes, `getGroundObstacles`) is measured on both sides; Hauptstraße is first shifted
 * away from a facade that stands too close (so the Rathaus steps get their sidewalk), then sidewalk and finally
 * carriageway are narrowed. Side streets are cut off exactly at the Hauptstraße gutter line.
 *
 * Heights: the terrain carries a graded, level road bed (scripts/build_terrain_roadbed.py), so draping on the
 * rendered surface gives a level cross-section. Physics samples `terrain.getTerrainHeight`; the raised sidewalk
 * is exposed through `group.userData.getSurfaceLift(x, z)` (metres above that height).
 */

/** Shader profile ids (must match the `prof` branches in ROAD_FRAGMENT_COLOR). */
const PROFILE = {
  urban: 0, // Hauptstraße / L 450 inside the village: asphalt, sett gutter, worn centre dashes
  village: 1, // residential streets: asphalt with a flush paver band (optionally the Kirchrain centre channel)
  rural: 2, // L 450 outside the village: asphalt, solid white edge lines, feathered verge
  lane: 3, // K 26, Raiffeisenstraße: asphalt, no markings, feathered verge
  service: 4, // paved farm tracks and service roads: worn, cracked asphalt with gravel creeping in
  track: 5, // unpaved field tracks: two gravel wheel ruts
  path: 6, // footpaths: one worn strip
  kerb: 7, // raised kerb + sidewalk mesh (opaque)
} as const;

type DecalTier = 'path' | 'track' | 'service' | 'lane' | 'village' | 'rural' | 'urban';

/** Draw order of the decals (all before any other transparent object; later = on top at junctions). */
const DECAL_RENDER_ORDER: Record<DecalTier, number> = {
  path: -30,
  track: -29,
  service: -28,
  lane: -27,
  village: -26,
  rural: -25,
  urban: -24,
};

const DECAL_LIFT_M = 0.035;
const ALONG_STEP_M = 2.5;
const KERB_HEIGHT_M = 0.1;
const KERB_WIDTH_M = 0.14;
/** Clearance kept between road / sidewalk and a building footprint (m). */
const FACADE_CLEARANCE_M = 0.12;
/** Hauptstraße sidewalk: wanted width, and the narrowest one kept before the carriageway itself is narrowed. */
const SIDEWALK_M = 1.2;
const SIDEWALK_MIN_M = 0.45;
/** Hauptstraße may be moved this far off its OSM centre line to clear a facade. */
const MAX_SHIFT_M = 1.8;

// Kinderbach creek bridge on Triftstraße: spans the ~2.4m DGM1 bare-earth creek dip between abutments
const KINDERBACH_BRIDGE = {
  northX: -315.88,
  northZ: 201.6,
  southX: -318.72,
  southZ: 220.0,
  deckHalfWidthM: 2.55,
  rampPadM: 1.6,
};

/**
 * Returns the level bridge deck elevation (in local Y above minElevationM) if (x, z) lies on the
 * Triftstraße bridge spanning the Kinderbach creek, otherwise null.
 */
export function getBridgeDeckSurfaceHeight(x: number, z: number, terrain: TerrainSystem): number | null {
  const dx = KINDERBACH_BRIDGE.southX - KINDERBACH_BRIDGE.northX;
  const dz = KINDERBACH_BRIDGE.southZ - KINDERBACH_BRIDGE.northZ;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const px = x - KINDERBACH_BRIDGE.northX;
  const pz = z - KINDERBACH_BRIDGE.northZ;
  const along = px * ux + pz * uz;
  const across = Math.abs(-px * uz + pz * ux);

  if (across > KINDERBACH_BRIDGE.deckHalfWidthM + 0.8) return null;
  if (along < -KINDERBACH_BRIDGE.rampPadM || along > len + KINDERBACH_BRIDGE.rampPadM) return null;

  const yN = terrain.getTerrainHeight(KINDERBACH_BRIDGE.northX, KINDERBACH_BRIDGE.northZ);
  const yS = terrain.getTerrainHeight(KINDERBACH_BRIDGE.southX, KINDERBACH_BRIDGE.southZ);
  const t = THREE.MathUtils.clamp(along / len, 0, 1);
  const bridgeY = yN + (yS - yN) * t + 0.08;
  const rawY = terrain.getTerrainHeight(x, z);

  // Smooth blend on approach aprons so tires & asphalt never step abruptly
  let blend = 1.0;
  if (along < 0) {
    blend = THREE.MathUtils.smoothstep(along, -KINDERBACH_BRIDGE.rampPadM, 0);
  } else if (along > len) {
    blend = 1.0 - THREE.MathUtils.smoothstep(along, len, len + KINDERBACH_BRIDGE.rampPadM);
  }
  if (across > KINDERBACH_BRIDGE.deckHalfWidthM) {
    blend *= 1.0 - THREE.MathUtils.smoothstep(across, KINDERBACH_BRIDGE.deckHalfWidthM, KINDERBACH_BRIDGE.deckHalfWidthM + 0.8);
  }
  return Math.max(rawY, rawY + (bridgeY - rawY) * blend);
}

function isKirchrainRinnePoint(x: number, z: number): boolean {
  return x >= -435 && x <= -412 && z >= -58 && z <= 7.8;
}

function isInsideUrbanVillage(x: number, z: number): boolean {
  return x >= -475 && x <= 515 && z >= -265 && z <= 185;
}

function classifyRoadBase(road: RoadRecord): 'highway' | 'lane' | 'village' | 'service' | 'track' | 'path' | null {
  const hw = (road.highway || '').toLowerCase();
  const surf = (road.surface || '').toLowerCase();
  if (hw === 'primary' || hw === 'primary_link' || hw === 'trunk' || hw === 'secondary' || hw === 'secondary_link') {
    return 'highway';
  }
  if (hw === 'tertiary' || hw === 'tertiary_link' || hw === 'unclassified' || hw === 'road') {
    return 'lane';
  }
  if (hw === 'residential' || hw === 'living_street') {
    return 'village';
  }
  if (hw === 'service') {
    return 'service';
  }
  if (hw === 'track') {
    if (surf === 'paved' || surf === 'asphalt' || surf === 'concrete') {
      return 'service';
    }
    return 'track';
  }
  if (hw === 'path' || hw === 'cycleway' || hw === 'footway' || hw === 'bridleway') {
    return 'path';
  }
  return null;
}

function extractXZ(pt: [number, number] | [number, number, number]): [number, number] {
  if (pt.length === 3) {
    return [pt[0], pt[2]];
  }
  return [pt[0], pt[1]];
}

function resamplePolyline(rawPts: [number, number][], maxStepM: number): [number, number][] {
  if (rawPts.length < 2) return rawPts;
  const out: [number, number][] = [rawPts[0]];
  for (let i = 0; i < rawPts.length - 1; i++) {
    const [x0, z0] = rawPts[i];
    const [x1, z1] = rawPts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) continue;
    const steps = Math.max(1, Math.ceil(len / maxStepM));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([x0 + dx * t, z0 + dz * t]);
    }
  }
  return out;
}

/** Splits a polyline into runs by a per-segment predicate (e.g. inside / outside the village). */
function splitRuns<T extends string>(pts: [number, number][], tierAt: (x: number, z: number) => T): { tier: T; pts: [number, number][] }[] {
  if (pts.length < 2) return [];
  const runs: { tier: T; pts: [number, number][] }[] = [];
  let curTier = tierAt((pts[0][0] + pts[1][0]) * 0.5, (pts[0][1] + pts[1][1]) * 0.5);
  let curPts: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const next = tierAt((pts[i - 1][0] + pts[i][0]) * 0.5, (pts[i - 1][1] + pts[i][1]) * 0.5);
    if (next !== curTier) {
      if (curPts.length >= 2) runs.push({ tier: curTier, pts: curPts });
      curTier = next;
      curPts = [pts[i - 1], pts[i]];
    } else {
      curPts.push(pts[i]);
    }
  }
  if (curPts.length >= 2) runs.push({ tier: curTier, pts: curPts });
  return runs;
}

function hashSeed(id: string | number, salt: number): number {
  const s = String(id);
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

interface RoadGeometryAccumulator {
  positions: number[];
  normals: number[];
  road: number[]; // across (m, signed), along (m), half width (m), profile id
  roadB: number[]; // core half width (m), seed, flag, edge-band factor (decals) / kerb lift (kerb mesh)
  dir: number[]; // unit along-direction (x, z)
  clip: number[]; // distance outside the Hauptstraße carriageway (side streets are cut off below 0)
  indices: number[];
}

function createAccumulator(): RoadGeometryAccumulator {
  return { positions: [], normals: [], road: [], roadB: [], dir: [], clip: [], indices: [] };
}

interface Section {
  x: number;
  z: number;
  tx: number;
  tz: number;
  along: number;
}

/** Centreline sections with a smoothed tangent (average of the adjoining segments). */
function buildSections(pts: [number, number][]): Section[] {
  const n = pts.length;
  const out: Section[] = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    const [cx, cz] = pts[i];
    if (i > 0) along += Math.hypot(cx - pts[i - 1][0], cz - pts[i - 1][1]);
    let tx = 0;
    let tz = 0;
    if (i > 0) {
      const dx = cx - pts[i - 1][0];
      const dz = cz - pts[i - 1][1];
      const l = Math.hypot(dx, dz) || 1;
      tx += dx / l;
      tz += dz / l;
    }
    if (i < n - 1) {
      const dx = pts[i + 1][0] - cx;
      const dz = pts[i + 1][1] - cz;
      const l = Math.hypot(dx, dz) || 1;
      tx += dx / l;
      tz += dz / l;
    }
    const tl = Math.hypot(tx, tz) || 1;
    out.push({ x: cx, z: cz, tx: tx / tl, tz: tz / tl, along });
  }
  return out;
}

function surfaceHeight(terrain: TerrainSystem, x: number, z: number): number {
  const bridge = getBridgeDeckSurfaceHeight(x, z, terrain);
  return bridge !== null ? Math.max(bridge, terrain.getRenderedSurfaceHeight(x, z)) : terrain.getRenderedSurfaceHeight(x, z);
}

/** Cross-section sample positions: both edges, the core edges and an interior vertex at least every 1.1 m. */
function acrossOffsets(halfWidth: number, core: number): number[] {
  const out: number[] = [-halfWidth];
  const c = Math.min(core, halfWidth);
  if (halfWidth - c > 0.03) out.push(-c);
  const inner = Math.max(2, Math.ceil((2 * c) / 1.1));
  for (let i = 1; i < inner; i++) out.push(-c + (2 * c * i) / inner);
  if (halfWidth - c > 0.03) out.push(c);
  out.push(halfWidth);
  return out;
}

interface DecalSpec {
  profile: number;
  halfWidth: number;
  core: number;
  seed: number;
  flag: number;
  /** Paved surfaces of all roads + this road's index: edge bands (gutter, paver strip) stop where another road joins. */
  paved?: JunctionIndex;
  roadIndex?: number;
  /** Per section, [left, right]: half width / core narrowed against facades (default: halfWidth / core). */
  sideHalfWidth?: [number[], number[]];
  sideCore?: [number[], number[]];
  /** Side streets: cut off at the Hauptstraße carriageway edge. */
  urban?: UrbanIndex;
}

/** Per section and side, the half width a decal may have before it reaches a building (min `minHalf`). */
function clearHalfWidths(sections: Section[], halfWidth: number, minHalf: number, obstacles: ObstacleIndex): [number[], number[]] {
  return [-1, 1].map((side) =>
    erodeSeries(
      sections.map((s) => THREE.MathUtils.clamp(obstacles.sideGap(s, side, halfWidth + 0.5) - FACADE_CLEARANCE_M, minHalf, halfWidth)),
      1
    )
  ) as [number[], number[]];
}

function appendDecal(acc: RoadGeometryAccumulator, pts: [number, number][], spec: DecalSpec, terrain: TerrainSystem): void {
  const sections = buildSections(pts);
  if (sections.length < 2) return;
  const offsets = acrossOffsets(spec.halfWidth, spec.core);
  const cols = offsets.length;
  const base = acc.positions.length / 3;
  const n = sections.length;

  // Per side: 1 = draw the edge band, 0 = another road's asphalt runs through here (smoothed along the road).
  // "Through" = the band lies more than 0.45 m inside the other surface; an end-to-end continuation of the same
  // street (next OSM way) only touches at the edge and keeps its band.
  const bandFor = (side: number): number[] => {
    if (!spec.paved) return sections.map(() => 1);
    const raw = sections.map((s) =>
      spec.paved!.near(s.x - s.tz * side * (spec.core - 0.2), s.z + s.tx * side * (spec.core - 0.2), -0.45, spec.roadIndex) ? 0 : 1
    );
    return raw.map((v, i) => {
      const lo = raw[Math.max(0, i - 1)];
      const hi = raw[Math.min(n - 1, i + 1)];
      return Math.min(v, (lo + v + hi) / 3);
    });
  };
  const bandL = bandFor(-1);
  const bandR = bandFor(1);

  for (let si = 0; si < n; si++) {
    const s = sections[si];
    const rx = -s.tz;
    const rz = s.tx;
    const onBridge = getBridgeDeckSurfaceHeight(s.x, s.z, terrain) !== null;
    const nrm = onBridge ? new THREE.Vector3(0, 1, 0) : terrain.getTerrainNormal(s.x, s.z, 2.5);
    const hwL = spec.sideHalfWidth ? spec.sideHalfWidth[0][si] : spec.halfWidth;
    const hwR = spec.sideHalfWidth ? spec.sideHalfWidth[1][si] : spec.halfWidth;
    // narrowed side: the edge treatment (gutter, paver band) moves in with the edge
    const coreL = spec.sideCore ? spec.sideCore[0][si] : Math.max(0.4, spec.core - (spec.halfWidth - hwL));
    const coreR = spec.sideCore ? spec.sideCore[1][si] : Math.max(0.4, spec.core - (spec.halfWidth - hwR));
    for (const a0 of offsets) {
      const right = a0 > 0.01;
      const left = a0 < -0.01;
      const hw = left ? hwL : right ? hwR : Math.min(hwL, hwR);
      const core = left ? coreL : right ? coreR : Math.min(coreL, coreR);
      // map the cross-section onto the (possibly narrowed) side: the core edge stays the core edge
      const aa0 = Math.abs(a0);
      const coreIn = Math.min(spec.core, spec.halfWidth);
      const aa = aa0 <= coreIn ? (aa0 / Math.max(coreIn, 1e-3)) * core : core + ((aa0 - coreIn) / Math.max(spec.halfWidth - coreIn, 1e-3)) * (hw - core);
      const a = Math.sign(a0) * aa;
      const px = s.x + rx * a;
      const pz = s.z + rz * a;
      acc.positions.push(px, surfaceHeight(terrain, px, pz) + DECAL_LIFT_M, pz);
      acc.normals.push(nrm.x, nrm.y, nrm.z);
      acc.road.push(a, s.along, hw, spec.profile);
      acc.roadB.push(core, spec.seed, spec.flag, left ? bandL[si] : right ? bandR[si] : Math.max(bandL[si], bandR[si]));
      acc.dir.push(s.tx, s.tz);
      acc.clip.push(spec.urban ? spec.urban.outsideCarriageway(px, pz) : 1e3);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = base + i * cols + j;
      const b = a + cols;
      acc.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

/** Uniform grid over the centrelines of everything that can join Hauptstraße (to drop the kerb there). */
class JunctionIndex {
  private readonly cells = new Map<string, [number, number, number, number][]>();
  private readonly cell = 8;

  public add(pts: [number, number][], halfWidth: number, roadIndex: number): void {
    for (const [x, z] of pts) {
      const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
      let list = this.cells.get(key);
      if (!list) {
        list = [];
        this.cells.set(key, list);
      }
      list.push([x, z, halfWidth, roadIndex]);
    }
  }

  /** True if the surface of any indexed road other than `exceptRoad` comes within `pad` metres of (x, z). */
  public near(x: number, z: number, pad: number, exceptRoad = -1): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = this.cells.get(`${i},${j}`);
        if (!list) continue;
        for (const [px, pz, hw, idx] of list) {
          if (idx !== exceptRoad && Math.hypot(px - x, pz - z) < hw + pad) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Building footprints as a grid of edges, for "how far can the road extend sideways from here" queries.
 */
class ObstacleIndex {
  private readonly cell = 8;
  private readonly cells = new Map<number, number[]>();
  /** Edge list: x0, z0, x1, z1, polygon index. */
  private readonly edges: number[] = [];
  private readonly polys: [number, number][][];
  private readonly boxes: number[] = [];

  constructor(polys: [number, number][][]) {
    this.polys = polys;
    polys.forEach((poly, pi) => {
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [x0, z0] = poly[i];
        const [x1, z1] = poly[(i + 1) % poly.length];
        if (!Number.isFinite(x0 + z0 + x1 + z1)) throw new Error(`Roads: obstacle polygon ${pi} has a non-finite vertex`);
        minX = Math.min(minX, x0);
        maxX = Math.max(maxX, x0);
        minZ = Math.min(minZ, z0);
        maxZ = Math.max(maxZ, z0);
        const e = this.edges.length / 5;
        this.edges.push(x0, z0, x1, z1, pi);
        for (let cx = Math.floor(Math.min(x0, x1) / this.cell); cx <= Math.floor(Math.max(x0, x1) / this.cell); cx++) {
          for (let cz = Math.floor(Math.min(z0, z1) / this.cell); cz <= Math.floor(Math.max(z0, z1) / this.cell); cz++) {
            const key = cx * 4096 + cz;
            let list = this.cells.get(key);
            if (!list) {
              list = [];
              this.cells.set(key, list);
            }
            list.push(e);
          }
        }
      }
      this.boxes.push(minX, minZ, maxX, maxZ);
    });
  }

  private inside(pi: number, x: number, z: number): boolean {
    const b = pi * 4;
    if (x < this.boxes[b] || z < this.boxes[b + 1] || x > this.boxes[b + 2] || z > this.boxes[b + 3]) return false;
    const poly = this.polys[pi];
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }

  /**
   * Distance from (x, z) along the unit direction (dx, dz) to the first footprint edge, at most `maxDist`.
   * Footprints that contain the start point itself (an OSM way drawn through a gateway) are ignored.
   */
  public freeDistance(x: number, z: number, dx: number, dz: number, maxDist: number): number {
    const ex = x + dx * maxDist;
    const ez = z + dz * maxDist;
    const seen = new Set<number>();
    const skip = new Set<number>();
    let best = maxDist;
    for (let cx = Math.floor(Math.min(x, ex) / this.cell); cx <= Math.floor(Math.max(x, ex) / this.cell); cx++) {
      for (let cz = Math.floor(Math.min(z, ez) / this.cell); cz <= Math.floor(Math.max(z, ez) / this.cell); cz++) {
        const list = this.cells.get(cx * 4096 + cz);
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e)) continue;
          seen.add(e);
          const o = e * 5;
          const pi = this.edges[o + 4];
          if (skip.has(pi)) continue;
          // ray (x, z) + t (dx, dz) against segment p0 + u (p1 - p0)
          const sx = this.edges[o + 2] - this.edges[o];
          const sz = this.edges[o + 3] - this.edges[o + 1];
          const den = dx * sz - dz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const qx = this.edges[o] - x;
          const qz = this.edges[o + 1] - z;
          const t = (qx * sz - qz * sx) / den;
          const u = (qx * dz - qz * dx) / den;
          if (t < 0 || t >= best || u < 0 || u > 1) continue;
          if (this.inside(pi, x, z)) {
            skip.add(pi);
            continue;
          }
          best = t;
        }
      }
    }
    return best;
  }

  /** Free width on one side of a cross-section: three parallel rays (section centre and +-1.2 m along the road). */
  public sideGap(s: Section, side: number, maxDist: number): number {
    const rx = -s.tz * side;
    const rz = s.tx * side;
    let g = maxDist;
    for (const off of [-1.2, 0, 1.2]) {
      g = Math.min(g, this.freeDistance(s.x + s.tx * off, s.z + s.tz * off, rx, rz, maxDist));
    }
    return g;
  }
}

/** Hauptstraße cross-sections (after shifting / narrowing): gutter-line cut for side streets and sidewalk heights. */
class UrbanIndex {
  private readonly cell = 8;
  private readonly cells = new Map<number, number[]>();
  /** Per section: x, z, tx, tz, coreL, coreR, outerL, outerR, liftL, liftR, spacing. */
  private readonly data: number[] = [];
  private static readonly STRIDE = 11;

  public add(s: Section, core: [number, number], outer: [number, number], lift: [number, number], spacing: number): void {
    const id = this.data.length / UrbanIndex.STRIDE;
    this.data.push(s.x, s.z, s.tx, s.tz, core[0], core[1], outer[0], outer[1], lift[0], lift[1], spacing);
    const key = Math.floor(s.x / this.cell) * 4096 + Math.floor(s.z / this.cell);
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push(id);
  }

  /** Nearest section whose along-extent covers (x, z): [section offset into data, signed across distance] or null. */
  private nearest(x: number, z: number): [number, number] | null {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    let hit: [number, number] | null = null;
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = this.cells.get(i * 4096 + j);
        if (!list) continue;
        for (const id of list) {
          const o = id * UrbanIndex.STRIDE;
          const dx = x - this.data[o];
          const dz = z - this.data[o + 1];
          const along = dx * this.data[o + 2] + dz * this.data[o + 3];
          if (Math.abs(along) > this.data[o + 10] * 0.5 + 0.05) continue;
          const d = dx * dx + dz * dz;
          if (d < best) {
            best = d;
            hit = [o, -dx * this.data[o + 3] + dz * this.data[o + 2]];
          }
        }
      }
    }
    return hit;
  }

  /** Distance outside the Hauptstraße carriageway edge (negative inside; 1e3 when no Hauptstraße is near). */
  public outsideCarriageway(x: number, z: number): number {
    const n = this.nearest(x, z);
    if (!n) return 1e3;
    const [o, across] = n;
    return Math.abs(across) - (across < 0 ? this.data[o + 4] : this.data[o + 5]);
  }

  /** Height of the raised sidewalk / kerb above the road bed at (x, z) (0 off the sidewalk). */
  public surfaceLift(x: number, z: number): number {
    const n = this.nearest(x, z);
    if (!n) return 0;
    const [o, across] = n;
    const side = across < 0 ? 0 : 1;
    const a = Math.abs(across);
    if (a < this.data[o + 4 + side] || a > this.data[o + 6 + side]) return 0;
    return KERB_HEIGHT_M * this.data[o + 8 + side];
  }
}

/** Gaussian smoothing of a per-section series (edges clamped). */
function smoothSeries(v: number[], sigma: number): number[] {
  const r = Math.ceil(sigma * 2.5);
  return v.map((_, i) => {
    let sum = 0;
    let wsum = 0;
    for (let k = -r; k <= r; k++) {
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      sum += v[Math.min(v.length - 1, Math.max(0, i + k))] * w;
      wsum += w;
    }
    return sum / wsum;
  });
}

/** Running minimum over +-r samples (a narrowing starts before and ends after the obstacle). */
function erodeSeries(v: number[], r: number): number[] {
  return v.map((_, i) => {
    let m = Infinity;
    for (let k = -r; k <= r; k++) m = Math.min(m, v[Math.min(v.length - 1, Math.max(0, i + k))]);
    return m;
  });
}

/** Laplacian smoothing with fixed end points: rounds the sharp OSM corners the kerb strips would fold at. */
function relaxPolyline(pts: [number, number][], iterations: number): [number, number][] {
  let cur = pts.map((p) => [p[0], p[1]] as [number, number]);
  for (let it = 0; it < iterations; it++) {
    const next = cur.map((p) => [p[0], p[1]] as [number, number]);
    for (let i = 1; i < cur.length - 1; i++) {
      next[i][0] = cur[i][0] * 0.5 + (cur[i - 1][0] + cur[i + 1][0]) * 0.25;
      next[i][1] = cur[i][1] * 0.5 + (cur[i - 1][1] + cur[i + 1][1]) * 0.25;
    }
    cur = next;
  }
  return cur;
}

/**
 * Hauptstraße layout against the facades: shift of the centre line, then per section and side the carriageway
 * half width (core) and the sidewalk edge (outer).
 */
interface UrbanLayout {
  pts: [number, number][];
  core: [number[], number[]];
  outer: [number[], number[]];
}

function layoutUrbanRun(pts: [number, number][], core0: number, obstacles: ObstacleIndex): UrbanLayout {
  const want = core0 + SIDEWALK_M;
  const reach = want + MAX_SHIFT_M + 2;
  const gapsOf = (sections: Section[], side: number): number[] =>
    erodeSeries(sections.map((s) => obstacles.sideGap(s, side, reach) - FACADE_CLEARANCE_M), 1);

  // 1. shift away from a facade that leaves less than the full sidewalk, as far as the other side allows
  let sections = buildSections(pts);
  const gl = gapsOf(sections, -1);
  const gr = gapsOf(sections, 1);
  const rawShift = sections.map((_, i) => {
    const shortL = Math.max(0, want - gl[i]);
    const shortR = Math.max(0, want - gr[i]);
    if (shortL > 0 && shortR > 0) return THREE.MathUtils.clamp((gr[i] - gl[i]) * 0.5, -MAX_SHIFT_M, MAX_SHIFT_M);
    if (shortL > 0) return Math.min(shortL, Math.max(0, gr[i] - want), MAX_SHIFT_M);
    if (shortR > 0) return -Math.min(shortR, Math.max(0, gl[i] - want), MAX_SHIFT_M);
    return 0;
  });
  // keep the strongest shift over +-3 sections, then ease it in and out over ~10 m
  const held = rawShift.map((_, i) => {
    let m = 0;
    for (let k = -3; k <= 3; k++) {
      const v = rawShift[Math.min(rawShift.length - 1, Math.max(0, i + k))];
      if (Math.abs(v) > Math.abs(m)) m = v;
    }
    return m;
  });
  const shift = smoothSeries(held, 2.5);
  const shifted = sections.map((s, i) => [s.x - s.tz * shift[i], s.z + s.tx * shift[i]] as [number, number]);
  // the run's end points stay on the OSM node so the next way / the rural road continues seamlessly
  shifted[0] = pts[0];
  shifted[shifted.length - 1] = pts[pts.length - 1];

  // 2. per side: sidewalk first, then the carriageway gives way
  sections = buildSections(shifted);
  const core: [number[], number[]] = [[], []];
  const outer: [number[], number[]] = [[], []];
  [-1, 1].forEach((side, k) => {
    const gaps = gapsOf(sections, side);
    gaps.forEach((g) => {
      const o = Math.min(want, g);
      const c = Math.max(1.6, Math.min(core0, o - SIDEWALK_MIN_M));
      core[k].push(c);
      outer[k].push(Math.max(c + KERB_WIDTH_M + 0.05, o));
    });
  });
  for (let k = 0; k < 2; k++) {
    core[k] = smoothSeries(erodeSeries(core[k], 1), 1);
    outer[k] = outer[k].map((o, i) => Math.max(o, core[k][i] + KERB_WIDTH_M + 0.05));
  }
  return { pts: shifted, core, outer };
}

/**
 * Raised kerb + paver sidewalk + outer skirt on both sides of an urban run. `lift` (0..1 per section and side)
 * lowers the kerb to road level at junctions and at the open ends of the run. Core / outer are per section and
 * side (narrowed against facades). Every section is registered in `urban` (side-street cut, sidewalk heights).
 */
function appendKerbs(
  acc: RoadGeometryAccumulator,
  pts: [number, number][],
  core: [number[], number[]],
  outer: [number[], number[]],
  seed: number,
  junctions: JunctionIndex,
  openStart: boolean,
  openEnd: boolean,
  terrain: TerrainSystem,
  urban: UrbanIndex,
  obstacles: ObstacleIndex
): void {
  const sections = buildSections(pts);
  const n = sections.length;
  if (n < 2) return;
  const total = sections[n - 1].along;

  const lifts = [-1, 1].map((side, k) => {
    // 1 = full kerb, 0 = dropped. Junction test at the middle of the sidewalk, then smoothed along the road.
    const raw = sections.map((s, i) => {
      const rx = -s.tz * side;
      const rz = s.tx * side;
      const mid = (core[k][i] + outer[k][i]) * 0.5;
      return junctions.near(s.x + rx * mid, s.z + rz * mid, 1.0) ? 0 : 1;
    });
    return raw.map((_, i) => {
      let sum = 0;
      for (let d = -2; d <= 2; d++) sum += raw[Math.min(n - 1, Math.max(0, i + d))];
      let l = Math.min(raw[i], sum / 5);
      l = l * l * (3 - 2 * l);
      if (openStart) l *= THREE.MathUtils.smoothstep(sections[i].along, 0, 4);
      if (openEnd) l *= THREE.MathUtils.smoothstep(total - sections[i].along, 0, 4);
      return l;
    });
  });
  sections.forEach((s, i) => {
    const spacing = i === 0 ? sections[1].along : i === n - 1 ? total - sections[n - 2].along : (sections[i + 1].along - sections[i - 1].along) * 0.5;
    urban.add(s, [core[0][i], core[1][i]], [outer[0][i], outer[1][i]], [lifts[0][i], lifts[1][i]], spacing * 2);
  });

  [-1, 1].forEach((side, k) => {
    const lift = lifts[k];
    // Cross-section corners: [across (0 = core, 1 = core + kerb, 2 = outer), height factor, face type, normal
    // (across, up)]. Each face has its own vertices so the kerb edge stays crisp.
    // face: 0 kerb face, 1 kerb top, 2 sidewalk, 3 outer skirt.
    const corners: [number, number, number, number, number][] = [
      [0, 0, 0, -1, 0],
      [0, 1, 0, -1, 0],
      [0, 1, 1, 0, 1],
      [1, 1, 1, 0, 1],
      [1, 1, 2, 0, 1],
      [2, 1, 2, 0, 1],
      [2, 1, 3, 1, 0],
      [2, -2.6, 3, 1, 0],
    ];
    const cols = corners.length;
    const base = acc.positions.length / 3;
    // Fold guard: on the inside of a tight bend an offset line can run backwards; such a vertex is held at the
    // previous section's position instead (no kerb wedges sticking out into the gutter).
    const prevX = new Float64Array(3).fill(NaN);
    const prevZ = new Float64Array(3).fill(NaN);
    sections.forEach((s, i) => {
      const rx = -s.tz * side;
      const rz = s.tx * side;
      const acrossOf = [core[k][i], core[k][i] + KERB_WIDTH_M, outer[k][i]];
      const px3: number[] = [];
      const pz3: number[] = [];
      for (let c = 0; c < 3; c++) {
        let px = s.x + rx * acrossOf[c];
        let pz = s.z + rz * acrossOf[c];
        if (i > 0 && (px - prevX[c]) * s.tx + (pz - prevZ[c]) * s.tz < 0.02) {
          px = prevX[c];
          pz = prevZ[c];
        }
        prevX[c] = px;
        prevZ[c] = pz;
        px3.push(px);
        pz3.push(pz);
      }
      for (const [ci, hf, face, na, nu] of corners) {
        const px = px3[ci];
        const pz = pz3[ci];
        const h = hf >= 0 ? hf * KERB_HEIGHT_M * lift[i] : hf * KERB_HEIGHT_M; // the skirt always reaches below ground
        acc.positions.push(px, surfaceHeight(terrain, px, pz) + DECAL_LIFT_M + h, pz);
        acc.normals.push(rx * na, nu, rz * na);
        acc.road.push(acrossOf[ci] * side, s.along, outer[k][i], PROFILE.kerb);
        acc.roadB.push(core[k][i], seed, face, lift[i]);
        acc.dir.push(s.tx, s.tz);
        acc.clip.push(1e3);
      }
    });
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < cols - 1; j += 2) {
        const a = base + i * cols + j;
        const b = a + cols;
        // Winding so the faces point up / towards the road / outwards for both sides.
        if (side > 0) acc.indices.push(a, a + 1, b, a + 1, b + 1, b);
        else acc.indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }

    appendRetainingWall(acc, sections, outer[k], lift, side, seed, terrain, obstacles);
  });
}

/**
 * Where the ground beside the sidewalk rises (yards and banks above the street: the 4 m height field cannot hold
 * the real plinth walls), a sandstone rubble retaining wall stands at the back of the sidewalk, its top level with
 * the ground behind it. Not where a facade already stands at the sidewalk edge.
 */
function appendRetainingWall(
  acc: RoadGeometryAccumulator,
  sections: Section[],
  outer: number[],
  lift: number[],
  side: number,
  seed: number,
  terrain: TerrainSystem,
  obstacles: ObstacleIndex
): void {
  const n = sections.length;
  const THICK = 0.4;
  const walk = sections.map((s, i) => {
    const px = s.x - s.tz * side * outer[i];
    const pz = s.z + s.tx * side * outer[i];
    return surfaceHeight(terrain, px, pz) + DECAL_LIFT_M + KERB_HEIGHT_M * lift[i];
  });
  const rawRise = sections.map((s, i) => {
    if (obstacles.sideGap(s, side, outer[i] + 0.7) < outer[i] + 0.6) return 0; // a house front is the wall here
    let behind = -Infinity;
    for (const d of [1.0, 2.0, 2.8]) {
      const a = outer[i] + d;
      behind = Math.max(behind, surfaceHeight(terrain, s.x - s.tz * side * a, s.z + s.tx * side * a));
    }
    const rise = behind - walk[i];
    return rise > 0.35 ? Math.min(rise + 0.06, 3.2) : 0;
  });
  // hold the wall over +-1 section, ease its height in and out, never higher than the ground asks for + 0.3 m
  const held = rawRise.map((_, i) => Math.max(rawRise[Math.max(0, i - 1)], rawRise[i], rawRise[Math.min(n - 1, i + 1)]));
  const height = smoothSeries(held, 1.2).map((h, i) => Math.min(h, held[i] + 0.3));
  if (!height.some((h) => h > 0.2)) return;

  const corners: [number, number, number, number, number][] = [
    // [across offset, use top (1) or base (0), face (4 wall, 5 coping), normal across, normal up]
    [0, 0, 4, -1, 0],
    [0, 1, 4, -1, 0],
    [0, 1, 5, 0, 1],
    [THICK, 1, 5, 0, 1],
    [THICK, 1, 4, 1, 0],
    [THICK, 0, 4, 1, 0],
  ];
  const cols = corners.length;
  const base = acc.positions.length / 3;
  sections.forEach((s, i) => {
    const rx = -s.tz * side;
    const rz = s.tx * side;
    const h = height[i];
    const top = walk[i] + Math.max(h, 0) - (h > 0.05 ? 0 : 0.08); // no wall: sunk just below the sidewalk
    for (const [off, useTop, face, na, nu] of corners) {
      const a = outer[i] + off;
      const px = s.x + rx * a;
      const pz = s.z + rz * a;
      const bottom = off > 0 ? surfaceHeight(terrain, px, pz) - 0.3 : walk[i] - 0.02;
      acc.positions.push(px, useTop ? top : Math.min(bottom, top), pz);
      acc.normals.push(rx * na, nu, rz * na);
      acc.road.push(a * side, s.along, a, PROFILE.kerb);
      acc.roadB.push(outer[i], seed, face, 1);
      acc.dir.push(s.tx, s.tz);
      acc.clip.push(1e3);
    }
  });
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < cols - 1; j += 2) {
      const a = base + i * cols + j;
      const b = a + cols;
      if (side > 0) acc.indices.push(a, a + 1, b, a + 1, b + 1, b);
      else acc.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------------------------------

const ROAD_FRAGMENT_PARS = /* glsl */ `
varying vec3 vKdhWorldPos;
varying vec3 vKdhWorldNormal;
varying vec4 vKdhRoad;
varying vec4 vKdhRoadB;
varying vec2 vKdhRoadDir;
varying float vKdhClip;
uniform vec2 uKdhRoadRange; // x = normal-map fade end (m), y = fine procedural detail fade end (m)
${KDH_GROUND_GLSL}
vec3 kdhWorldN;
float kdhRough;
`;

const ROAD_FRAGMENT_COLOR = /* glsl */ `
{
  vec3 kP = vKdhWorldPos;
  float kDist = distance(cameraPosition, kP);
  float ac = vKdhRoad.x;
  float aa = abs(ac);
  float al = vKdhRoad.y;
  float hw = vKdhRoad.z;
  int prof = int(vKdhRoad.w + 0.5);
  float core = vKdhRoadB.x;
  float seed = vKdhRoadB.y;
  float flag = vKdhRoadB.z;
  vec2 dirA = normalize(vKdhRoadDir);  // along the road (x, z)
  vec2 dirR = vec2(-dirA.y, dirA.x);   // to the right
  vec2 wst = kP.xz;
  vec2 wdx = dFdx(wst);
  vec2 wdy = dFdy(wst);
  vec2 rst = vec2(ac, al);
  vec2 rdx = dFdx(rst);
  vec2 rdy = dFdy(rst);
  vec2 vst = vec2(al, kP.y) * 3.0;     // for vertical faces (kerb face, skirt)
  vec2 vdx = dFdx(vst);
  vec2 vdy = dFdy(vst);
  float bandK = vKdhRoadB.w;           // 0 where another road's asphalt runs through the edge band
  float kFar = smoothstep(7.0, 42.0, kDist) * 0.8;
  float fine = 1.0 - smoothstep(uKdhRoadRange.y * 0.26, uKdhRoadRange.y, kDist);   // thin procedural lines fade before they alias
  float nBlot = kdhFbm(wst * 0.11 + seed * 31.0);     // metre-scale tone blotches
  float nEdge = kdhFbm(wst * 1.7 + 5.0);              // edge raggedness
  float nGrit = kdhFbm(wst * 6.0);

  // ---- which layers, in which space, with which target colour -------------------------------------
  int layerA = ${GROUND_LAYER.asphalt};
  bool roadSpaceA = false;
  vec3 targetA = vec3(0.128, 0.128, 0.132);
  int layerB = ${GROUND_LAYER.setts};
  bool roadSpaceB = true;
  vec3 targetB = vec3(0.2, 0.195, 0.185);
  float mixB = 0.0;
  float scaleB = 1.0;
  float alpha = 1.0;
  float asphalt = 1.0;   // amount of asphalt-specific wear (patches, cracks, polish)
  float crackAmt = 0.35;

  if (prof == ${PROFILE.urban}) {
    targetA = vec3(0.128, 0.128, 0.133);
    mixB = smoothstep(core - 0.36, core - 0.33, aa) * bandK;               // 0.33 m sett gutter along the kerb
    scaleB = 1.7;                                                          // 10-12 cm setts, three rows
    alpha = 1.0 - smoothstep(hw - 0.03, hw, aa);
  } else if (prof == ${PROFILE.village}) {
    // mid-grey residential asphalt (reference Triftstrasse / Neugasse), a little different on every street
    targetA = vec3(0.1, 0.1, 0.103) * (0.92 + 0.16 * fract(seed * 13.7));
    layerB = ${GROUND_LAYER.pavers};
    targetB = vec3(0.24, 0.233, 0.218);
    float variant = fract(seed * 7.31);
    float band;
    if (variant < 0.45) {
      band = smoothstep(core - 0.44, core - 0.41, aa);                      // two-row concrete-paver border strip
    } else if (variant < 0.75) {
      band = smoothstep(core - 0.23, core - 0.2, aa);                       // single row of setts
      layerB = ${GROUND_LAYER.setts};
      targetB = vec3(0.19, 0.185, 0.175);
      scaleB = 1.7;
    } else {
      // no edging: the asphalt frays into a gravel shoulder
      layerB = ${GROUND_LAYER.gravel};
      roadSpaceB = false;
      targetB = vec3(0.19, 0.17, 0.135);
      band = smoothstep(core - 0.45, core + 0.02, aa + (nEdge - 0.5) * 0.5) * 0.85;
    }
    band *= bandK;
    float rinne = flag * (1.0 - smoothstep(0.27, 0.3, aa));                // Am Kirchrain centre drainage channel
    if (rinne > 0.0) {
      layerB = ${GROUND_LAYER.pavers};
      roadSpaceB = true;
      targetB = vec3(0.24, 0.233, 0.218);
      scaleB = 1.0;
    }
    mixB = max(band, rinne);
    alpha = 1.0 - smoothstep(hw - 0.07, hw, aa + (nEdge - 0.5) * 0.06);
  } else if (prof == ${PROFILE.rural} || prof == ${PROFILE.lane}) {
    targetA = prof == ${PROFILE.rural} ? vec3(0.125, 0.126, 0.13) : vec3(0.135, 0.134, 0.134);
    alpha = 1.0 - smoothstep(core - 0.05, hw, aa + (nEdge - 0.5) * 0.4);
  } else if (prof == ${PROFILE.service}) {
    targetA = vec3(0.14, 0.135, 0.128);                                    // old, sun-bleached farm-track asphalt
    layerB = ${GROUND_LAYER.gravel};
    roadSpaceB = false;
    targetB = vec3(0.2, 0.172, 0.13);
    mixB = smoothstep(core - 0.55, core + 0.05, aa + (nEdge - 0.5) * 0.7) * 0.75;
    alpha = 1.0 - smoothstep(core - 0.1, hw, aa + (nEdge - 0.5) * 0.5);
    crackAmt = 1.0;
  } else if (prof == ${PROFILE.track}) {
    // Two wheel ruts of compacted gravel/earth; the middle strip and the verges stay the field's own grass.
    layerA = ${GROUND_LAYER.gravel};
    targetA = vec3(0.26, 0.226, 0.172);
    layerB = ${GROUND_LAYER.soil};
    roadSpaceB = false;
    targetB = vec3(0.17, 0.13, 0.09);
    float wob = (kdhNoise(vec2(al * 0.07, seed * 40.0)) - 0.5) * 0.3;
    float rut = 1.0 - smoothstep(0.24, 0.56, abs(aa - 0.74 + wob) + (nEdge - 0.5) * 0.3);
    float worn = smoothstep(0.52, 0.8, kdhFbm(wst * 0.05 + seed * 9.0));   // stretches driven bare across the full width
    float bare = max(rut, worn * (1.0 - smoothstep(1.1, 1.5, aa)) * smoothstep(0.3, 0.6, nEdge + 0.15));
    mixB = smoothstep(0.35, 0.75, kdhFbm(wst * 0.35 + 11.0)) * 0.45;
    alpha = bare * (0.76 + 0.2 * nGrit);
    asphalt = 0.0;
  } else if (prof == ${PROFILE.path}) {
    layerA = ${GROUND_LAYER.gravel};
    targetA = vec3(0.2, 0.172, 0.13);
    layerB = ${GROUND_LAYER.soil};
    roadSpaceB = false;
    targetB = vec3(0.13, 0.098, 0.066);
    mixB = smoothstep(0.3, 0.7, kdhFbm(wst * 0.4 + 3.0)) * 0.6;
    alpha = (1.0 - smoothstep(hw * 0.35, hw * 0.95, aa + (nEdge - 0.5) * 0.5)) * 0.9;
    asphalt = 0.0;
  } else {
    // Kerb + sidewalk mesh. flag = face type: 0 kerb face, 1 kerb top, 2 sidewalk, 3 outer skirt,
    // 4 retaining wall face, 5 wall coping.
    asphalt = 0.0;
    if (flag > 1.5 && flag < 2.5) {
      layerA = ${GROUND_LAYER.sidewalk};
      roadSpaceA = true;
      targetA = vec3(0.265, 0.258, 0.245) * (0.9 + 0.2 * nBlot);
    } else if (flag > 3.5 && flag < 4.5) {
      // dry-laid sandstone rubble: the sett scan at ~2.5x size reads as 20-35 cm field stones
      layerA = ${GROUND_LAYER.setts};
      wst = vst * 0.24;
      wdx = vdx * 0.24;
      wdy = vdy * 0.24;
      targetA = vec3(0.24, 0.195, 0.14) * (0.85 + 0.3 * nBlot);
    } else {
      // precast concrete kerbstones: the asphalt scan at 3x frequency reads as fine concrete
      bool upright = flag < 0.5 || (flag > 2.5 && flag < 3.5);
      wst = upright ? vst : wst * 3.0;
      wdx = upright ? vdx : wdx * 3.0;
      wdy = upright ? vdy : wdy * 3.0;
      targetA = flag > 2.5 ? vec3(0.15, 0.148, 0.142) : vec3(0.31, 0.305, 0.292);
    }
  }

  // ---- sample -------------------------------------------------------------------------------------
  vec3 aA;
  vec2 nA;
  float rA;
  if (roadSpaceA) kdhGroundSample(layerA, rst, rdx, rdy, kFar, aA, nA, rA);
  else kdhGroundSample(layerA, wst, wdx, wdy, kFar, aA, nA, rA);
  vec3 col = aA / max(uKdhGroundMean[layerA], vec3(0.01)) * targetA;
  vec2 nW = roadSpaceA ? dirR * nA.x + dirA * nA.y : nA;
  float rough = rA;
  if (mixB > 0.01) {
    vec3 aB;
    vec2 nB;
    float rB;
    if (roadSpaceB) kdhGroundSample(layerB, rst * scaleB, rdx * scaleB, rdy * scaleB, kFar, aB, nB, rB);
    else kdhGroundSample(layerB, wst, wdx, wdy, kFar, aB, nB, rB);
    col = mix(col, aB / max(uKdhGroundMean[layerB], vec3(0.01)) * targetB, mixB);
    nW = mix(nW, roadSpaceB ? dirR * nB.x + dirA * nB.y : nB, mixB);
    rough = mix(rough, rB, mixB);
    asphalt *= 1.0 - mixB;
  }

  // ---- asphalt life: tone blotches, repair patches with tar seams, wheel-polished lanes, cracks ----
  if (asphalt > 0.01) {
    float tone = 1.0 + (nBlot - 0.5) * 0.3 + (seed - 0.5) * 0.12;
    // Repair patches: rounded, slightly wobbly cut-outs of different size in a 2.6 x 7 m cell grid (road space),
    // a few centimetres of dark bitumen seal along the cut instead of a ruler-straight joint line.
    vec2 pcs = vec2(2.6, 7.0);
    vec2 pg = vec2(ac + 9.0 * pcs.x, al) / pcs;
    vec2 pcell = floor(pg);
    float isPatch = step(0.82, kdhHash(pcell + seed * 91.0));
    float seam = 0.0;
    if (isPatch > 0.5) {
      vec2 h2 = vec2(kdhHash(pcell + 3.7), kdhHash(pcell + 8.1));
      vec2 local = (fract(pg) - 0.5) * pcs - (h2 - 0.5) * vec2(0.5, 1.6);
      vec2 halfSize = pcs * 0.5 - vec2(0.25, 0.6) - h2.yx * vec2(0.55, 2.2);
      float rad = 0.25 + 0.35 * h2.x;
      vec2 q = abs(local) - halfSize + rad;
      float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
      sd += (kdhNoise(wst * 1.1 + seed * 17.0) - 0.5) * 0.09 + (kdhNoise(wst * 6.0) - 0.5) * 0.03;
      isPatch = 1.0 - smoothstep(-0.01, 0.01, sd);
      seam = 1.0 - smoothstep(0.01, 0.035, abs(sd));
    }
    tone -= isPatch * 0.14;
    float lane = exp(-pow((aa - core * 0.47) / 0.42, 2.0)) * step(2.0, core);
    tone *= 1.0 - 0.07 * lane;
    float crackField = smoothstep(0.5, 0.72, kdhNoise(wst * 0.06 + seed * 13.0));
    float crack = (1.0 - smoothstep(0.0, 0.014, abs(kdhNoise(wst * 0.55 + seed * 7.0) - 0.5))) * crackField * crackAmt;
    float lines = max(seam * 0.4, crack * 0.6) * fine;
    vec3 worn = col * tone;
    worn = mix(worn, worn * 0.42, lines);
    col = mix(col, worn, asphalt);
    rough = mix(rough, rough - 0.1 * lane - 0.12 * isPatch + 0.05 * lines, asphalt);
  }

  // ---- cast-iron street furniture: manhole covers in the lane, gully grates in the sett gutter --------------
  if (prof <= ${PROFILE.village}) {
    float iron = 0.0;
    float collar = 0.0;
    float ironTone = 1.0;
    // one manhole per ~46 m, at a hashed spot in one of the lanes
    float mCell = floor(al / 46.0 + seed * 7.0);
    float mAlong = (mCell + 0.25 + 0.5 * kdhHash(vec2(mCell, seed * 53.0)) - seed * 7.0) * 46.0;
    float mAcross = (kdhHash(vec2(mCell + 11.0, seed * 29.0)) - 0.5) * core * 1.1;
    vec2 mv = vec2(ac - mAcross, al - mAlong);
    float md = length(mv);
    if (md < 0.5) {
      iron = 1.0 - smoothstep(0.3, 0.312, md);
      collar = (1.0 - smoothstep(0.36, 0.375, md)) * (1.0 - iron);
      float rings = 0.5 + 0.5 * sin(md * 105.0);
      float spokes = 0.5 + 0.5 * sin(atan(mv.y, mv.x) * 16.0);
      ironTone = 0.75 + 0.5 * mix(rings, rings * spokes, smoothstep(0.08, 0.14, md)) * fine + 0.25 * (1.0 - fine);
    }
    // gully grate every ~31 m in the sett gutter of Hauptstraße (alternating sides)
    if (prof == ${PROFILE.urban} && bandK > 0.5) {
      float gCell = floor(al / 31.0 + seed * 3.0);
      float gAlong = (gCell + 0.5 - seed * 3.0) * 31.0;
      float side = mod(gCell, 2.0) < 0.5 ? 1.0 : -1.0;
      vec2 gv = vec2(ac * side - (core - 0.185), al - gAlong);
      float grate = (1.0 - smoothstep(0.135, 0.145, abs(gv.x))) * (1.0 - smoothstep(0.235, 0.245, abs(gv.y)));
      if (grate > 0.0) {
        float slots = step(0.5, fract(gv.y / 0.052)) * (1.0 - smoothstep(0.105, 0.11, abs(gv.x)));
        iron = max(iron, grate);
        ironTone = mix(1.0, 0.25, slots * fine);
      }
    }
    if (iron + collar > 0.001) {
      col = mix(col, vec3(0.2, 0.198, 0.19) * (0.85 + 0.3 * nGrit), collar);
      col = mix(col, vec3(0.055, 0.052, 0.05) * ironTone * (0.8 + 0.4 * nGrit), iron);
      rough = mix(rough, 0.55, iron);
      nW *= 1.0 - iron;
    }
  }

  // ---- markings -----------------------------------------------------------------------------------
  float mark = 0.0;
  if (prof == ${PROFILE.rural}) {
    mark = 1.0 - smoothstep(0.045, 0.055, abs(aa - (core - 0.2)));                // 12 cm solid edge lines (Fahrbahnbegrenzung)
  } else if (prof == ${PROFILE.urban}) {
    float dash = step(fract(al / 9.0), 1.0 / 3.0);                          // 3 m line, 6 m gap (Leitlinie innerorts)
    mark = (1.0 - smoothstep(0.05, 0.06, aa)) * dash * 0.62;
  }
  if (mark > 0.001) {
    float wornPaint = smoothstep(0.2, 0.55, kdhFbm(wst * 4.5) * 0.7 + nGrit * 0.45);   // paint flaked off by tyres
    mark *= mix(1.0, wornPaint, prof == ${PROFILE.urban} ? 0.9 : 0.55);
    col = mix(col, vec3(0.56, 0.56, 0.54) * (0.85 + 0.3 * nGrit), mark);
    rough = mix(rough, 0.62, mark);
    nW *= 1.0 - 0.6 * mark;
  }

  // ---- kerb / sidewalk details ----------------------------------------------------------------------
  if (prof == ${PROFILE.kerb}) {
    if (flag < 1.5) {
      float joint = 1.0 - smoothstep(0.004, 0.012, 0.5 - abs(fract(al) - 0.5));          // 1 m kerbstones
      col *= 1.0 - 0.5 * joint * fine;
      if (flag < 0.5) col *= 0.82;                                                          // face: dirt + self-shadow
    } else if (flag < 2.5) {
      float toWall = smoothstep(core + 0.3, hw, aa);
      col *= 1.0 - 0.14 * toWall * (0.5 + nEdge);                                           // grime gathers at the house wall
    }
  }

  // side streets end exactly at the Hauptstrasse carriageway edge (no asphalt over its gutter and kerbs)
  alpha *= smoothstep(-0.1, -0.04, vKdhClip);
  diffuseColor.rgb = col;
  diffuseColor.a *= clamp(alpha, 0.0, 1.0);
  float kNrm = 1.0 - smoothstep(uKdhRoadRange.x * 0.18, uKdhRoadRange.x, kDist);
  kdhWorldN = normalize(normalize(vKdhWorldNormal) + vec3(nW.x, 0.0, nW.y) * (0.9 * kNrm));
  kdhRough = rough;
}
`;

/** Shared by every road material: detail distances scaled by the quality level (`setQuality`). */
const ROAD_RANGE_UNIFORM = { value: new THREE.Vector2(140, 70) };

function createRoadMaterial(ground: GroundMaterialLibrary, decal: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.35,
    transparent: decal,
    depthWrite: !decal,
    polygonOffset: true,
    polygonOffsetFactor: decal ? -2 : -1,
    polygonOffsetUnits: decal ? -8 : -4,
  });
  // Appends after stock #include lines only (uKdh*/vKdh*/kdh* names), so further onBeforeCompile hooks can be chained.
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ground.uniforms);
    shader.uniforms.uKdhRoadRange = ROAD_RANGE_UNIFORM;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aKdhRoad;
        attribute vec4 aKdhRoadB;
        attribute vec2 aKdhRoadDir;
        attribute float aKdhClip;
        varying float vKdhClip;
        varying vec3 vKdhWorldPos;
        varying vec3 vKdhWorldNormal;
        varying vec4 vKdhRoad;
        varying vec4 vKdhRoadB;
        varying vec2 vKdhRoadDir;`
      )
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
        vKdhWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vKdhWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vKdhRoad = aKdhRoad;
        vKdhRoadB = aKdhRoadB;
        vKdhRoadDir = aKdhRoadDir;
        vKdhClip = aKdhClip;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROAD_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${ROAD_FRAGMENT_COLOR}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(kdhRough, 0.3, 1.0);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(kdhWorldN, 0.0)).xyz);`
      );
  };
  mat.customProgramCacheKey = () => `kdh-road-v3-${decal ? 'decal' : 'solid'}`;
  return mat;
}

function buildMesh(acc: RoadGeometryAccumulator, material: THREE.Material, name: string, ground: GroundMaterialLibrary): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normals, 3));
  geom.setAttribute('aKdhRoad', new THREE.Float32BufferAttribute(acc.road, 4));
  geom.setAttribute('aKdhRoadB', new THREE.Float32BufferAttribute(acc.roadB, 4));
  geom.setAttribute('aKdhRoadDir', new THREE.Float32BufferAttribute(acc.dir, 2));
  geom.setAttribute('aKdhClip', new THREE.Float32BufferAttribute(acc.clip, 1));
  geom.setIndex(acc.indices);
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
  const mesh = new THREE.Mesh(geom, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.onBeforeRender = (renderer) => ground.ensureUploaded(renderer);
  return mesh;
}

/**
 * Builds the real Kinderbach creek bridge on Triftstraße (sv_triftstrasse_south_vista.png):
 * reinforced-concrete bridge deck + curbs + galvanized vertical-bar steel pedestrian railings
 * on both sides + west concrete flood-wall pillars.
 */
function buildKinderbachBridge(terrain: TerrainSystem): THREE.Group {
  const g = new THREE.Group();
  g.name = 'KinderbachBridge_Triftstrasse';

  const { northX, northZ, southX, southZ } = KINDERBACH_BRIDGE;
  const dx = southX - northX;
  const dz = southZ - northZ;
  const spanLen = Math.hypot(dx, dz);
  const yN = terrain.getTerrainHeight(northX, northZ) + 0.08;
  const yS = terrain.getTerrainHeight(southX, southZ) + 0.08;
  const midX = (northX + southX) * 0.5;
  const midZ = (northZ + southZ) * 0.5;
  const midY = (yN + yS) * 0.5;
  const yaw = Math.atan2(dx, dz); // local +Z points from north to south along bridge

  const deckRoot = new THREE.Group();
  deckRoot.position.set(midX, midY, midZ);
  deckRoot.rotation.y = yaw;
  g.add(deckRoot);

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xa4a097,
    roughness: 0.9,
    metalness: 0.0,
  });
  const concreteDarkMat = new THREE.MeshStandardMaterial({
    color: 0x84817a,
    roughness: 0.92,
    metalness: 0.0,
  });
  const galvSteelMat = new THREE.MeshStandardMaterial({
    color: 0xaab0b6,
    roughness: 0.42,
    metalness: 0.58,
    envMapIntensity: 0.85,
  });

  // Solid underside concrete bridge slab + side girders spanning the creek channel
  const slab = new THREE.Mesh(new THREE.BoxGeometry(5.35, 0.55, spanLen + 1.0), concreteDarkMat);
  slab.position.set(0, -0.27, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  deckRoot.add(slab);

  // Left & right raised concrete edge curbs + galvanized vertical-bar steel railings
  const railHalfX = 2.48;
  const railHeight = 1.02;
  const railLen = spanLen - 0.6;
  const postGeo = new THREE.BoxGeometry(0.055, railHeight, 0.055);
  const balusterGeo = new THREE.BoxGeometry(0.022, railHeight - 0.16, 0.022);
  const topRailGeo = new THREE.BoxGeometry(0.065, 0.045, railLen);
  const botRailGeo = new THREE.BoxGeometry(0.045, 0.035, railLen);
  const curbGeo = new THREE.BoxGeometry(0.32, 0.16, spanLen + 0.6);

  const postPositions: THREE.Vector3[] = [];
  const balusterPositions: THREE.Vector3[] = [];

  for (const side of [-1, 1]) {
    const sx = side * railHalfX;
    const curb = new THREE.Mesh(curbGeo, concreteMat);
    curb.position.set(sx, 0.06, 0);
    curb.castShadow = true;
    curb.receiveShadow = true;
    deckRoot.add(curb);

    const topRail = new THREE.Mesh(topRailGeo, galvSteelMat);
    topRail.position.set(sx, railHeight + 0.08, 0);
    topRail.castShadow = true;
    deckRoot.add(topRail);

    const botRail = new THREE.Mesh(botRailGeo, galvSteelMat);
    botRail.position.set(sx, 0.22, 0);
    botRail.castShadow = true;
    deckRoot.add(botRail);

    const halfR = railLen * 0.5;
    for (let z = -halfR; z <= halfR + 0.05; z += 1.95) {
      postPositions.push(new THREE.Vector3(sx, railHeight * 0.5 + 0.08, Math.min(halfR, z)));
    }
    for (let z = -halfR + 0.18; z < halfR - 0.1; z += 0.24) {
      balusterPositions.push(new THREE.Vector3(sx, railHeight * 0.5 + 0.12, z));
    }
  }

  const dummy = new THREE.Object3D();
  const postsInst = new THREE.InstancedMesh(postGeo, galvSteelMat, postPositions.length);
  postsInst.castShadow = true;
  postsInst.receiveShadow = true;
  postPositions.forEach((p, idx) => {
    dummy.position.copy(p);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postsInst.setMatrixAt(idx, dummy.matrix);
  });
  postsInst.instanceMatrix.needsUpdate = true;
  deckRoot.add(postsInst);

  const balInst = new THREE.InstancedMesh(balusterGeo, galvSteelMat, balusterPositions.length);
  balInst.castShadow = true;
  balInst.receiveShadow = true;
  balusterPositions.forEach((p, idx) => {
    dummy.position.copy(p);
    dummy.updateMatrix();
    balInst.setMatrixAt(idx, dummy.matrix);
  });
  balInst.instanceMatrix.needsUpdate = true;
  deckRoot.add(balInst);

  // West-side concrete abutment / flood-wall pillars visible on right side of sv_triftstrasse_south_vista.png
  for (const [pz, w, h, d] of [
    [-5.8, 0.34, 1.12, 0.55],
    [-3.6, 0.42, 1.18, 1.65],
    [-1.4, 0.36, 1.14, 0.72],
  ] as [number, number, number, number][]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concreteMat);
    pillar.position.set(-2.95, h * 0.5 - 0.05, pz);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    deckRoot.add(pillar);
  }

  return g;
}

/**
 * Draped white painted "30" zone marking at Triftstraße north entry (sv_triftstrasse_north_entry.png).
 */
function buildTriftstrasseZone30Decal(terrain: TerrainSystem, maxAnisotropy: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(232, 233, 228, 0.84)';
  ctx.font = '800 162px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('30', 128, 134);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    roughness: 0.9,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
  });

  const x = -316.2;
  const z = 76.2;
  const y = terrain.getTerrainHeight(x, z) + 0.145;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 2.25), mat);
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.rotation.z = Math.PI - 0.18; // upright facing southbound camera along Triftstraße (~170°)
  mesh.position.set(x, y, z);
  mesh.renderOrder = 6;
  mesh.name = 'Triftstrasse_Zone30_Marking';
  return mesh;
}

export function buildRoadNetwork(
  roads: RoadRecord[],
  terrain: TerrainSystem,
  maxAnisotropy: number
): THREE.Group {
  const ground = terrain.ground;
  if (!ground) {
    throw new Error('buildRoadNetwork: terrain.loadTextures() must finish first (the roads share its ground texture arrays)');
  }

  const group = new THREE.Group();
  group.name = 'KindenheimRoads';

  const decals: Record<DecalTier, RoadGeometryAccumulator> = {
    path: createAccumulator(),
    track: createAccumulator(),
    service: createAccumulator(),
    lane: createAccumulator(),
    village: createAccumulator(),
    rural: createAccumulator(),
    urban: createAccumulator(),
  };
  const kerbs = createAccumulator();

  interface Prepared {
    road: RoadRecord;
    base: NonNullable<ReturnType<typeof classifyRoadBase>>;
    pts: [number, number][];
    widthM: number;
    roadIndex: number;
  }
  const prepared: Prepared[] = [];
  const junctions = new JunctionIndex(); // everything that can join Hauptstraße (kerbs drop there)
  const paved = new JunctionIndex(); // all asphalt surfaces (edge bands stop where another one crosses)
  const highwayEnds: [number, number][] = [];

  for (const road of roads) {
    if (!road.points || road.points.length < 2) continue;
    const base = classifyRoadBase(road);
    if (!base) continue;
    const pts = resamplePolyline(road.points.map(extractXZ), ALONG_STEP_M);
    if (pts.length < 2) continue;
    const fallback = base === 'highway' ? 7.2 : base === 'lane' ? 5.8 : base === 'village' ? 5.0 : base === 'service' ? 3.4 : base === 'track' ? 3.2 : 1.8;
    const widthM = road.widthM && road.widthM > 1 ? road.widthM : fallback;
    const roadIndex = prepared.length;
    prepared.push({ road, base, pts, widthM, roadIndex });
    if (base === 'highway') {
      highwayEnds.push(pts[0], pts[pts.length - 1]);
    } else {
      junctions.add(pts, widthM * 0.5, roadIndex);
    }
    if (base === 'highway' || base === 'lane' || base === 'village' || base === 'service') {
      paved.add(pts, widthM * 0.5, roadIndex);
    }
  }

  // A way end "continues" when another highway way ends at the same node (every end is in the list once itself).
  const continuesAt = (p: [number, number]): boolean => {
    let hits = 0;
    for (const e of highwayEnds) {
      if (Math.hypot(e[0] - p[0], e[1] - p[1]) < 1.0) hits++;
    }
    return hits >= 2;
  };

  const obstacles = new ObstacleIndex(getGroundObstacles());
  const urban = new UrbanIndex();
  const stats = { urbanShiftedM: 0, urbanNarrowedM: 0, sideNarrowedM: 0 };

  // Pass 1: L 450 / Hauptstraße (the side streets are cut against its final layout).
  for (const { road, base, pts, widthM, roadIndex } of prepared) {
    if (base !== 'highway') continue;
    const seed = hashSeed(road.id, 17);
    const runs = splitRuns(pts, (x, z) => (isInsideUrbanVillage(x, z) ? 'urban' : 'rural'));
    runs.forEach((run) => {
      if (run.tier === 'urban') {
        // 7.2 m between the house fronts: 5.1 m carriageway incl. 2 x 0.33 m sett gutter, kerb, ~1.2 m sidewalks
        const core0 = THREE.MathUtils.clamp(widthM * 0.5 - 1.05, 2.2, 3.2);
        const relaxed = relaxPolyline(run.pts, 6);
        const lay = layoutUrbanRun(relaxed, core0, obstacles);
        lay.pts.forEach((p, i) => {
          if (Math.hypot(p[0] - relaxed[i][0], p[1] - relaxed[i][1]) > 0.1) stats.urbanShiftedM += ALONG_STEP_M;
          if (Math.min(lay.core[0][i], lay.core[1][i]) < core0 - 0.05) stats.urbanNarrowedM += ALONG_STEP_M;
        });
        appendDecal(
          decals.urban,
          lay.pts,
          {
            profile: PROFILE.urban,
            halfWidth: core0 + 0.04,
            core: core0,
            seed,
            flag: 0,
            paved,
            roadIndex,
            sideCore: lay.core,
            sideHalfWidth: [lay.core[0].map((c) => c + 0.04), lay.core[1].map((c) => c + 0.04)],
          },
          terrain
        );
        const first = run.pts[0];
        const last = run.pts[run.pts.length - 1];
        const openStart = !(first === pts[0] && continuesAt(first));
        const openEnd = !(last === pts[pts.length - 1] && continuesAt(last));
        appendKerbs(kerbs, lay.pts, lay.core, lay.outer, seed, junctions, openStart, openEnd, terrain, urban, obstacles);
      } else {
        // real L 450: ~6 m of asphalt between the white edge lines, soft grass verge
        const core = THREE.MathUtils.clamp(widthM * 0.5 - 0.45, 2.6, 3.6);
        appendDecal(decals.rural, run.pts, { profile: PROFILE.rural, halfWidth: core + 0.45, core, seed, flag: 0 }, terrain);
      }
    });
  }

  // Pass 2: everything else, narrowed against facades and cut off at the Hauptstraße gutter line.
  const narrowed = (pts: [number, number][], halfWidth: number, minHalf: number): [number[], number[]] => {
    const sides = clearHalfWidths(buildSections(pts), halfWidth, minHalf, obstacles);
    sides[0].forEach((v, i) => {
      if (Math.min(v, sides[1][i]) < halfWidth - 0.05) stats.sideNarrowedM += ALONG_STEP_M;
    });
    return sides;
  };
  for (const { road, base, pts, widthM, roadIndex } of prepared) {
    if (base === 'highway') continue;
    const seed = hashSeed(road.id, 17);

    if (base === 'village') {
      const w = THREE.MathUtils.clamp(widthM, 3.8, 7.5);
      const kirchrain = (road.name ?? '').toLowerCase().includes('kirchrain');
      const runs = kirchrain
        ? splitRuns(pts, (x, z) => (isKirchrainRinnePoint(x, z) ? 'rinne' : 'plain'))
        : [{ tier: 'plain' as const, pts }];
      for (const run of runs) {
        const halfWidth = w * 0.5 + 0.06;
        appendDecal(
          decals.village,
          run.pts,
          {
            profile: PROFILE.village,
            halfWidth,
            core: w * 0.5,
            seed,
            flag: run.tier === 'rinne' ? 1 : 0,
            paved,
            roadIndex,
            sideHalfWidth: narrowed(run.pts, halfWidth, 1.5),
            urban,
          },
          terrain
        );
      }
      continue;
    }

    if (base === 'lane') {
      const core = THREE.MathUtils.clamp(widthM, 4.0, 8.0) * 0.5 - 0.2;
      const halfWidth = core + 0.45;
      appendDecal(
        decals.lane,
        pts,
        { profile: PROFILE.lane, halfWidth, core, seed, flag: 0, sideHalfWidth: narrowed(pts, halfWidth, 1.8), urban },
        terrain
      );
    } else if (base === 'service') {
      const core = THREE.MathUtils.clamp(widthM, 2.4, 6.0) * 0.5 - 0.1;
      const halfWidth = core + 0.4;
      appendDecal(
        decals.service,
        pts,
        { profile: PROFILE.service, halfWidth, core, seed, flag: 0, sideHalfWidth: narrowed(pts, halfWidth, 1.1), urban },
        terrain
      );
    } else if (base === 'track') {
      const hw = THREE.MathUtils.clamp(widthM, 2.6, 4.0) * 0.5;
      appendDecal(decals.track, pts, { profile: PROFILE.track, halfWidth: hw, core: hw, seed, flag: 0, urban }, terrain);
    } else {
      const hw = Math.min(widthM, 2.1) * 0.5;
      appendDecal(decals.path, pts, { profile: PROFILE.path, halfWidth: hw, core: hw, seed, flag: 0, urban }, terrain);
    }
  }

  const decalMaterial = createRoadMaterial(ground, true);
  const kerbMaterial = createRoadMaterial(ground, false);

  (Object.keys(decals) as DecalTier[]).forEach((tier) => {
    const acc = decals[tier];
    if (acc.indices.length === 0) return;
    const mesh = buildMesh(acc, decalMaterial, `Roads_${tier}`, ground);
    mesh.renderOrder = DECAL_RENDER_ORDER[tier];
    group.add(mesh);
  });
  if (kerbs.indices.length > 0) {
    group.add(buildMesh(kerbs, kerbMaterial, 'Roads_kerbs_sidewalks', ground));
  }

  group.add(buildKinderbachBridge(terrain));
  group.add(buildTriftstrasseZone30Decal(terrain, maxAnisotropy));

  /** Height of the raised Hauptstraße sidewalk / kerb above `terrain.getTerrainHeight` (0 elsewhere), for wheels. */
  group.userData.getSurfaceLift = (x: number, z: number): number => urban.surfaceLift(x, z);
  /** How much road geometry was moved / narrowed to keep clear of facades (metres of road, for reports). */
  group.userData.facadeClearance = stats;
  /**
   * Quality contract: scales the distance up to which normal maps and thin procedural detail (patch seams,
   * cracks, iron covers) are drawn; footpath decals are dropped on 'low'.
   */
  group.userData.setQuality = (level: string): void => {
    const range: Record<string, [number, number]> = { low: [60, 35], medium: [100, 55], high: [140, 70], ultra: [180, 90] };
    const r = range[level];
    if (!r) throw new Error(`Roads: unknown quality level "${level}"`);
    ROAD_RANGE_UNIFORM.value.set(r[0], r[1]);
    const paths = group.getObjectByName('Roads_path');
    if (paths) paths.visible = level !== 'low';
  };

  return group;
}
