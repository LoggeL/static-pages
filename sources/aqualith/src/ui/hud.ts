/// <reference types="vite/client" />
import { t } from '../i18n.ts';
import type { GameStateSnapshot, Lang, LevelProgress, ObjectiveStatus, ToolId } from '../types.ts';
import './styles.css';

export type SandboxAction =
  | 'tsunami'
  | 'toggleSpouts'
  | 'addTurbine'
  | 'addArk'
  | 'addMagma'
  | 'addWall'
  | 'addMine'
  | 'addSeesaw'
  | 'clearWater';

export interface HUDCallbacks {
  onStartCampaign: () => void;
  onSelectLevel: (index: number) => void;
  onOpenSandbox: () => void;
  onSelectTool: (tool: ToolId) => void;
  onShatterIce: () => void;
  onToggleSlowMo: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onToggleQuality: () => void;
  onToggleLang: () => void;
  onOpenMenu: () => void;
  onNextLevel: () => void;
  onSandboxAction: (action: SandboxAction) => void;
}

interface ObjectiveRowRefs {
  root: HTMLLIElement;
  checkIcon: HTMLSpanElement;
  labelEl: HTMLSpanElement;
  detailEl: HTMLSpanElement;
  fillEl: HTMLDivElement;
}

interface ToolButtonRefs {
  tool: ToolId;
  button: HTMLButtonElement;
  labelEl: HTMLSpanElement;
  hotkeyEl: HTMLSpanElement;
  labelKey: string;
  descKey: string;
}

interface SandboxButtonRefs {
  action: SandboxAction;
  button: HTMLButtonElement;
  labelEl: HTMLSpanElement;
  statusDot?: HTMLSpanElement;
  labelKey: string;
}

interface ChapterCardRefs {
  chapterIndex: number | 'sandbox';
  button: HTMLButtonElement;
  badgeEl: HTMLSpanElement;
  starsWrap: HTMLDivElement;
  starEls: SVGSVGElement[];
  titleEl: HTMLDivElement;
  subEl: HTMLDivElement;
  metaEl: HTMLDivElement;
}

const NUMERIC_UPDATE_INTERVAL_MS = 66;
const CAMPAIGN_CHAPTER_COUNT = 7;

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgIcon(paths: string[], viewBox = '0 0 24 24', className = 'aq-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.85');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function createStarSvg(className = 'aq-star-svg'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    'M12 2.4l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.3l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.4z'
  );
  svg.appendChild(path);
  return svg;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatPreciseClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  const whole = Math.floor(rem);
  const tenths = Math.min(9, Math.floor((rem - whole) * 10));
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('de-DE');
}

function findChapterProgress(
  levelProgress: Record<string, LevelProgress>,
  chapterIndex: number,
  snapshot?: GameStateSnapshot
): LevelProgress | undefined {
  if (snapshot && snapshot.levelIndex === chapterIndex && levelProgress[snapshot.levelId]) {
    return levelProgress[snapshot.levelId];
  }
  const candidates = [
    String(chapterIndex),
    `lvl${chapterIndex}`,
    `lvl_${chapterIndex}`,
    `lvl-${chapterIndex}`,
    `lvl.${chapterIndex}`,
    `level${chapterIndex}`,
    `level_${chapterIndex}`,
    `level-${chapterIndex}`,
    `ch${chapterIndex}`,
    `chapter${chapterIndex}`,
    `chapter-${chapterIndex}`,
  ];
  for (const key of candidates) {
    if (levelProgress[key]) return levelProgress[key];
  }
  const suffixRe = new RegExp(`(?:^|[^\\d])${chapterIndex}$`);
  for (const [key, val] of Object.entries(levelProgress)) {
    if (suffixRe.test(key) && !key.includes('sb') && !key.includes('demo')) {
      return val;
    }
  }
  return undefined;
}

function hasCampaignProgress(levelProgress: Record<string, LevelProgress>): boolean {
  for (const [key, entry] of Object.entries(levelProgress)) {
    if (key.includes('sb') || key.includes('demo')) continue;
    if (entry.stars > 0 || entry.bestTime !== null) return true;
  }
  return false;
}

/**
 * Persistent DOM HUD controller for AQUALITH.
 * Creates interactive nodes once and patches attributes/text smoothly without
 * dropping clicks during 60fps simulation updates.
 */
export class HUDController {
  private readonly root: HTMLElement;
  private readonly callbacks: HUDCallbacks;

  private chapterModalOpen = false;
  private hintCollapsed = false;
  private tutorialDismissed = false;
  private lastNumericUpdateMs = 0;

  private lastScreen: GameStateSnapshot['screen'] | null = null;
  private lastLevelIndex = -1;
  private lastIsSandbox: boolean | null = null;
  private lastLang: Lang | null = null;
  private lastObjectiveSig = '';
  private lastSnapshot: GameStateSnapshot | null = null;

  // Title overlay refs
  private readonly titleScreen: HTMLDivElement;
  private readonly titleMuteBtn: HTMLButtonElement;
  private readonly titleMuteOnIcon: SVGSVGElement;
  private readonly titleMuteOffIcon: SVGSVGElement;
  private readonly titleLangBtn: HTMLButtonElement;
  private readonly titleLangDeSpan: HTMLSpanElement;
  private readonly titleLangEnSpan: HTMLSpanElement;
  private readonly titleSubtitleEl: HTMLDivElement;
  private readonly titleMainEl: HTMLHeadingElement;
  private readonly titleTaglineEl: HTMLParagraphElement;
  private readonly startCampaignBtn: HTMLButtonElement;
  private readonly startCampaignLabel: HTMLSpanElement;
  private readonly openSandboxBtn: HTMLButtonElement;
  private readonly openSandboxLabel: HTMLSpanElement;
  private readonly openChaptersBtn: HTMLButtonElement;
  private readonly openChaptersLabel: HTMLSpanElement;
  private readonly demoBadgeEl: HTMLDivElement;
  private readonly demoBadgeTextEl: HTMLSpanElement;

  // Playing HUD refs
  private readonly playingHud: HTMLDivElement;
  private readonly levelBadgePill: HTMLSpanElement;
  private readonly levelTitleEl: HTMLDivElement;
  private readonly levelSubEl: HTMLDivElement;
  private readonly objectivesList: HTMLUListElement;
  private objectiveRows: ObjectiveRowRefs[] = [];
  private readonly hintCard: HTMLDivElement;
  private readonly hintToggleBtn: HTMLButtonElement;
  private readonly hintLabelEl: HTMLSpanElement;
  private readonly hintBodyEl: HTMLParagraphElement;

