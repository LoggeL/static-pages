import { WORLD_H, WORLD_W, type ToolForceInput, type ToolId } from '../types.ts';

export interface ToolControllerCallbacks {
  onUserGesture: () => void;
  onToolChange: (tool: ToolId) => void;
  onShatterIce: () => void;
  onPaintIce: (wx: number, wy: number) => void;
  onEraseIce: (wx: number, wy: number) => void;
  onPaintRock: (wx: number, wy: number, erase: boolean) => void;
  onSlowMoChange: (slowMo: boolean) => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onToggleMenu: () => void;
  onFirstInteract: () => void;
  onVortexFire: () => void;
  onTryClickWorld?: (wx: number, wy: number) => boolean;
  isHoveringInteractive?: (wx: number, wy: number) => boolean;
}

const STROKE_STEP_M = 0.09;
const VELOCITY_EMA_ALPHA = 0.42;
const MAX_POINTER_SPEED = 16.0;
const VORTEX_DRAG_THRESHOLD = 0.12;
const DEFAULT_VORTEX_DIR_X = 0.5;
const DEFAULT_VORTEX_DIR_Y = 0.8660254;

/**
 * Handles stage pointer interactions, world coordinate mapping, velocity smoothing,
 * continuous stroke interpolation, vortex charging/aiming, and keyboard shortcuts.
 */
export class ToolController {
  private readonly stageEl: HTMLElement;
  private readonly callbacks: ToolControllerCallbacks;

  private enabled = true;
  private sandbox = false;
  private activeTool: ToolId = 'surge';

  private pointerWorld: { x: number; y: number; inside: boolean } = {
    x: WORLD_W * 0.5,
    y: WORLD_H * 0.5,
    inside: false,
  };

  private activePointerId: number | null = null;
  private isPrimaryDown = false;
  private isSecondaryDown = false;
  private hasInteracted = false;

  private vx = 0;
  private vy = 0;
  private prevStepX = WORLD_W * 0.5;
  private prevStepY = WORLD_H * 0.5;

  private lastStrokeX = 0;
  private lastStrokeY = 0;

  private isChargingVortex = false;
  private chargePos: { x: number; y: number } | undefined = undefined;
  private chargeTime = 0;
  private releaseBurst: ToolForceInput['releaseBurst'] = undefined;

  private shiftHeld = false;
  private slowMoToggled = false;

