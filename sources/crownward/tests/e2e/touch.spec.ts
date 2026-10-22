// Schmales Touch-Gerät (Pixel 7): Bildschirmtasten sichtbar, echte Touch-Ereignisse (CDP) zum Reiten,
// Bezahlen und Münzefallenlassen, kein Seiten-Scrollen, Canvas und HUD lesbar und überlappungsfrei.

import type { CDPSession, Locator, Page } from '@playwright/test';
import { expect, shot, snap, startGame, test, waitScreen, waitState } from './helpers';

/** Finger auf die Mitte eines Elements legen (echtes touchstart → pointerdown mit pointerType 'touch'). */
async function center(el: Locator): Promise<{ x: number; y: number }> {
  const b = (await el.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

class Fingers {
  private active = new Map<number, { x: number; y: number }>();
  constructor(private cdp: CDPSession) {}
  static async on(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }
  private points() {
    return [...this.active.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 }));
  }
  async down(id: number, el: Locator): Promise<void> {
    const p = await center(el);
    this.active.set(id, p);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.points() });
  }
  async up(id: number): Promise<void> {
    this.active.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: this.points() });
  }
}

async function boxesOverlap(a: Locator, b: Locator): Promise<boolean> {
  const A = await a.boundingBox();
  const B = await b.boundingBox();
  if (!A || !B) return false;
  return A.x < B.x + B.width && B.x < A.x + A.width && A.y < B.y + B.height && B.y < A.y + A.height;
}

