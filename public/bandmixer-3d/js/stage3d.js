import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const STEM_CONFIGS = [
  {
    id: 'vocals',
    label: 'Gesang',
    shortLabel: 'Gesang',
    color: '#f43f5e',
    pos: [0, 1.1, 1.75],
    rotY: 0,
    hitRadius: 0.95,
    hitHeight: 2.55,
    labelY: 2.38,
    lampOffset: [0, 0, 0.9],
  },
  {
    id: 'guitar',
    label: 'E-Gitarre',
    shortLabel: 'Gitarre',
    color: '#f97316',
    pos: [-3.55, 1.1, 1.0],
    rotY: 0.28,
    hitRadius: 1.0,
    hitHeight: 2.5,
    labelY: 2.35,
    lampOffset: [0.3, 0, 0.8],
  },
  {
    id: 'bass',
    label: 'E-Bass',
    shortLabel: 'Bass',
    color: '#10b981',
    pos: [3.55, 1.1, 1.0],
    rotY: -0.28,
    hitRadius: 1.0,
    hitHeight: 2.5,
    labelY: 2.35,
    lampOffset: [-0.3, 0, 0.8],
  },
  {
    id: 'drums',
    label: 'Schlagzeug',
    shortLabel: 'Drums',
    color: '#38bdf8',
    pos: [0, 1.68, -2.1],
    rotY: 0,
    hitRadius: 1.38,
    hitHeight: 2.45,
    labelY: 2.55,
    lampOffset: [0, 0, 1.1],
  },
  {
    id: 'keys',
    label: 'Keyboard / Synth',
    shortLabel: 'Keys',
    color: '#a855f7',
    pos: [2.35, 1.1, -1.35],
    rotY: -0.35,
    hitRadius: 1.08,
    hitHeight: 2.5,
    labelY: 2.35,
    lampOffset: [-0.2, 0, 0.9],
  },
];

const CAMERA_VIEWS = {
  overview: {
    pos: new THREE.Vector3(0, 5.55, 12.1),
    target: new THREE.Vector3(0, 1.88, 0.2),
    requiredHalfWidth: 5.35,
  },
  band: {
    pos: new THREE.Vector3(0.42, 4.15, 8.2),
    target: new THREE.Vector3(0, 2.15, -0.35),
    requiredHalfWidth: 4.75,
  },
  crowd: {
    pos: new THREE.Vector3(-4.9, 3.65, 13.3),
    target: new THREE.Vector3(0, 1.75, 1.25),
    requiredHalfWidth: 5.7,
  },
};

const CROWD_PALETTE = [
  '#f43f5e',
  '#f97316',
  '#10b981',
  '#38bdf8',
  '#a855f7',
  '#eab308',
  '#ec4899',
  '#14b8a6',
];

