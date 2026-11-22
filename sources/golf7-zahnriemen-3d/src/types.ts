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
  | 'tensionerMacro';

export type TimingWheelId =
  | 'crank'
  | 'lower'
  | 'tensioner'
  | 'cam'
  | 'upper'
  | 'pump'
  | 'water';

export type LockableWheelId = 'crank' | 'cam' | 'pump';

export type InteractableId =
  | 'hood'
  | 'liftControlUp'
  | 'liftControlDown'
  | 'engineCover'
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
  | 'timingCoverBolt_0'
  | 'timingCoverBolt_1'
  | 'timingCover'
  | 'timingCoverSlot'
  | 'oldTimingBelt'
  | 'newTimingBeltSlot'
  | 'wheel_crank'
  | 'wheel_lower'
  | 'wheel_tensioner'
  | 'tensionerNut'
  | 'wheel_cam'
  | 'wheel_upper'
  | 'wheel_pump'
  | 'wheel_water'
  | 'lockPin_crank'
  | 'lockPin_cam'
  | 'lockPin_pump';

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
  spec: string;
}

export interface CameraPresetDefinition {
  id: CameraPresetId;
  hotkey: string;
  label: string;
}

export type MinigameState =
  | { type: 'none' }
  | {
      type: 'ot';
      crankDeg: number; // 620..760 (720 = OT)
      targetDeg: number; // 720
      toleranceDeg: number; // 4
      aligned: boolean;
    }
  | {
      type: 'eccentric';
      tension: number; // 0..1 (0.50 = centered in reference window)
      targetMin: number; // 0.46
      targetMax: number; // 0.54
      aligned: boolean;
      mode: 'release' | 'set';
    }
  | {
      type: 'torque';
      targetPct: number; // 100 (% Sollmoment nach RLF)
      tolerancePct: number; // 6
      maxPct: number; // 135
      currentPct: number;
      label: string;
      boltLabel: string;
      active: boolean;
    };

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'warning' | 'error';
}

export interface TorqueScore {
  label: string;
  targetLabel: string;
  achievedPct: number;
  deltaPct: number;
  rating: 'Perfekt' | 'Gut' | 'Akzeptabel' | 'Daneben';
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
  crankAngleDeg: number;
  otAligned: boolean;
  tensionNormalized: number;
  lockedShafts: LockableWheelId[];
  beltRoutingProgress: TimingWheelId[];
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
  onOtPressChange: (pressing: boolean) => void;
  onOtReset: () => void;
  onEccentricPressChange: (pressing: boolean) => void;
  onEccentricReset: () => void;
  onTorquePressChange: (pressing: boolean) => void;
  onResetGame: () => void;
  onFreeInspect: () => void;
}
