export type GameMode = 'guide' | 'pro';

export type ToolId =
  | 'hand'
  | 'impact17'
  | 'torx25'
  | 'wrench16'
  | 'pinT10060A'
  | 'ratchet13'
  | 'torqueWrench'
  | 'newParts';

export type CameraPresetId =
  | 'overview'
  | 'engineTop'
  | 'wheelWell'
  | 'beltClose'
  | 'tensionerMacro';

export type BeltPulleyNode = 'crank' | 'ac' | 'alternator' | 'tensioner';

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
  | 'oldBelt'
  | 'newBeltSlot'
  | 'tensionerHex'
  | 'tensionerPinHole'
  | 'tensionerBolt'
  | 'tensionerMountSlot'
  | 'pulley_crank'
  | 'pulley_ac'
  | 'pulley_alternator'
  | 'pulley_tensioner'
  | 'crankBolt';

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
  torqueSpec?: string;
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
      type: 'tensioner';
      progress: number; // 0..1 (0 = resting tensioned, 1 = full clockwise 35° lock alignment)
      targetMin: number; // e.g. 0.80
      targetMax: number; // e.g. 1.00
      aligned: boolean;
      mode: 'lock' | 'unlock';
    }
  | {
      type: 'torque';
      targetNm: number;
      toleranceNm: number;
      maxNm: number;
      currentNm: number;
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
  targetNm: number;
  achievedNm: number;
  deltaNm: number;
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
  beltRoutingProgress: BeltPulleyNode[];
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
  onTensionerPressChange: (pressing: boolean) => void;
  onTorquePressChange: (pressing: boolean) => void;
  onResetGame: () => void;
  onFreeInspect: () => void;
}