  // Top-right panel refs
  private readonly timerValueEl: HTMLSpanElement;
  private readonly parValueEl: HTMLSpanElement;
  private readonly frostBarFill: HTMLDivElement;
  private readonly frostBarTrack: HTMLDivElement;
  private readonly frostValueEl: HTMLSpanElement;
  private readonly waterValueEl: HTMLSpanElement;
  private readonly fpsValueEl: HTMLSpanElement;
  private readonly slowMoBtn: HTMLButtonElement;
  private readonly slowMoLabelEl: HTMLSpanElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly muteOnIcon: SVGSVGElement;
  private readonly muteOffIcon: SVGSVGElement;
  private readonly qualityBtn: HTMLButtonElement;
  private readonly qualityLabelEl: HTMLSpanElement;
  private readonly langBtn: HTMLButtonElement;
  private readonly langDeSpan: HTMLSpanElement;
  private readonly langEnSpan: HTMLSpanElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly menuLabelEl: HTMLSpanElement;

  // Floating status badges
  private readonly slowMoBanner: HTMLDivElement;
  private readonly slowMoBannerText: HTMLSpanElement;
  private readonly tutorialPill: HTMLDivElement;
  private readonly tutorialText: HTMLSpanElement;

  // Bottom tool dock refs
  private readonly sandboxRow: HTMLDivElement;
  private readonly coreDockRow: HTMLDivElement;
  private readonly toolButtons: ToolButtonRefs[] = [];
  private readonly sandboxButtons: SandboxButtonRefs[] = [];
  private readonly shatterBtn: HTMLButtonElement;
  private readonly shatterLabelEl: HTMLSpanElement;

  // Chapter select modal refs
  private readonly chapterBackdrop: HTMLDivElement;
  private readonly chapterTitleEl: HTMLHeadingElement;
  private readonly chapterCloseBtn: HTMLButtonElement;
  private readonly chapterCards: ChapterCardRefs[] = [];

  // Victory modal refs
  private readonly victoryBackdrop: HTMLDivElement;
  private readonly victoryStars: SVGSVGElement[] = [];
  private readonly victoryBannerEl: HTMLDivElement;
  private readonly victoryTitleEl: HTMLHeadingElement;
  private readonly victorySubEl: HTMLParagraphElement;
  private readonly victoryTimeLabel: HTMLSpanElement;
  private readonly victoryTimeVal: HTMLSpanElement;
  private readonly victoryParLabel: HTMLSpanElement;
  private readonly victoryParVal: HTMLSpanElement;
  private readonly victoryNextBtn: HTMLButtonElement;
  private readonly victoryNextLabel: HTMLSpanElement;
  private readonly victoryReplayBtn: HTMLButtonElement;
  private readonly victoryReplayLabel: HTMLSpanElement;
  private readonly victoryChaptersBtn: HTMLButtonElement;
  private readonly victoryChaptersLabel: HTMLSpanElement;

