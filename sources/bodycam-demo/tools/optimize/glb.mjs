#!/usr/bin/env node
// C14 offline optimizer. Runtime consumers use the central Meshopt decoder.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, i, all) => {
  if (arg.startsWith('--')) out.push([arg.slice(2), all[i + 1]]);
  return out;
}, []));
if (!args.input || !args.output || !args.deps || !args.report) {
  throw new Error('Usage: glb.mjs --input ORIGINALS --output CANDIDATES --deps NODE_MODULES --report REPORT.json [--validator-deps NODE_MODULES] [--meshopt-output DECODER_REQUIRED_CANDIDATES]');
}
const require = createRequire(path.join(path.resolve(args.deps), '../package.json'));
const { NodeIO, PropertyType, Logger } = require('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } = require('@gltf-transform/extensions');
const { dedup, prune } = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = await import(path.join(path.resolve(args.deps), 'meshoptimizer/index.js'));
const sharp = require('sharp');
const validatorRequire = createRequire(path.join(path.resolve(args['validator-deps'] || args.deps), '../package.json'));
const validator = validatorRequire('gltf-validator');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const input = path.resolve(args.input), output = path.resolve(args.output);
if (input === output || output.startsWith(input + path.sep)) throw new Error('Originals and output must be separate trees');
const meshoptOutput = args['meshopt-output'] ? path.resolve(args['meshopt-output']) : null;
if (meshoptOutput && (meshoptOutput === output || meshoptOutput === input || meshoptOutput.startsWith(input + path.sep))) throw new Error('Meshopt candidates require a separate output tree');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bytes = (array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
const align = (n) => (n + 3) & ~3;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const logger = new Logger(Logger.Verbosity.ERROR);
const requiredMeshopt = args['meshopt-mode'] !== 'fallback';
const report = { policy: { positions: 'Float32 binary grid, <= 0.000123 m, local collapse/flip fallback', uvs: 'Float32 binary grid, <= 1/16384, local triangle fallback', skin: 'exact', normals: '10 bit, <= 0.1 degree', colors: '8 bit',
  images: 'WebP; existing WebP bytes retained; normal/ORM lossless; albedo quality 92',
  codec: requiredMeshopt ? 'Required Meshopt without decoded duplicate buffers' : 'Smallest of packed GLB and optional Meshopt with decoded fallback' }, files: [] };

function unpack(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error('Invalid GLB');
  const length = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + length));
  const offset = 20 + length;
  const bin = offset < buffer.length ? buffer.subarray(offset + 8, offset + 8 + buffer.readUInt32LE(offset)) : Buffer.alloc(0);
  return { json, bin };
}
function pack(json, binary) {
  const encoded = Buffer.from(JSON.stringify(json));
  const j = Buffer.alloc(align(encoded.length), 0x20); encoded.copy(j);
  const bin = Buffer.alloc(align(binary.length)); binary.copy(bin);
  const h = Buffer.alloc(20); h.writeUInt32LE(0x46546c67); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + j.length + 8 + bin.length, 8);
  h.writeUInt32LE(j.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, j, bh, bin]);
}
function preserveTransforms(binary, source) {
  const { json, bin } = unpack(binary);
  if (json.nodes?.length !== source.nodes?.length) throw new Error('Node count changed');
  for (let i = 0; i < (source.nodes || []).length; i++) {
    if (json.nodes[i].name !== source.nodes[i].name) throw new Error('Node order changed');
    for (const property of ['matrix', 'translation', 'rotation', 'scale']) {
      // glTF Transform's writer omits near-identity TRS components. Preserve even
      // the source rig's tiny rest transforms, not merely the visible result.
      if (property in source.nodes[i]) json.nodes[i][property] = source.nodes[i][property];
      else delete json.nodes[i][property];
    }
  }
  return pack(json, bin);
}
function fallback(binary) {
  const { json, bin } = unpack(binary), blocks = [bin];
  let offset = bin.length, views = 0;
  for (const view of json.bufferViews || []) {
    const extension = view.extensions?.EXT_meshopt_compression;
    if (!extension) continue;
    if (extension.buffer !== 0) throw new Error('Unexpected Meshopt source buffer');
    const decoded = Buffer.alloc(extension.count * extension.byteStride);
    MeshoptDecoder.decodeGltfBuffer(decoded, extension.count, extension.byteStride,
      bin.subarray(extension.byteOffset || 0, (extension.byteOffset || 0) + extension.byteLength), extension.mode, extension.filter);
    const padding = align(offset) - offset;
    if (padding) { blocks.push(Buffer.alloc(padding)); offset += padding; }
    view.buffer = 0; view.byteOffset = offset; view.byteLength = decoded.length;
    blocks.push(decoded); offset += decoded.length; views++;
  }
  if (json.bufferViews.some((v) => v.buffer !== 0)) throw new Error('Unsupported additional buffer');
  json.buffers = [{ byteLength: offset }];
  json.extensionsRequired = (json.extensionsRequired || []).filter((s) => s !== 'EXT_meshopt_compression');
  if (!json.extensionsRequired.length) delete json.extensionsRequired;
  const result = pack(json, Buffer.concat(blocks));
  const { json: reread, bin: data } = unpack(result);
  for (const view of reread.bufferViews) {
    const extension = view.extensions?.EXT_meshopt_compression;
    if (!extension) continue;
    const decoded = Buffer.alloc(view.byteLength);
    MeshoptDecoder.decodeGltfBuffer(decoded, extension.count, extension.byteStride,
      data.subarray(extension.byteOffset || 0, (extension.byteOffset || 0) + extension.byteLength), extension.mode, extension.filter);
    if (!decoded.equals(data.subarray(view.byteOffset, view.byteOffset + view.byteLength))) throw new Error('Meshopt fallback differs');
  }
  return { bytes: result, views };
}
function stripMeshopt(binary) {
  const { json, bin } = unpack(binary);
  for (const view of json.bufferViews || []) {
    if (!view.extensions?.EXT_meshopt_compression) continue;
    delete view.extensions.EXT_meshopt_compression;
    if (!Object.keys(view.extensions).length) delete view.extensions;
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    json[key] = (json[key] || []).filter((s) => s !== 'EXT_meshopt_compression');
    if (!json[key].length) delete json[key];
  }
  return pack(json, bin);
}

