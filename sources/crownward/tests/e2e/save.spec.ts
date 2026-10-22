// Speichern (F5 / Pausemenü) → Neuladen der Seite → „Fortsetzen" im Titel stellt Tag, Münzen und Bauwerke
// wieder her; Laden aus dem Pausemenü und per F9 (dieselbe Regel: neuester ladbarer Stand); Morgen-Autosave;
// neuere Speicherversion wird mit Hinweis abgelehnt und verdrängt keinen ladbaren Autosave.

import type { Page } from '@playwright/test';
import { advance, advanceToPhase, buyAt, expect, mutate, rideTo, shot, snap, startGame, test, waitScreen, type Snapshot } from './helpers';

const toasts = (page: Page) => page.evaluate(() => window.__crownward.toasts().join(' | '));

/** vergleichbarer Kern des Zustands */
function core(s: Snapshot) {
  return {
    day: s.day,
    phase: s.phase,
    time: Math.round(s.time * 100) / 100,
    coins: s.players.map((p) => p.coins),
    x: s.players.map((p) => Math.round(p.x)),
    structures: s.structures.map((t) => `${t.kind}@${t.x}:L${t.level}${t.construction ? '+bau' : ''}:${t.stock ?? '-'}`),
    citizens: s.citizens.length,
    groundCoins: s.coins.length,
  };
}

test('F5 speichert, nach Neuladen stellt „Fortsetzen" den Zustand wieder her', async ({ page }, info) => {
  await startGame(page, { seed: 21 });
  await page.evaluate(() => localStorage.removeItem('crownward.save.slot1'));
  // echter Spielfortschritt: Münze einsammeln, Bogen kaufen, Mauer beauftragen
  await rideTo(page, 160, { sprint: false });
  await buyAt(page, 46, 2, 50);
  await buyAt(page, 210, 2, 206);
  await advance(page, 20);
  const saved = await snap(page);
  expect(saved.structures.find((t) => t.kind === 'wall' && t.x === 210)?.construction).toBe(true);

  await page.keyboard.press('F5');
  await expect.poll(() => toasts(page)).toContain('Spielstand gespeichert');
  const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('crownward.save.slot1') ?? 'null') as { format: string; version: number; savedAt: string } | null);
  expect(raw).toMatchObject({ format: 'crownward-save', version: 1 });
  expect(Date.parse(raw!.savedAt)).toBeGreaterThan(Date.now() - 120_000);
  // F5 lädt die Seite nicht neu (Spiel läuft weiter)
  expect(await page.evaluate(() => window.__crownward.screen())).toBe('playing');

  // weiterspielen, damit sich der Zustand vom Speicherstand unterscheidet
  await rideTo(page, 280);
  await advance(page, 15);
  expect(core(await snap(page))).not.toEqual(core(saved));

  // Seite neu laden (ohne ?play, also über den Titel)
  await page.goto('/');
  await waitScreen(page, 'title');
  const cont = page.locator('.screen-title [data-act="continue"]');
  await expect(cont).toBeVisible();
  await expect(cont).toBeFocused();
  await expect(cont.locator('.mbtn-sub')).toHaveText(/^Tag 1 · Speicherplatz · gerade eben$/);
  await shot(page, info, '16-title-continue');
  await cont.click();
  await waitScreen(page, 'playing');
  await expect.poll(() => toasts(page)).toContain('Spielstand geladen – Tag 1');
  const restored = await snap(page);
  // ab dem Laden läuft die Simulation weiter → Zeit nur ungefähr gleich
  expect(Math.abs(restored.time - saved.time)).toBeLessThan(2);
  const a = core(saved);
  const b = core(restored);
  expect({ ...b, time: 0, x: [0] }).toEqual({ ...a, time: 0, x: [0] });
  await expect(page.locator('.pstat.p1 .purse-count')).toHaveText(String(saved.players[0].coins));
});

test('Pausemenü: Speichern, Laden und F9-Schnellladen', async ({ page }) => {
  await startGame(page, { seed: 22 });
  await page.evaluate(() => localStorage.removeItem('crownward.save.slot1'));
  await rideTo(page, 160, { sprint: false });
  await page.keyboard.press('Escape');
  await waitScreen(page, 'paused');
  const pause = page.locator('.screen-pause');
  await expect(pause.locator('[data-act="load"]')).toBeDisabled();
  await pause.locator('[data-act="save"]').click();
  await expect(pause.locator('.panel-note')).toHaveText('Speicherstand: Tag 1 · gerade eben');
  await expect(pause.locator('[data-act="load"]')).toBeEnabled();
  const saved = await snap(page);

  // weiter, Zustand verändern (Münzen ausgeben, Zeit vergeht)
  await page.keyboard.press('Escape');
  await waitScreen(page, 'playing');
  await buyAt(page, 46, 2, 50);
  await advance(page, 10);
  expect((await snap(page)).players[0].coins).toBe(saved.players[0].coins - 2);

  // Laden aus dem Pausemenü
  await page.keyboard.press('Escape');
  await pause.locator('[data-act="load"]').click();
  await waitScreen(page, 'playing');
  let s = await snap(page);
  expect(s.players[0].coins).toBe(saved.players[0].coins);
  expect(Math.abs(s.time - saved.time)).toBeLessThan(1);

  // F9 lädt den Schnellspeicherstand
  await advance(page, 12);
  await mutate(page, 's.players[0].coins = 1;'); // Testmanipulation: Unterschied erzeugen
  await page.keyboard.press('F9');
  await expect.poll(async () => (await snap(page)).players[0].coins).toBe(saved.players[0].coins);
  s = await snap(page);
  expect(Math.abs(s.time - saved.time)).toBeLessThan(1);
});

