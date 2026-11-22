export type GameMode = 'guide' | 'pro';

export type ToolId =
  | 'hand'
  | 'impact17'
  | 'torx25'
  | 'crankWrench'
  | 'lockingPins'
  | 'eccentricKey'
  | 'torqueWrench'
  | 'newTimingBelt';

export type CameraPresetId =
  | 'overview'
  | 'engineTop'
  | 'wheelWell'
  | 'timingClose'
  | 'tensionerMacro'
  | 'oilSump';

export type TimingWheelId =
  | 'crank'
  | 'lower'
  | 'tensioner'
  | 'cam'
  | 'upper'
  | 'pump'
  | 'water';

/** Official VW Rep.-Gr. 15 S. 118 primary laying stations (passive idlers guided in-line). */
export type VwBeltLayStationId = 'crank' | 'tensioner' | 'cam' | 'pump' | 'water';

export type LockableWheelId = 'crank' | 'cam' | 'pump';

export type InteractableId =
  | 'hood'
  | 'liftControlUp'
  | 'liftControlDown'
  | 'engineCover'
  | 'coolantTank'
  | 'fuelLines'
  | 'fuelFilter'
  | 'underbodyTray'
  | 'engineBridgeSlot'
  | 'engineBridge'
  | 'engineMount'
  | 'engineMountSlot'
  | 'engineSupport'
  | 'engineSupportSlot'
  | 'lugBolt_0'
  | 'lugBolt_1'
  | 'lugBolt_2'
  | 'lugBolt_3'
  | 'lugBolt_4'
  | 'frontRightWheel'
  | 'wheelHub'
  | 'linerScrew_0'
  | 'linerScrew_1'
  | 'linerScrew_2'
  | 'linerScrew_3'
  | 'linerScrew_4'
  | 'linerScrew_5'
  | 'wheelLiner'
  | 'wheelLinerSlot'
  | 'auxTensioner'
  | 'auxLockPin'
  | 'auxBelt'
  | 'auxBeltSlot'
  | 'crankDamper'
  | 'crankDamperSlot'
  | 'upperTimingCover'
  | 'upperTimingCoverSlot'
  | 'lowerCoverBolt'
  | 'lowerTimingCover'
  | 'lowerTimingCoverSlot'
  | 'oldTimingBelt'
  | 'newTimingBeltSlot'
  | 'wheel_crank'
  | 'wheel_lower'
  | 'wheel_tensioner'
  | 'tensionerNut'
  | 'tensionerLockPin'
  | 'wheel_cam'
  | 'camCenterBolt'
  | 'camFixBolt'
  | 'wheel_upper'
  | 'wheel_pump'
  | 'pumpCenterNut'
  | 'wheel_water'
  | 'lockPin_crank'
  | 'lockPin_cam'
  | 'lockPin_pump'
  | 'oilPumpBelt';

export interface InteractableMeta {
  id: InteractableId;
  label: string;
  partNumber?: string;
  status?: string;
  hint?: string;
}

export interface SubObjective {
  id: string;
  label: string;
}

export interface StepDefinition {
  index: number;
  id: string;
  title: string;
  subtitle: string;
  description: string;
  whyTip: string;
  requiredTools: ToolId[];
  specBadge?: string;
  cameraPreset: CameraPresetId;
  subObjectives: SubObjective[];
}

export interface ToolDefinition {
  id: ToolId;
  hotkey: string;
  name: string;
  shortName: string;
  shortSpec: string;
  spec: string;
}

export interface CameraPresetDefinition {
  id: CameraPresetId;
  hotkey: string;
  label: string;
}

export type FasteningUnit = 'Nm' | '°';

export type FasteningStageId =
  | 'tensioner_torque'
  | 'tensioner_angle'
  | 'cam_pretorque'
  | 'pump_pretorque'
  | 'cam_final_torque'
  | 'pump_final_torque'
  | 'engine_support_torque'
  | 'engine_support_angle'
  | 'crank_damper_torque'
  | 'crank_damper_angle'
  | 'wheel';

