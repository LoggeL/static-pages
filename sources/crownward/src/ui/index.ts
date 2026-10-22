// Crownward – UI-Fassade: verwaltet Bildschirme, Overlays, HUD, Hinweise und Menünavigation.
// Die App (src/app/app.ts) entscheidet über Zustände; die UI zeigt sie nur an und meldet Absichten.

import type { GameState, SimEvent } from '../sim';
import type { SaveMeta, Settings } from '../app/storage';
import type { LayoutMode } from '../app/layout';
import { el, focusables } from './dom';
import { feedEvents } from './feed';
import { Hud, type HudView } from './hud';
import { t } from './i18n';
import { HelpOverlay, SettingsOverlay } from './overlays';
import { EndScreen, LoadingScreen, PauseMenu, TitleScreen, type EndHandlers, type PauseHandlers, type TitleHandlers } from './screens';
import { Toasts, type ToastOptions } from './toasts';
import type { CrownLoss } from './outcome';

export type Screen = 'loading' | 'title' | 'playing' | 'paused' | 'victory' | 'defeat';
export type Overlay = 'help' | 'settings' | null;
export type NavAction = 'navUp' | 'navDown' | 'navLeft' | 'navRight' | 'confirm';

export interface UiHandlers extends TitleHandlers, PauseHandlers, EndHandlers {
  closeOverlay(): void;
  settingsChanged(s: Settings): void;
  toggleFullscreen(): void;
  pause(): void;
}

export { t } from './i18n';
export type { HudView } from './hud';
export type { CrownLoss } from './outcome';

