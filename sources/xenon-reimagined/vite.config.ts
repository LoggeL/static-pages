import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  esbuild: { jsx: 'automatic' },
});
