import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LoadedLandmarkInfo } from './buildings';
import { LANDMARK_COLLIDERS_URL } from './collision';
import { RECREATION_EXCLUSION_POLYS } from './recreation';
import { dedupeModelTextures } from './sharedAssets';
import type { TerrainSystem } from './terrain';
import { resolveAssetUrl } from './url';
import type { BraveReferenceEntry, BuildingRecord, LanduseRecord, RoadRecord, SceneData, VillageManifest, VillagePropEntry } from './types';

function extractRoadXZ(p: [number, number] | [number, number, number]): [number, number] {
  return p.length === 3 ? [p[0], p[2]] : [p[0], p[1]];
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

/**
 * Fast 2m-cell spatial occupancy grid so vines, trees, streetlamps, and hay bales
 * never clip into buildings or roads.
 */
class ExclusionGrid {
  private readonly cellSize = 2.0;
  private readonly halfMap: number;
  private readonly dim: number;
  private readonly cells: Uint8Array;

  constructor(mapSizeM: number) {
    this.halfMap = mapSizeM * 0.5;
    this.dim = Math.ceil(mapSizeM / this.cellSize);
    this.cells = new Uint8Array(this.dim * this.dim);
  }

  private toIdx(x: number, z: number): number {
    const gx = Math.floor((x + this.halfMap) / this.cellSize);
    const gz = Math.floor((z + this.halfMap) / this.cellSize);
    if (gx < 0 || gx >= this.dim || gz < 0 || gz >= this.dim) return -1;
    return gz * this.dim + gx;
  }

  public markCircle(x: number, z: number, radiusM: number, flag: number): void {
    const rCells = Math.ceil(radiusM / this.cellSize);
    const cx = Math.floor((x + this.halfMap) / this.cellSize);
    const cz = Math.floor((z + this.halfMap) / this.cellSize);
    const r2 = radiusM * radiusM;

    for (let dz = -rCells; dz <= rCells; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= this.dim) continue;
      for (let dx = -rCells; dx <= rCells; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= this.dim) continue;
        const wx = (gx + 0.5) * this.cellSize - this.halfMap;
        const wz = (gz + 0.5) * this.cellSize - this.halfMap;
        if ((wx - x) * (wx - x) + (wz - z) * (wz - z) <= r2) {
          this.cells[gz * this.dim + gx] |= flag;
        }
      }
    }
  }

  public markPolygon(pts: [number, number][], padM: number, flag: number): void {
    if (pts.length < 3) return;
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

    const x0 = Math.max(0, Math.floor((minX - padM + this.halfMap) / this.cellSize));
    const x1 = Math.min(this.dim - 1, Math.ceil((maxX + padM + this.halfMap) / this.cellSize));
    const z0 = Math.max(0, Math.floor((minZ - padM + this.halfMap) / this.cellSize));
    const z1 = Math.min(this.dim - 1, Math.ceil((maxZ + padM + this.halfMap) / this.cellSize));

    for (let gz = z0; gz <= z1; gz++) {
      const wz = (gz + 0.5) * this.cellSize - this.halfMap;
      for (let gx = x0; gx <= x1; gx++) {
        const wx = (gx + 0.5) * this.cellSize - this.halfMap;
        if (pointInPolygon(wx, wz, pts) || distanceToPolygonEdgesSq(wx, wz, pts) <= padM * padM) {
          this.cells[gz * this.dim + gx] |= flag;
        }
      }
    }
  }

  public markPolyline(pts: [number, number][], halfWidthM: number, flag: number): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const dist = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1.5, halfWidthM * 0.6)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        this.markCircle(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, halfWidthM, flag);
      }
    }
  }

  public isBlocked(x: number, z: number, mask = 3): boolean {
    const idx = this.toIdx(x, z);
    if (idx < 0) return true;
    return (this.cells[idx] & mask) !== 0;
  }
}

const FLAG_BUILDING = 1;
const FLAG_ROAD = 2;

function pointInPolygon(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    const intersect = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToPolygonEdgesSq(px: number, pz: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    const t = lenSq > 1e-8 ? THREE.MathUtils.clamp(((px - ax) * abx + (pz - az) * abz) / lenSq, 0, 1) : 0;
    const dx = px - (ax + abx * t);
    const dz = pz - (az + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return best;
}

function estimateLongestEdgeAngle(poly: [number, number][]): number {
  let bestLen = 0;
  let bestAngle = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len > bestLen) {
      bestLen = len;
      bestAngle = Math.atan2(dz, dx);
    }
  }
  return bestAngle;
}


// =====================================================================================================
// Vegetation rendering core (shared with src/fields.ts)
//
//  * Every vegetation asset is a GLB with child nodes <key>_LOD0 / _LOD1 / (_LOD2) / _FAR
//    (see blender/village/props/veg_blender.py for the mesh conventions).
//  * InstancedLodLayer keeps ALL instances in cheap, frustum-culled far chunks and re-fills small
//    InstancedMesh pools with detailed LODs around the camera. LOD hand-over is a dithered cross-fade
//    done in the shader from the instance origin, so the pools never have to match exactly.
//  * patchVegMaterial() adds (uniquely named) uniforms/varyings via onBeforeCompile: LOD fade, wind,
//    crown-space normals on double-sided cards and leaf translucency. It only appends to chunks, so the
//    stock shadow / fog / tone-mapping code stays untouched and other hooks can be chained after it.
// =====================================================================================================

export interface SubMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  localMatrix: THREE.Matrix4;
}

/** Shared uniform objects: `uVegTime` is advanced by fieldsSystem.update(dt), `uVegCamPos` by the LOD driver. */
export const vegUniforms = {
  uVegTime: { value: 0 },
  uVegCamPos: { value: new THREE.Vector3(0, 1e6, 0) },
  /** 1 in daylight, 0 at night: leaf translucency is a SUN effect and must not amplify floodlights / lamps. */
  uVegDay: { value: 1 },
  /**
   * Vineyard lane floor beyond the range in which the rows cast real shadows:
   * x = brightness factor that stands in for the missing row shadows, y / z = start / end distance (m).
   */
  uVegFloorFar: { value: new THREE.Vector3(1, 24, 34) },
};

export interface VegMaterialOptions {
  /** Double-sided leaf cards: keep authored normals on back faces + leaf translucency. */
  foliage: boolean;
  /** (fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd) distances in metres from the instance origin. */
  fade?: THREE.Vector4;
  /** Vertices below this object-space height are never faded (ground carpets inside far meshes). */
  keepBelowY?: number;
  /** x = sway amplitude (m at full height), y = leaf flutter amplitude (m), z = height of full sway (m). */
  wind?: THREE.Vector3;
  /** Transmitted-light tint (multiplied with the albedo); zero disables. */
  translucency?: THREE.Color;
  /**
   * Ground cover: every instance carries its own view distance in the instanced attribute `aVegReach` and
   * shrinks into the ground as the camera recedes (replaces the dithered uVegFade hand-over).
   */
  instanceReach?: boolean;
  /**
   * Far vine tent: stands in for the detailed rows beyond the range of real row shadows, so it takes the same
   * sun-dependent darkening as the lane floor (vegUniforms.uVegFloorFar.x) to match the tone of the near rows.
   */
  rowShade?: boolean;
  /** Per-fragment cut at the parcel outline (crop tiles may overhang it; see VegClipConfig). */
  clip?: VegClipConfig;
}

/**
 * Parcel clip map for tiled crops: RG8 over the whole map (row = z, column = x).
 * R = signed distance (m) to the outline of the parcel that owns the texel, (sd + 4) / 8 (linear filtered: straight,
 * sub-texel edges); G = owner id (1..255, read with texelFetch). Every instance carries its parcel id in the
 * instanced attribute `aVegClipId`; fragments outside the outline or in another parcel's texels are discarded, so
 * tile strips can run past an oblique border and are cut exactly along it (no sawtooth, no bare floor wedge).
 */
export interface VegClipConfig {
  texture: THREE.DataTexture;
  mapSizeM: number;
}

const VEG_CLIP_VERT_PARS = `
        attribute float aVegClipId;
        varying vec2 vVegClipXZ;
        varying float vVegClipId;`;
const VEG_CLIP_VERT = `
        #ifdef USE_INSTANCING
          vec4 vegClipW = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
        #else
          vec4 vegClipW = modelMatrix * vec4( transformed, 1.0 );
        #endif
        vVegClipXZ = vegClipW.xz;
        vVegClipId = aVegClipId;`;
const VEG_CLIP_FRAG_PARS = `
        uniform sampler2D uVegClipMask;
        uniform vec2 uVegClipMap;
        varying vec2 vVegClipXZ;
        varying float vVegClipId;`;
const VEG_CLIP_FRAG = `
        {
          vec2 vegClipUv = vVegClipXZ / uVegClipMap.x + 0.5;
          float vegClipSd = texture2D( uVegClipMask, vegClipUv ).r * 8.0 - 4.0;
          float vegClipOwner = texelFetch( uVegClipMask, ivec2( clamp( vegClipUv, 0.0, 0.99999 ) * uVegClipMap.y ), 0 ).g * 255.0;
          if ( vegClipSd < 0.0 || abs( vegClipOwner - vVegClipId ) > 0.5 ) discard;
        }`;

function vegClipUniforms(clip: VegClipConfig): { uVegClipMask: { value: THREE.Texture }; uVegClipMap: { value: THREE.Vector2 } } {
  const size = clip.texture.image.width;
  if (!size || clip.texture.image.height !== size) throw new Error('[vegetation] clip mask must be a square DataTexture');
  return { uVegClipMask: { value: clip.texture }, uVegClipMap: { value: new THREE.Vector2(clip.mapSizeM, size) } };
}

const VEG_NO_FADE = new THREE.Vector4(-2, -1, 1e8, 2e8);

export function patchVegMaterial(mat: THREE.Material, opts: VegMaterialOptions): void {
  if (!(mat instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`[vegetation] material "${mat.name}" is ${mat.type}; MeshStandardMaterial expected`);
  }
  const fade = { value: opts.fade ?? VEG_NO_FADE };
  const keepY = { value: opts.keepBelowY ?? -1e6 };
  const wind = { value: opts.wind ?? new THREE.Vector3(0, 0, 1) };
  const trans = { value: opts.translucency ?? new THREE.Color(0, 0, 0) };
  const foliage = opts.foliage;
  const reach = opts.instanceReach === true;
  const rowShade = opts.rowShade === true;
  const clipU = opts.clip ? vegClipUniforms(opts.clip) : null;
  mat.userData.vegUniforms = { uVegFade: fade, uVegKeepY: keepY, uVegWind: wind, uVegTrans: trans };
  mat.customProgramCacheKey = () => `veg-lod-${foliage ? 'foliage' : 'solid'}${reach ? '-reach' : ''}${rowShade ? '-rowshade' : ''}${clipU ? '-clip' : ''}`;
  mat.onBeforeCompile = (shader) => {
    if (clipU) Object.assign(shader.uniforms, clipU);
    shader.uniforms.uVegTime = vegUniforms.uVegTime;
    shader.uniforms.uVegCamPos = vegUniforms.uVegCamPos;
    shader.uniforms.uVegFade = fade;
    shader.uniforms.uVegKeepY = keepY;
    shader.uniforms.uVegWind = wind;
    shader.uniforms.uVegTrans = trans;
    shader.uniforms.uVegDay = vegUniforms.uVegDay;
    shader.uniforms.uVegFloorFar = vegUniforms.uVegFloorFar;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uVegTime;
        uniform vec3 uVegCamPos;
        uniform vec4 uVegFade;
        uniform float uVegKeepY;
        uniform vec3 uVegWind;
        attribute vec2 aVegData;
        ${reach ? 'attribute float aVegReach;' : ''}
        varying float vVegFade;
        varying float vVegFadeOut;
        varying vec2 vVegData;${clipU ? VEG_CLIP_VERT_PARS : ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 vegOrigin = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;
        #else
          vec3 vegOrigin = modelMatrix[ 3 ].xyz;
        #endif
        float vegDist = distance( vegOrigin, uVegCamPos );
        float vegVisible = smoothstep( uVegFade.x, uVegFade.y, vegDist ) * ( 1.0 - smoothstep( uVegFade.z, uVegFade.w, vegDist ) );
        vVegFade = position.y < uVegKeepY ? 1.0 : vegVisible;
        // fading out (outer band) dissolves with the inverted noise of the level fading in over the same band:
        // every pixel of the band is drawn by exactly one of the two levels (no see-through speckle halo)
        vVegFadeOut = vegDist > 0.5 * ( uVegFade.y + uVegFade.z ) ? 1.0 : 0.0;
        ${reach ? 'float vegGrow = 1.0 - smoothstep( aVegReach * 0.7, aVegReach, vegDist ); transformed *= vegGrow; vVegFade = vegGrow > 0.02 ? 1.0 : 0.0;' : ''}
        vVegData = aVegData;
        float vegH = clamp( position.y / uVegWind.z, 0.0, 1.0 );
        float vegPhase = uVegTime * 1.35 + vegOrigin.x * 0.085 + vegOrigin.z * 0.062;
        float vegGust = sin( vegPhase ) * 0.65 + sin( vegPhase * 1.83 + 1.3 ) * 0.35;
        transformed.x += vegGust * uVegWind.x * vegH * vegH;
        transformed.z += cos( vegPhase * 0.87 + 0.6 ) * uVegWind.x * 0.55 * vegH * vegH;
        transformed += objectNormal * ( sin( uVegTime * 4.7 + dot( position, vec3( 3.1, 2.3, 2.7 ) ) + vegOrigin.x ) * uVegWind.y * aVegData.x );`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        if ( vVegFade <= 0.002 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );${clipU ? VEG_CLIP_VERT : ''}`
      );

    let frag = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uVegTrans;
        uniform float uVegDay;
        uniform vec3 uVegFloorFar;
        varying float vVegFade;
        varying float vVegFadeOut;
        varying vec2 vVegData;${clipU ? VEG_CLIP_FRAG_PARS : ''}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>${clipU ? VEG_CLIP_FRAG : ''}
        if ( vVegFade < 0.998 ) {
          float vegNoise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
          vegNoise = vVegFadeOut > 0.5 ? 1.0 - vegNoise : vegNoise;
          if ( vVegFade < vegNoise ) discard;
        }`
      );
    if (rowShade) {
      frag = frag.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix( 1.0, uVegFloorFar.x, 0.85 ) * 0.9;');
    }
    if (foliage) {
      frag = frag
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
          #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
            // foliage cards carry crown-space normals: undo the stock back-face flip
            normal *= faceDirection;
            nonPerturbedNormal = normal;
            #if defined( USE_NORMALMAP_TANGENTSPACE ) && ! defined( USE_TANGENT )
              tbn[ 2 ] = normal;
            #endif
          #endif`
        )
        .replace(
          '#include <lights_physical_pars_fragment>',
          `#include <lights_physical_pars_fragment>
          void RE_Direct_VegFoliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
            RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
            // light that falls on the far side of a leaf comes through tinted (shadow term is already in directLight.color)
            float vegBack = saturate( 0.3 - dot( geometryNormal, directLight.direction ) );
            float vegToSun = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 );
            reflectedLight.directDiffuse += directLight.color * material.diffuseColor * uVegTrans * ( uVegDay * vVegData.y ) * ( vegBack * ( 0.3 + 1.5 * vegToSun ) + 0.22 * vegToSun );
          }
          #undef RE_Direct
          #define RE_Direct RE_Direct_VegFoliage`
        );
    }
    shader.fragmentShader = frag;
  };
  mat.needsUpdate = true;
}

/**
 * Shadow-pass material for a vegetation LOD: same instance-distance test as the colour pass (against the MAIN
 * camera, via the shared uVegCamPos uniform), so a far tent and the detailed bay standing in the same place
 * never both cast. Alpha-tested like the source material; hard switch in the middle of the cross-fade band.
 */
export function makeVegDepthMaterial(src: THREE.Material, fade: THREE.Vector4, keepBelowY?: number, clip?: VegClipConfig): THREE.MeshDepthMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: std.alphaTest > 0 ? std.map : null,
    alphaTest: std.alphaTest,
    side: THREE.DoubleSide,
  });
  depth.name = `${src.name}_VegDepth`;
  const fadeU = { value: fade };
  const keepU = { value: keepBelowY ?? -1e6 };
  const clipU = clip ? vegClipUniforms(clip) : null;
  depth.customProgramCacheKey = () => `veg-lod-depth${clipU ? '-clip' : ''}`;
  depth.onBeforeCompile = (shader) => {
    if (clipU) Object.assign(shader.uniforms, clipU);
    shader.uniforms.uVegCamPos = vegUniforms.uVegCamPos;
    shader.uniforms.uVegFade = fadeU;
    shader.uniforms.uVegKeepY = keepU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uVegCamPos;\nuniform vec4 uVegFade;\nuniform float uVegKeepY;${clipU ? VEG_CLIP_VERT_PARS : ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vec3 vegOrigin = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;
        #else
          vec3 vegOrigin = modelMatrix[ 3 ].xyz;
        #endif
        float vegDist = distance( vegOrigin, uVegCamPos );
        float vegVisible = smoothstep( uVegFade.x, uVegFade.y, vegDist ) * ( 1.0 - smoothstep( uVegFade.z, uVegFade.w, vegDist ) );
        if ( position.y >= uVegKeepY && vegVisible < 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );${clipU ? VEG_CLIP_VERT : ''}`
      );
    if (clipU) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${VEG_CLIP_FRAG_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${VEG_CLIP_FRAG}`);
    }
  };
  return depth;
}

/** Moves the exporter's TEXCOORD_1 (flutter weight, translucency mask) to the attribute the veg shader reads. */
export function prepareVegGeometry(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('aVegData')) return;
  const uv1 = geometry.getAttribute('uv1');
  if (uv1) {
    geometry.setAttribute('aVegData', uv1);
    geometry.deleteAttribute('uv1');
  } else {
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('aVegData', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
}

export function isFoliageMaterial(mat: THREE.Material): boolean {
  return mat.name.startsWith('Veg_');
}

function tuneLoadedMaterial(mat: THREE.Material, maxAnisotropy: number): void {
  if (!(mat instanceof THREE.MeshStandardMaterial)) return;
  mat.envMapIntensity = isFoliageMaterial(mat) ? 0.35 : 0.8;
  for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap]) {
    if (tex) tex.anisotropy = Math.min(8, maxAnisotropy);
  }
  if (isFoliageMaterial(mat)) {
    // mip-mapped cut-outs lose coverage with distance: lower threshold + alpha-to-coverage (MSAA) keeps crowns dense
    mat.roughness = Math.max(mat.roughness, 0.8);
    mat.alphaTest = 0.36;
    mat.alphaToCoverage = true;
    mat.side = THREE.DoubleSide;
    mat.shadowSide = THREE.DoubleSide;
  }
}

const gltfCache = new Map<string, Promise<THREE.Group>>();
const sharedGltfLoader = new GLTFLoader();

/** Loads a GLB once per URL, de-duplicates its library textures and tunes the materials. */
export function loadVegGltf(url: string, maxAnisotropy: number): Promise<THREE.Group> {
  let pending = gltfCache.get(url);
  if (!pending) {
    pending = sharedGltfLoader.loadAsync(url).then((gltf) => {
      dedupeModelTextures(gltf.scene);
      const seen = new Set<THREE.Material>();
      gltf.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          tuneLoadedMaterial(m, maxAnisotropy);
        }
      });
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
    gltfCache.set(url, pending);
  }
  return pending;
}

