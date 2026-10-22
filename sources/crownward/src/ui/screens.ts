// Crownward – Bildschirme: Laden, Titel, Pause, Spielende.

import type { GameState } from '../sim';
import type { SaveMeta } from '../app/storage';
import { el, setText } from './dom';
import { icon } from './icons';
import { savedAtText, t } from './i18n';
import { endSubtitle, type CrownLoss } from './outcome';

/** Menüknopf mit optionaler Unterzeile und Tastenkürzel. */
export function menuButton(label: string, opts: { sub?: string; kbd?: string; act?: string; primary?: boolean } = {}): HTMLButtonElement {
  const b = el(
    `button.mbtn${opts.primary ? '.mbtn-primary' : ''}`,
    { type: 'button', 'data-act': opts.act },
    el('span.mbtn-label', { text: label }),
    opts.sub ? el('small.mbtn-sub', { text: opts.sub }) : null,
    opts.kbd ? el('kbd.mbtn-kbd', { text: opts.kbd }) : null,
  );
  return b;
}

const slotName = (slot: string) => (slot === 'auto' ? t('save.slot.auto') : t('save.slot.slot1'));

// ---------- Laden ----------

export class LoadingScreen {
  readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly pct: HTMLElement;

  constructor() {
    this.bar = el('i.loading-fill');
    this.pct = el('span.loading-pct', { text: t('app.loadingPct', { pct: 0 }) });
    this.root = el(
      'section.screen.screen-loading',
      { 'aria-busy': 'true' },
      el('div.loading-inner', null,
        el('h1.logo.logo-small', { text: t('app.title') }),
        el('div.loading-track', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.bar),
        el('div.loading-text', null, el('span', { text: t('app.loading') }), this.pct),
      ),
    );
  }

  set(fraction: number): void {
    const p = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    this.bar.style.width = `${p}%`;
    this.bar.parentElement?.setAttribute('aria-valuenow', String(p));
    setText(this.pct, t('app.loadingPct', { pct: p }));
  }
}

// ---------- Titel ----------

export interface TitleHandlers {
  continueGame(): void;
  newGame(coop: boolean): void;
  openHelp(): void;
  openSettings(): void;
}

export class TitleScreen {
  readonly root: HTMLElement;
  readonly menu: HTMLElement;
  private readonly art: HTMLElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly continueSub: HTMLElement;
  private readonly coopBtn: HTMLButtonElement;
  private readonly coopSub: HTMLElement;
  private coopAvailable = true;
  /** Fehlermeldung (z. B. Speicherstand nicht ladbar) – im Titel gibt es kein HUD für Hinweise */
  private readonly error: HTMLElement;
  /** dauerhafter Hinweis (z. B. fehlende Grafiken) */
  private readonly notice: HTMLElement;
  /** Ladezustand des Titelbilds (für assetReport) */
  artState: 'pending' | 'loaded' | 'missing' = 'pending';

  constructor(h: TitleHandlers, version: string, artUrl: string) {
    this.continueBtn = menuButton(t('menu.continue'), { sub: ' ', act: 'continue', primary: true });
    this.continueSub = this.continueBtn.querySelector('.mbtn-sub')!;
    const newBtn = menuButton(t('menu.newGame'), { sub: t('menu.newGameSub'), act: 'new' });
    const coopBtn = menuButton(t('menu.coop'), { sub: t('menu.coopSub'), act: 'coop' });
    this.coopBtn = coopBtn;
    this.coopSub = coopBtn.querySelector('.mbtn-sub')!;
    const helpBtn = menuButton(t('menu.controls'), { act: 'controls', kbd: 'H' });
    const setBtn = menuButton(t('menu.settings'), { act: 'settings' });
    this.continueBtn.addEventListener('click', () => h.continueGame());
    newBtn.addEventListener('click', () => h.newGame(false));
    coopBtn.addEventListener('click', () => {
      if (this.coopAvailable) h.newGame(true);
    });
    helpBtn.addEventListener('click', () => h.openHelp());
    setBtn.addEventListener('click', () => h.openSettings());

    this.menu = el('nav.menu.title-menu', { 'aria-label': 'Hauptmenü' }, this.continueBtn, newBtn, coopBtn, helpBtn, setBtn);
    this.error = el('p.title-error', { role: 'alert' });
    this.error.hidden = true;
    this.notice = el('p.title-notice', { role: 'status' });
    this.notice.hidden = true;
    this.art = el('div.title-art', { role: 'img', 'aria-label': 'Morgenrand in der Abenddämmerung' });
    this.root = el(
      'section.screen.screen-title',
      null,
      this.art,
      el('div.title-shade'),
      el(
        'div.title-content',
        null,
        el('div.title-crown', { html: icon('crown', 5) }),
        el('h1.logo', { text: t('app.title') }),
        el('p.subtitle', { text: t('app.subtitle') }),
        el('p.tagline', { text: t('app.tagline') }),
        this.menu,
        this.error,
        this.notice,
      ),
      el('footer.title-footer', { text: t('app.footer', { version }) }),
    );

    // Titelbild vorladen, erst dann einblenden
    const img = new Image();
    img.onload = () => {
      this.artState = 'loaded';
      this.art.style.backgroundImage = `url("${artUrl}")`;
      this.art.classList.add('ready');
    };
    img.onerror = () => {
      this.artState = 'missing';
      this.art.classList.add('missing');
    };
    img.src = artUrl;
  }

