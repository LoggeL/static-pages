// Titelbildschirm, deutsche Texte, Konzeptbild, Sprites (Debug-Bericht + Netzwerk), keine Fehler.

import { expect, openTitle, shot, startGame, test } from './helpers';

test('Titelbildschirm lädt mit deutschen Texten und Konzeptbild', async ({ page, guard }, info) => {
  await openTitle(page);
  const title = page.locator('.screen-title');
  await expect(title).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(title.locator('h1.logo')).toHaveText('Crownward');
  await expect(title.locator('.subtitle')).toHaveText('Die erste Insel: Morgenrand');
  await expect(title.locator('.tagline')).toContainText('Nebelbrut bis zum Morgengrauen');
  const labels = await title.locator('.mbtn:visible .mbtn-label').allTextContents();
  expect(labels).toEqual(['Neues Spiel', 'Koop-Spiel', 'Steuerung', 'Einstellungen']);
  // ohne Speicherstand kein „Fortsetzen"
  await expect(title.locator('[data-act="continue"]')).toBeHidden();
  // erster Menüpunkt hat den Tastaturfokus
  await expect(title.locator('[data-act="new"]')).toBeFocused();

  // Konzeptbild als Titelhintergrund wirklich geladen
  await expect(title.locator('.title-art')).toHaveClass(/ready/);
  const bg = await title.locator('.title-art').evaluate((n) => getComputedStyle(n).backgroundImage);
  expect(bg).toContain('first-island-concept.png');
  const concept = guard.responses.find((r) => r.url.endsWith('/assets/first-island-concept.png'));
  expect(concept?.status).toBe(200);

  // kein horizontales Scrollen der Seite
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    w: innerWidth,
    h: innerHeight,
  }));
  expect(overflow.sw).toBeLessThanOrEqual(overflow.w);
  expect(overflow.sh).toBeLessThanOrEqual(overflow.h);
  await shot(page, info, '01-title');
});

test('alle Sprites geladen: Debug-Bericht ohne Lücken, Atlas und PNGs mit Status 200', async ({ page, guard }) => {
  await openTitle(page);
  const report = await page.evaluate(() => window.__crownward.assetReport());
  expect(report.renderer).toBe(true);
  expect(report.assetError).toBeNull();
  expect(report.missing).toEqual([]);
  expect(report.titleArt).toBe('loaded');
  expect(report.loaded.length).toBeGreaterThanOrEqual(50);

  // Netzwerk: atlas.json und jede im Atlas referenzierte Bilddatei
  const atlasRes = guard.responses.find((r) => /\/assets\/sprites\/atlas\.json(\?|$)/.test(r.url));
  expect(atlasRes?.status, 'atlas.json').toBe(200);
  const files = await page.evaluate(async () => {
    const atlas = (await (await fetch('assets/sprites/atlas.json')).json()) as {
      sprites: Record<string, { image: string }>;
      layers: Record<string, { image: string }>;
    };
    return [...new Set([...Object.values(atlas.sprites), ...Object.values(atlas.layers)].map((s) => s.image))];
  });
  expect(files.length).toBeGreaterThanOrEqual(10);
  for (const f of files) {
    const res = guard.responses.find((r) => r.url.endsWith(`/assets/sprites/${f}`));
    expect(res?.status, `Sprite-Bild ${f}`).toBe(200);
  }
  // Bilder sind dekodiert und haben echte Maße
  const sizes = await page.evaluate(
    (list) =>
      Promise.all(
        list.map(
          (f) =>
            new Promise<[string, number, number]>((resolve) => {
              const img = new Image();
              img.onload = () => resolve([f, img.naturalWidth, img.naturalHeight]);
              img.onerror = () => resolve([f, 0, 0]);
              img.src = `assets/sprites/${f}`;
            }),
        ),
      ),
    files,
  );
  for (const [f, w, h] of sizes) expect(w * h, `${f} hat keine Pixel`).toBeGreaterThan(0);
  expect(guard.warnings.filter((w) => w.includes('[assets]'))).toEqual([]);
});

test('Spielansicht zeigt echte Sprites statt Platzhalter', async ({ page }, info) => {
  await startGame(page, { seed: 7 });
  const report = await page.evaluate(() => window.__crownward.assetReport());
  expect(report.missing).toEqual([]);
  // Stichprobe: Canvas ist nicht einfarbig (Hintergrund, Boden, Figuren gezeichnet)
  const colors = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#game')!;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 36;
    const g = probe.getContext('2d')!;
    g.drawImage(c, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    const set = new Set<string>();
    for (let i = 0; i < d.length; i += 4) set.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return set.size;
  });
  expect(colors).toBeGreaterThan(40);
  await shot(page, info, '02-game-start');
});

test('Bildrate im Spiel (Tag und Nacht mit Gegnern) wird gemessen', async ({ page }, info) => {
  await startGame(page, { seed: 9 });
  await page.waitForTimeout(2500);
  const dayFps = await page.evaluate(() => window.__crownward.fps());
  // Nacht 2 mit Gegnern beider Seiten (Beutel gefüllt, damit die Krone sicher ist – Testaufbau)
  await page.evaluate(() => {
    const api = window.__crownward;
    api.state()!.players[0].coins = 40;
    for (let i = 0; i < 1000; i++) {
      const s = api.state()!;
      if (s.day === 2 && s.phase === 'night' && s.enemies.length >= 4) break;
      api.advance(0.5);
    }
  });
  await page.waitForTimeout(2500);
  const nightFps = await page.evaluate(() => window.__crownward.fps());
  const enemies = await page.evaluate(() => window.__crownward.state()!.enemies.length);
  const text = `${info.project.name}: Tag ${dayFps} fps, Nacht 2 (${enemies} Gegner) ${nightFps} fps`;
  info.annotations.push({ type: 'fps', description: text });
  console.log(`[fps] ${text}`);
  expect(dayFps).toBeGreaterThan(20);
  expect(nightFps).toBeGreaterThan(20);
});
