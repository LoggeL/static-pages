// Decode source bytes independently, before GLTFLoader repairs skin weights.
export const AUDIT_CONFIG = Object.freeze({ sumTolerance: 1e-4, influenceThreshold: 1e-6 });
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const TYPES = {
  5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255],
  5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535],
  5125: [4, 'getUint32', 4294967295], 5126: [4, 'getFloat32', 1],
};
const integer = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}: ungültige Ganzzahl.`);
  return value;
};
function bounds(view, offset, length, label) {
  integer(offset, label); integer(length, label);
  if (offset + length > view.byteLength) throw new Error(`${label}: Datenbereich überschreitet den Buffer.`);
}

export function parseGLB(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Die Datei ist kein glTF-2.0-Binärmodell.');
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB-Dateilänge ist ungültig.');
  let json, binary;
  for (let offset = 12; offset < buffer.byteLength;) {
    bounds(view, offset, 8, 'GLB-Chunkheader');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 || (offset === 12 && type !== 0x4e4f534a)) throw new Error('Ungültige GLB-Chunkanordnung.');
    offset += 8; bounds(view, offset, length, 'GLB-Chunk');
    if (type === 0x4e4f534a) {
      if (json) throw new Error('Mehrere JSON-Chunks im GLB.');
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, length)));
    }
    if (type === 0x004e4942) {
      if (binary) throw new Error('Mehrere BIN-Chunks im GLB.');
      binary = new DataView(buffer, offset, length);
    }
    offset += length;
  }
  if (json?.asset?.version !== '2.0') throw new Error('glTF-2.0-JSON fehlt.');
  return { json, binary: binary || new DataView(new ArrayBuffer(0)), decodedBufferViews: new Map() };
}

function embeddedBuffer(document, index) {
  const buffer = document.json.buffers?.[index];
  if (index !== 0 || !buffer || buffer.uri !== undefined) throw new Error(`Externer Buffer ${index} wird in dieser GLB-Prüfung nicht unterstützt.`);
  integer(buffer.byteLength, `Buffer ${index}.byteLength`);
  if (buffer.byteLength > document.binary.byteLength || document.binary.byteLength - buffer.byteLength > 3) throw new Error(`Buffer ${index}: ungültige GLB-BIN-Länge.`);
  return new DataView(document.binary.buffer, document.binary.byteOffset, buffer.byteLength);
}

/** Meshopt fallback buffers need not exist: the extension points to the real source. */
export async function decodeBufferViews(document, meshoptDecoder) {
  const compressed = (document.json.bufferViews || []).map((view, index) => [view, index])
    .filter(([view]) => view.extensions?.EXT_meshopt_compression);
  if (!compressed.length) return document;
  const decoder = meshoptDecoder || (await import('three/addons/libs/meshopt_decoder.module.js')).MeshoptDecoder;
  if (!decoder?.supported || typeof decoder.decodeGltfBuffer !== 'function') throw new Error('Meshopt-Decoder ist nicht verfügbar.');
  await decoder.ready;
  for (const [view, index] of compressed) {
    const extension = view.extensions.EXT_meshopt_compression, label = `Meshopt BufferView ${index}`;
    const count = integer(extension.count, label, 1), stride = integer(extension.byteStride, label, 1);
    const length = integer(view.byteLength, label, 1), mode = extension.mode, filter = extension.filter ?? 'NONE';
    if (!Number.isSafeInteger(count * stride) || length !== count * stride || (view.byteStride !== undefined && view.byteStride !== stride)) throw new Error(`${label}: Länge/Stride stimmt nicht mit der Erweiterung überein.`);
    if (!['ATTRIBUTES', 'TRIANGLES', 'INDICES'].includes(mode) || !['NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL'].includes(filter)
      || (mode === 'ATTRIBUTES' && (stride % 4 || stride > 256))
      || (mode !== 'ATTRIBUTES' && (![2, 4].includes(stride) || filter !== 'NONE'))
      || (mode === 'TRIANGLES' && count % 3)
      || (filter === 'OCTAHEDRAL' && ![4, 8].includes(stride))
      || (filter === 'QUATERNION' && stride !== 8)
      || (filter === 'EXPONENTIAL' && stride % 4)) throw new Error(`${label}: ungültiger Modus oder Filter.`);
    const sourceBuffer = embeddedBuffer(document, extension.buffer), offset = extension.byteOffset ?? 0;
    bounds(sourceBuffer, offset, integer(extension.byteLength, label, 1), label);
    const source = new Uint8Array(sourceBuffer.buffer, sourceBuffer.byteOffset + offset, extension.byteLength), decoded = new Uint8Array(length);
    try { decoder.decodeGltfBuffer(decoded, count, stride, source, mode, filter); }
    catch (error) { throw new Error(`${label}: Dekodierung fehlgeschlagen (${error.message}).`); }
    document.decodedBufferViews.set(index, new DataView(decoded.buffer));
  }
  return document;
}

function bufferView(document, index) {
  integer(index, 'BufferView-Index');
  const view = document.json.bufferViews?.[index];
  if (!view) throw new Error(`BufferView ${index} fehlt.`);
  if (view.extensions?.EXT_meshopt_compression) {
    const decoded = document.decodedBufferViews.get(index);
    if (!decoded) throw new Error(`Meshopt BufferView ${index} muss vor dem Accessor dekodiert werden.`);
    return decoded;
  }
  const binary = embeddedBuffer(document, view.buffer), offset = view.byteOffset ?? 0;
  bounds(binary, offset, integer(view.byteLength, `BufferView ${index}`, 1), `BufferView ${index}`);
  return new DataView(binary.buffer, binary.byteOffset + offset, view.byteLength);
}

export function readAccessor(document, index) {
  integer(index, 'Accessor-Index');
  const accessor = document.json.accessors?.[index], width = COMPONENTS[accessor?.type], type = TYPES[accessor?.componentType];
  if (!width || !type) throw new Error(`Nicht unterstützter Accessor ${index}.`);
  const [bytes, getter, divisor] = type, count = integer(accessor.count, `Accessor ${index}.count`, 1);
  if (accessor.normalized && ![5120, 5121, 5122, 5123].includes(accessor.componentType)) throw new Error(`Accessor ${index}: FLOAT/UNSIGNED_INT darf nicht normalized sein.`);
  // glTF matrix columns start on four-byte boundaries, even for byte/short data.
  const columns = accessor.type.startsWith('MAT') ? Math.sqrt(width) : 1, rows = width / columns;
  const columnStride = columns > 1 ? Math.ceil(rows * bytes / 4) * 4 : rows * bytes, elementBytes = columnStride * columns;
  const componentOffset = (component) => Math.floor(component / rows) * columnStride + (component % rows) * bytes;
  const result = new Float64Array(count * width);
  const read = (view, offset) => {
    const value = view[getter](offset, true);
    return accessor.normalized ? Math.max(-1, value / divisor) : value;
  };
  const copy = (view, offset, vertex) => {
    for (let component = 0; component < width; component++) result[vertex * width + component] = read(view, offset + componentOffset(component));
  };
  if (accessor.bufferView !== undefined) {
    const view = bufferView(document, accessor.bufferView), spec = document.json.bufferViews[accessor.bufferView];
    const start = integer(accessor.byteOffset ?? 0, `Accessor ${index}.byteOffset`), stride = spec.byteStride ?? elementBytes;
    if (start % bytes || ((spec.byteOffset ?? 0) + start) % bytes || (columns > 1 && start % 4)
      || !Number.isSafeInteger(stride) || stride < elementBytes || stride % bytes
      || (spec.byteStride !== undefined && (stride < 4 || stride > 252 || stride % 4))) throw new Error(`Accessor ${index}: ungültiger Offset/Stride.`);
    bounds(view, start, (count - 1) * stride + elementBytes, `Accessor ${index}`);
    for (let vertex = 0; vertex < count; vertex++) copy(view, start + vertex * stride, vertex);
  } else if ((accessor.byteOffset ?? 0) !== 0) throw new Error(`Accessor ${index}: Offset ohne BufferView.`);
  if (accessor.sparse) {
    const sparse = accessor.sparse, sparseCount = integer(sparse.count, `Accessor ${index}.sparse.count`, 1);
    if (sparseCount > count || ![5121, 5123, 5125].includes(sparse.indices?.componentType)) throw new Error(`Accessor ${index}: ungültige Sparse-Indizes.`);
    const [indexBytes, indexGetter] = TYPES[sparse.indices.componentType];
    const iv = bufferView(document, sparse.indices.bufferView), vv = bufferView(document, sparse.values?.bufferView);
    const io = integer(sparse.indices.byteOffset ?? 0, 'Sparse-Indexoffset'), vo = integer(sparse.values.byteOffset ?? 0, 'Sparse-Wertoffset');
    for (const viewIndex of [sparse.indices.bufferView, sparse.values.bufferView]) {
      const spec = document.json.bufferViews[viewIndex];
      if (spec.byteStride !== undefined || spec.target !== undefined) throw new Error(`Accessor ${index}: Sparse-BufferView darf keinen Stride/Target haben.`);
    }
    if (io % indexBytes || vo % bytes
      || ((document.json.bufferViews[sparse.indices.bufferView].byteOffset ?? 0) + io) % indexBytes
      || ((document.json.bufferViews[sparse.values.bufferView].byteOffset ?? 0) + vo) % bytes
      || (columns > 1 && vo % 4)) throw new Error(`Accessor ${index}: unaligned Sparse-Offset.`);
    bounds(iv, io, sparseCount * indexBytes, `Accessor ${index} Sparse-Indizes`);
    bounds(vv, vo, sparseCount * elementBytes, `Accessor ${index} Sparse-Werte`);
    let previous = -1;
    for (let vertex = 0; vertex < sparseCount; vertex++) {
      const target = iv[indexGetter](io + vertex * indexBytes, true);
      if (target >= count || target <= previous) throw new Error(`Sparse-Index außerhalb/unsortiert in Accessor ${index}.`);
      previous = target; copy(vv, vo + vertex * elementBytes, target);
    }
  }
  return result;
}

export async function auditSkinWeights(buffer, { meshoptDecoder } = {}) {
  const document = await decodeBufferViews(parseGLB(buffer), meshoptDecoder), { json } = document;
  const cache = new Map();
  const read = (index) => { if (!cache.has(index)) cache.set(index, readAccessor(document, index)); return cache.get(index); };
  const report = { source: 'raw-glTF-accessors', meshoptBufferViews: document.decodedBufferViews.size,
    vertices: 0, skinnedVertices: 0, triangles: 0, primitives: 0, maxInfluences: 0, maxWeightError: 0,
    nonNormalized: 0, zeroWeights: 0, invalidWeights: 0, invalidJoints: 0, overFour: 0, weightSetCount: 0, meshes: [],
    skins: (json.skins || []).length, animations: (json.animations || []).length, materials: (json.materials || []).length,
    textures: (json.textures || []).length, images: (json.images || []).length };
  for (const [meshIndex, mesh] of (json.meshes || []).entries()) {
    const jointLimits = (json.nodes || []).filter((node) => node.mesh === meshIndex && node.skin !== undefined).map((node) => {
      const skin = json.skins?.[node.skin];
      if (!skin?.joints?.length) throw new Error(`Mesh ${meshIndex}: Skin ${node.skin} fehlt.`);
      return skin.joints.length;
    });
    const jointLimit = jointLimits.length ? Math.min(...jointLimits) : 0;
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      if (primitive.extensions?.KHR_draco_mesh_compression) throw new Error('Draco wird in der Rohdatenprüfung nicht unterstützt.');
      const count = integer(json.accessors?.[primitive.attributes.POSITION]?.count, 'POSITION.count', 1);
      const weightKeys = Object.keys(primitive.attributes).filter((key) => /^WEIGHTS_\d+$/.test(key)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
      const jointKeys = Object.keys(primitive.attributes).filter((key) => /^JOINTS_\d+$/.test(key));
      if (jointKeys.length !== weightKeys.length || weightKeys.some((key, set) => key !== `WEIGHTS_${set}`)) throw new Error('Skin-Attributsets fehlen oder sind nicht fortlaufend.');
      report.vertices += count; report.primitives++;
      const indexCount = primitive.indices !== undefined ? integer(json.accessors?.[primitive.indices]?.count, 'Indices.count', 1) : count;
      if ((primitive.mode ?? 4) === 4) report.triangles += indexCount / 3;
      if ([5, 6].includes(primitive.mode)) report.triangles += Math.max(0, indexCount - 2);
      if (!weightKeys.length) continue;
      const entry = { name: `${mesh.name || `Mesh ${meshIndex}`} / ${primitiveIndex}`, vertices: count,
        maxInfluences: 0, maxWeightError: 0, nonNormalized: 0, zeroWeights: 0, invalidWeights: 0, invalidJoints: 0, overFour: 0 };
      report.skinnedVertices += count; report.weightSetCount = Math.max(report.weightSetCount, weightKeys.length);
      const sets = weightKeys.map((key) => {
        const wi = primitive.attributes[key], ji = primitive.attributes[key.replace('WEIGHTS_', 'JOINTS_')], weight = json.accessors[wi], joint = json.accessors[ji];
        if (weight.count !== count || weight.type !== 'VEC4' || !joint || joint.count !== count || joint.type !== 'VEC4'
          || ![5121, 5123].includes(joint.componentType) || joint.normalized || ![5121, 5123, 5126].includes(weight.componentType)
          || (weight.componentType !== 5126 && !weight.normalized) || (weight.componentType === 5126 && weight.normalized)) throw new Error(`Unpassende Skin-Accessoren: ${entry.name}.`);
        return [read(wi), read(ji)];
      });
      for (let vertex = 0; vertex < count; vertex++) {
        let sum = 0, influences = 0, invalidWeight = false, invalidJoint = false;
        for (const [weights, joints] of sets) for (let component = 0; component < 4; component++) {
          const weight = weights[vertex * 4 + component], joint = joints[vertex * 4 + component];
          if (!Number.isFinite(weight) || weight < 0 || weight > 1) invalidWeight = true;
          if (!Number.isInteger(joint) || joint < 0 || joint >= jointLimit) invalidJoint = true;
          if (weight > AUDIT_CONFIG.influenceThreshold) influences++;
          sum += weight;
        }
        const error = Number.isFinite(sum) ? Math.abs(sum - 1) : 1;
        entry.maxInfluences = Math.max(entry.maxInfluences, influences); entry.maxWeightError = Math.max(entry.maxWeightError, error);
        if (error > AUDIT_CONFIG.sumTolerance) entry.nonNormalized++;
        if (sum <= AUDIT_CONFIG.influenceThreshold) entry.zeroWeights++;
        if (invalidWeight) entry.invalidWeights++;
        if (invalidJoint) entry.invalidJoints++;
        if (influences > 4) entry.overFour++;
      }
      for (const key of ['nonNormalized', 'zeroWeights', 'invalidWeights', 'invalidJoints', 'overFour']) report[key] += entry[key];
      report.maxInfluences = Math.max(report.maxInfluences, entry.maxInfluences); report.maxWeightError = Math.max(report.maxWeightError, entry.maxWeightError);
      report.meshes.push(entry);
    }
  }
  report.valid = report.skinnedVertices > 0 && ['nonNormalized', 'zeroWeights', 'invalidWeights', 'invalidJoints', 'overFour'].every((key) => report[key] === 0);
  return report;
}
