/// <reference types="vite/client" />
import '../styles.css';

import {
  AUX_DRIVE_SPEC,
  CLHA_ACTIVE_DATASHEET,
  CLHA_LOCK_TOOLS,
  CLHA_MONTAGE_VALUES,
  CLHA_REFERENCE_DATASHEET,
  CLHA_SOURCES,
  CLHA_SPECIAL_TOOLS,
  CLHA_TIMING_BELT,
  CLHA_TIMING_CHECK,
  OIL_PUMP_BELT_SPEC,
  SIMULATED_TENSIONER_VARIANT,
  VEHICLE_SPEC,
  formatMeasure,
  formatSignedDelta,
} from '../specs/clhaSpecs';
import type {
  CameraPresetId,
  FasteningUnit,
  GameSnapshot,
  HUDCallbacks,
  MinigameState,
  TimingWheelId,
  ToolId,
  VwBeltLayStationId,
} from '../types';
import { CAMERA_PRESETS, REPAIR_STEPS, TOOL_DEFINITIONS } from '../steps/stepDefinitions';
import { renderBeltDiagramSVG } from './BeltDiagramSVG';

const TOOL_ICONS: Record<ToolId, string> = {
  hand: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v4"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v6"/><path d="M10 10.5V5a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.5L3.3 16a2 2 0 0 1 2.7-2.8L8 15"/></svg>`,
  impact17: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11v5H3z"/><path d="M14 9h4v3h-4"/><path d="M18 9.5h3v2h-3"/><path d="M6 13l-1.5 7h4L10 13"/><circle cx="7" cy="10.5" r="0.8" fill="currentColor"/></svg>`,
  torx25: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-4.5"/><path d="M8.5 15.5l4-4"/><rect x="11.5" y="4.5" width="7" height="4.5" rx="1.5" transform="rotate(-45 15 6.75)"/><path d="M3 21l2-2"/><path d="M17.5 4.5l2 2"/></svg>`,
  crankWrench: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="7" r="3.5"/><path d="M14.5 9.5L5.2 18.8a1.8 1.8 0 0 0 2.5 2.5L17 12"/><circle cx="17" cy="7" r="1.2" fill="currentColor"/></svg>`,
  lockingPins: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h10a2 2 0 0 1 2 2v11"/><path d="M6 7a2 2 0 1 1 0-4h4"/><circle cx="18" cy="20" r="0.8" fill="currentColor"/><path d="M15 11h6"/></svg>`,
  eccentricKey: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 1 0 3 3L9.5 17.5a3.2 3.2 0 1 1-3-3z"/><circle cx="17" cy="7" r="1.4"/></svg>`,
  torqueWrench: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20l11-11"/><path d="M14 9a4 4 0 1 0 3-3"/><path d="M5 18l3 3"/><path d="M15 4l5 5"/><path d="M9 12l3 3"/></svg>`,
  newTimingBelt: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4.5" stroke-dasharray="2.4 1.4"/><circle cx="16.5" cy="8.5" r="3" stroke-dasharray="2 1.2"/><path d="M5.5 11.3L14 6.4"/><path d="M11.6 17.7L19 10.2"/><circle cx="8" cy="15" r="1.3"/><circle cx="16.5" cy="8.5" r="0.9"/></svg>`,
};

