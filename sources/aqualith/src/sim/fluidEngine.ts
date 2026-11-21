import {
  CELL_SIZE,
  CellType,
  GRAVITY,
  GRID_NX,
  GRID_NY,
  INV_CELL_SIZE,
  MAX_PARTICLES,
  MAX_SPRAY,
  MAX_STEAM,
  PARTICLE_RADIUS,
  SolidKind,
  WORLD_H,
  WORLD_W,
  type FluidTelemetry,
  type IFluidEngine,
  type IMechanismSystem,
  type ITerrainGrid,
  type QualityLevel,
  type ToolForceInput,
} from '../types.ts';

const CELL_COUNT = GRID_NX * GRID_NY;
const U_STRIDE = GRID_NX + 1;
const U_COUNT = U_STRIDE * GRID_NY;
const V_COUNT = GRID_NX * (GRID_NY + 1);

const MIN_X_BOUND = CELL_SIZE * 1.05;
const MAX_X_BOUND = WORLD_W - CELL_SIZE * 1.05;
const MIN_Y_BOUND = CELL_SIZE * 1.05;
const MAX_Y_BOUND = WORLD_H - CELL_SIZE * 1.05;

const HASH_COLS = 192;
const HASH_ROWS = 108;
const HASH_SIZE = HASH_COLS * HASH_ROWS;
const MIN_PARTICLE_DIST = 2.0 * PARTICLE_RADIUS;
const HASH_INV_CELL = 1.0 / MIN_PARTICLE_DIST;

export class FluidEngine implements IFluidEngine {
  numParticles = 0;
  readonly px = new Float32Array(MAX_PARTICLES);
  readonly py = new Float32Array(MAX_PARTICLES);
  readonly vx = new Float32Array(MAX_PARTICLES);
  readonly vy = new Float32Array(MAX_PARTICLES);
  readonly foam = new Float32Array(MAX_PARTICLES);
  readonly temp = new Float32Array(MAX_PARTICLES);

  numSpray = 0;
  readonly spx = new Float32Array(MAX_SPRAY);
  readonly spy = new Float32Array(MAX_SPRAY);
  readonly svx = new Float32Array(MAX_SPRAY);
  readonly svy = new Float32Array(MAX_SPRAY);
  readonly slife = new Float32Array(MAX_SPRAY);
  readonly smaxLife = new Float32Array(MAX_SPRAY);

  numSteam = 0;
  readonly stx = new Float32Array(MAX_STEAM);
  readonly sty = new Float32Array(MAX_STEAM);
  readonly stvx = new Float32Array(MAX_STEAM);
  readonly stvy = new Float32Array(MAX_STEAM);
  readonly stlife = new Float32Array(MAX_STEAM);
  readonly stmaxLife = new Float32Array(MAX_STEAM);

  readonly u = new Float32Array(U_COUNT);
  readonly v = new Float32Array(V_COUNT);
  readonly pressure = new Float32Array(CELL_COUNT);
  readonly cellType = new Uint8Array(CELL_COUNT);
  readonly particleVBOData = new Float32Array(MAX_PARTICLES * 5);

  readonly telemetry: FluidTelemetry = {
    particleCount: 0,
    avgSpeed: 0,
    kineticEnergy: 0,
    splashIntensity: 0,
    iceFreezeCount: 0,
    iceShatterCount: 0,
    wallBreakCount: 0,
    magmaSteamIntensity: 0,
    magmaQuenchCount: 0,
    maxTurbineRpm: 0,
    maxTurbineCharge: 0,
    turbineCompletePulseCount: 0,
    mineDetonateCount: 0,
    valveToggleCount: 0,
    portalPulseCount: 0,
    relayActiveIntensity: 0,
  };

  private readonly prevU = new Float32Array(U_COUNT);
  private readonly duW = new Float32Array(U_COUNT);
  private readonly validU = new Uint8Array(U_COUNT);

  private readonly prevV = new Float32Array(V_COUNT);
  private readonly dvW = new Float32Array(V_COUNT);
  private readonly validV = new Uint8Array(V_COUNT);

  private readonly particleDensity = new Float32Array(CELL_COUNT);

  private readonly cellCount = new Int32Array(HASH_SIZE);
  private readonly cellStart = new Int32Array(HASH_SIZE + 1);
  private readonly cellEntries = new Int32Array(MAX_PARTICLES);

  private sdfDist = 0;
  private sdfNx = 0;
  private sdfNy = 1;
  private simTime = 0;
  private pourAccumulator = 0;
  private stepImpactEnergy = 0;

  reset(): void {
    this.numParticles = 0;
    this.numSpray = 0;
    this.numSteam = 0;
    this.simTime = 0;
    this.pourAccumulator = 0;
    this.stepImpactEnergy = 0;

    this.u.fill(0);
    this.prevU.fill(0);
    this.duW.fill(0);
    this.validU.fill(0);

    this.v.fill(0);
    this.prevV.fill(0);
    this.dvW.fill(0);
    this.validV.fill(0);

    this.cellType.fill(CellType.AIR);
    this.particleDensity.fill(0);
    this.pressure.fill(0);
    this.particleVBOData.fill(0);

    const t = this.telemetry;
    t.particleCount = 0;
    t.avgSpeed = 0;
    t.kineticEnergy = 0;
    t.splashIntensity = 0;
    t.iceFreezeCount = 0;
    t.iceShatterCount = 0;
    t.wallBreakCount = 0;
    t.magmaSteamIntensity = 0;
    t.magmaQuenchCount = 0;
    t.maxTurbineRpm = 0;
    t.maxTurbineCharge = 0;
    t.turbineCompletePulseCount = 0;
    t.mineDetonateCount = 0;
    t.valveToggleCount = 0;
    t.portalPulseCount = 0;
    t.relayActiveIntensity = 0;
  }

  spawnPool(
    x: number,
    y: number,
    w: number,
    h: number,
    maxCap: number,
    fillFactor = 1.0
  ): number {
    const cap = maxCap < MAX_PARTICLES ? maxCap : MAX_PARTICLES;
    if (this.numParticles >= cap || w <= 0 || h <= 0 || fillFactor <= 0) return 0;

    const effectiveFactor = fillFactor <= 1.0 ? fillFactor : 1.0;
    const spacingScale = fillFactor > 1.0 ? 1.0 / Math.sqrt(fillFactor) : 1.0;
    const dx = MIN_PARTICLE_DIST * spacingScale;
    const dy = dx * 0.8660254;
    const effectiveH = h * effectiveFactor;

    const x0 = x + dx * 0.35;
    const x1 = x + w - dx * 0.35;
    const y0 = y + dy * 0.35;
    const y1 = y + effectiveH - dy * 0.35;

    let added = 0;
    let row = 0;
    for (let py = y0; py <= y1 && this.numParticles < cap; py += dy, row++) {
      const stagger = (row & 1) === 1 ? dx * 0.5 : 0;
      for (let px = x0 + stagger; px <= x1 && this.numParticles < cap; px += dx) {
        const jx = px + (Math.random() - 0.5) * 0.004;
        const jy = py + (Math.random() - 0.5) * 0.004;
        const cx = jx < MIN_X_BOUND ? MIN_X_BOUND : jx > MAX_X_BOUND ? MAX_X_BOUND : jx;
        const cy = jy < MIN_Y_BOUND ? MIN_Y_BOUND : jy > MAX_Y_BOUND ? MAX_Y_BOUND : jy;

        const idx = this.numParticles++;
        this.px[idx] = cx;
        this.py[idx] = cy;
        this.vx[idx] = 0;
        this.vy[idx] = 0;
        this.foam[idx] = 0;
        this.temp[idx] = 0.2;
        added++;
      }
    }

    if (added > 0) {
      this.packVBO();
      this.telemetry.particleCount = this.numParticles;
    }
    return added;
  }

