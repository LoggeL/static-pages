/** App-owned bus: available even if the optional weapon module cannot load. */
export function createEventBus() {
  const listeners = new Map();
  return {
    on(type, callback) {
      if (typeof callback !== 'function') throw new TypeError('Listener must be a function');
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
      return () => listeners.get(type)?.delete(callback);
    },
    off(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, payload = {}) {
      for (const callback of [...(listeners.get(type) ?? [])]) callback(payload);
      for (const callback of [...(listeners.get('*') ?? [])]) callback({ ...payload, type });
    },
    clear() { listeners.clear(); },
  };
}

/** Gate gameplay at the shell boundary, including the unlocked debug input. */
export function gateInput(input, isPlaying) {
  const actions = new Set(['fire', 'aim', 'reload', 'inspect', 'firemode', 'flashlight', 'interact']);
  return {
    on(type, callback) {
      return input.on(type, payload => {
        if (!actions.has(type) || isPlaying() || payload?.pressed === false) callback(payload);
      });
    },
    emit: (...args) => input.emit(...args),
    isDown: code => isPlaying() && input.isDown(code),
    consumeLook: () => isPlaying() ? input.consumeLook() : { x: 0, y: 0 },
    requestLock: () => input.requestLock(),
    exitLock: () => input.exitLock(),
    get active() { return isPlaying() && input.active; },
    get locked() { return input.locked; },
    dispose: () => input.dispose(),
  };
}

/** C12 -> C4 names and payloads. Do not additionally call audio.footstep(). */
export function bridgePlayerEvents(input, bus, onRoomEnter) {
  const remove = [
    input.on('step', event => bus.emit('step', { ...event, roomId: event.room, own: true })),
    input.on('door', ({ door, opening }) => bus.emit('door', {
      doorId: door.id, action: opening ? 'open' : 'close', open: opening,
      position: door.object.getWorldPosition(door.object.position.clone()),
    })),
    input.on('roomchange', ({ room, previous }) => {
      bus.emit('roomChange', { roomId: room?.id ?? 'OUT', profile: room?.reverb ?? {} });
      onRoomEnter({ room, previous });
    }),
  ];
  return () => remove.forEach(off => off());
}
