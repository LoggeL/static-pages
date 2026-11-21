import type { DrainZoneDef, LevelDef, LevelTheme, TerrainShape } from '../types.ts';

const BASE_WALLS: TerrainShape[] = [
  { kind: 'rect', x: 0, y: 0, w: 0.5, h: 9.0 },
  { kind: 'rect', x: 15.5, y: 0, w: 0.5, h: 9.0 },
  { kind: 'rect', x: 0, y: 8.5, w: 16.0, h: 0.5 },
];

/**
 * Builds the outer stone frame while splitting the bottom floor around any
 * floor-level drains (y <= 0.5) so no solid overlaps a drain zone.
 */
function buildFrame(shapes: TerrainShape[], drains: DrainZoneDef[]): TerrainShape[] {
  const bottomCutouts = drains
    .filter((d) => d.y < 0.5 && d.y + d.h > 0)
    .map((d) => ({ x0: Math.max(0.5, d.x), x1: Math.min(15.5, d.x + d.w) }))
    .filter((c) => c.x1 > c.x0)
    .sort((a, b) => a.x0 - b.x0);

  const floorSegments: TerrainShape[] = [
    { kind: 'rect', x: 0, y: 0, w: 0.5, h: 0.5 },
    { kind: 'rect', x: 15.5, y: 0, w: 0.5, h: 0.5 },
  ];

  let cursor = 0.5;
  for (const cut of bottomCutouts) {
    if (cut.x0 > cursor) {
      floorSegments.push({ kind: 'rect', x: cursor, y: 0, w: Number((cut.x0 - cursor).toFixed(4)), h: 0.5 });
    }
    cursor = Math.max(cursor, cut.x1);
  }
  if (cursor < 15.5) {
    floorSegments.push({ kind: 'rect', x: cursor, y: 0, w: Number((15.5 - cursor).toFixed(4)), h: 0.5 });
  }

  return [...BASE_WALLS, ...floorSegments, ...shapes];
}

function norm(x: number, y: number): [number, number] {
  const len = Math.sqrt(x * x + y * y) || 1;
  return [Number((x / len).toFixed(4)), Number((y / len).toFixed(4))];
}

function dirVec(x: number, y: number): { dirX: number; dirY: number } {
  const [dirX, dirY] = norm(x, y);
  return { dirX, dirY };
}

function outDirVec(x: number, y: number): { outDirX: number; outDirY: number } {
  const [outDirX, outDirY] = norm(x, y);
  return { outDirX, outDirY };
}