  spawnJet(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    speed: number,
    count: number,
    radius: number,
    maxCap = MAX_PARTICLES
  ): number {
    const cap = maxCap < MAX_PARTICLES ? maxCap : MAX_PARTICLES;
    if (this.numParticles >= cap || count <= 0) return 0;

    let nx = dirX;
    let ny = dirY;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1e-6) {
      nx /= len;
      ny /= len;
    } else {
      nx = 1;
      ny = 0;
    }

    const perpX = -ny;
    const perpY = nx;
    const safeSpeed = speed < 0 ? 0 : speed > 16.0 ? 16.0 : speed;
    const startIdx = this.numParticles;
    let added = 0;

    for (let k = 0; k < count && this.numParticles < cap; k++) {
      const lat = (Math.random() * 2.0 - 1.0) * radius;
      const fwd = Math.random() * 0.045;
      let sx = x + perpX * lat + nx * fwd;
      let sy = y + perpY * lat + ny * fwd;
      if (sx < MIN_X_BOUND) sx = MIN_X_BOUND;
      else if (sx > MAX_X_BOUND) sx = MAX_X_BOUND;
      if (sy < MIN_Y_BOUND) sy = MIN_Y_BOUND;
      else if (sy > MAX_Y_BOUND) sy = MAX_Y_BOUND;

      const spread = (Math.random() - 0.5) * 0.45;
      const spdVar = safeSpeed * (0.94 + Math.random() * 0.12);
      const idx = this.numParticles++;
      this.px[idx] = sx;
      this.py[idx] = sy;
      this.vx[idx] = nx * spdVar + perpX * spread;
      this.vy[idx] = ny * spdVar + perpY * spread;
      this.foam[idx] = 0.25;
      this.temp[idx] = 0.2;
      added++;
    }

