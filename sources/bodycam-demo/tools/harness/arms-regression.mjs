import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { measureFrames } from './metrics.mjs';
import { configureAudioOutput } from './audio-output.mjs';

/** C18 acceptance integrated into C20. Uses only shipped FP/weapon/App modules,
 * real skin bones and native Web Audio output selection. The caller owns the
 * browser, server and aggregate browser diagnostics.
 */
export async function runArmsRegression({ page, origin, out, audioSink = 'none' }) {
  if (!['none', 'default'].includes(audioSink)) throw new Error('audioSink: none or default expected');
  await mkdir(out, { recursive: true });
  const originalViewport = page.viewportSize();
  const checks = [], evidence = { method: 'Complete C18 FP-page acceptance plus real App arms=0/default integration.',
    thresholds: { handDistanceMeters: 0.005, rotationRadians: 0.005, metricAgreementMeters: 1e-6 },
    audioSink, screenshots: [], poses: {}, app: [], diagnostics: { errors: [], warnings: [], requests: [] } };
  const record = (name, passed, details) => checks.push({ name: `arms-${name}`, passed: !!passed, details });
  const onPageError = error => evidence.diagnostics.errors.push(error.message);
  const onConsole = message => {
    if (message.type() === 'error') evidence.diagnostics.errors.push(message.text());
    if (message.type() === 'warning') evidence.diagnostics.warnings.push(message.text());
  };
  const onRequestFailed = request => evidence.diagnostics.requests.push({ url: request.url(), failure: request.failure()?.errorText });
  const onResponse = response => { if (response.status() >= 400) evidence.diagnostics.requests.push({ url: response.url(), status: response.status() }); };
  page.on('pageerror', onPageError); page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed); page.on('response', onResponse);
  const run = async (name, fn, argument) => {
    try { return await page.evaluate(fn, argument); }
    catch (error) { record(`${name}-execution`, false, { error: String(error.stack ?? error) }); return null; }
  };
  const shot = async (file, description) => {
    try {
      await page.screenshot({ path: path.join(out, file), fullPage: false });
      evidence.screenshots.push({ file, description });
    } catch (error) { record(`${file}-capture`, false, String(error)); }
  };
  const hands = async (label, app = false) => {
    const result = await run(`${label}-measurement`, measureHands, app);
    evidence.poses[label] = result;
    if (!result) return;
    for (const side of ['L', 'R']) {
      const hand = result[side];
      record(`${label}-${side}-actual-hand-bone-within-5mm`, Number.isFinite(hand.measured) && hand.measured < 0.005, hand);
      record(`${label}-${side}-metrics-agree-with-scene`, Number.isFinite(hand.measured)
        && Math.abs(hand.measured - hand.distanceMeters) < 1e-6, { measured: hand.measured, reported: hand.distanceMeters });
      record(`${label}-${side}-target-rotation-reached`, Number.isFinite(hand.quaternionError)
        && hand.quaternionError < 0.005, { reportedRadians: hand.quaternionError });
      record(`${label}-${side}-independent-target-rotation`, Number.isFinite(hand.measuredRotation)
        && hand.measuredRotation < 0.005, { measuredRadians: hand.measuredRotation, reportedRadians: hand.quaternionError });
    }
  };
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${origin}/bodycam-demo/_dev/fp/?pause=1&markers=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.fpTest?.ready === true, null, { timeout: 120000 });
    await run('initial-settle', () => { window.fpTest.freeze(true); return window.fpTest.step(0.4); });
    evidence.initial = await run('initial', () => window.fpTest.stats());
    record('real-metal-webgl2-renderer', /Metal/.test(evidence.initial?.gpu ?? '')
      && !/SwiftShader|llvmpipe/i.test(evidence.initial?.gpu ?? ''), { gpu: evidence.initial?.gpu });
    evidence.structure = await run('structure', () => {
      const f = window.fpTest, names = [], layers = [], skins = [];
      f.arms.model.traverse(node => {
        names.push(node.name);
        if (node.isMesh) {
          layers.push(node.layers.mask);
          skins.push({ name: node.name, skinned: !!node.isSkinnedMesh,
            triangles: (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 });
        }
      });
      return { names, layers, skins, target: [f.viewmodelTarget.width, f.viewmodelTarget.height],
        weaponParent: f.weapon.model.parent?.name, socketParent: f.weapon.model.parent?.parent?.name };
    });
    if (evidence.structure) {
      const s = evidence.structure;
      record('meshes-exclusively-viewmodel-layer-1', s.layers.length > 0 && s.layers.every(layer => layer === 2), s.layers);
      record('required-fp-nodes', ['FP_Root', 'FP_Camera', 'FP_WeaponSocket'].every(name => s.names.includes(name)), s.names);
      record('weapon-socket-under-viewmodel', s.weaponParent === 'FP_WeaponSocket' && s.socketParent === 'WeaponViewmodel', s);
      record('geometry-at-most-40k-triangles', s.skins.reduce((sum, mesh) => sum + mesh.triangles, 0) <= 40000, s.skins);
      record('four-real-skinned-meshes', s.skins.length === 4 && s.skins.every(mesh => mesh.skinned), s.skins);
      record('separate-viewmodel-target-screen-size', s.target[0] === 1600 && s.target[1] === 900, s.target);
    }
    await hands('lowReady'); await shot('01-low-ready.png', 'C18 LowReady, reale Handknochen und Griffziele');
    await run('ads-pose', () => { window.fpTest.weapon.ads(true); window.fpTest.step(0.65); });
    await hands('ADS'); await shot('02-ads.png', 'C18 ADS nach expliziter Simulation');
    evidence.reloadTurnBlend = await run('reload-turn-blend', async () => {
      const T = await import('three'), f = window.fpTest;
      f.weapon.ads(false); f.step(0.3); f.weapon.fire(1); f.step(0.2);
      f.weapon.reload(); f.step(0.06); f.turn(95, 0.08);
      const hand = f.arms.state().hands.L;
      const actual = f.arms.model.getObjectByName('LeftHand').getWorldPosition(new T.Vector3());
      return { ...hand, independentlyMeasured: actual.distanceTo(new T.Vector3(...hand.targetPosition)) };
    });
    if (evidence.reloadTurnBlend) {
      const r = evidence.reloadTurnBlend;
      record('reload-choreography-active-during-turn', r.target?.startsWith('reload:'), r);
      record('reload-transition-reachable-during-turn', r.reachable, r);
      record('reload-turn-bone-within-5mm-of-blended-target', r.independentlyMeasured < 0.005, r);
      record('reload-turn-independent-metric-agreement', Math.abs(r.independentlyMeasured - r.distanceMeters) < 1e-6, r);
    }
    await run('reload-magwell-pose', () => { window.fpTest.look(0, -4); window.fpTest.step(0.26); });
    await hands('reloadMagwell');
    record('reload-detaches-left-forward-grip', evidence.poses.reloadMagwell?.L.target !== 'W_Grip_L'
      && evidence.poses.reloadMagwell?.L.target?.startsWith('reload:'), evidence.poses.reloadMagwell?.L);
    await shot('03-reload-magwell.png', 'C18 echtes Nachladen am Magazinschacht');
    await run('finish-reload', () => window.fpTest.step(3.6));
    await hands('afterReload');
    record('reload-returns-left-grip', evidence.poses.afterReload?.L.target === 'W_Grip_L', evidence.poses.afterReload?.L);
    const sway = await run('continuous-fast-turn', () => { window.fpTest.turn(95, 0.12); return window.fpTest.weapon.state().sway.angle; });
    record('fast-turn-exercises-real-weapon-inertia', sway?.some(angle => Math.abs(angle) > 0.05), sway);
    await hands('fastTurn'); await shot('04-fast-turn.png', 'C18 echte kontinuierliche 95-Grad-Drehung');
    await run('look-down-pose', () => { window.fpTest.look(95, -65); window.fpTest.step(0.4); });
    await hands('lookDown'); await shot('05-look-down.png', 'C18 Blick nach unten');
    await run('free-target-pose', () => {
      const f = window.fpTest; f.look(0, -4); f.step(0.8); f.setTarget('L', 'free'); f.step(0.8);
    });
    await hands('freeTarget'); await shot('06-free-target.png', 'C18 freies Object3D-Handziel');
    evidence.rotation = await run('free-target-rotation', async () => {
      const T = await import('three'), f = window.fpTest, bone = f.arms.model.getObjectByName('LeftHand');
      const before = bone.getWorldQuaternion(new T.Quaternion()), targetBefore = f.freeTarget.getWorldQuaternion(new T.Quaternion());
      f.freeTarget.rotateY(0.6); f.step(0.8);
      const after = bone.getWorldQuaternion(new T.Quaternion()), targetAfter = f.freeTarget.getWorldQuaternion(new T.Quaternion());
      return { handChange: before.angleTo(after), targetChange: targetBefore.angleTo(targetAfter),
        deltaError: after.clone().multiply(before.clone().invert()).angleTo(targetAfter.clone().multiply(targetBefore.clone().invert())) };
    });
    record('hand-follows-free-target-rotation', evidence.rotation?.handChange > 0.55 && evidence.rotation?.deltaError < 0.005, evidence.rotation);
    evidence.release = await run('release-target', () => {
      window.fpTest.setTarget('L', 'release'); window.fpTest.step(0.3); return window.fpTest.arms.state().hands.L;
    });
    record('null-target-releases-ik', !!evidence.release && evidence.release.target == null, evidence.release);
    await run('restore-grip', () => { window.fpTest.setTarget('L', 'grip'); window.fpTest.step(0.5); });
    await hands('resetTarget');
    evidence.fingers = await run('finger-interpolation', () => {
      const f = window.fpTest, bone = f.arms.model.getObjectByName('LeftHandIndex2');
      f.arms.setFingerPose('L', 'grip', 0); f.step(0); const grip = bone.quaternion.clone();
      f.arms.setFingerPose('L', 'open', 0.4); f.step(0); const start = bone.quaternion.clone();
      f.step(0.2); const middle = bone.quaternion.clone(); f.step(0.2); const end = bone.quaternion.clone();
      f.arms.setFingerPose('L', 'trigger', 0.1); f.step(0.2); const trigger = bone.quaternion.clone();
      return { start: grip.angleTo(start), middle: grip.angleTo(middle), end: grip.angleTo(end),
        middleToEnd: middle.angleTo(end), triggerChange: end.angleTo(trigger),
        finite: [grip, start, middle, end, trigger].every(q => q.toArray().every(Number.isFinite)) };
    });
    record('finger-preset-starts-continuously', evidence.fingers?.start < 1e-7, evidence.fingers);
    record('finger-pose-interpolates-before-open', evidence.fingers?.middle > 0.05
      && evidence.fingers.end > evidence.fingers.middle && evidence.fingers.middleToEnd > 0.05, evidence.fingers);
    record('trigger-preset-changes-index-finger', evidence.fingers?.triggerChange > 0.1 && evidence.fingers.finite, evidence.fingers);
    await run('sprint-pose', () => {
      const f = window.fpTest; f.arms.setFingerPose('L', 'grip', 0.12); f.step(0.2); f.setPose('sprint'); f.step(0.35);
    });
    await hands('sprint'); await shot('07-sprint.png', 'C18 Sprint mit echten Handkontakten');
    await run('inspect-pose', () => { const f = window.fpTest; f.setPose('lowready'); f.step(0.5); f.setPose('inspect'); f.step(2); });
    await hands('inspect'); await shot('08-inspect.png', 'C18 Inspect ohne kuenstlichen Clip');
    await run('empty-reload-pose', () => { const f = window.fpTest; f.step(2); f.setPose('empty'); f.step(0.5); });
    await hands('emptyReload'); await shot('09-reload-empty.png', 'C18 echte ReloadEmpty-Pose');
    evidence.events = await run('weapon-events', () => {
      window.fpTest.step(2.6); return { counts: window.fpTest.stats().events, animation: window.fpTest.arms.state().animation };
    });
    const e = evidence.events?.counts;
    record('real-weapon-fire-reload-ads-state-events', e && e.shot > 0 && e.magOut > 0 && e.boltRelease > 0
      && e.adschange > 0 && e.statechange > 0, evidence.events);
    evidence.benchmarks = [];
    await run('benchmark-setup', () => { window.fpTest.setPose('lowready'); window.fpTest.step(0.5); window.fpTest.setMarkers(false); });
    for (let i = 0; i < 3; i++) {
      const baseline = await run(`benchmark-baseline-${i}`, () => window.fpTest.benchmark({ frames: 180, armsVisible: false }));
      const arms = await run(`benchmark-arms-${i}`, () => window.fpTest.benchmark({ frames: 180, armsVisible: true }));
      if (baseline && arms) evidence.benchmarks.push({ baseline, arms });
    }
    if (evidence.benchmarks.length === 3) {
      const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
      evidence.performance = { baseline: median(evidence.benchmarks.map(b => b.baseline.perFrame)),
        arms: median(evidence.benchmarks.map(b => b.arms.perFrame)),
        method: 'C18 unbounded real render/update loops with native gl.finish, median of three 180-frame rounds.' };
      evidence.performance.ratio = evidence.performance.arms / evidence.performance.baseline;
      record('retain-60fps-render-budget-or-within-15pct', evidence.performance.arms < 1000 / 60
        || evidence.performance.ratio <= 1.15, evidence.performance);
    }
    await run('benchmark-restore', () => { const f = window.fpTest; f.setArmsVisible(true); f.setMarkers(true); f.step(0.5); });
    await hands('afterBenchmark');
    evidence.dispose = await run('dispose', () => {
      const f = window.fpTest, before = { ...f.renderer.info.memory };
      f.arms.dispose(); f.arms.dispose(); f.render();
      return { before, after: { ...f.renderer.info.memory }, state: f.arms.state(), detached: !f.arms.root.parent,
        weaponParent: !!f.weapon.viewmodel.parent, weaponModelRestored: f.weapon.model.parent === f.weapon.viewmodel,
        retainedGripNode: !!f.weapon.model.getObjectByName('W_Grip_R') };
    });
    const d = evidence.dispose;
    record('dispose-idempotent-detaches-root', d?.detached, d);
    record('dispose-retains-weapon', d?.weaponParent, d);
    record('dispose-restores-weapon-parent-and-grips', d?.weaponModelRestored && d.retainedGripNode, d);
    record('dispose-releases-gpu-geometries-and-textures', d && d.after.geometries < d.before.geometries
      && d.after.textures < d.before.textures, d);
    await run('recreate', async () => { await window.fpTest.createInstances(); window.fpTest.step(0.5); });
    await hands('recreated');
    await page.setViewportSize({ width: 390, height: 844 });
    await run('mobile-step', () => window.fpTest.step(0.5));
    await shot('10-mobile.png', 'C18 echte mobile Viewportgroesse 390x844');
    evidence.mobile = await run('mobile-state', () => window.fpTest.stats());
    record('mobile-target-resizes-correctly', evidence.mobile?.renderTarget[0] === 390 && evidence.mobile?.renderTarget[1] === 844, evidence.mobile);

    await page.setViewportSize({ width: 1600, height: 900 });
    for (const enabled of [false, true]) {
      // C18 arm performance is isolated from C19 AI; the real App, house,
      // player, audio, post pipeline and normal weapons remain active.
      await page.goto(`${origin}/bodycam-demo/?debug=1&quality=high&npcs=0${enabled ? '' : '&arms=0'}`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => window.__bodycam?.ready === true, null, { timeout: 120000 });
      const audioOutput = await configureAudioOutput(page, audioSink);
      const setup = await run(`app-${enabled}-setup`, async enabled => {
        const a = window.__bodycam, c = a.dev.audio?.context;
        if (!c) throw new Error('Real App AudioContext unavailable');
        await a.resume(); a.teleport(-0.28, 0.608, -1.6, 0, -4);
        // AudioSinkInfo.type is an inherited getter, so explicit serialization
        // is needed for an honest cross-process native sink diagnostic.
        return { enabled, sinkId: typeof c.sinkId === 'string' ? c.sinkId : { type: c.sinkId.type }, stats: a.stats() };
      }, enabled);
      const entry = { enabled, setup, audioOutput }; evidence.app.push(entry);
      record(`app-${enabled ? 'default' : 'arms0'}-module-toggle`, setup?.stats.modules.arms === enabled, setup);
      record(`app-${enabled ? 'default' : 'arms0'}-native-audio-sink`, audioSink === 'none'
        ? setup?.sinkId?.type === 'none' : !!setup && (setup.sinkId === '' || setup.sinkId === 'default'), { requested: audioSink, actual: setup?.sinkId });
      record(`app-${enabled ? 'default' : 'arms0'}-no-integration-issues`, setup?.stats.issues.length === 0, setup?.stats.issues);
      await page.waitForTimeout(1800);
      entry.performance = await measureFrames(page, 4);
      entry.after = await run(`app-${enabled}-performance-state`, () => window.__bodycam.stats());
      record(`app-${enabled ? 'default' : 'arms0'}-playing-real-frame-loop`, entry.after?.phase === 'playing'
        && entry.after?.issues.length === 0, { phase: entry.after?.phase, issues: entry.after?.issues, performance: entry.performance });
      if (!enabled) continue;
      await run('app-freeze', () => { window.__bodycam.dev.freeze(true); window.__bodycam.dev.step(0.5); });
      const poses = [
        ['app-low-ready', () => {}],
        ['app-ads', () => { window.__bodycam.weapon.ads(true); window.__bodycam.dev.step(0.7); }],
        ['app-reload', () => { const a = window.__bodycam; a.weapon.ads(false); a.dev.step(0.3); a.weapon.fire(1); a.dev.step(0.2); a.weapon.reload(); a.dev.step(0.5); }],
        ['app-fast-turn', () => { const a = window.__bodycam; a.dev.step(4); for (let i = 1; i <= 15; i++) { a.player.look(95 * i / 15, -4); a.dev.step(0.12 / 15); } }],
        ['app-down', () => { window.__bodycam.look(95, -65); window.__bodycam.dev.step(0.5); }],
      ];
      for (const [label, fn] of poses) {
        await run(`${label}-pose`, fn); await hands(label, true); await shot(`${label}.png`, `Echte App ${label}`);
      }
      entry.recreate = await run('app-recreate', async () => {
        const a = window.__bodycam, { createFPArms } = await import('/bodycam-demo/js/fp/arms.js');
        const before = { ...a.dev.renderer.info.memory };
        a.arms.dispose(); a.dev.render(); const empty = { ...a.dev.renderer.info.memory };
        let next;
        try {
          next = await createFPArms({ weapon: a.weapon, camera: a.dev.camera, renderer: a.dev.renderer,
            audio: a.dev.audio, baseUrl: new URL('/bodycam-demo/', location.href) });
          next.update(0.5); a.dev.render();
          return { before, empty, again: { ...a.dev.renderer.info.memory }, hands: next.state().hands };
        } finally {
          next?.dispose(); a.dev.render(); window.__armsFinalMemory = { ...a.dev.renderer.info.memory };
        }
      });
      entry.finalMemory = await run('app-final-memory', () => window.__armsFinalMemory);
      record('app-recreated-geometry-count-matches', entry.recreate?.again.geometries === entry.recreate?.before.geometries
        && !!entry.recreate, entry.recreate);
      record('app-recreate-restores-resource-baseline', entry.recreate && entry.finalMemory
        && entry.finalMemory.geometries === entry.recreate.empty.geometries && entry.finalMemory.textures === entry.recreate.empty.textures,
      { recreate: entry.recreate, final: entry.finalMemory });
    }
    const baseline = evidence.app.find(item => !item.enabled)?.performance;
    const armed = evidence.app.find(item => item.enabled)?.performance;
    record('app-fps-within-5pct-of-arms0', !!baseline && !!armed && armed.fps >= baseline.fps * 0.95,
      { baseline, armed, method: 'Real App high 1600x900/DPR1, 1.8s warmup + 4s rAF; npcs=0 in both paths isolates arms. rAF is display capped.' });
    await page.waitForTimeout(200);
  } catch (error) {
    record('uncaught', false, { error: String(error.stack ?? error) });
    await shot('arms-failure.png', 'Regressionsfehler');
  } finally {
    record('no-console-errors-or-warnings', evidence.diagnostics.errors.length === 0 && evidence.diagnostics.warnings.length === 0,
      { errors: evidence.diagnostics.errors, warnings: evidence.diagnostics.warnings });
    record('no-failed-asset-requests', evidence.diagnostics.requests.length === 0, evidence.diagnostics.requests);
    page.off('pageerror', onPageError); page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed); page.off('response', onResponse);
    if (originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
  }
  return { checks, evidence };
}

