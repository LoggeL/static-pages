// Prüft nach `vite build`, dass der Start leicht bleibt (2D ohne three/Spark).
// Bricht mit Exit-Code 1 ab, wenn
//   - der Einstiegs-Chunk gzip über 45 KB liegt,
//   - dist/index.html einen modulepreload auf einen Chunk mit SparkRenderer/WebGLRenderer enthält,
//   - der Einstiegs-Chunk diese Bezeichner enthält,
//   - das CSS gzip über 8 KB liegt.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const ENTRY_MAX = 45 * 1024;
const CSS_MAX = 8 * 1024;
const BANNED = ['SparkRenderer', 'WebGLRenderer'];

const fail = [];
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const rel = (src) => path.join(DIST, src.replace(/^\.?\//, ''));

const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
if (entries.length !== 1) fail.push(`dist/index.html: ${entries.length} Modul-Skripte statt genau einem`);
for (const src of entries) {
  const buf = fs.readFileSync(rel(src));
  const z = gz(buf);
  if (z > ENTRY_MAX) fail.push(`Einstiegs-Chunk ${src}: ${kb(z)} gzip > ${kb(ENTRY_MAX)}`);
  const text = buf.toString('utf8');
  for (const b of BANNED) if (text.includes(b)) fail.push(`Einstiegs-Chunk ${src} enthält „${b}“ (three/Spark gehören in den 3D-Chunk)`);
}
for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) {
  const text = fs.readFileSync(rel(m[1]), 'utf8');
  for (const b of BANNED) if (text.includes(b)) fail.push(`dist/index.html lädt ${m[1]} per modulepreload vor – enthält „${b}“`);
}
for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
  const z = gz(fs.readFileSync(rel(m[1])));
  if (z > CSS_MAX) fail.push(`CSS ${m[1]}: ${kb(z)} gzip > ${kb(CSS_MAX)}`);
}

const rows = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html)$/.test(f)) { const b = fs.readFileSync(p); rows.push([path.relative(DIST, p), b.length, gz(b)]); }
  }
};
walk(path.join(DIST, 'assets'));
rows.push(['index.html', Buffer.byteLength(html), gz(Buffer.from(html))]);
rows.sort((a, b) => b[1] - a[1]);
console.log('\nChunk                                        roh          gzip');
for (const [n, r, z] of rows) console.log(`${n.padEnd(42)} ${kb(r).padStart(11)} ${kb(z).padStart(11)}`);
if (fail.length) {
  console.error(`\nBundle-Prüfung fehlgeschlagen:\n  - ${fail.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nBundle-Prüfung bestanden (Start-Chunk ohne three/Spark, Grenzen eingehalten).');
