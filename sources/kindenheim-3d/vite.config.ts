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

/**
 * Data the runtime cannot start without (the loaders fail loudly if one is missing), so the build fails loudly
 * too instead of shipping a broken bundle.
 */
const RUNTIME_DATA_FILES = [
  'meta.json',
  'terrain/heightmap.bin', // 4 m height field with graded road beds (scripts/build_terrain_roadbed.py)
  'osm/kindenheim_scene.json',
  'osm/fields_layout.json',
  'osm/vegetation_layout.json', // trees / hedges / shrubs detected in the 0.2 m aerial (scripts/detect_vegetation.py)
] as const;

/** Terrain imagery, built by scripts/build_terrain_*.py (data/terrain/landuse_mask.png is build input only). */
const REQUIRED_TERRAIN_FILES = [
  'terrain/ground_splat.png', // 1 m ground material map (terrain shader, lossless)
  'terrain/relief.jpg', // 1 m LiDAR micro-relief slopes
  'terrain/ortho/manifest.json', // tile layout + DOP20 attribution (dl-de/by-2-0)
  'terrain/ortho/base.webp', // whole map at 0.5 m/px
  'terrain/far/manifest.json', // far terrain ring: extents + attribution
  'terrain/far/inner.webp', // 6.1 km square at 3 m/px
  'terrain/far/outer.webp', // 16.4 km square at 8 m/px
] as const;
const ORTHO_TILES_PER_SIDE = 8; // terrain/ortho/hi_<row>_<col>.webp, 0.2 m/px, streamed around the camera

/**
 * `data/terrain/orthophoto.jpg` (9.5 MB, 4096 px) stays untouched as the offline aerial reference. At runtime it
 * is only drawn into the minimap and the benchmark overlay, so the bundle ships the 2048 px copy under its name.
 */
const MINIMAP_ORTHO_SRC = 'terrain/ortho/minimap.jpg';
const MINIMAP_ORTHO_DEST = 'terrain/orthophoto.jpg';

function copyRequired(srcData: string, destData: string, srcRel: string, destRel = srcRel): void {
  const srcPath = path.join(srcData, srcRel);
  if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
    throw new Error(
      `[serve-and-copy-data] required runtime file data/${srcRel} is missing. ` +
        'Terrain files come from scripts/fetch_ortho_hires.py, fetch_ortho_far.py and build_terrain_*.py; ' +
        'osm/* from scripts/fetch_geodata.py, build_fields_layout.py and detect_vegetation.py.'
    );
  }
  const destPath = path.join(destData, destRel);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}

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
    copyRequired(srcData, destData, rel);
  }

  // Terrain imagery: aerial base + 64 streamed 0.2 m tiles + material map + micro-relief (all mandatory)
  for (const rel of REQUIRED_TERRAIN_FILES) {
    copyRequired(srcData, destData, rel);
  }
  for (let row = 0; row < ORTHO_TILES_PER_SIDE; row++) {
    for (let col = 0; col < ORTHO_TILES_PER_SIDE; col++) {
      copyRequired(srcData, destData, `terrain/ortho/hi_${row}_${col}.webp`);
    }
  }
  copyRequired(srcData, destData, MINIMAP_ORTHO_SRC, MINIMAP_ORTHO_DEST);

  // The benchmark summary is the one truly optional file (write a stub so static hosts never 404)
  for (const optionalRel of ['benchmark/latest_summary.json']) {
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
    // PNG references are re-encoded as JPEG with Pillow. No fallback: if python3 / Pillow is missing or an image is
    // broken, the build fails with the Python error instead of silently shipping 5x larger PNGs.
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
    try {
      execFileSync('python3', ['-c', pyScript, srcBrave, destBrave, JSON.stringify(fileList)], { stdio: 'pipe' });
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
      throw new Error(`[serve-and-copy-data] converting the reference photos with python3 + Pillow failed: ${stderr || (err as Error).message}`);
    }
    const outManifest = rawManifest.replace(/(\/data\/references\/brave\/[^"']+)\.png/gi, '$1.jpg');
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

    if (!filePath.startsWith(dataRoot) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // The benchmark summary is optional: answer with a stub. Everything else under /data is a real 404, so a
      // missing data file is reported by the loaders instead of being masked by the dev server's index.html.
      const optional = cleanUrl === '/benchmark/latest_summary.json';
      const body = optional ? JSON.stringify({ available: false }) : `Not found: /data${cleanUrl}`;
      res.statusCode = optional ? 200 : 404;
      res.setHeader('Content-Type', optional ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
      res.setHeader('Content-Length', String(Buffer.byteLength(body)));
      res.setHeader('Cache-Control', 'no-cache');
      res.end(body);
      return;
    }

    const stat = fs.statSync(filePath);

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
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
    },
    configurePreviewServer(server) {
      const distData = path.resolve(rootDir, outDir, 'data');
      const fallbackData = path.resolve(rootDir, 'data');
      attachDataMiddleware(server, fs.existsSync(distData) ? distData : fallbackData);
    },
    closeBundle() {
      const srcData = path.resolve(rootDir, 'data');
      const destData = path.resolve(rootDir, outDir, 'data');
      if (fs.existsSync(srcData)) {
        copySlimRuntimeData(srcData, destData);
      }
      // Model manifests the loaders require: a build without them would start as an empty world.
      for (const rel of ['landmarks', 'village', 'tractor', 'fields', 'people' /* NPC pedestrians */]) {
        const manifest = path.resolve(rootDir, outDir, `assets/models/${rel}/manifest.json`);
        if (!fs.existsSync(manifest)) {
          throw new Error(`[serve-and-copy-data] ${manifest} is missing (public/assets/models/${rel}/manifest.json was not built)`);
        }
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
