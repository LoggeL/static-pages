import { createUI } from './app/ui.js';
import { loadSettings, saveSettings } from './app/settings.js';
import { STRINGS } from './app/strings.js';

/** Resolves at the start screen. Playback and Web Audio begin on a user gesture. */
export async function startDemo({ canvas, quality = 'high', onProgress, ui, ...options } = {}) {
  let timer;
  const { createDemo } = await Promise.race([import('./app/runtime.js'), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Die Grafikbausteine antworten nicht. Bitte versuche den sparsamen Start.')), 20000);
  })]).finally(() => clearTimeout(timer));
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
  if (['auto', 'touch', 'mouse'].includes(query.get('controls'))) settings.controls = query.get('controls');
  let demo;
  const started = performance.now();
  const diagnostics = { stage: 'modules', assets: query.get('assets') || 'auto', error: null };
  function diagnosticText() {
    return JSON.stringify({ ...diagnostics, elapsedSeconds: Math.round((performance.now() - started) / 1000),
      browser: navigator.userAgent, viewport: [innerWidth, innerHeight], build: query.get('v') || null,
      ...(demo ? { assets: demo.stats().assets, issues: demo.stats().issues } : {}) }, null, 2);
  }
  function persist() {
    if (!saveSettings(settings)) ui.notice('storage', STRINGS.storageUnavailable);
  }
  const ui = createUI(root, {
    onStart: () => demo?.resume(),
    onQualityChange: quality => { settings.quality = quality; demo?.setQuality(quality); persist(); },
    onVolumeChange: volume => { settings.volume = volume; demo?.setVolume(volume); persist(); },
    onControlsChange: controls => { settings.controls = controls; demo?.setControls(controls); persist(); },
    onSimpleRestart: () => {
      const url = new URL(location.href); url.searchParams.set('quality', 'low'); url.searchParams.set('postfx', '0');
      url.searchParams.set('assets', 'safe'); url.searchParams.set('controls', 'touch' === settings.controls ? 'touch' : 'auto');
      location.assign(url.href);
    },
    getDiagnostics: diagnosticText,
  });
  ui.setSettings(settings);
  ui.setState('loading');
  if (settings.storageAvailable === false) ui.notice('storage', STRINGS.storageUnavailable);
  window.__bodycam = { ready: false, diagnostics };
  try {
    demo = await startDemo({ canvas, quality: settings.quality, controls: settings.controls, volume: settings.volume, ui,
      onProgress: event => { diagnostics.stage = event.stage; },
      debug: query.get('debug') === '1', syntheticAudio: query.get('audio') === 'synthetic' });
    window.__bodycam = demo;
  } catch (error) {
    diagnostics.error = String(error.message); diagnostics.stage = error.stage || diagnostics.stage;
    ui.notice('startup', error.userMessage || STRINGS.graphicsUnavailable);
    ui.notice('startup-detail', `${diagnostics.stage}: ${error.message}`);
    ui.setState('error');
    // Handled startup failure: details remain inspectable without an unhandled rejection.
    console.info('[bodycam/app] Startup unavailable:', error.message);
    window.__bodycam = { ready: false, error: String(error.message), diagnostics };
  }
}

if (typeof document !== 'undefined') void bootstrap();
