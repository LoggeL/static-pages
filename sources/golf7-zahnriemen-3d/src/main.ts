/// <reference types="vite/client" />
import './style.css';
import { isAtOT, parts, wrapDistance } from './drive';
import type { PartId, View, VisualState } from './drive';
import { Exercise } from './exercise';
import { WorkshopViewer } from './viewer';
import type { Pick, Viewer } from './viewer';
import { Schematic } from './schematic';

const icons: Record<string, string> = {
  belt: '<path d="M4.2 10.3 12.8 4a5 5 0 0 1 6.9 7.1l-6.5 8.2A6.4 6.4 0 0 1 4.2 10.3Z"/><circle cx="8.3" cy="15" r="2.8"/><circle cx="16.2" cy="7.8" r="1.8"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>',
  tool: '<path d="m15.5 6.5 3 3 3.2-3.2a6 6 0 0 1-7.6 7.7l-6.6 6.6a2.5 2.5 0 0 1-3.6-3.5l6.7-6.6a6 6 0 0 1 7.5-7.5z"/>',
  'arrow-left': '<path d="M19 12H5m6-6-6 6 6 6"/>',
  trace: '<path d="m2 16 5-5 4 3 7-9m-3 0h4v4"/>',
  hood: '<path d="M3 16h18v2H3zM4 16l3-7h10l3 7M8 9l4-4 4 4"/>',
  orbit:
    '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="2.5"/>',
  gear: '<circle cx="12" cy="12" r="7.4" stroke-dasharray="2.9 1.6"/><circle cx="12" cy="12" r="4.1"/><circle cx="12" cy="12" r=".9"/>',
  roller: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.4"/><path d="M11 12h2"/>',
  play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke-width="1"/>',
  pause: '<path d="M8 5v14m8-14v14" stroke-width="3.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
function icon(name: string) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    icons[name] +
    '</svg>'
  );
}
for (const el of document.querySelectorAll<HTMLElement>('[data-icon]'))
  el.innerHTML = icon(el.dataset.icon!);

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = get('viewport'),
  stageEl = document.querySelector<HTMLElement>('.stage')!;
const callout = get('callout'),
  panel = get('panel'),
  feedback = get('feedback');
const cycle = get<HTMLInputElement>('cycle'),
  play = get<HTMLButtonElement>('play');
const hoodBtn = get<HTMLButtonElement>('hood-toggle');
const modes = { explore: get('explore'), practice: get('practice') };
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

let mode: keyof typeof modes = 'explore';
let view: View = 'perspective';
let neon = true,
  hoodOpen = false,
  changed = true,
  fallback = false;
let playing = !motion.matches,
  angle = 0,
  selected: PartId = 'belt';
let exercise = new Exercise();
let viewer: Viewer;

const visual = (): VisualState =>
  mode === 'practice'
    ? { ...exercise.visual, neon }
    : {
        angle,
        selected,
        neon,
        cover: false,
        belt: true,
        routing: 0,
        routingActive: false,
        locks: [],
        tension: 0.5,
        otAligned: isAtOT(angle, 4),
      };

function useSchematic() {
  fallback = true;
  stage.querySelector('canvas')?.remove();
  viewer = new Schematic(stage, pick);
  stage.setAttribute('aria-label', 'Interaktives Schema des EA288-Zahnriementriebs');
  get('view-name').textContent = '2D-Schema';
  get('gesture').hidden = true;
  hoodBtn.hidden = true;
  get('neon').hidden = false;
  stageEl.classList.remove('is-car');
  buttons.forEach((b) => {
    b.hidden = true;
  });
  buttons[0].parentElement!.hidden = true;
  callout.hidden = true;
  changed = true;
}

try {
  viewer = new WorkshopViewer(stage, callout, pick, (text) => {
    feedback.textContent = text;
  });
  stage.querySelector('canvas')!.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    useSchematic();
  });
} catch {
  useSchematic();
}

function partIcon(id: PartId) {
  if (id === 'belt') return 'belt';
  return ['cam', 'crank', 'pump'].includes(id) ? 'gear' : 'roller';
}