test.describe('Touch (schmal)', () => {
  test.skip(({ isMobile }) => !isMobile, 'nur auf dem Touch-Gerät (Projekt narrow)');

  test('Layout: Touch-Tasten sichtbar, kein Seiten-Scrollen, Canvas und HUD lesbar', async ({ page }, info) => {
    await startGame(page, { seed: 41 });
    const touch = page.locator('.touch');
    await expect(touch).toBeVisible();
    for (const b of ['left', 'right', 'sprint', 'act']) await expect(page.locator(`.tbtn[data-btn="${b}"]`)).toBeVisible();
    await expect(page.locator('.tbtn-coin .tbtn-label')).toHaveText('Münze');
    await expect(page.locator('.app')).toHaveClass(/layout-portrait/);

    const vp = page.viewportSize()!;
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      bsw: document.body.scrollWidth,
      w: innerWidth,
      h: innerHeight,
    }));
    expect(m.sw).toBeLessThanOrEqual(m.w);
    expect(m.bsw).toBeLessThanOrEqual(m.w);
    expect(m.sh).toBeLessThanOrEqual(m.h);
    // Wischen verschiebt die Seite nicht
    await page.mouse.wheel(300, 300);
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);

    // Canvas: volle Breite, ausreichend hoch, Backbuffer in Gerätepixeln
    const canvas = (await page.locator('#game').boundingBox())!;
    expect(canvas.width).toBeGreaterThanOrEqual(vp.width - 1);
    expect(canvas.height).toBeGreaterThanOrEqual(250);
    const backbuffer = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#game')!;
      return { w: c.width, h: c.height, dpr: devicePixelRatio };
    });
    expect(backbuffer.w).toBeGreaterThanOrEqual(Math.floor(canvas.width * backbuffer.dpr) - 1);

    // HUD liegt im Dock unter dem Canvas, alles im Bild, Schrift nicht zu klein
    for (const sel of ['.pstat.p1', '.daybar', '.hud-pause', '.objective', '.hint.p1']) {
      const el = page.locator(sel);
      await expect(el, sel).toBeVisible();
      const b = (await el.boundingBox())!;
      expect(b.y, `${sel} unter dem Canvas`).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
    }
    const fonts = await page.evaluate(() =>
      ['.purse-count', '.daybar-day', '.daybar-info', '.hint-label', '.hint-detail', '.objective span:last-child', '.tbtn-label'].map((s) => {
        const n = document.querySelector(s);
        return [s, n ? parseFloat(getComputedStyle(n).fontSize) : 0] as const;
      }),
    );
    for (const [sel, size] of fonts) expect(size, `Schriftgröße ${sel}`).toBeGreaterThanOrEqual(11);
    // Touch-Tasten groß genug und ohne Überlappung mit HUD/Hinweis
    for (const b of ['left', 'right', 'act']) {
      const box = (await page.locator(`.tbtn[data-btn="${b}"]`).boundingBox())!;
      expect(Math.min(box.width, box.height), `Tastengröße ${b}`).toBeGreaterThanOrEqual(56);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    }
    for (const sel of ['.hint.p1', '.daybar', '.pstat.p1', '.toasts']) {
      for (const b of ['left', 'right', 'sprint', 'act']) {
        expect(await boxesOverlap(page.locator(sel), page.locator(`.tbtn[data-btn="${b}"]`)), `${sel} überdeckt ${b}`).toBe(false);
      }
    }
    expect(await page.evaluate(() => window.__crownward.hints()[0])).toBe('Bogen für Bogenschützen – 2 Münzen – Münze halten');
    await shot(page, info, '23-touch');
  });

  test('▶/◀ halten reitet, Sprint mit zweitem Finger, Münze halten bezahlt, kurzer Tipp lässt Münze fallen', async ({ page }) => {
    await startGame(page, { seed: 42 });
    const f = await Fingers.on(page);
    const right = page.locator('.tbtn[data-btn="right"]');
    const left = page.locator('.tbtn[data-btn="left"]');
    const sprint = page.locator('.tbtn[data-btn="sprint"]');
    const coin = page.locator('.tbtn[data-btn="act"]');

    // ▶ halten
    const x0 = (await snap(page)).players[0].x;
    await f.down(1, right);
    await expect(right).toHaveClass(/pressed/);
    await page.waitForTimeout(900);
    const moving = await snap(page);
    await f.up(1);
    await expect(right).not.toHaveClass(/pressed/);
    expect(moving.players[0].x).toBeGreaterThan(x0 + 30);
    expect(moving.players[0].vx).toBeGreaterThan(40);

    // ◀ halten + Sprint (zweiter Finger)
    await page.waitForTimeout(400);
    await f.down(1, left);
    await f.down(2, sprint);
    await page.waitForTimeout(900);
    const sprinting = await snap(page);
    await f.up(2);
    await f.up(1);
    expect(sprinting.players[0].vx).toBeLessThan(-110);
    expect(sprinting.players[0].stamina).toBeLessThan(1);

    // zum Bogenständer (+46) reiten: ▶ halten, bis x ≥ 40
    await page.waitForFunction(() => Math.abs(window.__crownward.state()!.players[0].vx) < 1);
    const here = (await snap(page)).players[0].x;
    const toward = here < 46 ? right : left;
    await f.down(1, toward);
    await page.waitForFunction(
      (dir) => {
        const x = window.__crownward.state()!.players[0].x;
        return dir > 0 ? x >= 40 : x <= 52;
      },
      here < 46 ? 1 : -1,
      { polling: 'raf' },
    );
    await f.up(1);
    await page.waitForFunction(() => Math.abs(window.__crownward.state()!.players[0].vx) < 1);
    await expect(page.locator('.hint.p1 .hint-label')).toHaveText('Bogen für Bogenschützen');
    await expect(page.locator('.hint.p1 .hint-key')).toHaveText('Münze halten');

    // Münze halten → 2 Münzen fallen in die Slots → Bogen liegt im Ständer
    const coins = (await snap(page)).players[0].coins;
    await f.down(3, coin);
    await waitState(page, `s.players[0].coins === ${coins - 2} && s.players[0].payTargetId === null`, 5_000);
    await f.up(3);
    expect((await snap(page)).structures.find((t) => t.kind === 'toolStand' && t.x === 46)?.stock).toBe(1);

    // abseits der Angebote (x ≈ 120) kurz tippen → eine Münze fällt
    await f.down(1, right);
    await page.waitForFunction(() => window.__crownward.state()!.players[0].x >= 112, null, { polling: 'raf' });
    await f.up(1);
    await page.waitForFunction(() => Math.abs(window.__crownward.state()!.players[0].vx) < 1);
    const before = (await snap(page)).players[0].coins;
    await coin.tap();
    await expect.poll(async () => (await snap(page)).players[0].coins).toBe(before - 1);
    expect((await snap(page)).coins.some((c) => c.droppedBy === 0)).toBe(true);
  });

  test('Pause-Knopf per Tipp, Fortsetzen per Tipp', async ({ page }) => {
    await startGame(page, { seed: 43 });
    await page.locator('.hud-pause').tap();
    await waitScreen(page, 'paused');
    await expect(page.locator('.touch')).toBeHidden();
    await page.locator('.screen-pause [data-act="resume"]').tap();
    await waitScreen(page, 'playing');
    await expect(page.locator('.touch')).toBeVisible();
  });

  test('Querformat auf dem Telefon: HUD und Touch-Tasten überlappen nicht', async ({ page }, info) => {
    await page.setViewportSize({ width: 839, height: 412 });
    await startGame(page, { seed: 44 });
    await expect(page.locator('.app')).toHaveClass(/layout-landscape/);
    await expect(page.locator('.touch')).toBeVisible();
    const vp = page.viewportSize()!;
    for (const b of ['left', 'right', 'sprint', 'act']) {
      const box = (await page.locator(`.tbtn[data-btn="${b}"]`).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      for (const sel of ['.hint.p1', '.daybar', '.pstat.p1', '.hud-right']) {
        expect(await boxesOverlap(page.locator(sel), page.locator(`.tbtn[data-btn="${b}"]`)), `${sel} überdeckt ${b}`).toBe(false);
      }
    }
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.w);
    await shot(page, info, '24-touch-landscape');
  });
});
