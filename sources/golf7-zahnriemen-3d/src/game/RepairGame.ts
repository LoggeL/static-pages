import * as THREE from 'three';
import { SoundEngine } from '../audio/SoundEngine';
import { isAtOT, wheels } from '../drive';
import { CameraController } from '../engine/CameraController';
import { SceneManager } from '../engine/SceneManager';
import { EA288TimingEngine } from '../models/EA288TimingEngine';
import { Golf7Model } from '../models/Golf7Model';
import { ToolModels } from '../models/ToolModels';
import { WorkshopEnvironment } from '../models/WorkshopEnvironment';
import { CAMERA_PRESETS, REPAIR_STEPS, TOOL_DEFINITIONS } from '../steps/stepDefinitions';
import type {
  CameraPresetId,
  GameMode,
  GameSnapshot,
  HUDCallbacks,
  InteractableId,
  InteractableMeta,
  LockableWheelId,
  MinigameState,
  TimingWheelId,
  ToastMessage,
  ToolId,
  TorqueScore,
} from '../types';
import { GameHUD } from '../ui/GameHUD';

const LIFT_RAISED_HEIGHT = 0.88;
const STAR_BOLT_ORDER = [0, 2, 4, 1, 3];
const ROUTE_ORDER: TimingWheelId[] = [
  'crank',
  'lower',
  'tensioner',
  'cam',
  'upper',
  'pump',
  'water',
];

interface StoredMaterialHighlight {
  emissiveHex: number;
  emissiveIntensity: number;
}

interface PendingTorqueContext {
  kind: 'tensioner' | 'wheel';
  worldPos: THREE.Vector3;
}

export class RepairGame {
  private readonly sceneManager: SceneManager;
  private readonly cameraController: CameraController;
  private readonly workshop: WorkshopEnvironment;
  private readonly golf7: Golf7Model;
  private readonly engine: EA288TimingEngine;
  private readonly toolModels: ToolModels;
  private readonly sound: SoundEngine;
  private readonly hud: GameHUD;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private pointerScreenX = 0;
  private pointerScreenY = 0;
  private pointerDownPos = { x: 0, y: 0 };
  private pointerMovedDist = 0;

  // 3D Guide Beacon
  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRing: THREE.Mesh;
  private readonly beaconDiamond: THREE.Mesh;
  private beaconClock = 0;

  // Per-material hover highlight store
  private readonly hoverOriginalMats = new Map<THREE.MeshStandardMaterial, StoredMaterialHighlight>();
  private currentHoverRootId: InteractableId | null = null;

  // Core Game State
  private started = false;
  private mode: GameMode = 'guide';
  private stepIndex = 0;
  private completedSubObjectives = new Set<string>();
  private activeTool: ToolId = 'hand';
  private activeCamera: CameraPresetId = 'overview';
  private xp = 0;
  private elapsedSeconds = 0;
  private mistakes = 0;
  private torqueScores: TorqueScore[] = [];
  private xrayEnabled = false;
  private workLampEnabled = false;
  private muted = false;
  private completed = false;
  private freeInspectMode = false;

  // Physical World State
  private liftRaised = false;
  private currentLiftY = 0;
  private hoodOpen = false;
  private engineCoverRemoved = false;
  private lugBoltsRemoved = [false, false, false, false, false];
  private wheelRemoved = false;
  private linerScrewsRemoved = [false, false, false, false, false, false];
  private linerRemoved = false;

  // Timing-belt specific mechanical state
  private timingCoverBoltsRemoved = [false, false];
  private timingCoverRemoved = false;
  private timingCoverSeatedInReassembly = false;
  private timingCoverReinstalled = false;
  private diagramUnlocked = false;
  private crankAngleDeg = 635;
  private lockedShafts = new Set<LockableWheelId>();
  private tensionNormalized = 0.50;
  private oldTensionerReleased = false;
  private oldBeltRemoved = false;
  private waterPumpChecked = false;
  private idlersChecked = { lower: false, upper: false };
  private beltRoutingProgress: TimingWheelId[] = [];
  private newBeltInstalled = false;
  private tensionPointerAligned = false;
  private tensionerTorqued = false;
  private manualCranked = false;
  private otPointerVerified = false;
  private engineRunning = false;
  private engineRpm = 0;
  private engineRunTimer = 0;

  // Reassembly state
  private linerSeatedInReassembly = false;
  private linerReinstalled = false;
  private wheelReinstalled = false;
  private wheelBoltsTorqued = [false, false, false, false, false];
  private coverHoodReinstalled = false;

  // Minigame State
  private minigame: MinigameState = { type: 'none' };
  private otPressing = false;
  private eccentricPressing = false;
  private torquePressing = false;
  private pendingTorque: PendingTorqueContext | null = null;

  // Toast & Loop State
  private hoveredPart: InteractableMeta | null = null;
  private toast: ToastMessage | null = null;
  private toastCounter = 0;
  private toastClearTimeout: number | null = null;
  private readonly pendingTimeouts: number[] = [];

  private rafId = 0;
  private lastTimestamp = 0;
  private lastSecondBroadcast = -1;
  private lastHudSyncTime = 0;
  private hudDirty = true;

  // Event handler refs
  private readonly handleResizeBound: () => void;
  private readonly handlePointerMoveBound: (e: PointerEvent) => void;
  private readonly handleWindowPointerMoveBound: (e: PointerEvent) => void;
  private readonly handlePointerLeaveBound: () => void;
  private readonly handlePointerDownBound: (e: PointerEvent) => void;
  private readonly handlePointerUpBound: (e: PointerEvent) => void;
  private readonly handleKeyDownBound: (e: KeyboardEvent) => void;
  private readonly handleKeyUpBound: (e: KeyboardEvent) => void;
  private readonly handleHashChangeBound: () => void;

