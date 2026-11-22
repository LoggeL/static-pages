import * as THREE from 'three';
import { lockable, loopLength, pointOnBelt, wheels } from '../drive';
import {
  CLHA_LOCK_TOOLS,
  CLHA_MONTAGE_VALUES,
  CLHA_TIMING_BELT,
  CLHA_TIMING_CHECK,
  VEHICLE_SPEC,
} from '../specs/clhaSpecs';

export interface PBRTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for procedural textures.');
  }
  return [canvas, ctx];
}

interface TextureOptions {
  srgb: boolean;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  repeatX?: number;
  repeatY?: number;
  anisotropy?: number;
}

function toTexture(canvas: HTMLCanvasElement, options: TextureOptions): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = options.wrapS ?? THREE.RepeatWrapping;
  texture.wrapT = options.wrapT ?? THREE.RepeatWrapping;
  if (options.repeatX !== undefined && options.repeatY !== undefined) {
    texture.repeat.set(options.repeatX, options.repeatY);
  }
  texture.anisotropy = options.anisotropy ?? 8;
  texture.needsUpdate = true;
  return texture;
}

let cachedFloor: PBRTextureSet | null = null;
let cachedWall: THREE.CanvasTexture | null = null;
let cachedPoster: THREE.CanvasTexture | null = null;
let cachedCastAluminum: PBRTextureSet | null = null;
let cachedOldBelt: PBRTextureSet | null = null;
let cachedNewBelt: PBRTextureSet | null = null;
let cachedBrakeRotor: PBRTextureSet | null = null;
let cachedTireTread: PBRTextureSet | null = null;
let cachedEngineCover: THREE.CanvasTexture | null = null;

