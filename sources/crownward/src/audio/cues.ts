// Crownward – Zuordnung Simulationsereignis → Klang-Auftrag (rein, testbar).
// Die eigentliche Klangsynthese steckt in sfx.ts; hier nur Auswahl, Ort, Priorität und Drosselung.

import type { SimEvent } from '../sim';
import { nearestListener, type SpaceMode } from './spatial';
import type { Priority } from './throttle';

export type SfxId =
  | 'coinPickup'
  | 'coinDrop'
  | 'coinPaid'
  | 'payCancelled'
  | 'purchase'
  | 'buildStart'
  | 'toolStocked'
  | 'hammer'
  | 'buildComplete'
  | 'repaired'
  | 'recruit'
  | 'roleChange'
  | 'vagrantSpawn'
  | 'harvest'
  | 'arrowFired'
  | 'arrowHit'
  | 'coinPop'
  | 'enemySpawn'
  | 'enemyHit'
  | 'enemyDied'
  | 'enemyEscaped'
  | 'enemiesDissolved'
  | 'wallHit'
  | 'wallDestroyed'
  | 'playerHit'
  | 'citizenHit'
  | 'crownLost'
  | 'nightWarning'
  | 'dawnBirds'
  | 'nightGong'
  | 'dayChime'
  | 'duskBell'
  | 'chestOpened'
  | 'shrineActivated'
  | 'shipStage'
  | 'victory'
  | 'defeat'
  | 'purseFull'
  | 'uiClick'
  | 'uiOpen'
  | 'uiClose'
  | 'uiError'
  | 'uiStart';

/** Klangparameter (nur Zahlen/Flags, damit die Synthese einfach bleibt). */
export interface CueParams {
  /** allgemeiner Wert 0..1 (z. B. Zahlfortschritt, Mauerzustand) */
  ratio: number;
  /** Stufe/Anzahl (Baustufe, Münzen, Gegnerzahl) */
  level: number;
  /** Variante: Brecher statt Mistling, Fahlmond, Turm statt Mauer … */
  heavy: boolean;
  /** Untervariante als Text (Rolle, Ziel, Bauwerk) */
  variant: string;
  /** Tonhöhenversatz in Halbtönen (z. B. Münz-Kombo, setzt die Engine) */
  semis: number;
}

export interface SoundCue {
  id: SfxId;
  x: number | null;
  space: SpaceMode;
  priority: Priority;
  /** Drossel-Schlüssel und Mindestabstand in s */
  key: string;
  minInterval: number;
  /** höchstens so viele Auslösungen pro Sekunde (0 = unbegrenzt) */
  burst: number;
  /** Lautstärkefaktor des Auftrags */
  gain: number;
  /** Hall-Anteil 0..1 */
  reverb: number;
  params: CueParams;
}

const P = (p: Partial<CueParams> = {}): CueParams => ({ ratio: 0, level: 0, heavy: false, variant: '', semis: 0, ...p });

function cue(
  id: SfxId,
  x: number | null,
  o: {
    space?: SpaceMode;
    priority?: Priority;
    key?: string;
    minInterval?: number;
    burst?: number;
    gain?: number;
    reverb?: number;
    params?: Partial<CueParams>;
  } = {},
): SoundCue {
  return {
    id,
    x,
    space: o.space ?? 'near',
    priority: o.priority ?? 1,
    key: o.key ?? id,
    minInterval: o.minInterval ?? 0.05,
    burst: o.burst ?? 0,
    gain: o.gain ?? 1,
    reverb: o.reverb ?? 0.12,
    params: P(o.params),
  };
}

/**
 * Bildet ein Ereignis auf einen Klang ab (oder null = bewusst stumm).
 * listeners = x-Positionen der Spieler (für Ereignisse mit mehreren Orten).
 */
