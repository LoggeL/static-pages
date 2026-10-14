/**
 * Shared keyboard/mouse bus. Mouse buttons use codes Mouse0 (fire) and Mouse2
 * (aim). Named keyboard actions fire once per press; raw keydown still repeats.
 * KeyE remains observable for leaning; the player gives a reachable door priority.
 */
export const INPUT_ACTIONS = Object.freeze({
  KeyE: 'interact',
  KeyR: 'reload',
  KeyF: 'flashlight',
  KeyB: 'firemode',
  KeyV: 'inspect',
});

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'KeyC', 'ControlLeft', 'ControlRight',
  'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyB', 'KeyV', 'Escape',
]);

/**
 * @param {HTMLElement} element Pointer-lock target, normally renderer.domElement.
 * @param {{debug?: boolean, preventDefault?: boolean}} options
 * @returns {{on: Function, emit: Function, isDown: Function,
 *   consumeLook: Function, requestLock: Function, exitLock: Function,
 *   readonly locked: boolean, readonly active: boolean, dispose: Function}}
 *
 * on(type, callback) returns an unsubscribe function. Actions also emit `action`
 * with { type, ...payload }. Keyboard payloads include { code, repeat }; fire
 * and aim include { pressed }. Blur/unlock/hidden/dispose synthesize releases.
 * requestLock() resolves to true only after acquisition, false on failure.
 * Debug mode permits keyboard input and mouse movement over element without lock.
 */
