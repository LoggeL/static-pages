import * as THREE from 'three';
import { SoundEngine } from '../audio/SoundEngine';
import { isAtOT, wheels } from '../drive';
import { CameraController } from '../engine/CameraController';
import { OIL_CUTAWAY_LAYER, SceneManager } from '../engine/SceneManager';
import { EA288TimingEngine } from '../models/EA288TimingEngine';
import { Golf7Model } from '../models/Golf7Model';
import { ToolModels } from '../models/ToolModels';
import { WorkshopEnvironment } from '../models/WorkshopEnvironment';
import {
  AUX_DRIVE_SPEC,
  CLHA_FASTENING_STAGES,
  CLHA_LOCK_TOOLS,
  CLHA_MONTAGE_VALUES,
  CLHA_SPECIAL_TOOLS,
  CLHA_TIMING_BELT,
  CLHA_TIMING_CHECK,
  OIL_PUMP_BELT_SPEC,
  SIMULATED_TENSIONER_VARIANT,
  formatMeasure,
  formatSignedDelta,
} from '../specs/clhaSpecs';
import { CAMERA_PRESETS, REPAIR_STEPS, TOOL_DEFINITIONS } from '../steps/stepDefinitions';
import type {
  CameraPresetId,
  FasteningStageId,
  GameMode,
  GameSnapshot,
  HUDCallbacks,
  InteractableId,
  InteractableMeta,
  LockableWheelId,
  MinigameState,
  ToastMessage,
  ToolId,
  TorqueScore,
  VwBeltLayStationId,
} from '../types';
import { GameHUD } from '../ui/GameHUD';

const LIFT_RAISED_HEIGHT = 0.88;
const STAR_BOLT_ORDER = [0, 2, 4, 1, 3];
/** Official VW Golf VII 08.2015 Rep.-Gr. 15 S. 118 primary laying order (passive idlers routed in-line). */
const VW_LAY_ORDER: VwBeltLayStationId[] = ['crank', 'tensioner', 'cam', 'pump', 'water'];

interface StoredMaterialHighlight {
  emissiveHex: number;
  emissiveIntensity: number;
}

interface PendingTorqueContext {
  kind: FasteningStageId;
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

  // Physical Car / Bay Access State
  private liftRaised = false;
  private currentLiftY = 0;
  private hoodOpen = false;
  private engineCoverRemoved = false;
  private coolantTankMoved = false;
  private fuelLinesDisconnected = false;
  private fuelFilterMoved = false;
  private lugBoltsRemoved = [false, false, false, false, false];
  private wheelRemoved = false;
  private underbodyRemoved = false;
  private linerScrewsRemoved = [false, false, false, false, false, false];
  private linerRemoved = false;

  // Auxiliary Drive & Vibration Damper State (Rep.-Gr. 13)
  private auxTensionerSwung = false;
  private auxTensionerSwingDeg = 0;
  private auxPinned = false;
  private auxBeltRemoved = false;
  private crankDamperUnbolted = false;
  private crankDamperRemoved = false;

  // Engine Support Bridge 10-222 A, Engine Mount & Engine Support State (Rep.-Gr. 10 & 13)
  private engineBridgeInstalled = false;
  private upperCoverRemoved = false;
  private engineMountUnbolted = false;
  private engineMountRemoved = false;
  private engineSupportUnbolted = false;
  private engineSupportRemoved = false;

  // Lower Cover & Camshaft Timing-Drive State (Rep.-Gr. 15)
  private lowerCoverBoltRemoved = false;
  private lowerCoverRemoved = false;
  private diagramUnlocked = false;
  private crankAngleDeg = 635;
  private lockedShafts = new Set<LockableWheelId>();
  private camFixBoltLoosened = false;
  private camHubLoosened = false;
  private pumpHubPinnedOnce = false;
  private pumpHubLoosened = false;

  // Typ B Tensioner & Belt State
  private tensionNormalized = 0.50;
  private oldTensionerReleased = false;
  private tensionerPinnedTypeB = false;
  private oldBeltRemoved = false;
  private waterPumpChecked = false;
  private idlersChecked = { lower: false, upper: false };
  private sprocketsPreppedCw = false;
  private beltRoutingProgress: VwBeltLayStationId[] = [];
  private newBeltInstalled = false;
  private tensionPointerAligned = false;
  private tensionerTorqueStage1Done = false;
  private tensionerTorqued = false;
  private camPretorqued = false;
  private pumpPretorqued = false;
  private pumpTravelChecked = false;
  private locksRemovedAfterPretorque = false;

  // Timing Checks (3× 720° per VW Golf S. 120–123) & Final Torques (100 / 95 / 9 Nm)
  private check1Cranked = false;
  private check1CrankLocked = false;
  private check1CamLocked = false;
  private check1PointerOk = false;
  private check2LocksCleared = false;
  private check2Cranked = false;
  private check2CrankLocked = false;
  private check2CamLocked = false;
  private check2PointerOk = false;
  private camCenterFinalTorqued = false;
  private pumpFinalTorqued = false;
  private check3LocksCleared = false;
  private check3Cranked = false;
  private check3CrankLocked = false;
  private check3CamLocked = false;
  private check3PointerOk = false;
  private check3AllToolsRemoved = false;
  private camFixFinalTorqued = false;

  // Reassembly & Fuel Bleeding State
  private lowerCoverSeated = false;
  private lowerCoverReinstalled = false;
  private engineSupportSeated = false;
  private engineSupportStage1Done = false;
  private engineSupportReinstalled = false;
  private upperCoverReinstalled = false;
  private engineMountSeated = false;
  private engineMountReinstalled = false;
  private engineBridgeRemovedAfterReassembly = false;
  private crankDamperSeated = false;
  private crankDamperStage1Done = false;
  private crankDamperReinstalled = false;
  private auxBeltSeated = false;
  private auxTensionerHeldForUnpin = false;
  private auxBeltReinstalled = false;
  private fuelSystemBleedRequired = false;
  private fuelSystemBled = false;
  private fuelBleedInProgress = false;
  private linerSeatedInReassembly = false;
  private linerReinstalled = false;
  private underbodyReinstalled = false;
  private wheelReinstalled = false;
  private wheelTorqueDone = false;
  private wheelBoltsTorqued = [false, false, false, false, false];
  private coverHoodReinstalled = false;

  // Engine Run State
  private engineRunning = false;
  private engineRpm = 0;
  private engineRunTimer = 0;

  // Minigame State
  private minigame: MinigameState = { type: 'none' };
  private auxPressing = false;
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

