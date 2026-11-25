import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BuildingCollider } from './collision';
import type { TerrainSystem } from './terrain';
import { resolveAssetUrl } from './url';

// Exclusion zones so random trees/vines/crops/hay bales never spawn on pitches or playground
export const RECREATION_EXCLUSION_POLYS: [number, number][][] = [
  // Main Fußballplatz + North Sportheim + Stehtraversen
  [
    [3, -327],
    [89, -365],
    [110, -301],
    [25, -271],
  ],
  // East Kleinfeld Rasen-Trainingsplatz
  [
    [91, -354],
    [121, -358],
    [133, -299],
    [106, -297],
  ],
  // Kinderspielplatz Kindenheim enclosure
  [
    [57, -267],
    [91, -269],
    [90, -223],
    [58, -222],
  ],
];

const PITCH_CX = 56.5;
const PITCH_CZ = -314.5;
const PITCH_ROT = 0.376;
const PITCH_DIR_X = Math.cos(PITCH_ROT);
const PITCH_DIR_Z = -Math.sin(PITCH_ROT);
const PITCH_PERP_X = Math.sin(PITCH_ROT);
const PITCH_PERP_Z = Math.cos(PITCH_ROT);

const KLEIN_CX = 110.5;
const KLEIN_CZ = -326.5;

function localToWorld(
  cx: number,
  cz: number,
  rotY: number,
  u: number,
  v: number
): [number, number] {
  const dx = Math.cos(rotY);
  const dz = -Math.sin(rotY);
  const px = Math.sin(rotY);
  const pz = Math.cos(rotY);
  return [cx + u * dx + v * px, cz + u * dz + v * pz];
}

function pitchToWorld(u: number, v: number): [number, number] {
  return [
    PITCH_CX + u * PITCH_DIR_X + v * PITCH_PERP_X,
    PITCH_CZ + u * PITCH_DIR_Z + v * PITCH_PERP_Z,
  ];
}

