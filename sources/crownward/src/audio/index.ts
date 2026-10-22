// Crownward – WebAudio-Engine (Eigentum: audio). Alles synthetisiert, keine Samples, keine Downloads.
// Regeln: Kein AudioContext vor unlock() (Nutzergeste). Stumm = exakt 0. Ohne WebAudio still und fehlerfrei.
// Fehler im Audio dürfen nie das Spiel stören: alle öffentlichen Methoden fangen Ausnahmen ab.

import type { AudioEngine, AudioSettings, UiSound } from './types';
import type { GameState, SimEvent } from '../sim';
import { Ambience } from './ambience';
import { mapEvent, uiCue, type SoundCue } from './cues';
import { mulberry32, type Rng } from './dsp';
import { DEFAULT_SETTINGS, Mixer, busLevels, sanitizeSettings } from './mixer';
import { computeMood } from './mood';
import { MusicLayers } from './music';
import { playSfx } from './sfx';
import { listenerXs, spatialize } from './spatial';
import { createSynthKit, type SynthKit } from './synth';
import { PENTA, RateLimiter, budgetDecision, comboStep, type ActiveVoice, type Priority } from './throttle';

export type { AudioEngine, AudioSettings, UiSound } from './types';

/** Effektstimmen: bis SOFT frei, darüber nur wichtige, über HARD wird verdrängt. */
export const SOFT_VOICES = 24;
export const HARD_VOICES = 34;
/** höchstens so viele neue unwichtige Klänge pro handleEvents-Aufruf */
const MAX_NEW_PER_BATCH = 10;
/** Grundpegel der Effektstimmen */
const SFX_LEVEL = 0.9;

export interface AudioOptions {
  /** erzeugt den AudioContext (Standard: window.AudioContext / webkitAudioContext); null = kein WebAudio */
  contextFactory?: () => AudioContext | null;
  /** Zufallsquelle (Standard: mulberry32 mit zufälligem Startwert) */
  random?: Rng;
}

interface SfxVoice extends ActiveVoice {
  end: number;
  nodes: AudioNode[];
  gain: GainNode;
  dying: boolean;
}

export interface AudioStats {
  unlocked: boolean;
  state: string;
  sfxVoices: number;
  musicVoices: number;
  ambientVoices: number;
  played: number;
  dropped: number;
  throttled: number;
  inaudible: number;
  faults: number;
  mood: string;
}

function defaultFactory(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) return null;
  try {
    return new C({ latencyHint: 'interactive' });
  } catch {
    try {
      return new C();
    } catch {
      return null;
    }
  }
}

