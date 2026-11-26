import * as THREE from 'three';
import type { FarTerrainManifest, GroundTextureManifest, MetaData, OrthoTileManifest } from './types';
import { resolveAssetUrl } from './url';

/**
 * Terrain of Kindenheim: 4 m heightmap mesh shaded with
 *   1. the official DOP20 aerial photo — whole map at 0.5 m/px plus a streamed 768 m window at the
 *      native 0.2 m/px around the point the camera looks at (one fixed 3936² atlas, never more),
 *   2. photo-scanned PBR ground materials (grass, stubble, soil, gravel, pavers, asphalt) blended in near
 *      the camera, selected by a 1 m material map and tinted by the aerial photo,
 *   3. 1 m LiDAR micro-relief (terraces, banks, ditches) as a slope map on top of the 4 m mesh normals.
 *
 *   4. a coarse outer ring ("KindenheimTerrainFar", child of the terrain mesh) out to 8.2 km with real aerial
 *      imagery of the surroundings; its heights continue the map edge into low rolling hills.
 *
 * `getTerrainHeight` is a bilinear sample of data/terrain/heightmap.bin, which carries graded, level road beds
 * (scripts/build_terrain_roadbed.py): the rendered ground under a paved road IS the road surface.
 * Every load fails loudly — a missing or broken data file aborts start-up with the file name in the error.
 */

/** Layer indices of the shared ground texture arrays (order of public/assets/textures/ground/ground.json). */
export const GROUND_LAYER = {
  grass: 0,
  dryGrass: 1,
  soil: 2,
  gravel: 3,
  pavers: 4,
  asphalt: 5,
  setts: 6,
  sidewalk: 7,
} as const;

const GROUND_LAYER_NAMES = ['grass', 'dry_grass', 'soil', 'gravel', 'pavers', 'asphalt', 'setts', 'sidewalk'] as const;
const GROUND_LAYER_COUNT = GROUND_LAYER_NAMES.length;

/** Roughness = bias + scale * map, per layer (scanned grass is far too glossy for a field seen from 2 m). */
const GROUND_ROUGHNESS: [number, number][] = [
  [0.7, 0.28], // grass
  [0.78, 0.2], // dry grass
  [0.84, 0.16], // soil
  [0.72, 0.26], // gravel
  [0.62, 0.36], // pavers
  [0.58, 0.4], // asphalt
  [0.5, 0.45], // setts
  [0.6, 0.38], // sidewalk
];

const ORTHO_DIR = 'data/terrain/ortho';
const GROUND_DIR = 'assets/textures/ground';

async function fetchChecked(path: string): Promise<Response> {
  const url = resolveAssetUrl(path);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Terrain: network error while loading ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Terrain: ${url} answered HTTP ${res.status}`);
  if ((res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new Error(`Terrain: ${url} is missing (the server answered with an HTML page instead of the file)`);
  }
  return res;
}

async function loadJsonChecked<T>(path: string): Promise<T> {
  const res = await fetchChecked(path);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Terrain: ${path} is not valid JSON (starts with "${text.slice(0, 40).replace(/\s+/g, ' ')}")`);
  }
}

async function loadBitmapChecked(path: string, expectW?: number, expectH?: number): Promise<ImageBitmap> {
  const res = await fetchChecked(path);
  const blob = await res.blob();
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch (err) {
    throw new Error(`Terrain: ${path} could not be decoded as an image (${blob.type || 'unknown type'}, ${blob.size} bytes): ${(err as Error).message}`);
  }
  if ((expectW && bmp.width !== expectW) || (expectH && bmp.height !== expectH)) {
    throw new Error(`Terrain: ${path} is ${bmp.width}x${bmp.height}, expected ${expectW}x${expectH}`);
  }
  return bmp;
}