function makeRotatedRectPoly(cx: number, cz: number, rotY: number, halfW: number, halfD: number): [number, number][] {
  return [
    localToWorld(cx, cz, rotY, -halfW, -halfD),
    localToWorld(cx, cz, rotY, +halfW, -halfD),
    localToWorld(cx, cz, rotY, +halfW, +halfD),
    localToWorld(cx, cz, rotY, -halfW, +halfD),
  ];
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

function createTerrainDrapedPatch(
  name: string,
  cx: number,
  cz: number,
  rotY: number,
  widthU: number,
  depthV: number,
  segsU: number,
  segsV: number,
  yOffset: number,
  material: THREE.Material,
  terrain: TerrainSystem,
  renderOrder = 1
): THREE.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segsV; iv++) {
    const tv = iv / segsV;
    const v = (tv - 0.5) * depthV;
    for (let iu = 0; iu <= segsU; iu++) {
      const tu = iu / segsU;
      const u = (tu - 0.5) * widthU;
      const [wx, wz] = localToWorld(cx, cz, rotY, u, v);
      const wy = terrain.getTerrainHeight(wx, wz) + yOffset;
      const n = terrain.getTerrainNormal(wx, wz, 2.5);
      positions.push(wx, wy, wz);
      normals.push(n.x, n.y, n.z);
      uvs.push(tu, 1.0 - tv);
    }
  }

  const stride = segsU + 1;
  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const i00 = iv * stride + iu;
      const i10 = i00 + 1;
      const i01 = i00 + stride;
      const i11 = i01 + 1;
      indices.push(i00, i01, i10);
      indices.push(i10, i01, i11);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeBoundingSphere();

  const mesh = new THREE.Mesh(geom, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

// ---------------------------------------------------------------------------
// Procedural Ground Surface & Texture Generators
// ---------------------------------------------------------------------------

function createMainHartplatzTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const W = 2048;
  const H = 1280;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(192007);

  // Warm Pfalz Rotasche / Tennenplatz clay base calibrated to DOP20
  ctx.fillStyle = '#b9997b';
  ctx.fillRect(0, 0, W, H);

  // Subtle dragged clay grading bands & multi-scale mineral variation for eye-level tactility
  for (let i = 0; i < 420; i++) {
    const px = rand() * W;
    const py = rand() * H;
    const rx = 22 + rand() * 85;
    const ry = 10 + rand() * 34;
    const shade = rand() > 0.5 ? 'rgba(198, 166, 134, 0.08)' : 'rgba(154, 124, 96, 0.08)';
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, (rand() - 0.5) * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  // Subtle longitudinal maintenance rake tracks
  ctx.strokeStyle = 'rgba(162, 132, 104, 0.09)';
  ctx.lineWidth = 4;
  for (let y = 18; y < H; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const centerWear = ctx.createRadialGradient(W * 0.5, H * 0.5, 10, W * 0.5, H * 0.5, W * 0.34);
  centerWear.addColorStop(0, 'rgba(152, 120, 93, 0.22)');
  centerWear.addColorStop(1, 'rgba(152, 120, 93, 0)');
  ctx.fillStyle = centerWear;
  ctx.fillRect(0, 0, W, H);

  for (const gxFrac of [0.06, 0.94]) {
    const gw = ctx.createRadialGradient(W * gxFrac, H * 0.5, 8, W * gxFrac, H * 0.5, 140);
    gw.addColorStop(0, 'rgba(138, 108, 84, 0.30)');
    gw.addColorStop(1, 'rgba(138, 108, 84, 0)');
    ctx.fillStyle = gw;
    ctx.fillRect(0, 0, W, H);
  }

  // Fine granular mineral grit
  for (let i = 0; i < 95000; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    const d = Math.floor((rand() - 0.5) * 44);
    ctx.fillStyle = `rgba(${184 + d},${150 + d},${120 + d},0.34)`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Crisp bright white chalk markings: outer 89m x 56m -> pitch 82m x 50m
  const pxPerM_X = W / 89.0;
  const pxPerM_Y = H / 56.0;
  const mx = (u: number) => (u + 44.5) * pxPerM_X;
  const my = (v: number) => (v + 28.0) * pxPerM_Y;

  ctx.strokeStyle = 'rgba(246, 245, 240, 0.90)';
  ctx.fillStyle = 'rgba(246, 245, 240, 0.92)';
  ctx.lineWidth = 4.0;

  // Touchlines & goal lines
  ctx.strokeRect(mx(-41), my(-25), 82 * pxPerM_X, 50 * pxPerM_Y);
  // Halfway line
  ctx.beginPath();
  ctx.moveTo(mx(0), my(-25));
  ctx.lineTo(mx(0), my(25));
  ctx.stroke();

  // Center circle (9.15m) & center spot
  ctx.beginPath();
  ctx.ellipse(mx(0), my(0), 9.15 * pxPerM_X, 9.15 * pxPerM_Y, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mx(0), my(0), 5.0, 0, Math.PI * 2);
  ctx.fill();

  // Penalty boxes (16.5m x 34m), goal boxes (5.5m x 18.32m), penalty spots (11m) & arcs
  for (const side of [-1, 1]) {
    const gx = side * 41;
    const inDir = -side;
    ctx.strokeRect(
      side < 0 ? mx(gx) : mx(gx - 16.5),
      my(-17),
      16.5 * pxPerM_X,
      34 * pxPerM_Y
    );
    ctx.strokeRect(
      side < 0 ? mx(gx) : mx(gx - 5.5),
      my(-9.16),
      5.5 * pxPerM_X,
      18.32 * pxPerM_Y
    );
    // Penalty spot
    const pxSpot = mx(gx + inDir * 11.0);
    ctx.beginPath();
    ctx.arc(pxSpot, my(0), 4.5, 0, Math.PI * 2);
    ctx.fill();
    // Penalty arc outside 16.5m box (radius 9.15m from 11m spot -> cos = 5.5/9.15 => ±0.926 rad)
    ctx.beginPath();
    const aSpan = Math.acos(5.5 / 9.15);
    if (side < 0) {
      ctx.ellipse(pxSpot, my(0), 9.15 * pxPerM_X, 9.15 * pxPerM_Y, 0, -aSpan, aSpan);
    } else {
      ctx.ellipse(pxSpot, my(0), 9.15 * pxPerM_X, 9.15 * pxPerM_Y, 0, Math.PI - aSpan, Math.PI + aSpan);
    }
    ctx.stroke();
  }

  // 4 Corner arcs
  const cr = 1.2 * pxPerM_X;
  for (const [cx, cy, a0, a1] of [
    [mx(-41), my(-25), 0, Math.PI * 0.5],
    [mx(41), my(-25), Math.PI * 0.5, Math.PI],
    [mx(41), my(25), Math.PI, Math.PI * 1.5],
    [mx(-41), my(25), Math.PI * 1.5, Math.PI * 2],
  ] as [number, number, number, number][]) {
    ctx.beginPath();
    ctx.arc(cx, cy, cr, a0, a1);
    ctx.stroke();
  }

  // Soft feathered alpha border (destination-in mask on outer 2.2%)
  ctx.globalCompositeOperation = 'destination-in';
  const maskGrad = ctx.createLinearGradient(0, 0, W, 0);
  maskGrad.addColorStop(0.0, 'rgba(0,0,0,0)');
  maskGrad.addColorStop(0.025, 'rgba(0,0,0,1)');
  maskGrad.addColorStop(0.975, 'rgba(0,0,0,1)');
  maskGrad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = maskGrad;
  ctx.fillRect(0, 0, W, H);
  const maskGradV = ctx.createLinearGradient(0, 0, 0, H);
  maskGradV.addColorStop(0.0, 'rgba(0,0,0,0)');
  maskGradV.addColorStop(0.03, 'rgba(0,0,0,1)');
  maskGradV.addColorStop(0.97, 'rgba(0,0,0,1)');
  maskGradV.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = maskGradV;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function createKleinfeldTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const W = 768;
  const H = 1536;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(192008);

  // Mowed summer turf stripes (natural muted Pfalz meadow/turf green matching DOP20)
  const stripes = 14;
  const sh = H / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#657a4a' : '#5b6f42';
    ctx.fillRect(0, i * sh, W, sh + 1);
  }
  for (let i = 0; i < 32000; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    const d = Math.floor((rand() - 0.5) * 26);
    ctx.fillStyle = `rgba(${102 + d},${124 + d},${74 + d},0.25)`;
    ctx.fillRect(x, y, 2, 3);
  }

  // White Kleinfeld pitch markings (outer 18.5m x 48m -> field 15m x 42m)
  const pxX = W / 18.5;
  const pxY = H / 48.0;
  const mx = (u: number) => (u + 9.25) * pxX;
  const my = (v: number) => (v + 24.0) * pxY;

  ctx.strokeStyle = 'rgba(244, 245, 238, 0.88)';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(mx(-7.5), my(-21), 15 * pxX, 42 * pxY);
  ctx.beginPath();
  ctx.moveTo(mx(-7.5), my(0));
  ctx.lineTo(mx(7.5), my(0));
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(mx(0), my(0), 4.2 * pxX, 4.2 * pxY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(mx(-5.2), my(-21), 10.4 * pxX, 6.2 * pxY);
  ctx.strokeRect(mx(-5.2), my(21 - 6.2), 10.4 * pxX, 6.2 * pxY);

  ctx.globalCompositeOperation = 'destination-in';
  const mh = ctx.createLinearGradient(0, 0, W, 0);
  mh.addColorStop(0, 'rgba(0,0,0,0)');
  mh.addColorStop(0.04, 'rgba(0,0,0,1)');
  mh.addColorStop(0.96, 'rgba(0,0,0,1)');
  mh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mh;
  ctx.fillRect(0, 0, W, H);
  const mv = ctx.createLinearGradient(0, 0, 0, H);
  mv.addColorStop(0, 'rgba(0,0,0,0)');
  mv.addColorStop(0.03, 'rgba(0,0,0,1)');
  mv.addColorStop(0.97, 'rgba(0,0,0,1)');
  mv.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mv;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

function createSpeckledSurfaceTexture(
  baseHex: string,
  grainRgb: [number, number, number],
  seed: number,
  feather = true
): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const rand = mulberry32(seed);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 18000; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    const d = Math.floor((rand() - 0.5) * 38);
    ctx.fillStyle = `rgba(${grainRgb[0] + d},${grainRgb[1] + d},${grainRgb[2] + d},0.35)`;
    ctx.fillRect(x, y, 2, 2);
  }
  if (feather) {
    ctx.globalCompositeOperation = 'destination-in';
    const mh = ctx.createLinearGradient(0, 0, S, 0);
    mh.addColorStop(0, 'rgba(0,0,0,0)');
    mh.addColorStop(0.06, 'rgba(0,0,0,1)');
    mh.addColorStop(0.94, 'rgba(0,0,0,1)');
    mh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mh;
    ctx.fillRect(0, 0, S, S);
    const mv = ctx.createLinearGradient(0, 0, 0, S);
    mv.addColorStop(0, 'rgba(0,0,0,0)');
    mv.addColorStop(0.06, 'rgba(0,0,0,1)');
    mv.addColorStop(0.94, 'rgba(0,0,0,1)');
    mv.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mv;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createChainlinkTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(182, 190, 198, 0.92)';
  ctx.lineWidth = 4.2;
  const step = 32;
  for (let x = -S; x < S * 2; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.lineTo(x + S, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createSponsorBoardTexture(
  bgHex: string,
  accentHex: string,
  textHex: string,
  title: string,
  sub: string
): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  ctx.fillStyle = textHex;
  ctx.font = '800 34px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, W / 2, 48);

  ctx.fillStyle = accentHex;
  ctx.font = '700 20px system-ui, -apple-system, sans-serif';
  ctx.fillText(sub, W / 2, 92);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createSoccerBallTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f3f3ee';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#1b1d20';
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      const px = ((col + (row % 2) * 0.5) / 6) * S;
      const py = ((row + 0.5) / 4) * S;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const rx = px + Math.cos(a) * 14;
        const ry = py + Math.sin(a) * 14;
        if (k === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createFloodlightHaloTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255, 250, 224, 1.0)');
  g.addColorStop(0.28, 'rgba(255, 240, 195, 0.72)');
  g.addColorStop(1, 'rgba(255, 225, 160, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Terrain-Following Fences, Railings, Sandpit Edging, Corner Flags & Sponsors
// ---------------------------------------------------------------------------

function buildTerrainChainlinkFence(
  name: string,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  heightM: number,
  postSpacingM: number,
  terrain: TerrainSystem,
  galvMat: THREE.Material,
  meshMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const bays = Math.max(1, Math.round(len / postSpacingM));
  const postGeo = new THREE.CylinderGeometry(0.042, 0.046, heightM + 0.55, 8);

  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    const py = terrain.getTerrainHeight(px, pz);
    const post = new THREE.Mesh(postGeo, galvMat);
    post.position.set(px, py + (heightM - 0.55) * 0.5, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    g.add(post);
  }

  for (let i = 0; i < bays; i++) {
    const t0 = i / bays;
    const t1 = (i + 1) / bays;
    const ax = x0 + (x1 - x0) * t0;
    const az = z0 + (z1 - z0) * t0;
    const bx = x0 + (x1 - x0) * t1;
    const bz = z0 + (z1 - z0) * t1;
    const ha = terrain.getTerrainHeight(ax, az);
    const hb = terrain.getTerrainHeight(bx, bz);
    const dx = bx - ax;
    const dz = bz - az;
    const segLen = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);

    // Top & mid rails following terrain slope
    for (const hFrac of [0.52, 0.98]) {
      const pA = new THREE.Vector3(ax, ha + heightM * hFrac, az);
      const pB = new THREE.Vector3(bx, hb + heightM * hFrac, bz);
      const railVec = pB.clone().sub(pA);
      const rMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, railVec.length(), 6), galvMat);
      rMesh.position.copy(pA).addScaledVector(railVec, 0.5);
      rMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), railVec.clone().normalize());
      rMesh.castShadow = true;
      g.add(rMesh);
    }

    // Skewed quad panel for chainlink mesh
    const pos = new Float32Array([
      ax, ha + 0.08, az,
      bx, hb + 0.08, bz,
      bx, hb + heightM - 0.05, bz,
      ax, ha + heightM - 0.05, az,
    ]);
    const uv = new Float32Array([
      0, 0,
      segLen * 1.15, 0,
      segLen * 1.15, heightM * 1.15,
      0, heightM * 1.15,
    ]);
    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pGeom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    pGeom.setIndex([0, 1, 2, 0, 2, 3]);
    pGeom.computeVertexNormals();
    const panel = new THREE.Mesh(pGeom, meshMat);
    panel.castShadow = false;
    panel.receiveShadow = false;
    panel.userData.yaw = yaw;
    g.add(panel);
  }

  return g;
}

function buildTerrainTubularRailing(
  name: string,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  heightM: number,
  postSpacingM: number,
  terrain: TerrainSystem,
  mat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const bays = Math.max(1, Math.round(len / postSpacingM));
  const postGeo = new THREE.CylinderGeometry(0.032, 0.034, heightM + 0.35, 8);

  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    const py = terrain.getTerrainHeight(px, pz);
    const post = new THREE.Mesh(postGeo, mat);
    post.position.set(px, py + (heightM - 0.35) * 0.5, pz);
    post.castShadow = true;
    g.add(post);
  }

  for (let i = 0; i < bays; i++) {
    const t0 = i / bays;
    const t1 = (i + 1) / bays;
    const ax = x0 + (x1 - x0) * t0;
    const az = z0 + (z1 - z0) * t0;
    const bx = x0 + (x1 - x0) * t1;
    const bz = z0 + (z1 - z0) * t1;
    const ha = terrain.getTerrainHeight(ax, az);
    const hb = terrain.getTerrainHeight(bx, bz);
    for (const hOff of [heightM * 0.5, heightM * 0.96]) {
      const pA = new THREE.Vector3(ax, ha + hOff, az);
      const pB = new THREE.Vector3(bx, hb + hOff, bz);
      const v = pB.clone().sub(pA);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, v.length(), 6), mat);
      rail.position.copy(pA).addScaledVector(v, 0.5);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
      rail.castShadow = true;
      g.add(rail);
    }
  }
  return g;
}

