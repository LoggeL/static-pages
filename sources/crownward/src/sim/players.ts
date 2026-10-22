// Crownward – Herrscher:innen zu Pferd: Reiten, Sprint/Ausdauer, Münzen aufheben, Einzahlen, Fallenlassen.
// Eigentum: sim-economy. Funktioniert für 1 oder 2 Spieler (Koop); jeder hat eigenen Zahlungsfortschritt.

import { BALANCE } from './config';
import type { GameState, GroundCoin, Offer, Player, PlayerInput } from './types';
import { applyOffer, getPlayerFocus } from './offers';
import { approach, structureById, spawnCoin, type Emit } from './util';

const IDLE_INPUT: PlayerInput = Object.freeze({ left: false, right: false, sprint: false, act: false });
/** Abstand der Figur zum Weltrand */
const EDGE_MARGIN = 24;
/** Bremsen/Wenden ist kräftiger als Anfahren → direktere Steuerung */
const BRAKE_MULT = 1.6;
/** ab dieser Geschwindigkeit gilt die Figur als in Bewegung */
const MOVING_EPS = 1;
/** Sekunden Stillstand bis zum Grasen */
const GRAZE_AFTER = 4;
/** Münzen höher als das (noch im Flug) werden nicht eingesammelt */
const PICKUP_MAX_Y = 12;
/** Mindestalter einer vom anderen Spieler fallengelassenen Münze */
const FOREIGN_DROP_DELAY = 0.35;
/** purseFull höchstens alle n Sekunden je Spieler melden */
const PURSE_FULL_THROTTLE = 2;
/** Fallengelassene Münze: Startpunkt und Wurf vor das Pferd (landet außerhalb des eigenen Aufheberadius) */
const DROP_OFFSET = 10;
const DROP_VX = 30;
const DROP_VY = 50;
const DROP_Y = 16;
/** Erstattung, die nicht mehr in den Beutel passt, springt so vor der Figur zu Boden */
const SPILL_VY = 70;
const SPILL_Y = 10;
const SPILL_PICKUP_DELAY = 0.6;

export function updatePlayers(state: GameState, inputs: readonly PlayerInput[], dt: number, emit: Emit): void {
  // Münzen, auf denen gerade ein Landstreicher kniet, sind für Spieler tabu
  const reserved = new Set<number>();
  for (const c of state.citizens) {
    if (c.task.type === 'pickupCoin' && c.anim === 'kneel') reserved.add(c.task.coinId);
  }

  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    // Nach Kronverlust keine Steuerung mehr
    const input = p.hasCrown ? (inputs[i] ?? IDLE_INPUT) : IDLE_INPUT;
    updateMovement(p, input, dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.dropCooldown = Math.max(0, p.dropCooldown - dt);
    if (p.hasCrown) pickupCoins(state, p, reserved, emit);
    updateAct(state, p, input, dt, emit);
  }
}

// ---------- Reiten und Ausdauer ----------

function updateMovement(p: Player, input: PlayerInput, dt: number): void {
  const P = BALANCE.player;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const wantSprint = input.sprint && dir !== 0 && !p.exhausted && p.stamina > 0;
  const target = dir * (wantSprint ? P.sprintSpeed : P.walkSpeed);
  const accelerating = target !== 0 && p.vx * target >= 0 && Math.abs(target) > Math.abs(p.vx);
  p.vx = approach(p.vx, target, (accelerating ? P.accel : P.accel * BRAKE_MULT) * dt);

  p.x += p.vx * dt;
  const lo = BALANCE.world.minX + EDGE_MARGIN;
  const hi = BALANCE.world.maxX - EDGE_MARGIN;
  if (p.x < lo) {
    p.x = lo;
    if (p.vx < 0) p.vx = 0;
  } else if (p.x > hi) {
    p.x = hi;
    if (p.vx > 0) p.vx = 0;
  }
  if (dir !== 0) p.facing = dir > 0 ? 1 : -1;

  const speed = Math.abs(p.vx);
  const moving = speed > MOVING_EPS;
  if (wantSprint && speed > P.walkSpeed * 0.5) {
    p.stamina = Math.max(0, p.stamina - P.staminaDrain * dt);
    if (p.stamina <= 0) p.exhausted = true;
  } else {
    const mult = !moving && dir === 0 ? P.idleRegenMult : 1;
    p.stamina = Math.min(1, p.stamina + P.staminaRegen * mult * dt);
  }
  if (p.exhausted && p.stamina >= P.exhaustRecover) p.exhausted = false;

  // Grasen erst nach längerem Stillstand ohne Interaktion
  if (dir === 0 && !moving && !input.act) p.idleTime += dt;
  else p.idleTime = 0;

  if (!moving) p.anim = p.idleTime >= GRAZE_AFTER ? 'graze' : 'idle';
  else p.anim = speed > P.walkSpeed + 4 ? 'run' : 'walk';
}

