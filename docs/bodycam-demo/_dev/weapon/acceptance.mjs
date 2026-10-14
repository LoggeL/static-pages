import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE
  || '/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright/index.mjs'));
const out = process.env.C3_WORK || '/Users/logge/Documents/Projects/bodycam-work/codex/C3';
await mkdir(`${out}/screenshots`, { recursive: true });
await mkdir(`${out}/reports`, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const report = { checks: [], errors: [], warnings: [], requests: [], shots: {} };
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); if (msg.type() === 'warning') report.warnings.push(msg.text()); });
page.on('requestfailed', req => report.requests.push(`${req.url()}: ${req.failure()?.errorText}`));
page.on('response', res => { if (res.status() >= 400) report.requests.push(`${res.status()}: ${res.url()}`); });
const run = fn => page.evaluate(fn);
const snapshot = async name => {
  await page.screenshot({ path: `${out}/screenshots/${name}.png` });
  report.shots[name] = await run(() => __bodycam.stats());
};
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
try {
  await page.goto(process.env.C3_URL || 'http://127.0.0.1:8955/bodycam-demo/_dev/weapon/?debug=1&inspect=1&hall=1');
  await page.waitForFunction(() => window.__bodycam?.ready === true, null, { timeout: 60000 });
  await run(() => { __bodycam.dev.pause(true); __bodycam.dev.step(0.5); });
  report.initial = await run(() => __bodycam.stats());
  check('WebGL2 on real Metal GPU', /Metal/.test(report.initial.gpu) && !/SwiftShader|llvmpipe/i.test(report.initial.gpu));
  check('Initial 30+1 rounds, four spare magazines', report.initial.weapon.ammo === 31 && report.initial.weapon.spareMagazines === 4);
  const muzzle = await run(() => __bodycam.dev.projectNode('W_Muzzle'));
  report.muzzle = muzzle;
  check('Low-ready muzzle projects to (0.52,0.55)', Math.abs(muzzle[0] - 0.52) < 1e-7 && Math.abs(muzzle[1] - 0.55) < 1e-7);
  await snapshot('01-low-ready');
  await run(() => { __bodycam.weapon.ads(true); __bodycam.dev.step(0.28); });
  report.ads = await run(async () => {
    const T = await import('three');
    const { weapon, dev } = __bodycam;
    const eye = dev.camera.worldToLocal(weapon.nodes.W_SightEye.getWorldPosition(new T.Vector3()));
    const reticle = new T.Box3().setFromObject(weapon.nodes.W_Reticle).getCenter(new T.Vector3()).project(dev.camera);
    const layers = [];
    weapon.model.traverse(n => { if (n.isMesh) layers.push(n.layers.mask); });
    return { eye: eye.toArray(), reticle: [(reticle.x + 1) / 2, (1 - reticle.y) / 2], layers };
  });
  check('ADS eye lies on camera, reticle centered', Math.hypot(...report.ads.eye) < 1e-7 && Math.abs(report.ads.reticle[0] - 0.5) < 0.001 && Math.abs(report.ads.reticle[1] - 0.5) < 0.001);
  check('All model meshes exclusively layer 1', report.ads.layers.every(mask => mask === 2));
  await snapshot('02-ads');
  await run(() => { __bodycam.weapon.ads(false); __bodycam.dev.step(0.22); __bodycam.dev.inspectionLight(false); __bodycam.weapon.fire(1); __bodycam.dev.render(); });
  await snapshot('03-muzzle-flash');
  report.flash = await run(() => {
    const b = __bodycam; const start = b.weapon.state().effects.flash;
    b.dev.step(2 / 60); const held = b.weapon.state().effects.flash;
    b.dev.step(0.015); const decayed = b.weapon.state().effects.flash;
    b.dev.step(0.25); return { start, held, decayed, end: b.weapon.state().effects.flash };
  });
  check('Flash holds 2/60s then decays with 15ms tau', report.flash.start.intensity === 30 && Math.abs(report.flash.held.intensity - 30) < 1e-6 && Math.abs(report.flash.decayed.intensity - 30 / Math.E) < 1e-5 && !report.flash.end.visible);
  await run(() => { __bodycam.dev.inspectionLight(true); __bodycam.weapon.ads(true); __bodycam.dev.step(0.7); });
  for (const [surface, position, file] of [
    ['wood', [1.05, 0.608, -4.95, -90, -45], '04-wood-impact'],
    ['plaster', [-0.28, 0.608, -2.5, 30, 5], '05-plaster-impact'],
    ['metal', [-2.7, 0.608, -8.15, 0, -25], '06-metal-impact'],
  ]) {
    const hit = await page.evaluate(position => {
      const b = __bodycam; b.teleport(...position); b.dev.step(0.8);
      b.weapon.fire(1); b.dev.step(0.15);
      return b.weapon.state().lastHit;
    }, position);
    report[surface] = hit;
    check(`Actual house hit on ${surface}`, hit?.surface === surface);
    check(`${surface} finite hit point and unit normal`, hit.point.every(Number.isFinite) && Math.abs(Math.hypot(...hit.normal) - 1) < 1e-6);
    await snapshot(file);
    await page.evaluate(async hit => {
      const T = await import('three'); const b = __bodycam;
      const point = new T.Vector3(...hit.point); const normal = new T.Vector3(...hit.normal);
      b.weapon.viewmodel.visible = false;
      b.dev.camera.position.copy(point).addScaledVector(normal, 0.38);
      b.dev.camera.up.set(0, 1, Math.abs(normal.y) > 0.9 ? -1 : 0).normalize();
      b.dev.camera.lookAt(point); b.dev.camera.updateMatrixWorld(true); b.dev.render();
    }, hit);
    await snapshot(`${file}-detail`);
    await run(() => { __bodycam.weapon.viewmodel.visible = true; __bodycam.dev.camera.up.set(0, 1, 0); });
  }
  await run(() => { const b = __bodycam; b.teleport(-0.28, 0.608, -1.6, 0, -4); b.dev.step(0.8); b.weapon.fire(3); b.dev.step(2); b.look(0, -75); b.dev.render(); });
  report.casings = await run(() => __bodycam.weapon.state().effects.casings);
  check('Casing pool settles on actual floor and emits casingHit', report.casings.settled > 0 && (await run(() => __bodycam.dev.counts.casingHit)) > 0);
  await snapshot('07-casings');
  await run(async () => {
    const T = await import('three'); const b = __bodycam;
    const slot = b.weapon.state().effects.casings.positions.find(s => s.settled);
    const point = new T.Vector3(...slot.position);
    b.weapon.viewmodel.visible = false;
    b.dev.camera.position.copy(point).add(new T.Vector3(0.10, 0.15, 0.13));
    const inspection = new T.PointLight(0xffffff, 0.8, 2);
    inspection.name = 'CasingDetailInspectionLight';
    inspection.position.copy(point).add(new T.Vector3(0.06, 0.18, 0.04));
    b.dev.scene.add(inspection);
    b.dev.camera.lookAt(point); b.dev.camera.updateMatrixWorld(true); b.dev.render();
  });
  await snapshot('07-casings-detail');
  await run(() => {
    __bodycam.weapon.viewmodel.visible = true;
    __bodycam.dev.scene.getObjectByName('CasingDetailInspectionLight').removeFromParent();
  });
  await run(() => { const b = __bodycam; b.look(0, -4); b.weapon.ads(false); b.dev.step(0.3); b.dev.clearEvents(); b.weapon.reload(); b.dev.step(1.3); });
  check('Tactical reload midpoint', (await run(() => __bodycam.weapon.state())).state === 'reload');
  await snapshot('08-reload-middle');
  await run(() => __bodycam.dev.step(2.4));
  report.reload = await run(() => ({ state: __bodycam.weapon.state(), events: __bodycam.dev.events }));
  check('Tactical reload refills 30+1 and consumes one spare', report.reload.state.ammo === 31 && report.reload.state.spareMagazines === 3);
  for (const marker of ['magOut', 'magStow', 'magIn', 'settle']) check(`Reload event ${marker} exactly once`, report.reload.events.filter(e => e.type === marker).length === 1);
  await run(() => { const b = __bodycam; b.weapon.fire(31); b.dev.step(3); b.dev.clearEvents(); b.weapon.fire(1); b.dev.step(0.2); b.weapon.reload(); b.dev.step(1.4); });
  check('Empty reload midpoint', (await run(() => __bodycam.weapon.state())).state === 'reloadEmpty');
  await snapshot('09-reload-empty-middle');
  await run(() => __bodycam.dev.step(1.5));
  report.empty = await run(() => ({ state: __bodycam.weapon.state(), events: __bodycam.dev.events }));
  check('Empty reload chambers one from new magazine', report.empty.state.ammo === 30 && report.empty.state.magazine === 29 && report.empty.state.chamber === 1);
  check('Dry fire and boltRelease delivered', report.empty.events.some(e => e.type === 'dryFire') && report.empty.events.some(e => e.type === 'boltRelease'));
  await run(() => { __bodycam.weapon.ads(true); __bodycam.weapon.light(true); __bodycam.dev.inspectionLight(false); __bodycam.dev.step(0.3); });
  await snapshot('10-flashlight');
  report.light = await run(() => __bodycam.weapon.state().effects.lights);
  await run(() => { __bodycam.weapon.light(false); __bodycam.dev.inspectionLight(true); __bodycam.weapon.inspect(); __bodycam.dev.step(2); });
  await snapshot('11-inspect');
  await run(() => __bodycam.dev.step(2));
  await page.keyboard.press('KeyB');
  check('B switches actual C12 input to Auto', (await run(() => __bodycam.weapon.state())).mode === 'auto');
  await page.mouse.move(800, 450);
  const before = await run(() => __bodycam.weapon.state().shots);
  await page.mouse.down();
  await run(() => __bodycam.dev.step(0.3));
  await page.mouse.up();
  await run(() => __bodycam.dev.step(0.3));
  check('Mouse Auto press/release fires four rounds at 650 rpm', (await run(() => __bodycam.weapon.state().shots)) - before === 4);
  await page.keyboard.down('Shift'); await page.keyboard.down('w');
  await run(() => __bodycam.dev.step(0.2));
  check('Player sprint drives weapon state', (await run(() => __bodycam.weapon.state())).state === 'sprint');
  await snapshot('12-sprint');
  await page.keyboard.up('w'); await page.keyboard.up('Shift');
  await run(() => __bodycam.dev.step(0.5));
  check('Console clean', report.errors.length === 0 && report.warnings.length === 0);
  check('No failed asset requests', report.requests.length === 0);
  report.final = await run(() => __bodycam.stats());
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack;
  await page.screenshot({ path: `${out}/screenshots/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/reports/acceptance.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure,
    errors: report.errors, warnings: report.warnings, requests: report.requests }, null, 2));
  await browser.close();
}