    if (added > 0) {
      const vbo = this.particleVBOData;
      for (let p = startIdx; p < this.numParticles; p++) {
        const o = p * 5;
        vbo[o] = this.px[p];
        vbo[o + 1] = this.py[p];
        vbo[o + 2] = this.vx[p];
        vbo[o + 3] = this.vy[p];
        vbo[o + 4] = this.foam[p];
      }
      this.telemetry.particleCount = this.numParticles;
    }
    return added;
  }

  spawnSpray(x: number, y: number, vx: number, vy: number, life: number): void {
    if (this.numSpray >= MAX_SPRAY) return;
    const idx = this.numSpray++;
    this.spx[idx] = x;
    this.spy[idx] = y;
    this.svx[idx] = vx;
    this.svy[idx] = vy;
    const safeLife = life > 1e-4 ? life : 1e-4;
    this.slife[idx] = safeLife;
    this.smaxLife[idx] = safeLife;
  }

  spawnSteam(x: number, y: number, vx: number, vy: number, life: number): void {
    if (this.numSteam >= MAX_STEAM) return;
    const idx = this.numSteam++;
    this.stx[idx] = x;
    this.sty[idx] = y;
    this.stvx[idx] = vx;
    this.stvy[idx] = vy;
    const safeLife = life > 1e-4 ? life : 1e-4;
    this.stlife[idx] = safeLife;
    this.stmaxLife[idx] = safeLife;
  }

  removeParticle(index: number): void {
    if (index < 0 || index >= this.numParticles) return;
    const last = --this.numParticles;
    if (index !== last) {
      this.px[index] = this.px[last];
      this.py[index] = this.py[last];
      this.vx[index] = this.vx[last];
      this.vy[index] = this.vy[last];
      this.foam[index] = this.foam[last];
      this.temp[index] = this.temp[last];
    }
  }

  triggerTsunami(maxCap: number): void {
    const cap = maxCap < MAX_PARTICLES ? maxCap : MAX_PARTICLES;

    // Surge existing water near the left side rightward
    for (let p = 0; p < this.numParticles; p++) {
      if (this.px[p] < 5.0) {
        const weight = 1.0 - this.px[p] / 5.0;
        this.vx[p] += (6.0 + 5.0 * weight) * 0.7;
        this.vy[p] += 1.6 * weight;
        this.foam[p] = Math.min(1.0, this.foam[p] + 0.45 * weight);
      }
    }

    // Spawn a tall breaking wave wall on the left
    const dx = MIN_PARTICLE_DIST * 1.05;
    const dy = dx * 0.8660254;
    let row = 0;
    for (let py = 0.35; py <= 5.2 && this.numParticles < cap; py += dy, row++) {
      const stagger = (row & 1) === 1 ? dx * 0.5 : 0;
      const maxX = 2.6 - py * 0.14;
      for (let px = 0.35 + stagger; px <= maxX && this.numParticles < cap; px += dx) {
        const idx = this.numParticles++;
        this.px[idx] = px + (Math.random() - 0.5) * 0.008;
        this.py[idx] = py + (Math.random() - 0.5) * 0.008;
        this.vx[idx] = 9.0 + Math.random() * 2.5 + py * 0.35;
        this.vy[idx] = 0.5 + py * 0.25 + (Math.random() - 0.5) * 0.6;
        this.foam[idx] = py > 3.2 ? 0.85 : 0.45;
        this.temp[idx] = 0.2;
      }
    }

    // Spawn crest spray droplets
    for (let s = 0; s < 90; s++) {
      this.spawnSpray(
        1.2 + Math.random() * 1.4,
        3.5 + Math.random() * 1.8,
        8.5 + Math.random() * 4.5,
        1.5 + Math.random() * 3.0,
        0.4 + Math.random() * 0.45
      );
    }

    this.packVBO();
    this.telemetry.particleCount = this.numParticles;
  }

  queryPressureRect(x: number, y: number, w: number, h: number): number {
    if (w <= 0 || h <= 0) return 0;

    const iMin = Math.max(0, Math.floor(x * INV_CELL_SIZE));
    const iMax = Math.min(GRID_NX - 1, Math.floor((x + w) * INV_CELL_SIZE));
    const jMin = Math.max(0, Math.floor(y * INV_CELL_SIZE));
    const jMax = Math.min(GRID_NY - 1, Math.floor((y + h) * INV_CELL_SIZE));

    let fluidCount = 0;
    let solidCount = 0;
    let sumP = 0;

    for (let j = jMin; j <= jMax; j++) {
      const rowOff = j * GRID_NX;
      for (let i = iMin; i <= iMax; i++) {
        const idx = rowOff + i;
        const ct = this.cellType[idx];
        if (ct === CellType.FLUID) {
          fluidCount++;
          const pVal = this.pressure[idx];
          if (pVal > 0) sumP += pVal;
        } else if (ct === CellType.SOLID) {
          solidCount++;
        }
      }
    }

    if (fluidCount > 0) {
      return sumP / fluidCount;
    }

    // If rect covers a solid structure (gate / cracked wall), sample 1-cell halo fluid pressure
    if (solidCount > 0) {
      const hiMin = Math.max(0, iMin - 1);
      const hiMax = Math.min(GRID_NX - 1, iMax + 1);
      const hjMin = Math.max(0, jMin - 1);
      const hjMax = Math.min(GRID_NY - 1, jMax + 1);
      let haloFluid = 0;
      let haloSum = 0;
      for (let j = hjMin; j <= hjMax; j++) {
        const rowOff = j * GRID_NX;
        for (let i = hiMin; i <= hiMax; i++) {
          const idx = rowOff + i;
          if (this.cellType[idx] === CellType.FLUID) {
            haloFluid++;
            const pVal = this.pressure[idx];
            if (pVal > 0) haloSum += pVal;
          }
        }
      }
      if (haloFluid > 0) {
        return haloSum / haloFluid;
      }
    }

    return 0;
  }

  countParticlesInRect(x: number, y: number, w: number, h: number): number {
    if (w <= 0 || h <= 0) return 0;
    const xEnd = x + w;
    const yEnd = y + h;
    let count = 0;
    for (let p = 0; p < this.numParticles; p++) {
      const px = this.px[p];
      const py = this.py[p];
      if (px >= x && px <= xEnd && py >= y && py <= yEnd) {
        count++;
      }
    }
    return count;
  }

  step(
    dt: number,
    terrain: ITerrainGrid,
    toolInput: ToolForceInput | null,
    mechanisms: IMechanismSystem,
    quality: QualityLevel,
    maxTotalParticles: number
  ): void {
    if (dt <= 0) return;
    const stepDt = dt < 1.0 / 30.0 ? dt : 1.0 / 30.0;
    this.simTime += stepDt;
    this.stepImpactEnergy = 0;

    // 1. Update dynamic mechanisms (sluice gates, dynamic walls) & rebuild SDF if terrain changed
    mechanisms.preStep(terrain, stepDt);
    terrain.rebuildSDFIfDirty();

    // 2. Tool forces & gravity
    this.applyToolInput(stepDt, terrain, toolInput, maxTotalParticles);
    const gravDv = GRAVITY * stepDt;
    for (let p = 0; p < this.numParticles; p++) {
      this.vy[p] += gravDv;
    }

    // 3. Substepped advection + SDF collision
    this.advectAndCollide(stepDt, terrain, mechanisms);

    // 4. Couple with dynamic mechanisms (turbines, buoyant bodies, cracked walls)
    mechanisms.coupleParticles(this, terrain, stepDt);

    // 5. Particle-particle relaxation (2 iterations) + position-only SDF sanity projection
    this.pushParticlesApart(2, terrain, mechanisms);

    // 6. P2G staggered MAC transfer
    this.particlesToGrid(terrain);

    // 7. Incompressibility + density drift compensation (Gauss-Seidel SOR)
    const iters = quality === 'ultra' ? 32 : 26;
    this.solvePressure(iters);

    // 8. G2P transfer (FLIP/PIC blend)
    this.gridToParticles();

    // 9. Post-step effects, mechanisms, drains, telemetry, and VBO packing
    this.stepEffectsAndPost(stepDt, terrain, mechanisms, maxTotalParticles);
  }

  private applyToolInput(
    dt: number,
    terrain: ITerrainGrid,
    toolInput: ToolForceInput | null,
    maxTotalParticles: number
  ): void {
    if (!toolInput) return;

    const tool = toolInput.tool;
    if (tool === 'surge' && toolInput.active) {
      const radius = 1.45;
      const r2 = radius * radius;
      let tvx = toolInput.vx;
      let tvy = toolInput.vy;
      const speed = Math.sqrt(tvx * tvx + tvy * tvy);
      if (speed > 15.5) {
        const s = 15.5 / speed;
        tvx *= s;
        tvy *= s;
      }
      const absVx = tvx < 0 ? -tvx : tvx;
      let liftBase = 0;
      if (tvy >= -0.3 * absVx) {
        const diagBonus = tvy > 0.4 ? (tvy * 0.55 < 4.5 ? tvy * 0.55 : 4.5) : 0;
        const horizLift = absVx > 0.6 ? absVx * 1.9 : 0;
        const rawLift = horizLift + diagBonus;
        liftBase = rawLift < 11.5 ? rawLift : 11.5;
      }
      const foamAdd = (speed * 0.09 < 1.0 ? speed * 0.09 : 1.0) * dt * 6.5;

      for (let p = 0; p < this.numParticles; p++) {
        const dx = this.px[p] - toolInput.x;
        const dy = this.py[p] - toolInput.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;

        const falloff = 1.0 - d2 / r2;
        const factor = 20.5 * falloff * dt;
        this.vx[p] += tvx * factor;
        this.vy[p] += (tvy * 20.5 + liftBase) * falloff * dt;

        const f = this.foam[p] + falloff * foamAdd;
        this.foam[p] = f > 1.0 ? 1.0 : f;
      }

      if (speed > 5.0 && Math.random() < 0.35) {
        this.spawnSpray(
          toolInput.x + (Math.random() - 0.5) * 0.5,
          toolInput.y + (Math.random() - 0.5) * 0.35,
          tvx * 0.8 + (Math.random() - 0.5) * 1.8,
          tvy * 0.8 + 1.5 + Math.random() * 1.8,
          0.25 + Math.random() * 0.25
        );
      }
    } else if (tool === 'vortex') {
      if (toolInput.active) {
        const cx = toolInput.chargePos ? toolInput.chargePos.x : toolInput.x;
        const cy = toolInput.chargePos ? toolInput.chargePos.y : toolInput.y;
        const radius = 2.85;
        const r2 = radius * radius;
        const boost = toolInput.chargeTime * 0.6 + 1.0 < 2.1 ? toolInput.chargeTime * 0.6 + 1.0 : 2.1;
        const sign = toolInput.secondary ? -1.0 : 1.0;

        for (let p = 0; p < this.numParticles; p++) {
          const dx = cx - this.px[p];
          const dy = cy - this.py[p];
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2) continue;

          const dist = Math.sqrt(d2);
          const falloff = 1.0 - dist / radius;
          const rx = dist > 1e-4 ? dx / dist : 0;
          const ry = dist > 1e-4 ? dy / dist : 0;
          const tx = -ry * sign;
          const ty = rx * sign;

          const vRad = this.vx[p] * rx + this.vy[p] * ry;
          const vTan = this.vx[p] * tx + this.vy[p] * ty;

          let radialAccel: number;
          let tangentAccel: number;
          let antiGrav: number;

          if (dist < 0.42) {
            radialAccel = (dist / 0.42) * 24.0 - vRad * 6.5;
            const targetTan = 6.5 * boost;
            tangentAccel = (targetTan - vTan) * 9.5;
            antiGrav = -GRAVITY * (1.02 + 0.18 * falloff);
          } else {
            radialAccel = (16.0 + 26.0 * falloff) * boost - vRad * (2.5 + 2.5 * falloff);
            const targetTan = 8.5 * boost;
            tangentAccel = (targetTan - vTan) * (4.0 + 3.5 * falloff);
            antiGrav = -GRAVITY * (0.45 + 0.55 * falloff);
          }

          this.vx[p] += (rx * radialAccel + tx * tangentAccel) * dt;
          this.vy[p] += (ry * radialAccel + ty * tangentAccel + antiGrav) * dt;

          const f = this.foam[p] + (0.45 + 0.45 * falloff) * dt;
          this.foam[p] = f > 1.0 ? 1.0 : f;
        }
      }

      if (toolInput.releaseBurst) {
        const rb = toolInput.releaseBurst;
        let dirX = rb.dirX;
        let dirY = rb.dirY;
        const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
        if (dirLen > 1e-6) {
          dirX /= dirLen;
          dirY /= dirLen;
        } else {
          dirX = 1;
          dirY = 0;
        }

        const radius = 2.15;
        const r2 = radius * radius;
        const maxStrength = rb.strength < 17.5 ? rb.strength : 17.5;

        for (let p = 0; p < this.numParticles; p++) {
          const dx = this.px[p] - rb.x;
          const dy = this.py[p] - rb.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2) continue;

          const dist = Math.sqrt(d2);
          const t = 1.0 - dist / radius;
          const falloff = 0.52 + 0.48 * t * (2.0 - t);
          const blastSpeed = maxStrength * falloff;

          this.vx[p] = this.vx[p] * 0.15 + dirX * blastSpeed;
          this.vy[p] = this.vy[p] * 0.15 + dirY * blastSpeed;
          this.foam[p] = 1.0;

          if (Math.random() < 0.22) {
            this.spawnSpray(
              this.px[p],
              this.py[p],
              dirX * blastSpeed * (0.92 + Math.random() * 0.35) + (Math.random() - 0.5) * 2.4,
              dirY * blastSpeed * (0.92 + Math.random() * 0.35) + (Math.random() - 0.5) * 2.4,
              0.32 + Math.random() * 0.38
            );
          }
        }
        this.stepImpactEnergy += maxStrength * 0.085;
      }
    } else if (tool === 'pour' && toolInput.active) {
      this.sampleTerrainSDF(terrain, toolInput.x, toolInput.y);
      if (this.sdfDist > -0.02) {
        this.pourAccumulator += dt * 360.0;
        const emitCount = Math.floor(this.pourAccumulator);
        if (emitCount > 0) {
          this.pourAccumulator -= emitCount;
          const cappedEmit = emitCount < 10 ? emitCount : 10;
          const dirX = Math.max(-0.8, Math.min(0.8, toolInput.vx * 0.2));
          const dirY = -1.0 + Math.max(-0.4, Math.min(0.4, toolInput.vy * 0.12));
          this.spawnJet(
            toolInput.x,
            toolInput.y,
            dirX,
            dirY,
            4.5,
            cappedEmit,
            0.13,
            maxTotalParticles
          );
        }
      }
    } else if (tool === 'drain' && toolInput.active) {
      const r2 = 0.75 * 0.75;
      for (let p = this.numParticles - 1; p >= 0; p--) {
        const dx = this.px[p] - toolInput.x;
        const dy = this.py[p] - toolInput.y;
        if (dx * dx + dy * dy <= r2) {
          this.removeParticle(p);
        }
      }
    }
  }

  private advectAndCollide(
    dt: number,
    terrain: ITerrainGrid,
    mechanisms: IMechanismSystem
  ): void {
    const subDt = dt * 0.5;
    const drains = mechanisms.drains;
    const drainCount = drains.length;

    for (let sub = 0; sub < 2; sub++) {
      for (let p = 0; p < this.numParticles; p++) {
        let x = this.px[p] + this.vx[p] * subDt;
        let y = this.py[p] + this.vy[p] * subDt;

        // SDF collision
        this.sampleTerrainSDF(terrain, x, y);
        const dist = this.sdfDist;
        if (dist < PARTICLE_RADIUS) {
          const nx = this.sdfNx;
          const ny = this.sdfNy;
          const push = PARTICLE_RADIUS - dist;
          x += nx * push;
          y += ny * push;

          const pvx = this.vx[p];
          const pvy = this.vy[p];
          const vn = pvx * nx + pvy * ny;
          if (vn < 0) {
            const tx = pvx - vn * nx;
            const ty = pvy - vn * ny;

            const sx = Math.floor((x - nx * CELL_SIZE * 0.6) * INV_CELL_SIZE);
            const sy = Math.floor((y - ny * CELL_SIZE * 0.6) * INV_CELL_SIZE);
            let kind = terrain.getKindAtCell(sx, sy);
            if (kind === SolidKind.NONE) {
              kind = terrain.getKindAtCell(
                Math.floor(x * INV_CELL_SIZE),
                Math.floor(y * INV_CELL_SIZE)
              );
            }
            const fric = kind === SolidKind.ICE ? 0.985 : 0.94;
            const impactSpeed = -vn;
            const restitution = impactSpeed > 3.2 ? 0.12 : 0.0;

            this.vx[p] = tx * fric - restitution * vn * nx;
            this.vy[p] = ty * fric - restitution * vn * ny;

            if (impactSpeed > 3.2) {
              const fSpike = (impactSpeed - 3.0) * 0.14;
              const nf = this.foam[p] + (fSpike < 0.85 ? fSpike : 0.85);
              this.foam[p] = nf > 1.0 ? 1.0 : nf;
              this.stepImpactEnergy += (impactSpeed - 3.2) * 0.015;

              const sprayProb = (impactSpeed - 3.2) * 0.075;
              if (Math.random() < (sprayProb < 0.45 ? sprayProb : 0.45)) {
                this.spawnSpray(
                  x,
                  y,
                  tx * 0.65 + nx * impactSpeed * 0.42 + (Math.random() - 0.5) * 2.2,
                  ty * 0.65 + ny * impactSpeed * 0.42 + Math.random() * 2.0,
                  0.25 + Math.random() * 0.35
                );
              }
            }
          }
        }

        // Clamp strictly inside world boundaries (allowing bottom drains to pass through j=0)
        if (x < MIN_X_BOUND) {
          x = MIN_X_BOUND;
          if (this.vx[p] < 0) this.vx[p] = 0;
        } else if (x > MAX_X_BOUND) {
          x = MAX_X_BOUND;
          if (this.vx[p] > 0) this.vx[p] = 0;
        }

        if (y < MIN_Y_BOUND) {
          let overBottomDrain = false;
          for (let d = 0; d < drainCount; d++) {
            const dr = drains[d];
            if (dr.y <= CELL_SIZE && x >= dr.x && x <= dr.x + dr.w) {
              overBottomDrain = true;
              break;
            }
          }
          if (overBottomDrain) {
            if (y < 0.01) y = 0.01;
          } else {
            y = MIN_Y_BOUND;
            if (this.vy[p] < 0) this.vy[p] = 0;
          }
        } else if (y > MAX_Y_BOUND) {
          y = MAX_Y_BOUND;
          if (this.vy[p] > 0) this.vy[p] = 0;
        }

        this.px[p] = x;
        this.py[p] = y;
      }
    }
  }

  private pushParticlesApart(
    iters: number,
    terrain: ITerrainGrid,
    mechanisms: IMechanismSystem
  ): void {
    const n = this.numParticles;
    if (n <= 1) return;

    const minDist = MIN_PARTICLE_DIST;
    const minDist2 = minDist * minDist;
    const cellCount = this.cellCount;
    const cellStart = this.cellStart;
    const cellEntries = this.cellEntries;
    const px = this.px;
    const py = this.py;

    for (let iter = 0; iter < iters; iter++) {
      cellCount.fill(0);
      for (let p = 0; p < n; p++) {
        let cx = Math.floor(px[p] * HASH_INV_CELL);
        let cy = Math.floor(py[p] * HASH_INV_CELL);
        if (cx < 0) cx = 0;
        else if (cx >= HASH_COLS) cx = HASH_COLS - 1;
        if (cy < 0) cy = 0;
        else if (cy >= HASH_ROWS) cy = HASH_ROWS - 1;
        cellCount[cy * HASH_COLS + cx]++;
      }

      let sum = 0;
      for (let c = 0; c < HASH_SIZE; c++) {
        sum += cellCount[c];
        cellStart[c] = sum;
      }
      cellStart[HASH_SIZE] = sum;

      for (let p = 0; p < n; p++) {
        let cx = Math.floor(px[p] * HASH_INV_CELL);
        let cy = Math.floor(py[p] * HASH_INV_CELL);
        if (cx < 0) cx = 0;
        else if (cx >= HASH_COLS) cx = HASH_COLS - 1;
        if (cy < 0) cy = 0;
        else if (cy >= HASH_ROWS) cy = HASH_ROWS - 1;
        cellEntries[--cellStart[cy * HASH_COLS + cx]] = p;
      }

      for (let p = 0; p < n; p++) {
        const pxi = px[p];
        const pyi = py[p];
        let cx = Math.floor(pxi * HASH_INV_CELL);
        let cy = Math.floor(pyi * HASH_INV_CELL);
        if (cx < 0) cx = 0;
        else if (cx >= HASH_COLS) cx = HASH_COLS - 1;
        if (cy < 0) cy = 0;
        else if (cy >= HASH_ROWS) cy = HASH_ROWS - 1;

        const x0 = cx > 0 ? cx - 1 : 0;
        const x1 = cx < HASH_COLS - 1 ? cx + 1 : HASH_COLS - 1;
        const y0 = cy > 0 ? cy - 1 : 0;
        const y1 = cy < HASH_ROWS - 1 ? cy + 1 : HASH_ROWS - 1;

        for (let ny = y0; ny <= y1; ny++) {
          const rowOff = ny * HASH_COLS;
          for (let nx = x0; nx <= x1; nx++) {
            const cell = rowOff + nx;
            const start = cellStart[cell];
            const end = cellStart[cell + 1];
            for (let k = start; k < end; k++) {
              const q = cellEntries[k];
              if (q <= p) continue;

              let dx = px[q] - pxi;
              let dy = py[q] - pyi;
              const d2 = dx * dx + dy * dy;
              if (d2 >= minDist2) continue;

              if (d2 > 1e-12) {
                const d = Math.sqrt(d2);
                const s = (0.5 * (minDist - d)) / d;
                dx *= s;
                dy *= s;
              } else {
                const angle = (p & 7) * 0.785398;
                dx = Math.cos(angle) * (0.25 * minDist);
                dy = Math.sin(angle) * (0.25 * minDist);
              }

              px[p] -= dx;
              py[p] -= dy;
              px[q] += dx;
              py[q] += dy;
            }
          }
        }
      }
    }

    // Position-only SDF & bounds projection so relaxation never pushes particles into walls
    const drains = mechanisms.drains;
    const drainCount = drains.length;
    for (let p = 0; p < n; p++) {
      let x = px[p];
      let y = py[p];
      this.sampleTerrainSDF(terrain, x, y);
      if (this.sdfDist < PARTICLE_RADIUS) {
        const push = PARTICLE_RADIUS - this.sdfDist;
        x += this.sdfNx * push;
        y += this.sdfNy * push;
      }

      if (x < MIN_X_BOUND) x = MIN_X_BOUND;
      else if (x > MAX_X_BOUND) x = MAX_X_BOUND;

      if (y < MIN_Y_BOUND) {
        let overBottomDrain = false;
        for (let d = 0; d < drainCount; d++) {
          const dr = drains[d];
          if (dr.y <= CELL_SIZE && x >= dr.x && x <= dr.x + dr.w) {
            overBottomDrain = true;
            break;
          }
        }
        if (overBottomDrain) {
          if (y < 0.01) y = 0.01;
        } else {
          y = MIN_Y_BOUND;
        }
      } else if (y > MAX_Y_BOUND) {
        y = MAX_Y_BOUND;
      }

      px[p] = x;
      py[p] = y;
    }
  }

  private particlesToGrid(terrain: ITerrainGrid): void {
    const cellType = this.cellType;
    const u = this.u;
    const v = this.v;
    const duW = this.duW;
    const dvW = this.dvW;
    const particleDensity = this.particleDensity;

    for (let j = 0; j < GRID_NY; j++) {
      const rowOff = j * GRID_NX;
      for (let i = 0; i < GRID_NX; i++) {
        cellType[rowOff + i] = terrain.isSolidCell(i, j) ? CellType.SOLID : CellType.AIR;
      }
    }

    u.fill(0);
    v.fill(0);
    duW.fill(0);
    dvW.fill(0);
    particleDensity.fill(0);

    const n = this.numParticles;
    const px = this.px;
    const py = this.py;
    const vx = this.vx;
    const vy = this.vy;

    for (let p = 0; p < n; p++) {
      const x = px[p];
      const y = py[p];

      let ci = Math.floor(x * INV_CELL_SIZE);
      let cj = Math.floor(y * INV_CELL_SIZE);
      if (ci < 0) ci = 0;
      else if (ci >= GRID_NX) ci = GRID_NX - 1;
      if (cj < 0) cj = 0;
      else if (cj >= GRID_NY) cj = GRID_NY - 1;
      const cIdx = cj * GRID_NX + ci;
      if (cellType[cIdx] === CellType.AIR) {
        cellType[cIdx] = CellType.FLUID;
      }

      // Cell-centered density splat
      let dx = x * INV_CELL_SIZE - 0.5;
      let dy = y * INV_CELL_SIZE - 0.5;
      if (dx < 0) dx = 0;
      else if (dx > GRID_NX - 1.0001) dx = GRID_NX - 1.0001;
      if (dy < 0) dy = 0;
      else if (dy > GRID_NY - 1.0001) dy = GRID_NY - 1.0001;
      const di0 = Math.floor(dx);
      const dj0 = Math.floor(dy);
      const dtx = dx - di0;
      const dty = dy - dj0;
      const domx = 1.0 - dtx;
      const domy = 1.0 - dty;
      const dIdx00 = dj0 * GRID_NX + di0;
      particleDensity[dIdx00] += domx * domy;
      particleDensity[dIdx00 + 1] += dtx * domy;
      particleDensity[dIdx00 + GRID_NX] += domx * dty;
      particleDensity[dIdx00 + GRID_NX + 1] += dtx * dty;

      // MAC U-face splat: x = i * h, y = (j + 0.5) * h
      let ux = x * INV_CELL_SIZE;
      let uy = y * INV_CELL_SIZE - 0.5;
      if (ux < 0) ux = 0;
      else if (ux > GRID_NX - 1e-4) ux = GRID_NX - 1e-4;
      if (uy < 0) uy = 0;
      else if (uy > GRID_NY - 1.0001) uy = GRID_NY - 1.0001;
      const ui0 = Math.floor(ux);
      const uj0 = Math.floor(uy);
      const utx = ux - ui0;
      const uty = uy - uj0;
      const uomx = 1.0 - utx;
      const uomy = 1.0 - uty;
      const uw00 = uomx * uomy;
      const uw10 = utx * uomy;
      const uw01 = uomx * uty;
      const uw11 = utx * uty;
      const uIdx00 = uj0 * U_STRIDE + ui0;
      const uIdx10 = uIdx00 + 1;
      const uIdx01 = uIdx00 + U_STRIDE;
      const uIdx11 = uIdx01 + 1;
      const pvx = vx[p];
      u[uIdx00] += pvx * uw00;
      u[uIdx10] += pvx * uw10;
      u[uIdx01] += pvx * uw01;
      u[uIdx11] += pvx * uw11;
      duW[uIdx00] += uw00;
      duW[uIdx10] += uw10;
      duW[uIdx01] += uw01;
      duW[uIdx11] += uw11;

      // MAC V-face splat: x = (i + 0.5) * h, y = j * h
      let vxGrid = x * INV_CELL_SIZE - 0.5;
      let vyGrid = y * INV_CELL_SIZE;
      if (vxGrid < 0) vxGrid = 0;
      else if (vxGrid > GRID_NX - 1.0001) vxGrid = GRID_NX - 1.0001;
      if (vyGrid < 0) vyGrid = 0;
      else if (vyGrid > GRID_NY - 1e-4) vyGrid = GRID_NY - 1e-4;
      const vi0 = Math.floor(vxGrid);
      const vj0 = Math.floor(vyGrid);
      const vtx = vxGrid - vi0;
      const vty = vyGrid - vj0;
      const vomx = 1.0 - vtx;
      const vomY = 1.0 - vty;
      const vw00 = vomx * vomY;
      const vw10 = vtx * vomY;
      const vw01 = vomx * vty;
      const vw11 = vtx * vty;
      const vIdx00 = vj0 * GRID_NX + vi0;
      const vIdx10 = vIdx00 + 1;
      const vIdx01 = vIdx00 + GRID_NX;
      const vIdx11 = vIdx01 + 1;
      const pvy = vy[p];
      v[vIdx00] += pvy * vw00;
      v[vIdx10] += pvy * vw10;
      v[vIdx01] += pvy * vw01;
      v[vIdx11] += pvy * vw11;
      dvW[vIdx00] += vw00;
      dvW[vIdx10] += vw10;
      dvW[vIdx01] += vw01;
      dvW[vIdx11] += vw11;
    }

    // Normalize U, enforce SOLID boundaries, copy to prevU, mark validU
    const prevU = this.prevU;
    const validU = this.validU;
    for (let j = 0; j < GRID_NY; j++) {
      const cRow = j * GRID_NX;
      const uRow = j * U_STRIDE;
      for (let i = 0; i <= GRID_NX; i++) {
        const uIdx = uRow + i;
        const leftType = i > 0 ? cellType[cRow + i - 1] : CellType.SOLID;
        const rightType = i < GRID_NX ? cellType[cRow + i] : CellType.SOLID;

        if (leftType === CellType.SOLID || rightType === CellType.SOLID) {
          u[uIdx] = 0;
          prevU[uIdx] = 0;
          validU[uIdx] = 1;
        } else if (duW[uIdx] > 0) {
          const val = u[uIdx] / duW[uIdx];
          u[uIdx] = val;
          prevU[uIdx] = val;
          validU[uIdx] = 1;
        } else if (leftType === CellType.FLUID || rightType === CellType.FLUID) {
          u[uIdx] = 0;
          prevU[uIdx] = 0;
          validU[uIdx] = 1;
        } else {
          u[uIdx] = 0;
          prevU[uIdx] = 0;
          validU[uIdx] = 0;
        }
      }
    }

    // Normalize V, enforce SOLID boundaries, copy to prevV, mark validV
    const prevV = this.prevV;
    const validV = this.validV;
    for (let j = 0; j <= GRID_NY; j++) {
      const vRow = j * GRID_NX;
      const botRow = (j - 1) * GRID_NX;
      const topRow = j * GRID_NX;
      for (let i = 0; i < GRID_NX; i++) {
        const vIdx = vRow + i;
        const botType = j > 0 ? cellType[botRow + i] : CellType.AIR;
        const topType = j < GRID_NY ? cellType[topRow + i] : CellType.SOLID;

        if (botType === CellType.SOLID || topType === CellType.SOLID) {
          v[vIdx] = 0;
          prevV[vIdx] = 0;
          validV[vIdx] = 1;
        } else if (dvW[vIdx] > 0) {
          const val = v[vIdx] / dvW[vIdx];
          v[vIdx] = val;
          prevV[vIdx] = val;
          validV[vIdx] = 1;
        } else if (botType === CellType.FLUID || topType === CellType.FLUID) {
          v[vIdx] = 0;
          prevV[vIdx] = 0;
          validV[vIdx] = 1;
        } else {
          v[vIdx] = 0;
          prevV[vIdx] = 0;
          validV[vIdx] = 0;
        }
      }
    }
  }

  private solvePressure(iters: number): void {
    const overRelaxation = 1.85;
    const restDensity = 3.6;
    const kStiffness = 1.0;

    const cellType = this.cellType;
    const pressure = this.pressure;
    const particleDensity = this.particleDensity;
    const u = this.u;
    const v = this.v;

    pressure.fill(0);

    for (let iter = 0; iter < iters; iter++) {
      for (let j = 0; j < GRID_NY; j++) {
        const rowOff = j * GRID_NX;
        const uRow = j * U_STRIDE;
        const vBotRow = j * GRID_NX;
        const vTopRow = (j + 1) * GRID_NX;

        for (let i = 0; i < GRID_NX; i++) {
          const cIdx = rowOff + i;
          if (cellType[cIdx] !== CellType.FLUID) continue;

          const sx0 = i > 0 ? (cellType[cIdx - 1] !== CellType.SOLID ? 1 : 0) : 0;
          const sx1 = i < GRID_NX - 1 ? (cellType[cIdx + 1] !== CellType.SOLID ? 1 : 0) : 0;
          const sy0 = j > 0 ? (cellType[cIdx - GRID_NX] !== CellType.SOLID ? 1 : 0) : 1;
          const sy1 = j < GRID_NY - 1 ? (cellType[cIdx + GRID_NX] !== CellType.SOLID ? 1 : 0) : 0;
          const s = sx0 + sx1 + sy0 + sy1;
          if (s === 0) continue;

          const uL = uRow + i;
          const uR = uL + 1;
          const vB = vBotRow + i;
          const vT = vTopRow + i;

          let div = u[uR] - u[uL] + (v[vT] - v[vB]);
          const compression = particleDensity[cIdx] - restDensity;
          if (compression > 0) {
            const clampedComp = compression < 4.0 ? compression : 4.0;
            div -= kStiffness * clampedComp;
          }

          const p = (-div / s) * overRelaxation;
          pressure[cIdx] += p;

          u[uL] -= sx0 * p;
          u[uR] += sx1 * p;
          v[vB] -= sy0 * p;
          v[vT] += sy1 * p;
        }
      }
    }
  }

  private gridToParticles(): void {
    const flipRatio = 0.92;
    const picRatio = 1.0 - flipRatio;

    const n = this.numParticles;
    const px = this.px;
    const py = this.py;
    const vx = this.vx;
    const vy = this.vy;

    const u = this.u;
    const prevU = this.prevU;
    const validU = this.validU;

    const v = this.v;
    const prevV = this.prevV;
    const validV = this.validV;

    for (let p = 0; p < n; p++) {
      const x = px[p];
      const y = py[p];

      // Sample U
      let ux = x * INV_CELL_SIZE;
      let uy = y * INV_CELL_SIZE - 0.5;
      if (ux < 0) ux = 0;
      else if (ux > GRID_NX - 1e-4) ux = GRID_NX - 1e-4;
      if (uy < 0) uy = 0;
      else if (uy > GRID_NY - 1.0001) uy = GRID_NY - 1.0001;
      const ui0 = Math.floor(ux);
      const uj0 = Math.floor(uy);
      const utx = ux - ui0;
      const uty = uy - uj0;
      const uomx = 1.0 - utx;
      const uomy = 1.0 - uty;

      const uIdx00 = uj0 * U_STRIDE + ui0;
      const uIdx10 = uIdx00 + 1;
      const uIdx01 = uIdx00 + U_STRIDE;
      const uIdx11 = uIdx01 + 1;

      let picU = 0;
      let dU = 0;
      let wSumU = 0;
      if (validU[uIdx00] !== 0) {
        const w = uomx * uomy;
        const val = u[uIdx00];
        picU += w * val;
        dU += w * (val - prevU[uIdx00]);
        wSumU += w;
      }
      if (validU[uIdx10] !== 0) {
        const w = utx * uomy;
        const val = u[uIdx10];
        picU += w * val;
        dU += w * (val - prevU[uIdx10]);
        wSumU += w;
      }
      if (validU[uIdx01] !== 0) {
        const w = uomx * uty;
        const val = u[uIdx01];
        picU += w * val;
        dU += w * (val - prevU[uIdx01]);
        wSumU += w;
      }
      if (validU[uIdx11] !== 0) {
        const w = utx * uty;
        const val = u[uIdx11];
        picU += w * val;
        dU += w * (val - prevU[uIdx11]);
        wSumU += w;
      }

      let nvx = vx[p];
      if (wSumU > 0) {
        const invW = 1.0 / wSumU;
        picU *= invW;
        dU *= invW;
        nvx = picRatio * picU + flipRatio * (nvx + dU);
      }

      // Sample V
      let vxGrid = x * INV_CELL_SIZE - 0.5;
      let vyGrid = y * INV_CELL_SIZE;
      if (vxGrid < 0) vxGrid = 0;
      else if (vxGrid > GRID_NX - 1.0001) vxGrid = GRID_NX - 1.0001;
      if (vyGrid < 0) vyGrid = 0;
      else if (vyGrid > GRID_NY - 1e-4) vyGrid = GRID_NY - 1e-4;
      const vi0 = Math.floor(vxGrid);
      const vj0 = Math.floor(vyGrid);
      const vtx = vxGrid - vi0;
      const vty = vyGrid - vj0;
      const vomx = 1.0 - vtx;
      const vomY = 1.0 - vty;

      const vIdx00 = vj0 * GRID_NX + vi0;
      const vIdx10 = vIdx00 + 1;
      const vIdx01 = vIdx00 + GRID_NX;
      const vIdx11 = vIdx01 + 1;

      let picV = 0;
      let dV = 0;
      let wSumV = 0;
      if (validV[vIdx00] !== 0) {
        const w = vomx * vomY;
        const val = v[vIdx00];
        picV += w * val;
        dV += w * (val - prevV[vIdx00]);
        wSumV += w;
      }
      if (validV[vIdx10] !== 0) {
        const w = vtx * vomY;
        const val = v[vIdx10];
        picV += w * val;
        dV += w * (val - prevV[vIdx10]);
        wSumV += w;
      }
      if (validV[vIdx01] !== 0) {
        const w = vomx * vty;
        const val = v[vIdx01];
        picV += w * val;
        dV += w * (val - prevV[vIdx01]);
        wSumV += w;
      }
      if (validV[vIdx11] !== 0) {
        const w = vtx * vty;
        const val = v[vIdx11];
        picV += w * val;
        dV += w * (val - prevV[vIdx11]);
        wSumV += w;
      }

      let nvy = vy[p];
      if (wSumV > 0) {
        const invW = 1.0 / wSumV;
        picV *= invW;
        dV *= invW;
        nvy = picRatio * picV + flipRatio * (nvy + dV);
      }

      if (!Number.isFinite(nvx) || !Number.isFinite(nvy)) {
        nvx = 0;
        nvy = 0;
      } else {
        const spdSq = nvx * nvx + nvy * nvy;
        if (spdSq > 342.25) {
          const scale = 18.5 / Math.sqrt(spdSq);
          nvx *= scale;
          nvy *= scale;
        }
      }

      vx[p] = nvx;
      vy[p] = nvy;
    }
  }

  private stepEffectsAndPost(
    dt: number,
    terrain: ITerrainGrid,
    mechanisms: IMechanismSystem,
    maxTotalParticles: number
  ): void {
    // Foam decay + speed aeration
    const foamDecay = Math.exp(-1.7 * dt);
    for (let p = 0; p < this.numParticles; p++) {
      let f = this.foam[p] * foamDecay;
      const spdSq = this.vx[p] * this.vx[p] + this.vy[p] * this.vy[p];
      if (spdSq > 25.0) {
        f += (Math.sqrt(spdSq) - 5.0) * 0.045 * dt;
      }
      this.foam[p] = f > 1.0 ? 1.0 : f < 0.002 ? 0 : f;
    }

    // Step Spray droplets
    const sprayDrag = 1.0 - 0.75 * dt > 0 ? 1.0 - 0.75 * dt : 0;
    const gravDv = GRAVITY * dt;
    for (let i = this.numSpray - 1; i >= 0; i--) {
      const life = this.slife[i] - dt;
      if (life <= 0) {
        const last = --this.numSpray;
        if (i !== last) {
          this.spx[i] = this.spx[last];
          this.spy[i] = this.spy[last];
          this.svx[i] = this.svx[last];
          this.svy[i] = this.svy[last];
          this.slife[i] = this.slife[last];
          this.smaxLife[i] = this.smaxLife[last];
        }
        continue;
      }

      this.svy[i] += gravDv;
      this.svx[i] *= sprayDrag;
      this.svy[i] *= sprayDrag;
      let sx = this.spx[i] + this.svx[i] * dt;
      let sy = this.spy[i] + this.svy[i] * dt;

      if (sx < 0 || sx > WORLD_W || sy < 0 || sy > WORLD_H) {
        this.slife[i] = 0;
        continue;
      }

      this.sampleTerrainSDF(terrain, sx, sy);
      if (this.sdfDist < 0.015) {
        const nx = this.sdfNx;
        const ny = this.sdfNy;
        const push = 0.015 - this.sdfDist;
        sx += nx * push;
        sy += ny * push;
        const vn = this.svx[i] * nx + this.svy[i] * ny;
        if (vn < 0) {
          const tx = this.svx[i] - vn * nx;
          const ty = this.svy[i] - vn * ny;
          this.svx[i] = tx * 0.7 - 0.25 * vn * nx;
          this.svy[i] = ty * 0.7 - 0.25 * vn * ny;
        }
        this.slife[i] = life - dt * 1.5;
      } else {
        this.slife[i] = life;
      }

      this.spx[i] = sx;
      this.spy[i] = sy;
    }

    // Step Steam wisps (buoyancy + sinusoidal curl + drag)
    const steamDrag = 1.0 - 2.1 * dt > 0 ? 1.0 - 2.1 * dt : 0;
    const steamBuoyDv = 5.8 * dt;
    const tNow = this.simTime;
    for (let i = this.numSteam - 1; i >= 0; i--) {
      const life = this.stlife[i] - dt;
      if (life <= 0 || this.sty[i] > WORLD_H - CELL_SIZE) {
        const last = --this.numSteam;
        if (i !== last) {
          this.stx[i] = this.stx[last];
          this.sty[i] = this.sty[last];
          this.stvx[i] = this.stvx[last];
          this.stvy[i] = this.stvy[last];
          this.stlife[i] = this.stlife[last];
          this.stmaxLife[i] = this.stmaxLife[last];
        }
        continue;
      }

      this.stlife[i] = life;
      const phase = this.stx[i] * 2.4 + this.sty[i] * 3.1 + tNow * 3.6;
      this.stvx[i] = (this.stvx[i] + Math.sin(phase) * 2.8 * dt) * steamDrag;
      this.stvy[i] = (this.stvy[i] + steamBuoyDv) * steamDrag;
      this.stx[i] += this.stvx[i] * dt;
      this.sty[i] += this.stvy[i] * dt;
    }

    // Mechanisms post-step (spouts, magma vents, turbines, gates, cracked walls, debris)
    mechanisms.postStep(this, terrain, dt, maxTotalParticles);

    // Remove particles inside drains
    const drains = mechanisms.drains;
    const drainCount = drains.length;
    if (drainCount > 0) {
      for (let p = this.numParticles - 1; p >= 0; p--) {
        const x = this.px[p];
        const y = this.py[p];
        for (let d = 0; d < drainCount; d++) {
          const dr = drains[d];
          if (
            x >= dr.x &&
            x <= dr.x + dr.w &&
            ((y >= dr.y && y <= dr.y + dr.h) || (dr.y <= CELL_SIZE && y <= CELL_SIZE * 1.1))
          ) {
            this.removeParticle(p);
            break;
          }
        }
      }
    }

    // Update telemetry & pack VBO data
    const n = this.numParticles;
    const vbo = this.particleVBOData;
    let sumSpeed = 0;
    let sumSpeedSq = 0;

    for (let p = 0; p < n; p++) {
      const vx = this.vx[p];
      const vy = this.vy[p];
      const spdSq = vx * vx + vy * vy;
      sumSpeedSq += spdSq;
      sumSpeed += Math.sqrt(spdSq);

      const o = p * 5;
      vbo[o] = this.px[p];
      vbo[o + 1] = this.py[p];
      vbo[o + 2] = vx;
      vbo[o + 3] = vy;
      vbo[o + 4] = this.foam[p];
    }

    const tel = this.telemetry;
    tel.particleCount = n;
    tel.avgSpeed = n > 0 ? sumSpeed / n : 0;
    tel.kineticEnergy = 0.5 * sumSpeedSq;

    const instantSplash = this.stepImpactEnergy < 1.0 ? this.stepImpactEnergy : 1.0;
    const decay = Math.exp(-7.5 * dt);
    const nextSplash = tel.splashIntensity * decay + instantSplash * (1.0 - Math.exp(-14.0 * dt));
    tel.splashIntensity = nextSplash > 1.0 ? 1.0 : nextSplash < 0.001 ? 0 : nextSplash;
  }

  private packVBO(): void {
    const n = this.numParticles;
    const vbo = this.particleVBOData;
    for (let p = 0; p < n; p++) {
      const o = p * 5;
      vbo[o] = this.px[p];
      vbo[o + 1] = this.py[p];
      vbo[o + 2] = this.vx[p];
      vbo[o + 3] = this.vy[p];
      vbo[o + 4] = this.foam[p];
    }
  }

  private sampleTerrainSDF(terrain: ITerrainGrid, wx: number, wy: number): void {
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

    const sdf = terrain.sdf;
    const sdfNormX = terrain.sdfNormX;
    const sdfNormY = terrain.sdfNormY;

    this.sdfDist =
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
      this.sdfNx = nx * invLen;
      this.sdfNy = ny * invLen;
    } else {
      this.sdfNx = 0;
      this.sdfNy = 1;
    }
  }
}