function buildRusticTimberFence(
  name: string,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  terrain: TerrainSystem,
  woodMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const bays = Math.max(1, Math.round(len / 2.2));
  const postGeo = new THREE.CylinderGeometry(0.055, 0.06, 1.38, 8);
  const picketGeo = new THREE.BoxGeometry(0.09, 0.88, 0.028);

  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    const py = terrain.getTerrainHeight(px, pz);
    const post = new THREE.Mesh(postGeo, woodMat);
    post.position.set(px, py + 0.34, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    g.add(post);
  }

  for (let i = 0; i < bays; i++) {
    const t0 = i / bays;
    const t1 = (i + 1) / bays;
    const ax = x0 + (x1 - x0) * t0;
    const az = z0 + (z1 - z0) * t0;
    const bx = x0 + (x1 - x0) * t1;
    const bz = z0 + (z1 - z0) * t1;
    const ha = terrain.getTerrainHeight(ax, az);
    const hb = terrain.getTerrainHeight(bx, bz);
    const yaw = Math.atan2(bx - ax, bz - az);

    for (const hOff of [0.32, 0.72]) {
      const pA = new THREE.Vector3(ax, ha + hOff, az);
      const pB = new THREE.Vector3(bx, hb + hOff, bz);
      const v = pB.clone().sub(pA);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.045, v.length(), 0.08), woodMat);
      rail.position.copy(pA).addScaledVector(v, 0.5);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
      rail.castShadow = true;
      g.add(rail);
    }

    const pickets = Math.max(3, Math.round((len / bays) / 0.28));
    for (let p = 1; p < pickets; p++) {
      const pt = p / pickets;
      const px = ax + (bx - ax) * pt;
      const pz = az + (bz - az) * pt;
      const py = terrain.getTerrainHeight(px, pz);
      const pk = new THREE.Mesh(picketGeo, woodMat);
      pk.position.set(px, py + 0.48, pz);
      pk.rotation.y = yaw + Math.PI * 0.5;
      pk.castShadow = true;
      g.add(pk);
    }
  }
  return g;
}

