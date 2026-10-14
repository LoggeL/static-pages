import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeaponState } from '../../js/weapon/state.js';
import { createRecoil } from '../../js/weapon/recoil.js';
import { WEAPON_CONFIG, resolveWeaponConfig } from '../../js/weapon/config.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const fixture = (config = {}) => {
  const events = [];
  const weapon = createWeaponState({ config, emit: (type, payload) => events.push({ type, ...payload }) });
  return { weapon, events, of: (type) => events.filter((event) => event.type === type) };
};

test('starts with 30+1 and four spare magazines; snapshots cannot mutate state', () => {
  const { weapon } = fixture();
  const s = weapon.state();
  assert.equal(s.state, 'lowReady');
  assert.equal(s.ammo, 31);
  assert.equal(s.magazine, 30);
  assert.equal(s.chamber, 1);
  assert.equal(s.spareMagazines, 4);
  s.ammo = 0;
  assert.equal(weapon.state().ammo, 31);
  assert.equal(weapon.reload(), false);
});

test('semi trigger requires a new press and does not queue an early pull', () => {
  const { weapon, of } = fixture();
  weapon.trigger(true);
  weapon.update(1);
  assert.equal(of('shot').length, 1);
  weapon.trigger(false);
  weapon.trigger(true);
  weapon.trigger(false);
  weapon.trigger(true);
  weapon.update(1);
  assert.equal(of('shot').length, 2);
  assert.equal(weapon.state().ammo, 29);
});

test('queued API shots obey 650 rpm and preserve exact shot timestamps through large dt', () => {
  const { weapon, of } = fixture();
  assert.equal(weapon.fire(8), 8);
  assert.equal(of('shot').length, 1);
  weapon.update(1);
  const shots = of('shot');
  assert.equal(shots.length, 8);
  shots.forEach((event, index) => {
    near(event.time, index * 60 / 650);
    assert.equal(event.index, index + 1);
    assert.equal(event.ammo, 30 - index);
  });
  assert.equal(weapon.state().queuedShots, 0);
});

test('auto can empty the gun; one dry click per held trigger, not per frame', () => {
  const { weapon, of } = fixture();
  assert.equal(weapon.toggleMode(), 'auto');
  weapon.trigger(true);
  weapon.update(60);
  assert.equal(of('shot').length, 31);
  assert.equal(of('dryFire').length, 1);
  assert.equal(weapon.state().ammo, 0);
  weapon.update(60);
  assert.equal(of('dryFire').length, 1);
  weapon.trigger(false);
  weapon.trigger(true);
  assert.equal(of('dryFire').length, 2);
});

test('frame subdivision does not change shot or state-transition event timing', () => {
  const large = fixture({ initialMode: 'auto' });
  const small = fixture({ initialMode: 'auto' });
  large.weapon.trigger(true);
  small.weapon.trigger(true);
  large.weapon.update(5);
  for (let i = 0; i < 500; i++) small.weapon.update(0.01);
  assert.equal(large.events.length, small.events.length);
  large.events.forEach((event, i) => {
    assert.equal(event.type, small.events[i].type);
    near(event.time, small.events[i].time);
    assert.equal(event.state, small.events[i].state);
  });
});

test('onAdvance partitions at event boundaries before events and includes the final remainder', () => {
  const trace = [];
  let weapon;
  weapon = createWeaponState({
    onAdvance: (dt, time) => trace.push({ type: 'advance', dt, time, snapshotTime: weapon.state().time }),
    emit: (type, event) => trace.push({ type, ...event }),
  });
  weapon.fire(2);
  weapon.update(0.2);
  const advances = trace.filter(({ type }) => type === 'advance');
  const period = 60 / 650;
  const expected = [0.06, period, period + 0.06, 0.2];
  assert.equal(advances.length, expected.length);
  advances.forEach((event, index) => {
    near(event.time, expected[index]);
    near(event.dt, expected[index] - (expected[index - 1] ?? 0));
    near(event.snapshotTime, event.time);
  });
  const secondShot = trace.findIndex((event) => event.type === 'shot' && event.index === 2);
  assert.equal(trace[secondShot - 2].type, 'advance');
  near(trace[secondShot - 2].time, period);
  assert.equal(trace.at(-1).type, 'advance');
  weapon.update(0);
  assert.equal(trace.filter(({ type }) => type === 'advance').length, expected.length);
});

