import { defineConfig } from 'vite';

// base './' erzeugt relative Pfade: der Ordner dist/ läuft unverändert auf
// jedem statischen Hoster, auch in einem Unterverzeichnis.
export default defineConfig({
  base: './',
  // chunkSizeWarningLimit gilt nur für den 3D-Chunk (Spark mit eingebettetem WASM, ≈ 3,4 MB);
  // die harte Grenze für den Start-Chunk prüft tools/check_bundle.mjs.
  build: { target: 'es2022', chunkSizeWarningLimit: 3700 },
  worker: { format: 'es' },
  server: { host: '127.0.0.1' },
});