function showPanel() {
  const active = document.activeElement as HTMLElement | null;
  const restore = active && panel.contains(active) ? active : null;
  if (mode === 'practice') {
    panel.innerHTML = exercise.panel();
    feedback.textContent = exercise.message;
  } else {
    const part = parts.find((p) => p.id === selected)!;
    panel.innerHTML =
      '<h2 tabindex="-1">Bauteile</h2><div class="part-list" role="group" aria-label="Bauteil auswählen">' +
      parts
        .map(
          (p) =>
            '<button class="part-row" data-part="' +
            p.id +
            '" aria-pressed="' +
            (p.id === selected) +
            '"><span class="symbol">' +
            icon(partIcon(p.id)) +
            '</span>' +
            p.name +
            '<span class="arrow" aria-hidden="true">' +
            (p.id === selected ? '●' : '›') +
            '</span></button>',
        )
        .join('') +
      '</div>' +
      '<section class="part-detail" aria-live="polite"><p class="detail-kind"><span class="detail-icon">' +
      icon('box') +
      '</span>Im Modell</p><h3>' +
      part.name +
      '</h3><p class="detail-text">' +
      part.detail +
      '</p></section>';
    feedback.textContent = '';
  }
  if (restore) {
    let next: HTMLElement | null = null;
    if (restore.dataset.part)
      next = panel.querySelector('[data-part="' + restore.dataset.part + '"]');
    if (restore.dataset.pick)
      next = panel.querySelector('[data-pick="' + restore.dataset.pick + '"]:not(:disabled)');
    if (restore.id) next = panel.querySelector('#' + restore.id + ':not(:disabled)');
    (next ?? panel.querySelector<HTMLElement>('h2'))?.focus({ preventScroll: true });
  }
  const id = mode === 'explore' ? selected : exercise.selected;
  callout.firstElementChild!.textContent = parts.find((p) => p.id === id)?.name ?? '';
  changed = true;
  updateTransport();
}

function syncHoodButton() {
  hoodBtn.hidden = fallback || view !== 'car';
  hoodBtn.setAttribute('aria-pressed', String(hoodOpen));
  const label = hoodBtn.querySelector('.hood-label');
  if (label) label.textContent = hoodOpen ? 'Motorhaube schließen' : 'Motorhaube öffnen';
}

function applyView(next: View) {
  if (fallback) return;
  view = next;
  if (view === 'car') {
    // Always present the blue Golf VII cleanly with closed hood first when entering Fahrzeug view
    hoodOpen = false;
    viewer.setHoodOpen(false);
  }
  viewer.setView(view);
  stage.setAttribute(
    'aria-label',
    view === 'car'
      ? 'Drehbarer blauer Golf VII mit beweglicher Motorhaube'
      : 'Drehbares 3D-Modell des EA288 mit Zahnriemen und Rädern',
  );
  get('neon').hidden = view === 'car';
  const url = new URL(location.href);
  if (view === 'car' || url.hash === '#fahrzeug') {
    url.hash = view === 'car' ? 'fahrzeug' : '';
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  }
  stageEl.classList.toggle('is-car', view === 'car');
  buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  get('view-name').textContent =
    view === 'car' ? 'Golf VII · Fahrzeug' : view === 'front' ? 'Stirnseite' : '3D-Modell';
  syncHoodButton();
  changed = true;
}

function pick(id: Pick) {
  if (mode === 'practice') exercise.pick(id);
  else if (id !== 'cover') selected = id;
  if (view === 'car') applyView('perspective');
  showPanel();
}

function changeMode(next: keyof typeof modes) {
  mode = next;
  for (const [name, el] of Object.entries(modes))
    el.setAttribute('aria-pressed', String(next === name));
  if (mode === 'practice' && view === 'car') applyView('perspective');
  showPanel();
}

function togglePlay() {
  if (mode !== 'explore') return;
  playing = !playing;
  updateTransport();
}

