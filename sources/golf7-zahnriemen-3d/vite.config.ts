import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: '../../public',
  build: {
    outDir: '../../public/golf7-zahnriemen-3d',
    emptyOutDir: true,
    copyPublicDir: false,
  },
});
