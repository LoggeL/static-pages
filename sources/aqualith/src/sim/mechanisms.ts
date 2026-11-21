import {
  CELL_SIZE,
  CellType,
  GRAVITY,
  GRID_NX,
  GRID_NY,
  INV_CELL_SIZE,
  MAX_DEBRIS,
  MAX_PARTICLES,
  MAX_SPRAY,
  MAX_STEAM,
  PARTICLE_RADIUS,
  SolidKind,
  WORLD_H,
  WORLD_W,
} from '../types.ts';
import type {
  BuoyantBodyState,
  CisternState,
  CrackedWallState,
  DebrisChunk,
  DrainZoneDef,
  GeyserPumpState,
  HydroMineState,
  HydroRelayState,
  IFluidEngine,
  IMechanismSystem,
  ITerrainGrid,
  LevelDef,
  MagmaVentState,
  MechanismSnapshot,
  ObjectiveStatus,
  PortalPairState,
  RelicGoalState,
  SeesawState,
  SluiceGateState,
  SpoutState,
  TurbineState,
  ValveState,
} from '../types.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const RAD_TO_RPM = 60 / (Math.PI * 2);
const GRID_CELL_COUNT = GRID_NX * GRID_NY;

interface OBBCollisionResult {
  hit: boolean;
  nx: number;
  ny: number;
  pen: number;
  relVn: number;
  leverArm: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  impulseN: number;
}

/**
 * Two-way fluid-structure interaction system for AQUALITH:
 * hydro-turbines, Archimedes buoyant bodies (with steam geyser lift),
 * pressure-reactive cracked basalt walls, magma-to-obsidian vents,
 * counterweight cisterns, sluice gates, spouts, physical debris,
 * hydro-portals, floating hydro-mines, hydraulic seesaws, interactive
 * brass diverter valves, conductive hydro-relays, and geyser pumps.
 */
export class MechanismSystem implements IMechanismSystem {
  turbines: TurbineState[] = [];
  bodies: BuoyantBodyState[] = [];
  goals: RelicGoalState[] = [];
  cisterns: CisternState[] = [];
  gates: SluiceGateState[] = [];
  crackedWalls: CrackedWallState[] = [];
  magmaVents: MagmaVentState[] = [];
  spouts: SpoutState[] = [];
  drains: DrainZoneDef[] = [];
  debris: DebrisChunk[] = [];
  portals: PortalPairState[] = [];
  mines: HydroMineState[] = [];
  seesaws: SeesawState[] = [];
  valves: ValveState[] = [];
  relays: HydroRelayState[] = [];
  pumps: GeyserPumpState[] = [];

  private isSandbox = false;
  private sandboxCounter = 0;
  private pendingValveToggleCount = 0;

  private nearbyIndices = new Int32Array(MAX_PARTICLES);
  private ventTouchIndices = new Int32Array(MAX_PARTICLES);
  private magmaBoilAccum = new Map<string, number>();

  // Zero-GC BFS buffers for HydroRelayState conductivity checks
  private readonly relayVisited = new Uint8Array(GRID_CELL_COUNT);
  private readonly relayParent = new Int32Array(GRID_CELL_COUNT);
  private readonly relayQueue = new Int32Array(GRID_CELL_COUNT);
  private readonly relayRawPath = new Int32Array(GRID_CELL_COUNT);

  // Per-frame seesaw torque & valve angular speed accumulators
  private seesawTorque = new Float64Array(16);
  private valveAngVel = new Float64Array(16);

  // Reusable zero-GC OBB collision result
  private readonly obbOut: OBBCollisionResult = {
    hit: false,
    nx: 0,
    ny: 0,
    pen: 0,
    relVn: 0,
    leverArm: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    impulseN: 0,
  };