export function collectParts(root: THREE.Object3D): SubMeshPart[] {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const parts: SubMeshPart[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
    if (Array.isArray(obj.material)) throw new Error(`[vegetation] mesh "${obj.name}" has multiple materials`);
    prepareVegGeometry(obj.geometry);
    parts.push({ geometry: obj.geometry, material: obj.material, localMatrix: new THREE.Matrix4().multiplyMatrices(rootInv, obj.matrixWorld) });
  });
  return parts;
}

export interface LodAsset {
  /** Detailed levels, nearest first. */
  levels: SubMeshPart[][];
  /** Cheapest representation, shown beyond the last level (null = nothing is drawn out there). */
  far: SubMeshPart[] | null;
  size: THREE.Vector3;
  minY: number;
  maxY: number;
  /** glTF extras of the LOD0 node (tileM, lodDist, heightM, windSway ... written by the Blender builders). */
  meta: Record<string, unknown>;
}

/** Names of the LOD nodes (`LOD0`, `LOD1`, `LOD2`, `FAR`) that exist for `<prefix>_*` in a GLB. */
export async function listLodNodes(url: string, nodePrefix: string, maxAnisotropy: number): Promise<string[]> {
  const scene = await loadVegGltf(url, maxAnisotropy);
  return ['LOD0', 'LOD1', 'LOD2', 'FAR'].filter((n) => scene.getObjectByName(`${nodePrefix}_${n}`));
}

/** Reads `<prefix>_<name>` nodes out of a GLB. Missing nodes are a build error and throw. */
export async function loadLodAsset(
  url: string,
  nodePrefix: string,
  levelNames: string[],
  farName: string | null,
  maxAnisotropy: number
): Promise<LodAsset> {
  const scene = await loadVegGltf(url, maxAnisotropy);
  const grab = (suffix: string): SubMeshPart[] => {
    const node = scene.getObjectByName(`${nodePrefix}_${suffix}`);
    if (!node) throw new Error(`[vegetation] ${url} has no node "${nodePrefix}_${suffix}" (rebuild the GLB)`);
    const parts = collectParts(node);
    if (parts.length === 0) throw new Error(`[vegetation] node "${nodePrefix}_${suffix}" in ${url} contains no mesh`);
    return parts;
  };
  const levels = levelNames.map(grab);
  const far = farName ? grab(farName) : null;
  const bbox = new THREE.Box3();
  for (const part of levels[0]) {
    part.geometry.computeBoundingBox();
    bbox.union(part.geometry.boundingBox!.clone().applyMatrix4(part.localMatrix));
  }
  const size = bbox.getSize(new THREE.Vector3());
  const meta = { ...(scene.getObjectByName(`${nodePrefix}_${levelNames[0]}`)?.userData ?? {}) } as Record<string, unknown>;
  return { levels, far, size, minY: bbox.min.y, maxY: bbox.max.y, meta };
}

export interface LodLayerConfig {
  name: string;
  asset: LodAsset;
  /** Maximum distance of each detailed level (same order as asset.levels). */
  levelDist: number[];
  /** Width of the dithered cross-fade between two representations. */
  band: number;
  /** Edge length of the frustum-culled far chunks. */
  chunkM: number;
  mapSizeM: number;
  castShadow: boolean[];
  farCastShadow: boolean;
  wind?: THREE.Vector3;
  translucency?: THREE.Color;
  /** Far-mesh vertices below this height (lane / field floor) stay visible under the detailed levels. */
  farKeepBelowY?: number;
  /** Depth bias for far meshes that contain a ground carpet lying on the terrain. */
  farPolygonOffset?: boolean;
  /** Far mesh takes the sun-dependent row-shadow darkening (vineyard tent). */
  farRowShade?: boolean;
  /** Low quality: far chunks farther than this (m, camera to chunk bounds) are not drawn at all. */
  farCullM?: number;
  /** Low quality: only this share of the far instances is drawn (stable random subset; trees). */
  farThinKeep?: number;
  /** Cut every instance at its parcel outline (add() then needs the parcel id); see VegClipConfig. */
  clip?: VegClipConfig;
}

const CELL_M = 32;

export class InstancedLodLayer {
  public readonly group = new THREE.Group();
  public count = 0;
  private matrices = new Float32Array(16 * 1024);
  private colors: Float32Array | null = null;
  /** Parcel id per instance (only for layers with cfg.clip). */
  private clipIds: Float32Array | null = null;
  private readonly cfg: LodLayerConfig;
  private readonly cellDim: number;
  private readonly half: number;
  private cellStart: Int32Array = new Int32Array(0);
  private cellItems: Int32Array = new Int32Array(0);
  private pools: { meshes: THREE.InstancedMesh[]; parts: SubMeshPart[]; capacity: number }[] = [];
  private readonly baseDist: number[];
  private readonly levelFades: THREE.Vector4[] = [];
  private farFade: THREE.Vector4 | null = null;
  private farChunks: { mesh: THREE.InstancedMesh; full: number }[] = [];
  private farLimited = false;
  private shadowFull = true;
  private lastFill = new THREE.Vector3(1e9, 1e9, 1e9);
  private readonly tmpA = new THREE.Matrix4();
  private readonly tmpB = new THREE.Matrix4();
  private readonly objRadius: number;
  private built = false;

  constructor(cfg: LodLayerConfig) {
    if (cfg.levelDist.length !== cfg.asset.levels.length || cfg.castShadow.length !== cfg.asset.levels.length) {
      throw new Error(`[vegetation] layer ${cfg.name}: levelDist/castShadow must match the asset levels`);
    }
    this.cfg = { ...cfg, levelDist: cfg.levelDist.slice() };
    this.baseDist = cfg.levelDist.slice();
    this.half = cfg.mapSizeM * 0.5;
    this.cellDim = Math.ceil(cfg.mapSizeM / CELL_M);
    this.group.name = cfg.name;
    this.objRadius = cfg.asset.size.length() * 0.75 + 2;
    if (cfg.clip) this.clipIds = new Float32Array(1024);
  }

  /** Calls fn with the column-major matrix of every instance added so far (a view - do not keep it). */
  public forEachInstance(fn: (e: Float32Array, index: number) => void): void {
    for (let i = 0; i < this.count; i++) fn(this.matrices.subarray(i * 16, i * 16 + 16), i);
  }

  public get layerName(): string {
    return this.cfg.name;
  }

  public add(matrix: THREE.Matrix4, color?: THREE.Color, clipId?: number): void {
    if (this.built) throw new Error(`[vegetation] layer ${this.cfg.name}: add() after build()`);
    if (this.clipIds && (clipId === undefined || !(clipId >= 1 && clipId <= 255))) {
      throw new Error(`[vegetation] layer ${this.cfg.name} clips at parcel outlines: add() needs a parcel id 1..255, got ${clipId}`);
    }
    if (!this.clipIds && clipId !== undefined) throw new Error(`[vegetation] layer ${this.cfg.name} has no clip map but got a parcel id`);
    if ((this.count + 1) * 16 > this.matrices.length) {
      const grown = new Float32Array(this.matrices.length * 2);
      grown.set(this.matrices);
      this.matrices = grown;
      if (this.colors) {
        const gc = new Float32Array((grown.length / 16) * 3).fill(1);
        gc.set(this.colors);
        this.colors = gc;
      }
      if (this.clipIds) {
        const gi = new Float32Array(grown.length / 16);
        gi.set(this.clipIds);
        this.clipIds = gi;
      }
    }
    matrix.toArray(this.matrices, this.count * 16);
    if (color) {
      if (!this.colors) this.colors = new Float32Array((this.matrices.length / 16) * 3).fill(1);
      color.toArray(this.colors, this.count * 3);
    }
    if (this.clipIds) this.clipIds[this.count] = clipId!;
    this.count++;
  }

  /** Clip layers: every instanced mesh gets its own geometry copy carrying the per-instance parcel id. */
  private attachClipIds(mesh: THREE.InstancedMesh, capacity: number, ids?: number[]): void {
    if (!this.clipIds) return;
    const arr = new Float32Array(capacity);
    if (ids) for (let k = 0; k < ids.length; k++) arr[k] = this.clipIds[ids[k]];
    mesh.geometry.setAttribute('aVegClipId', new THREE.InstancedBufferAttribute(arr, 1));
  }

  private makeMaterial(src: THREE.Material, fade: THREE.Vector4, isFar: boolean, rowShade = false): THREE.Material {
    const mat = src.clone();
    mat.name = src.name;
    const foliage = isFoliageMaterial(src);
    patchVegMaterial(mat, {
      foliage,
      fade,
      keepBelowY: isFar ? this.cfg.farKeepBelowY : undefined,
      wind: foliage ? this.cfg.wind : undefined,
      translucency: foliage ? this.cfg.translucency : undefined,
      rowShade: this.cfg.farRowShade === true && (isFar || rowShade),
      clip: this.cfg.clip,
    });
    if (isFar && this.cfg.farPolygonOffset) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1.5;
      mat.polygonOffsetUnits = -6;
    }
    return mat;
  }

  public build(): THREE.Group {
    if (this.built) return this.group;
    this.built = true;
    const { cfg } = this;
    const n = this.count;
    if (n === 0) return this.group;
    const band = cfg.band;
    const lastDist = cfg.levelDist[cfg.levelDist.length - 1];

    // spatial hash (counting sort) for the pool re-fill
    const cellCount = new Int32Array(this.cellDim * this.cellDim + 1);
    const cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(this.matrices[i * 16 + 12], this.matrices[i * 16 + 14]);
      cellOf[i] = c;
      cellCount[c + 1]++;
    }
    for (let c = 0; c < this.cellDim * this.cellDim; c++) cellCount[c + 1] += cellCount[c];
    this.cellStart = cellCount.slice();
    this.cellItems = new Int32Array(n);
    const cursor = cellCount.slice(0, this.cellDim * this.cellDim);
    for (let i = 0; i < n; i++) this.cellItems[cursor[cellOf[i]]++] = i;

    // far representation: every instance, split into chunks for frustum culling
    if (cfg.asset.far) {
      const farFade = new THREE.Vector4(lastDist - band, lastDist, 1e8, 2e8);
      this.farFade = farFade;
      const farMats = cfg.asset.far.map((p) => this.makeMaterial(p.material, farFade, true));
      const farDepth = cfg.farCastShadow ? cfg.asset.far.map((p) => makeVegDepthMaterial(p.material, farFade, cfg.farKeepBelowY, cfg.clip)) : [];
      const chunkDim = Math.max(1, Math.ceil(cfg.mapSizeM / cfg.chunkM));
      const buckets = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const cx = Math.min(chunkDim - 1, Math.max(0, Math.floor((this.matrices[i * 16 + 12] + this.half) / cfg.chunkM)));
        const cz = Math.min(chunkDim - 1, Math.max(0, Math.floor((this.matrices[i * 16 + 14] + this.half) / cfg.chunkM)));
        const key = cz * chunkDim + cx;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(i);
      }
      const shuffle = mulberry32(90211);
      for (const [key, list] of buckets) {
        // stable random order: a thinned far layer (low quality) drops an even spread of instances, not a region
        if (cfg.farThinKeep !== undefined) {
          for (let k = list.length - 1; k > 0; k--) {
            const j = Math.floor(shuffle() * (k + 1));
            const t = list[k];
            list[k] = list[j];
            list[j] = t;
          }
        }
        cfg.asset.far.forEach((part, pi) => {
          const mesh = new THREE.InstancedMesh(this.clipIds ? part.geometry.clone() : part.geometry, farMats[pi], list.length);
          this.attachClipIds(mesh, list.length, list);
          mesh.name = `${cfg.name}_far_${key}_${pi}`;
          mesh.castShadow = cfg.farCastShadow;
          mesh.receiveShadow = true;
          if (cfg.farCastShadow) mesh.customDepthMaterial = farDepth[pi];
          for (let k = 0; k < list.length; k++) {
            this.tmpA.fromArray(this.matrices, list[k] * 16);
            this.tmpB.multiplyMatrices(this.tmpA, part.localMatrix);
            mesh.setMatrixAt(k, this.tmpB);
            if (this.colors) mesh.setColorAt(k, new THREE.Color().fromArray(this.colors, list[k] * 3));
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          this.farChunks.push({ mesh, full: list.length });
          this.group.add(mesh);
        });
      }
    }

    // detailed levels: pools around the camera
    cfg.asset.levels.forEach((parts, li) => {
      const inner = li === 0 ? new THREE.Vector2(-2, -1) : new THREE.Vector2(cfg.levelDist[li - 1] - band, cfg.levelDist[li - 1]);
      const fade = new THREE.Vector4(inner.x, inner.y, cfg.levelDist[li] - band, cfg.levelDist[li]);
      this.levelFades.push(fade);
      const capacity = 64;
      const meshes = parts.map((part, pi) => {
        // levels that cast no shadow take the row-shade stand-in like the far mesh (see farRowShade)
        const mesh = new THREE.InstancedMesh(
          this.clipIds ? part.geometry.clone() : part.geometry,
          this.makeMaterial(part.material, fade, false, !cfg.castShadow[li]),
          capacity
        );
        this.attachClipIds(mesh, capacity);
        mesh.name = `${cfg.name}_lod${li}_${pi}`;
        mesh.castShadow = cfg.castShadow[li];
        mesh.receiveShadow = true;
        if (cfg.castShadow[li]) mesh.customDepthMaterial = makeVegDepthMaterial(part.material, fade, undefined, cfg.clip);
        mesh.count = 0;
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
        this.group.add(mesh);
        return mesh;
      });
      this.pools.push({ meshes, parts, capacity });
    });
    return this.group;
  }

  /** Distance of the outermost detailed level (after quality scaling). */
  public get detailRange(): number {
    return this.cfg.levelDist[this.cfg.levelDist.length - 1];
  }

  /** Quality setting: scales every LOD hand-over distance (the fade uniforms are shared with the depth materials). */
  public setDistanceScale(k: number): void {
    const band = this.cfg.band;
    const d = this.cfg.levelDist;
    for (let i = 0; i < d.length; i++) d[i] = this.baseDist[i] * k;
    this.levelFades.forEach((f, li) => f.set(li === 0 ? -2 : d[li - 1] - band, li === 0 ? -1 : d[li - 1], d[li] - band, d[li]));
    if (this.farFade) this.farFade.set(d[d.length - 1] - band, d[d.length - 1], 1e8, 2e8);
    this.lastFill.set(1e9, 1e9, 1e9);
  }

  /** Quality setting (low): distance cull of far chunks (cfg.farCullM) and thinning of far instances (cfg.farThinKeep). */
  public setFarLimits(limited: boolean): void {
    this.farLimited = limited;
    for (const c of this.farChunks) {
      c.mesh.count = limited && this.cfg.farThinKeep !== undefined ? Math.max(1, Math.round(c.full * this.cfg.farThinKeep)) : c.full;
      if (!limited) c.mesh.visible = true;
    }
    this.lastFill.set(1e9, 1e9, 1e9);
  }

  private cullFarChunks(cam: THREE.Vector3): void {
    const cull = this.cfg.farCullM;
    if (!this.farLimited || cull === undefined) return;
    for (const c of this.farChunks) {
      const bs = c.mesh.boundingSphere;
      if (!bs) throw new Error(`[vegetation] far chunk ${c.mesh.name} has no bounding sphere`);
      c.mesh.visible = bs.center.distanceTo(cam) - bs.radius < cull;
    }
  }

  /** Quality setting: with `full` = false only the nearest level casts shadows (far meshes and LOD1 stop casting). */
  public setShadowDetail(full: boolean): void {
    this.shadowFull = full;
    this.applyShadowFlags();
  }

  private applyShadowFlags(): void {
    this.pools.forEach((pool, li) => {
      for (const mesh of pool.meshes) mesh.castShadow = this.cfg.castShadow[li] && (this.shadowFull || li === 0);
    });
    for (const child of this.group.children) {
      if (child.name.startsWith(`${this.cfg.name}_far_`)) child.castShadow = this.cfg.farCastShadow && this.shadowFull;
    }
  }

  private cellIndex(x: number, z: number): number {
    const gx = Math.min(this.cellDim - 1, Math.max(0, Math.floor((x + this.half) / CELL_M)));
    const gz = Math.min(this.cellDim - 1, Math.max(0, Math.floor((z + this.half) / CELL_M)));
    return gz * this.cellDim + gx;
  }

  private growPool(li: number, needed: number): void {
    const pool = this.pools[li];
    const capacity = Math.ceil(needed * 1.4) + 32;
    pool.meshes = pool.meshes.map((old) => {
      const mesh = new THREE.InstancedMesh(old.geometry, old.material, capacity);
      this.attachClipIds(mesh, capacity);
      mesh.name = old.name;
      mesh.castShadow = old.castShadow;
      mesh.receiveShadow = old.receiveShadow;
      mesh.customDepthMaterial = old.customDepthMaterial;
      mesh.count = 0;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      this.group.remove(old);
      old.dispose();
      this.group.add(mesh);
      return mesh;
    });
    pool.capacity = capacity;
  }

  /** Re-fills the detailed pools when the camera moved far enough. Cheap: touches only nearby hash cells. */
  public update(cam: THREE.Vector3): void {
    if (!this.built || this.count === 0 || this.pools.length === 0) return;
    const step = Math.max(3, this.cfg.band * 0.6);
    if (cam.distanceToSquared(this.lastFill) < step * step) return;
    this.lastFill.copy(cam);
    this.cullFarChunks(cam);
    const { cfg } = this;
    const dists = cfg.levelDist;
    const reach = dists[dists.length - 1] + step + 1;
    const picked: number[][] = this.pools.map(() => []);
    const m = this.matrices;
    if (Math.abs(cam.y) < 5000) {
      const gx0 = Math.max(0, Math.floor((cam.x - reach + this.half) / CELL_M));
      const gx1 = Math.min(this.cellDim - 1, Math.floor((cam.x + reach + this.half) / CELL_M));
      const gz0 = Math.max(0, Math.floor((cam.z - reach + this.half) / CELL_M));
      const gz1 = Math.min(this.cellDim - 1, Math.floor((cam.z + reach + this.half) / CELL_M));
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const c = gz * this.cellDim + gx;
          for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
            const i = this.cellItems[k];
            const dx = m[i * 16 + 12] - cam.x;
            const dy = m[i * 16 + 13] - cam.y;
            const dz = m[i * 16 + 14] - cam.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            for (let li = 0; li < dists.length; li++) {
              const lower = li === 0 ? -1 : dists[li - 1] - cfg.band - step;
              if (d >= lower && d <= dists[li] + step) picked[li].push(i);
            }
          }
        }
      }
    }
    for (let li = 0; li < this.pools.length; li++) {
      const list = picked[li];
      if (list.length > this.pools[li].capacity) this.growPool(li, list.length);
      const pool = this.pools[li];
      pool.meshes.forEach((mesh, pi) => {
        const local = pool.parts[pi].localMatrix;
        for (let k = 0; k < list.length; k++) {
          this.tmpA.fromArray(m, list[k] * 16);
          this.tmpB.multiplyMatrices(this.tmpA, local);
          this.tmpB.toArray(mesh.instanceMatrix.array as Float32Array, k * 16);
        }
        if (this.colors) {
          if (!mesh.instanceColor) {
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 3).fill(1), 3);
          }
          const arr = mesh.instanceColor.array as Float32Array;
          for (let k = 0; k < list.length; k++) {
            arr[k * 3] = this.colors[list[k] * 3];
            arr[k * 3 + 1] = this.colors[list[k] * 3 + 1];
            arr[k * 3 + 2] = this.colors[list[k] * 3 + 2];
          }
          mesh.instanceColor.needsUpdate = true;
        }
        if (this.clipIds) {
          const attr = mesh.geometry.getAttribute('aVegClipId') as THREE.InstancedBufferAttribute;
          const arr = attr.array as Float32Array;
          for (let k = 0; k < list.length; k++) arr[k] = this.clipIds[list[k]];
          attr.needsUpdate = true;
        }
        mesh.count = list.length;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.boundingSphere!.center.copy(cam);
        mesh.boundingSphere!.radius = dists[li] + step + this.objRadius;
      });
    }
  }
}

