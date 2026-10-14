import {
  ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat,
} from 'three';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// RGBM alpha is a multiplier, not coverage. Canvas RGBA8 can quantize RGB while
// premultiplying, even with createImageBitmap({ premultiplyAlpha: 'none' }).
// Decode the generated straight-alpha PNG bytes with the browser's zlib inflater.
// This deliberately supports only the pipeline's non-interlaced RGBA8 format.
export async function decodePngRgba8(buffer) {
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
  const inflated = new Uint8Array(await new Response(new Blob(chunks).stream()
    .pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = width * 4;
  if (inflated.length !== (stride + 1) * height) throw new Error('PNG-Datenlänge stimmt nicht');
  const rgba = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
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

export function rgbmToTexture({ width, height, rgba }, { path, range, multiplierExponent = 1 }) {
  if (!(range > 0 && Number.isFinite(range))) throw new Error(`Ungültige RGBM-Range: ${path}`);
  if (!(multiplierExponent > 0 && Number.isFinite(multiplierExponent))) throw new Error(`Ungültiger RGBM-Exponent: ${path}`);
  const data = new Uint16Array(rgba.length);
  let peak = 0, luminanceSum = 0, nonzero = 0;
  for (let i = 0; i < rgba.length; i += 4) {
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

export async function loadRgbmTexture(url, definition) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Lightmap ${response.status}: ${url}`);
  const buffer = await response.arrayBuffer();
  const png = await decodePngRgba8(buffer);
  if (definition.width && png.width !== definition.width || definition.height && png.height !== definition.height) {
    throw new Error(`Atlasgröße stimmt nicht: ${definition.path}`);
  }
  const texture = rgbmToTexture(png, definition);
  texture.userData.downloadBytes = buffer.byteLength;
  return texture;
}
