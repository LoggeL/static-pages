import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingCollider } from './collision';
import type { QualityLevel } from './renderQuality';
import { dedupeModelTextures } from './sharedAssets';
import type { TerrainSystem } from './terrain';
import type { TimeOfDayPreset } from './types';
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

const MODEL_DIR = '/assets/models/recreation';

function localToWorld(cx: number, cz: number, rotY: number, u: number, v: number): [number, number] {
  const dx = Math.cos(rotY);
  const dz = -Math.sin(rotY);
  const px = Math.sin(rotY);
  const pz = Math.cos(rotY);
  return [cx + u * dx + v * px, cz + u * dz + v * pz];
}

function pitchToWorld(u: number, v: number): [number, number] {
  return [PITCH_CX + u * PITCH_DIR_X + v * PITCH_PERP_X, PITCH_CZ + u * PITCH_DIR_Z + v * PITCH_PERP_Z];
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

// ---------------------------------------------------------------------------
// Deterministic value noise (used for the macro masks of the ground surfaces)
// ---------------------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 17);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Macro mask of one ground surface, stretched once over the whole patch.
 * R = dampness (dark, smoother patches)   G = streaks (drag-mat arcs / mowing, 0.5 = neutral)
 * B = wear (trampled / bare areas)        A = generic noise (edges, chalk irregularity)
 */
function buildSurfaceMask(
  sizeU: number,
  sizeV: number,
  pxPerM: number,
  fn: (u: number, v: number) => [number, number, number, number]
): THREE.DataTexture {
  const w = Math.max(16, Math.round(sizeU * pxPerM));
  const h = Math.max(16, Math.round(sizeV * pxPerM));
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const v = ((j + 0.5) / h - 0.5) * sizeV;
    for (let i = 0; i < w; i++) {
      const u = ((i + 0.5) / w - 0.5) * sizeU;
      const px = fn(u, v);
      const o = (j * w + i) * 4;
      for (let k = 0; k < 4; k++) data[o + k] = Math.round(Math.min(1, Math.max(0, px[k])) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Shared PBR library binding (see blender/recreation/rec_materials.py)
// ---------------------------------------------------------------------------

interface LibEntry {
  id: string;
  map: THREE.Texture;
  /** null when the builder deliberately ships no normal / ORM map for this material (download budget) */
  normalMap: THREE.Texture | null;
  orm: THREE.Texture | null;
  tileW: number;
  tileH: number;
  avgAlbedo: THREE.Color;
  avgRoughness: number;
}

type LibMap = Map<string, LibEntry>;

function requireLib(lib: LibMap, id: string): LibEntry {
  const entry = lib.get(id);
  if (!entry) {
    throw new Error(`[recreation] material library has no entry '${id}' (have: ${[...lib.keys()].join(', ')})`);
  }
  return entry;
}

function requireNumber(userData: Record<string, unknown>, key: string, owner: string): number {
  const v = Number(userData[key]);
  if (userData[key] === undefined || !Number.isFinite(v)) {
    throw new Error(`[recreation] ${owner}: glTF extras '${key}' is missing or not a number (rebuild with blender/recreation/build_recreation.py)`);
  }
  return v;
}

function extractLibrary(root: THREE.Object3D, maxAnisotropy: number): LibMap {
  const lib: LibMap = new Map();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const id = mat.userData?.libId as string | undefined;
    if (!id) throw new Error(`[recreation] library swatch '${mesh.name}' has a material without libId`);
    const owner = `library material '${id}'`;
    const shipped = String(mat.userData.libMapsShipped ?? '').split(',');
    const avg = mat.userData.avgAlbedo as number[] | undefined;
    if (!avg || avg.length !== 3) throw new Error(`[recreation] ${owner}: extras 'avgAlbedo' missing`);
    const wanted: [string, THREE.Texture | null][] = [
      ['albedo', mat.map],
      ['normal', mat.normalMap],
      ['orm', mat.roughnessMap],
    ];
    for (const [kind, tex] of wanted) {
      if (shipped.includes(kind) !== Boolean(tex)) {
        throw new Error(`[recreation] ${owner}: map '${kind}' is ${tex ? 'present' : 'missing'} but the builder lists [${shipped.join(', ')}]`);
      }
      if (!tex) continue;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = Math.min(8, maxAnisotropy);
    }
    if (!mat.map) throw new Error(`[recreation] ${owner}: no albedo texture`);
    lib.set(id, {
      id,
      map: mat.map,
      normalMap: mat.normalMap,
      orm: mat.roughnessMap,
      tileW: requireNumber(mat.userData, 'tileW', owner),
      tileH: requireNumber(mat.userData, 'tileH', owner),
      avgAlbedo: new THREE.Color(avg[0], avg[1], avg[2]),
      avgRoughness: requireNumber(mat.userData, 'avgRoughness', owner),
    });
  });
  if (lib.size === 0) throw new Error('[recreation] recreation_materials.glb contains no library materials');
  return lib;
}

/** Binds the library maps onto one glTF material that references them via `userData.lib`. */
function bindLibraryMaterial(mat: THREE.MeshStandardMaterial, lib: LibMap): void {
  const id = mat.userData?.lib as string | undefined;
  if (!id || mat.userData.libBound) return;
  const e = requireLib(lib, id);
  const owner = `material '${mat.name}'`;
  if (mat.userData.libMaps !== 'no_albedo') mat.map = e.map;
  if (e.normalMap) {
    mat.normalMap = e.normalMap;
    mat.normalScale.setScalar(requireNumber(mat.userData, 'normalScale', owner));
  }
  if (e.orm) {
    mat.roughnessMap = e.orm;
    mat.metalnessMap = e.orm;
    mat.aoMap = e.orm;
    mat.roughness = requireNumber(mat.userData, 'roughScale', owner); // multiplier for the roughness map
  } else {
    mat.roughness = requireNumber(mat.userData, 'roughFlat', owner);
  }
  mat.color.multiplyScalar(requireNumber(mat.userData, 'colorBoost', owner));
  mat.userData.libBound = true;
  mat.needsUpdate = true;
}

interface LibMaterialOpts {
  color?: THREE.ColorRepresentation;
  boost?: number;
  /** multiplier for the roughness map, or (for materials without ORM) for the library's mean roughness */
  roughness?: number;
  metalness?: number;
  normalScale?: number;
}

/** Library-backed, vertex-coloured material for the geometry generated here (fences, rails, edging). */
function makeLibMaterial(lib: LibMap, id: string, name: string, o: LibMaterialOpts = {}): THREE.MeshStandardMaterial {
  const e = requireLib(lib, id);
  const mat = new THREE.MeshStandardMaterial({
    name,
    map: e.map,
    normalMap: e.normalMap,
    roughnessMap: e.orm,
    metalnessMap: e.orm,
    aoMap: e.orm,
    roughness: e.orm ? (o.roughness ?? 1) : Math.min(1, e.avgRoughness * (o.roughness ?? 1)),
    metalness: o.metalness ?? 0,
    vertexColors: true,
  });
  mat.color.set(o.color ?? 0xffffff).multiplyScalar(o.boost ?? 1);
  mat.normalScale.setScalar(o.normalScale ?? 1);
  mat.envMapIntensity = 0.72;
  return mat;
}

// ---------------------------------------------------------------------------
// Terrain-draped PBR ground surfaces
// ---------------------------------------------------------------------------

interface FloodRig {
  /** xy = mast position in patch-local metres, z = lamp height above the surface */
  masts: THREE.Vector3[];
  /** aim point of each mast in patch-local metres */
  aims: THREE.Vector2[];
  /** calibrated light level: 0 = off */
  intensity: { value: number };
  color: THREE.Color;
  /** moving sphere occluders (ball, tractor): xyz = patch-local (u, v, height), w = radius, 0 = inactive */
  occluders: THREE.Vector4[];
  /** 1 = analytic floodlight shadows on, 0 = off (low quality) */
  shadowStrength: { value: number };
}

type LineSet = 'none' | 'pitch' | 'kleinfeld';

interface GroundSurfaceOpts {
  name: string;
  libId: string;
  cx: number;
  cz: number;
  rot: number;
  sizeU: number;
  sizeV: number;
  yOffset: number;
  renderOrder: number;
  offsetUnits: number;
  /** target albedo (linear) of the dry / damp / worn surface; photo detail is re-applied on top */
  dry: THREE.ColorRepresentation;
  damp: THREE.ColorRepresentation;
  wear: THREE.ColorRepresentation;
  wearStrength?: number;
  streak?: number;
  detail?: number;
  /** edge fade width (m), corner radius (m) and edge noise amplitude (m) */
  feather: number;
  corner: number;
  edgeNoise: number;
  mask: THREE.DataTexture;
  noiseRepeat?: number;
  uvRot?: number;
  normalScale?: number;
  dampRoughness?: number;
  /** strength of the fine procedural speckle (crushed-clay / grit surfaces) */
  grit?: number;
  lines?: LineSet;
  lineColor?: THREE.ColorRepresentation;
  flood?: FloodRig;
}

const GROUND_VERTEX_HEAD = /* glsl */ `
attribute vec2 aRecLocal;
varying vec2 vRecLocal;
`;

const GROUND_FRAGMENT_HEAD = /* glsl */ `
varying vec2 vRecLocal;
uniform sampler2D uRecMask;
uniform vec2 uRecHalf;
uniform vec3 uRecAvg;
uniform vec3 uRecDry;
uniform vec3 uRecDamp;
uniform vec3 uRecWear;
uniform vec3 uRecLineCol;
uniform vec4 uRecParams;   // x = detail, y = streak, z = wear strength, w = noise repeat
uniform vec4 uRecEdge;     // x = feather, y = corner radius, z = edge noise, w = damp roughness factor
uniform float uRecGrit;    // strength of the millimetre-scale mineral speckle
float recDampK = 0.0;
float recSdBox(vec2 p, vec2 h) {
  vec2 d = abs(p) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
`;

/**
 * Floodlighting of the main pitch, evaluated analytically per fragment (no scene lights involved):
 * six masts with an inverse-square, cosine-weighted beam aimed into the pitch (hot pool in front of
 * every mast, dim corners and centre line), plus projected shadows of both goal frames and of the
 * moving sphere occluders (ball, tractor) from every mast, which gives the typical star of shadows.
 */
const GROUND_FLOOD_HEAD = /* glsl */ `
#define REC_MASTS 6
#define REC_OCCLUDERS 2
uniform vec3 uRecMast[REC_MASTS];
uniform vec2 uRecAim[REC_MASTS];
uniform vec4 uRecOcc[REC_OCCLUDERS];
uniform float uRecFlood;
uniform float uRecShadowK;
uniform vec3 uRecFloodCol;
float recSegDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0));
}
float recCross(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
float recGoalShadow(vec2 p, vec3 lamp, float gu) {
  const float H = 2.5;
  float k = H / (lamp.z - H);
  vec2 a = vec2(gu, -3.72);
  vec2 b = vec2(gu, 3.72);
  vec2 a2 = a + (a - lamp.xy) * k;
  vec2 b2 = b + (b - lamp.xy) * k;
  float d = min(min(recSegDist(p, a, a2), recSegDist(p, b, b2)), recSegDist(p, a2, b2));
  float soft = 0.04 + 0.035 * distance(p, vec2(gu, clamp(p.y, -3.72, 3.72)));
  float frame = 1.0 - smoothstep(0.06, 0.06 + soft, d);
  float c1 = recCross(b - a, p - a);
  float c2 = recCross(b2 - b, p - b);
  float c3 = recCross(a2 - b2, p - b2);
  float c4 = recCross(a - a2, p - a2);
  float net = step(0.0, min(min(c1, c2), min(c3, c4))) + step(0.0, -max(max(c1, c2), max(c3, c4)));
  return max(frame * 0.85, 0.2 * net);
}
float recSphereShadow(vec2 p, vec3 lamp, vec4 s) {
  vec3 ro = vec3(p, 0.0);
  vec3 rd = lamp - ro;
  float t = clamp(dot(s.xyz - ro, rd) / dot(rd, rd), 0.0, 1.0);
  float d = length(ro + rd * t - s.xyz);
  float soft = 0.06 * s.w + 0.022 * length(rd) * t;
  return (1.0 - smoothstep(s.w - soft, s.w + soft, d)) * step(1e-3, s.w);
}
// Soft contact shadow below the moving occluders: stands in for the shadow of the (shadow-free)
// overhead fill lights, so ball and tractor sit on the clay instead of floating on it.
float recContactShadow(vec2 p) {
  if (uRecFlood <= 0.0 || uRecShadowK < 0.5) return 0.0;
  float occ = 0.0;
  for (int k = 0; k < REC_OCCLUDERS; k++) {
    vec4 s = uRecOcc[k];
    occ = max(occ, (1.0 - smoothstep(0.5 * s.w, 1.35 * s.w, distance(p, s.xy))) * step(1e-3, s.w));
  }
  return 0.62 * occ * clamp(uRecFlood / 60.0, 0.0, 1.0);
}
float recFloodIrradiance(vec2 p) {
  float e = 0.0;
  for (int i = 0; i < REC_MASTS; i++) {
    vec3 lamp = uRecMast[i];
    vec3 toLamp = vec3(lamp.xy - p, lamp.z);
    float d2 = dot(toLamp, toLamp);
    vec3 l = toLamp * inversesqrt(d2);
    vec3 axis = normalize(vec3(uRecAim[i] - lamp.xy, -lamp.z));
    float cone = smoothstep(0.6, 0.985, dot(-l, axis));
    float beam = l.z * (0.035 + 0.965 * cone * cone) / d2;
    float occ = 0.0;
    if (uRecShadowK > 0.5) {
      occ = max(recGoalShadow(p, lamp, -41.0), recGoalShadow(p, lamp, 41.0));
      for (int k = 0; k < REC_OCCLUDERS; k++) occ = max(occ, recSphereShadow(p, lamp, uRecOcc[k]));
    }
    e += beam * (1.0 - occ);
  }
  return e;
}
`;

/** Analytic, resolution-independent chalk markings of the 82 m x 50 m Tennenplatz. */
const PITCH_LINES_GLSL = /* glsl */ `
float recLineDist(vec2 p) {
  float d = abs(recSdBox(p, vec2(41.0, 25.0)));
  d = min(d, max(abs(p.x), abs(p.y) - 25.0));
  float r = length(p);
  d = min(d, abs(r - 9.15));
  d = min(d, max(r - 0.06, 0.0));
  vec2 q = vec2(abs(p.x), p.y);
  d = min(d, abs(recSdBox(q - vec2(32.75, 0.0), vec2(8.25, 20.16))));
  d = min(d, abs(recSdBox(q - vec2(38.25, 0.0), vec2(2.75, 9.16))));
  float rs = length(q - vec2(30.0, 0.0));
  d = min(d, max(rs - 0.05, 0.0));
  if (q.x < 24.5) d = min(d, abs(rs - 9.15));
  vec2 c = abs(p) - vec2(41.0, 25.0);
  if (c.x < 0.0 && c.y < 0.0) d = min(d, abs(length(c) - 1.0));
  return d;
}
float recLines(vec2 p, vec4 n) {
  float d = recLineDist(p + (n.xy - 0.5) * 0.06);
  float w = 0.055 * (0.65 + 0.7 * n.b);
  float aa = max(fwidth(d), 1e-4);
  float cov = 1.0 - smoothstep(w - aa, w + aa, d);
  return cov * (0.5 + 0.5 * smoothstep(0.3, 0.62, n.a));
}
`;

/** Faded markings of the 15 m x 42 m grass training pitch. */
const KLEINFELD_LINES_GLSL = /* glsl */ `
float recLines(vec2 p, vec4 n) {
  float d = abs(recSdBox(p, vec2(7.5, 21.0)));
  d = min(d, max(abs(p.y), abs(p.x) - 7.5));
  d = min(d, abs(length(p) - 4.2));
  vec2 q = vec2(p.x, abs(p.y));
  d = min(d, abs(recSdBox(q - vec2(0.0, 17.9), vec2(5.2, 3.1))));
  float w = 0.05 * (0.6 + 0.8 * n.b);
  float aa = max(fwidth(d), 1e-4);
  return (1.0 - smoothstep(w - aa, w + aa, d)) * 0.55 * smoothstep(0.35, 0.7, n.a);
}
`;

const LINE_GLSL: Record<LineSet, string> = {
  none: /* glsl */ `float recLines(vec2 p, vec4 n) { return 0.0; }`,
  pitch: PITCH_LINES_GLSL,
  kleinfeld: KLEINFELD_LINES_GLSL,
};

function createGroundSurface(o: GroundSurfaceOpts, lib: LibMap, terrain: TerrainSystem): THREE.Mesh {
  const entry = requireLib(lib, o.libId);
  const segsU = Math.max(2, Math.ceil(o.sizeU / 1.7));
  const segsV = Math.max(2, Math.ceil(o.sizeV / 1.7));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const locals: number[] = [];
  const indices: number[] = [];
  const cr = Math.cos(o.uvRot ?? 0.0);
  const sr = Math.sin(o.uvRot ?? 0.0);

  // Drape on the RENDERED terrain triangles (4 m cells split along a diagonal), not on the bilinear
  // physics height: the two differ by several centimetres, enough for the terrain to poke through the
  // thin, depth-offset surface as sharp-edged polygons (the "stray patches" on the playground lawn).
  const stride = segsU + 1;
  const heights = new Float64Array((segsU + 1) * (segsV + 1));
  for (let iv = 0; iv <= segsV; iv++) {
    const v = (iv / segsV - 0.5) * o.sizeV;
    for (let iu = 0; iu <= segsU; iu++) {
      const u = (iu / segsU - 0.5) * o.sizeU;
      const [wx, wz] = localToWorld(o.cx, o.cz, o.rot, u, v);
      heights[iv * stride + iu] = terrain.getRenderedSurfaceHeight(wx, wz);
    }
  }
  // Our grid does not follow the terrain's creases: where a convex crease runs through one of our cells the
  // terrain bulges above the cell's chord. Sample every cell and lift its corners by the largest deficit.
  const lift = new Float64Array(heights.length);
  const cellU = o.sizeU / segsU;
  const cellV = o.sizeV / segsV;
  const SAMPLES = 5;
  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const i00 = iv * stride + iu;
      const h00 = heights[i00];
      const h10 = heights[i00 + 1];
      const h01 = heights[i00 + stride];
      const h11 = heights[i00 + stride + 1];
      let deficit = 0;
      for (let s = 0; s <= SAMPLES; s++) {
        for (let t = 0; t <= SAMPLES; t++) {
          const fu = s / SAMPLES;
          const fv = t / SAMPLES;
          // same split as the index buffer below: (00, 01, 10) and (10, 01, 11)
          const meshH = fu + fv <= 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
          const u = (iu / segsU - 0.5) * o.sizeU + fu * cellU;
          const v = (iv / segsV - 0.5) * o.sizeV + fv * cellV;
          const [wx, wz] = localToWorld(o.cx, o.cz, o.rot, u, v);
          deficit = Math.max(deficit, terrain.getRenderedSurfaceHeight(wx, wz) - meshH);
        }
      }
      if (deficit > 0) {
        for (const k of [i00, i00 + 1, i00 + stride, i00 + stride + 1]) lift[k] = Math.max(lift[k], deficit);
      }
    }
  }

  for (let iv = 0; iv <= segsV; iv++) {
    const v = (iv / segsV - 0.5) * o.sizeV;
    for (let iu = 0; iu <= segsU; iu++) {
      const u = (iu / segsU - 0.5) * o.sizeU;
      const [wx, wz] = localToWorld(o.cx, o.cz, o.rot, u, v);
      const n = terrain.getTerrainNormal(wx, wz, 2.5);
      const k = iv * stride + iu;
      positions.push(wx, heights[k] + lift[k] + o.yOffset, wz);
      normals.push(n.x, n.y, n.z);
      uvs.push((u * cr - v * sr) / entry.tileW, (u * sr + v * cr) / entry.tileH);
      locals.push(u, v);
    }
  }
  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const i00 = iv * stride + iu;
      indices.push(i00, i00 + stride, i00 + 1, i00 + 1, i00 + stride, i00 + stride + 1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('aRecLocal', new THREE.Float32BufferAttribute(locals, 2));
  geom.setIndex(indices);
  geom.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    name: `RecGround_${o.name}`,
    map: entry.map,
    normalMap: entry.normalMap,
    roughnessMap: entry.orm,
    aoMap: entry.orm,
    roughness: entry.orm ? 1.0 : entry.avgRoughness,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: o.offsetUnits,
  });
  mat.normalScale.setScalar(o.normalScale ?? 1.0);
  mat.envMapIntensity = 0.6;

  const uniforms: Record<string, THREE.IUniform> = {
    uRecMask: { value: o.mask },
    uRecHalf: { value: new THREE.Vector2(o.sizeU * 0.5, o.sizeV * 0.5) },
    uRecAvg: { value: entry.avgAlbedo },
    uRecDry: { value: new THREE.Color(o.dry) },
    uRecDamp: { value: new THREE.Color(o.damp) },
    uRecWear: { value: new THREE.Color(o.wear) },
    uRecLineCol: { value: new THREE.Color(o.lineColor ?? 0xe6e2d6) },
    uRecParams: { value: new THREE.Vector4(o.detail ?? 0.9, o.streak ?? 0.0, o.wearStrength ?? 0.0, o.noiseRepeat ?? 6.0) },
    uRecEdge: { value: new THREE.Vector4(o.feather, o.corner, o.edgeNoise, o.dampRoughness ?? 0.7) },
    uRecGrit: { value: o.grit ?? 0.0 },
  };
  if (o.flood) {
    uniforms.uRecMast = { value: o.flood.masts };
    uniforms.uRecAim = { value: o.flood.aims };
    uniforms.uRecOcc = { value: o.flood.occluders };
    uniforms.uRecFlood = o.flood.intensity;
    uniforms.uRecShadowK = o.flood.shadowStrength;
    uniforms.uRecFloodCol = { value: o.flood.color };
  }

  const hasFlood = Boolean(o.flood);
  const lineSet: LineSet = o.lines ?? 'none';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GROUND_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRecLocal = aRecLocal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_FRAGMENT_HEAD}\n${hasFlood ? GROUND_FLOOD_HEAD : ''}\n${LINE_GLSL[lineSet]}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
  {
    vec2 recUv = vRecLocal / (2.0 * uRecHalf) + 0.5;
    vec4 recM = texture2D(uRecMask, recUv);
    vec4 recN = texture2D(uRecMask, recUv * uRecParams.w + vec2(0.37, 0.11));
    // photo detail around 1.0; a second, much larger sample hides the tile repetition
    vec3 recDetail = diffuseColor.rgb / uRecAvg;
    vec3 recFar = texture2D(map, vMapUv * 0.173 + vec2(0.31, 0.67)).rgb / uRecAvg;
    recDetail = mix(vec3(1.0), recDetail * mix(vec3(1.0), recFar, 0.6), uRecParams.x);
    recDampK = smoothstep(0.42, 0.72, recM.r);
    vec3 recCol = mix(uRecDry, uRecDamp, recDampK);
    float recWearK = smoothstep(0.3, 0.8, recM.b) * uRecParams.z;
    recCol = mix(recCol, uRecWear, recWearK);
    recCol *= 1.0 + (recM.g - 0.5) * uRecParams.y;
    recCol *= recDetail;
    // millimetre-scale mineral grit (fades out with distance through the mask mip chain)
    float recGrit = texture2D(uRecMask, recUv * uRecParams.w * 23.0).a + texture2D(uRecMask, recUv * uRecParams.w * 61.0 + 0.5).g;
    recCol *= 1.0 + (recGrit - 1.0) * uRecGrit;
    float recLine = recLines(vRecLocal, recN) * (1.0 - 0.6 * recWearK);
    recCol = mix(recCol, uRecLineCol * mix(0.85, 1.05, recN.a), recLine);
    diffuseColor.rgb = recCol;
    float recInside = uRecEdge.y - recSdBox(vRecLocal, uRecHalf - vec2(uRecEdge.y));
    diffuseColor.a *= smoothstep(0.0, uRecEdge.x, recInside + (recN.a - 0.5) * uRecEdge.z);${hasFlood ? '\n    diffuseColor.rgb *= 1.0 - recContactShadow(vRecLocal);' : ''}
  }`
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor *= mix(1.0, uRecEdge.w, recDampK);`);
    if (hasFlood) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n  if (uRecFlood > 0.0) totalEmissiveRadiance += diffuseColor.rgb * uRecFloodCol * (uRecFlood * recFloodIrradiance(vRecLocal));`
      );
    }
  };
  // One program per shader VARIANT (flood on/off x line set), shared by all surfaces of that variant;
  // everything else that differs between surfaces is a uniform.
  mat.customProgramCacheKey = () => `rec-ground|flood:${hasFlood ? 1 : 0}|lines:${lineSet}`;

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = o.name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = o.renderOrder;
  return mesh;
}

// ---------------------------------------------------------------------------
// Small procedural textures that stay canvas-based (text / pattern, not surfaces)
// ---------------------------------------------------------------------------

function createSponsorBoardTexture(
  bgHex: string,
  accentHex: string,
  textHex: string,
  title: string,
  sub: string,
  seed: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[recreation] 2D canvas context unavailable for sponsor boards');
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, W, 14);
  ctx.fillRect(0, H - 14, W, 14);
  ctx.fillRect(34, 60, 10, H - 120);
  ctx.fillRect(W - 44, 60, 10, H - 120);

  ctx.fillStyle = textHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 86;
  ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  while (ctx.measureText(title).width > W - 130 && size > 40) {
    size -= 4;
    ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  }
  ctx.fillText(title, W / 2, 104);
  ctx.fillStyle = accentHex;
  let subSize = 36;
  ctx.font = `700 ${subSize}px "Helvetica Neue", Arial, sans-serif`;
  while (ctx.measureText(sub).width > W - 130 && subSize > 20) {
    subSize -= 2;
    ctx.font = `700 ${subSize}px "Helvetica Neue", Arial, sans-serif`;
  }
  ctx.fillText(sub, W / 2, 186);

  // outdoor weathering: sun-bleached blotches, rain streaks from the top edge, splashed dirt at the bottom
  const rand = mulberry32(seed);
  for (let i = 0; i < 60; i++) {
    const x = rand() * W;
    const len = 30 + rand() * 150;
    const g = ctx.createLinearGradient(0, 14, 0, 14 + len);
    g.addColorStop(0, 'rgba(60, 52, 40, 0.16)');
    g.addColorStop(1, 'rgba(60, 52, 40, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 14, 2 + rand() * 5, len);
  }
  const splash = ctx.createLinearGradient(0, H - 70, 0, H);
  splash.addColorStop(0, 'rgba(150, 110, 84, 0)');
  splash.addColorStop(1, 'rgba(150, 110, 84, 0.34)');
  ctx.fillStyle = splash;
  ctx.fillRect(0, H - 70, W, 70);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.02 + rand() * 0.04})`;
    ctx.beginPath();
    ctx.ellipse(rand() * W, rand() * H, 40 + rand() * 120, 20 + rand() * 50, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/** Classic 32-panel football as an equirectangular map: 12 black pentagons, 20 white hexagons, seams. */
function createSoccerBallTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[recreation] 2D canvas context unavailable for the ball texture');
  const phi = (1 + Math.sqrt(5)) / 2;
  const pent: THREE.Vector3[] = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      pent.push(new THREE.Vector3(0, s1, s2 * phi).normalize());
      pent.push(new THREE.Vector3(s1, s2 * phi, 0).normalize());
      pent.push(new THREE.Vector3(s1 * phi, 0, s2).normalize());
    }
  }
  const hex: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      for (let k = j + 1; k < 12; k++) {
        const a = pent[i];
        const b = pent[j];
        const d = pent[k];
        // icosahedron faces: three mutually adjacent vertices (edge angle ~63.4 deg)
        if (a.dot(b) > 0.44 && a.dot(d) > 0.44 && b.dot(d) > 0.44) {
          hex.push(new THREE.Vector3().add(a).add(b).add(d).normalize());
        }
      }
    }
  }
  if (hex.length !== 20) throw new Error(`[recreation] ball pattern: expected 20 hexagon centres, got ${hex.length}`);
  // weights make the spherical Voronoi cells match the truncated icosahedron (pentagons smaller)
  const centres = [...pent.map((v) => ({ v, w: 0.0, black: true })), ...hex.map((v) => ({ v, w: 0.058, black: false }))];
  const img = ctx.createImageData(W, H);
  const dir = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2;
      dir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      let best = -2;
      let second = -2;
      let black = false;
      for (const ce of centres) {
        const s = dir.dot(ce.v) + ce.w;
        if (s > best) {
          second = best;
          best = s;
          black = ce.black;
        } else if (s > second) {
          second = s;
        }
      }
      const seam = smooth01(0.0, 0.012, best - second);
      const base = black ? 26 : 236;
      const o = (y * W + x) * 4;
      const val = 60 + (base - 60) * seam;
      img.data[o] = val;
      img.data[o + 1] = val;
      img.data[o + 2] = black ? val : val * 0.985;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function createFloodlightHaloTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[recreation] 2D canvas context unavailable for the floodlight halo');
  const g = ctx.createRadialGradient(64, 64, 1, 64, 64, 63);
  g.addColorStop(0, 'rgba(255, 252, 236, 1.0)');
  g.addColorStop(0.12, 'rgba(255, 246, 214, 0.78)');
  g.addColorStop(0.4, 'rgba(255, 236, 190, 0.18)');
  g.addColorStop(1, 'rgba(255, 225, 160, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Merged static geometry: everything that never moves is baked into ONE mesh per
// (site, visibility tier, material). Sites: main pitch / playground. Tiers: "large" (always drawn,
// frustum-culled as a whole) and "detail" (small props, hidden beyond a quality-dependent distance).
// ---------------------------------------------------------------------------

type SiteId = 'pitch' | 'play';
type Tier = 'large' | 'detail';

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Rewrites UVs of a freshly built primitive to metres (box projection) divided by the tile size. */
function metricUv(geom: THREE.BufferGeometry, tileW: number, tileH: number, grainAlongX = false): void {
  const pos = geom.getAttribute('position');
  const nrm = geom.getAttribute('normal');
  const uv = geom.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    if (grainAlongX) uv.setXY(i, v / tileW, u / tileH);
    else uv.setXY(i, u / tileW, v / tileH);
  }
}