  constructor(container: HTMLElement) {
    this.sceneManager = new SceneManager(container);
    this.cameraController = new CameraController(
      this.sceneManager.camera,
      this.sceneManager.renderer.domElement
    );
    this.workshop = new WorkshopEnvironment(this.sceneManager.scene);
    this.golf7 = new Golf7Model();
    this.engine = new EA288TimingEngine();
    this.toolModels = new ToolModels();
    this.sound = new SoundEngine();

    this.sceneManager.carLiftGroup.add(this.golf7.group);
    this.sceneManager.carLiftGroup.add(this.engine.group);
    this.sceneManager.scene.add(this.toolModels.group);

    // Build 3D pulsing cyan guide beacon
    const ringGeo = new THREE.RingGeometry(0.030, 0.042, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.beaconRing = new THREE.Mesh(ringGeo, ringMat);
    this.beaconRing.renderOrder = 998;
    this.beaconRing.raycast = () => {};

    const diamondGeo = new THREE.OctahedronGeometry(0.015, 0);
    const diamondMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    this.beaconDiamond = new THREE.Mesh(diamondGeo, diamondMat);
    this.beaconDiamond.position.y = 0.058;
    this.beaconDiamond.renderOrder = 999;
    this.beaconDiamond.raycast = () => {};

    this.beaconGroup.add(this.beaconRing, this.beaconDiamond);
    this.beaconGroup.visible = false;
    this.sceneManager.scene.add(this.beaconGroup);

    const callbacks: HUDCallbacks = {
      onStartGame: (mode) => this.startGame(mode),
      onSelectTool: (tool) => this.selectTool(tool),
      onSelectCamera: (preset) => this.selectCamera(preset),
      onToggleXRay: () => this.toggleXRay(),
      onToggleLamp: () => this.toggleLamp(),
      onToggleMute: () => this.toggleMute(),
      onJumpToStep: (idx) => this.jumpToStep(idx),
      onStartEngineToggle: () => this.toggleEngine(),
      onOtPressChange: (pressing) => this.setOtPressing(pressing),
      onOtReset: () => this.resetOtMinigame(),
      onEccentricPressChange: (pressing) => this.setEccentricPressing(pressing),
      onEccentricReset: () => this.resetEccentricMinigame(),
      onTorquePressChange: (pressing) => this.setTorquePressing(pressing),
      onResetGame: () => this.resetGame(),
      onFreeInspect: () => this.enterFreeInspect(),
    };

    this.hud = new GameHUD(container, callbacks);

    // Respect external deep-link `#fahrzeug` -> jump cleanly to workshop overview with the blue Golf VII,
    // while normal URL without `#fahrzeug` ALWAYS opens the VW Digital Cockpit Title Screen!
    if (window.location.hash === '#fahrzeug') {
      this.enterVehicleOverviewFromHash(true);
    } else {
      this.cameraController.setTitleOrbit(true);
      this.syncAllModels(true);
    }

    const canvas = this.sceneManager.renderer.domElement;
    this.handleResizeBound = () => this.onResize();
    this.handlePointerMoveBound = (e) => this.onPointerMove(e);
    this.handleWindowPointerMoveBound = (e) => {
      if (e.target !== canvas && this.hoveredPart) {
        this.clearHoveredState();
      }
    };
    this.handlePointerLeaveBound = () => this.clearHoveredState();
    this.handlePointerDownBound = (e) => this.onPointerDown(e);
    this.handlePointerUpBound = (e) => this.onPointerUp(e);
    this.handleKeyDownBound = (e) => this.onKeyDown(e);
    this.handleKeyUpBound = (e) => this.onKeyUp(e);
    this.handleHashChangeBound = () => {
      if (window.location.hash === '#fahrzeug') {
        this.enterVehicleOverviewFromHash(false);
      }
    };

    window.addEventListener('resize', this.handleResizeBound);
    canvas.addEventListener('pointermove', this.handlePointerMoveBound);
    canvas.addEventListener('pointerleave', this.handlePointerLeaveBound);
    window.addEventListener('pointermove', this.handleWindowPointerMoveBound);
    canvas.addEventListener('pointerdown', this.handlePointerDownBound);
    window.addEventListener('pointerup', this.handlePointerUpBound);
    window.addEventListener('keydown', this.handleKeyDownBound);
    window.addEventListener('keyup', this.handleKeyUpBound);
    window.addEventListener('hashchange', this.handleHashChangeBound);

    this.broadcastHud(true);
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame((ts) => this.loop(ts));

    void this.loadBlenderAssets();
  }

  private enterVehicleOverviewFromHash(immediateCamera: boolean): void {
    this.resetWorldToStep(0);
    this.started = true;
    this.mode = 'guide';
    this.completed = false;
    this.freeInspectMode = false;
    this.activeTool = 'hand';
    this.activeCamera = 'overview';
    this.cameraController.setPreset('overview', this.currentLiftY, immediateCamera);
    this.showToast('Werkstattübersicht Golf VII 1.6 TDI — klicke Haube oder Hebebühne zum Starten!', 'info');
    this.broadcastHud(true);
  }

  private async loadBlenderAssets(): Promise<void> {
    this.hud.setLoading(true, 'Lade hochauflösende 3D-Werkstattmodelle…');
    try {
      await Promise.all([
        this.golf7.loadBlenderModel(),
        this.engine.loadBlenderModel(),
        this.workshop.loadBlenderModel(),
        this.toolModels.loadBlenderModel(),
      ]);
      this.clearHoverHighlight();
      this.syncAllModels(true);
    } catch (err) {
      console.error('[RepairGame] Blender GLB loading failed, continuing with fallback:', err);
    } finally {
      this.hud.setLoading(false);
      this.broadcastHud(true);
    }
  }

  // =========================================================================
  // Public / HUD Callbacks
  // =========================================================================

  public startGame(mode: GameMode): void {
    this.sound.playClick();
    this.resetWorldToStep(0);
    this.started = true;
    this.mode = mode;
    this.xp = 0;
    this.elapsedSeconds = 0;
    this.mistakes = 0;
    this.torqueScores = [];
    this.completed = false;
    this.freeInspectMode = false;

    const firstStep = REPAIR_STEPS[0];
    this.activeTool = firstStep.requiredTools[0] ?? 'hand';
    this.selectCamera(firstStep.cameraPreset);
    this.showToast(
      mode === 'guide'
        ? 'Werkstatt-Guide gestartet — folge den blauen Markierungen!'
        : 'Meister-Prüfung gestartet — keine Markierungen, volle Präzision!',
      'info'
    );
    this.broadcastHud(true);
  }

  public resetGame(): void {
    this.sound.playClick();
    this.clearPendingTimers();
    this.stopEngineImmediate();
    if (window.location.hash === '#fahrzeug') {
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(window.history.state, '', cleanUrl);
    }
    this.started = false;
    this.completed = false;
    this.freeInspectMode = false;
    this.xrayEnabled = false;
    this.golf7.setXRay(false);
    this.workLampEnabled = false;
    this.sceneManager.setWorkLamp(false);
    this.resetWorldToStep(0);
    this.cameraController.setTitleOrbit(true);
    this.showToast('Werkstatt zurückgesetzt.', 'info');
    this.broadcastHud(true);
  }

  public enterFreeInspect(): void {
    this.sound.playClick();
    this.freeInspectMode = true;
    this.timingCoverRemoved = true;
    this.timingCoverBoltsRemoved = [true, true];
    this.linerRemoved = true;
    this.wheelRemoved = true;
    this.liftRaised = true;
    this.currentLiftY = LIFT_RAISED_HEIGHT;
    this.syncAllModels(true);
    this.selectCamera('timingClose');
    this.showToast('Freier Inspektionsmodus aktiv — Steuertrieb, Motor & Kamera frei steuerbar!', 'info');
    this.broadcastHud(true);
  }

  public selectTool(tool: ToolId): void {
    if (this.activeTool !== tool) {
      this.sound.playClick();
      this.activeTool = tool;
      this.hudDirty = true;
    }
  }

  public selectCamera(preset: CameraPresetId): void {
    this.activeCamera = preset;
    this.cameraController.setPreset(preset, this.currentLiftY);
    this.hudDirty = true;
  }

  public toggleXRay(): void {
    this.sound.playClick();
    this.xrayEnabled = !this.xrayEnabled;
    this.golf7.setXRay(this.xrayEnabled);
    this.showToast(
      this.xrayEnabled ? 'Röntgen-Ansicht (X-Ray) aktiviert' : 'Röntgen-Ansicht deaktiviert',
      'info'
    );
    this.hudDirty = true;
  }

  public toggleLamp(): void {
    this.sound.playClick();
    this.workLampEnabled = !this.workLampEnabled;
    this.sceneManager.setWorkLamp(this.workLampEnabled);
    this.showToast(
      this.workLampEnabled ? 'LED-Arbeitslampe eingeschaltet' : 'LED-Arbeitslampe ausgeschaltet',
      'info'
    );
    this.hudDirty = true;
  }

  public toggleMute(): void {
    this.muted = !this.muted;
    this.sound.setMuted(this.muted);
    this.hudDirty = true;
  }

  public jumpToStep(index: number): void {
    const clamped = Math.max(0, Math.min(REPAIR_STEPS.length - 1, index));
    this.sound.playClick();
    this.clearPendingTimers();
    this.stopEngineImmediate();
    if (!this.started) {
      this.started = true;
    }
    this.completed = false;
    this.freeInspectMode = false;

    this.resetWorldToStep(clamped);
    this.clearHoveredState();
    const step = REPAIR_STEPS[clamped];
    this.activeTool = step.requiredTools[0] ?? 'hand';
    this.selectCamera(step.cameraPreset);
    this.showToast(`Zu Schritt ${clamped + 1} gesprungen: ${step.title}`, 'info');
    this.broadcastHud(true);
  }

  public toggleEngine(): void {
    if (this.engineRunning) {
      this.stopEngineImmediate();
      this.showToast('1.6 TDI Motor abgestellt.', 'info');
      this.broadcastHud(true);
      return;
    }

    if (this.lockedShafts.size > 0) {
      this.sound.playError();
      this.showToast('Achtung! Zuerst alle Arretierdorne aus dem Steuertrieb entfernen!', 'error');
      return;
    }

    if (!this.freeInspectMode && this.stepIndex === 11) {
      if (!this.manualCranked) {
        this.sound.playError();
        this.showToast('Erst Kurbelwelle 2× (720°) von Hand mit der KW-Knarre [4] durchdrehen!', 'warning');
        return;
      }
      if (!this.otPointerVerified) {
        this.sound.playError();
        this.showToast('Erst OT-Marken & Spannzeiger mit der Hand [1] bestätigen!', 'warning');
        return;
      }
    }

    if (this.oldBeltRemoved && !this.newBeltInstalled) {
      this.sound.playError();
      this.showToast('Kein Zahnriemen montiert!', 'error');
      return;
    }

    this.engineRunning = true;
    this.engineRpm = 820;
    this.engineRunTimer = 0;
    this.engine.setEngineRunning(true, 820);
    this.sound.startDieselEngine();
    this.showToast('1.6 TDI (EA288) gestartet — 820 U/min Leerlauf. Zahnriemenlauf beobachten!', 'success');
    this.broadcastHud(true);
  }

  public setOtPressing(pressing: boolean): void {
    if (this.minigame.type !== 'ot') {
      this.otPressing = false;
      return;
    }
    this.otPressing = pressing;
    if (!pressing) {
      if (this.minigame.aligned) {
        this.crankAngleDeg = 720;
        this.engine.setCrankAngle(720);
        this.toolModels.setActiveCrankWrench(false);
        this.minigame = { type: 'none' };
        this.sound.playSuccess();
        this.showToast(
          'OT (720°) exakt erreicht! Alle drei Bezugsmarken fluchten unter ihren Zeigern.',
          'success'
        );
        this.completeSubObjective('align_ot', 80);
        this.broadcastHud(true);
      } else if (this.crankAngleDeg > this.minigame.targetDeg + this.minigame.toleranceDeg) {
        this.sound.playError();
        this.showToast('Über OT hinausgedreht! Nutze „↺ Zurück“ und führe die Kurbelwelle im Uhrzeigersinn exakt auf 720°.', 'warning');
      } else {
        this.showToast('Noch vor OT — Taste weiter gedrückt halten bis OT FLUCHTET erscheint.', 'info');
      }
    }
  }

  public resetOtMinigame(): void {
    if (this.minigame.type !== 'ot') return;
    this.otPressing = false;
    this.crankAngleDeg = 635;
    this.engine.setCrankAngle(this.crankAngleDeg);
    this.minigame = {
      ...this.minigame,
      crankDeg: this.crankAngleDeg,
      aligned: false,
    };
    this.updateLiveTools();
    this.sound.playClick();
    this.broadcastHud(true);
  }

  public setEccentricPressing(pressing: boolean): void {
    if (this.minigame.type !== 'eccentric') {
      this.eccentricPressing = false;
      return;
    }
    this.eccentricPressing = pressing;
    if (!pressing && this.minigame.mode === 'set') {
      if (this.minigame.aligned) {
        this.tensionNormalized = 0.50;
        this.tensionPointerAligned = true;
        this.engine.setTension(0.50);
        this.engine.setBeltState('new_tensioned');
        this.toolModels.setActiveEccentricKey(false);
        this.minigame = { type: 'none' };
        this.sound.playSuccess();
        this.showToast(
          'Spannzeiger steht exakt mittig im Referenzfenster! Jetzt Befestigung mit Drehmomentschlüssel [7] sichern.',
          'success'
        );
        this.completeSubObjective('align_tension_pointer', 80);
        if (this.mode === 'guide') {
          this.activeTool = 'torqueWrench';
        }
        this.broadcastHud(true);
      } else if (this.tensionNormalized > this.minigame.targetMax) {
        this.sound.playError();
        this.showToast('Riemen zu stramm! Klicke „↺ Entlasten“ und führe den Zeiger von links exakt ins Referenzfenster.', 'warning');
      } else {
        this.showToast('Noch zu locker — Taste gedrückt halten bis IM FENSTER! erscheint.', 'info');
      }
    }
  }

  public resetEccentricMinigame(): void {
    if (this.minigame.type !== 'eccentric') return;
    this.eccentricPressing = false;
    this.tensionNormalized = 0.12;
    this.engine.setTension(this.tensionNormalized);
    this.minigame = {
      ...this.minigame,
      tension: this.tensionNormalized,
      aligned: false,
    };
    this.updateLiveTools();
    this.sound.playClick();
    this.broadcastHud(true);
  }

  public setTorquePressing(pressing: boolean): void {
    if (this.minigame.type !== 'torque' || !this.minigame.active) {
      this.torquePressing = false;
      return;
    }
    if (pressing) {
      this.torquePressing = true;
      return;
    }
    if (!this.torquePressing) return;
    this.torquePressing = false;
    this.finalizeTorqueAttempt();
  }

  public getSnapshot(): GameSnapshot {
    return {
      started: this.started,
      mode: this.mode,
      stepIndex: this.stepIndex,
      completedSubObjectives: Array.from(this.completedSubObjectives),
      activeTool: this.activeTool,
      recommendedTool: this.computeRecommendedTool(),
      activeCamera: this.activeCamera,
      xp: Math.round(this.xp),
      elapsedSeconds: Math.floor(this.elapsedSeconds),
      mistakes: this.mistakes,
      torqueScores: [...this.torqueScores],
      xrayEnabled: this.xrayEnabled,
      workLampEnabled: this.workLampEnabled,
      muted: this.muted,
      engineRunning: this.engineRunning,
      engineRpm: this.engineRpm,
      liftRaised: this.liftRaised,
      diagramUnlocked: this.diagramUnlocked,
      crankAngleDeg: this.crankAngleDeg,
      otAligned: isAtOT(this.crankAngleDeg, 4),
      tensionNormalized: this.tensionNormalized,
      lockedShafts: Array.from(this.lockedShafts),
      beltRoutingProgress: [...this.beltRoutingProgress],
      minigame: this.minigame,
      hoveredPart: this.hoveredPart,
      toast: this.toast,
      completed: this.completed,
      freeInspectMode: this.freeInspectMode,
    };
  }

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.clearPendingTimers();
    this.stopEngineImmediate();

    const canvas = this.sceneManager.renderer.domElement;
    window.removeEventListener('resize', this.handleResizeBound);
    canvas.removeEventListener('pointermove', this.handlePointerMoveBound);
    canvas.removeEventListener('pointerleave', this.handlePointerLeaveBound);
    window.removeEventListener('pointermove', this.handleWindowPointerMoveBound);
    canvas.removeEventListener('pointerdown', this.handlePointerDownBound);
    window.removeEventListener('pointerup', this.handlePointerUpBound);
    window.removeEventListener('keydown', this.handleKeyDownBound);
    window.removeEventListener('keyup', this.handleKeyUpBound);
    window.removeEventListener('hashchange', this.handleHashChangeBound);

    this.clearHoverHighlight();
    this.hud.destroy();
    this.workshop.dispose();
    this.engine.dispose();
    this.cameraController.dispose();
    this.sceneManager.dispose();
  }

  // =========================================================================
  // Step & World Synchronization (13-Step Timing Belt State Machine)
  // =========================================================================