const THEMES: Record<string, LevelTheme> = {
  twilightTeal: {
    skyTop: [0.05, 0.11, 0.19],
    skyBottom: [0.12, 0.28, 0.35],
    rockTint: [0.25, 0.32, 0.35],
    waterDeep: [0.03, 0.23, 0.36],
    waterShallow: [0.18, 0.76, 0.82],
    lightDir: norm(0.52, 0.85),
    sunColor: [1.0, 0.86, 0.66],
    ambientLanterns: [
      { x: 1.8, y: 6.9, color: [0.32, 0.88, 0.94], radius: 3.2 },
      { x: 6.1, y: 4.8, color: [0.98, 0.74, 0.34], radius: 2.8 },
      { x: 9.8, y: 2.9, color: [1.0, 0.78, 0.38], radius: 3.0 },
      { x: 14.3, y: 1.4, color: [0.35, 0.90, 1.0], radius: 2.8 },
    ],
  },
  sunlitEmerald: {
    skyTop: [0.07, 0.19, 0.21],
    skyBottom: [0.24, 0.46, 0.39],
    rockTint: [0.31, 0.37, 0.31],
    waterDeep: [0.03, 0.26, 0.29],
    waterShallow: [0.22, 0.82, 0.72],
    lightDir: norm(0.60, 0.80),
    sunColor: [1.0, 0.92, 0.70],
    ambientLanterns: [
      { x: 1.9, y: 5.7, color: [1.0, 0.82, 0.40], radius: 2.8 },
      { x: 5.0, y: 2.8, color: [0.45, 0.95, 0.82], radius: 3.0 },
      { x: 11.6, y: 4.5, color: [1.0, 0.80, 0.38], radius: 3.2 },
    ],
  },
  canyonAmber: {
    skyTop: [0.15, 0.10, 0.19],
    skyBottom: [0.43, 0.25, 0.18],
    rockTint: [0.41, 0.31, 0.24],
    waterDeep: [0.04, 0.21, 0.42],
    waterShallow: [0.24, 0.70, 0.88],
    lightDir: norm(-0.48, 0.88),
    sunColor: [1.0, 0.78, 0.50],
    ambientLanterns: [
      { x: 4.8, y: 3.5, color: [0.38, 0.84, 1.0], radius: 3.0 },
      { x: 9.2, y: 2.6, color: [0.32, 0.78, 0.96], radius: 3.0 },
      { x: 14.0, y: 3.8, color: [1.0, 0.82, 0.42], radius: 3.1 },
    ],
  },
  stormBasalt: {
    skyTop: [0.07, 0.09, 0.15],
    skyBottom: [0.19, 0.27, 0.34],
    rockTint: [0.25, 0.28, 0.32],
    waterDeep: [0.04, 0.20, 0.39],
    waterShallow: [0.28, 0.76, 0.94],
    lightDir: norm(0.45, 0.89),
    sunColor: [0.84, 0.92, 1.0],
    ambientLanterns: [
      { x: 4.5, y: 5.2, color: [1.0, 0.58, 0.24], radius: 2.8 },
      { x: 9.4, y: 2.1, color: [0.35, 0.85, 0.95], radius: 2.9 },
      { x: 13.3, y: 2.2, color: [1.0, 0.76, 0.38], radius: 3.0 },
    ],
  },
  deepSapphire: {
    skyTop: [0.03, 0.06, 0.16],
    skyBottom: [0.09, 0.19, 0.38],
    rockTint: [0.26, 0.30, 0.41],
    waterDeep: [0.02, 0.15, 0.45],
    waterShallow: [0.22, 0.74, 0.99],
    lightDir: norm(0.0, 1.0),
    sunColor: [0.72, 0.86, 1.0],
    ambientLanterns: [
      { x: 4.5, y: 5.3, color: [0.38, 0.88, 1.0], radius: 3.0 },
      { x: 10.4, y: 1.5, color: [1.0, 0.72, 0.28], radius: 3.2 },
      { x: 8.0, y: 7.4, color: [0.32, 0.92, 1.0], radius: 3.2 },
      { x: 11.5, y: 5.3, color: [0.38, 0.88, 1.0], radius: 3.0 },
    ],
  },
  volcanicObsidian: {
    skyTop: [0.11, 0.05, 0.06],
    skyBottom: [0.29, 0.11, 0.08],
    rockTint: [0.22, 0.20, 0.23],
    waterDeep: [0.04, 0.22, 0.31],
    waterShallow: [0.24, 0.76, 0.80],
    lightDir: norm(-0.40, 0.92),
    sunColor: [1.0, 0.68, 0.44],
    ambientLanterns: [
      { x: 7.7, y: 1.4, color: [1.0, 0.42, 0.14], radius: 3.0 },
      { x: 13.0, y: 1.5, color: [1.0, 0.46, 0.16], radius: 3.1 },
      { x: 13.2, y: 7.1, color: [0.40, 0.92, 0.96], radius: 2.8 },
    ],
  },
  templeGold: {
    skyTop: [0.10, 0.09, 0.20],
    skyBottom: [0.30, 0.23, 0.27],
    rockTint: [0.38, 0.34, 0.27],
    waterDeep: [0.04, 0.25, 0.36],
    waterShallow: [0.25, 0.80, 0.82],
    lightDir: norm(0.25, 0.97),
    sunColor: [1.0, 0.88, 0.58],
    ambientLanterns: [
      { x: 4.0, y: 3.2, color: [0.36, 0.88, 1.0], radius: 2.8 },
      { x: 7.4, y: 2.4, color: [0.35, 0.95, 0.88], radius: 3.0 },
      { x: 9.5, y: 5.3, color: [1.0, 0.78, 0.34], radius: 3.0 },
      { x: 13.8, y: 2.0, color: [1.0, 0.84, 0.42], radius: 3.0 },
    ],
  },
  royalCrown: {
    skyTop: [0.08, 0.05, 0.17],
    skyBottom: [0.24, 0.16, 0.33],
    rockTint: [0.29, 0.27, 0.37],
    waterDeep: [0.04, 0.20, 0.46],
    waterShallow: [0.28, 0.84, 0.97],
    lightDir: norm(0.42, 0.91),
    sunColor: [1.0, 0.86, 0.56],
    ambientLanterns: [
      { x: 4.4, y: 4.5, color: [1.0, 0.80, 0.34], radius: 3.0 },
      { x: 8.6, y: 6.1, color: [0.36, 0.92, 1.0], radius: 2.8 },
      { x: 11.7, y: 4.2, color: [1.0, 0.46, 0.18], radius: 2.7 },
      { x: 14.2, y: 6.4, color: [1.0, 0.84, 0.42], radius: 3.2 },
    ],
  },
  labCyan: {
    skyTop: [0.05, 0.12, 0.20],
    skyBottom: [0.13, 0.29, 0.41],
    rockTint: [0.28, 0.34, 0.41],
    waterDeep: [0.03, 0.26, 0.45],
    waterShallow: [0.24, 0.86, 0.96],
    lightDir: norm(-0.35, 0.94),
    sunColor: [0.92, 0.97, 1.0],
    ambientLanterns: [
      { x: 8.0, y: 6.8, color: [0.32, 0.92, 1.0], radius: 3.4 },
      { x: 4.6, y: 2.2, color: [0.36, 0.88, 0.86], radius: 3.0 },
      { x: 12.6, y: 5.1, color: [1.0, 0.78, 0.38], radius: 3.0 },
    ],
  },
};

const DEMO_DRAINS: DrainZoneDef[] = [{ x: 13.8, y: 0.0, w: 1.7, h: 0.68 }];