function buildSandpitTimberEdging(
  cx: number,
  cz: number,
  rotY: number,
  wU: number,
  dV: number,
  terrain: TerrainSystem,
  woodMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'SpielplatzSandpitEdging';
  const hw = wU * 0.5;
  const hd = dV * 0.5;
  const corners: [number, number][] = [
    localToWorld(cx, cz, rotY, -hw, -hd),
    localToWorld(cx, cz, rotY, +hw, -hd),
    localToWorld(cx, cz, rotY, +hw, +hd),
    localToWorld(cx, cz, rotY, -hw, +hd),
  ];

  // Terrain-following horizontal Robinia round logs around all 4 sides
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const segs = 4;
    for (let s = 0; s < segs; s++) {
      const p0x = ax + (bx - ax) * (s / segs);
      const p0z = az + (bz - az) * (s / segs);
      const p1x = ax + (bx - ax) * ((s + 1) / segs);
      const p1z = az + (bz - az) * ((s + 1) / segs);
      const pA = new THREE.Vector3(p0x, terrain.getTerrainHeight(p0x, p0z) + 0.14, p0z);
      const pB = new THREE.Vector3(p1x, terrain.getTerrainHeight(p1x, p1z) + 0.14, p1z);
      const v = pB.clone().sub(pA);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, v.length() + 0.12, 10), woodMat);
      log.position.copy(pA).addScaledVector(v, 0.5);
      log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
      log.castShadow = true;
      log.receiveShadow = true;
      g.add(log);
    }

    // Wooden corner seat platform
    const seatX = corners[i][0];
    const seatZ = corners[i][1];
    const seatY = terrain.getTerrainHeight(seatX, seatZ) + 0.24;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.68), woodMat);
    seat.position.set(seatX, seatY, seatZ);
    seat.rotation.y = rotY;
    seat.castShadow = true;
    seat.receiveShadow = true;
    g.add(seat);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Manifest & System API
// ---------------------------------------------------------------------------

interface RecreationManifestEntry {
  glbPath: string;
  bounds?: { min: number[]; max: number[]; size: number[] };
}

interface RecreationManifest {
  models: Record<string, RecreationManifestEntry>;
}

export interface RecreationStats {
  assetCount: number;
  floodlightCount: number;
  goalsScored: number;
}

export interface RecreationSystemResult {
  group: THREE.Group;
  stats: RecreationStats;
  setDuskMode: (isDusk: boolean) => void;
  update: (
    dt: number,
    tractorPos: THREE.Vector3 | null,
    cleanCapture: boolean,
    onGoalScored?: (side: 'west' | 'east') => void
  ) => void;
}

