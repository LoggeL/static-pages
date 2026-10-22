// Crownward – Speicherstände und Einstellungen in localStorage (robust gegen gesperrten/vollen Speicher).

import type { AudioSettings } from '../audio/types';
import { deserializeGame } from '../sim';

export const SETTINGS_KEY = 'crownward.settings';
const SAVE_PREFIX = 'crownward.save.';
/** Bekannte Speicherplätze: manuell (F5/Pausemenü) und Morgen-Autosave. */
export const SLOTS = ['slot1', 'auto'] as const;

export interface Settings extends AudioSettings {
  /** Touch-Steuerung auch ohne Touch-Gerät anzeigen */
  forceTouch: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.6,
  sfx: 0.85,
  muted: false,
  forceTouch: false,
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Schreibt einen Wert; liefert einen Fehlertext oder null bei Erfolg. */
function write(key: string, value: string): string | null {
  const s = storage();
  if (!s) return 'Speicher nicht verfügbar';
  try {
    s.setItem(key, value);
    return null;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    return name === 'QuotaExceededError' ? 'Speicher voll' : String(e);
  }
}

const unit = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

export function loadSettings(): Settings {
  const raw = read(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const d = JSON.parse(raw) as Partial<Settings>;
    return {
      master: unit(d.master, DEFAULT_SETTINGS.master),
      music: unit(d.music, DEFAULT_SETTINGS.music),
      sfx: unit(d.sfx, DEFAULT_SETTINGS.sfx),
      muted: typeof d.muted === 'boolean' ? d.muted : DEFAULT_SETTINGS.muted,
      forceTouch: typeof d.forceTouch === 'boolean' ? d.forceTouch : DEFAULT_SETTINGS.forceTouch,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, JSON.stringify(s));
}

// ---------- Speicherstände ----------

/** Erlaubte Slot-Namen: kurz, nur Buchstaben/Ziffern/-/_ */
export function validSlot(slot: string): boolean {
  return /^[A-Za-z0-9_-]{1,32}$/.test(slot);
}

export function slotKey(slot: string): string {
  return SAVE_PREFIX + slot;
}

export function readSlot(slot: string): string | null {
  return validSlot(slot) ? read(slotKey(slot)) : null;
}

export function writeSlot(slot: string, text: string): string | null {
  if (!validSlot(slot)) return 'Ungültiger Speicherplatz';
  return write(slotKey(slot), text);
}

export interface SaveMeta {
  slot: string;
  savedAt: string;
  day: number;
  coop: boolean;
  /** null = ladbar; sonst der (deutsche) Grund, warum der Stand nicht geladen werden kann */
  error: string | null;
}

/**
 * Liest die Eckdaten eines Speicherstands (für Menüs); null, wenn der Slot leer ist. Prüft Format, Version und
 * Struktur wie das Laden selbst (deserializeGame) – ein Stand mit error !== null scheitert beim Laden.
 */
export function readMeta(slot: string): SaveMeta | null {
  const raw = readSlot(slot);
  if (!raw) return null;
  const r = deserializeGame(raw);
  if (r.ok) return { slot, savedAt: r.savedAt, day: r.state.day, coop: r.state.coop, error: null };
  // Unladbar: Eckdaten soweit lesbar übernehmen (nur für Hinweise)
  let savedAt = '';
  try {
    const d = JSON.parse(raw) as { savedAt?: unknown } | null;
    if (d && typeof d.savedAt === 'string') savedAt = d.savedAt;
  } catch {
    /* beschädigt */
  }
  return { slot, savedAt, day: 1, coop: false, error: r.error };
}

const savedTime = (m: SaveMeta) => {
  const v = Date.parse(m.savedAt);
  return Number.isFinite(v) ? v : 0;
};

/** Alle belegten Speicherplätze, neueste zuerst. */
export function listSaves(): SaveMeta[] {
  const out: SaveMeta[] = [];
  for (const slot of SLOTS) {
    const m = readMeta(slot);
    if (m) out.push(m);
  }
  return out.sort((a, b) => savedTime(b) - savedTime(a));
}

/** Neuester ladbarer Speicherstand (Autosave oder manueller Slot) – Ziel von „Fortsetzen", „Laden" und F9. */
export function newestSave(saves: readonly SaveMeta[] = listSaves()): SaveMeta | null {
  return saves.find((m) => m.error === null) ?? null;
}

/** Unladbarer Stand, der neuer ist als jeder ladbare (z. B. aus einer neueren Spielversion) – für einen Hinweis. */
export function blockedSave(saves: readonly SaveMeta[] = listSaves()): SaveMeta | null {
  const first = saves[0];
  return first && first.error !== null ? first : null;
}