test('onAdvance sees updated ADS time but ammo changes only at the following reload marker', () => {
  const snapshots = [];
  let weapon;
  weapon = createWeaponState({ onAdvance: () => snapshots.push(weapon.state()) });
  weapon.ads(true);
  weapon.update(0.14);
  near(snapshots[0].time, 0.14);
  near(snapshots[0].adsProgress, 0.875);
  weapon.fire();
  weapon.reload();
  weapon.update(3.7);
  const beforeOut = snapshots.find((s) => Math.abs(s.time - (0.14 + 0.56)) < 1e-9);
  const beforeIn = snapshots.find((s) => Math.abs(s.time - (0.14 + 2.67)) < 1e-9);
  assert.equal(beforeOut.magazine, 29);
  assert.equal(beforeIn.magazine, 0);
  assert.equal(beforeIn.chamber, 1);
  assert.equal(weapon.state().magazine, 30);
});

test('onAdvance keeps actual shot/recoil integration equal across frame partitions', () => {
  const simulate = (durations) => {
    const recoil = createRecoil();
    const shots = [];
    const weapon = createWeaponState({
      config: { initialMode: 'auto' },
      onAdvance: (dt) => recoil.update(dt),
      emit(type, event) {
        if (type !== 'shot') return;
        shots.push({ time: event.time, beforeImpulse: recoil.state() });
        recoil.kick(() => 0.5);
      },
    });
    weapon.trigger(true);
    for (const dt of durations) weapon.update(dt);
    return { weapon: weapon.state(), recoil: recoil.state(), shots };
  };
  for (const duration of [0.1, 1, 5]) {
    const a = simulate([duration]);
    const b = simulate(Array(Math.round(duration * 1000)).fill(0.001));
    near(a.weapon.time, b.weapon.time);
    assert.equal(a.shots.length, b.shots.length);
    for (const axis of ['pitch', 'yaw', 'back']) {
      near(a.recoil[axis], b.recoil[axis], 1e-12);
      near(a.recoil.velocity[axis], b.recoil.velocity[axis], 1e-12);
      a.shots.forEach((shot, index) => {
        near(shot.time, b.shots[index].time);
        near(shot.beforeImpulse[axis], b.shots[index].beforeImpulse[axis], 1e-12);
      });
    }
  }
});

test('release stops held auto fire but does not cancel explicit fire(n) requests', () => {
  const { weapon, of } = fixture({ initialMode: 'auto' });
  weapon.trigger(true);
  weapon.trigger(false);
  weapon.update(1);
  assert.equal(of('shot').length, 1);
  weapon.fire(3);
  weapon.trigger(true);
  weapon.trigger(false);
  weapon.update(1);
  assert.equal(of('shot').length, 4);
});

test('tactical reload mutates magazine at markers and retains chamber for 30+1', () => {
  const { weapon, of } = fixture();
  weapon.fire();
  assert.equal(weapon.reload(), true);
  assert.equal(weapon.state().state, 'reload');
  weapon.update(0.55);
  assert.equal(weapon.state().magazine, 29);
  weapon.update(0.01);
  assert.equal(weapon.state().magazine, 0);
  assert.equal(weapon.state().chamber, 1);
  assert.equal(weapon.state().spareMagazines, 4);
  weapon.update(2.11);
  assert.equal(weapon.state().ammo, 31);
  assert.equal(weapon.state().spareMagazines, 3);
  assert.equal(weapon.fire(), 0);
  weapon.update(1.03);
  assert.equal(weapon.state().state, 'lowReady');
  for (const [name, time] of Object.entries(WEAPON_CONFIG.reload.Reload)) {
    if (name !== 'dur') near(of(name)[0].time, time);
  }
  assert.equal(of('boltRelease').length, 0);
});

test('empty reload inserts 30, chambers at bolt release, and finishes with 29+1', () => {
  const { weapon, of } = fixture({ initialMagazine: 0, initialChamber: 0 });
  weapon.reload();
  weapon.update(1.66);
  assert.equal(weapon.state().state, 'reloadEmpty');
  assert.equal(weapon.state().magazine, 30);
  assert.equal(weapon.state().chamber, 0);
  weapon.update(0.89);
  assert.equal(weapon.state().magazine, 29);
  assert.equal(weapon.state().chamber, 1);
  weapon.update(0.35);
  assert.equal(weapon.state().ammo, 30);
  assert.equal(weapon.state().state, 'lowReady');
  for (const [name, time] of Object.entries(WEAPON_CONFIG.reload.ReloadEmpty)) {
    if (name !== 'dur') near(of(name)[0].time, time);
  }
});

