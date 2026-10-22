// Audio: kein AudioContext vor der ersten Geste; Stumm (M und Einstellungen) und Lautstärke bleiben erhalten.

import { expect, openTitle, shot, test, waitScreen } from './helpers';

const audio = (page: import('@playwright/test').Page) => page.evaluate(() => window.__crownward.audio());
const storedSettings = (page: import('@playwright/test').Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('crownward.settings') ?? 'null') as Record<string, unknown> | null);

test('AudioContext erst nach der ersten Nutzergeste', async ({ page }) => {
  await openTitle(page);
  // Seite geladen, Titel sichtbar, aber noch keine Geste → kein AudioContext
  await page.waitForTimeout(400);
  const before = await audio(page);
  expect(before.state).toBe('locked');
  expect(before.unlocked).toBe(false);
  expect(before.masterGain).toBeNull();

  // erste Geste: Klick auf eine freie Stelle des Titelbilds
  await page.locator('.title-art').click({ position: { x: 5, y: 5 }, force: true });
  await expect.poll(async () => (await audio(page)).state, { timeout: 5_000 }).toBe('running');
  const after = await audio(page);
  expect(after.unlocked).toBe(true);
  expect(after.masterGain).not.toBeNull();
});

test('Stumm per M wirkt sofort und bleibt nach dem Neuladen erhalten', async ({ page }) => {
  await openTitle(page);
  await page.keyboard.press('KeyM'); // Geste + Stumm
  await expect.poll(async () => (await audio(page)).state).toBe('running');
  // Menüaktionen werden im nächsten Frame verarbeitet
  await expect.poll(async () => (await audio(page)).settings?.muted).toBe(true);
  await expect.poll(async () => (await audio(page)).masterGain, { timeout: 3_000 }).toBe(0);
  expect((await storedSettings(page))?.muted).toBe(true);

  await page.reload();
  await waitScreen(page, 'title');
  // vor einer Geste weiterhin kein AudioContext, Einstellung aber geladen
  expect((await audio(page)).state).toBe('locked');
  expect((await audio(page)).settings?.muted).toBe(true);
  await page.locator('.screen-title [data-act="settings"]').click();
  await expect(page.locator('#set-muted')).toBeChecked();
  // nach der Geste bleibt der Ausgang stumm
  await expect.poll(async () => (await audio(page)).state).toBe('running');
  await page.waitForTimeout(300);
  expect((await audio(page)).masterGain).toBe(0);

  // im Spiel: M schaltet wieder an (Hinweis „Ton an")
  await page.keyboard.press('Escape');
  await page.locator('.screen-title [data-act="new"]').click();
  await waitScreen(page, 'playing');
  await page.keyboard.press('KeyM');
  await expect.poll(async () => (await audio(page)).settings?.muted).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__crownward.toasts())).toContain('Ton an');
  await expect.poll(async () => (await audio(page)).masterGain, { timeout: 3_000 }).toBeGreaterThan(0);
  expect((await storedSettings(page))?.muted).toBe(false);
});

test('Einstellungen: Stumm-Kästchen und Lautstärkeregler sind dauerhaft', async ({ page }, info) => {
  await openTitle(page);
  await page.locator('.screen-title [data-act="settings"]').click();
  const overlay = page.locator('.overlay-settings');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.panel-title')).toHaveText('Einstellungen');
  await expect(overlay.locator('label[for="set-master"]')).toHaveText('Gesamtlautstärke');
  await expect(page.locator('#set-master')).toHaveValue('80');

  // Regler per Tastatur (fokussiert, Pfeil links = −5 %)
  await page.locator('#set-master').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#set-master')).toHaveValue('60');
  await expect(overlay.locator('output[for="set-master"]')).toHaveText('60 %');
  await expect.poll(async () => (await audio(page)).settings?.master).toBeCloseTo(0.6, 5);
  // Effekte-Regler per Ziehen auf 0 % (Klick an den linken Rand)
  const sfx = page.locator('#set-sfx');
  const box = (await sfx.boundingBox())!;
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
  await expect(sfx).toHaveValue('0');
  // Stumm-Kästchen
  await page.locator('label[for="set-muted"]').click();
  await expect(page.locator('#set-muted')).toBeChecked();
  await expect.poll(async () => (await audio(page)).masterGain, { timeout: 3_000 }).toBe(0);
  if (info.project.name === 'desktop') await shot(page, info, '03-settings');

  const stored = await storedSettings(page);
  expect(stored).toMatchObject({ master: 0.6, sfx: 0, muted: true });

  await page.reload();
  await waitScreen(page, 'title');
  await page.locator('.screen-title [data-act="settings"]').click();
  await expect(page.locator('#set-master')).toHaveValue('60');
  await expect(page.locator('#set-sfx')).toHaveValue('0');
  await expect(page.locator('#set-muted')).toBeChecked();
  const a = await audio(page);
  expect(a.settings).toMatchObject({ master: 0.6, sfx: 0, muted: true });

  // zurücksetzen per Kästchen → Ton wieder an
  await page.locator('label[for="set-muted"]').click();
  await expect(page.locator('#set-muted')).not.toBeChecked();
  await expect.poll(async () => (await audio(page)).masterGain, { timeout: 3_000 }).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(page.locator('.screen-title .title-menu')).toBeVisible();
});
