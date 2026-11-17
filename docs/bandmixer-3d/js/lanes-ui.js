const STEM_META = {
  vocals: { label: 'Gesang', shortLabel: 'Gesang', color: '#f43f5e' },
  guitar: { label: 'E-Gitarre', shortLabel: 'Gitarre', color: '#f97316' },
  bass: { label: 'E-Bass', shortLabel: 'Bass', color: '#10b981' },
  drums: { label: 'Schlagzeug', shortLabel: 'Drums', color: '#38bdf8' },
  keys: { label: 'Keyboard / Synth', shortLabel: 'Keys', color: '#a855f7' },
};

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) || 248,
      g: parseInt(clean[1] + clean[1], 16) || 250,
      b: parseInt(clean[2] + clean[2], 16) || 252,
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16) || 248,
      g: parseInt(clean.slice(2, 4), 16) || 250,
      b: parseInt(clean.slice(4, 6), 16) || 252,
    };
  }
  return { r: 56, g: 189, b: 248 };
}

function getInstrumentSvg(stemId) {
  switch (stemId) {
    case 'vocals':
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="9" y="2.5" width="6" height="10" rx="3"/>' +
        '<path d="M5.5 10.5a6.5 6.5 0 0 0 13 0"/>' +
        '<line x1="12" y1="17" x2="12" y2="21"/>' +
        '<line x1="8.5" y1="21" x2="15.5" y2="21"/>' +
        '</svg>'
      );
    case 'guitar':
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M19.5 3.5l1 1-5.6 5.6"/>' +
        '<path d="M17.5 3.5l3 3"/>' +
        '<path d="M13.5 9.2c-1.8-.4-3.7.3-4.9 1.7-1.1 1.3-1.4 2.8-2.7 3.8-1.4 1.1-2.6 2-2.2 4 .3 1.5 1.8 2.8 3.4 2.8 2.2 0 3.1-1.3 4.1-2.5 1-1.2 2.4-1.6 3.5-2.7 1.3-1.3 1.7-3.4.9-5.1"/>' +
        '<circle cx="9.6" cy="15.6" r="1.3"/>' +
        '</svg>'
      );
    case 'bass':
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M20.5 3.5l-7.2 7.2"/>' +
        '<path d="M18.2 2.8l2.5.5.5 2.5"/>' +
        '<path d="M12.2 10.1c-2.2-.7-4.5.3-5.7 2.2-.8 1.2-1.9 2.3-2.5 3.8-.6 1.7.3 3.7 2 4.4 1.8.8 3.9.2 5.1-1.3 1.1-1.3 2.5-2.3 3.5-3.7 1.2-1.6 1.2-3.8-.2-5.1"/>' +
        '<line x1="7.5" y1="17.2" x2="10.2" y2="14.5"/>' +
        '<line x1="8.8" y1="18.6" x2="11.5" y2="15.9"/>' +
        '</svg>'
      );
    case 'drums':
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<ellipse cx="12" cy="9" rx="8" ry="3"/>' +
        '<path d="M4 9v6c0 1.66 3.58 3 8 3s8-1.34 8-3V9"/>' +
        '<line x1="8.5" y1="11.8" x2="8.5" y2="17.5"/>' +
        '<line x1="15.5" y1="11.8" x2="15.5" y2="17.5"/>' +
        '<line x1="5" y1="4" x2="10.5" y2="7.5"/>' +
        '<line x1="19" y1="4" x2="13.5" y2="7.5"/>' +
        '</svg>'
      );
    case 'keys':
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="6" width="18" height="12" rx="2"/>' +
        '<line x1="7.5" y1="6" x2="7.5" y2="18"/>' +
        '<line x1="12" y1="6" x2="12" y2="18"/>' +
        '<line x1="16.5" y1="6" x2="16.5" y2="18"/>' +
        '<rect x="6.1" y="6" width="2.8" height="7" fill="currentColor" stroke="none"/>' +
        '<rect x="10.6" y="6" width="2.8" height="7" fill="currentColor" stroke="none"/>' +
        '<rect x="15.1" y="6" width="2.8" height="7" fill="currentColor" stroke="none"/>' +
        '</svg>'
      );
    default:
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M9 18V5l11-2v13"/>' +
        '<circle cx="6.5" cy="18.5" r="2.5"/>' +
        '<circle cx="17.5" cy="16.5" r="2.5"/>' +
        '</svg>'
      );
  }
}

