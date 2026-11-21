// @ts-expect-error Node 24 built-in test runner (no @types/node in project dependencies)
import { afterEach, beforeEach, describe, test } from 'node:test';
// @ts-expect-error Node 24 built-in strict assertions (no @types/node in project dependencies)
import assert from 'node:assert/strict';

import {
  CAMPAIGN_LEVELS,
  SANDBOX_LEVEL,
  TITLE_DEMO_LEVEL,
} from '../src/levels/levelData.ts';
import { FluidEngine } from '../src/sim/fluidEngine.ts';
import { MechanismSystem } from '../src/sim/mechanisms.ts';
import { TerrainGrid } from '../src/sim/terrainGrid.ts';
import {
  CELL_SIZE,
  GRID_NX,
  GRID_NY,
  INV_CELL_SIZE,
  MAX_PARTICLES,
  SolidKind,
  WORLD_H,
  WORLD_W,
  type LevelDef,
  type QualityLevel,
  type TerrainShape,
  type ToolForceInput,
} from '../src/types.ts';

const FIXED_DT = 1 / 60;

const OUTER_FRAME: TerrainShape[] = [
  { kind: 'rect', x: 0, y: 0, w: 0.5, h: WORLD_H },
  { kind: 'rect', x: WORLD_W - 0.5, y: 0, w: 0.5, h: WORLD_H },
  { kind: 'rect', x: 0, y: 0, w: WORLD_W, h: 0.5 },
  { kind: 'rect', x: 0, y: WORLD_H - 0.5, w: WORLD_W, h: 0.5 },
];

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCustomLevel(overrides: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'test-level',
    index: 99,
    titleKey: 'test.title',
    subtitleKey: 'test.sub',
    hintKey: 'test.hint',
    parTime: 60,
    maxFrostCells: 900,
    maxTotalParticles: 3800,
    theme: TITLE_DEMO_LEVEL.theme,
    solids: [...OUTER_FRAME],
    spouts: [],
    pools: [],
    drains: [],
    turbines: [],
    bodies: [],
    goals: [],
    cisterns: [],
    gates: [],
    crackedWalls: [],
    magmaVents: [],
    portals: [],
    mines: [],
    seesaws: [],
    valves: [],
    relays: [],
    pumps: [],
    ...overrides,
  };
}

function makeSurgeInput(x: number, y: number, vx: number, vy: number): ToolForceInput {
  return {
    tool: 'surge',
    active: true,
    secondary: false,
    x,
    y,
    vx,
    vy,
    chargeTime: 0,
  };
}

function makeVortexHoldInput(x: number, y: number, chargeTime: number): ToolForceInput {
  return {
    tool: 'vortex',
    active: true,
    secondary: false,
    x,
    y,
    vx: 0,
    vy: 0,
    chargePos: { x, y },
    chargeTime,
  };
}

function makeVortexBurstInput(
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  strength: number
): ToolForceInput {
  return {
    tool: 'vortex',
    active: false,
    secondary: false,
    x,
    y,
    vx: 0,
    vy: 0,
    chargeTime: 0.75,
    releaseBurst: { x, y, dirX, dirY, strength },
  };
}

interface SimContext {
  terrain: TerrainGrid;
  fluid: FluidEngine;
  mechanisms: MechanismSystem;
  level: LevelDef;
  stepFrames: (
    frames: number,
    options?: {
      quality?: QualityLevel;
      toolInput?: ToolForceInput | null;
      onAfterStep?: (frameIndex: number) => void;
    }
  ) => void;
}

function createSimContext(level: LevelDef): SimContext {
  const terrain = new TerrainGrid();
  const fluid = new FluidEngine();
  const mechanisms = new MechanismSystem();

  fluid.reset();
  terrain.loadLevel(level.solids, level.carves, level.drains);
  mechanisms.loadLevel(level, terrain);

  for (const pool of level.pools) {
    fluid.spawnPool(
      pool.x,
      pool.y,
      pool.w,
      pool.h,
      level.maxTotalParticles,
      pool.fillFactor ?? 0.9
    );
  }

  return {
    terrain,
    fluid,
    mechanisms,
    level,
    stepFrames(frames, options = {}) {
      const quality = options.quality ?? 'ultra';
      const toolInput = options.toolInput ?? null;
      for (let f = 0; f < frames; f++) {
        fluid.step(
          FIXED_DT,
          terrain,
          toolInput,
          mechanisms,
          quality,
          level.maxTotalParticles
        );
        options.onAfterStep?.(f);
      }
    },
  };
}

function assertFluidInvariants(fluid: FluidEngine, maxCap = MAX_PARTICLES, context = ''): void {
  const prefix = context ? `[${context}] ` : '';
  assert.ok(
    Number.isInteger(fluid.numParticles) &&
      fluid.numParticles >= 0 &&
      fluid.numParticles <= maxCap &&
      fluid.numParticles <= MAX_PARTICLES,
    `${prefix}Invalid numParticles=${fluid.numParticles} (maxCap=${maxCap})`
  );

  for (let p = 0; p < fluid.numParticles; p++) {
    const x = fluid.px[p];
    const y = fluid.py[p];
    const vx = fluid.vx[p];
    const vy = fluid.vy[p];
    const foam = fluid.foam[p];
    const temp = fluid.temp[p];

    assert.ok(Number.isFinite(x), `${prefix}Non-finite px[${p}]=${x}`);
    assert.ok(Number.isFinite(y), `${prefix}Non-finite py[${p}]=${y}`);
    assert.ok(Number.isFinite(vx), `${prefix}Non-finite vx[${p}]=${vx}`);
    assert.ok(Number.isFinite(vy), `${prefix}Non-finite vy[${p}]=${vy}`);
    assert.ok(Number.isFinite(foam), `${prefix}Non-finite foam[${p}]=${foam}`);
    assert.ok(Number.isFinite(temp), `${prefix}Non-finite temp[${p}]=${temp}`);

    assert.ok(
      x >= 0 && x <= WORLD_W,
      `${prefix}Out-of-bounds px[${p}]=${x} (expected [0, ${WORLD_W}])`
    );
    assert.ok(
      y >= 0 && y <= WORLD_H,
      `${prefix}Out-of-bounds py[${p}]=${y} (expected [0, ${WORLD_H}])`
    );
  }

  for (let s = 0; s < fluid.numSpray; s++) {
    assert.ok(
      Number.isFinite(fluid.spx[s]) &&
        Number.isFinite(fluid.spy[s]) &&
        Number.isFinite(fluid.svx[s]) &&
        Number.isFinite(fluid.svy[s]),
      `${prefix}Non-finite spray[${s}]`
    );
  }

  for (let s = 0; s < fluid.numSteam; s++) {
    assert.ok(
      Number.isFinite(fluid.stx[s]) &&
        Number.isFinite(fluid.sty[s]) &&
        Number.isFinite(fluid.stvx[s]) &&
        Number.isFinite(fluid.stvy[s]),
      `${prefix}Non-finite steam[${s}]`
    );
  }

  const tel = fluid.telemetry;
  assert.ok(Number.isFinite(tel.avgSpeed), `${prefix}Non-finite telemetry.avgSpeed`);
  assert.ok(Number.isFinite(tel.kineticEnergy), `${prefix}Non-finite telemetry.kineticEnergy`);
  assert.ok(Number.isFinite(tel.splashIntensity), `${prefix}Non-finite telemetry.splashIntensity`);
  assert.ok(Number.isFinite(tel.relayActiveIntensity), `${prefix}Non-finite telemetry.relayActiveIntensity`);
}

