/// <reference types="vite/client" />
import '../styles.css';

import type {
  BeltPulleyNode,
  CameraPresetId,
  GameSnapshot,
  HUDCallbacks,
  MinigameState,
  ToolId,
  TorqueScore,
} from '../types';
import { CAMERA_PRESETS, REPAIR_STEPS, TOOL_DEFINITIONS } from '../steps/stepDefinitions';
import { renderBeltDiagramSVG } from './BeltDiagramSVG';

const TOOL_ICONS: Record<ToolId, string> = {
  hand: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v4"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v6"/><path d="M10 10.5V5a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.5L3.3 16a2 2 0 0 1 2.7-2.8L8 15"/></svg>`,
  impact17: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11v5H3z"/><path d="M14 9h4v3h-4"/><path d="M18 9.5h3v2h-3"/><path d="M6 13l-1.5 7h4L10 13"/><circle cx="7" cy="10.5" r="0.8" fill="currentColor"/></svg>`,
  torx25: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-4.5"/><path d="M8.5 15.5l4-4"/><rect x="11.5" y="4.5" width="7" height="4.5" rx="1.5" transform="rotate(-45 15 6.75)"/><path d="M3 21l2-2"/><path d="M17.5 4.5l2 2"/></svg>`,
  wrench16: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 1 0 3 3L9.5 17.5a3.2 3.2 0 1 1-3-3z"/><circle cx="17" cy="7" r="1.4"/></svg>`,
  pinT10060A: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h10a2 2 0 0 1 2 2v11"/><path d="M6 7a2 2 0 1 1 0-4h4"/><circle cx="18" cy="20" r="0.8" fill="currentColor"/><path d="M15 11h6"/></svg>`,
  ratchet13: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="7" r="3.5"/><path d="M14.5 9.5L5.2 18.8a1.8 1.8 0 0 0 2.5 2.5L17 12"/><circle cx="17" cy="7" r="1.2" fill="currentColor"/></svg>`,
  torqueWrench: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20l11-11"/><path d="M14 9a4 4 0 1 0 3-3"/><path d="M5 18l3 3"/><path d="M15 4l5 5"/><path d="M9 12l3 3"/></svg>`,
  newParts: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4.5"/><circle cx="16.5" cy="8.5" r="3"/><path d="M5.5 11.3L14 6.4"/><path d="M11.6 17.7L19 10.2"/><circle cx="8" cy="15" r="1.3"/><circle cx="16.5" cy="8.5" r="0.9"/></svg>`,
};

const TORQUE_ARC_RADIUS = 82;
const TORQUE_ARC_CENTER_X = 120;
const TORQUE_ARC_CENTER_Y = 112;
const TORQUE_ARC_START_DEG = -135;
const TORQUE_ARC_SWEEP_DEG = 270;
const TORQUE_ARC_CIRCUMFERENCE = 2 * Math.PI * TORQUE_ARC_RADIUS * (TORQUE_ARC_SWEEP_DEG / 360);