export async function buildRecreationAreas(
  terrain: TerrainSystem,
  collider: BuildingCollider,
  maxAnisotropy: number
): Promise<RecreationSystemResult> {
  const group = new THREE.Group();
  group.name = 'KindenheimRecreation';

  const stats: RecreationStats = {
    assetCount: 0,
    floodlightCount: 0,
    goalsScored: 0,
  };

  // -------------------------------------------------------------------------
  // 1. Terrain-Conforming Surfaces (Hartplatz, Kleinfeld, Sandpit, Pads, Path)
  // -------------------------------------------------------------------------
  const hartplatzTex = createMainHartplatzTexture(maxAnisotropy);
  const hartplatzMat = new THREE.MeshStandardMaterial({
    map: hartplatzTex,
    roughness: 0.92,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  group.add(
    createTerrainDrapedPatch(
      'Sportplatz_Hartplatz',
      PITCH_CX,
      PITCH_CZ,
      PITCH_ROT,
      89.0,
      56.0,
      48,
      30,
      0.065,
      hartplatzMat,
      terrain,
      1
    )
  );

  const kleinfeldTex = createKleinfeldTexture(maxAnisotropy);
  const kleinfeldMat = new THREE.MeshStandardMaterial({
    map: kleinfeldTex,
    roughness: 0.90,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  group.add(
    createTerrainDrapedPatch(
      'Sportplatz_Kleinfeld',
      KLEIN_CX,
      KLEIN_CZ,
      PITCH_ROT,
      18.5,
      48.0,
      16,
      32,
      0.055,
      kleinfeldMat,
      terrain,
      1
    )
  );

  // Spielplatz Ground Surfaces
  const sandMat = new THREE.MeshStandardMaterial({
    map: createSpeckledSurfaceTexture('#cfb994', [184, 162, 128], 7701, false),
    roughness: 0.94,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  group.add(
    createTerrainDrapedPatch(
      'Spielplatz_Sandpit',
      65.2,
      -254.0,
      0.34,
      8.4,
      10.6,
      14,
      16,
      0.055,
      sandMat,
      terrain,
      1
    )
  );

  // Natural Fallschutz-Holzhackschnitzel (cedar/tan woodchip mulch) under climbing/swing equipment
  const epdmMat = new THREE.MeshStandardMaterial({
    map: createSpeckledSurfaceTexture('#ab9270', [146, 122, 92], 7702, true),
    roughness: 0.93,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  group.add(createTerrainDrapedPatch('Spielplatz_Pad_Tower', 70.8, -259.6, 0.30, 6.2, 7.8, 10, 12, 0.05, epdmMat, terrain, 1));
  group.add(createTerrainDrapedPatch('Spielplatz_Pad_Swings', 77.6, -261.2, 0.36, 7.8, 4.2, 12, 8, 0.05, epdmMat, terrain, 1));
  group.add(createTerrainDrapedPatch('Spielplatz_Pad_Pyramid', 85.2, -259.2, 0.2, 5.4, 5.4, 8, 8, 0.05, epdmMat, terrain, 1));

  const concPadMat = new THREE.MeshStandardMaterial({
    map: createSpeckledSurfaceTexture('#878a87', [118, 121, 118], 7703, true),
    roughness: 0.88,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  group.add(createTerrainDrapedPatch('Spielplatz_Pad_Pavilion', 73.2, -238.2, 0.34, 10.2, 5.4, 12, 8, 0.055, concPadMat, terrain, 1));

  // Gravel footpath connecting Neugasse south gate -> Pavilion -> East Sporthalle walkway
  const gravelMat = new THREE.MeshStandardMaterial({
    map: createSpeckledSurfaceTexture('#a89f90', [148, 140, 126], 7704, true),
    roughness: 0.93,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  group.add(createTerrainDrapedPatch('Spielplatz_Path_South', 72.8, -230.2, 1.48, 12.0, 1.6, 12, 4, 0.05, gravelMat, terrain, 1));
  group.add(createTerrainDrapedPatch('Spielplatz_Path_East', 81.5, -240.5, 0.34, 13.5, 1.5, 12, 4, 0.05, gravelMat, terrain, 1));

  // -------------------------------------------------------------------------
  // 2. Terrain-Following Fences, Railings, Bandenwerbung, Corner Flags
  // -------------------------------------------------------------------------
  const galvMat = new THREE.MeshStandardMaterial({ color: 0xaab2ba, roughness: 0.42, metalness: 0.65 });
  const whiteRailMat = new THREE.MeshStandardMaterial({ color: 0xedeff0, roughness: 0.38, metalness: 0.15 });
  const robiniaWoodMat = new THREE.MeshStandardMaterial({ color: 0xa87644, roughness: 0.80, metalness: 0.0 });
  const chainlinkMat = new THREE.MeshStandardMaterial({
    map: createChainlinkTexture(),
    alphaTest: 0.30,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 0.45,
    metalness: 0.45,
  });

  // Sandpit timber border logs
  group.add(buildSandpitTimberEdging(65.2, -254.0, 0.34, 8.4, 10.6, terrain, robiniaWoodMat));

  // West & East Ballfangzäune (5.4m high behind both goals)
  const [wbf0x, wbf0z] = pitchToWorld(-44.2, -24.0);
  const [wbf1x, wbf1z] = pitchToWorld(-44.2, +24.0);
  group.add(buildTerrainChainlinkFence('Ballfangzaun_West', wbf0x, wbf0z, wbf1x, wbf1z, 5.4, 3.6, terrain, galvMat, chainlinkMat));

  const [ebf0x, ebf0z] = pitchToWorld(+44.2, -18.0);
  const [ebf1x, ebf1z] = pitchToWorld(+44.2, +18.0);
  group.add(buildTerrainChainlinkFence('Ballfangzaun_East', ebf0x, ebf0z, ebf1x, ebf1z, 5.4, 3.6, terrain, galvMat, chainlinkMat));

  // North & South White Spectator Railings (leaving NE tractor gate & gaps at the 2 dugouts!)
  const [nr0x, nr0z] = pitchToWorld(-44.0, -26.8);
  const [nr1x, nr1z] = pitchToWorld(+34.0, -26.8);
  group.add(buildTerrainTubularRailing('SpectatorRailing_North', nr0x, nr0z, nr1x, nr1z, 1.06, 3.2, terrain, whiteRailMat));

  for (const [segName, u0, u1] of [
    ['SpectatorRailing_South_W', -44.0, -11.2],
    ['SpectatorRailing_South_M', -5.8, +5.8],
    ['SpectatorRailing_South_E', +11.2, +44.0],
  ] as [string, number, number][]) {
    const [sx0, sz0] = pitchToWorld(u0, +26.8);
    const [sx1, sz1] = pitchToWorld(u1, +26.8);
    group.add(buildTerrainTubularRailing(segName, sx0, sz0, sx1, sz1, 1.06, 3.2, terrain, whiteRailMat));
  }

  // Bandenwerbung Sponsor Boards along North & South spectator railings
  const sponsorDefs = [
    { bg: '#164526', acc: '#f0c44d', txt: '#f8f6ee', title: 'TV 1920 KINDENHEIM', sub: 'TRADITION SEIT 1920 · FUSSBALL IN DER PFALZ' },
    { bg: '#6e1d26', acc: '#f2d38a', txt: '#fbf8f0', title: 'WEINGÜTER KINDENHEIM', sub: 'PFÄLZER RIESLING & SPÄTBURGUNDER' },
    { bg: '#1c4268', acc: '#f4c542', txt: '#ffffff', title: 'LEININGERLAND · PFALZ', sub: 'URLAUBS- & GENUSSREGION' },
    { bg: '#1f4d2e', acc: '#e8c460', txt: '#f6f3ea', title: "OLLI'S SCHLEMMERSTUBE", sub: 'SPORTHEIM KINDENHEIM · SPEISEN & GETRÄNKE' },
    { bg: '#7c4e18', acc: '#f6d86e', txt: '#ffffff', title: 'PFÄLZER WEINSTRASSE', sub: 'HERZLICH WILLKOMMEN AUF DEM SPORTPLATZ' },
  ];
  const sponsorMats = sponsorDefs.map(
    (d) =>
      new THREE.MeshStandardMaterial({
        map: createSponsorBoardTexture(d.bg, d.acc, d.txt, d.title, d.sub),
        roughness: 0.42,
        metalness: 0.05,
        side: THREE.DoubleSide,
      })
  );
  const boardGeo = new THREE.BoxGeometry(3.6, 0.85, 0.05);
  const boardPlacements: { u: number; v: number; rotOffset: number; idx: number }[] = [
    { u: -34, v: -26.75, rotOffset: 0, idx: 0 },
    { u: -22, v: -26.75, rotOffset: 0, idx: 1 },
    { u: -10, v: -26.75, rotOffset: 0, idx: 2 },
    { u: 2, v: -26.75, rotOffset: 0, idx: 3 },
    { u: 14, v: -26.75, rotOffset: 0, idx: 4 },
    { u: 26, v: -26.75, rotOffset: 0, idx: 0 },
    { u: -32, v: +26.75, rotOffset: Math.PI, idx: 1 },
    { u: -20, v: +26.75, rotOffset: Math.PI, idx: 0 },
    { u: -2, v: +26.75, rotOffset: Math.PI, idx: 3 },
    { u: 20, v: +26.75, rotOffset: Math.PI, idx: 2 },
    { u: 32, v: +26.75, rotOffset: Math.PI, idx: 4 },
    { u: -14, v: +26.75, rotOffset: Math.PI, idx: 1 },
  ];
  for (const bp of boardPlacements) {
    const [bx, bz] = pitchToWorld(bp.u, bp.v);
    const by = terrain.getTerrainHeight(bx, bz) + 0.56;
    const board = new THREE.Mesh(boardGeo, sponsorMats[bp.idx]);
    board.position.set(bx, by, bz);
    board.rotation.y = PITCH_ROT + bp.rotOffset;
    board.castShadow = true;
    board.receiveShadow = true;
    group.add(board);
  }

  // 4 Corner Flags (Eckfahnen)
  const flagClothMeshes: THREE.Mesh[] = [];
  const flagPoleGeo = new THREE.CylinderGeometry(0.022, 0.024, 1.55, 8);
  const flagClothGeo = new THREE.PlaneGeometry(0.42, 0.28, 4, 1);
  flagClothGeo.translate(0.21, 0, 0);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xd93228, roughness: 0.72, side: THREE.DoubleSide });
  for (const [cu, cv] of [
    [-41, -25],
    [41, -25],
    [41, 25],
    [-41, 25],
  ] as [number, number][]) {
    const [fx, fz] = pitchToWorld(cu, cv);
    const fy = terrain.getTerrainHeight(fx, fz);
    const pole = new THREE.Mesh(flagPoleGeo, whiteRailMat);
    pole.position.set(fx, fy + 0.77, fz);
    pole.castShadow = true;
    group.add(pole);
    const cloth = new THREE.Mesh(flagClothGeo, flagMat);
    cloth.position.set(fx, fy + 1.40, fz);
    cloth.rotation.y = PITCH_ROT;
    cloth.castShadow = true;
    group.add(cloth);
    flagClothMeshes.push(cloth);
  }

  // Spielplatz Rustic Timber Fence (with 2.6m open south gate for pedestrians & tractors)
  group.add(buildRusticTimberFence('SpielplatzFence_SouthWest', 60.5, -225.0, 71.2, -224.2, terrain, robiniaWoodMat));
  group.add(buildRusticTimberFence('SpielplatzFence_SouthEast', 73.8, -224.4, 86.5, -227.5, terrain, robiniaWoodMat));
  group.add(buildRusticTimberFence('SpielplatzFence_West', 59.0, -257.0, 60.5, -225.0, terrain, robiniaWoodMat));

  // -------------------------------------------------------------------------
  // 3. Load All 20 Blender PBR .glb Models from Manifest & Place on Terrain
  // -------------------------------------------------------------------------
  let manifest: RecreationManifest | null = null;
  try {
    const res = await fetch(resolveAssetUrl('/assets/models/recreation/manifest.json'));
    if (res.ok) {
      manifest = (await res.json()) as RecreationManifest;
    }
  } catch (err) {
    console.warn('[recreation] Could not load manifest:', err);
  }

  const loader = new GLTFLoader();
  const prototypes = new Map<string, THREE.Object3D>();
  if (manifest?.models) {
    await Promise.all(
      Object.entries(manifest.models).map(async ([key, entry]) => {
        try {
          const gltf = await loader.loadAsync(resolveAssetUrl(entry.glbPath));
          gltf.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              for (const m of mats) {
                if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
                  m.envMapIntensity = 0.72;
                  if (m.map) m.map.anisotropy = Math.min(8, maxAnisotropy);
                }
              }
            }
          });
          prototypes.set(key, gltf.scene);
        } catch (err) {
          console.warn(`[recreation] Failed to load ${key}:`, err);
        }
      })
    );
  }

  const floodlightLensMats: THREE.MeshStandardMaterial[] = [];
  const floodlightHalos: THREE.Sprite[] = [];
  const haloTex = createFloodlightHaloTexture();
  let swingNodes: { left: THREE.Object3D | null; right: THREE.Object3D | null; nest: THREE.Object3D | null } = {
    left: null,
    right: null,
    nest: null,
  };
  let carouselRotor: THREE.Object3D | null = null;

  const placeAsset = (
    key: string,
    x: number,
    z: number,
    rotY: number,
    options?: { yOverride?: number; yOffset?: number; rotZ?: number; scale?: number; tag?: string }
  ): THREE.Object3D | null => {
    const proto = prototypes.get(key);
    if (!proto) return null;
    const inst = proto.clone(true);
    const y = options?.yOverride ?? terrain.getTerrainHeight(x, z) + (options?.yOffset ?? 0);
    inst.position.set(x, y, z);
    inst.rotation.order = 'YXZ';
    inst.rotation.y = rotY;
    if (options?.rotZ) inst.rotation.z = options.rotZ;
    if (options?.scale) inst.scale.setScalar(options.scale);
    inst.name = options?.tag ?? `Rec_${key}`;

    // Deep-clone Floodlight_Lens material so we can toggle emission at dusk cleanly
    if (key === 'floodlight_mast') {
      inst.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const nextMats = mats.map((m) => {
            if (m instanceof THREE.MeshStandardMaterial && m.name.toLowerCase().includes('floodlight_lens')) {
              const cloned = m.clone();
              cloned.emissive.setHex(0xfff4d6);
              cloned.emissiveIntensity = 0.0;
              floodlightLensMats.push(cloned);
              return cloned;
            }
            return m;
          });
          o.material = Array.isArray(o.material) ? nextMats : nextMats[0];
        }
      });

      const haloMat = new THREE.SpriteMaterial({
        map: haloTex,
        color: 0xfff0c4,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.position.set(0, 16.55, 0.44);
      halo.scale.set(5.2, 5.2, 1);
      halo.visible = false;
      inst.add(halo);
      floodlightHalos.push(halo);
      stats.floodlightCount++;
    }

    if (key === 'playground_swings') {
      swingNodes = {
        left: inst.getObjectByName('Swing_Left') ?? null,
        right: inst.getObjectByName('Swing_Right') ?? null,
        nest: inst.getObjectByName('Swing_Nest') ?? null,
      };
    } else if (key === 'playground_carousel') {
      carouselRotor = inst.getObjectByName('Carousel_Rotor') ?? null;
    }

    group.add(inst);
    stats.assetCount++;
    return inst;
  };

  // --- Sportheim ("Olli's Schlemmerstube") & White Concrete Terrace ---
  const sportheimX = 57.2;
  const sportheimZ = -350.0;
  const sportheimRot = 0.390;
  const sportheimY = terrain.getTerrainHeight(sportheimX, sportheimZ) - 0.65;
  placeAsset('sportheim_kindenheim', sportheimX, sportheimZ, sportheimRot, {
    yOverride: sportheimY,
    tag: 'Sportheim_OllisSchlemmerstube',
  });
  collider.addPolygon(makeRotatedRectPoly(sportheimX, sportheimZ, sportheimRot, 23.8, 3.3));

  const terraceX = 20.6;
  const terraceZ = -332.2;
  const terraceRot = 0.400;
  const terraceY = terrain.getTerrainHeight(terraceX, terraceZ) - 0.55;
  placeAsset('sportplatz_terrace', terraceX, terraceZ, terraceRot, {
    yOverride: terraceY,
    rotZ: -0.032,
    tag: 'Sportplatz_Stehtraversen',
  });
  collider.addPolygon(makeRotatedRectPoly(terraceX, terraceZ, terraceRot, 14.0, 1.7));

  // --- Goals (2 full-size on main pitch + 2 on East Kleinfeld + 1 sideline training goal) ---
  const [gwX, gwZ] = pitchToWorld(-41.0, 0.0);
  const [geX, geZ] = pitchToWorld(+41.0, 0.0);
  placeAsset('soccer_goal_full', gwX, gwZ, PITCH_ROT, { tag: 'Goal_Main_West' });
  placeAsset('soccer_goal_full', geX, geZ, PITCH_ROT + Math.PI, { tag: 'Goal_Main_East' });

  const [gknX, gknZ] = localToWorld(KLEIN_CX, KLEIN_CZ, PITCH_ROT, 0.0, -21.0);
  const [gksX, gksZ] = localToWorld(KLEIN_CX, KLEIN_CZ, PITCH_ROT, 0.0, +21.0);
  placeAsset('soccer_goal_mini', gknX, gknZ, PITCH_ROT - Math.PI * 0.5, { tag: 'Goal_Kleinfeld_North' });
  placeAsset('soccer_goal_mini', gksX, gksZ, PITCH_ROT + Math.PI * 0.5, { tag: 'Goal_Kleinfeld_South' });
  const [gtrX, gtrZ] = localToWorld(KLEIN_CX, KLEIN_CZ, PITCH_ROT, +8.4, -9.0);
  placeAsset('soccer_goal_mini', gtrX, gtrZ, PITCH_ROT + Math.PI, { tag: 'Goal_Training' });

  // --- 6 Floodlight Masts ---
  const mastCoords: { u: number; v: number; rot: number }[] = [
    { u: -33.0, v: +28.2, rot: PITCH_ROT + Math.PI },
    { u: 0.0, v: +28.2, rot: PITCH_ROT + Math.PI },
    { u: +33.0, v: +28.2, rot: PITCH_ROT + Math.PI },
    { u: -34.0, v: -34.2, rot: PITCH_ROT },
    { u: 0.0, v: -38.0, rot: PITCH_ROT }, // Cleanly behind Sportheim rear wall!
    { u: +38.0, v: -28.0, rot: PITCH_ROT },
  ];
  for (const mc of mastCoords) {
    const [mx, mz] = pitchToWorld(mc.u, mc.v);
    placeAsset('floodlight_mast', mx, mz, mc.rot);
  }

  // --- 2 Dugout Benches + Scoreboard + Benches & Bins ---
  for (const du of [-8.5, +8.5]) {
    const [dx, dz] = pitchToWorld(du, +27.1);
    placeAsset('dugout_bench', dx, dz, PITCH_ROT + Math.PI);
  }
  const [sbX, sbZ] = pitchToWorld(+36.5, -27.8);
  placeAsset('scoreboard', sbX, sbZ, PITCH_ROT - 0.35, { tag: 'Scoreboard_Kindenheim' });

  for (const [bu, bv, brot] of [
    [-25.0, -28.4, PITCH_ROT],
    [-12.0, -28.4, PITCH_ROT],
    [18.0, -28.4, PITCH_ROT],
    [101.0, -349.0, PITCH_ROT - Math.PI * 0.5], // Kleinfeld bench near NE entrance
  ] as [number, number, number][]) {
    if (Math.abs(bu) <= 45 && Math.abs(bv) <= 45) {
      const [bx, bz] = pitchToWorld(bu, bv);
      placeAsset('park_bench', bx, bz, brot);
    } else {
      placeAsset('park_bench', bu, bv, brot);
    }
  }
  const [tb1x, tb1z] = pitchToWorld(-14.0, -28.6);
  const [tb2x, tb2z] = pitchToWorld(+32.0, -28.6);
  placeAsset('trash_bin', tb1x, tb1z, PITCH_ROT);
  placeAsset('trash_bin', tb2x, tb2z, PITCH_ROT);

  // Sportplatz West & South perimeter fencing colliders (leave NE gate & Kleinfeld accessible!)
  collider.addPolygon([
    pitchToWorld(-45.5, -27.5),
    pitchToWorld(-43.5, -27.5),
    pitchToWorld(-43.5, +27.5),
    pitchToWorld(-45.5, +27.5),
  ]);
  collider.addPolygon([
    pitchToWorld(-44.5, +26.5),
    pitchToWorld(+44.5, +26.5),
    pitchToWorld(+44.5, +28.5),
    pitchToWorld(-44.5, +28.5),
  ]);

  // --- Spielplatz Equipment ---
  placeAsset('playground_tower', 70.8, -260.2, 0.28, { tag: 'Spielplatz_Kletterturm' });
  collider.addPolygon(makeRotatedRectPoly(70.8, -260.2, 0.28, 2.2, 2.2));

  placeAsset('playground_swings', 77.6, -261.2, 0.36, { tag: 'Spielplatz_Schaukeln' });
  placeAsset('playground_pyramid', 85.2, -259.2, 0.20, { tag: 'Spielplatz_Seilnetzpyramide' });
  placeAsset('playground_carousel', 72.2, -248.2, 0.0, { tag: 'Spielplatz_Drehkarussell' });
  placeAsset('playground_seesaw', 80.8, -252.2, 0.42, { tag: 'Spielplatz_Holzwippe' });
  placeAsset('spring_rider_tractor', 76.4, -246.2, -0.55, { tag: 'Spielplatz_Wipptraktor' });
  placeAsset('spring_rider_horse', 79.2, -245.4, 0.75, { tag: 'Spielplatz_Wipppferd' });
  placeAsset('playground_sandpit_toys', 64.8, -253.8, 0.35, { yOffset: 0.12, tag: 'Spielplatz_Sandspielzeug' });

  placeAsset('playground_pavilion', 70.5, -238.5, 0.34, { tag: 'Spielplatz_Pavillon' });
  collider.addPolygon(makeRotatedRectPoly(70.5, -238.5, 0.34, 2.0, 1.6));

  placeAsset('tischtennisplatte', 76.3, -237.8, 0.34, { tag: 'Spielplatz_Tischtennis' });

  // Spielplatz benches, bins & 2 municipal signs
  placeAsset('park_bench', 69.2, -246.2, 0.34);
  placeAsset('park_bench', 81.8, -244.5, -0.95);
  placeAsset('park_bench', 66.2, -231.5, 0.28);
  placeAsset('park_bench', 78.2, -231.2, 0.34);
  placeAsset('trash_bin', 74.6, -226.4, 0.25);
  placeAsset('trash_bin', 85.5, -243.5, -1.2);
  placeAsset('spielplatz_sign', 74.2, -225.2, 0.22, { tag: 'Spielplatz_Schild_Sued' });
  placeAsset('spielplatz_sign', 87.5, -243.0, 1.55, { tag: 'Spielplatz_Schild_Ost' });

  // -------------------------------------------------------------------------
  // 4. Dusk Floodlighting Pools (2 shadow-free PointLights + Mast Halos)
  // -------------------------------------------------------------------------
  const [flWx, flWz] = pitchToWorld(-22, 0);
  const [flEx, flEz] = pitchToWorld(+22, 0);
  const pitchLightW = new THREE.PointLight(0xfff1d2, 0, 118, 1.35);
  pitchLightW.position.set(flWx, terrain.getTerrainHeight(flWx, flWz) + 14.5, flWz);
  pitchLightW.castShadow = false;
  const pitchLightE = new THREE.PointLight(0xfff1d2, 0, 118, 1.35);
  pitchLightE.position.set(flEx, terrain.getTerrainHeight(flEx, flEz) + 14.5, flEz);
  pitchLightE.castShadow = false;
  group.add(pitchLightW, pitchLightE);

  const setDuskMode = (isDusk: boolean): void => {
    for (const mat of floodlightLensMats) {
      mat.emissiveIntensity = isDusk ? 3.8 : 0.0;
    }
    for (const halo of floodlightHalos) {
      halo.visible = isDusk;
      (halo.material as THREE.SpriteMaterial).opacity = isDusk ? 0.62 : 0.0;
    }
    pitchLightW.intensity = isDusk ? 260 : 0;
    pitchLightE.intensity = isDusk ? 260 : 0;
  };

  // -------------------------------------------------------------------------
  // 5. Interactive Soccer Ball on Main Pitch (Kickable by Tractor!)
  // -------------------------------------------------------------------------
  const ballRadius = 0.26;
  const ballGeo = new THREE.SphereGeometry(ballRadius, 20, 14);
  const ballMat = new THREE.MeshStandardMaterial({
    map: createSoccerBallTexture(),
    roughness: 0.48,
    metalness: 0.05,
  });
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.name = 'InteractiveSoccerBall';
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  group.add(ballMesh);

  let ballX = PITCH_CX;
  let ballZ = PITCH_CZ;
  let ballVx = 0;
  let ballVz = 0;
  let goalCooldown = 0;
  const ballRollAxis = new THREE.Vector3();
  const ballRollQuat = new THREE.Quaternion();

  const resetBall = () => {
    ballX = PITCH_CX;
    ballZ = PITCH_CZ;
    ballVx = 0;
    ballVz = 0;
    ballMesh.position.set(ballX, terrain.getTerrainHeight(ballX, ballZ) + ballRadius, ballZ);
  };
  resetBall();

  let animTime = 0;

  const update = (
    dt: number,
    tractorPos: THREE.Vector3 | null,
    cleanCapture: boolean,
    onGoalScored?: (side: 'west' | 'east') => void
  ): void => {
    const safeDt = Math.min(Math.max(dt, 0), 0.06);

    if (cleanCapture) {
      resetBall();
      if (swingNodes.left) swingNodes.left.rotation.x = 0;
      if (swingNodes.right) swingNodes.right.rotation.x = 0;
      if (swingNodes.nest) swingNodes.nest.rotation.x = 0;
      return;
    }

    animTime += safeDt;

    // Gentle breeze sway on playground swings & slow carousel spin
    if (swingNodes.left) swingNodes.left.rotation.x = Math.sin(animTime * 1.45) * 0.085;
    if (swingNodes.right) swingNodes.right.rotation.x = Math.sin(animTime * 1.55 + 1.2) * 0.095;
    if (swingNodes.nest) swingNodes.nest.rotation.x = Math.sin(animTime * 1.15 + 2.4) * 0.055;
    if (carouselRotor) carouselRotor.rotation.y += safeDt * 0.35;

    for (let i = 0; i < flagClothMeshes.length; i++) {
      flagClothMeshes[i].rotation.y = PITCH_ROT + Math.sin(animTime * 4.2 + i * 1.3) * 0.18;
    }

    // Soccer ball physics
    if (goalCooldown > 0) {
      goalCooldown -= safeDt;
      if (goalCooldown <= 0) {
        resetBall();
      }
    }

    if (tractorPos && goalCooldown <= 0) {
      const dx = ballX - tractorPos.x;
      const dz = ballZ - tractorPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.65 && dist > 1e-4) {
        const kickSpeed = 12.5;
        ballVx = (dx / dist) * kickSpeed;
        ballVz = (dz / dist) * kickSpeed;
      }
    }

    const speed = Math.hypot(ballVx, ballVz);
    if (speed > 0.02) {
      ballX += ballVx * safeDt;
      ballZ += ballVz * safeDt;

      // Ground rolling rotation
      ballRollAxis.set(ballVz, 0, -ballVx).normalize();
      ballRollQuat.setFromAxisAngle(ballRollAxis, (speed * safeDt) / ballRadius);
      ballMesh.quaternion.premultiply(ballRollQuat);

      const damp = Math.exp(-1.55 * safeDt);
      ballVx *= damp;
      ballVz *= damp;

      // Check pitch coordinates (u, v) for goal detection & fence bounce
      const relX = ballX - PITCH_CX;
      const relZ = ballZ - PITCH_CZ;
      let u = relX * PITCH_DIR_X + relZ * PITCH_DIR_Z;
      let v = relX * PITCH_PERP_X + relZ * PITCH_PERP_Z;

      if (goalCooldown <= 0 && Math.abs(v) < 3.55 && Math.abs(u) > 41.0 && Math.abs(u) < 43.2) {
        stats.goalsScored++;
        goalCooldown = 3.5;
        ballVx *= 0.2;
        ballVz *= 0.2;
        onGoalScored?.(u < 0 ? 'west' : 'east');
      } else {
        // Keep ball inside outer pitch bounds (u in [-44, 44], v in [-26.5, 26.5])
        let vu = ballVx * PITCH_DIR_X + ballVz * PITCH_DIR_Z;
        let vv = ballVx * PITCH_PERP_X + ballVz * PITCH_PERP_Z;
        let bounced = false;
        if (u < -43.8) {
          u = -43.8;
          vu = Math.abs(vu) * 0.7;
          bounced = true;
        } else if (u > 43.8) {
          u = 43.8;
          vu = -Math.abs(vu) * 0.7;
          bounced = true;
        }
        if (v < -26.4) {
          v = -26.4;
          vv = Math.abs(vv) * 0.7;
          bounced = true;
        } else if (v > 26.4) {
          v = 26.4;
          vv = -Math.abs(vv) * 0.7;
          bounced = true;
        }
        if (bounced) {
          const [wx, wz] = pitchToWorld(u, v);
          ballX = wx;
          ballZ = wz;
          ballVx = vu * PITCH_DIR_X + vv * PITCH_PERP_X;
          ballVz = vu * PITCH_DIR_Z + vv * PITCH_PERP_Z;
        }
      }
    } else {
      ballVx = 0;
      ballVz = 0;
    }

    ballMesh.position.set(ballX, terrain.getTerrainHeight(ballX, ballZ) + ballRadius, ballZ);
  };

  return {
    group,
    stats,
    setDuskMode,
    update,
  };
}
