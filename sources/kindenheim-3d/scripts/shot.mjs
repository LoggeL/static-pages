#!/usr/bin/env node
/**
 * Shared headless screenshot tool for Kindenheim 3D (used by every graphics agent to self-verify).
 *
 * Requires an ALREADY RUNNING dev/preview server (start your own: `npx vite --port <port> --strictPort`).
 * Chrome runs headless and muted (--mute-audio) — never produces sound.
 *
 * Usage:
 *   node scripts/shot.mjs --port 5301 --out /abs/out/dir --shots /abs/shots.json [--width 1600 --height 900] [--hud]
 *   node scripts/shot.mjs --port 5301 --out /abs/out/dir --preset standard
 *
 * shots.json = array of:
 *   {
 *     "name": "kirche_west",              // -> <out>/<name>.png
 *     "time": "noon",                     // morning | noon | golden | dusk (default: golden)
 *     "bookmark": 1,                      // EITHER a drone bookmark index (0..6)
 *     "pos": [x, y, z], "target": [x, y, z], "fov": 50,   // OR an explicit drone pose
 *     "agl": true,                        // if true, pos[1]/target[1] are metres ABOVE GROUND at their own x/z
 *     "mode": "chase",                    // OR a tractor camera: chase | cab
 *     "tractor": [x, z, headingRad],      // optional: teleport tractor first
 *     "clean": true,                      // hide tractor, tour markers, pins (default false)
 *     "eval": "window.__KINDENHEIM__...", // optional JS evaluated after the pose is set
 *     "frames": 12                        // frames to wait before capture (default 12)
 *   }
 *
 * World axes: +X East, +Y up, +Z South. Map is 2048 m square centred on 0,0.
 * Exit code 1 if the page logged console errors / exceptions / HTTP >= 400 (they are printed).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH =
  '/Users/logge/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const PRESETS = {
  standard: [
    { name: 'overview', bookmark: 0, time: 'golden', clean: true },
    { name: 'kirche', bookmark: 1, time: 'golden', clean: true },
    { name: 'hauptstrasse', bookmark: 2, time: 'noon', clean: true },
    { name: 'weinberge', bookmark: 3, time: 'golden', clean: true },
    { name: 'strasse_2m5', bookmark: 4, time: 'noon', clean: true },
    { name: 'fussballplatz', bookmark: 5, time: 'noon', clean: true },
    { name: 'spielplatz', bookmark: 6, time: 'golden', clean: true },
    { name: 'chase_golden', mode: 'chase', time: 'golden' },
    { name: 'chase_dusk', mode: 'chase', time: 'dusk' },
    { name: 'cabin_morning', mode: 'cabin', time: 'morning' },
  ],
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const port = Number(arg('port'));
const outDir = arg('out');
const shotsFile = arg('shots');
const presetName = arg('preset');
const width = Number(arg('width', 1600));
const height = Number(arg('height', 900));
const showHud = Boolean(arg('hud', false));
const urlPath = arg('path', '/');

if (!port || !outDir || (!shotsFile && !presetName)) {
  console.error('Usage: node scripts/shot.mjs --port <devServerPort> --out <dir> (--shots <file.json> | --preset standard)');
  process.exit(2);
}
if (!fs.existsSync(CHROME_PATH)) {
  console.error(`Chrome for Testing not found at ${CHROME_PATH}`);
  process.exit(2);
}

const shots = shotsFile ? JSON.parse(fs.readFileSync(shotsFile, 'utf-8')) : PRESETS[presetName];
if (!Array.isArray(shots) || shots.length === 0) {
  console.error(`No shots found (preset=${presetName}, file=${shotsFile})`);
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdpPort = 20000 + (port % 10000) + Math.floor(Math.random() * 500) * 20 + (process.pid % 20);
const userDataDir = `/tmp/chrome-kindenheim-shot-${process.pid}-${Date.now()}`;
// `localhost` (not 127.0.0.1): a plain `npx vite --port N` binds to ::1 only on this machine.
const baseUrl = `http://localhost:${port}${urlPath}`;

try {
  const probe = await fetch(baseUrl);
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (e) {
  console.error(`Dev server not reachable at ${baseUrl}: ${e.message}. Start it first (npx vite --port ${port} --strictPort).`);
  process.exit(2);
}

const chrome = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let exitCode = 0;
const cleanup = () => {
  try {
    chrome.kill('SIGKILL');
  } catch {}
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
};
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

try {
  let pageTarget = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      pageTarget = (await r.json()).find((t) => t.type === 'page');
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
  const problems = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      const p = msg.params || {};
      if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) {
        problems.push(`[console.${p.type}] ` + (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails || {};
        problems.push(`[exception] ${d.text || ''} ${d.exception?.description || ''}`);
      } else if (msg.method === 'Network.responseReceived' && (p.response?.status || 0) >= 400) {
        problems.push(`[http ${p.response.status}] ${p.response.url}`);
      }
    }
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const evalJS = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(`evalJS error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
    }
    return res.result?.value;
  };
  const waitFrames = (n) =>
    evalJS(`new Promise(r => { let c = 0; function f() { if (++c >= ${n}) r(); else requestAnimationFrame(f); } requestAnimationFrame(f); })`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: baseUrl });

  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (await evalJS('Boolean(window.__KINDENHEIM__?.ready)').catch(() => false)) {
      ready = true;
      break;
    }
    await sleep(400);
  }
  if (!ready) {
    const status = await evalJS(`document.getElementById('loading-status')?.textContent || ''`).catch(() => '');
    throw new Error(`Timed out waiting for window.__KINDENHEIM__.ready (loading status: "${status}")`);
  }

  if (!showHud) {
    await evalJS(`(() => {
      const st = document.createElement('style');
      st.id = 'shot-clean-css';
      st.textContent = '#hud, #compare-stage, #loading-overlay, #tour-toast { display: none !important; }';
      document.head.appendChild(st);
    })()`);
  }

  for (const shot of shots) {
    if (!shot.name) throw new Error(`Shot without name: ${JSON.stringify(shot)}`);
    const frames = shot.frames ?? 12;
    await evalJS(`(() => {
      const api = window.__KINDENHEIM__;
      const s = ${JSON.stringify(shot)};
      api.setBenchmarkCleanCapture(Boolean(s.clean));
      api.setTimeOfDay(s.time || 'golden');
      if (Array.isArray(s.tractor)) api.teleportTractor(s.tractor[0], s.tractor[1], s.tractor[2] || 0);
      if (s.mode === 'chase' || s.mode === 'cab' || s.mode === 'cabin') {
        // The app's CameraMode is 'cab'; 'cabin' is accepted as an alias.
        api.setCameraMode(s.mode === 'cabin' ? 'cab' : s.mode);
      } else if (typeof s.bookmark === 'number') {
        api.setBookmark(s.bookmark, true);
      } else if (Array.isArray(s.pos) && Array.isArray(s.target)) {
        const pos = s.pos.slice(), target = s.target.slice();
        if (s.agl) {
          if (typeof api.getTerrainHeight !== 'function') throw new Error('agl requested but __KINDENHEIM__.getTerrainHeight is missing');
          pos[1] += api.getTerrainHeight(pos[0], pos[2]);
          target[1] += api.getTerrainHeight(target[0], target[2]);
        }
        api.flyTo(pos, target, true, s.fov);
      } else {
        throw new Error('Shot needs bookmark, pos+target or mode: ' + JSON.stringify(s));
      }
    })()`);
    if (shot.eval) await evalJS(shot.eval);
    await waitFrames(frames);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `${shot.name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`[shot] ${file}`);
  }

  const perf = await evalJS(`(() => {
    const t = window.__KINDENHEIM__.three;
    if (!t) return null;
    const i = t.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  })()`).catch(() => null);
  if (perf) console.log(`[shot] renderer.info (last frame): ${JSON.stringify(perf)}`);

  if (problems.length) {
    console.error(`[shot] ${problems.length} console/network problem(s):`);
    for (const p of [...new Set(problems)].slice(0, 40)) console.error('  ' + p);
    exitCode = 1;
  }
  ws.close();
} catch (err) {
  console.error(`[shot] FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  cleanup();
}
process.exit(exitCode);
