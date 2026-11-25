import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vite';

const MIME_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

const RUNTIME_DATA_FILES = [
  'meta.json',
  'terrain/heightmap.bin',
  'terrain/orthophoto.jpg',
  'terrain/landuse_mask.png',
  'osm/kindenheim_scene.json',
  'osm/fields_layout.json',
] as const;

function copyFileIfExists(srcPath: string, destPath: string): boolean {
  if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) return false;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  return true;
}

/**
 * Copies only runtime-required data files into `dist/data/`, excluding heavy offline
 * benchmark caches (`data/benchmark/{baseline,iter1,iter2}/`) and unused raw assets.
 * Also compresses the 15 Brave Street View/Satellite PNG references to quality-88 JPEGs
 * in `dist/data/references/brave/` (leaving source `data/` untouched) for fast web delivery.
 */
function copySlimRuntimeData(srcData: string, destData: string): void {
  if (!fs.existsSync(srcData)) return;
  fs.mkdirSync(destData, { recursive: true });

  for (const rel of RUNTIME_DATA_FILES) {
    copyFileIfExists(path.join(srcData, rel), path.join(destData, rel));
  }

  // Copy latest quantitative benchmark summary & optional fields layout (or write stub so static hosts never 404)
  for (const optionalRel of ['benchmark/latest_summary.json', 'osm/fields_layout.json']) {
    const srcOpt = path.join(srcData, optionalRel);
    const destOpt = path.join(destData, optionalRel);
    if (!copyFileIfExists(srcOpt, destOpt)) {
      fs.mkdirSync(path.dirname(destOpt), { recursive: true });
      fs.writeFileSync(destOpt, JSON.stringify({ available: false }), 'utf-8');
    }
  }

  // Copy & optimize Brave reference views listed in manifest.json (source stays untouched)
  const srcBrave = path.join(srcData, 'references/brave');
  const destBrave = path.join(destData, 'references/brave');
  const srcManifest = path.join(srcBrave, 'manifest.json');
  if (fs.existsSync(srcManifest)) {
    fs.mkdirSync(destBrave, { recursive: true });
    const rawManifest = fs.readFileSync(srcManifest, 'utf-8');
    // Only ship images actually referenced in manifest.json (avoids stale or in-progress captures)
    const refFiles = new Set<string>();
    const re = /\/data\/references\/brave\/([^"']+\.(?:png|jpe?g|webp))/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawManifest)) !== null) {
      refFiles.add(m[1]);
    }
    const fileList = Array.from(refFiles).sort();
    let convertedToJpg = false;

    try {
      const pyScript = `
import json, os, shutil, sys
from PIL import Image
src_dir, dst_dir, files_json = sys.argv[1], sys.argv[2], sys.argv[3]
files = json.loads(files_json)
# Keep deployed GitHub Pages bundle lean once full-village 22-street expansion adds 60-90+ reference photos
max_w = 1200 if len(files) > 35 else 1440
jpg_q = 84 if len(files) > 35 else 88
for name in files:
    src_p = os.path.join(src_dir, name)
    if not os.path.isfile(src_p):
        continue
    if name.lower().endswith('.png'):
        dst_p = os.path.join(dst_dir, os.path.splitext(name)[0] + '.jpg')
        with Image.open(src_p) as im:
            rgb = im.convert('RGB')
            if rgb.width > max_w:
                new_h = int(round(rgb.height * (max_w / rgb.width)))
                rgb = rgb.resize((max_w, new_h), Image.Resampling.LANCZOS)
            rgb.save(dst_p, format='JPEG', quality=jpg_q, optimize=True, progressive=True)
    else:
        shutil.copy2(src_p, os.path.join(dst_dir, name))
`;
      execFileSync('python3', ['-c', pyScript, srcBrave, destBrave, JSON.stringify(fileList)], { stdio: 'pipe' });
      convertedToJpg = true;
    } catch {
      // Fallback: copy original files if Python/Pillow is unavailable
      for (const name of fileList) {
        copyFileIfExists(path.join(srcBrave, name), path.join(destBrave, name));
      }
    }

    const outManifest = convertedToJpg
      ? rawManifest.replace(/(\/data\/references\/brave\/[^"']+)\.png/gi, '$1.jpg')
      : rawManifest;
    fs.writeFileSync(path.join(destBrave, 'manifest.json'), outManifest, 'utf-8');
  }
}

function attachDataMiddleware(server: ViteDevServer | { middlewares: ViteDevServer['middlewares'] }, dataRoot: string): void {
  server.middlewares.use('/data', (req, res, next) => {
    if (!req.url) {
      next();
      return;
    }
    const cleanUrl = decodeURIComponent(req.url.split('?')[0]);
    const normalized = path.normalize(cleanUrl).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(dataRoot, normalized);

    if (!filePath.startsWith(dataRoot) || !fs.existsSync(filePath)) {
      // Gracefully return empty stub for optional runtime files so browser console stays 0-404 clean before generation
      if (cleanUrl === '/benchmark/latest_summary.json' || cleanUrl === '/osm/fields_layout.json') {
        const body = JSON.stringify({ available: false });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(Buffer.byteLength(body)));
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
        return;
      }
      next();
      return;
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      next();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  });
}

function attachOptionalManifestFallback(
  server: ViteDevServer | { middlewares: ViteDevServer['middlewares'] },
  assetsRoot: string
): void {
  server.middlewares.use('/assets/models/fields/manifest.json', (_req, res, next) => {
    const manifestPath = path.join(assetsRoot, 'models/fields/manifest.json');
    if (fs.existsSync(manifestPath)) {
      next();
      return;
    }
    const body = JSON.stringify({ available: false });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(Buffer.byteLength(body)));
    res.setHeader('Cache-Control', 'no-cache');
    res.end(body);
  });
}

function serveAndCopyDataPlugin(): Plugin {
  let rootDir = process.cwd();
  let outDir = 'dist';

  return {
    name: 'serve-and-copy-data',
    configResolved(config) {
      rootDir = config.root;
      outDir = config.build.outDir;
    },
    configureServer(server) {
      const dataRoot = path.resolve(rootDir, 'data');
      attachDataMiddleware(server, dataRoot);
      attachOptionalManifestFallback(server, path.resolve(rootDir, 'public/assets'));
    },
    configurePreviewServer(server) {
      const distData = path.resolve(rootDir, outDir, 'data');
      const fallbackData = path.resolve(rootDir, 'data');
      attachDataMiddleware(server, fs.existsSync(distData) ? distData : fallbackData);
      const distAssets = path.resolve(rootDir, outDir, 'assets');
      attachOptionalManifestFallback(server, fs.existsSync(distAssets) ? distAssets : path.resolve(rootDir, 'public/assets'));
    },
    closeBundle() {
      const srcData = path.resolve(rootDir, 'data');
      const destData = path.resolve(rootDir, outDir, 'data');
      if (fs.existsSync(srcData)) {
        copySlimRuntimeData(srcData, destData);
      }
      // Ensure optional fields manifest exists in dist/ so static hosts never 404 before @blender-fields publishes
      const destFieldsManifest = path.resolve(rootDir, outDir, 'assets/models/fields/manifest.json');
      if (!fs.existsSync(destFieldsManifest)) {
        fs.mkdirSync(path.dirname(destFieldsManifest), { recursive: true });
        fs.writeFileSync(destFieldsManifest, JSON.stringify({ available: false }), 'utf-8');
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serveAndCopyDataPlugin()],
  server: {
    port: 5173,
    fs: {
      allow: ['.'],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