export function getWorkshopFloorTextures(): PBRTextureSet {
  if (cachedFloor) return cachedFloor;

  const size = 512;
  const rand = mulberry32(42071);

  const [diffCanvas, diff] = createCanvas(size, size);
  const [bumpCanvas, bump] = createCanvas(size, size);
  const [roughCanvas, rough] = createCanvas(size, size);

  // Base industrial epoxy slate concrete
  diff.fillStyle = '#3f4754';
  diff.fillRect(0, 0, size, size);

  bump.fillStyle = 'rgb(132,132,132)';
  bump.fillRect(0, 0, size, size);

  // Semi-gloss epoxy resin base (~0.40 roughness)
  rough.fillStyle = 'rgb(104,104,104)';
  rough.fillRect(0, 0, size, size);

  // Subtle trowel/resin clouds & tire wear patches
  for (let i = 0; i < 65; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 85;
    const shade = Math.floor(56 + rand() * 24);
    const alpha = 0.06 + rand() * 0.08;

    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = diff.createRadialGradient(x + ox, y + oy, 2, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${shade}, ${shade + 6}, ${shade + 14}, ${alpha})`);
        g.addColorStop(1, 'rgba(63,71,84,0)');
        diff.fillStyle = g;
        diff.fillRect(0, 0, size, size);

        const rg = rough.createRadialGradient(x + ox, y + oy, 2, x + ox, y + oy, r);
        const rVal = Math.floor(82 + rand() * 68);
        rg.addColorStop(0, `rgba(${rVal},${rVal},${rVal},0.16)`);
        rg.addColorStop(1, 'rgba(104,104,104,0)');
        rough.fillStyle = rg;
        rough.fillRect(0, 0, size, size);
      }
    }
  }

  // Epoxy quartz flecks
  const fleckColors = ['#cbd5e1', '#64748b', '#1e293b', '#94a3b8', '#e2e8f0', '#475569'];
  for (let i = 0; i < 2400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 1 + rand() * 2.4;
    const h = 1 + rand() * 2.4;
    diff.fillStyle = fleckColors[Math.floor(rand() * fleckColors.length)];
    diff.globalAlpha = 0.25 + rand() * 0.45;
    diff.fillRect(x, y, w, h);

    const bVal = rand() > 0.5 ? 142 : 122;
    bump.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
    bump.globalAlpha = 0.35;
    bump.fillRect(x, y, w, h);

    const rVal = Math.floor(90 + rand() * 45);
    rough.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
    rough.globalAlpha = 0.28;
    rough.fillRect(x, y, w, h);
  }
  diff.globalAlpha = 1;
  bump.globalAlpha = 1;
  rough.globalAlpha = 1;

  // Expansion tile joints (2x2 concrete slab grid per tile)
  const step = size / 2;
  for (let i = 0; i < 2; i++) {
    const pos = i * step;

    // Dark recessed joint
    diff.fillStyle = '#252b34';
    diff.fillRect(pos, 0, 3, size);
    diff.fillRect(0, pos, size, 3);

    // Subtle specular bevel alongside joint
    diff.fillStyle = 'rgba(148, 163, 184, 0.14)';
    diff.fillRect(pos + 3, 0, 2, size);
    diff.fillRect(0, pos + 3, size, 2);

    bump.fillStyle = 'rgb(48,48,48)';
    bump.fillRect(pos, 0, 3, size);
    bump.fillRect(0, pos, size, 3);

    rough.fillStyle = 'rgb(218,218,218)';
    rough.fillRect(pos, 0, 4, size);
    rough.fillRect(0, pos, size, 4);
  }

  cachedFloor = {
    map: toTexture(diffCanvas, { srgb: true, repeatX: 6, repeatY: 5 }),
    bumpMap: toTexture(bumpCanvas, { srgb: false, repeatX: 6, repeatY: 5 }),
    roughnessMap: toTexture(roughCanvas, { srgb: false, repeatX: 6, repeatY: 5 }),
  };
  return cachedFloor;
}

export function getWorkshopWallTexture(): THREE.CanvasTexture {
  if (cachedWall) return cachedWall;

  const w = 1024;
  const h = 512;
  const rand = mulberry32(99103);
  const [canvas, ctx] = createCanvas(w, h);

  // Upper modern insulated workshop wall panels (cool clean light-grey/white)
  const upperGrad = ctx.createLinearGradient(0, 0, 0, h * 0.64);
  upperGrad.addColorStop(0, '#cfd8e3');
  upperGrad.addColorStop(0.45, '#e2e8f0');
  upperGrad.addColorStop(1, '#d5dde7');
  ctx.fillStyle = upperGrad;
  ctx.fillRect(0, 0, w, h * 0.64);

  // Subtle horizontal acoustic/sandwich panel ribbing on upper cladding
  for (let y = 16; y < h * 0.64; y += 32) {
    ctx.fillStyle = 'rgba(100, 116, 139, 0.12)';
    ctx.fillRect(0, y, w, 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(0, y + 2, w, 1);
  }

  // Vertical insulated panel joints
  for (let x = 0; x < w; x += 256) {
    ctx.fillStyle = 'rgba(71, 85, 105, 0.35)';
    ctx.fillRect(x, 0, 3, h * 0.64);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x + 3, 0, 2, h * 0.64);

    // Tiny fastener rivets along panel seams
    ctx.fillStyle = '#94a3b8';
    for (let y = 24; y < h * 0.62; y += 64) {
      ctx.beginPath();
      ctx.arc(x + 12, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Safety dado stripe band (VW blue + anthracite + subtle safety amber accent)
  const dadoY = Math.floor(h * 0.63);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, dadoY, w, 6);
  ctx.fillStyle = '#1d4ed8'; // VW Service Blue
  ctx.fillRect(0, dadoY + 6, w, 18);
  ctx.fillStyle = '#f59e0b'; // Crisp safety stripe
  ctx.fillRect(0, dadoY + 24, w, 5);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, dadoY + 29, w, 5);

  // Lower ceramic/epoxy wipe-clean tile dado
  const tileTop = dadoY + 34;
  ctx.fillStyle = '#535e6e';
  ctx.fillRect(0, tileTop, w, h - tileTop);

  const tileW = 64;
  const tileH = 38;
  for (let row = 0; tileTop + row * tileH < h; row++) {
    const y = tileTop + row * tileH;
    for (let col = 0; col * tileW < w; col++) {
      const x = col * tileW;
      const v = Math.floor(78 + rand() * 14);
      ctx.fillStyle = `rgb(${v}, ${v + 8}, ${v + 18})`;
      ctx.fillRect(x + 1, y + 1, tileW - 2, tileH - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 2, y + 2, tileW - 4, 2);
    }
  }

  // Dark floor skirting baseboard
  ctx.fillStyle = '#1e242d';
  ctx.fillRect(0, h - 18, w, 18);

  cachedWall = toTexture(canvas, {
    srgb: true,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    repeatX: 2,
    repeatY: 1,
  });
  return cachedWall;
}

export function getBeltPosterTexture(): THREE.CanvasTexture {
  if (cachedPoster) return cachedPoster;

  const w = 1024;
  const h = 1280;
  const [canvas, ctx] = createCanvas(w, h);

  // Deep technical workshop poster background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b1322');
  bg.addColorStop(1, '#111c30');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Blueprint engineering grid
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 32; x < w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 32; y < h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Outer border frame
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 5;
  ctx.strokeRect(24, 24, w - 48, h - 48);

  // Header bar
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(28, 28, w - 56, 132);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `${VEHICLE_SPEC.model.toUpperCase()} (${VEHICLE_SPEC.engineFamily} • MKB ${VEHICLE_SPEC.engineCode} • ${VEHICLE_SPEC.powerKw} kW)`,
    w / 2,
    86
  );

  ctx.fillStyle = '#bae6fd';
  ctx.font = '600 22px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillText(
    `ZAHNRIEMEN ${CLHA_TIMING_BELT.teeth} ZÄHNE / ${CLHA_TIMING_BELT.widthMm} MM • OT ${CLHA_TIMING_CHECK.crankDegrees}° / ${CLHA_TIMING_CHECK.camDegrees}°`,
    w / 2,
    130
  );

  // Map analytical drive.ts coordinates to poster canvas space
  const scale = 195;
  const ox = w * 0.49;
  const oy = 610;
  const toX = (dx: number) => ox + dx * scale;
  const toY = (dy: number) => oy - dy * scale;

  // Draw continuous analytical timing belt pitch path
  ctx.save();
  ctx.beginPath();
  const samples = 360;
  for (let i = 0; i <= samples; i++) {
    const p = pointOnBelt((loopLength * i) / samples);
    const px = toX(p.x + p.nx * 0.02);
    const py = toY(p.y + p.ny * 0.02);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 15;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4.5;
  ctx.setLineDash([14, 10]);
  ctx.stroke();
  ctx.restore();

  const shortLabels: Record<string, string> = {
    crank: 'KW',
    lower: 'U-ROLLE',
    tensioner: 'SPANNER',
    cam: 'NW (2:1)',
    upper: 'O-ROLLE',
    pump: 'HDP',
    water: 'WaPu',
  };

  for (const wheel of wheels) {
    const cx = toX(wheel.x);
    const cy = toY(wheel.y);
    const r = wheel.r * scale;
    const isToothed = wheel.teeth > 0;
    const isLocked = lockable.includes(wheel.id);

    ctx.save();
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 6, cx, cy, r);
    g.addColorStop(0, '#64748b');
    g.addColorStop(0.75, '#334155');
    g.addColorStop(1, '#1e293b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isToothed ? '#38bdf8' : wheel.id === 'tensioner' ? '#f59e0b' : '#94a3b8';
    ctx.lineWidth = isToothed ? 5 : 4;
    ctx.stroke();

    if (isToothed) {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(8, r - 9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (isLocked) {
      // OT pointer triangle above 12 o'clock
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r - 4);
      ctx.lineTo(cx - 10, cy - r - 22);
      ctx.lineTo(cx + 10, cy - r - 22);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${r > 48 ? 24 : 18}px "Inter", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortLabels[wheel.id] ?? wheel.name, cx, cy);
    ctx.restore();
  }

  // Bottom verified CLHA workshop mounting data banner
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(48, 975, w - 96, 245);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.strokeRect(48, 975, w - 96, 245);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 28px "Inter", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `SPANNROLLE (KALT): ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}° • KONTROLLE: ${CLHA_TIMING_CHECK.crankDegrees}° (≤ ${CLHA_TIMING_CHECK.pointerRecheckMaxOffsetMm} mm)`,
    w / 2,
    1034
  );

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '22px "Inter", Arial, sans-serif';
  ctx.fillText(
    `ABSTECKEN: KW ${CLHA_LOCK_TOOLS.crank.code} • NW ${CLHA_LOCK_TOOLS.cam.code} • HDP ${CLHA_LOCK_TOOLS.pump.code}`,
    w / 2,
    1088
  );
  ctx.fillText(
    `SCHUTZ UNTEN: ${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm • RADHAUS: ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm • SERIENRAD: je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
    w / 2,
    1130
  );

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(
    `REF.: ROLLEN ${CLHA_MONTAGE_VALUES.idlerNutNm} Nm • WP ${CLHA_MONTAGE_VALUES.waterPumpHousingBoltsCount}× ${CLHA_MONTAGE_VALUES.waterPumpHousingTorqueNm} Nm+${CLHA_MONTAGE_VALUES.waterPumpHousingAngleDeg}° • NW ${CLHA_MONTAGE_VALUES.camshaftCenterPreNm}→${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm • HDP ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm}→${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm`,
    w / 2,
    1188
  );

  cachedPoster = toTexture(canvas, {
    srgb: true,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  return cachedPoster;
}

export function getCastAluminumTextures(): PBRTextureSet {
  if (cachedCastAluminum) return cachedCastAluminum;

  const size = 512;
  const rand = mulberry32(55211);

  const [diffCanvas, diff] = createCanvas(size, size);
  const [bumpCanvas, bump] = createCanvas(size, size);
  const [roughCanvas, rough] = createCanvas(size, size);

  diff.fillStyle = '#b9c1cc';
  diff.fillRect(0, 0, size, size);

  bump.fillStyle = 'rgb(128,128,128)';
  bump.fillRect(0, 0, size, size);

  rough.fillStyle = 'rgb(126,126,126)'; // ~0.49 base roughness
  rough.fillRect(0, 0, size, size);

  // Subtle foundry mottling
  for (let i = 0; i < 110; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 14 + rand() * 42;
    const delta = Math.floor(-18 + rand() * 36);
    const base = 186 + delta;

    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = diff.createRadialGradient(x + ox, y + oy, 1, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${base},${base + 4},${base + 10},0.16)`);
        g.addColorStop(1, 'rgba(185,193,204,0)');
        diff.fillStyle = g;
        diff.fillRect(0, 0, size, size);
      }
    }
  }

  // Fine sand-cast aluminum micro-grain across image pixels
  const diffImg = diff.getImageData(0, 0, size, size);
  const bumpImg = bump.getImageData(0, 0, size, size);
  const roughImg = rough.getImageData(0, 0, size, size);
  const dData = diffImg.data;
  const bData = bumpImg.data;
  const rData = roughImg.data;

  for (let i = 0; i < dData.length; i += 4) {
    const grain = (rand() - 0.5) * 34;
    const micro = (rand() - 0.5) * 60;
    dData[i] = Math.min(255, Math.max(0, dData[i] + grain * 0.45));
    dData[i + 1] = Math.min(255, Math.max(0, dData[i + 1] + grain * 0.45));
    dData[i + 2] = Math.min(255, Math.max(0, dData[i + 2] + grain * 0.48));

    const bv = Math.min(255, Math.max(0, 128 + micro));
    bData[i] = bv;
    bData[i + 1] = bv;
    bData[i + 2] = bv;

    const rv = Math.min(200, Math.max(85, 126 - micro * 0.45));
    rData[i] = rv;
    rData[i + 1] = rv;
    rData[i + 2] = rv;
  }

  diff.putImageData(diffImg, 0, 0);
  bump.putImageData(bumpImg, 0, 0);
  rough.putImageData(roughImg, 0, 0);

  cachedCastAluminum = {
    map: toTexture(diffCanvas, { srgb: true }),
    bumpMap: toTexture(bumpCanvas, { srgb: false }),
    roughnessMap: toTexture(roughCanvas, { srgb: false }),
  };
  return cachedCastAluminum;
}

export function getOldBeltTextures(): PBRTextureSet {
  if (cachedOldBelt) return cachedOldBelt;

  const w = 1024;
  const h = 256;
  const rand = mulberry32(31415);

  const [diffCanvas, diff] = createCanvas(w, h);
  const [bumpCanvas, bump] = createCanvas(w, h);
  const [roughCanvas, rough] = createCanvas(w, h);

  // Aged dusty dark-grey EPDM rubber
  diff.fillStyle = '#33363b';
  diff.fillRect(0, 0, w, h);

  bump.fillStyle = 'rgb(138,138,138)';
  bump.fillRect(0, 0, w, h);

  rough.fillStyle = 'rgb(218,218,218)'; // dry oxidized rubber ~0.85
  rough.fillRect(0, 0, w, h);

  // 6 longitudinal rib channels / weave lines
  for (let r = 0; r < 6; r++) {
    const y = 18 + r * 38;
    diff.fillStyle = 'rgba(20, 22, 26, 0.42)';
    diff.fillRect(0, y, w, 12);

    bump.fillStyle = 'rgb(88,88,88)';
    bump.fillRect(0, y, w, 10);
    bump.fillStyle = 'rgb(172,172,172)';
    bump.fillRect(0, y + 14, w, 20);
  }

  // Glazed shiny wear streaks + dust mottling
  for (let i = 0; i < 90; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const rw = 30 + rand() * 140;
    const rh = 6 + rand() * 18;
    diff.fillStyle = rand() > 0.45 ? 'rgba(92, 85, 76, 0.16)' : 'rgba(22, 24, 28, 0.25)';
    diff.fillRect(x, y, rw, rh);

    // Glazed spots lower roughness
    rough.fillStyle = rand() > 0.6 ? 'rgb(112,112,112)' : 'rgb(232,232,232)';
    rough.globalAlpha = 0.25;
    rough.fillRect(x, y, rw, rh);
  }
  rough.globalAlpha = 1;

  // Faded worn print remnant
  diff.save();
  diff.fillStyle = 'rgba(203, 213, 225, 0.22)';
  diff.font = 'bold 26px monospace';
  diff.fillText('... EA288 CLHA  VW ... TDI ...', 140, 120);
  diff.fillText('ZAHNRIEMEN ... TDI ...', 620, 120);
  diff.restore();

  // Transverse ozone micro-cracks & edge fraying
  for (let i = 0; i < 68; i++) {
    const cx = rand() * w;
    const yStart = rand() * (h * 0.45);
    const len = 24 + rand() * 85;
    diff.strokeStyle = '#181a1e';
    diff.lineWidth = 1.5 + rand() * 2;
    bump.strokeStyle = 'rgb(22,22,22)';
    bump.lineWidth = 2.2 + rand() * 2;

    diff.beginPath();
    bump.beginPath();
    diff.moveTo(cx, yStart);
    bump.moveTo(cx, yStart);
    let curX = cx;
    let curY = yStart;
    for (let s = 0; s < 5; s++) {
      curX += (rand() - 0.5) * 9;
      curY += len / 5;
      diff.lineTo(curX, curY);
      bump.lineTo(curX, curY);
    }
    diff.stroke();
    bump.stroke();
  }

  // Slight frayed edge notches
  for (let i = 0; i < 36; i++) {
    const nx = rand() * w;
    const ny = rand() > 0.5 ? 0 : h - 10;
    diff.fillStyle = '#1f2226';
    diff.fillRect(nx, ny, 4 + rand() * 8, 10);
    bump.fillStyle = 'rgb(30,30,30)';
    bump.fillRect(nx, ny, 4 + rand() * 8, 10);
  }

  cachedOldBelt = {
    map: toTexture(diffCanvas, {
      srgb: true,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      repeatX: 4,
      repeatY: 1,
    }),
    bumpMap: toTexture(bumpCanvas, {
      srgb: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      repeatX: 4,
      repeatY: 1,
    }),
    roughnessMap: toTexture(roughCanvas, {
      srgb: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      repeatX: 4,
      repeatY: 1,
    }),
  };
  return cachedOldBelt;
}

export function getNewBeltTextures(): PBRTextureSet {
  if (cachedNewBelt) return cachedNewBelt;

  const w = 1024;
  const h = 256;
  const [diffCanvas, diff] = createCanvas(w, h);
  const [bumpCanvas, bump] = createCanvas(w, h);
  const [roughCanvas, rough] = createCanvas(w, h);

  // Fresh deep satin EPDM black back
  diff.fillStyle = '#14171c';
  diff.fillRect(0, 0, w, h);

  bump.fillStyle = 'rgb(128,128,128)';
  bump.fillRect(0, 0, w, h);

  rough.fillStyle = 'rgb(154,154,154)'; // crisp satin EPDM ~0.60
  rough.fillRect(0, 0, w, h);

  // Fine woven textile backing micro-grid
  diff.fillStyle = 'rgba(255, 255, 255, 0.03)';
  bump.fillStyle = 'rgb(144,144,144)';
  for (let x = 0; x < w; x += 6) {
    diff.fillRect(x, 0, 2, h);
    bump.fillRect(x, 0, 2, h);
  }
  for (let y = 0; y < h; y += 6) {
    diff.fillRect(0, y, w, 2);
    bump.fillRect(0, y, w, 2);
  }

  // Clean 6-rib profile bands on rib edges
  for (let r = 0; r < 6; r++) {
    const y = 14 + r * 39;
    bump.fillStyle = 'rgb(168,168,168)';
    bump.fillRect(0, y, w, 18);
    bump.fillStyle = 'rgb(96,96,96)';
    bump.fillRect(0, y + 20, w, 12);
  }

  // Crisp cyan & yellow OEM stripe accents
  diff.fillStyle = '#38bdf8';
  diff.fillRect(0, 28, w, 7);
  diff.fillStyle = '#facc15';
  diff.fillRect(0, h - 35, w, 7);

  // Crisp branding print
  diff.fillStyle = '#f8fafc';
  diff.font = 'bold 34px "Inter", "Segoe UI", Arial, sans-serif';
  diff.textBaseline = 'middle';
  diff.fillText('VW EA288 1.6 TDI (CLHA) • ZAHNRIEMEN • STEUERTRIEB', 34, 108);

  // Directional arrows in cyan & yellow
  const drawArrow = (ax: number, ay: number, color: string) => {
    diff.fillStyle = color;
    diff.beginPath();
    diff.moveTo(ax, ay - 14);
    diff.lineTo(ax + 24, ay);
    diff.lineTo(ax, ay + 14);
    diff.lineTo(ax + 7, ay);
    diff.closePath();
    diff.fill();
  };

  for (let x = 80; x < w - 40; x += 180) {
    drawArrow(x, 174, '#38bdf8');
    drawArrow(x + 28, 174, '#facc15');
    drawArrow(x + 56, 174, '#38bdf8');
  }

  // Ink slightly smoother than rubber
  rough.fillStyle = 'rgb(102,102,102)';
  rough.fillRect(0, 28, w, 7);
  rough.fillRect(0, h - 35, w, 7);
  rough.fillRect(34, 86, w - 68, 44);

  cachedNewBelt = {
    map: toTexture(diffCanvas, {
      srgb: true,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      repeatX: 4,
      repeatY: 1,
    }),
    bumpMap: toTexture(bumpCanvas, {
      srgb: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      repeatX: 4,
      repeatY: 1,
    }),
    roughnessMap: toTexture(roughCanvas, {
      srgb: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      repeatX: 4,
      repeatY: 1,
    }),
  };
  return cachedNewBelt;
}

export function getBrakeRotorTextures(): PBRTextureSet {
  if (cachedBrakeRotor) return cachedBrakeRotor;

  const size = 512;
  const cx = size / 2;
  const cy = size / 2;
  const rand = mulberry32(77312);

  const [diffCanvas, diff] = createCanvas(size, size);
  const [bumpCanvas, bump] = createCanvas(size, size);
  const [roughCanvas, rough] = createCanvas(size, size);

  diff.fillStyle = '#aeb7c2';
  diff.fillRect(0, 0, size, size);

  bump.fillStyle = 'rgb(128,128,128)';
  bump.fillRect(0, 0, size, size);

  rough.fillStyle = 'rgb(74,74,74)'; // machined steel ~0.29
  rough.fillRect(0, 0, size, size);

  // Concentric lathe turning grooves across the friction swept surface
  for (let r = 68; r < 248; r += 1.5) {
    const wave = Math.sin(r * 1.8) * 14 + (rand() - 0.5) * 18;
    const tone = Math.min(225, Math.max(120, Math.floor(178 + wave * 0.7)));
    diff.strokeStyle = `rgb(${tone}, ${tone + 4}, ${tone + 8})`;
    diff.lineWidth = 1.4;
    diff.beginPath();
    diff.arc(cx, cy, r, 0, Math.PI * 2);
    diff.stroke();

    const bv = Math.min(255, Math.max(0, Math.floor(128 + wave * 2.2)));
    bump.strokeStyle = `rgb(${bv},${bv},${bv})`;
    bump.lineWidth = 1.3;
    bump.beginPath();
    bump.arc(cx, cy, r, 0, Math.PI * 2);
    bump.stroke();

    const rv = Math.min(130, Math.max(46, Math.floor(72 - wave * 0.6)));
    rough.strokeStyle = `rgb(${rv},${rv},${rv})`;
    rough.lineWidth = 1.3;
    rough.beginPath();
    rough.arc(cx, cy, r, 0, Math.PI * 2);
    rough.stroke();
  }

  // Dark inner rotor hat & outer heat rim edge
  diff.fillStyle = '#474f59';
  diff.beginPath();
  diff.arc(cx, cy, 88, 0, Math.PI * 2);
  diff.fill();

  rough.fillStyle = 'rgb(148,148,148)';
  rough.beginPath();
  rough.arc(cx, cy, 88, 0, Math.PI * 2);
  rough.fill();

  cachedBrakeRotor = {
    map: toTexture(diffCanvas, {
      srgb: true,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    }),
    bumpMap: toTexture(bumpCanvas, {
      srgb: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    }),
    roughnessMap: toTexture(roughCanvas, {
      srgb: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    }),
  };
  return cachedBrakeRotor;
}

export function getTireTreadTextures(): PBRTextureSet {
  if (cachedTireTread) return cachedTireTread;

  const size = 512;
  const [diffCanvas, diff] = createCanvas(size, size);
  const [bumpCanvas, bump] = createCanvas(size, size);
  const [roughCanvas, rough] = createCanvas(size, size);

  // Raised vulcanized rubber base
  diff.fillStyle = '#202329';
  diff.fillRect(0, 0, size, size);

  bump.fillStyle = 'rgb(218,218,218)';
  bump.fillRect(0, 0, size, size);

  rough.fillStyle = 'rgb(198,198,198)'; // ~0.78 tire rubber
  rough.fillRect(0, 0, size, size);

  // Circumferential main rain channels (vertical in UV space along tread wrap)
  const channels = [118, 204, 308, 394];
  for (const cx of channels) {
    diff.fillStyle = '#121417';
    diff.fillRect(cx - 10, 0, 20, size);
    bump.fillStyle = 'rgb(28,28,28)';
    bump.fillRect(cx - 10, 0, 20, size);
    rough.fillStyle = 'rgb(232,232,232)';
    rough.fillRect(cx - 10, 0, 20, size);
  }

  // Diagonal shoulder & center tread sipes repeating seamlessly vertically
  const pitch = 64;
  for (let y = -pitch; y < size + pitch; y += pitch) {
    // Left shoulder diagonal grooves
    diff.strokeStyle = '#131519';
    diff.lineWidth = 11;
    bump.strokeStyle = 'rgb(34,34,34)';
    bump.lineWidth = 11;

    diff.beginPath();
    diff.moveTo(0, y + 18);
    diff.lineTo(116, y - 8);
    diff.moveTo(512, y + 18);
    diff.lineTo(396, y - 8);
    diff.stroke();

    bump.beginPath();
    bump.moveTo(0, y + 18);
    bump.lineTo(116, y - 8);
    bump.moveTo(512, y + 18);
    bump.lineTo(396, y - 8);
    bump.stroke();

    // Intermediate angled sipes
    diff.lineWidth = 7;
    bump.lineWidth = 7;
    diff.beginPath();
    diff.moveTo(126, y + 10);
    diff.lineTo(198, y - 16);
    diff.moveTo(386, y + 10);
    diff.lineTo(314, y - 16);
    diff.moveTo(212, y - 4);
    diff.lineTo(300, y + 14);
    diff.stroke();

    bump.beginPath();
    bump.moveTo(126, y + 10);
    bump.lineTo(198, y - 16);
    bump.moveTo(386, y + 10);
    bump.lineTo(314, y - 16);
    bump.moveTo(212, y - 4);
    bump.lineTo(300, y + 14);
    bump.stroke();
  }

  cachedTireTread = {
    map: toTexture(diffCanvas, { srgb: true, repeatX: 1, repeatY: 6 }),
    bumpMap: toTexture(bumpCanvas, { srgb: false, repeatX: 1, repeatY: 6 }),
    roughnessMap: toTexture(roughCanvas, { srgb: false, repeatX: 1, repeatY: 6 }),
  };
  return cachedTireTread;
}

export function getEngineCoverTexture(): THREE.CanvasTexture {
  if (cachedEngineCover) return cachedEngineCover;

  const size = 512;
  const rand = mulberry32(61601);
  const [canvas, ctx] = createCanvas(size, size);

  // Dark matte textured PA6-GF30 acoustic engine cover plastic
  ctx.fillStyle = '#1b1e24';
  ctx.fillRect(0, 0, size, size);

  // Fine molded plastic pebble grain
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  // Recessed acoustic styling ribs
  ctx.fillStyle = '#14171c';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(54, 108 + i * 30, 118, 12);
    ctx.fillRect(340, 108 + i * 30, 118, 12);
  }

  // Central sculpted dark graphite accent plate
  const plateGrad = ctx.createLinearGradient(140, 80, 372, 410);
  plateGrad.addColorStop(0, '#2a2f39');
  plateGrad.addColorStop(0.5, '#22262f');
  plateGrad.addColorStop(1, '#191c22');
  ctx.fillStyle = plateGrad;
  ctx.beginPath();
  ctx.roundRect(144, 72, 224, 368, 26);
  ctx.fill();
  ctx.strokeStyle = '#3b4250';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Subtle metallic VW roundel emblem
  const vx = 256;
  const vy = 158;
  const vr = 42;
  const metalGrad = ctx.createLinearGradient(vx - vr, vy - vr, vx + vr, vy + vr);
  metalGrad.addColorStop(0, '#e2e8f0');
  metalGrad.addColorStop(0.5, '#94a3b8');
  metalGrad.addColorStop(1, '#cbd5e1');

  ctx.fillStyle = '#0f1318';
  ctx.beginPath();
  ctx.arc(vx, vy, vr, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = metalGrad;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(vx, vy, vr - 3, 0, Math.PI * 2);
  ctx.stroke();

  // Stylized VW monogram lines
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  // Upper V
  ctx.moveTo(vx - 19, vy - 25);
  ctx.lineTo(vx, vy + 3);
  ctx.lineTo(vx + 19, vy - 25);
  // Lower W
  ctx.moveTo(vx - 26, vy - 12);
  ctx.lineTo(vx - 12, vy + 24);
  ctx.lineTo(vx, vy + 6);
  ctx.lineTo(vx + 12, vy + 24);
  ctx.lineTo(vx + 26, vy - 12);
  ctx.stroke();

  // Brushed silver metallic "TDI" badge
  const tdiGrad = ctx.createLinearGradient(176, 278, 336, 338);
  tdiGrad.addColorStop(0, '#f8fafc');
  tdiGrad.addColorStop(0.45, '#94a3b8');
  tdiGrad.addColorStop(0.7, '#e2e8f0');
  tdiGrad.addColorStop(1, '#64748b');

  ctx.save();
  ctx.font = 'italic 900 68px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillText('TDI', 258, 314);
  ctx.fillStyle = tdiGrad;
  ctx.fillText('TDI', 256, 311);
  ctx.restore();

  // Subtle EA288 BlueMotion Technology strip
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 16px "Inter", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('1.6 TDI • EA288 COMMON RAIL', 256, 378);

  cachedEngineCover = toTexture(canvas, {
    srgb: true,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  return cachedEngineCover;
}
