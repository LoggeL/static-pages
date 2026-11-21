import { WaterAudioEngine } from './audio/waterAudio.ts';
import { ToolController } from './input/toolController.ts';
import { CAMPAIGN_LEVELS, SANDBOX_LEVEL, TITLE_DEMO_LEVEL } from './levels/levelData.ts';
import { OverlayRenderer } from './render/overlayCanvas.ts';
import { WebGLRenderer } from './render/webglRenderer.ts';
import { FluidEngine } from './sim/fluidEngine.ts';
import { MechanismSystem } from './sim/mechanisms.ts';
import { TerrainGrid } from './sim/terrainGrid.ts';
import {
  WORLD_H,
  WORLD_W,
  type GameStateSnapshot,
  type Lang,
  type LevelDef,
  type LevelProgress,
  type QualityLevel,
  type ScreenMode,
} from './types.ts';
import { HUDController, type SandboxAction } from './ui/hud.ts';

const STORAGE_KEY = 'aqualith_progress_v1';
const FIXED_DT = 1 / 60;
const SLOW_MO_SCALE = 0.35;
const ICE_BRUSH_RADIUS = 0.24;
const ROCK_BRUSH_RADIUS = 0.26;

interface SavedData {
  lang?: Lang;
  quality?: QualityLevel;
  muted?: boolean;
  levelProgress?: Record<string, LevelProgress>;
}

function loadSavedData(): SavedData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedData;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function createInitialProgress(existing?: Record<string, LevelProgress>): Record<string, LevelProgress> {
  const progress: Record<string, LevelProgress> = {};
  for (const lvl of CAMPAIGN_LEVELS) {
    const prev = existing?.[lvl.id];
    progress[lvl.id] = {
      stars: typeof prev?.stars === 'number' ? Math.max(0, Math.min(3, prev.stars)) : 0,
      bestTime: typeof prev?.bestTime === 'number' && Number.isFinite(prev.bestTime) ? prev.bestTime : null,
      unlocked: true,
    };
  }
  return progress;
}

function saveProgressData(data: SavedData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota or private browsing errors cleanly
  }
}

