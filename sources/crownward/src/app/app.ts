// Crownward – App-Hülle: Zustandsautomat (loading → title → playing ↔ paused → victory/defeat),
// verbindet Simulation, Renderer, Audio, Eingabe und UI. Liest den Spielzustand, verändert ihn nur über stepGame.

import { createGame, deserializeGame, getPlayerFocus, serializeGame } from '../sim';
import type { GameState, Offer, PlayerInput, SimEvent } from '../sim';
import { createRenderer, loadAssets } from '../render';
import type { LoadedAssets, Renderer } from '../render';
import { createAudio } from '../audio';
import type { AudioEngine } from '../audio';
import { InputManager, type MenuAction } from '../input';
import { GameUI, t, type CrownLoss, type HudView, type Overlay, type Screen } from '../ui';
import { holdLabel, introText, tapLabel } from '../ui/hints';
import { LayoutController } from './layout';
import { GameLoop, liveEvents } from './loop';
import { blockedSave, listSaves, loadSettings, newestSave, readSlot, saveSettings, writeSlot, type Settings } from './storage';

export const APP_VERSION = '0.1.0';
/** Sekunden Simulationszeit zwischen Sieg/Niederlage und Endbildschirm */
export const END_SCREEN_DELAY = 2.5;
/**
 * Einführungshinweis eines neuen Spiels: sichtbar bis INTRO_SECONDS nach der ersten Eingabe (wer erst liest, sieht
 * die Steuerung trotzdem), höchstens bis zum ersten Abend.
 */
export const INTRO_SECONDS = 30;
const RECENT_MAX = 2000;

type OverlayReturn = 'title' | 'pause' | 'play' | 'end';
export type SaveMode = 'manual' | 'auto' | 'silent';

function ensureChild<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, id: string, tag: K): HTMLElementTagNameMap[K] {
  const found = document.getElementById(id);
  if (found) return found as HTMLElementTagNameMap[K];
  const n = document.createElement(tag);
  n.id = id;
  root.append(n);
  return n;
}

export class App {
  screen: Screen = 'loading';
  overlay: Overlay = null;
  game: GameState | null = null;
  renderer: Renderer | null = null;
  assets: LoadedAssets | null = null;
  assetError: string | null = null;
  settings: Settings;
  readonly audio: AudioEngine;
  readonly input = new InputManager();
  readonly ui: GameUI;
  readonly loop: GameLoop;
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly layout: LayoutController;
  private overlayReturn: OverlayReturn = 'title';
  private readonly recent: SimEvent[] = [];
  private lastCoop = false;
  private focus: (Offer | null)[] = [];
  /** Spielzeit der ersten Spieleingabe (null = noch keine) – steuert die Dauer der Einführung */
  private introFrom: number | null = null;
  /** Ort und Spieler des Kronverlusts (für den Untertitel der Niederlage) */
  private crownLoss: CrownLoss | null = null;
  /** Grafiken fehlen (Platzhalter aktiv) → Hinweis im Titel und einmal beim ersten Spielstart */
  private assetsIncomplete = false;
  private assetNoticeShown = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('app');
    const stage = ensureChild(root, 'stage', 'div');
    stage.classList.add('stage');
    this.canvas = stage.querySelector('canvas') ?? stage.appendChild(document.createElement('canvas'));
    this.canvas.id = 'game';
    const dock = ensureChild(root, 'dock', 'div');
    dock.classList.add('dock');
    const uiRoot = ensureChild(root, 'ui', 'div');
    uiRoot.classList.add('ui-root');

    this.settings = loadSettings();
    this.audio = createAudio();
    this.audio.setSettings(this.settings);
    this.input.setForceTouch(this.settings.forceTouch);

