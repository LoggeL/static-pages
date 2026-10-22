// Crownward – Dev-Vorschau des Renderers (render-preview.html, nicht Teil des Produktions-Builds).
// Baut Szenen per createGame() und direkter Zustandsmanipulation – unabhängig von stepGame().
// URL: ?scene=day|dusk|night|dawn|coop|town3|wild|ship|victory|fx&w=1280&h=720[&t=Sekunden][&x=Spieler-x][&still=1]

import { BALANCE, createGame, type Citizen, type Enemy, type EnemyKind, type GameState, type Role, type SimEvent, type Structure, type StructureKind } from '../sim';
import { phaseAt } from '../sim/daycycle-query';
import { createRenderer, loadAssets } from './index';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'day';
const W = Number(params.get('w') ?? innerWidth);
const H = Number(params.get('h') ?? innerHeight);
const DPR = Number(params.get('dpr') ?? 1);
const still = params.get('still') === '1';

function st(s: GameState, kind: StructureKind, x: number): Structure {
  const f = s.structures.find((q) => q.kind === kind && q.x === x);
  if (!f) throw new Error(`Bauwerk ${kind}@${x} fehlt`);
  return f;
}

function setTime(s: GameState, t: number) {
  s.dayTime = t;
  s.phase = phaseAt(t);
}

function setTown(s: GameState, level: number) {
  st(s, 'townCenter', 0).level = level;
}

function wall(s: GameState, x: number, level: number, hpRatio = 1) {
  const w = st(s, 'wall', x);
  w.level = level;
  w.maxHp = BALANCE.wall.hp[level];
  w.hp = Math.round(w.maxHp * hpRatio);
}

function tower(s: GameState, x: number, level: number) {
  const t = st(s, 'tower', x);
  t.level = level;
  t.maxHp = BALANCE.tower.hp[level];
  t.hp = t.maxHp;
}

function citizen(s: GameState, role: Role, x: number, anim: Citizen['anim'] = 'idle', facing: 1 | -1 = 1, vx = 0): Citizen {
  const c: Citizen = {
    id: s.nextId++,
    role,
    x,
    vx,
    facing,
    task: { type: 'idle' },
    timer: 0,
    timer2: 0,
    campId: null,
    side: x < 0 ? -1 : 1,
    stunned: 0,
    anim,
  };
  s.citizens.push(c);
  return c;
}

function enemy(s: GameState, kind: EnemyKind, x: number, state: Enemy['state'], facing: 1 | -1 = -1, vx = 0): Enemy {
  const hp = BALANCE.enemies[kind].hp;
  const e: Enemy = {
    id: s.nextId++,
    kind,
    x,
    vx,
    facing,
    side: x < 0 ? -1 : 1,
    hp,
    maxHp: hp,
    state,
    targetId: null,
    targetKind: null,
    carrying: null,
    attackTimer: Math.random(),
    hitFlash: 0,
    anim: state === 'attackWall' || state === 'attackUnit' ? 'attack' : state === 'flee' ? 'flee' : 'walk',
  };
  s.enemies.push(e);
  return e;
}

function coin(s: GameState, x: number, y = 0) {
  s.coins.push({ id: s.nextId++, x, y, vx: 0, vy: 0, age: 5, droppedBy: null, pickupDelay: 0 });
}

function rabbit(s: GameState, x: number, state: 'idle' | 'hop' | 'flee', facing: 1 | -1 = 1) {
  s.rabbits.push({ id: s.nextId++, x, vx: state === 'idle' ? 0 : facing * 20, facing, state, timer: 0 });
}

/** typisches Dorf (Siedlungsstufe 1–2) */
function village(s: GameState, level: number) {
  setTown(s, level);
  wall(s, -210, level >= 2 ? 2 : 1);
  wall(s, 210, level >= 2 ? 2 : 1);
  if (level >= 1) {
    tower(s, 310, 1);
    tower(s, -310, level >= 2 ? 1 : 0);
    st(s, 'farm', 120).level = 1;
    wall(s, 390, level >= 2 ? 2 : 0);
  }
  st(s, 'toolStand', -46).stock = 2;
  st(s, 'toolStand', 46).stock = 1;
  if (level >= 1) st(s, 'toolStand', -82).stock = 1;
}

