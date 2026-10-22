// Crownward – Kaufangebote der Bauwerke und ihre Ausführung. Eigentum: sim-economy.
// Vertrag: getOffer / getPlayerFocus sind reine Abfragen (verändern den Zustand nicht, kein RNG).

import { BALANCE } from './config';
import type { GameState, Offer, OfferAction, Structure } from './types';
import { randRange, setOutcome, spawnCoin, structureById, townLevel, type Emit } from './util';

/** Streuung der Münzfontäne beim Öffnen einer Truhe */
const CHEST_VX = 75;
const CHEST_VY: [number, number] = [120, 210];
const CHEST_PICKUP_DELAY = 0.6;

function make(
  s: Structure,
  action: OfferAction,
  cost: number,
  toLevel: number,
  labelKey: string,
  blockedKey: string | null,
): Offer {
  return { structureId: s.id, action, cost, toLevel, labelKey, blockedKey };
}

/** Sperrschlüssel, falls die benötigte Siedlungsstufe fehlt. */
function townBlock(required: number, current: number): string | null {
  return required > current ? `blocked.town.${required}` : null;
}

/** Aktuelles Angebot eines Bauwerks (oder null, wenn dort nichts zu kaufen ist). */
export function getOffer(state: GameState, structure: Structure): Offer | null {
  if (state.outcome !== 'playing') return null;
  const s = structure;
  const tl = townLevel(state);
  // Bauplätze erscheinen erst mit der nötigen Siedlungsstufe
  if (s.unlockLevel > tl) return null;
  const building = s.construction ? 'blocked.building' : null;

  switch (s.kind) {
    case 'townCenter': {
      if (s.level >= 3) return null;
      const to = s.level + 1;
      return make(s, 'upgradeTown', BALANCE.townCenter.cost[to], to, `offer.upgradeTown.${to}`, building);
    }
    case 'wall': {
      if (s.level >= 3) return null;
      const to = s.level + 1;
      const fresh = s.level === 0;
      return make(
        s,
        fresh ? 'buildWall' : 'upgradeWall',
        BALANCE.wall.cost[to],
        to,
        fresh ? 'offer.buildWall.1' : `offer.upgradeWall.${to}`,
        building ?? townBlock(BALANCE.wall.townReq[to], tl),
      );
    }
    case 'tower': {
      if (s.level >= 2) return null;
      const to = s.level + 1;
      const fresh = s.level === 0;
      return make(
        s,
        fresh ? 'buildTower' : 'upgradeTower',
        BALANCE.tower.cost[to],
        to,
        fresh ? 'offer.buildTower.1' : `offer.upgradeTower.${to}`,
        building ?? townBlock(BALANCE.tower.townReq[to], tl),
      );
    }
    case 'farm': {
      if (s.level >= 1) return null;
      return make(s, 'buildFarm', BALANCE.farm.cost, 1, 'offer.buildFarm', building);
    }
    case 'toolStand': {
      const tool = s.tool ?? 'hammer';
      const full = (s.stock ?? 0) >= BALANCE.tools.maxStock;
      return make(s, 'buyTool', BALANCE.tools.cost[tool], 0, `offer.buyTool.${tool}`, full ? 'blocked.stockFull' : null);
    }
    case 'chest': {
      if (s.opened) return null;
      return make(s, 'openChest', 0, 0, 'offer.openChest', null);
    }
    case 'shrine': {
      if (s.activated) return null;
      return make(s, 'activateShrine', BALANCE.shrines.cost, 1, `offer.activateShrine.${s.shrine ?? 'bow'}`, null);
    }
    case 'ship': {
      if (s.level >= 3) return make(s, 'embark', 0, 3, 'offer.embark', building);
      const to = s.level + 1;
      return make(
        s,
        'repairShip',
        BALANCE.ship.cost[to],
        to,
        `offer.repairShip.${to}`,
        building ?? townBlock(BALANCE.ship.townReq[to], tl),
      );
    }
    default:
      return null; // Lager, Nebelrisse: nichts zu kaufen
  }
}

