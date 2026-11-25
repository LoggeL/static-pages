#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROJECT_DIR = '/Users/logge/Documents/Projects/kindenheim-3d';
const CHROME_PATH =
  '/Users/logge/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const args = process.argv.slice(2);
const runName = args.find((a) => !a.startsWith('--')) || 'baseline';
const shouldBuild = args.includes('--build');
const PORT = 4174;
const CDP_PORT = 9248;

const OUT_DIR = path.join(PROJECT_DIR, 'data', 'benchmark', runName, 'renders');
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifestPath = path.join(PROJECT_DIR, 'data', 'references', 'brave', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const references = manifest.references || [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (shouldBuild) {
  console.log('[benchmark] Running npm run build...');
  await new Promise((resolve, reject) => {
    const b = spawn('npm', ['run', 'build'], { cwd: PROJECT_DIR, stdio: 'inherit' });
    b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed: ${code}`))));
  });
}

const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
  { cwd: PROJECT_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
);
server.stderr.on('data', (d) => process.stderr.write(`[preview-err] ${d}`));

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let chrome = null;
async function cleanup() {
  try {
    chrome?.kill('SIGKILL');
  } catch {}
  try {
    server?.kill('SIGKILL');
  } catch {}
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

let exitCode = 0;
const userDataDir = `/tmp/chrome-kindenheim-diff-${Date.now()}`;

try {
  await waitForHttp(`http://127.0.0.1:${PORT}/`);
  console.log(`[benchmark] Preview server up at http://127.0.0.1:${PORT}/ (run=${runName}, shots=${references.length})`);

  chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1440,900',
      '--force-device-scale-factor=1',
      '--use-gl=angle',
      '--use-angle=metal',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let pageTarget = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const targets = await r.json();
      pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget) break;
    } catch {}
    await sleep(250);
  }
  if (!pageTarget) throw new Error('Chrome CDP target not found');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  let nextId = 1;
  const pending = new Map();
  const consoleErrors = [];
  const exceptions = [];
  const httpErrors = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      const p = msg.params || {};
      if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        consoleErrors.push((p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails || {};
        exceptions.push(`${d.text || 'Exception'}: ${d.exception?.description || ''}`);
      } else if (msg.method === 'Network.responseReceived') {
        if ((p.response?.status || 0) >= 400) {
          httpErrors.push(`${p.response.status} ${p.response.url}`);
        }
      }
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evalJS(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(`evalJS error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
    }
    return res.result?.value;
  }

  async function waitFrames(n = 6) {
    await evalJS(
      `new Promise(r => { let c = 0; function f() { if (++c >= ${n}) r(); else requestAnimationFrame(f); } requestAnimationFrame(f); })`
    );
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

  let ready = false;
  for (let i = 0; i < 120; i++) {
    const ok = await evalJS(`Boolean(window.__KINDENHEIM__?.ready)`).catch(() => false);
    if (ok) {
      ready = true;
      break;
    }
    await sleep(400);
  }
  if (!ready) throw new Error('Timed out waiting for window.__KINDENHEIM__.ready');

  // Enter clean benchmark capture state (hide HUD, tractor, trailer, checkpoints)
  const cleanInfo = await evalJS(`(() => {
    const api = window.__KINDENHEIM__;
    let usedNativeClean = false;
    if (typeof api.setBenchmarkCleanCapture === 'function') {
      api.setBenchmarkCleanCapture(true);
      usedNativeClean = true;
    } else {
      api.setCameraMode?.('drone');
      api.setBenchmarkMode?.(false);
      api.setTractorOptions?.({ trailer: false, beacon: false, lights: false });
      api.teleportTractor?.(-980, -980, 0);
    }
    api.setTimeOfDay?.('noon');

    // Guarantee pure full-bleed 1440x900 WebGL canvas with zero HUD chrome
    let st = document.getElementById('diff-clean-css');
    if (!st) {
      st = document.createElement('style');
      st.id = 'diff-clean-css';
      st.textContent = '#hud, #compare-stage, #loading-overlay, #tour-toast { display: none !important; }';
      document.head.appendChild(st);
    }
    return { usedNativeClean };
  })()`);
  console.log('[benchmark] Clean capture setup:', JSON.stringify(cleanInfo));

  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    const ok = await evalJS(`window.__KINDENHEIM__.setReferenceView(${JSON.stringify(ref.id)}, true)`);
    if (!ok) {
      console.warn(`[benchmark] WARNING: setReferenceView(${ref.id}) returned false`);
      continue;
    }
    await waitFrames(6);
    await sleep(100);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(OUT_DIR, `${ref.id}.png`);
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log(`  [${String(i + 1).padStart(2, '0')}/${references.length}] ${ref.id}.png (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
  }

  console.log(
    `[benchmark] Done! Errors: console=${consoleErrors.length}, exceptions=${exceptions.length}, http>=400=${httpErrors.length}`
  );
  if (consoleErrors.length) consoleErrors.forEach((e) => console.log('  [ERR]', e));
  if (exceptions.length) exceptions.forEach((e) => console.log('  [EXC]', e));
  if (httpErrors.length) httpErrors.forEach((e) => console.log('  [HTTP]', e));

  ws.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
} catch (err) {
  console.error('[benchmark] FATAL:', err);
  exitCode = 1;
} finally {
  await cleanup();
  process.exit(exitCode);
}