  private resetWorldToStep(targetStep: number): void {
    this.stepIndex = targetStep;
    this.completedSubObjectives.clear();
    this.minigame = { type: 'none' };
    this.otPressing = false;
    this.eccentricPressing = false;
    this.torquePressing = false;
    this.pendingTorque = null;

    this.liftRaised = targetStep >= 1;
    this.currentLiftY = this.liftRaised ? LIFT_RAISED_HEIGHT : 0;
    this.hoodOpen = targetStep >= 1;
    this.engineCoverRemoved = targetStep >= 2;

    const wheelGone = targetStep >= 3;
    this.lugBoltsRemoved = [wheelGone, wheelGone, wheelGone, wheelGone, wheelGone];
    this.wheelRemoved = wheelGone;

    const linerGone = targetStep >= 4;
    this.linerScrewsRemoved = [linerGone, linerGone, linerGone, linerGone, linerGone, linerGone];
    this.linerRemoved = linerGone;

    const timingCoverGone = targetStep >= 5;
    this.timingCoverBoltsRemoved = [timingCoverGone, timingCoverGone];
    this.timingCoverRemoved = timingCoverGone;
    this.timingCoverSeatedInReassembly = false;
    this.timingCoverReinstalled = false;

    this.linerSeatedInReassembly = false;
    this.linerReinstalled = false;
    this.wheelReinstalled = false;
    this.wheelBoltsTorqued = [false, false, false, false, false];
    this.coverHoodReinstalled = false;

    this.diagramUnlocked = targetStep >= 5;
    this.lockedShafts.clear();

    if (targetStep <= 5) {
      // Steps 0..5 (up to find_ot)
      this.crankAngleDeg = 635;
      this.tensionNormalized = 0.50;
      this.oldTensionerReleased = false;
      this.oldBeltRemoved = false;
      this.waterPumpChecked = false;
      this.idlersChecked = { lower: false, upper: false };
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.tensionPointerAligned = false;
      this.tensionerTorqued = false;
      this.manualCranked = false;
      this.otPointerVerified = false;
    } else if (targetStep === 6) {
      // lock_shafts: at OT (720), ready to insert all 3 pins
      this.crankAngleDeg = 720;
      this.tensionNormalized = 0.50;
      this.oldTensionerReleased = false;
      this.oldBeltRemoved = false;
      this.waterPumpChecked = false;
      this.idlersChecked = { lower: false, upper: false };
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.tensionPointerAligned = false;
      this.tensionerTorqued = false;
      this.manualCranked = false;
      this.otPointerVerified = false;
    } else if (targetStep === 7) {
      // remove_old_belt: at OT, all 3 shafts locked
      this.crankAngleDeg = 720;
      this.lockedShafts = new Set(['crank', 'cam', 'pump']);
      this.tensionNormalized = 0.50;
      this.oldTensionerReleased = false;
      this.oldBeltRemoved = false;
      this.waterPumpChecked = false;
      this.idlersChecked = { lower: false, upper: false };
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.tensionPointerAligned = false;
      this.tensionerTorqued = false;
      this.manualCranked = false;
      this.otPointerVerified = false;
    } else if (targetStep === 8) {
      // install_new_belt: at OT, all 3 locked, belt off, tensioner slack
      this.crankAngleDeg = 720;
      this.lockedShafts = new Set(['crank', 'cam', 'pump']);
      this.tensionNormalized = 0.12;
      this.oldTensionerReleased = true;
      this.oldBeltRemoved = true;
      this.waterPumpChecked = true;
      this.idlersChecked = { lower: true, upper: true };
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.tensionPointerAligned = false;
      this.tensionerTorqued = false;
      this.manualCranked = false;
      this.otPointerVerified = false;
    } else if (targetStep === 9) {
      // set_tension: new belt laid slack, all 3 locked, eccentric at 0.12
      this.crankAngleDeg = 720;
      this.lockedShafts = new Set(['crank', 'cam', 'pump']);
      this.tensionNormalized = 0.12;
      this.oldTensionerReleased = true;
      this.oldBeltRemoved = true;
      this.waterPumpChecked = true;
      this.idlersChecked = { lower: true, upper: true };
      this.beltRoutingProgress = [...ROUTE_ORDER];
      this.newBeltInstalled = true;
      this.tensionPointerAligned = false;
      this.tensionerTorqued = false;
      this.manualCranked = false;
      this.otPointerVerified = false;
    } else if (targetStep === 10) {
      // remove_locks: new belt tensioned (0.50), torqued, 3 pins still inserted
      this.crankAngleDeg = 720;
      this.lockedShafts = new Set(['crank', 'cam', 'pump']);
      this.tensionNormalized = 0.50;
      this.oldTensionerReleased = true;
      this.oldBeltRemoved = true;
      this.waterPumpChecked = true;
      this.idlersChecked = { lower: true, upper: true };
      this.beltRoutingProgress = [...ROUTE_ORDER];
      this.newBeltInstalled = true;
      this.tensionPointerAligned = true;
      this.tensionerTorqued = true;
      this.manualCranked = false;
      this.otPointerVerified = false;
    } else {
      // Steps 11 (check_timing_run) & 12 (reassemble)
      this.crankAngleDeg = 720;
      this.lockedShafts.clear();
      this.tensionNormalized = 0.50;
      this.oldTensionerReleased = true;
      this.oldBeltRemoved = true;
      this.waterPumpChecked = true;
      this.idlersChecked = { lower: true, upper: true };
      this.beltRoutingProgress = [...ROUTE_ORDER];
      this.newBeltInstalled = true;
      this.tensionPointerAligned = true;
      this.tensionerTorqued = true;
      this.manualCranked = targetStep >= 12;
      this.otPointerVerified = targetStep >= 12;
    }

    this.syncAllModels(true);
  }

  private syncAllModels(instant: boolean): void {
    this.sceneManager.carLiftGroup.position.y = this.currentLiftY;
    this.workshop.setLiftHeight(this.currentLiftY);
    this.golf7.setStoredOffLiftY(this.currentLiftY);
    this.sceneManager.setWorkLampLiftOffset(this.currentLiftY);

    this.golf7.setHoodOpen(this.hoodOpen, instant);
    this.golf7.setEngineCoverRemoved(this.engineCoverRemoved, instant);
    for (let i = 0; i < 5; i++) {
      this.golf7.setLugBoltRemoved(i, this.lugBoltsRemoved[i], instant);
    }
    this.golf7.setWheelRemoved(this.wheelRemoved, instant);
    for (let i = 0; i < 6; i++) {
      this.golf7.setLinerScrewRemoved(i, this.linerScrewsRemoved[i], instant);
    }
    this.golf7.setLinerRemoved(this.linerRemoved, instant);
    this.golf7.setGhostSlotVisible(
      'wheelLinerSlot',
      this.stepIndex === 12 &&
        this.timingCoverReinstalled &&
        this.linerRemoved &&
        !this.linerSeatedInReassembly
    );

    // Sync EA288 Timing Engine
    for (let i = 0; i < 2; i++) {
      this.engine.setTimingCoverBoltRemoved(i, this.timingCoverBoltsRemoved[i], instant);
    }
    this.engine.setTimingCoverRemoved(this.timingCoverRemoved, instant);
    this.engine.setTimingCoverSlotVisible(
      this.stepIndex === 12 && this.timingCoverRemoved && !this.timingCoverSeatedInReassembly
    );
    this.engine.setCrankAngle(this.crankAngleDeg);
    this.engine.setTension(this.tensionNormalized);
    this.engine.setLockedShafts(Array.from(this.lockedShafts));

    if (!this.oldBeltRemoved) {
      this.engine.setBeltState('old');
    } else if (this.newBeltInstalled) {
      this.engine.setBeltState(this.tensionPointerAligned ? 'new_tensioned' : 'new_slack');
    } else if (this.stepIndex === 8) {
      this.engine.setBeltState('routing');
      this.engine.setRoutingProgress(this.beltRoutingProgress);
    } else {
      this.engine.setBeltState('none');
    }

    this.updateLiveTools();
  }

  private updateLiveTools(): void {
    if (this.minigame.type === 'ot') {
      const pos = this.engine.getWheelWorldPos('crank');
      const angleRad = -((this.crankAngleDeg - 635) * Math.PI) / 180;
      this.toolModels.setActiveCrankWrench(true, pos, angleRad);
      this.toolModels.setActiveEccentricKey(false);
    } else if (this.minigame.type === 'eccentric') {
      const pos = this.engine.getWheelWorldPos('tensioner');
      // Angle wrench handle down-right so the reference window & orange/emerald pointer stay 100% visible!
      const angleRad = Math.PI * 0.78 - (this.tensionNormalized - 0.5) * 1.4;
      this.toolModels.setActiveEccentricKey(true, pos, angleRad);
      this.toolModels.setActiveCrankWrench(false);
    } else {
      this.toolModels.setActiveCrankWrench(false);
      this.toolModels.setActiveEccentricKey(false);
    }
  }

  // =========================================================================
  // Raycasting & Hover Highlighting
  // =========================================================================

