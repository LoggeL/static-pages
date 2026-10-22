// Crownward – modale Overlays: Hilfe/Steuerung und Einstellungen.

import type { Settings } from '../app/storage';
import { el, setText } from './dom';
import { t } from './i18n';
import { menuButton } from './screens';

const kbd = (...keys: string[]) => el('span.keys', null, ...keys.map((k) => el('kbd', { text: k })));
/** Tastengruppen: [['A','D'], ['←','→']] → „A D oder ← →" */
const keyGroups = (...groups: string[][]) => {
  const cell = el('span.keygroups');
  groups.forEach((g, i) => {
    if (i > 0) cell.append(el('span.keys-or', { text: ` ${t('help.or')} ` }));
    cell.append(kbd(...g));
  });
  return cell;
};
const row = (label: string, ...cells: HTMLElement[]) => el('tr', null, el('th', { text: label }), ...cells.map((c) => el('td', null, c)));

export class HelpOverlay {
  readonly root: HTMLElement;
  readonly scroller: HTMLElement;

  constructor(onClose: () => void) {
    const close = menuButton(t('help.close'), { act: 'close', kbd: 'Esc', primary: true });
    close.addEventListener('click', () => onClose());

    const goal = el(
      'div.help-col',
      null,
      el('h3', { text: t('help.goalTitle') }),
      el('p.help-goal', { text: t('help.goal') }),
      el('p.help-text', { text: t('help.goalDetail') }),
      el('h3', { text: t('help.tipsTitle') }),
      el('ul.help-tips', null, ...['help.tip1', 'help.tip2', 'help.tip3', 'help.tip4', 'help.tip5', 'help.tip6'].map((k) => el('li', { text: t(k) }))),
    );

    const solo = el(
      'table.keytable',
      null,
      el('caption', { text: t('help.solo') }),
      el(
        'tbody',
        null,
        row(t('help.ride'), keyGroups(['A', 'D'], ['←', '→'])),
        row(t('help.sprint'), keyGroups(['Shift'])),
        row(t('help.pay'), keyGroups(['S'], ['↓'])),
        row(t('help.drop'), keyGroups(['S'], ['↓'])),
      ),
    );
    const coop = el(
      'table.keytable.keytable-coop',
      null,
      el('caption', { text: t('help.coop') }),
      el('thead', null, el('tr', null, el('th'), el('th', { text: t('help.p1') }), el('th', { text: t('help.p2') }))),
      el(
        'tbody',
        null,
        row(t('help.ride'), kbd('A', 'D'), kbd('←', '→')),
        row(t('help.sprint'), kbd('Shift links'), kbd('Shift rechts')),
        row(t('help.pay'), kbd('S'), kbd('↓')),
      ),
    );
    const general = el(
      'table.keytable',
      null,
      el('caption', { text: t('help.general') }),
      el(
        'tbody',
        null,
        row(t('help.pause'), keyGroups(['Esc'], ['P'])),
        row(t('help.helpKey'), keyGroups(['H'], ['F1'])),
        row(t('help.mute'), kbd('M')),
        row(t('help.quicksave'), kbd('F5')),
        row(t('help.quickload'), kbd('F9')),
      ),
    );
    const keys = el(
      'div.help-col',
      null,
      solo,
      coop,
      general,
      el('h3', { text: t('help.touch') }),
      el('p.help-text', { text: t('help.touchText') }),
      el('h3', { text: t('help.gamepad') }),
      el('p.help-text', { text: t('help.gamepadText') }),
    );

    this.scroller = el('div.help-grid', { tabindex: '-1' }, goal, keys);
    this.root = el(
      'section.overlay.overlay-help',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('help.title') },
      el('div.panel.panel-wide', null, el('h2.panel-title', { text: t('help.title') }), this.scroller, el('div.menu.menu-row', null, close)),
    );
  }

  /** Pfeiltasten/Steuerkreuz scrollen den Inhalt. */
  scroll(dir: number): void {
    this.scroller.scrollBy({ top: dir * 90, behavior: 'smooth' });
  }
}

export interface SettingsHandlers {
  change(s: Settings): void;
  close(): void;
  fullscreen(): void;
}

export class SettingsOverlay {
  readonly root: HTMLElement;
  private current: Settings;
  private readonly sliders: Record<'master' | 'music' | 'sfx', { input: HTMLInputElement; value: HTMLElement }>;
  private readonly muted: HTMLInputElement;
  private readonly forceTouch: HTMLInputElement;

  constructor(initial: Settings, private readonly h: SettingsHandlers) {
    this.current = { ...initial };
    const mkSlider = (key: 'master' | 'music' | 'sfx', label: string) => {
      const id = `set-${key}`;
      const input = el('input.slider', { id, type: 'range', min: 0, max: 100, step: 5 });
      const value = el('output.slider-value', { for: id });
      input.addEventListener('input', () => {
        this.current[key] = Number(input.value) / 100;
        setText(value, `${input.value} %`);
        this.emit();
      });
      const wrap = el('div.setting', null, el('label', { for: id, text: label }), input, value);
      return { input, value, wrap };
    };
    const master = mkSlider('master', t('settings.master'));
    const music = mkSlider('music', t('settings.music'));
    const sfx = mkSlider('sfx', t('settings.sfx'));
    this.sliders = { master, music, sfx };

    const mkCheck = (key: 'muted' | 'forceTouch', label: string) => {
      const id = `set-${key}`;
      const input = el('input.check', { id, type: 'checkbox' });
      input.addEventListener('change', () => {
        this.current[key] = input.checked;
        this.emit();
      });
      return { input, wrap: el('div.setting.setting-check', null, input, el('label', { for: id, text: label })) };
    };
    const muted = mkCheck('muted', t('settings.muted'));
    const touch = mkCheck('forceTouch', t('settings.forceTouch'));
    this.muted = muted.input;
    this.forceTouch = touch.input;

    const back = menuButton(t('menu.back'), { act: 'close', kbd: 'Esc', primary: true });
    back.addEventListener('click', () => h.close());
    const fs = menuButton(t('settings.fullscreen'), { act: 'fullscreen' });
    fs.addEventListener('click', () => h.fullscreen());
    fs.hidden = !document.fullscreenEnabled;

    this.root = el(
      'section.overlay.overlay-settings',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title') },
      el(
        'div.panel',
        null,
        el('h2.panel-title', { text: t('settings.title') }),
        el('div.settings', null, master.wrap, music.wrap, sfx.wrap, muted.wrap, touch.wrap),
        el('p.panel-note', { text: t('settings.note') }),
        el('div.menu', null, back, fs),
      ),
    );
    this.set(initial);
  }

  set(s: Settings): void {
    this.current = { ...s };
    for (const key of ['master', 'music', 'sfx'] as const) {
      const v = String(Math.round(s[key] * 100));
      this.sliders[key].input.value = v;
      setText(this.sliders[key].value, `${v} %`);
    }
    this.muted.checked = s.muted;
    this.forceTouch.checked = s.forceTouch;
  }

  /** Steuerkreuz links/rechts auf einem Schieberegler */
  nudge(input: HTMLInputElement, dir: number): void {
    const v = Math.max(0, Math.min(100, Number(input.value) + dir * 5));
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private emit(): void {
    this.h.change({ ...this.current });
  }
}