// =====================================================================================================
// Ground carpets: lane floors of the vineyards and the floors of the crop fields.
// They re-use the terrain's own 4 m grid cells (same vertices, same diagonal), lifted a few centimetres, so
// they hug the rendered surface exactly - a rigid tile per bay would cut through every bump of the terrain.
// The texture is projected along the parcel's row direction, so lanes / drill rows line up with the plants.
// =====================================================================================================

let claimedFloorCells: Uint8Array | null = null;

export async function loadFloorMaterial(
  url: string,
  nodePrefix: string,
  maxAnisotropy: number,
  opts: {
    /** Tramlines (pairs of sprayer wheel tracks every 24 m across the rows): strength 0..1 and metres per texture repeat across. */
    tramlines?: { strength: number; tileAcrossM: number };
    /** The carpet ends this many metres inside the parcel outline (grass headland of a vineyard). */
    insetM?: number;
    /** Darken the floor beyond the range of real row shadows (vegUniforms.uVegFloorFar). */
    farShade?: boolean;
    /**
     * Crops without a far mesh: beyond the last plant LOD (baseM, scaled by quality) only the carpet is left, so it
     * takes the mean tone the plant cards add near the camera (measured: floor+plants / floor alone), from straight
     * above (`color`) to a grazing view where the plants hide the soil (`grazing`), blended by the view elevation.
     */
    farTint?: { color: THREE.Color; grazing: THREE.Color; baseM: number };
    /**
     * Combine passes on a harvested field: bands of `widthM` along the rows, each a little lighter or darker (chaff
     * and straw spread unevenly) with a brighter straw line down its middle; strength 0..1. Needs the texture repeat
     * (tileAlongM / tileAcrossM) to turn the carpet UVs back into metres.
     */
    swaths?: { strength: number; widthM: number; tileAlongM: number; tileAcrossM: number };
  } = {}
): Promise<THREE.MeshStandardMaterial> {
  const tramlines = opts.tramlines;
  const scene = await loadVegGltf(url, maxAnisotropy);
  const node = scene.getObjectByName(`${nodePrefix}_FLOOR`);
  if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`[vegetation] ${url} has no floor carrier mesh "${nodePrefix}_FLOOR" (rebuild the GLB)`);
  }
  const mat = node.material.clone();
  mat.name = node.material.name;
  if (!mat.map) throw new Error(`[vegetation] floor material of "${nodePrefix}" has no albedo map`);
  for (const tex of [mat.map, mat.normalMap]) {
    if (!tex) continue;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, maxAnisotropy);
  }
  mat.vertexColors = true;
  mat.envMapIntensity = 0.5;
  // sits just above the terrain but below road surfaces / decals (those use stronger offsets)
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -2;
  // aVegFloorEdge = signed distance (m) to the parcel outline / nearest excluded cell: cut the carpet exactly there
  const tram = { value: new THREE.Vector2(tramlines?.strength ?? 0, tramlines?.tileAcrossM ?? 1) };
  const edgeCfg = { value: new THREE.Vector2(opts.insetM ?? 0, opts.farShade ? 1 : 0) };
  const farTint = { value: new THREE.Vector4(1, 1, 1, 1e8) };
  const farTintGraze = { value: new THREE.Vector3(1, 1, 1) };
  if (opts.farTint) {
    farTint.value.set(opts.farTint.color.r, opts.farTint.color.g, opts.farTint.color.b, opts.farTint.baseM * vegQuality.lod);
    farTintGraze.value.set(opts.farTint.grazing.r, opts.farTint.grazing.g, opts.farTint.grazing.b);
    floorFarTints.push({ uniform: farTint.value, baseM: opts.farTint.baseM });
  }
  const swath = { value: new THREE.Vector4(opts.swaths?.strength ?? 0, opts.swaths?.widthM ?? 1, opts.swaths?.tileAlongM ?? 1, opts.swaths?.tileAcrossM ?? 1) };
  if (opts.swaths && !(opts.swaths.widthM > 0 && opts.swaths.tileAlongM > 0 && opts.swaths.tileAcrossM > 0)) {
    throw new Error(`[vegetation] floor "${nodePrefix}": swath width / tile sizes must be positive`);
  }
  mat.customProgramCacheKey = () => 'veg-floor-carpet';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVegFloorTram = tram;
    shader.uniforms.uVegFloorEdgeCfg = edgeCfg;
    shader.uniforms.uVegFloorFar = vegUniforms.uVegFloorFar;
    shader.uniforms.uVegFloorTint = farTint;
    shader.uniforms.uVegFloorTintGraze = farTintGraze;
    shader.uniforms.uVegFloorSwath = swath;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aVegFloorEdge;\nvarying float vVegFloorEdge;\nvarying float vVegFloorAcross;\nvarying float vVegFloorAlong;\nvarying float vVegFloorUp;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvVegFloorEdge = aVegFloorEdge;\nvVegFloorAcross = uv.y;\nvVegFloorAlong = uv.x;\nvVegFloorUp = abs( normalize( cameraPosition - ( modelMatrix * vec4( transformed, 1.0 ) ).xyz ).y );'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vVegFloorEdge;\nvarying float vVegFloorAcross;\nvarying float vVegFloorAlong;\nuniform vec2 uVegFloorTram;\nuniform vec2 uVegFloorEdgeCfg;\nuniform vec3 uVegFloorFar;\nuniform vec4 uVegFloorTint;\nuniform vec3 uVegFloorTintGraze;\nuniform vec4 uVegFloorSwath;\nvarying float vVegFloorUp;'
      )
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( vVegFloorEdge < uVegFloorEdgeCfg.x ) discard;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if ( uVegFloorSwath.x > 0.0 ) {
          // combine passes: per-pass tone (hash of the pass index), slowly varying along the pass, straw line in the middle
          float vegAcrossM = vVegFloorAcross * uVegFloorSwath.w;
          float vegAlongM = vVegFloorAlong * uVegFloorSwath.z;
          float vegPass = floor( vegAcrossM / uVegFloorSwath.y );
          float vegR = fract( sin( vegPass * 12.9898 + 4.1 ) * 43758.5453 );
          float vegR2 = fract( sin( vegPass * 78.233 + 1.7 ) * 24634.6345 );
          float vegAlongMod = 0.55 + 0.45 * sin( vegAlongM / ( 29.0 + 23.0 * vegR2 ) + vegR * 6.2832 );
          float vegInPass = abs( fract( vegAcrossM / uVegFloorSwath.y ) - 0.5 ) * uVegFloorSwath.y;
          float vegStraw = 1.0 - smoothstep( 0.35, 1.1, vegInPass );
          diffuseColor.rgb *= 1.0 + uVegFloorSwath.x * ( ( vegR - 0.5 ) * 0.9 * vegAlongMod + 0.32 * vegStraw * ( 0.4 + 0.6 * vegR2 ) - 0.06 );
        }
        if ( uVegFloorTram.x > 0.0 ) {
          // sprayer tramlines: two wheel tracks 1.8 m apart, repeated every 24 m across the drill rows
          float vegAcross = vVegFloorAcross * uVegFloorTram.y;
          float vegT = abs( fract( vegAcross / 24.0 ) - 0.5 ) * 24.0;
          float vegLine = 1.0 - smoothstep( 0.16, 0.42, abs( vegT - 0.9 ) );
          diffuseColor.rgb *= 1.0 - 0.34 * uVegFloorTram.x * vegLine;
        }
        if ( uVegFloorEdgeCfg.y > 0.5 ) {
          diffuseColor.rgb *= mix( 1.0, uVegFloorFar.x, smoothstep( uVegFloorFar.y, uVegFloorFar.z, length( vViewPosition ) ) );
        }
        float vegUp2 = vVegFloorUp * vVegFloorUp;
        vec3 vegFarTint = mix( uVegFloorTintGraze, uVegFloorTint.rgb, vegUp2 * vegUp2 );
        diffuseColor.rgb *= mix( vec3( 1.0 ), vegFarTint, smoothstep( uVegFloorTint.w - 8.0, uVegFloorTint.w, length( vViewPosition ) ) );`
      );
  };
  return mat;
}

function hash2(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 with the given cell size (metres). */
export function valueNoise(x: number, z: number, cellM: number): number {
  const fx = x / cellM;
  const fz = z / cellM;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * Signed clearance (m, capped at maxR) from (x, z) to the nearest blocked spot of an occupancy grid; negative inside.
 * Carpets interpolate this over the terrain grid, which gives straight edges along roads instead of 4 m steps.
 */
export function clearanceTo(isBlocked: (x: number, z: number) => boolean, x: number, z: number, maxR = 4): number {
  if (isBlocked(x, z)) return -1.5;
  let any = false;
  for (let a = 0; a < 8 && !any; a++) {
    const c = Math.cos(a * 0.7854);
    const sn = Math.sin(a * 0.7854);
    any = isBlocked(x + c * maxR, z + sn * maxR) || isBlocked(x + c * maxR * 0.5, z + sn * maxR * 0.5);
  }
  if (!any) return maxR;
  let best = maxR * maxR;
  for (let dz = -maxR; dz <= maxR; dz++) {
    for (let dx = -maxR; dx <= maxR; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 < best && isBlocked(x + dx, z + dz)) best = d2;
    }
  }
  // grid cells are 2 m: the blocked area starts about one metre before the blocked sample
  return Math.max(0.05, Math.sqrt(best) - 1.0);
}

interface FloorBucket {
  positions: number[];
  uvs: number[];
  colors: number[];
  edges: number[];
  indices: number[];
}

export class FloorCarpetBuilder {
  private readonly terrain: TerrainSystem;
  private readonly segs: number;
  private readonly cell: number;
  private readonly half: number;
  private readonly chunkCells: number;
  private readonly buckets = new Map<string, FloorBucket>();
  public cellCount = 0;

  constructor(terrain: TerrainSystem, chunkM: number) {
    this.terrain = terrain;
    // must mirror the terrain mesh resolution (TerrainSystem builds PlaneGeometry with this many segments)
    this.segs = Math.min(512, Math.max(128, terrain.gridSize - 1));
    this.cell = terrain.mapSizeM / this.segs;
    this.half = terrain.halfSizeM;
    this.chunkCells = Math.max(1, Math.round(chunkM / this.cell));
    if (!claimedFloorCells || claimedFloorCells.length !== this.segs * this.segs) {
      claimedFloorCells = new Uint8Array(this.segs * this.segs);
    }
  }

  /**
   * Carpets every free terrain cell whose centre lies inside `poly`.
   * (dirX, dirZ) = row direction; one texture repeat covers tileU metres along and tileV metres across the rows.
   */
  public addParcel(
    materialKey: string,
    poly: [number, number][],
    dirX: number,
    dirZ: number,
    tileU: number,
    tileV: number,
    uOffset: number,
    vOffset: number,
    color: THREE.Color,
    /** true where the carpet may NOT lie (roads, buildings, other landuse) */
    isBlocked: (x: number, z: number) => boolean,
    /** 0..1: strength of the cloud-like tonal variation (soil moisture, growth) baked into the vertex colours. */
    variation = 0.0,
    /**
     * Irregular patches of another tone (volunteer weeds greening a stubble field, damp soil): `cover` = share of the
     * parcel (0..1), `cellM` = patch size, `tint` multiplies the parcel colour inside the patches.
     */
    patches?: { tint: THREE.Color; cover: number; cellM: number }
  ): void {
    const claimed = claimedFloorCells!;
    const perpX = -dirZ;
    const perpZ = dirX;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const ix0 = Math.max(1, Math.floor((minX + this.half) / this.cell));
    const ix1 = Math.min(this.segs - 2, Math.floor((maxX + this.half) / this.cell));
    const iz0 = Math.max(1, Math.floor((minZ + this.half) / this.cell));
    const iz1 = Math.min(this.segs - 2, Math.floor((maxZ + this.half) / this.cell));
    const lift = 0.04;
    // signed edge distance at every grid node of the bounding box: > 0 inside the parcel and not excluded
    const nx = ix1 - ix0 + 2;
    const nz = iz1 - iz0 + 2;
    const edge = new Float32Array(nx * nz);
    for (let jz = 0; jz < nz; jz++) {
      for (let jx = 0; jx < nx; jx++) {
        const wx = -this.half + (ix0 + jx) * this.cell;
        const wz = -this.half + (iz0 + jz) * this.cell;
        const d = Math.min(4, Math.sqrt(distanceToPolygonEdgesSq(wx, wz, poly)));
        edge[jz * nx + jx] = pointInPolygon(wx, wz, poly) ? Math.min(d, clearanceTo(isBlocked, wx, wz)) : -d;
      }
    }
    const nodeVertex = new Map<string, number>();
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cellId = iz * this.segs + ix;
        if (claimed[cellId]) continue;
        const e0 = edge[(iz - iz0) * nx + (ix - ix0)];
        const e1 = edge[(iz - iz0 + 1) * nx + (ix - ix0)];
        const e2 = edge[(iz - iz0 + 1) * nx + (ix - ix0 + 1)];
        const e3 = edge[(iz - iz0) * nx + (ix - ix0 + 1)];
        if (e0 <= 0 && e1 <= 0 && e2 <= 0 && e3 <= 0) continue;
        // only cells that lie completely inside are exclusive; boundary cells may be shared with the neighbour parcel
        if (e0 > 0 && e1 > 0 && e2 > 0 && e3 > 0) claimed[cellId] = 1;
        this.cellCount++;
        const chunkKey = `${materialKey}|${Math.floor(ix / this.chunkCells)}|${Math.floor(iz / this.chunkCells)}`;
        let bucket = this.buckets.get(chunkKey);
        if (!bucket) this.buckets.set(chunkKey, (bucket = { positions: [], uvs: [], colors: [], edges: [], indices: [] }));
        const corner = (gx: number, gz: number): number => {
          const key = `${chunkKey}|${gx}|${gz}`;
          let vi = nodeVertex.get(key);
          if (vi === undefined) {
            const wx = -this.half + gx * this.cell;
            const wz = -this.half + gz * this.cell;
            vi = bucket!.positions.length / 3;
            bucket!.positions.push(wx, this.terrain.getTerrainHeight(wx, wz) + lift, wz);
            bucket!.uvs.push((wx * dirX + wz * dirZ) / tileU + uOffset, (wx * perpX + wz * perpZ) / tileV + vOffset);
            let tone = 1.0;
            if (variation > 0) {
              // three octaves (110 m, 34 m, 9 m): large fields must not read as one flat colour from the drone
              const nz = valueNoise(wx, wz, 110) * 0.5 + valueNoise(wx + 311, wz - 97, 34) * 0.32 + valueNoise(wx - 53, wz + 211, 9) * 0.18;
              tone = 1.0 + (nz - 0.5) * 2.0 * variation;
            }
            let pr = 1;
            let pg = 1;
            let pb = 1;
            if (patches) {
              const pn = valueNoise(wx - 701, wz + 433, patches.cellM) * 0.7 + valueNoise(wx + 97, wz - 389, patches.cellM * 0.37) * 0.3;
              const w = THREE.MathUtils.smoothstep(pn, 1 - patches.cover - 0.06, 1 - patches.cover + 0.06);
              pr = 1 + (patches.tint.r - 1) * w;
              pg = 1 + (patches.tint.g - 1) * w;
              pb = 1 + (patches.tint.b - 1) * w;
            }
            bucket!.colors.push(color.r * tone * pr, color.g * tone * pg, color.b * (tone * 0.96 + 0.04) * pb);
            bucket!.edges.push(edge[(gz - iz0) * nx + (gx - ix0)]);
            nodeVertex.set(key, vi);
          }
          return vi;
        };
        // same split as the terrain's PlaneGeometry: (NW, SW, NE) + (SW, SE, NE)
        const nw = corner(ix, iz);
        const sw = corner(ix, iz + 1);
        const se = corner(ix + 1, iz + 1);
        const ne = corner(ix + 1, iz);
        bucket.indices.push(nw, sw, ne, sw, se, ne);
      }
    }
  }

  public build(name: string, materials: Record<string, THREE.Material>): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, b] of this.buckets) {
      const matKey = key.split('|')[0];
      const material = materials[matKey];
      if (!material) throw new Error(`[vegetation] no floor material registered for "${matKey}"`);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
      geo.setAttribute('aVegFloorEdge', new THREE.Float32BufferAttribute(b.edges, 1));
      geo.setIndex(b.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.indices, 1) : new THREE.Uint16BufferAttribute(b.indices, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `${name}_${key.replace(/\|/g, '_')}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

const vegLayers: InstancedLodLayer[] = [];
let lastLodFrame = -1;

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
/** LOD distance multiplier, ground-cover density (0 = off) and ground-cover view-distance multiplier per quality level. */
/** farLimits: far chunks / floor chunks beyond their cull distance are dropped and far trees are thinned (low only). */
const VEG_QUALITY: Record<QualityLevel, { lod: number; coverDensity: number; coverReach: number; farShadows: boolean; farLimits: boolean }> = {
  low: { lod: 0.42, coverDensity: 0, coverReach: 0.6, farShadows: false, farLimits: true },
  medium: { lod: 0.72, coverDensity: 0.55, coverReach: 0.8, farShadows: true, farLimits: false },
  high: { lod: 1.0, coverDensity: 1.0, coverReach: 1.0, farShadows: true, farLimits: false },
  ultra: { lod: 1.25, coverDensity: 1.0, coverReach: 1.25, farShadows: true, farLimits: false },
};

/** Static ground carpets (vineyard / field floors) dropped beyond a distance on low quality; the terrain's aerial shows instead. */
const floorCulls: { mesh: THREE.Mesh; cullM: number }[] = [];
const floorCullCam = new THREE.Vector3(1e9, 1e9, 1e9);

export function registerFloorCull(group: THREE.Group, cullM: number): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    if (!mesh.geometry.boundingSphere) throw new Error(`[vegetation] floor chunk ${mesh.name} has no bounding sphere`);
    floorCulls.push({ mesh, cullM });
  }
  floorCullCam.set(1e9, 1e9, 1e9);
}

function updateFloorCulls(cam: THREE.Vector3): void {
  if (cam.distanceToSquared(floorCullCam) < 64) return;
  floorCullCam.copy(cam);
  for (const f of floorCulls) {
    const bs = f.mesh.geometry.boundingSphere!;
    f.mesh.visible = !vegQuality.farLimits || bs.center.distanceTo(cam) - bs.radius < f.cullM;
  }
}
let vegQuality = VEG_QUALITY.high;
const floorFarTints: { uniform: THREE.Vector4; baseM: number }[] = [];
let vineFloorShadeBase = 34;

export function registerVegLayer(layer: InstancedLodLayer): void {
  layer.setDistanceScale(vegQuality.lod);
  layer.setShadowDetail(vegQuality.farShadows);
  layer.setFarLimits(vegQuality.farLimits);
  vegLayers.push(layer);
}

/** Quality contract (FIXROUND.md): called through sceneryRes.setQuality / fieldsRes.setQuality. Idempotent. */
export function setVegetationQuality(level: QualityLevel): void {
  const q = VEG_QUALITY[level];
  if (!q) throw new Error(`[vegetation] unknown quality level "${String(level)}"`);
  vegQuality = q;
  for (const layer of vegLayers) {
    layer.setDistanceScale(q.lod);
    layer.setShadowDetail(q.farShadows);
    layer.setFarLimits(q.farLimits);
  }
  floorCullCam.set(1e9, 1e9, 1e9);
  for (const t of floorFarTints) t.uniform.w = t.baseM * q.lod;
  for (const cover of groundCovers) cover.setQuality(q.coverDensity, q.coverReach);
  const d = vineFloorShadeBase * q.lod;
  vegUniforms.uVegFloorFar.value.y = d * 0.72;
  vegUniforms.uVegFloorFar.value.z = d;
}

