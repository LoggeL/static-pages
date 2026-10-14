import http from 'node:http';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { within } from './paths.mjs';

// Revalidate every local request. Chromium 153 can misreport fully consumed
// no-store streams as ERR_ABORTED (playwright#42742); network-regression.mjs
// verifies byte hashes and both policies. Errors remain strict in the runner.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ktx2': 'image/ktx2', '.hdr': 'image/vnd.radiance',
};

export async function startServer(root, port = 8969) {
  const canonicalRoot = await realpath(root);
  if (!(await stat(canonicalRoot)).isDirectory()) throw new Error('Serverwurzel ist kein Verzeichnis.');
  const server = http.createServer(async (request, response) => {
    const fail = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return fail(405, 'Method not allowed');
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
      catch { return fail(400, 'Invalid URL'); }
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part === '..' || part.startsWith('.'))) return fail(403, 'Forbidden');
      let file = path.resolve(canonicalRoot, `.${pathname}`);
      if (!within(canonicalRoot, file)) return fail(403, 'Forbidden');
      file = await realpath(file);
      if (!within(canonicalRoot, file)) return fail(403, 'Forbidden');
      let info = await stat(file);
      if (info.isDirectory()) {
        if (!pathname.endsWith('/')) {
          const url = new URL(request.url, 'http://127.0.0.1');
          response.writeHead(301, { Location: `${url.pathname}/${url.search}`, 'Cache-Control': 'no-cache' });
          return response.end();
        }
        file = await realpath(path.join(file, 'index.html'));
        if (!within(canonicalRoot, file)) return fail(403, 'Forbidden');
        info = await stat(file);
      }
      if (!info.isFile()) return fail(404, 'Not found');
      const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
      };
      let start = 0, end = info.size - 1, status = 200;
      if (request.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (!range || (!range[1] && !range[2])) return fail(416, 'Invalid range');
        if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
        else {
          start = Number(range[1]);
          if (range[2]) end = Math.min(end, Number(range[2]));
        }
        if (start > end || start >= info.size) {
          response.setHeader('Content-Range', `bytes */${info.size}`);
          return fail(416, 'Range not satisfiable');
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = Math.max(0, end - start + 1);
      response.writeHead(status, headers);
      if (request.method === 'HEAD' || info.size === 0) return response.end();
      await pipeline(createReadStream(file, { start, end }), response);
    } catch (error) {
      if (!response.headersSent) fail(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500, 'Static resource unavailable');
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