export class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private settings: AudioSettings = { ...DEFAULT_SETTINGS };
  private mixer: Mixer | null = null;
  private kit: SynthKit | null = null;
  private music: MusicLayers | null = null;
  private ambience: Ambience | null = null;
  private readonly limiter = new RateLimiter();
  private voices: SfxVoice[] = [];
  private readonly factory: () => AudioContext | null;
  private readonly rnd: Rng;
  private disabled = false;
  private faults = 0;
  private warned = false;
  private suspendedByVisibility = false;
  private onVisibility: (() => void) | null = null;
  private combo = 0;
  private lastCoin = -10;
  private lastPrune = 0;
  private mood = 'none';
  private counters = { played: 0, dropped: 0, throttled: 0, inaudible: 0 };

  constructor(opts: AudioOptions = {}) {
    this.factory = opts.contextFactory ?? defaultFactory;
    this.rnd = opts.random ?? mulberry32((Math.random() * 0xffffffff) >>> 0);
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock(): void {
    if (this.disabled) return;
    try {
      if (!this.ctx) {
        const ctx = this.factory();
        if (!ctx) {
          // kein WebAudio verfügbar → dauerhaft still
          this.disabled = true;
          return;
        }
        this.ctx = ctx;
        this.build(ctx);
      }
      const st = this.ctx.state as string;
      if (st !== 'running' && st !== 'closed') {
        void this.ctx.resume().catch(() => undefined);
        this.primeOutput(this.ctx);
      }
    } catch (err) {
      this.fault(err, true);
    }
  }

  /** Älteres iOS-Safari schaltet Ausgabe erst frei, wenn innerhalb der Geste etwas abgespielt wird: stilles Sample. */
  private primeOutput(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.onended = () => src.disconnect();
      src.start(0);
    } catch {
      /* unkritisch */
    }
  }

  private build(ctx: AudioContext): void {
    const now = ctx.currentTime;
    this.kit = createSynthKit(ctx, this.rnd);
    this.mixer = new Mixer(ctx, this.rnd, this.settings);
    this.music = new MusicLayers(this.kit, this.mixer.musicIn);
    this.ambience = new Ambience(this.kit, this.mixer.ambienceIn, now);
    // Hintergrund-Tab: Kontext anhalten (Wind/Drone laufen sonst weiter), beim Zurückkehren fortsetzen
    const doc = (globalThis as { document?: Document }).document;
    if (doc && typeof doc.addEventListener === 'function') {
      this.onVisibility = () => {
        const c = this.ctx;
        if (!c) return;
        try {
          if (doc.visibilityState === 'hidden') {
            if (c.state === 'running') {
              this.suspendedByVisibility = true;
              void c.suspend().catch(() => undefined);
            }
          } else if (this.suspendedByVisibility) {
            this.suspendedByVisibility = false;
            void c.resume().catch(() => undefined);
          }
        } catch {
          /* ignorieren */
        }
      };
      doc.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  setSettings(s: AudioSettings): void {
    try {
      this.settings = sanitizeSettings(s);
      if (this.mixer && this.ctx) this.mixer.apply(this.settings, this.ctx.currentTime);
    } catch (err) {
      this.fault(err);
    }
  }

  /** aktuelle (bereinigte) Einstellungen */
  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /** Effekte nur erzeugen, wenn sie hörbar sein können (strikt stumm, spart Rechenzeit). */
  private sfxAudible(): boolean {
    const lv = busLevels(this.settings);
    return lv.master > 0 && lv.sfx > 0;
  }

  private ready(): boolean {
    return !this.disabled && !!this.ctx && !!this.mixer && this.ctx.state === 'running';
  }

  handleEvents(events: readonly SimEvent[], state: GameState): void {
    if (events.length === 0 || !this.ready() || !this.sfxAudible()) return;
    try {
      const ctx = this.ctx as AudioContext;
      const now = ctx.currentTime;
      this.sweep(now);
      const listeners = listenerXs(state.players);
      let started = 0;
      for (const e of events) {
        const c = mapEvent(e, listeners);
        if (!c) continue;
        if (started >= MAX_NEW_PER_BATCH && c.priority < 2) {
          this.counters.dropped++;
          continue;
        }
        if (this.playCue(c, listeners, now)) started++;
      }
    } catch (err) {
      this.fault(err);
    }
  }

  uiSound(kind: UiSound): void {
    if (!this.ready() || !this.sfxAudible()) return;
    try {
      const now = (this.ctx as AudioContext).currentTime;
      this.sweep(now);
      this.playCue(uiCue(kind), [], now);
    } catch (err) {
      this.fault(err);
    }
  }

  update(state: GameState | null, dt: number, paused: boolean): void {
    if (!this.ready()) return;
    try {
      const ctx = this.ctx as AudioContext;
      const mixer = this.mixer as Mixer;
      const now = ctx.currentTime;
      this.sweep(now);
      const m = computeMood(state, paused);
      this.mood = m.music;
      mixer.setMood(m.musicCutoff, m.duck, now);
      const lv = busLevels(this.settings);
      this.music?.update(now, m, lv.master > 0 && lv.music > 0);
      this.ambience?.update(now, Number.isFinite(dt) ? dt : 0, m, lv.master > 0 && lv.sfx > 0);
      if (now - this.lastPrune > 5) {
        this.lastPrune = now;
        this.limiter.prune(now);
      }
    } catch (err) {
      this.fault(err);
    }
  }

  /** Spielt einen Klang-Auftrag: Raum → Drossel → Stimmenlimit → Synthese. */
  private playCue(c: SoundCue, listeners: readonly number[], now: number): boolean {
    const sp = spatialize(c.x, listeners, c.space);
    if (!sp) {
      this.counters.inaudible++;
      return false;
    }
    if (!this.limiter.allow(c.key, now, c.minInterval, c.burst, 1)) {
      this.counters.throttled++;
      return false;
    }
    const decision = budgetDecision(
      this.voices.filter((v) => !v.dying),
      c.priority,
      SOFT_VOICES,
      HARD_VOICES,
    );
    if (decision.kind === 'drop') {
      this.counters.dropped++;
      return false;
    }
    if (decision.kind === 'steal') {
      const live = this.voices.filter((v) => !v.dying);
      this.fadeOut(live[decision.index], now);
    }
    if (c.id === 'coinPickup') {
      this.combo = comboStep(this.combo, this.lastCoin, now);
      this.lastCoin = now;
      c.params.semis = PENTA[this.combo];
    }

    const ctx = this.ctx as AudioContext;
    const mixer = this.mixer as Mixer;
    const kit = this.kit as SynthKit;
    const t = now + 0.01;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, sp.gain * c.gain * SFX_LEVEL);
    const nodes: AudioNode[] = [gain];
    let out: AudioNode = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, sp.pan));
      gain.connect(pan);
      out = pan;
      nodes.push(pan);
    }
    out.connect(mixer.sfxBus);
    if (c.reverb > 0) {
      // fernere Klänge bekommen mehr Hall (Raumtiefe)
      const send = ctx.createGain();
      send.gain.value = Math.min(1, c.reverb * (1 + (1 - sp.gain) * 0.8));
      out.connect(send);
      send.connect(mixer.sfxWet);
      nodes.push(send);
    }
    const end = playSfx(c.id, kit, t, gain, c.params);
    this.voices.push({ priority: c.priority as Priority, start: now, end, nodes, gain, dying: false });
    this.counters.played++;
    return true;
  }

  private fadeOut(v: SfxVoice | undefined, now: number): void {
    if (!v) return;
    v.dying = true;
    const p = v.gain.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + 0.04);
    v.end = Math.min(v.end, now + 0.06);
  }

  /** Beendete Stimmen trennen (Quellen trennen sich selbst über onended). */
  private sweep(now: number): void {
    if (this.voices.length === 0) return;
    const keep: SfxVoice[] = [];
    for (const v of this.voices) {
      if (v.end + 0.15 < now) {
        for (const n of v.nodes) n.disconnect();
      } else keep.push(v);
    }
    this.voices = keep;
  }

  private fault(err: unknown, fatal = false): void {
    this.faults++;
    if (!this.warned) {
      this.warned = true;
      console.warn('[Crownward/Audio] Fehler – Klang wird übersprungen:', err);
    }
    if (fatal || this.faults > 25) this.disabled = true;
  }

  /** Diagnose für Tests und Debug-API. */
  stats(): AudioStats {
    return {
      unlocked: this.unlocked,
      state: this.ctx ? (this.ctx.state as string) : this.disabled ? 'unsupported' : 'locked',
      sfxVoices: this.voices.length,
      musicVoices: this.music?.activeVoices ?? 0,
      ambientVoices: this.ambience?.activeVoices ?? 0,
      ...this.counters,
      faults: this.faults,
      mood: this.mood,
    };
  }

  /** Engine schließen (z. B. beim Neuladen der Seite im Dev-Modus). */
  close(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const doc = (globalThis as { document?: Document }).document;
    if (doc && this.onVisibility) doc.removeEventListener('visibilitychange', this.onVisibility);
    this.onVisibility = null;
    try {
      this.music?.dispose(ctx.currentTime);
      this.ambience?.dispose(ctx.currentTime);
      void ctx.close().catch(() => undefined);
    } catch {
      /* ignorieren */
    }
    this.ctx = null;
    this.mixer = null;
    this.kit = null;
    this.music = null;
    this.ambience = null;
    this.voices = [];
  }
}

export function createAudio(opts: AudioOptions = {}): AudioEngine {
  return new WebAudioEngine(opts);
}

/** Diagnosewerte einer Engine (für Debug-API/Tests); null bei fremder Implementierung. */
export function audioStats(engine: AudioEngine): AudioStats | null {
  return engine instanceof WebAudioEngine ? engine.stats() : null;
}