function build(): { state: GameState; split: boolean; events: SimEvent[] } {
  const coop = scene === 'coop';
  const s = createGame({ seed: 7, coop });
  const p = s.players[0];
  let split = false;
  const events: SimEvent[] = [];
  switch (scene) {
    case 'day': {
      setTime(s, 60);
      village(s, 1);
      const w = st(s, 'wall', 390);
      w.construction = { toLevel: 1, progress: 2.6, required: BALANCE.wall.work[1] };
      citizen(s, 'builder', 384, 'work', 1);
      citizen(s, 'builder', 397, 'work', -1);
      citizen(s, 'villager', 18, 'walk', 1, 30);
      citizen(s, 'archer', 268, 'walk', 1, 30);
      const tw = st(s, 'tower', 310);
      const a = citizen(s, 'archer', 310, 'idle', 1);
      tw.occupants = [a.id];
      citizen(s, 'farmer', 112, 'work', 1);
      citizen(s, 'farmer', 140, 'walk', -1, -28);
      rabbit(s, 470, 'hop', 1);
      rabbit(s, 520, 'idle', -1);
      coin(s, 150);
      coin(s, 238);
      coin(s, 262, 18);
      p.x = 58;
      p.facing = 1;
      p.vx = 60;
      p.anim = 'walk';
      break;
    }
    case 'dusk': {
      setTime(s, 140);
      village(s, 2);
      wall(s, 390, 2, 0.75);
      citizen(s, 'archer', 372, 'idle', 1);
      citizen(s, 'archer', -192, 'idle', -1);
      const tw = st(s, 'tower', 310);
      const a = citizen(s, 'archer', 310, 'shoot', 1);
      tw.occupants = [a.id];
      citizen(s, 'villager', -20, 'idle', 1);
      citizen(s, 'builder', 30, 'walk', -1, -30);
      enemy(s, 'mistling', 560, 'advance', -1, -30);
      enemy(s, 'mistling', 600, 'advance', -1, -30);
      p.x = 300;
      p.facing = 1;
      p.anim = 'idle';
      break;
    }
    case 'night': {
      setTime(s, 172);
      village(s, 2);
      wall(s, 390, 2, 0.35);
      const tw = st(s, 'tower', 310);
      const a = citizen(s, 'archer', 310, 'shoot', 1);
      tw.occupants = [a.id];
      citizen(s, 'archer', 368, 'shoot', 1);
      citizen(s, 'archer', 360, 'idle', 1);
      enemy(s, 'mistling', 402, 'attackWall', -1);
      enemy(s, 'mistling', 409, 'attackWall', -1);
      enemy(s, 'breaker', 424, 'attackWall', -1);
      enemy(s, 'mistling', 470, 'advance', -1, -30);
      const fl = enemy(s, 'mistling', 520, 'flee', 1, 50);
      fl.carrying = 'coin';
      s.arrows.push({ id: s.nextId++, x: 380, y: 40, vx: 200, vy: 40, damage: 1, life: 3, stuck: false });
      s.arrows.push({ id: s.nextId++, x: 340, y: 52, vx: 180, vy: 70, damage: 1, life: 3, stuck: false });
      s.arrows.push({ id: s.nextId++, x: 455, y: 0, vx: 120, vy: -120, damage: 1, life: 2, stuck: true });
      coin(s, 330);
      p.x = 300;
      p.facing = 1;
      break;
    }
    case 'dawn': {
      setTime(s, 202);
      village(s, 2);
      wall(s, 390, 2, 0.6);
      citizen(s, 'archer', 372, 'idle', -1);
      citizen(s, 'builder', 384, 'work', 1);
      p.x = 260;
      p.facing = -1;
      p.anim = 'graze';
      events.push({ type: 'enemiesDissolved', count: 3, xs: [430, 470, 520] });
      break;
    }
    case 'coop': {
      setTime(s, 136);
      village(s, 1);
      split = true;
      p.x = 40;
      p.facing = 1;
      p.vx = 60;
      p.anim = 'walk';
      const p2 = s.players[1];
      p2.x = 1220;
      p2.facing = -1;
      p2.vx = -140;
      p2.anim = 'run';
      citizen(s, 'vagrant', 1236, 'idle', 1);
      citizen(s, 'vagrant', 1268, 'walk', -1, -20);
      citizen(s, 'archer', 200, 'idle', 1);
      rabbit(s, 1180, 'hop', -1);
      coin(s, 1200);
      break;
    }
    case 'town3': {
      setTime(s, 124);
      setTown(s, 3);
      for (const x of [-610, -390, -210, 210, 390, 610]) wall(s, x, 3);
      for (const x of [-530, -310, 310, 530]) tower(s, x, 2);
      st(s, 'farm', 120).level = 1;
      st(s, 'farm', -140).level = 1;
      st(s, 'toolStand', -46).stock = 4;
      st(s, 'toolStand', 46).stock = 3;
      st(s, 'toolStand', -82).stock = 2;
      const t1 = st(s, 'tower', 310);
      t1.occupants = [citizen(s, 'archer', 310, 'idle', 1).id, citizen(s, 'archer', 310, 'idle', -1).id];
      citizen(s, 'farmer', 108, 'work', 1);
      citizen(s, 'farmer', 134, 'work', -1);
      citizen(s, 'builder', -30, 'walk', 1, 30);
      citizen(s, 'villager', 60, 'idle', -1);
      p.x = 4;
      p.facing = 1;
      break;
    }
    case 'wild': {
      setTime(s, 145);
      const ship = st(s, 'ship', -2960);
      ship.level = 2;
      ship.construction = { toLevel: 3, progress: 12, required: BALANCE.ship.work[3] };
      citizen(s, 'builder', -2930, 'work', -1);
      enemy(s, 'mistling', -2640, 'advance', 1, 30);
      st(s, 'chest', -2350).opened = false;
      p.x = -2760;
      p.facing = -1;
      p.anim = 'idle';
      break;
    }
    case 'ship': {
      setTime(s, 40);
      const ship = st(s, 'ship', -2960);
      ship.level = 3;
      p.x = -2940;
      p.facing = -1;
      break;
    }
    case 'victory': {
      setTime(s, 50);
      const ship = st(s, 'ship', -2960);
      ship.level = 3;
      s.outcome = 'victory';
      s.outcomeTime = 0;
      p.x = -2950;
      break;
    }
    case 'shrines': {
      setTime(s, 165);
      const sh = st(s, 'shrine', 1650);
      sh.activated = true;
      st(s, 'chest', 2050).opened = true;
      st(s, 'chest', 820).opened = false;
      p.x = 1700;
      p.facing = -1;
      events.push({ type: 'shrineActivated', x: 1650, structureId: sh.id, shrine: 'bow' });
      break;
    }
    case 'stress': {
      // ~220 Objekte für die Leistungsmessung
      setTime(s, 168);
      village(s, 2);
      wall(s, 390, 2, 0.5);
      const roles: Role[] = ['vagrant', 'villager', 'builder', 'archer', 'farmer'];
      for (let i = 0; i < 70; i++) citizen(s, roles[i % 5], -300 + i * 9, i % 3 ? 'walk' : 'idle', i % 2 ? 1 : -1, i % 3 ? (i % 2 ? 24 : -24) : 0);
      for (let i = 0; i < 60; i++) enemy(s, i % 6 ? 'mistling' : 'breaker', 400 + i * 6, i % 4 ? 'advance' : 'attackWall', -1, i % 4 ? -20 : 0);
      for (let i = 0; i < 80; i++) coin(s, -320 + i * 8, i % 5 === 0 ? 10 : 0);
      for (let i = 0; i < 20; i++) s.arrows.push({ id: s.nextId++, x: 200 + i * 10, y: 30 + (i % 5) * 6, vx: 180, vy: 40, damage: 1, life: 3, stuck: false });
      p.x = 200;
      break;
    }
    case 'defeat': {
      setTime(s, 175);
      village(s, 1);
      p.x = 160;
      p.coins = 0;
      enemy(s, 'mistling', 172, 'attackUnit', -1);
      events.push({ type: 'playerHit', x: 160, playerId: 0, coinsLost: 0 });
      events.push({ type: 'crownLost', x: 160, playerId: 0 });
      break;
    }
    case 'fx': {
      setTime(s, 165);
      village(s, 1);
      p.x = 120;
      break;
    }
    default:
      setTime(s, 60);
  }
  const t = params.get('t');
  if (t) setTime(s, Number(t));
  const x = params.get('x');
  if (x) p.x = Number(x);
  return { state: s, split, events };
}

