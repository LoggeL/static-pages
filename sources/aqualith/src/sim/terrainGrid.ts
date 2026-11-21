import {
  CELL_SIZE,
  GRID_NX,
  GRID_NY,
  INV_CELL_SIZE,
  SolidKind,
  WORLD_H,
  WORLD_W,
  type DrainZoneDef,
  type ITerrainGrid,
  type TerrainShape,
} from '../types.ts';

const CELL_COUNT = GRID_NX * GRID_NY;
const MAX_DIM = Math.max(GRID_NX, GRID_NY);
const EDT_INF = 1e6;

function pointInShape(shape: TerrainShape, cx: number, cy: number): boolean {
  switch (shape.kind) {
    case 'rect':
      return (
        cx >= shape.x &&
        cx <= shape.x + shape.w &&
        cy >= shape.y &&
        cy <= shape.y + shape.h
      );
    case 'circle': {
      const dx = cx - shape.x;
      const dy = cy - shape.y;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
    case 'capsule': {
      const dx = shape.x2 - shape.x1;
      const dy = shape.y2 - shape.y1;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 1e-12 ? ((cx - shape.x1) * dx + (cy - shape.y1) * dy) / lenSq : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = shape.x1 + t * dx;
      const py = shape.y1 + t * dy;
      const rx = cx - px;
      const ry = cy - py;
      return rx * rx + ry * ry <= shape.r * shape.r;
    }
    case 'poly': {
      const pts = shape.points;
      const n = pts.length;
      if (n < 3) return false;
      let inside = false;
      for (let k = 0, prev = n - 1; k < n; prev = k++) {
        const xi = pts[k][0];
        const yi = pts[k][1];
        const xj = pts[prev][0];
        const yj = pts[prev][1];
        if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    }
  }
}

function shapeBounds(shape: TerrainShape): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (shape.kind) {
    case 'rect':
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.w,
        maxY: shape.y + shape.h,
      };
    case 'circle':
      return {
        minX: shape.x - shape.r,
        minY: shape.y - shape.r,
        maxX: shape.x + shape.r,
        maxY: shape.y + shape.r,
      };
    case 'capsule':
      return {
        minX: Math.min(shape.x1, shape.x2) - shape.r,
        minY: Math.min(shape.y1, shape.y2) - shape.r,
        maxX: Math.max(shape.x1, shape.x2) + shape.r,
        maxY: Math.max(shape.y1, shape.y2) + shape.r,
      };
    case 'poly': {
      const pts = shape.points;
      if (pts.length === 0) {
        return { minX: 0, minY: 0, maxX: -1, maxY: -1 };
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < pts.length; k++) {
        const px = pts[k][0];
        const py = pts[k][1];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      return { minX, minY, maxX, maxY };
    }
  }
}

export class TerrainGrid implements ITerrainGrid {
  readonly solidKind = new Uint8Array(CELL_COUNT);
  readonly staticRock = new Uint8Array(CELL_COUNT);
  readonly iceMask = new Uint8Array(CELL_COUNT);
  readonly obsidianMask = new Uint8Array(CELL_COUNT);
  readonly dynamicMask = new Uint8Array(CELL_COUNT);
  readonly sdf = new Float32Array(CELL_COUNT);
  readonly sdfNormX = new Float32Array(CELL_COUNT);
  readonly sdfNormY = new Float32Array(CELL_COUNT);

  frostCount = 0;
  version = 0;
  dirty = false;

  // Pre-allocated buffers for Felzenszwalb-Huttenlocher 2-pass exact EDT
  private readonly distToSolid = new Float32Array(CELL_COUNT);
  private readonly distToOpen = new Float32Array(CELL_COUNT);
  private readonly edtF = new Float64Array(MAX_DIM);
  private readonly edtV = new Int32Array(MAX_DIM);
  private readonly edtZ = new Float64Array(MAX_DIM + 1);

  constructor() {
    this.loadLevel([]);
    this.version = 0;
  }

  loadLevel(solids: TerrainShape[], carves?: TerrainShape[], drains?: DrainZoneDef[]): void {
    this.staticRock.fill(0);
    this.iceMask.fill(0);
    this.obsidianMask.fill(0);
    this.dynamicMask.fill(0);

    for (let s = 0; s < solids.length; s++) {
      this.rasterizeShape(solids[s], 1);
    }

    if (carves) {
      for (let c = 0; c < carves.length; c++) {
        this.rasterizeShape(carves[c], 0);
      }
    }

    // Enforce 1-cell border on left, right, top, and bottom (except drains covering y <= CELL_SIZE)
    for (let j = 0; j < GRID_NY; j++) {
      const rowOff = j * GRID_NX;
      this.staticRock[rowOff] = 1;
      this.staticRock[rowOff + GRID_NX - 1] = 1;
    }
    const topOff = (GRID_NY - 1) * GRID_NX;
    for (let i = 0; i < GRID_NX; i++) {
      this.staticRock[topOff + i] = 1;
    }
    for (let i = 1; i < GRID_NX - 1; i++) {
      const cx = (i + 0.5) * CELL_SIZE;
      let coveredByBottomDrain = false;
      if (drains) {
        for (let d = 0; d < drains.length; d++) {
          const dr = drains[d];
          if (dr.y <= CELL_SIZE && dr.y + dr.h >= 0 && cx >= dr.x && cx <= dr.x + dr.w) {
            coveredByBottomDrain = true;
            break;
          }
        }
      }
      if (!coveredByBottomDrain) {
        this.staticRock[i] = 1;
      }
    }

    this.frostCount = 0;
    this.dirty = true;
    this.rebuildSDFIfDirty();
  }

  private rasterizeShape(shape: TerrainShape, value: 0 | 1): void {
    const { minX, minY, maxX, maxY } = shapeBounds(shape);
    if (maxX < minX || maxY < minY) return;

    const iMin = Math.max(0, Math.floor(minX * INV_CELL_SIZE));
    const iMax = Math.min(GRID_NX - 1, Math.floor(maxX * INV_CELL_SIZE));
    const jMin = Math.max(0, Math.floor(minY * INV_CELL_SIZE));
    const jMax = Math.min(GRID_NY - 1, Math.floor(maxY * INV_CELL_SIZE));

    for (let j = jMin; j <= jMax; j++) {
      const cy = (j + 0.5) * CELL_SIZE;
      const rowOff = j * GRID_NX;
      for (let i = iMin; i <= iMax; i++) {
        const cx = (i + 0.5) * CELL_SIZE;
        if (pointInShape(shape, cx, cy)) {
          this.staticRock[rowOff + i] = value;
        }
      }
    }
  }

  clearDynamicSolids(): void {
    let changed = false;
    for (let idx = 0; idx < CELL_COUNT; idx++) {
      if (this.dynamicMask[idx] !== 0) {
        this.dynamicMask[idx] = 0;
        changed = true;
      }
    }
    if (changed) {
      this.dirty = true;
    }
  }

  stampDynamicRect(x: number, y: number, w: number, h: number, kind: SolidKind): void {
    if (w <= 0 || h <= 0) return;
    const xEnd = x + w;
    const yEnd = y + h;
    const iMin = Math.max(0, Math.floor(x * INV_CELL_SIZE));
    const iMax = Math.min(GRID_NX - 1, Math.floor(xEnd * INV_CELL_SIZE));
    const jMin = Math.max(0, Math.floor(y * INV_CELL_SIZE));
    const jMax = Math.min(GRID_NY - 1, Math.floor(yEnd * INV_CELL_SIZE));

    let changed = false;
    for (let j = jMin; j <= jMax; j++) {
      const cy = (j + 0.5) * CELL_SIZE;
      if (cy < y || cy > yEnd) continue;
      const rowOff = j * GRID_NX;
      for (let i = iMin; i <= iMax; i++) {
        const cx = (i + 0.5) * CELL_SIZE;
        if (cx < x || cx > xEnd) continue;
        const idx = rowOff + i;
        if (this.dynamicMask[idx] !== kind) {
          this.dynamicMask[idx] = kind;
          changed = true;
        }
      }
    }
    if (changed) {
      this.dirty = true;
    }
  }

  addObsidianRect(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    const xEnd = x + w;
    const yEnd = y + h;
    const iMin = Math.max(0, Math.floor(x * INV_CELL_SIZE));
    const iMax = Math.min(GRID_NX - 1, Math.floor(xEnd * INV_CELL_SIZE));
    const jMin = Math.max(0, Math.floor(y * INV_CELL_SIZE));
    const jMax = Math.min(GRID_NY - 1, Math.floor(yEnd * INV_CELL_SIZE));

    let changed = false;
    for (let j = jMin; j <= jMax; j++) {
      const cy = (j + 0.5) * CELL_SIZE;
      if (cy < y || cy > yEnd) continue;
      const rowOff = j * GRID_NX;
      for (let i = iMin; i <= iMax; i++) {
        const cx = (i + 0.5) * CELL_SIZE;
        if (cx < x || cx > xEnd) continue;
        const idx = rowOff + i;
        if (this.obsidianMask[idx] !== 1) {
          this.obsidianMask[idx] = 1;
          changed = true;
        }
      }
    }
    if (changed) {
      this.dirty = true;
    }
  }

  paintIce(
    wx: number,
    wy: number,
    radius: number,
    maxFrostCells: number
  ): { added: number; displacedCells: number[] } {
    const displacedCells: number[] = [];
    if (radius <= 0 || this.frostCount >= maxFrostCells) {
      return { added: 0, displacedCells };
    }

    const r2 = radius * radius;
    const iMin = Math.max(0, Math.floor((wx - radius) * INV_CELL_SIZE));
    const iMax = Math.min(GRID_NX - 1, Math.floor((wx + radius) * INV_CELL_SIZE));
    const jMin = Math.max(0, Math.floor((wy - radius) * INV_CELL_SIZE));
    const jMax = Math.min(GRID_NY - 1, Math.floor((wy + radius) * INV_CELL_SIZE));

    let added = 0;
    for (let j = jMin; j <= jMax; j++) {
      if (this.frostCount >= maxFrostCells) break;
      const dy = (j + 0.5) * CELL_SIZE - wy;
      const dy2 = dy * dy;
      const rowOff = j * GRID_NX;
      for (let i = iMin; i <= iMax; i++) {
        if (this.frostCount >= maxFrostCells) break;
        const dx = (i + 0.5) * CELL_SIZE - wx;
        if (dx * dx + dy2 > r2) continue;

        const idx = rowOff + i;
        if (
          this.staticRock[idx] === 0 &&
          this.obsidianMask[idx] === 0 &&
          this.dynamicMask[idx] === 0 &&
          this.iceMask[idx] === 0
        ) {
          this.iceMask[idx] = 1;
          this.frostCount++;
          added++;
          displacedCells.push(idx);
        }
      }
    }

    if (added > 0) {
      this.dirty = true;
    }
    return { added, displacedCells };
  }

  eraseIce(wx: number, wy: number, radius: number): number {
    if (radius <= 0 || this.frostCount <= 0) return 0;

    const r2 = radius * radius;
    const iMin = Math.max(0, Math.floor((wx - radius) * INV_CELL_SIZE));
    const iMax = Math.min(GRID_NX - 1, Math.floor((wx + radius) * INV_CELL_SIZE));
    const jMin = Math.max(0, Math.floor((wy - radius) * INV_CELL_SIZE));
    const jMax = Math.min(GRID_NY - 1, Math.floor((wy + radius) * INV_CELL_SIZE));

    let erased = 0;
    for (let j = jMin; j <= jMax; j++) {
      const dy = (j + 0.5) * CELL_SIZE - wy;
      const dy2 = dy * dy;
      const rowOff = j * GRID_NX;
      for (let i = iMin; i <= iMax; i++) {
        const dx = (i + 0.5) * CELL_SIZE - wx;
        if (dx * dx + dy2 > r2) continue;
        const idx = rowOff + i;
        if (this.iceMask[idx] !== 0) {
          this.iceMask[idx] = 0;
          if (this.frostCount > 0) this.frostCount--;
          erased++;
        }
      }
    }

    if (erased > 0) {
      this.dirty = true;
    }
    return erased;
  }

  shatterAllIce(): Array<{ x: number; y: number }> {
    const centers: Array<{ x: number; y: number }> = [];
    if (this.frostCount === 0) {
      // Still verify mask is clean just in case
      let anyFound = false;
      for (let idx = 0; idx < CELL_COUNT; idx++) {
        if (this.iceMask[idx] !== 0) {
          anyFound = true;
          break;
        }
      }
      if (!anyFound) return centers;
    }

    for (let j = 0; j < GRID_NY; j++) {
      const cy = (j + 0.5) * CELL_SIZE;
      const rowOff = j * GRID_NX;
      for (let i = 0; i < GRID_NX; i++) {
        const idx = rowOff + i;
        if (this.iceMask[idx] !== 0) {
          this.iceMask[idx] = 0;
          centers.push({ x: (i + 0.5) * CELL_SIZE, y: cy });
        }
      }
    }

    this.frostCount = 0;
    if (centers.length > 0) {
      this.dirty = true;
    }
    return centers;
  }

  paintRock(wx: number, wy: number, radius: number, erase: boolean): void {
    if (radius <= 0) return;

    const r2 = radius * radius;
    const iMin = Math.max(1, Math.floor((wx - radius) * INV_CELL_SIZE));
    const iMax = Math.min(GRID_NX - 2, Math.floor((wx + radius) * INV_CELL_SIZE));
    const jMin = Math.max(1, Math.floor((wy - radius) * INV_CELL_SIZE));
    const jMax = Math.min(GRID_NY - 2, Math.floor((wy + radius) * INV_CELL_SIZE));

    let changed = false;
    for (let j = jMin; j <= jMax; j++) {
      const dy = (j + 0.5) * CELL_SIZE - wy;
      const dy2 = dy * dy;
      const rowOff = j * GRID_NX;
      for (let i = iMin; i <= iMax; i++) {
        const dx = (i + 0.5) * CELL_SIZE - wx;
        if (dx * dx + dy2 > r2) continue;

        const idx = rowOff + i;
        if (erase) {
          if (this.staticRock[idx] !== 0) {
            this.staticRock[idx] = 0;
            changed = true;
          }
        } else {
          if (this.staticRock[idx] === 0) {
            this.staticRock[idx] = 1;
            changed = true;
          }
          if (this.iceMask[idx] !== 0) {
            this.iceMask[idx] = 0;
            if (this.frostCount > 0) this.frostCount--;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.dirty = true;
    }
  }

  rebuildSDFIfDirty(): boolean {
    if (!this.dirty) return false;

    const solidKind = this.solidKind;
    const staticRock = this.staticRock;
    const obsidianMask = this.obsidianMask;
    const dynamicMask = this.dynamicMask;
    const iceMask = this.iceMask;
    const distToSolid = this.distToSolid;
    const distToOpen = this.distToOpen;

    // Combine masks by priority and seed both distance fields
    for (let idx = 0; idx < CELL_COUNT; idx++) {
      let kind: number = SolidKind.NONE;
      if (staticRock[idx] !== 0) {
        kind = SolidKind.ROCK;
      } else if (obsidianMask[idx] !== 0) {
        kind = SolidKind.OBSIDIAN;
      } else if (dynamicMask[idx] !== 0) {
        kind = dynamicMask[idx];
      } else if (iceMask[idx] !== 0) {
        kind = SolidKind.ICE;
      }
      solidKind[idx] = kind;

      if (kind !== SolidKind.NONE) {
        distToSolid[idx] = 0;
        distToOpen[idx] = EDT_INF;
      } else {
        distToSolid[idx] = EDT_INF;
        distToOpen[idx] = 0;
      }
    }

    // Separable 2D exact squared Euclidean Distance Transform
    this.compute2DEDT(distToSolid);
    this.compute2DEDT(distToOpen);

    // Combine exterior and interior distances with half-cell boundary offset
    const sdf = this.sdf;
    const halfCell = 0.5 * CELL_SIZE;
    for (let idx = 0; idx < CELL_COUNT; idx++) {
      const sqOut = distToSolid[idx];
      if (sqOut > 0) {
        const dOut = Math.sqrt(sqOut) * CELL_SIZE;
        const val = dOut - halfCell;
        sdf[idx] = val > 0 ? val : 0;
      } else {
        const dIn = Math.sqrt(distToOpen[idx]) * CELL_SIZE;
        const val = dIn - halfCell;
        sdf[idx] = -(val > 0 ? val : 0);
      }
    }

    // Central-difference gradient normalized to (sdfNormX, sdfNormY)
    const sdfNormX = this.sdfNormX;
    const sdfNormY = this.sdfNormY;
    for (let j = 0; j < GRID_NY; j++) {
      const jD = j > 0 ? j - 1 : 0;
      const jU = j < GRID_NY - 1 ? j + 1 : GRID_NY - 1;
      const dySpan = jU - jD;
      const rowOff = j * GRID_NX;
      const rowD = jD * GRID_NX;
      const rowU = jU * GRID_NX;

      for (let i = 0; i < GRID_NX; i++) {
        const iL = i > 0 ? i - 1 : 0;
        const iR = i < GRID_NX - 1 ? i + 1 : GRID_NX - 1;
        const dxSpan = iR - iL;
        const idx = rowOff + i;

        const gx = (sdf[rowOff + iR] - sdf[rowOff + iL]) / dxSpan;
        const gy = (sdf[rowU + i] - sdf[rowD + i]) / dySpan;
        const len = Math.sqrt(gx * gx + gy * gy);
        if (len > 1e-6) {
          const invLen = 1.0 / len;
          sdfNormX[idx] = gx * invLen;
          sdfNormY[idx] = gy * invLen;
        } else {
          sdfNormX[idx] = 0;
          sdfNormY[idx] = 1;
        }
      }
    }

    this.version++;
    this.dirty = false;
    return true;
  }

  private compute2DEDT(grid: Float32Array): void {
    const f = this.edtF;
    const v = this.edtV;
    const z = this.edtZ;

    // Pass 1: 1D EDT along X (rows)
    for (let j = 0; j < GRID_NY; j++) {
      const rowOff = j * GRID_NX;
      for (let i = 0; i < GRID_NX; i++) {
        f[i] = grid[rowOff + i];
      }

      let k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;

      for (let q = 1; q < GRID_NX; q++) {
        const fq = f[q] + q * q;
        let vk = v[k];
        let s = (fq - (f[vk] + vk * vk)) / (2 * (q - vk));
        while (s <= z[k]) {
          k--;
          vk = v[k];
          s = (fq - (f[vk] + vk * vk)) / (2 * (q - vk));
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
      }

      k = 0;
      for (let q = 0; q < GRID_NX; q++) {
        while (z[k + 1] < q) {
          k++;
        }
        const vk = v[k];
        const dx = q - vk;
        grid[rowOff + q] = dx * dx + f[vk];
      }
    }

    // Pass 2: 1D EDT along Y (columns)
    for (let i = 0; i < GRID_NX; i++) {
      for (let j = 0; j < GRID_NY; j++) {
        f[j] = grid[j * GRID_NX + i];
      }

      let k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;

      for (let q = 1; q < GRID_NY; q++) {
        const fq = f[q] + q * q;
        let vk = v[k];
        let s = (fq - (f[vk] + vk * vk)) / (2 * (q - vk));
        while (s <= z[k]) {
          k--;
          vk = v[k];
          s = (fq - (f[vk] + vk * vk)) / (2 * (q - vk));
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
      }

      k = 0;
      for (let q = 0; q < GRID_NY; q++) {
        while (z[k + 1] < q) {
          k++;
        }
        const vk = v[k];
        const dy = q - vk;
        grid[q * GRID_NX + i] = dy * dy + f[vk];
      }
    }
  }

  isSolidCell(i: number, j: number): boolean {
    if (i < 0 || i >= GRID_NX || j < 0 || j >= GRID_NY) return true;
    const idx = j * GRID_NX + i;
    if (!this.dirty) {
      return this.solidKind[idx] !== SolidKind.NONE;
    }
    return (
      this.staticRock[idx] !== 0 ||
      this.obsidianMask[idx] !== 0 ||
      this.dynamicMask[idx] !== 0 ||
      this.iceMask[idx] !== 0
    );
  }

  getKindAtCell(i: number, j: number): SolidKind {
    if (i < 0 || i >= GRID_NX || j < 0 || j >= GRID_NY) return SolidKind.ROCK;
    const idx = j * GRID_NX + i;
    if (!this.dirty) {
      return this.solidKind[idx] as SolidKind;
    }
    if (this.staticRock[idx] !== 0) return SolidKind.ROCK;
    if (this.obsidianMask[idx] !== 0) return SolidKind.OBSIDIAN;
    if (this.dynamicMask[idx] !== 0) return this.dynamicMask[idx] as SolidKind;
    if (this.iceMask[idx] !== 0) return SolidKind.ICE;
    return SolidKind.NONE;
  }

  sampleSDF(wx: number, wy: number): { dist: number; nx: number; ny: number } {
    const cw = wx < 0 ? 0 : wx > WORLD_W - 1e-4 ? WORLD_W - 1e-4 : wx;
    const ch = wy < 0 ? 0 : wy > WORLD_H - 1e-4 ? WORLD_H - 1e-4 : wy;

    let gx = cw * INV_CELL_SIZE - 0.5;
    let gy = ch * INV_CELL_SIZE - 0.5;
    if (gx < 0) gx = 0;
    else if (gx > GRID_NX - 1.0001) gx = GRID_NX - 1.0001;
    if (gy < 0) gy = 0;
    else if (gy > GRID_NY - 1.0001) gy = GRID_NY - 1.0001;

    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const tx = gx - i0;
    const ty = gy - j0;
    const omx = 1.0 - tx;
    const omy = 1.0 - ty;

    const w00 = omx * omy;
    const w10 = tx * omy;
    const w01 = omx * ty;
    const w11 = tx * ty;

    const idx00 = j0 * GRID_NX + i0;
    const idx10 = idx00 + 1;
    const idx01 = idx00 + GRID_NX;
    const idx11 = idx01 + 1;

    const sdf = this.sdf;
    const sdfNormX = this.sdfNormX;
    const sdfNormY = this.sdfNormY;

    const dist =
      w00 * sdf[idx00] + w10 * sdf[idx10] + w01 * sdf[idx01] + w11 * sdf[idx11];
    let nx =
      w00 * sdfNormX[idx00] +
      w10 * sdfNormX[idx10] +
      w01 * sdfNormX[idx01] +
      w11 * sdfNormX[idx11];
    let ny =
      w00 * sdfNormY[idx00] +
      w10 * sdfNormY[idx10] +
      w01 * sdfNormY[idx01] +
      w11 * sdfNormY[idx11];

    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1e-6) {
      const invLen = 1.0 / len;
      nx *= invLen;
      ny *= invLen;
    } else {
      nx = 0;
      ny = 1;
    }

    return { dist, nx, ny };
  }
}