  constructor(rootEl: HTMLElement, callbacks: HUDCallbacks);
  constructor(callbacks: HUDCallbacks);
  constructor(rootOrCallbacks: HTMLElement | HUDCallbacks, maybeCallbacks?: HUDCallbacks) {
    if (maybeCallbacks !== undefined) {
      this.root = rootOrCallbacks as HTMLElement;
      this.callbacks = maybeCallbacks;
    } else {
      const el = document.getElementById('ui-root');
      if (!el) {
        throw new Error('HUDController: #ui-root element not found');
      }
      this.root = el;
      this.callbacks = rootOrCallbacks as HUDCallbacks;
    }

    this.root.textContent = '';
    this.root.classList.add('aq-ui-root');

    // =========================================================================
    // 1. TITLE OVERLAY (Upper band so WebGL waterfall demo shines below)
    // =========================================================================
    this.titleScreen = this.el('div', 'aq-title-screen');

    const titleTopbar = this.el('div', 'aq-title-topbar');
    this.titleMuteBtn = this.makeButton('aq-icon-btn aq-glass-pill', () => this.callbacks.onToggleMute());
    this.titleMuteOnIcon = createSvgIcon([
      'M11 5L6 9H2v6h4l5 4V5z',
      'M15.5 8.5a5 5 0 0 1 0 7',
      'M18.8 5.5a9.5 9.5 0 0 1 0 13',
    ]);
    this.titleMuteOffIcon = createSvgIcon([
      'M11 5L6 9H2v6h4l5 4V5z',
      'M22 9l-6 6',
      'M16 9l6 6',
    ]);
    this.titleMuteOffIcon.style.display = 'none';
    this.titleMuteBtn.append(this.titleMuteOnIcon, this.titleMuteOffIcon);

    this.titleLangBtn = this.makeButton('aq-lang-pill aq-glass-pill', () => this.callbacks.onToggleLang());
    this.titleLangDeSpan = this.el('span', 'aq-lang-opt is-active', 'DE');
    const titleLangSep = this.el('span', 'aq-lang-sep', '|');
    this.titleLangEnSpan = this.el('span', 'aq-lang-opt', 'EN');
    this.titleLangBtn.append(this.titleLangDeSpan, titleLangSep, this.titleLangEnSpan);

    titleTopbar.append(this.titleMuteBtn, this.titleLangBtn);

    const titleHero = this.el('div', 'aq-title-hero');
    this.titleSubtitleEl = this.el('div', 'aq-title-subtitle');
    this.titleMainEl = this.el('h1', 'aq-title-logo', 'AQUALITH');
    this.titleTaglineEl = this.el('p', 'aq-title-tagline');

    const titleActions = this.el('div', 'aq-title-actions');

    this.startCampaignBtn = this.makeButton('aq-btn aq-btn-primary', () => this.callbacks.onStartCampaign());
    this.startCampaignBtn.appendChild(createSvgIcon(['M6 4l14 8-14 8V4z']));
    this.startCampaignLabel = this.el('span');
    this.startCampaignBtn.appendChild(this.startCampaignLabel);

    this.openSandboxBtn = this.makeButton('aq-btn aq-btn-brass', () => this.callbacks.onOpenSandbox());
    this.openSandboxBtn.appendChild(
      createSvgIcon(['M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0', 'M3 11c2-2 4-2 6 0s4 2 6 0 4-2 6 0'])
    );
    this.openSandboxLabel = this.el('span');
    this.openSandboxBtn.appendChild(this.openSandboxLabel);

    this.openChaptersBtn = this.makeButton('aq-btn aq-btn-glass', () => this.setChapterModalOpen(true));
    this.openChaptersBtn.appendChild(
      createSvgIcon(['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'])
    );
    this.openChaptersLabel = this.el('span');
    this.openChaptersBtn.appendChild(this.openChaptersLabel);

    titleActions.append(this.startCampaignBtn, this.openSandboxBtn, this.openChaptersBtn);
    titleHero.append(this.titleSubtitleEl, this.titleMainEl, this.titleTaglineEl, titleActions);

    this.demoBadgeEl = this.el('div', 'aq-demo-badge aq-glass-pill');
    const liveDot = this.el('span', 'aq-live-dot');
    this.demoBadgeTextEl = this.el('span');
    this.demoBadgeEl.append(liveDot, this.demoBadgeTextEl);

    this.titleScreen.append(titleTopbar, titleHero, this.demoBadgeEl);

    // =========================================================================
    // 2. PLAYING HUD
    // =========================================================================
    this.playingHud = this.el('div', 'aq-playing-hud');
    this.playingHud.hidden = true;

    // Top-left column: Level + Objectives + Hint
    const topLeftCol = this.el('div', 'aq-topleft-col');
    const objPanel = this.el('section', 'aq-glass-panel aq-objectives-panel');

    const levelHeader = this.el('div', 'aq-level-header');
    this.levelBadgePill = this.el('span', 'aq-chapter-badge');
    this.levelTitleEl = this.el('div', 'aq-level-title');
    this.levelSubEl = this.el('div', 'aq-level-sub');
    const levelTitleRow = this.el('div', 'aq-level-title-row');
    levelTitleRow.append(this.levelBadgePill, this.levelTitleEl);
    levelHeader.append(levelTitleRow, this.levelSubEl);

    this.objectivesList = this.el('ul', 'aq-objectives-list');
    objPanel.append(levelHeader, this.objectivesList);

    this.hintCard = this.el('div', 'aq-glass-panel aq-hint-card');
    this.hintToggleBtn = this.makeButton('aq-hint-toggle', () => {
      this.hintCollapsed = !this.hintCollapsed;
      this.hintCard.classList.toggle('is-collapsed', this.hintCollapsed);
      this.hintToggleBtn.setAttribute('aria-expanded', String(!this.hintCollapsed));
    });
    this.hintToggleBtn.setAttribute('aria-expanded', 'true');
    const hintDot = this.el('span', 'aq-hint-spark');
    this.hintLabelEl = this.el('span', 'aq-hint-label');
    const hintChevron = createSvgIcon(['M6 9l6 6 6-6'], '0 0 24 24', 'aq-icon aq-hint-chevron');
    this.hintToggleBtn.append(hintDot, this.hintLabelEl, hintChevron);
    this.hintBodyEl = this.el('p', 'aq-hint-body');
    this.hintCard.append(this.hintToggleBtn, this.hintBodyEl);

    topLeftCol.append(objPanel, this.hintCard);

    // Top-right panel: Telemetry + Icon Controls
    const topRightPanel = this.el('section', 'aq-glass-panel aq-topright-panel');

    const telemetryRow = this.el('div', 'aq-telemetry-row');

    const timerChip = this.el('div', 'aq-stat-chip aq-stat-timer');
    timerChip.appendChild(createSvgIcon(['M12 6v6l4 2', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z']));
    this.timerValueEl = this.el('span', 'aq-mono', '00:00');
    this.parValueEl = this.el('span', 'aq-stat-par aq-mono');
    timerChip.append(this.timerValueEl, this.parValueEl);

    const frostChip = this.el('div', 'aq-stat-chip aq-stat-frost');
    frostChip.appendChild(createSvgIcon(['M12 2v20', 'M4.93 4.93l14.14 14.14', 'M19.07 4.93L4.93 19.07', 'M2 12h20']));
    this.frostBarTrack = this.el('div', 'aq-frost-track');
    this.frostBarFill = this.el('div', 'aq-frost-fill');
    this.frostBarTrack.appendChild(this.frostBarFill);
    this.frostValueEl = this.el('span', 'aq-mono aq-frost-num', '0/0');
    frostChip.append(this.frostBarTrack, this.frostValueEl);

    const waterChip = this.el('div', 'aq-stat-chip aq-stat-water');
    waterChip.appendChild(createSvgIcon(['M12 2.5C8 8 5.5 11.4 5.5 14.5a6.5 6.5 0 0 0 13 0c0-3.1-2.5-6.5-6.5-12z']));
    this.waterValueEl = this.el('span', 'aq-mono', '0');
    this.fpsValueEl = this.el('span', 'aq-fps-tag aq-mono', '');
    waterChip.append(this.waterValueEl, this.fpsValueEl);

    telemetryRow.append(timerChip, frostChip, waterChip);

    const controlsRow = this.el('div', 'aq-controls-row');

    this.slowMoBtn = this.makeButton('aq-ctrl-btn aq-slowmo-btn', () => this.callbacks.onToggleSlowMo());
    this.slowMoBtn.appendChild(createSvgIcon(['M6 2h12', 'M6 22h12', 'M7 2c0 5 5 6 5 10s-5 5-5 10', 'M17 2c0 5-5 6-5 10s5 5 5 10']));
    this.slowMoLabelEl = this.el('span', 'aq-ctrl-label');
    this.slowMoBtn.appendChild(this.slowMoLabelEl);

    this.restartBtn = this.makeButton('aq-ctrl-btn aq-ctrl-icon-only', () => this.callbacks.onRestart());
    this.restartBtn.appendChild(createSvgIcon(['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5']));

    this.muteBtn = this.makeButton('aq-ctrl-btn aq-ctrl-icon-only', () => this.callbacks.onToggleMute());
    this.muteOnIcon = createSvgIcon([
      'M11 5L6 9H2v6h4l5 4V5z',
      'M15.5 8.5a5 5 0 0 1 0 7',
      'M18.8 5.5a9.5 9.5 0 0 1 0 13',
    ]);
    this.muteOffIcon = createSvgIcon([
      'M11 5L6 9H2v6h4l5 4V5z',
      'M22 9l-6 6',
      'M16 9l6 6',
    ]);
    this.muteOffIcon.style.display = 'none';
    this.muteBtn.append(this.muteOnIcon, this.muteOffIcon);

    this.qualityBtn = this.makeButton('aq-ctrl-btn', () => this.callbacks.onToggleQuality());
    this.qualityLabelEl = this.el('span', 'aq-ctrl-label');
    this.qualityBtn.appendChild(this.qualityLabelEl);

    this.langBtn = this.makeButton('aq-ctrl-btn aq-lang-compact', () => this.callbacks.onToggleLang());
    this.langDeSpan = this.el('span', 'aq-lang-opt is-active', 'DE');
    const langSep = this.el('span', 'aq-lang-sep', '/');
    this.langEnSpan = this.el('span', 'aq-lang-opt', 'EN');
    this.langBtn.append(this.langDeSpan, langSep, this.langEnSpan);

    this.menuBtn = this.makeButton('aq-ctrl-btn aq-ctrl-menu', () => this.callbacks.onOpenMenu());
    this.menuBtn.appendChild(createSvgIcon(['M4 7h16', 'M4 12h16', 'M4 17h16']));
    this.menuLabelEl = this.el('span', 'aq-ctrl-label');
    this.menuBtn.appendChild(this.menuLabelEl);

    controlsRow.append(
      this.slowMoBtn,
      this.restartBtn,
      this.muteBtn,
      this.qualityBtn,
      this.langBtn,
      this.menuBtn
    );

    topRightPanel.append(telemetryRow, controlsRow);

    // Floating status badges
    this.slowMoBanner = this.el('div', 'aq-slowmo-banner aq-glass-pill');
    this.slowMoBanner.hidden = true;
    const slowMoDot = this.el('span', 'aq-slowmo-dot');
    this.slowMoBannerText = this.el('span');
    this.slowMoBanner.append(slowMoDot, this.slowMoBannerText);

    this.tutorialPill = this.el('div', 'aq-tutorial-pill aq-glass-pill');
    this.tutorialPill.hidden = true;
    this.tutorialPill.appendChild(createSvgIcon(['M5 12h14', 'M13 6l6 6-6 6']));
    this.tutorialText = this.el('span');
    this.tutorialPill.appendChild(this.tutorialText);

    // Bottom-center tool dock
    const dockContainer = this.el('div', 'aq-dock-container');

    this.sandboxRow = this.el('div', 'aq-glass-panel aq-sandbox-bar');
    this.sandboxRow.hidden = true;

    const sandboxToolDefs: Array<{
      tool: ToolId;
      hotkey: string;
      labelKey: string;
      descKey: string;
      icon: string[];
    }> = [
      {
        tool: 'pour',
        hotkey: '4',
        labelKey: 'toolPour',
        descKey: 'toolPourDesc',
        icon: ['M12 2.5C8 8 5.5 11.4 5.5 14.5a6.5 6.5 0 0 0 13 0c0-3.1-2.5-6.5-6.5-12z'],
      },
      {
        tool: 'drain',
        hotkey: '5',
        labelKey: 'toolDrain',
        descKey: 'toolDrainDesc',
        icon: ['M4 5h16l-6 7v6l-4 2v-8L4 5z'],
      },
      {
        tool: 'rock',
        hotkey: '6',
        labelKey: 'toolRock',
        descKey: 'toolRockDesc',
        icon: ['M3 19l5-10 4 4 4-8 5 14H3z'],
      },
    ];

    for (const def of sandboxToolDefs) {
      const ref = this.createToolButton(def);
      this.toolButtons.push(ref);
      this.sandboxRow.appendChild(ref.button);
    }

    this.sandboxRow.appendChild(this.el('span', 'aq-dock-divider'));

    const sandboxActionDefs: Array<{
      action: SandboxAction;
      labelKey: string;
      variantClass?: string;
      hasDot?: boolean;
    }> = [
      { action: 'tsunami', labelKey: 'sbTsunami', variantClass: 'aq-sb-tsunami' },
      { action: 'toggleSpouts', labelKey: 'sbSpouts', hasDot: true },
      { action: 'addTurbine', labelKey: 'sbTurbine' },
      { action: 'addArk', labelKey: 'sbArk' },
      { action: 'addMagma', labelKey: 'sbMagma', variantClass: 'aq-sb-magma' },
      { action: 'addWall', labelKey: 'sbWall' },
      { action: 'addMine', labelKey: 'sbMine', variantClass: 'aq-sb-mine' },
      { action: 'addSeesaw', labelKey: 'sbSeesaw' },
      { action: 'clearWater', labelKey: 'sbClearWater', variantClass: 'aq-sb-clear' },
    ];

    for (const def of sandboxActionDefs) {
      const btn = this.makeButton(
        `aq-sb-pill ${def.variantClass ?? ''}`.trim(),
        () => this.callbacks.onSandboxAction(def.action)
      );
      let statusDot: HTMLSpanElement | undefined;
      if (def.hasDot) {
        statusDot = this.el('span', 'aq-spout-dot');
        btn.appendChild(statusDot);
      }
      const labelEl = this.el('span');
      btn.appendChild(labelEl);
      this.sandboxButtons.push({
        action: def.action,
        button: btn,
        labelEl,
        statusDot,
        labelKey: def.labelKey,
      });
      this.sandboxRow.appendChild(btn);
    }

    this.coreDockRow = this.el('div', 'aq-glass-panel aq-tool-dock');

    const coreToolDefs: Array<{
      tool: ToolId;
      hotkey: string;
      labelKey: string;
      descKey: string;
      icon: string[];
    }> = [
      {
        tool: 'surge',
        hotkey: '1',
        labelKey: 'toolSurge',
        descKey: 'toolSurgeDesc',
        icon: [
          'M3 12c2.5-3 5.5-3 8 0s5.5 3 8 0',
          'M4 7c2.5-2.5 5-2.5 7.5 0',
          'M5 17c2.5 2.5 5.5 2.5 8 0s4.5-2 6 0',
        ],
      },
      {
        tool: 'ice',
        hotkey: '2',
        labelKey: 'toolIce',
        descKey: 'toolIceDesc',
        icon: ['M12 2l7 6-3 14H8L5 8l7-6z', 'M12 2v20', 'M5 8h14'],
      },
      {
        tool: 'vortex',
        hotkey: '3',
        labelKey: 'toolVortex',
        descKey: 'toolVortexDesc',
        icon: [
          'M12 12m-2 0a2 2 0 1 0 4 0',
          'M12 12a5 5 0 0 1-5-5c0-3 3.5-5 7-4a8 8 0 0 1 6 8c0 5-4 9-9 9-4 0-7-2.5-8-6',
        ],
      },
    ];

    for (const def of coreToolDefs) {
      const ref = this.createToolButton(def);
      this.toolButtons.push(ref);
      this.coreDockRow.appendChild(ref.button);
    }

    this.coreDockRow.appendChild(this.el('span', 'aq-dock-divider'));

    this.shatterBtn = this.makeButton('aq-tool-btn aq-shatter-btn', () => this.callbacks.onShatterIce());
    const shatterHotkey = this.el('span', 'aq-hotkey', 'Space');
    const shatterIcon = createSvgIcon([
      'M12 2l3 7 7-2-5 6 4 7-9-3-6 5 1-8-6-4 7-2 4-6z',
    ]);
    this.shatterLabelEl = this.el('span', 'aq-tool-label');
    this.shatterBtn.append(shatterHotkey, shatterIcon, this.shatterLabelEl);
    this.coreDockRow.appendChild(this.shatterBtn);

    dockContainer.append(this.tutorialPill, this.sandboxRow, this.coreDockRow);

    this.playingHud.append(topLeftCol, topRightPanel, this.slowMoBanner, dockContainer);

    // =========================================================================
    // 3. CHAPTER SELECT MODAL
    // =========================================================================
    this.chapterBackdrop = this.el('div', 'aq-modal-backdrop aq-chapter-backdrop');
    this.chapterBackdrop.hidden = true;
    this.chapterBackdrop.addEventListener('click', (e) => {
      if (e.target === this.chapterBackdrop) {
        this.setChapterModalOpen(false);
      }
    });

    const chapterCard = this.el('div', 'aq-glass-panel aq-modal-card aq-chapter-modal');
    const chapterHeader = this.el('div', 'aq-modal-header');
    this.chapterTitleEl = this.el('h2', 'aq-modal-title');
    this.chapterCloseBtn = this.makeButton('aq-icon-btn aq-modal-close', () => this.setChapterModalOpen(false));
    this.chapterCloseBtn.appendChild(createSvgIcon(['M18 6L6 18', 'M6 6l12 12']));
    chapterHeader.append(this.chapterTitleEl, this.chapterCloseBtn);

    const chapterGrid = this.el('div', 'aq-chapter-grid');

    for (let i = 1; i <= CAMPAIGN_CHAPTER_COUNT; i++) {
      const cardBtn = this.makeButton('aq-chapter-card', () => {
        this.setChapterModalOpen(false);
        this.callbacks.onSelectLevel(i);
      });
      const topRow = this.el('div', 'aq-chapter-card-top');
      const badgeEl = this.el('span', 'aq-chapter-num');
      const starsWrap = this.el('div', 'aq-chapter-stars');
      const starEls: SVGSVGElement[] = [];
      for (let s = 0; s < 3; s++) {
        const star = createStarSvg('aq-mini-star');
        starEls.push(star);
        starsWrap.appendChild(star);
      }
      topRow.append(badgeEl, starsWrap);

      const titleEl = this.el('div', 'aq-chapter-card-title');
      const subEl = this.el('div', 'aq-chapter-card-sub');
      const metaEl = this.el('div', 'aq-chapter-card-meta aq-mono');
      cardBtn.append(topRow, titleEl, subEl, metaEl);

      this.chapterCards.push({
        chapterIndex: i,
        button: cardBtn,
        badgeEl,
        starsWrap,
        starEls,
        titleEl,
        subEl,
        metaEl,
      });
      chapterGrid.appendChild(cardBtn);
    }

    // 8th card: Tide Lab Sandbox
    const sbCardBtn = this.makeButton('aq-chapter-card aq-chapter-sandbox', () => {
      this.setChapterModalOpen(false);
      this.callbacks.onOpenSandbox();
    });
    const sbTopRow = this.el('div', 'aq-chapter-card-top');
    const sbBadge = this.el('span', 'aq-chapter-num aq-sandbox-num', 'SANDBOX');
    const sbIconWrap = this.el('div', 'aq-chapter-stars');
    sbIconWrap.appendChild(createSvgIcon(['M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0']));
    sbTopRow.append(sbBadge, sbIconWrap);
    const sbTitle = this.el('div', 'aq-chapter-card-title');
    const sbSub = this.el('div', 'aq-chapter-card-sub');
    const sbMeta = this.el('div', 'aq-chapter-card-meta', '∞');
    sbCardBtn.append(sbTopRow, sbTitle, sbSub, sbMeta);

    this.chapterCards.push({
      chapterIndex: 'sandbox',
      button: sbCardBtn,
      badgeEl: sbBadge,
      starsWrap: sbIconWrap,
      starEls: [],
      titleEl: sbTitle,
      subEl: sbSub,
      metaEl: sbMeta,
    });
    chapterGrid.appendChild(sbCardBtn);

    chapterCard.append(chapterHeader, chapterGrid);
    this.chapterBackdrop.appendChild(chapterCard);

    // =========================================================================
    // 4. VICTORY MODAL
    // =========================================================================
    this.victoryBackdrop = this.el('div', 'aq-modal-backdrop aq-victory-backdrop');
    this.victoryBackdrop.hidden = true;

    const victoryCard = this.el('div', 'aq-glass-panel aq-modal-card aq-victory-modal');

    const starsRow = this.el('div', 'aq-victory-stars');
    for (let s = 0; s < 3; s++) {
      const star = createStarSvg('aq-victory-star');
      star.style.setProperty('--star-delay', `${s * 130}ms`);
      this.victoryStars.push(star);
      starsRow.appendChild(star);
    }

    this.victoryBannerEl = this.el('div', 'aq-victory-campaign-banner');
    this.victoryBannerEl.hidden = true;

    this.victoryTitleEl = this.el('h2', 'aq-victory-title');
    this.victorySubEl = this.el('p', 'aq-victory-subtitle');

    const statsGrid = this.el('div', 'aq-victory-stats');
    const timeBox = this.el('div', 'aq-victory-stat-box');
    this.victoryTimeLabel = this.el('span', 'aq-victory-stat-label');
    this.victoryTimeVal = this.el('span', 'aq-victory-stat-val aq-mono');
    timeBox.append(this.victoryTimeLabel, this.victoryTimeVal);

    const parBox = this.el('div', 'aq-victory-stat-box');
    this.victoryParLabel = this.el('span', 'aq-victory-stat-label');
    this.victoryParVal = this.el('span', 'aq-victory-stat-val aq-mono');
    parBox.append(this.victoryParLabel, this.victoryParVal);

    statsGrid.append(timeBox, parBox);

    const victoryActions = this.el('div', 'aq-victory-actions');
    this.victoryNextBtn = this.makeButton('aq-btn aq-btn-primary aq-victory-next', () => {
      if (this.lastSnapshot && this.lastSnapshot.levelIndex >= CAMPAIGN_CHAPTER_COUNT) {
        this.callbacks.onOpenSandbox();
      } else {
        this.callbacks.onNextLevel();
      }
    });
    this.victoryNextLabel = this.el('span');
    this.victoryNextBtn.append(this.victoryNextLabel, createSvgIcon(['M5 12h14', 'M13 6l6 6-6 6']));

    const victorySecondary = this.el('div', 'aq-victory-secondary');
    this.victoryReplayBtn = this.makeButton('aq-btn aq-btn-glass', () => this.callbacks.onRestart());
    this.victoryReplayBtn.appendChild(createSvgIcon(['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5']));
    this.victoryReplayLabel = this.el('span');
    this.victoryReplayBtn.appendChild(this.victoryReplayLabel);

    this.victoryChaptersBtn = this.makeButton('aq-btn aq-btn-glass', () => this.setChapterModalOpen(true));
    this.victoryChaptersBtn.appendChild(
      createSvgIcon(['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'])
    );
    this.victoryChaptersLabel = this.el('span');
    this.victoryChaptersBtn.appendChild(this.victoryChaptersLabel);

    victorySecondary.append(this.victoryReplayBtn, this.victoryChaptersBtn);
    victoryActions.append(this.victoryNextBtn, victorySecondary);

    victoryCard.append(
      starsRow,
      this.victoryBannerEl,
      this.victoryTitleEl,
      this.victorySubEl,
      statsGrid,
      victoryActions
    );
    this.victoryBackdrop.appendChild(victoryCard);

    this.root.append(
      this.titleScreen,
      this.playingHud,
      this.victoryBackdrop,
      this.chapterBackdrop
    );

    window.addEventListener('keydown', this.handleCaptureEscape, true);
    window.addEventListener('pointerdown', this.handleFirstStageInteract, { passive: true });
    this.applyStaticTranslations('de');
  }

  public setChapterModalOpen(open: boolean): void {
    if (this.chapterModalOpen === open) return;
    this.chapterModalOpen = open;
    this.chapterBackdrop.hidden = !open;
    if (this.lastSnapshot) {
      this.syncVictoryVisibility(this.lastSnapshot.screen);
      if (open) {
        this.updateChapterCards(this.lastSnapshot);
      }
    }
  }

  public isChapterModalOpen(): boolean {
    return this.chapterModalOpen;
  }

  public toggleChapterModal(): boolean {
    this.setChapterModalOpen(!this.chapterModalOpen);
    return this.chapterModalOpen;
  }

  public setTutorialVisible(visible: boolean): void {
    this.tutorialDismissed = !visible;
    if (!visible) {
      this.tutorialPill.hidden = true;
    }
  }

  public update(snapshot: GameStateSnapshot): void {
    this.lastSnapshot = snapshot;
    const now = performance.now();

    const langChanged = snapshot.lang !== this.lastLang;
    const screenChanged = snapshot.screen !== this.lastScreen;
    const levelChanged = snapshot.levelIndex !== this.lastLevelIndex || snapshot.isSandbox !== this.lastIsSandbox;

    if (langChanged) {
      this.lastLang = snapshot.lang;
      document.documentElement.lang = snapshot.lang;
      document.title = `${t(snapshot.lang, 'gameTitle')} — ${t(snapshot.lang, 'gameSubtitle')}`;
      this.applyStaticTranslations(snapshot.lang);
    }

    if (screenChanged) {
      this.lastScreen = snapshot.screen;
      if (snapshot.screen === 'victory') {
        this.chapterModalOpen = false;
        this.chapterBackdrop.hidden = true;
      }
      this.titleScreen.hidden = snapshot.screen !== 'title';
      this.playingHud.hidden = snapshot.screen !== 'playing';
      this.syncVictoryVisibility(snapshot.screen);
    }

    if (levelChanged) {
      this.lastLevelIndex = snapshot.levelIndex;
      this.lastIsSandbox = snapshot.isSandbox;
      this.sandboxRow.hidden = !snapshot.isSandbox;
      this.hintCollapsed = snapshot.levelIndex > 1;
      this.hintCard.classList.toggle('is-collapsed', this.hintCollapsed);
      this.hintToggleBtn.setAttribute('aria-expanded', String(!this.hintCollapsed));
      if (snapshot.levelIndex !== 1) {
        this.tutorialDismissed = false;
      }
    }

    if (langChanged || levelChanged || screenChanged) {
      this.updateLevelMeta(snapshot);
      this.updateTitleProgress(snapshot);
      this.updateChapterCards(snapshot);
      this.updateVictoryModal(snapshot);
    }

    // Discrete interactive button states (immediate updates)
    this.updateDiscreteControls(snapshot);

    // Tutorial pill visibility on Chapter 1 before interaction
    const showTutorial =
      snapshot.screen === 'playing' &&
      snapshot.levelIndex === 1 &&
      !snapshot.isSandbox &&
      !this.tutorialDismissed &&
      snapshot.activeTool === 'surge' &&
      snapshot.elapsed < 12;
    this.tutorialPill.hidden = !showTutorial;

    // Objectives structure check (rebuild rows only when objective keys/count change)
    const objSig = snapshot.objectives.map((o) => o.labelKey).join('|');
    if (objSig !== this.lastObjectiveSig || langChanged) {
      this.lastObjectiveSig = objSig;
      this.rebuildObjectiveRows(snapshot.objectives, snapshot.lang);
    }

    // Throttle high-frequency numeric & bar width DOM mutations (~15Hz)
    const forceNumeric = langChanged || screenChanged || levelChanged;
    if (forceNumeric || now - this.lastNumericUpdateMs >= NUMERIC_UPDATE_INTERVAL_MS) {
      this.lastNumericUpdateMs = now;
      this.updateNumericReadouts(snapshot);
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.handleCaptureEscape, true);
    window.removeEventListener('pointerdown', this.handleFirstStageInteract);
    this.root.textContent = '';
  }

  private readonly handleCaptureEscape = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && this.chapterModalOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.setChapterModalOpen(false);
    }
  };

  private readonly handleFirstStageInteract = (e: PointerEvent): void => {
    if (this.lastSnapshot?.screen !== 'playing') return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('#stage')) {
      this.tutorialDismissed = true;
      this.tutorialPill.hidden = true;
    }
  };

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  private makeButton(className: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.addEventListener('click', (e) => {
      if (e.detail > 0) btn.blur();
      onClick();
    });
    return btn;
  }

