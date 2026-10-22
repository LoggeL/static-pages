// Kernschleife mit echter Tastatur: Spiel starten, reiten/sprinten, Münze aufheben, Landstreicher anwerben,
// Werkzeug kaufen (S halten) → Bauleute, Mauer kaufen und fertig bauen lassen. Kontexthinweise auf Deutsch.

import { advanceUntil, expect, holdActUntil, openTitle, rideTo, shot, snap, test, waitScreen, waitState } from './helpers';

test.describe('Wirtschaft und Bauen (Tastatur)', () => {
  test.skip(({ isMobile }) => isMobile, 'Tastatursteuerung: nur Desktop (Touch siehe touch.spec.ts)');

  test('neues Spiel per Tastatur und per Klick', async ({ page }) => {
    await openTitle(page);
    // Tastatur: erster Menüpunkt hat den Fokus → Enter
    await expect(page.locator('.screen-title [data-act="new"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await waitScreen(page, 'playing');
    const s1 = await snap(page);
    expect(s1.day).toBe(1);
    expect(s1.coop).toBe(false);
    expect(s1.players[0].coins).toBe(6);
    await expect(page.locator('.hud')).toBeVisible();
    await expect(page.locator('.daybar-day')).toHaveText('Tag 1');

    // zurück ins Hauptmenü (Pause → Hauptmenü → bestätigen) und per Klick neu starten
    await page.keyboard.press('Escape');
    await waitScreen(page, 'paused');
    await page.locator('.screen-pause [data-act="mainMenu"]').click();
    await expect(page.locator('.screen-pause .confirm-text')).toContainText('Wirklich zum Hauptmenü?');
    await page.locator('.screen-pause [data-act="confirmYes"]').click();
    await waitScreen(page, 'title');
    await page.locator('.screen-title [data-act="new"]').click();
    await waitScreen(page, 'playing');
    expect((await snap(page)).players[0].coins).toBe(6);
  });

  test('Reiten und Sprinten mit A/D und Shift', async ({ page }) => {
    await openTitle(page);
    await page.keyboard.press('Enter');
    await waitScreen(page, 'playing');
    const x0 = (await snap(page)).players[0].x;

    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1000);
    const walking = await snap(page);
    await page.keyboard.up('KeyD');
    expect(walking.players[0].x - x0).toBeGreaterThan(35);
    expect(walking.players[0].vx).toBeGreaterThan(50);
    expect(walking.players[0].vx).toBeLessThan(70);
    expect(walking.players[0].facing).toBe(1);

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(1200);
    const sprinting = await snap(page);
    await page.keyboard.up('KeyA');
    await page.keyboard.up('ShiftLeft');
    expect(sprinting.players[0].vx).toBeLessThan(-120); // Sprint ≈ 140 px/s
    expect(sprinting.players[0].facing).toBe(-1);
    expect(sprinting.players[0].stamina).toBeLessThan(0.95);
    expect(sprinting.players[0].x).toBeLessThan(walking.players[0].x - 60);
    // Ausdauerleiste wird angezeigt, solange sie nicht voll ist
    await expect(page.locator('.pstat.p1 .stamina')).not.toHaveClass(/idle/);

    // Pfeiltasten funktionieren im Einzelspiel ebenso (erst ausrollen lassen)
    await page.waitForFunction(() => Math.abs(window.__crownward.state()!.players[0].vx) < 1);
    const x1 = (await snap(page)).players[0].x;
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowRight');
    expect((await snap(page)).players[0].x).toBeGreaterThan(x1 + 15);
  });

  test('Münze aufheben, Landstreicher anwerben, Hammer kaufen, Mauer bauen', async ({ page, guard }, info) => {
    await openTitle(page);
    await page.keyboard.press('Enter');
    await waitScreen(page, 'playing');
    void guard;
    const start = await snap(page);
    expect(start.players[0].coins).toBe(6);
    expect(start.citizens.filter((c) => c.role === 'vagrant')).toHaveLength(2);

    // 1) Münze auf dem Weg (x = 150) einsammeln
    expect(start.coins.some((c) => Math.abs(c.x - 150) < 2)).toBe(true);
    await rideTo(page, 165, { sprint: false });
    await waitState(page, 's.players[0].coins === 7', 3_000);
    await expect(page.locator('.pstat.p1 .purse-count')).toHaveText('7');

    // 2) Kontexthinweis am Bogenständer (+46): deutscher Name, Kosten, Taste
    await rideTo(page, 52, { sprint: false });
    await expect(page.locator('.hint.p1')).toBeVisible();
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Bogen für Bogenschützen');
    await expect(page.locator('.hint.p1 .hint-detail')).toHaveText('2 Münzen');
    await expect(page.locator('.hint.p1 .hint-key')).toHaveText('S halten');
    expect((await page.evaluate(() => window.__crownward.hints()))[0]).toBe('Bogen für Bogenschützen – 2 Münzen – S halten');
    await shot(page, info, '04-hint-cost');

    // 3) abseits aller Angebote eine Münze für einen Landstreicher fallen lassen (nach links blickend)
    await rideTo(page, 104, { sprint: false });
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(60);
    await page.keyboard.up('KeyA');
    await page.waitForTimeout(400);
    const beforeDrop = await snap(page);
    expect(beforeDrop.players[0].facing).toBe(-1);
    // kein Angebot in Reichweite: Der Kontexthinweis erklärt das Anwerben (kurzer Druck statt Halten)
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Landstreicher');
    await expect(page.locator('.hint.p1 .hint-key')).toHaveText('S tippen');
    expect(await page.evaluate(() => window.__crownward.hints()[0])).toBe('Landstreicher – Münze hinwerfen – er schließt sich dir an – S tippen');
    await shot(page, info, '04b-hint-vagrant');
    await page.keyboard.press('KeyS'); // kurzer Druck → Münze fällt
    await waitState(page, 's.coins.some((c) => c.droppedBy === 0)', 2_000);
    expect((await snap(page)).players[0].coins).toBe(6);
    // Landstreicher holt sie (Zeitraffer) → wird Dorfbewohner
    await page.evaluate(() => window.__crownward.setTimeScale(4));
    await waitState(page, "s.citizens.some((c) => c.role === 'villager')", 20_000);
    await page.evaluate(() => window.__crownward.setTimeScale(1));
    const recruit = await page.evaluate(() => window.__crownward.recentEvents(400).filter((e) => e.type === 'recruit').length);
    expect(recruit).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__crownward.toasts().join(' | '))).toContain('Ein Landstreicher schließt sich dir an');

    // 4) Hammer am Ständer (−46) kaufen: S halten, 3 Münzen fallen in die Slots
    await rideTo(page, -46, { sprint: false });
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Hammer für Bauleute');
    await expect(page.locator('.hint.p1 .hint-detail')).toHaveText('3 Münzen');
    const hammerStand = (await snap(page)).structures.find((s) => s.kind === 'toolStand' && s.x === -46)!;
    await holdActUntil(page, `s.structures.find((t) => t.id === ${hammerStand.id}).stock > 0 || s.citizens.some((c) => c.role === 'builder')`);
    expect((await snap(page)).players[0].coins).toBe(3);
    // Dorfbewohner holt den Hammer → Baumeister
    await page.evaluate(() => window.__crownward.setTimeScale(4));
    await waitState(page, "s.citizens.some((c) => c.role === 'builder')", 30_000);
    await page.evaluate(() => window.__crownward.setTimeScale(1));

    // 5) Pfahlwerk am westlichen Mauerplatz (−210) kaufen: 2 Münzen (unterwegs liegt die Münze bei −160)
    await rideTo(page, -206);
    const coinsBeforeWall = (await snap(page)).players[0].coins;
    expect(coinsBeforeWall).toBe(4);
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Pfahlwerk');
    await expect(page.locator('.hint.p1 .hint-detail')).toHaveText('2 Münzen');
    const wall = (await snap(page)).structures.find((s) => s.kind === 'wall' && s.x === -210)!;
    expect(wall.level).toBe(0);
    await holdActUntil(page, `!!s.structures.find((t) => t.id === ${wall.id}).construction`);
    expect((await snap(page)).players[0].coins).toBe(coinsBeforeWall - 2);
    // Bau-Stand statt nur „Wird gerade gebaut": der Baumeister macht sich auf den Weg
    await expect(page.locator('.hint.p1 .hint-detail')).toHaveText('Bauleute arbeiten daran');
    await shot(page, info, '05-wall-construction');

    // Bauleute errichten die Mauer (beschleunigt)
    await advanceUntil(page, `s.structures.find((t) => t.id === ${wall.id}).level === 1`, 60, 0.5);
    const built = (await snap(page)).structures.find((s) => s.id === wall.id)!;
    expect(built.level).toBe(1);
    expect(built.construction).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__crownward.toasts().join(' | '))).toContain('Mauer fertig: Pfahlwerk');
    // nächste Stufe angeboten, aber an die Siedlungsstufe gebunden
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Holzpalisade');
    await expect(page.locator('.hint.p1 .hint-detail')).toHaveText('Benötigt Siedlungsstufe 1');
    const stats = await page.evaluate(() => window.__crownward.state()!.stats);
    expect(stats.recruited).toBe(1);
    expect(stats.coinsSpent).toBe(5);
    await shot(page, info, '06-wall-built');
  });
});
