// Messharness für den Grundstück-Viewer (Headless Chromium, kein Ton).
//
//   node tools/perf.mjs --url http://127.0.0.1:<port>/ --playwright <pfad>/node_modules/playwright \
//     --profile desktop|mobile|mobile-cpu4|mobile-cpu6 --gpu metal|swiftshader \
//     --scenario 2d|3d|orbit|switch|tiers|check-tiers [--tier id] [--legacy] [--override id=datei.sog] --out <json>
//
// Szenarien (Nummern wie SPEC-2d-perf.md 6.2):
//   2d           Start bis erstes Kartenbild, Bytes, Netzwerk (1); Pan/Zoom 240 Frames (2); Leerlauf 5 s (3)
//   3d           3D öffnen (10), Leerlauf 8 s (4), Leerlauf 6 s ab 2 s nach einer Ziehgeste (4), Kamerafahrt 10 s (5–7), Picks (14), Gitter gegen linear (15), Speicher (11)
//   orbit        echte Maus-Orbitgeste ab der Startansicht (cfg.view), 2 Durchgänge: Bildabstände, GPU-Zeit
//                je Render, Long Tasks, CPU-Profil. Misst den teuren Fall, den die Kamerafahrt (3d) nicht abfährt.
//   switch       2D → 3D → 2D: Canvas, __viewer, Worker, Heap (12)
//   tiers        Stufenwechsel max → niedrig → max (13) und Bildvergleich je Stufe aus 3 Kamerastellungen (17)
//                Nr. 13 gilt auf macOS für gpuGraphicsRatioLowToMax (Grafikspeicher des GPU-Prozesses laut
//                `footprint`); das RSS (gpuRatioLowToMax) enthält auf Apple Silicon keinen GPU-Speicher.
//   check-tiers  jede Stufe laden, numSplats == count, Dateigröße == bytes, keine Konsolenfehler (16)
//   --legacy     alter Stand (wartet auf #loading.done): Laden, Leerlauf, Fahrt, Picks
//   --override   ersetzt die Datei einer Stufe (z. B. Bildvergleich adaptive gegen importance);
//                scene.json wird dafür im Browser mit Größe und Anzahl der Ersatzdatei ausgeliefert.
//
// CPU-Drosselung (mobile-cpuN) läuft über CDP Emulation.setCPUThrottlingRate und drosselt nur den
// Hauptthread, nicht Worker und nicht den GPU-Prozess. Handy-Profile sind Emulation auf dem Mac:
// Füllrate, Speichergrenzen und Wärmeverhalten echter Geräte bildet das nicht ab.
// SwiftShader-Läufe sind für 3D nicht repräsentativ.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- Argumente
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) throw new Error(`Unerwartetes Argument „${argv[i]}“`);
  const k = argv[i].slice(2);
  if (k === 'legacy') opt.legacy = true;
  else { if (argv[i + 1] === undefined) throw new Error(`--${k} braucht einen Wert`); opt[k] = argv[++i]; }
}
for (const k of ['url', 'playwright', 'profile', 'gpu', 'scenario', 'out']) if (!opt[k]) throw new Error(`--${k} fehlt`);
if (!/^(desktop|mobile|mobile-cpu4|mobile-cpu6)$/.test(opt.profile)) throw new Error(`--profile „${opt.profile}“ unbekannt`);
if (!/^(metal|swiftshader)$/.test(opt.gpu)) throw new Error(`--gpu „${opt.gpu}“ unbekannt`);
if (!/^(2d|3d|orbit|switch|tiers|check-tiers)$/.test(opt.scenario)) throw new Error(`--scenario „${opt.scenario}“ unbekannt`);
if (opt.legacy && opt.scenario !== '3d') throw new Error('--legacy gibt es nur mit --scenario 3d');
const URL0 = opt.url.endsWith('/') ? opt.url : `${opt.url}/`;
const require = createRequire(path.resolve(opt.playwright, '..', '..', 'package.json'));
const { chromium } = require(path.resolve(opt.playwright));