export function mapEvent(e: SimEvent, listeners: readonly number[] = []): SoundCue | null {
  switch (e.type) {
    case 'coinPickup':
      return cue('coinPickup', e.x, { priority: 0, key: `coinPickup:${e.playerId}`, minInterval: 0.035, params: { level: e.coins } });
    case 'coinDrop':
      return cue('coinDrop', e.x, { priority: 0, minInterval: 0.08 });
    case 'purseFull':
      return cue('purseFull', e.x, { priority: 1, key: `purseFull:${e.playerId}`, minInterval: 0.7, gain: 0.8 });
    case 'coinPaid':
      return cue('coinPaid', e.x, {
        priority: 1,
        key: `coinPaid:${e.playerId}`,
        minInterval: 0.04,
        params: { ratio: e.cost > 0 ? Math.min(1, e.paid / e.cost) : 1, level: e.paid, heavy: e.paid >= e.cost },
      });
    case 'payCancelled':
      return cue('payCancelled', e.x, { priority: 1, key: `payCancelled:${e.playerId}`, minInterval: 0.25, params: { level: e.refunded } });
    case 'purchase':
      // Truhe/Ablegen haben eigene, deutlichere Klänge
      if (e.action === 'openChest' || e.action === 'embark') return null;
      return cue('purchase', e.x, { priority: 2, key: 'chord', minInterval: 0.18, reverb: 0.2, params: { variant: e.action, level: e.cost } });
    case 'buildStart':
      // teilt den Schlüssel mit „purchase": nur ein Akkord pro Kauf
      return cue('buildStart', e.x, { priority: 1, key: 'chord', minInterval: 0.25, reverb: 0.15, params: { variant: e.kind, level: e.toLevel } });
    case 'toolStocked':
      return cue('toolStocked', e.x, { priority: 1, minInterval: 0.15, params: { variant: e.tool } });
    case 'buildComplete':
      return cue('buildComplete', e.x, {
        priority: 2,
        key: `buildComplete:${e.structureId}`,
        minInterval: 0.4,
        reverb: 0.25,
        params: { variant: e.kind, level: e.level },
      });
    case 'hammer':
      return cue('hammer', e.x, { priority: 0, minInterval: 0.07, burst: 9, gain: 0.85 });
    case 'repaired':
      return cue('repaired', e.x, { priority: 1, key: `repaired:${e.structureId}`, minInterval: 0.5 });
    case 'recruit':
      return cue('recruit', e.x, { priority: 1, key: 'bell', minInterval: 0.2, reverb: 0.3 });
    case 'roleChange':
      return cue('roleChange', e.x, { priority: 1, key: 'bell', minInterval: 0.2, reverb: 0.3, params: { variant: e.role } });
    case 'vagrantSpawn':
      return cue('vagrantSpawn', e.x, { priority: 0, minInterval: 1, gain: 0.6 });
    case 'harvest':
      return cue('harvest', e.x, { priority: 0, minInterval: 0.2 });
    case 'arrowFired':
      return cue('arrowFired', e.x, { priority: 0, minInterval: 0.06, burst: 8, gain: 0.8 });
    case 'arrowHit':
      return cue('arrowHit', e.x, { priority: 0, key: `arrowHit:${e.target}`, minInterval: 0.05, burst: 8, params: { variant: e.target } });
    case 'rabbitKilled':
      return cue('coinPop', e.x, { priority: 0, minInterval: 0.1, gain: 0.7 });
    case 'enemySpawn':
      return cue('enemySpawn', e.x, {
        space: 'far',
        priority: 1,
        key: `enemySpawn:${e.side}`,
        minInterval: 1.2,
        reverb: 0.35,
        params: { heavy: e.kind === 'breaker' },
      });
    case 'enemyHit':
      return cue('enemyHit', e.x, { priority: 0, minInterval: 0.06, burst: 10, params: { heavy: e.kind === 'breaker' } });
    case 'enemyDied':
      return cue('enemyDied', e.x, { priority: 1, minInterval: 0.08, burst: 8, reverb: 0.2, params: { heavy: e.kind === 'breaker' } });
    case 'enemyEscaped':
      if (!e.carrying) return null;
      return cue('enemyEscaped', e.x, { priority: 1, minInterval: 0.5, params: { variant: e.carrying } });
    case 'enemiesDissolved': {
      if (e.count <= 0) return null;
      // nächstgelegene aufgelöste Position bestimmt die Richtung
      let x: number | null = null;
      let best = Infinity;
      for (const ex of e.xs) {
        const lx = nearestListener(ex, listeners);
        const d = lx === null ? 0 : Math.abs(ex - lx);
        if (d < best) {
          best = d;
          x = ex;
        }
      }
      return cue('enemiesDissolved', x, { space: 'far', priority: 2, minInterval: 1, reverb: 0.45, params: { level: e.count } });
    }
    case 'wallHit':
      return cue('wallHit', e.x, {
        priority: 1,
        key: `wallHit:${e.structureId}`,
        minInterval: 0.14,
        params: { ratio: e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 0 },
      });
    case 'wallDestroyed':
      return cue('wallDestroyed', e.x, { priority: 2, key: `wallDestroyed:${e.structureId}`, minInterval: 0.5, reverb: 0.3 });
    case 'playerHit':
      return cue('playerHit', e.x, { priority: 3, key: `playerHit:${e.playerId}`, minInterval: 0.3, params: { level: e.coinsLost } });
    case 'citizenHit':
      return cue('citizenHit', e.x, { priority: 2, minInterval: 0.15, params: { variant: e.role } });
    case 'crownLost':
      return cue('crownLost', e.x, { space: 'global', priority: 3, minInterval: 1, reverb: 0.5 });
    case 'phaseChange':
      switch (e.phase) {
        case 'dawn':
          return cue('dawnBirds', null, { space: 'global', priority: 2, key: 'phase', minInterval: 1, reverb: 0.3 });
        case 'night':
          return cue('nightGong', null, { space: 'global', priority: 3, key: 'phase', minInterval: 1, reverb: 0.6 });
        case 'day':
          return cue('dayChime', null, { space: 'global', priority: 2, key: 'phase', minInterval: 1, reverb: 0.4, params: { level: e.day } });
        case 'dusk':
          return cue('duskBell', null, { space: 'global', priority: 2, key: 'phase', minInterval: 1, reverb: 0.5 });
      }
      return null;
    case 'nightWarning':
      return cue('nightWarning', null, {
        space: 'global',
        priority: 3,
        minInterval: 2,
        reverb: 0.55,
        params: { heavy: e.paleMoon, level: e.day },
      });
    case 'chestOpened':
      return cue('chestOpened', e.x, { priority: 2, key: `chest:${e.structureId}`, minInterval: 0.4, reverb: 0.35, params: { level: e.coins } });
    case 'shrineActivated':
      return cue('shrineActivated', e.x, { priority: 2, minInterval: 0.6, reverb: 0.6, params: { variant: e.shrine } });
    case 'shipStage':
      return cue('shipStage', e.x, { priority: 2, minInterval: 0.6, reverb: 0.3, params: { level: e.level } });
    case 'victory':
      return cue('victory', e.x, { space: 'global', priority: 3, minInterval: 3, reverb: 0.4 });
    case 'defeat':
      return cue('defeat', e.x, { space: 'global', priority: 3, minInterval: 3, reverb: 0.55 });
  }
  return null;
}

/** UI-Klänge (Menüs): immer mittig, eigene Drosselung. */
export function uiCue(kind: 'click' | 'open' | 'close' | 'error' | 'start'): SoundCue {
  const id: SfxId = kind === 'click' ? 'uiClick' : kind === 'open' ? 'uiOpen' : kind === 'close' ? 'uiClose' : kind === 'error' ? 'uiError' : 'uiStart';
  return cue(id, null, { space: 'global', priority: 3, key: `ui:${kind}`, minInterval: kind === 'click' ? 0.04 : 0.08, reverb: 0.08 });
}
