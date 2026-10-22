// Crownward – Tastatur. Belegung laut docs/DESIGN.md §1 (physische Tasten über KeyboardEvent.code,
// damit QWERTZ/QWERTY/AZERTY dieselben Positionen nutzen).

import type { PlayerInput } from '../sim';
import type { Emit, InputMode, KeyboardSide, MenuAction } from './types';

interface Binding {
  left: readonly string[];
  right: readonly string[];
  sprint: readonly string[];
  act: readonly string[];
}

export const BINDINGS: { solo: Binding; coop1: Binding; coop2: Binding } = {
  /** Einzelspiel: WASD-Seite und Pfeiltasten gleichzeitig */
  solo: {
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    act: ['KeyS', 'ArrowDown'],
  },
  coop1: { left: ['KeyA'], right: ['KeyD'], sprint: ['ShiftLeft'], act: ['KeyS'] },
  // Kein „Strg rechts": ⌃+Pfeil sind unter macOS Systemkürzel (Schreibtisch wechseln, Mission Control), viele
  // Mac-Tastaturen haben gar keine rechte Strg-Taste, und gehaltenes Strg sperrt die Menütasten von Spieler 1.
  coop2: { left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], act: ['ArrowDown'] },
};

const WASD_SIDE = new Set(['KeyA', 'KeyD', 'KeyS']);
const ARROW_SIDE = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown']);

/** Tastaturhälfte einer Spieltaste (Shift zählt nicht – beide Hälften sprinten mit „ihrer" Shift-Taste). */
export function keySide(code: string): KeyboardSide {
  if (WASD_SIDE.has(code)) return 'wasd';
  if (ARROW_SIDE.has(code)) return 'arrows';
  return null;
}

/** Spieler einer Spieltaste: im Koop gehört die Pfeil-Hälfte (inkl. Shift rechts) Spieler 2, sonst Spieler 1. */
export function keyPlayer(code: string, coop: boolean): number {
  if (!coop) return 0;
  const b = BINDINGS.coop2;
  return [...b.left, ...b.right, ...b.sprint, ...b.act].includes(code) ? 1 : 0;
}

const GAME_CODES = new Set<string>(
  [BINDINGS.solo, BINDINGS.coop1, BINDINGS.coop2].flatMap((b) => [...b.left, ...b.right, ...b.sprint, ...b.act]),
);

/** Tasten, deren Browser-Standardaktion immer unterdrückt wird (Neu laden, Browserhilfe, Scrollen). */
const ALWAYS_PREVENT = new Set(['F1', 'F5', 'F9', 'Space', 'ArrowUp', 'ArrowDown']);

const ACTION_KEYS: Record<string, MenuAction> = {
  Escape: 'escape',
  KeyP: 'pause',
  KeyH: 'help',
  F1: 'help',
  KeyM: 'mute',
  F5: 'quicksave',
  F9: 'quickload',
};

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement) return true;
  return t instanceof HTMLInputElement && !['range', 'checkbox', 'button'].includes(t.type);
}

export class KeyboardInput {
  mode: InputMode = 'game';
  private held = new Set<string>();
  /**
   * Seit dem letzten Simulationsschritt gedrückte Tasten. Ein kurzer Druck (keydown + keyup zwischen zwei
   * Schritten, z. B. bei niedriger Bildrate) zählt so mindestens einen Schritt lang als gehalten.
   */
  private latched = new Set<string>();
  private target: Window | null = null;

  constructor(
    private readonly emit: Emit,
    /** wird bei jeder Spieltaste im Spielmodus gerufen (Gerätewechsel → Tastatur), mit KeyboardEvent.code */
    private readonly onGameKey: (code: string) => void,
  ) {}

  attach(target: Window): void {
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clear);
  }

  detach(): void {
    const t = this.target;
    if (!t) return;
    t.removeEventListener('keydown', this.onKeyDown);
    t.removeEventListener('keyup', this.onKeyUp);
    t.removeEventListener('blur', this.clear);
    this.target = null;
  }

  /** Alle gehaltenen Tasten vergessen (Fokusverlust, Pause). */
  clear = (): void => {
    this.held.clear();
    this.latched.clear();
  };

  /** Nach jedem Simulationsschritt: kurze Tastendrücke sind verbraucht. */
  endStep(): void {
    if (this.latched.size) this.latched.clear();
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** Eingabe eines Spielers aus den gehaltenen Tasten. Spieler 2 existiert nur im Koop. */
  playerInput(index: number, coop: boolean): PlayerInput {
    const b = coop ? (index === 0 ? BINDINGS.coop1 : index === 1 ? BINDINGS.coop2 : null) : index === 0 ? BINDINGS.solo : null;
    if (!b) return { left: false, right: false, sprint: false, act: false };
    const any = (codes: readonly string[]) => codes.some((c) => this.held.has(c) || this.latched.has(c));
    return { left: any(b.left), right: any(b.right), sprint: any(b.sprint), act: any(b.act) };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Cmd-Kombinationen gehören dem Browser/System
    if (e.metaKey) return;
    const code = e.code;
    const field = isTextField(e.target);

    if (GAME_CODES.has(code) && !field) {
      this.held.add(code);
      if (this.mode === 'game') {
        if (!e.repeat) this.latched.add(code);
        e.preventDefault();
        this.onGameKey(code);
      }
    }

    let action: MenuAction | undefined = ACTION_KEYS[code];
    if (this.mode === 'menu') {
      if (code === 'ArrowUp' || code === 'KeyW') action = 'navUp';
      else if (code === 'ArrowDown' || code === 'KeyS') action = 'navDown';
      else if ((code === 'Enter' || code === 'NumpadEnter') && isIdleFocus()) action = 'confirm';
    }
    // Strg/Alt-Kombinationen (Drucken, Browser-Kürzel) nicht abfangen – außer F-Tasten
    if ((e.ctrlKey || e.altKey) && !code.startsWith('F')) action = undefined;
    if (field && action !== 'escape') action = undefined;

    if (action || ALWAYS_PREVENT.has(code)) {
      if (!(this.mode === 'menu' && code === 'Space')) e.preventDefault();
    }
    if (action && !e.repeat) this.emit(action);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    // macOS sendet bei gehaltener Cmd-Taste keine keyup-Ereignisse anderer Tasten → alles lösen
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.held.clear();
  };
}

/** Kein Bedienelement fokussiert → Enter bestätigt das erste Menüelement. */
function isIdleFocus(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement;
}
