// Crownward – Erzeugung eines neuen Spielstands für die erste Insel.

import { BALANCE, ISLAND_1 } from './config';
import type { Citizen, GameState, Player, Structure } from './types';
import { newId, spawnCoin } from './util';

export interface NewGameOptions {
  seed?: number;
  /** lokaler Koop mit zwei Herrschern */
  coop?: boolean;
}

export function createPlayer(id: number, x: number): Player {
  return {
    id,
    x,
    vx: 0,
    facing: 1,
    coins: BALANCE.player.startCoins,
    stamina: 1,
    exhausted: false,
    hasCrown: true,
    invuln: 0,
    actHeld: 0,
    payTargetId: null,
    payProgress: 0,
    payTimer: 0,
    payOffer: null,
    dropCooldown: 0,
    idleTime: 0,
    anim: 'idle',
  };
}

export function createCitizen(state: GameState, role: Citizen['role'], x: number, campId: number | null = null): Citizen {
  const c: Citizen = {
    id: newId(state),
    role,
    x,
    vx: 0,
    facing: 1,
    task: { type: 'idle' },
    timer: 0,
    timer2: 0,
    campId,
    side: x < 0 ? -1 : 1,
    stunned: 0,
    anim: 'idle',
  };
  state.citizens.push(c);
  return c;
}

export function createGame(opts: NewGameOptions = {}): GameState {
  const seed = (opts.seed ?? 20261022) >>> 0;
  const state: GameState = {
    schema: 1,
    seed,
    rng: seed,
    nextId: 1,
    time: 0,
    day: 1,
    dayTime: BALANCE.cycle.startTime,
    phase: 'day',
    coop: !!opts.coop,
    players: [],
    citizens: [],
    enemies: [],
    structures: [],
    coins: [],
    arrows: [],
    rabbits: [],
    wave: { night: 0, elapsed: 0, pending: [], paleMoon: false },
    buffs: { bowShrine: false, hammerShrine: false },
    outcome: 'playing',
    outcomeTime: 0,
    stats: {
      coinsCollected: 0,
      coinsSpent: 0,
      enemiesSlain: 0,
      recruited: 0,
      wallsLost: 0,
      citizensLost: 0,
      chestsOpened: 0,
    },
  };

  const playerCount = state.coop ? 2 : 1;
  for (let i = 0; i < playerCount; i++) state.players.push(createPlayer(i, ISLAND_1.playerStartX[i] ?? 0));

  for (const e of ISLAND_1.layout) {
    const s: Structure = {
      id: newId(state),
      kind: e.kind,
      x: e.x,
      width: e.width,
      level: e.level ?? 0,
      hp: 0,
      maxHp: 0,
      construction: null,
      side: e.x < -1 ? -1 : e.x > 1 ? 1 : 0,
      unlockLevel: e.unlockLevel ?? 0,
    };
    if (e.kind === 'toolStand') {
      s.tool = e.tool;
      s.stock = 0;
    }
    if (e.kind === 'chest') {
      s.opened = false;
      s.reward = e.reward ?? 8;
    }
    if (e.kind === 'shrine') {
      s.shrine = e.shrine;
      s.activated = false;
    }
    if (e.kind === 'farm' || e.kind === 'tower') s.occupants = [];
    if (e.kind === 'camp') s.spawnTimer = 5;
    state.structures.push(s);
  }

  for (const x of ISLAND_1.startVagrantsX) {
    const c = createCitizen(state, 'vagrant', x, null);
    c.task = { type: 'idle' };
  }
  for (const x of ISLAND_1.startCoinsOnGround) spawnCoin(state, x, { vx: 0, vy: 0, y: 0, pickupDelay: 0 });

  return state;
}
