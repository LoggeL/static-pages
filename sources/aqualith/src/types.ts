// Shared Constants, Coordinate System & Interfaces for AQUALITH
// Logical World: 16.0m x 9.0m, Origin (0,0) = BOTTOM-LEFT, +X right, +Y UP.
// Grid: 128 x 72 cells (CELL_SIZE = 0.125m), row-major idx = j * GRID_NX + i.

export const WORLD_W = 16.0;
export const WORLD_H = 9.0;
export const GRID_NX = 128;
export const GRID_NY = 72;
export const CELL_SIZE = 0.125;
export const INV_CELL_SIZE = 8.0;
export const GRAVITY = -11.5;

export const MAX_PARTICLES = 7500;
export const MAX_SPRAY = 1800;
export const MAX_STEAM = 900;
export const MAX_DEBRIS = 250;
export const PARTICLE_RADIUS = 0.042;

export const CellType = {
  AIR: 0,
  FLUID: 1,
  SOLID: 2,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

export const SolidKind = {
  NONE: 0,
  ROCK: 1,
  ICE: 2,
  GATE: 3,
  CRACKED_WALL: 4,
  OBSIDIAN: 5,
} as const;
export type SolidKind = (typeof SolidKind)[keyof typeof SolidKind];

export type ToolId = 'surge' | 'ice' | 'vortex' | 'pour' | 'drain' | 'rock';
export type QualityLevel = 'high' | 'ultra';
export type Lang = 'de' | 'en';
export type ScreenMode = 'title' | 'playing' | 'victory';

export type TerrainShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'poly'; points: Array<[number, number]> }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'capsule'; x1: number; y1: number; x2: number; y2: number; r: number };

export interface AmbientLantern {
  x: number;
  y: number;
  color: [number, number, number];
  radius: number;
}

export interface LevelTheme {
  skyTop: [number, number, number];
  skyBottom: [number, number, number];
  rockTint: [number, number, number];
  waterDeep: [number, number, number];
  waterShallow: [number, number, number];
  lightDir: [number, number];
  sunColor: [number, number, number];
  ambientLanterns: AmbientLantern[];
}

export interface WaterSpoutDef {
  id: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  rate: number;
  radius: number;
  maxParticles?: number;
  enabled?: boolean;
}

export interface InitialPoolDef {
  x: number;
  y: number;
  w: number;
  h: number;
  fillFactor?: number;
}

export interface DrainZoneDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TurbineDef {
  id: string;
  x: number;
  y: number;
  radius: number;
  targetCharge?: number;
  decayRate: number;
  lockOnFull?: boolean;
  linkedGateId?: string;
}

export interface BuoyantBodyDef {
  id: string;
  kind: 'ark' | 'sphere';
  x: number;
  y: number;
  w: number;
  h: number;
  density: number;
}

export interface RelicGoalDef {
  id: string;
  bodyId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CisternSensorDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  thresholdParticles: number;
  linkedGateId?: string;
}

export interface SluiceGateDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  openOffsetX: number;
  openOffsetY: number;
  requiredTriggerIds: string[];
  speed?: number;
}

export interface CrackedWallDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  maxHp: number;
  impactThreshold: number;
}

export interface MagmaVentDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  maxHeat: number;
  reheatRate: number;
  goalQuench?: boolean;
}

export interface PortalPairDef {
  id: string;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
  outDirX: number;
  outDirY: number;
  radius: number;
  boost?: number;
}

export interface HydroMineDef {
  id: string;
  x: number;
  y: number;
  radius?: number;
  density?: number;
}

export interface SeesawDef {
  id: string;
  x: number;
  y: number;
  length: number;
  thickness?: number;
  maxAngle?: number;
  restAngle?: number;
  damping?: number;
}

export interface ValveDef {
  id: string;
  x: number;
  y: number;
  length: number;
  thickness?: number;
  angleA: number;
  angleB: number;
  initialToggled?: boolean;
}

export interface HydroRelayDef {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius?: number;
  linkedGateId?: string;
  linkedPumpId?: string;
  isObjective?: boolean;
}

export interface GeyserPumpDef {
  id: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  force: number;
  range: number;
  radius: number;
  requiredTriggerIds: string[];
}

export interface LevelDef {
  id: string;
  index: number;
  isSandbox?: boolean;
  titleKey: string;
  subtitleKey: string;
  hintKey: string;
  parTime: number;
  maxFrostCells: number;
  maxTotalParticles: number;
  theme: LevelTheme;
  solids: TerrainShape[];
  carves?: TerrainShape[];
  spouts: WaterSpoutDef[];
  pools: InitialPoolDef[];
  drains: DrainZoneDef[];
  turbines: TurbineDef[];
  bodies: BuoyantBodyDef[];
  goals: RelicGoalDef[];
  cisterns: CisternSensorDef[];
  gates: SluiceGateDef[];
  crackedWalls: CrackedWallDef[];
  magmaVents: MagmaVentDef[];
  portals?: PortalPairDef[];
  mines?: HydroMineDef[];
  seesaws?: SeesawDef[];
  valves?: ValveDef[];
  relays?: HydroRelayDef[];
  pumps?: GeyserPumpDef[];
}