  loadLevel(level: LevelDef, terrain: ITerrainGrid): void {
    this.isSandbox = Boolean(level.isSandbox);
    this.sandboxCounter = 0;
    this.pendingValveToggleCount = 0;
    this.magmaBoilAccum.clear();

    this.turbines = level.turbines.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      radius: d.radius,
      angle: 0,
      angularVel: 0,
      charge: 0,
      targetCharge: d.targetCharge ?? 1.0,
      decayRate: d.decayRate,
      lockOnFull: d.lockOnFull ?? true,
      completed: false,
      linkedGateId: d.linkedGateId,
    }));

    this.bodies = level.bodies.map((d) => ({
      id: d.id,
      kind: d.kind,
      x: d.x,
      y: d.y,
      vx: 0,
      vy: 0,
      angle: 0,
      angularVel: 0,
      w: d.w,
      h: d.h,
      density: d.density,
      submergedRatio: 0,
      inGoal: false,
      portalCooldown: 0,
    }));

    this.goals = level.goals.map((d) => ({
      id: d.id,
      bodyId: d.bodyId,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      fulfilled: false,
      pulse: 0,
    }));

    this.cisterns = level.cisterns.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      thresholdParticles: d.thresholdParticles,
      particleCount: 0,
      fillRatio: 0,
      activated: false,
      linkedGateId: d.linkedGateId,
    }));

    this.gates = level.gates.map((d) => ({
      id: d.id,
      baseX: d.x,
      baseY: d.y,
      w: d.w,
      h: d.h,
      x: d.x,
      y: d.y,
      openOffsetX: d.openOffsetX,
      openOffsetY: d.openOffsetY,
      openProgress: 0,
      requiredTriggerIds: [...d.requiredTriggerIds],
      speed: d.speed ?? 1.4,
      isOpen: false,
    }));

    this.crackedWalls = level.crackedWalls.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      hp: d.maxHp,
      maxHp: d.maxHp,
      impactThreshold: d.impactThreshold,
      stressGlow: 0,
      broken: false,
    }));

    this.magmaVents = level.magmaVents.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      heat: d.maxHeat,
      maxHeat: d.maxHeat,
      reheatRate: d.reheatRate,
      quenched: false,
      goalQuench: d.goalQuench ?? false,
      steamPulse: 0,
    }));

    this.spouts = level.spouts.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      dirX: d.dirX,
      dirY: d.dirY,
      speed: d.speed,
      rate: d.rate,
      radius: d.radius,
      maxParticles: d.maxParticles ?? 1_000_000,
      emitted: 0,
      enabled: d.enabled ?? true,
      accumulator: 0,
    }));

    this.drains = level.drains.map((d) => ({ ...d }));
    this.debris = [];

    this.portals = (level.portals ?? []).map((d) => {
      const dirLen = Math.hypot(d.outDirX, d.outDirY);
      return {
        id: d.id,
        inX: d.inX,
        inY: d.inY,
        outX: d.outX,
        outY: d.outY,
        outDirX: dirLen > 1e-5 ? d.outDirX / dirLen : 1,
        outDirY: dirLen > 1e-5 ? d.outDirY / dirLen : 0,
        radius: d.radius,
        boost: d.boost ?? 1.2,
        pulse: 0,
      };
    });

    this.mines = (level.mines ?? []).map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      vx: 0,
      vy: 0,
      angle: 0,
      angularVel: 0,
      radius: d.radius ?? 0.24,
      density: d.density ?? 0.48,
      spawnX: d.x,
      spawnY: d.y,
      detonated: false,
      respawnTimer: 0,
      submergedRatio: 0,
      portalCooldown: 0,
      flash: 0,
    }));

    this.seesaws = (level.seesaws ?? []).map((d) => {
      const restAngle = d.restAngle ?? 0;
      return {
        id: d.id,
        x: d.x,
        y: d.y,
        length: d.length,
        thickness: d.thickness ?? 0.16,
        angle: restAngle,
        angularVel: 0,
        maxAngle: d.maxAngle ?? 0.52,
        restAngle,
        damping: d.damping ?? 2.4,
      };
    });

    this.valves = (level.valves ?? []).map((d) => {
      const toggled = d.initialToggled ?? false;
      return {
        id: d.id,
        x: d.x,
        y: d.y,
        length: d.length,
        thickness: d.thickness ?? 0.14,
        angleA: d.angleA,
        angleB: d.angleB,
        angle: toggled ? d.angleB : d.angleA,
        toggled,
      };
    });

    this.relays = (level.relays ?? []).map((d) => ({
      id: d.id,
      ax: d.ax,
      ay: d.ay,
      bx: d.bx,
      by: d.by,
      radius: d.radius ?? 0.35,
      charge: 0,
      active: false,
      linkedGateId: d.linkedGateId,
      linkedPumpId: d.linkedPumpId,
      isObjective: d.isObjective ?? false,
      bridgePath: [],
    }));

    this.pumps = (level.pumps ?? []).map((d) => {
      const dirLen = Math.hypot(d.dirX, d.dirY);
      const hasNoTriggers = d.requiredTriggerIds.length === 0;
      return {
        id: d.id,
        x: d.x,
        y: d.y,
        dirX: dirLen > 1e-5 ? d.dirX / dirLen : 0,
        dirY: dirLen > 1e-5 ? d.dirY / dirLen : 1,
        force: d.force,
        range: d.range,
        radius: d.radius,
        requiredTriggerIds: [...d.requiredTriggerIds],
        active: hasNoTriggers,
        power: hasNoTriggers ? 1 : 0,
      };
    });

    this.preStep(terrain, 0);
  }

  preStep(terrain: ITerrainGrid, dt: number): void {
    const safeDt = Math.max(0, dt);

    if (this.valveAngVel.length < this.valves.length) {
      this.valveAngVel = new Float64Array(this.valves.length);
    }

    const valveLerp = 1 - Math.exp(-12.0 * safeDt);
    for (let i = 0; i < this.valves.length; i++) {
      const valve = this.valves[i];
      const targetAngle = valve.toggled ? valve.angleB : valve.angleA;
      let diff = targetAngle - valve.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const stepAngle = diff * valveLerp;
      valve.angle += stepAngle;
      this.valveAngVel[i] = safeDt > 1e-5 ? clamp(stepAngle / safeDt, -12, 12) : 0;
    }

    for (const gate of this.gates) {
      const triggered =
        gate.requiredTriggerIds.length > 0 &&
        gate.requiredTriggerIds.every((id) => this.isTriggerSatisfied(id));

      const target = triggered ? 1.0 : 0.0;
      const maxDelta = gate.speed * safeDt;

      if (gate.openProgress < target) {
        gate.openProgress = Math.min(target, gate.openProgress + maxDelta);
      } else if (gate.openProgress > target) {
        gate.openProgress = Math.max(target, gate.openProgress - maxDelta);
      }

      gate.x = gate.baseX + gate.openOffsetX * gate.openProgress;
      gate.y = gate.baseY + gate.openOffsetY * gate.openProgress;
      gate.isOpen = gate.openProgress > 0.72;
    }

    this.syncDynamicSolids(terrain);
  }

  coupleParticles(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number): void {
    if (dt <= 0) return;

    if (this.pendingValveToggleCount > 0) {
      fluid.telemetry.valveToggleCount =
        (fluid.telemetry.valveToggleCount ?? 0) + this.pendingValveToggleCount;
      this.pendingValveToggleCount = 0;
    }

    if (this.seesawTorque.length < this.seesaws.length) {
      this.seesawTorque = new Float64Array(this.seesaws.length);
    }
    this.seesawTorque.fill(0);

    this.stepRelays(fluid, dt);
    this.stepPumps(fluid, dt);
    this.stepTurbines(fluid, dt);
    this.stepFluidOBBs(fluid, dt);
    this.stepBodies(fluid, terrain, dt);
    const mineBrokeWall = this.stepMines(fluid, terrain, dt);
    this.integrateSeesaws(dt);
    this.stepPortals(fluid, terrain, dt);
    const pressureBrokeWall = this.stepCrackedWalls(fluid, terrain, dt);
    if (mineBrokeWall || pressureBrokeWall) {
      this.syncDynamicSolids(terrain);
    }
    this.stepMagmaVents(fluid, terrain, dt);
    this.stepCisternsAndGoals(fluid, dt);
  }

  postStep(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number, maxTotalParticles: number): void {
    if (dt <= 0) return;

    for (const spout of this.spouts) {
      if (!spout.enabled) continue;
      if (spout.emitted >= spout.maxParticles) continue;
      if (fluid.numParticles >= maxTotalParticles) break;

      spout.accumulator += spout.rate * dt;
      const toEmit = Math.floor(spout.accumulator);
      if (toEmit <= 0) continue;
      spout.accumulator -= toEmit;

      const remainingSpout = spout.maxParticles - spout.emitted;
      const remainingGlobal = maxTotalParticles - fluid.numParticles;
      const count = Math.min(toEmit, remainingSpout, remainingGlobal);
      if (count <= 0) continue;

      const spawned = fluid.spawnJet(
        spout.x,
        spout.y,
        spout.dirX,
        spout.dirY,
        spout.speed,
        count,
        spout.radius,
        maxTotalParticles
      );
      spout.emitted += spawned;
      if (spawned < count) {
        spout.accumulator = Math.min(spout.accumulator, spout.rate * 0.15);
      }
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
        continue;
      }

      d.vy += GRAVITY * 0.9 * dt;
      d.vx *= Math.exp(-0.35 * dt);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.angle += d.angularVel * dt;

      const sdf = terrain.sampleSDF(d.x, d.y);
      const halfSize = d.size * 0.5;
      if (sdf.dist < halfSize) {
        const nLen = Math.hypot(sdf.nx, sdf.ny);
        const nx = nLen > 1e-4 ? sdf.nx / nLen : 0;
        const ny = nLen > 1e-4 ? sdf.ny / nLen : 1;
        const pen = halfSize - sdf.dist;
        d.x += nx * pen;
        d.y += ny * pen;

        const vn = d.vx * nx + d.vy * ny;
        if (vn < 0) {
          d.vx -= 1.42 * vn * nx;
          d.vy -= 1.42 * vn * ny;
          const tx = -ny;
          const ty = nx;
          const vt = d.vx * tx + d.vy * ty;
          d.vx -= tx * vt * 0.22;
          d.vy -= ty * vt * 0.22;
          d.angularVel = d.angularVel * 0.75 + (vt / Math.max(0.04, d.size)) * 0.25;
        }
      }

      if (d.x < -0.5 || d.x > WORLD_W + 0.5 || d.y < -0.5 || d.y > WORLD_H + 1.5) {
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
      }
    }
  }

  spawnIceShards(cells: Array<{ x: number; y: number }>): void {
    const n = cells.length;
    if (n === 0) return;

    const maxShards = 60;
    const count = Math.min(n, maxShards);
    const stride = n / count;

    for (let k = 0; k < count; k++) {
      const c = cells[Math.min(n - 1, Math.floor(k * stride))];
      const maxLife = 1.2 + Math.random() * 0.8;
      this.pushDebris({
        x: c.x + (Math.random() - 0.5) * 0.06,
        y: c.y + (Math.random() - 0.5) * 0.06,
        vx: (Math.random() - 0.5) * 4.4,
        vy: 1.0 + Math.random() * 3.4,
        angle: Math.random() * Math.PI * 2,
        angularVel: (Math.random() - 0.5) * 16,
        size: 0.045 + Math.random() * 0.045,
        life: maxLife,
        maxLife,
        kind: 'ice',
      });
    }
  }

  toggleValveAt(wx: number, wy: number): boolean {
    let bestValve: ValveState | null = null;
    let bestDist2 = Infinity;

    for (const v of this.valves) {
      const maxDist = Math.max(0.85, v.length * 0.65);
      const dx = wx - v.x;
      const dy = wy - v.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= maxDist * maxDist && d2 < bestDist2) {
        bestDist2 = d2;
        bestValve = v;
      }
    }

    if (!bestValve) return false;
    bestValve.toggled = !bestValve.toggled;
    this.pendingValveToggleCount++;
    return true;
  }

  isHoveringValve(wx: number, wy: number): boolean {
    for (const v of this.valves) {
      const maxDist = Math.max(0.75, v.length * 0.58);
      const dx = wx - v.x;
      const dy = wy - v.y;
      if (dx * dx + dy * dy <= maxDist * maxDist) {
        return true;
      }
    }
    return false;
  }

  isLevelComplete(): boolean {
    if (this.isSandbox) return false;

    const goalVents = this.magmaVents.filter((v) => v.goalQuench);
    const goalRelays = this.relays.filter((r) => r.isObjective);
    const hasPrimary =
      this.turbines.length > 0 ||
      this.goals.length > 0 ||
      goalVents.length > 0 ||
      goalRelays.length > 0;

    if (hasPrimary) {
      return (
        this.turbines.every((t) => t.completed) &&
        this.goals.every((g) => g.fulfilled) &&
        goalVents.every((v) => v.quenched) &&
        goalRelays.every((r) => r.active)
      );
    }

    if (this.crackedWalls.length > 0) {
      return this.crackedWalls.every((w) => w.broken);
    }

    if (this.cisterns.length > 0) {
      return this.cisterns.every((c) => c.activated);
    }

    return false;
  }

  getObjectives(): ObjectiveStatus[] {
    if (this.isSandbox) {
      return [{ labelKey: 'objSandbox', progress: 0, done: false }];
    }

    const out: ObjectiveStatus[] = [];

    const goalVents = this.magmaVents.filter((v) => v.goalQuench);
    if (goalVents.length > 0) {
      let quenchedCount = 0;
      let progressSum = 0;
      for (const v of goalVents) {
        if (v.quenched) {
          quenchedCount++;
          progressSum += 1;
        } else {
          const denom = Math.max(1e-4, v.maxHeat);
          progressSum += clamp(1 - v.heat / denom, 0, 1);
        }
      }
      out.push({
        labelKey: 'objMagma',
        progress: progressSum / goalVents.length,
        done: quenchedCount === goalVents.length,
        detail: `${quenchedCount}/${goalVents.length}`,
      });
    }

    const goalRelays = this.relays.filter((r) => r.isObjective);
    if (goalRelays.length > 0) {
      let activeCount = 0;
      let chargeSum = 0;
      for (const r of goalRelays) {
        if (r.active) {
          activeCount++;
          chargeSum += 1;
        } else {
          chargeSum += clamp(r.charge / 0.75, 0, 1);
        }
      }
      out.push({
        labelKey: 'objRelays',
        progress: chargeSum / goalRelays.length,
        done: activeCount === goalRelays.length,
        detail: `${activeCount}/${goalRelays.length}`,
      });
    }

    if (this.crackedWalls.length > 0) {
      let brokenCount = 0;
      let progressSum = 0;
      for (const w of this.crackedWalls) {
        if (w.broken) {
          brokenCount++;
          progressSum += 1;
        } else {
          const denom = Math.max(1e-4, w.maxHp);
          progressSum += clamp(1 - w.hp / denom, 0, 1);
        }
      }
      out.push({
        labelKey: this.mines.length > 0 ? 'objMines' : 'objWalls',
        progress: progressSum / this.crackedWalls.length,
        done: brokenCount === this.crackedWalls.length,
        detail: `${brokenCount}/${this.crackedWalls.length}`,
      });
    }

    if (this.cisterns.length > 0) {
      let activeCount = 0;
      let fillSum = 0;
      for (const c of this.cisterns) {
        if (c.activated) activeCount++;
        fillSum += clamp(c.fillRatio, 0, 1);
      }
      out.push({
        labelKey: 'objCisterns',
        progress: fillSum / this.cisterns.length,
        done: activeCount === this.cisterns.length,
        detail: `${activeCount}/${this.cisterns.length}`,
      });
    }

    if (this.turbines.length > 0) {
      let doneCount = 0;
      let chargeSum = 0;
      for (const t of this.turbines) {
        if (t.completed) {
          doneCount++;
          chargeSum += 1;
        } else {
          const denom = Math.max(1e-4, t.targetCharge);
          chargeSum += clamp(t.charge / denom, 0, 1);
        }
      }
      out.push({
        labelKey: 'objTurbines',
        progress: chargeSum / this.turbines.length,
        done: doneCount === this.turbines.length,
        detail: `${doneCount}/${this.turbines.length}`,
      });
    }

    if (this.goals.length > 0) {
      let fulfilledCount = 0;
      for (const g of this.goals) {
        if (g.fulfilled) fulfilledCount++;
      }
      out.push({
        labelKey: 'objRelics',
        progress: fulfilledCount / this.goals.length,
        done: fulfilledCount === this.goals.length,
        detail: `${fulfilledCount}/${this.goals.length}`,
      });
    }

    return out;
  }

  getSnapshot(): MechanismSnapshot {
    return {
      turbines: this.turbines.map((t) => ({ ...t })),
      bodies: this.bodies.map((b) => ({ ...b })),
      goals: this.goals.map((g) => ({ ...g })),
      cisterns: this.cisterns.map((c) => ({ ...c })),
      gates: this.gates.map((g) => ({
        ...g,
        requiredTriggerIds: [...g.requiredTriggerIds],
      })),
      crackedWalls: this.crackedWalls.map((w) => ({ ...w })),
      magmaVents: this.magmaVents.map((v) => ({ ...v })),
      spouts: this.spouts.map((s) => ({ ...s })),
      drains: this.drains.map((d) => ({ ...d })),
      debris: this.debris.map((d) => ({ ...d })),
      portals: this.portals.map((p) => ({ ...p })),
      mines: this.mines.map((m) => ({ ...m })),
      seesaws: this.seesaws.map((s) => ({ ...s })),
      valves: this.valves.map((v) => ({ ...v })),
      relays: this.relays.map((r) => ({
        ...r,
        bridgePath: r.bridgePath.map((pt) => [pt[0], pt[1]] as [number, number]),
      })),
      pumps: this.pumps.map((p) => ({
        ...p,
        requiredTriggerIds: [...p.requiredTriggerIds],
      })),
    };
  }

  toggleSpouts(enabled?: boolean): void {
    const target = enabled !== undefined ? enabled : !this.spouts.some((s) => s.enabled);
    for (const s of this.spouts) {
      s.enabled = target;
    }
  }

  addSandboxTurbine(x: number, y: number): void {
    this.turbines.push({
      id: `sb_turbine_${++this.sandboxCounter}`,
      x: clamp(x, 0.7, WORLD_W - 0.7),
      y: clamp(y, 0.7, WORLD_H - 0.7),
      radius: 0.55,
      angle: 0,
      angularVel: 0,
      charge: 0,
      targetCharge: 1.0,
      decayRate: 0.05,
      lockOnFull: true,
      completed: false,
    });
  }

  addSandboxBody(x: number, y: number, kind: 'ark' | 'sphere'): void {
    const isArk = kind === 'ark';
    const w = isArk ? 1.05 : 0.52;
    const h = isArk ? 0.42 : 0.52;
    this.bodies.push({
      id: `sb_${kind}_${++this.sandboxCounter}`,
      kind,
      x: clamp(x, w * 0.5 + 0.2, WORLD_W - w * 0.5 - 0.2),
      y: clamp(y, h * 0.5 + 0.2, WORLD_H - h * 0.5 - 0.2),
      vx: 0,
      vy: 0,
      angle: 0,
      angularVel: 0,
      w,
      h,
      density: isArk ? 0.48 : 0.62,
      submergedRatio: 0,
      inGoal: false,
      portalCooldown: 0,
    });
  }

  addSandboxMagma(x: number, y: number): void {
    const w = 1.0;
    const h = 0.28;
    this.magmaVents.push({
      id: `sb_magma_${++this.sandboxCounter}`,
      x: clamp(x - w * 0.5, 0.25, WORLD_W - w - 0.25),
      y: clamp(y - h * 0.5, 0.25, WORLD_H - h - 0.25),
      w,
      h,
      heat: 18,
      maxHeat: 18,
      reheatRate: 1.2,
      quenched: false,
      goalQuench: false,
      steamPulse: 0,
    });
  }

  addSandboxCrackedWall(x: number, y: number): void {
    const w = 0.34;
    const h = 1.35;
    this.crackedWalls.push({
      id: `sb_wall_${++this.sandboxCounter}`,
      x: clamp(x - w * 0.5, 0.25, WORLD_W - w - 0.25),
      y: clamp(y - h * 0.5, 0.25, WORLD_H - h - 0.25),
      w,
      h,
      hp: 12,
      maxHp: 12,
      impactThreshold: 4.5,
      stressGlow: 0,
      broken: false,
    });
  }

  addSandboxMine(x: number, y: number): void {
    const r = 0.24;
    const sx = clamp(x, r + 0.2, WORLD_W - r - 0.2);
    const sy = clamp(y, r + 0.2, WORLD_H - r - 0.2);
    this.mines.push({
      id: `sb_mine_${++this.sandboxCounter}`,
      x: sx,
      y: sy,
      vx: 0,
      vy: 0,
      angle: 0,
      angularVel: 0,
      radius: r,
      density: 0.48,
      spawnX: sx,
      spawnY: sy,
      detonated: false,
      respawnTimer: 0,
      submergedRatio: 0,
      portalCooldown: 0,
      flash: 0,
    });
  }

  addSandboxSeesaw(x: number, y: number): void {
    this.seesaws.push({
      id: `sb_seesaw_${++this.sandboxCounter}`,
      x: clamp(x, 1.4, WORLD_W - 1.4),
      y: clamp(y, 0.9, WORLD_H - 0.9),
      length: 2.4,
      thickness: 0.16,
      angle: 0,
      angularVel: 0,
      maxAngle: 0.5,
      restAngle: 0,
      damping: 2.4,
    });
  }

  private isTriggerSatisfied(triggerId: string): boolean {
    for (const c of this.cisterns) {
      if (c.id === triggerId) return c.activated;
    }
    for (const t of this.turbines) {
      if (t.id === triggerId) {
        const chargeRatio = t.targetCharge > 0 ? t.charge / t.targetCharge : t.charge;
        return t.completed || chargeRatio >= 0.95;
      }
    }
    for (const r of this.relays) {
      if (r.id === triggerId) return r.active;
    }
    for (const v of this.valves) {
      if (v.id === triggerId) return v.toggled;
    }
    return false;
  }

  private syncDynamicSolids(terrain: ITerrainGrid): void {
    terrain.clearDynamicSolids();
    for (const gate of this.gates) {
      terrain.stampDynamicRect(gate.x, gate.y, gate.w, gate.h, SolidKind.GATE);
    }
    for (const wall of this.crackedWalls) {
      if (!wall.broken) {
        terrain.stampDynamicRect(wall.x, wall.y, wall.w, wall.h, SolidKind.CRACKED_WALL);
      }
    }
    terrain.rebuildSDFIfDirty();
  }

  private collideCircleWithOBB(
    cx: number,
    cy: number,
    vx: number,
    vy: number,
    r: number,
    ox: number,
    oy: number,
    halfLen: number,
    halfThick: number,
    angle: number,
    bodyAngVel: number,
    restitution: number,
    friction: number
  ): OBBCollisionResult {
    const out = this.obbOut;
    const dx = cx - ox;
    const dy = cy - oy;
    const maxReach = halfLen + halfThick + r + 0.04;
    if (dx * dx + dy * dy > maxReach * maxReach) {
      out.hit = false;
      return out;
    }

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const lx = dx * cosA + dy * sinA;
    const ly = -dx * sinA + dy * cosA;

    const clampedX = clamp(lx, -halfLen, halfLen);
    const clampedY = clamp(ly, -halfThick, halfThick);
    const diffX = lx - clampedX;
    const diffY = ly - clampedY;
    const dist2 = diffX * diffX + diffY * diffY;

    let lnx: number;
    let lny: number;
    let pen: number;

    if (dist2 > 1e-10) {
      if (dist2 >= r * r) {
        out.hit = false;
        return out;
      }
      const dist = Math.sqrt(dist2);
      const inv = 1 / dist;
      lnx = diffX * inv;
      lny = diffY * inv;
      pen = r - dist;
    } else {
      const penX = halfLen - Math.abs(lx);
      const penY = halfThick - Math.abs(ly);
      if (penY <= penX) {
        lnx = 0;
        lny = ly >= 0 ? 1 : -1;
        pen = penY + r;
      } else {
        lnx = lx >= 0 ? 1 : -1;
        lny = 0;
        pen = penX + r;
      }
    }

    const nx = lnx * cosA - lny * sinA;
    const ny = lnx * sinA + lny * cosA;

    const contactRx = clampedX * cosA - clampedY * sinA;
    const contactRy = clampedX * sinA + clampedY * cosA;
    const leverArm = contactRx * ny - contactRy * nx;

    const surfVx = -bodyAngVel * contactRy;
    const surfVy = bodyAngVel * contactRx;
    const relVx = vx - surfVx;
    const relVy = vy - surfVy;
    const relVn = relVx * nx + relVy * ny;

    let outVx = vx;
    let outVy = vy;
    let impulseN = 0;

    if (relVn < 0) {
      impulseN = -(1 + restitution) * relVn;
      outVx += impulseN * nx;
      outVy += impulseN * ny;

      const tx = -ny;
      const ty = nx;
      const relVt = relVx * tx + relVy * ty;
      outVx -= relVt * friction * tx;
      outVy -= relVt * friction * ty;
    }

    out.hit = true;
    out.nx = nx;
    out.ny = ny;
    out.pen = pen;
    out.relVn = relVn;
    out.leverArm = leverArm;
    out.x = cx + nx * pen;
    out.y = cy + ny * pen;
    out.vx = outVx;
    out.vy = outVy;
    out.impulseN = impulseN;
    return out;
  }

  private stepRelays(fluid: IFluidEngine, dt: number): void {
    if (this.relays.length === 0) {
      fluid.telemetry.relayActiveIntensity = 0;
      return;
    }

    const cellType = fluid.cellType;
    const visited = this.relayVisited;
    const parent = this.relayParent;
    const queue = this.relayQueue;
    const rawPath = this.relayRawPath;
    let maxIntensity = 0;

    for (const relay of this.relays) {
      visited.fill(0);
      let head = 0;
      let tail = 0;

      const r = relay.radius + 0.28;
      const r2 = r * r;

      const iMin = Math.max(0, Math.floor((relay.ax - r) * INV_CELL_SIZE));
      const iMax = Math.min(GRID_NX - 1, Math.floor((relay.ax + r) * INV_CELL_SIZE));
      const jMin = Math.max(0, Math.floor((relay.ay - r) * INV_CELL_SIZE));
      const jMax = Math.min(GRID_NY - 1, Math.floor((relay.ay + r) * INV_CELL_SIZE));

      for (let j = jMin; j <= jMax; j++) {
        const dy = (j + 0.5) * CELL_SIZE - relay.ay;
        const row = j * GRID_NX;
        for (let i = iMin; i <= iMax; i++) {
          const dx = (i + 0.5) * CELL_SIZE - relay.ax;
          if (dx * dx + dy * dy <= r2) {
            const idx = row + i;
            if (cellType[idx] === CellType.FLUID && visited[idx] === 0) {
              visited[idx] = 1;
              parent[idx] = -1;
              queue[tail++] = idx;
            }
          }
        }
      }

      let targetCell = -1;
      while (head < tail) {
        const cur = queue[head++];
        const ci = cur % GRID_NX;
        const cj = (cur / GRID_NX) | 0;

        const dbx = (ci + 0.5) * CELL_SIZE - relay.bx;
        const dby = (cj + 0.5) * CELL_SIZE - relay.by;
        if (dbx * dbx + dby * dby <= r2) {
          targetCell = cur;
          break;
        }

        for (let dj = -1; dj <= 1; dj++) {
          const nj = cj + dj;
          if (nj < 0 || nj >= GRID_NY) continue;
          const nRow = nj * GRID_NX;
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const ni = ci + di;
            if (ni < 0 || ni >= GRID_NX) continue;
            const nIdx = nRow + ni;
            if (cellType[nIdx] === CellType.FLUID && visited[nIdx] === 0) {
              visited[nIdx] = 1;
              parent[nIdx] = cur;
              queue[tail++] = nIdx;
            }
          }
        }
      }

      if (targetCell !== -1) {
        let pathLen = 0;
        let cur = targetCell;
        while (cur !== -1 && pathLen < rawPath.length) {
          rawPath[pathLen++] = cur;
          cur = parent[cur];
        }

        const pts: Array<[number, number]> = [[relay.ax, relay.ay]];
        const interiorSteps = Math.min(12, pathLen);
        if (interiorSteps > 0) {
          for (let k = 0; k < interiorSteps; k++) {
            const rawIdx =
              interiorSteps === 1
                ? pathLen - 1
                : Math.round(((interiorSteps - 1 - k) * (pathLen - 1)) / (interiorSteps - 1));
            const cIdx = rawPath[clamp(rawIdx, 0, pathLen - 1)];
            const ci = cIdx % GRID_NX;
            const cj = (cIdx / GRID_NX) | 0;
            pts.push([(ci + 0.5) * CELL_SIZE, (cj + 0.5) * CELL_SIZE]);
          }
        }
        pts.push([relay.bx, relay.by]);
        relay.bridgePath = pts;
        relay.charge = Math.min(1, relay.charge + 1.8 * dt);
      } else {
        relay.charge = Math.max(0, relay.charge - 0.28 * dt);
        if (relay.charge < 0.75) {
          relay.bridgePath = [];
        }
      }

      relay.active = relay.charge >= 0.75;
      if (relay.charge > maxIntensity) {
        maxIntensity = relay.charge;
      }
    }

    fluid.telemetry.relayActiveIntensity = maxIntensity;
  }

  private stepPumps(fluid: IFluidEngine, dt: number): void {
    if (this.pumps.length === 0) return;

    const numP = fluid.numParticles;
    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;
    const foam = fluid.foam;

    for (const pump of this.pumps) {
      const triggered =
        pump.requiredTriggerIds.length === 0 ||
        pump.requiredTriggerIds.every((id) => this.isTriggerSatisfied(id));
      pump.active = triggered;

      const targetPower = triggered ? 1 : 0;
      const rampRate = triggered ? 3.5 : 2.5;
      if (pump.power < targetPower) {
        pump.power = Math.min(1, pump.power + rampRate * dt);
      } else if (pump.power > targetPower) {
        pump.power = Math.max(0, pump.power - rampRate * dt);
      }

      if (pump.power <= 0.01) continue;

      const dirX = pump.dirX;
      const dirY = pump.dirY;
      const perpX = -dirY;
      const perpY = dirX;
      const invRange = 1 / Math.max(0.1, pump.range);
      const invRadius = 1 / Math.max(0.05, pump.radius);

      for (let p = 0; p < numP; p++) {
        const dx = px[p] - pump.x;
        const dy = py[p] - pump.y;
        const along = dx * dirX + dy * dirY;
        if (along < -0.1 || along > pump.range) continue;

        const perp = Math.abs(dx * perpX + dy * perpY);
        if (perp > pump.radius) continue;

        const rangeFalloff = 1 - 0.3 * clamp(along * invRange, 0, 1);
        const radFalloff = 1 - 0.3 * clamp(perp * invRadius, 0, 1);
        const accel = pump.force * pump.power * rangeFalloff * radFalloff * dt;

        vx[p] += dirX * accel;
        vy[p] += dirY * accel;
        foam[p] = Math.min(1, foam[p] + pump.power * 1.35 * dt);

        if (
          fluid.numSpray < MAX_SPRAY &&
          Math.random() < 0.025 * pump.power * (dt * 60)
        ) {
          const spraySpd = 3.8 + Math.random() * 2.8;
          fluid.spawnSpray(
            px[p],
            py[p],
            dirX * spraySpd + perpX * (Math.random() - 0.5) * 1.4,
            dirY * spraySpd + perpY * (Math.random() - 0.5) * 1.4,
            0.22 + Math.random() * 0.28
          );
        }
      }

      for (const body of this.bodies) {
        const dx = body.x - pump.x;
        const dy = body.y - pump.y;
        const along = dx * dirX + dy * dirY;
        if (along < -0.15 || along > pump.range) continue;

        const perpSigned = dx * perpX + dy * perpY;
        const bodyMargin = Math.min(body.w, body.h) * 0.45;
        if (Math.abs(perpSigned) > pump.radius + bodyMargin) continue;

        const accel = pump.force * pump.power * 0.85 * dt;
        body.vx += dirX * accel;
        body.vy += dirY * accel;
        body.vx -= perpX * perpSigned * 1.6 * pump.power * dt;
        body.vy -= perpY * perpSigned * 1.6 * pump.power * dt;
      }

      for (const mine of this.mines) {
        if (mine.detonated) continue;
        const dx = mine.x - pump.x;
        const dy = mine.y - pump.y;
        const along = dx * dirX + dy * dirY;
        if (along < -0.15 || along > pump.range) continue;

        const perpSigned = dx * perpX + dy * perpY;
        if (Math.abs(perpSigned) > pump.radius + mine.radius * 0.6) continue;

        const accel = pump.force * pump.power * 0.95 * dt;
        mine.vx += dirX * accel;
        mine.vy += dirY * accel;
        // Gentle beam centering so launched mines fly reliably down the nozzle arc
        mine.vx -= perpX * perpSigned * 2.4 * pump.power * dt;
        mine.vy -= perpY * perpSigned * 2.4 * pump.power * dt;
      }
    }
  }

  private stepFluidOBBs(fluid: IFluidEngine, dt: number): void {
    const numP = fluid.numParticles;
    if (numP === 0 || (this.seesaws.length === 0 && this.valves.length === 0)) return;

    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;
    const foam = fluid.foam;
    const particleMass = 0.055;

    for (let sIdx = 0; sIdx < this.seesaws.length; sIdx++) {
      const s = this.seesaws[sIdx];
      const halfLen = s.length * 0.5;
      const halfThick = s.thickness * 0.5;

      for (let p = 0; p < numP; p++) {
        const res = this.collideCircleWithOBB(
          px[p],
          py[p],
          vx[p],
          vy[p],
          PARTICLE_RADIUS,
          s.x,
          s.y,
          halfLen,
          halfThick,
          s.angle,
          s.angularVel,
          0.08,
          0.03
        );
        if (!res.hit) continue;

        px[p] = res.x;
        py[p] = res.y;
        vx[p] = res.vx;
        vy[p] = res.vy;

        if (res.impulseN > 0) {
          this.seesawTorque[sIdx] -= res.impulseN * res.leverArm * particleMass;
          if (res.impulseN > 1.8) {
            foam[p] = Math.min(1, foam[p] + res.impulseN * 0.14 * dt * 60);
          }
        }
      }
    }

    for (let vIdx = 0; vIdx < this.valves.length; vIdx++) {
      const v = this.valves[vIdx];
      const halfLen = v.length * 0.5;
      const halfThick = v.thickness * 0.5;
      const vOmega = this.valveAngVel[vIdx] ?? 0;

      for (let p = 0; p < numP; p++) {
        const res = this.collideCircleWithOBB(
          px[p],
          py[p],
          vx[p],
          vy[p],
          PARTICLE_RADIUS,
          v.x,
          v.y,
          halfLen,
          halfThick,
          v.angle,
          vOmega,
          0.08,
          0.025
        );
        if (!res.hit) continue;

        px[p] = res.x;
        py[p] = res.y;
        vx[p] = res.vx;
        vy[p] = res.vy;
        if (res.impulseN > 2.0) {
          foam[p] = Math.min(1, foam[p] + 0.12);
        }
      }
    }
  }

  private integrateSeesaws(dt: number): void {
    for (let i = 0; i < this.seesaws.length; i++) {
      const s = this.seesaws[i];
      const inertia = Math.max(1.6, s.length * s.length * 1.0);

      s.angularVel += this.seesawTorque[i] / inertia;
      // Balanced restoring bias toward restAngle keeps weighted arms stable until flooded
      s.angularVel += (s.restAngle - s.angle) * 3.8 * dt;
      s.angularVel = clamp(s.angularVel * Math.exp(-s.damping * dt), -8, 8);
      s.angle += s.angularVel * dt;

      const minA = s.restAngle - s.maxAngle;
      const maxA = s.restAngle + s.maxAngle;
      if (s.angle > maxA) {
        s.angle = maxA;
        if (s.angularVel > 0) s.angularVel = 0;
      } else if (s.angle < minA) {
        s.angle = minA;
        if (s.angularVel < 0) s.angularVel = 0;
      }
    }
  }

  private stepTurbines(fluid: IFluidEngine, dt: number): void {
    fluid.telemetry.maxTurbineRpm = 0;
    fluid.telemetry.maxTurbineCharge = 0;
    if (this.turbines.length === 0) return;

    const numP = fluid.numParticles;
    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;
    const foam = fluid.foam;

    for (const t of this.turbines) {
      const maxR = t.radius * 1.15;
      const minR = t.radius * 0.14;
      const maxR2 = maxR * maxR;
      const minR2 = minR * minR;

      let torqueSum = 0;
      let inertiaWeightSum = 0;
      const omega0 = t.angularVel;

      for (let p = 0; p < numP; p++) {
        const rx = px[p] - t.x;
        const ry = py[p] - t.y;
        if (rx > maxR || rx < -maxR || ry > maxR || ry < -maxR) continue;

        const dist2 = rx * rx + ry * ry;
        if (dist2 >= maxR2 || dist2 <= minR2) continue;

        const dist = Math.sqrt(dist2);
        const invDist = 1 / dist;
        const nx = rx * invDist;
        const ny = ry * invDist;
        const tx = -ny;
        const ty = nx;

        const bladeVx = tx * omega0 * dist;
        const bladeVy = ty * omega0 * dist;
        const relT = (vx[p] - bladeVx) * tx + (vy[p] - bladeVy) * ty;

        torqueSum += relT * dist;
        inertiaWeightSum += dist2;

        vx[p] -= tx * relT * 0.22;
        vy[p] -= ty * relT * 0.22;

        const centKick = Math.abs(omega0) * 0.45 * dt;
        vx[p] += nx * centKick;
        vy[p] += ny * centKick;

        foam[p] = Math.min(1, foam[p] + Math.abs(relT) * 0.75 * dt);

        if (
          fluid.numSpray < MAX_SPRAY &&
          (Math.abs(relT) > 1.8 || Math.abs(omega0) > 4.0) &&
          Math.random() < Math.min(0.06, Math.abs(relT) * 0.014) * (dt * 60)
        ) {
          fluid.spawnSpray(
            px[p],
            py[p],
            bladeVx + nx * (0.9 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.7,
            bladeVy + ny * (0.9 + Math.random() * 0.9) + 0.5,
            0.25 + Math.random() * 0.3
          );
        }
      }

      if (inertiaWeightSum > 1e-6) {
        const gain = Math.min(0.85, inertiaWeightSum * dt * 0.65);
        t.angularVel += (torqueSum / inertiaWeightSum) * gain;
      }

      t.angularVel = clamp(t.angularVel * Math.exp(-1.15 * dt), -18, 18);
      t.angle += t.angularVel * dt;

      const absVel = Math.abs(t.angularVel);
      if (absVel > 1.6) {
        t.charge = Math.min(t.targetCharge, t.charge + absVel * 0.085 * dt);
      } else if (!(t.completed && t.lockOnFull)) {
        t.charge = Math.max(0, t.charge - t.decayRate * dt);
      }

      if (t.charge >= t.targetCharge * 0.995) {
        if (!t.completed) {
          t.completed = true;
          t.charge = t.targetCharge;
          fluid.telemetry.turbineCompletePulseCount++;
        }
      } else if (!t.lockOnFull && t.completed && t.charge < t.targetCharge * 0.95) {
        t.completed = false;
      }

      const rpm = absVel * RAD_TO_RPM;
      if (rpm > fluid.telemetry.maxTurbineRpm) {
        fluid.telemetry.maxTurbineRpm = rpm;
      }
      const normCharge = t.targetCharge > 0 ? clamp(t.charge / t.targetCharge, 0, 1) : 0;
      if (normCharge > fluid.telemetry.maxTurbineCharge) {
        fluid.telemetry.maxTurbineCharge = normCharge;
      }
    }
  }

  private ensureNearbyBuffer(needed: number): void {
    if (this.nearbyIndices.length < needed) {
      this.nearbyIndices = new Int32Array(needed);
    }
  }

  private stepBodies(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number): void {
    if (this.bodies.length === 0) return;

    const numP = fluid.numParticles;
    this.ensureNearbyBuffer(numP);
    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;

    const numSteam = fluid.numSteam;
    const stx = fluid.stx;
    const sty = fluid.sty;
    const stvx = fluid.stvx;
    const stvy = fluid.stvy;

    const sampleR2 = 0.19 * 0.19;

    for (const body of this.bodies) {
      if (body.portalCooldown !== undefined && body.portalCooldown > 0) {
        body.portalCooldown = Math.max(0, body.portalCooldown - dt);
      }

      const cosA = Math.cos(body.angle);
      const sinA = Math.sin(body.angle);
      const ext = Math.max(body.w, body.h) * 0.65 + 0.24;

      let nearCount = 0;
      for (let p = 0; p < numP; p++) {
        const dx = px[p] - body.x;
        const dy = py[p] - body.y;
        if (dx >= -ext && dx <= ext && dy >= -ext && dy <= ext) {
          this.nearbyIndices[nearCount++] = p;
        }
      }

      let subSum = 0;
      let fvxSum = 0;
      let fvySum = 0;
      let fVelWeight = 0;

      let leftSub = 0;
      let rightSub = 0;
      let leftVySum = 0;
      let leftVyCount = 0;
      let rightVySum = 0;
      let rightVyCount = 0;

      const stepX = body.w * 0.34;
      const stepY = body.h * 0.34;

      for (let ix = -1; ix <= 1; ix++) {
        const lx = ix * stepX;
        for (let iy = -1; iy <= 1; iy++) {
          const ly = iy * stepY;
          const sx = body.x + lx * cosA - ly * sinA;
          const sy = body.y + lx * sinA + ly * cosA;

          let hits = 0;
          let pvx = 0;
          let pvy = 0;

          for (let k = 0; k < nearCount; k++) {
            const p = this.nearbyIndices[k];
            const dx = px[p] - sx;
            const dy = py[p] - sy;
            if (dx * dx + dy * dy <= sampleR2) {
              hits++;
              pvx += vx[p];
              pvy += vy[p];
            }
          }

          const ptSub = hits === 0 ? 0 : Math.min(1, hits / 2.5);
          subSum += ptSub;
          if (hits > 0) {
            fvxSum += pvx;
            fvySum += pvy;
            fVelWeight += hits;
          }

          if (ix === -1) {
            leftSub += ptSub;
            leftVySum += pvy;
            leftVyCount += hits;
          } else if (ix === 1) {
            rightSub += ptSub;
            rightVySum += pvy;
            rightVyCount += hits;
          }
        }
      }

      const submergedRatio = clamp(subSum / 9, 0, 1);
      body.submergedRatio = submergedRatio;

      const fvx = fVelWeight > 0 ? fvxSum / fVelWeight : 0;
      const fvy = fVelWeight > 0 ? fvySum / fVelWeight : 0;
      const leftSubNorm = leftSub / 3;
      const rightSubNorm = rightSub / 3;
      const leftVy = leftVyCount > 0 ? leftVySum / leftVyCount : 0;
      const rightVy = rightVyCount > 0 ? rightVySum / rightVyCount : 0;

      let steamHits = 0;
      let steamVxSum = 0;
      let steamVySum = 0;
      const sxLim = Math.max(body.w * 0.75, 0.42);
      const syLim = Math.max(body.h * 1.2, 0.55);

      for (let s = 0; s < numSteam; s++) {
        const dx = Math.abs(stx[s] - body.x);
        const dy = Math.abs(sty[s] - body.y);
        if (dx < sxLim && dy < syLim) {
          steamHits++;
          steamVxSum += stvx[s];
          steamVySum += Math.max(0, stvy[s]);
        }
      }

      body.vy += GRAVITY * dt;

      const buoyancyAccel =
        (1 / Math.max(0.25, body.density)) * submergedRatio * Math.abs(GRAVITY) * 1.15;
      body.vy += buoyancyAccel * dt;

      if (submergedRatio > 0) {
        body.vx += (fvx - body.vx) * submergedRatio * 4.5 * dt;
        body.vy += (fvy - body.vy) * submergedRatio * 5.2 * dt;
        body.vx += (leftSubNorm - rightSubNorm) * 1.9 * dt;
      }

      if (steamHits > 0) {
        const meanStVx = steamVxSum / steamHits;
        const meanStVy = steamVySum / steamHits;
        const steamUpdraft = Math.min(26.0, steamHits * 2.6 + meanStVy * 0.55);
        body.vy += steamUpdraft * dt;
        const stDrag = Math.min(1, steamHits * 0.12);
        body.vx += (meanStVx - body.vx) * stDrag * 2.4 * dt;
        body.vy *= Math.exp(-stDrag * 1.5 * dt);
      }

      if (body.kind === 'ark') {
        const waveTiltTorque = (rightSubNorm - leftSubNorm) * 5.0 + (rightVy - leftVy) * 0.7;
        body.angularVel += (-body.angle * 9.0 + waveTiltTorque) * dt;
        body.angularVel *= Math.exp(-3.5 * dt);
      } else {
        body.angularVel *= Math.exp(-2.2 * dt);
      }

      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.angle += body.angularVel * dt;

      this.clampArkAngle(body);
      this.collideBodyWithOBBs(body);
      this.collideBodyWithTerrain(body, terrain);
      this.clampArkAngle(body);

      this.pushWakeParticles(body, fluid, terrain, nearCount, dt);
    }
  }

  private clampArkAngle(body: BuoyantBodyState): void {
    if (body.kind !== 'ark') return;
    if (body.angle > 0.55) {
      body.angle = 0.55;
      if (body.angularVel > 0) body.angularVel = 0;
    } else if (body.angle < -0.55) {
      body.angle = -0.55;
      if (body.angularVel < 0) body.angularVel = 0;
    }
  }

  private collideBodyWithOBBs(body: BuoyantBodyState): void {
    if (this.seesaws.length === 0 && this.valves.length === 0) return;

    const bodyMass = Math.max(0.5, body.w * body.h * body.density * 1.6);

    if (body.kind === 'sphere') {
      const r = body.w * 0.5;
      for (let sIdx = 0; sIdx < this.seesaws.length; sIdx++) {
        const s = this.seesaws[sIdx];
        const res = this.collideCircleWithOBB(
          body.x,
          body.y,
          body.vx,
          body.vy,
          r,
          s.x,
          s.y,
          s.length * 0.5,
          s.thickness * 0.5,
          s.angle,
          s.angularVel,
          0.14,
          0.018
        );
        if (!res.hit) continue;
        body.x = res.x;
        body.y = res.y;
        body.vx = res.vx;
        body.vy = res.vy;
        const vt = body.vx * -res.ny + body.vy * res.nx;
        body.angularVel = body.angularVel * 0.65 - (vt / Math.max(0.1, r)) * 0.35;
        if (res.impulseN > 0) {
          this.seesawTorque[sIdx] -= res.impulseN * res.leverArm * bodyMass;
        }
      }
      for (let vIdx = 0; vIdx < this.valves.length; vIdx++) {
        const v = this.valves[vIdx];
        const res = this.collideCircleWithOBB(
          body.x,
          body.y,
          body.vx,
          body.vy,
          r,
          v.x,
          v.y,
          v.length * 0.5,
          v.thickness * 0.5,
          v.angle,
          this.valveAngVel[vIdx] ?? 0,
          0.14,
          0.1
        );
        if (!res.hit) continue;
        body.x = res.x;
        body.y = res.y;
        body.vx = res.vx;
        body.vy = res.vy;
      }
      return;
    }

    // Ark vs Seesaws & Valves using perimeter manifold so full-edge contact applies 1x mass
    const cornerR = Math.min(0.06, body.w * 0.25, body.h * 0.25);
    const hx = Math.max(0.01, body.w * 0.5 - cornerR);
    const hy = Math.max(0.01, body.h * 0.5 - cornerR);
    const nxSteps = Math.max(2, Math.ceil((2 * hx) / 0.14) + 1);
    const cosA = Math.cos(body.angle);
    const sinA = Math.sin(body.angle);
    const inertia = (body.w * body.w + body.h * body.h) / 10;

    const collideArkWithOneOBB = (
      ox: number,
      oy: number,
      halfLen: number,
      halfThick: number,
      angle: number,
      angVel: number,
      seesawIdx: number
    ): void => {
      let bestPen = 0;
      let bestNx = 0;
      let bestNy = 0;
      let hitCount = 0;
      let sumRx = 0;
      let sumRy = 0;
      let sumLever = 0;

      const checkPt = (lx: number, ly: number): void => {
        const rx = lx * cosA - ly * sinA;
        const ry = lx * sinA + ly * cosA;
        const res = this.collideCircleWithOBB(
          body.x + rx,
          body.y + ry,
          body.vx - body.angularVel * ry,
          body.vy + body.angularVel * rx,
          cornerR,
          ox,
          oy,
          halfLen,
          halfThick,
          angle,
          angVel,
          0.08,
          0.14
        );
        if (!res.hit) return;
        hitCount++;
        sumRx += rx;
        sumRy += ry;
        sumLever += res.leverArm;
        if (res.pen > bestPen) {
          bestPen = res.pen;
          bestNx = res.nx;
          bestNy = res.ny;
        }
      };

      for (let i = 0; i < nxSteps; i++) {
        const lx = -hx + (2 * hx * i) / (nxSteps - 1);
        checkPt(lx, -hy);
        checkPt(lx, hy);
      }

      if (hitCount === 0) return;

      body.x += bestNx * bestPen;
      body.y += bestNy * bestPen;

      const avgRx = sumRx / hitCount;
      const avgRy = sumRy / hitCount;
      const avgLever = sumLever / hitCount;

      const vpx = body.vx - body.angularVel * avgRy;
      const vpy = body.vy + body.angularVel * avgRx;
      const relVn = vpx * bestNx + vpy * bestNy;
      if (relVn < 0) {
        const rCrossN = avgRx * bestNy - avgRy * bestNx;
        const jImp = -1.08 * relVn / (1 + (rCrossN * rCrossN) / inertia);
        body.vx += jImp * bestNx;
        body.vy += jImp * bestNy;
        body.angularVel += ((rCrossN * jImp) / inertia) * 0.5;

        const tx = -bestNy;
        const ty = bestNx;
        const vt = vpx * tx + vpy * ty;
        body.vx -= tx * vt * 0.14;
        body.vy -= ty * vt * 0.14;

        if (seesawIdx >= 0) {
          this.seesawTorque[seesawIdx] -= jImp * avgLever * bodyMass;
        }
      }
    };

    for (let sIdx = 0; sIdx < this.seesaws.length; sIdx++) {
      const s = this.seesaws[sIdx];
      collideArkWithOneOBB(
        s.x,
        s.y,
        s.length * 0.5,
        s.thickness * 0.5,
        s.angle,
        s.angularVel,
        sIdx
      );
    }
    for (let vIdx = 0; vIdx < this.valves.length; vIdx++) {
      const v = this.valves[vIdx];
      collideArkWithOneOBB(
        v.x,
        v.y,
        v.length * 0.5,
        v.thickness * 0.5,
        v.angle,
        this.valveAngVel[vIdx] ?? 0,
        -1
      );
    }
  }

  private collideBodyWithTerrain(body: BuoyantBodyState, terrain: ITerrainGrid): void {
    if (body.kind === 'sphere') {
      const r = body.w * 0.5;
      for (let pass = 0; pass < 2; pass++) {
        const sdf = terrain.sampleSDF(body.x, body.y);
        if (sdf.dist < r) {
          const nLen = Math.hypot(sdf.nx, sdf.ny);
          const nx = nLen > 1e-4 ? sdf.nx / nLen : 0;
          const ny = nLen > 1e-4 ? sdf.ny / nLen : 1;
          const pen = r - sdf.dist;
          body.x += nx * pen;
          body.y += ny * pen;

          const vn = body.vx * nx + body.vy * ny;
          if (vn < 0) {
            const restitution = vn < -1.5 ? 0.25 : 0.04;
            body.vx -= (1 + restitution) * vn * nx;
            body.vy -= (1 + restitution) * vn * ny;
            const tx = -ny;
            const ty = nx;
            const vt = body.vx * tx + body.vy * ty;
            body.vx -= tx * vt * 0.12;
            body.vy -= ty * vt * 0.12;
            body.angularVel = body.angularVel * 0.65 - (vt / Math.max(0.1, r)) * 0.35;
          }
        } else {
          break;
        }
      }
      body.x = clamp(body.x, r, WORLD_W - r);
      body.y = clamp(body.y, r, WORLD_H - r);
      return;
    }

    const cornerR = Math.min(0.06, body.w * 0.25, body.h * 0.25);
    const hx = Math.max(0.01, body.w * 0.5 - cornerR);
    const hy = Math.max(0.01, body.h * 0.5 - cornerR);
    const nxSteps = Math.max(2, Math.ceil((2 * hx) / 0.1) + 1);
    const nySteps = Math.max(2, Math.ceil((2 * hy) / 0.1) + 1);
    const coreR = Math.min(body.w, body.h) * 0.42;
    const inertia = (body.w * body.w + body.h * body.h) / 10;

    const cosA0 = Math.cos(body.angle);
    const sinA0 = Math.sin(body.angle);

    let hitCount = 0;
    let sumRx = 0;
    let sumRy = 0;
    let sumNx = 0;
    let sumNy = 0;

    const sampleManifold = (lx: number, ly: number, rad: number): void => {
      const rx = lx * cosA0 - ly * sinA0;
      const ry = lx * sinA0 + ly * cosA0;
      const sdf = terrain.sampleSDF(body.x + rx, body.y + ry);
      if (sdf.dist < rad) {
        const pen = rad - sdf.dist;
        const nLen = Math.hypot(sdf.nx, sdf.ny);
        const nx = nLen > 1e-4 ? sdf.nx / nLen : 0;
        const ny = nLen > 1e-4 ? sdf.ny / nLen : 1;
        hitCount++;
        sumRx += rx;
        sumRy += ry;
        sumNx += nx * pen;
        sumNy += ny * pen;
      }
    };

    for (let i = 0; i < nxSteps; i++) {
      const lx = -hx + (2 * hx * i) / (nxSteps - 1);
      sampleManifold(lx, -hy, cornerR);
      sampleManifold(lx, hy, cornerR);
    }
    for (let j = 1; j < nySteps - 1; j++) {
      const ly = -hy + (2 * hy * j) / (nySteps - 1);
      sampleManifold(-hx, ly, cornerR);
      sampleManifold(hx, ly, cornerR);
    }
    sampleManifold(0, 0, coreR);

    if (hitCount > 0) {
      const avgRx = sumRx / hitCount;
      const avgRy = sumRy / hitCount;
      const mLen = Math.hypot(sumNx, sumNy);
      const mnx = mLen > 1e-6 ? sumNx / mLen : 0;
      const mny = mLen > 1e-6 ? sumNy / mLen : 1;

      const vpx = body.vx - body.angularVel * avgRy;
      const vpy = body.vy + body.angularVel * avgRx;
      const vn = vpx * mnx + vpy * mny;
      if (vn < 0) {
        const rCrossN = avgRx * mny - avgRy * mnx;
        const restitution = vn < -1.8 ? 0.16 : 0.0;
        const jImp = -(1 + restitution) * vn / (1 + (rCrossN * rCrossN) / inertia);
        body.vx += jImp * mnx;
        body.vy += jImp * mny;
        body.angularVel += ((rCrossN * jImp) / inertia) * 0.65;

        const tx = -mny;
        const ty = mnx;
        const vt = vpx * tx + vpy * ty;
        body.vx -= tx * vt * 0.14;
        body.vy -= ty * vt * 0.14;
      }

      for (let pass = 0; pass < 3; pass++) {
        const cosA = Math.cos(body.angle);
        const sinA = Math.sin(body.angle);
        let maxPen = 0;

        const resolvePoint = (lx: number, ly: number, rad: number): void => {
          const rx = lx * cosA - ly * sinA;
          const ry = lx * sinA + ly * cosA;
          const sdf = terrain.sampleSDF(body.x + rx, body.y + ry);
          if (sdf.dist < rad) {
            const pen = rad - sdf.dist;
            if (pen > maxPen) maxPen = pen;
            const nLen = Math.hypot(sdf.nx, sdf.ny);
            const nx = nLen > 1e-4 ? sdf.nx / nLen : 0;
            const ny = nLen > 1e-4 ? sdf.ny / nLen : 1;
            body.x += nx * pen;
            body.y += ny * pen;

            const vn = body.vx * nx + body.vy * ny;
            if (vn < 0) {
              body.vx -= vn * nx;
              body.vy -= vn * ny;
            }
          }
        };

        for (let i = 0; i < nxSteps; i++) {
          const lx = -hx + (2 * hx * i) / (nxSteps - 1);
          resolvePoint(lx, -hy, cornerR);
          resolvePoint(lx, hy, cornerR);
        }
        for (let j = 1; j < nySteps - 1; j++) {
          const ly = -hy + (2 * hy * j) / (nySteps - 1);
          resolvePoint(-hx, ly, cornerR);
          resolvePoint(hx, ly, cornerR);
        }
        resolvePoint(0, 0, coreR);

        if (maxPen <= 1e-4) break;
      }
    }

    const minBound = Math.min(body.w, body.h) * 0.5;
    body.x = clamp(body.x, minBound, WORLD_W - minBound);
    body.y = clamp(body.y, minBound, WORLD_H - minBound);
  }

  private pushWakeParticles(
    body: BuoyantBodyState,
    fluid: IFluidEngine,
    terrain: ITerrainGrid,
    nearCount: number,
    dt: number
  ): void {
    if (nearCount === 0) return;

    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;
    const foam = fluid.foam;

    const cosA = Math.cos(body.angle);
    const sinA = Math.sin(body.angle);
    const hw = body.w * 0.5;
    const hh = body.h * 0.5;
    const blend = Math.min(0.45, dt * 16);

    if (body.kind === 'sphere') {
      const r = hw;
      const r2 = r * r;
      for (let k = 0; k < nearCount; k++) {
        const p = this.nearbyIndices[k];
        const dx = px[p] - body.x;
        const dy = py[p] - body.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;

        const d = Math.sqrt(d2);
        const nx = d > 1e-4 ? dx / d : 0;
        const ny = d > 1e-4 ? dy / d : -1;
        const push = Math.min(0.025, (r - d) * 0.6);

        const targetX = px[p] + nx * push;
        const targetY = py[p] + ny * push;
        if (terrain.sampleSDF(targetX, targetY).dist > 0.015) {
          px[p] = targetX;
          py[p] = targetY;
        }

        vx[p] += (body.vx * 0.4 + nx * 0.6 - vx[p] * 0.12) * blend;
        vy[p] += (body.vy * 0.4 + ny * 0.6 - vy[p] * 0.12) * blend;
        foam[p] = Math.min(1, foam[p] + (Math.abs(body.vx) + Math.abs(body.vy)) * 0.12 * dt);
      }
      return;
    }

    for (let k = 0; k < nearCount; k++) {
      const p = this.nearbyIndices[k];
      const dx = px[p] - body.x;
      const dy = py[p] - body.y;
      const lx = dx * cosA + dy * sinA;
      const ly = -dx * sinA + dy * cosA;

      if (Math.abs(lx) >= hw || Math.abs(ly) >= hh) continue;

      vx[p] += (body.vx * 0.4 - vx[p] * 0.08) * blend;
      vy[p] += (body.vy * 0.4 - vy[p] * 0.08) * blend;

      if (ly <= hh * 0.25) {
        const dLeft = hw + lx;
        const dRight = hw - lx;
        const dBottom = hh + ly;

        let localNx = 0;
        let localNy = -1;
        let overlap = dBottom;

        if (dLeft < overlap && dLeft <= dRight) {
          overlap = dLeft;
          localNx = -1;
          localNy = 0;
        } else if (dRight < overlap) {
          overlap = dRight;
          localNx = 1;
          localNy = 0;
        }

        const worldNx = localNx * cosA - localNy * sinA;
        const worldNy = localNx * sinA + localNy * cosA;
        const push = Math.min(0.024, overlap * 0.55);

        const targetX = px[p] + worldNx * push;
        const targetY = py[p] + worldNy * push;
        if (terrain.sampleSDF(targetX, targetY).dist > 0.015) {
          px[p] = targetX;
          py[p] = targetY;
        }

        vx[p] += worldNx * 0.55 * blend;
        vy[p] += worldNy * 0.55 * blend;
        foam[p] = Math.min(1, foam[p] + (Math.abs(body.vx) + Math.abs(body.vy)) * 0.14 * dt);
      }
    }
  }

  private stepMines(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number): boolean {
    if (this.mines.length === 0) return false;

    const numP = fluid.numParticles;
    this.ensureNearbyBuffer(numP);
    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;
    const foam = fluid.foam;

    const hasIntactWalls = this.crackedWalls.some((w) => !w.broken);
    const sampleR2 = 0.19 * 0.19;
    let anyWallDetonated = false;

    for (const mine of this.mines) {
      mine.flash *= Math.exp(-4.5 * dt);

      if (mine.detonated) {
        if (hasIntactWalls || this.isSandbox) {
          mine.respawnTimer -= dt;
          if (mine.respawnTimer <= 0) {
            mine.x = mine.spawnX;
            mine.y = mine.spawnY;
            mine.vx = 0;
            mine.vy = 0;
            mine.angle = 0;
            mine.angularVel = 0;
            mine.detonated = false;
            mine.respawnTimer = 0;
            mine.portalCooldown = 0.4;
            mine.submergedRatio = 0;
            mine.flash = 0.85;
          }
        }
        continue;
      }

      if (mine.portalCooldown > 0) {
        mine.portalCooldown = Math.max(0, mine.portalCooldown - dt);
      }

      const ext = mine.radius + 0.24;
      let nearCount = 0;
      for (let p = 0; p < numP; p++) {
        const dx = px[p] - mine.x;
        const dy = py[p] - mine.y;
        if (dx >= -ext && dx <= ext && dy >= -ext && dy <= ext) {
          this.nearbyIndices[nearCount++] = p;
        }
      }

      // 5-point sampling inside mine circle for Archimedes buoyancy + wave carry
      const sOff = mine.radius * 0.55;
      let subSum = 0;
      let fvxSum = 0;
      let fvySum = 0;
      let fWeight = 0;
      let leftSub = 0;
      let rightSub = 0;

      for (let pt = 0; pt < 5; pt++) {
        const ox = pt === 1 ? -sOff : pt === 2 ? sOff : 0;
        const oy = pt === 3 ? -sOff : pt === 4 ? sOff : 0;
        const sx = mine.x + ox;
        const sy = mine.y + oy;

        let hits = 0;
        let pvx = 0;
        let pvy = 0;
        for (let k = 0; k < nearCount; k++) {
          const p = this.nearbyIndices[k];
          const dx = px[p] - sx;
          const dy = py[p] - sy;
          if (dx * dx + dy * dy <= sampleR2) {
            hits++;
            pvx += vx[p];
            pvy += vy[p];
          }
        }
        const ptSub = hits === 0 ? 0 : Math.min(1, hits / 2.5);
        subSum += ptSub;
        if (hits > 0) {
          fvxSum += pvx;
          fvySum += pvy;
          fWeight += hits;
        }
        if (pt === 1) leftSub = ptSub;
        else if (pt === 2) rightSub = ptSub;
      }

      const submergedRatio = clamp(subSum / 5, 0, 1);
      mine.submergedRatio = submergedRatio;

      const fvx = fWeight > 0 ? fvxSum / fWeight : 0;
      const fvy = fWeight > 0 ? fvySum / fWeight : 0;

      mine.vy += GRAVITY * dt;
      const buoyancyAccel =
        (1 / Math.max(0.25, mine.density)) * submergedRatio * Math.abs(GRAVITY) * 1.15;
      mine.vy += buoyancyAccel * dt;

      if (submergedRatio > 0) {
        mine.vx += (fvx - mine.vx) * submergedRatio * 4.5 * dt;
        mine.vy += (fvy - mine.vy) * submergedRatio * 5.2 * dt;
        mine.vx += (leftSub - rightSub) * 1.9 * dt;
      }

      mine.angularVel *= Math.exp(-2.0 * dt);
      mine.x += mine.vx * dt;
      mine.y += mine.vy * dt;
      mine.angle += mine.angularVel * dt;

      // Collide mine against Seesaws & Valves (two-way seesaw torque!)
      const mineMass = Math.max(0.32, Math.PI * mine.radius * mine.radius * mine.density * 3.8);
      for (let sIdx = 0; sIdx < this.seesaws.length; sIdx++) {
        const s = this.seesaws[sIdx];
        const res = this.collideCircleWithOBB(
          mine.x,
          mine.y,
          mine.vx,
          mine.vy,
          mine.radius,
          s.x,
          s.y,
          s.length * 0.5,
          s.thickness * 0.5,
          s.angle,
          s.angularVel,
          0.12,
          0.015
        );
        if (!res.hit) continue;
        mine.x = res.x;
        mine.y = res.y;
        mine.vx = res.vx;
        mine.vy = res.vy;
        const vt = mine.vx * -res.ny + mine.vy * res.nx;
        mine.angularVel = mine.angularVel * 0.65 - (vt / Math.max(0.08, mine.radius)) * 0.35;
        if (res.impulseN > 0) {
          this.seesawTorque[sIdx] -= res.impulseN * res.leverArm * mineMass;
        }
      }

      for (let vIdx = 0; vIdx < this.valves.length; vIdx++) {
        const v = this.valves[vIdx];
        const res = this.collideCircleWithOBB(
          mine.x,
          mine.y,
          mine.vx,
          mine.vy,
          mine.radius,
          v.x,
          v.y,
          v.length * 0.5,
          v.thickness * 0.5,
          v.angle,
          this.valveAngVel[vIdx] ?? 0,
          0.16,
          0.1
        );
        if (!res.hit) continue;
        mine.x = res.x;
        mine.y = res.y;
        mine.vx = res.vx;
        mine.vy = res.vy;
      }

      // Terrain SDF collision
      for (let pass = 0; pass < 2; pass++) {
        const sdf = terrain.sampleSDF(mine.x, mine.y);
        if (sdf.dist < mine.radius) {
          const nLen = Math.hypot(sdf.nx, sdf.ny);
          const nx = nLen > 1e-4 ? sdf.nx / nLen : 0;
          const ny = nLen > 1e-4 ? sdf.ny / nLen : 1;
          const pen = mine.radius - sdf.dist;
          mine.x += nx * pen;
          mine.y += ny * pen;

          const vn = mine.vx * nx + mine.vy * ny;
          if (vn < 0) {
            const restitution = vn < -1.5 ? 0.25 : 0.05;
            mine.vx -= (1 + restitution) * vn * nx;
            mine.vy -= (1 + restitution) * vn * ny;
            const tx = -ny;
            const ty = nx;
            const vt = mine.vx * tx + mine.vy * ty;
            mine.vx -= tx * vt * 0.1;
            mine.vy -= ty * vt * 0.1;
            mine.angularVel = mine.angularVel * 0.65 - (vt / Math.max(0.08, mine.radius)) * 0.35;
          }
        } else {
          break;
        }
      }

      mine.x = clamp(mine.x, mine.radius, WORLD_W - mine.radius);
      mine.y = clamp(mine.y, mine.radius, WORLD_H - mine.radius);

      // Two-way wake push on overlapping water particles
      if (nearCount > 0) {
        const r2 = mine.radius * mine.radius;
        const blend = Math.min(0.45, dt * 16);
        for (let k = 0; k < nearCount; k++) {
          const p = this.nearbyIndices[k];
          const dx = px[p] - mine.x;
          const dy = py[p] - mine.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2) continue;

          const d = Math.sqrt(d2);
          const nx = d > 1e-4 ? dx / d : 0;
          const ny = d > 1e-4 ? dy / d : -1;
          const push = Math.min(0.022, (mine.radius - d) * 0.55);
          const tx = px[p] + nx * push;
          const ty = py[p] + ny * push;
          if (terrain.sampleSDF(tx, ty).dist > 0.015) {
            px[p] = tx;
            py[p] = ty;
          }
          vx[p] += (mine.vx * 0.4 + nx * 0.5 - vx[p] * 0.12) * blend;
          vy[p] += (mine.vy * 0.4 + ny * 0.5 - vy[p] * 0.12) * blend;
        }
      }

      // Drain check -> schedule quiet respawn
      let drained = false;
      for (const dr of this.drains) {
        if (
          mine.x >= dr.x &&
          mine.x <= dr.x + dr.w &&
          ((mine.y >= dr.y && mine.y <= dr.y + dr.h) ||
            (dr.y <= CELL_SIZE && mine.y <= CELL_SIZE + mine.radius))
        ) {
          drained = true;
          break;
        }
      }
      if (drained) {
        mine.detonated = true;
        mine.respawnTimer = 1.6;
        mine.flash = 0;
        continue;
      }

      // Cracked wall detonation check
      const triggerDist = mine.radius + 0.12;
      for (const wall of this.crackedWalls) {
        if (wall.broken) continue;

        const qx = clamp(mine.x, wall.x, wall.x + wall.w);
        const qy = clamp(mine.y, wall.y, wall.y + wall.h);
        const dx = qx - mine.x;
        const dy = qy - mine.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= triggerDist) continue;

        // Prevent detonating through an intervening or overlapping static rock cap/bracket
        const midI = clamp(Math.floor(((mine.x + qx) * 0.5) * INV_CELL_SIZE), 0, GRID_NX - 1);
        const midJ = clamp(Math.floor(((mine.y + qy) * 0.5) * INV_CELL_SIZE), 0, GRID_NY - 1);
        if (terrain.getKindAtCell(midI, midJ) === SolidKind.ROCK) continue;

        const nudgeX = dist > 1e-4 ? (dx / dist) * 0.04 : 0;
        const nudgeY = dist > 1e-4 ? (dy / dist) * 0.04 : 0;
        const ci = clamp(Math.floor((qx + nudgeX) * INV_CELL_SIZE), 0, GRID_NX - 1);
        const cj = clamp(Math.floor((qy + nudgeY) * INV_CELL_SIZE), 0, GRID_NY - 1);
        if (terrain.getKindAtCell(ci, cj) === SolidKind.ROCK) continue;

        mine.detonated = true;
        mine.respawnTimer = 2.5;
        mine.flash = 1.0;

        wall.hp = 0;
        wall.broken = true;
        wall.stressGlow = 1.0;
        anyWallDetonated = true;
        terrain.dirty = true;

        // Spawn 30 rock + ember debris chunks
        for (let k = 0; k < 20; k++) {
          const maxLife = 1.8 + Math.random() * 1.4;
          this.pushDebris({
            x: wall.x + Math.random() * wall.w,
            y: wall.y + Math.random() * wall.h,
            vx: (Math.random() - 0.5) * 8.5,
            vy: 1.0 + Math.random() * 5.2,
            angle: Math.random() * Math.PI * 2,
            angularVel: (Math.random() - 0.5) * 16,
            size: 0.06 + Math.random() * 0.08,
            life: maxLife,
            maxLife,
            kind: 'rock',
          });
        }
        for (let k = 0; k < 10; k++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 2.8 + Math.random() * 5.6;
          const maxLife = 1.2 + Math.random() * 0.8;
          this.pushDebris({
            x: mine.x + (Math.random() - 0.5) * 0.2,
            y: mine.y + (Math.random() - 0.5) * 0.2,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd + 1.5,
            angle: Math.random() * Math.PI * 2,
            angularVel: (Math.random() - 0.5) * 18,
            size: 0.045 + Math.random() * 0.055,
            life: maxLife,
            maxLife,
            kind: 'ember',
          });
        }

        // Spawn 35 radial spray droplets
        const sprayCap = Math.min(35, MAX_SPRAY - fluid.numSpray);
        for (let k = 0; k < sprayCap; k++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 3.2 + Math.random() * 6.0;
          fluid.spawnSpray(
            mine.x + Math.cos(ang) * 0.15,
            mine.y + Math.sin(ang) * 0.15,
            Math.cos(ang) * spd,
            Math.sin(ang) * spd + 1.8,
            0.35 + Math.random() * 0.45
          );
        }

        // Radial blast wave (radius = 2.6m, outward velocity impulse up to +12 m/s)
        const blastR = 2.6;
        const blastR2 = blastR * blastR;
        for (let p = 0; p < numP; p++) {
          const dx = px[p] - mine.x;
          const dy = py[p] - mine.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= blastR2) continue;

          const d = Math.sqrt(d2);
          const falloff = 1 - d / blastR;
          const invD = d > 1e-4 ? 1 / d : 0;
          const nx = d > 1e-4 ? dx * invD : 0;
          const ny = d > 1e-4 ? dy * invD : 1;
          const impulse = 12.0 * falloff;

          vx[p] += nx * impulse;
          vy[p] += ny * impulse + 2.2 * falloff;
          foam[p] = Math.min(1, foam[p] + falloff);
        }

        fluid.telemetry.mineDetonateCount = (fluid.telemetry.mineDetonateCount ?? 0) + 1;
        fluid.telemetry.wallBreakCount++;
        break;
      }
    }

    return anyWallDetonated;
  }

  private stepPortals(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number): void {
    if (this.portals.length === 0) return;

    const numP = fluid.numParticles;
    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;
    const foam = fluid.foam;

    for (const portal of this.portals) {
      portal.pulse *= Math.exp(-4.0 * dt);

      const r2 = portal.radius * portal.radius;
      const outOffset = portal.radius * 0.65 + 0.12;
      const perpX = -portal.outDirY;
      const perpY = portal.outDirX;
      let teleportedInStep = false;

      for (let p = 0; p < numP; p++) {
        const dx = px[p] - portal.inX;
        const dy = py[p] - portal.inY;
        if (dx * dx + dy * dy >= r2) continue;

        const spread = (Math.random() - 0.5) * 0.16;
        let nx = portal.outX + portal.outDirX * outOffset + perpX * spread;
        let ny = portal.outY + portal.outDirY * outOffset + perpY * spread;

        const sdf = terrain.sampleSDF(nx, ny);
        if (sdf.dist < PARTICLE_RADIUS) {
          nx += sdf.nx * (PARTICLE_RADIUS - sdf.dist);
          ny += sdf.ny * (PARTICLE_RADIUS - sdf.dist);
        }

        const speed = Math.hypot(vx[p], vy[p]);
        const exitSpeed = Math.max(6.8, speed * portal.boost);

        px[p] = clamp(nx, PARTICLE_RADIUS, WORLD_W - PARTICLE_RADIUS);
        py[p] = clamp(ny, PARTICLE_RADIUS, WORLD_H - PARTICLE_RADIUS);
        vx[p] = portal.outDirX * exitSpeed + perpX * (Math.random() - 0.5) * 0.45;
        vy[p] = portal.outDirY * exitSpeed + perpY * (Math.random() - 0.5) * 0.45;
        foam[p] = Math.min(1, foam[p] + 0.35);

        teleportedInStep = true;
      }

      for (const body of this.bodies) {
        if ((body.portalCooldown ?? 0) > 0) continue;
        const bodyRadius =
          body.kind === 'sphere' ? body.w * 0.5 : Math.min(body.w, body.h) * 0.5;
        const thresh = portal.radius + bodyRadius * 0.35;
        const dx = body.x - portal.inX;
        const dy = body.y - portal.inY;
        if (dx * dx + dy * dy >= thresh * thresh) continue;

        const bodyExitDist = portal.radius * 0.65 + 0.14 + bodyRadius * 0.55;
        let bx = portal.outX + portal.outDirX * bodyExitDist;
        let by = portal.outY + portal.outDirY * bodyExitDist;
        const sdf = terrain.sampleSDF(bx, by);
        if (sdf.dist < bodyRadius) {
          bx += sdf.nx * (bodyRadius - sdf.dist);
          by += sdf.ny * (bodyRadius - sdf.dist);
        }

        const speed = Math.hypot(body.vx, body.vy);
        const exitSpeed = Math.max(6.2, speed * portal.boost);
        body.x = clamp(bx, bodyRadius, WORLD_W - bodyRadius);
        body.y = clamp(by, bodyRadius, WORLD_H - bodyRadius);
        body.vx = portal.outDirX * exitSpeed;
        body.vy = portal.outDirY * exitSpeed;
        body.portalCooldown = 0.65;
        teleportedInStep = true;
      }

      for (const mine of this.mines) {
        if (mine.detonated || mine.portalCooldown > 0) continue;
        const thresh = portal.radius + mine.radius * 0.35;
        const dx = mine.x - portal.inX;
        const dy = mine.y - portal.inY;
        if (dx * dx + dy * dy >= thresh * thresh) continue;

        const mineExitDist = portal.radius * 0.65 + 0.14 + mine.radius * 0.6;
        let mx = portal.outX + portal.outDirX * mineExitDist;
        let my = portal.outY + portal.outDirY * mineExitDist;
        const sdf = terrain.sampleSDF(mx, my);
        if (sdf.dist < mine.radius) {
          mx += sdf.nx * (mine.radius - sdf.dist);
          my += sdf.ny * (mine.radius - sdf.dist);
        }

        const speed = Math.hypot(mine.vx, mine.vy);
        const exitSpeed = Math.max(6.2, speed * portal.boost);
        mine.x = clamp(mx, mine.radius, WORLD_W - mine.radius);
        mine.y = clamp(my, mine.radius, WORLD_H - mine.radius);
        mine.vx = portal.outDirX * exitSpeed;
        mine.vy = portal.outDirY * exitSpeed;
        mine.portalCooldown = 0.65;
        mine.flash = 0.7;
        teleportedInStep = true;
      }

      if (teleportedInStep) {
        portal.pulse = 1.0;
        fluid.telemetry.portalPulseCount = (fluid.telemetry.portalPulseCount ?? 0) + 1;

        if (fluid.numSpray < MAX_SPRAY) {
          const sx = portal.outX + portal.outDirX * outOffset;
          const sy = portal.outY + portal.outDirY * outOffset;
          fluid.spawnSpray(
            sx,
            sy,
            portal.outDirX * 5.2 + perpX * (Math.random() - 0.5) * 1.6,
            portal.outDirY * 5.2 + perpY * (Math.random() - 0.5) * 1.6,
            0.3 + Math.random() * 0.25
          );
        }
      }
    }
  }

  private stepCrackedWalls(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number): boolean {
    if (this.crackedWalls.length === 0) return false;

    const numP = fluid.numParticles;
    const px = fluid.px;
    const py = fluid.py;
    const vx = fluid.vx;
    const vy = fluid.vy;
    const foam = fluid.foam;
    let anyBroken = false;

    for (const wall of this.crackedWalls) {
      if (wall.broken) continue;

      wall.stressGlow *= Math.exp(-2.8 * dt);

      const cx = wall.x + wall.w * 0.5;
      const halfSpan = wall.w * 0.5 + 0.16;
      const yMin = wall.y - 0.04;
      const yMax = wall.y + wall.h + 0.04;

      let nearCount = 0;
      let impactImpulse = 0;
      let flowVxSum = 0;

      for (let p = 0; p < numP; p++) {
        const x = px[p];
        const y = py[p];
        if (Math.abs(x - cx) < halfSpan && y >= yMin && y <= yMax) {
          nearCount++;
          const pvx = vx[p];
          const pvy = vy[p];
          flowVxSum += pvx;

          const speed = Math.hypot(pvx, pvy);
          if (speed > 1.7) {
            const inward = x < cx ? pvx : -pvx;
            const dirFactor = inward > 0 ? 1.15 : 0.85;
            impactImpulse += (speed - 1.4) * speed * 0.032 * dirFactor;
          }
          if (foam[p] > 0.25) {
            impactImpulse += foam[p] * 0.12;
          }
        }
      }

      const rawPressure = Math.max(
        0,
        fluid.queryPressureRect(wall.x - 0.35, wall.y, wall.w + 0.7, wall.h)
      );
      const effectiveDepth = nearCount >= 14 ? nearCount * 0.0125 : 0;
      const pressureForce = rawPressure * 0.58 + Math.max(0, effectiveDepth - 0.7) * 2.8;

      const peakForce = pressureForce + impactImpulse;

      if (peakForce > wall.impactThreshold) {
        wall.hp -= (peakForce - wall.impactThreshold) * dt * 2.2;
        wall.stressGlow = 1.0;
      } else if (wall.impactThreshold > 0) {
        wall.stressGlow = Math.max(
          wall.stressGlow,
          Math.min(0.85, (0.35 * peakForce) / wall.impactThreshold)
        );
      }

      if (wall.hp <= 0) {
        wall.hp = 0;
        wall.broken = true;
        anyBroken = true;

        const avgFlowVx = nearCount > 0 ? flowVxSum / nearCount : 0;
        for (let k = 0; k < 26; k++) {
          const maxLife = 1.8 + Math.random() * 1.4;
          this.pushDebris({
            x: wall.x + Math.random() * wall.w,
            y: wall.y + Math.random() * wall.h,
            vx: (Math.random() - 0.5) * 6.5 + avgFlowVx * 0.55,
            vy: 0.6 + Math.random() * 4.4,
            angle: Math.random() * Math.PI * 2,
            angularVel: (Math.random() - 0.5) * 14,
            size: 0.06 + Math.random() * 0.08,
            life: maxLife,
            maxLife,
            kind: 'rock',
          });
        }

        const sprayCount = Math.min(18, MAX_SPRAY - fluid.numSpray);
        for (let k = 0; k < sprayCount; k++) {
          fluid.spawnSpray(
            wall.x + Math.random() * wall.w,
            wall.y + Math.random() * wall.h,
            (Math.random() - 0.5) * 5.0 + avgFlowVx * 0.5,
            1.0 + Math.random() * 3.5,
            0.3 + Math.random() * 0.4
          );
        }

        fluid.telemetry.wallBreakCount++;
        terrain.dirty = true;
      }
    }

    return anyBroken;
  }

  private ensureVentTouchBuffer(needed: number): void {
    if (this.ventTouchIndices.length < needed) {
      this.ventTouchIndices = new Int32Array(needed);
    }
  }

  private stepMagmaVents(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number): void {
    fluid.telemetry.magmaSteamIntensity = 0;
    if (this.magmaVents.length === 0) return;

    let maxSteamActivity = 0;

    for (const vent of this.magmaVents) {
      if (vent.quenched) {
        vent.steamPulse *= Math.exp(-3.5 * dt);
        continue;
      }

      const x0 = vent.x - 0.08;
      const x1 = vent.x + vent.w + 0.08;
      const y0 = vent.y;
      const y1 = vent.y + vent.h + 0.18;

      const numP = fluid.numParticles;
      this.ensureVentTouchBuffer(numP);
      const px = fluid.px;
      const py = fluid.py;
      const temp = fluid.temp;

      let touchingCount = 0;
      for (let p = 0; p < numP; p++) {
        const x = px[p];
        const y = py[p];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
          this.ventTouchIndices[touchingCount++] = p;
          temp[p] = Math.min(1, temp[p] + 1.8 * dt);
        }
      }

      if (touchingCount > 0) {
        vent.heat -= touchingCount * 0.18 * dt;
        vent.steamPulse = Math.min(1, vent.steamPulse + dt * 5.5);

        const boilRate = Math.min(12, 6 + touchingCount * 0.3);
        const prevAccum = this.magmaBoilAccum.get(vent.id) ?? 0.85;
        const accum = prevAccum + boilRate * dt;
        const boilCount = Math.min(touchingCount, Math.floor(accum), 3);
        this.magmaBoilAccum.set(vent.id, accum - boilCount);

        if (boilCount > 0) {
          const stride = touchingCount / boilCount;
          const steamPerDrop = touchingCount > 10 ? 3 : 2;
          let lastRemoved = touchingCount;
          for (let k = boilCount - 1; k >= 0; k--) {
            let slot = Math.floor(k * stride);
            if (slot >= lastRemoved) slot = lastRemoved - 1;
            if (slot < 0) break;
            lastRemoved = slot;

            const pIdx = this.ventTouchIndices[slot];
            const sx = px[pIdx];
            const sy = Math.max(py[pIdx], vent.y + vent.h * 0.55);

            for (let s = 0; s < steamPerDrop; s++) {
              if (fluid.numSteam < MAX_STEAM) {
                fluid.spawnSteam(
                  sx + (Math.random() - 0.5) * 0.14,
                  sy + Math.random() * 0.1,
                  (Math.random() - 0.5) * 0.9,
                  2.6 + Math.random() * 1.6,
                  1.8 + Math.random() * 0.9
                );
              }
            }
            fluid.removeParticle(pIdx);
          }
        }

        const activity = Math.min(1, touchingCount / 22);
        if (activity > maxSteamActivity) {
          maxSteamActivity = activity;
        }
      } else {
        vent.steamPulse *= Math.exp(-3.5 * dt);
        this.magmaBoilAccum.set(vent.id, 0.85);
      }

      vent.heat = Math.min(vent.maxHeat, vent.heat + vent.reheatRate * dt);

      if (vent.heat <= 0) {
        vent.quenched = true;
        vent.heat = 0;
        vent.steamPulse = 1.0;

        terrain.addObsidianRect(vent.x, vent.y, vent.w, vent.h + 0.18);
        terrain.rebuildSDFIfDirty();

        for (let k = 0; k < 22; k++) {
          if (fluid.numSteam >= MAX_STEAM) break;
          fluid.spawnSteam(
            vent.x + Math.random() * vent.w,
            vent.y + vent.h * 0.55 + Math.random() * 0.2,
            (Math.random() - 0.5) * 2.4,
            2.4 + Math.random() * 2.8,
            1.7 + Math.random() * 1.1
          );
        }

        for (let k = 0; k < 16; k++) {
          const maxLife = 1.3 + Math.random() * 0.9;
          this.pushDebris({
            x: vent.x + Math.random() * vent.w,
            y: vent.y + vent.h * 0.5 + Math.random() * 0.25,
            vx: (Math.random() - 0.5) * 5.2,
            vy: 2.2 + Math.random() * 4.5,
            angle: Math.random() * Math.PI * 2,
            angularVel: (Math.random() - 0.5) * 14,
            size: 0.045 + Math.random() * 0.055,
            life: maxLife,
            maxLife,
            kind: 'ember',
          });
        }

        fluid.telemetry.magmaQuenchCount++;
      }
    }

    fluid.telemetry.magmaSteamIntensity = maxSteamActivity;
  }

  private stepCisternsAndGoals(fluid: IFluidEngine, dt: number): void {
    const fillAlpha = 1 - Math.exp(-6.0 * dt);
    for (const c of this.cisterns) {
      const count = fluid.countParticlesInRect(c.x, c.y, c.w, c.h);
      c.particleCount = count;
      const targetRatio =
        c.thresholdParticles > 0 ? clamp(count / c.thresholdParticles, 0, 1) : 1;
      c.fillRatio = clamp(c.fillRatio + (targetRatio - c.fillRatio) * fillAlpha, 0, 1);

      if (c.activated) {
        if (c.fillRatio < 0.62) {
          c.activated = false;
        }
      } else if (c.fillRatio >= 0.85) {
        c.activated = true;
      }
    }

    for (const b of this.bodies) {
      b.inGoal = false;
    }

    for (const g of this.goals) {
      let matched = false;
      const gcx = g.x + g.w * 0.5;
      const gcy = g.y + g.h * 0.5;

      for (const b of this.bodies) {
        if (g.bodyId && b.id !== g.bodyId) continue;

        if (b.x >= g.x && b.x <= g.x + g.w && b.y >= g.y && b.y <= g.y + g.h) {
          matched = true;
          b.inGoal = true;

          b.vy += Math.abs(GRAVITY) * 0.88 * dt;
          b.vx += (gcx - b.x) * 7.5 * dt;
          b.vy += (gcy - b.y) * 7.5 * dt;
          const damp = Math.exp(-5.5 * dt);
          b.vx *= damp;
          b.vy *= damp;
          b.angularVel *= damp;
        }
      }

      g.fulfilled = matched;
      if (matched) {
        g.pulse = Math.min(1, g.pulse + dt * 3.5);
      } else {
        g.pulse *= Math.exp(-3.0 * dt);
      }
    }
  }

  private pushDebris(chunk: DebrisChunk): void {
    if (this.debris.length < MAX_DEBRIS) {
      this.debris.push(chunk);
      return;
    }
    let lowestIdx = 0;
    let lowestLife = this.debris[0].life;
    for (let i = 1; i < this.debris.length; i++) {
      if (this.debris[i].life < lowestLife) {
        lowestLife = this.debris[i].life;
        lowestIdx = i;
      }
    }
    this.debris[lowestIdx] = chunk;
  }
}