interface GradeEvaluation {
  grade: 'S' | 'A' | 'B' | 'C';
  caption: string;
}

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeSvgArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const clampedEnd = Math.max(startAngle + 0.01, endAngle);
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, clampedEnd);
  const largeArcFlag = clampedEnd - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function evaluateGrade(snapshot: GameSnapshot): GradeEvaluation {
  const scores = snapshot.torqueScores;
  const torquePenalty = scores.reduce((sum, entry) => {
    switch (entry.rating) {
      case 'Perfekt':
        return sum;
      case 'Gut':
        return sum + 4;
      case 'Akzeptabel':
        return sum + 10;
      case 'Daneben':
        return sum + 20;
    }
  }, 0);

  const hasDaneben = scores.some((entry) => entry.rating === 'Daneben');
  const perfektCount = scores.filter((entry) => entry.rating === 'Perfekt').length;

  let quality = 100 - snapshot.mistakes * 6 - torquePenalty;
  if (snapshot.xp >= 1100) quality += 4;
  if (snapshot.mode === 'pro') quality += 2;
  if (snapshot.xp < 300 && scores.length === 0) quality = Math.min(quality, 75);
  quality = Math.max(0, Math.min(100, quality));

  if (
    quality >= 92 &&
    snapshot.mistakes <= 1 &&
    !hasDaneben &&
    (scores.length === 0 || perfektCount >= Math.ceil(scores.length / 2))
  ) {
    return { grade: 'S', caption: 'Meister' };
  }
  if (quality >= 78) {
    return { grade: 'A', caption: 'Sehr gut' };
  }
  if (quality >= 60) {
    return { grade: 'B', caption: 'Bestanden' };
  }
  return { grade: 'C', caption: 'Basis' };
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function createSvgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

/**
 * Interactive German VW Digital Cockpit HUD overlay for the Golf 7 1.6 TDI 3D repair simulation.
 * Builds DOM elements once and updates high-frequency gauges via cached element references.
 */
export class GameHUD {
  private readonly root: HTMLElement;
  private readonly callbacks: HUDCallbacks;

  private readonly hudRoot: HTMLDivElement;

  // Title Screen
  private readonly titleScreenEl: HTMLDivElement;

  // Top Bar
  private readonly topWrapEl: HTMLDivElement;
  private readonly stepSelectEl: HTMLSelectElement;
  private readonly progressLabelEl: HTMLSpanElement;
  private readonly progressPercentEl: HTMLSpanElement;
  private readonly progressFillEl: HTMLDivElement;
  private readonly cameraBtns = new Map<CameraPresetId, HTMLButtonElement>();
  private readonly xpValueEl: HTMLSpanElement;
  private readonly timerValueEl: HTMLSpanElement;
  private readonly xrayBtnEl: HTMLButtonElement;
  private readonly lampBtnEl: HTMLButtonElement;
  private readonly muteBtnEl: HTMLButtonElement;

  // Middle Stage & Left Objective Panel
  private readonly middleStageEl: HTMLDivElement;
  private readonly stageRightEl: HTMLDivElement;
  private readonly leftRailEl: HTMLDivElement;
  private readonly expandPillEl: HTMLButtonElement;
  private readonly objectivePanelEl: HTMLDivElement;
  private readonly stepBadgeEl: HTMLSpanElement;
  private readonly torqueSpecBadgeEl: HTMLSpanElement;
  private readonly modeMiniBadgeEl: HTMLSpanElement;
  private readonly stepSubtitleEl: HTMLDivElement;
  private readonly stepTitleEl: HTMLHeadingElement;
  private readonly stepDescEl: HTMLParagraphElement;
  private readonly subObjectiveListEl: HTMLUListElement;

  // Engine Control Card (Step 11 / Free Inspect)
  private readonly engineControlCardEl: HTMLDivElement;
  private readonly engineRpmPillEl: HTMLDivElement;
  private readonly engineRpmTextEl: HTMLSpanElement;
  private readonly engineToggleBtnEl: HTMLButtonElement;

  // Accordions
  private readonly whyAccordionEl: HTMLDivElement;
  private readonly whyTriggerEl: HTMLButtonElement;
  private readonly whyContentEl: HTMLDivElement;
  private readonly diagramAccordionEl: HTMLDivElement;
  private readonly diagramTriggerEl: HTMLButtonElement;
  private readonly diagramTriggerTitleEl: HTMLSpanElement;
  private readonly diagramContentEl: HTMLDivElement;
  private readonly diagramLockedBoxEl: HTMLDivElement;
  private readonly diagramSvgWrapEl: HTMLDivElement;

  // Bottom 8-Slot Tool Hotbar
  private readonly hotbarWrapEl: HTMLDivElement;
  private readonly toolSlots = new Map<
    ToolId,
    { btn: HTMLButtonElement; recBadge: HTMLSpanElement }
  >();

  // Minigames
  private readonly minigameWrapEl: HTMLDivElement;
  private readonly tensionerViewEl: HTMLDivElement;
  private readonly tensionerTitleEl: HTMLHeadingElement;
  private readonly tensionerSubtitleEl: HTMLDivElement;
  private readonly tensionerAngleEl: HTMLSpanElement;
  private readonly tensionerStatusEl: HTMLSpanElement;
  private readonly tensionerZoneEl: HTMLDivElement;
  private readonly tensionerFillEl: HTMLDivElement;
  private readonly tensionerHoldBtnEl: HTMLButtonElement;

  private readonly torqueViewEl: HTMLDivElement;
  private readonly torqueTitleEl: HTMLHeadingElement;
  private readonly torqueBoltEl: HTMLDivElement;
  private readonly torqueBandPathEl: SVGPathElement;
  private readonly torqueActiveArcEl: SVGPathElement;
  private readonly torqueTicksGroupEl: SVGGElement;
  private readonly torqueNeedleGroupEl: SVGGElement;
  private readonly torqueValueEl: HTMLDivElement;
  private readonly torqueTargetSubEl: HTMLDivElement;
  private readonly torqueHoldBtnEl: HTMLButtonElement;

  // Floating Tooltip & Toast
  private readonly tooltipEl: HTMLDivElement;
  private readonly tooltipLabelEl: HTMLDivElement;
  private readonly tooltipPnEl: HTMLSpanElement;
  private readonly tooltipStatusEl: HTMLDivElement;
  private readonly tooltipHintEl: HTMLDivElement;

  private readonly toastWrapEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;

  // Completion Modal & Loading Overlay
  private readonly certWrapEl: HTMLDivElement;
  private readonly certGradeBadgeEl: HTMLDivElement;
  private readonly certGradeLetterEl: HTMLSpanElement;
  private readonly certGradeCaptionEl: HTMLSpanElement;
  private readonly certXpEl: HTMLDivElement;
  private readonly certTimeEl: HTMLDivElement;
  private readonly certMistakesEl: HTMLDivElement;
  private readonly certModeEl: HTMLDivElement;
  private readonly certTorqueListEl: HTMLDivElement;

  private readonly loadingWrapEl: HTMLDivElement;
  private readonly loadingTextEl: HTMLDivElement;

  // Local UI state & dirty-check caches
  private panelCollapsed = false;
  private whyExpanded = false;
  private diagramExpanded = false;
  private lastAutoExpandedStepIndex = -1;

  private tensionerPressed = false;
  private torquePressed = false;

  private tooltipX = 24;
  private tooltipY = 24;
  private tooltipVisible = false;

  private lastStepIndex = -1;
  private lastSubObjectivesKey = '';
  private lastDiagramKey = '';
  private lastToastId = -1;
  private lastHoveredKey = '';
  private lastMinigameSpecKey = '';
  private lastCertKey = '';

  private readonly windowBlurHandler: () => void;

  constructor(root: HTMLElement, callbacks: HUDCallbacks) {
    this.root = root;
    this.callbacks = callbacks;

    this.hudRoot = createEl('div', 'hud-root');

    // ------------------------------------------------------------------
    // 1. Title Screen
    // ------------------------------------------------------------------
    this.titleScreenEl = createEl('div', 'hud-title-screen');
    const titleCard = createEl('div', 'hud-title-card');

    const eyebrow = createEl('div', 'title-eyebrow');
    eyebrow.append(createEl('span', 'title-eyebrow-dot'), 'Digital Cockpit • EA288 Meisterwerkstatt');

    const titleH1 = createEl('h1', 'title-heading', 'VW Golf VII 1.6 TDI');
    const titleSub = createEl(
      'p',
      'title-sub',
      'Interaktive 3D-Reparatur: Keilrippenriemen & automatische Spannrolle fachgerecht wechseln.',
    );
    const specBadge = createEl(
      'div',
      'title-spec-badge',
      'VW Golf VII 1.6 TDI • MKB CLHA/CRKB (EA288) • 6PK1025 • 04L 903 315',
    );

    const modesGrid = createEl('div', 'title-modes');

    const guideBtn = createEl('button', 'title-mode-btn title-mode-btn--guide');
    guideBtn.type = 'button';
    const guideTop = createEl('div', 'title-mode-top');
    guideTop.append(
      createEl('span', 'title-mode-name', 'Werkstatt-Guide (Geführt)'),
      createEl('span', 'title-mode-tag title-mode-tag--guide', 'Geführt'),
    );
    guideBtn.append(
      guideTop,
      createEl(
        'span',
        'title-mode-desc',
        'Pulsierende 3D-Highlights, Werkzeug-Hinweise, Drehmoment-Tipps & 6PK1025-Riemenschema.',
      ),
    );
    guideBtn.addEventListener('click', () => this.callbacks.onStartGame('guide'));

    const proBtn = createEl('button', 'title-mode-btn title-mode-btn--pro');
    proBtn.type = 'button';
    const proTop = createEl('div', 'title-mode-top');
    proTop.append(
      createEl('span', 'title-mode-name', 'Meister-Prüfung (Profi)'),
      createEl('span', 'title-mode-tag title-mode-tag--pro', 'Profi'),
    );
    proBtn.append(
      proTop,
      createEl(
        'span',
        'title-mode-desc',
        'Keine 3D-Markierungen, freie Werkzeugwahl & strenge Genauigkeitswertung.',
      ),
    );
    proBtn.addEventListener('click', () => this.callbacks.onStartGame('pro'));

    modesGrid.append(guideBtn, proBtn);

    const controlsRow = createEl('div', 'title-controls-row');
    controlsRow.innerHTML = [
      '<span><kbd>Klick</kbd>Bauteil</span>',
      '<span><kbd>Ziehen</kbd>Kamera</span>',
      '<span><kbd>1–8</kbd>Werkzeug</span>',
      '<span><kbd>Q–T</kbd>Kameras</span>',
      '<span><kbd>X</kbd>X-Ray</span>',
      '<span><kbd>L</kbd>Lampe</span>',
      '<span><kbd>M</kbd>Ton</span>',
    ].join('');

    const timingLink = createEl('a', 'title-timing-link', 'Zur Zahnriemen-Werkstatt ↗');
    timingLink.href = '../golf7-zahnriemen-3d/';
    titleCard.append(eyebrow, titleH1, titleSub, specBadge, modesGrid, timingLink, controlsRow);
    this.titleScreenEl.append(titleCard);

    // ------------------------------------------------------------------
    // 2. Top Bar
    // ------------------------------------------------------------------
    this.topWrapEl = createEl('div', 'hud-top-wrap is-hidden');
    const topBar = createEl('div', 'hud-top-bar hud-glass');

    const topLeft = createEl('div', 'top-group');
    const brandPill = createEl('div', 'brand-pill');
    brandPill.append(createEl('span', 'brand-dot'), 'Golf VII 1.6 TDI');

    this.stepSelectEl = createEl('select', 'step-select');
    this.stepSelectEl.setAttribute('aria-label', 'Reparaturschritt auswählen');
    for (const step of REPAIR_STEPS) {
      const opt = document.createElement('option');
      opt.value = String(step.index);
      opt.textContent = `${step.index + 1}. ${step.title}`;
      this.stepSelectEl.append(opt);
    }
    this.stepSelectEl.addEventListener('change', () => {
      const idx = Number(this.stepSelectEl.value);
      if (!Number.isNaN(idx)) {
        this.callbacks.onJumpToStep(idx);
      }
      this.stepSelectEl.blur();
    });

    const progressChip = createEl('div', 'progress-chip');
    const progressLabelRow = createEl('div', 'progress-chip-label');
    this.progressLabelEl = createEl('span', 'tabular', 'Schritt 1 / 12');
    this.progressPercentEl = createEl('span', 'progress-percent tabular', '0%');
    progressLabelRow.append(this.progressLabelEl, this.progressPercentEl);
    const progressTrack = createEl('div', 'progress-track');
    this.progressFillEl = createEl('div', 'progress-fill');
    progressTrack.append(this.progressFillEl);
    progressChip.append(progressLabelRow, progressTrack);

    topLeft.append(brandPill, this.stepSelectEl, progressChip);

    const topCenter = createEl('div', 'camera-pills');
    for (const preset of CAMERA_PRESETS) {
      const camBtn = createEl('button', 'cam-btn');
      camBtn.type = 'button';
      camBtn.append(
        createEl('span', 'cam-key', `${preset.hotkey}:`),
        createEl('span', undefined, preset.label),
      );
      camBtn.addEventListener('click', () => this.callbacks.onSelectCamera(preset.id));
      this.cameraBtns.set(preset.id, camBtn);
      topCenter.append(camBtn);
    }

    const topRight = createEl('div', 'top-group');
    const xpPill = createEl('div', 'stat-pill stat-pill--xp tabular');
    this.xpValueEl = createEl('span', undefined, '0 XP');
    xpPill.append('★ ', this.xpValueEl);

    const timerPill = createEl('div', 'stat-pill stat-pill--timer tabular');
    this.timerValueEl = createEl('span', undefined, '00:00');
    timerPill.append('⏱ ', this.timerValueEl);

    this.xrayBtnEl = createEl('button', 'toggle-btn', 'X-Ray [X]');
    this.xrayBtnEl.type = 'button';
    this.xrayBtnEl.addEventListener('click', () => this.callbacks.onToggleXRay());

    this.lampBtnEl = createEl('button', 'toggle-btn', 'Arbeitslampe [L]');
    this.lampBtnEl.type = 'button';
    this.lampBtnEl.addEventListener('click', () => this.callbacks.onToggleLamp());

    this.muteBtnEl = createEl('button', 'toggle-btn', 'Ton [M]');
    this.muteBtnEl.type = 'button';
    this.muteBtnEl.addEventListener('click', () => this.callbacks.onToggleMute());

    const resetBtn = createEl('button', 'toggle-btn toggle-btn--reset', 'Reset ↺');
    resetBtn.type = 'button';
    resetBtn.title = 'Reparatur neu starten';
    resetBtn.addEventListener('click', () => this.callbacks.onResetGame());

    topRight.append(xpPill, timerPill, this.xrayBtnEl, this.lampBtnEl, this.muteBtnEl, resetBtn);
    topBar.append(topLeft, topCenter, topRight);
    this.topWrapEl.append(topBar);

    // ------------------------------------------------------------------
    // 3. Middle Stage: Left Objective Panel + Right Open 3D Stage
    // ------------------------------------------------------------------
    this.middleStageEl = createEl('div', 'hud-middle-stage is-hidden');
    this.stageRightEl = createEl('div', 'hud-stage-right');

    this.leftRailEl = createEl('div', 'hud-left-rail');

    this.expandPillEl = createEl('button', 'objective-expand-pill hud-glass is-hidden', '▶ Aufgabe einblenden');
    this.expandPillEl.type = 'button';
    this.expandPillEl.addEventListener('click', () => {
      this.panelCollapsed = false;
      this.syncCollapseState();
    });

    this.objectivePanelEl = createEl('div', 'objective-panel hud-glass');

    const objHeader = createEl('div', 'objective-header');
    const objHeaderMeta = createEl('div', 'objective-header-meta');
    this.stepBadgeEl = createEl('span', 'step-badge tabular', 'Schritt 1/12');
    this.torqueSpecBadgeEl = createEl('span', 'torque-spec-badge is-hidden tabular');
    this.modeMiniBadgeEl = createEl('span', 'mode-mini-badge', 'Guide');
    objHeaderMeta.append(this.stepBadgeEl, this.torqueSpecBadgeEl, this.modeMiniBadgeEl);

    const collapseBtn = createEl('button', 'collapse-btn', '◀');
    collapseBtn.type = 'button';
    collapseBtn.title = 'Aufgabenpanel einklappen';
    collapseBtn.addEventListener('click', () => {
      this.panelCollapsed = true;
      this.syncCollapseState();
    });

    objHeader.append(objHeaderMeta, collapseBtn);

    const objBody = createEl('div', 'objective-body');
    this.stepSubtitleEl = createEl('div', 'objective-subtitle');
    this.stepTitleEl = createEl('h2', 'objective-title');
    this.stepDescEl = createEl('p', 'objective-desc');
    this.subObjectiveListEl = createEl('ul', 'subobjective-list');

    // Engine Control Card (Step 11 / Free Inspect)
    this.engineControlCardEl = createEl('div', 'engine-control-card is-hidden');
    const engineStatusRow = createEl('div', 'engine-status-row');
    engineStatusRow.append(createEl('span', 'engine-status-label', 'EA288 Probelauf'));
    this.engineRpmPillEl = createEl('div', 'engine-rpm-pill tabular');
    this.engineRpmTextEl = createEl('span', undefined, '0 U/min Aus');
    this.engineRpmPillEl.append(createEl('span', 'engine-dot'), this.engineRpmTextEl);
    engineStatusRow.append(this.engineRpmPillEl);

    this.engineToggleBtnEl = createEl('button', 'engine-toggle-btn', '1.6 TDI Motor starten');
    this.engineToggleBtnEl.type = 'button';
    this.engineToggleBtnEl.addEventListener('click', () => this.callbacks.onStartEngineToggle());
    this.engineControlCardEl.append(engineStatusRow, this.engineToggleBtnEl);

    // Accordion: Werkstatt-Tipp (Warum?)
    this.whyAccordionEl = createEl('div', 'accordion');
    this.whyTriggerEl = createEl('button', 'accordion-trigger');
    this.whyTriggerEl.type = 'button';
    this.whyTriggerEl.append(
      createEl('span', undefined, 'Werkstatt-Tipp (Warum?)'),
      createEl('span', 'accordion-chevron', '▼'),
    );
    this.whyTriggerEl.addEventListener('click', () => {
      this.whyExpanded = !this.whyExpanded;
      this.syncAccordions();
    });
    this.whyContentEl = createEl('div', 'accordion-content is-hidden');
    this.whyAccordionEl.append(this.whyTriggerEl, this.whyContentEl);

    // Accordion: Riemenverlauf-Schema (6PK1025)
    this.diagramAccordionEl = createEl('div', 'accordion');
    this.diagramTriggerEl = createEl('button', 'accordion-trigger');
    this.diagramTriggerEl.type = 'button';
    this.diagramTriggerTitleEl = createEl('span', undefined, 'Riemenverlauf-Schema (6PK1025)');
    this.diagramTriggerEl.append(
      this.diagramTriggerTitleEl,
      createEl('span', 'accordion-chevron', '▼'),
    );
    this.diagramTriggerEl.addEventListener('click', () => {
      if (this.diagramTriggerEl.disabled) return;
      this.diagramExpanded = !this.diagramExpanded;
      this.syncAccordions();
    });
    this.diagramContentEl = createEl('div', 'accordion-content is-hidden');
    this.diagramLockedBoxEl = createEl(
      'div',
      'diagram-locked-box is-hidden',
      'Gesperrt: Inspiziere in Schritt 5 zuerst den alten Keilrippenriemen mit der Hand, um das 6PK1025-Schema freizuschalten.',
    );
    this.diagramSvgWrapEl = createEl('div', 'diagram-svg-wrap');
    this.diagramContentEl.append(this.diagramLockedBoxEl, this.diagramSvgWrapEl);
    this.diagramAccordionEl.append(this.diagramTriggerEl, this.diagramContentEl);

    objBody.append(
      this.stepSubtitleEl,
      this.stepTitleEl,
      this.stepDescEl,
      this.subObjectiveListEl,
      this.engineControlCardEl,
      this.whyAccordionEl,
      this.diagramAccordionEl,
    );
    this.objectivePanelEl.append(objHeader, objBody);
    this.leftRailEl.append(this.expandPillEl, this.objectivePanelEl);

    // ------------------------------------------------------------------
    // 4. Bottom 8-Slot Werkzeugleiste
    // ------------------------------------------------------------------
    this.hotbarWrapEl = createEl('div', 'hud-hotbar-wrap is-hidden');
    const hotbar = createEl('div', 'hud-hotbar hud-glass');

    for (const tool of TOOL_DEFINITIONS) {
      const btn = createEl('button', 'tool-slot');
      btn.type = 'button';
      btn.title = `${tool.name} — ${tool.spec}`;

      const hotkey = createEl('span', 'tool-hotkey', tool.hotkey);
      const recBadge = createEl('span', 'tool-rec-badge is-hidden', 'Tipp');
      const iconWrap = createEl('div', 'tool-icon');
      iconWrap.innerHTML = TOOL_ICONS[tool.id];
      const nameSpan = createEl('span', 'tool-name', tool.shortName);

      btn.append(hotkey, recBadge, iconWrap, nameSpan);
      btn.addEventListener('click', () => this.callbacks.onSelectTool(tool.id));

      this.toolSlots.set(tool.id, { btn, recBadge });
      hotbar.append(btn);
    }
    this.hotbarWrapEl.append(hotbar);

    // ------------------------------------------------------------------
    // 5. Centered Interactive Minigame Overlays
    // ------------------------------------------------------------------
    this.minigameWrapEl = createEl('div', 'hud-minigame-wrap is-hidden');
    const minigameCard = createEl('div', 'minigame-card');

    // 5a. Tensioner Minigame View
    this.tensionerViewEl = createEl('div', 'is-hidden');
    const tensHeader = createEl('div', 'minigame-header');
    const tensTitleWrap = createEl('div');
    tensTitleWrap.append(createEl('div', 'minigame-eyebrow', 'Spezialwerkzeug T10060A • SW 16'));
    this.tensionerTitleEl = createEl('h3', 'minigame-title', 'Spannrolle entspannen');
    this.tensionerSubtitleEl = createEl(
      'div',
      'minigame-subtitle',
      'Drehe die Spannrolle im Uhrzeigersinn bis die 4-mm-Bohrung fluchtet.',
    );
    tensTitleWrap.append(this.tensionerTitleEl, this.tensionerSubtitleEl);
    tensHeader.append(tensTitleWrap);

    const tensReadoutRow = createEl('div', 'tensioner-readout-row');
    this.tensionerAngleEl = createEl('span', 'tensioner-angle tabular', '0.0°');
    this.tensionerStatusEl = createEl('span', 'tensioner-status-pill', '0° → 35°');
    tensReadoutRow.append(this.tensionerAngleEl, this.tensionerStatusEl);

    const tensBarWrap = createEl('div', 'tensioner-bar-wrap');
    this.tensionerZoneEl = createEl('div', 'tensioner-zone');
    this.tensionerFillEl = createEl('div', 'tensioner-fill');
    tensBarWrap.append(this.tensionerZoneEl, this.tensionerFillEl);

    const tensScale = createEl('div', 'tensioner-scale tabular');
    tensScale.append(
      createEl('span', undefined, '0°'),
      createEl('span', 'tensioner-zone-hint', '28°–35°: 4-mm-Bohrung fluchtet!'),
      createEl('span', undefined, '35°'),
    );

    this.tensionerHoldBtnEl = createEl(
      'button',
      'minigame-hold-btn',
      'SW 16 gedrückt halten / [Leertaste]',
    );
    this.tensionerHoldBtnEl.type = 'button';
    this.bindHoldButton(
      this.tensionerHoldBtnEl,
      () => this.tensionerPressed,
      (next) => {
        this.tensionerPressed = next;
        this.tensionerHoldBtnEl.classList.toggle('is-pressed', next);
        this.callbacks.onTensionerPressChange(next);
      },
    );

    this.tensionerViewEl.append(
      tensHeader,
      tensReadoutRow,
      tensBarWrap,
      tensScale,
      this.tensionerHoldBtnEl,
    );

    // 5b. Torque Wrench Minigame View (Radial SVG Gauge)
    this.torqueViewEl = createEl('div', 'is-hidden');
    const torqueHeader = createEl('div', 'minigame-header');
    const torqueTitleWrap = createEl('div');
    torqueTitleWrap.append(createEl('div', 'minigame-eyebrow', 'Kalibrierter Drehmomentschlüssel'));
    this.torqueTitleEl = createEl('h3', 'minigame-title', 'Drehmoment anziehen');
    this.torqueBoltEl = createEl('div', 'minigame-subtitle', 'Schraubverbindung');
    torqueTitleWrap.append(this.torqueTitleEl, this.torqueBoltEl);
    torqueHeader.append(torqueTitleWrap);

    const torqueGaugeBox = createEl('div', 'torque-gauge-box');
    const torqueSvg = createSvgEl('svg');
    torqueSvg.setAttribute('viewBox', '0 0 240 196');
    torqueSvg.classList.add('torque-svg');

    const trackPath = createSvgEl('path');
    trackPath.setAttribute(
      'd',
      describeSvgArc(
        TORQUE_ARC_CENTER_X,
        TORQUE_ARC_CENTER_Y,
        TORQUE_ARC_RADIUS,
        TORQUE_ARC_START_DEG,
        TORQUE_ARC_START_DEG + TORQUE_ARC_SWEEP_DEG,
      ),
    );
    trackPath.setAttribute('fill', 'none');
    trackPath.setAttribute('stroke', 'rgba(148, 163, 184, 0.22)');
    trackPath.setAttribute('stroke-width', '14');
    trackPath.setAttribute('stroke-linecap', 'round');

    this.torqueBandPathEl = createSvgEl('path');
    this.torqueBandPathEl.setAttribute('fill', 'none');
    this.torqueBandPathEl.setAttribute('stroke', 'rgba(16, 185, 129, 0.72)');
    this.torqueBandPathEl.setAttribute('stroke-width', '14');

    this.torqueActiveArcEl = createSvgEl('path');
    this.torqueActiveArcEl.setAttribute('d', trackPath.getAttribute('d') ?? '');
    this.torqueActiveArcEl.setAttribute('fill', 'none');
    this.torqueActiveArcEl.setAttribute('stroke', '#38bdf8');
    this.torqueActiveArcEl.setAttribute('stroke-width', '6');
    this.torqueActiveArcEl.setAttribute('stroke-linecap', 'round');
    this.torqueActiveArcEl.setAttribute('stroke-dasharray', TORQUE_ARC_CIRCUMFERENCE.toFixed(2));
    this.torqueActiveArcEl.setAttribute('stroke-dashoffset', TORQUE_ARC_CIRCUMFERENCE.toFixed(2));

    this.torqueTicksGroupEl = createSvgEl('g');

    this.torqueNeedleGroupEl = createSvgEl('g');
    const needleLine = createSvgEl('line');
    needleLine.setAttribute('x1', String(TORQUE_ARC_CENTER_X));
    needleLine.setAttribute('y1', String(TORQUE_ARC_CENTER_Y + 8));
    needleLine.setAttribute('x2', String(TORQUE_ARC_CENTER_X));
    needleLine.setAttribute('y2', String(TORQUE_ARC_CENTER_Y - TORQUE_ARC_RADIUS + 6));
    needleLine.setAttribute('stroke', '#f8fafc');
    needleLine.setAttribute('stroke-width', '3');
    needleLine.setAttribute('stroke-linecap', 'round');

    const needleHub = createSvgEl('circle');
    needleHub.setAttribute('cx', String(TORQUE_ARC_CENTER_X));
    needleHub.setAttribute('cy', String(TORQUE_ARC_CENTER_Y));
    needleHub.setAttribute('r', '7');
    needleHub.setAttribute('fill', '#38bdf8');
    needleHub.setAttribute('stroke', '#090d16');
    needleHub.setAttribute('stroke-width', '2');

    this.torqueNeedleGroupEl.append(needleLine, needleHub);

    torqueSvg.append(
      trackPath,
      this.torqueBandPathEl,
      this.torqueActiveArcEl,
      this.torqueTicksGroupEl,
      this.torqueNeedleGroupEl,
    );

    const torqueDigitalOverlay = createEl('div', 'torque-digital-overlay');
    this.torqueValueEl = createEl('div', 'torque-nm-value tabular', '0.0 Nm');
    this.torqueTargetSubEl = createEl('div', 'torque-target-sub tabular', 'Ziel: 40 ± 3 Nm');
    torqueDigitalOverlay.append(this.torqueValueEl, this.torqueTargetSubEl);

    torqueGaugeBox.append(torqueSvg, torqueDigitalOverlay);

    this.torqueHoldBtnEl = createEl(
      'button',
      'minigame-hold-btn',
      'Drehmoment aufbauen — bei KLICK loslassen / [Leertaste]',
    );
    this.torqueHoldBtnEl.type = 'button';
    this.bindHoldButton(
      this.torqueHoldBtnEl,
      () => this.torquePressed,
      (next) => {
        this.torquePressed = next;
        this.torqueHoldBtnEl.classList.toggle('is-pressed', next);
        this.callbacks.onTorquePressChange(next);
      },
    );

    this.torqueViewEl.append(torqueHeader, torqueGaugeBox, this.torqueHoldBtnEl);

    minigameCard.append(this.tensionerViewEl, this.torqueViewEl);
    this.minigameWrapEl.append(minigameCard);

    // ------------------------------------------------------------------
    // 6. Floating 3D Part Tooltip & Toast Banner
    // ------------------------------------------------------------------
    this.tooltipEl = createEl('div', 'hud-tooltip is-hidden');
    const tooltipHeader = createEl('div', 'tooltip-header');
    this.tooltipLabelEl = createEl('div', 'tooltip-label');
    this.tooltipPnEl = createEl('span', 'tooltip-pn is-hidden');
    tooltipHeader.append(this.tooltipLabelEl, this.tooltipPnEl);
    this.tooltipStatusEl = createEl('div', 'tooltip-status is-hidden');
    this.tooltipHintEl = createEl('div', 'tooltip-hint is-hidden');
    this.tooltipEl.append(tooltipHeader, this.tooltipStatusEl, this.tooltipHintEl);

    this.toastWrapEl = createEl('div', 'hud-toast-wrap is-hidden');
    this.toastEl = createEl('div', 'hud-toast');
    this.toastWrapEl.append(this.toastEl);

    // ------------------------------------------------------------------
    // 7. Meister-Zertifikat Completion Modal
    // ------------------------------------------------------------------
    this.certWrapEl = createEl('div', 'hud-cert-wrap is-hidden');
    const certCard = createEl('div', 'cert-card');

    const certTop = createEl('div', 'cert-top');
    const certHeadingGroup = createEl('div');
    certHeadingGroup.append(
      createEl('div', 'cert-eyebrow', 'Abnahme bestanden • VW EA288 1.6 TDI'),
      createEl('h2', 'cert-title', 'Meister-Zertifikat'),
      createEl(
        'p',
        'cert-sub',
        'Keilrippenriemen 6PK1025 & Spannrolle 04L 903 315 erfolgreich gewechselt.',
      ),
    );

    this.certGradeBadgeEl = createEl('div', 'cert-grade-badge');
    this.certGradeLetterEl = createEl('span', 'cert-grade-letter', 'S');
    this.certGradeCaptionEl = createEl('span', 'cert-grade-caption', 'Meister');
    this.certGradeBadgeEl.append(this.certGradeLetterEl, this.certGradeCaptionEl);
    certTop.append(certHeadingGroup, this.certGradeBadgeEl);

    const certMetrics = createEl('div', 'cert-metrics');
    this.certXpEl = createEl('div', 'cert-metric-val tabular', '0 XP');
    this.certTimeEl = createEl('div', 'cert-metric-val tabular', '00:00');
    this.certMistakesEl = createEl('div', 'cert-metric-val tabular', '0');
    this.certModeEl = createEl('div', 'cert-metric-val', 'Guide');

    certMetrics.append(
      this.buildCertMetricBox('Gesamt-XP', this.certXpEl),
      this.buildCertMetricBox('Arbeitszeit', this.certTimeEl),
      this.buildCertMetricBox('Fehler', this.certMistakesEl),
      this.buildCertMetricBox('Prüfungsmodus', this.certModeEl),
    );

    const torqueSectionTitle = createEl('h3', 'cert-section-title', 'Drehmoment-Protokoll');
    this.certTorqueListEl = createEl('div', 'cert-torque-list');

    const certActions = createEl('div', 'cert-actions');
    const inspectBtn = createEl(
      'button',
      'cert-btn cert-btn--inspect',
      'Freier Inspektionsmodus (Motor testen)',
    );
    inspectBtn.type = 'button';
    inspectBtn.addEventListener('click', () => this.callbacks.onFreeInspect());

    const newRepairBtn = createEl('button', 'cert-btn cert-btn--reset', 'Neue Reparatur starten');
    newRepairBtn.type = 'button';
    newRepairBtn.addEventListener('click', () => this.callbacks.onResetGame());

    certActions.append(inspectBtn, newRepairBtn);
    certCard.append(certTop, certMetrics, torqueSectionTitle, this.certTorqueListEl, certActions);
    this.certWrapEl.append(certCard);

    // ------------------------------------------------------------------
    // 8. 3D Asset Loading Overlay
    // ------------------------------------------------------------------
    this.loadingWrapEl = createEl('div', 'hud-loading-wrap is-hidden');
    const loadingCard = createEl('div', 'hud-loading-card');
    const loadingSpinner = createEl('div', 'loading-spinner');
    const loadingCopy = createEl('div', 'loading-copy');
    const loadingEyebrow = createEl('div', 'loading-eyebrow', 'VW Digital Cockpit • 3D-Szene');
    this.loadingTextEl = createEl('div', 'loading-text', 'Lade hochauflösende 3D-Werkstattmodelle…');
    loadingCopy.append(loadingEyebrow, this.loadingTextEl);
    loadingCard.append(loadingSpinner, loadingCopy);
    this.loadingWrapEl.append(loadingCard);

    // Mount all layers into flex-column HUD root
    this.stageRightEl.append(this.toastWrapEl, this.minigameWrapEl);
    this.middleStageEl.append(this.leftRailEl, this.stageRightEl);

    this.hudRoot.append(
      this.titleScreenEl,
      this.topWrapEl,
      this.middleStageEl,
      this.hotbarWrapEl,
      this.tooltipEl,
      this.certWrapEl,
      this.loadingWrapEl,
    );
    this.root.append(this.hudRoot);

    this.windowBlurHandler = () => {
      if (this.tensionerPressed) {
        this.tensionerPressed = false;
        this.tensionerHoldBtnEl.classList.remove('is-pressed');
        this.callbacks.onTensionerPressChange(false);
      }
      if (this.torquePressed) {
        this.torquePressed = false;
        this.torqueHoldBtnEl.classList.remove('is-pressed');
        this.callbacks.onTorquePressChange(false);
      }
    };
    window.addEventListener('blur', this.windowBlurHandler);
  }

  /**
   * Updates all HUD views cleanly from the latest GameSnapshot without rebuilding interactive controls.
   */
  public render(snapshot: GameSnapshot): void {
    // Title Screen vs In-Game visibility
    this.titleScreenEl.classList.toggle('is-hidden', snapshot.started);
    this.topWrapEl.classList.toggle('is-hidden', !snapshot.started);
    this.middleStageEl.classList.toggle('is-hidden', !snapshot.started);
    this.hotbarWrapEl.classList.toggle('is-hidden', !snapshot.started);

    this.renderToast(snapshot);
    this.renderTooltip(snapshot);

    if (!snapshot.started) {
      this.minigameWrapEl.classList.add('is-hidden');
      this.certWrapEl.classList.add('is-hidden');
      this.releaseStaleHolds('none');
      return;
    }

    const totalSteps = REPAIR_STEPS.length;
    const clampedIndex = Math.max(0, Math.min(totalSteps - 1, snapshot.stepIndex));
    const currentStep = REPAIR_STEPS[clampedIndex];

    this.renderTopBar(snapshot, clampedIndex, currentStep.subObjectives.length, totalSteps);
    this.renderObjectivePanel(snapshot, clampedIndex, totalSteps);
    this.renderHotbar(snapshot);
    this.renderMinigame(snapshot.minigame);
    this.renderCompletionModal(snapshot);
  }

  /**
   * Shows or hides the translucent 3D model loading overlay.
   */
  public setLoading(visible: boolean, label?: string): void {
    this.loadingTextEl.textContent = label ?? 'Lade hochauflösende 3D-Werkstattmodelle…';
    this.loadingWrapEl.classList.toggle('is-hidden', !visible);
  }

  /**
   * Moves the floating 3D part tooltip to cursor coordinates via hardware-accelerated transform.
   */
  public setTooltipScreenPos(x: number, y: number): void {
    this.tooltipX = x;
    this.tooltipY = y;
    if (this.tooltipVisible) {
      this.applyTooltipTransform();
    }
  }

  /**
   * Removes HUD DOM nodes and global listeners.
   */
  public destroy(): void {
    window.removeEventListener('blur', this.windowBlurHandler);
    this.hudRoot.remove();
  }

  // --------------------------------------------------------------------
  // Private Rendering Helpers (Cached DOM Refs)
  // --------------------------------------------------------------------

  private buildCertMetricBox(label: string, valueEl: HTMLDivElement): HTMLDivElement {
    const box = createEl('div', 'cert-metric-box');
    box.append(createEl('div', 'cert-metric-label', label), valueEl);
    return box;
  }

  private bindHoldButton(
    btn: HTMLButtonElement,
    isPressed: () => boolean,
    setPressed: (next: boolean) => void,
  ): void {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      if (!isPressed()) {
        setPressed(true);
      }
    });

    const release = () => {
      if (isPressed()) {
        setPressed(false);
      }
      btn.blur();
    };

    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);

    // Prevent focused button from triggering native click when user presses Spacebar
    btn.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
      }
    });
  }

  private releaseStaleHolds(activeType: MinigameState['type']): void {
    if (activeType !== 'tensioner' && this.tensionerPressed) {
      this.tensionerPressed = false;
      this.tensionerHoldBtnEl.classList.remove('is-pressed');
      this.callbacks.onTensionerPressChange(false);
    }
    if (activeType !== 'torque' && this.torquePressed) {
      this.torquePressed = false;
      this.torqueHoldBtnEl.classList.remove('is-pressed');
      this.callbacks.onTorquePressChange(false);
    }
  }

  private renderTopBar(
    snapshot: GameSnapshot,
    stepIndex: number,
    stepSubCount: number,
    totalSteps: number,
  ): void {
    // Only update <select>.value when step changes and user isn't actively opening the dropdown
    if (document.activeElement !== this.stepSelectEl && this.stepSelectEl.value !== String(stepIndex)) {
      this.stepSelectEl.value = String(stepIndex);
    }

    const doneInStep = snapshot.completedSubObjectives.length;
    const stepFraction = stepSubCount > 0 ? Math.min(1, doneInStep / stepSubCount) : 0;
    const overallPct = snapshot.completed
      ? 100
      : Math.round(((stepIndex + stepFraction) / totalSteps) * 100);

    this.progressLabelEl.textContent = `Schritt ${stepIndex + 1} / ${totalSteps}`;
    this.progressPercentEl.textContent = `${overallPct}%`;
    this.progressFillEl.style.width = `${overallPct}%`;

    for (const [id, btn] of this.cameraBtns.entries()) {
      btn.classList.toggle('is-active', snapshot.activeCamera === id);
    }

    this.xpValueEl.textContent = `${snapshot.xp} XP`;
    this.timerValueEl.textContent = formatTimer(snapshot.elapsedSeconds);

    this.xrayBtnEl.classList.toggle('is-active-cyan', snapshot.xrayEnabled);
    this.lampBtnEl.classList.toggle('is-active-amber', snapshot.workLampEnabled);
    this.muteBtnEl.classList.toggle('is-muted', snapshot.muted);
    this.muteBtnEl.textContent = snapshot.muted ? 'Ton Aus [M]' : 'Ton [M]';
  }

  private renderObjectivePanel(snapshot: GameSnapshot, stepIndex: number, totalSteps: number): void {
    const step = REPAIR_STEPS[stepIndex];
    const stepChanged = this.lastStepIndex !== stepIndex;

    if (stepChanged) {
      this.lastStepIndex = stepIndex;
      this.stepBadgeEl.textContent = `Schritt ${stepIndex + 1}/${totalSteps}`;
      this.stepSubtitleEl.textContent = step.subtitle;
      this.stepTitleEl.textContent = step.title;
      this.stepDescEl.textContent = step.description;
      this.whyContentEl.textContent = step.whyTip;

      if (step.torqueSpec) {
        this.torqueSpecBadgeEl.textContent = step.torqueSpec;
        this.torqueSpecBadgeEl.classList.remove('is-hidden');
      } else {
        this.torqueSpecBadgeEl.classList.add('is-hidden');
      }

      // Auto-expand belt schematic when entering Step 9 (install_new_belt)
      if (step.id === 'install_new_belt' && this.lastAutoExpandedStepIndex !== stepIndex) {
        this.diagramExpanded = true;
        this.lastAutoExpandedStepIndex = stepIndex;
      }
    }

    this.modeMiniBadgeEl.textContent = snapshot.freeInspectMode
      ? 'Inspektion'
      : snapshot.mode === 'guide'
        ? 'Guide'
        : 'Profi';

    // Checklist rows — rebuild only when step or completed sub-objectives change
    const subKey = `${stepIndex}|${snapshot.completedSubObjectives.join(',')}`;
    if (subKey !== this.lastSubObjectivesKey) {
      this.lastSubObjectivesKey = subKey;
      const doneSet = new Set(snapshot.completedSubObjectives);
      let markedCurrent = false;

      const fragment = document.createDocumentFragment();
      for (const sub of step.subObjectives) {
        const isDone = doneSet.has(sub.id);
        const isCurrent = !isDone && !markedCurrent;
        if (isCurrent) markedCurrent = true;

        const li = createEl(
          'li',
          `subobjective-item${isDone ? ' is-done' : isCurrent ? ' is-current' : ''}`,
        );
        const check = createEl('span', 'subobjective-check', isDone ? '✓' : '');
        const label = createEl('span', undefined, sub.label);
        li.append(check, label);
        fragment.append(li);
      }
      this.subObjectiveListEl.replaceChildren(fragment);
    }

    // Engine start/stop control (Step 11 test_run or freeInspectMode)
    const showEngineCard = step.id === 'test_run' || snapshot.freeInspectMode;
    this.engineControlCardEl.classList.toggle('is-hidden', !showEngineCard);
    if (showEngineCard) {
      this.engineRpmPillEl.classList.toggle('is-running', snapshot.engineRunning);
      const rpm = Math.round(snapshot.engineRpm);
      this.engineRpmTextEl.textContent = snapshot.engineRunning
        ? `${rpm} U/min Leerlauf`
        : `${rpm} U/min Aus`;
      this.engineToggleBtnEl.classList.toggle('is-running', snapshot.engineRunning);
      this.engineToggleBtnEl.textContent = snapshot.engineRunning
        ? '1.6 TDI Motor abstellen'
        : '1.6 TDI Motor starten';
    }

    // Belt Diagram Accordion (locked with hint until Step 5 in Guide mode or unlocked from Step 5+)
    const diagramActuallyUnlocked = snapshot.diagramUnlocked || stepIndex >= 5;
    const canToggleDiagram = diagramActuallyUnlocked || snapshot.mode === 'guide';
    this.diagramTriggerEl.disabled = !canToggleDiagram;

    if (!canToggleDiagram && this.diagramExpanded) {
      this.diagramExpanded = false;
    }

    this.diagramTriggerTitleEl.textContent = diagramActuallyUnlocked
      ? 'Riemenverlauf-Schema (6PK1025)'
      : 'Riemenverlauf-Schema (ab Schritt 5)';

    const highlightedNode = this.resolveDiagramHighlight(snapshot, stepIndex);
    const diagramKey = `${diagramActuallyUnlocked}|${snapshot.mode}|${highlightedNode ?? 'none'}|${snapshot.beltRoutingProgress.join(',')}`;
    if (diagramKey !== this.lastDiagramKey) {
      this.lastDiagramKey = diagramKey;
      this.diagramLockedBoxEl.classList.toggle('is-hidden', diagramActuallyUnlocked);
      this.diagramSvgWrapEl.classList.toggle('is-hidden', !diagramActuallyUnlocked);

      if (diagramActuallyUnlocked) {
        this.diagramSvgWrapEl.innerHTML = renderBeltDiagramSVG(
          highlightedNode,
          snapshot.beltRoutingProgress,
        );
      }
    }

    this.syncAccordions();
    this.syncCollapseState();
  }

  private resolveDiagramHighlight(snapshot: GameSnapshot, stepIndex: number): BeltPulleyNode | null {
    const step = REPAIR_STEPS[stepIndex];
    if (step.id === 'install_new_belt') {
      const done = new Set(snapshot.beltRoutingProgress);
      const order: BeltPulleyNode[] = ['crank', 'ac', 'alternator', 'tensioner'];
      for (const node of order) {
        if (!done.has(node)) return node;
      }
      return null;
    }

    if (
      snapshot.mode === 'guide' &&
      (step.id === 'lock_tensioner' || step.id === 'replace_tensioner' || step.id === 'release_tensioner')
    ) {
      return 'tensioner';
    }

    return null;
  }

  private syncCollapseState(): void {
    this.leftRailEl.classList.toggle('is-collapsed', this.panelCollapsed);
    this.expandPillEl.classList.toggle('is-hidden', !this.panelCollapsed);
    this.objectivePanelEl.classList.toggle('is-hidden', this.panelCollapsed);
  }

  private syncAccordions(): void {
    this.whyAccordionEl.classList.toggle('is-open', this.whyExpanded);
    this.whyContentEl.classList.toggle('is-hidden', !this.whyExpanded);

    this.diagramAccordionEl.classList.toggle('is-open', this.diagramExpanded);
    this.diagramContentEl.classList.toggle('is-hidden', !this.diagramExpanded);
  }

  private renderHotbar(snapshot: GameSnapshot): void {
    const showRecommendation = snapshot.mode === 'guide' && !snapshot.completed;
    for (const [id, slot] of this.toolSlots.entries()) {
      const isActive = snapshot.activeTool === id;
      const isRecommended = showRecommendation && snapshot.recommendedTool === id;
      slot.btn.classList.toggle('is-active', isActive);
      slot.btn.classList.toggle('is-recommended', isRecommended);
      slot.recBadge.classList.toggle('is-hidden', !isRecommended);
      if (isRecommended) {
        slot.recBadge.textContent = isActive ? 'Aktiv' : 'Tipp';
      }
    }
  }

  private renderMinigame(minigame: MinigameState): void {
    this.releaseStaleHolds(minigame.type);

    if (minigame.type === 'none') {
      this.minigameWrapEl.classList.add('is-hidden');
      this.tensionerViewEl.classList.add('is-hidden');
      this.torqueViewEl.classList.add('is-hidden');
      return;
    }

    this.minigameWrapEl.classList.remove('is-hidden');

    if (minigame.type === 'tensioner') {
      this.tensionerViewEl.classList.remove('is-hidden');
      this.torqueViewEl.classList.add('is-hidden');

      this.tensionerTitleEl.textContent =
        minigame.mode === 'lock'
          ? 'Spannrolle entspannen & arretieren'
          : 'Spannrolle kontrolliert entlasten';
      this.tensionerSubtitleEl.textContent =
        minigame.mode === 'lock'
          ? 'SW 16 im Uhrzeigersinn (0° → 35°) drehen bis die 4-mm-Bohrung fluchtet.'
          : 'Spanner leicht gegenhalten bis T10060A frei ist, dann kontrolliert zurückführen.';

      const angleDeg = Math.max(0, Math.min(35, minigame.progress * 35));
      this.tensionerAngleEl.textContent = `${angleDeg.toFixed(1)}°`;
      this.tensionerStatusEl.textContent = minigame.aligned ? 'FLUCHTET!' : 'Spannen (↻)';
      this.tensionerStatusEl.classList.toggle('is-aligned', minigame.aligned);

      const zoneLeftPct = Math.max(0, Math.min(100, minigame.targetMin * 100));
      const zoneWidthPct = Math.max(0, Math.min(100 - zoneLeftPct, (minigame.targetMax - minigame.targetMin) * 100));
      this.tensionerZoneEl.style.left = `${zoneLeftPct}%`;
      this.tensionerZoneEl.style.width = `${zoneWidthPct}%`;

      const fillPct = Math.max(0, Math.min(100, minigame.progress * 100));
      this.tensionerFillEl.style.width = `${fillPct.toFixed(2)}%`;
      this.tensionerFillEl.classList.toggle('is-aligned', minigame.aligned);
      return;
    }

    // Torque Wrench Minigame
    this.tensionerViewEl.classList.add('is-hidden');
    this.torqueViewEl.classList.remove('is-hidden');

    this.torqueTitleEl.textContent = minigame.label;
    this.torqueBoltEl.textContent = minigame.boltLabel;

    const specKey = `${minigame.targetNm}|${minigame.toleranceNm}|${minigame.maxNm}`;
    if (specKey !== this.lastMinigameSpecKey) {
      this.lastMinigameSpecKey = specKey;
      this.rebuildTorqueGaugeBands(minigame.targetNm, minigame.toleranceNm, minigame.maxNm);
    }

    const safeMax = Math.max(1, minigame.maxNm);
    const ratio = Math.max(0, Math.min(1, minigame.currentNm / safeMax));
    const needleAngle = TORQUE_ARC_START_DEG + ratio * TORQUE_ARC_SWEEP_DEG;

    this.torqueNeedleGroupEl.setAttribute(
      'transform',
      `rotate(${needleAngle.toFixed(2)} ${TORQUE_ARC_CENTER_X} ${TORQUE_ARC_CENTER_Y})`,
    );

    const dashOffset = TORQUE_ARC_CIRCUMFERENCE * (1 - ratio);
    this.torqueActiveArcEl.style.strokeDashoffset = dashOffset.toFixed(2);

    const minTarget = minigame.targetNm - minigame.toleranceNm;
    const maxTarget = minigame.targetNm + minigame.toleranceNm;
    const inZone = minigame.currentNm >= minTarget && minigame.currentNm <= maxTarget;
    const overZone = minigame.currentNm > maxTarget;
    const approaching = !inZone && !overZone && minigame.currentNm >= minTarget - minigame.toleranceNm * 2.2;

    this.torqueValueEl.textContent = `${minigame.currentNm.toFixed(1)} Nm`;
    this.torqueValueEl.classList.toggle('is-in-zone', inZone);
    this.torqueValueEl.classList.toggle('is-approaching', approaching);
    this.torqueValueEl.classList.toggle('is-over', overZone);

    this.torqueActiveArcEl.setAttribute(
      'stroke',
      inZone ? '#10b981' : overZone ? '#ef4444' : approaching ? '#f59e0b' : '#38bdf8',
    );
    this.torqueTargetSubEl.textContent = `Ziel: ${minigame.targetNm} ± ${minigame.toleranceNm} Nm`;
  }

  private rebuildTorqueGaugeBands(targetNm: number, toleranceNm: number, maxNm: number): void {
    const safeMax = Math.max(1, maxNm);
    const nmToAngle = (nm: number): number =>
      TORQUE_ARC_START_DEG + Math.max(0, Math.min(1, nm / safeMax)) * TORQUE_ARC_SWEEP_DEG;

    const bandStart = nmToAngle(targetNm - toleranceNm);
    const bandEnd = nmToAngle(targetNm + toleranceNm);
    this.torqueBandPathEl.setAttribute(
      'd',
      describeSvgArc(
        TORQUE_ARC_CENTER_X,
        TORQUE_ARC_CENTER_Y,
        TORQUE_ARC_RADIUS,
        bandStart,
        bandEnd,
      ),
    );

    const fragment = document.createDocumentFragment();
    const tickRatios = [0, 0.25, 0.5, 0.75, 1];
    for (const r of tickRatios) {
      const ang = TORQUE_ARC_START_DEG + r * TORQUE_ARC_SWEEP_DEG;
      const outer = polarToCartesian(TORQUE_ARC_CENTER_X, TORQUE_ARC_CENTER_Y, TORQUE_ARC_RADIUS + 11, ang);
      const inner = polarToCartesian(TORQUE_ARC_CENTER_X, TORQUE_ARC_CENTER_Y, TORQUE_ARC_RADIUS - 10, ang);
      const tick = createSvgEl('line');
      tick.setAttribute('x1', inner.x.toFixed(1));
      tick.setAttribute('y1', inner.y.toFixed(1));
      tick.setAttribute('x2', outer.x.toFixed(1));
      tick.setAttribute('y2', outer.y.toFixed(1));
      tick.setAttribute('stroke', 'rgba(148, 163, 184, 0.48)');
      tick.setAttribute('stroke-width', '1.8');
      fragment.append(tick);

      const labelPos = polarToCartesian(
        TORQUE_ARC_CENTER_X,
        TORQUE_ARC_CENTER_Y,
        TORQUE_ARC_RADIUS + 22,
        ang,
      );
      const label = createSvgEl('text');
      label.setAttribute('x', labelPos.x.toFixed(1));
      label.setAttribute('y', labelPos.y.toFixed(1));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('fill', '#94a3b8');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-weight', '700');
      label.textContent = String(Math.round(r * safeMax));
      fragment.append(label);
    }

    // Target marker tick
    const targetAng = nmToAngle(targetNm);
    const tOuter = polarToCartesian(TORQUE_ARC_CENTER_X, TORQUE_ARC_CENTER_Y, TORQUE_ARC_RADIUS + 13, targetAng);
    const tInner = polarToCartesian(TORQUE_ARC_CENTER_X, TORQUE_ARC_CENTER_Y, TORQUE_ARC_RADIUS - 12, targetAng);
    const targetTick = createSvgEl('line');
    targetTick.setAttribute('x1', tInner.x.toFixed(1));
    targetTick.setAttribute('y1', tInner.y.toFixed(1));
    targetTick.setAttribute('x2', tOuter.x.toFixed(1));
    targetTick.setAttribute('y2', tOuter.y.toFixed(1));
    targetTick.setAttribute('stroke', '#34d399');
    targetTick.setAttribute('stroke-width', '2.8');
    fragment.append(targetTick);

    this.torqueTicksGroupEl.replaceChildren(fragment);
  }

  private renderTooltip(snapshot: GameSnapshot): void {
    const part = snapshot.hoveredPart;
    if (!part || snapshot.minigame.type !== 'none') {
      if (this.tooltipVisible) {
        this.tooltipVisible = false;
        this.tooltipEl.classList.add('is-hidden');
      }
      this.lastHoveredKey = '';
      return;
    }

    const hoveredKey = `${part.id}|${part.label}|${part.partNumber ?? ''}|${part.status ?? ''}|${part.hint ?? ''}`;
    if (hoveredKey !== this.lastHoveredKey) {
      this.lastHoveredKey = hoveredKey;
      this.tooltipLabelEl.textContent = part.label;

      if (part.partNumber) {
        this.tooltipPnEl.textContent = part.partNumber;
        this.tooltipPnEl.classList.remove('is-hidden');
      } else {
        this.tooltipPnEl.classList.add('is-hidden');
      }

      if (part.status) {
        this.tooltipStatusEl.textContent = part.status;
        this.tooltipStatusEl.classList.remove('is-hidden');
      } else {
        this.tooltipStatusEl.classList.add('is-hidden');
      }

      if (part.hint) {
        this.tooltipHintEl.textContent = part.hint;
        this.tooltipHintEl.classList.remove('is-hidden');
      } else {
        this.tooltipHintEl.classList.add('is-hidden');
      }
    }

    if (!this.tooltipVisible) {
      this.tooltipVisible = true;
      this.tooltipEl.classList.remove('is-hidden');
    }
    this.applyTooltipTransform();
  }

  private applyTooltipTransform(): void {
    const offset = 16;
    const width = this.tooltipEl.offsetWidth || 220;
    const height = this.tooltipEl.offsetHeight || 64;
    const maxX = Math.max(12, window.innerWidth - width - 12);
    const maxY = Math.max(12, window.innerHeight - height - 12);

    const clampedX = Math.max(12, Math.min(maxX, this.tooltipX + offset));
    const clampedY = Math.max(12, Math.min(maxY, this.tooltipY + offset));
    this.tooltipEl.style.transform = `translate3d(${Math.round(clampedX)}px, ${Math.round(clampedY)}px, 0)`;
  }

  private renderToast(snapshot: GameSnapshot): void {
    const toast = snapshot.toast;
    if (!toast) {
      this.toastWrapEl.classList.add('is-hidden');
      this.lastToastId = -1;
      return;
    }

    this.toastWrapEl.classList.remove('is-hidden');
    if (toast.id !== this.lastToastId) {
      this.lastToastId = toast.id;
      this.toastEl.className = `hud-toast hud-toast--${toast.kind}`;
      const prefix =
        toast.kind === 'success'
          ? '✓'
          : toast.kind === 'warning'
            ? '⚠'
            : toast.kind === 'error'
              ? '✕'
              : 'ℹ';
      this.toastEl.textContent = `${prefix}  ${toast.text}`;

      // Restart entrance animation cleanly
      this.toastEl.style.animation = 'none';
      void this.toastEl.offsetWidth;
      this.toastEl.style.animation = '';
    }
  }

  private renderCompletionModal(snapshot: GameSnapshot): void {
    const shouldShow = snapshot.completed && !snapshot.freeInspectMode;
    this.certWrapEl.classList.toggle('is-hidden', !shouldShow);
    if (!shouldShow) return;

    const certKey = `${snapshot.xp}|${snapshot.elapsedSeconds}|${snapshot.mistakes}|${snapshot.mode}|${snapshot.torqueScores.map((s) => `${s.label}:${s.achievedNm}`).join(',')}`;
    if (certKey === this.lastCertKey) return;
    this.lastCertKey = certKey;

    const { grade, caption } = evaluateGrade(snapshot);
    this.certGradeLetterEl.textContent = grade;
    this.certGradeCaptionEl.textContent = caption;
    this.certGradeBadgeEl.className = `cert-grade-badge is-grade-${grade.toLowerCase()}`;

    this.certXpEl.textContent = `${snapshot.xp} XP`;
    this.certTimeEl.textContent = formatTimer(snapshot.elapsedSeconds);
    this.certMistakesEl.textContent = String(snapshot.mistakes);
    this.certModeEl.textContent = snapshot.mode === 'guide' ? 'Guide' : 'Profi';

    this.renderTorqueScoreList(snapshot.torqueScores);
  }

  private renderTorqueScoreList(scores: TorqueScore[]): void {
    if (scores.length === 0) {
      const empty = createEl(
        'div',
        'cert-torque-row',
        'Keine Drehmomentmessungen in diesem Durchlauf protokolliert.',
      );
      this.certTorqueListEl.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of scores) {
      const row = createEl('div', 'cert-torque-row');
      const name = createEl('span', 'cert-torque-name', entry.label);
      const vals = createEl('div', 'cert-torque-vals tabular');

      const deltaSign = entry.deltaNm >= 0 ? '+' : '';
      const valText = createEl(
        'span',
        undefined,
        `${entry.achievedNm.toFixed(1)} / ${entry.targetNm} Nm (${deltaSign}${entry.deltaNm.toFixed(1)})`,
      );
      const ratingPill = createEl(
        'span',
        `cert-rating-pill cert-rating-pill--${entry.rating.toLowerCase()}`,
        `${entry.rating} (+${entry.xp} XP)`,
      );

      vals.append(valText, ratingPill);
      row.append(name, vals);
      fragment.append(row);
    }
    this.certTorqueListEl.replaceChildren(fragment);
  }
}