  private isEffectivelyVisible(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (!cur.visible || cur.userData?.ignoreRaycast) return false;
      cur = cur.parent;
    }
    return true;
  }

  private findInteractableId(obj: THREE.Object3D): InteractableId | null {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const id = cur.userData?.interactableId as InteractableId | undefined;
      if (id) return id;
      cur = cur.parent;
    }
    return null;
  }

  private pickInteractableAt(clientX: number, clientY: number): InteractableId | null {
    const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.camera);

    const roots = this.xrayEnabled
      ? [
          ...this.golf7.getInteractables(),
          ...this.engine.getInteractables(),
          ...this.workshop.getInteractables(),
        ]
      : [this.golf7.group, this.engine.group, ...this.workshop.getInteractables()];

    const hits = this.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!this.isEffectivelyVisible(hit.object)) continue;
      const id = this.findInteractableId(hit.object);
      if (id) {
        return id;
      }
      if (!this.xrayEnabled) {
        return null;
      }
    }
    return null;
  }

  private getPartMeta(id: InteractableId): InteractableMeta {
    switch (id) {
      case 'hood':
        return {
          id,
          label: 'Motorhaube (Golf VII)',
          status: this.hoodOpen ? 'Geöffnet' : 'Geschlossen',
          hint: this.hoodOpen ? 'Klicken zum Schließen' : 'Klicken zum Öffnen',
        };
      case 'liftControlUp':
        return {
          id,
          label: 'Hebebühne — AUF (Grün)',
          partNumber: 'Zweisäulen-Bühne',
          status: this.liftRaised ? 'Oben (0,88 m)' : 'Unten (0,00 m)',
        };
      case 'liftControlDown':
        return {
          id,
          label: 'Hebebühne — AB (Gelb)',
          partNumber: 'Zweisäulen-Bühne',
          status: this.liftRaised ? 'Oben (0,88 m)' : 'Unten (0,00 m)',
        };
      case 'engineCover':
        return {
          id,
          label: 'TDI-Motorabdeckung',
          partNumber: 'EA288 1.6 TDI',
          status: this.engineCoverRemoved ? 'Demontiert' : 'Aufgesteckt',
        };
      case 'lugBolt_0':
      case 'lugBolt_1':
      case 'lugBolt_2':
      case 'lugBolt_3':
      case 'lugBolt_4': {
        const idx = Number(id.split('_')[1]);
        return {
          id,
          label: `Radschraube #${idx + 1} (SW 17)`,
          status: this.lugBoltsRemoved[idx]
            ? 'Gelöst'
            : this.wheelBoltsTorqued[idx]
              ? 'Angezogen (RLF)'
              : 'Montiert',
        };
      }
      case 'frontRightWheel':
        return {
          id,
          label: 'Vorderrad rechts (17" VW Dijon)',
          status: this.wheelRemoved ? 'Auf Reifenständer' : 'Auf Radnabe',
        };
      case 'wheelHub':
        return {
          id,
          label: 'Radnabe & Bremsscheibe VR',
          hint: this.stepIndex === 12 && this.wheelRemoved ? 'Klicken um Vorderrad aufzusetzen' : undefined,
        };
      case 'linerScrew_0':
      case 'linerScrew_1':
      case 'linerScrew_2':
      case 'linerScrew_3':
      case 'linerScrew_4':
      case 'linerScrew_5': {
        const idx = Number(id.split('_')[1]);
        return {
          id,
          label: `Torx-Schraube T25 #${idx + 1}`,
          status: this.linerScrewsRemoved[idx] ? 'Entfernt' : 'Verschraubt',
        };
      }
      case 'wheelLiner':
        return {
          id,
          label: 'Radhausschale vorne rechts',
          status: this.linerRemoved ? 'Ausgebaut' : 'Montiert',
        };
      case 'wheelLinerSlot':
        return {
          id,
          label: 'Einbauposition Radhausschale',
          hint: 'Mit Hand [1] einsetzen, dann 6× Torx T25 [3] verschrauben',
        };
      case 'timingCoverBolt_0':
      case 'timingCoverBolt_1': {
        const idx = Number(id.split('_')[1]);
        return {
          id,
          label: `Zahnriemenabdeckung — Befestigung #${idx + 1}`,
          partNumber: 'Torx T25',
          status: this.timingCoverBoltsRemoved[idx] ? 'Gelöst' : 'Verschraubt',
        };
      }
      case 'timingCover':
        return {
          id,
          label: 'Zahnriemenabdeckung (EA288)',
          partNumber: 'Steuertrieb-Schutz',
          status: this.timingCoverRemoved ? 'Demontiert' : 'Montiert',
        };
      case 'timingCoverSlot':
        return {
          id,
          label: 'Einbauposition Zahnriemenabdeckung',
          hint: 'Mit Hand [1] ansetzen, dann mit Torx T25 [3] sichern',
        };
      case 'oldTimingBelt':
        return {
          id,
          label: 'Alter Zahnriemen (EA288)',
          partNumber: 'Steuerriemen',
          status: this.oldTensionerReleased ? 'Entspannt' : 'Unter Spannung',
        };
      case 'newTimingBeltSlot':
        return {
          id,
          label: 'Zahnriemen-Führungsspur (7 Stationen)',
          hint: 'Räder in Reihenfolge 1 → 7 mit dem neuen Zahnriemen [8] anklicken',
        };
      case 'wheel_crank':
        return {
          id,
          label: 'Kurbelwellenrad (KW)',
          partNumber: 'Station 1 • 2:1 Antrieb',
          status: this.lockedShafts.has('crank')
            ? 'Mit Absteckdorn arretiert'
            : isAtOT(this.crankAngleDeg, 4)
              ? 'OT-Marke fluchtet (720°)'
              : `Winkel ${Math.round(this.crankAngleDeg)}°`,
        };
      case 'wheel_lower':
        return {
          id,
          label: 'Untere Umlenkrolle',
          partNumber: 'Station 2 • Riemenrücken',
          status: this.idlersChecked.lower ? 'Lager geprüft' : 'Umlenkrolle Zugtrum',
        };
      case 'wheel_tensioner':
        return {
          id,
          label: 'Exzenter-Spannrolle & Referenzfenster',
          partNumber: 'Station 3 • Spannzeiger',
          status:
            Math.abs(this.tensionNormalized - 0.5) <= 0.04
              ? 'Zeiger mittig im Fenster'
              : this.tensionNormalized < 0.25
                ? 'Entlastet'
                : 'Nicht zentriert',
        };
      case 'tensionerNut':
        return {
          id,
          label: 'Spannrollen-Befestigung',
          partNumber: 'Sollbereich (RLF)',
          status: this.tensionerTorqued ? 'Angezogen (RLF)' : 'Offen / Einstellbar',
        };
      case 'wheel_cam':
        return {
          id,
          label: 'Nockenwellenrad (NW)',
          partNumber: 'Station 4 • 2:1 (360°)',
          status: this.lockedShafts.has('cam')
            ? 'Mit Absteckdorn arretiert'
            : isAtOT(this.crankAngleDeg, 4)
              ? 'OT-Marke fluchtet'
              : 'Dreht mit halber KW-Drehzahl',
        };
      case 'wheel_upper':
        return {
          id,
          label: 'Obere Umlenkrolle',
          partNumber: 'Station 5 • Riemenrücken',
          status: this.idlersChecked.upper ? 'Lager geprüft' : 'Umlenkrolle NW ↔ HDP',
        };
      case 'wheel_pump':
        return {
          id,
          label: 'Hochdruckpumpenrad (Common-Rail)',
          partNumber: 'Station 6 • Verzahnt',
          status: this.lockedShafts.has('pump')
            ? 'Mit Absteckdorn arretiert'
            : isAtOT(this.crankAngleDeg, 4)
              ? 'OT-Marke fluchtet'
              : 'Synchron zu Kurbelwelle',
        };
      case 'wheel_water':
        return {
          id,
          label: 'Kühlmittelpumpe (Wasserpumpe)',
          partNumber: 'Station 7 • Riemenrücken',
          status: this.waterPumpChecked ? 'Lager geprüft' : 'Antrieb über Riemenrücken',
        };
      case 'lockPin_crank':
        return {
          id,
          label: 'Absteckdorn Kurbelwelle',
          partNumber: 'OT-Arretierung',
          status: 'Gesteckt',
          hint: this.stepIndex === 10 ? 'Mit Absteckdorn-Satz [5] herausziehen' : undefined,
        };
      case 'lockPin_cam':
        return {
          id,
          label: 'Absteckdorn Nockenwelle',
          partNumber: 'OT-Arretierung',
          status: 'Gesteckt',
          hint: this.stepIndex === 10 ? 'Mit Absteckdorn-Satz [5] herausziehen' : undefined,
        };
      case 'lockPin_pump':
        return {
          id,
          label: 'Absteckdorn Hochdruckpumpe',
          partNumber: 'OT-Arretierung',
          status: 'Gesteckt',
          hint: this.stepIndex === 10 ? 'Mit Absteckdorn-Satz [5] herausziehen' : undefined,
        };
    }
  }

  private getInteractableWorldPos(id: InteractableId): THREE.Vector3 | null {
    if (id === 'liftControlUp' || id === 'liftControlDown') {
      return this.workshop.getPartWorldPos(id);
    }
    return this.golf7.getPartWorldPos(id) ?? this.engine.getPartWorldPos(id);
  }

  private applyHoverHighlight(id: InteractableId | null): void {
    if (id === this.currentHoverRootId) return;
    this.clearHoverHighlight();
    this.currentHoverRootId = id;
    if (!id) return;

    const roots = [
      ...this.golf7.getInteractables(),
      ...this.engine.getInteractables(),
      ...this.workshop.getInteractables(),
    ];

    for (const root of roots) {
      root.traverse((obj) => {
        if (obj.userData?.interactableId !== id) return;
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
          if (mat.colorWrite === false || mat.opacity === 0) continue;

          if (!this.hoverOriginalMats.has(mat)) {
            this.hoverOriginalMats.set(mat, {
              emissiveHex: mat.emissive.getHex(),
              emissiveIntensity: mat.emissiveIntensity,
            });
          }
          const orig = this.hoverOriginalMats.get(mat)!;
          mat.emissive.setHex(0x0284c7);
          mat.emissiveIntensity = Math.min(0.36, orig.emissiveIntensity + 0.16);
        }
      });
    }
  }

  private clearHoveredState(): void {
    this.clearHoverHighlight();
    if (this.hoveredPart !== null) {
      this.hoveredPart = null;
      this.hudDirty = true;
    }
    this.sceneManager.renderer.domElement.style.cursor = 'grab';
  }

  private refreshHoverAtLastPointer(): void {
    if (this.pointerScreenX <= 0 && this.pointerScreenY <= 0) {
      this.clearHoveredState();
      return;
    }
    const picked = this.pickInteractableAt(this.pointerScreenX, this.pointerScreenY);
    const meta = picked ? this.getPartMeta(picked) : null;
    this.applyHoverHighlight(picked);
    this.hoveredPart = meta;
    this.sceneManager.renderer.domElement.style.cursor = picked ? 'pointer' : 'grab';
    this.hudDirty = true;
  }

  private clearHoverHighlight(): void {
    for (const [mat, orig] of this.hoverOriginalMats) {
      mat.emissive.setHex(orig.emissiveHex);
      mat.emissiveIntensity = orig.emissiveIntensity;
    }
    this.hoverOriginalMats.clear();
    this.currentHoverRootId = null;
  }

  // =========================================================================
  // Pointer & Keyboard Handlers
  // =========================================================================

  private onPointerMove(e: PointerEvent): void {
    this.pointerScreenX = e.clientX;
    this.pointerScreenY = e.clientY;
    this.hud.setTooltipScreenPos(e.clientX, e.clientY);

    if (e.buttons > 0) {
      this.pointerMovedDist += Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y
      );
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    }

    const picked = this.pickInteractableAt(e.clientX, e.clientY);
    const meta = picked ? this.getPartMeta(picked) : null;
    const prevId = this.hoveredPart?.id ?? null;

    this.applyHoverHighlight(picked);
    this.sceneManager.renderer.domElement.style.cursor = picked ? 'pointer' : 'grab';

    if ((meta?.id ?? null) !== prevId || (meta && meta.status !== this.hoveredPart?.status)) {
      this.hoveredPart = meta;
      this.hudDirty = true;
    } else {
      this.hoveredPart = meta;
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.pointerMovedDist = 0;
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.started) return;
    if (this.pointerMovedDist > 7) return;
    if (e.target !== this.sceneManager.renderer.domElement) return;

    const picked = this.pickInteractableAt(e.clientX, e.clientY);
    if (picked) {
      this.handlePartClick(picked);
      this.refreshHoverAtLastPointer();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (e.code === 'Space' && this.minigame.type !== 'none') {
      e.preventDefault();
      if (!e.repeat) {
        if (this.minigame.type === 'ot') {
          this.setOtPressing(true);
        } else if (this.minigame.type === 'eccentric') {
          this.setEccentricPressing(true);
        } else if (this.minigame.type === 'torque') {
          this.setTorquePressing(true);
        }
      }
      return;
    }

    if (e.repeat) return;

    const toolIdx = Number(e.key);
    if (toolIdx >= 1 && toolIdx <= TOOL_DEFINITIONS.length) {
      this.selectTool(TOOL_DEFINITIONS[toolIdx - 1].id);
      return;
    }

    const upper = e.key.toUpperCase();
    const camMatch = CAMERA_PRESETS.find((c) => c.hotkey === upper);
    if (camMatch) {
      this.selectCamera(camMatch.id);
      return;
    }

    if (upper === 'X') {
      this.toggleXRay();
    } else if (upper === 'L') {
      this.toggleLamp();
    } else if (upper === 'M') {
      this.toggleMute();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      if (this.minigame.type === 'ot') {
        this.setOtPressing(false);
      } else if (this.minigame.type === 'eccentric') {
        this.setEccentricPressing(false);
      } else if (this.minigame.type === 'torque') {
        this.setTorquePressing(false);
      }
    }
  }

  // =========================================================================
  // 13-Step Interactive State Machine
  // =========================================================================

  private requireTool(expected: ToolId): boolean {
    if (this.activeTool === expected) return true;
    const def = TOOL_DEFINITIONS.find((t) => t.id === expected);
    this.mistakes += 1;
    this.sound.playError();
    if (this.mode === 'guide' && def) {
      this.showToast(`Falsches Werkzeug! Benötigt wird: ${def.shortName} [${def.hotkey}]`, 'warning');
    } else {
      this.showToast('Falsches Werkzeug für diesen Arbeitsschritt!', 'error');
    }
    this.hudDirty = true;
    return false;
  }

  private completeSubObjective(subId: string, xpReward = 40): void {
    if (this.completedSubObjectives.has(subId)) return;
    this.completedSubObjectives.add(subId);
    this.xp += xpReward;

    const step = REPAIR_STEPS[this.stepIndex];
    const allDone = step.subObjectives.every((s) => this.completedSubObjectives.has(s.id));
    if (allDone) {
      this.advanceStep();
    } else {
      this.hudDirty = true;
    }
  }

  private advanceStep(): void {
    this.sound.playStepComplete();
    this.xp += 80;

    if (this.stepIndex >= REPAIR_STEPS.length - 1) {
      this.completed = true;
      this.beaconGroup.visible = false;
      this.showToast('Zahnriemenwechsel erfolgreich abgeschlossen! Meister-Zertifikat erstellt.', 'success');
      this.broadcastHud(true);
      return;
    }

    const nextIdx = this.stepIndex + 1;
    this.stepIndex = nextIdx;
    const nextStep = REPAIR_STEPS[nextIdx];

    if (this.mode === 'guide') {
      this.activeTool = nextStep.requiredTools[0] ?? 'hand';
    }
    this.selectCamera(nextStep.cameraPreset);
    this.syncAllModels(false);
    this.clearHoveredState();
    this.showToast(`Schritt ${nextIdx + 1}: ${nextStep.title}`, 'success');
    this.broadcastHud(true);
  }

  private handlePartClick(id: InteractableId): void {
    if (this.minigame.type !== 'none') return;

    // Free inspection convenience interactions after completion
    if (this.freeInspectMode || this.completed) {
      if (id === 'hood') {
        this.hoodOpen = !this.hoodOpen;
        this.golf7.setHoodOpen(this.hoodOpen);
        this.sound.playClick();
      } else if (id === 'liftControlUp' || id === 'liftControlDown') {
        this.liftRaised = id === 'liftControlUp';
        this.sound.playLiftMotor(2.0);
      } else if (id === 'wheel_crank' && !this.engineRunning) {
        this.engine.triggerManualCrank720();
        this.sound.playRatchet();
      }
      this.hudDirty = true;
      return;
    }

    switch (this.stepIndex) {
      case 0:
        this.handleStep0PrepLift(id);
        break;
      case 1:
        this.handleStep1EngineCover(id);
        break;
      case 2:
        this.handleStep2RemoveWheel(id);
        break;
      case 3:
        this.handleStep3RemoveLiner(id);
        break;
      case 4:
        this.handleStep4OpenTimingCover(id);
        break;
      case 5:
        this.handleStep5FindOt(id);
        break;
      case 6:
        this.handleStep6LockShafts(id);
        break;
      case 7:
        this.handleStep7RemoveOldBelt(id);
        break;
      case 8:
        this.handleStep8InstallNewBelt(id);
        break;
      case 9:
        this.handleStep9SetTension(id);
        break;
      case 10:
        this.handleStep10RemoveLocks(id);
        break;
      case 11:
        this.handleStep11CheckTimingAndRun(id);
        break;
      case 12:
        this.handleStep12Reassemble(id);
        break;
    }
  }

  private handleStep0PrepLift(id: InteractableId): void {
    if (id === 'hood' && !this.hoodOpen) {
      if (!this.requireTool('hand')) return;
      this.hoodOpen = true;
      this.golf7.setHoodOpen(true);
      this.sound.playSuccess();
      this.showToast('Motorhaube geöffnet!', 'success');
      this.completeSubObjective('open_hood', 40);
      return;
    }

    if (id === 'liftControlUp' && !this.liftRaised) {
      if (!this.requireTool('hand')) return;
      this.liftRaised = true;
      this.sound.playLiftMotor(2.1);
      this.showToast('Zweisäulen-Hebebühne fährt auf Arbeitshöhe…', 'success');
      this.completeSubObjective('raise_lift', 40);
      return;
    }

    this.wrongTargetFeedback('Öffne die Motorhaube und drücke den grünen Aufwärts-Taster an der Hebebühne.');
  }

  private handleStep1EngineCover(id: InteractableId): void {
    if (id === 'engineCover' && !this.engineCoverRemoved) {
      if (!this.requireTool('hand')) return;
      this.engineCoverRemoved = true;
      this.golf7.setEngineCoverRemoved(true);
      this.sound.playSuccess();
      this.showToast('TDI-Motorabdeckung sauber nach oben abgezogen!', 'success');
      this.completeSubObjective('remove_cover', 50);
      return;
    }
    this.wrongTargetFeedback('Klicke die TDI-Motorabdeckung im Motorraum mit der Hand [1] an.');
  }

  private handleStep2RemoveWheel(id: InteractableId): void {
    if (id.startsWith('lugBolt_')) {
      const idx = Number(id.split('_')[1]);
      if (this.lugBoltsRemoved[idx]) return;
      if (!this.requireTool('impact17')) return;

      this.lugBoltsRemoved[idx] = true;
      this.golf7.setLugBoltRemoved(idx, true);
      const pos = this.getInteractableWorldPos(id);
      if (pos) {
        this.toolModels.playToolAction('impact17', pos, 0.55);
      }
      this.sound.playImpactWrench();
      this.completeSubObjective(`unbolt_lug_${idx}`, 25);
      if (this.mode === 'guide' && this.lugBoltsRemoved.every(Boolean)) {
        this.activeTool = 'hand';
      }
      return;
    }

    if (id === 'frontRightWheel' && !this.wheelRemoved) {
      if (!this.lugBoltsRemoved.every(Boolean)) {
        this.sound.playError();
        this.showToast('Erst alle 5 Radschrauben mit dem Schlagschrauber SW 17 [2] lösen!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.wheelRemoved = true;
      this.golf7.setWheelRemoved(true);
      this.sound.playSuccess();
      this.showToast('Vorderrad rechts abgenommen und auf dem Reifenständer abgelegt.', 'success');
      this.completeSubObjective('take_off_wheel', 50);
      return;
    }

    this.wrongTargetFeedback('Löse alle 5 Radschrauben [2] und nimm danach das Vorderrad ab [1].');
  }

  private handleStep3RemoveLiner(id: InteractableId): void {
    if (id.startsWith('linerScrew_')) {
      const idx = Number(id.split('_')[1]);
      if (this.linerScrewsRemoved[idx]) return;
      if (!this.requireTool('torx25')) return;

      this.linerScrewsRemoved[idx] = true;
      this.golf7.setLinerScrewRemoved(idx, true);
      const pos = this.getInteractableWorldPos(id);
      if (pos) {
        this.toolModels.playToolAction('torx25', pos, 0.48);
      }
      this.sound.playScrewdriver();
      this.completeSubObjective(`unscrew_liner_${idx}`, 20);
      if (this.mode === 'guide' && this.linerScrewsRemoved.every(Boolean)) {
        this.activeTool = 'hand';
      }
      return;
    }

    if (id === 'wheelLiner' && !this.linerRemoved) {
      if (!this.linerScrewsRemoved.every(Boolean)) {
        this.sound.playError();
        this.showToast('Erst alle 6 Torx-T25-Schrauben [3] aus der Radhausschale drehen!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.linerRemoved = true;
      this.golf7.setLinerRemoved(true);
      this.sound.playSuccess();
      this.showToast('Radhausschale entfernt — die Zahnriemenabdeckung liegt frei!', 'success');
      this.completeSubObjective('take_off_liner', 55);
      return;
    }

    this.wrongTargetFeedback('Schraube die 6 Torx-T25-Schrauben [3] heraus und entnimm die Radhausschale [1].');
  }

  private handleStep4OpenTimingCover(id: InteractableId): void {
    if (id === 'timingCoverBolt_0' || id === 'timingCoverBolt_1') {
      const idx = Number(id.split('_')[1]);
      if (this.timingCoverBoltsRemoved[idx]) return;
      if (!this.requireTool('torx25')) return;

      this.timingCoverBoltsRemoved[idx] = true;
      this.engine.setTimingCoverBoltRemoved(idx, true);
      const pos = this.getInteractableWorldPos(id);
      if (pos) {
        this.toolModels.playToolAction('torx25', pos, 0.48);
      }
      this.sound.playScrewdriver();
      this.completeSubObjective(`unbolt_timing_cover_${idx}`, 30);
      if (this.mode === 'guide' && this.timingCoverBoltsRemoved.every(Boolean)) {
        this.activeTool = 'hand';
      }
      return;
    }

    if (id === 'timingCover' && !this.timingCoverRemoved) {
      if (!this.timingCoverBoltsRemoved.every(Boolean)) {
        this.sound.playError();
        this.showToast('Erst beide Befestigungen der Zahnriemenabdeckung mit Torx T25 [3] lösen!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.timingCoverRemoved = true;
      this.engine.setTimingCoverRemoved(true);
      this.sound.playSuccess();
      this.showToast('Zahnriemenabdeckung abgenommen — prüfe jetzt den alten Zahnriemen mit der Hand [1]!', 'success');
      this.completeSubObjective('remove_timing_cover', 50);
      return;
    }

    if (
      this.timingCoverRemoved &&
      (id === 'oldTimingBelt' || id.startsWith('wheel_'))
    ) {
      if (!this.requireTool('hand')) return;
      this.diagramUnlocked = true;
      this.sound.playSuccess();
      this.showToast('EA288-Steuertrieb dokumentiert & 7-Stationen-Schema freigeschaltet!', 'success');
      this.completeSubObjective('inspect_timing_belt', 55);
      return;
    }

    this.wrongTargetFeedback(
      !this.timingCoverBoltsRemoved.every(Boolean)
        ? 'Löse beide Befestigungen der Zahnriemenabdeckung mit Torx T25 [3].'
        : !this.timingCoverRemoved
          ? 'Nimm die gelöste Zahnriemenabdeckung mit der Hand [1] ab.'
          : 'Klicke den alten Zahnriemen mit der Hand [1] an, um Verlauf und Zustand zu prüfen.'
    );
  }

  private handleStep5FindOt(id: InteractableId): void {
    if (id === 'wheel_crank') {
      if (!this.requireTool('crankWrench')) return;
      this.sound.playClick();
      this.minigame = {
        type: 'ot',
        crankDeg: this.crankAngleDeg,
        targetDeg: 720,
        toleranceDeg: 4,
        aligned: isAtOT(this.crankAngleDeg, 4),
      };
      this.updateLiveTools();
      this.showToast('KW-Knarre angesetzt — Taste/[Leertaste] halten bis OT FLUCHTET (720°)!', 'info');
      this.broadcastHud(true);
      return;
    }

    this.wrongTargetFeedback('Setze die KW-Knarre [4] am Kurbelwellenrad (unten) an, um den Motor auf OT zu drehen.');
  }

  private handleStep6LockShafts(id: InteractableId): void {
    const mapWheel: Partial<Record<InteractableId, LockableWheelId>> = {
      wheel_crank: 'crank',
      wheel_cam: 'cam',
      wheel_pump: 'pump',
    };
    const shaft = mapWheel[id];
    if (!shaft) {
      this.wrongTargetFeedback('Arretiere Kurbelwelle, Nockenwelle und Hochdruckpumpe mit dem Absteckdorn-Satz [5].');
      return;
    }
    if (this.lockedShafts.has(shaft)) return;
    if (!this.requireTool('lockingPins')) return;

    this.lockedShafts.add(shaft);
    this.engine.setLockedShafts(Array.from(this.lockedShafts));
    const pos = this.engine.getWheelWorldPos(shaft);
    this.toolModels.playToolAction('lockingPins', pos, 0.52);
    this.sound.playPinLock();

    const names: Record<LockableWheelId, string> = {
      crank: 'Kurbelwelle',
      cam: 'Nockenwelle',
      pump: 'Hochdruckpumpe',
    };
    this.showToast(`${names[shaft]} sicher in OT-Stellung abgesteckt!`, 'success');
    this.completeSubObjective(`lock_${shaft}`, 50);
  }

  private handleStep7RemoveOldBelt(id: InteractableId): void {
    if ((id === 'wheel_tensioner' || id === 'tensionerNut') && !this.oldTensionerReleased) {
      if (!this.requireTool('eccentricKey')) return;
      this.sound.playClick();
      this.minigame = {
        type: 'eccentric',
        tension: this.tensionNormalized,
        targetMin: 0.0,
        targetMax: 0.16,
        aligned: this.tensionNormalized <= 0.16,
        mode: 'release',
      };
      this.updateLiveTools();
      this.showToast('Exzenter-Schlüssel angesetzt — Taste/[Leertaste] halten zum Entlasten!', 'info');
      this.broadcastHud(true);
      return;
    }

    if (id === 'oldTimingBelt' && !this.oldBeltRemoved) {
      if (!this.oldTensionerReleased) {
        this.sound.playError();
        this.showToast('Entlaste zuerst die Exzenter-Spannrolle mit dem Exzenter-Schlüssel [6]!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.oldBeltRemoved = true;
      this.engine.setBeltState('none');
      this.sound.playBeltSnap();
      this.showToast('Alten Zahnriemen abgenommen! Prüfe jetzt Kühlmittelpumpe & Umlenkrollen von Hand [1].', 'success');
      this.completeSubObjective('take_old_timing_belt', 55);
      return;
    }

    if (id === 'wheel_water' && !this.waterPumpChecked) {
      if (!this.oldBeltRemoved) {
        this.sound.playError();
        this.showToast('Nimm zuerst den alten Zahnriemen von den Rädern ab!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.waterPumpChecked = true;
      this.engine.triggerRollerSpinCheck('water');
      this.sound.playBearingSpin();
      this.showToast('Kühlmittelpumpe geprüft — läuft sauber, dicht und ohne Lagerspiel!', 'success');
      this.completeSubObjective('check_water_pump', 40);
      return;
    }

    if ((id === 'wheel_lower' || id === 'wheel_upper') && !this.completedSubObjectives.has('check_idlers')) {
      if (!this.oldBeltRemoved) {
        this.sound.playError();
        this.showToast('Nimm zuerst den alten Zahnriemen von den Rädern ab!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      const which = id === 'wheel_lower' ? 'lower' : 'upper';
      this.idlersChecked[which] = true;
      this.engine.triggerRollerSpinCheck(which);
      this.sound.playBearingSpin();
      if (this.idlersChecked.lower && this.idlersChecked.upper) {
        this.showToast('Beide Umlenkrollen geprüft — ruhiger, spielfreier Lagerlauf!', 'success');
        this.completeSubObjective('check_idlers', 45);
      } else {
        this.showToast(
          which === 'lower'
            ? 'Untere Umlenkrolle OK — prüfe jetzt auch die obere Umlenkrolle!'
            : 'Obere Umlenkrolle OK — prüfe jetzt auch die untere Umlenkrolle!',
          'info'
        );
        this.hudDirty = true;
      }
      return;
    }

    this.wrongTargetFeedback(
      !this.oldTensionerReleased
        ? 'Entlaste zuerst die Exzenter-Spannrolle mit dem Exzenter-Schlüssel [6].'
        : !this.oldBeltRemoved
          ? 'Hebe jetzt den entspannten alten Zahnriemen mit der Hand [1] ab.'
          : 'Prüfe Kühlmittelpumpe sowie untere & obere Umlenkrolle mit der Hand [1].'
    );
  }

  private handleStep8InstallNewBelt(id: InteractableId): void {
    const expected = ROUTE_ORDER[this.beltRoutingProgress.length];
    if (!expected) return;

    const mapId: Partial<Record<InteractableId, TimingWheelId>> = {
      wheel_crank: 'crank',
      lockPin_crank: 'crank',
      wheel_lower: 'lower',
      wheel_tensioner: 'tensioner',
      tensionerNut: 'tensioner',
      wheel_cam: 'cam',
      lockPin_cam: 'cam',
      wheel_upper: 'upper',
      wheel_pump: 'pump',
      lockPin_pump: 'pump',
      wheel_water: 'water',
    };
    const clicked = mapId[id];
    if (!clicked) {
      const nextWheel = wheels.find((w) => w.id === expected)!;
      this.wrongTargetFeedback(`Lege den neuen Zahnriemen [8] über alle 7 Stationen — als Nächstes: ${nextWheel.name}.`);
      return;
    }

    if (!this.requireTool('newTimingBelt')) return;

    if (clicked !== expected) {
      this.mistakes += 1;
      this.sound.playError();
      const nextWheel = wheels.find((w) => w.id === expected)!;
      this.showToast(
        `Reihenfolge beachten! Station ${this.beltRoutingProgress.length + 1} von 7: ${nextWheel.name}.`,
        'warning'
      );
      this.hudDirty = true;
      return;
    }

    this.beltRoutingProgress = [...this.beltRoutingProgress, clicked];
    this.engine.setRoutingProgress(this.beltRoutingProgress);

    if (this.beltRoutingProgress.length === ROUTE_ORDER.length) {
      this.newBeltInstalled = true;
      this.engine.setBeltState('new_slack');
      this.sound.playBeltSnap();
      this.showToast('Neuer Zahnriemen über alle 7 Räder & Rollen formschlüssig aufgelegt!', 'success');
    } else {
      this.sound.playSuccess();
    }

    this.completeSubObjective(`route_${clicked}`, 35);
  }

  private handleStep9SetTension(id: InteractableId): void {
    if ((id === 'wheel_tensioner' || id === 'tensionerNut') && !this.tensionPointerAligned) {
      if (!this.requireTool('eccentricKey')) return;
      this.sound.playClick();
      this.minigame = {
        type: 'eccentric',
        tension: this.tensionNormalized,
        targetMin: 0.46,
        targetMax: 0.54,
        aligned: Math.abs(this.tensionNormalized - 0.5) <= 0.04,
        mode: 'set',
      };
      this.updateLiveTools();
      this.showToast('Exzenter-Schlüssel angesetzt — Zeiger ins grüne Referenzfenster führen!', 'info');
      this.broadcastHud(true);
      return;
    }

    if ((id === 'tensionerNut' || id === 'wheel_tensioner') && this.tensionPointerAligned && !this.tensionerTorqued) {
      if (!this.requireTool('torqueWrench')) return;
      const pos = this.getInteractableWorldPos('tensionerNut') ?? this.engine.getWheelWorldPos('tensioner');
      this.pendingTorque = { kind: 'tensioner', worldPos: pos };
      this.minigame = {
        type: 'torque',
        targetPct: 100,
        tolerancePct: 6,
        maxPct: 135,
        currentPct: 0,
        label: 'Exzenter-Spannrolle sichern',
        boltLabel: 'Spannrollen-Befestigung (Sollbereich nach VW-RLF)',
        active: true,
      };
      this.sound.playClick();
      this.broadcastHud(true);
      return;
    }

    this.wrongTargetFeedback(
      !this.tensionPointerAligned
        ? 'Stelle zuerst den Spannzeiger mit dem Exzenter-Schlüssel [6] mittig ins Referenzfenster.'
        : 'Ziehe die Spannrollen-Befestigung mit dem Drehmomentschlüssel [7] im Sollbereich (RLF) an.'
    );
  }

  private handleStep10RemoveLocks(id: InteractableId): void {
    const mapId: Partial<Record<InteractableId, LockableWheelId>> = {
      lockPin_crank: 'crank',
      wheel_crank: 'crank',
      lockPin_cam: 'cam',
      wheel_cam: 'cam',
      lockPin_pump: 'pump',
      wheel_pump: 'pump',
    };
    const shaft = mapId[id];
    if (!shaft || !this.lockedShafts.has(shaft)) {
      this.wrongTargetFeedback('Ziehe alle 3 roten Absteckdorne (KW, NW, HDP) mit dem Absteckdorn-Satz [5] heraus.');
      return;
    }
    if (!this.requireTool('lockingPins')) return;

    this.lockedShafts.delete(shaft);
    this.engine.setLockedShafts(Array.from(this.lockedShafts));
    const pos = this.engine.getWheelWorldPos(shaft);
    this.toolModels.playToolAction('lockingPins', pos, 0.48);
    this.sound.playPinLock();

    const names: Record<LockableWheelId, string> = {
      crank: 'Kurbelwelle',
      cam: 'Nockenwelle',
      pump: 'Hochdruckpumpe',
    };
    this.showToast(`Absteckdorn ${names[shaft]} entfernt!`, 'success');
    this.completeSubObjective(`unlock_${shaft}`, 45);
  }

  private handleStep11CheckTimingAndRun(id: InteractableId): void {
    if (id === 'wheel_crank' && !this.manualCranked) {
      if (!this.requireTool('crankWrench')) return;
      this.manualCranked = true;
      const pos = this.engine.getWheelWorldPos('crank');
      this.toolModels.playToolAction('crankWrench', pos, 1.9);
      this.sound.playRatchet();
      this.scheduleTimeout(() => this.sound.playRatchet(), 650);
      this.scheduleTimeout(() => this.sound.playRatchet(), 1300);

      this.engine.triggerManualCrank720(() => {
        this.crankAngleDeg = 720;
        this.sound.playSuccess();
        this.showToast(
          '720° KW (= 360° NW) durchgedreht — prüfe jetzt OT-Marken & Spannzeiger per Klick [1]!',
          'success'
        );
        this.completeSubObjective('manual_crank_720', 65);
        if (this.mode === 'guide') {
          this.activeTool = 'hand';
        }
        this.broadcastHud(true);
      });
      this.showToast('Kurbelwelle wird zweimal von Hand (720°) durchgedreht…', 'info');
      this.broadcastHud(true);
      return;
    }

    if (
      this.manualCranked &&
      !this.otPointerVerified &&
      (id === 'wheel_tensioner' || id === 'wheel_cam' || id === 'wheel_crank' || id === 'wheel_pump')
    ) {
      if (!this.requireTool('hand')) return;
      this.otPointerVerified = true;
      this.sound.playSuccess();
      this.showToast(
        'Alle 3 OT-Marken & der Spannzeiger passen exakt! Starte jetzt den 1.6 TDI Probelauf im linken Feld.',
        'success'
      );
      this.completeSubObjective('verify_ot_and_pointer', 60);
      this.broadcastHud(true);
      return;
    }

    this.wrongTargetFeedback(
      !this.manualCranked
        ? 'Drehe das Kurbelwellenrad mit der KW-Knarre [4] zweimal von Hand durch (720°).'
        : !this.otPointerVerified
          ? 'Klicke Spannrolle oder Nockenwellenrad mit der Hand [1] an, um OT & Zeiger zu bestätigen.'
          : 'Starte den 1.6 TDI Motor über den grünen Start-Button im linken Bedienfeld!'
    );
  }

  private handleStep12Reassemble(id: InteractableId): void {
    // 1. Reinstall timing belt cover + 2x T25
    if (!this.timingCoverReinstalled) {
      if (id === 'timingCoverSlot' && !this.timingCoverSeatedInReassembly) {
        if (!this.requireTool('hand')) return;
        this.timingCoverSeatedInReassembly = true;
        this.timingCoverRemoved = false;
        this.engine.setTimingCoverRemoved(false);
        this.engine.setTimingCoverSlotVisible(false);
        this.sound.playSuccess();
        this.showToast('Zahnriemenabdeckung angesetzt — jetzt mit Torx T25 [3] beide Befestigungen anziehen!', 'info');
        if (this.mode === 'guide') {
          this.activeTool = 'torx25';
        }
        this.hudDirty = true;
        return;
      }

      if (
        this.timingCoverSeatedInReassembly &&
        (id === 'timingCover' || id === 'timingCoverBolt_0' || id === 'timingCoverBolt_1')
      ) {
        if (!this.requireTool('torx25')) return;
        this.timingCoverReinstalled = true;
        for (let i = 0; i < 2; i++) {
          this.scheduleTimeout(() => {
            this.timingCoverBoltsRemoved[i] = false;
            this.engine.setTimingCoverBoltRemoved(i, false);
            const pos = this.getInteractableWorldPos(`timingCoverBolt_${i}` as InteractableId);
            if (pos) this.toolModels.playToolAction('torx25', pos, 0.34);
            this.sound.playScrewdriver();
          }, i * 200);
        }
        this.golf7.setGhostSlotVisible('wheelLinerSlot', true);
        this.showToast('Zahnriemenabdeckung gesichert! Jetzt Radhausschale einsetzen [1].', 'success');
        this.completeSubObjective('reinstall_timing_cover', 50);
        this.selectCamera('wheelWell');
        if (this.mode === 'guide') {
          this.activeTool = 'hand';
        }
        return;
      }

      this.wrongTargetFeedback(
        this.timingCoverSeatedInReassembly
          ? 'Verschraube die Zahnriemenabdeckung mit Torx T25 [3].'
          : 'Setze zuerst die Zahnriemenabdeckung mit der Hand [1] wieder auf den Steuertrieb.'
      );
      return;
    }

    // 2. Insert wheel liner + 6x T25
    if (!this.linerReinstalled) {
      if (id === 'wheelLinerSlot' && !this.linerSeatedInReassembly) {
        if (!this.requireTool('hand')) return;
        this.linerSeatedInReassembly = true;
        this.linerRemoved = false;
        this.golf7.setLinerRemoved(false);
        this.golf7.setGhostSlotVisible('wheelLinerSlot', false);
        this.sound.playSuccess();
        this.showToast('Radhausschale eingesetzt — jetzt mit Torx T25 [3] die 6 Schrauben festdrehen!', 'info');
        if (this.mode === 'guide') {
          this.activeTool = 'torx25';
        }
        this.hudDirty = true;
        return;
      }

      if (this.linerSeatedInReassembly && (id === 'wheelLiner' || id.startsWith('linerScrew_'))) {
        if (!this.requireTool('torx25')) return;
        this.linerReinstalled = true;
        for (let i = 0; i < 6; i++) {
          this.scheduleTimeout(() => {
            this.linerScrewsRemoved[i] = false;
            this.golf7.setLinerScrewRemoved(i, false);
            const pos = this.getInteractableWorldPos(`linerScrew_${i}` as InteractableId);
            if (pos && i % 2 === 0) {
              this.toolModels.playToolAction('torx25', pos, 0.25);
            }
            if (i % 2 === 0) this.sound.playScrewdriver();
          }, i * 110);
        }
        this.showToast('6× Torx T25 verschraubt! Setze nun das Vorderrad auf die Radnabe [1].', 'success');
        this.completeSubObjective('reinstall_liner', 45);
        if (this.mode === 'guide') {
          this.activeTool = 'hand';
        }
        return;
      }

      this.wrongTargetFeedback(
        this.linerSeatedInReassembly
          ? 'Befestige die eingesetzte Radhausschale mit dem Torx-Schraubendreher T25 [3].'
          : 'Setze zuerst die Radhausschale mit der Hand [1] in den Radkasten ein.'
      );
      return;
    }

    // 3. Mount front-right wheel onto hub
    if (!this.wheelReinstalled) {
      if (id === 'wheelHub' || id === 'frontRightWheel') {
        if (!this.requireTool('hand')) return;
        this.wheelReinstalled = true;
        this.wheelRemoved = false;
        this.golf7.setWheelRemoved(false);
        for (let i = 0; i < 5; i++) {
          this.lugBoltsRemoved[i] = false;
          this.golf7.setLugBoltRemoved(i, false);
        }
        this.sound.playSuccess();
        this.showToast('Vorderrad aufgesetzt! Ziehe die 5 Radschrauben mit dem Drehmomentschlüssel [7] über Kreuz an.', 'success');
        this.completeSubObjective('reinstall_wheel', 45);
        if (this.mode === 'guide') {
          this.activeTool = 'torqueWrench';
        }
        return;
      }
      this.wrongTargetFeedback('Klicke die Radnabe mit der Hand [1] an, um das Vorderrad aufzusetzen.');
      return;
    }

    // 4. Torque 5 lug bolts in star pattern
    if (!this.wheelBoltsTorqued.every(Boolean)) {
      if (id.startsWith('lugBolt_') || id === 'frontRightWheel') {
        if (!this.requireTool('torqueWrench')) return;
        const targetBoltId = id.startsWith('lugBolt_') ? id : 'lugBolt_0';
        const pos = this.getInteractableWorldPos(targetBoltId) ?? new THREE.Vector3(0.76, 0.32, -1.32);
        this.pendingTorque = { kind: 'wheel', worldPos: pos };
        this.minigame = {
          type: 'torque',
          targetPct: 100,
          tolerancePct: 7,
          maxPct: 135,
          currentPct: 0,
          label: 'Vorderrad rechts (über Kreuz)',
          boltLabel: '5× Radschrauben (Sollbereich nach VW-RLF)',
          active: true,
        };
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback('Ziehe die Radschrauben mit dem Drehmomentschlüssel [7] über Kreuz an.');
      return;
    }

    // 5. Reinstall engine cover & close hood
    if (!this.coverHoodReinstalled) {
      if (id === 'hood' || id === 'engineCover') {
        if (!this.requireTool('hand')) return;
        this.coverHoodReinstalled = true;
        this.engineCoverRemoved = false;
        this.golf7.setEngineCoverRemoved(false);
        this.sound.playSuccess();
        this.scheduleTimeout(() => {
          this.hoodOpen = false;
          this.golf7.setHoodOpen(false);
          this.sound.playClick();
        }, 420);
        this.showToast('Motorabdeckung montiert & Haube geschlossen — jetzt Hebebühne ablassen!', 'success');
        this.completeSubObjective('reinstall_cover_hood', 50);
        return;
      }
      this.wrongTargetFeedback('Klicke die Motorhaube [1] an, um Abdeckung einzusetzen und die Haube zu schließen.');
      return;
    }

    // 6. Lower the 2-post lift
    if (this.liftRaised) {
      if (id === 'liftControlDown') {
        if (!this.requireTool('hand')) return;
        this.liftRaised = false;
        this.sound.playLiftMotor(2.1);
        this.showToast('Hebebühne fährt komplett herunter…', 'success');
        this.scheduleTimeout(() => {
          this.completeSubObjective('lower_lift', 70);
        }, 1200);
        return;
      }
      this.wrongTargetFeedback('Drücke den gelben Abwärts-Taster an der rechten Hebebühnensäule.');
    }
  }

  private wrongTargetFeedback(hint: string): void {
    this.sound.playError();
    if (this.mode === 'guide') {
      this.showToast(hint, 'warning');
    } else {
      this.mistakes += 1;
      this.showToast('Falscher Arbeitsschritt in dieser Reihenfolge.', 'error');
    }
    this.hudDirty = true;
  }

  // =========================================================================
  // Minigame Resolution
  // =========================================================================

  private finalizeTorqueAttempt(): void {
    if (this.minigame.type !== 'torque' || !this.pendingTorque) return;
    const { targetPct, tolerancePct, currentPct, label } = this.minigame;
    const ctx = this.pendingTorque;

    if (currentPct < targetPct * 0.45) {
      this.minigame = { ...this.minigame, currentPct: 0 };
      this.sound.playError();
      this.showToast('Taste gedrückt halten, bis der grüne Sollbereich (100 % RLF) erreicht ist!', 'warning');
      this.broadcastHud(true);
      return;
    }

    this.sound.playTorqueClick();
    this.toolModels.playToolAction('torqueWrench', ctx.worldPos, 0.72);

    const delta = currentPct - targetPct;
    const absDelta = Math.abs(delta);
    let rating: TorqueScore['rating'];
    let scoreXp: number;

    if (absDelta <= tolerancePct * 0.5) {
      rating = 'Perfekt';
      scoreXp = 100;
    } else if (absDelta <= tolerancePct) {
      rating = 'Gut';
      scoreXp = 75;
    } else if (absDelta <= tolerancePct * 2) {
      rating = 'Akzeptabel';
      scoreXp = 45;
    } else {
      rating = 'Daneben';
      scoreXp = 15;
      this.mistakes += 1;
    }

    const scoreEntry: TorqueScore = {
      label,
      targetLabel: 'Soll RLF',
      achievedPct: Number(currentPct.toFixed(1)),
      deltaPct: Number(delta.toFixed(1)),
      rating,
      xp: scoreXp,
    };
    this.torqueScores.push(scoreEntry);
    this.xp += scoreXp;

    this.minigame = { type: 'none' };
    this.pendingTorque = null;

    if (ctx.kind === 'tensioner') {
      this.tensionerTorqued = true;
      this.showToast(
        `${rating}! Spannrollen-Befestigung mit ${scoreEntry.achievedPct.toFixed(0)} % Sollmoment angezogen (+${scoreXp} XP)`,
        rating === 'Daneben' ? 'warning' : 'success'
      );
      this.completeSubObjective('torque_tensioner_nut', 0);
    } else {
      for (let i = 0; i < STAR_BOLT_ORDER.length; i++) {
        const boltIdx = STAR_BOLT_ORDER[i];
        this.scheduleTimeout(() => {
          this.wheelBoltsTorqued[boltIdx] = true;
          const bPos = this.getInteractableWorldPos(`lugBolt_${boltIdx}` as InteractableId);
          if (bPos && i > 0) {
            this.toolModels.playToolAction('torqueWrench', bPos, 0.25);
            this.sound.playTorqueClick();
          }
        }, i * 180);
      }
      this.showToast(
        `${rating}! 5× Radschrauben über Kreuz mit ${scoreEntry.achievedPct.toFixed(0)} % Sollmoment angezogen (+${scoreXp} XP)`,
        rating === 'Daneben' ? 'warning' : 'success'
      );
      this.scheduleTimeout(() => {
        this.completeSubObjective('torque_wheel_bolts', 0);
        this.selectCamera('overview');
        if (this.mode === 'guide') {
          this.activeTool = 'hand';
        }
      }, 920);
    }

    this.broadcastHud(true);
  }

  // =========================================================================
  // Guide Target Resolution & Pulsing 3D Beacon
  // =========================================================================

  private computeRecommendedTool(): ToolId | null {
    if (!this.started || this.completed || this.mode !== 'guide') return null;
    switch (this.stepIndex) {
      case 0:
      case 1:
        return 'hand';
      case 2:
        return this.lugBoltsRemoved.every(Boolean) ? 'hand' : 'impact17';
      case 3:
        return this.linerScrewsRemoved.every(Boolean) ? 'hand' : 'torx25';
      case 4:
        return this.timingCoverBoltsRemoved.every(Boolean) ? 'hand' : 'torx25';
      case 5:
        return 'crankWrench';
      case 6:
        return 'lockingPins';
      case 7:
        return this.oldTensionerReleased ? 'hand' : 'eccentricKey';
      case 8:
        return 'newTimingBelt';
      case 9:
        return this.tensionPointerAligned ? 'torqueWrench' : 'eccentricKey';
      case 10:
        return 'lockingPins';
      case 11:
        return this.manualCranked ? 'hand' : 'crankWrench';
      case 12:
        if (!this.timingCoverReinstalled) return this.timingCoverSeatedInReassembly ? 'torx25' : 'hand';
        if (!this.linerReinstalled) return this.linerSeatedInReassembly ? 'torx25' : 'hand';
        if (!this.wheelReinstalled) return 'hand';
        if (!this.wheelBoltsTorqued.every(Boolean)) return 'torqueWrench';
        return 'hand';
      default:
        return 'hand';
    }
  }

  private computeGuideTargetId(): InteractableId | null {
    if (!this.started || this.completed || this.mode !== 'guide' || this.minigame.type !== 'none') {
      return null;
    }

    switch (this.stepIndex) {
      case 0:
        return !this.hoodOpen ? 'hood' : !this.liftRaised ? 'liftControlUp' : null;
      case 1:
        return !this.engineCoverRemoved ? 'engineCover' : null;
      case 2: {
        const nextBolt = this.lugBoltsRemoved.findIndex((done) => !done);
        return nextBolt >= 0 ? (`lugBolt_${nextBolt}` as InteractableId) : 'frontRightWheel';
      }
      case 3: {
        const nextScrew = this.linerScrewsRemoved.findIndex((done) => !done);
        return nextScrew >= 0 ? (`linerScrew_${nextScrew}` as InteractableId) : 'wheelLiner';
      }
      case 4: {
        const nextBolt = this.timingCoverBoltsRemoved.findIndex((done) => !done);
        if (nextBolt >= 0) return `timingCoverBolt_${nextBolt}` as InteractableId;
        if (!this.timingCoverRemoved) return 'timingCover';
        return 'oldTimingBelt';
      }
      case 5:
        return 'wheel_crank';
      case 6:
        if (!this.lockedShafts.has('crank')) return 'wheel_crank';
        if (!this.lockedShafts.has('cam')) return 'wheel_cam';
        if (!this.lockedShafts.has('pump')) return 'wheel_pump';
        return null;
      case 7:
        if (!this.oldTensionerReleased) return 'wheel_tensioner';
        if (!this.oldBeltRemoved) return 'oldTimingBelt';
        if (!this.waterPumpChecked) return 'wheel_water';
        if (!this.idlersChecked.lower) return 'wheel_lower';
        if (!this.idlersChecked.upper) return 'wheel_upper';
        return null;
      case 8: {
        const nextNode = ROUTE_ORDER[this.beltRoutingProgress.length];
        return nextNode ? (`wheel_${nextNode}` as InteractableId) : null;
      }
      case 9:
        return !this.tensionPointerAligned ? 'wheel_tensioner' : 'tensionerNut';
      case 10:
        if (this.lockedShafts.has('crank')) return 'lockPin_crank';
        if (this.lockedShafts.has('cam')) return 'lockPin_cam';
        if (this.lockedShafts.has('pump')) return 'lockPin_pump';
        return null;
      case 11:
        if (!this.manualCranked) return 'wheel_crank';
        if (!this.otPointerVerified) return 'wheel_tensioner';
        return null;
      case 12:
        if (!this.timingCoverReinstalled) {
          return this.timingCoverSeatedInReassembly ? 'timingCover' : 'timingCoverSlot';
        }
        if (!this.linerReinstalled) {
          return this.linerSeatedInReassembly ? 'wheelLiner' : 'wheelLinerSlot';
        }
        if (!this.wheelReinstalled) return 'wheelHub';
        if (!this.wheelBoltsTorqued.every(Boolean)) return 'lugBolt_0';
        if (!this.coverHoodReinstalled) return 'hood';
        if (this.liftRaised) return 'liftControlDown';
        return null;
      default:
        return null;
    }
  }

  private updateBeacon(dt: number): void {
    this.beaconClock += dt;
    const targetId = this.computeGuideTargetId();
    if (!targetId) {
      this.beaconGroup.visible = false;
      return;
    }

    const pos = this.getInteractableWorldPos(targetId);
    if (!pos) {
      this.beaconGroup.visible = false;
      return;
    }

    this.beaconGroup.visible = true;
    this.beaconGroup.position.copy(pos);

    this.beaconRing.lookAt(this.sceneManager.camera.position);
    const pulse = 1 + 0.16 * Math.sin(this.beaconClock * 5.2);
    this.beaconRing.scale.setScalar(pulse);
    this.beaconDiamond.position.y = 0.058 + Math.sin(this.beaconClock * 4.5) * 0.011;
    this.beaconDiamond.rotation.y += dt * 2.2;
  }

  // =========================================================================
  // Main Loop & Minigame Updates
  // =========================================================================

  private loop(now: number): void {
    this.rafId = requestAnimationFrame((ts) => this.loop(ts));
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.lastTimestamp) / 1000));
    this.lastTimestamp = now;

    // 1. Timer progression
    if (this.started && !this.completed) {
      this.elapsedSeconds += dt;
      const wholeSec = Math.floor(this.elapsedSeconds);
      if (wholeSec !== this.lastSecondBroadcast) {
        this.lastSecondBroadcast = wholeSec;
        this.hudDirty = true;
      }
    }

    // 2. Lift height animation
    const targetLiftY = this.liftRaised ? LIFT_RAISED_HEIGHT : 0;
    if (Math.abs(targetLiftY - this.currentLiftY) > 0.0005) {
      const oldY = this.currentLiftY;
      const step = Math.sign(targetLiftY - this.currentLiftY) * 0.42 * dt;
      if (Math.abs(targetLiftY - this.currentLiftY) <= Math.abs(step)) {
        this.currentLiftY = targetLiftY;
      } else {
        this.currentLiftY += step;
      }
      this.sceneManager.carLiftGroup.position.y = this.currentLiftY;
      this.workshop.setLiftHeight(this.currentLiftY);
      this.golf7.setStoredOffLiftY(this.currentLiftY);
      this.sceneManager.setWorkLampLiftOffset(this.currentLiftY);
      this.cameraController.adjustForLiftChange(oldY, this.currentLiftY);
    }

    // 3. Engine Probelauf check (Step 12)
    if (this.engineRunning) {
      this.engineRpm = 820 + Math.round(Math.sin(now * 0.012) * 8);
      if (
        this.started &&
        this.stepIndex === 11 &&
        this.manualCranked &&
        this.otPointerVerified &&
        !this.completedSubObjectives.has('engine_idle_check')
      ) {
        this.engineRunTimer += dt;
        if (this.engineRunTimer >= 1.8) {
          this.showToast(
            'EA288 Zahnriemen läuft absolut ruhig und exakt in Spur! Weiter zum Rückbau.',
            'success'
          );
          this.stopEngineImmediate();
          this.completeSubObjective('engine_idle_check', 75);
        }
      } else if (now - this.lastHudSyncTime > 120) {
        this.hudDirty = true;
      }
    }

    // 4. Minigames
    this.updateMinigames(dt);

    // 5. Subsystems
    this.cameraController.update(dt);
    this.golf7.update(dt);
    this.engine.update(dt);
    this.toolModels.update(dt);
    this.updateBeacon(dt);

    // 6. Render WebGL + Bloom
    this.sceneManager.render();

    // 7. Throttled HUD broadcast
    if (this.hudDirty || (this.minigame.type !== 'none' && now - this.lastHudSyncTime > 32)) {
      this.lastHudSyncTime = now;
      this.hudDirty = false;
      this.hud.render(this.getSnapshot());
      if (this.hoveredPart) {
        this.hud.setTooltipScreenPos(this.pointerScreenX, this.pointerScreenY);
      }
    }
  }

  private updateMinigames(dt: number): void {
    if (this.minigame.type === 'ot') {
      if (this.otPressing) {
        this.crankAngleDeg = Math.min(760, this.crankAngleDeg + dt * 44);
        this.engine.setCrankAngle(this.crankAngleDeg);
        this.updateLiveTools();
        const aligned = isAtOT(this.crankAngleDeg, this.minigame.toleranceDeg);
        this.minigame = {
          ...this.minigame,
          crankDeg: this.crankAngleDeg,
          aligned,
        };
        this.hudDirty = true;
      }
    } else if (this.minigame.type === 'eccentric') {
      if (this.minigame.mode === 'release') {
        if (this.eccentricPressing) {
          this.tensionNormalized = Math.max(0.10, this.tensionNormalized - dt * 0.55);
          this.engine.setTension(this.tensionNormalized);
          this.updateLiveTools();

          if (this.tensionNormalized <= 0.14) {
            this.tensionNormalized = 0.12;
            this.eccentricPressing = false;
            this.oldTensionerReleased = true;
            this.engine.setTension(0.12);
            this.toolModels.setActiveEccentricKey(false);
            this.minigame = { type: 'none' };
            this.sound.playSuccess();
            this.showToast('Exzenter-Spannrolle entlastet! Nimm jetzt den alten Zahnriemen mit der Hand [1] ab.', 'success');
            this.completeSubObjective('release_old_tensioner', 55);
            if (this.mode === 'guide') {
              this.activeTool = 'hand';
            }
            this.broadcastHud(true);
            return;
          }
          this.minigame = {
            ...this.minigame,
            tension: this.tensionNormalized,
            aligned: this.tensionNormalized <= this.minigame.targetMax,
          };
          this.hudDirty = true;
        }
      } else if (this.eccentricPressing) {
        // mode === 'set': advance pointer clockwise from slack (0.12) into reference window [0.46, 0.54]
        this.tensionNormalized = Math.min(0.92, this.tensionNormalized + dt * 0.34);
        this.engine.setTension(this.tensionNormalized);
        this.updateLiveTools();
        const aligned =
          this.tensionNormalized >= this.minigame.targetMin &&
          this.tensionNormalized <= this.minigame.targetMax;
        this.minigame = {
          ...this.minigame,
          tension: this.tensionNormalized,
          aligned,
        };
        this.hudDirty = true;
      }
    } else if (this.minigame.type === 'torque' && this.torquePressing) {
      const rate = 62;
      const nextPct = Math.min(this.minigame.maxPct, this.minigame.currentPct + rate * dt);
      this.minigame = { ...this.minigame, currentPct: nextPct };
      if (nextPct >= this.minigame.maxPct) {
        this.torquePressing = false;
        this.finalizeTorqueAttempt();
      } else {
        this.hudDirty = true;
      }
    }
  }

  private stopEngineImmediate(): void {
    if (this.engineRunning) {
      this.engineRunning = false;
      this.engineRpm = 0;
      this.engine.setEngineRunning(false);
      this.sound.stopDieselEngine();
    }
  }

  private showToast(text: string, kind: ToastMessage['kind']): void {
    if (this.toastClearTimeout !== null) {
      window.clearTimeout(this.toastClearTimeout);
    }
    this.toastCounter += 1;
    this.toast = { id: this.toastCounter, text, kind };
    this.hudDirty = true;

    this.toastClearTimeout = window.setTimeout(() => {
      this.toast = null;
      this.toastClearTimeout = null;
      this.hudDirty = true;
    }, 3600);
  }

  private scheduleTimeout(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      const idx = this.pendingTimeouts.indexOf(id);
      if (idx >= 0) this.pendingTimeouts.splice(idx, 1);
      fn();
    }, ms);
    this.pendingTimeouts.push(id);
  }

  private clearPendingTimers(): void {
    while (this.pendingTimeouts.length > 0) {
      const id = this.pendingTimeouts.pop();
      if (id !== undefined) window.clearTimeout(id);
    }
    if (this.toastClearTimeout !== null) {
      window.clearTimeout(this.toastClearTimeout);
      this.toastClearTimeout = null;
    }
  }

  private broadcastHud(force = false): void {
    if (force) {
      this.hudDirty = false;
      this.lastHudSyncTime = performance.now();
      this.hud.render(this.getSnapshot());
    } else {
      this.hudDirty = true;
    }
  }

  private onResize(): void {
    this.sceneManager.resize();
  }
}
