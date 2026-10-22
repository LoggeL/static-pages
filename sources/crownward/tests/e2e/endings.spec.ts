// Niederlage (ohne Münzen nachts der Nebelbrut ausgesetzt) → Endbildschirm mit Chronik → „Neu beginnen".
// Sieg: Schiffsstufe 3 (Zustandsmanipulation) → am Schiff S halten → Ablegen → Siegbildschirm.

import { advanceToPhase, advanceUntil, expect, frames, mutate, rideTo, shot, snap, startGame, test, waitScreen } from './helpers';

test('Niederlage: Krone verloren, Chronik, „Neu beginnen" startet frisch', async ({ page }, info) => {
  test.setTimeout(90_000);
  await startGame(page, { seed: 31 });
  await page.evaluate(() => {
    localStorage.removeItem('crownward.save.slot1');
    localStorage.removeItem('crownward.save.auto');
  });
  // bis kurz vor die Nacht, dann mit leerem Beutel nach Osten vor den Nebelriss reiten
  await advanceUntil(page, 's.dayTime >= 140', 200, 0.5);
  await mutate(page, 's.players[0].coins = 0; s.players[0].x = 1500;'); // Testaufbau: Beutel leer, weit draußen
  await frames(page, 4);
  await expect(page.locator('.pstat.p1 .pstat-warn')).toBeVisible();
  await expect(page.locator('.pstat.p1 .pstat-warn')).toHaveText('Ohne Münzen kostet ein Treffer die Krone!');
  await rideTo(page, 1800, { sprint: false, tol: 20 });
  await shot(page, info, '18-exposed');
  // Nacht: die Nebelbrut erreicht die Herrscherin
  const events = await advanceUntil(page, "s.outcome === 'defeat'", 80, 0.25);
  expect(events.some((e) => e.type === 'crownLost')).toBe(true);
  expect(events.some((e) => e.type === 'defeat')).toBe(true);
  // Endbildschirm nach kurzer Verzögerung – in Echtzeit, damit das Banner „Die Krone ist verloren!" voll
  // eingeblendet ist, wenn der Endbildschirm kommt (Vorspulen würde die Überlagerung überspringen)
  await waitScreen(page, 'defeat', 10_000);
  const end = page.locator('.screen-end');
  await expect(end).toBeVisible();
  await expect(end).toHaveAttribute('data-outcome', 'defeat');
  // das Banner „Die Krone ist verloren!" verschwindet hinter dem Endbildschirm sofort (keine zweite Überschrift,
  // auch nicht während eines Ausblendübergangs), alte Hinweise ebenso
  await expect(page.locator('.banner.show')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.banner')!).opacity)).toBe('0');
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(end.locator('.end-title')).toHaveText('Die Krone ist gefallen');
  // Untertitel nennt die tatsächliche Ursache: allein draußen getroffen, ohne Mauer auf dieser Seite (keine
  // Mauer ist gefallen – „überrannt" wäre falsch)
  await expect(end.locator('.end-sub')).toHaveText('Ohne schützende Mauer hat dir die Nebelbrut die Krone entrissen.');
  await expect(end.locator('.end-stat').nth(5).locator('dt')).toHaveText('Mauern verloren');
  await expect(end.locator('.end-stat').nth(5).locator('dd')).toHaveText('0');
  await expect(end.locator('.end-stats-title')).toHaveText('Chronik');
  await expect(end.locator('.end-stat dt')).toHaveText([
    'Tage',
    'Münzen gesammelt',
    'Münzen ausgegeben',
    'Nebelbrut besiegt',
    'Bewohner angeworben',
    'Mauern verloren',
    'Bewohner verloren',
    'Truhen geöffnet',
  ]);
  await expect(end.locator('.end-stat').first().locator('dd')).toHaveText('1');
  // ohne Speicherstand kein „Letzten Spielstand laden"
  await expect(end.locator('[data-act="loadLast"]')).toBeHidden();
  await expect(end.locator('[data-act="restart"]')).toBeFocused();
  await shot(page, info, '19-defeat');

  // Speichern nach Spielende ist gesperrt
  await page.keyboard.press('F5');
  expect(await page.evaluate(() => localStorage.getItem('crownward.save.slot1'))).toBeNull();

  await end.locator('[data-act="restart"]').click();
  await waitScreen(page, 'playing');
  const s = await snap(page);
  expect(s.outcome).toBe('playing');
  expect(s.day).toBe(1);
  expect(s.players[0].coins).toBe(6);
  expect(s.players[0].hasCrown).toBe(true);
  expect(s.enemies).toHaveLength(0);
  expect(s.time).toBeLessThan(5);
  await expect(end).toBeHidden();
  await expect(page.locator('.pstat.p1 .crown')).not.toHaveClass(/lost/);
});

test('Niederlage mit Speicherstand bietet „Letzten Spielstand laden" an', async ({ page }) => {
  test.setTimeout(90_000);
  await startGame(page, { seed: 32 });
  await page.keyboard.press('F5');
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('crownward.save.slot1'))).toBe(true);
  await advanceToPhase(page, 'dusk', 1);
  await mutate(page, 's.players[0].coins = 0; s.players[0].x = 1900;'); // Testaufbau
  await advanceUntil(page, "s.outcome === 'defeat'", 90, 0.25);
  await page.evaluate(() => window.__crownward.advance(3));
  await waitScreen(page, 'defeat');
  const load = page.locator('.screen-end [data-act="loadLast"]');
  await expect(load).toBeVisible();
  await load.click();
  await waitScreen(page, 'playing');
  const s = await snap(page);
  expect(s.outcome).toBe('playing');
  expect(s.players[0].coins).toBe(6);
  expect(s.phase).toBe('day');
});