  private createToolButton(def: {
    tool: ToolId;
    hotkey: string;
    labelKey: string;
    descKey: string;
    icon: string[];
  }): ToolButtonRefs {
    const button = this.makeButton('aq-tool-btn', () => this.callbacks.onSelectTool(def.tool));
    const hotkeyEl = this.el('span', 'aq-hotkey', def.hotkey);
    const iconEl = createSvgIcon(def.icon);
    const labelEl = this.el('span', 'aq-tool-label');
    button.append(hotkeyEl, iconEl, labelEl);
    return {
      tool: def.tool,
      button,
      labelEl,
      hotkeyEl,
      labelKey: def.labelKey,
      descKey: def.descKey,
    };
  }

  private syncVictoryVisibility(screen: GameStateSnapshot['screen']): void {
    this.victoryBackdrop.hidden = screen !== 'victory' || this.chapterModalOpen;
  }

  private applyStaticTranslations(lang: Lang): void {
    this.titleMainEl.textContent = t(lang, 'gameTitle');
    this.titleSubtitleEl.textContent = t(lang, 'gameSubtitle');
    this.titleTaglineEl.textContent = t(lang, 'titleTagline');
    this.openSandboxLabel.textContent = t(lang, 'openSandbox');
    this.openChaptersLabel.textContent = t(lang, 'selectChapter');
    this.titleMuteBtn.title = `${t(lang, 'mute')} [M]`;

    this.hintLabelEl.textContent = t(lang, 'hintLabel');
    this.slowMoLabelEl.textContent = t(lang, 'slowMo');
    this.slowMoBtn.title = `${t(lang, 'slowMo')} [T / Shift]`;
    this.restartBtn.title = `${t(lang, 'reset')} [R]`;
    this.muteBtn.title = `${t(lang, 'mute')} [M]`;
    this.menuLabelEl.textContent = t(lang, 'backToMenu');
    this.menuBtn.title = `${t(lang, 'backToMenu')} [Esc]`;

    this.slowMoBannerText.textContent = t(lang, 'slowMoBadge');
    this.tutorialText.textContent = t(lang, 'tutorialDrag');

    for (const ref of this.toolButtons) {
      ref.labelEl.textContent = t(lang, ref.labelKey);
      const desc = t(lang, ref.descKey);
      ref.button.title = desc;
      ref.button.dataset.tip = desc;
    }

    this.shatterLabelEl.textContent = t(lang, 'toolShatter');
    const shatterDesc = t(lang, 'toolShatterDesc');
    this.shatterBtn.title = shatterDesc;
    this.shatterBtn.dataset.tip = shatterDesc;

    for (const ref of this.sandboxButtons) {
      ref.labelEl.textContent = t(lang, ref.labelKey);
    }

    this.chapterTitleEl.textContent = t(lang, 'selectChapter');
    this.chapterCloseBtn.title = t(lang, 'closeMenu');

    this.victoryBannerEl.textContent = t(lang, 'campaignComplete');
    this.victoryTitleEl.textContent = t(lang, 'victoryTitle');
    this.victorySubEl.textContent = t(lang, 'victorySubtitle');
    this.victoryTimeLabel.textContent = t(lang, 'victoryTime');
    this.victoryParLabel.textContent = t(lang, 'victoryPar');
    this.victoryReplayLabel.textContent = t(lang, 'replayChapter');
    this.victoryChaptersLabel.textContent = t(lang, 'selectChapter');
  }

