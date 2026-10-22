// Crownward – Gamepad (Standard-Layout). Wird pro Frame abgefragt.
// Spiel: Stick/Steuerkreuz reiten, A Münze, B/X/RB/RT sprinten, Start Pause, Back Hilfe.
// Menü: Steuerkreuz/Stick navigieren, A bestätigen, B zurück.

import type { PlayerInput } from '../sim';
import type { Emit, InputMode } from './types';

const DEAD = 0.4;
const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };

/**
 * Spieler eines Pads (slot = Reihenfolge unter den verbundenen Pads). Einzelspiel: alle Pads steuern Spieler 1.
 * Koop: Mit genau einem Pad gehört es Spieler 2 – Spieler 1 bleibt an der Tastatur (A/D/S). Ab zwei Pads
 * steuert Pad 1 Spieler 1 und Pad 2 Spieler 2; weitere Pads bleiben ungenutzt (null).
 */
export function padPlayer(slot: number, padCount: number, coop: boolean): number | null {
  if (!coop) return 0;
  const player = padCount === 1 ? 1 : slot;
  return player < 2 ? player : null;
}

interface PadState {
  buttons: boolean[];
  /** Stickrichtung im letzten Frame (-1/0/1) für Menü-Flanken */
  stickX: number;
  stickY: number;
}

const pressed = (pad: Gamepad, i: number) => {
  const b = pad.buttons[i];
  return !!b && (b.pressed || b.value > 0.5);
};

/** Beim Wechsel ins Spiel gehaltene Tasten/Stickrichtung eines Pads – gesperrt, bis sie losgelassen werden. */
interface PadLock {
  buttons: Set<number>;
  stick: boolean;
}

export class GamepadInput {
  private prev = new Map<number, PadState>();
  private inputs: PlayerInput[] = [];
  private locked = new Map<number, PadLock>();

  /** Anzahl aktuell verbundener Pads (nach letzter Abfrage). */
  get count(): number {
    return this.inputs.length;
  }

  /**
   * Sperrt alle gerade gehaltenen Tasten und die Stickrichtung, bis sie losgelassen werden. Für den Wechsel
   * Menü → Spiel: Das A, das „Fortsetzen"/„Neues Spiel" bestätigt hat, darf im Spiel keine Münze fallen lassen.
   */
  latchHeld(): void {
    this.locked.clear();
    for (const [index, st] of this.prev) {
      const buttons = new Set<number>();
      st.buttons.forEach((b, i) => {
        if (b) buttons.add(i);
      });
      if (buttons.size > 0 || st.stickX !== 0) this.locked.set(index, { buttons, stick: st.stickX !== 0 });
    }
  }

  /**
   * Fragt alle Pads ab. Flanken werden als Menüaktionen gemeldet; onActive(slot, count) bei jeder Betätigung.
   * slot = Reihenfolge unter den verbundenen Pads (0 = erstes Pad), count = Anzahl verbundener Pads.
   */
  poll(mode: InputMode, emit: Emit, onActive: (slot: number, count: number) => void): void {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pads: Gamepad[] = [];
    for (const p of list) if (p && p.connected) pads.push(p);
    this.inputs = [];
    const seen = new Set<number>();

    pads.forEach((pad, slot) => {
      seen.add(pad.index);
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const buttons = pad.buttons.map((_, i) => pressed(pad, i));
      const stickX = ax < -DEAD ? -1 : ax > DEAD ? 1 : 0;
      const stickY = ay < -DEAD ? -1 : ay > DEAD ? 1 : 0;
      const prev = this.prev.get(pad.index) ?? { buttons: [], stickX: 0, stickY: 0 };
      const edge = (i: number) => buttons[i] && !prev.buttons[i];

      // Sperren lösen, sobald die Taste bzw. der Stick losgelassen ist
      const lock = this.locked.get(pad.index);
      if (lock) {
        for (const i of [...lock.buttons]) if (!buttons[i]) lock.buttons.delete(i);
        if (lock.stick && stickX === 0) lock.stick = false;
        if (lock.buttons.size === 0 && !lock.stick) this.locked.delete(pad.index);
      }
      const held = (i: number) => !!buttons[i] && !(lock && lock.buttons.has(i));
      const sx = lock && lock.stick ? 0 : stickX;

      const input: PlayerInput = {
        left: sx < 0 || held(BTN.left),
        right: sx > 0 || held(BTN.right),
        sprint: held(BTN.b) || held(BTN.x) || held(BTN.rb) || held(BTN.rt),
        act: held(BTN.a),
      };
      this.inputs.push(mode === 'game' ? input : { left: false, right: false, sprint: false, act: false });

      if (buttons.some((b, i) => b && !prev.buttons[i]) || stickX !== prev.stickX || stickY !== prev.stickY) {
        if (buttons.some(Boolean) || stickX !== 0 || stickY !== 0) onActive(slot, pads.length);
      }

      if (edge(BTN.start)) emit('pause');
      if (edge(BTN.back)) emit('help');
      if (mode === 'menu') {
        if (edge(BTN.up) || (stickY < 0 && prev.stickY >= 0)) emit('navUp');
        if (edge(BTN.down) || (stickY > 0 && prev.stickY <= 0)) emit('navDown');
        if (edge(BTN.left) || (stickX < 0 && prev.stickX >= 0)) emit('navLeft');
        if (edge(BTN.right) || (stickX > 0 && prev.stickX <= 0)) emit('navRight');
        if (edge(BTN.a)) emit('confirm');
        if (edge(BTN.b)) emit('back');
      }
      this.prev.set(pad.index, { buttons, stickX, stickY });
    });

    for (const idx of [...this.prev.keys()]) if (!seen.has(idx)) this.prev.delete(idx);
    for (const idx of [...this.locked.keys()]) if (!seen.has(idx)) this.locked.delete(idx);
  }

  /** Eingabe des Pads an Position slot (oder null, wenn nicht verbunden). */
  input(slot: number): PlayerInput | null {
    return this.inputs[slot] ?? null;
  }
}
