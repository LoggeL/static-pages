/**
 * NPC traffic - drawing the car fleet.
 *
 * All car types (blender/traffic/build_cars.py -> public/assets/models/traffic/cars.glb) share one atlas material,
 * so the whole fleet is two BatchedMeshes: `near` (casts shadows on medium+) and `far` (no shadows). Every car owns a
 * body instance and four wheel instances in both; only one of the two is visible at a time. Paint colour, lamp state,
 * metallic flag and number plate are per instance (colour texture of the BatchedMesh, alpha = bit field), read by an
 * onBeforeCompile patch of MeshStandardMaterial.
 *
 * Night: lamp lenses glow through the emissive mask; a cheap additive "light pool" quad on the road in front of each
 * lit car stands in for real lights (no THREE.Light per car), plus small additive halo billboards on the lamps.
 */
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { QualityLevel } from './renderQuality';
import { dedupeModelTextures } from './sharedAssets';
import { resolveAssetUrl } from './url';

export const TRAFFIC_MANIFEST_URL = 'assets/models/traffic/manifest.json';

/** Bit field stored in the alpha of the per-instance colour (exact integers in a float texture). */
export const CAR_FLAG = {
  running: 1, // daytime running lights
  headlights: 2,
  brake: 4,
  indicatorLeft: 8,
  indicatorRight: 16,
  metallic: 32,
  /** bits 6..9: number plate cell (0..15) */
  plateShift: 6,
} as const;

interface ManifestWheel {
  lod0: string;
  lod1: string;
  radius: number;
  x: number;
  z: number;
  steer: boolean;
}

interface ManifestType {
  label: string;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  frontZ: number;
  rearZ: number;
  wheels: ManifestWheel[];
  lods: string[];
  lamps: { head: number[][]; tail: number[][] };
  triangles: { lod: number[]; wheel: number[] };
}

interface TrafficManifest {
  version: number;
  glb: string;
  textures: { albedo: string; albedo1k: string; normal: string; orm: string; mask: string };
  plates: { rect: [number, number, number, number]; cols: number; rows: number; count: number };
  types: Record<string, ManifestType>;
}

export interface CarType {
  name: string;
  label: string;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  frontZ: number;
  rearZ: number;
  /** body geometry id per LOD (identical in both batches) */
  bodyGeo: [number, number, number];
  /** wheels: front-left, front-right, rear-left, rear-right */
  wheels: { x: number; z: number; radius: number; steer: boolean; geo: [number, number]; right: boolean }[];
  head: THREE.Vector3[];
  tail: THREE.Vector3[];
  triangles: { lod: number[]; wheel: number[] };
}

/** Pose of one car for the renderer. */
export interface CarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  steer: number;
  /** wheel rotation (rad) per axle: front, rear */
  spinF: number;
  spinR: number;
}

interface Slot {
  type: CarType;
  active: boolean;
  pose: CarPose;
  dirty: boolean;
  flags: number;
  color: THREE.Color;
  colorDirty: boolean;
  /** -1 hidden, 0 near batch, 1 far batch */
  batch: number;
  lod: number;
  ids: [number[], number[]]; // per batch: [body, w0..w3]
  dist: number;
  /** static (parked): pose never changes after the first commit */
  isStatic: boolean;
  /** true while the slot should not be drawn at all (clean capture, out of range) */
  hidden: boolean;
}

interface QualityProfile {
  lod0: number;
  lod1: number;
  maxDist: number;
  shadowDist: number;
  shadows: boolean;
  albedo1k: boolean;
}

const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { lod0: 9, lod1: 40, maxDist: 320, shadowDist: 0, shadows: false, albedo1k: true },
  medium: { lod0: 14, lod1: 65, maxDist: 450, shadowDist: 40, shadows: true, albedo1k: true },
  high: { lod0: 22, lod1: 95, maxDist: 600, shadowDist: 55, shadows: true, albedo1k: false },
  ultra: { lod0: 32, lod1: 140, maxDist: 800, shadowDist: 75, shadows: true, albedo1k: false },
};

const MAX_LAMP_GLOWS = 160;
const MAX_BEAMS = 48;
const BEAM_RANGE_M = 140;

function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  const full = resolveAssetUrl(url);
  return new Promise((resolve, reject) => {
    loader.load(full, resolve, undefined, (err) =>
      reject(new Error(`[traffic] texture ${full} failed to load: ${(err as Error)?.message ?? String(err)}`))
    );
  });
}