  private updateTitleProgress(snapshot: GameStateSnapshot): void {
    const key = hasCampaignProgress(snapshot.levelProgress) ? 'continueCampaign' : 'startCampaign';
    this.startCampaignLabel.textContent = t(snapshot.lang, key);
    this.demoBadgeTextEl.textContent = `${t(snapshot.lang, snapshot.titleKey)} · ${t(snapshot.lang, snapshot.subtitleKey)}`;
  }

  private updateLevelMeta(snapshot: GameStateSnapshot): void {
    const lang = snapshot.lang;
    if (snapshot.isSandbox) {
      this.levelBadgePill.textContent = 'SANDBOX';
      this.levelBadgePill.classList.add('is-sandbox');
    } else if (snapshot.levelIndex >= 1) {
      this.levelBadgePill.textContent = `${t(lang, 'chapterPrefix')} ${snapshot.levelIndex}`;
      this.levelBadgePill.classList.remove('is-sandbox');
    } else {
      this.levelBadgePill.textContent = 'DEMO';
      this.levelBadgePill.classList.remove('is-sandbox');
    }

    this.levelTitleEl.textContent = t(lang, snapshot.titleKey);
    this.levelSubEl.textContent = t(lang, snapshot.subtitleKey);
    this.hintBodyEl.textContent = t(lang, snapshot.hintKey);

    if (!snapshot.isSandbox && snapshot.parTime > 0) {
      this.parValueEl.textContent = `/ ${formatClock(snapshot.parTime)}`;
      this.parValueEl.hidden = false;
    } else {
      this.parValueEl.hidden = true;
    }
  }

