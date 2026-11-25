import * as THREE from 'three';
import type { TerrainSystem } from './terrain';
import type { RoadRecord } from './types';

type RoadTier = 'highway_urban' | 'highway_rural' | 'village' | 'village_rinne' | 'service' | 'track';

interface TierStyle {
  defaultWidth: number;
  yOffset: number;
  polygonOffsetFactor: number;
  roughness: number;
  uvRepeatLengthM: number;
}

const TIER_STYLES: Record<RoadTier, TierStyle> = {
  highway_urban: {
    defaultWidth: 6.4,
    yOffset: 0.11,
    polygonOffsetFactor: -3,
    roughness: 0.82,
    uvRepeatLengthM: 14,
  },
  highway_rural: {
    defaultWidth: 6.2,
    yOffset: 0.11,
    polygonOffsetFactor: -3,
    roughness: 0.80,
    uvRepeatLengthM: 16,
  },
  village: {
    defaultWidth: 4.8,
    yOffset: 0.09,
    polygonOffsetFactor: -2,
    roughness: 0.85,
    uvRepeatLengthM: 11,
  },
  village_rinne: {
    defaultWidth: 4.8,
    yOffset: 0.092,
    polygonOffsetFactor: -2.2,
    roughness: 0.85,
    uvRepeatLengthM: 11,
  },
  service: {
    defaultWidth: 3.3,
    yOffset: 0.075,
    polygonOffsetFactor: -1.5,
    roughness: 0.88,
    uvRepeatLengthM: 10,
  },
  track: {
    defaultWidth: 3.0,
    yOffset: 0.06,
    polygonOffsetFactor: -1,
    roughness: 0.94,
    uvRepeatLengthM: 10,
  },
};

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

function classifyRoadBase(road: RoadRecord): 'highway' | 'village' | 'service' | 'track' | null {
  const hw = (road.highway || '').toLowerCase();
  const surf = (road.surface || '').toLowerCase();
  if (hw === 'primary' || hw === 'primary_link' || hw === 'trunk' || hw === 'secondary' || hw === 'secondary_link') {
    return 'highway';
  }
  if (hw === 'tertiary' || hw === 'tertiary_link' || hw === 'residential' || hw === 'living_street' || hw === 'unclassified' || hw === 'road') {
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
    return 'track';
  }
  return null;
}