function updateTransport() {
  const on = mode === 'explore' && playing;
  play.disabled = mode !== 'explore';
  play.innerHTML = icon(on ? 'pause' : 'play');
  play.setAttribute('aria-label', on ? 'Animation pausieren' : 'Animation starten');
  play.title = play.getAttribute('aria-label')!;
  cycle.disabled = mode === 'practice';
  get('cycle-label').textContent = mode === 'explore' ? 'Viertaktzyklus' : 'Modellübung';
  updateReadout();
}

function updateRange(el: HTMLInputElement) {
  el.style.setProperty(
    '--progress',
    ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100 + '%',
  );
}

function updateReadout() {
  const a = mode === 'practice' ? exercise.angle : angle;
  const deg = a > 0 && a % 720 === 0 ? 720 : wrapDistance(a, 720);
  const crank = Math.round(deg) + '°',
    cam = Math.round(deg / 2) + '°';
  if (get('crank-angle').textContent !== crank) get('crank-angle').textContent = crank;
  if (get('cam-angle').textContent !== cam) get('cam-angle').textContent = cam;
  cycle.value = String(Math.round(deg));
  updateRange(cycle);
  if (mode === 'practice') {
    for (const el of panel.querySelectorAll<HTMLInputElement>('input[type=range]')) updateRange(el);
  }
}

modes.explore.addEventListener('click', () => changeMode('explore'));
modes.practice.addEventListener('click', () => changeMode('practice'));

get('neon').addEventListener('click', () => {
  neon = !neon;
  get('neon').setAttribute('aria-pressed', String(neon));
  changed = true;
});

hoodBtn.addEventListener('click', () => {
  hoodOpen = !hoodOpen;
  viewer.setHoodOpen(hoodOpen);
  syncHoodButton();
  changed = true;
});

buttons.forEach((b) => b.addEventListener('click', () => applyView(b.dataset.view as View)));
play.addEventListener('click', togglePlay);
cycle.addEventListener('input', () => {
  playing = false;
  angle = Number(cycle.value);
  changed = true;
  updateTransport();
});

panel.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!el || el.disabled) return;
  if (el.dataset.part || el.dataset.pick) {
    pick((el.dataset.part ?? el.dataset.pick) as Pick);
    return;
  }
  if (el.id === 'advance') exercise.action();
  if (el.id === 'again') exercise = new Exercise();
  showPanel();
});

panel.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'ot') {
    exercise.angle = Number(el.value);
    const valEl = document.getElementById('ot-value');
    if (valEl) valEl.textContent = el.value + '°';
    const stEl = document.getElementById('ot-status');
    if (stEl) {
      const ok = isAtOT(exercise.angle, 4);
      stEl.textContent = ok ? 'OT erreicht' : 'Ausrichten';
      stEl.classList.toggle('ok', ok);
    }
  }
  if (el.id === 'tension') {
    exercise.tension = Number(el.value) / 100;
    const stEl = document.getElementById('tension-status');
    if (stEl) {
      const ok = Math.abs(exercise.tension - 0.5) <= 0.04;
      stEl.textContent = ok
        ? 'Im Referenzfenster'
        : exercise.tension < 0.5
          ? 'Zu locker'
          : 'Zu stramm';
      stEl.classList.toggle('ok', ok);
    }
  }
  exercise.message = '';
  feedback.textContent = '';
  updateRange(el);
  updateReadout();
  changed = true;
});

motion.addEventListener('change', (e) => {
  if (e.matches) {
    playing = false;
    updateTransport();
  }
});
syncHoodButton();
if (location.hash === '#fahrzeug') applyView('car');
window.addEventListener('hashchange', () =>
  applyView(location.hash === '#fahrzeug' ? 'car' : 'perspective'),
);
showPanel();

let previous = performance.now();
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, 0.15);
  previous = now;
  if (!document.hidden) {
    if (mode === 'explore' && playing) {
      angle += dt * 50;
      changed = true;
    }
    if (mode === 'practice' && exercise.checking) {
      exercise.advanceCheck(dt, motion.matches);
      if (exercise.complete) showPanel();
      changed = true;
    }
    if (changed) updateReadout();
    viewer.draw(visual(), changed, dt);
    changed = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
