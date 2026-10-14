#!/usr/bin/env node
// Offline bridge. The exact source GLB arrives on stdin; no source files change.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');
try {
  const decoderPath = process.argv[2];
  if (!decoderPath) throw new Error('Supply the real MeshoptDecoder ES module path');
  const decoderBytes = await fs.readFile(decoderPath);
  const { MeshoptDecoder } = await import(pathToFileURL(decoderPath).href);
  if (!MeshoptDecoder?.supported || typeof MeshoptDecoder.decodeGltfBuffer !== 'function') {
    throw new Error('Module does not expose a supported MeshoptDecoder');
  }
  await MeshoptDecoder.ready;
  const input = [];
  for await (const chunk of process.stdin) input.push(chunk);
  const source = Buffer.concat(input);
  if (source.length < 20 || source.readUInt32LE(0) !== 0x46546c67
      || source.readUInt32LE(4) !== 2 || source.readUInt32LE(8) !== source.length) throw new Error('Invalid GLB header');
  let doc, binary, offset = 12;
  while (offset < source.length) {
    if (offset + 8 > source.length) throw new Error('Truncated GLB chunk header');
    const size = source.readUInt32LE(offset), kind = source.readUInt32LE(offset + 4);
    offset += 8;
    if (size % 4 || offset + size > source.length) throw new Error('Invalid GLB chunk length');
    const bytes = source.subarray(offset, offset + size);
    if (kind === 0x4e4f534a) {
      if (doc) throw new Error('Duplicate GLB JSON chunk');
      doc = JSON.parse(bytes.toString('utf8'));
    } else if (kind === 0x004e4942) {
      if (binary) throw new Error('Duplicate GLB binary chunk');
      binary = bytes;
    }
    offset += size;
  }
  if (!doc || !binary) throw new Error('Meshopt GLB needs JSON and binary chunks');
  const views = [];
  for (const [index, view] of (doc.bufferViews || []).entries()) {
    const extension = view.extensions?.EXT_meshopt_compression;
    if (!extension) continue;
    if (extension.buffer !== 0 || doc.buffers?.[0]?.uri) throw new Error('Only an embedded Meshopt source buffer is supported');
    const { count, byteStride, byteLength, mode } = extension;
    const start = extension.byteOffset ?? 0;
    if (![count, byteStride, byteLength, start].every(Number.isSafeInteger)
        || count < 0 || byteStride < 1 || byteLength < 1 || start < 0
        || !Number.isSafeInteger(count * byteStride) || count * byteStride !== view.byteLength
        || start + byteLength > binary.length || start + byteLength > doc.buffers[0].byteLength) {
      throw new Error(`Invalid Meshopt bufferView ${index}`);
    }
    const decoded = Buffer.alloc(count * byteStride);
    MeshoptDecoder.decodeGltfBuffer(decoded, count, byteStride,
      binary.subarray(start, start + byteLength), mode, extension.filter ?? 'NONE');
    views.push({ index, bytes: decoded.length, sha256: sha256(decoded), data: decoded.toString('base64') });
  }
  process.stdout.write(JSON.stringify({ sourceBytes: source.length, sourceSha256: sha256(source),
    decoderSha256: sha256(decoderBytes), views }));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