  /** Zeigt eine Fehlermeldung unter dem Menü (bis zum nächsten Aktualisieren des Titels). */
  showError(text: string): void {
    setText(this.error, text);
    this.error.hidden = false;
  }

  /**
   * Koop braucht für Spieler 2 eine Tastatur oder ein Gamepad – die Bildschirmtasten steuern nur Spieler 1. Auf
   * reinen Touch-Geräten ist der Knopf deshalb gesperrt und nennt den Grund (wird wieder frei, sobald eine Taste
   * gedrückt oder ein Gamepad erkannt wird).
   */
  setCoopAvailable(available: boolean): void {
    if (available === this.coopAvailable) return;
    this.coopAvailable = available;
    const focused = document.activeElement === this.coopBtn;
    this.coopBtn.disabled = !available;
    this.coopBtn.classList.toggle('mbtn-unavailable', !available);
    setText(this.coopSub, t(available ? 'menu.coopSub' : 'menu.coopNeedsKeys'));
    // Fokus nicht auf einem gesperrten Knopf stehen lassen
    if (focused && !available) (this.menu.querySelector('button:not([disabled]):not([hidden])') as HTMLButtonElement | null)?.focus();
  }

  get isCoopAvailable(): boolean {
    return this.coopAvailable;
  }

  /** Dauerhafter Hinweis unter dem Menü (null = keiner). */
  setNotice(text: string | null): void {
    setText(this.notice, text ?? '');
    this.notice.hidden = !text;
  }

  /**
   * meta: neuester ladbarer Stand („Fortsetzen"); blocked: neuerer, aber unladbarer Stand – sein Grund steht
   * gleich unter dem Menü, statt erst nach einem Klick auf einen Knopf, der nie funktionieren kann.
   */
  setSave(meta: SaveMeta | null, blocked: SaveMeta | null = null): void {
    this.error.hidden = true;
    this.continueBtn.hidden = !meta;
    if (meta) {
      setText(this.continueSub, t('menu.continueSub', { day: meta.day, slot: slotName(meta.slot), when: savedAtText(meta.savedAt) }));
    }
    if (blocked?.error) this.showError(t('load.blocked', { slot: slotName(blocked.slot), error: blocked.error }));
  }
}

// ---------- Pause ----------

export interface PauseHandlers {
  resume(): void;
  save(): void;
  load(): void;
  openSettings(): void;
  openHelp(): void;
  mainMenu(): void;
}

export class PauseMenu {
  readonly root: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly loadBtn: HTMLButtonElement;
  private readonly info: HTMLElement;