/** Shader patch: paint tint, metallic paint, number-plate cell, lamp emission - all per instance. */
function patchCarMaterial(mat: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 vKhCar;
varying float vKhSide;`
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_BATCHING_COLOR
  {
    int khId = int( getIndirectIndex( gl_DrawID ) );
    int khSize = textureSize( batchingColorTexture, 0 ).x;
    vKhCar = texelFetch( batchingColorTexture, ivec2( khId % khSize, khId / khSize ), 0 );
  }
#else
  vKhCar = vec4( 1.0, 1.0, 1.0, 0.0 );
#endif
  vKhSide = position.x;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec4 vKhCar;
varying float vKhSide;
uniform sampler2D khMask;
uniform vec4 khPlate;      // u0, v0, cell width, cell height (image space, v down)
uniform vec4 khLamp;       // drl level, low-beam level, tail level, brake level
uniform vec2 khBlink;      // indicator level (0 when off phase), night factor
uniform vec3 khHeadColor;
uniform vec3 khTailColor;
uniform vec3 khIndColor;`
      )
      .replace(
        '#include <map_fragment>',
        `int khFlags = int( vKhCar.a + 0.5 );
vec2 khUv = vMapUv;
if ( khUv.x < khPlate.x + khPlate.z && khUv.y >= khPlate.y && khUv.y < khPlate.y + khPlate.w ) {
  int khPlateIdx = ( khFlags >> 6 ) & 15;
  khUv += vec2( float( khPlateIdx % 4 ) * khPlate.z, float( khPlateIdx / 4 ) * khPlate.w );
}
vec4 khM = texture2D( khMask, vMapUv );
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, khUv );
  diffuseColor *= sampledDiffuseColor;
#endif
diffuseColor.rgb *= mix( vec3( 1.0 ), vKhCar.rgb, khM.a );`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
{
  float khMetallic = ( khFlags & 32 ) != 0 ? 0.62 : 0.0;
  metalnessFactor = mix( metalnessFactor, khMetallic, khM.a );
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, ( khFlags & 32 ) != 0 ? 0.34 : roughnessFactor, khM.a );`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float khHead = ( ( khFlags & 1 ) != 0 ? khLamp.x : 0.0 ) + ( ( khFlags & 2 ) != 0 ? khLamp.y : 0.0 );
  float khTail = ( ( khFlags & 2 ) != 0 ? khLamp.z : 0.0 ) + ( ( khFlags & 4 ) != 0 ? khLamp.w : 0.0 );
  bool khLeft = vKhSide > 0.0;
  float khInd = ( ( ( khFlags & 8 ) != 0 && khLeft ) || ( ( khFlags & 16 ) != 0 && ! khLeft ) ) ? khBlink.x : 0.0;
  totalEmissiveRadiance += khHeadColor * ( khM.g * khHead ) + khTailColor * ( khM.r * khTail ) + khIndColor * ( khM.b * khInd );
}`
      );
  };
  mat.customProgramCacheKey = () => 'kh-traffic-car-v1';
}