async function main() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  // ?noatlas=1 prüft die Platzhalter-Grafik (Entwicklungs-Fallback)
  const assets = params.get('noatlas') === '1' ? { atlas: null, images: new Map<string, HTMLImageElement>(), missing: ['assets/sprites/atlas.json'] } : await loadAssets();
  const renderer = createRenderer(canvas, assets);
  renderer.resize(W, H, DPR);
  const { state, split, events } = build();
  renderer.snapCamera(state);
  if (events.length) renderer.handleEvents(events, state);
  const w = window as unknown as Record<string, unknown>;
  const info: Record<string, unknown> = { renderer, state, report: renderer.assetReport(), ready: false, renderMs: 0 };
  w.__preview = info;
  let msSum = 0;
  let msN = 0;
  let last = performance.now();
  let start = last;
  let fxTimer = 0;
  let frames = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!still) animate(state, dt);
    fxTimer += dt;
    if (fxTimer > 0.55) {
      fxTimer = 0;
      renderer.handleEvents(demoEvents(state), state);
    }
    const t0 = performance.now();
    renderer.render(state, { time: (now - start) / 1000, dt, split, paused: params.get('paused') === '1' });
    msSum += performance.now() - t0;
    msN++;
    if (msN >= 60) {
      info.renderMs = msSum / msN;
      msSum = 0;
      msN = 0;
    }
    if (++frames === 30) info.ready = true;
    requestAnimationFrame(loop);
  };
  start = performance.now();
  requestAnimationFrame(loop);
}

