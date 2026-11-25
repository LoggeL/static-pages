#!/usr/bin/env node
/**
 * Brave CDP Street View & High-Zoom Satellite Capture Script
 * Kindenheim 3D Expansion: Triftstraße, Am Kirchrain & Adjacent Streets
 *
 * Connects to a visible Brave instance over CDP (never touches user's default profile).
 * Strictly halts if any CAPTCHA / anti-bot / human-verification wall appears.
 *
 * Launch separate Brave window if needed:
 *   "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
 *     --remote-debugging-port=9223 --user-data-dir=/tmp/brave-kindenheim-cdp \
 *     --window-size=1440,900 --no-first-run --no-default-browser-check about:blank &
 *
 * Usage:
 *   node scripts/capture_trift_kirchrain.mjs [--port 9223] [--only id1,id2]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "data", "references", "brave");
const META_PATH = path.join(PROJECT_ROOT, "data", "meta.json");
const VIEWPORT = { width: 1440, height: 900 };

const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
const { centerLat, centerLon } = meta;
const { dX_dLon, dX_dLat, dZ_dLon, dZ_dLat } = meta.projection.latLonToLocalAffine;

function latLonToLocal(lat, lon) {
  const x = (lon - centerLon) * dX_dLon + (lat - centerLat) * dX_dLat;
  const z = (lon - centerLon) * dZ_dLon + (lat - centerLat) * dZ_dLat;
  return {
    localX: Math.round(x * 100) / 100,
    localZ: Math.round(z * 100) / 100,
  };
}

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
};
const preferredPort = getArg("--port") ? Number(getArg("--port")) : null;
const onlyIds = getArg("--only") ? new Set(getArg("--only").split(",")) : null;

export const SHOTS = [
  // === High-Zoom Satellite over Triftstraße + Am Kirchrain ===
  {
    id: "aerial_trift_kirchrain_west",
    title: "West Kindenheim — Am Kirchrain, Im Rosengarten & Triftstraße (High-Zoom Satellite)",
    file: "aerial_trift_kirchrain_west.png",
    type: "satellite",
    url: "https://www.google.com/maps/@49.6088498,8.155183,460m/data=!3m1!1e3",
    lat: 49.6088498,
    lon: 8.155183,
    headingDeg: 0,
    pitchDeg: -90,
    cameraHeightM: 460,
    waitMs: 6500,
  },

  // === Triftstraße (5 Street View shots) ===
  {
    id: "sv_triftstrasse_north_entry",
    title: "Triftstraße North Entry (from Hauptstraße) — Looking South Past #4",
    file: "sv_triftstrasse_north_entry.png",
    type: "streetview",
    viewpoint: [49.609308, 8.157496],
    headingDeg: 170,
    pitchDeg: 3,
    fov: 86,
    waitMs: 5500,
  },
  {
    id: "sv_triftstrasse_mid_southbound",
    title: "Triftstraße Mid-Upper (#4–#6) — Looking South Toward #6 Courtyard & #3",
    file: "sv_triftstrasse_mid_southbound.png",
    type: "streetview",
    viewpoint: [49.608866, 8.157646],
    headingDeg: 185,
    pitchDeg: 4,
    fov: 88,
    waitMs: 5500,
  },
  {
    id: "sv_triftstrasse_mid_northbound",
    title: "Triftstraße Mid (#3–#6) — Looking North Uphill Toward #6, #4 & Hauptstraße",
    file: "sv_triftstrasse_mid_northbound.png",
    type: "streetview",
    viewpoint: [49.608309, 8.157643],
    headingDeg: 350,
    pitchDeg: 4,
    fov: 86,
    waitMs: 5500,
  },
  {
    id: "sv_triftstrasse_south_house3",
    title: "Triftstraße South Bend — Looking NNE Across #3 House, Garden & Street",
    file: "sv_triftstrasse_south_house3.png",
    type: "streetview",
    viewpoint: [49.608104, 8.157549],
    headingDeg: 28,
    pitchDeg: 4,
    fov: 88,
    waitMs: 5500,
  },
  {
    id: "sv_triftstrasse_south_vista",
    title: "Triftstraße South Edge — Looking South Toward #7/#7A/#8 & Vineyard Slopes",
    file: "sv_triftstrasse_south_vista.png",
    type: "streetview",
    viewpoint: [49.608104, 8.157549],
    headingDeg: 186,
    pitchDeg: 2,
    fov: 85,
    waitMs: 5500,
  },

  // === Am Kirchrain (5 Street View shots) ===
  {
    id: "sv_kirchrain_sw_eastbound",
    title: "Am Kirchrain SW (#5–#10 / Im Rosengarten Corner) — Looking ENE",
    file: "sv_kirchrain_sw_eastbound.png",
    type: "streetview",
    viewpoint: [49.609022, 8.153763],
    headingDeg: 54,
    pitchDeg: 4,
    fov: 86,
    waitMs: 5500,
  },
  {
    id: "sv_kirchrain_mid_westbound",
    title: "Am Kirchrain Mid (#11/#16/#18) — Looking WSW Along Hillside Homes",
    file: "sv_kirchrain_mid_westbound.png",
    type: "streetview",
    viewpoint: [49.609297, 8.154507],
    headingDeg: 234,
    pitchDeg: 4,
    fov: 86,
    waitMs: 5500,
  },
  {
    id: "sv_kirchrain_ne_eastbound",
    title: "Am Kirchrain NE (#13/#20/#24 & Am Sonnenberg) — Looking ENE Toward Bend",
    file: "sv_kirchrain_ne_eastbound.png",
    type: "streetview",
    viewpoint: [49.609599, 8.155313],
    headingDeg: 58,
    pitchDeg: 4,
    fov: 86,
    waitMs: 5500,
  },
  {
    id: "sv_kirchrain_bend_east_vista",
    title: "Am Kirchrain Bend — Looking East Along #15–#25 Spur & Village Roof Vista",
    file: "sv_kirchrain_bend_east_vista.png",
    type: "streetview",
    viewpoint: [49.609811, 8.155959],
    headingDeg: 78,
    pitchDeg: 3,
    fov: 88,
    waitMs: 5500,
  },
  {
    id: "sv_kirchrain_north_southbound",
    title: "Am Kirchrain North Slope (#28 / Judenberg Approach) — Looking South",
    file: "sv_kirchrain_north_southbound.png",
    type: "streetview",
    viewpoint: [49.610176, 8.156017],
    headingDeg: 175,
    pitchDeg: 3,
    fov: 86,
    waitMs: 5500,
  },

  // === Adjacent Kindenheim Streets (3 Street View shots) ===
  {
    id: "sv_extra_im_rosengarten",
    title: "Im Rosengarten (South of Am Kirchrain) — Looking WSW",
    file: "sv_extra_im_rosengarten.png",
    type: "streetview",
    viewpoint: [49.608824, 8.154925],
    headingDeg: 244,
    pitchDeg: 4,
    fov: 86,
    waitMs: 5500,
  },
  {
    id: "sv_extra_judenberg",
    title: "Judenberg (North of Am Kirchrain) — Looking East Along Hillside Lane",
    file: "sv_extra_judenberg.png",
    type: "streetview",
    viewpoint: [49.610444, 8.156753],
    headingDeg: 90,
    pitchDeg: 2,
    fov: 86,
    waitMs: 5500,
  },
  {
    id: "sv_extra_raiffeisenstrasse",
    title: "Raiffeisenstraße East — Looking WSW Along Southern Residential Corridor",
    file: "sv_extra_raiffeisenstrasse.png",
    type: "streetview",
    viewpoint: [49.609242, 8.166244],
    headingDeg: 252,
    pitchDeg: 3,
    fov: 86,
    waitMs: 5500,
  },
];

async function findCdpPort() {
  const ports = preferredPort ? [preferredPort] : [9223, 9222];
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.Browser) {
          console.log(`Connected to CDP on port ${port}: ${data.Browser}`);
          return port;
        }
      }
    } catch {
      // try next port
    }
  }
  throw new Error(
    `No working Brave CDP endpoint found on ports ${ports.join(", ")}. ` +
      `Launch Brave with --remote-debugging-port=9223 --user-data-dir=/tmp/brave-kindenheim-cdp`
  );
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const cid = ++this.id;
      this.pending.set(cid, { resolve, reject });
      this.ws.send(JSON.stringify({ id: cid, method, params }));
    });
  }
  async evalJson(expr) {
    const res = await this.send("Runtime.evaluate", {
      expression: `JSON.stringify((() => { ${expr} })())`,
      returnByValue: true,
    });
    return res?.result?.value ? JSON.parse(res.result.value) : null;
  }
  close() {
    this.ws?.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseStreetViewUrl(url) {
  const m = url.match(
    /@(-?\d+\.\d+),(-?\d+\.\d+),[^,]+,(\d+(?:\.\d+)?)y,(\d+(?:\.\d+)?)h,(\d+(?:\.\d+)?)t/
  );
  const panoMatch = url.match(/!1s([^!]+)/);
  if (!m) return null;
  return {
    lat: parseFloat(m[1]),
    lon: parseFloat(m[2]),
    fov: parseFloat(m[3]),
    headingDeg: parseFloat(m[4]),
    pitchDeg: Math.round((parseFloat(m[5]) - 90) * 10) / 10,
    panoId: panoMatch ? decodeURIComponent(panoMatch[1]) : null,
  };
}

async function checkAntiBot(cdp) {
  const info = await cdp.evalJson(`
    const txt = (document.body?.innerText || "").toLowerCase();
    const href = location.href.toLowerCase();
    return {
      url: location.href,
      title: document.title,
      isCaptcha:
        href.includes("/sorry/") ||
        href.includes("consent.google") ||
        txt.includes("unusual traffic") ||
        txt.includes("verify you are human") ||
        txt.includes("i'm not a robot") ||
        txt.includes("ich bin kein roboter") ||
        !!document.querySelector("iframe[src*='recaptcha'], #captcha-form")
    };
  `);
  if (info?.isCaptcha) {
    console.error("CAPTCHA_OR_CONSENT_DETECTED:", JSON.stringify(info));
    process.exit(42);
  }
  return info;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const port = await findCdpPort();
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("No page target found in Brave CDP.");

  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const results = [];
  for (const shot of SHOTS) {
    if (onlyIds && !onlyIds.has(shot.id)) continue;

    let targetUrl = shot.url;
    if (shot.type === "streetview") {
      const [lat, lon] = shot.viewpoint;
      targetUrl =
        `https://www.google.com/maps/@?api=1&map_action=pano` +
        `&viewpoint=${lat},${lon}&heading=${shot.headingDeg}&pitch=${shot.pitchDeg}&fov=${shot.fov || 85}`;
    }

    console.log(`[${shot.id}] -> ${targetUrl}`);
    await cdp.send("Page.navigate", { url: targetUrl });

    if (shot.type === "streetview") {
      for (let i = 0; i < 14; i++) {
        await sleep(450);
        const cur = await checkAntiBot(cdp);
        if (cur?.url && cur.url.includes("!1s")) break;
      }
      await sleep(shot.waitMs || 5000);
    } else {
      await sleep(shot.waitMs || 6500);
      await checkAntiBot(cdp);
    }

    const finalMeta = await cdp.evalJson(`
      const txt = document.body?.innerText || "";
      const dateMatch = txt.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mär|Mai|Okt|Dez)[a-z.]*\\s+20\\d\\d/i);
      return {
        url: location.href,
        title: document.title,
        captureDate: dateMatch ? dateMatch[0] : null,
        isStreetView: location.href.includes("!1e1") || txt.includes("Google Street View")
      };
    `);

    const outPath = path.join(OUT_DIR, shot.file);
    const png = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(outPath, Buffer.from(png.data, "base64"));

    const parsedSv = shot.type === "streetview" ? parseStreetViewUrl(finalMeta.url) : null;
    const lat = parsedSv ? parsedSv.lat : shot.lat;
    const lon = parsedSv ? parsedSv.lon : shot.lon;
    const { localX, localZ } = latLonToLocal(lat, lon);

    const record = {
      id: shot.id,
      title: shot.title,
      file: `/data/references/brave/${shot.file}`,
      source:
        shot.type === "satellite"
          ? "Google Maps Satellite (Airbus / GeoBasis-DE/BKG / Maxar)"
          : "Google Street View",
      captureDate: shot.type === "satellite" ? "2026 imagery" : finalMeta.captureDate || "Jul 2023",
      lat,
      lon,
      localX,
      localZ,
      headingDeg: parsedSv ? parsedSv.headingDeg : shot.headingDeg,
      pitchDeg: parsedSv ? parsedSv.pitchDeg : shot.pitchDeg,
      fovDeg: parsedSv ? parsedSv.fov : 55,
      cameraHeightM: shot.type === "satellite" ? shot.cameraHeightM : 2.5,
      panoId: parsedSv ? parsedSv.panoId : null,
      bytes: fs.statSync(outPath).size,
    };
    console.log(
      `  OK ${record.id} | (${record.lat}, ${record.lon}) -> local=(${record.localX}, ${record.localZ}) | h=${record.headingDeg}° p=${record.pitchDeg}° fov=${record.fovDeg}° | ${record.captureDate} | ${Math.round(record.bytes / 1024)}KB`
    );
    results.push(record);
  }

  cdp.close();
  console.log("=== CAPTURE_JSON_START ===");
  console.log(JSON.stringify(results, null, 2));
  console.log("=== CAPTURE_JSON_END ===");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
