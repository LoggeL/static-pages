import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Relative so the same artifact works at the dev root, under a static
  // subdirectory such as /static-pages/veil/, or straight off the filesystem.
  base: './',
  server: { port: 5173 },
  build: {
    // The MediaPipe runtime is self-hosted from /public, so it never enters the bundle.
    chunkSizeWarningLimit: 900,
  },
})