/**
 * Angebot des nächstgelegenen Bauwerks in Interaktionsreichweite eines Spielers (oder null).
 * Freie Angebote haben Vorrang vor gesperrten; eine laufende Zahlung hält ihren Fokus.
 */
export function getPlayerFocus(state: GameState, playerId: number): Offer | null {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p || !p.hasCrown || state.outcome !== 'playing') return null;
  const reach = BALANCE.player.interactRadius;
  let best: Offer | null = null;
  let bestScore = Infinity;
  for (const s of state.structures) {
    const d = Math.abs(s.x - p.x);
    if (d > reach + s.width / 2) continue;
    const o = getOffer(state, s);
    if (!o) continue;
    let score = d;
    if (o.blockedKey !== null) score += 1e6;
    else if (p.payTargetId === s.id) score -= 1e5;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/** Legt einen Bauauftrag an; Bauleute erledigen die Arbeit (citizens.ts). */
function startConstruction(s: Structure, toLevel: number, work: number, emit: Emit): void {
  s.construction = { toLevel, progress: 0, required: work };
  emit({ type: 'buildStart', x: s.x, structureId: s.id, kind: s.kind, toLevel });
}

/**
 * Führt ein vollständig bezahltes Angebot aus (Bau beauftragen, Werkzeug ablegen, Truhe öffnen, Ablegen …).
 * Prüft vorher, ob das Angebot noch gilt; gibt false zurück, wenn nicht (Aufrufer erstattet dann).
 */
export function applyOffer(state: GameState, playerId: number, offer: Offer, emit: Emit): boolean {
  void playerId;
  const s = structureById(state, offer.structureId);
  if (!s) return false;
  const current = getOffer(state, s);
  if (
    !current ||
    current.blockedKey !== null ||
    current.action !== offer.action ||
    current.toLevel !== offer.toLevel ||
    current.cost !== offer.cost
  ) {
    return false;
  }
  const to = offer.toLevel;

  switch (offer.action) {
    case 'upgradeTown':
      startConstruction(s, to, BALANCE.townCenter.work[to], emit);
      break;
    case 'buildWall':
    case 'upgradeWall':
      // Eine Mauer im Ausbau bleibt mit alter Stufe und alten HP stehen, bis die Bauleute fertig sind
      startConstruction(s, to, BALANCE.wall.work[to], emit);
      break;
    case 'buildTower':
    case 'upgradeTower':
      startConstruction(s, to, BALANCE.tower.work[to], emit);
      break;
    case 'buildFarm':
      startConstruction(s, 1, BALANCE.farm.work, emit);
      break;
    case 'repairShip':
      startConstruction(s, to, BALANCE.ship.work[to], emit);
      break;
    case 'buyTool': {
      s.stock = (s.stock ?? 0) + 1;
      emit({ type: 'toolStocked', x: s.x, tool: s.tool ?? 'hammer', structureId: s.id });
      break;
    }
    case 'openChest': {
      const n = s.reward ?? 0;
      s.opened = true;
      for (let i = 0; i < n; i++) {
        spawnCoin(state, s.x, {
          vx: randRange(state, -CHEST_VX, CHEST_VX),
          vy: randRange(state, CHEST_VY[0], CHEST_VY[1]),
          y: 10,
          pickupDelay: CHEST_PICKUP_DELAY,
        });
      }
      state.stats.chestsOpened++;
      emit({ type: 'chestOpened', x: s.x, structureId: s.id, coins: n });
      break;
    }
    case 'activateShrine': {
      const kind = s.shrine ?? 'bow';
      s.activated = true;
      if (kind === 'bow') state.buffs.bowShrine = true;
      else state.buffs.hammerShrine = true;
      emit({ type: 'shrineActivated', x: s.x, structureId: s.id, shrine: kind });
      break;
    }
    case 'embark':
      setOutcome(state, 'victory', s.x, emit);
      break;
  }
  return true;
}