export const TITLE_DEMO_LEVEL: LevelDef = {
  id: 'demo',
  index: 0,
  titleKey: 'lvl.demo.title',
  subtitleKey: 'lvl.demo.sub',
  hintKey: 'lvl.demo.hint',
  parTime: 60,
  maxFrostCells: 800,
  maxTotalParticles: 3800,
  theme: THEMES.twilightTeal,
  solids: buildFrame(
    [
      // Upper temple overhang & left supporting ruins
      { kind: 'rect', x: 0.5, y: 7.9, w: 1.9, h: 0.6 },
      { kind: 'rect', x: 0.5, y: 0.5, w: 2.0, h: 4.8 },
      { kind: 'rect', x: 2.5, y: 0.5, w: 3.2, h: 0.6 },
      // Carved Terrace 1 feeding the gentle playful seesaw
      {
        kind: 'poly',
        points: [
          [0.5, 5.3],
          [4.4, 5.3],
          [4.4, 5.75],
          [0.5, 6.1],
        ],
      },
      // Carved Terrace 2 catching seesaw spill into Brass Turbine
      {
        kind: 'poly',
        points: [
          [5.4, 3.25],
          [8.6, 3.25],
          [8.6, 3.65],
          [5.4, 3.9],
        ],
      },
      // Decorative grotto column & weir retaining serene Ark pool
      { kind: 'circle', x: 3.3, y: 2.8, r: 0.45 },
      { kind: 'rect', x: 13.0, y: 0.5, w: 0.5, h: 1.5 },
    ],
    DEMO_DRAINS
  ),
  spouts: [
    {
      id: 'spout-demo',
      x: 1.4,
      y: 7.4,
      ...dirVec(0.92, -0.39),
      speed: 3.8,
      rate: 250,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 5.9, y: 0.55, w: 6.9, h: 1.35, fillFactor: 0.86 }],
  drains: DEMO_DRAINS,
  turbines: [
    {
      id: 'turbine-demo',
      x: 9.7,
      y: 2.9,
      radius: 0.82,
      targetCharge: 1.0,
      decayRate: 0.02,
      lockOnFull: false,
    },
  ],
  bodies: [
    {
      id: 'ark-demo',
      kind: 'ark',
      x: 11.2,
      y: 1.75,
      w: 1.05,
      h: 0.52,
      density: 0.52,
    },
  ],
  goals: [],
  cisterns: [],
  gates: [],
  crackedWalls: [],
  magmaVents: [],
  seesaws: [
    {
      id: 'seesaw-demo',
      x: 6.0,
      y: 4.75,
      length: 2.3,
      thickness: 0.16,
      maxAngle: 0.34,
      restAngle: 0.10,
      damping: 1.8,
    },
  ],
  portals: [
    {
      id: 'portal-demo',
      inX: 14.4,
      inY: 1.45,
      outX: 2.9,
      outY: 7.3,
      ...outDirVec(0.86, -0.51),
      radius: 0.52,
      boost: 1.35,
    },
  ],
};

const L1_DRAINS: DrainZoneDef[] = [
  { x: 0.5, y: 0.0, w: 1.6, h: 0.68 },
  { x: 14.0, y: 0.0, w: 1.5, h: 0.68 },
];

const LEVEL_1: LevelDef = {
  id: 'level-1',
  index: 1,
  titleKey: 'lvl.1.title',
  subtitleKey: 'lvl.1.sub',
  hintKey: 'lvl.1.hint',
  parTime: 25,
  maxFrostCells: 450,
  maxTotalParticles: 3600,
  theme: THEMES.sunlitEmerald,
  solids: buildFrame(
    [
      // Left wall separating bypass chute (x < 2.4) from central stone basin
      { kind: 'rect', x: 2.4, y: 0.5, w: 0.45, h: 3.6 },
      // Central dividing ridge (y = 4.5 keeps unassisted water safely inside basin)
      { kind: 'rect', x: 7.3, y: 0.5, w: 0.65, h: 4.0 },
      // Elevated catch-shelf supporting the Brass Turbine
      { kind: 'rect', x: 9.2, y: 3.2, w: 4.8, h: 0.4 },
      // Sloped lower floor guiding splashes to right recycle drain
      {
        kind: 'poly',
        points: [
          [7.95, 0.5],
          [14.0, 0.5],
          [7.95, 0.85],
        ],
      },
    ],
    L1_DRAINS
  ),
  spouts: [
    {
      id: 'spout-1',
      x: 1.5,
      y: 7.4,
      ...dirVec(0.32, -0.947),
      speed: 3.3,
      rate: 260,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 2.95, y: 0.55, w: 4.25, h: 1.75, fillFactor: 0.88 }],
  drains: L1_DRAINS,
  turbines: [
    {
      id: 'turbine-1',
      x: 11.6,
      y: 4.5,
      radius: 0.85,
      targetCharge: 1.0,
      decayRate: 0.04,
      lockOnFull: true,
    },
  ],
  bodies: [],
  goals: [],
  cisterns: [],
  gates: [],
  crackedWalls: [],
  magmaVents: [],
  valves: [
    {
      id: 'valve-1',
      x: 1.9,
      y: 5.7,
      length: 1.7,
      thickness: 0.18,
      angleA: 0.62,
      angleB: -0.52,
      initialToggled: false,
    },
  ],
};

const L2_DRAINS: DrainZoneDef[] = [
  { x: 0.5, y: 0.0, w: 1.6, h: 0.68 },
  { x: 14.95, y: 0.0, w: 0.55, h: 2.75 },
];