export class GameUI {
  readonly hud: Hud;
  readonly toasts: Toasts;
  readonly loading: LoadingScreen;
  readonly title: TitleScreen;
  readonly pause: PauseMenu;
  readonly end: EndScreen;
  readonly help: HelpOverlay;
  readonly settings: SettingsOverlay;
  private screen: Screen = 'loading';
  private overlay: Overlay = null;
  private touchRoot: HTMLElement | null = null;
  private readonly portraitTip: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly dock: HTMLElement,
    h: UiHandlers,
    settings: Settings,
    version: string,
    artUrl: string,
  ) {
    this.hud = new Hud(() => h.pause());
    this.toasts = new Toasts();
    this.hud.toastSlot.append(this.toasts.root);
    this.loading = new LoadingScreen();
    this.title = new TitleScreen(h, version, artUrl);
    this.pause = new PauseMenu(h);
    this.end = new EndScreen(h);
    this.help = new HelpOverlay(() => h.closeOverlay());
    this.settings = new SettingsOverlay(settings, {
      change: (s) => h.settingsChanged(s),
      close: () => h.closeOverlay(),
      fullscreen: () => h.toggleFullscreen(),
    });
    this.portraitTip = el('p.portrait-tip', { text: t('app.portraitTip') });

    this.stage.append(this.toasts.bannerRoot);
    this.root.querySelector('.boot-splash')?.remove();
    this.root.append(this.loading.root, this.title.root, this.pause.root, this.end.root, this.help.root, this.settings.root);
    this.hud.root.hidden = true;
    this.apply();
  }

  /** Touch-Tasten einhängen (Element gehört der Eingabeschicht). */
  mountTouch(touchRoot: HTMLElement): void {
    this.touchRoot = touchRoot;
  }

  /** Quer-/Hochformat: HUD und Touch-Tasten liegen über dem Canvas bzw. im Dock darunter. */
  setLayout(mode: LayoutMode): void {
    const parent = mode === 'portrait' ? this.dock : this.stage;
    parent.append(this.hud.root);
    if (mode === 'portrait') this.dock.append(this.portraitTip);
    else this.portraitTip.remove();
    if (this.touchRoot) parent.append(this.touchRoot);
  }

  setLoading(fraction: number): void {
    this.loading.set(fraction);
  }

  setScreen(screen: Screen): void {
    if (screen === this.screen) return;
    const prev = this.screen;
    this.screen = screen;
    if (screen !== 'paused') this.pause.resetConfirm();
    this.apply();
    if (screen !== 'playing' && prev !== screen) this.focusPanel();
  }

  setOverlay(overlay: Overlay): void {
    if (overlay === this.overlay) return;
    this.overlay = overlay;
    this.apply();
    this.focusPanel();
  }

  private apply(): void {
    const s = this.screen;
    const o = this.overlay;
    this.loading.root.hidden = s !== 'loading';
    // Titelbild bleibt unter Overlays sichtbar (nur das Menü verschwindet)
    this.title.root.hidden = s !== 'title';
    this.title.root.classList.toggle('behind', o !== null);
    this.pause.root.hidden = s !== 'paused' || o !== null;
    this.end.root.hidden = !(s === 'victory' || s === 'defeat') || o !== null;
    this.help.root.hidden = o !== 'help';
    this.settings.root.hidden = o !== 'settings';
    const inGame = s === 'playing' || s === 'paused' || s === 'victory' || s === 'defeat';
    this.hud.root.hidden = !inGame;
    this.root.dataset.screen = s;
    this.root.dataset.overlay = o ?? '';
    document.documentElement.dataset.screen = s;
  }

  /** Aktives Menü-Panel (für Tastatur/Gamepad-Navigation) oder null im Spiel. */
  private activePanel(): HTMLElement | null {
    if (this.overlay === 'help') return this.help.root;
    if (this.overlay === 'settings') return this.settings.root;
    switch (this.screen) {
      case 'title':
        return this.title.root;
      case 'paused':
        return this.pause.root;
      case 'victory':
      case 'defeat':
        return this.end.root;
      default:
        return null;
    }
  }

  /** Erstes Bedienelement des aktiven Panels fokussieren (Tastatur/Gamepad sofort bedienbar). */
  focusPanel(): void {
    const panel = this.activePanel();
    if (!panel) {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && this.root.contains(a)) a.blur();
      return;
    }
    const first = focusables(panel)[0];
    first?.focus({ preventScroll: true });
  }

  nav(action: NavAction): void {
    const panel = this.activePanel();
    if (!panel) return;
    if (this.overlay === 'help' && (action === 'navUp' || action === 'navDown')) {
      this.help.scroll(action === 'navUp' ? -1 : 1);
      return;
    }
    const items = focusables(panel);
    if (items.length === 0) return;
    const cur = document.activeElement as HTMLElement | null;
    const idx = cur ? items.indexOf(cur) : -1;
    const focus = (n: HTMLElement) => n.focus({ preventScroll: false });
    switch (action) {
      case 'navUp':
        focus(items[(idx <= 0 ? items.length : idx) - 1]);
        break;
      case 'navDown':
        focus(items[(idx + 1) % items.length]);
        break;
      case 'navLeft':
      case 'navRight':
        if (cur instanceof HTMLInputElement && cur.type === 'range') this.settings.nudge(cur, action === 'navLeft' ? -1 : 1);
        break;
      case 'confirm':
        if (idx >= 0 && cur) cur.click();
        else focus(items[0]);
        break;
    }
  }

  get pauseConfirming(): boolean {
    return this.screen === 'paused' && this.pause.confirming;
  }

  cancelPauseConfirm(): void {
    this.pause.resetConfirm();
    this.focusPanel();
  }

  /** blocked: neuerer, aber unladbarer Speicherstand (Hinweis statt totem „Fortsetzen"). */
  refreshTitle(meta: SaveMeta | null, blocked: SaveMeta | null = null): void {
    this.title.setSave(meta, blocked);
  }

  refreshPause(meta: SaveMeta | null): void {
    this.pause.setSaveInfo(meta);
  }

  showEnd(outcome: 'victory' | 'defeat', state: GameState, canLoad: boolean, loss: CrownLoss | null = null): void {
    // Banner („Die Krone ist verloren!") und Hinweise sofort weg – keine zweite Überschrift über dem Endbildschirm
    this.toasts.clear(true);
    this.end.show(outcome, state, canLoad, loss);
  }

  updateSettings(s: Settings): void {
    this.settings.set(s);
  }

  /** Neues/geladenes Spiel: Hinweise und HUD-Zwischenstände zurücksetzen. */
  resetForGame(): void {
    this.toasts.clear();
    this.hud.reset();
  }

  toast(text: string, opts?: ToastOptions): void {
    this.toasts.push(text, opts);
  }

  handleEvents(events: readonly SimEvent[], state: GameState): void {
    feedEvents(events, state, this.toasts);
  }

  update(state: GameState | null, view: HudView | null, dt: number, paused: boolean): void {
    this.toasts.update(paused ? 0 : dt);
    // Geteilter Bildschirm: Banner/Hinweise weichen den beiden Ansichten aus (styles.css .stage.split)
    if (view) this.stage.classList.toggle('split', view.coop);
    if (state && view && !this.hud.root.hidden) this.hud.update(state, view, dt);
  }
}