// ---------- Münzen aufheben ----------

function canPickup(p: Player, c: GroundCoin): boolean {
  if (c.y >= PICKUP_MAX_Y) return false;
  if (Math.abs(c.x - p.x) > BALANCE.player.pickupRadius) return false;
  if (c.droppedBy === p.id) return c.pickupDelay <= 0 && c.age >= BALANCE.player.dropPickupDelay;
  // Die Sperre nach dem Fallenlassen gilt nur für die Person, die die Münze fallen ließ
  if (c.droppedBy !== null) return c.age >= FOREIGN_DROP_DELAY;
  return c.pickupDelay <= 0;
}

function pickupCoins(state: GameState, p: Player, reserved: ReadonlySet<number>, emit: Emit): void {
  // Münzen in den Kostenslots gehören noch zum Beutel (Abbruch erstattet sie) und belegen dort Platz
  const max = BALANCE.player.purseMax - (p.payTargetId !== null ? p.payProgress : 0);
  let blockedByFullPurse = false;
  for (let i = 0; i < state.coins.length; ) {
    const c = state.coins[i];
    if (reserved.has(c.id) || !canPickup(p, c)) {
      i++;
      continue;
    }
    if (p.coins >= max) {
      blockedByFullPurse = true;
      i++;
      continue;
    }
    state.coins.splice(i, 1);
    p.coins++;
    state.stats.coinsCollected++;
    emit({ type: 'coinPickup', x: c.x, playerId: p.id, coins: p.coins });
  }
  if (blockedByFullPurse) {
    const last = p.purseFullAt;
    if (last === undefined || state.time < last || state.time - last >= PURSE_FULL_THROTTLE) {
      p.purseFullAt = state.time;
      emit({ type: 'purseFull', x: p.x, playerId: p.id });
    }
  }
}

// ---------- Einzahlen / Fallenlassen ----------

function resetPay(p: Player): void {
  p.payTargetId = null;
  p.payProgress = 0;
  p.payTimer = 0;
  p.payOffer = null;
}

/** Gilt noch dasselbe Angebot wie bei Zahlungsbeginn? (Ältere Stände ohne payOffer: nur Kostenprüfung.) */
function sameOffer(p: Player, focus: Offer): boolean {
  if (p.payProgress > focus.cost) return false;
  const o = p.payOffer;
  return !o || (o.action === focus.action && o.toLevel === focus.toLevel && o.cost === focus.cost);
}

/**
 * Bricht eine laufende Zahlung ab und legt die Münzen zurück in den Beutel. Was nicht mehr hineinpasst
 * (nur bei inkonsistent geladenen Ständen möglich), springt vor der Figur zu Boden – verloren geht nichts.
 */
function cancelPay(state: GameState, p: Player, emit: Emit): void {
  const id = p.payTargetId;
  if (id === null) return;
  const refunded = p.payProgress;
  const intoPurse = Math.max(0, Math.min(refunded, BALANCE.player.purseMax - p.coins));
  p.coins += intoPurse;
  for (let i = intoPurse; i < refunded; i++) {
    spawnCoin(state, p.x + p.facing * DROP_OFFSET, { vy: SPILL_VY, y: SPILL_Y, pickupDelay: SPILL_PICKUP_DELAY });
  }
  const s = structureById(state, id);
  emit({ type: 'payCancelled', x: s ? s.x : p.x, playerId: p.id, structureId: id, refunded });
  resetPay(p);
}

