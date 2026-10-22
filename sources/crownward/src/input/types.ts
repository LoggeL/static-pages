// Crownward – gemeinsame Typen der Eingabeschicht.

/** Menü-/Systemaktionen als Flanken (einmal pro Tastendruck). */
export type MenuAction =
  | 'pause' // P / Start / Touch-Pause
  | 'escape' // Esc: im Spiel Pause, in Menüs zurück
  | 'back' // Gamepad B in Menüs
  | 'help' // H / F1 / Gamepad Back
  | 'mute' // M
  | 'quicksave' // F5
  | 'quickload' // F9
  | 'navUp'
  | 'navDown'
  | 'navLeft'
  | 'navRight'
  | 'confirm';

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

/** Tastaturhälfte: WASD-Seite (S zahlt) oder Pfeiltasten (↓ zahlt); null = noch keine Richtungs-/Münztaste. */
export type KeyboardSide = 'wasd' | 'arrows' | null;

/** 'game' = Spielsteuerung aktiv; 'menu' = Menüs/Overlays offen (Tasten navigieren). */
export type InputMode = 'game' | 'menu';

export type Emit = (action: MenuAction) => void;
