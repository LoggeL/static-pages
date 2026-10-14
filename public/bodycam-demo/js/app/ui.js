import { STRINGS } from './strings.js';
import { DEFAULT_SETTINGS, QUALITY_LEVELS } from './settings.js';

const STATES = new Set(['loading', 'start', 'playing', 'paused', 'error']);

/** DOM-only shell. Start callbacks run synchronously to preserve user activation. */
export function createUI(root, { onStart, onQualityChange, onVolumeChange, onControlsChange, onSimpleRestart } = {}) {
  if (!root?.ownerDocument) throw new TypeError('createUI requires a DOM root.');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let state = 'loading';
  let disposed = false;
  let touchMode = false;
  let subtitleTimer = null;
  const notices = new Map();
  const cleanup = [];

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function listen(node, name, handler) {
    node.addEventListener(name, handler);
    cleanup.push(() => node.removeEventListener(name, handler));
  }

  doc.title = STRINGS.appTitle;
  doc.getElementById('view')?.setAttribute('aria-label', STRINGS.canvasLabel);
  const menu = element('div', 'app-menu');
  const panel = element('section', 'app-panel');
  panel.setAttribute('aria-label', STRINGS.appTitle);
  const title = element('h1', 'app-title', STRINGS.appTitle);
  const heading = element('h2', 'app-state');
  heading.tabIndex = -1;
  const loading = element('div', 'app-progress');
  const loadLabel = element('div', '', STRINGS.loadingPrepare);
  const progress = element('progress');
  progress.max = 1;
  progress.value = 0;
  progress.setAttribute('aria-label', STRINGS.loading);
  const percent = element('div', 'app-progress-value', '0 %');
  percent.setAttribute('aria-live', 'polite');
  loading.append(loadLabel, progress, percent);

  const settings = element('fieldset', 'app-settings');
  settings.append(element('legend', '', STRINGS.settings));
  const qualityRow = element('label', 'app-setting');
  qualityRow.append(element('span', '', STRINGS.quality));
  const quality = element('select');
  quality.name = 'quality';
  const qualityNames = [STRINGS.qualityAuto, STRINGS.qualityLow, STRINGS.qualityMedium, STRINGS.qualityHigh];
  QUALITY_LEVELS.forEach((value, index) => {
    const option = element('option', '', qualityNames[index]);
    option.value = value;
    quality.append(option);
  });
  qualityRow.append(quality);
  const volumeRow = element('label', 'app-setting');
  volumeRow.append(element('span', '', STRINGS.volume));
  const volumeGroup = element('span', 'app-volume');
  const volume = element('input');
  volume.name = 'volume';
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.01';
  volume.setAttribute('aria-label', STRINGS.volume);
  const volumeValue = element('output');
  volumeValue.setAttribute('aria-hidden', 'true');
  volumeGroup.append(volume, volumeValue);
  volumeRow.append(volumeGroup);
  const inputRow = element('label', 'app-setting'); inputRow.append(element('span', '', STRINGS.input));
  const inputMode = element('select'); inputMode.name = 'controls';
  for (const [value, text] of [['auto', STRINGS.inputAuto], ['touch', STRINGS.inputTouch], ['mouse', STRINGS.inputMouse]]) {
    const option = element('option', '', text); option.value = value; inputMode.append(option);
  }
  inputRow.append(inputMode); settings.append(qualityRow, inputRow, volumeRow);

  const controls = element('section', 'app-controls');
  controls.append(element('h3', '', STRINGS.controls));
  const bindings = element('dl');
  for (const [key, action] of STRINGS.controlsList) bindings.append(element('dt', '', key), element('dd', '', action));
  controls.append(bindings);
  const start = element('button', 'app-start');
  start.type = 'button';
  const simpleRestart = element('button', 'app-simple-restart', STRINGS.simpleRestart);
  simpleRestart.type = 'button'; simpleRestart.hidden = true;
  const help = element('p', 'app-help');
  const noticeList = element('ul', 'app-notices');
  noticeList.setAttribute('aria-label', STRINGS.notices);
  noticeList.setAttribute('aria-live', 'polite');
  const subtitleNode = element('p', 'app-subtitle');
  subtitleNode.setAttribute('role', 'status');
  subtitleNode.setAttribute('aria-label', STRINGS.subtitles);
  subtitleNode.hidden = true;
  panel.append(title, heading, loading, settings, controls, start, simpleRestart, help, noticeList);
  menu.append(panel);
  root.replaceChildren(menu, subtitleNode);

  function updateVolume(value) {
    const normalized = Math.min(1, Math.max(0, value));
    volume.value = String(normalized);
    const display = `${Math.round(normalized * 100)} %`;
    volumeValue.value = display;
    volume.setAttribute('aria-valuetext', display);
  }

  listen(start, 'click', () => {
    if (!disposed && state === 'error') win.location.reload();
    if (!disposed && (state === 'start' || state === 'paused')) onStart?.();
  });
  listen(quality, 'change', () => onQualityChange?.(quality.value));
  listen(inputMode, 'change', () => onControlsChange?.(inputMode.value));
  listen(simpleRestart, 'click', () => onSimpleRestart?.());
  listen(volume, 'input', () => {
    const value = Number(volume.value);
    updateVolume(value);
    onVolumeChange?.(value);
  });

  function setState(next) {
    if (disposed || !STATES.has(next)) return;
    const changed = state !== next;
    state = next;
    root.dataset.state = next;
    const inGame = next === 'playing';
    const isMenu = next === 'start' || next === 'paused';
    menu.hidden = inGame;
    loading.hidden = next !== 'loading';
    settings.hidden = !isMenu;
    controls.hidden = !isMenu;
    start.hidden = !isMenu && next !== 'error';
    simpleRestart.hidden = next !== 'error';
    help.hidden = next === 'loading';
    heading.textContent = next === 'start' ? STRINGS.ready : STRINGS[next];
    start.textContent = next === 'error' ? STRINGS.reload : next === 'paused' ? STRINGS.resume : touchMode ? STRINGS.touchStart : STRINGS.start;
    help.textContent = next === 'error' ? STRINGS.errorHelp : next === 'paused'
      ? touchMode ? STRINGS.touchPauseHelp : STRINGS.pauseHelp : touchMode ? STRINGS.touchHelp : STRINGS.startHelp;
    noticeList.classList.toggle('app-notices-playing', inGame);
    (inGame ? root : panel).append(noticeList);
    if (!inGame) subtitleNode.hidden = true;
    if (changed && isMenu) start.focus({ preventScroll: true });
    else if (changed && next === 'error') heading.focus({ preventScroll: true });
  }

  function setSettings(value = {}) {
    if (disposed) return;
    if (QUALITY_LEVELS.includes(value.quality)) quality.value = value.quality;
    if (['auto', 'touch', 'mouse'].includes(value.controls)) inputMode.value = value.controls;
    if (typeof value.volume === 'number' && Number.isFinite(value.volume)) updateVolume(value.volume);
  }
  setSettings(DEFAULT_SETTINGS);
  setState('loading');

  return {
    get state() { return state; },
    setState,
    setSettings,
    setInputMode(value) {
      touchMode = value === 'touch'; root.dataset.inputMode = value;
      bindings.replaceChildren();
      const rows = touchMode ? [
        ['Linker Stick', 'Bewegen'], ['Rechts ziehen', 'Umsehen'],
        ['Feuer halten', 'Schießen'], ['Zielen / Ducken', 'Ein- und ausschalten'],
        ['Tür / Licht', 'Aktion ausführen'], ['Mehr', 'Lehnen, Feuerart, Schleichen'],
      ] : STRINGS.controlsList;
      for (const [key, text] of rows) bindings.append(element('dt', '', key), element('dd', '', text));
      setState(state);
    },
    setProgress({ progress: value, label } = {}) {
      if (disposed) return;
      if (Number.isFinite(value)) {
        const normalized = Math.min(1, Math.max(0, value));
        progress.value = normalized;
        percent.textContent = `${Math.round(normalized * 100)} %`;
      } else {
        progress.removeAttribute('value');
        percent.textContent = '';
      }
      if (label !== undefined) loadLabel.textContent = String(label);
    },
    notice(id, text) {
      if (disposed) return;
      let node = notices.get(id);
      if (!node) {
        node = element('li');
        notices.set(id, node);
        noticeList.append(node);
      }
      node.textContent = String(text);
    },
    clearNotice(id) {
      notices.get(id)?.remove();
      notices.delete(id);
    },
    subtitle(text, ms = 4000) {
      if (disposed) return;
      win.clearTimeout(subtitleTimer);
      subtitleNode.textContent = text == null ? '' : String(text);
      subtitleNode.hidden = !subtitleNode.textContent;
      const duration = Number.isFinite(ms) ? Math.max(0, ms) : 4000;
      subtitleTimer = win.setTimeout(() => {
        subtitleNode.hidden = true;
        subtitleNode.textContent = '';
      }, duration);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      win.clearTimeout(subtitleTimer);
      cleanup.forEach(remove => remove());
      notices.clear();
      root.replaceChildren();
      delete root.dataset.state;
      delete root.dataset.inputMode;
    },
  };
}