const HOME = process.env.HOME;
const exe = opt.gpu === 'metal'
  ? `${HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  : `${HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
if (!fs.existsSync(exe)) throw new Error(`Browser fehlt: ${exe}`);
const args = ['--mute-audio', '--autoplay-policy=user-gesture-required'];
if (opt.gpu === 'metal') args.push('--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows');
else args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info');

const mobile = opt.profile.startsWith('mobile');
const cpuRate = { 'mobile-cpu4': 4, 'mobile-cpu6': 6 }[opt.profile] || 1;
const res = {
  profile: opt.profile, gpu: opt.gpu, scenario: opt.scenario, tier: opt.tier || null, legacy: !!opt.legacy, cpuThrottle: cpuRate,
  note: [
    opt.gpu === 'swiftshader' ? 'SwiftShader: für 3D nicht repräsentativ' : null,
    mobile ? 'Handy-Emulation auf dem Mac (keine echte Füllrate/Speichergrenze)' : null,
    cpuRate > 1 ? `CPU-Drosselung ×${cpuRate} nur Hauptthread (CDP)` : null,
  ].filter(Boolean),
};

// ---------------------------------------------------------------- Hilfen
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const quant = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const stat = (a) => (a.length ? { n: a.length, mean: r2(a.reduce((s, x) => s + x, 0) / a.length), p50: r2(quant(a, 0.5)), p95: r2(quant(a, 0.95)), p99: r2(quant(a, 0.99)), max: r2(Math.max(...a)) } : { n: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exeName = path.basename(exe);
// Chromium-Prozesse dieses Browsers: RSS (MB) und CPU-Zeit (s) nach Prozesstyp
function procs() {
  const out = execSync('ps -axo pid=,rss=,time=,command=').toString();
  const agg = {};
  for (const line of out.split('\n')) {
    if (!line.includes(exeName)) continue;
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/);
    if (!m) continue;
    const type = (m[4].match(/--type=([\w-]+)/) || [, 'browser'])[1];
    const k = type === 'utility' ? (m[4].match(/--utility-sub-type=([\w.]+)/) || [, 'utility'])[1] : type;
    const parts = m[3].split(':').map(Number);
    const cpu = parts.reduce((s, x) => s * 60 + x, 0);
    agg[k] ??= { rssMB: 0, cpuS: 0, n: 0, pids: [] };
    agg[k].rssMB += +m[2] / 1024; agg[k].cpuS += cpu; agg[k].n++; agg[k].pids.push(+m[1]);
  }
  for (const v of Object.values(agg)) v.rssMB = Math.round(v.rssMB);
  return agg;
}

// Grafikspeicher eines Prozesses (macOS `footprint`): Auf Apple Silicon liegt GPU-Speicher nicht im
// RSS, sondern in den Kategorien „IOAccelerator (graphics)“ und „Owned physical footprint (unmapped)
// (graphics)“. Ergebnis in MB (Dirty); fehlt eine Zeile, ist sie 0 – fehlt die Kopfzeile, ist das ein Fehler.
const UNIT = { B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 };
function footprintMB(pid) {
  if (process.platform !== 'darwin') throw new Error('footprintMB: nur auf macOS (footprint)');
  const out = execSync(`footprint -p ${pid}`).toString();
  const head = out.match(/Footprint:\s+([\d.]+)\s+(B|KB|MB|GB)/);
  if (!head) throw new Error(`footprint -p ${pid}: Kopfzeile „Footprint:“ nicht gefunden:\n${out.slice(0, 400)}`);
  let graphics = 0;
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*([\d.]+)\s+(B|KB|MB|GB)\s+.*\(graphics\)\s*$/);
    if (m) graphics += +m[1] * UNIT[m[2]];
  }
  return { totalMB: Math.round(+head[1] * UNIT[head[2]]), graphicsMB: Math.round(graphics) };
}
const cpuPct = (a, b, sec) => Object.fromEntries(Object.keys(b).map((k) => [k, r1(((b[k].cpuS - (a[k]?.cpuS ?? 0)) / sec) * 100)]));

// ---------------------------------------------------------------- Browser
const browser = await chromium.launch({ executablePath: exe, headless: true, args });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Network.enable');
if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
const consoleErr = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErr.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
page.on('pageerror', (e) => consoleErr.push(`pageerror: ${e.message}`));

// Netzwerk: alle Anfragen mit Zeit (ms seit Navigation) und übertragenen Bytes
const net = new Map();
let navT0 = null;
cdp.on('Network.requestWillBeSent', (e) => { net.set(e.requestId, { url: e.request.url.replace(URL0, ''), start: e.timestamp, type: e.type }); });
cdp.on('Network.responseReceived', (e) => { const r = net.get(e.requestId); if (r) { r.status = e.response.status; r.mime = e.response.mimeType; } });
cdp.on('Network.loadingFinished', (e) => { const r = net.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; } });
cdp.on('Network.loadingFailed', (e) => { const r = net.get(e.requestId); if (r) { r.end = e.timestamp; r.failed = e.errorText; } });
const netList = () => [...net.values()].map((r) => ({
  url: r.url, status: r.status ?? null, bytes: r.bytes ?? null, failed: r.failed,
  start_ms: navT0 != null ? Math.round((r.start - navT0) * 1000) : null, end_ms: r.end && navT0 != null ? Math.round((r.end - navT0) * 1000) : null,
}));

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const gcHeapMB = async () => { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); await sleep(200); await cdp.send('HeapProfiler.collectGarbage'); return page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null)); };
const workers = () => page.workers().map((w) => w.url().replace(URL0, '').replace(/^blob:.*/, 'blob'));

// Scene-Datei-Ersatz (--override id=datei.sog)
if (opt.override) {
  const [id, file] = opt.override.split('=');
  if (!id || !file || !fs.existsSync(file)) throw new Error(`--override „${opt.override}“: erwartet id=vorhandene-datei.sog`);
  const meta = JSON.parse(execSync(`unzip -p ${JSON.stringify(file)} meta.json`).toString());
  const bytes = fs.statSync(file).size;
  let tierFile = null;
  await page.route(/scene\/scene\.json/, async (route) => {
    const r = await route.fetch();
    const c = await r.json();
    const t = c.splats.tiers.find((x) => x.id === id);
    if (!t) throw new Error(`--override: Stufe „${id}“ fehlt in scene.json`);
    tierFile = t.file;
    Object.assign(t, { bytes, count: meta.count, hash: 'ffffffffffff' });
    await route.fulfill({ response: r, body: JSON.stringify(c) });
  });
  await page.route(/\.sog(\?|$)/, async (route) => {
    if (tierFile && route.request().url().includes(`/${tierFile}`)) await route.fulfill({ status: 200, contentType: 'application/zip', body: fs.readFileSync(file) });
    else await route.continue();
  });
  res.override = { id, file, bytes, count: meta.count };
}