    const artUrl = `${import.meta.env.BASE_URL}assets/first-island-concept.png`;
    this.ui = new GameUI(
      uiRoot,
      stage,
      dock,
      {
        continueGame: () => this.continueGame(),
        newGame: (coop) => this.newGame({ coop }),
        openHelp: () => this.openOverlay('help'),
        openSettings: () => this.openOverlay('settings'),
        resume: () => this.resume(),
        save: () => this.saveTo('slot1', 'manual'),
        load: () => this.loadFrom(this.latestSlot()),
        mainMenu: () => this.toTitle(),
        restart: () => this.newGame({ coop: this.lastCoop }),
        loadLast: () => this.loadFrom(this.latestSlot()),
        closeOverlay: () => this.closeOverlay(),
        settingsChanged: (s) => this.applySettings(s),
        toggleFullscreen: () => this.toggleFullscreen(),
        pause: () => this.pause(),
      },
      this.settings,
      APP_VERSION,
      artUrl,
    );
    this.ui.mountTouch(this.input.touch.root);

    this.layout = new LayoutController(
      root,
      stage,
      this.canvas,
      (w, h, dpr) => {
        try {
          this.renderer?.resize(w, h, dpr);
        } catch (e) {
          console.error('[crownward] renderer.resize', e);
        }
      },
      (mode) => this.ui.setLayout(mode),
    );

    const app = this;
    this.loop = new GameLoop({
      renderer: () => app.renderer,
      audio: app.audio,
      game: () => (app.screen === 'loading' || app.screen === 'title' ? null : app.game),
      simulating: () => app.screen === 'playing' || app.screen === 'victory' || app.screen === 'defeat',
      paused: () => app.screen === 'paused',
      inputs: (n) => app.gameInputs(n),
      beginFrame: () => app.beginFrame(),
      onEvents: (events, game) => app.onSimEvents(events, game),
      endFrame: (dt, game) => app.endFrame(dt, game),
    });