export function createInput(element, { debug = false, preventDefault = true } = {}) {
  const doc = element?.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win || typeof element.addEventListener !== 'function') {
    throw new TypeError('createInput requires a DOM element in a window.');
  }

  const subscribers = new Map();
  const held = new Set();
  const virtual = new Map();
  let moveAxes = null;
  let mode = 'pointer';
  const removers = [];
  let lookX = 0;
  let lookY = 0;
  let disposed = false;
  let focused = typeof doc.hasFocus !== 'function' || doc.hasFocus();
  let wasLocked = doc.pointerLockElement === element;
  let pauseEmitted = false;
  let lockRequest = null;

  const locked = () => doc.pointerLockElement === element;
  const active = () => !disposed && !doc.hidden && focused && (debug || mode === 'touch' || locked());
  const isDown = code => held.has(code) || [...virtual.values()].some(keys => keys.has(code));

  function on(type, callback) {
    if (typeof callback !== 'function') throw new TypeError('Input listener must be a function.');
    if (disposed) return () => {};
    if (!subscribers.has(type)) subscribers.set(type, new Set());
    const listeners = subscribers.get(type);
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (!listeners.size && subscribers.get(type) === listeners) subscribers.delete(type);
    };
  }

  function emit(type, payload) {
    const listeners = subscribers.get(type);
    if (listeners) for (const callback of [...listeners]) callback(payload);
  }

  function action(type, payload) {
    emit(type, payload);
    emit('action', { ...payload, type });
  }

  function prevent(event) {
    if (preventDefault && event.cancelable !== false) event.preventDefault();
  }

  function isEditable(target) {
    return !!(target?.isContentEditable || target?.closest?.(
      'input, textarea, select, button, [contenteditable=""], [contenteditable="true"]',
    ));
  }

  function insideElement(target) {
    return target === element || !!(target && element.contains?.(target));
  }

  function keyPayload(event, repeat = false) {
    return { code: event.code, key: event.key, repeat, originalEvent: event, synthetic: false };
  }

  function releaseMouse(code, payload) {
    const button = Number(code.slice(5));
    emit('mouseup', { ...payload, code, button, pressed: false });
    if (button === 0 || button === 2) {
      action(button === 0 ? 'fire' : 'aim', { ...payload, code, button, pressed: false });
    }
  }

  function clearHeld(reason) {
    const previous = [...new Set([...held, ...[...virtual.values()].flatMap(keys => [...keys])])];
    held.clear();
    virtual.clear(); moveAxes = null;
    lookX = 0;
    lookY = 0;
    for (const code of previous) {
      const payload = { code, repeat: false, synthetic: true, reason, originalEvent: null };
      if (code.startsWith('Mouse')) releaseMouse(code, payload);
      else emit('keyup', payload);
    }
    emit('reset', { reason });
  }

  function finishLockRequest(success) {
    const pending = lockRequest;
    lockRequest = null;
    if (pending) win.clearTimeout(pending.timer);
    pending?.resolve(success);
  }

  function requestLock() {
    if (disposed || doc.hidden) return Promise.resolve(false);
    if (mode === 'touch') { focused = true; return Promise.resolve(true); }
    if (locked()) return Promise.resolve(true);
    if (lockRequest) return lockRequest.promise;
    if (typeof element.requestPointerLock !== 'function') {
      emit('pointerlockerror', { error: new Error('Pointer Lock is not available.') });
      return Promise.resolve(false);
    }

    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    const pending = { promise, resolve, timer: win.setTimeout(() => {
      if (lockRequest === pending) {
        finishLockRequest(false);
        emit('pointerlockerror', { error: new Error('Pointer Lock timed out.') });
      }
    }, 2500) };
    lockRequest = pending;
    try {
      // No unadjustedMovement option: retain compatibility with Safari and Firefox.
      const result = element.requestPointerLock();
      if (result && typeof result.then === 'function') {
        result.then(() => {
          if (lockRequest === pending && locked()) finishLockRequest(true);
        }, (error) => {
          if (lockRequest !== pending) return;
          finishLockRequest(false);
          emit('pointerlockerror', { error });
        });
      }
    } catch (error) {
      finishLockRequest(false);
      emit('pointerlockerror', { error });
    }
    return promise;
  }

  function exitLock() {
    clearHeld('unlock');
    if (locked() && typeof doc.exitPointerLock === 'function') doc.exitPointerLock();
  }

  function handleKeyDown(event) {
    if (!active() || (isEditable(event.target) && !locked())) return;
    const code = event.code;
    if (!code) return;
    if (GAME_KEYS.has(code)) prevent(event);
    const repeat = !!event.repeat || isDown(code);
    held.add(code);
    const payload = keyPayload(event, repeat);
    emit('keydown', payload);
    if (repeat) return;
    if (code === 'Escape') {
      pauseEmitted = locked();
      action('pause', { ...payload, reason: 'escape' });
      exitLock();
    } else if (INPUT_ACTIONS[code]) {
      action(INPUT_ACTIONS[code], { ...payload, pressed: true });
    }
  }

  function handleKeyUp(event) {
    // A matching release must work even if focus moved to an editable element.
    const wasHeld = held.delete(event.code);
    if (isDown(event.code)) return;
    if (!wasHeld && (!active() || (isEditable(event.target) && !locked()))) return;
    if (GAME_KEYS.has(event.code)) prevent(event);
    emit('keyup', keyPayload(event));
  }

  function handleMouseDown(event) {
    if (mode === 'touch') return;
    if (!active() || (!locked() && !insideElement(event.target))) return;
    const code = `Mouse${event.button}`;
    if (isDown(code)) { held.add(code); return; }
    prevent(event);
    held.add(code);
    const payload = {
      code, button: event.button, pressed: true, originalEvent: event, synthetic: false,
    };
    emit('mousedown', payload);
    if (event.button === 0 || event.button === 2) {
      action(event.button === 0 ? 'fire' : 'aim', payload);
    }
  }

  function handleMouseUp(event) {
    const code = `Mouse${event.button}`;
    if (!held.delete(code)) return;
    if (isDown(code)) return;
    prevent(event);
    releaseMouse(code, { originalEvent: event, synthetic: false });
  }

  function handleMouseMove(event) {
    if (mode === 'touch') return;
    if (!active() || (!locked() && !insideElement(event.target))) return;
    const x = Number.isFinite(event.movementX) ? event.movementX : 0;
    const y = Number.isFinite(event.movementY) ? event.movementY : 0;
    lookX += x;
    lookY += y;
    emit('look', { x, y, originalEvent: event });
  }

  function handleLockChange() {
    const nowLocked = locked();
    const lostLock = wasLocked && !nowLocked;
    wasLocked = nowLocked;
    if (nowLocked) {
      focused = true;
      pauseEmitted = false;
      finishLockRequest(true);
    } else {
      clearHeld('unlock');
      finishLockRequest(false);
    }
    emit('pointerlockchange', { locked: nowLocked, active: active() });
    // Some browsers consume Escape before delivering keydown to the page.
    if (lostLock && !pauseEmitted) action('pause', { reason: 'unlock', originalEvent: null });
    if (!nowLocked) pauseEmitted = false;
  }

  function listen(target, type, callback) {
    target.addEventListener(type, callback);
    removers.push(() => target.removeEventListener(type, callback));
  }

  listen(doc, 'keydown', handleKeyDown);
  listen(doc, 'keyup', handleKeyUp);
  listen(doc, 'mousedown', handleMouseDown);
  listen(doc, 'mouseup', handleMouseUp);
  listen(doc, 'mousemove', handleMouseMove);
  listen(doc, 'pointerlockchange', handleLockChange);
  listen(doc, 'pointerlockerror', (event) => {
    finishLockRequest(false);
    emit('pointerlockerror', { error: event, originalEvent: event });
  });
  listen(element, 'click', (event) => {
    // The click acquiring the lock never becomes a weapon trigger press.
    if (event.button === 0 && !debug && mode !== 'touch' && !locked()) void requestLock();
  });
  listen(element, 'contextmenu', (event) => { if (active()) prevent(event); });
  listen(win, 'blur', () => {
    focused = false;
    clearHeld('blur');
  });
  listen(win, 'focus', () => { focused = true; });
  listen(doc, 'visibilitychange', () => { if (doc.hidden) clearHeld('hidden'); });

  return {
    on,
    emit,
    isDown,
    setMode(value) {
      if (!['touch', 'pointer'].includes(value)) throw new RangeError('Invalid input mode');
      if (value !== mode) { clearHeld('mode'); mode = value; }
    },
    get mode() { return mode; },
    setMoveAxes(x, y) {
      if (disposed) return;
      if (x === null) { moveAxes = null; return; }
      if (![x, y].every(Number.isFinite)) throw new TypeError('Finite movement axes required');
      const length = Math.max(1, Math.hypot(x, y));
      moveAxes = { right: x / length, forward: y / length };
    },
    getMoveAxes() { return moveAxes; },
    addLook(x, y) {
      if (!active() || ![x, y].every(Number.isFinite)) return;
      lookX += x; lookY += y; emit('look', { x, y, synthetic: true });
    },
    setVirtualKey(code, pressed, owner = 'touch') {
      if (disposed || (pressed && !active())) return;
      const before = isDown(code);
      if (!virtual.has(owner)) virtual.set(owner, new Set());
      const keys = virtual.get(owner);
      if (pressed) keys.add(code); else keys.delete(code);
      if (!keys.size) virtual.delete(owner);
      if (before === isDown(code)) return;
      const payload = { code, pressed, repeat: false, synthetic: true, originalEvent: null };
      if (code.startsWith('Mouse')) {
        if (!pressed) releaseMouse(code, payload);
        else {
          const button = Number(code.slice(5));
          emit('mousedown', { ...payload, button });
          if (button === 0 || button === 2) action(button === 0 ? 'fire' : 'aim', { ...payload, button });
        }
      } else {
        emit(pressed ? 'keydown' : 'keyup', payload);
        if (pressed && INPUT_ACTIONS[code]) action(INPUT_ACTIONS[code], payload);
      }
    },
    reset: clearHeld,
    consumeLook() {
      const delta = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return delta;
    },
    requestLock,
    exitLock,
    get locked() { return !disposed && locked(); },
    get active() { return active(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearHeld('dispose');
      for (const remove of removers) remove();
      finishLockRequest(false);
      if (locked() && typeof doc.exitPointerLock === 'function') doc.exitPointerLock();
      subscribers.clear();
    },
  };
}
