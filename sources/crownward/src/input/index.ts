// Crownward – Eingabe-Manager: vereint Tastatur, Touch und Gamepad zu PlayerInput[] + Menüaktionen.
// Debug-Overrides (window.__crownward.setHeld) ersetzen die Eingabe eines Spielers vollständig.

import type { PlayerInput } from '../sim';
import { GamepadInput, padPlayer } from './gamepad';
import { KeyboardInput, keyPlayer, keySide } from './keyboard';
import { TouchControls } from './touch';
import type { InputDevice, InputMode, KeyboardSide, MenuAction } from './types';

export type { InputDevice, InputMode, KeyboardSide, MenuAction } from './types';
export { BINDINGS, keyPlayer, keySide } from './keyboard';
export { padPlayer } from './gamepad';

const NONE: PlayerInput = { left: false, right: false, sprint: false, act: false };

export class InputManager {
  readonly keyboard: KeyboardInput;
  readonly touch: TouchControls;
  readonly gamepad = new GamepadInput();
  coop = false;
  private mode: InputMode = 'game';
  private actions: MenuAction[] = [];
  private overrides: (PlayerInput | null)[] = [];
  private devices: InputDevice[] = ['keyboard', 'keyboard'];
  /** Einzelspiel: zuletzt benutzte Tastaturhälfte (für „S halten" bzw. „↓ halten") */
  private kbSide: KeyboardSide = null;
  /** Gerät meldet grobe Zeiger (Telefon/Tablet) */
  private readonly coarse: boolean;
  private forceTouch = false;
  private touchUsed = false;
  /** In dieser Sitzung wurde eine echte Taste gedrückt (Hardware-Tastatur vorhanden) */
  private keyboardSeen = false;

  constructor() {
    const push = (a: MenuAction) => this.actions.push(a);
    this.keyboard = new KeyboardInput(push, (code) => {
      // Im Koop wechselt nur der Spieler, dem die Tastaturhälfte gehört, aufs Gerät „Tastatur"
      const player = keyPlayer(code, this.coop);
      this.devices[player] = 'keyboard';
      if (!this.coop) this.kbSide = keySide(code) ?? this.kbSide;
      // Wer zur Tastatur greift, braucht die Bildschirmtasten nicht (außer erzwungen/Touch-Gerät)
      if (player === 0) this.touchUsed = false;
    });
    this.touch = new TouchControls(push, () => this.noteTouch());
    this.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    // Telefon/Tablet: Hinweise von Anfang an für Touch formulieren („Münze halten")
    if (this.coarse) this.devices[0] = 'touch';
  }

  attach(target: Window): void {
    this.keyboard.attach(target);
    target.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Unidentified' && !e.isComposing) this.keyboardSeen = true;
      },
      { capture: true, passive: true },
    );
    // Jede echte Berührung (auch außerhalb der Tasten) schaltet die Touch-Steuerung ein
    target.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') this.noteTouch();
      },
      { capture: true, passive: true },
    );
  }

  private noteTouch(): void {
    this.touchUsed = true;
    this.devices[0] = 'touch';
  }

  setForceTouch(v: boolean): void {
    this.forceTouch = v;
  }

  /** Sollen die Bildschirmtasten angezeigt werden (unabhängig vom Spielbildschirm)? */
  get touchWanted(): boolean {
    return this.forceTouch || this.coarse || this.touchUsed;
  }

  /**
   * Kann Spieler 2 gesteuert werden? Die Bildschirmtasten steuern nur Spieler 1; auf einem Gerät mit grobem
   * Zeiger (Telefon/Tablet) braucht Koop deshalb eine Tastatur (erkannt am ersten Tastendruck) oder ein Gamepad.
   */
  get coopAvailable(): boolean {
    return !this.coarse || this.keyboardSeen || this.gamepad.count > 0;
  }

  setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.keyboard.mode = mode;
    this.keyboard.endStep();
    if (mode === 'menu') this.touch.release();
    // Menü → Spiel: die Pad-Taste, die den Menüpunkt bestätigt hat, wirkt erst nach erneutem Drücken
    else this.gamepad.latchHeld();
  }

  getMode(): InputMode {
    return this.mode;
  }

  /** Einmal pro Frame: Gamepads abfragen. */
  poll(): void {
    this.gamepad.poll(this.mode, (a) => this.actions.push(a), (slot, count) => {
      const player = padPlayer(slot, count, this.coop);
      if (player !== null) this.devices[player] = 'gamepad';
    });
  }

  /** Gesammelte Menüaktionen seit dem letzten Aufruf (Flanken). */
  takeActions(): MenuAction[] {
    if (this.actions.length === 0) return [];
    const out = this.actions;
    this.actions = [];
    return out;
  }

  /**
   * Eingaben für count Spieler (Index = Spieler) für genau einen Simulationsschritt. Im Menümodus nur
   * Overrides. Verbraucht kurze Tastendrücke/Tipps, die zwischen zwei Schritten begannen und endeten.
   */
  playerInputs(count: number): PlayerInput[] {
    const out: PlayerInput[] = [];
    for (let i = 0; i < count; i++) out.push(this.playerInput(i));
    this.keyboard.endStep();
    this.touch.endStep();
    return out;
  }

  playerInput(i: number): PlayerInput {
    const o = this.overrides[i];
    if (o) return { ...o };
    if (this.mode !== 'game') return { ...NONE };
    const r: PlayerInput = { ...NONE };
    const or = (p: PlayerInput | null) => {
      if (!p) return;
      r.left ||= p.left;
      r.right ||= p.right;
      r.sprint ||= p.sprint;
      r.act ||= p.act;
    };
    or(this.keyboard.playerInput(i, this.coop));
    if (i === 0 && this.touch.isVisible) or(this.touch.input());
    const pads = this.gamepad.count;
    for (let s = 0; s < pads; s++) if (padPlayer(s, pads, this.coop) === i) or(this.gamepad.input(s));
    return r;
  }

  /** Überschreibt die Eingabe eines Spielers (Tests/Debug); null hebt den Override auf. */
  setOverride(i: number, input: Partial<PlayerInput> | null): void {
    this.overrides[i] = input ? { ...NONE, ...input } : null;
  }

  /** zuletzt benutztes Gerät eines Spielers (für Hinweistexte wie „S halten" / „Münze halten"). */
  deviceOf(i: number): InputDevice {
    return this.devices[i] ?? 'keyboard';
  }

  /** Einzelspiel: zuletzt benutzte Tastaturhälfte (null vor der ersten Richtungs-/Münztaste). */
  get keyboardSide(): KeyboardSide {
    return this.kbSide;
  }

  /** Gehaltene Tasten/Finger vergessen (Fokusverlust, Pause, neues Spiel); gehaltene Pad-Tasten sperren. */
  releaseAll(): void {
    this.keyboard.clear();
    this.touch.release();
    this.gamepad.latchHeld();
  }
}