async function measureHands(app = false) {
  const T = await import('three');
  const f = app ? { arms: window.__bodycam.arms, weapon: window.__bodycam.weapon,
    scene: window.__bodycam.dev.scene } : window.fpTest;
  f.scene.updateMatrixWorld(true);
  return Object.fromEntries(['L', 'R'].map(side => {
    const data = f.arms.state().hands[side];
    const bone = f.arms.model.getObjectByName(side === 'L' ? 'LeftHand' : 'RightHand');
    const target = f.weapon.nodes[data.target] ?? f.scene.getObjectByName(data.target);
    const actualPosition = bone?.getWorldPosition(new T.Vector3()), actualQ = bone?.getWorldQuaternion(new T.Quaternion());
    if (bone && typeof data.target === 'string' && data.target.startsWith('reload:'))
      // Choreographed reload pose: compare with the solved target the arms report.
      return [side, { ...data, measured: actualPosition.distanceTo(new T.Vector3(...data.targetPosition)),
        measuredRotation: actualQ.angleTo(new T.Quaternion(...data.targetQuaternion)), actualPosition: actualPosition.toArray() }];
    if (!target || !bone) return [side, { ...data, measured: null, measuredRotation: null }];
    const grip = f.arms.config.grips[side];
    // Independent world-space basis from configured finger/palm directions.
    // Comparing the actual bone quaternion also detects stale metric snapshots.
    const targetQ = target.getWorldQuaternion(new T.Quaternion());
    const y = new T.Vector3(...grip.fingers).normalize().applyQuaternion(targetQ);
    const z = new T.Vector3(...grip.palm).normalize().applyQuaternion(targetQ);
    const x = new T.Vector3().crossVectors(y, z).normalize(); z.crossVectors(x, y).normalize();
    const desired = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
    // Automatic grips place the palm contact on the anchor offset; other targets take the wrist.
    const wrist = data.target === `W_Grip_${side}`
      ? target.localToWorld(new T.Vector3(...grip.anchor)).sub(new T.Vector3(...grip.contact).applyQuaternion(desired))
      : target.getWorldPosition(new T.Vector3());
    return [side, { ...data, measured: actualPosition.distanceTo(wrist), measuredRotation: actualQ.angleTo(desired),
      actualPosition: actualPosition.toArray(), actualQuaternion: actualQ.toArray() }];
  }));
}