export interface TurbineState {
  id: string;
  x: number;
  y: number;
  radius: number;
  angle: number;
  angularVel: number;
  charge: number;
  targetCharge: number;
  decayRate: number;
  lockOnFull: boolean;
  completed: boolean;
  linkedGateId?: string;
}

export interface BuoyantBodyState {
  id: string;
  kind: 'ark' | 'sphere';
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  w: number;
  h: number;
  density: number;
  submergedRatio: number;
  inGoal: boolean;
  portalCooldown?: number;
}

export interface RelicGoalState {
  id: string;
  bodyId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fulfilled: boolean;
  pulse: number;
}

export interface CisternState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  thresholdParticles: number;
  particleCount: number;
  fillRatio: number;
  activated: boolean;
  linkedGateId?: string;
}

export interface SluiceGateState {
  id: string;
  baseX: number;
  baseY: number;
  w: number;
  h: number;
  x: number;
  y: number;
  openOffsetX: number;
  openOffsetY: number;
  openProgress: number;
  requiredTriggerIds: string[];
  speed: number;
  isOpen: boolean;
}

export interface CrackedWallState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  impactThreshold: number;
  stressGlow: number;
  broken: boolean;
}

export interface MagmaVentState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  heat: number;
  maxHeat: number;
  reheatRate: number;
  quenched: boolean;
  goalQuench: boolean;
  steamPulse: number;
}

export interface SpoutState {
  id: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  rate: number;
  radius: number;
  maxParticles: number;
  emitted: number;
  enabled: boolean;
  accumulator: number;
}

export interface DebrisChunk {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  size: number;
  life: number;
  maxLife: number;
  kind: 'rock' | 'ice' | 'ember';
}

export interface PortalPairState {
  id: string;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
  outDirX: number;
  outDirY: number;
  radius: number;
  boost: number;
  pulse: number;
}

export interface HydroMineState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  radius: number;
  density: number;
  spawnX: number;
  spawnY: number;
  detonated: boolean;
  respawnTimer: number;
  submergedRatio: number;
  portalCooldown: number;
  flash: number;
}

export interface SeesawState {
  id: string;
  x: number;
  y: number;
  length: number;
  thickness: number;
  angle: number;
  angularVel: number;
  maxAngle: number;
  restAngle: number;
  damping: number;
}

export interface ValveState {
  id: string;
  x: number;
  y: number;
  length: number;
  thickness: number;
  angleA: number;
  angleB: number;
  angle: number;
  toggled: boolean;
}

export interface HydroRelayState {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  charge: number;
  active: boolean;
  linkedGateId?: string;
  linkedPumpId?: string;
  isObjective: boolean;
  bridgePath: Array<[number, number]>;
}

export interface GeyserPumpState {
  id: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  force: number;
  range: number;
  radius: number;
  requiredTriggerIds: string[];
  active: boolean;
  power: number;
}

export interface MechanismSnapshot {
  turbines: TurbineState[];
  bodies: BuoyantBodyState[];
  goals: RelicGoalState[];
  cisterns: CisternState[];
  gates: SluiceGateState[];
  crackedWalls: CrackedWallState[];
  magmaVents: MagmaVentState[];
  spouts: SpoutState[];
  drains: DrainZoneDef[];
  debris: DebrisChunk[];
  portals: PortalPairState[];
  mines: HydroMineState[];
  seesaws: SeesawState[];
  valves: ValveState[];
  relays: HydroRelayState[];
  pumps: GeyserPumpState[];
}

export interface ToolForceInput {
  tool: ToolId;
  active: boolean;
  secondary: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  chargePos?: { x: number; y: number };
  chargeTime: number;
  releaseBurst?: {
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    strength: number;
  };
}

export interface FluidTelemetry {
  particleCount: number;
  avgSpeed: number;
  kineticEnergy: number;
  splashIntensity: number;
  iceFreezeCount: number;
  iceShatterCount: number;
  wallBreakCount: number;
  magmaSteamIntensity: number;
  magmaQuenchCount: number;
  maxTurbineRpm: number;
  maxTurbineCharge: number;
  turbineCompletePulseCount: number;
  mineDetonateCount: number;
  valveToggleCount: number;
  portalPulseCount: number;
  relayActiveIntensity: number;
}

export interface ObjectiveStatus {
  labelKey: string;
  progress: number;
  done: boolean;
  detail?: string;
}

export interface LevelProgress {
  stars: number;
  bestTime: number | null;
  unlocked: boolean;
}

export interface GameStateSnapshot {
  screen: ScreenMode;
  levelId: string;
  levelIndex: number;
  isSandbox: boolean;
  titleKey: string;
  subtitleKey: string;
  hintKey: string;
  elapsed: number;
  parTime: number;
  frostUsed: number;
  frostMax: number;
  activeTool: ToolId;
  slowMo: boolean;
  muted: boolean;
  quality: QualityLevel;
  lang: Lang;
  fps: number;
  waterCount: number;
  objectives: ObjectiveStatus[];
  starsEarned: number;
  levelProgress: Record<string, LevelProgress>;
  spoutsActive: boolean;
}

