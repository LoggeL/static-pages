import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "docs",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        gallery: resolve(root, "index.html"),
        sharex: resolve(root, "designs/sharex/index.html"),
        sharexAfterimage: resolve(root, "designs/sharex-afterimage/index.html"),
      },
    },
  },
});
