// Erstspieler-Befunde (fix2-app): Steuerungs-Einführung trotz Angebot am Startpunkt, Anwerbe-Hinweis,
// Schrein-Wirkung vor dem Kauf, Koop nur mit Tastatur/Gamepad (Touch-Gerät), Koop-Einführung ohne Tastaturtasten.

import type { Locator } from '@playwright/test';
import { advance, expect, frames, mutate, openTitle, rideTo, shot, snap, startGame, test, waitScreen } from './helpers';

const INTRO_KB = 'A/D oder ←/→ reiten · Shift sprinten · S halten zum Bezahlen · H Hilfe';
const INTRO_TOUCH = '◀ ▶ reiten · » sprinten · Münze halten zum Bezahlen';

async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const A = await a.boundingBox();
  const B = await b.boundingBox();
  if (!A || !B) return false;
  return A.x < B.x + B.width && B.x < A.x + A.width && A.y < B.y + B.height && B.y < A.y + A.height;
}

test.describe('Erster Spielstart (Tastatur)', () => {
  test.skip(({ isMobile }) => isMobile, 'Tastatur: nur Desktop');

  test('Einführung steht neben dem Angebot am Startpunkt und bleibt bis 30 s nach der ersten Eingabe', async ({ page }, info) => {
    await openTitle(page);
    // Desktop (feiner Zeiger): Koop sofort wählbar
    await expect(page.locator('.screen-title [data-act="coop"]')).toBeEnabled();
    expect(await page.evaluate(() => window.__crownward.coopAvailable())).toBe(true);
    await page.keyboard.press('Enter');
    await waitScreen(page, 'playing');
    await frames(page, 3);
    // Startpunkt liegt in Reichweite des Bogenständers: Angebot UND Steuerung sichtbar
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Bogen für Bogenschützen');
    await expect(page.locator('.hint.p1 .hint-intro')).toBeVisible();
    await expect(page.locator('.hint.p1 .hint-intro')).toHaveText(INTRO_KB);
    await shot(page, info, '02b-start-intro');

    // Wer erst liest (keine Eingabe), sieht die Einführung auch nach 30 s noch
    await advance(page, 40);
    await frames(page, 2);
    expect((await snap(page)).time).toBeGreaterThan(40);
    await expect(page.locator('.hint.p1 .hint-intro')).toHaveText(INTRO_KB);

    // erste Eingabe → noch 30 s Spielzeit sichtbar, dann weg
    await rideTo(page, 104, { sprint: false });
    await advance(page, 20);
    await frames(page, 2);
    expect(await page.evaluate(() => window.__crownward.intro())).toBe(INTRO_KB);
    await advance(page, 12);
    await frames(page, 2);
    expect(await page.evaluate(() => window.__crownward.intro())).toBe('');
    await expect(page.locator('.hint.p1 .hint-intro')).toBeHidden();
  });

  test('Schrein nennt seine Wirkung vor dem Kauf', async ({ page }, info) => {
    await startGame(page, { seed: 51 });
    const shrine = (await snap(page)).structures.find((t) => t.kind === 'shrine' && t.x < 0)!;
    expect(shrine).toBeTruthy();
    // Testaufbau: Herrscherin kurz vor dem Schrein des Hammers, Beutel zu klein bzw. ausreichend
    await mutate(page, `s.players[0].x = ${shrine.x + 90}; s.players[0].coins = 3;`);
    await rideTo(page, shrine.x + 6, { sprint: false, tol: 8 });
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Schrein des Hammers');
    await expect(page.locator('.hint.p1 .hint-detail')).toHaveText(/^Bauleute arbeiten schneller · \d+ Münzen · Dir fehlen \d+ Münzen$/);
    await mutate(page, 's.players[0].coins = 20;');
    await frames(page, 2);
    await expect(page.locator('.hint.p1 .hint-detail')).toHaveText(/^Bauleute arbeiten schneller · \d+ Münzen$/);
    await expect(page.locator('.hint.p1 .hint-key')).toHaveText('S halten');
    await shot(page, info, '13d-shrine-hint');
  });
});

test.describe('Touch-Gerät (schmal)', () => {
  test.skip(({ isMobile }) => !isMobile, 'nur auf dem Touch-Gerät (Projekt narrow)');

  test('Koop ist ohne Tastatur/Gamepad gesperrt und nennt den Grund', async ({ page }, info) => {
    await openTitle(page);
    const coop = page.locator('.screen-title [data-act="coop"]');
    await expect(coop).toBeVisible();
    await expect(coop).toBeDisabled();
    await expect(coop.locator('.mbtn-sub')).toHaveText('Braucht Tastatur oder Gamepad für Spieler 2');
    expect(await page.evaluate(() => window.__crownward.coopAvailable())).toBe(false);
    // Antippen startet kein Spiel mit unsteuerbarem Spieler 2
    await coop.click({ force: true });
    await frames(page, 3);
    expect(await page.evaluate(() => window.__crownward.screen())).toBe('title');
    await shot(page, info, '01b-title-coop-locked');

    // angeschlossene Tastatur (erster Tastendruck) → Koop frei
    await page.keyboard.press('Shift');
    await expect(coop).toBeEnabled();
    await expect(coop.locator('.mbtn-sub')).toHaveText('2 Spieler, ein Bildschirm');
  });

  test('Koop-Einführung auf Touch nennt Bildschirmtasten statt Tastaturtasten', async ({ page }) => {
    await startGame(page, { seed: 52, coop: true });
    await frames(page, 3);
    await expect(page.locator('.touch')).toBeVisible();
    const intro = await page.evaluate(() => window.__crownward.intro());
    expect(intro).toBe('Spieler 1: ◀ ▶ · » · Münze   —   Spieler 2: ←/→ · Shift rechts · ↓');
    expect(intro).not.toContain('A/D');
  });

  test('Einführung neben dem Angebot, Anwerbe-Hinweis mit „Münze tippen"', async ({ page }, info) => {
    await startGame(page, { seed: 53 });
    await frames(page, 3);
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Bogen für Bogenschützen');
    await expect(page.locator('.hint.p1 .hint-intro')).toHaveText(INTRO_TOUCH);
    // Hinweis samt Einführung bleibt frei von den Touch-Tasten und im Bildschirm
    for (const b of ['left', 'right', 'sprint', 'act']) {
      expect(await overlaps(page.locator('.hint.p1'), page.locator(`.tbtn[data-btn="${b}"]`)), `Hinweis überdeckt ${b}`).toBe(false);
    }
    const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, h: innerHeight }));
    expect(m.sh).toBeLessThanOrEqual(m.h);
    await shot(page, info, '02b-start-intro');

    // Testaufbau: abseits der Angebote, Blick zum Landstreicher am Lagerfeuer
    await mutate(page, 's.players[0].x = 104; s.players[0].vx = 0; s.players[0].facing = -1;');
    await frames(page, 3);
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Landstreicher');
    await expect(page.locator('.hint.p1 .hint-key')).toHaveText('Münze tippen');
  });
});
