// Gamepad (simuliert über navigator.getGamepads): A bestätigt einen Menüpunkt, ohne danach im Spiel eine Münze
// fallen zu lassen; im Koop mit Tastatur + einem Pad steuert das Pad Spieler 2, und Tastendrücke von Spieler 1
// ändern den Tastenhinweis von Spieler 2 nicht.

import type { Page } from '@playwright/test';
import { expect, rideTo, snap, startGame, test, waitScreen } from './helpers';

const BTN = { a: 0, b: 1, start: 9 };

/** Ersetzt navigator.getGamepads durch bis zu zwei steuerbare Standard-Pads (vor dem Laden der Seite). */
async function installPads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mk = () => ({ pressed: false, value: 0, touched: false });
    const make = (index: number) => ({ id: 'Testpad', index, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, mk) });
    const w = window as unknown as { __pads: ReturnType<typeof make>[]; __padCount: number };
    w.__pads = [make(0), make(1)];
    w.__padCount = 0;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [0, 1, 2, 3].map((i) => (i < w.__padCount ? w.__pads[i] : null)) });
  });
}

const padCount = (page: Page, n: number) => page.evaluate((c) => ((window as unknown as { __padCount: number }).__padCount = c), n);

async function setButton(page: Page, button: number, down: boolean, pad = 0): Promise<void> {
  await page.evaluate(
    ({ button, down, pad }) => {
      const b = (window as unknown as { __pads: { buttons: { pressed: boolean; value: number }[] }[] }).__pads[pad].buttons[button];
      b.pressed = down;
      b.value = down ? 1 : 0;
    },
    { button, down, pad },
  );
}

async function tap(page: Page, button: number, ms: number, pad = 0): Promise<void> {
  await setButton(page, button, true, pad);
  await page.waitForTimeout(ms);
  await setButton(page, button, false, pad);
}

const setAxis = (page: Page, axis: number, v: number) =>
  page.evaluate(({ axis, v }) => ((window as unknown as { __pads: { axes: number[] }[] }).__pads[0].axes[axis] = v), { axis, v });

const coinDrops = (page: Page) => page.evaluate(() => window.__crownward.recentEvents(2000).filter((e) => e.type === 'coinDrop').length);

test.describe('Gamepad', () => {
  test.skip(({ isMobile }) => isMobile, 'Gamepad-Prüfung nur am Desktop');

  test('A auf „Fortsetzen" lässt im Spiel keine Münze fallen, ein neuer Druck schon', async ({ page }) => {
    await installPads(page);
    await startGame(page, { seed: 41 });
    await padCount(page, 1);
    // abseits der Angebote stehen (dort lässt A eine Münze fallen statt zu bezahlen)
    await rideTo(page, 130, { sprint: false, tol: 8 });
    const before = await snap(page);
    const drops0 = await coinDrops(page);

    // Start → Pause, A bestätigt den fokussierten Knopf „Fortsetzen" und bleibt 150 ms gehalten
    await tap(page, BTN.start, 100);
    await waitScreen(page, 'paused');
    await expect(page.locator('.screen-pause [data-act="resume"]')).toBeFocused();
    await tap(page, BTN.a, 150);
    await waitScreen(page, 'playing');
    await page.waitForTimeout(400);
    let s = await snap(page);
    expect(s.players[0].coins).toBe(before.players[0].coins);
    expect(s.coins.length).toBe(before.coins.length);
    expect(await coinDrops(page)).toBe(drops0);

    // Kontrolle: erneuter Druck im Spiel lässt eine Münze fallen
    await tap(page, BTN.a, 150);
    await expect.poll(async () => (await snap(page)).players[0].coins).toBe(before.players[0].coins - 1);
    expect(await coinDrops(page)).toBe(drops0 + 1);
    s = await snap(page);
    expect(s.players[0].hasCrown).toBe(true);
  });

  test('Koop mit einem Pad: Pad steuert Spieler 2, Spieler 1 bleibt an der Tastatur', async ({ page }) => {
    await installPads(page);
    await startGame(page, { seed: 42, coop: true });
    await padCount(page, 1);
    // Stick rechts → nur Spieler 2
    await setAxis(page, 0, 1);
    await expect.poll(() => page.evaluate(() => window.__crownward.input(1).right)).toBe(true);
    expect(await page.evaluate(() => window.__crownward.input(0).right)).toBe(false);
    await setAxis(page, 0, 0);
    await page.waitForFunction(() => Math.abs(window.__crownward.state()!.players[1].vx) < 1, null, { polling: 'raf' });

    // Spieler 2 an den Bogenständer (+46), dann Pad benutzen → Hinweis „A halten"
    await rideTo(page, 50, { player: 1, sprint: false, tol: 6 });
    await expect(page.locator('.hint.p2 .hint-key')).toHaveText('↓ halten');
    await tap(page, BTN.b, 80);
    await expect(page.locator('.hint.p2 .hint-key')).toHaveText('A halten');
    // Tastendruck von Spieler 1 (D) ändert nur dessen Gerät, nicht den Hinweis von Spieler 2
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(120);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(150);
    await expect(page.locator('.hint.p2 .hint-key')).toHaveText('A halten');
    // A am Pad bezahlt für Spieler 2
    const coins2 = (await snap(page)).players[1].coins;
    await setButton(page, BTN.a, true);
    try {
      await page.waitForFunction((c) => window.__crownward.state()!.players[1].coins === c - 2, coins2, { polling: 'raf', timeout: 8_000 });
    } finally {
      await setButton(page, BTN.a, false);
    }
    const s = await snap(page);
    expect(s.structures.find((t) => t.kind === 'toolStand' && t.x === 46)?.stock).toBe(1);
  });
});