const VW_LAY_ORDER: readonly VwBeltLayStationId[] = ['crank', 'tensioner', 'cam', 'pump', 'water'];

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
  const torquePenalty = scores.reduce((sum, entry) => (entry.rating === 'Perfekt' ? sum : sum + 3), 0);
  const perfektCount = scores.filter((entry) => entry.rating === 'Perfekt').length;

  let quality = 100 - snapshot.mistakes * 5 - torquePenalty;
  if (snapshot.xp >= 1800) quality += 4;
  if (snapshot.mode === 'pro') quality += 2;
  if (snapshot.xp < 400 && scores.length === 0) quality = Math.min(quality, 75);
  quality = Math.max(0, Math.min(100, quality));

  if (
    quality >= 90 &&
    snapshot.mistakes <= 2 &&
    (scores.length === 0 || perfektCount >= Math.ceil(scores.length / 2))
  ) {
    return { grade: 'S', caption: 'Meister' };
  }
  if (quality >= 76) return { grade: 'A', caption: 'Sehr gut' };
  if (quality >= 58) return { grade: 'B', caption: 'Bestanden' };
  return { grade: 'C', caption: 'Basis' };
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
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
 * Interactive German VW Digital Cockpit HUD overlay for the Golf VII 1.6 TDI (CLHA) 3D Zahnriemen workshop.
 * Keeps the exact VW Digital Cockpit aesthetic while integrating authentic EA288 workflow controls,
 * fuel-system diagnostic bleeding, oil-pump wet-belt cutaway card, and verified VW/YouTube sources.
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

  // Contextual Action Cards (Fuel System Bleed, Oil Pump Cutaway Info, Engine Start/Stop)
  private readonly fuelBleedCardEl: HTMLDivElement;
  private readonly fuelBleedBtnEl: HTMLButtonElement;
  private readonly oilCutawayCardEl: HTMLDivElement;
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
  private readonly specsAccordionEl: HTMLDivElement;
  private readonly specsTriggerEl: HTMLButtonElement;
  private readonly specsContentEl: HTMLDivElement;

  // Bottom 8-Slot Tool Hotbar
  private readonly hotbarWrapEl: HTMLDivElement;
  private readonly toolSlots = new Map<
    ToolId,
    { btn: HTMLButtonElement; recBadge: HTMLSpanElement }
  >();

  // Minigames
  private readonly minigameWrapEl: HTMLDivElement;
  private readonly linearViewEl: HTMLDivElement;
  private readonly linearEyebrowEl: HTMLDivElement;
  private readonly linearTitleEl: HTMLHeadingElement;
  private readonly linearSubtitleEl: HTMLDivElement;
  private readonly linearValueEl: HTMLSpanElement;
  private readonly linearStatusEl: HTMLSpanElement;
  private readonly linearZoneEl: HTMLDivElement;
  private readonly linearFillEl: HTMLDivElement;
  private readonly linearScaleLeftEl: HTMLSpanElement;
  private readonly linearScaleMidEl: HTMLSpanElement;
  private readonly linearScaleRightEl: HTMLSpanElement;
  private readonly linearHoldBtnEl: HTMLButtonElement;
  private readonly linearResetBtnEl: HTMLButtonElement;

  private readonly torqueViewEl: HTMLDivElement;
  private readonly torqueEyebrowEl: HTMLDivElement;
  private readonly torqueTitleEl: HTMLHeadingElement;
  private readonly torqueBoltEl: HTMLDivElement;
  private readonly torqueStagePillsEl: HTMLDivElement;
  private readonly torqueStage1PillEl: HTMLSpanElement;
  private readonly torqueStage2PillEl: HTMLSpanElement;
  private readonly torqueRetryBannerEl: HTMLDivElement;
  private readonly torqueBandPathEl: SVGPathElement;
  private readonly torqueActiveArcEl: SVGPathElement;
  private readonly torqueTicksGroupEl: SVGGElement;
  private readonly torqueNeedleGroupEl: SVGGElement;
  private readonly torqueValueEl: HTMLDivElement;
  private readonly torqueTargetSubEl: HTMLDivElement;
  private readonly torquePlayAidEl: HTMLDivElement;
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
  private lastOilCutawayActive = false;
  private panelCollapsedBeforeOil = false;
  private whyExpanded = false;
  private diagramExpanded = false;
  private specsExpanded = false;
  private lastAutoExpandedStepIndex = -1;

  private activeLinearKind: 'none' | 'auxTensioner' | 'ot' | 'eccentric' = 'none';
  private linearPressed = false;
  private torquePressed = false;
  private lastTorqueStageKey = '';
  private lastTorqueValue = 0;
  private readonly cleanupFns: Array<() => void> = [];

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
    // 1. Title Screen (Identical VW Digital Cockpit layout)
    // ------------------------------------------------------------------
    this.titleScreenEl = createEl('div', 'hud-title-screen');
    const titleCard = createEl('div', 'hud-title-card');

    const eyebrow = createEl('div', 'title-eyebrow');
    eyebrow.append(createEl('span', 'title-eyebrow-dot'), 'Digital Cockpit • EA288 Meisterwerkstatt');

    const titleH1 = createEl('h1', 'title-heading', 'VW Golf VII 1.6 TDI');
    const titleSub = createEl(
      'p',
      'title-sub',
      'Vollständiger Zahnriemenwechsel nach VW-Leitfaden 08.2015: Freilegung, Motorbrücke 10-222 A, Nebenantrieb, Abstecken mit Gegenhaltern, Spannrolle Typ B & Ölbad-Ölpumpenriemen.'
    );
    const specBadge = createEl(
      'div',
      'title-spec-badge',
      `${VEHICLE_SPEC.badgeText} • ${CLHA_TIMING_BELT.shortSpec} • ${SIMULATED_TENSIONER_VARIANT.shortLabel}`
    );

    const modesGrid = createEl('div', 'title-modes');

    const guideBtn = createEl('button', 'title-mode-btn title-mode-btn--guide');
    guideBtn.type = 'button';
    const guideTop = createEl('div', 'title-mode-top');
    guideTop.append(
      createEl('span', 'title-mode-name', 'Werkstatt-Guide (Geführt)'),
      createEl('span', 'title-mode-tag title-mode-tag--guide', 'Geführt')
    );
    guideBtn.append(
      guideTop,
      createEl(
        'span',
        'title-mode-desc',
        '16 reale VW-Schritte mit 3D-Markierungen, Werkzeug-Hinweisen, Sicherheits-Checks & Ölwanne-Schnittansicht.'
      )
    );
    guideBtn.addEventListener('click', () => this.callbacks.onStartGame('guide'));

    const proBtn = createEl('button', 'title-mode-btn title-mode-btn--pro');
    proBtn.type = 'button';
    const proTop = createEl('div', 'title-mode-top');
    proTop.append(
      createEl('span', 'title-mode-name', 'Meister-Prüfung (Profi)'),
      createEl('span', 'title-mode-tag title-mode-tag--pro', 'Profi')
    );
    proBtn.append(
      proTop,
      createEl(
        'span',
        'title-mode-desc',
        'Keine 3D-Markierungen, freie Werkzeugwahl, echte VW-Sperren & strenge Genauigkeitswertung.'
      )
    );
    proBtn.addEventListener('click', () => this.callbacks.onStartGame('pro'));

    modesGrid.append(guideBtn, proBtn);

    const controlsRow = createEl('div', 'title-controls-row');
    controlsRow.innerHTML = [
      '<span><kbd>Klick</kbd>Bauteil</span>',
      '<span><kbd>Ziehen</kbd>Kamera</span>',
      '<span><kbd>1–8</kbd>Werkzeug</span>',
      '<span><kbd>Q–Z</kbd>Kameras (+Ölwanne)</span>',
      '<span><kbd>X</kbd>X-Ray</span>',
      '<span><kbd>L</kbd>Lampe</span>',
      '<span><kbd>M</kbd>Ton</span>',
    ].join('');

    titleCard.append(eyebrow, titleH1, titleSub, specBadge, modesGrid, controlsRow);
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
    this.progressLabelEl = createEl('span', 'tabular', `Schritt 1 / ${REPAIR_STEPS.length}`);
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
      camBtn.dataset.cam = preset.id;
      camBtn.append(
        createEl('span', 'cam-key', `${preset.hotkey}:`),
        createEl('span', undefined, preset.label)
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
    this.stepBadgeEl = createEl('span', 'step-badge tabular', `Schritt 1/${REPAIR_STEPS.length}`);
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

    // Contextual Card: Fuel System Diagnostic Bleed (Step 14)
    this.fuelBleedCardEl = createEl('div', 'fuel-bleed-card is-hidden');
    this.fuelBleedCardEl.append(
      createEl('div', 'card-mini-title', 'VW Diagnose • Rep.-Gr. 23 S. 281'),
      createEl(
        'p',
        'card-mini-desc',
        'Niederdruck-Schnellkupplungen A/B wurden geöffnet. Vor dem ersten Start muss das Kraftstoffsystem über die Vorförderpumpe befüllt & entlüftet werden.'
      )
    );
    this.fuelBleedBtnEl = createEl(
      'button',
      'fuel-bleed-btn',
      'Kraftstoffsystem entlüften (Diagnose starten)'
    );
    this.fuelBleedBtnEl.type = 'button';
    this.fuelBleedBtnEl.addEventListener('click', () => this.callbacks.onBleedFuelSystem());
    this.fuelBleedCardEl.append(this.fuelBleedBtnEl);

    // Contextual Card: Separate Oil-Bath Oil Pump Belt Cutaway Info (Camera Z)
    this.oilCutawayCardEl = createEl('div', 'oil-cutaway-card is-hidden');
    this.oilCutawayCardEl.append(
      createEl('div', 'card-mini-title', 'Schnittansicht • Ölpumpen-Zahnriemen (SSP 820433)'),
      createEl('p', 'card-mini-desc', `${OIL_PUMP_BELT_SPEC.summary} ${OIL_PUMP_BELT_SPEC.serviceNote}`)
    );

    // Engine Control Card (Step 16 / Free Inspect)
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
      createEl('span', 'accordion-chevron', '▼')
    );
    this.whyTriggerEl.addEventListener('click', () => {
      this.whyExpanded = !this.whyExpanded;
      this.syncAccordions();
    });
    this.whyContentEl = createEl('div', 'accordion-content is-hidden');
    this.whyAccordionEl.append(this.whyTriggerEl, this.whyContentEl);

    // Accordion: Zahnriemen-Schema (VW-Folge 1–5)
    this.diagramAccordionEl = createEl('div', 'accordion');
    this.diagramTriggerEl = createEl('button', 'accordion-trigger');
    this.diagramTriggerEl.type = 'button';
    this.diagramTriggerTitleEl = createEl('span', undefined, 'Zahnriemen-Schema (VW-Folge)');
    this.diagramTriggerEl.append(
      this.diagramTriggerTitleEl,
      createEl('span', 'accordion-chevron', '▼')
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
      'Gesperrt: Lege in Schritt 6 den unteren Zahnriemenschutz frei und inspiziere den Zahnriemen mit der Hand [1], um das VW-Schema freizuschalten.'
    );
    this.diagramSvgWrapEl = createEl('div', 'diagram-svg-wrap');
    this.diagramContentEl.append(this.diagramLockedBoxEl, this.diagramSvgWrapEl);
    this.diagramAccordionEl.append(this.diagramTriggerEl, this.diagramContentEl);

    // Accordion: Montagewerte & Quellen (CLHA) — immer in Guide & Profi aufklappbar
    this.specsAccordionEl = createEl('div', 'accordion');
    this.specsTriggerEl = createEl('button', 'accordion-trigger');
    this.specsTriggerEl.type = 'button';
    this.specsTriggerEl.append(
      createEl('span', undefined, 'Montagewerte & Quellen (CLHA)'),
      createEl('span', 'accordion-chevron', '▼')
    );
    this.specsTriggerEl.addEventListener('click', () => {
      this.specsExpanded = !this.specsExpanded;
      this.syncAccordions();
    });
    this.specsContentEl = createEl('div', 'accordion-content is-hidden');
    this.specsContentEl.append(this.buildSpecsDatasheetContent());
    this.specsAccordionEl.append(this.specsTriggerEl, this.specsContentEl);

    objBody.append(
      this.stepSubtitleEl,
      this.stepTitleEl,
      this.stepDescEl,
      this.subObjectiveListEl,
      this.fuelBleedCardEl,
      this.oilCutawayCardEl,
      this.engineControlCardEl,
      this.whyAccordionEl,
      this.diagramAccordionEl,
      this.specsAccordionEl
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
      btn.dataset.tool = tool.id;
      btn.title = `${tool.name} — ${tool.spec}`;

      const hotkey = createEl('span', 'tool-hotkey', tool.hotkey);
      const recBadge = createEl('span', 'tool-rec-badge is-hidden', 'Tipp');
      const iconWrap = createEl('div', 'tool-icon');
      iconWrap.innerHTML = TOOL_ICONS[tool.id];
      const nameSpan = createEl('span', 'tool-name', tool.shortName);
      const specSpan = createEl('span', 'tool-spec tabular', tool.shortSpec);

      btn.append(hotkey, recBadge, iconWrap, nameSpan, specSpan);
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

    // 5a. Linear Precision Gauge (Aux Tensioner Spring Arm, OT Alignment, Eccentric Typ B Pointer)
    this.linearViewEl = createEl('div', 'minigame-panel is-hidden');
    const linScrollBody = createEl('div', 'minigame-scroll-body');
    const linHeader = createEl('div', 'minigame-header');
    const linTitleWrap = createEl('div');
    this.linearEyebrowEl = createEl('div', 'minigame-eyebrow', 'Steuertrieb-Ausrichtung');
    this.linearTitleEl = createEl('h3', 'minigame-title', 'Kurbelwelle auf OT drehen');
    this.linearSubtitleEl = createEl('div', 'minigame-subtitle', '');
    linTitleWrap.append(this.linearEyebrowEl, this.linearTitleEl, this.linearSubtitleEl);
    linHeader.append(linTitleWrap);

    const linReadoutRow = createEl('div', 'tensioner-readout-row');
    this.linearValueEl = createEl('span', 'tensioner-angle tabular', '635°');
    this.linearStatusEl = createEl('span', 'tensioner-status-pill', 'Ausrichten');
    linReadoutRow.append(this.linearValueEl, this.linearStatusEl);

    const linBarWrap = createEl('div', 'tensioner-bar-wrap');
    this.linearZoneEl = createEl('div', 'tensioner-zone');
    this.linearFillEl = createEl('div', 'tensioner-fill');
    linBarWrap.append(this.linearZoneEl, this.linearFillEl);

    const linScale = createEl('div', 'tensioner-scale tabular');
    this.linearScaleLeftEl = createEl('span', undefined, '620°');
    this.linearScaleMidEl = createEl('span', 'tensioner-zone-hint', 'OT · 720°');
    this.linearScaleRightEl = createEl('span', undefined, '760°');
    linScale.append(this.linearScaleLeftEl, this.linearScaleMidEl, this.linearScaleRightEl);

    const linActionsRow = createEl('div', 'minigame-actions-row');
    this.linearHoldBtnEl = createEl('button', 'minigame-hold-btn', 'Gedrückt halten / [Leertaste]');
    this.linearHoldBtnEl.type = 'button';
    this.bindHoldButton(
      this.linearHoldBtnEl,
      () => this.linearPressed,
      (next) => {
        this.linearPressed = next;
        this.linearHoldBtnEl.classList.toggle('is-pressed', next);
        if (this.activeLinearKind === 'auxTensioner') {
          this.callbacks.onAuxPressChange(next);
        } else if (this.activeLinearKind === 'ot') {
          this.callbacks.onOtPressChange(next);
        } else if (this.activeLinearKind === 'eccentric') {
          this.callbacks.onEccentricPressChange(next);
        }
      }
    );

    this.linearResetBtnEl = createEl('button', 'minigame-secondary-btn', '↺ Neu');
    this.linearResetBtnEl.type = 'button';
    this.linearResetBtnEl.addEventListener('click', () => {
      if (this.activeLinearKind === 'ot') {
        this.callbacks.onOtReset();
      } else if (this.activeLinearKind === 'eccentric') {
        this.callbacks.onEccentricReset();
      }
      this.linearResetBtnEl.blur();
    });

    linActionsRow.append(this.linearHoldBtnEl, this.linearResetBtnEl);

    linScrollBody.append(linHeader, linReadoutRow, linBarWrap, linScale);
    this.linearViewEl.append(linScrollBody, linActionsRow);

    // 5b. Torque & Angle Minigame View (Radial SVG Gauge with real Nm / ° units)
    this.torqueViewEl = createEl('div', 'minigame-panel is-hidden');
    const torqueScrollBody = createEl('div', 'minigame-scroll-body');
    const torqueHeader = createEl('div', 'minigame-header');
    const torqueTitleWrap = createEl('div');
    this.torqueEyebrowEl = createEl('div', 'minigame-eyebrow', 'Voranzug (Nm)');
    this.torqueTitleEl = createEl('h3', 'minigame-title', 'Spannrollen-Mutter: Voranzug');
    this.torqueBoltEl = createEl('div', 'minigame-subtitle', 'Montagewert');
    torqueTitleWrap.append(this.torqueEyebrowEl, this.torqueTitleEl, this.torqueBoltEl);
    torqueHeader.append(torqueTitleWrap);

    this.torqueStagePillsEl = createEl('div', 'minigame-stage-pills is-hidden');
    this.torqueStage1PillEl = createEl('span', 'stage-pill tabular', 'Stufe 1');
    this.torqueStage2PillEl = createEl('span', 'stage-pill tabular', 'Stufe 2');
    this.torqueStagePillsEl.append(this.torqueStage1PillEl, this.torqueStage2PillEl);

    this.torqueRetryBannerEl = createEl('div', 'minigame-retry-banner is-hidden');

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
        TORQUE_ARC_START_DEG + TORQUE_ARC_SWEEP_DEG
      )
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
      this.torqueNeedleGroupEl
    );

    const torqueDigitalOverlay = createEl('div', 'torque-digital-overlay');
    this.torqueValueEl = createEl('div', 'torque-nm-value tabular', '0 Nm');
    this.torqueTargetSubEl = createEl('div', 'torque-target-sub tabular', 'Soll: 20 Nm');
    torqueDigitalOverlay.append(this.torqueValueEl, this.torqueTargetSubEl);

    const torqueSvgWrap = createEl('div', 'torque-svg-wrap');
    torqueSvgWrap.append(torqueSvg, torqueDigitalOverlay);

    this.torquePlayAidEl = createEl(
      'div',
      'torque-playaid-note tabular',
      'Spielhilfe-Fenster (keine Werkstoleranz)'
    );

    torqueGaugeBox.append(torqueSvgWrap, this.torquePlayAidEl);

    this.torqueHoldBtnEl = createEl(
      'button',
      'minigame-hold-btn',
      'Anziehen — im Eingabefenster loslassen / [Leertaste]'
    );
    this.torqueHoldBtnEl.type = 'button';
    this.bindHoldButton(
      this.torqueHoldBtnEl,
      () => this.torquePressed,
      (next) => {
        this.torquePressed = next;
        this.torqueHoldBtnEl.classList.toggle('is-pressed', next);
        this.callbacks.onTorquePressChange(next);
      }
    );

    torqueScrollBody.append(
      torqueHeader,
      this.torqueStagePillsEl,
      this.torqueRetryBannerEl,
      torqueGaugeBox
    );
    this.torqueViewEl.append(torqueScrollBody, this.torqueHoldBtnEl);

    minigameCard.append(this.linearViewEl, this.torqueViewEl);
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
      createEl('div', 'cert-eyebrow', `Abnahme bestanden • ${VEHICLE_SPEC.badgeText}`),
      createEl('h2', 'cert-title', 'Meister-Zertifikat'),
      createEl(
        'p',
        'cert-sub',
        `Zahnriemen (${CLHA_TIMING_BELT.specLabel}) in VW-Folge montiert, Spannrolle Typ B (${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°), NW/HDP mit Gegenhalter & Rückbau inkl. Entlüftung bestanden.`
      )
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
      this.buildCertMetricBox('Prüfungsmodus', this.certModeEl)
    );

    const torqueSectionTitle = createEl('h3', 'cert-section-title', 'Anzugs-Protokoll (Montagewerte CLHA)');
    this.certTorqueListEl = createEl('div', 'cert-torque-list');

    const exerciseNote = createEl(
      'p',
      'cert-exercise-note',
      `Übungssimulation für ${VEHICLE_SPEC.badgeText} (${SIMULATED_TENSIONER_VARIANT.shortLabel}). Eingabefenster sind Spielhilfen für die Punktewertung. Alle VW-Montagewerte, SSP 820433 (Ölpumpenriemen) & Video-Zeitmarken siehe „Montagewerte & Quellen (${VEHICLE_SPEC.engineCode})“.`
    );

    const certActions = createEl('div', 'cert-actions');
    const inspectBtn = createEl(
      'button',
      'cert-btn cert-btn--inspect',
      'Freier Inspektionsmodus (Steuertrieb & Ölwanne)'
    );
    inspectBtn.type = 'button';
    inspectBtn.addEventListener('click', () => this.callbacks.onFreeInspect());

    const newRepairBtn = createEl('button', 'cert-btn cert-btn--reset', 'Neue Reparatur starten');
    newRepairBtn.type = 'button';
    newRepairBtn.addEventListener('click', () => this.callbacks.onResetGame());

    certActions.append(inspectBtn, newRepairBtn);
    certCard.append(
      certTop,
      certMetrics,
      torqueSectionTitle,
      this.certTorqueListEl,
      exerciseNote,
      certActions
    );
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

    this.stageRightEl.append(this.toastWrapEl, this.minigameWrapEl);
    this.middleStageEl.append(this.leftRailEl, this.stageRightEl);

    this.hudRoot.append(
      this.titleScreenEl,
      this.topWrapEl,
      this.middleStageEl,
      this.hotbarWrapEl,
      this.tooltipEl,
      this.certWrapEl,
      this.loadingWrapEl
    );
    this.root.append(this.hudRoot);

    this.windowBlurHandler = () => {
      if (this.linearPressed) {
        this.linearPressed = false;
        this.linearHoldBtnEl.classList.remove('is-pressed');
        if (this.activeLinearKind === 'auxTensioner') {
          this.callbacks.onAuxPressChange(false);
        } else if (this.activeLinearKind === 'ot') {
          this.callbacks.onOtPressChange(false);
        } else if (this.activeLinearKind === 'eccentric') {
          this.callbacks.onEccentricPressChange(false);
        }
      }
      if (this.torquePressed) {
        this.torquePressed = false;
        this.torqueHoldBtnEl.classList.remove('is-pressed');
        this.callbacks.onTorquePressChange(false);
      }
    };
    window.addEventListener('blur', this.windowBlurHandler);
  }

  public render(snapshot: GameSnapshot): void {
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

    this.renderTopBar(snapshot, clampedIndex, currentStep.subObjectives, totalSteps);
    this.renderObjectivePanel(snapshot, clampedIndex, totalSteps);
    this.renderHotbar(snapshot);
    this.renderMinigame(snapshot.minigame);
    this.renderCompletionModal(snapshot);
  }

  public setLoading(visible: boolean, label?: string): void {
    this.loadingTextEl.textContent = label ?? 'Lade hochauflösende 3D-Werkstattmodelle…';
    this.loadingWrapEl.classList.toggle('is-hidden', !visible);
  }

  public setTooltipScreenPos(x: number, y: number): void {
    this.tooltipX = x;
    this.tooltipY = y;
    if (this.tooltipVisible) {
      this.applyTooltipTransform();
    }
  }

  public destroy(): void {
    window.removeEventListener('blur', this.windowBlurHandler);
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns.length = 0;
    this.hudRoot.remove();
  }

  private buildSpecsDatasheetContent(): HTMLDivElement {
    const wrap = createEl('div', 'specs-sheet');

    const header = createEl('div', 'specs-vehicle-line');
    header.append(
      createEl('strong', undefined, VEHICLE_SPEC.badgeText),
      createEl(
        'span',
        'specs-subtitle-note',
        `Simulierte Bauart: ${SIMULATED_TENSIONER_VARIANT.shortLabel}`
      )
    );
    wrap.append(header);

    const buildGroup = (title: string, entries: typeof CLHA_ACTIVE_DATASHEET) => {
      const group = createEl('div', 'specs-group');
      group.append(createEl('div', 'specs-group-title', title));
      for (const entry of entries) {
        const row = createEl('div', 'specs-row');
        const top = createEl('div', 'specs-row-top');
        top.append(
          createEl('span', 'specs-part', entry.part),
          createEl('span', 'specs-val tabular', entry.value)
        );
        row.append(top);
        if (entry.note) {
          row.append(createEl('div', 'specs-note', entry.note));
        }
        group.append(row);
      }
      return group;
    };

    wrap.append(
      buildGroup('Montagewerte (VW Golf VII CLHA)', CLHA_ACTIVE_DATASHEET),
      buildGroup('Nebenantrieb, Ölbadriemen & Referenzen', CLHA_REFERENCE_DATASHEET)
    );

    const toolsGroup = createEl('div', 'specs-group');
    toolsGroup.append(createEl('div', 'specs-group-title', 'Spezialwerkzeuge, Bauart & Sicherheitsregeln'));
    const toolRow = createEl('div', 'specs-row');
    toolRow.append(
      createEl(
        'div',
        'specs-note',
        `Brücke ${CLHA_SPECIAL_TOOLS.engineBridge} • Nebenriemen ${CLHA_SPECIAL_TOOLS.auxLockPin} • KW ${CLHA_LOCK_TOOLS.crank.code} • NW ${CLHA_LOCK_TOOLS.cam.code} (Mitnehmer-Gabel) • HDP ${CLHA_LOCK_TOOLS.pump.code} (Naben-Gabel) • Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} / ${CLHA_SPECIAL_TOOLS.pumpCounterhold}. ${SIMULATED_TENSIONER_VARIANT.summary} Kontrolle nach ${CLHA_TIMING_CHECK.crankDegrees}°: NW-Dorn muss passen, leichte HDP-Abweichung zulässig (S. 121), Zeiger max. ${CLHA_TIMING_CHECK.pointerRecheckMaxOffsetMm} mm seitlich (S. 122). ${AUX_DRIVE_SPEC.exampleWrenchNote}`
      )
    );
    toolsGroup.append(toolRow);
    wrap.append(toolsGroup);

    const sourcesGroup = createEl('div', 'specs-group');
    sourcesGroup.append(createEl('div', 'specs-group-title', 'Verifizierte Quellen & gesichtete Videos'));
    const sourcesList = createEl('div', 'specs-sources');
    for (const src of CLHA_SOURCES) {
      const link = document.createElement('a');
      link.className = 'specs-source-link';
      link.href = src.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(
        createEl('span', 'specs-source-title', `${src.title} (${src.edition}) ↗`),
        createEl('span', 'specs-source-section', src.section)
      );
      sourcesList.append(link);
    }
    sourcesGroup.append(sourcesList);
    wrap.append(sourcesGroup);

    return wrap;
  }

  private buildCertMetricBox(label: string, valueEl: HTMLDivElement): HTMLDivElement {
    const box = createEl('div', 'cert-metric-box');
    box.append(createEl('div', 'cert-metric-label', label), valueEl);
    return box;
  }

  private bindHoldButton(
    btn: HTMLButtonElement,
    isPressed: () => boolean,
    setPressed: (next: boolean) => void
  ): void {
    const release = () => {
      if (isPressed()) {
        setPressed(false);
      }
      btn.blur();
    };

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events may not support capture
      }
      if (!isPressed()) {
        setPressed(true);
      }
    });

    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    window.addEventListener('pointerup', release);
    this.cleanupFns.push(() => window.removeEventListener('pointerup', release));

    btn.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
      }
    });
  }

  private releaseStaleHolds(activeType: MinigameState['type']): void {
    const nextLinearKind =
      activeType === 'auxTensioner' || activeType === 'ot' || activeType === 'eccentric'
        ? activeType
        : 'none';
    if (this.activeLinearKind !== nextLinearKind && this.linearPressed) {
      this.linearPressed = false;
      this.linearHoldBtnEl.classList.remove('is-pressed');
      if (this.activeLinearKind === 'auxTensioner') {
        this.callbacks.onAuxPressChange(false);
      } else if (this.activeLinearKind === 'ot') {
        this.callbacks.onOtPressChange(false);
      } else if (this.activeLinearKind === 'eccentric') {
        this.callbacks.onEccentricPressChange(false);
      }
    }
    this.activeLinearKind = nextLinearKind;

    if (activeType !== 'torque' && this.torquePressed) {
      this.torquePressed = false;
      this.torqueHoldBtnEl.classList.remove('is-pressed');
      this.callbacks.onTorquePressChange(false);
    }
  }

  private renderTopBar(
    snapshot: GameSnapshot,
    stepIndex: number,
    stepSubs: { id: string }[],
    totalSteps: number
  ): void {
    if (document.activeElement !== this.stepSelectEl && this.stepSelectEl.value !== String(stepIndex)) {
      this.stepSelectEl.value = String(stepIndex);
    }

    const doneSet = new Set(snapshot.completedSubObjectives);
    const doneInStep = stepSubs.filter((s) => doneSet.has(s.id)).length;
    const stepFraction = stepSubs.length > 0 ? Math.min(1, doneInStep / stepSubs.length) : 0;
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

      if (step.specBadge) {
        this.torqueSpecBadgeEl.textContent = step.specBadge;
        this.torqueSpecBadgeEl.classList.remove('is-hidden');
      } else {
        this.torqueSpecBadgeEl.classList.add('is-hidden');
      }

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
          `subobjective-item${isDone ? ' is-done' : isCurrent ? ' is-current' : ''}`
        );
        const check = createEl('span', 'subobjective-check', isDone ? '✓' : '');
        const label = createEl('span', undefined, sub.label);
        li.append(check, label);
        fragment.append(li);
      }
      this.subObjectiveListEl.replaceChildren(fragment);
    }

    // Fuel system bleed card (Step 14 `reassemble_aux_fuel_bleed`)
    const showFuelBleedCard = step.id === 'reassemble_aux_fuel_bleed' && !snapshot.completed;
    this.fuelBleedCardEl.classList.toggle('is-hidden', !showFuelBleedCard);
    if (showFuelBleedCard) {
      this.fuelBleedBtnEl.classList.toggle('is-done', snapshot.fuelSystemBled);
      this.fuelBleedBtnEl.disabled = snapshot.fuelBleedInProgress || snapshot.fuelSystemBled;
      this.fuelBleedBtnEl.textContent = snapshot.fuelSystemBled
        ? '✓ Kraftstoffsystem befüllt & entlüftet'
        : snapshot.fuelBleedInProgress
          ? 'Vorförderpumpe läuft — entlüfte Niederdrucksystem…'
          : 'Kraftstoffsystem entlüften (Diagnose starten)';
    }

    // Separate oil-pump wet belt info card when Oil Sump cutaway camera (`Z`) is active
    this.oilCutawayCardEl.classList.toggle('is-hidden', !snapshot.oilSumpCutawayActive);

    // On mobile viewports, automatically collapse the tall step card while inspecting Oil Sump [Z]
    // so the isolated oil-pump wet belt diorama stays completely clear and directly tappable!
    if (snapshot.oilSumpCutawayActive !== this.lastOilCutawayActive) {
      this.lastOilCutawayActive = snapshot.oilSumpCutawayActive;
      if (window.innerWidth <= 900) {
        if (snapshot.oilSumpCutawayActive) {
          this.panelCollapsedBeforeOil = this.panelCollapsed;
          this.panelCollapsed = true;
        } else {
          this.panelCollapsed = this.panelCollapsedBeforeOil;
        }
      }
    }

    // Engine start/stop card (Step 16 final_test_run or freeInspectMode)
    const showEngineCard = step.id === 'final_test_run' || snapshot.freeInspectMode;
    this.engineControlCardEl.classList.toggle('is-hidden', !showEngineCard);
    if (showEngineCard) {
      this.engineRpmPillEl.classList.toggle('is-running', snapshot.engineRunning);
      const rpm = Math.round(snapshot.engineRpm);
      this.engineRpmTextEl.textContent = snapshot.engineRunning
        ? `ca. ${rpm} U/min (Spielwert)`
        : `${rpm} U/min Aus`;
      this.engineToggleBtnEl.classList.toggle('is-running', snapshot.engineRunning);
      this.engineToggleBtnEl.textContent = snapshot.engineRunning
        ? '1.6 TDI Motor abstellen'
        : '1.6 TDI Motor starten';
    }

    // Timing Belt Diagram Accordion (unlocks at Step 6 lower_cover_inspect)
    const diagramActuallyUnlocked = snapshot.diagramUnlocked || stepIndex >= 6;
    const canToggleDiagram = diagramActuallyUnlocked || snapshot.mode === 'guide';
    this.diagramTriggerEl.disabled = !canToggleDiagram;

    if (!canToggleDiagram && this.diagramExpanded) {
      this.diagramExpanded = false;
    }

    this.diagramTriggerTitleEl.textContent = diagramActuallyUnlocked
      ? 'Zahnriemen-Schema (VW-Folge 1–5)'
      : 'Zahnriemen-Schema (ab Schritt 6)';

    const highlightedNode = this.resolveDiagramHighlight(snapshot, stepIndex);
    const diagramKey = `${diagramActuallyUnlocked}|${snapshot.mode}|${highlightedNode ?? 'none'}|${snapshot.beltRoutingProgress.join(',')}|${snapshot.lockedShafts.join(',')}`;
    if (diagramKey !== this.lastDiagramKey) {
      this.lastDiagramKey = diagramKey;
      this.diagramLockedBoxEl.classList.toggle('is-hidden', diagramActuallyUnlocked);
      this.diagramSvgWrapEl.classList.toggle('is-hidden', !diagramActuallyUnlocked);

      if (diagramActuallyUnlocked) {
        this.diagramSvgWrapEl.innerHTML = renderBeltDiagramSVG(
          highlightedNode,
          snapshot.beltRoutingProgress,
          snapshot.lockedShafts
        );
      }
    }

    this.syncAccordions();
    this.syncCollapseState();
  }

  private resolveDiagramHighlight(snapshot: GameSnapshot, stepIndex: number): TimingWheelId | null {
    const step = REPAIR_STEPS[stepIndex];
    if (step.id === 'install_new_belt') {
      const done = new Set(snapshot.beltRoutingProgress);
      for (const st of VW_LAY_ORDER) {
        if (!done.has(st)) return st;
      }
      return null;
    }

    if (snapshot.mode === 'guide') {
      if (step.id === 'find_ot') return 'crank';
      if (step.id === 'set_tension_and_pretorque') return 'tensioner';
      if (step.id === 'lock_and_loosen_hubs') {
        const locked = new Set(snapshot.lockedShafts);
        for (const lid of ['cam', 'crank', 'pump'] as const) {
          if (!locked.has(lid)) return lid;
        }
      }
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

    this.specsAccordionEl.classList.toggle('is-open', this.specsExpanded);
    this.specsContentEl.classList.toggle('is-hidden', !this.specsExpanded);
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
      this.linearViewEl.classList.add('is-hidden');
      this.torqueViewEl.classList.add('is-hidden');
      return;
    }

    this.minigameWrapEl.classList.remove('is-hidden');

    if (minigame.type === 'auxTensioner') {
      this.linearViewEl.classList.remove('is-hidden');
      this.torqueViewEl.classList.add('is-hidden');

      this.linearEyebrowEl.textContent = 'Nebenantrieb • Keilrippenriemen-Federarm (Ringschlüssel, Beispiel SW 16)';
      this.linearTitleEl.textContent =
        minigame.mode === 'pin'
          ? `Federarm schwenken für ${CLHA_SPECIAL_TOOLS.auxLockPin}`
          : `Federarm halten & ${CLHA_SPECIAL_TOOLS.auxLockPin} entlasten`;
      this.linearSubtitleEl.textContent =
        minigame.mode === 'pin'
          ? 'Nur Nebenantrieb (nicht Zahnriemen-Exzenter!): Federarm gegen die Federkraft schwenken, bis die Absteckbohrung fluchtet.'
          : 'Federarm mit dem Ringschlüssel abfangen, damit der Stift T10060 A spannungsfrei gezogen werden kann.';

      const maxDeg = 38;
      const pct = Math.max(0, Math.min(100, (minigame.swingDeg / maxDeg) * 100));
      this.linearValueEl.textContent = `${Math.round(minigame.swingDeg)}°`;
      this.linearStatusEl.textContent = minigame.aligned ? 'BOHRUNG FREI!' : 'Schwenken (↺)';
      this.linearStatusEl.classList.toggle('is-aligned', minigame.aligned);

      const zoneLeftPct = (minigame.targetMinDeg / maxDeg) * 100;
      const zoneWidthPct = ((minigame.targetMaxDeg - minigame.targetMinDeg) / maxDeg) * 100;
      this.linearZoneEl.style.left = `${zoneLeftPct}%`;
      this.linearZoneEl.style.width = `${zoneWidthPct}%`;

      this.linearFillEl.style.width = `${pct.toFixed(2)}%`;
      this.linearFillEl.classList.toggle('is-aligned', minigame.aligned);

      this.linearScaleLeftEl.textContent = '0° (gespannt)';
      this.linearScaleMidEl.textContent = `Absteckbohrung ${CLHA_SPECIAL_TOOLS.auxLockPin}`;
      this.linearScaleRightEl.textContent = `${maxDeg}°`;
      this.linearHoldBtnEl.textContent = 'Ringschlüssel drücken — bei BOHRUNG FREI loslassen / [Leertaste]';
      this.linearResetBtnEl.classList.add('is-hidden');
      return;
    }

    if (minigame.type === 'ot') {
      this.linearViewEl.classList.remove('is-hidden');
      this.torqueViewEl.classList.add('is-hidden');

      this.linearEyebrowEl.textContent = 'Kurbelwellen-Knarre • Erste OT-Anfahrt (nur im Uhrzeigersinn!)';
      this.linearTitleEl.textContent = 'Kurbelwelle bis zur OT-Markierung drehen';
      this.linearSubtitleEl.textContent =
        'Von der aktuellen Stellung im Uhrzeigersinn bis zur OT-Deckung drehen (Gabel am NW-Mitnehmer über Bohrung, KW-Flansch & HDP-Gabel).';

      const minDeg = 620;
      const maxDeg = 760;
      const clampedDeg = Math.max(minDeg, Math.min(maxDeg, minigame.crankDeg));
      const relDeg = clampedDeg - minigame.targetDeg;

      this.linearValueEl.textContent = minigame.aligned
        ? 'OT-Markierung erreicht'
        : relDeg < 0
          ? `noch ${Math.abs(relDeg).toFixed(0)}° bis OT`
          : `+${relDeg.toFixed(0)}° über OT`;
      this.linearStatusEl.textContent = minigame.aligned
        ? 'OT FLUCHTET!'
        : clampedDeg > minigame.targetDeg + minigame.toleranceDeg
          ? 'Über OT (↺)'
          : 'Drehen (↻)';
      this.linearStatusEl.classList.toggle('is-aligned', minigame.aligned);

      const zoneLeftPct = ((minigame.targetDeg - minigame.toleranceDeg - minDeg) / (maxDeg - minDeg)) * 100;
      const zoneWidthPct = ((minigame.toleranceDeg * 2) / (maxDeg - minDeg)) * 100;
      this.linearZoneEl.style.left = `${Math.max(0, Math.min(100, zoneLeftPct))}%`;
      this.linearZoneEl.style.width = `${Math.max(2, Math.min(100 - zoneLeftPct, zoneWidthPct))}%`;

      const fillPct = ((clampedDeg - minDeg) / (maxDeg - minDeg)) * 100;
      this.linearFillEl.style.width = `${Math.max(0, Math.min(100, fillPct)).toFixed(2)}%`;
      this.linearFillEl.classList.toggle('is-aligned', minigame.aligned);

      this.linearScaleLeftEl.textContent = 'Vor OT';
      this.linearScaleMidEl.textContent = `OT-Markierung (Spielhilfe ±${minigame.toleranceDeg}°)`;
      this.linearScaleRightEl.textContent = 'Über OT';
      this.linearHoldBtnEl.textContent = 'KW-Knarre drehen — an OT-Markierung loslassen / [Leertaste]';
      this.linearResetBtnEl.textContent = '↺ Zurück';
      this.linearResetBtnEl.classList.remove('is-hidden');
      return;
    }

    if (minigame.type === 'eccentric') {
      this.linearViewEl.classList.remove('is-hidden');
      this.torqueViewEl.classList.add('is-hidden');

      this.linearEyebrowEl.textContent = `Spannrolle Typ B (${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB}) • Einstellung bei kaltem Motor`;
      this.linearTitleEl.textContent =
        minigame.mode === 'release'
          ? `Exzenter entlasten für ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB}`
          : 'Spannzeiger mittig in Grundplatten-Spalt stellen';
      this.linearSubtitleEl.textContent =
        minigame.mode === 'release'
          ? `Exzenter gegen den Uhrzeigersinn mit ${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} drehen, bis Absteckstift ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} eingesetzt werden kann.`
          : `Motor kalt: Exzenter mit ${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} im Uhrzeigersinn drehen, bis der Zeiger mittig zwischen den Laschen steht.`;

      if (minigame.mode === 'release') {
        this.linearValueEl.textContent = minigame.aligned ? 'Entlastet' : 'Gespannt';
        this.linearStatusEl.textContent = minigame.aligned ? 'ENTLASTET!' : 'Entspannen (↺)';
      } else {
        this.linearValueEl.textContent = minigame.aligned
          ? 'Spaltmitte'
          : minigame.tension < minigame.targetMin
            ? 'Links (−)'
            : 'Rechts (+)';
        this.linearStatusEl.textContent = minigame.aligned
          ? 'AN MARKIERUNG!'
          : minigame.tension > minigame.targetMax
            ? 'Zu stramm (↺)'
            : 'Spannen (↻)';
      }
      this.linearStatusEl.classList.toggle('is-aligned', minigame.aligned);

      const zoneLeftPct = Math.max(0, Math.min(100, minigame.targetMin * 100));
      const zoneWidthPct = Math.max(2, Math.min(100 - zoneLeftPct, (minigame.targetMax - minigame.targetMin) * 100));
      this.linearZoneEl.style.left = `${zoneLeftPct}%`;
      this.linearZoneEl.style.width = `${zoneWidthPct}%`;

      this.linearFillEl.style.width = `${Math.max(0, Math.min(100, minigame.tension * 100)).toFixed(2)}%`;
      this.linearFillEl.classList.toggle('is-aligned', minigame.aligned);

      this.linearScaleLeftEl.textContent = 'Entlastet';
      this.linearScaleMidEl.textContent =
        minigame.mode === 'release'
          ? `Bohrung ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} frei`
          : 'Zeiger mittig im Spalt (Spielhilfe)';
      this.linearScaleRightEl.textContent = 'Stramm';
      this.linearHoldBtnEl.textContent =
        minigame.mode === 'release'
          ? 'Exzenter entlasten / [Leertaste]'
          : 'Exzenter drehen — an Markierung loslassen / [Leertaste]';
      this.linearResetBtnEl.textContent = '↺ Entlasten';
      this.linearResetBtnEl.classList.toggle('is-hidden', minigame.mode === 'release');
      return;
    }

    // Torque (Nm) & Angle (°) Radial Gauge Minigame
    this.linearViewEl.classList.add('is-hidden');
    this.torqueViewEl.classList.remove('is-hidden');

    const stageKey = `${minigame.stageId}|${minigame.stageKind}|${minigame.stageIndex}|${minigame.targetValue}|${minigame.unit}`;
    const stageChanged = stageKey !== this.lastTorqueStageKey;
    const resetAfterRun = this.lastTorqueValue > 0 && minigame.currentValue === 0;
    this.lastTorqueStageKey = stageKey;
    this.lastTorqueValue = minigame.currentValue;
    if ((stageChanged || resetAfterRun) && this.torquePressed) {
      this.torquePressed = false;
      this.torqueHoldBtnEl.classList.remove('is-pressed');
    }

    if (minigame.stageKind === 'angle') {
      this.torqueEyebrowEl.textContent = `Stufe ${minigame.stageIndex}/${minigame.stageTotal} • Drehwinkel (${minigame.unit})`;
    } else if (minigame.stageTotal > 1) {
      this.torqueEyebrowEl.textContent = `Stufe ${minigame.stageIndex}/${minigame.stageTotal} • Voranzug (${minigame.unit})`;
    } else {
      this.torqueEyebrowEl.textContent = `Montagewert • Drehmoment (${minigame.unit})`;
    }

    this.torqueTitleEl.textContent = minigame.label;
    this.torqueBoltEl.textContent = minigame.boltLabel;

    const showStages = minigame.stageTotal > 1;
    this.torqueStagePillsEl.classList.toggle('is-hidden', !showStages);
    if (showStages) {
      const stage1Done = minigame.stageIndex > 1;
      const p1 = minigame.stage1PillLabel ?? 'Stufe 1';
      const p2 = minigame.stage2PillLabel ?? 'Stufe 2';
      this.torqueStage1PillEl.textContent = stage1Done ? `✓ ${p1}` : p1;
      this.torqueStage1PillEl.classList.toggle('is-done', stage1Done);
      this.torqueStage1PillEl.classList.toggle('is-active', minigame.stageIndex === 1);

      this.torqueStage2PillEl.textContent = p2;
      this.torqueStage2PillEl.classList.toggle('is-done', false);
      this.torqueStage2PillEl.classList.toggle('is-active', minigame.stageIndex === 2);
    }

    const isRetry = minigame.attemptStatus === 'retry' && Boolean(minigame.lastAttemptFeedback);
    this.torqueRetryBannerEl.classList.toggle('is-hidden', !isRetry);
    this.torqueRetryBannerEl.classList.toggle('is-retrying', isRetry && minigame.currentValue > 0);
    if (isRetry && minigame.lastAttemptFeedback) {
      this.torqueRetryBannerEl.textContent =
        minigame.currentValue > 0
          ? `↻ ${minigame.lastAttemptFeedback}`
          : `⚠ ${minigame.lastAttemptFeedback}`;
    }

    const specKey = `${minigame.targetValue}|${minigame.inputWindow}|${minigame.maxValue}|${minigame.unit}|${minigame.scaleTicks.join(',')}`;
    if (specKey !== this.lastMinigameSpecKey) {
      this.lastMinigameSpecKey = specKey;
      this.rebuildTorqueGaugeBands(
        minigame.targetValue,
        minigame.inputWindow,
        minigame.maxValue,
        minigame.scaleTicks,
        minigame.unit
      );
    }

    const safeMax = Math.max(1, minigame.maxValue);
    const ratio = Math.max(0, Math.min(1, minigame.currentValue / safeMax));
    const needleAngle = TORQUE_ARC_START_DEG + ratio * TORQUE_ARC_SWEEP_DEG;

    this.torqueNeedleGroupEl.setAttribute(
      'transform',
      `rotate(${needleAngle.toFixed(2)} ${TORQUE_ARC_CENTER_X} ${TORQUE_ARC_CENTER_Y})`
    );

    const dashOffset = TORQUE_ARC_CIRCUMFERENCE * (1 - ratio);
    this.torqueActiveArcEl.style.strokeDashoffset = dashOffset.toFixed(2);

    const minTarget = minigame.targetValue - minigame.inputWindow;
    const maxTarget = minigame.targetValue + minigame.inputWindow;
    const inZone = minigame.currentValue >= minTarget && minigame.currentValue <= maxTarget;
    const overZone = minigame.currentValue > maxTarget;
    const approaching =
      !inZone && !overZone && minigame.currentValue >= minTarget - minigame.inputWindow * 2.2;

    this.torqueValueEl.textContent = formatMeasure(
      minigame.currentValue,
      minigame.unit,
      minigame.decimals
    );
    this.torqueValueEl.classList.toggle('is-in-zone', inZone);
    this.torqueValueEl.classList.toggle('is-approaching', approaching);
    this.torqueValueEl.classList.toggle('is-over', overZone);

    this.torqueActiveArcEl.setAttribute(
      'stroke',
      inZone ? '#10b981' : overZone ? '#ef4444' : approaching ? '#f59e0b' : '#38bdf8'
    );

    const targetDisplay = formatMeasure(minigame.targetValue, minigame.unit, 0);
    const winDecimals = Number.isInteger(minigame.inputWindow) ? 0 : 1;
    const windowDisplay = formatMeasure(minigame.inputWindow, minigame.unit, winDecimals);

    this.torqueTargetSubEl.textContent =
      minigame.stageId === 'wheel'
        ? `Soll: je ${targetDisplay}`
        : `Soll: ${targetDisplay}`;
    this.torquePlayAidEl.textContent = `Spielhilfe ±${windowDisplay}`;

    this.torqueHoldBtnEl.textContent =
      minigame.stageKind === 'angle'
        ? `Weiterdrehen bis ${targetDisplay} / [Leertaste]`
        : `Anziehen bis ${targetDisplay} / [Leertaste]`;
  }

  private rebuildTorqueGaugeBands(
    targetValue: number,
    inputWindow: number,
    maxValue: number,
    scaleTicks: number[],
    unit: FasteningUnit
  ): void {
    const safeMax = Math.max(1, maxValue);
    const valToAngle = (val: number): number =>
      TORQUE_ARC_START_DEG + Math.max(0, Math.min(1, val / safeMax)) * TORQUE_ARC_SWEEP_DEG;

    const bandStart = valToAngle(targetValue - inputWindow);
    const bandEnd = valToAngle(targetValue + inputWindow);
    this.torqueBandPathEl.setAttribute(
      'd',
      describeSvgArc(
        TORQUE_ARC_CENTER_X,
        TORQUE_ARC_CENTER_Y,
        TORQUE_ARC_RADIUS,
        bandStart,
        bandEnd
      )
    );

    const fragment = document.createDocumentFragment();
    for (const tickVal of scaleTicks) {
      const ang = valToAngle(tickVal);
      const isTargetTick = Math.abs(tickVal - targetValue) < 0.001;
      const outer = polarToCartesian(TORQUE_ARC_CENTER_X, TORQUE_ARC_CENTER_Y, TORQUE_ARC_RADIUS + 11, ang);
      const inner = polarToCartesian(TORQUE_ARC_CENTER_X, TORQUE_ARC_CENTER_Y, TORQUE_ARC_RADIUS - 10, ang);
      const tick = createSvgEl('line');
      tick.setAttribute('x1', inner.x.toFixed(1));
      tick.setAttribute('y1', inner.y.toFixed(1));
      tick.setAttribute('x2', outer.x.toFixed(1));
      tick.setAttribute('y2', outer.y.toFixed(1));
      tick.setAttribute('stroke', isTargetTick ? '#34d399' : 'rgba(148, 163, 184, 0.48)');
      tick.setAttribute('stroke-width', isTargetTick ? '2.4' : '1.8');
      fragment.append(tick);

      const labelPos = polarToCartesian(
        TORQUE_ARC_CENTER_X,
        TORQUE_ARC_CENTER_Y,
        TORQUE_ARC_RADIUS + 23,
        ang
      );
      const label = createSvgEl('text');
      label.setAttribute('x', labelPos.x.toFixed(1));
      label.setAttribute('y', labelPos.y.toFixed(1));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('fill', isTargetTick ? '#6ee7b7' : '#94a3b8');
      label.setAttribute('font-size', isTargetTick ? '10' : '9.2');
      label.setAttribute('font-weight', '700');
      label.textContent =
        tickVal === 0 || tickVal === maxValue || isTargetTick
          ? formatMeasure(tickVal, unit, 0)
          : String(tickVal);
      fragment.append(label);
    }

    const targetAng = valToAngle(targetValue);
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
    const margin = 16;
    const width = this.tooltipEl.offsetWidth || 240;
    const height = this.tooltipEl.offsetHeight || 74;
    let x = this.tooltipX + margin;
    let y = this.tooltipY + margin;

    if (x + width > window.innerWidth - 12) {
      x = Math.max(12, this.tooltipX - width - margin);
    }
    if (y + height > window.innerHeight - 12) {
      y = Math.max(12, this.tooltipY - height - margin);
    }
    this.tooltipEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  private renderToast(snapshot: GameSnapshot): void {
    const toast = snapshot.toast;
    if (!toast) {
      if (this.lastToastId !== -1) {
        this.lastToastId = -1;
        this.toastWrapEl.classList.add('is-hidden');
      }
      return;
    }

    if (toast.id !== this.lastToastId) {
      this.lastToastId = toast.id;
      this.toastEl.className = `hud-toast hud-toast--${toast.kind}`;
      this.toastEl.textContent = toast.text;
      this.toastWrapEl.classList.remove('is-hidden');
    }
  }

  private renderCompletionModal(snapshot: GameSnapshot): void {
    const show = snapshot.completed && !snapshot.freeInspectMode;
    this.certWrapEl.classList.toggle('is-hidden', !show);
    if (!show) return;

    const certKey = `${snapshot.xp}|${snapshot.elapsedSeconds}|${snapshot.mistakes}|${snapshot.mode}|${snapshot.torqueScores.length}`;
    if (certKey === this.lastCertKey) return;
    this.lastCertKey = certKey;

    const evalRes = evaluateGrade(snapshot);
    this.certGradeLetterEl.textContent = evalRes.grade;
    this.certGradeCaptionEl.textContent = evalRes.caption;
    this.certGradeBadgeEl.className = `cert-grade-badge${
      evalRes.grade === 'A'
        ? ' is-grade-a'
        : evalRes.grade === 'B'
          ? ' is-grade-b'
          : evalRes.grade === 'C'
            ? ' is-grade-c'
            : ''
    }`;

    this.certXpEl.textContent = `${snapshot.xp} XP`;
    this.certTimeEl.textContent = formatTimer(snapshot.elapsedSeconds);
    this.certMistakesEl.textContent = String(snapshot.mistakes);
    this.certModeEl.textContent = snapshot.mode === 'guide' ? 'Guide' : 'Profi';

    const frag = document.createDocumentFragment();
    if (snapshot.torqueScores.length === 0) {
      frag.append(
        createEl(
          'div',
          'cert-torque-row',
          'Keine Anzugswerte erfasst (Direktsprung genutzt).'
        )
      );
    } else {
      for (const entry of snapshot.torqueScores) {
        const row = createEl('div', 'cert-torque-row');
        row.append(createEl('span', 'cert-torque-name', entry.label));

        const vals = createEl('div', 'cert-torque-vals tabular');
        const achieved = formatMeasure(entry.achievedValue, entry.unit, entry.decimals);
        const delta = formatSignedDelta(entry.deltaValue, entry.unit, entry.decimals);
        vals.append(
          createEl('span', undefined, `${achieved} (${entry.targetLabel}, ${delta})`),
          createEl(
            'span',
            `cert-rating-pill cert-rating-pill--${entry.rating.toLowerCase()}`,
            entry.rating
          )
        );
        row.append(vals);
        frag.append(row);
      }
    }
    this.certTorqueListEl.replaceChildren(frag);
  }
}
