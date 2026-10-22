// Crownward – HUD: Münzbeutel, Krone, Ausdauer, Tagesband, Ziel und Kontexthinweis (je Spieler im Koop).
// Aktualisiert DOM nur bei Wertänderungen.

import { BALANCE } from '../sim';
import type { GameState, Offer, Player } from '../sim';
import { el, setText, show, toggleClass } from './dom';
import { describeOffer, hintText, vagrantHint, type HintView } from './hints';
import { clockText, t } from './i18n';
import { icon, type IconName } from './icons';

export interface HudView {
  coop: boolean;
  /** Tastenhinweis je Spieler („S halten", „↓ halten", „Münze halten") */
  holds: string[];
  /** Tastenhinweis für einen kurzen Druck je Spieler („S tippen" – Münze für Landstreicher) */
  taps: string[];
  /** Angebot in Reichweite je Spieler */
  focus: (Offer | null)[];
  /**
   * Einführungshinweis (Spielbeginn): ersetzt den leeren Kontexthinweis von Spieler 1 bzw. steht als eigene Zeile
   * unter einem Angebot – der Herrscher startet in Reichweite eines Ständers, die Steuerung muss trotzdem sichtbar sein.
   */
  intro: string | null;
  timeScale: number;
  touch: boolean;
}

class PlayerHud {
  readonly stat: HTMLElement;
  readonly hint: HTMLElement;
  private readonly count: HTMLElement;
  private readonly full: HTMLElement;
  private readonly crown: HTMLElement;
  private readonly stamina: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly hintLabel: HTMLElement;
  private readonly hintKey: HTMLElement;
  private readonly hintDetail: HTMLElement;
  private readonly hintPips: HTMLElement;
  /** Einführungszeile unter einem Angebot */
  private readonly hintIntro: HTMLElement;
  private lastCoins = -1;
  private lastPips = '';
  private staminaFullFor = 0;
  /** zuletzt angezeigter Hinweistext (Tests) */
  text = '';
  /** angezeigte Einführung (als Hinweis oder als Zusatzzeile; Tests) */
  introText = '';

  constructor(readonly index: number) {
    const p = `p${index + 1}`;
    this.count = el('span.purse-count', { text: '0' });
    this.full = el('span.purse-full', { text: t('hud.purseFull') });
    this.full.hidden = true;
    this.crown = el('span.crown', { html: icon('crown', 3), title: t('hud.crown') });
    this.staminaFill = el('i.stamina-fill');
    this.stamina = el('div.stamina', { title: t('hud.stamina') }, this.staminaFill);
    this.warn = el('div.pstat-warn', { text: t('hud.unprotected') });
    this.warn.hidden = true;
    this.stat = el(
      `div.pstat.${p}`,
      null,
      el('span.pstat-tag', { text: t('hud.player', { n: index + 1 }) }),
      el(
        'div.pstat-row',
        null,
        el('span.purse', { title: t('hud.coins') }, el('span.purse-icon', { html: icon('pouch', 3) }), this.count, this.full),
        this.crown,
      ),
      this.stamina,
      this.warn,
    );

    this.hintLabel = el('span.hint-label');
    this.hintKey = el('span.hint-key');
    this.hintDetail = el('span.hint-detail');
    this.hintPips = el('span.hint-pips');
    this.hintIntro = el('div.hint-intro');
    this.hintIntro.hidden = true;
    this.hint = el(
      `div.hint.${p}`,
      { role: 'status' },
      el('div.hint-line', null, this.hintLabel, this.hintKey),
      el('div.hint-line.hint-sub', null, this.hintPips, this.hintDetail),
      this.hintIntro,
    );
    this.hint.hidden = true;
  }

  reset(): void {
    this.lastCoins = -1;
    this.lastPips = '';
    this.text = '';
    this.introText = '';
    this.hint.hidden = true;
    this.hintIntro.hidden = true;
  }