  private updateDiscreteControls(snapshot: GameStateSnapshot): void {
    const lang = snapshot.lang;

    // Language active highlight
    this.titleLangDeSpan.classList.toggle('is-active', lang === 'de');
    this.titleLangEnSpan.classList.toggle('is-active', lang === 'en');
    this.langDeSpan.classList.toggle('is-active', lang === 'de');
    this.langEnSpan.classList.toggle('is-active', lang === 'en');

    // Mute icons
    this.titleMuteOnIcon.style.display = snapshot.muted ? 'none' : '';
    this.titleMuteOffIcon.style.display = snapshot.muted ? '' : 'none';
    this.titleMuteBtn.classList.toggle('is-muted', snapshot.muted);

    this.muteOnIcon.style.display = snapshot.muted ? 'none' : '';
    this.muteOffIcon.style.display = snapshot.muted ? '' : 'none';
    this.muteBtn.classList.toggle('is-muted', snapshot.muted);

    // Slow-Mo state
    this.slowMoBtn.classList.toggle('is-active', snapshot.slowMo);
    this.slowMoBtn.setAttribute('aria-pressed', String(snapshot.slowMo));
    this.slowMoBanner.hidden = !(snapshot.screen === 'playing' && snapshot.slowMo);

    // Quality badge
    const qKey = snapshot.quality === 'ultra' ? 'qualityUltra' : 'qualityHigh';
    this.qualityLabelEl.textContent = t(lang, qKey);
    this.qualityBtn.classList.toggle('is-ultra', snapshot.quality === 'ultra');

    // Tool selection
    for (const ref of this.toolButtons) {
      const active = ref.tool === snapshot.activeTool;
      ref.button.classList.toggle('is-active', active);
      ref.button.setAttribute('aria-pressed', String(active));
    }

    // Shatter state hint
    this.shatterBtn.classList.toggle('has-ice', snapshot.frostUsed > 0);

    // Sandbox spouts active indicator
    for (const sbRef of this.sandboxButtons) {
      if (sbRef.action === 'toggleSpouts' && sbRef.statusDot) {
        sbRef.button.classList.toggle('is-on', snapshot.spoutsActive);
        sbRef.button.setAttribute('aria-pressed', String(snapshot.spoutsActive));
      }
    }
  }

