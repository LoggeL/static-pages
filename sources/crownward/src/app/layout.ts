// Crownward – Bildschirmaufteilung. Querformat: Canvas füllt das Fenster, HUD und Touch-Tasten liegen darüber.
// Hochformat/schmal: Canvas oben in 16:9, darunter ein Dock mit HUD und Touch-Steuerung.

export type LayoutMode = 'landscape' | 'portrait';

/** Hochformat, sobald das Fenster deutlich höher als breit ist. */
export function layoutModeFor(width: number, height: number): LayoutMode {
  return height > width * 1.05 ? 'portrait' : 'landscape';
}

export class LayoutController {
  mode: LayoutMode;
  private observer: ResizeObserver | null = null;
  private lastKey = '';

  constructor(
    private readonly app: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    /** Canvas-Größe in CSS-Pixeln + devicePixelRatio */
    private readonly onResize: (cssW: number, cssH: number, dpr: number) => void,
    private readonly onMode: (mode: LayoutMode) => void,
  ) {
    this.mode = layoutModeFor(window.innerWidth, window.innerHeight);
    this.applyMode();
  }

  attach(): void {
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('orientationchange', this.onWindowResize);
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.stage);
    }
    this.measure();
  }

  /** Erzwingt eine neue Messung (z. B. nachdem der Renderer erzeugt wurde). */
  refresh(): void {
    this.lastKey = '';
    this.measure();
  }

  private onWindowResize = (): void => {
    const m = layoutModeFor(window.innerWidth, window.innerHeight);
    if (m !== this.mode) {
      this.mode = m;
      this.applyMode();
    }
    this.measure();
  };

  private applyMode(): void {
    this.app.classList.toggle('layout-portrait', this.mode === 'portrait');
    this.app.classList.toggle('layout-landscape', this.mode === 'landscape');
    this.onMode(this.mode);
  }

  private measure(): void {
    const r = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const key = `${w}x${h}@${dpr}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    // Backbuffer passend zur Anzeige; der Renderer darf in resize() eigene Werte setzen.
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.onResize(w, h, dpr);
  }
}
