// Crownward – Renderer-Vertrag (Eigentum: Integrations-Lead). Implementierung: src/render/** (Agent render).
import type { GameState, SimEvent } from '../sim';

export interface RenderFrame {
  /** Echtzeit in Sekunden (Animationen/Partikel/Wasser laufen auch in der Pause weich weiter) */
  time: number;
  /** Echtzeit-Delta dieses Frames in Sekunden */
  dt: number;
  /** Koop-Splitscreen: obere Hälfte folgt Spieler 1, untere Spieler 2 */
  split: boolean;
  /** Spiel pausiert (Renderer darf z. B. abdunkeln/Partikel einfrieren) */
  paused: boolean;
}

export interface AssetReport {
  loaded: string[];
  missing: string[];
}

export interface Renderer {
  /** Canvas-Größe in CSS-Pixeln + devicePixelRatio; legt die logische Auflösung fest (Höhe 360). */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  /** Ereignisse eines oder mehrerer Simulationsschritte (Partikel, Kamerawackeln, Lichtblitze). */
  handleEvents(events: readonly SimEvent[], state: GameState): void;
  render(state: GameState, frame: RenderFrame): void;
  /** Kamera sofort auf die Spieler setzen (neues Spiel / Laden). */
  snapCamera(state: GameState): void;
  assetReport(): AssetReport;
}

/** Geladene Bilder + Atlas (siehe src/shared/sprites.ts). */
export interface LoadedAssets {
  atlas: import('../shared/sprites').Atlas | null;
  images: Map<string, HTMLImageElement>;
  missing: string[];
}