export interface ITerrainGrid {
  readonly solidKind: Uint8Array;
  readonly staticRock: Uint8Array;
  readonly iceMask: Uint8Array;
  readonly obsidianMask: Uint8Array;
  readonly dynamicMask: Uint8Array;
  readonly sdf: Float32Array;
  readonly sdfNormX: Float32Array;
  readonly sdfNormY: Float32Array;
  readonly frostCount: number;
  readonly version: number;
  dirty: boolean;

  loadLevel(solids: TerrainShape[], carves?: TerrainShape[], drains?: DrainZoneDef[]): void;
  clearDynamicSolids(): void;
  stampDynamicRect(x: number, y: number, w: number, h: number, kind: SolidKind): void;
  addObsidianRect(x: number, y: number, w: number, h: number): void;
  paintIce(wx: number, wy: number, radius: number, maxFrostCells: number): { added: number; displacedCells: number[] };
  eraseIce(wx: number, wy: number, radius: number): number;
  shatterAllIce(): Array<{ x: number; y: number }>;
  paintRock(wx: number, wy: number, radius: number, erase: boolean): void;
  rebuildSDFIfDirty(): boolean;
  isSolidCell(i: number, j: number): boolean;
  getKindAtCell(i: number, j: number): SolidKind;
  sampleSDF(wx: number, wy: number): { dist: number; nx: number; ny: number };
}

export interface IFluidEngine {
  numParticles: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly foam: Float32Array;
  readonly temp: Float32Array;

  numSpray: number;
  readonly spx: Float32Array;
  readonly spy: Float32Array;
  readonly svx: Float32Array;
  readonly svy: Float32Array;
  readonly slife: Float32Array;
  readonly smaxLife: Float32Array;

  numSteam: number;
  readonly stx: Float32Array;
  readonly sty: Float32Array;
  readonly stvx: Float32Array;
  readonly stvy: Float32Array;
  readonly stlife: Float32Array;
  readonly stmaxLife: Float32Array;

  readonly u: Float32Array;
  readonly v: Float32Array;
  readonly pressure: Float32Array;
  readonly cellType: Uint8Array;
  readonly telemetry: FluidTelemetry;
  readonly particleVBOData: Float32Array;

  reset(): void;
  spawnPool(x: number, y: number, w: number, h: number, maxCap: number, fillFactor?: number): number;
  spawnJet(x: number, y: number, dirX: number, dirY: number, speed: number, count: number, radius: number, maxCap?: number): number;
  spawnSpray(x: number, y: number, vx: number, vy: number, life: number): void;
  spawnSteam(x: number, y: number, vx: number, vy: number, life: number): void;
  removeParticle(index: number): void;
  triggerTsunami(maxCap: number): void;
  queryPressureRect(x: number, y: number, w: number, h: number): number;
  countParticlesInRect(x: number, y: number, w: number, h: number): number;
  step(
    dt: number,
    terrain: ITerrainGrid,
    toolInput: ToolForceInput | null,
    mechanisms: IMechanismSystem,
    quality: QualityLevel,
    maxTotalParticles: number
  ): void;
}

export interface IMechanismSystem {
  readonly turbines: TurbineState[];
  readonly bodies: BuoyantBodyState[];
  readonly goals: RelicGoalState[];
  readonly cisterns: CisternState[];
  readonly gates: SluiceGateState[];
  readonly crackedWalls: CrackedWallState[];
  readonly magmaVents: MagmaVentState[];
  readonly spouts: SpoutState[];
  readonly drains: DrainZoneDef[];
  readonly debris: DebrisChunk[];
  readonly portals: PortalPairState[];
  readonly mines: HydroMineState[];
  readonly seesaws: SeesawState[];
  readonly valves: ValveState[];
  readonly relays: HydroRelayState[];
  readonly pumps: GeyserPumpState[];

  loadLevel(level: LevelDef, terrain: ITerrainGrid): void;
  preStep(terrain: ITerrainGrid, dt: number): void;
  coupleParticles(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number): void;
  postStep(fluid: IFluidEngine, terrain: ITerrainGrid, dt: number, maxTotalParticles: number): void;
  spawnIceShards(cells: Array<{ x: number; y: number }>): void;
  toggleValveAt(wx: number, wy: number): boolean;
  isHoveringValve(wx: number, wy: number): boolean;
  isLevelComplete(): boolean;
  getObjectives(): ObjectiveStatus[];
  getSnapshot(): MechanismSnapshot;
  toggleSpouts(enabled?: boolean): void;
  addSandboxTurbine(x: number, y: number): void;
  addSandboxBody(x: number, y: number, kind: 'ark' | 'sphere'): void;
  addSandboxMagma(x: number, y: number): void;
  addSandboxCrackedWall(x: number, y: number): void;
  addSandboxMine(x: number, y: number): void;
  addSandboxSeesaw(x: number, y: number): void;
}