const SKIN_TONES = [0xf2c6a0, 0xe4ad82, 0xc68652, 0x8d5524, 0xf7d7bd];

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function createStageWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1b1d28';
  ctx.fillRect(0, 0, 512, 512);

  const plankCount = 16;
  const plankH = 512 / plankCount;
  for (let i = 0; i < plankCount; i++) {
    const shade = 24 + ((i * 7) % 10);
    ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 11})`;
    ctx.fillRect(0, i * plankH, 512, plankH - 2);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, (i + 1) * plankH - 2, 512, 2);

    // Subtle brushed grain lines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    for (let g = 0; g < 10; g++) {
      const y = i * plankH + 3 + ((g * 13) % (plankH - 5));
      ctx.fillRect((g * 73) % 120, y, 220 + ((g * 47) % 240), 1);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSpotBeamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.34)');
  grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.09)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSpeakerGrilleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#14161f';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 128; i += 6) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createKickHeadTexture(accentColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#101421';
  ctx.fillRect(0, 0, 256, 256);

  // Outer drum hoop ring
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.stroke();

  // Inner waveform emblem
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  const bars = [-44, -22, 0, 22, 44];
  const heights = [24, 48, 66, 42, 26];
  bars.forEach((bx, idx) => {
    const h = heights[idx];
    ctx.beginPath();
    ctx.moveTo(128 + bx, 128 - h / 2);
    ctx.lineTo(128 + bx, 128 + h / 2);
    ctx.stroke();
  });

  // Mic port hole
  ctx.fillStyle = '#05070d';
  ctx.beginPath();
  ctx.arc(178, 174, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createKeybedTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 128);

  const whiteKeys = 28;
  const kw = 512 / whiteKeys;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  for (let i = 0; i < whiteKeys; i++) {
    ctx.strokeRect(i * kw, 0, kw, 128);
  }

  ctx.fillStyle = '#0f172a';
  const pattern = [1, 1, 0, 1, 1, 1, 0];
  for (let i = 0; i < whiteKeys - 1; i++) {
    if (pattern[i % 7]) {
      ctx.fillRect((i + 1) * kw - kw * 0.3, 0, kw * 0.6, 78);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawNameplateCanvas(canvas, cfg, { available, muted, hovered }) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const badgeText = !available ? 'PAUSE' : muted ? 'AUS' : '';
  const hasBadge = badgeText.length > 0;

  ctx.font = '700 34px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const labelWidth = ctx.measureText(cfg.label).width;

  ctx.font = '800 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const badgeWidth = hasBadge ? ctx.measureText(badgeText).width + 26 : 0;

  const padX = 28;
  const dotSize = 16;
  const gap = 14;
  const pillW = Math.min(
    w - 16,
    padX * 2 + dotSize + gap + labelWidth + (hasBadge ? gap + badgeWidth : 0)
  );
  const pillH = 68;
  const pillX = (w - pillW) / 2;
  const pillY = (h - pillH) / 2;

  // Pill background
  roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  if (!available) {
    ctx.fillStyle = 'rgba(15, 20, 34, 0.78)';
  } else if (muted) {
    ctx.fillStyle = hovered ? 'rgba(46, 20, 28, 0.92)' : 'rgba(24, 16, 24, 0.88)';
  } else {
    ctx.fillStyle = hovered ? 'rgba(22, 28, 48, 0.96)' : 'rgba(12, 16, 30, 0.88)';
  }
  ctx.fill();

  // Pill border
  ctx.lineWidth = hovered && available ? 4.5 : 3;
  if (!available) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  } else if (muted) {
    ctx.strokeStyle = hovered ? '#f87171' : 'rgba(248, 113, 113, 0.55)';
  } else {
    ctx.strokeStyle = cfg.color;
  }
  ctx.stroke();

  // Status dot
  const dotX = pillX + padX + dotSize / 2;
  const dotY = h / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
  if (!available) {
    ctx.fillStyle = '#64748b';
  } else if (muted) {
    ctx.fillStyle = '#ef4444';
  } else {
    ctx.fillStyle = cfg.color;
  }
  ctx.fill();

  // Label text
  const textX = dotX + dotSize / 2 + gap;
  ctx.font = '700 34px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = !available ? '#94a3b8' : muted ? '#cbd5e1' : '#f8fafc';
  ctx.fillText(cfg.label, textX, h / 2 + 1);

  // AUS / PAUSE badge
  if (hasBadge) {
    const bx = textX + labelWidth + gap;
    const bh = 36;
    const by = (h - bh) / 2;
    roundRectPath(ctx, bx, by, badgeWidth, bh, bh / 2);
    ctx.fillStyle = !available ? 'rgba(100, 116, 139, 0.35)' : 'rgba(239, 68, 68, 0.9)';
    ctx.fill();

    ctx.font = '800 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = !available ? '#cbd5e1' : '#ffffff';
    ctx.fillText(badgeText, bx + badgeWidth / 2, h / 2 + 1);
  }
}

function buildElectricBodyShape(isBass) {
  const s = new THREE.Shape();
  if (isBass) {
    // Sleek offset double-cutaway bass body (X = along neck toward +X, Y = body height)
    s.moveTo(-0.26, -0.13);
    s.bezierCurveTo(-0.31, 0.02, -0.25, 0.16, -0.1, 0.17);
    s.bezierCurveTo(0.0, 0.18, 0.08, 0.12, 0.14, 0.16);
    s.bezierCurveTo(0.18, 0.17, 0.21, 0.13, 0.13, 0.08);
    s.lineTo(0.11, 0.03);
    s.lineTo(0.11, -0.04);
    s.lineTo(0.15, -0.09);
    s.bezierCurveTo(0.17, -0.14, 0.09, -0.18, 0.02, -0.15);
    s.bezierCurveTo(-0.08, -0.17, -0.22, -0.19, -0.26, -0.13);
  } else {
    // Classic double-cutaway electric guitar body
    s.moveTo(-0.23, -0.12);
    s.bezierCurveTo(-0.27, 0.0, -0.22, 0.14, -0.08, 0.16);
    s.bezierCurveTo(0.02, 0.17, 0.09, 0.11, 0.14, 0.14);
    s.bezierCurveTo(0.17, 0.15, 0.18, 0.1, 0.1, 0.06);
    s.lineTo(0.1, -0.06);
    s.bezierCurveTo(0.16, -0.09, 0.16, -0.14, 0.1, -0.14);
    s.bezierCurveTo(0.02, -0.13, -0.04, -0.17, -0.14, -0.16);
    s.bezierCurveTo(-0.2, -0.15, -0.22, -0.14, -0.23, -0.12);
  }
  return s;
}

function buildGuitarMesh(accentHex, isBass) {
  const group = new THREE.Group();
  const shape = buildElectricBodyShape(isBass);
  const bodyGeom = new THREE.ExtrudeGeometry(shape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.009,
    bevelThickness: 0.009,
  });
  bodyGeom.center();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    roughness: 0.22,
    metalness: 0.35,
  });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.castShadow = true;
  group.add(body);

  // Pickguard
  const guardMat = new THREE.MeshStandardMaterial({
    color: isBass ? 0x0f172a : 0xf1f5f9,
    roughness: 0.35,
    metalness: 0.08,
  });
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.008), guardMat);
  guard.position.set(-0.02, -0.02, 0.032);
  group.add(guard);

  // Pickups & bridge
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.18,
    metalness: 0.92,
  });
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.085, 0.014), chromeMat);
  bridge.position.set(-0.14, 0, 0.036);
  group.add(bridge);

  const pickupOffsets = isBass ? [-0.04, 0.04] : [-0.055, 0.045];
  pickupOffsets.forEach((px) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.016), chromeMat);
    p.position.set(px, 0, 0.036);
    group.add(p);
  });

  // Neck extending along +X toward musician's fretting (left) hand
  const neckLen = isBass ? 0.68 : 0.54;
  const neckMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.45 });
  const fretMat = new THREE.MeshStandardMaterial({ color: 0x1e1b18, roughness: 0.5 });

  const neck = new THREE.Mesh(new THREE.BoxGeometry(neckLen, 0.048, 0.024), neckMat);
  neck.position.set(0.1 + neckLen / 2, 0.0, 0.008);
  neck.castShadow = true;
  group.add(neck);

  const fretboard = new THREE.Mesh(new THREE.BoxGeometry(neckLen + 0.04, 0.044, 0.008), fretMat);
  fretboard.position.set(0.08 + neckLen / 2, 0.0, 0.022);
  group.add(fretboard);

  // Headstock + tuning pegs
  const headX = 0.1 + neckLen + 0.07;
  const headstock = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.075, 0.022), bodyMat);
  headstock.position.set(headX, 0.01, 0.005);
  headstock.rotation.z = -0.1;
  group.add(headstock);

  const pegCount = isBass ? 4 : 6;
  for (let i = 0; i < pegCount; i++) {
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.03, 8), chromeMat);
    peg.position.set(headX - 0.04 + i * (isBass ? 0.028 : 0.018), 0.055, 0.005);
    group.add(peg);
  }

  return { group, bodyMat };
}

function createMusicianRig(cfg, { seated = false, skinTone = 0xf2c6a0, hairStyle = 'rock' } = {}) {
  const root = new THREE.Group();
  root.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  root.rotation.y = cfg.rotY;

  const accentColor = new THREE.Color(cfg.color);

  const materials = {
    accent: new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.18,
      roughness: 0.42,
      metalness: 0.18,
    }),
    jacket: new THREE.MeshStandardMaterial({
      color: 0x1a1e2e,
      roughness: 0.58,
      metalness: 0.14,
    }),
    pants: new THREE.MeshStandardMaterial({
      color: 0x121521,
      roughness: 0.72,
      metalness: 0.08,
    }),
    skin: new THREE.MeshStandardMaterial({
      color: skinTone,
      roughness: 0.62,
      metalness: 0.04,
    }),
    hair: new THREE.MeshStandardMaterial({
      color: hairStyle === 'blonde' ? 0xd9a441 : 0x16171f,
      roughness: 0.7,
    }),
    chrome: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.9,
    }),
  };

  // Legs
  const legsGroup = new THREE.Group();
  root.add(legsGroup);

  const bootGeom = new THREE.BoxGeometry(0.14, 0.12, 0.24);
  const legGeom = new THREE.CapsuleGeometry(0.072, 0.56, 6, 12);

  if (!seated) {
    [-0.14, 0.14].forEach((lx) => {
      const leg = new THREE.Mesh(legGeom, materials.pants);
      leg.position.set(lx, 0.44, 0);
      leg.castShadow = true;
      legsGroup.add(leg);

      const boot = new THREE.Mesh(bootGeom, materials.jacket);
      boot.position.set(lx, 0.06, 0.04);
      boot.castShadow = true;
      legsGroup.add(boot);
    });
  } else {
    // Seated drummer legs angled toward pedals
    [-0.22, 0.22].forEach((lx) => {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.34, 6, 10), materials.pants);
      thigh.position.set(lx * 0.85, 0.56, 0.14);
      thigh.rotation.x = Math.PI * 0.42;
      thigh.castShadow = true;
      legsGroup.add(thigh);

      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.36, 6, 10), materials.pants);
      shin.position.set(lx, 0.28, 0.32);
      shin.castShadow = true;
      legsGroup.add(shin);

      const boot = new THREE.Mesh(bootGeom, materials.jacket);
      boot.position.set(lx, 0.06, 0.35);
      boot.castShadow = true;
      legsGroup.add(boot);
    });
  }

  // Body pivot (hip level)
  const bodyPivot = new THREE.Group();
  bodyPivot.position.set(0, seated ? 0.64 : 0.82, seated ? -0.18 : 0);
  root.add(bodyPivot);

  // Torso
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.19, 0.34, 8, 16),
    materials.jacket
  );
  torso.position.set(0, 0.28, 0);
  torso.scale.set(1.12, 1, 0.78);
  torso.castShadow = true;
  bodyPivot.add(torso);

  // Accent chest panel / vest stripe
  const chestStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.34, 0.04),
    materials.accent
  );
  chestStripe.position.set(0, 0.29, 0.145);
  bodyPivot.add(chestStripe);

  // Shoulder accent collar
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.032, 8, 20),
    materials.accent
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.49, 0.01);
  bodyPivot.add(collar);

  // Head pivot
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.54, 0);
  bodyPivot.add(headPivot);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.12, 12), materials.skin);
  neck.position.set(0, 0.05, 0);
  headPivot.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.175, 20, 16), materials.skin);
  head.position.set(0, 0.24, 0);
  head.scale.set(0.95, 1.05, 0.98);
  head.castShadow = true;
  headPivot.add(head);

  // Visor / cool shades
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.062, 0.07),
    new THREE.MeshStandardMaterial({
      color: 0x090c15,
      emissive: accentColor,
      emissiveIntensity: 0.22,
      roughness: 0.12,
      metalness: 0.85,
    })
  );
  visor.position.set(0, 0.25, 0.145);
  headPivot.add(visor);

  // Distinct hairstyles
  if (hairStyle === 'spiked') {
    const baseHair = new THREE.Mesh(
      new THREE.SphereGeometry(0.182, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
      materials.hair
    );
    baseHair.position.set(0, 0.26, -0.01);
    headPivot.add(baseHair);
    for (let i = -2; i <= 2; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 8), materials.hair);
      spike.position.set(i * 0.055, 0.44 - Math.abs(i) * 0.02, 0.01);
      spike.rotation.z = -i * 0.22;
      spike.rotation.x = 0.2;
      headPivot.add(spike);
    }
  } else if (hairStyle === 'swept') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.188, 16, 12), materials.hair);
    cap.position.set(0, 0.28, -0.02);
    cap.scale.set(1.02, 0.88, 1.06);
    headPivot.add(cap);
    const fringe = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 8), materials.hair);
    fringe.position.set(0.06, 0.36, 0.12);
    fringe.rotation.z = -0.6;
    fringe.rotation.x = 0.65;
    headPivot.add(fringe);
  } else if (hairStyle === 'beanie') {
    const beanie = new THREE.Mesh(
      new THREE.SphereGeometry(0.188, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      materials.accent
    );
    beanie.position.set(0, 0.27, -0.01);
    headPivot.add(beanie);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.028, 8, 24), materials.jacket);
    brim.rotation.x = Math.PI / 2;
    brim.position.set(0, 0.28, 0);
    headPivot.add(brim);
  } else if (hairStyle === 'headband') {
    const topHair = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 12), materials.hair);
    topHair.position.set(0, 0.28, -0.02);
    topHair.scale.set(1.06, 0.85, 1.06);
    headPivot.add(topHair);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.178, 0.022, 8, 24), materials.accent);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.3, 0);
    headPivot.add(band);
  } else {
    // Tousled synth hairstyle
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.186, 16, 12), materials.hair);
    hair.position.set(0, 0.29, -0.02);
    hair.scale.set(1.02, 0.92, 1.04);
    headPivot.add(hair);
  }

  // Arms (left = +X, right = -X)
  const upperArmGeom = new THREE.CapsuleGeometry(0.055, 0.22, 6, 10);
  const forearmGeom = new THREE.CapsuleGeometry(0.048, 0.22, 6, 10);
  const handGeom = new THREE.SphereGeometry(0.052, 10, 10);

  function makeArm(sideSign) {
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(sideSign * 0.245, 0.45, 0);
    bodyPivot.add(shoulderPivot);

    const upper = new THREE.Mesh(upperArmGeom, materials.jacket);
    upper.position.set(0, -0.14, 0);
    upper.castShadow = true;
    shoulderPivot.add(upper);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.set(0, -0.28, 0);
    shoulderPivot.add(elbowPivot);

    const lower = new THREE.Mesh(forearmGeom, materials.skin);
    lower.position.set(0, -0.13, 0);
    lower.castShadow = true;
    elbowPivot.add(lower);

    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.052, 0.05, 10),
      materials.accent
    );
    cuff.position.set(0, -0.22, 0);
    elbowPivot.add(cuff);

    const hand = new THREE.Mesh(handGeom, materials.skin);
    hand.position.set(0, -0.27, 0);
    elbowPivot.add(hand);

    return { shoulderPivot, elbowPivot, hand };
  }

  const leftArm = makeArm(1);
  const rightArm = makeArm(-1);

  return {
    root,
    bodyPivot,
    headPivot,
    leftArm,
    rightArm,
    materials,
    accentColor,
    baseSkinColor: new THREE.Color(skinTone),
  };
}

function attachInteractiveStageElements(rig, cfg, spotBeamTex) {
  const accent = new THREE.Color(cfg.color);

  // Floor ring (main + subtle outer halo)
  const ringMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.85, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.022, 0);
  rig.root.add(ring);

  const haloMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const haloRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.12, 48), haloMat);
  haloRing.rotation.x = -Math.PI / 2;
  haloRing.position.set(0, 0.02, 0);
  rig.root.add(haloRing);

  // Invisible generous hit cylinder for clicks & mobile taps
  const hitMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(cfg.hitRadius, cfg.hitRadius, cfg.hitHeight, 16),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  hitMesh.position.set(0, cfg.hitHeight / 2, 0);
  hitMesh.userData.stemId = cfg.id;
  rig.root.add(hitMesh);

  // Floating nameplate sprite
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 112;
  drawNameplateCanvas(labelCanvas, cfg, { available: true, muted: false, hovered: false });

  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.minFilter = THREE.LinearFilter;

  const spriteMat = new THREE.SpriteMaterial({
    map: labelTex,
    transparent: true,
    depthTest: false,
  });
  const labelSprite = new THREE.Sprite(spriteMat);
  labelSprite.position.set(0, cfg.labelY, 0);
  labelSprite.scale.set(2.35, 0.52, 1);
  labelSprite.renderOrder = 10;
  labelSprite.userData.stemId = cfg.id;
  rig.root.add(labelSprite);

  // Volumetric spotlight cone anchored from overhead truss down to floor ring
  const topWorld = new THREE.Vector3(
    cfg.pos[0] + cfg.lampOffset[0],
    6.88,
    cfg.pos[2] + cfg.lampOffset[2]
  );
  const floorWorld = new THREE.Vector3(cfg.pos[0], cfg.pos[1] + 0.02, cfg.pos[2]);
  const dir = floorWorld.clone().sub(topWorld);
  const beamLen = dir.length();

  const beamPivot = new THREE.Group();
  beamPivot.position.copy(topWorld);
  beamPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());

  const coneGeom = new THREE.ConeGeometry(1.12, 1, 28, 1, true);
  coneGeom.translate(0, -0.5, 0);

  const beamMat = new THREE.MeshBasicMaterial({
    color: accent,
    map: spotBeamTex,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamMesh = new THREE.Mesh(coneGeom, beamMat);
  beamMesh.scale.set(1, beamLen, 1);
  beamPivot.add(beamMesh);

  // Dedicated SpotLight shining down onto the musician
  const spotLight = new THREE.SpotLight(accent, 3.2, 14, Math.PI * 0.17, 0.7, 1.15);
  spotLight.position.copy(topWorld);
  spotLight.target.position.set(cfg.pos[0], cfg.pos[1] + 0.85, cfg.pos[2]);

  return {
    ringMat,
    haloMat,
    hitMesh,
    labelCanvas,
    labelTex,
    labelSprite,
    beamPivot,
    beamMat,
    spotLight,
    labelStateKey: '1|0|0',
  };
}

function buildVocalsAdditions(rig) {
  // Handheld mic in right hand
  const micGroup = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.017, 0.17, 10),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.6 })
  );
  const grille = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), rig.materials.chrome);
  grille.position.y = 0.1;
  const micRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.026, 0.006, 6, 14),
    rig.materials.accent
  );
  micRing.rotation.x = Math.PI / 2;
  micRing.position.y = 0.068;

  micGroup.add(handle, grille, micRing);
  micGroup.position.set(0, -0.29, 0.05);
  micGroup.rotation.x = Math.PI * 0.42;
  rig.rightArm.elbowPivot.add(micGroup);

  // Chrome mic stand in front of singer
  const standGroup = new THREE.Group();
  standGroup.position.set(0.14, 0, 0.48);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 20), rig.materials.chrome);
  base.position.y = 0.02;
  base.castShadow = true;
  standGroup.add(base);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 1.25, 10), rig.materials.chrome);
  pole.position.y = 0.64;
  pole.castShadow = true;
  standGroup.add(pole);

  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.48, 8), rig.materials.chrome);
  boom.position.set(-0.07, 1.32, -0.14);
  boom.rotation.x = 0.75;
  boom.rotation.z = 0.25;
  standGroup.add(boom);

  rig.root.add(standGroup);
  return {};
}

function buildGuitarOrBassAdditions(rig, cfg, isBass) {
  const { group: instrument, bodyMat } = buildGuitarMesh(cfg.color, isBass);
  // Placed across chest: neck reaches toward +X (musician's left hand)
  instrument.position.set(0.06, 0.22, 0.235);
  instrument.rotation.set(-0.08, -0.16, isBass ? 0.42 : 0.34);
  rig.bodyPivot.add(instrument);

  // Guitar strap diagonal across torso
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.022, 6, 24),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 })
  );
  strap.position.set(0, 0.31, 0.01);
  strap.rotation.set(0.25, 0.2, -0.78);
  strap.scale.set(1.15, 0.9, 0.8);
  rig.bodyPivot.add(strap);

  return { instrumentMat: bodyMat };
}

function buildDrumsAdditions(rig, cfg) {
  const kitGroup = new THREE.Group();
  rig.root.add(kitGroup);

  const shellMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    roughness: 0.24,
    metalness: 0.42,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.65,
  });
  const chromeMat = rig.materials.chrome;
  const cymbalMat = new THREE.MeshStandardMaterial({
    color: 0xf0b429,
    roughness: 0.16,
    metalness: 0.92,
    side: THREE.DoubleSide,
  });

  // Throne behind drummer
  const thronePost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.56, 10), chromeMat);
  thronePost.position.set(0, 0.28, -0.2);
  const throneSeat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.08, 18),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 })
  );
  throneSeat.position.set(0, 0.58, -0.2);
  kitGroup.add(thronePost, throneSeat);

  // Kick drum (front center, facing +Z)
  const kickGroup = new THREE.Group();
  kickGroup.position.set(0, 0.46, 0.42);
  kitGroup.add(kickGroup);

  const kickShell = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 28), shellMat);
  kickShell.rotation.x = Math.PI / 2;
  kickShell.castShadow = true;
  kickGroup.add(kickShell);

  const kickFrontTex = createKickHeadTexture(cfg.color);
  const kickFrontHead = new THREE.Mesh(
    new THREE.CircleGeometry(0.435, 28),
    new THREE.MeshStandardMaterial({ map: kickFrontTex, roughness: 0.55 })
  );
  kickFrontHead.position.z = 0.254;
  kickGroup.add(kickFrontHead);

  const kickHoop = new THREE.Mesh(new THREE.TorusGeometry(0.445, 0.022, 8, 28), chromeMat);
  kickHoop.position.z = 0.252;
  kickGroup.add(kickHoop);

  // Helper for vertical toms/snare
  function createDrumPiece(radius, height, x, y, z, tiltX = 0, tiltZ = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.set(tiltX, 0, tiltZ);

    const shell = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20), shellMat);
    shell.castShadow = true;
    g.add(shell);

    const topHead = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.96, 20), headMat);
    topHead.rotation.x = -Math.PI / 2;
    topHead.position.y = height / 2 + 0.002;
    g.add(topHead);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.013, 6, 20), chromeMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = height / 2;
    g.add(rim);

    return g;
  }

  // Snare (drummer's front-left)
  const snare = createDrumPiece(0.2, 0.16, 0.24, 0.72, 0.24, 0.12, -0.05);
  const snareStand = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.7, 8), chromeMat);
  snareStand.position.set(0.24, 0.35, 0.24);
  kitGroup.add(snare, snareStand);

  // Two rack toms above kick drum
  const tomL = createDrumPiece(0.16, 0.19, 0.18, 1.02, 0.39, 0.35, -0.08);
  const tomR = createDrumPiece(0.18, 0.21, -0.19, 1.0, 0.39, 0.35, 0.08);
  kitGroup.add(tomL, tomR);

  // Floor tom (drummer's right)
  const floorTom = createDrumPiece(0.24, 0.42, -0.52, 0.56, 0.18, 0.04, 0.05);
  kitGroup.add(floorTom);

  // Hi-hat (drummer's left)
  const hihatStand = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 1.06, 8), chromeMat);
  hihatStand.position.set(0.58, 0.53, 0.28);
  kitGroup.add(hihatStand);

  const hihatBottom = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.03, 20), cymbalMat);
  hihatBottom.position.set(0.58, 0.96, 0.28);
  hihatBottom.rotation.x = Math.PI;
  const hihatTop = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.03, 20), cymbalMat);
  hihatTop.position.set(0.58, 0.99, 0.28);
  kitGroup.add(hihatBottom, hihatTop);

  // Crash cymbal (left) & Ride/Crash cymbal (right)
  function createCymbalStand(x, y, z, radius, tiltZ) {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.022, y, 8), chromeMat);
    stand.position.set(x, y / 2, z);
    kitGroup.add(stand);

    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.rotation.z = tiltZ;
    pivot.rotation.x = 0.2;

    const dish = new THREE.Mesh(new THREE.ConeGeometry(radius, 0.045, 24), cymbalMat);
    dish.castShadow = true;
    pivot.add(dish);
    kitGroup.add(pivot);
    return pivot;
  }

  const cymbalLeft = createCymbalStand(0.84, 1.32, 0.36, 0.29, -0.22);
  const cymbalRight = createCymbalStand(-0.86, 1.28, 0.34, 0.32, 0.24);

  // Drumsticks in both hands
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xe9c496, roughness: 0.5 });
  const stickGeom = new THREE.CylinderGeometry(0.008, 0.012, 0.36, 6);
  stickGeom.translate(0, 0.16, 0);

  const leftStick = new THREE.Mesh(stickGeom, stickMat);
  leftStick.position.set(0, -0.27, 0.02);
  leftStick.rotation.x = Math.PI * 0.52;
  rig.leftArm.elbowPivot.add(leftStick);

  const rightStick = new THREE.Mesh(stickGeom, stickMat);
  rightStick.position.set(0, -0.27, 0.02);
  rightStick.rotation.x = Math.PI * 0.52;
  rig.rightArm.elbowPivot.add(rightStick);

  return {
    kickGroup,
    kickFrontHead,
    kickFrontTex,
    hihatTop,
    cymbalLeft,
    cymbalRight,
    cymbalWobbleL: 0,
    cymbalWobbleR: 0,
    lastTransient: 0,
  };
}

function buildKeysAdditions(rig, cfg) {
  const synthGroup = new THREE.Group();
  synthGroup.position.set(0, 0, 0.5);
  rig.root.add(synthGroup);

  const chromeMat = rig.materials.chrome;
  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x161925,
    roughness: 0.35,
    metalness: 0.55,
  });
  const keybedTex = createKeybedTexture();
  const keybedMat = new THREE.MeshStandardMaterial({
    map: keybedTex,
    roughness: 0.28,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.color,
    emissiveIntensity: 1.15,
    roughness: 0.2,
  });

  // A-frame / X-stand legs
  [-0.52, 0.52].forEach((sx) => {
    const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.06, 8), chromeMat);
    legA.position.set(sx, 0.44, 0);
    legA.rotation.x = 0.48;
    legA.castShadow = true;

    const legB = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.06, 8), chromeMat);
    legB.position.set(sx, 0.44, 0);
    legB.rotation.x = -0.48;
    legB.castShadow = true;

    const riserPost = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), chromeMat);
    riserPost.position.set(sx, 1.03, 0.07);

    synthGroup.add(legA, legB, riserPost);
  });

  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8), chromeMat);
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.set(0, 0.45, 0);
  synthGroup.add(crossbar);

  // Lower tier 61-key synthesizer
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.09, 0.38), chassisMat);
  lowerBody.position.set(0, 0.9, 0);
  lowerBody.castShadow = true;
  synthGroup.add(lowerBody);

  const lowerKeys = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.19), keybedMat);
  lowerKeys.rotation.x = -Math.PI / 2;
  lowerKeys.position.set(0, 0.948, -0.07);
  synthGroup.add(lowerKeys);

  const lowerLed = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.022, 0.015), ledMat);
  lowerLed.position.set(0, 0.9, 0.194);
  synthGroup.add(lowerLed);

  // Upper angled lead synthesizer
  const upperTier = new THREE.Group();
  upperTier.position.set(0, 1.16, 0.08);
  upperTier.rotation.x = -0.22;
  synthGroup.add(upperTier);

  const upperBody = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.08, 0.3), chassisMat);
  upperBody.castShadow = true;
  upperTier.add(upperBody);

  const upperKeys = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.15), keybedMat);
  upperKeys.rotation.x = -Math.PI / 2;
  upperKeys.position.set(0, 0.043, -0.055);
  upperTier.add(upperKeys);

  const upperLed = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.02, 0.015), ledMat);
  upperLed.position.set(0, 0, 0.152);
  upperTier.add(upperLed);

  return { ledMat, keybedTex };
}

function buildStageEnvironment(scene) {
  const disposables = [];
  const stageGroup = new THREE.Group();
  scene.add(stageGroup);

  const woodTex = createStageWoodTexture();
  disposables.push(woodTex);

  const grilleTex = createSpeakerGrilleTexture();
  disposables.push(grilleTex);

  // Arena floor
  const arenaFloor = new THREE.Mesh(
    new THREE.CircleGeometry(36, 48),
    new THREE.MeshStandardMaterial({
      color: 0x0b0d17,
      roughness: 0.9,
      metalness: 0.08,
    })
  );
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.receiveShadow = true;
  stageGroup.add(arenaFloor);

  // Main concert stage deck (width 11.6, height 1.1, depth 7.2; z from -4.2 to +3.0)
  const stageDeckMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    roughness: 0.48,
    metalness: 0.14,
  });
  const stageSkirtMat = new THREE.MeshStandardMaterial({
    color: 0x10131e,
    roughness: 0.78,
    metalness: 0.18,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.24,
    metalness: 0.88,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1e2433,
    roughness: 0.42,
    metalness: 0.65,
  });

  const stageDeck = new THREE.Mesh(
    new THREE.BoxGeometry(11.6, 0.14, 7.2),
    stageDeckMat
  );
  stageDeck.position.set(0, 1.03, -0.6);
  stageDeck.receiveShadow = true;
  stageDeck.castShadow = true;
  stageGroup.add(stageDeck);

  const stageSkirt = new THREE.Mesh(
    new THREE.BoxGeometry(11.4, 0.96, 7.0),
    stageSkirtMat
  );
  stageSkirt.position.set(0, 0.48, -0.6);
  stageSkirt.receiveShadow = true;
  stageGroup.add(stageSkirt);

  // Stage front LED rim strip
  const stageLedMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const frontTrim = new THREE.Mesh(new THREE.BoxGeometry(11.62, 0.055, 0.06), stageLedMat);
  frontTrim.position.set(0, 1.07, 3.01);
  stageGroup.add(frontTrim);

  // Drum riser platform (top at y = 1.68)
  const riserDeck = new THREE.Mesh(
    new THREE.BoxGeometry(3.7, 0.58, 2.4),
    stageSkirtMat
  );
  riserDeck.position.set(0, 1.39, -2.1);
  riserDeck.receiveShadow = true;
  riserDeck.castShadow = true;
  stageGroup.add(riserDeck);

  const riserLedMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.75,
    roughness: 0.2,
  });
  const riserTrim = new THREE.Mesh(new THREE.BoxGeometry(3.72, 0.05, 0.05), riserLedMat);
  riserTrim.position.set(0, 1.655, -0.89);
  stageGroup.add(riserTrim);

  // Stage side stairs
  [-6.15, 6.15].forEach((sx) => {
    for (let step = 0; step < 3; step++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.34, 1.1), stageSkirtMat);
      s.position.set(sx + (sx > 0 ? step * 0.22 : -step * 0.22), 0.17 + (2 - step) * 0.33, 1.4);
      s.receiveShadow = true;
      stageGroup.add(s);
    }
  });

  // Front metallic safety barrier at z = 3.95
  const barrierGroup = new THREE.Group();
  barrierGroup.position.set(0, 0, 3.95);
  stageGroup.add(barrierGroup);

  const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 11.4, 12), metalMat);
  topRail.rotation.z = Math.PI / 2;
  topRail.position.set(0, 0.94, 0);
  topRail.castShadow = true;
  barrierGroup.add(topRail);

  const midRail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 11.4, 10), metalMat);
  midRail.rotation.z = Math.PI / 2;
  midRail.position.set(0, 0.54, 0);
  barrierGroup.add(midRail);

  for (let bx = -5.6; bx <= 5.65; bx += 1.4) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.94, 10), metalMat);
    post.position.set(bx, 0.47, 0);
    post.castShadow = true;
    barrierGroup.add(post);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.58), darkMetalMat);
    foot.position.set(bx, 0.02, 0.08);
    barrierGroup.add(foot);
  }

  // Stage monitor wedges along front lip
  [-3.2, -0.78, 0.78, 3.2].forEach((mx) => {
    const wedge = new THREE.Group();
    wedge.position.set(mx, 1.1, 2.58);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.38), darkMetalMat);
    box.rotation.x = -0.45;
    box.position.y = 0.14;
    box.castShadow = true;
    wedge.add(box);

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.32),
      new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.75 })
    );
    face.position.set(0, 0.122, 0);
    face.rotation.x = -Math.PI / 2;
    box.add(face);
    stageGroup.add(wedge);
  });

  // Guitar & Bass Speaker Amp Stacks (speaker cones pulse with audio energy!)
  const guitarCones = [];
  const bassCones = [];

  function buildAmpStack(x, z, rotY, accentColor, isBass, targetCones) {
    const stack = new THREE.Group();
    stack.position.set(x, 1.1, z);
    stack.rotation.y = rotY;
    stageGroup.add(stack);

    const cabMat = new THREE.MeshStandardMaterial({ color: 0x151822, roughness: 0.65 });
    const grilleMat = new THREE.MeshStandardMaterial({
      map: grilleTex,
      roughness: 0.75,
      metalness: 0.1,
    });
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0x0b0e16,
      roughness: 0.5,
      metalness: 0.2,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.6,
      roughness: 0.25,
    });

    const cabH = isBass ? 1.55 : 0.92;
    const cabs = isBass ? [0.775] : [0.46, 1.4];

    cabs.forEach((cy) => {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.12, cabH, 0.56), cabMat);
      cab.position.y = cy;
      cab.castShadow = true;
      cab.receiveShadow = true;
      stack.add(cab);

      const front = new THREE.Mesh(
        new THREE.PlaneGeometry(0.98, cabH - 0.12),
        grilleMat
      );
      front.position.set(0, cy, 0.285);
      stack.add(front);

      const rows = isBass ? 3 : 2;
      const cols = 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cone = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.08, 0.06, 18),
            coneMat
          );
          cone.rotation.x = Math.PI / 2;
          const cx = (c - 0.5) * 0.44;
          const coneY = cy + (r - (rows - 1) / 2) * (isBass ? 0.42 : 0.38);
          cone.position.set(cx, coneY, 0.27);
          stack.add(cone);
          targetCones.push(cone);
        }
      }
    });

    // Amp head on top
    const headY = isBass ? 1.72 : 2.04;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.32, 0.46), cabMat);
    head.position.y = headY;
    head.castShadow = true;
    stack.add(head);

    const faceplate = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.14, 0.02),
      isBass ? trimMat : new THREE.MeshStandardMaterial({ color: 0xd4a44a, metalness: 0.7, roughness: 0.28 })
    );
    faceplate.position.set(0, headY, 0.235);
    stack.add(faceplate);

    const powerLed = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), trimMat);
    powerLed.position.set(0.4, headY, 0.25);
    stack.add(powerLed);
  }

  buildAmpStack(-4.85, -1.7, 0.32, 0xf97316, false, guitarCones);
  buildAmpStack(4.85, -1.7, -0.32, 0x10b981, true, bassCones);

  // Overhead Aluminum Lighting Truss (4 towers + overhead spans)
  const trussGroup = new THREE.Group();
  stageGroup.add(trussGroup);

  function addTrussBoxBeam(p1, p2, thickness = 0.28) {
    const start = new THREE.Vector3(...p1);
    const end = new THREE.Vector3(...p2);
    const diff = end.clone().sub(start);
    const len = diff.length();
    const mid = start.clone().add(end).multiplyScalar(0.5);

    const beam = new THREE.Group();
    beam.position.copy(mid);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), diff.clone().normalize());

    const half = thickness / 2;
    [
      [-half, -half],
      [half, -half],
      [-half, half],
      [half, half],
    ].forEach(([cx, cz]) => {
      const chord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 6), metalMat);
      chord.position.set(cx, 0, cz);
      beam.add(chord);
    });

    const step = 0.65;
    const rings = Math.max(2, Math.floor(len / step));
    for (let i = 0; i <= rings; i++) {
      const y = -len / 2 + (i / rings) * len;
      const braceX = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, thickness, 6),
        metalMat
      );
      braceX.rotation.z = Math.PI / 2;
      braceX.position.set(0, y, half);
      const braceX2 = braceX.clone();
      braceX2.position.set(0, y, -half);

      const braceZ = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, thickness, 6),
        metalMat
      );
      braceZ.rotation.x = Math.PI / 2;
      braceZ.position.set(half, y, 0);
      const braceZ2 = braceZ.clone();
      braceZ2.position.set(-half, y, 0);
      beam.add(braceX, braceX2, braceZ, braceZ2);
    }

    trussGroup.add(beam);
  }

  // 4 corner towers + overhead perimeter truss
  addTrussBoxBeam([-5.45, 1.1, -3.75], [-5.45, 7.1, -3.75]);
  addTrussBoxBeam([5.45, 1.1, -3.75], [5.45, 7.1, -3.75]);
  addTrussBoxBeam([-5.45, 1.1, 2.55], [-5.45, 7.1, 2.55]);
  addTrussBoxBeam([5.45, 1.1, 2.55], [5.45, 7.1, 2.55]);

  addTrussBoxBeam([-5.6, 7.02, 2.55], [5.6, 7.02, 2.55]);
  addTrussBoxBeam([-5.6, 7.02, -3.75], [5.6, 7.02, -3.75]);
  addTrussBoxBeam([-5.45, 7.02, -3.75], [-5.45, 7.02, 2.55]);
  addTrussBoxBeam([5.45, 7.02, -3.75], [5.45, 7.02, 2.55]);

  // Lamp fixtures mounted overhead pointing at each musician
  const lampLenses = new Map();
  STEM_CONFIGS.forEach((cfg) => {
    const lx = cfg.pos[0] + cfg.lampOffset[0];
    const ly = 6.92;
    const lz = cfg.pos[2] + cfg.lampOffset[2];

    const can = new THREE.Group();
    can.position.set(lx, ly, lz);
    can.lookAt(cfg.pos[0], cfg.pos[1] + 0.5, cfg.pos[2]);

    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.24, 12),
      darkMetalMat
    );
    housing.rotation.x = Math.PI / 2;
    can.add(housing);

    const lensMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.color,
      emissiveIntensity: 1.6,
      roughness: 0.15,
    });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.105, 14), lensMat);
    lens.position.z = 0.125;
    can.add(lens);

    trussGroup.add(can);
    lampLenses.set(cfg.id, lensMat);
  });

  // Backstage LED Equalizer Backdrop Frame behind drum riser (z = -3.95)
  const backdropFrame = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 2.8, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x0b0e18, roughness: 0.7 })
  );
  backdropFrame.position.set(0, 4.05, -3.95);
  stageGroup.add(backdropFrame);

  const eqBars = new Map();
  STEM_CONFIGS.forEach((cfg, idx) => {
    const colX = (idx - 2) * 1.25;
    const barMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.color,
      emissiveIntensity: 0.7,
      roughness: 0.25,
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 2.2, 0.08), barMat);
    bar.position.set(colX, 3.05, -3.84);
    // Anchor scale from bottom: translate geometry up by half height
    bar.geometry.translate(0, 1.1, 0);
    bar.scale.y = 0.25;
    stageGroup.add(bar);
    eqBars.set(cfg.id, { mesh: bar, mat: barMat });
  });

  return {
    stageLedMat,
    riserLedMat,
    guitarCones,
    bassCones,
    lampLenses,
    eqBars,
    disposables,
  };
}

function buildCrowd(scene) {
  const crowdGroup = new THREE.Group();
  scene.add(crowdGroup);

  // Shared geometries for lightweight 32-person crowd
  const legGeom = new THREE.CapsuleGeometry(0.055, 0.42, 4, 8);
  const torsoGeom = new THREE.CapsuleGeometry(0.15, 0.32, 6, 10);
  const headGeom = new THREE.SphereGeometry(0.145, 12, 10);
  const armGeom = new THREE.CapsuleGeometry(0.042, 0.34, 4, 8);
  armGeom.translate(0, -0.17, 0);

  const darkPantsMat = new THREE.MeshStandardMaterial({
    color: 0x0f121d,
    roughness: 0.85,
  });

  const rows = [
    { count: 10, zBase: 4.82, spanX: 10.0 },
    { count: 11, zBase: 6.08, spanX: 11.2 },
    { count: 11, zBase: 7.42, spanX: 12.2 },
  ];

  const members = [];
  let index = 0;

  rows.forEach((row, rIdx) => {
    for (let i = 0; i < row.count; i++) {
      const t = row.count > 1 ? i / (row.count - 1) - 0.5 : 0;
      const jitterX = Math.sin(index * 1.97) * 0.24;
      const jitterZ = Math.cos(index * 2.43) * 0.26;
      const x = t * row.spanX + jitterX;
      const z = row.zBase + jitterZ;

      const root = new THREE.Group();
      root.position.set(x, 0, z);
      root.rotation.y = Math.PI + Math.atan2(x * 0.45, z);
      const scale = 0.9 + ((index * 17) % 10) * 0.022;
      root.scale.setScalar(scale);

      const shirtColor = CROWD_PALETTE[index % CROWD_PALETTE.length];
      const shirtMat = new THREE.MeshStandardMaterial({
        color: shirtColor,
        emissive: shirtColor,
        emissiveIntensity: 0.14,
        roughness: 0.62,
      });
      const headMat = new THREE.MeshStandardMaterial({
        color: SKIN_TONES[index % SKIN_TONES.length],
        roughness: 0.72,
      });

      const leftLeg = new THREE.Mesh(legGeom, darkPantsMat);
      leftLeg.position.set(-0.09, 0.3, 0);
      const rightLeg = new THREE.Mesh(legGeom, darkPantsMat);
      rightLeg.position.set(0.09, 0.3, 0);
      root.add(leftLeg, rightLeg);

      const bounceGroup = new THREE.Group();
      bounceGroup.position.set(0, 0.58, 0);
      root.add(bounceGroup);

      const torso = new THREE.Mesh(torsoGeom, shirtMat);
      torso.position.set(0, 0.25, 0);
      torso.scale.set(1.06, 1, 0.76);
      bounceGroup.add(torso);

      const head = new THREE.Mesh(headGeom, headMat);
      head.position.set(0, 0.62, 0);
      bounceGroup.add(head);

      const leftArmPivot = new THREE.Group();
      leftArmPivot.position.set(0.2, 0.41, 0);
      const leftArm = new THREE.Mesh(armGeom, shirtMat);
      leftArmPivot.add(leftArm);
      bounceGroup.add(leftArmPivot);

      const rightArmPivot = new THREE.Group();
      rightArmPivot.position.set(-0.2, 0.41, 0);
      const rightArm = new THREE.Mesh(armGeom, shirtMat);
      rightArmPivot.add(rightArm);
      bounceGroup.add(rightArmPivot);

      crowdGroup.add(root);
      members.push({
        root,
        bounceGroup,
        leftArmPivot,
        rightArmPivot,
        phase: index * 0.73 + rIdx * 0.45,
        armMode: index % 4,
      });

      index += 1;
    }
  });

  return members;
}

export class Stage3D {
  constructor(containerEl, options = {}) {
    if (!containerEl) {
      throw new Error('Stage3D requires a valid container element.');
    }

    this.containerEl = containerEl;
    this.onToggleStem = typeof options.onToggleStem === 'function' ? options.onToggleStem : null;
    this.onHoverStem = typeof options.onHoverStem === 'function' ? options.onHoverStem : null;

    this.availableStems = new Set(STEM_CONFIGS.map((c) => c.id));
    this.mutedMap = {};
    this.smoothedLevels = { vocals: 0, guitar: 0, bass: 0, drums: 0, keys: 0 };
    this.audioState = {
      isPlaying: false,
      stemLevels: {},
      totalEnergy: 0,
      bpm: 120,
      currentTime: 0,
    };

    this.currentView = 'overview';
    this.hoveredStemId = null;
    this.beatPhase = 0;
    this.idlePhase = 0;
    this.crowdEnergy = 0;
    this.disposed = false;
    this.isFallback = false;

    this._pulseTimers = {};
    this._activePointers = new Set();
    this._pointerDownInfo = null;
    this._multiTouchGuard = false;
    this._cameraAnim = null;
    this._userInteracting = false;

    // Motion preference tracking
    this._reducedMotionQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.reducedMotion = Boolean(this._reducedMotionQuery?.matches);
    this._onReducedMotionChange = (e) => {
      this.reducedMotion = Boolean(e.matches);
    };
    if (this._reducedMotionQuery) {
      if (this._reducedMotionQuery.addEventListener) {
        this._reducedMotionQuery.addEventListener('change', this._onReducedMotionChange);
      } else if (this._reducedMotionQuery.addListener) {
        this._reducedMotionQuery.addListener(this._onReducedMotionChange);
      }
    }

    try {
      this._initWebGL();
    } catch {
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer = null;
      }
      this._initFallback();
    }
  }

  _initWebGL() {
    const width = Math.max(this.containerEl.clientWidth || 800, 1);
    const height = Math.max(this.containerEl.clientHeight || 500, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    if (!this.renderer.getContext()) {
      throw new Error('WebGL context unavailable');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    this.containerEl.replaceChildren(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090b16);
    this.scene.fog = new THREE.FogExp2(0x090b16, 0.017);

    // PMREMGenerator + RoomEnvironment for crisp metallic & instrument reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    this._envRenderTarget = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this._envRenderTarget.texture;
    this.scene.environmentIntensity = 0.72;
    roomEnv.dispose();
    pmrem.dispose();

    // Camera & OrbitControls
    this.camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 120);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.minDistance = 4.6;
    this.controls.maxDistance = 24;
    this.controls.enablePan = true;

    this._onControlsStart = () => {
      this._userInteracting = true;
      this._cameraAnim = null;
    };
    this._onControlsEnd = () => {
      this._userInteracting = false;
    };
    this.controls.addEventListener('start', this._onControlsStart);
    this.controls.addEventListener('end', this._onControlsEnd);

    // Arena lights
    const hemi = new THREE.HemisphereLight(0x94a3e8, 0x171426, 0.68);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff3e6, 1.45);
    keyLight.position.set(4.5, 13.5, 9.5);
    keyLight.castShadow = true;
    const shadowSize = width < 640 ? 1024 : 2048;
    keyLight.shadow.mapSize.set(shadowSize, shadowSize);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 36;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -6;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x6366f1, 0.95);
    rimLight.position.set(-5.5, 9.0, -8.5);
    this.scene.add(rimLight);

    // Stage environment + textures
    this.stageProps = buildStageEnvironment(this.scene);
    this.spotBeamTex = createSpotBeamTexture();
    this.stageProps.disposables.push(this.spotBeamTex);

    // Musicians
    this.musicians = new Map();
    this.raycastTargets = [];

    STEM_CONFIGS.forEach((cfg) => {
      const rigOptions =
        cfg.id === 'vocals'
          ? { hairStyle: 'spiked', skinTone: SKIN_TONES[0] }
          : cfg.id === 'guitar'
          ? { hairStyle: 'swept', skinTone: SKIN_TONES[1] }
          : cfg.id === 'bass'
          ? { hairStyle: 'beanie', skinTone: SKIN_TONES[3] }
          : cfg.id === 'drums'
          ? { seated: true, hairStyle: 'headband', skinTone: SKIN_TONES[2] }
          : { hairStyle: 'tousled', skinTone: SKIN_TONES[4] };

      const rig = createMusicianRig(cfg, rigOptions);
      let additions = {};
      if (cfg.id === 'vocals') additions = buildVocalsAdditions(rig);
      else if (cfg.id === 'guitar') additions = buildGuitarOrBassAdditions(rig, cfg, false);
      else if (cfg.id === 'bass') additions = buildGuitarOrBassAdditions(rig, cfg, true);
      else if (cfg.id === 'drums') additions = buildDrumsAdditions(rig, cfg);
      else if (cfg.id === 'keys') additions = buildKeysAdditions(rig, cfg);

      const interactive = attachInteractiveStageElements(rig, cfg, this.spotBeamTex);
      this.scene.add(rig.root);
      this.scene.add(interactive.beamPivot);
      this.scene.add(interactive.spotLight);
      this.scene.add(interactive.spotLight.target);

      this.raycastTargets.push(interactive.hitMesh, interactive.labelSprite);

      this.musicians.set(cfg.id, {
        cfg,
        rig,
        additions,
        interactive,
      });
    });

    // 32-person dancing crowd
    this.crowdMembers = buildCrowd(this.scene);

    // Raycaster & pointer interaction (with drag-vs-tap guard)
    this.raycaster = new THREE.Raycaster();
    this.pointerNDC = new THREE.Vector2();
    this._bindPointerEvents(canvas);

    // Resize listener + ResizeObserver
    this._onWindowResize = () => this.resize();
    window.addEventListener('resize', this._onWindowResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this.containerEl);
    }

    // Initial framing
    const initialFrame = this._computeFramedCamera('overview', width, height);
    this.camera.fov = initialFrame.fov;
    this.camera.aspect = width / height;
    this.camera.position.copy(initialFrame.pos);
    this.controls.target.copy(initialFrame.target);
    this.camera.updateProjectionMatrix();
    this.controls.update();

    this._refreshMusicianVisualStates();
    this._lastFrameTime = performance.now();
    this._startLoop();
  }

  _bindPointerEvents(canvas) {
    const pickStemFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      const hits = this.raycaster.intersectObjects(this.raycastTargets, false);
      if (!hits.length) return null;
      return hits[0].object.userData?.stemId ?? null;
    };

    this._onPointerDown = (e) => {
      this._activePointers.add(e.pointerId);
      if (this._activePointers.size > 1) {
        this._multiTouchGuard = true;
        this._pointerDownInfo = null;
        return;
      }

      const isPrimary = e.pointerType === 'touch' ? e.button <= 0 : e.button === 0;
      if (!isPrimary) return;

      this._multiTouchGuard = false;
      this._pointerDownInfo = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      };
    };

    this._onPointerMove = (e) => {
      if (e.pointerType === 'touch') return;
      if (this._activePointers.size > 0) return;

      const hitId = pickStemFromEvent(e);
      const nextHovered = hitId && this.availableStems.has(hitId) ? hitId : null;
      if (nextHovered !== this.hoveredStemId) {
        this.hoveredStemId = nextHovered;
        canvas.style.cursor = nextHovered ? 'pointer' : '';
        this._refreshMusicianVisualStates();
        this.onHoverStem?.(nextHovered);
      }
    };

    this._onPointerUp = (e) => {
      this._activePointers.delete(e.pointerId);
      const down = this._pointerDownInfo;
      if (this._activePointers.size === 0) {
        this._pointerDownInfo = null;
      }
      if (!down || down.pointerId !== e.pointerId || this._multiTouchGuard) {
        if (this._activePointers.size === 0) this._multiTouchGuard = false;
        return;
      }

      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist < 8) {
        const stemId = pickStemFromEvent(e);
        if (stemId) {
          if (this.availableStems.has(stemId)) {
            this.onToggleStem?.(stemId);
          } else {
            this._pulseTimers[stemId] = 0.4;
          }
        }
      }
    };

    this._onPointerCancel = (e) => {
      this._activePointers.delete(e.pointerId);
      if (this._pointerDownInfo?.pointerId === e.pointerId) {
        this._pointerDownInfo = null;
      }
      if (this._activePointers.size === 0) {
        this._multiTouchGuard = false;
      }
    };

    this._onPointerLeave = () => {
      if (this.hoveredStemId !== null) {
        this.hoveredStemId = null;
        canvas.style.cursor = '';
        this._refreshMusicianVisualStates();
        this.onHoverStem?.(null);
      }
    };

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerCancel);
    canvas.addEventListener('pointerleave', this._onPointerLeave);
  }

  _initFallback() {
    this.isFallback = true;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'width: 100%',
      'height: 100%',
      'min-height: 280px',
      'display: flex',
      'flex-direction: column',
      'justify-content: space-between',
      'align-items: center',
      'padding: 16px',
      'box-sizing: border-box',
      'background: radial-gradient(circle at 50% 25%, #1e2444 0%, #090b16 75%)',
      'color: #f8fafc',
      'font-family: system-ui, -apple-system, sans-serif',
      'user-select: none',
      'overflow: hidden',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Live-Bühne (2D-Ansicht)';
    title.style.cssText = 'font-size: 13px; letter-spacing: 0.06em; opacity: 0.72; text-transform: uppercase;';
    wrapper.appendChild(title);

    const stageRow = document.createElement('div');
    stageRow.style.cssText = [
      'display: flex',
      'flex-wrap: wrap',
      'justify-content: center',
      'align-items: flex-end',
      'gap: 12px',
      'width: 100%',
      'max-width: 760px',
      'padding: 18px 12px',
      'border-radius: 16px',
      'background: linear-gradient(180deg, rgba(25,31,56,0.65), rgba(14,17,32,0.92))',
      'border: 1px solid rgba(148,163,184,0.2)',
    ].join(';');

    this._fallbackCards = new Map();
    STEM_CONFIGS.forEach((cfg) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = [
        'display: flex',
        'flex-direction: column',
        'align-items: center',
        'gap: 8px',
        'padding: 12px 14px',
        'min-width: 108px',
        'border-radius: 14px',
        `border: 2px solid ${cfg.color}`,
        'background: rgba(15, 23, 42, 0.85)',
        'color: #f8fafc',
        'cursor: pointer',
        'transition: transform 0.16s ease, opacity 0.16s ease, border-color 0.16s ease',
      ].join(';');

      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 64 76');
      icon.setAttribute('width', '54');
      icon.setAttribute('height', '64');
      icon.innerHTML = `
        <ellipse cx="32" cy="68" rx="22" ry="5" fill="${cfg.color}" opacity="0.38" />
        <circle cx="32" cy="18" r="10" fill="#e2e8f0" />
        <rect x="20" y="30" width="24" height="26" rx="10" fill="${cfg.color}" />
        <rect x="23" y="54" width="7" height="14" rx="3" fill="#334155" />
        <rect x="34" y="54" width="7" height="14" rx="3" fill="#334155" />
      `;

      const nameEl = document.createElement('span');
      nameEl.textContent = cfg.label;
      nameEl.style.cssText = 'font-size: 13px; font-weight: 700;';

      const badgeEl = document.createElement('span');
      badgeEl.style.cssText = 'font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; display: none;';

      btn.append(icon, nameEl, badgeEl);
      btn.addEventListener('click', () => {
        if (this.availableStems.has(cfg.id)) {
          this.onToggleStem?.(cfg.id);
        }
      });
      btn.addEventListener('pointerenter', () => {
        if (this.availableStems.has(cfg.id)) {
          this.hoveredStemId = cfg.id;
          this.onHoverStem?.(cfg.id);
        }
      });
      btn.addEventListener('pointerleave', () => {
        if (this.hoveredStemId === cfg.id) {
          this.hoveredStemId = null;
          this.onHoverStem?.(null);
        }
      });

      stageRow.appendChild(btn);
      this._fallbackCards.set(cfg.id, { btn, icon, badgeEl, cfg });
    });

    const crowdStrip = document.createElement('div');
    crowdStrip.textContent = 'Publikum vor der Bühne';
    crowdStrip.style.cssText = 'font-size: 12px; opacity: 0.6; letter-spacing: 0.04em;';

    wrapper.append(stageRow, crowdStrip);
    this._fallbackEl = wrapper;
    this.containerEl.replaceChildren(wrapper);
    this._refreshFallbackState();
  }

  _refreshFallbackState() {
    if (!this.isFallback || !this._fallbackCards) return;
    this._fallbackCards.forEach(({ btn, icon, badgeEl, cfg }, id) => {
      const available = this.availableStems.has(id);
      const muted = Boolean(this.mutedMap[id]);
      const level = clamp01(this.audioState.stemLevels?.[id]);

      if (!available) {
        btn.style.opacity = '0.4';
        btn.style.borderColor = '#475569';
        btn.style.cursor = 'default';
        badgeEl.style.display = 'inline-block';
        badgeEl.style.background = '#475569';
        badgeEl.textContent = 'PAUSE';
        icon.style.transform = 'scale(0.95)';
      } else if (muted) {
        btn.style.opacity = '0.68';
        btn.style.borderColor = '#ef4444';
        btn.style.cursor = 'pointer';
        badgeEl.style.display = 'inline-block';
        badgeEl.style.background = '#ef4444';
        badgeEl.textContent = 'AUS';
        icon.style.transform = 'scale(0.96)';
      } else {
        btn.style.opacity = '1';
        btn.style.borderColor = cfg.color;
        btn.style.cursor = 'pointer';
        badgeEl.style.display = 'none';
        const lift = this.reducedMotion ? 0 : level * 6;
        icon.style.transform = `translateY(${-lift.toFixed(1)}px)`;
      }
    });
  }

  _computeFramedCamera(viewName, width, height) {
    const preset = CAMERA_VIEWS[viewName] || CAMERA_VIEWS.overview;
    const aspect = Math.max(width / Math.max(height, 1), 0.35);
    const isNarrowViewport = width < 640 || aspect < 1.15;
    const baseFov = isNarrowViewport ? 51 : 44;

    const offset = preset.pos.clone().sub(preset.target);
    const baseDist = offset.length();
    const halfFovRad = THREE.MathUtils.degToRad(baseFov * 0.5);
    const visibleHalfWidth = baseDist * aspect * Math.tan(halfFovRad);

    let scale = 1;
    if (visibleHalfWidth < preset.requiredHalfWidth) {
      scale = THREE.MathUtils.clamp(preset.requiredHalfWidth / visibleHalfWidth, 1, 1.75);
    } else if (width < 640 && aspect >= 1.15) {
      // Extra breathing margin on landscape mobile
      scale = 1.1;
    }

    const pos = preset.target.clone().add(offset.multiplyScalar(scale));
    return {
      fov: baseFov,
      pos,
      target: preset.target.clone(),
    };
  }

  setAvailableStems(stemIds) {
    if (Array.isArray(stemIds)) {
      this.availableStems = new Set(stemIds);
    } else {
      this.availableStems = new Set();
    }

    if (this.hoveredStemId && !this.availableStems.has(this.hoveredStemId)) {
      this.hoveredStemId = null;
      if (this.renderer?.domElement) {
        this.renderer.domElement.style.cursor = '';
      }
      this.onHoverStem?.(null);
    }

    this._refreshMusicianVisualStates();
    this._refreshFallbackState();
  }

  setMutedState(mutedMap = {}) {
    const normalized = {};
    STEM_CONFIGS.forEach(({ id }) => {
      normalized[id] = Boolean(mutedMap?.[id]);
    });
    this.mutedMap = normalized;
    this._refreshMusicianVisualStates();
    this._refreshFallbackState();
  }

  setAudioState({ isPlaying = false, stemLevels = {}, totalEnergy = 0, bpm = 120, currentTime = 0 } = {}) {
    this.audioState = {
      isPlaying: Boolean(isPlaying),
      stemLevels: stemLevels || {},
      totalEnergy: clamp01(totalEnergy),
      bpm: Number.isFinite(bpm) && bpm > 30 && bpm < 260 ? bpm : 120,
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
    };
    if (this.isFallback) {
      this._refreshFallbackState();
    }
  }

  setCameraView(viewName) {
    if (!CAMERA_VIEWS[viewName]) return;
    this.currentView = viewName;

    if (this.isFallback) {
      if (this._fallbackEl) {
        this._fallbackEl.style.transform = viewName === 'band' ? 'scale(1.03)' : 'scale(1)';
      }
      return;
    }

    const width = Math.max(this.containerEl.clientWidth || 800, 1);
    const height = Math.max(this.containerEl.clientHeight || 500, 1);
    const framed = this._computeFramedCamera(viewName, width, height);

    if (this.reducedMotion) {
      this._cameraAnim = null;
      this.camera.fov = framed.fov;
      this.camera.position.copy(framed.pos);
      this.controls.target.copy(framed.target);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      return;
    }

    this._cameraAnim = {
      startPos: this.camera.position.clone(),
      endPos: framed.pos,
      startTarget: this.controls.target.clone(),
      endTarget: framed.target,
      startFov: this.camera.fov,
      endFov: framed.fov,
      progress: 0,
      duration: 0.65,
    };
  }

  resize() {
    if (this.disposed || this.isFallback || !this.renderer) return;
    const width = this.containerEl.clientWidth;
    const height = this.containerEl.clientHeight;
    if (!width || !height) return;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;

    const framed = this._computeFramedCamera(this.currentView, width, height);
    this.camera.fov = framed.fov;
    if (!this._userInteracting && !this._cameraAnim) {
      this.camera.position.copy(framed.pos);
      this.controls.target.copy(framed.target);
    } else if (this._cameraAnim) {
      this._cameraAnim.endPos.copy(framed.pos);
      this._cameraAnim.endTarget.copy(framed.target);
      this._cameraAnim.endFov = framed.fov;
    }

    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  _refreshMusicianVisualStates() {
    if (this.isFallback || !this.musicians) return;

    this.musicians.forEach(({ cfg, rig, additions, interactive }, id) => {
      const available = this.availableStems.has(id);
      const muted = Boolean(this.mutedMap[id]);
      const hovered = this.hoveredStemId === id;
      const active = available && !muted;

      // Update nameplate sprite texture only when discrete state changes
      const stateKey = `${available ? 1 : 0}|${muted ? 1 : 0}|${hovered ? 1 : 0}`;
      if (interactive.labelStateKey !== stateKey) {
        interactive.labelStateKey = stateKey;
        drawNameplateCanvas(interactive.labelCanvas, cfg, { available, muted, hovered });
        interactive.labelTex.needsUpdate = true;
      }

      interactive.labelSprite.scale.set(
        hovered && available ? 2.55 : 2.35,
        hovered && available ? 0.56 : 0.52,
        1
      );

      // Spotlight & volumetric cone
      interactive.beamPivot.visible = active;
      if (!active) {
        interactive.spotLight.intensity = 0;
      }

      // Truss lamp lens
      const lensMat = this.stageProps?.lampLenses?.get(id);
      if (lensMat) {
        lensMat.emissiveIntensity = active ? 1.6 : 0.06;
      }

      // Musician silhouette material brightness
      if (!available) {
        rig.materials.accent.color.setHex(0x475569);
        rig.materials.accent.emissiveIntensity = 0.02;
        rig.materials.jacket.color.setHex(0x111521);
        rig.materials.skin.color.copy(rig.baseSkinColor).multiplyScalar(0.55);
        interactive.ringMat.color.setHex(0x334155);
        interactive.ringMat.emissive.setHex(0x1e293b);
        interactive.ringMat.emissiveIntensity = 0.25;
        interactive.haloMat.opacity = 0.04;
      } else if (muted) {
        rig.materials.accent.color.copy(rig.accentColor).multiplyScalar(0.32);
        rig.materials.accent.emissiveIntensity = 0.04;
        rig.materials.jacket.color.setHex(0x141724);
        rig.materials.skin.color.copy(rig.baseSkinColor).multiplyScalar(0.75);
        interactive.ringMat.color.setHex(0x7f1d1d);
        interactive.ringMat.emissive.setHex(hovered ? 0xef4444 : 0x522128);
        interactive.ringMat.emissiveIntensity = hovered ? 0.85 : 0.35;
        interactive.haloMat.color.setHex(0xef4444);
        interactive.haloMat.opacity = hovered ? 0.18 : 0.05;
      } else {
        rig.materials.accent.color.copy(rig.accentColor);
        rig.materials.accent.emissiveIntensity = hovered ? 0.45 : 0.2;
        rig.materials.jacket.color.setHex(0x1a1e2e);
        rig.materials.skin.color.copy(rig.baseSkinColor);
        interactive.ringMat.color.copy(rig.accentColor);
        interactive.ringMat.emissive.copy(rig.accentColor);
        interactive.ringMat.emissiveIntensity = hovered ? 1.8 : 0.95;
        interactive.haloMat.color.copy(rig.accentColor);
        interactive.haloMat.opacity = hovered ? 0.42 : 0.24;
      }

      if (additions.instrumentMat) {
        additions.instrumentMat.color
          .copy(rig.accentColor)
          .multiplyScalar(active ? 1.0 : muted ? 0.4 : 0.28);
      }
      if (additions.ledMat) {
        additions.ledMat.emissiveIntensity = active ? 1.2 : 0.05;
      }
    });
  }

  _startLoop() {
    const tick = (now) => {
      if (this.disposed) return;
      this._rafId = requestAnimationFrame(tick);

      const rawDt = (now - this._lastFrameTime) / 1000;
      this._lastFrameTime = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      this._update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _update(dt) {
    // Camera transition
    if (this._cameraAnim) {
      this._cameraAnim.progress = Math.min(
        1,
        this._cameraAnim.progress + dt / this._cameraAnim.duration
      );
      const t = this._cameraAnim.progress;
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this._cameraAnim.startPos, this._cameraAnim.endPos, ease);
      this.controls.target.lerpVectors(
        this._cameraAnim.startTarget,
        this._cameraAnim.endTarget,
        ease
      );
      this.camera.fov = THREE.MathUtils.lerp(
        this._cameraAnim.startFov,
        this._cameraAnim.endFov,
        ease
      );
      this.camera.updateProjectionMatrix();
      if (t >= 1) {
        this._cameraAnim = null;
      }
    }

    this.controls.update();
    // Clamp OrbitControls target so users never pan the stage off-screen
    this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -4.5, 4.5);
    this.controls.target.y = THREE.MathUtils.clamp(this.controls.target.y, 0.7, 4.2);
    this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, -3.5, 5.5);

    const { isPlaying, stemLevels, totalEnergy, bpm } = this.audioState;
    const motionScale = this.reducedMotion ? 0.2 : 1.0;

    // Advance beat phase continuously without jumps on seek/pause
    this.idlePhase += dt * 1.4;
    if (isPlaying) {
      this.beatPhase += dt * (bpm / 60) * Math.PI * 2;
    }

    let anyActiveUnmuted = false;
    STEM_CONFIGS.forEach(({ id }) => {
      const available = this.availableStems.has(id);
      const muted = Boolean(this.mutedMap[id]);
      const active = available && !muted;
      if (active) anyActiveUnmuted = true;

      const raw = isPlaying && active ? clamp01(stemLevels?.[id]) : 0;
      const prev = this.smoothedLevels[id] || 0;
      // Snappy attack, musical decay
      const rate = raw > prev ? 18 : 7.5;
      this.smoothedLevels[id] = prev + (raw - prev) * Math.min(1, dt * rate);
    });

    // Update each musician rig, spotlight intensity, and backdrop EQ meter
    this.musicians.forEach((entry, id) => {
      const { rig, additions, interactive } = entry;
      const available = this.availableStems.has(id);
      const muted = Boolean(this.mutedMap[id]);
      const active = available && !muted;
      const hovered = this.hoveredStemId === id;
      const level = this.smoothedLevels[id] || 0;
      const playingActive = isPlaying && active;

      // Subtle unavailable tap pulse
      let pulseBoost = 0;
      if (this._pulseTimers[id] > 0) {
        this._pulseTimers[id] = Math.max(0, this._pulseTimers[id] - dt);
        pulseBoost = Math.sin((this._pulseTimers[id] / 0.4) * Math.PI) * 0.45;
      }

      if (active) {
        const energyBoost = playingActive ? level : 0;
        interactive.spotLight.intensity = 2.6 + energyBoost * 2.5 * motionScale + (hovered ? 0.7 : 0);
        interactive.beamMat.opacity = 0.14 + energyBoost * 0.16 * motionScale + (hovered ? 0.06 : 0);
        interactive.ringMat.emissiveIntensity =
          (hovered ? 1.85 : 0.9) + energyBoost * 1.15 * motionScale;
      } else if (!available && pulseBoost > 0) {
        interactive.ringMat.emissiveIntensity = 0.25 + pulseBoost;
      }

      // Backstage EQ bar
      const eq = this.stageProps?.eqBars?.get(id);
      if (eq) {
        const targetBar = active
          ? isPlaying
            ? 0.12 + level * 0.88
            : 0.22
          : 0.04;
        eq.mesh.scale.y += (targetBar - eq.mesh.scale.y) * Math.min(1, dt * 14);
        eq.mat.emissiveIntensity = active ? 0.45 + level * 0.9 * motionScale : 0.04;
      }

      this._animateMusicianPose(id, entry, dt, {
        active,
        available,
        muted,
        playingActive,
        level,
        motionScale,
      });
    });

    // Speaker cone excursions (guitar left stack, bass right stack)
    const guitarEnergy = (this.smoothedLevels.guitar || 0) * motionScale;
    const bassEnergy = (this.smoothedLevels.bass || 0) * motionScale;
    this.stageProps.guitarCones.forEach((cone, idx) => {
      const pulse = Math.sin(this.beatPhase * 2 + idx) * 0.012 * guitarEnergy;
      cone.position.z = 0.27 + Math.abs(pulse) + guitarEnergy * 0.015;
    });
    this.stageProps.bassCones.forEach((cone, idx) => {
      const pulse = Math.sin(this.beatPhase + idx * 0.4) * 0.016 * bassEnergy;
      cone.position.z = 0.27 + Math.abs(pulse) + bassEnergy * 0.022;
    });

    // Stage LED strips breathe subtly with overall energy
    const stageGlow = isPlaying && anyActiveUnmuted ? 0.75 + totalEnergy * 1.1 * motionScale : 0.45;
    this.stageProps.stageLedMat.emissiveIntensity = stageGlow;
    this.stageProps.riserLedMat.emissiveIntensity =
      this.availableStems.has('drums') && !this.mutedMap.drums
        ? 0.65 + (this.smoothedLevels.drums || 0) * 1.4 * motionScale
        : 0.15;

    // 32-person crowd animation
    const targetCrowd = isPlaying && anyActiveUnmuted ? 0.2 + clamp01(totalEnergy) * 0.8 : 0;
    this.crowdEnergy += (targetCrowd - this.crowdEnergy) * Math.min(1, dt * 4.5);

    for (let i = 0; i < this.crowdMembers.length; i++) {
      const m = this.crowdMembers[i];
      const e = this.crowdEnergy * motionScale;
      const bounce = Math.abs(Math.sin(this.beatPhase * 0.5 + m.phase)) * 0.16 * e;
      const sway = Math.sin(this.beatPhase * 0.25 + m.phase) * 0.06 * e;

      m.bounceGroup.position.y = 0.58 + bounce;
      m.bounceGroup.rotation.z = sway;

      // Raise & wave arms enthusiastically as energy grows
      const wave = Math.sin(this.beatPhase * 0.5 + m.phase * 1.3) * 0.28 * e;
      if (e < 0.04) {
        // Calm idle arms at sides
        m.leftArmPivot.rotation.z += (0.12 - m.leftArmPivot.rotation.z) * Math.min(1, dt * 6);
        m.rightArmPivot.rotation.z += (-0.12 - m.rightArmPivot.rotation.z) * Math.min(1, dt * 6);
        m.leftArmPivot.rotation.x += (0 - m.leftArmPivot.rotation.x) * Math.min(1, dt * 6);
        m.rightArmPivot.rotation.x += (0 - m.rightArmPivot.rotation.x) * Math.min(1, dt * 6);
      } else {
        const raisedLeft = m.armMode === 0 || m.armMode === 1 || m.armMode === 3;
        const raisedRight = m.armMode === 0 || m.armMode === 2 || m.armMode === 3;
        const targetLZ = raisedLeft ? Math.PI * (0.78 + 0.12 * e) + wave : 0.22 + wave * 0.3;
        const targetRZ = raisedRight ? -Math.PI * (0.78 + 0.12 * e) + wave : -0.22 + wave * 0.3;

        m.leftArmPivot.rotation.z += (targetLZ - m.leftArmPivot.rotation.z) * Math.min(1, dt * 10);
        m.rightArmPivot.rotation.z += (targetRZ - m.rightArmPivot.rotation.z) * Math.min(1, dt * 10);
        m.leftArmPivot.rotation.x = -0.25 * e;
        m.rightArmPivot.rotation.x = -0.25 * e;
      }
    }
  }

  _animateMusicianPose(id, entry, dt, { active, playingActive, level, motionScale }) {
    const { rig, additions } = entry;
    const lerpRate = Math.min(1, dt * 12);
    const beat = this.beatPhase;

    // Muted or unavailable: calm, slightly slouched silhouette
    if (!active) {
      rig.bodyPivot.position.y += ((id === 'drums' ? 0.6 : 0.78) - rig.bodyPivot.position.y) * lerpRate;
      rig.bodyPivot.rotation.x += (0.12 - rig.bodyPivot.rotation.x) * lerpRate;
      rig.bodyPivot.rotation.z += (0 - rig.bodyPivot.rotation.z) * lerpRate;
      rig.headPivot.rotation.x += (0.24 - rig.headPivot.rotation.x) * lerpRate;
      rig.headPivot.rotation.z += (0 - rig.headPivot.rotation.z) * lerpRate;

      rig.leftArm.shoulderPivot.rotation.set(0.08, 0, 0.12);
      rig.leftArm.elbowPivot.rotation.set(-0.22, 0, 0);
      rig.rightArm.shoulderPivot.rotation.set(0.08, 0, -0.12);
      rig.rightArm.elbowPivot.rotation.set(-0.22, 0, 0);
      return;
    }

    const baseBodyY = id === 'drums' ? 0.64 : 0.82;
    const groove = playingActive ? (0.25 + level * 0.75) * motionScale : 0.08 * motionScale;

    if (id === 'vocals') {
      const bob = Math.sin(beat * 0.5) * 0.03 * groove;
      const lean = playingActive ? -0.05 + Math.sin(beat * 0.25) * 0.08 * groove : 0;
      rig.bodyPivot.position.y += (baseBodyY + Math.abs(bob) - rig.bodyPivot.position.y) * lerpRate;
      rig.bodyPivot.rotation.x += (lean - rig.bodyPivot.rotation.x) * lerpRate;
      rig.bodyPivot.rotation.z += (Math.sin(beat * 0.25) * 0.06 * groove - rig.bodyPivot.rotation.z) * lerpRate;

      rig.headPivot.rotation.x += ((-0.12 * level * motionScale + Math.sin(beat) * 0.08 * groove) - rig.headPivot.rotation.x) * lerpRate;
      rig.headPivot.rotation.z += (Math.cos(beat * 0.5) * 0.07 * groove - rig.headPivot.rotation.z) * lerpRate;

      // Right arm brings mic up to mouth during vocal energy (+rotZ moves -Y inward toward +X)
      const singLift = playingActive ? 0.45 + level * 0.55 : 0.35;
      rig.rightArm.shoulderPivot.rotation.x += (-0.65 - singLift * 0.45 - rig.rightArm.shoulderPivot.rotation.x) * lerpRate;
      rig.rightArm.shoulderPivot.rotation.z += (0.22 - rig.rightArm.shoulderPivot.rotation.z) * lerpRate;
      rig.rightArm.elbowPivot.rotation.x += (-1.15 - singLift * 0.35 - rig.rightArm.elbowPivot.rotation.x) * lerpRate;

      // Left arm gestures toward audience on big vocal peaks
      const gesture = playingActive ? level * 0.9 * motionScale : 0;
      rig.leftArm.shoulderPivot.rotation.x += (-0.25 - gesture * 0.65 - rig.leftArm.shoulderPivot.rotation.x) * lerpRate;
      rig.leftArm.shoulderPivot.rotation.z += (0.22 + gesture * 0.55 - rig.leftArm.shoulderPivot.rotation.z) * lerpRate;
      rig.leftArm.elbowPivot.rotation.x += (-0.45 - Math.sin(beat * 0.5) * 0.25 * groove - rig.leftArm.elbowPivot.rotation.x) * lerpRate;
    } else if (id === 'guitar') {
      const rock = Math.sin(beat * 0.5) * 0.1 * groove;
      rig.bodyPivot.position.y += (baseBodyY + Math.abs(Math.sin(beat)) * 0.025 * groove - rig.bodyPivot.position.y) * lerpRate;
      rig.bodyPivot.rotation.x += (0.06 + Math.cos(beat * 0.5) * 0.06 * groove - rig.bodyPivot.rotation.x) * lerpRate;
      rig.bodyPivot.rotation.z += (rock - rig.bodyPivot.rotation.z) * lerpRate;
      rig.headPivot.rotation.x += (Math.sin(beat) * 0.12 * groove - rig.headPivot.rotation.x) * lerpRate;
      rig.headPivot.rotation.z += (-rock * 0.5 - rig.headPivot.rotation.z) * lerpRate;

      // Left hand grips neck (+X side)
      rig.leftArm.shoulderPivot.rotation.set(-0.62, 0.25, 0.42);
      rig.leftArm.elbowPivot.rotation.set(-0.75 + Math.sin(beat * 0.25) * 0.12 * groove, 0, -0.3);

      // Right forearm strums rhythmically across strings
      const strum = playingActive ? Math.sin(beat * 2) * (0.25 + level * 0.42) * motionScale : 0;
      rig.rightArm.shoulderPivot.rotation.set(-0.48, -0.35, -0.12);
      rig.rightArm.elbowPivot.rotation.set(-1.1 + strum, 0, 0.55);
    } else if (id === 'bass') {
      // Deep steady pocket groove locked to bass & BPM
      const nod = Math.sin(beat) * 0.14 * groove;
      const bounce = Math.abs(Math.sin(beat * 0.5)) * 0.035 * groove;
      rig.bodyPivot.position.y += (baseBodyY + bounce - rig.bodyPivot.position.y) * lerpRate;
      rig.bodyPivot.rotation.x += (0.05 + Math.sin(beat * 0.5) * 0.05 * groove - rig.bodyPivot.rotation.x) * lerpRate;
      rig.bodyPivot.rotation.z += (Math.sin(beat * 0.25) * 0.07 * groove - rig.bodyPivot.rotation.z) * lerpRate;
      rig.headPivot.rotation.x += (nod - rig.headPivot.rotation.x) * lerpRate;

      // Left hand grooves along bass neck
      rig.leftArm.shoulderPivot.rotation.set(-0.68, 0.28, 0.5);
      rig.leftArm.elbowPivot.rotation.set(-0.62 + Math.sin(beat * 0.25) * 0.1 * groove, 0, -0.25);

      // Right hand plucks steadily over pickups
      const pluck = playingActive ? Math.sin(beat * 1.0) * (0.14 + level * 0.25) * motionScale : 0;
      rig.rightArm.shoulderPivot.rotation.set(-0.45, -0.35, -0.1);
      rig.rightArm.elbowPivot.rotation.set(-1.05 + pluck, 0, 0.52);
    } else if (id === 'drums') {
      rig.bodyPivot.position.y += (baseBodyY - rig.bodyPivot.position.y) * lerpRate;
      rig.bodyPivot.rotation.x += (0.1 + Math.sin(beat) * 0.06 * groove - rig.bodyPivot.rotation.x) * lerpRate;
      rig.bodyPivot.rotation.z += (Math.sin(beat * 0.5) * 0.06 * groove - rig.bodyPivot.rotation.z) * lerpRate;
      rig.headPivot.rotation.x += (Math.sin(beat) * 0.16 * groove - rig.headPivot.rotation.x) * lerpRate;

      // Brisk alternating drumming strokes
      const strokeL = playingActive ? Math.sin(beat * 2) * (0.28 + level * 0.42) * motionScale : 0;
      const strokeR = playingActive ? Math.sin(beat * 2 + Math.PI) * (0.28 + level * 0.42) * motionScale : 0;

      rig.leftArm.shoulderPivot.rotation.set(-0.72 + strokeL * 0.35, -0.18, 0.18);
      rig.leftArm.elbowPivot.rotation.set(-0.92 + strokeL, 0, 0);

      rig.rightArm.shoulderPivot.rotation.set(-0.74 + strokeR * 0.35, 0.18, -0.18);
      rig.rightArm.elbowPivot.rotation.set(-0.92 + strokeR, 0, 0);

      // Kick drum resonant head pulse + cymbal wobble on strong drum transients
      if (additions.kickGroup) {
        const kickPulse = playingActive ? Math.max(0, Math.sin(beat)) * level * 0.09 * motionScale : 0;
        additions.kickGroup.scale.set(1 + kickPulse * 0.5, 1 + kickPulse * 0.5, 1 + kickPulse);
        additions.hihatTop.position.y = 0.99 + (playingActive ? Math.abs(Math.sin(beat * 2)) * 0.025 * level * motionScale : 0);

        if (playingActive && level > 0.58 && additions.lastTransient <= 0.58) {
          additions.cymbalWobbleL = 0.9;
          additions.cymbalWobbleR = 1.0;
        }
        additions.lastTransient = level;

        additions.cymbalWobbleL = Math.max(0, additions.cymbalWobbleL - dt * 2.2);
        additions.cymbalWobbleR = Math.max(0, additions.cymbalWobbleR - dt * 1.8);

        additions.cymbalLeft.rotation.x = 0.2 + Math.sin(this.idlePhase * 18) * additions.cymbalWobbleL * 0.24 * motionScale;
        additions.cymbalRight.rotation.x = 0.2 + Math.cos(this.idlePhase * 16) * additions.cymbalWobbleR * 0.24 * motionScale;
      }
    } else if (id === 'keys') {
      const sway = Math.sin(beat * 0.25) * 0.09 * groove;
      rig.bodyPivot.position.y += (baseBodyY + Math.abs(Math.sin(beat * 0.5)) * 0.02 * groove - rig.bodyPivot.position.y) * lerpRate;
      rig.bodyPivot.rotation.z += (sway - rig.bodyPivot.rotation.z) * lerpRate;
      rig.bodyPivot.rotation.x += (0.08 - rig.bodyPivot.rotation.x) * lerpRate;
      rig.headPivot.rotation.z += (-sway * 0.5 - rig.headPivot.rotation.z) * lerpRate;
      rig.headPivot.rotation.x += (0.06 + Math.sin(beat * 0.5) * 0.09 * groove - rig.headPivot.rotation.x) * lerpRate;

      // Alternating arpeggio motion across dual synth tiers
      const arpL = playingActive ? Math.sin(beat * 1.5) * 0.22 * (0.4 + level * 0.6) * motionScale : 0;
      const arpR = playingActive ? Math.cos(beat * 1.5) * 0.22 * (0.4 + level * 0.6) * motionScale : 0;
      const tapL = playingActive ? Math.sin(beat * 3) * 0.16 * level * motionScale : 0;
      const tapR = playingActive ? Math.sin(beat * 3 + Math.PI) * 0.16 * level * motionScale : 0;

      rig.leftArm.shoulderPivot.rotation.set(-0.78, 0, 0.12 + arpL);
      rig.leftArm.elbowPivot.rotation.set(-0.92 + tapL, 0, 0);

      rig.rightArm.shoulderPivot.rotation.set(-0.95, 0, -0.12 + arpR);
      rig.rightArm.elbowPivot.rotation.set(-0.82 + tapR, 0, 0);

      if (additions.ledMat) {
        additions.ledMat.emissiveIntensity = 0.9 + (playingActive ? level * 1.4 * motionScale : 0);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this._reducedMotionQuery) {
      if (this._reducedMotionQuery.removeEventListener) {
        this._reducedMotionQuery.removeEventListener('change', this._onReducedMotionChange);
      } else if (this._reducedMotionQuery.removeListener) {
        this._reducedMotionQuery.removeListener(this._onReducedMotionChange);
      }
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._onWindowResize) {
      window.removeEventListener('resize', this._onWindowResize);
    }

    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this._onPointerDown);
      canvas.removeEventListener('pointermove', this._onPointerMove);
      canvas.removeEventListener('pointerup', this._onPointerUp);
      canvas.removeEventListener('pointercancel', this._onPointerCancel);
      canvas.removeEventListener('pointerleave', this._onPointerLeave);
    }

    if (this.controls) {
      this.controls.removeEventListener('start', this._onControlsStart);
      this.controls.removeEventListener('end', this._onControlsEnd);
      this.controls.dispose();
    }

    if (this.scene) {
      const disposedGeometries = new Set();
      const disposedMaterials = new Set();
      const disposedTextures = new Set();

      this.scene.traverse((obj) => {
        if (obj.geometry && !disposedGeometries.has(obj.geometry)) {
          disposedGeometries.add(obj.geometry);
          obj.geometry.dispose();
        }
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        mats.forEach((mat) => {
          if (mat.map && !disposedTextures.has(mat.map)) {
            disposedTextures.add(mat.map);
            mat.map.dispose();
          }
          if (!disposedMaterials.has(mat)) {
            disposedMaterials.add(mat);
            mat.dispose();
          }
        });
      });

      this.stageProps?.disposables?.forEach((tex) => {
        if (tex && !disposedTextures.has(tex)) {
          disposedTextures.add(tex);
          tex.dispose();
        }
      });
    }

    if (this._envRenderTarget) {
      this._envRenderTarget.dispose();
      this._envRenderTarget = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.containerEl.replaceChildren();
  }
}