  update(player: Player | undefined, state: GameState, view: HudView, dt: number): void {
    show(this.stat, !!player);
    if (!player) {
      this.hint.hidden = true;
      this.text = '';
      this.introText = '';
      return;
    }
    // Münzen (kurzes Aufleuchten bei Änderung)
    if (player.coins !== this.lastCoins) {
      if (this.lastCoins >= 0) {
        const cls = player.coins > this.lastCoins ? 'bump-up' : 'bump-down';
        this.count.classList.remove('bump-up', 'bump-down');
        void this.count.offsetWidth;
        this.count.classList.add(cls);
      }
      this.lastCoins = player.coins;
      setText(this.count, String(player.coins));
    }
    show(this.full, player.coins >= BALANCE.player.purseMax);

    // Krone und Warnung „ungeschützt"
    toggleClass(this.crown, 'lost', !player.hasCrown);
    // Nach Sieg/Niederlage keine Warnung mehr (die Welt läuft nur noch zur Darstellung weiter)
    const exposed =
      state.outcome === 'playing' && player.hasCrown && player.coins === 0 && (state.phase === 'dusk' || state.phase === 'night');
    toggleClass(this.crown, 'exposed', exposed);
    show(this.warn, exposed);

    // Ausdauer: nur sichtbar, solange nicht voll
    const st = Math.max(0, Math.min(1, player.stamina));
    this.staminaFullFor = st >= 0.995 && !player.exhausted ? this.staminaFullFor + dt : 0;
    toggleClass(this.stamina, 'idle', this.staminaFullFor > 1.2);
    toggleClass(this.stamina, 'exhausted', player.exhausted);
    const w = `${(st * 100).toFixed(1)}%`;
    if (this.staminaFill.style.width !== w) this.staminaFill.style.width = w;

    // Kontexthinweis: Angebot in Reichweite, sonst Landstreicher zum Anwerben, sonst Einführung
    const offer = view.focus[this.index] ?? null;
    const hv =
      describeOffer(offer, player, view.holds[this.index] ?? t('hint.hold.kb1'), state) ??
      vagrantHint(state, player, offer, view.taps[this.index] ?? t('hint.tap.kb1'));
    const intro = this.index === 0 ? view.intro : null;
    if (hv) this.renderHint(hv, intro);
    else if (intro) this.renderIntro(intro);
    else {
      this.hint.hidden = true;
      this.text = '';
      this.introText = '';
    }
  }

  private renderHint(v: HintView, intro: string | null): void {
    this.hint.hidden = false;
    this.hint.dataset.tone = v.tone;
    setText(this.hintLabel, v.label);
    setText(this.hintDetail, v.detail);
    setText(this.hintKey, v.key ?? '');
    show(this.hintKey, !!v.key);
    const pips = v.cost > 0 && v.cost <= 16 && v.tone !== 'blocked' ? `${v.paid}/${v.cost}` : '';
    if (pips !== this.lastPips) {
      this.lastPips = pips;
      this.hintPips.innerHTML = pips
        ? Array.from({ length: v.cost }, (_, i) => `<i class="pip${i < v.paid ? ' paid' : ''}"></i>`).join('')
        : '';
    }
    this.text = hintText(v);
    // Einführung bleibt als eigene Zeile sichtbar, solange sie gilt
    setText(this.hintIntro, intro ?? '');
    show(this.hintIntro, !!intro);
    this.introText = intro ?? '';
  }

  private renderIntro(text: string): void {
    this.hint.hidden = false;
    this.hint.dataset.tone = 'info';
    setText(this.hintLabel, text);
    setText(this.hintDetail, '');
    show(this.hintKey, false);
    show(this.hintIntro, false);
    this.introText = text;
    if (this.lastPips) {
      this.lastPips = '';
      this.hintPips.innerHTML = '';
    }
    this.text = text;
  }
}

const PHASE_ICON: Record<GameState['phase'], IconName> = { day: 'sun', dusk: 'dusk', night: 'moon', dawn: 'dawn' };

export class Hud {
  readonly root: HTMLElement;
  readonly players: PlayerHud[];
  private readonly dayIcon: HTMLElement;
  private readonly dayLabel: HTMLElement;
  private readonly dayInfo: HTMLElement;
  private readonly dayMarker: HTMLElement;
  private readonly daybar: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objectiveText: HTMLElement;
  private readonly timeScale: HTMLElement;
  readonly pauseButton: HTMLButtonElement;
  readonly toastSlot: HTMLElement;
  private lastPhase = '';
  private lastMarker = '';

