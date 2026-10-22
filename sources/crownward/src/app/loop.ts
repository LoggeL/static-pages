// Crownward – Spielschleife: requestAnimationFrame + fester Simulationsschritt (SIM_DT) mit Akkumulator.
// Pro Frame: Eingabe/Menüaktionen → n Simulationsschritte → Ereignisse an Renderer, Audio und UI →
// Zeichnen → audio.update. Pause hält die Simulation an, der Renderer zeichnet weiter (paused = true).

import { SIM_DT, stepGame } from '../sim';
import type { GameState, PlayerInput, SimEvent } from '../sim';
import type { Renderer } from '../render';
import type { AudioEngine } from '../audio';

/** Längster berücksichtigter Frame (Tab-Wechsel, Ruckler) – verhindert Zeitsprünge. */
export const MAX_FRAME_DT = 0.1;
export const MIN_TIME_SCALE = 1;
export const MAX_TIME_SCALE = 64;
/** Bei Debug-advance() höchstens so viele Ereignisse an den Renderer (Partikelflut vermeiden). */
const ADVANCE_RENDER_EVENTS = 400;

/**
 * Ereignisse, die Audio und UI noch erreichen. Nach Sieg/Niederlage läuft die Welt nur zur Darstellung weiter
 * (stepGame ignoriert dann Eingaben): Es zählen nur die Ereignisse bis einschließlich 'victory'/'defeat' –
 * keine Nachtbanner, Warnungen oder Treffer mehr über dem Endbildschirm. Der Renderer erhält weiter alles.
 */
export function liveEvents(events: readonly SimEvent[], game: GameState): readonly SimEvent[] {
  if (game.outcome === 'playing') return events;
  for (let i = 0; i < events.length; i++) {
    const type = events[i].type;
    if (type === 'victory' || type === 'defeat') return i === events.length - 1 ? events : events.slice(0, i + 1);
  }
  return [];
}

export interface StepPlan {
  steps: number;
  accumulator: number;
  /** true, wenn wegen der Obergrenze Simulationszeit verworfen wurde */
  dropped: boolean;
}

/** Höchstzahl an Schritten pro Frame für eine Zeitskala (Spirale des Todes vermeiden). */
export function maxStepsFor(timeScale: number): number {
  return Math.min(400, Math.max(8, Math.ceil(timeScale * 6)));
}

/** Reiner Rechenkern des festen Zeitschritts. */
export function planSteps(
  accumulator: number,
  frameDt: number,
  timeScale: number,
  maxSteps: number,
  dt: number = SIM_DT,
): StepPlan {
  const acc = accumulator + Math.max(0, Math.min(frameDt, MAX_FRAME_DT)) * timeScale;
  const steps = Math.floor(acc / dt + 1e-7);
  if (steps > maxSteps) return { steps: maxSteps, accumulator: 0, dropped: true };
  return { steps, accumulator: Math.max(0, acc - steps * dt), dropped: false };
}

export interface LoopHost {
  renderer(): Renderer | null;
  readonly audio: AudioEngine;
  /** sichtbares Spiel (null im Lade-/Titelbildschirm) */
  game(): GameState | null;
  /** Simulation läuft (Spiel aktiv und nicht pausiert) */
  simulating(): boolean;
  /** Renderer/Audio im Pausezustand */
  paused(): boolean;
  /** Eingaben für count Spieler, abgefragt vor jedem Schritt */
  inputs(count: number): readonly PlayerInput[];
  /** Frame-Beginn: Eingabegeräte abfragen, Menüaktionen verarbeiten */
  beginFrame(dt: number): void;
  /** Alle Ereignisse (nach Renderer und Audio) für UI und App-Logik (Autosave, Spielende); UI filtert mit liveEvents */
  onEvents(events: readonly SimEvent[], game: GameState): void;
  /** Frame-Ende: HUD aktualisieren */
  endFrame(dt: number, game: GameState | null): void;
}