test('a single update emits every reload marker once, in chronological order', () => {
  for (const initialChamber of [0, 1]) {
    const { weapon, events } = fixture({ initialMagazine: 0, initialChamber });
    weapon.reload();
    weapon.update(20);
    const markerTypes = ['magOut', 'magStow', 'magDrop', 'magIn', 'settle', 'boltRelease'];
    const markers = events.filter((event) => markerTypes.includes(event.type));
    assert.deepEqual(markers.map((event) => event.type), initialChamber
      ? ['magOut', 'magStow', 'magIn', 'settle'] : ['magOut', 'magDrop', 'magIn', 'boltRelease']);
    markers.forEach((event, i) => { if (i) assert.ok(markers[i - 1].time < event.time); });
    assert.equal(weapon.state().spareMagazines, 3);
    assert.equal(weapon.state().state, 'idle');
  }
});

test('four replacements are finite; no ammunition appears after exhaustion', () => {
  const { weapon, of } = fixture();
  weapon.fire(31);
  weapon.update(5);
  for (let i = 0; i < 4; i++) {
    assert.equal(weapon.reload(), true);
    weapon.update(2.9);
    weapon.fire(30);
    weapon.update(5);
  }
  assert.equal(of('shot').length, 151);
  assert.equal(weapon.state().spareMagazines, 0);
  assert.equal(weapon.state().ammo, 0);
  assert.equal(weapon.reload(), false);
});

test('reload clears queued and held-auto fire until a fresh press', () => {
  const { weapon, of } = fixture({ initialMode: 'auto' });
  weapon.trigger(true);
  weapon.fire(20);
  weapon.reload();
  weapon.trigger(true);
  weapon.update(10);
  assert.equal(of('shot').length, 1);
  assert.equal(weapon.state().ammo, 31);
  weapon.trigger(false);
  weapon.trigger(true);
  assert.equal(of('shot').length, 2);
});

test('sprint blocks fire and ADS, includes recovery, and rejects held-trigger ghosts', () => {
  const { weapon, of } = fixture({ initialMode: 'auto' });
  weapon.trigger(true);
  weapon.ads(true);
  weapon.sprint(true);
  assert.equal(weapon.ads(true), false);
  assert.equal(weapon.fire(3), 0);
  assert.equal(weapon.reload(), false);
  weapon.update(1);
  weapon.sprint(false);
  assert.equal(weapon.state().state, 'sprint');
  weapon.update(0.17);
  assert.equal(weapon.fire(), 0);
  weapon.update(0.01);
  assert.equal(weapon.state().state, 'lowReady');
  weapon.trigger(true);
  weapon.update(1);
  assert.equal(of('shot').length, 1);
  weapon.trigger(false);
  weapon.trigger(true);
  assert.equal(of('shot').length, 2);
});

test('a press made during reload stays suppressed after its completion', () => {
  const { weapon, of } = fixture({ initialMode: 'auto', initialMagazine: 1 });
  weapon.reload();
  weapon.trigger(true);
  weapon.update(4);
  weapon.trigger(true);
  weapon.update(1);
  assert.equal(of('shot').length, 0);
  weapon.trigger(false);
  weapon.trigger(true);
  assert.equal(of('shot').length, 1);
});

test('ADS reaches endpoints in .28/.22 seconds with continuous ease-out reversals', () => {
  const { weapon, of } = fixture();
  weapon.ads(true);
  weapon.update(0.14);
  near(weapon.state().adsProgress, 0.875);
  weapon.update(0.14);
  near(weapon.state().adsProgress, 1);
  weapon.ads(false);
  weapon.update(0.11);
  near(weapon.state().adsProgress, 0.125);
  const before = weapon.state().adsProgress;
  weapon.ads(true);
  near(weapon.state().adsProgress, before);
  weapon.update(0.28);
  near(weapon.state().adsProgress, 1);
  weapon.ads(false);
  weapon.update(0.22);
  near(weapon.state().adsProgress, 0);
  assert.equal(of('adschange').length, 4);
});

