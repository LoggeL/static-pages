// Crownward – Kontexthinweis aus dem Angebot in Reichweite (getPlayerFocus) – reine Funktion, testbar.

import { BALANCE, constructionStatus } from '../sim';
import type { GameState, Offer, Player } from '../sim';
import type { InputDevice, KeyboardSide } from '../input/types';
import { coinsText, hasText, t } from './i18n';

export type HintTone = 'ok' | 'paying' | 'poor' | 'blocked' | 'info';

export interface HintView {
  label: string;
  /** Kosten / Sperrgrund / fehlende Münzen */
  detail: string;
  /** Tastenhinweis („S halten") oder null */
  key: string | null;
  tone: HintTone;
  cost: number;
  /** bereits eingezahlte Münzen */
  paid: number;
}

/**
 * Tastenhinweis je Gerät und Spieler. Im Koop gehört jedem Spieler eine Tastaturhälfte; im Einzelspiel zählen
 * beide – dann nennt der Hinweis die zuletzt benutzte Hälfte (vor der ersten Taste beide).
 */
export function holdLabel(device: InputDevice, playerIndex: number, coop: boolean, side: KeyboardSide = null): string {
  return keyLabel('hold', device, playerIndex, coop, side);
}

/** Wie holdLabel, aber für einen kurzen Druck („S tippen" – Münze fallen lassen). */
export function tapLabel(device: InputDevice, playerIndex: number, coop: boolean, side: KeyboardSide = null): string {
  return keyLabel('tap', device, playerIndex, coop, side);
}

function keyLabel(kind: 'hold' | 'tap', device: InputDevice, playerIndex: number, coop: boolean, side: KeyboardSide): string {
  const k = `hint.${kind}`;
  if (device === 'touch') return t(`${k}.touch`);
  if (device === 'gamepad') return t(`${k}.pad`);
  if (coop) return t(playerIndex === 1 ? `${k}.kb2` : `${k}.kb1`);
  if (side === 'arrows') return t(`${k}.kb2`);
  if (side === 'wasd') return t(`${k}.kb1`);
  return t(`${k}.kbSolo`);
}

/**
 * Einführungstext der ersten Sekunden. Im Koop je Spieler nach dessen Gerät (ein Touch-Spieler 1 sieht keine
 * Tastaturtasten), sonst nach dem Gerät von Spieler 1. touchVisible: Bildschirmtasten sind eingeblendet.
 */
export function introText(coop: boolean, devices: readonly InputDevice[], touchVisible: boolean): string {
  const dev0: InputDevice = touchVisible ? 'touch' : (devices[0] ?? 'keyboard');
  if (coop) {
    const part = (d: InputDevice, i: number) =>
      t(d === 'touch' ? 'hint.intro.coop.touch' : d === 'gamepad' ? 'hint.intro.coop.pad' : i === 1 ? 'hint.intro.coop.kb2' : 'hint.intro.coop.kb1');
    // Spieler 2 hat keine Bildschirmtasten: Tastatur (Pfeil-Hälfte) oder Gamepad
    const dev1: InputDevice = devices[1] === 'gamepad' ? 'gamepad' : 'keyboard';
    return t('hint.intro.coop', { p1: part(dev0, 0), p2: part(dev1, 1) });
  }
  return t(dev0 === 'gamepad' ? 'hint.intro.pad' : dev0 === 'touch' ? 'hint.intro.touch' : 'hint.intro.kb');
}

/** Wirkung eines Angebots, wenn der Name sie nicht verrät (Schreine), sonst null. */
export function offerEffect(offer: Offer): string | null {
  const key = `effect.${offer.labelKey}`;
  return hasText(key) ? t(key) : null;
}

/** Sperrgrund; bei einem laufenden Bau mit dem Stand der Bauleute (warum er ggf. stillsteht). */
function blockedDetail(offer: Offer, state: GameState | undefined): string {
  if (state && offer.blockedKey === 'blocked.building') {
    const s = state.structures.find((x) => x.id === offer.structureId);
    const status = s ? constructionStatus(state, s) : null;
    if (status) return t(`blocked.building.${status}`);
  }
  return t(offer.blockedKey ?? 'blocked.generic');
}

export function describeOffer(offer: Offer | null, player: Player, hold: string, state?: GameState): HintView | null {
  if (!offer) return null;
  const label = t(offer.labelKey);
  if (offer.blockedKey) {
    return { label, detail: blockedDetail(offer, state), key: null, tone: 'blocked', cost: offer.cost, paid: 0 };
  }
  if (offer.cost <= 0) {
    return { label, detail: t('hint.free'), key: hold, tone: 'ok', cost: 0, paid: 0 };
  }
  const paid = player.payTargetId === offer.structureId ? Math.min(offer.cost, player.payProgress) : 0;
  const need = offer.cost - paid;
  // Wirkung vor den Kosten – ein Schrein verrät sonst erst nach dem Kauf, was er bewirkt
  const effect = offerEffect(offer);
  const price = effect ? `${effect} · ${coinsText(offer.cost)}` : coinsText(offer.cost);
  if (player.coins < need) {
    const missing = need - player.coins;
    return {
      label,
      detail: `${price} · ${t(missing === 1 ? 'hint.missing.one' : 'hint.missing', { n: missing })}`,
      key: null,
      tone: 'poor',
      cost: offer.cost,
      paid,
    };
  }
  return {
    label,
    detail: paid > 0 ? `${price} · ${t('hint.paying', { paid, cost: offer.cost })}` : price,
    key: hold,
    tone: paid > 0 ? 'paying' : 'ok',
    cost: offer.cost,
    paid,
  };
}

/** Ungefährer Landepunkt einer fallengelassenen Münze vor dem Pferd (sim/players.ts: Versatz + kurzer Flug). */
export const DROP_LAND_AHEAD = 20;
/** Sicherheitsabstand zum Bemerkradius (Landstreicher bummeln ein wenig am Feuer bzw. Lager). */
const VAGRANT_HINT_MARGIN = 8;

/**
 * Anwerbe-Hinweis: Kein Angebot in Reichweite (dann lässt ein kurzer Druck eine Münze fallen) und ein freier
 * Landstreicher würde die Münze bemerken, die jetzt vor dem Pferd landet. Ohne Münzen, ohne Krone oder nach
 * Spielende kein Hinweis.
 */
export function vagrantHint(state: GameState, player: Player, offer: Offer | null, tap: string): HintView | null {
  if (offer || state.outcome !== 'playing' || !player.hasCrown || player.coins <= 0) return null;
  const landing = player.x + player.facing * DROP_LAND_AHEAD;
  const reach = BALANCE.citizens.coinNoticeRadius - VAGRANT_HINT_MARGIN;
  const near = state.citizens.some(
    (c) =>
      c.role === 'vagrant' &&
      c.stunned <= 0 &&
      c.task.type !== 'flee' &&
      c.task.type !== 'pickupCoin' &&
      Math.abs(c.x - landing) <= reach,
  );
  if (!near) return null;
  return { label: t('hint.vagrant'), detail: t('hint.vagrantDetail'), key: tap, tone: 'ok', cost: 0, paid: 0 };
}

/** Einzeiliger Text des Hinweises (für Tests/Debug und Screenreader). */
export function hintText(v: HintView | null): string {
  if (!v) return '';
  return [v.label, v.detail, v.key].filter(Boolean).join(' – ');
}