/** Vollständig bezahltes (oder kostenloses) Angebot ausführen. */
function completePurchase(state: GameState, p: Player, offer: Offer, emit: Emit): void {
  const s = structureById(state, offer.structureId);
  const x = s ? s.x : p.x;
  if (applyOffer(state, p.id, offer, emit)) {
    state.stats.coinsSpent += offer.cost;
    emit({ type: 'purchase', x, playerId: p.id, structureId: offer.structureId, action: offer.action, cost: offer.cost });
    resetPay(p);
  } else if (p.payTargetId !== null) {
    cancelPay(state, p, emit);
  }
}

function updateAct(state: GameState, p: Player, input: PlayerInput, dt: number, emit: Emit): void {
  const P = BALANCE.player;
  const edge = input.act && p.actHeld === 0;
  p.actHeld = input.act ? p.actHeld + Math.max(dt, 1e-6) : 0;
  const focus = getPlayerFocus(state, p.id);

  // laufende Zahlung fortsetzen oder abbrechen. Hat sich das Angebot geändert (Mauer fiel mitten im Ausbau),
  // wird erstattet statt stillschweigend etwas anderes zu kaufen.
  if (p.payTargetId !== null) {
    const valid =
      input.act &&
      focus !== null &&
      focus.structureId === p.payTargetId &&
      focus.blockedKey === null &&
      focus.cost > 0 &&
      sameOffer(p, focus);
    if (!valid) {
      cancelPay(state, p, emit);
      return;
    }
    if (p.payProgress >= focus.cost) {
      completePurchase(state, p, focus, emit);
      return;
    }
    const s = structureById(state, focus.structureId);
    p.payTimer -= dt;
    while (p.payTimer <= 0 && p.payTargetId !== null) {
      if (p.coins <= 0) {
        // nicht genug Münzen → Abbruch mit Rückgabe
        cancelPay(state, p, emit);
        break;
      }
      p.coins--;
      p.payProgress++;
      emit({
        type: 'coinPaid',
        x: s ? s.x : p.x,
        playerId: p.id,
        structureId: focus.structureId,
        paid: p.payProgress,
        cost: focus.cost,
      });
      if (p.payProgress >= focus.cost) {
        completePurchase(state, p, focus, emit);
        break;
      }
      p.payTimer += P.payInterval;
    }
    return;
  }

  if (!edge || !p.hasCrown) return;

  if (focus) {
    if (focus.blockedKey !== null) return; // gesperrt: Hinweis zeigt die UI
    if (focus.cost === 0) {
      completePurchase(state, p, focus, emit);
    } else if (p.coins > 0) {
      p.payTargetId = focus.structureId;
      p.payProgress = 0;
      p.payTimer = P.payFirstDelay;
      p.payOffer = { action: focus.action, toLevel: focus.toLevel, cost: focus.cost };
    } else {
      // leerer Beutel: sofortige Rückmeldung ohne Zahlung
      const s = structureById(state, focus.structureId);
      emit({ type: 'payCancelled', x: s ? s.x : p.x, playerId: p.id, structureId: focus.structureId, refunded: 0 });
    }
    return;
  }

  // kein Angebot in Reichweite → eine Münze vor das Pferd fallen lassen
  if (p.dropCooldown > 0 || p.coins <= 0) return;
  p.coins--;
  const x = p.x + p.facing * DROP_OFFSET;
  spawnCoin(state, x, {
    vx: p.facing * DROP_VX + p.vx * 0.35,
    vy: DROP_VY,
    y: DROP_Y,
    droppedBy: p.id,
    pickupDelay: P.dropPickupDelay,
  });
  p.dropCooldown = P.dropCooldown;
  emit({ type: 'coinDrop', x, playerId: p.id });
}
