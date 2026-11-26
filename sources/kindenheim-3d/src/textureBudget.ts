/**
 * Per-quality texture size policy and the pixel work behind it (down-scaling, content fingerprints).
 *
 * Used only by `src/sharedAssets.ts`, which applies it to every GLB texture inside `dedupeModelTextures`
 * BEFORE the renderer uploads anything, so a capped texture never exists on the GPU at full size.
 *
 * Why a resize here is "dropping the top mip level(s)" and nothing else:
 *  - opaque maps are reduced with an exact 2x2 box filter per halving step, in linear light for sRGB maps
 *    and on the raw bytes for data maps (normal / ORM) — the same thing the GPU does in generateMipmap;
 *  - maps with an alpha channel go through a scratch WebGL2 context and read back the GPU's own mip level,
 *    because a 2D canvas stores premultiplied colour and would turn the authored colour bleed under the
 *    transparent texels of the foliage atlases into black (dark fringes, darker distant vineyards).
 * So from the distance at which the original would have sampled mip >= k, the image is the same.
 */

export type TextureBudgetLevel = 'low' | 'medium' | 'high' | 'ultra';

export const TEXTURE_BUDGET_LEVELS: readonly TextureBudgetLevel[] = ['low', 'medium', 'high', 'ultra'];

/**
 * albedo   – base colour (also alpha-BLENDED base colour: glass dirt, nets, decals)
 * cutout   – base colour of an alpha-TESTED material (foliage / crop atlases): halving these costs
 *            silhouette detail, so they keep one level more than plain albedo on `low`
 * normal   – tangent-space normal / bump
 * orm      – occlusion / roughness / metalness and every other scalar data map
 * emissive – glow masks
 */
export type TextureClass = 'albedo' | 'cutout' | 'normal' | 'orm' | 'emissive';

export const TEXTURE_CLASSES: readonly TextureClass[] = ['albedo', 'cutout', 'normal', 'orm', 'emissive'];

const UNCAPPED = 16384;

/**
 * Side length of the square texel budget per class and level: a texture is halved (both sides) until
 * `width * height <= cap * cap * AREA_SLACK`. Budgeting by area instead of by the longer side keeps thin
 * strips (banners, name signs: 1024x256) legible and treats a 2048x1024 atlas like the half 2K map it is.
 *
 * high: 2K only for base colour, where it is visible at 1.5-3 m; normal maps of 2K sources at 1K, ORM at 512
 * (checked with close-up A/B renders, see .gfx/perf/). medium: everything <= 1K. low: 512 / 256, cut-outs 1K.
 */
export const TEXTURE_SIZE_CAPS: Record<TextureBudgetLevel, Record<TextureClass, number>> = {
  ultra: { albedo: UNCAPPED, cutout: UNCAPPED, normal: UNCAPPED, orm: 1024, emissive: 1024 },
  high: { albedo: 2048, cutout: 2048, normal: 1024, orm: 512, emissive: 1024 },
  medium: { albedo: 1024, cutout: 1024, normal: 1024, orm: 512, emissive: 512 },
  low: { albedo: 512, cutout: 1024, normal: 512, orm: 256, emissive: 256 },
};

/** A 3:2 atlas (2048x3072 tyre map) may stop one level above the square budget instead of two below it. */
const AREA_SLACK = 1.5;
/** Never reduce below this many texels on the shorter side (tiny lookup strips stay intact). */
const MIN_SIDE = 32;

export function isTextureBudgetLevel(v: unknown): v is TextureBudgetLevel {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra';
}

/** Material slot -> policy class. `alphaTested` only matters for the base-colour slot. */
export function classifyTextureSlot(slot: string, alphaTested: boolean): TextureClass {
  switch (slot) {
    case 'map':
      return alphaTested ? 'cutout' : 'albedo';
    case 'alphaMap':
      return 'cutout';
    case 'sheenColorMap':
    case 'specularColorMap':
      return 'albedo';
    case 'normalMap':
    case 'bumpMap':
    case 'clearcoatNormalMap':
      return 'normal';
    case 'emissiveMap':
      return 'emissive';
    default:
      return 'orm';
  }
}

export interface TargetSize {
  width: number;
  height: number;
  /** Number of halving steps (= mip level of the original that becomes the new base level). */
  steps: number;
}

export function targetSizeFor(width: number, height: number, cap: number): TargetSize {
  let w = width;
  let h = height;
  let steps = 0;
  const budget = cap * cap * AREA_SLACK;
  while (w * h > budget && Math.min(w, h) >= MIN_SIDE * 2) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    steps++;
  }
  return { width: w, height: h, steps };
}