/** Additive light pool on the road (soft cone) for headlights at night. */
function makeBeamTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[traffic] 2D canvas context unavailable for the headlight beam texture');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    // y = 0 far end, y = h near the car
    const t = 1 - y / (h - 1); // 0 at the car, 1 far
    for (let x = 0; x < w; x++) {
      const u = (x / (w - 1)) * 2 - 1;
      const spread = 0.18 + 0.82 * Math.pow(t, 0.7);
      const across = Math.max(0, 1 - Math.pow(Math.abs(u) / spread, 2.2));
      const along = Math.pow(Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5), 0.6) * Math.pow(1 - t, 1.3);
      const v = Math.min(1, across * along * 1.6);
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 236;
      img.data[i + 2] = 200;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // canvas row 0 (far end) -> v = 0 -> the far edge of the pool quad
  tex.flipY = false;
  return tex;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[traffic] 2D canvas context unavailable for the lamp glow texture');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CarFleetRenderer {
  public readonly group = new THREE.Group();
  public readonly types = new Map<string, CarType>();
  private readonly batches: THREE.BatchedMesh[] = [];
  private readonly slots: Slot[] = [];
  private readonly freeSlots: number[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private profile: QualityProfile = QUALITY.high;
  private quality: QualityLevel = 'high';
  private nightFactor = 0;
  private blinkTime = 0;
  private readonly albedoTextures: { full: THREE.Texture; small: THREE.Texture };
  private readonly beams: THREE.InstancedMesh;
  private readonly glows: THREE.InstancedMesh;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpW = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3(1, 1, 1);
  private readonly tmpC = new THREE.Color();
  private readonly flipY = new THREE.Matrix4().makeRotationY(Math.PI);
  private readonly camPos = new THREE.Vector3();
  /** Triangles of the visible car geometry after the last commit (for the budget report). */
  public stats = { visible: 0, near: 0, far: 0, triangles: 0, beams: 0, glows: 0 };
  public readonly maxSlots: number;

  private constructor(
    manifest: TrafficManifest,
    geometries: Map<string, THREE.BufferGeometry>,
    tex: { albedo: THREE.Texture; albedo1k: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture; mask: THREE.Texture },
    maxSlots: number
  ) {
    this.group.name = 'NpcTraffic';
    this.maxSlots = maxSlots;
    this.albedoTextures = { full: tex.albedo, small: tex.albedo1k };
    const [pu0, pv0, pu1, pv1] = manifest.plates.rect;
    this.uniforms = {
      khMask: { value: tex.mask },
      khPlate: { value: new THREE.Vector4(pu0, pv0, (pu1 - pu0) / manifest.plates.cols, (pv1 - pv0) / manifest.plates.rows) },
      khLamp: { value: new THREE.Vector4(1.2, 0, 0, 0) },
      khBlink: { value: new THREE.Vector2(0, 0) },
      khHeadColor: { value: new THREE.Color(1.0, 0.93, 0.8) },
      khTailColor: { value: new THREE.Color(1.0, 0.06, 0.035) },
      khIndColor: { value: new THREE.Color(1.0, 0.42, 0.04) },
    };
    this.material = new THREE.MeshStandardMaterial({
      name: 'Traffic_Car_Atlas',
      map: tex.albedo,
      normalMap: tex.normal,
      normalScale: new THREE.Vector2(0.9, -0.9),
      roughnessMap: tex.orm,
      metalnessMap: tex.orm,
      aoMap: tex.orm,
      aoMapIntensity: 0.8,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 1.0,
      emissive: new THREE.Color(0, 0, 0),
    });
    patchCarMaterial(this.material, this.uniforms);

    // geometry ids are identical in both batches (same insertion order)
    let vCount = 0;
    let iCount = 0;
    const order: string[] = [];
    for (const [name, geo] of geometries) {
      vCount += geo.getAttribute('position').count;
      iCount += geo.index ? geo.index.count : 0;
      order.push(name);
    }
    const geoId = new Map<string, number>();
    for (let b = 0; b < 2; b++) {
      const batch = new THREE.BatchedMesh(maxSlots * 5, vCount, iCount, this.material);
      batch.name = b === 0 ? 'NpcTraffic_near' : 'NpcTraffic_far';
      batch.frustumCulled = false; // instances are culled one by one (perObjectFrustumCulled)
      batch.perObjectFrustumCulled = true;
      batch.sortObjects = false;
      batch.receiveShadow = true;
      batch.castShadow = false;
      for (const name of order) {
        const id = batch.addGeometry(geometries.get(name)!);
        if (b === 0) geoId.set(name, id);
        else if (geoId.get(name) !== id) throw new Error(`[traffic] batch geometry ids diverged for "${name}"`);
      }
      this.batches.push(batch);
      this.group.add(batch);
    }

    const need = (name: string): number => {
      const id = geoId.get(name);
      if (id === undefined) throw new Error(`[traffic] cars.glb has no mesh "${name}" (listed in manifest.json)`);
      return id;
    };
    for (const [name, t] of Object.entries(manifest.types)) {
      if (t.lods.length !== 3) throw new Error(`[traffic] manifest type "${name}" needs 3 LODs, has ${t.lods.length}`);
      if (t.wheels.length !== 2) throw new Error(`[traffic] manifest type "${name}" needs a front and a rear wheel entry`);
      const wheels: CarType['wheels'] = [];
      for (const w of t.wheels) {
        for (const right of [false, true]) {
          wheels.push({ x: right ? -w.x : w.x, z: w.z, radius: w.radius, steer: w.steer, geo: [need(w.lod0), need(w.lod1)], right });
        }
      }
      const head: THREE.Vector3[] = [];
      for (const p of t.lamps.head) head.push(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(-p[0], p[1], p[2]));
      const tail: THREE.Vector3[] = [];
      for (const p of t.lamps.tail) tail.push(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(-p[0], p[1], p[2]));
      this.types.set(name, {
        name,
        label: t.label,
        length: t.length,
        width: t.width,
        height: t.height,
        wheelbase: t.wheelbase,
        track: t.track,
        frontZ: t.frontZ,
        rearZ: t.rearZ,
        bodyGeo: [need(t.lods[0]), need(t.lods[1]), need(t.lods[2])],
        wheels,
        head,
        tail,
        triangles: t.triangles,
      });
    }

    // night light pools on the road
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(0, 0, 0.5); // local +Z forward, origin at the near edge
    const beamMat = new THREE.MeshBasicMaterial({
      map: makeBeamTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: true,
      fog: true,
    });
    beamMat.name = 'Traffic_HeadlightPool';
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, MAX_BEAMS);
    this.beams.name = 'NpcTraffic_beams';
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 7;
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BEAMS * 3), 3);
    this.group.add(this.beams);

    // lamp halos: camera-facing quads (billboarded in the vertex shader)
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeGlowTexture() } },
      vertexShader: /* glsl */ `
        // instanceMatrix / instanceColor come from three's prefix (USE_INSTANCING, USE_INSTANCING_COLOR)
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vColor = instanceColor;
          vec4 centre = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
          float size = length( instanceMatrix[ 0 ].xyz );
          centre.xy += position.xy * size;
          gl_Position = projectionMatrix * centre;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float a = texture2D( map, vUv ).a;
          gl_FragColor = vec4( vColor * a, a );
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    glowMat.name = 'Traffic_LampGlow';
    this.glows = new THREE.InstancedMesh(glowGeo, glowMat, MAX_LAMP_GLOWS);
    this.glows.name = 'NpcTraffic_glows';
    this.glows.count = 0;
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 8;
    this.glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMP_GLOWS * 3), 3);
    this.group.add(this.glows);
  }

  /** Loads manifest, GLB and atlas textures; throws with URL and cause on any failure. */
  public static async load(maxSlots: number, maxAnisotropy: number): Promise<CarFleetRenderer> {
    const manifestUrl = resolveAssetUrl(TRAFFIC_MANIFEST_URL);
    let res: Response;
    try {
      res = await fetch(manifestUrl);
    } catch (err) {
      throw new Error(`[traffic] network error loading ${manifestUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new Error(`[traffic] ${manifestUrl} answered HTTP ${res.status}`);
    const text = await res.text();
    let manifest: TrafficManifest;
    try {
      manifest = JSON.parse(text) as TrafficManifest;
    } catch {
      throw new Error(`[traffic] ${manifestUrl} is not JSON (starts with "${text.slice(0, 40)}")`);
    }
    if (!manifest.types || Object.keys(manifest.types).length === 0) {
      throw new Error(`[traffic] ${manifestUrl} lists no car types`);
    }
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(resolveAssetUrl('assets/models/village/draco/'));
    loader.setDRACOLoader(draco);
    const glbUrl = resolveAssetUrl(manifest.glb);
    const texLoader = new THREE.TextureLoader();
    let gltf;
    let albedo: THREE.Texture, albedo1k: THREE.Texture, normal: THREE.Texture, orm: THREE.Texture, mask: THREE.Texture;
    try {
      [gltf, albedo, albedo1k, normal, orm, mask] = await Promise.all([
        loader.loadAsync(glbUrl),
        loadTexture(texLoader, manifest.textures.albedo),
        loadTexture(texLoader, manifest.textures.albedo1k),
        loadTexture(texLoader, manifest.textures.normal),
        loadTexture(texLoader, manifest.textures.orm),
        loadTexture(texLoader, manifest.textures.mask),
      ]);
    } catch (err) {
      throw new Error(`[traffic] loading ${glbUrl} / atlas textures failed: ${(err as Error).message}`);
    } finally {
      draco.dispose();
    }
    dedupeModelTextures(gltf.scene, glbUrl);
    for (const t of [albedo, albedo1k, normal, orm, mask]) {
      t.flipY = false;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = Math.min(8, maxAnisotropy);
      t.needsUpdate = true;
    }
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo1k.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    orm.colorSpace = THREE.NoColorSpace;
    mask.colorSpace = THREE.NoColorSpace;
    mask.minFilter = THREE.LinearMipmapLinearFilter;

    const geometries = new Map<string, THREE.BufferGeometry>();
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry as THREE.BufferGeometry;
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      }
      for (const a of ['position', 'normal', 'uv']) {
        if (!geo.getAttribute(a)) throw new Error(`[traffic] ${glbUrl}: mesh "${mesh.name}" has no ${a} attribute`);
      }
      if (!geo.index) throw new Error(`[traffic] ${glbUrl}: mesh "${mesh.name}" is not indexed`);
      // un-quantise (Draco may decode to normalized integer arrays; BatchedMesh needs identical attribute types)
      for (const a of ['position', 'normal', 'uv']) {
        const attr = geo.getAttribute(a) as THREE.BufferAttribute;
        if (!(attr.array instanceof Float32Array) || attr.normalized) {
          const f = new Float32Array(attr.count * attr.itemSize);
          for (let i = 0; i < attr.count; i++) {
            for (let k = 0; k < attr.itemSize; k++) f[i * attr.itemSize + k] = attr.getComponent(i, k);
          }
          geo.setAttribute(a, new THREE.BufferAttribute(f, attr.itemSize));
        }
      }
      if (!(geo.index.array instanceof Uint32Array)) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.index.array), 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      geometries.set(mesh.name, geo);
    });
    return new CarFleetRenderer(manifest, geometries, { albedo, albedo1k, normal, orm, mask }, maxSlots);
  }

  public typeNames(): string[] {
    return [...this.types.keys()];
  }

  public getType(name: string): CarType {
    const t = this.types.get(name);
    if (!t) throw new Error(`[traffic] unknown car type "${name}" (known: ${this.typeNames().join(', ')})`);
    return t;
  }

  /** Reserves a car (body + 4 wheels in both batches). Throws when the pool is exhausted. */
  public allocate(type: CarType, color: THREE.Color, flags: number, isStatic: boolean): number {
    let index = this.freeSlots.pop();
    if (index === undefined) {
      if (this.slots.length >= this.maxSlots) throw new Error(`[traffic] car pool exhausted (${this.maxSlots} slots)`);
      index = this.slots.length;
      const ids: [number[], number[]] = [[], []];
      for (let b = 0; b < 2; b++) {
        for (let k = 0; k < 5; k++) {
          const id = this.batches[b].addInstance(type.bodyGeo[2]);
          this.batches[b].setVisibleAt(id, false);
          ids[b].push(id);
        }
      }
      this.slots.push({
        type,
        active: false,
        pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, steer: 0, spinF: 0, spinR: 0 },
        dirty: true,
        flags: 0,
        color: new THREE.Color(),
        colorDirty: true,
        batch: -1,
        lod: -1,
        ids,
        dist: 0,
        isStatic,
        hidden: false,
      });
    }
    const s = this.slots[index];
    s.type = type;
    s.active = true;
    s.dirty = true;
    s.flags = flags;
    s.color.copy(color);
    s.colorDirty = true;
    s.batch = -1;
    s.lod = -1;
    s.isStatic = isStatic;
    s.hidden = false;
    return index;
  }

  public free(index: number): void {
    const s = this.slots[index];
    if (!s || !s.active) throw new Error(`[traffic] free(${index}): slot is not in use`);
    this.hideSlot(s);
    s.active = false;
    this.freeSlots.push(index);
  }

  public pose(index: number): CarPose {
    const s = this.slots[index];
    s.dirty = true;
    return s.pose;
  }

  public setFlags(index: number, flags: number): void {
    const s = this.slots[index];
    if (s.flags !== flags) {
      s.flags = flags;
      s.colorDirty = true;
    }
  }

  public setHidden(index: number, hidden: boolean): void {
    this.slots[index].hidden = hidden;
  }

  private hideSlot(s: Slot): void {
    if (s.batch < 0) return;
    const batch = this.batches[s.batch];
    for (const id of s.ids[s.batch]) batch.setVisibleAt(id, false);
    s.batch = -1;
    s.lod = -1;
  }

  public setQuality(level: QualityLevel): void {
    const p = QUALITY[level];
    if (!p) throw new Error(`[traffic] unknown quality level "${level}"`);
    this.quality = level;
    this.profile = p;
    this.batches[0].castShadow = p.shadows;
    this.material.map = p.albedo1k ? this.albedoTextures.small : this.albedoTextures.full;
    this.material.needsUpdate = true;
    // re-evaluate every slot's batch / LOD on the next commit
    for (const s of this.slots) {
      if (s.active) {
        this.hideSlot(s);
        s.dirty = true;
      }
    }
  }

  public get qualityLevel(): QualityLevel {
    return this.quality;
  }

  public get shadowsEnabled(): boolean {
    return this.profile.shadows;
  }

  public setNightFactor(nf: number): void {
    this.nightFactor = THREE.MathUtils.clamp(nf, 0, 1);
    const n = this.nightFactor;
    const lamp = this.uniforms.khLamp.value as THREE.Vector4;
    // x: running light (day), y: low beam, z: tail (with headlights), w: brake
    lamp.set(THREE.MathUtils.lerp(1.6, 0.9, n), 2.2 + 4.5 * n, 0.9 + 1.2 * n, 3.2 + 1.5 * n);
    (this.uniforms.khBlink.value as THREE.Vector2).y = n;
  }

  /** Writes matrices / LODs for every active car; `camera` decides LOD, batch and the night lamp sprites. */
  public commit(camera: THREE.Camera, dt: number): void {
    camera.getWorldPosition(this.camPos);
    const p = this.profile;
    this.blinkTime += dt;
    const blinkOn = this.blinkTime % 0.75 < 0.4;
    (this.uniforms.khBlink.value as THREE.Vector2).x = blinkOn ? 2.6 : 0;
    let near = 0;
    let far = 0;
    let tris = 0;
    let visible = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const dx = s.pose.x - this.camPos.x;
      const dy = s.pose.y - this.camPos.y;
      const dz = s.pose.z - this.camPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      s.dist = d;
      let batch = -1;
      let lod = 2;
      if (!s.hidden && d < p.maxDist) {
        lod = d < p.lod0 ? 0 : d < p.lod1 ? 1 : 2;
        batch = p.shadows && d < p.shadowDist ? 0 : 1;
      }
      if (batch !== s.batch || lod !== s.lod) {
        this.hideSlot(s);
        if (batch >= 0) {
          s.batch = batch;
          s.lod = lod;
          s.dirty = true;
          s.colorDirty = true;
          const b = this.batches[batch];
          const ids = s.ids[batch];
          b.setGeometryIdAt(ids[0], s.type.bodyGeo[lod]);
          b.setVisibleAt(ids[0], true);
          for (let w = 0; w < 4; w++) {
            const wheel = s.type.wheels[w];
            if (lod < 2) b.setGeometryIdAt(ids[w + 1], wheel.geo[lod]);
            b.setVisibleAt(ids[w + 1], lod < 2);
          }
        }
      }
      if (s.batch < 0) continue;
      visible++;
      if (s.batch === 0) near++;
      else far++;
      tris += s.type.triangles.lod[s.lod] + (s.lod < 2 ? s.type.triangles.wheel[Math.min(s.lod, s.type.triangles.wheel.length - 1)] * 4 : 0);
      const b = this.batches[s.batch];
      const ids = s.ids[s.batch];
      if (s.colorDirty) {
        b.setColorAt(ids[0], s.color);
        this.writeFlags(b, ids[0], s.flags);
        this.tmpC.setRGB(1, 1, 1);
        for (let w = 1; w < 5; w++) {
          b.setColorAt(ids[w], this.tmpC);
          this.writeFlags(b, ids[w], 0);
        }
        s.colorDirty = false;
      }
      if (s.dirty) {
        this.writeMatrices(b, ids, s);
        s.dirty = false;
      }
    }
    this.stats.visible = visible;
    this.stats.near = near;
    this.stats.far = far;
    this.stats.triangles = tris;
    this.updateNightLights();
  }

  private writeFlags(b: THREE.BatchedMesh, id: number, flags: number): void {
    const tex = (b as unknown as { _colorsTexture: THREE.DataTexture | null })._colorsTexture;
    if (!tex) throw new Error('[traffic] BatchedMesh colour texture missing after setColorAt');
    (tex.image.data as Float32Array)[id * 4 + 3] = flags;
    tex.needsUpdate = true;
  }

  private bodyMatrix(pose: CarPose, out: THREE.Matrix4): THREE.Matrix4 {
    this.tmpE.set(-pose.pitch, pose.yaw, pose.roll, 'YXZ');
    this.tmpQ.setFromEuler(this.tmpE);
    this.tmpV.set(pose.x, pose.y, pose.z);
    return out.compose(this.tmpV, this.tmpQ, this.tmpS);
  }

  private writeMatrices(b: THREE.BatchedMesh, ids: number[], s: Slot): void {
    const body = this.bodyMatrix(s.pose, this.tmpM);
    b.setMatrixAt(ids[0], body);
    if (s.lod >= 2) return;
    for (let w = 0; w < 4; w++) {
      const wheel = s.type.wheels[w];
      const spin = w < 2 ? s.pose.spinF : s.pose.spinR;
      // hub: T(x, r, z) * Ry(steer) * [Ry(pi) for right wheels] * Rx(spin)
      // the Rx(spin) acts in the car frame after the flip, so both sides roll the same way (+spin = forward)
      this.tmpE.set(spin, wheel.steer ? s.pose.steer : 0, 0, 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      this.tmpV.set(wheel.x, wheel.radius, wheel.z);
      this.tmpW.compose(this.tmpV, this.tmpQ, this.tmpS);
      if (wheel.right) {
        // rotate the wheel (rim face outwards) about its own vertical axis
        this.tmpW.multiply(this.flipY);
      }
      this.tmpW.premultiply(body);
      b.setMatrixAt(ids[w + 1], this.tmpW);
    }
  }

  /** Light pools + lamp halos for lit cars near the camera (night only). */
  private updateNightLights(): void {
    const n = this.nightFactor;
    if (n < 0.08) {
      this.beams.count = 0;
      this.glows.count = 0;
      this.beams.visible = false;
      this.glows.visible = false;
      this.stats.beams = 0;
      this.stats.glows = 0;
      return;
    }
    this.beams.visible = true;
    this.glows.visible = true;
    let nb = 0;
    let ng = 0;
    const beamColor = this.tmpC;
    for (const s of this.slots) {
      if (!s.active || s.batch < 0) continue;
      const lit = (s.flags & CAR_FLAG.headlights) !== 0;
      const brake = (s.flags & CAR_FLAG.brake) !== 0;
      if (!lit && !brake) continue;
      const body = this.bodyMatrix(s.pose, this.tmpM);
      if (lit && nb < MAX_BEAMS && s.dist < BEAM_RANGE_M) {
        // pool starts just ahead of the bumper, 3.8 m wide x 15 m long, laid on the road under the car
        this.tmpV.set(0, 0.07, s.type.frontZ + 0.6);
        this.tmpE.set(0, 0, 0);
        this.tmpQ.identity();
        this.tmpW.compose(this.tmpV, this.tmpQ, this.tmpV2.set(3.8, 1, 15));
        this.tmpW.premultiply(body);
        this.beams.setMatrixAt(nb, this.tmpW);
        const fade = THREE.MathUtils.smoothstep(BEAM_RANGE_M - s.dist, 0, 40) * n;
        beamColor.setRGB(0.55 * fade, 0.5 * fade, 0.42 * fade);
        this.beams.setColorAt(nb, beamColor);
        nb++;
      }
      const lamps: [THREE.Vector3[], number, number, number, number][] = [];
      if (lit) lamps.push([s.type.head, 1.0, 0.92, 0.78, 0.55]);
      lamps.push([s.type.tail, 1.0, 0.08, 0.04, brake ? 0.5 : 0.3]);
      for (const [pts, r, g, bl, size] of lamps) {
        for (const lp of pts) {
          if (ng >= MAX_LAMP_GLOWS) break;
          this.tmpV.copy(lp).applyMatrix4(body);
          const intensity = (pts === s.type.tail ? (brake ? 1.6 : lit ? 0.7 : 0) : 1.3) * n;
          if (intensity <= 0) continue;
          this.tmpW.makeScale(size, size, size).setPosition(this.tmpV);
          this.glows.setMatrixAt(ng, this.tmpW);
          beamColor.setRGB(r * intensity, g * intensity, bl * intensity);
          this.glows.setColorAt(ng, beamColor);
          ng++;
        }
      }
    }
    this.beams.count = nb;
    this.glows.count = ng;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    this.stats.beams = nb;
    this.stats.glows = ng;
  }

  /** True while a shadow-casting (near) car is visible: the near shadow cascade must follow it. */
  public get hasNearCasters(): boolean {
    return this.profile.shadows && this.stats.near > 0;
  }

  public dispose(): void {
    for (const b of this.batches) b.dispose();
    this.beams.dispose();
    this.glows.dispose();
    this.material.dispose();
  }
}
