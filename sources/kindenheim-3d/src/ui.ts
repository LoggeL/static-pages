import type { ResolvedReferenceShot } from './benchmarkOverlay';
import type { TourCheckpoint, TourStateSnapshot } from './game';
import type { TractorTelemetry } from './tractor';
import { isQualityChoice, type QualityChoice, type QualityLevel } from './renderQuality';
import type { BenchmarkLayout, CameraMode, LoadStage, TimeOfDayPreset } from './types';
import { resolveAssetUrl } from './url';
import { isFormControlTarget } from './camera';
import { initTouchControls, setTouchControlsVisible } from './touchControls';

/** The first fatal message shown on the overlay; once set, nothing may replace or hide it (see showFatal). */
let fatalMessage: string | null = null;

/** True once a fatal error is on screen: loading progress and the overlay fade-out are switched off. */
export function isFatalShown(): boolean {
  return fatalMessage !== null;
}

/**
 * Shows a fatal problem on the loading overlay (brought back if it was already hidden) and latches it: later
 * progress updates, the fade-out timer and further fatal errors cannot overwrite it. Further fatal errors are
 * usually consequences of the first one; they still reach the console.
 */
export function showFatal(message: string): void {
  if (fatalMessage !== null) {
    console.error('[Kindenheim 3D] Another fatal error (the overlay keeps showing the first one):', message);
    return;
  }
  fatalMessage = message;
  const overlay = document.getElementById('loading-overlay');
  const status = document.getElementById('loading-status');
  if (!overlay || !status) {
    // index.html always ships both elements; without them the only place left to be loud is the page itself
    document.body.textContent = message;
    return;
  }
  overlay.classList.remove('hidden', 'fade-out');
  overlay.classList.add('fatal');
  status.setAttribute('role', 'alert');
  status.textContent = message;
}

/**
 * Fail loud for problems that surface after start-up (an image that does not load, a broken data file):
 * the message goes onto the loading overlay, which is brought back over the scene, and an Error is thrown
 * so the console shows the stack as well. Never returns.
 */
export function failLoud(message: string): never {
  showFatal(`Fehler: ${message}`);
  throw new Error(message);
}

/** Loads an image and fails loudly (overlay + exception) with the URL if it cannot be loaded. */
export function loadRequiredImage(url: string, purpose: string, onLoad: (img: HTMLImageElement) => void): void {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (img.naturalWidth === 0) failLoud(`${url} decoded to an empty image (${purpose})`);
    onLoad(img);
  };
  img.onerror = () => failLoud(`${url} could not be loaded (${purpose})`);
  img.src = url;
}

export interface UIHandlers {
  onTimeOfDay: (preset: TimeOfDayPreset) => void;
  onCameraMode: (mode: CameraMode) => void;
  onBookmark: (index: number) => void;
  onToggleBenchmarkMode: (enabled: boolean) => void;
  onBenchmarkLayout: (layout: BenchmarkLayout) => void;
  onSelectReferenceShot: (index: number) => void;
  onAlignToCurrentRef: () => void;
  onSunAngles: (elevDeg: number, azimDeg: number) => void;
  onQuality: (choice: QualityChoice) => void;
  onWireframe: (enabled: boolean) => void;
  onShadows: (enabled: boolean) => void;
  onRoadsToggle: (enabled: boolean) => void;
  onPinsToggle: (enabled: boolean) => void;
  onArrowToggle: (enabled: boolean) => void;
  onMinimapClick: (clientX: number, clientY: number) => void;
  onToggleLights: () => void;
  onToggleBeacon: () => void;
  onToggleTrailer: () => void;
  onHornStart: () => void;
  onHornEnd: () => void;
  onToggleMute: () => void;
  onResetTractor: () => void;
  onRestartTour: () => void;
}

const STAGE_ORDER: LoadStage[] = ['terrain', 'orthophoto', 'buildings', 'scenery'];

function formatMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export class UIController {
  private readonly loadingOverlay = document.getElementById('loading-overlay')!;
  private readonly loadingBarFill = document.getElementById('loading-bar-fill')!;
  private readonly loadingStatus = document.getElementById('loading-status')!;
  private readonly hudStats = document.getElementById('hud-stats')!;
  private readonly benchmarkPanel = document.getElementById('benchmark-panel')!;
  private readonly btnBenchmark = document.getElementById('btn-benchmark-mode')!;
  private readonly btnSettings = document.getElementById('btn-settings')!;
  private readonly settingsPopover = document.getElementById('settings-popover')!;
  private readonly sliderSunElev = document.getElementById('slider-sun-elev') as HTMLInputElement;
  private readonly sliderSunAzim = document.getElementById('slider-sun-azim') as HTMLInputElement;
  private readonly valSunElev = document.getElementById('val-sun-elev')!;
  private readonly valSunAzim = document.getElementById('val-sun-azim')!;
  private readonly chkWireframe = document.getElementById('chk-wireframe') as HTMLInputElement;
  private readonly chkShadows = document.getElementById('chk-shadows') as HTMLInputElement;
  private readonly chkRoads = document.getElementById('chk-roads') as HTMLInputElement;
  private readonly chkPins = document.getElementById('chk-pins') as HTMLInputElement;
  private readonly chkArrow = document.getElementById('chk-arrow') as HTMLInputElement;
  private readonly selQuality = document.getElementById('sel-quality') as HTMLSelectElement;
  private readonly valQuality = document.getElementById('val-quality')!;
  private readonly imageryCredit = document.getElementById('imagery-credit')!;

  private readonly compareStage = document.getElementById('compare-stage')!;
  private readonly compareStageImg = document.getElementById('compare-stage-img') as HTMLImageElement;
  private readonly compareDiffCanvas = document.getElementById('compare-diff-canvas') as HTMLCanvasElement;
  private readonly compareDiffCtx = this.compareDiffCanvas.getContext('2d')!;
  private readonly compareDivider = document.getElementById('compare-divider')!;
  private readonly compareTagLeft = document.getElementById('compare-tag-left')!;
  private readonly compareRange = document.getElementById('compare-range') as HTMLInputElement;
  private readonly compareRangeVal = document.getElementById('compare-range-val')!;
  private readonly compareSliderLabel = document.getElementById('compare-slider-label')!;
  private readonly benchmarkScoreBanner = document.getElementById('benchmark-score-banner')!;
  private readonly benchmarkScoreTitle = document.getElementById('benchmark-score-title')!;
  private readonly benchmarkScoreVals = document.getElementById('benchmark-score-vals')!;
  private readonly hudRoot = document.getElementById('hud')!;

  private readonly diffOff3d = document.createElement('canvas');
  private readonly diffOffRef = document.createElement('canvas');
  private readonly diffOffOut = document.createElement('canvas');
  private diffSummaryLoaded = false;

  private readonly refPreviewBox = document.getElementById('ref-preview-box')!;
  private readonly refPreviewImg = document.getElementById('ref-preview-img') as HTMLImageElement;
  private readonly refSourceBadge = document.getElementById('ref-source-badge')!;
  private readonly refAngleBadge = document.getElementById('ref-angle-badge')!;
  private readonly refTitle = document.getElementById('ref-title')!;
  private readonly refNotes = document.getElementById('ref-notes')!;
  private readonly refMetaCard = document.getElementById('ref-meta-card')!;
  private readonly refEmptyMsg = document.getElementById('ref-empty-msg')!;
  private readonly refCount = document.getElementById('ref-count')!;
  private readonly refShotList = document.getElementById('ref-shot-list')!;

  // Tractor Game HUD elements
  private readonly driveMinimapBox = document.getElementById('drive-minimap-box')!;
  private readonly driveMinimapCanvas = document.getElementById('drive-minimap') as HTMLCanvasElement;
  private readonly driveMinimapCtx = this.driveMinimapCanvas.getContext('2d')!;
  private readonly driveMinimapCoords = document.getElementById('drive-minimap-coords')!;
  private readonly driveControlsDock = document.getElementById('drive-controls-dock')!;
  private readonly bookmarkDock = document.getElementById('bookmark-dock')!;
  private readonly tachoCard = document.getElementById('tacho-card')!;
  private readonly tachoKmh = document.getElementById('tacho-kmh')!;
  private readonly tachoGear = document.getElementById('tacho-gear')!;
  private readonly tachoRpm = document.getElementById('tacho-rpm')!;
  private readonly rpmFill = document.getElementById('rpm-fill')!;
  private readonly indLights = document.getElementById('ind-lights')!;
  private readonly indBeacon = document.getElementById('ind-beacon')!;
  private readonly indTrailer = document.getElementById('ind-trailer')!;

  private readonly btnLights = document.getElementById('btn-lights')!;
  private readonly btnBeacon = document.getElementById('btn-beacon')!;
  private readonly btnTrailer = document.getElementById('btn-trailer')!;
  private readonly btnHorn = document.getElementById('btn-horn')!;
  private readonly btnMute = document.getElementById('btn-mute')!;
  private readonly btnReset = document.getElementById('btn-reset')!;

  private readonly tourCard = document.getElementById('tour-card')!;
  private readonly tourProgressBadge = document.getElementById('tour-progress-badge')!;
  private readonly tourTargetName = document.getElementById('tour-target-name')!;
  private readonly tourDist = document.getElementById('tour-dist')!;
  private readonly tourTimer = document.getElementById('tour-timer')!;
  private readonly tourKm = document.getElementById('tour-km')!;
  private readonly tourToast = document.getElementById('tour-toast')!;

  public readonly minimapCanvas = document.getElementById('benchmark-minimap') as HTMLCanvasElement;

  private benchmarkActive = false;
  private cameraMode: CameraMode = 'chase';
  private layout: BenchmarkLayout = 'pip';
  private compareValue = 50;
  private hasRefs = false;
  private driveOrthoImg: HTMLImageElement | null = null;
  private toastTimeout: number | null = null;

  /** Reference photo chosen while the benchmark panel was closed; loaded only once the panel opens. */
  private pendingReferenceFile: string | null = null;

  constructor(private readonly handlers: UIHandlers) {
    initTouchControls({
      onToggleLights: () => this.handlers.onToggleLights(),
      onHornStart: () => this.handlers.onHornStart(),
      onHornEnd: () => this.handlers.onHornEnd(),
    });
    this.bindControls();
    this.bindReferenceImageErrors();
    this.loadDriveMinimapImage();
    this.syncHudLayoutVisibility();
  }

  private loadDriveMinimapImage(): void {
    loadRequiredImage(resolveAssetUrl('data/terrain/orthophoto.jpg'), 'aerial image for the driving minimap', (img) => {
      this.driveOrthoImg = img;
    });
  }

  /** The reference photos are listed in the shipped manifest: one that does not load is a broken build. */
  private bindReferenceImageErrors(): void {
    for (const img of [this.refPreviewImg, this.compareStageImg]) {
      img.addEventListener('error', () => {
        // An <img> without src (benchmark never opened) never fires; anything else is a real failure.
        if (!img.getAttribute('src')) return;
        failLoud(`reference photo ${img.getAttribute('src')} could not be loaded (Realität vs. 3D)`);
      });
    }
  }

  private bindControls(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-tod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.tod as TimeOfDayPreset;
        this.setActiveTimeOfDay(preset);
        this.handlers.onTimeOfDay(preset);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-cam-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.camMode as CameraMode;
        this.setActiveCameraMode(mode);
        this.handlers.onCameraMode(mode);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-bm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.bm);
        this.setActiveBookmark(idx);
        this.handlers.onBookmark(idx);
      });
    });

    this.btnBenchmark.addEventListener('click', () => {
      this.setBenchmarkMode(!this.benchmarkActive);
      this.handlers.onToggleBenchmarkMode(this.benchmarkActive);
    });

    document.getElementById('btn-benchmark-close')?.addEventListener('click', () => {
      this.setBenchmarkMode(false);
      this.handlers.onToggleBenchmarkMode(false);
    });

    document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextLayout = btn.dataset.layout as BenchmarkLayout;
        this.setBenchmarkLayout(nextLayout);
        this.handlers.onBenchmarkLayout(nextLayout);
      });
    });

    document.getElementById('btn-align-cam')?.addEventListener('click', () => {
      this.handlers.onAlignToCurrentRef();
    });

    document.getElementById('btn-tour-restart')?.addEventListener('click', () => {
      this.handlers.onRestartTour();
    });

    // Driving control dock buttons
    this.btnLights.addEventListener('click', () => this.handlers.onToggleLights());
    this.btnBeacon.addEventListener('click', () => this.handlers.onToggleBeacon());
    this.btnTrailer.addEventListener('click', () => this.handlers.onToggleTrailer());
    this.btnMute.addEventListener('click', () => this.handlers.onToggleMute());
    this.btnReset.addEventListener('click', () => this.handlers.onResetTractor());

    this.btnHorn.addEventListener('pointerdown', () => {
      this.btnHorn.classList.add('active');
      this.handlers.onHornStart();
    });
    const endHorn = () => {
      this.btnHorn.classList.remove('active');
      this.handlers.onHornEnd();
    };
    this.btnHorn.addEventListener('pointerup', endHorn);
    this.btnHorn.addEventListener('pointerleave', endHorn);
    this.btnHorn.addEventListener('pointercancel', endHorn);

    this.compareRange.addEventListener('input', () => {
      this.compareValue = Number(this.compareRange.value);
      this.applyCompareVisuals();
    });

    let draggingDivider = false;
    this.compareDivider.addEventListener('pointerdown', (e) => {
      draggingDivider = true;
      e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      if (!draggingDivider) return;
      const pct = Math.round(Math.min(100, Math.max(0, (e.clientX / window.innerWidth) * 100)));
      this.compareValue = pct;
      this.compareRange.value = String(pct);
      this.applyCompareVisuals();
    });
    window.addEventListener('pointerup', () => {
      draggingDivider = false;
    });

    this.btnSettings.addEventListener('click', () => {
      this.settingsPopover.classList.toggle('hidden');
      this.btnSettings.classList.toggle('active');
    });

    const onSliderInput = () => {
      const elev = Number(this.sliderSunElev.value);
      const azim = Number(this.sliderSunAzim.value);
      this.valSunElev.textContent = `${elev}°`;
      this.valSunAzim.textContent = `${azim}°`;
      this.handlers.onSunAngles(elev, azim);
    };
    this.sliderSunElev.addEventListener('input', onSliderInput);
    this.sliderSunAzim.addEventListener('input', onSliderInput);

    this.chkWireframe.addEventListener('change', () => this.handlers.onWireframe(this.chkWireframe.checked));
    this.chkShadows.addEventListener('change', () => this.handlers.onShadows(this.chkShadows.checked));
    this.chkRoads.addEventListener('change', () => this.handlers.onRoadsToggle(this.chkRoads.checked));
    this.chkPins.addEventListener('change', () => this.handlers.onPinsToggle(this.chkPins.checked));
    this.chkArrow.addEventListener('change', () => this.handlers.onArrowToggle(this.chkArrow.checked));
    this.selQuality.addEventListener('change', () => {
      const choice = this.selQuality.value;
      if (!isQualityChoice(choice)) throw new Error(`[UI] Unknown quality option "${choice}" in #sel-quality`);
      this.handlers.onQuality(choice);
    });

    // A settings control keeps keyboard focus after use: Space would toggle the checkbox again and the
    // drive keys would go to the slider / drop-down. Hand the keyboard back to the game once a value is set.
    const releaseFocus = (e: Event): void => {
      const el = e.currentTarget as HTMLElement;
      el.blur();
    };
    for (const el of [
      this.sliderSunElev,
      this.sliderSunAzim,
      this.chkWireframe,
      this.chkShadows,
      this.chkRoads,
      this.chkPins,
      this.chkArrow,
      this.selQuality,
      this.compareRange,
    ]) {
      el.addEventListener('change', releaseFocus);
    }
    // Sliders also get focus from a plain click without a change; let go when the pointer is released.
    for (const el of [this.sliderSunElev, this.sliderSunAzim, this.compareRange]) {
      el.addEventListener('pointerup', releaseFocus);
    }
    // Clicking into the 3D view always hands the keyboard back to driving.
    document.getElementById('scene-canvas')?.addEventListener('pointerdown', () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    });
    // Buttons (time of day, camera, dock) must not keep focus either: Space would "click" them again.
    this.hudRoot.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest('button');
      if (btn) btn.blur();
    });

    this.minimapCanvas.addEventListener('click', (e) => {
      this.handlers.onMinimapClick(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => {
      if (isFormControlTarget(e.target)) return;
      if (e.repeat && e.code !== 'KeyH') return;

      if (e.key >= '1' && e.key <= '7') {
        const idx = Number(e.key) - 1;
        this.setActiveBookmark(idx);
        this.handlers.onBookmark(idx);
      } else if (e.code === 'KeyV') {
        this.setBenchmarkMode(!this.benchmarkActive);
        this.handlers.onToggleBenchmarkMode(this.benchmarkActive);
      } else if (e.code === 'KeyC') {
        const order: CameraMode[] = ['chase', 'cab', 'drone'];
        const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
        this.setActiveCameraMode(next);
        this.handlers.onCameraMode(next);
      } else if (e.code === 'KeyL') {
        this.handlers.onToggleLights();
      } else if (e.code === 'KeyB') {
        this.handlers.onToggleBeacon();
      } else if (e.code === 'KeyT') {
        this.handlers.onToggleTrailer();
      } else if (e.code === 'KeyM') {
        this.handlers.onToggleMute();
      } else if (e.code === 'KeyR') {
        this.handlers.onResetTractor();
      } else if (e.code === 'KeyH') {
        this.btnHorn.classList.add('active');
        this.handlers.onHornStart();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyH') {
        this.btnHorn.classList.remove('active');
        this.handlers.onHornEnd();
      }
    });
  }

  public setLoadingProgress(stage: LoadStage, percent: number, statusText: string): void {
    // A fatal error is final: jobs still finishing in the background must not paint progress over it.
    if (isFatalShown()) return;
    this.loadingBarFill.style.width = `${Math.min(100, Math.max(4, percent))}%`;
    this.loadingStatus.textContent = statusText;

    const currentIdx = STAGE_ORDER.indexOf(stage);
    document.querySelectorAll<HTMLElement>('.loading-step').forEach((el) => {
      const s = el.dataset.stage as LoadStage;
      const idx = STAGE_ORDER.indexOf(s);
      el.classList.toggle('done', idx < currentIdx || percent >= 100);
      el.classList.toggle('active', idx === currentIdx && percent < 100);
    });
  }

  public hideLoadingOverlay(): void {
    if (isFatalShown()) return;
    this.setLoadingProgress('scenery', 100, 'Kindenheim 3D bereit');
    this.loadingOverlay.classList.add('fade-out');
    window.setTimeout(() => {
      // a fatal error (e.g. WebGL context loss) during the fade keeps the overlay up
      if (!isFatalShown()) this.loadingOverlay.classList.add('hidden');
    }, 420);
  }

  public setStatsText(text: string): void {
    this.hudStats.textContent = text;
  }

  public setActiveTimeOfDay(preset: TimeOfDayPreset): void {
    document.querySelectorAll<HTMLButtonElement>('[data-tod]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tod === preset);
    });
  }

  /** Reflects the active render quality in the settings panel ("auto" also shows what it resolved to). */
  public setQualityChoice(choice: QualityChoice, resolved: QualityLevel): void {
    const labels: Record<QualityLevel, string> = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' };
    this.selQuality.value = choice;
    this.valQuality.textContent = choice === 'auto' ? `Auto: ${labels[resolved]}` : labels[resolved];
  }

  /** Licence credit of the aerial imagery (© GeoBasis-DE / LVermGeoRP, dl-de/by-2-0), shown in the settings panel. */
  public setImageryAttribution(text: string): void {
    if (!text) throw new Error('[UI] setImageryAttribution: empty attribution text');
    this.imageryCredit.textContent = `Luftbild: ${text}`;
    this.imageryCredit.classList.remove('hidden');
  }

  public syncSunSliders(elevDeg: number, azimDeg: number): void {
    this.sliderSunElev.value = String(Math.round(elevDeg));
    this.sliderSunAzim.value = String(Math.round(azimDeg));
    this.valSunElev.textContent = `${Math.round(elevDeg)}°`;
    this.valSunAzim.textContent = `${Math.round(azimDeg)}°`;
  }

  private syncHudLayoutVisibility(): void {
    const isDriving = this.cameraMode !== 'drone';
    const showDrivingHud = isDriving && !this.benchmarkActive;

    this.driveMinimapBox.classList.toggle('hidden', !showDrivingHud);
    this.driveControlsDock.classList.toggle('hidden', !showDrivingHud);
    this.tachoCard.classList.toggle('hidden', !showDrivingHud);
    setTouchControlsVisible(showDrivingHud);
    this.tourCard.classList.toggle('hidden', this.benchmarkActive);
    this.bookmarkDock.classList.toggle('hidden', isDriving && !this.benchmarkActive);
  }

  public setActiveCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    document.querySelectorAll<HTMLButtonElement>('[data-cam-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.camMode === mode);
    });
    this.syncHudLayoutVisibility();
  }

  public setActiveBookmark(index: number): void {
    document.querySelectorAll<HTMLButtonElement>('[data-bm]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.bm) === index);
    });
  }

  public setBenchmarkMode(enabled: boolean): void {
    this.benchmarkActive = enabled;
    this.btnBenchmark.classList.toggle('active', enabled);
    this.benchmarkPanel.classList.toggle('hidden', !enabled);
    this.syncHudLayoutVisibility();
    this.applyCompareVisuals();
    if (enabled && this.pendingReferenceFile) {
      this.applyReferenceImage(this.pendingReferenceFile);
      this.pendingReferenceFile = null;
    }
    if (enabled && !this.diffSummaryLoaded) {
      this.diffSummaryLoaded = true;
      void this.loadBenchmarkSummary();
    }
  }

  public setCleanCaptureMode(enabled: boolean): void {
    this.hudRoot.classList.toggle('clean-capture', enabled);
    if (enabled) {
      this.compareStage.classList.add('hidden');
    } else {
      this.applyCompareVisuals();
    }
  }

  public isDiffLayoutActive(): boolean {
    return this.benchmarkActive && this.hasRefs && this.layout === 'diff';
  }

  /**
   * The benchmark summary is optional content, but the build always ships the file (a stub with
   * `available: false` when no benchmark ran). A missing or unreadable file is therefore a broken build:
   * it is shown in the score banner and thrown, never skipped.
   */
  private async loadBenchmarkSummary(): Promise<void> {
    const url = resolveAssetUrl('data/benchmark/latest_summary.json');
    try {
      await this.loadBenchmarkSummaryFrom(url);
    } catch (err) {
      const message = `${url}: ${err instanceof Error ? err.message : String(err)}`;
      this.benchmarkScoreTitle.textContent = 'Benchmark-Zusammenfassung fehlerhaft';
      this.benchmarkScoreVals.textContent = message;
      this.benchmarkScoreBanner.classList.add('score-error');
      this.benchmarkScoreBanner.classList.remove('hidden');
      throw new Error(`[UI] benchmark summary ${message}`);
    }
  }

  private async loadBenchmarkSummaryFrom(url: string): Promise<void> {
    {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`answered HTTP ${res.status}`);
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`is not valid JSON (starts with "${text.slice(0, 40).replace(/\s+/g, ' ')}")`);
      }
      if (!data || typeof data !== 'object') throw new Error('is not a JSON object');
      if (data.available === false) return;

      const base = (data.baseline ?? data.before) as Record<string, number> | undefined;
      const latest = (data.latest ?? data.after ?? data.current) as Record<string, number> | undefined;
      const ssimB = base?.meanSsim ?? base?.mean_ssim ?? base?.ssim;
      const ssimA = latest?.meanSsim ?? latest?.mean_ssim ?? latest?.ssim;
      const deB = base?.meanLabDeltaE ?? base?.mean_lab_delta_e ?? base?.labDeltaE;
      const deA = latest?.meanLabDeltaE ?? latest?.mean_lab_delta_e ?? latest?.labDeltaE;
      const ecB = base?.meanEdgeCorr ?? base?.edgeCorr;
      const ecA = latest?.meanEdgeCorr ?? latest?.edgeCorr;

      const parts: string[] = [];
      if (typeof ssimB === 'number' && typeof ssimA === 'number') {
        parts.push(
          Math.abs(ssimA - ssimB) > 0.0005
            ? `SSIM ${ssimB.toFixed(3)} → ${ssimA.toFixed(3)}`
            : `SSIM ${ssimA.toFixed(3)}`
        );
      }
      if (typeof deB === 'number' && typeof deA === 'number') {
        parts.push(
          Math.abs(deA - deB) > 0.05 ? `ΔE ${deB.toFixed(1)} → ${deA.toFixed(1)}` : `ΔE ${deA.toFixed(1)}`
        );
      }
      if (typeof ecB === 'number' && typeof ecA === 'number') {
        parts.push(
          Math.abs(ecA - ecB) > 0.001 ? `Edge ${ecB.toFixed(2)} → ${ecA.toFixed(2)}` : `Edge ${ecA.toFixed(2)}`
        );
      }

      if (parts.length > 0) {
        const count =
          typeof latest?.shotCount === 'number'
            ? latest.shotCount
            : typeof data.shotCount === 'number'
              ? data.shotCount
              : Number(this.refCount.textContent) || 15;
        this.benchmarkScoreTitle.textContent = `${count}-Shot Benchmark (Vorher → Nachher)`;
        this.benchmarkScoreVals.textContent = parts.join(' · ');
        this.benchmarkScoreBanner.classList.remove('hidden');
      }
    }
  }

  public setBenchmarkLayout(layout: BenchmarkLayout): void {
    this.layout = layout;
    document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });
    if (layout === 'diff' && this.compareValue < 60) {
      this.compareValue = 82;
      this.compareRange.value = '82';
    }
    this.applyCompareVisuals();
  }

  private applyCompareVisuals(): void {
    const showStage =
      this.benchmarkActive &&
      this.hasRefs &&
      (this.layout === 'split' || this.layout === 'ghost' || this.layout === 'diff');
    this.compareStage.classList.toggle('hidden', !showStage);
    if (!showStage) return;

    this.compareRangeVal.textContent = `${this.compareValue}%`;
    this.compareStage.classList.remove('mode-split', 'mode-ghost', 'mode-diff');
    this.compareDiffCanvas.classList.toggle('hidden', this.layout !== 'diff');

    if (this.layout === 'split') {
      this.compareSliderLabel.textContent = 'Schnittlinie';
      this.compareTagLeft.textContent = 'REALITÄT · REFERENZ';
      this.compareStage.classList.add('mode-split');
      this.compareStageImg.style.opacity = '1';
      this.compareStageImg.style.clipPath = `inset(0 ${100 - this.compareValue}% 0 0)`;
      this.compareDivider.style.left = `${this.compareValue}%`;
    } else if (this.layout === 'ghost') {
      this.compareSliderLabel.textContent = 'Deckkraft';
      this.compareTagLeft.textContent = 'ÜBERLAGERUNG · REALITÄT';
      this.compareStage.classList.add('mode-ghost');
      this.compareStageImg.style.clipPath = 'none';
      this.compareStageImg.style.opacity = String(this.compareValue / 100);
    } else {
      this.compareSliderLabel.textContent = 'Heatmap';
      this.compareStage.classList.add('mode-diff');
      this.compareDiffCanvas.style.opacity = String(this.compareValue / 100);
    }
  }

  /**
   * Computes a real-time perceptual RGB error heatmap comparing the live Three.js WebGL canvas
   * against the currently loaded Kindenheim reference photo!
   */
  public renderLiveDiffHeatmap(sceneCanvas: HTMLCanvasElement): void {
    if (!this.isDiffLayoutActive()) return;
    const refImg = this.compareStageImg;
    if (!refImg.complete || refImg.naturalWidth < 16 || sceneCanvas.width < 16) return;

    const dw = 320;
    const dh = 200;
    if (this.diffOff3d.width !== dw) {
      this.diffOff3d.width = dw;
      this.diffOff3d.height = dh;
      this.diffOffRef.width = dw;
      this.diffOffRef.height = dh;
      this.diffOffOut.width = dw;
      this.diffOffOut.height = dh;
    }

    const ctx3d = this.diffOff3d.getContext('2d', { willReadFrequently: true })!;
    const ctxRef = this.diffOffRef.getContext('2d', { willReadFrequently: true })!;
    const ctxOut = this.diffOffOut.getContext('2d')!;

    ctx3d.drawImage(sceneCanvas, 0, 0, dw, dh);

    // Match CSS object-fit: cover crop for reference image
    const viewAspect = window.innerWidth / Math.max(1, window.innerHeight);
    const imgAspect = refImg.naturalWidth / Math.max(1, refImg.naturalHeight);
    let sx = 0;
    let sy = 0;
    let sw = refImg.naturalWidth;
    let sh = refImg.naturalHeight;
    if (imgAspect > viewAspect) {
      sw = refImg.naturalHeight * viewAspect;
      sx = (refImg.naturalWidth - sw) * 0.5;
    } else {
      sh = refImg.naturalWidth / viewAspect;
      sy = (refImg.naturalHeight - sh) * 0.5;
    }
    ctxRef.drawImage(refImg, sx, sy, sw, sh, 0, 0, dw, dh);

    const d3d = ctx3d.getImageData(0, 0, dw, dh).data;
    const dRef = ctxRef.getImageData(0, 0, dw, dh).data;
    const outImg = ctxOut.createImageData(dw, dh);
    const out = outImg.data;

    let maeSum = 0;
    const n = dw * dh;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const dr = Math.abs(d3d[o] - dRef[o]);
      const dg = Math.abs(d3d[o + 1] - dRef[o + 1]);
      const db = Math.abs(d3d[o + 2] - dRef[o + 2]);
      const err = (0.3 * dr + 0.59 * dg + 0.11 * db) / 255;
      maeSum += (dr + dg + db) / 3;

      // Amplified Turbo/Inferno perceptual error heatmap (0 = navy/teal, 0.5 = gold, 1.0 = red/white)
      const v = Math.min(1, err * 2.75);
      let r: number;
      let g: number;
      let b: number;
      if (v < 0.25) {
        const t = v / 0.25;
        r = 14 + t * 18;
        g = 28 + t * 120;
        b = 76 + t * 88;
      } else if (v < 0.55) {
        const t = (v - 0.25) / 0.3;
        r = 32 + t * 212;
        g = 148 + t * 62;
        b = 164 - t * 126;
      } else if (v < 0.85) {
        const t = (v - 0.55) / 0.3;
        r = 244 + t * 11;
        g = 210 - t * 155;
        b = 38 - t * 22;
      } else {
        const t = (v - 0.85) / 0.15;
        r = 255;
        g = 55 + t * 185;
        b = 16 + t * 224;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }

    ctxOut.putImageData(outImg, 0, 0);

    if (this.compareDiffCanvas.width !== dw) {
      this.compareDiffCanvas.width = dw;
      this.compareDiffCanvas.height = dh;
    }
    this.compareDiffCtx.drawImage(this.diffOffOut, 0, 0);

    const mae = maeSum / n;
    const simPct = Math.max(0, Math.min(100, Math.round((1 - mae / 128) * 100)));
    this.compareTagLeft.textContent = `LIVE-DIFF · MAE ${mae.toFixed(1)} · ~${simPct}% MATCH`;
  }

  public populateReferenceShots(shots: ResolvedReferenceShot[]): void {
    this.hasRefs = shots.length > 0;
    this.refCount.textContent = String(shots.length);
    this.refPreviewBox.classList.toggle('hidden', !this.hasRefs);
    this.refMetaCard.classList.toggle('hidden', !this.hasRefs);
    this.refEmptyMsg.classList.toggle('hidden', this.hasRefs);

    this.refShotList.innerHTML = '';
    shots.forEach((shot, idx) => {
      const btn = document.createElement('button');
      btn.className = 'ref-row';
      btn.dataset.refIdx = String(idx);
      const isAerial = shot.ref.cameraHeightM > 22 || shot.ref.source.toLowerCase().includes('maps');
      btn.innerHTML = `
        <span class="ref-num ${isAerial ? 'badge-aerial' : 'badge-street'}">R${idx + 1}</span>
        <span class="ref-row-title">${shot.ref.title}</span>
        <span class="ref-row-src">${isAerial ? '3D/Sat' : 'Street'}</span>
      `;
      btn.addEventListener('click', () => {
        this.handlers.onSelectReferenceShot(idx);
      });
      this.refShotList.appendChild(btn);
    });

    if (shots.length > 0) {
      const heroIdx = shots.findIndex((s) => s.ref.id === 'sv_kirche_full_west');
      const initialIdx = heroIdx >= 0 ? heroIdx : 0;
      this.displayActiveReference(shots[initialIdx], initialIdx);
    }
  }

  private applyReferenceImage(file: string): void {
    if (this.refPreviewImg.getAttribute('src') === file) return;
    this.refPreviewImg.src = file;
    this.compareStageImg.src = file;
  }

  public displayActiveReference(shot: ResolvedReferenceShot, index: number): void {
    // The photos are only needed by the "Realität vs. 3D" mode: fetch them when it is open, not at start-up.
    if (this.benchmarkActive) {
      this.applyReferenceImage(shot.ref.file);
      this.pendingReferenceFile = null;
    } else {
      this.pendingReferenceFile = shot.ref.file;
    }
    this.refSourceBadge.textContent = shot.ref.source;
    this.refAngleBadge.textContent = `${Math.round(shot.ref.headingDeg)}° · ${shot.ref.cameraHeightM.toFixed(1)} m`;
    this.refTitle.textContent = shot.ref.title;
    this.refNotes.textContent =
      shot.ref.architecturalNotes ||
      `GPS ${shot.ref.lat.toFixed(5)}° N, ${shot.ref.lon.toFixed(5)}° E · Blickrichtung ${Math.round(shot.ref.headingDeg)}°`;

    document.querySelectorAll<HTMLButtonElement>('.ref-row').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.refIdx) === index);
    });
    this.applyCompareVisuals();
  }

  public updateTractorHud(t: TractorTelemetry, muted: boolean): void {
    this.tachoKmh.textContent = String(Math.round(t.speedKmh));
    this.tachoGear.textContent = t.gear;
    this.tachoRpm.textContent = `${t.rpm} U/min`;

    const rpmPct = Math.round(Math.max(6, Math.min(100, t.rpmNorm * 100)));
    this.rpmFill.style.width = `${rpmPct}%`;
    this.rpmFill.classList.toggle('rpm-high', rpmPct > 82);

    this.btnLights.classList.toggle('active', t.lightsOn);
    this.btnBeacon.classList.toggle('active', t.beaconOn);
    this.btnTrailer.classList.toggle('active', t.trailerAttached);
    this.btnMute.classList.toggle('active', !muted);

    this.indLights.className = `tacho-dot ${t.lightsOn ? 'on-sky' : ''}`;
    this.indBeacon.className = `tacho-dot ${t.beaconOn ? 'on-amber' : ''}`;
    this.indTrailer.className = `tacho-dot ${t.trailerAttached ? 'on-green' : ''}`;
  }

  public updateTourHud(snap: TourStateSnapshot): void {
    if (snap.completed) {
      this.tourProgressBadge.textContent = `${snap.total} / ${snap.total} ✓`;
      this.tourTargetName.textContent = 'Weinlese-Tour abgeschlossen!';
      this.tourDist.textContent = 'Ziel erreicht';
    } else if (snap.currentCheckpoint) {
      this.tourProgressBadge.textContent = `${snap.activeIndex + 1} / ${snap.total}`;
      this.tourTargetName.textContent = snap.currentCheckpoint.name;
      this.tourDist.textContent = `${Math.round(snap.distanceToNextM)} m`;
    }
    this.tourTimer.textContent = formatMmSs(snap.elapsedSec);
    this.tourKm.textContent = `${snap.drivenKm.toFixed(1).replace('.', ',')} km`;

    if (snap.justCompleted) {
      this.showToast(`Pfälzer Weinlese-Tour geschafft in ${formatMmSs(snap.elapsedSec)}! (${snap.drivenKm.toFixed(2).replace('.', ',')} km)`);
    } else if (snap.justReachedName) {
      this.showToast(`Checkpoint erreicht: ${snap.justReachedName}!`);
    }
  }

  public showToast(message: string): void {
    this.tourToast.textContent = message;
    this.tourToast.classList.remove('hidden');
    if (this.toastTimeout !== null) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => {
      this.tourToast.classList.add('hidden');
    }, 3600);
  }

  public renderDriveMinimap(
    tractorX: number,
    tractorZ: number,
    tractorHeadingRad: number,
    lat: number,
    elevNHN: number,
    checkpoints: TourCheckpoint[],
    activeCpIndex: number,
    tourCompleted: boolean,
    mapSizeM: number
  ): void {
    this.driveMinimapCoords.textContent = `${lat.toFixed(4)}° N · ${Math.round(elevNHN)} m`;
    if (this.driveMinimapBox.classList.contains('hidden')) return;

    const ctx = this.driveMinimapCtx;
    const w = this.driveMinimapCanvas.width;
    const h = this.driveMinimapCanvas.height;

    // Show a zoomed 680m window centered smoothly on the tractor!
    const viewSpanM = 680;
    const halfView = viewSpanM * 0.5;
    const halfMap = mapSizeM * 0.5;
    const cxWorld = Math.max(-halfMap + halfView, Math.min(halfMap - halfView, tractorX));
    const czWorld = Math.max(-halfMap + halfView, Math.min(halfMap - halfView, tractorZ));

    const toPx = (wx: number, wz: number): [number, number] => [
      ((wx - (cxWorld - halfView)) / viewSpanM) * w,
      ((wz - (czWorld - halfView)) / viewSpanM) * h,
    ];

    ctx.clearRect(0, 0, w, h);

    if (this.driveOrthoImg) {
      const sx = ((cxWorld - halfView + halfMap) / mapSizeM) * this.driveOrthoImg.width;
      const sy = ((czWorld - halfView + halfMap) / mapSizeM) * this.driveOrthoImg.height;
      const sSpan = (viewSpanM / mapSizeM) * this.driveOrthoImg.width;
      ctx.drawImage(this.driveOrthoImg, sx, sy, sSpan, sSpan, 0, 0, w, h);
      ctx.fillStyle = 'rgba(10, 15, 12, 0.24)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#18221c';
      ctx.fillRect(0, 0, w, h);
    }

    // Subtle route line connecting remaining checkpoints
    if (!tourCompleted && activeCpIndex < checkpoints.length) {
      const [txPx, tyPx] = toPx(tractorX, tractorZ);
      const active = checkpoints[activeCpIndex];
      const [axPx, ayPx] = toPx(active.x, active.z);

      ctx.strokeStyle = 'rgba(242, 193, 78, 0.72)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(txPx, tyPx);
      ctx.lineTo(axPx, ayPx);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw checkpoint marker (clamped to minimap edge if further away!)
      const edgeX = Math.max(10, Math.min(w - 10, axPx));
      const edgeY = Math.max(10, Math.min(h - 10, ayPx));
      ctx.fillStyle = '#f2c14e';
      ctx.strokeStyle = '#111814';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(edgeX, edgeY, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#111814';
      ctx.font = '800 8.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(active.id), edgeX, edgeY + 0.5);
    }

    // Tractor arrow (forward is +Z = (sin(h), cos(h)), on canvas +Y is South (+Z), -Y is North (-Z))
    // Angle relative to canvas -Y (North): atan2(fwdX, -fwdZ) = atan2(sin(h), -cos(h))
    const [txPx, tyPx] = toPx(tractorX, tractorZ);
    const canvasYaw = Math.atan2(Math.sin(tractorHeadingRad), -Math.cos(tractorHeadingRad));
    ctx.save();
    ctx.translate(txPx, tyPx);
    ctx.rotate(canvasYaw);

    ctx.fillStyle = 'rgba(82, 201, 128, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-10, -22);
    ctx.lineTo(10, -22);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#52c980';
    ctx.strokeStyle = '#0c130f';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