  private rebuildObjectiveRows(objectives: ObjectiveStatus[], lang: Lang): void {
    this.objectivesList.textContent = '';
    this.objectiveRows = [];

    for (const obj of objectives) {
      const row = this.el('li', 'aq-objective-row');
      const header = this.el('div', 'aq-objective-head');

      const checkIcon = this.el('span', 'aq-objective-check');
      checkIcon.appendChild(createSvgIcon(['M5 13l4 4L19 7'], '0 0 24 24', 'aq-check-svg'));

      const labelEl = this.el('span', 'aq-objective-label', t(lang, obj.labelKey));
      const detailEl = this.el('span', 'aq-objective-detail aq-mono', obj.detail ?? '');
      header.append(checkIcon, labelEl, detailEl);

      const track = this.el('div', 'aq-objective-track');
      const fillEl = this.el('div', 'aq-objective-fill');
      track.appendChild(fillEl);

      row.append(header, track);
      this.objectivesList.appendChild(row);
      this.objectiveRows.push({
        root: row,
        checkIcon,
        labelEl,
        detailEl,
        fillEl,
      });
    }
  }

  private updateNumericReadouts(snapshot: GameStateSnapshot): void {
    this.timerValueEl.textContent = formatClock(snapshot.elapsed);

    // Frost gauge
    const isUnlimitedFrost = snapshot.frostMax <= 0 || snapshot.frostMax >= 5000;
    if (isUnlimitedFrost) {
      this.frostValueEl.textContent = `${snapshot.frostUsed} / ∞`;
      this.frostBarFill.style.width = snapshot.frostUsed > 0 ? '35%' : '0%';
      this.frostBarTrack.classList.remove('is-near-full');
    } else {
      const ratio = Math.max(0, Math.min(1, snapshot.frostUsed / snapshot.frostMax));
      this.frostValueEl.textContent = `${snapshot.frostUsed}/${snapshot.frostMax}`;
      this.frostBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;
      this.frostBarTrack.classList.toggle('is-near-full', ratio >= 0.85);
    }

    // Water droplets & FPS
    this.waterValueEl.textContent = formatCount(snapshot.waterCount);
    this.fpsValueEl.textContent = snapshot.fps > 0 ? `${Math.round(snapshot.fps)} fps` : '';

    // Objective progress bars & checkmarks
    for (let i = 0; i < this.objectiveRows.length; i++) {
      const row = this.objectiveRows[i];
      const obj = snapshot.objectives[i];
      if (!obj) continue;
      row.root.classList.toggle('is-done', obj.done);
      const pct = Math.max(0, Math.min(1, obj.done ? 1 : obj.progress)) * 100;
      row.fillEl.style.width = `${pct.toFixed(1)}%`;
      row.detailEl.textContent = obj.detail ?? '';
    }
  }

