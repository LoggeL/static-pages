import {
  ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat,
} from 'three';
import { fetchAsset, throwIfAborted, withLoadDeadline } from './load-guards.js';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// RGBM alpha is a multiplier, not coverage. Canvas RGBA8 can quantize RGB while
// premultiplying, even with createImageBitmap({ premultiplyAlpha: 'none' }).
// Decode the generated straight-alpha PNG bytes with the browser's zlib inflater.
// Older Safari uses the vendored Three r170 fflate 0.8.2 inflater, also byte-exact.
// This deliberately supports only the pipeline's non-interlaced RGBA8 format.
export async function decodePngRgba8(buffer, { signal, timeoutMs, onWarning = () => {} } = {}) {
  throwIfAborted(signal);
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) {
    throw new Error('Lightmap ist keine gültige PNG-Datei');
  }
  let width = 0, height = 0, ended = false;
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Unvollständiger PNG-Block');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = offset + 8;
    if (type === 'IHDR') {
      width = view.getUint32(data); height = view.getUint32(data + 4);
      if (!width || !height || width > 8192 || height > 8192 || length !== 13 ||
          bytes[data + 8] !== 8 || bytes[data + 9] !== 6 ||
          bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] !== 0) {
        throw new Error('RGBM benötigt nicht-interlaced RGBA8-PNG');
      }
    } else if (type === 'IDAT') chunks.push(bytes.subarray(data, data + length));
    else if (type === 'IEND') { ended = true; break; }
    offset = end;
  }
  if (!width || !chunks.length || !ended) throw new Error('PNG-Daten unvollständig');
  const stride = width * 4;
  const expectedBytes = (stride + 1) * height;
  let inflater;
  if (typeof DecompressionStream === 'function') {
    try { inflater = new DecompressionStream('deflate'); } catch { /* Older Safari format support. */ }
  }
  let inflated;
  if (inflater) {
    inflated = await withLoadDeadline(async activeSignal => {
      const stream = new Blob(chunks).stream().pipeThrough(inflater);
      const reader = stream.getReader();
      const cancel = () => { reader.cancel(activeSignal.reason).catch(() => {}); };
      activeSignal.addEventListener('abort', cancel, { once: true });
      const output = new Uint8Array(expectedBytes);
      let offset = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          throwIfAborted(activeSignal);
          if (done) break;
          if (offset + value.length > output.length) throw new Error('PNG-Datenlänge stimmt nicht');
          output.set(value, offset); offset += value.length;
        }
        if (offset !== output.length) throw new Error('PNG-Datenlänge stimmt nicht');
        return output;
      } finally {
        activeSignal.removeEventListener('abort', cancel);
        reader.cancel().catch(() => {});
      }
    }, { signal, timeoutMs, label: 'RGBM-PNG entpacken' });
  } else {
    console.info('[bodycam/world] Kompatibler PNG-Decoder aktiv.');
    const { unzlibSync } = await withLoadDeadline(() => import('./fflate.module.js'), {
      signal, timeoutMs, label: 'Kompatiblen PNG-Decoder laden',
    });
    throwIfAborted(signal);
    const compressed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { compressed.set(chunk, offset); offset += chunk.length; }
    inflated = unzlibSync(compressed, { out: new Uint8Array(expectedBytes + 1) });
    // fflate does not validate the zlib checksum. Reject corrupt streams explicitly.
    let a = 1, b = 0;
    for (let i = 0; i < inflated.length; i++) { a = (a + inflated[i]) % 65521; b = (b + a) % 65521; }
    const checksum = new DataView(compressed.buffer).getUint32(compressed.length - 4);
    if (((b << 16 | a) >>> 0) !== checksum) throw new Error('PNG-Prüfsumme stimmt nicht');
  }
  throwIfAborted(signal);
  if (inflated.length !== (stride + 1) * height) throw new Error('PNG-Datenlänge stimmt nicht');
  const rgba = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    if ((row & 63) === 0) throwIfAborted(signal);
    const input = row * (stride + 1), output = row * stride, filter = inflated[input];
    if (filter > 4) throw new Error(`Unbekannter PNG-Filter ${filter}`);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[output + x - 4] : 0;
      const b = row ? rgba[output + x - stride] : 0;
      const c = row && x >= 4 ? rgba[output + x - stride - 4] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b
        : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      rgba[output + x] = (inflated[input + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, rgba };
}