function createRoadTexture(tier: RoadTier, maxAnisotropy: number): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  let seed =
    tier === 'highway_urban'
      ? 101
      : tier === 'highway_rural'
        ? 151
        : tier === 'village'
          ? 202
          : tier === 'village_rinne'
            ? 252
            : tier === 'service'
              ? 303
              : 404;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967295;
  };

  if (tier === 'highway_urban') {
    // Authentic Aug-2023 Kindenheim Hauptstraße (L 450): sun-bleached medium-gray asphalt + granite curb + warm buff concrete-paver sidewalks
    ctx.fillStyle = '#6c6f74';
    ctx.fillRect(0, 0, w, h);

    const wearGrad = ctx.createLinearGradient(0, 0, w, 0);
    wearGrad.addColorStop(0.0, '#b4ada2');
    wearGrad.addColorStop(0.12, '#aca59a');
    wearGrad.addColorStop(0.145, '#918d85');
    wearGrad.addColorStop(0.17, '#707378');
    wearGrad.addColorStop(0.32, '#64676c');
    wearGrad.addColorStop(0.5, '#72757a');
    wearGrad.addColorStop(0.68, '#64676c');
    wearGrad.addColorStop(0.83, '#707378');
    wearGrad.addColorStop(0.855, '#918d85');
    wearGrad.addColorStop(0.88, '#aca59a');
    wearGrad.addColorStop(1.0, '#b4ada2');
    ctx.fillStyle = wearGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle interlocking concrete-paver grid on sidewalks + crisp curb shadow
    ctx.fillStyle = 'rgba(58, 54, 50, 0.25)';
    for (let y = 0; y < h; y += 11) {
      ctx.fillRect(0, y, 36, 1.5);
      ctx.fillRect(w - 36, y, 36, 1.5);
    }
    ctx.fillStyle = 'rgba(46, 46, 48, 0.38)';
    ctx.fillRect(35, 0, 2.5, h);
    ctx.fillRect(w - 37.5, 0, 2.5, h);

    for (let i = 0; i < 18000; i++) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * h);
      const v = 88 + Math.floor(rand() * 52);
      ctx.fillStyle = `rgba(${v},${v},${v - 1},0.26)`;
      ctx.fillRect(x, y, 2, 2);
    }
  } else if (tier === 'highway_rural') {
    // Real rural L 450 (sv_vineyard_edge_east.png): sun-bleached medium-light gray asphalt + crisp solid white edge stripes ONLY (no dashed center line!)
    ctx.clearRect(0, 0, w, h);
    const wearGrad = ctx.createLinearGradient(0, 0, w, 0);
    wearGrad.addColorStop(0.0, 'rgba(96, 102, 76, 0.0)');
    wearGrad.addColorStop(0.045, 'rgba(112, 114, 106, 0.90)');
    wearGrad.addColorStop(0.09, 'rgba(122, 125, 128, 1.0)');
    wearGrad.addColorStop(0.28, 'rgba(110, 113, 117, 1.0)');
    wearGrad.addColorStop(0.50, 'rgba(124, 127, 130, 1.0)');
    wearGrad.addColorStop(0.72, 'rgba(110, 113, 117, 1.0)');
    wearGrad.addColorStop(0.91, 'rgba(122, 125, 128, 1.0)');
    wearGrad.addColorStop(0.955, 'rgba(112, 114, 106, 0.90)');
    wearGrad.addColorStop(1.0, 'rgba(96, 102, 76, 0.0)');
    ctx.fillStyle = wearGrad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 18000; i++) {
      const x = 12 + Math.floor(rand() * (w - 24));
      const y = Math.floor(rand() * h);
      const v = 96 + Math.floor(rand() * 56);
      ctx.fillStyle = `rgba(${v},${v},${v + 1},0.28)`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Crisp German solid white edge lines (Fahrbahnbegrenzung) matching sv_vineyard_edge_east.png
    ctx.fillStyle = 'rgba(240, 242, 238, 0.92)';
    ctx.fillRect(19, 0, 6.5, h);
    ctx.fillRect(w - 25.5, 0, 6.5, h);
  } else if (tier === 'village' || tier === 'village_rinne') {
    // Authentic medium-gray Pfalz residential asphalt (Triftstraße / Am Kirchrain / Judenberg / Neugasse / Burgweg) with warm concrete border strip
    ctx.fillStyle = '#686a6d';
    ctx.fillRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.0, '#9e988d');
    grad.addColorStop(0.105, '#727477');
    grad.addColorStop(0.32, '#64666a');
    grad.addColorStop(0.5, '#6b6d70');
    grad.addColorStop(0.68, '#64666a');
    grad.addColorStop(0.895, '#727477');
    grad.addColorStop(1.0, '#9e988d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(48,45,40,0.28)';
    for (let y = 0; y < h; y += 14) {
      ctx.fillRect(0, y, 24, 1.5);
      ctx.fillRect(w - 24, y, 24, 1.5);
    }

    for (let i = 0; i < 14000; i++) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * h);
      const v = 86 + Math.floor(rand() * 44);
      ctx.fillStyle = `rgba(${v},${v},${v - 1},0.25)`;
      ctx.fillRect(x, y, 2, 2);
    }

    if (tier === 'village_rinne') {
      // Distinctive central double-row gray concrete paver drainage gutter (Rinne) down Am Kirchrain north slope
      const cx = w * 0.5;
      ctx.fillStyle = '#979288';
      ctx.fillRect(cx - 10, 0, 20, h);
      ctx.fillStyle = 'rgba(46, 44, 40, 0.45)';
      ctx.fillRect(cx - 10.5, 0, 1.5, h);
      ctx.fillRect(cx - 0.75, 0, 1.5, h);
      ctx.fillRect(cx + 9, 0, 1.5, h);
      for (let y = 0; y < h; y += 13) {
        ctx.fillRect(cx - 10, y, 20, 1.4);
      }
    }
  } else if (tier === 'service') {
    ctx.fillStyle = '#6b6760';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 12000; i++) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * h);
      const v = 82 + Math.floor(rand() * 52);
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},0.32)`;
      ctx.fillRect(x, y, 2, 2);
    }
  } else {
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.0, 'rgba(108, 119, 77, 0.0)');
    grad.addColorStop(0.08, 'rgba(138, 128, 92, 0.78)');
    grad.addColorStop(0.18, 'rgba(166, 148, 114, 0.96)');
    grad.addColorStop(0.32, 'rgba(154, 134, 98, 0.96)');
    grad.addColorStop(0.45, 'rgba(116, 122, 78, 0.86)');
    grad.addColorStop(0.5, 'rgba(102, 118, 69, 0.82)');
    grad.addColorStop(0.55, 'rgba(116, 122, 78, 0.86)');
    grad.addColorStop(0.68, 'rgba(154, 134, 98, 0.96)');
    grad.addColorStop(0.82, 'rgba(166, 148, 114, 0.96)');
    grad.addColorStop(0.92, 'rgba(138, 128, 92, 0.78)');
    grad.addColorStop(1.0, 'rgba(108, 119, 77, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 16000; i++) {
      const x = 14 + Math.floor(rand() * (w - 28));
      const y = Math.floor(rand() * h);
      const distCenter = Math.abs(x - w * 0.5) / (w * 0.5);
      if (distCenter < 0.24 || distCenter > 0.84) {
        const g = 88 + Math.floor(rand() * 48);
        ctx.fillStyle = `rgba(${g - 18},${g},${g - 38},0.28)`;
      } else {
        const s = 128 + Math.floor(rand() * 64);
        ctx.fillStyle = `rgba(${s},${s - 14},${s - 34},0.32)`;
      }
      ctx.fillRect(x, y, 2, 3);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function extractXZ(pt: [number, number] | [number, number, number]): [number, number] {
  if (pt.length === 3) {
    return [pt[0], pt[2]];
  }
  return [pt[0], pt[1]];
}

function resamplePolyline(rawPts: [number, number][], maxStepM = 4.5): [number, number][] {
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

function splitHighwayUrbanRural(pts: [number, number][]): { tier: 'highway_urban' | 'highway_rural'; pts: [number, number][] }[] {
  if (pts.length < 2) return [];
  const runs: { tier: 'highway_urban' | 'highway_rural'; pts: [number, number][] }[] = [];
  let curTier: 'highway_urban' | 'highway_rural' = isInsideUrbanVillage(pts[0][0], pts[0][1])
    ? 'highway_urban'
    : 'highway_rural';
  let curPts: [number, number][] = [pts[0]];

  for (let i = 1; i < pts.length; i++) {
    const segMidX = (pts[i - 1][0] + pts[i][0]) * 0.5;
    const segMidZ = (pts[i - 1][1] + pts[i][1]) * 0.5;
    const nextTier: 'highway_urban' | 'highway_rural' = isInsideUrbanVillage(segMidX, segMidZ)
      ? 'highway_urban'
      : 'highway_rural';
    if (nextTier !== curTier) {
      if (curPts.length >= 2) {
        runs.push({ tier: curTier, pts: curPts });
      }
      curTier = nextTier;
      curPts = [pts[i - 1], pts[i]];
    } else {
      curPts.push(pts[i]);
    }
  }
  if (curPts.length >= 2) {
    runs.push({ tier: curTier, pts: curPts });
  }
  return runs;
}

interface GeometryAccumulator {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function createAccumulator(): GeometryAccumulator {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function appendRoadRibbon(
  acc: GeometryAccumulator,
  pts: [number, number][],
  widthM: number,
  style: TierStyle,
  terrain: TerrainSystem
): void {
  const halfW = widthM * 0.5;
  const n = pts.length;
  if (n < 2) return;

  const baseVertex = acc.positions.length / 3;
  let distAlong = 0;

  for (let i = 0; i < n; i++) {
    const [cx, cz] = pts[i];
    if (i > 0) {
      distAlong += Math.hypot(cx - pts[i - 1][0], cz - pts[i - 1][1]);
    }

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
    const tLen = Math.hypot(tx, tz) || 1;
    tx /= tLen;
    tz /= tLen;

    const rx = -tz;
    const rz = tx;

    const lx = cx - rx * halfW;
    const lz = cz - rz * halfW;
    const rpx = cx + rx * halfW;
    const rpz = cz + rz * halfW;

    const sampleH = (px: number, pz: number): number => {
      const bridgeH = getBridgeDeckSurfaceHeight(px, pz, terrain);
      return bridgeH !== null ? bridgeH : terrain.getTerrainHeight(px, pz);
    };

    const hCenter = sampleH(cx, cz) + style.yOffset + 0.03;
    const hLeft = sampleH(lx, lz) + style.yOffset;
    const hRight = sampleH(rpx, rpz) + style.yOffset;

    const onBridge = getBridgeDeckSurfaceHeight(cx, cz, terrain) !== null;
    const nC = onBridge ? new THREE.Vector3(0, 1, 0) : terrain.getTerrainNormal(cx, cz, 2.5);
    const vCoord = distAlong / style.uvRepeatLengthM;

    acc.positions.push(lx, hLeft, lz, cx, hCenter, cz, rpx, hRight, rpz);
    acc.normals.push(nC.x, nC.y, nC.z, nC.x, nC.y, nC.z, nC.x, nC.y, nC.z);
    acc.uvs.push(0, vCoord, 0.5, vCoord, 1, vCoord);

    if (i < n - 1) {
      const r0 = baseVertex + i * 3;
      const r1 = r0 + 3;
      acc.indices.push(r0, r0 + 1, r1);
      acc.indices.push(r0 + 1, r1 + 1, r1);
      acc.indices.push(r0 + 1, r0 + 2, r1 + 1);
      acc.indices.push(r0 + 2, r1 + 2, r1 + 1);
    }
  }
}

function splitKirchrainRinne(pts: [number, number][]): { tier: 'village' | 'village_rinne'; pts: [number, number][] }[] {
  if (pts.length < 2) return [];
  const runs: { tier: 'village' | 'village_rinne'; pts: [number, number][] }[] = [];
  let curTier: 'village' | 'village_rinne' = isKirchrainRinnePoint(pts[0][0], pts[0][1]) ? 'village_rinne' : 'village';
  let curPts: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) * 0.5;
    const mz = (pts[i - 1][1] + pts[i][1]) * 0.5;
    const nextTier: 'village' | 'village_rinne' = isKirchrainRinnePoint(mx, mz) ? 'village_rinne' : 'village';
    if (nextTier !== curTier) {
      if (curPts.length >= 2) runs.push({ tier: curTier, pts: curPts });
      curTier = nextTier;
      curPts = [pts[i - 1], pts[i]];
    } else {
      curPts.push(pts[i]);
    }
  }
  if (curPts.length >= 2) runs.push({ tier: curTier, pts: curPts });
  return runs;
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
  const group = new THREE.Group();
  group.name = 'KindenheimRoads';

  const accumulators: Record<RoadTier, GeometryAccumulator> = {
    highway_urban: createAccumulator(),
    highway_rural: createAccumulator(),
    village: createAccumulator(),
    village_rinne: createAccumulator(),
    service: createAccumulator(),
    track: createAccumulator(),
  };

  for (const road of roads) {
    if (!road.points || road.points.length < 2) continue;
    const baseTier = classifyRoadBase(road);
    if (!baseTier) continue;

    const xzPts = road.points.map(extractXZ);
    const resampled = resamplePolyline(xzPts, 4.5);
    if (resampled.length < 2) continue;

    if (baseTier === 'highway') {
      const subRuns = splitHighwayUrbanRural(resampled);
      for (const run of subRuns) {
        const style = TIER_STYLES[run.tier];
        const widthM = THREE.MathUtils.clamp(road.widthM && road.widthM > 1 ? road.widthM : style.defaultWidth, 4.5, 9.5);
        appendRoadRibbon(accumulators[run.tier], run.pts, widthM, style, terrain);
      }
      continue;
    }

    if (baseTier === 'village' && (road.name ?? '').toLowerCase().includes('kirchrain')) {
      const subRuns = splitKirchrainRinne(resampled);
      for (const run of subRuns) {
        const style = TIER_STYLES[run.tier];
        const widthM = THREE.MathUtils.clamp(road.widthM && road.widthM > 1 ? road.widthM : style.defaultWidth, 3.8, 7.5);
        appendRoadRibbon(accumulators[run.tier], run.pts, widthM, style, terrain);
      }
      continue;
    }

    const style = TIER_STYLES[baseTier];
    let widthM = road.widthM && road.widthM > 1 ? road.widthM : style.defaultWidth;
    if (road.highway === 'footway' || road.highway === 'path') {
      widthM = Math.min(widthM, 2.1);
    }
    widthM = THREE.MathUtils.clamp(widthM, 1.8, 10.0);

    appendRoadRibbon(accumulators[baseTier], resampled, widthM, style, terrain);
  }

  const tiers: RoadTier[] = ['track', 'service', 'village', 'village_rinne', 'highway_rural', 'highway_urban'];
  for (const tier of tiers) {
    const acc = accumulators[tier];
    if (acc.indices.length === 0) continue;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uvs, 2));
    geom.setIndex(acc.indices);
    geom.computeBoundingSphere();

    const style = TIER_STYLES[tier];
    const tex = createRoadTexture(tier, maxAnisotropy);
    const usesAlphaEdge = tier === 'track' || tier === 'highway_rural';
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: style.roughness,
      metalness: 0.0,
      envMapIntensity: 0.32,
      transparent: usesAlphaEdge,
      depthWrite: !usesAlphaEdge,
      polygonOffset: true,
      polygonOffsetFactor: style.polygonOffsetFactor,
      polygonOffsetUnits: style.polygonOffsetFactor,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `Roads_${tier}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder =
      tier === 'highway_urban'
        ? 5
        : tier === 'highway_rural'
          ? 4
          : tier === 'village' || tier === 'village_rinne'
            ? 3
            : tier === 'service'
              ? 2
              : 1;
    group.add(mesh);
  }

  group.add(buildKinderbachBridge(terrain));
  group.add(buildTriftstrasseZone30Decal(terrain, maxAnisotropy));

  return group;
}