test('inspect, idle, fire and mode changes have explicit state transitions', () => {
  const { weapon, of } = fixture();
  weapon.update(6);
  assert.equal(weapon.state().state, 'idle');
  weapon.inspect();
  assert.equal(weapon.state().state, 'inspect');
  assert.equal(weapon.state().inspectProgress, 0);
  assert.equal(weapon.fire(), 0);
  weapon.update(2);
  near(weapon.state().inspectProgress, 0.5);
  weapon.update(2);
  assert.equal(weapon.state().inspectProgress, 0);
  assert.equal(weapon.state().state, 'lowReady');
  weapon.fire();
  assert.equal(weapon.state().state, 'fire');
  weapon.toggleMode();
  assert.equal(weapon.state().state, 'lowReady');
  assert.equal(of('modechange')[0].mode, 'auto');
});

test('invalid dt/count/config are rejected and dispose prevents later events', () => {
  const { weapon, events } = fixture();
  for (const dt of [-1, Infinity, NaN]) assert.throws(() => weapon.update(dt), RangeError);
  for (const n of [-1, 1.5, Infinity, NaN]) assert.throws(() => weapon.fire(n), RangeError);
  assert.throws(() => resolveWeaponConfig({ rpm: 0 }), RangeError);
  assert.throws(() => resolveWeaponConfig({ initialMagazine: 31 }), RangeError);
  assert.throws(() => resolveWeaponConfig({ reload: { Reload: { magOut: 3 } } }), RangeError);
  weapon.fire(5);
  const length = events.length;
  weapon.dispose();
  weapon.update(10);
  assert.equal(weapon.fire(), 0);
  assert.equal(weapon.reload(), false);
  assert.equal(weapon.inspect(), false);
  assert.equal(events.length, length);
});

test('recoil hits the configured peak from an impulse without an immediate position jump', () => {
  const recoil = createRecoil();
  const impulse = recoil.kick(() => 0.5);
  near(impulse.pitch, 2.2 * Math.PI / 180);
  near(impulse.yaw, 0);
  near(recoil.state().pitch, 0);
  assert.ok(recoil.state().velocity.pitch > 0);
  const { omega, zeta } = WEAPON_CONFIG.recoil.spring;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const peakTime = Math.atan2(wd, omega * zeta) / wd;
  recoil.update(peakTime);
  near(recoil.state().pitch, impulse.pitch);
  near(recoil.state().back, 0.025);
  near(recoil.state().velocity.pitch, 0);
  recoil.update(1);
  assert.ok(Math.abs(recoil.state().pitch) < 0.00001);
});

test('spring solution is stable and subdivision invariant for under/critical/over damping', () => {
  for (const zeta of [0, 0.55, 1, 2]) {
    const a = createRecoil({ spring: { zeta } });
    const b = createRecoil({ spring: { zeta } });
    a.kick(() => 0.75);
    b.kick(() => 0.75);
    a.update(0.3);
    for (let i = 0; i < 30; i++) b.update(0.01);
    for (const axis of ['pitch', 'yaw', 'back']) {
      near(a.state()[axis], b.state()[axis]);
      near(a.state().velocity[axis], b.state().velocity[axis]);
    }
    a.update(1000);
    assert.ok(Number.isFinite(a.state().pitch));
  }
});

test('recoil impulses compose; random bounds and reset are testable', () => {
  const recoil = createRecoil();
  const min = recoil.kick(() => 0);
  near(min.pitch, 1.4 * Math.PI / 180);
  near(min.yaw, -0.9 * Math.PI / 180);
  const max = recoil.kick(() => 1);
  near(max.pitch, 3 * Math.PI / 180);
  near(max.yaw, 0.9 * Math.PI / 180);
  near(recoil.state().velocity.yaw, 0);
  recoil.update(0.05);
  assert.ok(recoil.state().pitch > max.pitch);
  recoil.reset();
  assert.deepEqual(recoil.state(), { pitch: 0, yaw: 0, back: 0, velocity: { pitch: 0, yaw: 0, back: 0 } });
  assert.throws(() => recoil.update(-1), RangeError);
  assert.throws(() => recoil.kick(() => NaN), RangeError);
});