/** einfache Bewegung ohne Simulation: Figuren laufen hin und her */
function animate(s: GameState, dt: number) {
  for (const c of s.citizens) {
    if (c.vx === 0) continue;
    c.x += c.vx * dt;
    if (Math.abs(c.x) % 120 < Math.abs(c.vx * dt)) {
      c.vx = -c.vx;
      c.facing = c.vx < 0 ? -1 : 1;
    }
  }
  for (const e of s.enemies) {
    e.x += e.vx * dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    if (e.state === 'attackWall') e.attackTimer = (e.attackTimer + dt) % 1.1;
  }
  for (const r of s.rabbits) r.x += r.vx * dt * 0.3;
  for (const p of s.players) {
    if (p.anim === 'walk' || p.anim === 'run') {
      p.x += p.vx * dt;
      if (Math.abs(p.x) > 1600) p.vx = -p.vx;
      p.facing = p.vx < 0 ? -1 : 1;
    }
  }
  for (const a of s.arrows) {
    if (a.stuck) continue;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.vy -= 300 * dt;
    if (a.y < 0) {
      a.x -= 120;
      a.y = 50;
      a.vy = 60;
    }
  }
  if (s.outcome === 'victory') s.time += dt;
}

/** Beispiel-Ereignisse, damit Partikel/Feedback sichtbar sind */
function demoEvents(s: GameState): SimEvent[] {
  const out: SimEvent[] = [];
  for (const c of s.citizens) if (c.role === 'builder' && c.anim === 'work') out.push({ type: 'hammer', x: c.x + c.facing * 6, citizenId: c.id });
  for (const e of s.enemies) {
    if (e.state === 'attackWall' && Math.random() < 0.5) {
      const w = s.structures.find((q) => q.kind === 'wall' && Math.abs(q.x - e.x) < 30);
      if (w) out.push({ type: 'wallHit', x: w.x, structureId: w.id, hp: w.hp, maxHp: w.maxHp });
    }
    if (Math.random() < 0.3) {
      e.hitFlash = 0.15;
      out.push({ type: 'arrowHit', x: e.x, y: 10, target: 'enemy' });
    }
  }
  if (scene === 'fx') {
    const x = 60 + Math.random() * 200;
    const kinds: SimEvent[] = [
      { type: 'coinPickup', x, playerId: 0, coins: 5 },
      { type: 'buildComplete', x: 210, structureId: s.structures.find((q) => q.kind === 'wall' && q.x === 210)!.id, kind: 'wall', level: 1 },
      { type: 'enemyDied', x, kind: Math.random() < 0.5 ? 'mistling' : 'breaker' },
      { type: 'chestOpened', x, structureId: 0, coins: 8 },
      { type: 'harvest', x: 120, structureId: 0 },
      { type: 'purchase', x: 0, playerId: 0, structureId: 0, action: 'upgradeTown', cost: 5 },
    ];
    out.push(kinds[Math.floor(Math.random() * kinds.length)]);
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = 'Fehler: ' + String(err);
});
