// Crownward – übersetzt Simulationsereignisse in Hinweise/Banner (gedrosselt, gebündelt).

import { BALANCE } from '../sim';
import type { GameState, SimEvent } from '../sim';
import { coinsText, t } from './i18n';
import type { Toasts } from './toasts';

const isPaleMoon = (state: GameState, day: number) =>
  state.wave.paleMoon || (BALANCE.waves.paleMoonEvery > 0 && day % BALANCE.waves.paleMoonEvery === 0);

/** Untertitel zum Nachtbeginn: aus welchen Rissen die geplante Welle kommt (z. B. Nacht 1 nur von Osten). */
export function nightSubKey(state: GameState): string {
  const sides = new Set<number>();
  for (const p of state.wave.pending) sides.add(p.side);
  for (const en of state.enemies) sides.add(en.side);
  if (sides.size === 1) return sides.has(1) ? 'toast.nightBeginsEast' : 'toast.nightBeginsWest';
  return 'toast.nightBeginsSub';
}

export function feedEvents(events: readonly SimEvent[], state: GameState, toasts: Toasts): void {
  for (const e of events) {
    switch (e.type) {
      case 'recruit':
        toasts.push(t('toast.recruit'), { kind: 'good', key: 'recruit' });
        break;
      case 'roleChange':
        if (e.role === 'builder' || e.role === 'archer' || e.role === 'farmer') {
          toasts.push(t(`toast.role.${e.role}`), { kind: 'good', key: `role.${e.role}` });
        }
        break;
      case 'buildComplete': {
        if (e.kind === 'townCenter') {
          toasts.push(t('toast.build.townCenter', { name: t(`level.town.${e.level}`) }), { kind: 'good', duration: 4.5 });
        } else if (e.kind === 'wall') {
          toasts.push(t('toast.build.wall', { name: t(`level.wall.${e.level}`) }), { kind: 'good', key: `wall.${e.level}` });
        } else if (e.kind === 'tower') {
          toasts.push(t('toast.build.tower', { name: t(`level.tower.${e.level}`) }), { kind: 'good', key: `tower.${e.level}` });
        } else if (e.kind === 'farm') {
          toasts.push(t('toast.build.farm'), { kind: 'good', key: 'farm' });
        } else if (e.kind !== 'ship') {
          toasts.push(t('toast.build.generic'), { kind: 'good', key: 'build' });
        }
        break;
      }
      case 'nightWarning':
        toasts.push(t(e.paleMoon ? 'toast.paleMoonWarning' : 'toast.nightWarning'), {
          kind: 'warn',
          key: 'nightWarning',
          throttle: 30,
          duration: 5,
        });
        break;
      case 'phaseChange':
        // Banner der vorigen Phase darf die neue nicht überdauern (relevant im Zeitraffer)
        toasts.hidePhaseBanner();
        if (e.phase === 'night') {
          const pale = isPaleMoon(state, e.day);
          toasts.banner(t('toast.nightBegins', { n: e.day }), t(pale ? 'toast.paleMoonSub' : nightSubKey(state)), 'night');
        } else if (e.phase === 'day') {
          toasts.banner(t('toast.dayBreaks', { n: e.day }), t('toast.dayBreaksSub'), 'day');
        } else if (e.phase === 'dusk') {
          toasts.push(t('toast.dusk'), { kind: 'warn', key: 'dusk', throttle: 30, duration: 4.5 });
        }
        break;
      case 'enemiesDissolved':
        if (e.count > 0) toasts.push(t('toast.dissolved', { n: e.count }), { kind: 'good', key: 'dissolved', throttle: 20 });
        break;
      case 'chestOpened':
        toasts.push(t('toast.chest', { coins: coinsText(e.coins) }), { kind: 'good' });
        break;
      case 'shrineActivated':
        toasts.push(t(`toast.shrine.${e.shrine}`), { kind: 'good', duration: 5 });
        break;
      case 'wallDestroyed':
        toasts.push(t('toast.wallDestroyed'), { kind: 'danger', key: 'wallDestroyed' });
        break;
      case 'citizenHit':
        toasts.push(t('toast.citizenLost'), { kind: 'warn', key: 'citizenLost' });
        break;
      case 'purseFull':
        toasts.push(t('toast.purseFull'), { kind: 'muted', key: 'purseFull', throttle: 12 });
        break;
      case 'shipStage':
        if (e.level >= 3) toasts.banner(t('toast.ship.3'), t('offer.embark'), 'good', 4.5);
        else if (e.level >= 1) toasts.push(t(`toast.ship.${e.level}`), { kind: 'good', duration: 4.5 });
        break;
      case 'playerHit':
        if (e.coinsLost > 0) {
          const coins = coinsText(e.coinsLost);
          const text = state.coop ? t('toast.playerHitCoop', { p: e.playerId + 1, coins }) : t('toast.playerHit', { coins });
          toasts.push(text, { kind: 'danger', key: `hit.${e.playerId}` });
        }
        break;
      case 'enemyEscaped':
        if (e.carrying === 'crown') toasts.push(t('toast.crownStolen'), { kind: 'danger', key: 'crownStolen' });
        break;
      case 'crownLost':
        toasts.banner(t('toast.crownLost'), '', 'danger', 3);
        break;
      case 'victory':
        toasts.banner(t('end.victory'), t('end.victorySub'), 'good', 3);
        break;
      default:
        break;
    }
  }
}
