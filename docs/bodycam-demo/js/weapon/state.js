import { resolveWeaponConfig } from './config.js';

const EPS = 1e-9;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Three-independent clock. Events are synchronous and timestamped in simulation seconds.
 * onAdvance(dt, toTime) runs after the clock moves, before events at that time.
 * Integrate recoil/effect physics here to avoid advancing new impulses before they exist.
 */
export function createWeaponState({ emit = () => {}, onAdvance = () => {}, config = {} } = {}) {
  const c = resolveWeaponConfig(config);
  const shotInterval = 60 / c.rpm;
  let time = 0;
  let current = 'lowReady';
  let mode = c.initialMode;
  let magazine = c.initialMagazine;
  let chamber = c.initialChamber;
  let spareMagazines = c.spareMagazines;
  let shots = 0;
  let triggerHeld = false;
  let triggerActive = false;
  let queuedShots = 0;
  let nextShot = 0;
  let fireEnd = Infinity;
  let lastActivity = 0;
  let sprintHeld = false;
  let sprintEnd = Infinity;
  let inspectStart = 0;
  let inspectEnd = Infinity;
  let reloadData = null;
  let adsTarget = false;
  let adsFrom = 0;
  let adsStart = 0;
  let adsDuration = 0;
  let disposed = false;

  function adsProgress() {
    const t = adsDuration ? clamp01((time - adsStart) / adsDuration) : 1;
    return adsFrom + ((adsTarget ? 1 : 0) - adsFrom) * (1 - (1 - t) ** 3);
  }

  function state() {
    return {
      state: current, mode, magazine, chamber, spareMagazines, ammo: magazine + chamber,
      time, ads: adsTarget, adsProgress: adsProgress(),
      reloadProgress: reloadData ? clamp01((time - reloadData.start) / reloadData.duration) : 0,
      reloadKind: reloadData?.kind ?? null,
      inspectProgress: current === 'inspect' ? clamp01((time - inspectStart) / c.inspectDuration) : 0,
      shots, triggerHeld, queuedShots, sprint: sprintHeld, disposed,
    };
  }

  function event(type, payload = {}) { emit(type, { time, state: current, ...payload }); }
  function change(next) {
    if (current === next) return;
    const previous = current;
    current = next;
    event('statechange', { previous, state: next });
  }
  function rest() { change(adsTarget ? 'ads' : 'lowReady'); }
  function cancelFire() { triggerActive = false; queuedShots = 0; fireEnd = Infinity; }
  function busy() { return disposed || reloadData !== null || current === 'sprint' || current === 'inspect'; }
  function wantsShot() { return queuedShots > 0 || (triggerActive && mode === 'auto'); }

  function ads(on) {
    on = Boolean(on);
    if (disposed || (on && busy())) return false;
    if (on === adsTarget) return true;
    adsFrom = adsProgress();
    adsStart = time;
    adsDuration = on ? c.ads.in : c.ads.out;
    adsTarget = on;
    lastActivity = time;
    if (!busy() && current !== 'fire') rest();
    event('adschange', { on, duration: adsDuration, progress: adsFrom });
    return true;
  }

  function attemptShot() {
    if (busy() || !wantsShot() || nextShot > time + EPS) return;
    nextShot = time + shotInterval;
    if (queuedShots > 0) queuedShots--;
    lastActivity = time;
    if (!chamber) {
      cancelFire();
      rest();
      event('dryFire', { ammo: magazine + chamber, magazine, chamber, mode });
      return;
    }
    chamber = magazine > 0 ? 1 : 0;
    if (magazine > 0) magazine--;
    shots++;
    fireEnd = time + c.fireDuration;
    change('fire');
    event('shot', { index: shots, ammo: magazine + chamber, magazine, chamber, mode, ads: adsProgress() });
  }

  function trigger(on) {
    if (disposed) return false;
    on = Boolean(on);
    if (triggerHeld === on) return false;
    triggerHeld = on;
    if (!on) { triggerActive = false; return true; }
    if (busy()) return false;
    triggerActive = true;
    if (mode === 'semi') {
      // A semi-auto pull during the mechanical cycle is ignored, never deferred.
      if (nextShot > time + EPS) return false;
      queuedShots++;
    }
    attemptShot();
    return true;
  }

  function fire(n = 1) {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('fire(n) requires a non-negative integer');
    if (!n || busy()) return 0;
    // Once empty, a single click clears the remaining request.
    queuedShots = Math.min(Number.MAX_SAFE_INTEGER, queuedShots + n);
    attemptShot();
    return n;
  }

  function reload() {
    if (disposed || reloadData || current === 'sprint' || spareMagazines === 0 ||
        (magazine === c.magazineSize && chamber)) return false;
    cancelFire();
    inspectEnd = Infinity;
    ads(false);
    const kind = chamber ? 'Reload' : 'ReloadEmpty';
    const schedule = c.reload[kind];
    reloadData = {
      kind, start: time, duration: schedule.dur, index: 0,
      markers: Object.entries(schedule).filter(([name]) => name !== 'dur')
        .map(([name, offset]) => ({ name, offset })).sort((a, b) => a.offset - b.offset),
    };
    lastActivity = time;
    change(chamber ? 'reload' : 'reloadEmpty');
    processDue();
    return true;
  }

  function sprint(on) {
    on = Boolean(on);
    if (disposed || reloadData) return false;
    if (on === sprintHeld) return true;
    sprintHeld = on;
    cancelFire();
    inspectEnd = Infinity;
    lastActivity = time;
    if (on) {
      ads(false);
      sprintEnd = Infinity;
      change('sprint');
    } else {
      sprintEnd = time + c.sprintRecoverDuration;
      processDue();
    }
    return true;
  }

  function inspect() {
    if (busy()) return false;
    cancelFire();
    ads(false);
    lastActivity = time;
    inspectStart = time;
    inspectEnd = time + c.inspectDuration;
    change('inspect');
    return true;
  }

  function toggleMode() {
    if (disposed) return mode;
    cancelFire();
    if (current === 'fire') rest();
    mode = mode === 'semi' ? 'auto' : 'semi';
    lastActivity = time;
    event('modechange', { mode });
    return mode;
  }

  function processDue() {
    if (disposed) return;
    if (reloadData) {
      const data = reloadData;
      while (data.index < data.markers.length && data.start + data.markers[data.index].offset <= time + EPS) {
        const { name, offset } = data.markers[data.index++];
        // A partial magazine is put away visually; ammunition recovery is outside this demo.
        if (name === 'magOut') magazine = 0;
        if (name === 'magIn') { magazine = c.magazineSize; spareMagazines--; }
        if (name === 'boltRelease' && !chamber && magazine > 0) { magazine--; chamber = 1; }
        event(name, { kind: data.kind, offset, magazine, chamber, ammo: magazine + chamber, spareMagazines });
        if (disposed) return;
      }
      if (data.start + data.duration <= time + EPS) {
        reloadData = null;
        lastActivity = time;
        rest();
      }
    }
    if (current === 'inspect' && inspectEnd <= time + EPS) {
      inspectEnd = Infinity;
      lastActivity = time;
      rest();
    }
    if (current === 'sprint' && !sprintHeld && sprintEnd <= time + EPS) {
      sprintEnd = Infinity;
      lastActivity = time;
      rest();
    }
    if (current === 'fire' && fireEnd <= time + EPS) {
      fireEnd = Infinity;
      rest();
    }
    attemptShot();
    if (current === 'lowReady' && !adsTarget && time >= lastActivity + c.idleAfter - EPS) change('idle');
  }

  function nextBoundary(end) {
    let next = end;
    if (reloadData) {
      const marker = reloadData.markers[reloadData.index];
      if (marker) next = Math.min(next, reloadData.start + marker.offset);
      next = Math.min(next, reloadData.start + reloadData.duration);
    }
    if (current === 'inspect') next = Math.min(next, inspectEnd);
    if (current === 'sprint' && !sprintHeld) next = Math.min(next, sprintEnd);
    if (current === 'fire') next = Math.min(next, fireEnd);
    if (!busy() && wantsShot()) next = Math.min(next, Math.max(time, nextShot));
    if (current === 'lowReady') next = Math.min(next, lastActivity + c.idleAfter);
    return Math.max(time, next);
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Weapon dt must be finite and non-negative');
    if (disposed) return state();
    const end = time + dt;
    if (!Number.isFinite(end)) throw new RangeError('Weapon time overflow');
    processDue();
    while (!disposed && time < end) {
      const previousTime = time;
      time = nextBoundary(end);
      if (time > previousTime) onAdvance(time - previousTime, time);
      processDue();
    }
    return state();
  }

  function dispose() {
    disposed = true;
    cancelFire();
    triggerHeld = false;
    reloadData = null;
  }

  return { update, trigger, fire, reload, ads, sprint, inspect, toggleMode, state, dispose };
}