  private updateChapterCards(snapshot: GameStateSnapshot): void {
    const lang = snapshot.lang;
    for (const card of this.chapterCards) {
      if (card.chapterIndex === 'sandbox') {
        card.titleEl.textContent = t(lang, 'lvl.sb.title');
        card.subEl.textContent = t(lang, 'lvl.sb.sub');
        card.button.classList.toggle('is-current', snapshot.isSandbox);
        continue;
      }

      const idx = card.chapterIndex;
      const prog = findChapterProgress(snapshot.levelProgress, idx, snapshot);
      const stars = prog ? prog.stars : 0;

      card.badgeEl.textContent = `${t(lang, 'chapterPrefix')} ${idx}`;
      card.titleEl.textContent = t(lang, `lvl.${idx}.title`);
      card.subEl.textContent = t(lang, `lvl.${idx}.sub`);

      for (let s = 0; s < card.starEls.length; s++) {
        card.starEls[s].classList.toggle('is-earned', s < stars);
      }

      const bestStr = prog && prog.bestTime !== null ? formatClock(prog.bestTime) : '--:--';
      card.metaEl.textContent = `${t(lang, 'bestTimeLabel')}: ${bestStr}`;
      card.button.classList.toggle('is-current', !snapshot.isSandbox && snapshot.levelIndex === idx);
    }
  }

  private updateVictoryModal(snapshot: GameStateSnapshot): void {
    const lang = snapshot.lang;
    const isFinalChapter = snapshot.levelIndex >= CAMPAIGN_CHAPTER_COUNT;

    const earnedStars =
      snapshot.starsEarned > 0
        ? Math.min(3, snapshot.starsEarned)
        : snapshot.elapsed <= snapshot.parTime
          ? 3
          : snapshot.elapsed <= snapshot.parTime * 1.45
            ? 2
            : 1;

    for (let s = 0; s < this.victoryStars.length; s++) {
      this.victoryStars[s].classList.toggle('is-earned', s < earnedStars);
    }

    this.victoryBannerEl.hidden = !isFinalChapter;
    this.victoryTimeVal.textContent = formatPreciseClock(snapshot.elapsed);
    this.victoryParVal.textContent = formatPreciseClock(snapshot.parTime);
    this.victoryNextLabel.textContent = t(lang, isFinalChapter ? 'enterSandbox' : 'nextChapter');
  }
}