/** GPU bytes of an RGBA8 texture, with the full mip chain when `mipmaps` is set. */
export function gpuBytes(width: number, height: number, mipmaps: boolean): number {
  const base = width * height * 4;
  return mipmaps ? Math.round((base * 4) / 3) : base;
}

// ---------------------------------------------------------------------------------------------
// Pixel access
// ---------------------------------------------------------------------------------------------

export type DrawableImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export function isDrawableImage(image: unknown): image is DrawableImage {
  if (!image || typeof image !== 'object') return false;
  return (
    (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
    (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)
  );
}

interface Scratch2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const scratch2d: (Scratch2D | null)[] = [null, null];

/** CPU-backed 2D canvases (willReadFrequently): no GPU memory, exact read-back. */
function getScratch2D(index: 0 | 1, width: number, height: number): Scratch2D {
  let s = scratch2d[index];
  if (!s) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('[textureBudget] 2D canvas context unavailable: cannot fingerprint or resize GLB textures');
    s = { canvas, ctx };
    scratch2d[index] = s;
  }
  // assigning the size also clears the canvas and resets the context state
  s.canvas.width = width;
  s.canvas.height = height;
  return s;
}

interface ScratchGl {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  fbo: WebGLFramebuffer;
}

let scratchGl: ScratchGl | null = null;

function getScratchGl(): ScratchGl {
  if (scratchGl && !scratchGl.gl.isContextLost()) return scratchGl;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    throw new Error(
      '[textureBudget] could not create the scratch WebGL2 context that down-scales textures with an alpha channel ' +
        '(foliage / crop atlases). Without it their colour under transparent texels would be lost.'
    );
  }
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('[textureBudget] scratch WebGL2 context could not create a framebuffer');
  scratchGl = { canvas, gl, fbo };
  return scratchGl;
}