export class GameLoop {
  private acc = 0;
  private raf = 0;
  private last = -1;
  private realTime = 0;
  private scale = 1;
  /** gemessene Bildrate (geglättet) */
  fps = 60;

  constructor(private readonly host: LoopHost) {}

  get timeScale(): number {
    return this.scale;
  }

  set timeScale(v: number) {
    this.scale = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, Number.isFinite(v) ? v : 1));
  }

  /** Echtzeit seit Start der Schleife (Sekunden) */
  get time(): number {
    return this.realTime;
  }

  start(): void {
    if (this.raf) return;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Akkumulator leeren (neues Spiel / Laden), damit kein Restschritt hinüberwandert. */
  reset(): void {
    this.acc = 0;
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last < 0 ? 0 : Math.min(MAX_FRAME_DT, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.realTime += dt;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    this.tick(dt);
  };

  /** Ein kompletter Frame (öffentlich für Tests ohne requestAnimationFrame). */
  tick(dt: number): void {
    const host = this.host;
    host.beginFrame(dt);

    let game = host.game();
    if (game && host.simulating()) {
      const plan = planSteps(this.acc, dt, this.scale, maxStepsFor(this.scale));
      this.acc = plan.accumulator;
      if (plan.steps > 0) {
        try {
          const events = this.simulate(game, plan.steps);
          this.dispatch(events, game, true);
        } catch (e) {
          reportOnce('sim', e);
        }
      }
    } else {
      this.acc = 0;
    }

    // Ereignisse können das Spiel ersetzt haben (z. B. Laden über Menüaktion) → neu lesen
    game = host.game();
    const paused = host.paused();
    const renderer = host.renderer();
    if (game && renderer) {
      try {
        renderer.render(game, { time: this.realTime, dt, split: game.coop, paused });
      } catch (e) {
        reportOnce('render', e);
      }
    }
    try {
      host.audio.update(game, dt, paused);
    } catch (e) {
      reportOnce('audio', e);
    }
    host.endFrame(dt, game);
  }

  /** Rechnet steps feste Schritte mit den jeweils aktuellen Eingaben und sammelt alle Ereignisse. */
  simulate(game: GameState, steps: number): SimEvent[] {
    const out: SimEvent[] = [];
    for (let i = 0; i < steps; i++) {
      const events = stepGame(game, this.host.inputs(game.players.length), SIM_DT);
      for (let k = 0; k < events.length; k++) out.push(events[k]);
    }
    return out;
  }

  /**
   * Synchrones Vorspulen (Debug/Tests), läuft auch in der Pause. Audio wird übersprungen,
   * der Renderer erhält nur die jüngsten Ereignisse.
   */
  advance(game: GameState, seconds: number): SimEvent[] {
    const steps = Math.max(0, Math.round(seconds / SIM_DT));
    const events = this.simulate(game, steps);
    this.dispatch(events, game, false);
    return events;
  }

  private dispatch(events: SimEvent[], game: GameState, realtime: boolean): void {
    if (events.length === 0) return;
    const renderer = this.host.renderer();
    if (renderer) {
      try {
        renderer.handleEvents(realtime ? events : events.slice(-ADVANCE_RENDER_EVENTS), game);
      } catch (e) {
        reportOnce('render.handleEvents', e);
      }
    }
    const live = realtime ? liveEvents(events, game) : [];
    if (live.length) {
      try {
        this.host.audio.handleEvents(live, game);
      } catch (e) {
        reportOnce('audio.handleEvents', e);
      }
    }
    this.host.onEvents(events, game);
  }
}

// Fehler in Simulation/Renderer/Audio sollen die Schleife nicht anhalten, aber sichtbar bleiben.
const reported = new Set<string>();
/** zuletzt aufgetretene Laufzeitfehler (für window.__crownward.errors()) */
export const loopErrors: string[] = [];
function reportOnce(where: string, e: unknown): void {
  if (loopErrors.length < 50) loopErrors.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
  if (reported.has(where)) return;
  reported.add(where);
  console.error(`[crownward] Fehler in ${where}:`, e);
}
