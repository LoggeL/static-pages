// Erster Tag und erste Nacht (beschleunigt): Dorf mit echter Tastatur aufbauen, Abend, Nachtwarnung,
// Nebelbrut, Morgengrauen, Tag 2 mit Morgen-Autosave, zweite Nacht mit Angriffen von beiden Seiten.
// Screenshots je Tageszeit. Welche Seiten in Nacht 1 angreifen, legt BALANCE.waves.westFrom fest.

import type { SimEvent } from '../../src/sim';
import { BALANCE } from '../../src/sim/config';
import { advanceToPhase, advanceUntil, expect, frames, setupVillage, shot, snap, startGame, test } from './helpers';

const toasts = (page: import('@playwright/test').Page) => page.evaluate(() => window.__crownward.toasts().join(' | '));
const banner = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const b = document.querySelector('.banner.show');
    return b ? (b.textContent ?? '') : '';
  });

type Spawn = Extract<SimEvent, { type: 'enemySpawn' }>;
const spawnsOf = (events: SimEvent[]) => events.filter((e): e is Spawn => e.type === 'enemySpawn');

test('erster Tag und erste Nacht bis zum Morgen von Tag 2, zweite Nacht von beiden Seiten', async ({ page }, info) => {
  test.setTimeout(180_000);
  const westInNight1 = BALANCE.waves.westFrom <= 1;
  await startGame(page, { seed: 11 });
  // Testaufbau: Beutel auf 20 Münzen, damit die Nacht nicht an der Kasse scheitert (ausdrücklich manipuliert)
  await setupVillage(page, { topUpCoins: 20 });
  const events: SimEvent[] = [];

  // Bauleute errichten beide Mauern im Tageslicht
  events.push(...(await advanceUntil(page, "s.structures.filter((t) => t.kind === 'wall' && Math.abs(t.x) === 210 && t.level === 1).length === 2", 90)));
  let s = await snap(page);
  expect(s.phase).toBe('day');
  // angeworbene Bewohner haben Werkzeuge (Lager bringen inzwischen weitere Landstreicher hervor)
  const roles = s.citizens.map((c) => c.role);
  expect(roles).toContain('archer');
  expect(roles).toContain('builder');
  // Echtzeit-Effekte (Aufleuchten fertiger Mauern) abklingen lassen; Simulation läuft dabei normal weiter
  await page.waitForTimeout(900);
  await shot(page, info, '07-day');

  // Abend: Phasenwechsel und Hinweis
  events.push(...(await advanceToPhase(page, 'dusk', 1)));
  expect(events.some((e) => e.type === 'phaseChange' && e.phase === 'dusk' && e.day === 1)).toBe(true);
  await expect.poll(() => toasts(page)).toContain('Die Sonne sinkt');
  await expect(page.locator('.daybar')).toHaveAttribute('data-phase', 'dusk');

  // Nachtwarnung 12 s vor Nachtbeginn als Hinweis
  events.push(...(await advanceUntil(page, 's.dayTime >= 139', 30, 0.25)));
  expect(events.some((e) => e.type === 'nightWarning' && e.day === 1)).toBe(true);
  await expect.poll(() => toasts(page)).toContain('Die Nacht naht');
  await shot(page, info, '08-dusk');

  // Nacht 1: Banner nennt die angreifenden Seiten, Gegner aus den Rissen
  events.push(...(await advanceToPhase(page, 'night', 1)));
  await frames(page);
  expect(await banner(page)).toContain('Nacht 1 beginnt');
  expect(await banner(page)).toContain(westInNight1 ? 'von beiden Seiten' : 'aus dem Osten');
  await expect(page.locator('.daybar-day')).toHaveText('Nacht 1');
  const night1Start = events.length;
  events.push(...(await advanceUntil(page, westInNight1 ? 's.enemies.some((e) => e.side === -1) && s.enemies.some((e) => e.side === 1)' : 's.enemies.some((e) => e.side === 1)', 30, 0.25)));
  // bis Gegner in Sichtweite der Siedlung sind
  events.push(...(await advanceUntil(page, "s.phase === 'night' && s.enemies.some((e) => Math.abs(e.x - s.players[0].x) < 220)", 45, 0.25)));
  await page.waitForTimeout(500);
  s = await snap(page);
  expect(s.phase).toBe('night');
  expect(s.enemies.length).toBeGreaterThan(0);
  await shot(page, info, '09-night');

  // Morgengrauen: Gegner zerfallen
  events.push(...(await advanceToPhase(page, 'dawn', 1)));
  expect(events.some((e) => e.type === 'phaseChange' && e.phase === 'dawn')).toBe(true);
  const spawns1 = spawnsOf(events.slice(night1Start));
  expect(spawns1.some((e) => e.side === 1 && e.x > 2000)).toBe(true);
  expect(spawns1.some((e) => e.side === -1)).toBe(westInNight1);
  events.push(...(await advance1(page)));
  s = await snap(page);
  expect(s.enemies).toHaveLength(0);
  // das Nacht-Banner überdauert die Nacht nicht (auch nicht im Zeitraffer)
  await frames(page);
  expect(await banner(page)).toBe('');
  await expect(page.locator('.daybar-info')).toHaveText('Der Morgen graut');
  await shot(page, info, '10-dawn');

  // Tag 2 bricht an: Banner + Morgen-Autosave
  events.push(...(await advanceToPhase(page, 'day', 2)));
  await frames(page);
  s = await snap(page);
  expect(s.day).toBe(2);
  expect(s.outcome).toBe('playing');
  expect(s.players[0].hasCrown).toBe(true);
  expect(await banner(page)).toContain('Tag 2 bricht an');
  await expect.poll(() => toasts(page)).toContain('Morgen-Autosave gesichert');
  const auto = await page.evaluate(() => JSON.parse(localStorage.getItem('crownward.save.auto') ?? 'null') as { format: string; version: number; state: { day: number } } | null);
  expect(auto?.format).toBe('crownward-save');
  expect(auto?.version).toBe(1);
  expect(auto?.state.day).toBe(2);
  const phases = events.filter((e) => e.type === 'phaseChange').map((e) => (e as { phase: string }).phase);
  expect(phases).toEqual(['dusk', 'night', 'dawn', 'day']);
  await expect(page.locator('.daybar-day')).toHaveText('Tag 2');
  await shot(page, info, '11-day2');

  // Nacht 2: Nebelbrut aus beiden Rissen (Osten und Westen)
  const night2Start = events.length;
  events.push(...(await advanceToPhase(page, 'night', 2)));
  await frames(page);
  expect(await banner(page)).toContain('Nacht 2 beginnt');
  expect(await banner(page)).toContain('von beiden Seiten');
  events.push(...(await advanceUntil(page, 's.enemies.some((e) => e.side === -1) && s.enemies.some((e) => e.side === 1)', 30, 0.25)));
  const spawns2 = spawnsOf(events.slice(night2Start));
  expect(spawns2.some((e) => e.side === -1 && e.x < -2000)).toBe(true);
  expect(spawns2.some((e) => e.side === 1 && e.x > 2000)).toBe(true);
  events.push(...(await advanceUntil(page, "s.phase === 'night' && s.enemies.some((e) => Math.abs(e.x - s.players[0].x) < 220)", 45, 0.25)));
  await page.waitForTimeout(400);
  await shot(page, info, '11b-night2');
  events.push(...(await advanceToPhase(page, 'day', 3)));
  s = await snap(page);
  expect(s.outcome).toBe('playing');
  expect(s.day).toBe(3);
  const stats = await page.evaluate(() => window.__crownward.state()!.stats);
  info.annotations.push({
    type: 'Nächte 1–2',
    description: `Gegner Nacht 1: ${spawns1.length}, Nacht 2: ${spawns2.length}; besiegt: ${stats.enemiesSlain}, Mauern verloren: ${stats.wallsLost}, Bewohner verloren: ${stats.citizensLost}, Münzen: ${s.players[0].coins}`,
  });
});

/** eine Sekunde weiter (Zerfall der Nebelbrut im Morgenlicht abwarten) */
async function advance1(page: import('@playwright/test').Page): Promise<SimEvent[]> {
  return advanceUntil(page, 's.enemies.length === 0', 10, 0.25);
}
