// Node/Playwright acceptance. Output is deliberately outside the repository.
// PLAYWRIGHT_MODULE may point to an existing installation's index.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.C12_WORK || '/Users/logge/Documents/Projects/bodycam-work/codex/C12';
const base = process.env.C12_URL || 'http://127.0.0.1:8951/bodycam-demo/_dev/world/';
await fs.mkdir(path.join(out, 'reports'), { recursive: true });
await fs.mkdir(path.join(out, 'screenshots'), { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { date: new Date().toISOString(), errors: [], warnings: [], info: [], trace: [], views: [], checks: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  else if (message.type() === 'warning') report.warnings.push(message.text());
  else if (message.type() === 'info') report.info.push(message.text());
});
page.on('requestfailed', request => report.errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const state = () => page.evaluate(() => window.__bodycam.stats());
const snapshot = async label => {
  const value = await state();
  report.trace.push({ label, time: value.simulatedTime, position: value.position, room: value.room,
    grounded: value.grounded, surface: value.surface, speed: value.speed, interaction: value.interaction,
    input: await page.evaluate(() => ({ active: __bodycam.dev.input.active, forward: __bodycam.dev.input.isDown('KeyW') })) });
  return value;
};

async function walkTo(x, z, label, timeout = 18000) {
  const started = Date.now();
  let closest = Infinity;
  let lastProgress = started;
  await page.keyboard.down('KeyW');
  try {
    while (true) {
      const current = await snapshot(label);
      const dx = x - current.position[0];
      const dz = z - current.position[2];
      const distance = Math.hypot(dx, dz);
      if (distance < 0.065) break;
      if (distance < closest - 0.025) { closest = distance; lastProgress = Date.now(); }
      assert(Date.now() - started < timeout && Date.now() - lastProgress < 4000,
        `${label} blockiert: ${JSON.stringify(current.position)}`);
      await page.evaluate(yaw => window.__bodycam.look(yaw, -4), Math.atan2(-dx, -dz) * 180 / Math.PI);
      await page.waitForTimeout(80);
    }
  } finally { await page.keyboard.up('KeyW'); }
  await page.waitForTimeout(120);
  console.log(label, (await state()).position.map(value => value.toFixed(3)).join(', '));
}

try {
  await page.goto(new URL('physics-tests.html', base).href);
  await page.waitForFunction(() => window.__physicsResults);
  report.physics = await page.evaluate(() => window.__physicsResults);
  assert(report.physics.passed, JSON.stringify(report.physics.tests.filter(test => !test.passed)));
  await page.goto(`${base}?debug=1`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', { timeout: 60000 });
  await page.waitForTimeout(700);
  await page.locator('#view').focus();
  report.gpu = await page.evaluate(() => {
    const gl = window.__bodycam.dev.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { version: gl.getParameter(gl.VERSION), renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
  assert(/Metal/.test(report.gpu.renderer) && !/SwiftShader/i.test(report.gpu.renderer), JSON.stringify(report.gpu));
  report.loaded = await state();
  console.log('Welt bereit', report.gpu.renderer, report.loaded.world);

  // Der Abnahmelauf startet am echten Layout-Spawn. Keine Positionsänderung.
  await snapshot('spawn');
  await walkTo(-0.28, 9.7, 'street-to-front-walk');
  await walkTo(-0.28, 3.7, 'front-walk');
  await walkTo(-0.28, 1.05, 'stairs-to-porch');
  const porch = await snapshot('porch');
  assert(porch.position[1] > 0.54 && porch.position[1] < 0.62, `Verandahöhe ${porch.position[1]}`);
  await page.evaluate(() => window.__bodycam.look(0, -4));
  const target = await state();
  assert.equal(target.interaction, 'front', 'Haustür im Blick innerhalb von 2 m');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1100);
  assert(Math.abs(await page.evaluate(() => window.__bodycam.player.lean)) < 0.001, 'E-Interaktion muss Lehnen unterdrücken');
  await page.keyboard.up('KeyE');
  const openAngle = await page.evaluate(() => window.__bodycam.dev.world.doors.find(door => door.id === 'front').angle);
  assert(openAngle > 95, `Haustür öffnet nur ${openAngle} Grad`);
  await walkTo(-0.20, -1.5, 'front-door-to-hall');
  const hall = await snapshot('hall');
  assert.equal(hall.room, 'HAL');
  assert(hall.position[1] > 0.59 && hall.position[1] < 0.64, 'Flurboden erreicht');
  assert(hall.steps > 5, 'Schritt-Events fehlen');
  report.checks.push({ name: 'spawn-stairs-door-hall-real-keyboard', passed: true, final: hall.position, openAngle });
  await page.screenshot({ path: path.join(out, 'screenshots', 'walk-final-hall.png') });

  // Eine schließende echte Tür darf die Kapsel nicht in ihre Zarge drücken.
  await page.evaluate(() => window.__bodycam.teleport(-0.28, 0.61, -0.25, 0, -4));
  await page.waitForTimeout(200);
  const inDoorway = await state();
  await page.evaluate(() => window.__bodycam.dev.world.doors.find(door => door.id === 'front').setOpen(false));
  await page.waitForTimeout(1300);
  const blockedDoor = await page.evaluate(() => {
    const door = window.__bodycam.dev.world.doors.find(candidate => candidate.id === 'front');
    return { blocked: door.blocked, angle: door.angle };
  });
  const afterClose = await state();
  assert(blockedDoor.blocked && blockedDoor.angle > 0, `Tür stoppt nicht an Kapsel: ${JSON.stringify(blockedDoor)}`);
  assert(Math.hypot(...afterClose.position.map((value, index) => value - inDoorway.position[index])) < 0.02,
    'Schließende Tür verschiebt Spieler');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__bodycam.dev.world.doors.find(door => door.id === 'front').angle), 0,
    'Tür schließt nach Freigabe nicht vollständig');
  await page.evaluate(() => window.__bodycam.teleport(-0.28, 0.58, 1.2, 0, -4));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1300);
  await page.keyboard.up('KeyW');
  const closedStop = await state();
  assert(closedStop.position[2] > 0.04, `Geschlossene Tür durchlaufen: ${closedStop.position}`);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1200);
  report.checks.push({ name: 'real-door-blocking-and-player-guard', passed: true,
    blockedAngle: blockedDoor.angle, closedStop: closedStop.position });

  await page.evaluate(() => window.__bodycam.teleport(-5, -0.20, 14, 0, -4));
  await page.waitForTimeout(200);
  const neutralCamera = (await state()).cameraPosition;
  for (const [key, direction] of [['KeyQ', -1], ['KeyE', 1]]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(600);
    const leaned = await state();
    const shift = leaned.cameraPosition[0] - neutralCamera[0];
    const roll = await page.evaluate(() => window.__bodycam.player.camera.rotation.z * 180 / Math.PI);
    assert(Math.abs(shift - direction * 0.3) < 0.012, `${key}: seitliches Lehnen ${shift}`);
    assert(Math.abs(roll + direction * 10) < 0.2, `${key}: Roll ${roll}`);
    await page.keyboard.up(key);
    await page.waitForTimeout(550);
    report.checks.push({ name: `lean-${key}`, shift, roll, passed: true });
  }
  await page.evaluate(() => window.__bodycam.teleport(-0.52, 0.61, -1.0, 0, -4));
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(600);
  const wallLean = (await state()).cameraPosition;
  await page.keyboard.up('KeyQ');
  assert(wallLean[0] >= -0.805, `Kamera lehnt durch Wand: ${wallLean}`);
  report.checks.push({ name: 'lean-camera-wall-clearance', camera: wallLean, passed: true });

  // Gerade freie Straße: Geschwindigkeiten und normierte diagonale Bewegung.
  for (const entry of [
    { name: 'walk', keys: ['KeyW'], speed: 1.5 },
    { name: 'sneak', keys: ['AltLeft', 'KeyW'], speed: 1.0 },
    { name: 'sprint', keys: ['ShiftLeft', 'KeyW'], speed: 4.5 },
    { name: 'crouch', keys: ['KeyC', 'KeyW'], speed: 0.85 },
    { name: 'diagonal', keys: ['KeyW', 'KeyD'], speed: 1.5 },
  ]) {
    await page.evaluate(() => window.__bodycam.teleport(-6, -0.245, 14, 90, -4));
    await page.waitForTimeout(160);
    const start = await state();
    for (const key of entry.keys) await page.keyboard.down(key);
    await page.waitForTimeout(850);
    for (const key of entry.keys.toReversed()) await page.keyboard.up(key);
    const end = await state();
    const measured = Math.hypot(end.position[0] - start.position[0], end.position[2] - start.position[2]) / (end.simulatedTime - start.simulatedTime);
    assert(Math.abs(measured - entry.speed) < 0.15, `${entry.name}: ${measured} statt ${entry.speed}`);
    report.checks.push({ name: entry.name, measured, expected: entry.speed, passed: true });
  }

  const poses = [
    ['01-spawn', 4.6, -0.22, 11, 26, -4, 'OUT'],
    ['02-porch', -0.28, 0.58, 1.8, 0, -4, 'PORCH'],
    ['03-hall', -0.28, 0.61, -1.4, 0, -4, 'HAL'],
    ['04-living', -2.6, 0.61, -3.1, 95, -5, 'LIV'],
    ['05-kitchen', -2.9, 0.61, -6.4, 25, -5, 'KIT'],
    ['06-bedroom1', 4, 0.61, -3.5, 175, -5, 'BED1'],
    ['07-closet', 0.75, 0.61, -2.55, -90, -5, 'CLO1'],
    ['08-bathroom', 1.55, 0.61, -6.7, 0, -7, 'BATH'],
    ['09-bedroom2', 4.5, 0.61, -6.7, 15, -4, 'BED2'],
    ['10-utility', 0.7, 0.61, -9.1, 180, -5, 'UTIL'],
  ];
  for (const [name, ...pose] of poses) {
    const room = pose.pop();
    await page.evaluate(values => {
      window.__bodycam.teleport(...values);
      window.__bodycam.dev.inspectionLight(false);
      window.__bodycam.dev.resetMetrics();
    }, pose);
    await page.waitForTimeout(1500);
    const view = await state();
    assert.equal(view.room, room, `${name} Raumzuordnung`);
    const filename = `${name}.png`;
    await page.screenshot({ path: path.join(out, 'screenshots', filename) });
    if (!['OUT', 'PORCH'].includes(room)) {
      await page.keyboard.press('KeyF');
      await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(out, 'screenshots', `${name}-inspection.png`) });
    }
    report.views.push({ name, position: view.position, room: view.room, surface: view.surface,
      fps: view.fps, frameMs: view.frameMs, drawCalls: view.drawCalls, triangles: view.triangles, filename });
    console.log(name, `${view.fps.toFixed(1)} FPS`, `${view.drawCalls} calls`);
  }
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  console.error(error);
  await page.screenshot({ path: path.join(out, 'screenshots', 'acceptance-failure.png') }).catch(() => {});
} finally {
  await fs.writeFile(path.join(out, 'reports', 'acceptance.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, 'reports', 'walk.csv'), 'label,time,x,y,z,room,grounded,surface,speed\n'
    + report.trace.map(row => [row.label, row.time, ...row.position, row.room, row.grounded, row.surface, row.speed].join(',')).join('\n') + '\n');
  await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, errors: report.errors, views: report.views, report: path.join(out, 'reports', 'acceptance.json') }, null, 2));
if (!report.passed) process.exitCode = 1;