function assertMechanismInvariants(mechanisms: MechanismSystem, context = ''): void {
  const prefix = context ? `[${context}] ` : '';
  for (const t of mechanisms.turbines) {
    assert.ok(
      Number.isFinite(t.angle) &&
        Number.isFinite(t.angularVel) &&
        Number.isFinite(t.charge),
      `${prefix}Non-finite state in turbine ${t.id}`
    );
  }
  for (const b of mechanisms.bodies) {
    assert.ok(
      Number.isFinite(b.x) &&
        Number.isFinite(b.y) &&
        Number.isFinite(b.vx) &&
        Number.isFinite(b.vy) &&
        Number.isFinite(b.angle) &&
        Number.isFinite(b.angularVel) &&
        Number.isFinite(b.submergedRatio),
      `${prefix}Non-finite state in body ${b.id}`
    );
    assert.ok(
      b.x >= 0 && b.x <= WORLD_W && b.y >= 0 && b.y <= WORLD_H,
      `${prefix}Out-of-bounds body ${b.id}: (${b.x}, ${b.y})`
    );
  }
  for (const w of mechanisms.crackedWalls) {
    assert.ok(
      Number.isFinite(w.hp) && Number.isFinite(w.stressGlow),
      `${prefix}Non-finite state in crackedWall ${w.id}`
    );
  }
  for (const v of mechanisms.magmaVents) {
    assert.ok(
      Number.isFinite(v.heat) && Number.isFinite(v.steamPulse),
      `${prefix}Non-finite state in magmaVent ${v.id}`
    );
  }
  for (const p of mechanisms.portals) {
    assert.ok(Number.isFinite(p.pulse), `${prefix}Non-finite pulse in portal ${p.id}`);
  }
  for (const m of mechanisms.mines) {
    assert.ok(
      Number.isFinite(m.x) &&
        Number.isFinite(m.y) &&
        Number.isFinite(m.vx) &&
        Number.isFinite(m.vy) &&
        Number.isFinite(m.angle) &&
        Number.isFinite(m.angularVel) &&
        Number.isFinite(m.submergedRatio) &&
        Number.isFinite(m.respawnTimer) &&
        Number.isFinite(m.portalCooldown) &&
        Number.isFinite(m.flash),
      `${prefix}Non-finite state in mine ${m.id}`
    );
    if (!m.detonated) {
      assert.ok(
        m.x >= 0 && m.x <= WORLD_W && m.y >= 0 && m.y <= WORLD_H,
        `${prefix}Out-of-bounds mine ${m.id}: (${m.x}, ${m.y})`
      );
    }
  }
  for (const s of mechanisms.seesaws) {
    assert.ok(
      Number.isFinite(s.angle) && Number.isFinite(s.angularVel),
      `${prefix}Non-finite state in seesaw ${s.id}`
    );
    assert.ok(
      Math.abs(s.angle - s.restAngle) <= s.maxAngle + 1e-6,
      `${prefix}Seesaw ${s.id} angle=${s.angle} exceeded bounds`
    );
  }
  for (const v of mechanisms.valves) {
    assert.ok(Number.isFinite(v.angle), `${prefix}Non-finite angle in valve ${v.id}`);
  }
  for (const r of mechanisms.relays) {
    assert.ok(
      Number.isFinite(r.charge) && r.charge >= 0 && r.charge <= 1,
      `${prefix}Invalid charge=${r.charge} in relay ${r.id}`
    );
  }
  for (const p of mechanisms.pumps) {
    assert.ok(
      Number.isFinite(p.power) && p.power >= 0 && p.power <= 1,
      `${prefix}Invalid power=${p.power} in pump ${p.id}`
    );
  }
  for (const d of mechanisms.debris) {
    assert.ok(
      Number.isFinite(d.x) &&
        Number.isFinite(d.y) &&
        Number.isFinite(d.vx) &&
        Number.isFinite(d.vy) &&
        Number.isFinite(d.angle),
      `${prefix}Non-finite state in debris`
    );
  }
}