function normalizePeaks(rawPeaks) {
  if (!Array.isArray(rawPeaks) || rawPeaks.length === 0) {
    const fallback = new Float32Array(120);
    fallback.fill(0.18);
    return fallback;
  }
  const out = new Float32Array(rawPeaks.length);
  for (let i = 0; i < rawPeaks.length; i += 1) {
    const val = Number(rawPeaks[i]);
    out[i] = Number.isFinite(val) ? Math.max(0.04, Math.min(1, val)) : 0.08;
  }
  return out;
}

/**
 * DAW-style Instrumenten-Spuren UI with high-DPI waveform scrubbing,
 * large touch-friendly mute toggles, solo switches, volume faders, and live level meters.
 */
export class LanesUI {
  constructor(
    containerEl,
    { onToggleMute, onToggleSolo, onVolumeChange, onSeek, onHoverStem } = {}
  ) {
    this.containerEl = containerEl;
    this.callbacks = { onToggleMute, onToggleSolo, onVolumeChange, onSeek, onHoverStem };
    this.lanes = new Map();
    this.hoveredStemId = null;
    this.state = {
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      muted: {},
      soloId: null,
      volumes: {},
      availableStemIds: [],
    };

    this.resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            this.handleResize();
          })
        : null;
  }

  renderLanes(song) {
    this.clearLanes();

    const stems = Array.isArray(song?.stems) ? song.stems : [];
    if (stems.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();

    stems.forEach((stem, index) => {
      const meta = STEM_META[stem.id] || {
        label: stem.label || stem.id,
        shortLabel: stem.shortLabel || stem.label || stem.id,
        color: stem.color || '#38bdf8',
      };
      const label = stem.label || meta.label;
      const color = stem.color || meta.color;
      const rgb = hexToRgb(color);
      const peaks = normalizePeaks(stem.peaks);

      const rowEl = document.createElement('div');
      rowEl.className = 'lane-row';
      rowEl.dataset.stemId = stem.id;
      rowEl.style.setProperty('--stem-color', color);
      rowEl.style.setProperty('--stem-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);

      rowEl.addEventListener('pointerenter', () => {
        this.callbacks.onHoverStem?.(stem.id);
      });
      rowEl.addEventListener('pointerleave', () => {
        this.callbacks.onHoverStem?.(null);
      });

      const accentBar = document.createElement('div');
      accentBar.className = 'lane-accent';
      accentBar.setAttribute('aria-hidden', 'true');

      const headEl = document.createElement('div');
      headEl.className = 'lane-head';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'lane-toggle';
      toggleBtn.setAttribute('aria-pressed', 'true');
      toggleBtn.setAttribute('aria-label', `${label} stummschalten`);

      const iconWrap = document.createElement('span');
      iconWrap.className = 'lane-icon-wrap';
      iconWrap.innerHTML = getInstrumentSvg(stem.id);

      const titleGroup = document.createElement('span');
      titleGroup.className = 'lane-title-group';

      const nameEl = document.createElement('span');
      nameEl.className = 'lane-name';
      nameEl.textContent = label;

      const hotkeyEl = document.createElement('span');
      hotkeyEl.className = 'lane-hotkey';
      hotkeyEl.setAttribute('aria-hidden', 'true');
      hotkeyEl.textContent = String(index + 1);

      titleGroup.append(nameEl, hotkeyEl);

      const statusPill = document.createElement('span');
      statusPill.className = 'lane-status-pill';
      statusPill.textContent = 'AN';

      toggleBtn.append(iconWrap, titleGroup, statusPill);
      toggleBtn.addEventListener('click', () => {
        this.callbacks.onToggleMute?.(stem.id);
      });

      const controlsEl = document.createElement('div');
      controlsEl.className = 'lane-controls';

      const soloBtn = document.createElement('button');
      soloBtn.type = 'button';
      soloBtn.className = 'lane-solo-btn';
      soloBtn.textContent = 'S';
      soloBtn.title = `Solo: ${label}`;
      soloBtn.setAttribute('aria-pressed', 'false');
      soloBtn.setAttribute('aria-label', `${label} solo schalten`);
      soloBtn.addEventListener('click', () => {
        this.callbacks.onToggleSolo?.(stem.id);
      });

      const volumeWrap = document.createElement('label');
      volumeWrap.className = 'lane-volume-wrap';

      const volumeSr = document.createElement('span');
      volumeSr.className = 'sr-only';
      volumeSr.textContent = `Lautstärke ${label}`;

      const volumeSlider = document.createElement('input');
      volumeSlider.type = 'range';
      volumeSlider.className = 'lane-volume-slider';
      volumeSlider.min = '0';
      volumeSlider.max = '100';
      volumeSlider.step = '1';
      volumeSlider.value = '100';
      volumeSlider.setAttribute('aria-label', `Lautstärke ${label}`);
      volumeSlider.addEventListener('input', () => {
        const val01 = Number(volumeSlider.value) / 100;
        this.callbacks.onVolumeChange?.(stem.id, val01);
      });

      volumeWrap.append(volumeSr, volumeSlider);
      controlsEl.append(soloBtn, volumeWrap);
      headEl.append(toggleBtn, controlsEl);

      const waveArea = document.createElement('div');
      waveArea.className = 'lane-wave-area';

      const waveWrap = document.createElement('div');
      waveWrap.className = 'lane-waveform-wrap';
      waveWrap.setAttribute('role', 'slider');
      waveWrap.tabIndex = 0;
      waveWrap.setAttribute('aria-label', `Wiedergabeposition ${label}`);
      waveWrap.setAttribute('aria-valuemin', '0');
      waveWrap.setAttribute('aria-valuemax', '100');
      waveWrap.setAttribute('aria-valuenow', '0');

      const canvas = document.createElement('canvas');
      canvas.className = 'lane-waveform-canvas';
      waveWrap.appendChild(canvas);

      const meterEl = document.createElement('div');
      meterEl.className = 'lane-meter';
      meterEl.setAttribute('aria-hidden', 'true');
      const meterFill = document.createElement('div');
      meterFill.className = 'lane-meter-fill';
      meterEl.appendChild(meterFill);

      waveArea.append(waveWrap, meterEl);
      rowEl.append(accentBar, headEl, waveArea);
      fragment.appendChild(rowEl);

      const entry = {
        stemId: stem.id,
        label,
        color,
        rgb,
        peaks,
        rowEl,
        toggleBtn,
        statusPill,
        soloBtn,
        volumeSlider,
        waveWrap,
        canvas,
        ctx: canvas.getContext('2d'),
        meterFill,
        cssWidth: 0,
        cssHeight: 0,
        dpr: 1,
        lastMuted: null,
        lastSolo: null,
        lastVolumePct: null,
        lastProgress: -1,
        lastLevel: -1,
      };

      this.bindWaveformScrub(entry);
      this.lanes.set(stem.id, entry);
      this.resizeObserver?.observe(waveWrap);
    });

    this.containerEl.appendChild(fragment);
    this.handleResize();
    this.updatePlaybackState(this.state);
  }

  bindWaveformScrub(entry) {
    let activePointerId = null;
    let lastSeekTimestamp = 0;

    const getSeekSeconds = (clientX) => {
      const dur = this.state.duration || 0;
      if (dur <= 0) return 0;
      const rect = entry.waveWrap.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * dur;
    };

    entry.waveWrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((this.state.duration || 0) <= 0) return;
      activePointerId = e.pointerId;
      try {
        entry.waveWrap.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture error if synthetic event.
      }
      lastSeekTimestamp = performance.now();
      this.callbacks.onSeek?.(getSeekSeconds(e.clientX));
    });

    entry.waveWrap.addEventListener('pointermove', (e) => {
      if (activePointerId !== e.pointerId) return;
      const now = performance.now();
      if (now - lastSeekTimestamp < 65) return;
      lastSeekTimestamp = now;
      this.callbacks.onSeek?.(getSeekSeconds(e.clientX));
    });

    const endScrub = (e) => {
      if (activePointerId !== e.pointerId) return;
      activePointerId = null;
      this.callbacks.onSeek?.(getSeekSeconds(e.clientX));
      try {
        if (entry.waveWrap.hasPointerCapture(e.pointerId)) {
          entry.waveWrap.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore release error.
      }
    };

    entry.waveWrap.addEventListener('pointerup', endScrub);
    entry.waveWrap.addEventListener('pointercancel', () => {
      activePointerId = null;
    });

    entry.waveWrap.addEventListener('keydown', (e) => {
      const dur = this.state.duration || 0;
      if (dur <= 0) return;
      const cur = this.state.currentTime || 0;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.callbacks.onSeek?.(Math.max(0, cur - 5));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.callbacks.onSeek?.(Math.min(dur, cur + 5));
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.callbacks.onSeek?.(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.callbacks.onSeek?.(dur);
      }
    });
  }

  handleResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const entry of this.lanes.values()) {
      const rect = entry.waveWrap.getBoundingClientRect();
      const cssWidth = Math.max(0, Math.round(rect.width));
      const cssHeight = Math.max(0, Math.round(rect.height));
      if (cssWidth === 0 || cssHeight === 0) continue;

      if (entry.cssWidth !== cssWidth || entry.cssHeight !== cssHeight || entry.dpr !== dpr) {
        entry.cssWidth = cssWidth;
        entry.cssHeight = cssHeight;
        entry.dpr = dpr;
        entry.canvas.width = Math.round(cssWidth * dpr);
        entry.canvas.height = Math.round(cssHeight * dpr);
        entry.lastProgress = -1;
      }

      const progress =
        this.state.duration > 0
          ? Math.max(0, Math.min(1, this.state.currentTime / this.state.duration))
          : 0;
      const isMuted = Boolean(this.state.muted?.[entry.stemId]);
      this.drawWaveform(entry, progress, isMuted);
    }
  }

  updatePlaybackState(state) {
    if (!state) return;
    this.state = {
      isPlaying: Boolean(state.isPlaying),
      currentTime: Number(state.currentTime) || 0,
      duration: Number(state.duration) || 0,
      muted: state.muted || {},
      soloId: state.soloId ?? null,
      volumes: state.volumes || {},
      availableStemIds: state.availableStemIds || [],
    };

    const progress =
      this.state.duration > 0
        ? Math.max(0, Math.min(1, this.state.currentTime / this.state.duration))
        : 0;
    const progressPct = Math.round(progress * 100);

    for (const [stemId, entry] of this.lanes.entries()) {
      const isMuted = Boolean(this.state.muted[stemId]);
      const isSolo = this.state.soloId === stemId;
      const vol = this.state.volumes[stemId] ?? 1;
      const volPct = Math.round(Math.max(0, Math.min(1, vol)) * 100);

      if (entry.lastMuted !== isMuted) {
        entry.lastMuted = isMuted;
        entry.rowEl.classList.toggle('is-muted', isMuted);
        entry.toggleBtn.setAttribute('aria-pressed', String(!isMuted));
        entry.toggleBtn.setAttribute(
          'aria-label',
          isMuted ? `${entry.label} aktivieren` : `${entry.label} stummschalten`
        );
        entry.statusPill.textContent = isMuted ? 'AUS' : 'AN';
        entry.lastProgress = -1;
      }

      if (entry.lastSolo !== isSolo) {
        entry.lastSolo = isSolo;
        entry.rowEl.classList.toggle('is-solo', isSolo);
        entry.soloBtn.classList.toggle('is-active', isSolo);
        entry.soloBtn.setAttribute('aria-pressed', String(isSolo));
      }

      if (entry.lastVolumePct !== volPct) {
        entry.lastVolumePct = volPct;
        if (document.activeElement !== entry.volumeSlider) {
          entry.volumeSlider.value = String(volPct);
        }
        entry.volumeSlider.style.setProperty('--slider-pct', `${volPct}%`);
      }

      if (Math.abs(entry.lastProgress - progress) > 0.0005 || entry.lastProgress === -1) {
        entry.lastProgress = progress;
        entry.waveWrap.setAttribute('aria-valuenow', String(progressPct));
        this.drawWaveform(entry, progress, isMuted);
      }
    }
  }

  updateLevels(levelsInput) {
    const levelMap = levelsInput?.levels ? levelsInput.levels : levelsInput || {};
    for (const [stemId, entry] of this.lanes.entries()) {
      const raw = Number(levelMap[stemId]);
      const level = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
      if (Math.abs(entry.lastLevel - level) < 0.004) continue;
      entry.lastLevel = level;
      entry.meterFill.style.transform = `scaleY(${level.toFixed(3)})`;
      entry.rowEl.classList.toggle('is-hot', level > 0.72);
    }
  }

  setHoveredStem(stemId) {
    const next = stemId || null;
    if (this.hoveredStemId === next) return;
    this.hoveredStemId = next;
    for (const [id, entry] of this.lanes.entries()) {
      entry.rowEl.classList.toggle('is-hovered', id === next);
    }
  }

  drawWaveform(entry, progress, isMuted) {
    const { ctx, peaks, color, rgb, cssWidth: width, cssHeight: height, dpr } = entry;
    if (!ctx || width <= 0 || height <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;
    const maxAmp = Math.max(4, height * 0.43);
    const barCount = Math.max(40, Math.min(peaks.length || 120, Math.floor(width / 3.5)));
    const step = width / barCount;
    const barWidth = Math.max(1.5, Math.min(3.5, step * 0.62));
    const offsetX = (step - barWidth) * 0.5;

    const playedColor = isMuted ? 'rgba(148, 163, 184, 0.42)' : color;
    const unplayedColor = isMuted
      ? 'rgba(148, 163, 184, 0.18)'
      : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.32)`;

    ctx.fillStyle = isMuted
      ? 'rgba(148, 163, 184, 0.12)'
      : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`;
    ctx.fillRect(0, midY - 0.5, width, 1);

    for (let i = 0; i < barCount; i += 1) {
      const startIdx = Math.min(peaks.length - 1, Math.floor((i / barCount) * peaks.length));
      const endIdx = Math.min(peaks.length, Math.floor(((i + 1) / barCount) * peaks.length));
      let peak = peaks[startIdx] || 0;
      for (let j = startIdx + 1; j < endIdx; j += 1) {
        if (peaks[j] > peak) peak = peaks[j];
      }

      const barH = Math.max(2, peak * maxAmp * 2);
      const x = i * step + offsetX;
      const y = midY - barH / 2;
      const barCenter = (i + 0.5) / barCount;

      ctx.fillStyle = barCenter <= progress ? playedColor : unplayedColor;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, Math.min(barWidth / 2, 1.5));
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barWidth, barH);
      }
    }

    if (this.state.duration > 0) {
      const playX = Math.max(1, Math.min(width - 1, progress * width));
      ctx.fillStyle = isMuted ? 'rgba(226, 232, 240, 0.6)' : '#ffffff';
      ctx.fillRect(playX - 1, 2, 2, height - 4);
    }
  }

  clearLanes() {
    for (const entry of this.lanes.values()) {
      this.resizeObserver?.unobserve(entry.waveWrap);
    }
    this.lanes.clear();
    this.hoveredStemId = null;
    this.containerEl.innerHTML = '';
  }

  dispose() {
    this.clearLanes();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