await page.addInitScript(() => {
  window.__perf = { longtasks: [] };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { window.__perf.longtaskError = String(e); }
});
const longtasks = (from = 0) => page.evaluate((from) => window.__perf.longtasks.filter((x) => x[0] >= from), from);
const ltSummary = (lt) => ({ count: lt.length, total_ms: lt.reduce((s, x) => s + x[1], 0), max_ms: Math.max(0, ...lt.map((x) => x[1])), top: [...lt].sort((a, b) => b[1] - a[1]).slice(0, 6) });

async function navigate(url) {
  const t = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  navT0 = [...net.values()].find((r) => r.type === 'Document')?.start ?? null;
  return t;
}
const appReady = () => page.waitForFunction(() => window.__app?.stats.firstMap > 0 || !document.getElementById('fatal')?.hidden, null, { timeout: 60000, polling: 20 });
async function assertNoFatal() {
  const f = await page.evaluate(() => { const e = document.getElementById('fatal'); return e && !e.hidden ? e.innerText : null; });
  if (f) throw new Error(`Seite zeigt Vollbild-Fehler: ${f}`);
}

// rAF-Zähler der App (2D-Frames und 3D-Renderaufrufe) und Overlay-Neuaufbauten
const appCounters = () => page.evaluate(() => { const s = window.__app.stats; return { frames2d: s.frames2d, renders: s.renders, overlayBuilds: s.overlayBuilds, t: performance.now() }; });

// ---------------------------------------------------------------- 3D-Hilfen
async function open3d(tierId) {
  const t0 = await page.evaluate(() => performance.now());
  const ts = Date.now();
  await page.evaluate((id) => window.__app.open3d(id || undefined), tierId || null);
  const st = await page.evaluate(() => ({ view: window.__app.state.view, card: document.getElementById('load3d')?.hidden ? null : document.getElementById('load3d').innerText }));
  if (st.view !== '3d') throw new Error(`3D ließ sich nicht öffnen (${tierId || 'Auto'}): ${st.card}`);
  await page.waitForFunction(() => window.__viewer?.spark?.activeSplats > 0, null, { timeout: 120000, polling: 20 });
  const wall = Date.now() - ts;
  const info = await page.evaluate((t0) => {
    const v = window.__viewer;
    const gl = v.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      firstSplats_ms: Math.round(performance.now() - t0), tier: window.__app.state.tier3d.id,
      numSplats: v.mesh.numSplats, activeSplats: v.spark.activeSplats, pixelRatio: v.renderer.getPixelRatio(),
      canvas: [v.renderer.domElement.width, v.renderer.domElement.height],
      glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    };
  }, t0);
  info.wall_ms = wall;
  info.longtasks = ltSummary(await longtasks(t0));
  return info;
}

async function idle(ms, { threeD }) {
  const c0 = await appCounters();
  const m0 = await metrics();
  const p0 = procs();
  const lt0 = await page.evaluate(() => performance.now());
  await sleep(ms);
  const p1 = procs();
  const m1 = await metrics();
  const c1 = await appCounters();
  const sec = (c1.t - c0.t) / 1000;
  return {
    seconds: r2(sec),
    appRafCallbacks: (c1.frames2d - c0.frames2d) + (c1.renders - c0.renders),
    renderCalls: c1.renders - c0.renders, frames2d: c1.frames2d - c0.frames2d, overlayBuilds: c1.overlayBuilds - c0.overlayBuilds,
    rendererRenderFrame: threeD ? await page.evaluate(() => window.__viewer.renderer.info.render.frame) : undefined,
    mainThreadBusyPct: r1(((m1.TaskDuration - m0.TaskDuration) / sec) * 100),
    procCpuPct: cpuPct(p0, p1, sec), procRssMB: Object.fromEntries(Object.entries(p1).map(([k, v]) => [k, v.rssMB])),
    longtasks: ltSummary(await longtasks(lt0)),
  };
}

// Leerlauf nach einer echten Maus-Ziehgeste (90 Schritte): misst, ob das Ausschwingen der Dämpfung
// nach dem Loslassen aufhört. Bei SH-Stufen (maxSh > 0) lösten Restbewegungen unter 1e-11 m früher
// sekundenlang Neusortierungen und Renderaufrufe aus. Messfenster ab 2 s nach dem Loslassen.
async function idleAfterDrag(ms = 6000) {
  const vp = page.viewportSize();
  const cx = vp.width / 2, cy = vp.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 0; i <= 90; i++) { const a = (i / 90) * Math.PI * 2; await page.mouse.move(cx + 0.3 * vp.width * Math.sin(a), cy + 0.05 * vp.height * Math.sin(2 * a)); await sleep(16); }
  await page.mouse.up();
  await sleep(2000);
  return { startsAfterRelease_s: 2, ...(await idle(ms, { threeD: true })) };
}