const hashAccessor = (a) => a ? [a.getType(), a.getNormalized(), a.getComponentType(), a.getCount(), sha(bytes(a.getArray())), a.getExtras()] : null;
function primitive(p) {
  let indices = p.getIndices()?.getArray();
  // Meshopt TRIANGLES may rotate each triplet while preserving its winding/order.
  if (indices && p.getMode() === 4) {
    indices = Uint32Array.from(indices);
    for (let i = 0; i < indices.length; i += 3) {
      const t = Array.from(indices.subarray(i, i + 3)), k = t.indexOf(Math.min(...t));
      indices.set([t[k], t[(k + 1) % 3], t[(k + 2) % 3]], i);
    }
  }
  return { mode: p.getMode(), material: p.getMaterial()?.getName(), extras: p.getExtras(),
    indices: indices ? sha(bytes(indices)) : null,
    attributes: p.listSemantics().sort().map((s) => [s, /^(NORMAL|TANGENT|COLOR_\d+)$/.test(s) ? [p.getAttribute(s).getType(), p.getAttribute(s).getCount()] : hashAccessor(p.getAttribute(s))]),
    targets: p.listTargets().map((t) => [t.getExtras(), t.listSemantics().sort().map((s) => [s, hashAccessor(t.getAttribute(s))])]) };
}
function invariant(doc) {
  const root = doc.getRoot();
  const named = (o) => o?.getName() ?? null;
  return {
    extras: root.getExtras(),
    scenes: root.listScenes().map((s) => [s.getName(), s.getExtras(), s.listChildren().map(named)]),
    nodes: root.listNodes().map((n) => [n.getName(), n.getExtras(), n.getMatrix(), n.getWeights(), n.listChildren().map(named), named(n.getMesh()), named(n.getSkin())]),
    meshes: root.listMeshes().map((m) => [m.getName(), m.getExtras(), m.getWeights(), m.listPrimitives().map(primitive)]),
    skins: root.listSkins().map((s) => [s.getName(), s.getExtras(), named(s.getSkeleton()), s.listJoints().map(named), hashAccessor(s.getInverseBindMatrices())]),
    animations: root.listAnimations().map((a) => [a.getName(), a.getExtras(), a.listChannels().map((c) => [named(c.getTargetNode()), c.getTargetPath(), c.getExtras(), c.getSampler().getInterpolation(), hashAccessor(c.getSampler().getInput()), hashAccessor(c.getSampler().getOutput())])]),
    materials: root.listMaterials().map((m) => [m.getName(), m.getExtras(), m.getBaseColorFactor(), m.getEmissiveFactor(), m.getMetallicFactor(), m.getRoughnessFactor(), m.getNormalScale(), m.getOcclusionStrength(), m.getAlphaMode(), m.getAlphaCutoff(), m.getDoubleSided(),
      ['BaseColor', 'Emissive', 'Normal', 'MetallicRoughness', 'Occlusion'].map((slot) => {
        const t = m[`get${slot}Texture`](), info = m[`get${slot}TextureInfo`]();
        return t ? [slot, t.getName(), t.getExtras(), info.getTexCoord(), info.getWrapS(), info.getWrapT(), info.getMagFilter(), info.getMinFilter(), info.getExtras()] : null;
      })]),
  };
}
function checkInvariant(before, doc, label) {
  const after = invariant(doc);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    const key = Object.keys(before).find((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (Array.isArray(before[key])) {
      const i = before[key].findIndex((v, i) => JSON.stringify(v) !== JSON.stringify(after[key][i]));
      console.error(JSON.stringify({ section: key, i, before: before[key][i], after: after[key][i] }));
    }
    throw new Error(`Semantic preservation failed (${label}): ${key}`);
  }
}
function triangleInvariant(doc) {
  const result = invariant(doc);
  result.meshes = doc.getRoot().listMeshes().map((mesh) => [mesh.getName(), mesh.getExtras(), mesh.getWeights(),
    mesh.listPrimitives().map((p) => {
      if (p.getMode() !== 4 || p.listTargets().length || !p.getIndices()) return primitive(p);
      const attributes = p.listSemantics().sort().map((name) => [name, p.getAttribute(name)]);
      const vertices = [];
      for (let i = 0; i < p.getAttribute('POSITION').getCount(); i++) {
        const h = crypto.createHash('sha256');
        for (const [name, a] of attributes) {
          h.update(name);
          const source = a.getArray(), size = a.getElementSize();
          h.update(bytes(source.subarray(i * size, (i + 1) * size)));
        }
        vertices.push(h.digest('hex'));
      }
      const source = p.getIndices().getArray(), triangles = [];
      for (let i = 0; i < source.length; i += 3) {
        const t = [vertices[source[i]], vertices[source[i + 1]], vertices[source[i + 2]]];
        const k = t.indexOf(t.slice().sort()[0]);
        triangles.push(t[k] + t[(k + 1) % 3] + t[(k + 2) % 3]);
      }
      if (p.getMaterial()?.getAlphaMode() !== 'BLEND') triangles.sort();
      return [p.getMode(), p.getMaterial()?.getName(), p.getExtras(),
        attributes.map(([s, a]) => [s, a.getType(), a.getNormalized(), a.getComponentType(), a.getExtras()]), sha(triangles.join(''))];
    })]);
  return JSON.stringify(result);
}
async function reorderOpaque(doc) {
  let count = 0, indicesDowncast = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const original = p.getIndices();
    if (!original || p.getMode() !== 4 || p.listTargets().length || p.getMaterial()?.getAlphaMode() === 'BLEND') continue;
    const index = Uint32Array.from(original.getArray());
    const [remap, unique] = MeshoptEncoder.reorderMesh(index, true, true);
    const remapped = original.clone().setArray(unique <= 65534 ? Uint16Array.from(index) : index);
    if (original.getArray() instanceof Uint32Array && remapped.getArray() instanceof Uint16Array) indicesDowncast++;
    p.setIndices(remapped);
    for (const s of p.listSemantics()) {
      const a = p.getAttribute(s), source = a.getArray(), size = a.getElementSize();
      const target = new source.constructor(unique * size);
      for (let i = 0; i < remap.length; i++) {
        if (remap[i] >= unique) continue;
        target.set(source.subarray(i * size, (i + 1) * size), remap[i] * size);
      }
      p.setAttribute(s, a.clone().setArray(target));
    }
    count++;
  }
  await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.BUFFER], keepAttributes: true, keepIndices: true, keepExtras: true }));
  return { opaquePrimitives: count, indicesDowncast };
}
function geometryCounts(doc) {
  const root = doc.getRoot(); let triangles = 0, vertices = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    vertices += p.getAttribute('POSITION')?.getCount() || 0;
    if (p.getMode() === 4) triangles += (p.getIndices()?.getCount() || p.getAttribute('POSITION')?.getCount() || 0) / 3;
  }
  return { nodes: root.listNodes().length, meshes: root.listMeshes().length, skins: root.listSkins().length, triangles, vertices };
}
function quantizeNormalsAndColors(doc) {
  const seen = new Set(), metrics = { normalBits: 10, normalMaxAngleDegrees: 0, normalMaxComponentError: 0,
    colorMaxComponentError: 0, attributes: 0, retainedNormals: 0 };
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) for (const semantic of p.listSemantics()) {
    const a = p.getAttribute(semantic);
    if (!/^(NORMAL|TANGENT|COLOR_\d+)$/.test(semantic) || seen.has(a)) continue;
    seen.add(a);
    const raw = a.getArray();
    const divisor = a.getNormalized() ? raw instanceof Int16Array ? 32767 : raw instanceof Int8Array ? 127 : raw instanceof Uint16Array ? 65535 : 255 : 1;
    const source = Float32Array.from(raw, v => Math.max(-1, v / divisor));
    if (semantic.startsWith('COLOR_')) {
      if (!(raw instanceof Float32Array)) continue;
      if (source.some(v => v < 0 || v > 1)) throw new Error('Color outside normalized range');
      const packed = Uint8Array.from(source, v => Math.round(v * 255));
      for (let i = 0; i < source.length; i++) metrics.colorMaxComponentError = Math.max(metrics.colorMaxComponentError, Math.abs(source[i] - packed[i] / 255));
      a.setArray(packed).setNormalized(true);
    } else {
      const stride = a.getElementSize();
      const packed = Int16Array.from(source, (v, i) => stride === 4 && i % 4 === 3 ? Math.round(v * 32767) : Math.round(Math.max(-1, Math.min(1, v)) * 511) * 64);
      let maxAngle = 0, maxError = 0;
      for (let i = 0; i < source.length; i++) maxError = Math.max(maxError, Math.abs(source[i] - packed[i] / 32767));
      for (let i = 0; i < source.length; i += stride) {
        const dot = source[i] * packed[i] + source[i + 1] * packed[i + 1] + source[i + 2] * packed[i + 2];
        const norm = Math.hypot(...source.subarray(i, i + 3)) * Math.hypot(...packed.subarray(i, i + 3));
        if (!norm) throw new Error('Zero normal cannot be quantized');
        maxAngle = Math.max(maxAngle, Math.acos(Math.max(-1, Math.min(1, dot / norm))) * 180 / Math.PI);
      }
      if (maxAngle > 0.1) { metrics.retainedNormals++; continue; }
      metrics.normalMaxAngleDegrees = Math.max(metrics.normalMaxAngleDegrees, maxAngle);
      metrics.normalMaxComponentError = Math.max(metrics.normalMaxComponentError, maxError);
      a.setArray(packed).setNormalized(true);
    }
    metrics.attributes++;
  }
  if (metrics.colorMaxComponentError > 1 / 510 + 1e-7) throw new Error('Color precision budget exceeded');
  if (metrics.attributes) doc.createExtension(KHRMeshQuantization).setRequired(true);
  return metrics;
}
// Binary grids remove low mantissa noise without inserting transforms or moving pivots.
// Restore affected source vertices until every triangle retains its orientation.
function quantizeFloatAttributes(doc) {
  const metrics = { positionGridMeters: 1 / 4096, uvGrid: 1 / 8192,
    positionMaxErrorMeters: 0, uvMaxError: 0, changedAttributes: 0,
    preservedAttributes: 0, preservedVertices: 0, preventedDegenerateOrFlippedTriangles: 0 };
  const users = new Map();
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    for (const semantic of primitive.listSemantics()) {
      if (semantic !== 'POSITION' && !semantic.startsWith('TEXCOORD_')) continue;
      const accessor = primitive.getAttribute(semantic);
      if (!users.has(accessor)) users.set(accessor, []);
      users.get(accessor).push({ primitive, semantic });
    }
  }
  const cross = (values, a, b, c) => {
    const u = [0, 1, 2].map(k => values[b * 3 + k] - values[a * 3 + k]);
    const v = [0, 1, 2].map(k => values[c * 3 + k] - values[a * 3 + k]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  const area = (values, a, b, c) => (values[b * 2] - values[a * 2]) * (values[c * 2 + 1] - values[a * 2 + 1])
    - (values[b * 2 + 1] - values[a * 2 + 1]) * (values[c * 2] - values[a * 2]);
  for (const [accessor, primitives] of users) {
    const source = accessor.getArray();
    if (!(source instanceof Float32Array) || accessor.getNormalized()) continue;
    const isPosition = primitives[0].semantic === 'POSITION';
    const grid = isPosition ? metrics.positionGridMeters : metrics.uvGrid;
    const packed = Float32Array.from(source, x => Math.round(x / grid) * grid);
    const retained = new Set();
    const restore = vertices => {
      for (const vertex of vertices) if (!retained.has(vertex)) {
        retained.add(vertex);
        const size = accessor.getElementSize();
        packed.set(source.subarray(vertex * size, vertex * size + size), vertex * size);
      }
    };
    let pass = 0, restored = true, unsupported = false;
    while (restored) {
      restored = false;
      for (const { primitive } of primitives) {
        if (primitive.getMode() !== 4 || primitive.listTargets().length) { unsupported = true; continue; }
        const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({ length: accessor.getCount() }, (_, i) => i);
        for (let i = 0; i < indices.length; i += 3) {
          const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
          let invalid = false;
          if (isPosition) {
            const before = cross(source, a, b, c), after = cross(packed, a, b, c);
            invalid = Math.hypot(...before) > 0 && before[0] * after[0] + before[1] * after[1] + before[2] * after[2] <= 0;
          } else {
            const before = area(source, a, b, c), after = area(packed, a, b, c);
            invalid = before !== 0 && before * after <= 0;
          }
          if (invalid) {
            const count = retained.size;
            restore([a, b, c]);
            if (retained.size === count) throw new Error('Restored source triangle remains invalid');
            metrics.preventedDegenerateOrFlippedTriangles++; restored = true;
          }
        }
      }
      if (++pass > accessor.getCount() + 1) throw new Error('Local precision preservation did not converge');
    }
    if (unsupported) { metrics.preservedAttributes++; continue; }
    metrics.preservedVertices += retained.size;
    let error = 0;
    for (let i = 0; i < source.length; i++) error = Math.max(error, Math.abs(source[i] - packed[i]));
    if (error > grid / 2 + 1e-8) throw new Error('Float32 rounding exceeds grid bound');
    const key = isPosition ? 'positionMaxErrorMeters' : 'uvMaxError';
    metrics[key] = Math.max(metrics[key], error);
    accessor.setArray(packed); metrics.changedAttributes++;
  }
  return metrics;
}
async function imageStats(before, after) {
  const a = await sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (JSON.stringify(a.info) !== JSON.stringify(b.info)) throw new Error('Image dimensions changed');
  let sum = 0, sq = 0, max = 0, alphaMax = 0;
  for (let i = 0; i < a.data.length; i++) {
    const delta = Math.abs(a.data[i] - b.data[i]);
    if (i % 4 === 3) alphaMax = Math.max(alphaMax, delta);
    else { sum += delta; sq += delta * delta; max = Math.max(max, delta); }
  }
  const count = a.info.width * a.info.height * 3;
  return { width: a.info.width, height: a.info.height, meanAbsoluteError: sum / count, rmse: Math.sqrt(sq / count), maxError: max, alphaMaxError: alphaMax };
}
async function images(doc) {
  const result = [];
  const dataTextures = new Set();
  for (const m of doc.getRoot().listMaterials()) for (const t of [m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture()]) if (t) dataTextures.add(t);
  for (const t of doc.getRoot().listTextures()) {
    const original = Buffer.from(t.getImage() || []), declaredMime = t.getMimeType();
    if (!original.length) throw new Error(`Missing image data ${t.getName()}`);
    const format = (await sharp(original).metadata()).format;
    const mime = { webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' }[format];
    if (!mime) throw new Error(`Unsupported image format ${format}: ${t.getName()}`);
    if (declaredMime !== mime) t.setMimeType(mime);
    const data = dataTextures.has(t), alpha = (await sharp(original).metadata()).hasAlpha;
    if (mime === 'image/webp') {
      t.setURI(t.getURI().replace(/\.(png|jpe?g)$/i, '.webp'));
      result.push({ name: t.getName(), bytesBefore: original.length, bytesAfter: original.length, preserved: true,
        ...(declaredMime === mime ? {} : { correctedMime: { before: declaredMime, after: mime } }) });
      continue;
    }
    if (!['image/png', 'image/jpeg'].includes(mime)) throw new Error(`Unsupported image format ${mime}`);
    const lossless = data || alpha || mime === 'image/png';
    const candidate = await sharp(original).webp(lossless ? { lossless: true, effort: 6 } : { quality: 92, effort: 6 }).toBuffer();
    const metrics = await imageStats(original, candidate);
    if (lossless && (metrics.maxError || metrics.alphaMaxError)) {
      // libwebp can discard RGB below fully transparent texels; keep these PNGs exact.
      result.push({ name: t.getName(), bytesBefore: original.length, bytesAfter: original.length,
        preserved: 'Decoded RGBA differs in nominally lossless WebP', attemptedWebP: metrics });
      continue;
    }
    if (candidate.length >= original.length) {
      result.push({ name: t.getName(), bytesBefore: original.length, bytesAfter: original.length,
        preserved: 'Original encoding is smaller', attemptedWebPBytes: candidate.length });
      continue;
    }
    t.setImage(candidate).setMimeType('image/webp');
    t.setURI(t.getURI().replace(/\.(png|jpe?g)$/i, '.webp'));
    result.push({ name: t.getName(), bytesBefore: original.length, bytesAfter: candidate.length, lossless, ...metrics });
  }
  if (result.length) doc.createExtension(EXTTextureWebP).setRequired(true);
  return result;
}
async function validate(buffer, sourcePath) {
  const result = await validator.validateBytes(new Uint8Array(buffer), {
    uri: path.basename(sourcePath), maxIssues: 2000,
    externalResourceFunction: async (uri) => new Uint8Array(await fs.readFile(path.resolve(path.dirname(sourcePath), decodeURIComponent(uri)))),
  });
  return { errors: result.issues.numErrors, warnings: result.issues.numWarnings, messages: result.issues.messages };
}
async function walk(directory) {
  let found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) found = found.concat(await walk(name)); else if (name.endsWith('.glb')) found.push(name);
  }
  return found.sort();
}
const level = JSON.parse(await fs.readFile(path.join(input, 'data/level.json'), 'utf8'));
const immutable = new Map((requiredMeshopt ? [] : level.bake.compression.sharedImageBuffers || []).map((v) => ['models/' + v.uri, v]));
report.houseReexportRequiredIfPropBytesChange = requiredMeshopt && !!level.bake.compression.sharedImageBuffers?.length;
immutable.set('models/house.glb', {}); immutable.set('models/house_collision.glb', {});
for (const filename of await walk(path.join(input, 'models'))) {
  const relative = path.relative(input, filename), destination = path.join(output, relative);
  const meshoptDestination = meshoptOutput ? path.join(meshoptOutput, relative) : null;
  const protectedFilename = immutable.has(relative) && args['protected-input'] ? path.join(path.resolve(args['protected-input']), relative) : filename;
  const original = await fs.readFile(protectedFilename), item = { path: relative, bytesBefore: original.length, sha256Before: sha(original) };
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (meshoptDestination) await fs.mkdir(path.dirname(meshoptDestination), { recursive: true });
  if (immutable.has(relative)) {
    const expected = immutable.get(relative);
    if (expected.sha256 && expected.sha256 !== item.sha256Before) throw new Error(`C6 shared image hash mismatch: ${relative}`);
    await fs.writeFile(destination, original);
    if (meshoptDestination) await fs.writeFile(meshoptDestination, original);
    Object.assign(item, { bytesAfter: original.length, sha256After: item.sha256Before, preserved: 'C6 byte offsets, UV coverage and hashes' });
  } else {
    const doc = await io.read(filename); doc.setLogger(logger);
    item.counts = geometryCounts(doc);
    item.floatQuantization = quantizeFloatAttributes(doc);
    const before = invariant(doc);
    item.quantization = quantizeNormalsAndColors(doc);
    // Accessor metadata is rare, but must not disappear when identical arrays are merged.
    if (!doc.getRoot().listAccessors().some((a) => Object.keys(a.getExtras()).length)) await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR], keepUniqueNames: true }));
    await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.BUFFER], keepLeaves: true, keepAttributes: true, keepIndices: true, keepExtras: true, keepSolidTextures: true }));
    item.images = await images(doc);
    checkInvariant(before, doc, relative + ' transforms');
    for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
    const sourceJSON = unpack(original).json;
    const plain = preserveTransforms(Buffer.from(await io.writeBinary(doc)), sourceJSON);
    checkInvariant(before, await io.readBinary(plain), relative + ' packed readback');
    let compressedDoc = await io.readBinary(plain); compressedDoc.setLogger(logger);
    const trianglesBefore = triangleInvariant(compressedDoc);
    item.reorder = await reorderOpaque(compressedDoc);
    if (trianglesBefore !== triangleInvariant(compressedDoc)) throw new Error(`Lossless reorder changed geometry: ${relative}`);
    compressedDoc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    let meshoptRequired = preserveTransforms(Buffer.from(await io.writeBinary(compressedDoc)), sourceJSON);
    if (trianglesBefore !== triangleInvariant(await io.readBinary(meshoptRequired))) {
      // Some exporters share one index accessor between distinct vertex streams.
      // Accept locality reordering only after the complete tuple/triangle check.
      item.reorder = { rejected: 'Reordered Meshopt readback differs; original order retained' };
      compressedDoc = await io.readBinary(plain); compressedDoc.setLogger(logger);
      compressedDoc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
      meshoptRequired = preserveTransforms(Buffer.from(await io.writeBinary(compressedDoc)), sourceJSON);
      if (trianglesBefore !== triangleInvariant(await io.readBinary(meshoptRequired))) throw new Error(`Meshopt changed geometry: ${relative}`);
    }
    const meshopt = requiredMeshopt ? { bytes: meshoptRequired, views: 0 } : fallback(meshoptRequired);
    if (trianglesBefore !== triangleInvariant(await io.readBinary(meshopt.bytes))) throw new Error(`Meshopt readback changed geometry: ${relative}`);
    if (!requiredMeshopt && trianglesBefore !== triangleInvariant(await io.readBinary(stripMeshopt(meshopt.bytes)))) throw new Error(`Decoder-free fallback changed geometry: ${relative}`);
    const candidate = requiredMeshopt ? meshoptRequired : meshopt.bytes.length < plain.length ? meshopt.bytes : plain;
    const [baselineValidation, candidateValidation] = await Promise.all([validate(original, filename), validate(candidate, filename)]);
    if (candidateValidation.errors > baselineValidation.errors) throw new Error(`New validation errors for ${relative}`);
    if (candidateValidation.errors) throw new Error(`Invalid candidate for ${relative}`);
    await fs.writeFile(destination, candidate);
    if (meshoptDestination) await fs.writeFile(meshoptDestination, meshoptRequired);
    Object.assign(item, { bytesAfter: candidate.length, sha256After: sha(candidate), packedBytes: plain.length,
      meshoptWithFallbackBytes: meshopt.bytes.length, fallbackBufferViewsVerified: meshopt.views,
      meshoptRequiredBytes: meshoptRequired.length, meshoptDecoderRequiredCandidate: meshoptDestination,
      selected: requiredMeshopt ? 'required Meshopt, no duplicate buffers' : candidate === plain ? 'packed GLB' : 'optional Meshopt with real fallback',
      semanticPreservation: true, validation: candidateValidation, baselineValidation });
  }
  report.files.push(item);
  console.log(JSON.stringify({ path: relative, before: item.bytesBefore, after: item.bytesAfter, selected: item.selected || 'preserved' }));
  await fs.mkdir(path.dirname(path.resolve(args.report)), { recursive: true });
  await fs.writeFile(args.report, JSON.stringify(report, null, 2));
}
// Share identical encoded image bytes between GLBs. Earlier files own the image,
// later files reference its byte range, so references cannot form a cycle.
async function shareImages(files) {
  const canonical = new Map();
  const fingerprintImages = doc => doc.getRoot().listTextures().map(t => [t.getName(), t.getMimeType(), sha(t.getImage())]);
  for (const item of files) {
    if (item.preserved) continue;
    const filename = path.join(output, item.path);
    const original = await fs.readFile(filename), before = await io.read(filename);
    const triangles = triangleInvariant(before), textureHashes = JSON.stringify(fingerprintImages(before));
    const { json, bin } = unpack(original), removed = new Set(), matches = [];
    for (const image of json.images || []) {
      if (image.bufferView === undefined) continue;
      const view = json.bufferViews[image.bufferView];
      if ((view.buffer || 0) !== 0) continue;
      const digest = sha(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
      const match = canonical.get(digest);
      if (match) { removed.add(image.bufferView); matches.push({ image, match }); }
    }
    if (matches.length) {
      const blocks = [], views = [], remap = new Map(); let offset = 0;
      const copy = (start, length) => {
        const padding = align(offset) - offset;
        if (padding) { blocks.push(Buffer.alloc(padding)); offset += padding; }
        const dest = offset; blocks.push(bin.subarray(start, start + length)); offset += length;
        return dest;
      };
      for (let i = 0; i < json.bufferViews.length; i++) {
        if (removed.has(i)) continue;
        const view = json.bufferViews[i], ext = view.extensions?.EXT_meshopt_compression;
        remap.set(i, views.length);
        if ((view.buffer || 0) === 0) view.byteOffset = copy(view.byteOffset || 0, view.byteLength);
        if (ext) {
          if (ext.buffer !== 0) throw new Error('Unexpected encoded buffer during image sharing');
          ext.byteOffset = copy(ext.byteOffset || 0, ext.byteLength);
        }
        views.push(view);
      }
      for (const accessor of json.accessors || []) {
        if (accessor.bufferView !== undefined) accessor.bufferView = remap.get(accessor.bufferView);
        if (accessor.sparse) for (const slot of ['indices', 'values']) accessor.sparse[slot].bufferView = remap.get(accessor.sparse[slot].bufferView);
      }
      for (const image of json.images || []) if (image.bufferView !== undefined && !removed.has(image.bufferView)) image.bufferView = remap.get(image.bufferView);
      const dependencies = new Map();
      for (const { image, match } of matches) {
        if (!dependencies.has(match.filename)) {
          dependencies.set(match.filename, json.buffers.length);
          json.buffers.push({ uri: path.relative(path.dirname(filename), match.filename).split(path.sep).join('/'), byteLength: match.fileBytes });
        }
        image.bufferView = views.length;
        views.push({ buffer: dependencies.get(match.filename), byteOffset: match.offset, byteLength: match.length });
      }
      json.bufferViews = views; json.buffers[0].byteLength = offset;
      const result = pack(json, Buffer.concat(blocks));
      await fs.writeFile(filename, result);
      const after = await io.read(filename);
      if (triangles !== triangleInvariant(after) || textureHashes !== JSON.stringify(fingerprintImages(after))) throw new Error(`Shared-image readback differs: ${item.path}`);
      const validation = await validate(result, filename);
      if (validation.errors) throw new Error(`Shared-image GLB invalid: ${item.path}`);
      item.imageSharing = { savedBytes: original.length - result.length, images: matches.length,
        dependencies: [...dependencies.keys()].map(p => path.relative(output, p)), imageBytesExact: true, geometryExact: true };
      item.bytesAfter = result.length; item.sha256After = sha(result); item.validation = validation;
    }
    const current = await fs.readFile(filename), parsed = unpack(current), headerBytes = current.length - parsed.bin.length;
    for (const image of parsed.json.images || []) {
      if (image.bufferView === undefined) continue;
      const view = parsed.json.bufferViews[image.bufferView];
      if ((view.buffer || 0) !== 0) continue;
      const offset = view.byteOffset || 0, digest = sha(parsed.bin.subarray(offset, offset + view.byteLength));
      if (!canonical.has(digest)) canonical.set(digest, { filename, fileBytes: current.length, offset: headerBytes + offset, length: view.byteLength });
    }
  }
}
if (requiredMeshopt) await shareImages(report.files);
report.totalBefore = report.files.reduce((n, f) => n + f.bytesBefore, 0);
report.totalAfter = report.files.reduce((n, f) => n + f.bytesAfter, 0);
report.totalMeshoptRequired = requiredMeshopt ? report.totalAfter : report.files.reduce((n, f) => n + (f.meshoptRequiredBytes ?? f.bytesAfter), 0);
report.complete = true;
await fs.writeFile(args.report, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalBefore: report.totalBefore, totalAfter: report.totalAfter }));
