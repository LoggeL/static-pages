// Crownward – öffentliche Renderer-API (Vertrag: src/render/types.ts).
// loadAssets lädt Atlas + Bilder (fehlende Dateien → Platzhalter, kein Absturz),
// createRenderer baut den Canvas-2D-Renderer.
import type { LoadedAssets, Renderer } from './types';
import { CanvasRenderer } from './renderer';

export type { AssetReport, LoadedAssets, RenderFrame, Renderer } from './types';
export { loadAssets } from './assets';

export function createRenderer(canvas: HTMLCanvasElement, assets: LoadedAssets): Renderer {
  return new CanvasRenderer(canvas, assets);
}