let sunLight: THREE.DirectionalLight | null = null;
const sunDir = new THREE.Vector3();

/** Stand-in for row shadows on far vineyard floors, from the current sun elevation (see uVegFloorFar). */
function updateSunDependentShading(scene: THREE.Object3D): void {
  if (!sunLight || !sunLight.parent) {
    sunLight = null;
    scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (l.isDirectionalLight && (!sunLight || l.intensity > sunLight.intensity)) sunLight = l;
    });
  }
  let shade = 1.0;
  const sun = sunLight as THREE.DirectionalLight | null;
  if (sun) {
    sunDir.copy(sun.position).sub(sun.target.position).normalize();
    const elev = Math.asin(THREE.MathUtils.clamp(sunDir.y, 0.03, 1));
    // share of the lane floor that lies in the shadow of 1.9 m rows standing 2 m apart (rows at ~45 deg to the sun on average)
    const shadowed = THREE.MathUtils.clamp(0.3 + (0.7 * (1.9 / Math.tan(elev)) * 0.7) / 2.0, 0.3, 0.95);
    shade = 1.0 - shadowed * 0.5 * vegUniforms.uVegDay.value;
  }
  vegUniforms.uVegFloorFar.value.x = shade;
}

/** Updates the camera uniform and all LOD pools; safe to call several times per frame. */
export function updateVegetationLod(camera: THREE.Camera, frame: number, scene?: THREE.Object3D): void {
  if (frame === lastLodFrame) return;
  lastLodFrame = frame;
  if (scene) updateSunDependentShading(scene);
  const e = camera.matrixWorld.elements;
  vegUniforms.uVegCamPos.value.set(e[12], e[13], e[14]);
  for (const layer of vegLayers) layer.update(vegUniforms.uVegCamPos.value);
  updateFloorCulls(vegUniforms.uVegCamPos.value);
  for (const cover of groundCovers) cover.update(vegUniforms.uVegCamPos.value);
}

/**
 * Invisible always-rendered mesh whose onBeforeRender drives the LOD update with the camera that is
 * actually rendering, so no wiring in main.ts is needed (pools lag the camera by at most one frame).
 */
function createLodDriver(): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const driver = new THREE.Mesh(geo, mat);
  driver.name = 'VegetationLodDriver';
  driver.frustumCulled = false;
  driver.renderOrder = -1000;
  driver.onBeforeRender = (renderer, _scene, camera) => {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    if (camera.parent && (camera.parent as THREE.Object3D).type === 'CubeCamera') return;
    if (renderer.getRenderTarget() !== null && camera.parent?.type === 'CubeCamera') return;
    updateVegetationLod(camera, renderer.info.render.frame, _scene);
  };
  return driver;
}

export interface LoadedPropPrototype {
  parts: SubMeshPart[];
  size: THREE.Vector3;
  minY: number;
}

export function extractPropPrototype(sceneRoot: THREE.Object3D): LoadedPropPrototype {
  sceneRoot.updateMatrixWorld(true);
  const rootInv = sceneRoot.matrixWorld.clone().invert();
  const parts: SubMeshPart[] = [];
  const bbox = new THREE.Box3();
  sceneRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
    if (Array.isArray(obj.material)) throw new Error(`[scenery] prop mesh "${obj.name}" has multiple materials`);
    const localMatrix = new THREE.Matrix4().multiplyMatrices(rootInv, obj.matrixWorld);
    parts.push({ geometry: obj.geometry, material: obj.material, localMatrix });
    const gBox = new THREE.Box3().setFromBufferAttribute(obj.geometry.attributes.position as THREE.BufferAttribute);
    gBox.applyMatrix4(localMatrix);
    bbox.union(gBox);
  });
  const size = new THREE.Vector3(1, 1, 1);
  let minY = 0;
  if (!bbox.isEmpty()) {
    bbox.getSize(size);
    minY = bbox.min.y;
  }
  return { parts, size, minY };
}

export function createInstancedPropGroup(
  name: string,
  proto: LoadedPropPrototype,
  matrices: THREE.Matrix4[],
  options?: { castShadow?: boolean; receiveShadow?: boolean }
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  if (matrices.length === 0 || proto.parts.length === 0) return group;
  const tmpMat = new THREE.Matrix4();
  for (let p = 0; p < proto.parts.length; p++) {
    const part = proto.parts[p];
    const inst = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    inst.name = `${name}_part${p}`;
    inst.castShadow = options?.castShadow ?? true;
    inst.receiveShadow = options?.receiveShadow ?? true;
    for (let i = 0; i < matrices.length; i++) {
      tmpMat.multiplyMatrices(matrices[i], part.localMatrix);
      inst.setMatrixAt(i, tmpMat);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}

function propEntry(manifest: VillageManifest | null, key: string): VillagePropEntry {
  const entry = manifest?.props?.[key];
  if (!entry) throw new Error(`[scenery] village manifest has no prop "${key}" (run blender/village/build_props.py)`);
  if (typeof entry === 'string') return { glbPath: entry };
  if (!entry.glbPath) throw new Error(`[scenery] prop "${key}" has no glbPath in the village manifest`);
  return entry;
}

// =====================================================================================================
// Detected vegetation (data/osm/vegetation_layout.json, written by scripts/detect_vegetation.py from the
// 0.2 m aerial; contract: .gfx/VEGETATION_LAYOUT_SCHEMA.md). Required runtime data: fail loudly.
// =====================================================================================================

export interface VegLayoutTree {
  x: number;
  z: number;
  crownRadiusM: number;
  heightM: number;
  kind: 'broadleaf' | 'conifer' | 'fruit' | 'poplar';
  zone: string;
  conf: number;
  hue: number;
}
export interface VegLayoutHedge {
  points: [number, number][];
  widthM: number;
  heightM: number;
  kind: 'clipped' | 'wild';
  conf: number;
}
export interface VegLayoutShrub {
  x: number;
  z: number;
  radiusM: number;
  heightM: number;
  conf: number;
}
export type RoughPatchKind = 'tall_grass' | 'garden_bed' | 'ruderal' | 'reed' | 'lawn';
export interface VegLayoutPatch {
  polygon: [number, number][];
  kind: RoughPatchKind;
}
export interface VegetationLayout {
  trees: VegLayoutTree[];
  hedges: VegLayoutHedge[];
  shrubs: VegLayoutShrub[];
  roughPatches: VegLayoutPatch[];
}

const VEG_LAYOUT_PATH = 'data/osm/vegetation_layout.json';
const TREE_KINDS = ['broadleaf', 'conifer', 'fruit', 'poplar'];
const PATCH_KINDS: RoughPatchKind[] = ['tall_grass', 'garden_bed', 'ruderal', 'reed', 'lawn'];

/**
 * Landmark solids (walls, raised church terrace, estate buildings) from the shared colliders file, read only.
 * Detected trees / hedges / shrubs inside them would stand buried in a terrace or grow through a wall.
 */
interface LandmarkSolid {
  pts: [number, number][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

async function loadLandmarkSolids(): Promise<LandmarkSolid[]> {
  const url = resolveAssetUrl(LANDMARK_COLLIDERS_URL);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`[scenery] network error while loading ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`[scenery] ${url} answered HTTP ${res.status} (landmark colliders are required to keep vegetation out of landmark solids)`);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    throw new Error(`[scenery] ${url} is not valid JSON: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`[scenery] ${url}: expected an object keyed by landmark`);
  const solids: LandmarkSolid[] = [];
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'note' || key === 'notes' || key === 'comment') continue;
    const list = (entry as { solids?: unknown })?.solids;
    if (!Array.isArray(list)) throw new Error(`[scenery] ${url}: landmark "${key}" has no solids array`);
    for (const poly of list) {
      const ok = Array.isArray(poly) && poly.length >= 3 && poly.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (!ok) throw new Error(`[scenery] ${url}: landmark "${key}" has a malformed solid polygon`);
      const pts = (poly as number[][]).map((p) => [p[0], p[1]] as [number, number]);
      solids.push({
        pts,
        minX: Math.min(...pts.map((p) => p[0])),
        maxX: Math.max(...pts.map((p) => p[0])),
        minZ: Math.min(...pts.map((p) => p[1])),
        maxZ: Math.max(...pts.map((p) => p[1])),
      });
    }
  }
  if (solids.length === 0) throw new Error(`[scenery] ${url} contains no landmark solids`);
  return solids;
}

/** True when (x, z) lies inside a landmark solid or within `padM` of its outline. */
function inLandmarkSolid(solids: LandmarkSolid[], x: number, z: number, padM: number): boolean {
  for (const s of solids) {
    if (x < s.minX - padM || x > s.maxX + padM || z < s.minZ - padM || z > s.maxZ + padM) continue;
    if (pointInPolygon(x, z, s.pts) || distanceToPolygonEdgesSq(x, z, s.pts) < padM * padM) return true;
  }
  return false;
}

async function loadVegetationLayout(): Promise<VegetationLayout> {
  // `?vegLayout=<url>` loads another layout file with the same schema (used to test new detections / assets)
  const override = new URLSearchParams(window.location.search).get('vegLayout');
  const url = override ? resolveAssetUrl(override) : resolveAssetUrl(VEG_LAYOUT_PATH);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`[scenery] network error while loading ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`[scenery] ${url} answered HTTP ${res.status} - run scripts/detect_vegetation.py (required runtime data)`);
  const text = await res.text();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`[scenery] ${url} is not valid JSON (starts with "${text.slice(0, 40).replace(/\s+/g, ' ')}")`);
  }
  const fail = (what: string): never => {
    throw new Error(`[scenery] ${VEG_LAYOUT_PATH} is malformed: ${what} (see .gfx/VEGETATION_LAYOUT_SCHEMA.md)`);
  };
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const pts = (v: unknown, min: number): v is [number, number][] =>
    Array.isArray(v) && v.length >= min && v.every((p) => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]));
  for (const key of ['trees', 'hedges', 'shrubs', 'roughPatches']) {
    if (!Array.isArray(raw[key])) fail(`"${key}" is not an array`);
  }
  const trees = raw.trees as VegLayoutTree[];
  trees.forEach((t, i) => {
    if (!t || !num(t.x) || !num(t.z) || !num(t.crownRadiusM) || !num(t.heightM) || !num(t.conf) || !num(t.hue) || !TREE_KINDS.includes(t.kind)) {
      fail(`trees[${i}] = ${JSON.stringify(t)?.slice(0, 160)}`);
    }
  });
  const hedges = raw.hedges as VegLayoutHedge[];
  hedges.forEach((h, i) => {
    if (!h || !pts(h.points, 2) || !num(h.widthM) || !num(h.heightM) || !num(h.conf) || (h.kind !== 'clipped' && h.kind !== 'wild')) {
      fail(`hedges[${i}] = ${JSON.stringify(h)?.slice(0, 160)}`);
    }
  });
  const shrubs = raw.shrubs as VegLayoutShrub[];
  shrubs.forEach((b, i) => {
    if (!b || !num(b.x) || !num(b.z) || !num(b.radiusM) || !num(b.heightM) || !num(b.conf)) fail(`shrubs[${i}] = ${JSON.stringify(b)?.slice(0, 160)}`);
  });
  const roughPatches = raw.roughPatches as VegLayoutPatch[];
  roughPatches.forEach((r, i) => {
    if (!r || !pts(r.polygon, 3) || !PATCH_KINDS.includes(r.kind)) fail(`roughPatches[${i}] = ${JSON.stringify(r)?.slice(0, 160)}`);
  });
  return { trees, hedges, shrubs, roughPatches };
}

// =====================================================================================================
// Ground cover: grass tufts, weeds, wildflowers and reeds instanced only around the camera.
// Tufts are generated deterministically per 12 m tile from the terrain's ground-material map
// (data/terrain/ground_splat.png: grass / dry grass weights), the detected rough patches, road verges
// and the creek; never on roads, paving, buildings or inside crop / vineyard parcels (those have carpets).
// Every tuft has its own view distance and shrinks into the ground beyond it - no pop, no dither.
// =====================================================================================================

const COVER_NODES = ['gc_grass', 'gc_tall', 'gc_weed', 'gc_flower', 'gc_reed'] as const;
const COVER_TALL = 1;
const COVER_FLOWER = 3;
const COVER_REED = 4;
const COVER_TILE_M = 12;
const COVER_STEP_M = 0.6;
const COVER_REACH_MIN = 20;
const COVER_REACH_MAX = 62;
const COVER_STRIDE = 11; // x, y, z, yaw, scaleXZ, scaleY, reach, r, g, b, density selector

const AUX_VERGE = 1;
const AUX_CREEK = 2;
const AUX_PARCEL = 4;

const pendingCover: { exclude: [number, number][][]; patches: { poly: [number, number][]; kind: RoughPatchKind }[] } = { exclude: [], patches: [] };

/** Crop parcels with their own carpet (called by src/fields.ts): no ground cover is generated inside. */
export function excludeGroundCover(poly: [number, number][]): void {
  pendingCover.exclude.push(poly);
}

/** Areas that should carry dense ground cover of one kind (meadow parcels, detected rough patches). */
export function addGroundCoverPatch(poly: [number, number][], kind: RoughPatchKind): void {
  pendingCover.patches.push({ poly, kind });
}

async function loadGroundSplat(): Promise<{ n: number; grass: Uint8Array; dry: Uint8Array }> {
  // canonical lossless map (the terrain shader reads the same file); raw channel values, no colour management
  const url = resolveAssetUrl('data/terrain/ground_splat.png');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[scenery] ${url} answered HTTP ${res.status} (ground material map, needed for the ground cover)`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (bmp.width !== bmp.height * 2) throw new Error(`[scenery] ${url} is ${bmp.width}x${bmp.height}; expected two square maps side by side`);
  const n = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('[scenery] 2D canvas context unavailable for reading the ground material map');
  ctx.drawImage(bmp, 0, 0, n, n, 0, 0, n, n); // left half: R = grass, G = dry grass / stubble, B = soil
  bmp.close();
  const data = ctx.getImageData(0, 0, n, n).data;
  const grass = new Uint8Array(n * n);
  const dry = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    grass[i] = data[i * 4];
    dry[i] = data[i * 4 + 1];
  }
  canvas.width = canvas.height = 1;
  return { n, grass, dry };
}

interface CoverTile {
  /** per cover kind: packed instances (COVER_STRIDE floats each) */
  kinds: Float32Array[];
  cx: number;
  cz: number;
}

class GroundCoverSystem {
  public readonly group = new THREE.Group();
  private readonly terrain: TerrainSystem;
  private readonly exclusion: ExclusionGrid;
  private readonly aux: ExclusionGrid;
  private readonly patchGrid: ExclusionGrid;
  private readonly splat: { n: number; grass: Uint8Array; dry: Uint8Array };
  private readonly tiles = new Map<number, CoverTile>();
  private readonly pools: { mesh: THREE.InstancedMesh; capacity: number; reach: THREE.InstancedBufferAttribute }[] = [];
  private readonly lastFill = new THREE.Vector3(1e9, 1e9, 1e9);
  private finalized = false;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  public instanceCount = 0;