    this.installGlobalListeners();
  }

  // ---------- Start ----------

  async boot(): Promise<void> {
    this.input.attach(window);
    this.layout.attach();
    this.ui.setScreen('loading');
    this.loop.start();

    let assets: LoadedAssets;
    try {
      assets = await loadAssets((loaded, total) => this.ui.setLoading(total > 0 ? loaded / total : 1));
    } catch (e) {
      this.assetError = e instanceof Error ? e.message : String(e);
      console.error('[crownward] loadAssets', e);
      assets = { atlas: null, images: new Map(), missing: ['assets/sprites/atlas.json'] };
    }
    this.assets = assets;
    try {
      this.renderer = createRenderer(this.canvas, assets);
    } catch (e) {
      console.error('[crownward] createRenderer', e);
      this.renderer = null;
    }
    this.layout.refresh();
    this.ui.setLoading(1);
    if (assets.missing.length) console.warn('[crownward] fehlende Grafiken:', assets.missing);
    let placeholders = 0;
    try {
      placeholders = this.renderer ? this.renderer.assetReport().missing.length : 1;
    } catch {
      placeholders = 1;
    }
    this.assetsIncomplete = !!this.assetError || assets.missing.length > 0 || placeholders > 0;
    // Dauerhafter Hinweis im Titel statt stiller Ersatzdarstellung
    this.ui.title.setNotice(this.assetsIncomplete ? t('app.loadFailed') : null);

    // Debug-/Testhilfe: ?play bzw. ?play=coop&seed=… startet direkt ins Spiel
    const params = new URLSearchParams(location.search);
    if (this.screen === 'loading') {
      if (params.has('play')) {
        const seed = Number(params.get('seed'));
        this.newGame({ coop: params.get('play') === 'coop', seed: Number.isFinite(seed) && seed > 0 ? seed : undefined });
      } else {
        this.setScreen('title');
      }
    }
  }

  private installGlobalListeners(): void {
    // Audio erst nach einer Nutzergeste entsperren
    const unlock = () => {
      this.audio.unlock();
      if (this.audio.unlocked) {
        for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(ev, unlock, true);
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlock, true);

    // Fokusverlust → automatisch pausieren
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    window.addEventListener('blur', () => this.autoPause());

    // Kein Kontextmenü/Pinch-Zoom auf der Spielfläche
    this.root.addEventListener('contextmenu', (e) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    // Klicks auf UI-Knöpfe hörbar machen
    this.root.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest('.mbtn')) this.audio.uiSound('click');
    });
  }

  // ---------- Zustände ----------

  setScreen(s: Screen): void {
    this.screen = s;
    this.input.setMode(s === 'playing' && !this.overlay ? 'game' : 'menu');
    // Menüinhalte vor dem Anzeigen aktualisieren, damit der Fokus auf dem richtigen ersten Knopf landet
    if (s === 'title') {
      const saves = listSaves();
      this.ui.refreshTitle(newestSave(saves), blockedSave(saves));
      this.ui.title.setCoopAvailable(this.input.coopAvailable);
    }
    if (s === 'paused') this.ui.refreshPause(newestSave());
    this.ui.setScreen(s);
    this.updateTouch();
  }

  newGame(opts: { coop?: boolean; seed?: number } = {}): void {
    const seed = opts.seed !== undefined ? opts.seed >>> 0 : (Math.random() * 0x7fffffff) >>> 0;
    const state = createGame({ seed, coop: !!opts.coop });
    this.startWith(state);
    this.audio.uiSound('start');
    this.ui.toasts.banner(t('toast.welcome'), t('toast.welcomeSub'), 'day', 4);
    this.ui.toast(t('toast.goal'), { kind: 'info', duration: 7, key: 'goal' });
    if (state.coop) this.ui.toast(t('toast.coopJoin'), { kind: 'good', duration: 5 });
  }

  private startWith(state: GameState): void {
    this.game = state;
    this.lastCoop = state.coop;
    // Neues Spiel: Einführung bis 30 s nach der ersten Eingabe; geladener Stand: wie bisher nach Spielzeit
    this.introFrom = state.time > 0 ? 0 : null;
    this.crownLoss = null;
    this.input.coop = state.coop;
    this.input.releaseAll();
    this.loop.reset();
    this.overlay = null;
    this.ui.setOverlay(null);
    this.ui.resetForGame();
    if (this.assetsIncomplete && !this.assetNoticeShown) {
      this.assetNoticeShown = true;
      this.ui.toast(t('app.loadFailed'), { kind: 'warn', key: 'assets', duration: 8 });
    }
    try {
      this.renderer?.snapCamera(state);
    } catch (e) {
      console.error('[crownward] snapCamera', e);
    }
    this.setScreen('playing');
  }

  continueGame(): void {
    const saves = listSaves();
    const meta = newestSave(saves);
    if (!meta) {
      this.ui.refreshTitle(null, blockedSave(saves));
      return;
    }
    this.loadFrom(meta.slot);
  }

  /**
   * Ziel von F9, „Laden" (Pause) und „Letzten Spielstand laden": der neueste ladbare Stand – dieselbe Regel wie
   * „Fortsetzen" und die Pausenotiz. Gibt es keinen, der neueste unladbare (Laden zeigt dann dessen Grund).
   */
  latestSlot(): string | undefined {
    const saves = listSaves();
    return (newestSave(saves) ?? blockedSave(saves))?.slot;
  }

  pause(sound = true): void {
    if (this.screen !== 'playing') return;
    this.input.releaseAll();
    this.setScreen('paused');
    if (sound) this.audio.uiSound('open');
  }

  resume(sound = true): void {
    if (this.screen !== 'paused') return;
    this.overlay = null;
    this.ui.setOverlay(null);
    this.setScreen('playing');
    if (sound) this.audio.uiSound('close');
  }

  private autoPause(): void {
    if (this.screen === 'playing') this.pause();
  }

  toTitle(): void {
    this.game = null;
    this.overlay = null;
    this.ui.setOverlay(null);
    this.ui.resetForGame();
    this.setScreen('title');
  }

  openOverlay(kind: Exclude<Overlay, null>): void {
    if (this.screen === 'loading') return;
    if (this.screen === 'playing') {
      this.pause(false);
      this.overlayReturn = 'play';
    } else if (!this.overlay) {
      this.overlayReturn = this.screen === 'title' ? 'title' : this.screen === 'paused' ? 'pause' : 'end';
    }
    if (kind === 'settings') this.ui.updateSettings(this.settings);
    this.overlay = kind;
    this.input.setMode('menu');
    this.ui.setOverlay(kind);
    this.audio.uiSound('open');
  }

  closeOverlay(): void {
    if (!this.overlay) return;
    this.overlay = null;
    this.ui.setOverlay(null);
    this.audio.uiSound('close');
    if (this.overlayReturn === 'play') this.resume(false);
  }

  private back(): void {
    if (this.overlay) this.closeOverlay();
    else if (this.ui.pauseConfirming) this.ui.cancelPauseConfirm();
    else if (this.screen === 'paused') this.resume();
    else if (this.screen === 'playing') this.pause();
  }

  // ---------- Eingabe ----------

  private beginFrame(): void {
    this.input.poll();
    for (const a of this.input.takeActions()) this.onAction(a);
    this.updateTouch();
    // Koop erst wählbar, wenn Spieler 2 ein Gerät hat (Taste gedrückt / Gamepad erkannt)
    if (this.screen === 'title') this.ui.title.setCoopAvailable(this.input.coopAvailable);
  }

  /** Eingaben eines Simulationsschritts; merkt sich die erste Spieleingabe (Dauer der Einführung). */
  private gameInputs(count: number): readonly PlayerInput[] {
    const inputs = this.input.playerInputs(count);
    const g = this.game;
    if (this.introFrom === null && g && inputs.some((i) => i.left || i.right || i.sprint || i.act)) this.introFrom = g.time;
    return inputs;
  }

  onAction(a: MenuAction): void {
    const s = this.screen;
    if (s === 'loading') return;
    switch (a) {
      case 'escape':
      case 'back':
        this.back();
        break;
      case 'pause':
        if (s === 'playing') this.pause();
        else this.back();
        break;
      case 'help':
        if (this.overlay === 'help') this.closeOverlay();
        else this.openOverlay('help');
        break;
      case 'mute':
        this.applySettings({ ...this.settings, muted: !this.settings.muted });
        if (this.game && s !== 'title') this.ui.toast(t(this.settings.muted ? 'settings.mutedOn' : 'settings.mutedOff'), { kind: 'muted', key: 'mute' });
        break;
      case 'quicksave':
        if (this.game && (s === 'playing' || s === 'paused')) this.saveTo('slot1', 'manual');
        break;
      case 'quickload':
        if (!this.overlay) this.loadFrom(this.latestSlot());
        break;
      case 'navUp':
      case 'navDown':
      case 'navLeft':
      case 'navRight':
      case 'confirm':
        this.ui.nav(a);
        break;
    }
  }

  private updateTouch(): void {
    const visible = this.input.touchWanted && this.screen === 'playing' && !this.overlay;
    this.input.touch.setVisible(visible);
    this.root.classList.toggle('touch-on', visible);
  }

  // ---------- Simulation → App/UI ----------

  private onSimEvents(events: readonly SimEvent[], game: GameState): void {
    for (const e of events) this.recent.push(e);
    if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX);
    if (game !== this.game) return;
    for (const e of events) {
      if (e.type === 'crownLost' && !this.crownLoss) this.crownLoss = { playerId: e.playerId, x: e.x };
    }
    // Nach Sieg/Niederlage läuft die Welt nur noch zur Darstellung weiter: keine Hinweise/Banner mehr
    const live = liveEvents(events, game);
    if (live.length) this.ui.handleEvents(live, game);
    // Autosave bei jedem neuen Morgen
    if (game.outcome === 'playing' && events.some((e) => e.type === 'phaseChange' && e.phase === 'day')) {
      this.saveTo('auto', 'auto');
    }
    this.checkOutcome();
  }

  /** Nach Sieg/Niederlage mit kurzer Verzögerung den Endbildschirm zeigen. */
  private checkOutcome(): void {
    const g = this.game;
    if (!g || g.outcome === 'playing') return;
    if (this.screen !== 'playing' && this.screen !== 'paused') return;
    if (g.time - g.outcomeTime < END_SCREEN_DELAY) return;
    this.overlay = null;
    this.ui.setOverlay(null);
    // „Letzten Spielstand laden" nur nach einer Niederlage anbieten
    this.ui.showEnd(g.outcome, g, g.outcome === 'defeat' && !!newestSave(), this.crownLoss);
    this.setScreen(g.outcome);
  }

  private endFrame(dt: number, game: GameState | null): void {
    this.checkOutcome();
    if (!game) {
      this.ui.update(null, null, dt, false);
      return;
    }
    this.focus = game.players.map((p) => {
      try {
        return getPlayerFocus(game, p.id);
      } catch {
        return null;
      }
    });
    const touch = this.input.touch.isVisible;
    const devices = game.players.map((_, i) => this.input.deviceOf(i));
    const introOn =
      game.day === 1 &&
      game.phase === 'day' &&
      game.outcome === 'playing' &&
      (this.introFrom === null || game.time < this.introFrom + INTRO_SECONDS);
    const intro = introOn ? introText(game.coop, devices, touch) : null;
    const view: HudView = {
      coop: game.coop,
      holds: devices.map((d, i) => holdLabel(d, i, game.coop, this.input.keyboardSide)),
      taps: devices.map((d, i) => tapLabel(d, i, game.coop, this.input.keyboardSide)),
      focus: this.focus,
      intro,
      timeScale: this.loop.timeScale,
      touch,
    };
    this.ui.update(game, view, dt, this.screen === 'paused');
  }

  // ---------- Speichern / Laden ----------

  saveTo(slot: string, mode: SaveMode): boolean {
    const g = this.game;
    const loud = mode === 'manual';
    if (!g) {
      if (loud) this.ui.toast(t('save.noGame'), { kind: 'warn' });
      return false;
    }
    if (g.outcome !== 'playing') {
      if (loud) this.ui.toast(t('save.notPlaying'), { kind: 'warn' });
      return false;
    }
    let err: string | null;
    try {
      err = writeSlot(slot, serializeGame(g, new Date().toISOString()));
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    if (err) {
      if (mode !== 'silent') {
        this.ui.toast(t('save.failed', { error: err }), { kind: 'danger' });
        this.audio.uiSound('error');
      }
      return false;
    }
    if (mode === 'manual') this.ui.toast(t('save.done'), { kind: 'good', key: 'saved' });
    else if (mode === 'auto') this.ui.toast(t('save.auto'), { kind: 'muted', key: 'autosave', duration: 2.6 });
    if (this.screen === 'paused') this.ui.refreshPause(newestSave());
    return true;
  }

  loadFrom(slot: string | undefined, mode: SaveMode = 'manual'): boolean {
    const text = slot ? readSlot(slot) : null;
    const fail = (msg: string) => {
      if (mode !== 'silent') {
        // Im Titel ist das HUD (und damit die Hinweisleiste) ausgeblendet → Meldung im Titelmenü
        if (this.screen === 'title') this.ui.title.showError(msg);
        else this.ui.toast(msg, { kind: 'danger', duration: 5 });
        this.audio.uiSound('error');
      }
      return false;
    };
    if (!text) return fail(t('load.missing'));
    let state: GameState;
    try {
      const r = deserializeGame(text);
      if (!r.ok) return fail(t('load.failed', { error: r.error }));
      state = r.state;
    } catch (e) {
      return fail(t('load.failed', { error: e instanceof Error ? e.message : String(e) }));
    }
    if (!state || !Array.isArray(state.players) || state.players.length === 0 || !Array.isArray(state.structures)) {
      return fail(t('load.failed', { error: 'Ungültiger Spielstand' }));
    }
    this.startWith(state);
    if (mode !== 'silent') this.ui.toast(t('load.done', { day: state.day }), { kind: 'good', key: 'loaded' });
    return true;
  }

  // ---------- Einstellungen ----------

  applySettings(s: Settings): void {
    this.settings = { ...s };
    saveSettings(this.settings);
    this.audio.setSettings(this.settings);
    this.input.setForceTouch(this.settings.forceTouch);
    this.ui.updateSettings(this.settings);
    this.updateTouch();
  }

  private toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    } catch {
      /* Vollbild nicht verfügbar */
    }
  }

  // ---------- Debug ----------

  recentEvents(n = 50): SimEvent[] {
    return this.recent.slice(-Math.max(0, n));
  }

  hintTexts(): string[] {
    return this.ui.hud.hintTexts();
  }
}
