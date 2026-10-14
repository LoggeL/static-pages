import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { CHROMIUM_PATH, PUBLIC_ROOT } from './paths.mjs';
import { LAUNCH_ARGS } from './run.mjs';

// Exact C13 world-live/report.json failures. The regression does not depend on
// historical WORK files, and every listed model is checked against today's disk.
export const C13_ABORTED_PATHS = Object.freeze([
  'models/house_shell.glb',
  ...[
    'blinds_bent', 'armchair_worn', 'bed_frame', 'bookshelf_toppled', 'bookshelf',
    'can_crushed_a', 'curtain_torn', 'coffee_table', 'kitchen_base_cab_45',
    'kitchen_base_cab_60', 'fridge_open', 'kitchen_sink_cab_90', 'newspaper_stack',
    'papers_loose_a', 'papers_loose_b', 'pizza_box_stack', 'trash_bag_b',
  ].map(name => `models/props/${name}.glb`),
].map(relative => `/bodycam-demo/${relative}`));

const PORT = 8969;
const TIMEOUT_MS = 10000;
const CHUNK_DELAY_MS = 20;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const errorInfo = error => ({ message: error?.message ?? String(error), stack: error?.stack ?? null });

async function bounded(promise, label, milliseconds = TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timeout after ${milliseconds} ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Owns port 8969 and its browser; run sequentially with other regressions.
 * No routes are mocked: real HTTP responses carry actual disk model bytes.
 * no-store is a diagnostic control, never a blanket request-error exemption.
 */
export async function runNetworkRegression({ out } = {}) {
  const checks = [], cases = [], serverErrors = [], pageErrors = [], consoleErrors = [];
  const result = {
    checks, cases, serverErrors, pageErrors, consoleErrors,
    historicalRequests: [...C13_ABORTED_PATHS],
    method: 'HTTP 200 chunked responses; raw getReader and Three r170-style Response(ReadableStream); EOF, exact bytes and SHA-256 versus disk.',
    port: PORT, timeoutMs: TIMEOUT_MS, chunkDelayMs: CHUNK_DELAY_MS,
    sources: {
      upstreamReproduction: 'https://github.com/microsoft/playwright/issues/42742',
      threeFileLoader: 'https://raw.githubusercontent.com/mrdoob/three.js/r170/src/loaders/FileLoader.js',
    },
    interpretation: 'Only no-store ERR_ABORTED with HTTP 200, reader EOF and matching full-body SHA-256 is diagnostic. Corrected no-cache cases require requestfinished. Internal browser cause and historical byte hashes are not claimed.',
  };
  let server, browser, page;
  const timers = new Set();
  try {
    const modelAssets = await Promise.all(C13_ABORTED_PATHS.map(async url => {
      const body = await readFile(path.join(PUBLIC_ROOT, url.slice(1)));
      if (body.length < 12 || body.toString('ascii', 0, 4) !== 'glTF'
          || body.readUInt32LE(4) !== 2 || body.readUInt32LE(8) !== body.length) {
        throw new Error(`Invalid GLB header/length: ${url}`);
      }
      return { url, body, bytes: body.length, sha256: sha256(body), type: 'model/gltf-binary' };
    }));
    const tinyBody = Buffer.from('{"ok":true}');
    const assets = [...modelAssets, {
      url: '/synthetic.json', body: tinyBody, bytes: tinyBody.length,
      sha256: sha256(tinyBody), type: 'application/json',
    }];
    result.diskAssets = modelAssets.map(({ body, type, ...asset }) => asset);
    server = http.createServer((request, response) => {
      const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
      response.on('error', error => serverErrors.push({ url: url.pathname, ...errorInfo(error) }));
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
        return response.end('<!doctype html><title>C16 network regression</title><link rel="icon" href="data:,">');
      }
      const asset = assets.find(item => item.url === url.pathname);
      const cache = url.searchParams.get('cache');
      if (request.method !== 'GET' || !asset || !['no-store', 'no-cache'].includes(cache)) {
        response.writeHead(404); return response.end('Unknown regression case');
      }
      response.writeHead(200, {
        'Content-Type': asset.type, 'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff', 'Transfer-Encoding': 'chunked',
      });
      // A real delayed second HTTP chunk makes the upstream stream/terminal-event
      // race reproducible even for the 11-byte fixture, without browser sleeps.
      const split = asset.type === 'application/json' ? 6 : Math.min(65536, Math.floor(asset.bytes / 2));
      response.write(asset.body.subarray(0, split));
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!response.destroyed) response.end(asset.body.subarray(split));
      }, CHUNK_DELAY_MS);
      timers.add(timer);
      response.once('close', () => { clearTimeout(timer); timers.delete(timer); });
    });
    await bounded(new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    }), 'Network server startup');
    browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH, args: LAUNCH_ARGS, timeout: 30000 });
    result.browserVersion = browser.version();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    page.setDefaultNavigationTimeout(TIMEOUT_MS);
    page.on('pageerror', error => pageErrors.push(errorInfo(error)));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() });
    });
    const origin = `http://127.0.0.1:${PORT}`;
    const navigation = await page.goto(origin, { waitUntil: 'load' });
    if (navigation?.status() !== 200) throw new Error('Network fixture page failed');

    // Capture actual terminal events, including failures; no listeners suppress,
    // retry or rewrite them. Every URL is unique, preventing browser-cache reuse.
    for (const asset of assets) {
      const modes = asset.type === 'application/json' ? ['raw', 'three-stream', 'native-json'] : ['raw', 'three-stream'];
      for (const cache of ['no-store', 'no-cache']) for (const mode of modes) {
        const sequence = cases.length;
        const url = `${origin}${asset.url}?cache=${cache}&mode=${mode}&case=${sequence}`;
        const entry = { asset: asset.url, cache, mode, url, expectedBytes: asset.bytes, expectedSha256: asset.sha256 };
        cases.push(entry);
        let resolveTerminal;
        const terminal = new Promise(resolve => { resolveTerminal = resolve; });
        const finished = request => {
          if (request.url() === url) resolveTerminal({ event: 'requestfinished', error: null });
        };
        const failed = request => {
          if (request.url() === url) resolveTerminal({ event: 'requestfailed', error: request.failure()?.errorText ?? 'unknown' });
        };
        page.on('requestfinished', finished);
        page.on('requestfailed', failed);
        try {
          const application = page.evaluate(async ({ url, mode }) => {
            const response = await fetch(url);
            const metadata = { status: response.status, cacheControl: response.headers.get('cache-control'),
              transferEncoding: response.headers.get('transfer-encoding') };
            let bytes, eof = false, chunks = 0, readerBytes = 0, parsed;
            if (mode === 'native-json') {
              parsed = await response.json();
              bytes = new TextEncoder().encode(JSON.stringify(parsed));
              eof = true;
            } else {
              const reader = response.body.getReader();
              if (mode === 'raw') {
                const parts = [];
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) { eof = true; break; }
                  parts.push(value); chunks++; readerBytes += value.byteLength;
                }
                reader.releaseLock();
                bytes = new Uint8Array(readerBytes);
                let offset = 0;
                for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
              } else {
                // Same consumption structure as Three r170 FileLoader: getReader
                // feeds a new ReadableStream, then Response.arrayBuffer consumes it.
                const stream = new ReadableStream({
                  start(controller) {
                    function readData() {
                      reader.read().then(({ done, value }) => {
                        if (done) { eof = true; controller.close(); }
                        else { chunks++; readerBytes += value.byteLength; controller.enqueue(value); readData(); }
                      }, error => controller.error(error));
                    }
                    readData();
                  },
                });
                bytes = new Uint8Array(await new Response(stream).arrayBuffer());
              }
            }
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
            return { ...metadata, eof, chunks, readerBytes, bytes: bytes.byteLength, sha256: hash,
              parsed: parsed ?? null, integrityMethod: mode === 'native-json' ? 'canonical JSON fixture serialization' : 'exact received bytes' };
          }, { url, mode });
          const [body, request] = await bounded(Promise.all([application, terminal]), `Network case ${sequence} ${asset.url}`);
          entry.body = body; entry.terminal = request;
          const exact = body.status === 200 && body.cacheControl === cache && body.transferEncoding === 'chunked'
            && body.eof && body.bytes === asset.bytes && body.sha256 === asset.sha256
            && (mode === 'native-json' ? body.parsed?.ok === true : body.readerBytes === asset.bytes && body.chunks >= 1);
          const diagnosticAbort = cache === 'no-store' && mode !== 'native-json' && exact
            && request.event === 'requestfailed' && request.error === 'net::ERR_ABORTED';
          entry.classification = diagnosticAbort ? 'complete-body-no-store-abort-artifact'
            : exact && request.event === 'requestfinished' ? 'complete-body-finished' : 'failure';
          checks.push({ name: `network-body-${sequence}`, passed: exact,
            details: { asset: asset.url, cache, mode, bytes: body.bytes, expectedBytes: asset.bytes, eof: body.eof, sha256: body.sha256 } });
          checks.push({ name: `network-terminal-${sequence}`, passed: request.event === 'requestfinished' || diagnosticAbort,
            details: { asset: asset.url, cache, mode, ...request, classification: entry.classification,
              gate: cache === 'no-cache' ? 'requestfinished required; no failure exemptions' : 'only verified complete-body stream ERR_ABORTED is diagnostic' } });
        } finally {
          page.off('requestfinished', finished);
          page.off('requestfailed', failed);
        }
      }
    }
  } catch (error) {
    result.error = errorInfo(error);
    checks.push({ name: 'network-execution', passed: false, details: result.error });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    try { if (browser) await bounded(browser.close(), 'Network browser cleanup'); }
    catch (error) { checks.push({ name: 'network-browser-cleanup', passed: false, details: errorInfo(error) }); }
    try {
      if (server?.listening) await bounded(new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      }), 'Network server cleanup');
    } catch (error) { checks.push({ name: 'network-server-cleanup', passed: false, details: errorInfo(error) }); }
  }
  const corrected = cases.filter(entry => entry.cache === 'no-cache');
  const controls = cases.filter(entry => entry.cache === 'no-store');
  result.summary = {
    historicalAssets: C13_ABORTED_PATHS.length, cases: cases.length, expectedCases: C13_ABORTED_PATHS.length * 4 + 6,
    correctedCases: corrected.length,
    correctedFailures: corrected.filter(entry => entry.classification !== 'complete-body-finished').length,
    noStoreArtifactCount: controls.filter(entry => entry.classification === 'complete-body-no-store-abort-artifact').length,
    allBodiesMatch: cases.length > 0 && cases.every(entry => entry.body?.eof && entry.body?.bytes === entry.expectedBytes
      && entry.body?.sha256 === entry.expectedSha256),
  };
  checks.push({ name: 'network-matrix-complete', passed: cases.length === result.summary.expectedCases
    && cases.every(entry => entry.body && entry.terminal), details: result.summary });
  checks.push({ name: 'network-corrected-no-cache', passed: corrected.length === 39
    && result.summary.correctedFailures === 0, details: { cases: corrected.length, failures: result.summary.correctedFailures } });
  checks.push({ name: 'network-infrastructure-errors', passed: !serverErrors.length && !pageErrors.length && !consoleErrors.length,
    details: { serverErrors, pageErrors, consoleErrors } });
  result.status = checks.every(check => check.passed) ? 'passed' : 'failed';
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'network-regression.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  }
  return result;
}