export function rgbmToTexture({ width, height, rgba }, { path, range, multiplierExponent = 1, signal }) {
  throwIfAborted(signal);
  if (!(range > 0 && Number.isFinite(range))) throw new Error(`Ungültige RGBM-Range: ${path}`);
  if (!(multiplierExponent > 0 && Number.isFinite(multiplierExponent))) throw new Error(`Ungültiger RGBM-Exponent: ${path}`);
  const data = new Uint16Array(rgba.length);
  let peak = 0, luminanceSum = 0, nonzero = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if ((i & 16383) === 0) throwIfAborted(signal);
    const multiplier = Math.pow(rgba[i + 3] / 255, multiplierExponent) * range / 255;
    const r = rgba[i] * multiplier, g = rgba[i + 1] * multiplier, b = rgba[i + 2] * multiplier;
    data[i] = DataUtils.toHalfFloat(r);
    data[i + 1] = DataUtils.toHalfFloat(g);
    data[i + 2] = DataUtils.toHalfFloat(b);
    data[i + 3] = DataUtils.toHalfFloat(1);
    peak = Math.max(peak, r, g, b);
    luminanceSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (r + g + b > 0) nonzero++;
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  texture.name = path;
  texture.channel = 1; // glTF TEXCOORD_1 is geometry.attributes.uv1 in Three r170.
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  // Avoid mixing unrelated packed islands at coarse mip levels.
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.userData = { path, range, multiplierExponent, encoding: 'RGBM', decodedBeforeFiltering: true,
    width, height, peak, meanLuminance: luminanceSum / (width * height),
    nonzeroFraction: nonzero / (width * height), decodedBytes: data.byteLength };
  return texture;
}

// Lossless WebP siblings are ~28 % smaller than the PNGs. Only a WebGL2 upload with premultiplication
// off returns their exact bytes, from an <img> in WebKit and from an unpremultiplied ImageBitmap in
// Chrome (ImageDecoder and 2D canvas premultiply). A probe with low-alpha pixels picks the first exact
// source per browser; without one the PNG decoder stays.
const WEBP_PROBE = 'UklGRjYAAABXRUJQVlA4TCoAAAAvAwAAEBDTENNV/7klERIQWfT/kFeEBER2xw+fTCeYpKnt8V0+wux+boE=';
const WEBP_PROBE_RGBA = [200, 100, 50, 3, 17, 250, 128, 254, 255, 1, 77, 128, 9, 240, 9, 1];
const WEBP_SOURCES = {
  async image(blob) {
    const url = URL.createObjectURL(blob), image = new Image();
    try {
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close() {} };
    } finally { URL.revokeObjectURL(url); }
  },
  async bitmap(blob) {
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  },
};
let webpReader;

async function readWebpRgba8(blob, gl, decode) {
  const { source, width, height, close } = await decode(blob);
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
  try {
    if (width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      throw new Error('WebP-Atlas zu groß');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('WebP-Auslesen nicht möglich');
    const rgba = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('WebP-Auslesen fehlgeschlagen');
    return { width, height, rgba };
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture);
    close();
  }
}

function exactWebpReader() {
  webpReader ??= (async () => {
    let gl = null;
    try { gl = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('webgl2') : null; } catch { /* none */ }
    gl ??= typeof document === 'object' ? document.createElement('canvas').getContext('webgl2') : null;
    if (!gl) return null;
    const bytes = Uint8Array.from(atob(WEBP_PROBE), char => char.charCodeAt(0));
    for (const decode of Object.values(WEBP_SOURCES)) {
      try {
        const { rgba } = await readWebpRgba8(new Blob([bytes], { type: 'image/webp' }), gl, decode);
        if (WEBP_PROBE_RGBA.every((value, index) => rgba[index] === value)) return blob => readWebpRgba8(blob, gl, decode);
      } catch { /* try the next source */ }
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  })();
  return webpReader;
}

async function loadRgba8(url, options) {
  const webp = /\.png(?=$|[?#])/.test(url) ? await exactWebpReader() : null;
  if (webp) {
    try {
      const buffer = await fetchAsset(url.replace(/\.png(?=$|[?#])/, '.webp'), options);
      throwIfAborted(options.signal);
      return { ...await webp(new Blob([buffer], { type: 'image/webp' })), downloadBytes: buffer.byteLength, format: 'webp' };
    } catch (error) {
      throwIfAborted(options.signal);
      options.onWarning?.(`WebP-Lightmap nicht lesbar, PNG wird geladen: ${error.message}`);
    }
  }
  const buffer = await fetchAsset(url, options);
  return { ...await decodePngRgba8(buffer, options), downloadBytes: buffer.byteLength, format: 'png' };
}

export async function loadRgbmTexture(url, definition, options = {}) {
  const image = await loadRgba8(url, options);
  if (definition.width && image.width !== definition.width || definition.height && image.height !== definition.height) {
    throw new Error(`Atlasgröße stimmt nicht: ${definition.path}`);
  }
  const texture = rgbmToTexture(image, { ...definition, signal: options.signal });
  texture.userData.downloadBytes = image.downloadBytes;
  texture.userData.format = image.format;
  return texture;
}