const LEVEL_2: LevelDef = {
  id: 'level-2',
  index: 2,
  titleKey: 'lvl.2.title',
  subtitleKey: 'lvl.2.sub',
  hintKey: 'lvl.2.hint',
  parTime: 35,
  maxFrostCells: 550,
  maxTotalParticles: 3800,
  theme: THEMES.canyonAmber,
  solids: buildFrame(
    [
      // Left bypass separator wall + ceiling baffle framing valve-2 window (y: 4.8..6.25)
      { kind: 'rect', x: 2.25, y: 0.5, w: 0.6, h: 4.3 },
      { kind: 'rect', x: 2.25, y: 6.25, w: 0.6, h: 2.25 },
      // Sunken Hydro-Relay basin floor (y = 3.0) & right weir lip (y = 3.9)
      { kind: 'rect', x: 2.85, y: 0.5, w: 4.0, h: 2.5 },
      { kind: 'rect', x: 6.85, y: 0.5, w: 0.5, h: 3.4 },
      // Ark lock floor & smooth ramp up to Sluice Gate sill (y = 2.5)
      { kind: 'rect', x: 7.35, y: 0.5, w: 3.85, h: 1.1 },
      {
        kind: 'poly',
        points: [
          [10.2, 1.6],
          [11.2, 1.6],
          [11.2, 2.5],
        ],
      },
      // Sanctuary floor (y = 2.5) with low weir retaining shallow Ark float before right drain
      { kind: 'rect', x: 11.2, y: 0.5, w: 3.75, h: 2.0 },
      { kind: 'rect', x: 14.65, y: 2.5, w: 0.3, h: 0.25 },
      // Lintel housing above 2.6m tall Sluice Gate (y: 2.5..5.1)
      { kind: 'rect', x: 11.4, y: 5.1, w: 0.45, h: 3.4 },
    ],
    L2_DRAINS
  ),
  spouts: [
    {
      id: 'spout-2',
      x: 1.32,
      y: 7.5,
      ...dirVec(-0.06, -0.998),
      speed: 3.1,
      rate: 280,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 7.45, y: 1.65, w: 2.65, h: 1.0, fillFactor: 0.88 }],
  drains: L2_DRAINS,
  turbines: [],
  bodies: [
    {
      id: 'ark-1',
      kind: 'ark',
      x: 9.2,
      y: 2.3,
      w: 1.05,
      h: 0.52,
      density: 0.52,
    },
  ],
  goals: [
    {
      id: 'altar-2',
      bodyId: 'ark-1',
      x: 13.0,
      y: 2.55,
      w: 2.0,
      h: 2.5,
    },
  ],
  cisterns: [],
  gates: [
    {
      id: 'gate-1',
      x: 11.4,
      y: 2.5,
      w: 0.45,
      h: 2.6,
      openOffsetX: 0,
      openOffsetY: 2.6,
      requiredTriggerIds: ['relay-1'],
      speed: 1.6,
    },
  ],
  crackedWalls: [],
  magmaVents: [],
  valves: [
    {
      id: 'valve-2',
      x: 1.62,
      y: 5.75,
      length: 1.5,
      thickness: 0.18,
      angleA: 0.72,
      angleB: -0.52,
      initialToggled: false,
    },
  ],
  relays: [
    {
      id: 'relay-1',
      ax: 3.4,
      ay: 3.35,
      bx: 6.2,
      by: 3.35,
      radius: 0.48,
      linkedGateId: 'gate-1',
      isObjective: true,
    },
  ],
};

const L3_DRAINS: DrainZoneDef[] = [
  { x: 0.5, y: 0.0, w: 1.5, h: 0.68 },
  { x: 14.15, y: 0.0, w: 1.35, h: 0.68 },
];