function floatAttribute(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, itemSize: number, scale = 1): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attr.getComponent(i, k) * scale;
  }
  return new THREE.BufferAttribute(out, itemSize);
}

/** Common attribute layout for merging: indexed, float position / normal / uv / colour (rgb). */
function normalizeForMerge(src: THREE.BufferGeometry, tint: number, owner: string): THREE.BufferGeometry {
  const pos = src.getAttribute('position');
  const nrm = src.getAttribute('normal');
  const uv = src.getAttribute('uv');
  if (!pos || !nrm || !uv) throw new Error(`[recreation] ${owner}: geometry lacks position / normal / uv and cannot be merged`);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', floatAttribute(pos, 3));
  out.setAttribute('normal', floatAttribute(nrm, 3));
  out.setAttribute('uv', floatAttribute(uv, 2));
  const col = src.getAttribute('color');
  if (col) {
    out.setAttribute('color', floatAttribute(col, 3, tint));
  } else {
    out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(tint), 3));
  }
  if (src.index) {
    out.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  } else {
    const idx = new Uint32Array(pos.count);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}

interface BatchBucket {
  site: SiteId;
  tier: Tier;
  mat: THREE.Material;
  geoms: THREE.BufferGeometry[];
}

class StaticBatch {
  /** where the next pieces go */
  public site: SiteId = 'pitch';
  public tier: Tier = 'large';
  private readonly buckets = new Map<string, BatchBucket>();
  private readonly keyed = new Map<string, THREE.Material>();
  private readonly mergedMaterials = new Map<string, THREE.Material>();

