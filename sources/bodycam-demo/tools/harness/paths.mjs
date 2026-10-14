import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, realpath, readdir } from 'node:fs/promises';

export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HARNESS_DIR, '../../../..');
export const PUBLIC_ROOT = path.join(REPO_ROOT, 'public');
export const WORK_ROOT = '/Users/logge/Documents/Projects/bodycam-work/codex/C20';
export const CHROMIUM_PATH = '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

export function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Resolve the existing prefix, including symlinks, before creating anything.
export async function canonicalTarget(target) {
  let prefix = path.resolve(target);
  const tail = [];
  for (;;) {
    try { return path.join(await realpath(prefix), ...tail.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(prefix);
      if (parent === prefix) throw error;
      tail.push(path.basename(prefix));
      prefix = parent;
    }
  }
}

export async function prepareOutput(target) {
  const output = await canonicalTarget(target);
  if (within(await realpath(REPO_ROOT), output)) throw new Error('Ergebnisordner muss außerhalb des Repos liegen.');
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error(`Ergebnisordner ist nicht leer: ${output}`);
  return output;
}

export function localPage(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) {
    throw new Error('--page muss ein lokaler Pfad unter public/ sein, keine URL.');
  }
  const rawPath = value.split(/[?#]/, 1)[0];
  const decoded = decodeURIComponent(rawPath);
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) throw new Error('Unzulässiger Seitenpfad.');
  // Leading slash is public-root-relative. Strip a convenient public/ prefix.
  const relative = value.replace(/^\//, '').replace(/^public\//, '');
  const url = new URL(relative, 'http://127.0.0.1/');
  if (url.origin !== 'http://127.0.0.1') throw new Error('Seitenpfad verlässt den lokalen Server.');
  return `${url.pathname}${url.search}${url.hash}`;
}
