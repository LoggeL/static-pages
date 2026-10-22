// Crownward – gemeinsame Hilfen der Browser-Tests (Playwright, Produktions-Build über vite preview).
// Steuerung läuft über echte Tastatur-/Touch-Ereignisse; window.__crownward dient nur zum Beobachten,
// zum Vorspulen (advance/setTimeScale) und für ausdrücklich gekennzeichnete Zustandsmanipulationen.

import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import type { DayPhase, GameState, SimEvent } from '../../src/sim';

export { expect };

export interface Guard {
  /** Konsolenfehler, Seitenfehler und fehlgeschlagene Anfragen seit Testbeginn */
  errors: string[];
  /** Konsolenwarnungen (z. B. fehlende Grafiken) */
  warnings: string[];
  /** alle Antworten (Status + URL) */
  responses: { status: number; url: string }[];
}

/** Jeder Test prüft am Ende automatisch: keine Konsolen-/Seitenfehler, keine Laufzeitfehler der Spielschleife. */
export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page }, use) => {
      const g: Guard = { errors: [], warnings: [], responses: [] };
      page.on('console', (m) => {
        if (m.type() === 'error') g.errors.push(`console: ${m.text()}`);
        else if (m.type() === 'warning') g.warnings.push(m.text());
      });
      page.on('pageerror', (e) => g.errors.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => g.errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
      page.on('response', (r) => {
        g.responses.push({ status: r.status(), url: r.url() });
        if (r.status() >= 400) g.errors.push(`http ${r.status()}: ${r.url()}`);
      });
      await use(g);
      let loopErrors: string[] = [];
      try {
        loopErrors = await page.evaluate(() => window.__crownward?.errors() ?? []);
      } catch {
        /* Seite bereits geschlossen */
      }
      expect([...g.errors, ...loopErrors], 'Fehler in Konsole/Seite/Spielschleife').toEqual([]);
    },
    { auto: true },
  ],
});

// ---------- Navigation ----------

export async function waitScreen(page: Page, screen: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction((s) => window.__crownward?.screen() === s, screen, { timeout });
}

/** Titelbildschirm mit leerem Speicher öffnen. */
export async function openTitle(page: Page, opts: { clearStorage?: boolean } = {}): Promise<void> {
  await page.goto('/');
  if (opts.clearStorage !== false) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  await waitScreen(page, 'title');
}

/** Spiel direkt starten (ohne Titel), deterministisch über den Seed. */
export async function startGame(page: Page, opts: { seed?: number; coop?: boolean } = {}): Promise<void> {
  const seed = opts.seed ?? 7;
  await page.goto(`/?play${opts.coop ? '=coop' : ''}&seed=${seed}`);
  await waitScreen(page, 'playing');
  await page.evaluate(() => localStorage.removeItem('crownward.save.auto'));
}

/** Wartet zwei Animationsframes (HUD/Renderer haben den neuen Zustand gezeichnet). */
export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

// ---------- Zustand ----------

export type Snapshot = Pick<GameState, 'day' | 'phase' | 'dayTime' | 'time' | 'outcome' | 'coop'> & {
  players: { x: number; vx: number; coins: number; stamina: number; hasCrown: boolean; facing: number }[];
  citizens: { id: number; role: string; x: number }[];
  enemies: { id: number; x: number; side: number; kind: string }[];
  structures: { id: number; kind: string; x: number; level: number; construction: boolean; stock?: number }[];
  coins: { x: number; y: number; droppedBy: number | null }[];
};

export async function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = window.__crownward.state();
    if (!s) throw new Error('kein Spiel');
    return {
      day: s.day,
      phase: s.phase,
      dayTime: s.dayTime,
      time: s.time,
      outcome: s.outcome,
      coop: s.coop,
      players: s.players.map((p) => ({ x: p.x, vx: p.vx, coins: p.coins, stamina: p.stamina, hasCrown: p.hasCrown, facing: p.facing })),
      citizens: s.citizens.map((c) => ({ id: c.id, role: c.role, x: c.x })),
      enemies: s.enemies.map((e) => ({ id: e.id, x: e.x, side: e.side, kind: e.kind })),
      structures: s.structures.map((t) => ({ id: t.id, kind: t.kind, x: t.x, level: t.level, construction: !!t.construction, stock: t.stock })),
      coins: s.coins.map((c) => ({ x: c.x, y: c.y, droppedBy: c.droppedBy })),
    };
  });
}

/** Spult synchron vor (Simulation mit der gerade gehaltenen Eingabe) und liefert die Ereignistypen. */
export async function advance(page: Page, seconds: number): Promise<SimEvent[]> {
  return page.evaluate((s) => window.__crownward.advance(s), seconds);
}