export type MinigameState =
  | { type: 'none' }
  | {
      type: 'auxTensioner';
      swingDeg: number; // 0..38° (target 28..35° for T10060 A)
      targetMinDeg: number;
      targetMaxDeg: number;
      aligned: boolean;
      mode: 'pin' | 'unpin';
    }
  | {
      type: 'ot';
      crankDeg: number; // 620..760 (720 = OT)
      targetDeg: number; // 720
      toleranceDeg: number; // 4 (Spielhilfe-Eingabefenster)
      unit: '°';
      aligned: boolean;
    }
  | {
      type: 'eccentric';
      tension: number; // 0..1 (0.50 = Zeiger mittig im Spalt)
      targetMin: number; // 0.46 (Spielhilfe)
      targetMax: number; // 0.54 (Spielhilfe)
      aligned: boolean;
      mode: 'release' | 'set';
    }
  | {
      type: 'torque';
      stageId: FasteningStageId;
      stageKind: 'torque' | 'angle';
      stageIndex: number; // 1 oder 2
      stageTotal: number; // 1 oder 2
      stage1PillLabel?: string;
      stage2PillLabel?: string;
      unit: FasteningUnit;
      targetValue: number;
      inputWindow: number; // Spielhilfe-Eingabefenster (keine Werkstoleranz)
      maxValue: number;
      scaleTicks: number[];
      decimals: number;
      currentValue: number;
      label: string;
      boltLabel: string;
      specNote: string;
      attemptStatus: 'ready' | 'retry';
      lastAttemptValue?: number;
      lastAttemptFeedback?: string;
      active: boolean;
    };

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'warning' | 'error';
}

export interface TorqueScore {
  label: string;
  stageKind: 'torque' | 'angle';
  unit: FasteningUnit;
  targetValue: number;
  targetLabel: string;
  achievedValue: number;
  deltaValue: number;
  decimals: number;
  rating: 'Perfekt' | 'Gut';
  xp: number;
}

export interface GameSnapshot {
  started: boolean;
  mode: GameMode;
  stepIndex: number;
  completedSubObjectives: string[];
  activeTool: ToolId;
  recommendedTool: ToolId | null;
  activeCamera: CameraPresetId;
  xp: number;
  elapsedSeconds: number;
  mistakes: number;
  torqueScores: TorqueScore[];
  xrayEnabled: boolean;
  workLampEnabled: boolean;
  muted: boolean;
  engineRunning: boolean;
  engineRpm: number;
  liftRaised: boolean;
  diagramUnlocked: boolean;
  fuelSystemBleedRequired: boolean;
  fuelSystemBled: boolean;
  fuelBleedInProgress: boolean;
  oilSumpCutawayActive: boolean;
  crankAngleDeg: number;
  otAligned: boolean;
  tensionNormalized: number;
  lockedShafts: LockableWheelId[];
  beltRoutingProgress: VwBeltLayStationId[];
  minigame: MinigameState;
  hoveredPart: InteractableMeta | null;
  toast: ToastMessage | null;
  completed: boolean;
  freeInspectMode: boolean;
}

export interface HUDCallbacks {
  onStartGame: (mode: GameMode) => void;
  onSelectTool: (tool: ToolId) => void;
  onSelectCamera: (preset: CameraPresetId) => void;
  onToggleXRay: () => void;
  onToggleLamp: () => void;
  onToggleMute: () => void;
  onJumpToStep: (index: number) => void;
  onStartEngineToggle: () => void;
  onBleedFuelSystem: () => void;
  onAuxPressChange: (pressing: boolean) => void;
  onOtPressChange: (pressing: boolean) => void;
  onOtReset: () => void;
  onEccentricPressChange: (pressing: boolean) => void;
  onEccentricReset: () => void;
  onTorquePressChange: (pressing: boolean) => void;
  onResetGame: () => void;
  onFreeInspect: () => void;
}
