/** Same on()/unsubscribe convention as C12 input and C4 attachAudio. */
export function createWeaponBus() {
  const listeners = new Map();
  return {
    on(type, callback) {
      if (typeof callback !== 'function') throw new TypeError('Event listener must be a function');
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
      return () => listeners.get(type)?.delete(callback);
    },
    off(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, payload) {
      for (const callback of [...(listeners.get(type) ?? [])]) callback(payload);
      for (const callback of [...(listeners.get('*') ?? [])]) callback({ type, ...payload });
    },
    clear() { listeners.clear(); },
  };
}
