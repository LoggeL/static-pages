// Crownward – Audio-Vertrag (Eigentum: Integrations-Lead). Implementierung: src/audio/** (Agent audio).
// Regeln: Kein AudioContext vor unlock() (Nutzergeste). Stumm-Schalter und Lautstärken werden strikt beachtet.
import type { GameState, SimEvent } from '../sim';

export interface AudioSettings {
  /** 0..1 */
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export type UiSound = 'click' | 'open' | 'close' | 'error' | 'start';

export interface AudioEngine {
  /** Aus einer Nutzergeste heraus aufrufen; erzeugt/resumed erst dann den AudioContext. Mehrfachaufruf ist harmlos. */
  unlock(): void;
  readonly unlocked: boolean;
  setSettings(s: AudioSettings): void;
  /** Klänge zu Simulationsereignissen; state liefert Hörerposition (Spieler) für Stereo/Abstand. */
  handleEvents(events: readonly SimEvent[], state: GameState): void;
  /** Pro Frame: Ambiente/Musik nach Tageszeit; state = null im Titelmenü. */
  update(state: GameState | null, dt: number, paused: boolean): void;
  uiSound(kind: UiSound): void;
}