describe('AQUALITH v2 Physics & Simulation Verification', () => {
  let originalRandom: () => number;

  beforeEach(() => {
    originalRandom = Math.random;
    Math.random = createSeededRandom(0x5a0a117 + 42);
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  describe('1. Baseline FLIP & Core Mechanism Verification', () => {
    test('600-step FLIP stability in bounded stone basin', () => {
      const level = makeCustomLevel({
        solids: [
          ...OUTER_FRAME,
          { kind: 'rect', x: 2.0, y: 0.5, w: 0.5, h: 4.5 },
          { kind: 'rect', x: 11.5, y: 0.5, w: 0.5, h: 4.5 },
        ],
        pools: [{ x: 2.6, y: 0.55, w: 8.8, h: 2.2, fillFactor: 0.9 }],
      });

      const sim = createSimContext(level);
      const initialCount = sim.fluid.numParticles;
      assert.ok(initialCount > 1000, `Expected >1000 particles in pool, got ${initialCount}`);

      sim.stepFrames(600, {
        onAfterStep(frame) {
          if ((frame + 1) % 60 === 0) {
            assertFluidInvariants(sim.fluid, level.maxTotalParticles, `frame ${frame + 1}`);
          }
        },
      });

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'frame 600');
      assert.equal(
        sim.fluid.numParticles,
        initialCount,
        'Bounded basin with no drains should conserve particle count'
      );
    });

    test('Hydrostatic leveling across flat open trough', () => {
      const level = makeCustomLevel({
        pools: [{ x: 1.0, y: 0.55, w: 4.0, h: 4.0, fillFactor: 1.0 }],
      });

      const sim = createSimContext(level);
      const total = sim.fluid.numParticles;
      assert.ok(total > 1500, `Expected tall column >1500 particles, got ${total}`);

      sim.stepFrames(360);
      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'hydrostatic-360');

      let leftCount = 0;
      let rightCount = 0;
      let leftYSum = 0;
      let rightYSum = 0;

      for (let p = 0; p < sim.fluid.numParticles; p++) {
        const x = sim.fluid.px[p];
        const y = sim.fluid.py[p];
        if (x < 8.0) {
          leftCount++;
          leftYSum += y;
        } else if (x > 8.0) {
          rightCount++;
          rightYSum += y;
        }
      }

      assert.ok(rightCount > total * 0.3, `Expected >30% on right half, got ${rightCount}/${total}`);
      assert.ok(leftCount > total * 0.3, `Expected >30% on left half, got ${leftCount}/${total}`);

      const meanLeftY = leftYSum / leftCount;
      const meanRightY = rightYSum / rightCount;
      const heightDiff = Math.abs(meanLeftY - meanRightY);
      assert.ok(
        heightDiff < 0.45,
        `Expected left (${meanLeftY.toFixed(3)}m) vs right (${meanRightY.toFixed(3)}m) mean height within 0.45m, got ${heightDiff.toFixed(3)}m`
      );
    });

    test('Ice sculpt retention & shatter surge release', () => {
      const level = makeCustomLevel({ maxFrostCells: 700 });
      const sim = createSimContext(level);

      for (let wy = 0.55; wy <= 5.5; wy += 0.12) {
        sim.terrain.paintIce(6.0, wy, 0.24, level.maxFrostCells);
      }
      sim.terrain.rebuildSDFIfDirty();
      assert.ok(sim.terrain.frostCount > 40, `Expected ice dam cells >40, got ${sim.terrain.frostCount}`);

      const spawned = sim.fluid.spawnPool(1.5, 0.55, 3.7, 3.6, level.maxTotalParticles, 0.95);
      assert.ok(spawned > 1000, `Expected >1000 impounded particles, got ${spawned}`);

      sim.stepFrames(120);
      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'ice-retained');

      let escapedBefore = 0;
      for (let p = 0; p < sim.fluid.numParticles; p++) {
        if (sim.fluid.px[p] > 6.3) escapedBefore++;
      }
      assert.ok(escapedBefore <= 5, `Expected <=5 particles past x=6.3 while intact, got ${escapedBefore}`);

      const shatteredCells = sim.terrain.shatterAllIce();
      sim.mechanisms.spawnIceShards(shatteredCells);
      assert.ok(shatteredCells.length > 40, 'Expected shattered ice cell centers');
      assert.equal(sim.terrain.frostCount, 0, 'frostCount should reset to 0 after shatter');
      assert.ok(sim.mechanisms.debris.some((d) => d.kind === 'ice'), 'Expected ice shard debris');

      sim.stepFrames(150);
      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'ice-shattered');

      let floodedAfter = 0;
      let maxX = 0;
      for (let p = 0; p < sim.fluid.numParticles; p++) {
        const x = sim.fluid.px[p];
        if (x > 6.3) floodedAfter++;
        if (x > maxX) maxX = x;
      }
      assert.ok(floodedAfter > sim.fluid.numParticles * 0.25, `Expected surge past x=6.3, got ${floodedAfter}`);
      assert.ok(maxX > 9.0, `Expected flood front >9.0m, got ${maxX.toFixed(2)}m`);
    });

    test('Turbine fluid torque & full charge completion', () => {
      const level = makeCustomLevel({
        drains: [{ x: 11.5, y: 0.0, w: 4.0, h: 0.68 }],
        turbines: [
          {
            id: 't-main',
            x: 8.0,
            y: 4.2,
            radius: 0.85,
            targetCharge: 1.0,
            decayRate: 0.03,
            lockOnFull: true,
          },
        ],
        spouts: [
          {
            id: 's-turbine',
            x: 6.4,
            y: 4.85,
            dirX: 0.98,
            dirY: -0.2,
            speed: 5.0,
            rate: 280,
            radius: 0.22,
            enabled: true,
          },
        ],
      });

      const sim = createSimContext(level);
      sim.stepFrames(360);
      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'turbine-360');
      assertMechanismInvariants(sim.mechanisms, 'turbine-360');

      const turbine = sim.mechanisms.turbines[0];
      assert.ok(Math.abs(turbine.angle) > 2.0, `Expected |angle| > 2.0, got ${turbine.angle.toFixed(3)}`);
      assert.ok(turbine.charge >= 0.99, `Expected charge ~1.0, got ${turbine.charge.toFixed(3)}`);
      assert.equal(turbine.completed, true, 'Expected turbine.completed === true');
      assert.equal(sim.mechanisms.isLevelComplete(), true, 'Expected level objective complete');
    });

    test('Archimedes buoyancy lifts Relic Ark in flooded basin', () => {
      const level = makeCustomLevel({
        solids: [
          ...OUTER_FRAME,
          { kind: 'rect', x: 4.5, y: 0.5, w: 0.5, h: 5.0 },
          { kind: 'rect', x: 9.0, y: 0.5, w: 0.5, h: 5.0 },
        ],
        bodies: [{ id: 'ark-buoy', kind: 'ark', x: 7.0, y: 0.8, w: 1.05, h: 0.52, density: 0.5 }],
        spouts: [
          { id: 's-left', x: 5.4, y: 4.5, dirX: 0.15, dirY: -1.0, speed: 3.5, rate: 280, radius: 0.2, enabled: false },
          { id: 's-right', x: 8.6, y: 4.5, dirX: -0.15, dirY: -1.0, speed: 3.5, rate: 280, radius: 0.2, enabled: false },
        ],
      });

      const sim = createSimContext(level);
      const ark = sim.mechanisms.bodies[0];

      sim.stepFrames(20);
      const dryY = ark.y;
      assert.ok(dryY >= 0.72 && dryY <= 0.85, `Expected dry resting y near 0.76m, got ${dryY.toFixed(3)}m`);
      assert.equal(ark.submergedRatio, 0, 'Ark should be dry before flooding');

      sim.mechanisms.toggleSpouts(true);
      sim.stepFrames(300);

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'ark-buoyancy');
      assertMechanismInvariants(sim.mechanisms, 'ark-buoyancy');

      const deltaY = ark.y - dryY;
      assert.ok(deltaY > 0.8, `Expected Δy > 0.8m, got ${deltaY.toFixed(3)}m`);
      assert.ok(ark.y > 1.6, `Expected Ark well above floor, got y=${ark.y.toFixed(3)}`);
      assert.ok(ark.submergedRatio > 0.1, `Expected partial submergence, got ${ark.submergedRatio.toFixed(3)}`);
    });

    test('Cracked wall resists calm trickle and shatters on fast flood surge', () => {
      const level = makeCustomLevel({
        solids: [...OUTER_FRAME, { kind: 'rect', x: 5.75, y: 3.0, w: 0.55, h: 5.5 }],
        crackedWalls: [{ id: 'cw-1', x: 5.8, y: 0.5, w: 0.45, h: 2.5, maxHp: 10, impactThreshold: 2.2 }],
      });

      const sim = createSimContext(level);
      const wall = sim.mechanisms.crackedWalls[0];

      sim.fluid.spawnPool(4.2, 0.55, 1.5, 0.5, level.maxTotalParticles, 0.85);
      sim.stepFrames(120);
      assert.equal(wall.broken, false, 'Calm water must not break cracked wall');
      assert.equal(wall.hp, wall.maxHp, `Expected intact HP, got ${wall.hp}`);

      sim.fluid.triggerTsunami(level.maxTotalParticles);
      let sawRockDebris = false;
      sim.stepFrames(240, {
        onAfterStep() {
          if (sim.mechanisms.debris.some((d) => d.kind === 'rock')) {
            sawRockDebris = true;
          }
        },
      });

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'cracked-wall-surge');
      assertMechanismInvariants(sim.mechanisms, 'cracked-wall-surge');

      assert.equal(wall.broken, true, `Expected surge to break wall (hp=${wall.hp.toFixed(2)})`);
      assert.equal(wall.hp, 0);
      assert.ok(sawRockDebris, 'Expected rock debris chunks');
      assert.ok(sim.fluid.telemetry.wallBreakCount >= 1);

      const ci = Math.floor((wall.x + wall.w * 0.5) * INV_CELL_SIZE);
      const cj = Math.floor((wall.y + wall.h * 0.5) * INV_CELL_SIZE);
      assert.equal(sim.terrain.getKindAtCell(ci, cj), SolidKind.NONE, 'Broken wall cells should clear');
    });

    test('Magma vent produces steam on contact, quenches under flood, and forms obsidian', () => {
      const level = makeCustomLevel({
        solids: [
          ...OUTER_FRAME,
          { kind: 'rect', x: 5.5, y: 0.5, w: 0.5, h: 1.5 },
          { kind: 'rect', x: 9.4, y: 0.5, w: 0.5, h: 1.5 },
        ],
        magmaVents: [{ id: 'mv-1', x: 6.0, y: 0.5, w: 3.4, h: 0.55, maxHeat: 14, reheatRate: 2.0, goalQuench: true }],
        spouts: [{ id: 's-flood', x: 7.7, y: 3.6, dirX: 0, dirY: -1, speed: 4.5, rate: 380, radius: 0.45, enabled: true }],
      });

      const sim = createSimContext(level);
      const vent = sim.mechanisms.magmaVents[0];
      let maxSteamObserved = 0;

      sim.stepFrames(240, {
        onAfterStep() {
          if (sim.fluid.numSteam > maxSteamObserved) {
            maxSteamObserved = sim.fluid.numSteam;
          }
        },
      });

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'magma-quench');
      assertMechanismInvariants(sim.mechanisms, 'magma-quench');

      assert.ok(maxSteamObserved > 0, `Expected steam > 0 during contact, got ${maxSteamObserved}`);
      assert.equal(vent.quenched, true, `Expected magma vent to quench (heat=${vent.heat.toFixed(2)})`);
      assert.equal(vent.heat, 0);
      assert.ok(sim.fluid.telemetry.magmaQuenchCount >= 1);
      assert.equal(sim.mechanisms.isLevelComplete(), true);

      let obsidianCells = 0;
      const iMin = Math.floor(vent.x * INV_CELL_SIZE);
      const iMax = Math.floor((vent.x + vent.w) * INV_CELL_SIZE);
      const jMin = Math.floor(vent.y * INV_CELL_SIZE);
      const jMax = Math.floor((vent.y + vent.h + 0.18) * INV_CELL_SIZE);
      for (let j = jMin; j <= jMax; j++) {
        for (let i = iMin; i <= iMax; i++) {
          const cx = (i + 0.5) * CELL_SIZE;
          const cy = (j + 0.5) * CELL_SIZE;
          if (cx < vent.x || cx > vent.x + vent.w || cy < vent.y || cy > vent.y + vent.h + 0.18) continue;
          const idx = j * GRID_NX + i;
          if (sim.terrain.obsidianMask[idx] === 1 && sim.terrain.getKindAtCell(i, j) === SolidKind.OBSIDIAN) {
            obsidianCells++;
          }
        }
      }
      assert.ok(obsidianCells >= 20, `Expected >=20 obsidian cells, got ${obsidianCells}`);
    });

    test('All 9 levels smoke simulation (120 frames each, zero NaNs/OOB, valid objectives)', () => {
      const allLevels: LevelDef[] = [TITLE_DEMO_LEVEL, ...CAMPAIGN_LEVELS, SANDBOX_LEVEL];
      assert.equal(allLevels.length, 9);

      for (const lvl of allLevels) {
        const sim = createSimContext(lvl);
        sim.stepFrames(120, {
          onAfterStep(frame) {
            if ((frame + 1) % 40 === 0) {
              assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, `${lvl.id} f${frame + 1}`);
              assertMechanismInvariants(sim.mechanisms, `${lvl.id} f${frame + 1}`);
            }
          },
        });

        assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, `${lvl.id} final`);
        assertMechanismInvariants(sim.mechanisms, `${lvl.id} final`);

        const objectives = sim.mechanisms.getObjectives();
        assert.ok(Array.isArray(objectives) && objectives.length > 0, `[${lvl.id}] Expected non-empty objectives`);
        for (const obj of objectives) {
          assert.ok(typeof obj.labelKey === 'string' && obj.labelKey.length > 0, `[${lvl.id}] Invalid labelKey`);
          assert.ok(
            Number.isFinite(obj.progress) && obj.progress >= 0 && obj.progress <= 1,
            `[${lvl.id}] Invalid progress=${obj.progress}`
          );
          assert.equal(typeof obj.done, 'boolean', `[${lvl.id}] Invalid done type`);
        }

        assert.ok(sim.terrain.isSolidCell(0, Math.floor(GRID_NY / 2)), `[${lvl.id}] Left border solid`);
        assert.ok(sim.terrain.isSolidCell(GRID_NX - 1, Math.floor(GRID_NY / 2)), `[${lvl.id}] Right border solid`);
        assert.ok(sim.terrain.isSolidCell(Math.floor(GRID_NX / 2), GRID_NY - 1), `[${lvl.id}] Top border solid`);
      }
    });
  });

  describe('2. All 6 New v2 Mechanics Unit Tests', () => {
    test('Diverter Valve: isHoveringValve, toggleValveAt, OBB angle slerp, and stream redirection', () => {
      const level = makeCustomLevel({
        drains: [{ x: 1.0, y: 0.0, w: 14.0, h: 0.68 }],
        spouts: [
          { id: 's-valve', x: 8.0, y: 7.4, dirX: 0, dirY: -1, speed: 3.0, rate: 260, radius: 0.16, enabled: true },
        ],
        valves: [
          { id: 'v-1', x: 8.0, y: 5.5, length: 2.0, thickness: 0.18, angleA: 0.60, angleB: -0.60, initialToggled: false },
        ],
      });

      const sim = createSimContext(level);
      const valve = sim.mechanisms.valves[0];

      // Hover & hit-testing checks
      assert.equal(sim.mechanisms.isHoveringValve(8.0, 5.5), true, 'Expected hover hit at valve pivot');
      assert.equal(sim.mechanisms.isHoveringValve(8.5, 5.7), true, 'Expected hover hit within valve radius');
      assert.equal(sim.mechanisms.isHoveringValve(3.0, 5.5), false, 'Expected no hover far from valve');
      assert.equal(sim.mechanisms.toggleValveAt(2.0, 2.0), false, 'Expected toggle miss far from valve');
      assert.equal(valve.angle, 0.60);

      // Phase A: angleA = +0.60 deflects vertical stream LEFT (x < 7.2)
      sim.stepFrames(150);
      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'valve-phase-a');
      let leftCountA = 0;
      let rightCountA = 0;
      for (let p = 0; p < sim.fluid.numParticles; p++) {
        if (sim.fluid.py[p] < 5.0) {
          if (sim.fluid.px[p] < 7.3) leftCountA++;
          else if (sim.fluid.px[p] > 8.7) rightCountA++;
        }
      }
      assert.ok(
        leftCountA > 40 && leftCountA > rightCountA * 3,
        `Expected angleA (+0.60) to deflect stream LEFT (left=${leftCountA}, right=${rightCountA})`
      );

      // Toggle valve via toggleValveAt and check OBB angle slerp + telemetry
      assert.equal(sim.mechanisms.toggleValveAt(8.1, 5.45), true, 'Expected toggle hit near valve pivot');
      assert.equal(valve.toggled, true);

      sim.stepFrames(15);
      assert.ok(
        sim.fluid.telemetry.valveToggleCount >= 1,
        `Expected valveToggleCount >= 1, got ${sim.fluid.telemetry.valveToggleCount}`
      );
      assert.ok(
        valve.angle < 0.3 && valve.angle > -0.60,
        `Expected OBB angle slerping smoothly toward -0.60, got ${valve.angle.toFixed(3)}`
      );

      // Finish slerping and collect Phase B water
      sim.stepFrames(180);
      assert.ok(Math.abs(valve.angle - -0.60) < 0.02, `Expected angle converged near -0.60, got ${valve.angle.toFixed(3)}`);

      let leftRecentB = 0;
      let rightRecentB = 0;
      for (let p = 0; p < sim.fluid.numParticles; p++) {
        if (sim.fluid.py[p] > 2.0 && sim.fluid.py[p] < 5.0) {
          if (sim.fluid.px[p] < 7.3) leftRecentB++;
          else if (sim.fluid.px[p] > 8.7) rightRecentB++;
        }
      }
      assert.ok(
        rightRecentB > 30 && rightRecentB > leftRecentB * 3,
        `Expected angleB (-0.60) to redirect stream RIGHT (left=${leftRecentB}, right=${rightRecentB})`
      );
    });

    test('Hydraulic Seesaw: water stream torque tilts plank and rolls buoyant sphere off', () => {
      const level = makeCustomLevel({
        seesaws: [
          { id: 'ss-1', x: 8.0, y: 4.0, length: 3.0, thickness: 0.18, maxAngle: 0.55, restAngle: 0.0, damping: 1.4 },
        ],
        bodies: [
          { id: 'ball-ss', kind: 'sphere', x: 7.8, y: 4.36, w: 0.54, h: 0.54, density: 0.5 },
        ],
        spouts: [
          { id: 's-ss', x: 6.8, y: 7.0, dirX: 0, dirY: -1, speed: 3.8, rate: 300, radius: 0.2, enabled: false },
        ],
      });

      const sim = createSimContext(level);
      const seesaw = sim.mechanisms.seesaws[0];
      const sphere = sim.mechanisms.bodies[0];

      // Rest check for 40 frames: flat seesaw keeps sphere resting near pivot
      sim.stepFrames(40);
      assert.ok(
        Math.abs(sphere.x - 7.8) < 0.35 && sphere.y > 4.0,
        `Sphere should rest near pivot before stream, got (${sphere.x.toFixed(2)}, ${sphere.y.toFixed(2)})`
      );
      assert.ok(Math.abs(seesaw.angle) < 0.08, `Seesaw should remain flat at rest, got ${seesaw.angle.toFixed(3)}`);

      // Turn on spout onto left arm (x=6.8 < pivot x=8.0) -> positive torque tilts left arm down
      sim.mechanisms.toggleSpouts(true);
      let maxAngle = seesaw.angle;
      sim.stepFrames(240, {
        onAfterStep() {
          if (seesaw.angle > maxAngle) maxAngle = seesaw.angle;
        },
      });

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'seesaw-tilt');
      assertMechanismInvariants(sim.mechanisms, 'seesaw-tilt');

      assert.ok(
        maxAngle > 0.25,
        `Expected water stream on left arm to tilt seesaw > 0.25 rad, maxAngle=${maxAngle.toFixed(3)}`
      );
      assert.ok(
        sphere.x < 6.2 && sphere.y < 2.5,
        `Expected tilted seesaw to roll sphere off the left end (x < 6.2, y < 2.5), got (${sphere.x.toFixed(2)}, ${sphere.y.toFixed(2)})`
      );
    });

    test('Floating Hydro-Mine: Archimedes float, wall detonation shockwave, and respawn', () => {
      const level = makeCustomLevel({
        solids: [
          ...OUTER_FRAME,
          { kind: 'rect', x: 6.65, y: 3.3, w: 0.55, h: 5.2 },
          // Second intact wall so mine respawns cleanly after detonating wall 1
          { kind: 'rect', x: 11.45, y: 3.3, w: 0.55, h: 5.2 },
        ],
        crackedWalls: [
          { id: 'cw-mine-1', x: 6.7, y: 0.5, w: 0.45, h: 2.8, maxHp: 80, impactThreshold: 500 },
          { id: 'cw-mine-2', x: 11.5, y: 0.5, w: 0.45, h: 2.8, maxHp: 80, impactThreshold: 500 },
        ],
        mines: [{ id: 'mine-u', x: 3.0, y: 0.78, radius: 0.26, density: 0.45 }],
      });

      const sim = createSimContext(level);
      const mine = sim.mechanisms.mines[0];
      const wall1 = sim.mechanisms.crackedWalls[0];

      // Dry check
      sim.stepFrames(20);
      assert.equal(mine.submergedRatio, 0, 'Dry mine should have submergedRatio === 0');

      // Flood basin and allow mine to rise and settle into floating equilibrium
      sim.fluid.spawnPool(1.0, 0.55, 5.6, 1.6, level.maxTotalParticles, 0.9);
      sim.stepFrames(120);
      assert.ok(mine.submergedRatio > 0.15, `Expected buoyant mine submergedRatio > 0.15, got ${mine.submergedRatio.toFixed(2)}`);
      assert.ok(mine.y > 1.4, `Expected mine to float near surface (start=0.78, now=${mine.y.toFixed(2)})`);
      assert.equal(wall1.broken, false, 'High-threshold wall must not break from calm pool');

      // Surge water + mine rightward into wall 1
      let peakPostBlastSpeed = 0;
      let detonatedFrame = -1;
      for (let f = 0; f < 180; f++) {
        const preDetCount = sim.fluid.telemetry.mineDetonateCount;
        const toolInput = !mine.detonated
          ? makeSurgeInput(Math.max(1.2, mine.x - 0.3), mine.y - 0.15, 11.0, 0.5)
          : null;
        sim.stepFrames(1, { toolInput });

        if (sim.fluid.telemetry.mineDetonateCount > preDetCount) {
          detonatedFrame = f;
          for (let p = 0; p < sim.fluid.numParticles; p++) {
            const spd = Math.hypot(sim.fluid.vx[p], sim.fluid.vy[p]);
            if (spd > peakPostBlastSpeed) peakPostBlastSpeed = spd;
          }
          break;
        }
      }

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'mine-detonate');
      assertMechanismInvariants(sim.mechanisms, 'mine-detonate');

      assert.ok(detonatedFrame >= 0, 'Expected mine to detonate against CrackedWall 1');
      assert.equal(mine.detonated, true);
      assert.equal(wall1.broken, true);
      assert.ok(sim.fluid.telemetry.mineDetonateCount >= 1);
      assert.ok(
        peakPostBlastSpeed > 7.5,
        `Expected radial shockwave to accelerate nearby particles (>7.5 m/s), got max=${peakPostBlastSpeed.toFixed(2)}`
      );

      // Step 180 frames (>2.5s respawnTimer) while cw-mine-2 remains intact -> mine respawns
      sim.stepFrames(180);
      assert.equal(mine.detonated, false, 'Expected mine to respawn while intact CrackedWall exists');
      assert.ok(
        Math.hypot(mine.x - mine.spawnX, mine.y - mine.spawnY) < 1.2,
        `Expected respawned mine near spawn (${mine.spawnX}, ${mine.spawnY}), got (${mine.x.toFixed(2)}, ${mine.y.toFixed(2)})`
      );
    });

    test('Hydro-Portal: teleports water particles and bodies preserving velocity along exit direction', () => {
      const level = makeCustomLevel({
        portals: [
          {
            id: 'p-test',
            inX: 4.0,
            inY: 2.0,
            outX: 10.5,
            outY: 6.5,
            outDirX: 1.0,
            outDirY: 0.0,
            radius: 0.62,
            boost: 1.4,
          },
        ],
        spouts: [
          { id: 's-portal', x: 4.0, y: 4.0, dirX: 0, dirY: -1, speed: 4.0, rate: 280, radius: 0.2, enabled: true },
        ],
        bodies: [{ id: 'orb-p', kind: 'sphere', x: 4.0, y: 3.1, w: 0.56, h: 0.56, density: 0.5 }],
      });

      const sim = createSimContext(level);
      const orb = sim.mechanisms.bodies[0];
      let sawBodyExitRight = false;
      let maxExitSpeedX = 0;

      sim.stepFrames(120, {
        onAfterStep() {
          if (orb.x > 10.5 && orb.y > 5.0 && orb.vx > 4.0) {
            sawBodyExitRight = true;
          }
          for (let p = 0; p < sim.fluid.numParticles; p++) {
            if (sim.fluid.px[p] > 10.5 && sim.fluid.py[p] > 5.2 && sim.fluid.vx[p] > maxExitSpeedX) {
              maxExitSpeedX = sim.fluid.vx[p];
            }
          }
        },
      });

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'portal-120');
      assertMechanismInvariants(sim.mechanisms, 'portal-120');

      assert.ok(
        sim.fluid.telemetry.portalPulseCount >= 1,
        `Expected portalPulseCount >= 1, got ${sim.fluid.telemetry.portalPulseCount}`
      );
      assert.ok(sawBodyExitRight, `Expected orb to teleport out of portal moving along +X (last pos=(${orb.x.toFixed(2)}, ${orb.y.toFixed(2)}))`);
      assert.ok(
        maxExitSpeedX >= 6.5,
        `Expected boosted water particle exit speed along outDirX >= 6.5 m/s, got ${maxExitSpeedX.toFixed(2)}`
      );
    });

    test('Hydro-Relay: remains off when dry, bridges CellType.FLUID electrodes, and opens linked gate', () => {
      const level = makeCustomLevel({
        solids: [
          ...OUTER_FRAME,
          { kind: 'rect', x: 2.5, y: 0.5, w: 0.5, h: 1.5 },
          { kind: 'rect', x: 9.0, y: 0.5, w: 0.5, h: 1.5 },
          { kind: 'rect', x: 11.5, y: 3.5, w: 0.5, h: 5.0 },
        ],
        relays: [
          { id: 'r-test', ax: 3.6, ay: 0.9, bx: 8.4, by: 0.9, radius: 0.45, linkedGateId: 'g-relay', isObjective: true },
        ],
        gates: [
          {
            id: 'g-relay',
            x: 11.55,
            y: 0.5,
            w: 0.45,
            h: 3.0,
            openOffsetX: 0,
            openOffsetY: 3.0,
            requiredTriggerIds: ['r-test'],
            speed: 2.5,
          },
        ],
      });

      const sim = createSimContext(level);
      const relay = sim.mechanisms.relays[0];
      const gate = sim.mechanisms.gates[0];

      // Dry phase
      sim.stepFrames(30);
      assert.equal(relay.active, false, 'Dry relay must stay inactive');
      assert.equal(relay.charge, 0, 'Dry relay charge must remain 0');
      assert.equal(relay.bridgePath.length, 0, 'Dry relay bridgePath must be empty');
      assert.equal(gate.isOpen, false, 'Gate must remain closed while relay dry');

      // Flood conductive water bridge spanning electrodes (x: 3.1..8.9)
      sim.fluid.spawnPool(3.1, 0.55, 5.8, 0.85, level.maxTotalParticles, 0.92);
      sim.stepFrames(90);

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'relay-bridged');
      assertMechanismInvariants(sim.mechanisms, 'relay-bridged');

      assert.ok(relay.bridgePath.length >= 2, `Expected bridgePath.length >= 2, got ${relay.bridgePath.length}`);
      assert.ok(relay.charge >= 0.75, `Expected relay.charge >= 0.75, got ${relay.charge.toFixed(3)}`);
      assert.equal(relay.active, true, 'Expected relay.active === true when bridged');
      assert.ok(sim.fluid.telemetry.relayActiveIntensity >= 0.75);
      assert.equal(gate.isOpen, true, 'Expected linked gate to open when relay activates');
      assert.equal(sim.mechanisms.isLevelComplete(), true, 'Expected objective relay completion');
    });

    test('Geyser Pump: stays inactive until triggered, then accelerates water and bodies along nozzle vector', () => {
      const level = makeCustomLevel({
        solids: [
          ...OUTER_FRAME,
          { kind: 'rect', x: 5.5, y: 0.5, w: 0.5, h: 2.5 },
          { kind: 'rect', x: 10.0, y: 0.5, w: 0.5, h: 2.5 },
        ],
        pools: [{ x: 6.05, y: 0.55, w: 3.9, h: 1.2, fillFactor: 0.9 }],
        bodies: [{ id: 'ball-pump', kind: 'sphere', x: 8.0, y: 1.5, w: 0.56, h: 0.56, density: 0.52 }],
        valves: [
          { id: 'v-pump-trig', x: 2.5, y: 6.5, length: 1.2, thickness: 0.16, angleA: 0.4, angleB: -0.4, initialToggled: false },
        ],
        pumps: [
          {
            id: 'p-test',
            x: 8.0,
            y: 0.7,
            dirX: 0,
            dirY: 1,
            force: 42.0,
            range: 6.5,
            radius: 1.3,
            requiredTriggerIds: ['v-pump-trig'],
          },
        ],
      });

      const sim = createSimContext(level);
      const pump = sim.mechanisms.pumps[0];
      const ball = sim.mechanisms.bodies[0];

      // Phase A: Untriggered
      sim.stepFrames(45);
      assert.equal(pump.active, false, 'Pump must stay inactive until trigger satisfied');
      assert.equal(pump.power, 0, 'Untriggered pump power must remain 0');
      assert.ok(ball.y < 2.2, `Ball should stay floating calmly low before pump triggers, got y=${ball.y.toFixed(2)}`);

      // Phase B: Satisfy trigger -> pump launches water and ball upward
      assert.equal(sim.mechanisms.toggleValveAt(2.5, 6.5), true);
      let maxBallY = ball.y;
      let maxWaterY = 0;
      sim.stepFrames(90, {
        onAfterStep() {
          if (ball.y > maxBallY) maxBallY = ball.y;
          for (let p = 0; p < sim.fluid.numParticles; p++) {
            if (sim.fluid.py[p] > maxWaterY) maxWaterY = sim.fluid.py[p];
          }
        },
      });

      assertFluidInvariants(sim.fluid, level.maxTotalParticles, 'pump-active');
      assertMechanismInvariants(sim.mechanisms, 'pump-active');

      assert.equal(pump.active, true);
      assert.ok(pump.power > 0.9, `Expected pump power > 0.9, got ${pump.power.toFixed(3)}`);
      assert.ok(maxBallY > 4.2, `Expected triggered pump to launch ball > 4.2m, got ${maxBallY.toFixed(2)}`);
      assert.ok(maxWaterY > 4.2, `Expected triggered pump to jet water > 4.2m, got ${maxWaterY.toFixed(2)}`);
    });
  });

  describe('3. Strict Anti-Auto-Solve Audit (ALL 7 Campaign Levels, 900 frames zero input)', () => {
    for (const lvl of CAMPAIGN_LEVELS) {
      test(`${lvl.id}: must not auto-complete or accidentally trip triggered gates/objectives in 900 frames`, () => {
        const sim = createSimContext(lvl);
        sim.stepFrames(900);

        assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, `${lvl.id}-audit-900`);
        assertMechanismInvariants(sim.mechanisms, `${lvl.id}-audit-900`);

        assert.equal(
          sim.mechanisms.isLevelComplete(),
          false,
          `[${lvl.id}] Level must not auto-complete with zero input`
        );

        for (const g of sim.mechanisms.gates) {
          assert.ok(
            !g.isOpen && g.openProgress < 0.05,
            `[${lvl.id}] Anti-auto-solve leak: gate "${g.id}" opened automatically (openProgress=${g.openProgress.toFixed(2)}, isOpen=${g.isOpen}) with zero input`
          );
        }
        for (const r of sim.mechanisms.relays) {
          assert.ok(
            !r.active && r.charge < 0.1,
            `[${lvl.id}] Anti-auto-solve leak: relay "${r.id}" charged automatically (charge=${r.charge.toFixed(2)}, active=${r.active}) with zero input`
          );
        }
        for (const t of sim.mechanisms.turbines) {
          assert.ok(
            !t.completed && t.charge < 0.25,
            `[${lvl.id}] Anti-auto-solve leak: turbine "${t.id}" charged automatically (charge=${t.charge.toFixed(2)}, completed=${t.completed}) with zero input`
          );
        }
        for (const w of sim.mechanisms.crackedWalls) {
          assert.equal(
            w.broken,
            false,
            `[${lvl.id}] Anti-auto-solve leak: crackedWall "${w.id}" shattered automatically with zero input`
          );
        }
        for (const v of sim.mechanisms.magmaVents) {
          if (v.goalQuench) {
            assert.equal(
              v.quenched,
              false,
              `[${lvl.id}] Anti-auto-solve leak: goal magmaVent "${v.id}" quenched automatically with zero input`
            );
          }
        }
        for (const g of sim.mechanisms.goals) {
          assert.equal(
            g.fulfilled,
            false,
            `[${lvl.id}] Anti-auto-solve leak: goal "${g.id}" fulfilled automatically with zero input`
          );
        }
      });
    }
  });

  describe('4. v2 Interactive Solvability Checkpoints (Chapters 1..7)', () => {
    test('Chapter 1: toggle valve-1 and build ice ramp to spin Turbine 1 to completion', () => {
      const lvl = CAMPAIGN_LEVELS[0];
      assert.equal(lvl.id, 'level-1');
      const sim = createSimContext(lvl);

      assert.equal(sim.mechanisms.toggleValveAt(1.9, 5.7), true);
      for (let t = 0; t <= 1; t += 0.02) {
        sim.terrain.paintIce(2.4 + t * 8.6, 5.2 - t * 0.45, 0.22, lvl.maxFrostCells);
      }
      sim.terrain.rebuildSDFIfDirty();

      for (let f = 0; f < 540; f++) {
        sim.stepFrames(1);
        if (sim.mechanisms.isLevelComplete()) break;
      }

      assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, 'ch1');
      assert.equal(sim.mechanisms.turbines[0].completed, true);
      assert.equal(sim.mechanisms.isLevelComplete(), true);
    });

    test('Chapter 2: flip valve-2 to bridge relay-1, open gate-1, and float Ark to altar-2', () => {
      const lvl = CAMPAIGN_LEVELS[1];
      assert.equal(lvl.id, 'level-2');
      const sim = createSimContext(lvl);

      assert.equal(sim.mechanisms.toggleValveAt(1.85, 5.8), true);
      const ark = sim.mechanisms.bodies[0];

      for (let f = 0; f < 600; f++) {
        const toolInput =
          f >= 200
            ? makeSurgeInput(Math.max(7.6, ark.x - 0.5), ark.y - 0.1, 9.0, 1.5)
            : null;
        sim.stepFrames(1, { toolInput });
        if (sim.mechanisms.isLevelComplete()) break;
      }

      assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, 'ch2');
      assert.equal(sim.mechanisms.relays[0].active, true);
      assert.equal(sim.mechanisms.gates[0].isOpen, true);
      assert.equal(sim.mechanisms.goals[0].fulfilled, true);
      assert.equal(sim.mechanisms.isLevelComplete(), true);
    });

    test('Chapter 3: flip valve-3 onto seesaw to detonate mine-1 on Wall 1, break Wall 2, and charge both turbines', () => {
      const lvl = CAMPAIGN_LEVELS[2];
      assert.equal(lvl.id, 'level-3');
      const sim = createSimContext(lvl);

      assert.equal(sim.mechanisms.toggleValveAt(1.85, 6.8), true);
      for (let f = 0; f < 900; f++) {
        let toolInput: ToolForceInput | null = null;
        if (sim.mechanisms.crackedWalls[0].broken && !sim.mechanisms.turbines[0].completed) {
          toolInput = makeSurgeInput(7.4 + ((f % 20) / 20) * 1.2, 2.8, 11.0, 2.0);
        } else if (sim.mechanisms.crackedWalls[1].broken && !sim.mechanisms.turbines[1].completed) {
          toolInput = makeSurgeInput(10.8 + ((f % 25) / 25) * 1.8, 1.3, 13.0, 4.5);
        }
        sim.stepFrames(1, { toolInput });
        if (sim.mechanisms.isLevelComplete()) break;
      }

      assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, 'ch3');
      assert.ok(sim.fluid.telemetry.mineDetonateCount >= 1, 'Expected mine-1 detonation');
      assert.equal(sim.mechanisms.crackedWalls[0].broken, true);
      assert.equal(sim.mechanisms.crackedWalls[1].broken, true);
      assert.equal(sim.mechanisms.turbines[0].completed, true);
      assert.equal(sim.mechanisms.turbines[1].completed, true);
      assert.equal(sim.mechanisms.isLevelComplete(), true);
    });

    test('Chapter 4: launch water into Amber Portal and toggle valve-4 to charge both twin turbines', () => {
      const lvl = CAMPAIGN_LEVELS[3];
      assert.equal(lvl.id, 'level-4');
      const sim = createSimContext(lvl);

      for (let cycle = 0; cycle < 4; cycle++) {
        if (cycle === 2) {
          assert.equal(sim.mechanisms.toggleValveAt(8.0, 6.45), true);
        }
        for (let f = 0; f < 45; f++) {
          sim.stepFrames(1, { toolInput: makeVortexHoldInput(5.8, 2.0, f / 60) });
        }
        sim.stepFrames(1, { toolInput: makeVortexBurstInput(5.8, 2.0, 0.85, 0.52, 10.5) });
        sim.stepFrames(160);
        if (sim.mechanisms.isLevelComplete()) break;
      }

      assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, 'ch4');
      assert.ok(sim.fluid.telemetry.portalPulseCount >= 20, 'Expected portal-1 teleport stream');
      assert.equal(sim.mechanisms.turbines[0].completed, true);
      assert.equal(sim.mechanisms.turbines[1].completed, true);
      assert.equal(sim.mechanisms.isLevelComplete(), true);
    });

    test('Chapter 5: flip valve-5, quench magma-bridge into obsidian, and ride steam geyser to altar-5', () => {
      const lvl = CAMPAIGN_LEVELS[4];
      assert.equal(lvl.id, 'level-5');
      const sim = createSimContext(lvl);

      assert.equal(sim.mechanisms.toggleValveAt(1.75, 6.0), true);
      const sphere = sim.mechanisms.bodies[0];

      for (let f = 0; f < 780; f++) {
        let toolInput: ToolForceInput | null = null;
        if (sphere.x < 11.9) {
          const t = (f % 40) / 40;
          const dragX = sphere.x < 6.0 ? 3.2 + t * 2.6 : Math.max(6.0, sphere.x - 0.35);
          const dragY = sphere.x < 6.0 ? 1.8 + t * 1.1 : 1.4;
          toolInput = makeSurgeInput(dragX, dragY, 11.0, sphere.x < 6.0 ? 3.5 : 0.3);
        }
        sim.stepFrames(1, { toolInput });
        if (sim.mechanisms.isLevelComplete()) break;
      }

      assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, 'ch5');
      assert.equal(sim.mechanisms.magmaVents[0].quenched, true);
      assert.equal(sim.mechanisms.magmaVents[1].quenched, false);
      assert.equal(sim.mechanisms.goals[0].fulfilled, true);
      assert.equal(sim.mechanisms.isLevelComplete(), true);
    });

    test('Chapter 6: flip valve-6 to activate relay-6 & pump-6, launch mine-6 into wall-6, and float Ark to altar-6', () => {
      const lvl = CAMPAIGN_LEVELS[5];
      assert.equal(lvl.id, 'level-6');
      const sim = createSimContext(lvl);

      assert.equal(sim.mechanisms.toggleValveAt(1.85, 6.0), true);

      // Let relay-6 trigger pump-6 and launch mine-6 onto the upper seesaw toward wall-6
      const mine = sim.mechanisms.mines[0];
      let maxMineX = mine.x;
      let maxMineY = mine.y;
      sim.stepFrames(260, {
        onAfterStep() {
          if (mine.x > maxMineX) maxMineX = mine.x;
          if (mine.y > maxMineY) maxMineY = mine.y;
        },
      });
      assert.equal(sim.mechanisms.relays[0].active, true);
      assert.equal(sim.mechanisms.pumps[0].active, true);
      assert.equal(sim.mechanisms.gates[0].isOpen, true);
      assert.ok(
        maxMineY > 4.5 && maxMineX > 10.0,
        `Expected pump-6 to catapult mine-6 onto upper seesaw toward wall-6 (maxPos=(${maxMineX.toFixed(2)}, ${maxMineY.toFixed(2)}))`
      );
      assert.equal(sim.mechanisms.crackedWalls[0].broken, true);

      const ark = sim.mechanisms.bodies[0];
      for (let f = 0; f < 360; f++) {
        sim.stepFrames(1, {
          toolInput: makeSurgeInput(Math.max(6.0, ark.x - 0.4), ark.y - 0.05, 10.0, 1.0),
        });
        if (sim.mechanisms.isLevelComplete()) break;
      }

      assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, 'ch6');
      assert.equal(sim.mechanisms.goals[0].fulfilled, true);
      assert.equal(sim.mechanisms.isLevelComplete(), true);
    });

    test('Chapter 7: multi-stage valves, portal-7, turbines, dam-great, relay-7, pump-7, and gate-crown checkpoints', () => {
      const lvl = CAMPAIGN_LEVELS[6];
      assert.equal(lvl.id, 'level-7');
      const sim = createSimContext(lvl);
      const ark = sim.mechanisms.bodies[0];

      // Stage 1: toggle valve-7a -> spin turbine-1 & feed portal-7, while carrying Ark over weir (x=11.8) to bridge relay-7
      assert.equal(sim.mechanisms.toggleValveAt(1.8, 6.9), true);
      for (let f = 0; f < 160; f++) {
        const toolInput =
          ark.x < 12.6
            ? makeSurgeInput(8.6 + ((f % 25) / 25) * 2.2, 1.0, 8.5, 3.5)
            : null;
        sim.stepFrames(1, { toolInput });
      }
      sim.stepFrames(220);
      assert.equal(sim.mechanisms.turbines[0].completed, true, 'Expected turbine-1 to complete');
      assert.ok(sim.fluid.telemetry.portalPulseCount > 0, 'Expected portal-7 to fire');
      assert.equal(sim.mechanisms.relays[0].active, true, 'Expected relay-7 to activate');
      assert.equal(sim.mechanisms.pumps[0].active, true, 'Expected pump-7 to activate');

      // Stage 2: toggle valve-7b -> spin turbine-2, shatter dam-great, open gate-crown & lift Crown Ark via pump-7
      assert.equal(sim.mechanisms.toggleValveAt(3.8, 5.65), true);
      let maxArkY = ark.y;
      sim.stepFrames(480, {
        onAfterStep() {
          if (ark.y > maxArkY) maxArkY = ark.y;
        },
      });

      assertFluidInvariants(sim.fluid, lvl.maxTotalParticles, 'ch7');
      assertMechanismInvariants(sim.mechanisms, 'ch7');
      assert.equal(sim.mechanisms.turbines[1].completed, true, 'Expected turbine-2 to complete');
      assert.equal(sim.mechanisms.crackedWalls[0].broken, true, 'Expected dam-great to shatter');
      assert.equal(sim.mechanisms.gates[0].isOpen, true, 'Expected gate-crown to open');
      assert.ok(maxArkY > 5.4, `Expected pump-7 to lift Crown Ark above gate level (>5.4m), got ${maxArkY.toFixed(2)}`);
    });
  });
});