/**
 * Spult in Schritten vor, bis die Bedingung (JS-Ausdruck über `s` = GameState) gilt. Liefert alle Ereignisse.
 * Wirft, wenn sie nach maxSeconds Simulationszeit nicht eintritt.
 */
export async function advanceUntil(page: Page, condition: string, maxSeconds: number, chunk = 0.5): Promise<SimEvent[]> {
  const res = await page.evaluate(
    ({ condition, maxSeconds, chunk }) => {
      const pred = new Function('s', `return (${condition});`) as (s: GameState) => boolean;
      const all: SimEvent[] = [];
      let t = 0;
      while (t < maxSeconds) {
        const s = window.__crownward.state();
        if (s && pred(s)) return { ok: true, events: all, t };
        for (const e of window.__crownward.advance(chunk)) all.push(e);
        t += chunk;
      }
      const s = window.__crownward.state();
      return { ok: !!s && pred(s), events: all, t };
    },
    { condition, maxSeconds, chunk },
  );
  expect(res.ok, `Bedingung nicht erreicht nach ${res.t}s: ${condition}`).toBe(true);
  return res.events;
}

/** Spult bis zum Beginn einer Tagesphase (optional eines bestimmten Tages) vor. */
export async function advanceToPhase(page: Page, phase: DayPhase, day?: number, maxSeconds = 260): Promise<SimEvent[]> {
  const cond = day === undefined ? `s.phase === '${phase}'` : `s.phase === '${phase}' && s.day === ${day}`;
  return advanceUntil(page, cond, maxSeconds, 0.25);
}

/** Zustandsmanipulation für Testaufbauten (ausdrücklich gekennzeichnet). */
export async function mutate(page: Page, body: string): Promise<void> {
  await page.evaluate((src) => {
    const s = window.__crownward.state();
    if (!s) throw new Error('kein Spiel');
    new Function('s', src)(s);
  }, body);
}

// ---------- echte Eingabe ----------

/**
 * Reitet mit gehaltener Taste (A/D bzw. Pfeiltasten für Spieler 2) bis zur Position x.
 * Langer Weg: Shift sprinten. Bremsweg wird vorgehalten; Toleranz ±tol.
 */
export async function rideTo(page: Page, x: number, opts: { player?: 0 | 1; tol?: number; sprint?: boolean; timeout?: number } = {}): Promise<number> {
  const player = opts.player ?? 0;
  const tol = opts.tol ?? 8;
  const keys = player === 0 ? { left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft' } : { left: 'ArrowLeft', right: 'ArrowRight', sprint: 'ShiftRight' };
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = (await snap(page)).players[player].x;
    const dist = x - cur;
    if (Math.abs(dist) <= tol) return cur;
    const dir = dist > 0 ? 1 : -1;
    const sprint = (opts.sprint ?? true) && Math.abs(dist) > 120;
    // Bremsweg: Sprint ≈ 24 px, Schritt ≈ 5 px
    const stopAt = x - dir * (sprint ? 26 : 4);
    const key = dir > 0 ? keys.right : keys.left;
    if (sprint) await page.keyboard.down(keys.sprint);
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ i, stopAt, dir }) => {
          const p = window.__crownward.state()?.players[i];
          return !!p && (dir > 0 ? p.x >= stopAt : p.x <= stopAt);
        },
        { i: player, stopAt, dir },
        { polling: 'raf', timeout: opts.timeout ?? 30_000 },
      );
    } finally {
      await page.keyboard.up(key);
      if (sprint) await page.keyboard.up(keys.sprint);
    }
    // ausrollen lassen
    await page.waitForFunction((i) => Math.abs(window.__crownward.state()?.players[i].vx ?? 0) < 1, player, { polling: 'raf', timeout: 5_000 });
  }
  const final = (await snap(page)).players[player].x;
  expect(Math.abs(final - x), `Position ${final} statt ${x}`).toBeLessThanOrEqual(tol);
  return final;
}

/** Hält die Münztaste (S bzw. ↓), bis die Bedingung (JS über `s`) gilt. */
export async function holdActUntil(page: Page, condition: string, opts: { key?: string; timeout?: number } = {}): Promise<void> {
  const key = opts.key ?? 'KeyS';
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(
      (src) => {
        const s = window.__crownward.state();
        return !!s && (new Function('s', `return (${src});`) as (s: GameState) => boolean)(s);
      },
      condition,
      { polling: 'raf', timeout: opts.timeout ?? 10_000 },
    );
  } finally {
    await page.keyboard.up(key);
  }
}