  constructor(onPause: () => void) {
    this.players = [new PlayerHud(0), new PlayerHud(1)];

    const c = BALANCE.cycle;
    const seg = (cls: string, a: number, b: number) =>
      el(`i.seg.seg-${cls}`, { style: `flex-grow:${((b - a) / c.length).toFixed(4)}` });
    this.dayIcon = el('span.daybar-icon');
    this.dayLabel = el('span.daybar-day');
    this.dayInfo = el('span.daybar-info');
    this.dayMarker = el('b.daybar-marker');
    this.daybar = el(
      'div.daybar',
      null,
      el('div.daybar-head', null, this.dayIcon, this.dayLabel, el('span.daybar-sep', { text: '·' }), this.dayInfo),
      el(
        'div.daybar-track',
        null,
        seg('day', 0, c.dayEnd),
        seg('dusk', c.dayEnd, c.duskEnd),
        seg('night', c.duskEnd, c.nightEnd),
        seg('dawn', c.nightEnd, c.length),
        this.dayMarker,
      ),
    );

    this.objectiveText = el('span');
    this.objective = el('div.chip.objective', { title: t('hud.objectiveTitle') }, el('span.chip-icon', { html: icon('anchor', 2) }), this.objectiveText);
    this.timeScale = el('div.chip.timescale');
    this.timeScale.hidden = true;
    this.pauseButton = el('button.hud-pause', { type: 'button', 'aria-label': t('hud.pause'), title: `${t('hud.pause')} (Esc)`, html: icon('pause', 2) });
    this.pauseButton.addEventListener('click', () => onPause());

    this.toastSlot = el('div.toast-slot');
    this.root = el(
      'div.hud',
      null,
      el('div.hud-bar', null, this.players[0].stat, this.daybar, el('div.hud-right', null, this.timeScale, this.objective, this.pauseButton)),
      this.players[1].stat,
      this.players[0].hint,
      this.players[1].hint,
      this.toastSlot,
    );
  }

  reset(): void {
    for (const p of this.players) p.reset();
    this.lastPhase = '';
    this.lastMarker = '';
  }

  update(state: GameState, view: HudView, dt: number): void {
    toggleClass(this.root, 'coop', view.coop);
    toggleClass(this.root, 'touch-mode', view.touch);
    this.players[0].update(state.players[0], state, view, dt);
    this.players[1].update(view.coop ? state.players[1] : undefined, state, view, dt);
    this.updateDaybar(state);

    const ship = state.structures.find((s) => s.kind === 'ship');
    const lvl = ship ? ship.level : 0;
    setText(this.objectiveText, lvl >= 3 ? t('hud.objectiveReady') : t('hud.objective', { n: lvl }));
    toggleClass(this.objective, 'ready', lvl >= 3);

    show(this.timeScale, view.timeScale !== 1);
    if (view.timeScale !== 1) setText(this.timeScale, t('hud.timeScale', { n: view.timeScale }));
  }

  private updateDaybar(state: GameState): void {
    const c = BALANCE.cycle;
    const phase = state.phase;
    const pale = BALANCE.waves.paleMoonEvery > 0 && state.day % BALANCE.waves.paleMoonEvery === 0;
    const phaseKey = `${phase}:${pale}`;
    if (phaseKey !== this.lastPhase) {
      this.lastPhase = phaseKey;
      this.dayIcon.innerHTML = icon(PHASE_ICON[phase]);
      this.daybar.dataset.phase = phase;
      toggleClass(this.daybar, 'pale', pale);
    }
    const isNight = phase === 'night';
    setText(this.dayLabel, isNight ? t('hud.night', { n: state.day }) : t('hud.day', { n: state.day }));
    let info: string;
    if (phase === 'day' || phase === 'dusk') {
      const left = c.duskEnd - state.dayTime;
      info = left > 0.5 ? t('hud.untilNight', { t: clockText(left) }) : t('hud.nightFalls');
      if (pale && phase === 'dusk') info = `${t('hud.paleMoon')} · ${info}`;
    } else if (isNight) {
      info = t('hud.untilDawn', { t: clockText(c.nightEnd - state.dayTime) });
      if (pale) info = `${t('hud.paleMoon')} · ${info}`;
    } else {
      info = t('hud.dawn');
    }
    setText(this.dayInfo, info);
    const pos = `${((Math.max(0, Math.min(c.length, state.dayTime)) / c.length) * 100).toFixed(1)}%`;
    if (pos !== this.lastMarker) {
      this.lastMarker = pos;
      this.dayMarker.style.left = pos;
    }
  }

  /** aktueller Hinweistext je Spieler (Tests/Debug) */
  hintTexts(): string[] {
    return this.players.map((p) => p.text);
  }

  /** aktuell sichtbare Einführung (Spieler 1; leer, wenn keine) – Tests/Debug */
  introText(): string {
    return this.players[0].introText;
  }
}