test('Autosave am Morgen und „Fortsetzen" lädt den neuesten Stand', async ({ page }) => {
  test.setTimeout(90_000);
  await startGame(page, { seed: 23 });
  await page.evaluate(() => {
    localStorage.removeItem('crownward.save.slot1');
    localStorage.removeItem('crownward.save.auto');
  });
  // Testaufbau: genug Münzen, um die ungeschützte erste Nacht zu überstehen (ausdrücklich manipuliert)
  await mutate(page, 's.players[0].coins = 30;');
  await advanceToPhase(page, 'day', 2);
  await expect.poll(() => toasts(page)).toContain('Morgen-Autosave gesichert');
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('crownward.save.auto') ?? 'null') as { state: { day: number; phase: string } } | null);
  expect(meta?.state.day).toBe(2);
  const atDawn = await snap(page);

  // Seite neu laden (ohne ?play, also über den Titel)
  await page.goto('/');
  await waitScreen(page, 'title');
  const cont = page.locator('.screen-title [data-act="continue"]');
  await expect(cont.locator('.mbtn-sub')).toHaveText(/^Tag 2 · Autosave · /);
  await cont.click();
  await waitScreen(page, 'playing');
  const s = await snap(page);
  expect(s.day).toBe(2);
  expect(s.players[0].coins).toBe(atDawn.players[0].coins);
  await expect(page.locator('.daybar-day')).toHaveText('Tag 2');
});

test('F9 und Pausemenü „Laden" laden denselben, neuesten Stand (Autosave neuer als F5)', async ({ page }) => {
  await startGame(page, { seed: 25 });
  await page.evaluate(() => localStorage.removeItem('crownward.save.slot1'));
  await rideTo(page, 160, { sprint: false });
  await page.keyboard.press('F5');
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('crownward.save.slot1'))).toBe(true);
  const quick = await snap(page);
  await advance(page, 60);
  // Testaufbau: Morgen-Autosave nachgestellt (gleicher Schreibweg wie am Morgen, nur ohne Nacht abzuwarten)
  await page.evaluate(() => window.__crownward.save('auto'));
  const auto = await snap(page);
  await advance(page, 30);
  await page.keyboard.press('F9');
  await expect.poll(async () => Math.abs((await snap(page)).time - auto.time)).toBeLessThan(1);
  await expect.poll(() => toasts(page)).toContain('Spielstand geladen – Tag 1');
  // Pausemenü zeigt und lädt denselben Stand
  await advance(page, 30);
  await page.keyboard.press('Escape');
  await waitScreen(page, 'paused');
  await page.locator('.screen-pause [data-act="load"]').click();
  await waitScreen(page, 'playing');
  const s = await snap(page);
  expect(Math.abs(s.time - auto.time)).toBeLessThan(1);
  expect(Math.abs(s.time - quick.time)).toBeGreaterThan(50);
});

test('Speicherstand einer neueren Version wird mit Hinweis abgelehnt', async ({ page }, info) => {
  await startGame(page, { seed: 24 });
  await page.evaluate(() => {
    localStorage.removeItem('crownward.save.auto');
    localStorage.setItem(
      'crownward.save.slot1',
      JSON.stringify({ format: 'crownward-save', version: 99, savedAt: new Date().toISOString(), state: { day: 7, coop: false } }),
    );
  });
  await page.goto('/');
  await waitScreen(page, 'title');
  // kein toter „Fortsetzen"-Knopf: der Grund steht sofort im Titel, deutsch
  const cont = page.locator('.screen-title [data-act="continue"]');
  await expect(cont).toBeHidden();
  const err = page.locator('.screen-title .title-error');
  await expect(err).toBeVisible();
  await expect(err).toContainText('neueren Spielversion (Version 99)');
  await expect(page.locator('.screen-title [data-act="new"]')).toBeFocused();
  // F9 im Titel: bleibt im Titel, Grund bleibt sichtbar
  await page.keyboard.press('F9');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__crownward.screen())).toBe('title');
  await expect(err).toContainText('neueren Spielversion');
  await shot(page, info, '17-load-rejected');
});

test('Neuerer, unladbarer Stand verdrängt den ladbaren Autosave nicht', async ({ page }) => {
  await startGame(page, { seed: 26 });
  await advance(page, 20);
  // Testaufbau: gültiger Autosave von vor einer Stunde, daneben ein neuerer Stand einer künftigen Version
  await page.evaluate(() => {
    window.__crownward.save('auto');
    const auto = JSON.parse(localStorage.getItem('crownward.save.auto')!) as { savedAt: string };
    auto.savedAt = new Date(Date.now() - 3_600_000).toISOString();
    localStorage.setItem('crownward.save.auto', JSON.stringify(auto));
    localStorage.setItem(
      'crownward.save.slot1',
      JSON.stringify({ format: 'crownward-save', version: 2, savedAt: new Date().toISOString(), state: { day: 4, coop: false } }),
    );
  });
  const saved = await snap(page);
  await page.goto('/');
  await waitScreen(page, 'title');
  const cont = page.locator('.screen-title [data-act="continue"]');
  await expect(cont).toBeVisible();
  await expect(cont.locator('.mbtn-sub')).toHaveText(/^Tag 1 · Autosave · /);
  await expect(page.locator('.screen-title .title-error')).toContainText('Speicherplatz: Dieser Spielstand stammt aus einer neueren Spielversion (Version 2)');
  await cont.click();
  await waitScreen(page, 'playing');
  const s = await snap(page);
  expect(Math.abs(s.time - saved.time)).toBeLessThan(1);
});