const LEVEL_3: LevelDef = {
  id: 'level-3',
  index: 3,
  titleKey: 'lvl.3.title',
  subtitleKey: 'lvl.3.sub',
  hintKey: 'lvl.3.hint',
  parTime: 40,
  maxFrostCells: 550,
  maxTotalParticles: 3800,
  theme: THEMES.stormBasalt,
  solids: buildFrame(
    [
      // Left barrier separating bypass drain chute (x < 2.1) from canyon torrent chute
      { kind: 'rect', x: 2.1, y: 0.5, w: 0.4, h: 4.5 },
      // Sloped upper canyon chute underneath seesaw-1 leading into Wall 1 (y = 3.0)
      {
        kind: 'poly',
        points: [
          [2.5, 0.5],
          [7.4, 0.5],
          [7.4, 3.0],
          [2.5, 3.8],
        ],
      },
      // Floating bracket keeping mine-1 safely seated on right seesaw arm at rest (1.15m clear above chute!)
      { kind: 'rect', x: 6.1, y: 4.55, w: 0.4, h: 0.65 },
      // Upper canyon arch above Cracked Wall 1
      { kind: 'rect', x: 7.35, y: 5.6, w: 0.55, h: 2.9 },
      // Stepped drop beyond Wall 1 feeding Turbine 1
      {
        kind: 'poly',
        points: [
          [7.85, 0.5],
          [8.55, 0.5],
          [8.55, 2.7],
          [7.85, 3.0],
        ],
      },
      // Canyon arch above Cracked Wall 2
      { kind: 'rect', x: 10.65, y: 3.6, w: 0.55, h: 4.9 },
      // Catch-ramp feeding Turbine 2 into right recycle drain
      {
        kind: 'poly',
        points: [
          [11.2, 0.5],
          [14.1, 0.5],
          [14.1, 1.32],
          [12.3, 1.32],
        ],
      },
    ],
    L3_DRAINS
  ),
  spouts: [
    {
      id: 'spout-3',
      x: 1.4,
      y: 7.8,
      ...dirVec(0.32, -0.947),
      speed: 3.3,
      rate: 310,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [],
  drains: L3_DRAINS,
  turbines: [
    {
      id: 'turbine-1',
      x: 9.4,
      y: 2.1,
      radius: 0.78,
      targetCharge: 1.0,
      decayRate: 0.025,
      lockOnFull: true,
    },
    {
      id: 'turbine-2',
      x: 13.3,
      y: 2.2,
      radius: 0.82,
      targetCharge: 1.0,
      decayRate: 0.025,
      lockOnFull: true,
    },
  ],
  bodies: [],
  goals: [],
  cisterns: [],
  gates: [],
  crackedWalls: [
    {
      id: 'wall-1',
      x: 7.4,
      y: 3.0,
      w: 0.45,
      h: 2.6,
      maxHp: 12,
      impactThreshold: 2.5,
    },
    {
      id: 'wall-2',
      x: 10.7,
      y: 0.5,
      w: 0.45,
      h: 3.1,
      maxHp: 14,
      impactThreshold: 2.7,
    },
  ],
  magmaVents: [],
  valves: [
    {
      id: 'valve-3',
      x: 1.85,
      y: 6.8,
      length: 1.6,
      thickness: 0.18,
      angleA: 0.62,
      angleB: -0.52,
      initialToggled: false,
    },
  ],
  seesaws: [
    {
      id: 'seesaw-1',
      x: 4.5,
      y: 4.9,
      length: 3.0,
      thickness: 0.18,
      maxAngle: 0.45,
      restAngle: -0.22,
      damping: 1.4,
    },
  ],
  mines: [
    {
      id: 'mine-1',
      x: 5.4,
      y: 5.08,
      radius: 0.27,
      density: 0.48,
    },
  ],
};

const L4_DRAINS: DrainZoneDef[] = [
  { x: 0.5, y: 0.0, w: 1.0, h: 0.68 },
  { x: 14.1, y: 0.0, w: 1.4, h: 0.68 },
];

const LEVEL_4: LevelDef = {
  id: 'level-4',
  index: 4,
  titleKey: 'lvl.4.title',
  subtitleKey: 'lvl.4.sub',
  hintKey: 'lvl.4.hint',
  parTime: 40,
  maxFrostCells: 500,
  maxTotalParticles: 3800,
  theme: THEMES.deepSapphire,
  solids: buildFrame(
    [
      // Left low weir (y = 2.0) draining unassisted sapphire fountain safely into left drain
      { kind: 'rect', x: 1.5, y: 0.5, w: 0.5, h: 1.5 },
      // Central divider ridge (y = 3.35, well above equilibrium pool so 0 input never reaches Amber Portal)
      { kind: 'rect', x: 7.4, y: 0.5, w: 0.6, h: 2.85 },
      // Funnel cradle guiding tossed water straight into the Amber Portal pocket
      {
        kind: 'poly',
        points: [
          [8.0, 0.5],
          [10.2, 0.5],
          [8.0, 1.9],
        ],
      },
      {
        kind: 'poly',
        points: [
          [10.8, 0.5],
          [13.6, 0.5],
          [13.6, 1.9],
        ],
      },
      // Left elevated catch-terrace sloping outward-left across Turbine L into left pool
      {
        kind: 'poly',
        points: [
          [2.7, 3.94],
          [6.3, 4.24],
          [6.3, 4.59],
          [2.7, 4.29],
        ],
      },
      // Right elevated catch-terrace sloping outward-right across Turbine R into portal/drain
      {
        kind: 'poly',
        points: [
          [9.7, 4.24],
          [13.3, 3.94],
          [13.3, 4.29],
          [9.7, 4.59],
        ],
      },
    ],
    L4_DRAINS
  ),
  spouts: [
    {
      id: 'spout-4',
      x: 3.2,
      y: 3.55,
      ...dirVec(0.25, -0.968),
      speed: 2.8,
      rate: 220,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 2.1, y: 0.55, w: 5.2, h: 1.7, fillFactor: 0.88 }],
  drains: L4_DRAINS,
  turbines: [
    {
      id: 'turbine-l',
      x: 4.5,
      y: 5.3,
      radius: 0.82,
      targetCharge: 1.0,
      decayRate: 0.03,
      lockOnFull: true,
    },
    {
      id: 'turbine-r',
      x: 11.5,
      y: 5.3,
      radius: 0.82,
      targetCharge: 1.0,
      decayRate: 0.03,
      lockOnFull: true,
    },
  ],
  bodies: [],
  goals: [],
  cisterns: [],
  gates: [],
  crackedWalls: [],
  magmaVents: [],
  portals: [
    {
      id: 'portal-1',
      inX: 10.5,
      inY: 1.2,
      outX: 8.0,
      outY: 7.75,
      ...outDirVec(0, -1),
      radius: 0.62,
      boost: 1.55,
    },
  ],
  valves: [
    {
      id: 'valve-4',
      x: 8.0,
      y: 6.45,
      length: 1.9,
      thickness: 0.18,
      angleA: 0.55,
      angleB: -0.55,
      initialToggled: false,
    },
  ],
};

const L5_DRAINS: DrainZoneDef[] = [
  { x: 0.5, y: 0.0, w: 1.4, h: 0.68 },
  // Right wall overflow slot keeping geyser shaft water shallow so magma boils forever into steam
  { x: 14.4, y: 1.55, w: 1.1, h: 0.5 },
];

const LEVEL_5: LevelDef = {
  id: 'level-5',
  index: 5,
  titleKey: 'lvl.5.title',
  subtitleKey: 'lvl.5.sub',
  hintKey: 'lvl.5.hint',
  parTime: 45,
  maxFrostCells: 550,
  maxTotalParticles: 3800,
  theme: THEMES.volcanicObsidian,
  solids: buildFrame(
    [
      // Left barrier separating abyss drain (x < 2.05) from Relic Sphere pool
      { kind: 'rect', x: 2.05, y: 0.5, w: 0.45, h: 4.0 },
      // Weir retaining initial pool below y = 2.45 + smooth chute onto Magma Vent 1
      { kind: 'rect', x: 5.6, y: 0.5, w: 0.35, h: 1.95 },
      {
        kind: 'poly',
        points: [
          [5.95, 0.5],
          [6.0, 0.5],
          [6.0, 1.05],
          [5.95, 2.45],
        ],
      },
      // Stone bridge sill connecting quenched Obsidian Bridge to 2.8m wide Geyser Shaft
      { kind: 'rect', x: 9.4, y: 0.5, w: 2.2, h: 0.55 },
      // Left chimney wall of vertical geyser shaft (2.05m doorway below at y: 1.05..3.1)
      { kind: 'rect', x: 11.1, y: 3.1, w: 0.5, h: 5.4 },
      // Right chimney wall enclosing 2.8m wide shaft, leaving open drain slot at y: 1.55..2.05
      { kind: 'rect', x: 14.4, y: 0.5, w: 1.1, h: 1.05 },
      { kind: 'rect', x: 14.4, y: 2.05, w: 1.1, h: 6.45 },
    ],
    L5_DRAINS
  ),
  spouts: [
    {
      id: 'spout-5',
      x: 1.3,
      y: 7.6,
      ...dirVec(0.32, -0.947),
      speed: 3.2,
      rate: 260,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 2.55, y: 0.55, w: 3.0, h: 1.75, fillFactor: 0.88 }],
  drains: L5_DRAINS,
  turbines: [],
  bodies: [
    {
      id: 'sphere-1',
      kind: 'sphere',
      x: 4.1,
      y: 2.1,
      w: 0.68,
      h: 0.68,
      density: 0.50,
    },
  ],
  goals: [
    {
      id: 'altar-5',
      bodyId: 'sphere-1',
      x: 12.0,
      y: 6.4,
      w: 2.4,
      h: 1.6,
    },
  ],
  cisterns: [],
  gates: [],
  crackedWalls: [],
  magmaVents: [
    {
      id: 'magma-bridge',
      x: 6.0,
      y: 0.5,
      w: 3.4,
      h: 0.55,
      maxHeat: 16,
      reheatRate: 2.0,
      goalQuench: true,
    },
    {
      id: 'magma-geyser',
      x: 11.6,
      y: 0.5,
      w: 2.8,
      h: 0.55,
      maxHeat: 280,
      reheatRate: 28.0,
      goalQuench: false,
    },
  ],
  valves: [
    {
      id: 'valve-5',
      x: 1.75,
      y: 6.0,
      length: 1.6,
      thickness: 0.18,
      angleA: 0.62,
      angleB: -0.52,
      initialToggled: false,
    },
  ],
};

const L6_DRAINS: DrainZoneDef[] = [
  { x: 0.5, y: 0.0, w: 1.5, h: 0.68 },
  { x: 14.7, y: 0.0, w: 0.8, h: 1.05 },
];

const LEVEL_6: LevelDef = {
  id: 'level-6',
  index: 6,
  titleKey: 'lvl.6.title',
  subtitleKey: 'lvl.6.sub',
  hintKey: 'lvl.6.hint',
  parTime: 45,
  maxFrostCells: 600,
  maxTotalParticles: 3800,
  theme: THEMES.templeGold,
  solids: buildFrame(
    [
      // Left bypass separator wall + ceiling baffle framing valve-6 window (y: 4.85..6.4)
      { kind: 'rect', x: 2.25, y: 0.5, w: 0.4, h: 4.35 },
      { kind: 'rect', x: 2.25, y: 6.4, w: 0.4, h: 2.1 },
      // Elevated Hydro-Relay conductive basin (y = 2.6, right lip y = 3.45)
      { kind: 'rect', x: 2.65, y: 0.5, w: 2.95, h: 2.1 },
      { kind: 'rect', x: 5.3, y: 2.6, w: 0.3, h: 0.85 },
      // Vault divider lintel between lower Sluice Gate (y: 0.5..3.1) & upper Cracked Wall (y: 4.0..6.5)
      { kind: 'rect', x: 11.65, y: 3.1, w: 0.55, h: 0.9 },
      { kind: 'rect', x: 11.65, y: 6.5, w: 0.55, h: 2.0 },
      // Upper vault balcony catching shattered wall rush and dropping overflow past Altar
      { kind: 'rect', x: 12.2, y: 3.5, w: 2.3, h: 0.5 },
      // Low right lip retaining Ark inside Sanctuary before far-right overflow drain
      { kind: 'rect', x: 14.4, y: 0.5, w: 0.3, h: 0.48 },
    ],
    L6_DRAINS
  ),
  spouts: [
    {
      id: 'spout-6',
      x: 1.32,
      y: 7.6,
      ...dirVec(-0.06, -0.998),
      speed: 3.1,
      rate: 300,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 5.7, y: 0.55, w: 5.8, h: 1.0, fillFactor: 0.85 }],
  drains: L6_DRAINS,
  turbines: [],
  bodies: [
    {
      id: 'ark-6',
      kind: 'ark',
      x: 9.8,
      y: 1.4,
      w: 1.05,
      h: 0.52,
      density: 0.52,
    },
  ],
  goals: [
    {
      id: 'altar-6',
      bodyId: 'ark-6',
      x: 12.6,
      y: 0.55,
      w: 1.85,
      h: 2.5,
    },
  ],
  cisterns: [],
  gates: [
    {
      id: 'gate-6',
      x: 11.7,
      y: 0.5,
      w: 0.45,
      h: 2.6,
      openOffsetX: 0,
      openOffsetY: 2.6,
      requiredTriggerIds: ['relay-6'],
      speed: 1.6,
    },
  ],
  crackedWalls: [
    {
      id: 'wall-6',
      x: 11.7,
      y: 4.0,
      w: 0.45,
      h: 2.5,
      maxHp: 12,
      impactThreshold: 2.5,
    },
  ],
  magmaVents: [],
  valves: [
    {
      id: 'valve-6',
      x: 1.62,
      y: 5.9,
      length: 1.5,
      thickness: 0.18,
      angleA: 0.72,
      angleB: -0.52,
      initialToggled: false,
    },
  ],
  relays: [
    {
      id: 'relay-6',
      ax: 3.1,
      ay: 2.95,
      bx: 4.9,
      by: 2.95,
      radius: 0.48,
      linkedGateId: 'gate-6',
      linkedPumpId: 'pump-6',
      isObjective: true,
    },
  ],
  pumps: [
    {
      id: 'pump-6',
      x: 7.4,
      y: 0.85,
      ...dirVec(0.25, 0.968),
      force: 38.0,
      range: 6.0,
      radius: 0.95,
      requiredTriggerIds: ['relay-6'],
    },
  ],
  seesaws: [
    {
      id: 'seesaw-6',
      x: 9.5,
      y: 5.1,
      length: 2.8,
      thickness: 0.18,
      maxAngle: 0.42,
      restAngle: -0.18,
      damping: 1.4,
    },
  ],
  mines: [
    {
      id: 'mine-6',
      x: 7.4,
      y: 1.55,
      radius: 0.28,
      density: 0.48,
    },
  ],
};

const L7_DRAINS: DrainZoneDef[] = [
  { x: 0.5, y: 0.0, w: 1.3, h: 0.68 },
  { x: 6.3, y: 0.0, w: 0.9, h: 0.68 },
  { x: 15.1, y: 2.4, w: 0.4, h: 0.65 },
];

const LEVEL_7: LevelDef = {
  id: 'level-7',
  index: 7,
  titleKey: 'lvl.7.title',
  subtitleKey: 'lvl.7.sub',
  hintKey: 'lvl.7.hint',
  parTime: 65,
  maxFrostCells: 750,
  maxTotalParticles: 3800,
  theme: THEMES.royalCrown,
  solids: buildFrame(
    [
      // Zone A: Left bypass separator wall & dual Grand Turbine shelves
      { kind: 'rect', x: 1.9, y: 0.5, w: 0.4, h: 4.7 },
      { kind: 'rect', x: 2.3, y: 3.0, w: 1.6, h: 0.35 },
      { kind: 'rect', x: 4.4, y: 3.0, w: 2.0, h: 0.35 },
      // Zone B: Portal feed ramp & low sill before mid overflow drain
      {
        kind: 'poly',
        points: [
          [2.3, 0.5],
          [5.0, 0.5],
          [2.3, 1.1],
        ],
      },
      { kind: 'rect', x: 6.0, y: 0.5, w: 0.3, h: 0.7 },
      // Citadel pier separating Zone B from lower-right Ark & Geyser Shaft
      { kind: 'rect', x: 7.2, y: 0.5, w: 0.45, h: 4.3 },
      // Zone C: Dam chute (y: 4.8 -> 4.2), Great Dam lintel, and Magma Seal deck
      {
        kind: 'poly',
        points: [
          [7.65, 3.7],
          [10.0, 3.7],
          [10.0, 4.2],
          [7.65, 4.8],
        ],
      },
      { kind: 'rect', x: 9.95, y: 6.4, w: 0.55, h: 2.1 },
      { kind: 'rect', x: 10.45, y: 3.55, w: 2.25, h: 0.15 },
      // Seesaw-7 right-arm resting bracket (leaves 1.0m clear above Dam chute!)
      { kind: 'rect', x: 9.95, y: 5.65, w: 0.28, h: 0.75 },
      // Low weir keeping Crown Ark pool calm & Relay-7 bone dry at t = 0
      { kind: 'rect', x: 11.8, y: 0.5, w: 0.35, h: 1.15 },
    ],
    L7_DRAINS
  ),
  spouts: [
    {
      id: 'spout-7',
      x: 1.35,
      y: 7.9,
      ...dirVec(0.30, -0.954),
      speed: 3.3,
      rate: 280,
      radius: 0.22,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 7.75, y: 0.55, w: 3.95, h: 0.95, fillFactor: 0.88 }],
  drains: L7_DRAINS,
  turbines: [
    {
      id: 'turbine-1',
      x: 3.15,
      y: 4.1,
      radius: 0.68,
      targetCharge: 1.0,
      decayRate: 0.025,
      lockOnFull: true,
      linkedGateId: 'gate-crown',
    },
    {
      id: 'turbine-2',
      x: 5.35,
      y: 4.1,
      radius: 0.68,
      targetCharge: 1.0,
      decayRate: 0.025,
      lockOnFull: true,
      linkedGateId: 'gate-crown',
    },
  ],
  bodies: [
    {
      id: 'ark-crown',
      kind: 'ark',
      x: 10.6,
      y: 1.3,
      w: 1.05,
      h: 0.52,
      density: 0.52,
    },
  ],
  goals: [
    {
      id: 'altar-crown',
      bodyId: 'ark-crown',
      x: 13.2,
      y: 5.4,
      w: 2.0,
      h: 2.3,
    },
  ],
  cisterns: [],
  gates: [
    {
      id: 'gate-crown',
      x: 12.9,
      y: 4.8,
      w: 2.6,
      h: 0.42,
      openOffsetX: -2.4,
      openOffsetY: 0,
      requiredTriggerIds: ['turbine-1', 'turbine-2', 'relay-7'],
      speed: 1.6,
    },
  ],
  crackedWalls: [
    {
      id: 'dam-great',
      x: 10.0,
      y: 4.2,
      w: 0.45,
      h: 2.2,
      maxHp: 14,
      impactThreshold: 2.5,
    },
  ],
  magmaVents: [
    {
      id: 'magma-seal',
      x: 10.45,
      y: 3.7,
      w: 2.25,
      h: 0.5,
      maxHeat: 14,
      reheatRate: 1.5,
      goalQuench: true,
    },
  ],
  valves: [
    {
      id: 'valve-7a',
      x: 1.8,
      y: 6.9,
      length: 1.5,
      thickness: 0.18,
      angleA: 0.62,
      angleB: -0.52,
      initialToggled: false,
    },
    {
      id: 'valve-7b',
      x: 3.8,
      y: 5.65,
      length: 1.8,
      thickness: 0.18,
      angleA: 0.48,
      angleB: -0.48,
      initialToggled: false,
    },
  ],
  portals: [
    {
      id: 'portal-7',
      inX: 5.4,
      inY: 1.2,
      outX: 7.6,
      outY: 7.7,
      ...outDirVec(0.28, -0.96),
      radius: 0.56,
      boost: 1.55,
    },
  ],
  seesaws: [
    {
      id: 'seesaw-7',
      x: 8.75,
      y: 6.1,
      length: 2.0,
      thickness: 0.16,
      maxAngle: 0.42,
      restAngle: -0.22,
      damping: 1.4,
    },
  ],
  mines: [
    {
      id: 'mine-7',
      x: 9.45,
      y: 6.3,
      radius: 0.27,
      density: 0.48,
    },
  ],
  relays: [
    {
      id: 'relay-7',
      ax: 13.0,
      ay: 0.85,
      bx: 14.9,
      by: 0.85,
      radius: 0.48,
      linkedGateId: 'gate-crown',
      linkedPumpId: 'pump-7',
      isObjective: true,
    },
  ],
  pumps: [
    {
      id: 'pump-7',
      x: 14.0,
      y: 0.85,
      ...dirVec(0, 1),
      force: 40.0,
      range: 7.0,
      radius: 1.25,
      requiredTriggerIds: ['relay-7'],
    },
  ],
};

export const CAMPAIGN_LEVELS: LevelDef[] = [
  LEVEL_1,
  LEVEL_2,
  LEVEL_3,
  LEVEL_4,
  LEVEL_5,
  LEVEL_6,
  LEVEL_7,
];

const SB_DRAINS: DrainZoneDef[] = [{ x: 13.8, y: 0.0, w: 1.7, h: 0.68 }];

export const SANDBOX_LEVEL: LevelDef = {
  id: 'sandbox',
  index: 8,
  isSandbox: true,
  titleKey: 'lvl.sb.title',
  subtitleKey: 'lvl.sb.sub',
  hintKey: 'lvl.sb.hint',
  parTime: 120,
  maxFrostCells: 1800,
  maxTotalParticles: 6500,
  theme: THEMES.labCyan,
  solids: buildFrame(
    [
      // Left balcony supporting Cracked Wall & playful Seesaw
      { kind: 'rect', x: 1.0, y: 3.8, w: 3.8, h: 0.4 },
      // Right balcony carrying Brass Turbine
      { kind: 'rect', x: 10.8, y: 3.8, w: 3.8, h: 0.4 },
      // Low sills dividing the lower pool, Magma Vent, and optional overflow drain
      { kind: 'rect', x: 8.8, y: 0.5, w: 0.8, h: 0.9 },
      { kind: 'rect', x: 13.0, y: 0.5, w: 0.6, h: 0.7 },
    ],
    SB_DRAINS
  ),
  spouts: [
    {
      id: 'spout-sb',
      x: 8.0,
      y: 7.8,
      ...dirVec(0, -1),
      speed: 3.4,
      rate: 300,
      radius: 0.24,
      maxParticles: 1000000,
      enabled: true,
    },
  ],
  pools: [{ x: 0.8, y: 0.55, w: 7.6, h: 1.65, fillFactor: 0.88 }],
  drains: SB_DRAINS,
  turbines: [
    {
      id: 'turbine-sb',
      x: 12.6,
      y: 5.1,
      radius: 0.85,
      targetCharge: 1.0,
      decayRate: 0.03,
      lockOnFull: false,
    },
  ],
  bodies: [
    {
      id: 'ark-sb',
      kind: 'ark',
      x: 4.6,
      y: 2.0,
      w: 1.05,
      h: 0.52,
      density: 0.52,
    },
  ],
  goals: [],
  cisterns: [],
  gates: [],
  crackedWalls: [
    {
      id: 'wall-sb',
      x: 4.1,
      y: 4.2,
      w: 0.45,
      h: 2.2,
      maxHp: 14,
      impactThreshold: 2.5,
    },
  ],
  magmaVents: [
    {
      id: 'magma-sb',
      x: 9.8,
      y: 0.5,
      w: 2.4,
      h: 0.55,
      maxHeat: 30,
      reheatRate: 3.0,
      goalQuench: false,
    },
  ],
  valves: [
    {
      id: 'valve-sb',
      x: 8.0,
      y: 6.2,
      length: 1.8,
      thickness: 0.18,
      angleA: 0.45,
      angleB: -0.45,
      initialToggled: false,
    },
  ],
  seesaws: [
    {
      id: 'seesaw-sb',
      x: 6.2,
      y: 4.5,
      length: 2.4,
      thickness: 0.16,
      maxAngle: 0.45,
      restAngle: -0.15,
      damping: 1.5,
    },
  ],
  mines: [
    {
      id: 'mine-sb',
      x: 6.7,
      y: 4.8,
      radius: 0.26,
      density: 0.48,
    },
  ],
  portals: [
    {
      id: 'portal-sb',
      inX: 1.5,
      inY: 2.6,
      outX: 14.3,
      outY: 7.2,
      ...outDirVec(-0.78, -0.625),
      radius: 0.52,
      boost: 1.4,
    },
  ],
};