/** Frees the scratch canvases and the scratch GL context (called once loading has gone quiet). */
export function releaseTextureScratch(): void {
  for (let i = 0; i < scratch2d.length; i++) {
    const s = scratch2d[i];
    if (s) {
      s.canvas.width = 0;
      s.canvas.height = 0;
    }
    scratch2d[i] = null;
  }
  if (scratchGl) {
    const { gl, fbo, canvas } = scratchGl;
    gl.deleteFramebuffer(fbo);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.width = 0;
    canvas.height = 0;
    scratchGl = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Content fingerprints
// ---------------------------------------------------------------------------------------------

export interface TextureFingerprint {
  /** Two independent 32-bit hashes over a regular grid of point samples (every 8th texel on 2K..256 px maps). */
  hash: string;
  /** True when at least one sampled texel is not fully opaque. */
  sampledAlpha: boolean;
}

function hashWords(words: Uint32Array): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < words.length; i++) {
    const v = words[i];
    a = Math.imul(a ^ v, 0x01000193);
    b = Math.imul(b ^ (v >>> 15) ^ v, 0x85ebca6b);
    b = (b << 13) | (b >>> 19);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

function fingerprintStride(width: number, height: number): number {
  const s = Math.min(width, height);
  return s >= 256 ? 8 : s >= 128 ? 4 : s >= 64 ? 2 : 1;
}

/**
 * Cheap, deterministic fingerprint of the decoded pixels: nearest-neighbour samples on a regular grid,
 * hashed. Byte-identical files always agree; a re-encode (every texel off by a level or two), a tint or
 * any edited region of 8x8 texels or more makes it differ. Colour under fully transparent texels is not
 * part of it (the 2D canvas premultiplies).
 */
export function fingerprintDrawable(image: DrawableImage, width: number, height: number): TextureFingerprint {
  const stride = fingerprintStride(width, height);
  const w = Math.max(1, Math.floor(width / stride));
  const h = Math.max(1, Math.floor(height / stride));
  const { ctx } = getScratch2D(0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  let alphaAnd = 255;
  for (let i = 3; i < data.length; i += 4) alphaAnd &= data[i];
  return { hash: hashWords(words), sampledAlpha: alphaAnd !== 255 };
}

/** Fingerprint for sources that carry raw bytes (ImageData, DataTexture, compressed mip 0). */
export function fingerprintBytes(bytes: ArrayBufferView): TextureFingerprint {
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = u8.length >> 2;
  const step = Math.max(1, Math.floor(n / 65536));
  const words = new Uint32Array(Math.ceil(n / step) + 1);
  let k = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    words[k++] = u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24);
  }
  words[k] = u8.length;
  return { hash: hashWords(words.subarray(0, k + 1)), sampledAlpha: false };
}

export const THUMB_SIDE = 16;

export interface PixelBlock {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decoded RGBA bytes of a drawable (premultiplied by the canvas: colour under alpha 0 reads as 0). */
export function readDrawablePixels(image: DrawableImage, width: number, height: number): PixelBlock {
  const { ctx } = getScratch2D(0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * 16x16 area-averaged RGB thumbnail of an OPAQUE image, averaged in linear light for sRGB maps and on the
 * raw bytes for data maps — the same arithmetic as the box-filter resize below, so a texture and its
 * down-scaled copy give the same thumbnail (to rounding). Used to decide whether two differently encoded
 * or differently sized images show the same picture.
 */
export function areaThumbnail(px: PixelBlock, srgb: boolean): Uint8ClampedArray {
  const { data, width, height } = px;
  const n = THUMB_SIDE;
  const sums = new Float64Array(n * n * 3);
  const counts = new Uint32Array(n * n);
  const binX = new Uint8Array(width);
  for (let x = 0; x < width; x++) binX[x] = Math.min(n - 1, Math.floor((x * n) / width));
  const dec = srgb ? srgbTables().dec : null;
  for (let y = 0; y < height; y++) {
    const rowBin = Math.min(n - 1, Math.floor((y * n) / height)) * n;
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const b = rowBin + binX[x];
      const o = b * 3;
      if (dec) {
        sums[o] += dec[data[i]];
        sums[o + 1] += dec[data[i + 1]];
        sums[o + 2] += dec[data[i + 2]];
      } else {
        sums[o] += data[i];
        sums[o + 1] += data[i + 1];
        sums[o + 2] += data[i + 2];
      }
      counts[b]++;
    }
  }
  const out = new Uint8ClampedArray(n * n * 3);
  for (let b = 0; b < n * n; b++) {
    const c = counts[b];
    if (c === 0) continue; // image narrower than the thumbnail: empty bins stay 0 on both sides of a comparison
    for (let ch = 0; ch < 3; ch++) {
      const mean = sums[b * 3 + ch] / c;
      if (dec) {
        const lin = mean / 16383;
        out[b * 3 + ch] = Math.round((lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055) * 255);
      } else {
        out[b * 3 + ch] = Math.round(mean);
      }
    }
  }
  return out;
}

export interface ThumbDifference {
  mean: number;
  max: number;
}

export function thumbnailDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): ThumbDifference {
  if (a.length !== b.length) throw new Error(`[textureBudget] thumbnail size mismatch (${a.length} vs ${b.length})`);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / a.length, max };
}

/**
 * Same picture, different encode or resampling. Calibrated on the shipped GLBs: library maps against their
 * own `_1k` / `_512` exports and against other builders' re-encodes differ by <= 0.5 mean / <= 3 max.
 */
export function thumbnailsMatch(d: ThumbDifference): boolean {
  return d.mean <= 1.5 && d.max <= 8;
}

// ---------------------------------------------------------------------------------------------
// Down-scaling
// ---------------------------------------------------------------------------------------------

let srgbDecode: Uint16Array | null = null;
let srgbEncode: Uint8Array | null = null;

/** sRGB byte -> linear * 16383 (four of them sum to < 65536); the inverse table maps that sum back. */
function srgbTables(): { dec: Uint16Array; enc: Uint8Array } {
  if (!srgbDecode || !srgbEncode) {
    const dec = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      const lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      dec[i] = Math.round(lin * 16383);
    }
    const enc = new Uint8Array(65536);
    for (let i = 0; i < 65536; i++) {
      const lin = Math.min(1, i / (16383 * 4));
      const c = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
      enc[i] = Math.round(c * 255);
    }
    srgbDecode = dec;
    srgbEncode = enc;
  }
  return { dec: srgbDecode, enc: srgbEncode };
}