  public register(key: string, mat: THREE.Material): void {
    this.keyed.set(key, mat);
  }

  /**
   * Material actually used by the merged meshes. glTF materials come in two variants (with / without
   * vertex colours) under the same name; merged geometry always has colours, so one vertex-coloured
   * material per name is used (the plain variant stays untouched for the animated nodes).
   */
  private mergedMaterial(mat: THREE.Material): THREE.Material {
    if (!mat.name) throw new Error('[recreation] cannot merge geometry of an unnamed material');
    const known = this.mergedMaterials.get(mat.name);
    if (known) return known;
    let merged = mat;
    if (!mat.vertexColors) {
      merged = mat.clone();
      merged.vertexColors = true;
      merged.userData = { ...mat.userData };
    }
    this.mergedMaterials.set(mat.name, merged);
    return merged;
  }

  public addWithMaterial(mat: THREE.Material, geom: THREE.BufferGeometry, tint = 1.0): void {
    const merged = this.mergedMaterial(mat);
    const key = `${this.site}|${this.tier}|${merged.name}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { site: this.site, tier: this.tier, mat: merged, geoms: [] };
      this.buckets.set(key, bucket);
    }
    bucket.geoms.push(normalizeForMerge(geom, tint, merged.name));
  }

  public add(key: string, geom: THREE.BufferGeometry, tint = 1.0): void {
    const mat = this.keyed.get(key);
    if (!mat) throw new Error(`[recreation] static batch material '${key}' was never registered`);
    this.addWithMaterial(mat, geom, tint);
    geom.dispose();
  }

  /** Cylinder / tapered tube from a to b. */
  public tube(key: string, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, radial = 8, tint = 1.0, tile = 1.0): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-5) throw new Error(`[recreation] zero-length tube in static batch '${key}'`);
    const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, false);
    const uv = g.getAttribute('uv');
    const circ = 2 * Math.PI * Math.max(r0, r1);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * len) / tile);
    _q.setFromUnitVectors(_up, dir.normalize());
    _m.compose(a.clone().add(b).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
    this.add(key, g, tint);
  }

  /** Box with metric UVs; rotated around Y, optionally leaning (rotation around its own X / Z). */
  public box(
    key: string,
    center: THREE.Vector3,
    size: [number, number, number],
    rotY = 0,
    tint = 1.0,
    tile: [number, number] = [1, 1],
    grainAlongX = false,
    pitch = 0,
    roll = 0
  ): void {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    metricUv(g, tile[0], tile[1], grainAlongX);
    _m.makeRotationFromEuler(new THREE.Euler(pitch, rotY, roll, 'YXZ'));
    _m.setPosition(center);
    g.applyMatrix4(_m);
    this.add(key, g, tint);
  }

  /** Member with rectangular section between two points (rails that follow the terrain). */
  public beam(key: string, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, tint = 1.0, tile: [number, number] = [1, 1]): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-5) throw new Error(`[recreation] zero-length beam in static batch '${key}'`);
    const g = new THREE.BoxGeometry(len, h, w);
    metricUv(g, tile[0], tile[1], true);
    const x = dir.normalize();
    const z = new THREE.Vector3().crossVectors(x, _up).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    _m.makeBasis(x, y, z);
    _m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(_m);
    this.add(key, g, tint);
  }

  public quad(key: string, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, uv: number[]): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...p0.toArray(), ...p1.toArray(), ...p2.toArray(), ...p0.toArray(), ...p2.toArray(), ...p3.toArray()], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]], 2));
    g.computeVertexNormals();
    this.add(key, g);
  }

  /** Bakes one static mesh of a placed asset (world matrix must be up to date). */
  public bakeMesh(mesh: THREE.Mesh): void {
    if (Array.isArray(mesh.material)) throw new Error(`[recreation] '${mesh.name}': multi-material meshes cannot be baked`);
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    this.addWithMaterial(mesh.material, g);
    g.dispose();
  }

  public build(group: THREE.Group, sink: (site: SiteId, tier: Tier, mesh: THREE.Mesh) => void): void {
    for (const [key, bucket] of this.buckets) {
      const merged = mergeGeometries(bucket.geoms, false);
      if (!merged) throw new Error(`[recreation] could not merge static batch '${key}'`);
      for (const g of bucket.geoms) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.mat);
      mesh.name = `RecStatic_${key}`;
      mesh.castShadow = !bucket.mat.transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
      sink(bucket.site, bucket.tier, mesh);
    }
    this.buckets.clear();
  }
}

function groundPoint(terrain: TerrainSystem, x: number, z: number, dy = 0): THREE.Vector3 {
  return new THREE.Vector3(x, terrain.getTerrainHeight(x, z) + dy, z);
}

/** Galvanised chain-link ball-stop fence that follows the terrain. */
function buildChainlinkFence(
  batch: StaticBatch,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  heightM: number,
  postSpacingM: number,
  terrain: TerrainSystem
): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const bays = Math.max(1, Math.round(len / postSpacingM));
  const dirX = (x1 - x0) / len;
  const dirZ = (z1 - z0) / len;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    pts.push(groundPoint(terrain, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t));
  }
  const meshTile = 0.24;
  for (let i = 0; i <= bays; i++) {
    const p = pts[i];
    batch.tube('galv', p.clone().setY(p.y - 0.5), p.clone().setY(p.y + heightM + 0.06), 0.045, 0.045, 8);
    batch.tube('galv', p.clone().setY(p.y + heightM + 0.06), p.clone().setY(p.y + heightM + 0.085), 0.05, 0.02, 8);
    batch.box('concrete', p.clone().setY(p.y + 0.02), [0.36, 0.1, 0.36], Math.atan2(-dirZ, dirX));
    if (i === 0 || i === bays) {
      const s = i === 0 ? 1 : -1;
      const foot = groundPoint(terrain, p.x + dirX * s * 2.1, p.z + dirZ * s * 2.1);
      batch.tube('galv', foot, p.clone().setY(p.y + heightM * 0.72), 0.03, 0.03, 6);
    }
  }
  for (let i = 0; i < bays; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    for (const [frac, r] of [
      [0.012, 0.012],
      [0.37, 0.016],
      [0.69, 0.016],
      [1.0, 0.022],
    ] as [number, number][]) {
      batch.tube('galv', a.clone().setY(a.y + heightM * frac + 0.04), b.clone().setY(b.y + heightM * frac + 0.04), r, r, 6);
    }
    batch.quad(
      'chainlink',
      a.clone().setY(a.y + 0.06),
      b.clone().setY(b.y + 0.06),
      b.clone().setY(b.y + heightM + 0.03),
      a.clone().setY(a.y + heightM + 0.03),
      [0, 0, segLen / meshTile, 0, segLen / meshTile, heightM / meshTile, 0, heightM / meshTile]
    );
  }
}

/** White tubular spectator barrier (Barriere) around the pitch. */
function buildSpectatorRail(batch: StaticBatch, x0: number, z0: number, x1: number, z1: number, terrain: TerrainSystem): void {
  const heightM = 1.08;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const bays = Math.max(1, Math.round(len / 2.6));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    pts.push(groundPoint(terrain, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t));
  }
  for (let i = 0; i <= bays; i++) {
    const p = pts[i];
    batch.tube('railWhite', p.clone().setY(p.y - 0.35), p.clone().setY(p.y + heightM - 0.03), 0.032, 0.032, 8);
    batch.tube('concrete', p.clone().setY(p.y - 0.02), p.clone().setY(p.y + 0.03), 0.14, 0.12, 8);
  }
  for (let i = 0; i < bays; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    batch.tube('railWhite', a.clone().setY(a.y + heightM), b.clone().setY(b.y + heightM), 0.034, 0.034, 8);
    batch.tube('railWhite', a.clone().setY(a.y + heightM * 0.5), b.clone().setY(b.y + heightM * 0.5), 0.02, 0.02, 6);
  }
}

/** Robinia picket fence with pointed pickets around the playground. */
function buildPicketFence(
  batch: StaticBatch,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  terrain: TerrainSystem,
  rand: () => number,
  woodTile: [number, number]
): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const bays = Math.max(1, Math.round(len / 2.2));
  const yaw = Math.atan2(-(z1 - z0), x1 - x0);
  const shape = new THREE.Shape();
  shape.moveTo(-0.042, 0);
  shape.lineTo(0.042, 0);
  shape.lineTo(0.042, 0.86);
  shape.lineTo(0, 0.93);
  shape.lineTo(-0.042, 0.86);
  shape.closePath();
  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    const p = groundPoint(terrain, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    batch.box('wood', p.clone().setY(p.y + 0.3), [0.1, 1.5, 0.1], yaw, 0.82 + rand() * 0.3, woodTile);
    batch.box('wood', p.clone().setY(p.y + 1.065), [0.13, 0.03, 0.13], yaw, 0.8 + rand() * 0.2, woodTile);
  }
  for (let i = 0; i < bays; i++) {
    const a = groundPoint(terrain, x0 + ((x1 - x0) * i) / bays, z0 + ((z1 - z0) * i) / bays);
    const b = groundPoint(terrain, x0 + ((x1 - x0) * (i + 1)) / bays, z0 + ((z1 - z0) * (i + 1)) / bays);
    for (const h of [0.3, 0.74]) {
      batch.beam('wood', a.clone().setY(a.y + h), b.clone().setY(b.y + h), 0.045, 0.075, 0.85 + rand() * 0.25, woodTile);
    }
    const bayLen = Math.hypot(b.x - a.x, b.z - a.z);
    const pickets = Math.max(3, Math.round(bayLen / 0.125));
    for (let p = 1; p < pickets; p++) {
      const pt = p / pickets;
      const px = a.x + (b.x - a.x) * pt;
      const pz = a.z + (b.z - a.z) * pt;
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false });
      const uv = g.getAttribute('uv');
      const ou = rand() * 3;
      const ov = rand() * 3;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / woodTile[0] + ou, uv.getY(k) / woodTile[1] + ov);
      _m.makeRotationFromEuler(new THREE.Euler((rand() - 0.5) * 0.04, yaw, (rand() - 0.5) * 0.03, 'YXZ'));
      // pickets sit on the outer face of the rails
      const off = new THREE.Vector3(0, 0, 0.024).applyAxisAngle(_up, yaw);
      _m.setPosition(px + off.x, terrain.getTerrainHeight(px, pz) + 0.09 + (rand() - 0.5) * 0.03, pz + off.z);
      g.applyMatrix4(_m);
      batch.add('wood', g, 0.78 + rand() * 0.36);
    }
  }
}

/** Round-timber sandpit edging with corner posts and two seat boards. */
function buildSandpitEdging(
  batch: StaticBatch,
  cx: number,
  cz: number,
  rotY: number,
  wU: number,
  dV: number,
  terrain: TerrainSystem,
  rand: () => number,
  woodTile: [number, number]
): void {
  const hw = wU * 0.5;
  const hd = dV * 0.5;
  const corners: [number, number][] = [
    localToWorld(cx, cz, rotY, -hw, -hd),
    localToWorld(cx, cz, rotY, +hw, -hd),
    localToWorld(cx, cz, rotY, +hw, +hd),
    localToWorld(cx, cz, rotY, -hw, +hd),
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const segs = 3;
    for (let s = 0; s < segs; s++) {
      const a = groundPoint(terrain, ax + ((bx - ax) * s) / segs, az + ((bz - az) * s) / segs, 0.1);
      const b = groundPoint(terrain, ax + ((bx - ax) * (s + 1)) / segs, az + ((bz - az) * (s + 1)) / segs, 0.1);
      const dir = b.clone().sub(a).normalize();
      // two stacked logs, the lower one half buried; joints get a visible gap
      const tint = 0.8 + rand() * 0.32;
      batch.tube('wood', a.clone().addScaledVector(dir, 0.02), b.clone().addScaledVector(dir, -0.02), 0.115 + rand() * 0.01, 0.115 + rand() * 0.01, 12, tint, woodTile[0]);
      batch.tube('wood', a.clone().setY(a.y - 0.2).addScaledVector(dir, 0.02), b.clone().setY(b.y - 0.2).addScaledVector(dir, -0.02), 0.12, 0.12, 10, tint * 0.9, woodTile[0]);
    }
    const c = groundPoint(terrain, ax, az);
    batch.tube('wood', c.clone().setY(c.y - 0.4), c.clone().setY(c.y + 0.36), 0.15, 0.14, 12, 0.85 + rand() * 0.2, woodTile[0]);
  }
  // seat boards on the long edges
  for (const side of [-1, 1]) {
    const [sx, sz] = localToWorld(cx, cz, rotY, side * hw, side * 1.6);
    const p = groundPoint(terrain, sx, sz, 0.235);
    batch.box('wood', p, [0.4, 0.045, 2.2], rotY, 1.0 + rand() * 0.15, woodTile);
  }
}

// ---------------------------------------------------------------------------
// Manifest & System API
// ---------------------------------------------------------------------------

interface RecreationManifestEntry {
  glbPath: string;
  bounds?: { min: number[]; max: number[]; size: number[] };
}

interface RecreationManifest {
  materialLibrary?: { glbPath: string; materials: string[] };
  models?: Record<string, RecreationManifestEntry>;
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
  /** Time-of-day contract (see .gfx/BRIEF.md): fades floodlights, club-house lamps and windows. */
  setTimeOfDay: (preset: TimeOfDayPreset, nightFactor: number) => void;
  /** Quality contract (see .gfx/review/FIXROUND.md): prop culling distance, small shadow casters, floodlight shadows. */
  setQuality: (level: QualityLevel) => void;
  update: (
    dt: number,
    tractorPos: THREE.Vector3 | null,
    cleanCapture: boolean,
    onGoalScored?: (side: 'west' | 'east') => void
  ) => void;
}

const REQUIRED_MODEL_KEYS = [
  'sportheim_kindenheim',
  'sportplatz_terrace',
  'soccer_goal_full',
  'soccer_goal_mini',
  'floodlight_mast',
  'dugout_bench',
  'scoreboard',
  'playground_tower',
  'playground_swings',
  'playground_pyramid',
  'playground_carousel',
  'playground_seesaw',
  'spring_rider_tractor',
  'spring_rider_horse',
  'playground_sandpit_toys',
  'playground_pavilion',
  'tischtennisplatte',
  'park_bench',
  'trash_bin',
  'spielplatz_sign',
] as const;
type ModelKey = (typeof REQUIRED_MODEL_KEYS)[number];

/** Assets that stay visible at any distance; everything else is a small prop ("detail" tier). */
const LARGE_MODELS = new Set<ModelKey>([
  'sportheim_kindenheim',
  'sportplatz_terrace',
  'soccer_goal_full',
  'soccer_goal_mini',
  'floodlight_mast',
  'dugout_bench',
  'scoreboard',
  'playground_tower',
  'playground_swings',
  'playground_pyramid',
  'playground_pavilion',
]);

/** Nodes animated in update(): they keep their own pivot and are never baked. */
const DYNAMIC_NODES = new Set(['Swing_Left', 'Swing_Right', 'Swing_Nest', 'Carousel_Rotor']);

/** Distance (m, measured from the edge of a site) beyond which its small props are hidden. */
const DETAIL_DISTANCE: Record<QualityLevel, number> = { low: 70, medium: 120, high: 160, ultra: 230 };

/** Light level -> shader / light units, calibrated so the brightest pool is ~55 % of sunlit clay at noon. */
const FLOOD_PEAK = 235;
const FILL_PEAK = 150;

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
  // 0. Manifest, shared PBR material library and all model GLBs (required data: fail loudly)
  // -------------------------------------------------------------------------
  const manifestUrl = resolveAssetUrl(`${MODEL_DIR}/manifest.json`);
  let manifest: RecreationManifest;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as RecreationManifest;
  } catch (err) {
    throw new Error(`[recreation] could not load ${manifestUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const models = manifest.models;
  if (!models) throw new Error(`[recreation] ${manifestUrl} has no "models" section`);
  if (!manifest.materialLibrary?.glbPath) {
    throw new Error(`[recreation] ${manifestUrl} has no "materialLibrary.glbPath" (rebuild with blender/recreation/build_recreation.py)`);
  }
  const missingKeys = REQUIRED_MODEL_KEYS.filter((k) => !models[k]?.glbPath);
  if (missingKeys.length) throw new Error(`[recreation] ${manifestUrl} is missing models: ${missingKeys.join(', ')}`);

  const draco = new DRACOLoader();
  draco.setDecoderPath(resolveAssetUrl('assets/models/village/draco/'));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const loadGlb = async (path: string): Promise<THREE.Group> => {
    const url = resolveAssetUrl(path);
    try {
      const gltf = await loader.loadAsync(url);
      dedupeModelTextures(gltf.scene);
      return gltf.scene;
    } catch (err) {
      throw new Error(`[recreation] failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  let libScene: THREE.Group;
  let modelScenes: THREE.Group[];
  try {
    [libScene, ...modelScenes] = await Promise.all([
      loadGlb(manifest.materialLibrary.glbPath),
      ...REQUIRED_MODEL_KEYS.map((k) => loadGlb(models[k].glbPath)),
    ]);
  } finally {
    draco.dispose();
  }
  const lib = extractLibrary(libScene, maxAnisotropy);

  const prototypes = new Map<ModelKey, THREE.Object3D>();
  REQUIRED_MODEL_KEYS.forEach((key, i) => {
    const scene = modelScenes[i];
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial)) {
          throw new Error(`[recreation] ${key}: unexpected material type ${m.type} on '${mesh.name}'`);
        }
        bindLibraryMaterial(m, lib);
        if (!m.userData.recPrepared) {
          m.userData.recPrepared = true;
          m.envMapIntensity = 0.72;
          if (m.map) m.map.anisotropy = Math.min(8, maxAnisotropy);
          if (m.transparent) {
            // nets, chains, polycarbonate: blended, never written to depth
            m.depthWrite = false;
            m.alphaTest = 0.02;
          }
        }
        // blended surfaces would throw solid slab shadows
        mesh.castShadow = !m.transparent;
      }
    });
    prototypes.set(key, scene);
  });

  // -------------------------------------------------------------------------
  // 1. Terrain-conforming PBR ground surfaces
  // -------------------------------------------------------------------------
  const siteObjects: Record<SiteId, Record<Tier, THREE.Object3D[]>> = {
    pitch: { large: [], detail: [] },
    play: { large: [], detail: [] },
  };
  const addGround = (site: SiteId, tier: Tier, o: GroundSurfaceOpts): void => {
    const mesh = createGroundSurface(o, lib, terrain);
    group.add(mesh);
    siteObjects[site][tier].push(mesh);
  };

  const mastCoords: { u: number; v: number; rot: number }[] = [
    { u: -33.0, v: +28.2, rot: PITCH_ROT + Math.PI },
    { u: 0.0, v: +28.2, rot: PITCH_ROT + Math.PI },
    { u: +33.0, v: +28.2, rot: PITCH_ROT + Math.PI },
    { u: -34.0, v: -34.2, rot: PITCH_ROT },
    { u: 0.0, v: -38.0, rot: PITCH_ROT }, // behind the Sportheim rear wall
    { u: +38.0, v: -28.0, rot: PITCH_ROT },
  ];
  const floodRig: FloodRig = {
    masts: mastCoords.map((m) => new THREE.Vector3(m.u, m.v, 16.6)),
    // every mast lights the third of the pitch in front of it; beams cross a little past the middle
    aims: mastCoords.map((m) => new THREE.Vector2(m.u * 0.8, Math.sign(m.v) * 10.0)),
    intensity: { value: 0 },
    color: new THREE.Color(1.0, 0.93, 0.8),
    occluders: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)],
    shadowStrength: { value: 1 },
  };

  // Tennenplatz: pale, dusty red-beige clay as in the DOP20 orthophoto, with darker damp patches,
  // concentric drag-mat arcs and trampled goal mouths / centre circle.
  const pitchMask = buildSurfaceMask(89, 56, 6, (u, v) => {
    const damp = 0.62 * fbm(u / 13 + 3.1, v / 13 + 7.7, 11, 4) + 0.38 * fbm(u / 4.2, v / 4.2, 23, 3) + 0.1 * smooth01(8, 26, v);
    const arcA = Math.hypot(u + 18, v - 70);
    const arcB = Math.hypot(u - 52, v + 12);
    const wob = fbm(u / 9, v / 9, 31, 3) * 3.0;
    const streak = 0.5 + 0.3 * Math.sin((arcA + wob) * 2.6) + 0.2 * Math.sin((arcB + wob) * 1.9);
    let wear = 0;
    for (const gx of [-39, 39]) wear = Math.max(wear, Math.exp(-(((u - gx) / 6) ** 2 + (v / 8) ** 2)));
    for (const gx of [-30, 30]) wear = Math.max(wear, 0.8 * Math.exp(-(((u - gx) / 2.2) ** 2 + (v / 2.2) ** 2)));
    wear = Math.max(wear, 0.85 * Math.exp(-((u / 7.5) ** 2 + (v / 7.5) ** 2)));
    wear = Math.max(wear, 0.55 * Math.exp(-((v / 6) ** 2)) * smooth01(40, 30, Math.abs(u)));
    wear = wear * (0.55 + 0.9 * fbm(u / 3 + 9, v / 3, 47, 3));
    const noise = fbm(u * 1.7, v * 1.7, 59, 4);
    return [damp, streak, wear, noise];
  });
  addGround('pitch', 'large', {
    name: 'Sportplatz_Hartplatz',
    libId: 'red_clay_court',
    cx: PITCH_CX,
    cz: PITCH_CZ,
    rot: PITCH_ROT,
    sizeU: 89.0,
    sizeV: 56.0,
    yOffset: 0.065,
    renderOrder: 1,
    offsetUnits: -2,
    dry: new THREE.Color().setRGB(0.45, 0.315, 0.235),
    damp: new THREE.Color().setRGB(0.29, 0.175, 0.125),
    wear: new THREE.Color().setRGB(0.385, 0.275, 0.215),
    wearStrength: 0.75,
    streak: 0.1,
    detail: 1.0,
    feather: 1.6,
    corner: 2.0,
    edgeNoise: 1.4,
    mask: pitchMask,
    noiseRepeat: 7.0,
    uvRot: 0.31,
    normalScale: 0.6,
    dampRoughness: 0.72,
    grit: 0.34,
    lines: 'pitch',
    lineColor: new THREE.Color().setRGB(0.82, 0.8, 0.74),
    flood: floodRig,
  });

  // Grass training pitch: dry summer turf with bare, trampled goal mouths
  const kleinMask = buildSurfaceMask(18.5, 48, 6, (u, v) => {
    const dry = fbm(u / 6 + 1.7, v / 6 + 4.2, 71, 4);
    const mow = 0.5 + 0.35 * Math.sin(u * 2.1 + fbm(u / 5, v / 5, 73, 2) * 2);
    let wear = 0;
    for (const gz of [-20, 20]) wear = Math.max(wear, Math.exp(-((u / 3.2) ** 2 + ((v - gz) / 3.0) ** 2)));
    wear = Math.max(wear, 0.5 * Math.exp(-((u / 2.6) ** 2 + (v / 2.6) ** 2)));
    wear *= 0.5 + fbm(u / 2 + 5, v / 2, 79, 3);
    return [dry, mow, wear, fbm(u * 1.9, v * 1.9, 83, 4)];
  });
  addGround('pitch', 'large', {
    name: 'Sportplatz_Kleinfeld',
    libId: 'grass',
    cx: KLEIN_CX,
    cz: KLEIN_CZ,
    rot: PITCH_ROT,
    sizeU: 18.5,
    sizeV: 48.0,
    yOffset: 0.055,
    renderOrder: 1,
    offsetUnits: -2,
    dry: new THREE.Color().setRGB(0.2, 0.235, 0.085),
    damp: new THREE.Color().setRGB(0.3, 0.27, 0.12),
    wear: new THREE.Color().setRGB(0.3, 0.22, 0.14),
    wearStrength: 0.9,
    streak: 0.12,
    feather: 1.8,
    corner: 2.5,
    edgeNoise: 1.6,
    mask: kleinMask,
    noiseRepeat: 3.0,
    uvRot: 0.2,
    dampRoughness: 1.0,
    lines: 'kleinfeld',
    lineColor: new THREE.Color().setRGB(0.74, 0.74, 0.66),
  });

  // --- Spielplatz: lawn, sand, bark-mulch and rubber safety surfacing, paving, bound-gravel paths ---
  const genericMask = (seed: number, sizeU: number, sizeV: number, wearFn?: (u: number, v: number) => number) =>
    buildSurfaceMask(sizeU, sizeV, 8, (u, v) => [
      fbm(u / 3.5 + seed, v / 3.5, seed, 4),
      0.5 + 0.5 * (fbm(u / 1.5, v / 1.5 + seed, seed + 5, 3) - 0.5),
      (wearFn ? wearFn(u, v) : 0) * (0.5 + fbm(u / 1.3 + 2, v / 1.3, seed + 9, 3)),
      fbm(u * 1.8, v * 1.8, seed + 13, 4),
    ]);

  const LAWN = { cx: 74.0, cz: -245.0, rot: 0.0, sizeU: 30.0, sizeV: 42.0 };
  // trampled bare patches: gate, in front of the benches, around the equipment that has no safety pad
  const lawnWearSpots: [number, number, number][] = [
    [72.6, -226.5, 2.6],
    [76.4, -246.2, 1.5],
    [79.2, -245.4, 1.5],
    [69.2, -245.2, 1.4],
    [76.3, -237.8, 2.4],
    [66.5, -247.6, 1.8],
  ];
  const lawnMask = genericMask(101, LAWN.sizeU, LAWN.sizeV, (u, v) => {
    let w = 0;
    for (const [wx, wz, r] of lawnWearSpots) {
      w = Math.max(w, Math.exp(-(((LAWN.cx + u - wx) / r) ** 2 + ((LAWN.cz + v - wz) / r) ** 2)));
    }
    return w;
  });
  addGround('play', 'large', {
    name: 'Spielplatz_Lawn',
    libId: 'grass',
    ...LAWN,
    yOffset: 0.04,
    renderOrder: 1,
    offsetUnits: -2,
    dry: new THREE.Color().setRGB(0.15, 0.22, 0.06),
    damp: new THREE.Color().setRGB(0.24, 0.26, 0.09),
    wear: new THREE.Color().setRGB(0.28, 0.2, 0.12),
    wearStrength: 0.85,
    streak: 0.1,
    feather: 3.5,
    corner: 6.0,
    edgeNoise: 3.0,
    mask: lawnMask,
    noiseRepeat: 4.0,
    uvRot: 0.4,
    dampRoughness: 1.0,
  });

  const SAND = { cx: 65.2, cz: -254.0, rot: 0.34, sizeU: 8.4, sizeV: 10.6 };
  addGround('play', 'detail', {
    name: 'Spielplatz_Sandpit',
    libId: 'sand',
    ...SAND,
    yOffset: 0.075,
    renderOrder: 2,
    offsetUnits: -6,
    dry: new THREE.Color().setRGB(0.5, 0.4, 0.26),
    damp: new THREE.Color().setRGB(0.33, 0.25, 0.155),
    wear: new THREE.Color().setRGB(0.42, 0.33, 0.21),
    wearStrength: 0.4,
    streak: 0.12,
    feather: 0.05,
    corner: 0.05,
    edgeNoise: 0.0,
    mask: genericMask(113, SAND.sizeU, SAND.sizeV, (u, v) => Math.exp(-(((u + 0.4) / 2.2) ** 2 + ((v - 0.2) / 2.6) ** 2))),
    noiseRepeat: 3.0,
    uvRot: 0.5,
    normalScale: 1.4,
    dampRoughness: 0.85,
  });

  const mulchPads: [string, number, number, number, number, number, number][] = [
    ['Spielplatz_Pad_Tower', 70.9, -260.2, 0.3, 8.6, 9.6, 127],
    ['Spielplatz_Pad_Swings', 77.8, -261.2, 0.36, 9.6, 6.6, 131],
    ['Spielplatz_Pad_Pyramid', 85.2, -259.2, 0.2, 7.0, 7.0, 137],
  ];
  for (const [name, cx, cz, rot, sizeU, sizeV, seed] of mulchPads) {
    addGround('play', 'detail', {
      name,
      libId: 'bark_mulch',
      cx,
      cz,
      rot,
      sizeU,
      sizeV,
      yOffset: 0.06,
      renderOrder: 2,
      offsetUnits: -5,
      dry: new THREE.Color().setRGB(0.2, 0.125, 0.065),
      damp: new THREE.Color().setRGB(0.12, 0.075, 0.04),
      wear: new THREE.Color().setRGB(0.25, 0.18, 0.11),
      wearStrength: 0.6,
      feather: 0.7,
      corner: 2.4,
      edgeNoise: 1.1,
      mask: genericMask(seed, sizeU, sizeV, (u, v) => Math.exp(-((u / (sizeU * 0.22)) ** 2 + (v / (sizeV * 0.22)) ** 2))),
      noiseRepeat: 2.0,
      uvRot: rot + 0.7,
      normalScale: 1.5,
      dampRoughness: 0.9,
    });
  }

  // red EPDM rubber-granulate safety surfacing under carousel and seesaw (fine aggregate look: concrete scan)
  const rubberPads: [string, number, number, number, number, number, number][] = [
    ['Spielplatz_Pad_Carousel', 72.2, -248.2, 0.0, 4.6, 4.6, 149],
    ['Spielplatz_Pad_Seesaw', 80.8, -252.2, 0.42, 5.4, 2.6, 151],
  ];
  for (const [name, cx, cz, rot, sizeU, sizeV, seed] of rubberPads) {
    addGround('play', 'detail', {
      name,
      libId: 'concrete',
      cx,
      cz,
      rot,
      sizeU,
      sizeV,
      yOffset: 0.06,
      renderOrder: 2,
      offsetUnits: -5,
      dry: new THREE.Color().setRGB(0.3, 0.085, 0.06),
      damp: new THREE.Color().setRGB(0.22, 0.065, 0.05),
      wear: new THREE.Color().setRGB(0.26, 0.15, 0.11),
      wearStrength: 0.5,
      detail: 0.55,
      grit: 0.3,
      feather: 0.06,
      corner: Math.min(sizeU, sizeV) * 0.49,
      edgeNoise: 0.0,
      mask: genericMask(seed, sizeU, sizeV, (u, v) => Math.exp(-((u / 1.2) ** 2 + (v / 1.2) ** 2))),
      noiseRepeat: 2.0,
      normalScale: 0.5,
      dampRoughness: 1.0,
    });
  }

  addGround('play', 'detail', {
    name: 'Spielplatz_Pad_Pavilion',
    libId: 'paving_stones',
    cx: 73.2,
    cz: -238.2,
    rot: 0.34,
    sizeU: 10.2,
    sizeV: 5.4,
    yOffset: 0.06,
    renderOrder: 2,
    offsetUnits: -5,
    dry: new THREE.Color().setRGB(0.3, 0.27, 0.23),
    damp: new THREE.Color().setRGB(0.2, 0.18, 0.155),
    wear: new THREE.Color().setRGB(0.2, 0.22, 0.12),
    wearStrength: 0.25,
    feather: 0.12,
    corner: 0.1,
    edgeNoise: 0.1,
    mask: genericMask(157, 10.2, 5.4, () => 0.6),
    noiseRepeat: 2.0,
    uvRot: 0.0,
    dampRoughness: 0.8,
  });
  const paths: [string, number, number, number, number, number, number][] = [
    ['Spielplatz_Path_South', 72.8, -230.2, 1.48, 12.0, 1.7, 163],
    ['Spielplatz_Path_East', 81.5, -240.5, 0.34, 13.5, 1.6, 167],
  ];
  for (const [name, cx, cz, rot, sizeU, sizeV, seed] of paths) {
    addGround('play', 'detail', {
      name,
      libId: 'sand',
      cx,
      cz,
      rot,
      sizeU,
      sizeV,
      yOffset: 0.055,
      renderOrder: 2,
      offsetUnits: -4,
      dry: new THREE.Color().setRGB(0.4, 0.37, 0.31),
      damp: new THREE.Color().setRGB(0.28, 0.26, 0.215),
      wear: new THREE.Color().setRGB(0.3, 0.25, 0.18),
      wearStrength: 0.5,
      feather: 0.35,
      corner: 0.6,
      edgeNoise: 0.5,
      mask: genericMask(seed, sizeU, sizeV, (_u, v) => Math.exp(-((v / 0.35) ** 2))),
      grit: 0.45,
      noiseRepeat: 2.0,
      uvRot: 0.3,
      normalScale: 0.6,
      dampRoughness: 0.85,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Fences, barriers, sponsor boards, corner flags, sandpit edging
  // -------------------------------------------------------------------------
  const woodEntry = requireLib(lib, 'wood_beam_oak');
  const woodTile: [number, number] = [woodEntry.tileW, woodEntry.tileH];
  const chainlinkMat = new THREE.MeshStandardMaterial({
    name: 'Rec_Chainlink_Fence',
    map: requireLib(lib, 'rec_mesh_steel').map,
    color: 0xb4bcc0,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.5,
    metalness: 0.75,
    vertexColors: true,
  });
  chainlinkMat.envMapIntensity = 0.72;

  const batch = new StaticBatch();
  batch.register('galv', makeLibMaterial(lib, 'metal_galvanized', 'Rec_Fence_Galvanized', { color: 0xe6e8ea, metalness: 1.0, roughness: 0.85 }));
  batch.register('railWhite', makeLibMaterial(lib, 'metal_painted', 'Rec_Rail_White', { color: 0xeceeec, boost: 1.25, roughness: 0.8 }));
  batch.register('wood', makeLibMaterial(lib, 'wood_beam_oak', 'Rec_Fence_Robinia', { color: new THREE.Color(1.0, 0.78, 0.55), boost: 1.55 }));
  batch.register('concrete', makeLibMaterial(lib, 'concrete', 'Rec_Fence_Footing', { boost: 1.35 }));
  batch.register('alu', makeLibMaterial(lib, 'metal_galvanized', 'Rec_Board_Frame', { color: 0xc8ccd0, metalness: 1.0, roughness: 0.7 }));
  batch.register('chainlink', chainlinkMat);
  const fenceRand = mulberry32(4711);

  // --- collider helpers: thin world-space polygons registered with the existing BuildingCollider ---
  const addLineCollider = (x0: number, z0: number, x1: number, z1: number, halfWidth: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-3) throw new Error('[recreation] zero-length line collider');
    const nx = (-(z1 - z0) / len) * halfWidth;
    const nz = ((x1 - x0) / len) * halfWidth;
    collider.addPolygon([
      [x0 + nx, z0 + nz],
      [x1 + nx, z1 + nz],
      [x1 - nx, z1 - nz],
      [x0 - nx, z0 - nz],
    ]);
  };
  /** Rectangle in the local frame of a placed asset (u = model +X, v = model +Z = Blender -Y). */
  const addLocalRectCollider = (cx: number, cz: number, rot: number, u0: number, u1: number, v0: number, v1: number): void => {
    collider.addPolygon([
      localToWorld(cx, cz, rot, u0, v0),
      localToWorld(cx, cz, rot, u1, v0),
      localToWorld(cx, cz, rot, u1, v1),
      localToWorld(cx, cz, rot, u0, v1),
    ]);
  };
  const addPitchRectCollider = (u0: number, u1: number, v0: number, v1: number): void => {
    collider.addPolygon([pitchToWorld(u0, v0), pitchToWorld(u1, v0), pitchToWorld(u1, v1), pitchToWorld(u0, v1)]);
  };

  batch.site = 'play';
  batch.tier = 'detail';
  buildSandpitEdging(batch, SAND.cx, SAND.cz, SAND.rot, SAND.sizeU, SAND.sizeV, terrain, fenceRand, woodTile);

  // West & East Ballfangzäune (5.4 m high behind both goals)
  batch.site = 'pitch';
  batch.tier = 'large';
  const [wbf0x, wbf0z] = pitchToWorld(-44.2, -24.0);
  const [wbf1x, wbf1z] = pitchToWorld(-44.2, +24.0);
  buildChainlinkFence(batch, wbf0x, wbf0z, wbf1x, wbf1z, 5.4, 3.0, terrain);
  const [ebf0x, ebf0z] = pitchToWorld(+44.2, -18.0);
  const [ebf1x, ebf1z] = pitchToWorld(+44.2, +18.0);
  buildChainlinkFence(batch, ebf0x, ebf0z, ebf1x, ebf1z, 5.4, 3.0, terrain);

  // North & south spectator barriers (gaps: NE tractor gate and the two dugouts)
  batch.tier = 'detail';
  const [nr0x, nr0z] = pitchToWorld(-44.0, -26.8);
  const [nr1x, nr1z] = pitchToWorld(+34.0, -26.8);
  buildSpectatorRail(batch, nr0x, nr0z, nr1x, nr1z, terrain);
  for (const [u0, u1] of [
    [-44.0, -11.2],
    [-5.8, +5.8],
    [+11.2, +44.0],
  ] as [number, number][]) {
    const [sx0, sz0] = pitchToWorld(u0, +26.8);
    const [sx1, sz1] = pitchToWorld(u1, +26.8);
    buildSpectatorRail(batch, sx0, sz0, sx1, sz1, terrain);
  }

  // Bandenwerbung: fictional local sponsors (texts unchanged), aluminium-framed boards on the barrier
  const sponsorDefs = [
    { bg: '#164526', acc: '#f0c44d', txt: '#f8f6ee', title: 'TV 1920 KINDENHEIM', sub: 'TRADITION SEIT 1920 · FUSSBALL IN DER PFALZ' },
    { bg: '#6e1d26', acc: '#f2d38a', txt: '#fbf8f0', title: 'WEINGÜTER KINDENHEIM', sub: 'PFÄLZER RIESLING & SPÄTBURGUNDER' },
    { bg: '#1c4268', acc: '#f4c542', txt: '#ffffff', title: 'LEININGERLAND · PFALZ', sub: 'URLAUBS- & GENUSSREGION' },
    { bg: '#1f4d2e', acc: '#e8c460', txt: '#f6f3ea', title: "OLLI'S SCHLEMMERSTUBE", sub: 'SPORTHEIM KINDENHEIM · SPEISEN & GETRÄNKE' },
    { bg: '#7c4e18', acc: '#f6d86e', txt: '#ffffff', title: 'PFÄLZER WEINSTRASSE', sub: 'HERZLICH WILLKOMMEN AUF DEM SPORTPLATZ' },
  ];
  const sponsorMats = sponsorDefs.map(
    (d, i) =>
      new THREE.MeshStandardMaterial({
        name: `Rec_Sponsor_${i}`,
        map: createSponsorBoardTexture(d.bg, d.acc, d.txt, d.title, d.sub, 900 + i, maxAnisotropy),
        roughness: 0.48,
        metalness: 0.0,
        envMapIntensity: 0.6,
        vertexColors: true,
      })
  );
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
    // the printed face looks at the pitch; the back is the bare aluminium composite panel
    const inward = bp.v < 0 ? 1 : -1;
    const [bx, bz] = pitchToWorld(bp.u, bp.v + inward * 0.06);
    const by = terrain.getTerrainHeight(bx, bz) + 0.56;
    const yaw = PITCH_ROT + bp.rotOffset;
    const center = new THREE.Vector3(bx, by, bz);
    batch.tier = 'detail';
    batch.box('alu', center, [3.46, 0.88, 0.022], yaw);
    for (const dy of [-0.425, 0.425]) batch.box('alu', center.clone().setY(by + dy), [3.5, 0.035, 0.04], yaw);
    batch.tier = 'large'; // the coloured faces still read as boards from across the village
    const face = new THREE.PlaneGeometry(3.4, 0.82);
    _m.makeRotationY(yaw);
    _m.setPosition(center.clone().add(new THREE.Vector3(0, 0, 0.0125).applyAxisAngle(_up, yaw)));
    face.applyMatrix4(_m);
    batch.addWithMaterial(sponsorMats[bp.idx], face);
    face.dispose();
  }

  // 4 corner flags (Eckfahnen)
  batch.tier = 'detail';
  const flagClothMeshes: THREE.Mesh[] = [];
  const flagClothGeo = new THREE.PlaneGeometry(0.42, 0.3, 6, 1);
  flagClothGeo.translate(0.21, 0, 0);
  const flagMat = new THREE.MeshStandardMaterial({ name: 'Rec_CornerFlag', color: 0xcf2f25, roughness: 0.8, side: THREE.DoubleSide });
  for (const [cu, cv] of [
    [-41, -25],
    [41, -25],
    [41, 25],
    [-41, 25],
  ] as [number, number][]) {
    const [fx, fz] = pitchToWorld(cu, cv);
    const base = groundPoint(terrain, fx, fz);
    batch.tube('railWhite', base, base.clone().setY(base.y + 1.55), 0.016, 0.013, 8);
    batch.tube('railWhite', base, base.clone().setY(base.y + 0.07), 0.05, 0.03, 8);
    const cloth = new THREE.Mesh(flagClothGeo, flagMat);
    cloth.position.set(fx, base.y + 1.39, fz);
    cloth.rotation.y = PITCH_ROT;
    cloth.castShadow = true;
    group.add(cloth);
    flagClothMeshes.push(cloth);
    siteObjects.pitch.detail.push(cloth);
  }

  // Spielplatz picket fence (2.6 m gate gap in the south for pedestrians & tractors)
  batch.site = 'play';
  batch.tier = 'detail';
  const picketRuns: [number, number, number, number][] = [
    [60.5, -225.0, 71.2, -224.2],
    [73.8, -224.4, 86.5, -227.5],
    [59.0, -257.0, 60.5, -225.0],
  ];
  for (const [x0, z0, x1, z1] of picketRuns) {
    buildPicketFence(batch, x0, z0, x1, z1, terrain, fenceRand, woodTile);
    addLineCollider(x0, z0, x1, z1, 0.14);
  }

  // -------------------------------------------------------------------------
  // 3. Place the Blender-built assets on the terrain (static parts are baked into the batch)
  // -------------------------------------------------------------------------
  const lampAnchors: THREE.Vector3[] = [];
  const mastAnchors: THREE.Vector3[] = [];
  const swingNodes: { left: THREE.Object3D | null; right: THREE.Object3D | null; nest: THREE.Object3D | null } = {
    left: null,
    right: null,
    nest: null,
  };
  let carouselRotor: THREE.Object3D | null = null;

  const placeAsset = (
    key: ModelKey,
    x: number,
    z: number,
    rotY: number,
    options?: { yOverride?: number; yOffset?: number; rotZ?: number; tag?: string }
  ): void => {
    const proto = prototypes.get(key);
    if (!proto) throw new Error(`[recreation] prototype '${key}' was not loaded`);
    const inst = proto.clone(true);
    const y = options?.yOverride ?? terrain.getTerrainHeight(x, z) + (options?.yOffset ?? 0);
    inst.position.set(x, y, z);
    inst.rotation.order = 'YXZ';
    inst.rotation.y = rotY;
    if (options?.rotZ) inst.rotation.z = options.rotZ;
    inst.updateMatrixWorld(true);

    const site: SiteId = z > -280 ? 'play' : 'pitch';
    const tier: Tier = LARGE_MODELS.has(key) ? 'large' : 'detail';
    batch.site = site;
    batch.tier = tier;
    const dynamic: THREE.Object3D[] = [];
    const walk = (obj: THREE.Object3D): void => {
      if (DYNAMIC_NODES.has(obj.name)) {
        if (obj.parent !== inst) throw new Error(`[recreation] ${key}: animated node '${obj.name}' must be a root-level object`);
        dynamic.push(obj);
        return;
      }
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) batch.bakeMesh(mesh);
      for (const child of obj.children) walk(child);
    };
    walk(inst);

    if (dynamic.length) {
      const holder = new THREE.Group();
      holder.name = options?.tag ?? `Rec_${key}`;
      holder.position.copy(inst.position);
      holder.rotation.copy(inst.rotation);
      for (const node of dynamic) holder.add(node);
      group.add(holder);
      siteObjects[site].detail.push(holder);
      for (const node of dynamic) {
        if (node.name === 'Swing_Left') swingNodes.left = node;
        else if (node.name === 'Swing_Right') swingNodes.right = node;
        else if (node.name === 'Swing_Nest') swingNodes.nest = node;
        else if (node.name === 'Carousel_Rotor') carouselRotor = node;
      }
    }

    if (key === 'floodlight_mast') {
      // lamp heads sit at Blender (x, -0.3, 16.62) -> glTF (x, 16.62, 0.3); lens ~9 cm in front
      for (const lx of [-1.25, 0.0, 1.25]) lampAnchors.push(inst.localToWorld(new THREE.Vector3(lx, 16.57, 0.4)));
      mastAnchors.push(inst.localToWorld(new THREE.Vector3(0, 16.5, 0.5)));
      stats.floodlightCount++;
    }
    stats.assetCount++;
  };

  // --- Sportheim ("Olli's Schlemmerstube") & standing terrace ---
  const sportheimX = 57.2;
  const sportheimZ = -350.0;
  const sportheimRot = 0.39;
  const sportheimY = terrain.getTerrainHeight(sportheimX, sportheimZ) - 0.65;
  placeAsset('sportheim_kindenheim', sportheimX, sportheimZ, sportheimRot, {
    yOverride: sportheimY,
    tag: 'Sportheim_OllisSchlemmerstube',
  });
  collider.addPolygon(makeRotatedRectPoly(sportheimX, sportheimZ, sportheimRot, 23.8, 3.3));

  const terraceX = 20.6;
  const terraceZ = -332.2;
  const terraceRot = 0.4;
  const terraceTilt = -0.032;
  // Lift the terrace until every tread is clear of the hillside: sample the footprint and compare the
  // terrain with the tread height at that spot (tiers step up towards the back).
  const tierTops = [0.28, 0.64, 1.02, 1.42];
  let terraceY = -Infinity;
  for (let ix = 0; ix <= 14; ix++) {
    const lx = -14 + ix * 2;
    for (let it = 0; it < 4; it++) {
      for (const edge of [0.05, 0.8]) {
        const depth = -1.7 + it * 0.85 + edge; // metres from the front edge towards the hill (model -Z)
        const [wx, wz] = localToWorld(terraceX, terraceZ, terraceRot, lx, -depth);
        const tread = tierTops[it] + lx * Math.sin(terraceTilt);
        terraceY = Math.max(terraceY, terrain.getTerrainHeight(wx, wz) - tread + 0.03);
      }
    }
  }
  placeAsset('sportplatz_terrace', terraceX, terraceZ, terraceRot, {
    yOverride: terraceY,
    rotZ: terraceTilt,
    tag: 'Sportplatz_Stehtraversen',
  });
  collider.addPolygon(makeRotatedRectPoly(terraceX, terraceZ, terraceRot, 14.0, 1.7));

  // --- Goals (2 full-size on main pitch + 2 on the Kleinfeld + 1 sideline training goal) ---
  // Colliders cover frame + net; the ball has its own goal detection and is not affected by them.
  const placeGoal = (key: 'soccer_goal_full' | 'soccer_goal_mini', x: number, z: number, rot: number, tag: string): void => {
    placeAsset(key, x, z, rot, { tag });
    if (key === 'soccer_goal_full') addLocalRectCollider(x, z, rot, -2.1, 0.12, -3.85, 3.85);
    else addLocalRectCollider(x, z, rot, -1.55, 0.1, -2.65, 2.65);
  };
  const [gwX, gwZ] = pitchToWorld(-41.0, 0.0);
  const [geX, geZ] = pitchToWorld(+41.0, 0.0);
  placeGoal('soccer_goal_full', gwX, gwZ, PITCH_ROT, 'Goal_Main_West');
  placeGoal('soccer_goal_full', geX, geZ, PITCH_ROT + Math.PI, 'Goal_Main_East');

  const [gknX, gknZ] = localToWorld(KLEIN_CX, KLEIN_CZ, PITCH_ROT, 0.0, -21.0);
  const [gksX, gksZ] = localToWorld(KLEIN_CX, KLEIN_CZ, PITCH_ROT, 0.0, +21.0);
  placeGoal('soccer_goal_mini', gknX, gknZ, PITCH_ROT - Math.PI * 0.5, 'Goal_Kleinfeld_North');
  placeGoal('soccer_goal_mini', gksX, gksZ, PITCH_ROT + Math.PI * 0.5, 'Goal_Kleinfeld_South');
  const [gtrX, gtrZ] = localToWorld(KLEIN_CX, KLEIN_CZ, PITCH_ROT, +8.4, -9.0);
  placeGoal('soccer_goal_mini', gtrX, gtrZ, PITCH_ROT + Math.PI, 'Goal_Training');

  // --- 6 floodlight masts ---
  for (const mc of mastCoords) {
    const [mx, mz] = pitchToWorld(mc.u, mc.v);
    placeAsset('floodlight_mast', mx, mz, mc.rot);
    addLocalRectCollider(mx, mz, mc.rot, -0.5, 0.5, -0.5, 0.5);
  }

  // --- 2 dugouts + scoreboard + benches & bins ---
  for (const du of [-8.5, +8.5]) {
    const [dx, dz] = pitchToWorld(du, +27.1);
    placeAsset('dugout_bench', dx, dz, PITCH_ROT + Math.PI);
  }
  const [sbX, sbZ] = pitchToWorld(+36.5, -27.8);
  placeAsset('scoreboard', sbX, sbZ, PITCH_ROT - 0.35, { tag: 'Scoreboard_Kindenheim' });
  addLocalRectCollider(sbX, sbZ, PITCH_ROT - 0.35, -1.3, 1.3, -0.25, 0.25);

  const placeBench = (x: number, z: number, rot: number): void => {
    placeAsset('park_bench', x, z, rot);
    addLocalRectCollider(x, z, rot, -0.95, 0.95, -0.35, 0.3);
  };
  for (const [bu, bv, brot] of [
    [-27.0, +28.9, PITCH_ROT + Math.PI], // south touchline, under the trees
    [22.0, +28.9, PITCH_ROT + Math.PI],
    [18.0, -28.4, PITCH_ROT],
  ] as [number, number, number][]) {
    const [bx, bz] = pitchToWorld(bu, bv);
    placeBench(bx, bz, brot);
  }
  placeBench(101.0, -349.0, PITCH_ROT - Math.PI * 0.5); // Kleinfeld bench near NE entrance
  const [tb1x, tb1z] = pitchToWorld(-11.4, -28.6);
  const [tb2x, tb2z] = pitchToWorld(+32.0, -28.6);
  placeAsset('trash_bin', tb1x, tb1z, PITCH_ROT);
  placeAsset('trash_bin', tb2x, tb2z, PITCH_ROT);

  // Sportplatz perimeter colliders. Open for the tractor: the NE gate (north side, u > 34) and both
  // ends of the east ball-stop fence towards the Kleinfeld.
  addPitchRectCollider(-45.5, -43.5, -27.5, +27.5); // west ball-stop fence
  addPitchRectCollider(-44.5, +44.5, +26.5, +28.5); // south barrier, dugouts, masts
  addPitchRectCollider(+43.95, +44.45, -18.2, +18.2); // east ball-stop fence
  addPitchRectCollider(-44.2, +34.2, -27.0, -26.6); // north spectator barrier

  // --- Spielplatz equipment (each with a collider; lawn, pads and both paths stay drivable) ---
  placeAsset('playground_tower', 70.8, -260.2, 0.28, { tag: 'Spielplatz_Kletterturm' });
  addLocalRectCollider(70.8, -260.2, 0.28, -2.65, 2.75, -2.45, 1.0); // tower, lower platform, climbing wall, net
  addLocalRectCollider(70.8, -260.2, 0.28, -1.05, -0.25, 0.9, 3.95); // slide

  placeAsset('playground_swings', 77.6, -261.2, 0.36, { tag: 'Spielplatz_Schaukeln' });
  addLocalRectCollider(77.6, -261.2, 0.36, -3.75, 3.75, -1.35, 1.35);
  placeAsset('playground_pyramid', 85.2, -259.2, 0.2, { tag: 'Spielplatz_Seilnetzpyramide' });
  addLocalRectCollider(85.2, -259.2, 0.2, -1.9, 1.9, -1.9, 1.9);
  placeAsset('playground_carousel', 72.2, -248.2, 0.0, { tag: 'Spielplatz_Drehkarussell' });
  addLocalRectCollider(72.2, -248.2, Math.PI * 0.25, -1.05, 1.05, -1.05, 1.05);
  placeAsset('playground_seesaw', 80.8, -252.2, 0.42, { tag: 'Spielplatz_Holzwippe' });
  addLocalRectCollider(80.8, -252.2, 0.42, -1.9, 1.9, -0.3, 0.3);
  placeAsset('spring_rider_tractor', 76.4, -246.2, -0.55, { tag: 'Spielplatz_Wipptraktor' });
  addLocalRectCollider(76.4, -246.2, -0.55, -0.3, 0.3, -0.5, 0.5);
  placeAsset('spring_rider_horse', 79.2, -245.4, 0.75, { tag: 'Spielplatz_Wipppferd' });
  addLocalRectCollider(79.2, -245.4, 0.75, -0.3, 0.3, -0.6, 0.7);
  placeAsset('playground_sandpit_toys', 64.8, -253.8, 0.35, { yOffset: 0.085, tag: 'Spielplatz_Sandspielzeug' });
  addLocalRectCollider(64.8, -253.8, 0.35, 0.4, 1.7, -0.65, 0.15); // mud table
  addLocalRectCollider(64.8, -253.8, 0.35, -1.3, -0.9, -0.35, 1.3); // sand digger

  placeAsset('playground_pavilion', 70.5, -238.5, 0.34, { tag: 'Spielplatz_Pavillon' });
  collider.addPolygon(makeRotatedRectPoly(70.5, -238.5, 0.34, 2.0, 1.6));

  placeAsset('tischtennisplatte', 76.3, -237.8, 0.34, { tag: 'Spielplatz_Tischtennis' });
  addLocalRectCollider(76.3, -237.8, 0.34, -1.4, 1.4, -0.8, 0.8);

  // Spielplatz benches, bins & 2 municipal signs
  placeBench(69.2, -246.2, 0.34);
  placeBench(81.8, -244.5, -0.95);
  placeBench(66.2, -231.5, 0.28);
  placeBench(78.2, -231.2, 0.34);
  placeAsset('trash_bin', 74.6, -226.4, 0.25);
  placeAsset('trash_bin', 85.5, -243.5, -1.2);
  placeAsset('spielplatz_sign', 74.2, -225.2, 0.22, { tag: 'Spielplatz_Schild_Sued' });
  placeAsset('spielplatz_sign', 87.5, -243.0, 1.55, { tag: 'Spielplatz_Schild_Ost' });

  if (!swingNodes.left || !swingNodes.right || !swingNodes.nest) {
    throw new Error('[recreation] playground_swings.glb lost its Swing_Left / Swing_Right / Swing_Nest nodes');
  }
  if (!carouselRotor) throw new Error('[recreation] playground_carousel.glb lost its Carousel_Rotor node');
  const rotor: THREE.Object3D = carouselRotor;

  const detailMeshes: THREE.Mesh[] = [];
  batch.build(group, (site, tier, mesh) => {
    siteObjects[site][tier].push(mesh);
    if (tier === 'detail') detailMeshes.push(mesh);
  });

  // Lamp and window materials as they are finally rendered (merged variants included)
  const lampMaterials = new Map<THREE.MeshStandardMaterial, number>();
  const windowMaterials = new Set<THREE.MeshStandardMaterial>();
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      const lamp = m.userData.lampEmissive as number[] | undefined;
      if (lamp) {
        m.emissive.setRGB(lamp[0], lamp[1], lamp[2]);
        m.emissiveIntensity = 0;
        lampMaterials.set(m, m.name.includes('Floodlight') ? 9.0 : 3.2);
      } else if (m.name.includes('Glass_Window')) {
        m.emissive.setRGB(1.0, 0.72, 0.38);
        m.emissiveIntensity = 0;
        windowMaterials.add(m);
      }
    }
  });
  if (lampMaterials.size === 0) throw new Error('[recreation] no lamp materials (userData.lampEmissive) found in the loaded models');

  // -------------------------------------------------------------------------
  // 4. Dusk floodlighting
  //    - pitch surface: analytic pools + projected shadows in its shader (see GROUND_FLOOD_HEAD)
  //    - things standing on the pitch: two shadow-free SpotLights hanging over the two halves, cones
  //      limited to the playing field so trees and houses around it are not lit
  //    - lamp heads: emissive lenses + additive glare points
  // -------------------------------------------------------------------------
  const makeFill = (u: number): THREE.SpotLight => {
    const [fx, fz] = pitchToWorld(u, 0);
    const fy = terrain.getTerrainHeight(fx, fz);
    const light = new THREE.SpotLight(0xfff1d2, 0, 0, THREE.MathUtils.degToRad(58), 1.0, 2);
    light.position.set(fx, fy + 24, fz);
    light.target.position.set(fx, fy, fz);
    light.castShadow = false;
    group.add(light, light.target);
    return light;
  };
  const fillLights = [makeFill(-21), makeFill(+21)];

  const haloTex = createFloodlightHaloTexture();
  const makeGlare = (anchors: THREE.Vector3[], size: number, name: string): { points: THREE.Points; mat: THREE.PointsMaterial } => {
    const geo = new THREE.BufferGeometry().setFromPoints(anchors);
    const mat = new THREE.PointsMaterial({
      map: haloTex,
      color: 0xfff0c8,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const points = new THREE.Points(geo, mat);
    points.name = name;
    points.visible = false;
    points.renderOrder = 10;
    group.add(points);
    return { points, mat };
  };
  const lampGlare = makeGlare(lampAnchors, 3.4, 'FloodlightGlare_Lamps');
  const mastGlare = makeGlare(mastAnchors, 13.0, 'FloodlightGlare_Masts');

  let lightLevel = -1;
  const applyLightLevel = (level: number): void => {
    const k = Math.min(1, Math.max(0, level));
    if (Math.abs(k - lightLevel) < 1e-4) return;
    lightLevel = k;
    // lamps warm up first (visible glow while the pitch is still mostly daylit), the light on the
    // ground follows the square of the level so there is no visible "switch-on" step
    const glow = smooth01(0.0, 0.45, k);
    for (const [mat, peak] of lampMaterials) mat.emissiveIntensity = peak * glow;
    for (const win of windowMaterials) win.emissiveIntensity = 0.85 * k;
    floodRig.intensity.value = FLOOD_PEAK * k * k;
    for (const fill of fillLights) fill.intensity = FILL_PEAK * k * k;
    lampGlare.points.visible = k > 0.01;
    mastGlare.points.visible = k > 0.01;
    lampGlare.mat.opacity = 0.95 * glow;
    mastGlare.mat.opacity = 0.34 * glow;
  };
  applyLightLevel(0);

  // Legacy switch. Once the time-of-day contract drives the lights (smooth fade), the binary call that
  // main.ts may still issue right after it is ignored, otherwise it would snap the fade to 0 / 1.
  let contractDriven = false;
  const setDuskMode = (isDusk: boolean): void => {
    if (contractDriven) return;
    applyLightLevel(isDusk ? 1 : 0);
  };
  const setTimeOfDay = (_preset: TimeOfDayPreset, nightFactor: number): void => {
    if (!Number.isFinite(nightFactor)) throw new Error(`[recreation] setTimeOfDay: invalid nightFactor ${nightFactor}`);
    contractDriven = true;
    // Follows the sun: first glow when it touches the horizon (nightFactor ~0.55, sun about +1.5 deg),
    // full output only in deep twilight (0.97, sun about -2.5 deg).
    applyLightLevel(smooth01(0.55, 0.97, nightFactor));
  };

  // -------------------------------------------------------------------------
  // 5. Distance culling of the small props + quality levels
  // -------------------------------------------------------------------------
  const sites: { id: SiteId; x: number; z: number; radius: number; detailVisible: boolean }[] = [
    { id: 'pitch', x: PITCH_CX, z: PITCH_CZ, radius: 62, detailVisible: true },
    { id: 'play', x: 74.0, z: -245.0, radius: 26, detailVisible: true },
  ];
  let detailDistance = DETAIL_DISTANCE.high;
  const applyDetailVisibility = (camX: number, camZ: number, force: boolean): void => {
    for (const site of sites) {
      const d = Math.hypot(camX - site.x, camZ - site.z) - site.radius;
      // 12 m hysteresis so props do not flicker while the camera hovers at the limit
      const visible = site.detailVisible ? d < detailDistance + 6 : d < detailDistance - 6;
      if (visible === site.detailVisible && !force) continue;
      site.detailVisible = visible;
      for (const obj of siteObjects[site.id].detail) obj.visible = visible;
    }
  };
  // The render loop gives this module no camera; a culling-exempt, colourless probe triangle reports
  // the camera of the main pass once per frame (shadow passes use orthographic cameras and are skipped).
  const probeGeo = new THREE.BufferGeometry();
  probeGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const probe = new THREE.Mesh(probeGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
  probe.name = 'RecCameraProbe';
  probe.frustumCulled = false;
  probe.position.set(PITCH_CX, terrain.getTerrainHeight(PITCH_CX, PITCH_CZ), PITCH_CZ);
  let lastCamX = PITCH_CX;
  let lastCamZ = PITCH_CZ;
  probe.onBeforeRender = (_renderer, _scene, camera) => {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    lastCamX = camera.matrixWorld.elements[12];
    lastCamZ = camera.matrixWorld.elements[14];
    applyDetailVisibility(lastCamX, lastCamZ, false);
  };
  group.add(probe);

  const setQuality = (level: QualityLevel): void => {
    const distance = DETAIL_DISTANCE[level];
    if (distance === undefined) throw new Error(`[recreation] setQuality: unknown quality level '${String(level)}'`);
    detailDistance = distance;
    // low: small props cast no shadows and the pitch shader skips its per-mast shadow projection
    for (const mesh of detailMeshes) mesh.castShadow = level !== 'low' && !(mesh.material as THREE.Material).transparent;
    floodRig.shadowStrength.value = level === 'low' ? 0 : 1;
    applyDetailVisibility(lastCamX, lastCamZ, true);
  };
  setQuality('high');

  // -------------------------------------------------------------------------
  // 6. Interactive football on the main pitch (kickable by the tractor)
  // -------------------------------------------------------------------------
  const ballRadius = 0.2;
  const ballGeo = new THREE.SphereGeometry(ballRadius, 28, 18);
  const ballMat = new THREE.MeshStandardMaterial({
    name: 'Rec_Football',
    map: createSoccerBallTexture(),
    roughness: 0.42,
    metalness: 0.0,
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

  /** World x/z -> pitch-local (u, v) for the floodlight shadow occluders. */
  const setOccluder = (index: number, wx: number, wz: number, height: number, radius: number): void => {
    const relX = wx - PITCH_CX;
    const relZ = wz - PITCH_CZ;
    const u = relX * PITCH_DIR_X + relZ * PITCH_DIR_Z;
    const v = relX * PITCH_PERP_X + relZ * PITCH_PERP_Z;
    const onPitch = Math.abs(u) < 48 && Math.abs(v) < 31;
    floodRig.occluders[index].set(u, v, height, onPitch ? radius : 0);
  };
  const placeBall = (): void => {
    ballMesh.position.set(ballX, terrain.getTerrainHeight(ballX, ballZ) + ballRadius + 0.065, ballZ);
    setOccluder(0, ballX, ballZ, ballRadius, ballRadius);
  };

  const resetBall = () => {
    ballX = PITCH_CX;
    ballZ = PITCH_CZ;
    ballVx = 0;
    ballVz = 0;
    placeBall();
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
      floodRig.occluders[1].w = 0; // the tractor is hidden in clean captures
      swingNodes.left!.rotation.x = 0;
      swingNodes.right!.rotation.x = 0;
      swingNodes.nest!.rotation.x = 0;
      return;
    }

    animTime += safeDt;
    if (tractorPos) setOccluder(1, tractorPos.x, tractorPos.z, 1.35, 1.55);
    else floodRig.occluders[1].w = 0;

    // Gentle breeze sway on playground swings & slow carousel spin
    swingNodes.left!.rotation.x = Math.sin(animTime * 1.45) * 0.085;
    swingNodes.right!.rotation.x = Math.sin(animTime * 1.55 + 1.2) * 0.095;
    swingNodes.nest!.rotation.x = Math.sin(animTime * 1.15 + 2.4) * 0.055;
    rotor.rotation.y += safeDt * 0.35;

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

    placeBall();
  };

  return {
    group,
    stats,
    setDuskMode,
    setTimeOfDay,
    setQuality,
    update,
  };
}
