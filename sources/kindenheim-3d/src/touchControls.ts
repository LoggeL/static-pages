/**
 * On-screen driving controls for touch devices (phones, tablets).
 *
 * Left thumb: a steering pad (drag sideways; the knob springs back on release).
 * Right thumb: Gas, Bremse/Rückwärts and Handbremse pedals, plus Licht and Hupe buttons.
 *
 * Only shown on devices whose primary pointer is coarse (`(pointer: coarse)`); the root element then carries
 * the class `touch-ui`, which the stylesheet uses to swap the keyboard hints for these controls.
 *
 * `readTouchDriveInput()` is merged into `readDriveInput()` in src/main.ts. It returns null while no touch
 * control is held, so the keyboard alone decides then.
 */

export interface TouchDriveInput {
  /** -1 (brake / reverse) … +1 (full throttle); same convention as the W/S keys. */
  throttle: number;
  /** +1 = full left … -1 = full right; same convention as the A/D keys. */
  steer: number;
  handbrake: boolean;
}

export interface TouchControlHandlers {
  onToggleLights: () => void;
  onHornStart: () => void;
  onHornEnd: () => void;
}

/** Horizontal knob travel (px) that means full steering lock. */
const STEER_RANGE_PX = 52;
/** Inner dead zone (fraction of the range) so a resting thumb does not steer. */
const STEER_DEAD_ZONE = 0.08;

const COARSE_POINTER_QUERY = '(pointer: coarse)';

interface TouchState {
  steerPointer: number | null;
  steerOriginX: number;
  steer: number;
  gasPointers: Set<number>;
  brakePointers: Set<number>;
  handbrakePointers: Set<number>;
}

const state: TouchState = {
  steerPointer: null,
  steerOriginX: 0,
  steer: 0,
  gasPointers: new Set(),
  brakePointers: new Set(),
  handbrakePointers: new Set(),
};

let root: HTMLElement | null = null;
let steerKnob: HTMLElement | null = null;
let initialised = false;

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[touch] index.html is missing #${id} (needed by the on-screen driving controls)`);
  return el as T;
}

/** True when the primary pointer is a finger (phones, tablets). */
export function isTouchDevice(): boolean {
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

function releaseAll(): void {
  state.steerPointer = null;
  state.steer = 0;
  state.gasPointers.clear();
  state.brakePointers.clear();
  state.handbrakePointers.clear();
  if (steerKnob) steerKnob.style.transform = 'translate(-50%, -50%)';
  root?.querySelectorAll('.touch-pedal.pressed').forEach((el) => el.classList.remove('pressed'));
}

function applyTouchMode(): void {
  const touch = isTouchDevice();
  document.documentElement.classList.toggle('touch-ui', touch);
  if (!touch) releaseAll();
}

function bindPedal(el: HTMLElement, pointers: Set<number>): void {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    pointers.add(e.pointerId);
    el.classList.add('pressed');
  });
  const release = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 0) el.classList.remove('pressed');
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
}

function bindSteering(pad: HTMLElement, knob: HTMLElement): void {
  const setKnob = (offsetPx: number): void => {
    knob.style.transform = `translate(calc(-50% + ${offsetPx.toFixed(1)}px), -50%)`;
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.steerPointer !== null) return;
    pad.setPointerCapture(e.pointerId);
    state.steerPointer = e.pointerId;
    // Steering is relative to where the thumb lands, so the first touch never jerks the wheel.
    state.steerOriginX = e.clientX;
    state.steer = 0;
    pad.classList.add('pressed');
    setKnob(0);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== state.steerPointer) return;
    const dx = Math.max(-STEER_RANGE_PX, Math.min(STEER_RANGE_PX, e.clientX - state.steerOriginX));
    const norm = dx / STEER_RANGE_PX;
    const mag = Math.abs(norm) <= STEER_DEAD_ZONE ? 0 : (Math.abs(norm) - STEER_DEAD_ZONE) / (1 - STEER_DEAD_ZONE);
    // Thumb right = steer right = negative (matches the D key).
    state.steer = -Math.sign(norm) * mag;
    setKnob(dx);
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== state.steerPointer) return;
    state.steerPointer = null;
    state.steer = 0;
    pad.classList.remove('pressed');
    setKnob(0);
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('lostpointercapture', release);
}

/**
 * Wires the on-screen controls in index.html (#touch-controls). Call once from the UI controller.
 * Light and horn reuse the same handlers as the keyboard dock.
 */
export function initTouchControls(handlers: TouchControlHandlers): void {
  if (initialised) throw new Error('[touch] initTouchControls() was called twice');
  initialised = true;

  root = requireElement('touch-controls');
  const pad = requireElement('touch-steer');
  steerKnob = requireElement('touch-steer-knob');
  const gas = requireElement('touch-gas');
  const brake = requireElement('touch-brake');
  const handbrake = requireElement('touch-handbrake');
  const lights = requireElement('touch-lights');
  const horn = requireElement('touch-horn');

  bindSteering(pad, steerKnob);
  bindPedal(gas, state.gasPointers);
  bindPedal(brake, state.brakePointers);
  bindPedal(handbrake, state.handbrakePointers);

  lights.addEventListener('click', () => handlers.onToggleLights());

  let hornHeld: number | null = null;
  horn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (hornHeld !== null) return;
    horn.setPointerCapture(e.pointerId);
    hornHeld = e.pointerId;
    horn.classList.add('pressed');
    handlers.onHornStart();
  });
  const endHorn = (e: PointerEvent): void => {
    if (e.pointerId !== hornHeld) return;
    hornHeld = null;
    horn.classList.remove('pressed');
    handlers.onHornEnd();
  };
  horn.addEventListener('pointerup', endHorn);
  horn.addEventListener('pointercancel', endHorn);
  horn.addEventListener('lostpointercapture', endHorn);

  // No long-press menu / text selection / page scroll from the controls themselves
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  window.matchMedia(COARSE_POINTER_QUERY).addEventListener('change', applyTouchMode);
  applyTouchMode();
}

/** Hides the controls while the HUD shows no driving view (drone mode, benchmark mode, clean capture). */
export function setTouchControlsVisible(visible: boolean): void {
  if (!root) throw new Error('[touch] setTouchControlsVisible() before initTouchControls()');
  root.classList.toggle('hidden', !visible);
  if (!visible) releaseAll();
}

/**
 * Current on-screen driving input, or null when no touch control is held (or the device has no touch UI).
 * Merge into the keyboard input: add throttle/steer (then clamp to ±1) and OR the handbrake.
 */
export function readTouchDriveInput(): TouchDriveInput | null {
  if (!root || root.classList.contains('hidden') || !document.documentElement.classList.contains('touch-ui')) {
    return null;
  }
  const gas = state.gasPointers.size > 0;
  const brake = state.brakePointers.size > 0;
  const handbrake = state.handbrakePointers.size > 0;
  if (!gas && !brake && !handbrake && state.steerPointer === null) return null;
  return {
    throttle: (gas ? 1 : 0) - (brake ? 1 : 0),
    steer: state.steer,
    handbrake,
  };
}
