import { defineConfig } from 'vite';

// base './' erzeugt relative Pfade: der Ordner dist/ läuft unverändert auf
// jedem statischen Hoster, auch in einem Unterverzeichnis.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4500 },
  worker: { format: 'es' },
  server: { host: '127.0.0.1' },
});
