// StemStage – UI: Rendering & DOM-Events.
// Die UI liest den Zustand der AudioEngine nur (currentTime, getPeaks, getLevel, isEnabled …)
// und meldet Benutzeraktionen per ui.on(name, fn) an main.js, das die Engine steuert.

export const DEFAULT_COLORS = {
  vocals: '#ff3d8b', guitar: '#ffb020', bass: '#3dd6ff',
  drums: '#7cff4d', piano: '#b26bff', other: '#ff7a45',
};
export const DEFAULT_LABELS = {
  vocals: 'Gesang', guitar: 'Gitarre', bass: 'E-Bass',
  drums: 'Schlagzeug', piano: 'Keyboard', other: 'Sonstiges',
};

const SVG = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
export const ICONS = {
  vocals: SVG('<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
  guitar: SVG('<path d="M10.2 9.6c-1.3-1.1-3.3-1-4.4.3-.5.6-.6 1.2-1.3 1.5-2 .8-2.7 3.4-1.1 5.1l4.1 4.1c1.7 1.6 4.3.9 5.1-1.1.3-.7.9-.8 1.5-1.3 1.3-1.1 1.4-3.1.3-4.4"/><path d="M11 13 19 5"/><path d="m17.3 3.3 3.4 3.4"/><circle cx="8.6" cy="15.4" r="1.4"/>'),
  bass: SVG('<path d="M8.7 11.4c-1.1-.8-2.6-.6-3.4.4-.4.5-.5 1-1 1.3-1.5.7-1.9 2.7-.7 3.9l3.4 3.4c1.2 1.2 3.2.8 3.9-.7.3-.5.8-.6 1.3-1 1-.8 1.2-2.3.4-3.4"/><path d="M8.5 15.5 20.5 3.5"/><path d="M17.5 2.5l1 1M20.5 5.5l1 1M18.5 1.5l-1 1M22.5 5.5l-1 1"/><path d="m5.6 17.1 1.3 1.3"/>'),
  drums: SVG('<ellipse cx="12" cy="11" rx="8" ry="3"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6M8 13.8v5.8M16 13.8v5.8M5 3l5.5 6M19 3l-5.5 6"/>'),
  piano: SVG('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16M7.5 14v6M16.5 14v6"/><rect x="6.2" y="4" width="2.6" height="10" rx=".5" fill="currentColor"/><rect x="15.2" y="4" width="2.6" height="10" rx=".5" fill="currentColor"/>'),
  other: SVG('<path d="M6 3v18M12 3v18M18 3v18"/><rect x="3.5" y="13" width="5" height="3.4" rx="1.2" fill="currentColor"/><rect x="9.5" y="6" width="5" height="3.4" rx="1.2" fill="currentColor"/><rect x="15.5" y="10" width="5" height="3.4" rx="1.2" fill="currentColor"/>'),
};

const SONG_EMOJIS = ['🎸', '🎹', '🥁', '🎤', '🎷', '🎺', '🎻', '🪩'];

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "Artist · 118 BPM" – Artist in eigenem Span, damit er auf schmalen Screens ausgeblendet werden kann. */
function metaHtml(song, artistClass) {
  const bpm = song.bpm ? `${Math.round(song.bpm)} BPM` : '';
  const artist = song.artist ? `<span class="${artistClass}">${esc(song.artist)}${bpm ? ' · ' : ''}</span>` : '';
  return artist + bpm;
}

function hexToRgb(hex) {
  let h = String(hex || '#ffffff').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const mixWhite = ([r, g, b], t) => [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t].map(Math.round);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class UI {
  constructor(doc = document) {
    this.doc = doc;
    const $ = (id) => doc.getElementById(id);
    this.el = {
      app: $('app'),
      songList: $('songList'),
      qrBtn: $('qrBtn'),
      stageWrap: $('stageWrap'),
      stage: $('stage'),
      stageHint: $('stageHint'),
      stageTitle: $('stageTitle'),
      stageMeta: $('stageMeta'),
      stageNote: $('stageNote'),
      panel: $('panel'),
      playBtn: $('playBtn'),
      seek: $('seek'),
      timeCur: $('timeCur'),
      timeDur: $('timeDur'),
      allOnBtn: $('allOnBtn'),
      volume: $('volume'),
      lanes: $('lanes'),
      startOverlay: $('startOverlay'),
      startBtn: $('startBtn'),
      startSong: $('startSong'),
      loadOverlay: $('loadOverlay'),
      loadTitle: $('loadTitle'),
      loadKicker: $('loadKicker'),
      loadProgress: $('loadProgress'),
      loadBar: $('loadBar'),
      loadPct: $('loadPct'),
      loadError: $('loadError'),
      loadErrorText: $('loadErrorText'),
      loadRetry: $('loadRetry'),
      loadClose: $('loadClose'),
      qrOverlay: $('qrOverlay'),
      qrCode: $('qrCode'),
      qrUrl: $('qrUrl'),
      qrSong: $('qrSong'),
      qrWarn: $('qrWarn'),
      qrClose: $('qrClose'),
      fatalOverlay: $('fatalOverlay'),
      fatalText: $('fatalText'),
      toast: $('toast'),
      toastText: $('toastText'),
      toastDot: $('toastDot'),
    };

    this.handlers = Object.create(null);
    this.engine = null;
    this.songs = [];
    this.song = null;
    this._loadedFor = null; // Song-ID, für die die Engine fertig geladen hat
    this.lanes = [];
    this.playing = false;
    this.seeking = false;
    this.hintHidden = false;
    this._dpr = Math.min(window.devicePixelRatio || 1, 3);
    this._lastFrac = -1;
    this._lastSec = -1;
    this._lastDur = -1;
    this._needsDraw = true;
    this._toastTimer = 0;
    this._qrReturnFocus = null;

    this._ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => this._onResize(entries))
      : null;

    this._bindStatic();
    this._bindKeys();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  /* ───────────────────────── Öffentliche API ───────────────────────── */

  on(name, fn) { this.handlers[name] = fn; return this; }
  _emit(name, ...args) {
    const fn = this.handlers[name];
    if (fn) {
      try { return fn(...args); } catch (err) { console.error(`[UI] Handler "${name}" fehlgeschlagen:`, err); }
    }
    return undefined;
  }

  attachEngine(engine) { this.engine = engine; this._needsDraw = true; }

  /** Ist die Engine fertig mit genau dem Song geladen, den die UI zeigt? */
  get ready() {
    const e = this.engine;
    return !!(e && this.song && e.song && e.song.id === this.song.id && this._loadedFor === this.song.id);
  }

  setSongs(songs, activeId) {
    this.songs = songs;
    const list = this.el.songList;
    list.innerHTML = '';
    songs.forEach((song, i) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'song-chip';
      b.dataset.id = song.id;
      b.setAttribute('aria-pressed', 'false');
      const meta = metaHtml(song, 'chip-artist');
      b.innerHTML = `
        <span class="chip-icon" aria-hidden="true">
          <span class="chip-emoji">${SONG_EMOJIS[i % SONG_EMOJIS.length]}</span>
          <span class="chip-eq"><i></i><i></i><i></i></span>
        </span>
        <span class="chip-title">${esc(song.title)}</span>
        <span class="chip-meta">${meta}</span>`;
      b.addEventListener('click', () => this._emit('selectSong', song.id));
      list.appendChild(b);
    });
    if (activeId) this.setActiveSong(activeId);
  }

  setActiveSong(id) {
    for (const b of this.el.songList.children) {
      const on = b.dataset.id === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) {
        try { b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch { /* egal */ }
      }
    }
  }

  setBusy(busy) {
    for (const b of this.el.songList.children) b.disabled = !!busy;
  }

  /** Spuren für einen Song aufbauen (Wellenformen erscheinen, sobald die Engine ihn geladen hat). */
  setSong(song) {
    this.song = song;
    this._ro?.disconnect();
    this.el.lanes.innerHTML = '';
    this.lanes = [];

    this.el.stageTitle.textContent = song.title;
    this.el.stageMeta.innerHTML = metaHtml(song, 'meta-artist');
    this.el.startSong.textContent = `${song.title}${song.artist ? ' – ' + song.artist : ''}`;
    this.el.timeDur.textContent = formatTime(song.duration || 0);

    song.stems.forEach((stem, i) => {
      const color = stem.color || DEFAULT_COLORS[stem.instrument] || DEFAULT_COLORS.other;
      const label = stem.label || DEFAULT_LABELS[stem.instrument] || stem.id;
      const icon = ICONS[stem.instrument] || ICONS.other;
      const key = i < 6 ? i + 1 : null;

      const root = this.doc.createElement('div');
      root.className = 'lane';
      root.setAttribute('role', 'listitem');
      root.dataset.id = stem.id;
      root.style.setProperty('--c', color);
      root.style.setProperty('--i', String(i));
      root.innerHTML = `
        <button class="lane-toggle" type="button" role="switch" aria-checked="true"
          aria-label="${esc(label)}${key ? ` (Taste ${key})` : ''}" title="${esc(label)} an/aus${key ? ` (${key})` : ''}">
          <span class="lane-icon">${icon}</span>
          <span class="lane-text">
            <span class="lane-label">${esc(label)}</span>
            <span class="lane-state">an</span>
          </span>
          <span class="lane-switch" aria-hidden="true"><span></span></span>
        </button>
        <div class="lane-wave is-loading" title="Tippen, um an diese Stelle zu springen"><canvas></canvas></div>
        <div class="lane-meter" aria-hidden="true"><span></span></div>
        <button class="lane-solo" type="button" aria-pressed="false"
          aria-label="${esc(label)} solo${key ? ` (Umschalt+${key})` : ''}" title="Solo${key ? ` (⇧+${key})` : ''}">S</button>`;

      const lane = {
        id: stem.id,
        label,
        color,
        rgb: hexToRgb(color),
        root,
        toggle: root.querySelector('.lane-toggle'),
        state: root.querySelector('.lane-state'),
        solo: root.querySelector('.lane-solo'),
        wave: root.querySelector('.lane-wave'),
        canvas: root.querySelector('canvas'),
        meter: root.querySelector('.lane-meter span'),
        ctx: null,
        cache: null,
        meterVal: 0,
        meterShown: -1,
      };
      lane.ctx = lane.canvas.getContext('2d');

      lane.toggle.addEventListener('click', () => this._emit('toggleStem', stem.id));
      lane.solo.addEventListener('click', () => this._emit('solo', stem.id));
      lane.wave.addEventListener('click', (ev) => {
        const r = lane.wave.getBoundingClientRect();
        if (r.width > 0) this._emit('seekFraction', clamp01((ev.clientX - r.left) / r.width));
      });
      root.addEventListener('pointerenter', (ev) => {
        if (ev.pointerType === 'mouse') this._hover(lane, true);
      });
      root.addEventListener('pointerleave', (ev) => {
        if (ev.pointerType === 'mouse') this._hover(lane, false);
      });
      // Tastatur-Fokus (nicht Touch-Fokus) hebt den Musiker ebenfalls hervor.
      root.addEventListener('focusin', (ev) => {
        let kb = false;
        try { kb = ev.target.matches(':focus-visible'); } catch { kb = false; }
        if (kb) this._hover(lane, true);
      });
      root.addEventListener('focusout', (ev) => {
        if (!root.contains(ev.relatedTarget) && lane.root.classList.contains('is-hot')) this._hover(lane, false);
      });

      this.el.lanes.appendChild(root);
      this.lanes.push(lane);
      this._sizeLane(lane);
      this._ro?.observe(lane.wave);
    });

    this._lastSec = -1;
    this._lastDur = -1;
    this._needsDraw = true;
    this.syncStems();
  }

  /** Engine hat den aktuellen Song fertig geladen → Wellenformen bauen. */
  onSongLoaded() {
    this._loadedFor = this.song ? this.song.id : null;
    for (const lane of this.lanes) {
      this._buildCache(lane);
      lane.wave.classList.toggle('is-loading', !lane.cache);
    }
    this._needsDraw = true;
    this._lastDur = -1;
    this.syncStems();
  }

  /** Mute/Solo-Zustand aller Spuren aus der Engine übernehmen. */
  syncStems() {
    const e = this.engine;
    const ready = this.ready;
    const soloId = ready ? e.soloId ?? null : null;
    let anyOff = false;
    for (const lane of this.lanes) {
      const enabled = ready ? !!e.isEnabled(lane.id) : true;
      const audible = ready ? !!e.isAudible(lane.id) : true;
      const solo = soloId === lane.id;
      if (!enabled) anyOff = true;
      lane.root.classList.toggle('is-off', !enabled);
      lane.root.classList.toggle('is-silent', !audible);
      lane.root.classList.toggle('is-solo', solo);
      lane.toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
      lane.solo.setAttribute('aria-pressed', solo ? 'true' : 'false');
      lane.state.textContent = !enabled ? 'aus' : solo ? 'Solo' : audible ? 'an' : 'stumm';
    }
    this.el.app.classList.toggle('has-solo', soloId != null);
    this.el.allOnBtn.classList.toggle('is-relevant', anyOff || soloId != null);
  }

  setPlaying(isPlaying) {
    this.playing = !!isPlaying;
    this.el.app.classList.toggle('is-playing', this.playing);
    this.el.playBtn.setAttribute('aria-label', this.playing ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)');
    this.el.playBtn.title = this.playing ? 'Pause' : 'Abspielen';
  }

  /** Von timeupdate-Events – der rAF-Loop zeichnet ohnehin flüssig, hier nur Text aktualisieren. */
  setTime(t) {
    if (!this.seeking) this._setTimeText(t);
  }

  setVolume(v) {
    this.el.volume.value = String(Math.round(clamp01(v) * 100));
    this._paintRange(this.el.volume);
  }

  /* ─────────────── Overlays ─────────────── */

  showStart(song) {
    if (song) this.el.startSong.textContent = `${song.title}${song.artist ? ' – ' + song.artist : ''}`;
    this.el.startOverlay.classList.remove('is-leaving');
    this._open(this.el.startOverlay);
    this.el.startBtn.focus({ preventScroll: true });
  }
  hideStart() {
    this.el.startOverlay.classList.add('is-leaving');
    this._close(this.el.startOverlay);
  }
  get startOpen() { return this.el.startOverlay.classList.contains('is-open'); }

  showLoading(song) {
    // Während des Ladens liefert die Engine noch keine Peaks/Stems → Spuren im Lade-Zustand.
    this._loadedFor = null;
    for (const lane of this.lanes) { lane.cache = null; lane.wave.classList.add('is-loading'); }
    this._needsDraw = true;
    this.syncStems();
    this.el.loadTitle.textContent = song ? `„${song.title}“` : 'Lade Song …';
    this.el.loadError.hidden = true;
    this.el.loadOverlay.classList.remove('has-error');
    if (this.el.loadKicker) this.el.loadKicker.textContent = 'Bühne wird aufgebaut';
    this.setLoadingProgress(0);
    this._open(this.el.loadOverlay);
  }
  setLoadingProgress(p) {
    const v = clamp01(Number(p) || 0);
    this.el.loadBar.style.transform = `scaleX(${v})`;
    const pct = Math.round(v * 100);
    this.el.loadPct.textContent = `${pct} %`;
    this.el.loadProgress.setAttribute('aria-valuenow', String(pct));
  }
  hideLoading() { this._close(this.el.loadOverlay); }
  showLoadError(msg) {
    this.el.loadErrorText.textContent = msg || 'Der Song konnte nicht geladen werden.';
    this.el.loadError.hidden = false;
    this.el.loadOverlay.classList.add('has-error');
    if (this.el.loadKicker) this.el.loadKicker.textContent = 'Oh nein – Soundcheck fehlgeschlagen';
    this._open(this.el.loadOverlay);
    this.el.loadRetry.focus({ preventScroll: true });
  }

  showFatal(text) {
    this._close(this.el.startOverlay);
    this._close(this.el.loadOverlay);
    this.el.fatalText.textContent = text;
    this._open(this.el.fatalOverlay);
  }

  get qrOpen() { return this.el.qrOverlay.classList.contains('is-open'); }

  showQr(url, song) {
    const svg = this._qrSvg(url);
    this.el.qrCode.innerHTML = svg || '<p class="qr-missing">QR-Code konnte nicht erzeugt werden (Bibliothek nicht geladen).</p>';
    // Passwort (#pw=…) steckt nur im Code, nicht im angezeigten Text
    this.el.qrUrl.textContent = url.split('#')[0] + (/#pw=/.test(url) ? '  ·  🔓 Passwort ist im Code' : '');
    this.el.qrSong.textContent = song ? `${song.title}${song.artist ? ' – ' + song.artist : ''}` : '';
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignorieren */ }
    this.el.qrWarn.hidden = !/^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i.test(host);
    this._qrReturnFocus = this.doc.activeElement;
    this._open(this.el.qrOverlay);
    this.el.qrClose.focus({ preventScroll: true });
  }
  hideQr() {
    if (!this.qrOpen) return;
    this._close(this.el.qrOverlay);
    const f = this._qrReturnFocus;
    if (f && typeof f.focus === 'function') f.focus({ preventScroll: true });
  }

  toast(text, { color = '#ffffff', off = false } = {}) {
    const t = this.el.toast;
    this.el.toastText.textContent = text;
    this.el.toastDot.style.background = color;
    this.el.toastDot.style.color = color;
    t.classList.toggle('is-off', !!off);
    t.classList.remove('show');
    void t.offsetWidth; // Animation neu starten
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
  }

  hideStageHint() {
    if (this.hintHidden) return;
    this.hintHidden = true;
    const h = this.el.stageHint;
    h.classList.add('is-gone');
    setTimeout(() => { h.hidden = true; }, 600);
  }

  /** WebGL fehlt o. Ä. → Bühne ausblenden, Spuren bekommen den Platz. */
  disableStage() {
    this.el.app.classList.add('no-stage');
    this.el.stageWrap.hidden = true;
    this.el.stageNote.hidden = false;
    this._needsDraw = true;
  }

  /* ───────────────────────── Intern: Events ───────────────────────── */

  _bindStatic() {
    const { el } = this;
    const on = (node, type, fn, opts) => { if (node) node.addEventListener(type, fn, opts); };
    on(el.playBtn, 'click', () => this._emit('togglePlay'));
    on(el.allOnBtn, 'click', () => this._emit('allOn'));
    on(el.qrBtn, 'click', () => this._emit('qr'));
    on(el.startBtn, 'click', () => this._emit('start'));
    on(el.loadRetry, 'click', () => this._emit('retry'));
    on(el.loadClose, 'click', () => this.hideLoading());
    on(el.qrOverlay, 'click', () => this._emit('closeQr'));

    // Seekbar: während des Ziehens nur Anzeige, beim Loslassen springen.
    const seek = el.seek;
    const commit = () => {
      if (!this.seeking) return;
      this.seeking = false;
      this._emit('seekFraction', Number(seek.value) / 1000);
    };
    on(seek, 'input', () => {
      this.seeking = true;
      this._paintRange(seek);
      const dur = this._duration();
      this._setTimeText((Number(seek.value) / 1000) * dur);
    });
    on(seek, 'change', commit);
    on(seek, 'pointerup', () => setTimeout(commit, 0));
    on(seek, 'blur', commit);

    on(el.volume, 'input', () => {
      this._paintRange(el.volume);
      this._emit('volume', Number(el.volume.value) / 100);
    });
    this._paintRange(el.volume);

    // Erste Interaktion mit der Bühne blendet den Hinweis aus.
    on(el.stage, 'pointerdown', () => {
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => this.hideStageHint(), 1200);
    }, { passive: true });

    window.addEventListener('resize', () => {
      const d = Math.min(window.devicePixelRatio || 1, 3);
      if (d !== this._dpr) {
        this._dpr = d;
        for (const lane of this.lanes) this._sizeLane(lane, true);
      }
    });
  }

  _bindKeys() {
    this.doc.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if ((tag === 'INPUT' && t.type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;

      if (e.key === 'Escape') {
        if (this.qrOpen) { e.preventDefault(); this._emit('closeQr'); }
        return;
      }
      if (this.startOpen) {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); this._emit('start'); }
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        this._emit('togglePlay');
        return;
      }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
      if (m) {
        const stem = this.song?.stems[Number(m[1]) - 1];
        if (stem && Number(m[1]) <= 6) {
          e.preventDefault();
          this._emit(e.shiftKey ? 'solo' : 'toggleStem', stem.id);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this._emit('seekBy', e.key === 'ArrowLeft' ? -5 : 5);
        return;
      }
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        this._emit('qr');
      }
    });
  }

  _hover(lane, on) {
    lane.root.classList.toggle('is-hot', on);
    this._emit('laneHover', on ? lane.id : null);
  }

  _open(el) {
    clearTimeout(el._closeTimer);
    const wasHidden = el.hidden;
    el.hidden = false;
    if (!wasHidden) { el.classList.add('is-open'); return; }
    // Layout erzwingen, damit die Einblend-Transition greift – synchron, ohne Race mit _close().
    void el.offsetWidth;
    el.classList.add('is-open');
  }
  _close(el) {
    el.classList.remove('is-open');
    clearTimeout(el._closeTimer);
    el._closeTimer = setTimeout(() => {
      if (!el.classList.contains('is-open')) el.hidden = true;
    }, 450);
  }

  _paintRange(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const p = ((Number(input.value) - min) / (max - min || 1)) * 100;
    input.style.setProperty('--p', `${p}%`);
  }

  _duration() {
    const e = this.engine;
    if (this.ready && Number.isFinite(e.duration) && e.duration > 0) return e.duration;
    return this.song?.duration || 0;
  }

  _setTimeText(t) {
    const sec = Math.floor(Math.max(0, t || 0));
    if (sec !== this._lastSec) {
      this._lastSec = sec;
      this.el.timeCur.textContent = formatTime(sec);
    }
  }

  /* ───────────────────────── Intern: Wellenform ───────────────────────── */

  _onResize(entries) {
    for (const entry of entries) {
      const lane = this.lanes.find((l) => l.wave === entry.target);
      if (lane) this._sizeLane(lane);
    }
  }

  _sizeLane(lane, force = false) {
    const r = lane.wave.getBoundingClientRect();
    const d = this._dpr;
    const w = Math.max(0, Math.round(r.width * d));
    const h = Math.max(0, Math.round(r.height * d));
    if (!force && w === lane.canvas.width && h === lane.canvas.height) return;
    lane.canvas.width = w;
    lane.canvas.height = h;
    this._buildCache(lane);
    lane.wave.classList.toggle('is-loading', !lane.cache);
    this._needsDraw = true;
  }

  _buildCache(lane) {
    lane.cache = null;
    const W = lane.canvas.width;
    const H = lane.canvas.height;
    if (!W || !H || !this.ready) return;

    const d = this._dpr;
    const barW = 2 * d;
    const step = 3.5 * d;
    const n = Math.max(8, Math.floor(W / step));
    let peaks = null;
    try { peaks = this.engine.getPeaks(lane.id, n); } catch (err) { console.warn('[UI] getPeaks fehlgeschlagen', err); }
    if (!peaks || !peaks.length) return;

    let max = 0;
    for (let i = 0; i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
    const norm = 1 / Math.max(max, 0.2);

    const make = (fill) => {
      const c = this.doc.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = fill(g);
      const count = peaks.length;
      const s = W / count;
      const mid = H / 2;
      const r = barW / 2;
      g.beginPath();
      for (let i = 0; i < count; i++) {
        const p = clamp01((peaks[i] || 0) * norm);
        const bh = Math.max(2 * d, p * H * 0.86);
        const x = i * s + (s - barW) / 2;
        const y = mid - bh / 2;
        if (g.roundRect) g.roundRect(x, y, barW, bh, r);
        else g.rect(x, y, barW, bh);
      }
      g.fill();
      return c;
    };

    const rgb = lane.rgb;
    const light = mixWhite(rgb, 0.45);
    lane.cache = {
      bright: make((g) => {
        const gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, rgba(light, 1));
        gr.addColorStop(0.5, rgba(rgb, 1));
        gr.addColorStop(1, rgba(light, 1));
        return gr;
      }),
      dim: make(() => rgba(rgb, 0.26)),
    };
    this._needsDraw = true;
  }

  _drawLane(lane, frac) {
    const { ctx, canvas } = lane;
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const d = this._dpr;

    if (!lane.cache) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, Math.round(H / 2 - d / 2), W, Math.max(1, Math.round(d)));
      return;
    }
    const x = Math.round(clamp01(frac) * W);
    ctx.drawImage(lane.cache.dim, 0, 0);
    if (x > 0) ctx.drawImage(lane.cache.bright, 0, 0, x, H, 0, 0, x, H);

    if (frac > 0 && frac < 1) {
      ctx.fillStyle = rgba(lane.rgb, 0.25);
      ctx.fillRect(x - 4 * d, 0, 8 * d, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - d, 0, 2 * d, H);
    }
  }

  /* ───────────────────────── rAF-Loop ───────────────────────── */

  _frame() {
    requestAnimationFrame(this._frame);
    const e = this.engine;
    const ready = this.ready;
    const dur = this._duration();
    let t = 0;
    if (ready) {
      t = Number(e.currentTime) || 0;
      if (dur > 0 && t > dur) t = dur;
    }
    const frac = dur > 0 ? t / dur : 0;

    if (dur !== this._lastDur) {
      this._lastDur = dur;
      this.el.timeDur.textContent = formatTime(dur);
    }
    if (!this.seeking) {
      this._setTimeText(t);
      const v = String(Math.round(frac * 1000));
      if (this.el.seek.value !== v) {
        this.el.seek.value = v;
        this._paintRange(this.el.seek);
      }
    }

    if (this._needsDraw || Math.abs(frac - this._lastFrac) > 1e-5) {
      this._lastFrac = frac;
      this._needsDraw = false;
      for (const lane of this.lanes) this._drawLane(lane, frac);
    }

    // Pegel-Meter (schnell an, langsam ab)
    for (const lane of this.lanes) {
      let lvl = 0;
      if (ready) {
        try { lvl = clamp01(Number(e.getLevel(lane.id)) || 0); } catch { lvl = 0; }
      }
      lane.meterVal = lvl > lane.meterVal ? lvl : Math.max(lvl, lane.meterVal - 0.025);
      const shown = Math.round(lane.meterVal * 100) / 100;
      if (shown !== lane.meterShown) {
        lane.meterShown = shown;
        lane.meter.style.transform = `scaleY(${shown})`;
      }
    }
  }

  /* ───────────────────────── QR ───────────────────────── */

  _qrSvg(url) {
    const factory = window.qrcode;
    if (typeof factory !== 'function') return null;
    try {
      const qr = factory(0, 'M');
      qr.addData(url);
      qr.make();
      const n = qr.getModuleCount();
      const quiet = 4;
      const size = n + quiet * 2;
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
        }
      }
      return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR-Code: ${esc(url)}">`
        + `<rect width="${size}" height="${size}" fill="#ffffff"/><path d="${d}" fill="#07070c"/></svg>`;
    } catch (err) {
      console.warn('[UI] QR-Code fehlgeschlagen', err);
      return null;
    }
  }
}
