import { createUI } from './app/ui.js';
import { loadSettings, saveSettings } from './app/settings.js';
import { STRINGS } from './app/strings.js';

/** Resolves at the start screen. Playback and Web Audio begin on a user gesture. */
export async function startDemo({ canvas, quality = 'high', onProgress, ui, ...options } = {}) {
  const { createDemo } = await import('./app/runtime.js');
  return createDemo({ canvas, quality, onProgress, ui, ...options });
}

async function bootstrap() {
  const canvas = document.querySelector('#view');
  const root = document.querySelector('#ui');
  if (!canvas || !root || canvas.dataset.bootstrapped) return;
  canvas.dataset.bootstrapped = 'true';
  const settings = loadSettings();
  const query = new URLSearchParams(location.search);
  if (['low', 'medium', 'high'].includes(query.get('quality'))) settings.quality = query.get('quality');
  let demo;
  function persist() {
    if (!saveSettings(settings)) ui.notice('storage', STRINGS.storageUnavailable);
  }
  const ui = createUI(root, {
    onStart: () => demo?.resume(),
    onQualityChange: quality => { settings.quality = quality; demo?.setQuality(quality); persist(); },
    onVolumeChange: volume => { settings.volume = volume; demo?.setVolume(volume); persist(); },
  });
  ui.setSettings(settings);
  ui.setState('loading');
  if (settings.storageAvailable === false) ui.notice('storage', STRINGS.storageUnavailable);
  window.__bodycam = { ready: false };
  try {
    demo = await startDemo({ canvas, quality: settings.quality, volume: settings.volume, ui,
      debug: query.get('debug') === '1', syntheticAudio: query.get('audio') === 'synthetic' });
    window.__bodycam = demo;
  } catch (error) {
    ui.notice('startup', STRINGS.graphicsUnavailable);
    ui.setState('error');
    // Handled startup failure: details remain inspectable without an unhandled rejection.
    console.info('[bodycam/app] Startup unavailable:', error.message);
    window.__bodycam = { ready: false, error: String(error.message) };
  }
}

if (typeof document !== 'undefined') void bootstrap();
