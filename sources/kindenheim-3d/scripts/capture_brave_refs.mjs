#!/usr/bin/env node
/**
 * Brave CDP Reference Imagery & Street View Capture Script
 * Kindenheim 3D Visual Fidelity Benchmark
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
 *   node scripts/capture_brave_refs.mjs [--port 9223] [--only id1,id2]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "data", "references", "brave");
const VIEWPORT = { width: 1440, height: 900 };

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
};
const preferredPort = getArg("--port") ? Number(getArg("--port")) : null;
const onlyIds = getArg("--only") ? new Set(getArg("--only").split(",")) : null;

export const SHOTS = [
  {
    id: "aerial_overview_village",
    title: "Kindenheim Village Overview (Google Maps Satellite)",
    file: "aerial_overview_village.png",
    type: "satellite",
    url: "https://www.google.com/maps/@49.6110,8.1636,680m/data=!3m1!1e3",
    lat: 49.6110,
    lon: 8.1636,
    headingDeg: 0,
    pitchDeg: -90,
    cameraHeightM: 680,
    waitMs: 5500,
  },
  {
    id: "aerial_center_church_roofs",
    title: "Kindenheim Historic Core Roofs & Courtyards (Close Satellite)",
    file: "aerial_center_church_roofs.png",
    type: "satellite",
    url: "https://www.google.com/maps/@49.6107,8.1622,220m/data=!3m1!1e3",
    lat: 49.6107,
    lon: 8.1622,
    headingDeg: 0,
    pitchDeg: -90,
    cameraHeightM: 220,
    waitMs: 5500,
  },
  {
    id: "aerial_north_vineyards",
    title: "North Village Edge, Sport- und Freizeithalle & Vineyards (Satellite)",
    file: "aerial_north_vineyards.png",
    type: "satellite",
    url: "https://www.google.com/maps/@49.6120532,8.1632312,340m/data=!3m1!1e3",
    lat: 49.6120532,
    lon: 8.1632312,
    headingDeg: 0,
    pitchDeg: -90,
    cameraHeightM: 340,
    waitMs: 5500,
  },
  {
    id: "sv_kirche_full_west",
    title: "Evangelische Martinskirche — Full Tower, Spire & Rathaus (West Angle)",
    file: "sv_kirche_full_west.png",
    type: "streetview",
    viewpoint: [49.6103024, 8.1610586],
    headingDeg: 42,
    pitchDeg: 18,
    fov: 90,
    waitMs: 6500,
  },
  {
    id: "sv_kirche_front_detail",
    title: "Evangelische Martinskirche — Sandstone Tower, Portal & Nave Detail",
    file: "sv_kirche_front_detail.png",
    type: "streetview",
    viewpoint: [49.6104093, 8.1614732],
    headingDeg: 355,
    pitchDeg: 15,
    fov: 90,
    waitMs: 6500,
  },
  {
    id: "sv_kirche_east_angle",
    title: "Evangelische Martinskirche — East Angle & Michelsberg Corner",
    file: "sv_kirche_east_angle.png",
    type: "streetview",
    viewpoint: [49.6105076, 8.1620101],
    headingDeg: 292,
    pitchDeg: 14,
    fov: 88,
    waitMs: 6500,
  },
  {
    id: "sv_rathaus_ortsmitte",
    title: "Rathaus / Gemeindeverwaltung Kindenheim (Hauptstraße 77)",
    file: "sv_rathaus_ortsmitte.png",
    type: "streetview",
    viewpoint: [49.6104093, 8.1614732],
    headingDeg: 162,
    pitchDeg: 5,
    fov: 85,
    waitMs: 6500,
  },
  {
    id: "sv_hauptstrasse_west_weingueter",
    title: "Hauptstraße #59 — Historic Winzerhäuser, Winery Gate & Church Spire",
    file: "sv_hauptstrasse_west_weingueter.png",
    type: "streetview",
    viewpoint: [49.6106531, 8.1629648],
    headingDeg: 252,
    pitchDeg: 5,
    fov: 85,
    waitMs: 6500,
  },
  {
    id: "sv_hauptstrasse_center_east",
    title: "Hauptstraße #36–45 — Pfalz Hofreiten, Sandstone Doorway & Gates",
    file: "sv_hauptstrasse_center_east.png",
    type: "streetview",
    viewpoint: [49.6109849, 8.1639510],
    headingDeg: 70,
    pitchDeg: 4,
    fov: 85,
    waitMs: 6500,
  },
  {
    id: "sv_weingut_kreutzenberger",
    title: "Weingut Kreutzenberger (Hauptstraße 5 — 1929 Bauhaus Landmark)",
    file: "sv_weingut_kreutzenberger.png",
    type: "streetview",
    viewpoint: [49.6119772, 8.1684244],
    headingDeg: 125,
    pitchDeg: 5,
    fov: 88,
    waitMs: 6500,
  },
  {
    id: "sv_side_street_neugasse",
    title: "Side Street — Neugasse #11 Residential Quarter",
    file: "sv_side_street_neugasse.png",
    type: "streetview",
    viewpoint: [49.6118280, 8.1629784],
    headingDeg: 252,
    pitchDeg: 4,
    fov: 85,
    waitMs: 6500,
  },
  {
    id: "sv_side_street_burgweg",
    title: "North Village Edge — Burgweg #4 & Vineyard Track",
    file: "sv_side_street_burgweg.png",
    type: "streetview",
    viewpoint: [49.6122723, 8.1653238],
    headingDeg: 22,
    pitchDeg: 3,
    fov: 85,
    waitMs: 6500,
  },
  {
    id: "sv_vineyard_edge_east",
    title: "East Village Entrance (L450 / B271 Approach) — Pfalz Vineyards & Skyline",
    file: "sv_vineyard_edge_east.png",
    type: "streetview",
    viewpoint: [49.6125209, 8.1721351],
    headingDeg: 252,
    pitchDeg: 2,
    fov: 80,
    waitMs: 6500,
  },
  {
    id: "sv_vineyard_edge_west",
    title: "West Hauptstraße #95 — Heritage Shutters, Sandstone Barn & Church Vista",
    file: "sv_vineyard_edge_west.png",
    type: "streetview",
    viewpoint: [49.6094452, 8.1575570],
    headingDeg: 65,
    pitchDeg: 3,
    fov: 82,
    waitMs: 6500,
  },
  {
    id: "sv_vineyard_hills_west",
    title: "West Village Edge (Hauptstraße #107 / Bauernhof Area)",
    file: "sv_vineyard_hills_west.png",
    type: "streetview",
    viewpoint: [49.6089033, 8.1559536],
    headingDeg: 245,
    pitchDeg: 2,
    fov: 82,
    waitMs: 6500,
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
        txt.includes("unusual traffic") ||
        txt.includes("verify you are human") ||
        txt.includes("i'm not a robot") ||
        txt.includes("ich bin kein roboter") ||
        !!document.querySelector("iframe[src*='recaptcha'], #captcha-form")
    };
  `);
  if (info?.isCaptcha) {
    console.error("CAPTCHA_DETECTED:", JSON.stringify(info));
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
    await sleep(shot.waitMs || 6000);
    await checkAntiBot(cdp);

    const finalMeta = await cdp.evalJson(`
      const txt = document.body?.innerText || "";
      const dateMatch = txt.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+20\\d\\d/i);
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
    results.push({
      id: shot.id,
      file: `/data/references/brave/${shot.file}`,
      lat: parsedSv ? parsedSv.lat : shot.lat,
      lon: parsedSv ? parsedSv.lon : shot.lon,
      headingDeg: parsedSv ? parsedSv.headingDeg : shot.headingDeg,
      pitchDeg: parsedSv ? parsedSv.pitchDeg : shot.pitchDeg,
      fovDeg: parsedSv ? parsedSv.fov : 55,
      panoId: parsedSv ? parsedSv.panoId : null,
      captureDate: finalMeta.captureDate,
      bytes: fs.statSync(outPath).size,
    });
  }

  cdp.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