function bitmapTexture(bmp: ImageBitmap, colorSpace: THREE.ColorSpace, anisotropy: number, mipmaps: boolean): THREE.Texture {
  const tex = new THREE.Texture(bmp);
  tex.flipY = false; // ImageBitmaps are uploaded as decoded: row 0 (north) is v = 0
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------------
// Shared ground material library (used by the terrain and by the road meshes)
// ---------------------------------------------------------------------------------------------------

export interface GroundUniforms {
  uKdhGroundAlbedo: { value: THREE.DataArrayTexture };
  uKdhGroundNR: { value: THREE.DataArrayTexture };
  uKdhGroundMean: { value: THREE.Vector3[] };
  uKdhGroundCfg: { value: THREE.Vector3[] };
}

/** GLSL declarations + sampling helper shared by every material that uses the ground texture arrays. */
export const KDH_GROUND_GLSL = /* glsl */ `
uniform mediump sampler2DArray uKdhGroundAlbedo;
uniform mediump sampler2DArray uKdhGroundNR;
uniform vec3 uKdhGroundMean[${GROUND_LAYER_COUNT}];
uniform vec3 uKdhGroundCfg[${GROUND_LAYER_COUNT}]; // x = 1 / tile size (m), y = roughness bias, z = roughness scale

float kdhLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float kdhHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float kdhNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kdhHash(i), kdhHash(i + vec2(1.0, 0.0)), f.x), mix(kdhHash(i + vec2(0.0, 1.0)), kdhHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float kdhFbm(vec2 p) {
  return kdhNoise(p) * 0.5 + kdhNoise(p * 2.03 + 17.1) * 0.3 + kdhNoise(p * 4.01 + 43.7) * 0.2;
}

// Samples one ground layer at ground-plane coordinates "st" (metres; s -> tangent, t -> bitangent).
// dx / dy are dFdx(st) / dFdy(st) taken OUTSIDE of any branch or loop (implicit derivatives are undefined there).
// farMix blends in a second, 5x larger and rotated copy so the tile grid is not readable at distance.
// albedo: linear colour. nst: normal offset along (s, t). rough: remapped roughness.
void kdhGroundSample(int layer, vec2 st, vec2 dx, vec2 dy, float farMix, out vec3 albedo, out vec2 nst, out float rough) {
  vec3 cfg = uKdhGroundCfg[layer];
  float l = float(layer);
  vec2 uv = st * cfg.x;
  vec2 gx = dx * cfg.x;
  vec2 gy = dy * cfg.x;
  albedo = textureGrad(uKdhGroundAlbedo, vec3(uv, l), gx, gy).rgb;
  vec3 nr = textureGrad(uKdhGroundNR, vec3(uv, l), gx, gy).rgb;
  // Normal maps are OpenGL style (+Y = image up). Image rows run along +t, so image-up is -t.
  nst = vec2(nr.x * 2.0 - 1.0, 1.0 - nr.y * 2.0);
  float r = nr.z;
  if (farMix > 0.01) {
    const float c = 0.7986;
    const float s = 0.6018;
    const float k = 0.19;
    vec2 uv2 = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) * k + 0.37;
    vec2 gx2 = vec2(gx.x * c - gx.y * s, gx.x * s + gx.y * c) * k;
    vec2 gy2 = vec2(gy.x * c - gy.y * s, gy.x * s + gy.y * c) * k;
    vec3 a2 = textureGrad(uKdhGroundAlbedo, vec3(uv2, l), gx2, gy2).rgb;
    vec3 nr2 = textureGrad(uKdhGroundNR, vec3(uv2, l), gx2, gy2).rgb;
    vec2 n2 = vec2(nr2.x * 2.0 - 1.0, 1.0 - nr2.y * 2.0);
    n2 = vec2(n2.x * c + n2.y * s, -n2.x * s + n2.y * c);
    albedo = mix(albedo, a2, farMix);
    nst = mix(nst, n2, farMix);
    r = mix(r, nr2.z, farMix);
  }
  rough = cfg.y + cfg.z * r;
}
`;

export class GroundMaterialLibrary {
  public readonly uniforms: GroundUniforms;
  public readonly tileSizeM: number[];
  private pendingAlbedo: ImageBitmap[] | null;
  private pendingNR: ImageBitmap[] | null;

  private constructor(manifest: GroundTextureManifest, albedo: ImageBitmap[], nr: ImageBitmap[], maxAnisotropy: number) {
    const size = manifest.size;
    const make = (colorSpace: THREE.ColorSpace): THREE.DataArrayTexture => {
      const tex = new THREE.DataArrayTexture(null, size, size, GROUND_LAYER_COUNT);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.colorSpace = colorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = Math.min(8, maxAnisotropy);
      tex.source.dataReady = false; // storage only; the layers are copied in from ImageBitmaps on the first frame
      tex.needsUpdate = true;
      return tex;
    };
    this.tileSizeM = manifest.layers.map((l) => l.tileSizeM);
    this.uniforms = {
      uKdhGroundAlbedo: { value: make(THREE.SRGBColorSpace) },
      uKdhGroundNR: { value: make(THREE.NoColorSpace) },
      uKdhGroundMean: { value: manifest.layers.map((l) => new THREE.Vector3(...l.meanAlbedoLinear)) },
      uKdhGroundCfg: {
        value: manifest.layers.map((l, i) => new THREE.Vector3(1 / l.tileSizeM, GROUND_ROUGHNESS[i][0], GROUND_ROUGHNESS[i][1])),
      },
    };
    this.pendingAlbedo = albedo;
    this.pendingNR = nr;
  }

  public static async load(maxAnisotropy: number): Promise<GroundMaterialLibrary> {
    const manifest = await loadJsonChecked<GroundTextureManifest>(`${GROUND_DIR}/ground.json`);
    if (!Array.isArray(manifest.layers) || manifest.layers.length !== GROUND_LAYER_COUNT) {
      throw new Error(`Terrain: ${GROUND_DIR}/ground.json lists ${manifest.layers?.length} layers, expected ${GROUND_LAYER_COUNT}`);
    }
    manifest.layers.forEach((l, i) => {
      if (l.name !== GROUND_LAYER_NAMES[i]) {
        throw new Error(`Terrain: ground layer ${i} is "${l.name}", expected "${GROUND_LAYER_NAMES[i]}" (layer order changed?)`);
      }
    });
    const [albedo, nr] = await Promise.all([
      Promise.all(manifest.layers.map((l) => loadBitmapChecked(`${GROUND_DIR}/${l.albedo}`, manifest.size, manifest.size))),
      Promise.all(manifest.layers.map((l) => loadBitmapChecked(`${GROUND_DIR}/${l.normalRoughness}`, manifest.size, manifest.size))),
    ]);
    return new GroundMaterialLibrary(manifest, albedo, nr, maxAnisotropy);
  }

  /** Copies the decoded layers into the GPU arrays. Needs the renderer, so it runs on the first rendered frame. */
  public ensureUploaded(renderer: THREE.WebGLRenderer): void {
    if (!this.pendingAlbedo || !this.pendingNR) return;
    const jobs: [ImageBitmap[], THREE.DataArrayTexture][] = [
      [this.pendingAlbedo, this.uniforms.uKdhGroundAlbedo.value],
      [this.pendingNR, this.uniforms.uKdhGroundNR.value],
    ];
    this.pendingAlbedo = null;
    this.pendingNR = null;
    const dst = new THREE.Vector3();
    for (const [bitmaps, array] of jobs) {
      bitmaps.forEach((bmp, layer) => {
        const src = new THREE.Texture(bmp);
        array.generateMipmaps = layer === bitmaps.length - 1; // build the mip chain once, after the last layer
        renderer.copyTextureToTexture(src, array, null, dst.set(0, 0, layer));
        src.dispose();
        bmp.close();
      });
      array.generateMipmaps = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Streamed 0.2 m aerial window
// ---------------------------------------------------------------------------------------------------

const WINDOW_TILES = 3;
/** Mip levels of the window atlas: 1312 px tiles -> 41 px at level 5; the shader never samples coarser ones. */
const ATLAS_MIP_LEVELS = 6;

class OrthoWindow {
  public readonly atlas: THREE.DataTexture;
  public readonly fade: Float32Array;
  /** xy = focus point (world x, z), z = full-detail radius, w = radius where the window has faded out. */
  public readonly windowUniform = new THREE.Vector4(0, 0, 150, 228);
  public readonly atlasInfo: THREE.Vector4;

  private readonly perSide: number;
  private readonly tileSizeM: number;
  private readonly tilePx: number;
  private readonly gutterPx: number;
  private readonly imagePx: number;
  private readonly filePattern: string;
  private readonly halfMap: number;
  private readonly slotTile = new Int32Array(WINDOW_TILES * WINDOW_TILES).fill(-1);
  private readonly uploaded = new Uint8Array(64);
  private readonly loading = new Set<number>();
  /** Decoded tile + its pre-shrunk mip levels (level 0 first). */
  private readonly ready = new Map<number, ImageBitmap[]>();
  private focusRow = -1;
  private focusCol = -1;
  private lastTimeMs = 0;
  private instantFill = true;
  private readonly retryAfterMs = new Float64Array(64);
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpDst = new THREE.Vector2();

  constructor(manifest: OrthoTileManifest, mapSizeM: number, maxAnisotropy: number) {
    const t = manifest.tiles;
    if (t.perSide * t.tileSizeM !== mapSizeM || t.imagePx !== t.tilePx + 2 * t.gutterPx || t.perSide * t.perSide > 64) {
      throw new Error(`Terrain: ${ORTHO_DIR}/manifest.json has an inconsistent tile layout (${JSON.stringify(t)})`);
    }
    this.perSide = t.perSide;
    this.tileSizeM = t.tileSizeM;
    this.tilePx = t.tilePx;
    this.gutterPx = t.gutterPx;
    this.imagePx = t.imagePx;
    this.filePattern = t.filePattern;
    this.halfMap = mapSizeM * 0.5;
    this.fade = new Float32Array(64);

    const atlasPx = WINDOW_TILES * this.imagePx;
    this.atlasInfo = new THREE.Vector4(this.perSide, this.imagePx / atlasPx, this.gutterPx / atlasPx, this.tilePx / atlasPx);
    const atlas = new THREE.DataTexture(null, atlasPx, atlasPx, THREE.RGBAFormat, THREE.UnsignedByteType);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.wrapS = THREE.ClampToEdgeWrapping;
    atlas.wrapT = THREE.ClampToEdgeWrapping;
    // Mips are uploaded per tile (levels shrunk off the main thread while the tile decodes). Regenerating the mip
    // chain of the whole 3936 px atlas for every arriving tile cost 20-80 ms and made drone flights stutter.
    // imagePx must stay divisible by 2^(ATLAS_MIP_LEVELS - 1) so every level is tile-aligned.
    if (this.imagePx % (1 << (ATLAS_MIP_LEVELS - 1)) !== 0) {
      throw new Error(`Terrain: aerial tile size ${this.imagePx} px is not divisible by ${1 << (ATLAS_MIP_LEVELS - 1)} (mip alignment)`);
    }
    atlas.mipmaps = Array.from({ length: ATLAS_MIP_LEVELS }, (_, i) => ({ data: null, width: atlasPx >> i, height: atlasPx >> i })) as unknown as THREE.CompressedTextureMipmap[];
    atlas.generateMipmaps = false;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.anisotropy = maxAnisotropy;
    atlas.flipY = false;
    atlas.source.dataReady = false; // allocate storage only; tiles are copied in as they arrive
    atlas.needsUpdate = true;
    this.atlas = atlas;
  }

  public get atlasPx(): number {
    return WINDOW_TILES * this.imagePx;
  }

  /** True when every tile of the current window is on the GPU and fully faded in. */
  public get idle(): boolean {
    if (this.focusRow < 0) return false;
    for (const tile of this.slotTile) {
      if (tile < 0 || this.uploaded[tile] !== 1 || this.fade[tile] < 1) return false;
    }
    return true;
  }

  /** Frees the atlas (82 MB of GPU memory) and forgets every tile; `update` refills it from scratch if called again. */
  public release(): void {
    for (const levels of this.ready.values()) levels.forEach((b) => b.close());
    this.ready.clear();
    this.slotTile.fill(-1);
    this.uploaded.fill(0);
    this.fade.fill(0);
    this.focusRow = -1;
    this.focusCol = -1;
    this.instantFill = true;
    this.atlas.dispose();
  }

  public update(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const now = performance.now();
    const dt = this.lastTimeMs > 0 ? Math.min(0.25, (now - this.lastTimeMs) / 1000) : 0;
    this.lastTimeMs = now;

    // Focus = a point ~110 m ahead of the camera on the ground plane (under the camera when looking straight down).
    camera.getWorldDirection(this.tmpDir);
    const e = camera.matrixWorld.elements;
    const lim = this.halfMap - 1;
    const fx = THREE.MathUtils.clamp(e[12] + this.tmpDir.x * 110, -lim, lim);
    const fz = THREE.MathUtils.clamp(e[14] + this.tmpDir.z * 110, -lim, lim);
    this.windowUniform.x = fx;
    this.windowUniform.y = fz;

    const tx = (fx + this.halfMap) / this.tileSizeM;
    const tz = (fz + this.halfMap) / this.tileSizeM;
    // Hysteresis: the focus tile only changes once the focus point is 24 m inside the neighbour.
    const margin = 24 / this.tileSizeM;
    const jumped = this.focusRow < 0 || Math.abs(tx - (this.focusCol + 0.5)) > 1.5 || Math.abs(tz - (this.focusRow + 0.5)) > 1.5;
    if (jumped) {
      this.focusCol = Math.floor(tx);
      this.focusRow = Math.floor(tz);
      this.instantFill = true; // teleport / bookmark: no fade-in, the whole window is new anyway
    } else {
      if (tx < this.focusCol - margin) this.focusCol -= 1;
      else if (tx > this.focusCol + 1 + margin) this.focusCol += 1;
      if (tz < this.focusRow - margin) this.focusRow -= 1;
      else if (tz > this.focusRow + 1 + margin) this.focusRow += 1;
    }
    const maxStart = this.perSide - WINDOW_TILES;
    const row0 = THREE.MathUtils.clamp(this.focusRow - 1, 0, maxStart);
    const col0 = THREE.MathUtils.clamp(this.focusCol - 1, 0, maxStart);

    for (let r = row0; r < row0 + WINDOW_TILES; r++) {
      for (let c = col0; c < col0 + WINDOW_TILES; c++) {
        const tile = r * this.perSide + c;
        const slot = (r % WINDOW_TILES) * WINDOW_TILES + (c % WINDOW_TILES);
        const prev = this.slotTile[slot];
        if (prev !== tile) {
          if (prev >= 0) {
            // Evicted tiles are always > 228 m from the focus point, i.e. already faded out in the shader.
            this.fade[prev] = 0;
            this.uploaded[prev] = 0;
            const stale = this.ready.get(prev);
            if (stale) {
              stale.forEach((b) => b.close());
              this.ready.delete(prev);
            }
          }
          this.slotTile[slot] = tile;
          this.uploaded[tile] = 0;
          this.fade[tile] = 0;
        }
        if (this.uploaded[tile] === 0 && !this.loading.has(tile) && !this.ready.has(tile) && now >= this.retryAfterMs[tile]) {
          this.startLoad(tile, r, c);
        }
      }
    }

    // Upload what has arrived: everything on a teleport, otherwise one tile per frame (7 MB texSubImage + 5 tiny mips).
    let budget = this.instantFill ? 9 : 1;
    for (const [tile, levels] of this.ready) {
      const r = Math.floor(tile / this.perSide);
      const c = tile % this.perSide;
      const slot = (r % WINDOW_TILES) * WINDOW_TILES + (c % WINDOW_TILES);
      if (this.slotTile[slot] !== tile) {
        levels.forEach((b) => b.close());
        this.ready.delete(tile);
        continue;
      }
      if (budget-- <= 0) break;
      const sx = (slot % WINDOW_TILES) * this.imagePx;
      const sy = Math.floor(slot / WINDOW_TILES) * this.imagePx;
      levels.forEach((bmp, level) => {
        const src = new THREE.Texture(bmp);
        this.tmpDst.set(sx >> level, sy >> level);
        renderer.copyTextureToTexture(src, this.atlas, null, this.tmpDst, 0, level);
        src.dispose();
        bmp.close();
      });
      this.ready.delete(tile);
      this.uploaded[tile] = 1;
      if (this.instantFill) this.fade[tile] = 1;
    }

    let allIn = true;
    for (const tile of this.slotTile) {
      if (tile < 0) continue;
      if (this.uploaded[tile] === 1) this.fade[tile] = Math.min(1, this.fade[tile] + dt / 0.3);
      else allIn = false;
    }
    if (allIn) this.instantFill = false;
  }

  private startLoad(tile: number, row: number, col: number): void {
    this.loading.add(tile);
    const path = `${ORTHO_DIR}/${this.filePattern.replace('{row}', String(row)).replace('{col}', String(col))}`;
    loadBitmapChecked(path, this.imagePx, this.imagePx)
      .then(async (bmp) => {
        // Shrink level by level (2x box filter each) so the chain matches what generateMipmap would produce.
        const levels = [bmp];
        for (let i = 1; i < ATLAS_MIP_LEVELS; i++) {
          const size = this.imagePx >> i;
          levels.push(
            await createImageBitmap(levels[i - 1], {
              resizeWidth: size,
              resizeHeight: size,
              resizeQuality: 'medium',
              colorSpaceConversion: 'none',
              premultiplyAlpha: 'none',
            })
          );
        }
        this.loading.delete(tile);
        this.ready.set(tile, levels);
      })
      .catch((err: Error) => {
        // Reported as an error (never swallowed); that 256 m tile stays on the 0.5 m base layer and is retried.
        this.loading.delete(tile);
        this.retryAfterMs[tile] = performance.now() + 15000;
        console.error(`[terrain] 0.2 m aerial tile row ${row} col ${col} failed, retry in 15 s: ${err.message}`);
      });
  }
}


/** Aerial photo -> plausible ground albedo. Shared by the map terrain and the far ring so their colours meet. */
const KDH_AERIAL_TONE_GLSL = /* glsl */ `
// DOP20 is exposed and contrast-stretched for viewing, not as an albedo: green fields sit at ~0.35 linear and
// sunlit concrete at 0.8+, three to four times real ground reflectance. Scale it down to plausible albedo
// (vegetation ~0.1-0.2, bright hard ground capped near 0.36) and give back the saturation the haze took.
vec3 kdhAerialTone(vec3 c) {
  c *= 0.6;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.22), vec3(0.0));
  float m = max(max(c.r, c.g), c.b);
  return c / (1.0 + m * m * 1.6);
}
`;

// ---------------------------------------------------------------------------------------------------
// Far terrain ring ("KindenheimTerrainFar")
// ---------------------------------------------------------------------------------------------------

const FAR_DIR = 'data/terrain/far';
const FAR_RADIUS_M = 8192;

/** Tileable-free value noise in [0, 1] on a lattice of `cell` metres (deterministic, CPU side). */
function farNoise(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const h = (a: number, b: number): number => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const a = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx;
  const b = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
  return a + (b - a) * sz;
}

const FAR_FRAGMENT_PARS = /* glsl */ `
varying vec3 vKdhWorldPos;
uniform sampler2D uKdhFarInner;
uniform sampler2D uKdhFarOuter;
uniform vec3 uKdhFarExtent; // x = inner texture side (m), y = outer texture side (m), z = map side (m)
${KDH_AERIAL_TONE_GLSL}
float kdhFarHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float kdhFarNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kdhFarHash(i), kdhFarHash(i + vec2(1.0, 0.0)), f.x), mix(kdhFarHash(i + vec2(0.0, 1.0)), kdhFarHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FAR_FRAGMENT_COLOR = /* glsl */ `
{
  vec2 kXZ = vKdhWorldPos.xz;
  // Near the map border the 3 m/px photo is magnified many times; plain bilinear turns field edges into a
  // smeared gradient next to the crisp map. Where a texel covers more than a pixel, steepen the bilinear
  // weights inside each texel ("sharp bilinear"): field, track and hedge edges stay crisp, flat areas are
  // unchanged, and the effect fades out as soon as the texture is minified.
  vec2 kUvIn = kXZ / uKdhFarExtent.x + 0.5;
  {
    vec2 kN = vec2(textureSize(uKdhFarInner, 0));
    vec2 kP = kUvIn * kN - 0.5;
    float kTexPerPx = max(length(dFdx(kP)), length(dFdy(kP)));
    float kSharp = mix(1.0, 1.75, 1.0 - smoothstep(0.25, 0.9, kTexPerPx));
    vec2 kI = floor(kP);
    vec2 kF = clamp((kP - kI - 0.5) * kSharp + 0.5, 0.0, 1.0);
    kUvIn = (kI + kF + 0.5) / kN;
  }
  vec3 kIn = textureGrad(uKdhFarInner, kUvIn, dFdx(kXZ / uKdhFarExtent.x), dFdy(kXZ / uKdhFarExtent.x)).rgb;
  vec3 kOut = texture2D(uKdhFarOuter, kXZ / uKdhFarExtent.y + 0.5).rgb;
  float kCheb = max(abs(kXZ.x), abs(kXZ.y));
  float kInner = uKdhFarExtent.x * 0.5;
  vec3 kC = kdhAerialTone(mix(kIn, kOut, smoothstep(kInner - 500.0, kInner - 40.0, kCheb)));
  // The photo is 3-8 m/px: within a few hundred metres give it some grain so it does not read as a blur.
  float kD = distance(cameraPosition, vKdhWorldPos);
  float kGrain = kdhFarNoise(kXZ * 0.35) * 0.6 + kdhFarNoise(kXZ * 1.9) * 0.4;
  // (a finer third octave close by hides the 3 m texel grid of the magnified photo)
  kGrain = mix(kGrain, kGrain * 0.6 + kdhFarNoise(kXZ * 4.3 + 17.0) * 0.4, 1.0 - smoothstep(60.0, 300.0, kD));
  kC *= 1.0 + (kGrain - 0.5) * 0.3 * (1.0 - smoothstep(120.0, 900.0, kD));
  diffuseColor.rgb = kC;
}
`;

// ---------------------------------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------------------------------

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
varying vec3 vKdhWorldPos;
varying vec3 vKdhWorldNormal;
uniform sampler2D uKdhBase;
uniform sampler2D uKdhAtlas;
uniform sampler2D uKdhSplat;
uniform sampler2D uKdhRelief;
uniform float uKdhTileFade[64];
uniform vec4 uKdhHiWin;     // xy focus (world x, z), z = inner radius, w = outer radius
uniform vec4 uKdhAtlasInfo; // x tiles per side, y slot size, z gutter, w tile size (atlas uv units)
uniform vec2 uKdhHiParams;  // x = max anisotropy, y = atlas size in px (0 = streamed window disabled)
uniform float uKdhMapSize;
uniform float uKdhDetail;
uniform vec2 uKdhDetailRange; // close-range materials: full strength up to x metres, gone at y
${KDH_GROUND_GLSL}
vec3 kdhWorldN;
float kdhRough;

${KDH_AERIAL_TONE_GLSL}
`;

const TERRAIN_FRAGMENT_COLOR = /* glsl */ `
{
  vec3 kP = vKdhWorldPos;
  float kDist = distance(cameraPosition, kP);
  vec2 kUv = clamp(kP.xz / uKdhMapSize + 0.5, 0.0, 1.0); // u: west -> east, v: north -> south

  // ---- aerial photo: 0.5 m base everywhere, 0.2 m streamed window around the focus point ----
  vec3 kAer = texture2D(uKdhBase, kUv).rgb;
  // Taken here, outside of every branch, because implicit derivatives are undefined inside them.
  vec3 kMid = kdhAerialTone(texture2D(uKdhBase, kUv, 3.0).rgb);   // ~4 m: parcel / lawn colour without blotches
  float kLowL = kdhLuma(kdhAerialTone(texture2D(uKdhBase, kUv, 4.5).rgb));
  vec2 kDx = dFdx(kP.xz);
  vec2 kDy = dFdy(kP.xz);
  vec2 kBst = vec2(kP.x + kP.z, kP.y * 1.3);   // along-slope coordinates for steep banks
  vec2 kBdx = dFdx(kBst);
  vec2 kBdy = dFdy(kBst);
  if (uKdhHiParams.y > 0.0) {
    float kWin = 1.0 - smoothstep(uKdhHiWin.z, uKdhHiWin.w, distance(kP.xz, uKdhHiWin.xy));
    if (kWin > 0.0) {
      float kN = uKdhAtlasInfo.x;
      vec2 kT = kUv * kN;
      vec2 kTi = min(floor(kT), kN - 1.0);
      float kLoaded = uKdhTileFade[int(kTi.y * kN + kTi.x)];
      vec2 kSlot = mod(kTi, 3.0);
      vec2 kAUv = kSlot * uKdhAtlasInfo.y + uKdhAtlasInfo.z + (kT - kTi) * uKdhAtlasInfo.w;
      // Continuous gradients (the atlas uv jumps at tile borders) and a mip clamp so samples stay inside the gutter.
      float kScale = kN * uKdhAtlasInfo.w;
      vec2 kGx = dFdx(kUv) * kScale;
      vec2 kGy = dFdy(kUv) * kScale;
      float kLx = length(kGx) * uKdhHiParams.y;
      float kLy = length(kGy) * uKdhHiParams.y;
      float kMaj = max(kLx, kLy);
      float kMin = max(min(kLx, kLy), 1e-5);
      float kMaxMaj = 12.0 * min(uKdhHiParams.x, kMaj / kMin);
      if (kMaj > kMaxMaj) {
        kGx *= kMaxMaj / kMaj;
        kGy *= kMaxMaj / kMaj;
      }
      vec3 kHi = textureGrad(uKdhAtlas, kAUv, kGx, kGy).rgb;
      kAer = mix(kAer, kHi, kWin * kLoaded);
    }
  }
  kAer = kdhAerialTone(kAer);

  // ---- 1 m LiDAR micro-relief: residual slope on top of the 4 m mesh normal + cavity term ----
  vec3 kRel = texture2D(uKdhRelief, kUv).rgb;
  vec2 kSl = kRel.xy * 2.0 - 1.0;
  kSl = sign(kSl) * kSl * kSl;
  kSl *= step(0.012, abs(kSl)); // drop JPEG / quantisation noise on flat ground
  float kRelFade = 1.0 - smoothstep(700.0, 1500.0, kDist);
  vec3 kN3 = normalize(normalize(vKdhWorldNormal) + vec3(-kSl.x, 0.0, -kSl.y) * kRelFade);
  kAer *= mix(1.0, kRel.z, 0.75);

  // ---- PBR ground materials (full strength near the camera, fading into the photo at distance) ----
  float kNear = (1.0 - smoothstep(uKdhDetailRange.x, uKdhDetailRange.y, kDist)) * uKdhDetail;
  kdhRough = 0.93;
  if (kNear > 0.004) {
    float kFar = smoothstep(7.0, 42.0, kDist) * 0.82;
    float kFine = 1.0 - smoothstep(30.0, 110.0, kDist);
    vec2 kSu = vec2(clamp(kUv.x, 0.0005, 0.9995) * 0.5, kUv.y);
    vec3 kSa = texture2D(uKdhSplat, kSu).rgb;
    vec3 kSb = texture2D(uKdhSplat, kSu + vec2(0.5, 0.0)).rgb;
    float kSum = max(dot(kSa + kSb, vec3(1.0)), 1e-3);
    float kW[6];
    kW[0] = kSa.r / kSum; kW[1] = kSa.g / kSum; kW[2] = kSa.b / kSum;
    kW[3] = kSb.r / kSum; kW[4] = kSb.g / kSum; kW[5] = kSb.b / kSum;

    // The material map holds hard classes (anti-aliased over ~1 m). Borders are re-sharpened here: the strongest
    // material wins outright. Natural borders (grass / soil / gravel) get a 0.3-1.5 m noise wobble; borders of
    // laid surfaces (pavers, asphalt) stay straight and get an edging-stone line against lawn.
    float kPaved = kW[4] + kW[5];
    float kGrass = kW[0];
    float kWobble = 0.42 * (1.0 - smoothstep(0.02, 0.2, kPaved));
    float kWs = 0.0;
    for (int i = 0; i < 6; i++) {
      float band = 1.0 - abs(kW[i] * 2.0 - 1.0);
      float nz = kdhNoise(kP.xz * 0.9 + float(i) * 17.3) * 0.65 + kdhNoise(kP.xz * 3.6 + float(i) * 5.1) * 0.35;
      float w = max(kW[i] + (nz - 0.5) * kWobble * band, 0.0);
      w *= w;
      w *= w;
      w *= w;
      kW[i] = w * w;   // ^16: a 0.1 m wide transition
      kWs += kW[i];
    }
    kWs = max(kWs, 1e-9);

    float kAerL = kdhLuma(kAer);
    float kMidL = max(kdhLuma(kMid), 0.01);
    // What the photo adds on top of the ~4 m colour: vine rows, wheel tracks, mowing stripes. Used at distance
    // only - up close it would stamp cars, blur and leftover shadow rims onto the scanned materials.
    float kPhotoDetail = clamp(kAerL / kMidL, 0.72, 1.3);
    float kPhoto = smoothstep(22.0, 90.0, kDist);

    vec3 kCol = vec3(0.0);
    vec2 kNst = vec2(0.0);
    float kR = 0.0;
    float kVeg = 0.0;
    for (int i = 0; i < 6; i++) {
      float w = kW[i] / kWs;
      if (w < 0.01) continue;
      vec3 a;
      vec2 n;
      float r;
      kdhGroundSample(i, kP.xz, kDx, kDy, kFar, a, n, r);
      vec3 mean = uKdhGroundMean[i];
      vec3 ratio = a / max(mean, vec3(0.01));
      vec3 target;
      if (i < 3) {
        if (i == 0) {
          // grass follows the parcel's colour in the photo, keeps the scan's blades
          target = mix(mean, kMid, 0.55);
        } else {
          // Straw and soil keep their own hue (under stubble and row crops the June photo still shows the green
          // canopy) and only take the photo's brightness, within limits.
          vec3 own = i == 1 ? mean * 0.62 : mean * 1.15;
          target = own * clamp(mix(kdhLuma(own), kMidL, 0.5) / kdhLuma(own), 0.75, 1.3);
        }
        target /= 1.0 + max(0.0, kdhLuma(target) - 0.19) * 3.5;   // sun-bleached loess / straw, but never white
        target *= mix(1.0, kPhotoDetail, kPhoto * 0.9);
        kVeg += w;
      } else {
        // gravel / pavers / asphalt: the scan's own colour; the photo may only shade it a little
        float ml = kdhLuma(mean);
        target = mean * clamp(mix(ml, kLowL, 0.5) / ml, i == 5 ? 0.62 : 0.84, i == 5 ? 0.8 : 1.12);
        target *= mix(1.0, kPhotoDetail, kPhoto * 0.45);
      }
      kCol += ratio * target * w;
      kNst += n * w;
      kR += r * w;
    }
    // A scanned lawn is too even for a field: add tufts / thin patches (0.4-2.5 m) and straw-coloured tips.
    float kTuft = kdhFbm(kP.xz * 0.42);
    float kTuft2 = kdhFbm(kP.xz * 2.1 + 9.0);
    kCol *= 1.0 + kVeg * ((kTuft - 0.5) * 0.3 + (kTuft2 - 0.5) * 0.2) * (1.0 - 0.6 * kPhoto);
    kCol = mix(kCol, kCol * vec3(1.2, 1.04, 0.7), kVeg * smoothstep(0.55, 0.8, kTuft) * 0.4);
    // Vegetation reads flat and grey-green in the photo; restore some saturation up close.
    float kcl = kdhLuma(kCol);
    kCol = mix(vec3(kcl), kCol, 1.0 + 0.2 * kVeg);

    // Edging stones where paving meets lawn: a 12 cm concrete line with a joint every metre.
    float kEdge = (1.0 - smoothstep(0.035, 0.075, abs(kPaved - 0.5))) * smoothstep(0.2, 0.4, kGrass + kPaved - 0.5) * kFine;
    if (kEdge > 0.01) {
      float joint = 1.0 - smoothstep(0.0, 0.03, abs(fract((kP.x + kP.z) * 0.7071) - 0.5) - 0.47);
      kCol = mix(kCol, vec3(0.3, 0.295, 0.28) * (0.85 + 0.25 * kTuft2) * (1.0 - 0.45 * joint), kEdge);
      kR = mix(kR, 0.8, kEdge);
      kNst *= 1.0 - kEdge;
    }

    // Steep banks (cut slopes, pit walls): a top-down texture stretches there, so use bare earth mapped along
    // the slope instead.
    float kSteep = smoothstep(0.17, 0.3, 1.0 - normalize(vKdhWorldNormal).y);
    if (kSteep > 0.01) {
      vec3 ba;
      vec2 bn;
      float br;
      kdhGroundSample(2, kBst, kBdx, kBdy, kFar, ba, bn, br);
      vec3 bank = ba / max(uKdhGroundMean[2], vec3(0.01)) * vec3(0.15, 0.115, 0.08);
      bank = mix(bank, kCol, 0.25 * kVeg);
      kCol = mix(kCol, bank, kSteep);
      kR = mix(kR, br, kSteep);
      kNst *= 1.0 - kSteep;
    }
    kCol *= mix(1.0, kRel.z, 0.75);

    kAer = mix(kAer, kCol, kNear * mix(1.0, 0.95, kVeg));
    kdhRough = mix(kdhRough, kR, kNear);
    float kNrm = (1.0 - smoothstep(18.0, 120.0, kDist)) * uKdhDetail;
    kN3 = normalize(kN3 + vec3(kNst.x, 0.0, kNst.y) * (0.85 * kNrm));
  }

  diffuseColor.rgb = kAer;
  kdhWorldN = kN3;
}
`;

export class TerrainSystem {
  public readonly meta: MetaData;
  public readonly heightmap: Float32Array;
  public readonly gridSize: number;
  public readonly mapSizeM: number;
  public readonly halfSizeM: number;
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.MeshStandardMaterial;
  /** Shared PBR ground layers (available after `loadTextures`); the road meshes sample the same arrays. */
  public ground: GroundMaterialLibrary | null = null;
  /** Attribution of the aerial imagery as shipped in data/terrain/ortho/manifest.json (after `loadTextures`). */
  public imageryAttribution = '';

  /** Coarse outer ring out to 8.2 km (child of `mesh`, name "KindenheimTerrainFar"); set by `loadTextures`. */
  public farMesh: THREE.Mesh | null = null;

  private orthoWindow: OrthoWindow | null = null;
  private hiResWanted = true;
  private hiResUnsupported = false;
  private readonly onePixel: THREE.DataTexture;
  private readonly segments: number;

  private readonly uniforms: {
    uKdhBase: { value: THREE.Texture | null };
    uKdhAtlas: { value: THREE.Texture | null };
    uKdhSplat: { value: THREE.Texture | null };
    uKdhRelief: { value: THREE.Texture | null };
    uKdhTileFade: { value: Float32Array };
    uKdhHiWin: { value: THREE.Vector4 };
    uKdhAtlasInfo: { value: THREE.Vector4 };
    uKdhHiParams: { value: THREE.Vector2 };
    uKdhMapSize: { value: number };
    uKdhDetail: { value: number };
    uKdhDetailRange: { value: THREE.Vector2 };
    uKdhGroundAlbedo: { value: THREE.Texture | null };
    uKdhGroundNR: { value: THREE.Texture | null };
    uKdhGroundMean: { value: THREE.Vector3[] };
    uKdhGroundCfg: { value: THREE.Vector3[] };
  };

  constructor(meta: MetaData, heightmap: Float32Array) {
    this.meta = meta;
    this.heightmap = heightmap;
    this.gridSize = meta.gridSize;
    this.mapSizeM = meta.mapSizeM || 2048;
    this.halfSizeM = this.mapSizeM * 0.5;

    // One vertex per heightmap sample (512 x 512 cells of 4 m): the mesh is exactly the surface the physics samples.
    const segs = Math.min(512, Math.max(128, this.gridSize - 1));
    this.segments = segs;
    const geom = new THREE.PlaneGeometry(this.mapSizeM, this.mapSizeM, segs, segs);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.getTerrainHeight(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    geom.deleteAttribute('uv'); // everything is sampled by world position
    geom.computeBoundingSphere();
    geom.computeBoundingBox();

    this.onePixel = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
    this.onePixel.needsUpdate = true;

    const vecs = (): THREE.Vector3[] => Array.from({ length: GROUND_LAYER_COUNT }, () => new THREE.Vector3(1, 1, 1));
    this.uniforms = {
      uKdhBase: { value: null },
      uKdhAtlas: { value: null },
      uKdhSplat: { value: null },
      uKdhRelief: { value: null },
      uKdhTileFade: { value: new Float32Array(64) },
      uKdhHiWin: { value: new THREE.Vector4(0, 0, 150, 228) },
      uKdhAtlasInfo: { value: new THREE.Vector4(8, 1 / 3, 0, 1 / 3) },
      uKdhHiParams: { value: new THREE.Vector2(1, 0) },
      uKdhMapSize: { value: this.mapSizeM },
      uKdhDetail: { value: 1.0 },
      uKdhDetailRange: { value: new THREE.Vector2(90, 380) },
      uKdhGroundAlbedo: { value: null },
      uKdhGroundNR: { value: null },
      uKdhGroundMean: { value: vecs() },
      uKdhGroundCfg: { value: vecs() },
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.93,
      metalness: 0.0,
      envMapIntensity: 0.3,
    });

    // Only appends after stock #include lines (never replaces a chunk), with uKdh*/vKdh*/kdh* names only, so
    // another onBeforeCompile (e.g. cascaded shadows) can be chained before or after this one.
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vKdhWorldPos;
          varying vec3 vKdhWorldNormal;`
        )
        .replace(
          '#include <defaultnormal_vertex>',
          `#include <defaultnormal_vertex>
          vKdhWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vKdhWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${TERRAIN_FRAGMENT_COLOR}`)
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
    mat.customProgramCacheKey = () => 'kdh-terrain-v5';

    this.material = mat;
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'KindenheimTerrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.visible = false; // shown once loadTextures() has the imagery; never rendered with missing data
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.beforeRender(renderer, camera);
    // For tools (screenshots): await this after moving the camera to be sure the 0.2 m window is in.
    this.mesh.userData.kdhImageryIdle = (): boolean => this.imageryIdle;
    this.mesh.userData.kdhSetHiRes = (on: boolean): void => this.setHiResImagery(on);
    // 0..1: strength of the close-range PBR ground materials (0 = aerial photo only, the cheapest shader path).
    this.mesh.userData.kdhSetDetail = (v: number): void => {
      this.uniforms.uKdhDetail.value = THREE.MathUtils.clamp(v, 0, 1);
    };
  }

  public async loadTextures(maxAnisotropy: number): Promise<void> {
    const [manifest, baseBmp, splatBmp, reliefBmp, ground, farManifest] = await Promise.all([
      loadJsonChecked<OrthoTileManifest>(`${ORTHO_DIR}/manifest.json`),
      loadBitmapChecked(`${ORTHO_DIR}/base.webp`),
      loadBitmapChecked('data/terrain/ground_splat.png'),
      loadBitmapChecked('data/terrain/relief.jpg'),
      GroundMaterialLibrary.load(maxAnisotropy),
      loadJsonChecked<FarTerrainManifest>(`${FAR_DIR}/manifest.json`),
    ]);
    const farInner = farManifest.layers?.inner;
    const farOuter = farManifest.layers?.outer;
    if (!farInner || !farOuter || !(farInner.sideM > this.mapSizeM) || !(farOuter.sideM >= 2 * FAR_RADIUS_M)) {
      throw new Error(`Terrain: ${FAR_DIR}/manifest.json must list an inner layer wider than the map and an outer layer of at least ${2 * FAR_RADIUS_M} m`);
    }
    const [farInnerBmp, farOuterBmp] = await Promise.all([
      loadBitmapChecked(`${FAR_DIR}/${farInner.file}`, farInner.sizePx, farInner.sizePx),
      loadBitmapChecked(`${FAR_DIR}/${farOuter.file}`, farOuter.sizePx, farOuter.sizePx),
    ]);
    if (Math.abs(manifest.mapSizeM - this.mapSizeM) > 1e-6) {
      throw new Error(`Terrain: aerial manifest covers ${manifest.mapSizeM} m but the map is ${this.mapSizeM} m`);
    }
    if (!manifest.attribution) throw new Error(`Terrain: ${ORTHO_DIR}/manifest.json carries no attribution text`);
    this.imageryAttribution = manifest.attribution;
    this.mesh.userData.imageryAttribution = manifest.attribution;

    this.ground = ground;
    this.uniforms.uKdhBase.value = bitmapTexture(baseBmp, THREE.SRGBColorSpace, maxAnisotropy, true);
    this.uniforms.uKdhSplat.value = bitmapTexture(splatBmp, THREE.NoColorSpace, 1, false);
    this.uniforms.uKdhRelief.value = bitmapTexture(reliefBmp, THREE.NoColorSpace, Math.min(4, maxAnisotropy), true);
    this.uniforms.uKdhGroundAlbedo.value = ground.uniforms.uKdhGroundAlbedo.value;
    this.uniforms.uKdhGroundNR.value = ground.uniforms.uKdhGroundNR.value;
    this.uniforms.uKdhGroundMean.value = ground.uniforms.uKdhGroundMean.value;
    this.uniforms.uKdhGroundCfg.value = ground.uniforms.uKdhGroundCfg.value;

    const win = new OrthoWindow(manifest, this.mapSizeM, maxAnisotropy);
    this.orthoWindow = win;
    this.uniforms.uKdhAtlas.value = this.hiResWanted ? win.atlas : this.onePixel;
    this.uniforms.uKdhTileFade.value = win.fade;
    this.uniforms.uKdhHiWin.value = win.windowUniform;
    this.uniforms.uKdhAtlasInfo.value = win.atlasInfo;
    this.uniforms.uKdhHiParams.value.set(Math.max(1, maxAnisotropy), this.hiResWanted ? win.atlasPx : 0);

    this.farMesh = this.buildFarRing(
      bitmapTexture(farInnerBmp, THREE.SRGBColorSpace, maxAnisotropy, true),
      bitmapTexture(farOuterBmp, THREE.SRGBColorSpace, maxAnisotropy, true),
      farInner.sideM,
      farOuter.sideM
    );
    this.mesh.add(this.farMesh);
    this.mesh.visible = true;
  }

  /**
   * Turns the streamed 0.2 m aerial window on or off. Off frees its 3936 px atlas (~83 MB GPU memory) and leaves
   * the 0.5 m base layer plus the close-range ground materials — meant for low-memory / low-quality devices.
   */
  public setHiResImagery(enabled: boolean): void {
    this.hiResWanted = enabled;
    const win = this.orthoWindow;
    if (!win) return;
    if (enabled && !this.hiResUnsupported) {
      this.uniforms.uKdhHiParams.value.y = win.atlasPx;
      this.uniforms.uKdhAtlas.value = win.atlas;
    } else if (this.uniforms.uKdhHiParams.value.y > 0) {
      this.disableWindow(win);
    }
  }

  private disableWindow(win: OrthoWindow): void {
    this.uniforms.uKdhHiParams.value.y = 0;
    // A bound texture is (re)allocated by the renderer, so the uniform must point at a 1 px stand-in before the
    // atlas is released.
    this.uniforms.uKdhAtlas.value = this.onePixel;
    win.release();
  }

  /**
   * Quality contract ('low' | 'medium' | 'high' | 'ultra'), called by main.ts after load and on every change.
   *   low    : no streamed 0.2 m aerial window (frees ~80 MB), PBR ground materials only within 30-140 m
   *   medium : window on, materials within 60-260 m
   *   high / ultra : window on, materials within 90-380 m
   */
  public setQuality(level: string): void {
    if (level !== 'low' && level !== 'medium' && level !== 'high' && level !== 'ultra') {
      throw new Error(`Terrain: unknown quality level "${level}"`);
    }
    this.setHiResImagery(level !== 'low');
    const range = level === 'low' ? [30, 140] : level === 'medium' ? [60, 260] : [90, 380];
    this.uniforms.uKdhDetailRange.value.set(range[0], range[1]);
  }

  /** True when the streamed 0.2 m aerial window around the current view is completely loaded. */
  public get imageryIdle(): boolean {
    return this.orthoWindow !== null && this.uniforms.uKdhHiParams.value.y > 0 ? this.orthoWindow.idle : true;
  }

  private beforeRender(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.ground?.ensureUploaded(renderer);
    const win = this.orthoWindow;
    if (!win) return;
    // Only the player's view steers the stream (not shadow, reflection-probe or cube cameras).
    const persp = camera as THREE.PerspectiveCamera;
    if (!persp.isPerspectiveCamera || persp.fov > 100 || (camera.parent && (camera.parent as THREE.Object3D & { isCubeCamera?: boolean }).isCubeCamera)) return;
    if (!this.hiResUnsupported && renderer.capabilities.maxTextureSize < win.atlasPx) {
      // A hardware limit, reported once: the window atlas cannot exist on this GPU, the 0.5 m base layer is used.
      this.hiResUnsupported = true;
      console.warn(
        `[terrain] 0.2 m aerial window disabled: this GPU's maxTextureSize is ${renderer.capabilities.maxTextureSize}, the window atlas needs ${win.atlasPx}. Using the 0.5 m base layer only.`
      );
    }
    if (this.hiResUnsupported && this.uniforms.uKdhHiParams.value.y > 0) this.disableWindow(win);
    if (this.uniforms.uKdhHiParams.value.y > 0) win.update(renderer, camera);
  }

  /**
   * Height of the far ring at (x, z) outside the map: the map-edge profile continued outwards, relaxed into
   * low rolling loess hills, rising towards the uplands in the west and falling to the Rhine plain in the east.
   * Exactly equal to `getTerrainHeight` on the map edge. No external elevation data is used.
   */
  public getFarTerrainHeight(x: number, z: number): number {
    const half = this.halfSizeM;
    const qx = THREE.MathUtils.clamp(x, -half, half);
    const qz = THREE.MathUtils.clamp(z, -half, half);
    const d = Math.hypot(x - qx, z - qz);
    const edge = this.getTerrainHeight(qx, qz);
    if (d < 1e-6) return edge;
    const ox = (x - qx) / d;
    const oz = (z - qz) / d;

    // Edge profile averaged over +-600 m along the edge (tent-weighted) and the outward slope across 220 m.
    // A narrower window made every small valley at the border run outwards as a ridge or furrow (radial streaks).
    const tx = -oz;
    const tz = ox;
    let smooth = 0;
    let inner = 0;
    let wsum = 0;
    for (let i = -6; i <= 6; i++) {
      const w = 7 - Math.abs(i);
      const px = THREE.MathUtils.clamp(qx + tx * i * 100, -half, half);
      const pz = THREE.MathUtils.clamp(qz + tz * i * 100, -half, half);
      smooth += w * this.getTerrainHeight(px, pz);
      inner += w * this.getTerrainHeight(
        THREE.MathUtils.clamp(px - ox * 220, -half, half),
        THREE.MathUtils.clamp(pz - oz * 220, -half, half)
      );
      wsum += w;
    }
    smooth /= wsum;
    inner /= wsum;
    const slope = THREE.MathUtils.clamp((smooth - inner) / 220, -0.05, 0.05);

    // Small relief of the edge fades out over 300 m; the slope carries on and levels off (scale length 350 m).
    const relax = THREE.MathUtils.smoothstep(d, 0, 300);
    let h = edge + (smooth - edge) * relax + slope * 350 * (1 - Math.exp(-d / 350));

    // Rolling hills (1.6 km and 600 m swells) that grow in over the first kilometre.
    const grow = THREE.MathUtils.smoothstep(d, 0, 1100);
    h += grow * ((farNoise(x, z, 1600, 11) - 0.5) * 52 + (farNoise(x, z, 620, 23) - 0.5) * 20 + (farNoise(x, z, 3900, 5) - 0.5) * 60);
    // Regional trend: Pfaelzerwald / Donnersberg foothills rise to the west, the Rhine plain falls to the east.
    const west = THREE.MathUtils.smoothstep(-x, 1500, 8200);
    const east = THREE.MathUtils.smoothstep(x, 1500, 8200);
    h += grow * (west * (95 + (farNoise(x, z, 1300, 41) - 0.5) * 70) - east * 55);
    return h;
  }

  private buildFarRing(inner: THREE.Texture, outer: THREE.Texture, innerSideM: number, outerSideM: number): THREE.Mesh {
    const half = this.halfSizeM;
    // Concentric loops: the first one repeats the map border vertex for vertex (no crack), then the spacing
    // doubles and the square relaxes into a circle of FAR_RADIUS_M.
    const loops: { r: number; n: number }[] = [{ r: half, n: this.segments * 4 }];
    let r = half;
    let n = this.segments * 4;
    while (r < FAR_RADIUS_M - 1) {
      const spacing = (8 * r) / n;
      if (n > 256 && spacing < 64) n /= 2;
      r = Math.min(FAR_RADIUS_M, r + Math.max((8 * r) / n, r * 0.11));
      loops.push({ r, n });
    }

    const positions: number[] = [];
    const starts: number[] = [];
    for (const loop of loops) {
      starts.push(positions.length / 3);
      const round = THREE.MathUtils.smoothstep(loop.r, half * 1.05, half * 2.6);
      for (let i = 0; i < loop.n; i++) {
        // perimeter parameter -> point on the unit square (start at the NW corner, clockwise seen from above)
        const t = (i / loop.n) * 4;
        const side = Math.floor(t);
        const f = (t - side) * 2 - 1;
        const sx = side === 0 ? f : side === 1 ? 1 : side === 2 ? -f : -1;
        const sz = side === 0 ? -1 : side === 1 ? f : side === 2 ? 1 : -f;
        const len = Math.hypot(sx, sz);
        const ux = sx + (sx / len - sx) * round;
        const uz = sz + (sz / len - sz) * round;
        const x = ux * loop.r;
        const z = uz * loop.r;
        positions.push(x, this.getFarTerrainHeight(x, z), z);
      }
    }
    const indices: number[] = [];
    for (let l = 0; l < loops.length - 1; l++) {
      const a = loops[l];
      const b = loops[l + 1];
      let i = 0;
      let j = 0;
      // zip the two closed loops together, always advancing the one that is behind in perimeter parameter
      while (i < a.n || j < b.n) {
        const ia = starts[l] + (i % a.n);
        const ib = starts[l + 1] + (j % b.n);
        // Counter-clockwise seen from above (the loops run clockwise and outwards), so the ring faces up.
        if (j >= b.n || (i < a.n && (i + 1) / a.n <= (j + 1) / b.n)) {
          indices.push(ia, starts[l] + ((i + 1) % a.n), ib);
          i++;
        } else {
          indices.push(ia, starts[l + 1] + ((j + 1) % b.n), ib);
          j++;
        }
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    // Normals from the height function itself (central differences), not from the long, thin ring triangles:
    // face-averaged normals fan out into visible radial streaks. The seam loop reuses the map terrain's own
    // border normals so lighting is continuous across it.
    const normals = new Float32Array(positions.length);
    for (let l = 0; l < loops.length; l++) {
      const step = Math.max(6, (8 * loops[l].r) / loops[l].n) * 0.5;
      for (let i = 0; i < loops[l].n; i++) {
        const v = starts[l] + i;
        const x = positions[v * 3];
        const z = positions[v * 3 + 2];
        let nx: number;
        let ny: number;
        let nz: number;
        if (l === 0) {
          const tn = this.getTerrainNormal(x, z, this.mapSizeM / this.segments);
          nx = tn.x;
          ny = tn.y;
          nz = tn.z;
        } else {
          nx = this.getFarTerrainHeight(x - step, z) - this.getFarTerrainHeight(x + step, z);
          ny = 2 * step;
          nz = this.getFarTerrainHeight(x, z - step) - this.getFarTerrainHeight(x, z + step);
          const len = Math.hypot(nx, ny, nz);
          nx /= len;
          ny /= len;
          nz /= len;
        }
        normals[v * 3] = nx;
        normals[v * 3 + 1] = ny;
        normals[v * 3 + 2] = nz;
      }
    }
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.computeBoundingSphere();
    geom.computeBoundingBox();

    const uniforms = {
      uKdhFarInner: { value: inner },
      uKdhFarOuter: { value: outer },
      uKdhFarExtent: { value: new THREE.Vector3(innerSideM, outerSideM, this.mapSizeM) },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vKdhWorldPos;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vKdhWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${FAR_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
${FAR_FRAGMENT_COLOR}`);
    };
    mat.customProgramCacheKey = () => 'kdh-terrain-far-v2';

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'KindenheimTerrainFar';
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.frustumCulled = false; // surrounds the camera
    mesh.raycast = () => {}; // never a pick / ground-hit target
    mesh.userData.radiusM = FAR_RADIUS_M;
    // The sky continues this photo beyond the ring (LightingSystem.attachGround -> SkyAtmosphere.setOuterGround).
    mesh.userData.outerPhoto = outer;
    mesh.userData.outerPhotoSideM = outerSideM;
    return mesh;
  }

  /**
   * Exact bilinear height sampling in local world coordinates:
   * x in [-mapSizeM/2, +mapSizeM/2] (West -> East)
   * z in [-mapSizeM/2, +mapSizeM/2] (North -> South)
   * Returns meters above meta.minElevationM.
   */
  public getTerrainHeight(x: number, z: number): number {
    const n = this.gridSize;
    const half = this.halfSizeM;

    const u = THREE.MathUtils.clamp((x + half) / this.mapSizeM, 0, 1);
    const v = THREE.MathUtils.clamp((z + half) / this.mapSizeM, 0, 1);

    const gx = u * (n - 1);
    const gz = v * (n - 1);

    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, n - 1);
    const z1 = Math.min(z0 + 1, n - 1);

    const tx = gx - x0;
    const tz = gz - z0;

    const h00 = this.heightmap[z0 * n + x0];
    const h10 = this.heightmap[z0 * n + x1];
    const h01 = this.heightmap[z1 * n + x0];
    const h11 = this.heightmap[z1 * n + x1];

    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * tz;
  }

  /**
   * Height of the RENDERED terrain triangle under (x, z). The mesh splits every cell along the SW-NE diagonal,
   * so it deviates from the bilinear `getTerrainHeight` by up to a few centimetres inside a cell. Decals that
   * must hug the visible surface (roads) drape with this; physics keeps using `getTerrainHeight`.
   */
  public getRenderedSurfaceHeight(x: number, z: number): number {
    const segs = this.segments;
    const cell = this.mapSizeM / segs;
    const gx = THREE.MathUtils.clamp((x + this.halfSizeM) / cell, 0, segs);
    const gz = THREE.MathUtils.clamp((z + this.halfSizeM) / cell, 0, segs);
    const ix = Math.min(Math.floor(gx), segs - 1);
    const iz = Math.min(Math.floor(gz), segs - 1);
    const fx = gx - ix;
    const fz = gz - iz;
    const x0 = -this.halfSizeM + ix * cell;
    const z0 = -this.halfSizeM + iz * cell;
    const ha = this.getTerrainHeight(x0, z0); // NW
    const hb = this.getTerrainHeight(x0, z0 + cell); // SW
    const hc = this.getTerrainHeight(x0 + cell, z0 + cell); // SE
    const hd = this.getTerrainHeight(x0 + cell, z0); // NE
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }

  public getTerrainNormal(x: number, z: number, step = 2.0): THREE.Vector3 {
    const hL = this.getTerrainHeight(x - step, z);
    const hR = this.getTerrainHeight(x + step, z);
    const hU = this.getTerrainHeight(x, z - step);
    const hD = this.getTerrainHeight(x, z + step);
    return new THREE.Vector3(hL - hR, 2 * step, hU - hD).normalize();
  }

  public getAbsoluteElevation(x: number, z: number): number {
    return this.meta.minElevationM + this.getTerrainHeight(x, z);
  }

  public latLonToWorldXZ(lat: number, lon: number): [number, number] {
    const aff = this.meta.projection?.latLonToLocalAffine;
    if (aff) {
      const dLon = lon - this.meta.centerLon;
      const dLat = lat - this.meta.centerLat;
      const x = dLon * aff.dX_dLon + dLat * aff.dX_dLat;
      const z = dLon * aff.dZ_dLon + dLat * aff.dZ_dLat;
      return [x, z];
    }
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(THREE.MathUtils.degToRad(this.meta.centerLat));
    return [(lon - this.meta.centerLon) * metersPerDegLon, -(lat - this.meta.centerLat) * metersPerDegLat];
  }

  public worldToLatLon(x: number, z: number): { lat: number; lon: number } {
    const aff = this.meta.projection?.latLonToLocalAffine;
    if (aff) {
      const det = aff.dX_dLon * aff.dZ_dLat - aff.dX_dLat * aff.dZ_dLon;
      if (Math.abs(det) > 1e-6) {
        const dLon = (x * aff.dZ_dLat - z * aff.dX_dLat) / det;
        const dLat = (aff.dX_dLon * z - aff.dZ_dLon * x) / det;
        return {
          lat: this.meta.centerLat + dLat,
          lon: this.meta.centerLon + dLon,
        };
      }
    }
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(THREE.MathUtils.degToRad(this.meta.centerLat));
    return {
      lat: this.meta.centerLat - z / metersPerDegLat,
      lon: this.meta.centerLon + x / metersPerDegLon,
    };
  }

  public setWireframe(enabled: boolean): void {
    this.material.wireframe = enabled;
  }
}
