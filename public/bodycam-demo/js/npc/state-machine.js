import { NPC_STATES } from './npc-config.js';

export function createNPCStateMachine({ config, context = () => ({}), changed = () => {}, hook = () => {} }) {
  let state = 'idle', previous = 'idle', time = 0, stateTime = 0, disposed = false;
  const snapshot = () => ({ state, previous, time, stateTime });
  function set(next, payload = {}, force = false) {
    if (!NPC_STATES.includes(next)) throw new RangeError(`Unknown NPC state: ${next}`);
    if (disposed || (state === 'dead' && !force) || next === state) return false;
    const event = { ...context(), from: state, to: next, payload, time };
    if (!force && hook('beforeTransition', event) === false) return false;
    hook('onExit', event);
    if (state !== 'hit') previous = state;
    state = next; stateTime = 0;
    changed({ ...event, state }); hook('onTransition', event); hook('onEnter', event);
    return true;
  }
  function signal(signal, payload = {}) {
    if (disposed || state === 'dead') return false;
    const event = { ...context(), state, signal, payload, time };
    const decision = hook('decideTransition', event);
    const selected = decision === undefined ? config.transitions[state]?.[signal] : decision;
    if (selected === false || selected === null || selected === undefined) return false;
    return set(selected === 'previous' ? previous : selected, { ...payload, signal });
  }
  function update(dt) {
    if (disposed) return;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('NPC timestep must be finite and nonnegative');
    time += dt; stateTime += dt;
    hook('onUpdate', { ...context(), ...snapshot(), dt });
    const duration = config.states[state]?.duration;
    if (Number.isFinite(duration) && stateTime + 1e-9 >= duration) signal('complete');
  }
  return { get state() { return state; }, get time() { return time; }, get stateTime() { return stateTime; },
    set, signal, update, snapshot, dispose() { disposed = true; } };
}