/** Wartet (Echtzeit, Simulation läuft im Spiel-Loop) auf eine Bedingung über `s`. */
export async function waitState(page: Page, condition: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (src) => {
      const s = window.__crownward.state();
      return !!s && (new Function('s', `return (${src});`) as (s: GameState) => boolean)(s);
    },
    condition,
    { polling: 100, timeout },
  );
}

// ---------- Screenshots ----------

/** Speichert docs/screenshots/<projekt>-<schritt>.png und hängt das Bild an den Testbericht. */
export async function shot(page: Page, info: TestInfo, step: string): Promise<string> {
  await frames(page, 3);
  // Einblend-Animationen (Panels, Hinweise) abwarten; Endlos-Animationen zählen nicht
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length === 0,
      null,
      { timeout: 1_500 },
    )
    .catch(() => undefined);
  const path = `docs/screenshots/${info.project.name}-${step}.png`;
  // CSS-Pixel statt Gerätepixel (Pixel 7: 412×839 statt 1082×2202) – lesbar, aber deutlich kleinere Dateien
  const body = await page.screenshot({ path, scale: 'css' });
  await info.attach(step, { body, contentType: 'image/png' });
  return path;
}

export const isNarrow = (info: TestInfo) => info.project.name === 'narrow';

// ---------- Spielzüge (echte Tastatur) ----------

/** Wendet die Figur kurz in Richtung dir und lässt per kurzem S-Druck eine Münze fallen. */
export async function dropCoinFacing(page: Page, dir: 1 | -1): Promise<void> {
  const key = dir > 0 ? 'KeyD' : 'KeyA';
  await page.keyboard.down(key);
  await page.waitForTimeout(50);
  await page.keyboard.up(key);
  await page.waitForFunction(() => Math.abs(window.__crownward.state()!.players[0].vx) < 1, null, { polling: 'raf' });
  const before = (await snap(page)).players[0].coins;
  await page.keyboard.press('KeyS');
  await waitState(page, `s.players[0].coins === ${before - 1}`, 2_000);
}

/**
 * Wirbt den Landstreicher an, der dem Zentrum am nächsten steht: abseits der Angebote (81 < |x| < 177)
 * Stellung beziehen und eine Münze in seine Richtung fallen lassen. Zeitraffer ×4 bis zur Anwerbung.
 */
export async function recruitNearestVagrant(page: Page): Promise<void> {
  const s = await snap(page);
  const vagrants = s.citizens.filter((c) => c.role === 'vagrant').sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  expect(vagrants.length, 'kein Landstreicher in der Nähe').toBeGreaterThan(0);
  const v = vagrants[0];
  const side = v.x >= 0 ? 1 : -1;
  const near = Math.abs(v.x) < 120;
  const stand = side * (near ? 104 : 120);
  const face = (near ? -side : side) as 1 | -1;
  const villagersBefore = s.citizens.filter((c) => c.role !== 'vagrant').length;
  await rideTo(page, stand, { sprint: false, tol: 6 });
  await dropCoinFacing(page, face);
  await page.evaluate(() => window.__crownward.setTimeScale(4));
  try {
    await waitState(page, `s.citizens.filter((c) => c.role !== 'vagrant').length > ${villagersBefore}`, 20_000);
  } finally {
    await page.evaluate(() => window.__crownward.setTimeScale(1));
  }
}

/** Kauft am Bauwerk bei x (S halten), bis die Münzen um cost gesunken sind. */
export async function buyAt(page: Page, x: number, cost: number, standX = x): Promise<void> {
  const from = (await snap(page)).players[0].x;
  await rideTo(page, standX, { sprint: Math.abs(standX - from) > 150, tol: 6 });
  const before = (await snap(page)).players[0].coins;
  expect(before, `zu wenig Münzen für Kauf bei x=${x}`).toBeGreaterThanOrEqual(cost);
  await holdActUntil(page, `s.players[0].coins === ${before - cost} && s.players[0].payTargetId === null`);
}

/**
 * Erster Tag mit echter Tastatur: beide Landstreicher anwerben, Bogen und Hammer kaufen, beide inneren
 * Mauern (±210) beauftragen. Optional vorher den Beutel auffüllen (Testaufbau, ausdrücklich manipuliert).
 */
export async function setupVillage(page: Page, opts: { topUpCoins?: number } = {}): Promise<void> {
  if (opts.topUpCoins !== undefined) await mutate(page, `s.players[0].coins = ${opts.topUpCoins};`);
  await recruitNearestVagrant(page);
  await recruitNearestVagrant(page);
  await buyAt(page, 46, 2, 50); // Bogen
  await buyAt(page, -46, 3, -50); // Hammer
  await buyAt(page, -210, 2, -206); // Pfahlwerk West
  await buyAt(page, 210, 2, 206); // Pfahlwerk Ost
  await rideTo(page, 100, { tol: 10 });
}