function computeStars(elapsed: number, parTime: number): number {
  if (parTime <= 0) return 3;
  if (elapsed <= parTime) return 3;
  if (elapsed <= parTime * 1.45) return 2;
  return 1;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

class AqualithApp {
  private readonly stageEl: HTMLElement;
  private readonly webglCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement;

  private readonly terrain = new TerrainGrid();
  private readonly fluid = new FluidEngine();
  private readonly mechanisms = new MechanismSystem();
  private readonly audio = new WaterAudioEngine();
  private readonly renderer: WebGLRenderer;
  private readonly overlay: OverlayRenderer;
  private readonly tools: ToolController;
  private readonly hud: HUDController;

  private screen: ScreenMode = 'title';
  private currentLevel: LevelDef = TITLE_DEMO_LEVEL;
  private lang: Lang = 'de';
  private quality: QualityLevel = 'ultra';
  private slowMo = false;
  private elapsed = 0;
  private starsEarned = 0;
  private showDragHint = true;
  private spoutsActive = true;
  private levelProgress: Record<string, LevelProgress>;

  // Timing & FPS
  private rafId = 0;
  private lastFrameTimeMs = 0;
  private accumulator = 0;
  private animTime = 0;
  private fps = 60;
  private fpsFrames = 0;
  private fpsWindowStartMs = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    const stageEl = document.getElementById('stage');
    const webglCanvas = document.getElementById('webgl-canvas');
    const overlayCanvas = document.getElementById('overlay-canvas');
    const uiRoot = document.getElementById('ui-root');

    if (
      !(stageEl instanceof HTMLElement) ||
      !(webglCanvas instanceof HTMLCanvasElement) ||
      !(overlayCanvas instanceof HTMLCanvasElement) ||
      !(uiRoot instanceof HTMLElement)
    ) {
      throw new Error('AQUALITH: Required DOM elements (#stage, #webgl-canvas, #overlay-canvas, #ui-root) missing');
    }

    this.stageEl = stageEl;
    this.webglCanvas = webglCanvas;
    this.overlayCanvas = overlayCanvas;
    this.uiRoot = uiRoot;

    const saved = loadSavedData();
    this.lang = saved.lang === 'en' ? 'en' : 'de';
    this.quality = saved.quality === 'high' ? 'high' : 'ultra';
    this.levelProgress = createInitialProgress(saved.levelProgress);
    if (saved.muted) {
      this.audio.setMuted(true);
    }

    this.renderer = new WebGLRenderer(this.webglCanvas);
    this.renderer.setQuality(this.quality);
    this.overlay = new OverlayRenderer(this.overlayCanvas);

    this.tools = new ToolController(this.stageEl, {
      onUserGesture: () => this.audio.unlock(),
      onToolChange: () => this.pushHudUpdate(),
      onShatterIce: () => this.shatterAllIce(),
      onPaintIce: (wx, wy) => this.handlePaintIce(wx, wy),
      onEraseIce: (wx, wy) => this.handleEraseIce(wx, wy),
      onPaintRock: (wx, wy, erase) => this.handlePaintRock(wx, wy, erase),
      onTryClickWorld: (wx, wy) => {
        if (this.screen !== 'playing') return false;
        const toggled = this.mechanisms.toggleValveAt(wx, wy);
        if (toggled) {
          this.audio.playValveClank();
        }
        return toggled;
      },
      isHoveringInteractive: (wx, wy) =>
        this.screen === 'playing' && this.mechanisms.isHoveringValve(wx, wy),
      onSlowMoChange: (slow) => {
        if (this.screen === 'playing') {
          this.slowMo = slow;
          this.tools.setSlowMo(slow);
        }
      },
      onRestart: () => {
        if (this.screen === 'playing' || this.screen === 'victory') {
          this.loadLevel(this.currentLevel, 'playing');
        }
      },
      onToggleMute: () => this.toggleMute(),
      onToggleMenu: () => this.handleEscapeMenu(),
      onFirstInteract: () => {
        this.showDragHint = false;
        this.hud.setTutorialVisible(false);
      },
      onVortexFire: () => this.audio.playVortexFire(),
    });

    this.hud = new HUDController(this.uiRoot, {
      onStartCampaign: () => {
        this.audio.unlock();
        const nextIndex = this.findNextUnfinishedChapter();
        this.selectCampaignChapter(nextIndex);
      },
      onSelectLevel: (chapterIndex) => {
        this.audio.unlock();
        this.selectCampaignChapter(chapterIndex);
      },
      onOpenSandbox: () => {
        this.audio.unlock();
        this.loadLevel(SANDBOX_LEVEL, 'playing');
      },
      onSelectTool: (tool) => {
        this.audio.unlock();
        this.tools.setActiveTool(tool);
      },
      onShatterIce: () => {
        this.audio.unlock();
        this.shatterAllIce();
      },
      onToggleSlowMo: () => {
        this.audio.unlock();
        if (this.screen === 'playing') {
          this.slowMo = !this.slowMo;
          this.tools.setSlowMo(this.slowMo);
        }
      },
      onRestart: () => {
        this.audio.unlock();
        this.loadLevel(this.currentLevel, 'playing');
      },
      onToggleMute: () => {
        this.audio.unlock();
        this.toggleMute();
      },
      onToggleQuality: () => {
        this.audio.unlock();
        this.quality = this.quality === 'ultra' ? 'high' : 'ultra';
        this.renderer.setQuality(this.quality);
        this.handleResize();
        this.persist();
      },
      onToggleLang: () => {
        this.audio.unlock();
        this.lang = this.lang === 'de' ? 'en' : 'de';
        this.persist();
      },
      onOpenMenu: () => {
        this.audio.unlock();
        this.returnToTitle();
      },
      onNextLevel: () => {
        this.audio.unlock();
        const nextIdx = this.currentLevel.index + 1;
        if (nextIdx <= CAMPAIGN_LEVELS.length) {
          this.selectCampaignChapter(nextIdx);
        } else {
          this.loadLevel(SANDBOX_LEVEL, 'playing');
        }
      },
      onSandboxAction: (action) => {
        this.audio.unlock();
        this.handleSandboxAction(action);
      },
    });

    this.setupResize();
    this.loadLevel(TITLE_DEMO_LEVEL, 'title');
    this.exposeDebugApi();

    const now = performance.now();
    this.lastFrameTimeMs = now;
    this.fpsWindowStartMs = now;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private setupResize(): void {
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.stageEl);
    }
  }

  private readonly handleResize = (): void => {
    const cssW = Math.max(1, Math.round(this.stageEl.clientWidth || 1280));
    const cssH = Math.max(1, Math.round(this.stageEl.clientHeight || 720));
    const maxDpr = this.quality === 'ultra' ? 2.0 : 1.5;
    const dpr = clamp(window.devicePixelRatio || 1, 1, maxDpr);

    this.renderer.resize(Math.round(cssW * dpr), Math.round(cssH * dpr));
    this.overlay.resize(cssW, cssH, dpr);
  };

  private findNextUnfinishedChapter(): number {
    for (let i = 0; i < CAMPAIGN_LEVELS.length; i++) {
      const prog = this.levelProgress[CAMPAIGN_LEVELS[i].id];
      if (!prog || prog.stars === 0) {
        return i + 1;
      }
    }
    return 1;
  }

  private selectCampaignChapter(chapterIndex: number): void {
    const clamped = Math.max(1, Math.min(CAMPAIGN_LEVELS.length, Math.floor(chapterIndex)));
    const level = CAMPAIGN_LEVELS[clamped - 1];
    this.loadLevel(level, 'playing');
  }

  private returnToTitle(): void {
    this.hud.setChapterModalOpen(false);
    this.loadLevel(TITLE_DEMO_LEVEL, 'title');
  }

  private handleEscapeMenu(): void {
    if (this.screen === 'playing') {
      if (this.hud.isChapterModalOpen()) {
        this.hud.setChapterModalOpen(false);
      } else {
        this.hud.setChapterModalOpen(true);
      }
    } else if (this.screen === 'victory') {
      this.hud.setChapterModalOpen(false);
    }
  }

  private loadLevel(level: LevelDef, mode: ScreenMode): void {
    this.currentLevel = level;
    this.screen = mode;
    this.elapsed = 0;
    this.starsEarned = 0;
    this.slowMo = false;
    this.accumulator = 0;
    this.spoutsActive = level.spouts.some((s) => s.enabled !== false);
    this.showDragHint = mode === 'playing' && level.id === 'level-1';

    this.fluid.reset();
    this.terrain.loadLevel(level.solids, level.carves, level.drains);
    this.mechanisms.loadLevel(level, this.terrain);

    // Spawn initial water pools cleanly within particle budget
    for (const pool of level.pools) {
      this.fluid.spawnPool(pool.x, pool.y, pool.w, pool.h, level.maxTotalParticles, pool.fillFactor ?? 0.9);
    }

    const isPlaying = mode === 'playing';
    this.tools.setSandbox(Boolean(level.isSandbox));
    this.tools.setActiveTool('surge');
    this.tools.setSlowMo(false);
    this.tools.setEnabled(isPlaying);

    if (isPlaying && level.id === 'level-1') {
      this.hud.setTutorialVisible(true);
    }

    this.pushHudUpdate();
  }

  private handlePaintIce(wx: number, wy: number): void {
    if (this.screen !== 'playing') return;
    const res = this.terrain.paintIce(wx, wy, ICE_BRUSH_RADIUS, this.currentLevel.maxFrostCells);
    if (res.added > 0) {
      this.fluid.telemetry.iceFreezeCount += 1;
      this.audio.playIceFreeze();
    }
  }

  private handleEraseIce(wx: number, wy: number): void {
    if (this.screen !== 'playing') return;
    this.terrain.eraseIce(wx, wy, ICE_BRUSH_RADIUS * 1.15);
  }

  private handlePaintRock(wx: number, wy: number, erase: boolean): void {
    if (this.screen !== 'playing' || !this.currentLevel.isSandbox) return;
    this.terrain.paintRock(wx, wy, ROCK_BRUSH_RADIUS, erase);
  }

  private shatterAllIce(): void {
    if (this.screen !== 'playing') return;
    const cells = this.terrain.shatterAllIce();
    if (cells.length > 0) {
      this.mechanisms.spawnIceShards(cells);
      this.fluid.telemetry.iceShatterCount += cells.length;
      this.audio.playIceShatter();
    }
  }

  private handleSandboxAction(action: SandboxAction): void {
    if (!this.currentLevel.isSandbox) return;
    const jitter = () => (Math.random() - 0.5) * 1.6;
    switch (action) {
      case 'tsunami':
        this.fluid.triggerTsunami(this.currentLevel.maxTotalParticles);
        this.audio.playVortexFire();
        break;
      case 'toggleSpouts':
        this.mechanisms.toggleSpouts();
        this.spoutsActive = this.mechanisms.spouts.some((s) => s.enabled);
        break;
      case 'addTurbine':
        this.mechanisms.addSandboxTurbine(clamp(8.0 + jitter() * 2.2, 2.2, WORLD_W - 2.2), clamp(4.8 + jitter() * 0.8, 2.2, WORLD_H - 2.0));
        break;
      case 'addArk':
        this.mechanisms.addSandboxBody(clamp(8.0 + jitter() * 2.0, 2.0, WORLD_W - 2.0), clamp(6.2 + jitter() * 0.5, 2.4, WORLD_H - 1.5), 'ark');
        break;
      case 'addMagma':
        this.mechanisms.addSandboxMagma(clamp(8.0 + jitter() * 2.4, 2.2, WORLD_W - 3.6), 0.55);
        break;
      case 'addWall':
        this.mechanisms.addSandboxCrackedWall(clamp(8.0 + jitter() * 2.2, 2.2, WORLD_W - 2.2), 0.55);
        break;
      case 'addMine':
        this.mechanisms.addSandboxMine(clamp(8.0 + jitter() * 2.4, 2.2, WORLD_W - 2.2), clamp(5.8 + jitter() * 0.6, 2.6, WORLD_H - 1.5));
        break;
      case 'addSeesaw':
        this.mechanisms.addSandboxSeesaw(clamp(8.0 + jitter() * 2.0, 2.8, WORLD_W - 2.8), clamp(3.6 + jitter() * 0.6, 2.0, WORLD_H - 2.2));
        break;
      case 'clearWater':
        this.fluid.reset();
        break;
    }
    this.pushHudUpdate();
  }

  private toggleMute(): void {
    const next = !this.audio.isMuted();
    this.audio.setMuted(next);
    this.persist();
  }

  private persist(): void {
    saveProgressData({
      lang: this.lang,
      quality: this.quality,
      muted: this.audio.isMuted(),
      levelProgress: this.levelProgress,
    });
  }

  private completeLevel(): void {
    this.screen = 'victory';
    this.slowMo = false;
    this.tools.setSlowMo(false);
    this.tools.setEnabled(false);

    this.starsEarned = computeStars(this.elapsed, this.currentLevel.parTime);
    const prev = this.levelProgress[this.currentLevel.id] ?? {
      stars: 0,
      bestTime: null,
      unlocked: true,
    };

    const bestTime = prev.bestTime === null ? this.elapsed : Math.min(prev.bestTime, this.elapsed);
    this.levelProgress[this.currentLevel.id] = {
      stars: Math.max(prev.stars, this.starsEarned),
      bestTime,
      unlocked: true,
    };
    this.persist();
    this.audio.playVictory();
    this.pushHudUpdate();
  }

  private buildSnapshot(): GameStateSnapshot {
    const objectives = this.mechanisms.getObjectives();
    return {
      screen: this.screen,
      levelId: this.currentLevel.id,
      levelIndex: this.currentLevel.index,
      isSandbox: Boolean(this.currentLevel.isSandbox),
      titleKey: this.currentLevel.titleKey,
      subtitleKey: this.currentLevel.subtitleKey,
      hintKey: this.currentLevel.hintKey,
      elapsed: this.elapsed,
      parTime: this.currentLevel.parTime,
      frostUsed: this.terrain.frostCount,
      frostMax: this.currentLevel.maxFrostCells,
      activeTool: this.tools.getActiveTool(),
      slowMo: this.slowMo,
      muted: this.audio.isMuted(),
      quality: this.quality,
      lang: this.lang,
      fps: this.fps,
      waterCount: this.fluid.numParticles,
      objectives,
      starsEarned: this.starsEarned,
      levelProgress: this.levelProgress,
      spoutsActive: this.spoutsActive,
    };
  }

  private pushHudUpdate(): void {
    this.hud.update(this.buildSnapshot());
  }

  private readonly loop = (nowMs: number): void => {
    const rawDt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastFrameTimeMs) / 1000));
    this.lastFrameTimeMs = nowMs;

    // FPS tracking
    this.fpsFrames++;
    const fpsElapsed = nowMs - this.fpsWindowStartMs;
    if (fpsElapsed >= 450) {
      this.fps = (this.fpsFrames * 1000) / fpsElapsed;
      this.fpsFrames = 0;
      this.fpsWindowStartMs = nowMs;
    }

    const timeScale = this.screen === 'playing' && this.slowMo ? SLOW_MO_SCALE : 1.0;
    const simDt = rawDt * timeScale;
    this.accumulator += simDt;
    this.animTime += simDt;

    const activeToolAllowed = this.screen === 'playing' && !this.hud.isChapterModalOpen();
    this.tools.setEnabled(activeToolAllowed);

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 4) {
      this.accumulator -= FIXED_DT;
      steps++;

      if (activeToolAllowed) {
        this.tools.update(FIXED_DT);
      }

      const toolInput = activeToolAllowed ? this.tools.getToolInput() : null;
      this.fluid.step(
        FIXED_DT,
        this.terrain,
        toolInput,
        this.mechanisms,
        this.quality,
        this.currentLevel.maxTotalParticles
      );
      this.tools.consumeBurst();

      if (this.screen === 'playing') {
        this.elapsed += FIXED_DT;
        if (!this.currentLevel.isSandbox && this.mechanisms.isLevelComplete()) {
          this.completeLevel();
          break;
        }
      }
    }

    // Drop excess accumulator if frame stuttered severely
    if (this.accumulator > FIXED_DT * 2) {
      this.accumulator = 0;
    }

    const mechSnapshot = this.mechanisms.getSnapshot();
    const stateSnapshot = this.buildSnapshot();
    const currentToolInput = this.tools.getToolInput();
    const pointerWorld = this.tools.getPointerWorld();

    this.renderer.render(this.animTime, this.fluid, this.terrain, mechSnapshot, this.currentLevel.theme);
    this.overlay.render(
      stateSnapshot,
      mechSnapshot,
      currentToolInput,
      pointerWorld,
      this.animTime,
      this.showDragHint
    );
    this.hud.update(stateSnapshot);
    this.audio.update(this.fluid.telemetry, rawDt);

    this.rafId = requestAnimationFrame(this.loop);
  };

  private exposeDebugApi(): void {
    const api = {
      getState: () => this.buildSnapshot(),
      getTelemetry: () => ({ ...this.fluid.telemetry }),
      getMechanisms: () => this.mechanisms.getSnapshot(),
      startCampaign: () => this.selectCampaignChapter(1),
      selectLevel: (idx: number) => this.selectCampaignChapter(idx),
      openSandbox: () => this.loadLevel(SANDBOX_LEVEL, 'playing'),
      returnToTitle: () => this.returnToTitle(),
      triggerTsunami: () => this.handleSandboxAction('tsunami'),
    };
    (window as unknown as Record<string, unknown>).__AQUALITH_DEBUG__ = api;
  }

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.tools.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }
}

const app = new AqualithApp();
window.addEventListener('beforeunload', () => app.dispose(), { once: true });
