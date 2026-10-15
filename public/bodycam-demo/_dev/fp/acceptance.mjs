import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE
  || '/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright/index.mjs'));
const out = process.env.C18_WORK || '/Users/logge/Documents/Projects/bodycam-work/codex/C18';
await mkdir(`${out}/screenshots`, { recursive: true });
await mkdir(`${out}/reports`, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const report = { checks: [], errors: [], warnings: [], requests: [], shots: {} };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
page.on('requestfailed', request => report.requests.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('response', response => { if (response.status() >= 400) report.requests.push(`${response.status()}: ${response.url()}`); });
const run = fn => page.evaluate(fn);
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
const shot = async name => {
  await page.screenshot({ path: `${out}/screenshots/${name}.png` });
  report.shots[name] = await run(() => fpTest.stats());
};
const handCheck = async label => {
  const hands = await run(async () => {
    const T = await import('three');
    const f = fpTest;
    f.scene.updateMatrixWorld(true);
    return Object.fromEntries(['L', 'R'].map(side => {
      const data = f.arms.state().hands[side];
      const bone = f.arms.model.getObjectByName(side === 'L' ? 'LeftHand' : 'RightHand');
      // Grips touch with the palm and the reload is choreographed, so measure against the solved wrist target.
      return [side, { ...data, measured: data.targetPosition
        ? bone.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(...data.targetPosition)) : null }];
    }));
  });
  report[label] = hands;
  for (const side of ['L', 'R']) {
    const hand = hands[side];
    check(`${label}: ${side} actual hand bone within 5 mm`, Number.isFinite(hand.measured) && hand.measured < 0.005);
    check(`${label}: ${side} metrics agree with scene measurement`, Math.abs(hand.measured - hand.distanceMeters) < 1e-6);
    check(`${label}: ${side} target rotation reached`, Number.isFinite(hand.quaternionError) && hand.quaternionError < 0.005);
  }
  return hands;
};
try {
  await page.goto(process.env.C18_URL || 'http://127.0.0.1:8967/bodycam-demo/_dev/fp/?pause=1&markers=1');
  await page.waitForFunction(() => window.fpTest?.ready === true, null, { timeout: 60000 });
  await run(() => { fpTest.freeze(true); fpTest.step(0.4); });
  report.initial = await run(() => fpTest.stats());
  check('Real Metal WebGL2 renderer', /Metal/.test(report.initial.gpu) && !/SwiftShader|llvmpipe/i.test(report.initial.gpu));
  report.structure = await run(() => {
    const f = fpTest, names = [], layers = [], skins = [];
    f.arms.model.traverse(node => {
      names.push(node.name);
      if (node.isMesh) {
        layers.push(node.layers.mask);
        skins.push({ name: node.name, skinned: !!node.isSkinnedMesh,
          triangles: (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 });
      }
    });
    return { names, layers, skins, target: [f.viewmodelTarget.width, f.viewmodelTarget.height],
      cameraParent: f.arms.root.parent?.name, modelParent: f.arms.model.parent?.name,
      weaponParent: f.weapon.model.parent?.name, socketParent: f.weapon.model.parent?.parent?.name };
  });
  check('All arms meshes exclusively viewmodel layer 1', report.structure.layers.length > 0 && report.structure.layers.every(layer => layer === 2));
  check('Required FP nodes present', ['FP_Root', 'FP_Camera', 'FP_WeaponSocket'].every(name => report.structure.names.includes(name)));
  check('Actual weapon model hangs from FP_WeaponSocket under viewmodel',
    report.structure.weaponParent === 'FP_WeaponSocket' && report.structure.socketParent === 'WeaponViewmodel');
  check('First-person geometry at most 40k triangles', report.structure.skins.reduce((sum, mesh) => sum + mesh.triangles, 0) <= 40000);
  check('Arms include skinned meshes', report.structure.skins.some(mesh => mesh.skinned));
  check('Separate viewmodel render target uses screen dimensions', report.structure.target[0] === 1600 && report.structure.target[1] === 900);
  await handCheck('lowReady');
  await shot('01-low-ready');
  await run(() => { fpTest.weapon.ads(true); fpTest.step(0.65); });
  await handCheck('ADS');
  await shot('02-ads');
  await run(() => { fpTest.weapon.ads(false); fpTest.step(0.3); fpTest.weapon.fire(1); fpTest.step(0.2); fpTest.weapon.reload(); fpTest.step(0.06); fpTest.turn(95, 0.08); });
  report.reloadTurnBlend = await run(async () => {
    const T = await import('three');
    const f = fpTest, hand = f.arms.state().hands.L;
    const actual = f.arms.model.getObjectByName('LeftHand').getWorldPosition(new T.Vector3());
    return { ...hand, independentlyMeasured: actual.distanceTo(new T.Vector3(...hand.targetPosition)) };
  });
  check('Reload choreography stays active during fast turn', report.reloadTurnBlend.target?.startsWith('reload:'));
  check('Reload target transition stays reachable during fast turn', report.reloadTurnBlend.reachable);
  check('Reload fast turn keeps left hand within 5mm of blended IK target', report.reloadTurnBlend.independentlyMeasured < 0.005);
  check('Reload fast turn independent error agrees with metrics', Math.abs(report.reloadTurnBlend.independentlyMeasured - report.reloadTurnBlend.distanceMeters) < 1e-6);
  await run(() => { fpTest.look(0, -4); fpTest.step(0.26); });
  report.reload = await handCheck('reloadMagwell');
  check('Reload detaches left hand from forward grip', report.reload.L.target !== 'W_Grip_L');
  await shot('03-reload-magwell');
  await run(() => fpTest.step(3.6));
  await handCheck('afterReload');
  check('Reload returns left hand to grip', report.afterReload.L.target === 'W_Grip_L');
  await run(() => fpTest.turn(95, 0.12));
  check('Fast turn exercises real weapon inertia', (await run(() => fpTest.weapon.state().sway.angle)).some(angle => Math.abs(angle) > 0.05));
  await handCheck('fastTurn');
  await shot('04-fast-turn');
  await run(() => { fpTest.look(95, -65); fpTest.step(0.4); });
  await handCheck('lookDown');
  await shot('05-look-down');
  await run(() => { fpTest.look(0, -4); fpTest.step(0.8); fpTest.setTarget('L', 'free'); fpTest.step(0.8); });
  await handCheck('freeTarget');
  await shot('06-free-target');
  report.rotation = await run(async () => {
    const T = await import('three');
    const f = fpTest, bone = f.arms.model.getObjectByName('LeftHand');
    const before = bone.getWorldQuaternion(new T.Quaternion());
    const targetBefore = f.freeTarget.getWorldQuaternion(new T.Quaternion());
    f.freeTarget.rotateY(0.6); f.step(0.8);
    const after = bone.getWorldQuaternion(new T.Quaternion());
    const targetAfter = f.freeTarget.getWorldQuaternion(new T.Quaternion());
    const actualDelta = after.clone().multiply(before.clone().invert());
    const targetDelta = targetAfter.clone().multiply(targetBefore.clone().invert());
    return { handChange: before.angleTo(after), targetChange: targetBefore.angleTo(targetAfter),
      deltaError: actualDelta.angleTo(targetDelta), state: f.arms.state().hands.L };
  });
  check('Hand rotation follows free target rotation', report.rotation.handChange > 0.55 && report.rotation.deltaError < 0.005);
  report.release = await run(() => { fpTest.setTarget('L', 'release'); fpTest.step(0.3); return fpTest.arms.state().hands.L; });
  check('null target releases left IK', report.release.target === null || report.release.target === undefined);
  await run(() => { fpTest.setTarget('L', 'grip'); fpTest.step(0.5); });
  await handCheck('resetTarget');
  report.fingers = await run(async () => {
    const T = await import('three');
    const f = fpTest, bone = f.arms.model.getObjectByName('LeftHandIndex2');
    f.arms.setFingerPose('L', 'grip', 0); f.step(0);
    const grip = bone.quaternion.clone();
    f.arms.setFingerPose('L', 'open', 0.4); f.step(0);
    const start = bone.quaternion.clone();
    f.step(0.2); const middle = bone.quaternion.clone();
    f.step(0.2); const end = bone.quaternion.clone();
    f.arms.setFingerPose('L', 'trigger', 0.1); f.step(0.2);
    const trigger = bone.quaternion.clone();
    return { start: grip.angleTo(start), middle: grip.angleTo(middle), end: grip.angleTo(end),
      middleToEnd: middle.angleTo(end), triggerChange: end.angleTo(trigger),
      finite: [grip, start, middle, end, trigger].every(q => q.toArray().every(Number.isFinite)) };
  });
  check('Finger preset starts continuously', report.fingers.start < 1e-7);
  check('Finger pose interpolates before reaching open', report.fingers.middle > 0.05 && report.fingers.end > report.fingers.middle && report.fingers.middleToEnd > 0.05);
  check('Trigger preset changes index finger', report.fingers.triggerChange > 0.1 && report.fingers.finite);
  await run(() => { fpTest.arms.setFingerPose('L', 'grip', 0.12); fpTest.step(0.2); fpTest.setPose('sprint'); fpTest.step(0.35); });
  await handCheck('sprint');
  await shot('07-sprint');
  await run(() => { fpTest.setPose('lowready'); fpTest.step(0.5); fpTest.setPose('inspect'); fpTest.step(2); });
  await handCheck('inspect');
  await shot('08-inspect');
  await run(() => { fpTest.step(2); fpTest.setPose('empty'); fpTest.step(0.5); });
  await handCheck('emptyReload');
  await shot('09-reload-empty');
  await run(() => fpTest.step(2.6));
  report.events = await run(() => ({ counts: fpTest.stats().events, animation: fpTest.arms.state().animation }));
  check('Real weapon events cover fire, reload, ADS, sprint and inspect',
    report.events.counts.shot > 0 && report.events.counts.magOut > 0 && report.events.counts.boltRelease > 0 && report.events.counts.adschange > 0 && report.events.counts.statechange > 0);
  report.benchmarks = [];
  await run(() => { fpTest.setPose('lowready'); fpTest.step(0.5); fpTest.setMarkers(false); });
  for (let i = 0; i < 3; i++) {
    report.benchmarks.push({ baseline: await run(() => fpTest.benchmark({ frames: 180, armsVisible: false })),
      arms: await run(() => fpTest.benchmark({ frames: 180, armsVisible: true })) });
  }
  const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.performance = { baseline: median(report.benchmarks.map(b => b.baseline.perFrame)),
    arms: median(report.benchmarks.map(b => b.arms.perFrame)) };
  report.performance.ratio = report.performance.arms / report.performance.baseline;
  check('Arms retain 60 FPS render budget or stay within 15% of baseline',
    report.performance.arms < 1000 / 60 || report.performance.ratio <= 1.15);
  await run(() => { fpTest.setArmsVisible(true); fpTest.setMarkers(true); fpTest.step(0.5); });
  await handCheck('afterBenchmark');
  report.dispose = await run(() => {
    const f = fpTest;
    const before = { geometries: f.renderer.info.memory.geometries, textures: f.renderer.info.memory.textures };
    f.arms.dispose(); f.arms.dispose();
    f.render();
    return { before, after: { geometries: f.renderer.info.memory.geometries, textures: f.renderer.info.memory.textures },
      state: f.arms.state(), detached: !f.arms.root.parent, weaponParent: !!f.weapon.viewmodel.parent,
      weaponModelRestored: f.weapon.model.parent === f.weapon.viewmodel,
      retainedGripNode: !!f.weapon.model.getObjectByName('W_Grip_R') };
  });
  check('Arms disposal is idempotent and detaches root', report.dispose.detached);
  check('Arms disposal retains weapon', report.dispose.weaponParent);
  check('Arms disposal restores original weapon model parent and grip nodes', report.dispose.weaponModelRestored && report.dispose.retainedGripNode);
  check('Arms disposal releases GPU geometry and textures', report.dispose.after.geometries < report.dispose.before.geometries && report.dispose.after.textures < report.dispose.before.textures);
  await run(async () => { await fpTest.createInstances(); fpTest.step(0.5); });
  await handCheck('recreated');
  await page.setViewportSize({ width: 390, height: 844 });
  await run(() => fpTest.step(0.5));
  await shot('10-mobile');
  report.mobile = await run(() => fpTest.stats());
  check('Mobile render target resized correctly', report.mobile.renderTarget[0] === 390 && report.mobile.renderTarget[1] === 844);
  check('No console errors or warnings', report.errors.length === 0 && report.warnings.length === 0);
  check('No failed asset requests', report.requests.length === 0);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack;
  await page.screenshot({ path: `${out}/screenshots/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/reports/fp-acceptance.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure,
    errors: report.errors, warnings: report.warnings, requests: report.requests, performance: report.performance }, null, 2));
  await browser.close();
}
