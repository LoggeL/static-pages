export const TOUCH_CONFIG = Object.freeze({ deadzone: 0.12, response: 1.15, lookScale: 1.9 });

/** Pointer ownership and capture keep simultaneous movement, look and fire separate. */
export function createTouchControls({ root, input, onPause }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const layer = doc.createElement('div');
  layer.className = 'touch-controls'; layer.hidden = true;
  layer.setAttribute('aria-label', 'Touchsteuerung');
  const look = doc.createElement('div'); look.className = 'touch-look';
  look.setAttribute('aria-label', 'Zum Umsehen ziehen');
  const move = doc.createElement('div'); move.className = 'touch-move';
  move.setAttribute('aria-label', 'Bewegen');
  const knob = doc.createElement('span'); knob.className = 'touch-knob';
  const caption = doc.createElement('span'); caption.className = 'touch-caption'; caption.textContent = 'BEWEGEN';
  move.append(knob, caption);
  const actions = doc.createElement('div'); actions.className = 'touch-actions';
  const leftActions = doc.createElement('div'); leftActions.className = 'touch-left-actions';
  const toolbar = doc.createElement('div'); toolbar.className = 'touch-toolbar';
  const extras = doc.createElement('div'); extras.className = 'touch-extras'; extras.hidden = true;
  layer.append(look, move, actions, leftActions, toolbar, extras); root.append(layer);
  let enabled = false, playing = false, moveId = null, lookId = null, lastX = 0, lastY = 0;
  let disposed = false;
  const pointers = new Map(), toggles = new Map(), cleanup = [];
  const listen = (target, name, callback, options) => {
    target.addEventListener(name, callback, options);
    cleanup.push(() => target.removeEventListener(name, callback, options));
  };
  const canUse = () => enabled && playing && !disposed;
  const capture = (node, id) => { try { node.setPointerCapture(id); } catch { /* pointer may already be cancelled */ } };
  const release = (node, id) => { if (id !== null && node.hasPointerCapture(id)) node.releasePointerCapture(id); };
  function button(label, id, parent, { code, toggle = false, action, hold = false } = {}) {
    const node = doc.createElement('button'); node.type = 'button';
    node.className = `touch-button touch-${id}`; node.dataset.touch = id; node.textContent = label;
    node.setAttribute('aria-label', label);
    if (toggle) { node.setAttribute('aria-pressed', 'false'); toggles.set(node, { code, down: false }); }
    parent.append(node);
    function activate() {
      if (!canUse()) return;
      if (action) { action(); return; }
      if (toggle) {
        const state = toggles.get(node); state.down = !state.down;
        node.setAttribute('aria-pressed', String(state.down));
        input.setVirtualKey(code, state.down, id);
      } else {
        input.setVirtualKey(code, true, id);
        if (!hold) input.setVirtualKey(code, false, id);
      }
    }
    function end(event) {
      if (pointers.get(node) !== event.pointerId) return;
      pointers.delete(node); node.classList.remove('is-held');
      release(node, event.pointerId);
      if (hold) input.setVirtualKey(code, false, id);
    }
    listen(node, 'pointerdown', event => {
      if (!canUse() || pointers.has(node) || event.button > 0) return;
      event.preventDefault(); pointers.set(node, event.pointerId); capture(node, event.pointerId);
      node.classList.add('is-held'); activate();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(node, type, end);
    listen(node, 'click', event => {
      // Pointer activation already happened; detail=0 is keyboard/assistive input.
      if (event.detail === 0) { activate(); if (hold) input.setVirtualKey(code, false, id); }
    });
    return node;
  }
  button('Laden', 'reload', actions, { code: 'KeyR' }).setAttribute('aria-label', 'Nachladen');
  button('Tür', 'interact', actions, { code: 'KeyE' });
  button('Licht', 'light', actions, { code: 'KeyF' });
  button('Zielen', 'aim', actions, { code: 'Mouse2', toggle: true });
  button('FEUER', 'fire', actions, { code: 'Mouse0', hold: true });
  button('Ducken', 'crouch', leftActions, { code: 'KeyC', toggle: true });
  button('Sprint', 'sprint', leftActions, { code: 'ShiftLeft', toggle: true });
  button('Pause', 'pause', toolbar, { action: onPause });
  const more = button('Mehr', 'more', toolbar, { action: () => {
    extras.hidden = !extras.hidden; more.setAttribute('aria-expanded', String(!extras.hidden));
  } });
  more.setAttribute('aria-expanded', 'false');
  button('Feuerart', 'firemode', extras, { code: 'KeyB' });
  button('Ansehen', 'inspect', extras, { code: 'KeyV' });
  button('Lehnen links', 'lean-left', extras, { code: 'KeyQ', hold: true });
  button('Lehnen rechts', 'lean-right', extras, { code: 'KeyE', hold: true });
  button('Schleichen', 'sneak', extras, { code: 'AltLeft', toggle: true });

  function updateMove(event) {
    const box = move.getBoundingClientRect(), radius = box.width * 0.36;
    let x = (event.clientX - box.left - box.width / 2) / radius;
    let y = (event.clientY - box.top - box.height / 2) / radius;
    const length = Math.hypot(x, y), magnitude = Math.min(1, length);
    if (length > 1) { x /= length; y /= length; }
    knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    const amount = magnitude <= TOUCH_CONFIG.deadzone ? 0
      : ((magnitude - TOUCH_CONFIG.deadzone) / (1 - TOUCH_CONFIG.deadzone)) ** TOUCH_CONFIG.response;
    const directionLength = Math.min(1, length);
    input.setMoveAxes(length ? x / directionLength * amount : 0,
      length ? -y / directionLength * amount : 0);
  }
  listen(move, 'pointerdown', event => {
    if (!canUse() || moveId !== null || event.button > 0) return;
    event.preventDefault(); moveId = event.pointerId; capture(move, moveId); updateMove(event);
  });
  listen(move, 'pointermove', event => { if (event.pointerId === moveId) { event.preventDefault(); updateMove(event); } });
  function endMove(event) {
    if (event.pointerId !== moveId) return;
    const id = moveId; moveId = null; release(move, id);
    knob.style.transform = ''; input.setMoveAxes(null);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(move, type, endMove);
  listen(look, 'pointerdown', event => {
    if (!canUse() || lookId !== null || event.button > 0) return;
    event.preventDefault(); lookId = event.pointerId; lastX = event.clientX; lastY = event.clientY; capture(look, lookId);
  });
  listen(look, 'pointermove', event => {
    if (event.pointerId !== lookId) return;
    event.preventDefault();
    input.addLook((event.clientX - lastX) * TOUCH_CONFIG.lookScale, (event.clientY - lastY) * TOUCH_CONFIG.lookScale);
    lastX = event.clientX; lastY = event.clientY;
  });
  function endLook(event) {
    if (event.pointerId !== lookId) return;
    const id = lookId; lookId = null; release(look, id);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(look, type, endLook);

  function reset() {
    const previousMove = moveId, previousLook = lookId; moveId = lookId = null;
    release(move, previousMove); release(look, previousLook);
    knob.style.transform = ''; input.setMoveAxes(null);
    for (const [node, id] of pointers) { node.classList.remove('is-held'); release(node, id); }
    pointers.clear();
    for (const [node, state] of toggles) { state.down = false; node.setAttribute('aria-pressed', 'false'); }
    extras.hidden = true; more.setAttribute('aria-expanded', 'false');
    input.reset('touch-reset');
  }
  for (const type of ['blur', 'pagehide', 'orientationchange']) listen(win, type, reset);
  listen(doc, 'pointercancel', reset);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) reset(); });
  const offReset = input.on('reset', () => {
    // The bus already released keys. Clear local ownership without recursive reset.
    const previousMove = moveId, previousLook = lookId; moveId = lookId = null;
    release(move, previousMove); release(look, previousLook); knob.style.transform = '';
    for (const [node, id] of pointers) { node.classList.remove('is-held'); release(node, id); }
    pointers.clear();
    for (const [node, state] of toggles) { state.down = false; node.setAttribute('aria-pressed', 'false'); }
  });
  return {
    setEnabled(value) { enabled = !!value; if (!enabled) reset(); layer.hidden = !enabled || !playing; },
    setPlaying(value) { playing = !!value; if (!playing) reset(); layer.hidden = !enabled || !playing; },
    reset,
    dispose() { if (disposed) return; reset(); disposed = true; offReset(); cleanup.forEach(remove => remove()); layer.remove(); },
  };
}
