import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CHROMIUM_PATH, PUBLIC_ROOT, localPage } from './paths.mjs';
import { DEFAULT_AUDIO_SINK, validateAudioSink } from './audio-output.mjs';

export const DEFAULTS = {
  port: 8969, width: 1920, height: 1080, deviceScaleFactor: 1, audioSink: DEFAULT_AUDIO_SINK,
  settleMs: 500, measureSeconds: 3, readyTimeoutMs: 60000, actionTimeoutMs: 15000,
  browser: CHROMIUM_PATH, root: PUBLIC_ROOT,
};

export const HELP = `Bodycam-Test-Harness
  node sources/bodycam-demo/tools/harness/run.mjs --page bodycam-demo/_dev/world/index.html?debug=1 --shots shots.json --out /absolute/results/new-run

Pflicht: --shots JSON, --out neuer oder leerer Ordner außerhalb des Repos.
--page ist optional, wenn die Shot-Datei page enthält. Pfad relativ zu public/.
Optionen: --port 8969 --width 1920 --height 1080 --device-scale-factor 1
          --audio-sink none|default (Standard none; BODYCAM_AUDIO_SINK)
          --measure-seconds 3 --settle-ms 500 --ready-timeout-ms 60000
          --action-timeout-ms 15000 --browser /path/to/chromium
          --root /path/to/static/root (für die Selbsttest-Seite)
Exit: 0 bestanden, 1 Lauf fehlgeschlagen, 2 ungültiger Aufruf/Ausgabeordner.
Vergleich: node sources/bodycam-demo/tools/harness/compare.mjs --help
Selbsttest: npm test --prefix sources/bodycam-demo/tools/harness
`;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: Objekt erwartet.`);
}
function number(value, label, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label}: Zahl ${min}..${max}${integer ? ' (ganzzahlig)' : ''} erwartet.`);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: nichtleerer Text erwartet.`);
}
function vector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || value.some(x => !Number.isFinite(x))) throw new Error(`${label}: ${length} endliche Zahlen erwartet.`);
}
function timings(value, label) {
  if (value.settleMs !== undefined) number(value.settleMs, `${label}.settleMs`, 0, 300000);
  if (value.measureSeconds !== undefined) number(value.measureSeconds, `${label}.measureSeconds`, 0, 120);
}
export function validateAction(action, label) {
  object(action, label);
  switch (action.type) {
    case 'teleport':
      vector(action.position, 3, `${label}.position`);
      for (const key of ['yawDeg', 'pitchDeg']) if (action[key] !== undefined) number(action[key], `${label}.${key}`, -36000, 36000);
      break;
    case 'look':
      for (const key of ['yawDeg', 'pitchDeg']) number(action[key], `${label}.${key}`, -36000, 36000);
      break;
    case 'keys':
      if (!Array.isArray(action.keys) || !action.keys.length || new Set(action.keys).size !== action.keys.length) throw new Error(`${label}.keys: nichtleere Liste eindeutiger Tasten erwartet.`);
      action.keys.forEach((key, i) => text(key, `${label}.keys[${i}]`));
      if (action.durationMs !== undefined) number(action.durationMs, `${label}.durationMs`, 0, 300000);
      break;
    case 'eval': text(action.code, `${label}.code`); break;
    case 'wait': number(action.ms, `${label}.ms`, 0, 300000); break;
    case 'click': text(action.selector, `${label}.selector`); break;
    case 'mouse':
      if (action.button !== undefined && !['left', 'middle', 'right'].includes(action.button)) throw new Error(`${label}.button: left/middle/right erwartet.`);
      if (action.position !== undefined) vector(action.position, 2, `${label}.position`);
      if (action.durationMs !== undefined) number(action.durationMs, `${label}.durationMs`, 0, 300000);
      break;
    default: throw new Error(`${label}: unbekannte Aktion ${JSON.stringify(action.type)}.`);
  }
}
function actions(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: Liste erwartet.`);
  value.forEach((action, i) => validateAction(action, `${label}[${i}]`));
}

export function validateShots(input) {
  // A simple shot array is accepted in addition to the versioned document.
  const doc = Array.isArray(input) ? { version: 1, shots: input } : input;
  object(doc, 'Shot-Datei');
  if (doc.version !== 1) throw new Error('Shot-Datei benötigt version: 1.');
  if (doc.page !== undefined) localPage(doc.page);
  if (doc.defaults !== undefined) { object(doc.defaults, 'defaults'); timings(doc.defaults, 'defaults'); }
  for (const key of ['beforeReady', 'setup']) if (doc[key] !== undefined) actions(doc[key], key);
  if (!Array.isArray(doc.shots) || !doc.shots.length) throw new Error('shots: mindestens ein Shot erwartet.');
  const names = new Set();
  for (const [i, shot] of doc.shots.entries()) {
    const label = `shots[${i}]`;
    object(shot, label);
    text(shot.name, `${label}.name`);
    if (names.has(shot.name)) throw new Error(`Doppelter Shot-Name: ${shot.name}`);
    names.add(shot.name);
    if (shot.page !== undefined) localPage(shot.page);
    if (shot.teleport !== undefined) {
      if (!Array.isArray(shot.teleport) || ![3, 5].includes(shot.teleport.length)) throw new Error(`${label}.teleport: [x,y,z] oder [x,y,z,yawDeg,pitchDeg] erwartet.`);
      vector(shot.teleport, shot.teleport.length, `${label}.teleport`);
    }
    if (shot.look !== undefined) vector(shot.look, 2, `${label}.look`);
    if (shot.actions !== undefined) actions(shot.actions, `${label}.actions`);
    timings(shot, label);
  }
  return doc;
}

export function parseArgs(argv) {
  const aliases = {
    page: 'page', shots: 'shots', out: 'out', port: 'port', width: 'width', height: 'height',
    'device-scale-factor': 'deviceScaleFactor', 'measure-seconds': 'measureSeconds',
    'settle-ms': 'settleMs', 'ready-timeout-ms': 'readyTimeoutMs',
    'action-timeout-ms': 'actionTimeoutMs', browser: 'browser', root: 'root', 'audio-sink': 'audioSink',
  };
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    const key = aliases[argv[i].replace(/^--/, '')];
    if (!argv[i].startsWith('--') || !key) throw new Error(`Unbekannte Option: ${argv[i]}`);
    if (result[key] !== undefined) throw new Error(`Doppelte Option: ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Wert fehlt: ${argv[i]}`);
    const value = argv[++i];
    result[key] = typeof DEFAULTS[key] === 'number' ? Number(value) : value;
  }
  return result;
}

export async function loadConfig(options) {
  text(options.shots, '--shots');
  text(options.out, '--out');
  const shotsPath = path.resolve(options.shots);
  const doc = validateShots(JSON.parse(await readFile(shotsPath, 'utf8')));
  const config = { ...DEFAULTS, ...doc.defaults, ...options };
  config.page = localPage(options.page ?? doc.page);
  config.shots = shotsPath;
  config.root = path.resolve(config.root);
  config.browser = path.resolve(config.browser);
  config.out = path.resolve(config.out);
  number(config.port, 'port', 1, 65535, true);
  number(config.width, 'width', 16, 7680, true);
  number(config.height, 'height', 16, 4320, true);
  number(config.deviceScaleFactor, 'deviceScaleFactor', 0.5, 3);
  timings(config, 'config');
  number(config.readyTimeoutMs, 'readyTimeoutMs', 100, 300000);
  number(config.actionTimeoutMs, 'actionTimeoutMs', 100, 300000);
  validateAudioSink(config.audioSink);
  return { config, doc, overrides: options };
}