  constructor(
    terrain: TerrainSystem,
    parts: SubMeshPart[],
    splat: { n: number; grass: Uint8Array; dry: Uint8Array },
    exclusion: ExclusionGrid,
    sceneData: SceneData,
    vineyards: LanduseRecord[],
    private readonly carriageway: CarriagewayIndex
  ) {
    this.terrain = terrain;
    this.exclusion = exclusion;
    this.splat = splat;
    this.group.name = 'GroundCover';
    this.aux = new ExclusionGrid(terrain.mapSizeM);
    this.patchGrid = new ExclusionGrid(terrain.mapSizeM);
    for (const r of sceneData.roads) {
      if (!r.points || r.points.length < 2) continue;
      const hw = r.highway || '';
      const w = r.widthM ?? (hw === 'primary' || hw === 'secondary' ? 6.4 : hw === 'track' ? 3.0 : 4.8);
      this.aux.markPolyline(r.points.map(extractRoadXZ), w * 0.5 + 3.4, AUX_VERGE);
    }
    for (const ww of sceneData.waterways ?? []) {
      if (!ww.points || ww.points.length < 2) continue;
      this.aux.markPolyline(ww.points.map(extractRoadXZ), (ww.widthM ?? 1.8) * 0.5 + 2.6, AUX_CREEK);
    }
    for (const vy of vineyards) this.aux.markPolygon(vy.points, 0.5, AUX_PARCEL);

    parts.forEach((part, kind) => {
      const mat = part.material.clone();
      mat.name = part.material.name;
      patchVegMaterial(mat, {
        foliage: true,
        wind: new THREE.Vector3(kind === COVER_REED ? 0.16 : 0.05, 0.012, kind === COVER_REED ? 1.9 : kind === COVER_TALL || kind === COVER_FLOWER ? 0.8 : 0.35),
        translucency: new THREE.Color(0.8, 0.8, 0.3),
        instanceReach: true,
      });
      const capacity = 256;
      const geometry = part.geometry.clone();
      const reach = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      geometry.setAttribute('aVegReach', reach);
      const mesh = new THREE.InstancedMesh(geometry, mat, capacity);
      mesh.name = `GroundCover_${COVER_NODES[kind]}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      this.group.add(mesh);
      this.pools.push({ mesh, capacity, reach });
    });
  }

  /** Parcels / patches registered by other modules arrive while the scene is still being built. */
  private finalize(): void {
    this.finalized = true;
    for (const poly of pendingCover.exclude) this.aux.markPolygon(poly, 0.3, AUX_PARCEL);
    for (const { poly, kind } of pendingCover.patches) this.patchGrid.markPolygon(poly, 0, 1 << PATCH_KINDS.indexOf(kind));
  }

  private tile(tx: number, tz: number): CoverTile {
    const key = (tx + 512) * 4096 + (tz + 512);
    let tile = this.tiles.get(key);
    if (tile) return tile;
    const rnd = mulberry32((Math.imul(tx, 73856093) ^ Math.imul(tz, 19349663)) >>> 0);
    const lists: number[][] = COVER_NODES.map(() => []);
    const { n, grass, dry } = this.splat;
    const half = this.terrain.halfSizeM;
    const pxPerM = n / this.terrain.mapSizeM;
    const x0 = tx * COVER_TILE_M;
    const z0 = tz * COVER_TILE_M;
    const steps = Math.round(COVER_TILE_M / COVER_STEP_M);
    for (let j = 0; j < steps; j++) {
      for (let i = 0; i < steps; i++) {
        const x = x0 + (i + rnd()) * COVER_STEP_M;
        const z = z0 + (j + rnd()) * COVER_STEP_M;
        const pick = rnd();
        const kindRoll = rnd();
        const r1 = rnd();
        const r2 = rnd();
        const r3 = rnd();
        if (Math.abs(x) > half - 2 || Math.abs(z) > half - 2) continue;
        if (this.exclusion.isBlocked(x, z, FLAG_BUILDING | FLAG_ROAD)) continue;
        if (!this.carriageway.isClear(x, z, COVER_CLEAR_M)) continue;
        // crop / vineyard parcels carry their own carpet - except the strip along roads and tracks (the field margin)
        const margin = this.aux.isBlocked(x, z, AUX_VERGE);
        if (!margin && this.aux.isBlocked(x, z, AUX_PARCEL)) continue;
        const px = Math.min(n - 1, Math.max(0, Math.floor((x + half) * pxPerM)));
        const pz = Math.min(n - 1, Math.max(0, Math.floor((z + half) * pxPerM)));
        const g = grass[pz * n + px] / 255;
        const d = dry[pz * n + px] / 255;
        const green = g + d;
        const patch = this.patchGrid.isBlocked(x, z, 31) ? this.patchBits(x, z) : 0;
        const creek = this.aux.isBlocked(x, z, AUX_CREEK) && green > 0.25;
        const verge = margin && green > 0.4;
        if (!patch && !creek && !verge && green < 0.55) continue;
        // density + species mix per ground class
        let density: number;
        let mix: [number, number, number, number, number]; // grass, tall, weed, flower, reed
        if (patch & 8) {
          density = 1.0;
          mix = [0.05, 0.2, 0, 0, 0.75];
        } else if (creek) {
          density = 0.8;
          mix = [0.1, 0.4, 0.05, 0.05, 0.4];
        } else if (patch & 1) {
          density = 1.0;
          mix = [0.2, 0.62, 0.04, 0.14, 0];
        } else if (patch & 4) {
          density = 0.9;
          mix = [0.15, 0.38, 0.35, 0.12, 0];
        } else if (patch & 2) {
          density = 0.75;
          mix = [0.3, 0.05, 0.2, 0.45, 0];
        } else if (patch & 16) {
          density = 0.16;
          mix = [0.86, 0, 0.1, 0.04, 0];
        } else if (verge) {
          density = 0.85;
          mix = [0.3, 0.42, 0.1, 0.18, 0];
        } else {
          density = 0.3 + 0.4 * green;
          mix = d > g ? [0.6, 0.3, 0.07, 0.03, 0] : [0.74, 0.1, 0.1, 0.06, 0];
        }
        if (pick > density) continue;
        let kind = 0;
        let acc = mix[0];
        while (kindRoll > acc && kind < 4) acc += mix[++kind];
        const tallish = kind === COVER_TALL || kind === COVER_REED || kind === COVER_FLOWER;
        const reach = (COVER_REACH_MIN + (COVER_REACH_MAX - COVER_REACH_MIN) * r1 * r1) * (tallish ? 1.25 : 1.0);
        const dryness = d / (green + 1e-3);
        const v = 1.04 + 0.3 * r2;
        const sc = 0.7 + 0.75 * r3;
        lists[kind].push(
          x, this.terrain.getRenderedSurfaceHeight(x, z), z,
          r2 * Math.PI * 2, sc, sc * (0.85 + 0.3 * r1), reach,
          v * (1 + 0.3 * dryness), v * (1 + 0.14 * dryness), v * (1 - 0.25 * dryness),
          (r1 * 7.31 + r3 * 3.17) % 1
        );
      }
    }
    tile = { kinds: lists.map((l) => new Float32Array(l)), cx: x0 + COVER_TILE_M * 0.5, cz: z0 + COVER_TILE_M * 0.5 };
    this.tiles.set(key, tile);
    return tile;
  }

  private density = 1;
  private reachScale = 1;

  public setQuality(density: number, reachScale: number): void {
    this.density = density;
    this.reachScale = reachScale;
    this.lastFill.set(1e9, 1e9, 1e9);
  }

  private patchBits(x: number, z: number): number {
    let bits = 0;
    for (let b = 0; b < 5; b++) if (this.patchGrid.isBlocked(x, z, 1 << b)) bits |= 1 << b;
    return bits;
  }

  private grow(kind: number, needed: number): void {
    const pool = this.pools[kind];
    const capacity = Math.ceil(needed * 1.35) + 64;
    const old = pool.mesh;
    const reach = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    old.geometry.setAttribute('aVegReach', reach);
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, capacity);
    mesh.name = old.name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    pool.mesh = mesh;
    pool.capacity = capacity;
    pool.reach = reach;
  }

  public update(cam: THREE.Vector3): void {
    if (cam.distanceToSquared(this.lastFill) < 2.5 * 2.5) return;
    if (!this.finalized) this.finalize();
    this.lastFill.copy(cam);
    const rs = this.reachScale;
    const dens = this.density;
    const maxReach = COVER_REACH_MAX * 1.25 * rs;
    const agl = cam.y - this.terrain.getTerrainHeight(cam.x, cam.z);
    const lists: CoverTile[] = [];
    if (dens > 0 && agl < 95 && Math.abs(cam.x) < this.terrain.halfSizeM + maxReach && Math.abs(cam.z) < this.terrain.halfSizeM + maxReach) {
      const t0x = Math.floor((cam.x - maxReach) / COVER_TILE_M);
      const t1x = Math.floor((cam.x + maxReach) / COVER_TILE_M);
      const t0z = Math.floor((cam.z - maxReach) / COVER_TILE_M);
      const t1z = Math.floor((cam.z + maxReach) / COVER_TILE_M);
      const lim = maxReach + COVER_TILE_M * 0.75;
      for (let tz = t0z; tz <= t1z; tz++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          const cx = (tx + 0.5) * COVER_TILE_M - cam.x;
          const cz = (tz + 0.5) * COVER_TILE_M - cam.z;
          if (cx * cx + cz * cz > lim * lim) continue;
          lists.push(this.tile(tx, tz));
        }
      }
    }
    this.instanceCount = 0;
    for (let kind = 0; kind < this.pools.length; kind++) {
      // first pass: count, second pass: write (pool may have to grow)
      let count = 0;
      for (const t of lists) {
        const a = t.kinds[kind];
        for (let o = 0; o < a.length; o += COVER_STRIDE) {
          const dx = a[o] - cam.x;
          const dy = a[o + 1] - cam.y;
          const dz = a[o + 2] - cam.z;
          if (a[o + 10] <= dens && dx * dx + dy * dy + dz * dz < (a[o + 6] * rs + 2.5) * (a[o + 6] * rs + 2.5)) count++;
        }
      }
      if (count > this.pools[kind].capacity) this.grow(kind, count);
      const pool = this.pools[kind];
      const mArr = pool.mesh.instanceMatrix.array as Float32Array;
      const cArr = pool.mesh.instanceColor!.array as Float32Array;
      const rArr = pool.reach.array as Float32Array;
      let k = 0;
      for (const t of lists) {
        const a = t.kinds[kind];
        for (let o = 0; o < a.length; o += COVER_STRIDE) {
          const dx = a[o] - cam.x;
          const dy = a[o + 1] - cam.y;
          const dz = a[o + 2] - cam.z;
          if (a[o + 10] > dens || dx * dx + dy * dy + dz * dz >= (a[o + 6] * rs + 2.5) * (a[o + 6] * rs + 2.5)) continue;
          this.tmpQ.setFromAxisAngle(this.up, a[o + 3]);
          this.tmpM.compose(this.tmpP.set(a[o], a[o + 1], a[o + 2]), this.tmpQ, this.tmpS.set(a[o + 4], a[o + 5], a[o + 4]));
          this.tmpM.toArray(mArr, k * 16);
          cArr[k * 3] = a[o + 7];
          cArr[k * 3 + 1] = a[o + 8];
          cArr[k * 3 + 2] = a[o + 9];
          rArr[k] = a[o + 6] * rs;
          k++;
        }
      }
      pool.mesh.count = k;
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.mesh.instanceColor!.needsUpdate = true;
      pool.reach.needsUpdate = true;
      pool.mesh.boundingSphere!.center.copy(cam);
      pool.mesh.boundingSphere!.radius = maxReach + 6;
      this.instanceCount += k;
    }
    if (this.tiles.size > 900) {
      for (const [key, t] of this.tiles) {
        if ((t.cx - cam.x) ** 2 + (t.cz - cam.z) ** 2 > 220 * 220) this.tiles.delete(key);
      }
    }
  }
}

const groundCovers: GroundCoverSystem[] = [];

export type TimeOfDayName = 'morning' | 'noon' | 'golden' | 'dusk';

export interface SceneryStats {
  vineInstances: number;
  treeInstances: number;
  lampInstances: number;
  ortsschildCount: number;
  hayBaleInstances: number;
  barrelInstances: number;
  /** Trees taken from the aerial detection (data/osm/vegetation_layout.json). */
  detectedTrees: number;
  hedgeBays: number;
  /** detected trees / shrubs / hedge bays dropped because their footprint reached onto a carriageway */
  vegOffCarriageway: number;
  /** static vegetation instances verified to keep off every carriageway (the check throws on any offender) */
  carriagewayCheckedInstances: number;
  shrubInstances: number;
}

export interface SceneryResult {
  group: THREE.Group;
  stats: SceneryStats;
  vineyardShowcasePoint: [number, number] | null;
  hauptstrasseShowcasePoint: [number, number] | null;
  feldwegShowcasePoint: [number, number] | null;
  /** Time-of-day contract (BRIEF.md): street lamps glow with nightFactor. */
  setTimeOfDay: (preset: TimeOfDayName, nightFactor: number) => void;
  /** Quality contract (FIXROUND.md): LOD distances, ground-cover density and radius. */
  setQuality: (level: QualityLevel) => void;
}

/**
 * Half width (m) of the carriageway the NPC lane graph drives on, per OSM way - the classes and formulas of
 * classify() / halfRoad in src/trafficNetwork.ts, each taken at its widest: primary / secondary 4.05 m covers the
 * rural 3.6 m and the urban Hauptstrasse that src/roads.ts centres between its kerbs up to ~1.5 m off the OSM line.
 * null for ways the lane graph does not use (paths, footways, steps). Keep in step with trafficNetwork.ts.
 */
function carriagewayHalfM(r: RoadRecord): number | null {
  const hw = (r.highway || '').toLowerCase();
  const surf = (r.surface || '').toLowerCase();
  const w0 = r.widthM && r.widthM > 1 ? r.widthM : 0;
  if (hw === 'primary' || hw === 'primary_link' || hw === 'trunk' || hw === 'secondary' || hw === 'secondary_link') return 4.05;
  if (hw === 'tertiary' || hw === 'tertiary_link' || hw === 'unclassified' || hw === 'road') return Math.min(8, Math.max(4, w0 || 5.8)) * 0.5 - 0.2;
  if (hw === 'residential' || hw === 'living_street') return Math.min(7.5, Math.max(3.8, w0 || 5.0)) * 0.5;
  const pavedTrack = hw === 'track' && (surf === 'paved' || surf === 'asphalt' || surf === 'concrete');
  if (hw === 'service' || pavedTrack) return Math.min(6, Math.max(2.4, w0 || 3.4)) * 0.5 - 0.1;
  if (hw === 'track') return Math.min(4, Math.max(2.6, w0 || 3.2)) * 0.5;
  return null;
}

/**
 * Carriageways of every road the traffic lane graph uses (cars and farm vehicles), for keeping vegetation off them.
 * The cell grid only knows segments within CarriagewayIndex.MAX_QUERY_M of a cell, so queries are limited to that.
 */
class CarriagewayIndex {
  static readonly MAX_QUERY_M = 12;
  private static readonly CELL_M = 16;
  private readonly seg: number[] = []; // ax, az, bx, bz, half, roadIndex
  private readonly cells = new Map<number, number[]>();
  private readonly names: string[] = [];

  constructor(roads: RoadRecord[]) {
    const C = CarriagewayIndex.CELL_M;
    roads.forEach((r, ri) => {
      if (!r.points || r.points.length < 2) return;
      const half = carriagewayHalfM(r);
      if (half === null) return;
      this.names[ri] = `${r.highway}${r.ref ? ' ' + r.ref : ''}${r.name && r.name !== r.ref ? ' "' + r.name + '"' : ''} (id ${r.id})`;
      const pts = r.points.map(extractRoadXZ);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const id = this.seg.length / 6;
        this.seg.push(ax, az, bx, bz, half, ri);
        const reach = half + CarriagewayIndex.MAX_QUERY_M;
        for (let cz = Math.floor((Math.min(az, bz) - reach) / C); cz <= Math.floor((Math.max(az, bz) + reach) / C); cz++) {
          for (let cx = Math.floor((Math.min(ax, bx) - reach) / C); cx <= Math.floor((Math.max(ax, bx) + reach) / C); cx++) {
            const k = (cx + 4096) * 8192 + (cz + 4096);
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, (list = []));
            list.push(id);
          }
        }
      }
    });
    if (this.seg.length === 0) throw new Error('[scenery] no road of the traffic lane graph found in the scene data (carriageway index empty)');
  }

  /** Nearest carriageway: signed distance from its edge (negative = on it), or null when none is within reach. */
  public nearest(x: number, z: number): { clear: number; road: string } | null {
    const C = CarriagewayIndex.CELL_M;
    const list = this.cells.get((Math.floor(x / C) + 4096) * 8192 + (Math.floor(z / C) + 4096));
    if (!list) return null;
    let best = Infinity;
    let bestRoad = -1;
    const s = this.seg;
    for (const id of list) {
      const o = id * 6;
      const dx = s[o + 2] - s[o];
      const dz = s[o + 3] - s[o + 1];
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - s[o]) * dx + (z - s[o + 1]) * dz) / l2)) : 0;
      const c = Math.hypot(x - s[o] - t * dx, z - s[o + 1] - t * dz) - s[o + 4];
      if (c < best) {
        best = c;
        bestRoad = s[o + 5];
      }
    }
    return bestRoad < 0 ? null : { clear: best, road: this.names[bestRoad] };
  }

  /** True when a disc of radius r around (x, z) keeps off every carriageway. */
  public isClear(x: number, z: number, r: number): boolean {
    if (!(r >= 0 && r <= CarriagewayIndex.MAX_QUERY_M)) throw new Error(`[scenery] carriageway query radius ${r} m outside 0..${CarriagewayIndex.MAX_QUERY_M}`);
    const n = this.nearest(x, z);
    return n === null || n.clear >= r;
  }
}

/** Trunk + bark clearance: no tree trunk closer than this to a carriageway edge. */
const TRUNK_CLEAR_M = 0.8;
/** Vine bay (posts, canopy) half width. */
const VINE_ROW_CLEAR_M = 0.6;
/** Share of a conifer's crown radius whose low boughs must keep off a carriageway. */
const CONIFER_BOUGH_CLEAR = 0.6;
/** Ground cover tufts never stand on a carriageway. */
const COVER_CLEAR_M = 0.25;

function buildExclusionGrid(mapSizeM: number, buildings: BuildingRecord[], roads: RoadRecord[]): ExclusionGrid {
  const grid = new ExclusionGrid(mapSizeM);
  for (const b of buildings) {
    if (b.footprint && b.footprint.length >= 3) {
      grid.markPolygon(b.footprint, 2.2, FLAG_BUILDING);
    } else if (b.center) {
      grid.markCircle(b.center[0], b.center[1], Math.max(b.widthM ?? 8, b.depthM ?? 8) * 0.6 + 2.0, FLAG_BUILDING);
    }
  }
  for (const r of roads) {
    if (!r.points || r.points.length < 2) continue;
    const pts: [number, number][] = r.points.map(extractRoadXZ);
    const hw = r.highway || '';
    const w = r.widthM ?? (hw === 'primary' || hw === 'secondary' ? 6.4 : hw === 'track' ? 3.0 : 4.8);
    const pad = hw === 'track' || hw === 'path' ? 0.85 : 1.05;
    grid.markPolyline(pts, w * 0.5 + pad, FLAG_ROAD);
  }
  for (const poly of RECREATION_EXCLUSION_POLYS) {
    grid.markPolygon(poly, 1.5, FLAG_BUILDING);
  }
  return grid;
}

type TreeSpecies = 'tree_deciduous' | 'tree_orchard' | 'tree_riparian' | 'tree_poplar' | 'tree_garden';
const TREE_SPECIES: TreeSpecies[] = ['tree_deciduous', 'tree_orchard', 'tree_riparian', 'tree_poplar', 'tree_garden'];
const HEDGE_KINDS = ['hedge_thuja', 'hedge_laurel', 'hedge_privet', 'hedge_hornbeam'] as const;
const SHRUB_KINDS = ['shrub_round', 'shrub_fine', 'shrub_pink', 'shrub_white'] as const;
const CONIFER_KINDS = ['conifer_spruce', 'conifer_thuja', 'conifer_pine'] as const;
/**
 * Albedo correction per conifer kind (same order). The spruce atlas tiles average sRGB (31, 54, 37): with the bough
 * AO baked into the vertex colours the crowns rendered near-black navy even at noon (review). Linear factors that
 * bring it to a dark spruce green (about sRGB 45, 74, 41) and warm it slightly; thuja and pine atlases are in range.
 */
const CONIFER_ALBEDO = [new THREE.Color(2.25, 1.9, 1.2), new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1)];
/** Detections below this confidence are ignored. */
const MIN_DETECTION_CONF = 0.25;

/**
 * Hand-kept clear zones agreed with the village builder: no trees, shrubs or barrels inside (x0, z0, x1, z1).
 * Weingut Kreutzenberger: gravel beds with cypresses in front of the rebuilt facade (see WEINGUT_CYPRESSES).
 */
const KEEP_CLEAR_RECTS: [number, number, number, number][] = [[472.5, -220.5, 491.5, -212.0]];
const inKeepClear = (x: number, z: number): boolean => KEEP_CLEAR_RECTS.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
/** Columnar cypresses in the Weingut Kreutzenberger gravel beds (x, z, height m); clear of the door (x 487.3) and the info board (x 485). */
const WEINGUT_CYPRESSES: [number, number, number][] = [
  [475.2, -214.8, 3.6],
  [477.4, -215.2, 3.2],
  [486.1, -217.2, 3.4],
  [488.5, -217.7, 3.3],
  [489.8, -218.0, 3.7],
];
const WEINGUT_DOOR_X = 487.3;
const WEINGUT_BOARD_X = 485.0;

const VINE_BAY_M = 6.0;
const VINE_ROW_SPACING_M = 2.0;

/** Peak brightening factor of a street-lamp light pool at night: the lit surface reaches up to 1 + gain times its own colour. */
const LAMP_POOL_GAIN = 5;

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[scenery] 2D canvas context unavailable for the lamp glow texture');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,240,205,0.62)');
  g.addColorStop(0.5, 'rgba(255,214,150,0.16)');
  g.addColorStop(1, 'rgba(255,200,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function buildSceneryAndProps(
  sceneData: SceneData,
  villageManifest: VillageManifest | null,
  landmarks: Map<string, LoadedLandmarkInfo>,
  terrain: TerrainSystem,
  maxAnisotropy: number,
  references?: BraveReferenceEntry[]
): Promise<SceneryResult> {
  const group = new THREE.Group();
  group.name = 'KindenheimScenery';
  group.add(createLodDriver());

  const stats: SceneryStats = {
    vineInstances: 0,
    treeInstances: 0,
    lampInstances: 0,
    ortsschildCount: 0,
    hayBaleInstances: 0,
    barrelInstances: 0,
    detectedTrees: 0,
    hedgeBays: 0,
    vegOffCarriageway: 0,
    carriagewayCheckedInstances: 0,
    shrubInstances: 0,
  };

  const loadSimpleProp = async (key: string): Promise<LoadedPropPrototype> => {
    const entry = propEntry(villageManifest, key);
    return extractPropPrototype(await loadVegGltf(entry.glbPath!, maxAnisotropy));
  };
  const loadTree = async (key: TreeSpecies): Promise<{ asset: LodAsset; heightM: number; crownM: number }> => {
    const entry = propEntry(villageManifest, key);
    const asset = await loadLodAsset(entry.glbPath!, entry.nodePrefix ?? key, ['LOD0', 'LOD1'], 'LOD2', maxAnisotropy);
    return { asset, heightM: entry.heightM ?? asset.maxY, crownM: entry.crownRadius?.[0] ?? asset.size.x * 0.5 };
  };
  // Garden assets come in unit sizes (glTF extras `unitM`) and are scaled to every detection
  interface GardenAsset {
    asset: LodAsset;
    unit: number[];
    lodDist: number[];
  }
  const loadUnitAsset = async (url: string, prefix: string, unitFallback?: number[]): Promise<GardenAsset> => {
    const nodes = await listLodNodes(url, prefix, maxAnisotropy);
    if (!nodes.includes('LOD0') || !nodes.includes('FAR')) throw new Error(`[scenery] ${url} lacks "${prefix}_LOD0" / "${prefix}_FAR" (rebuild the garden assets)`);
    const levels = ['LOD0', 'LOD1'].filter((n) => nodes.includes(n));
    const asset = await loadLodAsset(url, prefix, levels, 'FAR', maxAnisotropy);
    const unit = (asset.meta.unitM as number[] | undefined) ?? unitFallback;
    const lodDist = asset.meta.lodDist as number[] | undefined;
    if (!Array.isArray(unit) || !Array.isArray(lodDist) || lodDist.length !== levels.length) {
      throw new Error(`[scenery] node "${prefix}_LOD0" in ${url} lacks the unitM / lodDist extras`);
    }
    return { asset, unit, lodDist };
  };
  const gardenUrl = propEntry(villageManifest, 'garden').glbPath!;
  const coverUrl = propEntry(villageManifest, 'groundcover').glbPath!;
  const vineEntry = propEntry(villageManifest, 'vine_row');

  // lane carpet: stops 1 m inside the parcel (grass headland), darkens where the rows no longer cast real shadows
  const vineFloorMaterial = await loadFloorMaterial(vineEntry.glbPath!, vineEntry.nodePrefix ?? 'vine_row', maxAnisotropy, { insetM: 2.2, farShade: true }); // = row headland: the inter-row floor ends with the rows (no tan ladder of floor strips beyond the row ends along oblique tracks)
  const [vineAsset, ortsschildProto, lampProto, hayProto, barrelProto, ...treeAssets] = await Promise.all([
    loadLodAsset(vineEntry.glbPath!, vineEntry.nodePrefix ?? 'vine_row', ['LOD0', 'LOD1'], 'FAR', maxAnisotropy),
    loadSimpleProp('ortsschild'),
    loadSimpleProp('streetlamp'),
    loadSimpleProp('hay_bale'),
    loadSimpleProp('wine_barrel'),
    ...TREE_SPECIES.map(loadTree),
  ]);
  const trees = Object.fromEntries(TREE_SPECIES.map((k, i) => [k, treeAssets[i]])) as Record<TreeSpecies, { asset: LodAsset; heightM: number; crownM: number }>;
  const [layout, splat, coverScene, hedgeAssets, shrubAssets, coniferAssets, wildHedge, landmarkSolids] = await Promise.all([
    loadVegetationLayout(),
    loadGroundSplat(),
    loadVegGltf(coverUrl, maxAnisotropy),
    Promise.all(HEDGE_KINDS.map((k) => loadUnitAsset(gardenUrl, k))),
    Promise.all(SHRUB_KINDS.map((k) => loadUnitAsset(gardenUrl, k))),
    Promise.all(CONIFER_KINDS.map((k) => loadUnitAsset(gardenUrl, k))),
    // field hedgerow bay built by blender/fields/build_fields.py (5 m long, 1.8 m wide, 2.4 m tall)
    loadUnitAsset(resolveAssetUrl('assets/models/fields/props/hedgerow_bay.glb'), 'hedgerow_bay', [5.0, 1.8, 2.4]),
    loadLandmarkSolids(),
  ]);
  /** Detected vegetation never stands in a landmark solid (church terrace, walls, estate buildings) or touches it. */
  const inLandmark = (x: number, z: number, padM: number): boolean => inLandmarkSolid(landmarkSolids, x, z, padM);

  const exclusion = buildExclusionGrid(terrain.mapSizeM, sceneData.buildings, sceneData.roads);
  // The exclusion grid only tests a point (the instance centre) against OSM-width road bands; the carriageway index
  // uses the lane-graph widths and every placement tests its whole footprint (a shrub with a 1.5 m radius stood
  // 3.45 m off the K 26 centre line, its crown on the carriageway - cars drove through it).
  const carriageway = new CarriagewayIndex(sceneData.roads);
  /** Footprint discs (x, z, radius) per instance of every static vegetation layer, for the final carriageway check. */
  const footprintChecks: { layer: InstancedLodLayer; discs: (e: Float32Array) => [number, number, number][] }[] = [];
  const hScale = (e: Float32Array, col: 0 | 2): number => (col === 0 ? Math.hypot(e[0], e[2]) : Math.hypot(e[8], e[10]));
  /** Bay along its local X (unit length lenM, unit width wM): centre and both ends with the half width. */
  const bayDiscs = (lenM: number, wM: number) => (e: Float32Array): [number, number, number][] => {
    const hx = e[0] * lenM * 0.5;
    const hz = e[2] * lenM * 0.5;
    const r = hScale(e, 2) * wM * 0.5;
    return [[e[12] - hx, e[14] - hz, r], [e[12], e[14], r], [e[12] + hx, e[14] + hz, r]];
  };
  // Keep Street View camera positions free of random trees / lamps right in front of the lens
  const svCamPoints: [number, number][] = (references ?? [])
    .filter((r) => (r.cameraHeightM ?? 2.5) < 15 && typeof r.localX === 'number' && typeof r.localZ === 'number')
    .map((r) => [r.localX!, r.localZ!]);
  const isNearSvCamera = (x: number, z: number, radiusM = 4.6): boolean => {
    const r2 = radiusM * radiusM;
    for (const [cx, cz] of svCamPoints) {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  };
  const rand = mulberry32(496108);

  let villageMinX = Infinity;
  let villageMaxX = -Infinity;
  let villageMinZ = Infinity;
  let villageMaxZ = -Infinity;
  for (const b of sceneData.buildings) {
    if (!b.center) continue;
    const [bx, bz] = b.center;
    if (Math.hypot(bx, bz) < 550) {
      if (bx < villageMinX) villageMinX = bx;
      if (bx > villageMaxX) villageMaxX = bx;
      if (bz < villageMinZ) villageMinZ = bz;
      if (bz > villageMaxZ) villageMaxZ = bz;
    }
  }
  if (!Number.isFinite(villageMinX)) {
    throw new Error('[scenery] scene data contains no buildings near the village centre; cannot place street furniture');
  }

  // Props have Y=0 at ground contact with a short underground skirt; only shift down if a prop starts above Y=0.
  const groundOffset = (proto: { minY: number }): number => (proto.minY > 0.04 ? -proto.minY : 0);

  // ---------------------------------------------------------------------------
  // 1. VINEYARDS - real 2 m rows of 6 m trellis bays on every OSM vineyard polygon
  // ---------------------------------------------------------------------------
  let vineyardShowcasePoint: [number, number] | null = null;
  // Small roadside vineyard patches verified in Street View (Judenberg north embankment & Triftstrasse east slope)
  const extraVerifiedVineyards: LanduseRecord[] = [
    { id: 'sv_verified_judenberg_north', type: 'vineyard', areaHa: 0.14, rowAngleRad: 0.04, points: [[-382, -88], [-312, -84], [-312, -68], [-382, -70]] },
    { id: 'sv_verified_triftstrasse_east', type: 'vineyard', areaHa: 0.17, rowAngleRad: 0.14, points: [[-296, 118], [-264, 116], [-264, 168], [-294, 168]] },
  ];
  const vineyards = [
    ...sceneData.landuse.filter((lu) => lu.type === 'vineyard' && lu.points && lu.points.length >= 3),
    ...extraVerifiedVineyards,
  ];

  const vineLayer = new InstancedLodLayer({
    name: 'Vineyards',
    asset: vineAsset,
    levelDist: [34, 150],
    band: 3,
    chunkM: 256,
    mapSizeM: terrain.mapSizeM,
    // Only the nearest rows cast real shadows. Farther out the shadow cascades resolve 2 m rows in some places and
    // not in others (cascade rectangles around the camera focus), which showed as dark patches drifting over the
    // parcels. Beyond LOD0 rows, floor and tent get a uniform sun-dependent darkening instead (uVegFloorFar).
    castShadow: [true, false],
    farCastShadow: false,
    farRowShade: true,
    farCullM: 520,
    wind: new THREE.Vector3(0.0, 0.012, 2.0),
    translucency: new THREE.Color(1.15, 1.1, 0.42),
  });
  const vineFloors = new FloorCarpetBuilder(terrain, 256);
  const vineFloorTint = new THREE.Color(0.86, 0.86, 0.86);
  vineFloorShadeBase = 34;
  {
    const halfBound = terrain.halfSizeM - 6;
    const m4 = new THREE.Matrix4();
    let bestVineScore = -Infinity;
    for (const vy of vineyards) {
      const pts = vy.points;
      const rotY = typeof vy.rowAngleRad === 'number' && Number.isFinite(vy.rowAngleRad) ? vy.rowAngleRad : -estimateLongestEdgeAngle(pts);
      // data/meta.json convention: local +X maps to (cos r, -sin r) in world (x, z)
      const dirX = Math.cos(rotY);
      const dirZ = -Math.sin(rotY);
      const perpX = -dirZ;
      const perpZ = dirX;
      const us: number[] = [];
      const vs: number[] = [];
      let minV = Infinity;
      let maxV = -Infinity;
      for (const [x, z] of pts) {
        const u = x * dirX + z * dirZ;
        const v = x * perpX + z * perpZ;
        us.push(u);
        vs.push(v);
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      // lane carpet: rows sit on the global 2 m grid, the texture holds two rows (green lane / tilled lane) per repeat
      vineFloors.addParcel('vine', pts, dirX, dirZ, VINE_BAY_M, VINE_ROW_SPACING_M * 2, 0, 0, vineFloorTint, (x, z) => exclusion.isBlocked(x, z), 0.07);
      let added = 0;
      let sumX = 0;
      let sumZ = 0;
      let row = 0;
      // rows are anchored to a global grid so neighbouring parcels with the same direction line up
      const v0 = Math.ceil((minV + 1.2) / VINE_ROW_SPACING_M) * VINE_ROW_SPACING_M;
      for (let v = v0; v <= maxV - 1.2; v += VINE_ROW_SPACING_M, row++) {
        // intersections of the row line with the polygon outline
        const cross: number[] = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const va = vs[j];
          const vb = vs[i];
          if (va > v !== vb > v) cross.push(us[j] + ((v - va) / (vb - va)) * (us[i] - us[j]));
        }
        cross.sort((a, b) => a - b);
        const mirror = Math.round(v / VINE_ROW_SPACING_M) % 2 === 0 ? 1 : -1;
        for (let c = 0; c + 1 < cross.length; c += 2) {
          // rows are cut to length at the parcel boundary (grass headland of 2.2 m): the bays of a row are stretched /
          // squeezed a little so the row ends exactly there - no staircase of whole bays along oblique edges
          const headland = 2.2;
          const span = cross[c + 1] - cross[c] - headland * 2;
          if (span < 2.0) continue;
          const bays = Math.max(1, Math.round(span / VINE_BAY_M));
          const bayLen = span / bays;
          const halfBay = bayLen * 0.5;
          const start = cross[c] + headland + halfBay;
          for (let b = 0; b < bays; b++) {
            const uMid = start + b * bayLen;
            const cx = uMid * dirX + v * perpX;
            const cz = uMid * dirZ + v * perpZ;
            if (Math.abs(cx) > halfBound || Math.abs(cz) > halfBound) continue;
            if (exclusion.isBlocked(cx, cz)) continue;
            // a bay whose end reaches into a road / building is shortened to its free part (0.5 m steps, 0.6 m
            // clearance) instead of being dropped whole - rows then follow oblique roads instead of stepping by 6 m
            let freeA = halfBay;
            let freeB = halfBay;
            for (const side of [-1, 1]) {
              for (let d = 0.5; d <= halfBay + 1e-6; d += 0.5) {
                const dd = Math.min(d, halfBay);
                if (exclusion.isBlocked(cx + dirX * dd * side, cz + dirZ * dd * side)) {
                  const free = Math.max(0, dd - 1.1);
                  if (side < 0) freeA = free;
                  else freeB = free;
                  break;
                }
              }
            }
            const len = freeA + freeB;
            if (len < 1.6) continue;
            const u = uMid + (freeB - freeA) * 0.5;
            const half = len * 0.5;
            const bsx = len / VINE_BAY_M;
            const wx = u * dirX + v * perpX;
            const wz = u * dirZ + v * perpZ;
            const ax = wx - dirX * half;
            const az = wz - dirZ * half;
            const bx = wx + dirX * half;
            const bz = wz + dirZ * half;
            if (!carriageway.isClear(ax, az, VINE_ROW_CLEAR_M) || !carriageway.isClear(wx, wz, VINE_ROW_CLEAR_M) || !carriageway.isClear(bx, bz, VINE_ROW_CLEAR_M)) continue;
            const hA = terrain.getTerrainHeight(ax, az);
            const hB = terrain.getTerrainHeight(bx, bz);
            const hL = terrain.getTerrainHeight(wx - perpX, wz - perpZ);
            const hR = terrain.getTerrainHeight(wx + perpX, wz + perpZ);
            const slopeAlong = (hB - hA) / len;
            const slopeCross = (hR - hL) * 0.5;
            const sy = 0.93 + rand() * 0.15;
            // sheared basis: posts stay vertical, the bay follows the slope along and across the row
            m4.set(
              dirX * bsx, 0, perpX * mirror, wx,
              slopeAlong * bsx, sy, slopeCross * mirror, (hA + hB) * 0.5 + 0.02,
              dirZ * bsx, 0, perpZ * mirror, wz,
              0, 0, 0, 1
            );
            vineLayer.add(m4);
            added++;
            sumX += wx;
            sumZ += wz;
          }
        }
      }
      // Bookmark "Weinberge": a well filled parcel with a clear view back to the village
      if (added >= 55) {
        const popCx = sumX / added;
        const popCz = sumZ / added;
        const distToVillage = Math.hypot(popCx - 20, popCz + 80);
        if (distToVillage > 210 && distToVillage < 680) {
          const score = Math.min(added, 900) * 0.2 + (popCx > 200 ? 180 : 0) - Math.abs(distToVillage - 430) * 0.3;
          if (score > bestVineScore) {
            bestVineScore = score;
            vineyardShowcasePoint = [popCx, popCz];
          }
        }
      }
    }
    if (vineLayer.count === 0) throw new Error('[scenery] no vine bay could be placed although vineyards exist in the scene data');
    const vineFloorGroup = vineFloors.build('VineyardFloors', { vine: vineFloorMaterial });
    registerFloorCull(vineFloorGroup, 600);
    group.add(vineFloorGroup);
    group.add(vineLayer.build());
    registerVegLayer(vineLayer);
    stats.vineInstances = vineLayer.count;
  }

  // ---------------------------------------------------------------------------
  // 2. TREES (OSM trees + orchards + woods + roadside + Kinderbach belt), four species with LODs
  // ---------------------------------------------------------------------------
  const treeLayers = {} as Record<TreeSpecies, InstancedLodLayer>;
  footprintChecks.push({ layer: vineLayer, discs: (e) => bayDiscs(VINE_BAY_M, VINE_ROW_CLEAR_M * 2)(e).map(([x, z]) => [x, z, VINE_ROW_CLEAR_M]) });
  for (const key of TREE_SPECIES) {
    treeLayers[key] = new InstancedLodLayer({
      name: `Trees_${key}`,
      asset: trees[key].asset,
      levelDist: [50, 190],
      band: 2.5,
      chunkM: 1024,
      mapSizeM: terrain.mapSizeM,
      castShadow: [true, true],
      farCastShadow: true,
      farThinKeep: 0.55,
      wind: new THREE.Vector3(key === 'tree_poplar' ? 0.22 : 0.1, 0.02, trees[key].heightM),
      translucency: new THREE.Color(1.1, 1.05, 0.4),
    });
  }
  const makeGardenLayer = (name: string, g: GardenAsset, sway: number, heightM: number, farThinKeep?: number): InstancedLodLayer =>
    new InstancedLodLayer({
      name,
      asset: g.asset,
      levelDist: g.lodDist,
      band: 4,
      // garden far meshes are 6-60 triangles: one chunk per kind keeps the draw-call count down
      chunkM: terrain.mapSizeM,
      mapSizeM: terrain.mapSizeM,
      castShadow: g.lodDist.map(() => true),
      farCastShadow: true,
      farThinKeep,
      wind: new THREE.Vector3(sway, 0.008, heightM),
      translucency: new THREE.Color(0.9, 0.9, 0.35),
    });
  const coniferLayers = CONIFER_KINDS.map((k, i) => makeGardenLayer(`Conifers_${k}`, coniferAssets[i], 0.06, coniferAssets[i].unit[1], 0.6));
  for (const key of TREE_SPECIES) footprintChecks.push({ layer: treeLayers[key], discs: (e) => [[e[12], e[14], TRUNK_CLEAR_M]] });
  coniferLayers.forEach((layer, i) => {
    const unitR = coniferAssets[i].unit[0];
    footprintChecks.push({
      layer,
      discs: (e) => [[e[12], e[14], Math.max(TRUNK_CLEAR_M, unitR * Math.max(hScale(e, 0), hScale(e, 2)) * CONIFER_BOUGH_CLEAR)]],
    });
  });
  const dummy = new THREE.Object3D();
  const maxBound = terrain.halfSizeM - 16;
  const treeTint = new THREE.Color();
  let treeCount = 0;
  const TREE_BUDGET = 9000;

  // 2.0 Trees detected in the 0.2 m aerial: real position, crown radius, height and tone. They are placed first;
  //     every OSM / rule-based tree below is dropped when a detected crown stands within 4 m (prefer the detection).
  const detCells = new Map<number, number[]>();
  const detKey = (x: number, z: number): number => (Math.floor(x / 8) + 1024) * 4096 + (Math.floor(z / 8) + 1024);
  const nearDetected = (x: number, z: number, r: number): boolean => {
    for (let dz = -8; dz <= 8; dz += 8) {
      for (let dx = -8; dx <= 8; dx += 8) {
        const list = detCells.get(detKey(x + dx, z + dz));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) {
          if ((list[i] - x) * (list[i] - x) + (list[i + 1] - z) * (list[i + 1] - z) < r * r) return true;
        }
      }
    }
    return false;
  };
  {
    const detRand = mulberry32(77003);
    for (const t of layout.trees) {
      if (t.conf < MIN_DETECTION_CONF) continue;
      if (Math.abs(t.x) > maxBound || Math.abs(t.z) > maxBound) continue;
      if (inKeepClear(t.x, t.z)) continue;
      if (inLandmark(t.x, t.z, 0.5)) continue;
      const r1 = detRand();
      const r2 = detRand();
      const r3 = detRand();
      let hM = THREE.MathUtils.clamp(t.heightM, 2.2, 30);
      let crown = THREE.MathUtils.clamp(t.crownRadiusM, 0.7, 9);
      // A trunk right at a wall is either a false positive (roof moss, shadow) or a small tree trained against the
      // house: drop uncertain ones, keep confident ones small so no crown grows through a roof.
      if (exclusion.isBlocked(t.x, t.z, FLAG_BUILDING)) {
        if (t.conf < 0.6) continue;
        crown = Math.min(crown, 1.7);
        hM = Math.min(hM, 5.5);
      } else {
        let hits = 0;
        for (let a = 0; a < 8; a++) {
          if (exclusion.isBlocked(t.x + Math.cos(a * 0.785) * crown * 0.85, t.z + Math.sin(a * 0.785) * crown * 0.85, FLAG_BUILDING)) hits++;
        }
        if (hits >= 4) crown *= 0.6;
        else if (hits >= 2) crown *= 0.8;
      }
      // trunk off the carriageway (conifers: their low boughs are checked below with the final crown size)
      if (!carriageway.isClear(t.x, t.z, TRUNK_CLEAR_M)) {
        stats.vegOffCarriageway++;
        continue;
      }
      let layer: InstancedLodLayer;
      let nativeH: number;
      let nativeR: number;
      let coniferIdx = -1;
      if (t.kind === 'conifer') {
        const slim = crown / hM;
        const ci = slim < 0.2 && hM < 9 ? 1 : hM > 9 && r1 < 0.3 ? 2 : 0;
        coniferIdx = ci;
        layer = coniferLayers[ci];
        nativeR = coniferAssets[ci].unit[0];
        nativeH = coniferAssets[ci].unit[1];
      } else {
        let species: TreeSpecies;
        if (t.kind === 'fruit') species = 'tree_orchard';
        else if (t.kind === 'poplar') species = 'tree_poplar';
        else if (t.zone === 'creek') species = r1 < 0.85 ? 'tree_riparian' : 'tree_deciduous';
        else if (hM < 7.5) species = r1 < 0.6 ? 'tree_garden' : 'tree_orchard';
        else if (hM < 11) species = r1 < 0.45 ? 'tree_deciduous' : r1 < 0.8 ? 'tree_garden' : 'tree_riparian';
        else species = r1 < 0.72 ? 'tree_deciduous' : 'tree_riparian';
        layer = treeLayers[species];
        nativeR = trees[species].crownM;
        nativeH = trees[species].heightM;
      }
      const sy = hM / nativeH;
      const sxz = THREE.MathUtils.clamp(crown / nativeR, sy * 0.55, sy * 1.9);
      // a conifer's boughs reach the ground: 60 % of its rendered crown radius (incl. the +5 % jitter) keeps off too
      if (coniferIdx >= 0 && !carriageway.isClear(t.x, t.z, Math.max(TRUNK_CLEAR_M, nativeR * sxz * 1.05 * CONIFER_BOUGH_CLEAR))) {
        stats.vegOffCarriageway++;
        continue;
      }
      dummy.position.set(t.x, terrain.getTerrainHeight(t.x, t.z) - 0.05, t.z);
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set((r2 - 0.5) * 0.05, r3 * Math.PI * 2, (r1 - 0.5) * 0.05);
      dummy.scale.set(sxz * (0.95 + r2 * 0.1), sy, sxz * (0.95 + r3 * 0.1));
      dummy.updateMatrix();
      // hue: darker / bluer (-1) .. lighter / yellower (+1) than the average crown
      const hue = THREE.MathUtils.clamp(t.hue, -1, 1);
      const v = (0.93 + r2 * 0.1) * (1 + 0.1 * hue);
      treeTint.setRGB(v * (1 + 0.14 * hue), v * (1 + 0.04 * hue), v * (1 - 0.16 * hue));
      if (coniferIdx >= 0) treeTint.multiply(CONIFER_ALBEDO[coniferIdx]);
      layer.add(dummy.matrix, treeTint);
      treeCount++;
      stats.detectedTrees++;
      const key = detKey(t.x, t.z);
      let cell = detCells.get(key);
      if (!cell) detCells.set(key, (cell = []));
      cell.push(t.x, t.z);
    }
  }
  // 2.0b Cypresses in the Weingut Kreutzenberger gravel beds (village builder's request), columnar thuja asset
  for (const [x, z, h] of WEINGUT_CYPRESSES) {
    if (Math.abs(x - WEINGUT_DOOR_X) < 0.9 || Math.abs(x - WEINGUT_BOARD_X) < 0.9) {
      throw new Error(`[scenery] Weingut cypress at x ${x} stands in front of the door or the info board`);
    }
    const [unitR, unitH] = coniferAssets[1].unit;
    const sy = h / unitH;
    const sxz = 0.5 / unitR;
    dummy.position.set(x, terrain.getTerrainHeight(x, z) - 0.05, z);
    dummy.rotation.order = 'YXZ';
    dummy.rotation.set(0, (x * 1.7) % (Math.PI * 2), 0);
    dummy.scale.set(sxz, sy, sxz);
    dummy.updateMatrix();
    treeTint.setRGB(0.95, 0.98, 0.95);
    coniferLayers[1].add(dummy.matrix, treeTint);
    treeCount++;
  }

  /** With a real detection available, rule-based guesses (garden edge trees) only add noise. */
  const haveDetection = stats.detectedTrees > 200;

  /** Places one tree of `species` with a height in metres drawn from [hMin, hMax]. */
  const pushTree = (species: TreeSpecies, x: number, z: number, hMin: number, hMax: number, checkExclusion = true, yaw?: number): boolean => {
    if (treeCount >= TREE_BUDGET) return false;
    if (Math.abs(x) > maxBound || Math.abs(z) > maxBound) return false;
    if (nearDetected(x, z, 4.0)) return false;
    if (inKeepClear(x, z)) return false;
    if (checkExclusion && (exclusion.isBlocked(x, z) || isNearSvCamera(x, z, 4.6))) return false;
    if (!carriageway.isClear(x, z, TRUNK_CLEAR_M)) return false;
    const s = (hMin + rand() * (hMax - hMin)) / trees[species].heightM;
    dummy.position.set(x, terrain.getTerrainHeight(x, z) - 0.05, z);
    dummy.rotation.order = 'YXZ';
    dummy.rotation.set((rand() - 0.5) * 0.06, yaw ?? rand() * Math.PI * 2, (rand() - 0.5) * 0.06);
    dummy.scale.set(s * (0.92 + rand() * 0.18), s, s * (0.92 + rand() * 0.18));
    dummy.updateMatrix();
    const v = 0.88 + rand() * 0.2;
    treeTint.setRGB(v * (0.96 + rand() * 0.1), v, v * (0.9 + rand() * 0.12));
    treeLayers[species].add(dummy.matrix, treeTint);
    treeCount++;
    return true;
  };

  // 2a. Explicit OSM tree points
  for (const t of sceneData.trees ?? []) {
    let tx: number | undefined = t.x;
    let tz: number | undefined = t.z;
    if (t.position) {
      tx = t.position[0];
      tz = t.position.length >= 3 ? t.position[2] : t.position[1];
    } else if (t.point) {
      tx = t.point[0];
      tz = t.point[1];
    }
    if (tx === undefined || tz === undefined) continue;
    if (exclusion.isBlocked(tx, tz)) continue;
    const isOrch = (t.type ?? '').toLowerCase().includes('orchard');
    const base = isOrch ? 5.0 : 9.5;
    const rel = typeof t.scale === 'number' && Number.isFinite(t.scale) ? THREE.MathUtils.clamp(t.scale, 0.65, 1.55) : 0.9 + rand() * 0.25;
    const h = t.heightM ? THREE.MathUtils.clamp(t.heightM, isOrch ? 3.5 : 6, isOrch ? 7.5 : 19) : base * rel;
    const species: TreeSpecies = isOrch ? 'tree_orchard' : rand() < 0.78 ? 'tree_deciduous' : 'tree_riparian';
    const yaw = typeof t.rotationRad === 'number' && Number.isFinite(t.rotationRad) ? t.rotationRad : undefined;
    pushTree(species, tx, tz, h, h, false, yaw);
  }

  // 2b. Orchards, woods, cemeteries, garden / meadow edges
  for (const lu of sceneData.landuse) {
    if (!lu.points || lu.points.length < 3) continue;
    const pts = lu.points;
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
    if (lu.type === 'orchard') {
      const step = 8.0;
      for (let z = minZ + 3; z < maxZ - 3; z += step) {
        for (let x = minX + 3; x < maxX - 3; x += step) {
          const jx = x + (rand() - 0.5) * 1.6;
          const jz = z + (rand() - 0.5) * 1.6;
          if (!pointInPolygon(jx, jz, pts)) continue;
          pushTree('tree_orchard', jx, jz, 4.2, 6.2);
        }
      }
    } else if (lu.type === 'forest' || lu.type === 'wood' || lu.type === 'scrub' || lu.type === 'cemetery' || lu.type === 'park') {
      const step = lu.type === 'cemetery' ? 10.5 : lu.type === 'park' ? 12.5 : 7.5;
      for (let z = minZ + 3; z < maxZ - 3; z += step) {
        for (let x = minX + 3; x < maxX - 3; x += step) {
          const jx = x + (rand() - 0.5) * step * 0.7;
          const jz = z + (rand() - 0.5) * step * 0.7;
          if (!pointInPolygon(jx, jz, pts)) continue;
          if (lu.type === 'scrub') pushTree(rand() < 0.5 ? 'tree_orchard' : 'tree_riparian', jx, jz, 4.5, 8.5);
          else if (lu.type === 'cemetery' || lu.type === 'park') pushTree('tree_deciduous', jx, jz, 8, 13);
          else pushTree(rand() < 0.5 ? 'tree_deciduous' : 'tree_riparian', jx, jz, 11, 18);
        }
      }
    } else if (!haveDetection && (lu.type === 'meadow' || lu.type === 'grass' || lu.type === 'residential')) {
      for (let i = 0; i < pts.length; i++) {
        if (rand() > 0.22) continue;
        const [x, z] = pts[i];
        const jx = x + (rand() - 0.5) * 5.0;
        const jz = z + (rand() - 0.5) * 5.0;
        if (lu.type === 'residential') pushTree('tree_orchard', jx, jz, 3.8, 5.6);
        else pushTree('tree_deciduous', jx, jz, 8, 12);
      }
    }
  }

  // 2c. Roadside trees along the main road outside the village core
  for (const r of sceneData.roads) {
    if (r.highway !== 'primary' && r.highway !== 'secondary') continue;
    const pts: [number, number][] = r.points.map(extractRoadXZ);
    let accDist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const segD = Math.hypot(x1 - x0, z1 - z0);
      if (segD < 0.5) continue;
      const rx = -(z1 - z0) / segD;
      const rz = (x1 - x0) / segD;
      accDist += segD;
      if (accDist >= 42) {
        accDist = 0;
        const side = rand() > 0.5 ? 1 : -1;
        const wx = x0 + rx * side * 7.5;
        const wz = z0 + rz * side * 7.5;
        if (Math.hypot(wx, wz) > 220) pushTree(rand() < 0.8 ? 'tree_deciduous' : 'tree_orchard', wx, wz, 7.5, 11.5);
      }
    }
  }

  // 2d. Large old linden pair east of the Martinskirche (sv_kirche_front_detail / sv_kirche_east_angle)
  pushTree('tree_deciduous', -20.8, -66.5, 16.5, 16.5, false, 0.85);
  pushTree('tree_deciduous', -18.2, -68.8, 13.0, 13.0, false, 2.45);

  // 2e. Kinderbach: continuous alder / ash belt on both banks with a few poplars (aerial_overview_village, aerial_am_kinderbach_*)
  for (const ww of sceneData.waterways ?? []) {
    if (!ww.points || ww.points.length < 2) continue;
    const pts: [number, number][] = ww.points.map(extractRoadXZ);
    let acc = 3;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const segD = Math.hypot(x1 - x0, z1 - z0);
      if (segD < 0.5) continue;
      const tx = (x1 - x0) / segD;
      const tz = (z1 - z0) / segD;
      const steps = Math.max(1, Math.round(segD / 3));
      for (let s = 0; s < steps; s++) {
        acc += segD / steps;
        if (acc < 7.5) continue;
        acc = rand() * 1.5;
        const px = x0 + (x1 - x0) * ((s + 0.5) / steps);
        const pz = z0 + (z1 - z0) * ((s + 0.5) / steps);
        const nearTriftBridge = px >= -365 && px <= -265 && pz >= 192 && pz <= 258;
        for (const side of [-1, 1]) {
          if (rand() > 0.84) continue;
          const offset = (ww.widthM ?? 1.8) * 0.5 + (nearTriftBridge ? 4.8 : 2.4) + rand() * 3.4;
          const wx = px - tz * side * offset + (rand() - 0.5) * 2;
          const wz = pz + tx * side * offset + (rand() - 0.5) * 2;
          // keep the Triftstrasse bridge railings and the sky corridor above the road clear
          if (wx >= -328.5 && wx <= -307.5 && wz >= 195 && wz <= 226) continue;
          const pick = rand();
          if (pick < 0.07) pushTree('tree_poplar', wx, wz, 17, 23);
          else if (pick < 0.85) pushTree('tree_riparian', wx, wz, 9.5, 16);
          else pushTree('tree_deciduous', wx, wz, 8, 12);
        }
      }
    }
  }

  // 2f. Hand-calibrated trees: bank canopy at the Triftstrasse bridge, wooded bank between Fussballplatz and
  //     Spielplatz (DOP20), garden trees seen in Street View. [x, z, height in m]
  const calibratedTrees: [number, number, number][] = [
    [-306.8, 204.5, 10.5], [-307.2, 211.5, 12], [-308.0, 219.5, 13.5], [-309.5, 228.5, 12.5], [-311.5, 237.5, 12],
    [-331.5, 214.0, 12.8], [-330.5, 222.5, 13.6], [-329.8, 231.5, 13], [-331.0, 240.0, 12.4],
    [-305.8, 190.5, 7.4], [-304.2, 183.0, 8.3], [-541.2, 60.8, 8.0],
    [25.5, -271.5, 11.2], [32.5, -273.5, 12], [39.5, -276.0, 12.3], [46.5, -277.5, 11], [53.0, -279.0, 11.6], [59.5, -280.5, 10.7],
    [66.0, -282.5, 11.8], [73.0, -284.0, 11.3], [80.0, -285.5, 12.1], [87.5, -287.0, 11], [94.5, -288.5, 11.6], [101.5, -290.5, 11.8],
    [108.5, -291.5, 10.7], [115.5, -290.0, 10.1], [62.0, -268.5, 10.1], [69.5, -269.5, 10.5], [78.0, -271.5, 10.7], [86.5, -273.5, 10.3],
    [52.5, -267.5, 9.5], [64.5, -266.8, 9.2], [74.5, -268.0, 9.8],
    [83.5, -231.5, 11.6], [56.5, -254.5, 9.2], [57.5, -238.5, 8.7], [110.5, -366.5, 9.8], [115.5, -365.5, 10.3],
  ];
  for (const [bx, bz, h] of calibratedTrees) {
    if (exclusion.isBlocked(bx, bz, FLAG_ROAD)) continue;
    const creekSide = bz > 175;
    pushTree(creekSide ? 'tree_riparian' : rand() < 0.7 ? 'tree_deciduous' : 'tree_riparian', bx, bz, h * 0.96, h * 1.08, false);
  }

  for (const key of TREE_SPECIES) {
    group.add(treeLayers[key].build());
    registerVegLayer(treeLayers[key]);
  }
  for (const layer of coniferLayers) {
    group.add(layer.build());
    registerVegLayer(layer);
  }
  stats.treeInstances = treeCount;

  // ---------------------------------------------------------------------------
  // 2g. HEDGES and SHRUBS from the aerial detection
  //     clipped garden hedges: 2 m bays scaled to the detected width / height, joints overlapped by half a width;
  //     wild field hedgerows: the 5 m hedgerow bay; shrubs: unit bushes scaled to radius / height.
  // ---------------------------------------------------------------------------
  {
    const hedgeLayers = HEDGE_KINDS.map((k, i) => makeGardenLayer(`Hedges_${k}`, hedgeAssets[i], 0.0, 2.0));
    const wildLayer = makeGardenLayer('Hedges_wild', wildHedge, 0.04, 2.4);
    const shrubLayers = SHRUB_KINDS.map((k, i) => makeGardenLayer(`Shrubs_${k}`, shrubAssets[i], 0.03, 1.75, 0.5));
    const hm = new THREE.Matrix4();
    const tint = new THREE.Color();
    layout.hedges.forEach((h, hi) => {
      if (h.conf < MIN_DETECTION_CONF) return;
      const hr = mulberry32(9176 + hi * 7919);
      const clipped = h.kind === 'clipped';
      const width = THREE.MathUtils.clamp(h.widthM, 0.5, clipped ? 3.0 : 6.0);
      const height = THREE.MathUtils.clamp(h.heightM, 0.6, clipped ? 4.0 : 6.0);
      // thuja and cherry laurel dominate German garden boundaries; privet / hornbeam for the rest
      const pick = hr();
      const ki = pick < 0.36 ? 0 : pick < 0.58 ? 1 : pick < 0.78 ? 2 : 3;
      const g = clipped ? hedgeAssets[ki] : wildHedge;
      const layer = clipped ? hedgeLayers[ki] : wildLayer;
      const [unitLen, unitW, unitH] = g.unit;
      const v = 0.9 + hr() * 0.18;
      tint.setRGB(v * (0.95 + hr() * 0.1), v, v * (0.9 + hr() * 0.14));
      const last = h.points.length - 2;
      // width / height breathe slowly along the run (two incommensurate waves, ±8 % / ±6 %) instead of jumping per bay:
      // neighbouring bays differ by a few cm, which the ragged crown hides - no stepped top line
      const ph1 = hr() * 6.283;
      const ph2 = hr() * 6.283;
      const ph3 = hr() * 6.283;
      const swell = (sM: number, a: number, b: number, ph: number) => 1 + a * Math.sin(sM * 0.55 + ph) + b * Math.sin(sM * 1.7 + ph * 1.9);
      let runS = 0;
      for (let i = 0; i <= last; i++) {
        let [ax, az] = h.points[i];
        let [bx, bz] = h.points[i + 1];
        const len0 = Math.hypot(bx - ax, bz - az);
        if (len0 < 0.2) continue;
        const dX = (bx - ax) / len0;
        const dZ = (bz - az) / len0;
        // overlap the joints so corners are closed
        if (i > 0) {
          ax -= dX * width * 0.5;
          az -= dZ * width * 0.5;
        }
        if (i < last) {
          bx += dX * width * 0.5;
          bz += dZ * width * 0.5;
        }
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / unitLen));
        const bay = len / n;
        for (let k = 0; k < n; k++) {
          const cx = ax + dX * bay * (k + 0.5);
          const cz = az + dZ * bay * (k + 0.5);
          if (Math.abs(cx) > maxBound || Math.abs(cz) > maxBound) continue;
          // a bay inside the raised church terrace showed as a flat green slab on its lawn (kirche review)
          if (inLandmark(cx, cz, width * 0.5)) continue;
          // the bay (centre and both ends, half width incl. the up to +8 % swell / jitter) keeps off the carriageway
          const hwC = width * 0.54;
          if (
            !carriageway.isClear(cx, cz, hwC) ||
            !carriageway.isClear(cx - dX * bay * 0.5, cz - dZ * bay * 0.5, hwC) ||
            !carriageway.isClear(cx + dX * bay * 0.5, cz + dZ * bay * 0.5, hwC)
          ) {
            stats.vegOffCarriageway++;
            continue;
          }
          const hA = terrain.getTerrainHeight(cx - dX * bay * 0.5, cz - dZ * bay * 0.5);
          const hB = terrain.getTerrainHeight(cx + dX * bay * 0.5, cz + dZ * bay * 0.5);
          const sl = bay / unitLen;
          const sM = runS + bay * (k + 0.5);
          const sw = (width / unitW) * (clipped ? swell(sM, 0.05, 0.03, ph1) : 0.94 + hr() * 0.12);
          const sh = (height / unitH) * (clipped ? swell(sM, 0.04, 0.02, ph2 + ph3) : 0.95 + hr() * 0.1);
          const flip = hr() < 0.5 ? 1 : -1;
          hm.set(
            dX * sl * flip, 0, -dZ * sw, cx,
            ((hB - hA) / unitLen) * flip, sh, 0, (hA + hB) * 0.5 - 0.04,
            dZ * sl * flip, 0, dX * sw, cz,
            0, 0, 0, 1
          );
          layer.add(hm, tint);
          stats.hedgeBays++;
        }
        runS += len;
      }
    });
    layout.shrubs.forEach((b, bi) => {
      if (b.conf < MIN_DETECTION_CONF) return;
      if (Math.abs(b.x) > maxBound || Math.abs(b.z) > maxBound) return;
      if (inKeepClear(b.x, b.z)) return;
      if (inLandmark(b.x, b.z, THREE.MathUtils.clamp(b.radiusM, 0.35, 4) * 0.6)) return;
      // the whole bush (radius incl. the +8 % scale jitter below) keeps off the carriageway
      if (!carriageway.isClear(b.x, b.z, THREE.MathUtils.clamp(b.radiusM, 0.35, 4) * 1.08)) {
        stats.vegOffCarriageway++;
        return;
      }
      const br = mulberry32(5501 + bi * 6007);
      // low-confidence shrubs are shadowless blobs in the aerial (detection note): keep only about a third of them
      if (b.conf < 0.35 && br() > 0.35) return;
      const pick = br();
      const ki = pick < 0.42 ? 0 : pick < 0.7 ? 1 : pick < 0.86 ? 2 : 3;
      const [unitR, unitH] = shrubAssets[ki].unit;
      const sr = THREE.MathUtils.clamp(b.radiusM, 0.35, 4) / unitR;
      const sh = THREE.MathUtils.clamp(b.heightM, 0.4, 5) / unitH;
      dummy.position.set(b.x, terrain.getTerrainHeight(b.x, b.z) - 0.04, b.z);
      dummy.rotation.set(0, br() * Math.PI * 2, 0);
      dummy.scale.set(sr * (0.92 + br() * 0.16), sh, sr * (0.92 + br() * 0.16));
      dummy.updateMatrix();
      const v = 0.88 + br() * 0.2;
      tint.setRGB(v * (0.95 + br() * 0.1), v, v * (0.9 + br() * 0.12));
      shrubLayers[ki].add(dummy.matrix, tint);
      stats.shrubInstances++;
    });
    for (const layer of [...hedgeLayers, wildLayer, ...shrubLayers]) {
      if (layer.count === 0) continue;
      group.add(layer.build());
      registerVegLayer(layer);
    }
    hedgeLayers.forEach((layer, i) => footprintChecks.push({ layer, discs: bayDiscs(hedgeAssets[i].unit[0], hedgeAssets[i].unit[1]) }));
    footprintChecks.push({ layer: wildLayer, discs: bayDiscs(wildHedge.unit[0], wildHedge.unit[1]) });
    shrubLayers.forEach((layer, i) => {
      const unitR = shrubAssets[i].unit[0];
      footprintChecks.push({ layer, discs: (e) => [[e[12], e[14], unitR * Math.max(hScale(e, 0), hScale(e, 2))]] });
    });
  }

  // 2g'. LOUD CHECK: no tree trunk, conifer bough, shrub, hedge bay or vine bay on a carriageway of the traffic lane
  //      graph (cars would drive through it). Every placement above filters with the same footprints; anything that
  //      still lands on a carriageway is a bug in a placement path and must not ship silently.
  {
    const offenders: string[] = [];
    let checked = 0;
    for (const { layer, discs } of footprintChecks) {
      layer.forEachInstance((e, i) => {
        checked++;
        for (const [x, z, r] of discs(e)) {
          const n = carriageway.nearest(x, z);
          if (n && n.clear < r - 1e-3) {
            offenders.push(`${layer.layerName}#${i} at (${x.toFixed(1)}, ${z.toFixed(1)}) radius ${r.toFixed(2)} m reaches ${(r - n.clear).toFixed(2)} m onto ${n.road}`);
            break;
          }
        }
      });
    }
    stats.carriagewayCheckedInstances = checked;
    if (offenders.length > 0) {
      throw new Error(`[scenery] ${offenders.length} vegetation instance(s) stand on a carriageway of the traffic lane graph:\n  ${offenders.slice(0, 60).join('\n  ')}${offenders.length > 60 ? `\n  ... and ${offenders.length - 60} more` : ''}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 2h. GROUND COVER around the camera (grass tufts, weeds, wildflowers, reeds)
  // ---------------------------------------------------------------------------
  {
    const coverParts = COVER_NODES.map((name) => {
      const node = coverScene.getObjectByName(name);
      if (!node) throw new Error(`[scenery] ${coverUrl} has no node "${name}" (rebuild the ground cover assets)`);
      const parts = collectParts(node);
      if (parts.length !== 1) throw new Error(`[scenery] ground cover node "${name}" must be a single mesh`);
      return parts[0];
    });
    for (const patch of layout.roughPatches) addGroundCoverPatch(patch.polygon, patch.kind);
    const cover = new GroundCoverSystem(terrain, coverParts, splat, exclusion, sceneData, vineyards, carriageway);
    group.add(cover.group);
    groundCovers.push(cover);
  }

  // ---------------------------------------------------------------------------
  // 3. ORTSSCHILD at the L 450 entrances + STREET LAMPS along village streets
  // ---------------------------------------------------------------------------
  let hauptstrasseShowcasePoint: [number, number] | null = null;
  let feldwegShowcasePoint: [number, number] | null = null;

  const ortsschildMatrices: THREE.Matrix4[] = [];
  const lampMatrices: THREE.Matrix4[] = [];
  const placedLamps: [number, number][] = [];
  const mainRoadCandidates: { x: number; z: number; tx: number; tz: number; width: number }[] = [];

  for (const r of sceneData.roads) {
    if (!r.points || r.points.length < 2) continue;
    const pts: [number, number][] = r.points.map(extractRoadXZ);
    const hw = r.highway || '';
    const isMain = hw === 'primary' || hw === 'secondary' || (r.name ?? '').toLowerCase().includes('hauptstra');
    const isVillageStreet = isMain || hw === 'tertiary' || hw === 'residential' || hw === 'living_street';

    if (hw === 'track' && !feldwegShowcasePoint) {
      for (const [px, pz] of pts) {
        const d = Math.hypot(px, pz);
        if (d > 260 && d < 620) {
          feldwegShowcasePoint = [px, pz];
          break;
        }
      }
    }

    let lampDist = 14;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const segD = Math.hypot(x1 - x0, z1 - z0);
      if (segD < 0.5) continue;
      const tx = (x1 - x0) / segD;
      const tz = (z1 - z0) / segD;
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      const width = r.widthM ?? (isMain ? 7.4 : 5.2);
      if (isMain) mainRoadCandidates.push({ x: mx, z: mz, tx, tz, width });

      if (isVillageStreet) {
        const inVillage = mx >= villageMinX - 25 && mx <= villageMaxX + 25 && mz >= villageMinZ - 25 && mz <= villageMaxZ + 25;
        if (inVillage) {
          lampDist += segD;
          if (lampDist >= 38 && lampMatrices.length < 180) {
            lampDist = 0;
            const rx = -tz;
            const rz = tx;
            const offset = width * 0.5 + 1.05;
            const lx = mx + rx * offset;
            const lz = mz + rz * offset;
            const tooClose = placedLamps.some(([px, pz]) => Math.hypot(px - lx, pz - lz) < 26);
            if (!tooClose && !exclusion.isBlocked(lx, lz, FLAG_BUILDING) && !isNearSvCamera(lx, lz, 4.2)) {
              const y = terrain.getTerrainHeight(lx, lz) + groundOffset(lampProto) - 0.02;
              // lamp arm (+Z in streetlamp.glb) reaches over the road
              dummy.position.set(lx, y, lz);
              dummy.rotation.set(0, Math.atan2(-rx, -rz), 0);
              dummy.scale.setScalar(1.0);
              dummy.updateMatrix();
              lampMatrices.push(dummy.matrix.clone());
              placedLamps.push([lx, lz]);
            }
          }
        }
      }
    }
  }

  if (mainRoadCandidates.length > 0) {
    let bestCenterDist = Infinity;
    for (const c of mainRoadCandidates) {
      const d = Math.hypot(c.x, c.z);
      if (d < bestCenterDist) {
        bestCenterDist = d;
        hauptstrasseShowcasePoint = [c.x, c.z];
      }
    }

    // Prefer exact geodata POIs (type === 'ortsschild'); otherwise the outermost main-road points of the village
    const explicitSigns = (sceneData.pois ?? []).filter(
      (p) => (p.type ?? '').toLowerCase() === 'ortsschild' && typeof p.x === 'number' && typeof p.z === 'number'
    );
    if (explicitSigns.length > 0) {
      for (const sign of explicitSigns) {
        const sx = sign.x!;
        const sz = sign.z!;
        const sy = terrain.getTerrainHeight(sx, sz) + groundOffset(ortsschildProto) - 0.02;
        // sign.rotationRad aligns local +X with the road; turn the +Z front face toward incoming traffic
        const roadRot = typeof sign.rotationRad === 'number' && Number.isFinite(sign.rotationRad) ? sign.rotationRad : 0;
        const isEast = String(sign.id ?? '').includes('east') || sx > 0;
        dummy.position.set(sx, sy, sz);
        dummy.rotation.set(0, isEast ? roadRot + Math.PI * 0.5 : roadRot - Math.PI * 0.5, 0);
        dummy.scale.setScalar(1.0);
        dummy.updateMatrix();
        ortsschildMatrices.push(dummy.matrix.clone());
      }
    } else {
      const villageMain = mainRoadCandidates.filter(
        (c) => c.x >= villageMinX - 80 && c.x <= villageMaxX + 80 && c.z >= villageMinZ - 80 && c.z <= villageMaxZ + 80
      );
      if (villageMain.length >= 2) {
        villageMain.sort((a, b) => a.x - b.x);
        const placeSign = (pt: (typeof villageMain)[number], enteringEastward: boolean) => {
          let dX = pt.tx;
          let dZ = pt.tz;
          if ((enteringEastward && dX < 0) || (!enteringEastward && dX > 0)) {
            dX = -dX;
            dZ = -dZ;
          }
          const sx = pt.x - dZ * (pt.width * 0.5 + 1.45);
          const sz = pt.z + dX * (pt.width * 0.5 + 1.45);
          dummy.position.set(sx, terrain.getTerrainHeight(sx, sz) + groundOffset(ortsschildProto) - 0.02, sz);
          dummy.rotation.set(0, Math.atan2(-dX, -dZ), 0);
          dummy.scale.setScalar(1.0);
          dummy.updateMatrix();
          ortsschildMatrices.push(dummy.matrix.clone());
        };
        placeSign(villageMain[0], true);
        placeSign(villageMain[villageMain.length - 1], false);
      }
    }
  }

  if (ortsschildMatrices.length > 0) {
    group.add(createInstancedPropGroup('Ortsschilder', ortsschildProto, ortsschildMatrices));
    stats.ortsschildCount = ortsschildMatrices.length;
  }

  // Street lamps: emissive lens + additive glow sprite + warm light pool on the ground, all driven by nightFactor
  const lampLensMaterials: THREE.MeshStandardMaterial[] = [];
  let lampGlow: THREE.Points | null = null;
  let lampPools: THREE.Mesh | null = null;
  if (lampMatrices.length > 0) {
    for (const part of lampProto.parts) {
      const mat = part.material;
      if (mat instanceof THREE.MeshStandardMaterial && /lamp|emissive/i.test(mat.name)) lampLensMaterials.push(mat);
    }
    if (lampLensMaterials.length === 0) {
      throw new Error('[scenery] streetlamp.glb has no material named *Lamp*/*Emissive* for the lens');
    }
    group.add(createInstancedPropGroup('Streetlamps', lampProto, lampMatrices));
    stats.lampInstances = lampMatrices.length;

    const headLocal = new THREE.Vector3(0, 5.84, 1.32);
    const glowPos = new Float32Array(lampMatrices.length * 3);
    const glowTex = makeGlowTexture();
    // Light pools: one merged mesh, every pool a 9 x 9 grid draped over the RENDERED ground and lifted above kerb /
    // sidewalk height, so road and pavement geometry cannot slice it.
    const POOL_M = 15;
    const POOL_N = 8;
    const POOL_LIFT = 0.3;
    const pPos: number[] = [];
    const pUv: number[] = [];
    const pIdx: number[] = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < lampMatrices.length; i++) {
      p.copy(headLocal).applyMatrix4(lampMatrices[i]);
      p.toArray(glowPos, i * 3);
      const base = pPos.length / 3;
      for (let jz = 0; jz <= POOL_N; jz++) {
        for (let jx = 0; jx <= POOL_N; jx++) {
          const x = p.x + (jx / POOL_N - 0.5) * POOL_M;
          const z = p.z + (jz / POOL_N - 0.5) * POOL_M;
          pPos.push(x, terrain.getRenderedSurfaceHeight(x, z) + POOL_LIFT, z);
          pUv.push(jx / POOL_N, jz / POOL_N);
        }
      }
      for (let jz = 0; jz < POOL_N; jz++) {
        for (let jx = 0; jx < POOL_N; jx++) {
          const v0 = base + jz * (POOL_N + 1) + jx;
          pIdx.push(v0, v0 + POOL_N + 1, v0 + 1, v0 + 1, v0 + POOL_N + 1, v0 + POOL_N + 2);
        }
      }
    }
    const poolGeo = new THREE.BufferGeometry();
    poolGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
    poolGeo.setAttribute('uv', new THREE.Float32BufferAttribute(pUv, 2));
    poolGeo.setIndex(pIdx);
    poolGeo.computeBoundingSphere();
    lampPools = new THREE.Mesh(
      poolGeo,
      // Multiplicative light pool: result = surface * (1 + glow), so the pool brightens and tints whatever it lies
      // on (asphalt, kerb, lawn) instead of glowing on its own like a floating saucer. premultipliedAlpha folds the
      // radial alpha falloff and the night opacity into the colour that drives the blend.
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color: new THREE.Color(1.0, 0.74, 0.42).multiplyScalar(LAMP_POOL_GAIN),
        transparent: true,
        opacity: 0,
        premultipliedAlpha: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.OneFactor,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -60,
        fog: false,
      })
    );
    lampPools.name = 'StreetlampLightPools';
    lampPools.visible = false;
    lampPools.renderOrder = 3;
    group.add(lampPools);

    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    lampGlow = new THREE.Points(
      glowGeo,
      new THREE.PointsMaterial({
        map: glowTex,
        color: new THREE.Color(1.0, 0.84, 0.6),
        size: 3.4,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    lampGlow.name = 'StreetlampGlow';
    lampGlow.visible = false;
    lampGlow.renderOrder = 4;
    group.add(lampGlow);
  }

  const setTimeOfDay = (_preset: TimeOfDayName, nightFactor: number): void => {
    const nf = THREE.MathUtils.clamp(nightFactor, 0, 1);
    vegUniforms.uVegDay.value = 1 - nf;
    for (const mat of lampLensMaterials) {
      mat.emissiveIntensity = 0.02 + nf * 7.0;
    }
    if (lampGlow) {
      lampGlow.visible = nf > 0.02;
      (lampGlow.material as THREE.PointsMaterial).opacity = nf * 0.95;
    }
    if (lampPools) {
      lampPools.visible = nf > 0.02;
      (lampPools.material as THREE.MeshBasicMaterial).opacity = nf;
    }
  };
  setTimeOfDay('noon', 0);
  group.userData.setTimeOfDay = setTimeOfDay;
  group.userData.setQuality = setVegetationQuality;

  // ---------------------------------------------------------------------------
  // 4. ROUND BALES in meadows / farmyards & WINE BARRELS at the wineries
  // ---------------------------------------------------------------------------
  const hayMatrices: THREE.Matrix4[] = [];
  {
    const baleZones = sceneData.landuse.filter(
      (lu) => (lu.type === 'meadow' || lu.type === 'farmland' || lu.type === 'farmyard') && lu.points && lu.points.length >= 3
    );
    for (const lu of baleZones) {
      if (hayMatrices.length >= 95) break;
      let cx = 0;
      let cz = 0;
      for (const [x, z] of lu.points) {
        cx += x;
        cz += z;
      }
      cx /= lu.points.length;
      cz /= lu.points.length;
      if (Math.hypot(cx, cz) > 880) continue;
      if (rand() > (lu.type === 'meadow' || lu.type === 'farmyard' ? 0.65 : 0.25)) continue;

      const clusterSize = 2 + Math.floor(rand() * 4);
      const baseAngle = rand() * Math.PI * 2;
      for (let k = 0; k < clusterSize; k++) {
        const bx = cx + Math.cos(baseAngle) * k * 2.1 + (rand() - 0.5) * 1.4;
        const bz = cz + Math.sin(baseAngle) * k * 2.1 + (rand() - 0.5) * 1.4;
        if (!pointInPolygon(bx, bz, lu.points)) continue;
        if (exclusion.isBlocked(bx, bz)) continue;
        dummy.position.set(bx, terrain.getTerrainHeight(bx, bz) + groundOffset(hayProto) - 0.02, bz);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.setScalar(0.95 + rand() * 0.12);
        dummy.updateMatrix();
        hayMatrices.push(dummy.matrix.clone());
      }
    }
    if (hayMatrices.length > 0) {
      group.add(createInstancedPropGroup('HayBales', hayProto, hayMatrices));
      stats.hayBaleInstances = hayMatrices.length;
    }
  }

  const barrelMatrices: THREE.Matrix4[] = [];
  for (const [key, info] of landmarks.entries()) {
    // barrels only at winery landmarks, never at the Rathaus or the church
    if (!key.includes('weingut') && !key.includes('winzer')) continue;
    const radius = Math.max(info.size.x, info.size.z) * 0.55 + 2.4;
    for (let k = 0; k < 4; k++) {
      const a = info.rotationY + k * 0.38 - 0.6;
      const bx = info.position.x + Math.cos(a) * radius;
      const bz = info.position.z + Math.sin(a) * radius;
      if (exclusion.isBlocked(bx, bz, FLAG_BUILDING | FLAG_ROAD) || inKeepClear(bx, bz)) continue;
      dummy.position.set(bx, terrain.getTerrainHeight(bx, bz) + groundOffset(barrelProto) - 0.01, bz);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(1.0);
      dummy.updateMatrix();
      barrelMatrices.push(dummy.matrix.clone());
    }
  }
  // ... and in the yards of the wineries mapped as POIs (small groups of two or three barrels beside the building)
  for (const poi of sceneData.pois ?? []) {
    if ((poi.type ?? '').toLowerCase() !== 'winery' || typeof poi.x !== 'number' || typeof poi.z !== 'number') continue;
    let placed = 0;
    for (let attempt = 0; attempt < 40 && placed < 3; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = placed === 0 ? 3 + rand() * 7 : 0.85;
      const last = placed > 0 ? barrelMatrices[barrelMatrices.length - 1].elements : null;
      const bx = (last ? last[12] : poi.x) + Math.cos(a) * r;
      const bz = (last ? last[14] : poi.z) + Math.sin(a) * r;
      if (exclusion.isBlocked(bx, bz, FLAG_BUILDING | FLAG_ROAD) || isNearSvCamera(bx, bz, 3.0) || inKeepClear(bx, bz)) continue;
      dummy.position.set(bx, terrain.getTerrainHeight(bx, bz) + groundOffset(barrelProto) - 0.01, bz);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(1.0);
      dummy.updateMatrix();
      barrelMatrices.push(dummy.matrix.clone());
      placed++;
    }
  }
  if (barrelMatrices.length > 0) {
    group.add(createInstancedPropGroup('WineBarrels', barrelProto, barrelMatrices));
    stats.barrelInstances = barrelMatrices.length;
  }

  return {
    group,
    stats,
    vineyardShowcasePoint,
    hauptstrasseShowcasePoint,
    feldwegShowcasePoint,
    setTimeOfDay,
    setQuality: setVegetationQuality,
  };
}
