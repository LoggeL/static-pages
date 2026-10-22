// Crownward – Debug-/Test-API unter window.__crownward (immer verfügbar, u. a. für Playwright).

import type { GameState, PlayerInput, SimEvent } from '../sim';
import type { AssetReport } from '../render';
import { audioStats, type AudioSettings, type AudioStats } from '../audio';
import type { Screen } from '../ui';
import type { App } from './app';
import { APP_VERSION } from './app';
import { loopErrors, MAX_TIME_SCALE, MIN_TIME_SCALE } from './loop';
import { validSlot } from './storage';

export interface CrownwardDebug {
  version: string;
  screen(): Screen;
  /** Live-Spielzustand (nicht kopiert) oder null im Titel */
  state(): GameState | null;
  /** startet direkt ins Spiel (ohne Titelmenü) */
  newGame(opts?: { coop?: boolean; seed?: number }): void;
  /** Zeitraffer 1..64 */
  setTimeScale(n: number): void;
  timeScale(): number;
  /** rechnet synchron Simulationsschritte mit der aktuell gehaltenen Eingabe (auch in der Pause) */
  advance(seconds: number): SimEvent[];
  /** überschreibt die Eingabe eines Spielers; null = Override aus */
  setHeld(playerIndex: number, input: Partial<PlayerInput> | null): void;
  /** aktuell wirksame Eingabe eines Spielers */
  input(playerIndex: number): PlayerInput;
  pause(): void;
  resume(): void;
  save(slot?: string): boolean;
  load(slot?: string): boolean;
  assetReport(): AssetReport & { titleArt: string; assetError: string | null; renderer: boolean };
  recentEvents(n?: number): SimEvent[];
  /** aktuelle Kontexthinweise je Spieler (deutscher Text) */
  hints(): string[];
  /** sichtbare Steuerungs-Einführung von Spieler 1 (leer, wenn keine) */
  intro(): string;
  /** Titelmenü: Koop wählbar (Tastatur/Gamepad vorhanden oder kein reines Touch-Gerät) */
  coopAvailable(): boolean;
  /** sichtbare Hinweise (Toasts) */
  toasts(): string[];
  /** offenes Overlay ('help' | 'settings' | null) */
  overlay(): string | null;
  /** aufgetretene Laufzeitfehler in Simulation/Renderer/Audio */
  errors(): string[];
  /** Menü-/Systemaktion auslösen wie per Taste (z. B. 'help', 'mute', 'quicksave') */
  action(a: string): void;
  fps(): number;
  /** Audiozustand: 'locked' = noch kein AudioContext (vor der ersten Nutzergeste) */
  audio(): DebugAudio;
}

export interface DebugAudio {
  /** AudioContext-Zustand: locked | suspended | running | closed | unsupported */
  state: string;
  unlocked: boolean;
  /** von der Engine verwendete Einstellungen */
  settings: AudioSettings | null;
  /** aktueller Wert der Master-Verstärkung (0 bei Stumm), null ohne AudioContext */
  masterGain: number | null;
  stats: AudioStats | null;
}

declare global {
  interface Window {
    __crownward: CrownwardDebug;
  }
}

export function installDebug(app: App): CrownwardDebug {
  const api: CrownwardDebug = {
    version: APP_VERSION,
    screen: () => app.screen,
    state: () => app.game,
    newGame: (opts = {}) => app.newGame({ coop: !!opts.coop, seed: opts.seed }),
    setTimeScale: (n) => {
      app.loop.timeScale = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, Number(n) || 1));
    },
    timeScale: () => app.loop.timeScale,
    advance: (seconds) => {
      const g = app.game;
      if (!g || !(seconds > 0)) return [];
      return app.loop.advance(g, seconds);
    },
    setHeld: (i, input) => app.input.setOverride(i, input),
    input: (i) => app.input.playerInput(i),
    pause: () => app.pause(),
    resume: () => {
      if (app.overlay) app.closeOverlay();
      app.resume();
    },
    save: (slot = 'slot1') => validSlot(slot) && app.saveTo(slot, 'silent'),
    load: (slot = 'slot1') => validSlot(slot) && app.loadFrom(slot, 'silent'),
    assetReport: () => {
      let base: AssetReport = { loaded: [], missing: [] };
      try {
        if (app.renderer) base = app.renderer.assetReport();
      } catch {
        /* Renderer noch unvollständig */
      }
      return { ...base, titleArt: app.ui.title.artState, assetError: app.assetError, renderer: !!app.renderer };
    },
    recentEvents: (n = 50) => app.recentEvents(n),
    hints: () => app.hintTexts(),
    intro: () => app.ui.hud.introText(),
    coopAvailable: () => app.input.coopAvailable,
    toasts: () => app.ui.toasts.visibleTexts(),
    overlay: () => app.overlay,
    errors: () => [...loopErrors],
    action: (a) => app.onAction(a as Parameters<App['onAction']>[0]),
    fps: () => Math.round(app.loop.fps),
    audio: () => {
      const stats = audioStats(app.audio);
      // Engine-Interna nur lesend (Test-Hilfe); fehlende Felder → null
      const eng = app.audio as unknown as { getSettings?: () => AudioSettings; mixer?: { master?: GainNode } | null };
      const gain = eng.mixer?.master?.gain.value;
      return {
        state: stats?.state ?? (app.audio.unlocked ? 'running' : 'locked'),
        unlocked: app.audio.unlocked,
        settings: typeof eng.getSettings === 'function' ? eng.getSettings() : null,
        masterGain: typeof gain === 'number' ? gain : null,
        stats,
      };
    },
  };
  window.__crownward = api;
  return api;
}