  constructor(stageEl: HTMLElement, callbacks: ToolControllerCallbacks) {
    this.stageEl = stageEl;
    this.callbacks = callbacks;

    this.stageEl.addEventListener('pointerdown', this.handlePointerDown);
    this.stageEl.addEventListener('pointermove', this.handlePointerMove);
    this.stageEl.addEventListener('pointerup', this.handlePointerUp);
    this.stageEl.addEventListener('pointercancel', this.handlePointerCancel);
    this.stageEl.addEventListener('pointerleave', this.handlePointerLeave);
    this.stageEl.addEventListener('contextmenu', this.handleContextMenu);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  public setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.cancelActivePointer();
      this.stageEl.style.cursor = 'crosshair';
      if (this.shiftHeld) {
        this.shiftHeld = false;
        this.callbacks.onSlowMoChange(this.slowMoToggled);
      }
    }
  }

  public setSandbox(v: boolean): void {
    this.sandbox = v;
    if (!v && (this.activeTool === 'pour' || this.activeTool === 'drain' || this.activeTool === 'rock')) {
      this.setActiveTool('surge');
      this.callbacks.onToolChange('surge');
    }
  }

  public setActiveTool(tool: ToolId): void {
    if (this.activeTool !== tool) {
      this.activeTool = tool;
      if (tool !== 'vortex') {
        this.isChargingVortex = false;
        this.chargePos = undefined;
        this.chargeTime = 0;
      }
    }
  }

  public getActiveTool(): ToolId {
    return this.activeTool;
  }

  public setSlowMo(slowMo: boolean): void {
    this.slowMoToggled = slowMo;
  }

  public getPointerWorld(): { x: number; y: number; inside: boolean } {
    return {
      x: this.pointerWorld.x,
      y: this.pointerWorld.y,
      inside: this.pointerWorld.inside,
    };
  }

  public update(dt: number): void {
    if (dt > 0.0001) {
      if (this.isPrimaryDown || this.isSecondaryDown) {
        const rawVx = (this.pointerWorld.x - this.prevStepX) / dt;
        const rawVy = (this.pointerWorld.y - this.prevStepY) / dt;
        this.vx = this.vx * (1 - VELOCITY_EMA_ALPHA) + rawVx * VELOCITY_EMA_ALPHA;
        this.vy = this.vy * (1 - VELOCITY_EMA_ALPHA) + rawVy * VELOCITY_EMA_ALPHA;

        const speed = Math.hypot(this.vx, this.vy);
        if (speed > MAX_POINTER_SPEED) {
          const scale = MAX_POINTER_SPEED / speed;
          this.vx *= scale;
          this.vy *= scale;
        }
      } else {
        this.vx = 0;
        this.vy = 0;
      }

      if (this.isChargingVortex && this.isPrimaryDown) {
        this.chargeTime += dt;
      }
    }

    this.prevStepX = this.pointerWorld.x;
    this.prevStepY = this.pointerWorld.y;
  }

  public getToolInput(): ToolForceInput {
    const isPaintTool = this.activeTool === 'ice' || this.activeTool === 'rock';
    return {
      tool: this.activeTool,
      active: isPaintTool ? (this.isPrimaryDown || this.isSecondaryDown) : this.isPrimaryDown,
      secondary: this.isSecondaryDown,
      x: this.pointerWorld.x,
      y: this.pointerWorld.y,
      vx: this.vx,
      vy: this.vy,
      chargePos: this.chargePos ? { x: this.chargePos.x, y: this.chargePos.y } : undefined,
      chargeTime: this.chargeTime,
      releaseBurst: this.releaseBurst ? { ...this.releaseBurst } : undefined,
    };
  }

  public consumeBurst(): void {
    this.releaseBurst = undefined;
  }

  public dispose(): void {
    this.stageEl.removeEventListener('pointerdown', this.handlePointerDown);
    this.stageEl.removeEventListener('pointermove', this.handlePointerMove);
    this.stageEl.removeEventListener('pointerup', this.handlePointerUp);
    this.stageEl.removeEventListener('pointercancel', this.handlePointerCancel);
    this.stageEl.removeEventListener('pointerleave', this.handlePointerLeave);
    this.stageEl.removeEventListener('contextmenu', this.handleContextMenu);

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
  }

  private clientToWorld(clientX: number, clientY: number): { wx: number; wy: number; inside: boolean } {
    const rect = this.stageEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { wx: WORLD_W * 0.5, wy: WORLD_H * 0.5, inside: false };
    }
    const wx = ((clientX - rect.left) / rect.width) * WORLD_W;
    const wy = (1 - (clientY - rect.top) / rect.height) * WORLD_H;
    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    return { wx, wy, inside };
  }

  private emitStrokePoint(wx: number, wy: number, erase: boolean): void {
    const cx = Math.max(0, Math.min(WORLD_W, wx));
    const cy = Math.max(0, Math.min(WORLD_H, wy));
    if (this.activeTool === 'ice') {
      if (erase) {
        this.callbacks.onEraseIce(cx, cy);
      } else {
        this.callbacks.onPaintIce(cx, cy);
      }
    } else if (this.activeTool === 'rock') {
      this.callbacks.onPaintRock(cx, cy, erase);
    }
  }

  private cancelActivePointer(): void {
    if (this.activePointerId !== null) {
      this.releaseCaptureSafe(this.activePointerId);
    }
    this.activePointerId = null;
    this.isPrimaryDown = false;
    this.isSecondaryDown = false;
    this.isChargingVortex = false;
    this.chargePos = undefined;
    this.chargeTime = 0;
    this.vx = 0;
    this.vy = 0;
  }

  private releaseCaptureSafe(pointerId: number): void {
    try {
      if (this.stageEl.hasPointerCapture(pointerId)) {
        this.stageEl.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore synthetic events where pointer capture does not exist.
    }
  }

  private readonly handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    this.callbacks.onUserGesture();
    if (!this.enabled) return;
    if (e.button !== 0 && e.button !== 2) return;
    if (this.activePointerId !== null) return;

    const { wx, wy, inside } = this.clientToWorld(e.clientX, e.clientY);
    this.pointerWorld.x = wx;
    this.pointerWorld.y = wy;
    this.pointerWorld.inside = inside;

    if (e.button === 0 && this.callbacks.onTryClickWorld?.(wx, wy)) {
      if (!this.hasInteracted) {
        this.hasInteracted = true;
        this.callbacks.onFirstInteract();
      }
      return;
    }

    if (!this.hasInteracted) {
      this.hasInteracted = true;
      this.callbacks.onFirstInteract();
    }

    const isSecondary = e.button === 2;
    this.activePointerId = e.pointerId;
    this.isPrimaryDown = !isSecondary;
    this.isSecondaryDown = isSecondary;

    try {
      this.stageEl.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without active pointer id.
    }

    this.prevStepX = wx;
    this.prevStepY = wy;
    this.vx = 0;
    this.vy = 0;

    if (this.activeTool === 'ice' || this.activeTool === 'rock') {
      this.lastStrokeX = wx;
      this.lastStrokeY = wy;
      this.emitStrokePoint(wx, wy, isSecondary);
    } else if (this.activeTool === 'vortex' && !isSecondary) {
      this.chargePos = { x: wx, y: wy };
      this.chargeTime = 0;
      this.isChargingVortex = true;
      this.releaseBurst = undefined;
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    const { wx, wy, inside } = this.clientToWorld(e.clientX, e.clientY);
    this.pointerWorld.x = wx;
    this.pointerWorld.y = wy;
    this.pointerWorld.inside = inside;

    const isDragging = this.isPrimaryDown || this.isSecondaryDown;
    if (!isDragging) {
      const hovering = this.enabled && inside && Boolean(this.callbacks.isHoveringInteractive?.(wx, wy));
      this.stageEl.style.cursor = hovering ? 'pointer' : 'crosshair';
    }

    if (!this.enabled) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    if (!isDragging) return;

    if (this.activeTool === 'ice' || this.activeTool === 'rock') {
      const dx = wx - this.lastStrokeX;
      const dy = wy - this.lastStrokeY;
      const dist = Math.hypot(dx, dy);
      if (dist >= STROKE_STEP_M) {
        const steps = Math.floor(dist / STROKE_STEP_M);
        const invDist = 1 / dist;
        for (let i = 1; i <= steps; i++) {
          const stepDist = i * STROKE_STEP_M;
          const px = this.lastStrokeX + dx * stepDist * invDist;
          const py = this.lastStrokeY + dy * stepDist * invDist;
          this.emitStrokePoint(px, py, this.isSecondaryDown);
        }
        const coveredRatio = (steps * STROKE_STEP_M) * invDist;
        this.lastStrokeX += dx * coveredRatio;
        this.lastStrokeY += dy * coveredRatio;
      }
    }
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    const { wx, wy, inside } = this.clientToWorld(e.clientX, e.clientY);
    this.pointerWorld.x = wx;
    this.pointerWorld.y = wy;
    this.pointerWorld.inside = inside;

    if (this.enabled && (this.isPrimaryDown || this.isSecondaryDown)) {
      if ((this.activeTool === 'ice' || this.activeTool === 'rock') && Math.hypot(wx - this.lastStrokeX, wy - this.lastStrokeY) >= 0.025) {
        this.emitStrokePoint(wx, wy, this.isSecondaryDown);
      } else if (this.activeTool === 'vortex' && this.isChargingVortex && this.chargePos) {
        const dx = wx - this.chargePos.x;
        const dy = wy - this.chargePos.y;
        const dist = Math.hypot(dx, dy);
        let dirX = DEFAULT_VORTEX_DIR_X;
        let dirY = DEFAULT_VORTEX_DIR_Y;
        if (dist > VORTEX_DRAG_THRESHOLD) {
          dirX = dx / dist;
          dirY = dy / dist;
        }
        const strength = Math.min(1.0, 0.35 + this.chargeTime * 0.9) * 14.5;
        this.releaseBurst = {
          x: this.chargePos.x,
          y: this.chargePos.y,
          dirX,
          dirY,
          strength,
        };
        this.callbacks.onVortexFire();
      }
    }

    this.cancelActivePointer();
    const hovering = this.enabled && inside && Boolean(this.callbacks.isHoveringInteractive?.(wx, wy));
    this.stageEl.style.cursor = hovering ? 'pointer' : 'crosshair';
  };

  private readonly handlePointerCancel = (e: PointerEvent): void => {
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    this.cancelActivePointer();
    this.stageEl.style.cursor = 'crosshair';
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerWorld.inside = false;
    if (!this.isPrimaryDown && !this.isSecondaryDown) {
      this.stageEl.style.cursor = 'crosshair';
    }
  };

  private shouldIgnoreKeyEvent(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return true;
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  private mapShortcutToTool(e: KeyboardEvent): ToolId | null {
    if (e.key === '1' || e.code === 'Digit1') return 'surge';
    if (e.key === '2' || e.code === 'Digit2') return 'ice';
    if (e.key === '3' || e.code === 'Digit3') return 'vortex';
    if (this.sandbox) {
      if (e.key === '4' || e.code === 'Digit4') return 'pour';
      if (e.key === '5' || e.code === 'Digit5') return 'drain';
      if (e.key === '6' || e.code === 'Digit6') return 'rock';
    }
    return null;
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (this.shouldIgnoreKeyEvent(e)) return;

    this.callbacks.onUserGesture();

    if (e.code === 'Escape') {
      if (!e.repeat) {
        e.preventDefault();
        this.callbacks.onToggleMenu();
      }
      return;
    }

    if (e.code === 'KeyM') {
      if (!e.repeat) {
        e.preventDefault();
        this.callbacks.onToggleMute();
      }
      return;
    }

    if (!this.enabled) return;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        this.callbacks.onShatterIce();
      }
      return;
    }

    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (!e.repeat && !this.shiftHeld) {
        this.shiftHeld = true;
        this.callbacks.onSlowMoChange(true);
      }
      return;
    }

    if (e.repeat) return;

    if (e.code === 'KeyT') {
      this.slowMoToggled = !this.slowMoToggled;
      this.callbacks.onSlowMoChange(this.shiftHeld || this.slowMoToggled);
      return;
    }

    if (e.code === 'KeyR') {
      this.callbacks.onRestart();
      return;
    }

    const tool = this.mapShortcutToTool(e);
    if (tool) {
      this.setActiveTool(tool);
      this.callbacks.onToolChange(tool);
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (this.shiftHeld) {
        this.shiftHeld = false;
        this.callbacks.onSlowMoChange(this.slowMoToggled);
      }
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.cancelActivePointer();
    if (this.shiftHeld) {
      this.shiftHeld = false;
      this.callbacks.onSlowMoChange(this.slowMoToggled);
    }
  };
}
