// Crownward – Touch-Steuerung (Pointer Events, mehrere Finger gleichzeitig, Gleiten zwischen Tasten).
// Die Tasten sind <div role="button"> statt <button>, damit sie keinen Tastaturfokus stehlen.

import type { PlayerInput } from '../sim';
import { icon } from '../ui/icons';
import type { Emit } from './types';

type HoldButton = 'left' | 'right' | 'sprint' | 'act';
type TouchButton = HoldButton | 'pause';

const HOLD: readonly HoldButton[] = ['left', 'right', 'sprint', 'act'];

export class TouchControls {
  readonly root: HTMLElement;
  private readonly buttons = new Map<TouchButton, HTMLElement>();
  /** pointerId → gedrückte Taste */
  private readonly pointers = new Map<number, HoldButton>();
  /** seit dem letzten Simulationsschritt angetippte Tasten (kurzer Tipp zählt mindestens einen Schritt) */
  private readonly latched = new Set<HoldButton>();
  private visible = false;

  constructor(
    private readonly emit: Emit,
    /** jede Berührung (Gerätewechsel → Touch) */
    private readonly onTouch: () => void,
  ) {
    const root = document.createElement('div');
    root.className = 'touch';
    root.hidden = true;
    root.setAttribute('aria-label', 'Touch-Steuerung');
    const mk = (name: TouchButton, cls: string, label: string, inner: string) => {
      const b = document.createElement('div');
      b.className = `tbtn tbtn-${name} ${cls}`;
      b.dataset.btn = name;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', label);
      b.innerHTML = inner;
      this.buttons.set(name, b);
      return b;
    };
    const move = document.createElement('div');
    move.className = 'touch-cluster touch-move';
    move.append(
      mk('left', 'tbtn-dir', 'Nach links reiten', icon('left', 4)),
      mk('right', 'tbtn-dir', 'Nach rechts reiten', icon('right', 4)),
    );
    const act = document.createElement('div');
    act.className = 'touch-cluster touch-act';
    act.append(
      mk('sprint', 'tbtn-sprint', 'Sprinten', `${icon('sprint', 3)}<span class="tbtn-label">Sprint</span>`),
      mk('act', 'tbtn-coin', 'Münze (halten zum Bezahlen)', `${icon('coin', 4)}<span class="tbtn-label">Münze</span>`),
    );
    const pause = mk('pause', 'tbtn-pause', 'Pause', icon('pause', 3));
    root.append(move, act, pause);
    this.root = root;

    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('lostpointercapture', this.onUp);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.hidden = !v;
    if (!v) this.release();
  }

  /** Alle Finger lösen (z. B. beim Pausieren). */
  release(): void {
    this.pointers.clear();
    this.latched.clear();
    this.refreshPressed();
  }

  /** Nach jedem Simulationsschritt: kurze Tipps sind verbraucht. */
  endStep(): void {
    if (this.latched.size) this.latched.clear();
  }

  input(): PlayerInput {
    const held = new Set([...this.pointers.values(), ...this.latched]);
    return { left: held.has('left'), right: held.has('right'), sprint: held.has('sprint'), act: held.has('act') };
  }

  private buttonAt(x: number, y: number): TouchButton | null {
    const hit = document.elementFromPoint(x, y);
    const b = hit instanceof Element ? hit.closest<HTMLElement>('[data-btn]') : null;
    if (!b || !this.root.contains(b)) return null;
    return b.dataset.btn as TouchButton;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.onTouch();
    const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-btn]')?.dataset.btn as TouchButton | undefined;
    if (!btn) return;
    if (btn === 'pause') {
      this.flash('pause');
      this.emit('pause');
      return;
    }
    this.pointers.set(e.pointerId, btn);
    this.latched.add(btn);
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger bereits weg */
    }
    this.refreshPressed();
  };

  private onMove = (e: PointerEvent): void => {
    const cur = this.pointers.get(e.pointerId);
    if (!cur) return;
    // Gleiten: Finger darf von ◀ nach ▶ bzw. Sprint ↔ Münze wandern
    const now = this.buttonAt(e.clientX, e.clientY);
    if (now && now !== 'pause' && now !== cur && HOLD.includes(now)) {
      this.pointers.set(e.pointerId, now);
      this.refreshPressed();
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.pointers.delete(e.pointerId)) this.refreshPressed();
  };

  private refreshPressed(): void {
    const held = new Set(this.pointers.values());
    for (const name of HOLD) this.buttons.get(name)?.classList.toggle('pressed', held.has(name));
  }

  private flash(name: TouchButton): void {
    const b = this.buttons.get(name);
    if (!b) return;
    b.classList.add('pressed');
    window.setTimeout(() => b.classList.remove('pressed'), 140);
  }
}
