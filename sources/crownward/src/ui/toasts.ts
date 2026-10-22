// Crownward – kurze Hinweise (Toasts) und große Ankündigungen (Banner), gedrosselt und gebündelt.

import { el } from './dom';

export type ToastKind = 'info' | 'good' | 'warn' | 'danger' | 'muted';

export interface ToastOptions {
  kind?: ToastKind;
  /** Bündelschlüssel: gleiche Schlüssel zählen hoch statt zu stapeln */
  key?: string;
  /** Mindestabstand in Sekunden, bevor derselbe Schlüssel erneut erscheinen darf */
  throttle?: number;
  /** Anzeigedauer in Sekunden */
  duration?: number;
}

interface Item {
  key: string;
  text: string;
  count: number;
  node: HTMLElement;
  textNode: HTMLElement;
  countNode: HTMLElement;
  age: number;
  duration: number;
}

const MAX_VISIBLE = 3;
const FADE = 0.45;

export class Toasts {
  readonly root: HTMLElement;
  readonly bannerRoot: HTMLElement;
  private items: Item[] = [];
  private lastShown = new Map<string, number>();
  private clock = 0;
  private bannerTitle: HTMLElement;
  private bannerSub: HTMLElement;
  private bannerAge = Infinity;
  private bannerDuration = 3.4;
  private bannerKind: 'day' | 'night' | 'danger' | 'good' = 'day';
  /** Verlauf für Tests/Debug */
  readonly history: { text: string; kind: ToastKind; at: number }[] = [];

  constructor() {
    this.root = el('div.toasts', { 'aria-live': 'polite', role: 'status' });
    this.bannerTitle = el('div.banner-title');
    this.bannerSub = el('div.banner-sub');
    this.bannerRoot = el('div.banner', { 'aria-live': 'assertive' }, this.bannerTitle, this.bannerSub);
  }

  push(text: string, opts: ToastOptions = {}): void {
    const key = opts.key ?? text;
    const kind = opts.kind ?? 'info';
    const existing = this.items.find((i) => i.key === key && i.age < i.duration - FADE);
    if (existing) {
      existing.count++;
      existing.text = text;
      existing.textNode.textContent = text;
      existing.countNode.textContent = `×${existing.count}`;
      existing.countNode.hidden = false;
      existing.age = Math.min(existing.age, 0.3);
      existing.node.classList.remove('bump');
      void existing.node.offsetWidth; // Animation neu starten
      existing.node.classList.add('bump');
      this.lastShown.set(key, this.clock);
      return;
    }
    const last = this.lastShown.get(key);
    if (opts.throttle && last !== undefined && this.clock - last < opts.throttle) return;
    this.lastShown.set(key, this.clock);

    const textNode = el('span.toast-text', { text });
    const countNode = el('span.toast-count');
    countNode.hidden = true;
    const node = el(`div.toast.toast-${kind}`, null, textNode, countNode);
    this.root.prepend(node);
    this.items.unshift({ key, text, count: 1, node, textNode, countNode, age: 0, duration: opts.duration ?? 3.8 });
    this.history.push({ text, kind, at: this.clock });
    if (this.history.length > 200) this.history.shift();
    while (this.items.length > MAX_VISIBLE) this.items.pop()!.node.remove();
  }

  /** Große, zentrierte Ankündigung (z. B. „Nacht 2 beginnt"). Ersetzt eine laufende. */
  banner(title: string, sub = '', kind: 'day' | 'night' | 'danger' | 'good' = 'day', duration = 3.4): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerSub.hidden = !sub;
    this.bannerKind = kind;
    this.bannerRoot.className = `banner banner-${kind}`;
    void this.bannerRoot.offsetWidth;
    this.bannerRoot.classList.add('show');
    this.bannerAge = 0;
    this.bannerDuration = duration;
    this.history.push({ text: sub ? `${title} – ${sub}` : title, kind: kind === 'danger' ? 'danger' : 'info', at: this.clock });
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age >= it.duration) {
        it.node.remove();
        this.items.splice(i, 1);
      } else if (it.age >= it.duration - FADE) {
        it.node.classList.add('leaving');
      }
    }
    if (this.bannerAge < Infinity) {
      this.bannerAge += dt;
      if (this.bannerAge >= this.bannerDuration) {
        this.bannerRoot.classList.remove('show');
        this.bannerAge = Infinity;
      }
    }
  }

  /** Laufende große Ankündigung ausblenden; instant = ohne Ausblendübergang (z. B. vor dem Endbildschirm). */
  hideBanner(instant = false): void {
    // .instant schaltet den Übergang ab; banner() setzt className neu und hebt das wieder auf
    this.bannerRoot.classList.toggle('instant', instant);
    this.bannerRoot.classList.remove('show');
    this.bannerAge = Infinity;
  }

  /** Tageszeit-Banner („Nacht 2 beginnt") ausblenden, sobald die Phase vorbei ist (z. B. im Zeitraffer). */
  hidePhaseBanner(): void {
    if (this.bannerAge < Infinity && (this.bannerKind === 'day' || this.bannerKind === 'night')) this.hideBanner();
  }

  clear(instant = false): void {
    for (const it of this.items) it.node.remove();
    this.items = [];
    this.lastShown.clear();
    this.hideBanner(instant);
  }

  /** aktuell sichtbare Texte (Tests) */
  visibleTexts(): string[] {
    return this.items.map((i) => (i.count > 1 ? `${i.text} ×${i.count}` : i.text));
  }
}
