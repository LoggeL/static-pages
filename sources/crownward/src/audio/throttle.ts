// Crownward – Drosselung wiederholter Klänge und Stimmenlimit (rein, testbar; Zeit wird übergeben).

/** Mindestabstand je Schlüssel; zusätzlich höchstens `burst` Auslösungen pro `window` Sekunden. */
export class RateLimiter {
  private last = new Map<string, number>();
  private recent = new Map<string, number[]>();

  /** true = Klang darf jetzt spielen (und wird vermerkt). */
  allow(key: string, now: number, minInterval: number, burst = 0, window = 1): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < minInterval) return false;
    if (burst > 0) {
      const list = (this.recent.get(key) ?? []).filter((t) => now - t < window);
      if (list.length >= burst) {
        this.recent.set(key, list);
        return false;
      }
      list.push(now);
      this.recent.set(key, list);
    }
    this.last.set(key, now);
    return true;
  }

  /** Vergisst alte Einträge (Speicher begrenzen). */
  prune(now: number, maxAge = 10): void {
    for (const [k, t] of this.last) if (now - t > maxAge) this.last.delete(k);
    for (const [k, list] of this.recent) if (list.every((t) => now - t > maxAge)) this.recent.delete(k);
  }

  get size(): number {
    return this.last.size;
  }
}

/** Priorität: 0 Kleinkram (Hammer, Münzen), 1 normal, 2 wichtig (Treffer, Zerstörung), 3 kritisch (Sieg, Horn). */
export type Priority = 0 | 1 | 2 | 3;

export interface ActiveVoice {
  priority: Priority;
  start: number;
}

export type BudgetDecision = { kind: 'ok' } | { kind: 'drop' } | { kind: 'steal'; index: number };

/**
 * Stimmenlimit: bis `soft` Stimmen frei; darüber nur noch wichtige Klänge, die notfalls die älteste
 * Stimme niedrigerer Priorität verdrängen. Über `hard` wird immer verdrängt oder verworfen.
 */
export function budgetDecision(active: readonly ActiveVoice[], priority: Priority, soft: number, hard: number): BudgetDecision {
  const n = active.length;
  if (n < soft) return { kind: 'ok' };
  if (priority >= 2 && n < hard) return { kind: 'ok' };
  // Opfer suchen: niedrigste Priorität, darin die älteste, und nur echt niedrigere Priorität
  let victim = -1;
  for (let i = 0; i < n; i++) {
    const v = active[i];
    if (v.priority >= priority) continue;
    if (victim < 0) {
      victim = i;
      continue;
    }
    const b = active[victim];
    if (v.priority < b.priority || (v.priority === b.priority && v.start < b.start)) victim = i;
  }
  return victim >= 0 ? { kind: 'steal', index: victim } : { kind: 'drop' };
}

/**
 * Münz-Kombo: schnell hintereinander aufgehobene Münzen steigen in der Tonhöhe (Pentatonik-Stufen).
 * Gibt die neue Kombo-Stufe zurück.
 */
export function comboStep(prevStep: number, lastTime: number, now: number, window = 0.45, maxStep = 7): number {
  if (now - lastTime > window) return 0;
  return Math.min(maxStep, prevStep + 1);
}

/** Pentatonische Halbtonstufen für die Münz-Kombo. */
export const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