/** One exact 2x2 box-filter step. Returns null as soon as a texel that is not fully opaque shows up. */
function halveOpaque(src: PixelBlock, srgb: boolean): PixelBlock | null {
  const sw = src.width;
  const w = Math.max(1, sw >> 1);
  const h = Math.max(1, src.height >> 1);
  const dx = sw > 1 ? 4 : 0;
  const dy = src.height > 1 ? sw * 4 : 0;
  const s = src.data;
  const out = new Uint8ClampedArray(w * h * 4);
  let alphaAnd = 255;
  let o = 0;
  if (srgb) {
    const { dec, enc } = srgbTables();
    for (let y = 0; y < h; y++) {
      let i = y * 2 * sw * 4;
      for (let x = 0; x < w; x++, i += 8, o += 4) {
        const j = i + dx;
        const k = i + dy;
        const l = k + dx;
        out[o] = enc[dec[s[i]] + dec[s[j]] + dec[s[k]] + dec[s[l]]];
        out[o + 1] = enc[dec[s[i + 1]] + dec[s[j + 1]] + dec[s[k + 1]] + dec[s[l + 1]]];
        out[o + 2] = enc[dec[s[i + 2]] + dec[s[j + 2]] + dec[s[k + 2]] + dec[s[l + 2]]];
        out[o + 3] = 255;
        alphaAnd &= s[i + 3] & s[j + 3] & s[k + 3] & s[l + 3];
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      let i = y * 2 * sw * 4;
      for (let x = 0; x < w; x++, i += 8, o += 4) {
        const j = i + dx;
        const k = i + dy;
        const l = k + dx;
        out[o] = (s[i] + s[j] + s[k] + s[l] + 2) >> 2;
        out[o + 1] = (s[i + 1] + s[j + 1] + s[k + 1] + s[l + 1] + 2) >> 2;
        out[o + 2] = (s[i + 2] + s[j + 2] + s[k + 2] + s[l + 2] + 2) >> 2;
        out[o + 3] = 255;
        alphaAnd &= s[i + 3] & s[j + 3] & s[k + 3] & s[l + 3];
      }
    }
  }
  return alphaAnd === 255 ? { data: out, width: w, height: h } : null;
}

/** CPU path for opaque images. Returns null when the image turns out to have an alpha channel in use. */
function downscaleOpaque(image: DrawableImage, width: number, height: number, steps: number, srgb: boolean): ImageData | null {
  let px: PixelBlock | null = readDrawablePixels(image, width, height);
  for (let s = 0; s < steps && px; s++) px = halveOpaque(px, srgb);
  if (!px) return null;
  return new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height);
}

/**
 * GPU path for images with alpha: upload once to a scratch context exactly as three would (no
 * premultiplication, no colour conversion), let the GPU build its mip chain and read level `steps` back.
 * The scratch texture is deleted before returning; the renderer's own context never sees the full size.
 */
function downscaleWithAlpha(image: DrawableImage, width: number, height: number, steps: number, srgb: boolean, what: string): ImageData {
  const { gl, fbo } = getScratchGl();
  const w = Math.max(1, width >> steps);
  const h = Math.max(1, height >> steps);
  const tex = gl.createTexture();
  if (!tex) throw new Error(`[textureBudget] scratch texture allocation failed while resizing ${what}`);
  const out = new Uint8ClampedArray(w * h * 4);
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, steps);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[textureBudget] scratch framebuffer incomplete (0x${status.toString(16)}) while resizing ${what} ${width}x${height} -> ${w}x${h}`);
    }
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      throw new Error(`[textureBudget] WebGL error 0x${err.toString(16)} while resizing ${what} ${width}x${height} -> ${w}x${h}`);
    }
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(tex);
  }
  return new ImageData(out as Uint8ClampedArray<ArrayBuffer>, w, h);
}

export interface DownscaleResult {
  image: ImageData;
  /** 'cpu' = box filter in JS (opaque), 'gpu' = scratch-context mip read-back (alpha in use). */
  path: 'cpu' | 'gpu';
}

/**
 * Reduces `image` by `steps` halvings. `mayHaveAlpha` (from the fingerprint samples or the mime type) only
 * picks the first path to try; the CPU path detects alpha exactly and hands over to the GPU path.
 */
export function downscaleImage(
  image: DrawableImage,
  width: number,
  height: number,
  steps: number,
  srgb: boolean,
  mayHaveAlpha: boolean,
  what: string
): DownscaleResult {
  if (steps < 1) throw new Error(`[textureBudget] downscaleImage called with steps=${steps} for ${what}`);
  if (!mayHaveAlpha) {
    const cpu = downscaleOpaque(image, width, height, steps, srgb);
    if (cpu) return { image: cpu, path: 'cpu' };
  }
  return { image: downscaleWithAlpha(image, width, height, steps, srgb, what), path: 'gpu' };
}
