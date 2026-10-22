// Lokales Koop: geteilter Bildschirm, Spieler 1 (A/D, Shift links, S) und Spieler 2 (←/→, Shift rechts, ↓)
// steuern unabhängig voneinander.

import { advanceToPhase, expect, frames, holdActUntil, openTitle, rideTo, shot, snap, startGame, test, waitScreen } from './helpers';

test.describe('Koop', () => {
  test.skip(({ isMobile }) => isMobile, 'Koop braucht eine Tastatur für zwei Spieler (Desktop)');

  test('Splitscreen, beide Spieler unabhängig steuerbar', async ({ page }, info) => {
    await openTitle(page);
    await page.locator('.screen-title [data-act="coop"]').click();
    await waitScreen(page, 'playing');
    let s = await snap(page);
    expect(s.coop).toBe(true);
    expect(s.players).toHaveLength(2);
    await expect.poll(() => page.evaluate(() => window.__crownward.toasts().join(' | '))).toContain('Koop: Spieler 2 reitet mit');

    // HUD: zwei Beutel, beide mit Krone
    await expect(page.locator('.pstat.p1')).toBeVisible();
    await expect(page.locator('.pstat.p2')).toBeVisible();
    await expect(page.locator('.pstat.p1 .pstat-tag')).toHaveText('Spieler 1');
    await expect(page.locator('.pstat.p2 .pstat-tag')).toHaveText('Spieler 2');

    // geteilter Bildschirm: dunkle Trennleiste genau in der Mitte des Canvas
    const divider = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#game')!;
      const probe = document.createElement('canvas');
      probe.width = c.width;
      probe.height = c.height;
      const g = probe.getContext('2d')!;
      g.drawImage(c, 0, 0);
      const row = (y: number) => {
        const d = g.getImageData(0, Math.round(y), c.width, 1).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (d.length / 4) / 3;
      };
      return { mid: row(c.height / 2), above: row(c.height * 0.3), below: row(c.height * 0.8) };
    });
    expect(divider.mid).toBeLessThan(20);
    expect(divider.above).toBeGreaterThan(40);
    expect(divider.below).toBeGreaterThan(30);

    // Spieler 1: D → nur P1 bewegt sich
    const p0 = s.players.map((p) => p.x);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(800);
    await page.keyboard.up('KeyD');
    s = await snap(page);
    expect(s.players[0].x).toBeGreaterThan(p0[0] + 25);
    expect(s.players[1].x).toBeCloseTo(p0[1], 0);

    // Spieler 2: ← mit Shift rechts (Sprint) → nur P2 bewegt sich nach links
    const p1 = s.players.map((p) => p.x);
    await page.keyboard.down('ShiftRight');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(900);
    const mid = await snap(page);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ShiftRight');
    expect(mid.players[1].vx).toBeLessThan(-100);
    expect(mid.players[1].x).toBeLessThan(p1[1] - 40);
    expect(Math.abs(mid.players[0].x - p1[0])).toBeLessThan(6);

    // beide gleichzeitig in entgegengesetzte Richtungen
    await page.keyboard.down('KeyA');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(700);
    const both = await snap(page);
    await page.keyboard.up('KeyA');
    await page.keyboard.up('ArrowRight');
    expect(both.players[0].vx).toBeLessThan(-30);
    expect(both.players[1].vx).toBeGreaterThan(30);

    // Spieler 2 kauft mit ↓ den Bogen (+46), Spieler 1 lässt mit S abseits eine Münze fallen
    await rideTo(page, 50, { player: 1, sprint: false, tol: 6 });
    await expect(page.locator('.hint.p2 .hint-label')).toHaveText('Bogen für Bogenschützen');
    await expect(page.locator('.hint.p2 .hint-key')).toHaveText('↓ halten');
    const coins2 = (await snap(page)).players[1].coins;
    await holdActUntil(page, `s.players[1].coins === ${coins2 - 2} && s.players[1].payTargetId === null`, { key: 'ArrowDown' });
    s = await snap(page);
    expect(s.structures.find((t) => t.kind === 'toolStand' && t.x === 46)?.stock).toBe(1);
    expect(s.players[0].coins).toBe(6);

    await rideTo(page, 130, { player: 0, sprint: false, tol: 8 });
    const coins1 = (await snap(page)).players[0].coins;
    await page.keyboard.press('KeyS');
    await expect.poll(async () => (await snap(page)).players[0].coins).toBe(coins1 - 1);
    expect((await snap(page)).players[1].coins).toBe(coins2 - 2);
    await shot(page, info, '22-coop');
  });

  test('Nachtbanner und Hinweise verdecken die obere Ansicht von Spieler 1 nicht', async ({ page }, info) => {
    await startGame(page, { seed: 43, coop: true });
    await rideTo(page, 50, { player: 0, sprint: false, tol: 6 }); // Spieler 1 am Bogenständer → Hinweis sichtbar
    await advanceToPhase(page, 'night', 1);
    await frames(page, 3);
    const box = await page.evaluate(() => {
      const r = (sel: string) => {
        const n = document.querySelector(sel);
        if (!n || !(n as HTMLElement).offsetParent) return null;
        const b = n.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
      };
      const c = document.querySelector('#game')!.getBoundingClientRect();
      // sichtbarer Text des Banners (Titelzeile ist volle Breite, der Text selbst zentriert)
      const title = document.querySelector('.banner.show .banner-title');
      let text = null as null | { left: number; right: number; top: number; bottom: number };
      if (title) {
        const range = document.createRange();
        range.selectNodeContents(title);
        const b = range.getBoundingClientRect();
        text = { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      }
      return { canvas: { top: c.top, height: c.height, width: c.width }, banner: text, sub: r('.banner.show .banner-sub'), toasts: r('.toasts'), hint1: r('.hint.p1') };
    });
    const mid = box.canvas.top + box.canvas.height / 2;
    expect(box.banner, 'Nachtbanner sichtbar').not.toBeNull();
    // Banner liegt im Himmel der unteren Ansicht, nicht über Figur/Kosten/Hinweis von Spieler 1
    expect(box.banner!.top).toBeGreaterThanOrEqual(mid);
    expect(box.sub!.bottom).toBeLessThan(mid + box.canvas.height * 0.25);
    expect(box.hint1, 'Hinweis von Spieler 1 sichtbar').not.toBeNull();
    expect(box.hint1!.bottom).toBeLessThanOrEqual(mid);
    // Toasts rechts oben, ohne Überschneidung mit der Bildmitte (Kamera hält Spieler 1 nahe der Mitte)
    expect(box.toasts!.left).toBeGreaterThan(box.canvas.width * 0.6);
    expect(box.toasts!.bottom).toBeLessThan(mid);
    await shot(page, info, '23-coop-night-banner');
  });
});