test('Sieg: Schiff seetüchtig (Stufe 3, manipuliert) → S halten → Ablegen', async ({ page }, info) => {
  test.setTimeout(90_000);
  await startGame(page, { seed: 33 });
  // Testaufbau: Schiff vollständig repariert, Herrscherin kurz vor dem Wrack (Westufer)
  await mutate(page, "const ship = s.structures.find((t) => t.kind === 'ship'); ship.level = 3; ship.construction = null; s.players[0].x = ship.x + 160;");
  const ship = (await snap(page)).structures.find((t) => t.kind === 'ship')!;
  await expect(page.locator('.objective')).toHaveText('Schiff bereit');
  await expect(page.locator('.objective')).toHaveClass(/ready/);
  // echtes Reiten bis ans Schiff
  await rideTo(page, ship.x + 20, { sprint: false, tol: 10 });
  await expect(page.locator('.hint.p1 .hint-label')).toHaveText('In See stechen');
  await expect(page.locator('.hint.p1 .hint-detail')).toHaveText('kostenlos');
  await shot(page, info, '20-ship-ready');
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => window.__crownward.state()!.outcome === 'victory', null, { polling: 'raf', timeout: 5_000 });
  await page.keyboard.up('KeyS');
  // Endbildschirm nach kurzer Verzögerung (Echtzeit, Ablegen ist sichtbar)
  await waitScreen(page, 'victory', 10_000);
  const end = page.locator('.screen-end');
  await expect(end).toHaveAttribute('data-outcome', 'victory');
  await expect(end.locator('.end-title')).toHaveText('Sieg!');
  await expect(end.locator('.end-sub')).toHaveText('Das Schiff legt ab – Morgenrand liegt hinter euch.');
  await expect(end.locator('[data-act="loadLast"]')).toBeHidden();
  await shot(page, info, '21-victory');
  // Die Welt läuft zur Darstellung weiter – Nachtbanner, Warnungen und Treffer erreichen den Endbildschirm nicht
  await mutate(page, 's.players[0].coins = 0;'); // Testaufbau: ohne Münzen wäre jeder Treffer ein Kronverlust
  const after = await advanceToPhase(page, 'night');
  expect(after.some((e) => e.type === 'phaseChange')).toBe(true);
  await frames(page, 3);
  expect(await page.evaluate(() => window.__crownward.screen())).toBe('victory');
  await expect(page.locator('.banner.show')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.locator('.pstat.p1 .pstat-warn')).toBeHidden();
  // Hauptmenü vom Endbildschirm
  await end.locator('[data-act="mainMenu"]').click();
  await waitScreen(page, 'title');
});
