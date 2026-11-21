import * as THREE from 'three';
import { SoundEngine } from '../audio/SoundEngine';
import { CameraController } from '../engine/CameraController';
import { SceneManager } from '../engine/SceneManager';
import { EA288Engine } from '../models/EA288Engine';
import { Golf7Model } from '../models/Golf7Model';
import { ToolModels } from '../models/ToolModels';
import { WorkshopEnvironment } from '../models/WorkshopEnvironment';
import { CAMERA_PRESETS, REPAIR_STEPS, TOOL_DEFINITIONS } from '../steps/stepDefinitions';
import type {
  BeltPulleyNode,
  CameraPresetId,
  GameMode,
  GameSnapshot,
  HUDCallbacks,
  InteractableId,
  InteractableMeta,
  MinigameState,
  ToastMessage,
  ToolId,
  TorqueScore,
} from '../types';
import { GameHUD } from '../ui/GameHUD';

const LIFT_RAISED_HEIGHT = 0.88;
const STAR_BOLT_ORDER = [0, 2, 4, 1, 3];

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
  private readonly engine: EA288Engine;
  private readonly toolModels: ToolModels;
  private readonly sound: SoundEngine;
  private readonly hud: GameHUD;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private pointerScreenX = 0;
  private pointerScreenY = 0;
  private pointerDownPos = { x: 0, y: 0 };
  private pointerMovedDist = 0;
  private pointerDownOnTensionerHex = false;

  // 3D Guide Beacon
  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRing: THREE.Mesh;
  private readonly beaconDiamond: THREE.Mesh;
  private beaconClock = 0;

  // Safe WeakMap material hover highlight store
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
  private diagramUnlocked = false;
  private tensionerProgress = 0;
  private pinInserted = false;
  private oldBeltRemoved = false;
  private pulleyChecked = { alternator: false, ac: false };
  private tensionerState: 'old' | 'removed' | 'new' = 'old';
  private tensionerTorqued = false;
  private beltRoutingProgress: BeltPulleyNode[] = [];
  private newBeltInstalled = false;
  private newTensionerReleased = false;
  private manualCranked = false;
  private engineRunning = false;
  private engineRpm = 0;
  private engineRunTimer = 0;
  private linerSeatedInReassembly = false;
  private linerReinstalled = false;
  private wheelReinstalled = false;
  private wheelBoltsTorqued = [false, false, false, false, false];
  private coverHoodReinstalled = false;
  private wrenchHoldingTensioner = false;

  // Minigame State
  private minigame: MinigameState = { type: 'none' };
  private tensionerPressing = false;
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

  // Event handler refs for clean disposal
  private readonly handleResizeBound: () => void;
  private readonly handlePointerMoveBound: (e: PointerEvent) => void;
  private readonly handleWindowPointerMoveBound: (e: PointerEvent) => void;
  private readonly handlePointerLeaveBound: () => void;
  private readonly handlePointerDownBound: (e: PointerEvent) => void;
  private readonly handlePointerUpBound: (e: PointerEvent) => void;
  private readonly handleKeyDownBound: (e: KeyboardEvent) => void;
  private readonly handleKeyUpBound: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement) {
    this.sceneManager = new SceneManager(container);
    this.cameraController = new CameraController(
      this.sceneManager.camera,
      this.sceneManager.renderer.domElement
    );
    this.workshop = new WorkshopEnvironment(this.sceneManager.scene);
    this.golf7 = new Golf7Model();
    this.engine = new EA288Engine();
    this.toolModels = new ToolModels();
    this.sound = new SoundEngine();

    this.sceneManager.carLiftGroup.add(this.golf7.group);
    this.sceneManager.carLiftGroup.add(this.engine.group);
    this.sceneManager.scene.add(this.toolModels.group);

    // Build 3D pulsing target beacon
    const ringGeo = new THREE.RingGeometry(0.032, 0.044, 32);
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

    const diamondGeo = new THREE.OctahedronGeometry(0.016, 0);
    const diamondMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    this.beaconDiamond = new THREE.Mesh(diamondGeo, diamondMat);
    this.beaconDiamond.position.y = 0.065;
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
      onTensionerPressChange: (pressing) => this.setTensionerPressing(pressing),
      onTorquePressChange: (pressing) => this.setTorquePressing(pressing),
      onResetGame: () => this.resetGame(),
      onFreeInspect: () => this.enterFreeInspect(),
    };

    this.hud = new GameHUD(container, callbacks);

    // Start in scenic garage title orbit
    this.cameraController.setTitleOrbit(true);
    this.syncAllModels(true);

    // Bind DOM events
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

    window.addEventListener('resize', this.handleResizeBound);
    canvas.addEventListener('pointermove', this.handlePointerMoveBound);
    canvas.addEventListener('pointerleave', this.handlePointerLeaveBound);
    window.addEventListener('pointermove', this.handleWindowPointerMoveBound);
    canvas.addEventListener('pointerdown', this.handlePointerDownBound);
    window.addEventListener('pointerup', this.handlePointerUpBound);
    window.addEventListener('keydown', this.handleKeyDownBound);
    window.addEventListener('keyup', this.handleKeyUpBound);

    this.broadcastHud(true);
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame((ts) => this.loop(ts));

    void this.loadBlenderAssets();
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
    this.selectCamera('beltClose');
    this.showToast('Freier Inspektionsmodus aktiv — Motor & Kamera frei steuerbar!', 'info');
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

    if (!this.freeInspectMode && this.stepIndex === 10 && !this.manualCranked) {
      this.sound.playError();
      this.showToast('Erst Kurbelwelle 2× (720°) von Hand mit der Knarre durchdrehen!', 'warning');
      return;
    }

    if (this.beltRoutingProgress.length > 0 && !this.newBeltInstalled && this.oldBeltRemoved) {
      this.sound.playError();
      this.showToast('Kein montierter Keilrippenriemen!', 'error');
      return;
    }

    this.engineRunning = true;
    this.engineRpm = 820;
    this.engineRunTimer = 0;
    this.engine.setEngineRunning(true, 820);
    this.sound.startDieselEngine();
    this.showToast('1.6 TDI (EA288) gestartet — 820 U/min Leerlauf. Riemenlauf beobachten!', 'success');
    this.broadcastHud(true);
  }

  public setTensionerPressing(pressing: boolean): void {
    if (this.minigame.type !== 'tensioner') {
      this.tensionerPressing = false;
      return;
    }
    this.tensionerPressing = pressing;
    if (!pressing && this.minigame.mode === 'lock') {
      if (this.minigame.aligned) {
        // Latch wrench cleanly in aligned position so mechanic can insert T10060A
        this.tensionerProgress = 0.90;
        this.wrenchHoldingTensioner = true;
        this.engine.setTensionerProgress(this.tensionerProgress);
        this.minigame = { type: 'none' };
        this.completeSubObjective('rotate_tensioner', 65);
        this.sound.playSuccess();
        this.showToast(
          'Bohrungen fluchten! Jetzt Absteckstift T10060A [5] in das 4-mm-Loch stecken.',
          'success'
        );
        if (this.mode === 'guide') {
          this.activeTool = 'pinT10060A';
        }
        this.broadcastHud(true);
      } else {
        this.sound.playError();
        this.showToast(
          'Noch nicht im grünen Bereich (28°–35°)! Taste gedrückt halten bis FLUCHTET erscheint.',
          'warning'
        );
      }
    }
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

    this.clearHoverHighlight();
    this.hud.destroy();
    this.workshop.dispose();
    this.engine.dispose();
    this.cameraController.dispose();
    this.sceneManager.dispose();
  }

  // =========================================================================
  // Step & World Synchronization
  // =========================================================================

  private resetWorldToStep(targetStep: number): void {
    this.stepIndex = targetStep;
    this.completedSubObjectives.clear();
    this.minigame = { type: 'none' };
    this.tensionerPressing = false;
    this.torquePressing = false;
    this.pendingTorque = null;
    this.wrenchHoldingTensioner = false;

    this.liftRaised = targetStep >= 1;
    this.currentLiftY = this.liftRaised ? LIFT_RAISED_HEIGHT : 0;
    this.hoodOpen = targetStep >= 1;
    this.engineCoverRemoved = targetStep >= 2;

    const wheelGone = targetStep >= 3 && targetStep < 12;
    this.lugBoltsRemoved = [wheelGone, wheelGone, wheelGone, wheelGone, wheelGone];
    this.wheelRemoved = wheelGone;

    const linerGone = targetStep >= 4 && targetStep < 12;
    this.linerScrewsRemoved = [linerGone, linerGone, linerGone, linerGone, linerGone, linerGone];
    this.linerRemoved = linerGone;
    this.linerSeatedInReassembly = false;
    this.linerReinstalled = false;
    this.wheelReinstalled = false;
    this.wheelBoltsTorqued = [false, false, false, false, false];
    this.coverHoodReinstalled = false;

    this.diagramUnlocked = targetStep >= 5;

    if (targetStep < 5) {
      this.tensionerProgress = 0;
      this.pinInserted = false;
      this.oldBeltRemoved = false;
      this.pulleyChecked = { alternator: false, ac: false };
      this.tensionerState = 'old';
      this.tensionerTorqued = false;
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.newTensionerReleased = false;
      this.manualCranked = false;
    } else if (targetStep === 5) {
      this.tensionerProgress = 0;
      this.pinInserted = false;
      this.oldBeltRemoved = false;
      this.pulleyChecked = { alternator: false, ac: false };
      this.tensionerState = 'old';
      this.tensionerTorqued = false;
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.newTensionerReleased = false;
      this.manualCranked = false;
    } else if (targetStep === 6) {
      this.tensionerProgress = 0.90;
      this.pinInserted = true;
      this.oldBeltRemoved = false;
      this.pulleyChecked = { alternator: false, ac: false };
      this.tensionerState = 'old';
      this.tensionerTorqued = false;
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.newTensionerReleased = false;
      this.manualCranked = false;
    } else if (targetStep === 7) {
      this.tensionerProgress = 0.90;
      this.pinInserted = true;
      this.oldBeltRemoved = true;
      this.pulleyChecked = { alternator: true, ac: true };
      this.tensionerState = 'old';
      this.tensionerTorqued = false;
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.newTensionerReleased = false;
      this.manualCranked = false;
    } else if (targetStep === 8) {
      this.tensionerProgress = 0.90;
      this.pinInserted = true;
      this.oldBeltRemoved = true;
      this.pulleyChecked = { alternator: true, ac: true };
      this.tensionerState = 'new';
      this.tensionerTorqued = true;
      this.beltRoutingProgress = [];
      this.newBeltInstalled = false;
      this.newTensionerReleased = false;
      this.manualCranked = false;
    } else if (targetStep === 9) {
      this.tensionerProgress = 0.90;
      this.pinInserted = true;
      this.oldBeltRemoved = true;
      this.pulleyChecked = { alternator: true, ac: true };
      this.tensionerState = 'new';
      this.tensionerTorqued = true;
      this.beltRoutingProgress = ['crank', 'ac', 'alternator', 'tensioner'];
      this.newBeltInstalled = true;
      this.newTensionerReleased = false;
      this.manualCranked = false;
    } else {
      // Steps 10 and 11
      this.tensionerProgress = 0;
      this.pinInserted = false;
      this.oldBeltRemoved = true;
      this.pulleyChecked = { alternator: true, ac: true };
      this.tensionerState = 'new';
      this.tensionerTorqued = true;
      this.beltRoutingProgress = ['crank', 'ac', 'alternator', 'tensioner'];
      this.newBeltInstalled = true;
      this.newTensionerReleased = true;
      this.manualCranked = targetStep >= 11;
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
      this.stepIndex === 11 && this.linerRemoved && !this.linerSeatedInReassembly
    );

    this.engine.setTensionerState(this.tensionerState);
    this.engine.setTensionerProgress(this.tensionerProgress);
    this.engine.setPinInserted(this.pinInserted);

    if (!this.oldBeltRemoved) {
      this.engine.setBeltState('old');
    } else if (this.newBeltInstalled) {
      this.engine.setBeltState(this.newTensionerReleased ? 'new_tensioned' : 'new_slack');
    } else if (this.stepIndex === 8) {
      this.engine.setBeltState('routing');
      this.engine.setRoutingProgress(this.beltRoutingProgress);
    } else {
      this.engine.setBeltState('none');
    }

    this.updateTensionerWrenchMesh();
  }

  private updateTensionerWrenchMesh(): void {
    const showWrench =
      this.minigame.type === 'tensioner' ||
      this.wrenchHoldingTensioner ||
      (this.stepIndex === 9 &&
        this.completedSubObjectives.has('hold_for_pin_pull') &&
        !this.newTensionerReleased);

    if (!showWrench) {
      this.toolModels.setActiveTensionerWrench(false);
      return;
    }

    const hexTx = this.engine.getTensionerHexTransform();
    // Apply only the relative clockwise sweep so the wrench points cleanly up/forward in the wheel well
    const relDeltaRad = -this.tensionerProgress * ((35 * Math.PI) / 180);
    this.toolModels.setActiveTensionerWrench(true, hexTx.pos, undefined, relDeltaRad);
  }

  // =========================================================================
  // Raycasting & Interactions
  // =========================================================================

  private isEffectivelyVisible(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (!cur.visible) return false;
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
      // In opaque (non-X-Ray) mode, solid car body shell blocks clicking things behind it
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
          partNumber: '04L 103 925',
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
          partNumber: 'WHT 001 812 (M14×1,5)',
          status: this.lugBoltsRemoved[idx]
            ? 'Gelöst'
            : this.wheelBoltsTorqued[idx]
              ? '120 Nm fest'
              : 'Montiert',
        };
      }
      case 'frontRightWheel':
        return {
          id,
          label: 'Vorderrad rechts (17" VW Dijon)',
          partNumber: '225/45 R17',
          status: this.wheelRemoved ? 'Auf Reifenständer' : 'Auf Radnabe',
        };
      case 'wheelHub':
        return {
          id,
          label: 'Radnabe & Bremsscheibe VR',
          partNumber: '5×112 mm',
          hint: this.stepIndex === 11 && this.wheelRemoved ? 'Klicken um Vorderrad aufzusetzen' : undefined,
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
          partNumber: 'N 909 747 01',
          status: this.linerScrewsRemoved[idx] ? 'Entfernt' : 'Verschraubt',
        };
      }
      case 'wheelLiner':
        return {
          id,
          label: 'Radhausschale vorne rechts',
          partNumber: '5G0 805 911',
          status: this.linerRemoved ? 'Ausgebaut' : 'Montiert',
        };
      case 'wheelLinerSlot':
        return {
          id,
          label: 'Einbauposition Radhausschale',
          partNumber: '5G0 805 911',
          hint: 'Mit Hand einsetzen, dann 6× Torx T25 festziehen',
        };
      case 'oldBelt':
        return {
          id,
          label: 'Alter Keilrippenriemen',
          partNumber: '6PK1025 (verschlissen)',
          status: this.pinInserted ? 'Entspannt' : 'Unter Spannung',
        };
      case 'newBeltSlot':
        return {
          id,
          label: 'Riemenführung 6PK1025',
          partNumber: 'ContiTech 6PK1025',
          hint: 'Scheiben einzeln anklicken: Kurbelwelle → Klima → Lichtmaschine → Spanner',
        };
      case 'tensionerHex':
        return {
          id,
          label: 'Spannrolle — Sechskant SW 16',
          partNumber: '04L 903 315',
          status: this.pinInserted ? 'Mit T10060A arretiert' : 'Federspannung aktiv',
        };
      case 'tensionerPinHole':
        return {
          id,
          label: this.pinInserted ? 'Absteckstift T10060A (4 mm)' : 'Arretierungsbohrung (4 mm)',
          partNumber: 'VW T10060A',
          status: this.pinInserted
            ? 'Gesteckt'
            : this.tensionerProgress >= 0.8
              ? 'Bohrungen fluchten!'
              : 'Nicht fluchtend',
        };
      case 'tensionerBolt':
        return {
          id,
          label: 'Spannrolle M10-Zentralschraube',
          partNumber: '40 Nm Vorgabe',
          status: this.tensionerState === 'new' ? 'Neuteil' : 'Altteil',
        };
      case 'tensionerMountSlot':
        return {
          id,
          label: 'Aufnahme Spannrolle am Aggregateträger',
          partNumber: '04L 903 315 Einbauplatz',
          hint: 'Neue Spannrolle mit Neuteile-Satz [8] einsetzen',
        };
      case 'pulley_crank':
        return {
          id,
          label: 'Kurbelwellen-Riemenscheibe',
          partNumber: 'Schwingungsdämpfer (6 Rippen)',
        };
      case 'crankBolt':
        return {
          id,
          label: 'Kurbelwellen-Zentralschraube',
          partNumber: '12-Kant-Schraube',
          hint: this.stepIndex === 10 ? 'Mit Knarre [6] zweimal (720°) durchdrehen' : undefined,
        };
      case 'pulley_ac':
        return {
          id,
          label: 'Klimakompressor-Riemenscheibe',
          partNumber: 'Magnetkupplung (6 Rippen)',
        };
      case 'pulley_alternator':
        return {
          id,
          label: 'Lichtmaschine / Generator (OAP)',
          partNumber: 'Freilaufriemenscheibe (6 Rippen)',
        };
      case 'pulley_tensioner':
        return {
          id,
          label: 'Riemenspannrolle (glatte Rückseite)',
          partNumber: '04L 903 315',
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
          mat.emissiveIntensity = Math.min(0.42, orig.emissiveIntensity + 0.22);
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

    // Allow holding directly on the 3D tensioner hex when tensioner minigame is active
    if (this.minigame.type === 'tensioner' && this.started) {
      const picked = this.pickInteractableAt(e.clientX, e.clientY);
      if (picked === 'tensionerHex') {
        this.pointerDownOnTensionerHex = true;
        this.cameraController.controls.enabled = false;
        this.setTensionerPressing(true);
      }
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pointerDownOnTensionerHex) {
      this.pointerDownOnTensionerHex = false;
      this.cameraController.controls.enabled = true;
      this.setTensionerPressing(false);
      return;
    }

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
        if (this.minigame.type === 'tensioner') {
          this.setTensionerPressing(true);
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
      if (this.minigame.type === 'tensioner') {
        this.setTensionerPressing(false);
      } else if (this.minigame.type === 'torque') {
        this.setTorquePressing(false);
      }
    }
  }

  // =========================================================================
  // 12-Step Interactive State Machine
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
      this.showToast('Reparatur erfolgreich abgeschlossen! Meister-Zertifikat erstellt.', 'success');
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
      } else if (id === 'pulley_alternator') {
        this.engine.triggerPulleySpinCheck('alternator');
        this.sound.playBearingSpin();
      } else if (id === 'pulley_ac') {
        this.engine.triggerPulleySpinCheck('ac');
        this.sound.playBearingSpin();
      } else if (id === 'crankBolt' && !this.engineRunning) {
        this.engine.triggerManualCrank(1);
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
        this.handleStep4InspectBelt(id);
        break;
      case 5:
        this.handleStep5LockTensioner(id);
        break;
      case 6:
        this.handleStep6RemoveOldBelt(id);
        break;
      case 7:
        this.handleStep7ReplaceTensioner(id);
        break;
      case 8:
        this.handleStep8InstallNewBelt(id);
        break;
      case 9:
        this.handleStep9ReleaseTensioner(id);
        break;
      case 10:
        this.handleStep10TestRun(id);
        break;
      case 11:
        this.handleStep11Reassemble(id);
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
      this.showToast('Zweisäulen-Hebebühne fährt auf Arbeitshöhe (0,88 m)…', 'success');
      this.completeSubObjective('raise_lift', 40);
      return;
    }

    this.wrongTargetFeedback('Öffne die Motorhaube und drücke die grüne Taste an der Hebebühne.');
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
      return;
    }

    if (id === 'frontRightWheel' && !this.wheelRemoved) {
      const allUnbolted = this.lugBoltsRemoved.every(Boolean);
      if (!allUnbolted) {
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
      return;
    }

    if (id === 'wheelLiner' && !this.linerRemoved) {
      const allUnscrewed = this.linerScrewsRemoved.every(Boolean);
      if (!allUnscrewed) {
        this.sound.playError();
        this.showToast('Erst alle 6 Torx-T25-Schrauben [3] aus der Radhausschale drehen!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.linerRemoved = true;
      this.golf7.setLinerRemoved(true);
      this.sound.playSuccess();
      this.showToast('Radhausschale entfernt — der EA288-Riementrieb liegt frei!', 'success');
      this.completeSubObjective('take_off_liner', 55);
      return;
    }

    this.wrongTargetFeedback('Schraube die 6 Torx-T25-Schrauben [3] heraus und entnimm die Radhausschale [1].');
  }

  private handleStep4InspectBelt(id: InteractableId): void {
    if (id === 'oldBelt' || id.startsWith('pulley_')) {
      if (!this.requireTool('hand')) return;
      this.diagramUnlocked = true;
      this.sound.playSuccess();
      this.showToast('Riemenverlauf (6PK1025) dokumentiert & Schema freigeschaltet!', 'success');
      this.completeSubObjective('document_belt', 60);
      return;
    }
    this.wrongTargetFeedback('Klicke den alten Keilrippenriemen an, um Verlauf und Zustand zu prüfen.');
  }

  private handleStep5LockTensioner(id: InteractableId): void {
    if (id === 'tensionerHex' && !this.completedSubObjectives.has('rotate_tensioner')) {
      if (!this.requireTool('wrench16')) return;
      this.sound.playClick();
      this.minigame = {
        type: 'tensioner',
        progress: this.tensionerProgress,
        targetMin: 0.8,
        targetMax: 1.0,
        aligned: this.tensionerProgress >= 0.8,
        mode: 'lock',
      };
      this.updateTensionerWrenchMesh();
      this.showToast('Ringschlüssel SW 16 angesetzt — Taste/[Leertaste] im Uhrzeigersinn halten!', 'info');
      this.broadcastHud(true);
      return;
    }

    if (id === 'tensionerPinHole' && !this.pinInserted) {
      if (!this.completedSubObjectives.has('rotate_tensioner')) {
        this.sound.playError();
        this.showToast('Erst die Spannrolle mit SW 16 [4] bis ins grüne Fenster drehen!', 'warning');
        return;
      }
      if (!this.requireTool('pinT10060A')) return;

      this.pinInserted = true;
      this.wrenchHoldingTensioner = false;
      this.engine.setPinInserted(true);
      this.updateTensionerWrenchMesh();
      const pos = this.getInteractableWorldPos('tensionerPinHole');
      if (pos) {
        this.toolModels.playToolAction('pinT10060A', pos, 0.58);
      }
      this.sound.playPinLock();
      this.showToast('Spannrolle sicher mit T10060A arretiert — Riemen ist entspannt!', 'success');
      this.completeSubObjective('insert_pin', 65);
      return;
    }

    this.wrongTargetFeedback(
      this.completedSubObjectives.has('rotate_tensioner')
        ? 'Stecke jetzt den Absteckstift T10060A [5] in die fluchtende 4-mm-Bohrung.'
        : 'Setze den Ringschlüssel SW 16 [4] am Sechskant der Spannrolle an.'
    );
  }

  private handleStep6RemoveOldBelt(id: InteractableId): void {
    if (id === 'oldBelt' && !this.oldBeltRemoved) {
      if (!this.requireTool('hand')) return;
      this.oldBeltRemoved = true;
      this.engine.setBeltState('none');
      this.sound.playBeltSnap();
      this.showToast('Alten Riemen abgenommen! Prüfe jetzt Generator & Klimakompressor per Hand.', 'success');
      this.completeSubObjective('take_old_belt', 50);
      return;
    }

    if (id === 'pulley_alternator' && !this.pulleyChecked.alternator) {
      if (!this.oldBeltRemoved) {
        this.sound.playError();
        this.showToast('Nimm zuerst den alten Riemen von den Scheiben ab!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.pulleyChecked.alternator = true;
      this.engine.triggerPulleySpinCheck('alternator');
      this.sound.playBearingSpin();
      this.showToast('Generator-Freilauf (OAP) geprüft — läuft ruhig und ohne Spiel!', 'success');
      this.completeSubObjective('spin_alternator', 40);
      return;
    }

    if (id === 'pulley_ac' && !this.pulleyChecked.ac) {
      if (!this.oldBeltRemoved) {
        this.sound.playError();
        this.showToast('Nimm zuerst den alten Riemen von den Scheiben ab!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.pulleyChecked.ac = true;
      this.engine.triggerPulleySpinCheck('ac');
      this.sound.playBearingSpin();
      this.showToast('Klimakompressor-Riemenscheibe geprüft — Lager läuft einwandfrei!', 'success');
      this.completeSubObjective('spin_ac', 40);
      return;
    }

    this.wrongTargetFeedback(
      !this.oldBeltRemoved
        ? 'Nimm zuerst den alten Keilrippenriemen ab [1].'
        : 'Drehe Generator und Klimakompressor von Hand [1] zur Lagerprüfung.'
    );
  }

  private handleStep7ReplaceTensioner(id: InteractableId): void {
    if (id === 'tensionerBolt' && this.tensionerState === 'old') {
      if (!this.requireTool('ratchet13')) return;
      const pos = this.getInteractableWorldPos('tensionerBolt');
      if (pos) {
        this.toolModels.playToolAction('ratchet13', pos, 0.65);
      }
      this.sound.playRatchet();
      this.tensionerState = 'removed';
      this.pinInserted = false;
      this.tensionerProgress = 0;
      this.engine.setTensionerState('removed');
      this.engine.setPinInserted(false);
      this.showToast('Alte Spannrolle ausgebaut! Setze jetzt das Neuteil 04L 903 315 ein.', 'success');
      this.completeSubObjective('unbolt_old_tensioner', 50);
      if (this.mode === 'guide') {
        this.activeTool = 'newParts';
      }
      this.broadcastHud(true);
      return;
    }

    if (id === 'tensionerMountSlot' && this.tensionerState === 'removed') {
      if (!this.requireTool('newParts')) return;
      this.tensionerState = 'new';
      this.tensionerProgress = 0.90;
      this.pinInserted = true;
      this.engine.setTensionerState('new');
      this.engine.setTensionerProgress(0.90);
      this.engine.setPinInserted(true);
      this.sound.playSuccess();
      this.showToast('Neue Spannrolle (04L 903 315) angesetzt — jetzt mit 40 Nm anziehen!', 'success');
      this.completeSubObjective('mount_new_tensioner', 55);
      if (this.mode === 'guide') {
        this.activeTool = 'torqueWrench';
      }
      this.broadcastHud(true);
      return;
    }

    if (id === 'tensionerBolt' && this.tensionerState === 'new' && !this.tensionerTorqued) {
      if (!this.requireTool('torqueWrench')) return;
      const pos = this.getInteractableWorldPos('tensionerBolt') ?? new THREE.Vector3(0.44, 0.55, -1.32);
      this.pendingTorque = { kind: 'tensioner', worldPos: pos };
      this.minigame = {
        type: 'torque',
        targetNm: 40,
        toleranceNm: 4,
        maxNm: 65,
        currentNm: 0,
        label: 'Spannrolle 04L 903 315',
        boltLabel: 'M10-Befestigungsschraube (Soll: 40 Nm)',
        active: true,
      };
      this.sound.playClick();
      this.broadcastHud(true);
      return;
    }

    this.wrongTargetFeedback(
      this.tensionerState === 'old'
        ? 'Löse die M10-Zentralschraube mit der Knarre 13 mm [6].'
        : this.tensionerState === 'removed'
          ? 'Setze die neue Spannrolle aus dem Neuteile-Satz [8] ein.'
          : 'Ziehe die neue Spannrolle mit dem Drehmomentschlüssel [7] auf 40 Nm an.'
    );
  }

  private handleStep8InstallNewBelt(id: InteractableId): void {
    const order: BeltPulleyNode[] = ['crank', 'ac', 'alternator', 'tensioner'];
    const expectedNode = order[this.beltRoutingProgress.length];
    if (!expectedNode) return;

    const mapIdToNode: Partial<Record<InteractableId, BeltPulleyNode>> = {
      pulley_crank: 'crank',
      crankBolt: 'crank',
      pulley_ac: 'ac',
      pulley_alternator: 'alternator',
      pulley_tensioner: 'tensioner',
    };

    const clickedNode = mapIdToNode[id];
    if (!clickedNode) {
      this.wrongTargetFeedback(
        'Fädle den 6PK1025 in exakter Reihenfolge auf: Kurbelwelle → Klima → Lichtmaschine → Spannrolle!'
      );
      return;
    }

    if (!this.requireTool('newParts')) return;

    if (clickedNode !== expectedNode) {
      this.mistakes += 1;
      this.sound.playError();
      const labels: Record<BeltPulleyNode, string> = {
        crank: '1. Kurbelwelle',
        ac: '2. Klimakompressor',
        alternator: '3. Lichtmaschine',
        tensioner: '4. Spannrolle',
      };
      this.showToast(`Reihenfolge beachten! Als Nächstes: ${labels[expectedNode]}.`, 'warning');
      this.hudDirty = true;
      return;
    }

    this.beltRoutingProgress = [...this.beltRoutingProgress, clickedNode];
    this.engine.setRoutingProgress(this.beltRoutingProgress);

    if (clickedNode === 'tensioner') {
      this.newBeltInstalled = true;
      this.engine.setBeltState('new_slack');
      this.sound.playBeltSnap();
      this.showToast('Neuer 6PK1025 komplett über alle 4 Scheiben aufgelegt!', 'success');
    } else {
      this.sound.playSuccess();
    }

    this.completeSubObjective(`route_${clickedNode}`, 45);
  }

  private handleStep9ReleaseTensioner(id: InteractableId): void {
    if (id === 'tensionerHex' && !this.completedSubObjectives.has('hold_for_pin_pull')) {
      if (!this.requireTool('wrench16')) return;
      this.wrenchHoldingTensioner = true;
      this.updateTensionerWrenchMesh();
      this.sound.playClick();
      this.showToast('SW 16 hält Gegendruck — ziehe jetzt den Absteckstift T10060A [5] heraus!', 'success');
      this.completeSubObjective('hold_for_pin_pull', 40);
      if (this.mode === 'guide') {
        this.activeTool = 'pinT10060A';
      }
      this.broadcastHud(true);
      return;
    }

    if (id === 'tensionerPinHole' && this.pinInserted) {
      if (!this.completedSubObjectives.has('hold_for_pin_pull')) {
        this.sound.playError();
        this.showToast('Erst mit Ringschlüssel SW 16 [4] leicht gegenhalten, bevor der Stift gezogen wird!', 'warning');
        return;
      }
      if (!this.requireTool('pinT10060A')) return;

      this.pinInserted = false;
      this.engine.setPinInserted(false);
      const pos = this.getInteractableWorldPos('tensionerPinHole');
      if (pos) {
        this.toolModels.playToolAction('pinT10060A', pos, 0.55);
      }
      this.sound.playPinLock();
      this.completeSubObjective('pull_pin', 45);

      if (this.mode === 'guide') {
        this.activeTool = 'wrench16';
      }
      this.minigame = {
        type: 'tensioner',
        progress: this.tensionerProgress,
        targetMin: 0,
        targetMax: 0.06,
        aligned: false,
        mode: 'unlock',
      };
      this.updateTensionerWrenchMesh();
      this.showToast('Stift gezogen! Halte Taste/[Leertaste], um den Spanner kontrolliert zu entlasten.', 'info');
      this.broadcastHud(true);
      return;
    }

    if (id === 'tensionerHex' && !this.pinInserted && !this.newTensionerReleased) {
      if (!this.requireTool('wrench16')) return;
      this.minigame = {
        type: 'tensioner',
        progress: this.tensionerProgress,
        targetMin: 0,
        targetMax: 0.06,
        aligned: false,
        mode: 'unlock',
      };
      this.updateTensionerWrenchMesh();
      this.broadcastHud(true);
      return;
    }

    this.wrongTargetFeedback(
      !this.completedSubObjectives.has('hold_for_pin_pull')
        ? 'Halte die Spannrolle mit SW 16 [4] gegen.'
        : 'Ziehe jetzt den roten Absteckstift T10060A [5] aus der Spannrolle.'
    );
  }

  private handleStep10TestRun(id: InteractableId): void {
    if ((id === 'crankBolt' || id === 'pulley_crank') && !this.manualCranked) {
      if (!this.requireTool('ratchet13')) return;
      this.manualCranked = true;
      const pos = this.getInteractableWorldPos('crankBolt');
      if (pos) {
        this.toolModels.playToolAction('ratchet13', pos, 1.45);
      }
      this.engine.triggerManualCrank(2);
      this.sound.playRatchet();
      this.scheduleTimeout(() => this.sound.playRatchet(), 550);
      this.showToast(
        'Kurbelwelle 720° von Hand durchgedreht — alle 6 Rippen sitzen perfekt! Jetzt Motor starten.',
        'success'
      );
      this.completeSubObjective('manual_crank_720', 60);
      if (this.mode === 'guide') {
        this.activeTool = 'hand';
      }
      this.broadcastHud(true);
      return;
    }

    this.wrongTargetFeedback(
      !this.manualCranked
        ? 'Drehe die Kurbelwellen-Zentralschraube mit der Knarre [6] zweimal von Hand durch.'
        : 'Starte den 1.6 TDI Motor über den Start-Button im linken Bedienfeld!'
    );
  }

  private handleStep11Reassemble(id: InteractableId): void {
    // 1. Insert wheel liner + 6x T25
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

    // 2. Mount front-right wheel onto hub
    if (!this.wheelReinstalled) {
      if (id === 'wheelHub' || id === 'frontRightWheel') {
        if (!this.requireTool('hand')) return;
        this.wheelReinstalled = true;
        this.wheelRemoved = false;
        this.golf7.setWheelRemoved(false);
        // Seat all 5 lug bolts loosely ready for calibrated 120 Nm torque
        for (let i = 0; i < 5; i++) {
          this.lugBoltsRemoved[i] = false;
          this.golf7.setLugBoltRemoved(i, false);
        }
        this.sound.playSuccess();
        this.showToast('Vorderrad aufgesetzt! Ziehe die Radschrauben jetzt mit 120 Nm [7] über Kreuz an.', 'success');
        this.completeSubObjective('reinstall_wheel', 45);
        if (this.mode === 'guide') {
          this.activeTool = 'torqueWrench';
        }
        return;
      }
      this.wrongTargetFeedback('Klicke die Radnabe mit der Hand [1] an, um das Vorderrad aufzusetzen.');
      return;
    }

    // 3. Torque 5 lug bolts to 120 Nm
    if (!this.wheelBoltsTorqued.every(Boolean)) {
      if (id.startsWith('lugBolt_') || id === 'frontRightWheel') {
        if (!this.requireTool('torqueWrench')) return;
        const targetBoltId = id.startsWith('lugBolt_') ? id : 'lugBolt_0';
        const pos = this.getInteractableWorldPos(targetBoltId) ?? new THREE.Vector3(0.76, 0.32, -1.32);
        this.pendingTorque = { kind: 'wheel', worldPos: pos };
        this.minigame = {
          type: 'torque',
          targetNm: 120,
          toleranceNm: 10,
          maxNm: 165,
          currentNm: 0,
          label: 'Vorderrad rechts (über Kreuz)',
          boltLabel: '5× Radschrauben M14×1,5 (Soll: 120 Nm)',
          active: true,
        };
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback('Ziehe die Radschrauben mit dem Drehmomentschlüssel [7] auf 120 Nm fest.');
      return;
    }

    // 4. Reinstall engine cover & close hood
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

    // 5. Lower the 2-post lift
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
    const { targetNm, toleranceNm, currentNm, label } = this.minigame;
    const ctx = this.pendingTorque;

    // Require a meaningful pull (prevent accidental micro-tap from failing)
    if (currentNm < targetNm * 0.45) {
      this.minigame = { ...this.minigame, currentNm: 0 };
      this.sound.playError();
      this.showToast('Taste gedrückt halten, bis der grüne Zielbereich erreicht ist!', 'warning');
      this.broadcastHud(true);
      return;
    }

    this.sound.playTorqueClick();
    this.toolModels.playToolAction('torqueWrench', ctx.worldPos, 0.72);

    const delta = currentNm - targetNm;
    const absDelta = Math.abs(delta);
    let rating: TorqueScore['rating'];
    let scoreXp: number;

    if (absDelta <= toleranceNm * 0.5) {
      rating = 'Perfekt';
      scoreXp = 100;
    } else if (absDelta <= toleranceNm) {
      rating = 'Gut';
      scoreXp = 75;
    } else if (absDelta <= toleranceNm * 2) {
      rating = 'Akzeptabel';
      scoreXp = 45;
    } else {
      rating = 'Daneben';
      scoreXp = 15;
      this.mistakes += 1;
    }

    const scoreEntry: TorqueScore = {
      label,
      targetNm,
      achievedNm: Number(currentNm.toFixed(1)),
      deltaNm: Number(delta.toFixed(1)),
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
        `${rating}! Spannrolle mit ${scoreEntry.achievedNm} Nm (Soll ${targetNm} Nm) angezogen (+${scoreXp} XP)`,
        rating === 'Daneben' ? 'warning' : 'success'
      );
      this.completeSubObjective('torque_new_tensioner', 0);
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
        `${rating}! 5× Radschrauben über Kreuz mit ${scoreEntry.achievedNm} Nm angezogen (+${scoreXp} XP)`,
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
  // Guide Target Resolution & Beacon
  // =========================================================================

  private computeRecommendedTool(): ToolId | null {
    if (!this.started || this.completed || this.mode !== 'guide') return null;
    switch (this.stepIndex) {
      case 0:
      case 1:
      case 4:
      case 6:
        return 'hand';
      case 2:
        return this.lugBoltsRemoved.every(Boolean) ? 'hand' : 'impact17';
      case 3:
        return this.linerScrewsRemoved.every(Boolean) ? 'hand' : 'torx25';
      case 5:
        return this.completedSubObjectives.has('rotate_tensioner') ? 'pinT10060A' : 'wrench16';
      case 7:
        if (this.tensionerState === 'old') return 'ratchet13';
        if (this.tensionerState === 'removed') return 'newParts';
        return 'torqueWrench';
      case 8:
        return 'newParts';
      case 9:
        if (!this.completedSubObjectives.has('hold_for_pin_pull')) return 'wrench16';
        if (this.pinInserted) return 'pinT10060A';
        return 'wrench16';
      case 10:
        return this.manualCranked ? 'hand' : 'ratchet13';
      case 11:
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
      case 4:
        return 'oldBelt';
      case 5:
        return !this.completedSubObjectives.has('rotate_tensioner')
          ? 'tensionerHex'
          : 'tensionerPinHole';
      case 6:
        if (!this.oldBeltRemoved) return 'oldBelt';
        if (!this.pulleyChecked.alternator) return 'pulley_alternator';
        if (!this.pulleyChecked.ac) return 'pulley_ac';
        return null;
      case 7:
        if (this.tensionerState === 'old') return 'tensionerBolt';
        if (this.tensionerState === 'removed') return 'tensionerMountSlot';
        return 'tensionerBolt';
      case 8: {
        const order: BeltPulleyNode[] = ['crank', 'ac', 'alternator', 'tensioner'];
        const nextNode = order[this.beltRoutingProgress.length];
        if (!nextNode) return null;
        return `pulley_${nextNode}` as InteractableId;
      }
      case 9:
        if (!this.completedSubObjectives.has('hold_for_pin_pull')) return 'tensionerHex';
        if (this.pinInserted) return 'tensionerPinHole';
        return 'tensionerHex';
      case 10:
        return !this.manualCranked ? 'crankBolt' : null;
      case 11:
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

    // Billboard ring gently toward active camera so it's readable from any angle
    this.beaconRing.lookAt(this.sceneManager.camera.position);
    const pulse = 1 + 0.16 * Math.sin(this.beaconClock * 5.2);
    this.beaconRing.scale.setScalar(pulse);
    this.beaconDiamond.position.y = 0.065 + Math.sin(this.beaconClock * 4.5) * 0.012;
    this.beaconDiamond.rotation.y += dt * 2.2;
  }

  // =========================================================================
  // Main Loop & Updates
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

    // 3. Engine Probelauf completion check (Step 10)
    if (this.engineRunning) {
      this.engineRpm = 820 + Math.round(Math.sin(now * 0.012) * 8);
      if (
        this.started &&
        this.stepIndex === 10 &&
        this.manualCranked &&
        !this.completedSubObjectives.has('engine_idle_check')
      ) {
        this.engineRunTimer += dt;
        if (this.engineRunTimer >= 1.8) {
          this.showToast(
            '6PK1025 läuft absolut ruhig und zentriert! Motor abstellen oder direkt weiter zur Endmontage.',
            'success'
          );
          // Pause briefly or complete Step 11 cleanly while stopping engine softly
          this.stopEngineImmediate();
          this.completeSubObjective('engine_idle_check', 75);
        }
      } else if (now - this.lastHudSyncTime > 120) {
        this.hudDirty = true;
      }
    }

    // 4. Active Minigame Simulation
    this.updateMinigames(dt);

    // 5. Update Subsystems
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
    if (this.minigame.type === 'tensioner') {
      if (this.minigame.mode === 'lock') {
        if (this.tensionerPressing) {
          this.tensionerProgress = Math.min(1, this.tensionerProgress + dt * 0.72);
        } else if (this.tensionerProgress > 0 && !this.minigame.aligned) {
          this.tensionerProgress = Math.max(0, this.tensionerProgress - dt * 1.4);
        }
        const aligned = this.tensionerProgress >= 0.8;
        this.minigame = {
          ...this.minigame,
          progress: this.tensionerProgress,
          aligned,
        };
        this.engine.setTensionerProgress(this.tensionerProgress);
        this.updateTensionerWrenchMesh();
      } else {
        // mode === 'unlock': guide tensioner slowly back from 0.90 -> 0.00
        if (this.tensionerPressing) {
          this.tensionerProgress = Math.max(0, this.tensionerProgress - dt * 0.68);
          this.engine.setTensionerProgress(this.tensionerProgress);
          this.updateTensionerWrenchMesh();

          if (this.tensionerProgress <= 0.03) {
            this.tensionerProgress = 0;
            this.tensionerPressing = false;
            this.wrenchHoldingTensioner = false;
            this.newTensionerReleased = true;
            this.engine.setTensionerProgress(0);
            this.engine.setBeltState('new_tensioned');
            this.toolModels.setActiveTensionerWrench(false);
            this.minigame = { type: 'none' };
            this.sound.playBeltSnap();
            this.showToast('Spannrolle sauber zurückgeführt — der neue 6PK1025 ist gespannt!', 'success');
            this.completeSubObjective('release_slowly', 70);
            return;
          }
        }
        this.minigame = {
          ...this.minigame,
          progress: this.tensionerProgress,
          aligned: this.tensionerProgress <= 0.06,
        };
      }
      this.hudDirty = true;
    } else if (this.minigame.type === 'torque' && this.torquePressing) {
      const rate = this.minigame.targetNm > 80 ? 85 : 38;
      const nextNm = Math.min(this.minigame.maxNm, this.minigame.currentNm + rate * dt);
      this.minigame = { ...this.minigame, currentNm: nextNm };
      if (nextNm >= this.minigame.maxNm) {
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
