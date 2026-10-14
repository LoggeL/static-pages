export const SETTINGS_KEY = 'bodycam-demo.settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ quality: 'high', volume: 0.65 });
export const QUALITY_LEVELS = Object.freeze(['low', 'medium', 'high']);

function normalize(settings) {
  return {
    quality: QUALITY_LEVELS.includes(settings?.quality) ? settings.quality : DEFAULT_SETTINGS.quality,
    volume: typeof settings?.volume === 'number' && Number.isFinite(settings.volume)
      ? Math.min(1, Math.max(0, settings.volume)) : DEFAULT_SETTINGS.volume,
  };
}

/** Storage errors are contained; the UI can report storageAvailable === false. */
export function loadSettings() {
  try {
    const stored = globalThis.localStorage.getItem(SETTINGS_KEY);
    let settings;
    try { settings = stored ? JSON.parse(stored) : null; } catch { settings = null; }
    return { ...normalize(settings), storageAvailable: true };
  } catch {
    return { ...DEFAULT_SETTINGS, storageAvailable: false };
  }
}

/** Returns false if persistence is blocked or full; settings remain usable. */
export function saveSettings(settings) {
  try {
    globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalize(settings)));
    return true;
  } catch {
    return false;
  }
}
