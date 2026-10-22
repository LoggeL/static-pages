// Pause (Esc/P) friert die Simulation ein, Fortsetzen; Hilfe (H) zeigt die Steuerung; Einstellungen im Spiel.

import { expect, shot, snap, startGame, test, waitScreen } from './helpers';

test('Pause per Esc und P friert die Simulation ein, Fortsetzen läuft weiter', async ({ page }, info) => {
  await startGame(page, { seed: 5 });
  await page.waitForTimeout(300);

  // Esc → Pause
  await page.keyboard.press('Escape');
  await waitScreen(page, 'paused');
  const pausePanel = page.locator('.screen-pause');
  await expect(pausePanel).toBeVisible();
  await expect(pausePanel.locator('.panel-title')).toHaveText('Pause');
  const labels = await pausePanel.locator('.menu .mbtn:visible .mbtn-label').allTextContents();
  expect(labels).toEqual(['Fortsetzen', 'Speichern', 'Laden', 'Einstellungen', 'Steuerung', 'Hauptmenü']);
  await expect(pausePanel.locator('.panel-note')).toHaveText('Noch kein Speicherstand');
  await expect(pausePanel.locator('[data-act="load"]')).toBeDisabled();

  // gehaltene Taste während der Pause bewegt nichts, Zeit steht
  const t0 = (await snap(page)).time;
  const x0 = (await snap(page)).players[0].x;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  const paused = await snap(page);
  expect(paused.time).toBe(t0);
  expect(paused.players[0].x).toBe(x0);
  await shot(page, info, '12-pause');

  // Esc → weiter, Zeit läuft
  await page.keyboard.press('Escape');
  await waitScreen(page, 'playing');
  await expect(pausePanel).toBeHidden();
  await page.waitForTimeout(400);
  expect((await snap(page)).time).toBeGreaterThan(t0 + 0.2);

  // P → Pause, Klick auf „Fortsetzen"
  await page.keyboard.press('KeyP');
  await waitScreen(page, 'paused');
  const t1 = (await snap(page)).time;
  await page.waitForTimeout(400);
  expect((await snap(page)).time).toBe(t1);
  await pausePanel.locator('[data-act="resume"]').click();
  await waitScreen(page, 'playing');

  // Pause-Knopf im HUD
  await page.locator('.hud-pause').click();
  await waitScreen(page, 'paused');
  await page.keyboard.press('KeyP');
  await waitScreen(page, 'playing');
});

test('Hilfe per H zeigt Steuerung und Ziel, Esc kehrt ins Spiel zurück', async ({ page }, info) => {
  await startGame(page, { seed: 5 });
  await page.keyboard.press('KeyH');
  await expect.poll(() => page.evaluate(() => window.__crownward.overlay())).toBe('help');
  expect(await page.evaluate(() => window.__crownward.screen())).toBe('paused');
  const help = page.locator('.overlay-help');
  await expect(help).toBeVisible();
  await expect(help.locator('.panel-title')).toHaveText('Steuerung & Ziel');
  await expect(help).toContainText('Repariere das Schiff im Westen und lege ab.');
  await expect(help.locator('table.keytable').first()).toContainText('Reiten');
  await expect(help.locator('table.keytable').first()).toContainText('Sprinten');
  await expect(help.locator('table.keytable').first()).toContainText('Münzen zahlen (halten)');
  await expect(help.locator('.keytable-coop')).toContainText('Spieler 2');
  await expect(help).toContainText('Schnellspeichern');
  // Inhalt passt in den Bildschirm oder ist scrollbar
  const box = (await help.locator('.panel').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  await shot(page, info, '13-help');
  const t0 = (await snap(page)).time;
  await page.waitForTimeout(300);
  expect((await snap(page)).time).toBe(t0);

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__crownward.overlay())).toBeNull();
  await waitScreen(page, 'playing');
  await expect(help).toBeHidden();

  // H erneut öffnet, H schließt
  await page.keyboard.press('KeyH');
  await expect(help).toBeVisible();
  await page.keyboard.press('KeyH');
  await expect(help).toBeHidden();
  await waitScreen(page, 'playing');
});

test('Einstellungen aus dem Pausemenü öffnen und schließen', async ({ page }, info) => {
  await startGame(page, { seed: 5 });
  await page.keyboard.press('Escape');
  await waitScreen(page, 'paused');
  await page.locator('.screen-pause [data-act="settings"]').click();
  const settings = page.locator('.overlay-settings');
  await expect(settings).toBeVisible();
  await expect(settings.locator('label')).toHaveText([
    'Gesamtlautstärke',
    'Musik & Ambiente',
    'Effekte',
    'Stumm (M)',
    'Touch-Steuerung immer anzeigen',
  ]);
  await shot(page, info, '14-settings-ingame');
  // „Touch-Steuerung immer anzeigen" zeigt die Bildschirmtasten auch am Desktop
  if (info.project.name === 'desktop') {
    await settings.locator('label[for="set-forceTouch"]').click();
    await expect(page.locator('#set-forceTouch')).toBeChecked();
  }
  await settings.locator('[data-act="close"]').click();
  await expect(settings).toBeHidden();
  await waitScreen(page, 'paused');
  await expect(page.locator('.screen-pause')).toBeVisible();
  await page.keyboard.press('Escape');
  await waitScreen(page, 'playing');
  await expect(page.locator('.touch')).toBeVisible();
  if (info.project.name === 'desktop') await shot(page, info, '15-forced-touch');
});