  constructor(h: PauseHandlers) {
    const resume = menuButton(t('pause.resume'), { act: 'resume', kbd: 'Esc', primary: true });
    const save = menuButton(t('pause.save'), { act: 'save', kbd: 'F5' });
    this.loadBtn = menuButton(t('pause.load'), { act: 'load', kbd: 'F9' });
    const settings = menuButton(t('pause.settings'), { act: 'settings' });
    const help = menuButton(t('pause.controls'), { act: 'controls', kbd: 'H' });
    const main = menuButton(t('pause.mainMenu'), { act: 'mainMenu' });
    resume.addEventListener('click', () => h.resume());
    save.addEventListener('click', () => h.save());
    this.loadBtn.addEventListener('click', () => h.load());
    settings.addEventListener('click', () => h.openSettings());
    help.addEventListener('click', () => h.openHelp());
    main.addEventListener('click', () => this.askMainMenu());

    this.info = el('p.panel-note');
    this.menu = el('nav.menu', { 'aria-label': t('pause.title') }, resume, save, this.loadBtn, settings, help, main);

    const yes = menuButton(t('pause.confirmYes'), { act: 'confirmYes' });
    const no = menuButton(t('pause.confirmNo'), { act: 'confirmNo', primary: true });
    yes.addEventListener('click', () => {
      this.resetConfirm();
      h.mainMenu();
    });
    no.addEventListener('click', () => {
      this.resetConfirm();
      (this.menu.querySelector('button') as HTMLButtonElement | null)?.focus();
    });
    this.confirm = el('div.confirm', { role: 'alertdialog' }, el('p.confirm-text', { text: t('pause.confirmMenu') }), el('div.menu', null, no, yes));
    this.confirm.hidden = true;

    this.root = el(
      'section.screen.screen-pause',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pause.title') },
      el('div.panel', null, el('h2.panel-title', { text: t('pause.title') }), this.menu, this.confirm, this.info),
    );
  }

  private askMainMenu(): void {
    this.menu.hidden = true;
    this.confirm.hidden = false;
    (this.confirm.querySelector('[data-act="confirmNo"]') as HTMLButtonElement | null)?.focus();
  }

  resetConfirm(): void {
    this.menu.hidden = false;
    this.confirm.hidden = true;
  }

  /** true, wenn gerade die Rückfrage „Hauptmenü?" offen ist (Esc schließt dann nur diese). */
  get confirming(): boolean {
    return !this.confirm.hidden;
  }

  setSaveInfo(meta: SaveMeta | null): void {
    this.loadBtn.disabled = !meta;
    setText(this.info, meta ? t('pause.lastSave', { day: meta.day, when: savedAtText(meta.savedAt) }) : t('pause.noSave'));
  }
}

// ---------- Spielende ----------

export interface EndHandlers {
  restart(): void;
  loadLast(): void;
  mainMenu(): void;
}

export class EndScreen {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly loadBtn: HTMLButtonElement;

  constructor(h: EndHandlers) {
    this.title = el('h2.end-title');
    this.sub = el('p.end-sub');
    this.stats = el('dl.end-stats');
    const restart = menuButton(t('end.restart'), { act: 'restart', primary: true });
    this.loadBtn = menuButton(t('end.loadLast'), { act: 'loadLast' });
    const main = menuButton(t('end.mainMenu'), { act: 'mainMenu' });
    restart.addEventListener('click', () => h.restart());
    this.loadBtn.addEventListener('click', () => h.loadLast());
    main.addEventListener('click', () => h.mainMenu());
    this.root = el(
      'section.screen.screen-end',
      { role: 'dialog', 'aria-modal': 'true' },
      el(
        'div.panel.end-panel',
        null,
        el('div.end-crown', { html: icon('crown', 6) }),
        this.title,
        this.sub,
        el('h3.end-stats-title', { text: t('end.stats') }),
        this.stats,
        el('nav.menu.end-menu', null, restart, this.loadBtn, main),
      ),
    );
  }

  /** loss: Ort und Spieler des Kronverlusts – der Untertitel nennt die tatsächliche Ursache. */
  show(outcome: 'victory' | 'defeat', state: GameState, canLoad: boolean, loss: CrownLoss | null = null): void {
    this.root.dataset.outcome = outcome;
    setText(this.title, t(outcome === 'victory' ? 'end.victory' : 'end.defeat'));
    setText(this.sub, endSubtitle(outcome, state, loss));
    const s = state.stats;
    const rows: [string, number][] = [
      ['end.days', state.day],
      ['end.coinsCollected', s.coinsCollected],
      ['end.coinsSpent', s.coinsSpent],
      ['end.enemiesSlain', s.enemiesSlain],
      ['end.recruited', s.recruited],
      ['end.wallsLost', s.wallsLost],
      ['end.citizensLost', s.citizensLost],
      ['end.chestsOpened', s.chestsOpened],
    ];
    this.stats.replaceChildren(
      ...rows.map(([k, v]) => el('div.end-stat', null, el('dt', { text: t(k) }), el('dd', { text: String(v ?? 0) }))),
    );
    this.loadBtn.hidden = !canLoad;
  }
}
