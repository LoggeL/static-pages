// Crownward – Platzhalter-Grafik (nur Entwicklungs-Fallback, wenn ein Atlas-Sprite oder eine Ebene fehlt).
// Schlichte, klar erkennbare Silhouetten in gedeckten Farben. Das fertige Spiel nutzt die generierten Assets.

import { LAYER_SPECS, SPRITE_SPECS, type AtlasFrame, type LayerId, type SpriteId } from '../shared/sprites';
import { ctx2d, makeCanvas, makeRng } from './util';

export interface PlaceholderSprite {
  canvas: HTMLCanvasElement;
  frames: AtlasFrame[];
  anchorX: number;
  anchorY: number;
  fps: number;
}

type G = CanvasRenderingContext2D;

function rect(g: G, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** gestuftes Dreieck (Nadelbaum-Etage), Spitze oben bei (cx, top) */
function tri(g: G, cx: number, top: number, baseW: number, h: number, c: string) {
  g.fillStyle = c;
  for (let r = 0; r < h; r++) {
    const w = Math.max(1, Math.round((baseW * (r + 1)) / h));
    g.fillRect(Math.round(cx - w / 2), Math.round(top + r), w, 1);
  }
}

function ellipse(g: G, cx: number, cy: number, rx: number, ry: number, c: string) {
  g.fillStyle = c;
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

/** Breite je Platzhalter (Höhe kommt aus SPRITE_SPECS) */
const WIDTH: Partial<Record<SpriteId, number>> = {
  'monarch.walk': 62,
  'monarch.gallop': 66,
  'monarch.graze': 62,
  'mistling.walk': 16,
  'mistling.attack': 18,
  'mistling.flee': 16,
  'breaker.walk': 34,
  'breaker.attack': 36,
  'rabbit.idle': 11,
  'rabbit.hop': 12,
  coin: 7,
  crown: 9,
  torch: 6,
  bush: 20,
  fern: 16,
  rock: 16,
  'tree.spruce': 64,
  'tree.fir': 66,
  'tree.pine': 40,
  'tree.dead': 44,
  'tree.birch': 40,
  'town.0': 50,
  'town.1': 70,
  'town.2': 104,
  'town.3': 116,
  'wall.1': 18,
  'wall.2': 18,
  'wall.3': 26,
  'wall.rubble': 30,
  'tower.1': 38,
  'tower.2': 40,
  farm: 72,
  'stand.hammer': 18,
  'stand.bow': 18,
  'stand.scythe': 18,
  buildsite: 12,
  camp: 46,
  'chest.closed': 16,
  'chest.open': 16,
  'shrine.bow': 22,
  'shrine.hammer': 32,
  rift: 54,
  waymarker: 12,
  'ship.wreck': 150,
  'ship.repair': 156,
  'ship.ready': 170,
};

const FOLK_COLORS: Record<string, [string, string]> = {
  vagrant: ['#5e564e', '#433c36'],
  villager: ['#b49a5c', '#7c6a40'],
  builder: ['#7a5636', '#4e3824'],
  archer: ['#4c6a3c', '#2f4426'],
  farmer: ['#a48a46', '#6c5a30'],
};

function paintFolk(g: G, role: string, pose: string, f: number, w: number, h: number) {
  const [main, dark] = FOLK_COLORS[role] ?? FOLK_COLORS.villager;
  const cx = Math.floor(w / 2);
  const skin = '#c49a78';
  if (pose === 'kneel') {
    rect(g, cx - 3, h - 13, 7, 9, main);
    rect(g, cx - 2, h - 18, 5, 5, skin);
    rect(g, cx - 4, h - 4, 9, 4, dark);
    rect(g, cx + 3, h - 3, 2, 2, '#e8c050');
    return;
  }
  const legA = pose === 'walk' ? (f % 2 ? 2 : -2) : 0;
  rect(g, cx - 2 + legA, h - 9, 2, 9, '#2c2620');
  rect(g, cx + 1 - legA, h - 9, 2, 9, '#2c2620');
  rect(g, cx - 4, h - 21, 9, 13, main);
  rect(g, cx - 4, h - 12, 9, 2, dark);
  rect(g, cx - 2, h - 27, 5, 6, skin);
  rect(g, cx - 3, h - 29, 7, 3, role === 'farmer' ? '#d8c070' : dark);
  if (role === 'farmer') rect(g, cx - 6, h - 27, 13, 1, '#d8c070');
  if (role === 'builder') {
    const up = pose === 'work' && f === 0;
    rect(g, cx + 4, up ? h - 30 : h - 20, 1, 8, '#6a4a2a');
    rect(g, cx + 3, up ? h - 31 : h - 21, 4, 3, '#8a8c94');
  }
  if (role === 'archer') {
    g.fillStyle = '#6a4a26';
    for (let i = 0; i < 18; i++) {
      const yy = h - 28 + i;
      const xx = cx + 5 + Math.round(Math.sin((i / 17) * Math.PI) * (pose === 'shoot' ? 4 : 2));
      g.fillRect(xx, yy, 1, 1);
    }
  }
  if (role === 'farmer') {
    rect(g, cx + 4, h - 28, 1, 18, '#6a4a2a');
    rect(g, cx - 2, h - 29, 7, 1, '#9a9ca4');
  }
}

function paintMonarch(g: G, pose: string, f: number, w: number, h: number) {
  const horse = '#ddd4c2';
  const shade = '#a89e8c';
  const by = h - 30;
  // Beine
  const legs = pose === 'gallop' ? [-10, -6, 12, 16] : [0, 0, 0, 0];
  const swing = pose === 'walk' ? [f % 2 ? 2 : -2, f % 2 ? -2 : 2] : [0, 0];
  const lx = [10, 16, 40, 46];
  for (let i = 0; i < 4; i++) {
    const dx = pose === 'gallop' ? legs[i] * 0.4 : swing[i % 2];
    rect(g, lx[i] + dx, by + 10, 3, pose === 'gallop' ? 14 : 18, i % 2 ? horse : shade);
    rect(g, lx[i] + dx, h - 2, 3, 2, '#3a2c24');
  }
  // Rumpf, Hals, Kopf
  rect(g, 8, by, 42, 13, horse);
  rect(g, 8, by + 10, 42, 3, shade);
  if (pose === 'graze') {
    rect(g, 46, by + 2, 6, 14, horse);
    rect(g, 50, by + 14, 8, 6, horse);
  } else {
    rect(g, 44, by - 12, 7, 16, horse);
    rect(g, 48, by - 16, 12, 7, horse);
    rect(g, 44, by - 14, 3, 12, '#b4ac9c');
  }
  rect(g, 2, by + 1, 7, 12, '#b8b2a8'); // Schweif
  // Satteldecke
  rect(g, 20, by - 1, 12, 12, '#26304e');
  rect(g, 25, by + 3, 2, 4, '#d8d0b8');
  // Reiter:in
  rect(g, 22, by - 20, 10, 19, '#4a4c58');
  rect(g, 14, by - 19, 10, pose === 'gallop' ? 9 : 16, '#8c2430');
  rect(g, 24, by - 27, 6, 7, '#c49a78');
  rect(g, 24, by - 30, 6, 3, '#d8b040');
  rect(g, 24, by - 31, 1, 1, '#d8b040');
  rect(g, 29, by - 31, 1, 1, '#d8b040');
}

function paintTree(g: G, id: SpriteId, w: number, h: number) {
  const cx = w / 2;
  if (id === 'tree.dead') {
    rect(g, cx - 2, 6, 4, h - 6, '#6c6660');
    for (let i = 0; i < 6; i++) {
      const y = 14 + i * 14;
      const s = i % 2 ? 1 : -1;
      rect(g, s > 0 ? cx : cx - 12 + i, y, 12 - i, 2, '#6c6660');
    }
    return;
  }
  if (id === 'tree.birch') {
    rect(g, cx - 2, 20, 4, h - 20, '#d8d4c8');
    for (let y = 26; y < h; y += 7) rect(g, cx - 2, y, 3, 1, '#3c3830');
    ellipse(g, cx, 34, 16, 24, '#a88a3c');
    ellipse(g, cx - 4, 30, 9, 12, '#c8a44c');
    return;
  }
  rect(g, cx - 2, h - 22, 4, 22, '#4a3424');
  const tiers = id === 'tree.pine' ? 5 : 6;
  const dark = id === 'tree.fir' ? '#1e3a36' : '#1c3432';
  const light = id === 'tree.fir' ? '#2e5246' : '#2a4a42';
  const tierH = (h - 18) / tiers;
  for (let i = 0; i < tiers; i++) {
    const baseW = (w * (i + 1.4)) / (tiers + 0.4);
    tri(g, cx, i * tierH * 0.92, baseW, tierH * 1.6, i % 2 ? dark : light);
  }
}

function paintBuilding(g: G, id: SpriteId, w: number, h: number) {
  const cx = Math.floor(w / 2);
  const wood = '#6e4c30';
  const woodD = '#4a3220';
  const roof = '#2c3448';
  const stone = '#6c6e7a';
  switch (id) {
    case 'town.0':
      ellipse(g, cx, h - 3, 14, 3, '#585a62');
      rect(g, cx - 4, h - 10, 8, 6, '#e08a3a');
      rect(g, cx - 2, h - 14, 4, 5, '#f4c060');
      rect(g, cx + 14, 2, 2, h - 2, woodD);
      rect(g, cx + 16, 4, 9, 12, '#24305a');
      return;
    case 'town.1':
      rect(g, 8, h - 28, 3, 28, wood);
      rect(g, w - 11, h - 28, 3, 28, wood);
      tri(g, cx, 6, w - 4, 26, '#9a8448');
      rect(g, cx - 4, h - 9, 8, 6, '#e08a3a');
      return;
    case 'town.2':
      rect(g, 8, h - 46, w - 16, 46, wood);
      tri(g, cx, 4, w, 44, roof);
      for (let i = 0; i < 3; i++) rect(g, 18 + i * 26, h - 32, 7, 9, '#f0b050');
      return;
    case 'town.3':
      rect(g, 10, h - 40, w - 20, 40, stone);
      rect(g, 14, h - 74, w - 28, 34, wood);
      rect(g, cx - 12, 14, 24, h - 74, stone);
      tri(g, cx, 0, 34, 18, roof);
      for (let i = 0; i < 3; i++) rect(g, 24 + i * 26, h - 62, 7, 9, '#f0b050');
      return;
    case 'wall.1':
      for (let i = 0; i < 4; i++) {
        rect(g, 2 + i * 4, 4 + (i % 2) * 2, 3, h - 4, i % 2 ? wood : woodD);
        rect(g, 3 + i * 4, 2 + (i % 2) * 2, 1, 2, '#c8a070');
      }
      return;
    case 'wall.2':
      for (let i = 0; i < 4; i++) {
        rect(g, 1 + i * 4, 4, 4, h - 4, i % 2 ? wood : woodD);
        rect(g, 2 + i * 4, 1, 2, 3, '#c8a070');
      }
      rect(g, 0, 10, w, 3, '#30343c');
      return;
    case 'wall.3':
      rect(g, 2, 10, w - 4, h - 10, stone);
      for (let y = 14; y < h; y += 7) rect(g, 2, y, w - 4, 1, '#4a4c56');
      rect(g, 0, 6, w, 4, wood);
      return;
    case 'wall.rubble':
      ellipse(g, cx, h - 4, 14, 5, '#5c5e68');
      rect(g, cx - 10, h - 10, 14, 2, wood);
      rect(g, cx + 2, h - 12, 2, 8, woodD);
      return;
    case 'tower.1':
    case 'tower.2': {
      const top = id === 'tower.1' ? h * 0.5 : h * 0.42;
      if (id === 'tower.2') rect(g, 6, top, w - 12, h - top, stone);
      else {
        rect(g, 6, top, 3, h - top, wood);
        rect(g, w - 9, top, 3, h - top, wood);
        for (let y = top + 8; y < h; y += 12) rect(g, 8, y, w - 16, 2, woodD);
      }
      rect(g, 2, top - 4, w - 4, 5, woodD);
      rect(g, 3, top - 12, 2, 8, wood);
      rect(g, w - 5, top - 12, 2, 8, wood);
      tri(g, cx, top - 32, w + 2, 18, roof);
      rect(g, 4, top - 16, 2, 6, wood);
      return;
    }
    case 'farm':
      for (let i = 0; i < 12; i++) rect(g, 4 + i * 5.5, h - 20 + (i % 3), 3, 18, i % 2 ? '#c8a848' : '#b09038');
      rect(g, 0, h - 8, w, 2, woodD);
      rect(g, 0, h - 12, 2, 12, woodD);
      rect(g, w - 2, h - 12, 2, 12, woodD);
      return;
    case 'stand.hammer':
    case 'stand.bow':
    case 'stand.scythe':
      rect(g, 2, 4, 2, h - 4, wood);
      rect(g, w - 4, 4, 2, h - 4, wood);
      rect(g, 0, 4, w, 2, woodD);
      rect(g, 0, h - 10, w, 2, woodD);
      return;
    case 'buildsite':
      rect(g, cx - 1, 2, 2, h - 2, wood);
      rect(g, cx + 1, 4, 5, 6, '#3a4466');
      return;
    case 'camp':
      tri(g, cx - 6, 4, 30, h - 6, '#6e6250');
      rect(g, cx + 12, h - 6, 6, 4, '#c8702a');
      rect(g, cx + 13, h - 9, 4, 3, '#f0b050');
      return;
    case 'chest.closed':
    case 'chest.open':
      rect(g, 1, h - 10, w - 2, 10, '#6a4424');
      rect(g, 1, h - 10, w - 2, 2, '#3c3c44');
      rect(g, cx - 1, h - 7, 2, 3, '#d8b040');
      if (id === 'chest.open') {
        rect(g, 1, 0, w - 2, 4, '#5a3a20');
        rect(g, 3, h - 12, w - 6, 2, '#f0c850');
      }
      return;
    case 'shrine.bow':
      rect(g, cx - 7, 6, 14, h - 6, '#5a6266');
      tri(g, cx, 0, 14, 7, '#5a6266');
      rect(g, cx - 1, 18, 2, 14, '#9ae0a0');
      return;
    case 'shrine.hammer':
      rect(g, 4, h - 18, w - 8, 18, '#5e5e64');
      rect(g, 0, h - 22, w, 5, '#6e6e76');
      rect(g, cx - 1, h - 15, 2, 9, '#e8b060');
      rect(g, cx - 4, h - 15, 8, 3, '#e8b060');
      return;
    case 'rift':
      ellipse(g, cx, h / 2, 14, h / 2 - 4, '#2a1640');
      ellipse(g, cx, h / 2, 8, h / 2 - 12, '#5a2e8a');
      ellipse(g, cx, h / 2, 3, h / 2 - 24, '#c8a8f0');
      rect(g, 2, 20, 3, h - 20, '#3a3036');
      rect(g, w - 6, 30, 3, h - 30, '#3a3036');
      return;
    case 'waymarker':
      rect(g, 2, 4, w - 4, h - 4, '#6a6c70');
      tri(g, cx, 0, w - 4, 5, '#6a6c70');
      rect(g, 2, h - 8, w - 4, 3, '#4c6a3c');
      return;
    case 'ship.wreck':
      for (let i = 0; i < w - 20; i++) {
        const y = h - 18 + Math.round(Math.sin((i / (w - 20)) * Math.PI) * 10);
        rect(g, 10 + i, y - 14 + (i % 9 === 0 ? 3 : 0), 1, h - y + 14, i % 7 ? '#5a3c26' : '#3a2818');
      }
      rect(g, w * 0.55, 6, 3, h - 22, '#4a3220');
      return;
    case 'ship.repair':
    case 'ship.ready': {
      const hullTop = h - 40;
      g.fillStyle = id === 'ship.ready' ? '#6a4628' : '#7a5636';
      for (let i = 0; i < w; i++) {
        const k = i / w;
        const depth = Math.round(Math.sin(k * Math.PI) * 26);
        const lift = k < 0.12 ? Math.round((0.12 - k) * 80) : 0;
        g.fillRect(i, hullTop - lift, 1, 14 + depth);
      }
      rect(g, 0, hullTop, w, 3, '#3a2818');
      rect(g, w * 0.5, 4, 3, hullTop - 4, '#4a3220');
      if (id === 'ship.ready') {
        rect(g, w * 0.5 - 30, 14, 60, hullTop - 26, '#2a3660');
        rect(g, w * 0.5 - 2, 30, 4, 10, '#d8d0b8');
        rect(g, w * 0.5 + 1, 0, 8, 5, '#d8b040');
      } else {
        for (let y = hullTop - 10; y < h; y += 10) rect(g, w * 0.2, y, w * 0.6, 1, '#8a6a46');
      }
      return;
    }
  }
}

function paintSmall(g: G, id: SpriteId, f: number, w: number, h: number) {
  const cx = Math.floor(w / 2);
  switch (id) {
    case 'rabbit.idle':
    case 'rabbit.hop':
      ellipse(g, cx - 1, h - 4, 4, 3, '#8a6a4a');
      rect(g, cx + 2, h - 8, 3, 3, '#8a6a4a');
      rect(g, cx + 2, h - 9, 1, 2, '#6a4e36');
      rect(g, cx - 5, h - 5, 2, 2, '#e8e0d0');
      return;
    case 'coin': {
      const widths = [7, 5, 2];
      const cw = widths[f % 3];
      ellipse(g, cx, h / 2, Math.max(0, Math.floor(cw / 2)), 3, '#d8a830');
      if (cw > 2) rect(g, cx - 1, 2, 2, 3, '#f8e070');
      return;
    }
    case 'crown':
      rect(g, 0, h - 4, w, 4, '#d8b040');
      rect(g, 0, h - 7, 2, 3, '#d8b040');
      rect(g, cx - 1, h - 8, 2, 4, '#d8b040');
      rect(g, w - 2, h - 7, 2, 3, '#d8b040');
      rect(g, cx - 1, h - 3, 2, 2, '#c02030');
      return;
    case 'torch':
      rect(g, cx - 1, 6, 2, h - 6, '#5a3c22');
      rect(g, cx - 2, 2, 4, 5, '#f09030');
      rect(g, cx - 1, 0, 2, 3, '#ffd870');
      return;
    case 'bush':
      ellipse(g, cx, h - 6, w / 2 - 1, 6, '#2c4a36');
      ellipse(g, cx - 3, h - 8, 5, 4, '#3a5c40');
      return;
    case 'fern':
      for (let i = 0; i < 6; i++) rect(g, 2 + i * 2, 2 + Math.abs(i - 3) * 2, 1, h - 2 - Math.abs(i - 3) * 2, i % 2 ? '#3c6240' : '#2c4a34');
      return;
    case 'rock':
      ellipse(g, cx, h - 5, w / 2 - 1, 5, '#5c6068');
      ellipse(g, cx - 2, h - 7, 4, 2, '#7a7e88');
      rect(g, 2, h - 3, w - 4, 2, '#3e5a3a');
      return;
  }
}

/** Erzeugt einen Platzhalter-Sprite mit der in SPRITE_SPECS geforderten Höhe und Frame-Anzahl. */
export function makePlaceholderSprite(id: SpriteId): PlaceholderSprite {
  const spec = SPRITE_SPECS[id];
  const h = spec.height;
  const w = WIDTH[id] ?? Math.max(8, Math.round(h * 0.5));
  const n = spec.frames;
  const pad = 2;
  const canvas = makeCanvas((w + pad) * n, h);
  const g = ctx2d(canvas);
  const frames: AtlasFrame[] = [];
  const [group, pose] = id.split('.') as [string, string | undefined];
  for (let f = 0; f < n; f++) {
    const ox = f * (w + pad);
    g.save();
    g.translate(ox, 0);
    if (group === 'monarch') paintMonarch(g, pose ?? 'walk', f, w, h);
    else if (FOLK_COLORS[group]) paintFolk(g, group, pose ?? 'idle', f, w, h);
    else if (group === 'mistling' || group === 'breaker') paintEnemy(g, group, pose ?? 'walk', f, w, h);
    else if (group === 'tree') paintTree(g, id, w, h);
    else if (['rabbit', 'coin', 'crown', 'torch', 'bush', 'fern', 'rock'].includes(group)) paintSmall(g, id, f, w, h);
    else paintBuilding(g, id, w, h);
    g.restore();
    frames.push({ x: ox, y: 0, w, h });
  }
  return { canvas, frames, anchorX: Math.floor(w / 2), anchorY: h, fps: 6 };
}

function paintEnemy(g: G, kind: string, pose: string, f: number, w: number, h: number) {
  const body = '#24162e';
  const edge = '#3e2a52';
  const cx = Math.floor(w / 2);
  if (kind === 'mistling') {
    const lean = pose === 'attack' ? 3 : 0;
    ellipse(g, cx - 1 + lean, h - 8, 5, 6, body);
    rect(g, cx - 4 + (f % 2 ? 1 : -1), h - 3, 2, 3, body);
    rect(g, cx + 1 + (f % 2 ? -1 : 1), h - 3, 2, 3, body);
    rect(g, cx + 2 + lean, h - 9, 4 + lean, 2, edge);
    rect(g, cx + 1 + lean, h - 12, 1, 1, '#ffe0a0');
    rect(g, cx + 3 + lean, h - 12, 1, 1, '#ffe0a0');
    if (pose === 'flee') rect(g, cx - 2, 0, 4, 4, '#d8a830');
    return;
  }
  const raise = pose === 'attack' && f === 0;
  ellipse(g, cx - 2, h - 20, 12, 15, body);
  rect(g, cx - 8 + (f % 2 ? 1 : -1), h - 8, 5, 8, body);
  rect(g, cx + 2 - (f % 2 ? 1 : -1), h - 8, 5, 8, body);
  rect(g, cx + 6, raise ? h - 46 : h - 28, 6, raise ? 16 : 18, edge);
  rect(g, cx + 2, h - 36, 8, 7, '#d4ccbc');
  rect(g, cx + 6, h - 34, 2, 1, '#ffb050');
}

/** Platzhalter-Ebene (nahtlos kachelbar) in Spezifikationshöhe. */
export function makePlaceholderLayer(id: LayerId): HTMLCanvasElement {
  const h = LAYER_SPECS[id].height;
  const w = 512;
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  const rnd = makeRng(id.length * 977);
  const wave = (x: number, f: number, p: number) => Math.sin(((x / w) * f + p) * Math.PI * 2);
  if (id === 'layer.mountains') {
    const p1 = rnd();
    const p2 = rnd();
    const p3 = rnd();
    for (let x = 0; x < w; x++) {
      const ridge = 0.55 * Math.abs(wave(x, 3, p1)) + 0.3 * wave(x, 7, p2) + 0.15 * wave(x, 17, p3);
      const top = Math.round(h * 0.42 - ridge * h * 0.32);
      g.fillStyle = '#7d86a8';
      g.fillRect(x, top, 1, h - top);
      if (ridge > 0.5) {
        g.fillStyle = '#d8dcea';
        g.fillRect(x, top, 1, Math.round((ridge - 0.5) * 20));
      }
      const hill = Math.round(h * 0.72 - (0.5 + 0.5 * wave(x, 5, p3)) * h * 0.12);
      g.fillStyle = '#5c6a8a';
      g.fillRect(x, hill, 1, h - hill);
    }
    g.fillStyle = '#34465e';
    g.fillRect(0, h - 14, w, 14);
  } else if (id === 'layer.forest') {
    g.fillStyle = '#18302e';
    g.fillRect(0, h - 40, w, 40);
    for (let row = 0; row < 3; row++) {
      const col = ['#2a4a48', '#22403c', '#1a3430'][row];
      for (let x = -20; x < w + 20; x += 9 + Math.floor(rnd() * 8)) {
        const th = h * (0.45 + rnd() * 0.35) - row * 6;
        const bw = th * 0.42;
        const top = h - 30 - th + row * 14;
        tri(g, x, top, bw, th, col);
        // nahtlos: über die Kante gespiegelt erneut zeichnen
        if (x < 20) tri(g, x + w, top, bw, th, col);
        if (x > w - 20) tri(g, x - w, top, bw, th, col);
      }
    }
  } else {
    g.fillStyle = '#2c2018';
    g.fillRect(0, 18, w, h - 18);
    g.fillStyle = '#7a6244';
    g.fillRect(0, 20, w, 8);
    g.fillStyle = '#5c4a34';
    g.fillRect(0, 28, w, 2);
    for (let x = 0; x < w; x += 2) {
      const gh = 4 + Math.floor((0.5 + 0.5 * wave(x, 32, 0.1)) * 10 + rnd() * 4);
      g.fillStyle = x % 6 === 0 ? '#4a6a3a' : '#3a5a32';
      g.fillRect(x, 20 - gh, 2, gh);
    }
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rnd() * w);
      const y = 34 + Math.floor(rnd() * (h - 40));
      g.fillStyle = '#4a4a52';
      g.fillRect(x, y, 4 + Math.floor(rnd() * 6), 3);
    }
  }
  return c;
}