// Kamerafahrt 10 s, identisch zur Baseline: Start aus cfg.view (Startkamera), Orbit mit Zoom-Anteil.
// setMotion(true) entspricht dem, was eine echte Ziehgeste auslöst (geringere Auflösung während Bewegung).
async function tour({ gpuTimer, svgChecks }) {
  const m0 = await metrics();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const r = await page.evaluate(async ({ gpuTimer, svgChecks, legacy }) => {
    const v = window.__viewer;
    const gl = v.renderer.getContext();
    const origRender = v.renderer.render.bind(v.renderer);
    const renderTimes = [];
    const ext = gpuTimer ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    const pendingQ = []; const gpuMs = []; let depth = 0;
    const pollQ = () => { while (pendingQ.length && gl.getQueryParameter(pendingQ[0], gl.QUERY_RESULT_AVAILABLE)) { const q = pendingQ.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpuMs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } };
    v.renderer.render = (s, c) => {
      const t = performance.now(); let q = null;
      if (ext && depth === 0) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      depth++; try { origRender(s, c); } finally { depth--; }
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pendingQ.push(q); }
      renderTimes.push(performance.now() - t); if (ext) pollQ();
    };
    // Startkamera wie Baseline
    if (!legacy && v.view?.home3) { v.camera.position.copy(v.view.home3.position); v.controls.target.copy(v.view.home3.target); }
    v.view?.setMotion?.(true);
    const svg = document.getElementById('overlay');
    let ovMut = 0;
    const mo = new MutationObserver(() => { ovMut++; }); mo.observe(svg, { childList: true, subtree: true, attributes: true });
    const W = innerWidth, H = innerHeight;
    const svgMax = [];
    const measureSvg = () => {
      let mx = 0;
      for (const el of svg.querySelectorAll('*')) {
        for (const a of ['d', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy']) {
          const s = el.getAttribute(a);
          if (!s) continue;
          for (const n of s.match(/-?\d+(\.\d+)?(e[-+]?\d+)?/gi) || []) mx = Math.max(mx, Math.abs(+n));
        }
      }
      return mx;
    };
    const target = v.controls.target.clone();
    const p0 = v.camera.position.clone().sub(target);
    const R0 = Math.hypot(p0.x, p0.z), y0 = p0.y, a0 = Math.atan2(p0.z, p0.x);
    const iv = []; let last = performance.now();
    const t0 = last;
    let nextCheck = 0;
    await new Promise((done) => {
      const step = (now) => {
        iv.push(now - last); last = now;
        const u = (now - t0) / 10000;
        if (svgChecks && u >= nextCheck / 10 && nextCheck <= 10) { svgMax.push(Math.round(measureSvg())); nextCheck++; }
        if (u >= 1) { done(); return; }
        const a = a0 + u * Math.PI * 2;
        const R = R0 * (1 - 0.55 * Math.sin(u * Math.PI));
        const y = y0 * (1 - 0.45 * Math.sin(u * Math.PI));
        v.camera.position.set(target.x + R * Math.cos(a), target.y + y, target.z + R * Math.sin(a));
        v.requestRender?.();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    while (svgChecks && svgMax.length < 11) svgMax.push(Math.round(measureSvg()));
    mo.disconnect();
    if (ext) { const tEnd = performance.now() + 500; while (pendingQ.length && performance.now() < tEnd) { await new Promise((r) => setTimeout(r, 20)); pollQ(); } }
    v.renderer.render = origRender;
    v.view?.setMotion?.(false);
    const ivs = iv.slice(2);
    const sum = ivs.reduce((s, x) => s + x, 0);
    return {
      fps: Math.round((ivs.length / (sum / 1000)) * 10) / 10, ivs, renderTimes, gpuMs, overlayMutations: ovMut,
      svg: svgChecks ? { maxAbsCoord: svgMax, limit: Math.max(W, H) + 96, viewport: [W, H] } : undefined,
      over33: ivs.filter((x) => x > 33.4).length,
    };
  }, { gpuTimer, svgChecks, legacy: !!opt.legacy });
  const { profile } = await cdp.send('Profiler.stop');
  const m1 = await metrics();
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  let total = 0;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id); const d = profile.timeDeltas[i] || 0; total += d;
    const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} @ ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + d);
  });
  return {
    fps: r.fps, frameInterval_ms: stat(r.ivs), over33: r.over33,
    renderCall_ms: stat(r.renderTimes), renderCalls: r.renderTimes.length,
    gpuRender_ms: r.gpuMs.length ? stat(r.gpuMs) : null,
    overlayMutations: r.overlayMutations, svg: r.svg,
    mainThread: {
      taskPct: r1(((m1.TaskDuration - m0.TaskDuration) / 10) * 100), scriptPct: r1(((m1.ScriptDuration - m0.ScriptDuration) / 10) * 100),
      layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000), styleMs: Math.round((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000),
    },
    cpuProfileTop: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${(v / 1000).toFixed(0)} ms ${((100 * v) / total).toFixed(1)}% ${k}`),
  };
}

// Echte Ziehgeste (Maus) über dem 3D-Bild ab der Startansicht: 90 Schritte, ±30 % der Breite
// waagerecht, ±5 % der Höhe senkrecht. Startet jeweils aus cfg.view (Taste H, dann Ruhe).
async function orbitGesture() {
  await page.evaluate(() => {
    const v = window.__viewer;
    const gl = v.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const orig = v.renderer.render.bind(v.renderer);
    const o = window.__orbit = { gpuMs: [], renderMs: [], pending: [], orig, ext };
    const poll = () => { while (o.pending.length && gl.getQueryParameter(o.pending[0], gl.QUERY_RESULT_AVAILABLE)) { const q = o.pending.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) o.gpuMs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } };
    o.poll = poll;
    let depth = 0; // Spark rendert intern verschachtelt: nur der äußere Aufruf bekommt eine Zeitabfrage
    v.renderer.render = (sc, c) => {
      const t = performance.now(); let q = null;
      if (ext && depth === 0) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      depth++;
      try { orig(sc, c); } finally { depth--; if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); o.pending.push(q); } }
      if (depth === 0) { o.renderMs.push(performance.now() - t); if (ext) poll(); }
    };
  });
  const vp = page.viewportSize();
  const cx = vp.width / 2, cy = vp.height / 2;
  const runs = [];
  for (let k = 0; k < 2; k++) {
    await page.evaluate(() => window.__app.view.home());
    await sleep(1500);
    const t0 = await page.evaluate(() => {
      const o = window.__orbit; o.gpuMs.length = 0; o.renderMs.length = 0; o.iv = []; o.go = true;
      let last = performance.now(); o.t0 = last;
      const f = (t) => { o.iv.push(t - last); last = t; if (o.go) requestAnimationFrame(f); }; requestAnimationFrame(f);
      return o.t0;
    });
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let i = 0; i <= 90; i++) { const a = (i / 90) * Math.PI * 2; await page.mouse.move(cx + 0.3 * vp.width * Math.sin(a), cy + 0.05 * vp.height * Math.sin(2 * a)); await sleep(16); }
    await page.mouse.up();
    await sleep(800);
    const r = await page.evaluate(async () => {
      const o = window.__orbit; o.go = false;
      const tEnd = performance.now() + 500; while (o.pending.length && performance.now() < tEnd) { await new Promise((ok) => setTimeout(ok, 20)); o.poll(); }
      return { ivs: o.iv.slice(2), gpuMs: o.gpuMs.slice(), renderMs: o.renderMs.slice() };
    });
    runs.push({ frameInterval_ms: stat(r.ivs), over33: r.ivs.filter((x) => x > 33.4).length, gpuRender_ms: r.gpuMs.length ? stat(r.gpuMs) : null,
      renderCall_ms: stat(r.renderMs), longtasks: ltSummary(await longtasks(t0)) });
  }
  await page.evaluate(() => { window.__viewer.renderer.render = window.__orbit.orig; });
  return runs;
}

async function picks() {
  const lt0 = await page.evaluate(() => performance.now());
  const r = await picksRun();
  r.longtasksDuringPickerInitAndPicks = ltSummary(await longtasks(lt0));
  return r;
}
async function picksRun() {
  return page.evaluate(async (legacy) => {
    const v = window.__viewer;
    if (!legacy) await v.view.pickReady();
    const r = v.renderer.domElement.getBoundingClientRect();
    const t1 = []; const t5 = [];
    for (let i = 0; i < 10; i++) {
      const x = r.left + r.width * (0.3 + 0.04 * i), y = r.top + r.height * 0.6;
      let t = performance.now(); await v.pickAt(x, y, false); t1.push(performance.now() - t);
      t = performance.now(); await v.pickAt(x, y, true); t5.push(performance.now() - t);
    }
    const T = v.THREE; const tgt = v.controls.target;
    const rays = Array.from({ length: 121 }, (_, i) => [new T.Ray(new T.Vector3(tgt.x - 5 + (i * 10) / 120, tgt.y + 40, tgt.z), new T.Vector3(0, -1, 0))]);
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    let t = performance.now();
    let hits;
    if (legacy) { hits = []; for (const ray of rays) hits.push(await v.picker.pick(ray)); }
    else hits = await v.picker.pickMany(rays);
    const prof = performance.now() - t;
    return { ray1_ms_median: Math.round(med(t1) * 100) / 100, click5ray_ms_median: Math.round(med(t5) * 100) / 100, profile121_ms: Math.round(prof), profileMode: legacy ? '121 Einzel-Picks' : 'ein Batch', profileHits: hits.filter(Boolean).length };
  }, !!opt.legacy);
}

// 200 Bildschirmstrahlen aus 3 Kamerastellungen: Gitter gegen lineare Suche (identische Treffer)
async function gridVsLinear() {
  return page.evaluate(async () => {
    const v = window.__viewer; const T = v.THREE; const view = v.view;
    await view.pickReady();
    const save = { p: v.camera.position.clone(), t: v.controls.target.clone() };
    const h = view.home3;
    const cams = [
      [h.position.clone(), h.target.clone()],
      [h.target.clone().add(new T.Vector3(0.01, 25, 0.01)), h.target.clone()],
      [h.target.clone().add(new T.Vector3(6, 2.5, -4)), h.target.clone().add(new T.Vector3(-2, 0, 3))],
    ];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const ray = new T.Raycaster();
    let same = 0, diff = 0, bothNull = 0, maxDt = 0; const examples = [];
    const n = [67, 67, 66];
    for (let c = 0; c < 3; c++) {
      v.camera.position.copy(cams[c][0]); v.controls.target.copy(cams[c][1]); v.camera.lookAt(cams[c][1]); v.camera.updateMatrixWorld();
      for (let i = 0; i < n[c]; i++) {
        ray.setFromCamera(new T.Vector2(rnd() * 2 - 1, rnd() * 2 - 1), v.camera);
        const L = v.picker.local([ray.ray]);
        const msg = { o: [L.o.x, L.o.y, L.o.z], dirs: L.dirs, near: 0.05 / L.scale };
        const [g] = await v.picker.request({ type: 'pick', ...msg });
        const [l] = await v.picker.request({ type: 'pick-linear', ...msg });
        if (!g && !l) { bothNull++; same++; continue; }
        const dt = g && l ? Math.abs(g.t - l.t) : Infinity;
        if (dt <= 1e-6) same++; else { diff++; if (examples.length < 5) examples.push({ cam: c, grid: g && g.t, linear: l && l.t }); }
        if (Number.isFinite(dt)) maxDt = Math.max(maxDt, dt);
      }
    }
    v.camera.position.copy(save.p); v.controls.target.copy(save.t); v.camera.lookAt(save.t); v.requestRender();
    return { rays: 200, identical: same, different: diff, bothNull, maxDt, examples };
  });
}

async function memory() {
  const heap = await gcHeapMB();
  await sleep(500);
  const p = procs();
  const gpuPids = p['gpu-process']?.pids ?? [];
  if (gpuPids.length !== 1) throw new Error(`memory(): genau ein GPU-Prozess erwartet, gefunden ${gpuPids.length}`);
  const gfx = footprintMB(gpuPids[0]);
  return { jsHeapAfterGC_MB: heap, rendererRssMB: p.renderer?.rssMB ?? null, gpuRssMB: p['gpu-process'].rssMB, gpuGraphicsMB: gfx.graphicsMB, gpuFootprintMB: gfx.totalMB, workers: workers() };
}

// Bild der 3D-Ansicht ohne Overlay; Hintergrundbild (Mesh unsichtbar) für die Deckung
async function shot3d(cam) {
  await page.evaluate((cam) => {
    const v = window.__viewer;
    document.body.classList.add('perf-noui');
    v.camera.position.set(...cam.p); v.controls.target.set(...cam.t); v.camera.lookAt(v.controls.target); v.controls.update();
    v.view.setMotion(false); v.requestRender();
  }, cam);
  await page.waitForTimeout(1200);
  const img = await page.locator('canvas').first().screenshot();
  return img;
}

// PSNR und Deckung in einer leeren Seite berechnen (PNG-Dekodierung über den Browser)
async function compareImages(pairs) {
  const p2 = await ctx.newPage();
  const out = await p2.evaluate(async (pairs) => {
    const load = async (b64) => { const im = new Image(); im.src = `data:image/png;base64,${b64}`; await im.decode(); const c = new OffscreenCanvas(im.width, im.height); const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
    const res = [];
    for (const { a, ref, bg } of pairs) {
      const A = await load(a), R = await load(ref), B = await load(bg);
      let se = 0, n = 0, covA = 0, covR = 0;
      for (let i = 0; i < A.length; i += 4) {
        for (let k = 0; k < 3; k++) { const d = A[i + k] - R[i + k]; se += d * d; }
        n += 3;
        const dA = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        const dR = Math.abs(R[i] - B[i]) + Math.abs(R[i + 1] - B[i + 1]) + Math.abs(R[i + 2] - B[i + 2]);
        if (dA > 24) covA++;
        if (dR > 24) covR++;
      }
      const mse = se / n;
      res.push({ psnr: mse === 0 ? Infinity : Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100, coverageVsMax: covR ? Math.round((covA / covR) * 1000) / 1000 : null });
    }
    return res;
  }, pairs.map((p) => ({ a: p.a.toString('base64'), ref: p.ref.toString('base64'), bg: p.bg.toString('base64') })));
  await p2.close();
  return out;
}

// ---------------------------------------------------------------- Szenarien
try {
  if (opt.legacy) {
    // Alter Stand: lädt sofort 3D, Ende des Ladens = #loading.done
    const t = await navigate(URL0);
    await page.waitForFunction(() => document.querySelector('#loading.done') || document.querySelector('#loading.error'), null, { timeout: 180000, polling: 50 });
    await page.waitForFunction(() => window.__viewer?.scene.children.some((o) => 'activeSplats' in o && o.activeSplats > 0), null, { timeout: 60000, polling: 20 });
    res.load = { wall_ms: Date.now() - t, network: netList(), jsBytes: netList().filter((r) => /\.js(\?|$)/.test(r.url)).reduce((s, r) => s + (r.bytes || 0), 0), longtasks: ltSummary(await longtasks(0)) };
    await sleep(2500);
    // Altstand: render() läuft dauerhaft; stats.renders gibt es nicht – Zählung über renderer.info
    const f0 = await page.evaluate(() => ({ f: window.__viewer.renderer.info.render.frame, t: performance.now() }));
    const p0 = procs(); await sleep(8000); const p1 = procs();
    const f1 = await page.evaluate(() => ({ f: window.__viewer.renderer.info.render.frame, t: performance.now() }));
    const sec = (f1.t - f0.t) / 1000;
    res.idle = { renderCalls: f1.f - f0.f, perSec: r1((f1.f - f0.f) / sec), procCpuPct: cpuPct(p0, p1, sec) };
    res.tour = await tour({ gpuTimer: true, svgChecks: true });
    res.afterTour = procs();
    res.picks = await picks();
    res.memory = await memory();
  } else if (opt.scenario === '2d') {
    const t = await navigate(URL0);
    await appReady();
    await assertNoFatal();
    const fm = await page.evaluate(() => ({ firstMap: window.__app.stats.firstMap, nav: performance.getEntriesByType('navigation')[0].startTime }));
    res.firstMap_ms = Math.round(fm.firstMap - fm.nav);
    res.firstMapWall_ms = Date.now() - t;
    res.paint = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)])));
    // Bytes bis zum ersten Kartenbild (alles, was bis dahin fertig übertragen war)
    const list0 = netList();
    const until = list0.filter((r) => r.start_ms != null && r.start_ms < res.firstMap_ms); // vor dem ersten Kartenbild angefragt
    res.bytesUntilFirstMap = until.reduce((s, r) => s + (r.bytes || 0), 0);
    const jsUntil = until.filter((r) => /\.js(\?|$)/.test(r.url));
    let jsGz = 0;
    for (const r of jsUntil) { const body = await (await fetch(URL0 + r.url)).arrayBuffer(); jsGz += zlib.gzipSync(Buffer.from(body), { level: 9 }).length; }
    res.jsUntilFirstMap = { files: jsUntil.map((r) => r.url), raw: jsUntil.reduce((s, r) => s + (r.bytes || 0), 0), gzip: jsGz };
    res.longtasksUntilFirstMap = ltSummary(await longtasks(0));
    await sleep(800);

    // 3 gespeicherte Messungen, alle Ebenen an
    await page.evaluate(() => {
      const a = window.__app, b = a.cfg.boundaries[1].points || a.cfg.boundaries[1].polygon;
      const P = (x, z) => { const g = a.ground.sample(x, z); return [x, g.error ? 0 : g.y, z]; };
      const c = a.cfg.map.start; const cx = (c[0] + c[1]) / 2, cz = (c[2] + c[3]) / 2;
      a.store.add('dist', [P(cx - 4, cz - 3), P(cx + 4, cz + 2)], ['g', 'g']);
      a.store.add('area', [P(cx - 3, cz + 4), P(cx + 2, cz + 5), P(cx + 1, cz + 9), P(cx - 4, cz + 8)], ['g', 'g', 'g', 'g']);
      a.store.add('height', [P(cx + 3, cz - 6), [cx + 3, P(cx + 3, cz - 6)[1] + 2, cz - 6]], ['g', 'e']);
      return !!b;
    });
    res.layers = await page.evaluate(() => ['btn-bounds', 'btn-buildings', 'btn-sewer'].map((id) => { const e = document.getElementById(id); return [id, e ? e.getAttribute('aria-pressed') : 'fehlt']; }));

    // 240 Frames Pan und Zoom über 4 Zoomstufen
    const box = await page.locator('#map').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const c0 = await appCounters();
    await page.evaluate(() => { window.__iv = []; let last = performance.now(); window.__ivOn = true; const f = (now) => { window.__iv.push(now - last); last = now; if (window.__ivOn) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const N = 240;
    const zoomAt = (i) => { const u = i / (N - 1); return Math.pow(8, Math.sin(u * Math.PI)); }; // 1 → 8 → 1: Stufen f8…f1
    if (mobile) {
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
      const pts = (i) => { const s = zoomAt(i) * 40; const dx = Math.sin(i / 20) * 50; return [[cx - s + dx, cy], [cx + s + dx, cy + 10]]; };
      await touch('touchStart', pts(0));
      for (let i = 1; i < N; i++) { await touch('touchMove', pts(i)); await sleep(16); }
      await touch('touchEnd', []);
    } else {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < N; i++) {
        if (i % 2) await page.mouse.wheel(0, (zoomAt(i) - zoomAt(i - 1)) < 0 ? 60 : -60);
        else { await page.mouse.down(); await page.mouse.move(cx + Math.sin(i / 20) * 80, cy + Math.cos(i / 25) * 40); await page.mouse.up(); }
        await sleep(16);
      }
    }
    await sleep(400);
    const iv = await page.evaluate(() => { window.__ivOn = false; return window.__iv.slice(2); });
    const c1 = await appCounters();
    res.panZoom = { events: N, frameInterval_ms: stat(iv), frames2d: c1.frames2d - c0.frames2d, overlayBuilds: c1.overlayBuilds - c0.overlayBuilds, items: 3 };
    await sleep(1500);
    res.idle5s = await idle(5000, { threeD: false });
    const all = netList();
    res.network = all;
    res.forbiddenRequests = all.filter((r) => /view3d|\.sog(\?|$)|pick-worker/.test(r.url)).map((r) => r.url);
  } else {
    await navigate(URL0);
    await appReady();
    await assertNoFatal();
    await sleep(500);
    if (opt.scenario === '3d') {
      res.memoryBefore3d = await memory();
      res.open = await open3d(opt.tier);
      await sleep(2500);
      res.memoryAfterLoad = await memory();
      res.idle8s = await idle(8000, { threeD: true });
      res.idleAfterDrag = await idleAfterDrag();
      res.tour = await tour({ gpuTimer: true, svgChecks: true });
      await sleep(1000);
      res.afterTour = await memory();
      await sleep(1000);
      res.idleAfterTour = await idle(6000, { threeD: true });
      res.picks = await picks();
      res.gridVsLinear = await gridVsLinear();
    } else if (opt.scenario === 'orbit') {
      res.open = await open3d(opt.tier);
      await sleep(2500);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      res.orbit = await orbitGesture();
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      let total = 0;
      profile.samples.forEach((id, i) => {
        const n = byId.get(id); const d = profile.timeDeltas[i] || 0; total += d;
        const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} @ ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
        self.set(key, (self.get(key) || 0) + d);
      });
      res.cpuProfileTop = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / 1000).toFixed(0)} ms ${((100 * v) / total).toFixed(1)}% ${k}`);
    } else if (opt.scenario === 'switch') {
      res.heapBefore3d = await gcHeapMB();
      res.workersBefore = workers();
      res.open = await open3d(opt.tier);
      await sleep(2000);
      res.in3d = await memory();
      await page.evaluate(() => window.__app.close3d());
      await sleep(1500);
      res.after = { ...(await memory()), canvas: await page.evaluate(() => document.querySelectorAll('canvas').length), viewer: await page.evaluate(() => 'window.__viewer' in window && !!window.__viewer), view: await page.evaluate(() => window.__app.state.view) };
      res.heapDelta_MB = res.after.jsHeapAfterGC_MB - res.heapBefore3d;
    } else if (opt.scenario === 'tiers') {
      // Wechsel max → niedrig → max, Messungen und Kamera müssen bleiben
      await page.evaluate(() => { const a = window.__app; const c = a.cfg.map.start; a.store.add('dist', [[c[0], 0, c[2]], [c[1], 0, c[3]]], ['p', 'p']); });
      res.open = await open3d('max');
      await sleep(2000);
      const snap = () => page.evaluate(() => ({ items: JSON.stringify(window.__app.store.items), cam: window.__viewer.camera.position.toArray().map((x) => Math.round(x * 1e4) / 1e4) }));
      const s0 = await snap();
      const m0 = await memory();
      await page.evaluate(() => window.__app.setTier('niedrig'));
      await page.waitForFunction(() => window.__viewer?.mesh?.numSplats > 0 && window.__app.state.tier3d.id === 'niedrig' && window.__viewer.spark.activeSplats > 0, null, { timeout: 120000 });
      await sleep(2500);
      const m1 = await memory();
      const s1 = await snap();
      await page.evaluate(() => window.__app.setTier('max'));
      await page.waitForFunction(() => window.__app.state.tier3d.id === 'max' && window.__viewer.spark.activeSplats > 0, null, { timeout: 120000 });
      await sleep(2500);
      const m2 = await memory();
      const s2 = await snap();
      res.switching = { max: m0, niedrig: m1, maxAgain: m2, gpuRatioLowToMax: m0.gpuRssMB ? r2(m1.gpuRssMB / m0.gpuRssMB) : null, gpuGraphicsRatioLowToMax: r2(m1.gpuGraphicsMB / m0.gpuGraphicsMB), itemsUnchanged: s0.items === s1.items && s1.items === s2.items, cameraUnchanged: JSON.stringify(s0.cam) === JSON.stringify(s1.cam) && JSON.stringify(s1.cam) === JSON.stringify(s2.cam) };

      // Bildvergleich: 3 Kamerastellungen je Stufe, PSNR gegen max, Deckung
      await page.addStyleTag({ content: 'body.perf-noui * { visibility: hidden !important; } body.perf-noui canvas { visibility: visible !important; }' });
      const cams = await page.evaluate(() => {
        const h = window.__viewer.view.home3; const t = h.target.toArray(); const p = h.position.toArray();
        return [{ p, t }, { p: [t[0] + 0.01, t[1] + 22, t[2] + 0.01], t }, { p: [t[0] + 5, t[1] + 2.2, t[2] - 3], t: [t[0] - 1, t[1], t[2] + 2] }];
      });
      const shots = {};
      const ids = await page.evaluate(() => window.__app.cfg.splats.tiers.map((t) => t.id));
      const order = ['max', ...ids.filter((i) => i !== 'max')];
      for (const id of order) {
        if (id !== (await page.evaluate(() => window.__app.state.tier3d.id))) {
          await page.evaluate((id) => window.__app.setTier(id), id);
          await page.waitForFunction((id) => window.__app.state.tier3d.id === id && window.__viewer.spark.activeSplats > 0, id, { timeout: 120000 });
          await sleep(1500);
        }
        shots[id] = [];
        for (const cam of cams) shots[id].push(await shot3d(cam));
        if (id === 'max') {
          await page.evaluate(() => { window.__viewer.mesh.visible = false; });
          shots.bg = []; for (const cam of cams) shots.bg.push(await shot3d(cam));
          await page.evaluate(() => { window.__viewer.mesh.visible = true; });
        }
      }
      const dir = path.join(path.dirname(opt.out), 'shots');
      fs.mkdirSync(dir, { recursive: true });
      res.images = {};
      for (const id of order) {
        shots[id].forEach((b, i) => fs.writeFileSync(path.join(dir, `${id}${opt.override ? '-override' : ''}-cam${i}.png`), b));
        res.images[id] = await compareImages(shots[id].map((a, i) => ({ a, ref: shots.max[i], bg: shots.bg[i] })));
      }
    } else if (opt.scenario === 'check-tiers') {
      const tiers = await page.evaluate(() => window.__app.cfg.splats.tiers.map((t) => ({ id: t.id, file: t.file, bytes: t.bytes, count: t.count })));
      res.tiers = [];
      for (const t of tiers) {
        const errBefore = consoleErr.length;
        const head = await fetch(`${URL0}scene/${t.file}`, { method: 'HEAD' });
        const size = +head.headers.get('content-length');
        const o = await open3d(t.id);
        const ok = { id: t.id, file: t.file, sizeOk: size === t.bytes, size, bytes: t.bytes, numSplats: o.numSplats, countOk: o.numSplats === t.count, consoleErrors: consoleErr.slice(errBefore) };
        res.tiers.push(ok);
        await page.evaluate(() => window.__app.close3d());
        await sleep(800);
      }
      res.allOk = res.tiers.every((t) => t.sizeOk && t.countOk && !t.consoleErrors.length);
    }
  }
} finally {
  res.console = consoleErr.slice(0, 30);
  res.audioVideoElements = await page.evaluate(() => document.querySelectorAll('audio,video').length).catch(() => null);
  fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
  fs.writeFileSync(opt.out, JSON.stringify(res, null, 1));
  await browser.close();
}
console.log(`geschrieben: ${opt.out}`);