    // 3D pulsing cyan guide beacon
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
      onBleedFuelSystem: () => this.triggerFuelSystemBleed(),
      onAuxPressChange: (pressing) => this.setAuxPressing(pressing),
      onOtPressChange: (pressing) => this.setOtPressing(pressing),
      onOtReset: () => this.resetOtMinigame(),
      onEccentricPressChange: (pressing) => this.setEccentricPressing(pressing),
      onEccentricReset: () => this.resetEccentricMinigame(),
      onTorquePressChange: (pressing) => this.setTorquePressing(pressing),
      onResetGame: () => this.resetGame(),
      onFreeInspect: () => this.enterFreeInspect(),
    };

    this.hud = new GameHUD(container, callbacks);

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
    this.showToast('Werkstattübersicht Golf VII 1.6 TDI — klicke Motorhaube zum Starten!', 'info');
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
        ? 'Werkstatt-Guide (16 VW-Schritte) gestartet — folge den blauen Markierungen!'
        : 'Meister-Prüfung (Profi) gestartet — echte VW-Sperren & volle Präzision!',
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
    this.xp = 0;
    this.elapsedSeconds = 0;
    this.mistakes = 0;
    this.torqueScores = [];
    this.xrayEnabled = false;
    this.golf7.setXRay(false);
    this.workLampEnabled = false;
    this.sceneManager.setWorkLamp(false);
    this.activeCamera = 'overview';
    this.resetWorldToStep(0);
    this.cameraController.setTitleOrbit(true);
    this.showToast('Werkstatt zurückgesetzt.', 'info');
    this.broadcastHud(true);
  }

  public enterFreeInspect(): void {
    this.sound.playClick();
    this.freeInspectMode = true;
    this.liftRaised = true;
    this.currentLiftY = LIFT_RAISED_HEIGHT;
    this.wheelRemoved = true;
    this.linerRemoved = true;
    this.underbodyRemoved = true;
    this.auxBeltRemoved = false;
    this.crankDamperRemoved = true;
    this.engineSupportRemoved = true;
    this.upperCoverRemoved = true;
    this.lowerCoverRemoved = true;
    this.lowerCoverBoltRemoved = true;
    this.syncAllModels(true);
    this.selectCamera('timingClose');
    this.showToast(
      'Freier Inspektionsmodus aktiv — Steuertrieb [R], Ölwanne/Ölpumpenriemen [Z] & Probelauf frei bedienbar!',
      'info'
    );
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
    const isOil = preset === 'oilSump';
    this.cameraController.setPreset(preset, this.currentLiftY);
    this.sceneManager.setOilCutawayCameraLayer(isOil);
    this.engine.setOilSumpCutaway(isOil);
    this.clearHoveredState();
    if (isOil) {
      this.showToast(
        'Schnittansicht Ölwanne (VW SSP 820433 S. 12/16): Separater Ölpumpen-Zahnriemen im Motoröl (fester Achsabstand, kein Spanner).',
        'info'
      );
    }
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

  public triggerFuelSystemBleed(): void {
    if (this.fuelSystemBled || this.fuelBleedInProgress) return;
    if (!this.freeInspectMode && this.stepIndex === 13) {
      if (this.fuelFilterMoved || this.fuelLinesDisconnected || this.coolantTankMoved) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          'Erst Kraftstofffilter, Niederdruck-Schnellkupplungen A/B und Ausgleichsbehälter wieder anschließen!',
          'warning'
        );
        this.hudDirty = true;
        return;
      }
    }

    this.fuelBleedInProgress = true;
    this.sound.playFuelPrime(1.55);
    this.showToast(
      'Diagnose aktiv (VW Rep.-Gr. 23 S. 281): Elektrische Vorförderpumpe befüllt & entlüftet das Niederdrucksystem…',
      'info'
    );
    this.broadcastHud(true);

    this.scheduleTimeout(() => {
      this.fuelBleedInProgress = false;
      this.fuelSystemBled = true;
      this.sound.playSuccess();
      this.showToast('Kraftstoffsystem vollständig befüllt & entlüftet — Hochdruckpumpe geschützt!', 'success');
      if (this.stepIndex === 13) {
        this.completeSubObjective('bleed_fuel_system', 65);
      }
      this.broadcastHud(true);
    }, 1500);
  }

  /**
   * Strict mechanical safety check before allowing 1.6 TDI startup!
   * Prevents engine start with pins inserted, missing mounts/supports/covers, open fuel lines, or unbled fuel system.
   */
  public toggleEngine(): void {
    if (this.engineRunning) {
      this.stopEngineImmediate();
      this.showToast('1.6 TDI Motor abgestellt.', 'info');
      this.broadcastHud(true);
      return;
    }

    if (this.lockedShafts.size > 0 || this.tensionerPinnedTypeB) {
      this.mistakes += 1;
      this.sound.playError();
      this.showToast(
        'STOPP! Alle Absteckwerkzeuge (T10490, 3359, T10492, T10265) müssen vor dem Start entfernt sein!',
        'error'
      );
      this.broadcastHud(true);
      return;
    }

    if (this.oldBeltRemoved && !this.newBeltInstalled) {
      this.mistakes += 1;
      this.sound.playError();
      this.showToast('STOPP! Kein Zahnriemen montiert!', 'error');
      this.broadcastHud(true);
      return;
    }

    if (!this.freeInspectMode) {
      if (this.engineMountRemoved || this.engineSupportRemoved || this.engineBridgeInstalled) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          'STOPP! Motorstart bei demontiertem Motorlager/Motorstütze oder aufgesetzter Brücke 10-222 A unzulässig!',
          'error'
        );
        this.broadcastHud(true);
        return;
      }
      if (this.upperCoverRemoved || this.lowerCoverRemoved) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          'STOPP! Erst oberen und unteren Zahnriemenschutz vollständig montieren!',
          'error'
        );
        this.broadcastHud(true);
        return;
      }
      if (this.crankDamperRemoved || this.auxBeltRemoved || this.auxPinned) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          'STOPP! Erst Schwingungsdämpfer und Keilrippenriemen montieren (T10060 A ziehen)!',
          'error'
        );
        this.broadcastHud(true);
        return;
      }
      if (this.fuelLinesDisconnected || this.fuelFilterMoved || this.coolantTankMoved) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          'STOPP! Kraftstoffleitungen, Kraftstofffilter und Ausgleichsbehälter müssen angeschlossen sein!',
          'error'
        );
        this.broadcastHud(true);
        return;
      }
      if (this.fuelSystemBleedRequired && !this.fuelSystemBled) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          'STOPP! Kraftstoffsystem wurde geöffnet — erst per Diagnose entlüften (Rep.-Gr. 23 S. 281)!',
          'error'
        );
        this.broadcastHud(true);
        return;
      }
    }

    this.engineRunning = true;
    this.engineRpm = 820;
    this.engineRunTimer = 0;
    this.engine.setEngineRunning(true, 820);
    this.sound.startDieselEngine();
    this.showToast('1.6 TDI (CLHA) gestartet — ca. 820 U/min (Spielwert), ruhiger Leerlauf. Keine Leckage, keine Warnung!', 'success');
    this.broadcastHud(true);
  }

  public setAuxPressing(pressing: boolean): void {
    if (this.minigame.type !== 'auxTensioner') {
      this.auxPressing = false;
      return;
    }
    this.auxPressing = pressing;
    if (!pressing) {
      if (this.minigame.aligned) {
        if (this.minigame.mode === 'pin') {
          this.auxTensionerSwung = true;
          this.auxTensionerSwingDeg = 32;
          this.engine.setAuxTensionerState(32, false);
          this.toolModels.setActiveEccentricKey(false);
          this.minigame = { type: 'none' };
          this.sound.playSuccess();
          this.showToast(
            `Federarm geschwenkt — Bohrung fluchtet! Stecke jetzt ${CLHA_SPECIAL_TOOLS.auxLockPin} mit [5] ein.`,
            'success'
          );
          this.completeSubObjective('swing_aux_tensioner', 55);
          if (this.mode === 'guide') {
            this.activeTool = 'lockingPins';
          }
          this.broadcastHud(true);
        } else {
          this.auxTensionerHeldForUnpin = true;
          this.auxTensionerSwingDeg = 32;
          this.engine.setAuxTensionerState(32, true);
          this.toolModels.setActiveEccentricKey(false);
          this.minigame = { type: 'none' };
          this.sound.playSuccess();
          this.showToast(
            `Federarm abgefangen — ziehe jetzt ${CLHA_SPECIAL_TOOLS.auxLockPin} mit [5] heraus!`,
            'success'
          );
          if (this.mode === 'guide') {
            this.activeTool = 'lockingPins';
          }
          this.broadcastHud(true);
        }
      } else {
        this.auxTensionerSwingDeg = this.minigame.mode === 'unpin' ? 32 : 0;
        this.engine.setAuxTensionerState(this.auxTensionerSwingDeg, this.auxPinned);
        this.minigame = { ...this.minigame, swingDeg: 0, aligned: false };
        this.showToast('Weiter gedrückt halten bis BOHRUNG FREI! erscheint.', 'info');
        this.broadcastHud(true);
      }
    }
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
          'OT (720°) im Uhrzeigersinn erreicht! NW-Mitnehmergabel, KW & HDP stehen in Absteckposition.',
          'success'
        );
        this.completeSubObjective('align_ot', 75);
        this.broadcastHud(true);
      } else if (this.crankAngleDeg > this.minigame.targetDeg + this.minigame.toleranceDeg) {
        this.sound.playError();
        this.showToast('Über OT hinausgedreht! Nutze „↺ Zurück“ und drehe im Uhrzeigersinn exakt auf 720°.', 'warning');
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
    this.minigame = { ...this.minigame, crankDeg: this.crankAngleDeg, aligned: false };
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
        this.engine.setHubSprocketSlackOffset(0, 0);
        this.engine.setBeltState('new_tensioned');
        this.toolModels.setActiveEccentricKey(false);
        this.minigame = { type: 'none' };
        this.sound.playSuccess();
        this.showToast(
          `Spannzeiger mittig im Grundplatten-Spalt! Neue Mutter jetzt mit [7] in 2 Stufen sichern: ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm, dann +${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°.`,
          'success'
        );
        this.completeSubObjective('align_tension_pointer', 80);
        if (this.mode === 'guide') {
          this.activeTool = 'torqueWrench';
        }
        this.broadcastHud(true);
      } else if (this.tensionNormalized > this.minigame.targetMax) {
        this.sound.playError();
        this.showToast('Riemen zu stramm! Klicke „↺ Entlasten“ und führe den Zeiger von links exakt in die Spaltmitte.', 'warning');
      } else {
        this.showToast('Noch zu locker — Taste gedrückt halten bis AN MARKIERUNG! erscheint.', 'info');
      }
    }
  }

  public resetEccentricMinigame(): void {
    if (this.minigame.type !== 'eccentric') return;
    this.eccentricPressing = false;
    this.tensionNormalized = 0.12;
    this.engine.setTension(this.tensionNormalized);
    this.minigame = { ...this.minigame, tension: this.tensionNormalized, aligned: false };
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
      if (this.minigame.attemptStatus === 'retry') {
        this.minigame = {
          ...this.minigame,
          lastAttemptFeedback: 'Übung läuft. Im Spielhilfefenster loslassen.',
        };
        this.hudDirty = true;
      }
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
      fuelSystemBleedRequired: this.fuelSystemBleedRequired,
      fuelSystemBled: this.fuelSystemBled,
      fuelBleedInProgress: this.fuelBleedInProgress,
      oilSumpCutawayActive: this.activeCamera === 'oilSump' || this.xrayEnabled,
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
  // 16-Step World State Synchronization
  // =========================================================================

  private resetWorldToStep(targetStep: number): void {
    this.stepIndex = targetStep;
    this.completedSubObjectives.clear();
    this.minigame = { type: 'none' };
    this.auxPressing = false;
    this.otPressing = false;
    this.eccentricPressing = false;
    this.torquePressing = false;
    this.pendingTorque = null;
    this.toolModels.setActiveCounterhold(false);
    this.toolModels.setActiveCrankWrench(false);
    this.toolModels.setActiveEccentricKey(false);

    // Step 0 -> 1: hood open, lift raised, engine cover off
    this.liftRaised = targetStep >= 1 && targetStep <= 14;
    this.currentLiftY = this.liftRaised ? LIFT_RAISED_HEIGHT : 0;
    this.hoodOpen = targetStep >= 1 && targetStep <= 14;
    this.engineCoverRemoved = targetStep >= 1 && targetStep <= 14;

    // Step 1 -> 13: bay access moved aside (reinstalled during step 13)
    const bayMoved = targetStep >= 2 && targetStep <= 13;
    this.coolantTankMoved = bayMoved;
    this.fuelLinesDisconnected = bayMoved;
    this.fuelFilterMoved = bayMoved;
    this.fuelSystemBleedRequired = targetStep >= 2;
    this.fuelSystemBled = targetStep >= 14;
    this.fuelBleedInProgress = false;

    // Step 2 -> 14: wheel, underbody, liner removed (reinstalled during step 14)
    const wheelOff = targetStep >= 3 && targetStep <= 14;
    this.lugBoltsRemoved = [wheelOff, wheelOff, wheelOff, wheelOff, wheelOff];
    this.wheelRemoved = wheelOff;
    this.underbodyRemoved = wheelOff;
    this.linerScrewsRemoved = [wheelOff, wheelOff, wheelOff, wheelOff, wheelOff, wheelOff];
    this.linerRemoved = wheelOff;

    // Step 3 -> 13: aux belt pinned/off & crank damper off (reinstalled during step 13)
    const auxOff = targetStep >= 4 && targetStep <= 13;
    this.auxTensionerSwung = auxOff;
    this.auxTensionerSwingDeg = auxOff ? 32 : 0;
    this.auxPinned = auxOff;
    this.auxBeltRemoved = auxOff;
    this.crankDamperUnbolted = auxOff;
    this.crankDamperRemoved = auxOff;

    // Step 4 -> 12: bridge 10-222 A on, upper cover off, engine mount & support off (reinstalled in step 12)
    const supportOff = targetStep >= 5 && targetStep <= 12;
    this.engineBridgeInstalled = supportOff;
    this.upperCoverRemoved = supportOff;
    this.engineMountUnbolted = supportOff;
    this.engineMountRemoved = supportOff;
    this.engineSupportUnbolted = supportOff;
    this.engineSupportRemoved = supportOff;

    // Step 5 -> 12: lower cover bolt & lower cover off (reinstalled in step 12)
    const lowerOff = targetStep >= 6 && targetStep <= 12;
    this.lowerCoverBoltRemoved = lowerOff;
    this.lowerCoverRemoved = lowerOff;
    this.diagramUnlocked = targetStep >= 6;

    // Timing-drive step-specific states (Steps 6..15)
    this.lockedShafts.clear();
    this.camFixBoltLoosened = targetStep >= 8 && targetStep <= 11;
    this.camHubLoosened = targetStep >= 8 && targetStep <= 11;
    this.pumpHubPinnedOnce = targetStep >= 8;
    this.pumpHubLoosened = targetStep >= 8 && targetStep <= 11;

    this.crankAngleDeg = targetStep >= 7 ? 720 : 635;
    this.tensionNormalized = targetStep >= 9 && targetStep <= 10 ? 0.12 : 0.50;
    this.oldTensionerReleased = targetStep >= 9;
    this.tensionerPinnedTypeB = targetStep === 9 || targetStep === 10;
    this.oldBeltRemoved = targetStep >= 9;
    this.waterPumpChecked = targetStep >= 9;
    this.idlersChecked = { lower: targetStep >= 9, upper: targetStep >= 9 };
    this.sprocketsPreppedCw = targetStep === 10;
    this.beltRoutingProgress = targetStep >= 10 ? [...VW_LAY_ORDER] : [];
    this.newBeltInstalled = targetStep >= 10;
    this.tensionPointerAligned = targetStep >= 11;
    this.tensionerTorqueStage1Done = targetStep >= 11;
    this.tensionerTorqued = targetStep >= 11;
    this.camPretorqued = targetStep >= 11;
    this.pumpPretorqued = targetStep >= 11;
    this.pumpTravelChecked = targetStep >= 11;
    this.locksRemovedAfterPretorque = targetStep >= 11;

    this.check1Cranked = targetStep >= 12;
    this.check1CrankLocked = targetStep >= 12;
    this.check1CamLocked = targetStep >= 12;
    this.check1PointerOk = targetStep >= 12;
    this.check2LocksCleared = targetStep >= 12;
    this.check2Cranked = targetStep >= 12;
    this.check2CrankLocked = targetStep >= 12;
    this.check2CamLocked = targetStep >= 12;
    this.check2PointerOk = targetStep >= 12;
    this.camCenterFinalTorqued = targetStep >= 12;
    this.pumpFinalTorqued = targetStep >= 12;
    this.check3LocksCleared = targetStep >= 12;
    this.check3Cranked = targetStep >= 12;
    this.check3CrankLocked = targetStep >= 12;
    this.check3CamLocked = targetStep >= 12;
    this.check3PointerOk = targetStep >= 12;
    this.check3AllToolsRemoved = targetStep >= 12;
    this.camFixFinalTorqued = targetStep >= 12;

    if (targetStep === 8 || targetStep === 9 || targetStep === 10) {
      this.lockedShafts = new Set(['crank', 'cam', 'pump']);
    } else {
      // Entering Step 12 (timing_check_and_final_torque): all 3 locking tools were removed at end of Step 11 (VW S. 120)!
      this.lockedShafts.clear();
    }

    // Reassembly flags
    this.lowerCoverSeated = false;
    this.lowerCoverReinstalled = targetStep >= 13;
    this.engineSupportSeated = false;
    this.engineSupportStage1Done = false;
    this.engineSupportReinstalled = targetStep >= 13;
    this.upperCoverReinstalled = targetStep >= 13;
    this.engineMountSeated = false;
    this.engineMountReinstalled = targetStep >= 13;
    this.engineBridgeRemovedAfterReassembly = targetStep >= 13;
    this.crankDamperSeated = false;
    this.crankDamperStage1Done = false;
    this.crankDamperReinstalled = targetStep >= 14;
    this.auxBeltSeated = false;
    this.auxTensionerHeldForUnpin = false;
    this.auxBeltReinstalled = targetStep >= 14;
    this.linerSeatedInReassembly = false;
    this.linerReinstalled = targetStep >= 15;
    this.underbodyReinstalled = targetStep >= 15;
    this.wheelReinstalled = targetStep >= 15;
    this.wheelTorqueDone = targetStep >= 15;
    this.wheelBoltsTorqued = [
      targetStep >= 15,
      targetStep >= 15,
      targetStep >= 15,
      targetStep >= 15,
      targetStep >= 15,
    ];
    this.coverHoodReinstalled = targetStep >= 15;

    this.syncAllModels(true);
  }

  private syncAllModels(instant: boolean): void {
    this.sceneManager.carLiftGroup.position.y = this.currentLiftY;
    this.workshop.setLiftHeight(this.currentLiftY);
    this.golf7.setStoredOffLiftY(this.currentLiftY);
    this.sceneManager.setWorkLampLiftOffset(this.currentLiftY);

    // Sync Golf 7 car & bay access
    this.golf7.setHoodOpen(this.hoodOpen, instant);
    this.golf7.setEngineCoverRemoved(this.engineCoverRemoved, instant);
    this.golf7.setCoolantTankMoved(this.coolantTankMoved, instant);
    this.golf7.setFuelLinesDisconnected(this.fuelLinesDisconnected, instant);
    this.golf7.setFuelFilterMoved(this.fuelFilterMoved, instant);
    this.golf7.setUnderbodyRemoved(
      this.underbodyRemoved,
      this.stepIndex === 14 && this.linerReinstalled && !this.underbodyReinstalled,
      instant
    );
    this.golf7.setEngineBridgeInstalled(this.engineBridgeInstalled, instant);
    this.golf7.setGhostSlotVisible(
      'engineBridgeSlot',
      this.stepIndex === 4 && !this.engineBridgeInstalled
    );
    this.golf7.setEngineMountRemoved(this.engineMountRemoved, instant);
    this.golf7.setGhostSlotVisible(
      'engineMountSlot',
      this.stepIndex === 12 &&
        this.upperCoverReinstalled &&
        this.engineMountRemoved &&
        !this.engineMountSeated
    );

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
      this.stepIndex === 14 && this.linerRemoved && !this.linerSeatedInReassembly
    );

    // Sync EA288 Timing Engine
    this.engine.setUpperTimingCoverRemoved(this.upperCoverRemoved, instant);
    this.engine.setUpperTimingCoverSlotVisible(
      this.stepIndex === 12 && this.engineSupportReinstalled && !this.upperCoverReinstalled
    );
    this.engine.setLowerCoverBoltRemoved(this.lowerCoverBoltRemoved, instant);
    this.engine.setLowerTimingCoverRemoved(this.lowerCoverRemoved, instant);
    this.engine.setLowerTimingCoverSlotVisible(
      this.stepIndex === 12 && this.lowerCoverRemoved && !this.lowerCoverSeated
    );
    this.engine.setEngineSupportRemoved(this.engineSupportRemoved, instant);
    this.engine.setEngineSupportSlotVisible(
      this.stepIndex === 12 &&
        this.lowerCoverReinstalled &&
        this.engineSupportRemoved &&
        !this.engineSupportSeated
    );
    this.engine.setCrankDamperRemoved(this.crankDamperRemoved, instant);
    this.engine.setCrankDamperSlotVisible(
      this.stepIndex === 13 && this.crankDamperRemoved && !this.crankDamperSeated
    );
    this.engine.setAuxTensionerState(this.auxTensionerSwingDeg, this.auxPinned);
    this.engine.setAuxBeltRemoved(
      this.auxBeltRemoved,
      this.stepIndex === 13 && this.crankDamperReinstalled && !this.auxBeltSeated
    );

    this.engine.setCrankAngle(this.crankAngleDeg);
    this.engine.setTension(this.tensionNormalized);
    this.engine.setTensionerPinnedTypeB(this.tensionerPinnedTypeB);
    this.engine.setLockedShafts(Array.from(this.lockedShafts));
    this.engine.setHubSprocketSlackOffset(
      this.sprocketsPreppedCw && !this.tensionPointerAligned ? -7 : 0,
      this.sprocketsPreppedCw && !this.tensionPointerAligned ? -7 : 0
    );
    this.engine.setOilSumpCutaway(this.activeCamera === 'oilSump');
    this.sceneManager.setOilCutawayCameraLayer(this.activeCamera === 'oilSump');

    if (!this.oldBeltRemoved) {
      this.engine.setBeltState('old');
    } else if (this.newBeltInstalled) {
      this.engine.setBeltState(this.tensionPointerAligned ? 'new_tensioned' : 'new_slack');
    } else if (this.stepIndex === 9 && this.sprocketsPreppedCw) {
      this.engine.setBeltState('routing');
      this.engine.setRoutingStations(this.beltRoutingProgress);
    } else {
      this.engine.setBeltState('none');
    }

    this.updateLiveTools();
  }

  private updateLiveTools(): void {
    if (this.minigame.type === 'auxTensioner') {
      const pos = this.engine.getPartWorldPos('auxTensioner');
      if (pos) {
        this.toolModels.setActiveEccentricKey(true, pos, 0.45 + (this.auxTensionerSwingDeg * Math.PI) / 180);
      }
      this.toolModels.setActiveCrankWrench(false);
    } else if (this.minigame.type === 'ot') {
      const pos = this.engine.getWheelWorldPos('crank');
      const angleRad = -((this.crankAngleDeg - 635) * Math.PI) / 180;
      this.toolModels.setActiveCrankWrench(true, pos, angleRad);
      this.toolModels.setActiveEccentricKey(false);
    } else if (this.minigame.type === 'eccentric') {
      const pos = this.engine.getWheelWorldPos('tensioner');
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

    if (this.activeCamera === 'oilSump') {
      // Isolated Oil-Sump Cutaway view renders & raycasts strictly on OIL_CUTAWAY_LAYER!
      this.raycaster.layers.set(OIL_CUTAWAY_LAYER);
      const oilHits = this.raycaster.intersectObjects([this.engine.getOilSumpCutawayRoot()], true);
      for (const hit of oilHits) {
        if (!this.isEffectivelyVisible(hit.object)) continue;
        const id = this.findInteractableId(hit.object);
        if (id) return id;
      }
      return null;
    }

    this.raycaster.layers.set(0);
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
          label: 'TDI-Motorabdeckung (EA288 CLHA)',
          partNumber: 'Gesteckt',
          status: this.engineCoverRemoved ? 'Demontiert' : 'Auf Gummizapfen gesteckt',
          hint: 'Senkrecht abziehen (Vorsicht an Kraftstoffrücklaufleitungen!)',
        };
      case 'coolantTank':
        return {
          id,
          label: 'Kühlmittel-Ausgleichsbehälter (G13)',
          partNumber: 'Rep.-Gr. 15 S. 107',
          status: this.coolantTankMoved ? 'Zur Seite geschwenkt' : 'Eingeclipst (Beifahrerseite)',
          hint: 'Stecker trennen, Rastnasen lösen & zur Seite legen [1]',
        };
      case 'fuelLines':
        return {
          id,
          label: 'Niederdruck-Kraftstoffleitungen (Kupplungen A & B)',
          partNumber: 'Niederdruck (NICHT HD!)',
          status: this.fuelLinesDisconnected ? 'Getrennt & verschlossen' : 'Angeschlossen',
          hint: 'Schnellkupplungen A & B öffnen — nach Rückbau System entlüften (Rep.-Gr. 23)',
        };
      case 'fuelFilter':
        return {
          id,
          label: 'Kraftstofffilter (Diesel)',
          partNumber: 'Rep.-Gr. 20 / 15',
          status: this.fuelFilterMoved ? 'Mit Schläuchen auf Motor abgelegt' : 'Verschraubt',
          hint: 'Lösen & mit übrigen angeschlossenen Schläuchen auf dem Motor ablegen [1]',
        };
      case 'underbodyTray':
        return {
          id,
          label: 'Geräuschdämpfung (Unterboden)',
          partNumber: 'Rep.-Gr. 66',
          status: this.underbodyRemoved ? 'Ausgebaut' : 'Montiert',
          hint: 'Zugang zum Nebenantrieb & Schwingungsdämpfer von unten',
        };
      case 'engineBridgeSlot':
        return {
          id,
          label: `Einbauposition Motorbrücke ${CLHA_SPECIAL_TOOLS.engineBridge}`,
          partNumber: 'VW Rep.-Gr. 10 S. 33',
          hint: 'Pflicht VOR Ausbau von Motorlager/Motorstütze: lastfrei an Motoröse einhängen [1]',
        };
      case 'engineBridge':
        return {
          id,
          label: `Abfangvorrichtung ${CLHA_SPECIAL_TOOLS.engineBridge}`,
          partNumber: 'VW 10-222 A',
          status: 'Trägt Aggregat lastfrei',
          hint: 'Erst nach festgezogener Motorstütze & Motorlager wieder entlasten & abnehmen!',
        };
      case 'engineMount':
      case 'engineMountSlot':
        return {
          id,
          label: 'Rechtes Motorlager (Aggregatelagerung)',
          partNumber: 'Pos. 4/6: 40 • Pos. 5: 20 • Pos. 7: 60 Nm (+90°)',
          status: this.engineMountRemoved ? 'Ausgebaut' : 'Montiert',
          hint: `VW Rep.-Gr. 10 S. 32: Neue Schrauben, ${CLHA_MONTAGE_VALUES.engineMountGapMm} mm Parallelspalt prüfen; Brücke 10-222 A Pflicht!`,
        };
      case 'engineSupport':
      case 'engineSupportSlot':
        return {
          id,
          label: 'Motorstütze am Block (3 neue Schrauben)',
          partNumber: `${CLHA_MONTAGE_VALUES.engineSupportStage1Nm} → ${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm + ${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°`,
          status: this.engineSupportRemoved ? 'Ausgebaut' : 'Montiert',
          hint: 'VW Rep.-Gr. 13 S. 53–54: Folge 1→2→3, Schraube 2 vor Einsetzen einfädeln!',
        };
      case 'auxTensioner':
        return {
          id,
          label: 'Federarm-Spanner (Keilrippenriemen)',
          partNumber: `Ringschlüssel + ${CLHA_SPECIAL_TOOLS.auxLockPin}`,
          status: this.auxPinned
            ? `Mit ${CLHA_SPECIAL_TOOLS.auxLockPin} abgesteckt`
            : 'Unter Federspannung',
          hint: 'Nebenantrieb (im Beispiel SW 16, VW S. 52 Ringschlüssel) — NICHT Zahnriemen-Exzenter!',
        };
      case 'auxLockPin':
        return {
          id,
          label: `Absteckstift ${CLHA_SPECIAL_TOOLS.auxLockPin} (Nebenriemen)`,
          partNumber: `VW ${CLHA_SPECIAL_TOOLS.auxLockPin}`,
          status: 'Gesteckt',
          hint: 'Hält Federarm entspannt; nach Riemenmontage mit Ringschlüssel halten & ziehen',
        };
      case 'auxBelt':
      case 'auxBeltSlot':
        return {
          id,
          label: 'Keilrippenriemen (6PK Nebenantrieb)',
          partNumber: 'Rep.-Gr. 13 S. 52',
          status: this.auxBeltRemoved ? 'Demontiert' : 'Montiert',
          hint: AUX_DRIVE_SPEC.routingOrder,
        };
      case 'crankDamper':
      case 'crankDamperSlot':
        return {
          id,
          label: 'Schwingungsdämpfer KW (4× außen)',
          partNumber: `${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°`,
          status: this.crankDamperRemoved ? 'Ausgebaut' : 'Montiert',
          hint: 'Ausrichtbohrung über Nocken am KW-Zahnriemenrad (4 neue äußere Schrauben)',
        };
      case 'upperTimingCover':
      case 'upperTimingCoverSlot':
        return {
          id,
          label: 'Oberer Zahnriemenschutz (geklipst)',
          partNumber: 'Rep.-Gr. 15 S. 107',
          status: this.upperCoverRemoved ? 'Demontiert' : 'Eingeclipst',
          hint: 'Rastnasen lösen, Sensor-/Differenzdruckleitungen ausklipsen',
        };
      case 'lowerCoverBolt':
        return {
          id,
          label: 'Unterer Zahnriemenschutz — Bundschraube',
          partNumber: `Montage: ${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm`,
          status: this.lowerCoverBoltRemoved ? 'Gelöst' : `Unverlierbare Bundschraube (${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm)`,
        };
      case 'lowerTimingCover':
      case 'lowerTimingCoverSlot':
        return {
          id,
          label: 'Unterer Zahnriemenschutz',
          partNumber: `Bundschraube ${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm`,
          status: this.lowerCoverRemoved ? 'Demontiert' : 'Montiert',
          hint: 'Passstift bei Montage beachten (Rep.-Gr. 15 S. 111–112)',
        };
      case 'oilPumpBelt':
        return {
          id,
          label: OIL_PUMP_BELT_SPEC.title,
          partNumber: 'SSP 820433 S. 12/16',
          status: OIL_PUMP_BELT_SPEC.shortLabel,
          hint: 'Separater Antrieb in der Ölwanne (kein Spanner) — beim Nockenwellen-Zahnriemenwechsel nicht öffnen!',
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
          partNumber: `Montage: ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
          status: this.lugBoltsRemoved[idx]
            ? 'Gelöst'
            : this.wheelBoltsTorqued[idx]
              ? `Angezogen: ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`
              : `Serienrad, je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
        };
      }
      case 'frontRightWheel':
        return {
          id,
          label: 'Serienrad vorne rechts (17" VW Dijon)',
          partNumber: `5× ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm`,
          status: this.wheelRemoved ? 'Auf Reifenständer' : 'Auf Radnabe',
        };
      case 'wheelHub':
        return {
          id,
          label: 'Radnabe & Bremsscheibe VR',
          hint: this.stepIndex === 14 && this.wheelRemoved ? 'Klicken um Serienrad aufzusetzen [1]' : undefined,
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
          label: `Radhausschale T25 #${idx + 1}`,
          partNumber: `Montage: ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm`,
          status: this.linerScrewsRemoved[idx] ? 'Entfernt' : `je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm`,
        };
      }
      case 'wheelLiner':
      case 'wheelLinerSlot':
        return {
          id,
          label: 'Radhausschale vorne rechts',
          partNumber: `6× T25 • je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm`,
          status: this.linerRemoved ? 'Ausgebaut' : 'Montiert',
        };
      case 'oldTimingBelt':
        return {
          id,
          label: 'Alter Zahnriemen (EA288 CLHA)',
          partNumber: CLHA_TIMING_BELT.shortSpec,
          status: this.tensionerPinnedTypeB ? 'Entspannt (Typ B abgesteckt)' : 'Unter Spannung',
          hint: 'Abnehmen beginnend an der Kühlmittelpumpe (VW S. 116)',
        };
      case 'newTimingBeltSlot':
        return {
          id,
          label: 'Zahnriemen-Führungsspur (VW-Folge 1–5)',
          partNumber: CLHA_TIMING_BELT.shortSpec,
          hint: CLHA_TIMING_BELT.vwLaySequenceText,
        };
      case 'wheel_crank':
        return {
          id,
          label: 'Kurbelwellenrad (KW)',
          partNumber: `Stopp ${CLHA_LOCK_TOOLS.crank.code}`,
          status: this.lockedShafts.has('crank')
            ? `Mit ${CLHA_LOCK_TOOLS.crank.code} im Dichtflansch arretiert`
            : isAtOT(this.crankAngleDeg, 4)
              ? `OT (${CLHA_TIMING_CHECK.crankDegrees}°)`
              : `Winkel ${Math.round(this.crankAngleDeg)}°`,
          hint: CLHA_LOCK_TOOLS.crank.engagementDesc,
        };
      case 'wheel_lower':
        return {
          id,
          label: 'Untere Umlenkrolle (passiv)',
          partNumber: `Ref.: ${CLHA_MONTAGE_VALUES.idlerNutNm} Nm`,
          status: this.idlersChecked.lower ? 'Lagerprüfung OK' : 'Lagerprüfung',
        };
      case 'wheel_tensioner':
        return {
          id,
          label: `Exzenter-Spannrolle (${SIMULATED_TENSIONER_VARIANT.code})`,
          partNumber: `${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}° • kalt`,
          status: this.tensionerPinnedTypeB
            ? `Abgesteckt (${CLHA_SPECIAL_TOOLS.tensionerPinTypeB})`
            : Math.abs(this.tensionNormalized - 0.5) <= 0.04
              ? 'Zeiger mittig im Spalt (kalt)'
              : 'Ausrichten',
          hint: `${SIMULATED_TENSIONER_VARIANT.shortLabel} • Sitzzunge in Gussnut • Typ A nutzt ${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeA} ohne ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB}`,
        };
      case 'tensionerNut':
        return {
          id,
          label: 'Spannrollen-Mutter (erneuern)',
          partNumber: `${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
          status: this.tensionerTorqued
            ? `Angezogen: ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`
            : this.tensionerTorqueStage1Done
              ? `Voranzug ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm OK • +${CLHA_MONTAGE_VALUES.tensionerAngleDeg}° offen`
              : `Voranzug ${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm, dann +${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°`,
        };
      case 'tensionerLockPin':
        return {
          id,
          label: `Absteckstift ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} (Spannrolle Typ B)`,
          partNumber: `VW ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB}`,
          status: 'Gesteckt',
          hint: 'Vor dem Spannen mit [5] herausziehen',
        };
      case 'wheel_cam':
        return {
          id,
          label: 'Nockenwellenrad (NW • Langlöcher + Mitnehmer)',
          partNumber: `Dorn ${CLHA_LOCK_TOOLS.cam.code}`,
          status: this.lockedShafts.has('cam')
            ? `Mit ${CLHA_LOCK_TOOLS.cam.code} durch Mitnehmer-Gabel arretiert`
            : this.camHubLoosened && !this.camPretorqued
              ? 'Im Langloch frei beweglich'
              : 'Dreht 2:1 zur KW',
          hint: CLHA_LOCK_TOOLS.cam.engagementDesc,
        };
      case 'camCenterBolt':
        return {
          id,
          label: 'NW-Zentralschraube',
          partNumber: `${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} → ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm`,
          status: this.camCenterFinalTorqued
            ? `Endanzug ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm OK`
            : this.camPretorqued
              ? `Voranzug ${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm OK`
              : this.camHubLoosened
                ? 'Angelöst (Langloch frei)'
                : 'Fest',
          hint: `Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} — beim Lösen & Endanzug Dorn ${CLHA_LOCK_TOOLS.cam.code} vorher ziehen!`,
        };
      case 'camFixBolt':
        return {
          id,
          label: 'Kleine NW-Fixierschraube (Langloch)',
          partNumber: `½ Umdr. / ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm`,
          status: this.camFixFinalTorqued
            ? `Endanzug ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm OK`
            : this.camFixBoltLoosened
              ? '½ Umdr. gelöst (mittig im Langloch)'
              : 'Fest',
        };
      case 'wheel_upper':
        return {
          id,
          label: 'Obere Umlenkrolle (passiv)',
          partNumber: `Ref.: ${CLHA_MONTAGE_VALUES.idlerBoltNm} Nm`,
          status: this.idlersChecked.upper ? 'Lagerprüfung OK' : 'Lagerprüfung',
        };
      case 'wheel_pump':
        return {
          id,
          label: 'Hochdruckpumpenrad (HDP • Langloch + Naben-Gabel)',
          partNumber: `Dorn ${CLHA_LOCK_TOOLS.pump.code}`,
          status: this.lockedShafts.has('pump')
            ? `Mit ${CLHA_LOCK_TOOLS.pump.code} durch Naben-Gabel arretiert`
            : this.pumpHubLoosened && !this.pumpPretorqued
              ? 'Im Langloch frei beweglich'
              : 'Synchron zur KW',
          hint: `${CLHA_LOCK_TOOLS.pump.engagementDesc} (VW S. 121: leichte Abweichung bei Nachprüfung zulässig)`,
        };
      case 'pumpCenterNut':
        return {
          id,
          label: 'HDP-Zentralmutter',
          partNumber: `${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} → ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm`,
          status: this.pumpFinalTorqued
            ? `Endanzug ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm OK`
            : this.pumpPretorqued
              ? `Voranzug ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm OK`
              : this.pumpHubLoosened
                ? 'Um ~90° gelöst'
                : 'Fest',
          hint: `Beim Lösen & 95-Nm-Endanzug Gegenhalter ${CLHA_SPECIAL_TOOLS.pumpCounterhold} (Dorn ${CLHA_LOCK_TOOLS.pump.code} gezogen)!`,
        };
      case 'wheel_water':
        return {
          id,
          label: 'Kühlmittelpumpe (schaltbar)',
          partNumber: `Ref.: ${CLHA_MONTAGE_VALUES.waterPumpHousingBoltsCount}× ${CLHA_MONTAGE_VALUES.waterPumpHousingTorqueNm} Nm+${CLHA_MONTAGE_VALUES.waterPumpHousingAngleDeg}°`,
          status: this.waterPumpChecked ? 'Sicht-/Lagerprüfung OK' : 'Zuletzt auflegen (Station 5)',
          hint: 'Neue trockene Wasserpumpe vor Einbau niemals trocken drehen!',
        };
      case 'lockPin_crank':
        return {
          id,
          label: CLHA_LOCK_TOOLS.crank.name,
          partNumber: `VW ${CLHA_LOCK_TOOLS.crank.code}`,
          status: 'Gesteckt (im Dichtflansch)',
          hint: 'Mit Abstecksatz [5] herausziehen',
        };
      case 'lockPin_cam':
        return {
          id,
          label: CLHA_LOCK_TOOLS.cam.name,
          partNumber: `VW ${CLHA_LOCK_TOOLS.cam.code}`,
          status: 'Gesteckt (Mitnehmer-Gabel → Zylinderkopf)',
          hint: 'VOR Lösen/Anziehen der NW-Zentralschraube immer ziehen [5]!',
        };
      case 'lockPin_pump':
        return {
          id,
          label: CLHA_LOCK_TOOLS.pump.name,
          partNumber: `VW ${CLHA_LOCK_TOOLS.pump.code}`,
          status: 'Gesteckt (Naben-Gabel → Aggregateträger)',
          hint: 'VOR Lösen/Anziehen der HDP-Mutter immer ziehen [5]!',
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
        if (this.minigame.type === 'auxTensioner') {
          this.setAuxPressing(true);
        } else if (this.minigame.type === 'ot') {
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
      if (this.minigame.type === 'auxTensioner') {
        this.setAuxPressing(false);
      } else if (this.minigame.type === 'ot') {
        this.setOtPressing(false);
      } else if (this.minigame.type === 'eccentric') {
        this.setEccentricPressing(false);
      } else if (this.minigame.type === 'torque') {
        this.setTorquePressing(false);
      }
    }
  }

  // =========================================================================
  // 16-Step Authentic Golf VII CLHA State Machine
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
      this.showToast('Zahnriemenwechsel nach VW-Leitfaden erfolgreich bestanden! Meister-Zertifikat erstellt.', 'success');
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

    // Anytime educational inspection of the separate Oil-Bath Oil/Vacuum Pump Belt (VW SSP 820433)
    if (id === 'oilPumpBelt') {
      this.sound.playClick();
      this.showToast(
        'Ölpumpen-Zahnriemen im Ölbad (SSP 820433 S. 12/16): Separater Antrieb mit festem Achsabstand (kein Spanner) — beim normalen Zahnriemenwechsel nicht öffnen!',
        'info'
      );
      return;
    }

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
        this.engine.triggerManualCrank720(720);
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
        this.handleStep1BayAccess(id);
        break;
      case 2:
        this.handleStep2WheelUnderbody(id);
        break;
      case 3:
        this.handleStep3AuxBeltDamper(id);
        break;
      case 4:
        this.handleStep4EngineSupportBridge(id);
        break;
      case 5:
        this.handleStep5LowerCoverInspect(id);
        break;
      case 6:
        this.handleStep6FindOt(id);
        break;
      case 7:
        this.handleStep7LockAndLoosenHubs(id);
        break;
      case 8:
        this.handleStep8RemoveOldBelt(id);
        break;
      case 9:
        this.handleStep9InstallNewBelt(id);
        break;
      case 10:
        this.handleStep10SetTensionAndPretorque(id);
        break;
      case 11:
        this.handleStep11TimingCheckAndFinalTorque(id);
        break;
      case 12:
        this.handleStep12ReassembleCoversMounts(id);
        break;
      case 13:
        this.handleStep13ReassembleAuxFuelBleed(id);
        break;
      case 14:
        this.handleStep14ReassembleWheelBody(id);
        break;
      case 15:
        this.showToast('Starte den 1.6 TDI EA288 im linken Bedienfeld für den abschließenden Probelauf!', 'info');
        break;
    }
  }

  // Step 1: Hood, Lift & TDI Cover
  private handleStep0PrepLift(id: InteractableId): void {
    if (id === 'hood' && !this.hoodOpen) {
      if (!this.requireTool('hand')) return;
      this.hoodOpen = true;
      this.golf7.setHoodOpen(true);
      this.sound.playSuccess();
      this.showToast('Motorhaube geöffnet!', 'success');
      this.completeSubObjective('open_hood', 35);
      return;
    }
    if (id === 'liftControlUp' && !this.liftRaised) {
      if (!this.requireTool('hand')) return;
      this.liftRaised = true;
      this.sound.playLiftMotor(2.0);
      this.showToast('Hebebühne fährt auf Arbeitshöhe — ziehe danach die TDI-Motorabdeckung ab [1]!', 'success');
      this.completeSubObjective('raise_lift', 35);
      if (this.hoodOpen) {
        this.scheduleTimeout(() => {
          if (this.stepIndex === 0 && !this.engineCoverRemoved) this.selectCamera('engineTop');
        }, 700);
      }
      return;
    }
    if (id === 'engineCover' && !this.engineCoverRemoved) {
      if (!this.hoodOpen) {
        this.sound.playError();
        this.showToast('Öffne zuerst die Motorhaube!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.engineCoverRemoved = true;
      this.golf7.setEngineCoverRemoved(true);
      this.sound.playSuccess();
      this.showToast('Gesteckte TDI-Motorabdeckung senkrecht abgezogen (Rücklaufleitungen unbeschädigt)!', 'success');
      this.completeSubObjective('remove_cover', 40);
      return;
    }
    this.wrongTargetFeedback('Öffne die Motorhaube, fahre die Bühne hoch und ziehe die TDI-Motorabdeckung ab [1].');
  }

  // Step 2: Coolant Tank, Low-Pressure Quick-Couplings A/B & Fuel Filter
  private handleStep1BayAccess(id: InteractableId): void {
    if (id === 'coolantTank' && !this.coolantTankMoved) {
      if (!this.requireTool('hand')) return;
      this.coolantTankMoved = true;
      this.golf7.setCoolantTankMoved(true);
      this.sound.playSuccess();
      this.showToast('Stecker getrennt & Kühlmittel-Ausgleichsbehälter zur Seite geschwenkt!', 'success');
      this.completeSubObjective('move_coolant_tank', 45);
      return;
    }
    if (id === 'fuelLines' && !this.fuelLinesDisconnected) {
      if (!this.requireTool('hand')) return;
      this.fuelLinesDisconnected = true;
      this.fuelSystemBleedRequired = true;
      this.golf7.setFuelLinesDisconnected(true);
      this.sound.playSuccess();
      this.showToast(
        'Niederdruck-Schnellkupplungen A & B getrennt & verschlossen (NICHT Hochdruckleitungen)! Später Entlüften Pflicht.',
        'success'
      );
      this.completeSubObjective('disconnect_fuel_lines', 50);
      return;
    }
    if (id === 'fuelFilter' && !this.fuelFilterMoved) {
      if (!this.fuelLinesDisconnected) {
        this.sound.playError();
        this.showToast('Trenne zuerst die Niederdruck-Schnellkupplungen A & B [1]!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.fuelFilterMoved = true;
      this.golf7.setFuelFilterMoved(true);
      this.sound.playSuccess();
      this.showToast('Kraftstofffilter mit übrigen angeschlossenen Schläuchen auf dem Motor abgelegt!', 'success');
      this.completeSubObjective('move_fuel_filter', 45);
      return;
    }
    this.wrongTargetFeedback(
      'Schwenke Ausgleichsbehälter zur Seite, trenne Niederdruck-Kupplungen A/B und lege den Kraftstofffilter ab [1].'
    );
  }

  // Step 3: Wheel, Underbody Noise Insulation & Wheel Arch Liner
  private handleStep2WheelUnderbody(id: InteractableId): void {
    if (id.startsWith('lugBolt_')) {
      const idx = Number(id.split('_')[1]);
      if (this.lugBoltsRemoved[idx]) return;
      if (!this.requireTool('impact17')) return;
      this.lugBoltsRemoved[idx] = true;
      this.golf7.setLugBoltRemoved(idx, true);
      const pos = this.getInteractableWorldPos(id);
      if (pos) this.toolModels.playToolAction('impact17', pos, 0.45);
      this.sound.playImpactWrench();
      if (this.lugBoltsRemoved.every(Boolean)) {
        this.completeSubObjective('unbolt_lugs', 60);
        if (this.mode === 'guide') this.activeTool = 'hand';
      } else {
        this.hudDirty = true;
      }
      return;
    }
    if (id === 'frontRightWheel' && !this.wheelRemoved) {
      if (!this.lugBoltsRemoved.every(Boolean)) {
        this.sound.playError();
        this.showToast('Erst alle 5 Radschrauben SW 17 [2] lösen!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.wheelRemoved = true;
      this.golf7.setWheelRemoved(true);
      this.sound.playSuccess();
      this.showToast('Serienrad abgenommen! Jetzt Geräuschdämpfung (Unterboden) & Radhausschale mit T25 [3] lösen.', 'success');
      this.completeSubObjective('take_off_wheel', 45);
      if (this.mode === 'guide') this.activeTool = 'torx25';
      return;
    }
    if (id === 'underbodyTray' && !this.underbodyRemoved) {
      if (!this.requireTool('torx25')) return;
      this.underbodyRemoved = true;
      this.golf7.setUnderbodyRemoved(true, false);
      const pos = this.getInteractableWorldPos('underbodyTray');
      if (pos) this.toolModels.playToolAction('torx25', pos, 0.45);
      this.sound.playScrewdriver();
      this.showToast('Geräuschdämpfung (Unterboden) abgeschraubt & abgenommen!', 'success');
      this.completeSubObjective('remove_underbody', 45);
      return;
    }
    if (id.startsWith('linerScrew_')) {
      const idx = Number(id.split('_')[1]);
      if (this.linerScrewsRemoved[idx]) return;
      if (!this.requireTool('torx25')) return;
      this.linerScrewsRemoved[idx] = true;
      this.golf7.setLinerScrewRemoved(idx, true);
      const pos = this.getInteractableWorldPos(id);
      if (pos) this.toolModels.playToolAction('torx25', pos, 0.40);
      this.sound.playScrewdriver();
      if (this.linerScrewsRemoved.every(Boolean)) {
        this.completeSubObjective('unscrew_liner_all', 60);
        if (this.mode === 'guide') this.activeTool = 'hand';
      } else {
        this.hudDirty = true;
      }
      return;
    }
    if (id === 'wheelLiner' && !this.linerRemoved) {
      if (!this.linerScrewsRemoved.every(Boolean)) {
        this.sound.playError();
        this.showToast('Erst alle 6 Torx-T25-Schrauben [3] der Radhausschale herausdrehen!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.linerRemoved = true;
      this.golf7.setLinerRemoved(true);
      this.sound.playSuccess();
      this.showToast('Radhausschale entfernt — der Nebenantrieb (Keilrippenriemen) liegt frei!', 'success');
      this.completeSubObjective('take_off_liner', 45);
      return;
    }
    this.wrongTargetFeedback('Löse Rad [2]/[1], Geräuschdämpfung [3] und Radhausschale (6× T25 [3], dann [1]).');
  }

  // Step 4: Poly-V Auxiliary Belt (Spring-Arm + T10060 A) & Crank Vibration Damper
  private handleStep3AuxBeltDamper(id: InteractableId): void {
    if (id === 'auxTensioner' && !this.auxTensionerSwung) {
      if (!this.requireTool('eccentricKey')) return;
      this.sound.playClick();
      this.minigame = {
        type: 'auxTensioner',
        swingDeg: 0,
        targetMinDeg: 28,
        targetMaxDeg: 36,
        aligned: false,
        mode: 'pin',
      };
      this.updateLiveTools();
      this.showToast(
        'Ringschlüssel am Federarm des Keilrippenriemens angesetzt (im Beispiel SW 16) — gedrückt halten!',
        'info'
      );
      this.broadcastHud(true);
      return;
    }

    if ((id === 'auxTensioner' || id === 'auxLockPin') && this.auxTensionerSwung && !this.auxPinned) {
      if (!this.requireTool('lockingPins')) return;
      this.auxPinned = true;
      this.engine.setAuxTensionerState(32, true);
      const pos = this.engine.getPartWorldPos('auxTensioner');
      if (pos) this.toolModels.playToolAction('lockingPins', pos, 0.48);
      this.sound.playPinLock();
      this.showToast(
        `Spannvorrichtung mit ${CLHA_SPECIAL_TOOLS.auxLockPin} gesichert! Nimm jetzt den Keilrippenriemen ab [1].`,
        'success'
      );
      this.completeSubObjective('pin_aux_tensioner', 50);
      if (this.mode === 'guide') this.activeTool = 'hand';
      return;
    }

    if (id === 'auxBelt' && !this.auxBeltRemoved) {
      if (!this.auxPinned) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          `Erst Federarm mit Ringschlüssel [6] schwenken und mit ${CLHA_SPECIAL_TOOLS.auxLockPin} [5] abstecken!`,
          'error'
        );
        this.hudDirty = true;
        return;
      }
      if (!this.requireTool('hand')) return;
      this.auxBeltRemoved = true;
      this.engine.setAuxBeltRemoved(true, false);
      this.sound.playBeltSnap();
      this.showToast(
        'Keilrippenriemen (Laufrichtung markiert) abgenommen! Löse jetzt die 4 Schrauben am Schwingungsdämpfer [2].',
        'success'
      );
      this.completeSubObjective('remove_aux_belt', 50);
      if (this.mode === 'guide') this.activeTool = 'impact17';
      return;
    }

    if (id === 'crankDamper' && !this.crankDamperRemoved) {
      if (!this.auxBeltRemoved) {
        this.sound.playError();
        this.showToast('Erst den Keilrippenriemen [1] abnehmen, bevor der Schwingungsdämpfer gelöst wird!', 'warning');
        return;
      }
      if (!this.crankDamperUnbolted) {
        if (!this.requireTool('impact17')) return;
        this.crankDamperUnbolted = true;
        const pos = this.engine.getPartWorldPos('crankDamper');
        if (pos) this.toolModels.playToolAction('impact17', pos, 0.55);
        this.sound.playImpactWrench();
        this.showToast('4 äußere M10-Schrauben am Schwingungsdämpfer gelöst — nimm ihn jetzt mit [1] ab!', 'info');
        if (this.mode === 'guide') this.activeTool = 'hand';
        this.hudDirty = true;
        return;
      }
      if (!this.requireTool('hand')) return;
      this.crankDamperRemoved = true;
      this.engine.setCrankDamperRemoved(true);
      this.sound.playSuccess();
      this.showToast('Kurbelwellen-Schwingungsdämpfer abgenommen! Weiter oben zur Motorbrücke 10-222 A.', 'success');
      this.completeSubObjective('remove_crank_damper', 55);
      return;
    }

    this.wrongTargetFeedback(
      !this.auxTensionerSwung
        ? 'Schwenke den Federarm-Spanner am Keilrippenriemen mit dem Spannschlüssel [6].'
        : !this.auxPinned
          ? `Stecke den geschwenkten Federarm mit ${CLHA_SPECIAL_TOOLS.auxLockPin} [5] ab.`
          : !this.auxBeltRemoved
            ? 'Nimm den entspannten Keilrippenriemen mit der Hand [1] ab.'
            : !this.crankDamperUnbolted
              ? 'Löse die 4 äußeren Schrauben am Schwingungsdämpfer mit [2].'
              : 'Nimm den Schwingungsdämpfer mit der Hand [1] ab.'
    );
  }

  // Step 5: VW Engine Support Bridge 10-222 A (STRICT GATE!), Upper Timing Cover, Engine Mount & Engine Support
  private handleStep4EngineSupportBridge(id: InteractableId): void {
    // STRICT VW SAFETY GATE: Cannot touch engineMount or engineSupport without 10-222 A installed!
    if ((id === 'engineMount' || id === 'engineSupport') && !this.engineBridgeInstalled) {
      this.mistakes += 1;
      this.sound.playError();
      this.showToast(
        `STOPP! Motor erst mit Abfangvorrichtung ${CLHA_SPECIAL_TOOLS.engineBridge} [1] lastfrei abfangen, bevor Motorlager oder Motorstütze gelöst werden!`,
        'error'
      );
      this.hudDirty = true;
      return;
    }

    if (id === 'engineBridgeSlot' && !this.engineBridgeInstalled) {
      if (!this.requireTool('hand')) return;
      this.engineBridgeInstalled = true;
      this.golf7.setEngineBridgeInstalled(true);
      this.golf7.setGhostSlotVisible('engineBridgeSlot', false);
      this.sound.playSuccess();
      this.showToast(
        `Abfangvorrichtung ${CLHA_SPECIAL_TOOLS.engineBridge} über die Kotflügelauflagen gesetzt & lastfrei an der Motoröse verspannt!`,
        'success'
      );
      this.completeSubObjective('mount_engine_bridge', 65);
      return;
    }

    if (id === 'upperTimingCover' && !this.upperCoverRemoved) {
      if (!this.requireTool('hand')) return;
      this.upperCoverRemoved = true;
      this.engine.setUpperTimingCoverRemoved(true);
      this.sound.playSuccess();
      this.showToast(
        'Rastnasen & Sensorclips gelöst — oberen Zahnriemenschutz abgenommen! Jetzt rechtes Motorlager lösen [4].',
        'success'
      );
      this.completeSubObjective('remove_upper_cover', 50);
      if (this.mode === 'guide') this.activeTool = 'crankWrench';
      return;
    }

    if (id === 'engineMount' && !this.engineMountRemoved) {
      if (!this.engineMountUnbolted) {
        if (!this.requireTool('crankWrench')) return;
        this.engineMountUnbolted = true;
        const pos = this.golf7.getPartWorldPos('engineMount');
        if (pos) this.toolModels.playToolAction('crankWrench', pos, 0.55);
        this.sound.playRatchet();
        this.showToast('Schrauben am rechten Motorlager gelöst — hebe das Motorlager mit [1] heraus!', 'info');
        if (this.mode === 'guide') this.activeTool = 'hand';
        this.hudDirty = true;
        return;
      }
      if (!this.requireTool('hand')) return;
      this.engineMountRemoved = true;
      this.golf7.setEngineMountRemoved(true);
      this.sound.playSuccess();
      this.showToast('Rechtes Motorlager ausgebaut! Jetzt Motorstütze (3 Schrauben) am Block lösen [4].', 'success');
      this.completeSubObjective('remove_engine_mount', 55);
      if (this.mode === 'guide') this.activeTool = 'crankWrench';
      this.selectCamera('timingClose');
      return;
    }

    if (id === 'engineSupport' && !this.engineSupportRemoved) {
      if (!this.engineMountRemoved) {
        this.sound.playError();
        this.showToast('Baue zuerst das rechte Motorlager aus!', 'warning');
        return;
      }
      if (!this.engineSupportUnbolted) {
        if (!this.requireTool('crankWrench')) return;
        this.engineSupportUnbolted = true;
        const pos = this.engine.getPartWorldPos('engineSupport');
        if (pos) this.toolModels.playToolAction('crankWrench', pos, 0.55);
        this.sound.playRatchet();
        this.showToast('3 Schrauben der Motorstütze gelöst — nimm die Motorstütze mit [1] heraus!', 'info');
        if (this.mode === 'guide') this.activeTool = 'hand';
        this.hudDirty = true;
        return;
      }
      if (!this.requireTool('hand')) return;
      this.engineSupportRemoved = true;
      this.engine.setEngineSupportRemoved(true);
      this.sound.playSuccess();
      this.showToast('Motorstütze herausgenommen — der untere Zahnriemenschutz liegt frei!', 'success');
      this.completeSubObjective('remove_engine_support', 60);
      return;
    }

    this.wrongTargetFeedback(
      !this.engineBridgeInstalled
        ? `Setze ZUERST die Abfangvorrichtung ${CLHA_SPECIAL_TOOLS.engineBridge} auf [1]!`
        : !this.upperCoverRemoved
          ? 'Nimm den oberen Zahnriemenschutz mit der Hand [1] ab.'
          : !this.engineMountRemoved
            ? this.engineMountUnbolted
              ? 'Hebe das gelöste Motorlager mit [1] heraus.'
              : 'Löse die Schrauben des rechten Motorlagers mit [4].'
            : this.engineSupportUnbolted
              ? 'Nimm die gelöste Motorstütze mit [1] heraus.'
              : 'Löse die 3 Schrauben der Motorstütze mit [4].'
    );
  }

  // Step 6: Lower Timing Cover (12 Nm Captive Bolt) & Inspect Belt
  private handleStep5LowerCoverInspect(id: InteractableId): void {
    if (id === 'lowerCoverBolt' && !this.lowerCoverBoltRemoved) {
      if (!this.requireTool('torx25')) return;
      this.lowerCoverBoltRemoved = true;
      this.engine.setLowerCoverBoltRemoved(true);
      const pos = this.engine.getPartWorldPos('lowerCoverBolt');
      if (pos) this.toolModels.playToolAction('torx25', pos, 0.45);
      this.sound.playScrewdriver();
      this.showToast(
        `Unverlierbare Bundschraube gelöst (Einbauwert ${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm) — nimm unteren Schutz ab [1]!`,
        'success'
      );
      this.completeSubObjective('unbolt_lower_cover', 40);
      if (this.mode === 'guide') this.activeTool = 'hand';
      return;
    }

    if (id === 'lowerTimingCover' && !this.lowerCoverRemoved) {
      if (!this.lowerCoverBoltRemoved) {
        this.sound.playError();
        this.showToast('Löse zuerst die unverlierbare Bundschraube am unteren Schutz mit [3]!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      this.lowerCoverRemoved = true;
      this.engine.setLowerTimingCoverRemoved(true);
      this.sound.playSuccess();
      this.showToast('Unterer Zahnriemenschutz abgenommen — inspiziere jetzt den alten Zahnriemen [1]!', 'success');
      this.completeSubObjective('remove_lower_cover', 45);
      return;
    }

    if (this.lowerCoverRemoved && (id === 'oldTimingBelt' || id.startsWith('wheel_'))) {
      if (!this.requireTool('hand')) return;
      this.diagramUnlocked = true;
      this.sound.playSuccess();
      this.showToast(
        'EA288-Steuertrieb inspiziert & VW-Schema (Folge 1–5) freigeschaltet! (Ölpumpenriemen jederzeit per Kamera [Z])',
        'success'
      );
      this.completeSubObjective('inspect_timing_belt', 55);
      return;
    }

    this.wrongTargetFeedback(
      !this.lowerCoverBoltRemoved
        ? 'Löse die unverlierbare Bundschraube am unteren Zahnriemenschutz mit [3].'
        : !this.lowerCoverRemoved
          ? 'Nimm den unteren Zahnriemenschutz mit der Hand [1] ab.'
          : 'Klicke den alten Zahnriemen mit der Hand [1] an, um den Verlauf zu prüfen.'
    );
  }

  // Step 7: Turn Crankshaft CW to OT (720°)
  private handleStep6FindOt(id: InteractableId): void {
    if (id === 'wheel_crank') {
      if (!this.requireTool('crankWrench')) return;
      this.sound.playClick();
      this.minigame = {
        type: 'ot',
        crankDeg: this.crankAngleDeg,
        targetDeg: CLHA_TIMING_CHECK.crankDegrees,
        toleranceDeg: CLHA_TIMING_CHECK.otPlayWindowDeg,
        unit: '°',
        aligned: isAtOT(this.crankAngleDeg, CLHA_TIMING_CHECK.otPlayWindowDeg),
      };
      this.updateLiveTools();
      this.showToast('KW-Knarre angesetzt — nur im Uhrzeigersinn bis zur OT-Markierung drehen!', 'info');
      this.broadcastHud(true);
      return;
    }
    this.wrongTargetFeedback('Setze die Knarre [4] am Kurbelwellenrad (unten) an und drehe im Uhrzeigersinn auf OT.');
  }

  // Step 8: Lock Shafts Physically & Loosen Cam/HDP Sprockets WITH Counterhold (STRICT NO-TORQUE-ON-PIN GATE!)
  private handleStep7LockAndLoosenHubs(id: InteractableId): void {
    // 1. Lock Cam initial (`3359`)
    if (!this.completedSubObjectives.has('lock_cam_initial')) {
      if (id === 'wheel_cam') {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.add('cam');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('cam'), 0.48);
        this.sound.playPinLock();
        this.showToast(
          `${CLHA_LOCK_TOOLS.cam.name} durch Gabel am Mitnehmer in Zylinderkopf-Bohrung gesteckt! Jetzt kleine Fixierschraube ½ Umdr. lösen [3].`,
          'success'
        );
        this.completeSubObjective('lock_cam_initial', 45);
        if (this.mode === 'guide') this.activeTool = 'torx25';
        return;
      }
      this.wrongTargetFeedback(`Stecke zuerst die NW-Nabe mit ${CLHA_LOCK_TOOLS.cam.code} [5] ab.`);
      return;
    }

    // 2. Loosen small cam fixing bolt 1/2 turn (`camFixBolt`)
    if (!this.camFixBoltLoosened) {
      if (id === 'camFixBolt') {
        if (!this.requireTool('torx25')) return;
        this.camFixBoltLoosened = true;
        const pos = this.engine.getPartWorldPos('camFixBolt');
        if (pos) this.toolModels.playToolAction('torx25', pos, 0.44);
        this.sound.playScrewdriver();
        this.showToast(
          `Kleine NW-Fixierschraube um ½ Umdrehung gelöst (bleibt im Langloch)! Jetzt ${CLHA_LOCK_TOOLS.crank.code} am Kurbelwellenrad einsetzen [5].`,
          'success'
        );
        this.completeSubObjective('loosen_cam_fix', 40);
        if (this.mode === 'guide') this.activeTool = 'lockingPins';
        return;
      }
      this.wrongTargetFeedback('Löse die kleine goldene NW-Fixierschraube am Nockenwellenrad um ½ Umdrehung [3].');
      return;
    }

    // 3. Lock Crankshaft (`T10490`)
    if (!this.completedSubObjectives.has('lock_crank')) {
      if (id === 'wheel_crank') {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.add('crank');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('crank'), 0.48);
        this.sound.playPinLock();
        this.showToast(
          `${CLHA_LOCK_TOOLS.crank.name} im Dichtflansch arretiert! WICHTIG: Zuerst Dorn ${CLHA_LOCK_TOOLS.cam.code} ziehen [5], bevor du die NW-Zentralschraube löst!`,
          'success'
        );
        this.completeSubObjective('lock_crank', 45);
        return;
      }
      this.wrongTargetFeedback(`Arretiere jetzt das Kurbelwellenrad mit ${CLHA_LOCK_TOOLS.crank.code} [5].`);
      return;
    }

    // 4. Loosen Camshaft Central Bolt WITH Counterhold T10172 — STRICT VW PIN SAFETY GATE!
    if (!this.completedSubObjectives.has('loosen_cam_hub')) {
      // CRITICAL GATE: Block loosening camCenterBolt while 3359 is inserted!
      if (id === 'camCenterBolt' && this.lockedShafts.has('cam')) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          `STOPP! VW-Warnung S. 114: Kein Drehmoment auf Dorn ${CLHA_LOCK_TOOLS.cam.code} übertragen (Mitnehmer-Bruchgefahr)! Erst Dorn ${CLHA_LOCK_TOOLS.cam.code} ziehen [5]!`,
          'error'
        );
        this.hudDirty = true;
        return;
      }
      // Pull 3359 before loosening
      if (id === 'lockPin_cam' && !this.camHubLoosened && this.lockedShafts.has('cam')) {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.delete('cam');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.sound.playPinLock();
        this.showToast(
          `Dorn ${CLHA_LOCK_TOOLS.cam.code} gezogen! Löse jetzt die NW-Zentralschraube mit Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} [4].`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'crankWrench';
        this.hudDirty = true;
        return;
      }
      // Loosen camCenterBolt with counterhold T10172
      if (id === 'camCenterBolt' && !this.camHubLoosened && !this.lockedShafts.has('cam')) {
        if (!this.requireTool('crankWrench')) return;
        this.camHubLoosened = true;
        const camPos = this.engine.getWheelWorldPos('cam');
        this.toolModels.showCounterhold(camPos, 0.85, 1.0);
        this.toolModels.playToolAction('crankWrench', camPos, 0.7);
        this.sound.playRatchet();
        this.showToast(
          `NW-Zentralschraube mit Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} angelöst (Langloch frei)! Stecke ${CLHA_LOCK_TOOLS.cam.code} sofort wieder ein [5].`,
          'success'
        );
        if (this.mode === 'guide') this.activeTool = 'lockingPins';
        this.hudDirty = true;
        return;
      }
      // Reinsert 3359
      if (id === 'wheel_cam' && this.camHubLoosened && !this.lockedShafts.has('cam')) {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.add('cam');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('cam'), 0.45);
        this.sound.playPinLock();
        this.showToast(
          `${CLHA_LOCK_TOOLS.cam.code} wieder eingesetzt! Jetzt HDP-Nabe mit ${CLHA_LOCK_TOOLS.pump.code} [5] abstecken.`,
          'success'
        );
        this.completeSubObjective('loosen_cam_hub', 65);
        return;
      }
      this.wrongTargetFeedback(
        !this.camHubLoosened
          ? this.lockedShafts.has('cam')
            ? `Ziehe zuerst Dorn ${CLHA_LOCK_TOOLS.cam.code} [5] heraus (keine Kraft auf Dorn!).`
            : `Löse die NW-Zentralschraube mit Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} [4].`
          : `Stecke Dorn ${CLHA_LOCK_TOOLS.cam.code} [5] wieder in die NW-Nabe ein.`
      );
      return;
    }

    // 5. Lock HDP (`T10492`) -> Pull `T10492` -> Loosen `pumpCenterNut` (~90°) with T10051 -> Reinsert `T10492`!
    if (!this.pumpHubPinnedOnce) {
      if (id === 'wheel_pump') {
        if (!this.requireTool('lockingPins')) return;
        this.pumpHubPinnedOnce = true;
        this.lockedShafts.add('pump');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('pump'), 0.45);
        this.sound.playPinLock();
        this.showToast(
          `HDP-Nabe mit ${CLHA_LOCK_TOOLS.pump.code} durch Naben-Gabel abgesteckt! Ziehe ${CLHA_LOCK_TOOLS.pump.code} [5] VOR dem Lösen der Mutter!`,
          'info'
        );
        this.hudDirty = true;
        return;
      }
      this.wrongTargetFeedback(`Stecke die HDP-Nabe zuerst mit ${CLHA_LOCK_TOOLS.pump.code} [5] ab.`);
      return;
    }

    // CRITICAL GATE: Block loosening pumpCenterNut while T10492 is inserted!
    if (id === 'pumpCenterNut' && this.lockedShafts.has('pump')) {
      this.mistakes += 1;
      this.sound.playError();
      this.showToast(
        `STOPP! VW-Warnung S. 115: Kein Drehmoment auf Dorn ${CLHA_LOCK_TOOLS.pump.code} übertragen! Erst Dorn ${CLHA_LOCK_TOOLS.pump.code} ziehen [5]!`,
        'error'
      );
      this.hudDirty = true;
      return;
    }

    if (id === 'lockPin_pump' && !this.pumpHubLoosened && this.lockedShafts.has('pump')) {
      if (!this.requireTool('lockingPins')) return;
      this.lockedShafts.delete('pump');
      this.engine.setLockedShafts(Array.from(this.lockedShafts));
      this.sound.playPinLock();
      this.showToast(
        `Dorn ${CLHA_LOCK_TOOLS.pump.code} gezogen! Löse jetzt die HDP-Mutter (~90°) mit Gegenhalter ${CLHA_SPECIAL_TOOLS.pumpCounterhold} [4].`,
        'info'
      );
      if (this.mode === 'guide') this.activeTool = 'crankWrench';
      this.hudDirty = true;
      return;
    }

    if (id === 'pumpCenterNut' && !this.pumpHubLoosened && !this.lockedShafts.has('pump')) {
      if (!this.requireTool('crankWrench')) return;
      this.pumpHubLoosened = true;
      const pumpPos = this.engine.getWheelWorldPos('pump');
      this.toolModels.showCounterhold(pumpPos, 0.85, 0.72);
      this.toolModels.playToolAction('crankWrench', pumpPos, 0.65);
      this.sound.playRatchet();
      this.showToast(
        `HDP-Mutter mit Gegenhalter ${CLHA_SPECIAL_TOOLS.pumpCounterhold} um ~90° gelöst! Stecke ${CLHA_LOCK_TOOLS.pump.code} sofort wieder ein [5].`,
        'success'
      );
      if (this.mode === 'guide') this.activeTool = 'lockingPins';
      this.hudDirty = true;
      return;
    }

    if (id === 'wheel_pump' && this.pumpHubLoosened && !this.lockedShafts.has('pump')) {
      if (!this.requireTool('lockingPins')) return;
      this.lockedShafts.add('pump');
      this.engine.setLockedShafts(Array.from(this.lockedShafts));
      this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('pump'), 0.45);
      this.sound.playPinLock();
      this.showToast(
        `Alle 3 Wellen abgesteckt & beide Langloch-Räder (NW & HDP) sauber gelöst!`,
        'success'
      );
      this.completeSubObjective('loosen_pump_hub', 70);
      return;
    }

    this.wrongTargetFeedback(
      !this.pumpHubLoosened
        ? this.lockedShafts.has('pump')
          ? `Ziehe Dorn ${CLHA_LOCK_TOOLS.pump.code} [5] vor dem Lösen der HDP-Mutter.`
          : `Löse die HDP-Mutter (~90°) mit Gegenhalter ${CLHA_SPECIAL_TOOLS.pumpCounterhold} [4].`
        : `Stecke Dorn ${CLHA_LOCK_TOOLS.pump.code} [5] wieder in die HDP-Nabe ein.`
    );
  }

  // Step 9: Release & Pin Typ B Tensioner (T10265), Remove Old Belt Starting at Water Pump & Check Rollers
  private handleStep8RemoveOldBelt(id: InteractableId): void {
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
      this.showToast(
        `${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} angesetzt (Spannrolle Typ B) — gegen Uhrzeigersinn entlasten!`,
        'info'
      );
      this.broadcastHud(true);
      return;
    }

    if ((id === 'wheel_tensioner' || id === 'tensionerNut') && this.oldTensionerReleased && !this.tensionerPinnedTypeB) {
      if (!this.requireTool('lockingPins')) return;
      this.tensionerPinnedTypeB = true;
      this.engine.setTensionerPinnedTypeB(true);
      this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('tensioner'), 0.48);
      this.sound.playPinLock();
      this.showToast(
        `Spannrolle Typ B mit ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} abgesteckt & am Rechtsanschlag geparkt! Nimm jetzt den alten Zahnriemen ab [1] (zuerst an der Kühlmittelpumpe).`,
        'success'
      );
      this.completeSubObjective('pin_tensioner_type_b', 50);
      if (this.mode === 'guide') this.activeTool = 'hand';
      return;
    }

    if ((id === 'oldTimingBelt' || id === 'wheel_water') && !this.oldBeltRemoved) {
      if (!this.tensionerPinnedTypeB) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          !this.oldTensionerReleased
            ? `Erst Spannrolle Typ B mit ${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} [6] entlasten!`
            : `Erst Spannrolle Typ B mit Stift ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} [5] abstecken!`,
          'error'
        );
        this.hudDirty = true;
        return;
      }
      if (!this.requireTool('hand')) return;
      this.oldBeltRemoved = true;
      this.engine.setBeltState('none');
      this.sound.playBeltSnap();
      this.showToast(
        'Alten Zahnriemen zuerst von der Kühlmittelpumpe und dann von den übrigen Rädern abgenommen! Prüfe Pumpe & Umlenkrollen [1].',
        'success'
      );
      this.completeSubObjective('take_old_timing_belt', 55);
      return;
    }

    if (id === 'wheel_water' && !this.waterPumpChecked) {
      if (!this.requireTool('hand')) return;
      this.waterPumpChecked = true;
      this.engine.triggerRollerSpinCheck('water');
      this.sound.playBearingSpin();
      this.showToast(
        'Kühlmittelpumpe geprüft — dicht & ohne Lagerspiel! (Hinweis: eine neue trockene Pumpe nie trocken durchdrehen.)',
        'success'
      );
      this.completeSubObjective('check_water_pump', 40);
      return;
    }

    if ((id === 'wheel_lower' || id === 'wheel_upper') && !this.completedSubObjectives.has('check_idlers')) {
      if (!this.oldBeltRemoved) {
        this.sound.playError();
        this.showToast('Nimm zuerst den alten Zahnriemen ab!', 'warning');
        return;
      }
      if (!this.requireTool('hand')) return;
      const which = id === 'wheel_lower' ? 'lower' : 'upper';
      this.idlersChecked[which] = true;
      this.engine.triggerRollerSpinCheck(which);
      this.sound.playBearingSpin();
      if (this.idlersChecked.lower && this.idlersChecked.upper) {
        this.showToast('Beide Umlenkrollen geprüft — ruhiger, spielfreier Lauf!', 'success');
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
        ? `Entlaste zuerst die Spannrolle Typ B mit ${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} [6].`
        : !this.tensionerPinnedTypeB
          ? `Stecke die Spannrolle Typ B mit ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} [5] ab.`
          : !this.oldBeltRemoved
            ? 'Nimm den alten Zahnriemen mit der Hand [1] zuerst an der Kühlmittelpumpe ab.'
            : 'Prüfe Kühlmittelpumpe sowie untere & obere Umlenkrolle mit der Hand [1].'
    );
  }

  // Step 10: Prep Sprockets CW to Stop & Lay New Belt in Official VW Rep.-Gr. 15 S. 118 Sequence (1..5)
  private handleStep9InstallNewBelt(id: InteractableId): void {
    if (!this.sprocketsPreppedCw) {
      if (id === 'wheel_cam' || id === 'wheel_pump' || id === 'wheel_tensioner') {
        if (!this.requireTool('hand')) return;
        this.sprocketsPreppedCw = true;
        this.engine.setHubSprocketSlackOffset(-7, -7);
        this.engine.setBeltState('routing');
        this.engine.setRoutingStations([]);
        this.sound.playSuccess();
        this.showToast(
          `Sitzzunge in Gussnut geprüft & NW-/HDP-Rad im Langloch im Uhrzeigersinn an Anschlag gedreht! Lege jetzt den neuen Riemen [8] auf: ${CLHA_TIMING_BELT.vwLaySequenceText}.`,
          'success'
        );
        this.completeSubObjective('prep_sprockets_cw', 50);
        if (this.mode === 'guide') this.activeTool = 'newTimingBelt';
        return;
      }
      this.wrongTargetFeedback(
        'Drehe zuerst die gelösten NW-/HDP-Räder im Langloch im Uhrzeigersinn bis zum Anschlag (Klick auf NW-Rad mit [1]).'
      );
      return;
    }

    const expected = VW_LAY_ORDER[this.beltRoutingProgress.length];
    if (!expected) return;

    const mapId: Partial<Record<InteractableId, VwBeltLayStationId>> = {
      wheel_crank: 'crank',
      lockPin_crank: 'crank',
      wheel_tensioner: 'tensioner',
      tensionerNut: 'tensioner',
      tensionerLockPin: 'tensioner',
      wheel_cam: 'cam',
      lockPin_cam: 'cam',
      camCenterBolt: 'cam',
      wheel_pump: 'pump',
      lockPin_pump: 'pump',
      pumpCenterNut: 'pump',
      wheel_water: 'water',
    };
    const clicked = mapId[id];
    if (!clicked) {
      const nextWheel = wheels.find((w) => w.id === expected)!;
      this.wrongTargetFeedback(
        `VW-Auflegereihenfolge [8] (${CLHA_TIMING_BELT.vwLaySequenceText}) — als Nächstes: ${nextWheel.name}.`
      );
      return;
    }

    if (!this.requireTool('newTimingBelt')) return;

    if (clicked !== expected) {
      this.mistakes += 1;
      this.sound.playError();
      const nextWheel = wheels.find((w) => w.id === expected)!;
      this.showToast(
        `VW-Reihenfolge S. 118 beachten! Station ${this.beltRoutingProgress.length + 1} von 5: ${nextWheel.name} (Kühlmittelpumpe zuletzt!).`,
        'warning'
      );
      this.hudDirty = true;
      return;
    }

    this.beltRoutingProgress = [...this.beltRoutingProgress, clicked];
    this.engine.setRoutingStations(this.beltRoutingProgress);

    if (this.beltRoutingProgress.length === VW_LAY_ORDER.length) {
      this.newBeltInstalled = true;
      this.engine.setBeltState('new_slack');
      this.sound.playBeltSnap();
      this.showToast(
        'Neuer Zahnriemen (145 Z. • 25 mm) in offizieller VW-Folge (Kühlmittelpumpe zuletzt) aufgelegt!',
        'success'
      );
    } else {
      this.sound.playSuccess();
    }

    this.completeSubObjective(`route_${clicked}`, 40);
  }

  private openFasteningStage(stageId: FasteningStageId, worldPos: THREE.Vector3): void {
    const spec = CLHA_FASTENING_STAGES[stageId];
    this.pendingTorque = { kind: stageId, worldPos: worldPos.clone() };
    this.torquePressing = false;
    this.minigame = {
      type: 'torque',
      stageId,
      stageKind: spec.stageKind,
      stageIndex: spec.stageIndex,
      stageTotal: spec.stageTotal,
      stage1PillLabel: spec.stage1PillLabel,
      stage2PillLabel: spec.stage2PillLabel,
      unit: spec.unit,
      targetValue: spec.targetValue,
      inputWindow: spec.inputWindow,
      maxValue: spec.maxValue,
      scaleTicks: [...spec.scaleTicks],
      decimals: spec.decimals,
      currentValue: 0,
      label: spec.label,
      boltLabel: spec.boltLabel,
      specNote: spec.specNote,
      attemptStatus: 'ready',
      active: true,
    };
  }

  // Step 11: Pull T10265, Tension Typ B (Cold) -> 20 Nm + 45°, Pull 3359/T10492 -> Pretorque NW & HDP 20 Nm!
  private handleStep10SetTensionAndPretorque(id: InteractableId): void {
    // 1. Pull T10265 lock pin from Typ B tensioner
    if (this.tensionerPinnedTypeB) {
      if (id === 'tensionerLockPin' || id === 'wheel_tensioner' || id === 'tensionerNut') {
        if (!this.requireTool('lockingPins')) return;
        this.tensionerPinnedTypeB = false;
        this.engine.setTensionerPinnedTypeB(false);
        this.sound.playPinLock();
        this.showToast(
          `Mutter gelöst & Stift ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} gezogen! Jetzt Exzenter bei kaltem Motor mit ${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} [6] im Uhrzeigersinn auf Zeigermitte drehen.`,
          'success'
        );
        this.completeSubObjective('pull_tensioner_pin', 45);
        if (this.mode === 'guide') this.activeTool = 'eccentricKey';
        return;
      }
      this.wrongTargetFeedback(
        `Ziehe zuerst den Absteckstift ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} [5] aus der Spannrolle Typ B.`
      );
      return;
    }

    // 2. Align tensioner pointer (cold engine)
    if (!this.tensionPointerAligned) {
      if (id === 'wheel_tensioner' || id === 'tensionerNut') {
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
        this.showToast(
          `${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} angesetzt (Motor kalt) — Zeiger exakt mittig im Spalt ausrichten!`,
          'info'
        );
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback(
        `Stelle den Spannzeiger bei kaltem Motor mit ${CLHA_SPECIAL_TOOLS.tensionerWrenchTypeB} [6] auf Zeigermitte.`
      );
      return;
    }

    // 3. Torque new tensioner nut: Stage 1 (20 Nm) -> Stage 2 (+45°)
    if (!this.tensionerTorqued) {
      if (id === 'tensionerNut' || id === 'wheel_tensioner') {
        if (!this.requireTool('torqueWrench')) return;
        const pos = this.getInteractableWorldPos('tensionerNut') ?? this.engine.getWheelWorldPos('tensioner');
        this.openFasteningStage(
          this.tensionerTorqueStage1Done ? 'tensioner_angle' : 'tensioner_torque',
          pos
        );
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback(
        `Ziehe die neue Spannrollen-Mutter mit [7] zweistufig an (${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°).`
      );
      return;
    }

    // 4. Separate 20 Nm Pre-Torques (NW THEN HDP) + Explicit HDP Rest-Verstellweg Check (VW S. 119–120, Abb. A15-11412):
    // 3359, T10492 & T10490 STAY inserted for positioning while T10172 + T10172/11 holds CCW tension (Gegenzug)!
    if (!this.camPretorqued || !this.pumpPretorqued || !this.pumpTravelChecked) {
      if (
        (id === 'lockPin_cam' || id === 'lockPin_crank') ||
        (id === 'lockPin_pump' && (!this.camPretorqued || !this.pumpPretorqued))
      ) {
        this.mistakes += 1;
        this.sound.playError();
        this.showToast(
          `VW Abb. A15-11412: Für beide 20-Nm-Voranzüge (NW & HDP) und die Restweg-Prüfung bleiben ${CLHA_LOCK_TOOLS.cam.code}, ${CLHA_LOCK_TOOLS.pump.code} & ${CLHA_LOCK_TOOLS.crank.code} zur Positionierung gesteckt! Erst danach alle 3 Arretierungen ziehen.`,
          'warning'
        );
        this.hudDirty = true;
        return;
      }

      // 4a. NW Central Bolt Pre-Torque (20 Nm) with T10172 + T10172/11 CCW counterhold at cam
      if (!this.camPretorqued) {
        if (id === 'camCenterBolt' || id === 'wheel_cam') {
          if (!this.requireTool('torqueWrench')) return;
          const camPos = this.engine.getPartWorldPos('camCenterBolt') ?? this.engine.getWheelWorldPos('cam');
          this.toolModels.setActiveCounterhold(true, this.engine.getWheelWorldPos('cam'), 1.0);
          this.openFasteningStage('cam_pretorque', camPos);
          this.sound.playClick();
          this.broadcastHud(true);
          return;
        }
        this.wrongTargetFeedback(
          `Ziehe zuerst die NW-Zentralschraube nach Abb. A15-11412 mit [7] unter Gegenzug (${CLHA_SPECIAL_TOOLS.camCounterhold} ↺) auf ${CLHA_MONTAGE_VALUES.camshaftCenterPreNm} Nm voran.`
        );
        return;
      }

      // 4b. HDP Nut Pre-Torque (20 Nm) separately at pumpCenterNut (while T10172 maintains CCW tension at cam!)
      if (!this.pumpPretorqued) {
        if (id === 'pumpCenterNut' || id === 'wheel_pump') {
          if (!this.requireTool('torqueWrench')) return;
          const pumpPos = this.engine.getPartWorldPos('pumpCenterNut') ?? this.engine.getWheelWorldPos('pump');
          this.toolModels.setActiveCounterhold(true, this.engine.getWheelWorldPos('cam'), 1.0);
          this.openFasteningStage('pump_pretorque', pumpPos);
          this.sound.playClick();
          this.broadcastHud(true);
          return;
        }
        this.wrongTargetFeedback(
          `Ziehe jetzt separat die HDP-Mutter (pumpCenterNut) mit [7] auf ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm voran (Gegenhalter bleibt am NW-Rad!).`
        );
        return;
      }

      // 4c. Explicit Visible Check of HDP Rest-Verstellweg (Abb. N15-10906: mark NOT flush with T10492!)
      if (!this.pumpTravelChecked) {
        if (id === 'wheel_pump' || id === 'lockPin_pump' || id === 'pumpCenterNut') {
          if (!this.requireTool('hand')) return;
          this.pumpTravelChecked = true;
          this.sound.playSuccess();
          this.showToast(
            `Rest-Verstellweg HDP (Abb. N15-10906) geprüft: Markierung liegt frei neben ${CLHA_LOCK_TOOLS.pump.code} (nicht am Anschlag)! Nimm jetzt ALLE 3 Arretierungen (${CLHA_LOCK_TOOLS.cam.code}, ${CLHA_LOCK_TOOLS.pump.code}, ${CLHA_LOCK_TOOLS.crank.code}) ab [5].`,
            'success'
          );
          this.completeSubObjective('pretorque_pump_20nm', 55);
          if (this.mode === 'guide') this.activeTool = 'lockingPins';
          return;
        }
        this.wrongTargetFeedback(
          `Prüfe jetzt mit der Hand [1] am HDP-Rad den Rest-Verstellweg (Markierung darf nicht bündig mit ${CLHA_LOCK_TOOLS.pump.code} stehen, Abb. N15-10906).`
        );
        return;
      }
    }

    // 5. ONLY AFTER BOTH 20 Nm PRE-TORQUES & HDP REST-VERSTELLWEG CHECK: Remove ALL 3 locks (3359, T10492, T10490)!
    if (!this.locksRemovedAfterPretorque) {
      const pullMap: Partial<Record<InteractableId, LockableWheelId>> = {
        lockPin_cam: 'cam',
        wheel_cam: 'cam',
        lockPin_pump: 'pump',
        wheel_pump: 'pump',
        lockPin_crank: 'crank',
        wheel_crank: 'crank',
      };
      const shaft = pullMap[id];
      if (shaft && this.lockedShafts.has(shaft)) {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.delete(shaft);
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.sound.playPinLock();
        if (this.lockedShafts.size === 0) {
          this.locksRemovedAfterPretorque = true;
          this.showToast(
            'Alle 3 Arretierungen (3359, T10492, T10490) entfernt — bereit für die 2-Umdrehungen-Steuerzeitenkontrolle (VW S. 120)!',
            'success'
          );
          this.completeSubObjective('remove_locks_after_pretorque', 55);
        } else {
          const remaining = Array.from(this.lockedShafts)
            .map((s) => CLHA_LOCK_TOOLS[s].code)
            .join(', ');
          this.showToast(
            `${CLHA_LOCK_TOOLS[shaft].code} gezogen — entferne jetzt noch: ${remaining} [5]!`,
            'info'
          );
          this.hudDirty = true;
        }
        return;
      }
      this.wrongTargetFeedback(
        `Entferne nach dem 20-Nm-Voranzug alle 3 Arretierungen (${CLHA_LOCK_TOOLS.cam.code}, ${CLHA_LOCK_TOOLS.pump.code}, ${CLHA_LOCK_TOOLS.crank.code}) mit [5].`
      );
    }
  }

  // Step 12: VW Golf S. 120–123 — Check 1 (720°) -> Check 2 (720° repeat) -> Final NW 100 Nm & HDP 95 Nm (pins pulled!) -> Check 3 (720° + pointer check after final torque) -> Remove ALL tools -> Small NW Fixing Bolt 9 Nm!
  private handleStep11TimingCheckAndFinalTorque(id: InteractableId): void {
    // STRICT ANIMATION LOCK: Never accept pin/lock/crank clicks while the crankshaft is actively turning 720°!
    if (this.engine.isManualCrankAnimating()) {
      this.showToast('Kurbelwelle dreht noch (2 Umdrehungen / 720°) — bitte Ende der Drehung abwarten!', 'info');
      return;
    }

    // --- SUB 1: 1. Steuerzeitenkontrolle (VW S. 120–121) ---
    if (!this.check1PointerOk) {
      if (!this.check1Cranked) {
        if (id === 'wheel_crank') {
          if (!this.requireTool('crankWrench')) return;
          if (this.lockedShafts.size > 0) {
            this.mistakes += 1;
            this.sound.playError();
            this.showToast('STOPP! Erst alle Arretierungen entfernen, bevor die Kurbelwelle gedreht wird!', 'error');
            return;
          }
          const pos = this.engine.getWheelWorldPos('crank');
          this.toolModels.playToolAction('crankWrench', pos, 1.15);
          this.sound.playRatchet();
          this.scheduleTimeout(() => this.sound.playRatchet(), 520);
          // NOTE: check1Cranked flips ONLY INSIDE callback after the 720° animation completes!
          this.engine.triggerManualCrank720(
            708,
            () => {
              this.crankAngleDeg = 708;
              this.check1Cranked = true;
              this.sound.playSuccess();
              this.showToast(
                '1. Kontrolle: 2 KW-Umdrehungen (720°) ↻ bis kurz vor OT! Setze T10490 [5] an und raste im Flanschloch ein.',
                'info'
              );
              if (this.mode === 'guide') this.activeTool = 'lockingPins';
              this.broadcastHud(true);
            },
            1.1
          );
          this.showToast('1. Kontrolle (S. 120): Kurbelwelle wird 2× (720°) ↻ bis kurz vor OT gedreht…', 'info');
          this.broadcastHud(true);
          return;
        }
        this.wrongTargetFeedback('1. Kontrolle: Drehe die Kurbelwelle mit [4] 2× (720°) im Uhrzeigersinn bis kurz vor OT.');
        return;
      }

      if (!this.check1CrankLocked) {
        if (id === 'wheel_crank') {
          if (!this.requireTool('lockingPins')) return;
          this.check1CrankLocked = true;
          this.crankAngleDeg = 720;
          this.engine.setCrankAngle(720);
          this.lockedShafts.add('crank');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('crank'), 0.4);
          this.sound.playPinLock();
          this.showToast(
            `${CLHA_LOCK_TOOLS.crank.code} beim Weiterdrehen eingerastet! Prüfe jetzt NW-Dorn ${CLHA_LOCK_TOOLS.cam.code} [5].`,
            'info'
          );
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback(`Setze ${CLHA_LOCK_TOOLS.crank.code} [5] am Kurbelwellenrad bis zum Einrasten ein.`);
        return;
      }

      if (!this.check1CamLocked) {
        if (id === 'wheel_cam') {
          if (!this.requireTool('lockingPins')) return;
          if (!isAtOT(this.crankAngleDeg, 4)) {
            this.mistakes += 1;
            this.sound.playError();
            this.showToast(
              'Fehlende Deckung an der Nockenwelle! VW S. 121–122: Steuerzeiten korrigieren und erneut prüfen!',
              'error'
            );
            this.hudDirty = true;
            return;
          }
          this.check1CamLocked = true;
          this.lockedShafts.add('cam');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.toolModels.playToolAction('lockingPins', this.engine.getWheelWorldPos('cam'), 0.4);
          this.sound.playPinLock();
          this.showToast(
            `1. Kontrolle: ${CLHA_LOCK_TOOLS.cam.code} passt sauber! (Leichte Abweichung an HDP laut S. 121 zulässig.) Prüfe jetzt Spannzeiger [1].`,
            'info'
          );
          if (this.mode === 'guide') this.activeTool = 'hand';
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback(`Prüfe die NW-Nabe mit Absteckdorn ${CLHA_LOCK_TOOLS.cam.code} [5].`);
        return;
      }

      if (id === 'wheel_tensioner' || id === 'tensionerNut') {
        if (!this.requireTool('hand')) return;
        this.check1PointerOk = true;
        this.sound.playSuccess();
        this.showToast(
          `1. Kontrolle bestanden (Zeiger ≤ ${CLHA_TIMING_CHECK.pointerRecheckMaxOffsetMm} mm OK)! Jetzt 2. Wiederholkontrolle (VW S. 122): ${CLHA_LOCK_TOOLS.cam.code} & ${CLHA_LOCK_TOOLS.crank.code} ziehen [5].`,
          'success'
        );
        this.completeSubObjective('timing_check_1', 60);
        if (this.mode === 'guide') this.activeTool = 'lockingPins';
        return;
      }
      this.wrongTargetFeedback('Prüfe den Spannzeiger an der Spannrolle Typ B mit der Hand [1].');
      return;
    }

    // --- SUB 2: 2. Wiederholkontrolle (VW Golf S. 122: Dorne ab -> nochmals 2× 720° -> T10490 + 3359 + Zeiger prüfen!) ---
    if (!this.check2PointerOk) {
      if (!this.check2LocksCleared) {
        if (
          (id === 'lockPin_cam' || id === 'wheel_cam') &&
          this.lockedShafts.has('cam')
        ) {
          if (!this.requireTool('lockingPins')) return;
          this.lockedShafts.delete('cam');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.sound.playPinLock();
          if (this.lockedShafts.size === 0) {
            this.check2LocksCleared = true;
            if (this.mode === 'guide') this.activeTool = 'crankWrench';
            this.showToast('Dorne entfernt — drehe KW nochmals 2× (720°) ↻ für die Wiederholkontrolle [4]!', 'info');
          } else {
            this.showToast(`${CLHA_LOCK_TOOLS.cam.code} gezogen — ziehe auch ${CLHA_LOCK_TOOLS.crank.code} [5]!`, 'info');
          }
          this.hudDirty = true;
          return;
        }
        if (
          (id === 'lockPin_crank' || id === 'wheel_crank') &&
          this.lockedShafts.has('crank')
        ) {
          if (!this.requireTool('lockingPins')) return;
          this.lockedShafts.delete('crank');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.sound.playPinLock();
          if (this.lockedShafts.size === 0) {
            this.check2LocksCleared = true;
            if (this.mode === 'guide') this.activeTool = 'crankWrench';
            this.showToast('Dorne entfernt — drehe KW nochmals 2× (720°) ↻ für die Wiederholkontrolle [4]!', 'info');
          } else {
            this.showToast(`${CLHA_LOCK_TOOLS.crank.code} gezogen — ziehe auch ${CLHA_LOCK_TOOLS.cam.code} [5]!`, 'info');
          }
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback(
          `2. Wiederholkontrolle (S. 122): Entferne zuerst ${CLHA_LOCK_TOOLS.cam.code} & ${CLHA_LOCK_TOOLS.crank.code} [5] vor dem erneuten Durchdrehen!`
        );
        return;
      }

      if (!this.check2Cranked) {
        if (id === 'wheel_crank') {
          if (!this.requireTool('crankWrench')) return;
          const pos = this.engine.getWheelWorldPos('crank');
          this.toolModels.playToolAction('crankWrench', pos, 1.15);
          this.sound.playRatchet();
          this.scheduleTimeout(() => this.sound.playRatchet(), 520);
          this.engine.triggerManualCrank720(
            708,
            () => {
              this.crankAngleDeg = 708;
              this.check2Cranked = true;
              this.sound.playSuccess();
              this.showToast(
                '2. Wiederholkontrolle: Weitere 2 KW-Umdrehungen (720°) ↻ absolviert — T10490 einrasten [5]!',
                'info'
              );
              if (this.mode === 'guide') this.activeTool = 'lockingPins';
              this.broadcastHud(true);
            },
            1.1
          );
          this.showToast('2. Wiederholkontrolle (S. 122): Kurbelwelle erneut 2× (720°) ↻ drehen…', 'info');
          this.broadcastHud(true);
          return;
        }
        this.wrongTargetFeedback('Drehe die Kurbelwelle für die Wiederholkontrolle (S. 122) erneut 2× (720°) ↻ mit [4].');
        return;
      }

      if (!this.check2CrankLocked) {
        if (id === 'wheel_crank') {
          if (!this.requireTool('lockingPins')) return;
          this.check2CrankLocked = true;
          this.crankAngleDeg = 720;
          this.engine.setCrankAngle(720);
          this.lockedShafts.add('crank');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.sound.playPinLock();
          this.showToast(`2. Kontrolle: ${CLHA_LOCK_TOOLS.crank.code} eingerastet — prüfe NW-Dorn ${CLHA_LOCK_TOOLS.cam.code} [5]!`, 'info');
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback(`Raste ${CLHA_LOCK_TOOLS.crank.code} [5] am Kurbelwellenrad ein.`);
        return;
      }

      if (!this.check2CamLocked) {
        if (id === 'wheel_cam') {
          if (!this.requireTool('lockingPins')) return;
          if (!isAtOT(this.crankAngleDeg, 4)) {
            this.mistakes += 1;
            this.sound.playError();
            this.showToast('Steuerzeiten korrigieren und erneut prüfen (VW S. 121–122)!', 'error');
            this.hudDirty = true;
            return;
          }
          this.check2CamLocked = true;
          this.lockedShafts.add('cam');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.sound.playPinLock();
          this.showToast(`2. Kontrolle: ${CLHA_LOCK_TOOLS.cam.code} passt reproduzierbar — prüfe Spannzeiger [1]!`, 'info');
          if (this.mode === 'guide') this.activeTool = 'hand';
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback(`Prüfe erneut ${CLHA_LOCK_TOOLS.cam.code} [5] an der Nockenwelle.`);
        return;
      }

      if (id === 'wheel_tensioner' || id === 'tensionerNut') {
        if (!this.requireTool('hand')) return;
        this.check2PointerOk = true;
        this.sound.playSuccess();
        this.showToast(
          `2. Wiederholkontrolle bestanden! Jetzt Endanzug (S. 122): ZUERST NW-Dorn ${CLHA_LOCK_TOOLS.cam.code} ziehen [5] vor 100 Nm!`,
          'success'
        );
        this.completeSubObjective('timing_check_2', 60);
        if (this.mode === 'guide') this.activeTool = 'lockingPins';
        return;
      }
      this.wrongTargetFeedback('Prüfe den Spannzeiger ein zweites Mal mit der Hand [1].');
      return;
    }

    // --- SUB 3: Final Torque NW Central Bolt (100 Nm with T10172 + T10172/11, STRICT PIN-OUT GATE!) ---
    if (!this.camCenterFinalTorqued) {
      if (id === 'lockPin_cam' && this.lockedShafts.has('cam')) {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.delete('cam');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.sound.playPinLock();
        this.showToast(
          `NW-Dorn ${CLHA_LOCK_TOOLS.cam.code} gezogen — ziehe jetzt NW-Zentralschraube mit Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} auf ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm an [7]!`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        this.hudDirty = true;
        return;
      }

      if (id === 'camCenterBolt' || id === 'wheel_cam') {
        if (this.lockedShafts.has('cam')) {
          this.mistakes += 1;
          this.sound.playError();
          this.showToast(
            `STOPP! VW S. 122: Kein 100-Nm-Endanzug bei gestecktem Dorn ${CLHA_LOCK_TOOLS.cam.code}! Ziehe zuerst ${CLHA_LOCK_TOOLS.cam.code} [5]!`,
            'error'
          );
          this.hudDirty = true;
          return;
        }
        if (!this.requireTool('torqueWrench')) return;
        const camPos = this.engine.getWheelWorldPos('cam');
        this.toolModels.setActiveCounterhold(true, camPos, 1.0);
        this.openFasteningStage('cam_final_torque', camPos);
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }

      this.wrongTargetFeedback(
        this.lockedShafts.has('cam')
          ? `Ziehe zuerst NW-Dorn ${CLHA_LOCK_TOOLS.cam.code} [5], bevor du die NW-Zentralschraube mit ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm anziehst!`
          : `Ziehe die NW-Zentralschraube mit [7] und Gegenhalter ${CLHA_SPECIAL_TOOLS.camCounterhold} auf ${CLHA_MONTAGE_VALUES.camshaftCenterFinalNm} Nm an.`
      );
      return;
    }

    // --- SUB 4: Final Torque HDP Nut (95 Nm with T10051, STRICT PIN-OUT GATE!) ---
    if (!this.pumpFinalTorqued) {
      if (id === 'pumpCenterNut' || id === 'wheel_pump') {
        if (this.lockedShafts.has('pump')) {
          this.mistakes += 1;
          this.sound.playError();
          this.showToast(
            `STOPP! VW S. 122: Ziehe zuerst HDP-Dorn ${CLHA_LOCK_TOOLS.pump.code} [5] vor dem 95-Nm-Endanzug!`,
            'error'
          );
          this.hudDirty = true;
          return;
        }
        if (!this.requireTool('torqueWrench')) return;
        const pumpPos = this.engine.getWheelWorldPos('pump');
        this.toolModels.setActiveCounterhold(true, pumpPos, 0.72);
        this.openFasteningStage('pump_final_torque', pumpPos);
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback(
        `Ziehe die HDP-Mutter mit [7] und Gegenhalter ${CLHA_SPECIAL_TOOLS.pumpCounterhold} auf ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm an.`
      );
      return;
    }

    // --- SUB 5: 3. Abschlusskontrolle NACH beiden Endanzügen (VW Golf S. 123) & ALLE Werkzeuge abnehmen! ---
    if (!this.check3AllToolsRemoved) {
      if (!this.check3LocksCleared) {
        if (
          (id === 'lockPin_crank' || id === 'wheel_crank') &&
          this.lockedShafts.has('crank')
        ) {
          if (!this.requireTool('lockingPins')) return;
          this.lockedShafts.clear();
          this.engine.setLockedShafts([]);
          this.check3LocksCleared = true;
          this.sound.playPinLock();
          this.showToast(
            `${CLHA_LOCK_TOOLS.crank.code} entfernt — drehe KW jetzt für die 3. Abschlusskontrolle (S. 123) 2× (720°) ↻ [4]!`,
            'info'
          );
          if (this.mode === 'guide') this.activeTool = 'crankWrench';
          this.hudDirty = true;
          return;
        }
        if (this.lockedShafts.size === 0) {
          this.check3LocksCleared = true;
        } else {
          this.wrongTargetFeedback(`Entferne zuerst ${CLHA_LOCK_TOOLS.crank.code} [5] für die Abschlusskontrolle (S. 123).`);
          return;
        }
      }

      if (!this.check3Cranked) {
        if (id === 'wheel_crank') {
          if (!this.requireTool('crankWrench')) return;
          const pos = this.engine.getWheelWorldPos('crank');
          this.toolModels.playToolAction('crankWrench', pos, 1.15);
          this.sound.playRatchet();
          this.scheduleTimeout(() => this.sound.playRatchet(), 520);
          this.engine.triggerManualCrank720(
            708,
            () => {
              this.crankAngleDeg = 708;
              this.check3Cranked = true;
              this.sound.playSuccess();
              this.showToast(
                '3. Abschlusskontrolle (S. 123): 2 KW-Umdrehungen nach Endanzug — T10490 einrasten [5]!',
                'info'
              );
              if (this.mode === 'guide') this.activeTool = 'lockingPins';
              this.broadcastHud(true);
            },
            1.1
          );
          this.showToast('3. Abschlusskontrolle (S. 123): Kurbelwelle nach Endanzug 2× (720°) ↻ drehen…', 'info');
          this.broadcastHud(true);
          return;
        }
        this.wrongTargetFeedback('3. Abschlusskontrolle (S. 123): Kurbelwelle nach beiden Endanzügen 2× (720°) ↻ drehen [4].');
        return;
      }

      if (!this.check3CrankLocked) {
        if (id === 'wheel_crank') {
          if (!this.requireTool('lockingPins')) return;
          this.check3CrankLocked = true;
          this.crankAngleDeg = 720;
          this.engine.setCrankAngle(720);
          this.lockedShafts.add('crank');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.sound.playPinLock();
          this.showToast(`Abschlusskontrolle: ${CLHA_LOCK_TOOLS.crank.code} eingerastet — NW-Dorn ${CLHA_LOCK_TOOLS.cam.code} final prüfen [5]!`, 'info');
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback(`Raste ${CLHA_LOCK_TOOLS.crank.code} [5] am Kurbelwellenrad ein.`);
        return;
      }

      if (!this.check3CamLocked) {
        if (id === 'wheel_cam') {
          if (!this.requireTool('lockingPins')) return;
          if (!isAtOT(this.crankAngleDeg, 4)) {
            this.mistakes += 1;
            this.sound.playError();
            this.showToast('Steuerzeiten korrigieren und erneut prüfen (VW S. 121–123)!', 'error');
            this.hudDirty = true;
            return;
          }
          this.check3CamLocked = true;
          this.lockedShafts.add('cam');
          this.engine.setLockedShafts(Array.from(this.lockedShafts));
          this.sound.playPinLock();
          this.showToast(
            `3. Abschlusskontrolle (S. 123): ${CLHA_LOCK_TOOLS.cam.code} passt exakt — prüfe jetzt abschließend den Spannzeiger [1] (Verweis S. 123 → S. 120)!`,
            'info'
          );
          if (this.mode === 'guide') this.activeTool = 'hand';
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback(`Prüfe final ${CLHA_LOCK_TOOLS.cam.code} [5] an der Nockenwelle.`);
        return;
      }

      if (!this.check3PointerOk) {
        if (id === 'wheel_tensioner' || id === 'tensionerNut') {
          if (!this.requireTool('hand')) return;
          this.check3PointerOk = true;
          this.sound.playSuccess();
          this.showToast(
            `3. Abschlusskontrolle komplett bestanden (${CLHA_LOCK_TOOLS.crank.code}, ${CLHA_LOCK_TOOLS.cam.code} & Spannzeiger ≤ ${CLHA_TIMING_CHECK.pointerRecheckMaxOffsetMm} mm OK)! Nimm jetzt ALLE Werkzeuge (${CLHA_LOCK_TOOLS.cam.code} & ${CLHA_LOCK_TOOLS.crank.code}) ab [5].`,
            'success'
          );
          if (this.mode === 'guide') this.activeTool = 'lockingPins';
          this.hudDirty = true;
          return;
        }
        this.wrongTargetFeedback('3. Abschlusskontrolle (S. 123 → S. 120): Prüfe abschließend den Spannzeiger mit der Hand [1], bevor du die Dorne ziehst!');
        return;
      }

      // Remove ALL remaining locking tools before small 9 Nm fixing bolt & reassembly!
      if ((id === 'lockPin_cam' || id === 'wheel_cam') && this.lockedShafts.has('cam')) {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.delete('cam');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.sound.playPinLock();
        if (this.lockedShafts.size === 0) {
          this.check3AllToolsRemoved = true;
          this.showToast(
            `Alle Absteckwerkzeuge abgenommen! Ziehe jetzt beim Zusammenbau (S. 123) die kleine NW-Fixierschraube mit ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm an [7].`,
            'success'
          );
          this.completeSubObjective('timing_check_3', 70);
          if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        } else {
          this.showToast(`${CLHA_LOCK_TOOLS.cam.code} entfernt — nimm jetzt noch ${CLHA_LOCK_TOOLS.crank.code} ab [5]!`, 'info');
          this.hudDirty = true;
        }
        return;
      }
      if ((id === 'lockPin_crank' || id === 'wheel_crank') && this.lockedShafts.has('crank')) {
        if (!this.requireTool('lockingPins')) return;
        this.lockedShafts.delete('crank');
        this.engine.setLockedShafts(Array.from(this.lockedShafts));
        this.sound.playPinLock();
        if (this.lockedShafts.size === 0) {
          this.check3AllToolsRemoved = true;
          this.showToast(
            `Alle Absteckwerkzeuge abgenommen! Ziehe jetzt beim Zusammenbau (S. 123) die kleine NW-Fixierschraube mit ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm an [7].`,
            'success'
          );
          this.completeSubObjective('timing_check_3', 70);
          if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        } else {
          this.showToast(`${CLHA_LOCK_TOOLS.crank.code} entfernt — nimm jetzt noch ${CLHA_LOCK_TOOLS.cam.code} ab [5]!`, 'info');
          this.hudDirty = true;
        }
        return;
      }

      this.wrongTargetFeedback(
        `Nimm nach der 3. Abschlusskontrolle alle verbliebenen Werkzeuge (${CLHA_LOCK_TOOLS.cam.code}, ${CLHA_LOCK_TOOLS.crank.code}) mit [5] ab!`
      );
      return;
    }

    // --- SUB 6: Small NW Fixing Bolt (9 Nm) AFTER Final Check (VW Golf S. 123 reassembly!) ---
    if (!this.camFixFinalTorqued) {
      if (id === 'camFixBolt' || id === 'wheel_cam') {
        if (!this.requireTool('torqueWrench')) return;
        this.camFixFinalTorqued = true;
        const pos = this.engine.getPartWorldPos('camFixBolt') ?? this.engine.getWheelWorldPos('cam');
        this.toolModels.playToolAction('torqueWrench', pos, 0.55);
        this.sound.playTorqueClick();
        this.showToast(
          `Kleine NW-Fixierschraube nach Abschlusskontrolle mit ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm angezogen (S. 123)! Alle Werkzeuge draußen — weiter zum Rückbau.`,
          'success'
        );
        this.completeSubObjective('torque_cam_fix_9nm', 55);
        return;
      }
      this.wrongTargetFeedback(
        `Ziehe jetzt nach der Abschlusskontrolle die kleine NW-Fixierschraube mit [7] auf ${CLHA_MONTAGE_VALUES.camshaftFixBoltNm} Nm an.`
      );
    }
  }

  // Step 13: Reinstall Lower Cover, Engine Support (7->40+180°), Upper Cover, Engine Mount, THEN Remove Bridge 10-222 A!
  private handleStep12ReassembleCoversMounts(id: InteractableId): void {
    // STRICT SAFETY GATE: Cannot remove 10-222 A bridge BEFORE BOTH engineSupport & engineMount are torqued!
    if (id === 'engineBridge' && (!this.engineSupportReinstalled || !this.engineMountReinstalled)) {
      this.mistakes += 1;
      this.sound.playError();
      this.showToast(
        `STOPP! Abfangvorrichtung ${CLHA_SPECIAL_TOOLS.engineBridge} darf erst nach festgezogener Motorstütze und rechtem Motorlager entlastet werden!`,
        'error'
      );
      this.hudDirty = true;
      return;
    }

    // 1. Lower timing cover + 12 Nm captive bolt (captive bolt sits WITH the cover as soon as seated!)
    if (!this.lowerCoverReinstalled) {
      if (id === 'lowerTimingCoverSlot' && !this.lowerCoverSeated) {
        if (!this.requireTool('hand')) return;
        this.lowerCoverSeated = true;
        this.lowerCoverRemoved = false;
        this.lowerCoverBoltRemoved = false;
        this.engine.setLowerTimingCoverRemoved(false);
        this.engine.setLowerTimingCoverSlotVisible(false);
        // Captive collar bolt (`unverlierbare Bundschraube`) seats with the cover — immediately visible & clickable!
        this.engine.setLowerCoverBoltRemoved(false, true);
        this.sound.playSuccess();
        this.showToast(
          `Unterer Zahnriemenschutz (am Passstift) angesetzt — unverlierbare Bundschraube jetzt mit [3] auf ${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm anziehen!`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'torx25';
        this.hudDirty = true;
        return;
      }
      if (this.lowerCoverSeated && (id === 'lowerTimingCover' || id === 'lowerCoverBolt')) {
        if (!this.requireTool('torx25')) return;
        this.lowerCoverBoltRemoved = false;
        this.engine.setLowerCoverBoltRemoved(false);
        this.lowerCoverReinstalled = true;
        this.engine.setEngineSupportSlotVisible(true);
        const pos = this.engine.getPartWorldPos('lowerCoverBolt');
        if (pos) this.toolModels.playToolAction('torx25', pos, 0.45);
        this.sound.playTorqueClick();
        this.showToast(
          `Unterer Schutz gesichert (${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm)! Setze jetzt die Motorstütze [1] ein (Schraube 2 vorab einfädeln!).`,
          'success'
        );
        this.completeSubObjective('reinstall_lower_cover', 45);
        if (this.mode === 'guide') this.activeTool = 'hand';
        return;
      }
      this.wrongTargetFeedback(
        this.lowerCoverSeated
          ? `Ziehe die Bundschraube des unteren Zahnriemenschutzes mit [3] auf ${CLHA_MONTAGE_VALUES.lowerTimingCoverCaptiveBoltNm} Nm an.`
          : 'Setze zuerst den unteren Zahnriemenschutz mit der Hand [1] wieder ein.'
      );
      return;
    }

    // 2. Engine support (Motorstütze: 3 new bolts 7 Nm -> 40 Nm + 180° in sequence 1->2->3)
    if (!this.engineSupportReinstalled) {
      if (id === 'engineSupportSlot' && !this.engineSupportSeated) {
        if (!this.requireTool('hand')) return;
        this.engineSupportSeated = true;
        this.engineSupportRemoved = false;
        this.engine.setEngineSupportRemoved(false);
        this.engine.setEngineSupportSlotVisible(false);
        this.sound.playSuccess();
        this.showToast(
          `Motorstütze eingesetzt (Schraube 2 eingefädelt, 3 neue Schrauben auf ${CLHA_MONTAGE_VALUES.engineSupportStage1Nm} Nm angesetzt) — jetzt mit [7] Stufen 2 & 3 (${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm + ${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°)!`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        this.hudDirty = true;
        return;
      }
      if (this.engineSupportSeated && id === 'engineSupport') {
        if (!this.requireTool('torqueWrench')) return;
        const pos = this.engine.getPartWorldPos('engineSupport') ?? new THREE.Vector3(0.45, 0.55, -1.35);
        this.openFasteningStage(
          this.engineSupportStage1Done ? 'engine_support_angle' : 'engine_support_torque',
          pos
        );
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback(
        this.engineSupportSeated
          ? `Ziehe die 3 neuen Schrauben der Motorstütze mit [7] gestuft an (${CLHA_MONTAGE_VALUES.engineSupportStage2Nm} Nm + ${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°).`
          : 'Setze zuerst die Motorstütze mit der Hand [1] ein.'
      );
      return;
    }

    // 3. Upper timing cover (clipped + sensor lines)
    if (!this.upperCoverReinstalled) {
      if (id === 'upperTimingCoverSlot') {
        if (!this.requireTool('hand')) return;
        this.upperCoverReinstalled = true;
        this.upperCoverRemoved = false;
        this.engine.setUpperTimingCoverRemoved(false);
        this.engine.setUpperTimingCoverSlotVisible(false);
        this.golf7.setGhostSlotVisible('engineMountSlot', true);
        this.sound.playSuccess();
        this.showToast(
          'Oberer Zahnriemenschutz eingerastet & Sensorleitungen eingeclipst! Weiter oben zum rechten Motorlager [1].',
          'success'
        );
        this.completeSubObjective('reinstall_upper_cover', 45);
        this.selectCamera('engineTop');
        return;
      }
      this.wrongTargetFeedback('Klipse den oberen Zahnriemenschutz mit der Hand [1] ein.');
      return;
    }

    // 4. Right engine mount (VW Rep.-Gr. 10 S. 32: Pos. 4/6 40 Nm+90°, Pos. 5 20 Nm+90°, Pos. 7 60 Nm+90°, 10 mm gap!)
    if (!this.engineMountReinstalled) {
      if (id === 'engineMountSlot' && !this.engineMountSeated) {
        if (!this.requireTool('hand')) return;
        this.engineMountSeated = true;
        this.engineMountRemoved = false;
        this.golf7.setEngineMountRemoved(false);
        this.golf7.setGhostSlotVisible('engineMountSlot', false);
        this.sound.playSuccess();
        this.showToast(
          `Rechtes Motorlager angesetzt (${CLHA_MONTAGE_VALUES.engineMountGapMm} mm Parallelspalt ausgerichtet) — neue Schrauben mit [7] nach VW-Position anziehen!`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        this.hudDirty = true;
        return;
      }
      if (this.engineMountSeated && id === 'engineMount') {
        if (!this.requireTool('torqueWrench')) return;
        this.engineMountReinstalled = true;
        const pos = this.golf7.getPartWorldPos('engineMount') ?? new THREE.Vector3(0.54, 0.72, -1.32);
        this.toolModels.playToolAction('torqueWrench', pos, 0.72);
        this.sound.playTorqueClick();
        this.scheduleTimeout(() => this.sound.playTorqueClick(), 280);
        this.showToast(
          'Rechtes Motorlager mit neuen Schrauben festgezogen (Pos. 4/6: 40 Nm+90°, Pos. 5: 20 Nm+90°, Pos. 7: 60 Nm+90°; 10 mm Spalt OK)! Jetzt Brücke 10-222 A abnehmen [1].',
          'success'
        );
        this.completeSubObjective('reinstall_engine_mount', 65);
        if (this.mode === 'guide') this.activeTool = 'hand';
        return;
      }
      this.wrongTargetFeedback(
        this.engineMountSeated
          ? 'Ziehe die neuen Schrauben des rechten Motorlagers mit [7] an.'
          : 'Setze zuerst das rechte Motorlager mit der Hand [1] ein.'
      );
      return;
    }

    // 5. Unload & remove VW Engine Support Bridge 10-222 A
    if (!this.engineBridgeRemovedAfterReassembly) {
      if (id === 'engineBridge') {
        if (!this.requireTool('hand')) return;
        this.engineBridgeRemovedAfterReassembly = true;
        this.engineBridgeInstalled = false;
        this.golf7.setEngineBridgeInstalled(false);
        this.sound.playSuccess();
        this.showToast(
          `Abfangvorrichtung ${CLHA_SPECIAL_TOOLS.engineBridge} entlastet & abgenommen — Motor ruht sicher auf Motorstütze & Motorlager!`,
          'success'
        );
        this.completeSubObjective('remove_engine_bridge', 55);
        return;
      }
      this.wrongTargetFeedback(`Entlaste und nimm jetzt die Motorbrücke ${CLHA_SPECIAL_TOOLS.engineBridge} [1] ab.`);
    }
  }

  // Step 14: Reinstall Crank Damper (10 Nm+90°), Aux Poly-V Belt (unpin T10060 A), Fuel/Coolant & BLEED Fuel System!
  private handleStep13ReassembleAuxFuelBleed(id: InteractableId): void {
    // 1. Crankshaft vibration damper (bore over crank sprocket lug, 4 new bolts 10 Nm + 90°)
    if (!this.crankDamperReinstalled) {
      if (id === 'crankDamperSlot' && !this.crankDamperSeated) {
        if (!this.requireTool('hand')) return;
        this.crankDamperSeated = true;
        this.crankDamperRemoved = false;
        this.engine.setCrankDamperRemoved(false);
        this.engine.setCrankDamperSlotVisible(false);
        this.sound.playSuccess();
        this.showToast(
          `Schwingungsdämpfer aufgesetzt (Ausrichtbohrung über KW-Nocken!) — 4 neue Schrauben mit [7] anziehen (${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°)!`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        this.hudDirty = true;
        return;
      }
      if (this.crankDamperSeated && id === 'crankDamper') {
        if (!this.requireTool('torqueWrench')) return;
        const pos = this.engine.getPartWorldPos('crankDamper') ?? new THREE.Vector3(0.47, 0.35, -1.35);
        this.openFasteningStage(
          this.crankDamperStage1Done ? 'crank_damper_angle' : 'crank_damper_torque',
          pos
        );
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback(
        this.crankDamperSeated
          ? `Ziehe die 4 neuen Schrauben am Schwingungsdämpfer mit [7] an (${CLHA_MONTAGE_VALUES.crankDamperOuterTorqueNm} Nm + ${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°).`
          : 'Setze zuerst den Schwingungsdämpfer (Ausrichtbohrung über KW-Nocken) mit [1] auf.'
      );
      return;
    }

    // 2. Reinstall poly-V belt -> hold spring arm with ring spanner [6] -> pull T10060 A [5]
    if (!this.auxBeltReinstalled) {
      if (id === 'auxBeltSlot' && !this.auxBeltSeated) {
        if (!this.requireTool('hand')) return;
        this.auxBeltSeated = true;
        this.auxBeltRemoved = false;
        this.engine.setAuxBeltRemoved(false, false);
        this.sound.playBeltSnap();
        this.showToast(
          `Keilrippenriemen aufgelegt (${AUX_DRIVE_SPEC.routingOrder})! Halte jetzt den Federarm mit Ringschlüssel [6] fest.`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'eccentricKey';
        this.hudDirty = true;
        return;
      }
      if (this.auxBeltSeated && !this.auxTensionerHeldForUnpin && id === 'auxTensioner') {
        if (!this.requireTool('eccentricKey')) return;
        this.sound.playClick();
        this.minigame = {
          type: 'auxTensioner',
          swingDeg: 0,
          targetMinDeg: 28,
          targetMaxDeg: 36,
          aligned: false,
          mode: 'unpin',
        };
        this.updateLiveTools();
        this.broadcastHud(true);
        return;
      }
      if (this.auxTensionerHeldForUnpin && (id === 'auxLockPin' || id === 'auxTensioner')) {
        if (!this.requireTool('lockingPins')) return;
        this.auxPinned = false;
        this.auxTensionerSwingDeg = 0;
        this.auxBeltReinstalled = true;
        this.engine.setAuxTensionerState(0, false);
        this.sound.playPinLock();
        this.showToast(
          `${CLHA_SPECIAL_TOOLS.auxLockPin} gezogen & Federarm langsam entspannt — Keilrippenriemen sitzt sauber! Weiter oben zu Filter, Leitungen & Behälter [1].`,
          'success'
        );
        this.completeSubObjective('reinstall_aux_belt', 60);
        this.selectCamera('engineTop');
        if (this.mode === 'guide') this.activeTool = 'hand';
        return;
      }
      this.wrongTargetFeedback(
        !this.auxBeltSeated
          ? 'Lege zuerst den Keilrippenriemen mit der Hand [1] auf die Riemenscheiben.'
          : !this.auxTensionerHeldForUnpin
            ? 'Halte die Spannvorrichtung mit dem Ringschlüssel [6] fest.'
            : `Ziehe jetzt Absteckstift ${CLHA_SPECIAL_TOOLS.auxLockPin} [5] heraus.`
      );
      return;
    }

    // 3. Reinstall Fuel Filter, Low-Pressure Quick-Couplings A/B & Coolant Expansion Tank
    if (this.fuelFilterMoved || this.fuelLinesDisconnected || this.coolantTankMoved) {
      if (id === 'fuelFilter' && this.fuelFilterMoved) {
        if (!this.requireTool('hand')) return;
        this.fuelFilterMoved = false;
        this.golf7.setFuelFilterMoved(false);
        this.sound.playSuccess();
        this.showToast('Kraftstofffilter wieder montiert — verbinde jetzt Niederdruck-Kupplungen A & B [1]!', 'info');
        this.hudDirty = true;
        return;
      }
      if (id === 'fuelLines' && this.fuelLinesDisconnected) {
        if (!this.requireTool('hand')) return;
        this.fuelLinesDisconnected = false;
        this.golf7.setFuelLinesDisconnected(false);
        this.sound.playSuccess();
        this.showToast('Niederdruck-Schnellkupplungen A & B hörbar eingerastet!', 'info');
        if (!this.fuelFilterMoved && !this.coolantTankMoved) {
          this.completeSubObjective('reinstall_fuel_coolant', 55);
        } else {
          this.hudDirty = true;
        }
        return;
      }
      if (id === 'coolantTank' && this.coolantTankMoved) {
        if (!this.requireTool('hand')) return;
        this.coolantTankMoved = false;
        this.golf7.setCoolantTankMoved(false);
        this.sound.playSuccess();
        this.showToast('Kühlmittel-Ausgleichsbehälter eingeclipst & Stecker angeschlossen!', 'info');
        if (!this.fuelFilterMoved && !this.fuelLinesDisconnected) {
          this.showToast(
            'Alle Behälter & Leitungen montiert! Starte jetzt links „Kraftstoffsystem entlüften (Diagnose)“ (Pflicht vor Motorstart)!',
            'success'
          );
          this.completeSubObjective('reinstall_fuel_coolant', 55);
        } else {
          this.hudDirty = true;
        }
        return;
      }
      this.wrongTargetFeedback('Montiere Kraftstofffilter, Niederdruck-Kupplungen A/B und Ausgleichsbehälter [1].');
      return;
    }

    // 4. Waiting for Fuel System Bleed button click
    this.showToast(
      'Klicke links auf „Kraftstoffsystem entlüften (Diagnose starten)“, bevor es weitergeht (VW Rep.-Gr. 23 S. 281)!',
      'info'
    );
  }

  // Step 15: Reinstall Wheel Liner (6× 2 Nm), Underbody, Wheel (5× 120 Nm), TDI Cover, Hood & Lower Lift!
  private handleStep14ReassembleWheelBody(id: InteractableId): void {
    // 1. Wheel arch liner + 6x T25 (je 2 Nm)
    if (!this.linerReinstalled) {
      if (id === 'wheelLinerSlot' && !this.linerSeatedInReassembly) {
        if (!this.requireTool('hand')) return;
        this.linerSeatedInReassembly = true;
        this.linerRemoved = false;
        this.golf7.setLinerRemoved(false);
        this.golf7.setGhostSlotVisible('wheelLinerSlot', false);
        this.sound.playSuccess();
        this.showToast(
          `Radhausschale eingesetzt — verschraube 6× T25 [3] mit je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm!`,
          'info'
        );
        if (this.mode === 'guide') this.activeTool = 'torx25';
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
            if (pos && i % 2 === 0) this.toolModels.playToolAction('torx25', pos, 0.24);
            if (i % 2 === 0) this.sound.playScrewdriver();
          }, i * 100);
        }
        this.golf7.setUnderbodyRemoved(true, true);
        this.showToast(
          `6× T25 (je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm) montiert! Bringe jetzt die Geräuschdämpfung (Unterboden) wieder an [1].`,
          'success'
        );
        this.completeSubObjective('reinstall_liner', 45);
        if (this.mode === 'guide') this.activeTool = 'hand';
        return;
      }
      this.wrongTargetFeedback(
        this.linerSeatedInReassembly
          ? `Verschraube die Radhausschale mit Torx T25 [3] (je ${CLHA_MONTAGE_VALUES.wheelLinerFrontScrewNm} Nm).`
          : 'Setze zuerst die Radhausschale mit der Hand [1] ein.'
      );
      return;
    }

    // 2. Underbody tray
    if (!this.underbodyReinstalled) {
      if (id === 'underbodyTray') {
        if (!this.requireTool('hand')) return;
        this.underbodyReinstalled = true;
        this.underbodyRemoved = false;
        this.golf7.setUnderbodyRemoved(false, false);
        this.sound.playSuccess();
        this.showToast('Geräuschdämpfung (Unterboden) wieder montiert! Setze jetzt das Serienrad auf die Radnabe [1].', 'success');
        this.completeSubObjective('reinstall_underbody', 40);
        return;
      }
      this.wrongTargetFeedback('Klicke die blau markierte Unterboden-Geräuschdämpfung mit [1] an.');
      return;
    }

    // 3. Mount wheel
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
        this.showToast(
          `Serienrad aufgesetzt! Ziehe die 5 Radschrauben mit [7] über Kreuz mit je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm (einstufig) an.`,
          'success'
        );
        this.completeSubObjective('reinstall_wheel', 40);
        if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        return;
      }
      this.wrongTargetFeedback('Klicke die Radnabe mit der Hand [1] an, um das Serienrad aufzusetzen.');
      return;
    }

    // 4. Torque 5 lug bolts (120 Nm star pattern)
    if (!this.wheelTorqueDone) {
      if (id.startsWith('lugBolt_') || id === 'frontRightWheel') {
        if (!this.requireTool('torqueWrench')) return;
        const targetBoltId = id.startsWith('lugBolt_') ? id : 'lugBolt_0';
        const pos = this.getInteractableWorldPos(targetBoltId) ?? new THREE.Vector3(0.76, 0.32, -1.32);
        this.openFasteningStage('wheel', pos);
        this.sound.playClick();
        this.broadcastHud(true);
        return;
      }
      this.wrongTargetFeedback(`Ziehe die 5 Radschrauben mit [7] über Kreuz mit je ${CLHA_MONTAGE_VALUES.wheelBoltNm} Nm an.`);
      return;
    }

    // 5. Clip TDI engine cover & close hood
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
        this.showToast('TDI-Motorabdeckung aufgesteckt & Haube geschlossen — lasse jetzt die Hebebühne ab!', 'success');
        this.completeSubObjective('reinstall_cover_hood', 45);
        return;
      }
      this.wrongTargetFeedback('Klicke die Motorhaube [1] an, um die Abdeckung aufzustecken und die Haube zu schließen.');
      return;
    }

    // 6. Lower lift
    if (this.liftRaised) {
      if (id === 'liftControlDown') {
        if (!this.requireTool('hand')) return;
        this.liftRaised = false;
        this.sound.playLiftMotor(2.0);
        this.showToast('Hebebühne fährt komplett herunter… Danach Probelauf!', 'success');
        this.scheduleTimeout(() => {
          this.completeSubObjective('lower_lift', 55);
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
  // Minigame Resolution (Nm & ° Stages with Retry-on-Miss)
  // =========================================================================

  private recordTorqueScore(entry: TorqueScore): void {
    const existingIdx = this.torqueScores.findIndex((s) => s.label === entry.label);
    if (existingIdx >= 0) {
      const prev = this.torqueScores[existingIdx];
      this.torqueScores[existingIdx] = entry;
      if (entry.xp > prev.xp) {
        this.xp += entry.xp - prev.xp;
      }
    } else {
      this.torqueScores.push(entry);
      this.xp += entry.xp;
    }
  }

  private finalizeTorqueAttempt(): void {
    if (this.minigame.type !== 'torque' || !this.pendingTorque) return;
    const {
      targetValue,
      inputWindow,
      currentValue,
      unit,
      decimals,
      stageKind,
    } = this.minigame;
    const ctx = this.pendingTorque;
    const spec = CLHA_FASTENING_STAGES[ctx.kind];

    const delta = currentValue - targetValue;
    const absDelta = Math.abs(delta);
    const achievedStr = formatMeasure(currentValue, unit, decimals);
    const targetStr = formatMeasure(targetValue, unit, 0);

    // Missed attempts NEVER advance the step -> reset and retry!
    if (absDelta > inputWindow) {
      const tooLow = currentValue < targetValue;
      const isSeriousAttempt = currentValue >= targetValue * 0.25;
      if (isSeriousAttempt) {
        this.mistakes += 1;
      }
      this.sound.playError();

      const feedback = !isSeriousAttempt
        ? `Halten, bis ${targetStr} im Spielhilfefenster liegt.`
        : stageKind === 'angle'
          ? tooLow
            ? `${achievedStr} zu kurz. Winkelübung zurückgesetzt. Ziele erneut auf ${targetStr}.`
            : `${achievedStr} überschritten. Winkelübung zurückgesetzt. Ziele erneut auf ${targetStr}.`
          : tooLow
            ? `${achievedStr} zu gering. Übung zurückgesetzt. Ziele erneut auf ${targetStr}.`
            : `${achievedStr} überschritten. Übung zurückgesetzt. Ziele erneut auf ${targetStr}.`;

      this.minigame = {
        ...this.minigame,
        currentValue: 0,
        attemptStatus: 'retry',
        lastAttemptValue: Number(currentValue.toFixed(decimals)),
        lastAttemptFeedback: feedback,
      };
      this.showToast(feedback, isSeriousAttempt ? 'error' : 'warning');
      this.broadcastHud(true);
      return;
    }

    this.sound.playTorqueClick();
    this.toolModels.playToolAction('torqueWrench', ctx.worldPos, 0.68);

    const rating: TorqueScore['rating'] = absDelta <= inputWindow * 0.5 ? 'Perfekt' : 'Gut';
    const scoreXp = rating === 'Perfekt' ? 100 : 75;

    this.recordTorqueScore({
      label: spec.scoreLabel,
      stageKind,
      unit,
      targetValue,
      targetLabel: spec.targetLabel,
      achievedValue: Number(currentValue.toFixed(decimals)),
      deltaValue: Number(delta.toFixed(decimals)),
      decimals,
      rating,
      xp: scoreXp,
    });

    // Chained 2-stage transitions
    if (ctx.kind === 'tensioner_torque') {
      this.tensionerTorqueStage1Done = true;
      this.completeSubObjective('torque_tensioner_stage1', 0);
      this.showToast(
        `${rating}! Voranzug erledigt (${achievedStr}, ${formatSignedDelta(delta, unit, decimals)}). Jetzt Stufe 2/2: +${CLHA_MONTAGE_VALUES.tensionerAngleDeg}°.`,
        'success'
      );
      this.openFasteningStage('tensioner_angle', ctx.worldPos);
      this.broadcastHud(true);
      return;
    }

    if (ctx.kind === 'engine_support_torque') {
      this.engineSupportStage1Done = true;
      this.showToast(
        `${rating}! Stufe 2 (${achievedStr}) an allen 3 Schrauben (1→2→3) erledigt. Jetzt Stufe 3: +${CLHA_MONTAGE_VALUES.engineSupportAngleDeg}°!`,
        'success'
      );
      this.openFasteningStage('engine_support_angle', ctx.worldPos);
      this.broadcastHud(true);
      return;
    }

    if (ctx.kind === 'crank_damper_torque') {
      this.crankDamperStage1Done = true;
      this.showToast(
        `${rating}! Voranzug (${achievedStr}) erledigt. Jetzt separate Winkelstufe: +${CLHA_MONTAGE_VALUES.crankDamperOuterAngleDeg}°!`,
        'success'
      );
      this.openFasteningStage('crank_damper_angle', ctx.worldPos);
      this.broadcastHud(true);
      return;
    }

    // Close minigame & counterhold
    this.minigame = { type: 'none' };
    this.pendingTorque = null;
    this.toolModels.setActiveCounterhold(false);

    switch (ctx.kind) {
      case 'tensioner_angle':
        this.tensionerTorqued = true;
        this.showToast(
          `${rating}! Spannrollen-Mutter gesichert (${CLHA_MONTAGE_VALUES.tensionerTorqueNm} Nm + ${achievedStr})! Jetzt nach Abb. A15-11412 NW & HDP unter Gegenzug (${CLHA_SPECIAL_TOOLS.camCounterhold} ↺) auf 20 Nm voranziehen [7].`,
          'success'
        );
        this.completeSubObjective('angle_tensioner_stage2', 0);
        this.selectCamera('timingClose');
        if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        break;

      case 'cam_pretorque':
        this.camPretorqued = true;
        this.showToast(
          `${rating}! NW-Zentralschraube unter Gegenzug (${CLHA_SPECIAL_TOOLS.camCounterhold} ↺) auf ${achievedStr} vorgezogen! Ziehe jetzt separat die HDP-Mutter auf ${CLHA_MONTAGE_VALUES.hpPumpNutPreNm} Nm voran [7].`,
          'success'
        );
        this.completeSubObjective('pretorque_cam_20nm', 0);
        if (this.mode === 'guide') this.activeTool = 'torqueWrench';
        break;

      case 'pump_pretorque':
        this.pumpPretorqued = true;
        this.showToast(
          `${rating}! HDP-Mutter separat auf ${achievedStr} vorgezogen! Prüfe jetzt mit [1] am HDP-Rad den Rest-Verstellweg (Abb. N15-10906: Markierung nicht bündig mit ${CLHA_LOCK_TOOLS.pump.code}).`,
          'success'
        );
        if (this.mode === 'guide') this.activeTool = 'hand';
        break;

      case 'cam_final_torque':
        this.camCenterFinalTorqued = true;
        this.showToast(
          `${rating}! NW-Zentralschraube Endanzug (${achievedStr}) mit ${CLHA_SPECIAL_TOOLS.camCounterhold} OK! Jetzt HDP-Mutter Endanzug ${CLHA_MONTAGE_VALUES.hpPumpNutFinalNm} Nm mit ${CLHA_SPECIAL_TOOLS.pumpCounterhold} [7].`,
          'success'
        );
        this.completeSubObjective('final_torque_cam', 0);
        break;

      case 'pump_final_torque':
        this.pumpFinalTorqued = true;
        this.showToast(
          `${rating}! HDP-Mutter Endanzug (${achievedStr}) mit ${CLHA_SPECIAL_TOOLS.pumpCounterhold} OK! Jetzt 3. Abschlusskontrolle (VW S. 123): ${CLHA_LOCK_TOOLS.crank.code} abnehmen [5] & 2× (720°) prüfen.`,
          'success'
        );
        this.completeSubObjective('final_torque_pump', 0);
        if (this.mode === 'guide') this.activeTool = 'lockingPins';
        break;

      case 'engine_support_angle':
        this.engineSupportReinstalled = true;
        this.engine.setUpperTimingCoverSlotVisible(true);
        this.showToast(
          `${rating}! Motorstütze (3 neue Schrauben: 7 → 40 Nm + ${achievedStr}) festgezogen! Jetzt oberen Zahnriemenschutz einklipsen [1].`,
          'success'
        );
        this.completeSubObjective('reinstall_engine_support', 0);
        if (this.mode === 'guide') this.activeTool = 'hand';
        break;

      case 'crank_damper_angle':
        this.crankDamperReinstalled = true;
        this.engine.setAuxBeltRemoved(true, true);
        this.showToast(
          `${rating}! Schwingungsdämpfer (4 neue Schrauben: 10 Nm + ${achievedStr}) gesichert! Lege jetzt den Keilrippenriemen auf [1].`,
          'success'
        );
        this.completeSubObjective('reinstall_crank_damper', 0);
        if (this.mode === 'guide') this.activeTool = 'hand';
        break;

      case 'wheel':
        this.wheelTorqueDone = true;
        for (let i = 0; i < STAR_BOLT_ORDER.length; i++) {
          const boltIdx = STAR_BOLT_ORDER[i];
          this.scheduleTimeout(() => {
            this.wheelBoltsTorqued[boltIdx] = true;
            const bPos = this.getInteractableWorldPos(`lugBolt_${boltIdx}` as InteractableId);
            if (bPos && i > 0) {
              this.toolModels.playToolAction('torqueWrench', bPos, 0.25);
              this.sound.playTorqueClick();
            }
          }, i * 170);
        }
        this.showToast(
          `${rating}! Serienrad über Kreuz mit je ${achievedStr} angezogen (+${scoreXp} XP).`,
          'success'
        );
        this.scheduleTimeout(() => {
          this.completeSubObjective('torque_wheel_bolts', 0);
          this.selectCamera('overview');
          if (this.mode === 'guide') this.activeTool = 'hand';
        }, 880);
        break;
    }

    this.broadcastHud(true);
  }

  // =========================================================================
  // Guide Tool & 3D Pulsing Beacon Resolution
  // =========================================================================

  private computeRecommendedTool(): ToolId | null {
    if (!this.started || this.completed || this.mode !== 'guide') return null;
    switch (this.stepIndex) {
      case 0:
      case 1:
        return 'hand';
      case 2:
        if (!this.lugBoltsRemoved.every(Boolean)) return 'impact17';
        if (!this.wheelRemoved) return 'hand';
        if (!this.underbodyRemoved || !this.linerScrewsRemoved.every(Boolean)) return 'torx25';
        return 'hand';
      case 3:
        if (!this.auxTensionerSwung) return 'eccentricKey';
        if (!this.auxPinned) return 'lockingPins';
        if (!this.auxBeltRemoved) return 'hand';
        if (!this.crankDamperUnbolted) return 'impact17';
        return 'hand';
      case 4:
        if (!this.engineBridgeInstalled || !this.upperCoverRemoved) return 'hand';
        if (!this.engineMountRemoved) return this.engineMountUnbolted ? 'hand' : 'crankWrench';
        return this.engineSupportUnbolted ? 'hand' : 'crankWrench';
      case 5:
        return this.lowerCoverBoltRemoved ? 'hand' : 'torx25';
      case 6:
        return 'crankWrench';
      case 7:
        if (!this.completedSubObjectives.has('lock_cam_initial')) return 'lockingPins';
        if (!this.camFixBoltLoosened) return 'torx25';
        if (!this.completedSubObjectives.has('lock_crank')) return 'lockingPins';
        if (!this.completedSubObjectives.has('loosen_cam_hub')) {
          if (!this.camHubLoosened) return this.lockedShafts.has('cam') ? 'lockingPins' : 'crankWrench';
          return 'lockingPins';
        }
        if (!this.pumpHubPinnedOnce) return 'lockingPins';
        if (!this.pumpHubLoosened) return this.lockedShafts.has('pump') ? 'lockingPins' : 'crankWrench';
        return 'lockingPins';
      case 8:
        if (!this.oldTensionerReleased) return 'eccentricKey';
        if (!this.tensionerPinnedTypeB) return 'lockingPins';
        return 'hand';
      case 9:
        return this.sprocketsPreppedCw ? 'newTimingBelt' : 'hand';
      case 10:
        if (this.tensionerPinnedTypeB) return 'lockingPins';
        if (!this.tensionPointerAligned) return 'eccentricKey';
        if (!this.tensionerTorqued) return 'torqueWrench';
        if (!this.camPretorqued || !this.pumpPretorqued) return 'torqueWrench';
        if (!this.pumpTravelChecked) return 'hand';
        return 'lockingPins';
      case 11:
        if (!this.check1PointerOk) {
          if (!this.check1Cranked) return 'crankWrench';
          if (!this.check1CamLocked) return 'lockingPins';
          return 'hand';
        }
        if (!this.check2PointerOk) {
          if (!this.check2LocksCleared) return 'lockingPins';
          if (!this.check2Cranked) return 'crankWrench';
          if (!this.check2CamLocked) return 'lockingPins';
          return 'hand';
        }
        if (!this.camCenterFinalTorqued) return this.lockedShafts.has('cam') ? 'lockingPins' : 'torqueWrench';
        if (!this.pumpFinalTorqued) return this.lockedShafts.has('pump') ? 'lockingPins' : 'torqueWrench';
        if (!this.check3AllToolsRemoved) {
          if (!this.check3LocksCleared) return 'lockingPins';
          if (!this.check3Cranked) return 'crankWrench';
          if (!this.check3CamLocked) return 'lockingPins';
          if (!this.check3PointerOk) return 'hand';
          return 'lockingPins';
        }
        return 'torqueWrench';
      case 12:
        if (!this.lowerCoverReinstalled) return this.lowerCoverSeated ? 'torx25' : 'hand';
        if (!this.engineSupportReinstalled) return this.engineSupportSeated ? 'torqueWrench' : 'hand';
        if (!this.upperCoverReinstalled) return 'hand';
        if (!this.engineMountReinstalled) return this.engineMountSeated ? 'torqueWrench' : 'hand';
        return 'hand';
      case 13:
        if (!this.crankDamperReinstalled) return this.crankDamperSeated ? 'torqueWrench' : 'hand';
        if (!this.auxBeltReinstalled) {
          if (!this.auxBeltSeated) return 'hand';
          if (!this.auxTensionerHeldForUnpin) return 'eccentricKey';
          return 'lockingPins';
        }
        return 'hand';
      case 14:
        if (!this.linerReinstalled) return this.linerSeatedInReassembly ? 'torx25' : 'hand';
        if (!this.underbodyReinstalled || !this.wheelReinstalled) return 'hand';
        if (!this.wheelTorqueDone) return 'torqueWrench';
        return 'hand';
      default:
        return 'hand';
    }
  }

  private computeGuideTargetId(): InteractableId | null {
    if (
      !this.started ||
      this.completed ||
      this.mode !== 'guide' ||
      this.minigame.type !== 'none' ||
      this.engine.isManualCrankAnimating()
    ) {
      return null;
    }

    switch (this.stepIndex) {
      case 0:
        if (!this.hoodOpen) return 'hood';
        if (!this.liftRaised) return 'liftControlUp';
        if (!this.engineCoverRemoved) return 'engineCover';
        return null;
      case 1:
        if (!this.coolantTankMoved) return 'coolantTank';
        if (!this.fuelLinesDisconnected) return 'fuelLines';
        if (!this.fuelFilterMoved) return 'fuelFilter';
        return null;
      case 2: {
        const nextBolt = this.lugBoltsRemoved.findIndex((d) => !d);
        if (nextBolt >= 0) return `lugBolt_${nextBolt}` as InteractableId;
        if (!this.wheelRemoved) return 'frontRightWheel';
        if (!this.underbodyRemoved) return 'underbodyTray';
        const nextScrew = this.linerScrewsRemoved.findIndex((d) => !d);
        if (nextScrew >= 0) return `linerScrew_${nextScrew}` as InteractableId;
        if (!this.linerRemoved) return 'wheelLiner';
        return null;
      }
      case 3:
        if (!this.auxTensionerSwung || !this.auxPinned) return 'auxTensioner';
        if (!this.auxBeltRemoved) return 'auxBelt';
        if (!this.crankDamperRemoved) return 'crankDamper';
        return null;
      case 4:
        if (!this.engineBridgeInstalled) return 'engineBridgeSlot';
        if (!this.upperCoverRemoved) return 'upperTimingCover';
        if (!this.engineMountRemoved) return 'engineMount';
        if (!this.engineSupportRemoved) return 'engineSupport';
        return null;
      case 5:
        if (!this.lowerCoverBoltRemoved) return 'lowerCoverBolt';
        if (!this.lowerCoverRemoved) return 'lowerTimingCover';
        return 'oldTimingBelt';
      case 6:
        return 'wheel_crank';
      case 7:
        if (!this.completedSubObjectives.has('lock_cam_initial')) return 'wheel_cam';
        if (!this.camFixBoltLoosened) return 'camFixBolt';
        if (!this.completedSubObjectives.has('lock_crank')) return 'wheel_crank';
        if (!this.completedSubObjectives.has('loosen_cam_hub')) {
          if (!this.camHubLoosened) return this.lockedShafts.has('cam') ? 'lockPin_cam' : 'camCenterBolt';
          return 'wheel_cam';
        }
        if (!this.pumpHubPinnedOnce) return 'wheel_pump';
        if (!this.pumpHubLoosened) return this.lockedShafts.has('pump') ? 'lockPin_pump' : 'pumpCenterNut';
        return 'wheel_pump';
      case 8:
        if (!this.oldTensionerReleased || !this.tensionerPinnedTypeB) return 'wheel_tensioner';
        if (!this.oldBeltRemoved) return 'oldTimingBelt';
        if (!this.waterPumpChecked) return 'wheel_water';
        if (!this.idlersChecked.lower) return 'wheel_lower';
        if (!this.idlersChecked.upper) return 'wheel_upper';
        return null;
      case 9: {
        if (!this.sprocketsPreppedCw) return 'wheel_cam';
        const nextSt = VW_LAY_ORDER[this.beltRoutingProgress.length];
        return nextSt ? (`wheel_${nextSt}` as InteractableId) : null;
      }
      case 10:
        if (this.tensionerPinnedTypeB) return 'tensionerLockPin';
        if (!this.tensionPointerAligned) return 'wheel_tensioner';
        if (!this.tensionerTorqued) return 'tensionerNut';
        if (!this.camPretorqued) return 'camCenterBolt';
        if (!this.pumpPretorqued) return 'pumpCenterNut';
        if (!this.pumpTravelChecked) return 'wheel_pump';
        if (this.lockedShafts.has('cam')) return 'lockPin_cam';
        if (this.lockedShafts.has('pump')) return 'lockPin_pump';
        if (this.lockedShafts.has('crank')) return 'lockPin_crank';
        return null;
      case 11:
        if (!this.check1PointerOk) {
          if (!this.check1Cranked) return 'wheel_crank';
          if (!this.check1CrankLocked) return 'wheel_crank';
          if (!this.check1CamLocked) return 'wheel_cam';
          return 'wheel_tensioner';
        }
        if (!this.check2PointerOk) {
          if (!this.check2LocksCleared) {
            if (this.lockedShafts.has('cam')) return 'lockPin_cam';
            if (this.lockedShafts.has('crank')) return 'lockPin_crank';
          }
          if (!this.check2Cranked) return 'wheel_crank';
          if (!this.check2CrankLocked) return 'wheel_crank';
          if (!this.check2CamLocked) return 'wheel_cam';
          return 'wheel_tensioner';
        }
        if (!this.camCenterFinalTorqued) {
          if (this.lockedShafts.has('cam')) return 'lockPin_cam';
          return 'camCenterBolt';
        }
        if (!this.pumpFinalTorqued) {
          if (this.lockedShafts.has('pump')) return 'lockPin_pump';
          return 'pumpCenterNut';
        }
        if (!this.check3AllToolsRemoved) {
          if (!this.check3LocksCleared) return 'lockPin_crank';
          if (!this.check3Cranked) return 'wheel_crank';
          if (!this.check3CrankLocked) return 'wheel_crank';
          if (!this.check3CamLocked) return 'wheel_cam';
          if (!this.check3PointerOk) return 'wheel_tensioner';
          if (this.lockedShafts.has('cam')) return 'lockPin_cam';
          if (this.lockedShafts.has('crank')) return 'lockPin_crank';
        }
        if (!this.camFixFinalTorqued) return 'camFixBolt';
        return null;
      case 12:
        if (!this.lowerCoverReinstalled) return this.lowerCoverSeated ? 'lowerCoverBolt' : 'lowerTimingCoverSlot';
        if (!this.engineSupportReinstalled) return this.engineSupportSeated ? 'engineSupport' : 'engineSupportSlot';
        if (!this.upperCoverReinstalled) return 'upperTimingCoverSlot';
        if (!this.engineMountReinstalled) return this.engineMountSeated ? 'engineMount' : 'engineMountSlot';
        if (!this.engineBridgeRemovedAfterReassembly) return 'engineBridge';
        return null;
      case 13:
        if (!this.crankDamperReinstalled) return this.crankDamperSeated ? 'crankDamper' : 'crankDamperSlot';
        if (!this.auxBeltReinstalled) {
          if (!this.auxBeltSeated) return 'auxBeltSlot';
          if (!this.auxTensionerHeldForUnpin) return 'auxTensioner';
          return 'auxLockPin';
        }
        if (this.fuelFilterMoved) return 'fuelFilter';
        if (this.fuelLinesDisconnected) return 'fuelLines';
        if (this.coolantTankMoved) return 'coolantTank';
        return null;
      case 14:
        if (!this.linerReinstalled) return this.linerSeatedInReassembly ? 'wheelLiner' : 'wheelLinerSlot';
        if (!this.underbodyReinstalled) return 'underbodyTray';
        if (!this.wheelReinstalled) return 'wheelHub';
        if (!this.wheelTorqueDone) return 'lugBolt_0';
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

    if (this.started && !this.completed) {
      this.elapsedSeconds += dt;
      const wholeSec = Math.floor(this.elapsedSeconds);
      if (wholeSec !== this.lastSecondBroadcast) {
        this.lastSecondBroadcast = wholeSec;
        this.hudDirty = true;
      }
    }

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

    // Final Engine Probelauf (Step 16)
    if (this.engineRunning) {
      this.engineRpm = 820 + Math.round(Math.sin(now * 0.012) * 8);
      if (
        this.started &&
        this.stepIndex === 15 &&
        !this.completedSubObjectives.has('engine_idle_check')
      ) {
        this.engineRunTimer += dt;
        if (this.engineRunTimer >= 1.8) {
          this.showToast(
            '1.6 TDI (CLHA) läuft absolut ruhig im Leerlauf — Zahnriemenwechsel erfolgreich abgenommen!',
            'success'
          );
          this.stopEngineImmediate();
          this.completeSubObjective('engine_idle_check', 100);
        }
      } else if (now - this.lastHudSyncTime > 120) {
        this.hudDirty = true;
      }
    }

    this.updateMinigames(dt);

    this.cameraController.update(dt);
    this.golf7.update(dt);
    this.engine.update(dt);
    this.toolModels.update(dt);
    this.updateBeacon(dt);

    this.sceneManager.render();

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
    if (this.minigame.type === 'auxTensioner') {
      if (this.auxPressing) {
        const nextDeg = Math.min(38, this.minigame.swingDeg + dt * 36);
        this.auxTensionerSwingDeg = nextDeg;
        this.engine.setAuxTensionerState(nextDeg, this.auxPinned);
        this.updateLiveTools();
        const aligned = nextDeg >= this.minigame.targetMinDeg && nextDeg <= this.minigame.targetMaxDeg;
        this.minigame = { ...this.minigame, swingDeg: nextDeg, aligned };
        this.hudDirty = true;
      }
    } else if (this.minigame.type === 'ot') {
      if (this.otPressing) {
        this.crankAngleDeg = Math.min(760, this.crankAngleDeg + dt * 44);
        this.engine.setCrankAngle(this.crankAngleDeg);
        this.updateLiveTools();
        const aligned = isAtOT(this.crankAngleDeg, this.minigame.toleranceDeg);
        this.minigame = { ...this.minigame, crankDeg: this.crankAngleDeg, aligned };
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
            this.showToast(
              `Spannrolle Typ B entlastet! Stecke sie jetzt mit Stift ${CLHA_SPECIAL_TOOLS.tensionerPinTypeB} [5] ab.`,
              'success'
            );
            this.completeSubObjective('release_old_tensioner', 50);
            if (this.mode === 'guide') this.activeTool = 'lockingPins';
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
        this.tensionNormalized = Math.min(0.92, this.tensionNormalized + dt * 0.34);
        this.engine.setTension(this.tensionNormalized);
        this.updateLiveTools();
        const aligned =
          this.tensionNormalized >= this.minigame.targetMin &&
          this.tensionNormalized <= this.minigame.targetMax;
        this.minigame = { ...this.minigame, tension: this.tensionNormalized, aligned };
        this.hudDirty = true;
      }
    } else if (this.minigame.type === 'torque' && this.torquePressing && this.pendingTorque) {
      const rate = CLHA_FASTENING_STAGES[this.pendingTorque.kind].ratePerSec;
      const nextValue = Math.min(this.minigame.maxValue, this.minigame.currentValue + rate * dt);
      this.minigame = { ...this.minigame, currentValue: nextValue };
      if (nextValue >= this.minigame.maxValue) {
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
    }, 4200);
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
